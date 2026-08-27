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
let _geoHomeDwell=null;          // {activeMs,lastSampleMs,closed?} while inside a home
                                 // office; closed:true once a closer has read it, meaning
                                 // the NEXT arrival must start a fresh object, not reuse it
let _geoWasAtHome=false;         // was the PREVIOUS ping inside one? Keeps the tally
                                 // alive for exactly the ping that closes the visit.
// Tighter than the 600ft place fence on purpose: at 600ft a slow crawl through
// city traffic reads as parked. 350ft still absorbs parking-lot GPS jitter.
const _GEO_STOP_FT=350;
// The longest gap that can still be read as ONE drive. Past this, an inferred
// leg start is not evidence of anything: it is a phone that was asleep.
const _GEO_MAX_INFERRED_LEG_MS=4*60*60*1000;
// How stale an iOS visit report may be and still be allowed to backdate the
// arrival it describes. Sized off the observed delivery lag (worst measured:
// 45 minutes) with generous headroom, and deliberately NOT open-ended: past
// this the report describes a visit that is already history, and re-opening
// it now would invent a shift rather than correct a stamp.
const _GEO_VISIT_BACKDATE_MAX_MS=2*60*60*1000;
// ── The flight ceiling (owner report 2026-08-24, mid-air) ─────────────────
// A phone on a plane is still a phone: it takes a fix at the gate, loses the
// sky, and takes another one 700 miles later. The fence machine reads that as
// one leg and the router happily measures a DRIVING route between two
// airports, so a flight books itself as several hundred deductible miles and
// hours of paid wheel time. Nothing in the leg's own data said "impossible",
// because nothing was ever checking.
//
// The check is straight-line distance over the leg's own wheel time, which is
// a conservative floor: real roads are longer than the crow's route, so a leg
// that already implies 100mph point-to-point was moving faster than that on
// the ground. No truck sustains it. A genuinely long interstate haul lands
// around 60-70mph straight-line even when the speedometer says 80, so the
// ceiling never touches real driving. Flights come out at 300mph and up, and
// a GPS teleport (another way this shape appears) comes out higher still.
//
// The floor distance exists so ordinary short legs are never judged on a
// ratio: 30 miles at over 100mph is under 18 minutes of wheel time, which is
// not a drive that happened.
const _GEO_MAX_DRIVE_MPH=100;
const _GEO_FLIGHT_MIN_MI=30;
const _GEO_STOP_MS=5*60*1000;   // a stop, not a traffic light (matches PLACE_DWELL_MS)
let _geoPingBusy=false;    // re-entrancy guard: _geoOnPing awaits geocodes, overlapping
                           // pings must never interleave the fence state machine
let _geoResumedOnce=false; // _geoTrackInit can fire from more than one boot-completion
                           // path in one page session (_removeBootOverlay has success,
                           // retry-recovery, and timeout-fallback call sites); a second
                           // firing must never re-restore/re-drain, see _geoTrackInit
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
// FLICKER-UNDO CANDIDATE (owner video 2026-08-20, same day as the mandate
// above): _geoExitPending gates when a departure is trusted, but once it IS
// trusted (a single spurious driving-speed reading, or two borderline-
// accuracy pings agreeing) and the drive clock opens, the VERY NEXT ping
// landing back inside that SAME fence had no guard at all: it went through
// the unconditional "single clean ping into a well-defined fence" trust path
// (the DIRECT rural-reconnect case this app deliberately never gates, see the
// comment on that branch below), because by then `prev` reads null, so the
// re-entry looks identical to a brand-new arrival. GPS settling back after a
// boundary-jitter blip closed a real visit and re-opened it, logging a
// phantom "Driving" leg for the gap (owner: two same-job legs 7:52-8:00/8:02,
// then several more 2-6 minute job<->shop blips through midday while parked).
//
// Snapshot taken the instant a job/place/client exit is confirmed, holding
// exactly what would let the very next ping undo it if it turns out to be
// the same fence, moments later:
//   {kind, id}          : the fence identity that was just confirmed departed
//   arrivedAt            : its ORIGINAL arrival time, to restore if this was
//                          nothing
//   wroteRow              : did the close actually enqueue a row. Only false
//                          (mins<2, the close's OWN existing floor) is safe
//                          to restore: restoring over a row that already made
//                          it into the queue would double-count that segment
//                          when the visit finally closes for real. When true,
//                          the flicker is still worth catching for the drive
//                          leg (below), just not for re-stitching the dwell.
//   driveStartedAt        : the exact _geoDriveStartedAt ISO this candidate
//                          belongs to. Every existing test in this file (and
//                          every real restart) resets _geoDriveStartedAt to
//                          null/fresh, so requiring an EXACT match is what
//                          keeps a leftover candidate from ever pairing with
//                          an unrelated, later drive that happens to share a
//                          job id, independent of the wall-clock bound below.
// Bounded by _GEO_PARK_MS, the same "stationary long enough to trust" window
// the park resolver already uses elsewhere in this function, reused rather
// than inventing a new constant: a genuine round trip back to the same
// address inside four minutes is vanishingly rare, and this only ever
// intervenes when the destination is the EXACT fence just left, never a
// different one, so the protected direct-into-a-new-fence case is untouched.
let _geoFlickerCandidate=null;
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
// ── Park detection: a stationary drive resolves to a job arrival ─────────────
// Owner design (2026-08-20). The job fence is deliberately tight (600ft,
// _geoFenceFt) and GPS wander means a truck parked AT the job can read outside
// it fix after fix: the visit never opens and the drive leg stays open all
// day. The rule: when a drive is open and the fixes go STATIONARY (below
// driving speed, clustered within _GEO_PARK_STEP_FT of each other) for a few
// minutes, that drive is dead, kill it and stamp its end at the moment motion
// stopped. The cluster's running-mean CENTROID averages the wander out (the
// "micro point"); if it lands within the fence plus a wander margin of a job,
// that is an ARRIVAL at that job, backdated to when they parked. Departure
// then follows the existing rule: the visit persists until driving is
// detected, exactly the way _geoExitPending already trusts a driving-speed
// fix immediately ("kill the drive and capture the end time", owner).
let _geoParkCluster=null;   // {lat,lng,n,sinceMs} running-mean centroid of stationary fixes
let _geoSoftJob=null;       // {id,lat,lng} centroid lock holding a visit open OUTSIDE the strict fence
let _geoSoftJobSpeedRun=0;  // consecutive driving-speed fixes seen against the soft lock
// Same soft-lock shape as _geoSoftJob above, for the Shop specifically (owner
// report 2026-08-22: a Shop/Home-office account parked back at the property
// and it never registered, no Shop dwell, the return leg's own mileage row
// left orphaned with nothing to prove they'd come back). The park-resolve
// block below already gives a job a +350ft margin beyond the strict fence for
// exactly this "stopped moving nearby, not dead center" case; the Shop never
// got the same treatment, only the raw 600ft check on every ping, with no
// fallback once GPS quiets down in park mode. A home-based shop's actual
// parking spot, a driveway, a detached garage, a second building, sitting
// just past the strict circle is the common case this was built for, not an
// edge case.
let _geoSoftShop=null;      // {lat,lng} centroid lock holding a Shop visit open OUTSIDE the strict fence
let _geoSoftShopSpeedRun=0; // consecutive driving-speed fixes seen against the soft lock
let _geoParkBackdate=null;  // one-shot ISO: the moment motion stopped, consumed by the transition
// DELIBERATELY under _GEO_STOP_MS (5 min): the park has to resolve BEFORE the
// same parked dwell matures into an anonymous 'stop' row (_geoSettleStopLeg /
// _geoCloseStop both trigger at _GEO_STOP_MS), or the minutes at the kerb
// would be claimed twice, once as an off-job stop and once as backdated job
// time. Anyone changing either constant must keep this ordering.
const _GEO_PARK_MS=4*60000;
const _GEO_PARK_STEP_FT=150;      // fixes within this of the centroid still count as parked
const _GEO_PARK_JOB_EXTRA_FT=350; // the centroid may sit this far beyond the strict fence

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
// Same idea as _geoLegKey, for a VISIT close (job/shop/place/client/stop)
// instead of a drive leg: deterministic on who + what they arrived at + when,
// so a re-delivered close of the same arrival (a buffered native event
// replayed, a re-processed ping) mints the same key again instead of a fresh
// random one. _geoLegKey already got this treatment on 2026-08-11 (the
// triple-logged drive); the visit closers below never did, which is why a
// duplicate live/replay pair (2026-08-21, __tdTs) could self-heal on the
// mileage side (_mileDedupTrips, keyed off legKey) but never on the Time Log
// side: _geoCloseEntry/_geoCloseShopEntry/_geoClosePlaceEntry/
// _geoCloseClientEntry/_geoCloseStop all called _geoEnqueue with no
// client_key at all, so _geoEnqueue minted a random one (_geoClientKey())
// every single time, and the server's unique (contractor_user_id,client_key)
// index had nothing to catch. kind distinguishes job/shop/place/client/stop
// so two different visit TYPES starting at the same instant never collide.
function _geoVisitKey(kind,id,arrivedIso){
  return ((_supaUser&&_supaUser.id)||'anon').slice(0,8)+'-vis-'+kind+'-'+(id!=null?String(id):'x')+'-'+((Date.parse(arrivedIso)||0)).toString(36);
}
function _geoQueueRead(){try{return JSON.parse(localStorage.getItem(_GEO_QUEUE_KEY)||'[]');}catch(_e){return[];}}
function _geoQueueWrite(q){try{localStorage.setItem(_GEO_QUEUE_KEY,JSON.stringify(q));}catch(_e){}}
// `opts.overwrite` lets a writer that OWNS a deterministic key correct its own
// past row instead of being ignored as a duplicate (added 2026-08-25). The
// drain's default is ignoreDuplicates, which is right for every writer whose
// key is minted once per event and must never be rewritten. It is wrong for
// the reconciler: its key is rec-<legKey>, it recomputes that window from
// scratch on every pass, and without this a single bad trim became permanent
// data loss with nothing able to put it back. Old queue entries written before
// this option existed have no flag, so they keep the ignore behaviour.
function _geoEnqueue(tbl,row,opts){
  try{
    row.client_key=row.client_key||_geoClientKey();
    const q=_geoQueueRead();q.push({tbl,row,overwrite:!!(opts&&opts.overwrite)});
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
        // A TOMBSTONE ON THE KEY IS A RECOVERY HANDLE, not an obstacle (owner
        // 2026-08-26: "could use it for recovery").
        //
        // job_time_entries and shop_time_entries carry a unique index on
        // (contractor_user_id, client_key), so a soft-deleted row still OWNS its
        // key. The obvious reading is that this breaks recreation, and under
        // ignoreDuplicates it does: the writer collides with a gravestone and
        // the row can never come back, which is a bug the soft-delete work
        // introduced. The better reading is that the collision IS the row we
        // want. Same key means same window, so clearing deleted_at on an
        // overwrite resurrects the ORIGINAL row, id and history intact, carrying
        // whatever the recompute just decided.
        //
        // That makes a wrong sweep self-healing rather than merely undoable: the
        // reconciler recomputes its windows from mileage and pings every pass,
        // so the pass after a bad delete simply puts the row back. The two
        // cannot fight over it either, because the sweep and the write-time gate
        // run the same _geoPingTrim over the same fixes: a window the sweep was
        // right to drop is one the reconciler declines to write at all.
        //
        // Only for overwrite writers, which today means the reconciler alone.
        // Every other enqueued row mints its key once and must never revive
        // something a person deliberately removed.
        if(item.overwrite&&item.row&&item.row.deleted_at===undefined)item.row.deleted_at=null;
        ({error}=await _supa.from(item.tbl).upsert(item.row,{onConflict:'contractor_user_id,client_key',ignoreDuplicates:!item.overwrite}));
        // Hosted DB predating the geo-hardening migration: no unique index → retry as
        // a plain insert; no client_key column at all → retry without the key. Either
        // way the entry lands, durability beats idempotency when the schema lags.
        if(error&&/on conflict|constraint/i.test(String(error.message||''))){({error}=await _supa.from(item.tbl).insert(item.row));}
        if(error&&/client_key/i.test(String(error.message||''))){const{client_key,...plain}=item.row;({error}=await _supa.from(item.tbl).insert(plain));}
        // The plain-insert retry above can ALSO hit the same unique index it
        // exists to route around: job_time_entries_ckey_uq is PARTIAL (where
        // client_key is not null), so PostgREST's on_conflict param can never
        // target it at all (no WHERE clause support), and the FIRST upsert
        // fails with "constraint" on every single row, always, not just when
        // the schema lags, that's what the fallback above is really for. But
        // when THIS row's own client_key was already written by an earlier
        // successful pass, the plain-insert retry collides with that same
        // partial index and throws its own "duplicate key value violates
        // unique constraint" error, which also contains the word
        // "constraint" so it slips past the first check unretried, and the
        // constraint's own name never matches /client_key/i either. Every
        // row enqueued after this one then never even got attempted (owner
        // report 2026-08-21: 71 rows stuck behind one already-written
        // window).
        //
        // UPDATE, never just excuse (owner's second live catch, same night):
        // the reconciler's own window for a still-open visit grows across
        // the day as later mileage legs arrive (a 3pm departure fragment,
        // then the real 10pm one once it finally logs), and every recompute
        // shares the SAME client_key because it's keyed to the ARRIVAL leg,
        // not the departure. `ignoreDuplicates:true` on the very first
        // upsert attempt never even matters (that attempt always 400s on the
        // partial index before it can decide ignore-vs-update), so the
        // effective behavior was "whichever write landed first wins
        // forever": the first, stale, incomplete window (12:55->16:27, a
        // since-superseded mid-afternoon fragment) got recorded, and the
        // true final one (12:55->22:07, the real departure) kept computing
        // correctly and kept silently losing to it. A duplicate on OUR OWN
        // deterministic key means this is the SAME visit, still being
        // measured: overwrite it with the newer numbers, don't discard them.
        if(error&&/duplicate key value violates unique constraint/i.test(String(error.message||''))){
          const{contractor_user_id,client_key,...patch}=item.row;
          ({error}=await _supa.from(item.tbl).update(patch).eq('contractor_user_id',contractor_user_id).eq('client_key',client_key));
        }
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
  // One-shot per session, same pattern as the mileage sweeps (js/mileage.js
  // _milePersonalStopSweep/_mileMotionHealSweep): this used to only ever get
  // called ~2.4s into boot via _geoTrackInit's own deliberate delay chain
  // (js/cloud.js _removeBootOverlay: 320ms + 700ms + 1400ms, sequenced after
  // the vehicle picker on purpose). supaLoadFromCloud() calls the mileage
  // sweeps synchronously, well before that chain even starts, so
  // _geoLastFenceLoc/_geoLastFenceAt were always still their module-load
  // null/undefined when the personal-stop sweep's pass 2 checked them: the
  // "durable proof survives a restart" comment on that pass was never true in
  // practice, because the restore that proof depends on had not run yet
  // (owner report 2026-08-22: a Shop -> Stop leg with a proven live return to
  // Shop on the server never got swept, force-quit/reopen made no difference,
  // any number of times). The guard makes it safe to call this once, early,
  // from supaLoadFromCloud (right before the sweeps) as well as from its
  // original spot inside _geoTrackInit: whichever runs first restores the
  // state for real, the second call is a harmless no-op.
  if(window._geoOpenRestored)return;
  window._geoOpenRestored=true;
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
// Every reconcilable job, for repairing history. _geoMyJobs above answers
// "what should this device fence RIGHT NOW", so it is pinned to TODAY and
// excludes done jobs, both correct live and both fatal for repairing the
// past: the reconciler sweeps seven days of mileage legs, and a window at a
// job scheduled yesterday, or since marked done (the NORMAL flow: finish the
// work, close the job out, then look at hours), matched nothing.
//
// A first fix (owner report 2026-08-21, round one) scoped this to jobs whose
// SCHEDULED span covered the window's own day, which fixed the yesterday/done
// cases but not a third: a job booked for, say, Aug 18-19 that actually ran
// into Aug 20 (routine in trades, "supposed to be two days") locked its own
// third day out of reconciliation, because the calendar never knew about the
// overrun (owner's own diagnostic paste, round two: the exact 8am-12:29pm
// window on the day the job overran, "0 day jobs", while the SAME job
// matched fine the two days before it). The crew was physically there, GPS
// proves it, the scheduled date range is a plan, not a fact.
//
// So there is no date filter at all now: a job's real-world location is what
// a coordinate match verifies, not whatever the calendar happened to say
// that week. Only cancelled jobs stay out, nobody worked those. Employee
// scoping matches _geoMyJobs.
function _geoReconcilableJobs(){
  const mine=_isEmployee
    ?jobs.filter(j=>j&&String(j.assignedTo)===String(_employeeRecord?.id))
    :jobs;
  return mine.filter(j=>j&&!j.cancelled);
}
async function _geoJobLatLng(j){
  // Element-guarded (and array-guarded) on purpose: ONE bad element in
  // clients used to throw straight out of here, and the reconciler's outer
  // catch swallowed it, so a single malformed client row silently killed
  // EVERY reconciliation pass with no error anywhere. Same class of bug as
  // _tlJobClientInfo/getClientById (fixed 2026-08-24); a lookup miss must
  // cost the one job its address, never the whole sweep.
  const _cl=(typeof clients!=='undefined'&&Array.isArray(clients))?clients:[];
  const c0=_cl.find(x=>x&&x.id===j.client_id);
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
  const cl=(typeof clients!=='undefined'&&Array.isArray(clients))?clients.find(x=>x&&x.id===j.client_id):null;
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
  // Throttled breadcrumb (~60s). Every TdGeo event, live or replayed, carries
  // the moment it actually happened (__tdTs, see _geoTdEvent); everything
  // downstream in this handler clocks off nowMs, so the whole fence machine
  // honors it instead of whenever this handler happened to run.
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
    // .closed (set by the closer once it has read this dwell, see
    // _geoCloseShopEntry/_geoClosePlaceEntry) means the visit this object
    // belonged to is already billed: a fresh arrival must start its own tally
    // at zero rather than keep piling active-minutes onto a total some OTHER,
    // already-closed visit already claimed. Without this check, returning
    // home before the second away-ping (below) ever got a chance to null the
    // object handed the new, unrelated dwell the old one's leftover minutes.
    if(!_geoHomeDwell||_geoHomeDwell.closed)_geoHomeDwell={activeMs:0,lastSampleMs:nowMs};
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
  // ── Soft-lock membership: a parked-outside-the-fence visit stays open ─────
  // A park-resolved arrival (below) locks the visit to the CENTROID, not the
  // strict fence: the truck never physically entered the 600ft circle, so
  // every subsequent wandering fix would read as a departure and the exit
  // machinery would close the visit they are still on. While the lock holds,
  // membership is forced back to the job; it releases on TWO consecutive
  // driving-speed fixes (they pulled out; the same one-phantom-fix debounce
  // the driveby guard gives an established occupant, and the machine's normal
  // job-to-null transition plus _geoExitPending's immediate trust of a
  // driving-speed reading then closes the visit at this very moment), or when
  // the fixes wander beyond the centroid's own margin, or when the job drops
  // off today's list.
  if(!insideId&&_geoSoftJob){
    if(typeof pos.coords.speed==='number'&&pos.coords.speed>=_GEO_DRIVEBY_SPEED_MPS){
      _geoSoftJobSpeedRun++;
      if(_geoSoftJobSpeedRun>=2)_geoSoftJob=null;
    }else _geoSoftJobSpeedRun=0;
    if(_geoSoftJob){
      const _sj=_geoMyJobs().find(j=>String(j.id)===String(_geoSoftJob.id));
      if(_sj&&_geoDistFt(here,_geoSoftJob)<=_geoFenceFt()+_GEO_PARK_JOB_EXTRA_FT){insideJob=_sj;insideId=_sj.id;}
      else _geoSoftJob=null;
    }
  }
  // Same soft-lock, for the Shop. Only when nothing already claimed this ping
  // (a job or a strict-fence shop hit always wins), same release rule as the
  // job lock above: two consecutive driving-speed fixes, or wandering past
  // the centroid's own margin.
  if(!insideId&&!inShop&&_geoSoftShop){
    if(typeof pos.coords.speed==='number'&&pos.coords.speed>=_GEO_DRIVEBY_SPEED_MPS){
      _geoSoftShopSpeedRun++;
      if(_geoSoftShopSpeedRun>=2)_geoSoftShop=null;
    }else _geoSoftShopSpeedRun=0;
    if(_geoSoftShop&&_geoDistFt(here,_geoSoftShop)<=_geoFenceFt()+_GEO_PARK_JOB_EXTRA_FT)inShop=true;
    else _geoSoftShop=null;
  }
  // ── Park cluster: an open drive that stopped moving is a dead drive ───────
  // Only while a drive is open, outside EVERY fence, with a fix trustworthy
  // enough to act on (_driveAccOk, the same bar the exit machinery uses). A
  // bad-accuracy fix neither starts, grows, nor clears the cluster: one
  // coarse indoor fix must not restart the four-minute clock on a real park.
  if(_geoDriveStartedAt&&!_geoSoftJob&&!_geoSoftShop&&!insideId&&!inShop&&!atPlaceId&&!atClientId){
    if(typeof pos.coords.speed==='number'&&pos.coords.speed>=_GEO_DRIVEBY_SPEED_MPS){
      _geoParkCluster=null;   // still rolling, whatever the positions say
    }else if(_driveAccOk){
      // The cluster belongs to ONE drive leg and one forward-running clock. A
      // cluster left over from a previous leg (leg stamp differs) or from a
      // world whose clock moved backward under it (sinceMs in the future:
      // a device clock change, or a fixture rewinding time) can never be
      // trusted to age THIS park, so it restarts clean instead of maturing
      // off stale state.
      if(_geoParkCluster&&(_geoParkCluster.leg!==_geoDriveStartedAt||nowMs<_geoParkCluster.sinceMs))_geoParkCluster=null;
      if(!_geoParkCluster||_geoDistFt(here,_geoParkCluster)>_GEO_PARK_STEP_FT){
        _geoParkCluster={lat:here.lat,lng:here.lng,n:1,sinceMs:nowMs,leg:_geoDriveStartedAt};
      }else{
        const c=_geoParkCluster;
        c.lat=(c.lat*c.n+here.lat)/(c.n+1);c.lng=(c.lng*c.n+here.lng)/(c.n+1);c.n++;
        if(nowMs-c.sinceMs>=_GEO_PARK_MS){
          // Stationary long enough. Does the centroid sit at a job? Nearest
          // one inside fence + wander margin wins, same shape as the strict
          // membership loop above (which already geocoded every job this
          // ping, so these lookups are cache hits).
          let pj=null,pjFt=Infinity;
          for(const j of _geoMyJobs()){
            const jc=await _geoJobLatLng(j);
            if(!jc)continue;
            const ft=_geoDistFt(c,jc);
            if(ft<=_geoFenceFt()+_GEO_PARK_JOB_EXTRA_FT&&ft<pjFt){pj=j;pjFt=ft;}
          }
          if(pj){
            _geoSoftJob={id:String(pj.id),lat:c.lat,lng:c.lng};
            _geoSoftJobSpeedRun=0;
            // The drive died when the truck stopped moving, not when this
            // resolver noticed four minutes later: the transition below
            // consumes this to stamp the leg's end AND the arrival there.
            //
            // UNLESS the stop machinery already owns the parked minutes: a
            // late resolve (a job whose geocode only warmed up after
            // _GEO_STOP_MS, so _geoSettleStopLeg/_geoCloseStop have already
            // split the leg and will write the 'stop' row) must not claim
            // the same span again as backdated job time. Then the honest
            // arrival is simply now.
            const _anchMs=_geoStopAnchor?Math.max(0,(Date.parse(_geoStopAnchor.lastAt||'')||0)-(Date.parse(_geoStopAnchor.at||'')||0)):0;
            _geoParkBackdate=(_anchMs>=_GEO_STOP_MS)?null:new Date(c.sinceMs).toISOString();
            insideJob=pj;insideId=pj.id;   // enter the fence machine NOW
            _geoParkCluster=null;
            _geoParkNote('park-resolve',(pj.name||pj.id)+' @'+Math.round(pjFt)+'ft');
          }else if(shopC){
            // No job in reach: the Shop gets the exact same forgiving margin
            // a job already had, which is the gap this whole addition exists
            // to close (owner report 2026-08-22: a Shop/Home-office account
            // parked back at the property and it never registered, no Shop
            // dwell, the day's drive leg back left orphaned with nothing to
            // prove they'd come back). Only tried after every job already had
            // first refusal, the same priority a job gets over the shop in
            // the strict membership just below (`cur`, "A JOB wins").
            const sft=_geoDistFt(c,shopC);
            if(sft<=_geoFenceFt()+_GEO_PARK_JOB_EXTRA_FT){
              _geoSoftShop={lat:c.lat,lng:c.lng};
              _geoSoftShopSpeedRun=0;
              const _anchMsS=_geoStopAnchor?Math.max(0,(Date.parse(_geoStopAnchor.lastAt||'')||0)-(Date.parse(_geoStopAnchor.at||'')||0)):0;
              _geoParkBackdate=(_anchMsS>=_GEO_STOP_MS)?null:new Date(c.sinceMs).toISOString();
              inShop=true;   // enter the fence machine NOW
              _geoParkCluster=null;
              _geoParkNote('park-resolve','Shop @'+Math.round(sft)+'ft');
            }
          }
          // Nothing in reach, job or Shop: leave everything alone. The
          // existing stop machinery owns non-job, non-shop parking, and
          // later pings just keep folding in and re-checking, which costs
          // nothing extra.
        }
      }
    }
  }else if(insideId||inShop||atPlaceId||atClientId){
    _geoParkCluster=null;   // inside a real fence, nothing is anonymous-parked
  }
  const nowIsoEarly=new Date(nowMs).toISOString();
  // ── Shop dwell, tracked on its own ────────────────────────────────────────
  // Being at the yard logs SHOP TIME, full stop (owner call 2026-08-01). It is
  // deliberately not folded into the location below: a job fenced at the yard
  // still counts as time at the yard, and shop time is overhead the contractor
  // wants to see regardless of what else is going on there.
  if(inShop!==_geoWasInShop){
    // _geoParkBackdate, not nowIsoEarly, when a park just resolved this same
    // ping (the Shop's own soft-lock above, mirroring the job path's
    // arriveIso below): stamping "now" instead of the moment they actually
    // stopped moving is what left this dwell measuring ~0 minutes and its
    // own 2-minute floor silently dropping the row. _geoParkBackdate is
    // one-shot and still unconsumed here (both places that null it,
    // "no transition happened" and arriveIso's own read, run later in this
    // same function), so reading it costs nothing and can never pick up a
    // stale value from an earlier ping.
    if(inShop){_geoShopArrivedAt=_geoParkBackdate||nowIsoEarly;}
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
    // A park backdate is one-shot and belongs to the transition that consumes
    // it. Reaching this branch means no transition happened, so an unconsumed
    // backdate is stale and must never stamp a later, unrelated arrival.
    _geoParkBackdate=null;
    if(cur&&cur.k==='job')_geoWakeAcquire();   // hidden-gap STAY: the unseen time counts
    if(!cur){
      // Still outside everything: accumulate the dwell that makes this a STOP.
      if(_geoStopAnchor&&_geoDistFt(here,_geoStopAnchor)<=_GEO_STOP_FT){
        _geoStopAnchor.lastAt=nowIso;
        // The pin of record refines to the BEST fix of the dwell. The first
        // fix after a wake is routinely the worst reading of the whole park,
        // and it used to be the only one consulted: a 200m first fix put the
        // pin across the street and no saved-place fence could ever match it,
        // however many precise fixes followed. Same spot (inside the stop
        // radius), better measured, so home detection and fence resolution at
        // close time judge the real kerb.
        if(acc>0&&(!(_geoStopAnchor.acc>0)||acc<_geoStopAnchor.acc)){
          _geoStopAnchor.lat=here.lat;_geoStopAnchor.lng=here.lng;_geoStopAnchor.acc=acc;
        }
      }
      else{
        // Pulling away from a kerb the anchor was watching: if the sit was a
        // sub-stop PAUSE (2.5-5 min, the pizza pickup), the leg is marked
        // before the anchor is replaced, so the detour floor knows this trace
        // contains an errand rather than a forced detour.
        _geoNotePause(_geoStopAnchor);
        if(_geoStopAnchor)_geoCloseStop(_geoStopAnchor);
        _geoStopAnchor={lat:here.lat,lng:here.lng,at:nowIso,lastAt:nowIso,acc:acc};
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
    // Snapshot BEFORE closing, kept only in a local var: if this exit turns
    // out to be a same-fence flicker (settled back moments later), section 3
    // below decides whether it's safe to undo (see _geoFlickerCandidate).
    let _flickerPrev=null;
    if(prev){
      const _preArrived=prev.k==='job'?_geoArrivedAt:prev.k==='place'?_geoPlaceArrivedAt:prev.k==='client'?_geoClientArrivedAt:null;
      let _wroteClose=false;
      // HIDDEN-GAP RESOLUTION (leave): backgrounded on site, and this now-
      // CONFIRMED reading (gated above) is the first moment a departure was
      // actually verified. That confirmation moment is the departure time,
      // not the earlier hidden moment: a screen locking is not evidence
      // anyone left, only a fix that clears the fence is (owner call,
      // 2026-08-06, superseding the prior "close at the hidden moment"
      // behavior). The 'geofence-gap' source tag still marks the row as
      // gap-resolved rather than continuously observed.
      if(prev.k==='job'&&_geoArrivedAt)_wroteClose=await _geoCloseEntry(_geoCurrentJob,nowIso,!!_geoGapHiddenAt);
      else if(prev.k==='place'&&_geoPlaceArrivedAt)_wroteClose=_geoClosePlaceEntry(_geoCurrentPlace,_geoPlaceArrivedAt,nowIso);
      else if(prev.k==='client'&&_geoClientArrivedAt)_wroteClose=_geoCloseClientEntry(_geoCurrentClient,_geoClientArrivedAt,nowIso);
      // prev.k==='shop' needs nothing here: the independent shop block above
      // owns that dwell, and only closes it when they actually leave the yard.
      if((prev.k==='job'||prev.k==='place'||prev.k==='client')&&_preArrived){
        _flickerPrev={kind:prev.k,id:prev.id,arrivedAt:_preArrived,wroteRow:_wroteClose};
      }
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
    // FLICKER-UNDO (owner video 2026-08-20, see _geoFlickerCandidate above):
    // checked before arriveIso is finalized below, because a confirmed
    // flicker means the real arrival time is the ORIGINAL one, not now. Every
    // field has to line up: the exact drive this candidate belongs to
    // (driveStartedAt===legStart, so a leftover candidate from an unrelated
    // drive can never match), the SAME fence identity, nothing already
    // written for the segment that "closed" (wroteRow: restoring over a row
    // already in the queue would double-count it), and a short enough gap
    // (_GEO_PARK_MS, reused from the park resolver below) that this reads as
    // jitter rather than a genuine round trip.
    const _fc=_geoFlickerCandidate;
    const _flicker=!!(cur&&_fc&&legStart&&_fc.driveStartedAt===legStart&&_fc.kind===cur.k&&
      String(_fc.id)===String(cur.id)&&!_fc.wroteRow&&(nowMs-(Date.parse(legStart)||0))<=_GEO_PARK_MS);
    _geoFlickerCandidate=null;
    // PARK BACKDATE (owner design 2026-08-20): when the park resolver forced
    // this membership, the drive must END at the moment the truck stopped
    // moving (the stationary cluster's birth), not four minutes later when
    // the resolver noticed, and the arrival must START there too: "kill the
    // drive and capture the end time." One-shot: consumed here and nulled
    // unconditionally, so it can never leak onto a later transition. On
    // every ordinary entry arriveIso IS nowIso, nothing else changes.
    const arriveIso=_flicker?_fc.arrivedAt:(cur&&_geoParkBackdate)?_geoParkBackdate:nowIso;
    _geoParkBackdate=null;
    if(cur){
      if(_flicker){
        // The visit never actually ended: no drive leg to log, nothing to
        // collapse as a detour, just continue as if the exit never happened.
        _geoParkNote('flicker-undo',(curLoc&&curLoc.name)||cur.k);
      }else{
        _geoCollapseDetours();   // unreceipted anonymous stops between here and the last real endpoint are detours
        if(legStart){
          // arriveIso, not null: live it IS now, a replayed TdGeo buffer fix
          // carries the moment the arrival actually happened, and a park
          // resolution carries the moment the truck stopped, so the leg's
          // duration stays honest instead of stretching to the noticing moment.
          if(cur.k==='job')_geoDriveEntry(cur.id,legStart,null,arriveIso,legGap,curLoc,legStale);
          else _geoDriveEntry(null,legStart,cur.name,arriveIso,legGap,curLoc,legStale);
        }
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
        // A drive opening IS a shift running: the beat must survive whatever
        // the day does next, including the app dying at the destination.
        _geoHeartbeatSync(null);
        // This exit was JUST confirmed and the drive is only NOW opening:
        // stash who we left, so a settle-back into this exact fence within
        // the grace window above can undo it instead of logging a phantom
        // round trip (see _geoFlickerCandidate above).
        if(_flickerPrev)_geoFlickerCandidate={..._flickerPrev,driveStartedAt:_geoDriveStartedAt};
      }
      _geoStopAnchor={lat:here.lat,lng:here.lng,at:nowIso,lastAt:nowIso,acc:acc};
    }
    // ── 4. Commit the new state ─────────────────────────────────────────────
    _geoCurrentJob=(cur&&cur.k==='job')?insideId:null;
    // arriveIso: nowIso everywhere except a park-resolved job arrival (starts
    // when the truck stopped) or a flicker-undo (starts at the ORIGINAL
    // arrival). Place/client stamps ride the same arriveIso now too: the park
    // resolver still never forces place/client membership, so arriveIso is
    // always nowIso for them outside of a flicker-undo.
    _geoArrivedAt=(cur&&cur.k==='job')?arriveIso:null;
    _geoLegAtShop=!!(cur&&cur.k==='shop');
    _geoCurrentPlace=(cur&&cur.k==='place')?cur.id:null;
    _geoPlaceArrivedAt=(cur&&cur.k==='place')?arriveIso:null;
    _geoCurrentClient=(cur&&cur.k==='client')?cur.id:null;
    _geoClientArrivedAt=(cur&&cur.k==='client')?arriveIso:null;
    // A flicker-undo is not a fresh arrival: re-arm the notification dedupe
    // so the tap-back below (which re-arms itself on every non-job ping,
    // including the phantom "exit" this undoes) does not fire a duplicate.
    if(_flicker&&cur&&cur.k==='job')_geoNotifiedArrivalJob=_geoCurrentJob;
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
  // Slow-burn reconciliation rides the ping stream (~10 min cadence). The
  // scheduling itself is gated on a live watcher inside _geoReconcileSoon,
  // so fixture worlds driving this handler directly start no timers.
  if(nowMs-_geoReconLastMs>=_GEO_RECON_EVERY_MS){_geoReconLastMs=nowMs;_geoReconcileSoon();}
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
// Returns whether a row was actually enqueued (false for `mins<2`/no user/no
// arrival): _geoOnPing's flicker-undo (see _geoFlickerCandidate) reads this to
// know whether restoring the original arrival on a same-fence settle-back
// would double-count a segment that already made it into the queue.
async function _geoCloseEntry(jobId,departedIso,gap){
  const arrived=_geoArrivedAt; _geoArrivedAt=null;
  _geoClearOpen();
  if(!arrived)return false;
  // NEVER `now` (owner report 2026-08-24, Wed 8/12: a visit read 1:06pm to
  // 9:37pm, and 9:37:29pm turned out to be the instant the app woke up and
  // flushed the whole day's queue at once, five records inside 21ms,
  // including drive legs that had ended 13 hours earlier). The shutdown
  // path (_geoStopTracking) calls this with no departedIso, and `now` then
  // claimed every unobserved hour since the app died as time on site.
  // The rule this file already states for both edges of a stop applies here
  // too: close at a VERIFIED moment, never claim time nobody observed.
  // _geoLastFenceAt is the last ping actually processed inside the fence
  // (set in the ping handler, restored with the open visit on reload), so
  // it is the last instant the person was OBSERVED here.
  const departed=departedIso||_geoLastFenceAt||null;
  // No verified observation at all: write nothing rather than invent a span.
  // The mileage-anchored reconciler still recovers the visit later if real
  // drive legs bound it, which is exactly the evidence this lacks.
  if(!departed){_geoParkNote('close-skip','no verified departure, visit not written');return false;}
  const mins=Math.max(0,Math.round((Date.parse(departed)-Date.parse(arrived))/60000));
  if(mins<2)return false;      // ignore brief pass-throughs
  if(!_supaUser)return false;
  _geoEnqueue('job_time_entries',{
    contractor_user_id:_geoCid(),employee_user_id:_supaUser.id,
    job_id:String(jobId),arrived_at:arrived,departed_at:departed,minutes:mins,
    client_key:_geoVisitKey('job',jobId,arrived),
    source:gap?'geofence-gap':'geofence'
  });
  return true;
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
  // Marked read, not nulled: the tally deliberately survives THIS ping (see
  // the sampler comment above _geoAtHomeOffice's call site) in case anything
  // downstream still expects it truthy for the ping that closed the visit.
  // What it must never do is silently feed a LATER, unrelated dwell: the
  // sampler's re-arm check treats .closed as "start a fresh one at zero."
  if(_geoHomeDwell)_geoHomeDwell.closed=true;
  if(mins<2)return;
  if(!_supaUser)return;
  _geoEnqueue('shop_time_entries',{
    contractor_user_id:_geoCid(),employee_user_id:_supaUser.id,
    arrived_at:arrivedAt,departed_at:departed,minutes:mins,
    client_key:_geoVisitKey('shop',null,arrivedAt)
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
// A stop that spans Central midnight is an END-OF-DAY PARK (truck home for
// the night), never an unpaid leg of a workday, and writing it is exactly
// what let single days total more than 24 hours (owner rule 2026-08-24: "it's
// not humanely possible for any day to have more than 24 hours"). Central
// time is the app's day convention everywhere (_ctDateStr, js/finance.js);
// dateKey (js/utils.js, always loaded first) is the local-day fallback if
// load order ever changes, never a UTC slice (the day-key lint bans those).
// The interval is HALF-OPEN: [arrived, departed). A row that ends exactly at
// midnight contains not one minute of the new day, but its departure INSTANT
// formats as that new day, so comparing the raw stamps called it a crossing.
// Harmless while this only ever saw whole dwells; not harmless once
// _geoWriteStop started apportioning a break AT midnight, because the first
// half of every split ends precisely there and the repair sweep below would
// have deleted it on the next pass. Compare the last millisecond the row
// actually occupies instead.
function _geoStopCrossesMidnight(arrIso,depIso){
  const at=Date.parse(arrIso)||0,dep=Date.parse(depIso)||0;
  const a=new Date(at),d=new Date(dep>at?dep-1:dep);
  return (typeof _ctDateStr==='function')
    ? _ctDateStr(a)!==_ctDateStr(d)
    : dateKey(a)!==dateKey(d);
}
// Crossing midnight was only ever a PROXY for "the truck is home for the
// night", and the proxy is what made a genuine late-night break disappear: a
// night job with a 40-minute gate wait from 11:40pm to 12:20am was thrown away
// because of where the calendar fell, not because of what happened (owner,
// 2026-08-26: "midnight should gracefully count work on the previous day up to
// midnight then carry on"). So ask the real question instead.
//
// A park is a dwell nobody would call a break. Six hours is the line places.js
// already draws for the same judgement (PLACE_HOME_DWELL_MS, "sleep, not a
// supply run"), and the home pin is a park at any length: home is where the
// truck sits. Spanning TWO midnights needs no rule of its own, it is 24 hours
// or more by construction and the duration rule has it already.
//
// The >24h days this replaces (owner rule 2026-08-24) came from parks, not from
// midnights, so testing for the park directly protects that rule better than
// the calendar did while giving the real break back.
const _GEO_OVERNIGHT_PARK_MS=6*60*60*1000;   // matches PLACE_HOME_DWELL_MS
function _geoStopIsOvernightPark(a,ms){
  if(ms>=_GEO_OVERNIGHT_PARK_MS)return true;
  return !!(typeof _placeIsLikelyHome==='function'&&
            _placeIsLikelyHome({lat:a.lat,lng:a.lng},ms));
}
// The instant of the next Central midnight strictly after ms, or 0 if none
// inside a day and a half (which cannot happen for a real dwell). Bisection on
// _ctDateStr rather than a hand-kept offset, so CST/CDT is handled by the same
// Intl call the rest of the app trusts for the day convention.
function _ctMidnightAfter(ms){
  const day=(d)=>(typeof _ctDateStr==='function')?_ctDateStr(d):dateKey(d);
  const d0=day(new Date(ms));
  let lo=ms,hi=ms+36*3600000;
  if(day(new Date(hi))===d0)return 0;
  while(hi-lo>1){
    const mid=lo+Math.floor((hi-lo)/2);
    if(day(new Date(mid))===d0)lo=mid;else hi=mid;
  }
  return hi;
}
// One unpaid-stop row. Split out so the single-day and across-midnight paths
// cannot drift apart in shape.
function _geoEnqueueStopRow(mins,arrIso,depIso){
  _geoEnqueue('job_time_entries',{
    contractor_user_id:_geoCid(),employee_user_id:_supaUser.id,
    job_id:null,arrived_at:arrIso,departed_at:depIso,minutes:mins,
    dest_place:null,client_key:_geoVisitKey('stop',null,arrIso),source:'stop'
  });
}
// Write the dwell as unpaid off-job time, or decide it was a park and write
// nothing. A break that runs past midnight is APPORTIONED: the minutes before
// midnight belong to the day that was being worked, the minutes after belong to
// the new one, and no row ever spans a day boundary again. Every consumer
// buckets by arrived_at's Central date (js/finance.js _crewCostRender,
// js/timelog.js), so two same-day rows land exactly where they should with no
// change on their side, and the repair sweep's overnight fingerprint
// (_geoStopCrossesMidnight, further down this file) can no longer mistake a
// real break for a park because neither half crosses anything.
function _geoWriteStop(a){
  const at=Date.parse(a.at)||0,dep=Date.parse(a.lastAt)||0;
  const ms=dep-at;
  if(!(ms>0))return;
  if(_geoStopIsOvernightPark(a,ms)){_geoParkNote('stop-skip','overnight park, no unpaid row');return;}
  const mid=_ctMidnightAfter(at);
  if(!(mid&&mid<dep)){
    _geoEnqueueStopRow(Math.max(0,Math.round(ms/60000)),a.at,a.lastAt);
    return;
  }
  const midIso=new Date(mid).toISOString();
  const m1=Math.max(0,Math.round((mid-at)/60000));
  const m2=Math.max(0,Math.round((dep-mid)/60000));
  if(m1>0)_geoEnqueueStopRow(m1,a.at,midIso);
  if(m2>0)_geoEnqueueStopRow(m2,midIso,a.lastAt);
  _geoParkNote('stop-split','break across midnight, '+m1+'m + '+m2+'m');
}
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
// ── Shop auto clock-out (owner rule 2026-08-24) ───────────────────────────
// "Don't want shop time to calculate after the last job site or supply run
// of the day", plus the matching report the same day that yard dwell on days
// with NO job or supply fence at all was showing up on the log. Presence at
// the yard is not a shift: the phone sits there after hours (one Monday
// session ran to 11:48pm, 6h23m) and paying raw dwell would have added
// 19h38m to a single week.
//
// So the day CLOCKS OUT by itself at the last verified work event of that
// Central-time day: the last job-fence departure, saved-place (supply house)
// departure, manual clock-out, or drive-leg end. Drive ends count on purpose,
// the drive back from the last job ENDS at the yard, so it is what puts the
// unload window on the clock rather than the job departure 30 minutes
// earlier. An off-job stop (lunch) is not work and never extends the day.
//
// Shop dwell is then credited only up to that moment plus S.shopWrapMin, the
// unload/paperwork allowance (default 0, the owner's ask was literally "not
// after the last run"; set it to 15-30 to pay the unload). A day with NO work
// event has no cutoff at all, so a Saturday spent at the yard credits zero,
// the same anchor rule _tlStopAnchored (js/timelog.js) already applies to
// unpaid stops.
//
// Read-time derivation on purpose: "the last event of the day" is unknowable
// at the moment the row is written, and deriving it on read re-grades the
// history already in the table instead of needing a repair sweep to rewrite
// rows (§10, and the shared Supabase means a rewrite hits production).
function _geoShopWrapMs(){
  const n=Number((typeof S!=='undefined'&&S&&S.shopWrapMin)||0);
  return (isFinite(n)&&n>0?Math.min(n,240):0)*60000;   // capped at 4h, never negative
}
// The head-end twin of the wrap-up allowance: load-up/prep time before the
// first move of the day. Same clamp, same default of zero.
function _geoShopPrepMs(){
  const n=Number((typeof S!=='undefined'&&S&&S.shopPrepMin)||0);
  return (isFinite(n)&&n>0?Math.min(n,240):0)*60000;
}
// A drive leg is not, by itself, evidence of a workday. The owner's rule names
// job sites and supply runs, so those visits are the anchors and a drive
// counts only when it is CHAINED to one: it pulls out as a visit ends (the
// ride back to the yard) or pulls in as one begins (the ride out).
//
// Found by the owner 2026-08-24 on Tue 8/18: a 6:26pm leg reading "Civitan Day
// Camp to Shop" was treated as the day's last work event purely because it was
// a drive, which held the workday open until 7:44pm and paid the yard time
// sitting under it. Nothing about that trip is a job or a supply run. Chaining
// is what separates it from the 5:19pm "John Doe to Shop" leg five minutes
// earlier, which IS the ride home from the last job and does close the day.
const _GEO_SHOP_CHAIN_MS=5*60000;
// How close a departure has to sit to the end of a yard session to count as
// LEAVING it. Same slack the chain rule above uses.
//
// Owner, 2026-08-24, Wed 8/19 reading 12h42m against 9h36m of actual work: a
// manual clock at 8:28pm moved the day's close from 5:22pm out to 8:28pm, and
// 3h06m of phone-at-the-yard walked in behind it. The first attempt at this
// blamed the manual entries for being one minute long and floored them, which
// produced the right number for the wrong reason: the owner's answer was
// "those manuals are right." They are real work, and real work should move the
// day's edges. The mistake was mine, one layer down: being INSIDE the workday
// was treated as enough for yard time to count.
//
// It is not. Sitting at the yard is work when you then LEFT to do something,
// or came back from doing something and left again. If nothing follows the
// session except the phone going quiet, nobody observed anyone leave, and that
// is a truck parked. So dwell past the wrap-up allowance is credited only when
// a departure lands on the end of it, which is a fact about the day rather
// than a threshold on somebody's tap.
const _GEO_LEAVE_SLACK_MS=5*60000;
function _geoIsWorkAnchorSource(s){
  const t=String(s||'');
  if(/^drive/.test(t))return false;      // a leg, judged by what it chains to
  if(t==='stop')return false;            // lunch or an errand is not work
  return true;                           // job fence, place, reconciled, manual
}
// The workday WINDOW per person per Central day: {inMs, outMs}.
//
// Opens at the first job/supply visit of the day (or the drive that leads
// straight into it) and closes at the last one (or the drive straight out of
// it). Anything outside is not the workday, so yard dwell there earns nothing.
// Both edges matter: the clock-out alone left the morning unbounded, and the
// owner's Fri 8/21 report was exactly that, 6:05am to 7:48am at the yard being
// paid because the day had no clock-IN to sit behind.
//
// `entries` are job_time_entries-shaped rows; manual clock entries mapped into
// the same shape count as anchors too. Returns {uid:{'YYYY-MM-DD':{inMs,outMs}}}.
function _geoShopCutoffs(entries){
  const out={};
  const dstr=d=>(typeof _ctDateStr==='function')?_ctDateStr(d):dateKey(d);
  const rows=(Array.isArray(entries)?entries:[]).filter(e=>{
    if(!e||!e.employee_user_id)return false;
    return (Date.parse(e.departed_at||'')||0)>0&&(Date.parse(e.arrived_at||'')||0)>0;
  });
  const anchors=rows.filter(e=>_geoIsWorkAnchorSource(e.source));
  const widen=(uid,ms)=>{
    const day=dstr(new Date(ms));
    const m=out[uid]=out[uid]||{};
    const w=m[day]=m[day]||{inMs:ms,outMs:ms};
    if(ms<w.inMs)w.inMs=ms;
    if(ms>w.outMs)w.outMs=ms;
  };
  anchors.forEach(e=>{
    widen(e.employee_user_id,Date.parse(e.arrived_at));
    widen(e.employee_user_id,Date.parse(e.departed_at));
  });
  // Second pass so every anchor is already on record: a leg chained to ANY of
  // them widens the window, not just to one seen earlier in the array.
  rows.forEach(e=>{
    if(_geoIsWorkAnchorSource(e.source))return;
    if(typeof _geoIsOffJobSource==='function'&&_geoIsOffJobSource(e.source))return;
    const a=Date.parse(e.arrived_at),d=Date.parse(e.departed_at);
    const chained=anchors.some(x=>{
      if(String(x.employee_user_id)!==String(e.employee_user_id))return false;
      const xa=Date.parse(x.arrived_at),xd=Date.parse(x.departed_at);
      return Math.abs(a-xd)<=_GEO_SHOP_CHAIN_MS||Math.abs(d-xa)<=_GEO_SHOP_CHAIN_MS;
    });
    if(!chained)return;
    widen(e.employee_user_id,a);
    widen(e.employee_user_id,d);
  });
  return out;
}
// Does a row fall inside the workday at all? Only DRIVE legs can land outside
// it: job and place visits (and manual clocks) are what define the window, and
// an off-job stop is already gated by the Time Log's own anchor rule.
//
// Owner, 2026-08-24, on a 78-minute Tue 8/18 leg the mileage table names
// "Civitan Day Camp to Shop": "was a time we did family pictures and I'm not
// sure why it's there." It is there because the tracker logs every leg between
// known points while tracking is on and had no notion of the day being over,
// so a personal round trip that happened to END at the yard was written with
// the yard as its purpose and paid like any other leg. The workday window is
// that missing notion.
function _geoRowInWorkday(arrIso,depIso,win){
  const a=Date.parse(arrIso||'')||0,d=Date.parse(depIso||'')||a;
  if(!(a>0))return true;                 // unparseable: never hide it
  if(!win||!(win.outMs>0))return false;  // no work that day, so nothing is on the clock
  return Math.min(d,win.outMs)>=Math.max(a,win.inMs);
}
// The paid slice of one shop session against a day's workday window, as
// [startMs,endMs]. Empty (start===end) when the day had no work in it, or the
// session sits entirely outside the window.
function _geoShopPaidRange(arrIso,depIso,win){
  const arr=Date.parse(arrIso||'')||0,dep=Date.parse(depIso||'')||0;
  if(!(arr>0&&dep>arr))return [arr,arr];
  if(!win||!(win.outMs>0))return [arr,arr];
  const lo=win.inMs-_geoShopPrepMs(),hi=win.outMs+_geoShopWrapMs();
  const s=Math.max(arr,lo),e=Math.min(dep,hi);
  return e>s?[s,e]:[arr,arr];
}
function _geoShopPaidMin(arrIso,depIso,win){
  const [s,e]=_geoShopPaidRange(arrIso,depIso,win);
  return Math.max(0,Math.round((e-s)/60000));
}
// ── The shop clock runs while you are WORKING, not while you are home ───────
// Owner question 2026-08-25: "in shop how do we track time loading truck?"
//
// At a yard, dwell is the honest answer: sitting in the shop office writing
// quotes is work. At a shop that IS the house, dwell cannot tell loading the
// truck from eating breakfast, which is the whole reason the home_office kind
// bills active app time instead. But that rule counts phone-in-hand minutes
// (_geoAppActive), so a man loading a truck for forty minutes with the phone
// in his pocket earns nothing. Neither rule describes the work.
//
// The motion coprocessor does. It has been classifying onFoot/still/driving
// around the clock at no battery cost and keeps about a week of history
// (TdGeoPlugin.motionSince, already read by _mileTapeHadPause for errands).
// Loading a truck is walking: house to truck, truck to shelf, back again.
// Sitting at the kitchen table is still. The chip already separated them.
//
// TWO RULES, and they do all of it:
//   1. Still time BETWEEN two walks is paid, up to a bridge LEARNED from this
//      contractor's own tape (_geoLearnIdleCap). That is a bench cut between
//      two trips to the shelf, and where the bench ends and lunch begins is
//      read off how they actually work rather than picked by us.
//   2. Still time before the first walk and after the last walk is NEVER
//      paid. That is the couch, and it is also the geofence firing late.
//
// Rule 2 is why this matters beyond the loading question: the session now
// ends at the last movement rather than at the fence, so the departure lag
// this app has been chasing stops moving the shop number at all.
//
// Sensor limit, stated plainly: the chip needs a gait to say onFoot, so
// standing at a bench reads as still. Bracketed by walks the cap covers it;
// a long motionless bench session with no walking either side is not seen.
// ── THE BRIDGE IS LEARNED, NOT CHOSEN ────────────────────────────────────────
// Owner, 2026-08-25: "I can't make the call on time, it's all going to differ
// based on every office so need something that fits today."
//
// He is right, and a hardcoded twenty minutes was me guessing on behalf of
// every contractor who will ever use this. A painter loading a van, an
// electrician pulling wire across a shop and a landscaper hooking a trailer
// do not share a number, and nobody should be asked to pick one at signup
// about a rule they cannot see working.
//
// So the number comes from the person's own tape. Inside their shop sessions
// the still-gaps between two walks fall into two obvious populations: the
// short ones are the work (setting a box down, reaching for a fitting) and
// the long ones are the break (went inside, sat down to eat). Real shop days
// leave a wide empty middle between the two, so the split is simply THE
// BIGGEST JUMP in their own sorted numbers. No model, no tuning, and it can
// be explained to a contractor in one sentence.
//
// Guard rails, because payroll: it needs enough gaps to have an opinion, it
// needs to actually see a long one (a morning of nothing but quick load-outs
// says nothing about where lunch begins), the jump has to be a real
// separation rather than a step inside one tight cluster, and the answer is
// clamped either way. Anything short of that falls back to the default, so a
// thin week can never invent a number.
const _GEO_SHOP_IDLE_CAP_MS=20*60000;       // the fallback, never a target
const _GEO_IDLE_LEARN_MIN_MS=5*60000;       // below this nobody would call it a break
const _GEO_IDLE_LEARN_MAX_MS=45*60000;      // above this nobody would call it work
const _GEO_IDLE_LEARN_MIN_GAPS=6;           // fewer than this is not a pattern
// Every still-gap that sits BETWEEN two walks, across the given windows.
// Exported separately from the learner so a test (and, later, a settings
// screen) can show the contractor the very numbers the split was made from.
function _geoIdleGaps(tape,windows){
  const out=[];
  if(!Array.isArray(tape)||!tape.length||!Array.isArray(windows))return out;
  for(const w of windows){
    const s=w&&w[0],e=w&&w[1];
    if(!(s>0&&e>s))continue;
    const walks=[];
    for(let i=0;i<tape.length;i++){
      if(tape[i].kind!=='onFoot')continue;
      const a=tape[i].ts,b=(i+1<tape.length)?tape[i+1].ts:e;
      const lo=Math.max(a,s),hi=Math.min(b,e);
      if(hi>lo)walks.push([lo,hi]);
    }
    for(let i=0;i+1<walks.length;i++){
      const gap=walks[i+1][0]-walks[i][1];
      if(gap>0)out.push(gap);
    }
  }
  return out;
}
// The split between "still working" and "on a break", read off those gaps.
// Returns null when the tape has not earned an opinion yet.
function _geoLearnIdleCap(tape,windows){
  const gaps=_geoIdleGaps(tape,windows).slice().sort((a,b)=>a-b);
  if(gaps.length<_GEO_IDLE_LEARN_MIN_GAPS)return null;
  // Without a single long gap on record there is no break to find the edge of.
  if(gaps[gaps.length-1]<_GEO_IDLE_LEARN_MIN_MS*2)return null;
  let bestAt=-1,bestJump=0;
  for(let i=0;i+1<gaps.length;i++){
    const lo=gaps[i],hi=gaps[i+1];
    // A real separation, not a step inside one tight cluster.
    if(hi<lo*2)continue;
    const jump=hi-lo;
    if(jump>bestJump){bestJump=jump;bestAt=i;}
  }
  if(bestAt<0)return null;
  // The threshold sits ON the last short gap: that one is still work, the one
  // across the jump is not. Clamped so a strange week cannot pay a lunch.
  const learned=gaps[bestAt];
  return Math.max(_GEO_IDLE_LEARN_MIN_MS,Math.min(_GEO_IDLE_LEARN_MAX_MS,learned));
}
// Normalized motion transitions covering a window, or null when there is no
// tape to read (browser build, permission refused, no coprocessor). Null is
// "no signal" and every caller must fall back, never "nothing happened".
async function _geoMotionTape(sinceMs,untilMs){
  try{
    const Td=(typeof _geoTdPlugin==='function')?_geoTdPlugin():null;
    if(!Td||typeof Td.motionSince!=='function')return null;
    const s=Number(sinceMs)||0;
    if(!(s>0))return null;
    const r=await Td.motionSince({sinceMs:s-120000});
    if(!r||!r.available||!Array.isArray(r.transitions))return null;
    const lim=Number(untilMs)||0;
    return r.transitions
      .filter(t=>t&&typeof t.ts==='number'&&t.kind&&(!lim||t.ts<=lim+120000))
      .slice().sort((a,b)=>a.ts-b.ts);
  }catch(_e){return null;}
}
// True when the shop and the house are the same place, which is the only case
// this trim applies to. Deliberately generous: the owner's own two pins sit
// about twenty feet apart, and anything inside a fence radius is one property.
function _geoShopIsHome(){
  try{
    if(typeof S==='undefined'||!S||S.officeLat==null||S.officeLon==null)return false;
    const pl=(typeof getPlaces==='function')?(getPlaces()||[]):[];
    return pl.some(p=>p&&p.kind==='home_office'&&p.lat!=null&&p.lon!=null&&
      _geoDistFt({lat:S.officeLat,lng:S.officeLon},{lat:p.lat,lng:p.lon})<=_geoFenceFt());
  }catch(_e){return false;}
}
// Trim [s,e] to the walking part of it, per the two rules above.
// Returns {startMs,endMs,idleMs}; idleMs is interior still time OVER the cap,
// reported rather than hidden so a caller can explain the number it shows.
// Falls through unchanged (idleMs 0) whenever the tape proves nothing: no
// transitions, no walking on record, or no tape at all.
function _geoActiveTrim(tape,s,e,capMs){
  const out={startMs:s,endMs:e,idleMs:0};
  if(!Array.isArray(tape)||!tape.length||!(e>s))return out;
  const cap=(capMs==null)?_GEO_SHOP_IDLE_CAP_MS:capMs;
  // Every transition as a span running to the next one, clipped to the window.
  const spans=[];
  for(let i=0;i<tape.length;i++){
    const a=tape[i].ts,b=(i+1<tape.length)?tape[i+1].ts:e;
    const lo=Math.max(a,s),hi=Math.min(b,e);
    if(hi>lo)spans.push({kind:tape[i].kind,a:lo,b:hi});
  }
  const walks=spans.filter(x=>x.kind==='onFoot');
  // No walking on the tape is not evidence of idleness: the phone may have
  // been left inside while the work happened. Nothing is trimmed.
  if(!walks.length)return out;
  out.startMs=walks[0].a;
  out.endMs=walks[walks.length-1].b;
  // Interior stretches with no walking in them, charged only up to the cap.
  for(let i=0;i+1<walks.length;i++){
    const gap=walks[i+1].a-walks[i].b;
    if(gap>cap)out.idleMs+=gap-cap;
  }
  return out;
}
// Every shop session for one person as paid spans, in input order.
//
// Three things happen here, in this order, and all three are payroll rules
// rather than display polish, which is why one function owns them and both the
// Time Log and Crew Cost call it.
//
// 1. SESSIONS THAT ARE ONE VISIT ARE MERGED. A yard visit interrupted by a
//    fence blip lands as two rows a minute or two apart (owner report
//    2026-08-24, Tue 8/18: 5:24-5:27pm and 5:26-6:03pm are one stretch at the
//    yard shown as two lines). They fold into one, but ONLY when nothing else
//    on record sits inside the merged span: on the same day 12:49-1:28pm and
//    1:29-1:34pm look identical, and merging those would swallow the 1:29pm
//    drive out to the job, so they correctly stay apart.
// 2. THE WORKDAY WINDOW CLIPS THEM. Outside the day's first and last real
//    job/supply activity there is no shift to be on (see _geoShopCutoffs).
// 3. OVERLAPS ARE CLIPPED. _GEO_SHOP_DUP_OVERLAP_MS tolerates up to four
//    minutes of drift before two rows count as duplicates, so a surviving
//    overlap would otherwise pay the same minute twice.
//
// 4. AT A HOME SHOP, THE WALKING PART IS TRIMMED OUT of what is left (see
//    _geoActiveTrim). Optional and last: it only ever narrows a span that the
//    three rules above already agreed to pay, and it is skipped entirely
//    without a motion tape, so every other build keeps today's behavior.
//
// `entries` are shop_time_entries-shaped rows for ONE person; `win` is that
// person's day map from _geoShopCutoffs; `others` are their job_time_entries
// rows, used only to veto a merge that would swallow one; `tape` is the
// motion history from _geoMotionTape, or null/absent for dwell as before.
function _geoShopPaidSpans(entries,win,others,tape){
  const dstr=d=>(typeof _ctDateStr==='function')?_ctDateStr(d):dateKey(d);
  const rows=(Array.isArray(entries)?entries:[]).map((e,i)=>{
    const arr=Date.parse((e&&e.arrived_at)||'')||0;
    const dep=Date.parse((e&&e.departed_at)||'')||0;
    return {i,arr,dep,ok:arr>0&&dep>arr};
  });
  const out=rows.map(r=>({startMs:r.arr,endMs:r.arr,minutes:0,idleMs:0,idleCapMs:0,idleCapLearned:false,clipped:false,mergedInto:null}));
  const order=rows.filter(r=>r.ok).sort((a,b)=>a.arr-b.arr||a.dep-b.dep);
  const otherRows=(Array.isArray(others)?others:[])
    .map(e=>[Date.parse((e&&e.arrived_at)||'')||0,Date.parse((e&&e.departed_at)||'')||0])
    .filter(x=>x[0]>0&&x[1]>x[0]);
  // Something else overlapping the widened span by more than the edge slack
  // means the person was provably elsewhere inside it, so it is not one visit.
  const SLACK=60000;
  const swallowsSomething=(s,e)=>otherRows.some(x=>Math.min(x[1],e)-Math.max(x[0],s)>SLACK);
  const clusters=[];
  for(const r of order){
    const cur=clusters[clusters.length-1];
    if(cur&&r.arr-cur.dep<=_GEO_SHOP_CHAIN_MS&&
       dstr(new Date(cur.arr))===dstr(new Date(r.dep))&&
       !swallowsSomething(cur.arr,Math.max(cur.dep,r.dep))){
      cur.dep=Math.max(cur.dep,r.dep);cur.members.push(r.i);
    }else{
      clusters.push({arr:r.arr,dep:r.dep,members:[r.i]});
    }
  }
  // Nobody is at the yard and behind the wheel at the same instant, but the
  // fence lags the ignition, so a session and the leg pulling out of it can
  // report overlapping minutes (owner's Tue 8/18: yard 1:29-1:34pm against a
  // 1:29-1:36pm drive to the job). The leg is the one that means something,
  // so the yard side yields. Only DRIVE rows are clipped here: a manual clock
  // covering the same window is already trimmed off the shop side in Crew
  // Cost (js/finance.js _ccOverlapMs), and clipping it twice would dock those
  // minutes twice.
  const driveRows=(Array.isArray(others)?others:[])
    .filter(e=>e&&typeof _geoIsDriveSource==='function'&&_geoIsDriveSource(e.source))
    .map(e=>[Date.parse(e.arrived_at||'')||0,Date.parse(e.departed_at||'')||0])
    .filter(x=>x[0]>0&&x[1]>x[0]);
  const clipToDrives=(s,e)=>{
    let a=s,b=e;
    driveRows.forEach(x=>{
      if(x[1]<=a||x[0]>=b)return;              // no overlap
      if(x[0]<=a&&x[1]>=b){b=a;return;}        // fully covered: nothing left
      if(x[0]<=a){a=Math.max(a,x[1]);return;}  // eats the front
      if(x[1]>=b){b=Math.min(b,x[0]);}         // eats the back
      // A leg strictly inside a yard session is a fence artifact, not a real
      // split; leaving the session whole is closer to the truth than carving
      // it into two rows over a few minutes.
    });
    return [a,Math.max(a,b)];
  };
  // Did anything on record start as this session ended? A drive pulling out, a
  // visit beginning: proof the person LEFT rather than the phone going quiet
  // where it sat. Only 'others' can supply it, since another yard session
  // ending where this one does is the same standing still.
  // AFTER the session ends, not merely somewhere in the day. That distinction
  // is the whole rule: on the owner's Wed 8/19 the two manual clocks sit
  // INSIDE the 5:22-10:18pm yard session, which is somebody at the yard
  // clocking something while there, not somebody leaving. The next drive out
  // or visit starting once the session is over is what proves they left, and
  // it does not have to be instant: a 20-minute hole between the yard and the
  // next job is a drive the tracker did not write down, not a reason to
  // refuse the whole session.
  // Bounded, and same Central day. `others` carries the person's whole fetched
  // history, so an unbounded "anything after this" matched tomorrow morning's
  // drive and quietly proved every session was left (caught on the owner's own
  // week, 2026-08-24: Wed went straight back to 12h42m). An hour is the same
  // ceiling the visit merge uses for an unobserved gap.
  const leftAfter=endMs=>(Array.isArray(others)?others:[]).some(e=>{
    const a=Date.parse((e&&e.arrived_at)||'')||0;
    if(!(a>0))return false;
    if(a<endMs-_GEO_LEAVE_SLACK_MS)return false;      // happened before, not after
    if(a-endMs>60*60000)return false;                 // too far away to be this departure
    return dstr(new Date(a))===dstr(new Date(endMs));
  });
  // Resolved ONCE per render, not per session: the split is a property of how
  // this contractor works, and reading it per row would let two sessions on
  // one screen be judged by two different rules. Learned from every session
  // on screen (their own last week or two), with the default standing in
  // until the tape has earned an opinion.
  const homeShop=!!(tape&&_geoShopIsHome());
  const learned=homeShop?_geoLearnIdleCap(tape,clusters.map(c=>[c.arr,c.dep])):null;
  const idleCap=(learned==null)?_GEO_SHOP_IDLE_CAP_MS:learned;
  let runningEnd=0;
  for(const c of clusters){
    const day=dstr(new Date(c.arr));
    const pr0=_geoShopPaidRange(new Date(c.arr).toISOString(),new Date(c.dep).toISOString(),((win||{})[day])||null);
    // A session nobody was seen leaving is a parked truck, whatever the
    // workday window says about the hours around it. It still gets the
    // wrap-up allowance, which is exactly what that allowance is for.
    const pr1=(pr0[1]>pr0[0]&&!leftAfter(c.dep))
      ? [pr0[0],Math.min(pr0[1],pr0[0]+_geoShopWrapMs())]
      : pr0;
    const pr2=pr1[1]>pr1[0]?clipToDrives(pr1[0],pr1[1]):pr1;
    // Last, and only where the shop is the house: keep the walking part.
    const trim=(tape&&pr2[1]>pr2[0]&&homeShop)
      ? _geoActiveTrim(tape,pr2[0],pr2[1],idleCap)
      : {startMs:pr2[0],endMs:pr2[1],idleMs:0};
    const pr=[trim.startMs,trim.endMs];
    const start=Math.max(pr[0],runningEnd);
    const keep=out[c.members[0]];
    keep.startMs=start;
    keep.endMs=Math.max(start,pr[1]);
    keep.idleMs=trim.idleMs||0;
    // Carried so the Time Log can say WHERE the number came from. Payroll a
    // contractor cannot account for is worse than payroll that is slightly
    // wrong, and 'learned' vs 'default' is the whole explanation.
    keep.idleCapMs=homeShop?idleCap:0;
    keep.idleCapLearned=learned!=null;
    keep.minutes=Math.max(0,Math.round((keep.endMs-start-keep.idleMs)/60000));
    keep.clipped=start>c.arr;
    keep.mergedCount=c.members.length;
    keep.rawEndMs=c.dep;
    if(keep.endMs>runningEnd)runningEnd=keep.endMs;
    // Folded-away members keep a zero span and a pointer to the survivor, so a
    // caller renders one row per real visit and can still tell why.
    for(let k=1;k<c.members.length;k++){
      const m=out[c.members[k]];
      m.startMs=m.endMs=start;m.minutes=0;m.mergedInto=c.members[0];
    }
  }
  return out;
}
// Time at a known place, closed on departure. Bounded by a real fence at both
// ends, so unlike an off-job stop this is verified work time.
// Returns whether a row was actually enqueued, same contract as
// _geoCloseEntry (see its comment): _geoOnPing's flicker-undo reads this.
function _geoClosePlaceEntry(placeId,arrivedAt,departedIso){
  if(!arrivedAt)return false;
  const departed=departedIso||new Date().toISOString();
  // Same rule as the shop: a saved place marked home_office bills active app
  // time only, every other kind bills the dwell.
  const mins=_geoHomeDwell
    ? Math.floor(_geoHomeDwell.activeMs/60000)
    : Math.max(0,Math.round((Date.parse(departed)-Date.parse(arrivedAt))/60000));
  // Marked read, not nulled: see the matching comment in _geoCloseShopEntry.
  if(_geoHomeDwell)_geoHomeDwell.closed=true;
  if(mins<2)return false;        // a pass-through, not a stop
  if(!_supaUser)return false;
  // Element-guarded for the same reason as _geoJobLatLng below: a hole in
  // the array must cost this row its place NAME, never throw out of a visit
  // close and lose the whole entry.
  const pl=(typeof getPlaces==='function')?(getPlaces()||[]).find(p=>p&&String(p.id)===String(placeId)):null;
  _geoEnqueue('job_time_entries',{
    contractor_user_id:_geoCid(),employee_user_id:_supaUser.id,
    job_id:null,arrived_at:arrivedAt,departed_at:departed,minutes:mins,
    dest_place:(pl&&pl.name)||null,client_key:_geoVisitKey('place',placeId,arrivedAt),
    source:'place'
  });
  return true;
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
  const hasJob=b=>jobs.some(j=>j&&(j.bid_id===b.id||(!j.bid_id&&j.client_id===b.client_id&&(j.name||'')===(b.name||''))));
  return bids.some(b=>String(b.client_id)===String(clientId)&&b.status==='Closed Won'&&!b.completion_date&&!hasJob(b));
}
// The visit itself, closed on departure: same shape as a place visit (the
// client's name is the destination), so it lands in the day's story and the
// Time at Places report without a new table or source.
// Returns whether a row was actually enqueued, same contract as
// _geoCloseEntry (see its comment): _geoOnPing's flicker-undo reads this.
function _geoCloseClientEntry(clientId,arrivedAt,departedIso){
  if(!arrivedAt)return false;
  const departed=departedIso||new Date().toISOString();
  const mins=Math.max(0,Math.round((Date.parse(departed)-Date.parse(arrivedAt))/60000));
  if(mins<2)return false;         // a pass-through, not a visit
  if(!_supaUser)return false;
  const c=(typeof clients!=='undefined'&&Array.isArray(clients))?clients.find(x=>x&&String(x.id)===String(clientId)):null;
  _geoEnqueue('job_time_entries',{
    contractor_user_id:_geoCid(),employee_user_id:_supaUser.id,
    job_id:null,arrived_at:arrivedAt,departed_at:departed,minutes:mins,
    dest_place:(c&&c.name)||null,client_key:_geoVisitKey('client',clientId,arrivedAt),
    source:'place'
  });
  return true;
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
// SAVED PLACES AND CLIENT FENCES RESOLVE FIRST (owner 2026-08-26: "we should
// never miss saved geofence places and their correct drive and edge cases we
// already solved for"). The ping path already asks placeAt and _geoClientAt on
// every fix, so a stop anchor only ever forms OUTSIDE those fences, but three
// things can still put a real place under a "Stop" by close time: the anchor
// pin was a bad first fix that better fixes later corrected (the anchor now
// refines, see _geoOnPing), the place was saved mid-dwell (a promoted
// repeat-stop suggestion), or a client's geocode cache warmed up during the
// park. Resolving here, at close, with the SAME matchers and the SAME
// descriptor shape the fence path builds (curLoc in _geoOnPing) means every
// rule already solved downstream, purpose from _PLACE_KIND_TO_PURPOSE, the
// sameSpot placeId check in _geoDriveEntry, the queued-bid client labeling,
// the home-office commute call, applies to a resolved stop exactly as it does
// to a fence arrival. No parallel path (CLAUDE.md 7.3), the stop just stops
// being anonymous.
function _geoStopLoc(a,ms){
  const atHome=(typeof _placeIsLikelyHome==='function')&&_placeIsLikelyHome({lat:a.lat,lng:a.lng},ms);
  try{
    const pl=(typeof placeAt==='function')?placeAt({lat:a.lat,lon:a.lng}):null;
    if(pl)return {lat:pl.lat,lng:pl.lon,name:pl.name||'Place',kind:pl.kind||'other',
                  placeId:String(pl.id),addr:pl.addr||''};
    const cl=(typeof _geoClientAt==='function')?_geoClientAt({lat:a.lat,lng:a.lng}):null;
    if(cl)return {lat:cl.lat,lng:cl.lng,name:cl.name||'Client',kind:'client',
                  clientId:cl.id,addr:cl.addr||'',
                  queuedJob:(typeof _geoHasQueuedBid==='function')&&_geoHasQueuedBid(cl.id)};
  }catch(_e){}
  return {lat:a.lat,lng:a.lng,kind:'stop',likelyHome:atHome,
          name:atHome?(S.homeOffice?'Home Office':'Home'):'Stop'};
}
// The visit row for a closed stop, routed by what the pin resolved to. The
// overnight-park guard runs FIRST whatever the kind: the truck parked at the
// shop overnight was the original more-than-24-hours bug, and the shop being
// a saved place does not change what a park is. A resolved dwell then lands
// through the SAME writers a fence visit uses, so it reads as the place or
// client visit it actually was (source 'place', the name on dest_place, Time
// at Places, paid overhead) instead of an anonymous unpaid stop.
function _geoWriteStopResolved(a,ms,stopLoc){
  if(_geoStopIsOvernightPark(a,ms)){_geoParkNote('stop-skip','overnight park, no unpaid row');return;}
  if(stopLoc&&stopLoc.placeId){_geoClosePlaceEntry(stopLoc.placeId,a.at,a.lastAt);return;}
  if(stopLoc&&stopLoc.clientId){_geoCloseClientEntry(stopLoc.clientId,a.at,a.lastAt);return;}
  _geoWriteStop(a);
}
// The region set a dead app wakes on (owner 2026-08-27: work like Life360,
// log mileage and time even force-closed). Not just the kerb we parked at:
// every location the working day could plausibly touch. The shop, today's and
// tomorrow's job sites, the saved places, active clients with a warmed
// geocode. iOS grants 20 monitored regions per app; 18 leaves headroom and
// the native side caps again. Priority order decides who survives the cap,
// strongest fence first, mirroring the ping path's own precedence.
function _geoParkRegions(spot,spotRadius){
  const out=[];const seen=new Set();
  const baseM=_geoFenceFt()*0.3048+60;
  const push=(id,lat,lng,radius)=>{
    if(out.length>=18||lat==null||lng==null)return;
    const k=Number(lat).toFixed(4)+','+Number(lng).toFixed(4);
    if(seen.has(k))return;seen.add(k);
    out.push({id:String(id),lat:Number(lat),lng:Number(lng),radius:radius||baseM});
  };
  if(spot)push('fence',spot.lat,spot.lng,spotRadius);
  if(S.officeLat&&S.officeLon)push('shop',S.officeLat,S.officeLon);
  try{
    const tk=todayKey(),tm=addDays(tk,1);
    (typeof jobs!=='undefined'&&Array.isArray(jobs)?jobs:[]).forEach(j=>{
      if(!j||!j.start||j.status==='canceled')return;
      const d=parseInt(j.days)||1;
      let hits=false;
      for(let i=0;i<d;i++){const day=addDays(j.start,i);if(day===tk||day===tm){hits=true;break;}}
      if(!hits)return;
      const c=_geoJobCoords[j.id];
      if(c)push('job-'+j.id,c.lat,c.lng);
    });
  }catch(_e){}
  // Places and clients compete for whatever slots the tiers above left, and
  // NEAREST TO THE PARK SPOT WINS, pooled together (owner question
  // 2026-08-27: a day with no scheduled jobs, just driving to client homes).
  // These used to fill in raw array order, places first, so an account with
  // more candidates than slots armed an arbitrary 18 and a client two blocks
  // away could lose its fence to a supply house thirty miles gone. The next
  // stop is overwhelmingly near where you are now; sorting by distance from
  // the kerb makes the armed set the ones a wake could actually need.
  // No anchor to measure from (no spot, no last fence): array order stands.
  try{
    const pool=[];
    (typeof places!=='undefined'&&Array.isArray(places)?places:[]).forEach(pl=>{
      if(pl&&pl.lat!=null&&pl.lon!=null)pool.push({id:'place-'+pl.id,lat:pl.lat,lng:pl.lon,radius:pl.fenceFt?pl.fenceFt*0.3048+60:undefined});
    });
    const cache=(typeof _nearbyGeoCache==='function')?_nearbyGeoCache():{};
    (typeof clients!=='undefined'&&Array.isArray(clients)?clients:[]).forEach(c=>{
      if(!c||!c.addr)return;
      const hit=cache[c.id];
      if(hit&&hit.addr===c.addr)pool.push({id:'client-'+c.id,lat:hit.lat,lng:hit.lon});
    });
    const anchor=spot||_geoLastFenceLoc||null;
    if(anchor&&anchor.lat!=null){
      pool.forEach(p=>{p._ft=_geoDistFt({lat:p.lat,lng:p.lng},{lat:anchor.lat,lng:anchor.lng});});
      pool.sort((a,b)=>a._ft-b._ft);
    }
    pool.forEach(p=>push(p.id,p.lat,p.lng,p.radius));
  }catch(_e){}
  return out;
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
  _geoDriveEntry(null,_geoDriveStartedAt,(stopLoc.placeId||stopLoc.clientId)?stopLoc.name:null,a.at,false,stopLoc);
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
  // Already settled when they parked: the leg and the split are done, only
  // the departure time needs refining to the last fix seen at the kerb.
  const stopLoc=_geoStopLoc(a,ms);
  const known=!!(stopLoc.placeId||stopLoc.clientId);
  if(a.legClosed){
    _geoDriveStartedAt=a.lastAt;
    _geoDriveReset();
    // A pin that resolved to a saved place or client is not an unknown stop:
    // feeding it to the ledger would suggest saving somewhere already saved
    // (placeAt inside recordUnknownStop guards places, nothing guarded clients).
    if(!known&&typeof recordUnknownStop==='function')recordUnknownStop({lat:a.lat,lng:a.lng},ms);
    if(!_supaUser)return;
    _geoWriteStopResolved(a,ms,stopLoc);
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
  // Where the leg INTO this stop began, carried on the stop itself. If the stop
  // turns out to be personal, that is the point the next leg has to be measured
  // from: a lunch break in the middle of a supply-house-to-job-site run does not
  // make two trips out of one, it makes one trip with a detour in it, and only
  // the direct miles between the two business points are deductible (owner's
  // CPA, 2026-08-02). Recorded before the reassignment below, which is the only
  // moment it is still known.
  stopLoc.prevOrigin=_geoLegOrigin||null;
  if(_geoDriveStartedAt)_geoDriveEntry(null,_geoDriveStartedAt,known?stopLoc.name:null,a.at,false,stopLoc);
  _geoDriveStartedAt=a.lastAt;
  _geoDriveReset();   // the banner's "this trip" restarts with the leg out of the stop
  _geoLegOrigin=stopLoc;
  // Somewhere they park repeatedly is a candidate location in its own right,
  // which is how an un-named supply yard eventually gets offered to them.
  if(!known&&typeof recordUnknownStop==='function')recordUnknownStop({lat:a.lat,lng:a.lng},ms);
  if(!_supaUser)return;
  // Logged, and logged as ITSELF. Off-job time is neither job labor nor drive
  // time; folding it into either is what made a lunch break bill to a job.
  _geoWriteStopResolved(a,ms,stopLoc);
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
  // The job_time_entries row IS still written above (unconditionally, before
  // this check runs): the write itself doesn't know yet whether this leg will
  // turn out to be a round trip. What changed (owner rule 2026-08-22,
  // superseding the note that used to live here): drive time is paid ONLY
  // for a leg mileage itself would still stand behind, so a round trip with
  // no business in it now loses its pay too, not just its deduction, the
  // same fence-to-fence rule as everywhere else. That cleanup doesn't happen
  // here (this function has no way to un-enqueue a write already in the
  // durable queue); _geoSyncDriveTimeEntries removes it afterward, once it
  // can see that no mileage row (this leg wrote none, `return` below) ever
  // came to exist for this legKey.
  //
  // Distinct from the fence-bounce guard higher up, which drops the whole leg
  // including the time, because that one never happened at all.
  if(sameSpot){
    _geoParkNote('roundtrip-no-miles',destLoc&&(destLoc.name||destLoc.kind)||'');
    return;
  }
  // ── NOT A DRIVE: a flight, or a GPS teleport ─────────────────────────────
  // Same shape as the round trip above, and handled the same way: no mileage
  // row is written, and the drive time already enqueued for this leg is
  // removed afterwards by _geoSyncDriveTimeEntries, which drops any drive
  // entry whose legKey never grew a mileage row. See _GEO_MAX_DRIVE_MPH.
  if(_geoLegIsImpossible(_geoLegOrigin,destLoc,driveMins)){
    _geoParkNote('not-a-drive',(destLoc&&(destLoc.name||destLoc.kind)||'?')+' '+Math.round(driveMins||0)+'m');
    return;
  }
  // The arrival stamp rides along so the row can show WHEN the trip ran, not
  // just how long: a stale leg passes nothing, its clock times are fiction.
  _geoAutoMileage(_geoLegOrigin,destLoc,legKey,stale?arrived:driveStartedAt,companyVeh,driveMins,stale?null:arrived,obsMiles);
  // A leg just closed, which is exactly the evidence reconciliation reads:
  // schedule a debounced pass (no-op unless a live watcher is running).
  _geoReconcileSoon();
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
// True when a leg's own numbers say a vehicle could not have done it. Fails
// OPEN on purpose: missing coordinates or no wheel time means there is nothing
// to judge, and a real leg must never be dropped on a guess.
function _geoLegIsImpossible(from,to,driveMins){
  try{
    if(!from||!to||from.lat==null||to.lat==null)return false;
    const mins=Number(driveMins)||0;
    if(mins<3)return false;
    const mi=_geoDistFt({lat:from.lat,lng:from.lng},{lat:to.lat,lng:to.lng})/5280;
    if(!(mi>=_GEO_FLIGHT_MIN_MI))return false;
    return (mi/(mins/60))>_GEO_MAX_DRIVE_MPH;
  }catch(_e){return false;}
}
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
  // EVERYBODY, not just crew (owner ask 2026-08-26: "banner on their login if
  // they disable it"). This was gated on _isEmployee, so the one person who
  // could turn their own tracking off and never be told was the owner. It is
  // their mileage deduction, so they get the same banner the crew gets.
  if(!S.teamTracking&&_isEmployee){el.style.display='none';return;}
  // iOS's OWN word first, via the same _geoNatProblem the setup checklist
  // reads (7.3): one vocabulary, one set of copy, one fix path. The web
  // permission API below is the browser fallback and CANNOT see accuracy at
  // all, which is exactly why a phone dropped to Approximate used to sail past
  // this banner reporting 'granted'.
  let np=null,natSaid=false;
  try{
    np=(typeof _geoNatProblem==='function')?_geoNatProblem():null;
    const _n=(typeof _geoNativeAuthPeek==='function')?_geoNativeAuthPeek():null;
    natSaid=!!(_n&&_n.status);
  }catch(_e){}
  // _geoNatProblem deliberately does NOT cover denied or never-asked: the setup
  // checklist routes those through _geoPermState. The banner needs them, so it
  // asks iOS directly rather than leaning on a helper built for a different
  // question. Without this the early return below swallowed a denied phone,
  // which is the loudest case there is.
  if(!np&&natSaid){
    const _st=String(((typeof _geoNativeAuthPeek==='function')?_geoNativeAuthPeek():{}).status||'');
    if(_st==='denied'){
      el.style.display='block';
      el.innerHTML=_geoBannerHtml('Location is off',
        'TradeDesk logs your drive time and job hours automatically during work hours, and none of it runs with location off.',
        'Fix it');
      return;
    }
    if(_st==='notdetermined'){
      el.style.display='block';
      el.innerHTML=_geoBannerHtml('Turn on location',
        'Your drive miles and hours on each job log themselves once location is on. Work hours only.',
        'Turn on location');
      return;
    }
    // iOS SPOKE AND HAD NO COMPLAINT: done, hide it, and do NOT fall through.
    // The WebView keeps its own separate permission answer, which on a
    // perfectly healthy iPhone commonly reads 'prompt', so falling through
    // here put "Location is off" on a phone that was tracking fine. Caught
    // locally before this shipped, and it is the same trust-the-web-API-on-
    // native mistake the whole permission rework exists to stamp out.
    el.style.display='none';return;
  }
  if(np){
    // 'precisetemp' is not a break: it means we upgraded this session and it
    // IS working right now. The checklist still pushes for the permanent fix;
    // a red banner on a working phone would be a lie.
    if(np.kind==='precisetemp'){el.style.display='none';return;}
    el.style.display='block';
    el.innerHTML=_geoBannerHtml(np.title,np.sub,np.cta);
    return;
  }
  let state='prompt';
  try{
    if(navigator.permissions&&navigator.permissions.query){
      const p=await navigator.permissions.query({name:'geolocation'});state=p.state;
      // Re-render live if they flip the setting while the app is open
      if(!p._tdBound){p._tdBound=true;p.onchange=()=>_geoPermissionBanner();}
    }
  }catch(_e){}
  if(state==='granted'){el.style.display='none';return;}
  const denied=state==='denied';
  el.style.display='block';
  el.innerHTML=_geoBannerHtml('Location is off',
    'TradeDesk logs your drive time and job hours automatically during work hours, it only works with location on. '+
    (denied
      ?'Turn it back on in your phone: Settings → TradeDesk → Location → While Using the App.'
      :'Tap below and choose Allow While Using.'),
    denied?null:'Turn on location');
}
// One banner shell for every state, so the copy is the only thing that varies.
// The button routes through _setupTodoGo('location'), the SAME handler the
// setup checklist uses, rather than calling _geoRequestPermission directly:
// that handler already knows a settled iOS decision cannot be re-prompted and
// has to go to Settings, and knows to try the accuracy upgrade first when the
// complaint is Precise. Two buttons with two different ideas of how to fix
// this is how one of them becomes a dead button.
function _geoBannerHtml(title,body,cta){
  return '<div style="background:#FEF2F2;border:1px solid #FCA5A5;border-radius:var(--r);padding:12px 14px;margin-bottom:12px">'+
    '<div style="font-size:13px;font-weight:800;color:#991B1B;margin-bottom:4px">'+svgIcon('📍',{size:13})+' '+escHtml(title)+'</div>'+
    '<div style="font-size:12px;color:#991B1B;line-height:1.5;margin-bottom:'+(cta?'10px':'0')+'">'+escHtml(body)+'</div>'+
    (cta?'<button onclick="if(typeof _setupTodoGo===\'function\')_setupTodoGo(\'location\')" style="width:100%;padding:11px;border-radius:var(--r);border:none;background:#DC2626;color:#fff;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;min-height:44px">'+escHtml(cta)+'</button>':'')+
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
  // ── ON THE SHELL, ASKING IS startGeoTracking, NOT A FIX ATTEMPT ──────────
  //
  // Owner, 2026-08-26: "I want it to go to always and stay that way."
  //
  // Straight answer: iOS will not guarantee that. Always is the user's call and
  // Apple requires a confirmation for it. What it WILL do is grant PROVISIONAL
  // Always, and the BackgroundGeolocation watcher below already asks for
  // exactly that: on iOS, addWatcher with requestPermissions:true calls
  // requestAlwaysAuthorization, so accepting the ordinary "While Using" dialog
  // reports back Always and background delivery works from that moment, with
  // iOS confirming it later once it has seen real background use.
  //
  // The bug was the ORDER. This function used to call getCurrentPosition first
  // and only start tracking inside its SUCCESS callback. On the native shell
  // _geoInstallGeoShim has replaced getCurrentPosition with a plugin read that
  // passes requestPermissions:FALSE, deliberately, so it can never prompt. On a
  // fresh install with nothing granted, that read cannot produce a fix, so it
  // times out, the error path reports 'prompt', and startGeoTracking is NEVER
  // REACHED. No dialog. Ever.
  //
  // That is a dead button, and it is literally what the live account recorded
  // on 08-22: "Dead control, no effect on click: _setupTodoGo('location')|Fix
  // it". The tap did nothing because the only thing that can raise the prompt
  // sat behind a read that was configured never to raise one.
  //
  // So on the shell the ask IS starting the tracker. Nothing is read first. The
  // one-shot Always upgrade is spent by the watcher, which is the single place
  // that should ever spend it, and _geoRefreshNativeAuth reports back what iOS
  // actually decided rather than this inferring anything.
  try{
    const _cap=window.Capacitor;
    if(_cap&&typeof _cap.isNativePlatform==='function'&&_cap.isNativePlatform()){
      startGeoTracking();
      const settle=()=>{
        const nat=(typeof _geoNativeAuthPeek==='function')?_geoNativeAuthPeek():null;
        const st=(nat&&nat.status)||'';
        if(st==='always'||st==='wheninuse'){
          try{localStorage.setItem(_GEO_GRANTED_KEY,'1');}catch(_e){}
          done('granted');
        }else if(st==='denied'||st==='restricted'){done('denied');}
        // No watcher-alive shortcut here either (owner 2026-08-26). A live
        // watcher proves the tracker started, not what iOS granted, and those
        // two came apart in exactly the case that matters: whenInUse starts a
        // watcher perfectly well and delivers nothing from a pocket.
        else done('prompt');
      };
      // The dialog is modal and answered by a person, so read the result on a
      // delay rather than racing it. A wrong answer here is not fatal: the
      // foreground re-read corrects the row the moment they come back.
      setTimeout(()=>{
        if(typeof _geoRefreshNativeAuth==='function')_geoRefreshNativeAuth().then(settle,settle);
        else settle();
      },2500);
      return;
    }
  }catch(_e){}
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
      // COARSE OK: this is a permission probe, not a fix. The success handler
      // above throws the position away and records only the grant, so asking
      // for GPS accuracy here would spin the radio purely to learn an answer
      // a cached cell fix already gives.
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
// What iOS actually granted, in iOS's own words, when the shell can answer.
// Cached because _geoReadPermission is called on every checklist render and
// this is a bridge round trip, not a memory read.
//
// Owner, 2026-08-25: "shouldn't location and motion say always, while using
// app or declined in alliance with how iOS saves and asks for permissions?"
// Right, and the inference below never could: it reads whether the watcher is
// delivering, which is true for whenInUse as well, so the one distinction that
// decides whether this product works was invisible.
let _geoNativeAuth=null;      // {status,accuracy,precise,servicesEnabled} or null when unknown
function _geoNativeAuthPeek(){return _geoNativeAuth;}
async function _geoRefreshNativeAuth(){
  // CLEARED, not left standing, whenever an answer cannot be had. Caught by
  // its own test: without this the last known authorization survives forever,
  // so a phone whose plugin stops answering (an upgrade, a rejection, a shell
  // swap) keeps reporting a stale 'always / reduced' as though it were current.
  // Stale permission data on a row that explains payroll is worse than none:
  // 'we do not know right now' is honest, a remembered grant is not.
  try{
    const Td=(typeof _geoTdPlugin==='function')?_geoTdPlugin():null;
    if(!Td||typeof Td.locationPermStatus!=='function'){_geoNativeAuth=null;return null;}
    const r=await Td.locationPermStatus();
    if(!r||!r.status){_geoNativeAuth=null;return null;}
    _geoNativeAuth={status:String(r.status),
                    accuracy:r.accuracy?String(r.accuracy):null,
                    precise:r.precise!==false,
                    // The device-wide Location Services switch, a THIRD axis
                    // independent of both of the above (owner 2026-08-25,
                    // "device wide location services ... why do we need it?").
                    // Turning it off in Settings leaves this app's own grant
                    // reading 'always' untouched while no fix will ever
                    // arrive again, which is exactly what a live account
                    // showing always and zero pings looks like. Strict
                    // boolean check, never a truthiness coercion: a shell too
                    // old to send the key at all must land as null (unknown),
                    // not as false (switched off), because those two mean
                    // opposite things to whoever reads the row.
                    servicesEnabled:(typeof r.servicesEnabled==='boolean')?r.servicesEnabled:null};
    // The temporary grant lapsed (app relaunched, or iOS took it back), so the
    // flag that describes it has to go with it. Cleared HERE rather than on a
    // timer because iOS's own answer is the only thing that knows.
    if(String(r.accuracy||'')!=='full')_geoPreciseTemp=false;
    return _geoNativeAuth;
  }catch(_e){_geoNativeAuth=null;return null;}
}
// ── Precise Location, asked for instead of pointed at ────────────────────────
//
// Owner rule 2026-08-26: "we need the tightest location services upfront at all
// times, never can default to approximates." A user on reduced accuracy is
// about a mile wide, so a 600ft job fence can never fire and an arrival never
// registers. _geoNatProblem already SEES that (kind 'precise') and the crew
// roster already shows it amber; until now the only thing either could do was
// send somebody into Settings and hope.
//
// requestTemporaryFullAccuracyAuthorization is the one API that can fix it from
// inside a tap. What it gives back is SESSION-SCOPED: iOS drops it the moment
// the app is relaunched. So this makes today work and nothing more, and every
// piece of copy hanging off it has to say so, or people stop checking the
// switch that would have fixed it for good.
//
// _geoPreciseTemp is deliberately IN MEMORY ONLY, never localStorage: the
// authorization it describes dies with the process, so a flag that outlived the
// process would be a record of something that is no longer true, which is the
// same class of mistake as a remembered permission grant.
const _GEO_PRECISE_PURPOSE_KEY='JobSiteAccuracy';   // must match NSLocationTemporaryUsageDescriptionDictionary in .github/workflows/ios-beta.yml
let _geoPreciseTemp=false;
function _geoPreciseTempPeek(){return _geoPreciseTemp;}
// Returns {ok,supported,precise,temporary,reason}. Never throws and never
// rejects: every caller is a tap handler that has to decide what to do next,
// and 'we could not ask' has to be an answer rather than an exception.
async function _geoRequestPreciseTemp(){
  const miss={ok:false,supported:false,precise:false,temporary:false,reason:'unsupported'};
  let r=null;
  try{
    const Td=(typeof _geoTdPlugin==='function')?_geoTdPlugin():null;
    // A browser, or a TestFlight shell built before this method existed. Not an
    // error, just nothing to ask with, and the caller falls back to Settings.
    if(!Td||typeof Td.requestPreciseTemp!=='function')return miss;
    r=await Td.requestPreciseTemp({purposeKey:_GEO_PRECISE_PURPOSE_KEY});
  }catch(_e){return miss;}
  if(!r)return miss;
  const precise=!!r.precise;
  // Only a grant this call produced counts as temporary. Already-full answers
  // back with temporary:false, and treating those as lapsing would nag a person
  // whose Precise Location is permanently on.
  _geoPreciseTemp=precise&&!!r.temporary;
  // Re-read iOS and repaint, so the roster row and the setup checklist both
  // reflect what just happened instead of the state from before the tap.
  try{if(typeof _geoRefreshNativeAuth==='function')await _geoRefreshNativeAuth();}catch(_e){}
  try{if(typeof _geoRefreshPermCache==='function')_geoRefreshPermCache();}catch(_e){}
  return {ok:precise,supported:r.supported!==false,precise:precise,
          temporary:!!_geoPreciseTemp,reason:String(r.reason||(precise?'granted':'declined'))};
}
async function _geoReadPermission(){
  // iOS's own answer wins whenever the shell is new enough to give one. An
  // older TestFlight build has no such method, and then the inference below
  // still runs exactly as it did: this degrades, it does not break.
  const nat=await _geoRefreshNativeAuth();
  if(nat&&nat.status){
    // The checklist and every existing caller reason in done/not-done, so the
    // two authorized states both answer 'granted' THERE. The precise state is
    // carried separately (_geoNativeAuthPeek) for the row that gets reported,
    // rather than being flattened away at the only place it still exists.
    if(nat.status==='always'||nat.status==='wheninuse')return 'granted';
    if(nat.status==='denied'||nat.status==='restricted')return 'denied';
    return 'prompt';
  }
  // ── ON NATIVE, iOS IS THE ONLY VOICE ─────────────────────────────────────
  //
  // Owner, 2026-08-26: "I don't want ours, ours does nothing in a true native
  // app, go entirely off iOS since location calls capacitor plugins."
  //
  // Correct. Everything below this line reads WebView state, localStorage and
  // whether our own watcher happens to be alive, and not one of those is what
  // the phone thinks. They agreed with iOS often enough to look right and
  // disagreed exactly when it mattered: a watcher spinning up read as
  // 'granted' while the actual grant was whenInUse, so a phone that could
  // never track in the background reported itself healthy.
  //
  // So a native shell gets iOS's answer or nothing. 'prompt' here means "not
  // established", never "they said no": the checklist treats it as not-done
  // and offers the ask, which is harmless and is exactly the thing that fixes
  // it. The row also carries derived:true, so the database says plainly that
  // no native answer was available rather than presenting a guess as fact.
  //
  // CONSEQUENCE, stated rather than buried: a shell older than build 36 has no
  // locationPermStatus, so it can never answer, so its checklist item stays
  // open until the person updates. That is the honest reading of a phone we
  // genuinely cannot interrogate, and it is a nag rather than a wrong number.
  try{
    const _cap=window.Capacitor;
    if(_cap&&typeof _cap.isNativePlatform==='function'&&_cap.isNativePlatform())return 'prompt';
  }catch(_e){}
  return _geoReadPermissionInferred();
}
// BROWSER ONLY (owner 2026-08-26). The native branch that used to live at the
// top of this function is gone: it read our own watcher, our own localStorage
// consent flag and our own os-denied flag, none of which is what iOS thinks,
// and a native shell now returns before ever reaching here. What is left is
// the genuine web path, where navigator.permissions IS the platform's answer
// rather than a stand-in for it.
async function _geoReadPermissionInferred(){
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
// ── What this handset can actually do, on the server ────────────────────────
// Owner, 2026-08-25: "it should write for all users."
//
// This used to begin `if(!_isEmployee)return`, so an OWNER, which is most of
// the customer base, could never report anything even in principle. The state
// lived only in localStorage, nothing synced it, and the honest answer to
// "what does the database say about this contractor's location permission"
// was: nothing, we never asked. That is why a brand-new signup logging no
// drives could not be diagnosed from here at all.
//
// Two destinations on purpose, and they are not duplicates:
//   • device_status  , EVERY user, one row per handset. The real record.
//   • team_members   , employees only, unchanged. The crew screens already
//     read location_status off that row, and quietly moving it would break
//     them for a rename nobody asked for.
//
// Motion rides along because the plugin could always answer it
// (TdGeo.motionPermStatus) and there was nowhere to put the answer.
// Battery, straight off the plugin. TdGeo.stats() has always returned it (it
// exists for the radio-time accounting) and nothing but the shadow-engine
// diagnostic ever looked. Cached rather than awaited inside the upsert so a
// slow or missing plugin can never delay or block the permission row, which is
// the row that actually explains payroll.
let _geoBatt=null;
function _geoBattPeek(){return _geoBatt;}
async function _geoRefreshBattery(){
  try{
    const Td=(typeof _geoTdPlugin==='function')?_geoTdPlugin():null;
    if(!Td||typeof Td.stats!=='function'){_geoBatt=null;return null;}
    const st=await Td.stats();
    // -1 is the plugin's own "could not read", and must stay distinguishable
    // from a genuinely flat phone.
    const lvl=(st&&+st.batteryLevel>=0)?+st.batteryLevel:null;
    _geoBatt=(lvl==null)?null:{level:lvl,charging:!!(st&&st.charging)};
    return _geoBatt;
  }catch(_e){_geoBatt=null;return null;}
}
function _geoReportPermission(state){
  if(!_supa||!_supaUser)return;
  const now=new Date().toISOString();
  let devId=null,devLabel=null;
  try{
    devId=(typeof _initDeviceId==='function')?_initDeviceId():null;
    const d=(typeof S!=='undefined'&&S.devices||[]).find(x=>x&&x.id===devId);
    devLabel=(d&&(d.name||d.label))||((typeof _deviceLabel==='function')?_deviceLabel():null);
  }catch(_e){}
  // ONE read of the native cache for the whole row: three separate
  // _geoNativeAuthPeek() calls could each see a different refresh landing
  // between them, and a row that mixes two answers is worse than either.
  const _natPerm=((typeof _geoNativeAuthPeek==='function')?_geoNativeAuthPeek():null)||{};
  // No device id means no stable key, and a row keyed on a guess would
  // multiply on every boot. Skip rather than pollute.
  if(devId){
    try{
      _supa.from('device_status').upsert({
        user_id:_supaUser.id,
        device_id:devId,
        device_label:devLabel||null,
        contractor_user_id:(typeof _geoCid==='function')?_geoCid():_supaUser.id,
        // iOS's own word when the shell can give one: always / wheninuse /
        // denied / restricted / notdetermined. Falls back to the flattened
        // granted/denied/prompt on a shell too old to answer, which is why the
        // column is free text and not an enum.
        location_status:_natPerm.status||state||'prompt',
        // Precise Location is a SEPARATE switch. Always plus reduced accuracy
        // is granted and useless at the same time against a 600ft fence, and
        // folding it into the status above would hide exactly that.
        location_accuracy:_natPerm.accuracy||null,
        // Device-wide Location Services, straight off iOS
        // (CLLocationManager.locationServicesEnabled, read off the main
        // thread in TdGeoPlugin). null means the shell could not answer, and
        // it has to stay distinguishable from false: 'we do not know' and
        // 'the master switch is off' are different diagnoses.
        location_services_enabled:_natPerm.servicesEnabled===true?true:(_natPerm.servicesEnabled===false?false:null),
        // Read from the same cache the checklist renders off, so the row and
        // the screen can never disagree. Undefined (never checked) stays null
        // rather than being written as a guess.
        motion_status:(typeof _motionPermCache!=='undefined'&&_motionPermCache)?_motionPermCache:null,
        // A dead phone and a phone with location off look identical on the
        // roster otherwise, and one of them is fixed with a charger.
        battery_level:_geoBatt?_geoBatt.level:null,
        battery_charging:_geoBatt?_geoBatt.charging:null,
        // TRUE when this row is a guess rather than iOS's own word (owner
        // 2026-08-25: "don't keep inferring, build explicitly off what iOS
        // reports"). It was hardcoded false, which quietly presented the
        // web-shaped inference in _geoReadPermissionInferred as though iOS
        // had said it. The inference still runs, because a plain browser has
        // nothing else, but the row now says which kind of answer it holds.
        derived:!(_natPerm&&_natPerm.status),
        app_version:(typeof APP_VERSION!=='undefined')?APP_VERSION:null,
        checked_at:now
      },{onConflict:'user_id,device_id'}).then(()=>{},()=>{});
    }catch(_e){}
  }
  if(!_isEmployee)return;
  const patch={location_status:state||'prompt',location_checked_at:now};
  if(devLabel)patch.location_device=devLabel;
  try{_supa.from('team_members').update(patch).eq('employee_user_id',_supaUser.id).then(()=>{},()=>{});}catch(_e){}
}

// ── Re-read permission every time the app comes back to the front ───────────
// The gap this closes, reported live 2026-08-25: change a permission in the
// iOS Settings app and come back, and nothing re-checked. The app kept
// rendering the old answer, the setup checklist kept nagging, and the server
// row (above) stayed stale, all because the only refresh ran when the
// dashboard happened to render.
//
// Bound at load rather than inside _geoTrackInit, which returns early when
// team tracking is off: whether a phone CAN track is worth knowing even on an
// account that currently does not.
//
// Reporting itself is still change-gated inside _geoRefreshPermCache, so a
// foreground that finds nothing new writes nothing. The heartbeat below is the
// exception: past _GEO_PERM_STALE_MS the row is refreshed anyway, so
// checked_at means "this was true recently" instead of "this was true once".
const _GEO_PERM_STALE_MS=6*60*60*1000;
let _geoPermReportedAt=0;
function _geoPermForeground(){
  try{if(typeof _geoConfigureFlush==='function')_geoConfigureFlush();}catch(_e){}
  try{if(typeof _geoRefreshBattery==='function')_geoRefreshBattery();}catch(_e){}
  try{if(typeof _geoRefreshPermCache==='function')_geoRefreshPermCache();}catch(_e){}
  try{if(typeof _motionRefreshPermCache==='function')_motionRefreshPermCache();}catch(_e){}
  const now=Date.now();
  if(now-_geoPermReportedAt<_GEO_PERM_STALE_MS)return;
  _geoPermReportedAt=now;
  // READ NATIVE, THEN REPORT. This used to kick off _geoRefreshPermCache()
  // above, which is ASYNC, and then immediately report _geoPermState(), which
  // reads a cache SYNCHRONOUSLY. On a fresh boot that cache is still empty and
  // _geoNativeAuth has not been filled either, so the row written here said
  // 'prompt' with derived:true and every native field null, and because the
  // write is an upsert on (user_id, device_id) it CLOBBERED any good row a
  // previous pass had produced. Then the 6-hour staleness gate above locked
  // that bad row in until tomorrow. Observed on the owner's own handset the
  // hour build 36 landed: motion reported 'granted' from the same plugin while
  // location reported nothing at all.
  try{
    if(typeof _geoReadPermission!=='function')return;
    _geoReadPermission().then(st=>{
      try{if(typeof _geoReportPermission==='function')_geoReportPermission(st);}catch(_e){}
      try{_geoAutoPrecise();}catch(_e){}
    }).catch(()=>{});
  }catch(_e){}
}
// ── Precise, every session, without waiting to be asked (owner rule
// 2026-08-26: "we better have precise location at all times") ───────────────
//
// BE CLEAR ABOUT WHAT IS POSSIBLE. iOS has no permanent override. A user who
// turned Precise Location off owns that decision, and the ONLY permanent way
// back is the Settings switch. requestTemporaryFullAccuracyAuthorization buys
// full accuracy for THIS app session and iOS drops it on the next launch.
//
// So "at all times" is delivered the only way it can be: ask on every session
// where iOS reports reduced, instead of waiting for someone to notice a
// checklist item and tap it. A phone that would otherwise have run all day at
// mile-wide accuracy runs precise from the moment the app opens, and the
// roster and checklist keep pushing for the permanent fix underneath.
//
// ONCE PER SESSION, in memory, deliberately. The grant dies at launch, so
// re-asking each launch is exactly matched to when it is needed and nothing
// more. Repeating it inside one session would be nagging, which is the
// behaviour Apple's 5.1.1 is aimed at.
let _geoAutoPreciseAsked=false;
function _geoAutoPrecise(){
  if(_geoAutoPreciseAsked)return false;
  if(typeof _geoRequestPreciseTemp!=='function')return false;
  const n=(typeof _geoNativeAuthPeek==='function')?_geoNativeAuthPeek():null;
  if(!n||!n.status)return false;                      // no iOS answer, nothing to act on
  // Only when they HAVE granted location and it is merely imprecise. Denied or
  // not-yet-asked are different problems with different fixes, and asking for
  // an accuracy upgrade on top of them is noise.
  if(n.status!=='always'&&n.status!=='wheninuse')return false;
  if(String(n.accuracy||'')!=='reduced')return false;  // already precise
  _geoAutoPreciseAsked=true;
  _geoParkNote('precise-auto','asking iOS to upgrade reduced accuracy');
  try{_geoRequestPreciseTemp();}catch(_e){}
  return true;
}
try{
  if(typeof document!=='undefined'&&!window._geoPermVisBound){
    window._geoPermVisBound=true;
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)_geoPermForeground();});
  }
}catch(_e){}

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
let _geoMotionBurstAt=0;        // one motion-triggered burst per 3 min
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
// Stores the FULL ISO instant, not a display format: _geoDiagPanel converts
// to Central at render time (owner ask 2026-08-23), and keeping the raw
// instant here means that conversion is always exact, never a guess at
// which year an old, already-stored entry belonged to.
function _geoParkNote(ev,extra){
  try{
    _geoParkLog.push({t:new Date().toISOString(),ev:ev,x:extra?String(extra).slice(0,140):''});
    if(_geoParkLog.length>30)_geoParkLog.splice(0,_geoParkLog.length-30);
    localStorage.setItem('td_geo_park_log',JSON.stringify(_geoParkLog));
  }catch(_e){}
}
// Central-time display for one _geoParkLog entry (owner ask 2026-08-23: the
// panel showed raw UTC, confusing against a phone that's on Central time).
// Handles both shapes ever stored here: the old sliced 'MM-DDTHH:MM:SS' (no
// year, implicitly UTC, from before this fix) and the current full ISO,
// so an existing on-device log still reads correctly after an app update.
function _geoDiagFmtT(raw){
  if(!raw)return '';
  try{
    const iso=/^\d{4}-/.test(raw)?raw:(new Date().getFullYear()+'-'+raw+'Z');
    const d=new Date(iso);
    return isNaN(d.getTime())?raw:((typeof _ctStamp==='function')?_ctStamp(d):raw);
  }catch(_e){return raw;}
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
// ── The shift heartbeat, armed at every chance JS gets ──────────────────────
// Owner report 2026-08-27 (live device, morning at a job): zero heartbeat
// events all day. The only call site was _geoEnterParkMode, and park mode only
// arms after minutes of live JS pings, which a phone that arrives at a job and
// goes straight into a pocket never provides. The native wake lane kept
// posting fixes, so the pipe looked healthy while the 30-minute beat never
// started: the switch was simply never thrown.
//
// So the heartbeat is now armed at SHIFT START, from every place JS provably
// runs: the moment tracking starts, the moment a drive opens, and (as before)
// the moment park mode arms. Parking at the likely-home pin still stops it,
// and the native ttl still self-stops a beat nobody turned off. Re-arming is
// idempotent on the native side (the timer restarts, the ttl refreshes), and
// the 60s throttle keeps drive-start churn off the bridge.
let _geoHbArmedAtMs=0;
function _geoHeartbeatSync(spot){
  try{
    const Td=_geoTdPlugin();
    if(!Td||typeof Td.startHeartbeat!=='function')return;
    const atHome=!!(spot&&typeof _placeIsLikelyHome==='function'&&_placeIsLikelyHome({lat:spot.lat,lng:spot.lng},0));
    if(atHome){
      _geoHbArmedAtMs=0;
      if(typeof Td.stopHeartbeat==='function')Promise.resolve(Td.stopHeartbeat()).catch(()=>{});
      _geoParkNote('hb-off','home park');
      return;
    }
    if(Date.now()-_geoHbArmedAtMs<60000)return;
    _geoHbArmedAtMs=Date.now();
    Promise.resolve(Td.startHeartbeat({intervalMs:30*60000,ttlMs:12*3600000})).catch(()=>{});
    _geoParkNote('hb-on','30m tick armed');
  }catch(_e){}
}
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
  // The full wake set, not just this kerb: a force-closed app's ONLY way to
  // learn about tomorrow morning's drive is a region it armed tonight.
  // startEvents also turns on iOS visit monitoring (arrival/departure
  // reports with real timestamps, no radio), the piece that stamps unfenced
  // stops while the app is dead. Older shells without it fall back to the
  // single-region park arm, exactly the old behavior.
  const _regs=_geoParkRegions(_at,radiusM);
  const _armCall=(typeof Td.startEvents==='function')
    ?Td.startEvents({regions:_regs})
    :Td.startParked({regions:_regs.slice(0,1)});
  Promise.resolve(_armCall)
    .then((r)=>{
      _geoParkModeOn=true;
      _geoParkNote('park-on','armed='+((r&&r.armed)!=null?r.armed:'?'));
      // The shift heartbeat (owner 2026-08-27: catch the phone left in the
      // truck or set down all day). A park at a WORK spot keeps a 30-minute
      // liveness tick alive; a park at the likely-home pin is the end of the
      // shift and turns it off. Timing lives here in JS; the plugin only
      // holds the low-power session and fires the tick. ttl self-stops a
      // heartbeat nobody turned off (phone left at the shop over a weekend).
      _geoHeartbeatSync(_at);
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
// ONE clipboard path for every on-device diagnostic (the location panel here,
// the engine comparison in js/geo-shadow.js). A diagnostic you cannot get OFF
// the phone is only half a diagnostic, and there is no reason for two of them
// to carry two different fallbacks that drift apart.
//
// Also fixes a real hole in the original: on a WebView with no
// navigator.clipboard at all, reading .writeText off undefined threw, the
// outer catch swallowed it, and the button did nothing with no toast to say
// so. The textarea path is now the fallback for BOTH a missing API and a
// rejected write.
function _geoCopyText(txt){
  const str=String(txt||'');
  const done=()=>{try{if(typeof showToast==='function')showToast('Copied. Paste it in a message.','\ud83d\udccb');}catch(_e){}};
  const fallback=()=>{
    try{
      const ta=document.createElement('textarea');ta.value=str;ta.style.cssText='position:fixed;top:-1000px';
      document.body.appendChild(ta);ta.select();try{document.execCommand('copy');}catch(_e){}ta.remove();
    }catch(_e){}
    done();
  };
  try{
    if(navigator&&navigator.clipboard&&typeof navigator.clipboard.writeText==='function'){
      navigator.clipboard.writeText(str).then(done,fallback);
    }else fallback();
  }catch(_e){fallback();}
}
// ── Permission lab: drive the iOS prompt and watch what comes back ─────────
//
// Owner, 2026-08-26: "I need a way on logansample97 to test location iOS
// prompts and switching but only in that in dev tools."
//
// Reuses _geoDiagPanel's shell exactly (.zmodal-overlay/.zmodal, 7.3) rather
// than inventing a second panel style. Lives under Settings > Developer >
// Location engine, so it is gated twice: the Developer row only exists for an
// is_dev account, and dev-geo-tools only unhides on a native shell.
//
// WHAT IT CANNOT DO, said on the panel itself rather than discovered by
// tapping: no app can reset or downgrade its own iOS authorization. Once a
// decision exists iOS will not re-show the dialog from script, so "switching"
// means going to Settings and changing it there, or deleting and reinstalling
// to get back to notDetermined. The Reset button here clears OUR local state
// only, which is what makes the first-run PATH testable even though the OS
// dialog itself will not come back.
function _geoPermLab(){
  const nat=((typeof _geoNativeAuthPeek==='function')?_geoNativeAuthPeek():null)||null;
  const row=(k,v,note)=>'<div style="display:flex;justify-content:space-between;gap:12px;font-size:12px;padding:5px 0;border-bottom:1px solid var(--border)">'+
    '<span style="color:var(--text3)">'+escHtml(k)+'</span>'+
    '<span style="font-weight:700;text-align:right">'+escHtml(String(v))+(note?'<div style="font-weight:400;color:var(--text3);font-size:11px">'+escHtml(note)+'</div>':'')+'</span></div>';
  const ov=document.createElement('div');ov.id='_geo-perm-ov';ov.className='zmodal-overlay';
  const m=document.createElement('div');m.className='zmodal';
  m.innerHTML=
    '<div style="font-size:16px;font-weight:800;margin-bottom:2px">Permission lab</div>'+
    '<div style="font-size:11px;color:var(--text3);margin-bottom:12px">Everything below is read straight off iOS. Nothing here is inferred.</div>'+
    '<div id="_geo-perm-state">'+
      row('iOS location',nat&&nat.status?nat.status:'not reported')+
      row('Precise Location',nat&&nat.accuracy?nat.accuracy:'not reported')+
      row('Location Services (device)',!nat?'unknown':(nat.servicesEnabled===true?'ON':(nat.servicesEnabled===false?'OFF':'unknown')))+
      row('Motion',(typeof _motionPermCache!=='undefined'&&_motionPermCache)?_motionPermCache:'not checked')+
      row('Tracker watcher',_geoNativeWatcherId!=null?'running':'off')+
      row('Our consent record',localStorage.getItem('geo_owner_consent')||'unset','ours, not iOS')+
    '</div>'+
    '<div style="font-size:11px;color:var(--text3);line-height:1.6;margin:12px 0 4px">'+
      'iOS only shows its dialog once per install. After that it will not re-prompt from script, so to <strong>switch</strong> a state go to '+
      'Settings &rsaquo; TradeDesk &rsaquo; Location and change it there, then come back and tap Re-read. To get the very first prompt back you have to delete and reinstall the app.'+
    '</div>'+
    '<div id="_geo-perm-say" style="font-size:12px;font-weight:600;color:var(--blue);min-height:17px;margin-top:10px"></div>'+
    _geoPermAct('ask','Ask iOS now','_geoPermLabAsk()',true,
      'Asks iOS for location permission, and pokes motion at the same time (CoreMotion has no separate request call, so the first query IS its prompt). '+
      'A dialog only appears on a phone that has never answered. Once iOS holds a decision it will not re-show it from script, so on your phone this reports what the answer already is instead of doing nothing.')+
    _geoPermAct('reread','Re-read from iOS','_geoPermLabReread()',false,
      'Drops what we have cached and asks the phone again for all three switches plus motion. '+
      'Use it right after changing something in Settings so this panel and the server row catch up, instead of waiting for the app to be closed and reopened.')+
    _geoPermAct('settings','Open iOS Settings','_geoPermLabSettings()',false,
      'Jumps straight to Settings, TradeDesk, where the Location and Motion switches actually live. '+
      'Once iOS has a decision this is the ONLY place it can be changed. Nothing on this panel can change it for you.')+
    _geoPermAct('reset','Reset our local state','_geoPermLabReset()',false,
      'Clears OUR records only: the consent flag, the OS-denied flag and the granted marker. '+
      'iOS authorization is untouched and cannot be touched from here. Use it to re-run the first-run code path without reinstalling. It will NOT bring the system dialog back.')+
    '<button class="btn" style="width:100%;margin-top:14px;padding:12px" onclick="document.getElementById(\'_geo-perm-ov\').remove()">Close</button>';
  ov.appendChild(m);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
}
function _geoPermLabRefresh(){
  const ov=document.getElementById('_geo-perm-ov');
  if(!ov)return;
  ov.remove();_geoPermLab();
}
// One action row: the button, an info dot beside it, and the explanation it
// reveals underneath (owner ask 2026-08-26: "what do all these buttons do?
// maybe an i block next to them with a popup explaining would be helpful").
//
// Inline disclosure rather than a popup ON a popup: this panel is already a
// .zmodal, and stacking a second overlay on a phone is how you end up unable
// to dismiss either. Tapping the dot toggles the text in place, so the
// explanation sits next to the thing it explains and closes the same way.
function _geoPermAct(id,label,onclick,primary,why){
  return '<div style="display:flex;gap:8px;align-items:stretch;margin-top:8px">'+
      '<button class="btn'+(primary?' btn-p':'')+'" style="flex:1;padding:12px" onclick="'+onclick+'">'+escHtml(label)+'</button>'+
      '<button class="btn" aria-label="What does '+escHtml(label)+' do?" style="width:46px;padding:12px 0;font-weight:800;font-size:15px" onclick="_geoPermWhy(\''+id+'\')">i</button>'+
    '</div>'+
    '<div id="_geo-why-'+id+'" style="display:none;font-size:12px;color:var(--text3);line-height:1.6;padding:8px 10px;margin-top:6px;border-left:2px solid var(--blue);background:var(--bg2);border-radius:0 var(--r) var(--r) 0">'+escHtml(why)+'</div>';
}
function _geoPermWhy(id){
  const el=document.getElementById('_geo-why-'+id);
  if(!el)return;
  const open=el.style.display!=='none';
  // One at a time: four open blocks turns the panel into a wall of text on a
  // phone and pushes the buttons off screen.
  ['ask','reread','settings','reset'].forEach(k=>{
    const n=document.getElementById('_geo-why-'+k);
    if(n)n.style.display='none';
  });
  if(!open)el.style.display='';
}
function _geoPermLabSay(msg){
  const el=document.getElementById('_geo-perm-say');
  if(el)el.textContent=msg||'';
}
// SHIPPED WITHOUT FEEDBACK and the owner found it within the hour: "two
// presses to ask iOS now, didn't roll a thing, why?" Because his phone is
// already 'always', so iOS has nothing left to ask and startGeoTracking
// returns instantly when a watcher is live. The tap DID run. The panel just
// showed nothing either way, which is the exact dead-button shape this whole
// night has been about, shipped in the tool built to diagnose it.
//
// Two fixes. It no longer pretends to ask when iOS has already decided, since
// iOS will not re-show its dialog from script and a button that silently
// no-ops is worse than one that explains itself. And every tap now says what
// it did, in the panel, immediately.
function _geoPermLabAsk(){
  _geoPermLabSay('Checking with iOS...');
  const after=(nat)=>{
    const st=(nat&&nat.status)||'';
    if(st==='always'||st==='wheninuse'){
      _geoPermLabSay('iOS already answered: '+st+'. It will not ask again. Use Open iOS Settings to change it.');
      return;
    }
    if(st==='denied'||st==='restricted'){
      _geoPermLabSay('iOS says '+st+'. Only Settings can undo that, the dialog is spent.');
      return;
    }
    // notdetermined, or a shell that cannot tell us: this is the one case
    // where asking can still produce a dialog.
    _geoPermLabSay('Asking iOS...');
    try{
      if(typeof _geoRequestPermission==='function'){
        _geoRequestPermission(()=>{
          _geoPermLabSay('Answered. Re-reading...');
          setTimeout(_geoPermLabRefresh,600);
        });
      }else _geoPermLabSay('No permission path on this shell.');
    }catch(_e){_geoPermLabSay('Ask failed: '+((_e&&_e.message)||_e));}
    // Motion has no separate request call: the first query IS the prompt, so
    // asking for it alongside is what makes the pair testable in one tap.
    try{
      const Td=(typeof _geoTdPlugin==='function')?_geoTdPlugin():null;
      if(Td&&typeof Td.motionSince==='function')Td.motionSince({sinceMs:Date.now()-60000}).catch(()=>{});
    }catch(_e){}
  };
  try{
    if(typeof _geoRefreshNativeAuth==='function')_geoRefreshNativeAuth().then(after,()=>after(null));
    else after((typeof _geoNativeAuthPeek==='function')?_geoNativeAuthPeek():null);
  }catch(_e){after(null);}
}
function _geoPermLabReread(){
  _geoPermLabSay('Re-reading from iOS...');
  const done=()=>{try{if(typeof _motionRefreshPermCache==='function')_motionRefreshPermCache();}catch(_e){}setTimeout(_geoPermLabRefresh,250);};
  try{if(typeof _geoRefreshNativeAuth==='function')_geoRefreshNativeAuth().then(done,done);else done();}catch(_e){done();}
}
function _geoPermLabSettings(){
  // A bridge call produces no DOM change, no navigation and no fetch, which is
  // why the dead-control detector flags these and why a person reads them as
  // broken. Say something before handing off.
  _geoPermLabSay('Opening iOS Settings...');
  try{
    const Td=(typeof _geoTdPlugin==='function')?_geoTdPlugin():null;
    if(Td&&typeof Td.openSettings==='function')Td.openSettings().catch(()=>_geoPermLabSay('Could not open Settings from here.'));
    else _geoPermLabSay('No native shell, so there is no Settings page to open.');
  }catch(_e){_geoPermLabSay('Could not open Settings from here.');}
}
function _geoPermLabReset(){
  // OURS ONLY. iOS authorization is untouched and untouchable from here; this
  // exists so the first-run code path can be re-run without a reinstall.
  try{
    localStorage.removeItem('geo_owner_consent');
    localStorage.removeItem('td_geo_os_denied');
    localStorage.removeItem(_GEO_GRANTED_KEY);
  }catch(_e){}
  if(typeof showToast==='function')showToast('Local consent cleared. iOS is unchanged.','🧪');
  _geoPermLabRefresh();
}
function _geoDiagCopy(){_geoCopyText(window.__geoDiagText||'');}
function _geoDiagPanel(){
  if(document.getElementById('_geo-diag-ov'))return;
  const dwellMin=_geoFenceEnteredAtMs?Math.round((Date.now()-_geoFenceEnteredAtMs)/60000):null;
  // Straight off iOS, never the app's own reading of its own behaviour
  // (owner 2026-08-25: "don't keep inferring, build explicitly off what iOS
  // reports"). Null when the shell has no plugin to ask, and the rows below
  // say so in those words rather than printing a plausible-looking guess.
  const _nat=((typeof _geoNativeAuthPeek==='function')?_geoNativeAuthPeek():null)||null;
  const state=[
    ['Shell',(_geoTdPlugin()?'yes':'no')],
    // The one thing the whole park/dedup/reconcile chain was missing: a
    // stuck queue looked identical to a working one from every OTHER field
    // here, "wrote" logs on enqueue, not on server confirmation (owner
    // report 2026-08-21: repeated "wrote 551m @job..." lines, zero matching
    // rows ever landed server-side, no way to tell from this panel until
    // now). _geoQueueLastError is set the moment a drain attempt fails and
    // stops (js/geo-track.js _geoDrainQueue); a stuck row blocks every row
    // enqueued after it, so this is also why unrelated windows never landed.
    ['Queue pending',String(_geoQueueRead().length)],
    ['Queue error',_geoQueueLastError||'none'],
    ['GPS watcher',_geoNativeWatcherId!=null?String(_geoNativeWatcherId):'off'],
    ['Park mode',_geoParkModeOn?'ON (GPS off)':'off'],
    ['Park countdown',_geoParkTimer?'running':'idle'],
    ['In fence',_geoLastFenceLoc?((_geoLastFenceLoc.name||_geoLastFenceLoc.kind||'yes')+(dwellMin!=null?' · '+dwellMin+' min':'')):'no'],
    ['Below drive speed',_geoQuietSinceMs?Math.round((Date.now()-_geoQuietSinceMs)/60000)+' min':'no (moving)'],
    ['Consent',localStorage.getItem('geo_owner_consent')||'unset'],
    ['OS denied',localStorage.getItem('td_geo_os_denied')==='1'?'yes':'no'],
    // The three axes, side by side, because any ONE of them being wrong stops
    // every ping and the other two keep looking healthy.
    ['iOS location',_nat&&_nat.status?_nat.status:'not reported'],
    ['Precise Location',_nat&&_nat.accuracy?_nat.accuracy:'not reported'],
    // The one this panel was missing entirely. A global switch nowhere near
    // this app leaves the grant above reading 'always' while nothing can
    // arrive, and that is indistinguishable from a healthy phone without
    // this row. 'unknown' is a real answer here, not a failure: an older
    // shell genuinely cannot tell us.
    ['Location Services (device)',
      !_nat?'unknown (no plugin)':
      (_nat.servicesEnabled===true?'ON':
      (_nat.servicesEnabled===false?'OFF, nothing can arrive':'unknown (old build)'))],
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
      (_geoParkLog.length?_geoParkLog.slice().reverse().map(r=>'<div>'+escHtml(_geoDiagFmtT(r.t))+' '+escHtml(r.ev)+(r.x?' · '+escHtml(r.x):'')+'</div>').join(''):'<div style="color:var(--text3)">Nothing yet.</div>')+
    '</div>'+
    // A quiet record of every Locate this phone answered. Nobody is notified
    // when one happens (owner call 2026-08-09), so this exists for support and
    // for the case where a check is ever disputed, not as a crew-facing feed.
    // The panel itself is developer-gated, so it is not something crew browse.
    '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin:12px 0 4px">Locate requests</div>'+
    '<div style="max-height:20vh;overflow-y:auto;font-size:11px;line-height:1.6">'+
      (_geoLocateHistory().length
        ?_geoLocateHistory().slice().reverse().map(r=>{
            let when='';try{when=bizTime(r.at);}catch(_e){when=String(r.at||'');}
            return '<div>'+escHtml(when)+' · '+escHtml(r.by||'A manager')+' · '+escHtml(r.answered?'shared':'not shared ('+(r.reason||'')+')')+'</div>';
          }).join('')
        :'<div style="color:var(--text3)">None.</div>')+
    '</div>'+
    // Copy, because a diagnostic you cannot get OFF the phone is only half a
    // diagnostic: the owner reads it in a truck and pastes it into a message.
    '<button class="btn" style="width:100%;margin-top:14px;padding:12px" onclick="_geoDiagCopy()">Copy everything</button>'+
    '<button class="btn btn-p" style="width:100%;margin-top:8px;padding:12px" onclick="document.getElementById(\'_geo-diag-ov\').remove()">Close</button>';
  window.__geoDiagText=state.map(([k,v])=>k+': '+v).join('\n')+'\n\n'+
    _geoParkLog.slice().reverse().map(r=>_geoDiagFmtT(r.t)+' '+(r.ev||'')+(r.x?' '+r.x:'')).join('\n');
  ov.appendChild(m);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
}
// A native event, live (listener) or replayed (drainBuffer). Every event
// carries __tdTs (its native CAPTURE moment) so the fence machine always
// clocks off that, live or replayed alike: without that, a buffered overnight
// drive collapses to zero minutes and drops under the 2-minute floor.
//
// OWNER VIDEO 2026-08-21: two same-job "Driving" legs, 7:52-8:00 and 7:52-8:02.
// Root cause: TdGeoPlugin.swift's record() buffers EVERY native event to disk
// UNCONDITIONALLY, live or not, and only an explicit drainBuffer() call (which
// only ever runs once per JS boot, from _geoTdInit) clears it. So any event
// that fires mid-session, gets delivered live, AND is still sitting in that
// buffer at the NEXT reload (the version watchdog, a WKWebView memory-pressure
// kill, a park-mode wake) gets replayed a second time with its true capture
// timestamp. That alone is harmless IF live and replay agree on the leg's
// start/end clock, because _geoLegKey is deterministic on legStart, so a
// second close with an IDENTICAL legStart is caught for free by the existing
// exact-legKey idempotency guard (mileage.js autoLogDriveTrip). The bug was
// that they did NOT agree: this function used to stamp __tdTs only when
// `replay` was true, so a LIVE event clocked itself off Date.now() at
// whatever moment the JS handler actually got around to it (which lags the
// real GPS fix by however long the main thread was busy, an in-flight
// geocode, a _geoPingBusy drop-and-retry on the next ping), while its
// buffered twin, replayed later, clocked off the true ev.ts. Two derivations
// of ONE physical exit/arrival, seconds apart, mint two different legKeys.
// Always honoring ev.ts removes the second clock entirely: live and replay
// can now only ever agree.
async function _geoTdEvent(ev,replay){
  if(!ev||typeof ev!=='object')return;
  // The shadow engine (js/geo-shadow.js) sees the SAME raw event, so any
  // difference in what the two engines conclude is genuinely the engine and
  // not the sensor. It can only ever write to its own local journal.
  if(!replay&&typeof shadowIngest==='function'){try{shadowIngest(ev);}catch(_e){}}
  const hasFix=typeof ev.lat==='number'&&typeof ev.lng==='number';
  // Liveness and motion events are NOT position truth and must never reach
  // the fence machine: a heartbeat fix is 3km-accuracy keepalive garbage
  // that could false-exit a fence, and a motion transition has no fix at
  // all. The heartbeat's whole job happens in the native flush lane
  // (device_status liveness); locally it is only journaled. A motion
  // transition INTO movement while parked buys one precise burst so the
  // departure pin lands at the kerb instead of half a mile out at the
  // significant-change wake (owner 2026-08-27: pin at the first footstep).
  if(ev.type==='heartbeat'){if(!replay)_geoParkNote('heartbeat',ev.acc!=null?Math.round(ev.acc)+'m':'no fix');return;}
  if(ev.type==='motion'){
    if(!replay&&_geoParkModeOn&&ev.kind&&ev.kind!=='still'){
      const now=Date.now();
      if(now-_geoMotionBurstAt>180000){
        _geoMotionBurstAt=now;
        _geoParkNote('motion-burst',String(ev.kind));
        try{const Td=_geoTdPlugin();if(Td&&typeof Td.burstFix==='function')Td.burstFix({seconds:12});}catch(_e){}
      }
    }
    return;
  }
  if(!replay&&_geoParkModeOn){
    const out=ev.type==='regionExit'||
      (hasFix&&_geoLastFenceLoc&&_geoDistFt({lat:ev.lat,lng:ev.lng},_geoLastFenceLoc)>_geoFenceFt());
    if(out)_geoExitParkMode();
  }
  if(!hasFix)return;
  // ── THE VISIT REPORT ALREADY KNOWS WHEN THEY GOT THERE ───────────────────
  // Owner report 2026-08-25, with two weeks of his own journal behind it: a
  // stop the app has a FENCE for is stamped within a minute, because crossing
  // the line fires immediately. A stop with no fence has nothing to trip, so
  // it waits for iOS to volunteer a visit report, and iOS deliberately sits
  // on those until it is confident. Measured across 27 of his unfenced stops:
  // median 4 minutes late, worst 45.
  //
  // The whole fix is that the late report is not vague about WHEN. It carries
  // arrivalDate (TdGeoPlugin.swift didVisit -> arrivalTs), and that is the
  // real moment. "visit · Stop · in 10:28" delivered at 11:13 knew, in the
  // same message, that the truck arrived at 10:28. This engine was reading
  // the envelope's postmark and throwing away the letter.
  //
  // Handled through _geoParkBackdate rather than by rewinding the ping's own
  // clock: that is the mechanism this file already uses for exactly this
  // shape ("the transition happened earlier than the ping that noticed it",
  // see the park resolver above), and it touches ONLY the arrival stamp.
  // Rewinding __tdTs instead would drag every drive clock, park timer and
  // fence stamp backwards with it for one ping, which is a far bigger blast
  // radius for no extra accuracy.
  let _backdated=null;
  if(ev.type==='visit'&&!_geoParkBackdate){
    const a=Number(ev.arrivalTs);
    const nowMs=(typeof ev.ts==='number'?ev.ts:Date.now());
    // Never invent time, and never re-open a visit that is already history:
    // it must be in the PAST, inside the delivery-lag window this exists to
    // close, and on the same Central day (the reconciler's own honesty rule,
    // so a report delivered after midnight can't backdate into yesterday).
    if(isFinite(a)&&a>0&&a<nowMs&&(nowMs-a)<=_GEO_VISIT_BACKDATE_MAX_MS&&
       _ctDateStr(new Date(a))===_ctDateStr(new Date(nowMs))){
      _backdated=new Date(a).toISOString();
      _geoParkBackdate=_backdated;
      _geoParkNote('visit-backdate',(typeof _ctHM==='function'?_ctHM(new Date(a)):_backdated.slice(11,16))+' ('+Math.round((nowMs-a)/60000)+'m late)');
    }
  }
  try{
    return await _geoOnPing({
      coords:{latitude:ev.lat,longitude:ev.lng,accuracy:ev.acc||0,
              speed:(typeof ev.speed==='number'&&ev.speed>=0)?ev.speed:null},
      __tdTs:typeof ev.ts==='number'?ev.ts:undefined
    });
  }finally{
    // One-shot means one-shot. The transition consumes it (see arriveIso
    // above); if this ping produced no transition, or was dropped by the
    // re-entrancy guard, it must NOT sit here waiting to stamp an unrelated
    // arrival minutes later with a time that had nothing to do with it.
    if(_backdated&&_geoParkBackdate===_backdated)_geoParkBackdate=null;
  }
}
// ── Native flush credentials (real-time ingest, owner 2026-08-27) ───────────
// Build 39's plugin background-POSTs its event buffer to the ingest-geo edge
// function within seconds of every wake, force-quit included, which is what
// makes mileage and time logs land in Supabase in real time. The native layer
// cannot hold a Supabase session (a Swift token refresh would rotate the
// refresh token out from under this client and sign the user out), so it
// authenticates with a per-device random key: minted here, registered in
// geo_flush_keys (owner-only RLS), then handed to the plugin. Configure only
// after the server registration succeeds: a key the server never saw would
// just 401 forever from inside the background session.
async function _geoConfigureFlush(){
  try{
    if(window._geoFlushCfgDone)return;
    const Td=_geoTdPlugin();
    if(!Td||typeof Td.configureFlush!=='function')return; // shell predates build 39
    if(!_supa||!_supaUser||typeof supaEnabled!=='function'||!supaEnabled())return;
    const devId=(typeof _initDeviceId==='function')?_initDeviceId():null;
    if(!devId)return;
    let key=null;
    try{key=localStorage.getItem('zp3_geo_flush_key');}catch(_e){}
    if(!key){
      const b=new Uint8Array(24);crypto.getRandomValues(b);
      key='gfk_'+Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');
      try{localStorage.setItem('zp3_geo_flush_key',key);}catch(_e){}
    }
    const{error}=await _supa.from('geo_flush_keys')
      .upsert({user_id:_supaUser.id,device_id:devId,key},{onConflict:'user_id,device_id'});
    if(error)return; // table not deployed yet, or offline: retry next session
    await Td.configureFlush({
      url:_SUPA_DIRECT_URL+'/functions/v1/ingest-geo',
      userId:_supaUser.id,deviceId:devId,key
    });
    window._geoFlushCfgDone=true;
  }catch(_e){}
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
        // THE FORCE-CLOSE NET (owner 2026-08-27: "log mileage and time even
        // if the app is dead"). The live watcher above dies with the process
        // and iOS relaunches nobody for continuous GPS. Visits, regions and
        // significant-change DO relaunch a force-quit app, so that baseline
        // is armed alongside the watcher from the first minute of tracking,
        // not only at park time. It costs no radio of its own while the
        // watcher runs, and it is the only thing still standing if the app
        // is killed mid-drive: the native buffer catches the wakes and the
        // replay rebuilds the day on next open.
        try{
          const _TdN=_geoTdPlugin();
          if(_TdN&&typeof _TdN.startEvents==='function')
            Promise.resolve(_TdN.startEvents({regions:_geoParkRegions(null)})).catch(()=>{});
        }catch(_e){}
        // The heartbeat is armed alongside it, same rule: from the first
        // minute of tracking, not only at park time. If this boot is actually
        // at home, the park arm minutes later corrects it to off.
        _geoHeartbeatSync(null);
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
        try{if(typeof _geoRefreshBattery==='function')_geoRefreshBattery();}catch(_e){}
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
  // Park-detection state dies with tracking too: a lock or a half-grown
  // cluster from this session must never resolve an arrival for the next one
  // (same reason the job-coordinate cache below is cleared).
  _geoParkCluster=null;_geoSoftJob=null;_geoSoftJobSpeedRun=0;_geoSoftShop=null;_geoSoftShopSpeedRun=0;_geoParkBackdate=null;
  if(_geoReconTimer){clearTimeout(_geoReconTimer);_geoReconTimer=null;}
  _geoDriveReset();_geoDriveShown=false;
  _geoCurrentClient=null;_geoClientArrivedAt=null;_geoClientCacheMemo=null;
  _geoCurrentPlace=null;_geoPlaceArrivedAt=null;_geoStopAnchor=null;_geoLastFenceAt=null;_geoLegAtShop=false;_geoHomeDwell=null;_geoWasAtHome=false;
  _geoLastFenceLoc=null;_geoLegOrigin=null;
  // A real stop-then-restart (sign-out/in, account switch) must get a REAL
  // restore/drain on the next _geoTrackInit(), unlike the twin-write case this
  // guard exists to block: that is two firings racing on the SAME boot, not a
  // deliberate new session. _geoRestoreOpen's OWN one-shot guard is a
  // SEPARATE latch (window._geoOpenRestored, set the first time it actually
  // runs) and has to be reset here too: without this line, resetting only
  // _geoResumedOnce re-opens the OUTER gate in _geoTrackInit but the INNER
  // one inside _geoRestoreOpen stays permanently shut from the first
  // account's session, so a second account signing in on the same page never
  // gets ITS persisted open entry restored, bug #39's scenario again, just
  // one layer deeper.
  _geoResumedOnce=false;
  try{window._geoOpenRestored=false;}catch(_e){}
  // The job-coordinate cache goes too. It is the ONE piece of geofence state
  // this function used to leave behind, and sign-out is exactly when a second
  // account can sign in on the same device (bug #39's scenario). A job id from
  // the previous account matching one in the new account would fence the new
  // crew at the old account's site.
  _geoJobCoords={};
  _geoClearOpen();_geoWakeRelease();
}

// ── Time-log reconciliation off mileage leg timestamps ───────────────────────
// Owner design (2026-08-20). When live fence detection missed an arrival or a
// departure, the time log ends up with a missing or absurdly short on-site
// entry (owner screenshot: a 9-minute row for a multi-hour visit) even though
// the MILEAGE legs on either side pin the truth: leg N ended AT the job at
// endedIso, leg N+1 started FROM the same spot at startedIso, so the span
// between them IS on-site time. This sweeps recent auto legs, finds those
// job-anchored gaps, and repairs the log by inserting a 'geofence-reconciled'
// row for the window (2026-08-21: no more skip/extend decision at write
// time, see the comment further down; _geoDedupTimeEntries cleans up any
// overlap with what live detection already wrote). Never destructive, never
// claims unobserved overnight hours, and a human's manual clock record
// always wins.
const _GEO_RECON_MIN_GAP_MS=5*60000;   // under this the fence machine already told the story
const _GEO_RECON_EVERY_MS=10*60000;    // slow-burn cadence off the ping stream
let _geoReconBusy=false;
let _geoReconTimer=null;
let _geoReconLastMs=0;
function _geoReconcileSoon(){
  // Only from a LIVE tracking session (the same watcher check _geoDriving
  // makes). Fixture worlds drive _geoOnPing/_geoDriveEntry directly with no
  // watcher and rewound clocks, and a background timer writing repair rows
  // mid-test is pure nondeterminism; a real session without a watcher has no
  // fresh legs to repair anyway. Tests call _geoReconcileFromMileage()
  // directly. Debounced so a burst of leg closes runs one pass.
  if(_geoWatchId==null&&_geoNativeWatcherId==null)return;
  if(_geoReconTimer)return;
  _geoReconTimer=setTimeout(()=>{_geoReconTimer=null;_geoReconcileFromMileage();},8000);
}
// Returns true when a pass actually ran, false when it was skipped (another
// pass or a GPS ping in flight). renderTimeLog (js/timelog.js) retries a
// couple of times on false: on a phone with live tracking, opening Time Log
// right after a drive lands exactly when pings are flowing, and a silently
// dropped one-shot call meant the repair never happened for that visit.
// ── The reconciler checks its guess against the breadcrumbs we already keep ──
//
// Owner, 2026-08-25: "I thought you already have shit built to reconcile
// versus actual gps points and geofences arrival and departure, why can't we
// use what we have already versus more ai slop code."
//
// Correct, and the gap was real: location_pings has held a throttled lat/lon
// breadcrumb for every fix for 90 days (_geoWritePing, _geoPrunePings), and
// the reconciler never once read it. It matched a job by how close ONE mileage
// leg's endpoint landed, then claimed the ENTIRE gap to the next leg as time
// on site, with nothing checking whether the person was still there.
//
// What that produced, on the owner's own account, 2026-08-24: 541 minutes
// billed to one job across three rows, while 217 recorded pings that same day
// walk from Topeka, to Kansas City, to Colorado, to Salt Lake City. The
// evidence sat in our own table the whole time.
//
// The fix needs no new threshold and no new concept. It is the SAME geofence
// test the live machine already runs (_geoFenceFt, plus the park-wander
// margin), applied to the recorded fixes instead of only to live ones: a
// window is on-site time for exactly as long as the breadcrumbs say the
// person was on site.
//
// It also makes the hardcoded forensic block in _geoRepairStretchedStops
// deletable. That block hand-patches specific client_keys with literal
// timestamps that were read out of location_pings BY HAND, which is the same
// bug one layer up: the pings had the answer and the code was told it instead
// of taught to look.
//
// Fails OPEN on purpose. A fetch that errors, or a window with no pings in it
// at all, leaves the claim exactly as it is today: no breadcrumbs is precisely
// the case this whole feature was built for (live fence detection missed the
// arrival because the phone was not reporting), so absence of evidence must
// never delete a real visit.
async function _geoReconPings(fromMs,toMs){
  try{
    if(!_supa||!_supaUser)return null;
    if(!(fromMs>0&&toMs>fromMs))return null;
    const{data,error}=await _supa.from('location_pings')
      .select('lat,lon,accuracy,ts')
      .eq('contractor_user_id',_geoCid())
      .eq('employee_user_id',_supaUser.id)
      .gte('ts',new Date(fromMs).toISOString())
      .lte('ts',new Date(toMs).toISOString());
    if(error||!Array.isArray(data))return null;
    return data.map(r=>({ms:Date.parse(r&&r.ts)||0,lat:r&&r.lat,lng:r&&r.lon,acc:Number(r&&r.accuracy)||0}))
               .filter(r=>r.ms>0&&r.lat!=null&&r.lng!=null)
               .sort((a,b)=>a.ms-b.ms);
  }catch(_e){return null;}
}
// Trim a claimed window to the stretch its own breadcrumbs actually contradict.
//
// REWRITTEN 2026-08-25 after the first version destroyed real days. Owner:
// "it cleaned it up but cleaned up too much, now we got days where we are
// missing time." Correct, and the evidence is 08-19 on the live account: a
// 561-minute visit whose whole window holds FIVE fixes. Two at 06:57 and 06:59
// on site, then nothing for nine hours, then three at 16:17 as the truck drove
// off, 10,499ft away. The first rule walked forward, hit the 16:17 fix, and cut
// the day to two minutes.
//
// The mistake was treating this tape like a continuous one. It is not, and by
// design: park mode powers the GPS down when the truck stops, so a person
// standing still at a job produces NO fixes at all. Silence is the signature of
// being parked somewhere, not of being absent. Compare 08-24, the day this
// check was built for: fixes every few minutes, continuously, walking across
// four states. Those two shapes have to be read differently.
//
// So the rule is now subtractive and edge-bounded:
//
//   * Fixes within _GEO_PING_EDGE_MS of either anchor are IGNORED. t1 is the
//     moment a mileage leg parked here and t2 is the moment the next one
//     pulled away, so a fix sitting on either edge is that drive itself. The
//     16:17 fixes on 08-19 are the departure, not a contradiction. This alone
//     is what makes a sparse tape safe.
//   * Every remaining fix off site means they were never here: the claim goes.
//     That is 08-24, and only 08-24.
//   * An off-site run touching the FIRST or LAST remaining fix moves that
//     anchor in to the nearest on-site fix. Evidence at an end can shorten
//     from that end.
//   * An off-site run strictly in the MIDDLE is a lunch or supply run they
//     came back from. One row cannot carry a hole, and the live 'stop' row
//     already covers that gap, so the claim stands untouched.
//   * Silence still proves nothing, anywhere.
const _GEO_PING_ACC_CAP_FT=1500;
const _GEO_PING_EDGE_MS=10*60000;
function _geoPingTrim(pings,t1,t2,coord,margin){
  const out={t1:t1,t2:t2,checked:false,seen:0,left:false,gone:false};
  try{
    if(!Array.isArray(pings)||!coord||coord.lat==null)return out;
    const mid=pings.filter(p=>p.ms>t1+_GEO_PING_EDGE_MS&&p.ms<t2-_GEO_PING_EDGE_MS);
    if(!mid.length)return out;                       // only the drives at the edges: says nothing
    out.checked=true;out.seen=mid.length;
    const inside=p=>{
      const slack=Math.min(Math.max(p.acc*3.28084,0),_GEO_PING_ACC_CAP_FT);
      return _geoDistFt({lat:p.lat,lng:p.lng},coord)<=margin+slack;
    };
    const flags=mid.map(inside);
    if(flags.every(f=>!f)){out.gone=true;out.left=true;out.t2=t1;return out;}
    if(flags.every(f=>f))return out;
    let i=0;while(i<flags.length&&!flags[i])i++;
    let j=flags.length-1;while(j>=0&&!flags[j])j--;
    if(i>0){out.t1=mid[i].ms;out.left=true;}
    if(j<flags.length-1){out.t2=mid[j].ms;out.left=true;}
    return out;
  }catch(_e){return out;}
}
async function _geoReconcileFromMileage(){
  if(_geoReconBusy)return false;
  // Never interleave with a ping in flight: this function awaits (geocodes,
  // the coverage fetch) and the fence machine awaits, so running both
  // concurrently would let their continuations land between each other's
  // steps in an order that depends on real network pacing, not on the data.
  // The machine's own re-entrancy rule (_geoPingBusy) exists for exactly
  // this reason; reconciliation defers to it and the next trigger retries.
  if(_geoPingBusy)return false;
  if(!_supa||!_supaUser)return true;
  if(typeof mileage==='undefined'||!Array.isArray(mileage))return true;
  _geoReconBusy=true;
  try{
    // Auto legs by THIS person. logged_by_id is only stamped on employee rows
    // (autoLogDriveTrip), so the owner matches null, same convention as the
    // gap-echo guard in _geoDriveEntry. Last 7 days only: repairing the
    // recent log is the use case, and the deterministic client_key below
    // keeps re-runs idempotent regardless of how far back this ever looks.
    const _me=_isEmployee?_supaUser.id:null;
    const _cutoff=Date.now()-7*86400000;
    const legs=mileage.filter(m=>m&&m.gps&&m.legKey&&m.startedIso&&m.endedIso&&
      (m.logged_by_id||null)===_me&&
      (Date.parse(m.startedIso)||0)>=_cutoff)
      .slice().sort((a,b)=>String(a.startedIso).localeCompare(String(b.startedIso)));
    // Real GPS is never this clean: a park-detection race or a plain jittery
    // fix can log two overlapping legs for ONE physical trip, or several
    // short hops minutes apart while the truck sits still. Pairing strictly
    // ADJACENT legs (owner report 2026-08-21: a morning with a duplicate
    // 7:52am blip pair) makes the genuine multi-hour gap on the far side of
    // that cluster invisible, because the only adjacent pair spanning it
    // gets the WRONG member of the cluster as its endpoint half the time.
    // Fix: fold legs less than the min gap apart into one cluster before
    // pairing. A cluster's end anchor is the LATEST endedIso among its
    // members (the last confirmed movement); which member leg's toCoord
    // actually lands at a job is resolved per-window below by scanning every
    // leg in the cluster, not just whichever one sorted last.
    const clusters=[];
    for(const leg of legs){
      const cur=clusters[clusters.length-1];
      const stMs=Date.parse(leg.startedIso)||0;
      if(cur&&stMs-cur.endMs<_GEO_RECON_MIN_GAP_MS){
        cur.legs.push(leg);
        const enMs=Date.parse(leg.endedIso)||0;
        if(enMs>cur.endMs){cur.endMs=enMs;cur.endedIso=leg.endedIso;}
      }else{
        clusters.push({legs:[leg],startedIso:leg.startedIso,endMs:Date.parse(leg.endedIso)||0,endedIso:leg.endedIso});
      }
    }
    const margin=_geoFenceFt()+_GEO_PARK_JOB_EXTRA_FT;
    // BREADCRUMBS into the tracking diagnostic (_geoParkNote, the same trail
    // the Copy-everything button exports): the owner cannot see WHY a window
    // did or did not repair, and CI cannot sign into the owner's account to
    // look (the live probe 2026-08-21 read an empty secondary account), so
    // the device itself records each pass verbatim. 30-entry cap in
    // _geoParkNote bounds this; a day rarely has more than a handful of
    // windows.
    _geoParkNote('recon-scan',legs.length+' legs of '+mileage.length+' rows, '+clusters.length+' clusters');
    // Computed once: no date filter to vary per window anymore (see
    // _geoReconcilableJobs), so the same list serves every window below.
    const _myJobs=_geoReconcilableJobs();
    // ONE fetch for the whole pass, covering every window it will consider.
    // Per-window queries would be one round trip per gap on a slow truck
    // connection, and the answer is the same tape either way (same call the
    // shop-walking trim already makes once per render, not once per span).
    const _pingTape=await _geoReconPings(
      clusters.length?clusters[0].endMs:0,
      clusters.length?Date.parse(clusters[clusters.length-1].endedIso)||0:0);
    _geoParkNote('recon-scan',_pingTape?(_pingTape.length+' pings on tape'):'no ping tape (claims unverified)');
    const wins=[];
    for(let i=0;i<clusters.length-1;i++){
      const A=clusters[i],B=clusters[i+1];
      const t1=A.endMs,t2=Date.parse(B.startedIso)||0;
      // Central time (owner ask 2026-08-23), same shape as before: a full
      // start stamp, then just the end clock across the arrow. No trailing
      // 'Z': that marked UTC, and this is local now.
      const _wTag=(typeof _ctStamp==='function'?_ctStamp(new Date(t1)).slice(0,-3):new Date(t1).toISOString().slice(5,16))+'→'+
        (typeof _ctHM==='function'?_ctHM(new Date(t2)):new Date(t2).toISOString().slice(11,16))+' '+Math.round((t2-t1)/60000)+'m';
      if(!(t1>0&&t2>t1))continue;
      if(t2-t1<_GEO_RECON_MIN_GAP_MS)continue;
      // Unobserved hours are never claimed, but a real on-site stretch
      // (arrival AND departure both anchored to an actual mileage leg, not
      // merely inferred) is nothing like an inferred drive across a sleep
      // gap. This used to reuse _GEO_MAX_INFERRED_LEG_MS (4hr, sized for
      // "how long can a DRIVE plausibly have gone unseen"), and it was
      // refusing completely ordinary work mornings (owner report
      // 2026-08-21, mileage log in hand: 8:00am arrival, 12:29pm departure,
      // 4h29m on site, missed by 29 minutes because a shift is not a drive).
      // The real risk this guard exists for is an OVERNIGHT or multi-day
      // gap, not a long shift, so it is bounded by CALENDAR DAY (Central
      // time, the app's own convention, _ctDateStr) instead of a flat
      // duration: the same day is trusted whatever it adds up to, a gap
      // that crosses into a new day never is.
      if(_ctDateStr(new Date(t1))!==_ctDateStr(new Date(t2))){_geoParkNote('recon-win',_wTag+': crosses midnight');continue;}
      // Which job were they at: nearest one within the fence plus the park
      // wander margin of where ANY leg in cluster A actually ended. Scanning
      // every member (not just A's last leg) is what lets a good fix inside
      // a messy cluster still prove the arrival, even when a sibling blip in
      // the same cluster has a missing or garbage toCoord.
      let jb=null,jbFt=Infinity,jbLeg=null,_minFt=Infinity,jbCoord=null;
      // Which job were they at: proximity only, no date filter (see
      // _geoReconcilableJobs, owner's own diagnostic paste 2026-08-21: a job
      // that overran its scheduled span still needs its overrun day
      // reconciled, the calendar's plan is not what decides where the truck
      // physically was).
      for(const memberLeg of A.legs){
        if(!memberLeg.toCoord||memberLeg.toCoord.lat==null)continue;
        for(const j of _myJobs){
          const c=await _geoJobLatLng(j);
          if(!c)continue;
          const ft=_geoDistFt({lat:memberLeg.toCoord.lat,lng:memberLeg.toCoord.lng},c);
          if(ft<_minFt)_minFt=ft;
          if(ft<=margin&&ft<jbFt){jb=j;jbFt=ft;jbLeg=memberLeg;jbCoord=c;}
        }
      }
      // CLIENT FALLBACK (owner report 2026-08-21: a client visit reset to
      // "now" by a mid-visit reload, because _geoPersistOpen/_geoRestoreOpen
      // only ever covered job/shop/drive state, never a client fence — the
      // in-memory arrival clock had no crash/reload durability at all. The
      // mileage legs bounding the SAME visit are not in-memory: they went
      // through the durable queue the moment the drive closed, well before
      // any reload could touch them. So a job match is tried first (job is
      // the strongest fence everywhere else in this file too), and only when
      // NOTHING scheduled explains the window does a client get a turn,
      // matched the exact same cache-only way a live ping resolves one
      // (_geoClientAt): reconciliation must never burn a live geocode either.
      let cb=null,cbFt=Infinity,cbLeg=null,cbCoord=null;
      if(!jb&&typeof clients!=='undefined'&&clients.length){
        const _cache=(typeof _nearbyGeoCache==='function')?_nearbyGeoCache():{};
        for(const memberLeg of A.legs){
          if(!memberLeg.toCoord||memberLeg.toCoord.lat==null)continue;
          for(const cl of clients){
            if(!cl||!cl.addr)continue;
            const hit=_cache[cl.id];
            if(!hit||hit.addr!==cl.addr)continue;
            const ft=_geoDistFt({lat:memberLeg.toCoord.lat,lng:memberLeg.toCoord.lng},{lat:hit.lat,lng:hit.lon});
            if(ft<_minFt)_minFt=ft;
            if(ft<=margin&&ft<cbFt){cb=cl;cbFt=ft;cbLeg=memberLeg;cbCoord={lat:hit.lat,lng:hit.lon};}
          }
        }
      }
      if(!jb&&!cb){
        _geoParkNote('recon-win',_wTag+': no job match, '+_myJobs.length+' jobs, nearest '+(_minFt===Infinity?'n/a':Math.round(_minFt)+'ft'));
        continue;
      }
      // B's own LOGGED origin is never required to match the job (owner,
      // 2026-08-21): if GPS was spotty leaving the site, the departure leg
      // is exactly as likely to carry a missing or wrong fromCoord as the
      // arrival was to be missed in the first place, that is the SAME bug
      // this whole feature exists to route around, not a reason to refuse
      // the pairing. What actually proves the visit had ended by t2 is not
      // where B says it started, it is that B EXISTS at all: any later drive
      // by this same person is proof they were no longer on site by the
      // moment it began, whatever its own origin thinks happened.
      // A human's clock record always wins: any manual timeEntries row by the
      // same person overlapping the window means somebody already answered
      // this question on purpose, skip the whole window. logged_by_uid null
      // means the owner (js/jobs.js clockIn), same null convention as above.
      if(typeof timeEntries!=='undefined'&&Array.isArray(timeEntries)&&
         timeEntries.some(e=>e&&(e.logged_by_uid||null)===_me&&e.start_time&&
           Date.parse(e.start_time)<t2&&(!e.end_time||Date.parse(e.end_time)>t1))){
        _geoParkNote('recon-win',_wTag+': manual entry wins');continue;
      }
      // THE BREADCRUMB CHECK. Everything above decides WHERE they were when
      // the drive ended; this decides how long they actually stayed, using
      // the fixes already recorded for that stretch rather than assuming the
      // whole gap. See _geoPingTrim. No tape, or no fixes inside this
      // window, leaves the claim untouched: that is the missed-arrival case
      // this feature exists for.
      const _tr=_geoPingTrim(_pingTape,t1,t2,jb?jbCoord:cbCoord,margin);
      if(_tr.checked&&_tr.left){
        const kept=Math.max(0,Math.round((_tr.t2-_tr.t1)/60000));
        _geoParkNote('recon-win',_wTag+': '+_tr.seen+' mid-window fixes disagree, '+kept+'m survives');
      }
      if(_tr.t2-_tr.t1<_GEO_RECON_MIN_GAP_MS){
        _geoParkNote('recon-win',_wTag+': nothing left after the pings were checked');
        continue;
      }
      if(jb){
        _geoParkNote('recon-win',_wTag+': candidate @'+(jb.name||jb.id));
        wins.push({A,B,t1:_tr.t1,t2:_tr.t2,jobId:String(jb.id),legKey:jbLeg.legKey});
      }else{
        _geoParkNote('recon-win',_wTag+': candidate @'+(cb.name||cb.id)+' (client)');
        wins.push({A,B,t1:_tr.t1,t2:_tr.t2,clientId:String(cb.id),clientName:cb.name||null,legKey:cbLeg.legKey});
      }
    }
    // No early return on an empty `wins` (owner report 2026-08-25: "still not
    // seeing time log clear the shit that doesn't matter"). This used to be
    // `if(!wins.length)return;`, which returns from INSIDE the try, so the
    // finally cleared the busy flag and the function exited before the
    // cleanup chain below it ever ran. On a day with nothing to reconcile,
    // which is exactly a flight day (the impossible-leg guard refuses the
    // mileage row, so there is no leg to pair a window from), that skipped
    // the very sweep the guard depends on: _geoSyncDriveTimeEntries is what
    // removes the orphaned paid drive-time row the guard deliberately leaves
    // behind. Result on the owner's account: a 132-minute 'drive-unassigned'
    // row for a flight, and a duplicate 16-minute stop pair written 6ms
    // apart, both sitting uncleaned. The loop below is a no-op on an empty
    // array anyway, so the guard bought nothing and cost the cleanup.
    // No coverage query here anymore (owner 2026-08-21: "why is this so
    // complicated, follow the way mileage does it"). This used to fetch the
    // server's existing rows and decide skip/extend/insert before writing,
    // and that decision was exactly where a real duplicate slipped through:
    // two rows landed side by side on the same Aug 18/19 visit even though
    // one should have covered the other, and adding more diagnostics to that
    // check (the previous commit) never actually explained why. So it is
    // gone, not patched again.
    //
    // Every window just writes now, plain, the same way every OTHER source in
    // this file does (_geoCloseEntry, _geoDriveEntry, …): 'rec-'+legKey is
    // deterministic, so a re-run of the SAME window can never double-claim
    // itself (the server's unique contractor_user_id+client_key index catches
    // that for free, same as always). Any overlap with a DIFFERENT row (a
    // live 'geofence' entry that already covered this visit, a second pass's
    // own insert) is cleaned up by _geoDedupTimeEntries right after this
    // returns: the same "keep the longest, drop the rest" sweep
    // _mileDedupTrips already runs for mileage duplicates, applied to
    // job_time_entries. Simpler, and the actual bug can't hide inside a
    // clever decision that never gets exercised by a real test.
    for(const w of wins){
      const span=w.t2-w.t1;
      const mins=Math.max(0,Math.round(span/60000));
      // Same shape _geoCloseClientEntry already writes for a LIVE client
      // close (job_id null, dest_place carries the name, source 'place'):
      // a reconciled client window has to read identically to a live one
      // everywhere downstream (finance.js, the dedup sweep below) or it
      // becomes its own second, unmatched category of row.
      // OVERWRITE, not insert-ignore. This window is recomputed from the
      // mileage legs and re-tested against the pings on every pass, so the
      // value written here is the current best answer and it must replace
      // whatever is there. That is what makes a wrong trim self-healing: the
      // 08-19 rule bug shortened a real 561-minute day and nothing could undo
      // it, because the re-insert was silently dropped as a duplicate. It also
      // means the verify sweep and this cannot oscillate: both run the same
      // _geoPingTrim over the same fixes, so both land on the same window.
      _geoEnqueue('job_time_entries',w.jobId?{
        contractor_user_id:_geoCid(),employee_user_id:_supaUser.id,
        // From the WINDOW, not from the raw leg stamps. Those were the same
        // value until the breadcrumb trim above could move t2, and reading
        // B.startedIso here would have silently written the untrimmed span
        // while `minutes` reported the trimmed one.
        job_id:w.jobId,arrived_at:new Date(w.t1).toISOString(),departed_at:new Date(w.t2).toISOString(),
        minutes:mins,dest_place:null,
        client_key:'rec-'+w.legKey,source:'geofence-reconciled'
      }:{
        contractor_user_id:_geoCid(),employee_user_id:_supaUser.id,
        job_id:null,arrived_at:new Date(w.t1).toISOString(),departed_at:new Date(w.t2).toISOString(),
        minutes:mins,dest_place:w.clientName,
        client_key:'rec-'+w.legKey,source:'place-reconciled'
      },{overwrite:true});
      _geoParkNote('recon-win','wrote '+mins+'m @'+(w.jobId?'job '+w.jobId:'client '+w.clientId));
    }
  }catch(_e){_geoParkNote('recon-err',(_e&&_e.message)||String(_e));}
  finally{_geoReconBusy=false;}
  await _geoCleanupSweeps();
  return true;
}
// ── The cleanup sweeps, no longer hostage to the reconciler ──────────────
// (owner report 2026-08-25: "still not seeing time log clear the shit that
// doesn't matter out of the time logs like we used to have before your
// changes to the flight code".)
//
// Dedup, same-place merge, drive-time hygiene and shop dedup used to live
// inline at the tail of _geoReconcileFromMileage, which meant they only ever
// ran when that function ran to completion. It has three exits that skip
// them: _geoReconBusy, _geoPingBusy (both `return false`, and a phone with
// live tracking hits the ping one constantly, renderTimeLog gives up after
// three 150ms retries), and the empty-`wins` return removed above. None of
// those exits has anything to do with whether there is junk to clear:
// cleaning up a duplicate row or an orphaned drive leg does not require the
// reconciler to have found a single window. Pulled out here so renderTimeLog
// can call it directly, every open, whatever the reconciler did or didn't do.
//
// Own busy flag, plus a short recency skip so the reconciler's own call and
// renderTimeLog's call right after it don't run the same four queries twice
// in a row. Pass force=true to bypass the recency skip.
let _geoCleanupBusy=false;
let _geoCleanupAt=0;
const _GEO_CLEANUP_MIN_GAP_MS=10000;
async function _geoCleanupSweeps(force){
  if(_geoCleanupBusy)return false;
  if(!force&&_geoCleanupAt&&Date.now()-_geoCleanupAt<_GEO_CLEANUP_MIN_GAP_MS)return false;
  _geoCleanupBusy=true;
  try{
    // Wait for THIS pass's own writes to actually reach the server before
    // dedup reads it back (bounded, best-effort): _geoEnqueue's drain is
    // fire-and-forget by design (a write must never block on network), so
    // calling dedup immediately after enqueueing races those exact writes and
    // reads a database snapshot that doesn't include them yet. That race is
    // why the SAME window got written twice, 90 seconds apart, with no dedup
    // event between (owner's own diagnostic paste 2026-08-21): the first
    // pass's dedup ran before its own insert had landed, found nothing to
    // drop, and the second pass repeated the whole cycle blind to the first.
    if(typeof _geoAwaitQueueDrained==='function')await _geoAwaitQueueDrained();
    if(typeof _geoDedupTimeEntries==='function'){try{await _geoDedupTimeEntries();}catch(_e){}}
    // RE-ENABLED 2026-08-24 after the root cause landed: the 2026-08-23
    // incident was a reconciled full-day row bridging the owner's real lunch
    // (it resolved to the same client name and overlapped both live visits).
    // The rewritten merge excludes reconciled rows from candidacy entirely
    // and only merges across a gap that is provably EMPTY (no mileage leg, no
    // other row, no shop session, same Central day), per the owner's rule:
    // "merge those two records, there were no real drive events between them,
    // just loss of gps geofence."
    if(typeof _geoMergeAdjacentVisits==='function'){try{await _geoMergeAdjacentVisits();}catch(_e){}}
    // DISABLED (owner report 2026-08-23, live device): the repeated heartbeat-
    // triggered chain compounded this into multi-hour, even overnight-spanning
    // "stop" rows (one grew to 1034 real minutes), corrupting live payroll
    // data. Root cause not yet fully isolated; the function stays defined so
    // the fix can be built and tested against it, but it must not run again
    // until a bounded, verified replacement lands. See _geoAbsorbGapsIntoStops
    // below.
    // if(typeof _geoAbsorbGapsIntoStops==='function'){try{await _geoAbsorbGapsIntoStops();}catch(_e){}}
    // Same settle point covers drive-time hygiene: this function's own writes
    // (and whatever _mileDedupTrips/_milePersonalStopSweep already did earlier
    // this session) are now on the server, so any drive row whose leg no
    // longer survives in mileage is safe to drop here too. renderTimeLog
    // awaits this whole chain before it ever reads a row, so a contractor
    // opening Time Log always sees the reconciled state, not the stale one.
    if(typeof _geoSyncDriveTimeEntries==='function'){try{await _geoSyncDriveTimeEntries();}catch(_e){}}
    // Same settle point covers shop_time_entries duplicates, which
    // _geoDedupTimeEntries and _geoSyncDriveTimeEntries never touch at all
    // (see _geoDedupShopTimeEntries above).
    if(typeof _geoDedupShopTimeEntries==='function'){try{await _geoDedupShopTimeEntries();}catch(_e){}}
    // And the same breadcrumb test the reconciler now applies at write time,
    // applied to rows already on the books (see _geoVerifyReconciled).
    if(typeof _geoVerifyReconciled==='function'){try{await _geoVerifyReconciled();}catch(_e){}}
    return true;
  }finally{_geoCleanupBusy=false;_geoCleanupAt=Date.now();}
}
// Bounded wait for the durable queue to finish draining, so a caller that
// needs to read back what it just enqueued (the dedup sweep) sees a database
// state that actually includes it. Not a correctness guarantee (still real
// network time, still capped), just closes the race that mattered.
async function _geoAwaitQueueDrained(maxMs){
  const deadline=Date.now()+(maxMs||8000);
  while(Date.now()<deadline){
    if(!_geoDrainBusy&&_geoQueueRead().length===0)return true;
    await new Promise(r=>setTimeout(r,150));
  }
  return false;
}

// ── Time entry dedup (owner rule 2026-08-21: "why can't this be as simple as
// mileage") ──────────────────────────────────────────────────────────────
// Mirrors _mileDedupTrips (js/mileage.js): same person, same destination,
// overlapping windows is one visit, keep the longest, drop the rest. Unlike
// mileage there is no synced local array for job_time_entries (js/finance.js
// _fetchCrewLabor queries the server fresh every time Time Log opens), so
// this fetches, decides, and deletes against the SERVER directly, in one
// pass. Called right after every reconciliation pass, and (mirroring
// _mileDedupTrips's own wiring) on boot and cloud reconnect from cloud.js.
//
// A human's clock record always wins (same rule the reconciler's own window
// builder already honors before it ever proposes a window): a 'manual'
// bookend (the Arrived/Done buttons, js/geo-track.js) is never the row that
// gets dropped, an automatic row overlapping one always is. Drive-sourced
// rows are wheel time, never compared here at all, they already carry their
// own deterministic legKey and their own idempotency.
//
// RLS note: an employee's own device can only SELECT its own rows here
// (policy "Employee reads own job time") and has no delete, update, or
// general insert grant at all, so a dup found on an employee's phone will
// fail its delete/trim/split silently (caught below) and simply wait for
// the owner's own device, which has full contractor-scoped rights
// ("Contractor manages job time"), to run this same sweep and clean up the
// whole team's duplicates.
//
// 90-day cutoff (widened from 7, owner audit 2026-08-23): 7 days was sized
// for ONGOING hygiene against races that fire close to real time, not for
// clearing a pre-existing backlog of reconciler duplicates going back weeks.
let _geoTimeDedupBusy=false;
async function _geoDedupTimeEntries(){
  if(_geoTimeDedupBusy||!_supa||!_supaUser)return 0;
  _geoTimeDedupBusy=true;
  try{
    const cutoff=new Date(Date.now()-90*86400000).toISOString();
    const {data,error}=await _supa.from('job_time_entries')
      .select('id,employee_user_id,job_id,dest_place,source,client_key,arrived_at,departed_at').is('deleted_at',null)
      .eq('contractor_user_id',_geoCid()).gte('arrived_at',cutoff);
    if(error||!Array.isArray(data)||data.length<2)return 0;
    // Only ON-SITE presence dedupes: geofence, geofence-gap, geofence-
    // reconciled, place (a client/saved-place visit, live or reconciled),
    // stop, and the manual bookend, never drive/wheel time. 'place' was
    // missing here (owner report 2026-08-21: a client visit reconciled twice
    // by two reconciliation passes never got cleaned up, because neither
    // 'place' nor the new 'place-reconciled' matched this regex at all) --
    // the same class of gap drive rows are deliberately exempt from, except
    // client/place visits were never MEANT to be exempt, they simply got left
    // out when this was written for jobs first.
    const onSite=s=>/^(geofence|stop|manual|place)$/.test(String(s||''))||/^(geofence|place)-/.test(String(s||''));
    const rows=data.filter(r=>r&&r.id!=null&&r.arrived_at&&r.departed_at&&onSite(r.source));
    // A -reconciled row is a GUESS anchored to mileage legs, not a live fence
    // read: _geoReconcileFromMileage never checks for existing coverage
    // before writing (its own doc comment delegates that entirely to this
    // sweep), it just claims the WHOLE gap between two drive legs. So it can
    // land a job-tagged 'geofence-reconciled' row squarely on top of a real,
    // already-logged 'place' visit for the SAME person (owner screenshot
    // 2026-08-23: a 3h43m geofence-reconciled row for job "John Doe, AE"
    // sitting almost exactly on top of the real 3h42m 'place' visit). The
    // strict sameTarget rule below never caught that pair: one is job-tagged,
    // the other dest_place-tagged, different "targets" even though they're
    // the same physical visit.
    //
    // A first version of this fix (2026-08-23) fixed the missed comparison
    // but still fully DELETED the losing reconciled row, exactly like any
    // other pairwise dup. That is correct only when the reconciled row is
    // FULLY covered by what it overlaps. A window covering the whole
    // drive-to-drive gap routinely overlaps only PART of itself with real
    // rows (the owner's very next report: dropping the loser wholesale wiped
    // out two genuinely uncovered stretches, 7:55-10:57am AND 12:25-4:16pm,
    // that nothing else had ever recorded, because they happened to share a
    // row with a correctly-covered stretch in between). A reconciled row is
    // therefore never simply dropped for overlapping something: its claim is
    // trimmed down to whatever part of its own window nothing else already
    // covers, target match or not. Two LIVE detections still require
    // sameTarget below (a real two-job day must survive) and are still
    // resolved by straight delete, only a reconciled row's guess ever gets
    // this trim treatment: nothing this function infers should ever erase,
    // OR be trusted over, something the fence machine (or a human) actually
    // observed.
    const isReconciled=s=>/-reconciled$/.test(String(s||''));
    // 15 minutes, not the 2-minute "insignificant visit" floor used
    // elsewhere: that floor separates a real-but-short visit from nothing,
    // this one separates a genuinely uncovered stretch from ordinary
    // measurement jitter at the edge of an otherwise-matching pair (a
    // reconciled window's boundary rarely lines up with a live one to the
    // minute). The real gaps this fix exists for ran 3+ hours; a few
    // minutes of edge slop spawning its own tiny fragment row would just be
    // new noise of the same shape this fix is closing.
    const _GEO_RECON_GAP_FLOOR_MS=15*60000;
    const drop=new Set();
    const trims=[];     // {id, arrived_at, departed_at, minutes}
    const inserts=[];   // extra surviving fragments when a gap sits on both sides

    // Phase 1: every reconciled row's claim shrinks to whatever part of its
    // own window nothing else already covers, for the SAME person, any
    // target. _geoIntervalGaps does the interval math; see its own comment.
    for(const a of rows){
      if(!isReconciled(a.source))continue;
      const aS=Date.parse(a.arrived_at),aE=Date.parse(a.departed_at);
      const covering=[];
      for(const b of rows){
        if(b===a||String(b.employee_user_id||'')!==String(a.employee_user_id||''))continue;
        const bS=Date.parse(b.arrived_at),bE=Date.parse(b.departed_at);
        // Directional for a reconciled b: only a STRICTLY SHORTER reconciled
        // row ever counts as coverage that shrinks a longer one, never the
        // reverse. Without this, a resurrected full-span duplicate (the
        // self-heal case right below) and the already-trimmed fragment it
        // now overlaps would each see the OTHER as "this fully covers me"
        // in the SAME pass off the SAME snapshot, and both could end up
        // deleted, the correct trim along with the bad resurrection. A live
        // row is always authoritative regardless of duration.
        if(isReconciled(b.source)&&(bE-bS)>=(aE-aS))continue;
        if(aS<bE&&bS<aE)covering.push([Math.max(aS,bS),Math.min(aE,bE)]);
      }
      if(!covering.length)continue;   // nothing overlaps this row at all
      // Surviving fragments, chronological (they never overlap each other,
      // so order only matters for which one updates the row already in hand
      // vs which become new fragments below), each past the floor above.
      const keep=_geoIntervalGaps(aS,aE,covering).filter(([s,e])=>e-s>=_GEO_RECON_GAP_FLOOR_MS);
      if(!keep.length){drop.add(a.id);continue;}   // fully covered: a plain duplicate
      const[k0S,k0E]=keep[0];
      if(!(k0S===aS&&k0E===aE)){
        // Re-keyed, not just re-timed: _geoDrainQueue's own duplicate-key
        // fallback (owner rule 2026-08-21, "a duplicate on OUR OWN
        // deterministic key means this is the SAME visit... overwrite it
        // with the newer numbers") treats a fresh write landing on this
        // row's ORIGINAL 'rec-'+legKey client_key as license to resurrect
        // it back to the full untrimmed span, exactly what the reconciler
        // re-proposes on every single re-run (every Time Log open, every
        // Me/Team switch, nothing throttles it). That fallback exists for a
        // real case, a still-open visit's window legitimately growing, and
        // touching it would risk breaking that; the correction here is
        // narrower: once THIS row has been trimmed by something real, it is
        // no longer "the reconciler's own open guess," it is settled, so it
        // moves to a key the reconciler can never collide with again. A
        // stray resurrection under the OLD key still self-heals: the fresh
        // full-span duplicate it creates gets fully covered by this trimmed
        // row (still at its old, correct boundaries) plus whatever it
        // overlaps, and this same sweep deletes it right back out next pass.
        trims.push({id:a.id,arrived_at:new Date(k0S).toISOString(),departed_at:new Date(k0E).toISOString(),minutes:Math.max(0,Math.round((k0E-k0S)/60000)),client_key:String(a.id)+'-frag0'});
      }
      // A gap can sit on BOTH sides of what got covered (the owner's exact
      // report: real visits landed in the MIDDLE of the reconciled window,
      // leaving genuine uncovered time both before and after them). The
      // first fragment updates the row already in hand; anything past that
      // needs its own row, deterministic client_key so a re-run can never
      // double-insert the same fragment twice.
      for(let k=1;k<keep.length;k++){
        const[gS,gE]=keep[k];
        inserts.push({contractor_user_id:_geoCid(),employee_user_id:a.employee_user_id,
          job_id:a.job_id||null,dest_place:a.dest_place||null,source:a.source,
          arrived_at:new Date(gS).toISOString(),departed_at:new Date(gE).toISOString(),
          minutes:Math.max(0,Math.round((gE-gS)/60000)),client_key:String(a.id)+'-frag'+k});
      }
    }

    // Phase 2: same-target pairwise dedup for the rest (live rows only, and
    // any reconciled row already fully resolved above never reaches here).
    const rest=rows.filter(r=>!drop.has(r.id)&&!isReconciled(r.source));
    for(let i=0;i<rest.length;i++){
      const a=rest[i];if(drop.has(a.id))continue;
      for(let j=i+1;j<rest.length;j++){
        const b=rest[j];if(drop.has(b.id))continue;
        if(String(a.employee_user_id||'')!==String(b.employee_user_id||''))continue;
        // Same destination: same job, or (both jobless) the same named place.
        const sameTarget=a.job_id!=null&&b.job_id!=null
          ?String(a.job_id)===String(b.job_id)
          :(a.job_id==null&&b.job_id==null&&a.dest_place&&String(a.dest_place)===String(b.dest_place));
        if(!sameTarget)continue;
        const aS=Date.parse(a.arrived_at),aE=Date.parse(a.departed_at);
        const bS=Date.parse(b.arrived_at),bE=Date.parse(b.departed_at);
        if(!(aS<bE&&bS<aE))continue;   // no real overlap: two genuinely separate visits
        // A row the owner corrected by hand counts as a human clock record
        // here too (owner rule 2026-08-24): a hand-set boundary must never
        // lose to a longer automatic guess it was written to correct.
        const human=r=>r.source==='manual'||/^fixed-/.test(String(r.client_key||''));
        const aMan=human(a),bMan=human(b);
        let loser;
        if(aMan!==bMan)loser=aMan?b:a;               // a human's clock record always wins
        else loser=(aE-aS)>=(bE-bS)?b:a;              // otherwise the longest measured wins
        drop.add(loser.id);
        if(loser.id===a.id)break;
      }
    }
    if(!drop.size&&!trims.length&&!inserts.length)return 0;
    for(const id of drop){
      try{await _tdSoftDelete('job_time_entries',id);}catch(_e){}
    }
    for(const t of trims){
      try{await _supa.from('job_time_entries').update({arrived_at:t.arrived_at,departed_at:t.departed_at,minutes:t.minutes,client_key:t.client_key}).eq('id',t.id);}catch(_e){}
    }
    for(const row of inserts){
      try{await _supa.from('job_time_entries').insert(row);}catch(_e){}
    }
    _geoParkNote('time-dedup','dropped '+drop.size+', trimmed '+trims.length+', split '+inserts.length);
    return drop.size+trims.length+inserts.length;
  }catch(_e){return 0;}
  finally{_geoTimeDedupBusy=false;}
}
// Pure interval math for the reconciled-row trim above: given a row's own
// [start,end) and a list of [start,end) ranges that overlap SOME part of it,
// returns the sub-ranges of [start,end) that none of them cover. Merges the
// covering ranges first so two overlapping/adjacent covering rows read as
// one block, not a false gap between them.
function _geoIntervalGaps(start,end,covering){
  const merged=covering.slice().sort((a,b)=>a[0]-b[0]);
  const out=[];
  for(const iv of merged){
    if(out.length&&iv[0]<=out[out.length-1][1])out[out.length-1][1]=Math.max(out[out.length-1][1],iv[1]);
    else out.push(iv.slice());
  }
  const gaps=[];
  let cursor=start;
  for(const[s,e]of out){
    const cs=Math.max(s,start),ce=Math.min(e,end);
    if(cs>cursor)gaps.push([cursor,cs]);
    cursor=Math.max(cursor,ce);
  }
  if(cursor<end)gaps.push([cursor,end]);
  return gaps;
}

// ── Same-place visit merge (owner rule 2026-08-23: "see all the John Doe
// stuff? From 7:55 am - 11:37 am those can all be merged... that's the
// reconciliation I want") ──────────────────────────────────────────────
// _geoDedupTimeEntries above only resolves OVERLAPPING rows for the exact
// same job_id (or the exact same dest_place text); it never touches two
// rows that are merely ADJACENT (a live geofence row picking back up
// seconds after a fence blip, or a reconciled trim fragment sitting flush
// against the live visit it was trimmed around), and it never compares a
// job_id-tagged row against a dest_place-tagged row even when they resolve
// to the same real place (a scheduled job's geofence row vs. a saved-place
// row for the same client). Both show up as extra rows for what was really
// one continuous visit. This pass merges both cases: same person, same
// resolved place, gap at or under the true-back-to-back floor, folds into
// ONE row spanning the earliest arrival to the latest departure.
//
// "Same resolved place" reuses _tlJobClientInfo (js/timelog.js, loaded by
// the time this ever actually runs, guarded below), the exact function
// Time Log already uses to turn a job_id into the client name shown on
// screen, so "same place" here means the same thing it means on screen
// (§7.3, don't hand-roll a parallel identity check).
//
// Owner's rule, restated 2026-08-24 after the live incident: two same-place
// records merge when "there were no real drive events picked up between
// them, just loss of gps geofence." So the old 2-minute floor is only the
// fast path; a LARGER gap also merges, but only when it is provably EMPTY:
// no mileage leg, no drive/stop/visit row, no shop session overlaps it, and
// both sides sit in the same Central day. Anything recorded in the gap
// BLOCKS the merge (the person demonstrably left), the exact inversion of
// the disaster mode where transient rows CHAINED a merge across a real
// lunch break. Reconciled rows are excluded from candidacy entirely: the
// 2026-08-23 corruption happened because a reconciled full-day guess
// resolved to the same client name as the live visits, overlapped both,
// and bridged the owner's real 47-minute lunch into one 551-minute row.
// Dedup's own trim phase already resolves reconciled-vs-live overlap; merge
// is for live detections only.
//
// Manual and 'stop' rows are never merge candidates: a manual bookend is a
// human's own clock record, never silently folded into an automatic row;
// 'stop' is its own visible unpaid category (owner request 2026-08-23, see
// _geoIsOffJobSource) and stays its own line even at the literal same GPS
// spot, a lunch stop across the street from the job is still lunch.
//
// Deliberately re-fetches fresh from the server rather than reusing
// another sweep's in-memory rows: merge candidates must already be
// trim/overlap-resolved by _geoDedupTimeEntries, and every call site
// (js/cloud.js) chains this off that sweep's own promise so it always
// starts after those writes have actually landed.
//
// RLS note: same as _geoDedupTimeEntries above, an employee's own device
// has no update/delete grant here, so a merge found on an employee's phone
// fails silently (caught below) and waits for the owner's own device to
// run this same sweep with full contractor-scoped rights.
let _geoMergeBusy=false;
async function _geoMergeAdjacentVisits(){
  if(_geoMergeBusy||!_supa||!_supaUser)return 0;
  _geoMergeBusy=true;
  try{
    const cutoff=new Date(Date.now()-90*86400000).toISOString();
    const {data,error}=await _supa.from('job_time_entries')
      .select('id,employee_user_id,job_id,dest_place,source,client_key,arrived_at,departed_at').is('deleted_at',null)
      .eq('contractor_user_id',_geoCid()).gte('arrived_at',cutoff);
    if(error||!Array.isArray(data)||data.length<2)return 0;
    const all=data.filter(r=>r&&r.id!=null&&r.arrived_at&&r.departed_at);
    // Candidates: LIVE geofence/place detections only. Never reconciled
    // guesses (see the doc comment above: they bridged the 8/21 lunch),
    // never manual bookends, never stops, never drive rows.
    const isCandidate=s=>/^(geofence|geofence-gap|place)$/.test(String(s||''));
    // A row a HUMAN corrected by hand is never a merge candidate, the same
    // protection 'manual' already gets everywhere in this file: the owner
    // set those boundaries on purpose and no sweep may widen them again
    // (owner rule 2026-08-24, when GPS rows became editable).
    const isHumanFixed=r=>/^fixed-/.test(String(r.client_key||''));
    const rows=all.filter(r=>isCandidate(r.source)&&!isHumanFixed(r));
    if(rows.length<2)return 0;
    // Shop sessions block a gap the same way any other recorded presence
    // does. Best-effort: a failed fetch just means shop evidence is not
    // checked this pass, and nothing merges ACROSS what we cannot see only
    // when the gap is otherwise empty, so erring here can only under-merge.
    let shopRows=[];
    try{
      const sr=await _supa.from('shop_time_entries')
        .select('employee_user_id,arrived_at,departed_at').is('deleted_at',null)
        .eq('contractor_user_id',_geoCid()).gte('arrived_at',cutoff);
      if(sr&&!sr.error&&Array.isArray(sr.data))shopRows=sr.data.filter(x=>x&&x.arrived_at&&x.departed_at);
    }catch(_e){}
    const P=x=>Date.parse(x)||0;
    const dstr=d=>(typeof _ctDateStr==='function')?_ctDateStr(d):dateKey(d);
    const _GEO_MERGE_GAP_MS=2*60000;
    // Ceiling on an EMPTY gap this sweep will bridge (see gapBlocked below).
    // 60 minutes: comfortably covers a fence blip or a short shop bounce
    // (Mon 8/17's real one was 14 minutes) without ever folding away an
    // unobserved absence.
    const _GEO_MERGE_MAX_GAP_MS=60*60000;
    // GPS mileage legs for one person: owner rows carry employee_user_id =
    // the contractor id but mileage stamps logged_by_id null for the owner
    // (autoLogDriveTrip), same null convention the reconciler uses.
    const legsFor=emp=>{
      if(typeof mileage==='undefined'||!Array.isArray(mileage))return [];
      const me=String(emp||'')===String(_geoCid())?null:String(emp||'');
      return mileage.filter(m=>m&&m.gps&&m.startedIso&&m.endedIso&&
        String((m.logged_by_id||null)||'')===String(me||''));
    };
    // A gap is EMPTY only when nothing on record overlaps it beyond edge
    // slack: no other time row of any source, no shop session, no mileage
    // leg, and it does not cross Central midnight.
    const gapBlocked=(emp,g1,g2,skipIds)=>{
      if(dstr(new Date(g1))!==dstr(new Date(g2)))return true;
      // A SHORT empty gap is lost GPS; a long one is an unobserved absence.
      // Both look identical to the checks below (nothing on record either
      // way), so size is the only thing separating them. Found in review
      // 2026-08-24: Mon 8/17 folded correctly ONLY because the repair had
      // already filled 8:18am-4:23pm first; without it this would have
      // blindly bridged 8h19m of nothing. That is the same over-reach that
      // ate the owner's lunch on 8/21, just arrived at from the other side.
      // The owner's rule was "no real drive events between them, just loss
      // of gps geofence", which is a few minutes, not a workday. A genuinely
      // long unobserved window is the mileage-anchored reconciler's job: it
      // has drive legs as evidence, this has none.
      if(g2-g1>_GEO_MERGE_MAX_GAP_MS)return true;
      const ov=(s1,e1)=>Math.min(e1,g2)-Math.max(s1,g1)>_GEO_MERGE_GAP_MS;
      for(const b of all){
        if(skipIds.has(b.id))continue;
        if(String(b.employee_user_id||'')!==String(emp||''))continue;
        if(ov(P(b.arrived_at),P(b.departed_at)))return true;
      }
      for(const b of shopRows){
        if(String(b.employee_user_id||'')!==String(emp||''))continue;
        if(ov(P(b.arrived_at),P(b.departed_at)))return true;
      }
      for(const m of legsFor(emp)){
        if(ov(P(m.startedIso),P(m.endedIso)))return true;
      }
      return false;
    };
    const placeKey=r=>{
      if(r.job_id!=null){
        const info=(typeof _tlJobClientInfo==='function')?_tlJobClientInfo(r.job_id):null;
        const name=info&&info.clientName&&info.clientName!=='-'?info.clientName:null;
        return name?'n:'+String(name).trim().toLowerCase():'j:'+String(r.job_id);
      }
      return r.dest_place?'n:'+String(r.dest_place).trim().toLowerCase():null;
    };
    const groups={};
    for(const r of rows){
      const key=placeKey(r);if(!key)continue;
      const gk=String(r.employee_user_id||'')+'|'+key;
      (groups[gk]=groups[gk]||[]).push(r);
    }
    const drop=new Set();
    const updates=[]; // {id, arrived_at, departed_at, minutes, job_id, dest_place, source, client_key}
    // Among live rows, whichever carries a job_id keeps the structured
    // reference rather than falling back to free-text dest_place.
    const rank=r=>r.job_id!=null?1:0;
    for(const gk of Object.keys(groups)){
      const emp=gk.slice(0,gk.indexOf('|'));
      const list=groups[gk].slice().sort((a,b)=>P(a.arrived_at)-P(b.arrived_at));
      let cluster=[list[0]];
      const flush=()=>{
        if(cluster.length<2){cluster=[];return;}
        const start=Math.min(...cluster.map(x=>P(x.arrived_at)));
        const end=Math.max(...cluster.map(x=>P(x.departed_at)));
        // The merged result must itself be one same-day span: a cluster
        // that would cross Central midnight is left as-is.
        if(dstr(new Date(start))!==dstr(new Date(end))){cluster=[];return;}
        const tpl=cluster.slice().sort((a,b)=>rank(b)-rank(a))[0];
        updates.push({id:tpl.id,arrived_at:new Date(start).toISOString(),departed_at:new Date(end).toISOString(),
          minutes:Math.max(0,Math.round((end-start)/60000)),job_id:tpl.job_id||null,dest_place:tpl.dest_place||null,
          source:tpl.source,client_key:'merge-'+tpl.id});
        cluster.forEach(x=>{if(x.id!==tpl.id)drop.add(x.id);});
        cluster=[];
      };
      for(let i=1;i<list.length;i++){
        const prevEnd=Math.max(...cluster.map(x=>P(x.departed_at)));
        const curStart=P(list[i].arrived_at);
        const gap=curStart-prevEnd;
        const skipIds=new Set(cluster.map(x=>x.id));skipIds.add(list[i].id);
        if(gap<=_GEO_MERGE_GAP_MS||!gapBlocked(emp,prevEnd,curStart,skipIds))cluster.push(list[i]);
        else{flush();cluster=[list[i]];}
      }
      flush();
    }
    if(!updates.length&&!drop.size)return 0;
    for(const u of updates){
      try{await _supa.from('job_time_entries').update({arrived_at:u.arrived_at,departed_at:u.departed_at,minutes:u.minutes,job_id:u.job_id,dest_place:u.dest_place,source:u.source,client_key:u.client_key}).eq('id',u.id);}catch(_e){}
    }
    for(const id of drop){
      try{await _tdSoftDelete('job_time_entries',id);}catch(_e){}
    }
    _geoParkNote('time-merge','merged '+updates.length+' clusters, removed '+drop.size+' rows');
    return updates.length+drop.size;
  }
  // A swallowed throw here is indistinguishable from "nothing to merge": both
  // return 0 quietly, and the whole body runs inside this try, including
  // placeKey's call out to _tlJobClientInfo (js/timelog.js), which reads the
  // live jobs/bids/clients arrays and is not this file's code. That is how CI
  // shard 6 produced three separate zero-merge failures whose diagnostics all
  // came back clean (2026-08-24). It now leaves a trail in the park log, which
  // is also the panel the owner reads on a live device, so the next one says
  // what actually happened instead of looking like an empty day.
  catch(_e){
    try{_geoParkNote('time-merge-err',(_e&&_e.message)||String(_e));}catch(_e2){}
    return 0;
  }
  finally{_geoMergeBusy=false;}
}

// ── Absorb untracked gaps into the adjacent unpaid stop (owner rule
// 2026-08-23) ──────────────────────────────────────────────────────────────
// A geofence departure (job_time_entries.departed_at on a job/place/client
// row) is written the moment a GPS ping CONFIRMED the exit (see the
// confirmation gating in the ping handler above), never the moment someone
// actually walked out the door. Whatever elapses between that confirmed exit
// and the next thing the app logs, an arrival somewhere business, or a stop
// settling into 'Unpaid', is real elapsed time that was never written
// anywhere at all: not paid, not unpaid, simply absent (owner screenshot
// 2026-08-23: a clean 4m33s hole between "Clock Out 11:37 AM" on the John
// Doe card and "Clock In 11:42 AM" on the Unpaid card next to it, no
// mileage leg, no drive row, nothing on record for that stretch).
//
// Owner's call: the gap belongs to whichever side is already unpaid, never
// silently invisible and never billed to a job. This runs AFTER dedup and
// merge above (their writes must have landed, or this could read a stale
// snapshot and stretch a stop across a row that's about to be dropped
// anyway), and only ever extends a 'stop' row's own edges to meet its
// immediate chronological neighbor, on either side. It never touches a
// paid row's own boundaries.
let _geoGapAbsorbBusy=false;
async function _geoAbsorbGapsIntoStops(){
  if(_geoGapAbsorbBusy||!_supa||!_supaUser)return 0;
  _geoGapAbsorbBusy=true;
  try{
    const cutoff=new Date(Date.now()-90*86400000).toISOString();
    const {data,error}=await _supa.from('job_time_entries')
      .select('id,employee_user_id,source,arrived_at,departed_at').is('deleted_at',null)
      .eq('contractor_user_id',_geoCid()).gte('arrived_at',cutoff);
    if(error||!Array.isArray(data)||data.length<2)return 0;
    const rows=data.filter(r=>r&&r.id!=null&&r.arrived_at&&r.departed_at);
    if(rows.length<2)return 0;
    const byEmp={};
    for(const r of rows){
      const k=String(r.employee_user_id||'');
      (byEmp[k]=byEmp[k]||[]).push(r);
    }
    const updates=[]; // {id, arrived_at, departed_at, minutes}
    for(const emp of Object.keys(byEmp)){
      // Every row this person has, any source, drive included: the gap this
      // fixes is real only when NOTHING else already sits in it, and a short
      // drive leg counts as something even if it isn't a stop.
      const list=byEmp[emp].slice().sort((a,b)=>Date.parse(a.arrived_at)-Date.parse(b.arrived_at));
      for(let i=0;i<list.length;i++){
        const r=list[i];
        if(String(r.source||'')!=='stop')continue;
        let newStart=Date.parse(r.arrived_at),newEnd=Date.parse(r.departed_at);
        let changed=false;
        // Leading gap: the row immediately before this one in chronological
        // order is the nearest thing on record, gap or not, anything that
        // actually filled the space would already sort between them.
        if(i>0){
          const prevEnd=Date.parse(list[i-1].departed_at);
          if(prevEnd<newStart){newStart=prevEnd;changed=true;}
        }
        // Trailing gap, the same idea, the other direction.
        if(i<list.length-1){
          const nextStart=Date.parse(list[i+1].arrived_at);
          if(nextStart>newEnd){newEnd=nextStart;changed=true;}
        }
        if(!changed)continue;
        updates.push({id:r.id,arrived_at:new Date(newStart).toISOString(),departed_at:new Date(newEnd).toISOString(),
          minutes:Math.max(0,Math.round((newEnd-newStart)/60000))});
      }
    }
    if(!updates.length)return 0;
    for(const u of updates){
      try{await _supa.from('job_time_entries').update({arrived_at:u.arrived_at,departed_at:u.departed_at,minutes:u.minutes}).eq('id',u.id);}catch(_e){}
    }
    _geoParkNote('gap-absorb','extended '+updates.length+' unpaid stops to close adjacent untracked gaps');
    return updates.length;
  }catch(_e){return 0;}
  finally{_geoGapAbsorbBusy=false;}
}

// ── One-shot repair for the 2026-08 merge/gap-absorb incident (owner order
// 2026-08-24) ──────────────────────────────────────────────────────────────
// _geoMergeAdjacentVisits and _geoAbsorbGapsIntoStops (both disabled above)
// ran repeatedly against live data and left corrupted job_time_entries rows
// behind: 'merge-' survivor rows exactly duplicating the reconciled work row
// they bridged (one 9h11m day counted twice), and 'stop' rows stretched
// across midnight or on top of real on-site time (one reached 27h42m). This
// deletes exactly those fingerprints, once, in the incident window only, and
// never touches a job-tagged row beyond the literal duplicate case. Runs on
// the OWNER's device only (an employee session has no delete grant, RLS
// note on _geoDedupTimeEntries above) and marks itself done in localStorage
// so it can never become another recurring sweep, which is the exact failure
// mode that caused the damage it repairs.
let _geoStopRepairBusy=false;
const _GEO_STOP_REPAIR_FLAG='td_geo_stop_repair_v1';
async function _geoRepairStopRows(){
  if(_geoStopRepairBusy||!_supa||!_supaUser)return 0;
  if(typeof _isEmployee!=='undefined'&&_isEmployee)return 0;
  let done=null;try{done=localStorage.getItem(_GEO_STOP_REPAIR_FLAG);}catch(_e){}
  if(done)return 0;
  _geoStopRepairBusy=true;
  try{
    const {data,error}=await _supa.from('job_time_entries')
      .select('id,employee_user_id,job_id,dest_place,source,client_key,arrived_at,departed_at').is('deleted_at',null)
      .eq('contractor_user_id',_geoCid()).gte('arrived_at','2026-08-10T00:00:00Z')
      .lte('arrived_at','2026-08-25T00:00:00Z');
    if(error)return 0;
    const rows=(data||[]).filter(r=>r&&r.id!=null&&r.arrived_at&&r.departed_at);
    if(!rows.length){try{localStorage.setItem(_GEO_STOP_REPAIR_FLAG,new Date().toISOString());}catch(_e){}return 0;}
    // Shop sessions count as on-site coverage in fingerprint 3 below: the
    // live dry run against the real data (2026-08-24) found a stop stretched
    // squarely over hours of recorded shop presence, which the
    // job_time_entries fetch alone can never see. Best-effort: a failed shop
    // fetch just means shop overlap isn't checked this pass.
    let shopRows=[];
    try{
      const sr=await _supa.from('shop_time_entries')
        .select('employee_user_id,arrived_at,departed_at').is('deleted_at',null)
        .eq('contractor_user_id',_geoCid()).gte('arrived_at','2026-08-10T00:00:00Z')
        .lte('arrived_at','2026-08-25T00:00:00Z');
      if(sr&&!sr.error&&Array.isArray(sr.data))shopRows=sr.data.filter(s=>s&&s.arrived_at&&s.departed_at);
    }catch(_e){}
    const P=s=>Date.parse(s)||0;
    const dstr=d=>(typeof _ctDateStr==='function')?_ctDateStr(d):dateKey(d);
    const onSite=s=>{const t=String(s||'');return /^(geofence|manual|place)$/.test(t)||/^(geofence|place)-/.test(t);};
    const isMerge=r=>/^merge-/.test(String(r.client_key||''));
    // Forensic corrections for Fri 8/21 BEFORE the generic fingerprints run
    // (owner report 2026-08-24: "I had a lunch from like 11:37am to 12:25
    // and it's gone"). The raw location_pings for that day show the truck
    // parked away from the job from 11:42:09am (the stop row's own untouched
    // arrival) until motion resumed at 12:31:46pm, back on site at
    // 12:45:50pm, final exit 5:07:06pm. The merge survivor bridged that
    // whole stretch into one 7:55am-5:07pm row (owner's own record: the
    // morning visit ended at the 11:37am confirmed fence exit), and
    // gap-absorb stretched the lunch stop's end to 5:07pm. Rebuilt here from
    // the recorded fixes: morning visit, real lunch, afternoon visit. Keyed
    // to the exact corrupted rows' client_keys so it can never touch
    // anything else, and applied to the in-memory rows too so the
    // fingerprints below judge the CORRECTED day (the trimmed lunch no
    // longer overlaps anything, so fingerprint 3 keeps it).
    const fixUpdates=[];const fixInserts=[];
    for(const r of rows){
      const key=String(r.client_key||'');
      if(key==='merge-27962a20-be14-495b-b172-c0b4b8fccb22'){
        r.arrived_at='2026-08-21T12:55:55.101Z';r.departed_at='2026-08-21T16:37:00.000Z';
        r.client_key='repair-0821-am';
        fixUpdates.push({id:r.id,patch:{arrived_at:r.arrived_at,departed_at:r.departed_at,minutes:221,client_key:'repair-0821-am'}});
        if(!rows.some(x=>String(x.client_key||'')==='repair-0821-pm')){
          const pm={contractor_user_id:_geoCid(),employee_user_id:r.employee_user_id,
            job_id:null,dest_place:r.dest_place||'John Doe',source:'place',
            arrived_at:'2026-08-21T17:45:50.000Z',departed_at:'2026-08-21T22:07:06.228Z',
            minutes:261,client_key:'repair-0821-pm'};
          fixInserts.push(pm);
          rows.push({id:'__pm-0821',employee_user_id:pm.employee_user_id,job_id:null,
            dest_place:pm.dest_place,source:'place',client_key:pm.client_key,
            arrived_at:pm.arrived_at,departed_at:pm.departed_at});
        }
      }else if(key==='30a2b589-mt386omz-3bm8'){
        r.arrived_at='2026-08-21T16:42:09.105Z';r.departed_at='2026-08-21T17:31:46.000Z';
        fixUpdates.push({id:r.id,patch:{arrived_at:r.arrived_at,departed_at:r.departed_at,minutes:50}});
      }
    }
    // Second forensic fix, Mon 8/17 (owner report 2026-08-24: "should have
    // another John Doe fence, arriving back around 8:20am"). The deleted
    // mileage legs show shop -> John Doe ending 8:18:28am, the raw pings
    // show the truck still at the site at 12:20pm and again from 4:23pm,
    // and no leg leaves until 5:17pm: GPS parked minutes after arrival, so
    // the fence never logged the visit. It was ONE continuous visit, so
    // the surviving 4:23pm live row is extended back to the 8:18:28am
    // arrival rather than inserting a second card that would sit split at
    // 4:23 for no reason a person would recognize (owner question
    // 2026-08-24, and the merge sweep that would have joined them is
    // disabled). Gated on that live row's own client_key so this can only
    // ever fire on the one account whose data was damaged; a re-run sees
    // the row already extended and does nothing.
    const monAnchor=rows.find(x=>String(x.client_key||'')==='30a2b589-msxzqfrk-e7xe');
    if(monAnchor&&P(monAnchor.arrived_at)>Date.parse('2026-08-17T13:18:28.100Z')){
      monAnchor.arrived_at='2026-08-17T13:18:28.100Z';
      fixUpdates.push({id:monAnchor.id,patch:{arrived_at:monAnchor.arrived_at,minutes:539}});
    }
    const drop=new Set();
    // Fingerprint 1: a stop spanning Central midnight is an overnight park
    // gap-absorb swallowed, or a row the live tracker wrote back when crossing
    // midnight was the only test it had. Either way it is legacy damage: rows
    // written since _geoWriteStop landed are apportioned at midnight, so a
    // genuine late-night break arrives here as two same-day halves and this can
    // no longer mistake it for a park. Same predicate the writer uses, one
    // definition of "spans Central midnight" for the whole file.
    for(const r of rows){
      if(String(r.source||'')!=='stop')continue;
      if(_geoStopCrossesMidnight(r.arrived_at,r.departed_at))drop.add(r.id);
    }
    // Fingerprint 2: a merge survivor whose span is already (>=90%) covered
    // by real on-site rows is pure double-count, the reconciled/live rows it
    // bridged still tell the true story. A merge row NOT covered stays: the
    // originals it replaced are gone, and keeping plausible on-site time
    // beats deleting hours nothing else recorded.
    for(const r of rows){
      if(!isMerge(r))continue;
      const s=P(r.arrived_at),e=P(r.departed_at);
      if(!(e>s))continue;
      const cov=rows.filter(b=>b!==r&&!drop.has(b.id)&&!isMerge(b)&&onSite(b.source)&&
        String(b.employee_user_id||'')===String(r.employee_user_id||'')&&
        P(b.arrived_at)<e&&P(b.departed_at)>s)
        .map(b=>[Math.max(s,P(b.arrived_at)),Math.min(e,P(b.departed_at))]);
      if(!cov.length)continue;
      const uncovered=_geoIntervalGaps(s,e,cov).reduce((t,g)=>t+(g[1]-g[0]),0);
      if(uncovered<=(e-s)*0.1)drop.add(r.id);
    }
    // Fingerprint 3: a stop sitting on top of real on-site time (gap-absorb
    // stretched it sideways into a work window), or two stops claiming the
    // same window (repeated runs stretched both): the on-site row always
    // wins, and of two stops the shorter is the artifact.
    for(const r of rows){
      if(String(r.source||'')!=='stop'||drop.has(r.id))continue;
      const s=P(r.arrived_at),e=P(r.departed_at);
      for(const b of rows){
        if(b===r||drop.has(b.id))continue;
        if(String(b.employee_user_id||'')!==String(r.employee_user_id||''))continue;
        const bs=P(b.arrived_at),be=P(b.departed_at);
        const ov=Math.min(e,be)-Math.max(s,bs);
        if(ov<=2*60000)continue;
        if(onSite(b.source)){drop.add(r.id);break;}
        if(String(b.source||'')==='stop'&&
           ((e-s)<(be-bs)||((e-s)===(be-bs)&&String(r.id)>String(b.id)))){drop.add(r.id);break;}
      }
      if(drop.has(r.id))continue;
      // A shop session is on-site presence too; a stop lying over one is
      // the same stretched-sideways artifact.
      for(const b of shopRows){
        if(String(b.employee_user_id||'')!==String(r.employee_user_id||''))continue;
        const ov=Math.min(e,P(b.departed_at))-Math.max(s,P(b.arrived_at));
        if(ov>2*60000){drop.add(r.id);break;}
      }
    }
    let ok=true;
    for(const u of fixUpdates){
      try{const res=await _supa.from('job_time_entries').update(u.patch).eq('id',u.id);if(res&&res.error)ok=false;}catch(_e){ok=false;}
    }
    // Inserts are best-effort: a re-run that already landed the row hits the
    // contractor+client_key unique index, which is success, not failure.
    for(const row of fixInserts){
      try{await _supa.from('job_time_entries').insert(row);}catch(_e){}
    }
    for(const id of drop){
      try{if(!(await _tdSoftDelete('job_time_entries',id)))ok=false;}catch(_e){ok=false;}
    }
    _geoParkNote('stop-repair','removed '+drop.size+', fixed '+fixUpdates.length+', rebuilt '+fixInserts.length+(ok?'':' (partial, will retry)'));
    // Done only when every delete landed: a partial pass (offline mid-sweep)
    // retries next boot instead of leaving survivors forever.
    if(ok){try{localStorage.setItem(_GEO_STOP_REPAIR_FLAG,new Date().toISOString());}catch(_e){}}
    return drop.size+fixUpdates.length+fixInserts.length;
  }catch(_e){return 0;}
  finally{_geoStopRepairBusy=false;}
}

// Shared chain for every js/cloud.js call site that used to fire just
// _geoDedupTimeEntries() on its own: dedup, then merge, then gap-absorb, each
// step awaiting the one before it so it never reads a stale snapshot the
// prior step was about to change. One place to extend instead of three
// hand-rolled .then() chains drifting apart (§7.3).
async function _geoTimeEntriesSettleChain(){
  try{if(typeof _geoRepairStopRows==='function')await _geoRepairStopRows();}catch(_e){}
  try{if(typeof _geoDedupTimeEntries==='function')await _geoDedupTimeEntries();}catch(_e){}
  // RE-ENABLED 2026-08-24: see the matching note in _geoReconcileFromMileage
  // above (reconciled rows excluded, empty-gap rule, same-day bound).
  try{if(typeof _geoMergeAdjacentVisits==='function')await _geoMergeAdjacentVisits();}catch(_e){}
  // STILL DISABLED (owner report 2026-08-23): the repeated heartbeat-
  // triggered chain compounded this into multi-hour, overnight-spanning
  // "stop" rows, corrupting live payroll data. Its jobs are now covered
  // differently: the midnight write guard stops overnight parks at the
  // source and the Time Log's anchor rule decides what unpaid time renders.
  // try{if(typeof _geoAbsorbGapsIntoStops==='function')await _geoAbsorbGapsIntoStops();}catch(_e){}
}

// ── Drive-time hygiene: paid drive minutes must match a leg mileage itself
// would still stand behind (owner rule 2026-08-22) ──────────────────────────
// A job_time_entries 'drive*' row is written the moment a raw GPS leg closes
// (_geoDriveEntry), before mileage's own dedup/collapse sweeps
// (_mileDedupTrips, _milePersonalStopSweep in js/mileage.js) ever get a
// chance to judge whether that leg survives as a real, deductible
// fence-to-fence business leg. Those sweeps correctly delete or re-origin
// mileage rows after the fact, exactly the owner's Home Depot -> Sam's Club
// -> Shop example: the personal middle stop drops out, and only the direct
// Home Depot -> Shop leg survives. But nothing ever told the ALREADY-WRITTEN
// payroll row about it, so paid drive time kept sitting on entries whose
// underlying leg no longer exists, or was never a real leg at all (owner
// live diagnostic, 2026-08-21: seven paid "Driving" rows with zero matching
// mileage leg in one day, plus one physical drive double-paid from an
// exact-duplicate leg pair 6ms apart that mileage's own live dedup missed by
// a hair, see _mileSameLeg's exact-timestamp requirement).
//
// _geoDriveEntry already mints ONE legKey and stamps it on BOTH rows
// (job_time_entries.client_key AND the mileage row's own legKey, "so the
// SAME key lands on the time entry and on the mileage row"), so this is a
// straight comparison, never a re-derivation: whatever legKey does not
// currently survive in the local mileage array as a real gps-logged leg
// loses its paid drive-time row too. A leg mileage would keep is paid; a leg
// mileage collapsed away, merged into a survivor, or never wrote at all
// (the round-trip-with-nothing-business-in-it case, sameSpot in
// _geoDriveEntry) is not, matching the owner's stated rule exactly: drive
// time is paid ONLY for a fence-to-fence leg, never independently of one.
let _geoDriveSyncBusy=false;
async function _geoSyncDriveTimeEntries(){
  if(_geoDriveSyncBusy||!_supa||!_supaUser)return 0;
  if(typeof mileage==='undefined'||!Array.isArray(mileage))return 0;
  _geoDriveSyncBusy=true;
  try{
    // 90-day cutoff (widened from 7, owner audit 2026-08-24): 7 days was
    // sized for ongoing hygiene, but twin drive rows whose duplicate legs
    // died later than a week after the drive aged OUT of this sweep's reach
    // and sat as double-paid drive time forever. Same widening, same reason
    // as _geoDedupTimeEntries (2026-08-23). Mileage is the IRS log and is
    // never pruned, so an old drive row with a real leg is never at risk.
    const cutoff=new Date(Date.now()-90*86400000).toISOString();
    const {data,error}=await _supa.from('job_time_entries')
      .select('id,source,client_key').is('deleted_at',null)
      .eq('contractor_user_id',_geoCid()).gte('arrived_at',cutoff);
    if(error||!Array.isArray(data)||!data.length)return 0;
    const driveRows=data.filter(r=>r&&r.id!=null&&/^drive/.test(String(r.source||'')));
    if(!driveRows.length)return 0;
    // Real GPS legs only, a hand-typed manual mileage row never had a
    // matching time entry to begin with and carries no legKey to compare.
    const surviving=new Set(mileage.filter(m=>m&&m.gps&&m.legKey).map(m=>m.legKey));
    const drop=driveRows.filter(r=>!r.client_key||!surviving.has(r.client_key));
    if(!drop.length)return 0;
    for(const r of drop){
      try{await _tdSoftDelete('job_time_entries',r.id);}catch(_e){}
    }
    _geoParkNote('drive-sync','dropped '+drop.length+' drive row(s) with no surviving mileage leg');
    return drop.length;
  }catch(_e){return 0;}
  finally{_geoDriveSyncBusy=false;}
}

// ── Reconciled rows are re-tested against the breadcrumbs, forever ──────────
//
// Owner, 2026-08-25: "It should fix all time logs, why doesn't it?"
//
// It didn't, because the ping check added to _geoReconcileFromMileage is a
// GATE, not a sweep: it decides what gets written and never looks again. Every
// bad row already on the books predates it and stays exactly as wrong as it
// was. On the owner's account that is 541 minutes billed to one job on
// 2026-08-24 while the recorded fixes walk Topeka, Kansas City, Colorado, Salt
// Lake City.
//
// This is that same check as a sweep. Same helper (_geoPingTrim), same fence
// figure the live machine uses, run over every reconciled row in the window on
// every cleanup pass. A row whose own breadcrumbs contradict it is trimmed to
// what they support, or deleted when nothing is left.
//
// It also replaces the three-part scaffold that looked necessary an hour ago:
// re-key the trim's fragments to preserve legKey provenance, extend the drive
// sweep to on-site rows, then a one-time pass to clear the backlog. None of
// that is needed. Provenance only mattered for tracing a row back to a mileage
// leg that might have been swept; the pings are ground truth directly, so the
// legKey is irrelevant and a fragment with no legKey at all (which is exactly
// what the 08-24 rows are) is checked the same as any other row. No one-time
// script, no hardcoded dates, and it keeps working on days nobody has seen yet.
//
// SCOPE: '-reconciled' sources only. A live 'geofence'/'place'/'stop' row is
// something the fence machine OBSERVED, and the rule this file already holds
// stands: nothing inferred may ever erase, or be trusted over, something that
// was actually observed. Only a guess is re-judged.
//
// FAILS OPEN, same as the write-time gate: no pings in a row's window leaves it
// untouched. A phone that was not reporting is the case this whole feature
// exists for, so silence must never delete a real visit.
//
// RLS note, same shape as the sweeps above: an employee's device can read its
// own rows but holds no delete/update grant, so a correction found there fails
// silently and waits for the contractor's own device to run this.
let _geoVerifyBusy=false;
const _GEO_VERIFY_DAYS=30;        // far enough back to clear a real backlog
const _GEO_VERIFY_MAX_ROWS=40;    // bounded work per pass, one small query each
// Re-checked once per Central day per row, not once per Time Log open: pings
// arrive late from a phone that was offline, so the answer can genuinely change
// tomorrow, but it cannot change three times while somebody scrolls.
function _geoVerifySeen(){
  try{
    const raw=JSON.parse(localStorage.getItem('zp3_geo_recon_seen')||'{}');
    const day=(typeof _ctDateStr==='function')?_ctDateStr(new Date()):todayKey();
    if(raw&&raw.day===day&&Array.isArray(raw.ids))return{day,ids:new Set(raw.ids)};
    return{day,ids:new Set()};
  }catch(_e){return{day:'',ids:new Set()};}
}
function _geoVerifyMark(state){
  try{localStorage.setItem('zp3_geo_recon_seen',JSON.stringify({day:state.day,ids:Array.from(state.ids).slice(-500)}));}catch(_e){}
}
// Where a reconciled row CLAIMS the person was. A job row carries job_id; a
// client/place row carries only the name it was written with, resolved the same
// cache-only way the reconciler itself resolves one, so this never burns a live
// geocode. Null means we cannot tell, and an unresolvable claim is left alone.
async function _geoVerifyTarget(row){
  try{
    if(row.job_id!=null&&typeof jobs!=='undefined'&&Array.isArray(jobs)){
      const j=jobs.find(x=>x&&String(x.id)===String(row.job_id));
      if(j)return await _geoJobLatLng(j);
      return null;
    }
    const nm=String(row.dest_place||'').trim();
    if(!nm||typeof clients==='undefined'||!Array.isArray(clients))return null;
    const cl=clients.find(c=>c&&String(c.name||'').trim()===nm);
    if(!cl)return null;
    const hit=((typeof _nearbyGeoCache==='function')?_nearbyGeoCache():{})[cl.id];
    if(!hit||hit.lat==null)return null;
    return{lat:hit.lat,lng:hit.lon};
  }catch(_e){return null;}
}
async function _geoVerifyReconciled(){
  if(_geoVerifyBusy||!_supa||!_supaUser)return 0;
  _geoVerifyBusy=true;
  try{
    const cutoff=new Date(Date.now()-_GEO_VERIFY_DAYS*86400000).toISOString();
    const{data,error}=await _supa.from('job_time_entries')
      .select('id,employee_user_id,job_id,dest_place,source,client_key,arrived_at,departed_at').is('deleted_at',null)
      .eq('contractor_user_id',_geoCid()).gte('arrived_at',cutoff);
    if(error||!Array.isArray(data)||!data.length)return 0;
    const seen=_geoVerifySeen();
    const rows=data.filter(r=>r&&r.id!=null&&r.arrived_at&&r.departed_at&&
      /-reconciled$/.test(String(r.source||''))&&
      // Only rows this device is entitled to correct. An employee sees only
      // its own; the owner's rows carry the owner's id.
      String(r.employee_user_id||'')===String(_supaUser.id)&&
      !seen.ids.has(String(r.id)))
      .slice(0,_GEO_VERIFY_MAX_ROWS);
    if(!rows.length)return 0;
    const margin=_geoFenceFt()+_GEO_PARK_JOB_EXTRA_FT;
    let fixed=0;
    for(const r of rows){
      seen.ids.add(String(r.id));
      const t1=Date.parse(r.arrived_at)||0,t2=Date.parse(r.departed_at)||0;
      if(!(t1>0&&t2>t1))continue;
      const coord=await _geoVerifyTarget(r);
      if(!coord){_geoParkNote('recon-verify','no coords for '+(r.job_id||r.dest_place||r.id));continue;}
      const tape=await _geoReconPings(t1,t2);
      if(!tape)continue;                       // fetch failed: leave it alone
      const tr=_geoPingTrim(tape,t1,t2,coord,margin);
      if(!tr.checked||!tr.left)continue;       // no mid-window fixes, or all on site
      const kept=Math.max(0,Math.round((tr.t2-tr.t1)/60000));
      const was=Math.round((t2-t1)/60000);
      try{
        // Deleting is reserved for `gone`: EVERY mid-window fix somewhere
        // else, which is the flight case and nothing else. A merely short
        // survivor is trimmed, never dropped, because a sparse tape plus a
        // 5-minute floor is exactly how a real day got erased once already.
        if(tr.gone){
          await _tdSoftDelete('job_time_entries',r.id);
          _geoParkNote('recon-verify','dropped '+was+'m claim, all '+tr.seen+' mid-window fixes are elsewhere');
        }else if(tr.t2-tr.t1>=_GEO_RECON_MIN_GAP_MS){
          await _supa.from('job_time_entries').update({
            arrived_at:new Date(tr.t1).toISOString(),
            departed_at:new Date(tr.t2).toISOString(),minutes:kept
          }).eq('id',r.id);
          _geoParkNote('recon-verify','trimmed '+was+'m to '+kept+'m, '+tr.seen+' fixes');
        }else{
          _geoParkNote('recon-verify','left '+was+'m alone: trim would leave under the floor');
          continue;
        }
        fixed++;
      }catch(_e){}
    }
    _geoVerifyMark(seen);
    return fixed;
  }catch(_e){return 0;}
  finally{_geoVerifyBusy=false;}
}

// ── shop_time_entries dedup (owner audit, 2026-08-23) ────────────────────
// The twin-write race _geoTrackInit/_geoResumedOnce now block, and the
// mileage-anchored reconciler's overlap gap _geoDedupTimeEntries's
// sameTarget loosening (above) now closes, both had a job_time_entries-only
// blast radius. shop_time_entries never had ANY dedup coverage of its own:
// two rows for the same person overlapping by more than a few minutes are
// the same office dwell logged twice, same race, different table. The
// later-arriving of the pair is dropped.
// 90-day cutoff, matching _geoDedupTimeEntries above: wide enough to clear a
// pre-existing backlog, not just ongoing hygiene against a race close to
// real time.
// RLS note, same shape as _geoDedupTimeEntries above: an employee's device
// can SELECT only its own rows and holds no delete grant on shop_time_entries
// at all ("Contractor manages shop time" is contractor-only), so a drop
// found on an employee's phone fails its delete silently (caught below) and
// waits for the contractor's own device to run this sweep.
let _geoShopDedupBusy=false;
const _GEO_SHOP_DUP_OVERLAP_MS=240000; // 4 min: a real back-to-back handoff can drift a little
async function _geoDedupShopTimeEntries(){
  if(_geoShopDedupBusy||!_supa||!_supaUser)return 0;
  _geoShopDedupBusy=true;
  try{
    const cutoff=new Date(Date.now()-90*86400000).toISOString();
    const{data,error}=await _supa.from('shop_time_entries')
      .select('id,arrived_at,departed_at,employee_user_id').is('deleted_at',null)
      .eq('contractor_user_id',_geoCid()).gte('arrived_at',cutoff);
    if(error||!Array.isArray(data)||data.length<2)return 0;
    const rows=data.filter(r=>r&&r.id!=null&&r.arrived_at&&r.departed_at);
    const drop=new Set();
    const groups={};
    for(const r of rows){
      const k=String(r.employee_user_id||'');
      (groups[k]=groups[k]||[]).push(r);
    }
    for(const k in groups){
      const g=groups[k];
      for(let i=0;i<g.length;i++){
        if(drop.has(g[i].id))continue;
        for(let j=i+1;j<g.length;j++){
          if(drop.has(g[j].id))continue;
          const aS=Date.parse(g[i].arrived_at),aE=Date.parse(g[i].departed_at);
          const bS=Date.parse(g[j].arrived_at),bE=Date.parse(g[j].departed_at);
          const overlapMs=Math.min(aE,bE)-Math.max(aS,bS);
          if(overlapMs>_GEO_SHOP_DUP_OVERLAP_MS){
            drop.add(g[j].arrived_at>g[i].arrived_at?g[j].id:g[i].id);
          }
        }
      }
    }
    if(!drop.size)return 0;
    for(const id of drop){
      try{await _tdSoftDelete('shop_time_entries',id);}catch(_e){}
    }
    _geoParkNote('shop-dedup','dropped '+drop.size+' duplicate shop row(s)');
    return drop.size;
  }catch(_e){return 0;}
  finally{_geoShopDedupBusy=false;}
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
  //
  // TWIN-WRITE GUARD: this must run at most ONCE per page session. A second
  // _geoTrackInit() call (from a second _removeBootOverlay() firing, e.g. a
  // retry-recovery boot landing shortly after a timeout-fallback one already
  // did) used to restore the SAME persisted snapshot into live state again,
  // even while the first restore's ping handling had already moved that state
  // forward. The result was two independent drive/geofence chains for the
  // same real dwell, splitting the same window two different ways.
  _geoBindInteract();
  if(!_geoResumedOnce){
    _geoResumedOnce=true;
    _geoRestoreOpen();
    _geoDrainQueue();
    _geoPrunePings();
  }
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
// A second, always-reachable copy of the SAME panel under Settings → Cloud
// sync, next to Location access (owner report 2026-08-21: "where is the
// tracking diagnostic, don't see it, is it under Developer?", then "I can
// reach it, just don't see tracking diagnostic panel" once they found
// Developer, because that whole group is ALSO native-shell-gated above, and
// they were testing the plain UAT web link, not the TestFlight app). The
// Developer row needs is_dev in the database; that group needs the native
// shell; this copy needs neither, plain HTML with no display:none, so it is
// reachable on every platform and every account the moment this button
// exists in the page, index.html.
//
// SUPERSEDED 2026-08-25: that second copy (set-geo-diag-btn2) was REMOVED from
// Settings → Cloud sync by owner decision, made with the downside above stated
// back to him in full: "No, put it under the advanced developer tools section,
// it needs to be there." So the panel is once again reachable ONLY through the
// double-gated group unhidden right above, is_dev in the database AND the
// native shell, and is NOT reachable from the plain UAT web link. That is the
// intended state now, not an oversight. The 08-21 paragraph is kept for history
// so the reasoning is not lost, but do not re-add the Cloud sync copy citing it.
// e2e-geo-auto-mileage.spec.js asserts no Location diagnostics button survives
// anywhere under #setd-cloud, so a re-add fails CI (§7.1).
