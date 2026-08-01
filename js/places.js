// js/places.js: contractor-owned geocoded locations, and the stop/drive logic
// that needs them.
//
// WHY THIS EXISTS. The geofence machine knew two kinds of place: the shop
// (S.officeLat/officeLon) and job sites (client addresses). Supply houses were
// invisible, which broke drive tracking three ways:
//
//   1. Time PARKED at a supply house counted as driving. Nothing contained the
//      truck, so the drive clock ran while it sat in the lot and those minutes
//      landed on the next job's leg.
//   2. A supply run that came back to the shop logged NOTHING. Leaving the shop
//      started the clock; arriving back merely cleared it, because a drive entry
//      was only ever written on arriving at a JOB. A real deductible round trip
//      produced zero miles.
//   3. Every leg billed to its destination job, so shop -> supply -> job charged
//      that job for the supply stop too.
//
// Mileage is a deduction, so those are accuracy defects, not cosmetics.
//
// HOW PLACES GET CREATED. Two ways, neither of which is a setup chore:
//
//   • From an expense. When a receipt is logged the phone is standing in the
//     lot, so the expense already carries lat/lon (js/geo-track.js _stampGeo)
//     and a vendor name. That is a named, business-purposed location for free,
//     and it is the strongest kind: IRS Pub 463 wants destination AND business
//     purpose for a deductible trip, and the receipt supplies both.
//   • From repetition. A stop that keeps happening at the same coordinates is
//     obviously somewhere that matters, so after PLACE_REPEAT_MIN visits it is
//     offered rather than assumed.
//
// THE COMMUTE GUARD. Commuting miles are NOT deductible, and home-to-first-job
// is the single most common mileage adjustment in an audit. Home is also, to a
// dwell detector, the most obvious "place" there is: the truck sits there all
// night, every night. Left alone this engine would offer someone their own house
// as a supply house within three days, and accepting it would start logging
// commute miles as business trips. So two rules, both enforced in
// _placeIsLikelyHome:
//
//   1. Any dwell over PLACE_HOME_DWELL_MS (6h) is somewhere you sleep, not
//      somewhere you buy conduit.
//   2. The coordinate the working day STARTED at is where you left from, which
//      for the overwhelming majority of contractors is home.
//
// A contractor with a qualifying home office can mark it themselves (kind:
// 'home_office'), which genuinely changes the tax answer. That is a decision for
// them and their CPA, never something inferred from GPS.

const PLACE_DWELL_MS      = 5*60*1000; // a stop, not a traffic light
const PLACE_MATCH_FT      = 600;       // same fence radius the job machine uses
const PLACE_REPEAT_MIN    = 3;         // visits before an unknown stop is offered
const PLACE_MAX_ACC_M     = 150;       // looser than this and the fix is meaningless
const PLACE_HOME_DWELL_MS = 6*60*60*1000; // sleep, not a supply run
const PLACE_KINDS = {shop:'Shop',supply:'Supply house',home_office:'Home office',other:'Other'};

// ── Lookup ───────────────────────────────────────────────────────────────────
function getPlaces(){return places;}
function _placeDistFt(a,b){
  if(!a||!b||a.lat==null||b.lat==null)return Infinity;
  try{return _haversineMiles({lat:a.lat,lng:a.lon!=null?a.lon:a.lng},{lat:b.lat,lng:b.lon!=null?b.lon:b.lng})*5280;}
  catch(_e){return Infinity;}
}
// Nearest known place within its own fence, or null. Places may carry a per-row
// fenceFt (a lumber yard is a bigger target than a hardware store).
function placeAt(coord){
  if(!coord||coord.lat==null)return null;
  let best=null,bestFt=Infinity;
  (places||[]).forEach(pl=>{
    if(pl.lat==null||pl.lon==null)return;
    const ft=_placeDistFt(coord,pl);
    if(ft<=(pl.fenceFt||PLACE_MATCH_FT)&&ft<bestFt){best=pl;bestFt=ft;}
  });
  return best;
}

// ── Create / update ──────────────────────────────────────────────────────────
function savePlace(pl){
  if(!pl||pl.lat==null||pl.lon==null)return null;
  const existing=pl.id?places.find(p=>String(p.id)===String(pl.id)):null;
  if(existing){Object.assign(existing,pl);}
  else{
    pl.id=pl.id||_newId();
    pl.createdAt=pl.createdAt||new Date().toISOString();
    places.push(pl);
  }
  if(typeof saveAll==='function')saveAll();
  return existing||pl;
}
function deletePlace(id){
  const i=places.findIndex(p=>String(p.id)===String(id));
  if(i<0)return false;
  // _userDelete snapshots every synced array, runs the mutation, then diffs, so
  // the removal has to happen INSIDE the callback. That is what records the id as
  // locally-deleted and authorises the cloud sweep to remove it; without it the
  // row resurrects on every other device (§9.8).
  const doIt=()=>{places.splice(i,1);return true;};
  if(typeof _userDelete==='function')_userDelete(doIt); else doIt();
  if(typeof saveAll==='function')saveAll();
  return true;
}

// ── Creation from an expense ─────────────────────────────────────────────────
// The receipt is the anchor: it names the location and proves the visit was for
// business. Guarded three ways, because a bad auto-created place quietly
// corrupts every drive leg that later matches it:
//   • the fix has to be tight enough to mean something
//   • the stamp has to be CONTEMPORANEOUS with the expense date, otherwise the
//     receipt was done on the sofa that evening and the coordinate is the
//     contractor's living room
//   • a coordinate already inside a known place is not a new place
function _placeFromExpense(exp){
  if(!exp||exp.lat==null||exp.lon==null)return null;
  if(exp.geoAcc!=null&&exp.geoAcc>PLACE_MAX_ACC_M)return null;
  if(!exp.vendor)return null;
  if(!_geoStampIsContemporaneous(exp))return null;
  if(placeAt(exp))return null;                       // already known
  return savePlace({
    name:String(exp.vendor).trim(),
    kind:'supply',
    lat:exp.lat,lon:exp.lon,
    confirmedBy:'expense',
    sourceExpenseId:exp.id,
  });
}
// The stamp counts as taken at the transaction if it happened on the same
// calendar day the expense is dated. Anything later is paperwork.
//
// BOTH SIDES MUST BE THE SAME CALENDAR. rec.date is a LOCAL day key (todayKey,
// built from getFullYear/Month/Date) while geoAt is a UTC ISO string, so
// slicing geoAt's first ten characters compares a local day against a UTC day.
// Anywhere west of UTC those disagree for the whole evening: at 9pm Central it
// is already tomorrow in UTC, so every receipt logged after about 6pm looked
// non-contemporaneous and silently never created a supply house. Evening supply
// runs are exactly the trips this feature exists for, and exactly the ones the
// removed time lock used to drop. Convert geoAt to the SAME local key first.
function _geoLocalDayKey(iso){
  const d=new Date(iso);
  if(isNaN(d))return '';
  const p=n=>String(n).padStart(2,'0');
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());
}
function _geoStampIsContemporaneous(rec){
  if(!rec||!rec.geoAt||!rec.date)return false;
  try{return _geoLocalDayKey(rec.geoAt)===String(rec.date).slice(0,10);}
  catch(_e){return false;}
}
// Sweep every expense that has a usable stamp and no matching place yet. Cheap,
// idempotent (placeAt short-circuits anything already known), and safe to run on
// every load.
function detectPlacesFromExpenses(){
  let made=0;
  (expenses||[]).forEach(e=>{if(_placeFromExpense(e))made++;});
  return made;
}

// ── Creation from repetition ─────────────────────────────────────────────────
// Unknown stops accumulate on the device. Once one recurs enough it is OFFERED,
// never assumed: we know someone stops there, not what it is or whether it is
// business.
const _PLACE_STOPS_KEY='zp3_place_stops';
function _placeStopsRead(){try{return JSON.parse(localStorage.getItem(_PLACE_STOPS_KEY)||'[]');}catch(_e){return[];}}
function _placeStopsWrite(a){try{localStorage.setItem(_PLACE_STOPS_KEY,JSON.stringify(a.slice(-200)));}catch(_e){}}
// The coordinate the working day started at. Written by the first ping of each
// day and read by the commute guard. Per-device on purpose: it describes where
// this person left from, not account configuration.
const _PLACE_DAY_KEY='zp3_place_day_anchor';
function _placeDayAnchor(){
  try{
    const a=JSON.parse(localStorage.getItem(_PLACE_DAY_KEY)||'null');
    return (a&&a.day===todayKey())?a:null;
  }catch(_e){return null;}
}
function noteDayStart(coord){
  if(!coord||coord.lat==null)return;
  if(_placeDayAnchor())return;            // already anchored today
  try{localStorage.setItem(_PLACE_DAY_KEY,JSON.stringify({
    day:todayKey(),lat:coord.lat,lon:coord.lng!=null?coord.lng:coord.lon
  }));}catch(_e){}
}
// True when a stop is almost certainly home. Either rule alone is enough.
function _placeIsLikelyHome(coord,ms){
  if(ms>=PLACE_HOME_DWELL_MS)return true;           // slept there
  const a=_placeDayAnchor();
  if(a&&_placeDistFt(coord,a)<=PLACE_MATCH_FT)return true; // left from there
  return false;
}
function recordUnknownStop(coord,ms){
  if(!coord||coord.lat==null)return null;
  if(!(ms>=PLACE_DWELL_MS))return null;   // a light, not a stop
  if(placeAt(coord))return null;          // already a known place
  // Never offer home. Accepting it would turn a non-deductible commute into a
  // logged business trip, which is the app inflating a deduction on the
  // contractor's behalf, silently.
  if(_placeIsLikelyHome(coord,ms))return null;
  const stops=_placeStopsRead();
  const hit=stops.find(s=>_placeDistFt(coord,s)<=PLACE_MATCH_FT);
  if(hit){hit.n=(hit.n||1)+1;hit.lastAt=new Date().toISOString();}
  else stops.push({lat:coord.lat,lon:coord.lng!=null?coord.lng:coord.lon,n:1,lastAt:new Date().toISOString()});
  _placeStopsWrite(stops);
  return hit||stops[stops.length-1];
}
// Stops seen often enough to be worth asking about.
function pendingPlaceSuggestions(){
  return _placeStopsRead().filter(s=>(s.n||0)>=PLACE_REPEAT_MIN&&!placeAt(s));
}
function dismissPlaceSuggestion(lat,lon){
  const stops=_placeStopsRead().filter(s=>!(Math.abs(s.lat-lat)<1e-6&&Math.abs(s.lon-lon)<1e-6));
  _placeStopsWrite(stops);
}

// ── The map feed ─────────────────────────────────────────────────────────────
// Every stamped record, merged client-side. The sync fabric already holds all of
// these arrays in memory, so this needs no query, no join and no new table.
function geoFeed(opts){
  const o=opts||{};
  const out=[];
  const push=(arr,type,label,dateKey)=>{
    (arr||[]).forEach(r=>{
      if(r.lat==null||r.lon==null)return;
      if(r.geoAcc!=null&&r.geoAcc>PLACE_MAX_ACC_M)return; // a 3km fix is not a location
      out.push({type,id:r.id,lat:r.lat,lon:r.lon,date:r[dateKey]||r.date,
                label:(typeof label==='function'?label(r):label)||type,amount:r.amount});
    });
  };
  push(expenses,'expense',r=>r.vendor||'Expense','date');
  push(jobs,'job',r=>r.client_name||r.name||'Job','start');
  push(bids,'estimate',r=>r.client_name||'Estimate','date');
  push(payments,'payment',r=>r.client_name||'Payment','date');
  (places||[]).forEach(pl=>{
    if(pl.lat==null||pl.lon==null)return;
    out.push({type:'place',id:pl.id,lat:pl.lat,lon:pl.lon,label:pl.name,kind:pl.kind});
  });
  const types=o.types&&o.types.length?o.types:null;
  return out
    .filter(p=>!types||types.includes(p.type))
    .filter(p=>!o.since||!p.date||String(p.date)>=String(o.since))
    .sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
}

// ── The map ──────────────────────────────────────────────────────────────────
// Real Apple Maps tiles via MapKit JS, which the app already loads (index.html)
// and already uses for Directions, Search and Geocoding. Annotations are
// mapkit.MarkerAnnotation, i.e. the actual dropped pin Apple Maps uses, so the
// pin is precise by construction rather than an SVG approximation of one.
//
// MapKit tokens are DOMAIN-LOCKED (see js/mileage.js): init is skipped on
// localhost, 127.0.0.1 and the flow-test bridge, because mapkit.init throws an
// origin-mismatch console.error on any unauthorised origin and that fails
// assertNoErrors. So MapKit is genuinely unavailable in three real situations:
// local development, the offline-mocked test suite, and a contractor with no
// signal on a rural job site (the PWA still opens, the tiles cannot download).
//
// Hence the fallback plot below. It is not a lesser map, it is what renders when
// there are no tiles to be had, and it still answers the only question this
// screen exists to answer: where does my work cluster.
let _geoMapTypes=['estimate','job','expense'];
// Key order IS the legend order (owner: proposals, jobs, expenses), which also
// happens to be the order the work actually happens in. 'estimate' stays the
// internal key because that is what the bids array holds; the label is what a
// contractor calls it. Payments and places are still stamped and still in
// geoFeed, they are simply not on this map (owner call: three types, that is it).
const _GEO_MAP_STYLE={
  estimate:{c:'#2D5DA8', label:'Proposals', glyph:'P'},
  job:     {c:'#0E6B39', label:'Jobs',      glyph:'J'},
  expense: {c:'#B45309', label:'Expenses',  glyph:'E'},
};
function toggleGeoMapType(t){
  _geoMapTypes=_geoMapTypes.includes(t)?_geoMapTypes.filter(x=>x!==t):_geoMapTypes.concat(t);
  renderGeoMap();
}
function _geoMapKitReady(){
  return typeof mapkit!=='undefined'&&typeof _mapkitReady!=='undefined'&&_mapkitReady;
}

let _geoMapObj=null;      // the live mapkit.Map, reused across renders
let _geoMapHost=null;     // the element it was constructed against

function renderGeoMap(){
  const body=document.getElementById('tr-map-body');
  const filt=document.getElementById('tr-map-filters');
  const cnt=document.getElementById('tr-map-count');
  if(!body)return;
  const all=(typeof geoFeed==='function')?geoFeed({}):[];
  const pts=all.filter(p=>_geoMapTypes.includes(p.type));
  if(filt){
    filt.innerHTML=Object.keys(_GEO_MAP_STYLE).map(t=>{
      const on=_geoMapTypes.includes(t),st=_GEO_MAP_STYLE[t];
      const n=all.filter(p=>p.type===t).length;
      return '<button type="button" onclick="toggleGeoMapType(\''+t+'\')" style="display:flex;align-items:center;gap:5px;font-size:11px;font-weight:700;padding:5px 10px;border-radius:999px;cursor:pointer;font-family:inherit;border:1px solid '+(on?st.c:'var(--border2)')+';background:'+(on?st.c:'transparent')+';color:'+(on?'#fff':'var(--text3)')+'">'+
        '<span style="width:7px;height:9px;border-radius:50% 50% 50% 50%/60% 60% 40% 40%;background:'+(on?'#fff':st.c)+'"></span>'+st.label+' '+n+'</button>';
    }).join('');
  }
  if(cnt)cnt.textContent=pts.length?pts.length+' pinned':'';
  if(!pts.length){
    _geoMapDestroy();
    body.innerHTML='<div style="padding:22px 4px;font-size:13px;color:var(--text3);line-height:1.6">'+
      'Nothing pinned yet. Locations are recorded automatically when you log an expense, finish a job, or send a proposal, as long as location is on.'+
      '</div>';
    return;
  }
  if(_geoMapKitReady()){_geoRenderMapKit(body,pts);return;}
  _geoMapDestroy();
  _geoRenderFallback(body,pts);
}

function _geoMapDestroy(){
  try{if(_geoMapObj&&_geoMapObj.destroy)_geoMapObj.destroy();}catch(_e){}
  _geoMapObj=null;_geoMapHost=null;
}

// ── Real tiles ───────────────────────────────────────────────────────────────
function _geoRenderMapKit(body,pts){
  // Reuse the instance across filter toggles. Constructing a fresh mapkit.Map on
  // every render leaks the old one's tile requests and DOM.
  let host=document.getElementById('tr-map-canvas');
  if(!host||_geoMapHost!==host){
    body.innerHTML='<div id="tr-map-canvas" style="height:320px;border-radius:var(--r);overflow:hidden;border:1px solid var(--border)"></div>'+
      '<div style="font-size:10px;color:var(--text3);line-height:1.6;margin-top:8px">Tap a pin for details, then the arrow for directions.</div>';
    host=document.getElementById('tr-map-canvas');
    _geoMapDestroy();
    try{
      _geoMapObj=new mapkit.Map(host,{
        showsCompass:mapkit.FeatureVisibility.Hidden,
        showsScale:mapkit.FeatureVisibility.Adaptive,
        showsMapTypeControl:false,
        showsZoomControl:true,
        showsUserLocationControl:true,
      });
      _geoMapHost=host;
    }catch(_e){_geoMapDestroy();_geoRenderFallback(body,pts);return;}
  }
  try{
    _geoMapObj.removeAnnotations(_geoMapObj.annotations||[]);
    const anns=pts.map(p=>{
      const st=_GEO_MAP_STYLE[p.type]||{c:'#666',glyph:''};
      const a=new mapkit.MarkerAnnotation(new mapkit.Coordinate(p.lat,p.lon),{
        color:st.c,
        glyphText:st.glyph||'',
        title:p.label||p.type,
        subtitle:p.date||'',
      });
      return a;
    });
    _geoMapObj.addAnnotations(anns);
    // Frame everything with a little breathing room rather than hard-cropping to
    // the outermost pins.
    if(anns.length)_geoMapObj.showItems(anns,{animate:false,padding:new mapkit.Padding(40,24,40,24)});
  }catch(_e){_geoMapDestroy();_geoRenderFallback(body,pts);}
}

// ── Fallback: no tiles available ─────────────────────────────────────────────
// Local dev, the offline test suite, and a real contractor with no signal. Pins
// are drawn to the same anchoring rule as MapKit's: the POINT is the location,
// the head sits above it, and a ground shadow marks the exact spot so the
// precision reads at a glance.
const _GEO_PIN_W=22,_GEO_PIN_H=30;
function _geoPinSvg(color){
  return '<svg width="'+_GEO_PIN_W+'" height="'+_GEO_PIN_H+'" viewBox="0 0 22 30" style="display:block">'+
    '<ellipse cx="11" cy="28.2" rx="3.1" ry="1.25" fill="rgba(0,0,0,.28)"/>'+
    '<path d="M11 27.4 L8.25 15.2 h5.5 Z" fill="'+color+'"/>'+
    '<circle cx="11" cy="9.6" r="8.1" fill="'+color+'" stroke="#fff" stroke-width="1.8"/>'+
    '<circle cx="11" cy="9.6" r="3" fill="#fff" fill-opacity=".95"/>'+
  '</svg>';
}
function _geoRenderFallback(body,pts){
  const lats=pts.map(p=>p.lat),lons=pts.map(p=>p.lon);
  const minLat=Math.min(...lats),maxLat=Math.max(...lats);
  const minLon=Math.min(...lons),maxLon=Math.max(...lons);
  // A single point, or a perfectly straight line of them, would divide by zero.
  const spanLat=Math.max(maxLat-minLat,1e-4),spanLon=Math.max(maxLon-minLon,1e-4);
  // Draw north-first so southern pins overlap the ones behind them, the way a
  // real map stacks. Sorting a copy leaves the caller's feed order alone.
  const dots=pts.slice().sort((a,b)=>b.lat-a.lat).map(p=>{
    const x=((p.lon-minLon)/spanLon)*100;
    const y=100-((p.lat-minLat)/spanLat)*100;   // north at the top
    const st=_GEO_MAP_STYLE[p.type]||{c:'var(--text3)'};
    const title=escHtml((p.label||p.type)+(p.date?' · '+p.date:''));
    // margin pulls the pin up its full height and left half its width, so the
    // POINT lands on the coordinate rather than the middle of the head.
    return '<a href="https://www.google.com/maps?q='+p.lat+','+p.lon+'" target="_blank" rel="noopener" title="'+title+'" '+
      'style="position:absolute;left:'+x.toFixed(2)+'%;top:'+y.toFixed(2)+'%;margin:-'+_GEO_PIN_H+'px 0 0 -'+(_GEO_PIN_W/2)+'px;line-height:0;cursor:pointer">'+
      _geoPinSvg(st.c)+'</a>';
  }).join('');
  let widthMi=0;
  try{widthMi=_haversineMiles({lat:minLat,lng:minLon},{lat:minLat,lng:maxLon});}catch(_e){}
  body.innerHTML=
    '<div style="position:relative;height:280px;border:1px solid var(--border);border-radius:var(--r);background:'+
      'linear-gradient(0deg,var(--bg2) 0%,var(--bg) 100%);overflow:hidden;margin-bottom:10px">'+
      '<div style="position:absolute;inset:0;background-image:linear-gradient(var(--border) 1px,transparent 1px),linear-gradient(90deg,var(--border) 1px,transparent 1px);background-size:25% 25%;opacity:.4"></div>'+
      '<div style="position:absolute;top:'+(_GEO_PIN_H+2)+'px;left:14px;right:14px;bottom:14px">'+dots+'</div>'+
    '</div>'+
    '<div style="font-size:10px;color:var(--text3);line-height:1.6">'+
      (widthMi>0.1?'Area shown: about '+(widthMi<10?widthMi.toFixed(1):Math.round(widthMi))+' miles across. ':'')+
      'Tap any pin to open it in Maps.'+
    '</div>';
}

// ── The Places screen (Fleet & Team → Places) ────────────────────────────────
// Owner-facing. Everything here is business configuration, so it lives beside
// the fleet and the crew rather than in Books.
const _PLACE_KIND_ICON={shop:'🏠',supply:'🧰',home_office:'🏡',other:'📍'};
function _placeKindLabel(k){return PLACE_KINDS[k]||PLACE_KINDS.other;}

// The shop was geocoded into S.officeLat/officeLon long before td_places
// existed, and the fence machine still reads it from there. Lift it in once so a
// contractor can actually see it, rename it, or correct the pin, and so it shows
// up alongside everything else. Idempotent: guarded on a shop already existing.
function _migrateShopToPlaces(){
  if(!(S.officeLat&&S.officeLon))return null;
  if((places||[]).some(p=>p.kind==='shop'))return null;
  if(placeAt({lat:S.officeLat,lon:S.officeLon}))return null;
  return savePlace({
    name:(S.bname?S.bname+' shop':'Shop'),kind:'shop',
    lat:S.officeLat,lon:S.officeLon,confirmedBy:'business-address',
  });
}

function renderPlaces(){
  _migrateShopToPlaces();
  _renderPlaceSuggestions();
  const el=document.getElementById('place-list');
  if(!el)return;
  const rows=(places||[]).slice().sort((a,b)=>
    (a.kind==='shop'?0:a.kind==='home_office'?1:2)-(b.kind==='shop'?0:b.kind==='home_office'?1:2)
    ||String(a.name||'').localeCompare(String(b.name||'')));
  if(!rows.length){
    el.innerHTML='<div style="font-size:12px;color:var(--text3);padding:6px 0;line-height:1.6">'+
      'No locations yet. They add themselves when you log a receipt at a supply house, or add one now.</div>';
    return;
  }
  el.innerHTML=rows.map(pl=>{
    const src=pl.confirmedBy==='expense'?'From a receipt'
      :pl.confirmedBy==='business-address'?'From your business address'
      :pl.confirmedBy==='repeat'?'From repeat visits':'Added by you';
    return '<div style="padding:10px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);margin-bottom:8px">'+
      '<div style="display:flex;align-items:center;gap:10px">'+
        '<div style="width:32px;height:32px;flex-shrink:0;border-radius:9px;background:var(--bg);display:flex;align-items:center;justify-content:center;font-size:16px">'+svgIcon(_PLACE_KIND_ICON[pl.kind]||'📍',{size:16})+'</div>'+
        '<div style="flex:1;min-width:0">'+
          '<div style="font-size:13px;font-weight:700">'+escHtml(pl.name||'Unnamed')+'</div>'+
          '<div style="font-size:10px;color:var(--text3);margin-top:1px">'+escHtml(_placeKindLabel(pl.kind))+' · '+src+'</div>'+
        '</div>'+
        '<a href="https://www.google.com/maps?q='+pl.lat+','+pl.lon+'" target="_blank" rel="noopener" style="font-size:10px;font-weight:700;color:var(--blue);text-decoration:none;padding:5px 8px;white-space:nowrap">'+svgIcon('📍',{size:10})+' Map</a>'+
        '<button onclick="openPlaceModal(\''+pl.id+'\')" style="font-size:11px;padding:4px 10px;border-radius:var(--r);border:1px solid var(--border2);background:none;cursor:pointer;font-family:inherit">Edit</button>'+
      '</div>'+
    '</div>';
  }).join('');
}

// Repeat stops the device noticed. Offered, never assumed: we know someone stops
// there, not what it is or whether it is business. Home is already filtered out
// upstream by the commute guard.
function _renderPlaceSuggestions(){
  const el=document.getElementById('place-suggestions');
  if(!el)return;
  const sug=(typeof pendingPlaceSuggestions==='function')?pendingPlaceSuggestions():[];
  if(!sug.length){el.innerHTML='';return;}
  el.innerHTML=sug.map(s=>
    '<div class="card" style="margin-bottom:10px;border:1px solid var(--blue);background:linear-gradient(135deg,rgba(45,93,168,.08),transparent)">'+
      '<div style="font-size:13px;font-weight:800;margin-bottom:3px">'+svgIcon('📍',{size:13})+' You keep stopping here</div>'+
      '<div style="font-size:11px;color:var(--text3);line-height:1.5;margin-bottom:10px">'+
        s.n+' visits. Add it and the drive time to and from stops counting as time parked.'+
      '</div>'+
      '<div style="display:flex;gap:8px">'+
        '<button onclick="openPlaceModal(null,'+s.lat+','+s.lon+')" style="flex:1;padding:9px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">Add this place</button>'+
        '<button onclick="dismissPlaceSuggestion('+s.lat+','+s.lon+');renderPlaces()" style="padding:9px 12px;border-radius:var(--r);border:1px solid var(--border2);background:none;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;color:var(--text3)">Not work</button>'+
      '</div>'+
    '</div>').join('');
}

// Add / edit. lat+lon are passed when promoting a suggestion, since that stop
// already has coordinates and asking for an address would be absurd.
function openPlaceModal(id,lat,lon){
  const pl=id?(places||[]).find(p=>String(p.id)===String(id)):null;
  const _lat=pl?pl.lat:lat,_lon=pl?pl.lon:lon;
  document.getElementById('place-modal')?.remove();
  const ov=document.createElement('div');
  ov.id='place-modal';ov.className='zmodal-overlay';
  ov.onclick=e=>{if(e.target===ov)ov.remove();};
  const kindOpts=Object.keys(PLACE_KINDS).map(k=>
    '<option value="'+k+'"'+((pl&&pl.kind===k)||(!pl&&k==='supply')?' selected':'')+'>'+PLACE_KINDS[k]+'</option>').join('');
  ov.innerHTML='<div style="position:fixed;bottom:0;left:0;right:0;background:var(--bg);border-radius:16px 16px 0 0;padding:20px 18px 26px;max-width:520px;margin:0 auto;box-sizing:border-box">'+
    '<div style="font-size:17px;font-weight:800;margin-bottom:14px">'+(pl?'Edit location':'Add a location')+'</div>'+
    '<div class="f" style="margin-bottom:12px"><label>Name</label>'+
      '<input id="place-name" placeholder="Ferguson Plumbing" value="'+escHtml(pl?pl.name||'':'')+'" style="font-size:15px;padding:11px;border-radius:9px;border:1.5px solid var(--border2);background:var(--bg2);color:var(--text);width:100%;box-sizing:border-box"></div>'+
    '<div class="f" style="margin-bottom:12px"><label>Type</label>'+
      '<select id="place-kind" style="font-size:15px;padding:11px;border-radius:9px;border:1.5px solid var(--border2);background:var(--bg2);color:var(--text);width:100%;box-sizing:border-box">'+kindOpts+'</select></div>'+
    // A home office changes whether the first trip of the day is deductible, so
    // it is stated plainly rather than buried as a dropdown value.
    '<div style="font-size:10px;color:var(--text3);line-height:1.5;margin-bottom:14px">Mark somewhere as a Home office only if it qualifies as your principal place of business. It changes whether your first trip of the day is deductible, so check with your CPA.</div>'+
    (_lat!=null
      ? '<input type="hidden" id="place-lat" value="'+_lat+'"><input type="hidden" id="place-lon" value="'+_lon+'">'+
        '<div style="font-size:11px;color:var(--text3);margin-bottom:14px">'+svgIcon('📍',{size:11})+' Pinned at '+Number(_lat).toFixed(5)+', '+Number(_lon).toFixed(5)+'</div>'
      : '<div style="font-size:11px;color:#A32D2D;margin-bottom:14px">No coordinates. Add this from a repeat stop, or log a receipt there.</div>')+
    '<button onclick="_savePlaceFromModal('+(pl?"'"+pl.id+"'":'null')+')" style="width:100%;padding:14px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:8px">Save</button>'+
    (pl?'<button onclick="_deletePlaceFromModal(\''+pl.id+'\')" style="width:100%;padding:11px;border-radius:var(--r);border:none;background:none;color:#A32D2D;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">Delete</button>':'')+
  '</div>';
  document.body.appendChild(ov);
  setTimeout(()=>document.getElementById('place-name')?.focus(),80);
  // Ask MapKit what business is standing at this pin and fill the name in.
  // Only for a NEW place from a coordinate, never over an existing record and
  // never over something already typed: the answer is a suggestion, and the
  // contractor is the one who decides what their supplier is called.
  if(!pl&&_lat!=null&&typeof _poiAt==='function'){
    _poiAt({lat:Number(_lat),lng:Number(_lon)}).then(poi=>{
      if(!poi||!poi.name)return;
      const n=document.getElementById('place-name');
      if(!n||n.value.trim())return;
      n.value=poi.name;
      const k=document.getElementById('place-kind');
      if(k&&typeof _poiPlaceKind==='function')k.value=_poiPlaceKind(poi.category);
    }).catch(()=>{});
  }
}
function _savePlaceFromModal(id){
  const name=(document.getElementById('place-name')?.value||'').trim();
  const kind=document.getElementById('place-kind')?.value||'supply';
  const lat=parseFloat(document.getElementById('place-lat')?.value);
  const lon=parseFloat(document.getElementById('place-lon')?.value);
  if(!name){showToast('Give it a name','⚠️');return;}
  if(!isFinite(lat)||!isFinite(lon)){showToast('No coordinates for this location','⚠️');return;}
  savePlace({id:id||undefined,name,kind,lat,lon,confirmedBy:id?undefined:'manual'});
  if(typeof dismissPlaceSuggestion==='function')dismissPlaceSuggestion(lat,lon);
  document.getElementById('place-modal')?.remove();
  showToast(name+' saved','📍');
  renderPlaces();
}
function _deletePlaceFromModal(id){
  zConfirm('Delete this location? Drive legs already recorded keep their history.',()=>{
    deletePlace(id);
    document.getElementById('place-modal')?.remove();
    renderPlaces();
  },{title:'Delete location',yes:'Delete',danger:true});
}
