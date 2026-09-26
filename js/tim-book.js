// ── The book that writes itself ──────────────────────────────────────────────
//
// The app already learns a price when he saves a line (`_pbLearn`), already
// asks before overwriting one that moved more than a quarter, and already
// learns hours off the clock. Three things it does not do, and all three are
// why a price book is empty in week one and stale in year two:
//
//   1. It never fills the book from the work he has ALREADY sent. Everything
//      before today taught it nothing, and that is where his prices actually
//      are: in fourteen proposals sitting in the proposals list.
//   2. It never tells him a price has gone stale.
//   3. It never tells him what a line really earns per hour once the clock has
//      had its say.
//
// All three are arithmetic over records the phone is already holding. Nothing
// here calls anything, nothing here invents a price, and the n:1 rule from
// `_pbLearn` is kept exactly: a line he used once is remembered and NOT offered
// back, because a one-off must never become his price.

function _timBookTrade(){
  return (typeof _pbTrade==='function')?_pbTrade()
    :((typeof getActiveTrade==='function'?getActiveTrade():'general')||'general');
}
function _timBookRows(b){
  const out=[];
  if(!b)return out;
  if(Array.isArray(b.byoItems))b.byoItems.forEach(it=>{
    if(!it||it._rrp||!it.label)return;
    const rate=Number(it.rate)>0?Number(it.rate):Number(it.price)||0;
    if(rate>0)out.push({desc:String(it.label),rate,unit:it.unit||'ea',notes:it.notes||''});
  });
  if(Array.isArray(b.geiLines))b.geiLines.forEach(l=>{
    // Labor is the crew rate, not a thing he sells, so it stays out exactly as
    // it does in `_pbLearnAll`.
    if(!l||l._tmLabor||!l.desc)return;
    const rate=Number(l.rate)||0;
    if(rate>0)out.push({desc:String(l.desc),rate,unit:l.unit||'ea',notes:l.notes||''});
  });
  return out;
}
function _timMedian(vals){
  const v=vals.slice().sort((a,b)=>a-b);
  if(!v.length)return 0;
  const m=Math.floor(v.length/2);
  return v.length%2?v[m]:Math.round(((v[m-1]+v[m])/2)*100)/100;
}

// Everything he has already sent, read as a price book.
//
// Grouped by `_pbKey` so it groups the way the book itself groups, which means
// a line Tim offers and a line `_pbLearn` would write are the same line and
// cannot end up as two.
function timBookFromSent(trade){
  const t=trade||_timBookTrade();
  const rows=(typeof bids!=='undefined'&&Array.isArray(bids))?bids:[];
  const mine=rows.filter(b=>b&&(b.trade_type||'general')===t&&!b.deleted&&b.status!=='draft');
  const groups={};
  mine.forEach(b=>{
    const seen=new Set();
    _timBookRows(b).forEach(r=>{
      const k=(typeof _pbKey==='function')?_pbKey(r.desc):String(r.desc).toLowerCase().trim();
      if(!k)return;
      const g=groups[k]||(groups[k]={desc:r.desc,unit:r.unit,notes:r.notes,rates:[],jobs:0});
      g.rates.push(r.rate);
      if(r.unit&&r.unit!=='ea')g.unit=r.unit;
      if(r.notes&&!g.notes)g.notes=r.notes;
      // One proposal counts once for a line, however many times it appears on it.
      if(!seen.has(k)){g.jobs++;seen.add(k);}
    });
  });
  const all=Object.keys(groups).map(k=>{
    const g=groups[k];
    const rate=_timMedian(g.rates);
    const lo=Math.min.apply(null,g.rates),hi=Math.max.apply(null,g.rates);
    return {
      key:k,desc:g.desc,unit:g.unit||'ea',notes:g.notes||'',
      rate,n:g.jobs,lo,hi,
      // He priced this differently on different jobs, so Tim says both ends and
      // which one he took, rather than quietly picking one.
      spread:(hi-lo)>Math.max(1,lo*0.1),
    };
  });
  // Offered: used on two or more proposals. Held: seen once, remembered, silent.
  const offer=all.filter(r=>r.n>=2).sort((a,b)=>(b.n-a.n)||String(a.desc).localeCompare(String(b.desc)));
  const held=all.filter(r=>r.n<2);
  return {trade:t,proposals:mine.length,lines:all.length,offer,held};
}

// What of that is genuinely new. A line already in the book at the same price
// is not news, and offering it back would make the screen look like work.
function timBookNew(trade){
  const read=timBookFromSent(trade);
  read.offer=read.offer.filter(r=>{
    const hit=(typeof _pbFind==='function')?_pbFind(r.desc,read.trade):null;
    if(!hit)return true;
    const was=Number(hit.rate)||0;
    return was<=0||Math.abs(r.rate-was)/was>0.02;
  });
  return read;
}

// Write them in through `_pbLearn`, twice, so every line lands settled rather
// than as a one-off the book would hold back. This is the one place that is
// allowed to do that, and only because each line has already been used on two
// proposals, which is the same bar `_pbLearn` sets.
//
// NO TRADE ARGUMENT, on purpose. `_pbLearn` writes to the trade the app is
// currently in and there is no version of it that takes one, so accepting a
// trade here would be a parameter that silently did nothing: he would tap the
// button on the roofing book and watch the lines land in painting. It reads
// what it is about to write, which is the only honest pairing.
function timTakeBook(){
  const read=timBookNew(_timBookTrade());
  if(typeof _pbLearn!=='function')return 0;
  read.offer.forEach(r=>{
    _pbLearn(r.desc,r.rate,r.unit,r.notes);
    _pbLearn(r.desc,r.rate,r.unit,r.notes);
  });
  return read.offer.length;
}
function timTakeBookLine(desc,rate,unit,notes){
  if(typeof _pbLearn!=='function')return;
  _pbLearn(desc,rate,unit,notes);
  _pbLearn(desc,rate,unit,notes);
}

// ── Keeping it honest ────────────────────────────────────────────────────────
//
// What a line really earns per hour, once the clock has had its say. Nothing to
// approve and nothing to dismiss: it is a fact about his own jobs, printed
// under the price it is a fact about.
//
// `hit.h` is the measured hours `_pbLearnHours` has been collecting all along.
// Until five of them exist this says nothing, because three jobs of a painter
// having a bad week is not a rate.
function timLineHourly(desc,trade){
  const hit=(typeof _pbFind==='function')?_pbFind(desc,trade||_timBookTrade()):null;
  if(!hit||!Array.isArray(hit.h)||hit.h.length<5)return null;
  const hrs=_timMedian(hit.h);
  const rate=Number(hit.rate)||0;
  if(!(hrs>0)||!(rate>0))return null;
  return {desc:hit.desc,hours:Math.round(hrs*10)/10,rate,perHour:Math.round(rate/hrs),n:hit.h.length};
}

// A price that has not moved while the work behind it got dearer.
//
// Deliberately NOT a per-gallon or per-foot figure: expenses carry an amount, a
// vendor and a date, and no units, so a "your paint went up 9 percent a gallon"
// line would be a number the app cannot actually stand behind. What it CAN
// stand behind is what he spends on materials per job, then against now, and
// that is what this says.
function timPriceDrift(trade){
  const t=trade||_timBookTrade();
  const book=(typeof _pbBook==='function')?_pbBook(t):((S&&S.priceBook&&S.priceBook[t])||[]);
  const ex=(typeof expenses!=='undefined'&&Array.isArray(expenses))?expenses:[];
  const mat=ex.filter(e=>e&&Number(e.amount)>0&&/material|supply|supplies|paint|lumber|hardware/i.test(String(e.category||'')+' '+String(e.vendor||'')))
    .sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')));
  if(mat.length<6)return null;
  const half=Math.floor(mat.length/2);
  const avg=rows=>rows.reduce((s,e)=>s+Number(e.amount||0),0)/(rows.length||1);
  const then=avg(mat.slice(0,half)),now=avg(mat.slice(-3));
  if(!(then>0)||now<=then)return null;
  const pct=Math.round(((now-then)/then)*100);
  if(pct<5)return null;
  // The oldest price he is still charging, because that is the one this costs
  // him most on.
  const stale=book.filter(r=>r&&r.last&&Number(r.rate)>0)
    .sort((a,b)=>String(a.last).localeCompare(String(b.last)))[0];
  if(!stale)return null;
  const set=String(stale.last||'');
  const when=/^\d{4}-\d{2}/.test(set)
    ? new Date(set+(set.length===7?'-01':'')).toLocaleDateString('en-US',{month:'long'})
    : null;
  const up=Math.round(Number(stale.rate)*pct/100*100)/100;
  return {
    desc:stale.desc,rate:Number(stale.rate),unit:stale.unit||'ea',pct,
    when,suggest:Math.round((Number(stale.rate)+up)*100)/100,gap:up,
  };
}
function timTakeDrift(d){
  if(!d||!(d.suggest>0))return;
  const hit=(typeof _pbFind==='function')?_pbFind(d.desc):null;
  if(hit){hit.rate=d.suggest;hit.last=(typeof todayKey==='function')?todayKey():'';}
  if(typeof _settingsChanged==='function')_settingsChanged();
  if(typeof timLearn==='function')timLearn('drift',d.desc,true);
  openTimBook();
  if(typeof showToast==='function')showToast('Price is up to $'+d.suggest,'🔧',2400);
}
function timLeaveDrift(d){
  if(typeof timLearn==='function')timLearn('drift',(d&&d.desc)||'',false);
  openTimBook();
}

// ── The sheet ────────────────────────────────────────────────────────────────
function openTimBook(){
  const read=timBookNew();
  // One formatter, shared with the read-back panel: cents only where the rate
  // itself is cents, whole dollars everywhere else.
  const price=v=>(typeof timPrice==='function')?timPrice(v):('$'+Math.round(v));

  let html='<div style="display:flex;align-items:flex-start;gap:11px;padding:0 16px 14px;border-bottom:1px solid var(--border)">'+
    (typeof timMark==='function'?timMark(28):'')+
    '<div style="flex:1;min-width:0">'+
      '<div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:3px">'+
        (read.proposals?('I read '+read.proposals+' proposal'+(read.proposals===1?'':'s')+' you have already sent'):'Nothing sent yet to read')+'</div>'+
      '<div style="font-size:12.5px;line-height:1.5;color:var(--text2)">'+
        (read.lines?(read.lines+' line'+(read.lines===1?'':'s')+', with what you actually charged and how often. Your words, not mine.')
                   :'Write an estimate and the lines you use twice land in your book on their own.')+
      '</div>'+
    '</div>'+
    '<button type="button" onclick="_timClose()" aria-label="Close" style="width:28px;height:28px;border:0;border-radius:var(--r-pill);background:var(--bg2);display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;flex-shrink:0">'+
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>'+
    '</button>'+
  '</div>';

  if(read.offer.length){
    const head='display:flex;align-items:center;padding:9px 0;background:var(--bg2);font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3)';
    html+='<div style="display:grid;grid-template-columns:minmax(0,1fr) 62px 74px">'+
      '<div style="'+head+';padding-left:16px">Line</div>'+
      '<div style="'+head+';justify-content:flex-end;padding-left:4px">Unit</div>'+
      '<div style="'+head+';justify-content:flex-end;padding-right:16px;padding-left:4px">Your price</div>'+
    '</div>';
    read.offer.slice(0,12).forEach(r=>{
      const hourly=timLineHourly(r.desc,read.trade);
      const sub=r.spread
        ? ('Used on '+r.n+' · you ranged '+price(r.lo)+' to '+price(r.hi)+', I took the middle')
        : ('Used on '+r.n+' of the '+read.proposals);
      html+='<div style="display:grid;grid-template-columns:minmax(0,1fr) 62px 74px;align-items:stretch">'+
        '<div style="padding:11px 16px;border-top:1px solid var(--border);font-size:13px;color:var(--text)">'+escHtml(r.desc)+
          '<span style="display:block;font-size:10.5px;color:var(--text3);margin-top:2px">'+escHtml(sub)+'</span>'+
          (hourly?('<span style="display:block;font-size:10.5px;color:var(--text3);margin-top:2px">Takes '+hourly.hours+' hrs on your last '+hourly.n+', so you make $'+hourly.perHour+' an hour on it</span>'):'')+
        '</div>'+
        '<div style="display:flex;align-items:center;justify-content:flex-end;padding:11px 4px;border-top:1px solid var(--border);font-size:11.5px;color:var(--text3);font-variant-numeric:tabular-nums">'+escHtml(r.unit)+'</div>'+
        '<div style="display:flex;align-items:center;justify-content:flex-end;padding:11px 16px 11px 4px;border-top:1px solid var(--border);font-size:13px;font-weight:700;color:var(--text);font-variant-numeric:tabular-nums">'+price(r.rate)+'</div>'+
      '</div>';
    });
    if(read.held.length){
      html+='<div style="display:flex;align-items:flex-start;gap:9px;padding:11px 16px;border-top:1px solid var(--border);background:var(--bg2)">'+
        '<span style="width:19px;height:19px;border-radius:var(--r-sm);background:var(--bg3);border:1px solid var(--border2);flex-shrink:0;margin-top:1px"></span>'+
        '<span style="flex:1;min-width:0;font-size:12.5px;line-height:1.45;color:var(--text2)">'+read.held.length+
          ' more I only saw once. Held back until you use one again, so a one-off never becomes your price.</span>'+
      '</div>';
    }
    html+='<div style="display:flex;gap:9px;padding:13px 16px 0;border-top:1px solid var(--border)">'+
      '<button type="button" onclick="_timTakeWholeBook()" style="flex:1;height:44px;border:0;border-radius:var(--r-md);background:var(--blue);color:#fff;font-family:inherit;font-size:14.5px;font-weight:700;cursor:pointer">Use these as my book</button>'+
      '<button type="button" onclick="_timBookOneByOne()" style="height:44px;padding:0 15px;border:0;border-radius:var(--r-md);background:var(--bg);box-shadow:0 0 0 1px var(--border2);color:var(--text2);font-family:inherit;font-size:13.5px;font-weight:600;cursor:pointer">Go one by one</button>'+
    '</div>';
  }else if(read.lines){
    html+='<div style="padding:15px 16px 0;font-size:13px;line-height:1.55;color:var(--text2)">'+
      'Your book already has every price I can read off what you have sent. Nothing to add.</div>';
  }

  const drift=timPriceDrift(read.trade);
  if(drift&&(typeof timDropped!=='function'||!timDropped('drift',drift.desc))){
    html+='<div style="margin-top:14px;padding:14px 16px 0;border-top:1px solid var(--border)">'+
      '<div style="display:flex;align-items:center;gap:7px;margin-bottom:8px">'+
        '<span style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3)">Worth a look</span>'+
        '<span style="flex:1"></span>'+
        '<span style="font-size:19px;font-weight:700;color:var(--text);letter-spacing:-.4px;font-variant-numeric:tabular-nums">'+price(drift.gap)+'</span>'+
      '</div>'+
      '<div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:5px">Your costs went up, this price did not</div>'+
      '<div style="font-size:12.5px;line-height:1.55;color:var(--text2);margin-bottom:12px">'+
        'Materials have cost you '+drift.pct+' percent more per job than when you set '+price(drift.rate)+
        ' for "'+escHtml(drift.desc)+'"'+(drift.when?(' in '+drift.when):'')+'. Holding it costs you '+price(drift.gap)+' a '+escHtml(drift.unit)+'.'+
      '</div>'+
      '<div style="display:flex;gap:9px">'+
        '<button type="button" onclick="timTakeDrift(_timDrift)" style="flex:1;height:40px;border:0;border-radius:var(--r-sm);background:var(--blue);color:#fff;font-family:inherit;font-size:13.5px;font-weight:700;cursor:pointer">Take it to '+price(drift.suggest)+'</button>'+
        '<button type="button" onclick="timLeaveDrift(_timDrift)" style="flex:1;height:40px;border:0;border-radius:var(--r-sm);background:var(--bg);box-shadow:0 0 0 1px var(--border2);color:var(--text2);font-family:inherit;font-size:13.5px;font-weight:600;cursor:pointer">Leave it</button>'+
      '</div>'+
    '</div>';
  }
  window._timDrift=drift;

  if(typeof _timSheet==='function')_timSheet('_tim-sheet',html);
}

function _timTakeWholeBook(){
  const n=timTakeBook();
  if(typeof _timClose==='function')_timClose();
  if(typeof renderPriceBookSettings==='function')renderPriceBookSettings();
  if(typeof showToast==='function')showToast(n?('Your book has '+n+' line'+(n===1?'':'s')+' in it'):'Nothing new to add','🔧',2600);
}
// One by one is the price book editor, which is where a line is corrected
// anyway. A second list with the same rows and different buttons is the thing
// rule 7.3 exists to stop.
function _timBookOneByOne(){
  if(typeof _timClose==='function')_timClose();
  if(typeof goPg==='function')goPg('pg-settings');
  if(typeof _openSetDetail==='function')_openSetDetail('pricebook');
}
