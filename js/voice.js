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

async function _voiceReady(){
  const P=_voicePlugin();
  if(!P||typeof P.available!=='function')return false;
  try{
    const a=await P.available();
    if(a&&a.status==='granted')return true;
    if(a&&a.status==='denied')return false;
    if(typeof P.request!=='function')return false;
    const r=await P.request();
    return !!(r&&r.granted);
  }catch(_e){return false;}
}

let _voiceListener=null;
let _voiceTargetEl=null;
let _voiceBaseText='';

// Start dictating into a field. The text already in it is kept: a spoken note
// appends to what is typed, it never wipes it, because losing a typed note to
// a mis-tap would end the feature's career immediately.
async function _voiceStart(el,onText){
  const P=_voicePlugin();
  if(!P||!el)return false;
  if(!(await _voiceReady()))return false;
  _voiceTargetEl=el;
  _voiceBaseText=String(el.value||'');
  try{
    if(_voiceListener&&_voiceListener.remove)_voiceListener.remove();
    _voiceListener=await P.addListener('partial',(ev)=>{
      const heard=(ev&&ev.text)||'';
      const joined=_voiceJoin(_voiceBaseText,heard);
      if(_voiceTargetEl)_voiceTargetEl.value=joined;
      if(typeof onText==='function')onText(joined,heard);
    });
    await P.start();
    if(typeof _tdHaptic==='function')_tdHaptic('tap');
    return true;
  }catch(_e){return false;}
}

async function _voiceStop(){
  const P=_voicePlugin();
  if(!P)return '';
  let text='';
  try{const r=await P.stop();text=(r&&r.text)||'';}catch(_e){}
  try{if(_voiceListener&&_voiceListener.remove)_voiceListener.remove();}catch(_e){}
  _voiceListener=null;
  const joined=_voiceJoin(_voiceBaseText,text);
  if(_voiceTargetEl){
    _voiceTargetEl.value=joined;
    // Fire input so anything listening (autosave, validation, character
    // counts) reacts exactly as it would to typing.
    try{_voiceTargetEl.dispatchEvent(new Event('input',{bubbles:true}));}catch(_e){}
    try{_voiceTargetEl.dispatchEvent(new Event('change',{bubbles:true}));}catch(_e){}
  }
  _voiceTargetEl=null;_voiceBaseText='';
  if(typeof _tdHaptic==='function')_tdHaptic(text?'win':'warn');
  return joined;
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
