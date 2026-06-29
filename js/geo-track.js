// js/geo-track.js — Crew location tracking + geofence time-on-site.
//
// Consent model:
//   1. The contractor enables S.teamTracking in Settings (business-hours window
//      + geofence radius).
//   2. Employees are auto-enrolled — crew tracking is a mandatory condition of
//      using TradeDesk, so there is no separate in-app opt-in for employees.
//      (The browser/OS location-permission prompt is still shown on first run;
//      that is an OS gate and cannot be bypassed.) Owners tracking their OWN
//      time on jobs keep a one-time per-device opt-in.
// Tracking ONLY runs inside the business-hours window — never on personal time.
//
// Writes:
//   • location_pings    — throttled breadcrumb (lat/lon) for the live crew map
//   • job_time_entries  — arrival→departure durations per job (feeds Job Profit)
// All manager-side reads of this data are RLS-gated server-side (has_team_perm).
//
// Every entry point is wrapped so a geolocation/permission hiccup never throws a
// console error (CLAUDE.md console-error policy).

let _geoWatchId=null;
let _geoCurrentJob=null;   // job id the employee is currently inside the fence of
let _geoArrivedAt=null;    // ISO arrival timestamp for the open entry
let _geoLastPingTs=0;      // throttle for location_pings inserts
let _geoHoursTimer=null;   // periodic end-of-day / out-of-hours watcher
let _geoJobCoords={};      // jobId -> {lat,lng} geocode cache (per session)
let _geoWasInShop=false;   // currently inside office/shop geofence
let _geoShopArrivedAt=null;// ISO timestamp of shop arrival
let _geoDriveStartedAt=null;// ISO timestamp when a drive leg began (leaving any fence)

// ── Business-hours window — device local time ─────────────────────────────────
// S.trackStart/End are set by the contractor as local times (e.g. "07:00").
// Employees work in the same market as the contractor, so the device's local
// clock is the correct reference — no hardcoded timezone.
function _geoNowMinLocal(){const d=new Date();return d.getHours()*60+d.getMinutes();}
function _geoParseHM(s){const m=/^(\d{1,2}):(\d{2})$/.exec(s||'');return m?(+m[1])*60+(+m[2]):null;}
function _geoBusinessHoursNow(){
  const st=_geoParseHM(S.trackStart||'07:00'), en=_geoParseHM(S.trackEnd||'18:00');
  if(st==null||en==null)return false;
  const now=_geoNowMinLocal();
  return en>st ? (now>=st&&now<en) : (now>=st||now<en); // en<=st ⇒ overnight window
}
// Hardcoded generous radius — big enough that GPS drift and street/driveway
// parking always register as "on site" without a per-business setting to tune.
// Not so big it catches a worker driving past or at the neighbor's (which would
// end the drive leg early and over-count on-site time).
function _geoFenceFt(){return 600;}
function _geoDistFt(a,b){return _haversineMiles(a,b)*5280;} // a,b = {lat,lng}

// Who owns the time rows this device writes. For an employee it's their
// contractor; for the owner working a job themselves, it's their own account.
function _geoCid(){ return _isEmployee ? _contractorUserId : (_supaUser && _supaUser.id); }

// ── Jobs this device should fence against today + their coordinates ─────────────
// Employees: only the jobs dispatched to them. Owner: any of today's active jobs,
// since the owner isn't dispatch-assigned but can be on any site.
function _geoMyJobs(){
  const tk=todayKey();
  if(_isEmployee){
    const eid=_employeeRecord?.id;
    return jobs.filter(j=>String(j.assignedTo)===String(eid)&&j.assignedDate===tk&&!j.cancelled&&j.status!=='done');
  }
  return jobs.filter(j=>{
    if(j.cancelled||j.status==='done'||j.completion_date)return false;
    const start=j.start||j.date||'';if(!start)return false;
    const end=addDays(start,(parseInt(j.days)||1)-1);
    return start<=tk&&end>=tk;
  });
}
async function _geoJobLatLng(j){
  if(_geoJobCoords[j.id])return _geoJobCoords[j.id];
  if(j.lat&&j.lon){const c={lat:j.lat,lng:j.lon};_geoJobCoords[j.id]=c;return c;}
  const c=clients.find(x=>x.id===j.client_id);
  const addr=j.addr||(c&&c.addr)||'';
  if(!addr||typeof _resolveCoords!=='function')return null;
  try{const r=await _resolveCoords(addr);if(r&&r.lat){_geoJobCoords[j.id]={lat:r.lat,lng:r.lng};return _geoJobCoords[j.id];}}catch(_e){}
  return null;
}

// ── Position handler: breadcrumb + geofence state machine ──────────────────────
async function _geoOnPing(pos){
  if(!_geoBusinessHoursNow()){stopGeoTracking();return;}
  const here={lat:pos.coords.latitude,lng:pos.coords.longitude};
  const acc=pos.coords.accuracy||0;
  // Throttled breadcrumb (~60s)
  const nowMs=Date.now();
  if(nowMs-_geoLastPingTs>60000){_geoLastPingTs=nowMs;_geoWritePing(here,acc);}
  // ── Shop / office fence ────────────────────────────────────────────────────
  const shopC=(S.officeLat&&S.officeLon)?{lat:S.officeLat,lng:S.officeLon}:null;
  const inShop=shopC?(_geoDistFt(here,shopC)<=_geoFenceFt()):false;
  if(inShop!==_geoWasInShop){
    if(inShop){
      _geoShopArrivedAt=new Date().toISOString();
      _geoDriveStartedAt=null; // arriving at shop ends any drive leg
    }else{
      if(_geoShopArrivedAt)_geoCloseShopEntry(_geoShopArrivedAt);
      _geoShopArrivedAt=null;
      // Only start drive clock if not already inside a job fence — otherwise
      // we'd set a stale driveStartedAt mid-job and log phantom drive minutes.
      if(!_geoCurrentJob)_geoDriveStartedAt=new Date().toISOString();
    }
    _geoWasInShop=inShop;
  }
  // ── Job fence state machine ────────────────────────────────────────────────
  let inside=null,bestFt=Infinity;
  for(const j of _geoMyJobs()){
    const c=await _geoJobLatLng(j);
    if(!c)continue;
    const ft=_geoDistFt(here,c);
    if(ft<=_geoFenceFt()&&ft<bestFt){inside=j;bestFt=ft;}
  }
  const insideId=inside?inside.id:null;
  if(insideId!==_geoCurrentJob){
    const prevJob=_geoCurrentJob;
    if(prevJob&&_geoArrivedAt)await _geoCloseEntry(prevJob); // left previous job
    if(prevJob&&!insideId)_geoDriveStartedAt=new Date().toISOString(); // leaving job → drive
    if(insideId){
      if(_geoDriveStartedAt)_geoDriveEntry(insideId,_geoDriveStartedAt); // log drive leg
      _geoDriveStartedAt=null;
      _geoCurrentJob=insideId;_geoArrivedAt=new Date().toISOString();
    }else{_geoCurrentJob=null;_geoArrivedAt=null;}
  }
}
function _geoWritePing(here,acc){
  if(!_supa||!_supaUser)return;
  try{
    _supa.from('location_pings').insert({
      contractor_user_id:_geoCid(),employee_user_id:_supaUser.id,
      lat:here.lat,lon:here.lng,accuracy:acc,
      job_id:_geoCurrentJob?String(_geoCurrentJob):null,ts:new Date().toISOString()
    }).then(()=>{},()=>{});
  }catch(_e){}
}
async function _geoCloseEntry(jobId){
  const arrived=_geoArrivedAt; _geoArrivedAt=null;
  if(!arrived)return;
  const departed=new Date().toISOString();
  const mins=Math.max(0,Math.round((Date.parse(departed)-Date.parse(arrived))/60000));
  if(mins<2)return;            // ignore brief pass-throughs
  if(!_supa||!_supaUser)return;
  try{
    await _supa.from('job_time_entries').insert({
      contractor_user_id:_geoCid(),employee_user_id:_supaUser.id,
      job_id:String(jobId),arrived_at:arrived,departed_at:departed,minutes:mins,source:'geofence'
    });
  }catch(_e){}
}
function _geoCloseShopEntry(arrivedAt){
  if(!arrivedAt)return;
  const departed=new Date().toISOString();
  const mins=Math.max(0,Math.round((Date.parse(departed)-Date.parse(arrivedAt))/60000));
  if(mins<2)return;
  if(!_supa||!_supaUser)return;
  try{
    _supa.from('shop_time_entries').insert({
      contractor_user_id:_geoCid(),employee_user_id:_supaUser.id,
      arrived_at:arrivedAt,departed_at:departed,minutes:mins
    }).then(()=>{},()=>{});
  }catch(_e){}
}
function _geoDriveEntry(jobId,driveStartedAt){
  if(!driveStartedAt)return;
  const arrived=new Date().toISOString();
  const mins=Math.max(0,Math.round((Date.parse(arrived)-Date.parse(driveStartedAt))/60000));
  if(mins<2)return;
  if(!_supa||!_supaUser)return;
  // Only flag for mileage when employee is in a company vehicle for this shift.
  // Personal vehicle trips stay private — drive TIME is still logged (it's
  // compensable labor) but the mileage flag is omitted.
  const companyVeh=typeof _isCompanyVehicleToday==='function'&&_isCompanyVehicleToday();
  try{
    _supa.from('job_time_entries').insert({
      contractor_user_id:_geoCid(),employee_user_id:_supaUser.id,
      job_id:String(jobId),arrived_at:driveStartedAt,departed_at:arrived,minutes:mins,
      source:companyVeh?'drive':'drive-personal'
    }).then(()=>{},()=>{});
  }catch(_e){}
}

// ── Location-permission banner (employee self-service) ──────────────────────
// Shown ONLY when an employee's device location is not granted, so they can fix
// it themselves — the owner never has to chase anyone about enabling it. Nothing
// renders when permission is fine.
async function _geoPermissionBanner(){
  const el=document.getElementById('dash-geo-perm');
  if(!el)return;
  if(!_isEmployee||!S.teamTracking){el.style.display='none';return;}
  let state='prompt';
  try{
    if(navigator.permissions&&navigator.permissions.query){
      const p=await navigator.permissions.query({name:'geolocation'});state=p.state;
      // Re-render live if the employee flips the setting while the app is open
      if(!p._tdBound){p._tdBound=true;p.onchange=()=>_geoPermissionBanner();}
    }
  }catch(_e){}
  if(state==='granted'){el.style.display='none';return;}
  const denied=state==='denied';
  el.style.display='block';
  el.innerHTML='<div style="background:#FEF2F2;border:1px solid #FCA5A5;border-radius:var(--r);padding:12px 14px;margin-bottom:12px">'+
    '<div style="font-size:13px;font-weight:800;color:#991B1B;margin-bottom:4px">📍 Location is off</div>'+
    '<div style="font-size:12px;color:#991B1B;line-height:1.5;margin-bottom:'+(denied?'0':'10px')+'">'+
      'TradeDesk logs your drive time and job hours automatically during work hours — it only works with location on. '+
      (denied
        ?'Turn it back on in your phone: <strong>Settings → TradeDesk → Location → While Using the App</strong>.'
        :'Tap below and choose <strong>Allow While Using</strong>.')+
    '</div>'+
    (denied?'':'<button onclick="_geoRequestPermission()" style="width:100%;padding:11px;border-radius:var(--r);border:none;background:#DC2626;color:#fff;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;min-height:44px">Turn on location</button>')+
  '</div>';
}
function _geoRequestPermission(){
  // Triggers the OS prompt when state is 'prompt'. (When already 'denied' the OS
  // won't re-prompt — the banner tells them to use Settings instead.)
  startGeoTracking();
  setTimeout(_geoPermissionBanner,1500);
}

// ── Start / stop ───────────────────────────────────────────────────────────────
function startGeoTracking(){
  if(_geoWatchId!=null)return;
  if(!navigator.geolocation||!_geoBusinessHoursNow())return;
  try{
    _geoWatchId=navigator.geolocation.watchPosition(_geoOnPing,()=>{},{enableHighAccuracy:true,maximumAge:30000,timeout:20000});
  }catch(_e){}
  if(!_geoHoursTimer)_geoHoursTimer=setInterval(()=>{if(!_geoBusinessHoursNow())stopGeoTracking();},5*60000);
}
function stopGeoTracking(){
  if(_geoWatchId!=null){try{navigator.geolocation.clearWatch(_geoWatchId);}catch(_e){}_geoWatchId=null;}
  if(_geoCurrentJob&&_geoArrivedAt)_geoCloseEntry(_geoCurrentJob);
  if(_geoWasInShop&&_geoShopArrivedAt)_geoCloseShopEntry(_geoShopArrivedAt);
  _geoCurrentJob=null;_geoArrivedAt=null;
  _geoWasInShop=false;_geoShopArrivedAt=null;_geoDriveStartedAt=null;
  if(_geoHoursTimer){clearInterval(_geoHoursTimer);_geoHoursTimer=null;}
}

// ── Init + two-layer consent ───────────────────────────────────────────────────
function _geoTrackInit(){
  if(!S.teamTracking)return;                 // tracking not enabled for the company
  if(!_supaUser)return;
  if(!_geoBusinessHoursNow())return;         // outside hours — nothing to do
  // Finalize the open entry if the app is backgrounded mid-shift
  if(!window._geoVisBound){
    window._geoVisBound=true;
    document.addEventListener('visibilitychange',()=>{
      if(document.hidden){
        if(_geoCurrentJob&&_geoArrivedAt)_geoCloseEntry(_geoCurrentJob);
        if(_geoWasInShop&&_geoShopArrivedAt)_geoCloseShopEntry(_geoShopArrivedAt);
        // Reset fence state so that on foreground-return the next ping correctly
        // re-enters the "arriving" path and writes a fresh entry.  Without this,
        // _geoCurrentJob/wasInShop remain set but _geoArrivedAt/_geoShopArrivedAt
        // are null → resumed session writes no time at all; and stopGeoTracking
        // would double-write the shop entry using the original pre-hide timestamp.
        _geoCurrentJob=null;_geoArrivedAt=null;
        _geoWasInShop=false;_geoShopArrivedAt=null;_geoDriveStartedAt=null;
      }
    });
  }
  // Ensure the shop/office geofence has coordinates. They are derived from the
  // business Address in Settings (S.baddr/bcity/state/bzip), geocoded once and
  // cached on S.officeLat/officeLon. Previously this only happened when the
  // owner ran dispatch route optimization, so shop-time logging silently never
  // fired until then — kick the one-time geocode here so it always works.
  if(!(S.officeLat&&S.officeLon)&&typeof _geoOfficeCoords==='function')_geoOfficeCoords();
  if(_isEmployee){
    if(!_employeeRecord)return;
    // Crew tracking is mandatory for employees — a condition of using TradeDesk.
    // No per-employee app consent: start directly. (The browser/OS still shows
    // its own location-permission prompt on first run; that cannot be bypassed.)
    startGeoTracking();
    setTimeout(_geoPermissionBanner,1800); // surface a fix-it banner if perms are off
    if(_employeeRecord.location_consent!==true){
      _employeeRecord.location_consent=true;
      if(_supa&&_supaUser){try{_supa.from('team_members').update({location_consent:true}).eq('employee_user_id',_supaUser.id).then(()=>{},()=>{});}catch(_e){}}
    }
    return;
  }else{
    // Owner tracking their own time on jobs (one-time opt-in on this device)
    const oc=localStorage.getItem('geo_owner_consent');
    if(oc==='1'){startGeoTracking();return;}
    if(oc==='declined')return;
    if(navigator.webdriver)return;
    _geoConsentPrompt(true);
  }
}
function _geoConsentPrompt(isOwner){
  if(document.getElementById('_geo-consent-ov'))return;
  const ov=document.createElement('div');ov.id='_geo-consent-ov';ov.className='zmodal-overlay';
  const sheet=document.createElement('div');
  sheet.style.cssText='position:fixed;bottom:0;left:0;right:0;background:var(--bg);border-radius:16px 16px 0 0;padding:22px 18px;box-shadow:0 -4px 24px rgba(0,0,0,.15);opacity:0;transform:translateY(16px);transition:opacity .22s cubic-bezier(.22,1,.36,1),transform .22s cubic-bezier(.22,1,.36,1)';
  const biz=escHtml((typeof getBusinessName==='function'&&getBusinessName())||S.bname||'your employer');
  const hrs=escHtml((S.trackStart||'07:00')+'–'+(S.trackEnd||'18:00'));
  const title=isOwner?'Track your own time on jobs?':'Share your location with '+biz+'?';
  const sub=isOwner
    ?'Logs your drive mileage and time on each job automatically so your own hours show up in Job Profit and Crew Cost — only during work hours ('+hrs+').'
    :'This logs your drive mileage and time on each job automatically — only during work hours ('+hrs+'). It never tracks you outside that window or after hours.';
  const note=isOwner?'You can turn this off anytime in Settings.':'You can turn this off anytime, and your pay is never affected by declining.';
  sheet.innerHTML=
    '<div style="font-size:30px;margin-bottom:8px">📍</div>'+
    '<div style="font-size:17px;font-weight:800;margin-bottom:6px">'+title+'</div>'+
    '<div style="font-size:13px;color:var(--text2);line-height:1.55;margin-bottom:8px">'+sub+'</div>'+
    '<div style="font-size:12px;color:var(--text3);line-height:1.5;margin-bottom:16px">'+note+'</div>'+
    '<button onclick="_geoSetConsent(true,'+(isOwner?'true':'false')+')" style="width:100%;padding:14px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:8px;min-height:44px">Allow during work hours</button>'+
    '<button onclick="_geoSetConsent(false,'+(isOwner?'true':'false')+')" style="width:100%;padding:11px;border-radius:var(--r);border:none;background:none;color:var(--text3);font-size:13px;cursor:pointer;font-family:inherit">Not now</button>';
  ov.appendChild(sheet);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  requestAnimationFrame(()=>{sheet.style.opacity='1';sheet.style.transform='translateY(0)';});
}
function _geoSetConsent(yes,isOwner){
  document.getElementById('_geo-consent-ov')?.remove();
  if(isOwner){
    localStorage.setItem('geo_owner_consent',yes?'1':'declined');
  }else{
    if(!yes){localStorage.setItem('geo_consent_declined','1');return;}
    localStorage.removeItem('geo_consent_declined');
    if(_employeeRecord)_employeeRecord.location_consent=true;
    if(_supa&&_supaUser){
      try{_supa.from('team_members').update({location_consent:true}).eq('employee_user_id',_supaUser.id).then(()=>{},()=>{});}catch(_e){}
    }
  }
  if(!yes)return;
  startGeoTracking(); // runs inside this user gesture so the browser permission prompt fires
  if(typeof showToast==='function')showToast(isOwner?'Tracking your time on jobs during work hours':'Location sharing on during work hours','📍');
}
