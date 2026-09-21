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
    'how many hours have i put in','my hours this week','how long have i worked']},
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

function _timAnswerHours(){
  const rows=_timRows('timeEntries').filter(t=>t&&t.date&&!t.open&&Number(t.minutes)>0);
  if(!rows.length){
    return {id:'hours',title:'Nothing clocked',
      sub:'No finished time entry to count.',rows:[]};
  }
  // The last seven days, and the sub says so. "This week" means a different
  // thing to a man who starts on Sunday than to one who starts on Monday, and
  // guessing which he means is a wrong number dressed as a right one.
  const today=(typeof todayKey==='function')?todayKey():'';
  const cut=(()=>{
    const b=Date.parse(today);
    if(isNaN(b))return null;
    const d=new Date(b-6*86400000);
    return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0')+'-'+
      String(d.getUTCDate()).padStart(2,'0');
  })();
  const recent=cut?rows.filter(t=>String(t.date)>=cut&&String(t.date)<=today):rows;
  const mins=recent.reduce((s,t)=>s+(Number(t.minutes)||0),0);
  const by={};
  recent.forEach(t=>{
    const k=t.logged_by_name||'You';
    (by[k]||(by[k]={k,mins:0})).mins+=Number(t.minutes)||0;
  });
  const people=Object.keys(by).map(k=>by[k]).sort((a,b)=>b.mins-a.mins);
  const hrs=m=>(Math.round(m/6)/10)+' hrs';
  return {
    id:'hours',
    title:hrs(mins),
    sub:'over the last 7 days, '+recent.length+' entr'+(recent.length===1?'y':'ies')+
      (people.length>1?(', '+people.length+' people'):''),
    rows:people.length>1?people.map(p=>({lead:p.k,right:hrs(p.mins),note:''})):[],
    go:{label:'Open the time log',fn:"goPg('pg-timelog')"},
  };
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
    if(hit.id==='hours')return _timAnswerHours();
    if(hit.id==='avg')return _timAnswerAvg(said);
  }catch(_e){}
  return null;
}

// ── The sheet ────────────────────────────────────────────────────────────────
// Same furniture as the nudge cards in openTim: the figure first and big,
// because he asked a question about a number and the number is the answer. The
// rows under it are the working, for a man who wants to see where it came from.
function _timShowAsk(ans){
  if(!ans)return null;
  const money=n=>(typeof timPrice==='function')?timPrice(n):('$'+Math.round(n||0));

  let html=
    '<div style="display:flex;align-items:center;gap:9px;padding:0 16px 13px;border-bottom:1px solid var(--border)">'+
      (typeof timMark==='function'?timMark(20):'')+
      '<span style="flex:1;min-width:0;font-size:13px;font-weight:700;color:var(--text)">Tim</span>'+
    '</div>'+
    '<div style="padding:15px 16px 13px;border-bottom:1px solid var(--border)">'+
      '<div style="font-size:26px;font-weight:700;color:var(--text);letter-spacing:-.6px;font-variant-numeric:tabular-nums;margin-bottom:6px">'+escHtml(ans.title)+'</div>'+
      (ans.sub?'<div style="font-size:13.5px;line-height:1.5;color:var(--text2)">'+escHtml(ans.sub)+'</div>':'')+
    '</div>';

  if(ans.rows&&ans.rows.length){
    html+=ans.rows.map(r=>
      '<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 16px;border-bottom:1px solid var(--border)">'+
        '<span style="flex:1;min-width:0;font-size:13px;color:var(--text)">'+escHtml(r.lead)+
          (r.note?'<span style="display:block;font-size:10.5px;color:var(--text3);margin-top:2px">'+escHtml(r.note)+'</span>':'')+
        '</span>'+
        (r.right?'<span style="font-size:13px;font-weight:600;color:var(--text);font-variant-numeric:tabular-nums;flex-shrink:0">'+escHtml(r.right)+'</span>':'')+
      '</div>').join('');
  }

  if(ans.foot){
    html+='<div style="padding:11px 16px;font-size:11.5px;color:var(--text3)">'+escHtml(ans.foot)+'</div>';
  }

  if(ans.go){
    html+='<div style="padding:14px 16px 0">'+
      '<button type="button" onclick="_timClose();'+escHtml(ans.go.fn)+'" style="width:100%;height:46px;border:0;border-radius:var(--r-md);background:var(--blue);color:#fff;font-family:inherit;font-size:14.5px;font-weight:700;cursor:pointer">'+escHtml(ans.go.label)+'</button>'+
      '</div>';
  }

  _timSheet('_tim-ask-sheet',html);
  return ans;
}
