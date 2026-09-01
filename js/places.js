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
// The kinds a PLACE can genuinely be: a fixed point in the day that belongs
// to NO ONE client (owner 2026-08-06). A Place record carries no client_id,
// so anything inherently tied to one specific customer, a job site, a client
// consult, a payment pickup, belongs to that client's own record (the job/
// estimate scheduling system, which already auto-fences it) rather than a
// generic named location that can never actually link back to who it's for.
// Job sites in particular already fence automatically off the real jobs
// array; a job_site PLACE would have been a second, disconnected way to
// describe the same thing.
//
// 'home_office' and 'shop' mean exactly what they mean elsewhere in this
// file: 'home_office' is the one value _geoAtHomeOffice checks for the
// commute-deduction rule, and 'shop' is what _migrateShopToPlaces guards
// against duplicating.
//
// This is deliberately a SUBSET of MILE_PURPOSES (js/constants.js), not a
// mirror of it: the trip-purpose picker on a manually-logged mileage row
// still offers the full vocabulary (Job site, Client Consult, Payment
// Collection, Estimate included), those stay valid ways to categorize a
// trip by hand. Only the automatic PLACE side is scoped down to what a
// place, not a client, can actually be.
const PLACE_KINDS = {
  shop:'Shop',
  home_office:'Home office',
  supply:'Supply house',
  // NOT a customer. Somewhere the owner goes to work ON the business rather
  // than in it: an advisor's place, the CPA, the bank, a GC about work that
  // does not exist yet. Deductible all the same, and it needed its own kind
  // because 'Client consult' means a paying customer and putting these there
  // would quietly overstate what customer work costs to win.
  business_meeting:'Business meeting',
  other:'Other',
};

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
    // Element-guarded: one hole in the array used to throw straight out
    // of here, and placeAt sits on the visit-close path, so a single
    // malformed place row took a whole stop down with it.
    if(!pl||pl.lat==null||pl.lon==null)return;
    const ft=_placeDistFt(coord,pl);
    if(ft<=(pl.fenceFt||PLACE_MATCH_FT)&&ft<bestFt){best=pl;bestFt=ft;}
  });
  return best;
}

// A receipt logged AT this pin, on this day, is the contractor saying the stop
// was for the business. It is also the exact evidence the deduction needs, so
// nothing extra is being asked of them.
//
// This is what tells a crew lunch run from a personal one, and nothing else can
// (owner's CPA, 2026-08-02). The GPS sees the same restaurant, the same forty
// minutes parked, either way. Buying the guys lunch is a business errand and
// both legs count; buying your own is a detour and the miles pass straight
// through. Same rule as _placeFromExpense uses to learn a supply house: same-day
// stamp, inside the fence.
function expenseAt(coord){
  if(!coord||coord.lat==null||typeof expenses==='undefined')return null;
  return (expenses||[]).find(e=>
    e&&e.lat!=null&&e.lon!=null&&
    (e.geoAcc==null||e.geoAcc<=PLACE_MAX_ACC_M)&&
    _geoStampIsContemporaneous(e)&&
    _placeDistFt(coord,e)<=PLACE_MATCH_FT)||null;
}
// Two businesses are the same business. Receipts get typed as "Bobo's Drive-In"
// and Apple calls it "Bobos Drive In", so compare on letters and digits only,
// and let either one contain the other: "Pennant" on a receipt is the same
// place Apple returned as "The Pennant".
function _expenseVendorMatches(vendor,name){
  const norm=s=>String(s||'').toLowerCase().replace(/^the\s+/,'').replace(/[^a-z0-9]+/g,'');
  const a=norm(vendor),b=norm(name);
  if(a.length<3||b.length<3)return false;
  return a===b||a.indexOf(b)>=0||b.indexOf(a)>=0;
}
// The map's Expenses layer used to fall back to the live GPS fix (where the
// receipt was LOGGED) for anything not tied to a job, which put a lot of
// contractors' own houses on their own map (receipts get done in the truck
// at 5pm, or Sunday at the kitchen table, same reason expenseForStop above
// can't trust geo for a late receipt). Resolve the vendor's real location
// instead, in order: an already-confirmed supply house (places, no network
// call, a contractor already vetted it), else an Apple Maps business-name
// search (_resolveCoords, the same one address geocoding already uses)
// biased to the business's home area. Written to vendorLat/vendorLon, kept
// separate from lat/lon on purpose: lat/lon stays the live fix expenseAt()
// and mileage.js's detour matching depend on.
async function _expenseVendorGeocode(){
  if(typeof expenses==='undefined')return false;
  let filled=false;
  for(const e of expenses){
    if(!e||e.job_id||e.vendorLat!=null||!e.vendor)continue;
    const known=(places||[]).find(pl=>pl.lat!=null&&pl.lon!=null&&_expenseVendorMatches(e.vendor,pl.name));
    if(known){e.vendorLat=known.lat;e.vendorLon=known.lon;filled=true;continue;}
    if(typeof _resolveCoords!=='function')continue;
    try{
      const r=await _resolveCoords(e.vendor);
      if(r&&r.lat!=null){e.vendorLat=r.lat;e.vendorLon=r.lng;filled=true;}
    }catch(_e){}
  }
  if(filled&&typeof saveAll==='function')saveAll();
  return filled;
}
// Did the contractor buy something for the business at this stop? Two signals,
// and it takes only one, because they answer at different times:
//
//   • GEO, the receipt was logged AT the counter, so its stamp lands on the pin.
//     This is the only signal available the moment the stop closes.
//   • VENDOR + DATE, the receipt was logged later. And later is the normal case:
//     receipts get done in the truck at 5pm, or Sunday at the kitchen table.
//
// The second is not a convenience, it is a correctness fix. _stampGeo records
// where they were WHEN THEY LOGGED IT, so a receipt entered the next morning
// carries the kitchen's coordinate, not the diner's. Geo-matching a late receipt
// cannot work even in principle: the coordinate is honest about the wrong thing.
// The vendor name and the date they put on it are what survive the delay.
function expenseForStop(o){
  if(!o||typeof expenses==='undefined')return null;
  const byGeo=(o.lat!=null)?expenseAt({lat:o.lat,lon:o.lng!=null?o.lng:o.lon}):null;
  if(byGeo)return byGeo;
  if(!o.name||!o.day)return null;
  return (expenses||[]).find(e=>e&&String(e.date||'').slice(0,10)===String(o.day).slice(0,10)&&
    _expenseVendorMatches(e.vendor,o.name))||null;
}

// ── Create / update ──────────────────────────────────────────────────────────
function savePlace(pl){
  if(!pl||pl.lat==null||pl.lon==null)return null;
  const existing=pl.id?places.find(p=>String(p.id)===String(pl.id)):null;
  // Merge SKIPPING undefined: the edit modal passes confirmedBy:undefined (and
  // addr:undefined when there is no address field), and Object.assign copies
  // undefined over the stored value, so every edit silently erased the place's
  // provenance. An undefined key means "not changing this", never "clear it".
  if(existing){Object.keys(pl).forEach(k=>{if(pl[k]!==undefined)existing[k]=pl[k];});}
  else{
    pl.id=pl.id||_newId();
    pl.createdAt=pl.createdAt||new Date().toISOString();
    places.push(pl);
  }
  if(typeof saveAll==='function')saveAll();
  // The trips that predate the name catch up (mileage.js): every "Stop" row at
  // this pin becomes this place, which is the whole payoff of promoting a
  // repeat-stop suggestion. Idempotent, only anonymous endpoints move.
  if(typeof _placeRetroNameTrips==='function')_placeRetroNameTrips(existing||pl);
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
  // Expenses keep their own lat/lon as a live GPS fix (supply-house detection
  // in places.js expenseAt() and mileage.js's detour-receipt matching both
  // depend on it staying that way). But a receipt shouldn't plot at wherever
  // the paperwork got done (often home, on the couch that night, owner
  // 2026-08-17), so prefer, in order: the linked job's address-geocoded
  // coords, then the vendor's own geocoded coords (_expenseVendorGeocode),
  // and only fall back to the live GPS fix when neither is known.
  (expenses||[]).forEach(r=>{
    const linkedJob=r.job_id&&typeof jobs!=='undefined'?jobs.find(j=>j.id===r.job_id):null;
    const atJob=linkedJob&&linkedJob.lat!=null&&linkedJob.lon!=null;
    const atVendor=!atJob&&r.vendorLat!=null&&r.vendorLon!=null;
    let lat,lon;
    if(atJob){lat=linkedJob.lat;lon=linkedJob.lon;}
    else if(atVendor){lat=r.vendorLat;lon=r.vendorLon;}
    else{lat=r.lat;lon=r.lon;}
    if(lat==null||lon==null)return;
    if(!atJob&&!atVendor&&r.geoAcc!=null&&r.geoAcc>PLACE_MAX_ACC_M)return;
    out.push({type:'expense',id:r.id,lat,lon,date:r.date,label:r.vendor||'Expense',amount:r.amount});
  });
  push(jobs,'job',r=>r.client_name||r.name||'Job','start');
  push(bids,'estimate',r=>r.client_name||'Estimate','date');
  push(payments,'payment',r=>r.client_name||'Payment','date');
  (places||[]).forEach(pl=>{
    if(!pl||pl.lat==null||pl.lon==null)return;
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
// Entry point when the tracker's Map tab is opened. Paints immediately with
// whatever is already known, then resolves any un-geocoded receipt vendors
// and repaints once, never a spinner in front of a map (CLAUDE.md 8.3).
let _geoMapVendorLoading=false;
function openGeoMap(){
  renderGeoMap();
  if(_geoMapVendorLoading||typeof _expenseVendorGeocode!=='function')return;
  _geoMapVendorLoading=true;
  _expenseVendorGeocode().catch(()=>false).then(()=>{
    _geoMapVendorLoading=false;
    renderGeoMap();
  });
}
function _geoMapKitReady(){
  return typeof mapkit!=='undefined'&&typeof _mapkitReady!=='undefined'&&_mapkitReady;
}

// Two screens now draw Apple Maps tiles: the Places territory map (history)
// and the Dispatch day map (today). They are different pages, but each keeps
// its OWN {obj,host} pair rather than sharing one module-level singleton,
// because a shared one means whichever screen rendered last destroys the
// other's map out from under it the next time either re-renders.
function tdMapState(){return {obj:null,host:null};}
const _geoMapSt=tdMapState();   // the Places territory map's own state

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
    tdMapDestroy(_geoMapSt);
    body.innerHTML='<div style="padding:22px 4px;font-size:13px;color:var(--text3);line-height:1.6">'+
      'Nothing pinned yet. Locations are recorded automatically when you log an expense, finish a job, or send a proposal, as long as location is on.'+
      '</div>';
    return;
  }
  tdMapRender({body,pts,style:_GEO_MAP_STYLE,st:_geoMapSt,hostId:'tr-map-canvas',height:320,
    hint:'Tap a pin for details, then the arrow for directions.'});
}

// ── The shared map renderer ─────────────────────────────────────────────────
// One implementation, two screens: Places (where the work HAS been) and
// Dispatch (where it is TODAY). Both want the same thing, real Apple Maps tiles
// with a coloured pin per point and an honest plot when the tiles cannot load,
// so this takes points plus a style map rather than letting each screen grow a
// private copy of the same renderer.
//
// o = {body, pts:[{lat,lon,type,label,date}], style:{type:{c,label,glyph}},
//      st: a tdMapState(), hostId, height, hint, onSelect(pt)}
function tdMapDestroy(st){
  if(!st)return;
  try{if(st.obj&&st.obj.destroy)st.obj.destroy();}catch(_e){}
  st.obj=null;st.host=null;
}
function tdMapRender(o){
  if(o.allowKit!==false&&_geoMapKitReady()){tdMapRenderKit(o);return;}
  tdMapDestroy(o.st);
  tdMapRenderFallback(o);
}

// ── Apple's licence line, in code ────────────────────────────────────────────
// The Apple Developer Program License Agreement says MapKit JS "may not be used
// in your website and/or application running on non-Apple hardware for the
// following commercial purposes: fleet management (including dispatch), asset
// tracking, enterprise route optimization". A crew-location map IS all three of
// those, so on an Android phone or a Windows desktop it must not draw Apple
// tiles. Inside the iOS shell, and in Safari or Chrome on Apple hardware, it is
// squarely allowed.
//
// Callers pass allowKit:tdAppleHardware() for anything fleet-shaped. The
// fallback plot then renders instead, which uses none of Apple's data, so the
// screen still works everywhere, it just stops using tiles it is not licensed
// to use there. The Places territory map is business history rather than fleet
// management and is not gated.
//
// iPadOS 13+ reports itself as Macintosh, which lands on the allowed side
// either way, and anything unrecognised falls to the plot, which is the safe
// direction to be wrong in.
function tdAppleHardware(){
  try{
    const cap=window.Capacitor;
    if(cap&&typeof cap.isNativePlatform==='function'&&cap.isNativePlatform()){
      return !(typeof cap.getPlatform==='function'&&cap.getPlatform()==='android');
    }
    return /iPhone|iPad|iPod|Macintosh|Mac OS X/.test(navigator.userAgent||'');
  }catch(_e){return false;}
}

// ── Real tiles ───────────────────────────────────────────────────────────────
function tdMapRenderKit(o){
  const body=o.body,pts=o.pts,st=o.st;
  const hostId=o.hostId||'tr-map-canvas';
  const height=o.height||320;
  // Reuse the instance across filter toggles. Constructing a fresh mapkit.Map on
  // every render leaks the old one's tile requests and DOM.
  let host=document.getElementById(hostId);
  if(!host||st.host!==host){
    body.innerHTML='<div id="'+hostId+'" style="height:'+height+'px;border-radius:var(--r);overflow:hidden;border:1px solid var(--border)"></div>'+
      (o.hint?'<div style="font-size:10px;color:var(--text3);line-height:1.6;margin-top:8px">'+o.hint+'</div>':'');
    host=document.getElementById(hostId);
    tdMapDestroy(st);
    try{
      st.obj=new mapkit.Map(host,{
        showsCompass:mapkit.FeatureVisibility.Hidden,
        showsScale:mapkit.FeatureVisibility.Adaptive,
        showsMapTypeControl:false,
        showsZoomControl:true,
        showsUserLocationControl:true,
      });
      st.host=host;
    }catch(_e){tdMapDestroy(st);tdMapRenderFallback(o);return;}
  }
  try{
    st.obj.removeAnnotations(st.obj.annotations||[]);
    // ── THE ROUTE OVERLAY (owner ask 2026-09-01) ────────────────────────────
    // `path` is [[lat,lng,ms],...] straight off a mileage row. Drawn through
    // the SAME renderer every other map in the app uses rather than a second
    // mapping surface (§7.3): one MapKit instance, one fallback, one licence
    // gate. Removed and redrawn with the annotations so a re-render (a filter
    // toggle, a locate) never stacks overlays.
    try{st.obj.removeOverlays(st.obj.overlays||[]);}catch(_e2){}
    const path=Array.isArray(o.path)?o.path:null;
    if(path&&path.length>=2&&typeof mapkit.PolylineOverlay==='function'){
      const coords=path.map(q=>new mapkit.Coordinate(q[0],q[1]));
      const line=new mapkit.PolylineOverlay(coords,{
        style:new mapkit.Style({lineWidth:4,lineJoin:'round',lineCap:'round',
                                strokeColor:(o.pathColor||'#2D5DA8'),strokeOpacity:.85}),
      });
      st.obj.addOverlay(line);
    }
    const anns=pts.map(p=>{
      const stl=(o.style&&o.style[p.type])||{c:'#666',glyph:''};
      const a=new mapkit.MarkerAnnotation(new mapkit.Coordinate(p.lat,p.lon),{
        color:stl.c,
        glyphText:stl.glyph||'',
        title:p.label||p.type,
        subtitle:p.date||'',
      });
      if(typeof o.onSelect==='function')a.addEventListener('select',()=>o.onSelect(p));
      return a;
    });
    st.obj.addAnnotations(anns);
    // Frame everything with a little breathing room rather than hard-cropping to
    // the outermost pins.
    // Frame the OVERLAY as well when there is one: showItems on the pins alone
    // crops a route that loops outside its own endpoints, which is exactly the
    // detour a drawn route exists to show.
    const _items=anns.slice();
    try{if(st.obj.overlays&&st.obj.overlays.length)_items.push(...st.obj.overlays);}catch(_e3){}
    if(_items.length)st.obj.showItems(_items,{animate:false,padding:new mapkit.Padding(40,24,40,24)});
  }catch(_e){tdMapDestroy(st);tdMapRenderFallback(o);}
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
function tdMapRenderFallback(o){
  const body=o.body,pts=o.pts,style=o.style||{};
  // The route is part of the extent, not decoration on top of it: a plot
  // framed on two endpoints crops the detour in the middle, which is the one
  // thing a drawn route is for.
  const path=(Array.isArray(o.path)&&o.path.length>=2)
    ?o.path.filter(q=>Array.isArray(q)&&isFinite(q[0])&&isFinite(q[1])):null;
  const lats=pts.map(p=>p.lat).concat(path?path.map(q=>q[0]):[]);
  const lons=pts.map(p=>p.lon).concat(path?path.map(q=>q[1]):[]);
  const minLat=Math.min(...lats),maxLat=Math.max(...lats);
  const minLon=Math.min(...lons),maxLon=Math.max(...lons);
  // A single point, or a perfectly straight line of them, would divide by zero.
  const spanLat=Math.max(maxLat-minLat,1e-4),spanLon=Math.max(maxLon-minLon,1e-4);
  // Draw north-first so southern pins overlap the ones behind them, the way a
  // real map stacks. Sorting a copy leaves the caller's feed order alone.
  // Drawn as one SVG polyline under the pins, in the same percentage space the
  // pins use, so tiles or no tiles the line and the markers always agree.
  let routeSvg='';
  if(path){
    const poly=path.map(q=>{
      const x=((q[1]-minLon)/spanLon)*100;
      const y=100-((q[0]-minLat)/spanLat)*100;
      return x.toFixed(2)+','+y.toFixed(2);
    }).join(' ');
    routeSvg='<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" '+
      'style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none">'+
      '<polyline points="'+poly+'" fill="none" stroke="'+(o.pathColor||'#2D5DA8')+'" '+
      'stroke-width="1.1" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" opacity=".9"/>'+
    '</svg>';
  }
  const dots=pts.slice().sort((a,b)=>b.lat-a.lat).map(p=>{
    const x=((p.lon-minLon)/spanLon)*100;
    const y=100-((p.lat-minLat)/spanLat)*100;   // north at the top
    const st=style[p.type]||{c:'var(--text3)'};
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
      '<div style="position:absolute;top:'+(_GEO_PIN_H+2)+'px;left:14px;right:14px;bottom:14px">'+routeSvg+dots+'</div>'+
    '</div>'+
    '<div style="font-size:10px;color:var(--text3);line-height:1.6">'+
      (widthMi>0.1?'Area shown: about '+(widthMi<10?widthMi.toFixed(1):Math.round(widthMi))+' miles across. ':'')+
      'Tap any pin to open it in Maps.'+
    '</div>';
}

// ── The Places screen (Books → Places) ────────────────────────────────────
// Owner-facing. Lives beside Mileage since it exists to feed automatic drive
// attribution and trip-purpose reporting, the same reason Mileage lives here.
const _PLACE_KIND_ICON={shop:'🏠',supply:'🧰',home_office:'🏡',business_meeting:'🤝',other:'📍'};
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
  renderPlaceTimeReport();
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

// ── Time at places: yearly verified hours per place, per person ──────────────
// Owner ask (2026-08-06): "how can we grab total time spent at each place
// under books for the year and by individual?" Reads the SAME rows the
// geofence closers already write, place dwells in job_time_entries
// (source 'place', named by dest_place) and yard time in shop_time_entries,
// so this is a report over existing data, no new tables, no new writers.
// Manager-gated like the crew map (§9.5): field crew without the team
// permission see nothing here.
let _ptrYear=null;        // selected year, defaults to the current one
let _ptrCache={};         // year -> {t, rows, ok} (20s TTL, renderPlaces re-fires often)
let _ptrBusy=false;
let _ptrOpen={};          // bucket key -> expanded?
let _ptrKeys=[];          // index -> bucket key, so onclick never quotes a user-typed name
const _PTR_SHOP_KEY=' shop'; // can't collide with a real dest_place name
function _ptrCanView(){
  try{return !_isEmployee||!!(_employeeRecord&&_employeeRecord.permissions&&_employeeRecord.permissions.team);}
  catch(_e){return true;}
}
async function _ptrFetch(year){
  const out={rows:[],ok:false};
  if(typeof supaEnabled!=='function'||!supaEnabled()||!_supa||!_supaUser)return out;
  const cid=(typeof _contractorUserId!=='undefined'&&_contractorUserId)||_supaUser.id;
  const lo=year+'-01-01T00:00:00Z',hi=(year+1)+'-01-01T00:00:00Z';
  try{
    const[pRes,sRes]=await Promise.all([
      _supa.from('job_time_entries').select('employee_user_id,dest_place,minutes,arrived_at,departed_at').is('deleted_at',null)
        .eq('contractor_user_id',cid).eq('source','place').gte('arrived_at',lo).lt('arrived_at',hi),
      _supa.from('shop_time_entries').select('employee_user_id,minutes,arrived_at,departed_at').is('deleted_at',null)
        .eq('contractor_user_id',cid).gte('arrived_at',lo).lt('arrived_at',hi),
    ]);
    ((pRes&&pRes.data)||[]).forEach(r=>{if(r.dest_place)out.rows.push({place:r.dest_place,uid:r.employee_user_id||'',mins:r.minutes||0,arrivedAt:r.arrived_at,departedAt:r.departed_at,date:_ptrDateKey(r.arrived_at)});});
    ((sRes&&sRes.data)||[]).forEach(r=>{out.rows.push({place:_PTR_SHOP_KEY,uid:r.employee_user_id||'',mins:r.minutes||0,arrivedAt:r.arrived_at,departedAt:r.departed_at,date:_ptrDateKey(r.arrived_at)});});
    out.ok=true;
  }catch(_e){}
  return out;
}
// Local calendar day the visit happened on, the same rule every other date
// key in this app follows (never a UTC slice, which lands a late-evening
// Central visit on tomorrow).
function _ptrDateKey(iso){
  try{const d=new Date(iso);return isNaN(d.getTime())?'':(typeof dateKey==='function'?dateKey(d):String(iso).slice(0,10));}
  catch(_e){return String(iso||'').slice(0,10);}
}
function _ptrDur(mins){
  return (typeof _dispatchDur==='function')?_dispatchDur(mins):(Math.round((mins||0)/6)/10)+'h';
}
function _ptrClk(iso){
  try{const d=new Date(iso);return isNaN(d.getTime())?'':d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}).replace(/\s/g,'').replace('AM','a').replace('PM','p');}
  catch(_e){return'';}
}
// One visit's row inside a day-accordion body (bodyFn for _bkRenderDays).
function _ptrVisitRows(dayRows){
  return dayRows.slice().sort((a,b)=>String(a.arrivedAt||'').localeCompare(b.arrivedAt||'')).map(r=>{
    const nm=(typeof _crewMemberName==='function'&&_crewMemberName(r.uid))||'Crew member';
    const clk=r.arrivedAt&&r.departedAt?_ptrClk(r.arrivedAt)+'–'+_ptrClk(r.departedAt):'';
    return '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding:6px 0;border-top:1px dashed var(--border)">'+
      '<span style="font-size:12px;font-weight:600;color:var(--text2)">'+escHtml(nm)+'</span>'+
      '<span style="font-size:11px;color:var(--text3);font-variant-numeric:tabular-nums;white-space:nowrap">'+(clk?clk+' · ':'')+_ptrDur(r.mins)+'</span>'+
    '</div>';
  }).join('');
}
function _ptrSetYear(y){_ptrYear=y;renderPlaceTimeReport();}
function _ptrToggle(i){
  const k=_ptrKeys[i];
  if(k==null)return;
  _ptrOpen[k]=!_ptrOpen[k];
  renderPlaceTimeReport();
}
function renderPlaceTimeReport(){
  const el=document.getElementById('place-time-report');
  if(!el)return;
  if(!_ptrCanView()){el.innerHTML='';return;}
  const yr=_ptrYear||new Date().getFullYear();
  const hit=_ptrCache[yr];
  if(hit&&(Date.now()-hit.t)<20000){_ptrPaint(el,yr,hit);return;}
  if(!hit)el.innerHTML='<div class="card"><div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:6px">Time at places</div><div style="font-size:12px;color:var(--text3)">Loading tracked hours…</div></div>';
  else _ptrPaint(el,yr,hit); // stale cache paints instantly, refresh lands behind it
  if(_ptrBusy)return;
  _ptrBusy=true;
  _ptrFetch(yr).then(res=>{
    _ptrBusy=false;
    _ptrCache[yr]={t:Date.now(),rows:res.rows,ok:res.ok};
    const cur=document.getElementById('place-time-report');
    if(cur)_ptrPaint(cur,_ptrYear||new Date().getFullYear(),_ptrCache[yr]);
  }).catch(()=>{_ptrBusy=false;});
}
function _ptrPaint(el,yr,data){
  const now=new Date().getFullYear();
  const yearOpts=[now,now-1,now-2].map(y=>'<option value="'+y+'"'+(y===yr?' selected':'')+'>'+y+'</option>').join('');
  const head='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">'+
    '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--text3)">Time at places</div>'+
    '<select onchange="_ptrSetYear(parseInt(this.value))" style="font-size:12px;font-weight:700;padding:5px 9px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);font-family:inherit">'+yearOpts+'</select>'+
  '</div>'+
  '<div style="font-size:11px;color:var(--text3);line-height:1.5;margin-bottom:10px">Verified hours from geofence arrivals and departures, by place. Tap a place for the per-person split, by month and day, oldest to newest.</div>';
  const rows=(data&&data.rows)||[];
  if(!rows.length){
    el.innerHTML='<div class="card">'+head+'<div style="font-size:12px;color:var(--text3);padding:2px 0 4px">No tracked time for '+yr+' yet. Hours land here automatically once geofenced arrivals and departures are logged.</div></div>';
    return;
  }
  const buckets={};
  const people=new Set();
  let totalMins=0;
  rows.forEach(r=>{
    const b=buckets[r.place]||(buckets[r.place]={mins:0,visits:0,people:{},rows:[]});
    b.mins+=r.mins;b.visits++;totalMins+=r.mins;
    b.people[r.uid]=(b.people[r.uid]||0)+r.mins;
    b.rows.push(r);
    if(r.uid)people.add(r.uid);
  });
  _ptrKeys=Object.keys(buckets).sort((a,b)=>buckets[b].mins-buckets[a].mins);
  const stat=(v,l)=>'<div style="flex:1;background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:10px 12px">'+
    '<div style="font-size:20px;font-weight:800;color:var(--text)">'+v+'</div>'+
    '<div style="font-size:10.5px;color:var(--text3);font-weight:700;text-transform:uppercase;letter-spacing:.04em">'+l+'</div></div>';
  const body=_ptrKeys.map((k,i)=>{
    const b=buckets[k];
    const isShop=k===_PTR_SHOP_KEY;
    const label=isShop?'Shop':k;
    const saved=isShop?null:(places||[]).find(p=>p.name===k);
    const icon=isShop?'🏠':(_PLACE_KIND_ICON[saved&&saved.kind]||'📍');
    const open=!!_ptrOpen[k];
    const ppl=Object.keys(b.people).sort((a,b2)=>b.people[b2]-b.people[a]).map(uid=>{
      const nm=(typeof _crewMemberName==='function'&&_crewMemberName(uid))||'Crew member';
      return '<div style="display:flex;justify-content:space-between;padding:7px 0 7px 34px;font-size:12.5px;border-top:1px dashed var(--border)">'+
        '<span style="color:var(--text2);font-weight:600">'+escHtml(nm)+'</span>'+
        '<span style="font-weight:700;color:var(--text)">'+_ptrDur(b.people[uid])+'</span></div>';
    }).join('');
    // Month → day breakdown, oldest to newest (owner call, 2026-08-07),
    // reusing the SAME month/day accordion Income/Expenses/Time log use
    // (_bkMonthAcc/_bkRenderDays), just with opts.asc for the one place that
    // wants chronological-forward instead of newest-first.
    const byMonth={};
    b.rows.forEach(r=>{const mo=(r.date||'').slice(0,7)||'unknown';(byMonth[mo]||(byMonth[mo]=[])).push(r);});
    const tabId='ptr'+i;
    const monthsHtml=Object.keys(byMonth).sort((a,b2)=>a.localeCompare(b2)).map(mo=>{
      const moRows=byMonth[mo];
      const moMins=moRows.reduce((s,r)=>s+(r.mins||0),0);
      const inner=(typeof _bkRenderDays==='function')?_bkRenderDays(tabId,mo,moRows,[],null,0,'var(--text3)',r=>r.mins||0,_ptrDur,{asc:true,bodyFn:_ptrVisitRows}):'';
      return (typeof _bkMonthAcc==='function')?_bkMonthAcc(tabId,mo,_bkMonthLabel(mo),moRows.length+' visit'+(moRows.length!==1?'s':''),'<span style="font-weight:800;color:var(--text)">'+_ptrDur(moMins)+'</span>',inner,false):'';
    }).join('');
    return '<div style="border:1px solid var(--border);border-radius:12px;margin-bottom:8px;overflow:hidden;background:var(--bg2)">'+
      '<div onclick="_ptrToggle('+i+')" style="display:flex;align-items:center;gap:10px;padding:11px 12px;cursor:pointer">'+
        '<span style="width:28px;height:28px;border-radius:8px;background:var(--bg);display:flex;align-items:center;justify-content:center;flex-shrink:0">'+svgIcon(icon,{size:16})+'</span>'+
        '<span style="flex:1;min-width:0">'+
          '<span style="display:block;font-size:13.5px;font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml(label)+'</span>'+
          '<span style="display:block;font-size:11px;color:var(--text3);margin-top:1px">'+b.visits+' visit'+(b.visits!==1?'s':'')+'</span>'+
        '</span>'+
        '<span style="font-size:15px;font-weight:800;color:var(--text);white-space:nowrap">'+_ptrDur(b.mins)+'</span>'+
        '<span style="color:var(--text3);display:inline-flex;transform:rotate('+(open?180:0)+'deg);transition:transform .15s"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span>'+
      '</div>'+
      (open?'<div class="td-acc-body td-acc-in"><div class="td-acc-inner" style="padding:0 12px 10px">'+ppl+
        '<div style="margin-top:10px">'+monthsHtml+'</div>'+
      '</div></div>':'')+
    '</div>';
  }).join('');
  el.innerHTML='<div class="card">'+head+
    '<div style="display:flex;gap:8px;margin-bottom:12px">'+
      stat(_ptrDur(totalMins),'Total '+yr)+
      (function(){const pc=people.size||1;return stat(String(pc),pc===1?'Person tracked':'People tracked');})()+
    '</div>'+body+'</div>';
}

// Live toggle for the Type field: the home-office tax disclaimer is only
// relevant to that one kind, so it shows and hides as the picker changes
// rather than sitting under every type regardless of what's selected.
function _placeKindChanged(kind){
  const note=document.getElementById('place-ho-note');
  if(note)note.style.display=(kind==='home_office')?'block':'none';
  // The picker opens on a greyed placeholder, so it paints muted until a real
  // type is chosen and normal text once one is. Same --text3 the hints beside
  // it use, never a hardcoded grey.
  const sel=document.getElementById('place-kind');
  if(sel)sel.style.color=kind?'var(--text)':'var(--text3)';
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
  // Nothing is pre-picked (owner 2026-08-31: "dont want to pre fill things in").
  // Type used to open ON Supply house, so a shop, a home office and a supplier
  // all saved as a supply house unless the contractor noticed the picker and
  // changed it. A wrong kind is not cosmetic: it decides how that stop's trips
  // deduct and which bucket the mileage report puts them in (_autoTripPurpose).
  // It opens on a greyed placeholder instead, and Save refuses until a real
  // type is chosen (_savePlaceFromModal). An EDIT still opens on the saved
  // kind, the placeholder is only ever the state of a place with no type yet.
  const _plKind=(pl&&PLACE_KINDS[pl.kind])?pl.kind:'';
  const kindOpts='<option value="" disabled'+(_plKind?'':' selected')+'>Choose a type</option>'+
    Object.keys(PLACE_KINDS).map(k=>
      '<option value="'+k+'"'+(_plKind===k?' selected':'')+'>'+PLACE_KINDS[k]+'</option>').join('');
  // Centred on the shared .zmodal chrome, like every other prompt in this flow
  // (owner call 2026-08-01). It was the last bottom sheet left in Places, so
  // naming a location slid up from the bottom while the truck and vehicle
  // prompts it sits beside appear in the middle.
  // Name field: shown UP FRONT only when there's already something to name (an
  // edit, or a promoted repeat-stop that already carries coordinates, both of
  // which also get a POI reverse-lookup below to fill it for free). A brand-new
  // pinless place has nothing to type a name INTO yet, searching is the only
  // useful first move, so the search box leads and the name comes over with
  // whichever result gets picked (_placePickAddr), no separate typing required.
  const nameFieldHtml=
    '<div class="f" style="margin-bottom:12px"><label>Name</label>'+
      '<input id="place-name" placeholder="Ferguson Plumbing" value="'+escHtml(pl?pl.name||'':'')+'" style="font-size:15px;padding:11px;border-radius:9px;border:1.5px solid var(--border2);background:var(--bg2);color:var(--text);width:100%;box-sizing:border-box"></div>';
  const searchFieldHtml=
    '<div class="f" style="margin-bottom:12px;position:relative"><label>Search</label>'+
      '<input id="place-addr" placeholder="Business name or address" autocomplete="off" oninput="_placeAddrSearch(this.value)" style="font-size:15px;padding:11px;border-radius:9px;border:1.5px solid var(--border2);background:var(--bg2);color:var(--text);width:100%;box-sizing:border-box">'+
      '<div id="place-addr-sugg" style="display:none;position:absolute;left:0;right:0;top:100%;z-index:30;background:var(--bg);border:1px solid var(--border2);border-radius:9px;margin-top:4px;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,.14)"></div>'+
    '</div>';
  ov.innerHTML='<div class="zmodal">'+
    '<div class="zmodal-title" style="text-align:center">'+(pl?'Edit location':'Add a location')+'</div>'+
    (_lat==null?searchFieldHtml:nameFieldHtml)+
    '<div class="f" style="margin-bottom:12px"><label>Type</label>'+
      '<select id="place-kind" onchange="_placeKindChanged(this.value)" style="font-size:15px;padding:11px;border-radius:9px;border:1.5px solid var(--border2);background:var(--bg2);color:'+(_plKind?'var(--text)':'var(--text3)')+';width:100%;box-sizing:border-box">'+kindOpts+'</select></div>'+
    // A home office changes whether the first trip of the day is deductible, so
    // it is stated plainly rather than buried as a dropdown value, but only
    // when that is actually the type picked: every other kind got a home-
    // office tax disclaimer nobody asked for.
    '<div id="place-ho-note" style="font-size:10px;color:var(--text3);line-height:1.5;margin-bottom:14px;display:'+(_plKind==='home_office'?'block':'none')+'">Mark somewhere as a Home office only if it qualifies as your principal place of business. It changes whether your first trip of the day is deductible, so check with your CPA.</div>'+
    '<input type="hidden" id="place-lat" value="'+(_lat!=null?_lat:'')+'"><input type="hidden" id="place-lon" value="'+(_lon!=null?_lon:'')+'">'+
    (_lat!=null
      // Raw lat/lon means nothing to a contractor, the address (when there is
      // one) or a plain confirmation is what actually tells them where this is.
      ? '<div id="place-pin-note" style="font-size:11px;color:var(--text3);margin-bottom:14px">'+svgIcon('📍',{size:11})+' '+escHtml((pl&&pl.addr)||'Location pinned')+'</div>'
      // No pin yet: the name field is BELOW the search on purpose, it fills in
      // once a result is picked and stays editable if the contractor wants
      // something other than the business's official name (e.g. "The Yard").
      : nameFieldHtml.replace('placeholder="Ferguson Plumbing"','placeholder="Fills in once you pick a result above"')+
        '<div id="place-pin-note" style="font-size:11px;color:var(--text3);margin-bottom:14px">Search a name or address above to drop the pin.</div>')+
    '<button onclick="_savePlaceFromModal('+(pl?"'"+pl.id+"'":'null')+')" style="width:100%;padding:14px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:8px">Save</button>'+
    (pl?'<button onclick="_deletePlaceFromModal(\''+pl.id+'\')" style="width:100%;padding:11px;border-radius:var(--r);border:none;background:none;color:#A32D2D;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">Delete</button>':'')+
  '</div>';
  document.body.appendChild(ov);
  setTimeout(()=>document.getElementById(_lat==null?'place-addr':'place-name')?.focus(),80);
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
      // The name only. This used to stamp the Type too, via _poiPlaceKind,
      // which returns 'supply' for everything that is not a restaurant, so
      // promoting a repeat stop pre-filled Supply house exactly the way the
      // static default did. A category guess is not the contractor telling us
      // what a place is, and that is the one thing this picker asks for.
    }).catch(()=>{});
  }
}
// The address search behind a pinless Add. Debounced like every other address
// field in the app, with a generation counter so a slow geocode can never paint
// its answers over a newer keystroke's. Results are stashed by index because the
// labels carry apostrophes and quotes (O'Reilly's) that must never be rebuilt
// from an onclick attribute string.
let _placeAddrTimer=null,_placeAddrGen=0,_placeAddrResults=[];
function _placeAddrSearch(val){
  clearTimeout(_placeAddrTimer);
  const box=document.getElementById('place-addr-sugg');if(!box)return;
  val=String(val||'').trim();
  if(val.length<3){box.style.display='none';box.innerHTML='';return;}
  _placeAddrTimer=setTimeout(async()=>{
    const gen=++_placeAddrGen;
    let results=[];
    try{if(typeof _geocodeAddress==='function')results=await _geocodeAddress(val,5);}catch(_e){results=[];}
    if(gen!==_placeAddrGen)return;                       // a newer keystroke owns the box
    const b=document.getElementById('place-addr-sugg');
    if(!b)return;                                        // modal closed mid-flight
    _placeAddrResults=results.filter(r=>r&&isFinite(r.lat)&&isFinite(r.lon));
    if(!_placeAddrResults.length){b.style.display='none';b.innerHTML='';return;}
    b.innerHTML=_placeAddrResults.map((r,i)=>{
      const main=escHtml(r.name||r.line1||'');
      const sub=escHtml([r.name?r.line1:'',r.line2].filter(Boolean).join(', '));
      return '<button type="button" onclick="_placePickAddr('+i+')" style="display:block;width:100%;text-align:left;padding:10px 12px;border:none;border-bottom:1px solid var(--border);background:none;cursor:pointer;font-family:inherit">'+
        '<div style="font-size:13px;font-weight:700;color:var(--text)">'+main+'</div>'+
        (sub?'<div style="font-size:11px;color:var(--text3);margin-top:1px">'+sub+'</div>':'')+
      '</button>';
    }).join('');
    b.style.display='block';
  },280);
}
function _placePickAddr(i){
  const r=(_placeAddrResults||[])[i];
  if(!r||!isFinite(r.lat)||!isFinite(r.lon))return;
  const latEl=document.getElementById('place-lat'),lonEl=document.getElementById('place-lon');
  if(latEl)latEl.value=r.lat;if(lonEl)lonEl.value=r.lon;
  const addrEl=document.getElementById('place-addr');
  if(addrEl)addrEl.value=[r.line1,r.line2].filter(Boolean).join(', ')||r.name||addrEl.value;
  // The picked business name fills an empty Name field, and only an empty one:
  // the contractor's own word for their supplier always wins.
  const n=document.getElementById('place-name');
  if(n&&!n.value.trim()&&r.name)n.value=r.name;
  // The address just landed in place-addr above, reuse it: it's what the
  // contractor searched for and recognises, raw lat/lon means nothing to them.
  const note=document.getElementById('place-pin-note');
  if(note)note.innerHTML=svgIcon('📍',{size:11})+' '+escHtml((addrEl&&addrEl.value)||'Location pinned');
  const box=document.getElementById('place-addr-sugg');
  if(box){box.style.display='none';box.innerHTML='';}
}
function _savePlaceFromModal(id){
  const name=(document.getElementById('place-name')?.value||'').trim();
  const kind=document.getElementById('place-kind')?.value||'';
  const lat=parseFloat(document.getElementById('place-lat')?.value);
  const lon=parseFloat(document.getElementById('place-lon')?.value);
  const addr=(document.getElementById('place-addr')?.value||'').trim();
  if(!name){showToast('Give it a name','⚠️');return;}
  if(!kind){showToast('Pick a type','⚠️');return;}
  if(!isFinite(lat)||!isFinite(lon)){showToast('Search the address to drop the pin first','⚠️');return;}
  savePlace({id:id||undefined,name,kind,lat,lon,addr:addr||undefined,confirmedBy:id?undefined:'manual'});
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
