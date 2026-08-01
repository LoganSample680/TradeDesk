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
// WHAT IS DELIBERATELY NOT AUTOMATIC. Home. Commuting miles are not deductible,
// and home-to-first-job is the single most common mileage adjustment in an
// audit. A place is never auto-created from the day's first departure or last
// arrival, so the app cannot quietly inflate someone's deduction on their
// behalf. A contractor with a qualifying home office can mark it themselves,
// which genuinely changes the answer, and that is their call to make with their
// CPA, not ours to infer.

const PLACE_DWELL_MS      = 5*60*1000; // a stop, not a traffic light
const PLACE_MATCH_FT      = 600;       // same fence radius the job machine uses
const PLACE_REPEAT_MIN    = 3;         // visits before an unknown stop is offered
const PLACE_MAX_ACC_M     = 150;       // looser than this and the fix is meaningless
const PLACE_KINDS = {shop:'Shop',supply:'Supply house',other:'Other'};

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
function _geoStampIsContemporaneous(rec){
  if(!rec||!rec.geoAt||!rec.date)return false;
  try{return String(rec.geoAt).slice(0,10)===String(rec.date).slice(0,10);}
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
function recordUnknownStop(coord,ms){
  if(!coord||coord.lat==null)return null;
  if(!(ms>=PLACE_DWELL_MS))return null;   // a light, not a stop
  if(placeAt(coord))return null;          // already a known place
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
// Deliberately NOT a tile map. A real basemap means an external tile host, which
// the app's CSP forbids and which would put a per-view network cost on a page a
// contractor might open twenty times a day. What actually answers "where does my
// work happen" is the RELATIVE shape: a scatter plot in lat/lon space, normalised
// to the data's own bounding box, with everything on one canvas so clusters are
// obvious. Tapping a point opens the real map in the OS app, which is where
// someone wants directions anyway.
let _geoMapTypes=['expense','job','estimate','payment','place'];
const _GEO_MAP_STYLE={
  expense: {c:'#B45309', label:'Expenses'},
  job:     {c:'#0E6B39', label:'Jobs'},
  estimate:{c:'#2D5DA8', label:'Estimates'},
  payment: {c:'#6D28D9', label:'Payments'},
  place:   {c:'#A32D2D', label:'Places'},
};
function toggleGeoMapType(t){
  _geoMapTypes=_geoMapTypes.includes(t)?_geoMapTypes.filter(x=>x!==t):_geoMapTypes.concat(t);
  renderGeoMap();
}
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
        '<span style="width:7px;height:7px;border-radius:50%;background:'+(on?'#fff':st.c)+'"></span>'+st.label+' '+n+'</button>';
    }).join('');
  }
  if(cnt)cnt.textContent=pts.length?pts.length+' pinned':'';
  if(!pts.length){
    body.innerHTML='<div style="padding:22px 4px;font-size:13px;color:var(--text3);line-height:1.6">'+
      'Nothing pinned yet. Locations are recorded automatically when you log an expense, finish a job, or take a payment, as long as location is on.'+
      '</div>';
    return;
  }
  // Normalise to the data's own bounds. A single point (or a perfectly straight
  // line of them) would divide by zero, so the span floors at a small non-zero
  // value and such a set simply renders centred.
  const lats=pts.map(p=>p.lat),lons=pts.map(p=>p.lon);
  const minLat=Math.min(...lats),maxLat=Math.max(...lats);
  const minLon=Math.min(...lons),maxLon=Math.max(...lons);
  const spanLat=Math.max(maxLat-minLat,1e-4),spanLon=Math.max(maxLon-minLon,1e-4);
  const H=260;
  const dots=pts.map(p=>{
    const x=((p.lon-minLon)/spanLon)*100;
    const y=100-((p.lat-minLat)/spanLat)*100;   // north at the top
    const st=_GEO_MAP_STYLE[p.type]||{c:'var(--text3)'};
    const title=escHtml((p.label||p.type)+(p.date?' · '+p.date:''));
    return '<a href="https://www.google.com/maps?q='+p.lat+','+p.lon+'" target="_blank" rel="noopener" title="'+title+'" '+
      'style="position:absolute;left:'+x.toFixed(2)+'%;top:'+y.toFixed(2)+'%;width:11px;height:11px;margin:-5.5px 0 0 -5.5px;border-radius:50%;background:'+st.c+';border:2px solid var(--bg);box-sizing:content-box;cursor:pointer"></a>';
  }).join('');
  // Rough scale bar: how wide the plotted area is on the ground.
  let widthMi=0;
  try{widthMi=_haversineMiles({lat:minLat,lng:minLon},{lat:minLat,lng:maxLon});}catch(_e){}
  body.innerHTML=
    '<div style="position:relative;height:'+H+'px;border:1px solid var(--border);border-radius:var(--r);background:'+
      'linear-gradient(0deg,var(--bg2) 0%,var(--bg) 100%);overflow:hidden;margin-bottom:10px">'+
      // A faint grid so the plot reads as a spatial field rather than free-floating dots.
      '<div style="position:absolute;inset:0;background-image:linear-gradient(var(--border) 1px,transparent 1px),linear-gradient(90deg,var(--border) 1px,transparent 1px);background-size:25% 25%;opacity:.4"></div>'+
      '<div style="position:absolute;inset:10px">'+dots+'</div>'+
    '</div>'+
    '<div style="font-size:10px;color:var(--text3);line-height:1.6">'+
      (widthMi>0.1?'Area shown: about '+(widthMi<10?widthMi.toFixed(1):Math.round(widthMi))+' miles across. ':'')+
      'Tap any dot to open it in Maps.'+
    '</div>';
}
