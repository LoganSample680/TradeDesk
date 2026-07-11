let _taxTipIdx=0;
// ── State tax rates database ──────────────────────────────────────────
const STATE_TAX={
  AL:{name:'Alabama',      low:2.0, high:5.0,  top:3000,   stdS:3000,  stdM:8500,  noTax:false},
  AK:{name:'Alaska',       low:0,   high:0,    top:0,      stdS:0,     stdM:0,     noTax:true,  note:'No state income tax'},
  AZ:{name:'Arizona',      low:2.5, high:2.5,  top:999999, stdS:14600, stdM:29200, noTax:false, note:'Flat 2.5%'},
  AR:{name:'Arkansas',     low:2.0, high:4.7,  top:89100,  stdS:2340,  stdM:4680,  noTax:false},
  CA:{name:'California',   low:1.0, high:9.3,  top:68350,  stdS:5202,  stdM:10404, noTax:false},
  CO:{name:'Colorado',     low:4.4, high:4.4,  top:999999, stdS:14600, stdM:29200, noTax:false, note:'Flat 4.4%'},
  CT:{name:'Connecticut',  low:2.0, high:6.99, top:10000,  stdS:0,     stdM:0,     noTax:false},
  DE:{name:'Delaware',     low:2.2, high:6.6,  top:60000,  stdS:3250,  stdM:6500,  noTax:false},
  FL:{name:'Florida',      low:0,   high:0,    top:0,      stdS:0,     stdM:0,     noTax:true,  note:'No state income tax'},
  GA:{name:'Georgia',      low:5.49,high:5.49, top:999999, stdS:12000, stdM:24000, noTax:false, note:'Flat 5.49%'},
  HI:{name:'Hawaii',       low:1.4, high:11.0, top:400000, stdS:2200,  stdM:4400,  noTax:false},
  ID:{name:'Idaho',        low:5.8, high:5.8,  top:999999, stdS:14600, stdM:29200, noTax:false, note:'Flat 5.8%'},
  IL:{name:'Illinois',     low:4.95,high:4.95, top:999999, stdS:2425,  stdM:4850,  noTax:false, note:'Flat 4.95%'},
  IN:{name:'Indiana',      low:3.05,high:3.05, top:999999, stdS:1000,  stdM:2000,  noTax:false, note:'Flat 3.05%'},
  IA:{name:'Iowa',         low:4.4, high:6.0,  top:75000,  stdS:14600, stdM:29200, noTax:false},
  KS:{name:'Kansas',       low:3.1, high:5.7,  top:33000,  stdS:3500,  stdM:8000,  noTax:false},
  KY:{name:'Kentucky',     low:4.0, high:4.0,  top:999999, stdS:2980,  stdM:2980,  noTax:false, note:'Flat 4.0%'},
  LA:{name:'Louisiana',    low:1.85,high:4.25, top:50000,  stdS:4500,  stdM:9000,  noTax:false},
  ME:{name:'Maine',        low:5.8, high:7.15, top:58050,  stdS:14600, stdM:29200, noTax:false},
  MD:{name:'Maryland',     low:2.0, high:5.75, top:250000, stdS:2400,  stdM:4850,  noTax:false},
  MA:{name:'Massachusetts',low:5.0, high:5.0,  top:999999, stdS:4400,  stdM:8800,  noTax:false, note:'Flat 5.0%'},
  MI:{name:'Michigan',     low:4.25,high:4.25, top:999999, stdS:5600,  stdM:11200, noTax:false, note:'Flat 4.25%'},
  MN:{name:'Minnesota',    low:5.35,high:9.85, top:183340, stdS:14575, stdM:29150, noTax:false},
  MS:{name:'Mississippi',  low:4.7, high:4.7,  top:999999, stdS:2300,  stdM:4600,  noTax:false, note:'Flat 4.7%'},
  MO:{name:'Missouri',     low:1.5, high:4.95, top:9000,   stdS:14600, stdM:29200, noTax:false},
  MT:{name:'Montana',      low:4.7, high:5.9,  top:20500,  stdS:14600, stdM:29200, noTax:false},
  NE:{name:'Nebraska',     low:2.46,high:5.84, top:36290,  stdS:7900,  stdM:15800, noTax:false},
  NV:{name:'Nevada',       low:0,   high:0,    top:0,      stdS:0,     stdM:0,     noTax:true,  note:'No state income tax'},
  NH:{name:'New Hampshire',low:0,   high:0,    top:0,      stdS:0,     stdM:0,     noTax:true,  note:'No income tax on wages'},
  NJ:{name:'New Jersey',   low:1.4, high:10.75,top:1000000,stdS:1000,  stdM:2000,  noTax:false},
  NM:{name:'New Mexico',   low:1.7, high:5.9,  top:210000, stdS:14600, stdM:29200, noTax:false},
  NY:{name:'New York',     low:4.0, high:10.9, top:25000000,stdS:8000, stdM:16050, noTax:false},
  NC:{name:'North Carolina',low:4.5,high:4.5,  top:999999, stdS:12750, stdM:25500, noTax:false, note:'Flat 4.5%'},
  ND:{name:'North Dakota', low:1.1, high:2.5,  top:440600, stdS:14600, stdM:29200, noTax:false},
  OH:{name:'Ohio',         low:2.75,high:3.5,  top:115300, stdS:2400,  stdM:4800,  noTax:false},
  OK:{name:'Oklahoma',     low:0.25,high:4.75, top:12200,  stdS:6350,  stdM:12700, noTax:false},
  OR:{name:'Oregon',       low:4.75,high:9.9,  top:250000, stdS:2420,  stdM:4840,  noTax:false},
  PA:{name:'Pennsylvania', low:3.07,high:3.07, top:999999, stdS:0,     stdM:0,     noTax:false, note:'Flat 3.07%'},
  RI:{name:'Rhode Island', low:3.75,high:5.99, top:73450,  stdS:10550, stdM:21150, noTax:false},
  SC:{name:'South Carolina',low:0,  high:6.4,  top:17150,  stdS:14600, stdM:29200, noTax:false},
  SD:{name:'South Dakota', low:0,   high:0,    top:0,      stdS:0,     stdM:0,     noTax:true,  note:'No state income tax'},
  TN:{name:'Tennessee',    low:0,   high:0,    top:0,      stdS:0,     stdM:0,     noTax:true,  note:'No state income tax'},
  TX:{name:'Texas',        low:0,   high:0,    top:0,      stdS:0,     stdM:0,     noTax:true,  note:'No state income tax'},
  UT:{name:'Utah',         low:4.65,high:4.65, top:999999, stdS:947,   stdM:1894,  noTax:false, note:'Flat 4.65%'},
  VT:{name:'Vermont',      low:3.35,high:8.75, top:213150, stdS:7000,  stdM:14050, noTax:false},
  VA:{name:'Virginia',     low:2.0, high:5.75, top:17000,  stdS:8000,  stdM:16000, noTax:false},
  WA:{name:'Washington',   low:0,   high:0,    top:0,      stdS:0,     stdM:0,     noTax:true,  note:'No state income tax'},
  WV:{name:'West Virginia',low:2.36,high:5.12, top:60000,  stdS:0,     stdM:0,     noTax:false},
  WI:{name:'Wisconsin',    low:3.5, high:7.65, top:405550, stdS:13230, stdM:24490, noTax:false},
  WY:{name:'Wyoming',      low:0,   high:0,    top:0,      stdS:0,     stdM:0,     noTax:true,  note:'No state income tax'},
};

function onStateChange(state){
  S.state=state;
  const info=STATE_TAX[state];
  if(!info)return;
  const lbl=document.getElementById('set-state-label');
  if(lbl)lbl.textContent=info.name+' tax rates';
  const infoEl=document.getElementById('set-state-info');
  if(infoEl){
    if(info.noTax||info.note){
      infoEl.style.display='block';
      infoEl.innerHTML=info.noTax
        ?svgIcon('✅')+' <strong>'+info.name+' has no state income tax.</strong> $0 state tax will be calculated.'
        :svgIcon('ℹ️')+' '+info.note;
    } else {
      infoEl.style.display='none';
    }
  }
  const sf=(id,val)=>{const el=document.getElementById(id);if(el)el.value=val;};
  sf('set-ksl',info.low);
  sf('set-ksh',info.high);
  sf('set-kst',info.top===999999?0:info.top);
  sf('set-kss',info.stdS);
  sf('set-ksm',info.stdM);
  S.ksLow=info.low;S.ksHigh=info.high;
  S.ksTop=info.top===999999?0:info.top;
  S.ksStdS=info.stdS;S.ksStdM=info.stdM;
  // Cache to stateRates and trigger Claude refresh if not already fetched
  if(!S.stateRates)S.stateRates={};
  if(!S.stateRates[state]||!S.stateRates[state].brackets){
    S.stateRates[state]={noTax:info.noTax||false,low:info.low,high:info.high,top:info.top===999999?0:info.top,stdS:info.stdS,stdM:info.stdM};
    fetchStateBrackets(state);
  }
  applySettings();saveAll();
  // No loadSettingsForm() here — the sf() calls above already updated the rate
  // inputs, and a full-form refill erases every other unsaved field the user typed.
  showToast(info.name+' tax rates loaded','🗺️');
}

function setTaxTab(tab,btn){
  document.querySelectorAll('[id^=tx-tab-]').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  document.querySelectorAll('[id^=tx-][id$=-pane]').forEach(p=>p.style.display='none');
  const pane=document.getElementById('tx-'+tab+'-pane');
  if(pane)pane.style.display='block';
  calcTax();
}
let _taxPageYear=new Date().getFullYear();
function _populateTaxYearSel(){
  const sel=document.getElementById('tax-yr-sel');if(!sel)return;
  const cur=new Date().getFullYear();
  const dataYears=new Set([cur]);
  const yr=String(cur);
  [income,expenses,mileage].forEach(arr=>arr.forEach(r=>{const y=parseInt((r.date||'').slice(0,4));if(y>=2019&&y<=cur)dataYears.add(y);}));
  const years=[...dataYears].sort((a,b)=>b-a);
  if(!dataYears.has(_taxPageYear))_taxPageYear=cur;
  sel.innerHTML=years.map(y=>'<option value="'+y+'"'+(_taxPageYear===y?' selected':'')+'>'+y+'</option>').join('');
}
function setTaxYear(yr){_taxPageYear=yr;const hd=document.getElementById('tx-data-hd');if(hd)hd.textContent=yr+' income & deductions';calcTax();}

// Social Security wage base by year — SS portion (12.4% SE / 6.2%+6.2% payroll)
// is capped at this amount, Medicare (2.9% SE / 1.45%+1.45% payroll) is not.
// 2026 confirmed via SSA's official Oct 2025 COLA announcement (ssa.gov/news/en/cola/factsheets/2026.html) —
// was previously a stale copy of the 2025 figure. Unlike the income-tax brackets below,
// this table is NOT yet wired into autoRefreshTaxBrackets()'s yearly auto-update — it's a
// static table a developer edits each year until that's added.
const _SS_WAGE_BASE={2019:132900,2020:137700,2021:142800,2022:147000,2023:160200,2024:168600,2025:176100,2026:184500};
function _getSsWageBase(yr){return _SS_WAGE_BASE[parseInt(yr)]||184500;}
function _calcSeTax(netSelf,yr){
  const seBase=netSelf*0.9235;
  const ssBase=Math.min(seBase,_getSsWageBase(yr));
  return Math.ceil(ssBase*0.124+seBase*0.029); // SS capped + Medicare uncapped
}

// Employer W-2 payroll tax LIABILITY for one employee, one pay period.
// Deliberately NOT federal/state income tax withholding — that requires the
// literal IRS Pub 15-T percentage-method bracket table, which this app has no
// verified source for (network-blocked in dev; not something to guess at for
// real payroll dollars). This is scoped to the flat-rate federal payroll
// taxes every employer owes regardless of the employee's W-4: FICA (both the
// amount withheld from the employee and the employer's own match) and FUTA.
// "Take the gross wages + this number to your accountant" is the intended
// use — not a replacement for one.
//
// ytdSsWages/ytdFutaWages = this employee's SS-taxable / FUTA-taxable wages
// already paid THIS CALENDAR YEAR, before this period — required so the caps
// (SS wage base, $7,000 FUTA base) land in the right pay period instead of
// every period independently assuming it starts the year at $0.
const _ADDL_MEDICARE_THRESHOLD=200000; // flat federal threshold — same for every filing status on the EMPLOYER withholding side (IRC §3101(b)(2)); the employee reconciles their actual status on Form 8959
const _FUTA_WAGE_BASE=7000;
function _calcPayrollLiability(grossWages,ytdSsWages,ytdFutaWages,yr){
  const gw=Math.max(0,Number(grossWages)||0);
  const priorSs=Math.max(0,Number(ytdSsWages)||0);
  const priorFuta=Math.max(0,Number(ytdFutaWages)||0);
  const ssBase=_getSsWageBase(yr);
  const ssTaxable=Math.max(0,Math.min(gw,ssBase-priorSs));
  const employeeSS=ssTaxable*0.062;
  const employerSS=ssTaxable*0.062;
  const employeeMedicare=gw*0.0145;
  const employerMedicare=gw*0.0145;
  // Additional Medicare is employee-only (no employer match) and only kicks in
  // once THIS employee's cumulative wages for the year cross the threshold —
  // the portion of this period's wages that falls above the line is taxed.
  const addlMedicareTaxable=Math.max(0,Math.min(gw,(priorSs+gw)-_ADDL_MEDICARE_THRESHOLD));
  const employeeAddlMedicare=addlMedicareTaxable*0.009;
  const futaTaxable=Math.max(0,Math.min(gw,_FUTA_WAGE_BASE-priorFuta));
  const futa=futaTaxable*0.006; // net rate assuming timely state SUTA payment (standard 5.4% credit) — see FUTA credit-reduction-state caveat below
  const r2=v=>Math.round(v*100)/100;
  const employeeFica=r2(employeeSS+employeeMedicare+employeeAddlMedicare);
  const employerFicaMatch=r2(employerSS+employerMedicare);
  return{
    grossWages:r2(gw),
    employeeSS:r2(employeeSS),employeeMedicare:r2(employeeMedicare),employeeAddlMedicare:r2(employeeAddlMedicare),
    employerSS:r2(employerSS),employerMedicare:r2(employerMedicare),
    employeeFica,employerFicaMatch,
    fica941Total:r2(employeeFica+employerFicaMatch), // FICA portion of the Form 941 deposit (income tax withholding NOT included — out of scope)
    futa940:r2(futa), // separate — Form 940, typically quarterly/annual, not bundled with the 941 deposit
    ssWageBaseHit:ssTaxable<gw, // this period's wages exceeded the remaining SS cap — worth surfacing so a mid-year cap crossing isn't silently invisible
    futaWageBaseHit:futaTaxable<gw
  };
}

// Estimate state income tax on an apportioned income amount using STATE_TAX data.
// Used for non-resident (out-of-state job) portions — no standard deduction applied
// since deduction is pro-rated to near-zero for small income fractions.
function _calcStateEstimate(stateAgi,stInfo){
  if(!stInfo||stInfo.noTax||stateAgi<=0)return 0;
  if(stInfo.low===stInfo.high||stInfo.top>=999999)
    return Math.ceil(parseFloat((stateAgi*stInfo.high/100).toFixed(2)));
  const lowPart=Math.min(stateAgi,stInfo.top);
  const highPart=Math.max(0,stateAgi-stInfo.top);
  return Math.ceil(parseFloat((lowPart*stInfo.low/100+highPart*stInfo.high/100).toFixed(2)));
}

function calcTax(){
  const _taxYr=String(_taxPageYear||new Date().getFullYear());
  // Gross income = manually-logged income entries + bid payments (both filtered to selected year)
  const tIn=income.filter(r=>r.date&&r.date.startsWith(_taxYr)).reduce((s,r)=>s+r.amount,0)
           +payments.filter(p=>p.amount!==0&&p.date&&p.date.startsWith(_taxYr)).reduce((s,p)=>s+p.amount,0);
  const _tExRaw=expenses.filter(r=>r.date&&r.date.startsWith(_taxYr)).reduce((s,r)=>s+r.amount,0);
  const tMi=mileage.filter(r=>r.date&&r.date.startsWith(_taxYr)).reduce((s,r)=>s+(r.miles||0),0);
  const _yrIrsRate=_getIrsRateForYear(_taxYr);
  // Vehicle deduction engine — enforces the IRS one-method-per-vehicle rule.
  // Mileage-method vehicles: miles deduct, their vehicle expenses don't (expAdjust).
  // Actual-method vehicles: expenses deduct at biz-use %, their miles don't.
  const _vd=(typeof _vehSchedC==='function')?_vehSchedC(_taxYr):null;
  const tEx=_tExRaw-(_vd?_vd.expAdjust:0);
  const mileDed=_vd?_vd.mileDed:tMi*_yrIrsRate;
  const netSelf=Math.max(0,tIn-tEx-mileDed);
  const spouseInc=nv('tx-spouse');
  const taxPaid=nv('tx-paid');
  const status=v('tx-status')||S.txStatus||'single';
  if(S.txStatus!==status){S.txStatus=status;S.settingsTs=Date.now();} // conditional — calc runs on every render
  const sumSel=document.getElementById('sum-tx-status');if(sumSel)sumSel.value=status;

  const seTax=_calcSeTax(netSelf,_taxYr);
  const seDed=seTax/2; // deduct half SE tax from income

  const agi=netSelf+spouseInc-seDed;
  // Use historical brackets for the selected year
  const _yrBkts=_getFedBracketsForYear(_taxYr);
  const stdDed=_getStdDedForYear(_taxYr,status);
  const fedTaxable=Math.max(0,agi-stdDed);
  const fedTax=Math.ceil(calcBrackets(fedTaxable,_yrBkts[status]||_yrBkts.single));

  // ── Multi-state revenue breakdown ────────────────────────────────────────
  // Scan payments → detect job state from bid.addr; manual income → home state
  const _homeState=S.state||'KS';
  const _stateRev={};
  payments.filter(p=>p.amount!==0&&p.date&&p.date.startsWith(_taxYr)).forEach(p=>{
    const bid=bids.find(b=>b.id===p.bid_id);
    const st=(bid&&typeof detectStateFromAddr==='function'?detectStateFromAddr(bid.addr||''):null)||_homeState;
    _stateRev[st]=(_stateRev[st]||0)+p.amount;
  });
  income.filter(r=>r.date&&r.date.startsWith(_taxYr)).forEach(r=>{_stateRev[_homeState]=(_stateRev[_homeState]||0)+r.amount;});
  const _isMultiState=tIn>0&&Object.keys(_stateRev).some(st=>st!==_homeState);
  // Calculate non-home state taxes (non-resident, apportioned by revenue fraction)
  const _nonHomeTaxes=[];
  let _totalNonHomeTax=0;
  if(_isMultiState){
    Object.entries(_stateRev).filter(([st])=>st!==_homeState).forEach(([st,rev])=>{
      const stInfo=STATE_TAX[st];
      const stateAgi=agi*(rev/tIn);
      const stTax=_calcStateEstimate(stateAgi,stInfo);
      _nonHomeTaxes.push({st,name:(stInfo?.name||st),rev,stTax,noTax:!!(stInfo?.noTax)});
      _totalNonHomeTax+=stTax;
    });
    _nonHomeTaxes.sort((a,b)=>b.rev-a.rev);
  }
  // Home state: tax on full AGI, then credit for taxes paid to other states
  // Credit = min(non-home tax paid, home tax that would have applied to same income)
  const ksTaxable=Math.max(0,agi-(KS_STD[status]||3500));
  const ksTaxGross=Math.ceil(calcBrackets(ksTaxable,KS_BRACKETS[status]||KS_BRACKETS.single));
  const _nonHomeIncome=_nonHomeTaxes.reduce((s,t)=>s+t.rev,0);
  const _nonHomeFraction=tIn>0?_nonHomeIncome/tIn:0;
  const _credit=Math.min(_totalNonHomeTax,ksTaxGross*_nonHomeFraction);
  const ksTax=Math.max(0,Math.ceil(ksTaxGross-_credit));

  const totalOwed=seTax+fedTax+ksTax+_totalNonHomeTax;
  const stillOwed=Math.max(0,totalOwed-taxPaid);
  const perQ=Math.ceil(stillOwed/4);
  // Prior-year safe harbor: pay 100% of last year's tax (110% if AGI > $150K) to avoid underpayment penalty
  const priorYrTax=nv('tx-prior-yr')||0;
  const priorYrAgi=nv('tx-prior-yr-agi')||0;
  const safeHarborRate=(priorYrAgi>0?priorYrAgi:agi)>150000?1.10:1.00;
  const safeHarborTotal=Math.ceil(priorYrTax*safeHarborRate);
  const safeHarborQ=priorYrTax>0?Math.ceil(safeHarborTotal/4):0;
  // SEP-IRA: 20% of net self-employment income (after SE deduction), max $70,000
  const sepMax=Math.min(70000,Math.floor(Math.max(0,netSelf-seDed)*0.20));

  const reserveRate=netSelf>0?Math.ceil(totalOwed/netSelf*100):32; // default 32% if no income yet
  const reserveAmt=Math.ceil(netSelf*reserveRate/100);

  // Keep year selector in sync and update dynamic header
  _populateTaxYearSel();
  const _hd=document.getElementById('tx-data-hd');if(_hd)_hd.textContent=_taxYr+' income & deductions';

  const banner=document.getElementById('tx-reserve-banner');
  if(banner){
    if(!tIn){
      banner.innerHTML='';
    } else {
      const bannerColor=reserveAmt<=taxPaid?'var(--green)':'#A32D2D';
      banner.innerHTML=
        '<div style="background:#FFF0F0;border:2px solid #A32D2D;border-radius:var(--rl);padding:14px 16px">'+
          '<div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#A32D2D;margin-bottom:4px">Tax reserve needed</div>'+
          '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">'+
            '<div style="font-size:32px;font-weight:800;color:#A32D2D">'+fmt(reserveAmt)+'</div>'+
            '<div style="font-size:13px;color:#A32D2D;font-weight:700">&nbsp;</div>'+
          '</div>'+
          '<div style="font-size:12px;color:var(--text2);line-height:1.5">'+
            'Set aside '+fmt(reserveAmt)+' from every payment — you\'ll need it at tax time.'+
          '</div>'+
          (taxPaid>0?
            '<div style="margin-top:8px;font-size:12px;font-weight:700;color:'+(taxPaid>=reserveAmt?'var(--green-mid)':'var(--amber)')+'">'+
              (taxPaid>=reserveAmt?'✓ Reserve covered':'Still need '+fmt(reserveAmt-taxPaid)+' more set aside')+
            '</div>':''
          )+
        '</div>';
    }
  }

  // ── Income by state (shown when multi-state) ─────────────────────────
  let _stateBarHtml='';
  if(_isMultiState&&tIn>0){
    _stateBarHtml='<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border)">'+
      '<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:6px">Income by State</div>'+
      Object.entries(_stateRev).sort((a,b)=>b[1]-a[1]).map(([st,rev])=>{
        const stName=STATE_TAX[st]?.name||st;
        const isHome=st===_homeState;
        return '<div class="tax-row"><span>'+escHtml(stName)+(isHome?' <span style="font-size:10px;color:var(--text3)">(home)</span>':' <span style="font-size:10px;color:var(--text3)">(non-resident)</span>')+'</span><span style="font-weight:700">'+fmt(rev)+'</span></div>';
      }).join('')+
    '</div>';
  }

  // Per-vehicle "which method wins" comparison — the year-end decision aid. Shows
  // standard-mileage vs actual side by side per vehicle and flags when the vehicle's
  // configured method is leaving money on the table.
  let _vehCmpHtml='';
  if(_vd&&_vd.hasVehicles&&_vd.perVehicle.some(p=>p.miles>0||p.expTotal>0)){
    _vehCmpHtml='<div style="margin-top:10px;padding:10px 12px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--r)">'+
      '<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:6px">'+svgIcon('🚗')+' Vehicle deduction — which method wins ('+_vd.yr+')</div>'+
      _vd.perVehicle.filter(p=>p.miles>0||p.costTotal>0).map(p=>{
        // Dual-logging nudges: a verdict is only honest when BOTH sides are logged.
        if(p.miles>0&&p.costTotal===0)return '<div style="font-size:11px;margin-bottom:5px;line-height:1.5"><span style="font-weight:700">'+escHtml(p.label)+'</span>: mileage '+fmt(p.mileDed)+' ('+p.miles.toFixed(0)+' mi) — <span style="color:var(--amber);font-weight:700">no vehicle costs logged. Log gas, parts &amp; service all year so we can prove which method wins.</span></div>';
        if(p.costTotal>0&&p.miles===0)return '<div style="font-size:11px;margin-bottom:5px;line-height:1.5"><span style="font-weight:700">'+escHtml(p.label)+'</span>: actual costs '+fmt(p.actualCmp)+' — <span style="color:var(--amber);font-weight:700">no trips logged. Track drives all year so the mileage side is real.</span></div>';
        const winLbl=p.winner==='mileage'?'Standard mileage':'Actual expenses';
        const usingWinner=p.winner===p.method;
        return '<div style="font-size:11px;margin-bottom:5px;line-height:1.5">'+
          '<span style="font-weight:700">'+escHtml(p.label)+'</span> <span style="color:var(--text3)">('+p.bizUse+'% business use)</span><br>'+
          'Mileage '+fmt(p.mileDed)+' ('+p.miles.toFixed(0)+' mi) vs Actual '+fmt(p.actualCmp)+' (all logged costs) → '+
          '<span style="font-weight:700;color:'+(usingWinner?'var(--green-mid)':'var(--amber)')+'">'+winLbl+' wins by '+fmt(p.delta)+'</span>'+
          ' · using '+(p.method==='mileage'?'mileage':'actual')+
          (usingWinner?' ✓':' — <span style="color:var(--amber);font-weight:700">switching could save '+fmt(p.delta)+'/yr (IRS switching rules apply — confirm with your tax pro)</span>')+
        '</div>';
      }).join('')+
      (_vd.untagged?'<div style="font-size:10px;color:var(--amber);margin-top:4px">'+svgIcon('⚠️')+' '+_vd.untagged+' vehicle expense'+(_vd.untagged>1?'s':'')+' ('+fmt(_vd.untaggedTotal)+') not linked to a vehicle — not deducted. Edit each expense and pick its vehicle.</div>':'')+
      '<div style="font-size:9px;color:var(--text3);margin-top:4px">One method per vehicle (IRS). Not tax advice — verify with your tax professional.</div>'+
    '</div>';
  }
  const _txInputsEl=document.getElementById('tx-inputs');
  if(_txInputsEl)_txInputsEl.innerHTML=
    '<div class="tax-row"><span style="color:var(--text2)">Gross income</span><span style="font-weight:700">'+fmt(tIn)+'</span></div>'+
    '<div class="tax-row"><span style="color:var(--text2)">Business expenses'+(_vd&&_vd.expAdjust>0?' <span style="font-size:9px;color:var(--text3)">(vehicle costs excluded per method)</span>':'')+'</span><span style="color:#A32D2D">('+fmt(tEx)+')</span></div>'+
    '<div class="tax-row"><span style="color:var(--text2)">Mileage savings <span onclick="goPg(\'pg-tracker\');setTimeout(()=>{setTrTab(\'mileage\',document.getElementById(\'tr-t-mileage\'))},150)" style="font-size:10px;color:var(--blue);cursor:pointer;font-weight:700;margin-left:4px">'+(_vd?_vd.deductedMiles:tMi).toFixed(1)+' mi →</span></span><span style="color:#A32D2D">('+fmt(mileDed)+')</span></div>'+
    (_vd&&_vd.vehExpDed>0?'<div class="tax-row"><span style="color:var(--text2)">Vehicle actual expenses <span style="font-size:10px;color:var(--text3)">(at business-use %)</span></span><span style="color:#A32D2D">included above</span></div>':'')+
    '<div class="tax-row" style="border-top:2px solid var(--border);margin-top:6px;padding-top:8px">'+
      '<span style="font-weight:700">Business income</span><span style="font-weight:700">'+fmt(netSelf)+'</span>'+
    '</div>'+
    (spouseInc?'<div class="tax-row"><span style="color:var(--text2)">Spouse / other income</span><span>'+fmt(spouseInc)+'</span></div>':'')+
    '<div class="tax-row"><span style="color:var(--text2)">Taxable income</span><span>'+fmt(agi)+'</span></div>'+
    _stateBarHtml+
    _vehCmpHtml;

  // ── State tax rows — single state keeps old display, multi-state shows breakdown
  const _homeStateName=STATE_TAX[_homeState]?.name||_homeState||'State';
  let _stateRows='';
  if(_isMultiState&&_nonHomeTaxes.length){
    _stateRows=
      '<div class="tax-row"><span>'+escHtml(_homeStateName)+' income tax'+(_credit>0?' <span style="font-size:10px;color:var(--text3)">(after credit)</span>':'')+'</span><span style="color:#A32D2D">'+fmt(ksTax)+'</span></div>'+
      _nonHomeTaxes.map(t=>'<div class="tax-row"><span style="padding-left:14px;color:var(--text2)">'+escHtml(t.name)+(t.noTax?'':' non-resident income tax')+'</span><span style="color:#A32D2D">'+(t.noTax?'No income tax':fmt(t.stTax))+'</span></div>').join('')+
      '<div style="font-size:10px;color:var(--text3);margin:4px 0 2px;font-style:italic">'+svgIcon('⚠')+' Multi-state estimate — review total with your CPA</div>';
  } else {
    _stateRows='<div class="tax-row"><span>'+escHtml(_homeStateName)+' income tax</span><span style="color:#A32D2D">'+fmt(ksTax)+'</span></div>';
  }

  const _txResultsEl=document.getElementById('tx-results');
  if(_txResultsEl)_txResultsEl.innerHTML=
    '<div class="tax-row"><span>Self-employment tax (15.3%)</span><span style="color:#A32D2D">'+fmt(seTax)+'</span></div>'+
    '<div class="tax-row"><span>Federal income tax</span><span style="color:#A32D2D">'+fmt(fedTax)+'</span></div>'+
    _stateRows+
    '<div class="tax-row" style="border-top:2px solid var(--border);margin-top:6px;padding-top:8px;font-size:15px;font-weight:700">'+
      '<span>Total estimated</span><span style="color:#A32D2D">'+fmt(totalOwed)+'</span>'+
    '</div>'+
    (taxPaid?'<div class="tax-row"><span style="color:var(--text2)">Already paid</span><span style="color:var(--green-mid)">('+fmt(taxPaid)+')</span></div>':'')+
    '<div class="tax-row" style="font-weight:700"><span>Still owed</span><span style="color:#A32D2D">'+fmt(stillOwed)+'</span></div>'+
    '';

  const now=new Date();
  const yr=now.getFullYear();
  const qdates=[
    {q:'Q1',due:'Apr 15',date:new Date(yr,3,15),period:'Jan–Mar'},
    {q:'Q2',due:'Jun 16',date:new Date(yr,5,16),period:'Apr–May'},
    {q:'Q3',due:'Sep 15',date:new Date(yr,8,15),period:'Jun–Aug'},
    {q:'Q4',due:'Jan 15',date:new Date(yr+1,0,15),period:'Sep–Dec'},
  ];
  const safeHarborNote=safeHarborQ>0
    ? '<div style="background:#F0FDF4;border:1.5px solid #16A34A;border-radius:var(--r);padding:10px 12px;margin-bottom:12px">'+
        '<div style="font-size:12px;font-weight:700;color:#166534;margin-bottom:3px">✓ Penalty-free plan</div>'+
        '<div style="font-size:11px;color:#166534;line-height:1.5">Pay <strong>'+fmt(safeHarborQ)+'</strong> each quarter and you\'re covered — no IRS underpayment penalty.</div>'+
      '</div>'
    : '<div style="background:#FEF3C7;border:1px solid #D97706;border-radius:var(--r);padding:8px 10px;margin-bottom:12px;font-size:11px;color:#92400E">'+
        svgIcon('💡')+' Enter last year\'s total tax above for the simplest quarterly number.'+
      '</div>';
  const _txQuartersEl=document.getElementById('tx-quarters');
  if(_txQuartersEl)_txQuartersEl.innerHTML=
    safeHarborNote+
    '<div style="font-size:11px;color:var(--text2);margin-bottom:10px">Pay '+fmt(perQ)+' each quarter.</div>'+
    qdates.map(({q,due,date,period})=>{
      const isPast=date<now;
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">'+
        '<div>'+
          '<div style="font-size:13px;font-weight:700">'+q+' <span style="font-weight:400;color:var(--text3)">'+period+'</span></div>'+
          '<div style="font-size:11px;color:'+(isPast?'var(--text3)':'var(--text2)')+'">Due '+due+(isPast?' · past due':'')+'</div>'+
        '</div>'+
        '<div style="text-align:right">'+
          '<div style="font-size:15px;font-weight:700;color:'+(isPast?'var(--text3)':'#A32D2D')+'">'+fmt(perQ)+'</div>'+
          (safeHarborQ>0?'<div style="font-size:10px;color:#166534;font-weight:600">'+fmt(safeHarborQ)+' penalty-free</div>':'')+
        '</div>'+
      '</div>';
    }).join('');

  // ── DIF Audit Risk Score ───────────────────────────────────────────────
  const difPct=tIn>0?tEx/tIn:0;
  const difRisk=difPct>0.63?'high':difPct>0.52?'medium':'low';
  const difResultsEl=document.getElementById('tx-results');
  if(difResultsEl&&tIn>0){
    const difColors={high:['#7f1d1d','#FEF2F2','#A32D2D'],medium:['#78350f','#FFFBEB','#D97706'],low:['#14532d','#F0FDF4','#16A34A']};
    const [tc,bg,border]=difColors[difRisk];
    const difHTML='<div style="background:'+bg+';border:1.5px solid '+border+';border-radius:var(--r);padding:10px 12px;margin-top:12px">'+
      '<div style="font-size:11px;font-weight:800;text-transform:uppercase;color:'+tc+';margin-bottom:3px">Audit Risk Indicator — '+Math.round(difPct*100)+'% expense ratio</div>'+
      '<div style="font-size:11px;color:'+tc+';line-height:1.5">'+
        (difRisk==='high'?svgIcon('⚠️')+' Your expense ratio is on the high end compared to similar contractors. Keep detailed receipts and records.':
         difRisk==='medium'?svgIcon('⚡')+' Moderate: '+Math.round(difPct*100)+'% of revenue in deductions. Keep all receipts — you\'re in the range the IRS notices.':
         '✓ Low risk: '+Math.round(difPct*100)+'% expense ratio looks normal for your industry.')+
      '</div></div>';
    difResultsEl.innerHTML+=difHTML;
  }

  // ── IRS Tips Panel ─────────────────────────────────────────────────────
  const tipEl=document.getElementById('tx-tips');
  if(tipEl){
    const mo=now.getMonth();
    const activeTrade=getActiveTrade();
    const NAICS_MAP={painting:{code:'238320',label:'Painting & Wall Covering'},electrical:{code:'238210',label:'Electrical Contractors'},plumbing:{code:'238220',label:'Plumbing, Heating, A/C'},hvac:{code:'238220',label:'Plumbing, Heating, A/C'},roofing:{code:'238160',label:'Roofing Contractors'},flooring:{code:'238330',label:'Flooring Contractors'},general:{code:'238990',label:'Specialty Trade Contractors'}};
    const naics=NAICS_MAP[activeTrade]||NAICS_MAP.general;
    const tips=[];

    // SEP-IRA — show actual dollar amount based on their income
    if(sepMax>0)tips.push({icon:svgIcon('🏦'),color:'#0369a1',bg:'#f0f9ff',title:'Retirement Account — Stash '+fmt(sepMax)+' and Reduce Your Tax Bill',body:'You can set aside $'+sepMax.toLocaleString()+' for retirement and reduce your tax bill — ask your CPA about a SEP-IRA. You have until Oct 15 (with extension) to fund it. At your income level that\'s roughly '+fmt(Math.round(sepMax*0.25))+' back in your pocket right now. Open one at Fidelity or Vanguard in 15 minutes — they walk you through it.'});

    // Kansas commercial labor tax — critical for KS contractors
    if(S.state==='KS')tips.push({icon:svgIcon('🏗️'),color:'#92400e',bg:'#fffbeb',title:'Kansas Commercial Jobs: Labor Is Taxable',body:'Kansas commercial jobs: you must collect sales tax on labor, not just materials. Get this wrong and it comes out of your pocket.'});

    // Home office commuting unlock
    if(!S.homeOffice)tips.push({icon:svgIcon('🏠'),color:'#0369a1',bg:'#f0f9ff',title:'Home Office = Every Drive to a Job Site Becomes Deductible',body:'Right now, your drive from home to your first job site each day is "commuting" — not deductible. But if you have a room at home used ONLY for business (scheduling, estimates, billing), that changes everything. Your home becomes your business location and every drive to a job site is a deductible business trip. Check the home office box in Settings if this applies to you.'});
    if(S.homeOffice)tips.push({icon:svgIcon('🏠'),color:'#166534',bg:'#f0fdf4',title:'Home Office Active — Your Drives to Job Sites Are Deductible',body:'Because you have a qualifying home office, the IRS treats your home as your business location. Every drive from home to a job site counts as business mileage — not commuting. Make sure every trip is logged in TradeDesk. This is also the biggest thing to document if you\'re ever audited: photograph the dedicated office space and keep records of what business work you do there.'});

    // Health insurance line placement
    tips.push({icon:svgIcon('💊'),color:'#1d4ed8',bg:'#eff6ff',title:'Health Insurance Deduction — Location Matters',body:'Health insurance premiums are deductible — put them in the right place or you\'ll pay more in self-employment tax than you need to. Ask your CPA.'});

    // NAICS code
    tips.push({icon:svgIcon('📋'),color:'#374151',bg:'#f9fafb',title:'Your Trade Code: '+naics.code,body:'Your trade code tells the IRS what kind of contractor you are. We set this automatically — it affects how your numbers look compared to similar businesses.'});

    // Commingling
    tips.push({icon:svgIcon('🏦'),color:'#7c3aed',bg:'#f5f3ff',title:'Keep Business Money in a Separate Account',body:'Keep business money in a separate account. Mixed personal and business deposits are an audit headache you don\'t want.'});

    // De minimis election
    tips.push({icon:svgIcon('🧾'),color:'#166534',bg:'#f0fdf4',title:'Write Off Tools & Equipment This Year',body:'Tools and equipment under $2,500 might be fully deductible this year instead of written off over time — ask your CPA about expensing them upfront.'});

    // December constructive receipt
    if(mo>=10)tips.push({icon:svgIcon('📅'),color:'#92400e',bg:'#fffbeb',title:'December: Income Counts When You Earn It',body:'Income counts when you earn it, not always when you collect it. If a check arrives in January for December work, it may still count as last year\'s income.'});

    // Depreciation recapture
    tips.push({icon:svgIcon('🔄'),color:'#92400e',bg:'#fffbeb',title:'Selling Old Equipment? You May Owe Tax',body:'Selling equipment you\'ve already written off? You may owe tax on the sale — check with your CPA before you sell.'});

    // Minor child FICA
    tips.push({icon:svgIcon('👶'),color:'#7c3aed',bg:'#f5f3ff',title:'Paying Your Kids Can Lower Your Tax Bill',body:'If your kids help with the business, paying them a fair wage can reduce your tax bill. Ask your CPA — the rules depend on your business structure.'});

    // Tool trailer
    tips.push({icon:svgIcon('🚛'),color:'#0369a1',bg:'#f0f9ff',title:'Tool Trailers: Ask About the Write-Off',body:'Tool trailers may depreciate differently than vehicles. If you bought a trailer this year, ask your CPA — it could mean a bigger write-off.'});

    // Record retention
    tips.push({icon:svgIcon('📁'),color:'#374151',bg:'#f9fafb',title:'How Long to Keep Records (The 7-Year Rule)',body:'General rule: 7 years for all tax records. But equipment purchase records need to be kept until 7 years AFTER you sell the equipment — so that 2019 truck purchase receipt needs to stay until 2032 if you sell it in 2025. Equipment you still own: keep those records permanently while you own it. IRS has 6 years (not 3) if you underreported income by more than 25%. Photograph everything and store in Google Drive or Dropbox.'});

    // OBBBA 2025 update
    tips.push({icon:svgIcon('⚡'),color:'#0369a1',bg:'#f0f9ff',title:'2025 Law Change: 100% Bonus Depreciation Is Back',body:'The One Big Beautiful Bill Act (signed July 2025) permanently restored 100% bonus depreciation. Any qualifying equipment, tools, vehicles, or machinery placed in service after January 19, 2025 can be fully written off in year one. This was phasing down (60% in 2024, 40% early 2025) — now it\'s back to 100% permanently. Also: 1099-NEC threshold rises to $2,000 starting with the 2026 tax year. For 2025, the $600 threshold still applies.'});

    _taxTipIdx=_taxTipIdx%tips.length;
    const _t=tips[_taxTipIdx];
    const _tNext=tips[(_taxTipIdx+1)%tips.length];
    window._nextTaxTip=()=>{_taxTipIdx=(_taxTipIdx+1)%tips.length;calcTax();};
    tipEl.innerHTML='<div class="card">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--border)">'+
        '<div style="font-size:14px;font-weight:800">'+svgIcon('💡')+' Tax Tips</div>'+
        '<div style="font-size:11px;color:var(--text3)">'+(_taxTipIdx+1)+' of '+tips.length+'</div>'+
      '</div>'+
      '<div style="background:'+_t.bg+';border:1.5px solid '+_t.color+';border-radius:var(--r);padding:10px 12px">'+
        '<div style="font-size:12px;font-weight:700;color:'+_t.color+';margin-bottom:3px">'+_t.icon+' '+_t.title+'</div>'+
        '<div style="font-size:11px;color:var(--text2);line-height:1.6">'+_t.body+'</div>'+
      '</div>'+
      '<button onclick="_nextTaxTip()" style="width:100%;margin-top:10px;padding:9px 12px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;color:var(--text2);text-align:left;display:flex;align-items:center;gap:6px">'+
        '<span style="color:var(--text3)">Next:</span> '+_tNext.icon+' '+escHtml(_tNext.title)+
        '<span style="margin-left:auto;color:var(--text3)">›</span>'+
      '</button>'+
    '</div>';
  }
}

const _VALID_TAX_STATUSES=new Set(['single','mfj','mfs','hoh','qss']);
function estimateTax(netSelf,yr){
  if(!(netSelf>0))return 0;
  const _rawStatus=S.txStatus||'single';
  const status=_VALID_TAX_STATUSES.has(_rawStatus)?_rawStatus:'single';
  const seTax=_calcSeTax(netSelf,yr||new Date().getFullYear());
  const seDed=seTax/2;
  const bkts=yr?_getFedBracketsForYear(yr):FED_BRACKETS;
  const stdDed=yr?_getStdDedForYear(yr,status):(STD_DED[status]||14600);
  const agi=netSelf-seDed;
  const fedTaxable=Math.max(0,agi-stdDed);
  const fedTax=Math.ceil(calcBrackets(fedTaxable,bkts[status]||bkts.single));
  const ksTaxable=Math.max(0,agi-(KS_STD[status]||3500));
  const ksTax=Math.ceil(calcBrackets(ksTaxable,KS_BRACKETS[status]||KS_BRACKETS.single));
  return seTax+fedTax+ksTax;
}

let _bracketRefreshInProgress=false;
Object.defineProperty(window,'_bracketRefreshInProgress',{get:()=>_bracketRefreshInProgress,set:v=>{_bracketRefreshInProgress=v;},configurable:true});
async function autoRefreshTaxBrackets(){
  if(!_supa||!_supaUser||_bracketRefreshInProgress)return;
  const thisYear=new Date().getFullYear();
  // S.bracketYear syncs to Supabase — once ANY device fetches for this year, all devices skip it
  if(S.bracketYear===thisYear)return;
  _bracketRefreshInProgress=true;
  try{
    const{data:{session}}=await _supa.auth.getSession();
    if(!session)return;
    const resp=await fetch(SUPA_URL+'/functions/v1/get-rates',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token},
      body:JSON.stringify({type:'taxBrackets'})
    });
    if(!resp.ok)return;
    const d=await resp.json();
    if(d.error)return;
    // Strict bounds — each threshold must be within ±15% of 2025 IRS baseline
    const base={fedSingle:15000,b10:11925,b12:48475,b22:103350,b24:197300,b32:250525,b35:626350};
    const fields=Object.keys(base);
    const valid=fields.every(k=>typeof d[k]==='number'&&d[k]>base[k]*0.85&&d[k]<base[k]*1.15);
    const inc=[d.b10,d.b12,d.b22,d.b24,d.b32,d.b35].every((v,i,a)=>i===0||v>a[i-1]);
    if(!valid||!inc)return;
    const changed=fields.some(k=>Math.abs(d[k]-(S[k]||base[k]))>50);
    if(changed){
      fields.forEach(k=>{if(d[k])S[k]=d[k];});
      if(d.fedMFJ&&d.fedMFJ>25000&&d.fedMFJ<40000)S.fedMFJ=d.fedMFJ;
      if(d.fedHOH&&d.fedHOH>18000&&d.fedHOH<30000)S.fedHOH=d.fedHOH;
      applySettings();saveAll();
      showToast('Federal tax brackets updated for '+(d.year||thisYear),'📊');
    }
    // Update KS rates if returned (loose bounds — KS rates vary more)
    if(typeof d.ksLow==='number'&&d.ksLow>0&&d.ksLow<15)S.ksLow=d.ksLow;
    if(typeof d.ksHigh==='number'&&d.ksHigh>0&&d.ksHigh<15)S.ksHigh=d.ksHigh;
    if(typeof d.ksTop==='number'&&d.ksTop>5000&&d.ksTop<100000)S.ksTop=d.ksTop;
    if(typeof d.ksStdS==='number'&&d.ksStdS>1000&&d.ksStdS<15000)S.ksStdS=d.ksStdS;
    if(typeof d.ksStdM==='number'&&d.ksStdM>1000&&d.ksStdM<20000)S.ksStdM=d.ksStdM;
    S.bracketYear=thisYear;saveAll();
    _refillSettingsFormUnlessEditing(); // refresh display spans — but never clobber in-progress edits
    if(S.state)fetchStateBrackets(S.state);
  }catch(e){}finally{_bracketRefreshInProgress=false;}
}

async function fetchStateBrackets(state){
  if(!_supa||!_supaUser||!state)return;
  const thisYear=new Date().getFullYear();
  if(S.stateRates?.[state]?.year===thisYear)return;
  try{
    const{data:{session}}=await _supa.auth.getSession();
    if(!session)return;
    const resp=await fetch(SUPA_URL+'/functions/v1/get-rates',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token},
      body:JSON.stringify({type:'stateBrackets',state})
    });
    if(!resp.ok)return;
    const d=await resp.json();
    if(d.error||d.state!==state)return;
    if(!S.stateRates)S.stateRates={};
    const prev=S.stateRates[state];
    const changed=!prev||JSON.stringify(prev.brackets)!==JSON.stringify(d.brackets)||prev.stdS!==d.stdS;
    d.year=thisYear;
    S.stateRates[state]=d;
    applySettings();saveAll();
    _refillSettingsFormUnlessEditing();
    if(changed)showToast((d.noTax?state+' has no income tax':state+' tax rates updated'),'📊');
  }catch(e){}
}
