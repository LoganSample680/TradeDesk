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
        ?'✅ <strong>'+info.name+' has no state income tax.</strong> $0 state tax will be calculated.'
        :'ℹ️ '+info.note;
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
  loadSettingsForm();
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
  const tEx=expenses.filter(r=>r.date&&r.date.startsWith(_taxYr)).reduce((s,r)=>s+r.amount,0);
  const tMi=mileage.filter(r=>r.date&&r.date.startsWith(_taxYr)).reduce((s,r)=>s+(r.miles||0),0);
  const _yrIrsRate=_getIrsRateForYear(_taxYr);
  const mileDed=tMi*_yrIrsRate;
  const netSelf=Math.max(0,tIn-tEx-mileDed);
  const spouseInc=nv('tx-spouse');
  const taxPaid=nv('tx-paid');
  const status=v('tx-status')||S.txStatus||'single';
  S.txStatus=status;
  const sumSel=document.getElementById('sum-tx-status');if(sumSel)sumSel.value=status;

  const seBase=netSelf*.9235;
  const seTax=Math.ceil(seBase*.153); // round UP — never short
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
  const safeHarborRate=agi>150000?1.10:1.00;
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
            '<div style="font-size:13px;color:#A32D2D;font-weight:700">'+reserveRate+'% of net</div>'+
          '</div>'+
          '<div style="font-size:12px;color:var(--text2);line-height:1.5">'+
            'Set this aside from every payment. Based on your actual income, expenses, and '+(STATE_TAX[S.state]?.name||S.state||'your state')+' tax rates. '+
            'Rounds up — better to have extra at filing than scramble for it.'+
          '</div>'+
          (taxPaid>0?
            '<div style="margin-top:8px;font-size:12px;font-weight:700;color:'+(taxPaid>=reserveAmt?'var(--green-mid)':'var(--amber)')+'">'+
              (taxPaid>=reserveAmt?'✓ Reserve covered':'Still need '+fmt(reserveAmt-taxPaid)+' more set aside')+
            '</div>':''
          )+
        '</div>';
    }
  }

  // ── Income by state bar chart (shown when multi-state) ───────────────────
  let _stateBarHtml='';
  if(_isMultiState&&tIn>0){
    const _maxRev=Math.max(...Object.values(_stateRev));
    _stateBarHtml='<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border)">'+
      '<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:10px">Income by State</div>';
    Object.entries(_stateRev).sort((a,b)=>b[1]-a[1]).forEach(([st,rev])=>{
      const pct=Math.round(rev/tIn*100);
      const barW=Math.round(rev/_maxRev*100);
      const stName=(STATE_TAX[st]?.name||st);
      const isHome=st===_homeState;
      _stateBarHtml+='<div style="margin-bottom:10px">'+
        '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:3px">'+
          '<div style="font-size:12px;font-weight:700">'+escHtml(stName)+'<span style="font-size:10px;font-weight:500;color:var(--text3);margin-left:4px">'+(isHome?'(home)':'(non-resident)')+'</span></div>'+
          '<div style="font-size:12px;font-weight:700">'+fmt(rev)+'&nbsp;<span style="color:var(--text3);font-size:11px">'+pct+'%</span></div>'+
        '</div>'+
        '<div style="height:6px;background:var(--bg3,#e8eef7);border-radius:3px;overflow:hidden">'+
          '<div style="height:100%;width:'+barW+'%;background:'+(isHome?'var(--blue)':'#5B7FA6')+';border-radius:3px;transition:width .3s"></div>'+
        '</div>'+
      '</div>';
    });
    _stateBarHtml+='</div>';
  }

  document.getElementById('tx-inputs').innerHTML=
    '<div class="tax-row"><span style="color:var(--text2)">Gross income</span><span style="font-weight:700">'+fmt(tIn)+'</span></div>'+
    '<div class="tax-row"><span style="color:var(--text2)">Business expenses</span><span style="color:#A32D2D">('+fmt(tEx)+')</span></div>'+
    '<div class="tax-row"><span style="color:var(--text2)">Mileage deduction <span onclick="goPg(\'pg-tracker\');setTimeout(()=>{setTrTab(\'mileage\',document.getElementById(\'tr-t-mileage\'))},150)" style="font-size:10px;color:var(--blue);cursor:pointer;font-weight:700;margin-left:4px">'+tMi.toFixed(1)+' mi →</span></span><span style="color:#A32D2D">('+fmt(mileDed)+')</span></div>'+
    '<div class="tax-row" style="border-top:2px solid var(--border);margin-top:6px;padding-top:8px">'+
      '<span style="font-weight:700">Net SE income</span><span style="font-weight:700">'+fmt(netSelf)+'</span>'+
    '</div>'+
    (spouseInc?'<div class="tax-row"><span style="color:var(--text2)">Spouse / other income</span><span>'+fmt(spouseInc)+'</span></div>':'')+
    '<div class="tax-row"><span style="color:var(--text2)">Effective AGI</span><span>'+fmt(agi)+'</span></div>'+
    _stateBarHtml;

  // ── State tax rows — single state keeps old display, multi-state shows breakdown
  const _homeStateName=STATE_TAX[_homeState]?.name||_homeState||'State';
  let _stateRows='';
  if(_isMultiState&&_nonHomeTaxes.length){
    _stateRows=
      '<div class="tax-row"><span>'+escHtml(_homeStateName)+' income tax'+(_credit>0?' <span style="font-size:10px;color:var(--text3)">(after credit)</span>':'')+'</span><span style="color:#A32D2D">'+fmt(ksTax)+'</span></div>'+
      _nonHomeTaxes.map(t=>'<div class="tax-row"><span style="padding-left:14px;color:var(--text2)">'+escHtml(t.name)+(t.noTax?'':' non-resident')+'</span><span style="color:#A32D2D">'+(t.noTax?'No income tax':fmt(t.stTax))+'</span></div>').join('')+
      '<div style="font-size:10px;color:var(--text3);margin:4px 0 2px;font-style:italic">⚠ Multi-state estimate — verify with your CPA. Credit applied for taxes paid to other states.</div>';
  } else {
    _stateRows='<div class="tax-row"><span>'+escHtml(_homeStateName)+' income tax</span><span style="color:#A32D2D">'+fmt(ksTax)+'</span></div>';
  }

  document.getElementById('tx-results').innerHTML=
    '<div class="tax-row"><span>Self-employment tax (15.3%)</span><span style="color:#A32D2D">'+fmt(seTax)+'</span></div>'+
    '<div class="tax-row"><span>Federal income tax</span><span style="color:#A32D2D">'+fmt(fedTax)+'</span></div>'+
    _stateRows+
    '<div class="tax-row" style="border-top:2px solid var(--border);margin-top:6px;padding-top:8px;font-size:15px;font-weight:700">'+
      '<span>Total estimated</span><span style="color:#A32D2D">'+fmt(totalOwed)+'</span>'+
    '</div>'+
    (taxPaid?'<div class="tax-row"><span style="color:var(--text2)">Already paid</span><span style="color:var(--green-mid)">('+fmt(taxPaid)+')</span></div>':'')+
    '<div class="tax-row" style="font-weight:700"><span>Still owed</span><span style="color:#A32D2D">'+fmt(stillOwed)+'</span></div>'+
    '<div style="font-size:11px;color:var(--text3);margin-top:8px">All figures rounded up. SE tax deducted from income before federal/state calculation.</div>';

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
        '<div style="font-size:12px;font-weight:700;color:#166534;margin-bottom:3px">✓ Safe Harbor Shortcut — No Penalty Guaranteed</div>'+
        '<div style="font-size:11px;color:#166534;line-height:1.5">Pay <strong>'+fmt(safeHarborQ)+'</strong>/quarter ('+fmt(safeHarborTotal)+'/yr total) and the IRS <em>cannot</em> charge you an underpayment penalty — even if you owe more at filing. That\'s '+Math.round(safeHarborRate*100)+'% of last year\'s '+fmt(priorYrTax)+' tax bill.'+(agi>150000?' High-income rate (110%) applies because your income is over $150K.':'')+'</div>'+
      '</div>'
    : '<div style="background:#FEF3C7;border:1px solid #D97706;border-radius:var(--r);padding:8px 10px;margin-bottom:12px;font-size:11px;color:#92400E">'+
        '💡 Enter your prior year tax above to unlock the Safe Harbor shortcut — the legal way to pay less each quarter and never get penalized.'+
      '</div>';
  document.getElementById('tx-quarters').innerHTML=
    safeHarborNote+
    '<div style="font-size:11px;color:var(--text2);margin-bottom:10px">Based on this year\'s numbers — pay '+fmt(perQ)+' each quarter to cover what you owe now.</div>'+
    qdates.map(({q,due,date,period})=>{
      const isPast=date<now;
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">'+
        '<div>'+
          '<div style="font-size:13px;font-weight:700">'+q+' <span style="font-weight:400;color:var(--text3)">'+period+'</span></div>'+
          '<div style="font-size:11px;color:'+(isPast?'var(--text3)':'var(--text2)')+'">Due '+due+(isPast?' · past due':'')+'</div>'+
        '</div>'+
        '<div style="text-align:right">'+
          '<div style="font-size:15px;font-weight:700;color:'+(isPast?'var(--text3)':'#A32D2D')+'">'+fmt(perQ)+'</div>'+
          (safeHarborQ>0?'<div style="font-size:10px;color:#166534;font-weight:600">'+fmt(safeHarborQ)+' safe harbor</div>':'')+
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
        (difRisk==='high'?'⚠️ Your deductions are '+Math.round(difPct*100)+'% of gross revenue — above the 63% threshold where the IRS DIF computer flags returns for review. Your deductions may be completely legitimate, but you need airtight receipts for every single one.':
         difRisk==='medium'?'⚡ Moderate: '+Math.round(difPct*100)+'% of revenue in deductions. Keep all receipts — you\'re in the range the IRS notices.':
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
    if(sepMax>0)tips.push({icon:'🏦',color:'#0369a1',bg:'#f0f9ff',title:'Retirement Account — You Can Stash '+fmt(sepMax)+' Tax-Free',body:'Based on your net income, you can put up to '+fmt(sepMax)+' into a SEP-IRA this year and deduct every dollar from your taxes. You have until Oct 15 (with extension) to fund it. At your income level that\'s roughly '+fmt(Math.round(sepMax*0.25))+' back in your pocket right now. Open one at Fidelity or Vanguard in 15 minutes — they walk you through it.'});

    // Kansas commercial labor tax — critical for KS contractors
    if(S.state==='KS')tips.push({icon:'🏗️',color:'#92400e',bg:'#fffbeb',title:'Kansas Trap: Labor on Commercial Jobs IS Taxable',body:'In Kansas, if you\'re doing work on an existing commercial building (repainting a restaurant, replumbing an office, rewiring a hotel), you must collect Kansas sales tax on your LABOR — not just materials. Residential and new construction are exempt. Get this wrong and you owe the tax out of your own pocket. A $15,000 commercial paint job at 9% = $1,350 you\'d owe the state. Register at ksrevenue.gov and collect it going forward.'});

    // Home office commuting unlock
    if(!S.homeOffice)tips.push({icon:'🏠',color:'#0369a1',bg:'#f0f9ff',title:'Home Office = Every Drive to a Job Site Becomes Deductible',body:'Right now, your drive from home to your first job site each day is "commuting" — not deductible. But if you have a room at home used ONLY for business (scheduling, estimates, billing), that changes everything. Your home becomes your business location and every drive to a job site is a deductible business trip. Check the home office box in Settings if this applies to you.'});
    if(S.homeOffice)tips.push({icon:'🏠',color:'#166534',bg:'#f0fdf4',title:'Home Office Active — Your Drives to Job Sites Are Deductible',body:'Because you have a qualifying home office, the IRS treats your home as your business location. Every drive from home to a job site counts as business mileage — not commuting. Make sure every trip is logged in TradeDesk. This is also the biggest thing to document if you\'re ever audited: photograph the dedicated office space and keep records of what business work you do there.'});

    // Health insurance line placement
    tips.push({icon:'💊',color:'#1d4ed8',bg:'#eff6ff',title:'Health Insurance: Schedule 1, NOT Schedule C',body:'Deduct health insurance premiums on Schedule 1 Line 17 — not on Schedule C. On Schedule C they reduce income tax but NOT self-employment tax. On Schedule 1 they reduce both. At $18K/yr in family premiums the wrong line costs ~$2,754 in extra SE tax every year. One of the most common CPA errors for self-employed contractors.'});

    // NAICS code
    tips.push({icon:'📋',color:'#374151',bg:'#f9fafb',title:'Use NAICS Code '+naics.code+' on Schedule C',body:'Line B of Schedule C asks for your business code. Use '+naics.code+' ('+naics.label+'). The IRS computer compares your expense ratios against other contractors in your specific trade — use the right code or your numbers look abnormal by comparison, raising your audit score for no reason.'});

    // Commingling
    tips.push({icon:'🏦',color:'#7c3aed',bg:'#f5f3ff',title:'Separate Bank Account — Not Optional if You Want to Survive an Audit',body:'If you mix business and personal money in one account, an auditor adds up EVERY deposit and calls it all income unless you prove otherwise. That insurance check from your car accident? Income. That personal loan from your brother? Income. It\'s the fastest way to turn a simple audit into a nightmare. Open a free business checking account and run all business money through it — nothing else.'});

    // De minimis election
    tips.push({icon:'🧾',color:'#166534',bg:'#f0fdf4',title:'De Minimis Election — Must File Every Year',body:'You can immediately expense any single item under $2,500 (tools, equipment, supplies) instead of depreciating it over 5 years. But the election is NOT automatic — your CPA must attach a statement to your return every single year. One missed year means those tools get depreciated instead of expensed. Remind your CPA every filing season.'});

    // December constructive receipt
    if(mo>=10)tips.push({icon:'📅',color:'#92400e',bg:'#fffbeb',title:'December Alert: Money You Can Collect Now Is Taxable Now',body:'Even if a customer\'s check doesn\'t arrive until January, if you could have collected it in December, the IRS says it\'s December income. Do NOT ask clients to hold off on payment to push it into next year — that\'s called constructive receipt and it\'s an audit trigger. If you genuinely haven\'t earned the money yet, that\'s fine. But if the job is done and the invoice is due, that income belongs in this year.'});

    // Depreciation recapture
    tips.push({icon:'🔄',color:'#92400e',bg:'#fffbeb',title:'Selling Equipment You Wrote Off? Expect a Tax Bill',body:'If you used Section 179 or bonus depreciation to write off a truck or sprayer in full, your tax "book value" is now zero. Sell it for $20,000 and you owe tax on the full $20,000 as ordinary income — even though you "sold it at a loss" compared to what you paid. This is called depreciation recapture (§1245) and it catches contractors completely off guard. Run the numbers with your CPA before selling equipment you fully depreciated.'});

    // Minor child FICA
    tips.push({icon:'👶',color:'#7c3aed',bg:'#f5f3ff',title:'Kids on Payroll — Zero FICA if You\'re a Sole Prop',body:'Sole proprietors who employ their child under 18 pay zero Social Security and Medicare tax on those wages — that\'s 15.3% you\'re not paying. The child pays income tax at their own lower rate. You deduct the wages. They can contribute to a Roth IRA. Real work, reasonable pay, and timesheets required. Don\'t convert to S-corp before you\'ve modeled this — S-corps lose the FICA exemption for minor children.'});

    // Tool trailer
    tips.push({icon:'🚛',color:'#0369a1',bg:'#f0f9ff',title:'Tool Trailers Are NOT Subject to Vehicle Depreciation Limits',body:'A lot of CPAs file tool trailers under "vehicles" and apply the luxury auto caps, which limits your first-year deduction to $12,200. Trailers have no motor — they\'re not listed property under §280F. A $15K enclosed tool trailer is fully depreciable under Section 179 in year one. That\'s a $3,750 difference in your pocket.'});

    // Record retention
    tips.push({icon:'📁',color:'#374151',bg:'#f9fafb',title:'How Long to Keep Records (The 7-Year Rule)',body:'General rule: 7 years for all tax records. But equipment purchase records need to be kept until 7 years AFTER you sell the equipment — so that 2019 truck purchase receipt needs to stay until 2032 if you sell it in 2025. Equipment you still own: keep those records permanently while you own it. IRS has 6 years (not 3) if you underreported income by more than 25%. Photograph everything and store in Google Drive or Dropbox.'});

    // OBBBA 2025 update
    tips.push({icon:'⚡',color:'#0369a1',bg:'#f0f9ff',title:'2025 Law Change: 100% Bonus Depreciation Is Back',body:'The One Big Beautiful Bill Act (signed July 2025) permanently restored 100% bonus depreciation. Any qualifying equipment, tools, vehicles, or machinery placed in service after January 19, 2025 can be fully written off in year one. This was phasing down (60% in 2024, 40% early 2025) — now it\'s back to 100% permanently. Also: 1099-NEC threshold rises to $2,000 starting with the 2026 tax year. For 2025, the $600 threshold still applies.'});

    tipEl.innerHTML='<div class="card"><div style="font-size:14px;font-weight:800;color:var(--text);margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid var(--line)">💡 IRS Tips — Plain English</div>'+
      tips.map(t=>'<div style="background:'+t.bg+';border:1.5px solid '+t.color+';border-radius:var(--r);padding:10px 12px;margin-bottom:8px">'+
        '<div style="font-size:12px;font-weight:700;color:'+t.color+';margin-bottom:3px">'+t.icon+' '+t.title+'</div>'+
        '<div style="font-size:11px;color:var(--text2);line-height:1.6">'+t.body+'</div>'+
      '</div>').join('')+
    '</div>';
  }
}

function estimateTax(netSelf,yr){
  if(netSelf<=0)return 0;
  const status=S.txStatus||'single';
  const seBase=netSelf*.9235;
  const seTax=Math.ceil(seBase*.153);
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
