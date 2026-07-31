// js/geo-track.js: Crew location tracking + geofence time-on-site.
//
// Consent model:
//   1. The contractor enables S.teamTracking in Settings (business-hours window
//      + geofence radius). Tracking during work hours is a condition of the job,
//      which is the OWNER's call to make.
//   2. Crew are TOLD before anything is logged. _geoNoticeSheet states plainly
//      what is captured, the hours window, and that off-hours is never touched;
//      their tap records location_ack_at + the notice version and, in that same
//      gesture, opens the OS permission prompt. Nothing is tracked before that.
//      We never write an agreement the person did not make: the old code set
//      location_consent=true at sign-in without ever asking, which is a
//      fabricated record, worse in a dispute than having none.
//   3. Owners tracking their OWN time keep a one-time per-device opt-in
//      (localStorage), since that is a preference, not an employment record.
//   4. location_status/checked_at/device record what the DEVICE reported. That is
//      a heartbeat for Fleet & Team, never a proxy for consent.
// Tracking ONLY runs inside the business-hours window, never on personal time.
//
// Writes:
//   • location_pings   , throttled breadcrumb (lat/lon) for the live crew map
//   • job_time_entries , arrival→departure durations per job (feeds Job Profit)
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
let _geoPingBusy=false;    // re-entrancy guard: _geoOnPing awaits geocodes, overlapping
                           // pings must never interleave the fence state machine
let _geoGapHiddenAt=null;  // ISO of the last hidden/suspend moment with an entry open,
                           // the last VERIFIED on-site time if the next ping lands outside
let _geoWakeLockObj=null;  // screen wake lock held while inside a job fence

// ── Offline-durable time-entry queue ──────────────────────────────────────────
// Every arrival→departure record is written to the DEVICE first and drained to
// Supabase with retry, a dead spot at departure time can never lose a time entry
// (rural job sites are the NORM, and these rows feed payroll/Job Profit, later OJT).
// Rows carry a client-minted key; the server's unique (contractor_user_id,
// client_key) index makes retries idempotent, a retry after a lost response can't
// double-count hours. Breadcrumb pings are deliberately NOT queued (low value,
// unbounded growth offline); only time entries are durable.
const _GEO_QUEUE_KEY='zp3_geo_queue';
let _geoDrainBusy=false;
function _geoClientKey(){return ((_supaUser&&_supaUser.id)||'anon').slice(0,8)+'-'+Date.now().toString(36)+'-'+Math.floor(Math.random()*1e6).toString(36);}
function _geoQueueRead(){try{return JSON.parse(localStorage.getItem(_GEO_QUEUE_KEY)||'[]');}catch(_e){return[];}}
function _geoQueueWrite(q){try{localStorage.setItem(_GEO_QUEUE_KEY,JSON.stringify(q));}catch(_e){}}
function _geoEnqueue(tbl,row){
  try{
    row.client_key=row.client_key||_geoClientKey();
    const q=_geoQueueRead();q.push({tbl,row});
    if(q.length>500)q.splice(0,q.length-500); // hard cap, the queue can never grow unbounded
    _geoQueueWrite(q);
  }catch(_e){}
  _geoDrainQueue();
}
async function _geoDrainQueue(){
  if(_geoDrainBusy||!_supa||!_supaUser)return;
  _geoDrainBusy=true;
  try{
    let q=_geoQueueRead();
    while(q.length){
      const item=q[0];
      let error=null;
      try{
        ({error}=await _supa.from(item.tbl).upsert(item.row,{onConflict:'contractor_user_id,client_key',ignoreDuplicates:true}));
        // Hosted DB predating the geo-hardening migration: no unique index → retry as
        // a plain insert; no client_key column at all → retry without the key. Either
        // way the entry lands, durability beats idempotency when the schema lags.
        if(error&&/on conflict|constraint/i.test(String(error.message||''))){({error}=await _supa.from(item.tbl).insert(item.row));}
        if(error&&/client_key/i.test(String(error.message||''))){const{client_key,...plain}=item.row;({error}=await _supa.from(item.tbl).insert(plain));}
      }catch(_e){error=_e;}
      if(error)break; // offline / transient: stop; the next drain retries from the same head
      q.shift();_geoQueueWrite(q);
    }
  }catch(_e){}
  _geoDrainBusy=false;
}

// ── Screen wake lock, held ONLY while inside a job fence ─────────────────────
// Browsers stop delivering GPS to a backgrounded page; keeping the screen awake
// on-site keeps the fence clock honest for dash-mounted / in-hand phones. Auto-
// released by the OS on hide; re-acquired on return while still on a job.
async function _geoWakeAcquire(){
  try{
    if(_geoWakeLockObj||!navigator.wakeLock||document.hidden)return;
    _geoWakeLockObj=await navigator.wakeLock.request('screen');
    if(_geoWakeLockObj&&_geoWakeLockObj.addEventListener)_geoWakeLockObj.addEventListener('release',()=>{_geoWakeLockObj=null;});
  }catch(_e){_geoWakeLockObj=null;}
}
function _geoWakeRelease(){try{if(_geoWakeLockObj)_geoWakeLockObj.release();}catch(_e){}_geoWakeLockObj=null;}

// ── Open-entry persistence, survive backgrounding AND app kills ──────────────
// The open entry is snapshotted to the device whenever the app hides (and on every
// arrival), so pocketing the phone or an app kill mid-shift never discards the
// morning's arrival. The NEXT ping decides the hidden gap: still inside the same
// fence → one continuous visit (the hidden time counts, verified by both ends);
// outside → the entry closes at the last VERIFIED on-site moment (hiddenAt) with
// source 'geofence-gap', so unverified time is never claimed.
const _GEO_OPEN_KEY='zp3_geo_open';
function _geoPersistOpen(hiddenAt){
  try{
    if((_geoCurrentJob&&_geoArrivedAt)||(_geoWasInShop&&_geoShopArrivedAt)||_geoDriveStartedAt){
      localStorage.setItem(_GEO_OPEN_KEY,JSON.stringify({
        job:_geoCurrentJob,arrivedAt:_geoArrivedAt,wasInShop:_geoWasInShop,
        shopArrivedAt:_geoShopArrivedAt,driveStartedAt:_geoDriveStartedAt,
        hiddenAt:hiddenAt||new Date().toISOString(),uid:(_supaUser&&_supaUser.id)||null,day:todayKey()
      }));
    }else localStorage.removeItem(_GEO_OPEN_KEY);
  }catch(_e){}
}
function _geoClearOpen(){try{localStorage.removeItem(_GEO_OPEN_KEY);}catch(_e){}}
function _geoRestoreOpen(){
  try{
    const s=JSON.parse(localStorage.getItem(_GEO_OPEN_KEY)||'null');
    if(!s||s.uid!==((_supaUser&&_supaUser.id)||null))return;
    if(s.day!==todayKey()){
      // A previous day's entry never survived to close, close it AT its hiddenAt
      // (the last verified on-site moment) so the hours aren't silently lost.
      if(s.job&&s.arrivedAt){_geoCurrentJob=s.job;_geoArrivedAt=s.arrivedAt;_geoCloseEntry(s.job,s.hiddenAt,true);_geoCurrentJob=null;}
      if(s.wasInShop&&s.shopArrivedAt)_geoCloseShopEntry(s.shopArrivedAt,s.hiddenAt);
      _geoClearOpen();return;
    }
    if(_geoCurrentJob||_geoArrivedAt)return; // live state wins, never clobber a running session
    _geoCurrentJob=s.job;_geoArrivedAt=s.arrivedAt;
    _geoWasInShop=!!s.wasInShop;_geoShopArrivedAt=s.shopArrivedAt;
    _geoDriveStartedAt=s.driveStartedAt;
    _geoGapHiddenAt=s.hiddenAt; // the next ping resolves the gap (continuous vs gap-close)
  }catch(_e){}
}

// ── Manual clock bookends, ride the existing "I've Arrived" / "Mark Done" taps ──
// A tap works offline, backgrounded, everywhere GPS can't. These write source:'manual'
// entries through the same durable queue; the geofence entries corroborate them.
const _GEO_MANUAL_KEY='zp3_geo_manual';
function _geoManualOpenRec(){try{const o=JSON.parse(localStorage.getItem(_GEO_MANUAL_KEY)||'null');return o&&o.uid===((_supaUser&&_supaUser.id)||null)?o:null;}catch(_e){return null;}}
function _geoManualArrive(jobId){
  try{
    if(!_supaUser||!S.teamTracking)return;
    const open=_geoManualOpenRec();
    if(open&&String(open.job)===String(jobId))return;   // already clocked in here
    if(open)_geoManualDone(open.job);                    // close the previous job first
    localStorage.setItem(_GEO_MANUAL_KEY,JSON.stringify({job:jobId,arrivedAt:new Date().toISOString(),uid:_supaUser.id}));
  }catch(_e){}
}
function _geoManualDone(jobId){
  try{
    if(!_supaUser)return;
    const open=_geoManualOpenRec();
    if(!open||(jobId!=null&&String(open.job)!==String(jobId)))return;
    localStorage.removeItem(_GEO_MANUAL_KEY);
    const departed=new Date().toISOString();
    const mins=Math.max(0,Math.round((Date.parse(departed)-Date.parse(open.arrivedAt))/60000));
    if(mins<1)return;
    _geoEnqueue('job_time_entries',{
      contractor_user_id:_geoCid(),employee_user_id:_supaUser.id,
      job_id:String(open.job),arrived_at:open.arrivedAt,departed_at:departed,minutes:mins,source:'manual'
    });
  }catch(_e){}
}

// ── Breadcrumb retention, owner's device prunes pings older than 90 days ─────
// One ping/min per crew member grows unbounded otherwise (cost + privacy posture).
// Arrival/departure SUMMARIES are kept forever; only the raw breadcrumb trail ages out.
function _geoPrunePings(){
  try{
    if(_isEmployee||!_supa||!_supaUser)return;
    const k='zp3_geo_prune_day';
    if(localStorage.getItem(k)===todayKey())return;
    localStorage.setItem(k,todayKey());
    const cutoff=new Date(Date.now()-90*86400000).toISOString();
    _supa.from('location_pings').delete().eq('contractor_user_id',_supaUser.id).lt('ts',cutoff).then(()=>{},()=>{});
  }catch(_e){}
}

// ── Business-hours window, device local time ─────────────────────────────────
// S.trackStart/End are set by the contractor as local times (e.g. "07:00").
// Employees work in the same market as the contractor, so the device's local
// clock is the correct reference, no hardcoded timezone.
function _geoNowMinLocal(){const d=new Date();return d.getHours()*60+d.getMinutes();}
function _geoParseHM(s){const m=/^(\d{1,2}):(\d{2})$/.exec(s||'');return m?(+m[1])*60+(+m[2]):null;}
function _geoBusinessHoursNow(){
  const st=_geoParseHM(S.trackStart||'07:00'), en=_geoParseHM(S.trackEnd||'18:00');
  if(st==null||en==null)return false;
  const now=_geoNowMinLocal();
  return en>st ? (now>=st&&now<en) : (now>=st||now<en); // en<=st ⇒ overnight window
}
// Hardcoded generous radius, big enough that GPS drift and street/driveway
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
  // Owner spec 2026-07-18: crew assignment persists for a job's whole span
  // (set once at scheduling time), so "is this today's work" is a real date-
  // range check now (_jobActiveOn, js/settings.js), not "was this employee
  // freshly reconfirmed for today." A multi-day job assigned once on day 1
  // now correctly still fences on day 2 and 3 without anyone re-touching it.
  if(_isEmployee){
    const eid=_employeeRecord?.id;
    return jobs.filter(j=>String(j.assignedTo)===String(eid)&&_jobActiveOn(j,tk));
  }
  return jobs.filter(j=>_jobActiveOn(j,tk));
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
  // RE-ENTRANCY GUARD: this handler awaits network geocodes, and watchPosition can
  // fire faster than they resolve. Interleaved runs used to apply a STALE position
  // after a fresher one and flip arrive/depart backwards, overlapping pings are
  // dropped whole (the next ping, seconds later, carries fresher truth anyway).
  if(_geoPingBusy)return;
  _geoPingBusy=true;
  try{
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
      // A hidden gap since shop arrival: if this first post-gap ping is OUTSIDE,
      // close at the last verified moment, never claim unverified shop time.
      if(_geoShopArrivedAt)_geoCloseShopEntry(_geoShopArrivedAt,_geoGapHiddenAt||undefined);
      _geoShopArrivedAt=null;
      // Only start drive clock if not already inside a job fence, otherwise
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
    // HIDDEN-GAP RESOLUTION (leave): the app was backgrounded while on-site and this
    // first ping back lands OUTSIDE the fence, the worker left at some unverified
    // point during the gap. Close at the last VERIFIED on-site moment (hiddenAt),
    // tagged 'geofence-gap': conservative, defensible, never claims unseen time.
    if(prevJob&&_geoArrivedAt)await _geoCloseEntry(prevJob,_geoGapHiddenAt||undefined,!!_geoGapHiddenAt); // left previous job
    if(prevJob&&!insideId)_geoDriveStartedAt=new Date().toISOString(); // leaving job → drive
    if(insideId){
      if(_geoDriveStartedAt)_geoDriveEntry(insideId,_geoDriveStartedAt); // log drive leg
      _geoDriveStartedAt=null;
      _geoCurrentJob=insideId;_geoArrivedAt=new Date().toISOString();
      _geoPersistOpen();     // an app kill can no longer lose this arrival
      _geoWakeAcquire();     // keep the screen (and GPS) alive while on-site
    }else{_geoCurrentJob=null;_geoArrivedAt=null;_geoClearOpen();_geoWakeRelease();}
  }else if(insideId){
    // HIDDEN-GAP RESOLUTION (stay): still inside the same fence after the gap,
    // one continuous visit, verified at both ends. The hidden time COUNTS.
    _geoWakeAcquire();
  }
  // Whatever branch ran, THIS completed ping resolved any hidden gap, a stale
  // marker must never truncate a later, fully-visible close.
  _geoGapHiddenAt=null;
  }finally{_geoPingBusy=false;}
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
// All three writers go through the durable queue (_geoEnqueue): the entry is on
// the device before any network is attempted, so a dead spot can never lose it.
// `departedIso` (optional) closes at an earlier VERIFIED moment, the hidden-gap
// path: and `gap` tags the row 'geofence-gap' so reports can show confidence.
async function _geoCloseEntry(jobId,departedIso,gap){
  const arrived=_geoArrivedAt; _geoArrivedAt=null;
  _geoClearOpen();
  if(!arrived)return;
  const departed=departedIso||new Date().toISOString();
  const mins=Math.max(0,Math.round((Date.parse(departed)-Date.parse(arrived))/60000));
  if(mins<2)return;            // ignore brief pass-throughs
  if(!_supaUser)return;
  _geoEnqueue('job_time_entries',{
    contractor_user_id:_geoCid(),employee_user_id:_supaUser.id,
    job_id:String(jobId),arrived_at:arrived,departed_at:departed,minutes:mins,
    source:gap?'geofence-gap':'geofence'
  });
}
function _geoCloseShopEntry(arrivedAt,departedIso){
  if(!arrivedAt)return;
  const departed=departedIso||new Date().toISOString();
  const mins=Math.max(0,Math.round((Date.parse(departed)-Date.parse(arrivedAt))/60000));
  if(mins<2)return;
  if(!_supaUser)return;
  _geoEnqueue('shop_time_entries',{
    contractor_user_id:_geoCid(),employee_user_id:_supaUser.id,
    arrived_at:arrivedAt,departed_at:departed,minutes:mins
  });
}
function _geoDriveEntry(jobId,driveStartedAt){
  if(!driveStartedAt)return;
  const arrived=new Date().toISOString();
  const mins=Math.max(0,Math.round((Date.parse(arrived)-Date.parse(driveStartedAt))/60000));
  if(mins<2)return;
  if(!_supaUser)return;
  // Only flag for mileage when employee is in a company vehicle for this shift.
  // Personal vehicle trips stay private, drive TIME is still logged (it's
  // compensable labor) but the mileage flag is omitted.
  const companyVeh=typeof _isCompanyVehicleToday==='function'&&_isCompanyVehicleToday();
  _geoEnqueue('job_time_entries',{
    contractor_user_id:_geoCid(),employee_user_id:_supaUser.id,
    job_id:String(jobId),arrived_at:driveStartedAt,departed_at:arrived,minutes:mins,
    source:companyVeh?'drive':'drive-personal'
  });
}

// ── Location-permission banner (employee self-service) ──────────────────────
// Shown ONLY when an employee's device location is not granted, so they can fix
// it themselves, the owner never has to chase anyone about enabling it. Nothing
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
    '<div style="font-size:13px;font-weight:800;color:#991B1B;margin-bottom:4px">'+svgIcon('📍',{size:13})+' Location is off</div>'+
    '<div style="font-size:12px;color:#991B1B;line-height:1.5;margin-bottom:'+(denied?'0':'10px')+'">'+
      'TradeDesk logs your drive time and job hours automatically during work hours, it only works with location on. '+
      (denied
        ?'Turn it back on in your phone: <strong>Settings → TradeDesk → Location → While Using the App</strong>.'
        :'Tap below and choose <strong>Allow While Using</strong>.')+
    '</div>'+
    (denied?'':'<button onclick="_geoRequestPermission()" style="width:100%;padding:11px;border-radius:var(--r);border:none;background:#DC2626;color:#fff;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;min-height:44px">Turn on location</button>')+
  '</div>';
}
// ── Permission request, DELIBERATELY independent of business hours ────────────
// This used to be `startGeoTracking()`, which bails on `!_geoBusinessHoursNow()`
// before it ever reaches watchPosition. So tapping "Turn on location" at 7pm did
// NOTHING: no OS prompt, no error, no feedback, and the crew member reasonably
// concluded the app was broken. Setup happens whenever a person gets around to
// it, which is very often after the truck is parked, so the permission grant has
// to be reachable 24/7 even though TRACKING itself stays hard-gated to the
// business-hours window (that gate lives in startGeoTracking and _geoOnPing and
// is untouched here).
//
// MUST be called from inside a real user gesture: browsers only surface the
// geolocation prompt in response to a tap.
function _geoRequestPermission(cb){
  const done=(state)=>{
    _geoReportPermission(state);
    try{_geoPermissionBanner();}catch(_e){}
    try{if(typeof _renderDashSetupTodo==='function')_renderDashSetupTodo();}catch(_e){}
    if(typeof cb==='function')try{cb(state);}catch(_e){}
  };
  if(!navigator.geolocation){done('unsupported');return;}
  // getCurrentPosition triggers the OS prompt on its own and, unlike watchPosition,
  // hands back a definitive allow/deny we can record. Tracking is started
  // separately below, only if we're actually inside business hours.
  try{
    navigator.geolocation.getCurrentPosition(
      ()=>{ startGeoTracking(); done('granted'); },
      (err)=>{ done(err&&err.code===1?'denied':'prompt'); },
      {enableHighAccuracy:false,maximumAge:60000,timeout:15000}
    );
  }catch(_e){done('prompt');}
}

// ── Persist what the DEVICE reported ──────────────────────────────────────────
// Status only, never consent. The owner cannot query a crew member's live
// permission from their own phone, so this row is the only thing Fleet & Team can
// render, and it is a heartbeat: without location_checked_at a member who
// revoked permission last week would show green forever.
async function _geoReadPermission(){
  if(!navigator.geolocation)return 'unsupported';
  try{
    if(navigator.permissions&&navigator.permissions.query){
      const p=await navigator.permissions.query({name:'geolocation'});
      if(!p._tdBound){p._tdBound=true;p.onchange=()=>{_geoReportPermission(p.state);try{_geoPermissionBanner();}catch(_e){}};}
      return p.state;
    }
  }catch(_e){}
  // Safari has historically not supported querying geolocation permission. Saying
  // 'unsupported' (rather than lying with 'prompt') lets the roster fall back to
  // ping recency, which is the more reliable signal anyway.
  return 'unsupported';
}
function _geoReportPermission(state){
  if(!_supa||!_supaUser||!_isEmployee)return;
  const patch={location_status:state||'prompt',location_checked_at:new Date().toISOString()};
  try{
    const d=(typeof S!=='undefined'&&S.devices||[]).find(x=>x.id===(typeof _initDeviceId==='function'&&_initDeviceId()));
    if(d)patch.location_device=d.name||d.label||null;
  }catch(_e){}
  try{_supa.from('team_members').update(patch).eq('employee_user_id',_supaUser.id).then(()=>{},()=>{});}catch(_e){}
}

// ── The acknowledgment: the ONLY thing that records agreement ─────────────────
// Written exclusively from a user gesture on the setup action, never inferred and
// never defaulted. Versioned so the record still means something after the copy
// changes.
const GEO_NOTICE_VERSION='2026-07-31.1';
function _geoNeedsAck(){
  if(!_isEmployee)return false;
  if(!S.teamTracking)return false;
  return !(_employeeRecord&&_employeeRecord.location_ack_at);
}
function _geoRecordAck(){
  const now=new Date().toISOString();
  if(_employeeRecord){_employeeRecord.location_ack_at=now;_employeeRecord.location_ack_version=GEO_NOTICE_VERSION;}
  if(!_supa||!_supaUser)return;
  try{_supa.from('team_members').update({location_ack_at:now,location_ack_version:GEO_NOTICE_VERSION}).eq('employee_user_id',_supaUser.id).then(()=>{},()=>{});}catch(_e){}
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
  _geoWasInShop=false;_geoShopArrivedAt=null;_geoDriveStartedAt=null;_geoGapHiddenAt=null;
  _geoClearOpen();_geoWakeRelease();
  if(_geoHoursTimer){clearInterval(_geoHoursTimer);_geoHoursTimer=null;}
}

// ── Init + two-layer consent ───────────────────────────────────────────────────
function _geoTrackInit(){
  if(!S.teamTracking)return;                 // tracking not enabled for the company
  if(!_supaUser)return;
  if(!_geoBusinessHoursNow())return;         // outside hours, nothing to do
  // Backgrounding mid-shift KEEPS the entry open (the old handler closed it, a
  // phone in a pocket all day logged only screen-on slivers, and any visit hidden
  // within 2 minutes of arrival was dropped entirely). Instead: snapshot the open
  // state + the hidden moment; the first ping after return resolves the gap,
  // still inside the fence ⇒ one continuous visit (hidden time counts, verified at
  // both ends); outside ⇒ close at the hidden moment as 'geofence-gap' (unverified
  // time is never claimed). stopGeoTracking / out-of-hours still close for real.
  if(!window._geoVisBound){
    window._geoVisBound=true;
    document.addEventListener('visibilitychange',()=>{
      if(document.hidden){
        _geoGapHiddenAt=new Date().toISOString();
        _geoPersistOpen(_geoGapHiddenAt);
      }else{
        _geoDrainQueue();                      // back online-ish, flush queued entries
        if(_geoCurrentJob)_geoWakeAcquire();   // wake locks auto-release on hide
      }
    });
    // Queued entries also flush the moment connectivity returns.
    window.addEventListener('online',()=>{try{_geoDrainQueue();}catch(_e){}});
  }
  // An app kill / reload mid-shift: restore the persisted open entry so the
  // morning's arrival survives, the next ping resolves it exactly like a
  // background gap. A previous DAY's orphan closes at its last verified moment.
  _geoRestoreOpen();
  _geoDrainQueue();
  _geoPrunePings();
  // Ensure the shop/office geofence has coordinates. They are derived from the
  // business Address in Settings (S.baddr/bcity/state/bzip), geocoded once and
  // cached on S.officeLat/officeLon. Previously this only happened when the
  // owner ran dispatch route optimization, so shop-time logging silently never
  // fired until then, kick the one-time geocode here so it always works.
  if(!(S.officeLat&&S.officeLon)&&typeof _geoOfficeCoords==='function')_geoOfficeCoords();
  if(_isEmployee){
    if(!_employeeRecord)return;
    // Tracking being a condition of the job is the OWNER's call and stays that
    // way. What changed: we no longer FABRICATE the agreement. The app used to
    // write location_consent=true here without ever telling the crew member their
    // location was logged, so their first and only signal was a bare OS prompt.
    // Now they get the notice once, and only their own tap is recorded.
    if(_geoNeedsAck()){
      setTimeout(()=>{try{_geoNoticeSheet();}catch(_e){}},600);
      return; // no tracking until they've at least been TOLD
    }
    startGeoTracking();
    _geoReadPermission().then(_geoReportPermission);
    setTimeout(_geoPermissionBanner,1800); // surface a fix-it banner if perms are off
    return;
  }else{
    // Owner tracking their own time on jobs (one-time opt-in on this device)
    const oc=localStorage.getItem('geo_owner_consent');
    if(oc==='1'){startGeoTracking();return;}
    if(oc==='declined')return;
    if(navigator.webdriver)return;
    _geoConsentPrompt();
  }
}
// ── The crew notice ───────────────────────────────────────────────────────────
// Shown ONCE to an employee who has never acknowledged. Says plainly what is
// logged, when, and what is NOT. Continue records the acknowledgment and then
// fires the OS prompt inside that same gesture, which is also why accept rates
// are higher this way than throwing a naked permission dialog at someone.
function _geoNoticeSheet(){
  if(document.getElementById('_geo-notice-ov'))return;
  const hrs=escHtml((S.trackStart||'07:00')+'–'+(S.trackEnd||'18:00'));
  const biz=escHtml((typeof getBusinessName==='function'&&getBusinessName())||S.bname||'your employer');
  const ov=document.createElement('div');ov.id='_geo-notice-ov';ov.className='zmodal-overlay';
  const sheet=document.createElement('div');
  sheet.style.cssText='position:fixed;bottom:0;left:0;right:0;background:var(--bg);border-radius:16px 16px 0 0;padding:22px 18px;box-shadow:0 -4px 24px rgba(0,0,0,.15);opacity:0;transform:translateY(16px);transition:opacity .22s cubic-bezier(.22,1,.36,1),transform .22s cubic-bezier(.22,1,.36,1)';
  sheet.innerHTML=
    '<div style="font-size:30px;margin-bottom:8px">'+svgIcon('📍',{size:30})+'</div>'+
    '<div style="font-size:17px;font-weight:800;margin-bottom:6px">'+biz+' logs your job time with location</div>'+
    '<div style="font-size:13px;color:var(--text2);line-height:1.55;margin-bottom:12px">Your drive mileage and hours on each job record themselves, so you never fill out a timesheet or photograph an odometer.</div>'+
    '<div style="background:var(--bg2);border-radius:var(--r);padding:12px 14px;margin-bottom:14px">'+
      '<div style="font-size:12px;color:var(--text2);line-height:1.7">'+
        '<div>'+svgIcon('🕖',{size:12})+' <strong>Only during work hours ('+hrs+').</strong></div>'+
        '<div>'+svgIcon('🚫',{size:12})+' Never nights, weekends, or your own time.</div>'+
        '<div>'+svgIcon('👤',{size:12})+' Only your manager sees it, never your coworkers.</div>'+
      '</div>'+
    '</div>'+
    '<div style="font-size:11px;color:var(--text3);line-height:1.5;margin-bottom:16px">Location tracking during work hours is part of using TradeDesk at '+biz+'. Your phone will ask for permission next, and you can change it anytime in your phone settings.</div>'+
    '<button id="_geo-notice-go" style="width:100%;padding:14px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;min-height:44px">Got it, continue</button>';
  ov.appendChild(sheet);document.body.appendChild(ov);
  // The tap that acknowledges is the SAME gesture that opens the OS prompt.
  sheet.querySelector('#_geo-notice-go').onclick=()=>{
    _geoRecordAck();
    ov.remove();
    _geoRequestPermission();
  };
  requestAnimationFrame(()=>{sheet.style.opacity='1';sheet.style.transform='translateY(0)';});
}
function _geoConsentPrompt(){
  if(document.getElementById('_geo-consent-ov'))return;
  const ov=document.createElement('div');ov.id='_geo-consent-ov';ov.className='zmodal-overlay';
  const sheet=document.createElement('div');
  sheet.style.cssText='position:fixed;bottom:0;left:0;right:0;background:var(--bg);border-radius:16px 16px 0 0;padding:22px 18px;box-shadow:0 -4px 24px rgba(0,0,0,.15);opacity:0;transform:translateY(16px);transition:opacity .22s cubic-bezier(.22,1,.36,1),transform .22s cubic-bezier(.22,1,.36,1)';
  const biz=escHtml((typeof getBusinessName==='function'&&getBusinessName())||S.bname||'your employer');
  const hrs=escHtml((S.trackStart||'07:00')+'–'+(S.trackEnd||'18:00'));
  const title='Track your own time on jobs?';
  const sub='Logs your drive mileage and time on each job automatically so your own hours show up in Job Profit and Crew Cost, only during work hours ('+hrs+').';
  const note='You can turn this off anytime in Settings.';
  sheet.innerHTML=
    '<div style="font-size:30px;margin-bottom:8px">'+svgIcon('📍',{size:30})+'</div>'+
    '<div style="font-size:17px;font-weight:800;margin-bottom:6px">'+title+'</div>'+
    '<div style="font-size:13px;color:var(--text2);line-height:1.55;margin-bottom:8px">'+sub+'</div>'+
    '<div style="font-size:12px;color:var(--text3);line-height:1.5;margin-bottom:16px">'+note+'</div>'+
    '<button onclick="_geoSetConsent(true)" style="width:100%;padding:14px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:8px;min-height:44px">Allow during work hours</button>'+
    '<button onclick="_geoSetConsent(false)" style="width:100%;padding:11px;border-radius:var(--r);border:none;background:none;color:var(--text3);font-size:13px;cursor:pointer;font-family:inherit">Not now</button>';
  ov.appendChild(sheet);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  requestAnimationFrame(()=>{sheet.style.opacity='1';sheet.style.transform='translateY(0)';});
}
// Owner-only. The employee branch was removed with the fabricated-consent write:
// crew now go through _geoNoticeSheet, which records a real acknowledgment. This
// is the owner opting IN to tracking their own time, which stays per-device in
// localStorage because it is a personal preference, not an employment record.
function _geoSetConsent(yes){
  document.getElementById('_geo-consent-ov')?.remove();
  localStorage.setItem('geo_owner_consent',yes?'1':'declined');
  if(typeof _renderDashSetupTodo==='function')try{_renderDashSetupTodo();}catch(_e){}
  if(!yes)return;
  _geoRequestPermission(); // 24/7 reachable; tracking itself still honors business hours
  if(typeof showToast==='function')showToast('Tracking your time on jobs during work hours','📍');
}
