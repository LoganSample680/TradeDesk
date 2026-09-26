// ── Water heater flush board (owner 2026-09-25) ──────────────────────────────
// A rolling 11-month board pinned to the top of the dashboard: every water
// heater the contractor put in (or last flushed) 11 or more months ago, with
// the customer's name, that date, a Text button, and the two answers the
// customer can give: "put me on the schedule" or "I'll do it myself".
//
// NO NEW STORE (§7.3). A water heater is already a record: the client
// equipment list (js/equipment.js, synced as td_equipment) has a 'Water
// heater' kind, so a unit logged off a data plate on a job lands on this
// board with nobody filing anything. The board only adds two fields to that
// row: flushLog (one entry per flush, ours or the customer's) and whTextedAt.
//
// Everything on the board is DERIVED at read time from those rows, so a flush
// job that gets canceled simply stops counting and the customer comes back on
// their own. Nothing sweeps, nothing reconciles.
//
// Three ways onto the board, because the owner's books are not all in the app:
//   1. Won proposals that mention a water heater (one tap adds them all).
//   2. Quick add: name, phone, install date, for customers who never had a
//      proposal in TradeDesk.
//   3. Pick an existing client and give it an install date.

const _WH_KIND='Water heater';
const _WH_CYCLE_MO=11;

function _whUnits(){
  const list=(typeof getEquipment==='function')?getEquipment():[];
  return list.filter(e=>e&&e.kind===_WH_KIND);
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

// The date the 11-month clock runs from: the latest of the install and every
// flush that still counts.
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
function _whDueKey(e){
  const last=_whLastService(e);
  return last?_whAddMonths(last.date,_WH_CYCLE_MO):null;
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
  const onBoard=new Set(_whUnits().map(e=>String(e.clientId)));
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
// Anyone else sees it once a water heater exists or a proposal names one.
// A plumber is anyone with plumbing among their trades, not only when plumbing
// is the pill they have selected (owner 2026-09-26: a landscaper who also runs
// a plumbing line lost the board every time the switcher sat on landscaping).
function _whPlumbs(){
  const active=(typeof getActiveTrade==='function')?getActiveTrade():'';
  if(active==='plumbing')return true;
  const lines=(typeof _getTradeLines==='function')?_getTradeLines():[];
  return Array.isArray(lines)&&lines.indexOf('plumbing')>=0;
}
function _whBoardVisible(){
  if(typeof _isEmployee!=='undefined'&&_isEmployee)return false;
  if(_whUnits().length)return true;
  if(_whPlumbs())return true;
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

function _renderWhBoard(){
  const el=document.getElementById('dash-wh-board');
  if(!el)return;
  if(!_whBoardVisible()){el.style.display='none';el.innerHTML='';return;}
  const tk=todayKey();
  const units=_whUnits();
  const due=[],later=[],undated=[],rolled=[];
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
  due.sort((a,b)=>a.dk<b.dk?-1:a.dk>b.dk?1:0);
  later.sort((a,b)=>a.dk<b.dk?-1:a.dk>b.dk?1:0);
  const finds=_whProposalFinds();

  // The iOS shape (owner 2026-09-25: "think about it in an iOS way", then
  // "premium like iOS"): an inset list, a leading avatar, the one button you
  // use first, and the status said in words ("Due now", "2 mo overdue")
  // rather than as arithmetic the contractor has to do. Everything else is
  // the answer the customer gave: tapping the row asks "What did Dana say?"
  // and a swipe does the same thing in one motion, the way Mail does.
  const row=({e,c,last,dk})=>{
    const lbl=last.how==='install'?'Installed':last.how==='diy'?'Flushed by customer':'Flushed';
    // Both marks belong to THIS cycle only: a text or a rollover from before
    // the last flush must not follow the customer into next year.
    const since=k=>!!k&&String(k).slice(0,10)>=last.date;
    // Whichever happened last speaks: texted after it rolled over is waiting
    // again, rolled over after a text is a rollover.
    const tx=since(e.whTextedAt)?String(e.whTextedAt):'',rl=since(e.whSnoozedAt)?String(e.whSnoozedAt):'';
    const over=Math.max(0,_whMonthsSince(dk));
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
          '<div class="td-wh-sub">'+lbl+' '+_whFmt(last.date)+'</div>'+
          status+
        '</div>'+
        '<button class="btn td-wh-txt" onclick="event.stopPropagation();whTextFlush(\''+eid+'\')"'+(c.phone?'':' disabled title="No phone on file"')+'>'+svgIcon('💬',{size:14})+'<span>Text</span></button>'+
      '</div>'+
    '</div>';
  };

  const next=later[0];
  const sub=due.length?due.length+' due':'all caught up';
  el.style.display='block';
  el.innerHTML=
    '<div class="card td-wh-card">'+
      '<div class="td-wh-hd">'+
        '<div class="td-wh-ico">'+svgIcon('💧',{size:18})+'</div>'+
        '<div class="td-wh-hd-txt" onclick="goPg(\'pg-wh-list\')" role="button" aria-label="See every water heater">'+
          '<div class="td-wh-title">Annual service'+(due.length?'<span class="td-wh-count">'+due.length+'</span>':'')+'</div>'+
          '<div class="td-wh-hd-sub">Water heater flushes · '+sub+'</div>'+
        '</div>'+
        '<button class="td-wh-add" onclick="openWhAdd()" aria-label="Add a water heater install">'+svgIcon('➕',{size:16})+'</button>'+
      '</div>'+
      (finds.length?
        '<div class="td-wh-find">'+
          '<div class="td-wh-find-t">'+svgIcon('📄',{size:14})+'<span>Found '+finds.length+' water heater install'+(finds.length>1?'s':'')+' in your won proposals.</span></div>'+
          '<div class="td-wh-find-b">'+
            '<button class="btn btn-sm btn-p" onclick="whAddFromProposals()">Add '+(finds.length>1?'them':'it')+'</button>'+
            '<button class="btn btn-sm" onclick="whSkipProposals()">Not these</button>'+
          '</div>'+
        '</div>':'')+
      (due.length?'<div class="td-wh-list">'+due.map(row).join('')+'</div>':
        '<div class="td-wh-empty">'+(units.length?'Nobody is due right now.':'Add past installs and they show up here 11 months after the install.')+'</div>')+
      (units.length?
        '<div class="td-wh-foot">'+
          (next?'<div>Next up: '+escHtml(next.c.name||'Customer')+' on '+_whFmt(next.dk)+(later.length>1?' · '+(later.length-1)+' more after':'')+'</div>':'')+
          (rolled.length?'<div>'+rolled.length+' rolled to next month</div>':'')+
          (undated.length?'<div>'+undated.length+' water heater'+(undated.length>1?'s have':' has')+' no install date</div>':'')+
          '<button class="td-wh-all" onclick="goPg(\'pg-wh-list\')">See all '+units.length+'</button>'+
        '</div>':'')+
    '</div>';
  _whWireSwipes(el);
}

// Ids arrive as numbers from memory and as strings from the cloud and from
// onclick attributes, so every lookup here compares as strings.
function _whClient(id){
  if(id==null)return null;
  return (typeof clients!=='undefined'&&Array.isArray(clients)?clients:[]).find(c=>c&&String(c.id)===String(id))||null;
}
// Snoozed until the 1st of next month by "No answer yet". A snooze from an
// earlier cycle (before the last flush) is ignored, so it can never hide next
// year's reminder.
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
// Every water heater on record, grouped the way the owner thinks about them:
// who needs a call now, who is parked until next month, and who is set for
// the year (booked, done, or doing it themselves), with the date they come
// due next. Same rows, same answer sheet as the board; nothing new is stored.
let _whListQuery='';
function _whLastEvent(e,tk){
  const log=(Array.isArray(e.flushLog)?e.flushLog:[]).filter(_whFlushCounts);
  const f=log.slice().sort((a,b)=>String(a.date)<String(b.date)?1:-1)[0];
  const inst=_whParseDate(e.installed);
  if(f&&(!inst||f.date>=inst)){
    if(f.how==='diy')return {txt:'Doing it themselves, '+_whFmt(f.date),tone:'wait'};
    return f.date>tk?{txt:'Flush scheduled '+_whFmt(f.date),tone:'roll'}:{txt:'Flushed '+_whFmt(f.date),tone:'ok'};
  }
  return inst?{txt:'Installed '+_whFmt(inst),tone:'ok'}:{txt:'No install date',tone:'wait'};
}
function renderWhList(){
  const el=document.getElementById('wh-list-body');
  if(!el)return;
  const tk=todayKey();
  const q=_whListQuery.trim().toLowerCase();
  const due=[],rolled=[],later=[],undated=[];
  _whUnits().forEach(e=>{
    const c=_whClient(e.clientId);
    if(!c)return;
    if(q&&![c.name,c.phone,c.addr].some(v=>String(v||'').toLowerCase().includes(q)))return;
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
    const eid=escHtml(String(e.id));
    const right=kind==='due'?'<span class="td-wh-status td-wh-status-due">Due now</span>':
      kind==='rolled'?'<span class="td-wh-chip td-wh-chip-roll">Back '+_whFmt(e.whSnoozeUntil)+'</span>':
      kind==='later'?'<span class="td-wh-list-due">Due '+_whFmt(dk)+'</span>':'';
    const tap=kind==='due'||kind==='rolled'?'whAsk(\''+eid+'\')':'openClientDetail('+JSON.stringify(c.id).replace(/"/g,'&quot;')+')';
    return '<div class="td-wh-row td-wh-list-row" onclick="'+tap+'">'+
      '<div class="td-wh-av td-wh-av-'+(kind==='due'?'due':kind==='rolled'?'roll':ev.tone==='roll'?'roll':'wait')+'">'+escHtml(initials(c.name||'?'))+'</div>'+
      '<div class="td-wh-who">'+
        '<div class="td-wh-name">'+escHtml(c.name||'Customer')+'</div>'+
        '<div class="td-wh-sub">'+escHtml(ev.txt)+'</div>'+
      '</div>'+
      '<div class="td-wh-list-r">'+right+'<span class="td-wh-chev">'+svgIcon('▸',{size:14})+'</span></div>'+
    '</div>';
  };
  const group=(title,items,kind)=>items.length?
    '<div class="sf-cap td-wh-list-cap">'+title+' · '+items.length+'</div>'+
    '<div class="sf-card td-wh-list-card">'+items.map(i=>row(i,kind)).join('')+'</div>':'';
  const total=due.length+rolled.length+later.length+undated.length;
  const hasAny=_whUnits().length>0;
  el.innerHTML=
    '<div class="td-wh-search">'+svgIcon('🔍',{size:16})+
      '<input id="wh-list-q" type="search" placeholder="Search name, phone, address" value="'+escHtml(_whListQuery)+'" oninput="_whListQuery=this.value;renderWhList();_whListRefocus()">'+
    '</div>'+
    (total?
      group('Due now',due,'due')+
      group('Rolled to next month',rolled,'rolled')+
      group('Set for the year',later,'later')+
      group('No install date',undated,'undated')
    :'<div class="td-wh-list-empty">'+(hasAny?'Nobody matches that search.':'No water heaters yet. Tap + to add a past install.')+'</div>');
}
// Re-rendering the list replaces the search box; put the cursor back where
// the contractor was typing so the search feels like one continuous field.
function _whListRefocus(){
  const i=document.getElementById('wh-list-q');
  if(!i)return;
  i.focus();
  try{const n=i.value.length;i.setSelectionRange(n,n);}catch(_e){}
}

// ── Text ────────────────────────────────────────────────────────────────────
// The contractor writes the message once, in their own words, and it is kept
// for the next customer if they want it (owner 2026-09-25). {name} becomes the
// customer's first name. It still goes out through the phone's own Messages
// app like every other text in TradeDesk, from their own number.
function _whFillMsg(tpl,c){
  const first=String((c&&c.name)||'').trim().split(/\s+/)[0]||'';
  return String(tpl||'').replace(/\{name\}/gi,first);
}
function whTextFlush(id){
  const e=_whFind(id);if(!e)return;
  const c=_whClient(e.clientId);
  if(!c||!c.phone){if(typeof showToast==='function')showToast('No phone number on file','⚠');return;}
  document.getElementById('_wh-text-ov')?.remove();
  const ov=document.createElement('div');ov.id='_wh-text-ov';ov.className='zmodal-overlay';
  ov.onclick=ev=>{if(ev.target===ov)ov.remove();};
  const m=document.createElement('div');m.className='zmodal';m.style.maxWidth='420px';
  const saved=typeof S.whFlushMsg==='string'?S.whFlushMsg:'';
  m.classList.add('td-wh-form');
  m.innerHTML=
    '<div class="zmodal-title">Text '+escHtml(c.name||'')+'</div>'+
    '<div class="td-wh-form-sub">Write it once. {name} fills in their first name.</div>'+
    '<div class="sf-card td-wh-form-card" style="margin-top:14px"><div class="sf-list">'+
      '<div class="sf-row"><div class="sf-body"><span class="sf-lbl">Message</span>'+
        '<textarea id="_wh-msg" rows="5" placeholder="Hi {name}, it\'s been about a year since we put in your water heater. Time for its flush. Want us to schedule it, or doing it yourself this year?">'+escHtml(saved)+'</textarea>'+
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
    if(document.getElementById('_wh-save').checked&&S.whFlushMsg!==tpl){S.whFlushMsg=tpl;S.settingsTs=Date.now();}
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
  goPg('pg-schedule');
  setTimeout(()=>{
    if(typeof setSchedType==='function')setSchedType('job',document.getElementById('sched-tab-job'));
    window._schedPrefill={clientId:c.id,whEqId:e.id};
    const set=(k,val)=>{const f=document.getElementById(k);if(f)f.value=val;};
    set('s-name',(c.name||'Customer')+', water heater flush');
    set('s-addr',c.addr||'');
    set('s-days',1);
    set('s-buf','0');
    const valRow=document.getElementById('s-value-row');if(valRow)valRow.style.display='';
    const tip=document.getElementById('sched-tip');
    if(tip){tip.innerHTML='<strong>Water heater flush for '+escHtml(c.name||'')+'.</strong> Pick a day.';tip.className='tip tip-s';}
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
// Logged as a flush today, so the clock restarts and they are back on the
// board in 11 months (owner 2026-09-25). No "are you sure": an Undo on the
// toast instead, which is how iOS handles a one-tap action you might slip on.
function whMarkDiy(id){
  const e=_whFind(id);if(!e)return;
  if(!Array.isArray(e.flushLog))e.flushLog=[];
  const at=new Date().toISOString();
  e.flushLog.push({date:todayKey(),how:'diy',at});
  e.updatedAt=at;
  if(typeof saveAll==='function')saveAll();
  _whRefresh();
  const eid=escHtml(String(e.id));
  if(typeof showToast==='function')showToast('Back on the board in 11 months <button class="td-wh-undo" onclick="whUndoDiy(\''+eid+'\',\''+at+'\');this.closest(\'.toast\')?.remove()">Undo</button>','✓',5000);
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
      '<div class="td-wh-sheet-sub">'+escHtml(c.name||'')+'</div>'+
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
// who is. It stays open after each save so a stack of old invoices goes in
// one after another without reopening anything.
function openWhAdd(mode){
  const md=mode==='client'?'client':'new';
  document.getElementById('_wh-add-ov')?.remove();
  const ov=document.createElement('div');ov.id='_wh-add-ov';ov.className='zmodal-overlay';
  ov.onclick=ev=>{if(ev.target===ov){ov.remove();_whRefresh();}};
  const m=document.createElement('div');m.className='zmodal';m.style.maxWidth='420px';
  const have=new Set(_whUnits().map(e=>String(e.clientId)));
  const opts=(typeof clients!=='undefined'?clients:[]).filter(c=>c&&c.name)
    .slice().sort((a,b)=>String(a.name).localeCompare(String(b.name)))
    .map(c=>'<option value="'+escHtml(String(c.id))+'">'+escHtml(c.name)+(have.has(String(c.id))?' (on board)':'')+'</option>').join('');
  // The app's own grouped form (.sf-card / .sf-row, the scheduler's shape):
  // label over value, rows in one rounded group, the way iOS Settings reads.
  // Each row is a <label>, so a tap anywhere on it lands in its field. That
  // matters most for the date: on iPhone an empty date input styled flat like
  // the rest of this form collapses to no height at all, and there was
  // nothing left to tap (owner 2026-09-26: "install date doesn't work").
  const row=(lbl,input)=>'<label class="sf-row"><div class="sf-body"><span class="sf-lbl">'+lbl+'</span>'+input+'</div></label>';
  m.classList.add('td-wh-form');
  m.innerHTML=
    '<div class="zmodal-title">Add an install</div>'+
    '<div class="td-wh-form-sub">They show up on the board 11 months after this date.</div>'+
    '<div class="sf-seg" style="margin-top:14px">'+
      '<button type="button" class="sf-seg-btn'+(md==='new'?' active':'')+'" onclick="openWhAdd(\'new\')">New customer</button>'+
      '<button type="button" class="sf-seg-btn'+(md==='client'?' active':'')+'" onclick="openWhAdd(\'client\')">Existing client</button>'+
    '</div>'+
    '<div class="sf-card td-wh-form-card"><div class="sf-list">'+
      (md==='new'?
        row('Name','<input id="_wh-name" autocapitalize="words" placeholder="Jane Smith">')+
        row('Phone','<input id="_wh-phone" type="tel" inputmode="tel" placeholder="(555) 555-5555">')+
        row('Address','<input id="_wh-addr" placeholder="Optional">')
      :
        row('Client','<select id="_wh-client"><option value="">Pick a client</option>'+opts+'</select>')
      )+
      row('Install date','<input id="_wh-date" type="date">')+
    '</div></div>'+
    '<div id="_wh-err" style="display:none;color:var(--c-red);font-size:12.5px;font-weight:600;margin:-2px 2px 8px"></div>'+
    '<button id="_wh-add-save" class="btn btn-g sf-cta">Add to board</button>'+
    '<button id="_wh-add-done" class="sf-clear">Done</button>';
  ov.appendChild(m);document.body.appendChild(ov);
  const err=t=>{const x=document.getElementById('_wh-err');x.textContent=t;x.style.display='block';};
  document.getElementById('_wh-add-done').onclick=()=>{ov.remove();_whRefresh();};
  document.getElementById('_wh-add-save').onclick=()=>{
    const date=_whParseDate(document.getElementById('_wh-date').value);
    if(!date){err('Pick the install date.');return;}
    if(date>todayKey()){err('The install date is in the future.');return;}
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
    const row=saveEquipment({clientId:cid,kind:_WH_KIND,installed:date});
    if(row)row.source='manual';
    if(typeof saveAll==='function')saveAll();
    if(typeof showToast==='function')showToast(who+' added','✓');
    // Ready for the next one.
    openWhAdd(md);
  };
}
