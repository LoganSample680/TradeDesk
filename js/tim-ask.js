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
    go:{label:'Open '+(String(c.name).split(' ')[0]||'customer'),fn:"openClient("+Number(c.id)+")"},
  };
}

// ── The one entry point ──────────────────────────────────────────────────────
// Returns an answer, or null when he cannot place the question, which lets
// _timGoRun fall through to the navigator exactly as it does today. Null is a
// real answer here: a wrong figure about his own money is the one mistake this
// file must never make.
function timAsk(said){
  const hit=timAskKind(said);
  if(!hit)return null;
  try{
    if(hit.id==='owed')return _timAnswerOwed();
    if(hit.id==='charged')return _timAnswerCharged(said);
    if(hit.id==='source')return _timAnswerSource();
    if(hit.id==='who')return _timAnswerWho(said);
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
