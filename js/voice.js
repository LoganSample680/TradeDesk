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
  _voiceSeg='';
  _voiceOnText=onText;
  try{
    if(_voiceListener&&_voiceListener.remove)_voiceListener.remove();
    _voiceListener=await P.addListener('partial',(ev)=>{
      const heard=(ev&&ev.text)||'';
      _voiceLastHeard=Date.now();
      const joined=_voiceAccept(heard);
      if(_voiceTargetEl)_voiceTargetEl.value=joined;
      if(typeof _voiceOnText==='function')_voiceOnText(joined,heard);
      // The phone closed this stretch of speech (a pause). Carry on listening
      // from where the words are now.
      if(ev&&ev.final&&_voiceActive)_voiceResume();
    });
    await P.start();
    _voiceActive=true;_voiceLastHeard=Date.now();_voiceLastStart=Date.now();
    _voiceWatch();
    if(typeof _tdHaptic==='function')_tdHaptic('tap');
    return true;
  }catch(_e){_voiceActive=false;return false;}
}

// STAYING ON THROUGH A PAUSE (owner, 2026-09-26: "Talk to Tim failed to
// pickup what I was doing just now"). iOS ends a recognition session on its
// own: after a few seconds of silence, on an error, or when it decides the
// sentence is over. The native side then stops the mic and says nothing, so the
// panel went on saying "Tim is listening" while nothing after the pause was
// heard. A man working while he talks pauses all the time.
//
// So while dictation is meant to be on, a session that has gone quiet is
// started again. The field already holds every word heard so far (the partial
// handler writes it), so a restart builds on it and loses nothing. Restarting
// in silence costs nothing; words only stream while he is talking, so four
// quiet seconds means either he is thinking or the phone gave up, and a fresh
// session is right for both.
let _voiceActive=false,_voiceLastHeard=0,_voiceLastStart=0,_voiceWatchTimer=null,_voiceOnText=null,_voiceResuming=false;
function _voiceWatch(){
  if(_voiceWatchTimer)clearInterval(_voiceWatchTimer);
  _voiceWatchTimer=setInterval(()=>{
    if(!_voiceActive){clearInterval(_voiceWatchTimer);_voiceWatchTimer=null;return;}
    const now=Date.now();
    if(now-_voiceLastHeard>4000&&now-_voiceLastStart>4000)_voiceResume();
  },1000);
}
async function _voiceResume(){
  const P=_voicePlugin();
  if(!P||!_voiceActive||_voiceResuming||!_voiceTargetEl)return;
  _voiceResuming=true;
  try{
    _voiceBaseText=_voiceJoin(_voiceBaseText,_voiceSeg);_voiceSeg='';
    _voiceLastStart=Date.now();
    await P.start();
    // Stopped while this restart was on its way: turn the mic back off, or
    // it would stay open with nobody listening to it.
    if(!_voiceActive){try{await P.stop();}catch(_e){}}
  }catch(_e){}
  finally{_voiceResuming=false;}
}

async function _voiceStop(){
  const P=_voicePlugin();
  _voiceActive=false;
  if(_voiceWatchTimer){clearInterval(_voiceWatchTimer);_voiceWatchTimer=null;}
  if(!P)return '';
  let text='';
  try{const r=await P.stop();text=(r&&r.text)||'';}catch(_e){}
  try{if(_voiceListener&&_voiceListener.remove)_voiceListener.remove();}catch(_e){}
  _voiceListener=null;_voiceOnText=null;
  const joined=_voiceAccept(text);
  if(_voiceTargetEl){
    _voiceTargetEl.value=joined;
    // Fire input so anything listening (autosave, validation, character
    // counts) reacts exactly as it would to typing.
    try{_voiceTargetEl.dispatchEvent(new Event('input',{bubbles:true}));}catch(_e){}
    try{_voiceTargetEl.dispatchEvent(new Event('change',{bubbles:true}));}catch(_e){}
  }
  _voiceTargetEl=null;_voiceBaseText='';_voiceSeg='';
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
let _voiceSeg='';
function _voiceWords(t){return String(t||'').toLowerCase().replace(/[^a-z0-9' ]+/g,' ').split(/\s+/).filter(Boolean);}
function _voiceAccept(heard){
  const h=String(heard||'').trim();
  if(!h)return _voiceJoin(_voiceBaseText,_voiceSeg);
  if(_voiceSeg){
    const a=_voiceWords(_voiceSeg),b=_voiceWords(h);
    let k=0;while(k<a.length&&k<b.length&&a[k]===b[k])k++;
    if(k===b.length&&b.length<a.length)return _voiceJoin(_voiceBaseText,_voiceSeg);
    if(k===0&&b.length<a.length)_voiceBaseText=_voiceJoin(_voiceBaseText,_voiceSeg);
  }
  _voiceSeg=h;
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
