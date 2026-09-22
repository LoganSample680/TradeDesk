// ─────────────────────────────────────────────────────────────────────────────
// TIM ANSWERS QUESTIONS ABOUT THE BUSINESS HE IS STANDING IN.
//
// Owner, 2026-09-20, on what training Tim means to him: teach him the trade and
// teach him this business, and have all of it work in the pocket of a
// contractor's beat-up phone. So none of this reaches a network, holds weights,
// or needs a recent handset. Every answer below is arithmetic over the arrays
// js/data.js already keeps in memory:
//
//   clients, bids, jobs, income, expenses, mileage, payments, liens, events,
//   timeEntries, photos, licenses, contracts, agreements, vehicles, places
//
// Tim is already standing in the database. He never needed to reach for it.
//
// ONE RULE ABOVE THE REST: a number Tim says here has to be the same number the
// page that owns it would say. Two answers to "what does Dana owe me" on two
// screens is worse than no answer, because the wrong one still sounds certain.
// So the owed math reads bids exactly the way renderMoneyPage does, prices come
// out of _pbFind, and where this file cannot reuse the app's own computation it
// says so in a comment rather than quietly inventing a second one.
//
// When he cannot answer, he returns null and says so. He does not guess.
// ─────────────────────────────────────────────────────────────────────────────

// ── What he is asked ─────────────────────────────────────────────────────────
// Longest phrase wins, same rule the stage matcher uses, so "who owes me money"
// beats a bare "money" and a man asking about one customer does not get the
// whole ledger.
const TIM_ASKS=[
  {id:'owed', say:[
    'who owes me money','who owes me','what am i owed','who hasnt paid','who has not paid',
    'whats owed','what is owed','money owed','outstanding','who still owes','past due',
    'what am i waiting on','who is late']},
  {id:'charged', say:[
    'what did i charge','what do i charge','what did we charge','how much did i charge',
    'what did i bill','my price for','what do i get for','last time i did']},
  {id:'source', say:[
    'lead source','where do my jobs come from','where do leads come from','which source',
    'best lead source','is it worth it','what is working','where are my jobs coming from',
    'marketing','what pays for itself','close rate']},
  {id:'who', say:[
    'address for','whats the address','phone number for','number for','email for',
    'how do i reach','where does','contact for']},

  // ── The eight added 2026-09-20 ─────────────────────────────────────────────
  // Owner: give him a pile of the things a contractor actually wants, so the
  // training can be judged. Every one of these is answered off arrays already
  // sitting in memory, so every one still works with the phone in airplane
  // mode, which is the promise the whole file is built on.
  //
  // What is NOT here matters as much. There is no "how am I doing", no "what
  // should I charge for a bathroom", no "is this a good job": those need an
  // opinion or a market, and he has neither. A question he answers by guessing
  // is worse than a question he declines, because the guess gets believed once.
  {id:'made', say:[
    'how much did i make','how much have i made','what did i make','what did i gross',
    'my revenue','how much did i bring in','how much have i brought in','what did i take in',
    'how much money did i make','my income this year','what did i earn']},
  {id:'spent', say:[
    'what did i spend','how much did i spend','what have i spent','my expenses',
    'how much have i spent','what did i spend on','where is my money going',
    'what am i spending','my costs this year']},
  {id:'out', say:[
    'whats out right now','what is out right now','what have i got out','open bids',
    'whats pending','what is pending','what am i waiting to hear on','whats still open',
    'what bids are open','what have i quoted','what is out there']},
  {id:'winrate', say:[
    'how many did i win','how many did i lose','win rate','how many jobs did i win',
    'how many bids did i win','am i winning','how many have i won','what am i closing']},
  {id:'best', say:[
    'best customer','who is my best customer','biggest customer','who gives me the most work',
    'who spends the most','my best client','top customer','who is worth the most']},
  {id:'miles', say:[
    'how many miles','my mileage','miles this year','how many miles did i drive',
    'whats my mileage','what is my mileage','miles driven','my miles']},
  {id:'hours', say:[
    'how many hours','hours this week','how many hours did i work','hours worked',
    'how many hours have i put in','my hours this week','how long have i worked',
    'my hours','total my hours','total up my hours','add up my hours','hours last week',
    'hours for the week','how much did we work','how many hours did we work',
    'hours by person','hours per person','who worked','who worked this week',
    'who worked last week','crew hours','my time this week','time worked']},
  // ── The three added 2026-09-21 ────────────────────────────────────────────
  // Owner: "give me a breakdown of my last week by person and total up my
  // hours, need their address so I can wrap up invoicing ... for john, one huge
  // thing is ending the hours it takes for him to do paperwork."
  //
  // `sheet` is deliberately its own family rather than a flag on `hours`. They
  // are different questions: hours is "how much did we work", sheet is "what do
  // I bill and to whom", and the second one pivots on the job site and comes
  // with a block of text to paste. Phrased the way the work is talked about on
  // a Friday afternoon, not the way a menu is labelled.
  {id:'sheet', say:[
    'breakdown of my week','breakdown of last week','break down my week',
    'breakdown by person','breakdown of my last week','give me a breakdown',
    'wrap up invoicing','wrap up my invoicing','ready to invoice','what do i invoice',
    'what can i invoice','who do i bill','what do i bill','time by address',
    'hours by address','hours by job','who worked where','where did we work',
    'my timesheet','the timesheet','timesheet for','billing summary','what do i charge for the week',
    'what needs invoiced','what needs to be invoiced','invoice worksheet']},
  // Small, and the one that makes every window above checkable. An assistant
  // that says "last week" but cannot say what day it is has not earned the word.
  {id:'clock', say:[
    'what time is it','whats the time','what is the time','time right now',
    'what day is it','what is today','whats today','todays date','whats the date',
    'what is the date','what day is today','what is it today']},
  // ── The one a man actually opens with ─────────────────────────────────────
  // Owner typed "What's Going On Tim?" into the box and got a miss. It is the
  // most natural thing to say to somebody you just opened, and he had no answer
  // for it, which made him look stupid on the most forgiving question there is.
  // It is not small talk either: it means "tell me where I stand", and every
  // number needed to answer it is already computed by the families below.
  {id:'brief', say:[
    'whats going on','what is going on','how are we doing','how am i doing',
    'where do i stand','give me the rundown','whats up','what should i know',
    'catch me up','how is business','hows business','state of things','brief me',
    'whats the damage','sum it up','where are we at']},
  {id:'avg', say:[
    'average job','whats my average job','average ticket','my average job size',
    'what is my average job','average job size','typical job']},
];

function timAskKind(text){
  const t=_timkNorm(text);
  let best=null;
  TIM_ASKS.forEach(a=>a.say.forEach(p=>{
    if(t.indexOf(' '+p)<0&&t.indexOf(p+' ')<0&&t.indexOf(p)<0)return;
    if(!best||p.length>best.phrase.length)best={id:a.id,phrase:p};
  }));
  return best;
}

// ── Money out the door ───────────────────────────────────────────────────────
// Reads bids the way js/finance.js renderMoneyPage reads them, because that
// page is the definition of what he is owed: status Closed Won, a balance over
// a cent, and the clock running from the day the work finished. Anything else
// here would be a second opinion about his own money.
function timOwedAll(){
  const out=[];
  try{
    const rows=(typeof bids!=='undefined'&&Array.isArray(bids))?bids:[];
    // todayKey(), bare and with no fallback, exactly as renderMoneyPage calls
    // it. The fallback that was here sliced toISOString(), which is UTC: after
    // 7pm Central that returns TOMORROW, so every evening this would have said
    // a customer was a day later paying than he was. A guard test in
    // e2e-utils-exhaustive forbids the pattern outright, and it is right to.
    const today=todayKey();
    const by={};
    rows.forEach(b=>{
      if(!b||b.status!=='Closed Won')return;
      const bal=(typeof getBidBalance==='function')?getBidBalance(b):0;
      if(bal<=0.01)return;
      const c=(typeof getClientById==='function')?getClientById(b.client_id):null;
      const key=b.client_id||('_'+(c&&c.name));
      const days=b.completion_date
        ? Math.max(0,Math.floor((new Date(today+'T12:00')-new Date(b.completion_date+'T12:00'))/86400000))
        : 0;
      const e=by[key]||(by[key]={name:(c&&c.name)||'Someone',amount:0,days:0,jobs:0,done:!!b.completion_date});
      e.amount+=bal;
      e.jobs+=1;
      if(days>e.days)e.days=days;
      if(b.completion_date)e.done=true;
    });
    Object.keys(by).forEach(k=>out.push(by[k]));
    // Oldest money first. A man chasing payment starts with the one that has
    // been out longest, not the biggest, because the old one is the one going
    // bad.
    out.sort((a,b)=>b.days-a.days||b.amount-a.amount);
  }catch(_e){}
  return out;
}

// ── What he charged last time ────────────────────────────────────────────────
// His book first, because that is his price at his words. Then the proposals he
// actually sent, because a line he charged once and never filed is still a line
// he charged. Never a going rate, never an average of the trade: this question
// is about HIS number and a made up one is the whole failure.
function timCharged(said){
  const out=[];
  const t=_timkNorm(said);
  try{
    const trade=(typeof _pbTrade==='function')?_pbTrade():null;
    const book=(typeof S!=='undefined'&&S.priceBook&&trade&&Array.isArray(S.priceBook[trade]))
      ? S.priceBook[trade]:[];
    // Words worth matching on: the question minus the asking.
    // typeof, not a bare truthiness check: an undeclared name throws rather
    // than reading as falsy, and this file must survive tim-log.js being absent
    // exactly the way the log panel reports tim-knowledge.js being absent.
    const asked=(typeof _timLogWords==='function')?_timLogWords(said):t.trim().split(' ');
    const score=desc=>{
      const d=_timkNorm(desc);
      return asked.filter(w=>w.length>3&&d.indexOf(w)>=0).length;
    };
    book.forEach(l=>{
      const n=score(l.desc);
      if(n>0)out.push({desc:l.desc,rate:l.rate,unit:l.unit,n:l.n,last:l.last,from:'book',score:n});
    });
    const rows=(typeof bids!=='undefined'&&Array.isArray(bids))?bids:[];
    rows.forEach(b=>{
      if(!b||!Array.isArray(b.byoItems))return;
      b.byoItems.forEach(it=>{
        if(!it||!it.label)return;
        const n=score(it.label);
        if(!n)return;
        // A line already in the book is the book's, not a second entry.
        if(out.some(o=>_timkNorm(o.desc).trim()===_timkNorm(it.label).trim()))return;
        const c=(typeof getClientById==='function')?getClientById(b.client_id):null;
        out.push({desc:it.label,rate:it.price,unit:it.unit,from:'sent',score:n,
          who:(c&&c.name)||'',when:b.date||''});
      });
    });
    out.sort((a,b)=>b.score-a.score||(Number(b.n)||0)-(Number(a.n)||0));
  }catch(_e){}
  return out.slice(0,6);
}

// ── Which lead source actually pays ──────────────────────────────────────────
// The question a contractor almost never gets a straight answer to, and the one
// his own data can answer outright. Leads come off the client record, won and
// lost come off the bids, and what he SPENT comes off the marketing expenses
// that js/dashboard.js already totals by channel.
//
// Cost per won job is the figure that ends arguments, so it is the one the
// answer leads with when the spend is there to compute it. A source with spend
// and no wins is reported as exactly that, not hidden: that is the finding.
function timBySource(){
  const out=[];
  try{
    const cs=(typeof clients!=='undefined'&&Array.isArray(clients))?clients:[];
    const rows=(typeof bids!=='undefined'&&Array.isArray(bids))?bids:[];
    const ex=(typeof expenses!=='undefined'&&Array.isArray(expenses))?expenses:[];

    const spend={};
    ex.forEach(e=>{
      if(!e||e.cat!=='marketing'||!e.lead_source)return;
      spend[e.lead_source]=(spend[e.lead_source]||0)+(Number(e.amount)||0);
    });

    const by={};
    const seat=s=>by[s]||(by[s]={source:s,leads:0,won:0,lost:0,open:0,revenue:0,spend:spend[s]||0});
    cs.forEach(c=>{
      const s=(c&&(c.source||c.leadSource)||'').trim();
      if(!s)return;
      const e=seat(s);
      e.leads+=1;
      rows.forEach(b=>{
        if(!b||b.client_id!==c.id)return;
        if(b.status==='Closed Won'){e.won+=1;e.revenue+=Number(b.amount)||0;}
        else if(b.status==='Closed Lost')e.lost+=1;
        else if(b.status==='Pending')e.open+=1;
      });
    });
    // A channel he paid for and never tagged a client to still has to show up,
    // or the money he is burning is the one thing the report hides.
    Object.keys(spend).forEach(s=>seat(s));

    Object.keys(by).forEach(k=>{
      const e=by[k];
      const decided=e.won+e.lost;
      e.close=decided?Math.round(e.won/decided*100):null;
      e.perWon=(e.spend>0&&e.won>0)?Math.round(e.spend/e.won):null;
      out.push(e);
    });
    // Most revenue first, then most leads, so the one paying the bills is the
    // one he reads first.
    out.sort((a,b)=>b.revenue-a.revenue||b.won-a.won||b.leads-a.leads);
  }catch(_e){}
  return out;
}

// ── The answers, in his words ────────────────────────────────────────────────

function _timAskMoney(n){
  return (typeof timPrice==='function')?timPrice(n):('$'+Math.round(Number(n)||0).toLocaleString());
}

function _timAskDays(d){
  if(!d)return 'not finished yet';
  if(d===1)return '1 day out';
  return d+' days out';
}

function _timAnswerOwed(){
  const rows=timOwedAll();
  const total=rows.reduce((s,r)=>s+r.amount,0);
  if(!rows.length){
    return {id:'owed',title:'Nothing out',
      sub:'Every finished job is paid up.',rows:[]};
  }
  const old=rows[0];
  return {
    id:'owed',
    title:_timAskMoney(total),
    sub:rows.length===1
      ? old.name+', '+_timAskDays(old.days)
      : 'across '+rows.length+' customers, oldest is '+_timAskDays(old.days),
    rows:rows.map(r=>({
      lead:r.name,
      right:_timAskMoney(r.amount),
      note:(r.jobs>1?(r.jobs+' jobs, '):'')+(r.done?_timAskDays(r.days):'not finished yet'),
    })),
    go:{label:'Open Collect',fn:"goPg('pg-money')"},
  };
}

function _timAnswerCharged(said){
  const hits=timCharged(said);
  if(!hits.length)return null;
  const top=hits[0];
  return {
    id:'charged',
    title:_timAskMoney(top.rate)+(top.unit&&top.unit!=='lot'?(' / '+top.unit):''),
    sub:top.from==='book'
      ? top.desc+(top.n?(', your price off the last '+top.n):'')
      : top.desc+(top.who?(', '+top.who):''),
    rows:hits.slice(1).map(h=>({
      lead:h.desc,
      right:_timAskMoney(h.rate)+(h.unit&&h.unit!=='lot'?(' / '+h.unit):''),
      note:h.from==='book'?('in your book'+(h.n?(', '+h.n+' of them'):'')):('sent to '+(h.who||'a customer')),
    })),
  };
}

function _timAnswerSource(){
  const rows=timBySource();
  if(!rows.length){
    return {id:'source',title:'No sources tagged yet',
      sub:'Put a source on a customer and this fills in on its own.',rows:[]};
  }
  const best=rows.find(r=>r.won>0)||rows[0];
  const money=rows.reduce((s,r)=>s+r.revenue,0);
  return {
    id:'source',
    title:best.source,
    sub:best.won
      ? (best.won+' won, '+_timAskMoney(best.revenue)
          +(best.perWon!==null?(', '+_timAskMoney(best.perWon)+' a job to get'):''))
      : 'nothing closed off it yet',
    rows:rows.map(r=>({
      lead:r.source,
      right:r.revenue?_timAskMoney(r.revenue):(r.spend?('-'+_timAskMoney(r.spend)):'nothing'),
      note:[
        r.leads?(r.leads+' lead'+(r.leads===1?'':'s')):'no leads',
        r.close!==null?(r.close+'% closed'):null,
        r.perWon!==null?(_timAskMoney(r.perWon)+' a job'):
          (r.spend>0&&!r.won?(_timAskMoney(r.spend)+' spent, nothing won'):null),
      ].filter(Boolean).join(' · '),
    })),
    foot:money?('Everything tagged has brought in '+_timAskMoney(money)):'',
  };
}

function _timAnswerWho(said){
  const c=(typeof spkClient==='function')
    ? spkClient(said,(typeof clients!=='undefined'?clients:[])):null;
  if(!c)return null;
  const rows=[];
  if(c.addr)rows.push({lead:'Where',right:'',note:c.addr});
  if(c.phone)rows.push({lead:'Phone',right:c.phone,note:''});
  if(c.email)rows.push({lead:'Email',right:'',note:c.email});
  const src=(c.source||c.leadSource||'').trim();
  if(src)rows.push({lead:'Came from',right:'',note:src});
  if(!rows.length)return null;
  // What he is still owed belongs on a customer card, because it is the thing
  // he most often opens one to find out.
  const owed=timOwedAll().find(o=>o.name===c.name);
  return {
    id:'who',
    title:c.name,
    sub:owed?(_timAskMoney(owed.amount)+' still out, '+_timAskDays(owed.days)):'Paid up',
    rows,
    // openClientDetail, not openClient. openClient has never existed anywhere in
    // this codebase: the button threw ReferenceError on click and the sheet
    // just sat there, which is the exact shape of the complaint that started
    // all of this ("Tim didn't do shit"). Nothing caught it because the answer
    // tests read the returned object and never clicked the button it describes.
    // The test below now clicks it.
    go:{label:'Open '+(String(c.name).split(' ')[0]||'customer'),
      fn:"openClientDetail("+Number(c.id)+",'clients')"},
  };
}

// ── The one entry point ──────────────────────────────────────────────────────
// Returns an answer, or null when he cannot place the question, which lets
// _timGoRun fall through to the navigator exactly as it does today. Null is a
// real answer here: a wrong figure about his own money is the one mistake this
// file must never make.
// ── Reading a year off a row ─────────────────────────────────────────────────
//
// income rows carry their date as '20260920' when they came in through the
// cloud importer and as '2026-09-20' when a man typed them, and both are in the
// same array. js/finance.js:3693 already handles it by stripping the dashes
// before it compares, and this does the same rather than inventing a third
// opinion. A bare .slice(0,4) reads '2026' out of one and '2026' out of the
// other only by luck of the dash count; strip first and it is not luck.
function _timYr4(d){
  return String(d==null?'':d).replace(/-/g,'').slice(0,4);
}
// The year the QUESTION is about. timWhen already knows "last year", "this
// year" and a bare 2024 because the navigator uses it to re-year the books, so
// asking it here means "how much did I make last year" works without a second
// parser that disagrees with the first one.
function _timAskYear(said){
  let y=null;
  try{if(typeof timWhen==='function')y=timWhen(said);}catch(_e){y=null;}
  if(y)return String(y);
  // Not new Date().getFullYear(): todayKey is the app's own clock and is what
  // every money screen counts against.
  try{if(typeof todayKey==='function')return _timYr4(todayKey());}catch(_e){}
  return String(new Date().getFullYear());
}
// Most expense rows carry catLabel, written by whichever screen logged them.
// The ones that do not carry a bare id like 'marketing', and printing that at
// him is the app showing its own column name. IRS_EXPENSE_CATS is where the
// labels live and is already what the tax screen prints, so there is one
// spelling of "Advertising & marketing" in the product rather than two.
function _timCatLabel(cat){
  const id=String(cat||'').trim();
  if(!id)return '';
  try{
    if(typeof IRS_EXPENSE_CATS!=='undefined'&&Array.isArray(IRS_EXPENSE_CATS)){
      const hit=IRS_EXPENSE_CATS.filter(c=>c&&c.id===id)[0];
      if(hit&&hit.label)return hit.label;
    }
  }catch(_e){}
  return id.charAt(0).toUpperCase()+id.slice(1);
}
// A bid stores client_id; client_name is written by some paths and not others.
// Resolving through clients means a quote never comes back addressed to
// "Customer" just because the row was made by a screen that did not denormalise
// the name onto it.
function _timBidWho(b){
  if(!b)return 'Customer';
  const cs=_timRows('clients');
  const c=cs.filter(x=>x&&String(x.id)===String(b.client_id))[0];
  return (c&&c.name)||b.client_name||b.name||'Customer';
}
// ── WHAT STRETCH OF DAYS HE IS BEING ASKED ABOUT ────────────────────────────
//
// Owner, 2026-09-21: "one thing I want tim to do is know the time, give me a
// breakdown of my last week by person and total up my hours, need their address
// so I can wrap up invoicing".
//
// "Last week" is the trap in that sentence, and this file already flagged it
// once: the old hours answer refused to say "this week" at all, on the grounds
// that a man who starts Sunday and a man who starts Monday mean different days
// by it. Refusing was the wrong fix. The app has ALREADY decided, in the one
// place that counts: _tlWeekKey (js/timelog.js) groups the timesheet, the
// weekly totals and the FLSA overtime line by the Sunday of each week. So
// "last week" here means the same Sunday-to-Saturday the timesheet means, and
// every answer prints the two dates it used, so there is nothing left to guess
// at and nothing for two screens to disagree about.
//
// Everything is measured off todayKey(), bare, for the reason written over
// timOwedAll: it is the app's own clock and it is what every money screen
// counts against. addDays/parseD are js/utils.js, so the arithmetic is the
// app's too rather than a second calendar living in here.
function _timWhen(said){
  const t=_timkNorm(said);
  const today=(typeof todayKey==='function')?todayKey():'';
  const day=s=>{try{return parseD(s).getDay();}catch(_e){return 0;}};
  const back=(s,n)=>{try{return addDays(s,-n);}catch(_e){return s;}};
  const has=p=>t.indexOf(p)>=0;
  if(!today)return null;

  const sunThis=back(today,day(today));           // Sunday of the week we are in
  // `label` is the phrase on its own ("last week"); `in` is the same phrase
  // where a sentence needs a preposition in front of it ("in the last 7 days").
  // Two fields rather than a rule, because English does not have one: it is
  // "in the last 7 days" and "last week", never "in last week".
  const mk=(from,to,label,ind,short)=>({from,to,label,in:ind,short:short||label});

  // Order matters: "last week" contains "week", "yesterday" contains "day".
  // Longest and most specific first, same rule timAskKind uses.
  if(has('last week')||has('past week')||has('previous week')){
    const to=back(sunThis,1);                     // Saturday just gone
    return mk(back(to,6),to,'last week','last week','last wk');
  }
  if(has('this week')||has('current week')||has('week so far')){
    return mk(sunThis,today,'this week','this week','this wk');
  }
  if(has('last 7 days')||has('last seven days')||has('past 7 days')||has('past seven days')){
    return mk(back(today,6),today,'the last 7 days','in the last 7 days','7 days');
  }
  if(has('last 14 days')||has('last two weeks')||has('last 2 weeks')||has('past two weeks')){
    return mk(back(today,13),today,'the last 14 days','in the last 14 days','14 days');
  }
  if(has('last 30 days')||has('past 30 days')||has('last month')){
    // Deliberately 30 DAYS and not the previous calendar month. A man wrapping
    // up invoicing says "last month" meaning "lately"; billing him for the
    // wrong 30 days is the kind of error that reaches a customer.
    return mk(back(today,29),today,'the last 30 days','in the last 30 days','30 days');
  }
  if(has('yesterday')){
    const y=back(today,1);
    return mk(y,y,'yesterday','yesterday','yesterday');
  }
  if(has('today')||has('so far today')){
    return mk(today,today,'today','today','today');
  }
  return null;
}
// The default when he named no stretch at all. Seven days back, because that is
// the window a man means when he says "my hours" with nothing after it, and it
// never straddles a payroll boundary the way a bare calendar month can.
function _timWhenOr7(said){
  const w=_timWhen(said);
  if(w)return w;
  const today=(typeof todayKey==='function')?todayKey():'';
  if(!today)return null;
  let from=today;
  try{from=addDays(today,-6);}catch(_e){}
  return {from,to:today,label:'the last 7 days',in:'in the last 7 days',short:'7 days'};
}
// "Sun Sep 14" — short enough to sit in a subtitle, unambiguous enough to be
// checked against a paper timesheet.
function _timDayLabel(s){
  try{
    const d=parseD(s);
    if(isNaN(d.getTime()))return s;
    return d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
  }catch(_e){return s;}
}
function _timSpanLabel(w){
  if(!w)return '';
  if(w.from===w.to)return _timDayLabel(w.from);
  return _timDayLabel(w.from)+' to '+_timDayLabel(w.to);
}
function _timHrs(min){
  const h=Math.round((Number(min)||0)/6)/10;
  return h+' hr'+(h===1?'':'s');
}

// ── THE WORKSHEET ───────────────────────────────────────────────────────────
//
// One pure function, two pivots, no DOM and no network, so it can be read out
// loud by Tim today and consumed by a button tomorrow. Owner, same day: "I am
// going to want a function that somebody can click to generate a quick invoice
// for work done, even if we dont have a proposal in the system". That button
// needs exactly this: the stretch of days, who worked, how long, and at whose
// address. It is built here rather than inside an answer so there is one
// definition of "what was worked" when it arrives, instead of an invoice that
// quietly disagrees with the timesheet Tim just read out.
//
// WHAT IT CAN AND CANNOT SEE, stated plainly because a short total on an
// invoice is worse than no total:
//   IT SEES  timeEntries, the local array every manual clock in/out lands in,
//            which is the whole of what this phone holds offline.
//   IT DOES NOT SEE  job_time_entries, the GPS arrival/departure rows, which
//            live in Supabase and are fetched by _tlTimeLogRows over the
//            network. Tim does not make network calls, by the promise this
//            file opens with, so the answers say "clocked" and never "worked",
//            and hand off to the Time Log for the full picture.
//
// An open clock (still running) contributes no minutes, exactly as the Time
// Log treats it, but IS reported, because a man reconciling a week wants to
// know somebody is still on the clock before he invoices it.
// ── WHAT AN HOUR ON THIS JOB IS WORTH ────────────────────────────────────────
//
// Owner, 2026-09-22: "we want rate because then Tim can feed a quick invoice."
// That is the whole chain: a T&M bid carries a rate, the crew clocks hours
// against the job, and hours times rate is an invoice. This is the multiplier.
//
// T&M ONLY, and that restriction is the honest part. A fixed-price job's hours
// are not billed by the hour: the customer agreed a number, and multiplying the
// clock by a rate would invent a second one that nobody signed. So a fixed-price
// job comes back 0 and its hours are reported with no money against them, which
// is the truth rather than a guess dressed as a total.
function _timJobRate(jobId){
  try{
    if(jobId==null)return 0;
    const js=_timRows('jobs'),bs=_timRows('bids');
    const j=js.filter(x=>x&&String(x.id)===String(jobId))[0];
    if(!j||!j.bid_id)return 0;
    const b=bs.filter(x=>x&&x.id===j.bid_id)[0];
    if(!b||!b.isTM)return 0;
    // Per man-hour, which is what the T&M screen collects and what a time entry
    // measures: one person's minutes. Crew size is already in the entries.
    return Math.max(0,Number(b.tmRatePerMan)||0);
  }catch(_e){return 0;}
}

function timWorkSheet(win){
  const w=win||_timWhenOr7('');
  const out={win:w,total:0,open:0,entries:0,people:[],sites:[],days:0,
    // What the paid hours come to where there is a rate to come to it at, and
    // the hours that have no rate behind them. Both, always, because a total
    // that quietly leaves out half the week is the one way this costs money.
    billable:0,unratedMin:0};
  if(!w)return out;
  const rows=_timRows('timeEntries').filter(e=>{
    if(!e||!e.date)return false;
    const d=String(e.date);
    return d>=w.from&&d<=w.to;
  });
  if(!rows.length)return out;

  const owner=(()=>{
    try{return (typeof getOwnerName==='function'&&getOwnerName())||'You';}catch(_e){return 'You';}
  })();
  const site=id=>{
    // The job-site address, via the one function that already resolves it
    // (bid.addr, then job.addr, then the client's). Rule 7.3: an invoice that
    // used a different precedence from the job card would bill a property
    // manager at his office for work done on a rental.
    try{
      if(id==null)return {clientName:'General time',addr:'',jobName:''};
      if(typeof _tlJobClientInfo==='function')return _tlJobClientInfo(id);
    }catch(_e){}
    return {clientName:'-',addr:'',jobName:''};
  };

  const byPerson={},bySite={},days={};
  rows.forEach(e=>{
    const mins=(e.open===true)?0:Math.max(0,Number(e.minutes)||0);
    const unpaid=e.unpaid===true;
    const who=e.logged_by_name||owner;
    const uid=e.logged_by_uid||null;
    const info=site(e.job_id);
    // Keyed on the address when there is one, so two jobs at the same property
    // land on one invoice line, and on the customer when there is not.
    const key=(info.addr||('#'+(info.clientName||'-'))).toLowerCase().trim();

    out.entries++;
    if(e.open===true)out.open++;
    // A day only counts as a day WORKED once minutes have landed on it. An
    // open clock contributes nothing yet (same as the Time Log treats it), so
    // a morning where somebody has clocked in and not out would otherwise add
    // a day to the count and no hours to it, and "over 3 days" would be one
    // more day than the total was earned in.
    if(!unpaid&&mins>0){out.total+=mins;days[String(e.date)]=1;}

    const p=byPerson[who]||(byPerson[who]={name:who,uid,min:0,unpaid:0,open:0,days:{},sites:{}});
    const s=bySite[key]||(bySite[key]={client:info.clientName||'-',addr:info.addr||'',
      job:info.jobName&&info.jobName!=='-'?info.jobName:'',
      // Time clocked against no job at all. It is NOT dropped from the
      // worksheet: paid hours that cannot be billed to anybody is the single
      // most useful thing on a Friday, and a total that quietly leaves them
      // out is the invoice looking better than the week was.
      general:e.job_id==null,min:0,people:{},days:{},
      rate:_timJobRate(e.job_id)});
    if(unpaid){p.unpaid+=mins;}
    else if(mins>0){
      p.min+=mins;p.days[String(e.date)]=1;if(info.addr)p.sites[key]=1;
      s.min+=mins;s.days[String(e.date)]=1;s.people[who]=(s.people[who]||0)+mins;
    }
    if(e.open===true){p.open++;}
  });

  out.days=Object.keys(days).length;
  // Money last, off the minutes that survived the unpaid and open filters, so
  // a named lunch break can never be billed to anybody.
  Object.keys(bySite).forEach(k=>{
    const s=bySite[k];
    if(s.rate>0)out.billable+=Math.round((s.min/60)*s.rate);
    else out.unratedMin+=s.min;
  });
  out.people=Object.keys(byPerson).map(k=>{
    const p=byPerson[k];
    return {name:p.name,uid:p.uid,min:p.min,unpaid:p.unpaid,open:p.open,
      days:Object.keys(p.days).length,sites:Object.keys(p.sites).length,
      // FLSA, and ONLY FLSA: over 40 in a calendar week, the one overtime rule
      // that is true in every state. _tlComputeOT says the same thing off the
      // same threshold, and its comment is right that daily OT is state law and
      // asserting it as a default would be wrong for most contractors.
      ot:_timWeekOT(rows,p.name,owner)};
  }).sort((a,b)=>b.min-a.min||a.name.localeCompare(b.name));
  out.sites=Object.keys(bySite).map(k=>{
    const s=bySite[k];
    return {client:s.client,addr:s.addr,job:s.job,min:s.min,general:!!s.general,
      rate:s.rate,amount:s.rate>0?Math.round((s.min/60)*s.rate):0,
      days:Object.keys(s.days).length,
      who:Object.keys(s.people).sort((a,b)=>s.people[b]-s.people[a])};
  }).filter(s=>s.min>0).sort((a,b)=>b.min-a.min);
  return out;
}
// Whether this person crossed 40 paid hours in ANY calendar week the rows
// touch. Weeks are Sunday-keyed through _tlWeekKey, so Tim's overtime flag and
// the timesheet's are the same flag rather than two that agree by luck.
function _timWeekOT(rows,who,owner){
  try{
    if(typeof _tlWeekKey!=='function')return false;
    const byWeek={};
    rows.forEach(e=>{
      if(!e||e.unpaid===true||e.open===true)return;
      if((e.logged_by_name||owner)!==who)return;
      const k=_tlWeekKey(String(e.date||''));
      if(!k)return;
      byWeek[k]=(byWeek[k]||0)+(Number(e.minutes)||0);
    });
    return Object.keys(byWeek).some(k=>byWeek[k]>2400);
  }catch(_e){return false;}
}

function _timRows(name){
  try{
    const a=(typeof window!=='undefined')?window[name]:null;
    return Array.isArray(a)?a:[];
  }catch(_e){return [];}
}
// Money in, counted the way js/finance.js counts it for the books: income rows
// AND payment rows, because a deposit against a bid lands in payments and never
// reaches income. Counting one array would under-report every job that took a
// deposit, which is most of them.
function _timTookIn(yr){
  const rows=[];
  _timRows('income').forEach(r=>{
    if(!r||!r.date||_timYr4(r.date)!==yr)return;
    rows.push({when:r.date,who:r.client_name||'',amount:Number(r.amount)||0,what:r.type||'Income'});
  });
  _timRows('payments').forEach(p=>{
    if(!p||!p.date||!p.amount||_timYr4(p.date)!==yr)return;
    rows.push({when:p.date,who:p.client_name||'',amount:Number(p.amount)||0,
      what:p.amount<0?'Refund':(p.type==='deposit'?'Deposit':p.type==='final'?'Final payment':'Payment')});
  });
  return rows;
}

function _timAnswerMade(said){
  const yr=_timAskYear(said);
  const rows=_timTookIn(yr);
  const total=rows.reduce((s,r)=>s+r.amount,0);
  if(!rows.length){
    return {id:'made',title:'Nothing in '+yr+' yet',
      sub:'No payments and no income rows carry that year.',rows:[]};
  }
  // By month, because "how much did I make" on a phone is really "and when",
  // and twelve rows is the most he can hand over without it becoming a report.
  const by={};
  rows.forEach(r=>{
    const k=_timYr4(r.when)+'-'+String(r.when).replace(/-/g,'').slice(4,6);
    (by[k]||(by[k]={k,amount:0,n:0})).amount+=r.amount;
    by[k].n+=1;
  });
  const months=Object.keys(by).sort().map(k=>by[k]);
  const best=months.slice().sort((a,b)=>b.amount-a.amount)[0];
  const MON=['','January','February','March','April','May','June','July','August',
    'September','October','November','December'];
  const mname=k=>MON[Number(String(k).slice(5,7))||0]||k;
  return {
    id:'made',
    title:_timAskMoney(total),
    sub:'in '+yr+', across '+rows.length+' payment'+(rows.length===1?'':'s')+
      (best?('. Best month was '+mname(best.k)+' at '+_timAskMoney(best.amount)):''),
    rows:months.map(m=>({lead:mname(m.k),right:_timAskMoney(m.amount),
      note:m.n+' payment'+(m.n===1?'':'s')})),
    go:{label:'Open the books',fn:"goPg('pg-tracker')"},
  };
}

function _timAnswerSpent(said){
  const yr=_timAskYear(said);
  const rows=_timRows('expenses').filter(e=>e&&e.date&&_timYr4(e.date)===yr);
  const total=rows.reduce((s,e)=>s+(Number(e.amount)||0),0);
  if(!rows.length){
    return {id:'spent',title:'Nothing logged for '+yr,
      sub:'No expenses carry that year.',rows:[]};
  }
  // If he named a vendor, the question was about that vendor. Matching on the
  // stored name rather than a category, because a man says "Home Depot", not
  // "materials", and the vendor string is what the receipt scanner writes.
  const t=(typeof _timkNorm==='function')?_timkNorm(said):String(said||'').toLowerCase();
  let vendor=null;
  rows.forEach(e=>{
    const v=String(e.vendor||'').trim();
    if(!v)return;
    // The stored vendor is "Sherwin-Williams #7043" and the man says "sherwin
    // williams". Comparing the whole stored string never matches, because he
    // does not say the store number: so walk the vendor's words from the front
    // and take the LONGEST leading run that is actually in his sentence.
    // "Sherwin Williams" matches, "Sherwin Williams 7043" does not, and a bare
    // "Sherwin" is too short to count.
    const words=v.toLowerCase().replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim().split(' ');
    let head='';
    for(let n=words.length;n>0;n--){
      const run=words.slice(0,n).join(' ');
      if(run.length>=5&&t.indexOf(run)>=0){head=run;break;}
    }
    if(!head)return;
    if(!vendor||head.length>vendor.head.length)vendor={name:v,head};
  });
  if(vendor){
    const mine=rows.filter(e=>String(e.vendor||'')===vendor.name);
    const sub=mine.reduce((s,e)=>s+(Number(e.amount)||0),0);
    return {
      id:'spent',
      title:_timAskMoney(sub),
      sub:'at '+vendor.name+' in '+yr+', over '+mine.length+' receipt'+(mine.length===1?'':'s')+
        '. That is '+(total?Math.round(sub/total*100):0)+' percent of everything you spent.',
      rows:mine.slice().sort((a,b)=>(Number(b.amount)||0)-(Number(a.amount)||0)).slice(0,8)
        .map(e=>({lead:String(e.date),right:_timAskMoney(e.amount),note:e.notes||e.catLabel||''})),
      go:{label:'Open expenses',fn:"goPg('pg-taxes')"},
    };
  }
  const by={};
  rows.forEach(e=>{
    const k=e.catLabel||_timCatLabel(e.cat)||'Uncategorised';
    (by[k]||(by[k]={k,amount:0,n:0})).amount+=Number(e.amount)||0;
    by[k].n+=1;
  });
  const cats=Object.keys(by).map(k=>by[k]).sort((a,b)=>b.amount-a.amount);
  return {
    id:'spent',
    title:_timAskMoney(total),
    sub:'in '+yr+', over '+rows.length+' receipt'+(rows.length===1?'':'s')+
      (cats.length?('. Biggest is '+cats[0].k+' at '+_timAskMoney(cats[0].amount)):''),
    rows:cats.map(c=>({lead:c.k,right:_timAskMoney(c.amount),
      note:c.n+' receipt'+(c.n===1?'':'s')})),
    go:{label:'Open expenses',fn:"goPg('pg-taxes')"},
  };
}

function _timAnswerOut(){
  const rows=_timRows('bids').filter(b=>b&&b.status==='Pending');
  const total=rows.reduce((s,b)=>s+(Number(b.amount)||0),0);
  if(!rows.length){
    return {id:'out',title:'Nothing out',
      sub:'No bid is sitting at Pending.',rows:[]};
  }
  // Oldest first. A quote nobody has answered in five weeks is the one he
  // should be chasing, and it is the one the list on the bids page buries.
  const today=(typeof todayKey==='function')?todayKey():'';
  const age=d=>{
    if(!d||!today)return null;
    const a=Date.parse(String(d).length===8
      ? String(d).slice(0,4)+'-'+String(d).slice(4,6)+'-'+String(d).slice(6,8) : d);
    const b=Date.parse(today);
    if(isNaN(a)||isNaN(b))return null;
    return Math.max(0,Math.round((b-a)/86400000));
  };
  const list=rows.map(b=>({name:_timBidWho(b),
    amount:Number(b.amount)||0,days:age(b.date)}))
    .sort((a,b)=>(b.days==null?-1:b.days)-(a.days==null?-1:a.days));
  const oldest=list[0];
  return {
    id:'out',
    title:_timAskMoney(total),
    sub:rows.length+' quote'+(rows.length===1?'':'s')+' waiting on an answer'+
      ((oldest&&oldest.days!=null)?('. Oldest has been out '+oldest.days+' day'+(oldest.days===1?'':'s')):''),
    rows:list.map(r=>({lead:r.name,right:_timAskMoney(r.amount),
      note:r.days==null?'no date on it':('out '+r.days+' day'+(r.days===1?'':'s'))})),
    go:{label:'Open bids',fn:"goPg('pg-leads')"},
  };
}

function _timAnswerWinrate(said){
  const yr=_timAskYear(said);
  const all=_timRows('bids').filter(b=>b&&_timYr4(b.date)===yr);
  const won=all.filter(b=>b.status==='Closed Won');
  const lost=all.filter(b=>b.status==='Closed Lost');
  const decided=won.length+lost.length;
  if(!decided){
    return {id:'winrate',title:'Nothing decided in '+yr,
      sub:'No bid from that year has been won or lost yet.',rows:[]};
  }
  const pct=Math.round(won.length/decided*100);
  const wonMoney=won.reduce((s,b)=>s+(Number(b.amount)||0),0);
  const lostMoney=lost.reduce((s,b)=>s+(Number(b.amount)||0),0);
  return {
    id:'winrate',
    title:pct+'%',
    // The count first and the percentage as the headline, because "eleven of
    // eighteen" is the sentence he would say out loud and 61% is the one he
    // would have to do arithmetic to get back to.
    sub:won.length+' of '+decided+' decided in '+yr+', worth '+_timAskMoney(wonMoney)+
      '. Still open: '+all.filter(b=>b.status==='Pending').length+'.',
    rows:[
      {lead:'Won',right:String(won.length),note:_timAskMoney(wonMoney)},
      {lead:'Lost',right:String(lost.length),note:_timAskMoney(lostMoney)+' walked'},
      {lead:'Still out',right:String(all.filter(b=>b.status==='Pending').length),note:'no answer yet'},
    ],
    go:{label:'Open bids',fn:"goPg('pg-leads')"},
  };
}

function _timAnswerBest(){
  const cs=_timRows('clients');
  const by={};
  _timRows('bids').forEach(b=>{
    if(!b||b.status!=='Closed Won')return;
    const id=b.client_id;
    if(id==null)return;
    (by[id]||(by[id]={id,amount:0,n:0})).amount+=Number(b.amount)||0;
    by[id].n+=1;
  });
  const list=Object.keys(by).map(k=>{
    const e=by[k];
    const c=cs.filter(x=>x&&String(x.id)===String(e.id))[0];
    return {name:(c&&c.name)||'Customer '+e.id,amount:e.amount,n:e.n};
  }).sort((a,b)=>b.amount-a.amount);
  if(!list.length){
    return {id:'best',title:'No won work yet',
      sub:'Nothing is marked Closed Won, so there is nobody to rank.',rows:[]};
  }
  const top=list[0];
  const all=list.reduce((s,r)=>s+r.amount,0);
  return {
    id:'best',
    title:top.name,
    sub:_timAskMoney(top.amount)+' over '+top.n+' job'+(top.n===1?'':'s')+
      (all?(', which is '+Math.round(top.amount/all*100)+' percent of everything you have won'):''),
    rows:list.slice(0,8).map(r=>({lead:r.name,right:_timAskMoney(r.amount),
      note:r.n+' job'+(r.n===1?'':'s')})),
    go:{label:'Open customers',fn:"goPg('pg-clients')"},
  };
}

function _timAnswerMiles(said){
  const yr=_timAskYear(said);
  const rows=_timRows('mileage').filter(m=>m&&m.date&&_timYr4(m.date)===yr);
  const biz=rows.filter(m=>!m.purpose||String(m.purpose).toLowerCase()==='business');
  const miles=biz.reduce((s,m)=>s+(Number(m.miles)||0),0);
  if(!rows.length){
    return {id:'miles',title:'Nothing logged for '+yr,
      sub:'No drive carries that year.',rows:[]};
  }
  const r10=Math.round(miles*10)/10;
  return {
    id:'miles',
    title:r10.toLocaleString('en-US')+' mi',
    // No deduction figure. The IRS rate moves, it is different for the part of
    // the year before a mid-year change, and a number he repeats to an
    // accountant has to come off the tax screen that owns it, not off a man in
    // the corner of the estimate page.
    sub:'business miles in '+yr+', over '+biz.length+' drive'+(biz.length===1?'':'s')+
      (rows.length>biz.length?('. '+(rows.length-biz.length)+' personal not counted'):''),
    rows:[],
    go:{label:'Open mileage',fn:"goPg('pg-taxes')"},
  };
}

// ── What time is it, and what day ────────────────────────────────────────────
// The smallest answer in the file and the one that makes the rest of them
// legible. "Last week" is a claim about a calendar, and a man cannot check a
// claim about a calendar against an assistant that does not know what day it
// is. bizTime/bizTz, never the device clock: the whole timesheet is pinned to
// the business's zone because a phone that lands in Denver must not move a
// shift worked in Topeka (js/timelog.js _tlBizTz), and an assistant reading a
// different clock from the timesheet is the same bug wearing a face.
function _timAnswerClock(){
  const now=new Date();
  const t=(typeof bizTime==='function')?bizTime(now):now.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
  const today=(typeof todayKey==='function')?todayKey():'';
  const zone=(()=>{try{return (typeof bizTz==='function')?bizTz():'';}catch(_e){return '';}})();
  // The city off the IANA name, which is what a man recognises. "America/
  // Chicago" is a database key; "Chicago time" is a sentence. A zone with no
  // region in front of it is not a city (UTC, GMT, a bare offset), so it gets
  // named plainly rather than dressed up as one.
  const named=String(zone).indexOf('/')>0;
  const city=named?String(zone).split('/').pop().replace(/_/g,' '):String(zone);
  const sunThis=(()=>{try{return addDays(today,-parseD(today).getDay());}catch(_e){return '';}})();
  return {
    id:'clock',
    title:t,
    sub:_timDayLabel(today)+(city?(', '+(named?(city+' time'):city)):'')+
      '. That is the clock every hour on your timesheet is stamped in.',
    rows:[
      {lead:'Today',right:_timDayLabel(today),note:today},
      sunThis?{lead:'This week started',right:_timDayLabel(sunThis),
        note:'Sunday, the same week your timesheet and your overtime are counted by'}:null,
      {lead:'Time zone',right:city||'-',note:zone||''},
    ].filter(Boolean),
    foot:'No clock is fetched. This is your phone, read in the business zone.',
  };
}

// ── The hours ────────────────────────────────────────────────────────────────
// Window-aware now. It used to refuse to say "this week" at all and always
// answer for seven days back, which made it wrong half the time it was asked a
// question it had the data for.
function _timAnswerHours(said){
  const w=_timWhenOr7(said);
  const sheet=timWorkSheet(w);
  if(!sheet.total&&!sheet.open){
    return {id:'hours',title:'Nothing clocked',
      sub:'No time entry '+(w?w.in:'lately')+
        (w?(', '+_timSpanLabel(w)):'')+'.',
      rows:[],go:{label:'Open the time log',fn:"goPg('pg-timelog')"}};
  }
  const many=sheet.people.length>1;
  return {
    id:'hours',
    title:_timHrs(sheet.total),
    sub:w.label+', '+_timSpanLabel(w)+'. '+
      sheet.entries+' entr'+(sheet.entries===1?'y':'ies')+
      (many?(' across '+sheet.people.length+' people'):'')+
      (sheet.days?(' over '+sheet.days+' day'+(sheet.days===1?'':'s')):'')+'.'+
      (sheet.open?(' '+sheet.open+' still running, counted as nothing yet.'):''),
    rows:sheet.people.map(p=>({
      lead:p.name+(p.ot?' · OT':''),
      right:_timHrs(p.min),
      note:[p.days+' day'+(p.days===1?'':'s'),
        p.sites?(p.sites+' address'+(p.sites===1?'':'es')):'',
        p.unpaid?(_timHrs(p.unpaid)+' unpaid'):'',
        p.ot?'over 40 in a week':''].filter(Boolean).join(', '),
    })),
    foot:_timClockedFoot(),
    go:{label:'Open the time log',fn:"goPg('pg-timelog')"},
  };
}

// ── The worksheet a man invoices off ─────────────────────────────────────────
// Owner, 2026-09-21: "give me a breakdown of my last week by person and total
// up my hours, need their address so I can wrap up invoicing (or however a
// contractor would ask this question. I know for john, one huge thing is ending
// the hours it takes for him to do paperwork)."
//
// So this is not the hours answer with an address bolted on. The hours answer
// is "how much did we work"; this one is "what do I bill, and to whom". It
// pivots on the JOB SITE, because that is the unit an invoice is written
// against, names who was there and for how long under each, and hands over a
// block of text he can paste straight into one. The Copy is the point: the
// paperwork hours are the thing being ended, and reading a number off a screen
// and typing it somewhere else is the paperwork.
function _timAnswerSheet(said){
  const w=_timWhenOr7(said);
  const sheet=timWorkSheet(w);
  if(!sheet.sites.length){
    return {id:'sheet',title:'Nothing to invoice',
      sub:'No clocked time '+(w?w.in:'lately')+(w?(', '+_timSpanLabel(w)):'')+
        '. Nothing here is a claim about work that was never clocked.',
      rows:[],go:{label:'Open the time log',fn:"goPg('pg-timelog')"}};
  }
  const loose=sheet.sites.filter(s=>s.general).reduce((n,s)=>n+s.min,0);
  const rows=[];
  sheet.sites.forEach(s=>{
    rows.push({
      // MONEY ON THE RIGHT where there is money, hours where there is not. The
      // right-hand column is what a man reads down when he is billing, and
      // hours are the working rather than the answer once a rate exists.
      lead:s.client+(s.job?(' · '+s.job):''),
      right:s.amount>0?_timAskMoney(s.amount):_timHrs(s.min),
      note:[s.addr||(s.general?'not tied to a job, nothing to bill it to':'no address on file'),
        // The working, so the figure can be checked against the clock.
        s.amount>0?(_timHrs(s.min)+' at '+_timAskMoney(s.rate)+'/hr'):_timHrs(s.min),
        s.who.join(', '),
        s.days+' day'+(s.days===1?'':'s')].filter(Boolean).join('  ·  '),
    });
  });
  // The headline is the money the moment there is any, because "what do I
  // invoice" is a question with a dollar answer. Hours stay in the subtitle as
  // the working. With no rate anywhere it is the hours, same as before.
  const lead=sheet.billable>0?_timAskMoney(sheet.billable):_timHrs(sheet.total);
  return {
    id:'sheet',
    title:lead,
    // "Lines", not "addresses": one of these can be time clocked against no
    // job, which has no address by definition, and calling it one would be the
    // worksheet rounding itself up.
    sub:w.label+', '+_timSpanLabel(w)+'. '+
      (sheet.billable>0?(_timHrs(sheet.total)+' across '):'')+
      sheet.sites.length+' line'+(sheet.sites.length===1?'':'s')+' to bill, '+
      sheet.people.length+' '+(sheet.people.length===1?'person':'people')+'.'+
      // THE HOURS WITH NO RATE BEHIND THEM, said out loud every time there are
      // any. A headline figure that silently leaves out half the week is the
      // one way this costs real money, and the reason is always fixable: the
      // job is fixed-price, or its bid has no rate on it yet.
      (sheet.unratedMin>0
        ?(' '+_timHrs(sheet.unratedMin)+' has no rate behind it, so it is not in that figure.')
        :'')+
      (loose?(' '+_timHrs(loose)+' is not on a job, so there is nobody to bill it to.'):'')+
      (sheet.open?(' '+sheet.open+' clock still running.'):''),
    rows,
    groups:[
      {title:'By person',rows:sheet.people.map(p=>({
        lead:p.name+(p.ot?' · OT':''),right:_timHrs(p.min),
        note:p.days+' day'+(p.days===1?'':'s')+(p.ot?', over 40 in a week':'')}))},
    ],
    copy:_timSheetText(sheet),
    foot:_timClockedFoot(),
    go:{label:'Open the time log',fn:"goPg('pg-timelog')"},
  };
}

// The same worksheet as plain text, for pasting into an invoice, an email or a
// message to a bookkeeper. Tabs between the columns so it lands in a spreadsheet
// as columns rather than one mashed cell.
function _timSheetText(sheet){
  const w=sheet.win;
  const L=[];
  L.push('HOURS  '+_timSpanLabel(w));
  L.push('');
  L.push('BY ADDRESS');
  sheet.sites.forEach(s=>{
    L.push(s.client+(s.job?(' - '+s.job):''));
    if(s.addr)L.push('  '+s.addr);
    else if(s.general)L.push('  not tied to a job');
    L.push('  '+_timHrs(s.min)+'\t'+
      (s.amount>0?(_timAskMoney(s.rate)+'/hr\t'+_timAskMoney(s.amount)):'no rate\t-')+'\t'+
      s.who.join(', ')+'\t'+s.days+' day'+(s.days===1?'':'s'));
  });
  L.push('');
  L.push('BY PERSON');
  sheet.people.forEach(p=>{
    L.push(p.name+'\t'+_timHrs(p.min)+(p.ot?'\tover 40 in a week':''));
  });
  L.push('');
  L.push('TOTAL\t'+_timHrs(sheet.total)+
    (sheet.billable>0?('\t'+_timAskMoney(sheet.billable)):''));
  if(sheet.unratedMin>0){
    L.push(_timHrs(sheet.unratedMin)+' has no rate behind it and is not in that total.');
  }
  if(sheet.open)L.push(sheet.open+' clock still running, counted as nothing.');
  L.push('Clocked time only. GPS-tracked site time is in the Time Log.');
  return L.join('\n');
}

// Said once, the same way, under every answer built off timeEntries. He reads
// the clock in/out rows on this phone and nothing else, and a total that looks
// complete but is not is the one way a timesheet answer can cost real money.
function _timClockedFoot(){
  return 'Clocked time only, off this phone. GPS-tracked site time lives in the Time Log.';
}

function _timAnswerAvg(said){
  const yr=_timAskYear(said);
  const won=_timRows('bids').filter(b=>b&&b.status==='Closed Won'&&_timYr4(b.date)===yr&&Number(b.amount)>0);
  if(!won.length){
    return {id:'avg',title:'No won work in '+yr,
      sub:'Nothing from that year is Closed Won with an amount on it.',rows:[]};
  }
  const amounts=won.map(b=>Number(b.amount)||0).sort((a,b)=>a-b);
  const mean=amounts.reduce((s,n)=>s+n,0)/amounts.length;
  // The median as well as the mean, and this is not padding. One $40,000
  // remodel in a year of $2,000 service calls drags the average somewhere he
  // has never actually charged, and the average is the number a man quotes off
  // the top of his head.
  const mid=amounts.length%2
    ? amounts[(amounts.length-1)/2]
    : (amounts[amounts.length/2-1]+amounts[amounts.length/2])/2;
  return {
    id:'avg',
    title:_timAskMoney(mean),
    sub:'across '+won.length+' won job'+(won.length===1?'':'s')+' in '+yr+
      '. Half of them were under '+_timAskMoney(mid)+'.',
    rows:[
      {lead:'Average',right:_timAskMoney(mean),note:'the total split evenly'},
      {lead:'Middle job',right:_timAskMoney(mid),note:'half above, half below'},
      {lead:'Smallest',right:_timAskMoney(amounts[0]),note:''},
      {lead:'Biggest',right:_timAskMoney(amounts[amounts.length-1]),note:''},
    ],
    go:{label:'Open bids',fn:"goPg('pg-leads')"},
  };
}

// ── Where you stand, in four lines ──────────────────────────────────────────
// Built entirely out of the other answers rather than a fifth opinion on the
// same arrays: a brief that disagreed with the individual question would be the
// worst thing in this file, because it is the one a man reads fastest and
// trusts most.
//
// What goes in it is what a contractor can DO something about before supper:
// money already earned and not collected, money still out for an answer, money
// in this year, and whatever Tim would have interrupted him about anyway. No
// vanity numbers, no "you are doing great", no trend line. He asked where he
// stands, not how he feels.
function _timAnswerBrief(said){
  const rows=[];
  const owed=timOwedAll();
  const owedTotal=owed.reduce((s,r)=>s+r.amount,0);
  if(owedTotal>0.01){
    const oldest=owed[0];
    rows.push({lead:'Waiting to be paid',right:_timAskMoney(owedTotal),
      note:owed.length===1?(oldest.name+', '+_timAskDays(oldest.days))
        :(owed.length+' customers, oldest is '+_timAskDays(oldest.days))});
  }
  const out=_timRows('bids').filter(b=>b&&b.status==='Pending');
  if(out.length){
    rows.push({lead:'Out for an answer',
      right:_timAskMoney(out.reduce((s,b)=>s+(Number(b.amount)||0),0)),
      note:out.length+' quote'+(out.length===1?'':'s')});
  }
  const yr=_timAskYear(said);
  const inYear=_timTookIn(yr).reduce((s,r)=>s+r.amount,0);
  if(inYear>0.01)rows.push({lead:'Taken in this year',right:_timAskMoney(inYear),note:'across '+yr});

  // Whatever the dock would have said. It is the same engine, so the brief can
  // never contradict the pill sitting behind it.
  let flag=null;
  try{
    if(typeof timNudges==='function'&&typeof timJobSnapshot==='function'){
      flag=(timNudges(timJobSnapshot())||[])[0]||null;
    }
  }catch(_e){}
  if(flag)rows.push({lead:flag.line,right:String(flag.figure||''),note:'worth a look'});

  if(!rows.length){
    return {id:'brief',title:'All square',
      sub:'Nothing owed to you, nothing out for an answer, and nothing on this job worth flagging.',rows:[]};
  }
  // The headline is the money he is owed, because that is the number that is
  // his and is not in his account. Nothing out means the headline is what he
  // has taken in instead, and if neither exists it is the count of open quotes.
  const title=owedTotal>0.01?_timAskMoney(owedTotal)
    :(inYear>0.01?_timAskMoney(inYear):_timAskMoney(out.reduce((s,b)=>s+(Number(b.amount)||0),0)));
  const sub=owedTotal>0.01?'is yours and not in your account yet'
    :(inYear>0.01?('taken in across '+yr):'out for an answer');
  return {id:'brief',title,sub,rows,
    go:{label:'Open Collect',fn:"goPg('pg-money')"}};
}

function timAsk(said){
  // THE BOUNDARY. Every one of these answers is owner-only business data:
  // revenue, receivables, win rate, the best customer, the average job. This is
  // where the figures are actually computed, so it is the only guard that holds
  // no matter which route got here, and it is checked before the question is
  // even parsed. A crew member gets null, which is the same thing he gets for a
  // question Tim cannot place: no answer, and no hint that there was one.
  if(typeof _timCrew==='function'&&_timCrew())return null;
  const hit=timAskKind(said);
  if(!hit)return null;
  try{
    if(hit.id==='owed')return _timAnswerOwed();
    if(hit.id==='charged')return _timAnswerCharged(said);
    if(hit.id==='source')return _timAnswerSource();
    if(hit.id==='who')return _timAnswerWho(said);
    if(hit.id==='made')return _timAnswerMade(said);
    if(hit.id==='spent')return _timAnswerSpent(said);
    if(hit.id==='out')return _timAnswerOut();
    if(hit.id==='winrate')return _timAnswerWinrate(said);
    if(hit.id==='best')return _timAnswerBest();
    if(hit.id==='miles')return _timAnswerMiles(said);
    if(hit.id==='hours')return _timAnswerHours(said);
    if(hit.id==='sheet')return _timAnswerSheet(said);
    if(hit.id==='clock')return _timAnswerClock();
    if(hit.id==='avg')return _timAnswerAvg(said);
    if(hit.id==='brief')return _timAnswerBrief(said);
  }catch(_e){}
  return null;
}

// The text behind whatever Copy button is currently on screen. A module-level
// one rather than an attribute on the button, because the worksheet is a
// multi-line block with tabs in it and an HTML attribute is the wrong place for
// one: escaping it through the DOM and back is a way to introduce a difference
// between what he showed and what he copied.
let _TIM_ASK_COPY='';
// Same shape as _timLogCopy (js/tim-log.js): write through the Clipboard API,
// say so on the button itself as well as in the toast, and return the text so a
// test can assert what WOULD have been copied without needing clipboard
// permission in a headless browser.
function _timCopySheet(btn){
  const t=_TIM_ASK_COPY;
  if(!t)return '';
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

// ── The sheet ────────────────────────────────────────────────────────────────
// Same furniture as the nudge cards in openTim: the figure first and big,
// because he asked a question about a number and the number is the answer. The
// rows under it are the working, for a man who wants to see where it came from.
function _timShowAsk(ans){
  if(!ans)return null;
  const money=n=>(typeof timPrice==='function')?timPrice(n):('$'+Math.round(n||0));

  // The header is a way BACK, not a label. _timSheet replaces the overlay
  // rather than stacking on it, so without this the breakdown is a dead end and
  // closing it drops you on the page instead of in the conversation you were
  // having. The only caller is _timReopenAsk, which is reached from a bubble,
  // so there is always a thread to go back to.
  let html=
    '<button type="button" onclick="openTim()" '+
      'style="display:flex;align-items:center;gap:9px;padding:0 16px 13px;width:100%;'+
      'background:none;border:0;border-bottom:1px solid var(--border);font-family:inherit;'+
      'cursor:pointer;text-align:left;-webkit-tap-highlight-color:transparent">'+
      '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" '+
        'style="stroke:var(--text3);stroke-width:2.2;fill:none;stroke-linecap:round;'+
        'stroke-linejoin:round;flex-shrink:0"><polyline points="15 18 9 12 15 6"/></svg>'+
      (typeof timMark==='function'?timMark(20):'')+
      '<span style="flex:1;min-width:0;font-size:13px;font-weight:700;color:var(--text)">Back to Tim</span>'+
    '</button>'+
    '<div style="padding:15px 16px 13px;border-bottom:1px solid var(--border)">'+
      '<div style="font-size:26px;font-weight:700;color:var(--text);letter-spacing:-.6px;font-variant-numeric:tabular-nums;margin-bottom:6px">'+escHtml(ans.title)+'</div>'+
      (ans.sub?'<div style="font-size:13.5px;line-height:1.5;color:var(--text2)">'+escHtml(ans.sub)+'</div>':'')+
    '</div>';

  const rowsHtml=list=>list.map(r=>
    '<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 16px;border-bottom:1px solid var(--border)">'+
      '<span style="flex:1;min-width:0;font-size:13px;color:var(--text)">'+escHtml(r.lead)+
        (r.note?'<span style="display:block;font-size:10.5px;color:var(--text3);margin-top:2px;line-height:1.45">'+escHtml(r.note)+'</span>':'')+
      '</span>'+
      (r.right?'<span style="font-size:13px;font-weight:600;color:var(--text);font-variant-numeric:tabular-nums;flex-shrink:0">'+escHtml(r.right)+'</span>':'')+
    '</div>').join('');

  if(ans.rows&&ans.rows.length)html+=rowsHtml(ans.rows);

  // A second pivot on the same numbers. The invoicing worksheet is read two
  // ways by two different jobs on a Friday: by address to write the bill, by
  // person to run payroll, and they have to be the same hours or one of them is
  // a lie. Both come out of one timWorkSheet call for exactly that reason.
  if(ans.groups&&ans.groups.length){
    ans.groups.forEach(g=>{
      if(!g||!g.rows||!g.rows.length)return;
      html+='<div style="padding:13px 16px 7px;font-size:10.5px;font-weight:800;'+
        'letter-spacing:.07em;text-transform:uppercase;color:var(--text3)">'+escHtml(g.title||'')+'</div>'+
        rowsHtml(g.rows);
    });
  }

  if(ans.foot){
    html+='<div style="padding:11px 16px;font-size:11.5px;color:var(--text3);line-height:1.5">'+escHtml(ans.foot)+'</div>';
  }

  // The paperwork is the point. Owner, on what would get John off paper: "one
  // huge thing is ending the hours it takes for him to do paperwork". Reading a
  // number off a screen and typing it into an invoice IS the paperwork, so the
  // worksheet leaves as text rather than as something to transcribe.
  if(ans.copy){
    _TIM_ASK_COPY=String(ans.copy);
    html+='<div style="padding:12px 16px 0">'+
      '<button type="button" onclick="_timCopySheet(this)" '+
        'style="width:100%;height:42px;border:0;border-radius:var(--r-md);background:var(--bg2);'+
        'box-shadow:inset 0 0 0 1px var(--border);color:var(--text);font-family:inherit;'+
        'font-size:13.5px;font-weight:700;cursor:pointer">Copy the worksheet</button>'+
      '</div>';
  }

  if(ans.go){
    html+='<div style="padding:14px 16px 0">'+
      '<button type="button" onclick="_timClose();'+escHtml(ans.go.fn)+'" style="width:100%;height:46px;border:0;border-radius:var(--r-md);background:var(--blue);color:#fff;font-family:inherit;font-size:14.5px;font-weight:700;cursor:pointer">'+escHtml(ans.go.label)+'</button>'+
      '</div>';
  }

  _timSheet('_tim-ask-sheet',html);
  return ans;
}

// ── Details, from a bubble in the thread ─────────────────────────────────────
// The thread carries the headline and the working, which is the answer; it does
// not carry the rows, which are the working's working. Rather than store them
// (a log entry is capped so a dictated paragraph cannot evict the rest of the
// history, and a twelve-row breakdown would evict plenty), the sentence is run
// again. Every answer in this file is a pure read of the local books, so a
// re-run either gives the same answer or a newer one, and a newer one is the
// right thing to show a man who tapped Details a week later.
//
// Nothing here bypasses the wall: timAsk returns null for crew before it looks
// at anything, and a null falls through to the toast rather than an empty card.
function _timReopenAsk(said){
  try{
    const ans=(typeof timAsk==='function')?timAsk(String(said||'')):null;
    if(!ans){
      if(typeof showToast==='function')showToast('That one has moved on since you asked it','🔧',2600);
      return null;
    }
    return _timShowAsk(ans);
  }catch(_e){return null;}
}
