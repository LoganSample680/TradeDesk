// ─────────────────────────────────────────────────────────────────────────────
// WHAT TIM WAS TOLD, WHAT HE MADE OF IT, AND WHAT HE COULD NOT PLACE.
//
// Owner ask, 2026-09-20, in his words: "I just want him to understand what I'm
// saying and we can log how he's being interacted with so if somebody asks
// something he doesn't know we can make those improvements."
//
// The night that produced this ask: Tim did nothing on a sentence, and there
// was no record of the sentence anywhere, so there was nothing to diagnose.
// Tim writes to no server and holds no history by design (§18.3), and the cost
// of that showed up the first time it mattered. This is the fix, and it keeps
// the rule: a capped ring buffer in localStorage on this phone, exactly the
// shape _geoParkNote uses in js/geo-track.js and for the same stated reason,
// "the difference between 'the rule is wrong' and 'the rule never executed'".
// Nothing here syncs. js/observability.js exists and ships to an edge function,
// and it is deliberately NOT the channel used here: that pipeline anonymizes
// the contractor and enforces a central no-PII rule, and every line of this log
// is customer names, site addresses and prices.
//
// WHAT MAKES IT USEFUL IS NOT THE TRANSCRIPT. A list of sentences still has to
// be read by eye. Tim already knows when he failed: _timGo hands back kind
// 'none' when nothing in the sentence resolved, and the words left over after
// the stage, material and book matchers have each had their pass are the ones
// he has no answer for. Those are the improvement queue, written by him,
// without the man holding the phone having to grade anything.
// ─────────────────────────────────────────────────────────────────────────────

const _TIM_LOG_KEY='td_tim_log';
// Sixty is a couple of weeks of real use for one man and a few hundred bytes.
// The cap is the point: an uncapped log on a phone is a slow leak, and the
// hundredth sentence is never the one being diagnosed.
const _TIM_LOG_MAX=60;

let _timLog=(function(){
  try{const r=JSON.parse(localStorage.getItem(_TIM_LOG_KEY));return Array.isArray(r)?r:[];}
  catch(_e){return [];}
})();

function _timLogWrite(){
  try{localStorage.setItem(_TIM_LOG_KEY,JSON.stringify(_timLog));}catch(_e){}
}

// ── Did Tim's knowledge even load? ───────────────────────────────────────────
// The failure this whole file was written after looked exactly like a parsing
// bug and was probably not one: the release added three new script tags to
// index.html, and a service worker serving a cached index.html would leave the
// surface working and the knowledge absent. Tim would open, take a sentence,
// and do nothing with it, which is indistinguishable from Tim being stupid
// unless something says which. This says which, in one look.
function timLogLoaded(){
  return {
    knowledge:typeof timReadJob==='function',
    nudge:typeof timNudges==='function',
    book:typeof openTimBook==='function',
  };
}

function timLogAllLoaded(){
  const l=timLogLoaded();
  return !!(l.knowledge&&l.nudge&&l.book);
}

// ── The words he could not place ─────────────────────────────────────────────
// Deliberately generous about what counts as placed, because a miss list that
// cries wolf gets ignored and then the real misses are invisible. A word counts
// as placed if it appears ANYWHERE in anything Tim produced, including inside a
// longer word: he said "paint", the book line reads "repaint", that is placed.
// Under-reporting a miss costs one round of looking. Over-reporting costs the
// list its credibility.
const _TIM_LOG_SKIP=new Set([
  'the','and','for','you','your','our','are','was','were','been','has','have',
  'had','will','would','can','could','should','with','that','this','these',
  'those','then','than','but','not','its','his','her','their','them','they',
  'him','she','who','what','when','where','why','how','get','got','goes',
  'going','put','set','take','took','want','wants','need','needs','like',
  'just','also','plus','out','off','all','any','one','some','from','into',
  'over','under','about','around','there','here','job','jobs','work','works',
  'thing','stuff','okay','yeah','yes','let','lets','make','made','said','say',
]);

function _timLogWords(text){
  return _timkNorm(text).trim().split(' ').filter(w=>w.length>2&&!_TIM_LOG_SKIP.has(w));
}

// Everything Tim produced, flattened into one string to test words against.
function _timLogPlaced(job){
  let s=' ';
  if(!job)return s;
  try{
    (job.order||[]).forEach(x=>{s+=_timkNorm(x.text);});
    (job.fromBook||[]).forEach(x=>{s+=_timkNorm(x.text);});
    (job.materials||[]).forEach(m=>{s+=_timkNorm(m.heard||'')+_timkNorm(m.label||'');});
    (job.implied||[]).forEach(r=>{s+=_timkNorm(r.because||'')+_timkNorm(r.step||'');});
    if(job.client&&job.client.name)s+=_timkNorm(job.client.name);
    if(job.type)s+=_timkNorm(job.type==='tm'?'t and m time and materials':'proposal bid');
  }catch(_e){}
  return s;
}

function timLogGaps(said,job){
  const placed=_timLogPlaced(job);
  const seen=new Set();
  return _timLogWords(said).filter(w=>{
    if(seen.has(w))return false;
    seen.add(w);
    return placed.indexOf(w)<0;
  });
}

// ── One line saying what he did with it ──────────────────────────────────────
// Kept short and in the same plain words the rest of Tim uses, because this is
// read on a phone next to the sentence it describes.
function _timLogGot(outcome,job){
  const o=outcome||{};
  if(o.kind==='build'){
    const s=(typeof TIM_STYLES!=='undefined'&&Array.isArray(TIM_STYLES))
      ? TIM_STYLES.find(x=>x.id===o.style):null;
    return 'Opened '+((s&&s.n)||'a proposal');
  }
  if(o.kind==='read'&&job){
    const n=(job.order||[]).length,m=(job.materials||[]).length;
    return n+(n===1?' step, ':' steps, ')+m+(m===1?' supply, ':' supplies, ')+(job.hours||0)+' hrs';
  }
  // The ANSWER, not the fact that there was one. "$4,400" is what he said;
  // "Answered off your own numbers" is a status line about himself, and a
  // thread full of those reads like a machine describing its own paperwork.
  if(o.kind==='ask')return o.title?String(o.title):'Answered off your own numbers';
  if(o.kind==='nav')return o.name?('Opened '+o.name):'Opened the screen';
  if(o.kind==='newclient')return 'Started a new customer';
  // Not "I could not place that one." That is a dead end: it reports the
  // failure and hands the man nothing, and he is left retyping blind. Same
  // fact, plus the way out, in the words the answers are actually keyed on.
  if(o.kind==='none')return 'Not one I know yet. Try what you are owed, what you charged, or what is out.';
  return o.kind?('Went to '+o.kind):'Nothing';
}

// ── The thread ───────────────────────────────────────────────────────────────
//
// Owner, 2026-09-21, after firing off three questions and watching the sheet go
// back to its opening line: "this is what tim did, nothing... it should be a
// text block that goes center aligned and I can see the last messages with
// him."
//
// He was right that it looked like nothing, and the reason is worse than a
// missing feature. Two of the three possible outcomes left NO trace on the
// sheet: a sentence Tim could not place got a 2.6 second toast, and a sentence
// he could place closed the sheet and navigated away. Either way, opening him
// again showed the same blank opening line, so three questions with three
// different outcomes were indistinguishable from being ignored.
//
// Every one of those exchanges was already in this log. It was just filed in a
// diagnostics sheet behind a tap, which is the wrong place for the one thing
// that tells a man whether he was heard. It is the conversation now.
//
// Centred, as asked, and it suits the contents: these are short lines, a
// question and a figure, not paragraphs. Oldest at the top so it reads downward
// like a thread, newest last, and the box scrolls to the bottom on every draw.
const _TIM_THREAD_SHOW=8;

// The avatar beside his bubbles. Drawn small and only once per reply; an
// avatar on every line of a run of replies is a wall of faces.
function _timThreadAv(){
  return '<span class="tim-av">'+
    ((typeof timMark==='function')?timMark(22):'')+
  '</span>';
}

// opts.pending renders the LAST reply as the typing dots instead of its text.
// The reply is already known when this is called, because Tim is local and
// instant: the dots are a display beat, not a wait for anything, and js/tim.js
// owns how long they run. Said plainly here so nobody later reads them as a
// sign that work is in flight.
//
// opts.enter is 'me' or 'him' and marks exactly ONE bubble, the newest, to
// play the send animation. It has to be one and not a class on all of them,
// because this redraws every node every time: an entrance keyed on the bubble
// class alone would replay the whole history on every send.
function _timThreadHtml(opts){
  const pending=!!(opts&&opts.pending);
  const enter=(opts&&opts.enter)||null;
  const rows=_timLog.slice(-_TIM_THREAD_SHOW);
  if(!rows.length){
    return '<div style="padding:7px 16px 5px;text-align:center;font-size:12px;color:var(--text3)">'+
      'Nothing asked yet. Whatever you say lands here.'+
    '</div>';
  }
  const last=rows.length-1;
  return rows.map((e,i)=>{
    const missed=e.kind==='none';
    const dots=pending&&i===last;
    const newest=i===last;
    const mine='<div class="tim-msg me'+(newest&&enter==='me'?' in':'')+'">'+
      '<span class="tim-b">'+escHtml(e.said)+'</span></div>';
    // An ANSWER gets a card bubble: the figure at headline size, the working
    // under it, and the button that opens the screen it came from. It used to
    // replace the whole sheet with a card that had no input on it, which ended
    // the conversation every time he answered something.
    const isAsk=e.kind==='ask'&&!dots&&(e.sub||e.goFn);
    const body=dots
      ? '<span class="tim-dots" aria-label="Tim is typing"><i></i><i></i><i></i></span>'
      : (isAsk
        ? '<span class="tim-ans">'+
            '<b>'+escHtml(e.got||'')+'</b>'+
            (e.sub?'<i>'+escHtml(e.sub)+'</i>':'')+
            ((e.goFn||e.rows)
              ? '<span class="tim-ans-do">'+
                  (e.goFn?'<button type="button" onclick="_timClose();'+escHtml(e.goFn)+'">'+
                    escHtml(e.goLabel||'Open')+'</button>':'')+
                  (e.rows?'<button type="button" class="alt" onclick="_timReopenAsk('+
                    escHtml(JSON.stringify(String(e.said||'')))+')">Details</button>':'')+
                '</span>'
              : '')+
          '</span>'
        : escHtml(e.got||''));
    const his='<div class="tim-msg him'+(missed&&!dots?' miss':'')+
      (isAsk?' ans':'')+(newest&&enter==='him'?' in':'')+'">'+
      _timThreadAv()+
      '<span class="tim-b">'+body+'</span></div>';
    return mine+his;
  }).join('');
}

// ── WHAT HE LEARNS FROM, AND WHAT NEVER LEAVES THE PHONE ─────────────────────
//
// Owner, 2026-09-21: "I need tim to learn what everybody puts in so I can
// improve him though, I need to know if he fails at a task."
//
// The thread above cannot answer either question and should not try: it is one
// phone's localStorage, it never syncs, and it is wiped on sign-out. That is
// right for a CONVERSATION and useless for improving him, because the sentence
// he could not place is sitting on the one device nobody will ever look at.
//
// So a second, much smaller thing goes up: what was said, whether he placed it,
// and which family placed it. One row per sentence (td_tim_asks).
//
// ── THE SCRUB IS THE WHOLE DESIGN ────────────────────────────────────────────
// The thread carries customer names, what they owe, what a job was charged at
// and the address somebody worked at. NONE of that teaches Tim anything. The
// shape of the question is the entire lesson: "what does <customer> owe me" is
// the thing to learn and the customer's name is not.
//
// So every client name is replaced with a placeholder BEFORE the sentence
// leaves, on the device, and the figure, the answer and the rows are never
// sent at all. A sentence that still contains a name after scrubbing is one
// where the name was not in the address book, and there is nothing more this
// can do about that without guessing, which is worse.
//
// Names are matched longest-first so "Dana Whitfield" cannot be half-replaced
// by a "Dana" that also exists, and on a word boundary so a customer called
// "Art" does not eat the word "start".
const _TIM_SCRUB='<customer>';
function _timScrub(said){
  let t=String(said||'');
  if(!t)return t;
  try{
    const names=[];
    const rows=(typeof clients!=='undefined'&&Array.isArray(clients))?clients:[];
    rows.forEach(c=>{
      if(!c)return;
      const n=String(c.name||'').trim();
      // Two characters is not a name, it is a substring waiting to ruin a
      // sentence. Skip it rather than scrub half the words in the language.
      if(n.length<3)return;
      names.push(n);
      // First names too: a man says "what does Dana owe me", not "what does
      // Dana Whitfield owe me". Only when it is long enough to be worth it.
      const first=n.split(/\s+/)[0];
      if(first&&first.length>=3&&first!==n)names.push(first);
    });
    // Longest first, so a full name is taken before either half of it.
    names.sort((a,b)=>b.length-a.length);
    const seen={};
    names.forEach(n=>{
      const k=n.toLowerCase();
      if(seen[k])return;
      seen[k]=1;
      const esc=n.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      t=t.replace(new RegExp('(^|[^a-z0-9])'+esc+'($|[^a-z0-9])','gi'),'$1'+_TIM_SCRUB+'$2');
    });
  }catch(_e){}
  return t;
}

// The queue. Writes land here first and go up when there is a network and an
// account, so a man on a driveway with no bars loses nothing and waits for
// nothing: this is never awaited and never blocks a sentence.
const _TIM_SEND_KEY='td_tim_send';
const _TIM_SEND_MAX=200;
function _timSendQueue(){
  try{const r=JSON.parse(localStorage.getItem(_TIM_SEND_KEY));return Array.isArray(r)?r:[];}
  catch(_e){return [];}
}
function _timSendWrite(q){
  try{localStorage.setItem(_TIM_SEND_KEY,JSON.stringify(q.slice(-_TIM_SEND_MAX)));}catch(_e){}
}
function timLearnFrom(said,outcome){
  try{
    const o=outcome||{};
    const t=String(said||'').trim();
    if(!t)return null;
    const row={
      said:_timScrub(t).slice(0,240),
      kind:o.kind||'none',
      // The family that caught it, on an answer. Null on a miss, which is what
      // makes "what is he nearly getting" answerable.
      family:(o.kind==='ask'&&o.ask)?String(o.ask).slice(0,40):null,
      page:(()=>{try{return (document.querySelector('.pg.active')||{}).id||'';}catch(_e){return '';}})(),
      at:new Date().toISOString(),
    };
    const q=_timSendQueue();
    q.push(row);
    _timSendWrite(q);
    // Opportunistic. If it fails the row stays queued and the next sentence
    // tries again, which is the whole reason there is a queue.
    timLearnFlush();
    return row;
  }catch(_e){return null;}
}

let _timFlushing=false;
async function timLearnFlush(){
  if(_timFlushing)return 0;
  const q=_timSendQueue();
  if(!q.length)return 0;
  // Everything this needs before it can send anything: an account, a client,
  // and a network. Missing any of them is not an error, it is later.
  if(typeof navigator!=='undefined'&&navigator.onLine===false)return 0;
  let supa=null,uid=null;
  try{
    supa=(typeof _supa!=='undefined')?_supa:null;
    uid=(typeof _supaUser!=='undefined'&&_supaUser)?_supaUser.id:null;
  }catch(_e){return 0;}
  if(!supa||!uid)return 0;
  _timFlushing=true;
  try{
    const dev=(()=>{try{return (typeof _deviceId!=='undefined')?_deviceId:null;}catch(_e){return null;}})();
    const ver=(()=>{try{return (typeof APP_VERSION!=='undefined')?APP_VERSION:null;}catch(_e){return null;}})();
    const send=q.slice(0,50);
    const {error}=await supa.from('td_tim_asks').insert(send.map(r=>({
      user_id:uid,device_id:dev,said:r.said,kind:r.kind,
      family:r.family,page:r.page,app_version:ver,scrubbed:true,
      created_at:r.at,
    })));
    if(error)return 0;
    // Only what actually went is dropped. Anything added while this was in
    // flight is still in there.
    const now=_timSendQueue();
    _timSendWrite(now.slice(send.length));
    return send.length;
  }catch(_e){return 0;}
  finally{_timFlushing=false;}
}

// ── The one call site ────────────────────────────────────────────────────────
// _timGo is the single door every sentence passes through and it already
// classifies the outcome, so there is one hook here rather than a sprinkling of
// them. Never throws: a log that can break the thing it is logging is worse
// than no log, and this one runs on every sentence.
function timLogSay(said,outcome){
  try{
    const o=outcome||{};
    const job=o.read||null;
    const e={
      t:new Date().toISOString(),
      // Capped: a dictated paragraph should not be able to push the rest of
      // the log out of localStorage by itself.
      said:String(said||'').slice(0,240),
      kind:o.kind||'none',
      got:_timLogGot(o,job),
      // What the thread needs to redraw his ANSWER as a bubble after a reopen,
      // rather than just the headline figure. Capped like `said` is: this file
      // is a ring buffer on a phone and one long sub should not be able to push
      // the rest of the history out.
      sub:o.sub?String(o.sub).slice(0,200):'',
      goLabel:o.goLabel?String(o.goLabel).slice(0,40):'',
      goFn:o.goFn?String(o.goFn).slice(0,120):'',
      rows:!!o.rows,
      miss:timLogGaps(said,job).slice(0,12),
    };
    _timLog.push(e);
    if(_timLog.length>_TIM_LOG_MAX)_timLog.splice(0,_timLog.length-_TIM_LOG_MAX);
    _timLogWrite();
    return e;
  }catch(_e){return null;}
}

function timLogEntries(){return _timLog.slice().reverse();}

function timLogClear(){_timLog=[];_timLogWrite();}

// Sentences he could not place at all. The strongest signal in the log: not a
// word he missed inside a job he understood, a whole thing he had no answer
// for.
function timLogBlanks(){return _timLog.filter(e=>e.kind==='none');}

// The improvement queue. Most-asked first, because a word he has missed six
// times is worth teaching him before one he missed once.
function timLogMisses(){
  const n={};
  _timLog.forEach(e=>(e.miss||[]).forEach(w=>{n[w]=(n[w]||0)+1;}));
  return Object.keys(n)
    .map(w=>({word:w,n:n[w]}))
    .sort((a,b)=>b.n-a.n||a.word.localeCompare(b.word));
}

// Plain text, for handing one of these to someone who can act on it. Central
// time, same as the geo panel, because the phone is on Central and a UTC stamp
// on a diagnostic reads as the wrong afternoon (owner, 2026-08-23).
function _timLogWhen(raw){
  try{
    const d=new Date(raw);
    if(isNaN(d.getTime()))return String(raw||'');
    return (typeof _bizStamp==='function')?_bizStamp(d):d.toISOString();
  }catch(_e){return String(raw||'');}
}

function timLogText(){
  const l=timLogLoaded();
  const head=['Tim log, '+(typeof APP_VERSION!=='undefined'?APP_VERSION:'?'),
    'knowledge '+(l.knowledge?'loaded':'MISSING')+
    ', nudges '+(l.nudge?'loaded':'MISSING')+
    ', book '+(l.book?'loaded':'MISSING')];
  const miss=timLogMisses();
  if(miss.length)head.push('Did not know: '+miss.map(m=>m.word+(m.n>1?' x'+m.n:'')).join(', '));
  return head.concat('',timLogEntries().map(e=>
    _timLogWhen(e.t)+'  "'+e.said+'"'+
    '\n           -> '+e.got+
    ((e.miss&&e.miss.length)?('\n           ?  '+e.miss.join(', ')):'')
  )).join('\n');
}

// ── The panel ────────────────────────────────────────────────────────────────

// The row at the foot of Tim's own sheet. Absent when there is nothing to say,
// so an empty log adds nothing to a screen he opened to talk, and LOUD when a
// knowledge file is missing, because that is the one state where every other
// thing Tim does is a lie about what he knows.
function _timLogRowHtml(){
  const miss=timLogMisses().length,n=_timLog.length;
  if(!timLogAllLoaded()){
    return '<button type="button" onclick="openTimLog()" style="display:block;width:calc(100% - 32px);margin:11px 16px 0;padding:11px 13px;border:0;border-radius:var(--r-md);background:#FFF4F4;box-shadow:0 0 0 1px #F3D2D2;cursor:pointer;font-family:inherit;text-align:left">'+
      '<span style="display:block;font-size:12.5px;font-weight:700;color:#9B2C2C">Tim is only half here</span>'+
      '<span style="display:block;font-size:11.5px;color:#9B2C2C;margin-top:2px;line-height:1.45">What he knows did not load on this phone. Tap for what is missing.</span>'+
    '</button>';
  }
  if(!n)return '';
  return '<button type="button" onclick="openTimLog()" style="display:block;width:calc(100% - 32px);margin:11px 16px 0;padding:9px 0 0;border:0;border-top:1px solid var(--border);background:none;cursor:pointer;font-family:inherit;text-align:left">'+
    '<span style="font-size:11.5px;color:var(--text3)">'+n+' thing'+(n===1?'':'s')+' you have said to me'+
    (miss?(', '+miss+' I did not know'):'')+'</span>'+
  '</button>';
}

function openTimLog(){
  const l=timLogLoaded();
  const miss=timLogMisses();
  const blanks=timLogBlanks();
  const rows=timLogEntries();

  const micro=t=>'<div style="padding:15px 16px 8px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3)">'+t+'</div>';

  let html=
    '<div style="display:flex;align-items:center;gap:9px;padding:0 16px 13px;border-bottom:1px solid var(--border)">'+
      (typeof timMark==='function'?timMark(20):'')+
      '<span style="flex:1;min-width:0;font-size:13px;font-weight:700;color:var(--text)">What you have said to me</span>'+
    '</div>';

  // The load check first and unmissable when it fails. Everything below it is
  // meaningless if this is red: a sentence Tim could not place because his
  // knowledge never loaded is not a gap in what he knows.
  if(!timLogAllLoaded()){
    html+='<div style="margin:13px 16px 0;padding:13px;border-radius:var(--r-md);background:#FFF4F4;box-shadow:0 0 0 1px #F3D2D2">'+
      '<div style="font-size:13px;font-weight:700;color:#9B2C2C;margin-bottom:5px">What I know did not load</div>'+
      '<div style="font-size:12px;line-height:1.5;color:#9B2C2C">'+
        (l.knowledge?'':'The trade knowledge is missing. ')+
        (l.nudge?'':'The checks are missing. ')+
        (l.book?'':'The price book reader is missing. ')+
        'Close the app all the way and open it again. If it says this twice, the phone is holding an old copy.'+
      '</div>'+
    '</div>';
  }

  // The improvement queue, first, because it is the only part of this panel
  // anybody acts on.
  if(miss.length){
    html+=micro('Words I did not know')+
      '<div style="display:flex;flex-wrap:wrap;gap:6px;padding:0 16px 4px">'+
      miss.slice(0,24).map(m=>
        '<span style="display:inline-flex;align-items:baseline;gap:5px;padding:5px 9px;border-radius:var(--r-pill);background:var(--bg2);box-shadow:0 0 0 1px var(--border);font-size:12px;color:var(--text)">'+
          escHtml(m.word)+
          (m.n>1?'<span style="font-size:10.5px;color:var(--text3);font-variant-numeric:tabular-nums">'+m.n+'</span>':'')+
        '</span>').join('')+
      '</div>';
  }

  if(blanks.length){
    html+=micro('Sentences I could not place at all')+
      blanks.slice(-6).reverse().map(e=>
        '<div style="padding:9px 16px;border-top:1px solid var(--border);font-size:13px;line-height:1.5;color:var(--text)">'+escHtml(e.said)+'</div>'
      ).join('');
  }

  if(rows.length){
    html+=micro('Everything, newest first')+
      rows.map(e=>
        '<div style="padding:10px 16px;border-top:1px solid var(--border)">'+
          '<div style="font-size:13px;line-height:1.45;color:var(--text)">'+escHtml(e.said)+'</div>'+
          '<div style="font-size:11.5px;color:var(--text3);margin-top:3px">'+escHtml(_timLogWhen(e.t))+' · '+escHtml(e.got)+'</div>'+
          ((e.miss&&e.miss.length)
            ?'<div style="font-size:11.5px;color:var(--c-amber-deep);margin-top:2px">Did not know: '+escHtml(e.miss.join(', '))+'</div>'
            :'')+
        '</div>').join('');
  } else {
    html+='<div style="padding:18px 16px;font-size:13px;line-height:1.5;color:var(--text3)">'+
      'Nothing yet. Say something to me and it lands here, with what I made of it.'+
      '</div>';
  }

  html+='<div style="display:flex;gap:9px;padding:15px 16px 0;border-top:1px solid var(--border);margin-top:9px">'+
    '<button type="button" id="_tim-log-copy" onclick="_timLogCopy()" style="flex:1;height:44px;border:0;border-radius:var(--r-md);background:var(--bg);box-shadow:0 0 0 1px var(--border2);color:var(--text);font-family:inherit;font-size:13.5px;font-weight:700;cursor:pointer">Copy all of it</button>'+
    (rows.length?'<button type="button" onclick="_timLogWipe()" style="height:44px;padding:0 15px;border:0;border-radius:var(--r-md);background:var(--bg);box-shadow:0 0 0 1px var(--border2);color:var(--text2);font-family:inherit;font-size:13.5px;font-weight:600;cursor:pointer">Clear</button>':'')+
  '</div>';

  _timSheet('_tim-log-sheet',html);
}

function _timLogCopy(){
  const t=timLogText();
  const btn=document.getElementById('_tim-log-copy');
  try{
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(t).then(()=>{
        if(btn)btn.textContent='Copied';
        if(typeof showToast==='function')showToast('Copied','📋',1800);
      },()=>{});
      return t;
    }
  }catch(_e){}
  if(btn)btn.textContent='Copied';
  return t;
}

function _timLogWipe(){
  timLogClear();
  openTimLog();
}
