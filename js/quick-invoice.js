// ── Quick invoice: bill a customer with no proposal (owner 2026-09-26) ─────
//
// Owner: "how can you do quick invoices without time for his dad and without
// proposals?" Two ways in, one screen:
//   Hourly     the lines fill in from what was tracked at the customer's jobs
//              since their last quick invoice (each person at their own bill
//              rate) plus their receipts, and he taps Send.
//   Set price  he types a few lines or picks them from the price book.
// The choice is remembered on the customer (c.qiMode), so it is asked once.
//
// A quick invoice is SAVED AS A WON BID, the same shape the diagnostic charge
// already uses (clients.js), not a new record type (CLAUDE.md 7.3). That is
// what makes Collect, payments, the pay link, the customer's hub and the
// printed invoice all work on it without a line of their own.
//
// Nothing is billed twice. The bid remembers the last visit it billed
// (qiTimeThrough) and the receipts it carried (qiExpenseIds), and the next
// quick invoice for that customer starts after them. Read-time, from the bids
// themselves: no flag is written onto a time row, so the deriver's rows
// (CLAUDE.md 17) are never touched.

let _qi=null;

// THE WHOLE LIST (owner 2026-09-26: "where is the huge quick invoice list we
// talked about? Just see a weak ass search"). It used to offer only customers
// somebody was tracked at in the last 7 days, so with no tracked visits the
// picker was a search box and nothing else. Now every customer is on it with
// their street (two Smiths told apart) and where the work stands: Working now
// first, then Scheduled, then whoever was touched most recently.
function _qiLastTouch(c){
  let t=0;
  const bump=v=>{const n=typeof v==='number'?v:Date.parse(v||'');if(!isNaN(n)&&n>t)t=n;};
  const cid=String(c.id);
  const byJob=(typeof _jobTimeEntriesByJob==='object'&&_jobTimeEntriesByJob)||{};
  (jobs||[]).forEach(j=>{
    if(!j||String(j.client_id)!==cid)return;
    bump(j.start);bump(j.completion_date);
    (byJob[j.id]||[]).forEach(e=>bump(e&&(e.arrivedAt||e.arrived_at)));
  });
  (bids||[]).forEach(b=>{if(b&&String(b.client_id)===cid){bump(b.bid_date);bump(b.created_at);}});
  (expenses||[]).forEach(e=>{if(e&&String(e.client_id)===cid)bump(e.date);});
  bump(c.last_contact_date);bump(c.created_at);
  return t;
}
// ONE WAY IN (Earl 2026-09-29): the Invoice button on Home opens the same
// Ready to bill houses first, each straight to its drafted bill, then every
// customer.
function _qiReadyPicks(){
  const rows=(_tb&&_tb.lab)?_tbRows(_tb.lab):[];
  return rows.map(r=>{
    const c=getClientById(r.cid)||{};
    return {label:r.name,sub:'Ready to bill · '+_qiMoney(r.total).replace(/\.00$/,'')+' · '+_tbSub(r),subTail:'',clientId:r.cid,addr:r.pick||'',
      // They are the list before he types. Typing is a customer search, so a
      // ready row never matches it (a zero-width space is text no search holds)
      // and the customer's own row, with its houses, answers instead.
      icon:'💵',find:'\u200b'};
  });
}
function _qiPickList(){
  const rank={now:0,next:1,done:2};
  const ready=_qiReadyPicks();
  // A one-house customer already on top is not listed again until he types.
  const dup=new Set(ready.filter(p=>clientAddresses(getClientById(p.clientId)).length<=1).map(p=>String(p.clientId)));
  return ready.concat((clients||[]).filter(c=>c&&c.name&&!c.archived).map(c=>{
    const st=_qiStatus(c.id);
    return {c,st,r:st?rank[st.k]:3,t:_qiLastTouch(c)};
  }).sort((a,b)=>(a.r-b.r)||(b.t-a.t)||String(a.c.name).localeCompare(String(b.c.name)))
    .map(({c,st})=>({label:c.name,sub:clientAddrSub(c)+(st?' · '+st.label:''),subTail:st?' · '+st.label:'',clientId:c.id,icon:'📍',dup:dup.has(String(c.id)),
      find:clientSearchText(c)})));
}
// Is the work at this customer going on, finished, or still to come? One
// word, next to their name, so nobody bills a job that is still running
// (owner 2026-09-26: "easy way to tell if a job is done or actively running
// is a must, by client name and address").
//   Working now   somebody was tracked there today, or a job is on today
//   Scheduled     the next open job starts later
//   Done          the last job was marked done (or everything is closed)
function _qiStatus(cid){
  const today=todayKey();
  const mine=(jobs||[]).filter(j=>j&&String(j.client_id)===String(cid));
  if(!mine.length)return null;
  const byJob=(typeof _jobTimeEntriesByJob==='object'&&_jobTimeEntriesByJob)||{};
  const here=mine.some(j=>(byJob[j.id]||[]).some(e=>{
    const a=Date.parse(e&&(e.arrivedAt||e.arrived_at)||'');
    return !isNaN(a)&&dateKey(new Date(a))===today;
  }));
  if(here||mine.some(j=>typeof _jobActiveOn==='function'&&_jobActiveOn(j,today)))return {k:'now',label:'Working now'};
  const closed=j=>j.status==='done'||j.completion_date||j.cancelled;
  const next=mine.filter(j=>!closed(j)&&(j.start||'')>today).sort((a,b)=>String(a.start).localeCompare(String(b.start)))[0];
  if(next)return {k:'next',label:'Scheduled '+_qiDay(next.start)};
  const done=mine.filter(j=>j.completion_date).sort((a,b)=>String(b.completion_date).localeCompare(String(a.completion_date)))[0];
  if(done)return {k:'done',label:'Done '+_qiDay(done.completion_date)};
  return null;
}
function _qiStatusPill(cid){
  const st=_qiStatus(cid);
  return st?'<span class="qi-st qi-st-'+st.k+'">'+escHtml(st.label)+'</span>':'';
}
function openQuickInvoicePicker(){
  const list=_qiPickList();
  showQuickPicker('Invoice','Who is it for?',list,'invoice',true,list.some(p=>p.icon==='💵')?'Ready to bill first, then your customers':'Your customers',{searchFirst:true});
}

// Everything this customer has been billed for on a quick invoice already.
// A property's invoice covers that house; an invoice from before invoices had
// a property (no qiAddr) covered every house, so it counts for all of them.
function _qiSameAddr(a,b){return !a||!b||_addrKey(a)===_addrKey(b);}
// BILLED BY THE DAY (owner 2026-09-29, Earl's audit): an invoice remembers
// the days it carried (qiDays), not a "billed through" moment. A through-mark
// lost a day he left for later: skip Tuesday, bill Wednesday, and Tuesday fell
// behind the mark and never came back. Invoices from before this carry
// qiTimeThrough and are still honored for what they covered.
// Days he settled outside the app (cash, another invoice, before TradeDesk)
// live on the customer (c.qiElsewhere): they are not a sale, so they must not
// count as revenue the way a saved invoice does.
function _qiBilled(cid,addr){
  let through=0;const exp=new Set(),days=new Set();
  (bids||[]).forEach(b=>{
    if(!b||b.kind!=='quick_invoice'||String(b.client_id)!==String(cid))return;
    if(!_qiSameAddr(b.qiAddr,addr))return;
    const t=Date.parse(b.qiTimeThrough||'');if(t>through)through=t;
    (b.qiDays||[]).forEach(d=>days.add(String(d)));
    (b.qiExpenseIds||[]).forEach(id=>exp.add(String(id)));
  });
  const c=getClientById(cid);
  ((c&&Array.isArray(c.qiElsewhere))?c.qiElsewhere:[]).forEach(x=>{
    if(!x||!_qiSameAddr(x.addr,addr))return;
    (x.days||[]).forEach(d=>days.add(String(d)));
    (x.expIds||[]).forEach(id=>exp.add(String(id)));
  });
  return {through,exp,days};
}
// A person's bill rate: the one lookup every screen uses (personBillRate,
// js/data.js), else the business's labor rate. Time rows carry the person's
// NAME only (cloud.js _crewMemberName), so the key here is the name.
function _qiRateFor(name){
  const r=personBillRate(name);
  return r>0?r:(Number(typeof S!=='undefined'&&S.laborRate)||0);
}
// A rate he types for somebody who has none yet becomes theirs, so the next
// invoice and the next estimate already know it (Earl: "set it once"). A rate
// they already have is changed for this invoice only.
function _qiRememberRate(name,rate){
  if(rate>0&&!(personBillRate(name)>0))setPersonBillRate(name,rate);
}
// RIDERS (owner 2026-09-29): somebody with no phone in the app who works
// beside somebody who has one. John rides with Jack: every day Jack has hours
// at a house, John is on that day's bill with the same hours at his own rate,
// unless John tracked that day himself. One setting, rider -> lead.
function _qiRiders(){return (typeof S!=='undefined'&&S&&S.qiRiders&&typeof S.qiRiders==='object')?S.qiRiders:{};}
function _qiRiderLine(day,rider,lead,mins){
  const rate=_qiRateFor(rider);
  const detail=_qiMins(mins)+', rode with '+String(lead).split(' ')[0];
  return {kind:'time',day,who:rider,mins,rate,rider:lead,detail,desc:rider+': '+detail,amount:Math.round(mins/60*rate*100)/100};
}
function _qiMins(m){const h=Math.floor(m/60),mm=Math.round(m%60);return ((h?h+'h ':'')+(mm||!h?mm+'m':'')).trim();}
function _qiDay(d){const t=Date.parse(String(d||'')+'T12:00:00');return isNaN(t)?'':new Date(t).toLocaleDateString('en-US',{month:'short',day:'numeric'});}
function _qiMoney(n){return '$'+(Math.round((Number(n)||0)*100)/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}

// A job with a real proposal behind it (T&M, BYO, a painting bid) is billed
// from that job, where its deposit and payments are already counted. Its time
// never lands on a quick invoice, or it would be billed twice.
function _qiPropBid(j){
  if(!j||j.bid_id==null)return null;
  const b=(bids||[]).find(x=>String(x.id)===String(j.bid_id));
  return (b&&b.kind!=='quick_invoice'&&b.kind!=='diagnostic')?b:null;
}
function _qiPropJobs(cid){
  const seen=new Set(),out=[];
  (jobs||[]).forEach(j=>{
    if(!j||String(j.client_id)!==String(cid))return;
    const b=_qiPropBid(j);if(!b||seen.has(b.id))return;
    seen.add(b.id);
    const paid=typeof getBidPaid==='function'?getBidPaid(b.id):0;
    const owed=typeof getBidBalance==='function'?getBidBalance(b):0;
    if(owed<0.01&&paid>0)return;               // paid in full: settled, nothing to say
    out.push({id:b.id,name:(typeof _estimateTypeLabel==='function'?_estimateTypeLabel(b):b.type)||'Job',paid});
  });
  return out;
}
// WHERE THE TIME ACTUALLY IS (2026-09-26, owner on John Doe: "yes there is
// time at John Doe"). This read only _jobTimeEntriesByJob, the job_id rows,
// and the tracker has not written a job_id since the deriver took over
// (CLAUDE.md 17): a visit is a row with job_id null whose dest_place is the
// fence's name, "John Doe (2950 SW McClure Rd)". So his 4-hour days showed
// "Nothing tracked". Now the visits come from the same fetch Crew Cost and
// the Time Log read (_fetchCrewLabor), matched to this customer by the names
// his fences carry (the same _geoFenceName the deriver writes) and by his
// jobs' ids. Drives, supply stops, the office and dismissed rows are not time
// at a customer and never count.
// addr: one property (a landlord's rental is its own bill). None: every house.
function _qiPlaceNames(c,addr){
  const nm=(n,w)=>typeof _geoFenceName==='function'?_geoFenceName(n,w):(w?(String(n).trim()+' ('+w+')'):String(n).trim());
  const st=a=>String(a||'').split(',')[0].trim();
  const out=new Set();
  if(!c||!c.name)return out;
  if(_qiSameAddr(c.addr,addr))out.add(nm(c.name,st(c.addr)));
  (Array.isArray(c.extraAddresses)?c.extraAddresses:[]).forEach(a=>{
    if(!a||!a.addr||!_qiSameAddr(a.addr,addr))return;
    out.add(nm(c.name,(a.label&&String(a.label).trim())||st(a.addr)));
    out.add(nm(c.name,st(a.addr)));
  });
  _qiJobsAt(c.id,addr).forEach(j=>out.add(nm(c.name,st(j.addr||j.address))));
  return out;
}
// This customer's jobs at this property (a job with no address of its own is
// at their primary).
function _qiJobsAt(cid,addr){
  const c=getClientById(cid)||{};
  return (jobs||[]).filter(j=>j&&String(j.client_id)===String(cid)&&_qiSameAddr(j.addr||j.address||c.addr,addr));
}
const _QI_NOT_A_VISIT=/^(drive|dismissed|place|unsaved|personal|shop)/;
// WHAT A CUSTOMER IS BILLED FOR (owner 2026-09-27): "drive time should have a
// toggle that's set by user level if they want to include it", then "shop time
// is time spent between jobs though, really the only billable time in time and
// materials is drive time and job site time". So job site time, plus drive
// time when S.qiBillDrive is on (the switch on this screen). Shop time is paid
// on the timesheet and never billed to a customer.
//   A drive leg that starts or ends at his place is his. A leg between him and
//     another customer is split in half, so nobody is billed for it twice.
//     Held legs (an open question on the Time Log) are not billed until answered.
const _QI_DRIVE=/^drive(?!-held)/;
function _qiVisitsFor(c,entries,names,addr,allPlaces){
  const cid=String(c.id);
  const mine=new Set(_qiJobsAt(cid,addr).filter(j=>!_qiPropBid(j)).map(j=>String(j.id)));
  const theirs=new Set((jobs||[]).filter(j=>j&&String(j.client_id)===cid).map(j=>String(j.id)));
  const places=_qiPlaceNames(c,addr);
  const who=uid=>(names&&names[uid])||(String(uid)===String(_qiBizUid())?_qiOwnerName():null);
  const isSite=e=>{
    if(e.job_id!=null&&e.job_id!=='')return mine.has(String(e.job_id));   // a proposal job's time stays on that job
    if(_QI_NOT_A_VISIT.test(String(e.source||'')))return false;
    return places.has(String(e.dest_place||'').trim())&&!theirs.has(String(e.job_id));
  };
  const list=(entries||[]).filter(e=>e&&typeof e==='object');
  const site=list.filter(isSite);
  // Every other customer place on record, so a leg to one of them is shared.
  // The rows now come back for this customer only (_qiLoadVisits), so the
  // other customers' places come from the customer book as well.
  const custPlaces=new Set(list.filter(e=>!_QI_NOT_A_VISIT.test(String(e.source||''))&&e.dest_place).map(e=>String(e.dest_place).trim()));
  // The Ready to bill card hands in every customer's places once, instead of
  // this loop running again for each customer on the list.
  if(allPlaces)allPlaces.forEach(n=>{if(!places.has(n))custPlaces.add(n);});
  else (clients||[]).forEach(o=>{if(o&&String(o.id)!==cid)_qiPlaceNames(o).forEach(n=>custPlaces.add(n));});
  const out=site.map(e=>({kind:'site',arrivedAt:e.arrived_at,departedAt:e.departed_at,minutes:e.minutes,employeeName:who(e.employee_user_id)}));
  // THE FIRST DRIVE THERE, AND ONLY THAT (owner 2026-09-29: "it would be the
  // first drive there, nothing back could count automatically"). One leg a
  // person a day, the earliest one that ends at his house; a leg from another
  // customer is split in half. Everything leaving his house, and every run to
  // the shop or the supply house, waits in Add time (_qiExtras) for him.
  const first={};
  list.forEach(e=>{
    if(!_QI_DRIVE.test(String(e.source||'')))return;
    const o=String(e.origin_place||'').trim(),d=String(e.dest_place||'').trim();
    if(!places.has(d)||places.has(o))return;
    const a=Date.parse(e.arrived_at||'');if(isNaN(a))return;
    const k=String(e.employee_user_id)+'|'+dateKey(new Date(a));
    if(!first[k]||a<Date.parse(first[k].arrived_at))first[k]=e;
  });
  Object.values(first).forEach(e=>{
    const o=String(e.origin_place||'').trim();
    const shared=custPlaces.has(o);
    const a=Date.parse(e.arrived_at||''),z=Date.parse(e.departed_at||'');
    const m=Number(e.minutes)>0?Number(e.minutes):(z>a?Math.round((z-a)/60000):0);
    out.push({kind:'drive',arrivedAt:e.arrived_at,departedAt:e.departed_at,minutes:shared?m/2:m,employeeName:who(e.employee_user_id)});
  });
  return out;
}
// On unless he turned it off: the drive there is his customer's (owner
// 2026-09-29).
function _qiBillDrive(){return !(typeof S!=='undefined'&&S&&S.qiBillDrive===false);}
function _qiSetBillDrive(on){
  S.qiBillDrive=!!on;
  if(typeof _settingsChanged==='function')_settingsChanged();
  if(!_qi)return;
  const u=_qiUnbilled(_qi.cid,_qi.visits,_qi.addr);
  _qi.base=u.lines;_qi.through=u.through;
  _qiRebuild();
  renderQuickInvoice();
}
// The lines on the screen: what was tracked, plus the time he added from the
// day (Add time), the crew he added, his rates, less what he took off.
function _qiRebuild(){
  if(!_qi)return;
  const lines=(_qi.base||[]).map(l=>Object.assign({},l));
  _qi.tracked=_qiRiderHours(_qiWithAdded(_qiKeepRates(_qiWithExtras(lines)))).filter(l=>!_qi.dropped.has(_qiLineKey(l)));
}
// A rider's hours are a guess: the same as the person he rode with, because
// nothing logged his (owner 2026-09-29: "did he spend the same amount of time
// on the job that Jack did? no way to know without them being on the app").
// So the guess is on screen, and the hours he types for that day win.
function _qiRiderHours(lines){
  const H=(_qi&&_qi.riderMins)||{};
  lines.forEach(l=>{
    if(l.kind!=='time'||!l.rider||l.extra)return;
    const m=H[l.day+'|'+l.who];
    if(!(m>=0))return;
    l.mins=m;l.amount=Math.round(m/60*l.rate*100)/100;
    l.detail=_qiMins(m)+', with '+String(l.rider).split(' ')[0];l.desc=l.who+': '+l.detail;l.riderSet=true;
  });
  return lines.filter(l=>!(l.kind==='time'&&l.rider&&!(l.mins>0)));
}
function _qiRiderSet(day,who,v){
  if(!_qi)return;
  const h=parseFloat(String(v).replace(/[^0-9.]/g,''));
  if(!(h>=0)||h>24)return;
  _qi.riderMins=Object.assign({},_qi.riderMins||{},{[day+'|'+who]:Math.round(h*60)});
  _qiRebuild();renderQuickInvoice();
}
// ANYONE WITH JACK? (owner 2026-09-29: "John doesn't have an account ... we
// would have Jack's name but we wouldn't have John's name"). Asked once, the
// first time a bill has people on the team with no time of their own: tap
// who was with him and they ride along on every invoice (S.qiRiders).
function _qiRiderCandidates(){
  if(!_qi||_qi.mode!=='hourly'||(typeof S!=='undefined'&&S&&S.qiRidersAsked))return {lead:null,list:[]};
  const time=_qi.tracked.filter(l=>l.kind==='time'&&!l.rider);
  if(!time.length)return {lead:null,list:[]};
  const per={};time.forEach(l=>{per[l.who]=(per[l.who]||0)+l.mins;});
  const lead=Object.keys(per).sort((a,b)=>per[b]-per[a])[0];
  const riders=_qiRiders();
  const list=_qiPeople().filter(n=>!per[n]&&!riders[n]&&!_qi.tracked.some(l=>l.who===n));
  return {lead,list};
}
function _qiRiderAskHtml(){
  const {lead,list}=_qiRiderCandidates();
  if(!lead||!list.length)return '';
  const first=String(lead).split(' ')[0];
  const b=(fn,label,cls)=>'<button type="button"'+(cls?' class="'+cls+'"':'')+' onclick="'+fn+'">'+escHtml(label)+'</button>';
  return '<div class="ios-group qi-ask" id="qi-ask">'+
    '<div class="ios-row"><span class="ios-lbl"><b>Anyone with '+escHtml(first)+'?</b><small>Only '+escHtml(first)+'\'s phone logged these days. Tap who was there too; they ride along from now on.</small></span></div>'+
    '<div class="qi-pb qi-crew">'+list.map(n=>b('_qiRiderPick(\''+escHtml(n).replace(/'/g,'&#39;')+'\',\''+escHtml(lead).replace(/'/g,'&#39;')+'\')',n.split(' ')[0])).join('')+
      b('_qiRiderNone()','Just '+first,'qi-ask-no')+'</div></div>';
}
function _qiRiderPick(name,lead){
  if(typeof S==='undefined'||!S)return;
  S.qiRidersAsked=true;
  _qiRideAlways(name,lead);
}
function _qiRiderNone(){
  if(typeof S==='undefined'||!S)return;
  S.qiRidersAsked=true;
  if(typeof _settingsChanged==='function')_settingsChanged();
  renderQuickInvoice();
}
function _qiLineKey(l){return (l.day||'')+'|'+(l.kind||'')+'|'+(l.who||l.desc||'')+'|'+(l.extra||'');}
// ── ADD TIME FROM THE DAY (Jack 2026-09-29, the Tagen Burnett bid: the app
// said 2 hours on site, the real day was 4 with two techs, because the supply
// house, the shop and the drives back were never tied to Tagen) ────────────
// Owner's rules: time on site and the first drive there are his for certain
// (_qiVisitsFor). A run to the supply house or the shop that leaves his house
// and comes straight back to it, with no other customer between, is his too:
// counted, labeled, one tap takes it off. Everything else from that day (the
// supply stop on the way there, the drive back to the shop, shop time before
// the job) is left off and offered in Add time for the odd miss. Owner
// 2026-09-29: "what about the times that you're in the shop for three hours
// before a job, that's not billable": nothing outside the job is billed on
// its own, not even on a day he was the only customer.
function _qiPulledAll(){
  const out=new Set();
  (bids||[]).forEach(b=>{if(b&&b.kind==='quick_invoice')(b.qiPulled||[]).forEach(k=>out.add(String(k)));});
  return out;
}
async function _qiLoadDayCtx(me){
  const days=_qiDays((me.base||[]).filter(l=>l.kind==='time'));
  if(!days.length||typeof _fetchCrewLabor!=='function'||!_tbOnline())return;
  const start=Date.parse(days[0]+'T00:00:00'),end=Date.parse(_qiShiftDay(days[days.length-1],1)+'T00:00:00');
  if(isNaN(start)||isNaN(end))return;
  let lab=null;
  try{lab=await _fetchCrewLabor(new Date(start).toISOString(),{untilISO:new Date(end).toISOString()});}catch(_e){lab=null;}
  if(!lab||_qi!==me)return;
  const cust=new Map();
  (clients||[]).forEach(o=>{if(o&&o.name)_qiPlaceNames(o).forEach(n=>cust.set(n,String(o.id)));});
  me.ctx={entries:(lab.entries||[]).filter(e=>e&&typeof e==='object'),shop:(lab.shopEntries||[]).filter(e=>e&&typeof e==='object'),name:lab.name||{},cust};
  _qiRebuild();
  renderQuickInvoice();
}
function _qiMinsOf(e){
  const a=Date.parse(e.arrived_at||''),z=Date.parse(e.departed_at||'');
  return Number(e.minutes)>0?Number(e.minutes):(z>a?Math.round((z-a)/60000):0);
}
function _qiExtras(day){
  const ctx=_qi&&_qi.ctx;if(!ctx)return [];
  const c=getClientById(_qi.cid)||{};
  const mine=_qiPlaceNames(c,_qi.addr),cid=String(_qi.cid);
  const onDay=e=>{const a=Date.parse(e.arrived_at||'');return !isNaN(a)&&dateKey(new Date(a))===day;};
  const isHis=p=>mine.has(String(p||'').trim());
  const isOther=p=>{const k=ctx.cust.get(String(p||'').trim());return k!=null&&k!==cid;};
  const E=ctx.entries.filter(onDay);
  const site=e=>!_QI_DRIVE.test(String(e.source||''))&&!_QI_NOT_A_VISIT.test(String(e.source||''))&&isHis(e.dest_place);
  const people=[...new Set(E.filter(site).map(e=>String(e.employee_user_id)))];
  if(!people.length)return [];
  const billed=_qiPulledAll();
  const who=uid=>(ctx.name&&ctx.name[uid])||(String(uid)===String(_qiBizUid())?_qiOwnerName():'Crew');
  const out=[];
  people.forEach(uid=>{
    const rows=E.filter(e=>String(e.employee_user_id)===uid).map(e=>({e,kind:_QI_DRIVE.test(String(e.source||''))?'drive':'stay'}))
      .concat(ctx.shop.filter(e=>onDay(e)&&String(e.employee_user_id)===uid).map(e=>({e,kind:'shop'})))
      .filter(r=>!/^(dismissed|personal|drive-held)/.test(String(r.e.source||'')))
      .sort((x,y)=>Date.parse(x.e.arrived_at)-Date.parse(y.e.arrived_at));
    // The first drive there is already on the bill.
    const firstIn=rows.find(r=>r.kind==='drive'&&isHis(r.e.dest_place)&&!isHis(r.e.origin_place));
    rows.forEach((r,i)=>{
      const e=r.e;
      if(r===firstIn)return;
      const o=String(e.origin_place||'').trim(),d=String(e.dest_place||'').trim();
      let label='',kind='stop';
      if(r.kind==='drive'){
        if(isOther(o)||isOther(d))return;            // another customer's leg
        if(isHis(o)&&isHis(d))return;
        kind='drive';label='Drive · '+(isHis(o)?'Here':(o||'Somewhere'))+' to '+(isHis(d)?'here':(d||'somewhere'));
      }else if(r.kind==='shop'){label='Shop';}
      else{
        if(isHis(d)||isOther(d))return;               // site time, or another customer's
        label=d||'A stop';
      }
      const key=(r.kind==='shop'?'s':'e')+e.id;
      if(billed.has(key))return;
      // A run that leaves his house and comes straight back to it.
      const prevSite=[...rows.slice(0,i)].reverse().find(x=>x.kind==='stay'&&(isHis(x.e.dest_place)||isOther(x.e.dest_place)));
      const nextSite=rows.slice(i+1).find(x=>x.kind==='stay'&&(isHis(x.e.dest_place)||isOther(x.e.dest_place)));
      const between=!!(prevSite&&nextSite&&isHis(prevSite.e.dest_place)&&isHis(nextSite.e.dest_place));
      out.push({key,uid,who:who(uid),kind,label,mins:_qiMinsOf(e),at:e.arrived_at,auto:between});
    });
  });
  return out;
}
// The extras on the bill: the runs between visits unless he took one off,
// and whatever he checked in Add time. Drives only when drive time is billed.
function _qiWithExtras(lines){
  if(!_qi||!_qi.ctx)return lines;
  const days=_qiDays(lines.filter(l=>l.kind==='time'));
  const drive=_qiBillDrive();
  days.forEach(day=>{
    _qiExtras(day).forEach(x=>{
      const on=(x.auto&&!_qi.xOff.has(x.key))||_qi.xOn.has(x.key);
      if(!on||(x.kind==='drive'&&!drive)||!(x.mins>0))return;
      const why=x.auto?', between visits':'';
      const add=(who,rider)=>{
        const rate=_qiRateFor(who);
        const detail=x.label+' · '+_qiMins(x.mins)+why;
        lines.push({kind:'time',day,who,mins:x.mins,rate,extra:x.key,rider:rider||undefined,detail,desc:who+': '+detail,amount:Math.round(x.mins/60*rate*100)/100});
      };
      add(x.who);
      // Whoever rides with him rode there too.
      lines.filter(l=>l.day===day&&l.rider===x.who&&!l.extra).forEach(r=>add(r.who,x.who));
    });
  });
  return lines;
}
function _qiExtraOpen(day){
  if(!_qi)return;
  if(_qi.xOpen===day){_qi.xOpen=null;renderQuickInvoice();return;}
  _qi.xOpen=day;
  renderQuickInvoice();
}
function _qiExtraToggle(key){
  if(!_qi)return;
  const x=_qiExtras(_qi.xOpen||'').find(y=>y.key===key)||{};
  const on=(x.auto&&!_qi.xOff.has(key))||_qi.xOn.has(key);
  if(on){_qi.xOn.delete(key);_qi.xOff.add(key);}else{_qi.xOff.delete(key);_qi.xOn.add(key);}
  _qiRebuild();renderQuickInvoice();
}
function _qiExtraHtml(day){
  if(!_qi||!_qi.ctx)return '';
  const X=_qiExtras(day).filter(x=>!x.auto);
  if(!X.length)return '';
  const open=_qi.xOpen===day;
  return '<button type="button" class="ios-row ios-link" id="qi-addtime-'+day+'" onclick="_qiExtraOpen(\''+day+'\')">Add time from this day ('+X.length+')</button>'+
    (open?'<div class="qi-xlist">'+
      X.map(x=>{const on=_qi.xOn.has(x.key);
        return '<button type="button" class="ios-row qi-x-row" onclick="_qiExtraToggle(\''+x.key+'\')" aria-pressed="'+on+'"><span class="qi-chk'+(on?' on':'')+'" aria-hidden="true"></span>'+
          '<span class="ios-lbl">'+escHtml(x.label)+'<small>'+escHtml(x.who.split(' ')[0]+' · '+_qiMins(x.mins)+(x.kind==='drive'&&!_qiBillDrive()?' · drive time is off':''))+'</small></span></button>';}).join('')+'</div>':'');
}
// Crew he added by hand on this screen stay when the lines are rebuilt.
function _qiWithAdded(lines){
  (_qi&&_qi.added||[]).forEach(x=>{
    if(lines.some(l=>l.day===x.day&&l.who===x.rider))return;
    const lead=lines.find(l=>l.day===x.day&&l.who===x.lead&&l.kind==='time');
    if(lead)lines.push(_qiRiderLine(x.day,x.rider,x.lead,lead.mins));
  });
  return lines;
}
// A rate he typed on screen stays when the lines are rebuilt.
function _qiKeepRates(lines){
  const rates=Object.assign({},(_qi&&_qi.rates)||{});(_qi&&_qi.tracked||[]).forEach(l=>{if(l.kind==='time'&&l.rateSet)rates[l.who]=l.rate;});
  lines.forEach(l=>{if(l.kind==='time'&&rates[l.who]!=null){l.rate=rates[l.who];l.rateSet=true;l.amount=Math.round(l.mins/60*l.rate*100)/100;}});
  return lines;
}
function _qiBizUid(){return (typeof _effectiveUid==='function'&&_effectiveUid())||(typeof _supaUser!=='undefined'&&_supaUser&&_supaUser.id)||'';}
function _qiOwnerName(){return (typeof getOwnerName==='function'&&getOwnerName())||(typeof S!=='undefined'&&S.ownerName)||'You';}
async function _qiLoadVisits(cid,addr){
  const c=getClientById(cid);if(!c||typeof _fetchCrewLabor!=='function')return null;
  // Offline or signed out: no answer, so the screen keeps what it has.
  if(!(typeof supaEnabled==='function'&&supaEnabled()&&typeof _supaUser!=='undefined'&&_supaUser&&typeof _supa!=='undefined'&&_supa))return null;
  const {through}=_qiBilled(cid,addr);
  const since=new Date(Math.max(through||0,Date.now()-180*86400000)).toISOString();
  // Only this customer's rows, and no shop rows (owner 2026-09-28: "time to
  // search for hours is slow"): their jobs, or a visit or drive at one of
  // their places. Every customer's crew for six months was the slow part.
  const lab=await _fetchCrewLabor(since,{noShop:true,only:_qiOnly(c,addr)});
  return _qiVisitsFor(c,lab&&lab.entries,lab&&lab.name,addr);
}
function _qiOnly(c,addr){
  return {jobIds:(jobs||[]).filter(j=>j&&String(j.client_id)===String(c.id)).map(j=>j.id),places:_qiPlaceNames(c,addr)};
}
// What the Time Log already fetched, if it covers this customer's window:
// the hours paint at once from it, and the fresh read replaces them.
function _qiVisitsCached(cid,addr){
  const c=getClientById(cid);
  if(!c||typeof _tlCrewCache==='undefined'||!_tlCrewCache||!_tlCrewCache.payload)return null;
  const {through}=_qiBilled(cid,addr);
  const since=Math.max(through||0,Date.now()-180*86400000);
  const got=Date.parse(_tlCrewCache.since||'')||0;
  if(got>since)return null;
  return _qiVisitsFor(c,_tlCrewCache.payload.entries,_tlCrewCache.payload.name,addr);
}

// The unbilled work: one line per person (their minutes at this customer's
// jobs since the last quick invoice), then one line per unbilled receipt.
function _qiUnbilled(cid,visits,addr){
  const {through,exp,days}=_qiBilled(cid,addr);
  const byDay={};let last=through;
  // What the job cache holds, plus the loaded visits, each visit once (the
  // two overlap on job_id rows): same person, same arrival.
  const byJob=(typeof _jobTimeEntriesByJob==='object'&&_jobTimeEntriesByJob)||{};
  let src=[];
  _qiJobsAt(cid,addr).filter(j=>!_qiPropBid(j)).forEach(j=>{src=src.concat(byJob[j.id]||[]);});
  if(Array.isArray(visits))src=src.concat(visits);
  const seen=new Set();
  src=src.filter(e=>{
    const k=(e&&e.kind||'site')+'|'+Date.parse(e&&(e.arrivedAt||e.arrived_at)||'')+'|'+String(e&&e.employeeName||'');
    if(seen.has(k))return false;seen.add(k);return true;
  });
  const drive=_qiBillDrive();
  src.forEach(e=>{
    const kind=e.kind||'site';
    if(kind==='drive'&&!drive)return;
    const a=Date.parse(e&&(e.arrivedAt||e.arrived_at)||'');
    const d=Date.parse(e&&(e.departedAt||e.departed_at)||'');
    if(!(a>through)||!(d>a))return;              // billed already, or still open
    const day=dateKey(new Date(a));
    if(days.has(day))return;                     // that day is on an invoice, or settled elsewhere
    const mins=Number(e.minutes)>0?Number(e.minutes):Math.round((d-a)/60000);
    const who=e.employeeName||(typeof S!=='undefined'&&S.ownerName)||'You';
    const P=byDay[day]||(byDay[day]={});
    const p=P[who]||(P[who]={site:0,drive:0});
    p[kind]=(p[kind]||0)+mins;
    if(d>last)last=d;
  });
  // Receipts: one Materials line a day. The customer sees what materials came
  // to, never the store receipts (owner 2026-09-28); the vendors stay on his
  // screen so he knows what is in it.
  const rec={};
  ((typeof expenses!=='undefined'&&expenses)||[]).filter(e=>e&&String(e.client_id)===String(cid)&&!exp.has(String(e.id))&&Number(e.amount)>0)
    .forEach(e=>{const day=String(e.date||'').slice(0,10)||todayKey();(rec[day]||(rec[day]=[])).push(e);});
  const riders=_qiRiders();
  const lines=[];
  Object.keys(byDay).concat(Object.keys(rec)).filter((d,i,a)=>a.indexOf(d)===i).sort().forEach(day=>{
    const P=byDay[day]||{};
    Object.keys(P).sort().forEach(who=>{
      const p=P[who];
      const mins=Math.round(p.site+p.drive);
      if(!(mins>0))return;
      const rate=_qiRateFor(who);
      const detail=[p.site>0&&_qiMins(Math.round(p.site))+' on site',p.drive>=1&&_qiMins(Math.round(p.drive))+' driving'].filter(Boolean).join(', ');
      lines.push({kind:'time',day,who,mins,rate,detail,desc:who+': '+detail,amount:Math.round(mins/60*rate*100)/100});
    });
    Object.keys(riders).forEach(rider=>{
      const lead=riders[rider],p=P[lead];
      if(!p||P[rider])return;                    // he tracked that day himself: his own hours win
      const mins=Math.round(p.site+p.drive);
      if(mins>0)lines.push(_qiRiderLine(day,rider,lead,mins));
    });
    const r=rec[day];
    if(r){
      const amt=Math.round(r.reduce((s,e)=>s+Number(e.amount),0)*100)/100;
      lines.push({kind:'receipt',day,expId:r[0].id,expIds:r.map(e=>e.id),desc:'Materials',
        vendors:r.map(e=>(e.vendor||'Receipt')+' '+_qiMoney(e.amount)).join(', '),date:_qiDay(day),amount:amt});
    }
  });
  return {lines,through:last>through?new Date(last).toISOString():null};
}
// The days on the screen, oldest first.
function _qiDays(lines){return (lines||[]).map(l=>l.day).filter((d,i,a)=>d&&a.indexOf(d)===i).sort();}
function _qiDayLabel(day){const t=Date.parse(String(day||'')+'T12:00:00');return isNaN(t)?'':new Date(t).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});}

// WHICH HOUSE (owner 2026-09-27, "the multiple options like what we have in
// TrueShot"). A customer with more than one property is asked which one, with
// the same shared picker TrueShot and the estimate use (pickClientAddress),
// and the invoice bills that house: its visits, its jobs, its drives. One
// property: no question, zero extra taps.
function openQuickInvoice(cid,addr){
  const c=getClientById(cid);if(!c)return;
  if(addr===undefined&&clientAddresses(c).length>1&&typeof pickClientAddress==='function'){
    pickClientAddress(cid,a=>openQuickInvoice(cid,a||c.addr||''));
    return;
  }
  addr=addr||'';
  const cached=_qiVisitsCached(cid,addr);
  const un=_qiUnbilled(cid,cached,addr);
  const hasWork=un.lines.length>0;
  const mode=c.qiMode||(hasWork?'hourly':'set');
  const d=_qiDraftGet(c,addr);
  _qi={cid,addr,mode:(d&&d.mode)||mode,tracked:un.lines,through:un.through,typed:[{desc:'',amount:''}],work:[],pbOpen:false,loading:true,modeSet:!!(c.qiMode||(d&&d.mode)),
    off:new Set(),open:new Set(),addDay:null,added:[],
    // The number it will be sent under, from the moment it opens (owner
    // 2026-09-29: "No. Draft doesn't show a number"). A saved draft keeps its.
    id:(d&&d.id)||_newBidId(),dayNote:{},fixed:null,rates:{},showRate:null,partsMode:null,photos:{on:true,before:null,after:null},
    base:un.lines,dropped:new Set(),xOn:new Set(),xOff:new Set(),xOpen:null,ctx:null};
  if(d)_qiDraftApply(d);
  _qiRebuild();
  goPg('pg-qi');
  renderQuickInvoice();
  // The visits load once, then the screen paints once more (the shimmer in
  // the tracked rows until then, never a "Loading" line: CLAUDE.md 8.4).
  const me=_qi;
  Promise.resolve(_qiLoadVisits(cid,addr)).catch(()=>null).then(v=>{
    if(_qi!==me)return;                         // he left, or opened someone else
    me.loading=false;
    if(Array.isArray(v)){
      me.visits=v;
      const u=_qiUnbilled(cid,v,addr);
      me.base=u.lines;me.through=u.through;
      _qiRebuild();
      _qiLoadDayCtx(me);
      if(!me.modeSet&&me.tracked.some(l=>l.kind==='time'))me.mode='hourly';
    }
    renderQuickInvoice();
  });
}
function _qiSetMode(m){if(!_qi)return;_qi.mode=m;_qi.modeSet=true;renderQuickInvoice();}
function _qiLines(){
  if(!_qi)return [];
  const typed=_qi.typed.filter(l=>String(l.desc||'').trim()||Number(l.amount)>0).map(l=>{
    const qty=_qiQty(l);
    return {kind:'line',part:!!l.part,qty,unit:l.unit||'',desc:l.part?_qiPartLabel(l):String(l.desc||'').trim(),amount:Math.round(qty*(Number(l.amount)||0)*100)/100};
  });
  if(_qi.mode==='hourly'&&_qi.fixed!=null)return [{kind:'fixed',desc:'Work performed',amount:Number(_qi.fixed)||0}].concat(typed);
  return (_qi.mode==='hourly'?_qiOnLines():[]).concat(typed);
}
// The tracked lines on the days he has checked. More than one day and each
// line says which day it is, so the customer's copy reads day by day.
function _qiOnLines(){
  if(!_qi)return [];
  const on=_qi.tracked.filter(l=>!(_qi.off&&_qi.off.has(l.day)));
  const multi=_qiDays(on).length>1;
  return on.map(l=>multi&&l.day?Object.assign({},l,{desc:_qiDay(l.day)+' · '+l.desc}):l);
}
function _qiDayTotal(day){return Math.round(((_qi&&_qi.tracked)||[]).filter(l=>l.day===day).reduce((s,l)=>s+(Number(l.amount)||0),0)*100)/100;}
function _qiDayOpen(day){
  if(!_qi)return;
  if(_qi.off.has(day)){_qi.off.delete(day);_qi.open.add(day);}   // opening an unchecked day checks it back in
  else if(_qi.open.has(day))_qi.open.delete(day);else _qi.open.add(day);
  renderQuickInvoice();
}
function _qiDayToggle(day){
  if(!_qi)return;
  if(_qi.off.has(day))_qi.off.delete(day);else _qi.off.add(day);
  renderQuickInvoice();
}
function _qiAllDays(on){
  if(!_qi)return;
  _qi.off=on?new Set():new Set(_qiDays(_qi.tracked));
  renderQuickInvoice();
}
// Add somebody to one day with the same hours as whoever worked it longest.
// Everybody on the business can be added: the crew and the owner.
function _qiPeople(){
  const out=[_qiOwnerName()];
  ((typeof S!=='undefined'&&S.employees)||[]).forEach(e=>{if(e&&e.name&&!out.includes(e.name))out.push(e.name);});
  return out;
}
function _qiAddCrewOpen(day){if(!_qi)return;_qi.addDay=_qi.addDay===day?null:day;renderQuickInvoice();}
function _qiAddRider(day,name){
  if(!_qi)return;
  const lead=_qi.tracked.filter(l=>l.day===day&&l.kind==='time'&&!l.rider).sort((a,b)=>b.mins-a.mins)[0];
  if(!lead||_qi.tracked.some(l=>l.day===day&&l.who===name))return;
  _qi.added.push({day,rider:name,lead:lead.who});
  _qi.tracked.push(_qiRiderLine(day,name,lead.who,lead.mins));
  _qi.addDay=null;
  renderQuickInvoice();
}
// "Every day": the rider setting, so the next invoice adds him by itself.
function _qiRideAlways(name,lead){
  if(typeof S==='undefined'||!S)return;
  S.qiRiders=Object.assign({},_qiRiders(),{[name]:lead});
  if(typeof _settingsChanged==='function')_settingsChanged();
  if(_qi)_qi.added=_qi.added.filter(x=>x.rider!==name);
  if(typeof showToast==='function')showToast(name+' rides with '+lead+' on every invoice now','✓');
  if(_qi)_qiSetBillDrive(_qiBillDrive());
}
function _qiTotal(){return Math.round(_qiLines().reduce((s,l)=>s+(Number(l.amount)||0),0)*100)/100;}

function renderQuickInvoice(){
  const host=document.getElementById('qi-page');if(!host||!_qi)return;
  const c=getClientById(_qi.cid)||{};
  const hourly=_qi.mode==='hourly';
  const row=(l,i)=>{
    // The rate sits in the line under the name, small, so the name keeps the
    // width of the row on a phone. Hours times rate, so he can see which rate
    // won (Earl: "which rate wins?").
    const riderAsk=l.rider&&_qiRiders()[l.who]!==l.rider
      ?' <button type="button" class="qi-always" onclick="_qiRideAlways(\''+escHtml(l.who).replace(/'/g,'&#39;')+'\',\''+escHtml(l.rider).replace(/'/g,'&#39;')+'\')">Every day</button>':'';
    // A rider's hours are the guess, so they are the thing he can change.
    const riderHrs=(l.kind==='time'&&l.rider&&!l.extra)
      ?'<span class="qi-hrs"><input type="text" inputmode="decimal" aria-label="Hours for '+escHtml(l.who)+'" value="'+(Math.round(l.mins/6)/10)+'" onchange="_qiRiderSet(\''+l.day+'\',\''+escHtml(l.who).replace(/'/g,'&#39;')+'\',this.value)">h</span> with '+escHtml(String(l.rider).split(' ')[0])
      :'';
    // No rate yet (a first invoice for somebody): the box is orange and asks,
    // rather than billing them at $0 (owner 2026-09-29: "first time people
    // may not have a rate ... how do you make that smart?"). What he types is
    // theirs from then on (_qiRememberRate).
    // Billed at the business default because they have no rate of their own:
    // still orange, with a question mark, until he looks at it once. Leaving
    // the box keeps what is in it as theirs.
    const need=l.kind==='time'&&!(Number(l.rate)>0);
    const guess=l.kind==='time'&&!need&&!l.rateSet&&!(personBillRate(l.who)>0);
    const sub=l.kind==='time'
      ?(riderHrs||escHtml(l.detail||(_qiMins(l.mins)+' on site')))+' at <span class="qi-rate'+(need?' need':guess?' guess':'')+'">$<input type="text" inputmode="decimal" aria-label="Rate for '+escHtml(l.who)+'" value="'+(l.rate||'')+'" placeholder="Rate?" oninput="_qiRate('+i+',this.value)" onchange="_qiRateDone('+i+')" onblur="_qiRateDone('+i+')">/hr'+(guess?'?':'')+'</span>'+riderAsk
      :escHtml(l.vendors||('Receipt'+(l.date?' · '+l.date:'')));
    const name=l.kind==='time'?l.who:l.desc;
    return '<div class="ios-row"><span class="ios-lbl">'+escHtml(name)+'<small>'+sub+'</small></span>'+
      '<span class="ios-fact qi-amt" id="qi-amt-'+i+'">'+_qiMoney(l.amount)+'</span>'+
      '<button type="button" class="qi-x" aria-label="Leave off" onclick="_qiDropTracked('+i+')">×</button></div>';
  };
  // ONE CARD A DAY (owner 2026-09-29, "three days at Tagen's, each day we do
  // something different"): each day with who was there and what it came to,
  // checked, and one total for every checked day. Uncheck a day to bill it
  // later; it stays on the list.
  const dayList=hourly?_qiDays(_qi.tracked):[];
  const people=_qiPeople();
  const tracked=dayList.map(day=>{
    const on=!_qi.off.has(day);
    const mine=_qi.tracked.map((l,i)=>({l,i})).filter(x=>x.l.day===day);
    const who=mine.filter(x=>x.l.kind==='time');
    // Each name once: a day with six visits is still just Jack.
    const hrs=who.length?[...new Set(who.map(x=>x.l.who.split(' ')[0]))].join(', '):'Materials only';
    const canAdd=on&&who.some(x=>!x.l.rider);
    const addable=people.filter(n=>!mine.some(x=>x.l.who===n));
    // Folded to one line (Earl 2026-09-29: "three SE screens before the Text
    // it button"). The circle checks the day in or out; the rest of the line
    // opens it. One day on the bill opens by itself.
    const open=on&&(_qi.open.has(day)||dayList.length===1);
    const mins=who.filter(x=>!x.l.rider).reduce((s2,x)=>s2+x.l.mins,0);
    const noRate=[...new Set(who.filter(x=>!(Number(x.l.rate)>0)).map(x=>x.l.who))];
    // Swipe the day left for Already billed (owner 2026-09-29), the same
    // swipe the estimate uses to delete a step (_tmWireSwipe).
    return '<div class="ios-group qi-day'+(on?'':' qi-day-off')+(open?' qi-day-open':'')+'" data-day="'+day+'">'+
      '<div class="ios-swipe" data-kind="day"><div class="ios-row qi-day-hd">'+
        '<button type="button" class="qi-chk-btn" onclick="_qiDayToggle(\''+day+'\')" aria-pressed="'+on+'" aria-label="Bill '+escHtml(_qiDayLabel(day))+'"><span class="qi-chk'+(on?' on':'')+'" aria-hidden="true"></span></button>'+
        '<button type="button" class="qi-day-open-btn" onclick="_qiDayOpen(\''+day+'\')" aria-expanded="'+open+'">'+
          '<span class="ios-lbl"><b>'+escHtml(_qiDayLabel(day))+'</b><small>'+escHtml((_qi.dayNote[day]?_qi.dayNote[day]+' · ':'')+hrs+(mins>0?' · '+_qiMins(mins):''))+
            // Folded, a missing rate would only read as a low total.
            (noRate.length?' · <span class="qi-need-lbl">'+escHtml(noRate[0].split(' ')[0])+' needs a rate</span>':'')+'</small></span>'+
          '<span class="ios-fact qi-dt" id="qi-dt-'+day+'">'+_qiMoney(_qiDayTotal(day))+'</span>'+
          '<span class="ios-chev qi-day-chev" aria-hidden="true">›</span></button></div>'+
        '<button type="button" class="ios-del qi-billed" tabindex="-1" onclick="qiBilledElsewhere(\''+day+'\')">Already billed</button></div>'+
      (open?'<div class="ios-row qi-note-row"><input class="qi-desc" type="text" aria-label="What was done '+escHtml(_qiDayLabel(day))+'" placeholder="What was done this day" value="'+escHtml(_qi.dayNote[day]||'')+'" oninput="_qiDayNoteTyped(\''+day+'\',this.value)"></div>'+
        mine.map(x=>row(x.l,x.i)).join('')+_qiExtraHtml(day)+
        (canAdd&&addable.length?'<button type="button" class="ios-row ios-link" onclick="_qiAddCrewOpen(\''+day+'\')">Add crew</button>'+
          (_qi.addDay===day?'<div class="qi-pb qi-crew">'+addable.map(n=>'<button type="button" onclick="_qiAddRider(\''+day+'\',\''+escHtml(n).replace(/'/g,'&#39;')+'\')">'+escHtml(n)+'</button>').join('')+'</div>':''):''):'')+
    '</div>';
  }).join('');
  // A part has a count (Jack 2026-09-29: "a quantity selector for materials
  // would be nice"): minus, the count, plus, and the price of one. A charge
  // (a trip fee, extra labor) is one line and one price.
  const typed=_qi.typed.map((l,i)=>l.part
    ?'<div class="ios-row qi-part"><input class="qi-desc" type="text" placeholder="Part" value="'+escHtml(l.desc||'')+'" oninput="_qiTyped('+i+',\'desc\',this.value)">'+
      '<span class="qi-qty"><button type="button" aria-label="One fewer" onclick="_qiQtyStep('+i+',-1)">−</button><b id="qi-qty-'+i+'">'+_qiQty(l)+'</b><button type="button" aria-label="One more" onclick="_qiQtyStep('+i+',1)">+</button></span>'+
      '<span class="ios-val">$<input type="text" inputmode="decimal" aria-label="Price of one" placeholder="0" value="'+(l.amount===''?'':escHtml(String(l.amount)))+'" oninput="_qiTyped('+i+',\'amount\',this.value)"></span></div>'
    :'<div class="ios-row"><input class="qi-desc" type="text" placeholder="'+(hourly?'Trip charge, extra labor':'Describe the work')+'" value="'+escHtml(l.desc||'')+'" oninput="_qiTyped('+i+',\'desc\',this.value)">'+
    '<span class="ios-val">$<input type="text" inputmode="decimal" placeholder="0" value="'+(l.amount===''?'':escHtml(String(l.amount)))+'" oninput="_qiTyped('+i+',\'amount\',this.value)"></span></div>').join('');
  const pb=_qiPriceBook();
  const pbHtml=_qi.pbOpen&&pb.length?'<div class="qi-pb">'+pb.slice(0,12).map((p,i)=>
    '<button type="button" onclick="_qiAddPb('+i+')">'+escHtml(p.desc)+(Number(p.rate)>0?' · '+_qiMoney(p.rate).replace('.00',''):'')+'</button>').join('')+'</div>':'';
  const total=_qiTotal();
  host.innerHTML=
    // Save top right, the way the proposals do it; Preview sits by Send.
    // The same top as the T&M estimate (owner 2026-09-29: "the invoice header
    // looks weird compared to the rest"): Back, what it is in the middle,
    // Save; the customer large; the number and the house under them.
    '<div class="ios-nav"><button type="button" class="ios-navbtn" onclick="qiCancel()" aria-label="Back">'+
        '<svg viewBox="0 0 12 20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2 2 10l8 8"/></svg>Back</button>'+
      '<span class="ios-navtitle">Invoice</span>'+
      '<button type="button" class="ios-navbtn bold" id="qi-save" onclick="qiSaveDraft()">Save</button></div>'+
    '<div class="ios-large"><h1 class="ios-title" style="cursor:default">'+escHtml(c.name||'Invoice')+'</h1>'+
      '<div class="ios-sub"><span class="txt">'+escHtml(_qiNum())+((_qi.addr||c.addr)?' · '+escHtml(String(_qi.addr||c.addr).split(',')[0]):'')+'</span></div>'+
      _qiStatusPill(_qi.cid)+'</div>'+
    '<div class="qi-body">'+
      '<div class="ios-seg qi-seg" role="tablist">'+
        '<button type="button" role="tab" class="'+(hourly?'on':'')+'" onclick="_qiSetMode(\'hourly\')">Hourly</button>'+
        '<button type="button" role="tab" class="'+(hourly?'':'on')+'" onclick="_qiSetMode(\'set\')">Set price</button></div>'+
      _qiPropJobs(_qi.cid).map(p=>'<button type="button" class="qi-note" onclick="qiOpenJob(\''+escHtml(String(p.id))+'\')">'+
        escHtml(String(c.name||'').split(' ')[0])+' has a '+escHtml(p.name)+' job'+(p.paid>0?' with '+_qiMoney(p.paid).replace('.00','')+' paid':'')+
        '. Bill that one from the job, not here. <b>Open it</b></button>').join('')+
      _qiSayHtml()+
      (hourly&&_qi.work.length?'<div class="ios-sec"><div class="ios-h"><span>Work done</span></div><div class="ios-group">'+
        _qi.work.map((w,i)=>'<div class="ios-row"><span class="ios-lbl">'+escHtml(w)+'</span><button type="button" class="qi-x" aria-label="Take it off" onclick="_qiDropWork('+i+')">×</button></div>').join('')+
        '</div><div class="ios-foot">Listed on the invoice above the hours. It does not change the price.</div></div>':'')+
      (hourly?'<div class="ios-sec"><div class="ios-h"><span>'+(dayList.length>1?'Days at this house':'Since the last invoice')+'</span>'+
          (dayList.length>1?'<button type="button" onclick="_qiAllDays('+(_qi.off.size?'true':'false')+')">'+(_qi.off.size?'Select all':'Select none')+'</button>':'')+'</div>'+
        (tracked&&!_qi.loading?_qiRiderAskHtml():'')+
        (tracked||('<div class="ios-group">'+((_qi.loading&&typeof _tdSkelRows==='function')?'<div class="ios-row" style="display:block">'+_tdSkelRows(2,14)+'</div>':'<div class="ios-row"><span class="ios-lbl"><small style="margin:0">Nothing tracked at '+escHtml(c.name||'this customer')+' since the last invoice.</small></span></div>')+'</div>'))+
        (tracked&&_qi.loading&&typeof _tdSkelRows==='function'?'<div class="ios-group qi-day"><div class="ios-row" style="display:block">'+_tdSkelRows(1,14)+'</div></div>':'')+
        '<div class="ios-group"><label class="ios-row" style="cursor:pointer"><span class="ios-lbl">Bill drive time<small>Your setting for every invoice</small></span>'+
          '<input type="checkbox" class="ios-switch" id="qi-drive" '+(_qiBillDrive()?'checked':'')+' onchange="_qiSetBillDrive(this.checked)"></label>'+
          '<label class="ios-row" style="cursor:pointer"><span class="ios-lbl">Charge a set price<small>The hours stay on your records</small></span>'+
          '<input type="checkbox" class="ios-switch" id="qi-fixed-on" '+(_qi.fixed!=null?'checked':'')+' onchange="_qiSetFixed(this.checked)"></label>'+
          (_qi.fixed!=null?'<div class="ios-row"><span class="ios-lbl">Set price</span><span class="ios-val">$<input id="qi-fixed" type="text" inputmode="decimal" value="'+(_qi.fixed||'')+'" oninput="_qiFixedTyped(this.value)"></span></div>':'')+
        '</div>'+
      '</div>':'')+
      '<div class="ios-sec"><div class="ios-h"><span>'+(hourly?'Parts and charges':'What you did')+'</span></div><div class="ios-group">'+typed+
        '<button type="button" class="ios-row ios-link" id="qi-add-part" onclick="_qiAddPart()">Add a part</button>'+
        '<button type="button" class="ios-row ios-link" onclick="_qiAddLine()">Add a charge</button>'+
        (pb.length?'<button type="button" class="ios-row ios-link" onclick="_qi.pbOpen=!_qi.pbOpen;renderQuickInvoice()">'+(_qi.pbOpen?'Hide price book':'Add from price book')+'</button>':'')+
      '</div>'+pbHtml+'</div>'+_qiCopyHtml()+
      '<div class="ios-sec"><div class="ios-group"><div class="ios-row"><span class="ios-lbl"><b>Total</b></span><span class="ios-fact qi-total" id="qi-total">'+_qiMoney(total)+'</span></div></div>'+
        '<div class="ios-foot">'+(hourly?(dayList.length>1?'The customer gets one invoice with each day listed. Once sent, those days are billed; an unchecked day stays for next time.':'Once sent, these hours and receipts are marked billed and the next invoice starts after them.'):'Your tracked time and receipts are not on this bill.')+'</div></div>'+
      // Pinned to the bottom of the screen (Earl): Send is never three
      // screens down on a small phone.
      // The bar is the T&M estimate's bar (owner 2026-09-29: "it all needs to
      // match"): Tim, the in-person button, then Send. In person is Collect,
      // the word every other screen uses for the Get paid panel it opens.
      // The lesser things are the same plain links under the page.
      '<div class="ios-links qi-links">'+
        '<button type="button" id="qi-preview" onclick="qiSeeIt()">See what they get</button>'+
        (hourly&&_qi.tracked.some(l=>!_qi.off.has(l.day))?'<button type="button" id="qi-elsewhere" onclick="qiBilledElsewhere()">Already billed outside TradeDesk</button>':'')+
      '</div>'+
      '<div class="qi-actions" id="qi-dock">'+
        (typeof openTim==='function'?'<button type="button" class="tm-dock-tim" onclick="openTim()" aria-label="Ask Tim">'+(typeof timMark==='function'?timMark(30):'Tim')+'</button>':'')+
        '<button type="button" class="ios-btn ios-btn-tint" id="qi-paynow" onclick="qiPayNow()">Collect</button>'+
        '<button type="button" class="ios-btn ios-btn-fill" id="qi-send" onclick="qiSend()">Send it<span class="qi-send-amt"> · <span id="qi-send-total">'+_qiMoney(total)+'</span></span></button>'+
      '</div>'+
    '</div>';
  if(typeof _tmWireSwipe==='function')_tmWireSwipe(host);
}
// A person's rate is one number on the whole invoice: change Jack's on
// Monday and Tuesday's Jack moves with it.
function _qiRate(i,v){
  const l=_qi&&_qi.tracked[i];if(!l)return;
  const rate=parseFloat(String(v).replace(/[^0-9.]/g,''))||0;
  _qi.tracked.forEach((x,j)=>{
    if(x.kind!=='time'||x.who!==l.who)return;
    x.rate=rate;x.rateSet=true;x.amount=Math.round(x.mins/60*rate*100)/100;
    const a=document.getElementById('qi-amt-'+j);if(a)a.textContent=_qiMoney(x.amount);
    const pill=a&&a.parentElement&&a.parentElement.querySelector('.qi-rate');
    if(pill){pill.classList.toggle('need',!(rate>0));pill.classList.remove('guess');}
    if(j!==i){const inp=pill&&pill.querySelector('input');if(inp)inp.value=rate||'';}
  });
  _qi.rates[l.who]=rate;
  _qiDays(_qi.tracked).forEach(d=>{const e=document.getElementById('qi-dt-'+d);if(e)e.textContent=_qiMoney(_qiDayTotal(d));});
  _qiTotalsPaint();
}
// Leaving the box is his answer: whatever is in it is now that person's rate
// if they had none (a default he looked at and kept counts).
function _qiRateDone(i){
  const l=_qi&&_qi.tracked[i];if(!l)return;
  if(!(Number(l.rate)>0))return;
  const had=personBillRate(l.who)>0;
  _qiRememberRate(l.who,l.rate);
  if(!had){
    _qi.tracked.forEach(x=>{if(x.kind==='time'&&x.who===l.who)x.rateSet=true;});
    document.querySelectorAll('#qi-page .qi-rate.guess').forEach(p=>{const inp=p.querySelector('input');if(inp&&inp.getAttribute('aria-label')==='Rate for '+l.who){p.classList.remove('guess');p.lastChild&&p.lastChild.nodeType===3&&(p.lastChild.textContent='/hr');}});
    if(typeof showToast==='function')showToast(l.who.split(' ')[0]+' bills $'+l.rate+'/hr from now on','✓',2200);
  }
}
function _qiTyped(i,k,v){
  const l=_qi&&_qi.typed[i];if(!l)return;
  l[k]=k==='amount'?(String(v).replace(/[^0-9.]/g,'')):v;
  _qiTotalsPaint();
}
function _qiTotalsPaint(){
  const m=_qiMoney(_qiTotal());
  ['qi-total','qi-send-total'].forEach(id=>{const e=document.getElementById(id);if(e)e.textContent=m;});
}
function _qiAddLine(){if(!_qi)return;_qi.typed.push({desc:'',amount:''});renderQuickInvoice();}
function _qiAddPart(){if(!_qi)return;_qi.typed=_qi.typed.filter(l=>String(l.desc||'').trim()||Number(l.amount)>0);_qi.typed.push({desc:'',amount:'',qty:1,part:true});renderQuickInvoice();}
function _qiQty(l){const q=Number(l&&l.qty);return q>0?Math.round(q*100)/100:1;}
function _qiQtyStep(i,d){
  const l=_qi&&_qi.typed[i];if(!l)return;
  l.qty=Math.max(1,_qiQty(l)+d);
  const e=document.getElementById('qi-qty-'+i);if(e)e.textContent=l.qty;
  _qiTotalsPaint();
}
// "2 supply lines", "12 bags Quikrete": the count, the unit, the part.
function _qiPartLabel(l){
  const item=String(l&&l.desc||'').trim();
  const q=_qiQty(l),u=l&&l.unit&&l.unit!=='ea'?l.unit:'';
  if(q===1&&!u)return item;
  // "2 supply lines": no unit, so the part itself takes the plural.
  if(!u)return _qiMatDesc({qty:q,unit:'',item:/s$/i.test(item)?item:item+'s'});
  return _qiMatDesc({qty:q,unit:u,item});
}
function _qiDropTracked(i){
  if(!_qi)return;
  const l=_qi.tracked[i];if(!l)return;
  if(l.extra){_qi.xOn.delete(l.extra);_qi.xOff.add(l.extra);}
  else _qi.dropped.add(_qiLineKey(l));
  _qi.tracked.splice(i,1);
  renderQuickInvoice();
}
// Every price book item he has used, most used first, across his trades.
function _qiPriceBook(){
  const pb=(typeof S!=='undefined'&&S.priceBook)||{};
  const all=[];
  Object.keys(pb).forEach(t=>(Array.isArray(pb[t])?pb[t]:[]).forEach(p=>{if(p&&p.desc)all.push(p);}));
  all.sort((a,b)=>(Number(b.n)||0)-(Number(a.n)||0));
  // Then the parts off his receipts (the materials book, js/data.js), at
  // what he last paid, for anything the price book has no price for.
  const have=new Set(all.map(p=>_partCostKey(p.desc)));
  if(typeof materialsBook==='function')materialsBook().forEach(m=>{
    const k=_partCostKey(m.desc);if(have.has(k))return;have.add(k);
    all.push({desc:m.desc,rate:m.cost,paid:true});
  });
  return all;
}
function _qiAddPb(i){
  const p=_qiPriceBook()[i];if(!p||!_qi)return;
  const blank=_qi.typed.find(l=>!String(l.desc||'').trim()&&!(Number(l.amount)>0));
  const line={desc:p.desc,amount:Number(p.rate)>0?String(p.rate):''};
  if(blank)Object.assign(blank,line);else _qi.typed.push(line);
  renderQuickInvoice();
}
function qiCancel(){_qi=null;goPg('pg-dash');}

function qiOpenJob(bidId){
  _qi=null;
  const b=(bids||[]).find(x=>String(x.id)===String(bidId));
  if(b&&typeof openFinalInvoice==='function')openFinalInvoice(b.id);
}
// THE INVOICE DOCUMENT, built from the proposal's own shell (js/generic-
// estimate.js: _propBrand, _propDoc, _propCover, _propSection, _propSignoff),
// so the customer gets the same letterhead, colour and page on the bill as on
// the proposal. Only the body is the invoice's: the lines and what is due.
// TALK TO TIM ON THE INVOICE (owner 2026-09-27: "Do we add in talk to Tim
// like we do for proposals to speak to what we did?"). Tim's shared say box
// (js/tim.js timSayBox, timSaid, timSaySteps), the same one both proposal
// builders use, pointed at the invoice. Hourly: what he says is the work done, listed
// on the invoice above the hours, never a price. Set price: each thing he did
// is a line, priced from his own book when it knows it, blank when it does not
// (a guessed number on a bill is worse than a blank that asks).
function _qiSayHtml(){
  const hourly=_qi&&_qi.mode==='hourly';
  return timSayBox({id:'qi-say',done:'_qiSayBuild',
    placeholder:hourly?'What did you do? Say it the way you would tell the customer.':'What did you do? Tim makes the lines and prices them from your book.',
    links:'<button type="button" onclick="_qiSayBuild()">'+(hourly?'Add to work done':'Make the lines')+'</button>'});
}
function _qiSayBuild(){
  if(!_qi)return;
  const said=timSaid('qi-say','Type or say what you did first');
  if(!said)return;
  const lines=timSayLines(said);
  const steps=lines.map(l=>l.text);
  // Parts he said he used are lines on the bill too: "2 supply lines", "a
  // Fluidmaster fill valve". Priced from his book when it knows them, blank
  // when it does not, the same rule as every other line here.
  // Only what he said he USED is its own line. A part named in the work
  // ("installed a 40 gallon water heater") is that work line's job, and a
  // second priced line for it bills it twice (owner 2026-09-28: "on invoice,
  // materials are totaling when they shouldn't").
  const mats=((typeof timSaidMaterials==='function')?timSaidMaterials(said):[]).filter(m=>m&&m.kind!=='part');
  if(typeof timLogScope==='function')timLogScope(said,steps,'qi',null);
  if(_qi.mode==='hourly'){
    const have=new Set(_qi.work.map(w=>w.toLowerCase()));
    steps.forEach(st=>{if(!have.has(st.toLowerCase())){_qi.work.push(st);have.add(st.toLowerCase());}});
  }else{
    const trade=(typeof getActiveTrade==='function'&&getActiveTrade())||'general';
    _qi.typed=_qi.typed.filter(l=>String(l.desc||'').trim()||Number(l.amount)>0);
    const have=new Set(_qi.typed.map(l=>String(l.desc).toLowerCase()));
    // A price he said for the line is his, and beats the book.
    lines.forEach(l=>{
      const st=l.text;
      if(have.has(st.toLowerCase()))return;have.add(st.toLowerCase());
      const own=(typeof _pbFind==='function')?_pbFind(st,trade):null;
      _qi.typed.push({desc:st,amount:l.price>0?l.price:(own&&Number(own.rate)>0?Number(own.rate):'')});
    });
  }
  if(mats.length){
    const trade=(typeof getActiveTrade==='function'&&getActiveTrade())||'general';
    _qi.typed=_qi.typed.filter(l=>String(l.desc||'').trim()||Number(l.amount)>0);
    const have=new Set(_qi.typed.map(l=>String(l.desc).toLowerCase()));
    mats.forEach(m=>{
      const desc=_qiMatItem(m);
      if(have.has(desc.toLowerCase()))return;have.add(desc.toLowerCase());
      const own=(typeof _pbFind==='function')?_pbFind(m.item,trade):null;
      const rate=own&&Number(own.rate)>0?Number(own.rate):0;
      // A part, with its count on the stepper and the price of one.
      _qi.typed.push({desc,qty:Number(m.qty)>0?Number(m.qty):1,unit:m.unit&&m.unit!=='ea'?m.unit:'',amount:rate>0?rate:'',part:true});
    });
  }
  if(_qi.mode!=='hourly'&&!_qi.typed.length)_qi.typed=[{desc:'',amount:''}];
  renderQuickInvoice();
  if(typeof _tdHaptic==='function')_tdHaptic('tick');
}
// "2 supply lines", "40 bags Quikrete", "1 Fluidmaster fill valve": the count,
// the unit it is sold in when it is not each, and the thing.
function _qiMatItem(m){
  let item=String(m&&m.item||'').trim();
  const w0=item.split(/\s+/)[0]||'';
  const name=/^[A-Z]{2}/.test(w0)||(typeof _TIMK_BRAND_KEYS!=='undefined'&&typeof _timkSoundKey==='function'&&_TIMK_BRAND_KEYS.get(_timkSoundKey(w0)));
  return name?item:item.charAt(0).toUpperCase()+item.slice(1);
}
function _qiMatDesc(m){
  const n=Math.round((Number(m&&m.qty)||1)*100)/100;
  const u=m&&m.unit&&m.unit!=='ea'?m.unit:'';
  const unit=u?' '+(n===1?u:(u==='box'?'boxes':u==='foot'?'feet':u==='sq ft'?'sq ft':u+'s')):'';
  let item=String(m&&m.item||'').trim();
  // "Supply lines" reads as "2 supply lines"; a name ("Quikrete", "PEX") keeps
  // its capital.
  const w0=item.split(/\s+/)[0]||'';
  const name=/^[A-Z]{2}/.test(w0)||(typeof _TIMK_BRAND_KEYS!=='undefined'&&typeof _timkSoundKey==='function'&&_TIMK_BRAND_KEYS.get(_timkSoundKey(w0)));
  if(!name)item=item.charAt(0).toLowerCase()+item.slice(1);
  return n+unit+' '+item;
}
function _qiDropWork(i){if(!_qi)return;_qi.work.splice(i,1);renderQuickInvoice();}

function _qiDocHtml(num){
  if(!_qi)return '';
  const c=getClientById(_qi.cid)||{};
  const lines=_qiLines().filter(l=>Number(l.amount)>0);
  const total=_qiTotal();
  const pb=_propBrand();_propTheme(pb.a,pb.rgb);
  const bname=(typeof S!=='undefined'&&S.bname)||'';
  const td='padding:13px 18px;border-top:1px solid #eef1f5;font-size:15px;line-height:1.4;color:#0b1220';
  const rows=_qiCustomerHtml();
  const table=`<div style="margin:18px 16px 16px;border-radius:18px;overflow:hidden;border:1px solid #e8eaef">`+
    `<table style="width:100%;border-collapse:collapse"><tbody>${rows}</tbody>`+
    `<tfoot><tr><td style="padding:16px 18px;border-top:2px solid #e2e8f0;font-size:17px;font-weight:800">Total due</td>`+
    `<td style="padding:16px 18px;border-top:2px solid #e2e8f0;font-size:20px;font-weight:800;text-align:right;white-space:nowrap;color:${pb.a}">${_qiMoney(total)}</td></tr></tfoot></table></div>`;
  return _propDoc(
    _propCover({bname,bphone:(typeof S!=='undefined'&&S.bphone)||'',blic:(typeof S!=='undefined'&&S.blic)||'',accent:pb.a,
      label:'Invoice',num:num||_qiNum(),date:todayKey(),name:escHtml(c.name||''),addr:escHtml(_qi.addr||c.addr||''),phone:escHtml(typeof _propPhone==='function'?_propPhone(c.phone):(c.phone||'')),
      project:escHtml(_qiMoney(total))+' due',until:null,forLabel:'Billed to'})+
    _propSection('Work performed','',_qiWorkListHtml()+_qiPhotoDocHtml()+table.replace('margin:18px 16px 16px','margin:0'),{noRule:true})+
    _propSignoff(bname,'Thank you for choosing'));
}
// What he said he did, as a plain list above the charges. Hourly only.
// The invoice number, the same one printInvoice prints (INV- and the id).
function _qiNum(){return _qi&&_qi.id!=null?'INV-'+String(_qi.id).slice(-6):'Draft';}
// The same words as the customer's page, as plain lines, for the saved bid
// (the printed invoice and the customer's hub read lineItems).
function _qiCustomerItems(){
  // Rows without money fold into the row above that has it, so each line item
  // carries the words the customer sees and the amounts still add up.
  // A day split into labor and parts is carried by those two lines, never by
  // its heading as well, or the day would be billed twice.
  const out=[];let prefix='';
  _qiCustomerRows().forEach(r=>{
    if(r.head&&r.split){prefix=r.text;return;}
    if(!r.sub)prefix='';
    if(r.sub&&r.money){out.push({desc:(prefix?prefix+' · ':'')+r.text,amount:r.amount});return;}
    if(r.amount!=null&&!(r.sub&&!r.money&&out.length))out.push({desc:r.text,amount:r.amount});
    else if(out.length)out[out.length-1].desc+=' · '+r.text;
    else out.push({desc:r.text,amount:0});
  });
  return out.filter(l=>l.amount>0||out.length===1);
}
function _qiWorkListHtml(){
  // One day: what he said is that day's heading. More: a list above the days.
  const w=(_qi&&_qi.mode==='hourly'&&Array.isArray(_qi.work)&&_qiCustomerDays().length!==1)?_qi.work:[];
  if(!w.length)return '';
  return '<ul style="margin:0 0 16px;padding:0 0 0 20px;font-size:15px;line-height:1.55;color:#0b1220">'+w.map(x=>'<li>'+escHtml(x)+'</li>').join('')+'</ul>';
}
// What the customer will get, before anything is saved or sent: the same
// full-screen preview a proposal opens in.
function qiSeeIt(){
  if(!_qi)return;
  if(typeof _showProposalPreviewOverlay==='function')_showProposalPreviewOverlay(_qiDocHtml());
}
function _qiSave(){
  if(!_qi)return null;
  const c=getClientById(_qi.cid);if(!c)return;
  const lines=_qiLines().filter(l=>Number(l.amount)>0);
  const total=_qiTotal();
  if(!lines.length||!(total>0)){showToast('Add a line with a price first','✏️');return null;}
  const hourly=_qi.mode==='hourly';
  const bid={id:_qi.id!=null?_qi.id:_newBidId(),client_id:c.id,client_name:c.name||'',name:c.name||'',phone:c.phone||'',addr:_qi.addr||c.addr||'',
    qiAddr:_qi.addr||c.addr||'',
    type:'Invoice',kind:'quick_invoice',status:'Closed Won',draft:false,
    bid_date:todayKey(),completion_date:todayKey(),amount:total,deposit:0,
    desc:(hourly?_qi.work:[]).concat(_qiCustomerItems().map(l=>l.desc)).join('\n'),lineItems:_qiCustomerItems(),
    qiShowRate:hourly?_qiShowRate():null,qiPartsMode:_qiPartsMode(),qiFixed:hourly?_qi.fixed:null,qiDayNotes:hourly?Object.assign({},_qi.dayNote):{},
    qiPhotos:(()=>{const pr=_qi.photos.on?_qiPhotoPair():null;return pr?{before:pr.before.id,after:pr.after.id}:null;})(),
    qiWork:hourly?_qi.work.slice():[],
    qiMode:_qi.mode,
    // The days it carries, never a through-mark (see _qiBilled).
    qiTimeThrough:null,
    qiDays:hourly?_qiOnDays():[],
    // Time he pulled onto this bill from the day (Add time), so no other
    // bill can take it too.
    qiPulled:hourly?_qi.tracked.filter(l=>l.extra&&!_qi.off.has(l.day)).map(l=>l.extra):[],
    qiExpenseIds:hourly?_qiOnExpIds():[]};
  bids.unshift(bid);
  c.qiMode=_qi.mode;
  _qiDraftDrop(c.id,_qi.addr);
  saveAll();
  _qi=null;
  _tbInvalidate();
  goPg('pg-dash');
  return bid;
}
function _qiOnDays(){return _qi?_qiDays(_qi.tracked.filter(l=>!_qi.off.has(l.day)&&Number(l.amount)>0)):[];}
function _qiOnExpIds(){
  if(!_qi)return [];
  const out=[];
  _qi.tracked.filter(l=>l.kind==='receipt'&&!_qi.off.has(l.day)).forEach(l=>(l.expIds||[l.expId]).forEach(id=>out.push(id)));
  return out;
}
// ALREADY BILLED OUTSIDE TRADEDESK (owner 2026-09-29): the checked days were
// settled some other way (cash on the spot, a paper bill, before he had the
// app). They come off the list for good and never count as a sale here.
// One day swiped (owner 2026-09-29: "swipe left and hit already billed"):
// that day alone comes off, and the rest of the bill stays open.
function qiBilledElsewhere(oneDay){
  if(!_qi)return;
  const one=typeof oneDay==='string'&&oneDay?oneDay:null;
  const days=one?[one]:_qiDays(_qi.tracked.filter(l=>!_qi.off.has(l.day)));
  if(!days.length){showToast('Check a day first','✏️');return;}
  const n=days.length;
  const go=()=>{
    const c=getClientById(_qi&&_qi.cid);if(!c||!_qi)return;
    const expIds=one?_qi.tracked.filter(l=>l.kind==='receipt'&&l.day===one).flatMap(l=>l.expIds||[l.expId]):_qiOnExpIds();
    c.qiElsewhere=(Array.isArray(c.qiElsewhere)?c.qiElsewhere:[]).concat([{addr:_qi.addr||'',days,expIds,at:new Date().toISOString()}]);
    const left=one?_qiDays(_qi.tracked).filter(d=>d!==one):[];
    if(left.length){
      _qi.base=(_qi.base||[]).filter(l=>l.day!==one);
      _qi.off.delete(one);_qi.open.delete(one);
      _qiRebuild();
      saveAll();
      _tbInvalidate();
      renderQuickInvoice();
      showToast('That day is off the list','✓');
      return;
    }
    _qiDraftDrop(c.id,_qi.addr);
    saveAll();
    _qi=null;
    _tbInvalidate();
    goPg('pg-dash');
    showToast(n===1?'That day is off the list':n+' days are off the list','✓');
  };
  if(typeof zConfirm==='function')zConfirm((n===1?'This day was':'These '+n+' days were')+' already billed outside TradeDesk? '+(n===1?'It comes':'They come')+' off the list and never go on an invoice here.',go);
  else go();
}
// Text them the link to pay later.
// Who on the checked days has no rate yet. Nothing goes out at $0 an hour.
function _qiMissingRates(){
  if(!_qi||_qi.mode!=='hourly')return [];
  return [...new Set(_qi.tracked.filter(l=>l.kind==='time'&&!_qi.off.has(l.day)&&!(Number(l.rate)>0)).map(l=>l.who))];
}
function _qiRatesReady(){
  const miss=_qiMissingRates();
  if(!miss.length)return true;
  const first=miss[0].split(' ')[0];
  if(typeof showToast==='function')showToast((miss.length===1?first+' needs':'Some of the crew need')+' a rate first','✏️',3000);
  const inp=document.querySelector('#qi-page .qi-rate.need input');
  if(inp){try{inp.scrollIntoView({block:'center'});}catch(_e){}inp.focus();}
  return false;
}
function qiSend(){
  if(!_qiRatesReady())return false;
  const bid=_qiSave();if(!bid)return false;
  if(typeof _sendPaidInvoice==='function')_sendPaidInvoice(bid.id);
  return bid;
}
// Settle it now, in person: the same pay panel every job uses (Tap to Pay,
// card by QR, cash, check, Venmo, Zelle), so the payment is recorded against
// this invoice and it reads paid everywhere.
function qiPayNow(){
  if(!_qiRatesReady())return false;
  const bid=_qiSave();if(!bid)return false;
  if(typeof openPayPanel==='function')openPayPanel(bid.id,'final');
  return bid;
}

// ── THE CUSTOMER'S COPY (owner 2026-09-29) ─────────────────────────────────
// Owner: "what would invite confusion on a client ... putting nine hours on
// their [bill] ... we do not want to show the price per employee". So each
// day reads as the work, the time on site and how many were there ("4.5 hrs
// on site · 2 techs"), never man-hours, never names. Two switches, both off
// unless he turns them on (owner: "for a pissed off old man, I doubt it"):
//   Show my hourly rate  where a state statute says a T&M bill must carry the
//                        rate (statePriceRule 'rate'), it is on and locked
//   Show parts cost      off: "Parts included", the money still in the total
// His own screen keeps every hour, rate and receipt either way.
function _qiRateLocked(){
  if(!_qi)return false;
  const c=getClientById(_qi.cid)||{};
  const st=typeof detectStateFromAddr==='function'?detectStateFromAddr(_qi.addr||c.addr||''):'';
  const r=typeof statePriceRule==='function'?statePriceRule(st||(typeof S!=='undefined'&&S.state)||''):{needs:[]};
  return Array.isArray(r.needs)&&r.needs.includes('rate');
}
function _qiShowRate(){
  if(!_qi)return false;
  if(_qiRateLocked())return true;
  return _qi.showRate!=null?!!_qi.showRate:copyShows('invoice','rate');
}
function _qiPartsMode(){
  if(!_qi)return 'total';
  return ['total','items','priced'].includes(_qi.partsMode)?_qi.partsMode:copyPartsMode('invoice');
}
function _qiShowParts(){return _qiPartsMode()==='priced';}
function _qiSetPartsMode(m){if(!_qi)return;_qi.partsMode=m;renderQuickInvoice();}
function _qiPartsAlways(){
  if(!_qi)return;
  setCopyPartsMode('invoice',_qiPartsMode());_qi.partsMode=null;
  if(typeof showToast==='function')showToast('Every invoice does this now','✓');
  renderQuickInvoice();
}
// "Parts" for a plumber, "materials" for everyone else (Earl: "say parts").
function _qiPartsWord(){
  const t=String((typeof getActiveTrade==='function'&&getActiveTrade())||'').toLowerCase();
  return /plumb|hvac|electric|appliance|mechanic/.test(t)?'Parts':'Materials';
}
function _qiSetShow(k,on){
  if(!_qi)return;
  _qi[k]=!!on;
  renderQuickInvoice();
}
// The switch this bill uses, made the default for every bill.
function _qiShowAlways(k){
  if(!_qi)return;
  setCopyShows('invoice','rate',_qiShowRate());
  _qi[k]=null;
  if(typeof showToast==='function')showToast('Every invoice does this now','✓');
  renderQuickInvoice();
}
function _qiHrs(mins){const h=Math.round((Number(mins)||0)/6)/10;return (h%1?h.toFixed(1):String(h))+(h===1?' hr':' hrs');}
// One block a day for the customer: what was done, time on site, crew size,
// the labor and parts money, and the day's total.
function _qiCustomerDays(){
  if(!_qi||_qi.mode!=='hourly')return [];
  const on=_qi.tracked.filter(l=>!_qi.off.has(l.day)&&Number(l.amount)>0);
  const days=_qiDays(on);
  return days.map(day=>{
    const L=on.filter(l=>l.day===day);
    const time=L.filter(l=>l.kind==='time');
    // One person's day is all their lines together (site, the drive there,
    // the time he added); time on site is the longest of those days.
    const per={},rid={};
    time.forEach(l=>{per[l.who]=(per[l.who]||0)+l.mins;if(l.rider)rid[l.who]=true;});
    const lead=Math.max(0,...Object.keys(per).filter(w=>!rid[w]).map(w=>per[w]))||Math.max(0,...Object.values(per));
    const labor=Math.round(time.reduce((s2,l)=>s2+l.amount,0)*100)/100;
    const parts=Math.round(L.filter(l=>l.kind==='receipt').reduce((s2,l)=>s2+l.amount,0)*100)/100;
    const rates=time.map(l=>Number(l.rate)||0).filter((r,i,a)=>r>0&&a.indexOf(r)===i).sort((a,b)=>a-b);
    const note=String(_qi.dayNote[day]||'').trim()||(days.length===1&&_qi.work.length?_qi.work.join('; '):'');
    return {day,note,mins:lead,techs:Object.keys(per).length,labor,parts,rates,total:Math.round((labor+parts)*100)/100};
  });
}
// ONE PICTURE OF THE CUSTOMER'S COPY, rows of {text, amount, sub}, that the
// preview and the saved bill (lineItems, the printed invoice) both read, so
// they cannot disagree. amount null means the row carries no money; every
// dollar still lands on a row that does, so the rows always add up to the
// total whatever is hidden.
function _qiCustomerRows(){
  if(!_qi)return [];
  const rate=_qiShowRate(),mode=_qiPartsMode(),word=_qiPartsWord();
  const typed=_qiLines().filter(l=>l.kind==='line'&&Number(l.amount)>0);
  const parts=typed.filter(l=>l.part),charges=typed.filter(l=>!l.part);
  const partSum=Math.round(parts.reduce((s2,l)=>s2+l.amount,0)*100)/100;
  const rows=[];
  const days=_qi.mode==='hourly'?_qiCustomerDays():[];
  if(_qi.mode==='hourly'&&_qi.fixed!=null){
    days.forEach(d=>rows.push({text:_qiDayLabel(d.day)+(d.note?' · '+d.note:''),amount:null,head:true}));
    rows.push({text:'Work performed',amount:Number(_qi.fixed)||0});
  }else{
    days.forEach(d=>{
      const r=rate&&d.rates.length?' · '+d.rates.map(x=>'$'+x.toLocaleString('en-US')).join(' to ')+'/hr':'';
      const crew=d.techs>1?' · '+d.techs+' techs':'';
      // Parts priced: labor and receipts each carry their amount. Otherwise
      // only the day's total carries money, so nothing separates the parts.
      const split=mode==='priced'&&d.parts>0;
      rows.push({text:_qiDayLabel(d.day)+(d.note?' · '+d.note:''),amount:d.total,head:true,split});
      if(d.mins>0)rows.push({text:'Labor · '+_qiHrs(d.mins)+' on site'+crew+r,amount:split?d.labor:null,sub:true,money:split});
      if(d.parts>0&&mode!=='total')rows.push({text:word+(mode==='priced'?'':' included'),amount:split?d.parts:null,sub:true,money:split});
    });
  }
  if(parts.length){
    if(mode==='priced')parts.forEach(l=>rows.push({text:(l.qty>1&&!l.unit?l.qty+' × ':'')+l.desc,amount:l.amount}));
    else{
      // Not priced: the parts money rides on the last day, or on one line.
      const lastHead=[...rows].reverse().find(r=>r.head&&r.amount!=null);
      const list=mode==='items'?parts.map(l=>l.desc).join(', '):'';
      if(lastHead){lastHead.amount=Math.round((lastHead.amount+partSum)*100)/100;if(list)rows.push({text:word+': '+list,amount:null,sub:true});}
      else rows.push({text:mode==='items'?word+': '+list:'Parts and labor',amount:partSum});
    }
  }
  charges.forEach(l=>rows.push({text:l.desc,amount:l.amount}));
  return rows;
}
function _qiCustomerHtml(){
  const td='padding:12px 18px;border-top:1px solid #eef1f5;font-size:15px;line-height:1.4;color:#0b1220';
  const sub='font-size:13px;color:#5b6475';
  return _qiCustomerRows().map(r=>r.sub
    ?`<tr><td style="${td};border-top:0;padding-top:0"><span style="${sub}">${escHtml(r.text)}</span></td><td style="${td};border-top:0;padding-top:0;text-align:right;${sub}">${r.amount!=null?_qiMoney(r.amount):''}</td></tr>`
    :`<tr><td style="${td}">${r.head?'<b>'+escHtml(r.text.split(' · ')[0])+'</b>'+(r.text.includes(' · ')?' · '+escHtml(r.text.split(' · ').slice(1).join(' · ')):''):escHtml(r.text)}</td><td style="${td};text-align:right;white-space:nowrap">${r.amount!=null?(r.head?'<b>'+_qiMoney(r.amount)+'</b>':_qiMoney(r.amount)):''}</td></tr>`
  ).join('');
}
// What the customer's copy shows, as switches on this bill. A switch set
// differently from his default offers to become the default.
function _qiCopyHtml(){
  const locked=_qiRateLocked(),rate=_qiShowRate(),pm=_qiPartsMode(),word=_qiPartsWord();
  const always=(k,now,def)=>now!==def?'<button type="button" class="qi-always" onclick="_qiShowAlways(\''+k+'\')">Always</button>':'';
  const pr=_qiPhotoPair();
  const ph=pr?'<div class="ios-row qi-photos'+(_qi.photos.on?'':' off')+'">'+
      ['before','after'].map(t=>'<button type="button" class="qi-ph" onclick="_qiPhotoNext(\''+t+'\')" aria-label="'+(t==='before'?'Before':'After')+' photo, tap for another">'+
        '<img src="'+escHtml(_qiPhotoSrc(pr[t]))+'" alt=""><span>'+(t==='before'?'Before':'After')+(_qiPhotoList(t).length>1?' ›':'')+'</span></button>').join('')+'</div>'
    :'';
  return '<div class="ios-sec"><div class="ios-h"><span>On the customer\'s copy</span></div><div class="ios-group">'+
    '<label class="ios-row" style="cursor:pointer"><span class="ios-lbl">Show my hourly rate<small>'+(locked?'Your state requires it on a time and materials bill':'Off: they see the hours and the total')+' '+(locked?'':always('showRate',rate,copyShows('invoice','rate')))+'</small></span>'+
      '<input type="checkbox" class="ios-switch" id="qi-show-rate" '+(rate?'checked':'')+(locked?' disabled':'')+' onchange="_qiSetShow(\'showRate\',this.checked)"></label>'+
    // Three ways, the default first (owner 2026-09-29).
    '<div class="ios-row qi-parts-row"><span class="ios-lbl">'+word+'<small>'+
      (pm==='total'?'In the total, not listed':pm==='items'?'Listed with counts, no prices':'Listed with counts and prices')+
      (pm!==copyPartsMode('invoice')?' <button type="button" class="qi-always" onclick="_qiPartsAlways()">Always</button>':'')+'</small></span></div>'+
    '<div class="ios-row qi-parts-seg"><div class="ios-seg" role="tablist" id="qi-parts-mode">'+
      [['total','Total only'],['items','List them'],['priced','With prices']].map(([k,l])=>'<button type="button" role="tab" data-mode="'+k+'" class="'+(pm===k?'on':'')+'" onclick="_qiSetPartsMode(\''+k+'\')">'+l+'</button>').join('')+
    '</div></div>'+
    (pr?'<label class="ios-row" style="cursor:pointer"><span class="ios-lbl">Before and after photos<small>From TrueShot at this house. Tap a photo for another.</small></span>'+
      '<input type="checkbox" class="ios-switch" id="qi-photos-on" '+(_qi.photos.on?'checked':'')+' onchange="_qi.photos.on=this.checked;renderQuickInvoice()"></label>'+ph:'')+
  '</div></div>';
}
// ── BEFORE AND AFTER (owner 2026-09-29: "do we incorporate TrueShot into the
// invoice ... which one is the right before picture and after") ───────────
// The same rule the property folder pins its pair by (tdPropertyPair): the
// newest Before and the newest After at this house, since the oldest day on
// the bill. Tap one to step to the next photo of that kind; the switch leaves
// them off.
function _qiPhotoRows(){
  if(!_qi||typeof photos==='undefined'||!Array.isArray(photos))return [];
  const c=getClientById(_qi.cid)||{};
  const from=_qiDays(_qi.tracked)[0]||'';
  return photos.filter(p=>p&&String(p.client_id)===String(_qi.cid)&&(p.type==='before'||p.type==='after')&&
    _qiSameAddr(p.addr||c.addr,_qi.addr)&&(p.thumbUrl||p.url||p.data)&&
    (!from||String(p.uploadedAt||'').slice(0,10)>=_qiShiftDay(from,-14)));
}
function _qiShiftDay(day,n){const t=Date.parse(day+'T12:00:00');return isNaN(t)?day:dateKey(new Date(t+n*86400000));}
function _qiPhotoList(type){
  return _qiPhotoRows().filter(p=>p.type===type).sort((a,b)=>String(b.uploadedAt||'').localeCompare(String(a.uploadedAt||'')));
}
function _qiPhotoPair(){
  if(!_qi)return null;
  // Which pair by default is the property folder's rule, the one TrueShot
  // pins (tdPropertyPair): shared, so the invoice and the folder agree.
  const auto=typeof tdPropertyPair==='function'?tdPropertyPair(_qiPhotoRows()):null;
  const pick=(type)=>{const L=_qiPhotoList(type),id=_qi.photos[type];return L.find(p=>String(p.id)===String(id))||(auto&&auto[type])||L[0]||null;};
  const b=pick('before'),a=pick('after');
  return b&&a?{before:b,after:a}:null;
}
function _qiPhotoNext(type){
  if(!_qi)return;
  const L=_qiPhotoList(type);if(L.length<2)return;
  const cur=_qiPhotoPair();const i=L.findIndex(p=>cur&&String(p.id)===String(cur[type].id));
  _qi.photos[type]=L[(i+1)%L.length].id;
  renderQuickInvoice();
}
function _qiPhotoSrc(p){return p&&(p.thumbUrl||p.url||p.data)||'';}
function _qiPhotoDocHtml(){
  const pr=_qi&&_qi.photos.on?_qiPhotoPair():null;
  if(!pr)return '';
  const img=(p,l)=>`<div style="flex:1;min-width:0"><img src="${escHtml(_qiPhotoSrc(p))}" alt="${l}" style="width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:12px;display:block"><div style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#5b6475;margin-top:6px;text-align:center">${l}</div></div>`;
  return `<div style="display:flex;gap:10px;margin:0 0 16px">${img(pr.before,'Before')}${img(pr.after,'After')}</div>`;
}
// ── SAVE, LIKE A PROPOSAL (owner 2026-09-29) ───────────────────────────────
// A saved invoice is a draft on the customer (c.qiDrafts, one per house), not
// a bid: a draft is not a sale and must never count as billed or as revenue.
// It carries what he decided on this screen; the hours are read fresh.
function _qiDraftKey(c,addr){return (typeof _addrKey==='function'&&_addrKey(addr||''))||'main';}
function _qiDraftGet(c,addr){const D=c&&c.qiDrafts;return D&&typeof D==='object'?D[_qiDraftKey(c,addr)]||null:null;}
function _qiDraftApply(d){
  if(!_qi||!d)return;
  _qi.off=new Set(d.off||[]);_qi.open=new Set(d.open||[]);
  _qi.dayNote=Object.assign({},d.dayNote||{});_qi.work=Array.isArray(d.work)?d.work.slice():[];
  _qi.typed=Array.isArray(d.typed)&&d.typed.length?d.typed.map(l=>Object.assign({},l)):_qi.typed;
  _qi.fixed=d.fixed!=null?Number(d.fixed):null;_qi.rates=Object.assign({},d.rates||{});
  _qi.showRate=d.showRate!=null?!!d.showRate:null;_qi.partsMode=d.partsMode||null;
  _qi.added=Array.isArray(d.added)?d.added.slice():[];
  _qi.photos=Object.assign({on:true,before:null,after:null},d.photos||{});
  _qi.xOn=new Set(d.xOn||[]);_qi.xOff=new Set(d.xOff||[]);_qi.dropped=new Set(d.dropped||[]);
  _qi.riderMins=Object.assign({},d.riderMins||{});
}
function qiSaveDraft(){
  if(!_qi)return;
  const c=getClientById(_qi.cid);if(!c)return;
  const D=(c.qiDrafts&&typeof c.qiDrafts==='object')?c.qiDrafts:{};
  D[_qiDraftKey(c,_qi.addr)]={id:_qi.id,mode:_qi.mode,off:[..._qi.off],open:[..._qi.open],dayNote:Object.assign({},_qi.dayNote),work:_qi.work.slice(),
    typed:_qi.typed.map(l=>Object.assign({},l)),fixed:_qi.fixed,rates:Object.assign({},_qi.rates),showRate:_qi.showRate,partsMode:_qi.partsMode,
    added:_qi.added.slice(),photos:Object.assign({},_qi.photos),xOn:[..._qi.xOn],xOff:[..._qi.xOff],dropped:[..._qi.dropped],riderMins:Object.assign({},_qi.riderMins||{}),
    total:_qiTotal(),at:new Date().toISOString()};
  c.qiDrafts=D;
  saveAll();
  _tbInvalidate();
  if(typeof showToast==='function')showToast('Saved. It waits on Ready to bill','✓');
  _qi=null;
  goPg('pg-dash');
}
function _qiDraftDrop(cid,addr){
  const c=getClientById(cid);
  if(c&&c.qiDrafts&&typeof c.qiDrafts==='object')delete c.qiDrafts[_qiDraftKey(c,addr)];
}
// A set price instead of hours (owner: "clicking into it could allow them to
// set a fixed price still shows all the same benefits"). The hours stay
// recorded and billed as days, the customer sees one number.
function _qiSetFixed(on){
  if(!_qi)return;
  _qi.fixed=on?Math.round(_qiOnLines().reduce((s2,l)=>s2+(Number(l.amount)||0),0)*100)/100:null;
  renderQuickInvoice();
}
function _qiFixedTyped(v){
  if(!_qi)return;
  _qi.fixed=parseFloat(String(v).replace(/[^0-9.]/g,''))||0;
  _qiTotalsPaint();
}
function _qiDayNoteTyped(day,v){if(_qi)_qi.dayNote[day]=v;}

// ── READY TO BILL (owner 2026-09-29) ───────────────────────────────────────
// Owner: "pull hours if there are hours, pull receipts to total up materials
// but not show them ... another dashboard for invoices then clicking into them
// opens up the invoice thing we already created." One row per house with
// unbilled work, oldest first, and a tap opens that house's invoice, already
// filled in. Same engine as the invoice screen (_qiVisitsFor, _qiUnbilled), so
// the number on Home is the number on the bill. Earl and the market research
// both picked one row per job with the days inside it, not a row per day.
// A house with a proposal job still open is billed from that job, so it is
// not on this list.
const _TB_DAYS=180;
let _tb=null,_tbBusy=false,_tbLast=[];
function _tbInvalidate(){if(_tb)_tb.stale=true;}
function _tbCan(){
  if(typeof _ownerUI==='function')return !!_ownerUI();
  return !(typeof _isEmployee!=='undefined'&&_isEmployee);
}
function _tbOnline(){return typeof supaEnabled==='function'&&supaEnabled()&&typeof _supaUser!=='undefined'&&!!_supaUser;}
async function _tbLoad(){
  if(_tbBusy||typeof _fetchCrewLabor!=='function'||!_tbOnline())return;
  _tbBusy=true;
  let lab=null;
  try{lab=await _fetchCrewLabor(new Date(Date.now()-_TB_DAYS*86400000).toISOString(),{noShop:true});}catch(_e){lab=null;}
  // A failed read keeps what the card already showed.
  _tb={at:Date.now(),lab:lab||(_tb&&_tb.lab)||null};
  _tbBusy=false;
  _renderToBill();
}
function _tbRows(lab){
  const entries=(lab&&lab.entries)||[],names=(lab&&lab.name)||{};
  const since=dateKey(new Date(Date.now()-_TB_DAYS*86400000));
  const all=new Set(),per=[];
  (clients||[]).forEach(c=>{
    if(!c||!c.name||c.archived)return;
    const houses=clientAddresses(c);
    (houses.length>1?houses.map(h=>h.addr):['']).forEach((addr,hi)=>{
      const pl=_qiPlaceNames(c,addr);pl.forEach(n=>all.add(n));
      per.push({c,addr,pl,first:hi===0});
    });
  });
  const byPlace={},byJob={};
  entries.forEach(e=>{
    if(!e||typeof e!=='object')return;
    const seen=new Set();
    [e.dest_place,e.origin_place].forEach(p=>{const k=String(p||'').trim();if(k&&!seen.has(k)){seen.add(k);(byPlace[k]||(byPlace[k]=[])).push(e);}});
    if(e.job_id!=null&&e.job_id!=='')(byJob[String(e.job_id)]||(byJob[String(e.job_id)]=[])).push(e);
  });
  const withReceipts=new Set(((typeof expenses!=='undefined'&&expenses)||[]).filter(e=>e&&e.client_id!=null&&Number(e.amount)>0).map(e=>String(e.client_id)));
  const rows=[];
  per.forEach(({c,addr,pl,first})=>{
    if(_qiPropJobs(c.id).length)return;          // billed from the proposal's job
    const set=new Set();
    pl.forEach(n=>(byPlace[n]||[]).forEach(e=>set.add(e)));
    _qiJobsAt(c.id,addr).forEach(j=>(byJob[String(j.id)]||[]).forEach(e=>set.add(e)));
    if(!set.size&&!(first&&withReceipts.has(String(c.id))))return;
    const u=_qiUnbilled(c.id,_qiVisitsFor(c,[...set],names,addr,all),addr);
    // Receipts ride on the first house only, and only inside the window, so a
    // two-house customer's Home Depot run is not counted twice and a receipt
    // from years back does not surface as work to bill.
    const lines=u.lines.filter(l=>l.kind!=='receipt'||(first&&l.day>=since));
    if(!lines.some(l=>l.kind==='time'))return;   // receipts alone are not a visit
    const days=_qiDays(lines);
    const mins=lines.filter(l=>l.kind==='time'&&!l.rider).reduce((s,l)=>s+l.mins,0);
    const total=Math.round(lines.reduce((s,l)=>s+(Number(l.amount)||0),0)*100)/100;
    const dr=_qiDraftGet(c,addr);
    rows.push({cid:c.id,name:c.name,addr:addr||c.addr||'',pick:addr,days,mins,total:dr&&Number(dr.total)>0?Number(dr.total):total,oldest:days[0],draft:!!dr});
  });
  // Drafts first (owner 2026-09-29: "a draft section inside ready to bill"),
  // then the rest, oldest first.
  return rows.sort((a,b)=>(b.draft-a.draft)||String(a.oldest).localeCompare(String(b.oldest))||String(a.name).localeCompare(String(b.name)));
}
function _tbSub(r){
  const st=String(r.addr||'').split(',')[0].trim();
  const n=r.days.length;
  const when=_qiDay(r.oldest)+' · '+(n>1?n+' days':_qiMins(r.mins));
  // The days first, so a long street is what gets cut short, not the count.
  return (r.draft?'Draft · ':'')+when+(st?' · '+st:'');
}
// How long the oldest unbilled day has waited. Short, so it fits beside the
// total on an iPhone SE.
function _tbAge(day){
  const d=Math.round((Date.parse(todayKey()+'T12:00:00')-Date.parse(String(day)+'T12:00:00'))/86400000);
  return d<=0?'today':d===1?'1 day':d+' days';
}
// ONE LINE UNDER THE TILES (owner 2026-09-29, "like #3 under the tiles but
// gotta make it so people will click it"). A money row that reads like a
// button: an icon tile, what is waiting and for how long, the total, and a
// chevron. Orange once the oldest day is two weeks old. One house opens its
// invoice; more than one folds the houses open underneath.
let _tbExpanded=false;
function _tbTap(){
  if(_tbLast.length===1)return _tbOpen(0);
  _tbExpanded=!_tbExpanded;
  _renderToBill();
}
function _renderToBill(){
  const el=document.getElementById('dash-to-bill');if(!el)return;
  const hide=()=>{el.innerHTML='';el.style.display='none';};
  if(!_tbCan()||!_tbOnline())return hide();
  if(!_tb){
    el.style.display='';
    el.innerHTML='<div class="ios-sec"><div class="ios-group"><div class="ios-row tb-sum" style="display:block">'+(typeof _tdSkelRows==='function'?_tdSkelRows(1,14):'')+'</div></div></div>';
    _tbLoad();return;
  }
  if(_tb.stale||Date.now()-_tb.at>5*60000){_tb.stale=false;_tbLoad();}
  const rows=_tb.lab?_tbRows(_tb.lab):[];
  _tbLast=rows;
  if(!rows.length)return hide();
  const old=dateKey(new Date(Date.now()-14*86400000));
  const late=rows[0].oldest<old;
  const sum=rows.reduce((s,r)=>s+r.total,0);
  const open=_tbExpanded&&rows.length>1;
  const nDraft=rows.filter(r=>r.draft).length;
  const what=(rows.length===1?rows[0].name:rows.length+' houses')+(nDraft&&rows.length>1?' · '+nDraft+' draft'+(nDraft>1?'s':''):'');
  el.style.display='';
  el.innerHTML='<div class="ios-sec"><div class="ios-group">'+
    '<button type="button" class="ios-row tb-sum'+(late?' late':'')+(open?'':' nosep')+'" onclick="_tbTap()" aria-expanded="'+open+'">'+
      '<span class="tb-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6"/><path d="M13 11.5c-.5-.6-1.3-.9-2-.9-1.1 0-2 .6-2 1.5 0 2 4 1.2 4 3.2 0 .9-.9 1.5-2 1.5-.8 0-1.6-.3-2.1-.9M11 9.5v1.1M11 17.3v1.1"/></svg></span>'+
      '<span class="ios-lbl"><b>Ready to bill</b><small class="tb-age">'+escHtml(what+' · '+_tbAge(rows[0].oldest))+'</small></span>'+
      '<span class="ios-fact tb-total">'+escHtml('$'+Math.round(sum).toLocaleString('en-US'))+'</span>'+
      '<span class="ios-chev tb-chev-sum'+(open?' open':'')+'" aria-hidden="true">›</span></button>'+
    '<div class="tb-list'+(open?' open':'')+'" style="max-height:'+(open?rows.length*72+(nDraft?80:8):0)+'px"'+(open?'':' inert')+'>'+rows.map((r,i)=>
      (nDraft&&(i===0||(!r.draft&&rows[i-1].draft))?'<div class="tb-grp">'+(r.draft?'Drafts':'Not started')+'</div>':'')+
      '<button type="button" class="ios-row tb-row'+(r.draft?' tb-draft':'')+'" onclick="_tbOpen('+i+')">'+
        '<span class="tb-dot'+(r.oldest<old?' old':'')+'" aria-hidden="true"></span>'+
        '<span class="ios-lbl"><b class="tb-name">'+escHtml(r.name)+'</b><small class="tb-sub">'+escHtml(_tbSub(r))+'</small></span>'+
        '<span class="ios-fact tb-amt">'+escHtml(_qiMoney(r.total).replace(/\.00$/,''))+'</span><span class="ios-chev" aria-hidden="true">›</span></button>').join('')+
    '</div></div></div>';
}
function _tbOpen(i){
  const r=_tbLast[i];if(!r)return;
  openQuickInvoice(r.cid,r.pick||'');
}
