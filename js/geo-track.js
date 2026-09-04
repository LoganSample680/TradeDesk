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
// A departure the motion tape clocked and no fence has confirmed yet.
// {arrivedAt, at, ts}. Written only when the fence agrees; dropped otherwise.
let _geoShopPendingClose=null;
// How long a pending departure waits for the fence to back it up. A real exit
// lands within a minute or two of pulling out (his 12:48:05 drive, 12:50:01
// exit). What this rejects is the fence that shows up hours later because a
// ping finally arrived from somewhere else entirely: his 17:48:59 departure
// was not "confirmed" by the 20:16:02 arrival at another customer, and a
// confirmation that late is not evidence of anything.
const _GEO_DEPART_CONFIRM_MS=15*60000;
// How wrong a recorded close has to be before the retro sweep touches it.
// Dry-run against the owner's real week, 2026-08-29: three rows would have
// been deleted whose driving edge landed SECONDS before their own close
// (19:18:04 against a 19:18 close, 09:15:18 against a 09:16 close). Those
// departures were captured correctly. There was nothing to correct, and the
// rule deleted the row regardless, because it asked "was this confirmed"
// without first asking "is it even wrong". Both 08-27 corrections clear this
// comfortably: 7.7 minutes on the midday dwell, 147 on the evening one.
const _GEO_DWELL_MIN_TRIM_MS=3*60000;
// A dwell this short, with nothing arriving into it and nothing leaving from
// it, is somebody waking up inside a fence they never left. Ten minutes is
// deliberately mean: it must never reach a real session at the home office,
// and the owner's week has nothing between 10 and 45 minutes for it to catch
// by accident. Five minutes of slack on the arrival side, because a drive row
// is stamped from the fence and the dwell from the ping that noticed.
const _GEO_STIR_MAX_MS=10*60000;
const _GEO_STIR_ARRIVE_MS=5*60000;
function _geoConfirmShopDepart(nowMs){
  const p=_geoShopPendingClose;_geoShopPendingClose=null;
  if(!p)return false;
  if(nowMs-p.ts>_GEO_DEPART_CONFIRM_MS){
    _geoParkNote('shop-depart-dropped',Math.round((nowMs-p.ts)/60000)+'m late, unconfirmed');
    return false;
  }
  _geoCloseShopEntry(p.arrivedAt,p.at);
  return true;
}
let _geoDriveStartedAt=null;// ISO timestamp when a drive leg began (leaving any fence)
// The flip this leg was opened from, and therefore its key. Survives the boot
// alongside driveStartedAt, or a leg restored after a kill would be re-keyed
// off its clock and become a second row for the same drive.
let _geoLegFlipId=null;
// THE MOTION EDGE OWNS THE MOMENT, THE FENCE STILL OWNS THE EVENT.
// Set when CoreMotion reports foot -> automotive: the instant the truck
// actually pulled out. Held PENDING, never written on its own, because a
// phone in a pocket reads automotive from a ride in someone else's truck and
// a leg opened off that alone is a guess wearing a timestamp. The fence exit
// is what confirms a departure happened; this only supplies a better clock
// for it than "the first ping that noticed they were gone", which is several
// hundred feet and a minute or two late by construction. Exactly the bargain
// the shop dwell already strikes (see _geoShopPendingClose).
let _geoDrivePendingAt=null;
// The flip that set the mark above, so the leg it opens is keyed by the
// transition itself rather than by a timestamp anybody can round differently.
let _geoDrivePendingId=null;
// How stale a pending edge may be and still be believed. The fence normally
// fires within a minute or two of pulling out, so a quarter hour is generous;
// past it the phone has been driving, stopping and starting and the edge no
// longer describes THIS departure. Also what makes a bulk motion replay safe:
// a transition delivered days late is simply ignored here.
const _GEO_DRIVE_PENDING_MAX_MS=15*60*1000;
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
// ── THE ROUTE (owner ask 2026-09-01) ────────────────────────────────────────
// "so we can draw the route, then overlay that on a map and you get you're
// true mileage down to the exact route." The breadcrumb is kept per LEG and
// travels with the mileage row (rec.path), so the drawing is a property of the
// trip rather than a query against a ping table that is throttled to one row a
// minute and could never trace a road anyway.
//
// [lat, lng, ms] triples, 5 decimal places (about 1.1m, well under any GPS
// fix's own error) so the row stays small enough to sync like every other
// td_mileage record. A 45-minute leg at one point per 100ft of travel is
// roughly 1,600 points before the cap; the cap decimates rather than truncates
// so a long drive keeps its whole SHAPE instead of its first half.
let _geoDrivePath=[];
const _GEO_PATH_MAX=400;
// How far the origin fence may sit from the first fix of a drive and still be
// used to seed the route. A real exit confirms within a few hundred feet; a
// mile and a half is generous cover for a slow classifier or a missed ping,
// and anything past it is a stale origin that would draw a line across town.
const _GEO_PATH_SEED_MAX_FT=8000;
function _geoPathPush(lat,lng,ms){
  const r5=v=>Math.round(v*1e5)/1e5;
  _geoDrivePath.push([r5(lat),r5(lng),ms]);
  if(_geoDrivePath.length<=_GEO_PATH_MAX)return;
  // Halve by dropping every other INTERIOR point. Endpoints always survive, so
  // the leg still starts and ends where it really did, and the effective
  // spacing doubles instead of the tail being thrown away.
  const keep=[_geoDrivePath[0]];
  for(let i=1;i<_geoDrivePath.length-1;i+=2)keep.push(_geoDrivePath[i]);
  keep.push(_geoDrivePath[_geoDrivePath.length-1]);
  _geoDrivePath=keep;
}
// The banner survives a red light but clears a couple minutes after parking
// somewhere the fence machine doesn't recognize.
const _GEO_DRIVE_SHOW_MS=150000;
// The one visibility question the dashboard asks: tracking is running, a drive
// leg is open, and the truck moved at driving speed recently.
function _geoDriving(){
  const _tracking=_geoWatchId!=null||(typeof _geoNativeWatcherId!=='undefined'&&_geoNativeWatcherId!=null);
  return !!(_tracking&&_geoDriveStartedAt&&(Date.now()-_geoDriveMovingAt)<_GEO_DRIVE_SHOW_MS);
}
function _geoDriveReset(){_geoDriveMiles=0;_geoDriveSteps=0;_geoDriveLastFix=null;_geoDriveMph=0;_geoDriveMovingAt=0;_geoMphZeroRun=0;_geoMphHeldZero=false;_geoDriveHadPause=false;_geoDrivePath=[];}
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
// ── ONE FLIP, ONE ID (owner rule 2026-08-31) ────────────────────────────────
// `flipId` is minted once, in the plugin, at the CoreMotion transition that
// began this leg, and carried through the ping and the fence lookup to here.
// When it is present it IS the key, unchanged, on both writers.
//
// The fallback is the old derivation, and the reason it must stay is the whole
// reason the derivation was wrong: base36 of the start millisecond is COMPUTED,
// so two writers reading two of the four samples iOS emitted for one departure
// computed two different keys and wrote two rows. Rows already on the books
// carry those keys, and a phone on an older build sends no flipId at all, so
// the old shape has to keep working; it just stops being how new legs are
// identified.
function _geoLegKey(startedIso,flipId){
  if(flipId)return String(flipId);
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
  // ONE WRITER (owner 2026-09-02). Automatic time rows come from the day
  // deriver through geo_replace_day now. Every closer in this file that used
  // to enqueue its own row for a fence event still runs (it drives the
  // on-site card, the radio and the park regions) but its row goes nowhere:
  // two writers for one event is exactly what produced a 3h 43m row on top
  // of three others. Human rows are the exception and always land: a manual
  // clock-out (source manual) and a hand-corrected row (fixed-*).
  if(_GEO_DERIVER_WRITES&&(tbl==='job_time_entries'||tbl==='shop_time_entries')&&
     !(row&&(row.source==='manual'||/^fixed-/.test(String(row.client_key||''))))){
    try{_geoParkNote('derive-gate',tbl+'/'+((row&&row.source)||'?'));}catch(_e){}
    return;
  }
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
        if(item.rpc){
          // A derived day. One call replaces the person's automatic rows for
          // that day in one transaction (supabase/migrations/20260906). A
          // REFUSAL (the set itself is wrong: an overlap, a bad window) is
          // not a transient and must not block the queue behind it: it is
          // dropped, said out loud, and the next derive produces a better one.
          ({error}=await _supa.rpc(item.rpc,item.args||{}));
          if(error&&/geo_replace_day:/.test(String(error.message||''))){
            console.error('geo derive refused: '+String(error.message));
            error=null;
          }
          // The function is not on this project yet (a phone ahead of the
          // migration). Also not a transient: it would sit at the head of the
          // queue and hold every manual row behind it. Dropped; the next flip
          // or boot derives the day again, and derives it identically.
          if(error&&/could not find the function|function .* does not exist|PGRST202/i.test(String(error.message||''))){
            console.warn('geo derive: geo_replace_day is not deployed yet, dropping the item');
            error=null;
          }
        }else
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
      // The table took the day: the screen now reads it back (7.3, 17).
      if(item.rpc&&item.args&&item.args.p_day){try{_geoDeriveSyncMileage(item.args.p_day);}catch(_e){}}
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
    // ── A CLIENT VISIT IS OPEN STATE TOO ──────────────────────────────────
    // It was in neither the guard nor the payload, so standing at a customer's
    // address with nothing else open did not just fail to save: it took the
    // `else` below and DELETED the snapshot. Come back after any relaunch and
    // the visit is gone from memory with no row ever written, so the on-site
    // hours are not late, they are lost.
    //
    // Owner, 2026-08-31: arrived at John Doe 07:58, force-quit and reopened at
    // 11:43, and the app had no idea he was standing on a job. That is also
    // why the open-visit anchor added the same day found nothing to anchor on:
    // it was reading a variable a relaunch had already cleared.
    if((_geoCurrentJob&&_geoArrivedAt)||(_geoWasInShop&&_geoShopArrivedAt)||
       (_geoCurrentClient&&_geoClientArrivedAt)||(_geoCurrentPlace&&_geoPlaceArrivedAt)||
       _geoDriveStartedAt){
      localStorage.setItem(_GEO_OPEN_KEY,JSON.stringify({
        job:_geoCurrentJob,arrivedAt:_geoArrivedAt,wasInShop:_geoWasInShop,
        shopArrivedAt:_geoShopArrivedAt,driveStartedAt:_geoDriveStartedAt,
        client:_geoCurrentClient,clientArrivedAt:_geoClientArrivedAt,
        place:_geoCurrentPlace,placeArrivedAt:_geoPlaceArrivedAt,
        // WHERE THE DRIVE STARTED, not just that one is open (owner report
        // 2026-08-09: "FBC to home didn't log", with every endpoint saved).
        // These were memory-only, so an app kill left a restored drive with
        // no origin, and _geoAutoMileage bails silently without one: the
        // arrival wrote drive TIME and no mileage row at all. Park mode makes
        // that the common case rather than the rare one, because it is
        // designed to let iOS kill the app while parked.
        legOrigin:_geoLegOrigin,lastFenceLoc:_geoLastFenceLoc,lastFenceAt:_geoLastFenceAt,
        drivePendingAt:_geoDrivePendingAt,drivePendingId:_geoDrivePendingId,
        // The open leg's identity. Without this a drive restored after a kill
        // is re-keyed from its clock and becomes a second row for one drive,
        // which is exactly the duplicate this id exists to make impossible.
        legFlipId:_geoLegFlipId,
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
        // The route so far. A WebView reload mid-drive (this app's own
        // version watchdog reloads on any mismatch) would otherwise throw away
        // everything driven before it and draw the second half of the trip as
        // the whole trip, which is worse than drawing nothing.
        drivePath:_geoDrivePath,
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
      // Same salvage a job and the shop already got. A visit that ran past
      // midnight is closed at the last verified on-site moment rather than
      // thrown away, or the hours vanish exactly as they did before this
      // state was persisted at all.
      if(s.client&&s.clientArrivedAt)_geoCloseClientEntry(s.client,s.clientArrivedAt,s.hiddenAt);
      if(s.place&&s.placeArrivedAt)_geoClosePlaceEntry(s.place,s.placeArrivedAt,s.hiddenAt);
      // Same salvage for a drive that was still IN PROGRESS (not at a job or the
      // shop) when the app died across midnight: previously this branch just
      // called _geoClearOpen() and the whole leg vanished, no time entry, no
      // trace. The destination is genuinely unknown (they never arrived before
      // the state was lost), so this claims no mileage/distance, only the
      // payroll-relevant TIME, dated to hiddenAt (the last moment they were
      // actually observed driving), same as the job/shop salvage above.
      if(s.driveStartedAt&&!s.job&&!s.wasInShop&&s.hiddenAt){
        const mins=Math.max(0,Math.round((Date.parse(s.hiddenAt)-Date.parse(s.driveStartedAt))/60000));
      }
      _geoClearOpen();return;
    }
    if(_geoCurrentJob||_geoArrivedAt)return; // live state wins, never clobber a running session
    _geoCurrentJob=s.job;_geoArrivedAt=s.arrivedAt;
    // Same "live state wins" rule, per fence kind: a session that has already
    // resolved where it is must never have a restored answer written over it.
    if(!_geoCurrentClient&&!_geoClientArrivedAt&&s.client&&s.clientArrivedAt){
      _geoCurrentClient=s.client;_geoClientArrivedAt=s.clientArrivedAt;
    }
    if(!_geoCurrentPlace&&!_geoPlaceArrivedAt&&s.place&&s.placeArrivedAt){
      _geoCurrentPlace=s.place;_geoPlaceArrivedAt=s.placeArrivedAt;
    }
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
    // Re-capped on restore, not trusted raw: this is localStorage, which any
    // other tab, a corrupt write, or an older build could have left in any
    // shape at all.
    if(Array.isArray(s.drivePath)){
      _geoDrivePath=s.drivePath.filter(p=>Array.isArray(p)&&p.length>=2&&isFinite(p[0])&&isFinite(p[1])).slice(-_GEO_PATH_MAX);
    }
    if(!_geoLegOrigin&&s.legOrigin)_geoLegOrigin=s.legOrigin;
    if(!_geoDrivePendingAt&&s.drivePendingAt)_geoDrivePendingAt=s.drivePendingAt;
    if(!_geoDrivePendingId&&s.drivePendingId)_geoDrivePendingId=s.drivePendingId;
    if(!_geoLegFlipId&&s.legFlipId)_geoLegFlipId=s.legFlipId;
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
  // A synthetic ping from a visit, fence or stale motion row is flagged
  // __tdNoTrack: it drives the fence machine but is not where the truck is.
  try{if(pos&&pos.coords&&!pos.__tdNoTrack)_geoFixLogPush(Number(pos.__tdTs||pos.timestamp)||Date.now(),pos.coords.latitude,pos.coords.longitude,pos.coords.accuracy);}catch(_e){}
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
  // ── THE OTHER HALF OF THE DRIVE CORRELATION (owner 2026-09-01) ────────────
  // "a automotive event and a gps ping or vice versa." This is the one funnel
  // every real fix passes through, whichever engine produced it, so it is the
  // only place the ping half can be registered once and only once.
  //
  // Two exclusions, both load-bearing. A visit report and a region wake carry
  // coordinates that are not a current position (see __tdNoTrack below), so
  // they are not a ping. And a fix this handler would refuse to measure with
  // is not good enough to spend the radio on either: _driveAccOk is computed
  // just below and reused rather than a second accuracy bar being invented.
  //
  // Cheap by construction: this only ever writes a timestamp unless a fresh
  // automotive flip is already sitting there waiting for it.
  // Third exclusion: a REPLAYED fix carries the moment it was taken (__tdTs),
  // and a buffer drained on next boot is full of them. Two stale halves inside
  // three minutes of each other would otherwise pair perfectly and turn the
  // radio up now for a drive that finished on Tuesday.
  if(!(pos&&pos.__tdNoTrack)&&acc>0&&acc<=_GEO_GAP_EXIT_MAX_ACC_M&&
     _geoEvFresh({ts:nowMs})){
    try{_geoDriveCorrelate('fix',nowMs,'ping');}catch(_e){}
  }
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
  // A VISIT REPORT IS NOT A POSITION, and neither is a region wake's stale
  // last-known fix. See the long note at the _noTrack flag in _geoTdEvent:
  // these three event types carry coordinates that describe somewhere the
  // truck WAS, delivered late, and letting them extend the tally is what
  // yanked the owner's drive home back to its origin and re-counted the way
  // forward. They still run the fence machine below; they just stop moving the
  // odometer and the route.
  const _tracks=!(pos&&pos.__tdNoTrack);
  if(_geoDriveStartedAt&&_tracks){
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
        _geoPathPush(here.lat,here.lng,nowMs);
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
      // The origin of the route, so a drawn leg starts where it started
      // instead of 100ft along.
      if(!_geoDrivePath.length)_geoPathPush(here.lat,here.lng,nowMs);
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
  // The tally deliberately SURVIVES leaving the fence, because the ping that
  // closes the visit is itself an outside ping and the closers run later in
  // that same ping. Clearing on sight would hand them a null.
  //
  // "The first ping outside" is what this used to wait for, and it was right
  // when it was written and wrong from 2026-08-20, when a place/client exit
  // started requiring the pending-then-confirming PAIR. From then on the place
  // closer ran on the SECOND outside ping, by which time `!_geoWasAtHome` had
  // already nulled the tally, so every home-office visit closed through the
  // place path silently lost its paperwork minutes. The shop path hid it for
  // nine days: the shop still closes on the first outside ping, so every test
  // in this file above ran green straight through the defect. The live flow
  // test on the self-hosted runner is what found it (2026-08-29: the Loading
  // row landed, the Office row did not exist).
  //
  // So the tally now lives as long as the VISIT does, which is the thing it
  // actually belongs to, rather than for a fixed number of pings. While a
  // place visit is still open (_geoPlaceArrivedAt is only cleared in section 4
  // below, AFTER the closers have run) it survives however many pings the exit
  // confirmation takes. A stale object can still never be inherited by a later
  // visit: the re-arm check below starts a fresh tally whenever the one it
  // finds has been read.
  const _atHome=_geoAtHomeOffice(here);
  if(_atHome){
    // .closed (set by the closer once it has read this dwell, see
    // _geoCloseShopEntry/_geoClosePlaceEntry) means the visit this object
    // belonged to is already billed: a fresh arrival must start its own tally
    // at zero rather than keep piling active-minutes onto a total some OTHER,
    // already-closed visit already claimed. Without this check, returning
    // home before the second away-ping (below) ever got a chance to null the
    // object handed the new, unrelated dwell the old one's leftover minutes.
    if(!_geoHomeDwell||_geoHomeDwell.closed)_geoHomeDwell={activeMs:0,lastSampleMs:nowMs,spans:[]};
    else{
      if(_geoAppActive(nowMs)){
        // The credited stretch, kept as a SPAN as well as added to the total
        // (2026-08-29). The total alone says how long they worked but not
        // WHEN, and the load-out window has to be subtracted out of the office
        // minutes so a minute walking to the truck with the app open is never
        // billed twice. Two numbers cannot be intersected; two timelines can.
        const _span=Math.min(nowMs-_geoHomeDwell.lastSampleMs,_GEO_IDLE_MS);
        _geoHomeDwell.activeMs+=_span;
        _geoAddSpan(_geoHomeDwell.spans||(_geoHomeDwell.spans=[]),nowMs-_span,nowMs);
      }
      _geoHomeDwell.lastSampleMs=nowMs;
    }
  }else if(!_geoWasAtHome&&!_geoPlaceArrivedAt)_geoHomeDwell=null;  // away, and nothing left to close
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
    if(inShop){_geoShopArrivedAt=_geoParkBackdate||nowIsoEarly;_geoShopPendingClose=null;}
    else{
      // A hidden gap since arrival: close at the last VERIFIED moment rather
      // than claiming shop time nobody observed.
      // nowIsoEarly rather than nothing: live they are the same moment, and a
      // replayed TdGeo buffer fix closes the dwell at the moment the departure
      // actually happened rather than at the replay moment.
      if(_geoShopArrivedAt)_geoCloseShopEntry(_geoShopArrivedAt,_geoGapHiddenAt||nowIsoEarly);
      // THE FENCE HAS NOW AGREED THEY LEFT. If the motion tape called the
      // departure first, this is the corroboration it was waiting on, and the
      // row is written to the tape's clock rather than to this later moment:
      // the fence is the witness, the tape is the watch.
      else if(_geoShopPendingClose)_geoConfirmShopDepart(nowMs);
      _geoShopArrivedAt=null;
    }
    _geoWasInShop=inShop;
  }else if(inShop&&!_geoShopArrivedAt&&_geoShopPendingClose&&nowMs-_geoShopPendingClose.ts>_GEO_DEPART_CONFIRM_MS){
    // Still inside, long past the window, and the fence never called it a
    // departure: the tape was wrong (a ride in someone else's truck, a phone
    // on a dashboard in the yard). Drop the pending row and treat this ping as
    // a fresh arrival, or a second load-out after a false alarm is invisible.
    _geoShopPendingClose=null;_geoShopArrivedAt=nowIsoEarly;
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
      else if(prev.k==='place'&&_geoPlaceArrivedAt)_wroteClose=_geoClosePlaceEntry(_geoCurrentPlace,_geoPlaceArrivedAt,nowIso,
        await _geoHomeTape(_geoCurrentPlace,_geoPlaceArrivedAt,nowIso));
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
      // The wheels stopped and the fence agreed: nothing left is worth Best
      // accuracy. (The at-rest motion edge normally beats this by minutes;
      // this is the backstop for a phone whose coprocessor said nothing.)
      _geoDriveWindowClose('leg-closed');
    }else{
      // Out on the road. Open at NOW rather than at the last on-site fix: we can
      // SEE they are gone, so the first moment we know they had left is the
      // conservative start.
      if(!_geoDriveStartedAt){
        // ── THE TAPE SETS THE CLOCK, THE FENCE CONFIRMS THE EVENT ───────────
        // This used to open at nowIso on the reasoning that the first moment
        // we can SEE they are gone is the conservative start. It is also, by
        // construction, several hundred feet and a minute or two late: a
        // geofence cannot fire until a line that far away has been crossed,
        // and driving starts at the parking space. Measured on the owner's
        // own account, the fix taken at the fence sat a MILE from where the
        // drive began on five of ten real departures.
        //
        // The motion coprocessor knew at the parking space. So when a pending
        // foot -> automotive edge is sitting there, is EARLIER than now, and
        // is recent enough to still describe this departure, it is the start.
        // Never later than now, never older than the cap: a clock may only be
        // corrected backwards toward the truth, never forwards past it.
        const _pend=Date.parse(_geoDrivePendingAt||'')||0;
        const _useTape=_pend>0&&_pend<nowMs&&(nowMs-_pend)<=_GEO_DRIVE_PENDING_MAX_MS;
        if(_useTape)_geoParkNote('drive-open-tape',Math.round((nowMs-_pend)/1000)+'s earlier');
        _geoDriveStartedAt=_useTape?new Date(_pend).toISOString():nowIso;
        // Only the flip we actually SPENT names this leg. A mark refused for
        // being stale or in the future takes its id with it, or the leg would
        // be labelled with a transition it was not opened from.
        _geoLegFlipId=_useTape?_geoDrivePendingId:null;
        _geoDrivePendingAt=null;_geoDrivePendingId=null;
        _geoLegOrigin=_geoLastFenceLoc;
        _geoDriveMiles=0;_geoDriveSteps=0;
        _geoDriveHadPause=false;
        // THE ROUTE STARTS AT THE DOOR, NOT WHERE THE EXIT HAPPENED TO CONFIRM.
        //
        // The comment here used to claim exactly that and the code did not do
        // it: it pushed `here`, which is wherever the truck was when the fence
        // exit was CONFIRMED. Owner, 2026-09-01, looking at a drawn route:
        // "it wasn't starting at the door though". Measured on that leg
        // (Shop -> John Doe, 12:52 CDT): the automotive flip landed 1,336 ft
        // out, the regionExit fix 1,524 ft out, and the drawn line began
        // there. The whole 0.3 mi the owner was missing is that first quarter
        // mile plus a 360 ft tail at the far end.
        //
        // The start TIME was already backdated to the motion flip a few lines
        // up (_useTape), so the row claimed a start 69 seconds before its own
        // first point. Time was corrected; geometry was not. This corrects the
        // geometry to match, from _geoLegOrigin, which is the fence we just
        // left and is assigned on the line above.
        //
        // Guarded by distance: a stale origin from a fence we left hours ago
        // must never draw a line across town, so beyond the cap we fall back
        // to the old behaviour of simply starting where we are.
        const _seedOK=_geoLegOrigin&&_geoLegOrigin.lat!=null&&_geoLegOrigin.lng!=null&&
                      _geoDistFt(here,_geoLegOrigin)<=_GEO_PATH_SEED_MAX_FT;
        _geoDrivePath=[];
        if(_seedOK){
          _geoPathPush(_geoLegOrigin.lat,_geoLegOrigin.lng,_useTape?_pend:nowMs);
          // The odometer gets the same segment, or the drawn line would be
          // longer than the number printed under it. Same 100ft floor every
          // other hop answers to.
          const _seedFt=_geoDistFt(here,_geoLegOrigin);
          if(_seedFt>_GEO_DRIVE_ACCUM_FT){_geoDriveMiles+=_seedFt/5280;_geoDriveSteps++;}
        }
        _geoPathPush(here.lat,here.lng,nowMs);
        _geoDriveLastFix={lat:here.lat,lng:here.lng,atMs:nowMs,acc};
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
// time is the app's day convention everywhere (_bizDateStr, js/finance.js);
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
  return (typeof _bizDateStr==='function')
    ? _bizDateStr(a)!==_bizDateStr(d)
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
// _bizDateStr rather than a hand-kept offset, so CST/CDT is handled by the same
// Intl call the rest of the app trusts for the day convention.
function _bizMidnightAfter(ms){
  const day=(d)=>(typeof _bizDateStr==='function')?_bizDateStr(d):dateKey(d);
  const d0=day(new Date(ms));
  let lo=ms,hi=ms+36*3600000;
  if(day(new Date(hi))===d0)return 0;
  while(hi-lo>1){
    const mid=lo+Math.floor((hi-lo)/2);
    if(day(new Date(mid))===d0)lo=mid;else hi=mid;
  }
  return hi;
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
  // NOT A ROW (owner 2026-09-02): an unresolved dwell writes nothing, the
  // manual clock covers it, and js/geo-derive.js is the only thing that
  // decides what the day was. Kept as the seam the stop machine calls so its
  // state handling above is untouched.
  try{_geoParkNote('stop','not a row: the deriver decides');}catch(_e){}
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
// Time inside a known place's fence (a supply house, a home office). Paid
// work, but overhead rather than labor on any one job, so it is grouped with
// drive time.
//
// PREFIX, not an exact match (2026-08-29). A home office now writes
// 'place-load' and 'place-office' instead of one undifferentiated 'place'
// row, and an exact match would have let both fall through every money view's
// else branch and be counted as ON-SITE JOB LABOR. That is precisely the bug
// _geoDriveEntry's own comment records for 'drive-personal', which is why
// _geoIsDriveSource is /^drive/ and this is now /^place/: one predicate owns
// what a source MEANS, and a new variant joins the family by being named into
// it rather than by every caller learning a new string.
function _geoIsPlaceSource(s){return /^place/.test(String(s||''));}
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
// ── Span arithmetic for the home-office split ───────────────────────────────
// Everything here works on [startMs,endMs] pairs held sorted and disjoint.
function _geoAddSpan(spans,a,b){
  if(!Array.isArray(spans)||!(b>a))return spans;
  const last=spans[spans.length-1];
  // Back-to-back samples are ONE stretch of work. Without this the office row
  // would be one row per ping.
  if(last&&a<=last[1])last[1]=Math.max(last[1],b);
  else spans.push([a,b]);
  return spans;
}
// `spans` minus one window. A cut through the middle of a span splits it.
function _geoCutSpan(spans,cut){
  if(!cut)return (spans||[]).slice().map(x=>[x[0],x[1]]);
  const c0=cut[0],c1=cut[1],out=[];
  (spans||[]).forEach(x=>{
    const a=x[0],b=x[1];
    if(c1<=a||c0>=b){out.push([a,b]);return;}      // no overlap
    if(c0>a)out.push([a,Math.min(c0,b)]);
    if(c1<b)out.push([Math.max(c1,a),b]);
  });
  return out.filter(x=>x[1]>x[0]);
}
function _geoSpanMs(spans){return (spans||[]).reduce((n,x)=>n+(x[1]-x[0]),0);}
// ── Truck load-out: the walk that runs into the drive ───────────────────────
// Owner rule (2026-08-29): "home office should call the last motion event from
// start time to end time before a drive, that's truck loading time."
//
// THE ANCHOR IS THE COPROCESSOR'S OWN 'driving' TRANSITION, NOT THE GEOFENCE
// EXIT, and that distinction is the whole reason this works. The fence trips
// 350 to 600 feet down the road: on Jack Schonfeldt's own 8/28 data that lands
// 20 to 60 seconds after the truck actually rolled, and longer on a slow
// street. Measured back from the fence, a real load-out looks late and gets
// thrown away. Measured back from the moment CoreMotion says 'driving', the
// walk that ends there IS the load-out, with no tolerance left to tune: a dog
// walk an hour earlier is never the last walk before a driving transition.
//
// TdGeoPlugin maps CMMotionActivity.automotive to exactly this string
// (native/td-geo/ios/Plugin/TdGeoPlugin.swift), so nothing native changes and
// no iOS build is involved (CLAUDE.md 3.2).
//
// Only stillness may sit between the walk and the drive, and only briefly:
// that gap is buckling in and backing off the drive, not a second activity.
// Five minutes is the same slack _GEO_SHOP_CHAIN_MS and _GEO_LEAVE_SLACK_MS
// already use for "these two events belong to each other."
const _GEO_LOAD_STILL_MS=5*60000;
// The fallback anchor, used only when the tape offers no driving transition
// at all (an older shell, motion refused, a hop too short for the chip to
// call it). The departure is then the only anchor there is, and the owner's
// original rule applies: motion stops being reported the second a drive
// starts, so only a walk ending about a minute before the fence can be the
// load-out. Deliberately tighter than the anchored path, because the evidence
// is weaker.
const _GEO_LOAD_EXIT_MS=60000;
// The [startMs,endMs] that was loading, or null when nothing on the tape says
// a load-out happened. Never invents time: both edges come off the tape.
// A drive drops to 'still' at a long light or a rail crossing and resumes.
// Two minutes of stillness inside a drive is that; more is an actual stop.
const _GEO_DRIVE_STITCH_MS=120000;
// ── The day, as the coprocessor saw it (owner spec 2026-08-29) ─────────────
// "when core motion sees the last motion before core motion sees a drive
// that's loading up time... when you land in the geofence... the time that
// address is from when core motion says this guy's moving to this guy is now
// driving, that's the time on site."
//
// So the MOTION TAPE owns every boundary and the geofence only ever answers
// WHERE. That is the inversion: fence edges are a circle drawn around a pin
// and they trip when the truck crosses a line hundreds of feet from the
// driveway, which is exactly the eight minutes that went missing from Jack's
// 8/28 (a fence-stamped visit read 2h07m where the truck was actually there
// 2h14m). A motion edge is the truck itself starting and stopping.
//
// Pure and synchronous on purpose: no plugin, no network, no clock. It takes
// a tape and a window and returns segments, which is what makes it testable
// against a fixture and safe to run over seven days of history.
//
// Returns [{kind:'load'|'drive'|'onsite', a, b}] in time order, where
//   load   = the walk that runs straight into a departure (loading the truck)
//   drive  = a driving span
//   onsite = everything between one drive ending and the next beginning,
//            still time included, because a man standing at a bench working
//            is on site.
function _geoTapeSegments(tape,s,e){
  const out=[];
  if(!Array.isArray(tape)||!tape.length||!(e>s))return out;
  const t=tape.filter(x=>x&&typeof x.ts==='number'&&x.kind).slice().sort((a,b)=>a.ts-b.ts);
  if(!t.length)return out;
  // Each transition as a span running to the next, clipped to the window. The
  // tape is fetched with a lead-in (_geoMotionTape asks 2 minutes early), so
  // the state in force AT s is whatever transition last preceded it.
  const spans=[];
  for(let i=0;i<t.length;i++){
    const a=t[i].ts,b=(i+1<t.length)?t[i+1].ts:e;
    const lo=Math.max(a,s),hi=Math.min(b,e);
    if(hi>lo)spans.push({kind:t[i].kind,a:lo,b:hi});
  }
  if(!spans.length)return out;
  const isDrive=k=>k==='driving'||k==='automotive';
  // Merge adjacent driving spans: the coprocessor drops to 'still' at a long
  // light and comes back, and that is one drive, not three.
  const drives=[];
  for(const sp of spans){
    if(!isDrive(sp.kind))continue;
    const last=drives[drives.length-1];
    if(last&&sp.a-last.b<=_GEO_DRIVE_STITCH_MS)last.b=sp.b;
    else drives.push({a:sp.a,b:sp.b});
  }
  // The load-out in front of each departure: the last walking span that runs
  // into the drive rather than merely happening earlier in the day. Slack
  // allows the still moment spent sitting in the cab before pulling out.
  const loads=[];
  for(const d of drives){
    let w=null;
    for(const sp of spans){
      if(sp.kind!=='onFoot'&&sp.kind!=='walking'&&sp.kind!=='running')continue;
      if(sp.a>=d.a)break;
      w=sp;
    }
    if(!w)continue;
    const b=Math.min(w.b,d.a);
    // RUNS TO THE WHEELS TURNING, not to the end of the walking span. The
    // still moment between putting the last thing in the truck and pulling out
    // is somebody sitting in the cab, and it used to belong to NOTHING: the
    // on-site span was cut at the walk's start, the load ended at the walk's
    // end, and the minutes in between appeared in no segment at all.
    //
    // Owner, 2026-08-31, reading his own timeline: "job site says 12:22, then
    // drive says 12:26? Drive should say 12:22." That four-minute hole is
    // exactly this. The slack below was already the tolerance for it; it was
    // being tolerated without ever being attributed. The segments are supposed
    // to tile the day, and a day with holes in it is the thing this whole
    // model exists to stop.
    if(b>w.a&&d.a-b<=_GEO_LOAD_STILL_MS)loads.push({a:w.a,b:d.a});
  }
  // On site: the space between drives, with any load-out at its tail carved
  // out so the same minute is never both loading and standing on the job.
  const gaps=[];
  let cursor=s;
  for(const d of drives){ if(d.a>cursor)gaps.push({a:cursor,b:d.a}); cursor=Math.max(cursor,d.b); }
  if(e>cursor)gaps.push({a:cursor,b:e});
  for(const g of gaps){
    const l=loads.find(x=>x.a>=g.a&&x.b<=g.b+1);
    if(l&&l.a>g.a)out.push({kind:'onsite',a:g.a,b:l.a});
    else if(!l&&g.b>g.a)out.push({kind:'onsite',a:g.a,b:g.b});
  }
  for(const l of loads)out.push({kind:'load',a:l.a,b:l.b});
  for(const d of drives)out.push({kind:'drive',a:d.a,b:d.b});
  return out.filter(x=>x.b>x.a).sort((a,b)=>a.a-b.a);
}
// Loading is loading only at YOUR OWN place (owner 2026-08-29: "loading is its
// own line item"). The identical motion shape at a customer's, walking to the
// truck before pulling out, is the tail of the job: packing up IS the work,
// and his spec says on-site runs from "this guy's moving" straight through to
// "this guy is now driving".
//
// _geoTapeSegments cannot make that call, and must not: it holds a tape, not a
// map. This is the caller's half, applied once the fence has named the place.
// Pass ownPlace=false and the load-out folds back into the on-site span it was
// carved out of.
// The places the contractor owns, by name. Loading is its own line item only
// at one of these; the identical walk at a customer's is the tail of the job.
// Shared so _geoRetimeToTapeSweep and _geoTapeRegradeSweep can never answer
// that question differently for the same row.
function _geoOwnPlaceNames(){
  try{
    return new Set(((typeof getPlaces==='function')?(getPlaces()||[]):[])
      .filter(p=>p&&p.name).map(p=>String(p.name)));
  }catch(_e){return new Set();}
}
function _geoFoldLoadIntoOnsite(segs,ownPlace){
  if(ownPlace||!Array.isArray(segs)||!segs.length)return Array.isArray(segs)?segs.slice():[];
  const out=segs.filter(x=>x&&x.kind!=='load').map(x=>({kind:x.kind,a:x.a,b:x.b}));
  for(const l of segs.filter(x=>x&&x.kind==='load')){
    // The on-site span this load was cut from ends exactly where it begins.
    const host=out.find(x=>x.kind==='onsite'&&x.b===l.a);
    if(host)host.b=l.b;
    else out.push({kind:'onsite',a:l.a,b:l.b});
  }
  return out.filter(x=>x.b>x.a).sort((a,b)=>a.a-b.a);
}
function _geoHomeLoadWindow(tape,s,e){
  if(!Array.isArray(tape)||!tape.length||!(e>s))return null;
  const t=tape.filter(x=>x&&typeof x.ts==='number'&&x.kind).slice().sort((a,b)=>a.ts-b.ts);
  if(!t.length)return null;
  // The drive out: the LAST driving transition that begins inside the visit.
  // Last, not first, because a day can leave and come back.
  let dTs=null;
  for(let i=0;i<t.length;i++){if(t[i].kind==='driving'&&t[i].ts>=s&&t[i].ts<=e)dTs=t[i].ts;}
  const anchor=(dTs!=null)?dTs:e;
  const slack=(dTs!=null)?_GEO_LOAD_STILL_MS:_GEO_LOAD_EXIT_MS;
  // The last walk that STARTS before that anchor.
  let w=-1;
  for(let i=0;i<t.length;i++){
    if(t[i].kind!=='onFoot')continue;
    if(t[i].ts>=anchor)break;
    w=i;
  }
  if(w<0)return null;
  const a=Math.max(t[w].ts,s);
  // Ends at the next transition (a 'still' in the cab, or the drive itself),
  // clipped to the anchor so cab minutes are never billed as loading.
  const b=Math.min((w+1<t.length)?t[w+1].ts:e,anchor,e);
  if(!(b>a))return null;
  // A walk that did not run into the drive was some other errand.
  if(anchor-b>slack)return null;
  return [a,b];
}
// One home-office visit, split into what it actually was.
// Returns {load:[s,e]|null, office:[[s,e],...]}.
function _geoHomeSplit(tape,s,e,dwell){
  const load=_geoHomeLoadWindow(tape,s,e);
  // Active-app spans are the paperwork, with the load-out window taken back
  // out so a minute is never paid twice. In practice they barely overlap
  // (_geoAppActive needs the screen up, the tape needs a gait), but payroll is
  // not the place to lean on "in practice."
  const office=_geoCutSpan((dwell&&dwell.spans)||[],load)
    .map(x=>[Math.max(x[0],s),Math.min(x[1],e)])
    .filter(x=>x[1]>x[0]);
  return {load:load,office:office};
}
// The motion tape for a home-office visit, null for every other place. Gated
// on the kind so a supply-house exit never spends a plugin round trip on a
// tape nothing is going to read.
async function _geoHomeTape(placeId,arrivedAt,departedIso){
  try{
    const pl=(typeof getPlaces==='function')?(getPlaces()||[]).find(p=>p&&String(p.id)===String(placeId)):null;
    if(!pl||pl.kind!=='home_office')return null;
    return await _geoMotionTape(Date.parse(arrivedAt)||0,Date.parse(departedIso||'')||0);
  }catch(_e){return null;}
}
// A home-office visit is never one number. It is up to TWO rows, the truck
// load-out and the paperwork, each labelled for what it was, and the rest of
// the visit is a man living in his own house.
function _geoCloseHomeEntry(placeId,pl,arrivedAt,departed,tape){
  const s=Date.parse(arrivedAt)||0,e=Date.parse(departed)||0;
  const dwell=_geoHomeDwell;
  // Marked read, not nulled: see the matching comment in _geoCloseShopEntry.
  if(_geoHomeDwell)_geoHomeDwell.closed=true;
  if(!(e>s)||!_supaUser)return false;
  const split=_geoHomeSplit(tape,s,e,dwell);
  const name=(pl&&pl.name)||null;
  let wrote=false;
  const put=(src,a,b,mins)=>{
    if(!(mins>=2))return;                 // a pass-through, not a stop
    const iso=new Date(a).toISOString();
    wrote=true;
  };
  if(split.load)put('place-load',split.load[0],split.load[1],Math.floor((split.load[1]-split.load[0])/60000));
  // ONE office row per visit, bracketing the paperwork, carrying the minutes
  // actually worked rather than the bracket's width: a man who writes quotes
  // for twenty minutes across a three-hour evening worked twenty minutes, and
  // both facts belong on the row. Same shape the shop row has always had.
  if(split.office.length){
    put('place-office',split.office[0][0],split.office[split.office.length-1][1],
        Math.floor(_geoSpanMs(split.office)/60000));
  }
  return wrote;
}
// Time at a known place, closed on departure. Bounded by a real fence at both
// ends, so unlike an off-job stop this is verified work time.
// Returns whether a row was actually enqueued, same contract as
// _geoCloseEntry (see its comment): _geoOnPing's flicker-undo reads this.
function _geoClosePlaceEntry(placeId,arrivedAt,departedIso,tape){
  if(!arrivedAt)return false;
  const departed=departedIso||new Date().toISOString();
  // Element-guarded for the same reason as _geoJobLatLng below: a hole in
  // the array must cost this row its place NAME, never throw out of a visit
  // close and lose the whole entry.
  const pl=(typeof getPlaces==='function')?(getPlaces()||[]).find(p=>p&&String(p.id)===String(placeId)):null;
  // WHICH RULE APPLIES IS DECIDED BY THE PLACE, NOT BY WHAT IS IN MEMORY
  // (2026-08-29). This read `_geoHomeDwell ? activeMs : wall-clock`, so a home
  // office whose sampler had never run billed the DWELL, silently, and there
  // was nothing on the row to say which rule had produced it. Not a
  // hypothetical: Jack Schonfeldt's 8/27 row is 7:56pm to 5:23am, 567 minutes
  // of sleep, written by that line. The place's own kind is the fact. An
  // absent tally means nothing was observed, which bills zero, not a night.
  if(pl&&pl.kind==='home_office')return _geoCloseHomeEntry(placeId,pl,arrivedAt,departed,tape);
  const mins=Math.max(0,Math.round((Date.parse(departed)-Date.parse(arrivedAt))/60000));
  if(mins<2)return false;        // a pass-through, not a stop
  if(!_supaUser)return false;
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
  const out=[];
  const baseM=_geoFenceFt()*0.3048+60;
  // ── ONE ADDRESS, ONE REGION ──────────────────────────────────────────────
  // Owner, 2026-08-31: "why do we need two separate events laid out when we
  // only want one?" Exactly right, and the dedupe that was supposed to prevent
  // it missed by a ten-thousandth of a degree.
  //
  // It keyed on Number(lat).toFixed(4), about eleven metres, and his own house
  // slipped straight through: the home_office place sits at -95.71127 and the
  // shop place at -95.71121, which round to -95.7113 and -95.7112. Two regions
  // armed at one address, so iOS fires every crossing TWICE, three
  // milliseconds apart (his 07:52:14 exit arrived as both 'fence' and
  // place-1787436272279016), and whichever landed first decided the row. It
  // also spends one of the eighteen slots iOS grants on a duplicate.
  //
  // A distance test, not a rounded string, and 250 ft because that is the
  // scale of "the same address": two buildings closer than that are one fence
  // as far as a truck is concerned.
  const MERGE_FT=250;
  const isNamed=id=>/^(place-|client-|job-)/.test(String(id));
  const push=(id,lat,lng,radius)=>{
    if(out.length>=18||lat==null||lng==null)return;
    const here={lat:Number(lat),lng:Number(lng)};
    const dupe=out.findIndex(p=>_geoDistFt({lat:p.lat,lng:p.lng},here)<=MERGE_FT);
    if(dupe>=0){
      // THE NAMED ONE WINS. The generic tiers are pushed first ('fence' for
      // the kerb, 'shop' for the business address), so a plain first-wins
      // dedupe would arm the anonymous id and drop the record that carries the
      // address. regionName maps 'fence' to the literal string "Stop", which
      // is the whole reason his rows could not say where a drive began.
      if(!isNamed(id)||isNamed(out[dupe].id))return;
      out[dupe]={id:String(id),lat:here.lat,lng:here.lng,radius:radius||out[dupe].radius||baseM};
      return;
    }
    out.push({id:String(id),lat:here.lat,lng:here.lng,radius:radius||baseM});
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
  // SUPPLY HOUSES ARE THEIR OWN TIER (owner 2026-08-27: "parts run would work
  // as long as there is a saved place listed as supply house, that's what I
  // want"). A parts run is the one errand that happens WHILE parked with the
  // live GPS shut down, so the only thing that can catch it is a fence at the
  // counter. In the pooled tier below, a supply house thirty miles gone loses
  // every slot to nearer places and the run logs nothing: no arrival, no
  // deductible miles, no time off the job. Arming them ahead of the pool is
  // what makes the parts run work at all.
  //
  // RESERVED, NOT UNLIMITED. An account with twenty saved suppliers would
  // otherwise eat all 18 slots and starve the client home two blocks away,
  // which is the exact starvation the pooled tier below exists to prevent.
  // Six is the reservation: more than any contractor's real rotation of
  // regular suppliers, small enough that jobs, clients and the kerb keep
  // room. Distance-ordered among themselves, so the six armed are the ones
  // actually reachable, and any leftovers still compete in the pool below.
  const _SUPPLY_SLOTS=6;
  try{
    const sup=(typeof places!=='undefined'&&Array.isArray(places)?places:[])
      .filter(pl=>pl&&pl.kind==='supply'&&pl.lat!=null&&pl.lon!=null)
      .map(pl=>({id:'place-'+pl.id,lat:pl.lat,lng:pl.lon,
                 radius:pl.fenceFt?pl.fenceFt*0.3048+60:undefined}));
    const a0=spot||_geoLastFenceLoc||null;
    if(a0&&a0.lat!=null){
      sup.forEach(p=>{p._ft=_geoDistFt({lat:p.lat,lng:p.lng},{lat:a0.lat,lng:a0.lng});});
      sup.sort((a,b)=>a._ft-b._ft);
    }
    sup.slice(0,_SUPPLY_SLOTS).forEach(p=>push(p.id,p.lat,p.lng,p.radius));
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
// errand is the deriver's to fold (js/geo-derive.js rule 6).
function _geoSettleStopLeg(a,nowIso){
  if(!a||a.legClosed||!_geoDriveStartedAt)return false;
  const ms=Math.max(0,Date.parse(a.lastAt||nowIso)-Date.parse(a.at));
  const stopLoc=_geoStopLoc(a,ms);
  // ── A STOP IS NEVER AN ORIGIN WHILE A REAL FENCE IS KNOWN ────────────────
  // Root cause of every `from=Stop` row on the owner's account (2026-08-31):
  // this recorded `_geoLegOrigin||null`, and _geoLegOrigin is null whenever a
  // drive begins with no live fence state (a cold boot, a restored snapshot,
  // the first leg after _geoReset). The stop then became the leg origin with
  // prevOrigin null, and _geoCollapseDetours below can only walk back through
  // a stop that HAS a prevOrigin, so the anonymous pin was the origin forever
  // after and every subsequent row read "Stop -> somewhere".
  //
  // _geoLastFenceLoc is the real answer and it was sitting right here: the
  // last fence the truck was actually inside, persisted across boots with the
  // rest of the geo snapshot. Falling back to it means the collapse chain
  // always has a real endpoint to measure the direct miles from, which is the
  // whole CPA rule this block exists to serve.
  stopLoc.prevOrigin=_geoLegOrigin||_geoLastFenceLoc||null;
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
  // Same fallback as _geoSettleStopLeg above, and for the same reason: without
  // it a drive that began with no live fence state strands an anonymous pin as
  // the leg origin and every later row reads "Stop -> somewhere".
  stopLoc.prevOrigin=_geoLegOrigin||_geoLastFenceLoc||null;
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
  const legKey=_geoLegKey(driveStartedAt,_geoLegFlipId);
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
  const obsMiles=(!stale&&!_geoDriveHadPause&&_geoDriveSteps>=8&&_geoDriveMiles>0.3)?Math.round(_geoDriveMiles*10)/10:null;
  // THE ROUTE THIS LEG ACTUALLY TOOK. Captured here, before the next leg
  // resets the tally, and on the same terms as obsMiles: a stale leg's
  // breadcrumb is fiction (nobody was watching), and two points are a straight
  // line, not a route. Nothing downstream reads it as distance yet, see the
  // precedence note in _geoAutoMileage: it is drawn, not counted.
  const obsPath=(!stale&&_geoDrivePath.length>=2)?_geoDrivePath.slice():null;
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
  // A leg just closed, which is exactly the evidence reconciliation reads:
  // schedule a debounced pass (no-op unless a live watcher is running).
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
// WHERE THE CLOCK WAS TAPPED (owner 2026-09-04: "does clock in and clock out
// button surface a gps ping where it happened? it should").
//
// It did not. clockIn (js/jobs.js) wrote a timeEntries row with a timestamp
// and nothing else, and clockOut closed the same row with a timestamp. A
// clock was a bare pair of times with no idea where it happened, which is
// exactly the person who needs it most: the one with no fences and no saved
// addresses, whose clock is the only thing that knows the day ran at all.
//
// One live read per tap, posted as its own geo_event. Four things come out of
// it: the day gets a real start and end coordinate with no fence anywhere, an
// address becomes offerable ("you clock in here most days"), the clock and the
// fence corroborate each other when both exist, and the deriver gains two
// trustworthy positions (they are LIVE reads, which is the whole test
// _GEO_FRESH_FIX_TYPES applies).
//
// THE PING IS NOT AN ADDRESS, and that distinction is the point. The clock
// stays inert: no name, no dest_place, nothing the deriver or the reader can
// steer on. It says "grab everything between these two times" and no more.
// A clock that names a place is what produced Jack's 3 September, where a
// two-field edit claimed he sat at his own house for nine hours.
//
// Fire and forget, always. A clock must never fail, stall, or wait because
// location was slow, denied or off.
function _geoClockPing(kind){
  try{
    if(!navigator.geolocation)return;
    if(!window._supa||!window._supaUser)return;
    if(typeof supaEnabled!=='function'||!supaEnabled())return;
    const type=kind==='out'?'clock-out':'clock-in';
    _geoCanStamp().then(ok=>{
      if(!ok)return;
      navigator.geolocation.getCurrentPosition(pos=>{
        try{
          const ev={type,ts:Date.now(),
            lat:+pos.coords.latitude.toFixed(6),lng:+pos.coords.longitude.toFixed(6)};
          const devId=(typeof _initDeviceId==='function')?_initDeviceId():'';
          // The same edge function the plugin flushes to, on the JS side's own
          // JWT (ingest-geo reads Authorization first, the device key second).
          // Client inserts into geo_events are denied by RLS on purpose.
          _supa.auth.getSession().then(({data})=>{
            const tok=data&&data.session&&data.session.access_token;
            if(!tok)return;
            fetch(_SUPA_DIRECT_URL+'/functions/v1/ingest-geo',{
              method:'POST',
              headers:{'Content-Type':'application/json',Authorization:'Bearer '+tok},
              body:JSON.stringify({device_id:devId,events:[ev]})
            }).catch(()=>{});
          }).catch(()=>{});
        }catch(_e){}
      },()=>{},{enableHighAccuracy:true,maximumAge:0,timeout:10000});
    }).catch(()=>{});
  }catch(_e){}
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
// Apple's four, in the order they escalate, which is also the order the roster
// ranks them in. 'unknown' is deliberately NOT here: the plugin passes it
// through for a state a future iOS invents, and a word nothing can interpret
// is the same as no answer.
const _GEO_THERMAL_WORDS=['nominal','fair','serious','critical'];
let _geoTherm=null;
function _geoBattPeek(){return _geoBatt;}
function _geoThermPeek(){return _geoTherm;}
async function _geoRefreshBattery(){
  try{
    const Td=(typeof _geoTdPlugin==='function')?_geoTdPlugin():null;
    if(!Td||typeof Td.stats!=='function'){_geoBatt=null;_geoTherm=null;return null;}
    const st=await Td.stats();
    // -1 is the plugin's own "could not read", and must stay distinguishable
    // from a genuinely flat phone.
    const lvl=(st&&+st.batteryLevel>=0)?+st.batteryLevel:null;
    // Thermal rides the SAME stats() call, and is kept independent of the
    // battery read on purpose: a shell can answer one and not the other, and a
    // phone that is hot with an unreadable battery is still worth reporting.
    // Only Apple's four words are accepted; anything else is treated as not
    // reported rather than written through, so the column can never fill up
    // with a string nothing knows how to render.
    const _th=String((st&&st.thermalState)||'');
    _geoTherm=(_GEO_THERMAL_WORDS.indexOf(_th)>=0)?_th:null;
    _geoBatt=(lvl==null)?null:{level:lvl,charging:!!(st&&st.charging)};
    return _geoBatt;
  }catch(_e){_geoBatt=null;_geoTherm=null;return null;}
}
function _geoReportPermission(state){
  if(!_supa||!_supaUser)return;
  const now=new Date().toISOString();
  let devId=null,devLabel=null,devHw=null,devOs=null;
  try{
    devId=(typeof _initDeviceId==='function')?_initDeviceId():null;
    const d=(typeof S!=='undefined'&&S.devices||[]).find(x=>x&&x.id===devId);
    devLabel=(d&&(d.name||d.label))||((typeof _deviceLabel==='function')?_deviceLabel():null);
    // WHICH HANDSET, exactly (owner 2026-08-27). device_label is
    // UIDevice.current.model, which iOS collapses to the bare string "iPhone"
    // for every iPhone ever made, so two phones behaving differently were
    // indistinguishable from the server: Jack's uploaded nothing in the
    // background while the owner's uploaded in seconds, same build, and there
    // was no way to ask what either one WAS. The native TdDevice plugin has
    // read the real sysctl identifier and OS version since the Pro Max layout
    // bug; it lands in S.devices and stopped there. Carried onto the row now,
    // so the next divergence names itself.
    devHw=(d&&d.hwId)||null;
    devOs=(d&&d.osVersion)||null;
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
        // Nullable on purpose: a shell too old to answer, or a browser, must
        // read as "not reported" rather than claim a model it does not know.
        hw_id:devHw||null,
        os_version:devOs||null,
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
        // A phone iOS is throttling reports a healthy battery percentage right
        // up until the fixes start going missing, which is exactly the shape of
        // failure the roster exists to name. null when the shell cannot answer:
        // not knowing and being cool are different answers.
        thermal_state:_geoTherm||null,
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
let _geoMotionBurstAt=0;
// 90s, not the old 180s. Two boundaries can legitimately land inside three
// minutes (park, walk in, realise you left something, drive off), and the old
// throttle ate the second one, which is the edge that closes the segment.
const _GEO_MOTION_BURST_GAP_MS=90000;
// The last motion state THIS session saw, so the edge (still->onFoot,
// onFoot->automotive) is derivable without native help. Reset with the rest
// of the fence state, never carried across an account switch.
let _geoLastMotionKind='';
// How far outside a fence-stamped row the regrade will look for the real
// boundary, and how far it must disagree before a row is worth rewriting.
// 20 minutes covers a fence tripping early on approach and late on the way
// out; 90 seconds is below the noise floor of the coprocessor itself.
const _GEO_REGRADE_PAD_MS=20*60000;
const _GEO_REGRADE_MIN_MS=90000;        // one motion-triggered burst per 3 min
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
    return isNaN(d.getTime())?raw:((typeof _bizStamp==='function')?_bizStamp(d):raw);
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
// ── THE DRIVE WINDOW: dense GPS only while a drive is actually happening ────
//
// Owner, 2026-09-01, and this is the architecture, not a paraphrase of it:
// "when core motion fires a automotive event and a gps ping or vice versa that
// should fire the continuous drive tracking, then the 30 minute cron job keeps
// confirming and checking the location, when automotive goes back to cycling or
// walking that fire another ping which shuts off the continuous gps."
//
// THREE PARTS, AND THE FIRST ONE IS THE STRICT ONE.
//
// 1. OPENING IS A CORRELATION OF TWO SIGNALS, IN EITHER ORDER. A CoreMotion
//    automotive transition on its own is NOT enough, and that is deliberate:
//    the coprocessor reads automotive from a ride in somebody else's truck,
//    from a bus, and from a phone jostling on a bench, and a bare flip with no
//    position to go with it is exactly the case that must not burn the radio.
//    A GPS ping on its own is not enough either, since the app takes fixes all
//    day for weather and fences. One of each, within _GEO_DRIVE_PAIR_MS of the
//    other, is a drive.
//
//    Order genuinely does not matter, and both orders are the common case.
//    Motion first: the coprocessor needs roughly a minute of sustained
//    movement before it will call automotive at anything but low confidence,
//    but it still beats a geofence, which cannot fire until a line several
//    hundred feet away has been crossed. Ping first: a significant-change or
//    fence wake often lands while the flip is still being decided.
//
// 2. THE 30-MINUTE CRON IS THE CONFIRMER, and it already exists: the
//    geo-ping-cron workflow -> push-geo-ping -> a silent APNs push -> TdGeo
//    records a push-ping carrying the current fix. No second timer is built
//    here (§7.3). While a window is open, each push-ping asks one question:
//    has this phone actually moved since the last confirmation? Moved means
//    the drive is real, so the window is re-asserted and the plugin's safety
//    cap is pushed out. Not moved means the drive ended without anybody
//    saying so, and the confirmer is what notices.
//
// 3. CLOSING IS A MOTION EVENT, AND CYCLING COUNTS AS ONE. Walking, running,
//    cycling or stationary all shut the continuous GPS off. Cycling is called
//    out because the two other places in this codebase that classify motion do
//    NOT agree about it and cannot both be right here:
//      - ingest-geo (supabase/functions/ingest-geo/index.ts:99) puts cycling in
//        AUTO_KINDS, i.e. vehicular, alongside automotive and driving.
//      - _mileTapeHadPause (js/mileage.js) treats cycling as MOVING ON FOOT,
//        on the observation that CoreMotion reads walking around a truck with a
//        phone in your pocket as cycling.
//    The owner named cycling as a stop condition, and for the radio that is
//    the safe direction to be wrong in either way: if it really is a bicycle
//    there are no business miles to trace, and if it is really a walk around
//    the yard the window had to close anyway. The server's disagreement is
//    NOT changed from here; it decides which legs open, which is a far wider
//    blast radius than the radio, and it is flagged rather than quietly
//    rewritten.
//
// EVERY DECISION IN THIS BLOCK IS JS (CLAUDE.md 3.2). The plugin knows how to
// turn the receiver up and how to give up on its own after maxMs; the pairing
// window, the confirmation interval, the movement threshold and the whole
// classification live here and stay tunable through a UAT roll.
//
// WHY ANY OF IT MATTERS. On the owner's 5:07pm drive home the app got SEVEN
// fixes in fourteen minutes: gaps of 15s, 146s, 282s, 119s, 15s and 167s.
// Straight lines between points that far apart cut every curve, so two legs on
// a 3.2 mile route measured 2.3 and 3.1; and one bad point in a sparse set has
// nothing to average it out, so the same drive logged 4.8.
let _geoDriveWinAt=0;        // ms the window was opened (0 = closed)
let _geoDriveWinWhy='';      // what opened it, for the journal
let _geoDriveWinAskedAt=0;   // last bridge call, so a stream of events is one ask
let _geoDriveCorrMotionAt=0; // ms of an unpaired fresh automotive transition
let _geoDriveCorrFixAt=0;    // ms of an unpaired fresh GPS ping
let _geoDriveConfirmFix=null;// {lat,lng} position at the last 30-minute confirmation
// How far apart the two halves of the correlation may be. Three minutes covers
// both orders with room: the coprocessor's own declaration lag is under a
// minute, and a fence exit lands one to two minutes behind the parking space.
// Short enough that a walk past a parked truck at 10:00 and a passenger ride
// at 10:30 can never pair with each other.
const _GEO_DRIVE_PAIR_MS=3*60000;
// The NATIVE cap. Deliberately generous against a real drive and still far
// short of a night: an open window re-asserts itself off its own fixes and off
// the 30-minute confirmation long before this, so this only ever fires when
// nothing is confirming anything, and then it costs 45 minutes of radio
// instead of eight hours.
const _GEO_DRIVE_WIN_CAP_MS=45*60000;
// How often JS re-asserts, which is what refreshes that cap. Comfortably
// inside both the cap and the 30-minute confirmation.
const _GEO_DRIVE_WIN_REASSERT_MS=5*60000;
// Movement the 30-minute confirmer requires to call the drive still real.
// 1,000ft in half an hour is 0.4mph; no drive is that slow and no parked truck
// is that fast, so there is no honest reading of this that is ambiguous.
const _GEO_DRIVE_CONFIRM_FT=1000;
// 30m: see the same constant's justification in TdGeoPlugin.swift. GPS is 1Hz,
// so below ~27m at highway speed the filter stops being the limiter.
const _GEO_DRIVE_SAMPLE_M=30;
// How long a drive's breadcrumbs may ride together in ONE upload. The radio is
// already on for the whole window; what got the owner's phone hot on 2026-09-01
// was the UPLOADS, one POST per fix because a fix every ~2s never coalesced
// inside a 1.5s debounce (127 fixes, 127 live uploads, six minutes, 3% of the
// battery). 20s turns that into about six. Nothing a person watches gets
// slower: a fence crossing, a motion edge or an app-state change still flushes
// on the old 1.5s and takes the waiting breadcrumbs with it (TdGeoPlugin
// scheduleFlush, where an earlier deadline supersedes a later one). The number
// lives here, not in Swift, so it stays tunable through a UAT roll (3.2).
const _GEO_DRIVE_FLUSH_MS=20000;
// WHICH RECEIVER MODE the drive window runs, and the second half of the same
// battery answer (owner 2026-09-01: "how do we prevent the spike on continuous
// gps, life 360 doesnt kill a phone with heat").
//
// It does not, and this is most of why: nothing that tracks a phone all day
// asks iOS for kCLLocationAccuracyBest for the length of a drive. Best means
// "the best fix this hardware can physically produce" and holds the GPS chip
// in continuous high-power mode; the owner's 12:22 drive logged fixes claiming
// TWO METRES of accuracy, which is a precision no road route can use and
// nothing in this app reads. Ten metres is narrower than a traffic lane, so
// every turn, every stop and every mile still lands exactly where it did, and
// iOS is free to duty-cycle the receiver instead of pinning it on.
//
// 'hundred' exists for a future low-power mode and is deliberately NOT the
// default: at 100m the route starts cutting corners on city blocks, which is
// the thing 12.2's mileage accuracy work exists to prevent.
const _GEO_DRIVE_ACCURACY='ten';
// Is this event describing something that is happening NOW? The buffer replays
// history, the coprocessor backfills days of it, and neither is a reason to
// turn the receiver up. One number, one meaning, used by every opener.
const _GEO_EV_FRESH_MS=5*60000;
function _geoEvFresh(ev){
  const t=Number(ev&&ev.ts);
  if(!isFinite(t)||t<=0)return false;
  const d=Date.now()-t;
  return d>=-60000&&d<=_GEO_EV_FRESH_MS;   // a minute of clock skew forgiven
}
// ONE vocabulary for the radio's purposes. See the cycling note above: this
// deliberately differs from the server's AUTO_KINDS, and the difference is
// documented rather than accidental.
function _geoKindDrives(k){const s=String(k||'');return s==='automotive'||s==='driving';}
function _geoKindRests(k){
  const s=String(k||'');
  return s==='walking'||s==='running'||s==='onFoot'||s==='still'||s==='stationary'||s==='cycling';
}
function _geoDriveWindowOn(){return _geoDriveWinAt>0;}
// The correlation, from either side. `half` is 'motion' or 'fix'; whichever
// arrives second finds the first still waiting and opens the window.
function _geoDriveCorrelate(half,atMs,why){
  const now=Number(atMs)||Date.now();
  if(half==='motion')_geoDriveCorrMotionAt=now; else _geoDriveCorrFixAt=now;
  if(_geoDriveWinAt){_geoDriveWindowOpen(why||half);return true;}   // already open: re-assert
  const m=_geoDriveCorrMotionAt,f=_geoDriveCorrFixAt;
  if(!m||!f)return false;
  if(Math.abs(m-f)>_GEO_DRIVE_PAIR_MS)return false;
  // Neither half is spendable twice: without this a single automotive flip
  // would pair with every fix for the rest of the shift and the window could
  // never be genuinely closed by anything.
  _geoDriveCorrMotionAt=0;_geoDriveCorrFixAt=0;
  return _geoDriveWindowOpen('motion+fix'+(why?' '+why:''));
}
// ── THE TAPE SAYS DRIVING NOW (owner 2026-09-02, his 12:02 departure) ─────
// The flip to automotive lands on a sleeping phone only when something else
// wakes it, and by then the live motion stream has nothing new to say: the
// state did not change after the wake, so CoreMotion never calls back, and
// the correlation's motion half is never armed. The replay uploads the flip
// to the server and stops there. The 12:04 fence exit then armed the fix
// half against nothing, and the truck drove to the next fence with the
// radio off and no card on the dashboard.
//
// The coprocessor's history is the same fact from the other side: if its
// latest transition is automotive, with no foot transition after it, the
// phone is in a moving truck RIGHT NOW, and "now" is the motion half. Runs
// at boot and on every return to the foreground. Bounded: a drive that
// started more than half an hour ago is the passenger-or-forgotten case the
// window cap already closes, not a reason to spend radio.
// THE TAPE IS THE PRIMARY DEPARTURE SIGNAL (owner 2026-09-03).
//
// CoreMotion gives the same fact through two doors. The LIVE stream
// (startActivityUpdates) reports "automotive" and is the only real-time
// source, but it waits for confidence: on the owner's own 16:08 departure it
// did not speak until 16:08:57. The HISTORY query (motionSince) reports the
// same flip as "driving" and already had it at 16:08:06, fifty-one seconds
// earlier and with the truer timestamp.
//
// The deriver already reads the history, so the LEG starts at the right
// instant either way. What the gap costs is the POSITION: the fix attached to
// the departure is taken most of a minute into the drive rather than at the
// curb, and that fix is what decides which fence was departed from.
//
// So the history is polled while the app is alive and no drive window is
// open, and whichever door reports first opens the window. The live flip
// remains the backup, unchanged, for every moment the JS is not running.
//
// Honest limit: iOS suspends the WebView in the background, so this poll only
// covers the app being on screen or briefly awake. That IS the case the owner
// hit, and the existing wake-driven calls (app-active, fence-exit) already
// cover the rest.
const _GEO_TAPE_POLL_MS=15000;
// How long after a drive window opens the failsafe second fix is taken: long
// enough for the dense window to have spun the radio up, short enough that the
// truck is still near the curb it left.
const _GEO_DRIVE_CONFIRM_MS=8000;
let _geoTapePollT=null;
function _geoTapePollStart(){
  if(_geoTapePollT)return;
  try{
    _geoTapePollT=setInterval(()=>{
      try{
        // Nothing to find while a window is already open, and the check
        // itself returns early on that, but skip the bridge call entirely.
        if(_geoDriveWinAt)return;
        if(typeof document!=='undefined'&&document.hidden)return;
        _geoTapeDriveCheck('poll');
      }catch(_e){}
    },_GEO_TAPE_POLL_MS);
  }catch(_e){}
}
function _geoTapePollStop(){
  try{if(_geoTapePollT){clearInterval(_geoTapePollT);_geoTapePollT=null;}}catch(_e){}
}

const _GEO_TAPE_DRIVE_MAX_MS=30*60000;
function _geoTapeSaysDriving(tape,nowMs){
  const now=Number(nowMs)||Date.now();
  const t=(Array.isArray(tape)?tape:[]).filter(x=>x&&typeof x.ts==='number'&&x.kind&&x.ts<=now+60000).sort((a,b)=>a.ts-b.ts);
  if(!t.length)return null;
  const last=t[t.length-1];
  const k=String(last.kind);
  if(!(k==='automotive'||k==='driving'))return null;
  if(now-last.ts>_GEO_TAPE_DRIVE_MAX_MS)return null;
  return last.ts;
}
async function _geoTapeDriveCheck(why){
  try{
    if(_geoDriveWinAt)return false;
    const tape=await _geoDeriveTape(Date.now()-_GEO_TAPE_DRIVE_MAX_MS-60000);
    const since=_geoTapeSaysDriving(tape,Date.now());
    if(!since)return false;
    _geoParkNote('tape-driving',String(why||'')+' since '+new Date(since).toISOString().slice(11,19));
    // The flip's moment is what the leg will start from (the deriver reads
    // it from the same history); the radio's moment is now.
    if(!_geoDrivePendingAt)_geoDrivePendingAt=new Date(since).toISOString();
    return _geoDriveCorrelate('motion',Date.now(),'tape-now'+(why?' '+why:''));
  }catch(_e){return false;}
}
function _geoDriveWindowOpen(why){
  const Td=_geoTdPlugin();
  if(!Td||typeof Td.setSampling!=='function')return false;   // shell predates build 44
  const now=Date.now();
  // Idempotent, and throttled: every re-assert is a bridge call plus a
  // UserDefaults write, and a dense window delivers a fix every second or two.
  if(_geoDriveWinAt&&now-_geoDriveWinAskedAt<_GEO_DRIVE_WIN_REASSERT_MS)return true;
  const first=!_geoDriveWinAt;
  _geoDriveWinAskedAt=now;
  if(first){_geoDriveWinAt=now;_geoDriveWinWhy=String(why||'');_geoDriveConfirmFix=null;}
  try{Promise.resolve(Td.setSampling({mode:'drive',maxMs:_GEO_DRIVE_WIN_CAP_MS,distanceFilter:_GEO_DRIVE_SAMPLE_M,flushMs:_GEO_DRIVE_FLUSH_MS,accuracy:_GEO_DRIVE_ACCURACY})).catch(()=>{});}catch(_e){}
  _geoParkNote(first?'drive-window-on':'drive-window-hold',String(why||''));
  // The island shows the drive from the first second of the window, not from
  // the first fix that moves the tally (js/live-activity.js).
  if(first){try{if(typeof _liveActDrive==='function')_liveActDrive();}catch(_e){}}
  // The truck moved: a day the phone thought had ended did not (js/day-end.js).
  if(first){try{if(typeof _dayEndOnDrive==='function')_dayEndOnDrive();}catch(_e){}}
  // THE FAILSAFE SECOND FIX (owner 2026-09-03: "it should also fire a second
  // GPS ping, good failsafe"). The first fix at a departure is whatever the
  // radio had a moment ago, which after a stretch of coarse sampling can be
  // the last known rather than where the truck actually is. A second one a
  // few seconds later, once the dense window has spun the radio up, gives the
  // departure a fix that was actually measured. Cheap: one extra reading per
  // drive, not per ping, and only on the window's FIRST open.
  if(first){
    setTimeout(()=>{
      try{
        if(!_geoDriveWinAt)return;   // window already closed: nothing to confirm
        if(navigator.geolocation)navigator.geolocation.getCurrentPosition(_geoOnPing,()=>{},{enableHighAccuracy:true,maximumAge:0,timeout:10000});
      }catch(_e){}
    },_GEO_DRIVE_CONFIRM_MS);
  }
  return true;
}
function _geoDriveWindowClose(why){
  // The correlation state goes with the window. A stale unpaired half left
  // sitting here would re-open the window against the next unrelated fix.
  _geoDriveCorrMotionAt=0;_geoDriveCorrFixAt=0;_geoDriveConfirmFix=null;
  if(!_geoDriveWinAt)return false;
  _geoDriveWinAt=0;_geoDriveWinWhy='';_geoDriveWinAskedAt=0;
  const Td=_geoTdPlugin();
  try{if(Td&&typeof Td.setSampling==='function')Promise.resolve(Td.setSampling({mode:'coarse',reason:String(why||'js')})).catch(()=>{});}catch(_e){}
  _geoParkNote('drive-window-off',String(why||''));
  try{if(typeof _liveActDrive==='function')_liveActDrive();}catch(_e){}
  return true;
}
// ── The 30-minute confirmation (owner 2026-09-01) ───────────────────────────
// Driven by the push-ping the EXISTING geo-ping cron already delivers, never a
// timer of its own. Two jobs, and the second is the one nobody else does: keep
// a real drive's window alive past the plugin's safety cap, and notice a window
// that should have closed and nothing closed.
function _geoDriveConfirm(ev){
  if(!_geoDriveWinAt)return null;
  const has=typeof ev.lat==='number'&&typeof ev.lng==='number';
  if(!has){
    // No position to judge by. Re-assert rather than close: the phone answered
    // the push, so the process is alive and a drive may well still be running.
    // The plugin's cap is what bounds this, exactly as designed.
    _geoDriveWindowOpen('confirm-nofix');
    return 'nofix';
  }
  const here={lat:ev.lat,lng:ev.lng};
  const prev=_geoDriveConfirmFix;
  _geoDriveConfirmFix=here;
  if(!prev){_geoDriveWindowOpen('confirm-first');return 'first';}
  const ft=_geoDistFt(here,prev);
  if(ft>=_GEO_DRIVE_CONFIRM_FT){_geoDriveWindowOpen('confirm-moved');return 'moved';}
  // Half an hour, under a thousand feet. Whatever this is, it is not a drive.
  _geoDriveWindowClose('confirm-idle');
  return 'idle';
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
    // keepalive:false is the whole answer to "why is the blue arrow up when
    // TradeDesk backgrounds" (owner 2026-09-01). The beat used to hold a
    // standing 3km background location session purely to keep this process
    // resident, and iOS pins the status-bar indicator for ANY background
    // location session however coarse, so the arrow was on for every waking
    // minute of a shift.
    //
    // Whether that session bought any residency is not established: on
    // 2026-08-31 he backgrounded a phone mid-shift and delivery stopped dead
    // (the backgrounding row itself took 1028 seconds to arrive), but nothing
    // proves the beat was armed at that minute. What IS settled is that the
    // liveness has a cheaper owner: the 30-minute silent push already wakes a
    // backgrounded app and records a fix, and it is the same push that
    // confirms the drive window above.
    //
    // Passed EXPLICITLY rather than relying on the plugin's default, because
    // this is the decision and it belongs in JS (§3.2): flipping it to true is
    // one word and a UAT roll if drives start being missed, never a rebuild.
    // What still wakes a dead app is unchanged and is not this: region
    // monitoring, significant-location-change and visit monitoring, all armed
    // by startEvents, all of which relaunch a force-quit app.
    Promise.resolve(Td.startHeartbeat({intervalMs:30*60000,ttlMs:12*3600000,keepalive:false})).catch(()=>{});
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
  // Parking is the definition of not driving. Whatever the motion tape did or
  // did not say, the window closes here or the radio stays up through the
  // whole park, which is the standing-arrow state this change exists to end.
  _geoDriveWindowClose('park');
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
      // Parked is when the phone goes to sleep, and asleep is when CoreMotion
      // cannot reach it (owner 2026-09-02: the 12:02 departure, flip on the
      // tape, nothing on the phone for seven minutes). The iOS 17 stream
      // pauses itself while still and relaunches the app the moment the
      // truck moves; the first fix it hands back is the ping half of the
      // drive pair. Held only while parked: stopAll on the park exit drops
      // it. Older shells resolve supported:false and change nothing.
      _geoWakeOnMoveArm(Td);
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
// The decision lives here, not in Swift (3.2): one flag, flipped by a UAT
// roll, turns the wake-on-movement stream off again if the indicator it
// holds while parked is not worth the instant departure.
const _GEO_WAKE_ON_MOVE=true;
function _geoWakeOnMoveArm(Td){
  try{
    if(!_GEO_WAKE_ON_MOVE||!Td||typeof Td.setWakeOnMove!=='function')return false;
    Promise.resolve(Td.setWakeOnMove({on:true})).then((r)=>{
      _geoParkNote('wake-on-move',(r&&r.supported===false)?'unsupported':((r&&r.on)?'on':'off'));
    },(err)=>{_geoParkNote('wake-on-move-fail',(err&&(err.message||err.code))||err);});
    return true;
  }catch(_e){return false;}
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
      // The handset itself. "iPhone" is what iOS says about every iPhone ever
      // made, so the lab said nothing useful about WHICH phone it was reading.
      (function(){
        let d=null;
        try{
          const id=(typeof _initDeviceId==='function')?_initDeviceId():null;
          d=(typeof S!=='undefined'&&S.devices||[]).find(x=>x&&x.id===id)||null;
        }catch(_e){}
        const hw=(d&&d.hwId)||'';
        const os=(d&&d.osVersion)||'';
        if(!hw&&!os)return '';
        // The identifier raw AND its marketing name when we know it, never the
        // name alone: an unmapped model must still be readable and reportable.
        const nice=(typeof _tdModelName==='function')?_tdModelName(hw):'';
        return row('Handset',nice||hw||'unknown',(nice&&hw?hw+' · ':'')+(os?'iOS '+os:''));
      })()+
      row('Tracker watcher',_geoNativeWatcherId!=null?'running':'off')+
      // ── Push, the half this panel was missing ──────────────────────────
      // Owner 2026-08-27: location read perfect on every row here while
      // device_tokens was empty account-wide, and nothing on any screen could
      // say why. A permission lab that covers location and motion but not the
      // notification grant or the device token cannot diagnose the one thing
      // that was actually broken. Filled asynchronously (both reads are
      // promises) by _geoPermLabPush, called right after this paints.
      row('Notifications','checking…')+
      row('Device token','checking…')+
      (function(){
        let e=null;try{e=JSON.parse(localStorage.getItem('zp3_push_err')||'null');}catch(_e){}
        // Apple's own rejection string, kept by js/push.js. This is the line
        // that names the cause when a token never arrives.
        return e&&e.msg?row('Last APNs error',String(e.msg).slice(0,90),_timeAgo?_timeAgo(e.at):''):'';
      })()+
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
    _geoPermAct('push','Register for push','_geoPermLabPushReg()',false,
      'Asks iOS for the notification grant and then registers with Apple for a device token. '+
      'The token is what lets the server reach this phone at all: the 30-minute wake-up ping, dispatch alerts, everything sent FROM the server. '+
      'Without one the phone can only ever report in when iOS happens to wake it. If Apple refuses, the reason appears above as Last APNs error.')+
    _geoPermAct('reset','Reset our local state','_geoPermLabReset()',false,
      'Clears OUR records only: the consent flag, the OS-denied flag and the granted marker. '+
      'iOS authorization is untouched and cannot be touched from here. Use it to re-run the first-run code path without reinstalling. It will NOT bring the system dialog back.')+
    '<button class="btn" style="width:100%;margin-top:14px;padding:12px" onclick="document.getElementById(\'_geo-perm-ov\').remove()">Close</button>';
  ov.appendChild(m);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  _geoPermLabPush();
}
// The two push reads are promises, so the panel paints "checking…" and this
// fills them in. Both are read straight off the device and the server, the
// same honesty rule the rest of the panel states at the top.
async function _geoPermLabPush(){
  const set=(label,val,note)=>{
    const ov=document.getElementById('_geo-perm-ov');if(!ov)return;
    const rows=ov.querySelectorAll('#_geo-perm-state > div');
    rows.forEach(r=>{
      const k=r.firstElementChild,v=r.lastElementChild;
      if(!k||!v||k.textContent!==label)return;
      v.innerHTML=escHtml(String(val))+(note?'<div style="font-weight:400;color:var(--text3);font-size:11px">'+escHtml(note)+'</div>':'');
    });
  };
  try{
    const st=(typeof pushStatus==='function')?await pushStatus():'unavailable';
    set('Notifications',st);
  }catch(_e){set('Notifications','error');}
  // A token in localStorage means Apple issued one to THIS install. A row in
  // device_tokens means the server can actually reach it. They can disagree,
  // and which one is missing says which half is broken, so both are shown.
  let local='';
  try{local=localStorage.getItem('zp3_push_token')||'';}catch(_e){}
  if(!local){set('Device token','none on this phone','Apple never issued one');return;}
  const short=local.slice(0,8)+'…';
  try{
    if(typeof _supa==='undefined'||!_supa||!_supaUser){set('Device token',short,'on phone; not signed in to check server');return;}
    const{data,error}=await _supa.from('device_tokens').select('token').eq('token',local).is('invalid_at',null).limit(1);
    if(error){set('Device token',short,'on phone; server check failed');return;}
    set('Device token',short,(data&&data.length)?'saved on the server':'on phone but NOT saved to the server');
  }catch(_e){set('Device token',short,'on phone; server check failed');}
}
// Reproduce the registration on demand and say what came back, rather than
// leaving the answer in a console nobody can read.
async function _geoPermLabPushReg(){
  const say=document.getElementById('_geo-perm-say');
  if(say)say.textContent='Asking iOS, then Apple…';
  try{localStorage.removeItem('zp3_push_err');}catch(_e){}
  let ok=false;
  try{ok=(typeof pushEnable==='function')?await pushEnable():false;}catch(_e){ok=false;}
  // Apple answers the registration asynchronously on the token listener, so
  // give it a moment before reading the result back.
  await new Promise(r=>setTimeout(r,2500));
  let err=null;try{err=JSON.parse(localStorage.getItem('zp3_push_err')||'null');}catch(_e){}
  let tok='';try{tok=localStorage.getItem('zp3_push_token')||'';}catch(_e){}
  if(say){
    say.textContent=err?('Apple refused: '+String(err.msg).slice(0,80))
      :(tok?'Token received':(ok?'Granted, still waiting on Apple':'Not granted'));
  }
  _geoPermLabPush();
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
  ['ask','reread','settings','reset','push'].forEach(k=>{
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
  // The plugin's own record of the drive window opening and closing (its
  // safety cap fires without asking us, which is the entire point of it). It
  // carries no position and must never touch the fence machine; it exists so
  // the journal and the server tape can both show when the radio was up, and
  // so JS learns about a cap it did not ask for.
  if(ev.type==='sampling'){
    if(ev.mode!=='drive'&&_geoDriveWinAt){_geoDriveWinAt=0;_geoDriveWinWhy='';_geoDriveWinAskedAt=0;}
    if(!replay)_geoParkNote('sampling',String(ev.mode||'')+(ev.reason?' ('+ev.reason+')':''));
    return;
  }
  // Lifecycle rows (app-active/background/terminate/relaunch) and the cron's
  // push-ping are liveness bookkeeping, exactly like the heartbeat above:
  // they exist for the server record and must never reach the fence machine,
  // where a fixless or 3km-cached event could false-exit a fence.
  if(ev.type==='push-ping'||/^app-/.test(String(ev.type||''))){
    if(!replay)_geoParkNote(String(ev.type),ev.acc!=null?Math.round(ev.acc)+'m':'');
    // ── THE 30-MINUTE CONFIRMER (owner 2026-09-01) ────────────────────────
    // "then the 30 minute cron job keeps confirming and checking the
    // location." This push IS that cron (geo-ping-cron.yml -> push-geo-ping),
    // already arriving every half hour, so the confirmation rides it rather
    // than growing a second timer (§7.3). It only ever asks whether the phone
    // has moved; the coordinates never reach the fence machine or the
    // odometer, because a push-ping's fix is whatever cached position
    // CLLocationManager happened to be holding.
    if(!replay&&ev.type==='push-ping'){const _v=_geoDriveConfirm(ev);if(_v)_geoParkNote('drive-confirm',_v);}
    // THE UPDATE RIDES THE WAKE (owner 2026-08-28). Until now new web code
    // reached a phone only when somebody opened the app: the version check
    // fires on foreground resume (js/cloud.js _checkVersionOnResume), so a
    // backgrounded phone sat on old JS until it was picked up, and then the
    // owner watched it reload in his hand. Three quick fixes in a row was
    // three forced reloads on whatever device he was holding.
    //
    // The silent push already wakes this app every 30 minutes for a location.
    // The same wake can carry the update, for one extra tiny request: check
    // the live version, and if it moved, reload NOW while nobody is looking.
    // The app is simply already current when they next open it.
    //
    // ONLY when hidden. A visible app keeps the existing foreground path,
    // which is the one that knows how to warn and how to land the user back
    // where they were. _autoSaveAndReload owns every guard either way: it
    // defers during an in-flight cold load, snapshots open forms, and saves
    // before it goes.
    // Rule 10 (owner 2026-09-02): app-open minutes at the home office are
    // paperwork. The lifecycle edge and, when it carries one, its fix.
    if(/^app-/.test(String(ev.type||''))){
      _geoAppLogPush(Number(ev.ts)||Date.now(),String(ev.type).slice(4));
      if(!replay&&ev.type==='app-active'){_geoDeriveRebuildIfStale();_geoTapeDriveCheck('active');_geoDeriveLiveSoon('app-active');}
      if(typeof ev.lat==='number'&&typeof ev.lng==='number')_geoFixLogPush(Number(ev.ts)||Date.now(),ev.lat,ev.lng,ev.acc);
    }
    if(!replay&&ev.type==='push-ping')_geoBgUpdateCheck();
    // And the day is re-derived on the same push, so an open dwell that a
    // fix has since left gets closed without waiting for a flip.
    if(!replay&&ev.type==='push-ping'){
      if(typeof ev.lat==='number'&&typeof ev.lng==='number')_geoFixLogPush(Number(ev.ts)||Date.now(),ev.lat,ev.lng,ev.acc);
      _geoDeriveLiveSoon('push-ping');
    }
    return;
  }
  if(ev.type==='motion'){
    // ── DRIVING AWAY ENDS THE DWELL. ARRIVING SOMEWHERE ELSE IS TOO LATE. ──
    // The shop dwell closed on the `inShop` transition and nowhere else, so it
    // needed a regionExit to fire. iOS does not promise one. The owner's
    // 2026-08-27: he reached the yard 17:34:41, drove off 17:48:59, and no
    // shop regionExit ever came. The dwell stayed open until the Landscaper
    // regionEnter at 20:16:02 flipped `inShop`, and billed 161 minutes for 14
    // real ones. The same shape, smaller, at 12:11: closed on the 12:55
    // arrival instead of the 12:48 departure, 8 minutes over.
    //
    // The motion tape knew at 17:48:59. It always knows first, because a
    // fence cannot fire until you have crossed a line several hundred feet
    // away and driving starts at the parking space. So the dwell now ends
    // where the driving starts, and the fence is left to do the only job it
    // is actually good at, saying WHERE.
    //
    // Deliberately outside the `!replay` guard below: a force-closed app
    // replaying its buffer is exactly the case where the fence exit was
    // missed, so a replayed transition must close the dwell too. It is
    // idempotent by client_key, so a replay that races the live close writes
    // the same row rather than a second one.
    if(ev.kind&&_geoWasInShop&&_geoShopArrivedAt){
      const _k=String(ev.kind);
      if(_k==='automotive'||_k==='driving'){
        const _at=new Date(Number(ev.ts)||Date.now()).toISOString();
        // Only ever shortens. A tape event stamped BEFORE the arrival (clock
        // skew, a stale buffered row) would otherwise write a negative dwell.
        if(Date.parse(_at)>Date.parse(_geoShopArrivedAt)){
          // PENDING, NOT WRITTEN (owner 2026-08-29: "I want geo fence checks
          // on everything even departures cause that's really what confirms
          // where we were"). The motion edge is the accurate CLOCK for a
          // departure and no evidence at all that one happened: a phone in a
          // pocket reads driving from a ride in someone else's truck, and a
          // dwell written off that alone is a guess wearing a timestamp.
          //
          // So this is the same bargain already struck for drives: motion may
          // set the moment, a fence must confirm the event. The row is held
          // until the fence agrees they left, and dropped if it never does.
          // On his 2026-08-27 that is the whole difference between a day that
          // ends at 17:34:41, which is what actually happened, and one
          // carrying 14 more minutes nothing ever corroborated.
          _geoShopPendingClose={arrivedAt:_geoShopArrivedAt,at:_at,ts:Date.parse(_at)};
          _geoParkNote('shop-depart-pending',_geoShopArrivedAt+' -> '+_at);
          // The timestamp goes, `_geoWasInShop` stays. The fence transition is
          // what confirms this, and it can only fire while the engine still
          // believes they were inside.
          _geoShopArrivedAt=null;
        }
      }
    }
    // A BOUNDARY DESERVES A REAL FIX (owner 2026-08-29). The transitions that
    // start and end a paid segment are the ones worth spending radio on:
    // pulling out (onFoot -> automotive) and parking (automotive -> onFoot).
    // The plugin already stamped the event with its last-known position, so
    // the row is never fixless; the burst is what makes the NEXT few seconds
    // accurate enough for the geofence to name the place honestly. still ->
    // still churn and a walk around the yard buy nothing and are skipped.
    //
    // Deciding WHICH edges are worth a burst is JS's job, not the plugin's
    // (CLAUDE.md 3.2): the native layer reports the edge, this picks.
    // The edge itself is computed OUTSIDE the !replay guard, deliberately, and
    // for the same reason the shop-dwell close above is: a force-closed app
    // replaying its buffer is exactly the case where the fence was missed and
    // the tape is the only witness to when the truck pulled out. Only the
    // BURST stays live-only below, because a burst is a request for a fresh
    // fix and there is nothing fresh about a transition from two days ago.
    if(ev.kind){
      const cur=String(ev.kind);
      // prevKind ships from the plugin only on builds newer than 42. On the
      // build actually in the owner's pocket the field is undefined, and
      // reading it blind meant every boundary evaluated false and the new
      // bursts never fired: the feature would have looked shipped and done
      // nothing until an iOS build landed. JS sees the same ordered stream
      // the plugin does, so it can remember the last kind itself and the
      // edge is known on EVERY build. Native's copy still wins when present,
      // because it is stamped at the instant of the transition.
      const prev=String(ev.prevKind||_geoLastMotionKind||'');
      _geoLastMotionKind=cur;
      const _auto=k=>k==='automotive'||k==='driving';
      const _foot=k=>k==='walking'||k==='running'||k==='onFoot';
      const boundary=(_auto(cur)&&_foot(prev))||(_foot(cur)&&_auto(prev));
      const now=Date.now();
      // ── PULLING OUT: hold the moment, claim nothing ─────────────────────
      // foot -> automotive is the truck leaving the parking space, which is
      // where the drive actually begins. It is NOT evidence a drive happened:
      // a phone in a pocket reads automotive from a ride in someone else's
      // truck, and the same edge fires pulling forward ten feet in a yard.
      // So it is held, and the fence exit that opens the leg decides whether
      // to spend it (see _GEO_DRIVE_PENDING_MAX_MS). Same bargain the shop
      // dwell strikes: the tape sets the moment, the fence confirms the event.
      if(_auto(cur)&&!_auto(prev)){
        // Math.round, not the truncation `new Date(float)` does. The plugin
        // sends a FLOAT ms (Date().timeIntervalSince1970*1000) and ingest-geo
        // stores Math.round(e.ts). This side truncated: the owner's 08-31 edge
        // is ...725328.x, so the phone minted a key off 328 and the server off
        // 329, one millisecond and one whole extra mileage row apart. The two
        // sides must round identically or sharing the clock buys nothing.
        const _at=Math.round(Number(ev.ts))||now;
        // Never forward. A tape event stamped in the future (clock skew on a
        // replayed buffer) must not backdate a leg into next week.
        if(_at<=now){_geoDrivePendingAt=new Date(_at).toISOString();
          // ── HALF OF THE CORRELATION (owner 2026-09-01) ────────────────────
          // Hung off the flip that ALREADY exists rather than a parallel
          // signal (§7.3): this edge is the app's one definition of "the truck
          // pulled out", it already mints the flipId the leg is keyed by, and
          // it is already plumbed live, replayed and backfilled.
          //
          // It ARMS the correlation, it does not open the window. A GPS ping
          // within _GEO_DRIVE_PAIR_MS, before or after, is what opens it, and
          // a flip that never gets one never costs a second of radio: that is
          // the passenger-in-someone-else's-truck case, and the phone jostling
          // on a bench case, and both of them used to be indistinguishable
          // from a departure.
          //
          // Freshness, not replay, is the gate: a relaunch replaying a
          // transition from ten seconds ago IS the drive that is happening,
          // and a buffered edge from two days ago is not a reason to spend
          // radio now.
          if(_geoEvFresh(ev))_geoDriveCorrelate('motion',Number(ev.ts)||Date.now(),'automotive');
          // The flip's own id rides along, and is what the leg will be keyed
          // by. Null on an older build that sends no flipId, which falls back
          // to the derived key exactly as before.
          _geoDrivePendingId=(typeof ev.flipId==='string'&&ev.flipId)?ev.flipId:null;
          if(!replay)_geoParkNote('drive-pending',(prev||'?')+'->'+cur);}
      }
      // Coming to rest ends the claim: whatever this pending edge was about,
      // it is not the departure that a fence exit ten minutes from now would
      // be describing.
      if(_foot(cur)||cur==='still'){_geoDrivePendingAt=null;_geoDrivePendingId=null;}
      // THE JOURNEY END (owner 2026-09-02): automotive -> foot is when the
      // day is re-derived. Live only, and only a fresh edge: a replayed
      // buffer from yesterday is the boot rebuild's job, not a reason to
      // rewrite today.
      if(_foot(cur)&&_auto(prev)&&!replay&&_geoEvFresh(ev))_geoDeriveLiveSoon('flip');
      // ── AND THIS IS WHAT SHUTS THE CONTINUOUS GPS OFF ────────────────────
      // Owner: "when automotive goes back to cycling or walking that fire
      // another ping which shuts off the continuous gps." Any non-automotive
      // kind closes it, CYCLING INCLUDED, which is why this asks
      // _geoKindRests rather than the narrower _foot() used above for the
      // pending-departure claim: _foot deliberately excludes cycling (the
      // server counts cycling as vehicular, see the block comment on
      // _geoKindRests), and the radio must not inherit that argument.
      //
      // It is the cheapest and earliest close there is: the leg itself does
      // not close until a fence agrees, minutes later, and holding Best
      // accuracy through that wait is exactly the standing-radio cost this
      // change exists to remove. If they pull out again, the next automotive
      // flip plus its ping re-open it.
      if(_geoKindRests(cur)&&_geoEvFresh(ev))_geoDriveWindowClose('rest-'+cur);
      // Park mode keeps its own looser rule (any non-still motion may mean
      // they are leaving), so a parked truck still wakes on a walk past it.
      if(!replay&&(boundary||(_geoParkModeOn&&cur!=='still'))&&now-_geoMotionBurstAt>_GEO_MOTION_BURST_GAP_MS){
        _geoMotionBurstAt=now;
        _geoParkNote('motion-burst',prev?prev+'->'+cur:cur);
        try{const Td=_geoTdPlugin();if(Td&&typeof Td.burstFix==='function')Td.burstFix({seconds:boundary?15:12});}catch(_e){}
      }
    }
    return;
  }
  if(!replay&&_geoParkModeOn){
    const out=ev.type==='regionExit'||
      (hasFix&&_geoLastFenceLoc&&_geoDistFt({lat:ev.lat,lng:ev.lng},_geoLastFenceLoc)>_geoFenceFt());
    if(out)_geoExitParkMode();
  }
  // ── THE OTHER OPENER: a force-closed app seeing a fence exit ──────────────
  // The owner's original wording is an OR: "when core motion goes automotive
  // ... or a force closed app sees a geo fence exit." Region monitoring is the
  // one location service iOS will relaunch a force-quit app for, and in that
  // relaunched process there is no live motion stream to correlate with: the
  // coprocessor's history only reaches us on the backfill a moment later. So a
  // REPLAYED fence exit opens the window on its own, because requiring a
  // correlation there would mean a drive that began with the app dead never
  // gets a route, which is precisely the case the owner named.
  //
  // A LIVE fence exit is the strict case instead: the app is running, the
  // motion stream is running, so the exit counts as the ping half and waits
  // for the flip. Leaving a fence is not by itself a drive (walking off site,
  // GPS wander at the fence line), and the correlation is what tells them
  // apart.
  // A fence crossing is the moment the day changed; the day is re-derived
  // on it, same as on a foot flip and a ping (owner 2026-09-02: the 12:04
  // exit left the Doe row open until something else happened to run it).
  if(!replay&&(ev.type==='regionExit'||ev.type==='regionEnter')&&_geoEvFresh(ev))_geoDeriveLiveSoon(ev.type);
  // The phone just started moving after being still (iOS 17 wake stream,
  // live only: a replayed one describes a drive that already happened). The
  // fresh fix that rides with it is the ping half through _geoOnPing; the
  // motion half is either the live flip that follows, or, when the app was
  // relaunched and the flip is only on the tape, the same question the
  // fence exit asks: driving right now?
  if(ev.type==='wake-move'&&!replay&&_geoEvFresh(ev)){
    _geoParkNote('wake-move',hasFix?'fix':'no fix');
    if(!_geoDriveWinAt)_geoTapeDriveCheck('wake-move');
    _geoDeriveLiveSoon('wake-move');
  }
  if(ev.type==='regionExit'&&_geoEvFresh(ev)){
    if(replay)_geoDriveWindowOpen('fence-exit-replay');
    else{
      _geoDriveCorrelate('fix',Number(ev.ts)||Date.now(),'fence-exit');
      // A fence exit is a wake, and the wake may find CoreMotion with nothing
      // new to announce (owner 2026-09-02, 12:04). The history is asked the
      // same question the live stream did not answer: driving right now?
      if(!_geoDriveWinAt)_geoTapeDriveCheck('fence-exit');
    }
  }
  if(!hasFix)return;
  // Only a FRESH position goes in the fix log. A fence or motion row carries
  // the plugin's last-known location, which after a wake can be a mile and
  // a minute stale, and one of those in a trace read 3 miles as 6.1.
  if(_GEO_FRESH_FIX_TYPES.indexOf(String(ev.type||''))>=0)_geoFixLogPush(Number(ev.ts)||Date.now(),ev.lat,ev.lng,ev.acc);
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
       _bizDateStr(new Date(a))===_bizDateStr(new Date(nowMs))){
      _backdated=new Date(a).toISOString();
      _geoParkBackdate=_backdated;
      _geoParkNote('visit-backdate',(typeof _bizHM==='function'?_bizHM(new Date(a)):_backdated.slice(11,16))+' ('+Math.round((nowMs-a)/60000)+'m late)');
    }
  }
  // ── NOT EVERY EVENT WITH COORDINATES IS A POSITION ───────────────────────
  // Owner's 5:07pm drive home, 2026-08-31: a `visit` arrived 18 seconds after
  // a fix a quarter mile away, yanked the drive accumulator back to the
  // origin, and then counted the way forward all over again. That single event
  // is most of why the leg logged 4.8 miles on a 3.2 mile route.
  //
  // Root cause: every native event type was funneled through ONE call into
  // _geoOnPing as `{coords:{latitude:ev.lat, longitude:ev.lng}}`, and for three
  // of them that is a lie:
  //   visit       : the CENTROID of a place iOS decided you had been at,
  //                 delivered minutes after the fact (median 4, worst 45).
  //   regionEnter : manager.location at wake time, a stale last-known fix.
  //   regionExit  : the same, and by definition from before you left.
  // The block immediately above already knew a visit's TIME arrives late
  // (_geoParkBackdate) and never questioned its COORDINATES in the same
  // message.
  //
  // They still do their real jobs, which is why this is a flag and not a
  // `return`: a visit still backdates and resolves the arrival, a region event
  // still drives the fence machine and closes the leg. They just stop
  // EXTENDING the distance tally and the route, because none of them describes
  // where the truck is right now.
  // A motion row's position is the plugin's last-known fix; after a wake it
  // can be a minute stale (fixAgeMs says how stale), and a stale point in
  // the trace is how a 3-mile drive read 6.1.
  const _noTrack=(ev.type==='visit'||ev.type==='regionEnter'||ev.type==='regionExit'||
    (ev.type==='motion'&&!(typeof ev.fixAgeMs==='number'&&ev.fixAgeMs<=30000)));
  try{
    return await _geoOnPing({
      coords:{latitude:ev.lat,longitude:ev.lng,accuracy:ev.acc||0,
              speed:(typeof ev.speed==='number'&&ev.speed>=0)?ev.speed:null},
      __tdTs:typeof ev.ts==='number'?ev.ts:undefined,
      __tdNoTrack:_noTrack||undefined
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
// One version probe per wake, and never while the user is watching. Throttled
// because a wake can deliver several buffered events at once and each would
// otherwise fire its own fetch.
let _geoBgUpdAt=0;
async function _geoBgUpdateCheck(){
  try{
    if(typeof document==='undefined'||!document.hidden)return;   // foreground owns its own path
    if(Date.now()-_geoBgUpdAt<60000)return;
    _geoBgUpdAt=Date.now();
    if(typeof APP_VERSION==='undefined'||!APP_VERSION)return;
    const r=await fetch('version.json?_='+Date.now(),{cache:'no-store'});
    if(!r.ok)return;
    const d=await r.json();
    if(!d||!d.version||d.version===APP_VERSION)return;
    // Re-check visibility: the fetch is a round trip and the user may have
    // opened the app inside it. Reloading in their face is exactly what this
    // exists to avoid, and the foreground path will catch it a moment later.
    if(!document.hidden)return;
    _geoParkNote('bg-update',APP_VERSION+' -> '+d.version);
    if(typeof _autoSaveAndReload==='function')await _autoSaveAndReload();
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
        // ...and push registration behind THAT, same chain, same reason
        // (owner 2026-08-27: "why cant that be the same opt in on location
        // when they setup location services in the beginning for new users").
        // _pushResume (js/push.js) covers a phone that ALREADY granted
        // notifications, on every boot. This covers the other half: a NEW
        // user answering the location prompt for the first time, who has
        // granted nothing yet and whose only other route to a token is a
        // setup-checklist row they may never tap. One flow at setup, prompts
        // in sequence, never stacked: location, then motion, then push.
        //
        // pushEnable, not _pushResume: this is the moment it is correct to
        // ASK, the person is consenting to tracking right now. Idempotent for
        // everyone else, iOS answers an already-granted request with no
        // dialog and the listener upserts on the token.
        try{if(typeof pushEnable==='function')Promise.resolve(pushEnable()).catch(()=>{});}catch(_e){}
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
  // Before stopAll, so the window's own state machine unwinds through the one
  // door it has instead of being cleared out from under it: stopAll ends the
  // native side, this ends the JS side's memory of it.
  _geoDriveWindowClose('tracking-off');
  _geoTapePollStop();
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
  _geoWasInShop=false;_geoShopArrivedAt=null;_geoShopPendingClose=null;_geoDriveStartedAt=null;_geoGapHiddenAt=null;_geoExitPending=null;
  // Park-detection state dies with tracking too: a lock or a half-grown
  // cluster from this session must never resolve an arrival for the next one
  // (same reason the job-coordinate cache below is cleared).
  _geoParkCluster=null;_geoSoftJob=null;_geoSoftJobSpeedRun=0;_geoSoftShop=null;_geoSoftShopSpeedRun=0;_geoParkBackdate=null;
  _geoDriveReset();_geoDriveShown=false;
  _geoCurrentClient=null;_geoClientArrivedAt=null;_geoClientCacheMemo=null;
  _geoCurrentPlace=null;_geoPlaceArrivedAt=null;_geoStopAnchor=null;_geoLastFenceAt=null;_geoLegAtShop=false;_geoHomeDwell=null;_geoWasAtHome=false;
  _geoLastFenceLoc=null;_geoLegOrigin=null;_geoLastMotionKind='';_geoDrivePendingAt=null;
  _geoDrivePendingId=null;_geoLegFlipId=null;
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
let _geoReconLastMs=0;
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

// ── The tape reaches the server (owner 2026-08-29) ──────────────────────────
// "How can we make the core motion tape go to server side since it's iOS level
// shit." The coprocessor holds about a week of onFoot/still/driving and the
// native plugin has always stamped that word on the motion events it records
// (TdGeoPlugin.swift). Two holes made it useless server-side: ingest-geo
// dropped the kind, and the plugin only records what happens while it is
// running, so a stretch the app slept through existed on the handset and
// nowhere else. That is why a load-out could only ever be graded live.
//
// This lifts the whole window up once per session through the SAME ingest
// endpoint and per-device key the plugin's own background flush uses, so
// nothing new has to be authorised and nothing native changes. The unique
// index on (employee, type, ts, region) makes a re-upload a free no-op, which
// is what lets this run every session with no watermark to keep straight.
// The once-per-session latch lives on `window`, not in a `let`, matching
// window._mileMotionHealRan and window._geoOpenRestored: a top-level `let` is
// not a window property, so nothing outside this file, a test included, can
// ever reset it.
async function _geoTapeSync(){
  try{
    if(window._geoTapeSyncRan)return 0;
    window._geoTapeSyncRan=true;
    if(!_supa||!_supaUser||typeof _SUPA_DIRECT_URL==='undefined')return 0;
    const devId=(typeof _initDeviceId==='function')?_initDeviceId():null;
    let key=null;try{key=localStorage.getItem('zp3_geo_flush_key');}catch(_e){}
    // No key means the plugin's flush was never configured on this device, so
    // there is nothing to authenticate with. A browser lands here too.
    if(!devId||!key)return 0;
    const tape=await _geoMotionTape(Date.now()-7*86400000,Date.now());
    if(!Array.isArray(tape)||!tape.length)return 0;
    // Capped: a week on a busy phone is a few hundred transitions, and an
    // unbounded POST out of a boot path is how a settle point becomes a stall.
    // The tail, because recent history is what any re-grade actually needs.
    const batch=tape.slice(-500).map(t=>({type:'motion',ts:Math.round(t.ts),kind:String(t.kind||'')}));
    const r=await fetch(_SUPA_DIRECT_URL+'/functions/v1/ingest-geo',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({user_id:_supaUser.id,device_id:devId,key,events:batch})
    });
    _geoParkNote('tape-sync',(r&&r.ok?'sent ':'failed ')+batch.length);
    return (r&&r.ok)?batch.length:0;
  }catch(_e){return 0;}
}
// ── A drive row is paid for the part that was actually driving ──────────────
// Owner 2026-08-29: "we go off the background core motion tape for walking
// still and driving, so why can't this fix it too?"
//
// He is right, and the first version of this work was scoped too narrowly. The
// coprocessor already says driving / still / onFoot for every minute of the
// day, and the home-office re-grade used it while the drive rows next to it
// went on being paid at face value. His own 8/28 has a 63-minute "drive" from
// 5:26 to 6:28 that is 55 minutes parked at 39.031,-95.759, with an iOS visit
// report at 5:43 confirming the truck never moved. Nothing was checking, so it
// was paid as windshield time.
//
// The rule is the same rule the fence machine already uses: _GEO_STOP_MS is
// this file's existing line between a red light and a stop. A still stretch
// under it is traffic and stays paid; over it, nobody was driving and it comes
// off. The row keeps its span, because the leg really did run end to end, and
// only the MINUTES change, exactly like the office row carries a bracket wider
// than the time worked.
//
// REDUCTIONS ONLY, unlike the home-office re-grade. A drive row was already
// written from an observed leg, so the tape can only ever prove less driving
// happened inside it, never more.
function _geoStillOverage(tape,s,e){
  if(!Array.isArray(tape)||!tape.length||!(e>s))return 0;
  const t=tape.filter(x=>x&&typeof x.ts==='number'&&x.kind).slice().sort((a,b)=>a.ts-b.ts);
  let over=0;
  for(let i=0;i<t.length;i++){
    if(t[i].kind!=='still')continue;
    const a=Math.max(t[i].ts,s),b=Math.min((i+1<t.length)?t[i+1].ts:e,e);
    const span=b-a;
    if(span>_GEO_STOP_MS)over+=span-_GEO_STOP_MS;   // the red-light allowance stays paid
  }
  return over;
}
// ── Re-grade home-office visits that closed under the old rule ──────────────
// Owner 2026-08-29: "why can't we re-read the coremotion tape and patch it in
// retro then ensure it works live going forward."
//
// Same shape as _mileMotionHealSweep (js/mileage.js): once per session, only
// inside the tape's own memory, a small cap, and a verdict note per row so the
// next "it didn't correct" report is a diagnosis rather than a guess.
//
// ONE DELIBERATE DIFFERENCE, stated because it is the risky half: that sweep
// is reductions-only by design, and this one can RAISE a number. A visit that
// billed nothing may really have been a man loading his truck, and refusing to
// ever add a minute would leave that unpaid forever. It is still never a
// guess: the load window comes off the tape exactly as a live close would have
// read it, and no walk on the tape means no row.
//
// The paperwork half cannot be recovered and is not attempted. App-active time
// was never recorded anywhere but in memory, so a visit that closed before
// this rule existed has no evidence of it. Only Loading is recoverable.
// Same window-scoped latch as _geoTapeSync above, same reason.
// ── Re-derive the last seven days from the tape (owner 2026-08-29) ─────────
// "I also want the code to retroactively clean up by using the core motion
// tape", and re-derive the last seven days for everyone automatically.
//
// THIS NEEDS NO iOS BUILD. motionSince has shipped since 08-11 and queries
// the coprocessor's own history, which iOS keeps for roughly seven days. That
// is where the seven comes from: it is Apple's memory, not a policy choice,
// and nothing older can ever be recovered this way.
//
// What it fixes is the eight minutes: a fence trips when the truck crosses a
// circle drawn hundreds of feet from the driveway, so an arrival stamps early
// and a departure late. The tape knows when the truck actually stopped. Rows
// are re-stamped in place rather than deleted and rebuilt, so ids, job links
// and anything a human already corrected survive.
//
// Same window-scoped latch as the sweeps above, and the same 20-row ceiling:
// a boot must never turn into an unbounded write storm.
// ── The same visit, written twice (owner report 2026-08-29) ────────────────
// His 8/27 read 15h 25m and about 4h 34m of it was the same time counted
// twice, including one John Doe visit logged at 242 minutes TWICE.
//
// Root cause: the idempotency key embeds a millisecond timestamp
// (_geoVisitKey), and the unique index is on that string, so two writers only
// dedupe when they agree to the millisecond. Decoded from his own rows, they
// never do. The John Doe pair's keys were minted 149.6 seconds apart while
// BOTH rows stored the identical arrived_at, so the key did not even match
// the value it was keying. The stop pairs were two observations of one stop
// 35 and 29 seconds apart, each internally consistent and still two rows.
//
// A key can never fix that: it demands agreement between independent
// observers who are, by definition, observing at different moments. Overlap
// can. Nobody is in two places at once, so two rows of the SAME SOURCE for
// the SAME PERSON whose windows overlap are one event seen twice.
//
// Runs for every user on open, same window-latched shape and same 20-row
// ceiling as the sweeps beside it.
const _GEO_DUPE_OVERLAP=0.8;   // of the SHORTER row, so a nested twin counts
// ── LOADING UP ───────────────────────────────────────────────────────────────
// The stretch between the last time they moved around on foot and the moment
// the truck pulls out. Owner, twice: "in the top there's no loading up time in
// the morning", and it was not there because _geoCloseShopEntry bills a home
// office by app-active minutes only and has no load-out window at all. His
// 08-27 opens 07:43:54 moving, 07:49:43 driving, and the shop fence does not
// release him until 07:51:16, so those six minutes are unambiguously work in
// his own yard and the app logged nothing.
//
// Deliberately NOT _geoHomeLoadWindow, which anchors inside a visit it is
// already closing and matches 'onFoot' only. This runs from the DRIVE
// backwards, because a load-out is defined by the departure it serves, and it
// accepts 'cycling' as well: CoreMotion reads walking around a truck with a
// phone in your pocket as cycling, and that is exactly what it called those
// six minutes.
const _GEO_LOAD_MAX_MS=30*60000;   // longer than this is not a load-out
const _GEO_LOAD_MIN_MS=2*60000;    // shorter than this is getting in the cab
function _geoLoadBeforeDrive(tape,driveMs){
  if(!Array.isArray(tape)||!tape.length||!(driveMs>0))return null;
  const t=tape.filter(x=>x&&typeof x.ts==='number'&&x.kind).slice().sort((a,b)=>a.ts-b.ts);
  const moving=k=>k==='onFoot'||k==='walking'||k==='running'||k==='cycling';
  // The last stretch of moving-about that STARTS before the wheels turn. Last,
  // not first: a morning with two trips out has two, and this one belongs to
  // the drive it precedes.
  let start=null;
  for(const x of t){
    if(x.ts>=driveMs)break;
    if(moving(x.kind)){ if(start==null)start=x.ts; }
    else if(start!=null&&driveMs-x.ts>_GEO_LOAD_MAX_MS)start=null;  // that was an earlier errand
  }
  if(start==null)return null;
  const span=driveMs-start;
  if(span<_GEO_LOAD_MIN_MS||span>_GEO_LOAD_MAX_MS)return null;
  return [start,driveMs];
}
// Everything on one Central day at or after the moment the chain stopped being
// witnessed. Scoped to that CT DAY on purpose: an unconfirmed departure says
// nothing about tomorrow, and the next day opens with its own fence.
//
// Soft deletes only, and it never touches a row that started BEFORE the break.
// The morning is still evidence, whatever happened at teatime.
// Writes the load-out in front of every confirmed drive that has not got one.
// Separate sweep rather than folded into the dwell pass, because his morning
// load sits INSIDE NO EXISTING ROW: the shop dwell closed at 06:55 and the
// loading happened at 07:43, so a pass that walks dwells can never see it. A
// pass that walks DRIVES can, and a drive is what a load-out is for.
// ── THE CLOCK IS THE TAPE, THE FENCE IS THE PLACE ────────────────────────────
// Owner, 2026-08-29, stating the whole model in one go: "core motion graphs the
// time stamp and the gps ping, which then confirms if you're in a fence to
// showcase where you were, once you either go from drive to motion, fires
// another gps ping and if it's in a fence it completes the mileage and time
// starting the time where you are."
//
// So a transition is a boundary, and the segment between two of them is one
// entry. A fence never sets a time; it only names a place. Every previous
// sweep in this file was a patch on one symptom of getting that backwards, and
// this replaces the timing half of all of them.
//
// His 08-27 is the proof. CoreMotion said driving at 07:49:43; the shop fence
// did not release him until 07:51:16 and the drive row was dated 07:56:28, so
// a 7-minute drive was recorded as 3 and the missing head showed up in the log
// as a gap the app could not explain. Again at midday: driving at 12:01:35,
// fence exit at 12:04:33, and another 3 minutes went missing. Snapping to the
// tape closes both, and no gap can exist afterwards, because the segments
// tile the day by construction.
//
// It only ever RE-TIMES. It never creates a row, never deletes one, and never
// changes what a row is or where it was: the place came from the fence and the
// fence was right about that.
const _GEO_RETIME_MAX_MS=30*60000;   // a boundary this far off is not the same event
const _GEO_RETIME_MIN_MS=45000;      // under this, the tape and the fence already agree
// The sweep is bounded by DAYS, never by a raw row count.
//
// It used to take the newest 30 rows, and that number cut 2026-08-27 in half:
// its nine rows landed at positions 24 to 32, so the two that fell outside the
// cap were the morning loading row and the 7:49 drive, which are exactly the
// ones whose fence times were wrong. A cap that can end mid-day produces a day
// that is half re-timed and half not, which is worse than either, and it fails
// silently because a row that is never examined reports nothing.
// Whole days only, so a day is always entirely done or entirely untouched.
const _GEO_RETIME_DAYS=7;
const _GEO_RETIME_ROW_CAP=200;       // a true runaway guard, not a working limit
// Trim a newest-first row list to whole Central days, never mid-day.
function _geoWholeDays(rows,tsKey,maxDays,cap){
  const out=[];const seen=[];
  for(const r of rows){
    const t=Date.parse(r&&r[tsKey])||0;
    if(!t)continue;
    // dateKey, never toISOString().slice: a UTC-derived key moves the day
    // boundary, and in a sweep whose whole job is to stop cutting a day in the
    // middle that would reintroduce the bug by the back door, grouping an
    // evening row under tomorrow. The source guard in e2e-utils-exhaustive
    // caught this the moment it was written.
    const day=(typeof _bizDateStr==='function')?_bizDateStr(new Date(t)):dateKey(new Date(t));
    if(seen.indexOf(day)<0){
      // Stop only at a day BOUNDARY, so the day already being collected is
      // never left partly done by either limit.
      if(seen.length>=maxDays||out.length>=cap)break;
      seen.push(day);
    }
    out.push(r);
  }
  return out;
}
// ── The reconciler: what the tape shows and the tables lack ────────────────
// Owner 2026-08-30: "build the reconciler that just runs the live code." This
// is that, made retroactive. The live feature is: a motion transition fires,
// a ping lands in a fence, and that pairing writes the row. When the app was
// dead or the fence never fired, the transition still exists in the
// coprocessor's 7-day history; the sweeps above already move EXISTING rows
// onto those transitions. This sweep is the missing half: a drive the tape
// swears happened and no row carries at all.
//
// It runs the same rules the live path runs, through the same helpers:
// _geoTapeSegments says when the wheels turned, and the FENCE half of the
// feature is the arrival-side row that already exists (the dwell the fence
// opened where this drive ended). The owner's own sign-off rule from 08/27
// is the gate: "needs a geo fence to say yes we're saving that drive." A tape
// drive with no arrival row is NOT written; it stays unaccounted, and the day
// rail asks the human, which is that feature's whole job.
//
// CREATES DRIVES ONLY. On-site time is what the rail asks about; drives are
// objective from the tape plus the arrival fence. And it creates nothing
// where ANY row already stands, soft-deleted included: a deleted row is a
// DECISION (a personal trip dropped, a truncated evening, an owner
// strike-through), not an absence, and resurrecting one would undo the very
// cleanups the owner signed off. That interlock is why the overlap check
// reads both tables without the deleted filter.
const _GEO_FILL_MIN_MS=2*60000;        // live's own floor for a real leg
const _GEO_FILL_NEIGHBOR_MS=30*60000;  // arrival row must start this close
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
    const day=(typeof _bizDateStr==='function')?_bizDateStr(new Date()):todayKey();
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

// ── Init + two-layer consent ───────────────────────────────────────────────────
function _geoTrackInit(){
  if(!S.teamTracking)return;                 // tracking not enabled for the company
  if(!_supaUser)return;
  _geoDeriveRebuildSoon();
  _geoOnsiteTickStart();
  setTimeout(()=>{try{_geoTapeDriveCheck('boot');}catch(_e){}},1500);
  // The history is the PRIMARY departure signal; the live automotive flip is
  // the backup (owner 2026-09-03). See _geoTapePollStart.
  _geoTapePollStart();
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
      try{_geoAppLogPush(Date.now(),document.hidden?'background':'active');}catch(_e){}
      if(document.hidden){
        _geoGapHiddenAt=new Date().toISOString();
        _geoPersistOpen(_geoGapHiddenAt);
        // GPS boundary pin: fire one fix the instant the app backgrounds so the
        // deriver has a hard location proof at the Office row's end edge rather
        // than interpolating from whatever coarse fix happened to be nearby.
        // Symmetric with _geoWakeNudge on the foreground side.
        try{if((_geoWatchId!=null||_geoNativeWatcherId!=null)&&navigator.geolocation){navigator.geolocation.getCurrentPosition(_geoOnPing,()=>{},{enableHighAccuracy:true,maximumAge:0,timeout:10000});}}catch(_e){}
        // ── THE OTHER ARROW (owner 2026-09-01) ──────────────────────────────
        // "when tradedesk backgrounds I see the blue navigation arrow." The
        // drive window and the heartbeat are two of the three things that can
        // light iOS's location indicator; the third is the continuous
        // BackgroundGeolocation watcher startGeoTracking arms, and it used to
        // run until the park countdown removed it, which needs FOUR MINUTES of
        // quiet after the app is off screen. So backgrounding the app at a job
        // meant four more minutes of standing GPS every single time, and any
        // stop with no park spot to arm meant it never came down at all.
        //
        // Backgrounding with nothing driving is the definition of not needing
        // continuous GPS, so park NOW rather than in four minutes. Deliberately
        // routed through _geoEnterParkMode rather than removing the watcher
        // here (§7.3): that function already owns settling the open leg,
        // persisting state, arming the region set, the heartbeat, and the
        // watcher teardown, and a second hand-rolled teardown would drift from
        // it. It re-defers on its own if the app is really still on screen.
        //
        // The three guards are the whole safety story: an open drive window,
        // an open drive leg, or movement at driving speed in the last couple
        // of minutes all mean a drive may be under way, and a drive keeps its
        // GPS. Recent movement is judged with _GEO_DRIVE_SHOW_MS, the same
        // "was this truck moving lately" clock the drive banner uses.
        try{
          if(!_geoDriveWindowOn()&&!_geoDriveStartedAt&&
             (Date.now()-_geoDriveMovingAt)>_GEO_DRIVE_SHOW_MS&&!_geoParkModeOn){
            _geoParkNote('bg-park-now','idle at background');
            _geoEnterParkMode(_geoStopAnchor||_geoLastFenceLoc);
          }
        }catch(_e){}
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

// ══════════════════════════════════════════════════════════════════════════
// THE DERIVER, WIRED (owner 2026-09-02). js/geo-derive.js decides what the
// day was; this block feeds it and carries its answer to the database.
//
//   live:  automotive -> foot flip (and the 30-minute push-ping) re-derives
//          TODAY from the CoreMotion tape and the local fix log.
//   boot:  once per launch, the tape's whole window (iOS keeps seven days)
//          is re-derived day by day, with the server's own fixes for those
//          days folded in, and every automatic row for each day is replaced.
//          That is "clean up mileage and time logs based on core motion's
//          iOS tape on boot", and it is the same function as live.
//
// The write goes through the durable queue as ONE item per day (the latest
// derive for a day replaces any older one still waiting), and the queue
// calls geo_replace_day. Offline, it waits. Refused, it is dropped and said.
// ══════════════════════════════════════════════════════════════════════════
const _GEO_DERIVER_WRITES=true;
const _GEO_FIXLOG_KEY='zp3_geo_fixlog';
const _GEO_FIXLOG_MAX=6000;
const _GEO_FIXLOG_KEEP_MS=8*86400000;
const _GEO_DERIVE_DAYS=7;

const _GEO_APPLOG_KEY='zp3_geo_applog';
// Fewer local fixes than this inside a day means the log does not know the
// day: a real drive alone is a hundred.
const _GEO_FIXLOG_THIN=20;
// Fold a batch of server fixes/events into the local logs, deduped on the
// instant, so a derive that had to ask the server once does not have to again.
function _geoFixLogSeed(list){
  try{
    if(!Array.isArray(list)||!list.length)return;
    const a=_geoFixLogRead();const have=new Set(a.map(f=>f.ts));
    list.forEach(f=>{if(f&&typeof f.ts==='number'&&!have.has(f.ts)&&isFinite(f.lat)&&isFinite(f.lng)){a.push({ts:f.ts,lat:f.lat,lng:f.lng,acc:f.acc!=null?f.acc:null});have.add(f.ts);}});
    a.sort((x,y)=>x.ts-y.ts);
    const cut=Date.now()-_GEO_FIXLOG_KEEP_MS;
    let out=a.filter(f=>f.ts>=cut);
    if(out.length>_GEO_FIXLOG_MAX)out=out.slice(out.length-_GEO_FIXLOG_MAX);
    localStorage.setItem(_GEO_FIXLOG_KEY,JSON.stringify(out));
  }catch(_e){}
}
function _geoAppLogSeed(list){
  try{
    if(!Array.isArray(list)||!list.length)return;
    const a=_geoAppLogRead();const have=new Set(a.map(e=>e.ts+'|'+e.kind));
    list.forEach(e=>{if(e&&typeof e.ts==='number'&&e.kind&&!have.has(e.ts+'|'+e.kind)){a.push({ts:e.ts,kind:String(e.kind)});have.add(e.ts+'|'+e.kind);}});
    a.sort((x,y)=>x.ts-y.ts);
    const cut=Date.now()-_GEO_FIXLOG_KEEP_MS;
    let out=a.filter(e=>e.ts>=cut);
    if(out.length>2000)out=out.slice(out.length-2000);
    localStorage.setItem(_GEO_APPLOG_KEY,JSON.stringify(out));
  }catch(_e){}
}
function _geoAppLogRead(){try{const a=JSON.parse(localStorage.getItem(_GEO_APPLOG_KEY)||'[]');return Array.isArray(a)?a:[];}catch(_e){return [];}}
function _geoAppLogPush(ts,kind){
  try{
    const t=Number(ts),k=String(kind||'');
    if(!(t>0)||!k)return;
    const a=_geoAppLogRead();
    const last=a[a.length-1];
    if(last&&last.kind===k&&t-last.ts<1000)return;
    a.push({ts:t,kind:k});
    const cut=t-_GEO_FIXLOG_KEEP_MS;
    let out=a.filter(e=>e&&e.ts>=cut);
    if(out.length>2000)out=out.slice(out.length-2000);
    localStorage.setItem(_GEO_APPLOG_KEY,JSON.stringify(out));
  }catch(_e){}
}
function _geoFixLogRead(){try{const a=JSON.parse(localStorage.getItem(_GEO_FIXLOG_KEY)||'[]');return Array.isArray(a)?a:[];}catch(_e){return [];}}
function _geoFixLogPush(ts,lat,lng,acc){
  try{
    const t=Number(ts),la=Number(lat),ln=Number(lng);
    if(!(t>0)||!isFinite(la)||!isFinite(ln))return;
    const a=_geoFixLogRead();
    const last=a[a.length-1];
    if(last&&last.ts===t&&last.lat===la&&last.lng===ln)return;   // the same fix twice
    a.push({ts:t,lat:la,lng:ln,acc:acc!=null&&isFinite(Number(acc))?Math.round(Number(acc)):null});
    const cut=t-_GEO_FIXLOG_KEEP_MS;
    let out=a.filter(f=>f&&f.ts>=cut);
    if(out.length>_GEO_FIXLOG_MAX)out=out.slice(out.length-_GEO_FIXLOG_MAX);
    localStorage.setItem(_GEO_FIXLOG_KEY,JSON.stringify(out));
  }catch(_e){}
}

// Central day bounds without a table of offsets: walk to the first instant
// that formats as the day, then to the first that formats as the next. DST
// falls out of Intl; the walk is 15-minute steps over at most a day and a half.
function _geoDayKeyOf(ms,tz){
  try{return new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ms));}
  catch(_e){return dateKey(new Date(ms));}
}
function _geoBizTz(){return (typeof S!=='undefined'&&S&&S.bizTz)||'America/Chicago';}
function _geoDayBounds(dayKey){
  const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dayKey||''));
  if(!m)return null;
  const tz=_geoBizTz();
  let t=Date.UTC(+m[1],+m[2]-1,+m[3],0,0,0)-14*3600000;
  const step=15*60000;
  let guard=200;
  while(guard-->0&&_geoDayKeyOf(t,tz)<dayKey)t+=step;
  let e=t;guard=200;
  while(guard-->0&&_geoDayKeyOf(e,tz)===dayKey)e+=step;
  return {start:t,end:e};
}

// The saved locations, as the deriver wants them. Same sources as the park
// regions (shop, places, clients, that day's jobs) so the fence the phone
// armed and the fence the deriver resolves are the same set.
function _geoDeriveFences(dayKey){
  const out=[];
  try{
    if(typeof S!=='undefined'&&S&&S.officeLat!=null&&S.officeLon!=null)
      out.push({id:'shop',kind:'shop',name:(S.bname?S.bname+' shop':'Shop'),lat:Number(S.officeLat),lng:Number(S.officeLon),addr:S.baddr||''});
    (typeof places!=='undefined'&&Array.isArray(places)?places:[]).forEach(pl=>{
      if(!pl||pl.lat==null||pl.lon==null)return;
      out.push({id:'place-'+pl.id,kind:String(pl.kind||'other'),name:pl.name||'',lat:Number(pl.lat),lng:Number(pl.lon),addr:pl.addr||'',placeId:pl.id,radiusFt:pl.fenceFt||undefined});
    });
    const cache=(typeof _nearbyGeoCache==='function')?_nearbyGeoCache():{};
    (typeof clients!=='undefined'&&Array.isArray(clients)?clients:[]).forEach(c=>{
      if(!c||!c.addr)return;
      const hit=cache[c.id];
      if(hit&&hit.addr===c.addr&&hit.lat!=null)out.push({id:'client-'+c.id,kind:'client',name:c.name||'Client',lat:Number(hit.lat),lng:Number(hit.lon),addr:c.addr,clientId:c.id});
    });
    (typeof jobs!=='undefined'&&Array.isArray(jobs)?jobs:[]).forEach(j=>{
      if(!j||j.status==='canceled')return;
      const active=(typeof _jobActiveOn==='function')?_jobActiveOn(j,dayKey):true;
      if(!active)return;
      const c=(typeof _geoJobCoords!=='undefined'&&_geoJobCoords[j.id])||((j.lat&&j.lon)?{lat:j.lat,lng:j.lon}:null);
      if(c)out.push({id:'job-'+j.id,kind:'job',name:(typeof _tlJobClientInfo==='function'?(_tlJobClientInfo(j.id).clientName):null)||j.name||'Job',lat:Number(c.lat),lng:Number(c.lng),addr:j.addr||j.address||'',jobId:j.id});
    });
  }catch(_e){}
  return out;
}

// The coprocessor's own history. Empty on any build without it, and an
// empty tape is a reason to do NOTHING, never a reason to write an empty day.
async function _geoDeriveTape(sinceMs){
  try{
    const Td=(typeof _geoTdPlugin==='function')?_geoTdPlugin():null;
    if(!Td||typeof Td.motionSince!=='function')return [];
    const r=await Td.motionSince({sinceMs:Number(sinceMs)||0});
    if(!r||!r.available||!Array.isArray(r.transitions))return [];
    return r.transitions.filter(t=>t&&typeof t.ts==='number'&&t.kind);
  }catch(_e){return [];}
}

// The server's fixes for a window: what other wakes flushed while the app was
// dead. Folded into the local log for the boot rebuild only.
// Every row, in order, paged by capture time until a short page says the
// window is exhausted (the single call with limit(5000) and no ORDER BY it
// replaced returned whichever rows Postgres reached first).
// Until 20260908_geo_events_read_policy these reads returned ZERO rows: the
// table was deny-all to clients, so every rebuild ran on the phone's own
// thin log plus the crew-map pings and read a 3-mile drive as a 3-point
// line (owner 2026-09-02, "mileage route is wrong"). If the trace is thin
// while the server is dense, check the policy before the query.
// A heartbeat's position is the 3 km keepalive fix: not a breadcrumb.
// A push-ping's position is the plugin's CACHED location, never a fresh one:
// silentPush (TdGeoPlugin.swift) reads mgr().location and requests nothing, so
// after a heartbeat's 3 km-accuracy session it reports wherever the phone last
// happened to resolve. Owner, on site at John Doe 2026-09-03: the cached point
// sat 343 ft from where he was standing, outside the 300 ft fence, so every
// push-ping read as a departure and re-entry. Those phantom crossings are what
// produced "geo_replace_day: 4 overlapping pair(s) in the derived set", and a
// refused write means the whole day never lands. Only 'fix' carries a position
// the deriver can trust; a push-ping still counts as a wake and still triggers
// the derive, it just no longer claims to know where the phone is.
// clock-in and clock-out join 'fix' because they are the same thing: a
// getCurrentPosition read taken at that instant, never a last-known position
// replayed from a wake (owner 2026-09-04). They are also the only position
// evidence at all on a day whose owner has saved no fences.
const _GEO_FRESH_FIX_TYPES=['fix','clock-in','clock-out'];
const _GEO_FETCH_PAGE=1000;
const _GEO_FETCH_PAGES=40;
async function _geoPageAll(build){
  const out=[];
  for(let i=0;i<_GEO_FETCH_PAGES;i++){
    const r=await build().order('ts',{ascending:true}).range(i*_GEO_FETCH_PAGE,(i+1)*_GEO_FETCH_PAGE-1);
    const data=r&&Array.isArray(r.data)?r.data:null;
    if(!data)break;
    out.push.apply(out,data);
    if(data.length<_GEO_FETCH_PAGE)break;
  }
  return out;
}
async function _geoDeriveServerFixes(fromMs,toMs){
  const out=[];
  out.appEvents=[];
  try{
    if(!_supa||!_supaUser)return out;
    const me=_supaUser.id,a=new Date(fromMs).toISOString(),b=new Date(toMs).toISOString();
    const ap=await _geoPageAll(()=>_supa.from('geo_events').select('ts,type').eq('employee_user_id',me).like('type','app-%').gte('ts',a).lt('ts',b));
    ap.forEach(e=>{const t=Date.parse(e.ts);if(t>0)out.appEvents.push({ts:t,kind:String(e.type).slice(4)});});
    // Only rows whose position is FRESH. A fence or motion row carries the
    // last-known position, which after a wake can be a mile stale, and one
    // of those in the trace read a 3-mile drive as 6.1 (owner 2026-09-02).
    const ev=await _geoPageAll(()=>_supa.from('geo_events').select('ts,lat,lon').eq('employee_user_id',me).in('type',_GEO_FRESH_FIX_TYPES).gte('ts',a).lt('ts',b).not('lat','is',null));
    ev.forEach(e=>{const t=Date.parse(e.ts);if(t>0)out.push({ts:t,lat:Number(e.lat),lng:Number(e.lon),acc:null});});
    const pg=await _geoPageAll(()=>_supa.from('location_pings').select('ts,lat,lon,accuracy').eq('employee_user_id',me).gte('ts',a).lt('ts',b));
    pg.forEach(e=>{const t=Date.parse(e.ts);if(t>0)out.push({ts:t,lat:Number(e.lat),lng:Number(e.lon),acc:e.accuracy!=null?Number(e.accuracy):null});});
  }catch(_e){}
  return out;
}

function _geoEnqueueRpc(dayKey,args){
  try{
    const key='rpc:'+dayKey;
    const q=_geoQueueRead().filter(x=>!(x&&x.row&&x.row.client_key===key));
    q.push({rpc:'geo_replace_day',args,row:{client_key:key}});
    _geoQueueWrite(q);
  }catch(_e){}
  _geoDrainQueue();
}

// The in-memory mileage array is what the settings-blob sweep compares the
// server against, so the derived legs have to be in it or the next save
// would retire them (CLAUDE.md 9.8). Hand-typed trips are untouched; what a
// person set on a GPS leg (vehicle, purpose, notes) rides across by id.
function _geoDeriveApplyMileage(dayKey,derived){
  if(typeof mileage==='undefined'||!Array.isArray(mileage))return;
  const keep=['vehicle','vehicleId','purpose','notes','receiptId','deductible'];
  const byId={};
  mileage.forEach(m=>{if(m&&m.id!=null)byId[String(m.id)]=m;});
  const ids=new Set((derived||[]).map(m=>String(m.id)));
  for(let i=mileage.length-1;i>=0;i--){
    const m=mileage[i];
    if(m&&m.gps===true&&m.date===dayKey&&!ids.has(String(m.id)))mileage.splice(i,1);
  }
  (derived||[]).forEach(m=>{
    const old=byId[String(m.id)];
    const row=Object.assign({},m);
    if(old)keep.forEach(k=>{if(old[k]!=null&&old[k]!=='')row[k]=old[k];});
    const at=mileage.findIndex(x=>x&&String(x.id)===String(m.id));
    if(at>=0)mileage[at]=Object.assign(mileage[at],row);else mileage.push(row);
  });
}

// ── Road miles for a derived leg ──────────────────────────────────────────
// Owner 2026-09-02: "Mileage isn't 3.2 like it should be." The trace is a
// breadcrumb every thirty seconds and cuts every corner, so on its own it
// undercounts (his 2.7 for a leg the road makes 3.2). A leg's miles are the
// road distance between its two ends when the router answers, and never
// less than what the trace measured. Same _routeDistance the manual log
// uses (7.3), answered once per pair of ends and remembered, so a boot
// rebuild of a week costs one call per distinct drive, not per rebuild.
const _GEO_TRACE_END_FT=600;      // the trace must start and end inside the fences it joins
const _GEO_TRACE_GAP_MS=45000;    // and average a breadcrumb at least this often
const _GEO_TRACE_MIN_PTS=12;
// Does the trace start inside the origin fence and end inside the destination?
function _geoTraceSpans(m){
  try{
    const p=m&&m.path;
    if(!Array.isArray(p)||p.length<2||typeof _geoDistFt!=='function')return false;
    const near=(pt,c)=>!!(c&&isFinite(c.lat)&&isFinite(c.lng)&&Array.isArray(pt)&&isFinite(+pt[0])&&isFinite(+pt[1])&&
      _geoDistFt({lat:+pt[0],lng:+pt[1]},{lat:+c.lat,lng:+c.lng})<=_GEO_TRACE_END_FT);
    return near(p[0],m.fromCoord)&&near(p[p.length-1],m.toCoord);
  }catch(_e){return false;}
}
function _geoTraceComplete(m){
  try{
    const p=m&&m.path;
    if(!Array.isArray(p)||p.length<_GEO_TRACE_MIN_PTS)return false;
    if(!_geoTraceSpans(m))return false;
    const dur=Date.parse(m.endedIso||'')-Date.parse(m.startedIso||'');
    if(!(dur>0))return false;
    return dur/p.length<=_GEO_TRACE_GAP_MS&&Number(m.miles)>0;
  }catch(_e){return false;}
}
let _GEO_ROUTE_TIMEOUT_MS=8000;
const _GEO_ROUTE_CACHE_KEY='zp3_geo_routes';
const _GEO_ROUTE_CACHE_MAX=400;
function _geoRouteKey(a,b,via){const r=v=>Math.round(Number(v)*1e4)/1e4;return r(a.lat)+','+r(a.lng)+'>'+(Array.isArray(via)&&via.length?via.map(v=>r(v.lat)+','+r(v.lng)).join('>')+'>':'')+r(b.lat)+','+r(b.lng);}
// The router picks the FASTEST road, not the one the truck took: asked for
// Doe to the shop it answered 3.9 by the highway for a drive the owner does
// in 3.2 on the surface streets (2026-09-02). A thin trace cannot be the
// miles, but the few breadcrumbs it has still say which road it was, so the
// router is steered through them. Interior points only, clear of both
// fences (a stale point next to a fence steers nothing), duplicates
// dropped, thinned evenly to a handful so a route stays one request.
const _GEO_ROUTE_VIA_MAX=4;
function _geoRouteVia(m){
  try{
    const p=m&&m.path;
    if(!Array.isArray(p)||p.length<3||typeof _geoDistFt!=='function')return [];
    const ends=[m.fromCoord,m.toCoord].filter(c=>c&&isFinite(c.lat)&&isFinite(c.lng));
    const pts=[];
    for(let i=1;i<p.length-1;i++){
      const pt=p[i];
      if(!Array.isArray(pt)||!isFinite(+pt[0])||!isFinite(+pt[1]))continue;
      const c={lat:+pt[0],lng:+pt[1]};
      if(ends.some(e=>_geoDistFt(c,e)<=_GEO_TRACE_END_FT))continue;
      const last=pts[pts.length-1];
      if(last&&last.lat===c.lat&&last.lng===c.lng)continue;
      pts.push(c);
    }
    if(pts.length<=_GEO_ROUTE_VIA_MAX)return pts;
    const out=[];
    for(let i=0;i<_GEO_ROUTE_VIA_MAX;i++)out.push(pts[Math.round((i+1)*(pts.length-1)/(_GEO_ROUTE_VIA_MAX+1))]);
    return out.filter((c,i,a)=>i===0||c!==a[i-1]);
  }catch(_e){return [];}
}
function _geoRouteCacheRead(){try{const c=JSON.parse(localStorage.getItem(_GEO_ROUTE_CACHE_KEY)||'{}');return (c&&typeof c==='object')?c:{};}catch(_e){return {};}}
async function _geoDeriveRouteMiles(rows){
  if(!Array.isArray(rows)||typeof _routeDistance!=='function')return rows;
  const cache=_geoRouteCacheRead();
  let dirty=false;
  for(const m of rows){
    try{
      if(!m||!m.fromCoord||!m.toCoord||!isFinite(m.fromCoord.lat)||!isFinite(m.toCoord.lat))continue;
      // A leg collapsed through a personal stop is billed at the DIRECT
      // route (rule 6): no breadcrumbs steer that one, they run through the
      // stop. Every other leg's router is steered down the road it drove.
      const steer=(Number(m.collapsedStops)>0)?[]:_geoRouteVia(m);
      const k=_geoRouteKey(m.fromCoord,m.toCoord,steer);
      let routed=Number(cache[k]);
      if(!(routed>0)){
        // Bounded: MapKit's directions callback can simply never come
        // (offline, blocked), and an unbounded await here stalled the whole
        // boot rebuild behind one leg (owner 2026-09-02, the 11:39 reopen).
        const r=await Promise.race([_routeDistance(m.fromCoord,m.toCoord,steer),new Promise(res=>setTimeout(()=>res(null),_GEO_ROUTE_TIMEOUT_MS))]);
        routed=(r&&Number(r.miles)>0)?Math.round(Number(r.miles)*10)/10:0;
        if(routed>0){cache[k]=routed;dirty=true;}
      }
      if(!(routed>0))continue;
      m.routeMiles=routed;
      // A trace that runs fence to fence with a breadcrumb every few seconds
      // IS the drive (owner 2026-09-02: his 3.0 against the router's 3.9).
      // The router only outranks a thin one, or one that starts down the
      // road because the phone woke late.
      if(_geoTraceComplete(m))continue;
      // A leg collapsed through a personal stop is billed at the direct
      // route (rule 6), and the direct route cannot be longer than the road
      // actually driven through the detour. When the trace spans fence to
      // fence, the driven path caps the router (owner 2026-09-02: 3.9 from
      // the router for a leg the truck drove in 3.3 with the stop in it).
      const via=(Number(m.collapsedStops)>0&&_geoTraceSpans(m)&&typeof _milePathMiles==='function')?_milePathMiles(m):0;
      const direct=(via>0&&routed>via)?Math.round(via*10)/10:routed;
      if(direct>(Number(m.miles)||0)){m.miles=direct;m.calc_method=direct===routed?'derived-routed':'derived-via';}
    }catch(_e){}
  }
  if(dirty){
    try{
      const ks=Object.keys(cache);
      if(ks.length>_GEO_ROUTE_CACHE_MAX)ks.slice(0,ks.length-_GEO_ROUTE_CACHE_MAX).forEach(k=>{delete cache[k];});
      localStorage.setItem(_GEO_ROUTE_CACHE_KEY,JSON.stringify(cache));
    }catch(_e){}
  }
  return rows;
}

// ── The screen shows what the table holds ─────────────────────────────────
// Owner 2026-09-02, the morning after the rebuild: four legs live in
// td_mileage, three on the phone. Once geo_replace_day has taken a day, the
// day's legs are read back and the in-memory list is made to match them,
// keeping what a person set on a row (vehicle, purpose, notes). Whatever
// else touched the list in between, the table is the truth (CLAUDE.md 17).
async function _geoDeriveSyncMileage(dayKey){
  try{
    if(!dayKey||typeof _supa==='undefined'||!_supa||!_supaUser||typeof mileage==='undefined'||!Array.isArray(mileage))return 0;
    const{data,error}=await _supa.from('td_mileage').select('id,data').eq('user_id',_supaUser.id).is('deleted_at',null).eq('data->>date',dayKey);
    if(error||!Array.isArray(data))return 0;
    const live=data.map(r=>r&&r.data).filter(r=>r&&r.gps===true&&r.id!=null&&r.date===dayKey);
    _geoDeriveApplyMileage(dayKey,live);
    try{if(typeof renderAllMileage==='function'&&document.getElementById('mil-table'))renderAllMileage();}catch(_e){}
    return live.length;
  }catch(_e){return 0;}
}

// One day, end to end. Returns the deriver's result, or null when there was
// nothing to derive from.
async function _geoDeriveDayNow(dayKey,serverFixes){
  try{
    if(typeof geoDeriveDay!=='function'||!_supaUser)return null;
    const b=_geoDayBounds(dayKey);
    if(!b)return null;
    const tape=await _geoDeriveTape(b.start-2*3600000);
    // Nothing positively covering this day: leave its rows alone. A day the
    // tape does not cover can still be a Sunday of invoicing at the home
    // office (rule 10), which the app log covers instead.
    const tapeCovers=tape.some(t=>t.ts>=b.start-2*3600000&&t.ts<b.end);
    const appCovers=_geoAppLogRead().some(e=>e.ts>=b.start&&e.ts<b.end)||
      (serverFixes&&Array.isArray(serverFixes.appEvents)&&serverFixes.appEvents.some(e=>e.ts>=b.start&&e.ts<b.end));
    if(!tapeCovers&&!appCovers)return null;
    let server=Array.isArray(serverFixes)?serverFixes:null;
    if(!server){
      // Live derive with a thin local log for this day (a fresh build, a
      // reinstall, a day the app was dead for): the server has what other
      // wakes flushed. Fetched once, then seeded locally so the next derive
      // does not have to ask.
      const localToday=_geoFixLogRead().filter(f=>f.ts>=b.start&&f.ts<b.end).length;
      if(localToday<_GEO_FIXLOG_THIN){
        server=await _geoDeriveServerFixes(b.start-2*3600000,b.end);
        _geoFixLogSeed(server);
        _geoAppLogSeed(server.appEvents);
      }
    }
    const fixes=_geoFixLogRead().concat(server||[]);
    const appEvents=_geoAppLogRead().concat((server&&Array.isArray(server.appEvents))?server.appEvents:[]);
    const res=geoDeriveDay({
      day:dayKey,dayStart:b.start,dayEnd:b.end,personId:_supaUser.id,
      tape,fixes,appEvents,fences:_geoDeriveFences(dayKey),nowMs:Date.now(),
    });
    // MISSING EVIDENCE IS NOT AN EMPTY DAY (owner 2026-09-02, 22:33: "my
    // mileage gone for today when I should have four trips"). The tape had
    // his four drives; the local fix log, minutes old on a fresh build, had
    // no fix for any of them, so nothing resolved and the day was replaced
    // with nothing. Drives on the tape that resolve to nowhere at all mean
    // the fixes have not been fetched, not that nothing happened. Skip, and
    // let the next derive (with the server's fixes folded in below) do it.
    const resolvedAny=!!(res.legs.length||res.dwells.length||res.pending||res.open);
    if(res.journeys.length&&!resolvedAny){
      try{_geoParkNote('derive-skip',dayKey+': '+res.journeys.length+' drives on the tape, none resolved');}catch(_e){}
      return null;
    }
    const rows=_geoDeriveVehicleRows(geoDeriveRows(res,{contractorId:_geoCid(),employeeId:_supaUser.id}));
    // The legs show the moment the day is derived (owner 2026-09-02: "the
    // drives themselves weren't instant"); the road miles are a lookup that
    // can take seconds per new pair, so they land as a second paint.
    _geoDeriveApplyMileage(dayKey,rows.td_mileage);
    try{if(typeof renderAllMileage==='function'&&document.getElementById('mil-table'))renderAllMileage();}catch(_e){}
    await _geoDeriveRouteMiles(rows.td_mileage);
    _geoEnqueueRpc(dayKey,{
      p_contractor:_geoCid(),p_employee:_supaUser.id,p_day:dayKey,
      p_day_start:new Date(b.start).toISOString(),p_day_end:new Date(b.end).toISOString(),
      p_time:rows.job_time_entries,p_shop:rows.shop_time_entries,p_miles:rows.td_mileage,
    });
    _geoDeriveApplyMileage(dayKey,rows.td_mileage);
    // Every derived day tells js/day-end.js where it ended, so a clock that
    // crossed midnight can be closed at yesterday's arrival home.
    try{if(typeof _dayEndNoteDay==='function'&&_dayEndNoteDay(dayKey,res)&&typeof renderDash==='function'&&document.getElementById('pg-dash')?.classList.contains('active'))renderDash();}catch(_e){}
    _geoOpenDwellPublish(dayKey,res);
    try{_geoParkNote('derived',dayKey+' '+res.dwells.length+'d/'+res.legs.length+'l'+(res.pending?' pending':'')+(res.open?' open':''));}catch(_e){}
    try{if(typeof _tlLiveRefresh==='function')_tlLiveRefresh();}catch(_e){}
    return res;
  }catch(_e){return null;}
}

let _geoDeriveLiveT=null;
function _geoDeriveLiveSoon(why){
  if(_geoDeriveLiveT)clearTimeout(_geoDeriveLiveT);
  _geoDeriveLiveT=setTimeout(()=>{_geoDeriveLiveT=null;_geoDeriveDayNow(_geoDayKeyOf(Date.now(),_geoBizTz()),null);},4000);
}

// ── WHEN A DAY IS LOCKED (owner 2026-09-02: "when do we stop, how do we
// lock in the data?") ─────────────────────────────────────────────────────
// A derive is a pure function of the tape, the fixes and the rules, so
// deriving a day again with nothing changed writes the same rows onto the
// same keys and churns nothing. What CAN change an old day is the rules,
// and the rules only change with the app version. So a boot rebuild covers
// today and yesterday (the days still collecting evidence), and reaches
// back the full week only once per app version, the moment a rule change
// first lands on the phone. Anything a person fixed by hand is never
// touched either way (geo_replace_day keeps fixed-* rows).
const _GEO_DERIVE_DAYS_LIVE=2;
const _GEO_DERIVE_VER_KEY='zp3_geo_derive_ver';
const _GEO_DERIVE_STALE_MS=30*60000;
let _geoDeriveRebuiltAt=0;
function _geoDeriveAppVer(){try{return (typeof APP_VERSION!=='undefined'&&APP_VERSION)?String(APP_VERSION):'';}catch(_e){return '';}}
function _geoDeriveRebuildDays(){
  try{const seen=localStorage.getItem(_GEO_DERIVE_VER_KEY)||'';const ver=_geoDeriveAppVer();return (ver&&seen===ver)?_GEO_DERIVE_DAYS_LIVE:_GEO_DERIVE_DAYS;}catch(_e){return _GEO_DERIVE_DAYS_LIVE;}
}
// One rebuild at a time. _geoDeriveRebuiltAt is stamped when a rebuild
// FINISHES, so a stale check arriving while one is still running (an
// app-active during the boot rebuild, or two checks a few ms apart, which
// is how CI caught it on WebKit) used to start a second one on top of the
// first: two rebuilds re-deriving the same days and both writing them. The
// running one is handed back instead.
let _geoDeriveRebuildP=null;
function _geoDeriveRebuild(){
  if(_geoDeriveRebuildP)return _geoDeriveRebuildP;
  _geoDeriveRebuildP=_geoDeriveRebuildRun().finally(()=>{_geoDeriveRebuildP=null;});
  return _geoDeriveRebuildP;
}
async function _geoDeriveRebuildRun(){
  const today=_geoDayKeyOf(Date.now(),_geoBizTz());
  const b=_geoDayBounds(today);
  if(!b)return 0;
  const days=_geoDeriveRebuildDays();
  const from=b.start-(days-1)*86400000-2*3600000;
  const server=await _geoDeriveServerFixes(from,b.end);
  _geoFixLogSeed(server);
  _geoAppLogSeed(server.appEvents);
  let n=0;
  for(let i=days-1;i>=0;i--){
    const d=_geoDayKeyOf(b.start-i*86400000+3600000,_geoBizTz());
    const r=await _geoDeriveDayNow(d,server);
    if(r)n++;
  }
  _geoDeriveRebuiltAt=Date.now();
  try{const ver=_geoDeriveAppVer();if(ver)localStorage.setItem(_GEO_DERIVE_VER_KEY,ver);}catch(_e){}
  try{_geoParkNote('rebuild',days+'d, '+n+' derived');}catch(_e){}
  return n;
}
// A boot rebuild that never finished (a hung lookup, a dead network) used to
// leave the day stale until the next cold start. Coming back to the app
// after half an hour runs it again.
function _geoDeriveRebuildIfStale(){
  try{
    if(!window._geoDeriveRebuilt||_geoDeriveRebuildT)return false;
    if(Date.now()-_geoDeriveRebuiltAt<_GEO_DERIVE_STALE_MS)return false;
    _geoDeriveRebuild();
    return true;
  }catch(_e){return false;}
}

// ── The open dwell, for the screens ────────────────────────────────────────
// The deriver reports where the person is right now (a dwell with an arrival
// and no departure yet) and never writes it, so the dashboard card and the
// Time Log rail read it from here: {name, kind, sinceTs, sinceIso, journeyId,
// fence}. Cleared when today derives with nobody on site.
function _geoOpenDwellPublish(dayKey,res){
  try{
    if(dayKey!==_geoDayKeyOf(Date.now(),_geoBizTz()))return;
    const o=res&&res.open;
    const next=o?{id:String(o.id||''),name:String(o.name||''),kind:String(o.kind||''),sinceTs:Number(o.sinceTs)||0,atHome:!!o.atHome,
      sinceIso:new Date(Number(o.sinceTs)||Date.now()).toISOString(),journeyId:String(o.journeyId||''),
      fence:o.fence?{id:o.fence.id,kind:o.fence.kind,name:o.fence.name,jobId:o.fence.jobId,clientId:o.fence.clientId,addr:o.fence.addr||''}:null}:null;
    const prev=window._geoOpenDwell||null;
    const same=(!prev&&!next)||(prev&&next&&prev.id===next.id&&prev.sinceTs===next.sinceTs);
    window._geoOpenDwell=next;
    // Report the DERIVER'S VERDICT, not just what the card did with it.
    // Standing inside a fence with no on-site card and no Live Activity, the
    // liveact_* events said only that nothing asked for a card; they could not
    // say WHY the deriver thought nobody was on site. Guessing at that from
    // chat cost the owner most of 2026-09-03. open:none plus the day's shape
    // (how many dwells, legs and journeys came out, and whether any journey is
    // still hanging) names the rule that decided it.
    try{
      if(window._obs&&typeof window._obs.track==='function'){
        const nd=((res&&res.dwells)||[]).length,nl=((res&&res.legs)||[]).length;
        const nj=((res&&res.journeys)||[]).length;
        // A pending CHAIN is res.pending, not a flag on a journey. The first
        // cut of this filtered journeys for a `.pending` property that does
        // not exist, so it reported "nothing pending" for a day that may well
        // have been held in a pending chain, and that wrong reading was passed
        // on to the owner as a ruled-out cause.
        const pend=(res&&res.pending)?1:0;
        // How many fences the deriver was even given. An arrival cannot
        // resolve to a client whose coordinates are missing, and a day with
        // no fences looks exactly like a day where nobody stopped anywhere.
        const nf=((res&&res.fenceCount)!=null)?res.fenceCount:-1;
        const why=(res&&res.openWhy)?String(res.openWhy):'?';
        window._obs.track('derive_open_'+(next?'yes':'none'),
          (next?String(next.kind||''):why+' d'+nd+'/l'+nl+'/j'+nj+'/f'+nf+(pend?'/PENDING':'')).slice(0,60));
      }
    }catch(_e){}
    // The day that ended on its own (js/day-end.js): back at the home office
    // with the manual clock still running, or at a job with none. Runs on
    // every publish because the same dwell only proposes once; a fresh
    // proposal repaints the Home card even when the dwell itself is unchanged.
    let deNew=false;
    try{if(typeof _dayEndOnDwell==='function')deNew=(_dayEndOnDwell(next,res)==='new');}catch(_e){}
    // The lock screen and the island show the same fact (js/live-activity.js).
    // Runs on EVERY publish, not just a changed dwell: the request is one
    // shot at the arrival instant otherwise, so a bridge that wasn't ready
    // yet (or a start that failed) left the island empty for the whole
    // dwell with nothing to retry it. _liveActSet dedups on a signature, so
    // re-asserting an unchanged dwell costs nothing.
    try{if(typeof _liveActOnSite==='function')_liveActOnSite(next);}catch(_e){}
    if(same){
      if(deNew){try{if(typeof renderDash==='function'&&document.getElementById('pg-dash')?.classList.contains('active'))renderDash();}catch(_e){}}
      return;
    }
    try{if(typeof renderDash==='function'&&document.getElementById('pg-dash')?.classList.contains('active'))renderDash();}catch(_e){}
    try{if(typeof _tlRenderOpenBanner==='function'&&document.getElementById('pg-timelog')?.classList.contains('active'))_tlRenderOpenBanner();}catch(_e){}
  }catch(_e){}
}
// Once a second, every on-site figure on screen moves (owner 2026-09-02:
// "show how long I've been here down to the minute"). Reads the arrival
// instant off the node, touches no data.
let _geoOnsiteTickT=null;
function _geoOnsiteTick(){
  try{
    const now=Date.now();
    document.querySelectorAll('[data-onsite-since]').forEach(n=>{
      const t=Number(n.getAttribute('data-onsite-since'));
      if(!(t>0))return;
      const s=Math.max(0,Math.floor((now-t)/1000)),h=Math.floor(s/3600),m=Math.floor((s%3600)/60);
      n.textContent=(h?h+'h ':'')+m+'m';
    });
  }catch(_e){}
}
function _geoOnsiteTickStart(){
  if(_geoOnsiteTickT)return;
  _geoOnsiteTickT=setInterval(_geoOnsiteTick,1000);
}
let _geoDeriveRebuildT=null;
function _geoDeriveRebuildSoon(){
  if(window._geoDeriveRebuilt||_geoDeriveRebuildT)return;
  _geoDeriveRebuildT=setTimeout(()=>{_geoDeriveRebuildT=null;window._geoDeriveRebuilt=true;_geoDeriveRebuild();},2500);
}

// THE VEHICLE RULE, applied to a derived day (ported from the old engine's
// _geoDriveEntry/_geoAutoMileage so the deriver could stay pure). One place
// decides what the person was riding in (_shiftVehicleMode, js/cloud.js) and
// that decides both the drive row's label and whether a mileage leg exists:
//
//   owner            'drive'            miles on the default truck
//   crew, truck      'drive'            miles on that truck (deducts)
//   crew, own car    'drive-personal'   miles, reimbursable, never deducted
//   crew, rider      'drive-rider'      NO mileage row: the truck's trip is
//                                       the driver's, one deduction per truck
//   crew, none       'drive-unassigned' miles recorded, claimed by nobody
//
// Drive TIME is paid in every case (every label still matches
// _geoIsDriveSource). Purpose comes from the destination fence's kind through
// the same table the manual log uses (_autoTripPurpose).
function _geoDeriveVehicleRows(rows){
  try{
    if(!rows||!Array.isArray(rows.job_time_entries))return rows;
    const emp=(typeof _isEmployee!=='undefined')&&_isEmployee;
    const mode=emp?((typeof _shiftVehicleMode==='function')?_shiftVehicleMode():'none'):'owner';
    const kind=(mode==='owner'||mode==='truck')?'drive':(mode==='rider'?'drive-rider':(mode==='own'?'drive-personal':'drive-unassigned'));
    const vlist=(typeof vehicles!=='undefined'&&Array.isArray(vehicles))?vehicles:[];
    let veh=null;
    if(mode==='truck'){
      const a=(typeof _myTruckToday==='function')?_myTruckToday():null;
      const vid=a&&(a.v!=null&&a.v!==''?a.v:(a.vehId!=null?a.vehId:a.vehicleId));   // truckDay={day,mode,v,with} (js/cloud.js _dispatchSetTruck)
      veh=vlist.find(v=>v&&String(v.id)===String(vid))||null;
      if(!veh&&vid!=null)veh={id:vid,name:''};
    }else if(mode==='owner'){
      veh=vlist.find(v=>v&&(v.isDefault||v.default))||vlist[0]||null;
    }
    rows.job_time_entries.forEach(r=>{if(r&&_geoIsDriveSource(r.source))r.source=kind;});
    const byKey={};
    rows.job_time_entries.forEach(r=>{if(r&&/^drive/.test(String(r.source||'')))byKey[String(r.client_key)]=r;});
    rows.td_mileage=(rows.td_mileage||[]).filter(m=>mode!=='rider').map(m=>{
      const to=m&&m._to;
      const out=Object.assign({},m);
      delete out._to;
      if(typeof _autoTripPurpose==='function'&&to)out.purpose=_autoTripPurpose(to);
      if(veh){out.vehicle=veh.name||'';out.vehicleId=veh.id;}
      if(mode==='own'){out.reimbursable=true;out.deductible=false;out.vehicle='';out.vehicleId=undefined;}
      if(mode==='none'){out.deductible=false;out.reimbursable=false;out.unassigned=true;}
      return out;
    });
    return rows;
  }catch(_e){return rows;}
}
