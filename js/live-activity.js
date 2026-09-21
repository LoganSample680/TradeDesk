// ── Live Activities: the lock screen and the Dynamic Island (owner 2026-08-17) ─
//
// THE PROBLEM THIS SOLVES: the app already knows two things worth showing all
// day, a running job clock and an active drive, and for most of a contractor's
// day it can show neither, because the phone is in a pocket or a truck mount
// with the app closed. A Live Activity puts that state on the lock screen and in
// the Dynamic Island, where they are already looking, at a cost of zero taps.
//
// EVERY DECISION IS HERE (CLAUDE.md 3.2). The native plugin takes finished
// strings and lays them out; it decides nothing. What counts as driving, what
// the card says, which color it wears, when it appears and disappears: all of it
// is below, so it stays tunable through a UAT roll instead of a 15-minute macOS
// build and a forced TestFlight update on every tester's phone.
//
// Two channels, because both can be true at once (driving to the next job while
// still clocked into the last one):
//   'drive' → miles and a live readout while the truck is moving
//   'clock' → the job timer, ticking on-device
//
// The ONE thing native owns is the ticking clock. iOS renders it from a start
// timestamp with the app closed and no updates spent; sending a fresh string
// every second would drain the battery and blow ActivityKit's update budget in
// minutes. So a timer card is started ONCE and never updated on a tick.

function _liveActPlugin(){
  try{
    const cap=window.Capacitor;
    if(!cap||typeof cap.isNativePlatform!=='function'||!cap.isNativePlatform())return null;
    if(typeof cap.registerPlugin==='function')return cap.registerPlugin('TdLive');
    return (cap.Plugins&&cap.Plugins.TdLive)||null;
  }catch(_e){return null;}
}

// Support is asked once and cached, but ONLY a positive answer, matching the
// haptics rule (§7.3): this file can run before Capacitor finishes injecting
// its bridge, and caching that "no" would leave the shell with dead Live
// Activities for the entire session.
let _liveSupported=null;
async function _liveActReady(){
  if(_liveSupported===true)return true;
  const P=_liveActPlugin();
  if(!P||typeof P.isSupported!=='function')return false;
  try{
    const r=await P.isSupported();
    // supported=false is an old iPhone (pre-16.1). enabled=false is the user
    // switching Live Activities off for TradeDesk in Settings. Both mean "do
    // not try", but only the first is permanent, so neither is cached as a no.
    if(r&&r.supported&&r.enabled){_liveSupported=true;return true;}
  }catch(_e){}
  return false;
}

// What the two cards look like. Colors match the app's own meaning: the denim
// blue the drive banner already uses, the green the clock already uses.
// LOCK SCREEN colors, not the app's. #2D5DA8 and #0E6B39 are the brand navy
// and forest green, and they are right inside the app, where they sit on cream
// and white. On the lock screen they sit on a Material blur over whatever
// wallpaper the person has, and the owner's own card (2026-08-24, over a dark
// green wallpaper) read as almost black on black next to the Southwest Wallet
// pass right above it: "so dark and hard to read on our end, can we brighten
// the blue to match the southwest Apple wallet cards."
//
// The blue is not a guess: #0085E7 is the dominant accent sampled straight out
// of the Southwest pass in the owner's own screenshot, which is the comparison
// he made. Against a dark card it measures 4.46:1 where the brand navy managed
// 2.63:1, so it clears AA for the bold numbers the card actually renders (3:1)
// where the old one did not. The green is its counterpart, picked to sit at a
// similar weight beside it rather than to match anything of Southwest's.
//
// The widget already carries a dark shadow behind every tinted glyph for the
// light-wallpaper case (TdLiveWidget.swift, DualReadout's note), so brightening
// only ever helps the dark one and the light case is unchanged.
//
// Lives in JS on purpose (§3.2): the Swift layer takes the tint off the payload
// rather than owning a palette, so this is a UAT roll and never an iOS build.
const _LIVE_TINT={drive:'#0085E7',clock:'#12A85C',onsite:'#F2A93B',rail:'#F2A93B'};

// Track what was last sent per channel so an unchanged ping is never spent.
// ActivityKit budgets updates, and the geo engine pings far more often than the
// card actually changes (every fix, versus every tenth of a mile).
const _liveLast={};

// ── A CARD OUTLIVES THE APP, AND _liveLast DOES NOT (owner 2026-09-12) ──────
// "Why is my gps Dynamic Island still running?" Because nothing could end it.
//
// Every "there should be no card now" path asked `if(_liveLast[ch]!=null)`
// before ending, which reads as "only bother if we put one up". But _liveLast
// is plain memory: a force-quit, a relaunch, or the version watchdog's reload
// wipes it, while the ActivityKit card sails straight through all three. So
// after any relaunch the app looks at an empty map, concludes it never started
// anything, and leaves a card it can no longer see running forever. His drive
// card went up at 15:29 on the 11th and was still there a day later.
//
// The fix is to stop asking whether WE started it and start asking whether
// THIS LAUNCH has already told ActivityKit to end it. Ending is idempotent and
// a no-op when nothing is live, so the worst case is one wasted native call
// per channel per launch, and the best case is the island going dark the way
// it always should have.
//
// Not a native change (3.2): the plugin already exposes end(). This is a UAT
// roll, never a build.
const _liveEnded={};
function _liveActEndIfLive(channel){
  if(_liveEnded[channel])return false;
  _liveActEnd(channel);
  return true;
}

// Payloads iOS refused to START because the app was backgrounded, held until
// it is on screen again. Keyed by channel, so a newer state simply replaces an
// older one rather than queueing a stale card.
const _liveWant={};

// Which channels ask ActivityKit for an APNs push token, so the SERVER can
// change or end the card with the app closed (update-live-activity). The clock
// card earns it first: a manager force-closing a forgotten clock from Time Log
// must end the crew phone's CLOCKED IN card, or the lock screen keeps telling
// them they are on the meter. The drive card stays phone-driven, nothing
// server-side knows more about a drive than the phone in the truck does.
// ── WHICH CARDS THE SERVER MAY DRIVE ────────────────────────────────────────
// A card started with push:true gets its own APNs token from ActivityKit,
// which this file stores server-side (_liveActSaveToken); the server then
// changes or ends it with the app closed, or on a screen that is not allowed
// to derive.
//
// 'onsite' joined 'clock' on 2026-09-16, and the owner's report is why: "live
// activities, if I'm in the ops portal it doesn't update live when I go to
// drive." The on-site card is published at the end of a derive and a derive is
// refused while a support view is open, so it froze. With a token, the
// server's own derive keeps it honest (supabase/functions/_shared/live-card.mjs)
// whatever screen anybody is on.
//
// 'rail' replaced both 'onsite' and 'drive' on 2026-09-21. 'drive' used to be
// deliberately absent from this list, on the grounds that its value is the
// running mileage tally which lives on the phone and nowhere else, so a server
// push could only ever tell it something it already knew better. True of the
// NUMBER and wrong about the card: the words ("on the road, from the shop")
// are exactly what the server knows and the sleeping phone does not, and a
// silent lock screen for the whole of a drive was the price. The rail card
// takes its words from the server and its miles from the phone, and `value` is
// kept out of the signature so the two never fight.
const _LIVE_PUSH_CHANNELS={clock:true,rail:true};

// Report a Live Activity outcome to telemetry (analytics_events via
// ingest-telemetry). console.warn is NOT captured by js/observability.js, only
// console.error is, so every diagnostic added to this file so far has been
// invisible to anyone not holding the phone: three rounds of "still nothing on
// my island" with no evidence to work from. A tracked event lands server-side
// where it can actually be read, and unlike console.error it does not trip
// assertNoErrors in the offline suite.
function _liveActReport(event, ctx){
  try{if(window._obs&&typeof window._obs.track==='function')window._obs.track('liveact_'+event,String(ctx||'').slice(0,60));}catch(_e){}
}

// ── ONE SIGNATURE, ONE PLACE ────────────────────────────────────────────────
// A card is re-asserted from several directions (every dwell publish, every
// return to the foreground, the replay of a refused start) and an update costs
// a real ActivityKit round trip, so an unchanged card has to hash to the same
// string every time. That string was built in TWO places, byte for byte
// identical and with nothing keeping them that way, which is the shape of a
// bug that only appears months later when one of them is edited. Now it is
// built here and read from here.
//
// A timer card renders itself, so the TICK is excluded and a running clock
// spends nothing.
//
// ── BUT THE ANCHOR IS NOT THE TICK (owner 2026-09-11) ──────────────────────
// "app says 3 hours 51 minutes but the lock says 9". He was at one client
// twice in a day, 8:02 to 12:30 and again from 1:25. The deriver had it right
// and the in-app card read 3h51m from the second arrival; the lock screen was
// still counting from the first, five hours out, and was never going to
// correct itself.
//
// Both visits produce the same kind, the same title and the same detail (the
// client's address), so the second arrival hashed to the signature the first
// one left behind and the update was suppressed as a no-op. `timer?'T'` threw
// away the one field that had actually changed.
//
// startedAt is WHAT THE CARD SHOWS, not how often it redraws: change it and
// every number on the lock screen is wrong until the card is torn down. So it
// belongs in the signature, and so does siteStartedAt whenever the card is
// drawing two clocks.
function _liveActSig(payload){
  const p=payload||{};
  // `value` counts on the RAIL CHANNEL ONLY (owner 2026-09-21). Its DRIVING
  // face carries both a timer and the mileage tally, and with value reachable
  // only when timer is false the number would have been deduped away after the
  // first paint and never moved again. Every other card keeps the old rule,
  // which this file's own test names: a per-second tick is not a change, and
  // hashing it would spend an ActivityKit update on every geo ping.
  //
  // Deliberately NOT the same rule as the server's liveCardSig, which leaves
  // value out on purpose. Two different questions: the server asks "did the
  // WORDS change", because it has no number and must not re-blank the one the
  // phone wrote; the phone asks "did anything I am showing change".
  return [p.kind,p.title,p.detail,
    p.timer?('T'+p.startedAt+(p.dualTimer?('/'+p.siteStartedAt):'')):p.value,
    p.channel==='rail'?p.value:'',
    p.tint,p.dualTimer?'D':'',p.nextScopeId,p.isLastScope?'L':''].join('|');
}

// ── SAID ONCE, NOT FORTY TIMES (owner 2026-09-13) ────────────────────────
// A crew member drove for twenty-five minutes with Live Activities switched
// off for TradeDesk, and got roughly forty toasts reading "Live Activity:
// disabled in Settings", one every thirty seconds, at the wheel. Forty rows
// of telemetry went with them.
//
// The cause was that the not-ready answer is deliberately never cached (see
// _liveActReady: only a yes is remembered, because the person can change
// their mind in Settings and the app must notice), and this ran on every
// drive ping.
//
// The toast is gone entirely rather than throttled, because a toast was the
// wrong surface for it: it is a thing you fix in Settings, it appears while
// somebody is driving, and it is gone before they could act on it even if
// they were not. The dashboard setup checklist is where the app asks for a
// permission it needs, alongside location, motion and notifications, and it
// is where this asks now (js/dashboard.js, the 'liveact' item).
//
// The telemetry stays, once per channel per reason per session, which is what
// makes it a signal rather than a log of how long somebody drove.
const _liveNotReadySaid={};
async function _liveActSet(channel,state){
  if(!(await _liveActReady())){
    // No plugin at all is the ordinary web case, not a fault: every desktop
    // and mobile browser, and the whole offline test suite, has no Capacitor.
    // Nothing to report and nobody who could act on it.
    const P2=_liveActPlugin();
    if(!P2)return false;
    try{
      const diag=await P2.isSupported().catch(()=>({err:'call failed'}));
      const why=channel+':'+(diag&&diag.supported?'disabled':'unsupported');
      if(!_liveNotReadySaid[why]){_liveNotReadySaid[why]=1;_liveActReport('notready',why);}
      // The checklist owns telling them. Refresh it so the card appears on
      // the first ping that finds the switch off, rather than on next boot.
      if(diag&&diag.supported&&typeof _liveActRefreshCache==='function')_liveActRefreshCache();
    }catch(_e){
      if(!_liveNotReadySaid[channel+':threw']){_liveNotReadySaid[channel+':threw']=1;_liveActReport('notready',channel+':threw');}
    }
    return false;
  }
  const P=_liveActPlugin();
  if(!P)return false;
  _liveActWireTokens();
  const payload={
    channel,
    kind:state.kind||'',
    title:String(state.title||'').slice(0,60),
    detail:String(state.detail||'').slice(0,60),
    value:String(state.value||''),
    timer:!!state.timer,
    startedAt:Number(state.startedAt)||Math.floor(Date.now()/1000),
    // Time-on-SITE vs time-on-THIS-STEP (owner feedback 2026-08-19): two
    // different clocks with two different starts. siteStartedAt survives a
    // scope switch (arrival time), startedAt above resets on one (last
    // clock-in). Falls back to startedAt so a card that never sets it (the
    // drive card, or a channel written before this existed) still renders one
    // sane number instead of a stray zero.
    siteStartedAt:Number(state.siteStartedAt)||Number(state.startedAt)||Math.floor(Date.now()/1000),
    dualTimer:!!state.dualTimer,
    tint:state.tint||_LIVE_TINT[channel]||_LIVE_TINT.drive,
    push:!!_LIVE_PUSH_CHANNELS[channel],
    // ── Lock-screen "Next" / "Clock out" button (owner 2026-08-19) ──────────
    // Everything the iOS 17 LiveActivityIntent needs to act with the app
    // closed, embedded on every update so the button never fetches anything
    // first. Only the clock channel sets these to real values; the drive
    // channel (and any older caller) ships the same shape with empty
    // defaults, this file's own documented gotcha applies to EVERY field,
    // ActivityKit's Codable decode fails silently if one is missing on ANY
    // update, so every channel ships every field, always.
    jobId:String(state.jobId||''),
    contractorUserId:String(state.contractorUserId||''),
    // The actual person clocked in, not the account. '' means the owner
    // (matches jobs.js _tlLoggedByInfo's null-means-owner convention) so the
    // server write can find and close the ONE open entry that's theirs, not
    // just any open entry on the job (several crew can share a job).
    loggedByUid:String(state.loggedByUid||''),
    currentScopeId:String(state.currentScopeId||''),
    nextScopeId:String(state.nextScopeId||''),
    nextScopeLabel:String(state.nextScopeLabel||'').slice(0,60),
    isLastScope:!!state.isLastScope,
    // Everything AFTER nextScopeId, so a device can tap Next repeatedly with
    // the app closed the whole time: each tap's optimistic local update pops
    // the queue by one instead of needing a round trip just to learn what's
    // next. A flat JSON string, not a nested array-of-struct ContentState
    // field, on purpose: a malformed string just decodes to an empty queue
    // (button falls back to "last scope"), where a strict Codable array
    // would risk the whole content-state decode failing silently. Capped so
    // a job with a very long scope list can never approach ActivityKit's
    // content-state size ceiling.
    scopeQueue:JSON.stringify(Array.isArray(state.scopeQueue)?state.scopeQueue.slice(0,8).map(s=>({id:String((s&&s.id)||''),label:String((s&&s.label)||'').slice(0,60)})):[]),
    // Whichever Supabase base URL THIS device is currently using (direct or
    // the /api proxy fallback, js/cloud.js SUPA_URL, §14.3), so the widget's
    // request follows the same self-healing routing the app itself uses
    // instead of a hardcoded URL that could drift from cloud.js's.
    supaBaseUrl:(typeof SUPA_URL!=='undefined'&&SUPA_URL)?String(SUPA_URL):''
  };
  const sig=_liveActSig(payload);
  if(_liveLast[channel]===sig)return true;
  try{
    const started=_liveLast[channel]!=null;
    const fn=started?P.update:P.start;
    if(typeof fn!=='function')return false;
    let r=await fn.call(P,payload);
    // update() returns ok:false when the card is already gone (the user swiped
    // it away, or iOS reclaimed it). Start it again rather than going silent
    // for the rest of the shift.
    if(started&&r&&r.ok===false&&typeof P.start==='function')r=await P.start(payload);
    // A FAILED start must not be remembered (owner 2026-09-03: nothing on the
    // island all day, on drive, arrival or departure). The plugin RESOLVES
    // {ok:false, reason} rather than throwing: ActivityKit refused, the card
    // was started from the background, Live Activities are off. Caching the
    // signature anyway made that one failure permanent, because every later
    // call with the same state hit the dedup above and returned without ever
    // retrying. The geo engine re-asserts each state on a timer, so leaving
    // the signature unset is all a retry needs.
    if(r&&r.ok===false){
      const why=(r&&r.reason)?String(r.reason):'unknown';
      _liveActReport('refused',channel+':'+why);
      // "Target is not foreground" is iOS refusing to START a card from a
      // backgrounded app. It is not a fault in the payload and it is not
      // permanent: the same request succeeds the next time the app is on
      // screen. UPDATES are allowed from the background, so once a card is up
      // it keeps ticking; only the birth is gated.
      //
      // This is why the on-site card never appeared once (owner, all of
      // 2026-09-03): a dwell is published by the geo engine with the phone in
      // a pocket, so every single request to start it was refused, while the
      // drive card flashed up for a second at 16:09 purely because he had the
      // app open at that instant. Hold the payload and start it the moment we
      // are foreground again.
      if(/not\s*foreground|background/i.test(why))_liveWant[channel]=payload;
      else try{if(typeof _toast==='function')_toast('Live Activity ('+channel+'): '+why);}catch(_e){}
      return false;
    }
    // The card is up. Reported too, because "it started and you still see
    // nothing" and "it never started" are different bugs with different
    // fixes, and from a chat message they look identical.
    _liveActReport(started?'updated':'started',channel);
    _liveLast[channel]=sig;
    delete _liveEnded[channel];   // there is a card again; the next end is real
    return true;
  }catch(_e){_liveActReport('threw',channel+':'+((_e&&_e.message)||'?'));return false;}
}

async function _liveActEnd(channel){
  delete _liveLast[channel];
  // This launch has now asked ActivityKit to end this channel, so the polling
  // paths above can stop asking until something starts one again.
  _liveEnded[channel]=true;
  // ── END THE CARD FIRST, FORGET THE TOKEN SECOND (owner 2026-09-21) ───────
  // This dropped the token before it asked ActivityKit for anything, so every
  // path where the plugin is missing or end() throws deleted the one thing
  // that could ever reach that card again and left the card on the screen.
  // The server then answers "no live card" on every flush forever, the phone
  // is asleep, and an ActivityKit timer ticks from its start date with no
  // input at all, so a dead card looks perfectly alive. That is exactly what
  // the owner was looking at on 2026-09-21: still standing at John Doe on the
  // lock screen forty minutes into a drive, with live_activity_tokens empty.
  //
  // The token is only useless once the card is actually gone, so it is
  // forgotten only once the card is actually gone.
  const P=_liveActPlugin();
  if(P&&typeof P.end==='function'){try{await P.end({channel});}catch(_e){}}
  _liveActDropToken(channel);
}

// ── Server-driven updates (owner 2026-08-17) ─────────────────────────────────
// ActivityKit hands a push-enabled card its own APNs token (and rotates it at
// will). Each one is stored server-side keyed (user, channel) so the
// update-live-activity Edge Function can change or end THIS card with the app
// closed. Fire-and-forget everywhere: a failed store just means the card is
// phone-driven, exactly what it was before this feature.
let _liveTokWired=false;
function _liveActWireTokens(){
  if(_liveTokWired)return;
  const P=_liveActPlugin();
  if(!P||typeof P.addListener!=='function')return;
  _liveTokWired=true;
  try{
    P.addListener('activityToken',e=>{_liveActSaveToken(e&&e.channel,e&&e.token);});
  }catch(_e){}
}
async function _liveActSaveToken(channel,token){
  if(!channel||!token)return;
  try{
    if(typeof _supa==='undefined'||!_supa||!_supaUser)return;
    await _supa.from('live_activity_tokens').upsert({
      user_id:_supaUser.id,
      channel:String(channel),
      token:String(token),
      contractor_user_id:(typeof _contractorUserId!=='undefined'&&_contractorUserId)||_supaUser.id,
      updated_at:new Date().toISOString()
    },{onConflict:'user_id,channel'});
  }catch(_e){}
}
function _liveActDropToken(channel){
  try{
    if(typeof _supa==='undefined'||!_supa||!_supaUser)return;
    const q=_supa.from('live_activity_tokens').delete().eq('user_id',_supaUser.id);
    (channel?q.eq('channel',String(channel)):q).then(()=>{},()=>{});
  }catch(_e){}
}
// End someone ELSE's card through the server: the force-clock-out path. The
// function checks the target belongs to the caller's account; this just asks.
function _liveActRemoteEnd(targetUid,channel){
  try{
    if(typeof _supa==='undefined'||!_supa||!_supa.functions||!targetUid)return;
    _supa.functions.invoke('update-live-activity',{body:{
      user:String(targetUid),
      channel:channel||'clock',
      event:'end',
      state:{kind:'CLOCKED IN',title:'Clocked out by the office',detail:'',value:'',timer:false,
        startedAt:Math.floor(Date.now()/1000),siteStartedAt:Math.floor(Date.now()/1000),dualTimer:false,
        tint:_LIVE_TINT.clock}
    }}).then(()=>{},()=>{});
  }catch(_e){}
}

// Sign-out, account switch, or a boot that finds cards from a previous session.
// A drive card outliving its session would leave one client's name on the lock
// screen after the phone changes hands, which is the same exposure the handoff
// lock exists to prevent.
async function _liveActEndAll(){
  Object.keys(_liveLast).forEach(k=>delete _liveLast[k]);
  // 'drive' and 'onsite' are the two channels the rail card replaced. They are
  // still listed because a phone that has not reloaded yet may have one up.
  ['drive','clock','onsite','rail'].forEach(k=>{_liveEnded[k]=true;});
  _railState.open=null;_railState.pending=null;_railState.drive=null;
  // Cards first, tokens second, for the reason spelled out in _liveActEnd.
  const P=_liveActPlugin();
  if(P&&typeof P.endAll==='function'){try{await P.endAll();}catch(_e){}}
  _liveActDropToken(null);   // all channels: the session is over
}

// The moment they arrived on THIS site. Two sources, best one wins:
//
// 1. geo-track.js's own geofence arrival (`_geoArrivedAt`/`_geoCurrentJob`,
//    js/geo-track.js): the actual fence-entry timestamp for whoever has geo
//    tracking on, ground truth, and can predate the clock-in itself (a crew
//    member can walk the fence line before tapping Clock In). Used only when
//    it's currently tracking THIS job, never a stale value from a job they've
//    since left.
// 2. Falls back to the earliest clock-in TODAY for this job, by this same
//    person, when geo tracking is off (not every phone opts in, §9.5) or
//    hasn't caught up yet. jobs.js never tracks "arrival" as its own field
//    outside geo-track, it only tracks each scope's own start_time in
//    `timeEntries`, so this derives arrival from data that already exists
//    instead of adding a new persisted field. Naturally stable across a
//    same-day scope switch, since earlier entries for the job stay in
//    `timeEntries` regardless of which scope is active now.
function _liveActSiteStart(jobId){
  try{
    if(!jobId)return null;
    if(typeof _geoCurrentJob!=='undefined'&&_geoCurrentJob===jobId&&
       typeof _geoArrivedAt!=='undefined'&&_geoArrivedAt){
      const geoMs=Date.parse(_geoArrivedAt);
      if(!isNaN(geoMs))return geoMs;
    }
    if(typeof timeEntries==='undefined'||!Array.isArray(timeEntries))return null;
    const{loggedByUid}=(typeof _tlLoggedByInfo==='function')?_tlLoggedByInfo():{loggedByUid:null};
    const today=(typeof todayKey==='function')?todayKey():null;
    let earliest=null;
    for(const e of timeEntries){
      if(!e||e.job_id!==jobId)continue;
      if(today&&e.date!==today)continue;
      if((e.logged_by_uid||null)!==loggedByUid)continue;
      const ms=e.start_time?new Date(e.start_time).getTime():NaN;
      if(!isNaN(ms)&&(earliest===null||ms<earliest))earliest=ms;
    }
    return earliest;
  }catch(_e){return null;}
}

// ── The clock card ───────────────────────────────────────────────────────────
// Started once when the clock starts and left alone: iOS ticks it. Called by
// clockIn/clockOut in js/jobs.js.
//
// Two live clocks now (owner feedback 2026-08-19, "on-site time detail"):
// total time on THIS SITE (since arrival, keeps running across a scope
// switch) and time on the CURRENT STEP (since the last clock-in call, which
// is what the single clock already showed before this change). `detail`
// already carries the step's own name, that part was never missing, it was
// just getting truncated on the native side (see TdLiveWidget.swift).
// What the lock-screen Next button should advance to: the scope right after
// the one just clocked into, plus everything beyond that (§ scopeQueue on
// _liveActSet), computed from the SAME ordered list the in-app clock-in sheet
// shows (getJobScopes, js/jobs.js, which already honors a job's custom
// scopeOrder when one is set). One source of truth for "what's next" whether
// the tap happens in the app or on the lock screen.
function _liveActNextScopeInfo(jobId,currentScopeId){
  const empty={nextScopeId:'',nextScopeLabel:'',isLastScope:true,scopeQueue:[]};
  try{
    if(!jobId||typeof getJobScopes!=='function')return empty;
    const scopes=getJobScopes(jobId)||[];
    if(!scopes.length)return empty;
    // currentScopeId not found (an ad-hoc clock-in with no scope chosen, or a
    // scope that isn't part of this job's list): treat everything as ahead,
    // so the button has somewhere useful to go rather than defaulting to
    // "last" for a shift that hasn't actually picked a task yet.
    const idx=currentScopeId?scopes.findIndex(s=>s.id===currentScopeId):-1;
    const rest=idx===-1?scopes.slice():scopes.slice(idx+1);
    if(!rest.length)return empty;
    const[next,...queue]=rest;
    return{
      nextScopeId:next.id,
      nextScopeLabel:next.label,
      isLastScope:false,
      scopeQueue:queue.map(s=>({id:s.id,label:s.label}))
    };
  }catch(_e){return empty;}
}

function _liveActClockIn(t){
  if(!t)return;
  const who=t.clientName||t.jobName||'Job';
  const what=t.scopeLabel||t.jobName||'';
  const stepStart=Math.floor((t.startTime||Date.now())/1000);
  const siteStart=Math.floor((_liveActSiteStart(t.jobId)||t.startTime||Date.now())/1000);
  const{loggedByUid}=(typeof _tlLoggedByInfo==='function')?_tlLoggedByInfo():{loggedByUid:null};
  const contractorUserId=(typeof _effectiveUid==='function'&&_effectiveUid())||(typeof _supaUser!=='undefined'&&_supaUser&&_supaUser.id)||'';
  const nextInfo=_liveActNextScopeInfo(t.jobId,t.scopeId);
  // One timer for one spot: the clock card carries the site clock, so the rail
  // card's ON SITE face steps aside (it comes back on clock-out, see below).
  // Told explicitly rather than read off _liveLast, because _liveActSet fills
  // that a tick later and the face would otherwise decide on the state as it
  // was a moment ago. Same option the server's railCardFor takes, by the same
  // name. The DRIVING face does NOT yield, which is why this is a repaint and
  // no longer a flat end: "clocked in" and "on the road" are two different
  // facts and neither says the other.
  _railPaint({clockCardUp:true});
  _liveActSet('clock',{
    kind:'CLOCKED IN',
    title:who,
    // Never repeat the title underneath it; on a lock screen that reads as a
    // rendering bug rather than emphasis.
    detail:(what&&what!==who)?what:'',
    timer:true,
    startedAt:stepStart,
    siteStartedAt:siteStart,
    dualTimer:true,
    tint:_LIVE_TINT.clock,
    jobId:t.jobId,
    contractorUserId,
    loggedByUid:loggedByUid||'',
    currentScopeId:t.scopeId||'',
    nextScopeId:nextInfo.nextScopeId,
    nextScopeLabel:nextInfo.nextScopeLabel,
    isLastScope:nextInfo.isLastScope,
    scopeQueue:nextInfo.scopeQueue
  });
}
async function _liveActClockOut(){
  await _liveActEnd('clock');
  // The clock card yielded the island; if they are still on a site the rail
  // knows about, its ON SITE face takes the spot back. A repaint of the state
  // the rail already holds, never a re-read of window: _liveActEnd above has
  // already cleared _liveLast.clock, so the face un-yields on its own.
  try{_railPaint();}catch(_e){}
}

// ── ONE CARD, THE SHAPE OF THE DAY RAIL (owner 2026-09-21) ──────────────────
//
// "I want a new one to throw down though, it mirrors the day rail."
//
// There used to be two cards here and they could not both be right. The drive
// card was phone-driven because the mileage tally only exists on the phone;
// the on-site card was server-driven so it could move with the app shut. So
// the lock screen went silent for the whole of every drive the app slept
// through, which is most of every drive, and the island only shows two cards
// anyway with the clock card already holding one.
//
// One card now. Its face is whatever the day rail's live row says: DRIVING,
// or ON SITE, or nothing. The words come from the deriver, the same two facts
// the Time Log's live row reads, so the lock screen and the app cannot name
// different places. The server pushes those words on every motion flip
// (supabase/functions/_shared/live-card.mjs railCardFor, the twin of the face
// builder below, held to the same answers by tests/e2e-live-card.spec.js) and
// the phone overlays the running miles whenever it is awake to compute them.
//
// Not a native change (3.2): the widget renders state.kind as a chip and does
// not branch on channel, so a new channel and new words are pure data. UAT
// roll, never a build.
const _railState={open:null,pending:null,drive:null};

// The face, from the two halves. The twin of railCardFor; keep them in step.
function _liveActRailFace(opts){
  const o=opts||{};
  const d=_railState.open||null;
  const p=_railState.pending||_railState.drive||null;
  const mi=(_railState.drive&&_railState.drive.value)?String(_railState.drive.value):'';
  if(d&&Number(d.sinceTs)>0){
    // HOME IS NOT A CARD (owner 2026-09-03: "I need it to go away or be very
    // small, right now it's wasted space running when I'm home and done
    // working"). The deriver decides this, not this file: a home office and a
    // shop at one address are two fences and the shop outranks the home
    // office, so the dwell at his own house arrives as kind 'shop' with
    // atHome set. A clock-in at home still shows, through the clock channel,
    // because that is the person saying they ARE working.
    if(d.atHome)return null;
    // A person CLOCKED IN already has the green clock card carrying the site
    // clock, so the ON SITE face yields rather than stacking a second timer
    // for the same spot. The DRIVING face below does NOT yield: "clocked in"
    // and "on the road" are two different facts and neither says the other.
    if(o.clockCardUp||_liveLast.clock!=null)return null;
    const kind=String(d.kind||'');
    const where=String(d.name||'')||(kind==='shop'?'The shop':'On site');
    const addr=(d.fence&&d.fence.addr)?String(d.fence.addr):'';
    let arrived='';
    try{arrived=new Date(Number(d.sinceTs)).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});}catch(_e){arrived='';}
    const detail=(addr&&addr!==where)?addr:(arrived?('Arrived '+arrived):'');
    return {kind:kind==='shop'?'AT THE SHOP':'ON SITE',title:where,detail,value:mi,
      timer:true,startedAt:Math.floor(Number(d.sinceTs)/1000),tint:_LIVE_TINT.onsite};
  }
  if(p&&Number(p.startTs)>0){
    // The engine tracks an ORIGIN, not a destination, so promising a
    // destination here would be inventing one and the lock screen and the app
    // would disagree the moment the guess was wrong. Same words the
    // dashboard's DRIVING banner uses.
    const org=(p.origin&&p.origin.name)?String(p.origin.name):'';
    return {kind:'DRIVING',title:'On the road',detail:org?('From '+org):'Mileage is logging',
      value:mi,timer:true,startedAt:Math.floor(Number(p.startTs)/1000),tint:_LIVE_TINT.drive};
  }
  return null;
}

// The two channels the rail card replaced, ended once per launch from the
// foreground pass below, which is already where a card from a previous session
// is reconciled. A phone that has not reloaded since the change can be
// carrying either of them, and an orphaned card is exactly the bug this whole
// change exists to stop.
//
// Not inside _railPaint: the paint runs on every ping, and a retirement that
// rides along with it puts an end call in the middle of every other card's
// call sequence for no reason.
let _railLegacyEnded=false;
function _railEndLegacy(){
  if(_railLegacyEnded)return;
  _railLegacyEnded=true;
  ['onsite','drive'].forEach(ch=>{try{_liveActEndIfLive(ch);}catch(_e){}});
}

function _railPaint(opts){
  const face=_liveActRailFace(opts);
  if(!face){_liveActEndIfLive('rail');return false;}
  _liveActSet('rail',face);
  return true;
}

// The deriver's own two halves, straight from _geoOpenDwellPublish. Runs on
// EVERY publish, not just a changed dwell: the request is one shot at the
// arrival instant otherwise, so a bridge that was not ready yet (or a start
// that failed) left the island empty for the whole dwell with nothing to
// retry it. _liveActSet dedups on a signature, so re-asserting costs nothing.
function _liveActRail(dwell,pending){
  _railState.open=dwell||null;
  _railState.pending=(pending&&Number(pending.startTs)>0)
    ?{startTs:Number(pending.startTs),origin:pending.origin?{name:String(pending.origin.name||'')}:null}
    :null;
  return _railPaint();
}

// ── The miles, which only this phone can compute ─────────────────────────────
// Road miles come from a router on the handset (MapKit, then Valhalla and OSRM
// raced), so the server can never fill this in. Called from the geo engine's
// ping handler; safe on every ping because _liveActSet drops unchanged ones.
//
// It also carries the DRIVE WINDOW, which is the drive before the deriver has
// a pending chain to describe it (owner 2026-09-01: the card goes up the
// moment the flip and the ping pair, not two minutes of banner-fade later).
// _liveActRailFace prefers the deriver's pending and falls back to this.
function _liveActDrive(){
  let driving=false;
  try{driving=(typeof _geoDriving==='function')&&_geoDriving();}catch(_e){driving=false;}
  try{if(!driving&&typeof _geoDriveWindowOn==='function'&&_geoDriveWindowOn())driving=true;}catch(_e){}
  if(!driving){_railState.drive=null;return _railPaint();}
  let miles=0,steps=0;
  try{miles=Number(_geoDriveMiles)||0;steps=Number(_geoDriveSteps)||0;}catch(_e){}
  let org='';
  try{org=(typeof _geoLegOrigin!=='undefined'&&_geoLegOrigin&&_geoLegOrigin.name)?String(_geoLegOrigin.name):'';}catch(_e){org='';}
  // WHEN THIS DRIVE STARTED, and it must not move. The deriver's pending chain
  // is the real answer and it arrives a few seconds later; until then this is
  // the instant the drive window first opened, REMEMBERED, because reading the
  // clock afresh on every ping would reset the card's timer to zero every few
  // seconds.
  const prev=_railState.drive;
  const pend=_railState.pending;
  const since=(pend&&Number(pend.startTs)>0)?Number(pend.startTs)
    :(prev&&Number(prev.startTs)>0)?Number(prev.startTs):Date.now();
  // Under a handful of accumulation hops the tally is a guess, not a road
  // trace (geo-track.js's own honesty rule), so the number is withheld rather
  // than shown wrong on a lock screen the contractor cannot correct. Rounded
  // to a tenth, which is also the granularity that keeps updates rare.
  _railState.drive={startTs:since,origin:org?{name:org}:null,
    value:steps>=3?(miles.toFixed(1)+' mi'):'logging'};
  return _railPaint();
}

// ── The foreground is the only place a card can be BORN ──────────────────────
// ActivityKit refuses Activity.request() from a backgrounded app ("Target is
// not foreground"). Updates are fine from anywhere, so a card that is already
// up keeps ticking with the phone in a pocket; it is only the start that has
// to happen on screen.
//
// Everything that wants a card is driven by the geo engine, which by design
// runs while the app is backgrounded, so without this every on-site card was
// requested at exactly the moment iOS would not grant it. The owner watched a
// drive card flash up for one second on 2026-09-03 (it started only because
// the app happened to be open) and never once saw an on-site card all day.
//
// So on every return to the foreground: replay anything iOS refused, then
// re-assert the live state, which is idempotent because _liveActSet dedups on
// a signature and an unchanged card costs nothing.
async function _liveActForeground(){
  try{
    if(!(await _liveActReady()))return;
    const P=_liveActPlugin();
    if(!P||typeof P.start!=='function')return;
    for(const ch of Object.keys(_liveWant)){
      const payload=_liveWant[ch];
      delete _liveWant[ch];
      if(!payload)continue;
      try{
        const r=await P.start(payload);
        if(r&&r.ok===false){_liveActReport('refused',ch+':'+((r&&r.reason)||'unknown'));continue;}
        _liveActReport('started',ch);
        // The same signature _liveActSet stores, from the same function, so
        // the next unchanged assert is deduped instead of spending an update.
        _liveLast[ch]=_liveActSig(payload);
        delete _liveEnded[ch];
      }catch(_e){}
    }
    // The two channels the rail card replaced, retired once per launch.
    _railEndLegacy();
    // Re-assert from the live state too: a dwell that was published while the
    // app was closed never got as far as a refusal to remember.
    //
    // SEEDED FROM window ONLY WHEN THE RAIL HAS NOTHING. _railState is module
    // memory and a relaunch wipes it, while _geoPersistDwell restores
    // window._geoOpenDwell, so that is where a fresh process finds the dwell.
    // But a re-read cannot be unconditional: it would overwrite state the rail
    // already holds with a window that has not caught up, and on a phone
    // carrying a card that was just replayed that lands as an end.
    try{
      if(typeof window!=='undefined'&&!_railState.open&&window._geoOpenDwell){
        _railState.open=window._geoOpenDwell;
        if(!_railState.pending&&window._geoOpenPending)_railState.pending=window._geoOpenPending;
      }
      _railPaint();
    }catch(_e){}
    try{if(typeof _liveActDrive==='function')_liveActDrive();}catch(_e){}
  }catch(_e){}
}

try{
  if(typeof document!=='undefined'&&document.addEventListener){
    document.addEventListener('visibilitychange',function(){
      try{if(document.visibilityState==='visible')_liveActForeground();}catch(_e){}
    });
  }
}catch(_e){}
