// ── Payroll Summary ─────────────────────────────────────────────────────
// Wires the already-built engines together against real data: Time Log
// hours (js/timelog.js) → gross wages (_calcGrossWages) → employer FICA/FUTA
// liability (_calcPayrollLiability), both in js/tax.js. Answers exactly one
// question: "how much cash do I need this pay period, all-in?" Federal FICA
// + FUTA only, no income-tax withholding, no state/local. Not tax/legal
// advice: same disclaimer pattern as the rest of the tax tool.

let _paySummaryPeriodType='weekly';
let _paySummaryStart=null,_paySummaryEnd=null;
let _paySummaryBusy=false;
let _paySummaryLastResult=null;

// ── ONE pay function (owner 2026-09-27, "go fix it all") ──────────────────
// Earl, 58, on a Friday, wanted to know what he owes each of his three guys.
// The app had three answers and all three were wrong in different ways:
// Payroll summed every row including the ones the Time Log marks unpaid (an
// unanswered gap became Mike's overtime, Joe's lunches pushed him to 40h),
// Crew Cost used the last seven days and a per-day "OT 5d" with no premium,
// and the Team card had no dollars at all. Payroll, Crew Cost and the Team
// card now all call THIS, so the three can never disagree again.
//
// Paid minutes are the Time Log's own definition (_tlPaidMin, js/timelog.js),
// grouped into Sunday to Saturday weeks (_tlWeekKey), federal weekly OT over
// 40h at 1.5x. A 1099 sub is paid hours x rate: no overtime, no payroll tax.
// The owner's own time (kind 'owner') is hours x rate too: he is not his own
// W-2 employee.
//
// comp = {pay_type:'hourly'|'salary', pay_rate} from team_members.
// opts.kind = 'w2' (default) | '1099' | 'owner'.
// opts.periodsPerYear: a salaried W-2 is paid rate/periodsPerYear for the
//   period (a paycheck, not hours). Without it (a job-costing range such as
//   Crew Cost's month) salary falls back to the hourly equivalent,
//   _empEffectiveHourly (js/cloud.js), which is what that screen always used.
function _payPersonPeriod(rows,comp,opts){
  const o=opts||{};
  const kind=o.kind==='1099'?'1099':o.kind==='owner'?'owner':'w2';
  const r2=v=>Math.round(v*100)/100;
  const byWeek={};
  (Array.isArray(rows)?rows:[]).forEach(r=>{
    if(!r||typeof r!=='object')return;
    const k=_tlWeekKey(r.date)||String(r.date||'');
    (byWeek[k]||(byWeek[k]=[])).push(r);
  });
  let paidMin=0,regMin=0,otMin=0;
  const weeks={};
  Object.keys(byWeek).sort().forEach(k=>{
    const wMin=Math.max(0,_tlPaidMin(byWeek[k]));
    const wOt=kind==='w2'?Math.max(0,wMin-2400):0;
    weeks[k]={paidMin:wMin,regMin:wMin-wOt,otMin:wOt};
    paidMin+=wMin;regMin+=wMin-wOt;otMin+=wOt;
  });
  const payType=comp&&comp.pay_type==='salary'?'salary':'hourly';
  const rate=Math.max(0,Number(comp&&comp.pay_rate)||0);
  const hourly=payType==='salary'?_empEffectiveHourly({pay_type:'salary',pay_rate:rate}):rate;
  let wages=0,otPremium=0;
  const ppy=Number(o.periodsPerYear)||0;
  if(payType==='salary'&&kind==='w2'&&ppy>0){
    wages=_calcGrossWages({pay_type:'salary',pay_rate:rate},0,0,ppy,1.5);
  }else{
    wages=_calcGrossWages({pay_type:'hourly',pay_rate:hourly},regMin,otMin,52,1.5);
    otPremium=r2(otMin/60*hourly*0.5);
  }
  return{kind,payType,rate,paidMin,regMin,otMin,wages:r2(wages),otPremium,weeks};
}
// How the app already records a 1099 sub on the crew: the Team modal's
// Classification select (js/cloud.js _EMP_CLASSIFICATIONS, 'Subcontractor').
function _payWorkerKind(emp){
  return (emp&&/^subcontractor$/i.test(String(emp.classification||'').trim()))?'1099':'w2';
}
// The team_members pay row for a crew member, keyed by email the way
// _loadTeamComp (js/cloud.js) keys it.
function _payCompFor(emp){
  const k=String((emp&&emp.email)||'').toLowerCase();
  return (k&&typeof _teamComp!=='undefined'&&_teamComp&&_teamComp[k])||{pay_type:'hourly',pay_rate:0};
}
function _paySummaryPeriodsPerYear(type){
  return {weekly:52,biweekly:26,semimonthly:24,monthly:12}[type]||52;
}
// Default date range for a period type, anchored on today (or a given date).
function _paySummaryDefaultRange(type,anchorISO){
  const d=anchorISO?new Date(anchorISO+'T00:00:00'):new Date();
  if(isNaN(d.getTime()))return _paySummaryDefaultRange(type,null);
  const ds=x=>dateKey(x);
  if(type==='monthly'){
    return{start:ds(new Date(d.getFullYear(),d.getMonth(),1)),end:ds(new Date(d.getFullYear(),d.getMonth()+1,0))};
  }
  if(type==='semimonthly'){
    if(d.getDate()<=15)return{start:ds(new Date(d.getFullYear(),d.getMonth(),1)),end:ds(new Date(d.getFullYear(),d.getMonth(),15))};
    return{start:ds(new Date(d.getFullYear(),d.getMonth(),16)),end:ds(new Date(d.getFullYear(),d.getMonth()+1,0))};
  }
  const wkStart=new Date(d);wkStart.setDate(wkStart.getDate()-wkStart.getDay());
  const wkEnd=new Date(wkStart);wkEnd.setDate(wkEnd.getDate()+(type==='biweekly'?13:6));
  return{start:ds(wkStart),end:ds(wkEnd)};
}
// _paySummaryWeeklySplit is DELETED (2026-09-27, §7): it summed every row's
// minutes, unpaid included, which is the bug that made Mike's unanswered gap
// into overtime. _payPersonPeriod above is the one weekly split now.
// Estimated YTD wages (before this period) for wage-base-cap purposes,
// straight-line for salary, actual logged hours for hourly. There is no
// persisted payroll-run ledger yet, so this is a Time-Log-derived estimate,
// editable by the caller if the real figure differs (rate changed mid-year,
// switched from another payroll system, etc.).
function _paySummaryYtdEstimate(comp,priorRows,startDate,year){
  const r2=v=>Math.round(v*100)/100;
  if(comp&&comp.pay_type==='salary'){
    const jan1=new Date(year+'-01-01T00:00:00');
    const periodStart=new Date(startDate+'T00:00:00');
    const weeksElapsed=Math.max(0,(periodStart-jan1)/(7*86400000));
    const weekly=(typeof _calcGrossWages==='function'?_calcGrossWages(comp,0,0,52,1.5):0);
    const gw=r2(weekly*weeksElapsed);
    return{grossWages:gw,ssWages:gw,futaWages:gw};
  }
  const gw=_payPersonPeriod(priorRows,comp,{}).wages;
  return{grossWages:r2(gw),ssWages:r2(gw),futaWages:r2(gw)};
}
// One person's period, off rows already in hand. Shared by the Payroll
// screen, the "What you owe this week" list and the Team card, so the three
// print the same dollars.
//   pending: on the Team page but has not joined yet (no employee_user_id).
//     Their pay is zero and they match NO rows: a null uid used to match the
//     owner's own clock (manual rows carry personUid null), so a crew member
//     who had not accepted the invite was paid for the owner's hours.
//   A 1099 sub has no liab at all: no FICA, no FUTA, nothing withheld.
function _paySummaryPerson(e,rows,startDate,endDate,periodsPerYear,year){
  const uid=(e&&e.employee_user_id)||null;
  const comp=_payCompFor(e);
  const kind=_payWorkerKind(e);
  if(!uid){
    return{employee:e,comp,kind,pending:true,uid:null,regMin:0,otMin:0,paidMin:0,grossWages:0,otPremium:0,ytd:null,liab:null};
  }
  const list=Array.isArray(rows)?rows:[];
  const periodRows=list.filter(r=>r&&r.personUid===uid&&r.date>=startDate&&r.date<=endDate);
  const pay=_payPersonPeriod(periodRows,comp,{kind,periodsPerYear});
  let ytd=null,liab=null;
  if(kind==='w2'){
    const priorRows=list.filter(r=>r&&r.personUid===uid&&r.date<startDate);
    ytd=_paySummaryYtdEstimate(comp,priorRows,startDate,year);
    liab=_calcPayrollLiability(pay.wages,ytd.ssWages,ytd.futaWages,year);
  }
  return{employee:e,comp,kind,pending:false,uid,regMin:pay.regMin,otMin:pay.otMin,paidMin:pay.paidMin,
    grossWages:pay.wages,otPremium:pay.otPremium,ytd,liab};
}
// Builds the full period summary: one row per non-owner crew member, plus
// aggregate totals. Async: pulls Time Log hours (manual + GPS) via
// _timeLogRows, which itself hits Supabase for crew entries.
async function _paySummaryBuild(startDate,endDate,periodType){
  const year=parseInt((startDate||'').slice(0,4),10)||new Date().getFullYear();
  const jan1=year+'-01-01';
  const rows=(typeof _timeLogRows==='function')?await _timeLogRows(jan1+'T00:00:00'):[];
  const periodsPerYear=_paySummaryPeriodsPerYear(periodType);
  const employees=(S.employees||[]).filter(e=>e&&e.role!=='owner');
  const rows2=employees.map(e=>_paySummaryPerson(e,rows,startDate,endDate,periodsPerYear,year));
  const totals=rows2.reduce((t,r)=>{
    t.grossWages+=r.grossWages||0;
    if(r.kind==='1099')t.subPay+=r.grossWages||0;
    t.employeeFica+=(r.liab&&r.liab.employeeFica)||0;
    t.employerFicaMatch+=(r.liab&&r.liab.employerFicaMatch)||0;
    t.futa940+=(r.liab&&r.liab.futa940)||0;
    return t;
  },{grossWages:0,subPay:0,employeeFica:0,employerFicaMatch:0,futa940:0});
  const r2=v=>Math.round(v*100)/100;
  totals.grossWages=r2(totals.grossWages);totals.subPay=r2(totals.subPay);totals.employeeFica=r2(totals.employeeFica);
  totals.employerFicaMatch=r2(totals.employerFicaMatch);totals.futa940=r2(totals.futa940);
  totals.cashNeeded=r2(totals.grossWages+totals.employerFicaMatch+totals.futa940);
  return{rows:rows2,totals,periodsPerYear,startDate,endDate};
}
// This week (Sun to Sat) for the Team card, synchronous, off the rows the
// Time Log already has on screen: uid -> {wages, kind}. Owner and payroll
// managers only (_canViewComp); anyone else gets an empty map, so a crew
// member never sees another person's money.
function _payOweWeekMap(rows,anchorISO){
  const out={};
  if(typeof _canViewComp==='function'&&!_canViewComp())return out;
  const r=_paySummaryDefaultRange('weekly',anchorISO||null);
  const year=parseInt(r.start.slice(0,4),10);
  (S.employees||[]).forEach(e=>{
    if(!e||e.role==='owner'||!e.employee_user_id)return;
    const p=_paySummaryPerson(e,rows,r.start,r.end,52,year);
    out[String(e.employee_user_id)]={wages:p.grossWages,kind:p.kind,otMin:p.otMin};
  });
  return out;
}
// Exports the current period to a payroll-ready CSV, one row per employee
// with everything ADP/Paychex/Gusto/QuickBooks Payroll need to key off: name,
// pay type/rate, regular vs OT hours, gross wages, and the employer-side
// FICA/FUTA liability for the business's own records. TradeDesk computes the
// numbers; the contractor's existing payroll system (or their accountant)
// actually runs and files payroll, same shape as how ServiceTitan's
// Configurable Payroll hands off to whichever processor the contractor
// already uses, rather than TradeDesk becoming a payroll processor itself.
function _paySummaryExportCSV(){
  const result=_paySummaryLastResult;
  if(!result||!result.rows.length){typeof showToast==='function'&&showToast('No payroll data to export for this period','📋');return;}
  const esc=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"';
  const header=['Employee','Pay Type','Rate','Regular Hours','OT Hours','Gross Wages','Employee FICA Withheld','Employer FICA Match','Employer FUTA','Period Start','Period End'];
  const lines=[header.map(esc).join(',')];
  result.rows.forEach(r=>{
    if(r.pending)return;
    const liab=r.liab||{employeeFica:0,employerFicaMatch:0,futa940:0};
    lines.push([
      r.employee.name||'',
      (r.kind==='1099'?'1099 ':'')+(r.comp.pay_type==='salary'?'Salary':'Hourly'),
      r.comp.pay_rate||0,
      (r.regMin/60).toFixed(2),
      (r.otMin/60).toFixed(2),
      r.grossWages||0,
      liab.employeeFica||0,
      liab.employerFicaMatch||0,
      liab.futa940||0,
      result.startDate,
      result.endDate
    ].map(esc).join(','));
  });
  const t=result.totals;
  lines.push(['TOTAL','','','','',t.grossWages,t.employeeFica,t.employerFicaMatch,t.futa940,result.startDate,result.endDate].map(esc).join(','));
  const biz=(typeof S!=='undefined'&&S.bname)?S.bname:'TradeDesk';
  const fname=(biz+'_Payroll_'+result.startDate+'_to_'+result.endDate+'.csv').replace(/[/,\s]+/g,'_');
  if(typeof downloadFile==='function')downloadFile(fname,lines.join('\n'),'text/csv');
  typeof showToast==='function'&&showToast('Payroll exported, hand this to your payroll system or accountant','📋');
}
function setPaySummaryPeriodType(type){
  _paySummaryPeriodType=type;
  const r=_paySummaryDefaultRange(type,_paySummaryStart);
  _paySummaryStart=r.start;_paySummaryEnd=r.end;
  renderPayrollSummary();
}
function setPaySummaryDate(which,val){
  if(which==='start')_paySummaryStart=val;else _paySummaryEnd=val;
  renderPayrollSummary();
}
// The timesheet stamp for one person's week (js/timesheet.js _tsCrewLoad),
// only when the caller looked it up.
function _paySummaryTsChip(r){
  if(!r||!('tsStatus' in r))return '';
  const st=String(r.tsStatus||'');
  const lbl=st==='approved'?'Approved':st==='submitted'?'Submitted':st==='rejected'?'Sent back':'Not sent yet';
  const col=st==='approved'?'var(--c-green-deep,#1B7A43)':st==='submitted'?'var(--blue)':st==='rejected'?'var(--c-amber-deep)':'var(--text3)';
  return '<span class="pay-ts" data-status="'+escHtml(st||'none')+'" style="font-size:10px;font-weight:800;color:'+col+';white-space:nowrap">'+lbl+'</span>';
}
const _payLine=(label,val,style)=>'<div style="display:flex;justify-content:space-between;gap:8px;'+(style||'font-size:11px;color:var(--text3)')+'"><span style="min-width:0">'+label+'</span><span style="white-space:nowrap">'+val+'</span></div>';
function _paySummaryRowHTML(r){
  const name=escHtml(r.employee.name||'');
  const is1099=r.kind==='1099';
  const payLbl=(is1099?'1099 sub · ':'')+(r.comp.pay_type==='salary'?'Salary':'Hourly');
  const rateLbl=r.comp.pay_type==='salary'?'$'+_moneyStr(r.comp.pay_rate||0).replace(/\.00$/,'')+'/yr':'$'+_moneyStr(r.comp.pay_rate||0).replace(/\.00$/,'')+'/hr';
  const hrs=v=>(v/60).toFixed(1);
  const head='<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">'+
      '<div style="font-size:13px;font-weight:700;min-width:0;overflow-wrap:anywhere">'+name+'</div>'+
      '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">'+_paySummaryTsChip(r)+
        '<span style="font-size:10px;font-weight:700;color:var(--text3)">'+payLbl+' · '+rateLbl+'</span></div>'+
    '</div>';
  const shell=inner=>'<div class="pay-person" data-uid="'+escHtml(String(r.uid||''))+'" style="padding:12px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);margin-bottom:8px;min-width:0">'+head+inner+'</div>';
  if(r.pending){
    return shell('<div class="pay-pending" style="font-size:12px;color:var(--text3)">Hasn\'t joined yet. Their hours show up here once they accept the invite.</div>');
  }
  const liab=r.liab||{employeeFica:0,employerFicaMatch:0,futa940:0};
  return shell(
    '<div style="font-size:11px;color:var(--text3);margin-bottom:6px">'+hrs(r.regMin)+'h regular'+(r.otMin>0?' + '+hrs(r.otMin)+'h overtime':'')+'</div>'+
    _payLine('Pay them','<span class="pay-them">'+fmt(r.grossWages)+'</span>','font-size:15px;font-weight:800;margin-bottom:2px')+
    (r.otPremium>0?_payLine('Includes overtime premium',fmt(r.otPremium)):'')+
    (is1099
      ?'<div style="font-size:11px;color:var(--text3)">1099 sub: hours x rate, no overtime, no taxes withheld. They handle their own.</div>'
      :_payLine('Employee FICA, comes out of their pay',fmt(liab.employeeFica))+
       _payLine('Your FICA match',fmt(liab.employerFicaMatch))+
       _payLine('Your FUTA',fmt(liab.futa940))+
       ((liab.ssWageBaseHit||liab.futaWageBaseHit)?'<div style="font-size:10px;color:var(--amber);margin-top:4px">'+svgIcon('⚠️')+' hit the '+(liab.ssWageBaseHit?'Social Security':'FUTA')+' wage base this period, verify the YTD estimate below is accurate</div>':''))
  );
}
// The all-in card, shared by the Payroll screen and the owe list. "Pay them"
// and "Total cash needed" are separate lines on purpose (owner 2026-09-27):
// the first is what goes to the people, the second is what leaves the bank.
function _paySummaryTotalsHTML(t,opts){
  const o=opts||{};
  return '<div class="card" style="margin-top:4px">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">'+
        '<div class="card-hd" style="margin-bottom:0">'+escHtml(o.title||'This period, all-in')+'</div>'+
        (o.exportBtn?'<button class="btn btn-sm" onclick="_paySummaryExportCSV()">⬇ Export</button>':'')+
      '</div>'+
      _payLine('Pay them (everyone)','<span class="pay-total-them">'+fmt(t.grossWages)+'</span>','font-size:13px;margin-bottom:4px')+
      (t.subPay>0?_payLine('of that, 1099 subs',fmt(t.subPay),'font-size:11px;color:var(--text3);margin-bottom:4px'):'')+
      _payLine('Your FICA match',fmt(t.employerFicaMatch),'font-size:13px;margin-bottom:4px')+
      _payLine('Your FUTA',fmt(t.futa940),'font-size:13px;margin-bottom:8px')+
      '<div style="display:flex;justify-content:space-between;gap:8px;font-size:16px;font-weight:800;padding-top:8px;border-top:1px solid var(--border)"><span>Total cash needed</span><span class="pay-total-cash">'+fmt(t.cashNeeded)+'</span></div>'+
      '<div style="font-size:10px;color:var(--text3);margin-top:6px">Pay them is an estimate: wages plus overtime, before income tax withholding. Employee FICA ('+fmt(t.employeeFica)+') comes out of their pay, it is already inside Pay them, not extra.</div>'+
    '</div>';
}
async function renderPayrollSummary(){
  const el=document.getElementById('pay-summary-body');
  if(!el)return;
  if(typeof _canViewComp==='function'&&!_canViewComp()){
    el.innerHTML='<div style="font-size:12px;color:var(--text3);padding:12px">You don\'t have permission to view payroll.</div>';
    return;
  }
  if(typeof _teamCompLoaded!=='undefined'&&!_teamCompLoaded&&typeof _loadTeamComp==='function'){
    _teamCompLoaded=true;await _loadTeamComp();
  }
  if(!_paySummaryStart||!_paySummaryEnd){
    const r=_paySummaryDefaultRange(_paySummaryPeriodType,null);
    _paySummaryStart=r.start;_paySummaryEnd=r.end;
  }
  const employees=(S.employees||[]).filter(e=>e.role!=='owner');
  const controlsHTML=
    '<div class="card" style="margin-bottom:12px">'+
      '<div class="fg fg2" style="margin-bottom:10px">'+
        '<div class="f" style="margin:0"><label>Pay period</label>'+
          '<select onchange="setPaySummaryPeriodType(this.value)">'+
            ['weekly','biweekly','semimonthly','monthly'].map(t=>'<option value="'+t+'"'+(t===_paySummaryPeriodType?' selected':'')+'>'+t.charAt(0).toUpperCase()+t.slice(1)+'</option>').join('')+
          '</select></div>'+
        '<div class="f" style="margin:0"></div>'+
      '</div>'+
      '<div class="fg fg2">'+
        '<div class="f" style="margin:0"><label>Start</label><input type="date" id="pay-summary-start" value="'+escHtml(_paySummaryStart)+'" onchange="setPaySummaryDate(\'start\',this.value)"></div>'+
        '<div class="f" style="margin:0"><label>End</label><input type="date" id="pay-summary-end" value="'+escHtml(_paySummaryEnd)+'" onchange="setPaySummaryDate(\'end\',this.value)"></div>'+
      '</div>'+
    '</div>';
  if(!employees.length){
    el.innerHTML=controlsHTML+'<div style="font-size:12px;color:var(--text3);padding:12px">No W-2 employees yet, add one on the Team page to run payroll.</div>';
    return;
  }
  el.innerHTML=controlsHTML+'<div style="padding:12px">'+_tdSkelRows(4,12)+'</div>';
  const _tsP=(_paySummaryPeriodType==='weekly'&&typeof _tsCrewLoad==='function')?_tsCrewLoad(_paySummaryStart):null;
  if(_paySummaryBusy)return;
  _paySummaryBusy=true;
  let result;
  try{result=await _paySummaryBuild(_paySummaryStart,_paySummaryEnd,_paySummaryPeriodType);}
  finally{_paySummaryBusy=false;}
  _paySummaryLastResult=result;
  // A weekly period is one timesheet week, so each person's stamp shows too.
  if(_tsP){
    const ts=await _tsP;
    result.rows.forEach(r=>{if(!r.pending)r.tsStatus=((ts||{})[String(r.uid)]||{}).status||'';});
  }
  el.innerHTML=controlsHTML+
    result.rows.map(_paySummaryRowHTML).join('')+
    _paySummaryTotalsHTML(result.totals,{exportBtn:true})+
    _PAY_DISCLAIMER;
}
const _PAY_DISCLAIMER='<div style="font-size:9px;color:var(--text3);margin-top:10px">Federal FICA + FUTA only, no income tax withholding, no state/local taxes. Not tax or legal advice. Take these numbers to your accountant before running real payroll.</div>';

// ── What you owe this week (owner 2026-09-27) ────────────────────────────
// The one question Earl opened the app for on a Friday, one tap from the
// Team timesheet instead of four taps deep in Taxes. Same builder as the
// Payroll screen (weekly, Sunday to Saturday), plus whether each person has
// sent their timesheet. The app's centred prompt (.zmodal-overlay/.zmodal,
// the same shell Crew Cost uses, §7.3).
function _payOweClose(){document.getElementById('pay-owe-ov')?.remove();}
async function openPayOwe(anchorISO){
  if(typeof _canViewComp==='function'&&!_canViewComp()){
    typeof zAlert==='function'&&zAlert('You need the Pay & profit permission to view this.');return false;
  }
  _payOweClose();
  const range=_paySummaryDefaultRange('weekly',anchorISO||null);
  const ov=document.createElement('div');ov.id='pay-owe-ov';ov.className='zmodal-overlay';
  const box=document.createElement('div');box.className='zmodal';box.style.maxWidth='460px';
  const label=(typeof _tlWeekLabel==='function')?String(_tlWeekLabel(range.start)).replace(/^Week of /,''):range.start;
  box.innerHTML='<div style="font-size:17px;font-weight:800;margin-bottom:2px">What you owe this week</div>'+
    '<div style="font-size:12px;color:var(--text3);margin-bottom:12px">'+escHtml(label)+' (Sun to Sat), paid time only</div>'+
    '<div id="pay-owe-body" style="max-height:62vh;overflow-y:auto">'+_tdSkelRows(4,12)+'</div>'+
    '<button onclick="_payOweClose()" style="width:100%;padding:10px;border-radius:var(--r);border:none;background:none;color:var(--text3);font-size:13px;cursor:pointer;font-family:inherit;margin-top:10px;min-height:44px">Close</button>';
  ov.appendChild(box);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)_payOweClose();});
  if(typeof _teamCompLoaded!=='undefined'&&!_teamCompLoaded&&typeof _loadTeamComp==='function'){
    _teamCompLoaded=true;await _loadTeamComp();
  }
  const [result,ts]=await Promise.all([
    _paySummaryBuild(range.start,range.end,'weekly'),
    (typeof _tsCrewLoad==='function')?_tsCrewLoad(range.start):Promise.resolve({})
  ]);
  result.rows.forEach(r=>{if(!r.pending)r.tsStatus=((ts||{})[String(r.uid)]||{}).status||'';});
  const body=document.getElementById('pay-owe-body');
  if(!body)return false;
  body.innerHTML=result.rows.length
    ?result.rows.map(_paySummaryRowHTML).join('')+_paySummaryTotalsHTML(result.totals,{title:'This week, all-in'})+_PAY_DISCLAIMER
    :'<div style="font-size:12px;color:var(--text3);padding:12px 0">Nobody on the crew yet. Add them on the Team page.</div>';
  return result;
}
