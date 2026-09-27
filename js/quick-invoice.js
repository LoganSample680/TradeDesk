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
function _qiPickList(){
  const rank={now:0,next:1,done:2};
  return (clients||[]).filter(c=>c&&c.name&&!c.archived).map(c=>{
    const st=_qiStatus(c.id);
    return {c,st,r:st?rank[st.k]:3,t:_qiLastTouch(c)};
  }).sort((a,b)=>(a.r-b.r)||(b.t-a.t)||String(a.c.name).localeCompare(String(b.c.name)))
    .map(({c,st})=>({label:c.name,sub:((c.addr||'').split(',')[0]||'No address')+(st?' · '+st.label:''),clientId:c.id,icon:'📍',
      find:[c.name,c.addr,c.phone].filter(Boolean).join(' ')}));
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
  showQuickPicker('Quick invoice','Who is it for?',_qiPickList(),'invoice',true,'Your customers',{searchFirst:true});
}

// Everything this customer has been billed for on a quick invoice already.
function _qiBilled(cid){
  let through=0;const exp=new Set();
  (bids||[]).forEach(b=>{
    if(!b||b.kind!=='quick_invoice'||String(b.client_id)!==String(cid))return;
    const t=Date.parse(b.qiTimeThrough||'');if(t>through)through=t;
    (b.qiExpenseIds||[]).forEach(id=>exp.add(String(id)));
  });
  return {through,exp};
}
// A person's bill rate: their own, else the business's labor rate. Time rows
// carry the person's NAME only (cloud.js _crewMemberName), so the match is by
// name, the same way the Time Log labels them.
function _qiRateFor(name){
  const emp=((typeof S!=='undefined'&&S.employees)||[]).find(e=>e&&e.name===name);
  const r=Number(emp&&emp.billRate)||0;
  return r>0?r:(Number(typeof S!=='undefined'&&S.laborRate)||0);
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
function _qiPlaceNames(c){
  const nm=(n,w)=>typeof _geoFenceName==='function'?_geoFenceName(n,w):(w?(String(n).trim()+' ('+w+')'):String(n).trim());
  const st=a=>String(a||'').split(',')[0].trim();
  const out=new Set();
  if(!c||!c.name)return out;
  out.add(nm(c.name,st(c.addr)));
  (Array.isArray(c.extraAddresses)?c.extraAddresses:[]).forEach(a=>{
    if(!a||!a.addr)return;
    out.add(nm(c.name,(a.label&&String(a.label).trim())||st(a.addr)));
    out.add(nm(c.name,st(a.addr)));
  });
  (jobs||[]).forEach(j=>{if(j&&String(j.client_id)===String(c.id))out.add(nm(c.name,st(j.addr||j.address)));});
  return out;
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
function _qiVisitsFor(c,entries,names){
  const cid=String(c.id);
  const mine=new Set((jobs||[]).filter(j=>j&&String(j.client_id)===cid&&!_qiPropBid(j)).map(j=>String(j.id)));
  const theirs=new Set((jobs||[]).filter(j=>j&&String(j.client_id)===cid).map(j=>String(j.id)));
  const places=_qiPlaceNames(c);
  const who=uid=>(names&&names[uid])||(String(uid)===String(_qiBizUid())?_qiOwnerName():null);
  const isSite=e=>{
    if(e.job_id!=null&&e.job_id!=='')return mine.has(String(e.job_id));   // a proposal job's time stays on that job
    if(_QI_NOT_A_VISIT.test(String(e.source||'')))return false;
    return places.has(String(e.dest_place||'').trim())&&!theirs.has(String(e.job_id));
  };
  const list=(entries||[]).filter(e=>e&&typeof e==='object');
  const site=list.filter(isSite);
  // Every other customer place on record, so a leg to one of them is shared.
  const custPlaces=new Set(list.filter(e=>!_QI_NOT_A_VISIT.test(String(e.source||''))&&e.dest_place).map(e=>String(e.dest_place).trim()));
  const out=site.map(e=>({kind:'site',arrivedAt:e.arrived_at,departedAt:e.departed_at,minutes:e.minutes,employeeName:who(e.employee_user_id)}));
  list.forEach(e=>{
    if(!_QI_DRIVE.test(String(e.source||'')))return;
    const o=String(e.origin_place||'').trim(),d=String(e.dest_place||'').trim();
    const oHis=places.has(o),dHis=places.has(d);
    if(!oHis&&!dHis)return;
    const other=oHis?d:o;
    const shared=!(oHis&&dHis)&&custPlaces.has(other);
    const a=Date.parse(e.arrived_at||''),z=Date.parse(e.departed_at||'');
    const m=Number(e.minutes)>0?Number(e.minutes):(z>a?Math.round((z-a)/60000):0);
    out.push({kind:'drive',arrivedAt:e.arrived_at,departedAt:e.departed_at,minutes:shared?m/2:m,employeeName:who(e.employee_user_id)});
  });
  return out;
}
function _qiBillDrive(){return !!(typeof S!=='undefined'&&S&&S.qiBillDrive);}
function _qiSetBillDrive(on){
  S.qiBillDrive=!!on;
  if(typeof _settingsChanged==='function')_settingsChanged();
  if(!_qi)return;
  const u=_qiUnbilled(_qi.cid,_qi.visits);
  _qiKeepRates(u.lines);
  _qi.tracked=u.lines;_qi.through=u.through;
  renderQuickInvoice();
}
// A rate he typed on screen stays when the lines are rebuilt.
function _qiKeepRates(lines){
  const rates={};(_qi&&_qi.tracked||[]).forEach(l=>{if(l.kind==='time')rates[l.who]=l.rate;});
  lines.forEach(l=>{if(l.kind==='time'&&rates[l.who]!=null){l.rate=rates[l.who];l.amount=Math.round(l.mins/60*l.rate*100)/100;}});
  return lines;
}
function _qiBizUid(){return (typeof _effectiveUid==='function'&&_effectiveUid())||(typeof _supaUser!=='undefined'&&_supaUser&&_supaUser.id)||'';}
function _qiOwnerName(){return (typeof getOwnerName==='function'&&getOwnerName())||(typeof S!=='undefined'&&S.ownerName)||'You';}
async function _qiLoadVisits(cid){
  const c=getClientById(cid);if(!c||typeof _fetchCrewLabor!=='function')return null;
  // Offline or signed out: no answer, so the screen keeps what it has.
  if(!(typeof supaEnabled==='function'&&supaEnabled()&&typeof _supaUser!=='undefined'&&_supaUser&&typeof _supa!=='undefined'&&_supa))return null;
  const {through}=_qiBilled(cid);
  const since=new Date(Math.max(through||0,Date.now()-180*86400000)).toISOString();
  const lab=await _fetchCrewLabor(since);
  return _qiVisitsFor(c,lab&&lab.entries,lab&&lab.name);
}

// The unbilled work: one line per person (their minutes at this customer's
// jobs since the last quick invoice), then one line per unbilled receipt.
function _qiUnbilled(cid,visits){
  const {through,exp}=_qiBilled(cid);
  const byPerson={};let last=through;
  // What the job cache holds, plus the loaded visits, each visit once (the
  // two overlap on job_id rows): same person, same arrival.
  const byJob=(typeof _jobTimeEntriesByJob==='object'&&_jobTimeEntriesByJob)||{};
  let src=[];
  (jobs||[]).filter(j=>j&&String(j.client_id)===String(cid)&&!_qiPropBid(j)).forEach(j=>{src=src.concat(byJob[j.id]||[]);});
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
    const mins=Number(e.minutes)>0?Number(e.minutes):Math.round((d-a)/60000);
    const who=e.employeeName||(typeof S!=='undefined'&&S.ownerName)||'You';
    const p=byPerson[who]||(byPerson[who]={site:0,drive:0});
    p[kind]=(p[kind]||0)+mins;
    if(d>last)last=d;
  });
  const lines=Object.keys(byPerson).sort().map(who=>{
    const p=byPerson[who];
    const mins=Math.round(p.site+p.drive);
    const rate=_qiRateFor(who);
    const detail=[p.site>0&&_qiMins(Math.round(p.site))+' on site',p.drive>=1&&_qiMins(Math.round(p.drive))+' driving'].filter(Boolean).join(', ');
    return {kind:'time',who,mins,rate,detail,desc:who+': '+detail,amount:Math.round(mins/60*rate*100)/100};
  }).filter(l=>l.mins>0);
  ((typeof expenses!=='undefined'&&expenses)||[]).filter(e=>e&&String(e.client_id)===String(cid)&&!exp.has(String(e.id))&&Number(e.amount)>0)
    .forEach(e=>lines.push({kind:'receipt',expId:e.id,desc:(e.vendor||'Materials')+' receipt',date:_qiDay(e.date),amount:Number(e.amount)}));
  return {lines,through:last>through?new Date(last).toISOString():null};
}

function openQuickInvoice(cid){
  const c=getClientById(cid);if(!c)return;
  const un=_qiUnbilled(cid);
  const hasWork=un.lines.length>0;
  const mode=c.qiMode||(hasWork?'hourly':'set');
  _qi={cid,mode,tracked:un.lines,through:un.through,typed:[{desc:'',amount:''}],work:[],pbOpen:false,loading:true,modeSet:!!c.qiMode};
  goPg('pg-qi');
  renderQuickInvoice();
  // The visits load once, then the screen paints once more (the shimmer in
  // the tracked rows until then, never a "Loading" line: CLAUDE.md 8.4).
  const me=_qi;
  Promise.resolve(_qiLoadVisits(cid)).catch(()=>null).then(v=>{
    if(_qi!==me)return;                         // he left, or opened someone else
    me.loading=false;
    if(Array.isArray(v)){
      me.visits=v;
      const u=_qiUnbilled(cid,v);
      me.tracked=_qiKeepRates(u.lines);
      me.through=u.through;
      if(!me.modeSet&&me.tracked.some(l=>l.kind==='time'))me.mode='hourly';
    }
    renderQuickInvoice();
  });
}
function _qiSetMode(m){if(!_qi)return;_qi.mode=m;_qi.modeSet=true;renderQuickInvoice();}
function _qiLines(){
  if(!_qi)return [];
  const typed=_qi.typed.filter(l=>String(l.desc||'').trim()||Number(l.amount)>0).map(l=>({kind:'line',desc:String(l.desc||'').trim(),amount:Number(l.amount)||0}));
  return (_qi.mode==='hourly'?_qi.tracked:[]).concat(typed);
}
function _qiTotal(){return Math.round(_qiLines().reduce((s,l)=>s+(Number(l.amount)||0),0)*100)/100;}

function renderQuickInvoice(){
  const host=document.getElementById('qi-page');if(!host||!_qi)return;
  const c=getClientById(_qi.cid)||{};
  const hourly=_qi.mode==='hourly';
  const tracked=hourly?_qi.tracked.map((l,i)=>{
    // The rate sits in the line under the name, small, so the name keeps the
    // width of the row on a phone.
    const sub=l.kind==='time'
      ?escHtml(l.detail||(_qiMins(l.mins)+' on site'))+' at <span class="qi-rate">$<input type="text" inputmode="decimal" aria-label="Rate for '+escHtml(l.who)+'" value="'+(l.rate||'')+'" placeholder="0" oninput="_qiRate('+i+',this.value)">/hr</span>'
      :'Receipt'+(l.date?' · '+escHtml(l.date):'');
    const name=l.kind==='time'?l.who:l.desc;
    return '<div class="ios-row"><span class="ios-lbl">'+escHtml(name)+'<small>'+sub+'</small></span>'+
      '<span class="ios-fact qi-amt" id="qi-amt-'+i+'">'+_qiMoney(l.amount)+'</span>'+
      '<button type="button" class="qi-x" aria-label="Leave off" onclick="_qiDropTracked('+i+')">×</button></div>';
  }).join(''):'';
  const typed=_qi.typed.map((l,i)=>
    '<div class="ios-row"><input class="qi-desc" type="text" placeholder="'+(hourly?'Anything else':'Describe the work')+'" value="'+escHtml(l.desc||'')+'" oninput="_qiTyped('+i+',\'desc\',this.value)">'+
    '<span class="ios-val">$<input type="text" inputmode="decimal" placeholder="0" value="'+(l.amount===''?'':escHtml(String(l.amount)))+'" oninput="_qiTyped('+i+',\'amount\',this.value)"></span></div>').join('');
  const pb=_qiPriceBook();
  const pbHtml=_qi.pbOpen&&pb.length?'<div class="qi-pb">'+pb.slice(0,12).map((p,i)=>
    '<button type="button" onclick="_qiAddPb('+i+')">'+escHtml(p.desc)+(Number(p.rate)>0?' · '+_qiMoney(p.rate).replace('.00',''):'')+'</button>').join('')+'</div>':'';
  const total=_qiTotal();
  host.innerHTML=
    '<div class="ios-nav"><button type="button" class="ios-navbtn" onclick="qiCancel()">Cancel</button>'+
      '<button type="button" class="ios-navbtn bold" onclick="qiSeeIt()">Preview</button></div>'+
    '<div class="ios-large"><h1 class="ios-title" style="cursor:default">Invoice</h1>'+
      '<div class="ios-sub">'+escHtml(c.name||'')+((c.addr||'')?' · '+escHtml(String(c.addr).split(',')[0]):'')+'</div>'+
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
      (hourly?'<div class="ios-sec"><div class="ios-h"><span>Since the last invoice</span></div><div class="ios-group">'+
        ((tracked+(_qi.loading&&typeof _tdSkelRows==='function'?'<div class="ios-row" style="display:block">'+_tdSkelRows(2,14)+'</div>':''))||'<div class="ios-row"><span class="ios-lbl"><small style="margin:0">Nothing tracked at '+escHtml(c.name||'this customer')+' since the last invoice.</small></span></div>')+
        '<label class="ios-row" style="cursor:pointer"><span class="ios-lbl">Bill drive time<small>Your setting for every invoice</small></span>'+
          '<input type="checkbox" class="ios-switch" id="qi-drive" '+(_qiBillDrive()?'checked':'')+' onchange="_qiSetBillDrive(this.checked)"></label>'+
      '</div></div>':'')+
      '<div class="ios-sec"><div class="ios-h"><span>'+(hourly?'Add a line':'What you did')+'</span></div><div class="ios-group">'+typed+
        '<button type="button" class="ios-row ios-link" onclick="_qiAddLine()">Add a line</button>'+
        (pb.length?'<button type="button" class="ios-row ios-link" onclick="_qi.pbOpen=!_qi.pbOpen;renderQuickInvoice()">'+(_qi.pbOpen?'Hide price book':'Add from price book')+'</button>':'')+
      '</div>'+pbHtml+'</div>'+
      '<div class="ios-sec"><div class="ios-group"><div class="ios-row"><span class="ios-lbl"><b>Total</b></span><span class="ios-fact qi-total" id="qi-total">'+_qiMoney(total)+'</span></div></div>'+
        '<div class="ios-foot">'+(hourly?'Once sent, these hours and receipts are marked billed and the next invoice starts after them.':'Your tracked time and receipts are not on this bill.')+'</div></div>'+
      '<button type="button" class="ios-btn ios-btn-fill" id="qi-send" onclick="qiSend()">Text it to '+escHtml(String(c.name||'customer').split(' ')[0])+'</button>'+
      '<button type="button" class="ios-btn ios-btn-tint" id="qi-paynow" onclick="qiPayNow()">Pay now</button>'+
    '</div>';
}
function _qiRate(i,v){
  const l=_qi&&_qi.tracked[i];if(!l)return;
  l.rate=parseFloat(String(v).replace(/[^0-9.]/g,''))||0;
  l.amount=Math.round(l.mins/60*l.rate*100)/100;
  const a=document.getElementById('qi-amt-'+i);if(a)a.textContent=_qiMoney(l.amount);
  const t=document.getElementById('qi-total');if(t)t.textContent=_qiMoney(_qiTotal());
}
function _qiTyped(i,k,v){
  const l=_qi&&_qi.typed[i];if(!l)return;
  l[k]=k==='amount'?(String(v).replace(/[^0-9.]/g,'')):v;
  const t=document.getElementById('qi-total');if(t)t.textContent=_qiMoney(_qiTotal());
}
function _qiAddLine(){if(!_qi)return;_qi.typed.push({desc:'',amount:''});renderQuickInvoice();}
function _qiDropTracked(i){if(!_qi)return;_qi.tracked.splice(i,1);renderQuickInvoice();}
// Every price book item he has used, most used first, across his trades.
function _qiPriceBook(){
  const pb=(typeof S!=='undefined'&&S.priceBook)||{};
  const all=[];
  Object.keys(pb).forEach(t=>(Array.isArray(pb[t])?pb[t]:[]).forEach(p=>{if(p&&p.desc)all.push(p);}));
  return all.sort((a,b)=>(Number(b.n)||0)-(Number(a.n)||0));
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
  const steps=timSaySteps(said);
  if(_qi.mode==='hourly'){
    const have=new Set(_qi.work.map(w=>w.toLowerCase()));
    steps.forEach(st=>{if(!have.has(st.toLowerCase())){_qi.work.push(st);have.add(st.toLowerCase());}});
  }else{
    const trade=(typeof getActiveTrade==='function'&&getActiveTrade())||'general';
    _qi.typed=_qi.typed.filter(l=>String(l.desc||'').trim()||Number(l.amount)>0);
    const have=new Set(_qi.typed.map(l=>String(l.desc).toLowerCase()));
    steps.forEach(st=>{
      if(have.has(st.toLowerCase()))return;have.add(st.toLowerCase());
      const own=(typeof _pbFind==='function')?_pbFind(st,trade):null;
      _qi.typed.push({desc:st,amount:own&&Number(own.rate)>0?Number(own.rate):''});
    });
    if(!_qi.typed.length)_qi.typed=[{desc:'',amount:''}];
  }
  renderQuickInvoice();
  if(typeof _tdHaptic==='function')_tdHaptic('tick');
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
  const rows=lines.map(l=>`<tr><td style="${td}">${escHtml(l.desc)}</td><td style="${td};text-align:right;white-space:nowrap">${_qiMoney(l.amount)}</td></tr>`).join('');
  const table=`<div style="margin:18px 16px 16px;border-radius:18px;overflow:hidden;border:1px solid #e8eaef">`+
    `<table style="width:100%;border-collapse:collapse"><tbody>${rows}</tbody>`+
    `<tfoot><tr><td style="padding:16px 18px;border-top:2px solid #e2e8f0;font-size:17px;font-weight:800">Total due</td>`+
    `<td style="padding:16px 18px;border-top:2px solid #e2e8f0;font-size:20px;font-weight:800;text-align:right;white-space:nowrap;color:${pb.a}">${_qiMoney(total)}</td></tr></tfoot></table></div>`;
  return _propDoc(
    _propCover({bname,bphone:(typeof S!=='undefined'&&S.bphone)||'',blic:(typeof S!=='undefined'&&S.blic)||'',accent:pb.a,
      label:'Invoice',num:num||'Draft',date:todayKey(),name:escHtml(c.name||''),addr:escHtml(c.addr||''),phone:escHtml(c.phone||''),
      project:escHtml(_qiMoney(total))+' due',until:null,forLabel:'Billed to'})+
    _propSection('Work performed','',_qiWorkListHtml()+table.replace('margin:18px 16px 16px','margin:0'),{noRule:true})+
    _propSignoff(bname,'Thank you for choosing'));
}
// What he said he did, as a plain list above the charges. Hourly only.
function _qiWorkListHtml(){
  const w=(_qi&&_qi.mode==='hourly'&&Array.isArray(_qi.work))?_qi.work:[];
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
  const bid={id:_newBidId(),client_id:c.id,client_name:c.name||'',name:c.name||'',phone:c.phone||'',addr:c.addr||'',
    type:'Invoice',kind:'quick_invoice',status:'Closed Won',draft:false,
    bid_date:todayKey(),completion_date:todayKey(),amount:total,deposit:0,
    desc:(hourly?_qi.work:[]).concat(lines.map(l=>l.desc)).join('\n'),lineItems:lines.map(l=>({desc:l.desc,amount:l.amount})),
    qiWork:hourly?_qi.work.slice():[],
    qiMode:_qi.mode,
    qiTimeThrough:hourly?_qi.through:null,
    qiExpenseIds:hourly?_qi.tracked.filter(l=>l.kind==='receipt').map(l=>l.expId):[]};
  bids.unshift(bid);
  c.qiMode=_qi.mode;
  saveAll();
  _qi=null;
  goPg('pg-dash');
  return bid;
}
// Text them the link to pay later.
function qiSend(){
  const bid=_qiSave();if(!bid)return false;
  if(typeof _sendPaidInvoice==='function')_sendPaidInvoice(bid.id);
  return bid;
}
// Settle it now, in person: the same pay panel every job uses (Tap to Pay,
// card by QR, cash, check, Venmo, Zelle), so the payment is recorded against
// this invoice and it reads paid everywhere.
function qiPayNow(){
  const bid=_qiSave();if(!bid)return false;
  if(typeof openPayPanel==='function')openPayPanel(bid.id,'final');
  return bid;
}
