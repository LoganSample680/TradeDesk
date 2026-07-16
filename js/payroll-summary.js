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

function _paySummaryPeriodsPerYear(type){
  return {weekly:52,biweekly:26,semimonthly:24,monthly:12}[type]||52;
}
// Default date range for a period type, anchored on today (or a given date).
function _paySummaryDefaultRange(type,anchorISO){
  const d=anchorISO?new Date(anchorISO+'T00:00:00'):new Date();
  if(isNaN(d.getTime()))return _paySummaryDefaultRange(type,null);
  const ds=x=>x.toISOString().slice(0,10);
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
// Federal (FLSA) weekly OT split, same universal-only rule as _tlComputeOT
// in timelog.js, applied here to actual payroll dollars instead of a badge.
function _paySummaryWeeklySplit(rows){
  const byWeek={};
  (rows||[]).forEach(r=>{
    const k=(typeof _tlWeekKey==='function')?_tlWeekKey(r.date):r.date;
    byWeek[k]=(byWeek[k]||0)+(r.minutes||0);
  });
  let regMin=0,otMin=0;
  Object.values(byWeek).forEach(total=>{regMin+=Math.min(total,2400);otMin+=Math.max(0,total-2400);});
  return{regMin,otMin};
}
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
  const{regMin,otMin}=_paySummaryWeeklySplit(priorRows);
  const gw=(typeof _calcGrossWages==='function'?_calcGrossWages(comp,regMin,otMin,52,1.5):0);
  return{grossWages:r2(gw),ssWages:r2(gw),futaWages:r2(gw)};
}
// Builds the full period summary: one row per non-owner W-2 employee, plus
// aggregate totals. Async: pulls Time Log hours (manual + GPS) via
// _timeLogRows, which itself hits Supabase for crew entries.
async function _paySummaryBuild(startDate,endDate,periodType){
  const year=parseInt((startDate||'').slice(0,4),10)||new Date().getFullYear();
  const jan1=year+'-01-01';
  const rows=(typeof _timeLogRows==='function')?await _timeLogRows(jan1+'T00:00:00'):[];
  const periodsPerYear=_paySummaryPeriodsPerYear(periodType);
  const employees=(S.employees||[]).filter(e=>e.role!=='owner');
  const rows2=[];
  employees.forEach(e=>{
    const uid=e.employee_user_id||null;
    const comp=(typeof _teamComp!=='undefined'&&_teamComp[(e.email||'').toLowerCase()])||{pay_type:'hourly',pay_rate:0};
    const periodRows=rows.filter(r=>r.personUid===uid&&r.date>=startDate&&r.date<=endDate);
    const priorRows=rows.filter(r=>r.personUid===uid&&r.date<startDate);
    const{regMin,otMin}=_paySummaryWeeklySplit(periodRows);
    const grossWages=(typeof _calcGrossWages==='function')?_calcGrossWages(comp,regMin,otMin,periodsPerYear,1.5):0;
    const ytd=_paySummaryYtdEstimate(comp,priorRows,startDate,year);
    const liab=(typeof _calcPayrollLiability==='function')?_calcPayrollLiability(grossWages,ytd.ssWages,ytd.futaWages,year):null;
    rows2.push({employee:e,comp,regMin,otMin,grossWages,ytd,liab});
  });
  const totals=rows2.reduce((t,r)=>{
    t.grossWages+=r.grossWages||0;
    t.employeeFica+=(r.liab&&r.liab.employeeFica)||0;
    t.employerFicaMatch+=(r.liab&&r.liab.employerFicaMatch)||0;
    t.futa940+=(r.liab&&r.liab.futa940)||0;
    return t;
  },{grossWages:0,employeeFica:0,employerFicaMatch:0,futa940:0});
  const r2=v=>Math.round(v*100)/100;
  totals.grossWages=r2(totals.grossWages);totals.employeeFica=r2(totals.employeeFica);
  totals.employerFicaMatch=r2(totals.employerFicaMatch);totals.futa940=r2(totals.futa940);
  totals.cashNeeded=r2(totals.grossWages+totals.employerFicaMatch+totals.futa940);
  return{rows:rows2,totals,periodsPerYear,startDate,endDate};
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
    const liab=r.liab||{employeeFica:0,employerFicaMatch:0,futa940:0};
    lines.push([
      r.employee.name||'',
      r.comp.pay_type==='salary'?'Salary':'Hourly',
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
function _paySummaryRowHTML(r){
  const name=escHtml(r.employee.name||'');
  const payLbl=r.comp.pay_type==='salary'?'Salary':'Hourly';
  const rateLbl=r.comp.pay_type==='salary'?'$'+_moneyStr(r.comp.pay_rate||0).replace(/\.00$/,'')+'/yr':'$'+_moneyStr(r.comp.pay_rate||0).replace(/\.00$/,'')+'/hr';
  const hrs=v=>(v/60).toFixed(1);
  const liab=r.liab||{employeeFica:0,employerFicaMatch:0,futa940:0};
  return '<div style="padding:12px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);margin-bottom:8px">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'+
      '<div style="font-size:13px;font-weight:700">'+name+'</div>'+
      '<div style="font-size:10px;font-weight:700;color:var(--text3)">'+payLbl+' · '+rateLbl+'</div>'+
    '</div>'+
    '<div style="font-size:11px;color:var(--text3);margin-bottom:6px">'+hrs(r.regMin)+'h regular'+(r.otMin>0?' + '+hrs(r.otMin)+'h OT':'')+'</div>'+
    '<div style="display:flex;justify-content:space-between;font-size:13px;font-weight:800;margin-bottom:2px"><span>Gross wages</span><span>'+fmt(r.grossWages)+'</span></div>'+
    '<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text3)"><span>Employee FICA withheld</span><span>'+fmt(liab.employeeFica)+'</span></div>'+
    '<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text3)"><span>Employer FICA match</span><span>'+fmt(liab.employerFicaMatch)+'</span></div>'+
    '<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text3)"><span>Employer FUTA</span><span>'+fmt(liab.futa940)+'</span></div>'+
    ((liab.ssWageBaseHit||liab.futaWageBaseHit)?'<div style="font-size:10px;color:var(--amber);margin-top:4px">'+svgIcon('⚠️')+' hit the '+(liab.ssWageBaseHit?'Social Security':'FUTA')+' wage base this period, verify the YTD estimate below is accurate</div>':'')+
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
  el.innerHTML=controlsHTML+'<div style="font-size:12px;color:var(--text3);padding:12px">Loading hours…</div>';
  if(_paySummaryBusy)return;
  _paySummaryBusy=true;
  let result;
  try{result=await _paySummaryBuild(_paySummaryStart,_paySummaryEnd,_paySummaryPeriodType);}
  finally{_paySummaryBusy=false;}
  _paySummaryLastResult=result;
  const t=result.totals;
  el.innerHTML=controlsHTML+
    result.rows.map(_paySummaryRowHTML).join('')+
    '<div class="card" style="margin-top:4px">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">'+
        '<div class="card-hd" style="margin-bottom:0">This period, all-in</div>'+
        '<button class="btn btn-sm" onclick="_paySummaryExportCSV()">⬇ Export</button>'+
      '</div>'+
      '<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px"><span>Gross wages (all employees)</span><span>'+fmt(t.grossWages)+'</span></div>'+
      '<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px"><span>Employer FICA match</span><span>'+fmt(t.employerFicaMatch)+'</span></div>'+
      '<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:8px"><span>Employer FUTA</span><span>'+fmt(t.futa940)+'</span></div>'+
      '<div style="display:flex;justify-content:space-between;font-size:16px;font-weight:800;padding-top:8px;border-top:1px solid var(--border)"><span>Total cash needed</span><span>'+fmt(t.cashNeeded)+'</span></div>'+
      '<div style="font-size:10px;color:var(--text3);margin-top:6px">Gross wages + your share of FICA + FUTA. Employee FICA ('+fmt(t.employeeFica)+') comes out of gross, it\'s already counted above, not extra.</div>'+
    '</div>'+
    '<div style="font-size:9px;color:var(--text3);margin-top:10px">Federal FICA + FUTA only, no income tax withholding, no state/local taxes. Not tax or legal advice. Take these numbers to your accountant before running real payroll.</div>';
}
