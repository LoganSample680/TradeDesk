// ── Handoff lock (owner 2026-08-11, after the Face ID research) ──────────────
// The research question was "do contractors want an app they have to sign into
// all the time?" The answer from the field is no: per-open friction breeds
// shared logins and workarounds, and the phone is already Face ID locked, so a
// second launch lock buys nothing.
//
// The moment that IS exposed is the handoff: the contractor passes their
// UNLOCKED phone to a client to sign, and every other client, every margin,
// payroll and the bank connection are one back-swipe away. So the lock is
// scoped to exactly that: while a client is signing, leaving the signature
// screen takes the owner's face.
//
// Zero daily friction, one real risk closed.
//
// Gated to the native shell on purpose: sign.html and client.html run this
// same esign code on the CLIENT's own device, where there is nothing of ours
// to protect and a Face ID prompt would be alarming.

function _lockPlugin(){
  try{
    const cap=window.Capacitor;
    if(!cap||typeof cap.isNativePlatform!=='function'||!cap.isNativePlatform())return null;
    if(typeof cap.registerPlugin==='function')return cap.registerPlugin('TdLock');
    return (cap.Plugins&&cap.Plugins.TdLock)||null;
  }catch(_e){return null;}
}

let _handoffArmed=false;
let _handoffPrompting=false;
function _handoffActive(){return !!_handoffArmed;}

// Armed when a signature pad opens in the contractor's app. Off by default
// for anyone who does not want it (S.handoffLock===false), because a solo
// operator who never hands the phone over should not meet a Face ID prompt.
function _handoffArm(){
  if(!_lockPlugin())return false;                       // client portals never arm
  try{if(typeof S!=='undefined'&&S&&S.handoffLock===false)return false;}catch(_e){}
  _handoffArmed=true;
  try{document.body.classList.add('td-handoff');}catch(_e){}
  return true;
}

// Called when the signature is done (or abandoned by the owner, post-unlock).
function _handoffDisarm(){
  _handoffArmed=false;
  try{document.body.classList.remove('td-handoff');}catch(_e){}
}

// The gate. Returns true when it is safe to proceed (not armed, or the owner
// just proved it is them). NEVER traps: a phone with no biometrics and no
// passcode resolves ok, and a cancelled prompt simply keeps the client on the
// signature screen, which is where they belong anyway.
async function _handoffRelease(reason){
  if(!_handoffArmed)return true;
  if(_handoffPrompting)return false;                    // one prompt at a time
  const P=_lockPlugin();
  if(!P||typeof P.unlock!=='function'){_handoffDisarm();return true;}
  _handoffPrompting=true;
  try{
    const r=await P.unlock({reason:reason||'Unlock TradeDesk to leave the signature screen'});
    if(r&&r.ok){_handoffDisarm();return true;}
    return false;
  }catch(_e){
    // A plugin failure must not lock a contractor out of their own business.
    _handoffDisarm();
    return true;
  }finally{_handoffPrompting=false;}
}

// Navigation guard. goPg calls this first; while a client is signing, any
// attempt to leave takes the owner's face. Deliberately synchronous-safe:
// returns true to allow, false to block, and kicks off the prompt itself.
function _handoffGuardNav(id){
  if(!_handoffArmed)return true;
  _handoffRelease('Unlock TradeDesk to leave the signature screen').then(ok=>{
    if(ok&&typeof goPg==='function')goPg(id);           // resume the tap they made
  });
  return false;
}
