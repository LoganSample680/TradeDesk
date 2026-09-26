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

// Who to offer first: the customers somebody was at in the last 7 days, newest
// first, each with the street so two Smiths are told apart. Search covers
// everyone else.
function _qiRecentClients(){
  const out=[];
  try{
    const since=Date.now()-7*86400000;
    const last={};
    const byJob=(typeof _jobTimeEntriesByJob==='object'&&_jobTimeEntriesByJob)||{};
    Object.keys(byJob).forEach(jid=>{
      const j=(jobs||[]).find(x=>String(x.id)===String(jid));
      if(!j||j.client_id==null)return;
      (byJob[jid]||[]).forEach(e=>{
        const t=Date.parse(e&&(e.arrivedAt||e.arrived_at)||'');
        if(t>=since&&(!last[j.client_id]||t>last[j.client_id]))last[j.client_id]=t;
      });
    });
    Object.keys(last).sort((a,b)=>last[b]-last[a]).slice(0,6).forEach(cid=>{
      const c=getClientById(Number(cid));
      if(c)out.push({label:c.name,sub:(c.addr||'').split(',')[0]||'No address',clientId:c.id,icon:'📍'});
    });
  }catch(_e){}
  return out;
}
function openQuickInvoicePicker(){
  showQuickPicker('Quick invoice','Who is it for?',_qiRecentClients(),'invoice',true,'Worked this week');
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
function _qiMins(m){const h=Math.floor(m/60),mm=Math.round(m%60);return (h?h+'h ':'')+(mm||!h?mm+'m':'').trim();}
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
// The unbilled work: one line per person (their minutes at this customer's
// jobs since the last quick invoice), then one line per unbilled receipt.
function _qiUnbilled(cid){
  const {through,exp}=_qiBilled(cid);
  const byPerson={};let last=through;
  const byJob=(typeof _jobTimeEntriesByJob==='object'&&_jobTimeEntriesByJob)||{};
  (jobs||[]).filter(j=>j&&String(j.client_id)===String(cid)&&!_qiPropBid(j)).forEach(j=>{
    (byJob[j.id]||[]).forEach(e=>{
      const a=Date.parse(e&&(e.arrivedAt||e.arrived_at)||'');
      const d=Date.parse(e&&(e.departedAt||e.departed_at)||'');
      if(!(a>through)||!(d>a))return;              // billed already, or still open
      const mins=Number(e.minutes)>0?Number(e.minutes):Math.round((d-a)/60000);
      const who=e.employeeName||(typeof S!=='undefined'&&S.ownerName)||'You';
      byPerson[who]=(byPerson[who]||0)+mins;
      if(d>last)last=d;
    });
  });
  const lines=Object.keys(byPerson).sort().map(who=>{
    const rate=_qiRateFor(who),mins=byPerson[who];
    return {kind:'time',who,mins,rate,desc:who+': '+_qiMins(mins)+' on site',amount:Math.round(mins/60*rate*100)/100};
  });
  ((typeof expenses!=='undefined'&&expenses)||[]).filter(e=>e&&String(e.client_id)===String(cid)&&!exp.has(String(e.id))&&Number(e.amount)>0)
    .forEach(e=>lines.push({kind:'receipt',expId:e.id,desc:(e.vendor||'Materials')+' receipt',date:_qiDay(e.date),amount:Number(e.amount)}));
  return {lines,through:last>through?new Date(last).toISOString():null};
}

function openQuickInvoice(cid){
  const c=getClientById(cid);if(!c)return;
  const un=_qiUnbilled(cid);
  const hasWork=un.lines.length>0;
  const mode=c.qiMode||(hasWork?'hourly':'set');
  _qi={cid,mode,tracked:un.lines,through:un.through,typed:[{desc:'',amount:''}],pbOpen:false};
  goPg('pg-qi');
  renderQuickInvoice();
}
function _qiSetMode(m){if(!_qi)return;_qi.mode=m;renderQuickInvoice();}
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
      ?escHtml(_qiMins(l.mins))+' on site at <span class="qi-rate">$<input type="text" inputmode="decimal" aria-label="Rate for '+escHtml(l.who)+'" value="'+(l.rate||'')+'" placeholder="0" oninput="_qiRate('+i+',this.value)">/hr</span>'
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
      '<button type="button" class="ios-navbtn bold" onclick="qiSeeIt()">See it</button></div>'+
    '<div class="ios-large"><h1 class="ios-title" style="cursor:default">Invoice</h1>'+
      '<div class="ios-sub">'+escHtml(c.name||'')+((c.addr||'')?' · '+escHtml(String(c.addr).split(',')[0]):'')+'</div></div>'+
    '<div class="qi-body">'+
      '<div class="ios-seg qi-seg" role="tablist">'+
        '<button type="button" role="tab" class="'+(hourly?'on':'')+'" onclick="_qiSetMode(\'hourly\')">Hourly</button>'+
        '<button type="button" role="tab" class="'+(hourly?'':'on')+'" onclick="_qiSetMode(\'set\')">Set price</button></div>'+
      _qiPropJobs(_qi.cid).map(p=>'<button type="button" class="qi-note" onclick="qiOpenJob(\''+escHtml(String(p.id))+'\')">'+
        escHtml(String(c.name||'').split(' ')[0])+' has a '+escHtml(p.name)+' job'+(p.paid>0?' with '+_qiMoney(p.paid).replace('.00','')+' paid':'')+
        '. Bill that one from the job, not here. <b>Open it</b></button>').join('')+
      (hourly?'<div class="ios-sec"><div class="ios-h"><span>Since the last invoice</span></div><div class="ios-group">'+
        (tracked||'<div class="ios-row"><span class="ios-lbl"><small style="margin:0">Nothing tracked at '+escHtml(c.name||'this customer')+' since the last invoice.</small></span></div>')+
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
// What the customer will get, before anything is saved or sent.
function qiSeeIt(){
  if(!_qi)return;
  const c=getClientById(_qi.cid)||{};
  const lines=_qiLines().filter(l=>Number(l.amount)>0);
  const ov=document.createElement('div');ov.className='zmodal-overlay';ov.id='qi-see';
  ov.onclick=e=>{if(e.target===ov)ov.remove();};
  const box=document.createElement('div');box.className='zmodal';
  box.innerHTML=
    '<div style="font-size:13px;font-weight:700;color:var(--text3)">'+escHtml((typeof S!=='undefined'&&S.bname)||'')+'</div>'+
    '<div style="font-size:22px;font-weight:800;margin:2px 0 2px">Invoice</div>'+
    '<div style="font-size:14px;color:var(--text3);margin-bottom:14px">'+escHtml(c.name||'')+(c.addr?'<br>'+escHtml(c.addr):'')+'</div>'+
    (lines.length?lines.map(l=>'<div style="display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid var(--border2);font-size:15px"><span>'+escHtml(l.desc)+'</span><span style="white-space:nowrap">'+_qiMoney(l.amount)+'</span></div>').join('')
      :'<div style="font-size:14px;color:var(--text3);padding:10px 0">No lines with a price yet.</div>')+
    '<div style="display:flex;justify-content:space-between;padding:12px 0 16px;font-size:18px;font-weight:800"><span>Total</span><span>'+_qiMoney(_qiTotal())+'</span></div>'+
    '<button type="button" class="btn btn-p btn-full" onclick="document.getElementById(\'qi-see\').remove()">Looks good</button>';
  ov.appendChild(box);document.body.appendChild(ov);
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
    desc:lines.map(l=>l.desc).join('\n'),lineItems:lines.map(l=>({desc:l.desc,amount:l.amount})),
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
