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
  // ── The three that work anywhere ──────────────────────────────────────────
  //
  // Everything above this reads the open estimate, which is why he was silent
  // on every other screen in the app. These read the books, so they fire on
  // Home, on Collect, in the truck, with nothing on screen at all.
  //
  // All three name a customer. "You have $4,500 out" is a fact about a spread-
  // sheet; "Rick Delaney has been sitting 68 days" is a fact about a man with a
  // phone number, and only one of those gets a call made.
  {
    id:'books-late',
    kind:'dollar',
    // Never alongside still-owes. That one is about the customer whose job is
    // on screen right now, and saying both would be the app telling him about
    // the same money twice in two different voices.
    when:s=>!!s.books&&s.books.late.amount>=_TIM_BOOK_FLOOR&&!(s.owed>0&&s.clientName),
    line:s=>s.books.late.who+' has been waiting '+s.books.late.days+' days',
    figure:s=>_timMoney(s.books.late.amount),
    title:s=>_timMoney(s.books.late.amount),
    what:s=>_timMoney(s.books.late.amount)+' across '+s.books.late.jobs+
      ' job'+(s.books.late.jobs===1?'':'s')+' finished and not paid for'+
      (s.books.late.others?(', and '+s.books.late.others+' other customer'+
        (s.books.late.others===1?'':'s')+' past thirty days'):'')+'.',
    // Thirty is the same threshold _calcFinanceCharge uses, so the nudge and
    // the finance charge agree about when late begins.
    why:s=>'Past thirty days is where money starts going bad. You have '+
      _timMoney(s.books.owedTotal)+' out in total.',
    cta:'Open Collect',
    alt:'I know',
  },
  {
    id:'books-fresh',
    kind:'dollar',
    // The other side of the same split. Not late yet, which is exactly why it
    // is worth saying: this is the week the money is easiest to collect.
    when:s=>!!s.books&&s.books.fresh.amount>=_TIM_BOOK_FLOOR&&!(s.owed>0&&s.clientName),
    line:s=>s.books.fresh.who+' finished and has not paid',
    figure:s=>_timMoney(s.books.fresh.amount),
    title:s=>_timMoney(s.books.fresh.amount),
    what:s=>_timMoney(s.books.fresh.amount)+' on '+s.books.fresh.jobs+
      ' job'+(s.books.fresh.jobs===1?'':'s')+
      (s.books.fresh.days?(', done '+s.books.fresh.days+' day'+(s.books.fresh.days===1?'':'s')+' ago'):'')+'.',
    why:()=>'The work is still fresh in their head. This is the cheapest week it will ever be to collect.',
    cta:'Open Collect',
    alt:'I know',
  },
  {
    id:'bid-cold',
    kind:'dollar',
    when:s=>!!s.books&&s.books.cold.amount>=_TIM_BOOK_FLOOR,
    line:s=>s.books.cold.who+' never answered on the quote',
    figure:s=>_timMoney(s.books.cold.amount),
    title:s=>_timMoney(s.books.cold.amount),
    what:s=>_timMoney(s.books.cold.amount)+' quoted '+s.books.cold.days+
      ' days ago, still not won and still not lost.',
    why:()=>'Nobody has said no. It is a phone call, not a new bid.',
    cta:'Open what is out',
    alt:'It is dead',
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
// A second key, under the kind and above the amount, because the amount alone
// gets the order wrong now that he can see the books. A $3,300 quote nobody
// answered is a bigger number than $2,000 that is sixty-eight days late, and it
// is not the more urgent sentence: one is money he might earn, the other is
// money he HAS earned and is watching go bad.
//   3  what is on the screen right now. A man standing in an estimate wants to
//      hear about the estimate; the books will still be there in a minute.
//   2  earned and late.
//   1  earned and collectible.
//   0  not earned yet.
// A nudge about the open job and a nudge about the books are waved off in two
// different ways, and treating them the same is most of why "take them off" did
// not take them off.
//   job   'not on THIS proposal'. Dismissed against the job, back on the next
//         one, which is right: a missing scaffold is a fact about one job.
//   books 'I know'. There is only one set of books, so dismissing against a job
//         means it reappears the moment he opens another, or navigates, or the
//         bid gets an id. Dismissed globally instead, and it comes back when
//         the FIGURE changes, because "I know Rick owes me $2,000" is not a
//         promise to never want telling that he now owes $4,400.
const _TIM_NUDGE_SCOPE={'books-late':'books','books-fresh':'books','bid-cold':'books'};
const _TIM_NUDGE_RANK={
  'access-missing':3,'under-book':3,'still-owes':3,'runs-over':3,
  'books-late':2,'books-fresh':1,'bid-cold':0,
};
function timNudges(snap){
  const s=snap||{};
  const off=new Set(Array.isArray(s.dismissed)?s.dismissed:[]);
  const out=[];
  TIM_NUDGE_RULES.forEach(r=>{
    if(_TIM_NUDGE_SCOPE[r.id]==='books'){
      // Waved off, and still worth what it was worth when it was waved off.
      if(_timBookOff(r.id)===_timBookSig(s,r.id))return;
    }else if(off.has(r.id))return;
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
      rank:_TIM_NUDGE_RANK[r.id]||0,
      amount:Number(s._amounts&&s._amounts[r.id])||0,
    });
  });
  out.sort((a,b)=>(b.weight-a.weight)||(b.rank-a.rank)||(b.amount-a.amount));
  return out;
}
// The single line on the dock, or nothing at all.
function timTopNudge(snap){const n=timNudges(snap);return n.length?n[0]:null;}

// ── Waved off ────────────────────────────────────────────────────────────────
//
// Two levels, and they are different promises. Per job: he looked, it does not
// apply here, do not ask again on this proposal. Forever: he has now told Tim
// twice on two jobs that this kind of find is not worth a pill, so it stops.
// ── AND THEY HAVE TO SURVIVE THE THING THAT DISMISSED THEM ──────────────────
// Owner, 2026-09-21, on the T&M screen: "Tim's insights with take them off
// don't even remove it."
// They were in memory only, so a reload brought every one of them back, and a
// reload is what happens when he closes the app on a driveway.
const _TIM_OFF_KEY='td_tim_off';
let _timDismissed={},_timDismissedBooks={};
(function(){
  try{
    const r=JSON.parse(localStorage.getItem(_TIM_OFF_KEY));
    if(r&&typeof r==='object'){
      _timDismissed=(r.job&&typeof r.job==='object')?r.job:{};
      _timDismissedBooks=(r.books&&typeof r.books==='object')?r.books:{};
    }
  }catch(_e){}
})();
function _timOffWrite(){
  try{localStorage.setItem(_TIM_OFF_KEY,
    JSON.stringify({job:_timDismissed,books:_timDismissedBooks}));}catch(_e){}
}
// What a book finding is worth right now. The same string is stored when it is
// waved off, so the rule stays quiet until the money moves and then speaks
// again on its own.
function _timBookSig(s,id){
  try{return String((s&&s._amounts&&s._amounts[id])||0);}catch(_e){return '0';}
}
function _timBookOff(id){
  return Object.prototype.hasOwnProperty.call(_timDismissedBooks,id)?_timDismissedBooks[id]:null;
}
function timDismiss(jobKey,id,sig){
  if(_TIM_NUDGE_SCOPE[id]==='books'){
    // The caller MAY hand over the figure, and should, because reading it off
    // the same snapshot the nudge was built from cannot disagree with it. But a
    // caller that does not is not allowed to silently fail: an empty signature
    // matches nothing, so the rule would come back on the very next render and
    // "take them off" would once again not take it off. Work it out here when
    // it is not given.
    if(sig==null){
      try{sig=_timBookSig(timJobSnapshot(),id);}catch(_e){sig='0';}
    }
    _timDismissedBooks[id]=String(sig);
    _timOffWrite();
    // NOT taught to timLearn. Two waves of "I know" about late money is a man
    // who knows about his late money, not a man saying the whole idea was bad,
    // and dropping the rule forever on that is the app mistaking agreement for
    // rejection.
    return [id];
  }
  const k=String(jobKey||'_');
  const seen=_timDismissed[k]||(_timDismissed[k]=[]);
  if(seen.indexOf(id)<0)seen.push(id);
  _timOffWrite();
  if(typeof timLearn==='function')timLearn('nudge',id,false);
  return seen;
}
function timAccepted(id){if(typeof timLearn==='function')timLearn('nudge',id,true);}
// The union with '_' is the other half of the owner's report. _timJobKey is
// 'bid:'+_geiBidId once a proposal has been autosaved and '_' before it has, so
// a nudge waved off while building a NEW T&M came straight back the moment the
// first autosave handed the bid an id. Same proposal, same man, new key.
function timDismissedOn(jobKey){
  const k=String(jobKey||'_');
  const a=_timDismissed[k]||[],b=(k==='_')?[]:(_timDismissed['_']||[]);
  return [...new Set([...a,...b])];
}
function timResetDismissals(){_timDismissed={};_timDismissedBooks={};_timOffWrite();}

// ── Reading the screen ───────────────────────────────────────────────────────
//
// The one impure function. Everything it touches already existed: the state
// rule off the job address, the price book, the scope hours off his own clock,
// what the client still owes. Tim picks which of them to say out loud, he does
// not compute any of them a second time (rule 18, one definition many mouths).
function timJobSnapshot(){
  const s={dismissed:[],_amounts:{}};
  // ── THE BOOKS, READ FIRST AND IN THEIR OWN TRY ──────────────────────────────
  //
  // Owner, 2026-09-21: "I want people to use this thing."
  //
  // He could not be used, because on every screen but the estimate builder he
  // had nothing to say. Five of the six rules above read the OPEN ESTIMATE off
  // the DOM (s.high, s.under, s.overrun, s.stateRule) and the sixth needs
  // currentClientId. Probed with a real book on 2026-09-21: a customer nine
  // weeks late on $2,000 sitting in `bids`, and zero findings on Home, Clients,
  // Jobs, Collect, Leads and Books. The badge never lit, so the bubble never
  // spoke, so there was never a reason to tap him anywhere a man actually sits.
  // ServiceTitan's 2026 trades survey puts administration at the top of what
  // contractors use AI for, 59%, and administration is not in the estimator.
  //
  // Its own try/catch, and FIRST, for a specific reason: everything below reads
  // the estimate screen, and a throw down there used to take the whole snapshot
  // with it. The books are the half that works on every screen, so they must
  // not be able to be killed by the half that only works on one.
  // FIRST, and outside every try below it. This used to be the LAST line of the
  // big try, after a dozen DOM reads, so anything in there throwing left
  // s.dismissed as [] and silently un-dismissed every nudge on the screen. It
  // reads two globals and cannot throw on its own; it had no business being
  // downstream of the estimate builder.
  try{s.dismissed=timDismissedOn(_timJobKey());}catch(_e){s.dismissed=[];}
  try{s.books=_timBooks();}catch(_e){s.books=null;}
  if(s.books){
    s._amounts['books-late']=s.books.late.amount;
    s._amounts['books-fresh']=s.books.fresh.amount;
    s._amounts['bid-cold']=s.books.cold.amount;
  }
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
  }catch(_e){}
  return s;
}
// ── What the books say, from any screen ──────────────────────────────────────
//
// Pure arithmetic over `bids` and `payments`, which js/data.js already holds in
// memory, so this works on every screen, offline, with nothing fetched.
//
// The owed half goes through timOwedAll (js/tim-ask.js) rather than walking the
// bids again here. That function already reads them exactly the way
// renderMoneyPage does, down to calling todayKey() bare, and rule 18 is one
// definition with many mouths: a nudge that disagreed with the Collect screen
// about what a man is owed would be worse than no nudge, because it would still
// sound certain.
//
// THE FLOOR IS $200 AND IT IS DELIBERATE. Owner's line on what is worth
// interrupting for: money only, over about two hundred dollars. A man on a
// driveway does not want his phone lighting up over $40, and a rule that fires
// on $40 teaches him to stop reading the ones that fire on $4,000.
const _TIM_BOOK_FLOOR=200;
// Thirty days is where money starts going bad, and it is not a number invented
// here: js/bids.js _calcFinanceCharge starts charging at exactly thirty, so the
// nudge and the finance charge agree about when late begins.
const _TIM_LATE_DAYS=30;
// Two weeks with no answer on a bid. Shorter and he is nagging a customer who
// is still thinking; longer and the job is gone to somebody who followed up.
const _TIM_COLD_DAYS=14;

function _timBooks(){
  const out={
    late:{amount:0,who:'',days:0,jobs:0,others:0},
    fresh:{amount:0,who:'',days:0,jobs:0},
    cold:{amount:0,who:'',days:0},
    owedTotal:0,
  };
  const owed=(typeof timOwedAll==='function')?timOwedAll():[];
  owed.forEach(o=>{
    if(!o||!(o.amount>0))return;
    out.owedTotal+=o.amount;
    // Late and fresh are the same money at two different ages, split at thirty
    // days so they can never both fire on the same customer. `done` is false
    // when nothing on the job has a completion date, and an undated job is not
    // evidence of anything: it is left out of both rather than guessed into one.
    if(!o.done)return;
    const b=o.days>=_TIM_LATE_DAYS?out.late:out.fresh;
    b.amount+=o.amount;
    b.jobs+=(o.jobs||1);
    // timOwedAll sorts oldest first, so the first customer to land in a bucket
    // is the one that has been waiting longest, and that is the one worth
    // naming. A man chasing payment starts with the one going bad, not the big
    // one.
    if(!b.who){b.who=o.name;b.days=o.days;}
    else if(b===out.late)out.late.others++;
  });

  // A bid that is out and has gone quiet. Not a loss and not a win: the one
  // that is still worth a phone call.
  try{
    const rows=(typeof bids!=='undefined'&&Array.isArray(bids))?bids:[];
    const today=todayKey();
    rows.forEach(b=>{
      if(!b||b.draft)return;
      // Anything not decided. Reading for the two CLOSED statuses rather than
      // for 'Pending' on purpose: a bid parked in some other status is still a
      // bid nobody has answered, and a whitelist here would go quietly blind
      // the day another status is added.
      if(b.status==='Closed Won'||b.status==='Closed Lost')return;
      const amt=Number(b.amount)||0;
      if(amt<_TIM_BOOK_FLOOR)return;
      const d=b.date;
      if(!d)return;
      const days=Math.max(0,Math.floor((new Date(today+'T12:00')-new Date(String(d)+'T12:00'))/86400000));
      if(!(days>=_TIM_COLD_DAYS))return;
      // Oldest first, and the amount breaks a tie, same order as the owed list.
      if(days>out.cold.days||(days===out.cold.days&&amt>out.cold.amount)){
        const c=(typeof getClientById==='function')?getClientById(b.client_id):null;
        out.cold={amount:amt,who:(c&&c.name)||b.client_name||'A customer',days};
      }
    });
  }catch(_e){}
  return out;
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
