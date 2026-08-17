// ── Remote push (owner 2026-08-17) ───────────────────────────────────────────
//
// THE HALF td-notify CANNOT DO. Local notifications are scheduled on the phone,
// so they can only ever announce something the phone ALREADY knew: tomorrow's
// first job, an invoice that will go past due. Everything that actually happens
// while the contractor is not looking happens on a SERVER: a client signed the
// proposal, a payment landed, a crew member got dispatched to a different site.
// None of it could reach the phone until now.
//
// EVERY RULE IS HERE (CLAUDE.md 3.2). The native plugin asks permission, hands
// over the device token, and forwards taps. What gets sent, to whom, what it
// says, and where a tap lands are all below and in the send-push Edge Function,
// so copy and routing stay tunable through a UAT roll.
//
// PERMISSION IS NOT REQUESTED ON BOOT, matching js/notify.js: a permission
// prompt on first launch, before the app has done anything useful, is how an
// app gets denied forever. It is asked the first time it would actually pay
// off, which is the moment the contractor sends their first proposal (they are
// now waiting on a signature) or adds their first crew member.

function _pushPlugin(){
  try{
    const cap=window.Capacitor;
    if(!cap||typeof cap.isNativePlatform!=='function'||!cap.isNativePlatform())return null;
    if(typeof cap.registerPlugin==='function')return cap.registerPlugin('TdPush');
    return (cap.Plugins&&cap.Plugins.TdPush)||null;
  }catch(_e){return null;}
}

let _pushWired=false;

// The device token identifies THIS phone to Apple. It is stored per account so
// the server can reach every device a contractor (or their crew) signed in on,
// and it is refreshed rather than duplicated: iOS reissues the token on
// reinstall and occasionally on restore, and a stale row would send every
// message twice forever.
async function _pushSaveToken(token){
  if(!token)return false;
  try{
    if(typeof _supa==='undefined'||!_supa||!_supaUser)return false;
    const row={
      user_id:_supaUser.id,
      token:String(token),
      platform:'ios',
      // Which account's events this device should hear about. An employee
      // signed into their boss's account must get that account's dispatch
      // pushes, not their own personal account's.
      contractor_user_id:(typeof _contractorUserId!=='undefined'&&_contractorUserId)||_supaUser.id,
      updated_at:new Date().toISOString()
    };
    const{error}=await _supa.from('device_tokens').upsert(row,{onConflict:'token'});
    if(error){console.error('[push] token save: '+error.message);return false;}
    try{localStorage.setItem('zp3_push_token',String(token));}catch(_e){}
    return true;
  }catch(e){console.error('[push] token save: '+(e&&e.message||e));return false;}
}

// Where a notification tap lands. The payload carries a route the server chose,
// and this maps it onto the app's own navigation. Unknown routes fall through
// to the dashboard rather than doing nothing, because a tap that appears to do
// nothing reads as a broken app.
function _pushRoute(payload){
  if(!payload)return;
  try{
    const route=String(payload.route||payload.td_route||'');
    const id=payload.id!=null?payload.id:null;
    if(route==='bid'&&id!=null&&typeof viewBidFromTimeline==='function'){
      if(payload.client_id!=null&&typeof openClientDetail==='function')openClientDetail(Number(payload.client_id));
      viewBidFromTimeline(Number(id));
      return;
    }
    if(route==='client'&&id!=null&&typeof openClientDetail==='function'){openClientDetail(Number(id));return;}
    if(route==='job'&&typeof goPg==='function'){goPg('pg-jobs');return;}
    if(route==='money'&&typeof goPg==='function'){goPg('pg-dash');return;}
    // Siri/Shortcuts intents (owner ask 2026-08-17): the SAME dispatcher a
    // push tap already uses, not a parallel one (§7.3). td-intents drains
    // these on boot exactly like a push tap, see _pushWire below.
    if(route==='clockin'&&typeof goPg==='function'){goPg('pg-timelog');return;}
    if(route==='expense'&&typeof showQuickExpenseModal==='function'){showQuickExpenseModal(null,null);return;}
    if(route==='lead'&&typeof openNewClient==='function'){openNewClient();return;}
    if(typeof goPg==='function')goPg('pg-dash');
  }catch(e){console.error('[push] route: '+(e&&e.message||e));}
}

// Attach the listeners once. Safe to call repeatedly (boot, sign-in, account
// switch); the guard means a re-call never doubles up handlers, which would
// double-navigate on a single tap.
function _pushWire(){
  if(_pushWired)return;
  const P=_pushPlugin();
  if(!P||typeof P.addListener!=='function')return;
  _pushWired=true;
  try{
    P.addListener('token',e=>{_pushSaveToken(e&&e.token);});
    // A registration failure is not fatal and must never block anything, but it
    // is worth recording: without it, "I never get notifications" has no trail.
    P.addListener('tokenError',e=>{console.error('[push] apns register: '+((e&&e.error)||'unknown'));});
    P.addListener('tapped',e=>{_pushRoute(e&&e.payload);});
  }catch(_e){}
  // A tap can arrive before this file has run at all (a cold launch FROM the
  // notification is exactly that), so the plugin holds the last one and we
  // collect it here. Reading it clears it on the native side.
  try{
    if(typeof P.lastTap==='function')P.lastTap().then(r=>{if(r&&r.tap)_pushRoute(r.tap);}).catch(()=>{});
  }catch(_e){}
}

// Ask for permission and register. Call this at a moment the contractor can see
// the point of it, never on boot. Returns true only when a token is on its way.
async function pushEnable(){
  const P=_pushPlugin();
  if(!P||typeof P.register!=='function')return false;
  _pushWire();
  try{
    const r=await P.register();
    if(!r||!r.granted)return false;
    return true;
  }catch(_e){return false;}
}

// Has the contractor already answered the prompt? Used to decide whether an
// in-app nudge is worth showing, so we never ask twice.
async function pushStatus(){
  const P=_pushPlugin();
  if(!P||typeof P.permission!=='function')return 'unavailable';
  try{const r=await P.permission();return (r&&r.status)||'ask';}catch(_e){return 'unavailable';}
}

// Sign-out: stop this device hearing another account's events. The row is
// deleted rather than left to expire, because the next person to sign in on
// this phone would otherwise receive the previous account's pushes.
async function _pushForget(){
  _pushWired=false;
  let tok='';
  try{tok=localStorage.getItem('zp3_push_token')||'';}catch(_e){}
  if(!tok)return;
  try{
    if(typeof _supa!=='undefined'&&_supa)await _supa.from('device_tokens').delete().eq('token',tok);
  }catch(_e){}
  try{localStorage.removeItem('zp3_push_token');}catch(_e){}
}

// ── Siri / Shortcuts drain (owner ask 2026-08-17) ────────────────────────────
// Self-wiring at script load, not tied to push permission or the geo boot
// chain: an App Intent (native/td-intents/ios/AppIntents/TdAppIntents.swift)
// can launch the app cold, before any sign-in-triggered init has run, and it
// stashes its route regardless of whether push notifications were ever
// enabled. Routes through the SAME dispatcher a push tap uses (_pushRoute,
// §7.3), never a parallel one.
function _intentsPlugin(){
  try{
    const cap=window.Capacitor;
    if(!cap||typeof cap.isNativePlatform!=='function'||!cap.isNativePlatform())return null;
    if(typeof cap.registerPlugin==='function')return cap.registerPlugin('TdIntents');
    return (cap.Plugins&&cap.Plugins.TdIntents)||null;
  }catch(_e){return null;}
}
(function(){
  const P=_intentsPlugin();
  if(!P||typeof P.drain!=='function')return;
  P.drain().then(r=>{if(r&&r.route)_pushRoute({route:r.route});}).catch(()=>{});
})();
