// js/geo-track.js: Crew location tracking + geofence time-on-site.
//
// Consent model:
//   1. S.teamTracking is on for the account. Tracking is a condition of the job,
//      which is the OWNER's call to make.
//   2. Crew are TOLD before anything is logged. _geoNoticeSheet states plainly
//      what is captured; their tap records location_ack_at + the notice version
//      and, in that same gesture, opens the OS permission prompt. Nothing is
//      tracked before that.
//      We never write an agreement the person did not make: the old code set
//      location_consent=true at sign-in without ever asking, which is a
//      fabricated record, worse in a dispute than having none.
//   3. Owners tracking their OWN time keep a one-time per-device opt-in
//      (localStorage), since that is a preference, not an employment record.
//   4. location_status/checked_at/device record what the DEVICE reported. That is
//      a heartbeat for Fleet & Team, never a proxy for consent.
// Tracking runs whenever location permission is granted. The 07:00-18:00 window
// was removed (owner call): it silently dropped the miles that matter most, a
// Saturday call-out, a 7pm supply run, a 5:30am start, all logged nothing. The
// crew notice states plainly that location is logged; that is the contract.
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
let _geoJobCoords={};      // jobId -> {lat,lng} geocode cache (per session)
let _geoWasInShop=false;   // currently inside office/shop geofence
let _geoCurrentPlace=null; // id of the known place (supply house etc.) we're inside
let _geoPlaceArrivedAt=null;// ISO arrival at that place, for dwell measurement
let _geoShopArrivedAt=null;// ISO timestamp of shop arrival
let _geoDriveStartedAt=null;// ISO timestamp when a drive leg began (leaving any fence)
let _geoStopAnchor=null;   // {lat,lng,at,lastAt} while parked OUTSIDE every fence
let _geoLegAtShop=false;   // was the LEG machine's location the shop last ping? Distinct
                           // from _geoWasInShop, which is the independent shop DWELL flag,
                           // and they differ only when a job is fenced at the yard. Every
                           // other location is derived from _geoCurrentJob/_geoCurrentPlace
                           // directly: a second copy of "where were we" desynchronises the
                           // moment anything sets those, and a restored mid-shift session
                           // then reads as "arrived from nowhere" and restarts the visit.
let _geoLastFenceAt=null;
// ── Leg endpoints, so a drive can be measured and not just timed ────────────
// Owner call (2026-08-01): "when we go geocode to geocode it calls MapKit to
// compute the mileage then we just rely on MapKit's calculations."
//
// Both of these hold a LOCATION DESCRIPTOR, not a raw GPS fix:
//   {lat,lng,name,kind,jobId,placeId,likelyHome}
// The distinction is the point. The last fix inside a 600ft fence can sit 600ft
// off the actual address, and a mileage row that says "Shop -> 123 Main St" has
// to be reproducible: re-run the same two geocodes a year from now in an audit
// and MapKit returns the same number. A raw fix would not.
//
// A stop (lunch, an errand) has no geocode, so it uses its own coordinate. That
// is the one case where the raw position IS the location.
let _geoLastFenceLoc=null; // descriptor for the fence we are currently inside
let _geoLegOrigin=null;    // descriptor for where the open drive leg began
// ── Home-office dwell: presence is not work ─────────────────────────────────
// Owner idea (2026-08-01) closing a real hole: a contractor whose shop is at
// their house had the shop fence running all night. Measured, 14 hours of sleep
// logged as 845 minutes of paid shop overhead in a single row, because
// _geoCloseShopEntry had a 2-minute floor and no ceiling.
//
// A time-of-day gate is NOT the fix. That was deliberately deleted (it silently
// dropped Saturday call-outs and 7pm supply runs), and re-adding it here would
// undo that for the same bad reason. From GPS alone "in my shop working" and
// "asleep upstairs" are identical.
//
// So: at a location the contractor has themselves marked kind:'home_office',
// time accrues only while they are ACTIVELY USING THE APP. That is the right
// measure for a home office specifically, because the work done there IS the
// paperwork: estimates, invoices, scheduling. Everywhere else (the shop proper,
// a supply house) presence still counts, unchanged.
//
// Hands-on work at a home shop is deliberately NOT covered by this: prefabbing
// with the phone in a pocket registers no activity. That case is the location
// prompt's job, where they tap the job they're building for and it becomes real
// job labor, which is better data than shop overhead anyway.
const _GEO_IDLE_MS=5*60*1000;    // grace window after the last real interaction
let _geoLastInteractAt=0;        // ms of the last pointer/key event
let _geoHomeDwell=null;          // {activeMs,lastSampleMs} while inside a home office
let _geoWasAtHome=false;         // was the PREVIOUS ping inside one? Keeps the tally
                                 // alive for exactly the ping that closes the visit.
// Tighter than the 600ft place fence on purpose: at 600ft a slow crawl through
// city traffic reads as parked. 350ft still absorbs parking-lot GPS jitter.
const _GEO_STOP_FT=350;
const _GEO_STOP_MS=5*60*1000;   // a stop, not a traffic light (matches PLACE_DWELL_MS)
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
// Why the queue last stopped draining, for diagnostics. Null while healthy.
let _geoQueueLastError=null;
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
// THE SNAPSHOT RULE: never write back a queue read before an await.
//
// This used to read the queue ONCE and then, after each network round trip,
// shift that snapshot and store it. Any row enqueued while the request was in
// flight was written to localStorage by _geoEnqueue and then immediately
// ERASED when the drain saved its stale copy. Two entries produced close
// together lost one, and the loser depended purely on network timing, so it
// looked like a flaky backend rather than a bug. That is silent data loss in
// the queue whose entire job is to not lose data: real drive legs and job time,
// gone, feeding payroll and mileage.
//
// Now the queue is re-read on every iteration, and the drained row is removed
// BY ITS client_key rather than by position, so a concurrent enqueue can never
// be clobbered and a reordered queue can never drop the wrong row.
async function _geoDrainQueue(){
  if(_geoDrainBusy||!_supa||!_supaUser)return;
  _geoDrainBusy=true;
  try{
    for(;;){
      const q=_geoQueueRead();
      if(!q.length)break;
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
      if(error){
        // A stuck queue used to be completely invisible: the error was swallowed
        // and the old stale-snapshot write made the rows disappear anyway, so it
        // looked like everything drained. Record why it stopped, so a queue that
        // can never drain is diagnosable instead of silent.
        _geoQueueLastError=String((error&&(error.message||error.code))||error||'unknown')+
          ' · '+item.tbl+'/'+((item.row&&item.row.source)||'?');
        break; // offline / transient: the next drain retries from the same head
      }
      _geoQueueLastError=null;
      const cur=_geoQueueRead();
      const key=item.row&&item.row.client_key;
      const i=key?cur.findIndex(x=>x&&x.row&&x.row.client_key===key):0;
      if(i>=0)cur.splice(i,1); else break; // already gone: another drain took it
      _geoQueueWrite(cur);
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
    // Job and place come back through their own vars; only the shop leg flag
    // needs seeding, or a session restored at the yard loses its next leg.
    _geoLegAtShop=!!s.wasInShop&&!s.job;
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

// A job's descriptor. The coordinate comes from the SAME cache the fence test
// used, so the mileage row and the geofence can never disagree about where a
// job is. Name prefers the client, because "Miller residence" is what reads on
// a mileage log; the job's own name is the fallback.
function _geoLocOfJob(j){
  if(!j)return null;
  const c=_geoJobCoords[j.id];
  if(!c)return null;
  const cl=(typeof clients!=='undefined')?clients.find(x=>x.id===j.client_id):null;
  return {lat:c.lat,lng:c.lng,name:(cl&&cl.name)||j.name||'Job',kind:'job',
          jobId:j.id,clientId:j.client_id||null,addr:j.addr||(cl&&cl.addr)||''};
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
  const here={lat:pos.coords.latitude,lng:pos.coords.longitude};
  const acc=pos.coords.accuracy||0;
  // First fix of the day anchors the commute guard: wherever the working day
  // started is where this person left FROM, and that leg is not deductible.
  if(typeof noteDayStart==='function')noteDayStart(here);
  // Throttled breadcrumb (~60s)
  const nowMs=Date.now();
  if(nowMs-_geoLastPingTs>60000){_geoLastPingTs=nowMs;_geoWritePing(here,acc);}
  // ── Home-office activity sampling ─────────────────────────────────────────
  // Sampled per ping rather than driven by visibilitychange, because a web app
  // stops getting pings the moment it is backgrounded, which is exactly the
  // behaviour wanted: no pings, no accrual. The per-sample cap stops a long gap
  // (phone pocketed for an hour, then reopened) dumping that whole hour in as
  // active on the strength of one tap.
  //
  // The tally deliberately SURVIVES the first ping outside the fence. That ping
  // is the one that closes the visit, and the closers run later in this same
  // ping, so clearing on sight would hand them a null and they would silently
  // fall back to wall-clock: the whole night back again.
  const _atHome=_geoAtHomeOffice(here);
  if(_atHome){
    if(!_geoHomeDwell)_geoHomeDwell={activeMs:0,lastSampleMs:nowMs};
    else{
      if(_geoAppActive(nowMs))_geoHomeDwell.activeMs+=Math.min(nowMs-_geoHomeDwell.lastSampleMs,_GEO_IDLE_MS);
      _geoHomeDwell.lastSampleMs=nowMs;
    }
  }else if(!_geoWasAtHome)_geoHomeDwell=null;   // a ping later, nothing left to close
  _geoWasAtHome=_atHome;
  // ── ONE fence state machine ───────────────────────────────────────────────
  // Four things can contain a truck: a JOB fence, the SHOP, a saved PLACE (a
  // supply house, a home office), or nothing at all, which after five minutes
  // parked is a STOP (lunch, an errand, waiting on a gate). Sixteen ordered
  // pairs of those are trips somebody really drives, and every one has to log
  // to the minute.
  //
  // This used to be three independent if-blocks run in sequence, and the order
  // fought itself. The shop and place blocks both guarded on !_geoCurrentJob,
  // which only the job block clears, and the job block ran LAST: so arriving
  // anywhere while a job was still open could not log a leg at all. Worse, a
  // transition observed in a SINGLE ping opened the drive clock and closed it
  // in the same instant, giving zero minutes and dropping the leg under the
  // 2-minute floor. Measured, EVERY ONE of the sixteen pairs lost its leg that
  // way, and job->place / job->shop additionally left a drive clock running
  // while parked, which then contaminated the following leg.
  //
  // A single ping spanning a whole trip is the normal case, not the edge: a
  // phone in a pocket backgrounds and stops delivering fixes, so the last fix
  // is on site and the next one is at the destination.
  //
  // Resolving all three memberships FIRST and diffing one location against the
  // previous one makes all sixteen fall out by construction.
  const shopC=(S.officeLat&&S.officeLon)?{lat:S.officeLat,lng:S.officeLon}:null;
  const inShop=shopC?(_geoDistFt(here,shopC)<=_geoFenceFt()):false;
  const atPlace=(typeof placeAt==='function')?placeAt({lat:here.lat,lon:here.lng}):null;
  const atPlaceId=atPlace?String(atPlace.id):null;
  let insideJob=null,bestFt=Infinity;
  for(const j of _geoMyJobs()){
    const c=await _geoJobLatLng(j);
    if(!c)continue;
    const ft=_geoDistFt(here,c);
    if(ft<=_geoFenceFt()&&ft<bestFt){insideJob=j;bestFt=ft;}
  }
  const insideId=insideJob?insideJob.id:null;
  const nowIsoEarly=new Date(nowMs).toISOString();
  // ── Shop dwell, tracked on its own ────────────────────────────────────────
  // Being at the yard logs SHOP TIME, full stop (owner call 2026-08-01). It is
  // deliberately not folded into the location below: a job fenced at the yard
  // still counts as time at the yard, and shop time is overhead the contractor
  // wants to see regardless of what else is going on there.
  if(inShop!==_geoWasInShop){
    if(inShop){_geoShopArrivedAt=nowIsoEarly;}
    else{
      // A hidden gap since arrival: close at the last VERIFIED moment rather
      // than claiming shop time nobody observed.
      if(_geoShopArrivedAt)_geoCloseShopEntry(_geoShopArrivedAt,_geoGapHiddenAt||undefined);
      _geoShopArrivedAt=null;
    }
    _geoWasInShop=inShop;
  }
  // Where the truck IS, for the purpose of attributing drive legs. A JOB wins:
  // a trip that ends at a job belongs to that job even when the job happens to
  // sit inside the yard. SHOP outranks PLACE because the shop is often saved as
  // a place too, and a leg home should read "Shop".
  const cur=insideId?{k:'job',id:String(insideId),name:null}
           :inShop?{k:'shop',id:'shop',name:(atPlace&&atPlace.name)||'Shop'}
           :atPlaceId?{k:'place',id:atPlaceId,name:atPlace.name}
           :null;
  // The GEOCODE of whatever contains us, resolved while the fixtures that
  // produced `cur` are still in scope. Everything downstream measures distance
  // between two of these, never between two raw fixes.
  const curLoc=!cur?null
    :cur.k==='job'?_geoLocOfJob(insideJob)
    :cur.k==='shop'?{lat:shopC.lat,lng:shopC.lng,name:'Shop',kind:'shop'}
    :{lat:atPlace.lat,lng:atPlace.lon,name:atPlace.name||'Place',kind:atPlace.kind||'other',placeId:atPlaceId};
  const prev=_geoCurrentJob?{k:'job',id:String(_geoCurrentJob)}
            :_geoLegAtShop?{k:'shop',id:'shop'}
            :_geoCurrentPlace?{k:'place',id:String(_geoCurrentPlace)}
            :null;
  const same=(!cur&&!prev)||!!(cur&&prev&&cur.k===prev.k&&cur.id===prev.id);
  const nowIso=new Date(nowMs).toISOString();
  if(same){
    if(cur&&cur.k==='job')_geoWakeAcquire();   // hidden-gap STAY: the unseen time counts
    if(!cur){
      // Still outside everything: accumulate the dwell that makes this a STOP.
      if(_geoStopAnchor&&_geoDistFt(here,_geoStopAnchor)<=_GEO_STOP_FT)_geoStopAnchor.lastAt=nowIso;
      else{
        if(_geoStopAnchor)_geoCloseStop(_geoStopAnchor);
        _geoStopAnchor={lat:here.lat,lng:here.lng,at:nowIso,lastAt:nowIso};
      }
    }
  }else{
    // ── 1. Close whatever contained us ──────────────────────────────────────
    if(prev){
      // HIDDEN-GAP RESOLUTION (leave): backgrounded on site and this first ping
      // back lands elsewhere, so they left at some unverified moment. Close at
      // the last VERIFIED on-site time, tagged, never claiming unseen minutes.
      if(prev.k==='job'&&_geoArrivedAt)await _geoCloseEntry(_geoCurrentJob,_geoGapHiddenAt||undefined,!!_geoGapHiddenAt);
      else if(prev.k==='place'&&_geoPlaceArrivedAt)_geoClosePlaceEntry(_geoCurrentPlace,_geoPlaceArrivedAt);
      // prev.k==='shop' needs nothing here: the independent shop block above
      // owns that dwell, and only closes it when they actually leave the yard.
    }else if(_geoStopAnchor){
      // Leaving a stop settles it AND splits the leg at the kerb, so the parked
      // minutes never ride out attached to the drive entry.
      _geoCloseStop(_geoStopAnchor);
    }
    // ── 2. When did this leg start ──────────────────────────────────────────
    // A drive clock already running is observed truth. Otherwise we left the
    // previous fence and reached this one inside one ping, and the only evidence
    // of departure is the last fix that still put them on site. Using it is what
    // stops the leg vanishing; tagging it keeps the row honest that one end is
    // inferred rather than seen.
    let legStart=_geoDriveStartedAt,legGap=false;
    if(!legStart&&prev&&cur&&_geoLastFenceAt){
      legStart=_geoLastFenceAt;legGap=true;
      // Single ping across the whole trip, so the drive never "opened" and no
      // origin was recorded. The fence we were last inside is the origin, and
      // it is exactly as good a geocode as the two-ping case would have given.
      _geoLegOrigin=_geoLastFenceLoc;
    }
    // ── 3. Enter the new one ────────────────────────────────────────────────
    if(cur){
      if(legStart){
        if(cur.k==='job')_geoDriveEntry(cur.id,legStart,null,null,legGap,curLoc);
        else _geoDriveEntry(null,legStart,cur.name,null,legGap,curLoc);
      }
      _geoDriveStartedAt=null;
      _geoStopAnchor=null;
      _geoLegOrigin=null;
    }else{
      // Out on the road. Open at NOW rather than at the last on-site fix: we can
      // SEE they are gone, so the first moment we know they had left is the
      // conservative start.
      if(!_geoDriveStartedAt){_geoDriveStartedAt=nowIso;_geoLegOrigin=_geoLastFenceLoc;}
      _geoStopAnchor={lat:here.lat,lng:here.lng,at:nowIso,lastAt:nowIso};
    }
    // ── 4. Commit the new state ─────────────────────────────────────────────
    _geoCurrentJob=(cur&&cur.k==='job')?insideId:null;
    _geoArrivedAt=(cur&&cur.k==='job')?nowIso:null;
    _geoLegAtShop=!!(cur&&cur.k==='shop');
    _geoCurrentPlace=(cur&&cur.k==='place')?cur.id:null;
    _geoPlaceArrivedAt=(cur&&cur.k==='place')?nowIso:null;
    if(cur&&cur.k==='job'){_geoPersistOpen();_geoWakeAcquire();}
    else{_geoClearOpen();_geoWakeRelease();}
  }
  // The last fix that still put them inside something. This is the only
  // departure evidence a single-ping transition ever has.
  if(cur){_geoLastFenceAt=nowIso;_geoLastFenceLoc=curLoc;}
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
  // At a home office, presence is not work: bill only the minutes the app was
  // actually being used. This is what stops a shop-at-the-house logging the
  // whole night. Everywhere else the dwell is wall-clock, unchanged.
  const mins=_geoHomeDwell
    ? Math.floor(_geoHomeDwell.activeMs/60000)
    : Math.max(0,Math.round((Date.parse(departed)-Date.parse(arrivedAt))/60000));
  if(mins<2)return;
  if(!_supaUser)return;
  _geoEnqueue('shop_time_entries',{
    contractor_user_id:_geoCid(),employee_user_id:_supaUser.id,
    arrived_at:arrivedAt,departed_at:departed,minutes:mins
  });
}
// destPlace names a non-job destination (a supply house). A leg ending at a
// known place is a real deductible trip that used to vanish: shop -> supply ->
// shop wrote nothing at all, because a drive entry was only ever written on
// arriving at a JOB.
// ONE place decides what a job_time_entries row means. Three call sites in
// finance.js tested `source==='drive'` exactly, so a personal-vehicle leg
// ('drive-personal') fell through their else branch and was counted as ON-SITE
// job labor: it inflated Job Profit's labor cost and the crew report's job-site
// hours with time the person spent behind the wheel.
function _geoIsDriveSource(s){return /^drive/.test(String(s||''));}
// Time outside every fence that is not driving: lunch, an errand, waiting on a
// gate. Neither job labor nor drive time, and never silently folded into either.
function _geoIsOffJobSource(s){return String(s||'')==='stop';}
// Has the contractor marked THIS coordinate as their own home office? Their
// call, never inferred: places.js is explicit that a qualifying home office
// changes the tax answer and is a decision for them and their CPA.
function _geoAtHomeOffice(coord){
  if(!coord||typeof placeAt!=='function')return false;
  try{
    const pl=placeAt({lat:coord.lat,lon:coord.lng!=null?coord.lng:coord.lon});
    return !!(pl&&pl.kind==='home_office');
  }catch(_e){return false;}
}
// Using the app right now: on screen AND touched recently. Both halves matter.
// Visible alone would count a phone left face-up on the workbench all night;
// interaction alone would count a tab buried behind twelve others.
function _geoAppActive(nowMs){
  try{ if(typeof document!=='undefined'&&document.hidden)return false; }catch(_e){}
  return (nowMs-_geoLastInteractAt)<=_GEO_IDLE_MS;
}
// Bound once, passively, on the capture phase so nothing can stop it: this only
// ever stamps a timestamp, never touches the event.
function _geoBindInteract(){
  if(typeof document==='undefined'||window._geoInteractBound)return;
  window._geoInteractBound=true;
  const mark=()=>{_geoLastInteractAt=Date.now();};
  ['pointerdown','keydown','touchstart','wheel'].forEach(ev=>{
    try{document.addEventListener(ev,mark,{capture:true,passive:true});}catch(_e){}
  });
  _geoLastInteractAt=Date.now();   // opening the app IS an interaction
}
// Time inside a known place's fence (a supply house). Paid work, but overhead
// rather than labor on any one job, so it is grouped with drive time.
function _geoIsPlaceSource(s){return String(s||'')==='place';}
// Time at a known place, closed on departure. Bounded by a real fence at both
// ends, so unlike an off-job stop this is verified work time.
function _geoClosePlaceEntry(placeId,arrivedAt){
  if(!arrivedAt)return;
  const departed=new Date().toISOString();
  // Same rule as the shop: a saved place marked home_office bills active app
  // time only, every other kind bills the dwell.
  const mins=_geoHomeDwell
    ? Math.floor(_geoHomeDwell.activeMs/60000)
    : Math.max(0,Math.round((Date.parse(departed)-Date.parse(arrivedAt))/60000));
  if(mins<2)return;              // a pass-through, not a stop
  if(!_supaUser)return;
  const pl=(typeof getPlaces==='function')?getPlaces().find(p=>String(p.id)===String(placeId)):null;
  _geoEnqueue('job_time_entries',{
    contractor_user_id:_geoCid(),employee_user_id:_supaUser.id,
    job_id:null,arrived_at:arrivedAt,departed_at:departed,minutes:mins,
    dest_place:(pl&&pl.name)||null,source:'place'
  });
}
// A stop is only real once they LEAVE it, which is also the first moment it can
// be bounded at both ends. Both edges use a VERIFIED ping rather than now: the
// same rule the hidden-gap close follows, never claim time nobody observed.
function _geoCloseStop(a){
  if(!a||!a.at||!a.lastAt)return;
  const ms=Date.parse(a.lastAt)-Date.parse(a.at);
  if(!(ms>=_GEO_STOP_MS))return;          // a light, not a stop
  const mins=Math.max(0,Math.round(ms/60000));
  // Split the leg at the kerb. Without this the parked minutes ride out on the
  // drive entry, which is the entire defect. Either way the next leg begins the
  // moment they pulled out.
  //
  // No guards on the live fence flags here. This is only ever called when the
  // previous location was OUTSIDE everything, so they are redundant, and one of
  // them was actively wrong once the shop dwell moved earlier in the ping: by
  // the time this ran on arriving at the yard, _geoWasInShop was already true,
  // so the leg out of lunch never restarted and the trip home logged nothing.
  // A stop has no geocode, so it is its own endpoint: the inbound leg ends at
  // the kerb they parked at, and the outbound leg starts from the same spot.
  // `likelyHome` rides along because a leg that STARTS at home is a commute,
  // and a commute is not a deductible mile however plainly the GPS saw it.
  const atHome=(typeof _placeIsLikelyHome==='function')&&_placeIsLikelyHome({lat:a.lat,lng:a.lng},ms);
  const stopLoc={lat:a.lat,lng:a.lng,kind:'stop',likelyHome:atHome,
                 // A declared home office is a named business location on the
                 // log, not an anonymous "Stop". The row has to read
                 // "Home Office -> Ace Supply" or it is not a mileage record
                 // anyone could defend a year later.
                 name:(atHome&&S.homeOffice)?'Home Office':'Stop'};
  if(_geoDriveStartedAt)_geoDriveEntry(null,_geoDriveStartedAt,null,a.at,false,stopLoc);
  _geoDriveStartedAt=a.lastAt;
  _geoLegOrigin=stopLoc;
  // Somewhere they park repeatedly is a candidate location in its own right,
  // which is how an un-named supply yard eventually gets offered to them.
  if(typeof recordUnknownStop==='function')recordUnknownStop({lat:a.lat,lng:a.lng},ms);
  if(!_supaUser)return;
  // Logged, and logged as ITSELF. Off-job time is neither job labor nor drive
  // time; folding it into either is what made a lunch break bill to a job.
  _geoEnqueue('job_time_entries',{
    contractor_user_id:_geoCid(),employee_user_id:_supaUser.id,
    job_id:null,arrived_at:a.at,departed_at:a.lastAt,minutes:mins,
    dest_place:null,source:'stop'
  });
}
// `endedIso` closes the leg at an earlier verified moment than now: the moment
// they parked, when the stop that follows is not driving.
function _geoDriveEntry(jobId,driveStartedAt,destPlace,endedIso,gap,destLoc){
  if(!driveStartedAt)return;
  const arrived=endedIso||new Date().toISOString();
  const mins=Math.max(0,Math.round((Date.parse(arrived)-Date.parse(driveStartedAt))/60000));
  if(mins<2)return;
  if(!_supaUser)return;
  // Only flag for mileage when employee is in a company vehicle for this shift.
  // Personal vehicle trips stay private, drive TIME is still logged (it's
  // compensable labor) but the mileage flag is omitted.
  const companyVeh=typeof _isCompanyVehicleToday==='function'&&_isCompanyVehicleToday();
  // Minted here rather than inside _geoEnqueue so the SAME key lands on the time
  // entry and on the mileage row. That is what makes the mileage row idempotent:
  // one leg can only ever produce one trip, however many times this runs.
  const legKey=_geoClientKey();
  _geoEnqueue('job_time_entries',{
    contractor_user_id:_geoCid(),employee_user_id:_supaUser.id,
    job_id:jobId!=null?String(jobId):null,arrived_at:driveStartedAt,departed_at:arrived,minutes:mins,
    dest_place:destPlace||null,client_key:legKey,
    source:(companyVeh?'drive':'drive-personal')+(gap?'-gap':'')
  });
  _geoAutoMileage(_geoLegOrigin,destLoc,legKey,driveStartedAt,companyVeh);
}

// ── Automatic mileage: the leg we just timed, measured ───────────────────────
// Everything needed for an IRS Pub 463 entry already exists by the time a drive
// leg closes: the date and both endpoints come from the geofence, and the
// business purpose falls out of WHAT the destination is. The only missing
// number is distance, and that is one MapKit call on two geocodes.
//
// Why this beats the dedicated mileage apps rather than matching them: MileIQ
// and Everlance both run a second always-on background service, and battery
// drain is the top complaint against each. We are already pinging for time
// tracking, so this costs nothing extra to run. Their other standing complaint
// is trip fragmentation, a day chopped into unlabeled pieces by every five
// minute stop. Our splits happen at the same boundaries but each piece already
// knows what it is, so a fragment here is a named leg rather than debris.
//
// The row is written IMMEDIATELY at zero miles and filled in afterwards, the
// same shape the manual trip log already uses. A dead spot at arrival is the
// normal case on a rural site and must never cost the contractor the trip.
function _geoAutoMileage(from,to,legKey,startedIso,companyVeh){
  try{
    if(typeof autoLogDriveTrip!=='function')return;
    if(!from||!to||from.lat==null||to.lat==null)return;
    // THE VEHICLE RULE (owner, 2026-08-01). An employee's miles are the
    // business's miles only when they are in the business's truck; in their own
    // car the drive TIME is still theirs to be paid for, but the mileage is not
    // the company's to deduct. The owner IS the business, so any vehicle counts,
    // which is the entire point of the standard mileage deduction.
    if(_isEmployee&&!companyVeh)return;
    // A commute is not a business trip, and the GPS cannot tell the difference,
    // so a departure from home is refused by default rather than inflating a
    // deduction on the contractor's behalf.
    //
    // UNLESS they have declared a home office. Then the residence IS a business
    // location and every drive out of it, to the yard, to a supply house, to a
    // job, is deductible business travel rather than commuting (Rev. Rul. 99-7,
    // on a home office qualifying under 280A(c)(1)(A)).
    //
    // Owner report (2026-08-01), and the app was outright lying about this: the
    // Settings home-office checkbox promises exactly the above in three places
    // (mileage.js "your drives from home to job sites count as deductible
    // business miles", tax.js twice), and NOTHING read S.homeOffice. Ticking it
    // changed the copy and not one logged mile. Declaring the home office is the
    // contractor's call to make, and it is theirs to defend; once made, the app
    // has to honour it.
    //
    // Scoped to the OWNER on purpose. S.homeOffice is one account-level flag
    // describing ONE residence, the owner's. Reading it for everybody would
    // exempt every employee's driveway too, quietly turning each crew member's
    // morning commute into a company deduction on the strength of a checkbox
    // the owner ticked about their own spare room.
    if(from.likelyHome&&!(S.homeOffice&&!_isEmployee))return;
    autoLogDriveTrip({from,to,legKey,startedIso});
  }catch(_e){}
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
// ── Permission request ────────────────────────────────────────────────────────
// Uses getCurrentPosition rather than startGeoTracking so it returns a definitive
// allow/deny we can record.
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
  // separately below.
  try{
    navigator.geolocation.getCurrentPosition(
      ()=>{
        // Record the grant so _geoCanStamp still works on browsers that cannot
        // report permission state (Safari), where querying returns 'unsupported'
        // forever even after the user has allowed it.
        try{localStorage.setItem(_GEO_GRANTED_KEY,'1');}catch(_e){}
        startGeoTracking(); done('granted');
      },
      (err)=>{ done(err&&err.code===1?'denied':'prompt'); },
      {enableHighAccuracy:false,maximumAge:60000,timeout:15000}
    );
  }catch(_e){done('prompt');}
}

// ── Stamp WHERE a record was created ─────────────────────────────────────────
// Fire-and-forget by design. The save NEVER waits on a GPS fix: a denied
// permission, a basement with no signal, or a slow lock all mean the record has
// no coordinate, never that the record fails to save. A map is not worth risking
// a lost expense.
//
// This deliberately does NOT prompt. If location was never granted (the setup
// checklist is where that gets asked for, in context, with an explanation), the
// record just goes unstamped. A permission dialog erupting out of an unrelated
// Save button is exactly what gets Deny tapped, and an iOS deny is sticky, so one
// rude prompt here would poison tracking everywhere else in the app.
//
// geoAcc (metres) is stored because a wifi-triangulated 3km fix is worthless for
// matching a supply house and actively misleading on a map. Consumers filter on
// it: place-matching should reject anything looser than ~150m.
//
// geoAt is separate from the record's own date on purpose. An expense DATED
// Tuesday but STAMPED at 9pm from the sofa is identifiable as non-contemporaneous,
// which is what stops someone's living room being promoted to a supply house.
const _GEO_GRANTED_KEY='zp3_geo_granted';
async function _geoCanStamp(){
  if(!navigator.geolocation)return false;
  const st=await _geoReadPermission();
  if(st==='granted')return true;
  // Safari has historically not supported querying geolocation permission, so
  // 'unsupported' is not the same as "no". Fall back to whether a grant has ever
  // actually succeeded on this device, which _geoRequestPermission records.
  if(st==='unsupported'){try{return localStorage.getItem(_GEO_GRANTED_KEY)==='1';}catch(_e){return false;}}
  return false;
}
function _stampGeo(rec,done){
  if(!rec)return;
  _geoCanStamp().then(ok=>{
    if(!ok)return;
    try{
      navigator.geolocation.getCurrentPosition(
        (pos)=>{
          try{
            rec.lat=+pos.coords.latitude.toFixed(6);   // ~11cm, far more than enough
            rec.lon=+pos.coords.longitude.toFixed(6);
            rec.geoAcc=Math.round(pos.coords.accuracy||0);
            rec.geoAt=new Date().toISOString();
            if(typeof saveAll==='function')saveAll();
            if(typeof done==='function')done(rec);
          }catch(_e){}
        },
        ()=>{},  // denied / unavailable / timeout: no coordinate, no error, no noise
        {enableHighAccuracy:true,maximumAge:60000,timeout:10000}
      );
    }catch(_e){}
  }).catch(()=>{});
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
  if(!navigator.geolocation)return;
  try{
    _geoWatchId=navigator.geolocation.watchPosition(_geoOnPing,()=>{},{enableHighAccuracy:true,maximumAge:30000,timeout:20000});
  }catch(_e){}
}
function stopGeoTracking(){
  if(_geoWatchId!=null){try{navigator.geolocation.clearWatch(_geoWatchId);}catch(_e){}_geoWatchId=null;}
  if(_geoCurrentJob&&_geoArrivedAt)_geoCloseEntry(_geoCurrentJob);
  if(_geoWasInShop&&_geoShopArrivedAt)_geoCloseShopEntry(_geoShopArrivedAt);
  _geoCurrentJob=null;_geoArrivedAt=null;
  _geoWasInShop=false;_geoShopArrivedAt=null;_geoDriveStartedAt=null;_geoGapHiddenAt=null;
  _geoCurrentPlace=null;_geoPlaceArrivedAt=null;_geoStopAnchor=null;_geoLastFenceAt=null;_geoLegAtShop=false;_geoHomeDwell=null;_geoWasAtHome=false;
  _geoLastFenceLoc=null;_geoLegOrigin=null;
  _geoClearOpen();_geoWakeRelease();
}

// ── Init + two-layer consent ───────────────────────────────────────────────────
function _geoTrackInit(){
  if(!S.teamTracking)return;                 // tracking not enabled for the company
  if(!_supaUser)return;
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
  _geoBindInteract();
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
  const biz=escHtml((typeof getBusinessName==='function'&&getBusinessName())||S.bname||'your employer');
  const ov=document.createElement('div');ov.id='_geo-notice-ov';ov.className='zmodal-overlay';
  const sheet=document.createElement('div');
  sheet.style.cssText='position:fixed;bottom:0;left:0;right:0;background:var(--bg);border-radius:16px 16px 0 0;padding:22px 18px;box-shadow:0 -4px 24px rgba(0,0,0,.15);opacity:0;transform:translateY(16px);transition:opacity .22s cubic-bezier(.22,1,.36,1),transform .22s cubic-bezier(.22,1,.36,1)';
  // Centered. The three-fact block is the ONE deliberate exception: a centred
  // list with leading icons has a ragged left edge and reads badly, so its rows
  // stay left-aligned inside a centred, width-capped container.
  sheet.innerHTML=
    '<div style="text-align:center;max-width:420px;margin:0 auto">'+
      '<div style="font-size:30px;margin-bottom:8px">'+svgIcon('📍',{size:30})+'</div>'+
      '<div style="font-size:17px;font-weight:800;margin-bottom:6px">'+biz+' logs your job time with location</div>'+
      '<div style="font-size:13px;color:var(--text2);line-height:1.55;margin-bottom:16px">Your drive mileage and hours on each job record themselves, so you never fill out a timesheet or photograph an odometer.</div>'+
      '<div style="font-size:11px;color:var(--text3);line-height:1.5;margin-bottom:16px">Your phone will ask for permission next.</div>'+
      '<button id="_geo-notice-go" style="width:100%;padding:14px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;min-height:44px">Got it, continue</button>'+
    '</div>';
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
  const title='Track your own time on jobs?';
  const sub='Logs your drive mileage and time on each job automatically so your own hours show up in Job Profit and Crew Cost.';
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
  _geoRequestPermission();
  if(typeof showToast==='function')showToast('Tracking your time on jobs during work hours','📍');
}
