// ── Tim ──────────────────────────────────────────────────────────────────────
//
// "Tim, show me my books for last year."
// "Tim, T and M for the Delaneys, about eight hours, water heater replacement."
//
// Owner direction 2026-09-17: Tim runs on the phone. Every sentence he
// understands resolves against something the app already holds: a screen in the
// table below, a year in the books, a customer in the customer list, a service
// in the price book. That is string matching, so he runs in a basement with no
// signal, costs nothing per command, and nothing said to him ever leaves the
// phone. That last part is a promise made to a real customer and nothing in
// this file may break it.
//
// Owner direction 2026-09-19, which amends the above: "I want Tim to be his own
// AI that knows this shit, we're basically training a local sandbox model." He
// may now hold trade knowledge, and it lives in js/tim-knowledge.js, offline
// and pure like everything else. A price book can say what scaffold costs; it
// cannot say scaffold goes up before anything is stripped, and that ordering is
// the part the owner asked for by name. js/tim-nudge.js decides when he is
// allowed to interrupt, and the bar is a dollar, a percentage or a law.
//
// This file is the screen. Everything above the dock section is pure; timRun,
// openTim and the dock are the parts that touch the app.

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
  // The id says checklist and the screen says Top Clients: it was renamed and
  // the id never was. Tim goes by what is ON the screen, because that is the
  // only name the owner has ever seen. No 'best clients' here on purpose, or it
  // would steal "who is my best customer" off the answer that reads his books.
  {pg:'pg-checklist',   name:'Top clients', say:['top clients','heavy hitters','my top clients',
                                                 'client rankings','who are my top']},
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

// ── Which of the three doors ────────────────────────────────────────────────
//
// The app already has one router for this, `_pickEstStyle` in js/clients.js,
// and these are its three ids. Tim's only job is turning what a contractor
// says into one of them, the same way timWhere turns a sentence into a screen.
//
// Longest phrase wins, so "build your own" is not eaten by "build", and
// "true bid" is not eaten by "bid", which on its own means a proposal in
// general and should pick nothing at all.
const TIM_STYLES=[
  {id:'tm',      name:'Time and materials', say:['t and m','t m','tm','time and materials','time and material','hourly','by the hour','cost plus']},
  {id:'truebid', name:'TrueBid',            say:['true bid','truebid','true scan','truescan','true measure','truemeasure','scan','scan it','measure it','trace it','lidar','from above']},
  {id:'freeform',name:'Build your own',     say:['build your own','byo','b y o','line item','line items','itemize','itemise','a la carte','by the line','flat price','fixed price','lump sum']},
];
function timStyle(text){
  const t=_timNorm(text);
  if(t.trim()==='')return null;
  let best=null,bestLen=0;
  TIM_STYLES.forEach(s=>{
    s.say.forEach(phrase=>{
      if(t.indexOf(' '+phrase+' ')<0)return;
      if(phrase.length>bestLen){bestLen=phrase.length;best=s;}
    });
  });
  return best?{id:best.id,name:best.name}:null;
}

// Is that a no? The answer to "anything the crew should know" is very often
// nothing, and a man who says "nope" must not have the word "nope" saved as
// the gate code for his customer's house.
function timIsNothing(text){
  const t=_timNorm(text);
  if(t.trim()==='')return true;
  return /^ (no|nope|nah|none|nothing|negative|all good|its fine|it s fine|clear|nothing special|not really|no notes|skip|n a) $/.test(t);
}

// ── Photos are a place, not a page (owner 2026-09-22) ───────────────────────
// The Gallery page is gone, and photos are found through the search everybody
// already uses, keyed on the property. So "photos at 412 Oak" is not a
// navigation, it is a lookup: Tim strips the photo words and the filler and
// hands the REST to the search. A bare "photos" opens the box empty, which is
// the honest answer to a question with no subject in it.
const TIM_PHOTO_WORDS=['photos','photo','pictures','picture','pics','pic','shots','gallery','images'];
const _TIM_PHOTO_FILLER=['show','me','my','the','a','of','for','at','from','on','open','find','get','pull','up','all','job','jobs','site','house','place'];
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
    if(places.length===1&&typeof tdReviewShots==='function'){
      tdReviewShots(places[0].photos.map(x=>x.id));
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


// ── The mark ─────────────────────────────────────────────────────────────────
//
// One shape, five sizes, and it has to survive all of them: 16px inline in a
// row of scope, 20px beside a line of his own copy, 26px in the sheet header,
// 34px on the dock, 58px when the dock is the only thing on screen.
//
// Six hand-drawn versions of this were rejected and they were rejected for the
// same reason each time: a face assembled out of seven primitives in a 28-unit
// box is a face nobody drew. It read as a hardhat, then a padlock, then a
// mummy. The answer was not a better bezier, it was to stop drawing. This is
// the Style E portrait from the brand sheet, cropped square, masked to a circle
// and exported at three densities: a bearded man in a ball cap with a wrench on
// the crown and his overalls showing. That is the mascot the owner asked for,
// and it holds at 16px because the silhouette does the work, not the detail.
//
// It carries its own gold field, so there is no disc, no ring and no onInk
// variant to draw underneath it. The browser picks the density off srcset from
// the rendered size, which is why width and height are attributes and not a
// guess: a 16px mark on a 3x phone pulls the 64 and nothing larger.
//
// It is built as a string rather than a component because the app has no
// framework and this has to drop into innerHTML from six different files.
function timMark(size,opts){
  const s=Math.max(12,Math.round(Number(size)||24));
  const o=opts||{};
  // THE FIGURE ONLY, on transparency. It used to be the whole Style E portrait
  // including its gold disc, which meant the tab had to BE that gold for the
  // two to merge, and that gold is what the owner kept saying he did not like.
  // Pulled off its field (alpha is how far each pixel travelled from the gold
  // toward the ink, so the beard keeps its soft edges instead of becoming a
  // 1-bit stencil) it is a mark rather than a sticker: it takes the colour of
  // whatever it is set on, which is how AXL's does it and is why theirs sits on
  // a plain white tab without looking stuck to it.
  //
  // /icons/, NOT /img/. functions/img/[[path]].js is a Pages Function that owns
  // every path under /img/ and serves exactly one thing, Supabase gallery
  // objects; anything else got a hard 404 before the static file was ever
  // looked at. So these three shipped to UAT and rendered as a broken-image
  // glyph in the dock and in the sheet header. NO OFFLINE TEST COULD CATCH IT:
  // `npx serve .` has no Functions, so /img/tim-256.png resolved locally every
  // single time and every suite stayed green. The route is fixed too, it falls
  // through to the static asset now instead of 404ing, but these live under
  // /icons/ regardless, because nothing fronts that path and nothing can grow
  // in front of it by accident.
  return '<img src="/icons/tim-mark-128.png" '+
    'srcset="/icons/tim-mark-64.png 64w, /icons/tim-mark-128.png 128w, /icons/tim-mark-256.png 256w" '+
    'sizes="'+s+'px" width="'+s+'" height="'+s+'" '+
    'alt="" aria-hidden="true" decoding="async" '+
    'style="flex-shrink:0;display:block'+(o.style?';'+o.style:'')+'">';
}

// ── The dock ─────────────────────────────────────────────────────────────────
//
// Bottom right, above the tab bar, on every screen. The owner picked this over
// a docked strip and an edge handle for one reason: it is the corner his app
// already floats things in, so there is nothing to learn, and it takes no
// vertical space on a page that is mostly list.
//
// The button never says anything. The pill above it does, and only when
// js/tim-nudge.js can put a dollar, a percentage or a law on it. Nothing else
// ever appears there: no greeting, no count of Tim's own output, no offer to
// help. A man reaching for the corner is reaching for a number.

let _timDockNudge=null;

function timDockRender(opts){
  // HE IS RAISED OFF THE BOTTOM BAR NOW, not a thing floating loose on the page
  // and not a sixth tab either.
  //
  // The floating dock went first, and the reason is worth keeping: he was the
  // only persistent floating object in TradeDesk. Everything else fixed here is
  // full-width chrome or a transient overlay, so he had no siblings to inherit
  // a colour, a shadow or a shape from, and ten rounds of restyling never fixed
  // what was actually wrong with him. Owner's brief for the move: "I just want
  // it somewhere somebody will click."
  //
  // The sixth tab answered that and read flat, because a tab is one of five
  // equals and he is not one of the five. Owner: "kinda diggin tim raised off
  // the bar in the center". Raised, on the bar's centreline, flush to its top
  // edge, so he borrows the bar's thumb zone and its ink without pretending to
  // be a destination.
  //
  // What he loses either way is the pill: the figure used to be readable
  // without tapping, and now the red dot says only THAT there is something. The
  // sheet still leads with the finding one tap later.
  const tab=document.getElementById('mtb-tim');
  if(!tab)return;
  // No page up yet means the boot screen or the sign-in gate still is. A crew
  // member gets no Tim at all: everything he can name is money or a contract,
  // and both sit behind the wall the nav already puts them behind.
  //
  // The `hidden` attribute rather than a style property, here and on the dot:
  // rule 8.5, and it is the honest one anyway, since #mtb-tim is display:flex
  // and the old style.display='' was restoring the wrong default.
  const booted=!!document.querySelector('.pg.active');
  if(!booted||_timCrew()){
    tab.hidden=true;
    try{document.querySelectorAll('.tim-atwork').forEach(el=>{el.hidden=true;});}catch(_e){}
    return;
  }
  tab.hidden=false;

  const markEl=document.getElementById('mtb-tim-mark');
  if(markEl&&!markEl.firstChild)markEl.innerHTML=timMark(36);
  // The strips at the point of the work (Collect, the Timesheet). Same wall as
  // the key: a crew member gets no Tim anywhere, and a hidden control is not a
  // closed one, so this hides the markup rather than trusting the page it is on.
  try{
    document.querySelectorAll('.tim-atwork').forEach(el=>{
      el.hidden=false;
      const m=el.querySelector('.tim-atwork-mark');
      if(m&&!m.firstChild)m.innerHTML=timMark(26);
    });
  }catch(_e){}

  const finds=_timDockFinds(!!(opts&&opts.cached));
  _timDockNudge=finds.length?finds[0]:null;
  _timDockFound=finds;

  // The badge is the whole of his unprompted voice now, so it carries the
  // COUNT rather than merely existing. It appears only when the nudge engine
  // can name a dollar, a percentage or a law, which is the same bar the pill
  // was held to: no findings, no badge, and silence costs nothing.
  //
  // With nothing to count, the same corner teaches the control ONCE. A raised
  // key with a face on it is a thing a man has never seen before, and nothing
  // about it says tap. The i says tap. It goes for good the first time he is
  // opened; _timMet is per-device on purpose, since it is a fact about this
  // phone's owner having seen it and not about the account.
  const dot=document.getElementById('mtb-tim-dot');
  if(dot){
    const hint=!finds.length&&!_timMet();
    dot.classList.toggle('hint',hint);
    dot.textContent=finds.length?String(finds.length):(hint?'i':'');
    dot.hidden=!finds.length&&!hint;
  }
  _timSaySomething(tab,finds);
  tab.setAttribute('aria-label',finds.length
    ? ('Tim, '+finds.length+' thing'+(finds.length===1?'':'s')+' to look at')
    : 'Tim');
}

// ── WHETHER HE SAYS IT OUT LOUD ──────────────────────────────────────────────
//
// Owner, after five rounds on the shape of him: "Does it scream click me
// though... I want people to use this thing."
//
// It did not, and the shape was never going to fix it. What got the old
// floating dock tapped was the pill beside it speaking the top finding with the
// figure on the front, and that died in the move to the bar for a layout reason
// rather than a product one. A badge saying "2" reports that a number exists.
// "$1,240, Dana still owes on the last one" is a reason to put a thumb on
// something.
//
// THE WHOLE DESIGN IS THE GATE. A pill that speaks on every render is a nag,
// and a nag gets dismissed forever after about two days, which costs more
// attention than it ever buys. So he speaks only when the thing he would say
// has CHANGED: the signature is the finding's id and its figure together, so
// the same customer owing the same money says nothing twice, and the same
// customer owing more says it again. Stored per device, like td_tim_met, which
// is the right scope for "this phone has already been told".
//
// He also never talks over himself: if his sheet is open he is already being
// read, and a bubble behind it would be shouting into a conversation.
const _TIM_SAID_KEY='td_tim_said';
function _timSaidSig(){
  try{return localStorage.getItem(_TIM_SAID_KEY)||'';}catch(_e){return '';}
}
function _timSaySomething(tab,finds){
  const say=document.getElementById('mtb-tim-say');
  if(!say)return;
  const top=finds&&finds.length?finds[0]:null;
  if(!top)return;
  // Both halves, because a figure with no sentence is a number nobody can act
  // on and a sentence with no figure is not worth interrupting anybody for.
  const fig=String(top.figure||'').trim(),line=String(top.line||'').trim();
  if(!fig||!line)return;
  const sig=String(top.id||'')+'|'+fig;
  if(sig===_timSaidSig())return;
  // His sheet is open: he is already being read.
  if(document.getElementById('_tim-sheet'))return;
  // A phone that cannot remember being told would be told on every render,
  // which is the nag this whole function exists to avoid. Silence is the safe
  // failure here, so it writes FIRST and only speaks if the write took.
  try{localStorage.setItem(_TIM_SAID_KEY,sig);}catch(_e){return;}
  say.innerHTML='<b>'+escHtml(fig)+'</b><i>'+escHtml(line)+'</i>';
  say.hidden=false;
  // One rise of the key to go with it. Restarted by hand because re-adding a
  // class the element already carries does not replay an animation, and he may
  // well have something new to say twice in one session.
  try{
    tab.classList.remove('noticed');
    void tab.offsetWidth;
    tab.classList.add('noticed');
  }catch(_e){}
}

// ── The first move, already loaded ───────────────────────────────────────────
//
// Owner, 2026-09-21: "I want people to use this thing."
//
// This used to be a sentence of prose: "Ask me what you are owed, what you
// charged for something, or where your work is coming from." It names three
// things he can do, in the right words, and it is still the wrong shape,
// because reading a description of a question and then typing that question
// yourself is two steps where there should be none.
//
// Jobber shipped the most prominent entry point available to them, a sparkle in
// the top navigation of every screen, and then had to publish a marketing page
// called "50 of the Best Prompts To Try in Jobber AI". That page exists because
// a blank box teaches nobody anything. ServiceTitan's 2026 trades survey names
// the same wall from the other side: after training and integration, the top
// barrier is "difficulty understanding how to use the tools".
//
// So the prompts go IN the product, as things to touch. One tap from opening
// him to a number on the screen.
//
// THE RULES FOR WHAT IS ALLOWED ON A CHIP:
//   It must be a question he can really answer, offline, right now. A chip that
//   misses is worse than no chip: it is the app promising something in its own
//   voice and then failing in front of the man it promised.
//   It must be phrased the way he would say it, not the way a menu would label
//   it. "What am I owed", not "Accounts receivable".
//   Three. Four is a menu and a menu is something to read rather than tap.
const TIM_CHIPS=[
  {say:'who owes me money',chip:'What am I owed'},
  {say:'how many hours did we work last week',chip:'Hours last week'},
  {say:'what do I invoice for last week',chip:'What do I invoice'},
];

function _timHelloHtml(){
  // On the estimate builder he is standing in a job, and the job is the
  // subject. The chips are about the books, which are not what he is looking
  // at, so there he still gets the sentence.
  if(_timOnEstimate()){
    return '<div id="_tim-hello" style="padding:15px 16px 3px;font-size:13px;line-height:1.5;color:var(--text2)">'+
      'Nothing on this one worth stopping you for. Say what changed and I will put it where it goes.'+
      '</div>';
  }
  return '<div id="_tim-hello" style="padding:13px 16px 2px">'+
    // "Say your own" was ambiguous next to a text box: say it how? Where there
    // is a mic, the sentence names it, because a control nobody knows is the
    // easy way is not the easy way.
    '<div style="font-size:12px;color:var(--text3);margin-bottom:9px">'+
      ((typeof _voiceCapable==='function'&&_voiceCapable())
        ? 'Tap one, or tap the mic and just talk'
        : 'Tap one, or type your own')+'</div>'+
    '<div style="display:flex;flex-wrap:wrap;gap:7px">'+
      TIM_CHIPS.map(c=>
        '<button type="button" class="tim-chip" onclick="_timChip('+
          escHtml(JSON.stringify(c.say))+')">'+escHtml(c.chip)+'</button>').join('')+
    '</div></div>';
}

// A chip is the man typing it, exactly. It goes in the box and down the same
// door every sentence goes down (_timGo), so it is logged as his, it lands in
// the thread as his, and the answer comes back as a bubble like any other. No
// second path, which is also why a chip cannot drift out of step with what
// typing the same words would do.
// A door at the work rather than the global one on the bar. Same sentence, same
// door underneath: openTim then the ordinary send path, so it is logged as his,
// lands in the thread as his, and cannot drift out of step with what typing the
// words would do.
function _timAskFrom(said){
  if(_timCrew())return;
  openTim();
  _timChip(said);
}

// ── SETTING THE BOX IS NOT THE SAME AS TYPING IN IT ──────────────────────────
//
// The mic and the send arrow swap on the row's data-empty, which _timPreview
// sets from the input listener. Typing fires that listener by itself; a script
// write does not, so every script write goes through here and says so, exactly
// as _voiceStop already does after dictation. Nothing downstream has to know
// whether a sentence was typed, dictated, pasted or tapped from a chip.
function _timSetSaid(el,v){
  if(!el)return;
  el.value=String(v==null?'':v);
  try{el.dispatchEvent(new Event('input',{bubbles:true}));}catch(_e){}
}

function _timChip(said){
  const el=document.getElementById('_tim-say');
  if(!el)return;
  _timSetSaid(el,String(said||''));
  if(typeof _tdHaptic==='function')_tdHaptic('tick');
  _timGo();
}

// ── Whether he has ever been opened on this phone ────────────────────────────
// localStorage, not S: this is a per-device teaching state, not a preference.
// Syncing it would mean a man who met Tim on his phone never gets the hint on
// the tablet in the truck, which is the one place he has not met him.
const _TIM_MET_KEY='td_tim_met';
function _timMet(){
  try{return localStorage.getItem(_TIM_MET_KEY)==='1';}catch(_e){return true;}
}
function _timMarkMet(){
  try{
    if(localStorage.getItem(_TIM_MET_KEY)==='1')return false;
    localStorage.setItem(_TIM_MET_KEY,'1');
    return true;
  }catch(_e){return false;}
}

// What he found, kept so openTim can lead with it without asking the nudge
// engine a second question it has already answered.
let _timDockFound=[];

// ── Getting out of the way ───────────────────────────────────────────────────
//
// Three homes, and the last one is the only one that needed no geometry at all.
//
// 1. Floating bottom-right. The estimate builder pins a full-width bar across
//    the bottom the moment a line is added (`_geiRenderCartBar`, then the send
//    bar, then the mobile tab bar under both), so _timDockLift measured every
//    fixed bottom bar on every render and stood him on the tallest one. It
//    obeyed 15.3 by dodging, cost a layout read per render, and still left him
//    covering whatever card was under him: a render taken 2026-09-20 had him
//    sitting on a card's own button.
// 2. Tucked against the right edge at mid-height, with a pill that spoke the
//    top finding and a timer that rolled through the rest. Nothing fixed lives
//    there, so nothing to measure. The owner never liked the look of it, over
//    ten rounds, and the reason turned out not to be the colour: he was the
//    only persistent floating object in the app, so every value chosen for him
//    was invented rather than borrowed.
// 3. Raised off the bottom bar, on its centreline, bottom edge flush with the
//    bar's top edge. He inherits the bar's ink and its thumb zone, he cannot
//    land on anything because bottom:100% puts him wholly above the padding
//    box, and there is nothing to measure or dodge.
//
// The pill and its carousel died with home 2: a raised key has no room beside
// it for a sentence, and the badge count plus the sheet one tap later say the
// same thing without a timer running in a pocket. The geometry lives entirely
// in the stylesheet (8.5), which is where it should have been from the start.
//
// WHAT THE DOCK IS ALLOWED TO RECOMPUTE, AND HOW OFTEN.
//
// timJobSnapshot is not cheap and was never meant to be: it reads the estimate
// off the DOM, walks every bid through getBidBalance (which itself walks
// payments), scans expenses for a rental rate, and asks the state-rule table
// for the law. That was fine when it ran because a man opened Tim.
//
// It stopped being fine when goPg started calling timDockRefresh on every
// navigation, which this branch added: the whole analysis now ran a frame after
// every page change in the app. Worse, it got more expensive the same day, for
// a good reason. _timOwedByClient used to filter on a field name that matched
// nothing, so it was O(bids) of doing nothing. Fixing it made it real work.
//
// The geometry still updates on every render, because a dock sitting on top of
// a cart bar is the bug it was written to prevent and it costs two rect reads.
// The ANALYSIS is throttled: the answer cannot meaningfully change in a third
// of a second, and nothing that does change it (an edit, a save, opening the
// sheet) goes through here without also going through the paths that clear it.
// Only the NAVIGATION path is allowed the cached answer, which is the same
// split renderTimeLog(opts) already draws in js/timelog.js: a drill tap reads
// from memory, a real open re-reads. Anything calling timDockRender() straight
// wants the truth now and gets it, so opening the sheet, finishing an edit, and
// every test in the suite are all unaffected. Only goPg, which fires on a
// navigation that changed none of this, takes the cheap answer.
const _TIM_TOP_MS=333;
let _timTopCache=null,_timTopAt=0;
function _timDockFinds(cached){
  if(typeof timNudges!=='function'||typeof timJobSnapshot!=='function')return [];
  const now=Date.now();
  if(cached&&_timTopAt&&(now-_timTopAt)<_TIM_TOP_MS)return _timTopCache||[];
  _timTopAt=now;
  // Three at most. He ranked them; the fourth is not worth a man's attention on
  // a driveway, and a pill that rolls forever is a carousel, not a colleague.
  _timTopCache=(timNudges(timJobSnapshot())||[]).slice(0,3);
  return _timTopCache;
}

// Cheap enough to call from anywhere that changes the job. Coalesced to one
// paint a frame so a burst of field edits does not re-read the price book
// thirty times.
let _timDockPending=false;
function timDockRefresh(){
  if(_timDockPending)return;
  _timDockPending=true;
  requestAnimationFrame(()=>{_timDockPending=false;try{timDockRender({cached:true});}catch(_e){}});
}

// ── The sheet ────────────────────────────────────────────────────────────────
//
// A sheet over the page with the page still readable behind it, which is the
// app's own bottom-sheet shell (js/jobs.js `_extendJob`, js/dashboard.js, and
// four others): `.zmodal-overlay` for the scrim and hit target, a fixed panel
// rounded at the top, and the rAF fade-and-slide on open (7.3, 8.4).
//
// This is a deliberate divergence from `.zmodal`, which is the app's CENTERED
// prompt and is what Tim used to be. The reason it changed: a centered box
// covers the thing it is talking about. Tim's entire job here is "there is no
// scaffold on THIS proposal", and the man has to be able to see the proposal
// while he reads it. So it sits at the bottom, over the page, with the page
// still showing, which is exactly what the design called for.

function _timClose(){
  const ov=document.getElementById('_tim-ov');
  if(!ov)return;
  _timTalkStop(true);
  ov.remove();
  // Backing out abandons whatever was in flight. A half-answered "build a T&M
  // for Dana" that survives the sheet closing would open Dana's builder on some
  // later, unrelated tap, and a site note he never finished saying would ride
  // along with it.
  //
  // `_timBuild` still being set is exactly what "in flight" means: _timBuildGo
  // clears it before it closes the sheet, so a finished flow keeps the answer
  // it is on its way to deliver and only an abandoned one throws it away.
  // Stepping from the door to the question goes through _timSheet rather than
  // here, so the flow itself never passes through this.
  if(_timBuild){_timBuild=null;_timPendingSiteNote='';}
  _timJob=null;
}

// Walks up from whatever is under the thumb looking for a real scroller. The
// walk stops at the overlay rather than the body on purpose: finding the page
// itself scrollable is the bug, not the answer.
function _timOvMove(e){
  try{
    let el=e.target;
    while(el&&el.nodeType===1){
      if(el.scrollHeight>el.clientHeight+1){
        const st=getComputedStyle(el).overflowY;
        if(st==='auto'||st==='scroll')return;   // it can scroll: let it
      }
      if(el.id==='_tim-ov')break;
      el=el.parentNode;
    }
    if(e.cancelable)e.preventDefault();
  }catch(_e){}
}

function _timSheet(id,inner){
  // Replacing the sheet while the mic is live would leave the recogniser and
  // the waveform timer running behind a panel that no longer exists. Stopping
  // first is a no-op when nothing is listening.
  _timTalkStop(true);
  document.getElementById('_tim-ov')?.remove();
  const ov=document.createElement('div');
  ov.className='zmodal-overlay';ov.id='_tim-ov';
  ov.style.alignItems='flex-end';ov.style.padding='0';
  ov.onclick=e=>{if(e.target===ov)_timClose();};
  // ── THE SCROLL BELONGS TO THE SHEET ────────────────────────────────────────
  // Owner, 2026-09-21, from his phone: "scroll in tim scrolls the page behind
  // Tim rather than Tim."
  // overscroll-behavior:contain is already on the sheet and on the thread and
  // it does not cover this case: it stops a scroll CHAINING when a scroller
  // reaches its end, and does nothing at all when the thing under the thumb
  // was never scrollable in the first place. Most of the time the sheet is
  // shorter than its 88vh cap and the thread is shorter than its 206px, so
  // there is no scroller anywhere under the touch, and iOS hands the gesture
  // straight to the document behind.
  // So a touchmove that is not over something with somewhere to go is not a
  // scroll at all, and is cancelled. Anything that CAN scroll is let through
  // untouched and keeps its own contain behaviour at the edges.
  // Non-passive, because a passive listener is not allowed to preventDefault.
  // Nothing to tear down: the listener is on the overlay and dies with it.
  ov.addEventListener('touchmove',_timOvMove,{passive:false});
  const sheet=document.createElement('div');
  sheet.id=id;
  sheet.style.cssText='position:fixed;bottom:0;left:0;right:0;background:var(--bg);'+
    'border-radius:var(--r-xl) var(--r-xl) 0 0;box-shadow:0 -4px 24px rgba(0,0,0,.15);'+
    'max-height:88vh;overflow-y:auto;overscroll-behavior:contain;'+
    'padding:9px 0 calc(28px + env(safe-area-inset-bottom,0px));'+
    'opacity:0;transform:translateY(16px);'+
    'transition:opacity .22s cubic-bezier(.22,1,.36,1),transform .22s cubic-bezier(.22,1,.36,1)';
  sheet.innerHTML='<div style="width:36px;height:4px;border-radius:var(--r-pill);background:var(--border2);margin:0 auto 13px"></div>'+inner;
  ov.appendChild(sheet);document.body.appendChild(ov);
  requestAnimationFrame(()=>{sheet.style.opacity='1';sheet.style.transform='translateY(0)';});
  return sheet;
}

// ── WHO IS ALLOWED TO ASK HIM ANYTHING ──────────────────────────────────────
//
// Tim is owner and co-owner only, and that was ALWAYS the intent: the dock has
// refused to draw for a crew member since it was built, with the reason written
// next to it ("everything Tim can name is money or a contract, and both sit
// behind the wall the nav already puts them behind").
//
// The wall had a door in it. timDockRender was the only thing enforcing it, and
// the dock is not the only way in: #mmi-tim in the More menu calls openTim()
// directly and was never added to navigation.js's _gatedIds, so it stayed
// visible to crew. Reproduced 2026-09-21 on a seeded book, signed in as an
// employee with no permissions:
//
//   "how much did I make in 2026"   -> $31,000, and the best month
//   "who owes me money"             -> $60,500, the customer, 172 days out
//   "who is my best customer"       -> the name, the total, the share
//   "whats my average job"          -> $30,250
//
// None of it goes near goPg, so _empBlocked never fired. pg-money, pg-tracker
// and pg-taxes were all correctly shut, and every figure on them was readable
// from the More menu on a shared tablet.
//
// Three layers, because hiding a button is not a guard: the button goes
// (navigation.js), openTim refuses, and timAsk refuses. The last one is the
// real boundary, because it is where the figures are computed: anything that
// reaches it by any route gets nothing.
function _timCrew(){
  try{return (typeof _isEmployee!=='undefined')&&!!_isEmployee;}catch(_e){return false;}
}

// Is there a job on screen at all. Three separate pieces of copy assumed there
// was, and the same test was already written inline in two other places, so it
// is one function now (7.3).
function _timOnEstimate(){
  return !!document.getElementById('pg-est-generic')?.classList.contains('active');
}

// What he says he is doing, and it has to be TRUE where he is standing. The
// default was "Reading this job and your price book", which is right on the
// estimate builder and nonsense everywhere else: opened from the dashboard he
// is reading no job, and saying so is the app talking about a screen the man is
// not looking at. Off the builder he is reading the books, which is exactly
// what the twelve question families read.
function _timHeadHtml(sub){
  // Off the builder there is NO subtitle. "Reading your books" was the app
  // narrating its own filing: it told a man nothing he did not know and it made
  // a message thread header look like a status bar. Every thread on his phone
  // shows a name and a face and nothing else, and that is the whole job of this
  // row. On the builder the subtitle survives, because there it is about the
  // JOB in front of him rather than about Tim.
  const dflt=_timOnEstimate()?'Reading this job and your price book':'';
  return '<div style="display:flex;align-items:center;gap:9px;padding:0 16px 13px;border-bottom:1px solid var(--border)">'+
    timMark(26)+
    '<span style="flex:1;min-width:0">'+
      '<span style="display:block;font-size:14px;font-weight:700;color:var(--text)">Tim</span>'+
      ((sub||dflt)?'<span style="display:block;font-size:11.5px;color:var(--text3);margin-top:1px">'+escHtml(sub||dflt)+'</span>':'')+
    '</span>'+
    '<button type="button" onclick="_timClose()" aria-label="Close" style="width:28px;height:28px;border:0;border-radius:var(--r-pill);background:var(--bg2);display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0">'+
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>'+
    '</button>'+
  '</div>';
}

// The field and the mic, pinned under whatever else the sheet is carrying.
// Tapping the mic starts listening. It does not have to be held: the owner was
// explicit that he would never hold a button on a job site, and a thumb that
// slides off mid-sentence losing the sentence is how a feature dies.
function _timAskHtml(){
  const mic=(typeof _voiceCapable==='function'&&_voiceCapable())
    ? '<button type="button" id="_tim-mic" onclick="_timTalkToggle()" aria-label="Talk to Tim" '+
      // NO background or box-shadow in here ON PURPOSE, the same trick the send
      // arrow plays with display: an inline style beats the stylesheet, and the
      // stylesheet is what swaps this between primary and secondary off the
      // row's data-empty.
      //
      // It used to be permanently secondary, reasoning that an ink block next
      // to a filled blue arrow is two primaries on one row. That was right
      // about a row with text in it and wrong about an empty one, where the
      // arrow is already dimmed to 32% and takes no taps: nothing was primary,
      // and the only thing he could actually do from there was the quietest
      // control on the row. Owner, 2026-09-22: "I really want people to use Tim
      // to speak it since speak is easier then typing."
      'style="width:44px;height:44px;flex-shrink:0;border:0;border-radius:var(--r-pill);display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;position:relative">'+
        '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+
        '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>'+
        '<path d="M12 19v3"></path><path d="M8 22h8"></path></svg>'+
        '<span style="position:absolute;top:-3px;right:-3px;width:14px;height:14px;border-radius:var(--r-pill);background:var(--hat);box-shadow:0 0 0 2px var(--bg-card,#fff);display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:800;color:var(--ink)">T</span>'+
      '</button>'
    : '';
  // The send, BESIDE the mic and not instead of it. Both are always on the
  // row: that is what the assistant apps do (Claude, ChatGPT, WhatsApp) and
  // the swap was borrowed from iMessage, which is a different kind of app.
  // The arrow dims and stops taking taps on an empty box, so it is never a
  // dead control; see the stylesheet, which owns both states.
  const send='<button type="button" id="_tim-send" onclick="_timGo()" aria-label="Send" '+
    // No display in here on purpose: an inline style beats the stylesheet, and
    // the stylesheet is what does the swap off the row's data-empty.
    'style="width:44px;height:44px;flex-shrink:0;border:0;border-radius:var(--r-pill);'+
    'background:var(--blue);cursor:pointer;padding:0">'+
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" '+
      'stroke-linecap="round" stroke-linejoin="round">'+
      '<path d="M12 19V5"></path><path d="m5 12 7-7 7 7"></path></svg>'+
    '</button>';
  return '<div id="_tim-row" data-empty="1" style="display:flex;align-items:center;gap:10px;padding:13px 16px 0">'+
    '<input id="_tim-say" type="text" autocomplete="off" placeholder="'+
      (_timOnEstimate() ? 'Tell Tim what changed' : 'Build a T and M for Dana')+'" '+
      'style="flex:1;min-width:0;height:44px;box-sizing:border-box;padding:0 13px;border:0;border-radius:var(--r-md);background:var(--bg2);box-shadow:0 0 0 1px var(--border);font-size:13.5px;font-family:inherit;color:var(--text)">'+
    mic+send+
  '</div>'+
  '<div id="_tim-read" style="min-height:17px;font-size:12.5px;font-weight:600;color:var(--text3);padding:8px 16px 0"></div>';
}

function openTim(){
  // Layer two. The More-menu button is hidden for crew now, but an onclick is
  // still callable and a hidden control is not a closed one.
  if(_timCrew())return;
  // He has now been met, so the i on the tab retires. Redrawn straight away
  // rather than on the next render, or it sits there behind the open sheet and
  // is still there when the sheet closes, having taught nothing.
  if(_timMarkMet()&&typeof timDockRender==='function')timDockRender({cached:true});
  // The bubble has done its job the moment it is answered, and leaving it to
  // finish its seven seconds behind the open sheet would have him saying the
  // thing he is already in the middle of saying properly.
  try{const say=document.getElementById('mtb-tim-say');if(say)say.hidden=true;}catch(_e){}
  const snap=(typeof timJobSnapshot==='function')?timJobSnapshot():{};
  const found=(typeof timNudges==='function')?timNudges(snap).slice(0,2):[];
  // HE TAPPED BECAUSE OF A NUMBER, SO THE NUMBER IS THE FIRST THING ON THE
  // SHEET. Not a greeting, not a menu: the figure, what it is, why Tim thinks
  // so, and a button that does the whole job.
  const cards=found.map((n,i)=>
    '<div style="padding:13px 16px;border-bottom:1px solid var(--border)">'+
      (i===0?'<div style="font-size:26px;font-weight:700;color:var(--text);letter-spacing:-.6px;font-variant-numeric:tabular-nums;margin-bottom:7px">'+escHtml(n.title)+'</div>':'')+
      '<div style="font-size:13.5px;line-height:1.5;color:var(--text);margin-bottom:'+(n.why?'5px':'11px')+'">'+escHtml(n.what||n.line)+'</div>'+
      (n.why?'<div style="font-size:12px;line-height:1.5;color:var(--text3);margin-bottom:11px">'+escHtml(n.why)+'</div>':'')+
      '<div style="display:flex;gap:9px">'+
        '<button type="button" onclick="_timTakeNudge('+escHtml(JSON.stringify(n.id))+')" style="flex:1;height:44px;border:0;border-radius:var(--r-md);background:var(--blue);color:#fff;font-family:inherit;font-size:14.5px;font-weight:700;cursor:pointer">'+escHtml(n.cta)+'</button>'+
        '<button type="button" onclick="_timDropNudge('+escHtml(JSON.stringify(n.id))+')" style="height:44px;padding:0 15px;border:0;border-radius:var(--r-md);background:var(--bg);box-shadow:0 0 0 1px var(--border2);color:var(--text2);font-family:inherit;font-size:13.5px;font-weight:600;cursor:pointer">'+escHtml(n.alt)+'</button>'+
      '</div>'+
    '</div>').join('');

  // Nothing found is not an empty state to apologise for. He opened the dock,
  // so he wants to say something: give him the field and get out of the way.
  //
  // But it has to be true where he is standing. This said "Nothing on this one
  // worth stopping you for. Say what changed and I will put it where it goes."
  // on EVERY screen. Opened from the dashboard, "this one" is nothing, "what
  // changed" is nothing, and the man is reading a sentence about a job that is
  // not on his screen. That was the first thing he saw, and it was the first
  // thing that made no sense.
  //
  // Three states now, and the third is the important one: once there IS a
  // thread, there is no opening line at all. The conversation is the content,
  // and nobody wants a paragraph of introduction sitting on top of their own
  // messages every time they open them.
  const hasThread=(typeof timLogEntries==='function')&&timLogEntries().length>0;
  // Given an id so it can LEAVE. The three states below decide whether it is
  // drawn when he opens; they cannot see the fourth, which is the man typing
  // the first thing into an empty sheet. The line is an introduction to a
  // conversation, so the moment there is one it is in the way, and it used to
  // sit there above his own first question taking a third of the sheet.
  const quiet=found.length||hasThread?'':_timHelloHtml();

  // The log row is last and is usually nothing at all: an empty log adds no
  // furniture to a sheet he opened in order to talk. It only speaks up once
  // there is something to read back, or when his knowledge did not load, which
  // is the one state worth interrupting him about (js/tim-log.js).
  const logRow=(typeof _timLogRowHtml==='function')?_timLogRowHtml():'';

  // The last few things said to him, above the box he says them in. Capped in
  // height so a long history cannot push the input off a phone screen: the
  // thing he came here to do is type, and the history is context, not the
  // point.
  const thread=(typeof _timThreadHtml==='function')
    ? '<div id="_tim-thread" style="max-height:206px;overflow-y:auto;-webkit-overflow-scrolling:touch;'+
      'border-bottom:1px solid var(--border);padding:4px 0 6px">'+_timThreadHtml()+'</div>'
    : '';

  // "Nothing to flag on this job" is only true when a job is up. Off the
  // builder the header falls back to what he is actually reading.
  const sub=found.length?null:(_timOnEstimate()?'Nothing to flag on this job':null);
  _timSheet('_tim-sheet',_timHeadHtml(sub)+cards+quiet+thread+_timAskHtml()+logRow);

  const el=document.getElementById('_tim-say');
  el?.addEventListener('input',_timPreview);
  el?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();_timGo();}});
  _timPreview();
  // Open on the newest, the way every thread on the phone does.
  const box=document.getElementById('_tim-thread');
  if(box)box.scrollTop=box.scrollHeight;
  // No autofocus. A keyboard covering the page he came here to look at is the
  // opposite of the point, and the mic is the way in on a job site anyway.
}

// ── Starting a proposal through Tim ──────────────────────────────────────────
//
// Owner 2026-09-19: "you click into him and say you want to build a T&M or a
// true bid scan or a BYO then he asks is there any site notes like a dog,
// parking restrictions, etc? Answer then go."
//
// Two steps and no more. He says which door and who it is for; Tim asks the one
// question that is always worth asking and is never asked at the right moment;
// then the builder opens with the answer already saved.
//
// Why THAT question and no other: the site note is the only thing on the
// estimate that is worth capturing while he is still standing on the driveway
// looking at the dog. Everything else on the page he can do sitting down. The
// old field asked for it in a textarea on a page he opens to write scope, which
// is the wrong moment, and so it was almost always empty.
//
// The routing is `_pickEstStyle` in js/clients.js, untouched. Tim sets the same
// state the picker sets and calls the same function, so a door opened through
// him and a door opened by tapping a card are the same door (7.3).
let _timBuild=null;   // {style, client} while the two steps are in flight

function _timStartBuild(styleId,client){
  const s=TIM_STYLES.find(x=>x.id===styleId);
  if(!s||!client)return false;
  _timBuild={style:s,client};
  _timAskSiteNote();
  return true;
}

// Step two. One question, and it is different depending on whether he has been
// to this property before, because asking a man for a gate code he gave you in
// May is how an assistant teaches somebody to ignore it.
function _timAskSiteNote(){
  const b=_timBuild;
  if(!b)return;
  const addr=(b.client&&b.client.addr)||'';
  const addrShort=addr.split(',')[0].trim();
  const known=(typeof getSiteNote==='function')?String(getSiteNote(b.client,addr)||'').trim():'';
  const who=(b.client.name||'this job');

  const head=_timHeadHtml(b.style.name+' for '+who);

  const body=known
    // He has been here before. Show what he said last time and let him confirm
    // it in one tap, which is the whole job most of the time.
    ? '<div style="padding:15px 16px 0">'+
        '<div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:6px">Anything changed at '+
          escHtml(addrShort||'this property')+'?</div>'+
        '<div style="font-size:13px;line-height:1.55;color:var(--text2);padding:11px 13px;border-radius:var(--r-md);background:var(--bg2);box-shadow:0 0 0 1px var(--border)">'+
          escHtml(known)+'</div>'+
        '<div style="font-size:11.5px;color:var(--text-3);margin-top:7px">What you told me last time you were there.</div>'+
      '</div>'+
      '<div style="display:flex;gap:9px;padding:13px 16px 0">'+
        '<button type="button" onclick="_timBuildGo()" style="flex:1;height:48px;border:0;border-radius:var(--r-md);background:var(--blue);color:#fff;font-family:inherit;font-size:15px;font-weight:700;cursor:pointer">Still right, start</button>'+
        '<button type="button" onclick="_timEditSiteNote()" style="height:48px;padding:0 16px;border:0;border-radius:var(--r-md);background:var(--bg);box-shadow:0 0 0 1px var(--border2);color:var(--text2);font-family:inherit;font-size:14px;font-weight:600;cursor:pointer">Change it</button>'+
      '</div>'
    // First time here. Ask plainly, in the words a foreman would use, and name
    // the three things it is nearly always about.
    : '<div style="padding:15px 16px 0">'+
        '<div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:5px">Anything the crew should know before they get there?</div>'+
        '<div style="font-size:12.5px;line-height:1.55;color:var(--text-3)">A dog, where to park, a gate code, a lock box. Crew only, it never goes on the proposal.</div>'+
      '</div>'+
      _timNoteFieldHtml('')+
      '<div style="display:flex;gap:9px;padding:13px 16px 0">'+
        '<button type="button" onclick="_timSaveSiteNoteAndGo()" style="flex:1;height:48px;border:0;border-radius:var(--r-md);background:var(--blue);color:#fff;font-family:inherit;font-size:15px;font-weight:700;cursor:pointer">Save it and start</button>'+
        '<button type="button" onclick="_timBuildGo()" style="height:48px;padding:0 16px;border:0;border-radius:var(--r-md);background:var(--bg);box-shadow:0 0 0 1px var(--border2);color:var(--text2);font-family:inherit;font-size:14px;font-weight:600;cursor:pointer">Nothing</button>'+
      '</div>';

  _timSheet('_tim-sheet',head+body);
  if(!known)setTimeout(()=>document.getElementById('_tim-note')?.focus(),80);
}

// The field, with the same on-device mic every note in this app uses. A gate
// code said out loud on a driveway is the exact case it exists for.
function _timNoteFieldHtml(val){
  const mic=(typeof _voiceCapable==='function'&&_voiceCapable())
    ? '<button type="button" onclick="_timTalkToggle(\'_tim-note\')" aria-label="Say it instead" '+
      'style="width:44px;height:44px;flex-shrink:0;border:0;border-radius:var(--r-md);background:var(--ink);display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0">'+
        '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+
        '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>'+
        '<path d="M12 19v3"></path><path d="M8 22h8"></path></svg>'+
      '</button>'
    : '';
  return '<div style="display:flex;align-items:flex-start;gap:10px;padding:13px 16px 0">'+
    '<textarea id="_tim-note" rows="2" placeholder="Dog in the back, park on the street, code 4417" '+
      'style="flex:1;min-width:0;box-sizing:border-box;padding:11px 13px;border:0;border-radius:var(--r-md);'+
      'background:var(--bg2);box-shadow:0 0 0 1px var(--border);font-size:13.5px;font-family:inherit;'+
      'color:var(--text);resize:vertical;line-height:1.5">'+escHtml(val||'')+'</textarea>'+
    mic+
  '</div>';
}
function _timEditSiteNote(){
  const b=_timBuild;
  if(!b)return;
  const known=(typeof getSiteNote==='function')?String(getSiteNote(b.client,b.client.addr)||''):'';
  _timSheet('_tim-sheet',_timHeadHtml(b.style.name+' for '+(b.client.name||'this job'))+
    '<div style="padding:15px 16px 0">'+
      '<div style="font-size:14px;font-weight:700;color:var(--text)">What should the crew know?</div>'+
    '</div>'+
    _timNoteFieldHtml(known)+
    '<div style="display:flex;gap:9px;padding:13px 16px 0">'+
      '<button type="button" onclick="_timSaveSiteNoteAndGo()" style="flex:1;height:48px;border:0;border-radius:var(--r-md);background:var(--blue);color:#fff;font-family:inherit;font-size:15px;font-weight:700;cursor:pointer">Save it and start</button>'+
    '</div>');
  setTimeout(()=>document.getElementById('_tim-note')?.focus(),80);
}

function _timSaveSiteNoteAndGo(){
  const el=document.getElementById('_tim-note');
  const said=el?String(el.value||'').trim():'';
  // "Nope" is an answer to the question, not a gate code. Saving it would put
  // the word nope on a customer's house forever.
  if(said&&!timIsNothing(said))_timPendingSiteNote=said;
  _timBuildGo();
}

// WHICH PROPERTY the note belongs to is not known yet. A client can own five
// houses and the builder is the thing that asks which one this job is at, so
// the answer is held here and written the moment the estimate page knows its
// address (js/generic-estimate.js, _geiShowSharedChrome). Writing it to the
// primary address now would put the gate code for house four on house one.
let _timPendingSiteNote='';
function timTakePendingSiteNote(){
  const v=_timPendingSiteNote;
  _timPendingSiteNote='';
  return v;
}

function _timBuildGo(){
  const b=_timBuild;
  _timBuild=null;
  _timClose();
  if(!b)return;
  // The app's own router, with the state it expects. One door, one code path.
  if(typeof _stylePickState!=='undefined')_stylePickState={c:b.client,overrideAddr:null};
  if(typeof _pickEstStyle==='function')_pickEstStyle(b.style.id);
  timDockRefresh();
}

// He said "start something for Dana" and never said which kind. Three rows, the
// same three the picker card shows, because at that point naming them is faster
// than making him say it again.
function _timAskStyle(client){
  const rows=TIM_STYLES.map(s=>{
    const sub=s.id==='tm'?'Bill the hours as they happen'
      :s.id==='truebid'?'Measure it, then price what you measured'
      :'One line per service, at your prices';
    return '<button type="button" onclick="_timStartBuild('+escHtml(JSON.stringify(s.id))+',_timPickFor)" '+
      'style="display:flex;align-items:center;gap:11px;width:100%;padding:14px 16px;border:0;border-top:1px solid var(--border);background:none;cursor:pointer;font-family:inherit;text-align:left">'+
      '<span style="flex:1;min-width:0">'+
        '<span style="display:block;font-size:14.5px;font-weight:600;color:var(--text)">'+escHtml(s.name)+'</span>'+
        '<span style="display:block;font-size:11.5px;color:var(--text-3);margin-top:2px">'+sub+'</span>'+
      '</span>'+
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--border2)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="m9 18 6-6-6-6"></path></svg>'+
    '</button>';
  }).join('');
  window._timPickFor=client;
  _timSheet('_tim-sheet',_timHeadHtml('For '+(client.name||'this job'))+
    '<div style="padding:15px 16px 4px;font-size:14px;font-weight:700;color:var(--text)">How are you billing it?</div>'+rows);
}

// ── What he presses ──────────────────────────────────────────────────────────
function _timTakeNudge(id){
  const n=(typeof timNudges==='function')?timNudges(timJobSnapshot()).find(x=>x.id===id):null;
  if(typeof timAccepted==='function')timAccepted(id);
  _timClose();
  if(!n)return;
  if(id==='access-missing'&&typeof timAddAccess==='function')timAddAccess(n);
  else if(id==='under-book'&&typeof _timTakeBookPrice==='function')_timTakeBookPrice();
  else if(id==='still-owes'&&typeof goPg==='function')goPg('pg-money');
  // The three that read the books rather than the estimate. All three are about
  // money already earned or already quoted, so all three end at a screen he can
  // act on rather than at a form he has to fill in.
  else if((id==='books-late'||id==='books-fresh')&&typeof goPg==='function')goPg('pg-money');
  else if(id==='bid-cold'&&typeof goPg==='function')goPg('pg-leads');
  else if(id==='state-blocks'&&typeof _geiToStylePicker==='function')_geiToStylePicker();
  // The button that never did anything. "Take the total off" now takes the
  // total off: the est layer is what puts one on, and _tmDropLayer is the same
  // door the chip uses, so this cannot drift out of step with tapping it.
  else if(id==='state-frees'&&typeof _tmDropLayer==='function')_tmDropLayer('est');
  else if(id==='runs-over'&&typeof _timRaiseHours==='function')_timRaiseHours(n);
  timDockRefresh();
}
function _timDropNudge(id){
  // The figure rides along so a book finding can come back when the money
  // moves. Read off the same snapshot the nudge was built from rather than
  // recomputed, or the two could disagree and it would never come back at all.
  let sig=null;
  try{
    const snap=(typeof timJobSnapshot==='function')?timJobSnapshot():null;
    if(snap&&snap._amounts)sig=String(snap._amounts[id]||0);
  }catch(_e){}
  if(typeof timDismiss==='function')timDismiss(typeof _timJobKey==='function'?_timJobKey():'_',id,sig);
  _timClose();
  timDockRefresh();
}

// ── What "Add it to the job" actually does ───────────────────────────────────
//
// Each of these writes through the screen's own path, never straight into the
// data, so the rail, the gauge, the payroll cost and the autosave all react the
// way they do when he types it himself.

// The access equipment he did not put on a job that needs it. It lands as a
// material line at what it costs, plus the hours to set and strike, because a
// scaffold that is on the money and not on the clock still loses him the day.
function timAddAccess(n){
  const cost=Math.round(Number(n&&n.amount)||0)||_timFigureDollars(n);
  if(!(cost>0))return;
  if(typeof _geiLines!=='undefined'&&Array.isArray(_geiLines)){
    _geiLines.push({desc:'Scaffold'+(n&&n.what&&/elevation/.test(n.what)?', '+n.what.replace(/^.*?,\s*/,'').replace(/\.$/,''):''),
      qty:1,unit:'lot',rate:cost,total:cost,notes:'Set and strike',
      _byoSection:(typeof _byoWorkSection==='function')?_byoWorkSection():'Work'});
    if(typeof renderGeiLines==='function')renderGeiLines();
    if(typeof calcGeiTotal==='function')calcGeiTotal();
  }
  _timAddHours(6);
  if(typeof _byoAutosave==='function')_byoAutosave();
  if(typeof showToast==='function')showToast('Scaffold added, 6 hours on the clock','🔧',2600);
}
// The T&M page asks for DAYS and derives hours from them (_tmInputChange), so
// hours are written through that field rather than into _tmEstHours directly.
// Writing the variable would show the right total on a page whose own input
// still said something else, and the next keystroke would undo it.
function _timSetHours(h){
  const el=document.getElementById('tm-i-days');
  if(!el)return false;
  const days=Math.round((Math.max(0,Number(h)||0)/8)*10)/10;
  el.value=String(days);
  if(typeof _tmInputChange==='function')_tmInputChange();
  return true;
}
function _timHours(){
  const d=parseFloat((document.getElementById('tm-i-days')||{}).value)||0;
  return d*8;
}
function _timAddHours(h){return _timSetHours(_timHours()+(Number(h)||0));}
// Put the line back to the price he already charges. His book is the authority,
// which is the only reason this is a button and not a suggestion.
function _timTakeBookPrice(){
  const u=(typeof _timUnderBook==='function')?_timUnderBook():null;
  if(!u||typeof _geiLines==='undefined')return;
  const l=_geiLines[u.at-1];
  if(!l)return;
  l.rate=u.bookRate;
  l.total=Math.round(u.bookRate*(Number(l.qty)||1));
  if(typeof renderGeiLines==='function')renderGeiLines();
  if(typeof calcGeiTotal==='function')calcGeiTotal();
  if(typeof _byoAutosave==='function')_byoAutosave();
  if(typeof showToast==='function')showToast('Line '+u.at+' is back at your price','🔧',2400);
}
// His own clock says these run long. Putting the hours up is his call, and the
// figure is the one the clock produced, not a pad.
function _timRaiseHours(n){
  const add=Math.round(Number(n&&n.amount)||0)||0;
  const extra=add>0?add:_timOverrunHours();
  if(!(extra>0))return;
  if(_timAddHours(extra)&&typeof _byoAutosave==='function')_byoAutosave();
}
function _timOverrunHours(){const o=(typeof _timOverrun==='function')?_timOverrun():null;return o?o.hours:0;}
function _timFigureDollars(n){
  const m=String((n&&n.figure)||'').replace(/[^0-9.]/g,'');
  const v=parseFloat(m);
  return isNaN(v)?0:Math.round(v);
}

// ── Tap once, talk, tap again ────────────────────────────────────────────────
//
// The owner: "wouldn't ever want to hold a mic." So this is a toggle, and while
// it is running the sheet turns into the dark listening panel with his words on
// it and a full-width Done talking button. Nothing he says is added to anything
// until he reads it back and presses the button at the end.
//
// The transcription is js/voice.js, which is the on-device recogniser every
// note field already uses. Nothing is uploaded and nothing is stored: the same
// promise the rest of Tim makes.
let _timTalking=false,_timHeard='',_timWaveTimer=null,_timTalkStart=0;

function _timWaveHtml(t){
  const n=44;
  let out='';
  for(let i=0;i<n;i++){
    // A smooth envelope so the bar field reads as a voice rather than noise:
    // it swells toward the middle and two slow waves ride over it. The last six
    // are the live edge and sit dim, which is what makes it look like it is
    // still arriving.
    const x=i/(n-1);
    const env=Math.sin(Math.PI*x);
    const ride=0.55+0.45*Math.sin(t*2.1+i*0.42)*Math.cos(t*0.9+i*0.17);
    const h=Math.max(6,Math.round(8+20*env*Math.abs(ride)));
    out+='<span class="'+(i>=n-6?'edge':'')+'" style="height:'+h+'px"></span>';
  }
  return out;
}

function _timTalkPanel(){
  const secs=Math.max(0,Math.round((Date.now()-_timTalkStart)/1000));
  const clock=Math.floor(secs/60)+':'+String(secs%60).padStart(2,'0');
  return '<div id="_tim-listen" style="background:var(--ink);margin:0 0 -28px;padding:16px 16px calc(18px + env(safe-area-inset-bottom,0px))">'+
    '<div style="display:flex;align-items:center;gap:9px;margin-bottom:12px">'+
      timMark(22)+
      '<span style="font-size:12px;font-weight:600;color:var(--text-cream)">Tim is listening</span>'+
      '<span style="flex:1"></span>'+
      '<span id="_tim-clock" style="font-size:11.5px;color:var(--text-cream-2);font-variant-numeric:tabular-nums">'+clock+'</span>'+
    '</div>'+
    '<div id="_tim-transcript" style="font-size:13.5px;line-height:1.55;color:var(--text-cream);margin-bottom:14px;min-height:42px"></div>'+
    '<div class="tim-wave" id="_tim-wave">'+_timWaveHtml(0)+'</div>'+
    '<button type="button" onclick="_timTalkToggle()" style="width:100%;height:52px;margin-top:16px;border:0;border-radius:var(--r-md);background:var(--text-cream);color:var(--ink);font-family:inherit;font-size:15.5px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:9px">'+
      '<span style="width:13px;height:13px;border-radius:3px;background:var(--c-red)"></span>Done talking</button>'+
    '<div style="text-align:center;font-size:12px;color:var(--text-cream-2);margin-top:10px">Keep going as long as you want. Nothing is added until you approve it.</div>'+
  '</div>';
}

// WHICH FIELD the words land in. The sheet has two: the command line on the
// findings panel, and the site-note field when Tim is starting a proposal. Same
// mic, same waveform, same promise, different destination, so the id comes in
// rather than being assumed.
let _timTalkTarget='_tim-say';
function _timTalkToggle(target){
  if(_timTalking){_timTalkStop();return;}
  _timTalkTarget=target||'_tim-say';
  _timTalkBegin();
}

// WHERE THE LISTENING PANEL LIVES. Inside Tim's sheet when the sheet is open,
// which is every case this started with. But dictating the scope happens on the
// estimate page with no sheet anywhere, and the panel carries the waveform, the
// clock and the only Done button there is: without a host it went nowhere and
// the mic could be started and never stopped.
function _timTalkHost(){
  const sheet=document.getElementById('_tim-sheet');
  if(sheet)return sheet;
  let f=document.getElementById('_tim-listen-host');
  if(!f){
    f=document.createElement('div');
    f.id='_tim-listen-host';
    document.body.appendChild(f);
  }
  return f;
}

function _timTalkBegin(){
  const el=document.getElementById(_timTalkTarget);
  if(!el)return;
  _timTalking=true;_timHeard='';_timTalkStart=Date.now();
  _timTalkHost().insertAdjacentHTML('beforeend',_timTalkPanel());
  const tick=()=>{
    if(!_timTalking)return;
    const t=(Date.now()-_timTalkStart)/1000;
    const w=document.getElementById('_tim-wave');
    if(w)w.innerHTML=_timWaveHtml(t);
    const c=document.getElementById('_tim-clock');
    if(c)c.textContent=Math.floor(t/60)+':'+String(Math.floor(t%60)).padStart(2,'0');
  };
  _timWaveTimer=setInterval(tick,110);
  if(typeof _voiceStart==='function'){
    _voiceStart(el,(joined,heard)=>{
      _timHeard=joined;
      const tr=document.getElementById('_tim-transcript');
      if(tr)tr.textContent=joined?('"'+joined+'"'):'';
    });
  }
}

function _timTalkStop(silent){
  if(!_timTalking){return Promise.resolve();}
  _timTalking=false;
  if(_timWaveTimer){clearInterval(_timWaveTimer);_timWaveTimer=null;}
  document.getElementById('_tim-listen')?.remove();
  document.getElementById('_tim-listen-host')?.remove();
  const finish=(text)=>{
    const said=String(text||_timHeard||'').trim();
    const el=document.getElementById(_timTalkTarget);
    if(el&&said)el.value=said;
    if(silent||!said)return;
    // Dictating a site note fills the field and stops. It is an answer to a
    // question Tim asked, not a new instruction, so reading it back as a job
    // would throw away the question he is halfway through answering.
    // Except the scope box. "Talk to Tim" there means he takes it from here:
    // the steps are built the moment the man stops talking, in order, with
    // what he left out (owner, 2026-09-23). Tapping Build after talking was a
    // second thing to do that the button's own name had already promised.
    if(_timTalkTarget==='byo-say'){if(typeof _byoSayBuild==='function')_byoSayBuild();return;}
    if(_timTalkTarget==='gei-scope-say'){
      if(typeof _geiScopeBuild==='function')
        _geiScopeBuild((typeof _geiIsTM!=='undefined'&&_geiIsTM)?'tm-scope-wrap':'byo-scope-wrap');
      return;
    }
    if(_timTalkTarget!=='_tim-say')return;
    _timShowRead(said);
  };
  // Returned so a caller that is leaving (Save, a page change) can wait for
  // the words to land in the field before it saves.
  if(typeof _voiceStop==='function')return Promise.resolve(_voiceStop()).then(finish).catch(()=>finish(''));
  finish('');
  return Promise.resolve();
}

// ── What Tim made of it ──────────────────────────────────────────────────────
//
// Three headings and nothing else, because three is what he can check standing
// up. What came off his own book, at his own prices. What Tim moved or added
// and the sentence saying why. What it takes to do the work, in the four
// categories his Supply List already uses.
//
// The button at the bottom is the only thing that changes the proposal. Up to
// that point this is a thing to read.
let _timJob=null;

function _timShowRead(said){
  const trade=(typeof getActiveTrade==='function'?getActiveTrade():'general')||'general';
  const book=(typeof S!=='undefined'&&S.priceBook&&Array.isArray(S.priceBook[trade]))?S.priceBook[trade]:[];
  const catalog=(typeof TRADE_JOBS!=='undefined'&&Array.isArray(TRADE_JOBS[trade]))?TRADE_JOBS[trade]:[];
  const job=(typeof timReadJob==='function')?timReadJob(said,{
    clients:(typeof clients!=='undefined'?clients:[]),book,catalog,trade,
  }):null;
  if(!job){_timGo();return;}
  _timJob=job;

  const money=n=>(typeof timPrice==='function')?timPrice(n):('$'+Math.round(n||0));
  const micro=t=>'<div style="padding:13px 16px 9px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3)">'+t+'</div>';

  const who=(job.client&&job.client.name)||'This job';
  const kind=job.type==='tm'?'time and materials':'proposal';

  let html=
    '<div style="display:flex;align-items:center;gap:9px;padding:0 16px 13px;border-bottom:1px solid var(--border)">'+
      timMark(20)+
      '<span style="flex:1;min-width:0;font-size:13px;font-weight:700;color:var(--text)">'+escHtml(who)+' · '+kind+'</span>'+
      '<span style="font-size:11.5px;color:var(--text3);font-variant-numeric:tabular-nums;flex-shrink:0">'+job.hours+' hrs</span>'+
    '</div>';

  if(job.fromBook.length){
    html+=micro('Straight off your price book')+
      job.fromBook.map(s=>
        '<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 16px;border-top:1px solid var(--border)">'+
          '<span style="flex:1;min-width:0;font-size:13px;color:var(--text)">'+escHtml(s.text)+
            '<span style="display:block;font-size:10.5px;color:var(--text3);margin-top:2px">'+escHtml(s.why)+'</span></span>'+
          '<span style="font-size:13px;font-weight:600;color:var(--text);font-variant-numeric:tabular-nums;flex-shrink:0">'+money(s.rate)+'</span>'+
        '</div>').join('');
  }

  if(job.implied.length){
    html+='<div style="background:#FFFDF7;border-top:1px solid var(--border);margin-top:6px">'+
      '<div style="padding:13px 16px 8px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--c-amber-deep)">Tim put these in the right place</div>'+
      job.implied.map((r,i)=>
        '<div style="display:flex;gap:11px;padding:9px 16px;align-items:baseline;border-top:1px solid #F3E7CE">'+
          '<span style="font-size:11.5px;font-weight:600;color:var(--text3);font-variant-numeric:tabular-nums;flex-shrink:0">'+(i+1)+'</span>'+
          '<span style="flex:1;min-width:0;font-size:13px;color:var(--text);line-height:1.4">'+escHtml(r.say)+
            '<span style="display:block;font-size:10.5px;color:var(--text3);margin-top:2px">'+escHtml(r.because)+'</span></span>'+
        '</div>').join('')+
      '<div style="height:11px"></div></div>';
  }

  if(job.materials.length){
    const anyPriced=job.suppliesPriced>0;
    const secs=[];
    (typeof TIM_SUPPLY_SECTIONS!=='undefined'?TIM_SUPPLY_SECTIONS:[]).forEach(sec=>{
      const rows=job.materials.filter(m=>m.section===sec.id);
      if(!rows.length)return;
      secs.push('<div style="padding:8px 16px 7px;background:'+sec.bg+';border-top:1px solid var(--border);font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:'+sec.color+'">'+escHtml(sec.label)+'</div>'+
        rows.map(m=>{
          const f=timLineFigures(m);
          return '<div style="display:flex;align-items:flex-start;gap:8px;padding:9px 16px;border-top:1px solid var(--border)">'+
            '<span style="flex:1;min-width:0;font-size:12.5px;color:var(--text)">'+escHtml(m.label)+
              (m.detail?'<span style="display:block;font-size:10.5px;color:var(--text3);margin-top:2px">'+escHtml(m.detail)+'</span>':'')+
            '</span>'+
            '<span style="font-size:12px;color:var(--text3);font-variant-numeric:tabular-nums;flex-shrink:0;text-align:right">'+escHtml(f.qtyLabel)+
              (f.packNote?'<span style="display:block;font-size:10px">'+escHtml(f.packNote)+'</span>':'')+
            '</span>'+
            // A blank here is the honest answer for something he has never
            // bought, counted under the total rather than guessed at. The whole
            // column goes when nothing on the list is priced, because five
            // blanks in a row is worse at saying "your book is thin" than one
            // sentence underneath is.
            (anyPriced?('<span style="width:62px;flex-shrink:0;text-align:right;font-size:12.5px;font-weight:600;color:var(--text);font-variant-numeric:tabular-nums">'+
              (Number(m.rate)>0?money(m.rate):'<span style="color:var(--text3);font-weight:400">-</span>')+
            '</span>'):'')+
          '</div>';
        }).join(''));
    });
    const trades=(typeof timTradesOn==='function')?timTradesOn(job.materials).length:1;
    html+='<div style="display:flex;align-items:baseline;gap:7px;padding:13px 16px 4px">'+
        '<span style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3)">Supply list</span>'+
        '<span style="flex:1"></span>'+
        '<span style="font-size:11px;color:var(--text3)">'+job.materials.length+' item'+(job.materials.length===1?'':'s')+
          (trades>1?', '+trades+' trades':'')+'</span>'+
      '</div>'+secs.join('');
  }

  (job.coverage||[]).forEach(c=>{
    html+='<div style="display:flex;align-items:flex-start;gap:9px;padding:12px 16px;border-top:1px solid var(--border)">'+
      timMark(20)+
      '<div style="font-size:12.5px;line-height:1.5;color:var(--text2)">'+escHtml(c.line)+'</div>'+
    '</div>';
  });

  if(job.suppliesPriced>0){
    html+='<div style="display:flex;align-items:baseline;justify-content:space-between;padding:12px 16px;border-top:1px solid var(--border)">'+
      '<span style="font-size:13px;font-weight:600;color:var(--text)">Supplies at cost</span>'+
      '<span style="font-size:15px;font-weight:700;color:var(--text);font-variant-numeric:tabular-nums">'+money(job.suppliesCost)+'</span>'+
    '</div>';
    if(job.suppliesUnpriced>0){
      html+='<div style="padding:0 16px 10px;font-size:11.5px;line-height:1.5;color:var(--text3)">'+
        job.suppliesUnpriced+' of these '+(job.suppliesUnpriced===1?'has':'have')+
        ' no price in your book yet, so '+(job.suppliesUnpriced===1?'it is':'they are')+' not in that figure.</div>';
    }
  }else if(job.materials.length){
    // Nothing on the list is in his book. Said once, plainly, instead of a
    // column of dashes and a total of zero.
    html+='<div style="padding:12px 16px;border-top:1px solid var(--border);font-size:12px;line-height:1.5;color:var(--text3)">'+
      'None of these are in your price book yet, so there is no cost on them. Buy them once and the next list carries what you paid.</div>';
  }

  if(job.addedHours>0){
    html+='<div style="display:flex;align-items:baseline;justify-content:space-between;padding:12px 16px;border-top:1px solid var(--border)">'+
      '<span style="font-size:13px;font-weight:600;color:var(--text)">Time on the contract</span>'+
      '<span style="font-size:13px;color:var(--text2);font-variant-numeric:tabular-nums">'+job.saidHours+' hrs, plus '+job.addedHours+' for the '+_timHoursFor(job)+'</span>'+
    '</div>';
  }

  const nothing=!job.fromBook.length&&!job.implied.length&&!job.materials.length;
  html+='<div style="display:flex;gap:9px;padding:13px 16px 0;border-top:1px solid var(--border)">'+
    '<button type="button" onclick="_timAcceptJob()" '+(nothing?'disabled ':'')+
      'style="flex:1;height:48px;border:0;border-radius:var(--r-md);background:var(--blue);color:#fff;font-family:inherit;font-size:15px;font-weight:700;cursor:pointer'+(nothing?';opacity:.45':'')+'">Looks right, add it</button>'+
    '<button type="button" onclick="_timChangeOne()" style="height:48px;padding:0 16px;border:0;border-radius:var(--r-md);background:var(--bg);box-shadow:0 0 0 1px var(--border2);color:var(--text2);font-family:inherit;font-size:14px;font-weight:600;cursor:pointer">Change one</button>'+
  '</div>';

  if(nothing){
    html+='<div style="padding:10px 16px 0;font-size:12.5px;line-height:1.5;color:var(--text3)">'+
      'I could not place any of that against your book. Say it with the work in it, or add the line yourself and I will know it next time.</div>';
  }

  _timSheet('_tim-sheet',_timHeadHtml('What I made of it')+html);
}

// What the extra hours are for, named. "Plus 6 for the scaffold" is a thing he
// can picture; "plus 6 for the access" is a category.
function _timHoursFor(job){
  const r=(job.implied||[]).filter(x=>Number(x.hours)>0);
  if(!r.length)return 'access';
  const word=String(r[0].step||r[0].say||'').toLowerCase().replace(/^set\s+/,'').split(',')[0].trim();
  return word||'access';
}

// The only function here that changes the proposal.
function _timAcceptJob(){
  const job=_timJob;
  if(!job)return;
  let landed=0;

  // SCOPE, IN THE ORDER THE WORK HAPPENS. _geiScopeChips is the app's own scope
  // store and it keeps its array order on render, so putting the steps in it in
  // work order IS the ordering (7.3: the existing store, pointed at new data).
  if(typeof _geiScopeChips!=='undefined'&&Array.isArray(_geiScopeChips)&&job.order.length){
    const want=job.order.map(s=>s.text);
    const keep=_geiScopeChips.filter(l=>want.indexOf(l)<0);
    _geiScopeChips.length=0;
    want.concat(keep).forEach(l=>_geiScopeChips.push(l));
    if(typeof _geiScopeNoScope!=='undefined')_geiScopeNoScope=false;
    landed+=want.length;
    ['tm-scope-wrap','byo-scope-wrap'].forEach(id=>{if(typeof _renderScopeChips==='function')_renderScopeChips(id);});
    if(typeof _geiRenderScopeCard==='function')_geiRenderScopeCard(_geiIsTM?'tm':'byo');
  }

  // The supply list rides on the bid record, which already saves and syncs, so
  // it needs no store of its own (7.3).
  if(job.materials.length&&typeof _geiEditBidId!=='undefined'&&_geiEditBidId&&typeof bids!=='undefined'){
    const b=bids.find(x=>x.id===_geiEditBidId);
    if(b){b.timSupply=JSON.parse(JSON.stringify(job.materials));landed+=job.materials.length;}
  }

  // The hours he said, plus what the access adds. Written the way the screen
  // writes them so the rail, the gauge and the payroll cost all recompute.
  if(job.hours>0)_timSetHours(job.hours);

  // What he accepted stops being a guess. Two of these and Tim stops asking.
  (job.implied||[]).forEach(r=>{if(typeof timLearn==='function')timLearn('implied',r.id,true);});
  if(typeof _byoAutosave==='function')_byoAutosave();
  _timJob=null;
  _timClose();
  timDockRefresh();
  if(typeof showToast==='function')showToast(landed?('Added '+landed+' to this proposal'):'Nothing to add','🔧',2400);
}

// "Change one" is not a form. It puts him back on the page with the sheet gone,
// because every one of these lines is already editable where it lives, and a
// second editor for the same data is the thing 7.3 exists to stop.
function _timChangeOne(){
  _timJob=null;
  _timClose();
  if(typeof showToast==='function')showToast('Tap any line on the page to change it','🔧',2600);
}

// ── The typed path ───────────────────────────────────────────────────────────
// Unchanged from the box this sheet replaced: a sentence that names a screen or
// a customer still just goes there.
// ── WHICH OF THE TWO IS THE PRIMARY ──────────────────────────────────────────
//
// This was :placeholder-shown, which is the elegant answer and the wrong one on
// the platform that matters. WebKit does not re-evaluate that pseudo-class when
// the value is written from script, and every interesting write here is from
// script: the send clears the box, dictation fills it, a chip fills it. On an
// iPhone, which is the only place the mic exists at all, the arrow stayed lit
// and tappable over an empty box after every single send.
//
// An ATTRIBUTE change invalidates reliably everywhere, so the row carries the
// answer and the stylesheet reads it. One source of truth rather than two that
// can disagree, set from the input listener, which now fires on typing and on
// every programmatic write alike (_timSetSaid).
// Set on the STYLED ELEMENTS, not only on the row. A descendant selector keyed
// on an ancestor's attribute (#_tim-row[data-empty] #_tim-mic) did flip the
// attribute on WebKit and did not repaint the button, twice, so the selector is
// now self-referential: the element whose paint changes is the element whose
// attribute changed. That is the invalidation path with the least room to be
// wrong, and it costs one extra setAttribute.
function _timRowEmpty(){
  const el=document.getElementById('_tim-say');
  const v=(el&&String(el.value||'').trim())?'0':'1';
  ['_tim-row','_tim-mic','_tim-send'].forEach(id=>{
    const n=document.getElementById(id);
    if(n)n.setAttribute('data-empty',v);
  });
}

function _timPreview(){
  const el=document.getElementById('_tim-say');
  const out=document.getElementById('_tim-read');
  // Before any early return: the row's state is not conditional on a preview
  // target existing.
  _timRowEmpty();
  if(!el||!out)return;
  const trade=(typeof getActiveTrade==='function'?getActiveTrade():'general')||'general';
  const book=(typeof S!=='undefined'&&S.priceBook&&Array.isArray(S.priceBook[trade]))?S.priceBook[trade]:[];
  const catalog=(typeof TRADE_JOBS!=='undefined'&&Array.isArray(TRADE_JOBS[trade]))?TRADE_JOBS[trade]:[];
  const p=timParse(el.value,{clients:(typeof clients!=='undefined'?clients:[]),book,catalog,
    photos:(typeof photos!=='undefined'?photos:[])});
  let line=timSay(p);
  // timParse knows doors, years and work. It knows nothing about the twelve
  // question families, so "What's going on Tim?" previewed as "Not sure what
  // that is yet" right up until you pressed send and got a full answer. A
  // preview that contradicts what is about to happen is worse than no preview:
  // it talks a man out of asking.
  // timAskKind and not timAsk: this runs on every keystroke, and the kind is
  // phrase matching while the answer walks every bid, payment and receipt.
  //
  // It mirrors _timGoRun's PRECEDENCE, it does not just fill a gap. "who owes
  // me money" is in the navigator's list too, so it previewed "Open Collect"
  // while send gave the figure, which is the same contradiction pointing the
  // other way. The order there is build, then ask, then read, then navigate:
  // so a build still wins here, and an ask beats a screen.
  if(typeof timAskKind==='function'&&!_timCrew()){
    const build=p&&(p.kind==='estimate'||p.kind==='newclient');
    if(!build&&(!line||(p&&p.kind==='nav'))&&timAskKind(el.value)){
      line='Answer that off your own books';
    }
  }
  out.textContent=line||(el.value.trim()?'Not sure what that is yet':'');
  out.style.color=line?'var(--text2)':'var(--text3)';
}

// THE LOG WRAPS THIS DOOR RATHER THAN SITTING INSIDE IT. _timGoRun has five
// ways out, and every one of them is something he said that somebody may need
// to read back later, the one that does nothing most of all. One wrapper means
// one record and no call site that can be forgotten when a sixth way out gets
// added, and the runner below keeps exactly the shape its tests assert on
// (js/tim-log.js).
function _timGo(){
  const el=document.getElementById('_tim-say');
  const said=el?el.value:'';
  const p=_timGoRun();
  try{
    if(String(said||'').trim()&&typeof timLogSay==='function'){
      // _timJob is whatever read was last shown, so it is this sentence's work
      // only when this sentence is the one that produced a read. Handing over a
      // stale one would credit Tim with placing words he never saw, which is
      // the one way a miss list can lie in the direction that hides a gap.
      timLogSay(said,{
        kind:(p&&p.kind)||'none',
        style:p&&p.style,
        read:(p&&p.kind==='read')?_timJob:null,
        // What he actually answered, and where he actually went. Without these
        // the thread can only say that something happened, which is what the
        // owner was already looking at when he said Tim did nothing.
        title:p&&p.title,
        name:p&&p.name,
        sub:p&&p.sub,
        goLabel:p&&p.goLabel,goFn:p&&p.goFn,
        rows:p&&p.rows,
      });
      // And the half that goes UP: the sentence with every client name
      // scrubbed out of it, whether he placed it, and which family did. Never
      // awaited and never able to throw into the send path (timLearnFrom has
      // its own try), because a man saying something to Tim must not be able
      // to be slowed down, let alone stopped, by a log about it.
      if(typeof timLearnFrom==='function')timLearnFrom(said,p||{});
    }
  }catch(_e){}
  // The thread is the receipt. Every sentence lands in it, INCLUDING the ones
  // he could not place: the old answer to those was a 2.6 second toast, which
  // on a job site is no answer at all, and three of them in a row look exactly
  // like an assistant that ignored you.
  _timThreadRefresh();
  return p;
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
  return(typeof tdReviewShots==='function')?tdReviewShots(g.photos.map(x=>x.id)):false;
}

// How long the three dots run before his reply appears. He is local: the reply
// exists before the dots are drawn, so this is a DISPLAY beat and nothing is
// being waited on. It is here because a reply that lands in the same frame as
// the question does not read as an answer, it reads as the box clearing, which
// is most of what "Tim did nothing" was. 420ms is under the ~500ms where a
// person starts to feel held up, and it costs the work nothing: the navigation
// or the answer sheet has already fired by the time the first dot is painted.
const _TIM_TYPING_MS=420;
let _timTypingT=null;

// Redraw the thread in place and clear the box, so the sheet behaves like the
// conversation it is. Does nothing when the thread is not on screen, which is
// the case for the answer sheet and the two build steps: those replace the
// sheet, and the exchange is already in the log waiting for the next open.
function _timThreadRefresh(opts){
  try{
    const box=document.getElementById('_tim-thread');
    if(!box||typeof _timThreadHtml!=='function')return;
    // He has said something, so the introduction is over. Removed rather than
    // hidden: 8.5 forbids the JS touching a style property, and a node that is
    // gone cannot be scrolled past by a screen reader either.
    document.getElementById('_tim-hello')?.remove();
    const el=document.getElementById('_tim-say');
    if(el)_timSetSaid(el,'');
    if(typeof _timPreview==='function')_timPreview();

    // Somebody who asked the OS to stop moving things gets the answer straight
    // away, not three still dots and a wait. Same rule as the dock's breathing.
    const still=(typeof matchMedia==='function')&&
      matchMedia('(prefers-reduced-motion: reduce)').matches;
    const beat=(opts&&opts.instant)||still?0:_TIM_TYPING_MS;
    // Smooth when the bubble is flying, instant when it is not: a smooth scroll
    // with no animation attached to it is just a slow jump.
    const bottom=(glide)=>{
      try{
        if(glide&&typeof box.scrollTo==='function')box.scrollTo({top:box.scrollHeight,behavior:'smooth'});
        else box.scrollTop=box.scrollHeight;
      }catch(_e){try{box.scrollTop=box.scrollHeight;}catch(_e2){}}
    };

    clearTimeout(_timTypingT);
    if(!beat){box.innerHTML=_timThreadHtml();bottom(false);return;}

    // The send. Your bubble comes up off the box, he starts typing, and the
    // phone taps your thumb: the native Taptic 'select', the same one a picker
    // uses, because sending a message is a small thing committing rather than
    // something big landing. It is decoration and never delays the send
    // (js/utils.js _tdHaptic never throws and never awaits).
    box.innerHTML=_timThreadHtml({pending:true,enter:'me'});
    bottom(true);
    try{if(typeof _tdHaptic==='function')_tdHaptic('tick');}catch(_e){}

    _timTypingT=setTimeout(()=>{
      // The sheet can be gone by now: he may have navigated, or closed it.
      const b=document.getElementById('_tim-thread');
      if(!b)return;
      b.innerHTML=_timThreadHtml({enter:'him'});
      try{
        if(typeof b.scrollTo==='function')b.scrollTo({top:b.scrollHeight,behavior:'smooth'});
        else b.scrollTop=b.scrollHeight;
      }catch(_e){}
    },beat);
  }catch(_e){}
}

function _timGoRun(){
  const el=document.getElementById('_tim-say');
  const said=el?el.value:'';
  if(!String(said||'').trim())return {text:'',kind:'none'};

  // ── "Build me a T and M for Dana" ─────────────────────────────────────────
  // A door and a customer is a proposal, and it outranks everything else,
  // including the estimate page he may already be standing on: a man who says
  // "build me a TrueBid for the Kellermans" while looking at Dana's T&M means
  // a new one, not a note on this one.
  const style=timStyle(said);
  const who=(typeof spkClient==='function')?spkClient(said,(typeof clients!=='undefined'?clients:[])):null;
  if(style&&who&&timWantsBuild(said)){
    _timStartBuild(style.id,who);
    return {text:said,kind:'build',style:style.id,clientId:who.id};
  }
  // A customer and a clear intent to build, but he never said which kind.
  if(who&&timWantsBuild(said)&&!style&&!/\b(hours?|hrs)\b/i.test(said)){
    _timAskStyle(who);
    return {text:said,kind:'build',style:null,clientId:who.id};
  }

  // ── A question about his own business ────────────────────────────────────
  // Ahead of the estimate read, and safely so: timAskKind only fires on an
  // explicit question phrase ("who owes me", "what did I charge"), and a man
  // describing work says none of them. Ahead of the navigator too, because
  // "who owes me money" deserves the figure, not the Collect screen with the
  // figure somewhere on it (js/tim-ask.js).
  if(typeof timAsk==='function'){
    const ans=timAsk(said);
    // The title rides along so the thread can show what he ACTUALLY said
    // ("$4,400"), not merely that he said something.
    // The answer lands IN THE THREAD, it does not replace it.
    //
    // It used to call _timShowAsk, which swaps the whole sheet for an answer
    // card with a headline, a CTA and NO input box. The owner asked what his
    // mileage was, got 32.5 mi and "Open mileage", and that was the end of the
    // conversation: no thread, nothing to type into, and the only way back was
    // to close and reopen him. Every answer was a dead end, which is a strange
    // thing for the one part of the app you are supposed to talk to.
    //
    // Everything needed to draw it as a bubble travels with the outcome. The
    // full card with its rows is still one tap away from that bubble, so the
    // detail is not lost, it just stopped being compulsory.
    if(ans){
      return {text:said,kind:'ask',ask:ans.id,title:ans.title,
        sub:ans.sub||'',
        goLabel:(ans.go&&ans.go.label)||'',goFn:(ans.go&&ans.go.fn)||'',
        rows:!!(ans.rows&&ans.rows.length)};
    }
  }

  // On an estimate he is describing work, not asking for a screen, so the read
  // back comes first and the navigator is the fallback.
  const onEstimate=_timOnEstimate();
  if(onEstimate){_timShowRead(said);return {text:said,kind:'read'};}
  // Close BEFORE the run, never after. timRun can OPEN an overlay of its own,
  // and the photo chooser reuses #_tim-ov, so closing afterwards tore down the
  // very thing the run had just built, in the same frame it appeared (the
  // chooser flashed and vanished, caught in a screenshot 2026-09-22).
  //
  // The rule this replaces is preserved exactly, it just asks first: timParse
  // is pure and is what timRun parses with, so peeking costs one parse and
  // yields the same kind. A sentence he cannot place still leaves the box, and
  // what was typed in it, alone.
  const _trade=(typeof getActiveTrade==='function'?getActiveTrade():'general')||'general';
  const _book=(typeof S!=='undefined'&&S.priceBook&&Array.isArray(S.priceBook[_trade]))?S.priceBook[_trade]:[];
  const _catalog=(typeof TRADE_JOBS!=='undefined'&&Array.isArray(TRADE_JOBS[_trade]))?TRADE_JOBS[_trade]:[];
  const peek=timParse(said,{clients:(typeof clients!=='undefined'?clients:[]),book:_book,catalog:_catalog,
    photos:(typeof photos!=='undefined'?photos:[])});
  if(!peek||peek.kind==='none'){
    if(typeof showToast==='function')showToast('Say a screen, a year, or what the work is','🔧',2600);
    return peek||{text:said,kind:'none'};
  }
  _timClose();
  return timRun(said);
}
