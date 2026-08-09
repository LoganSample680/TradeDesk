// ── Drive: turn-by-turn to the next stop, inside TradeDesk ───────────────────
//
// THE ASK (owner, 2026-08-09): "I wanted to see drive where you actually do gps
// navigation embedded directly in TradeDesk", on native MapKit, using Apple
// Maps.
//
// WHY IT IS POSSIBLE. Apple hands navigation off to the Maps app for apps that
// do not have their own: "if your app doesn't have its own turn-by-turn
// navigation services, you can ask Maps to provide the information for you"
// (Apple's Location Awareness guide). MKDirections returns the route polyline,
// the expected travel time, and MKRoute.Step objects whose `instructions` are
// the real turn text. There are no per-app request limits, and registering as a
// routing app is only needed to publish directions to OTHER apps. So the route
// and its turns come from Apple; the experience around them is ours.
//
// WHY IT IS WORTH BUILDING RATHER THAN HANDING OFF. Every competitor bounces
// the crew into Apple Maps or Waze, and that is where a field CRM loses the
// drive: it cannot see the route, so it does not know the ETA, does not know
// when the truck arrived, and the tech has to come back and tell it. Keeping
// the drive here means the app knows all three. Arrival ends the drive and
// opens the job the crew just drove to, and the customer's ETA text is one tap
// with a real number in it (driveTextEta) instead of a guess typed at a light.
//
// EVERY DECISION LIVES HERE (CLAUDE.md 3.2). The plugin renders, follows and
// reports at about 1Hz. This file decides what counts as off route, when to
// announce a turn, when the truck has arrived, and what the customer is told.
// All of it is tunable with a UAT roll, never another 15-minute macOS build.
//
// OUTSIDE THE SHELL. A browser has no plugin and no business pretending to
// navigate. It falls back to the handoff the app has always had, an Apple Maps
// link with the destination filled in, which is what the competition does on
// every platform.

const _DRIVE_ARRIVE_M = 90;        // inside this of the destination, the drive is done
const _DRIVE_OFFROUTE_M = 60;      // this far off the line for _DRIVE_OFFROUTE_HITS fixes
const _DRIVE_OFFROUTE_HITS = 3;    // never on one fix: a bad urban fix is not a wrong turn

let _driveActive = null;           // {jobId,label,destLat,destLng,startedAt,arrived}
let _driveSpokenStep = -1;         // last step index announced
let _driveSpokenNear = -1;         // last step announced at close range
let _driveOffCount = 0;
let _driveBound = false;

function _drivePlugin(){
  try{
    const cap=window.Capacitor;
    if(!cap||typeof cap.isNativePlatform!=='function'||!cap.isNativePlatform())return null;
    if(typeof cap.registerPlugin==='function')return cap.registerPlugin('TdNav');
    return (cap.Plugins&&cap.Plugins.TdNav)||null;
  }catch(_e){return null;}
}
function driveCapable(){ return !!_drivePlugin(); }

function _driveMiles(m){ return (m||0)/1609.34; }
function _driveFeet(m){ return (m||0)*3.28084; }

// What the voice says, and when. Two announcements per turn is what Apple and
// Waze both settled on: one with enough warning to change lanes, one at the
// turn itself. More than that and a driver stops listening.
function _driveShouldAnnounce(p){
  const idx=p.stepIndex,ft=_driveFeet(p.stepMeters);
  if(idx==null||!p.stepText)return null;
  if(idx!==_driveSpokenStep&&ft>800&&ft<2600){
    _driveSpokenStep=idx;
    return 'In '+Math.round(ft/100)*100+' feet, '+p.stepText;
  }
  if(idx!==_driveSpokenNear&&ft<=350){
    _driveSpokenNear=idx;
    if(_driveSpokenStep<idx)_driveSpokenStep=idx;
    return p.stepText;
  }
  return null;
}

async function _driveSay(text){
  const Nav=_drivePlugin();
  if(!Nav||!text)return;
  try{ await Nav.speak({text}); }catch(_e){}
}

// Off route is deliberately slow to trigger. A single fix bouncing off a
// building beside a route is normal; three in a row 60m off the line is a
// wrong turn, and only then do we spend a Directions call rebuilding.
function _driveCheckOffRoute(p){
  if(p.offRouteMeters==null)return;
  if(p.offRouteMeters>_DRIVE_OFFROUTE_M){
    _driveOffCount++;
    if(_driveOffCount>=_DRIVE_OFFROUTE_HITS){
      _driveOffCount=0;
      _driveSpokenStep=-1;_driveSpokenNear=-1;
      _driveSay('Rerouting');
      const Nav=_drivePlugin();
      try{ if(Nav)Nav.recalculate({}); }catch(_e){}
    }
  }else _driveOffCount=0;
}

// ── Telling the customer ─────────────────────────────────────────────────────
// Its own button, deliberately NOT something the drive fires by itself. Until
// TradeDesk owns the messaging layer (CLAUDE.md 9.4) the only way to send a
// text is an sms: link, which opens Messages and leaves the app. Doing that
// automatically mid-route would yank a driving contractor out of navigation, so
// this is one tap, taken while parked, before pulling away.
//
// The ETA is real: the same route calculation the mileage log uses, so the time
// the customer is given is the time Apple actually expects.
//
// When the messaging layer lands, this becomes the automatic version and the
// button goes away. Not before.
async function driveTextEta(jobId){
  const job=(typeof jobs!=='undefined')?jobs.find(j=>String(j.id)===String(jobId)):null;
  if(!job)return;
  const cl=(typeof clients!=='undefined')?clients.find(c=>c.id===job.client_id):null;
  const phone=String((cl&&cl.phone)||'').replace(/\D/g,'');
  if(!phone){if(typeof showToast==='function')showToast('No phone number on this client','⚠');return;}
  const first=String((cl&&cl.name)||'').split(' ')[0]||'there';
  const biz=(typeof S!=='undefined'&&S.bname)||'your contractor';
  let when='';
  try{
    const dest=await _driveDestCoords(job,cl);
    const here=await _driveHere();
    if(dest&&here&&typeof _routeDistance==='function'){
      const r=await _routeDistance(here,dest);
      if(r&&r.mins){
        const at=new Date(Date.now()+r.mins*60000);
        const hh=at.getHours()%12||12,mm=String(at.getMinutes()).padStart(2,'0');
        when=', arriving about '+hh+':'+mm+(at.getHours()<12?' am':' pm');
      }
    }
  }catch(_e){}
  const msg='Hi '+first+', '+biz+' is on the way'+when+'.';
  window.location.href='sms:'+phone+'&body='+encodeURIComponent(msg);
}

function _driveHere(){
  return new Promise(res=>{
    if(!navigator.geolocation){res(null);return;}
    try{
      navigator.geolocation.getCurrentPosition(
        p=>res({lat:p.coords.latitude,lng:p.coords.longitude}),
        ()=>res(null),{enableHighAccuracy:false,maximumAge:120000,timeout:8000});
    }catch(_e){res(null);}
  });
}

// The stop's coordinates, geocoded once and kept on the record. Same cache the
// route optimizer and the day map fill, so a second drive to the same site
// costs nothing.
async function _driveDestCoords(job,cl){
  if(job.lat!=null&&job.lon!=null)return{lat:job.lat,lng:job.lon};
  const addr=job.addr||(cl&&cl.addr)||'';
  if(!addr||typeof _resolveCoords!=='function')return null;
  try{
    const r=await _resolveCoords(addr);
    if(r&&r.lat){job.lat=r.lat;job.lon=r.lng;if(typeof saveAll==='function')saveAll();return{lat:r.lat,lng:r.lng};}
  }catch(_e){}
  return null;
}

function _driveOnEvent(ev){
  if(!ev||!_driveActive)return;
  if(ev.type==='progress'){
    _driveCheckOffRoute(ev);
    const line=_driveShouldAnnounce(ev);
    if(line)_driveSay(line);
    if(ev.toDestinationMeters!=null&&ev.toDestinationMeters<=_DRIVE_ARRIVE_M)_driveArrive();
    return;
  }
  if(ev.type==='route'){
    _driveSpokenStep=-1;_driveSpokenNear=-1;_driveOffCount=0;
    const mins=Math.round((ev.seconds||0)/60);
    if(mins&&typeof showToast==='function')showToast(mins+' min · '+_driveMiles(ev.meters).toFixed(1)+' mi','🚚');
    return;
  }
  if(ev.type==='cancelled'){_driveEnd(false);return;}
  if(ev.type==='error'){
    if(typeof showToast==='function')showToast('Could not build a route. Check the address.','⚠');
    _driveEnd(false);
    return;
  }
}

function _driveBindEvents(){
  if(_driveBound)return;
  const Nav=_drivePlugin();
  if(!Nav||typeof Nav.addListener!=='function')return;
  _driveBound=true;
  try{ Nav.addListener('navEvent',(ev)=>{try{_driveOnEvent(ev);}catch(_e){}}); }catch(_e){}
}

// Arrival. The geofence already logs the site time and the mileage, so this
// does not duplicate either: it says the drive is over, closes the screen, and
// puts the crew on the job they just drove to.
function _driveArrive(){
  if(!_driveActive||_driveActive.arrived)return;
  _driveActive.arrived=true;
  _driveSay('Arriving at '+(_driveActive.label||'your stop'));
  const jobId=_driveActive.jobId;
  _driveEnd(true);
  if(typeof showToast==='function')showToast('Arrived','📍');
  if(jobId&&typeof openJobDetail==='function'){setTimeout(()=>{try{openJobDetail(jobId);}catch(_e){}},400);}
}

function _driveEnd(arrived){
  const Nav=_drivePlugin();
  try{ if(Nav)Nav.stop(); }catch(_e){}
  _driveActive=null;_driveSpokenStep=-1;_driveSpokenNear=-1;_driveOffCount=0;
  if(!arrived&&typeof showToast==='function')showToast('Drive ended','🚚');
}

// ── Start a drive ────────────────────────────────────────────────────────────
// Takes a job or estimate appointment id. Geocodes the address once and caches
// it on the record, exactly like the route optimizer and the day map already
// do, so the second drive to the same site costs nothing.
async function startDrive(jobId){
  const job=(typeof jobs!=='undefined')?jobs.find(j=>String(j.id)===String(jobId)):null;
  if(!job){if(typeof showToast==='function')showToast('That job is gone','⚠');return;}
  const cl=(typeof clients!=='undefined')?clients.find(c=>c.id===job.client_id):null;
  const dest=await _driveDestCoords(job,cl);
  const label=(cl&&cl.name)||job.name||'Your stop';
  if(!dest){
    if(typeof showToast==='function')showToast('No address on this job yet','⚠');
    return;
  }
  const lat=dest.lat,lng=dest.lng;
  const Nav=_drivePlugin();
  if(!Nav){
    // Browser or PWA: no plugin, so hand off rather than fake it.
    window.open('https://maps.apple.com/?daddr='+lat+','+lng,'_blank');
    return;
  }
  _driveBindEvents();
  _driveActive={jobId:job.id,label,destLat:lat,destLng:lng,startedAt:Date.now(),arrived:false};
  _driveSpokenStep=-1;_driveSpokenNear=-1;_driveOffCount=0;
  try{
    await Nav.start({lat,lng,label});
  }catch(_e){
    _driveActive=null;
    window.open('https://maps.apple.com/?daddr='+lat+','+lng,'_blank');
  }
}

// The button. Reads "Drive" in the app and "Directions" in a browser, because
// those are two different promises and only one of them is ours to keep.
function driveButtonHtml(jobId,style){
  const label=driveCapable()?'Drive':'Directions';
  return '<button onclick="startDrive(\''+jobId+'\')" style="'+(style||'font-size:12px;font-weight:700;background:var(--blue-lt);color:var(--blue);border:1px solid var(--blue);border-radius:var(--r);padding:7px 12px;cursor:pointer;font-family:inherit')+'">'+
    svgIcon('🚚')+' '+label+'</button>';
}
