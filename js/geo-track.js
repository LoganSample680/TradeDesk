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
let _geoNotifiedArrivalJob=null; // last job we fired an arrival notification for (one per arrival, not per ping)
let _geoArrivedAt=null;    // ISO arrival timestamp for the open entry
let _geoLastPingTs=0;      // throttle for location_pings inserts
let _geoJobCoords={};      // jobId -> {lat,lng} geocode cache (per session)
let _geoWasInShop=false;   // currently inside office/shop geofence
let _geoCurrentPlace=null; // id of the known place (supply house etc.) we're inside
let _geoPlaceArrivedAt=null;// ISO arrival at that place, for dwell measurement
let _geoShopArrivedAt=null;// ISO timestamp of shop arrival
let _geoDriveStartedAt=null;// ISO timestamp when a drive leg began (leaving any fence)
let _geoDrivebyRun=0;      // consecutive driving-speed fixes inside a fence (eviction debounce)
let _geoPersistPingMs=0;   // last time the open state was snapshotted to disk mid-drive
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
let _geoCurrentClient=null; // id of the client whose address fence we're inside (no job today)
let _geoClientArrivedAt=null;// ISO arrival at that client, for the visit entry
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
// The longest gap that can still be read as ONE drive. Past this, an inferred
// leg start is not evidence of anything: it is a phone that was asleep.
const _GEO_MAX_INFERRED_LEG_MS=4*60*60*1000;
const _GEO_STOP_MS=5*60*1000;   // a stop, not a traffic light (matches PLACE_DWELL_MS)
let _geoPingBusy=false;    // re-entrancy guard: _geoOnPing awaits geocodes, overlapping
                           // pings must never interleave the fence state machine
let _geoGapHiddenAt=null;  // ISO of the last hidden/suspend moment with an entry open,
                           // the last VERIFIED on-site time if the next ping lands outside
let _geoWakeLockObj=null;  // screen wake lock held while inside a job fence
// A phone waking from sleep commonly returns ONE coarse fix (cell/wifi-based,
// GPS not yet reacquired) before it settles, and that fix can easily read
// outside a 300ft fence purely from error, not real movement (owner report,
// 2026-08-06: "left job site" fired the moment the screen locked, not when
// anyone actually drove off).
//
// Owner mandate (2026-08-20): "when I enter a fence I am there... this
// should persist until iOS says hey big fella you're driving." Originally
// this confirm-before-exit protection only applied to a departure noticed
// while resolving a background gap (_geoGapHiddenAt set) — but ordinary GPS
// wander while standing still, phone in hand, screen ON the whole time,
// reads outside the fence just as easily, and used to close the visit
// immediately with no confirmation at all (owner report the same day: lost
// the on-site card mid-shift with no gap involved). So this now applies to
// EVERY departure from a job/place/client fence, gap or not: {key, at} of
// the first qualifying "looks gone" reading, waiting on either a genuine
// driving-speed reading (real evidence of motion, trusted immediately — the
// closest signal this app has to "iOS says you're driving") or a second
// fix agreeing before the visit is actually treated as left.
let _geoExitPending=null;
// A fix worse than this can't be used to declare someone gone; it's simply
// ignored and the entry stays open until a tighter fix arrives.
const _GEO_GAP_EXIT_MAX_ACC_M=100;
// A single ping inside a job/shop/place fence looks identical whether someone
// parked there or just drove through it at 40mph (owner report, 2026-08-06:
// "the mileage hits itself on all geofences the moment you cross without
// stopping"). Ending the drive and starting a dwell the instant a fence is
// touched split one continuous trip into a fragment per fence it happened to
// pass near.
//
// Requiring a SECOND ping to confirm (the fix used for the departure side,
// above) does not work here: the whole drive-attribution system is built to
// log a correct trip off a single ping per stop (a phone in a pocket often
// gets exactly one fix the whole time someone is on site, see
// e2e-geo-auto-mileage.spec.js). Requiring confirmation would drop those
// real, short visits right along with the drive-bys.
//
// Use speed instead: a fix reporting real driving speed while inside a fence
// is still moving, not parked, whatever the fence says. No second ping
// needed, and silently a no-op wherever the device doesn't report speed
// (most existing fixtures and plenty of real devices), so nothing that used
// to arrive correctly stops arriving.
const _GEO_DRIVEBY_SPEED_MPS=3.6; // ~8mph
// ── Live drive banner state (owner ask 2026-08-07) ──────────────────────────
// The automatic system used to be fully silent while actually driving; the
// only live feedback belonged to the manual Start Drive flow. These feed the
// dashboard's DRIVING card: rolling straight-line miles ping to ping (free,
// instant, no MapKit calls; the LOGGED trip still comes from the route calc
// on arrival, so the two can differ slightly and that is fine), plus the
// latest speed. Display state only, nothing here touches what gets logged.
let _geoDriveMiles=0;     // straight-line miles accumulated across pings this leg
let _geoDriveSteps=0;     // how many accumulation hops built that tally: a tally from 2 hops is a guess, from 20 it is a road trace
let _geoDriveLastFix=null;// {lat,lng,atMs,acc} last fix used for that accumulation
let _geoDriveMph=0;       // latest speed reading, mph (device speed, else derived)
let _geoDriveMovingAt=0;  // ms of the last ping at driving speed, banner visibility
let _geoMphZeroRun=0;     // consecutive near-zero device speed readings
let _geoMphHeldZero=false;// this ping's zero was held as a GPS hiccup, not motion
let _geoDriveShown=false; // was the banner on screen after the last ping
// Accumulation floor: below this the fix is parking-lot jitter, not travel.
const _GEO_DRIVE_ACCUM_FT=100;
// The banner survives a red light but clears a couple minutes after parking
// somewhere the fence machine doesn't recognize.
const _GEO_DRIVE_SHOW_MS=150000;
// The one visibility question the dashboard asks: tracking is running, a drive
// leg is open, and the truck moved at driving speed recently.
function _geoDriving(){
  const _tracking=_geoWatchId!=null||(typeof _geoNativeWatcherId!=='undefined'&&_geoNativeWatcherId!=null);
  return !!(_tracking&&_geoDriveStartedAt&&(Date.now()-_geoDriveMovingAt)<_GEO_DRIVE_SHOW_MS);
}
function _geoDriveReset(){_geoDriveMiles=0;_geoDriveSteps=0;_geoDriveLastFix=null;_geoDriveMph=0;_geoDriveMovingAt=0;_geoMphZeroRun=0;_geoMphHeldZero=false;_geoDriveHadPause=false;}
// A PAUSE is a sub-stop sit: too long for any red light, too short for the
// five-minute stop machinery (owner's Domino's run, 2026-08-13: a 3-4 minute
// pizza pickup mid-route). Judged on POSITION DWELL (the stop anchor), never
// on iOS speed readings, which cannot be made trustworthy fix-by-fix. Its one
// consumer is the observed-miles detour floor: a leg with a pause in it had
// an errand, not a forced detour, so the direct route is what saves (the
// CPA's direct-miles rule). Pauses of 5+ minutes are real stops and belong
// to the split machinery, so they are deliberately NOT flagged here.
let _geoDriveHadPause=false;
const _GEO_PAUSE_MS=150000;   // 2.5 min: above any signal light, below a stop
function _geoNotePause(a){
  if(!a||!a.at||!a.lastAt)return;
  const ms=Date.parse(a.lastAt)-Date.parse(a.at);
  if(ms>=_GEO_PAUSE_MS&&ms<_GEO_STOP_MS)_geoDriveHadPause=true;
}

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
// The key for a drive LEG, and it must be DETERMINISTIC: derived from who was
// driving and when the leg began, nothing random. A leg can be closed more than
// once (a buffered native event replayed, or a parking-lot reposition
// re-delivering the arrival), and each close reaches _geoDriveEntry separately.
// With a random key every close mints a "new" leg and the idempotency checks
// downstream (mileage.some legKey match, the server's
// contractor_user_id+client_key upsert) all wave the duplicate through: that is
// exactly the owner's 2026-08-11 triple-logged drive. Same person + same leg
// start = same key, so the second close is recognised as the first one again.
function _geoLegKey(startedIso){
  return ((_supaUser&&_supaUser.id)||'anon').slice(0,8)+'-leg-'+((Date.parse(startedIso)||0)).toString(36);
}
function _geoQueueRead(){try{return JSON.parse(localStorage.getItem(_GEO_QUEUE_KEY)||'[]');}catch(_e){return[];}}
function _geoQueueWrite(q){try{localStorage.setItem(_GEO_QUEUE_KEY,JSON.stringify(q));}catch(_e){}}
function _geoEnqueue(tbl,row){
  try{
    row.client_key=row.client_key||_geoClientKey();
    const q=_geoQueueRead();q.push({tbl,row});
    if(q.length>500){
      const dropped=q.length-500;
      q.splice(0,dropped); // hard cap, the queue can never grow unbounded
      // A real device offline long enough to overflow this is real mileage/time
      // data loss, not a benign trim: must reach console.error so it feeds the
      // observability pipeline (§13), never a silent console.warn.
      console.error('geo queue overflow: dropped',dropped,'oldest pending row(s), oldest write ever wins the cap');
    }
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
// morning's arrival. The NEXT pings decide the hidden gap: still inside the same
// fence → one continuous visit (the hidden time counts, verified by both ends);
// outside → a SECOND agreeing ping (or an immediate driving-speed reading,
// see _geoExitPending) confirms it before
// the entry closes, tagged source 'geofence-gap', stamped at that confirming
// ping's own moment. A single fix, especially the first one back after sleep,
// is never enough on its own (owner report 2026-08-06: one coarse wake-up fix
// falsely closed real, still-on-site visits).
const _GEO_OPEN_KEY='zp3_geo_open';
function _geoPersistOpen(hiddenAt){
  try{
    if((_geoCurrentJob&&_geoArrivedAt)||(_geoWasInShop&&_geoShopArrivedAt)||_geoDriveStartedAt){
      localStorage.setItem(_GEO_OPEN_KEY,JSON.stringify({
        job:_geoCurrentJob,arrivedAt:_geoArrivedAt,wasInShop:_geoWasInShop,
        shopArrivedAt:_geoShopArrivedAt,driveStartedAt:_geoDriveStartedAt,
        // WHERE THE DRIVE STARTED, not just that one is open (owner report
        // 2026-08-09: "FBC to home didn't log", with every endpoint saved).
        // These were memory-only, so an app kill left a restored drive with
        // no origin, and _geoAutoMileage bails silently without one: the
        // arrival wrote drive TIME and no mileage row at all. Park mode makes
        // that the common case rather than the rare one, because it is
        // designed to let iOS kill the app while parked.
        legOrigin:_geoLegOrigin,lastFenceLoc:_geoLastFenceLoc,lastFenceAt:_geoLastFenceAt,
        stopAnchor:_geoStopAnchor,
        // Live banner display state (owner report: a UAT reload "kills" the
        // in-progress drive card and the Live Activity/Dynamic Island). None
        // of this was persisted before, only driveStartedAt, so a WebView
        // reload mid-drive (this app's own version-mismatch auto-reload,
        // js/cloud.js _autoSaveAndReload, or any app relaunch) came back up
        // with _geoDriveMovingAt at its fresh default of 0. _geoDriving()
        // gates visibility on `Date.now()-_geoDriveMovingAt<150000`, so a
        // reset-to-0 value always read as "no recent movement" until a fresh
        // GPS ping confirmed driving speed again, and until then both the
        // dashboard's DRIVING banner and _liveActDrive() (js/live-activity.js)
        // treated a drive that never actually stopped as not driving. Carrying
        // these across the reload closes that gap.
        driveMovingAt:_geoDriveMovingAt,driveMiles:_geoDriveMiles,driveSteps:_geoDriveSteps,
        driveMph:_geoDriveMph,driveLastFix:_geoDriveLastFix,
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
      // Same salvage for a drive that was still IN PROGRESS (not at a job or the
      // shop) when the app died across midnight: previously this branch just
      // called _geoClearOpen() and the whole leg vanished, no time entry, no
      // trace. The destination is genuinely unknown (they never arrived before
      // the state was lost), so this claims no mileage/distance, only the
      // payroll-relevant TIME, dated to hiddenAt (the last moment they were
      // actually observed driving), same as the job/shop salvage above.
      if(s.driveStartedAt&&!s.job&&!s.wasInShop&&s.hiddenAt){
        const mins=Math.max(0,Math.round((Date.parse(s.hiddenAt)-Date.parse(s.driveStartedAt))/60000));
        if(mins>=2){
          _geoEnqueue('job_time_entries',{
            contractor_user_id:_geoCid(),employee_user_id:_supaUser.id,
            job_id:null,arrived_at:s.driveStartedAt,departed_at:s.hiddenAt,minutes:mins,
            dest_place:null,client_key:_geoLegKey(s.driveStartedAt),
            source:'drive-unassigned-salvaged'
          });
        }
      }
      _geoClearOpen();return;
    }
    if(_geoCurrentJob||_geoArrivedAt)return; // live state wins, never clobber a running session
    _geoCurrentJob=s.job;_geoArrivedAt=s.arrivedAt;
    _geoWasInShop=!!s.wasInShop;_geoShopArrivedAt=s.shopArrivedAt;
    // The drive comes back WITH its origin, which is what makes it billable.
    // (A freshness cap lived here for one commit and was wrong: a 45-minute
    // lunch is a normal parked gap, and dropping the drive threw the leg home
    // away, the very bug being fixed. The junk-leg resurrection it aimed at
    // is handled properly by the fence-bounce guard in _geoDriveEntry, which
    // now works across a restart precisely BECAUSE the origin survives: a
    // bounce restores with origin == destination and is refused.)
    _geoDriveStartedAt=s.driveStartedAt;
    // Carried alongside driveStartedAt so a drive already in progress reads as
    // driving again immediately, not after the next confirmed-moving ping (see
    // the comment on these fields in _geoPersistOpen). Only meaningful when a
    // drive was actually open (driveStartedAt truthy); a stale 0/null on a
    // restore that has no open drive is harmless, _geoDriving() already
    // requires driveStartedAt too.
    if(s.driveMovingAt)_geoDriveMovingAt=s.driveMovingAt;
    if(typeof s.driveMiles==='number')_geoDriveMiles=s.driveMiles;
    if(typeof s.driveSteps==='number')_geoDriveSteps=s.driveSteps;
    if(typeof s.driveMph==='number')_geoDriveMph=s.driveMph;
    if(s.driveLastFix)_geoDriveLastFix=s.driveLastFix;
    if(!_geoLegOrigin&&s.legOrigin)_geoLegOrigin=s.legOrigin;
    if(!_geoLastFenceLoc&&s.lastFenceLoc)_geoLastFenceLoc=s.lastFenceLoc;
    if(!_geoLastFenceAt&&s.lastFenceAt)_geoLastFenceAt=s.lastFenceAt;
    // The stop they were parked at comes back too, so its own time entry and
    // the detour fold still happen when they finally pull away.
    if(!_geoStopAnchor&&s.stopAnchor)_geoStopAnchor=s.stopAnchor;
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
  const c0=clients.find(x=>x.id===j.client_id);
  const addr=j.addr||(c0&&c0.addr)||'';
  // THE CACHE REMEMBERS WHERE IT GOT THE ANSWER. Keyed on the job id alone, a
  // cached coordinate outlived the address it came from: correcting a job's
  // address mid-shift (a typo, a back entrance, a site that moved) left the
  // fence sitting on the OLD point for the rest of the session, so the crew
  // drove to the new address and nothing fired. No arrival, no time on site,
  // and the drive leg measured to a place they never went.
  //
  // That is worse in this PR than it was before it: these coordinates are no
  // longer only fence membership, they are the ENDPOINTS the mileage row is
  // measured between.
  const src=(j.lat&&j.lon)?(j.lat+','+j.lon):addr;
  const hit=_geoJobCoords[j.id];
  if(hit&&hit.src===src)return hit;
  if(j.lat&&j.lon){const c={lat:j.lat,lng:j.lon,src};_geoJobCoords[j.id]=c;return c;}
  if(!addr||typeof _resolveCoords!=='function')return null;
  try{const r=await _resolveCoords(addr);if(r&&r.lat){_geoJobCoords[j.id]={lat:r.lat,lng:r.lng,src};return _geoJobCoords[j.id];}}catch(_e){}
  return null;
}

// A job's descriptor. The coordinate comes from the SAME cache the fence test
// used, so the mileage row and the geofence can never disagree about where a
// job is. Name prefers the client, because "Miller residence" is what reads on
// a mileage log; the job's own name is the fallback.
// The yard's street address, the one already on file as the business address.
// S.officeLat/officeLon is that same address geocoded once (_geoOfficeCoords),
// so the point and the text describe one place by construction.
function _geoShopAddr(){
  // "Topeka, KS 66604", not "Topeka, KS, 66604". The state and the zip are one
  // field to anyone reading it, and a comma between them is the tell that a
  // machine wrote the address. Every other joiner of these four settings in the
  // app has the same comma; those print on invoices, so they are not changed
  // here without the owner seeing it first.
  try{
    const cityLine=[S.bcity,[S.state,S.bzip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    return [S.baddr,cityLine].filter(Boolean).join(', ');
  }catch(_e){return '';}
}
function _geoLocOfJob(j){
  if(!j)return null;
  const c=_geoJobCoords[j.id];
  if(!c)return null;
  const cl=(typeof clients!=='undefined')?clients.find(x=>x.id===j.client_id):null;
  return {lat:c.lat,lng:c.lng,name:(cl&&cl.name)||j.name||'Job',kind:'job',
          jobId:j.id,clientId:j.client_id||null,addr:j.addr||(cl&&cl.addr)||''};
}

// ── Fresh-fix subscription ───────────────────────────────────────────────────
// A one-shot listener for "a real position just came in". Deliberately NOT
// navigator.geolocation: inside the shell that is shimmed to serve a cached fix
// for up to two minutes, which is correct for weather and wrong for anything
// asking where somebody is this second.
let _geoFixSubs=[];
function _geoOnFreshFix(fn){
  if(typeof fn!=='function')return ()=>{};
  _geoFixSubs.push(fn);
  return ()=>{_geoFixSubs=_geoFixSubs.filter(f=>f!==fn);};
}
function _geoEmitFix(fix){
  if(!_geoFixSubs.length)return;
  _geoFixSubs.slice().forEach(fn=>{try{fn(fix);}catch(_e){}});
}

// ── Position handler: breadcrumb + geofence state machine ──────────────────────
async function _geoOnPing(pos){
  // The dashboard's optimistic geo card (renderDash, js/dashboard.js) shows
  // the LAST session's card until real GPS truth arrives; this flag is that
  // truth arriving, after it the live state alone decides the card.
  window._geoFixSeen=true;
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
  // Throttled breadcrumb (~60s). A replayed TdGeo buffer event carries the
  // moment it actually happened (__tdTs); everything downstream in this
  // handler clocks off nowMs, so the whole fence machine honors it.
  const nowMs=(pos&&pos.__tdTs)||Date.now();
  if(nowMs-_geoLastPingTs>60000){_geoLastPingTs=nowMs;_geoWritePing(here,acc);}
  // Every fix, from every source (web watcher, native watcher, TdGeo burst,
  // replayed buffer), funnels through here, so this is the one honest place to
  // tell anybody waiting on a FRESH position that one just arrived. Push to
  // locate (js/crew-locate.js) is the caller: it cannot use the shimmed
  // getCurrentPosition, which answers from a two-minute cache on purpose.
  _geoEmitFix({lat:here.lat,lng:here.lng,acc:Math.round(acc||0),ts:nowMs});
  // ── Live drive banner: rolling miles + speed ──────────────────────────────
  // Runs BEFORE the fence machine so the fix that closes the leg still counts
  // its last stretch of road. Straight-line ping to ping: display only, the
  // logged trip is still measured geocode to geocode on arrival.
  //
  // Accuracy-gated (owner report 2026-08-20, live device: "the speed is not
  // accurate"). Before this, `acc` was read (above) but never actually
  // checked anywhere in this block: a fix with a 300m error radius (pulling
  // out of a garage, under trees, downtown between buildings) was trusted
  // exactly as much as a rock-solid 5m highway fix, for BOTH the derived
  // straight-line speed (two noisy positions can imply almost any distance
  // over a short interval) and the device's own coords.speed (on-device
  // speed derivation inherits the same position noise on plenty of chips).
  // Reuses _GEO_GAP_EXIT_MAX_ACC_M, the app's existing "trustworthy enough to
  // act on" threshold (already used for gap-exit resolution below), rather
  // than inventing a second accuracy bar.
  const _driveAccOk=acc>0&&acc<=_GEO_GAP_EXIT_MAX_ACC_M;
  if(_geoDriveStartedAt){
    if(_geoDriveLastFix){
      const stepFt=_geoDistFt(here,_geoDriveLastFix);
      const dtMs=nowMs-_geoDriveLastFix.atMs;
      // A bad-accuracy CURRENT fix can't extend the baseline either way: hold
      // _geoDriveLastFix at the last known-good position/time and wait for a
      // better fix, rather than measuring the next step from a position that
      // was never trustworthy. The previous fix's own accuracy was already
      // checked when IT was accepted, so only the current one needs gating.
      if(!_driveAccOk){
        // no-op: fall through with mph/miles/lastFix all untouched
      }else if(stepFt>_GEO_DRIVE_ACCUM_FT){
        _geoDriveMiles+=stepFt/5280;_geoDriveSteps++;
        // Derived speed as the fallback: plenty of devices ping without a
        // speed reading, and distance over time is honest for a 20-30s gap.
        if(dtMs>3000)_geoDriveMph=(stepFt/5280)/(dtMs/3600000);
        _geoDriveLastFix={lat:here.lat,lng:here.lng,atMs:nowMs,acc};
      }else if(dtMs>45000){
        // No real movement across a long gap IS a speed reading. Without it a
        // device that never reports coords.speed kept the banner alive on the
        // stale mph it had out on the road.
        _geoDriveMph=(stepFt/5280)/(dtMs/3600000);
        _geoDriveLastFix={lat:here.lat,lng:here.lng,atMs:nowMs,acc};
      }
    }else if(_driveAccOk){
      _geoDriveLastFix={lat:here.lat,lng:here.lng,atMs:nowMs,acc};
    }
  }
  // The device's own reading wins when present, it is current rather than a
  // trailing average. EXCEPT a lone zero in the middle of road speed: that is
  // a GPS hiccup, not a stop (owner: "at times the speed was wrong"), so the
  // readout holds for one ping. A real stop light sends a STREAM of zeros and
  // lands on the second one; the held ping also never counts as motion for
  // the banner clock, so a fade is never postponed by a hiccup.
  _geoMphHeldZero=false;
  if(_driveAccOk&&typeof pos.coords.speed==='number'&&pos.coords.speed>=0){
    const _mphNow=pos.coords.speed*2.23694;
    if(_mphNow<1&&_geoDriveMph>=8&&_geoMphZeroRun===0){
      _geoMphZeroRun=1;_geoMphHeldZero=true;
    }else{
      _geoMphZeroRun=(_mphNow<1)?_geoMphZeroRun+1:0;
      _geoDriveMph=_mphNow;
    }
  }
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
  let inShop=shopC?(_geoDistFt(here,shopC)<=_geoFenceFt()):false;
  const atPlace=(typeof placeAt==='function')?placeAt({lat:here.lat,lon:here.lng}):null;
  let atPlaceId=atPlace?String(atPlace.id):null;
  let insideJob=null,bestFt=Infinity;
  for(const j of _geoMyJobs()){
    const c=await _geoJobLatLng(j);
    if(!c)continue;
    const ft=_geoDistFt(here,c);
    if(ft<=_geoFenceFt()&&ft<bestFt){insideJob=j;bestFt=ft;}
  }
  let insideId=insideJob?insideJob.id:null;
  const atClient=_geoClientAt(here);
  let atClientId=atClient?String(atClient.id):null;
  // Drive-by guard: a fix reporting real driving speed inside a fence is
  // still moving, not parked, whatever the fence says (see
  // _GEO_DRIVEBY_SPEED_MPS above). Cleared here, before the independent shop
  // dwell block below AND before `cur`, so neither one is fooled by it.
  if((insideId||inShop||atPlaceId||atClientId)&&typeof pos.coords.speed==='number'&&pos.coords.speed>=_GEO_DRIVEBY_SPEED_MPS){
    // An ESTABLISHED occupant gets a second opinion before eviction (owner
    // video 2026-08-11: one phantom driving-speed fix while parked at the
    // yard closed the shop dwell, the next ping re-stamped the arrival, and
    // the dashboard's on-site card blinked off behind its 2-minute floor).
    // A genuine pull-away reports driving speed on consecutive fixes, so the
    // close waits one ping; a genuine drive-BY was never established here
    // and still masks on the first fix, exactly as before.
    const _estab=!!(_geoWasInShop||_geoCurrentJob||_geoCurrentPlace||_geoCurrentClient);
    _geoDrivebyRun++;
    if(!_estab||_geoDrivebyRun>=2){insideId=null;inShop=false;atPlaceId=null;atClientId=null;}
  }else _geoDrivebyRun=0;
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
      // nowIsoEarly rather than nothing: live they are the same moment, and a
      // replayed TdGeo buffer fix closes the dwell at the moment the departure
      // actually happened rather than at the replay moment.
      if(_geoShopArrivedAt)_geoCloseShopEntry(_geoShopArrivedAt,_geoGapHiddenAt||nowIsoEarly);
      _geoShopArrivedAt=null;
    }
    _geoWasInShop=inShop;
  }
  // Where the truck IS, for the purpose of attributing drive legs. A JOB wins:
  // a trip that ends at a job belongs to that job even when the job happens to
  // sit inside the yard. SHOP outranks PLACE because the shop is often saved as
  // a place too, and a leg home should read "Shop".
  // CLIENT is the weakest fence by construction: a client's address only
  // decides the location when no job, shop, or saved place already has, so
  // nothing that logged before client fences existed logs differently now.
  const cur=insideId?{k:'job',id:String(insideId),name:null}
           :inShop?{k:'shop',id:'shop',name:(atPlace&&atPlace.name)||'Shop'}
           :atPlaceId?{k:'place',id:atPlaceId,name:atPlace.name}
           :atClientId?{k:'client',id:atClientId,name:atClient.name}
           :null;
  // The GEOCODE of whatever contains us, resolved while the fixtures that
  // produced `cur` are still in scope. Everything downstream measures distance
  // between two of these, never between two raw fixes.
  // The `addr` on each is what READS on the mileage row. It is never what gets
  // measured: the distance always comes from the two coordinates above, because
  // an address has to be guessed back into a point and these endpoints are not
  // all addresses to begin with. But an IRS log that says "Shop -> Stop" is not
  // a log, so every endpoint that HAS a street address carries it (owner,
  // 2026-08-02: "shouldn't it do address to address?").
  const curLoc=!cur?null
    :cur.k==='job'?_geoLocOfJob(insideJob)
    :cur.k==='shop'?{lat:shopC.lat,lng:shopC.lng,name:'Shop',kind:'shop',addr:_geoShopAddr()}
    :cur.k==='place'?{lat:atPlace.lat,lng:atPlace.lon,name:atPlace.name||'Place',kind:atPlace.kind||'other',placeId:atPlaceId,addr:atPlace.addr||''}
    :{lat:atClient.lat,lng:atClient.lng,name:atClient.name||'Client',kind:'client',clientId:atClient.id,addr:atClient.addr||'',
      // A won bid nobody has put on the calendar yet is real work, not a
      // consult (owner 2026-08-18: "forgot to add it to the calendar" should
      // never cost a correctly-labeled trip). This only ever fires when NO
      // job fenced above (job wins the strongest tier, unconditionally), so
      // it can never relabel a trip that already has a real scheduled job.
      queuedJob:_geoHasQueuedBid(atClientId)};
  const prev=_geoCurrentJob?{k:'job',id:String(_geoCurrentJob)}
            :_geoLegAtShop?{k:'shop',id:'shop'}
            :_geoCurrentPlace?{k:'place',id:String(_geoCurrentPlace)}
            :_geoCurrentClient?{k:'client',id:String(_geoCurrentClient)}
            :null;
  const same=(!cur&&!prev)||!!(cur&&prev&&cur.k===prev.k&&cur.id===prev.id);
  const nowIso=new Date(nowMs).toISOString();
  if(same){
    // Back to matching where we were: any unconfirmed "looks like they left"
    // reading from a moment ago was wrong, drop it rather than let it confirm
    // a later, unrelated exit against a stale timestamp.
    _geoExitPending=null;
    if(cur&&cur.k==='job')_geoWakeAcquire();   // hidden-gap STAY: the unseen time counts
    if(!cur){
      // Still outside everything: accumulate the dwell that makes this a STOP.
      if(_geoStopAnchor&&_geoDistFt(here,_geoStopAnchor)<=_GEO_STOP_FT)_geoStopAnchor.lastAt=nowIso;
      else{
        // Pulling away from a kerb the anchor was watching: if the sit was a
        // sub-stop PAUSE (2.5-5 min, the pizza pickup), the leg is marked
        // before the anchor is replaced, so the detour floor knows this trace
        // contains an errand rather than a forced detour.
        _geoNotePause(_geoStopAnchor);
        if(_geoStopAnchor)_geoCloseStop(_geoStopAnchor);
        _geoStopAnchor={lat:here.lat,lng:here.lng,at:nowIso,lastAt:nowIso};
      }
    }
  }else{
    // A departure into AMBIGUITY (cur is null — not clearly anywhere) is
    // never trusted off a single fix (see _geoExitPending above), gap or
    // not: the resolving reading must clear the accuracy floor AND be
    // confirmed, either by a genuine driving-speed reading (immediate —
    // that's real evidence of motion) or by a second qualifying ping
    // agreeing, before the visit is treated as actually left. A shaky or
    // lone reading just waits, entry stays open, nothing is written yet.
    //
    // Landing DIRECTLY inside a DIFFERENT, well-defined fence (cur is a
    // real job/shop/place/client, not null) needs none of this: a clean fix
    // squarely inside another address entirely is not ambiguous the way a
    // reading in open space is, it is its own strong evidence the first
    // fence was left, and a backgrounded phone commonly delivers exactly
    // one ping between two fences with nothing in between (the DIRECT case
    // this app has always had to log correctly). Gating that on a second
    // ping would mean a single-ping drive between two real fences never
    // logs at all.
    if(prev&&(prev.k==='job'||prev.k==='place'||prev.k==='client')&&!cur){
      const accOk=acc>0&&acc<=_GEO_GAP_EXIT_MAX_ACC_M;
      const drivingNow=typeof pos.coords.speed==='number'&&pos.coords.speed>=_GEO_DRIVEBY_SPEED_MPS;
      const exitKey=prev.k+':'+prev.id;
      const confirmed=drivingNow||(accOk&&_geoExitPending&&_geoExitPending.key===exitKey);
      if(!confirmed){
        if(accOk||drivingNow)_geoExitPending={key:exitKey,at:nowIso};
        return;
      }
      _geoExitPending=null;
    }
    // ── 1. Close whatever contained us ──────────────────────────────────────
    if(prev){
      // HIDDEN-GAP RESOLUTION (leave): backgrounded on site, and this now-
      // CONFIRMED reading (gated above) is the first moment a departure was
      // actually verified. That confirmation moment is the departure time,
      // not the earlier hidden moment: a screen locking is not evidence
      // anyone left, only a fix that clears the fence is (owner call,
      // 2026-08-06, superseding the prior "close at the hidden moment"
      // behavior). The 'geofence-gap' source tag still marks the row as
      // gap-resolved rather than continuously observed.
      if(prev.k==='job'&&_geoArrivedAt)await _geoCloseEntry(_geoCurrentJob,nowIso,!!_geoGapHiddenAt);
      else if(prev.k==='place'&&_geoPlaceArrivedAt)_geoClosePlaceEntry(_geoCurrentPlace,_geoPlaceArrivedAt,nowIso);
      else if(prev.k==='client'&&_geoClientArrivedAt)_geoCloseClientEntry(_geoCurrentClient,_geoClientArrivedAt,nowIso);
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
    let legStart=_geoDriveStartedAt,legGap=false,legStale=false;
    if(!legStart&&prev&&cur&&_geoLastFenceAt){
      // OVERNIGHT. _geoLastFenceAt is only cleared when tracking stops, so a
      // truck parked at the yard at 5pm with the phone asleep, driven to a job
      // at 7:30 the next morning, inferred a FOURTEEN HOUR drive: billed as job
      // time into Job Profit and crew cost, with the mileage row dated to
      // yesterday (and at New Year, the wrong tax year). The persisted job entry
      // already guards its day boundary; this in-memory timestamp did not.
      //
      // Owner's call (2026-08-03): keep the miles, drop the hours. The DISTANCE
      // is real and measured geocode to geocode, so the deduction stands. The
      // DURATION is a number nobody observed, and it feeds payroll, so it is not
      // claimed at all. _geoDriveEntry logs the mileage and skips the time entry
      // when it sees this flag.
      legStale=(Date.parse(nowIso)-Date.parse(_geoLastFenceAt))>_GEO_MAX_INFERRED_LEG_MS;
      legStart=legStale?nowIso:_geoLastFenceAt;legGap=true;
      // Single ping across the whole trip, so the drive never "opened" and no
      // origin was recorded. The fence we were last inside is the origin, and
      // it is exactly as good a geocode as the two-ping case would have given.
      _geoLegOrigin=_geoLastFenceLoc;
    }
    // ── 3. Enter the new one ────────────────────────────────────────────────
    if(cur){
      _geoCollapseDetours();   // unreceipted anonymous stops between here and the last real endpoint are detours
      if(legStart){
        // nowIso, not null: live it IS now, and a replayed TdGeo buffer fix
        // carries the moment the arrival actually happened, so the leg's
        // duration stays honest instead of stretching to the replay moment.
        if(cur.k==='job')_geoDriveEntry(cur.id,legStart,null,nowIso,legGap,curLoc,legStale);
        else _geoDriveEntry(null,legStart,cur.name,nowIso,legGap,curLoc,legStale);
      }
      _geoDriveStartedAt=null;
      _geoDriveReset();
      _geoStopAnchor=null;
      _geoLegOrigin=null;
    }else{
      // Out on the road. Open at NOW rather than at the last on-site fix: we can
      // SEE they are gone, so the first moment we know they had left is the
      // conservative start.
      if(!_geoDriveStartedAt){
        _geoDriveStartedAt=nowIso;_geoLegOrigin=_geoLastFenceLoc;
        _geoDriveMiles=0;_geoDriveSteps=0;_geoDriveLastFix={lat:here.lat,lng:here.lng,atMs:nowMs,acc};
        _geoDriveHadPause=false;
      }
      _geoStopAnchor={lat:here.lat,lng:here.lng,at:nowIso,lastAt:nowIso};
    }
    // ── 4. Commit the new state ─────────────────────────────────────────────
    _geoCurrentJob=(cur&&cur.k==='job')?insideId:null;
    _geoArrivedAt=(cur&&cur.k==='job')?nowIso:null;
    _geoLegAtShop=!!(cur&&cur.k==='shop');
    _geoCurrentPlace=(cur&&cur.k==='place')?cur.id:null;
    _geoPlaceArrivedAt=(cur&&cur.k==='place')?nowIso:null;
    _geoCurrentClient=(cur&&cur.k==='client')?cur.id:null;
    _geoClientArrivedAt=(cur&&cur.k==='client')?nowIso:null;
    // The park dwell clock starts at the moment THIS fence was entered; a
    // shop-to-job hop must not inherit the shop's dwell.
    _geoFenceEnteredAtMs=cur?nowMs:null;
    if(cur&&cur.k==='job'){_geoPersistOpen();_geoWakeAcquire();}
    // _geoPersistOpen, NOT _geoClearOpen: it self-clears when nothing is open,
    // and the transition that OPENS a drive lands here (cur=null). The old
    // clear deleted the snapshot at the exact start of every drive, so a
    // webview crash mid-leg had nothing to restore: the leg's origin died
    // with the session and the journey vanished from the log (owner
    // 2026-08-11: home -> Home Depot never logged across the crash).
    else{_geoPersistOpen();_geoWakeRelease();}
    // ARRIVAL TAP-BACK (owner 2026-08-10: "when you arrive can it route back
    // to tradedesk automatically?"). It cannot: no iOS API lets an app bring
    // itself forward, from Apple Maps or anywhere else. A notification the
    // driver taps is the sanctioned equivalent, and this is the moment we
    // know they arrived. Only on a REAL job-fence entry, never a shop hop.
    if(cur&&cur.k==='job'&&_geoCurrentJob!==_geoNotifiedArrivalJob){
      _geoNotifiedArrivalJob=_geoCurrentJob;
      try{
        if(typeof _notifyArrival==='function'){
          const _j=(typeof jobs!=='undefined'&&jobs.find)?jobs.find(x=>String(x.id)===String(_geoCurrentJob)):null;
          const _c=(_j&&_j.client_id!=null&&typeof getClientById==='function')?getClientById(_j.client_id):null;
          _notifyArrival((_c&&_c.name)||(_j&&_j.name)||'the job site',_j&&_j.name);
        }
      }catch(_e){}
    }
    if(!(cur&&cur.k==='job'))_geoNotifiedArrivalJob=null;   // re-arm for the next arrival
    // The dashboard's "ON SITE" card (renderDash, js/dashboard.js) reads
    // _geoCurrentJob/_geoCurrentPlace/_geoWasInShop straight off this module,
    // but nothing in this handler ever told it those changed. Every OTHER path
    // that touches this state calls renderDash itself; the automatic geofence
    // never did, so the card sat stale (still showing "On site" after leaving,
    // or never appearing on arrival) until something unrelated re-rendered the
    // page, an owner tapping a different tab and back. Only on a REAL
    // transition (this branch), and only while the dashboard is actually the
    // page on screen, a full re-render on every 20-30s ping while elsewhere in
    // the app would be wasted work nobody sees.
    if(typeof renderDash==='function'&&typeof document!=='undefined'&&document.getElementById('pg-dash')?.classList.contains('active')){
      renderDash();
    }
  }
  // The last fix that still put them inside something. This is the only
  // departure evidence a single-ping transition ever has.
  if(cur){_geoLastFenceAt=nowIso;_geoLastFenceLoc=curLoc;}
  // ── TdGeo duty cycle ──────────────────────────────────────────────────────
  // Two parked shapes, both head toward GPS-off (no-op outside the shell):
  // settled inside a FENCE and not driving, or below driving speed outside
  // every fence: an anonymous stop, or ON FOOT. Judged on speed rather than
  // displacement, because a walker resets the stop anchor forever and GPS
  // never shut off (owner report 2026-08-09: "I walk everywhere with my
  // phone"). The countdown timer alone is NOT trusted: WKWebView suspends JS
  // timers with the screen locked, so any ping whose dwell has ALREADY passed
  // the threshold parks right now; the timer covers the screen-on case.
  // Driving kills the countdown and both dwell clocks.
  {
    // Quiet clock upkeep: device-reported speed when present, distance over
    // time between two decent fixes when not. Only driving speed clears it.
    // Bad-accuracy fixes can't clear it either: an indoor phone bouncing
    // hundreds of meters between cell fixes is exactly the case that must
    // still park. Failing toward GPS-off is safe, a wrong park self-heals
    // within a couple hundred meters of real driving via the exit region.
    let _mps=(typeof pos.coords.speed==='number'&&pos.coords.speed>=0)?pos.coords.speed:null;
    if(_mps==null&&_geoParkPrevFix&&acc<=_GEO_GAP_EXIT_MAX_ACC_M&&_geoParkPrevFix.acc<=_GEO_GAP_EXIT_MAX_ACC_M){
      const _dtS=(nowMs-_geoParkPrevFix.atMs)/1000;
      if(_dtS>=5)_mps=(_geoDistFt(here,_geoParkPrevFix)*0.3048)/_dtS;
    }
    if(_mps!=null&&_mps>=_GEO_DRIVEBY_SPEED_MPS)_geoQuietSinceMs=null;
    else if(_geoQuietSinceMs==null)_geoQuietSinceMs=nowMs;
    _geoParkPrevFix={lat:here.lat,lng:here.lng,atMs:nowMs,acc:acc};
    // Five minutes at the same kerb IS this app's definition of a stop, so the
    // leg that got them here is written the moment it qualifies rather than
    // whenever they happen to drive off again (owner report 2026-08-09: the
    // drive home never logged, because nobody drives away from home).
    if(!cur&&_geoStopAnchor&&_geoDriveStartedAt&&
       (nowMs-(Date.parse(_geoStopAnchor.at)||nowMs))>=_GEO_STOP_MS){
      _geoSettleStopLeg(_geoStopAnchor,nowIso);
    }
    let _parkSpot=null,_parkDwellStart=null;
    if(cur&&!_geoDriveStartedAt){
      if(!_geoFenceEnteredAtMs)_geoFenceEnteredAtMs=nowMs;
      _parkSpot=_geoLastFenceLoc;_parkDwellStart=_geoFenceEnteredAtMs;
    }else if(!cur&&_geoQuietSinceMs!=null){
      // Dwell = the EARLIER of "position settled here" (the stop anchor's
      // birth) and "dropped below driving speed" (the quiet clock). A
      // stationary truck parks on the anchor exactly as before; a walker,
      // whose anchor keeps re-birthing, parks on the quiet clock.
      _geoFenceEnteredAtMs=null;
      _parkSpot=_geoStopAnchor?{lat:_geoStopAnchor.lat,lng:_geoStopAnchor.lng,name:'stop'}
                              :{lat:here.lat,lng:here.lng,name:'stop'};
      const _aAt=_geoStopAnchor?(Date.parse(_geoStopAnchor.at)||Infinity):Infinity;
      const _qAt=_geoQuietSinceMs!=null?_geoQuietSinceMs:Infinity;
      _parkDwellStart=isFinite(Math.min(_aAt,_qAt))?Math.min(_aAt,_qAt):null;
    }else{
      // Driving (quiet clock cleared), or inside a fence with a drive still
      // open. Either way nothing is parked, so nothing may count down: the
      // old code left the timer armed across a whole screen-on drive.
      _geoFenceEnteredAtMs=null;
    }
    if(_parkSpot&&_parkDwellStart){
      if(!_geoParkModeOn&&(nowMs-_parkDwellStart)>=_GEO_PARK_AFTER_MS)_geoEnterParkMode(_parkSpot);
      else _geoArmParkTimer(_parkSpot);
    }else{
      _geoClearParkTimer();
    }
  }
  // Whatever branch ran, THIS completed ping resolved any hidden gap, a stale
  // marker must never truncate a later, fully-visible close.
  _geoGapHiddenAt=null;
  // Stamped AFTER the state machine, so the very ping that opens the drive
  // (already at road speed) lights the banner rather than the one after it.
  if(_geoDriveStartedAt&&!_geoMphHeldZero&&_geoDriveMph*0.44704>=_GEO_DRIVEBY_SPEED_MPS)_geoDriveMovingAt=nowMs;
  // The open state goes to disk on a cadence, not only on hide/park/arrival:
  // a crash between those moments used to take the open leg and its origin
  // down with it. Ten seconds bounds the loss to one fix, and the write is a
  // few kilobytes of localStorage, so the cost is nothing.
  if(nowMs-_geoPersistPingMs>=10000){_geoPersistPingMs=nowMs;_geoPersistOpen();}
  // The lock screen / Dynamic Island card mirrors this same state, and it is
  // updated OUTSIDE the dashboard-visible check below on purpose: the whole
  // point of a Live Activity is that it keeps working while the app is closed
  // and no page is rendered. Safe to call every ping, it drops unchanged ones
  // itself rather than spending an ActivityKit update (js/live-activity.js).
  if(typeof _liveActDrive==='function')_liveActDrive();
  // ── Drive banner upkeep ───────────────────────────────────────────────────
  // Visibility can change WITHOUT a fence transition (speed crossing the
  // threshold a ping after leaving, or fading after parking somewhere
  // unknown), so it gets its own render trigger. Between transitions the
  // numbers tick in place, a full renderDash per ping would be wasted work.
  if(typeof document!=='undefined'&&document.getElementById('pg-dash')?.classList.contains('active')){
    const _drv=_geoDriving();
    if(_drv!==_geoDriveShown){
      _geoDriveShown=_drv;
      if(typeof renderDash==='function')renderDash();
    }else if(_drv){
      const _miEl=document.getElementById('dash-drive-mi');
      if(_miEl)_miEl.textContent=_geoDriveMiles.toFixed(1)+' mi';
      const _mphEl=document.getElementById('dash-drive-mph');
      if(_mphEl)_mphEl.textContent=Math.round(_geoDriveMph)+' mph';
      const _minEl=document.getElementById('dash-drive-min');
      if(_minEl)_minEl.textContent=Math.max(0,Math.round((nowMs-Date.parse(_geoDriveStartedAt))/60000))+' min';
    }
  }else{
    _geoDriveShown=_geoDriving();
  }
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
function _geoClosePlaceEntry(placeId,arrivedAt,departedIso){
  if(!arrivedAt)return;
  const departed=departedIso||new Date().toISOString();
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
// ── Client-address fences (owner report 2026-08-07) ─────────────────────────
// "Home office to John Doe logged nothing", with the app open the whole
// drive: a spontaneous visit to a client with no job on today's calendar had
// nowhere to ARRIVE. The fence machine only knew today's scheduled jobs, the
// shop, and saved places, so the client's driveway read as an anonymous
// roadside stop, and the detour collapse then folded it into the round trip
// as personal wandering. Clients' addresses are already geocoded and cached
// for the dashboard's nearby-job card (zp3_nearby_geo, js/jobs.js); the
// fence machine reads that SAME cache, so arriving at any client is a real
// destination whether or not work is scheduled.
//
// Cache-only on purpose: a ping handler must never burn a live geocode, and
// checkNearbyJob is already the thing that warms the cache on dashboard
// loads. A brand-new client's first visit can therefore still be missed
// until the cache has seen their address once; that is the same warm-up the
// nearby-job card has always had.
// The parse is memoized briefly because watchPosition can tick at 1Hz while
// driving and the cache blob only changes on a geocode backfill.
let _geoClientCacheMemo=null,_geoClientCacheAt=0;
function _geoClientAt(here){
  if(typeof clients==='undefined'||!clients.length)return null;
  const now=Date.now();
  if(!_geoClientCacheMemo||now-_geoClientCacheAt>30000){
    _geoClientCacheMemo=(typeof _nearbyGeoCache==='function')?_nearbyGeoCache():{};
    _geoClientCacheAt=now;
  }
  let best=null,bestFt=Infinity;
  for(const c of clients){
    if(!c||!c.addr)continue;
    const hit=_geoClientCacheMemo[c.id];
    if(!hit||hit.addr!==c.addr)continue;
    const ft=_geoDistFt(here,{lat:hit.lat,lng:hit.lon});
    if(ft<=_geoFenceFt()&&ft<bestFt){
      best={id:c.id,name:c.name||'Client',addr:c.addr||'',lat:hit.lat,lng:hit.lon};
      bestFt=ft;
    }
  }
  return best;
}
// Same "won, no job record yet" definition as the client-card's own
// needs-attention flag (js/clients.js _jobForBid, owner-approved 2026-08-17)
// and the dashboard queue built on it (js/dashboard.js _readyQueueBids), just
// asked for one client instead of listed for all of them. Kept in sync with
// both by construction: same three fields, same "any job at all" check.
function _geoHasQueuedBid(clientId){
  if(!clientId||typeof bids==='undefined'||typeof jobs==='undefined')return false;
  const hasJob=b=>jobs.some(j=>j.bid_id===b.id||(!j.bid_id&&j.client_id===b.client_id&&(j.name||'')===(b.name||'')));
  return bids.some(b=>String(b.client_id)===String(clientId)&&b.status==='Closed Won'&&!b.completion_date&&!hasJob(b));
}
// The visit itself, closed on departure: same shape as a place visit (the
// client's name is the destination), so it lands in the day's story and the
// Time at Places report without a new table or source.
function _geoCloseClientEntry(clientId,arrivedAt,departedIso){
  if(!arrivedAt)return;
  const departed=departedIso||new Date().toISOString();
  const mins=Math.max(0,Math.round((Date.parse(departed)-Date.parse(arrivedAt))/60000));
  if(mins<2)return;               // a pass-through, not a visit
  if(!_supaUser)return;
  const c=(typeof clients!=='undefined')?clients.find(x=>String(x.id)===String(clientId)):null;
  _geoEnqueue('job_time_entries',{
    contractor_user_id:_geoCid(),employee_user_id:_supaUser.id,
    job_id:null,arrived_at:arrivedAt,departed_at:departed,minutes:mins,
    dest_place:(c&&c.name)||null,source:'place'
  });
}
// A stop is only real once they LEAVE it, which is also the first moment it can
// be bounded at both ends. Both edges use a VERIFIED ping rather than now: the
// same rule the hidden-gap close follows, never claim time nobody observed.
// The stop's own location descriptor. A stop has no geocode, so it is its own
// endpoint. `likelyHome` rides along because a leg that STARTS at home is a
// commute, and a commute is not a deductible mile however plainly the GPS saw
// it. A likely-home stop is NAMED (owner report 2026-08-09: "drove FBC to
// home and it didn't log"): "Home" is a real endpoint on the log, and naming
// it also keeps _geoCollapseDetours from folding the end of the day away as
// if it were a passed-through errand.
function _geoStopLoc(a,ms){
  const atHome=(typeof _placeIsLikelyHome==='function')&&_placeIsLikelyHome({lat:a.lat,lng:a.lng},ms);
  return {lat:a.lat,lng:a.lng,kind:'stop',likelyHome:atHome,
          name:atHome?(S.homeOffice?'Home Office':'Home'):'Stop'};
}
// SETTLE THE LEG WHEN THEY PARK, NOT WHEN THEY LEAVE (owner report
// 2026-08-09: FBC -> lunch -> home logged nothing).
//
// The inbound leg used to be written by _geoCloseStop, which only runs on
// DEPARTURE from the stop. Park at home for the night and the leg you just
// drove has nowhere to be written: the anchor lives in memory only, the shell
// kills GPS four minutes into the park, and iOS eventually kills the app, so
// the last drive of the day evaporated. Worse, that is exactly the leg a
// contractor looks for the moment they walk in the door.
//
// Once a stop is real (the app's own five-minute definition, or the moment
// park mode is about to cut GPS) the leg into it is written immediately and
// the leg is split at the kerb. Idempotent via a.legClosed, so the later
// departure never double-logs. A stop that turns out to be a passed-through
// errand is still folded by _geoCollapseDetours on the next fence arrival,
// which removes this row and rewrites the direct one, unchanged.
function _geoSettleStopLeg(a,nowIso){
  if(!a||a.legClosed||!_geoDriveStartedAt)return false;
  // Fold any earlier personal stop FIRST, so the row written here runs from
  // the last real endpoint (the CPA rule: a lunch stop in the middle makes
  // one trip with a detour, not two trips).
  _geoCollapseDetours();
  const ms=Math.max(0,Date.parse(a.lastAt||nowIso)-Date.parse(a.at));
  const stopLoc=_geoStopLoc(a,ms);
  stopLoc.prevOrigin=_geoLegOrigin||null;
  _geoDriveEntry(null,_geoDriveStartedAt,null,a.at,false,stopLoc);
  a.legClosed=true;
  _geoDriveStartedAt=a.lastAt||nowIso;   // the leg out starts when they pull away
  _geoDriveReset();
  _geoLegOrigin=stopLoc;
  return true;
}
function _geoCloseStop(a){
  if(!a||!a.at||!a.lastAt)return;
  const ms=Date.parse(a.lastAt)-Date.parse(a.at);
  if(!(ms>=_GEO_STOP_MS))return;          // a light, not a stop
  const mins=Math.max(0,Math.round(ms/60000));
  // Already settled when they parked: the leg and the split are done, only
  // the departure time needs refining to the last fix seen at the kerb.
  if(a.legClosed){
    _geoDriveStartedAt=a.lastAt;
    _geoDriveReset();
    if(typeof recordUnknownStop==='function')recordUnknownStop({lat:a.lat,lng:a.lng},ms);
    if(!_supaUser)return;
    _geoEnqueue('job_time_entries',{
      contractor_user_id:_geoCid(),employee_user_id:_supaUser.id,
      job_id:null,arrived_at:a.at,departed_at:a.lastAt,minutes:mins,
      dest_place:null,source:'stop'
    });
    return;
  }
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
  // the kerb they parked at, and the outbound leg starts from the same spot
  // (_geoStopLoc above owns that descriptor and the home naming).
  const stopLoc=_geoStopLoc(a,ms);
  // Where the leg INTO this stop began, carried on the stop itself. If the stop
  // turns out to be personal, that is the point the next leg has to be measured
  // from: a lunch break in the middle of a supply-house-to-job-site run does not
  // make two trips out of one, it makes one trip with a detour in it, and only
  // the direct miles between the two business points are deductible (owner's
  // CPA, 2026-08-02). Recorded before the reassignment below, which is the only
  // moment it is still known.
  stopLoc.prevOrigin=_geoLegOrigin||null;
  if(_geoDriveStartedAt)_geoDriveEntry(null,_geoDriveStartedAt,null,a.at,false,stopLoc);
  _geoDriveStartedAt=a.lastAt;
  _geoDriveReset();   // the banner's "this trip" restarts with the leg out of the stop
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
// A personal stop must not become the origin of the next leg. Called once the
// business at the pin is known (mileage.js _autoNameStopTrip), which is always
// AFTER the stop closed, because it takes a round trip to Apple to find out.
//
// Returns whether it actually restored anything: false means they have already
// reached the next fence and the leg out of here was measured from the stop, so
// the caller has to fix that row instead. Both paths exist because which one
// happens depends on how long they were parked against how long Apple took, and
// a deduction must not turn on that.
function _geoPassThroughStop(stopLoc){
  if(!stopLoc||_geoLegOrigin!==stopLoc)return false;
  _geoLegOrigin=stopLoc.prevOrigin||null;
  return true;
}
// Personal wandering must not fragment the deductible chain (owner report,
// 2026-08-07: Home Depot → Jefferson's → PetSmart → home logged
// "Home Depot -> Stop" as a deductible trip and never finished the leg home).
// _autoNameStopTrip already collapses a stop Apple NAMES as food; this closes
// the other half of the same rule: on reaching the next REAL fence, any
// intervening stop that is still anonymous ("Stop", no tenant answer) and has
// no same-day receipt at its pin is a detour, not a destination. Its inbound
// row comes off the log, breadcrumbed onto the surviving row exactly like the
// named-personal path (so reviewDetourReceipts can still rebuild it), and the
// leg being written now measures from the last real endpoint: the row reads
// "Home Depot -> Home Office" at direct miles, per the owner's CPA rule that
// only the direct miles between two business points are deductible.
//
// The chain BREAKS (stops collapsing) at: a stop Apple named (a real tenant,
// business until proven otherwise), a receipted stop (proven business), or a
// likely-home stop (home ends a day's chain whatever else is true). Honest
// limit: an unnamed collapsed stop whose receipt gets typed in days later can
// only be matched by the receipt's own geo-stamp, since there is no vendor
// name on the crumb to match against.
function _geoCollapseDetours(){
  try{
    if(typeof mileage==='undefined')return;
    let guard=8,changed=false;
    while(guard-->0&&_geoLegOrigin&&_geoLegOrigin.kind==='stop'&&_geoLegOrigin.prevOrigin){
      const stop=_geoLegOrigin;
      if(stop.likelyHome)break;
      if(stop.name&&stop.name!=='Stop')break;
      const idx=mileage.findIndex(m=>m&&m.gps&&m.toCoord&&
        Math.abs(m.toCoord.lat-stop.lat)<=1e-5&&Math.abs(m.toCoord.lng-stop.lng)<=1e-5);
      const inbound=idx>=0?mileage[idx]:null;
      const day=(inbound&&inbound.date)||todayKey();
      // _bizReceiptForStop, not expenseForStop: vehicle-operating money is
      // inside the mileage rate and can never make a stop a business
      // destination (js/mileage.js owns that rule).
      if(typeof _bizReceiptForStop==='function'&&_bizReceiptForStop({lat:stop.lat,lng:stop.lng,name:stop.name,day}))break;
      if(idx>=0)mileage.splice(idx,1);
      const back=stop.prevOrigin;
      back.passedThrough={stop:{lat:stop.lat,lng:stop.lng,name:stop.name||'Stop',addr:'',kind:'stop'},
                          day,leg:inbound||undefined,origin:back};
      // The dropped sub-leg's wheel time rides onto the surviving direct row.
      if(inbound&&inbound.mins)back.extraDriveMins=(back.extraDriveMins||0)+inbound.mins;
      _geoLegOrigin=back;
      changed=true;
    }
    if(changed&&typeof saveAll==='function')saveAll();
  }catch(_e){}
}
// `endedIso` closes the leg at an earlier verified moment than now: the moment
// they parked, when the stop that follows is not driving.
function _geoDriveEntry(jobId,driveStartedAt,destPlace,endedIso,gap,destLoc,stale){
  if(!driveStartedAt)return;
  const arrived=endedIso||new Date().toISOString();
  const mins=Math.max(0,Math.round((Date.parse(arrived)-Date.parse(driveStartedAt))/60000));
  // FENCE-BOUNCE GUARD (owner report 2026-08-09: two 2-minute "FBC to FBC
  // trips" from GPS jitter at one church). A leg that starts and ends at the
  // SAME location with almost no movement observed is a fix that wobbled
  // across the fence line, not a drive: no time entry, no mileage row. A
  // real out-and-back loop from the same door survives on the moved-miles
  // test; the rolling straight-line accumulator is reset per leg.
  let sameSpot=false;
  if(destLoc&&_geoLegOrigin&&!stale){
    const sameId=(destLoc.placeId&&destLoc.placeId===_geoLegOrigin.placeId)||
                 (destLoc.clientId&&destLoc.clientId===_geoLegOrigin.clientId)||
                 (destLoc.jobId&&destLoc.jobId===_geoLegOrigin.jobId);
    sameSpot=sameId||(_geoLegOrigin.lat!=null&&_geoDistFt(destLoc,{lat:_geoLegOrigin.lat,lng:_geoLegOrigin.lng})<400);
    if(sameSpot&&_geoDriveMiles<0.3)return;
  }
  // ── GAP-ECHO GUARD (owner 2026-08-12: four real drives, SEVEN rows) ──────
  // A GAP leg is INFERRED: a single ping bridged the whole drive, and the
  // origin comes from fence state (_geoLastFenceAt/_geoLastFenceLoc) that
  // survives boots. A day of crash/reopen cycles therefore RE-derives the
  // same journey on every wake that lands at the destination with stale
  // state, each time minting a fresh leg key and a fictional clock, which
  // is exactly the shape the dedup must not touch (distinct auto legs).
  // The discriminator is time-ordered coverage: if an auto row for this
  // person already runs this same origin -> destination and was logged
  // SINCE the moment we were last seen at the origin, this close is an
  // echo of that row, not a drive: no mileage, no time entry. A genuine
  // second run of the same route survives because its predecessor was
  // logged BEFORE the origin was re-visited.
  //
  // STALE legs only: an echo's defining feature is fence state HOURS out of
  // date (a restored pre-drive snapshot), which is exactly the stale shape.
  // A fresh-state gap leg's inference window is real observation, and the
  // fixture worlds in CI legitimately compress clocks there.
  if(gap&&stale&&typeof mileage!=='undefined'&&Array.isArray(mileage)&&_geoLegOrigin&&destLoc){
    try{
      const _since=Date.parse(_geoLastFenceAt||'')||0;
      const _me=(_isEmployee&&_supaUser)?_supaUser.id:null;
      const _near=(c1,c2)=>!!(c1&&c2&&c1.lat!=null&&c2.lat!=null&&_geoDistFt({lat:c1.lat,lng:c1.lng},{lat:c2.lat,lng:c2.lng})<=1500);
      // _since>0 is load-bearing: with no anchor, "logged since" would match
      // the whole history and a real leg could be blocked by last week's run.
      const _covered=_since>0&&mileage.some(m=>m&&m.gps&&m.legKey&&
        (m.logged_by_id||null)===_me&&
        (Date.parse(m.loggedAt||'')||0)>=_since&&
        _near(m.fromCoord,_geoLegOrigin)&&_near(m.toCoord,destLoc));
      if(_covered){_geoParkNote('gap-echo-skip',(destLoc&&destLoc.name)||'');return;}
    }catch(_e){}
  }
  // `stale` = the departure could not be inferred (the phone was asleep across
  // the gap, see _GEO_MAX_INFERRED_LEG_MS). The two halves of a leg are split
  // deliberately here: the DISTANCE is measured geocode to geocode and is real
  // whatever the clock did, so the deduction stands; the DURATION is a number
  // nobody observed and it feeds payroll, so none is claimed. The mins<2 floor
  // is skipped for the mileage half because a stale leg is stamped zero-length
  // on purpose, and dropping it there would throw away a real drive.
  if(!stale&&mins<2)return;
  if(!_supaUser)return;
  // Only flag for mileage when employee is in a company vehicle for this shift.
  // Personal vehicle trips stay private, drive TIME is still logged (it's
  // compensable labor) but the mileage flag is omitted.
  const companyVeh=typeof _isCompanyVehicleToday==='function'&&_isCompanyVehicleToday();
  // A passenger in the company truck is not in a personal vehicle, and the row
  // should not say they were. Same money outcome (no miles either way, drive
  // time paid either way), but 'drive-rider' is what actually happened, and a
  // time entry that misdescribes the day is the kind of thing that reads badly
  // a year later in front of somebody asking questions. Still matches
  // _geoIsDriveSource (/^drive/), so every money view treats it as drive.
  const mode=(typeof _shiftVehicleMode==='function')?_shiftVehicleMode():'';
  // 'drive-unassigned', not 'drive-personal'. The time entry has to say what
  // actually happened, and what happened is that nobody recorded a vehicle.
  // Calling it personal is the same wrong assumption the mileage side used to
  // make, and it is the row somebody reads a year later. Still matches
  // _geoIsDriveSource (/^drive/), so every money view treats it as drive time.
  const kind=companyVeh?'drive':(mode==='rider'?'drive-rider':(mode==='own'?'drive-personal':'drive-unassigned'));
  // Minted here rather than inside _geoEnqueue so the SAME key lands on the time
  // entry and on the mileage row, and DETERMINISTIC (person + leg start) so a
  // re-delivered close of the same leg mints the same key again: one leg can
  // only ever produce one trip, however many times this runs. This used to be
  // _geoClientKey(), which is random per call, so a replayed arrival minted a
  // fresh key and wrote a second row the idempotency was built to block (the
  // owner's 2026-08-11 truck-reposition duplicate, same 7:51a start logged
  // twice with two end times).
  const legKey=_geoLegKey(driveStartedAt);
  if(!stale){
    _geoEnqueue('job_time_entries',{
      contractor_user_id:_geoCid(),employee_user_id:_supaUser.id,
      job_id:jobId!=null?String(jobId):null,arrived_at:driveStartedAt,departed_at:arrived,minutes:mins,
      dest_place:destPlace||null,client_key:legKey,
      source:kind+(gap?'-gap':'')
    });
  }
  // Dated to the ARRIVAL for a stale leg: the day we actually saw them, never
  // the day the phone last happened to report a fence.
  // Wheel time for the row (owner ask 2026-08-07: surface the drive's time on
  // the log): this leg's minutes plus any minutes carried off collapsed-detour
  // sub-legs. A stale leg claims none, same rule as the time entry above.
  let driveMins=stale?0:mins;
  // What the wheels actually covered this leg, straight-line ping to ping
  // (owner ask 2026-08-11: "if we take a detour because we have to, can we
  // take the longer?"). Captured BEFORE the next leg resets the tally, and
  // only when it is trustworthy: a watched leg (not stale, the tally is zero
  // fiction after a sleep) with NO collapsed detour segments, because a
  // collapsed personal stop's driving is in the tally but is not deductible
  // (the CPA's direct-miles rule). The tally UNDERcounts real roads, so as a
  // floor it can only ever recover miles that were provably driven.
  const hadDetourLegs=!!(_geoLegOrigin&&_geoLegOrigin.extraDriveMins);
  // The live anchor may still be holding an unnoted pause when the arrival
  // fence closes the leg directly (sparse pings: pizza counter to the shop
  // door in one fix). Note it before the floor is judged.
  _geoNotePause(_geoStopAnchor);
  // ...and only from a leg that was DENSELY watched (>=8 accumulation hops).
  // A tally built from a couple of hops is the undercount case by definition,
  // it cannot evidence a detour; a real drive produces dozens of hops.
  // ...and never from a leg with a PAUSE in it (owner's Domino's run,
  // 2026-08-13: a 3-minute pickup mid-route made the observed tally beat the
  // route and the errand's extra miles got claimed). A paused leg had an
  // errand; the direct route is the deductible answer, so the floor stands
  // down. A genuinely forced detour never sits still for 2.5 minutes.
  const obsMiles=(!stale&&!hadDetourLegs&&!_geoDriveHadPause&&_geoDriveSteps>=8&&_geoDriveMiles>0.3)?Math.round(_geoDriveMiles*10)/10:null;
  if(!stale&&_geoLegOrigin&&_geoLegOrigin.extraDriveMins){driveMins+=_geoLegOrigin.extraDriveMins;delete _geoLegOrigin.extraDriveMins;}
  // ── OUT AND BACK WITH NOTHING BUSINESS IN IT ─────────────────────────────
  // Owner rule (2026-08-10): "a drive from home office shop and back shouldn't
  // count either unless there was a business stop that day."
  //
  // This is the other half of the Target run. Once the personal stop is
  // collapsed out of the middle (_geoCollapseDetours / the personal branch in
  // mileage.js), what is left is a leg whose ORIGIN AND DESTINATION ARE THE
  // SAME PLACE. That shape can only ever mean a round trip with nothing
  // business in it, because a business stop would have ENDED the leg there and
  // started a new one: shop to supply house to shop is two legs, neither of
  // which starts and ends in the same spot. So same place in, same place out,
  // no miles.
  //
  // The DRIVE TIME still goes in, above. A crew member driving is being paid
  // for it whatever the errand turned out to be, and stripping the hours would
  // be a payroll bug dressed up as a mileage fix. Only the deduction goes.
  //
  // Distinct from the fence-bounce guard higher up, which drops the whole leg
  // including the time, because that one never happened at all.
  if(sameSpot){
    _geoParkNote('roundtrip-no-miles',destLoc&&(destLoc.name||destLoc.kind)||'');
    return;
  }
  // The arrival stamp rides along so the row can show WHEN the trip ran, not
  // just how long: a stale leg passes nothing, its clock times are fiction.
  _geoAutoMileage(_geoLegOrigin,destLoc,legKey,stale?arrived:driveStartedAt,companyVeh,driveMins,stale?null:arrived,obsMiles);
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
function _geoAutoMileage(from,to,legKey,startedIso,companyVeh,driveMins,endedIso,obsMiles){
  try{
    if(typeof autoLogDriveTrip!=='function')return;
    if(!from||!to||from.lat==null||to.lat==null)return;
    // THE VEHICLE RULE (owner, 2026-08-01). An employee's miles are the
    // business's miles only when they are in the business's truck; in their own
    // car the drive TIME is still theirs to be paid for, but the mileage is not
    // the company's to deduct. The owner IS the business, so any vehicle counts,
    // which is the entire point of the standard mileage deduction.
    // An employee in their own car: the miles are NOT the owner's to deduct, but
    // they are still miles the business may owe them for. California Labor Code
    // 2802 and its equivalents make that a legal obligation, and dropping the row
    // (which is what used to happen here) left the contractor with no record of
    // what they owed (owner, 2026-08-02). Logged and flagged instead, and
    // deductibleTrips keeps it out of every deduction total.
    //
    // Only the DRIVER. A passenger in someone else's car put no miles on their
    // own vehicle and is owed nothing for them; they are still paid for the time.
    const mode=(typeof _shiftVehicleMode==='function')?_shiftVehicleMode():'';
    const reimbursable=!!(_isEmployee&&!companyVeh);
    // 'none' IS NOT 'own'. It means nobody said what they were in: no truck
    // assigned on the dispatch board and no pick made on their phone. Treating
    // that as a personal car booked a reimbursement the business never agreed
    // to, off a drive where the app cannot say whether they were in the company
    // truck, riding with somebody, or on a bus. It invents a debt out of a
    // blank, which is the opposite of how 'rider' is handled two lines up.
    //
    // The rule this file already states elsewhere: no pick, no mileage. The TIME
    // still logs (it is compensable and _geoDriveEntry has already enqueued it);
    // only the money claim is withheld until somebody says what was driven.
    // Owner's call, 2026-08-03.
    // RIDER still logs nothing: they were a passenger, the miles are somebody
    // else's and there is no question left to ask.
    if(reimbursable&&mode==='rider')return;
    // NOBODY SAID. Record the drive, claim nothing. It is excluded from the
    // owner's deduction AND from what the crew are owed until somebody answers,
    // and because the row exists that answer is still worth something on
    // Thursday. Dropping it left nothing to correct (owner, 2026-08-03).
    const unknown=!!(reimbursable&&(mode==='none'||!mode));
    // The one-drive-one-row guard lives in autoLogDriveTrip, not here: it is a
    // rule about the mileage log itself rather than about this account, so it
    // has to hold for every caller, the same reason the endpoint validation
    // sits down there too.
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
    autoLogDriveTrip({from,to,legKey,startedIso,endedIso:endedIso||undefined,reimbursable:unknown?undefined:reimbursable,vehicleUnknown:unknown,mins:driveMins,observedMiles:obsMiles||undefined});
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
function _stampGeo(rec,done,fieldPrefix){
  if(!rec)return;
  // fieldPrefix lets a caller record a live GPS fix WITHOUT overwriting the
  // record's own lat/lon, e.g. 'completed' writes completedLat/completedLon
  // instead of lat/lon. Used where lat/lon is already an address geocode
  // (jobs) that other lookups (day-map, geofencing) depend on staying put.
  const latK=fieldPrefix?fieldPrefix+'Lat':'lat';
  const lonK=fieldPrefix?fieldPrefix+'Lon':'lon';
  const accK=fieldPrefix?fieldPrefix+'GeoAcc':'geoAcc';
  const atK=fieldPrefix?fieldPrefix+'GeoAt':'geoAt';
  _geoCanStamp().then(ok=>{
    if(!ok)return;
    try{
      navigator.geolocation.getCurrentPosition(
        (pos)=>{
          try{
            rec[latK]=+pos.coords.latitude.toFixed(6);   // ~11cm, far more than enough
            rec[lonK]=+pos.coords.longitude.toFixed(6);
            rec[accK]=Math.round(pos.coords.accuracy||0);
            rec[atK]=new Date().toISOString();
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
  // Native shell: the WebView's per-origin permission is meaningless here,
  // the geolocation shim intentionally never grants it (owner report
  // 2026-08-08: "Turn on location" never cleared even with the watcher
  // running). The truth is the plugin watcher itself: delivering = granted.
  try{
    const _cap=window.Capacitor;
    if(_cap&&typeof _cap.isNativePlatform==='function'&&_cap.isNativePlatform()){
      if(_geoNativeWatcherId!=null)return 'granted';
      if(localStorage.getItem('geo_owner_consent')==='declined')return 'denied';
      // The plugin's watcher reported an OS-level permission failure and no
      // success since: the phone's Settings are the only fix, say so.
      if(localStorage.getItem('td_geo_os_denied')==='1')return 'denied';
      // Consent given on this device and no denial on record: granted. This
      // is what makes the checklist SURVIVE sign-out/sign-in (owner report
      // 2026-08-08: "onboarding didn't persist my location"): the watcher
      // takes seconds to spin up after sign-in, and gating 'granted' on it
      // alone re-flashed the item on every boot.
      if(localStorage.getItem('geo_owner_consent')==='1')return 'granted';
      return 'prompt';
    }
  }catch(_e){}
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

// Foreground return: don't wait for watchPosition to get around to it. The
// watch runs with maximumAge:30000, so its first delivery after a wake can
// legally be a CACHED fix from before the phone slept, reading "still on
// site" while the user stands in their kitchen (owner report 2026-08-06:
// banner didn't clear/appear in real time on arriving home). Ask for a fresh
// fix NOW (maximumAge:0, cached positions not allowed), and a second one a
// few seconds later so the two-fix exit confirmation (_geoExitPending)
// can settle within seconds of reopening the app instead of minutes.
let _geoNudgeTimer=null;
function _geoWakeNudge(){
  if(_geoWatchId==null&&_geoNativeWatcherId==null)return; // tracking not running, nothing to resolve
  if(!navigator.geolocation)return;
  const fresh=()=>{try{navigator.geolocation.getCurrentPosition(_geoOnPing,()=>{},{enableHighAccuracy:true,maximumAge:0,timeout:15000});}catch(_e){}};
  fresh();
  if(_geoNudgeTimer)clearTimeout(_geoNudgeTimer);
  _geoNudgeTimer=setTimeout(()=>{
    _geoNudgeTimer=null;
    if(!document.hidden&&(_geoWatchId!=null||_geoNativeWatcherId!=null))fresh();
  },8000);
}
// ── Native-shell bridge (Capacitor) ───────────────────────────────────────────
// The one thing a web app can never have is GPS while backgrounded or locked,
// and it is the one input this whole engine is missing (owner, 2026-08-07:
// automatic background drives for the people who can run their town without
// nav). When the app runs inside a Capacitor shell with the free
// @capacitor-community/background-geolocation plugin, its background watcher
// keeps delivering fixes with the screen off; every fix is shaped into the
// SAME position object watchPosition delivers and fed to _geoOnPing, so the
// entire fence machine (arrive/depart, time on site, drive legs, mileage)
// works in the background with zero logic changes. In a plain browser none of
// this exists and the web watcher below runs exactly as before.
let _geoNativeWatcherId=null;  // the plugin's watcher handle while active
let _geoNativeStarting=false;  // addWatcher is async; never double-add
function _geoNativePlugin(){
  try{
    const cap=window.Capacitor;
    if(!cap||typeof cap.isNativePlatform!=='function'||!cap.isNativePlatform())return null;
    if(typeof cap.registerPlugin==='function')return cap.registerPlugin('BackgroundGeolocation');
    return (cap.Plugins&&cap.Plugins.BackgroundGeolocation)||null;
  }catch(_e){return null;}
}
// ── Native geolocation shim: the plugin is the ONLY GPS source in the shell ──
// Any web-API call (navigator.geolocation.*) inside WKWebView pops Apple's
// per-WEBSITE prompt ("uat...pages.dev would like to use your location") even
// when the app already holds OS permission (owner report 2026-08-08,
// screenshot). Several legit features ask the web API for a position
// (weather, the nearby-job card, trip start addresses), so rather than chase
// every call site forever, the web API itself is replaced with a shim served
// from the plugin's fix stream: same callback shapes, zero website prompts,
// and every caller inherits native-grade fixes for free. Browser/PWA:
// untouched, the shim only installs inside the shell.
let _geoLastNativeFix=null;   // last position object delivered by the plugin
let _geoFixWaiters=[];        // pending getCurrentPosition callbacks
let _geoShimWatchers={};      // synthetic watchPosition subscribers
let _geoShimWatchSeq=1;
function _geoShimPos(loc){
  return {coords:{latitude:loc.latitude,longitude:loc.longitude,
                  accuracy:loc.accuracy||0,
                  speed:(typeof loc.speed==='number'?loc.speed:null),
                  heading:null,altitude:null,altitudeAccuracy:null},
          timestamp:(loc.time||Date.now()),__at:Date.now()};
}
function _geoShimDeliver(pos){
  _geoLastNativeFix=pos;
  const w=_geoFixWaiters;_geoFixWaiters=[];
  w.forEach(x=>{try{clearTimeout(x.t);x.ok(pos);}catch(_e){}});
  Object.keys(_geoShimWatchers).forEach(id=>{try{_geoShimWatchers[id](pos);}catch(_e){}});
}
function _geoInstallGeoShim(){
  try{
    const cap=window.Capacitor;
    if(!cap||typeof cap.isNativePlatform!=='function'||!cap.isNativePlatform())return false;
    if(!navigator.geolocation)return false;
    navigator.geolocation.getCurrentPosition=function(ok,err,opts){
      try{
        // A recent plugin fix answers instantly, and generously: for the
        // callers that live here (weather, nearby card, trip address), a
        // two-minute-old fix is truth.
        if(_geoLastNativeFix&&(Date.now()-_geoLastNativeFix.__at)<=Math.max((opts&&opts.maximumAge)||0,120000)){ok(_geoLastNativeFix);return;}
        const waiter={ok,t:null};
        waiter.t=setTimeout(()=>{
          _geoFixWaiters=_geoFixWaiters.filter(x=>x!==waiter);
          if(typeof err==='function')err({code:3,message:'no native fix available'});
        },(opts&&opts.timeout)||20000);
        _geoFixWaiters.push(waiter);
        // Main tracking not running (consent pending/declined): a silent
        // one-shot plugin watcher, requestPermissions:false so this path can
        // never itself become a prompt of any kind.
        if(_geoNativeWatcherId==null&&!_geoNativeStarting){
          const BG=_geoNativePlugin();
          if(BG&&typeof BG.addWatcher==='function'){
            // Persisted like the main watcher: a reload mid-one-shot would
            // otherwise orphan it natively (same leak as the big one).
            let oneId=null,done=false;
            const oneDrop=()=>{if(oneId){try{BG.removeWatcher({id:oneId});}catch(_e){}_geoForgetWatcher(oneId);oneId=null;}};
            Promise.resolve(BG.addWatcher({requestPermissions:false,stale:true},(loc)=>{
              if(loc&&!done){done=true;_geoShimDeliver(_geoShimPos(loc));}
              oneDrop();
            })).then(id=>{oneId=id;_geoRememberWatcher(id);if(done)oneDrop();},()=>{});
          }
        }
      }catch(_e){if(typeof err==='function')err({code:2,message:String(_e&&_e.message||_e)});}
    };
    navigator.geolocation.watchPosition=function(ok){
      const id=_geoShimWatchSeq++;
      _geoShimWatchers[id]=ok;
      if(_geoLastNativeFix){try{ok(_geoLastNativeFix);}catch(_e){}}
      return id;
    };
    navigator.geolocation.clearWatch=function(id){delete _geoShimWatchers[id];};
    return true;
  }catch(_e){return false;}
}
// ── TdGeo park mode: GPS off while parked, geofence hardware watches ──────────
// The continuous background watcher above is what pins the blue arrow in the
// Dynamic Island and drains the battery all evening at the home office (owner
// report 2026-08-08). Parked inside a fence for a few minutes, the native TdGeo
// plugin (native/td-geo) takes over: full GPS goes OFF, and iOS's near-free
// region monitoring + significant-location-change hardware watches for
// departure. Crossing the fence re-arms the full watcher, and every native
// event that fired while the WebView was asleep or dead is buffered to disk
// and replayed into the fence machine (with its ORIGINAL timestamp) on the
// next boot, so a drive that started with the app killed still logs.
let _geoParkTimer=null;         // countdown from fence entry to GPS-off
let _geoParkModeOn=false;       // TdGeo regions armed, continuous watcher removed
let _geoFenceEnteredAtMs=null;  // when the CURRENT fence was entered (dwell clock)
const _GEO_PARK_AFTER_MS=4*60*1000;  // parked this long inside a fence => GPS off
// "Parked" means NOT DRIVING, not "not moving". A phone in the pocket of
// somebody WALKING drifts past _GEO_STOP_FT every minute or two, so the stop
// anchor re-births forever and its dwell never reached four minutes: GPS ran
// all day on foot (owner report 2026-08-09: "I walk everywhere with my
// phone"). This clock marks when driving-speed evidence was last seen;
// walking pace and jitter hold it, and four quiet minutes park the GPS
// wherever they happen to be standing.
let _geoQuietSinceMs=null;   // ms when "below driving speed" began, null while driving
let _geoParkPrevFix=null;    // {lat,lng,atMs,acc} prior fix, derives speed when the device reports none
// Owner-readable diagnostics (owner report 2026-08-09: "30 minutes and still
// got that blue arrow", with zero visibility into why). Every park-mode
// transition and failure is journaled here, persisted, and readable on-device
// through _geoDiagPanel(), so the next report comes with the reason attached.
let _geoParkLog=[];
try{_geoParkLog=JSON.parse(localStorage.getItem('td_geo_park_log')||'[]')||[];}catch(_e){}
function _geoParkNote(ev,extra){
  try{
    _geoParkLog.push({t:new Date().toISOString().slice(5,19),ev:ev,x:extra?String(extra).slice(0,140):''});
    if(_geoParkLog.length>30)_geoParkLog.splice(0,_geoParkLog.length-30);
    localStorage.setItem('td_geo_park_log',JSON.stringify(_geoParkLog));
  }catch(_e){}
}
function _geoTdPlugin(){
  try{
    const cap=window.Capacitor;
    if(!cap||typeof cap.isNativePlatform!=='function'||!cap.isNativePlatform())return null;
    if(typeof cap.registerPlugin==='function')return cap.registerPlugin('TdGeo');
    return (cap.Plugins&&cap.Plugins.TdGeo)||null;
  }catch(_e){return null;}
}
let _geoParkSpot=null;   // where to center the region when the countdown fires
function _geoArmParkTimer(spot){
  if(spot)_geoParkSpot=spot;
  if(_geoParkTimer||_geoParkModeOn)return;
  if(!_geoTdPlugin())return;             // browser/PWA: park mode does not exist
  _geoParkTimer=setTimeout(()=>_geoEnterParkMode(_geoParkSpot),_GEO_PARK_AFTER_MS);
}
function _geoClearParkTimer(){
  if(_geoParkTimer){clearTimeout(_geoParkTimer);_geoParkTimer=null;}
}
// One question, one place, and a seam the pocket-condition tests can stub.
function _geoAppOnScreen(){try{return typeof document!=='undefined'&&document.visibilityState==='visible';}catch(_e){return false;}}
function _geoEnterParkMode(spot){
  _geoClearParkTimer();
  if(_geoParkModeOn)return;
  // The battery trade is for the POCKET, not the dashboard. Park mode with the
  // app on screen is how the owner's drive banner started a quarter mile late
  // (2026-08-11): the GPS was off while they were looking at the app, and the
  // iOS wake-up region fires hundreds of meters past the fence. On screen =
  // GPS stays live; the countdown re-arms, and the firing after the app is
  // backgrounded parks for real.
  if(_geoAppOnScreen()){
    _geoParkNote('park-defer','app on screen');
    _geoArmParkTimer(spot);
    return;
  }
  const Td=_geoTdPlugin();
  if(!Td||typeof Td.startParked!=='function')return;
  // Only duty-cycle a watcher that is actually running, and only when we know
  // where we are parked: a fence, or (owner report 2026-08-09, arrow still on
  // after 4 minutes parked outside every fence) the anonymous STOP anchor.
  if(_geoNativeWatcherId==null&&!_geoNativeStarting){_geoParkNote('park-skip','no watcher');return;}
  const _at=spot||_geoLastFenceLoc;
  if(!_at){_geoParkNote('park-skip','no park spot');return;}
  // LAST CHANCE BEFORE THE GPS GOES DARK. Parking cuts the fix stream, and
  // iOS may kill the app long before they drive off, so any leg still open
  // into this stop is settled here or it is lost (owner report 2026-08-09:
  // the drive home never logged).
  if(_geoStopAnchor&&_geoDriveStartedAt)_geoSettleStopLeg(_geoStopAnchor,new Date().toISOString());
  // Parking is the moment we know the app may not be alive for the next fix,
  // so the open leg and its ORIGIN go to disk here rather than relying on a
  // screen-lock event that may already have passed.
  _geoPersistOpen();
  // The region is the fence plus slack: region monitoring is coarser than GPS
  // (cell/wifi assisted), and an exit that fires a little late is fine, the
  // re-armed watcher's first fix re-runs the fence machine with real truth.
  // An anonymous stop/foot park gets a wider region (250m floor): somebody
  // parked on foot keeps strolling, and a lap around the yard or the block
  // must not ping-pong the GPS awake every couple of minutes.
  const radiusM=_at.name==='stop'
    ?Math.max(_geoFenceFt()*0.3048+60,250)
    :_geoFenceFt()*0.3048+60;
  _geoParkNote('park-try',_at.name||'stop');
  Promise.resolve(Td.startParked({regions:[{id:'fence',lat:_at.lat,lng:_at.lng,radius:radiusM}]}))
    .then((r)=>{
      _geoParkModeOn=true;
      _geoParkNote('park-on','armed='+((r&&r.armed)!=null?r.armed:'?'));
      if(_geoNativeWatcherId!=null){
        const BG=_geoNativePlugin();
        try{if(BG&&typeof BG.removeWatcher==='function')BG.removeWatcher({id:_geoNativeWatcherId});}catch(_e){}
        _geoForgetWatcher(_geoNativeWatcherId);
        _geoNativeWatcherId=null;
        if(typeof _shadowLiveGpsStop==='function')_shadowLiveGpsStop();
      }
    },(err)=>{
      // A failed attempt must never die silently (it did, and the arrow sat
      // there all evening): journal the reason and retry on the countdown.
      _geoParkNote('park-fail',(err&&(err.message||err.code))||err);
      _geoArmParkTimer();
    });
}
function _geoExitParkMode(){
  _geoClearParkTimer();
  if(!_geoParkModeOn)return;
  _geoParkModeOn=false;
  // Fresh observation window on wake: if this exit was a real drive the next
  // fixes clear the quiet clock; if it was a walk out of the region, GPS gets
  // four minutes to confirm and then parks again at the new spot.
  _geoQuietSinceMs=Date.now();_geoParkPrevFix=null;
  _geoParkNote('park-exit');
  const Td=_geoTdPlugin();
  try{if(Td&&typeof Td.stopAll==='function')Td.stopAll();}catch(_e){}
  startGeoTracking();
}
// crew-locate.js loads after this file, so the journal is read through a guard
// rather than called directly.
function _geoLocateHistory(){
  try{return (typeof _crewLocateHistory==='function')?(_crewLocateHistory()||[]):[];}catch(_e){return [];}
}
// On-device diagnostics: state + the park journal, in a standard zmodal.
// Reachable from Settings (the button unhides only inside the shell).
function _geoDiagCopy(){
  const txt=window.__geoDiagText||'';
  const done=()=>{try{if(typeof showToast==='function')showToast('Copied. Paste it in a message.','\ud83d\udccb');}catch(_e){}};
  try{
    navigator.clipboard.writeText(txt).then(done,()=>{
      const ta=document.createElement('textarea');ta.value=txt;ta.style.cssText='position:fixed;top:-1000px';
      document.body.appendChild(ta);ta.select();try{document.execCommand('copy');}catch(_e){}ta.remove();done();
    });
  }catch(_e){}
}
function _geoDiagPanel(){
  if(document.getElementById('_geo-diag-ov'))return;
  const dwellMin=_geoFenceEnteredAtMs?Math.round((Date.now()-_geoFenceEnteredAtMs)/60000):null;
  const state=[
    ['Shell',(_geoTdPlugin()?'yes':'no')],
    ['GPS watcher',_geoNativeWatcherId!=null?String(_geoNativeWatcherId):'off'],
    ['Park mode',_geoParkModeOn?'ON (GPS off)':'off'],
    ['Park countdown',_geoParkTimer?'running':'idle'],
    ['In fence',_geoLastFenceLoc?((_geoLastFenceLoc.name||_geoLastFenceLoc.kind||'yes')+(dwellMin!=null?' · '+dwellMin+' min':'')):'no'],
    ['Below drive speed',_geoQuietSinceMs?Math.round((Date.now()-_geoQuietSinceMs)/60000)+' min':'no (moving)'],
    ['Consent',localStorage.getItem('geo_owner_consent')||'unset'],
    ['OS denied',localStorage.getItem('td_geo_os_denied')==='1'?'yes':'no'],
    // The mileage side of the same story: a sweep that never ran is the
    // difference between "the rule is wrong" and "the rule never executed",
    // and that distinction cost four rounds of guessing (owner 2026-08-15).
    ['Mileage rows',String((typeof mileage!=='undefined'&&mileage.length)||0)],
    ['Personal-stop sweep',window._milePersonalSweepRan?'ran':'not yet'],
    ['Motion sweep',window._mileMotionHealRan?'ran':'not yet'],
    ['App version',(typeof APP_VERSION!=='undefined'?APP_VERSION:'?')],
  ];
  const ov=document.createElement('div');ov.id='_geo-diag-ov';ov.className='zmodal-overlay';
  const m=document.createElement('div');m.className='zmodal';
  m.innerHTML=
    '<div style="font-size:16px;font-weight:800;margin-bottom:10px">Location diagnostics</div>'+
    state.map(([k,v])=>'<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:1px solid var(--border)"><span style="color:var(--text3)">'+k+'</span><span style="font-weight:600">'+escHtml(String(v))+'</span></div>').join('')+
    '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin:12px 0 4px">Recent events</div>'+
    '<div style="max-height:32vh;overflow-y:auto;font-size:11px;font-family:ui-monospace,monospace;line-height:1.6">'+
      (_geoParkLog.length?_geoParkLog.slice().reverse().map(r=>'<div>'+escHtml(r.t)+' '+escHtml(r.ev)+(r.x?' · '+escHtml(r.x):'')+'</div>').join(''):'<div style="color:var(--text3)">Nothing yet.</div>')+
    '</div>'+
    // A quiet record of every Locate this phone answered. Nobody is notified
    // when one happens (owner call 2026-08-09), so this exists for support and
    // for the case where a check is ever disputed, not as a crew-facing feed.
    // The panel itself is developer-gated, so it is not something crew browse.
    '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin:12px 0 4px">Locate requests</div>'+
    '<div style="max-height:20vh;overflow-y:auto;font-size:11px;line-height:1.6">'+
      (_geoLocateHistory().length
        ?_geoLocateHistory().slice().reverse().map(r=>{
            let when='';try{when=new Date(r.at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});}catch(_e){when=String(r.at||'');}
            return '<div>'+escHtml(when)+' · '+escHtml(r.by||'A manager')+' · '+escHtml(r.answered?'shared':'not shared ('+(r.reason||'')+')')+'</div>';
          }).join('')
        :'<div style="color:var(--text3)">None.</div>')+
    '</div>'+
    // Copy, because a diagnostic you cannot get OFF the phone is only half a
    // diagnostic: the owner reads it in a truck and pastes it into a message.
    '<button class="btn" style="width:100%;margin-top:14px;padding:12px" onclick="_geoDiagCopy()">Copy everything</button>'+
    '<button class="btn btn-p" style="width:100%;margin-top:8px;padding:12px" onclick="document.getElementById(\'_geo-diag-ov\').remove()">Close</button>';
  window.__geoDiagText=state.map(([k,v])=>k+': '+v).join('\n')+'\n\n'+
    _geoParkLog.slice().reverse().map(r=>(r.t||'')+' '+(r.ev||'')+(r.x?' '+r.x:'')).join('\n');
  ov.appendChild(m);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
}
// A native event, live (listener) or replayed (drainBuffer). Replayed events
// carry __tdTs so the fence machine clocks them at the moment they actually
// happened, not at boot: without that, a buffered overnight drive collapses to
// zero minutes and drops under the 2-minute floor.
async function _geoTdEvent(ev,replay){
  if(!ev||typeof ev!=='object')return;
  // The shadow engine (js/geo-shadow.js) sees the SAME raw event, so any
  // difference in what the two engines conclude is genuinely the engine and
  // not the sensor. It can only ever write to its own local journal.
  if(!replay&&typeof shadowIngest==='function'){try{shadowIngest(ev);}catch(_e){}}
  const hasFix=typeof ev.lat==='number'&&typeof ev.lng==='number';
  if(!replay&&_geoParkModeOn){
    const out=ev.type==='regionExit'||
      (hasFix&&_geoLastFenceLoc&&_geoDistFt({lat:ev.lat,lng:ev.lng},_geoLastFenceLoc)>_geoFenceFt());
    if(out)_geoExitParkMode();
  }
  if(!hasFix)return;
  return _geoOnPing({
    coords:{latitude:ev.lat,longitude:ev.lng,accuracy:ev.acc||0,
            speed:(typeof ev.speed==='number'&&ev.speed>=0)?ev.speed:null},
    __tdTs:(replay&&typeof ev.ts==='number')?ev.ts:undefined
  });
}
function _geoTdInit(){
  if(window._geoTdBound)return;
  const Td=_geoTdPlugin();
  if(!Td)return;
  window._geoTdBound=true;
  try{
    if(typeof Td.addListener==='function')Td.addListener('geoEvent',(ev)=>{_geoTdEvent(ev);});
  }catch(_e){}
  // Anything that fired while the WebView was asleep or the app was dead
  // (region monitoring relaunches a killed app) replays oldest-first, awaited
  // one at a time so the fence machine sees them in order.
  try{
    if(typeof Td.drainBuffer==='function'){
      Promise.resolve(Td.drainBuffer()).then(r=>{
        const fixes=((r&&r.fixes)||[]).slice().sort((a,b)=>(a.ts||0)-(b.ts||0));
        (async()=>{for(const f of fixes){try{await _geoTdEvent(f,true);}catch(_e){}}})();
      },()=>{});
    }
  }catch(_e){}
}
// ── Stale native watcher bookkeeping ─────────────────────────────────────────
// THE LEAK (owner report 2026-08-09, arrow on 18 minutes into park mode): a
// WebView reload (version watchdog, crash) wipes JS memory, but watchers live
// NATIVELY in the plugin and keep GPS running. Every reload added a fresh
// watcher, park/stop only ever removed the newest one, and the orphans from
// earlier reloads pinned the location arrow forever. The owner's own journal
// proved it: four watcher-on ids, one removal. Every id is therefore
// persisted the moment it exists, and every start first kills any persisted
// id that is not the current one.
function _geoRememberWatcher(id){
  if(id==null)return;
  try{
    const ids=JSON.parse(localStorage.getItem('td_geo_watcher_ids')||'[]')||[];
    if(!ids.includes(id)){ids.push(id);localStorage.setItem('td_geo_watcher_ids',JSON.stringify(ids));}
  }catch(_e){}
}
function _geoForgetWatcher(id){
  if(id==null)return;
  try{
    const ids=(JSON.parse(localStorage.getItem('td_geo_watcher_ids')||'[]')||[]).filter(x=>x!==id);
    localStorage.setItem('td_geo_watcher_ids',JSON.stringify(ids));
  }catch(_e){}
}
function _geoStaleWatcherSweep(BG){
  let ids=[];
  try{ids=JSON.parse(localStorage.getItem('td_geo_watcher_ids')||'[]')||[];}catch(_e){}
  const stale=ids.filter(id=>id!==_geoNativeWatcherId);
  stale.forEach(id=>{try{BG.removeWatcher({id});}catch(_e){}});
  try{localStorage.setItem('td_geo_watcher_ids',JSON.stringify(_geoNativeWatcherId!=null?[_geoNativeWatcherId]:[]));}catch(_e){}
  if(stale.length)_geoParkNote('stale-sweep',stale.length+' orphaned');
}
// ── Start / stop ───────────────────────────────────────────────────────────────
function startGeoTracking(){
  if(_geoWatchId!=null||_geoNativeWatcherId!=null||_geoNativeStarting)return;
  const BG=_geoNativePlugin();
  if(BG&&typeof BG.addWatcher==='function'){
    // Native shell: the background watcher also fires in the foreground, so it
    // fully replaces the web watcher rather than doubling it up.
    _geoTdInit();   // bind the park-mode event stream + replay anything buffered
    _geoStaleWatcherSweep(BG);   // kill watchers orphaned by a prior reload
    _geoNativeStarting=true;
    try{
      Promise.resolve(BG.addWatcher({
        backgroundMessage:'Logging work drives and time on site.',
        backgroundTitle:'TradeDesk tracking is on',
        requestPermissions:true,stale:false,distanceFilter:25
      },(loc,err)=>{
        if(err){
          // A permission-shaped error is the one denial signal the shell ever
          // gets (the WebView permission API is meaningless here). Recorded so
          // _geoReadPermission can honestly say 'denied' and the checklist
          // routes to the phone-Settings walkthrough.
          try{if(/permission|denied|authoriz/i.test(String(err.message||err.code||'')))localStorage.setItem('td_geo_os_denied','1');}catch(_e){}
          return;
        }
        if(!loc)return;
        try{localStorage.removeItem('td_geo_os_denied');}catch(_e){}
        // Every plugin fix also feeds the geolocation shim, so weather, the
        // nearby-job card, and trip addresses ride the same stream without
        // ever touching the web API (and its per-website prompt).
        _geoShimDeliver(_geoShimPos(loc));
        // Returned so a caller that CAN await the ping does (tests); the
        // plugin itself ignores the return value.
        return _geoOnPing({coords:{
          latitude:loc.latitude,longitude:loc.longitude,
          accuracy:loc.accuracy||0,
          speed:(typeof loc.speed==='number'?loc.speed:null)
        }});
      })).then(id=>{
        _geoNativeStarting=false;_geoNativeWatcherId=id||null;
        _geoRememberWatcher(_geoNativeWatcherId);
        // The live engine owns the radio from here; the clock that measures
        // its cost starts with it (js/geo-shadow.js).
        if(typeof _shadowLiveGpsStart==='function')_shadowLiveGpsStart();
        if(typeof startShadowEngine==='function'){try{startShadowEngine();}catch(_e){}}
        _geoParkNote('watcher-on',String(id||''));
        // Chain the Motion & Fitness ask right behind the location grant
        // (owner 2026-08-14): one consent flow, prompts in sequence, never
        // stacked. The first coprocessor query is what surfaces the dialog;
        // the errand classifier (_mileTapeHadPause, js/mileage.js) needs the
        // grant to read walk windows out of the activity history.
        try{
          const _Td=_geoTdPlugin();
          if(_Td&&typeof _Td.motionSince==='function')Promise.resolve(_Td.motionSince({sinceMs:Date.now()-60000})).catch(()=>{});
        }catch(_e){}
        // The watcher running IS the shell's 'granted' state: refresh the
        // dashboard's permission cache so "Turn on location" clears itself.
        try{if(typeof _geoRefreshPermCache==='function')_geoRefreshPermCache();}catch(_e){}
        try{if(typeof _motionRefreshPermCache==='function')_motionRefreshPermCache();}catch(_e){}
      },
               (e)=>{_geoNativeStarting=false;_geoParkNote('watcher-fail',(e&&e.message)||e);});
      return;
    }catch(_e){_geoNativeStarting=false;}
  }
  if(!navigator.geolocation)return;
  try{
    _geoWatchId=navigator.geolocation.watchPosition(_geoOnPing,()=>{},{enableHighAccuracy:true,maximumAge:30000,timeout:20000});
  }catch(_e){}
}
function stopGeoTracking(){
  // Park mode dies with tracking: regions persist in CoreLocation across app
  // kills, so sign-out must disarm them or the NEXT account's session could be
  // woken by the previous account's fence.
  _geoClearParkTimer();
  _geoParkModeOn=false;
  _geoFenceEnteredAtMs=null;
  _geoQuietSinceMs=null;_geoParkPrevFix=null;
  {const Td=_geoTdPlugin();try{if(Td&&typeof Td.stopAll==='function')Td.stopAll();}catch(_e){}}
  if(_geoNativeWatcherId!=null){
    const BG=_geoNativePlugin();
    try{if(BG&&typeof BG.removeWatcher==='function')BG.removeWatcher({id:_geoNativeWatcherId});}catch(_e){}
    _geoForgetWatcher(_geoNativeWatcherId);
    _geoNativeWatcherId=null;
  }
  if(typeof _shadowLiveGpsStop==='function')_shadowLiveGpsStop();
  _geoNativeStarting=false;
  if(_geoWatchId!=null){try{navigator.geolocation.clearWatch(_geoWatchId);}catch(_e){}_geoWatchId=null;}
  if(_geoNudgeTimer){clearTimeout(_geoNudgeTimer);_geoNudgeTimer=null;}
  if(_geoCurrentJob&&_geoArrivedAt)_geoCloseEntry(_geoCurrentJob);
  if(_geoWasInShop&&_geoShopArrivedAt)_geoCloseShopEntry(_geoShopArrivedAt);
  if(_geoCurrentClient&&_geoClientArrivedAt)_geoCloseClientEntry(_geoCurrentClient,_geoClientArrivedAt);
  _geoCurrentJob=null;_geoArrivedAt=null;
  _geoWasInShop=false;_geoShopArrivedAt=null;_geoDriveStartedAt=null;_geoGapHiddenAt=null;_geoExitPending=null;
  _geoDriveReset();_geoDriveShown=false;
  _geoCurrentClient=null;_geoClientArrivedAt=null;_geoClientCacheMemo=null;
  _geoCurrentPlace=null;_geoPlaceArrivedAt=null;_geoStopAnchor=null;_geoLastFenceAt=null;_geoLegAtShop=false;_geoHomeDwell=null;_geoWasAtHome=false;
  _geoLastFenceLoc=null;_geoLegOrigin=null;
  // The job-coordinate cache goes too. It is the ONE piece of geofence state
  // this function used to leave behind, and sign-out is exactly when a second
  // account can sign in on the same device (bug #39's scenario). A job id from
  // the previous account matching one in the new account would fence the new
  // crew at the old account's site.
  _geoJobCoords={};
  _geoClearOpen();_geoWakeRelease();
}

// ── Init + two-layer consent ───────────────────────────────────────────────────
function _geoTrackInit(){
  if(!S.teamTracking)return;                 // tracking not enabled for the company
  if(!_supaUser)return;
  // Backgrounding mid-shift KEEPS the entry open (the old handler closed it, a
  // phone in a pocket all day logged only screen-on slivers, and any visit hidden
  // within 2 minutes of arrival was dropped entirely). Instead: snapshot the open
  // state + the hidden moment; pings after return resolve the gap, still inside
  // the fence ⇒ one continuous visit (hidden time counts, verified at both ends);
  // outside needs a SECOND agreeing ping (never a lone fix, see
  // _geoExitPending) before it closes as 'geofence-gap', stamped at that
  // confirming ping's own moment. stopGeoTracking / out-of-hours still close for real.
  if(!window._geoVisBound){
    window._geoVisBound=true;
    document.addEventListener('visibilitychange',()=>{
      if(document.hidden){
        _geoGapHiddenAt=new Date().toISOString();
        _geoPersistOpen(_geoGapHiddenAt);
      }else{
        _geoDrainQueue();                      // back online-ish, flush queued entries
        if(_geoCurrentJob)_geoWakeAcquire();   // wake locks auto-release on hide
        _geoWakeNudge();                       // resolve where we ARE now, not eventually
        // Same rule as the enter-side defer: an app being LOOKED AT runs live
        // GPS. Exiting here restarts the watcher, so pulling the phone out at
        // the truck mount picks the drive up at the driveway, not a quarter
        // mile down the road when the wake-up region finally fires.
        if(_geoParkModeOn)_geoExitParkMode();
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
  // Join the account's locate channel. Deliberately BEFORE the consent
  // branches below: a phone that has not consented still answers "sharing is
  // off" rather than going silent, because silence would otherwise be read as
  // an asleep phone and the manager would keep asking.
  if(typeof _crewLocateInit==='function'){try{_crewLocateInit();}catch(_e){}}
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

// Installed at load, before any boot timer can touch the web geolocation API:
// the Capacitor bridge script is injected ahead of page scripts, so
// isNativePlatform is answerable by the time this file parses. No-op in every
// browser and PWA.
_geoInstallGeoShim();
// The Settings diagnostics button exists only where park mode does: the shell.
try{
  const _dCap=window.Capacitor;
  if(_dCap&&typeof _dCap.isNativePlatform==='function'&&_dCap.isNativePlatform()){
    // One group, revealed as a unit under Settings → Developer (owner
    // 2026-08-09: these belong with the dev tools, not next to Cloud sync).
    // The Developer row itself is already gated to dev accounts, so this is
    // the second gate: they only mean anything where the engines run.
    const _grp=document.getElementById('dev-geo-tools');
    if(_grp)_grp.style.display='';
  }
}catch(_e){}
