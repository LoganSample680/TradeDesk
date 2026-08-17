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
const _LIVE_TINT={drive:'#2D5DA8',clock:'#0E6B39'};

// Track what was last sent per channel so an unchanged ping is never spent.
// ActivityKit budgets updates, and the geo engine pings far more often than the
// card actually changes (every fix, versus every tenth of a mile).
const _liveLast={};

// Which channels ask ActivityKit for an APNs push token, so the SERVER can
// change or end the card with the app closed (update-live-activity). The clock
// card earns it first: a manager force-closing a forgotten clock from Time Log
// must end the crew phone's CLOCKED IN card, or the lock screen keeps telling
// them they are on the meter. The drive card stays phone-driven, nothing
// server-side knows more about a drive than the phone in the truck does.
const _LIVE_PUSH_CHANNELS={clock:true};

async function _liveActSet(channel,state){
  if(!(await _liveActReady()))return false;
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
    tint:state.tint||_LIVE_TINT[channel]||'#2D5DA8',
    push:!!_LIVE_PUSH_CHANNELS[channel]
  };
  // A timer card renders itself; only its LABELS can change, so the tick is
  // excluded from the signature and a running clock spends nothing.
  const sig=[payload.kind,payload.title,payload.detail,payload.timer?'T':payload.value,payload.tint].join('|');
  if(_liveLast[channel]===sig)return true;
  try{
    const started=_liveLast[channel]!=null;
    const fn=started?P.update:P.start;
    if(typeof fn!=='function')return false;
    const r=await fn.call(P,payload);
    // update() returns ok:false when the card is already gone (the user swiped
    // it away, or iOS reclaimed it). Start it again rather than going silent
    // for the rest of the shift.
    if(started&&r&&r.ok===false&&typeof P.start==='function')await P.start(payload);
    _liveLast[channel]=sig;
    return true;
  }catch(_e){return false;}
}

async function _liveActEnd(channel){
  delete _liveLast[channel];
  _liveActDropToken(channel);
  const P=_liveActPlugin();
  if(!P||typeof P.end!=='function')return;
  try{await P.end({channel});}catch(_e){}
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
        startedAt:Math.floor(Date.now()/1000),tint:_LIVE_TINT.clock}
    }}).then(()=>{},()=>{});
  }catch(_e){}
}

// Sign-out, account switch, or a boot that finds cards from a previous session.
// A drive card outliving its session would leave one client's name on the lock
// screen after the phone changes hands, which is the same exposure the handoff
// lock exists to prevent.
async function _liveActEndAll(){
  Object.keys(_liveLast).forEach(k=>delete _liveLast[k]);
  _liveActDropToken(null);   // all channels: the session is over
  const P=_liveActPlugin();
  if(!P||typeof P.endAll!=='function')return;
  try{await P.endAll();}catch(_e){}
}

// ── The clock card ───────────────────────────────────────────────────────────
// Started once when the clock starts and left alone: iOS ticks it. Called by
// clockIn/clockOut in js/jobs.js.
function _liveActClockIn(t){
  if(!t)return;
  const who=t.clientName||t.jobName||'Job';
  const what=t.scopeLabel||t.jobName||'';
  _liveActSet('clock',{
    kind:'CLOCKED IN',
    title:who,
    // Never repeat the title underneath it; on a lock screen that reads as a
    // rendering bug rather than emphasis.
    detail:(what&&what!==who)?what:'',
    timer:true,
    startedAt:Math.floor((t.startTime||Date.now())/1000),
    tint:_LIVE_TINT.clock
  });
}
function _liveActClockOut(){_liveActEnd('clock');}

// ── The drive card ───────────────────────────────────────────────────────────
// Driven by the same state the dashboard's DRIVING banner reads, so the lock
// screen and the app can never disagree. Called from the geo engine's ping
// handler; it is safe to call on every ping because _liveActSet drops
// unchanged ones.
function _liveActDrive(){
  let driving=false;
  try{driving=(typeof _geoDriving==='function')&&_geoDriving();}catch(_e){driving=false;}
  if(!driving){
    if(_liveLast.drive!=null)_liveActEnd('drive');
    return;
  }
  let miles=0,steps=0;
  try{miles=Number(_geoDriveMiles)||0;steps=Number(_geoDriveSteps)||0;}catch(_e){}
  // The SAME words the dashboard's DRIVING card uses: "On the road", and where
  // the leg started. The engine tracks an origin, not a destination, so
  // promising a destination here would be inventing one, and the lock screen
  // and the app would disagree the moment the guess was wrong.
  let org='';
  try{org=(typeof _geoLegOrigin!=='undefined'&&_geoLegOrigin&&_geoLegOrigin.name)?String(_geoLegOrigin.name):'';}catch(_e){org='';}
  // Under a handful of accumulation hops the tally is a guess, not a road
  // trace (geo-track.js's own honesty rule), so the number is withheld rather
  // than shown wrong on a lock screen the contractor cannot correct. Rounded
  // to a tenth, which is also the granularity that keeps updates rare.
  const value=steps>=3?(miles.toFixed(1)+' mi'):'logging';
  _liveActSet('drive',{
    kind:'DRIVING',
    title:'On the road',
    detail:org?('From '+org):'Mileage is logging',
    value,
    timer:false,
    tint:_LIVE_TINT.drive
  });
}
