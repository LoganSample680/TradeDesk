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
// HE KNOWS THE TRADE NOW (owner 2026-09-25, reversing 2026-09-17): "Tim
// should know trade knowledge." Not in this file: js/trade-knowledge.js holds
// it as data, what each job includes and what gets left off, and Tim, the
// spoken estimate and the estimate builder all read that one table. Prices
// are still the contractor's; the price book wins over the library's
// starting numbers. js/estimate-speak.js is still where a spoken estimate is
// parsed, and Tim is its front door, not a replacement for it (7.3).
//
// This file is the screen. Everything above the dock section is pure; timRun,
// openTim and the dock are the parts that touch the app.

// Where he can take you. `say` is every way a contractor actually asks for the
// screen, longest phrase winning, so "time log" cannot be eaten by "log".
//
// A row may also name a TAB on its screen (`tab`, the same id the screen's own
// tab buttons pass to setTrTab, setFleetTab, setTaxTab, setMoneyFilter,
// setJobFilter, setLeadFilter) or a SETTINGS section (`set`, the key
// _openSetDetail already takes), and a control to point at (`point`). Owner
// 2026-10-03: "500 prompts a user could ask Tim about TradeDesk, he should
// know everything and take them to the source." The source of "my mileage
// log" is the Mileage tab, not the top of the Books, and the source of "change
// my logo" is the Branding section with the logo button lit, not the Settings
// index. tests/fixtures/tim-500.json is that list, and it is the test.
const TIM_PLACES=[
  {pg:'pg-dash',        name:'Home',        say:['home','dashboard','home screen','the dash','main screen','main page','front page','start screen','home page']},
  {pg:'pg-leads',       name:'Leads',       say:['leads','lead','my leads','lead list','new leads','inquiries','web leads','web requests','incoming leads','prospects','people who called in','who called in']},
  {pg:'pg-leads',       name:'Follow-ups',  tab:'follow_up', say:['follow up','follow ups','followups','need to follow up','follow up with']},
  {pg:'pg-clients',     name:'Customers',   say:['clients','customers','customer list','client list','contacts','my contacts','address book',
                                                 'find a customer','look up a customer','find a client','look up a client','search customers','all my customers']},
  {pg:'pg-jobs',        name:'Jobs',        say:['jobs','job list','my jobs','work orders','projects','my projects','job board']},
  {pg:'pg-jobs',        name:'Active jobs', tab:'active', say:['active jobs','jobs in progress','current jobs','open jobs','running jobs','jobs going on','what am i working on']},
  {pg:'pg-jobs',        name:'Scheduled jobs', tab:'scheduled', say:['scheduled jobs','upcoming jobs','next job','my next job','jobs coming up','future jobs','booked jobs']},
  {pg:'pg-jobs',        name:'Completed jobs', tab:'completed', say:['completed jobs','finished jobs','done jobs','past jobs','closed jobs','old jobs']},
  {pg:'pg-schedule',    name:'Schedule',    say:['schedule','my schedule','availability','my availability','open dates','open days','when am i free',
                                                 'next available','next opening','next open day','fit someone in','fit somebody in','booking','am i booked']},
  {pg:'pg-cal',         name:'Calendar',    say:['calendar','the week','weather','forecast','rain','my week','week look like','week view','month view','the month','going to rain','snow']},
  // The Photos page (main, #91). Named by the page, never a bare "photos":
  // that word alone is the photo lookup below, which is what "photos at 412
  // Oak" needs it to stay.
  {pg:'pg-photos',      name:'Photos',      say:['photos page','photo page','the photos page','all photos','all my photos','photo library']},
  {pg:'pg-proposals',   name:'Proposals',   say:['proposals','my proposals','bids','my bids','quotes','my quotes','sent estimates','estimates','my estimates',
                                                 'pending proposals','signed proposals','proposal list','bid list','quote list','who viewed','proposal status','who signed']},
  // The recurring service list (#94, widened 2026-09-27 past water heaters).
  // "Service due" is its on-screen name; the old words still land there.
  {pg:'pg-wh-list',     name:'Service due', say:['service due','recurring service','annual service','water heater list','water heaters','flush list','water heater flushes','water filters','gutter cleaning','condenser cleanings','coil cleanings','ac tune ups','ac tune-ups','backflow tests','generator services',
                                                 'due for service','due for maintenance','maintenance list','service list','flushes']},
  {pg:'pg-money',       name:'Collect',     say:['collect','invoices','payments','get paid','whats owed','who owes me','unpaid invoices','my invoices','open invoices','sent invoices','invoice list',
                                                 'accounts receivable','receivables','balances','outstanding invoices','payment status','collections','unpaid']},
  {pg:'pg-money',       name:'Not sent',    tab:'unpaid',  say:['not sent','unsent invoices','invoices i havent sent','havent sent','haven t sent','didnt send']},
  {pg:'pg-money',       name:'Overdue',     tab:'overdue', say:['overdue','overdue invoices','late payments','late invoices','late payers','paying late']},
  {pg:'pg-money',       name:'Paid',        tab:'paid',    say:['paid invoices','who paid','paid up','already paid']},
  {pg:'pg-money',       name:'Part paid',   tab:'partial', say:['partial payments','partially paid','part paid','partly paid']},
  {pg:'pg-tracker',     name:'Books',       say:['books','bookkeeping','the numbers','profit','my money','ledger','financials','finances','accounting','cash flow','reports','my books']},
  {pg:'pg-tracker',     name:'Income',      tab:'income',   say:['income','sales','money in','money coming in','payments received']},
  {pg:'pg-tracker',     name:'Expenses',    tab:'expenses', say:['expenses','expense','spending','costs','receipts','purchases','money out','my receipts']},
  {pg:'pg-tracker',     name:'Mileage',     tab:'mileage',  say:['mileage','mileage log','miles log','trip log','trips','my trips','drives','my drives','drive log']},
  {pg:'pg-tracker',     name:'Places',      tab:'places',   say:['places','my places','saved places','supply houses','suppliers']},
  {pg:'pg-tracker',     name:'Job history', tab:'jobs',     say:['job history','job costing','profit by job','job profit','job profitability','money per job','profit per job']},
  {pg:'pg-tracker',     name:'Summary',     tab:'summary',  say:['summary','p and l','profit and loss','monthly p and l','year summary','totals','year end','year at a glance']},
  {pg:'pg-tracker',     name:'Hiring',      tab:'hiring',   say:['hiring calculator','hiring calc','hire calculator','afford to hire','afford another guy','afford a helper','afford a guy']},
  {pg:'pg-tracker',     name:'Map',         tab:'map',      say:['map','the map','map view','where i drove','gps map','drive map','breadcrumbs','where i went']},
  {pg:'pg-taxes',       name:'Taxes',       say:['taxes','tax','write offs','writeoffs','deductions','1099s','1099','quarterly taxes','quarterlies','estimated taxes','estimated tax',
                                                 'tax estimate','irs','schedule c','tax bill','owe the irs','set aside for taxes','deduct','owe in taxes']},
  {pg:'pg-taxes',       name:'Payroll',     tab:'payroll', say:['payroll','payroll taxes','w2','w 2','w2s','941']},
  {pg:'pg-team',        name:'Fleet & Team',say:['fleet and team']},
  {pg:'pg-team',        name:'Team',        tab:'team',  say:['team','crew','my crew','employees','my employees','my guys','workers','techs','technicians','helpers',
                                                 'subs','subcontractors','my team','whos on my team','the guys','staff','my subs']},
  {pg:'pg-team',        name:'Fleet',       tab:'fleet', say:['fleet','trucks','vehicles','my trucks','vans','my vans','my vehicles','truck maintenance','oil change','registration','my fleet']},
  {pg:'pg-timelog',     name:'Timesheet',   say:['timesheet','time sheet','time log','timelog','hours','my hours','the clock','time cards','timecards','time card','punch card','punches',
                                                 'crew time','time entries','clock history','who clocked in','clocked in','hours log']},
  {pg:'pg-dispatch',    name:'Dispatch',    say:['dispatch','the board','dispatch board','who goes where','whos going where','assign','assignments','crew assignments',
                                                 'assign a job','assign jobs','send the crew','routing','route the crew']},
  {pg:'pg-licensing',   name:'Licensing',   say:['licensing','my license','licenses','permits','license','licence','permit','certifications','certification','insurance',
                                                 'ce hours','continuing education','license expire','expiring','renewal','renew my license']},
  {pg:'pg-contracts',   name:'Contracts',   say:['contracts','agreements','contract','service agreements','maintenance agreements','memberships','service plans','maintenance plans','my agreements']},
  {pg:'pg-client-hub',  name:'Client hub',  say:['client hub','the hub','customer portal','client portal','portal','what customers see','what my customers see','what do my customers see','what do customers see','customer hub']},
  {pg:'pg-tracker',     name:'Books',       say:['receipts']},
  {pg:'pg-qr-leads',    name:'QR leads',    say:['qr','qr code','qr leads','my sign','yard sign','yard signs','qr sign','qr codes']},
  // The id says checklist and the screen says Top Clients: it was renamed and
  // the id never was. Tim goes by what is ON the screen, because that is the
  // only name the owner has ever seen. No 'best clients' here on purpose, or it
  // would steal "who is my best customer" off the answer that reads his books.
  {pg:'pg-checklist',   name:'Top clients', say:['top clients','heavy hitters','my top clients',
                                                 'client rankings','who are my top','customer rankings','client ranking']},
  {pg:'pg-settings',    name:'Settings',    say:['settings','preferences','my account','options','app settings','account settings','my profile','profile']},
  // Settings, by the section that holds the thing, so he lands on the field.
  {pg:'pg-settings',    name:'Business info', set:'biz', say:['business info','business information','company info','company information','business name','company name',
                                                 'business address','company address','business phone','business email','company phone','company email','license number',
                                                 'contractor license','review link','google review','google reviews','sales tax','sales tax rate','business hours',
                                                 'working hours','work hours','owner pay','labor burden','in business since']},
  {pg:'pg-settings',    name:'Branding',    set:'branding', point:'#set-logo-btn-brand', say:['branding','brand','logo','my logo','brand color','brand colors','colors','color',
                                                 'app color','subdomain','custom domain','website','powered by']},
  {pg:'pg-settings',    name:'Rates',       set:'rates', say:['rates','my rates','pricing','markup','margin','profit margin','deposit','deposit percent','deposit percentage','goals','overhead','rate settings']},
  {pg:'pg-settings',    name:'Price book',  set:'pricebook', say:['price book','pricebook','my prices','price list','prices','saved prices','service catalog','services list','my services','line item library']},
  {pg:'pg-settings',    name:'Legal',       set:'legal', say:['legal','terms','terms and conditions','fine print','warranty','warranty language','change order clause','contract language','disclaimer']},
  {pg:'pg-settings',    name:'Trades',      set:'trades', say:['trades','my trade','my trades','trade','business type','change trades','another trade','add a trade']},
  {pg:'pg-settings',    name:'Code editions', set:'codes', say:['code edition','code editions','code book','codes','nec','ipc','upc','building code','plumbing code','electrical code']},
  {pg:'pg-settings',    name:'Integrations', set:'integrations', say:['integrations','stripe','credit cards','credit card','card payments','accept cards','take cards',
                                                 'online payments','payment setup','payments setup','apple pay','ach']},
  {pg:'pg-settings',    name:'Tax setup',   set:'taxes', say:['tax setup','tax settings','filing status','mileage rate','irs mileage rate','tax brackets','state tax','federal tax','tax rate']},
  {pg:'pg-settings',    name:'Location and sync', set:'cloud', point:'#location-settings-btn', say:['location','location access','location permission','location permissions',
                                                 'location services','gps','location tracking','cloud','sync','cloud sync','backup','back up','restore']},
  {pg:'pg-settings',    name:'Notifications', set:'notifications', say:['notifications','notification','alerts','push notifications','text templates','sms templates',
                                                 'message templates','email templates','follow up message','follow up texts','reminder texts','templates']},
  {pg:'pg-settings',    name:'TrueMeasure rates', set:'truerates', say:['truemeasure rates','true measure rates','truescan rates','scan rates','measure rates','rate library']},
  {pg:'pg-settings',    name:'Your data',   set:'data', say:['export data','export my data','download my data','download everything','reset','factory reset',
                                                 'delete my account','delete everything','delete all my data','wipe']},
  {pg:'pg-settings',    name:'About',       set:'about', say:['about the app','about tradedesk','version','app version','what version','privacy','privacy policy','terms of service']},
];

function _timNorm(t){
  return ' '+String(t||'').toLowerCase()
    .replace(/&/g,' and ')
    .replace(/[^a-z0-9\s]/g,' ')
    .replace(/\s+/g,' ').trim()+' ';
}
// The same, with apostrophes closed up first, so "what's owed" reads "whats
// owed" and "who's on my team" reads "whos on my team", the way the phrase
// tables are written. Kept apart from _timNorm on purpose: the photo lookup
// relies on "pepe's" arriving as "pepe s" so the s can be dropped as filler.
function _timNormA(t){return _timNorm(String(t||'').replace(/['’]/g,''));}

// Which screen he means. Scored on how much of the phrase he actually said, so
// a two-word name beats a one-word name that happens to sit inside it.
function _timWhereHit(text){
  const t=_timNormA(text);
  if(t.trim()==='')return null;
  let best=null,bestLen=0,bestAt=-1,sec=null,secLen=0,secAt=-1;
  TIM_PLACES.forEach(p=>{
    p.say.forEach(phrase=>{
      const i=t.indexOf(' '+phrase+' ');
      if(i<0)return;
      if(phrase.length>bestLen){bestLen=phrase.length;best=p;bestAt=i;}
      if(p.set&&phrase.length>secLen){secLen=phrase.length;sec=p;secAt=i;}
    });
  });
  // A Settings section names the field; "settings", "proposals" and
  // "invoices" around it only say where the field shows up. So "pricing
  // settings" is Rates and "put my logo on proposals" is Branding, not the
  // Settings index or the list of proposals.
  if(sec&&best!==sec&&(best.pg==='pg-settings'||best.pg==='pg-proposals'||best.pg==='pg-money'))
    return {place:sec,len:secLen,at:secAt};
  return best?{place:best,len:bestLen,at:bestAt}:null;
}
function timWhere(text){
  const h=_timWhereHit(text);
  if(!h)return null;
  const b=h.place,out={pg:b.pg,name:b.name};
  if(b.tab)out.tab=b.tab;
  if(b.set)out.set=b.set;
  if(b.point)out.point=b.point;
  return out;
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
const _TIM_SAY_HINT='Quote Dana by the hour';
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
// The words a man actually says around the question. "where are my photos
// for pepe" left "where are pepe" as the search term and found nothing, which
// is the exact sentence the owner tried (2026-09-22). Question words, the
// auxiliaries that carry them, and the bare s left behind by an apostrophe
// (_timNorm strips punctuation, so "pepe's" arrives as "pepe s").
const _TIM_PHOTO_FILLER=['show','me','my','the','a','of','for','at','from','on','open','find','get','pull','up','all','job','jobs','site','house','place',
  'where','wheres','are','is','was','were','do','did','does','i','we','have','has','had','any','some','got','there','see','look','looking','need','want','to','s','take','took','taken','can','could','please',
  've','ive','ones','that','these','those','just','hey','hi','ok','okay','tim','yo'];
// ── His rate, asked for out loud (Jack 2026-09-29: "I need to change my
// hourly rate", then "What are you charged") ─────────────────────────────
// A simple ask and a simple answer: Tim asks what he wants it to be, he says
// 125, and it is saved everywhere a rate lives for the owner: the business
// rate anyone without their own bills at (S.laborRate) and what he bills
// himself (S.ownerBillRate), through the one settings save. "Change my rate
// to 125" skips the question.
const _TIM_RATE_SAID=[
  / (change|set|update|raise|lower|bump|adjust|edit|fix) (up )?(my |the |our )?(hourly |labor |bill |billing |shop )?(rate|hourly) /,
  / (what s|whats|what is|what are) (my|our) (hourly |labor |bill |billing )?(rate|rates) /,
  // "what do I charge for X" is the price book's question (tim-ask.js), not this.
  / what (am|are) (i|you|we) (charg|bill)\w* /,
];
function timRateAsk(text){
  const t=_timNorm(text);
  if(!_TIM_RATE_SAID.some(re=>re.test(t)))return null;
  // A rate on one job belongs to that job's estimate, not his standing rate.
  if(/ (job|proposal|estimate|invoice|bid) /.test(t))return null;
  const m=t.match(/ (?:to|at|is|be) (\d{2,4}(?: \d{2})?) /)||t.match(/ (\d{2,4}) (?:an|a|per) (?:hour|hr) /);
  const to=m?parseFloat(m[1].replace(' ','.')):null;
  return {to:(to>0&&to<10000)?to:null};
}
function _timRateNow(){
  const own=Number(S&&S.ownerBillRate),biz=Number(S&&S.laborRate);
  return own>0?own:(biz>0?biz:0);
}
function _timSetRate(r){
  r=Math.round(Number(r)*100)/100;
  if(!(r>0))return false;
  S.laborRate=r;S.ownerBillRate=r;
  if(typeof _settingsChanged==='function')_settingsChanged();
  if(typeof showToast==='function')showToast('Your rate is $'+r.toLocaleString('en-US')+' an hour. Saved everywhere.','✓',3200);
  return true;
}
function _timAskRate(){
  const now=_timRateNow();
  zPrompt(now>0?'Right now it is $'+now.toLocaleString('en-US')+' an hour.':'You have no rate set yet.',v=>{
    const r=parseFloat(String(v||'').replace(/[^0-9.]/g,''));
    if(!(r>0)){if(typeof showToast==='function')showToast('Nothing changed','ℹ️',2200);return;}
    _timSetRate(r);
  },{title:'What would you like to change it to?',placeholder:'125',num:'rate'});
  const inp=document.getElementById('zprompt-inp');
  if(inp)inp.setAttribute('aria-label','Hourly rate');
}

// Where the photos live, walked the way he would: open More, tap Photos. He
// sees where it is so next time he goes himself (owner 2026-09-30: "Tim
// clicks More, Tim clicks Photos, there they are"). On a wide screen Photos
// sits in the sidebar, so it just opens.
function _timWalkTo(pg,mmiId){
  const pop=document.getElementById('mtb-more-popup');
  const row=document.getElementById(mmiId);
  const bar=document.getElementById('mobile-tabbar');
  const phone=!!(pop&&row&&bar&&getComputedStyle(bar).display!=='none');
  if(!phone||typeof openMobileMore!=='function'){if(typeof goPg==='function')goPg(pg);return 'direct';}
  openMobileMore();
  row.classList.add('tim-point');
  setTimeout(()=>{row.classList.remove('tim-point');if(typeof mobileNavTo==='function')mobileNavTo(pg);else goPg(pg);},650);
  return 'walk';
}

function timPhotoQuery(text){
  const t=_timNorm(text);
  if(!TIM_PHOTO_WORDS.some(w=>t.includes(' '+w+' ')))return null;
  const rest=t.trim().split(' ')
    .filter(w=>w&&!TIM_PHOTO_WORDS.includes(w)&&!_TIM_PHOTO_FILLER.includes(w))
    .join(' ').trim();
  return{q:rest};
}

// ── Time off, said out loud (owner 2026-09-24: "we're focused on Tim") ─────
// "Tim, I'm on vacation through Sunday." The same block the Schedule screen's
// Time off button writes (addTimeOff, js/settings.js), so the calendar stops
// booking those days and the deriver holds that day's automatic time and
// mileage (rule 25, js/geo-derive.js). Dates are the ways they get said: today,
// tomorrow, a weekday, "the 27th", "Sept 27", 9/27, "for 3 days", "next week".
// Nothing cleverer: a sentence Tim cannot pin to a day is not a day off.
const _TIM_OFF_SAID=/ (vacation|vacay|time off|day off|days off|off work|pto|holiday|out of town|not working|(i m|im|i am|we re|were|taking|take|be) off|(today|tomorrow|(sun|mon|tues|wednes|thurs|fri|satur)days?) off) /;
const _TIM_DOW=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
const _TIM_MON=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const _TIM_NUM={a:1,an:1,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,fourteen:14};
function _timYmd(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function _timPlus(d,n){const x=new Date(d.getFullYear(),d.getMonth(),d.getDate());x.setDate(x.getDate()+n);return x;}
// The first day named in `s`, on or after `from`. Earliest in the sentence
// wins, so "friday through monday" reads friday first.
function _timFirstDay(s,from){const h=_timFirstHit(s,from);return h?h.d:null;}
function _timFirstHit(s,from){
  const hits=[];
  const at=(re,fn)=>{const m=re.exec(s);if(m){const d=fn(m);if(d)hits.push({i:m.index,d});}};
  at(/ today /,()=>from);
  at(/ tomorrow /,()=>_timPlus(from,1));
  _TIM_DOW.forEach((w,i)=>at(new RegExp(' '+w+'s? '),()=>_timPlus(from,(i-from.getDay()+7)%7)));
  at(/ (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* (\d{1,2})(st|nd|rd|th)? /,m=>{
    const mo=_TIM_MON.indexOf(m[1]),dd=+m[2];
    let d=new Date(from.getFullYear(),mo,dd);
    if(d.getMonth()!==mo)return null;
    if(d<from)d=new Date(from.getFullYear()+1,mo,dd);
    return d;
  });
  at(/ (\d{1,2})\/(\d{1,2}) /,m=>{
    const mo=+m[1]-1,dd=+m[2];
    if(mo<0||mo>11)return null;
    let d=new Date(from.getFullYear(),mo,dd);
    if(d.getMonth()!==mo)return null;
    if(d<from)d=new Date(from.getFullYear()+1,mo,dd);
    return d;
  });
  at(/ (?:the )?(\d{1,2})(st|nd|rd|th) /,m=>{
    const dd=+m[1];
    let d=new Date(from.getFullYear(),from.getMonth(),dd);
    if(d.getDate()!==dd)return null;
    if(d<from){d=new Date(from.getFullYear(),from.getMonth()+1,dd);if(d.getDate()!==dd)return null;}
    return d;
  });
  if(!hits.length)return null;
  hits.sort((a,b)=>a.i-b.i);
  return hits[0];
}
function timTimeOff(text,now){
  const t=' '+String(text||'').toLowerCase().replace(/[^a-z0-9\/\s]/g,' ').replace(/\s+/g,' ').trim()+' ';
  if(!_TIM_OFF_SAID.test(t))return null;
  // "I'm off the clock" is the end of a shift, not a day off (js/tim.js
  // TIM_DOES clock-out). Without this it booked today as time off.
  if(/ off (the |my )?clock /.test(t))return null;
  // "My location is not working" is a broken thing, not a man off work.
  if(/ (is|isnt|s|are|arent|was|keeps) not working /.test(t)&&!/ (vacation|vacay|time off|day off|days off|pto|holiday) /.test(t))return null;
  const n=(now instanceof Date&&!isNaN(now))?now:new Date();
  const today=new Date(n.getFullYear(),n.getMonth(),n.getDate());
  const label=/ (vacation|vacay) /.test(t)?'Vacation':/ holiday /.test(t)?'Holiday':'Time off';
  let start=null,end=null;
  if(/ next week /.test(t)){
    start=_timPlus(today,((1-today.getDay()+7)%7)||7);
    end=_timPlus(start,6);
  }else{
    // Split at the word that starts the end date, when what follows it is a
    // day. "to" only counts that way, since "going to be off" is not a range.
    const cut=/ (through|thru|till|til|until|to|ending) /g;
    let m,head=t,tail='';
    while((m=cut.exec(t))){
      const rest=' '+t.slice(m.index+m[0].length);
      const h=_timFirstHit(rest,today);
      // "to" must be followed straight away by the day ("friday to sunday");
      // anywhere later it is the "to" in "going to be off tomorrow".
      if(h&&(m[1]!=='to'||h.i===0)){head=t.slice(0,m.index)+' ';tail=rest;break;}
      cut.lastIndex=m.index+1;
    }
    start=_timFirstDay(head,today)||today;
    if(tail)end=_timFirstDay(tail,start);
    const f=/ for (\d{1,2}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|fourteen) (day|days|week|weeks) /.exec(t);
    if(!end&&f){
      const k=/^\d+$/.test(f[1])?+f[1]:_TIM_NUM[f[1]];
      const days=/week/.test(f[2])?k*7:k;
      if(days>0)end=_timPlus(start,days-1);
    }
    if(!end){
      // Nothing that names a day at all: he is asking about the list, not
      // adding to it ("show my time off", "cancel my vacation").
      if(!_timFirstDay(t,today)&&/ (show|open|see|list|edit|remove|delete|cancel|change|check) /.test(t))return {open:true};
      end=start;
    }
  }
  if(end<start)return null;
  if((end-start)/86400000>62)return null;
  return {start:_timYmd(start),end:_timYmd(end),label};
}
function _timDayWord(ymd){
  const d=new Date(ymd+'T12:00:00');
  return isNaN(d)?ymd:d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
}

// ── A lead in one breath (owner 2026-09-25: "go on autopilot and navigate
// pages correctly for entering leads") ──────────────────────────────────────
// "New lead Mike Jones, 412 Oak St, Topeka, 316-555-1234, water heater's
// leaking, found us on Google." Tim pulls the name, address, phone, email and
// where they came from out of the sentence, saves the customer, and if the
// sentence names a job he knows, opens the proposal with that job already on
// it (js/trade-knowledge.js decides which job; the price book decides the
// price). Pure: text in, fields out. timRun does the saving.
const _TIM_LEAD_SAID=/\b(?:new|another|add(?: a)?|create(?: a)?|got a|enter(?: a)?|put in(?: a)?)\s+(?:lead|customer|client)\b/i;
const _TIM_STREET=/\b\d{1,6}\s+(?:[a-z0-9.']+\s+){0,4}?(?:st|street|ave|avenue|rd|road|dr|drive|ln|lane|ct|court|blvd|boulevard|way|pl|place|cir|circle|ter|terrace|pkwy|parkway|hwy|highway|trl|trail|loop)\b\.?/i;
const _TIM_SOURCES=[
  [/referred by|referral|sent (?:him|her|them) (?:over|to us)|word of mouth/i,'Referral'],
  [/google|searched online|found us online/i,'Google / online'],
  [/facebook/i,'Facebook'],[/nextdoor/i,'Nextdoor'],[/instagram/i,'Instagram'],[/craigslist/i,'Craigslist'],
  [/yard sign/i,'Yard sign'],[/door hanger/i,'Door hanger'],[/truck|van wrap/i,'Vehicle / truck wrap'],
  [/realtor|real estate/i,'Real estate agent'],[/property manager|landlord/i,'Property manager'],
  [/repeat customer|used us before|past customer/i,'Repeat customer'],
];
// Words that end a name: the next clause has started.
const _TIM_NAME_STOP=/^(?:at|on|in|with|who|wants|needs|need|want|phone|cell|number|email|lives|address|from|off|by|has|his|her|their|is|says|called|calling|for|about|the|a|an|and)$/i;
function timLead(text){
  const raw=String(text||'');
  const m=_TIM_LEAD_SAID.exec(raw);
  if(!m)return null;
  let rest=' '+raw.slice(m.index+m[0].length)+' ';
  const cut=(s)=>{rest=rest.replace(s,' , ');};
  let phone='';
  const pm=rest.match(/(?:\+?1[\s.-]?)?\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})\b/);
  if(pm){phone=pm[1]+pm[2]+pm[3];cut(pm[0]);}
  let email='';
  const em=rest.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  if(em){email=em[0].toLowerCase();cut(em[0]);}
  let ref='';
  const rm=rest.match(/referred by\s+([a-z][a-z'.-]*(?:\s+[a-z][a-z'.-]*)?)/i);
  if(rm)ref=rm[1].trim();
  let source='';
  for(const [re,label] of _TIM_SOURCES){if(re.test(raw)){source=label;break;}}
  // The address: a house number, a few words, a street word. The city, state
  // and zip ride along only when they are the next short pieces.
  let addr='';
  const am=_TIM_STREET.exec(rest);
  if(am){
    let tail=rest.slice(am.index+am[0].length);
    let full=am[0].trim().replace(/\.$/,'');
    const city=/^\s*,?\s*([a-z][a-z .']{1,24}?)\s*(?=,|$)/i.exec(tail);
    if(city&&city[1].trim().split(/\s+/).length<=3&&!/\d/.test(city[1])&&
       !(typeof tkJobFor==='function'&&tkJobFor(city[1]))&&!/\b(wants|needs|leak|broke|replace|install|repair|found|referred)\b/i.test(city[1])){
      full+=', '+city[1].trim();tail=tail.slice(city[0].length);
      const st=/^\s*,?\s*([a-z]{2})(?:\s+(\d{5}))?\s*(?=,|$)/i.exec(tail);
      if(st){full+=', '+st[1].toUpperCase()+(st[2]?' '+st[2]:'');tail=tail.slice(st[0].length);}
    }
    const zip=/^\s*,?\s*(\d{5})\b/.exec(tail);
    if(zip){full+=' '+zip[1];tail=tail.slice(zip[0].length);}
    addr=full;
    rest=rest.slice(0,am.index)+' , '+tail;
  }
  // The name: the first words, stopped by a comma, a digit, or a word that
  // starts the next clause. Lead-ins ("named", "called", "is") are dropped.
  const head=rest.replace(/^[\s,:;-]*(?:(?:named|called|name is|name's|is|for)\s+)?/i,'');
  const words=[];
  for(const w of head.split(/\s+/)){
    if(!w)continue;
    if(/[,;.]/.test(w)){const c=w.replace(/[,;.].*$/,'');if(c&&!_TIM_NAME_STOP.test(c)&&/^[a-z][a-z'-]*$/i.test(c))words.push(c);break;}
    if(/\d/.test(w)||_TIM_NAME_STOP.test(w)||!/^[a-z][a-z'-]*$/i.test(w))break;
    words.push(w);
    if(words.length>=4)break;
  }
  const name=words.map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(' ');
  let job=head.slice(head.indexOf(words.join(' '))+words.join(' ').length);
  job=job.replace(/referred by\s+[a-z][a-z'.-]*(?:\s+[a-z][a-z'.-]*)?/i,' ')
    .replace(/\b(?:found|heard about|saw) us (?:on|from|through)\s+[a-z]+/i,' ')
    .replace(/\b(?:from|on|via|through)\s+(?:google|facebook|nextdoor|instagram|craigslist|a yard sign|a door hanger|our truck)\b/i,' ')
    .replace(/[\s,;:-]+/g,' ').replace(/^\s*(?:(?:at|and|who|he|she|they|wants|want|needs|need|with|to|has|is)\s+)+/i,'').trim();
  return {name,phone,email,addr,source,ref,job};
}
// Which job the lead's words name, as one line: his price book first, then the
// catalog, with the trade library deciding between look-alikes ("water heater"
// is the 40 gallon gas unless he says 50 or electric).
function timLeadJob(job,trade,book,catalog){
  const said=String(job||'').toLowerCase();
  if(!said.trim())return null;
  const fromBook=(typeof spkServices==='function')?spkServices(said,book,[]):[];
  if(fromBook.length){const b=fromBook[0];return {desc:b.desc,rate:b.rate,notes:b.notes||''};}
  const tk=(typeof tkJobFor==='function')?tkJobFor(said,trade):null;
  const cat=Array.isArray(catalog)?catalog:[];
  let pick=null;
  if(tk){
    let best=-1;
    cat.forEach(j=>{
      if(!j||tkJobFor(j.name,trade)!==tk)return;
      const extra=String(j.name).toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/(\d)([a-z])/g,'$1 $2').split(/\s+/).filter(w=>w.length>1&&said.indexOf(w)>=0).length;
      if(extra>best){best=extra;pick=j;}
    });
  }
  if(!pick){
    const s=(typeof spkServices==='function')?spkServices(said,[],cat):[];
    if(s.length)pick=cat.find(j=>j.name===s[0].desc)||null;
  }
  if(!pick)return null;
  return {desc:pick.name,rate:Math.round((pick.labor||0)+(pick.mat||0)),notes:''};
}
function _timPhoneWord(d){return d&&d.length===10?'('+d.slice(0,3)+') '+d.slice(3,6)+'-'+d.slice(6):d;}

// ── Things he can DO, not just places he can go (owner 2026-10-03) ─────────
//
// "New estimate", "clock me in", "log a trip", "add a truck", "call Rick".
// Every one of these already has a button somewhere in the app, and every row
// below calls the function that button calls (7.3): quickAction for the
// dashboard's quick tiles, openNewClient for New lead, openAddVehicleModal for
// Add vehicle, and so on. Tim adds no second way to do any of it; he only
// knows which button a sentence means.
//
// How a sentence matches, the same for every row so nobody has to remember
// a special case:
//   - `verbs` + `objs`: the sentence STARTS with one of the verbs (after the
//     lead-in a man says out loud, "hey tim can you", "how do I", "I need to")
//     and names one of the objects after it. "add an expense", "how do I add
//     a truck", "I need to write up an estimate".
//   - `lead`: the verb IS the object, "invoice Sandra", "quote the Delaneys".
//   - `also`: a phrase that means this one thing wherever it sits, "clock me
//     in", "scan a receipt", "call it a day".
//   - `re`: the contact rows, where a customer has to be named ("call Rick",
//     "give Rick a call", "directions to the Delaneys").
// A QUESTION never matches ("how many miles did I log", "what did I spend
// on gas"): those are tim-ask.js's, answered off the books.
// `who` rows take the customer the sentence names; `need` rows mean nothing
// without one. `build` marks the proposal row, which yields to the build flow
// and to the new-customer box when a name comes with it.
const _TIM_MAKE=['new','add','create','make','start','write','write up','enter','put in','set up','setup','build','draw up','put together',
  'generate','prepare','type up','fill out','input','another','do a','do an','open a new','get a new','add a new','start a new',
  'got a','got a new','got another'];
const _TIM_LOG=['log','record','track','enter','add','put in','input','save','write down','keep track of','new','add a new'];
const TIM_DOES=[
  {id:'new-client', name:'New customer', pg:'pg-clients', verbs:_TIM_MAKE, objs:['customer','client','lead','contact','homeowner','prospect']},
  {id:'estimate', build:true, who:true, name:'New proposal', pg:'pg-proposals', verbs:_TIM_MAKE.concat(['send','price out','work up','give']),
    objs:['estimate','proposal','bid','quote'], lead:['quote','bid','estimate','price out']},
  {id:'invoice', who:true, name:'New invoice', pg:'pg-qi', verbs:_TIM_MAKE.concat(['send','get out','shoot']),
    objs:['invoice','bill','quick invoice','final bill','final invoice'], lead:['invoice','bill'],
    also:['invoice someone','bill someone','bill a customer','invoice a customer','bill a client','invoice a client','bill the customer','invoice the customer']},
  {id:'collect', who:true, name:'Take a payment', pg:'pg-money', verbs:['take','collect','record','log','enter','add','receive','accept','got','mark','put in','run'],
    objs:['payment','payments','deposit','check','cash payment','card payment','credit card payment','money'],
    also:['run a card','charge a card','swipe a card','charge their card','charge his card','charge her card','tap to pay','paid me','paid cash',
      'paid by check','paid in cash','got paid','customer paid','client paid','just paid','mark paid','mark as paid','mark it paid']},
  {id:'change-order', who:true, name:'Change order', pg:'pg-jobs', verbs:_TIM_MAKE.concat(['send','do']), objs:['change order','change orders'],
    also:['change order','change orders','extra work','add on work','add to the job','add to the contract','additional work','scope change']},
  {id:'clock-in', name:'Clock in', pg:'pg-dash', also:['clock in','clock me in','clocking in','punch in','punch me in','clock on','start my day','start the clock',
    'start my clock','start my time','start the timer','start my timer','get on the clock','start work','start working']},
  {id:'clock-out', name:'Clock out', pg:'pg-dash', also:['clock out','clock me out','clocking out','punch out','punch me out','clock off','stop the clock','stop my clock',
    'stop my time','stop the timer','stop my timer','done for the day','end my day','end the day','call it a day','knock off','quitting time',
    'im out for the day','heading home for the day','wrap up the day','wrap up for the day','done for today','off the clock']},
  {id:'expense', name:'Log an expense', pg:'pg-tracker', verbs:_TIM_LOG.concat(['make','create']),
    objs:['expense','expenses','purchase','cost','gas','fuel','materials','supplies','lumber','fill up','gas receipt'],
    also:['i bought','just bought','we bought','i spent','just spent','picked up materials','picked up supplies','picked up parts']},
  {id:'receipt', name:'Scan a receipt', pg:'pg-tracker', verbs:['scan','snap','photo','photograph','upload','add','log','enter','save','put','attach','keep',
    'take a picture of','take a pic of','take a photo of','file','track'], objs:['receipt','receipts'],
    also:['scan a receipt','receipt scan','scan receipt','scan my receipt','scan receipts','scan this receipt']},
  {id:'trip', name:'Log a trip', pg:'pg-tracker', verbs:_TIM_LOG, objs:['trip','trips','miles','mileage','drive','drives','mileage entry'],
    also:['log miles','log my miles','log mileage','add miles','forgot to log a drive','forgot to log my miles','forgot to log a trip']},
  {id:'drive', name:'Start a drive', pg:'pg-tracker', also:['start a drive','start driving','start my drive','start the drive','track this drive','track my drive now',
    'start a trip','begin a drive','start tracking miles','start tracking my miles','start tracking mileage','start mileage','start the mileage','driving to a job',
    'leaving for a job','heading to a job']},
  {id:'vehicle', name:'Add a vehicle', pg:'pg-team', verbs:_TIM_MAKE.concat(['register']), objs:['vehicle','truck','van','car','trailer','work truck','box truck']},
  {id:'employee', name:'Add a crew member', pg:'pg-team', verbs:_TIM_MAKE.concat(['hire','invite','onboard','bring on']),
    objs:['employee','employees','worker','helper','crew member','tech','technician','apprentice','team member','laborer','journeyman','guy'],
    also:['hire someone','hire a guy','add to my crew','add to the crew','invite my crew','invite the crew','invite my guys','invite my team',
      'add someone to my team','add someone to the team','add my guys','put my guys in']},
  {id:'sub', name:'Add a subcontractor', pg:'pg-team', verbs:_TIM_MAKE.concat(['hire']), objs:['sub','subcontractor','subcontractors','subs','1099 guy','1099 worker','contractor']},
  {id:'schedule', who:true, name:'Schedule', pg:'pg-schedule', verbs:['schedule','book','set up','put','plan','line up','add','pencil in','new'],
    objs:['job','appointment','appt','visit','estimate visit','site visit','walkthrough','walk through','service call','meeting',
      'on the calendar','on my calendar','to the calendar','to my calendar','on the schedule'],
    lead:['schedule','book','pencil in'],
    also:['put it on the calendar','add to my calendar','add to the calendar','new appointment','set an appointment','set up an appointment',
      'book a time','schedule an estimate','book an estimate','schedule a walkthrough']},
  {id:'complete', name:'Finish a job', pg:'pg-jobs', verbs:['complete','finish','close out','close','mark','wrap up'],
    objs:['job','the job','work order'],
    also:['job done','job is done','job complete','job is complete','job is finished','we finished','we re done with','were done with','finished the job',
      'finished a job','done with the job','mark complete','mark it complete','mark it done','close out a job','close out the job']},
  {id:'photo', name:'Take a photo', pg:'pg-photos', verbs:['take','snap','shoot','add','upload','grab','new','attach','save'],
    objs:['photo','photos','picture','pictures','pic','pics','before pictures','after pictures','before photos','after photos','before and after'],
    also:['take a photo','take a picture','take pictures','take photos','snap a pic','snap a photo','snap a picture','open the camera','camera']},
  {id:'contract', name:'New agreement', pg:'pg-contracts', verbs:_TIM_MAKE.concat(['sign up','sign someone up for','send']),
    objs:['contract','agreement','service agreement','maintenance agreement','service plan','maintenance plan','membership','service contract']},
  {id:'license', name:'Add a license', pg:'pg-licensing', verbs:_TIM_MAKE.concat(['upload','save']),
    objs:['license','licence','permit','certification','cert','insurance','insurance certificate','coi','bond']},
  {id:'place', name:'Add a place', pg:'pg-tracker', verbs:_TIM_MAKE.concat(['save','mark']),
    objs:['place','location','supply house','supplier','shop','yard','home office','storage unit','warehouse']},
  {id:'income', name:'Log income', pg:'pg-tracker', verbs:_TIM_LOG, objs:['income','cash job','cash income','side job','other income'],
    also:['log a cash job','record cash','cash job']},
  {id:'intake', name:'Intake form', pg:'pg-leads', also:['intake form','intake link','lead form','booking link','booking form','request form','online form','web form',
    'website form','form for my website','link for my website','request link','contact form','quote request form']},
  {id:'import', name:'Import contacts', pg:'pg-leads', also:['import contacts','import my contacts','import customers','import my customers','import clients',
    'import my clients','import leads','import from my phone','contacts from my phone','pull in my contacts','bring in my contacts','bring over my contacts',
    'import a list','import my list','upload my customer list']},
  {id:'export', name:'Export the books', pg:'pg-tracker', also:['export my books','export the books','export for my accountant','send to my accountant',
    'for my accountant','for my cpa','to my accountant','to my cpa','for my bookkeeper','to my bookkeeper','export to quickbooks','download my books',
    'export a spreadsheet','spreadsheet of my books','export my expenses','export my mileage','tax export','export for taxes','send my books']},
  {id:'export-time', name:'Export the timesheet', pg:'pg-timelog', also:['export the timesheet','export my timesheet','export timesheet',
    'export the time sheet','download the timesheet','export hours','export the hours','timesheet to excel','timesheet spreadsheet']},
  {id:'reminders', name:'Payment reminders', pg:'pg-money', point:'[onclick*="collSendAllReminders"]', also:['send reminders','send payment reminders','send all reminders',
    'payment reminders','remind everyone','remind everybody','remind people to pay','remind them to pay','chase down payments','chase payments',
    'chase people','nudge everyone']},
  {id:'service', name:'Add to service due', pg:'pg-wh-list', verbs:_TIM_MAKE,
    objs:['recurring service','annual service','service customer','flush customer','maintenance customer','to service due','service due','flush',
      'tune up customer','to the flush list','filter customer']},
  {id:'dark', name:'Dark mode', pg:'pg-settings', also:['dark mode','night mode','dark theme','make it dark','darker screen']},
  {id:'light', name:'Light mode', pg:'pg-settings', also:['light mode','day mode','light theme','turn off dark mode','dark mode off','no dark mode','make it light','brighter screen']},
  {id:'signout', name:'Sign out', pg:'pg-settings', point:'#set-index-view [onclick*="supaSignOut"]', also:['log out','logout','log me out','sign out','signout','sign me out','log off','switch users']},
  // The customer's own buttons, on the customer's own page (js/clients.js
  // callClient, textClient, emailClient, openMapsDir; js/jobs.js sendOMWText).
  {id:'omw', who:'need', name:'On my way text', pg:'pg-client-detail',
    re:[/ (on my way|on the way|omw|heading over|headed over|heading your way|be there soon|running late) /]},
  {id:'call', who:'need', name:'Call', pg:'pg-client-detail',
    re:[/^ (call|ring|dial|calling) /,/^ phone (?!num)/,/ give .+ a (call|ring|buzz) /]},
  {id:'text', who:'need', name:'Text', pg:'pg-client-detail',
    re:[/^ (text|message|msg|sms|texting) /,/ (send|shoot|drop) .+ a (text|message|msg) /]},
  {id:'email', who:'need', name:'Email', pg:'pg-client-detail',
    re:[/^ (email|e mail) /,/ (send|shoot|drop) .+ an? (email|e mail) /]},
  {id:'directions', who:'need', name:'Directions', pg:'pg-client-detail',
    re:[/^ (directions|navigate|drive|head|route me|route) to /,/ directions to /,/ how (do|can) i get to /,/ get me to /,/ navigate (me )?to /,/ map (me )?to /,/ directions /]},
];
// What a man says before the part that means anything. Stripped from the
// front, longest first, as many times as they stack ("hey tim can you please").
const _TIM_LEADIN=['hey','hi','yo','ok','okay','alright','so','um','uh','tim','please','can you','could you','would you','will you','can i','could i',
  'how do i','how can i','how would i','how do we','where do i','where can i','how do you','i need to','i want to','i wanna','i have to','i gotta',
  'i got to','id like to','i would like to','im going to','im gonna','i m going to','i m gonna','let me','lets','help me','go ahead and','just',
  'real quick','quick','quickly','i need','i want','we need to','we gotta','need to','want to','gotta','i','we','to','me','a','an','the','and','now','for me'];
const _TIM_LEADIN_SORTED=_TIM_LEADIN.slice().sort((a,b)=>b.length-a.length);
function _timContent(t){
  let s=t,again=true;
  while(again){
    again=false;
    for(const w of _TIM_LEADIN_SORTED){
      if(s.indexOf(' '+w+' ')===0){s=s.slice(w.length+1);again=true;break;}
    }
  }
  return s;
}
// A question is tim-ask.js's to answer, never a thing to do.
const _TIM_ASKING=/^ (what|whats|how much|how many|how long|who|whos|when|which|did|does|do i have|has|have i|was|were|is|are|am i|whose) /;
function _timHasPhrase(t,p){return t.indexOf(' '+p+' ')>=0;}
function timDo(text,clients){
  const t=_timNormA(text);
  if(t.trim()==='')return null;
  const c=_timContent(t);
  if(_TIM_ASKING.test(c))return null;
  const list=Array.isArray(clients)?clients:[];
  const who=(typeof spkClient==='function')?spkClient(String(text||''),list):null;
  const nextJob=/ next (job|stop|appointment|appt|call|one) /.test(t);
  let best=null;
  // Scored on how much of the sentence the verb and the object account for
  // (not the gap between them), so "take a picture of a receipt" is the
  // receipt and "new change order on the Ruiz job" is the change order.
  // `at`/`objLen` are where the object sits, which timParse weighs against a
  // screen name that also matched.
  const take=(a,score,objLen,at)=>{
    // A row that means nothing without a customer cannot win without one, so
    // "call it a day" falls through to the clock and is not a phone call.
    if(a.who==='need'&&!who&&!(a.id==='directions'&&nextJob))return;
    if(!best||score>best.score||(score===best.score&&objLen>best.objLen))best={a,score,objLen,at};
  };
  TIM_DOES.forEach(a=>{
    const off=t.length-c.length;   // where the content starts inside t
    (a.also||[]).forEach(p=>{const i=t.indexOf(' '+p+' ');if(i>=0)take(a,p.length+1,p.length,i);});
    (a.re||[]).forEach(re=>{
      const head=re.source.charAt(0)==='^';
      const m=re.exec(head?c:t);
      if(m)take(a,m[0].trim().length,m[0].trim().length,(head?off:0)+m.index);
    });
    (a.verbs||[]).forEach(v=>{
      if(c.indexOf(' '+v+' ')!==0)return;
      const rest=c.slice(v.length+1);
      (a.objs||[]).forEach(o=>{
        const i=rest.indexOf(' '+o+' ');
        if(i<0)return;
        take(a,v.length+o.length,o.length,off+v.length+1+i);
      });
    });
    (a.lead||[]).forEach(v=>{
      if(c.indexOf(' '+v+' ')!==0)return;
      // A bare lead is scored a hair under a screen of the same length, so
      // "schedule" alone is the Schedule screen. With a customer after it,
      // the word is a verb on him and nothing else: "schedule Sandra".
      take(a,v.length,who&&a.who?99:v.length-0.5,off);
    });
  });
  if(!best)return null;
  const a=best.a;
  const out={id:a.id,name:a.name,pg:a.pg,score:best.score,objLen:best.objLen,at:best.at};
  if(a.build)out.build=true;
  if(a.point)out.point=a.point;
  if(a.who&&who)out.client=who;
  if(a.id==='directions'&&!who&&nextJob)out.next=true;
  return out;
}

// The whole sentence, resolved. Pure: hand it the lists, get back a plan.
// Order matters. Building beats looking, because a contractor who says
// "estimate" while describing work wants the builder, not the list of ones he
// already sent.
function timParse(text,opts){
  const o=opts||{};
  const said=String(text||'');
  if(!said.trim())return {text:said,kind:'none'};

  // Before the estimate parser: "off" and "for three days" are not a job.
  const off=timTimeOff(said,o.now);
  if(off)return off.open?{text:said,kind:'timeoff-open'}:{text:said,kind:'timeoff',start:off.start,end:off.end,label:off.label};

  const rate=timRateAsk(said);
  if(rate)return {text:said,kind:'rate',to:rate.to};

  const lead=timLead(said);
  if(lead&&lead.name){
    const pick=timLeadJob(lead.job,o.trade||'general',o.book,o.catalog);
    return Object.assign({text:said,kind:'lead',pick},lead);
  }

  // Something to DO, and not the proposal: ahead of the estimate parser, so
  // "send Rick a bill for the water heater" is an invoice and not a bid just
  // because it names a customer and a service. It still yields to a screen
  // whose name is longer than the thing it matched: "add my contractor
  // license number" is the Business info field, not a new license.
  const where=timWhere(said);
  const wh=where?_timWhereHit(said):null;
  const act=timDo(said,o.clients);
  // A screen name that sits apart from the thing to do is where it goes
  // ("add a guy to my crew"); one that covers the same words is a rival
  // reading, and the longer one wins ("add my contractor license number" is
  // the Business info field, "add an expense" is the expense).
  const apart=act&&wh&&(wh.at+wh.len+1<=act.at||act.at+act.objLen+1<=wh.at);
  const actWins=!!act&&(!wh||apart||act.objLen>=wh.len);
  if(actWins&&!act.build)return _timDoPlan(said,act);

  const est=(typeof spkParse==='function')
    ? spkParse(said,{clients:o.clients,book:o.book,catalog:o.catalog})
    : null;
  if(est&&est.actionable)return {text:said,kind:'estimate',plan:est};

  const subject=timSubject(said);
  if(subject&&timWantsBuild(said)&&!(est&&est.client))
    return {text:said,kind:'newclient',subject};

  if(actWins)return _timDoPlan(said,act);

  // The Photos page by its name is the page, before the photo lookup gets to
  // read "photos page" as photos of a place called "page".
  if(where&&where.pg==='pg-photos')return {text:said,kind:'nav',pg:'pg-photos',name:'Photos',year:null};
  const pho=timPhotoQuery(said);
  // No subject left ("where are my photos", "open photos"): that is the
  // Photos page, not an empty search box.
  if(pho&&!pho.q)return {text:said,kind:'nav',pg:'pg-photos',name:'Photos',year:null};
  if(pho){
    // Resolved here, not at run time, so the preview line can say what is
    // about to happen: one place opens, several ask which, none searches.
    const hits=(pho.q&&typeof tdPhotoSearch==='function')?tdPhotoSearch(pho.q,o.photos||[]):[];
    return {text:said,kind:'photos',q:pho.q,places:hits};
  }

  const year=timWhen(said,o.now);
  if(where){
    const nav={text:said,kind:'nav',pg:where.pg,name:where.name,year};
    if(where.tab)nav.tab=where.tab;
    if(where.set)nav.set=where.set;
    if(where.point)nav.point=where.point;
    return nav;
  }
  // A bare year is the books. Nowhere else in this app is a year the whole ask.
  if(year!==null)return {text:said,kind:'nav',pg:'pg-tracker',name:'Books',year};

  if(timHelpAsk(said))return {text:said,kind:'help'};

  // A customer, and nothing else he could mean: his page, where his phone
  // number, his jobs and his money all are.
  const cust=(typeof spkClient==='function')?spkClient(said,o.clients||[]):null;
  if(cust)return {text:said,kind:'client',client:cust,name:cust.name};

  const q=timSearchAsk(said);
  if(q)return {text:said,kind:'search',q:q.q};

  return {text:said,kind:'none'};
}

// A do-row resolved into the plan timRun acts on.
function _timDoPlan(said,act){
  const p={text:said,kind:'do',act:act.id,name:act.name,pg:act.pg};
  if(act.client)p.client=act.client;
  if(act.next)p.next=true;
  if(act.point)p.point=act.point;
  return p;
}

// "Help", "what can you do", "how does this work". Checked last, after every
// door and screen, so "help me add an expense" is the expense.
const _TIM_HELP=['help','what can you do','what can i ask','what can i say','how does this work','how do you work','what do you do',
  'what do you know','who are you','what are you','how do i use this','how do i use you','how do i use the app','what should i ask',
  'tutorial','show me around','give me a tour','where do i start','how do i get started','getting started','im lost','i m lost','what can tim do'];
function timHelpAsk(text){
  const t=_timNormA(text);
  return _TIM_HELP.some(p=>_timHasPhrase(t,p));
}
// "search for 412 Maple", "look up the water heater job". The app's own
// search (openSearch / runSearch, js/settings.js) does the finding.
function timSearchAsk(text){
  const t=_timNormA(text);
  const m=/^ (?:search for|search|look up|lookup|look for|find me|find) (.*)$/.exec(_timContent(t));
  if(!m)return null;
  const q=m[1].replace(/^(?:the|a|an|my) /,'').trim();
  return {q};
}

// THE ORDER _timGoRun DECIDES IN, as a pure function, so the 500 sentences in
// tests/fixtures/tim-500.json are checked against the same decision the send
// arrow makes and not a copy of it. Build first (a door and a customer),
// then a question about his business, then everything timParse knows. A
// thing to DO outranks a question that happens to share words with it: "log
// my miles" is a trip to log, not "my miles" to read back. What this cannot
// see is the estimate page, where _timGoRun reads the sentence as work; that
// stays in _timGoRun because it is about where he is standing, not what he
// said.
function timResolve(text,opts){
  const o=opts||{};
  const said=String(text||'');
  if(!said.trim())return {text:said,kind:'none'};
  const list=Array.isArray(o.clients)?o.clients:[];
  const act=timDo(said,list);
  const style=timStyle(said);
  const who=(typeof spkClient==='function')?spkClient(said,list):null;
  // "Create an invoice for Rick" is an invoice, not a proposal for Rick that
  // happens to say create.
  if(who&&timWantsBuild(said)&&!(act&&!act.build)){
    if(style)return {text:said,kind:'build',style:style.id,client:who};
    if(!/\b(hours?|hrs)\b/i.test(said))return {text:said,kind:'build',style:null,client:who};
  }
  // "Open my mileage" is the Mileage tab, even though "my mileage" is also a
  // question he answers. Asked to go somewhere, he goes.
  const goTo=/^ (open|open up|go to|take me to|bring up|pull up|navigate to|jump to) /.test(_timContent(_timNormA(said)))&&!!timWhere(said);
  if(!act&&!goTo&&typeof timAsk==='function'){
    const ans=timAsk(said);
    if(ans)return {text:said,kind:'ask',ask:ans.id,answer:ans};
  }
  const p=timParse(said,o);
  // A question he recognises but has nothing on the books to answer ("what do
  // I charge for a tankless" with no tankless ever priced) goes to the page
  // where that answer will live, instead of a shrug.
  if(p.kind==='none'&&!act&&typeof timAskKind==='function'&&typeof TIM_ASKS!=='undefined'){
    const k=timAskKind(said);
    const fam=k&&TIM_ASKS.find(a=>a.id===k.id);
    if(fam&&fam.home){
      const h=fam.home,nav={text:said,kind:'nav',pg:h.pg,name:h.name,year:null};
      if(h.tab)nav.tab=h.tab;
      if(h.set)nav.set=h.set;
      return nav;
    }
  }
  return p;
}

// What Tim is about to do, in his words, so the box is never a black hole. This
// string is what the screen shows BEFORE he does anything.
function timSay(p){
  if(!p||p.kind==='none')return '';
  if(p.kind==='nav')return 'Open '+p.name+(p.year?' for '+p.year:'');
  if(p.kind==='do'){
    const nm=p.client&&p.client.name?p.client.name:'';
    if(p.act==='call'||p.act==='text'||p.act==='email')return p.name+' '+nm;
    if(p.act==='directions')return nm?'Directions to '+nm:'Directions to your next job';
    if(p.act==='omw')return 'Tell '+nm+' you are on your way';
    return p.name+(nm?' for '+nm:'');
  }
  if(p.kind==='client')return 'Open '+((p.client&&p.client.name)||'the customer');
  if(p.kind==='build'){
    const st=TIM_STYLES.find(s=>s.id===p.style);
    return 'Start '+(st?'a '+st.name:'a proposal')+' for '+((p.client&&p.client.name)||'them');
  }
  if(p.kind==='ask')return 'Answer that off your own books';
  if(p.kind==='help')return 'Show what I can do';
  if(p.kind==='search')return p.q?'Search for '+p.q:'Open search';
  if(p.kind==='rate')return p.to?'Set your rate to $'+p.to.toLocaleString('en-US')+' an hour':'Change your hourly rate';
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
  if(p.kind==='lead'){
    const bits=[p.addr?String(p.addr).split(',')[0]:'',p.phone?_timPhoneWord(p.phone):''].filter(Boolean);
    return 'Add lead '+p.name+(bits.length?' ('+bits.join(', ')+')':'')+(p.pick?', then start a '+p.pick.desc+' proposal':'');
  }
  if(p.kind==='timeoff')return 'Mark '+_timDayWord(p.start)+(p.end!==p.start?' to '+_timDayWord(p.end):'')+' as '+p.label.toLowerCase();
  if(p.kind==='timeoff-open')return 'Open your time off';
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
  const p=timParse(text,{clients:(typeof clients!=='undefined'?clients:[]),book,catalog,trade,
    photos:(typeof photos!=='undefined'?photos:[])});

  if(p.kind==='lead'){_timSaveLead(p,trade);return p;}

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

  if(p.kind==='timeoff'&&typeof addTimeOff==='function'){
    const have=(typeof S!=='undefined'&&Array.isArray(S.timeOff))?S.timeOff:[];
    // Already covered is already done: a second identical block would only
    // be one more row to remove later.
    if(!have.some(b=>b&&b.start<=p.start&&(b.end||b.start)>=p.end))addTimeOff(p.start,p.end,p.label);
    if(typeof showToast==='function')showToast(p.label+' saved. Time and mileage wait for your answer those days','🏖',3200);
    // Today inside it: re-derive now so the live timer stops this minute
    // rather than at the next motion flip.
    try{
      const td=(typeof _bizDateStr==='function')?_bizDateStr(new Date()):_timYmd(new Date());
      if(td>=p.start&&td<=p.end&&typeof _geoDeriveDayNow==='function')_geoDeriveDayNow(td,null);
    }catch(_e){}
    return p;
  }
  if(p.kind==='timeoff-open'&&typeof openTimeOffModal==='function'){openTimeOffModal();return p;}

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

  if(p.kind==='rate'){
    if(p.to)_timSetRate(p.to);else _timAskRate();
    return p;
  }
  if(p.kind==='nav'&&p.pg==='pg-photos'){_timWalkTo('pg-photos','mmi-photos');return p;}
  if(p.kind==='nav'&&typeof goPg==='function'){
    goPg(p.pg);
    // The tab or the settings section, through the same function the
    // screen's own button calls, and only once the page exists.
    if(p.tab)_timOpenTab(p.pg,p.tab);
    if(p.set&&typeof _openSetDetail==='function')_openSetDetail(p.set);
    // The year goes on AFTER the page exists, because setting it renders the
    // tab. A year the books have no rows for falls back to the newest on its
    // own inside populateTrackerYearSel, which is the right answer anyway.
    if(p.year&&p.pg==='pg-tracker'&&typeof setTrackerYear==='function')setTrackerYear(p.year);
    if(p.point)_timPointAt(p.point);
    return p;
  }
  if(p.kind==='do'){_timDoRun(p);return p;}
  if(p.kind==='client'&&p.client&&typeof openClientDetail==='function'){openClientDetail(p.client.id);return p;}
  if(p.kind==='help'){_timHelp();return p;}
  if(p.kind==='search'&&typeof openSearch==='function'){
    openSearch();
    const box=document.getElementById('global-search-input');
    if(box&&p.q){box.value=p.q;if(typeof runSearch==='function')runSearch(p.q);}
    return p;
  }
  return p;
}

// Each screen's own tab switch, by the id its buttons already pass.
const _TIM_TAB_FN={
  'pg-tracker':t=>{if(typeof setTrTab==='function')setTrTab(t,document.getElementById('tr-t-'+t));},
  'pg-team':t=>{if(typeof setFleetTab==='function')setFleetTab(t);},
  'pg-taxes':t=>{if(typeof setTaxTab==='function')setTaxTab(t,document.getElementById('tx-tab-'+t));
    if(t==='payroll'&&typeof renderPayrollSummary==='function')renderPayrollSummary();},
  'pg-money':t=>{if(typeof setMoneyFilter==='function')setMoneyFilter(t);},
  'pg-jobs':t=>{if(typeof setJobFilter==='function')setJobFilter(t);},
  'pg-leads':t=>{if(typeof setLeadFilter==='function')setLeadFilter(t);},
};
function _timOpenTab(pg,tab){
  try{const fn=_TIM_TAB_FN[pg];if(fn)fn(tab);}catch(_e){}
}
// Light up the control he asked about, so he sees where it lives and goes
// there himself next time (the same idea as _timWalkTo's More menu walk).
// A class, and the class owns the motion (index.html .tim-point-at).
function _timPointAt(sel){
  try{
    const el=document.querySelector(sel);
    if(!el)return false;
    if(typeof el.scrollIntoView==='function')el.scrollIntoView({block:'center',behavior:'smooth'});
    el.classList.add('tim-point-at');
    setTimeout(()=>el.classList.remove('tim-point-at'),2600);
    return true;
  }catch(_e){return false;}
}

// The next job on the books from now: today's first, then the soonest ahead.
// Read the way the dashboard reads today (jobs[].start / .days, todayKey).
function _timNextJob(){
  const list=(typeof jobs!=='undefined'&&Array.isArray(jobs))?jobs:[];
  const tk=(typeof todayKey==='function')?todayKey():_timYmd(new Date());
  const open=list.filter(j=>j&&!j.cancelled&&j.status!=='done'&&!j.completion_date&&(j.start||j.date));
  const on=j=>{const s=j.start||j.date,d=parseInt(j.days,10)||1;
    for(let i=0;i<d;i++){if((typeof addDays==='function'?addDays(s,i):s)===tk)return true;}return false;};
  const today=open.filter(on).sort((a,b)=>String(a.time||'').localeCompare(String(b.time||'')));
  if(today.length)return today[0];
  return open.filter(j=>String(j.start||j.date)>tk).sort((a,b)=>String(a.start||a.date).localeCompare(String(b.start||b.date)))[0]||null;
}

// Doing it. Every branch is the function an existing button calls.
function _timDoRun(p){
  const has=n=>typeof window[n]==='function';
  const go=pg=>{if(has('goPg'))goPg(pg);};
  const c=p.client||null;
  const onCustomer=()=>{if(c&&has('openClientDetail'))openClientDetail(c.id);};
  switch(p.act){
    case 'new-client':go('pg-clients');if(has('openNewClient'))openNewClient();return;
    case 'estimate':
      if(c&&has('_timAskStyle')){_timAskStyle(c);return;}
      if(has('quickAction'))quickAction('estimate');return;
    case 'invoice':
      if(c&&has('openQuickInvoice')){openQuickInvoice(c.id);return;}
      if(has('quickAction'))quickAction('invoice');return;
    case 'collect':if(has('quickAction'))quickAction('collect');return;
    case 'change-order':{
      const won=c&&(typeof bids!=='undefined'?bids:[]).filter(b=>b&&b.client_id===c.id&&b.status==='Closed Won')
        .sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')))[0];
      if(won&&has('showChangeOrderModal')){showChangeOrderModal(won.id,c.id);return;}
      if(c){onCustomer();}else go('pg-jobs');
      if(has('showToast'))showToast('Change orders go on a won job. Open the job and tap Change order','📋',3200);
      return;
    }
    case 'clock-in':go('pg-dash');if(has('_dashManualClockIn'))_dashManualClockIn();return;
    case 'clock-out':
      go('pg-dash');
      if(typeof _activeTimer!=='undefined'&&_activeTimer&&has('clockOut')){clockOut();return;}
      if(has('showToast'))showToast('You are not on the clock','⏱',2400);
      return;
    case 'expense':if(has('quickAction'))quickAction('expense');return;
    case 'receipt':go('pg-tracker');if(has('triggerReceiptScan'))triggerReceiptScan();return;
    case 'trip':if(has('openLogTripModal'))openLogTripModal();return;
    case 'drive':if(has('quickAction'))quickAction('drive');return;
    case 'vehicle':go('pg-team');_timOpenTab('pg-team','fleet');if(has('openAddVehicleModal'))openAddVehicleModal(-1);return;
    case 'employee':go('pg-team');_timOpenTab('pg-team','team');if(has('openAddEmployeeModal'))openAddEmployeeModal();return;
    case 'sub':go('pg-team');_timOpenTab('pg-team','team');if(has('openAddSubModal'))openAddSubModal();return;
    case 'schedule':if(has('quickAction'))quickAction('schedule');return;
    case 'complete':if(has('quickAction'))quickAction('complete');return;
    case 'photo':if(has('quickAction'))quickAction('photo');return;
    case 'contract':go('pg-contracts');if(has('openNewAgreement'))openNewAgreement();return;
    case 'license':go('pg-licensing');if(has('openAddLicense'))openAddLicense();return;
    case 'place':go('pg-tracker');_timOpenTab('pg-tracker','places');if(has('openPlaceModal'))openPlaceModal();return;
    case 'income':go('pg-tracker');_timOpenTab('pg-tracker','income');if(has('openManualIncomeModal'))openManualIncomeModal();return;
    case 'intake':go('pg-leads');if(has('openIntakeFormModal'))openIntakeFormModal();return;
    case 'import':go('pg-leads');if(has('openImportContacts'))openImportContacts();return;
    case 'export':go('pg-tracker');if(has('openExportPanel'))openExportPanel();return;
    // Sending texts to everybody who owes him is not a thing to do off a
    // misheard sentence. He lands on the button, lit, and taps it himself.
    case 'reminders':go('pg-money');_timPointAt(p.point);return;
    case 'export-time':go('pg-timelog');if(has('_tlExportCSV'))_tlExportCSV();return;
    case 'service':go('pg-wh-list');if(has('openWhAdd'))openWhAdd();return;
    case 'dark':if(has('toggleDarkMode'))toggleDarkMode(true);return;
    case 'light':if(has('toggleDarkMode'))toggleDarkMode(false);return;
    // Same reason: signing out off a misheard word loses his place. Settings,
    // with the Sign out button lit.
    case 'signout':go('pg-settings');if(has('_closeSetDetail'))_closeSetDetail();_timPointAt(p.point);return;
    case 'call':onCustomer();if(has('callClient'))callClient();return;
    case 'text':onCustomer();if(has('textClient'))textClient();return;
    case 'email':onCustomer();if(has('emailClient'))emailClient();return;
    case 'omw':onCustomer();if(c&&has('sendOMWText'))sendOMWText(c.id);return;
    case 'directions':{
      if(c){onCustomer();if(has('openMapsDir'))openMapsDir();return;}
      const j=_timNextJob();
      const cid=j&&(j.client_id!=null?j.client_id:null);
      if(cid!=null&&has('openMapsForClient')){openMapsForClient(cid);return;}
      go('pg-jobs');_timOpenTab('pg-jobs','scheduled');
      if(has('showToast'))showToast('Nothing on the books coming up','📅',2400);
      return;
    }
  }
}

// What he can say, shown as things to tap. Each one goes down the same door a
// typed sentence does (_timChip), so it cannot promise what typing would not do.
const TIM_HELP_CHIPS=[
  {say:'new estimate',chip:'New estimate'},
  {say:'send an invoice',chip:'Send an invoice'},
  {say:'clock me in',chip:'Clock in'},
  {say:'log a trip',chip:'Log a trip'},
  {say:'scan a receipt',chip:'Scan a receipt'},
  {say:'who owes me money',chip:'Who owes me'},
  {say:'open the price book',chip:'Price book'},
  {say:'take me to my taxes',chip:'Taxes'},
];
function _timHelpHtml(){
  return '<div id="_tim-help" style="padding:13px 16px 4px">'+
    '<div style="font-size:12.5px;line-height:1.5;color:var(--text2);margin-bottom:9px">'+
      'Name a screen, a customer, or the thing you need to do, and I will take you there. A few to try:</div>'+
    '<div style="display:flex;flex-wrap:wrap;gap:7px">'+
      TIM_HELP_CHIPS.map(c=>'<button type="button" class="tim-chip" onclick="_timChip('+
        escHtml(JSON.stringify(c.say))+')">'+escHtml(c.chip)+'</button>').join('')+
    '</div></div>';
}
function _timHelp(){
  if(typeof openTim==='function')openTim();
  const thread=document.getElementById('_tim-thread');
  if(document.getElementById('_tim-help'))return;
  const wrap=document.createElement('div');
  wrap.innerHTML=_timHelpHtml();
  const node=wrap.firstChild;
  if(thread&&thread.parentNode)thread.parentNode.insertBefore(node,thread);
  else{const sheet=document.getElementById('_tim-sheet');if(sheet)sheet.appendChild(node);}
}

// Save the lead, then go where the sentence pointed: the proposal when it named
// a job, the customer's page when it did not. The customer is created through
// the one door every other path uses (_clientQuickCreate, js/clients.js), so
// the funnel event, the hub token and the property lookup all happen as they
// would from the form (7.3).
function _timSaveLead(p,trade){
  if(!p||!p.name)return null;
  const list=(typeof clients!=='undefined'&&Array.isArray(clients))?clients:[];
  // Somebody he already has is not a new lead: same phone, or same name at
  // the same street. He gets the one he has, not a duplicate.
  const digits=v=>String(v||'').replace(/\D/g,'').slice(-10);
  let c=list.find(x=>x&&p.phone&&digits(x.phone)===p.phone)||
        list.find(x=>x&&p.addr&&String(x.name||'').toLowerCase()===p.name.toLowerCase()&&
          String(x.addr||'').toLowerCase().split(',')[0]===String(p.addr).toLowerCase().split(',')[0])||null;
  const existed=!!c;
  if(!c){
    if(typeof _clientQuickCreate!=='function')return null;
    c=_clientQuickCreate(p.name,p.addr||'');
    if(p.phone)c.phone=p.phone;
    if(p.email)c.email=p.email;
    if(p.source)c.source=p.source;
    if(p.ref)c.ref=p.ref;
    if(p.job)c.notes=p.job.charAt(0).toUpperCase()+p.job.slice(1);
    if(typeof saveAll==='function')saveAll();
  }
  if(typeof showToast==='function')showToast(existed?(c.name+' is already a customer'):('Lead saved: '+c.name),existed?'👤':'✅',2600);
  if(typeof currentClientId!=='undefined')currentClientId=c.id;
  if(p.pick&&typeof openFreeFormEstimate==='function'){
    window._scanEstimateSeed={clientId:c.id,lines:[{desc:p.pick.desc,qty:1,unit:'ea',rate:p.pick.rate,total:p.pick.rate,
      notes:p.pick.notes||(typeof tkScopeFor==='function'?tkScopeFor(p.pick.desc,trade):''),
      _byoSection:(typeof _byoWorkSection==='function'?_byoWorkSection():'Work')}],
      say:p.pick.desc+' is on the proposal'};
    openFreeFormEstimate(c);
    // Autopilot means landing where the work is. The setup step it opens on
    // already holds the defaults (residential, repair, normal hours) and his
    // customer, so it is one tap he never needed to make.
    if(typeof goGeiStep==='function'){try{goGeiStep(2);}catch(_e){}}
  }else if(typeof openClientDetail==='function'){
    openClientDetail(c.id);
  }
  return c;
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
  // The side menu's Tim (index.html #nb-tim) is the same key for an iPad or a
  // laptop, where the bottom bar is not drawn. It follows every rule below.
  const side=document.getElementById('nb-tim');
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
    if(side)side.hidden=true;
    try{document.querySelectorAll('.tim-atwork').forEach(el=>{el.hidden=true;});}catch(_e){}
    return;
  }
  tab.hidden=false;
  if(side)side.hidden=false;

  const markEl=document.getElementById('mtb-tim-mark');
  if(markEl&&!markEl.firstChild)markEl.innerHTML=timMark(36);
  const sideMark=document.getElementById('nb-tim-mark');
  if(sideMark&&!sideMark.firstChild)sideMark.innerHTML=timMark(20);
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
  const badge=document.getElementById('nb-tim-badge');
  if(badge){
    badge.textContent=finds.length?String(finds.length):'';
    badge.style.display=finds.length?'flex':'none';
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
  // A co-owner is an owner here: Tim reads the business's own records, which a
  // co-owner holds unredacted, so his answers are the business's.
  try{return (typeof _ownerUI==='function')?!_ownerUI():((typeof _isEmployee!=='undefined')&&!!_isEmployee);}catch(_e){return false;}
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
      // Plain words, and a sentence Tim really acts on: "quote" is a build
      // and "by the hour" is T&M (Earl audit 2026-09-27: "T and M" is jargon).
      (_timOnEstimate() ? 'Tell Tim what changed' : _TIM_SAY_HINT)+'" '+
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
let _timTalking=false,_timHeard='',_timWaveTimer=null,_timTalkStart=0,_timTalkPaused=false;

// THE BARS ARE HONEST (the Earl audit, 2026-09-27). They used to swing the
// same whether he was talking, resting, or the mic had quietly died. Now they
// move only while words are arriving, lie flat after a few quiet seconds, and
// lie flat and dim when listening is paused. There is no cheap mic level on
// this side of the bridge, so words arriving is the signal.
const _TIM_WAVE_QUIET_MS=2500;
function _timWaveFlatHtml(){
  let out='';
  for(let i=0;i<44;i++)out+='<span class="edge" style="height:4px"></span>';
  return out;
}
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

// What Done does, said truthfully for the box the words are going into
// (2026-09-27: the panel promised "Nothing is added until you approve it" while
// Done on the estimate made the lines on the spot).
function _timTalkFoot(){
  const el=document.getElementById(_timTalkTarget);
  const done=el&&el.dataset?el.dataset.timDone:'';
  if(done)return 'Keep going as long as you want. Tim makes the lines when you tap Done. You can change any of them.';
  if(_timTalkTarget==='_tim-say')return 'Keep going as long as you want. Nothing is added until you approve it.';
  return 'Keep going as long as you want. Your words go in the box when you tap Done.';
}

function _timTalkPanel(){
  const secs=Math.max(0,Math.round((Date.now()-_timTalkStart)/1000));
  const clock=Math.floor(secs/60)+':'+String(secs%60).padStart(2,'0');
  // THE PANEL FITS AN SE (375 by 667) after fifteen minutes of talk. The
  // transcript is capped to its last few lines and kept scrolled to the
  // bottom, so the heading, the clock and Done talking never leave the screen.
  return '<div id="_tim-listen" style="background:var(--ink);margin:0 0 -28px;padding:16px 16px calc(18px + env(safe-area-inset-bottom,0px))">'+
    '<div id="_tim-listen-top" onclick="_timTalkTap()">'+
    '<div style="display:flex;align-items:center;gap:9px;margin-bottom:12px">'+
      timMark(22)+
      '<span id="_tim-listen-label" style="font-size:12px;font-weight:600;color:var(--text-cream)">Tim is listening</span>'+
      '<span style="flex:1"></span>'+
      '<span id="_tim-clock" style="font-size:11.5px;color:var(--text-cream-2);font-variant-numeric:tabular-nums">'+clock+'</span>'+
    '</div>'+
    '<div id="_tim-transcript" style="font-size:13.5px;line-height:1.55;color:var(--text-cream);margin-bottom:14px;min-height:42px;max-height:min(7.75em,22vh);overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch"></div>'+
    '<div class="tim-wave" id="_tim-wave">'+_timWaveHtml(0)+'</div>'+
    '</div>'+
    '<button type="button" onclick="_timTalkToggle()" style="width:100%;height:52px;margin-top:16px;border:0;border-radius:var(--r-md);background:var(--text-cream);color:var(--ink);font-family:inherit;font-size:15.5px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:9px">'+
      '<span style="width:13px;height:13px;border-radius:3px;background:var(--c-red)"></span>Done talking</button>'+
    '<div id="_tim-listen-foot" style="text-align:center;font-size:12px;color:var(--text-cream-2);margin-top:10px">'+escHtml(_timTalkFoot())+'</div>'+
  '</div>';
}

// WHICH FIELD the words land in. The sheet has two: the command line on the
// findings panel, and the site-note field when Tim is starting a proposal. Same
// mic, same waveform, same promise, different destination, so the id comes in
// rather than being assumed.
let _timTalkTarget='_tim-say';

// ── THE SAY BOX: one Talk to Tim for every screen (owner 2026-09-27) ────────
// "Talk to Tim code should be shared as well, don't hand roll another one, it
// just points at proposals and invoices." The T&M scope, the Build Your Own
// list and the quick invoice each had their own copy of this box, button and
// read-the-box code. Now a screen names three things and nothing else: the
// box's id, what to call when he stops talking (data-tim-done, read by
// _timTalkStop), and its own words. A new screen that wants Talk to Tim calls
// timSayBox; it never grows a fourth copy.
const _TIM_MIC_SVG='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><path d="M12 19v3"></path></svg>';
function _timSayVoice(){return typeof _voiceCapable==='function'&&!!_voiceCapable();}
function timSayField(id,placeholder,done){
  // Sentences, not Every Word (found 2026-09-29 driving an invoice start to
  // finish): what he types here lands on the customer's copy, and the app-wide
  // words default turned "replaced the water heater" into Title Case.
  return '<textarea id="'+escHtml(id)+'" class="ios-say" rows="3" autocapitalize="sentences" data-tim-done="'+escHtml(done||'')+'" placeholder="'+escHtml(placeholder||'')+'"></textarea>';
}
// THE KEYBOARD'S CHECK BUILDS IT (owner 2026-09-30: "when you get done
// dropping into Tim's box we got to check box the keyboard so Tim parses it at
// that point"). Pasting John's email and closing the keyboard is the whole
// gesture; he should not have to hunt for a button under it. A tap on one of
// the box's own buttons (the mic, Cancel, Add a line) is not "done", and
// dictation finishes through its own Done.
function _timSayBlur(e){
  const el=e&&e.target;
  if(!el||el.tagName!=='TEXTAREA'||!el.dataset||!el.dataset.timDone)return;
  const fn=window[el.dataset.timDone];
  if(typeof fn!=='function')return;
  const v=String(el.value||'').trim();
  if(!v||el.dataset.timBuilt===v)return;
  if(typeof _timTalking!=='undefined'&&_timTalking)return;
  const sec=el.closest('.ios-sec');
  const to=e.relatedTarget;
  if(to&&sec&&sec.contains(to))return;
  el.dataset.timBuilt=v;
  // After the blur settles, so a re-render does not pull the box out from
  // under the event that is still running.
  setTimeout(()=>{if(document.body.contains(el)&&String(el.value||'').trim()===v)fn();},0);
}
if(typeof document!=='undefined')document.addEventListener('focusout',_timSayBlur);
function timMicBtn(id){
  return _timSayVoice()?'<button type="button" class="ios-btn ios-btn-tint" onclick="_timTalkToggle(\''+escHtml(id)+'\')">'+_TIM_MIC_SVG+'Talk to Tim</button>':'';
}
// o: {id, done, placeholder, foot:{voice,typed}, links: html}
function timSayBox(o){
  const voice=_timSayVoice();
  const foot=o.foot?(voice?o.foot.voice:o.foot.typed):'';
  return '<div class="ios-sec">'+
    '<div class="ios-group">'+timSayField(o.id,o.placeholder,o.done)+'</div>'+
    (voice?'<div style="margin-top:12px">'+timMicBtn(o.id)+'</div>':'')+
    (foot?'<div class="ios-foot">'+escHtml(foot)+'</div>':'')+
    (o.links?'<div class="ios-links left">'+o.links+'</div>':'')+
  '</div>';
}
// What is in the box, or '' after asking for words where he is looking.
function timSaid(id,emptyMsg){
  const el=document.getElementById(id);
  const said=el?String(el.value||'').trim():'';
  if(!said){
    if(el){try{el.focus();}catch(_e){}}
    if(typeof showToast==='function')showToast(emptyMsg||'Type or say it in the box first','✏️',2600);
  }
  return said;
}
// The things he said, one per step. Nothing Tim recognised as a step: the
// sentence itself, cleaned up, is still what he said.
function timSaySteps(said){
  return timSayLines(said).map(l=>l.text);
}
// The same, with the price he said for each line (0 when he did not say one),
// for a screen whose lines carry a price.
function timSayLines(said){
  const built=(typeof timScopeBuild==='function')?timScopeBuild(said,{rejected:[]}):null;
  const lines=(built&&Array.isArray(built.steps)?built.steps.map(st=>({text:String(st.text||'').trim(),price:Number(st.price)||0})):[]).filter(l=>l.text);
  if(lines.length)return lines;
  // Only a shopping list: the materials go to Materials, and there is no step.
  if(built&&Array.isArray(built.materials)&&built.materials.length)return [];
  const t=String(said||'').trim().replace(/\s+/g,' ');
  return t?[{text:t.charAt(0).toUpperCase()+t.slice(1),price:0}]:[];
}

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
  _timTalking=true;_timHeard='';_timTalkStart=Date.now();_timTalkPaused=false;
  _timTalkHost().insertAdjacentHTML('beforeend',_timTalkPanel());
  let flat=false;
  const tick=()=>{
    if(!_timTalking)return;
    const t=(Date.now()-_timTalkStart)/1000;
    const w=document.getElementById('_tim-wave');
    const heard=(typeof _voiceLastHeard!=='undefined'&&_voiceLastHeard)?_voiceLastHeard:_timTalkStart;
    const still=_timTalkPaused||(Date.now()-heard)>_TIM_WAVE_QUIET_MS;
    if(w&&still&&!flat){w.innerHTML=_timWaveFlatHtml();flat=true;}
    else if(w&&!still){w.innerHTML=_timWaveHtml(t);flat=false;}
    const c=document.getElementById('_tim-clock');
    if(c)c.textContent=Math.floor(t/60)+':'+String(Math.floor(t%60)).padStart(2,'0');
  };
  _timWaveTimer=setInterval(tick,110);
  if(typeof _voiceStart==='function'){
    Promise.resolve(_voiceStart(el,(joined,heard)=>{
      _timHeard=joined;
      const tr=document.getElementById('_tim-transcript');
      if(tr){tr.textContent=joined?('"'+joined+'"'):'';tr.scrollTop=tr.scrollHeight;}
    },_timTalkState)).then(ok=>{
      // The mic did not start. The panel said "Tim is listening" anyway and
      // heard nothing (2026-09-26). Say so, where he is looking, and stop.
      if(ok!==false||!_timTalking)return;
      _timTalking=false;
      if(_timWaveTimer){clearInterval(_timWaveTimer);_timWaveTimer=null;}
      const p=document.getElementById('_tim-listen');
      if(p)p.innerHTML='<div style="display:flex;align-items:center;gap:9px;margin-bottom:8px">'+timMark(22)+
        '<span style="font-size:13.5px;font-weight:700;color:var(--text-cream)">Tim can\'t hear you</span></div>'+
        '<div style="font-size:13px;line-height:1.5;color:var(--text-cream-2);margin-bottom:14px">Turn on Microphone and Speech Recognition for TradeDesk in Settings, then try again. You can type it in the meantime.</div>'+
        '<button type="button" onclick="document.getElementById(\'_tim-listen\')?.remove();document.getElementById(\'_tim-listen-host\')?.remove()" style="width:100%;height:48px;border:0;border-radius:var(--r-md);background:var(--text-cream);color:var(--ink);font-family:inherit;font-size:15px;font-weight:700;cursor:pointer">OK</button>';
    });
  }
}

// PAUSED, SAID OUT LOUD. The page hid (screen lock, a call) or the mic would
// not start again: the heading says so and the bars lie flat, and a tap
// anywhere on the top of the panel starts it again.
function _timTalkState(st){
  _timTalkPaused=!!(st&&st.paused);
  const lab=document.getElementById('_tim-listen-label');
  if(lab)lab.textContent=_timTalkPaused?'Paused, tap to keep going':'Tim is listening';
  const top=document.getElementById('_tim-listen-top');
  if(top){top.style.cursor=_timTalkPaused?'pointer':'';top.setAttribute('aria-label',_timTalkPaused?'Paused, tap to keep going':'Tim is listening');}
  const w=document.getElementById('_tim-wave');
  if(w&&_timTalkPaused)w.innerHTML=_timWaveFlatHtml();
}
function _timTalkTap(){
  if(!_timTalking||!_timTalkPaused)return;
  if(typeof _voiceKeepGoing==='function')_voiceKeepGoing();
}

function _timTalkStop(silent){
  if(!_timTalking){return Promise.resolve();}
  _timTalking=false;_timTalkPaused=false;
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
    // The box says what happens next (data-tim-done, set by timSayField).
    const done=el&&el.dataset?el.dataset.timDone:'';
    if(done){if(typeof window[done]==='function')window[done]();return;}
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

  // What he said he is buying, into the estimate's Materials section, the same
  // way the talk box on the estimate does it (js/materials.js).
  if(typeof timAddMaterials==='function'&&Array.isArray(job.saidMaterials)&&job.saidMaterials.length){
    const r=timAddMaterials(job.saidMaterials);landed+=r.rows+r.listed;
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
  const p=timParse(el.value,{clients:(typeof clients!=='undefined'?clients:[]),book,catalog,trade,
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
    // And a thing to DO outranks a question, same as timResolve: "log my
    // miles" previews the trip it is about to open, not an answer.
    const act=timDo(el.value,(typeof clients!=='undefined'?clients:[]));
    if(!build&&!act&&(!line||(p&&p.kind==='nav'))&&timAskKind(el.value)){
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
  return(typeof tdOpenPhotoGroup==='function')?tdOpenPhotoGroup(g):false;
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
  const _trade=(typeof getActiveTrade==='function'?getActiveTrade():'general')||'general';
  const _book=(typeof S!=='undefined'&&S.priceBook&&Array.isArray(S.priceBook[_trade]))?S.priceBook[_trade]:[];
  const _catalog=(typeof TRADE_JOBS!=='undefined'&&Array.isArray(TRADE_JOBS[_trade]))?TRADE_JOBS[_trade]:[];
  // timResolve makes the decision; this function only carries it out. The
  // order inside it is the order this function always had: a build, then a
  // question about his business, then everything else.
  const r=timResolve(said,{clients:(typeof clients!=='undefined'?clients:[]),book:_book,catalog:_catalog,
    photos:(typeof photos!=='undefined'?photos:[])});

  // ── "Build me a T and M for Dana" ─────────────────────────────────────────
  // A door and a customer is a proposal, and it outranks everything else,
  // including the estimate page he may already be standing on: a man who says
  // "build me a TrueBid for the Kellermans" while looking at Dana's T&M means
  // a new one, not a note on this one. A customer and a clear intent to build
  // but no door named asks which door.
  if(r.kind==='build'){
    if(r.style)_timStartBuild(r.style,r.client);else _timAskStyle(r.client);
    return {text:said,kind:'build',style:r.style,clientId:r.client.id};
  }

  // ── A question about his own business ────────────────────────────────────
  // Ahead of the estimate read, and safely so: timAskKind only fires on an
  // explicit question phrase ("who owes me", "what did I charge"), and a man
  // describing work says none of them. Ahead of the navigator too, because
  // "who owes me money" deserves the figure, not the Collect screen with the
  // figure somewhere on it (js/tim-ask.js).
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
  if(r.kind==='ask'){
    const ans=r.answer||{};
    return {text:said,kind:'ask',ask:ans.id,title:ans.title,
      sub:ans.sub||'',
      goLabel:(ans.go&&ans.go.label)||'',goFn:(ans.go&&ans.go.fn)||'',
      rows:!!(ans.rows&&ans.rows.length)};
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
  if(!r||r.kind==='none'){
    if(typeof showToast==='function')showToast('Say a screen, a customer, or what you need to do','🔧',2600);
    return r||{text:said,kind:'none'};
  }
  _timClose();
  return timRun(said);
}
