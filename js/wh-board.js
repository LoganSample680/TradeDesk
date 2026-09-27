// ── Service due: recurring service board (owner 2026-09-25, widened 2026-09-27)
// Started as the water heater flush board: every water heater the contractor
// put in (or last flushed) 11 or more months ago, with the customer's name, a
// Text button, and the two answers the customer can give: "put me on the
// schedule" or "I'll do it myself".
//
// Owner 2026-09-27: "annual service needs ability to set your own service
// interval like 3 month 6 month for different jobs other then heaters, could
// be water filters gutter cleaning irrigation drain down heater flushes etc".
// So the SAME board now carries every recurring service, each item labelled
// with its service and sorted by when it comes due. It is one board, not a
// second one per service (7.3): heaters are simply the first service type.
//
// NO NEW STORE (§7.3). A service item is a row in the client equipment list
// (js/equipment.js, synced as td_equipment), the same row a water heater
// already was. The board adds fields to that row:
//   serviceKind    which service type ('wh-flush', 'gutter', a custom key).
//                  Missing on every row written before 2026-09-27: a row of
//                  kind 'Water heater' with no serviceKind IS a heater flush,
//                  decided at read time, so no stored row is ever rewritten.
//   serviceMonths  this customer's own interval, only when it differs from
//                  the type's default, so changing the default moves everyone
//                  who never had one set.
//   serviceName    a custom service's name, so the row describes itself even
//                  before the settings that define it have synced.
//   flushLog       one entry per service done, ours or the customer's. It
//                  kept its heater name on purpose: production reads it, and
//                  a rename would strand every flush already logged (3.1).
//   whTextedAt / whSnoozeUntil / whSnoozedAt, as before.
// Each type's default interval and its text template live on S.serviceTypes
// (synced with the rest of settings); the heater template stays on
// S.whFlushMsg where production already reads it.
//
// Everything on the board is DERIVED at read time from those rows, so a
// service job that gets canceled simply stops counting and the customer comes
// back on their own. Nothing sweeps, nothing reconciles.
//
// Three ways onto the board, because the owner's books are not all in the app:
//   1. Won proposals that mention a water heater (one tap adds them all).
//   2. Quick add: service, name, phone, last done, for customers who never had
//      a proposal in TradeDesk.
//   3. Pick an existing client and give it a date.

const _WH_KIND='Water heater';
const _SVC_WH='wh-flush';
// The built-in services. `lead` is how many months early an item shows up:
// heaters have always shown a month before the year is up (the old fixed
// 11-month cycle), so a heater logged before this change lands on the board
// on exactly the same day it did before. Every other service shows when due.
const _SVC_BUILTIN=[
  {key:_SVC_WH,name:'Water heater flush',short:'Water heater',months:12,lead:1,kind:_WH_KIND,icon:'💧',trades:['plumbing'],
    start:'Installed',done:'Flushed',sched:'Flush scheduled',diy:'Flushed by customer',dateLbl:'Install date',
    noun:'water heater',
    msg:'Hi {name}, it\'s been about a year since we put in your water heater. Time for its flush. Want us to schedule it, or doing it yourself this year?'},
  {key:'water-filter',name:'Water filter change',short:'Water filter',months:6,icon:'🚿',trades:['plumbing'],
    msg:'Hi {name}, your water filter is due for a change. Want us to swap it, or doing it yourself this time?'},
  {key:'gutter',name:'Gutter cleaning',short:'Gutters',months:6,icon:'🍂',trades:['landscaping','roofing'],
    msg:'Hi {name}, it\'s time to clean out your gutters again. Want us to get you on the schedule?'},
  {key:'irrigation',name:'Irrigation drain-down',short:'Irrigation',months:12,icon:'🌱',trades:['landscaping','plumbing'],
    msg:'Hi {name}, it\'s about time to drain down and winterize your irrigation. Want us to get you on the schedule?'},
  {key:'furnace',name:'Heater / furnace service',short:'Furnace',months:12,kind:'Furnace',icon:'🔥',trades:['hvac'],
    msg:'Hi {name}, your heater is due for its service. Want us to get you on the schedule, or doing it yourself this year?'},
];
const _SVC_WORDS={start:'Last done',done:'Serviced',sched:'Service scheduled',diy:'Done by customer',dateLbl:'Last done'};

function _svcSettings(){
  const s=(typeof S!=='undefined'&&S)?S.serviceTypes:null;
  return (s&&typeof s==='object'&&!Array.isArray(s))?s:{};
}
function _svcValidMonths(n){
  if(n==null||n==='')return null;
  const v=Math.round(Number(n));
  return v>=1&&v<=24?v:null;
}
function _svcSlug(name){return String(name||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40);}
// Every service type, built-ins first with the contractor's own default
// interval applied, then the ones he named himself.
function _svcTypes(){
  const st=_svcSettings();
  const out=_SVC_BUILTIN.map(t=>Object.assign({},_SVC_WORDS,t,{months:_svcValidMonths(st[t.key]&&st[t.key].months)||t.months,base:t.months}));
  Object.keys(st).forEach(k=>{
    const v=st[k];
    if(!v||!v.custom||out.some(t=>t.key===k))return;
    const nm=String(v.name||'').trim();
    if(!nm)return;
    out.push(Object.assign({},_SVC_WORDS,{key:k,name:nm,short:nm,months:_svcValidMonths(v.months)||12,base:12,icon:'🔧',trades:[],custom:true,
      msg:'Hi {name}, it\'s time for your '+nm.toLowerCase()+' again. Want us to get you on the schedule?'}));
  });
  return out;
}
function _svcType(key){
  if(key==null)return null;
  return _svcTypes().find(t=>t.key===String(key))||null;
}
function _svcKindOf(e){
  if(!e||typeof e!=='object')return null;
  if(e.serviceKind)return String(e.serviceKind);
  return e.kind===_WH_KIND?_SVC_WH:null;
}
function _svcTypeOf(e){
  const k=_svcKindOf(e);
  if(!k)return null;
  const t=_svcType(k);
  if(t)return t;
  // A custom service whose settings have not arrived yet still reads right.
  const nm=String(e.serviceName||'Service');
  return Object.assign({},_SVC_WORDS,{key:k,name:nm,short:nm,months:12,base:12,icon:'🔧',trades:[],custom:true,
    msg:'Hi {name}, it\'s time for your '+nm.toLowerCase()+' again. Want us to get you on the schedule?'});
}
// This customer's interval: their own if one was set, else the type's.
function _svcMonths(e){
  const t=_svcTypeOf(e);
  return _svcValidMonths(e&&e.serviceMonths)||(t?t.months:12);
}
// How far ahead of the due date the item shows on the board.
function _svcLead(e){
  const t=_svcTypeOf(e);
  const n=_svcMonths(e);
  return t&&t.lead&&n>t.lead?t.lead:0;
}

// Every service item on record (every type).
function _whUnits(){
  const list=(typeof getEquipment==='function')?getEquipment():[];
  return list.filter(e=>e&&_svcKindOf(e));
}
// Only the water heaters, for the proposal finds.
function _whHeaters(){return _whUnits().filter(e=>_svcKindOf(e)===_SVC_WH);}

// The trades this account works, the switcher's pick first.
function _svcTrades(){
  const active=(typeof getActiveTrade==='function')?getActiveTrade():'';
  const lines=(typeof _getTradeLines==='function')?_getTradeLines():[];
  const out=[];
  [active].concat(Array.isArray(lines)?lines:[]).forEach(t=>{if(t&&out.indexOf(t)<0)out.push(t);});
  return out;
}
// The types that fit the trade come first (a plumber sees heater flushes and
// water filters first, a landscaper irrigation and gutters), everything else
// after, and his own services last. All of them stay available.
function _svcTypesOrdered(){
  const tr=_svcTrades();
  const rank=t=>{
    let best=99;
    (t.trades||[]).forEach(x=>{const i=tr.indexOf(x);if(i>=0&&i<best)best=i;});
    return best;
  };
  return _svcTypes().map((t,i)=>({t,i,r:t.custom?200:rank(t)})).sort((a,b)=>a.r-b.r||a.i-b.i).map(x=>x.t);
}
function _svcTradeFits(){
  const tr=_svcTrades();
  return _SVC_BUILTIN.some(t=>t.trades.some(x=>tr.indexOf(x)>=0));
}

// Install dates arrive in whatever shape the plate or the owner's memory gave
// them ("2018", "03/2018", "2025-10-04"). The board needs a day, so a bare
// month is the 1st and a bare year is Jan 1: both err toward "due sooner",
// which costs one early text and never a missed flush.
function _whParseDate(raw){
  const s=String(raw||'').trim();
  if(!s)return null;
  let m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if(m)return _whKey(+m[1],+m[2],+m[3]);
  m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if(m){let y=+m[3];if(y<100)y+=2000;return _whKey(y,+m[1],+m[2]);}
  m=s.match(/^(\d{1,2})\/(\d{4})$/);
  if(m)return _whKey(+m[2],+m[1],1);
  m=s.match(/^(19|20)\d{2}$/);
  if(m)return _whKey(+s,1,1);
  return null;
}
function _whKey(y,mo,d){
  if(!(y>=1950&&y<=2100&&mo>=1&&mo<=12&&d>=1&&d<=31))return null;
  return y+'-'+String(mo).padStart(2,'0')+'-'+String(d).padStart(2,'0');
}
// Month math that never rolls into the wrong month: Jan 31 + 1 month is
// Feb 28, not Mar 3.
function _whAddMonths(key,n){
  const [y,mo,d]=key.split('-').map(Number);
  const t=new Date(y,mo-1+n,1);
  const last=new Date(t.getFullYear(),t.getMonth()+1,0).getDate();
  return _whKey(t.getFullYear(),t.getMonth()+1,Math.min(d,last));
}

// A flush we booked only counts while its job is still on the calendar. The
// log entry stays either way; this is what decides whether it is believed.
function _whFlushCounts(f){
  if(!f||!_whParseDate(f.date))return false;
  if(f.jobId==null)return true;
  const j=(typeof jobs!=='undefined'?jobs:[]).find(x=>x&&String(x.id)===String(f.jobId));
  return !!j&&j.status!=='canceled'&&j.status!=='cancelled';
}

// The date the service clock runs from: the latest of the install (or last
// done) and every service that still counts.
function _whLastService(e){
  let best=_whParseDate(e&&e.installed);
  let how='install';
  (Array.isArray(e&&e.flushLog)?e.flushLog:[]).forEach(f=>{
    if(!_whFlushCounts(f))return;
    const k=_whParseDate(f.date);
    if(!best||k>best){best=k;how=f.how==='diy'?'diy':'us';}
  });
  return best?{date:best,how}:null;
}
// The day it lands on the board: the interval, less the heater's month early.
function _whDueKey(e){
  const last=_whLastService(e);
  return last?_whAddMonths(last.date,_svcMonths(e)-_svcLead(e)):null;
}
// The day the service is actually due, which is what the row says.
function _svcDueKey(e){
  const last=_whLastService(e);
  return last?_whAddMonths(last.date,_svcMonths(e)):null;
}


// Won proposals that name a water heater, whose client is not on the board
// yet. Proposal shapes differ by trade (line items, scope, T&M lines, notes),
// so the whole record is searched once and the answer cached on the object.
const _whBidHit=new WeakMap();
function _whBidMentions(b){
  if(!b||typeof b!=='object')return false;
  if(_whBidHit.has(b))return _whBidHit.get(b);
  let hit=false;
  try{hit=/water[\s-]*heater/i.test(JSON.stringify(b));}catch(_e){}
  _whBidHit.set(b,hit);
  return hit;
}
function _whBidInstallDate(b){
  const js=(typeof jobs!=='undefined'?jobs:[]).filter(j=>j&&String(j.bid_id)===String(b.id)&&j.eventType==='job'&&j.status!=='canceled');
  const jobDate=js.map(j=>_whParseDate(j.start)).filter(Boolean).sort().pop();
  return jobDate||_whParseDate(b.completion_date)||_whParseDate(b.signedAt)||_whParseDate(b.date)||_whParseDate(b.created)||null;
}
function _whProposalFinds(){
  const onBoard=new Set(_whHeaters().map(e=>String(e.clientId)));
  const skipped=new Set((Array.isArray(S.whSkippedBids)?S.whSkippedBids:[]).map(String));
  const seen=new Set();
  const out=[];
  (typeof bids!=='undefined'?bids:[]).forEach(b=>{
    if(!b||b.status!=='Closed Won'||b.client_id==null)return;
    const cid=String(b.client_id);
    if(onBoard.has(cid)||seen.has(cid)||skipped.has(String(b.id)))return;
    if(!_whBidMentions(b))return;
    const date=_whBidInstallDate(b);
    if(!date)return;
    seen.add(cid);
    out.push({bid:b,clientId:b.client_id,date});
  });
  return out;
}

// Plumbers see it from day one so the empty board can take their old books.
// A plumber is anyone with plumbing among their trades, not only when plumbing
// is the pill they have selected (owner 2026-09-26: a landscaper who also runs
// a plumbing line lost the board every time the switcher sat on landscaping).
function _whPlumbs(){
  const active=(typeof getActiveTrade==='function')?getActiveTrade():'';
  if(active==='plumbing')return true;
  const lines=(typeof _getTradeLines==='function')?_getTradeLines():[];
  return Array.isArray(lines)&&lines.indexOf('plumbing')>=0;
}
// Any trade a built-in service fits (plumbing, landscaping, roofing, HVAC)
// sees the board empty, so it can take their books. Anyone else sees it once
// a service item exists or a proposal names a water heater.
function _whBoardVisible(){
  if(typeof _ownerUI==='function'?!_ownerUI():(typeof _isEmployee!=='undefined'&&_isEmployee))return false;
  if(_whUnits().length)return true;
  if(_whPlumbs()||_svcTradeFits())return true;
  return _whProposalFinds().length>0;
}

function _whFmt(key){
  if(!key)return '';
  const [y,mo,d]=key.split('-').map(Number);
  return new Date(y,mo-1,d).toLocaleDateString('en-US',{year:'numeric',month:'2-digit',day:'2-digit'});
}
function _whMonthsSince(key){
  const [y,mo,d]=key.split('-').map(Number);
  const now=new Date();
  let m=(now.getFullYear()-y)*12+(now.getMonth()-(mo-1));
  if(now.getDate()<d)m--;
  return Math.max(0,m);
}

// ── One tap to one service ──────────────────────────────────────────────────
// With more than one service in use, a row of chips over the board and the
// list narrows both to one service. The pick is a per-viewer convenience, so
// it lives in memory only.
let _svcFilter='';
function _svcInUse(units){
  const seen=new Map();
  (units||_whUnits()).forEach(e=>{const t=_svcTypeOf(e);if(t&&!seen.has(t.key))seen.set(t.key,t);});
  const order=_svcTypesOrdered().map(t=>t.key);
  return [...seen.values()].sort((a,b)=>{
    const ia=order.indexOf(a.key),ib=order.indexOf(b.key);
    return (ia<0?999:ia)-(ib<0?999:ib);
  });
}
function _svcActiveFilter(inUse){
  return _svcFilter&&inUse.some(t=>t.key===_svcFilter)?_svcFilter:'';
}
function _svcFilterBar(inUse,counts){
  if(inUse.length<2)return '';
  const f=_svcActiveFilter(inUse);
  const chip=(key,label,n)=>'<button type="button" class="td-svc-fchip'+(f===key?' on':'')+'" data-svc="'+escHtml(key)+'" aria-pressed="'+(f===key)+'" onclick="event.stopPropagation();svcSetFilter(\''+escHtml(key)+'\')">'+escHtml(label)+(n?'<span class="td-svc-fn">'+n+'</span>':'')+'</button>';
  return '<div class="td-svc-filter" role="group" aria-label="Show one service">'+
    chip('','All',0)+inUse.map(t=>chip(t.key,t.short||t.name,counts&&counts[t.key]||0)).join('')+
  '</div>';
}
function svcSetFilter(key){
  _svcFilter=String(key||'');
  _whRefresh();
}

function _renderWhBoard(){
  const el=document.getElementById('dash-wh-board');
  if(!el)return;
  if(!_whBoardVisible()){el.style.display='none';el.innerHTML='';return;}
  const tk=todayKey();
  const all=_whUnits();
  const inUse=_svcInUse(all);
  const f=_svcActiveFilter(inUse);
  const units=f?all.filter(e=>_svcKindOf(e)===f):all;
  const due=[],later=[],undated=[],rolled=[];
  const dueBy={};
  units.forEach(e=>{
    const c=_whClient(e.clientId);
    if(!c)return;
    const dk=_whDueKey(e);
    if(!dk){undated.push({e,c});return;}
    const item={e,c,dk,last:_whLastService(e)};
    if(dk>tk){later.push(item);return;}
    // "No answer yet" rolls them to the 1st of next month (owner 2026-09-25:
    // "can ones that we don't hear from roll over into the next month").
    if(_whSnoozed(e,item.last,tk)){rolled.push(item);return;}
    due.push(item);
  });
  all.forEach(e=>{
    const dk=_whDueKey(e);
    if(!dk||dk>tk||!_whClient(e.clientId)||_whSnoozed(e,_whLastService(e),tk))return;
    const k=_svcKindOf(e);dueBy[k]=(dueBy[k]||0)+1;
  });
  due.sort((a,b)=>a.dk<b.dk?-1:a.dk>b.dk?1:0);
  later.sort((a,b)=>a.dk<b.dk?-1:a.dk>b.dk?1:0);
  const finds=_whProposalFinds();

  // The iOS shape (owner 2026-09-25: "think about it in an iOS way", then
  // "premium like iOS"): an inset list, a leading avatar, the one button you
  // use first, and the status said in words ("Due now", "2 mo overdue")
  // rather than as arithmetic the contractor has to do. Everything else is
  // the answer the customer gave: tapping the row asks "What did Dana say?"
  // and a swipe does the same thing in one motion, the way Mail does. The
  // line under the name says which service it is and when it is due.
  const row=({e,c,last,dk})=>{
    const t=_svcTypeOf(e);
    // Both marks belong to THIS cycle only: a text or a rollover from before
    // the last service must not follow the customer into the next one.
    const since=k=>!!k&&String(k).slice(0,10)>=last.date;
    // Whichever happened last speaks: texted after it rolled over is waiting
    // again, rolled over after a text is a rollover.
    const tx=since(e.whTextedAt)?String(e.whTextedAt):'',rl=since(e.whSnoozedAt)?String(e.whSnoozedAt):'';
    // Overdue counts from the day it is actually due, the date the row shows,
    // so a heater that surfaces a month early reads "Due now", not overdue.
    const over=Math.max(0,_whMonthsSince(_svcDueKey(e)||dk));
    const tone=(rl&&rl>tx)?'roll':tx?'wait':over>=3?'late':'due';
    const status=(rl&&rl>tx)?'<span class="td-wh-chip td-wh-chip-roll">Rolled over</span>':
      tx?'<span class="td-wh-chip">Waiting on reply</span>':
      '<span class="td-wh-status td-wh-status-'+tone+'">'+(over?over+' mo overdue':'Due now')+'</span>';
    const eid=escHtml(String(e.id));
    return '<div class="td-wh-swipe" data-wh="'+eid+'">'+
      '<div class="td-wh-under td-wh-under-l">'+svgIcon('📅',{size:18})+'<span>Schedule</span></div>'+
      '<div class="td-wh-under td-wh-under-r"><span>Doing it themselves</span>'+svgIcon('✓',{size:18})+'</div>'+
      '<div class="td-wh-row" onclick="whAsk(\''+eid+'\')">'+
        '<div class="td-wh-av td-wh-av-'+tone+'">'+escHtml(initials(c.name||'?'))+'</div>'+
        '<div class="td-wh-who">'+
          '<div class="td-wh-name">'+escHtml(c.name||'Customer')+'</div>'+
          '<div class="td-wh-sub">'+escHtml(t.name)+', due '+_whFmt(_svcDueKey(e))+'</div>'+
          status+
        '</div>'+
        '<button class="btn td-wh-txt" onclick="event.stopPropagation();whTextFlush(\''+eid+'\')"'+(c.phone?'':' disabled title="No phone on file"')+'>'+svgIcon('💬',{size:14})+'<span>Text</span></button>'+
      '</div>'+
    '</div>';
  };

  const next=later[0];
  const sub=due.length?due.length+' due':'all caught up';
  const what=f?_svcType(f)?.name||'':inUse.length>1?inUse.length+' services':inUse.length?inUse[0].name:'Recurring service';
  el.style.display='block';
  el.innerHTML=
    '<div class="card td-wh-card">'+
      '<div class="td-wh-hd">'+
        '<div class="td-wh-ico">'+svgIcon('🔄',{size:18})+'</div>'+
        '<div class="td-wh-hd-txt" onclick="goPg(\'pg-wh-list\')" role="button" aria-label="See every service customer">'+
          '<div class="td-wh-title">Service due'+(due.length?'<span class="td-wh-count">'+due.length+'</span>':'')+'</div>'+
          '<div class="td-wh-hd-sub">'+escHtml(what)+' · '+sub+'</div>'+
        '</div>'+
        '<button class="td-wh-add" onclick="openWhAdd()" aria-label="Add a service customer">'+svgIcon('➕',{size:16})+'</button>'+
      '</div>'+
      _svcFilterBar(inUse,dueBy)+
      (finds.length?
        '<div class="td-wh-find">'+
          '<div class="td-wh-find-t">'+svgIcon('📄',{size:14})+'<span>Found '+finds.length+' water heater install'+(finds.length>1?'s':'')+' in your won proposals.</span></div>'+
          '<div class="td-wh-find-b">'+
            '<button class="btn btn-sm btn-p" onclick="whAddFromProposals()">Add '+(finds.length>1?'them':'it')+'</button>'+
            '<button class="btn btn-sm" onclick="whSkipProposals()">Not these</button>'+
          '</div>'+
        '</div>':'')+
      (due.length?'<div class="td-wh-list">'+due.map(row).join('')+'</div>':
        '<div class="td-wh-empty">'+(units.length?'Nobody is due right now.':'Add a customer and when it was last done. They show up here when it comes due.')+'</div>')+
      (units.length?
        '<div class="td-wh-foot">'+
          (next?'<div>Next up: '+escHtml(next.c.name||'Customer')+' on '+_whFmt(next.dk)+(later.length>1?' · '+(later.length-1)+' more after':'')+'</div>':'')+
          (rolled.length?'<div>'+rolled.length+' rolled to next month</div>':'')+
          (undated.length?'<div>'+_svcUndatedLine(undated)+'</div>':'')+
          '<button class="td-wh-all" onclick="goPg(\'pg-wh-list\')">See all '+units.length+'</button>'+
        '</div>':'')+
    '</div>';
  _whWireSwipes(el);
}
function _svcUndatedLine(undated){
  const n=undated.length;
  if(undated.every(x=>_svcKindOf(x.e)===_SVC_WH))return n+' water heater'+(n>1?'s have':' has')+' no install date';
  return n+(n>1?' customers have':' customer has')+' no last-done date';
}

// Ids arrive as numbers from memory and as strings from the cloud and from
// onclick attributes, so every lookup here compares as strings.
function _whClient(id){
  if(id==null)return null;
  return (typeof clients!=='undefined'&&Array.isArray(clients)?clients:[]).find(c=>c&&String(c.id)===String(id))||null;
}
// Snoozed until the 1st of next month by "No answer yet". A snooze from an
// earlier cycle (before the last service) is ignored, so it can never hide the
// next reminder.
function _whSnoozed(e,last,tk){
  const until=e&&e.whSnoozeUntil;
  if(!until||until<=tk)return false;
  return !last||String(e.whSnoozedAt||'').slice(0,10)>=last.date;
}
function _whFirstOfNextMonth(tk){
  const [y,mo]=tk.split('-').map(Number);
  return _whAddMonths(_whKey(y,mo,1),1);
}
function whRollOver(id){
  const e=_whFind(id);if(!e)return;
  const tk=todayKey();
  e.whSnoozeUntil=_whFirstOfNextMonth(tk);
  e.whSnoozedAt=new Date().toISOString();
  e.updatedAt=e.whSnoozedAt;
  if(typeof saveAll==='function')saveAll();
  _whRefresh();
  if(typeof showToast==='function')showToast('Rolled to '+_whFmt(e.whSnoozeUntil),'✓');
}
function _whFind(id){return _whUnits().find(e=>String(e.id)===String(id))||null;}
function _whRefresh(){
  try{_renderWhBoard();}catch(_e){}
  try{if(document.getElementById('pg-wh-list')?.classList.contains('active'))renderWhList();}catch(_e){}
}

// ── The master list (owner 2026-09-26: "see everybody on a master list of
// who had heater installs") ──────────────────────────────────────────────────
// Every service customer on record, grouped the way the owner thinks about
// them: who needs a call now, who is parked until next month, and who is set
// until it comes around again (booked, done, or doing it themselves), with the
// date they come due next. Same rows, same answer sheet as the board; nothing
// new is stored.
let _whListQuery='';
function _whLastEvent(e,tk){
  const t=_svcTypeOf(e)||Object.assign({},_SVC_WORDS);
  const log=(Array.isArray(e.flushLog)?e.flushLog:[]).filter(_whFlushCounts);
  const f=log.slice().sort((a,b)=>String(a.date)<String(b.date)?1:-1)[0];
  const inst=_whParseDate(e.installed);
  if(f&&(!inst||f.date>=inst)){
    if(f.how==='diy')return {txt:'Doing it themselves, '+_whFmt(f.date),tone:'wait'};
    return f.date>tk?{txt:t.sched+' '+_whFmt(f.date),tone:'roll'}:{txt:t.done+' '+_whFmt(f.date),tone:'ok'};
  }
  if(inst)return {txt:t.start+' '+_whFmt(inst),tone:'ok'};
  return {txt:t.key===_SVC_WH?'No install date':'No last-done date',tone:'wait'};
}
function renderWhList(){
  const el=document.getElementById('wh-list-body');
  if(!el)return;
  const tk=todayKey();
  const q=_whListQuery.trim();
  const all=_whUnits();
  const inUse=_svcInUse(all);
  const f=_svcActiveFilter(inUse);
  const counts={};
  all.forEach(e=>{const k=_svcKindOf(e);counts[k]=(counts[k]||0)+1;});
  const due=[],rolled=[],later=[],undated=[];
  all.forEach(e=>{
    if(f&&_svcKindOf(e)!==f)return;
    const c=_whClient(e.clientId);
    if(!c)return;
    // The one customer search (clientMatches, js/data.js): name, any of
    // their addresses, or 3+ digits of phone.
    if(q&&!(typeof clientMatches==='function'?clientMatches(c,q):[c.name,c.phone,c.addr].some(v=>String(v||'').toLowerCase().includes(q.toLowerCase()))))return;
    const dk=_whDueKey(e);
    const item={e,c,dk,last:_whLastService(e)};
    if(!dk){undated.push(item);return;}
    if(dk>tk){later.push(item);return;}
    if(_whSnoozed(e,item.last,tk)){rolled.push(item);return;}
    due.push(item);
  });
  const byDue=(a,b)=>a.dk<b.dk?-1:a.dk>b.dk?1:0;
  due.sort(byDue);rolled.sort(byDue);later.sort(byDue);
  undated.sort((a,b)=>String(a.c.name).localeCompare(String(b.c.name)));
  const row=({e,c,dk},kind)=>{
    const ev=_whLastEvent(e,tk);
    const t=_svcTypeOf(e);
    const eid=escHtml(String(e.id));
    const right=kind==='due'?'<span class="td-wh-status td-wh-status-due">Due now</span>':
      kind==='rolled'?'<span class="td-wh-chip td-wh-chip-roll">Back '+_whFmt(e.whSnoozeUntil)+'</span>':
      kind==='later'?'<span class="td-wh-list-due">Due '+_whFmt(_svcDueKey(e))+'</span>':'';
    const tap=kind==='due'||kind==='rolled'?'whAsk(\''+eid+'\')':'openClientDetail('+JSON.stringify(c.id).replace(/"/g,'&quot;')+')';
    return '<div class="td-wh-row td-wh-list-row" onclick="'+tap+'">'+
      '<div class="td-wh-av td-wh-av-'+(kind==='due'?'due':kind==='rolled'?'roll':ev.tone==='roll'?'roll':'wait')+'">'+escHtml(initials(c.name||'?'))+'</div>'+
      '<div class="td-wh-who">'+
        '<div class="td-wh-name">'+escHtml(c.name||'Customer')+'</div>'+
        '<div class="td-wh-svc"><span class="td-wh-svc-n">'+escHtml(t.name)+'</span>'+
          '<button type="button" class="td-svc-every" aria-label="Change how often" onclick="event.stopPropagation();svcEditEvery(\''+eid+'\')"><span>every '+_svcMonths(e)+' mo</span></button>'+
        '</div>'+
        '<div class="td-wh-sub">'+escHtml(ev.txt)+'</div>'+
      '</div>'+
      '<div class="td-wh-list-r">'+right+'<span class="td-wh-chev">'+svgIcon('▸',{size:14})+'</span></div>'+
    '</div>';
  };
  const group=(title,items,kind)=>items.length?
    '<div class="sf-cap td-wh-list-cap">'+title+' · '+items.length+'</div>'+
    '<div class="sf-card td-wh-list-card">'+items.map(i=>row(i,kind)).join('')+'</div>':'';
  const total=due.length+rolled.length+later.length+undated.length;
  const hasAny=all.length>0;
  el.innerHTML=
    '<div class="td-wh-search">'+svgIcon('🔍',{size:16})+
      '<input id="wh-list-q" type="search" placeholder="Search name, phone, address" value="'+escHtml(_whListQuery)+'" oninput="_whListQuery=this.value;renderWhList();_whListRefocus()">'+
    '</div>'+
    _svcFilterBar(inUse,counts)+
    (total?
      group('Due now',due,'due')+
      group('Rolled to next month',rolled,'rolled')+
      group('Coming up',later,'later')+
      group('No date yet',undated,'undated')
    :'<div class="td-wh-list-empty">'+(hasAny?'Nobody matches that search.':'No service customers yet. Tap + to add one.')+'</div>');
}
// Re-rendering the list replaces the search box; put the cursor back where
// the contractor was typing so the search feels like one continuous field.
function _whListRefocus(){
  const i=document.getElementById('wh-list-q');
  if(!i)return;
  i.focus();
  try{const n=i.value.length;i.setSelectionRange(n,n);}catch(_e){}
}

// ── How often ───────────────────────────────────────────────────────────────
// Quick chips for the three intervals people actually use, and a number for
// anything else, 1 to 24 months. The same control in the add form, the
// per-customer override and the defaults sheet.
function _svcEveryField(id,months){
  const m=_svcValidMonths(months)||12;
  return '<div class="td-svc-mchips" data-for="'+id+'">'+
    [3,6,12].map(n=>'<button type="button" class="td-svc-chip td-svc-mchip'+(n===m?' on':'')+'" data-m="'+n+'">'+n+' mo</button>').join('')+
    '<label class="td-svc-mnum"><input id="'+id+'" type="number" inputmode="numeric" min="1" max="24" value="'+m+'" aria-label="Months"><span>mo</span></label>'+
  '</div>';
}
function _svcWireEvery(root){
  if(!root)return;
  root.querySelectorAll('.td-svc-mchips').forEach(box=>{
    const inp=box.querySelector('input');
    const mark=()=>{const v=_svcValidMonths(inp.value);box.querySelectorAll('.td-svc-mchip').forEach(b=>b.classList.toggle('on',+b.dataset.m===v));};
    box.querySelectorAll('.td-svc-mchip').forEach(b=>{b.onclick=ev=>{ev.preventDefault();inp.value=b.dataset.m;mark();inp.dispatchEvent(new Event('input',{bubbles:true}));};});
    inp.addEventListener('input',mark);
  });
}

// One customer's own interval. Picking the service's default puts them back
// on the default, so a later change to the default reaches them too.
function svcEditEvery(id){
  const e=_whFind(id);if(!e)return;
  const t=_svcTypeOf(e);
  const c=_whClient(e.clientId);
  document.getElementById('_svc-every-ov')?.remove();
  const ov=document.createElement('div');ov.id='_svc-every-ov';ov.className='zmodal-overlay';
  ov.onclick=ev=>{if(ev.target===ov)ov.remove();};
  const m=document.createElement('div');m.className='zmodal td-wh-form';m.style.maxWidth='420px';
  m.innerHTML=
    '<div class="zmodal-title">'+escHtml(t.name)+'</div>'+
    '<div class="td-wh-form-sub">'+escHtml((c&&c.name)||'')+' · the default is every '+t.months+' months</div>'+
    '<div class="sf-card td-wh-form-card" style="margin-top:14px"><div class="sf-list">'+
      '<div class="sf-row"><div class="sf-body"><span class="sf-lbl">Every</span>'+_svcEveryField('_svc-every-m',_svcMonths(e))+'</div></div>'+
    '</div></div>'+
    '<div id="_svc-every-err" style="display:none;color:var(--c-red);font-size:12.5px;font-weight:600;margin:-2px 2px 8px"></div>'+
    '<button id="_svc-every-save" class="btn btn-g sf-cta">Save</button>';
  ov.appendChild(m);document.body.appendChild(ov);
  _svcWireEvery(m);
  document.getElementById('_svc-every-save').onclick=()=>{
    const v=_svcValidMonths(document.getElementById('_svc-every-m').value);
    if(!v){const x=document.getElementById('_svc-every-err');x.textContent='Pick 1 to 24 months.';x.style.display='block';return;}
    svcSetItemMonths(e.id,v);
    ov.remove();
  };
}
function svcSetItemMonths(id,months){
  const e=_whFind(id);if(!e)return false;
  const v=_svcValidMonths(months);if(!v)return false;
  const t=_svcTypeOf(e);
  if(t&&v===t.months)delete e.serviceMonths;else e.serviceMonths=v;
  e.updatedAt=new Date().toISOString();
  if(typeof saveAll==='function')saveAll();
  _whRefresh();
  return true;
}

// Each service's default interval, and the services he names himself, in one
// place. Only what differs from the built-in default is stored.
function svcSetTypeMonths(key,months){
  const v=_svcValidMonths(months);
  const t=_svcType(key);
  if(!v||!t)return false;
  const st=Object.assign({},_svcSettings());
  const cur=Object.assign({},st[key]||{});
  if(!t.custom&&v===t.base)delete cur.months;else cur.months=v;
  if(Object.keys(cur).length)st[key]=cur;else delete st[key];
  S.serviceTypes=st;
  return true;
}
// A service he names himself. The same name twice is the same service.
function svcAddCustomType(name,months){
  const nm=String(name||'').trim().slice(0,60);
  if(!nm)return null;
  const same=_svcTypes().find(t=>t.name.toLowerCase()===nm.toLowerCase());
  if(same)return same;
  const st=Object.assign({},_svcSettings());
  let key='c-'+(_svcSlug(nm)||'service');
  while(st[key]||_SVC_BUILTIN.some(t=>t.key===key))key+='-2';
  st[key]={custom:true,name:nm,months:_svcValidMonths(months)||12};
  S.serviceTypes=st;
  if(typeof _settingsChanged==='function')_settingsChanged();else S.settingsTs=Date.now();
  return _svcType(key);
}
function openSvcTypes(){
  document.getElementById('_svc-types-ov')?.remove();
  const ov=document.createElement('div');ov.id='_svc-types-ov';ov.className='zmodal-overlay';
  ov.onclick=ev=>{if(ev.target===ov)ov.remove();};
  const m=document.createElement('div');m.className='zmodal td-wh-form';m.style.maxWidth='440px';
  const types=_svcTypesOrdered();
  m.innerHTML=
    '<div class="zmodal-title">How often</div>'+
    '<div class="td-wh-form-sub">The default for each service. You can still change it for one customer.</div>'+
    '<div class="sf-card td-wh-form-card" style="margin-top:14px"><div class="sf-list">'+
      types.map(t=>'<div class="sf-row"><div class="sf-body"><span class="sf-lbl">'+escHtml(t.name)+'</span>'+_svcEveryField('_svc-t-'+t.key,t.months)+'</div></div>').join('')+
      '<div class="sf-row"><div class="sf-body"><span class="sf-lbl">Add your own</span>'+
        '<div class="td-svc-own"><input id="_svc-own-name" autocapitalize="sentences" placeholder="Dryer vent cleaning"><button type="button" id="_svc-own-add" class="td-svc-chip">Add</button></div>'+
      '</div></div>'+
    '</div></div>'+
    '<div id="_svc-types-err" style="display:none;color:var(--c-red);font-size:12.5px;font-weight:600;margin:-2px 2px 8px"></div>'+
    '<button id="_svc-types-save" class="btn btn-g sf-cta">Save</button>';
  ov.appendChild(m);document.body.appendChild(ov);
  _svcWireEvery(m);
  const err=t=>{const x=document.getElementById('_svc-types-err');x.textContent=t;x.style.display='block';};
  document.getElementById('_svc-own-add').onclick=()=>{
    const nm=document.getElementById('_svc-own-name').value.trim();
    if(!nm){document.getElementById('_svc-own-name').focus();return;}
    svcAddCustomType(nm,12);
    openSvcTypes();
    _whRefresh();
  };
  document.getElementById('_svc-types-save').onclick=()=>{
    const vals=types.map(t=>({t,v:_svcValidMonths(document.getElementById('_svc-t-'+t.key).value)}));
    const bad=vals.find(x=>!x.v);
    if(bad){err(bad.t.name+': pick 1 to 24 months.');return;}
    vals.forEach(x=>svcSetTypeMonths(x.t.key,x.v));
    if(typeof _settingsChanged==='function')_settingsChanged();else S.settingsTs=Date.now();
    ov.remove();
    _whRefresh();
    if(typeof showToast==='function')showToast('Saved','✓');
  };
}

// ── Text ────────────────────────────────────────────────────────────────────
// The contractor writes the message once per service, in their own words, and
// it is kept for the next customer if they want it (owner 2026-09-25). {name}
// becomes the customer's first name. It still goes out through the phone's own
// Messages app like every other text in TradeDesk, from their own number. The
// heater's message stays on S.whFlushMsg, where it has always been.
function _whFillMsg(tpl,c){
  const first=String((c&&c.name)||'').trim().split(/\s+/)[0]||'';
  return String(tpl||'').replace(/\{name\}/gi,first);
}
function _svcSavedMsg(t){
  if(!t)return '';
  if(t.key===_SVC_WH)return typeof S.whFlushMsg==='string'?S.whFlushMsg:'';
  const v=_svcSettings()[t.key];
  return v&&typeof v.msg==='string'?v.msg:'';
}
function _svcSaveMsg(t,tpl){
  if(!t||_svcSavedMsg(t)===tpl)return;
  if(t.key===_SVC_WH)S.whFlushMsg=tpl;
  else{
    const st=Object.assign({},_svcSettings());
    st[t.key]=Object.assign({},st[t.key]||{},t.custom?{custom:true,name:t.name,months:t.months}:{},{msg:tpl});
    S.serviceTypes=st;
  }
  S.settingsTs=Date.now();
}
function whTextFlush(id){
  const e=_whFind(id);if(!e)return;
  const c=_whClient(e.clientId);
  if(!c||!c.phone){if(typeof showToast==='function')showToast('No phone number on file','⚠');return;}
  const t=_svcTypeOf(e);
  document.getElementById('_wh-text-ov')?.remove();
  const ov=document.createElement('div');ov.id='_wh-text-ov';ov.className='zmodal-overlay';
  ov.onclick=ev=>{if(ev.target===ov)ov.remove();};
  const m=document.createElement('div');m.className='zmodal';m.style.maxWidth='420px';
  const saved=_svcSavedMsg(t);
  m.classList.add('td-wh-form');
  m.innerHTML=
    '<div class="zmodal-title">Text '+escHtml(c.name||'')+'</div>'+
    '<div class="td-wh-form-sub">'+escHtml(t.name)+'. Write it once. {name} fills in their first name.</div>'+
    '<div class="sf-card td-wh-form-card" style="margin-top:14px"><div class="sf-list">'+
      '<div class="sf-row"><div class="sf-body"><span class="sf-lbl">Message</span>'+
        '<textarea id="_wh-msg" rows="5" placeholder="'+escHtml(t.msg)+'">'+escHtml(saved)+'</textarea>'+
      '</div></div>'+
      '<div class="sf-row"><div class="sf-body"><span style="font-size:15px;font-weight:600;color:var(--text)">Use this every time</span></div>'+
        '<label class="sf-switch"><input id="_wh-save" type="checkbox"'+(saved?'':' checked')+'><span class="sf-track"></span><span class="sf-knob"></span></label>'+
      '</div>'+
    '</div></div>'+
    '<button id="_wh-send" class="btn btn-g sf-cta">'+svgIcon('💬',{size:16})+' Open Messages</button>';
  ov.appendChild(m);document.body.appendChild(ov);
  document.getElementById('_wh-send').onclick=()=>{
    const tpl=document.getElementById('_wh-msg').value.trim();
    if(!tpl){document.getElementById('_wh-msg').focus();return;}
    if(document.getElementById('_wh-save').checked)_svcSaveMsg(t,tpl);
    e.whTextedAt=new Date().toISOString();
    e.updatedAt=e.whTextedAt;
    try{if(typeof autoLogContact==='function')autoLogContact(c.id,'contact');}catch(_e){}
    if(typeof saveAll==='function')saveAll();
    ov.remove();
    _whRefresh();
    const body=_whFillMsg(tpl,c);
    _whOpenSms('sms:'+String(c.phone).replace(/\D/g,'')+'&body='+encodeURIComponent(body));
  };
}
// Its own function so a test can catch the link instead of navigating.
function _whOpenSms(url){try{window.location.href=url;}catch(_e){}}

// ── Schedule ────────────────────────────────────────────────────────────────
// The real scheduler, prefilled (owner 2026-09-25), not a second booking
// form. scheduleJob (js/finance.js) reads _schedPrefill for the client a
// proposal-less job belongs to, and calls whFlushBooked once it is on the
// calendar so the row leaves the board.
function whScheduleFlush(id){
  const e=_whFind(id);if(!e)return;
  const c=_whClient(e.clientId);
  if(!c)return;
  const t=_svcTypeOf(e);
  goPg('pg-schedule');
  setTimeout(()=>{
    if(typeof setSchedType==='function')setSchedType('job',document.getElementById('sched-tab-job'));
    window._schedPrefill={clientId:c.id,whEqId:e.id};
    const set=(k,val)=>{const f=document.getElementById(k);if(f)f.value=val;};
    set('s-name',(c.name||'Customer')+', '+t.name.toLowerCase());
    set('s-addr',c.addr||'');
    set('s-days',1);
    set('s-buf','0');
    const valRow=document.getElementById('s-value-row');if(valRow)valRow.style.display='';
    const tip=document.getElementById('sched-tip');
    if(tip){tip.innerHTML='<strong>'+escHtml(t.name)+' for '+escHtml(c.name||'')+'.</strong> Pick a day.';tip.className='tip tip-s';}
    if(typeof _schedSiteNote==='function')try{_schedSiteNote(c.id);}catch(_e){}
    try{
      const na=getNextAvail();
      set('s-start',na.key);
      availYear=parseD(na.key).getFullYear();availMonth=parseD(na.key).getMonth();
    }catch(_e){}
    try{refreshAvail();updateSchedPreview();}catch(_e){}
  },150);
}
function whFlushBooked(eqId,job){
  const e=_whFind(eqId);if(!e||!job)return;
  if(!Array.isArray(e.flushLog))e.flushLog=[];
  e.flushLog.push({date:job.start,how:'us',jobId:job.id,at:new Date().toISOString()});
  e.updatedAt=new Date().toISOString();
}

// ── Doing it themselves ─────────────────────────────────────────────────────
// Logged as done today, so the clock restarts and they are back on the board
// one interval from now (owner 2026-09-25). No "are you sure": an Undo on the
// toast instead, which is how iOS handles a one-tap action you might slip on.
function whMarkDiy(id){
  const e=_whFind(id);if(!e)return;
  if(!Array.isArray(e.flushLog))e.flushLog=[];
  const at=new Date().toISOString();
  e.flushLog.push({date:todayKey(),how:'diy',at});
  e.updatedAt=at;
  if(typeof saveAll==='function')saveAll();
  _whRefresh();
  const n=_svcMonths(e)-_svcLead(e);
  const eid=escHtml(String(e.id));
  if(typeof showToast==='function')showToast('Back on the board in '+n+' month'+(n===1?'':'s')+' <button class="td-wh-undo" onclick="whUndoDiy(\''+eid+'\',\''+at+'\');this.closest(\'.toast\')?.remove()">Undo</button>','✓',5000);
}
function whUndoDiy(id,at){
  const e=_whFind(id);if(!e||!Array.isArray(e.flushLog))return false;
  const i=e.flushLog.findIndex(f=>f&&f.how==='diy'&&f.at===at);
  if(i<0)return false;
  e.flushLog.splice(i,1);
  e.updatedAt=new Date().toISOString();
  if(typeof saveAll==='function')saveAll();
  _whRefresh();
  return true;
}

// ── "What did Dana say?" ────────────────────────────────────────────────────
// Tapping the row asks for the customer's answer instead of making the
// contractor find the right button. Same centered .zmodal as every other
// prompt in the app (§7.3).
function whAsk(id){
  const e=_whFind(id);if(!e)return;
  const c=_whClient(e.clientId);if(!c)return;
  const t=_svcTypeOf(e);
  const first=String(c.name||'').trim().split(/\s+/)[0]||'they';
  document.getElementById('_wh-ask-ov')?.remove();
  const ov=document.createElement('div');ov.id='_wh-ask-ov';ov.className='zmodal-overlay';
  ov.onclick=ev=>{if(ev.target===ov)ov.remove();};
  const m=document.createElement('div');m.className='zmodal';m.style.maxWidth='380px';
  const close=()=>ov.remove();
  // An iOS action sheet's anatomy inside the app's own centered .zmodal: a
  // quiet header, the answers as one grouped list, and the way out on its own.
  m.classList.add('td-wh-sheet');
  m.innerHTML=
    '<div class="td-wh-sheet-hd">'+
      '<div class="td-wh-av td-wh-av-roll td-wh-sheet-av">'+escHtml(initials(c.name||'?'))+'</div>'+
      '<div class="zmodal-title">What did '+escHtml(first)+' say?</div>'+
      '<div class="td-wh-sheet-sub">'+escHtml(c.name||'')+' · '+escHtml(t.name)+'</div>'+
    '</div>'+
    '<div class="td-wh-sheet-group">'+
      '<button id="_wh-ask-sched" class="td-wh-sheet-row td-wh-sheet-go">'+svgIcon('📅',{size:18})+'<span>Schedule it</span></button>'+
      '<button id="_wh-ask-diy" class="td-wh-sheet-row">'+svgIcon('✓',{size:18})+'<span>Doing it themselves</span></button>'+
      '<button id="_wh-ask-none" class="td-wh-sheet-row">'+svgIcon('⏳',{size:18})+'<span>No answer yet</span></button>'+
    '</div>'+
    '<button id="_wh-ask-open" class="td-wh-sheet-open">Open customer</button>';
  ov.appendChild(m);document.body.appendChild(ov);
  document.getElementById('_wh-ask-sched').onclick=()=>{close();whScheduleFlush(e.id);};
  document.getElementById('_wh-ask-diy').onclick=()=>{close();whMarkDiy(e.id);};
  document.getElementById('_wh-ask-none').onclick=()=>{close();whRollOver(e.id);};
  document.getElementById('_wh-ask-open').onclick=()=>{close();if(typeof openClientDetail==='function')openClientDetail(c.id);};
}

// ── Swipe ───────────────────────────────────────────────────────────────────
// Right = Schedule, left = Doing it themselves; past a third of the row it
// commits, anything short springs back. Vertical movement hands the gesture
// back to the page so scrolling the dashboard never trips a row.
function _whWireSwipes(root){
  if(!root)return;
  root.querySelectorAll('.td-wh-swipe').forEach(wrap=>{
    const rowEl=wrap.querySelector('.td-wh-row');
    if(!rowEl)return;
    let x0=0,y0=0,dx=0,live=false,dead=false;
    rowEl.addEventListener('touchstart',ev=>{const t=ev.touches[0];x0=t.clientX;y0=t.clientY;dx=0;live=false;dead=false;rowEl.style.transition='none';},{passive:true});
    rowEl.addEventListener('touchmove',ev=>{
      if(dead)return;
      const t=ev.touches[0];const mx=t.clientX-x0,my=t.clientY-y0;
      if(!live){
        if(Math.abs(my)>10&&Math.abs(my)>Math.abs(mx)){dead=true;return;}
        if(Math.abs(mx)<10)return;
        live=true;
      }
      dx=mx;
      rowEl.style.transform='translateX('+dx+'px)';
      wrap.classList.toggle('td-wh-go-l',dx>0);
      wrap.classList.toggle('td-wh-go-r',dx<0);
    },{passive:true});
    rowEl.addEventListener('touchend',()=>{
      if(!live)return;
      const w=rowEl.offsetWidth||1;
      rowEl.style.transition='transform .18s cubic-bezier(.22,1,.36,1)';
      rowEl.style.transform='';
      // A swipe is not a tap: swallow the click the browser fires after it.
      rowEl.addEventListener('click',ev=>{ev.stopPropagation();},{capture:true,once:true});
      const id=wrap.dataset.wh;
      if(dx>w/3)whScheduleFlush(id);
      else if(dx<-w/3)whMarkDiy(id);
    });
  });
}

// ── Getting the books in ────────────────────────────────────────────────────
function whAddFromProposals(){
  const finds=_whProposalFinds();
  finds.forEach(f=>{
    const row=saveEquipment({clientId:f.clientId,kind:_WH_KIND,installed:f.date});
    if(row){row.source='proposal';row.bidId=f.bid.id;}
  });
  if(finds.length&&typeof saveAll==='function')saveAll();
  _whRefresh();
  if(typeof showToast==='function')showToast(finds.length+' added','✓');
}
function whSkipProposals(){
  const ids=_whProposalFinds().map(f=>f.bid.id);
  S.whSkippedBids=[...(Array.isArray(S.whSkippedBids)?S.whSkippedBids:[]),...ids];
  S.settingsTs=Date.now();
  if(typeof saveAll==='function')saveAll();
  _whRefresh();
}

// One small form, two ways in: a customer who is not in the app yet, or one
// who is. The service is picked first (chips, the trade's services first), and
// the interval comes prefilled from that service's default. It stays open
// after each save, on the same service, so a stack of old invoices goes in one
// after another without reopening anything.
let _svcAddKind=null;
const _SVC_CUSTOM='__custom';
function svcAddPick(key){
  const ov=document.getElementById('_wh-add-ov');
  const val=id=>{const x=document.getElementById(id);return x?x.value:'';};
  const keep=ov?{name:val('_wh-name'),phone:val('_wh-phone'),addr:val('_wh-addr'),client:val('_wh-client'),date:val('_wh-date'),custom:val('_svc-custom-name')}:{};
  _svcAddKind=String(key||'');
  openWhAdd(ov&&ov.dataset.md==='client'?'client':'new',keep);
}
function _svcAddSub(t,months){
  const n=months-(t&&t.lead&&months>t.lead?t.lead:0);
  return (t?t.name+'. ':'')+'They show up on the board '+n+' month'+(n===1?'':'s')+' after this date.';
}
function openWhAdd(mode,keep){
  const md=mode==='client'?'client':'new';
  const k=keep||{};
  document.getElementById('_wh-add-ov')?.remove();
  const ov=document.createElement('div');ov.id='_wh-add-ov';ov.className='zmodal-overlay';ov.dataset.md=md;
  ov.onclick=ev=>{if(ev.target===ov){ov.remove();_whRefresh();}};
  const m=document.createElement('div');m.className='zmodal';m.style.maxWidth='420px';
  const types=_svcTypesOrdered();
  const kind=_svcAddKind===_SVC_CUSTOM||types.some(t=>t.key===_svcAddKind)?_svcAddKind:types[0].key;
  const t=kind===_SVC_CUSTOM?null:_svcType(kind);
  const months=_svcValidMonths(k.months)||(t?t.months:12);
  const have=new Set(_whUnits().filter(e=>_svcKindOf(e)===kind).map(e=>String(e.clientId)));
  const opts=(typeof clients!=='undefined'?clients:[]).filter(c=>c&&c.name)
    .slice().sort((a,b)=>String(a.name).localeCompare(String(b.name)))
    .map(c=>'<option value="'+escHtml(String(c.id))+'"'+(String(k.client||'')===String(c.id)?' selected':'')+'>'+escHtml(c.name)+(have.has(String(c.id))?' (on board)':'')+'</option>').join('');
  // The app's own grouped form (.sf-card / .sf-row, the scheduler's shape):
  // label over value, rows in one rounded group, the way iOS Settings reads.
  // Each row is a <label>, so a tap anywhere on it lands in its field. That
  // matters most for the date: on iPhone an empty date input styled flat like
  // the rest of this form collapses to no height at all, and there was
  // nothing left to tap (owner 2026-09-26: "install date doesn't work").
  const row=(lbl,input)=>'<label class="sf-row"><div class="sf-body"><span class="sf-lbl">'+lbl+'</span>'+input+'</div></label>';
  const v=x=>escHtml(String(x||''));
  const chip=(key,label)=>'<button type="button" class="td-svc-chip td-svc-tchip'+(key===kind?' on':'')+'" data-svc="'+escHtml(key)+'" aria-pressed="'+(key===kind)+'" onclick="svcAddPick(\''+escHtml(key)+'\')">'+escHtml(label)+'</button>';
  m.classList.add('td-wh-form');
  m.innerHTML=
    '<div class="zmodal-title">Add a service customer</div>'+
    '<div class="td-wh-form-sub" id="_svc-add-sub">'+_svcAddSub(t,months)+'</div>'+
    '<div class="td-svc-chips" role="group" aria-label="Service">'+
      types.map(x=>chip(x.key,x.short||x.name)).join('')+chip(_SVC_CUSTOM,'Custom')+
    '</div>'+
    '<div class="sf-seg" style="margin-top:12px">'+
      '<button type="button" class="sf-seg-btn'+(md==='new'?' active':'')+'" onclick="openWhAdd(\'new\')">New customer</button>'+
      '<button type="button" class="sf-seg-btn'+(md==='client'?' active':'')+'" onclick="openWhAdd(\'client\')">Existing client</button>'+
    '</div>'+
    '<div class="sf-card td-wh-form-card"><div class="sf-list">'+
      (kind===_SVC_CUSTOM?row('Service','<input id="_svc-custom-name" autocapitalize="sentences" placeholder="Dryer vent cleaning" value="'+v(k.custom)+'">'):'')+
      (md==='new'?
        row('Name','<input id="_wh-name" autocapitalize="words" placeholder="Jane Smith" value="'+v(k.name)+'">')+
        row('Phone','<input id="_wh-phone" type="tel" inputmode="tel" placeholder="(555) 555-5555" value="'+v(k.phone)+'">')+
        row('Address','<input id="_wh-addr" placeholder="Optional" value="'+v(k.addr)+'">')
      :
        row('Client','<select id="_wh-client"><option value="">Pick a client</option>'+opts+'</select>')
      )+
      row(t?t.dateLbl:_SVC_WORDS.dateLbl,'<input id="_wh-date" type="date" value="'+v(k.date)+'">')+
      '<div class="sf-row"><div class="sf-body"><span class="sf-lbl">Every</span>'+_svcEveryField('_svc-months',months)+'</div></div>'+
    '</div></div>'+
    '<div id="_wh-err" style="display:none;color:var(--c-red);font-size:12.5px;font-weight:600;margin:-2px 2px 8px"></div>'+
    '<button id="_wh-add-save" class="btn btn-g sf-cta">Add to board</button>'+
    '<button id="_wh-add-types" class="sf-clear">Change default intervals</button>'+
    '<button id="_wh-add-done" class="sf-clear">Done</button>';
  ov.appendChild(m);document.body.appendChild(ov);
  _svcWireEvery(m);
  const mi=document.getElementById('_svc-months');
  mi.addEventListener('input',()=>{
    const n=_svcValidMonths(mi.value);if(!n)return;
    document.getElementById('_svc-add-sub').textContent=_svcAddSub(t,n);
  });
  const err=x=>{const e=document.getElementById('_wh-err');e.textContent=x;e.style.display='block';};
  document.getElementById('_wh-add-done').onclick=()=>{ov.remove();_whRefresh();};
  document.getElementById('_wh-add-types').onclick=()=>{ov.remove();openSvcTypes();};
  document.getElementById('_wh-add-save').onclick=()=>{
    const isWh=kind===_SVC_WH;
    const date=_whParseDate(document.getElementById('_wh-date').value);
    if(!date){err(isWh?'Pick the install date.':'Pick when it was last done.');return;}
    if(date>todayKey()){err(isWh?'The install date is in the future.':'That date is in the future.');return;}
    const n=_svcValidMonths(mi.value);
    if(!n){err('Pick how often, 1 to 24 months.');return;}
    let customName='';
    if(kind===_SVC_CUSTOM){
      customName=document.getElementById('_svc-custom-name').value.trim();
      if(!customName){err('Name the service.');return;}
    }
    let cid=null,who='';
    if(md==='new'){
      const name=document.getElementById('_wh-name').value.trim();
      if(!name){err('Enter a name.');return;}
      const addr=document.getElementById('_wh-addr').value.trim();
      const c={id:_newId(),name,phone:document.getElementById('_wh-phone').value.trim(),email:'',
        addr,street:addr,city:'',state:'',zip:'',source:'Existing Contact',ref:'',notes:'',
        created:todayKey(),ptype:'',extraAddresses:[],clientToken:'',clientHubKey:''};
      _clientCommitNew(c);
      cid=c.id;who=name;
    }else{
      const raw=document.getElementById('_wh-client').value;
      const c=raw?_whClient(raw):null;
      if(!c){err('Pick a client.');return;}
      cid=c.id;who=c.name||'';
    }
    const type=kind===_SVC_CUSTOM?svcAddCustomType(customName,n):t;
    if(!type){err('Name the service.');return;}
    const row=saveEquipment({clientId:cid,kind:type.kind||type.name,installed:date});
    if(row){
      row.source='manual';
      row.serviceKind=type.key;
      if(type.custom)row.serviceName=type.name;
      if(n!==type.months)row.serviceMonths=n;
    }
    if(typeof saveAll==='function')saveAll();
    if(typeof showToast==='function')showToast(who+' added','✓');
    // Ready for the next one, on the same service and interval.
    _svcAddKind=type.key;
    openWhAdd(md,{months:n});
  };
}
