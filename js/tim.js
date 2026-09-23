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

// ── Photos are a place, not a page (owner 2026-09-22) ───────────────────────
// The Gallery page is gone, and photos are found through the search everybody
// already uses, keyed on the property. So "photos at 412 Oak" is not a
// navigation, it is a lookup: Tim strips the photo words and the filler and
// hands the REST to the search. A bare "photos" opens the box empty, which is
// the honest answer to a question with no subject in it.
const TIM_PHOTO_WORDS=['photos','photo','pictures','picture','pics','pic','shots','gallery','images'];
// The words a man actually says around the question. "where are my photos
// for pepe" left "where are pepe" as the search term and found nothing, which
// is the exact sentence the owner tried (2026-09-22). Question words, the
// auxiliaries that carry them, and the bare s left behind by an apostrophe
// (_timNorm strips punctuation, so "pepe's" arrives as "pepe s").
const _TIM_PHOTO_FILLER=['show','me','my','the','a','of','for','at','from','on','open','find','get','pull','up','all','job','jobs','site','house','place',
  'where','wheres','are','is','was','were','do','did','does','i','we','have','has','had','any','some','got','there','see','look','looking','need','want','to','s','take','took','taken','can','could','please'];
function timPhotoQuery(text){
  const t=_timNorm(text);
  if(!TIM_PHOTO_WORDS.some(w=>t.includes(' '+w+' ')))return null;
  const rest=t.trim().split(' ')
    .filter(w=>w&&!TIM_PHOTO_WORDS.includes(w)&&!_TIM_PHOTO_FILLER.includes(w))
    .join(' ').trim();
  return{q:rest};
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

  const pho=timPhotoQuery(said);
  if(pho){
    // Resolved here, not at run time, so the preview line can say what is
    // about to happen: one place opens, several ask which, none searches.
    const hits=(pho.q&&typeof tdPhotoSearch==='function')?tdPhotoSearch(pho.q,o.photos||[]):[];
    return {text:said,kind:'photos',q:pho.q,places:hits};
  }

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
  if(p.kind==='photos'){
    const n=(p.places||[]).length;
    if(n===1){
      const g=p.places[0];
      const where=(g.addr||'').split(',')[0]||g.name||'those';
      return 'Open '+where+', '+g.photos.length+(g.photos.length===1?' photo':' photos');
    }
    if(n>1)return 'Pick which address, '+n+' match';
    return p.q?'Search photos for '+p.q:'Search photos';
  }
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
  const p=timParse(text,{clients:(typeof clients!=='undefined'?clients:[]),book,catalog,
    photos:(typeof photos!=='undefined'?photos:[])});

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

  if(p.kind==='photos'){
    const places=p.places||[];
    // One place is not a question. Several is, and he asks it himself rather
    // than handing over a list of search results to read.
    if(places.length===1&&typeof tdOpenPhotoGroup==='function'){
      tdOpenPhotoGroup(places[0]);
      return p;
    }
    if(places.length>1){_timPickPlace(places);return p;}
    if(typeof openSearch==='function'){
      openSearch();
      const box=document.getElementById('global-search-input');
      if(box&&p.q){box.value=p.q;if(typeof runSearch==='function')runSearch(p.q);}
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
  const p=timParse(el.value,{clients:(typeof clients!=='undefined'?clients:[]),book,catalog,
    photos:(typeof photos!=='undefined'?photos:[])});
  const line=timSay(p);
  out.textContent=line||(el.value.trim()?'Not sure what that is yet':'');
  out.style.color=line?'var(--text2)':'var(--text3)';
  if(go)go.disabled=!line;
  if(go)go.style.opacity=line?'1':'.45';
}

function _timGo(){
  const el=document.getElementById('_tim-say');
  const said=el?el.value:'';
  // Close BEFORE acting, not after. Running first and closing second tore
  // down whatever the action had just opened in the same overlay: the photo
  // chooser appeared and vanished in one frame (caught in a screenshot,
  // 2026-09-22). A sentence he cannot place keeps the box open, because
  // closing it would throw away what the contractor just typed.
  const trade=(typeof getActiveTrade==='function'?getActiveTrade():'general')||'general';
  const book=(typeof S!=='undefined'&&S.priceBook&&Array.isArray(S.priceBook[trade]))?S.priceBook[trade]:[];
  const catalog=(typeof TRADE_JOBS!=='undefined'&&Array.isArray(TRADE_JOBS[trade]))?TRADE_JOBS[trade]:[];
  const peek=timParse(said,{clients:(typeof clients!=='undefined'?clients:[]),book,catalog,
    photos:(typeof photos!=='undefined'?photos:[])});
  if(!peek||peek.kind==='none'){
    if(typeof showToast==='function')showToast('Say a screen, a year, or a bid','🔧',2600);
    return peek;
  }
  _timClose();
  return timRun(said);
}

// "Which one?", asked the way Tim asks everything else: his modal, one tap per
// answer, and the tap lands you in the photos rather than in a list about them.
let _timPlaces=[];
function _timPickPlace(places){
  _timPlaces=places||[];
  if(!_timPlaces.length)return false;
  _timClose();
  const ov=document.createElement('div');ov.className='zmodal-overlay';ov.id='_tim-ov';
  ov.onclick=e=>{if(e.target===ov)_timClose();};
  const box=document.createElement('div');box.className='zmodal';
  box.style.animation='td-pg-enter .22s cubic-bezier(.22,1,.36,1) both';
  box.innerHTML=
    '<div style="font-size:17px;font-weight:800;margin-bottom:2px">Which one?</div>'+
    '<div style="font-size:12px;color:var(--text3);margin-bottom:12px">'+_timPlaces.length+' places have photos</div>'+
    '<div class="pc-file-list">'+
      _timPlaces.map((g,i)=>'<button type="button" class="pc-file-opt" onclick="_timOpenPlace('+i+')">'+
        escHtml((g.addr||'').split(',')[0]||g.name||'Unfiled')+
        '<span>'+escHtml(g.name||'')+(g.name&&g.photos.length?' \u00b7 ':'')+g.photos.length+
        (g.photos.length===1?' photo':' photos')+'</span></button>').join('')+
    '</div>'+
    '<button id="_tim-cancel" style="width:100%;padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:none;color:var(--text3);font-size:14px;cursor:pointer;font-family:inherit;margin-top:10px">Cancel</button>';
  ov.appendChild(box);document.body.appendChild(ov);
  document.getElementById('_tim-cancel').onclick=_timClose;
  return true;
}
function _timOpenPlace(i){
  const g=_timPlaces[i];
  if(!g)return false;
  _timClose();
  return(typeof tdOpenPhotoGroup==='function')?tdOpenPhotoGroup(g):false;
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
