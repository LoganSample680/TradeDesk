// ── Tim ──────────────────────────────────────────────────────────────────────
//
// "Tim, show me my books for last year."
// "Tim, T and M for the Delaneys, about eight hours, water heater replacement."
//
// Owner direction 2026-09-17: Tim is an INTERFACE, not an intelligence. He does
// the typing and the walking, nothing else. Every sentence he understands
// resolves against something the app already holds: a screen in the table
// below, a year in the books, a customer in the customer list, a service in the
// price book. That is string matching, so he runs in a basement with no signal,
// costs nothing per command, and nothing said to him ever leaves the phone.
//
// He owns no trade knowledge of his own and must not grow any. What a repipe
// drags in with it (isolation valves, gas pipe work, a permit) is the price
// book's job, written once at setup and priced by the contractor, never guessed
// here at 7am. js/estimate-speak.js makes the same argument for the same reason
// and Tim is that file's front door, not a replacement for it (7.3).
//
// Everything below is pure except timRun and openTim, the two that touch the app.

// Where he can take you. `say` is every way a contractor actually asks for the
// screen, longest phrase winning, so "time log" cannot be eaten by "log".
const TIM_PLACES=[
  {pg:'pg-dash',        name:'Home',        say:['home','dashboard','home screen','the dash']},
  {pg:'pg-leads',       name:'Leads',       say:['leads','lead','my leads','new lead']},
  {pg:'pg-clients',     name:'Customers',   say:['clients','customers','customer list','client list']},
  {pg:'pg-jobs',        name:'Jobs',        say:['jobs','job list','my jobs','work orders']},
  {pg:'pg-schedule',    name:'Schedule',    say:['schedule','my schedule']},
  {pg:'pg-cal',         name:'Calendar',    say:['calendar','the week','weather']},
  {pg:'pg-proposals',   name:'Proposals',   say:['proposals','my proposals','bids','my bids','quotes','sent estimates']},
  {pg:'pg-money',       name:'Collect',     say:['collect','invoices','payments','get paid','whats owed','who owes me']},
  {pg:'pg-tracker',     name:'Books',       say:['books','bookkeeping','the numbers','profit','income','expenses','mileage','p and l','my money']},
  {pg:'pg-taxes',       name:'Taxes',       say:['taxes','tax','write offs','deductions','1099s']},
  {pg:'pg-team',        name:'Fleet & Team',say:['team','crew','my crew','fleet','trucks','vehicles','employees']},
  {pg:'pg-timelog',     name:'Timesheet',   say:['timesheet','time sheet','time log','timelog','hours','my hours','the clock']},
  {pg:'pg-dispatch',    name:'Dispatch',    say:['dispatch','the board','dispatch board']},
  {pg:'pg-licensing',   name:'Licensing',   say:['licensing','my license','licenses','permits']},
  {pg:'pg-contracts',   name:'Contracts',   say:['contracts','agreements']},
  {pg:'pg-client-hub',  name:'Client hub',  say:['client hub','the hub']},
  {pg:'pg-tracker',     name:'Books',       say:['receipts']},
  {pg:'pg-qr-leads',    name:'QR leads',    say:['qr','qr code','qr leads','my sign']},
  {pg:'pg-settings',    name:'Settings',    say:['settings','preferences','my account']},
];

function _timNorm(t){
  return ' '+String(t||'').toLowerCase()
    .replace(/&/g,' and ')
    .replace(/[^a-z0-9\s]/g,' ')
    .replace(/\s+/g,' ').trim()+' ';
}

// Which screen he means. Scored on how much of the phrase he actually said, so
// a two-word name beats a one-word name that happens to sit inside it.
function timWhere(text){
  const t=_timNorm(text);
  if(t.trim()==='')return null;
  let best=null,bestLen=0;
  TIM_PLACES.forEach(p=>{
    p.say.forEach(phrase=>{
      const needle=' '+phrase+' ';
      if(t.indexOf(needle)<0)return;
      if(phrase.length>bestLen){bestLen=phrase.length;best=p;}
    });
  });
  return best?{pg:best.pg,name:best.name}:null;
}

// Which year. Only the three ways it gets said out loud: the year itself, last
// year, this year. Anything cleverer is a date picker's job, not a sentence's.
function timWhen(text,now){
  const t=_timNorm(text);
  const cur=(now instanceof Date?now:new Date()).getFullYear();
  const m=t.match(/\b(19\d\d|20\d\d)\b/);
  if(m)return parseInt(m[1],10);
  if(/\blast year\b/.test(t))return cur-1;
  if(/\b(this year|year to date|ytd|so far this year)\b/.test(t))return cur;
  return null;
}

// The name he said after "for", when there is one. Used to start a customer who
// does not exist yet: he said the name once already, he should not type it
// again. Time phrases are rejected here, because "books for last year" is a
// year, not a person.
function timSubject(text){
  const raw=String(text||'');
  const m=raw.match(/\bfor\s+([^,.;]+)/i);
  if(!m)return null;
  let s=m[1].trim().replace(/\s+/g,' ');
  // Trim at the word that starts the next clause, so "for Logan Sample doing a
  // repipe" keeps the name and drops the work.
  s=s.split(/\s+(?:about|doing|on|at|with|and)\b/i)[0].trim();
  if(!s)return null;
  if(/\d/.test(s))return null;
  const words=s.split(' ');
  if(words.length>4)return null;
  if(/^(last|this|next|the|a|an|my|me|it|us|them|now|today|tomorrow|yesterday)\b/i.test(s))return null;
  return s;
}

// Does the sentence ask to BUILD something, as opposed to go look at something?
// "build me a T and M for Logan Sample" is a build even when Logan Sample is
// not a customer yet, and that difference is the whole point of the flag.
function timWantsBuild(text){
  const t=_timNorm(text);
  return /\b(build|start|make|write|create|new|draw up|put together|set up)\b/.test(t)
      || /\b(t and m|time and materials|estimate|proposal|bid|quote)\b/.test(t);
}

// The whole sentence, resolved. Pure: hand it the lists, get back a plan.
// Order matters. Building beats looking, because a contractor who says
// "estimate" while describing work wants the builder, not the list of ones he
// already sent.
function timParse(text,opts){
  const o=opts||{};
  const said=String(text||'');
  if(!said.trim())return {text:said,kind:'none'};

  const est=(typeof spkParse==='function')
    ? spkParse(said,{clients:o.clients,book:o.book,catalog:o.catalog})
    : null;
  if(est&&est.actionable)return {text:said,kind:'estimate',plan:est};

  const subject=timSubject(said);
  if(subject&&timWantsBuild(said)&&!(est&&est.client))
    return {text:said,kind:'newclient',subject};

  const where=timWhere(said);
  const year=timWhen(said,o.now);
  if(where)return {text:said,kind:'nav',pg:where.pg,name:where.name,year};
  // A bare year is the books. Nowhere else in this app is a year the whole ask.
  if(year!==null)return {text:said,kind:'nav',pg:'pg-tracker',name:'Books',year};

  return {text:said,kind:'none'};
}

// What Tim is about to do, in his words, so the box is never a black hole. This
// string is what the screen shows BEFORE he does anything.
function timSay(p){
  if(!p||p.kind==='none')return '';
  if(p.kind==='nav')return 'Open '+p.name+(p.year?' for '+p.year:'');
  if(p.kind==='newclient')return 'Start '+p.subject+' as a new customer';
  if(p.kind==='estimate'){
    const pl=p.plan||{};
    const what=pl.type==='tm'?'a T&M':'a proposal';
    const who=pl.client&&pl.client.name?pl.client.name:'them';
    const bits=[];
    if(pl.hours>0)bits.push(pl.hours+' hrs');
    if(pl.services&&pl.services.length)bits.push(pl.services.length+(pl.services.length===1?' line':' lines'));
    return 'Build '+what+' for '+who+(bits.length?' ('+bits.join(', ')+')':'');
  }
  return '';
}

// The impure half. Everything it calls already existed; Tim only picks which.
function timRun(text){
  const trade=(typeof getActiveTrade==='function'?getActiveTrade():'general')||'general';
  const book=(typeof S!=='undefined'&&S.priceBook&&Array.isArray(S.priceBook[trade]))?S.priceBook[trade]:[];
  const catalog=(typeof TRADE_JOBS!=='undefined'&&Array.isArray(TRADE_JOBS[trade]))?TRADE_JOBS[trade]:[];
  const p=timParse(text,{clients:(typeof clients!=='undefined'?clients:[]),book,catalog});

  if(p.kind==='estimate'&&typeof tdSpeakEstimate==='function'){tdSpeakEstimate(text);return p;}

  if(p.kind==='newclient'&&typeof _newClientQuickGate==='function'){
    _newClientQuickGate();
    const el=document.getElementById('_newc-gate-name');
    if(el){
      el.value=p.subject;
      try{el.dispatchEvent(new Event('input',{bubbles:true}));}catch(_e){}
    }
    return p;
  }

  if(p.kind==='nav'&&typeof goPg==='function'){
    goPg(p.pg);
    // The year goes on AFTER the page exists, because setting it renders the
    // tab. A year the books have no rows for falls back to the newest on its
    // own inside populateTrackerYearSel, which is the right answer anyway.
    if(p.year&&p.pg==='pg-tracker'&&typeof setTrackerYear==='function')setTrackerYear(p.year);
    return p;
  }
  return p;
}

// ── The box ──────────────────────────────────────────────────────────────────
// Centered modal, the app's one convention for a prompt (7.3). The mic is the
// same on-device one every note field already uses (js/voice.js): the words are
// transcribed on the phone, so a sentence said in a client's kitchen stays in
// the kitchen.

function _timClose(){document.getElementById('_tim-ov')?.remove();}

function _timPreview(){
  const el=document.getElementById('_tim-say');
  const out=document.getElementById('_tim-read');
  const go=document.getElementById('_tim-go');
  if(!el||!out)return;
  const trade=(typeof getActiveTrade==='function'?getActiveTrade():'general')||'general';
  const book=(typeof S!=='undefined'&&S.priceBook&&Array.isArray(S.priceBook[trade]))?S.priceBook[trade]:[];
  const catalog=(typeof TRADE_JOBS!=='undefined'&&Array.isArray(TRADE_JOBS[trade]))?TRADE_JOBS[trade]:[];
  const p=timParse(el.value,{clients:(typeof clients!=='undefined'?clients:[]),book,catalog});
  const line=timSay(p);
  out.textContent=line||(el.value.trim()?'Not sure what that is yet':'');
  out.style.color=line?'var(--text2)':'var(--text3)';
  if(go)go.disabled=!line;
  if(go)go.style.opacity=line?'1':'.45';
}

function _timGo(){
  const el=document.getElementById('_tim-say');
  const said=el?el.value:'';
  const p=timRun(said);
  if(p&&p.kind!=='none')_timClose();
  else if(typeof showToast==='function')showToast('Say a screen, a year, or a bid','🔧',2600);
  return p;
}

function openTim(){
  _timClose();
  const ov=document.createElement('div');ov.className='zmodal-overlay';ov.id='_tim-ov';
  ov.onclick=e=>{if(e.target===ov)_timClose();};
  const box=document.createElement('div');box.className='zmodal';
  box.style.animation='td-pg-enter .22s cubic-bezier(.22,1,.36,1) both';
  box.innerHTML=
    '<div style="font-size:17px;font-weight:800;margin-bottom:2px">Tim</div>'+
    '<div style="font-size:12px;color:var(--text3);margin-bottom:12px">Say where to go or what to build</div>'+
    '<div style="position:relative;margin-bottom:8px">'+
      '<input id="_tim-say" type="text" autocomplete="off" placeholder="show me my books for last year" '+
        'style="width:100%;box-sizing:border-box;padding:12px 44px 12px 12px;border:1.5px solid var(--border2);border-radius:var(--r);font-size:15px;font-family:inherit;background:var(--bg2);color:var(--text)">'+
    '</div>'+
    '<div id="_tim-read" style="min-height:18px;font-size:13px;font-weight:600;color:var(--text3);margin-bottom:12px"></div>'+
    '<button id="_tim-go" style="width:100%;padding:14px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;opacity:.45">Go</button>'+
    '<button id="_tim-cancel" style="width:100%;padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:none;color:var(--text3);font-size:14px;cursor:pointer;font-family:inherit;margin-top:10px">Cancel</button>';
  ov.appendChild(box);document.body.appendChild(ov);

  const el=document.getElementById('_tim-say');
  if(typeof _voiceAttach==='function'){
    _voiceAttach('_tim-say',{
      host:el&&el.parentElement,
      style:'position:absolute;right:7px;top:7px;display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;border:1.5px solid var(--border2);background:var(--bg);color:var(--text3)',
      onText:_timPreview,
      // Let go of the mic and he goes. Saying it out loud and then reaching for
      // a button is two actions for one thought.
      onDone:()=>{_timPreview();setTimeout(_timGo,120);},
    });
  }
  el?.addEventListener('input',_timPreview);
  el?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();_timGo();}});
  document.getElementById('_tim-go').onclick=_timGo;
  document.getElementById('_tim-cancel').onclick=_timClose;
  _timPreview();
  setTimeout(()=>el?.focus(),100);
}
