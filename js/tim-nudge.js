// ── What makes him tap it ────────────────────────────────────────────────────
//
// Not the button. The sentence on it.
//
// A contractor does not open an assistant to chat. He opens it because it just
// told him something about THIS job that costs him money, and it told him in a
// number. So Tim never announces himself, he announces the find: what is
// missing, and what it is worth.
//
// The rule, and it is the whole file: **Tim speaks when he can name a dollar, a
// percentage, or a law.** Otherwise the dock sits there with no pill on it and
// he is quiet. Three sentences that are banned by construction, because each
// one fails that test:
//
//   "Ask Tim anything"        a greeting, nothing is at stake
//   "Tim has 3 suggestions"   three of what, worth what. The app talking about itself
//   "Let AI help you"         he is trying to get a proposal out before supper,
//                             and the app never says AI anyway (e2e-no-ai-copy)
//
// A nudge he waves off twice does not come back on that job. A kind of nudge he
// waves off twice on two different jobs stops being offered at all, through
// `timLearn` in js/tim-knowledge.js, which is the same n:1 rule the price book
// uses. He is allowed to teach Tim to shut up.
//
// `timNudges` is pure: hand it a snapshot of the job, get back the line. The one
// impure function is `timJobSnapshot`, which reads the estimate screen.

// How sure the figure is, which changes the wording and nothing else. A rate off
// his own book is stated flat. A rate off a receipt says where it came from.
const TIM_NUDGE_RULES=[
  {
    id:'access-missing',
    kind:'dollar',
    when:s=>s.high&&!s.hasAccess&&s.accessCost>0,
    line:()=>'No scaffold on a second floor job',
    figure:s=>_timMoney(s.accessCost),
    title:s=>_timMoney(s.accessCost),
    what:s=>'Scaffold, '+s.accessDays+' day'+(s.accessDays===1?'':'s')+(s.accessWhere?', '+s.accessWhere:'')+'.',
    why:s=>'You said second floor. There is no scaffold on this job'+
      (s.accessWhen?' and you rented one for '+s.accessWhen+' at this rate':'')+
      '. It adds '+s.accessHours+' hours to set and strike.',
    cta:'Add it to the job',
    alt:'We own one',
  },
  {
    id:'under-book',
    kind:'dollar',
    when:s=>s.under&&s.under.gap>0,
    // Not "You are under your own price on line 3". The pill is the one part
    // of Tim a man reads without having asked for it, often with a customer
    // standing next to him, and a sentence that opens "You are" is a sentence
    // about HIM rather than about the line. Same fact, subject changed to the
    // thing that is actually wrong. The figure does the arguing.
    line:s=>'Line '+s.under.at+' is under your own price',
    figure:s=>_timMoney(s.under.gap),
    title:s=>_timMoney(s.under.gap),
    what:s=>s.under.desc+' is at '+_timMoney(s.under.rate)+'.',
    why:s=>'Your book says '+_timMoney(s.under.bookRate)+' and you have charged that on '+
      s.under.n+' of these. Across this job that is '+_timMoney(s.under.gap)+'.',
    cta:'Take it to your price',
    alt:'Leave it',
  },
  {
    id:'still-owes',
    kind:'dollar',
    when:s=>s.owed>0&&!!s.clientName,
    line:s=>s.clientFirst+' still owes on the last one',
    figure:s=>_timMoney(s.owed),
    title:s=>_timMoney(s.owed),
    what:s=>s.clientName+' has '+_timMoney(s.owed)+' outstanding'+(s.owedDays?', '+s.owedDays+' days now':'')+'.',
    why:()=>'It is your money, sitting in a job you are about to do more work for.',
    cta:'Open what they owe',
    // "Send it anyway" told him he was doing something reckless on the way to
    // doing it. Half the time the reason is that he already knows, and the
    // cheque is in the truck. The way out of a nudge should never carry a
    // judgment about taking it.
    alt:'Not now',
  },
  {
    id:'runs-over',
    kind:'percent',
    when:s=>s.overrun&&s.overrun.n>=3&&s.overrun.pct>=10,
    // "Your last three of these ran over" is a verdict on the man's work.
    // "These take longer than the estimate" is a verdict on the ESTIMATE, which
    // is the thing he is standing in front of and the thing he can change. The
    // fact and the percentage are identical; only the thing being blamed moves.
    line:()=>'These take longer than the estimate',
    figure:s=>s.overrun.pct+'%',
    title:s=>s.overrun.pct+'%',
    what:s=>'The last '+s.overrun.n+' jobs like this took '+s.overrun.pct+' percent longer than the estimate said.',
    why:s=>'Off your own clock, not a guess. On this one that is about '+s.overrun.hours+' more hours.',
    cta:'Put the hours up',
    alt:'Leave it',
  },
  {
    id:'state-frees',
    kind:'law',
    when:s=>s.stateRule==='none'&&s.state&&s.tm&&s.moneyLayers>0,
    line:s=>s.state+' will not make you print a price',
    figure:s=>'saves '+s.moneyLayers*2+' taps',
    title:()=>'Nothing to fill in',
    what:s=>s.state+' does not require a price on a time and materials contract.',
    why:()=>'Get the scope signed and bill the hours as they happen. The money blocks on this page are yours to add, not the state\'s.',
    cta:'Take them off',
    alt:'Keep them',
  },
  {
    id:'state-blocks',
    kind:'law',
    when:s=>s.stateRule==='block'&&s.tm,
    line:s=>s.state+' will not take a time and materials contract',
    figure:()=>'fixed price',
    title:()=>'Wrong contract for this address',
    what:s=>s.stateNote||(s.state+' requires a contract amount in dollars and cents.'),
    why:()=>'Send it as a fixed price and the same scope goes out today.',
    cta:'Switch to fixed price',
    alt:'Read the rule',
  },
];

// Whole dollars, deliberately not `fmt`. A pill in the corner of a phone reads
// "$285", not "$285.00": the cents are two characters of noise on a figure he
// is glancing at, and the design system already says full dollars belong on
// proposals and tax documents, where precision is a legal matter. Nothing here
// is ever the number on a contract.
function _timMoney(n){
  return '$'+Math.round(Number(n)||0).toLocaleString('en-US');
}
function _timStateName(st){
  const k=String(st||'').toUpperCase();
  if(!k)return '';
  return (typeof STATE_NAMES!=='undefined'&&STATE_NAMES[k])||k;
}

// ── The one he sees ──────────────────────────────────────────────────────────
//
// One at a time, worst first. Two pills is a list, and a list is something to
// deal with later. Money outranks a percentage outranks a law, because a dollar
// he is about to lose is the only one of the three that moves a man mid-task.
const _TIM_NUDGE_WEIGHT={dollar:3,percent:2,law:1};
function timNudges(snap){
  const s=snap||{};
  const off=new Set(Array.isArray(s.dismissed)?s.dismissed:[]);
  const out=[];
  TIM_NUDGE_RULES.forEach(r=>{
    if(off.has(r.id))return;
    if(typeof timDropped==='function'&&timDropped('nudge',r.id))return;
    let hit=false;
    try{hit=!!r.when(s);}catch(_e){hit=false;}
    if(!hit)return;
    const say=(f,d)=>{try{return f?String(f(s)):(d||'');}catch(_e){return d||'';}};
    const line=say(r.line),figure=say(r.figure);
    // The gate, enforced here rather than trusted to each rule: no figure, no
    // pill. A rule that cannot fill this in does not get to interrupt him.
    if(!line||!figure)return;
    out.push({
      id:r.id,kind:r.kind,line,figure,
      title:say(r.title,figure),
      what:say(r.what),
      why:say(r.why),
      cta:r.cta,alt:r.alt,
      weight:_TIM_NUDGE_WEIGHT[r.kind]||0,
      amount:Number(s._amounts&&s._amounts[r.id])||0,
    });
  });
  out.sort((a,b)=>(b.weight-a.weight)||(b.amount-a.amount));
  return out;
}
// The single line on the dock, or nothing at all.
function timTopNudge(snap){const n=timNudges(snap);return n.length?n[0]:null;}

// ── Waved off ────────────────────────────────────────────────────────────────
//
// Two levels, and they are different promises. Per job: he looked, it does not
// apply here, do not ask again on this proposal. Forever: he has now told Tim
// twice on two jobs that this kind of find is not worth a pill, so it stops.
let _timDismissed={};
function timDismiss(jobKey,id){
  const k=String(jobKey||'_');
  const seen=_timDismissed[k]||(_timDismissed[k]=[]);
  if(seen.indexOf(id)<0)seen.push(id);
  if(typeof timLearn==='function')timLearn('nudge',id,false);
  return seen;
}
function timAccepted(id){if(typeof timLearn==='function')timLearn('nudge',id,true);}
function timDismissedOn(jobKey){return (_timDismissed[String(jobKey||'_')]||[]).slice();}
function timResetDismissals(){_timDismissed={};}

// ── Reading the screen ───────────────────────────────────────────────────────
//
// The one impure function. Everything it touches already existed: the state
// rule off the job address, the price book, the scope hours off his own clock,
// what the client still owes. Tim picks which of them to say out loud, he does
// not compute any of them a second time (rule 18, one definition many mouths).
function timJobSnapshot(){
  const s={dismissed:[],_amounts:{}};
  try{
    const rule=(typeof _tmStateRule==='function')?_tmStateRule():{rule:'none',state:''};
    // Kansas, not KS. He reads the sentence, he does not decode a form field.
    s.state=_timStateName(rule.state);
    s.stateRule=rule.rule||'none';
    s.stateNote=rule.note||'';
    s.tm=(typeof _geiIsTM!=='undefined')&&!!_geiIsTM;
    s.moneyLayers=(typeof _tmLayers!=='undefined'&&_tmLayers&&_tmLayers.size)
      ?['rate','est','mat','dep','cap'].filter(k=>_tmLayers.has(k)).length:0;

    // Does the work reach past a ladder, and is anything standing under it.
    const scope=(typeof _geiScopeChips!=='undefined'&&Array.isArray(_geiScopeChips))?_geiScopeChips.join(' '):'';
    const notes=[scope,(document.getElementById('gei-desc')||{}).value||'',
      (typeof _geiSiteAddr==='function'?_geiSiteAddr():'')].join(' ');
    s.high=(typeof _timSaysHigh==='function')?_timSaysHigh(notes):false;
    s.hasAccess=/scaffold|staging|lift/i.test(notes);
    const acc=_timAccessRate();
    s.accessDays=Math.max(1,Math.ceil(((typeof _estLaborHours==='function'?_estLaborHours():0)||8)/8));
    s.accessCost=Math.round(acc.rate*s.accessDays);
    s.accessWhen=acc.when;
    s.accessWhere=_timElevation(notes);
    s.accessHours=6;
    s._amounts['access-missing']=s.accessCost;

    s.under=_timUnderBook();
    if(s.under)s._amounts['under-book']=s.under.gap;

    const owed=_timOwedByClient();
    s.owed=owed.amount;s.clientName=owed.name;s.clientFirst=(owed.name||'').split(' ')[0]||owed.name;
    s.owedDays=owed.days;
    s._amounts['still-owes']=owed.amount;

    s.overrun=_timOverrun();
    s.dismissed=timDismissedOn(_timJobKey());
  }catch(_e){}
  return s;
}
function _timJobKey(){
  try{
    if(typeof _geiBidId!=='undefined'&&_geiBidId)return 'bid:'+_geiBidId;
    if(typeof currentClientId!=='undefined'&&currentClientId)return 'client:'+currentClientId;
  }catch(_e){}
  return '_';
}
// What a day of access equipment costs him, from his own book first and the
// yard ticket he actually paid second. No figure from either means no nudge,
// because a made up rental rate is exactly the kind of number that ends this.
function _timAccessRate(){
  try{
    if(typeof _pbFind==='function'){
      const hit=_pbFind('Scaffold');
      if(hit&&Number(hit.rate)>0)return {rate:Number(hit.rate),when:null};
    }
    const ex=(typeof expenses!=='undefined'&&Array.isArray(expenses))?expenses:[];
    const rent=ex.filter(e=>e&&/scaffold|staging|lift/i.test(String(e.vendor||'')+' '+String(e.note||'')))
      .sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')))[0];
    if(rent&&Number(rent.amount)>0){
      const d=rent.date?new Date(rent.date):null;
      return {rate:Math.round(Number(rent.amount)/3),
        when:(d&&!isNaN(d))?('the '+(d.toLocaleDateString('en-US',{month:'long'}))+' job'):null};
    }
  }catch(_e){}
  return {rate:0,when:null};
}
function _timElevation(text){
  const m=String(text||'').match(/\b(north|south|east|west)\b/i);
  return m?(m[1].toLowerCase()+' elevation'):'';
}
// The line where he is charging less than he charges. His own book is the
// authority, which is why this is a fact and not an opinion.
function _timUnderBook(){
  try{
    if(typeof _geiLines==='undefined'||!Array.isArray(_geiLines))return null;
    let worst=null;
    _geiLines.forEach((l,i)=>{
      if(!l||l._tmLabor)return;
      const hit=(typeof _pbFind==='function')?_pbFind(l.desc):null;
      if(!hit||!(Number(hit.rate)>0)||(hit.n||1)<2)return;
      const rate=Number(l.rate)||0;
      if(rate<=0||rate>=Number(hit.rate))return;
      const qty=Number(l.qty)||1;
      const gap=Math.round((Number(hit.rate)-rate)*qty);
      if(gap<25)return;   // a rounding difference is not a find
      if(!worst||gap>worst.gap)worst={at:i+1,desc:l.desc,rate,bookRate:Number(hit.rate),n:hit.n||2,gap};
    });
    return worst;
  }catch(_e){return null;}
}
// WHAT THIS CUSTOMER STILL OWES, READ THE WAY THE COLLECT PAGE READS IT.
//
// This was wrong from the day it shipped and no test caught it, which is worth
// recording rather than quietly fixing. It filtered on `b.clientId` and
// `b.status==='invoiced'`. The app uses `b.client_id` (58 places against 2),
// and 'invoiced' is not a bid status anywhere in this codebase: the statuses
// are Closed Won, Pending, Closed Lost, Draft, Abandoned. So the filter matched
// nothing, `amount` was always 0, and the still-owes nudge could never fire on
// real data, on any job, ever.
//
// It passed CI because e2e-tim-nudge hands timNudges() a hand-built snapshot
// with `owed: 1240` already in it. That tests the ranking, which is fine and
// still what those tests are for, but it never runs the code that reads the
// database. The seam between them had no test at all, so a field name that
// matched nothing looked exactly like a customer who happened to be paid up.
//
// The rule now: this reads bids the way renderMoneyPage does (js/finance.js),
// because that page IS the definition of what he is owed, and two different
// answers to "what does Dana owe me" on two screens is worse than none.
function _timOwedByClient(){
  const out={amount:0,name:'',days:0};
  try{
    const id=(typeof currentClientId!=='undefined')?currentClientId:null;
    if(!id)return out;
    const c=(typeof getClientById==='function')?getClientById(id):null;
    out.name=(c&&c.name)||'';
    const rows=(typeof bids!=='undefined'&&Array.isArray(bids))?bids:[];
    let oldest=null;
    rows.forEach(b=>{
      if(!b||b.client_id!==id||b.status!=='Closed Won')return;
      const bal=(typeof getBidBalance==='function')?getBidBalance(b):0;
      if(bal<=0.01)return;
      out.amount+=bal;
      // Money is owed from the day the work finished, not the day the proposal
      // was written, which is the same clock the Collect page counts on.
      const d=b.completion_date||b.date;
      if(d&&(!oldest||String(d)<String(oldest)))oldest=d;
    });
    if(oldest){
      const ms=Date.now()-new Date(String(oldest)+'T12:00').getTime();
      out.days=Math.max(0,Math.round(ms/86400000));
    }
  }catch(_e){}
  return out;
}
// A pattern out of his own clock, not advice. Needs three finished jobs of this
// kind before it says anything, because two is a coincidence.
function _timOverrun(){
  try{
    const h=(typeof S!=='undefined'&&S.scopeHistory)||{};
    let est=0,act=0,n=0;
    Object.keys(h).forEach(k=>{
      (Array.isArray(h[k])?h[k]:[]).forEach(row=>{
        if(!row||!(row.hrs>0)||!(row.estHrs>0))return;
        est+=row.estHrs;act+=row.hrs;n++;
      });
    });
    if(n<3||est<=0)return null;
    const pct=Math.round(((act-est)/est)*100);
    if(pct<=0)return null;
    const here=(typeof _estLaborHours==='function')?_estLaborHours():0;
    return {n,pct,hours:Math.round(here*pct/100)};
  }catch(_e){return null;}
}
