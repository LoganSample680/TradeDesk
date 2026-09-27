// ── Voice notes (owner 2026-08-11) ───────────────────────────────────────────
// A contractor's hands are full and their eyes are on the work. Hold the mic,
// talk, let go: the words land in the field, still editable.
//
// Transcribed ON the phone (js side asks for it, the plugin enforces it), so
// it costs nothing per note, works in a crawlspace with no bars, and the audio
// never leaves the device. That last part matters: these notes are said out
// loud in a client's home.
//
// The mic is attached to FIELDS, not built into one screen, so the same
// control shows up wherever a note is written: the on-site card, job notes,
// the gate-code field note, expenses, change orders.

function _voicePlugin(){
  try{
    const cap=window.Capacitor;
    if(!cap||typeof cap.isNativePlatform!=='function'||!cap.isNativePlatform())return null;
    if(typeof cap.registerPlugin==='function')return cap.registerPlugin('TdVoice');
    return (cap.Plugins&&cap.Plugins.TdVoice)||null;
  }catch(_e){return null;}
}

// Cheap synchronous answer for render paths: is a mic button worth drawing at
// all? The real permission check happens on first press.
function _voiceCapable(){return !!_voicePlugin();}

// What this build of the plugin says it can do. A build from 2026-09-27 on
// reports an "ended" event (available().events), and seeing one arrive proves
// it too. An older build reports nothing and keeps the quiet restart below,
// unchanged, so nothing regresses on a phone that has not updated the app.
let _voiceEndedCap=false;
function _voiceReadCaps(a){
  if(a&&Array.isArray(a.events)&&a.events.indexOf('ended')>=0)_voiceEndedCap=true;
}

async function _voiceReady(){
  const P=_voicePlugin();
  if(!P||typeof P.available!=='function')return false;
  try{
    const a=await P.available();
    _voiceReadCaps(a);
    if(a&&a.status==='granted')return true;
    if(a&&a.status==='denied')return false;
    if(typeof P.request!=='function')return false;
    const r=await P.request();
    return !!(r&&r.granted);
  }catch(_e){return false;}
}

let _voiceListener=null,_voiceEndListener=null;
let _voiceTargetEl=null;
let _voiceBaseText='';
// The generation the phone numbered the current session with (0: an old build
// that does not number them). Words from an older number are a session that
// was already replaced, and are not his latest words.
let _voiceGen=0;
// '' while listening. 'hidden' when the page went away (screen lock, a phone
// call, another app), 'failed' when the mic would not start again. Either way
// the mic is OFF and the panel says so, instead of "Tim is listening" over
// nothing (the Earl audit, 2026-09-27).
let _voicePaused='';
let _voiceOnState=null;

// Start dictating into a field. The text already in it is kept: a spoken note
// appends to what is typed, it never wipes it, because losing a typed note to
// a mis-tap would end the feature's career immediately.
//
// onState (optional) hears {paused, reason} whenever listening stops or starts
// again on its own, so a screen can say so.
async function _voiceStart(el,onText,onState){
  const P=_voicePlugin();
  if(!P||!el)return false;
  if(!(await _voiceReady()))return false;
  _voiceTargetEl=el;
  _voiceBaseText=String(el.value||'');
  _voiceSeg='';_voiceSegAt=0;_voiceGen=0;_voicePaused='';
  _voiceOnText=onText;
  _voiceOnState=typeof onState==='function'?onState:null;
  try{
    _voiceDropListeners();
    // "ended" first, "partial" second. An old build never sends "ended", and a
    // test double that keeps one callback keeps the last one registered.
    try{_voiceEndListener=await P.addListener('ended',_voiceOnEnded);}catch(_e){_voiceEndListener=null;}
    _voiceListener=await P.addListener('partial',_voiceOnPartial);
    const r=await P.start();
    _voiceGen=Number(r&&r.gen)||0;
    _voiceActive=true;_voiceLastHeard=Date.now();_voiceLastStart=Date.now();
    _voiceWatch();
    _voiceWakeOn();
    if(typeof _tdHaptic==='function')_tdHaptic('tap');
    return true;
  }catch(_e){_voiceActive=false;return false;}
}

function _voiceDropListeners(){
  try{if(_voiceEndListener&&_voiceEndListener.remove)_voiceEndListener.remove();}catch(_e){}
  try{if(_voiceListener&&_voiceListener.remove)_voiceListener.remove();}catch(_e){}
  _voiceEndListener=null;_voiceListener=null;
}

function _voiceShow(){
  const joined=_voiceJoin(_voiceBaseText,_voiceSeg);
  if(_voiceTargetEl)_voiceTargetEl.value=joined;
  return joined;
}

function _voiceOnPartial(ev){
  const g=Number(ev&&ev.gen)||0;
  if(g&&_voiceGen&&g<_voiceGen)return;
  if(g>_voiceGen)_voiceGen=g;
  const heard=(ev&&ev.text)||'';
  _voiceLastHeard=Date.now();
  const joined=_voiceAccept(heard);
  if(_voiceTargetEl)_voiceTargetEl.value=joined;
  if(typeof _voiceOnText==='function')_voiceOnText(joined,heard);
  // An old build: the phone closed this stretch of speech (a pause) and will
  // say nothing more, so carry on listening from where the words are now. A
  // new build says "ended" right after this, and the restart waits for that.
  if(ev&&ev.final&&_voiceActive&&!_voiceEndedCap)_voiceResume();
}

// THE PHONE SAYS THE SESSION IS OVER (2026-09-27). iOS ends a session on a
// final result, an error, or its one minute limit. Everything it heard is in
// the event, so it is kept (never shorter than what is on screen), closed off
// as a finished stretch, and only THEN is the mic opened again. This is the
// only thing that restarts listening on a build that sends it: the audit saw
// 332 restarts in 13 minutes from guessing at silence, and each one could
// swallow the first word said into it.
function _voiceOnEnded(ev){
  _voiceEndedCap=true;
  if(!_voiceTargetEl)return;
  const g=Number(ev&&ev.gen)||0;
  if(g&&_voiceGen&&g!==_voiceGen)return;
  const t=String((ev&&ev.text)||'').trim();
  if(t){
    const a=_voiceWords(_voiceSeg),b=_voiceWords(t);
    let k=0;while(k<a.length&&k<b.length&&a[k]===b[k])k++;
    // Grown, or the same sentence refined: the session's own last word wins.
    // Anything else it says is already on screen, so nothing is lost by
    // keeping what is there.
    if(!a.length||k===a.length||(k>0&&b.length>=a.length))_voiceSeg=t;
  }
  _voiceBaseText=_voiceJoin(_voiceBaseText,_voiceSeg);_voiceSeg='';_voiceSegAt=0;
  const joined=_voiceShow();
  if(typeof _voiceOnText==='function')_voiceOnText(joined,t);
  if(_voiceActive&&!_voicePaused)_voiceResume();
}

// STAYING ON THROUGH A PAUSE (owner, 2026-09-26: "Talk to Tim failed to
// pickup what I was doing just now"). iOS ends a recognition session on its
// own: after a few seconds of silence, on an error, or when it decides the
// sentence is over. An app build from before 2026-09-27 then stops the mic and
// says nothing, so the panel went on saying "Tim is listening" while nothing
// after the pause was heard.
//
// ON THOSE BUILDS ONLY, a session that has gone quiet is started again. The
// field already holds every word heard so far, so a restart builds on it.
// A build that sends "ended" never restarts on quiet (see _voiceOnEnded):
// silence there is a man thinking, and the phone is still listening.
const _VOICE_QUIET_MS=1500;
let _voiceActive=false,_voiceLastHeard=0,_voiceLastStart=0,_voiceWatchTimer=null,_voiceOnText=null,_voiceResuming=false;
function _voiceWatch(){
  if(_voiceWatchTimer)clearInterval(_voiceWatchTimer);
  _voiceWatchTimer=setInterval(()=>{
    if(!_voiceActive){clearInterval(_voiceWatchTimer);_voiceWatchTimer=null;return;}
    if(_voiceEndedCap||_voicePaused==='hidden')return;
    const now=Date.now();
    // 1.5 seconds, not 4 (owner 2026-09-27: "still cut themselves off like a
    // second after I pause"). An old build often ends the session on a pause
    // WITHOUT a final result, so this silence is the only sign it has gone.
    if(now-_voiceLastHeard>_VOICE_QUIET_MS&&now-_voiceLastStart>_VOICE_QUIET_MS)_voiceResume();
  },250);
}
async function _voiceResume(){
  const P=_voicePlugin();
  if(!P||!_voiceActive||_voiceResuming||!_voiceTargetEl)return;
  _voiceResuming=true;
  try{
    _voiceBaseText=_voiceJoin(_voiceBaseText,_voiceSeg);_voiceSeg='';_voiceSegAt=0;
    _voiceLastStart=Date.now();
    const r=await P.start();
    const g=Number(r&&r.gen)||0;
    if(g)_voiceGen=g;
    // Stopped, or the page went away, while this restart was on its way: turn
    // the mic back off, or it would stay open with nobody listening to it.
    if(!_voiceActive||_voicePaused==='hidden'){try{await P.stop();}catch(_e){}}
    else if(_voicePaused)_voiceSetPaused('');
  }catch(_e){
    // It would not start (the audio session is taken by a call, the
    // recogniser is busy). Say so on the panel rather than pretend.
    if(_voiceActive)_voiceSetPaused('failed');
  }
  finally{_voiceResuming=false;}
}

function _voiceSetPaused(reason){
  const r=reason||'';
  if(r===_voicePaused)return;
  _voicePaused=r;
  if(r)_voiceWakeOff();else _voiceWakeOn();
  if(typeof _voiceOnState==='function'){try{_voiceOnState({paused:!!r,reason:r});}catch(_e){}}
}
function _voiceIsPaused(){return !!(_voiceActive&&_voicePaused);}

// Are these words already the end of what is on screen? The phone's stop
// hands back its last session's text, which after an "ended" is already kept.
function _voiceHasTail(t){
  const a=_voiceWords(_voiceJoin(_voiceBaseText,_voiceSeg)),b=_voiceWords(t);
  if(!b.length)return true;
  if(b.length>a.length)return false;
  for(let i=1;i<=b.length;i++)if(a[a.length-i]!==b[b.length-i])return false;
  return true;
}

// The page went away: screen locked, a phone call, another app. The mic is
// turned off (it cannot hear through a lock screen and it should not try
// through a call), every word so far is kept, and the panel says Paused.
async function _voicePauseMic(reason){
  if(!_voiceActive)return;
  _voiceSetPaused(reason||'hidden');
  const P=_voicePlugin();
  if(!P)return;
  let t='';
  try{const r=await P.stop();t=(r&&r.text)||'';}catch(_e){}
  if(t&&!(!_voiceSeg&&_voiceHasTail(t)))_voiceAccept(t);
  _voiceBaseText=_voiceJoin(_voiceBaseText,_voiceSeg);_voiceSeg='';_voiceSegAt=0;
  _voiceShow();
}

// "Paused, tap to keep going".
async function _voiceKeepGoing(){
  if(!_voiceActive)return false;
  _voicePaused='';
  _voiceLastHeard=Date.now();
  await _voiceResume();
  if(!_voicePaused){
    _voiceWakeOn();
    if(typeof _voiceOnState==='function'){try{_voiceOnState({paused:false,reason:''});}catch(_e){}}
  }
  return !_voicePaused;
}

function _voiceOnVisibility(){
  if(!_voiceActive)return;
  if(document.visibilityState==='hidden')_voicePauseMic('hidden');
}
if(typeof document!=='undefined'&&document.addEventListener)document.addEventListener('visibilitychange',_voiceOnVisibility);

// THE SCREEN STAYS ON WHILE HE TALKS. A man describing a job with the phone on
// the counter does not touch it, and a screen that locks at thirty seconds
// took the mic with it. This is the app's one wake lock (js/pwa.js, the one a
// drive and the estimate page already hold), not a second one: listening is
// one more reason to hold it (_wakeLockShouldHold), and stopping or pausing
// lets it go only when nothing else still wants it. Where the browser has no
// wake lock, pwa.js does nothing and nothing breaks.
function _voiceHoldsWake(){return !!(_voiceActive&&!_voicePaused);}
function _voiceWakeOn(){
  if(!_voiceHoldsWake()||document.visibilityState==='hidden')return;
  try{if(typeof _wakeLockRequest==='function')Promise.resolve(_wakeLockRequest()).catch(()=>{});}catch(_e){}
}
function _voiceWakeOff(){
  try{
    if(typeof _wakeLockRelease!=='function')return;
    if(typeof _wakeLockShouldHold==='function'&&_wakeLockShouldHold())return;
    Promise.resolve(_wakeLockRelease()).catch(()=>{});
  }catch(_e){}
}

async function _voiceStop(){
  const P=_voicePlugin();
  _voiceActive=false;
  _voicePaused='';_voiceOnState=null;
  if(_voiceWatchTimer){clearInterval(_voiceWatchTimer);_voiceWatchTimer=null;}
  _voiceWakeOff();
  if(!P)return '';
  let text='';
  try{const r=await P.stop();text=(r&&r.text)||'';}catch(_e){}
  _voiceDropListeners();
  _voiceOnText=null;
  // The phone's last session, already kept by "ended" or a pause: not twice.
  if(text&&!_voiceSeg&&_voiceHasTail(text))text='';
  const joined=_voiceAccept(text);
  if(_voiceTargetEl){
    _voiceTargetEl.value=joined;
    // Fire input so anything listening (autosave, validation, character
    // counts) reacts exactly as it would to typing.
    try{_voiceTargetEl.dispatchEvent(new Event('input',{bubbles:true}));}catch(_e){}
    try{_voiceTargetEl.dispatchEvent(new Event('change',{bubbles:true}));}catch(_e){}
  }
  _voiceTargetEl=null;_voiceBaseText='';_voiceSeg='';_voiceSegAt=0;_voiceGen=0;
  if(typeof _tdHaptic==='function')_tdHaptic(joined?'win':'warn');
  return joined;
}

// WORDS ARE ONLY EVER ADDED (owner, 2026-09-26: "It did then half of them
// disappeared and when I stopped never put them in the description bar").
// The phone reports the words of the CURRENT stretch of speech, and after a
// pause the on-device recogniser starts a new stretch: its text starts over
// from the new words. Written straight into the field, that replaced the first
// half of what he said; and a last empty result at the stop replaced the rest
// with nothing.
//
// So each result is read against the one before it. The same start is the
// recogniser refining its guess, and replaces it. A different start, shorter
// than what was there, is a new stretch: what was there is kept for good and
// the new words go after it. An empty result, or one that is only the start
// of what is already shown, changes nothing.
//
// A NEW STRETCH CAN START WITH THE SAME WORD (owner 2026-09-27: "I lose the
// first half of what I said"). "I pulled the heater" then, after a pause, "I
// set the tankless": both start with "I", so the old rule read the second as
// the recogniser refining the first and wrote it over the top. Now a shorter
// result that does not carry all of what is shown is a new stretch when it
// shares nothing at the start OR when it arrives after a pause (the stretch on
// screen has not grown for a moment). A refinement mid-sentence comes in the
// same breath, so it still replaces.
let _voiceSeg='',_voiceSegAt=0;
const _VOICE_STRETCH_GAP_MS=700;
function _voiceWords(t){return String(t||'').toLowerCase().replace(/[^a-z0-9' ]+/g,' ').split(/\s+/).filter(Boolean);}
function _voiceAccept(heard){
  const h=String(heard||'').trim();
  if(!h)return _voiceJoin(_voiceBaseText,_voiceSeg);
  const now=Date.now();
  if(_voiceSeg){
    const a=_voiceWords(_voiceSeg),b=_voiceWords(h);
    let k=0;while(k<a.length&&k<b.length&&a[k]===b[k])k++;
    // Only the start of what is already shown: nothing new yet.
    if(k===b.length&&b.length<a.length)return _voiceJoin(_voiceBaseText,_voiceSeg);
    const paused=_voiceSegAt&&(now-_voiceSegAt)>=_VOICE_STRETCH_GAP_MS;
    if(b.length<a.length&&k<a.length&&(k===0||paused))_voiceBaseText=_voiceJoin(_voiceBaseText,_voiceSeg);
  }
  _voiceSeg=h;_voiceSegAt=now;
  return _voiceJoin(_voiceBaseText,h);
}

// Join existing text and dictated text like a person would: one space, and a
// sentence break when the existing note already ended in one.
function _voiceJoin(base,heard){
  const b=String(base||'').replace(/\s+$/,'');
  const h=String(heard||'').trim();
  if(!h)return b;
  if(!b)return h;
  return /[.!?]$/.test(b)?(b+' '+h):(b+' '+h);
}

// Attach a hold-to-talk mic to any input or textarea. Returns the button so
// callers can place it, or null when this device cannot dictate (browser,
// PWA, no permission), in which case nothing is drawn at all rather than a
// dead control.
function _voiceMic(el,opts){
  if(!el||!_voiceCapable())return null;
  const o=opts||{};
  const b=document.createElement('button');
  b.type='button';
  b.className='td-voice-mic';
  b.setAttribute('aria-label','Hold to dictate');
  b.innerHTML='<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/></svg>';
  b.style.cssText=o.style||'display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:50%;border:1.5px solid var(--border);background:var(--card);color:var(--text2);flex-shrink:0';
  let live=false;
  const begin=async(ev)=>{
    ev.preventDefault();
    if(live)return;
    live=true;
    b.style.background='#A32D2D';b.style.color='#fff';b.style.borderColor='#A32D2D';
    const ok=await _voiceStart(el,o.onText);
    if(!ok){
      live=false;
      b.style.background='var(--card)';b.style.color='var(--text2)';b.style.borderColor='var(--border)';
      if(typeof showToast==='function')showToast('Turn on Microphone and Speech Recognition for TradeDesk in Settings','🎤',5000);
    }
  };
  const end=async(ev)=>{
    if(ev)ev.preventDefault();
    if(!live)return;
    live=false;
    b.style.background='var(--card)';b.style.color='var(--text2)';b.style.borderColor='var(--border)';
    const text=await _voiceStop();
    if(typeof o.onDone==='function')o.onDone(text);
  };
  // Pointer events cover finger, stylus and mouse in one path; the cancel and
  // leave cases matter because a thumb sliding off the button must stop the
  // recording, not leave the mic open in someone's kitchen.
  b.addEventListener('pointerdown',begin);
  b.addEventListener('pointerup',end);
  b.addEventListener('pointercancel',end);
  b.addEventListener('pointerleave',end);
  return b;
}

// Convenience for render code: put a mic at the end of a field's row.
function _voiceAttach(inputId,opts){
  const el=document.getElementById(inputId);
  if(!el)return null;
  if(el.parentElement&&el.parentElement.querySelector('.td-voice-mic'))return null; // already wired
  const b=_voiceMic(el,opts);
  if(!b)return null;
  const host=(opts&&opts.host)||el.parentElement;
  if(!host)return null;
  host.appendChild(b);
  return b;
}
