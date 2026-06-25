let _renderDashRunning=false;

function _trendHtml(curr,prev,reverseColor){
  if(!prev||prev===0)return '';
  const pct=Math.round((curr-prev)/Math.abs(prev)*100);
  if(Math.abs(pct)<1)return '<div class="met-s">— vs LY</div>';
  const isUp=pct>0;
  const isGood=reverseColor?!isUp:isUp;
  const color=isGood?'var(--c-green)':'var(--c-red)';
  const arrow=isUp
    ?'<svg viewBox="0 0 12 12" width="9" height="9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M2 9l4-4 4 4"/></svg>'
    :'<svg viewBox="0 0 12 12" width="9" height="9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M2 3l4 4 4-4"/></svg>';
  return '<div class="met-s" style="color:'+color+'">'+arrow+Math.abs(pct)+'% <span style="color:var(--text3);font-weight:500">vs LY</span></div>';
}

function renderDash(){
  if(_renderDashRunning)return; // prevent cascade
  _renderDashRunning=true;
  try{
  document.getElementById('dash-greet').textContent=getDashGreeting();
  document.getElementById('dash-date').textContent=new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  const _calDateEl=document.getElementById('dash-cal-date');
  if(_calDateEl)_calDateEl.textContent=new Date().toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
  const tk=todayKey();

  const yr=dashYear||new Date().getFullYear();
  const yrStr=String(yr);
  initDashYear();
  const _incomeSum=income.filter(r=>r.date&&_dashInRange(r.date)).reduce((s,r)=>s+r.amount,0);
  const _paymentsSum=payments.filter(p=>p.date&&_dashInRange(p.date)&&p.amount!==0).reduce((s,p)=>s+p.amount,0);
  const tInc=_incomeSum+_paymentsSum;
  const tExp=expenses.filter(e=>e.date&&_dashInRange(e.date)).reduce((s,e)=>s+e.amount,0);
  const tMi=mileage.filter(m=>m.date&&_dashInRange(m.date)).reduce((s,m)=>s+(m.miles||0),0);
  // Prior-year totals for trend arrows (year mode only)
  const prevYrStr=String(yr-1);
  const _pInc=income.filter(r=>r.date&&r.date.startsWith(prevYrStr)).reduce((s,r)=>s+r.amount,0);
  const _pPay=payments.filter(p=>p.date&&p.date.startsWith(prevYrStr)&&p.amount!==0).reduce((s,p)=>s+p.amount,0);
  const prevInc=_pInc+_pPay;
  const prevExp=expenses.filter(e=>e.date&&e.date.startsWith(prevYrStr)).reduce((s,e)=>s+e.amount,0);
  const prevMi=mileage.filter(m=>m.date&&m.date.startsWith(prevYrStr)).reduce((s,m)=>s+(m.miles||0),0);
  const showTrends=dashPeriod==='year';
  const net=tInc-tExp-(tMi*IRS());

  const mileDed=Math.round(tMi*IRS());
  const netBeforeTax=Math.max(0,tInc-tExp-mileDed);
  const ytdTaxEst=estimateTax(netBeforeTax);
  const ytdTrueProfit=Math.round(tInc-tExp-ytdTaxEst);

  const wonBidsAll=bids.filter(b=>b.status==='Closed Won').length;
  const lostBidsAll=bids.filter(b=>b.status==='Closed Lost'||b.status==='Abandoned').length;
  const totalDecided=wonBidsAll+lostBidsAll;
  const closeRatio=totalDecided>0?Math.round(wonBidsAll/totalDecided*100):null;
  const closeColor=closeRatio===null?'var(--text3)':closeRatio>=40?'var(--green-mid)':closeRatio>=25?'var(--amber)':'#A32D2D';
  const closeLabel=closeRatio===null?'—':closeRatio+'%';
  const closeSub=closeRatio===null?'No decided bids yet':closeRatio>=40?'Above avg ✓':closeRatio>=25?'Near avg (~33%)':'Below avg — follow up more';
  const wonBidAmts=bids.filter(b=>b.status==='Closed Won').map(b=>b.amount||0);
  const avgJobVal=wonBidAmts.length?Math.round(wonBidAmts.reduce((s,a)=>s+a,0)/wonBidAmts.length):null;

  // Attention sub-text for tbar
  const _subEl=document.getElementById('dash-sub');
  if(_subEl&&!_isEmployee){
    const _collectItems=bids.filter(b=>b.status==='Closed Won'&&!b.clientCancelled&&getBidBalance(b)>0.01&&b.completion_date);
    const _collectOwed=_collectItems.reduce((s,b)=>s+getBidBalance(b),0);
    const _urgFu=bids.filter(b=>b.status==='Pending'&&!b.signingToken&&b.followup&&b.followup<=tk).length;
    const _pendingBids=bids.filter(b=>b.status==='Pending').length;
    const _licAlerts=getLicenseAlerts().filter(l=>_licStatus(l)==='expired').length;
    // Closed Won bids that still need a job scheduled and/or deposit collected
    const _wonNeedAction=bids.filter(b=>{
      if(b.status!=='Closed Won'||b.completion_date||b.clientCancelled)return false;
      const depositPaid=getBidPaid(b.id)>0;
      const hasJob=jobs.some(j=>(j.bid_id===b.id||(j.client_id===b.client_id&&!j.bid_id))&&j.eventType!=='estimate');
      return!(hasJob&&depositPaid);
    }).length;
    // In-progress drafts (paint full draft OR generic Draft/Pending-unsent bids)
    const _ld=loadEstFullDraft();
    const _draftCount=(_ld&&_ld.cname?1:0)+bids.filter(b=>!b.signingToken&&(b.status==='Draft'||(b.status==='Pending'&&!b.bid_date))).length;
    const _attnItems=_collectItems.length+_urgFu+_pendingBids+_licAlerts+_wonNeedAction+_draftCount;
    if(_attnItems>0){
      let _biggestNote='';
      if(_collectOwed>0)_biggestNote='The biggest one is '+fmt(_collectOwed)+' in outstanding balances.';
      else if(_wonNeedAction>0)_biggestNote=_wonNeedAction+' signed job'+(+_wonNeedAction>1?'s':'')+' need scheduling or a deposit.';
      else if(_urgFu>0)_biggestNote=_urgFu+' follow-up'+(+_urgFu>1?'s':'')+' are overdue.';
      else if(_pendingBids>0)_biggestNote=_pendingBids+' pending bid'+(+_pendingBids>1?'s':'')+' need attention.';
      _subEl.textContent=_attnItems+' thing'+(_attnItems>1?'s':'')+' need'+(_attnItems===1?'s':'')+' your attention today. '+_biggestNote;
    }else{
      _subEl.textContent='You\'re all caught up — nothing urgent.';
    }
  }else if(_subEl){_subEl.textContent='';}

  const kpiEl=document.getElementById('dash-kpi');
  if(kpiEl&&_isEmployee){
    // Employee home: Today's Jobs (dispatch-assigned) + vehicle line
    const empId=_employeeRecord?.id;
    const myDayJobs=jobs.filter(j=>String(j.assignedTo)===String(empId)&&j.assignedDate===tk)
      .sort((a,b2)=>(a.dispatchOrder||0)-(b2.dispatchOrder||0));
    // Vehicle display
    const vehKey='emp_vehicle_'+tk;
    const vehId=localStorage.getItem(vehKey);
    let vehLabel='';
    if(vehId&&vehId!=='none'){
      const v=(S.vehicles||[]).find(x=>String(x.id)===String(vehId));
      if(v)vehLabel=[v.year,v.make,v.model].filter(Boolean).join(' ')||v.name||'Vehicle';
    }
    function _empStatusLabel(s){return s==='done'?'Completed ✓':s==='arrived'?'On site':s==='enroute'?'On my way':'Not started';}
    function _empStatusColor(s){return s==='done'?'var(--c-green)':s==='arrived'?'var(--blue)':s==='enroute'?'var(--amber)':'var(--text3)';}
    function _empActionBtn(j){
      const st=(j.empStatus||{})[empId]||null;
      if(st==='done')return '';
      const nextState=st===null?'enroute':st==='enroute'?'arrived':'done';
      const label=st===null?'On My Way':st==='enroute'?'I\'ve Arrived':'Mark Done';
      return '<button onclick="_empSetStatus('+j.id+',\''+nextState+'\')" style="min-height:44px;padding:8px 14px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">'+label+'</button>';
    }
    const jobCards=myDayJobs.map(j=>{
      const c=clients.find(x=>x.id===j.client_id)||{name:j.clientName||j.name||'Job'};
      const addr=j.addr||c.addr||'';
      const mapsUrl=addr?'https://maps.apple.com/?daddr='+encodeURIComponent(addr):'';
      const st=(j.empStatus||{})[empId]||null;
      const statusLabel=_empStatusLabel(st);
      const statusColor=_empStatusColor(st);
      const _jTasks=(j.tasks||[]);
      const _taskHtml=_jTasks.length?
        '<div style="margin-top:8px;border-top:1px solid var(--border);padding-top:8px">'+
        _jTasks.map(t=>{
          const _doneInfo=t.done&&t.doneBy?'<div style="font-size:10px;color:var(--green-mid);margin-top:1px">'+escHtml(t.doneBy)+(t.doneAt?' · '+_fmtEmpTaskTime(t.doneAt):'')+'</div>':'';
          return '<div style="display:flex;align-items:flex-start;gap:8px;padding:3px 0">'+
          '<button onclick="_empToggleTask('+j.id+','+t.id+')" style="flex-shrink:0;margin-top:1px;width:22px;height:22px;border-radius:50%;border:2px solid '+(t.done?'var(--green-mid)':'var(--border2)')+';background:'+(t.done?'var(--green-mid)':'transparent')+';cursor:pointer;padding:0;display:flex;align-items:center;justify-content:center">'+(t.done?'<span style="color:#fff;font-size:9px;font-weight:900">✓</span>':'')+
          '</button>'+
          '<div><span style="font-size:12px;'+(t.done?'text-decoration:line-through;color:var(--text3)':'color:var(--text)')+'">'+escHtml(t.text)+'</span>'+_doneInfo+'</div>'+
          '</div>';
        }).join('')+
        (_jTasks.every(t=>t.done)?'<div style="font-size:11px;color:var(--green-mid);font-weight:700;margin-top:4px">All tasks complete ✓</div>':'')+
        '</div>':'';
      return '<div style="padding:12px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);margin-bottom:10px">'+
        '<div style="font-size:14px;font-weight:700;margin-bottom:4px">'+escHtml(c.name)+'</div>'+
        (addr?'<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">'+
          '<div style="font-size:12px;color:var(--text2);flex:1">'+escHtml(addr)+'</div>'+
          (mapsUrl?'<a href="'+mapsUrl+'" style="font-size:11px;font-weight:700;color:var(--blue);text-decoration:none;white-space:nowrap;min-height:36px;display:flex;align-items:center;padding:4px 8px;border-radius:var(--r);border:1px solid var(--blue)">🗺 Navigate</a>':'')+
        '</div>':'')+
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px">'+
          '<span style="font-size:11px;font-weight:700;color:'+statusColor+'">'+statusLabel+'</span>'+
          _empActionBtn(j)+
        '</div>'+
        _taskHtml+
      '</div>';
    }).join('');
    kpiEl.innerHTML=
      '<div id="emp-today-jobs" style="margin-bottom:16px">'+
        '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:10px">Today\'s Jobs</div>'+
        (vehLabel?'<div id="_emp-vehicle-display" style="font-size:12px;color:var(--text2);margin-bottom:10px">🚗 Driving: '+escHtml(vehLabel)+'</div>':'<div id="_emp-vehicle-display" style="font-size:12px;color:var(--text2);margin-bottom:10px"></div>')+
        (myDayJobs.length?jobCards:'<div style="font-size:13px;color:var(--text3);padding:12px 0;line-height:1.5">No jobs assigned for today. Check back after your contractor updates the schedule.</div>')+
      '</div>';
  } else if(kpiEl){
    const pBids=bids.filter(b=>b.status==='Pending');
    const prevTax=showTrends?estimateTax(Math.max(0,prevInc-prevExp-Math.round(prevMi*IRS()))):0;
    const prevProfit=showTrends?Math.round(prevInc-prevExp-prevTax):0;
    kpiEl.innerHTML='<div class="mets" id="dash-mets-inner">'+
      '<div class="met" data-kpi="revenue" style="cursor:pointer" onclick="goToTrackerTab(\'income\')">'+
        '<div class="met-l">Revenue</div>'+
        '<div class="met-v" style="color:var(--c-green)">'+fmtShort(tInc)+'</div>'+
        (showTrends?_trendHtml(tInc,prevInc,false):'')+
      '</div>'+
      '<div class="met" data-kpi="expenses" style="cursor:pointer" onclick="goToTrackerTab(\'expenses\')">'+
        '<div class="met-l">Expenses</div>'+
        '<div class="met-v" style="color:var(--c-red)">'+fmtShort(tExp)+'</div>'+
        (showTrends?_trendHtml(tExp,prevExp,true):'')+
      '</div>'+
      '<div class="met" data-kpi="mileage" style="cursor:pointer" onclick="goToTrackerTab(\'mileage\')">'+
        '<div class="met-l">Mileage</div>'+
        '<div class="met-v">'+Math.round(tMi).toLocaleString()+'<span class="unit"> mi</span></div>'+
        (showTrends?_trendHtml(tMi,prevMi,false):'')+
      '</div>'+
      '<div class="met" data-kpi="taxes" style="cursor:pointer" data-pg="pg-taxes" onclick="goPg(this.dataset.pg)">'+
        '<div class="met-l">Taxes</div>'+
        '<div class="met-v" style="color:var(--c-red)">'+fmtShort(ytdTaxEst)+'</div>'+
        (showTrends&&prevTax?_trendHtml(ytdTaxEst,prevTax,true):'')+
      '</div>'+
      '<div class="met" data-kpi="profit" style="cursor:pointer" data-chart="profit" onclick="showKpiChart(this.dataset.chart)">'+
        '<div class="met-l">Profit</div>'+
        '<div class="met-v" style="color:'+(ytdTrueProfit<0?'var(--c-red)':'var(--c-green)')+'">'+fmtShort(ytdTrueProfit)+'</div>'+
        (showTrends?_trendHtml(ytdTrueProfit,prevProfit,false):'')+
      '</div>'+
      '<div class="met" data-kpi="avgjob">'+
        '<div class="met-l">Avg job</div>'+
        '<div class="met-v">'+(avgJobVal!==null?fmtShort(avgJobVal):'—')+'</div>'+
      '</div>'+
    '</div>';
  }

  // Hobby loss check — 3 of last 5 years negative profit
  const _hobbyEl=document.getElementById('dash-hobby-warn');
  if(_hobbyEl&&!_isEmployee){
    const _cy=new Date().getFullYear();
    let _lossYears=0;
    for(let _yi=0;_yi<5;_yi++){
      const _yrs=String(_cy-_yi);
      const _yi2=income.filter(r=>r.date&&r.date.startsWith(_yrs)).reduce((s,r)=>s+r.amount,0);
      const _ye=expenses.filter(e=>e.date&&e.date.startsWith(_yrs)).reduce((s,e)=>s+e.amount,0);
      const _ym=mileage.filter(m=>m.date&&m.date.startsWith(_yrs)).reduce((s,m)=>s+(m.miles||0),0);
      if(_yi2-_ye-(_ym*_getIrsRateForYear(_yrs))<0)_lossYears++;
    }
    if(_lossYears>=3){
      _hobbyEl.style.display='block';
      _hobbyEl.innerHTML='<div style="background:#FFF8E7;border:1.5px solid #D4A017;border-radius:var(--rl);padding:12px 14px;margin-bottom:10px">'+
        '<div style="font-size:12px;font-weight:700;color:#78350F;margin-bottom:3px">⚠️ '+_lossYears+' of last 5 years show net losses</div>'+
        '<div style="font-size:12px;color:var(--text2);line-height:1.5">You\'ve had losses several years in a row. The IRS may start asking questions — talk to your CPA about showing you run this as a real business.</div>'+
      '</div>';
    }else{_hobbyEl.style.display='none';}
  }
  // Crew labor tile (contractor + payroll viewer + tracking on) — async, links to Books
  if(typeof _renderDashCrewToday==='function')_renderDashCrewToday();
  // Employee: show a location-permission fix-it banner only if perms are off
  if(typeof _geoPermissionBanner==='function')_geoPermissionBanner();

  const closeTip=document.getElementById('dash-close-tip');
  if(_isEmployee){if(closeTip)closeTip.style.display='none';}
  if(!_isEmployee&&closeTip){
    if(closeRatio!==null&&closeRatio<25&&totalDecided>=3){
      closeTip.style.display='block';
      closeTip.innerHTML='<div style="background:#FFF8F0;border:1px solid var(--amber);border-radius:var(--rl);padding:12px 14px">'+
        '<div style="font-size:12px;font-weight:700;color:#B8600A;margin-bottom:4px">&#128273; Closing ratio is '+closeRatio+'% — below average</div>'+
        '<div style="font-size:12px;color:var(--text2);line-height:1.5">Industry average is around 33%. Common reasons: slow follow-up, price too high, or not enough urgency at the estimate.</div>'+
      '</div>';
    } else {
      closeTip.style.display='none';
    }
  }

  // Simple summary cards: Leads + Collections
  const LEAD_STAGES_DASH=['incomplete','new','est_scheduled','bid_out','bid_urgent','abandoned'];
  const leadCount=clients.filter(c=>LEAD_STAGES_DASH.includes(getClientStage(c.id).stage)).length;
  const urgentLeads=clients.filter(c=>{const s=getClientStage(c.id).stage;return s==='bid_urgent'||s==='abandoned';}).length;
  const subLeads=leadCount===0?'No active leads':(urgentLeads?urgentLeads+' need follow-up · '+leadCount+' total':leadCount+' active lead'+(leadCount!==1?'s':''));
  const lsub=document.getElementById('dash-leads-sub');
  if(lsub)lsub.textContent=subLeads;
  const collectItems=bids.filter(b=>b.status==='Closed Won'&&!b.clientCancelled&&getBidBalance(b)>0.01&&b.completion_date);
  const collectOwed=collectItems.reduce((s,b)=>s+getBidBalance(b),0);
  const subCollect=collectItems.length===0?'Nothing to collect 🎉':collectItems.length+' job'+(collectItems.length!==1?'s':'')+' · '+fmt(collectOwed)+' owed';
  const csub=document.getElementById('dash-collect-sub');
  if(csub){csub.textContent=subCollect;csub.style.color=collectItems.length?'#A32D2D':'var(--text3)';}

  if(!_isEmployee)renderPipeline();
  else{const pe=document.getElementById('dash-pipeline');if(pe)pe.innerHTML='';}
  // Section shared styles
  const _rowStyle='display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);margin-bottom:6px';
  const _nameStyle='font-size:13px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
  const _btnStyle='font-size:11px;background:var(--bg);border-color:var(--border2)';
  const _btnPStyle='font-size:11px';
  const _xStyle='font-size:11px;color:var(--text3);padding:6px 8px;background:var(--bg);border-color:var(--border2)';
  // Estimates in progress + sent proposals now live in renderTodayFeed()
  renderGoal();
  checkGoalPrompt();
  renderLeadSources();
  renderDashToday();
  renderDashCollect();
  renderTodayFeed();
  const _nearbyEl=document.getElementById('dash-nearby');
  if(_nearbyEl){
    if(_nearbyJob&&!_activeTimer){
      _nearbyEl.style.display='block';
      _nearbyEl.innerHTML='<div style="background:linear-gradient(135deg,#1E4D2B,#2D7A44);border-radius:var(--r);padding:14px 16px;display:flex;align-items:center;gap:12px;cursor:pointer" onclick="openClockInSheet('+_nearbyJob.jobId+')">'+
        '<span style="font-size:24px">🔨</span>'+
        '<div style="flex:1;min-width:0"><div style="font-size:14px;font-weight:800;color:#fff">You\'re at '+escHtml(_nearbyJob.clientName)+'\'s</div>'+
        '<div style="font-size:12px;color:rgba(255,255,255,.75)">'+escHtml(_nearbyJob.addr)+' · Tap to clock in</div></div>'+
        '<span style="font-size:20px;color:rgba(255,255,255,.6)">▶</span></div>';
    }else{_nearbyEl.style.display='none';}
  }
  // Update new nav badges
  const _owing=bids.filter(b=>b.status==='Closed Won'&&!b.clientCancelled&&getBidBalance(b)>0.01);
  const _cl=document.getElementById('qa-collect-label');
  if(_cl)_cl.textContent=_owing.length?'Collect ('+_owing.length+')':'Collect';
  const _qb=document.getElementById('qa-collect-btn');
  if(_qb){_qb.style.background=_owing.length>0?'var(--green)':'var(--border2)';_qb.style.borderColor=_qb.style.background;_qb.style.color=_owing.length>0?'#fff':'var(--text3)';}
  const _licBtn=document.getElementById('mmi-licensing');
  if(_licBtn){const _la=getLicenseAlerts();_licBtn.style.position='relative';const _exBadge=_licBtn.querySelector('._lic-badge');if(_la.length){if(!_exBadge){const b=document.createElement('span');b.className='_lic-badge';b.style.cssText='position:absolute;top:6px;right:calc(50% - 18px);width:8px;height:8px;background:#e53e3e;border-radius:50%;border:2px solid var(--nav-bg)';_licBtn.appendChild(b);}else{_exBadge.style.display='block';}}else{if(_exBadge)_exBadge.style.display='none';}}
  // Only re-render the currently visible workflow page (avoid rebuilding off-screen pages on every renderDash)
  const _activePg=document.querySelector('.pg.active')?.id;
  if(_activePg==='pg-leads')renderLeadsPage();
  else if(_activePg==='pg-jobs')renderJobsPage();
  else if(_activePg==='pg-money')renderMoneyPage();
  else _updateNavBadges(); // fast badge-only update when on home or other pages
  window._pwaUpdateBadge&&window._pwaUpdateBadge();
  renderContractsDash&&renderContractsDash();

  setTimeout(()=>{_applyDashOrder(_getDashWidgetOrder());if(typeof _initDashDrag==='function')_initDashDrag();_applyKpiOrder();if(typeof _initKpiDrag==='function')_initKpiDrag();},0);
  }finally{_renderDashRunning=false;}
}

// ── Employee status updates from daily view ───────────────────────────────────
function _empSetStatus(jobId,newState){
  const j=jobs.find(x=>x.id===jobId);if(!j)return;
  const empId=_employeeRecord?.id;if(!empId)return;
  if(newState==='done'){
    // Show note bottom sheet before marking done
    const ov=document.createElement('div');ov.className='zmodal-overlay';
    const sheet=document.createElement('div');
    sheet.style.cssText='position:fixed;bottom:0;left:0;right:0;background:var(--bg);border-radius:16px 16px 0 0;padding:20px 16px;box-shadow:0 -4px 24px rgba(0,0,0,.15);opacity:0;transform:translateY(16px);transition:opacity .22s cubic-bezier(.22,1,.36,1),transform .22s cubic-bezier(.22,1,.36,1)';
    sheet.innerHTML=
      '<div style="font-size:15px;font-weight:800;margin-bottom:10px">Mark Job Done</div>'+
      '<div class="f" style="margin-bottom:14px"><label>Optional note</label>'+
        '<textarea id="_emp-done-note" rows="3" placeholder="Any notes about the job..." style="font-size:14px;padding:10px;resize:vertical;min-height:80px"></textarea></div>'+
      '<button onclick="_empConfirmDone('+jobId+')" style="width:100%;min-height:44px;padding:12px;border-radius:var(--r);border:none;background:var(--c-green);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:8px">Done</button>'+
      '<button onclick="this.closest(\'.zmodal-overlay\').remove()" style="width:100%;padding:10px;border-radius:var(--r);border:none;background:none;color:var(--text3);font-size:13px;cursor:pointer;font-family:inherit">Cancel</button>';
    ov.appendChild(sheet);document.body.appendChild(ov);
    ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
    requestAnimationFrame(()=>{sheet.style.opacity='1';sheet.style.transform='translateY(0)';});
    return;
  }
  if(!j.empStatus)j.empStatus={};
  j.empStatus[empId]=newState;
  saveAll();
  const label=newState==='enroute'?'On your way!':'Arrived — get to work!';
  showToast(label,newState==='enroute'?'🚗':'📍');
  renderDash();
}
function _empConfirmDone(jobId){
  const j=jobs.find(x=>x.id===jobId);if(!j)return;
  const empId=_employeeRecord?.id;if(!empId)return;
  const note=(document.getElementById('_emp-done-note')?.value||'').trim();
  if(!j.empStatus)j.empStatus={};
  j.empStatus[empId]='done';
  if(note){if(!j.empNotes)j.empNotes={};j.empNotes[empId]=note;}
  document.querySelector('.zmodal-overlay')?.remove();
  saveAll();showToast('Job marked complete','✅');renderDash();
}

function _fmtEmpTaskTime(iso){
  try{const d=new Date(iso);return d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});}catch(e){return'';}
}
function _empToggleTask(jobId,taskId){
  const j=jobs.find(x=>x.id===jobId);if(!j||!j.tasks)return;
  const t=j.tasks.find(x=>x.id===taskId);if(!t)return;
  t.done=!t.done;
  if(t.done){
    t.doneBy=_employeeRecord?.name||'Employee';
    t.doneAt=new Date().toISOString();
  }else{delete t.doneBy;delete t.doneAt;}
  saveAll();renderDash();
}

function renderDashToday(){
  const el=document.getElementById('dash-today');if(!el)return;
  const tk=todayKey();
  const todayJobs=jobs.filter(j=>{
    if(j.status==='canceled')return false;
    const d=parseInt(j.days)||1;
    for(let i=0;i<d;i++){if(addDays(j.start,i)===tk)return true;}
    return false;
  }).sort((a,b)=>{
    if(a.eventType==='estimate'&&b.eventType!=='estimate')return -1;
    if(b.eventType==='estimate'&&a.eventType!=='estimate')return 1;
    return (a.time||'').localeCompare(b.time||'');
  });

  if(!todayJobs.length){
    const dow=new Date().getDay();
    const msgs=[
      'Nothing Sunday — recharge for the week.',
      'Open Monday. Book an estimate today.',
      'Open Tuesday. Good day to follow up.',
      'Open Wednesday. Mid-week reach out.',
      'Open Thursday. Book weekend estimates.',
      'Open Friday. Homeowners are home this weekend.',
      'Open Saturday. Great day for estimates.'
    ];
    el.innerHTML=
      '<div style="text-align:center;padding:12px 0">'+
        '<div style="font-size:22px;margin-bottom:6px">'+(dow===0||dow===6?'🛋️':'🎯')+'</div>'+
        '<div style="font-size:13px;font-weight:700;margin-bottom:4px">'+msgs[dow]+'</div>'+
        '<div style="font-size:11px;color:var(--text3);margin-top:4px">Open day — check Make Money Today</div>'+
      '</div>';
    return;
  }

  const _crewEmps=S.employees||[];
  el.innerHTML=todayJobs.map(j=>{
    const c=getClientById(j.client_id);
    const isEst=j.eventType==='estimate';
    const isActive=j.start<=tk&&addDays(j.start,(parseInt(j.days)||1)-1)>=tk;
    // Quick crew assignment row (owner only, non-estimate jobs)
    const _crewRow=(!_isEmployee&&!isEst)?(()=>{
      if(_crewEmps.length>0){
        const _aId=j.assignedTo&&j.assignedDate===tk?j.assignedTo:null;
        const _aEmp=_aId?_crewEmps.find(e=>String(e.id)===String(_aId)):null;
        return '<div onclick="event.stopPropagation()" style="display:flex;align-items:center;gap:8px;margin-top:7px;padding-top:7px;border-top:1px solid var(--border)">'+
          (_aEmp?'<span style="font-size:11px;font-weight:700;color:var(--blue);background:var(--blue-lt,#e6f0fb);padding:3px 9px;border-radius:20px">👤 '+escHtml(_aEmp.name)+'</span>':
                 '<span style="font-size:11px;color:var(--text3)">No crew assigned</span>')+
          '<button onclick="_openCrewAssignSheet('+j.id+')" style="margin-left:auto;padding:4px 12px;border-radius:20px;border:1px solid var(--border2);background:transparent;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;color:var(--blue)">+ Assign</button>'+
        '</div>';
      }
      const _days=parseInt(j.days)||1;
      return '<div onclick="event.stopPropagation()" style="display:flex;align-items:center;gap:8px;margin-top:7px;padding-top:7px;border-top:1px solid var(--border)">'+
        '<span style="font-size:11px;font-weight:700;color:var(--blue);background:var(--blue-lt,#e6f0fb);padding:3px 9px;border-radius:20px">👤 You</span>'+
        '<span style="font-size:11px;color:var(--text3);margin-left:2px">'+_days+' day'+(_days!==1?'s':'')+' on schedule</span>'+
      '</div>';
    })():'';
    return '<div style="padding:11px 0;border-bottom:1px solid var(--border)">'+
      '<div onclick="'+(j.client_id?'openClientDetail('+j.client_id+')':'void(0)')+'" style="display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:'+(j.client_id?'pointer':'default')+'">'+
        '<div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">'+
          '<div style="width:10px;height:10px;border-radius:2px;background:'+(j.color||'var(--blue)')+';flex-shrink:0"></div>'+
          '<div style="min-width:0">'+
            '<div style="font-size:14px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml(j.name||'')+'</div>'+
            '<div style="font-size:11px;color:var(--text3)">'+
              (isEst?
                (j.time?'@ '+fmtTime(j.time)+' · ':'')+
                '<span style="color:#7F77DD;font-weight:600">Estimate visit</span>'
                :
                (j.addr||c&&c.addr?'<span style="font-weight:600">'+escHtml((j.addr||c.addr||'').split(',')[0])+'</span>':'No address')+
                (j.value?' · '+fmt(j.value):'')+
                ' · '+j.days+' day'+(parseInt(j.days)!==1?'s':'')
              )+
            '</div>'+
          '</div>'+
        '</div>'+
        '<div style="display:flex;align-items:center;gap:6px;flex-shrink:0">'+
          (j.client_id&&isEst?
            '<div onclick="event.stopPropagation();sendReminderSMS('+j.client_id+')" style="background:var(--bg2);border:1px solid var(--border2);border-radius:var(--r);padding:7px 9px;cursor:pointer" title="Send reminder">💬</div>'
          :'')+
          '<span style="font-size:10px;font-weight:700;padding:3px 8px;border-radius:10px;background:'+(isEst?'rgba(127,119,221,.15)':'rgba(24,95,165,.12)')+';color:'+(isEst?'#7F77DD':'var(--blue)')+'">'+
            (isEst?'Estimate':'Active')+
          '</span>'+
        '</div>'+
      '</div>'+
      _crewRow+
    '</div>';
  }).join('');
}


function _openCrewAssignSheet(jobId){
  const j=jobs.find(x=>x.id===jobId);if(!j)return;
  const tk=todayKey();
  const emps=(S.employees||[]).filter(e=>e.name);
  if(!emps.length){showToast('Add team members first','👤');return;}
  document.getElementById('_crew-assign-ov')?.remove();
  const ov=document.createElement('div');ov.className='zmodal-overlay';ov.id='_crew-assign-ov';
  ov.onclick=e=>{if(e.target===ov)ov.remove();};
  const sheet=document.createElement('div');
  sheet.style.cssText='position:fixed;bottom:0;left:0;right:0;background:var(--bg);border-radius:16px 16px 0 0;padding:20px 16px 40px;box-shadow:0 -4px 24px rgba(0,0,0,.15);opacity:0;transform:translateY(16px);transition:opacity .22s cubic-bezier(.22,1,.36,1),transform .22s cubic-bezier(.22,1,.36,1)';
  const c=getClientById(j.client_id);
  const curEmpId=j.assignedTo&&j.assignedDate===tk?j.assignedTo:null;
  const roleLabels={tech:'Field Tech',office:'Office',manager:'Manager',owner:'Owner'};
  sheet.innerHTML=
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'+
    '<div style="font-size:15px;font-weight:800">Assign crew</div>'+
    '<button onclick="document.getElementById(\'_crew-assign-ov\').remove()" style="padding:6px 16px;border-radius:20px;border:1px solid var(--border2);background:var(--bg2);font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">Done</button>'+
    '</div>'+
    '<div style="font-size:12px;color:var(--text3);margin-bottom:14px">'+escHtml(j.name||c?.name||'Job')+'</div>'+
    '<div style="display:flex;flex-direction:column;gap:8px">'+
    emps.map(e=>{
      const isAsgn=String(e.id)===String(curEmpId);
      return '<button onclick="_assignCrewToJob('+jobId+','+e.id+')" style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:var(--r);border:1.5px solid '+(isAsgn?'var(--blue)':'var(--border)')+';background:'+(isAsgn?'var(--blue-lt,#e6f0fb)':'var(--bg2)')+';cursor:pointer;font-family:inherit;text-align:left;width:100%">'+
        '<div style="width:38px;height:38px;border-radius:50%;background:'+(isAsgn?'var(--blue)':'var(--bg)')+';border:1.5px solid '+(isAsgn?'var(--blue)':'var(--border2)')+';display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:'+(isAsgn?'#fff':'var(--text)')+';flex-shrink:0">'+escHtml((e.name||'?').substring(0,2).toUpperCase())+'</div>'+
        '<div style="flex:1;min-width:0;text-align:left"><div style="font-size:14px;font-weight:700;color:'+(isAsgn?'var(--blue)':'var(--text)')+'">'+escHtml(e.name)+'</div>'+
        (e.role?'<div style="font-size:11px;color:var(--text3)">'+escHtml(roleLabels[e.role]||e.role)+'</div>':'')+
        '</div>'+
        (isAsgn?'<span style="font-size:18px;color:var(--blue)">✓</span>':'')+
      '</button>';
    }).join('')+
    (curEmpId?'<button onclick="_assignCrewToJob('+jobId+',null)" style="margin-top:2px;padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:none;color:var(--text3);font-size:13px;cursor:pointer;font-family:inherit;width:100%">Remove assignment</button>':'')+
    '</div>';
  ov.appendChild(sheet);document.body.appendChild(ov);
  requestAnimationFrame(()=>{sheet.style.opacity='1';sheet.style.transform='translateY(0)';});
}

function _assignCrewToJob(jobId,empId){
  const j=jobs.find(x=>x.id===jobId);if(!j)return;
  const tk=todayKey();
  if(empId!=null){
    j.assignedTo=empId;j.assignedDate=tk;
    // Durable record of everyone ever assigned — powers the crew trust ranking on estimates.
    if(!Array.isArray(j.crewHistory))j.crewHistory=[];
    if(!j.crewHistory.map(String).includes(String(empId)))j.crewHistory.push(empId);
    const emp=(S.employees||[]).find(e=>String(e.id)===String(empId));
    showToast(escHtml(emp?.name||'Crew member')+' assigned today','👤');
  }else{
    j.assignedTo=null;j.assignedDate=null;
    showToast('Assignment removed','');
  }
  saveAll();
  document.getElementById('_crew-assign-ov')?.remove();
  renderDashToday();
}

// ── Collection escalation & risk system ─────────────────────────────────

function getNextCollAction(stage){
  const map={
    none:     {label:'💬 Send Reminder',    smsKey:'reminder',  next:'reminder'},
    reminder: {label:'💬 Send 2nd Notice',  smsKey:'second',    next:'second'},
    second:   {label:'💬 Send Intent',      smsKey:'intent',    next:'intent'},
    intent:   {label:'⚖️ File Lien',         smsKey:null,        next:'lien_ready'},
    lien_ready:{label:'⚖️ File Lien Now',    smsKey:null,        next:'lien_filed'},
    lien_filed:{label:'✓ Release Lien',     smsKey:null,        next:'resolved'},
  };
  return map[stage]||map['none'];
}

function emitEvent(type,clientId,extra){if(!events)events=[];events.push({id:Date.now()+'_'+Math.random().toString(36).slice(2,6),type,ts:new Date().toISOString(),client_id:clientId,...(extra||{})});if(events.length>600)events=events.slice(-600);}
function autoLogContact(clientId,note){const c=getClientById(clientId);if(!c)return;c.last_contact_date=todayKey();const pb=bids.find(b=>b.client_id===clientId&&b.status==='Pending');if(pb){pb.last_followup_date=todayKey();if(!pb.followup||pb.followup<=todayKey())pb.followup=addDays(todayKey(),7);}emitEvent(note||'contact',clientId);try{saveAll();}catch(e){}}
function markFollowupSent(bidId){const b=bids.find(x=>x.id===bidId);if(!b)return;b.last_followup_date=todayKey();b.followupStage=(b.followupStage||1)+1;const nextDays=b.followupStage>=3?14:7;b.followup=addDays(todayKey(),nextDays);b.noResponseCount=(b.noResponseCount||0)+1;saveAll();setTimeout(renderDash,600);}
function _snoozeFollowup(bidId,days){const b=bids.find(x=>x.id===bidId);if(!b)return;b.followup=addDays(todayKey(),days||2);saveAll();setTimeout(renderDash,300);showToast('Follow-up snoozed '+days+' days','⏰');}
function openExpenseForJob(jobId,clientId){const j=jobs.find(x=>x.id===jobId);goPg('pg-tracker');setTimeout(()=>{const sel=document.getElementById('exp-job');if(sel){for(let i=0;i<sel.options.length;i++){if(sel.options[i].value==jobId){sel.selectedIndex=i;break;}}}const expSec=document.getElementById('add-exp-form')||document.getElementById('exp-add-section');if(expSec)expSec.scrollIntoView({behavior:'smooth'});},200);}
function renderDashCollect(){
  const el=document.getElementById('dash-collect');if(!el)return;
  const tk=todayKey();
  const collectItems=[];
  bids.filter(b=>b.status==='Closed Won'&&getBidBalance(b)>0.01).forEach(b=>{
    const c=getClientById(b.client_id);if(!c)return;
    const jobDone=b.completion_date||(()=>{
      const doneJob=jobs.find(x=>x.client_id===b.client_id&&x.eventType!=='estimate'&&x.status==='done');
      if(doneJob)return doneJob.completion_date||doneJob.start;
      const pastJob=jobs.find(x=>x.client_id===b.client_id&&x.eventType!=='estimate'
        &&x.status!=='canceled'
        &&addDays(x.start,(parseInt(x.days)||1)-1)<tk);
      return pastJob?addDays(pastJob.start,(parseInt(pastJob.days)||1)-1):null;
    })();
    if(!jobDone)return;
    const daysOverdue=Math.floor((new Date(tk+'T12:00')-new Date(jobDone+'T12:00'))/86400000);
    const balance=getBidBalance(b);
    collectItems.push({
      name:c.name,
      sub:fmt(balance)+' owed'+(daysOverdue>0?' · '+daysOverdue+'d past completion':''),
      urgent:daysOverdue>=7,veryUrgent:daysOverdue>=30,
      balance,bidId:b.id,cid:b.client_id
    });
  });
  const badge=document.getElementById('daft-pay-badge');
  if(badge){
    if(collectItems.length){
      badge.innerHTML='<span style="background:#A32D2D;color:#fff;border-radius:8px;padding:1px 6px;font-size:10px;font-weight:800">'+collectItems.length+'</span>';
    } else {
      badge.innerHTML='';
    }
  }
  if(!collectItems.length){
    el.innerHTML='<div style="color:var(--text3);font-size:12px;padding:8px 0">All collected — no outstanding balances.</div>';
    return;
  }
  collectItems.sort((a,b)=>b.balance-a.balance);
  el.innerHTML=collectItems.map(f=>
    '<div style="padding:10px 0;border-bottom:1px solid var(--border)">'+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">'+
        '<div style="flex:1;min-width:0">'+
          '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:2px">'+
            '<div style="font-size:13px;font-weight:700">'+escHtml(f.name||'')+'</div>'+
            (f.veryUrgent?'<span style="font-size:10px;font-weight:800;text-transform:uppercase;color:#fff;background:#A32D2D;padding:2px 5px;border-radius:4px">30+ days</span>':
             f.urgent?'<span style="font-size:10px;font-weight:800;text-transform:uppercase;color:#fff;background:var(--amber);padding:2px 5px;border-radius:4px">Overdue</span>':'')+
          '</div>'+
          '<div style="font-size:11px;color:'+(f.urgent?'#A32D2D':'var(--text3)')+'">'+f.sub+'</div>'+
        '</div>'+
        '<button class="btn btn-sm btn-g" onclick="openPayPanel('+f.bidId+')" style="flex-shrink:0;font-size:11px">Collect</button>'+
      '</div>'+
    '</div>'
  ).join('');
}

// ── On-load unpaid work alert ────────────────────────────────────────────────
function checkUnpaidOnLoad(){
  if(window._collOnLoadShown)return;
  window._collOnLoadShown=true;
  const tk=todayKey();
  const unpaid=bids
    .filter(b=>b.status==='Closed Won'&&getBidBalance(b)>0.01&&b.completion_date)
    .map(b=>({b,days:Math.floor((new Date(tk+'T12:00')-new Date(b.completion_date+'T12:00'))/86400000),stage:getBidCollStage(b)}))
    .filter(x=>x.days>0)
    .sort((a,b)=>b.days-a.days);
  if(!unpaid.length)return;
  const {b,days,stage}=unpaid[0];
  const c=getClientById(b.client_id);if(!c)return;
  const bal=getBidBalance(b);
  const biz=S.bname||'TradeDesk';
  const next=getNextCollAction(stage);
  const isFileable=stage==='intent'||stage==='lien_ready';
  const lienFiled=stage==='lien_filed';
  const otherCount=unpaid.length-1;
  const urgIcon=days>=30?'🚨':days>=14?'⚠️':'💰';
  const urgLabel=days>=30?'30+ days overdue — act now':days>=14?'Seriously overdue':days>=7?'Overdue':'Balance due';
  const urgColor=days>=14?'#A32D2D':'var(--amber)';
  let actionBtn='';
  if(lienFiled){
    actionBtn='<button onclick="this.closest(\'.zmodal-overlay\').remove();openClientDetail('+b.client_id+')" style="flex:2;padding:13px;border-radius:var(--r);border:none;background:#3D0000;color:#FFB3B3;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">⚖️ View lien</button>';
  } else if(isFileable){
    actionBtn='<button onclick="this.closest(\'.zmodal-overlay\').remove();showFileLienDirect('+b.id+')" style="flex:2;padding:13px;border-radius:var(--r);border:none;background:#3D0000;color:#FFB3B3;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">⚖️ File Lien</button>';
  } else if(next.smsKey&&c.phone){
    actionBtn='<button onclick="collSendSMS(bids.find(x=>x.id=='+b.id+'),\''+next.smsKey+'\');this.closest(\'.zmodal-overlay\').remove()" style="flex:2;padding:13px;border-radius:var(--r);border:none;background:var(--amber);color:#1a1a1a;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">'+next.label+'</button>';
  } else if(c.phone){
    actionBtn='<a href="tel:'+c.phone.replace(/\D/g,'')+'" onclick="autoLogContact('+c.id+',\'call\')" style="flex:2;padding:13px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;text-decoration:none;display:block;text-align:center">📞 Call now</a>';
  }
  const ov=document.createElement('div');ov.className='zmodal-overlay';
  const box=document.createElement('div');box.className='zmodal';
  box.innerHTML=
    '<div style="text-align:center;font-size:30px;margin-bottom:6px">'+urgIcon+'</div>'+
    '<div style="font-size:16px;font-weight:800;text-align:center;margin-bottom:4px">Unpaid balance</div>'+
    '<div style="text-align:center;font-size:30px;font-weight:800;color:#A32D2D;margin-bottom:4px">'+fmt(bal)+'</div>'+
    '<div style="text-align:center;font-size:13px;color:var(--text2);margin-bottom:3px">'+escHtml(c.name)+'</div>'+
    '<div style="text-align:center;font-size:11px;color:'+urgColor+';font-weight:700;margin-bottom:16px">'+urgLabel+' · '+days+'d since completion</div>'+
    (otherCount>0?'<div style="font-size:11px;color:var(--text3);text-align:center;margin-bottom:14px;padding:6px;background:var(--bg2);border-radius:var(--r)">+'+otherCount+' other unpaid job'+(otherCount!==1?'s':'')+'</div>':'')+
    '<div style="display:flex;gap:8px;margin-bottom:10px">'+
      '<button onclick="this.closest(\'.zmodal-overlay\').remove()" style="flex:1;padding:13px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);font-size:14px;font-weight:600;cursor:pointer;font-family:inherit">Later</button>'+
      actionBtn+
    '</div>'+
    '<button onclick="this.closest(\'.zmodal-overlay\').remove();openPayPanel('+b.id+')" style="width:100%;padding:11px;border-radius:var(--r);border:none;background:var(--green);color:#fff;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">💳 Log payment received</button>';
  ov.appendChild(box);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
}

// ── Kansas Mechanic's Lien document generator ────────────────────────────────
function printKansasLien(bidId){
  const bid=bids.find(b=>b.id===bidId);if(!bid)return;
  const lien=getBidLien(bidId);if(!lien)return;
  const c=getClientById(bid.client_id);if(!c)return;
  const bname=S.bname||'TradeDesk';
  const bphone=S.bphone||'';
  const blic=S.blic||'';
  const owner=getOwnerName()||'';
  const claimAmt=(lien.amount||getBidBalance(bid)||0).toFixed(2);
  const addr=bid.addr||c.addr||'';
  // Auto-detect county if not already set on the lien record
  const {stateCode:detectedState,county:detectedCounty}=getCountyForBid(bid);
  const stateName=(typeof STATE_TAX!=='undefined'&&STATE_TAX[detectedState]?.name)||detectedState;
  const statuteRef=(typeof STATE_LIEN!=='undefined'&&STATE_LIEN[detectedState])?STATE_LIEN[detectedState].statute:(detectedState+' mechanic\'s lien statutes');
  const county=lien.county||(detectedCounty+', '+detectedState);
  const countyShort=county.replace(/,\s*[A-Z]{2}$/,'');
  const filingInfo=getCountyFilingInfo(detectedState);
  const filedDate=lien.date||todayKey();
  const lastWorkDate=bid.completion_date||filedDate;
  // Derive first-work date from job start or bid date
  const job=jobs.find(j=>j.bid_id===bidId);
  const firstWorkDate=job?job.start:bid.bid_date||lastWorkDate;
  const fmtD=d=>{if(!d)return'_______________';const[y,m,dy]=d.split('-');const mn=['January','February','March','April','May','June','July','August','September','October','November','December'];return mn[parseInt(m)-1]+' '+parseInt(dy)+', '+y;};
  const surfTypes=[...new Set((bid.surfaces||[]).map(s=>s.type).filter(Boolean))];
  const workDesc=surfTypes.length?surfTypes.join(', ')+' — painting and coating services':(bid.type||'Painting and coating services');
  const html=`<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Mechanic's Lien — ${escHtml(c.name)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Times New Roman',Times,serif;font-size:13pt;color:#000;background:#fff;padding:40px}
  h1{font-size:18pt;text-align:center;text-transform:uppercase;letter-spacing:2px;margin-bottom:6px}
  h2{font-size:13pt;text-align:center;margin-bottom:24px;font-weight:normal}
  .subtitle{text-align:center;font-size:11pt;margin-bottom:30px;font-style:italic}
  .section{margin-bottom:18px}
  .label{font-size:10pt;font-weight:bold;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px}
  .value{border-bottom:1px solid #000;min-height:24px;padding:2px 4px;font-size:13pt}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  .notice{border:2px solid #000;padding:14px;margin:20px 0;font-size:11pt;line-height:1.6}
  .oath{margin:24px 0;font-size:11pt;line-height:1.8;text-align:justify}
  .sig-block{margin-top:36px}
  .sig-line{border-bottom:1px solid #000;min-height:36px;margin-bottom:4px}
  .sig-label{font-size:10pt;text-align:center;color:#333}
  .notary{border:1px solid #000;padding:16px;margin-top:28px;font-size:11pt;line-height:1.8}
  .notary-title{font-size:12pt;font-weight:bold;text-transform:uppercase;margin-bottom:10px;text-align:center}
  .page-break{page-break-after:always;margin-bottom:40px}
  .proposal-section{margin-top:40px}
  @media print{body{padding:20px}.no-print{display:none}}
</style></head><body>
<div class="no-print" style="background:#185FA5;color:#fff;padding:12px 16px;margin:-40px -40px 30px;display:flex;justify-content:space-between;align-items:center">
  <span style="font-size:15px;font-weight:700">${escHtml(stateName)} Mechanic's Lien — Ready to print</span>
  <button onclick="tdPrint()" style="padding:8px 20px;border-radius:6px;border:none;background:#fff;color:#185FA5;font-size:13px;font-weight:700;cursor:pointer">🖨️ Print</button>
</div>

<h1>Mechanic's Lien Statement</h1>
<h2>State of ${escHtml(stateName)}</h2>
<div class="subtitle">Pursuant to ${escHtml(statuteRef)}</div>

<div class="notice">
  <strong>NOTICE:</strong> This Mechanic's Lien Statement is filed with the Register of Deeds of ${escHtml(county)} pursuant to ${escHtml(stateName)} mechanic's lien statutes (${escHtml(statuteRef)}). This lien attaches to the real property described herein for labor, services, and materials furnished but unpaid.
</div>

<div class="section">
  <div class="label">1. Claimant (Contractor)</div>
  <div class="value">${escHtml(bname)}</div>
  ${bphone?'<div class="value" style="margin-top:6px">Phone: '+escHtml(bphone)+(blic?' &nbsp;|&nbsp; License: '+escHtml(blic):'')+'</div>':''}
  ${owner?'<div class="value" style="margin-top:6px">Contractor/Owner: '+escHtml(owner)+'</div>':''}
</div>

<div class="section">
  <div class="label">2. Property Owner (Debtor)</div>
  <div class="value">${escHtml(c.name)}</div>
  ${c.phone?'<div class="value" style="margin-top:6px">Phone: '+escHtml(c.phone)+'</div>':''}
</div>

<div class="section">
  <div class="label">3. Property Address (Location of Work)</div>
  <div class="value">${escHtml(addr)}</div>
</div>

<div class="section">
  <div class="label">4. Legal Description of Property</div>
  <div class="value" style="min-height:48px">The real property located at ${escHtml(addr)}, ${escHtml(countyShort)}, ${escHtml(stateName)} (legal description to be obtained from county records if required for filing)</div>
</div>

<div class="section">
  <div class="label">5. Description of Work Performed</div>
  <div class="value" style="min-height:48px">${escHtml(workDesc)}</div>
</div>

<div class="section grid2">
  <div>
    <div class="label">6. Date Work First Furnished</div>
    <div class="value">${fmtD(firstWorkDate)}</div>
  </div>
  <div>
    <div class="label">7. Date Work Last Furnished</div>
    <div class="value">${fmtD(lastWorkDate)}</div>
  </div>
</div>

<div class="section grid2">
  <div>
    <div class="label">8. Amount of Lien Claimed</div>
    <div class="value" style="font-size:16pt;font-weight:bold">$${escHtml(claimAmt)}</div>
  </div>
  <div>
    <div class="label">9. Date of This Lien Statement</div>
    <div class="value">${fmtD(filedDate)}</div>
  </div>
</div>

<div class="section">
  <div class="label">10. County of Filing</div>
  <div class="value">${escHtml(county)}</div>
</div>

${lien.notes?'<div class="section"><div class="label">Notes / Case Reference</div><div class="value">'+escHtml(lien.notes)+'</div></div>':''}

<div class="oath">
  <strong>VERIFICATION:</strong> The undersigned, being duly sworn, states that the foregoing Mechanic's Lien Statement is true and correct to the best of their knowledge and belief; that the amount claimed is justly due and owing after deducting all just credits and offsets; and that the services described above were actually performed at the location identified herein.
</div>

<div class="sig-block">
  <div class="grid2">
    <div>
      <div class="label" style="margin-bottom:8px">Claimant Signature</div>
      <div class="sig-line"></div>
      <div class="sig-label">${escHtml(owner||'Contractor')}</div>
    </div>
    <div>
      <div class="label" style="margin-bottom:8px">Date Signed</div>
      <div class="sig-line"></div>
      <div class="sig-label">Date</div>
    </div>
  </div>
  <div style="margin-top:16px">
    <div class="label" style="margin-bottom:8px">Printed Name & Title</div>
    <div class="sig-line"></div>
    <div class="sig-label">${escHtml(owner||'Contractor')}, Owner — ${escHtml(bname)}</div>
  </div>
</div>

<div class="notary">
  <div class="notary-title">Notary Acknowledgment</div>
  State of ${escHtml(stateName)}<br>
  County of ____________________________<br><br>
  Subscribed and sworn to before me this _______ day of __________________, 20___,<br>
  by ____________________________________________.<br><br>
  <div style="margin-top:24px;display:flex;gap:40px">
    <div style="flex:1">
      <div style="border-bottom:1px solid #000;min-height:36px"></div>
      <div style="font-size:10pt;text-align:center;margin-top:4px">Notary Public Signature</div>
    </div>
    <div style="flex:1">
      <div style="border-bottom:1px solid #000;min-height:36px"></div>
      <div style="font-size:10pt;text-align:center;margin-top:4px">My Commission Expires</div>
    </div>
  </div>
  <div style="margin-top:12px;font-size:10pt">
    <strong>File with:</strong> ${escHtml(filingInfo.office)} — ${escHtml(countyShort)}, ${escHtml(detectedState)}<br>
    Search Apple Maps for "${escHtml(countyShort)} ${escHtml(filingInfo.office)}" to find the exact office address.<br>
    <strong>Statute:</strong> ${escHtml(filingInfo.cite)}<br>
    ${filingInfo.notes.map(n=>'→ '+escHtml(n)).join('<br>')}
  </div>
</div>

${bid.proposalHtml?`<div class="page-break"></div><div class="proposal-section"><h1 style="margin-bottom:20px">Exhibit A — Original Proposal</h1><div style="border:1px solid #000;padding:16px">${bid.proposalHtml}</div></div>`:''}

</body></html>`;

  const win=window.open('','_blank');
  if(win){win.document.write(html);win.document.close();}
  else{zAlert('Allow pop-ups to open the lien document. In Safari: tap AA in address bar → Allow pop-ups.');}
}

function _mmtToggle(id){
  window['_mmtCol_'+id]=window['_mmtCol_'+id]===false?true:false;
  renderTodayFeed();
}

function _markDepositCash(bidId){
  const bid=bids.find(b=>b.id===bidId);if(!bid)return;
  const depAmt=(bid.deposit||0)>0?bid.deposit:bid.amount||0;
  zConfirm('Mark '+fmt(depAmt)+' deposit collected as cash?',()=>{
    payments.push({id:Date.now(),bid_id:bidId,client_id:bid.client_id,client_name:bid.client_name,
      date:todayKey(),type:'deposit',amount:depAmt,method:'cash',ref:'Cash — recorded from feed'});
    saveAll();renderDash();showToast('Cash deposit recorded','💰');
    _refreshClientHub(bid.client_id); // keep client hub balance in sync
  });
}

function renderTodayFeed(){
  const el=document.getElementById('dash-money-feed');if(!el)return;
  const tk=todayKey();
  const finalPayItems=[],depositItems=[],scheduleItems=[],pendingItems=[],buildItems=[],alertItems=[];

  // ALERTS — License expiring/expired (always first, outside sections)
  const licAlerts=getLicenseAlerts();
  if(licAlerts.length){
    const hasExpired=licAlerts.some(l=>_licStatus(l)==='expired');
    alertItems.push(
      '<div class="tf-card" onclick="goPg(\'pg-licensing\')" style="cursor:pointer">'+
        '<div class="tf-icon">'+(hasExpired?'🚨':'⚠️')+'</div>'+
        '<div class="tf-body">'+
          '<div class="tf-name">'+(hasExpired?licAlerts.filter(l=>_licStatus(l)==='expired').length+' expired license'+(licAlerts.filter(l=>_licStatus(l)==='expired').length>1?'s':''):'')+(hasExpired&&licAlerts.some(l=>_licStatus(l)==='soon')?' · ':'')+(!hasExpired&&licAlerts.filter(l=>_licStatus(l)==='soon').length?licAlerts.filter(l=>_licStatus(l)==='soon').length+' expiring soon':'')+'</div>'+
          '<div class="tf-sub" style="color:'+(hasExpired?'var(--red)':'var(--amber)')+'">'+licAlerts.slice(0,2).map(l=>escHtml(l.label)).join(', ')+(licAlerts.length>2?' +more':'')+'</div>'+
        '</div>'+
        '<div style="font-size:11px;color:var(--blue);font-weight:700;flex-shrink:0">View →</div>'+
      '</div>'
    );
  }

  // COLLECT — Completed jobs with balance owed
  bids.filter(b=>b.status==='Closed Won'&&getBidBalance(b)>0.01&&b.completion_date).forEach(b=>{
    const c=getClientById(b.client_id);if(!c)return;
    const bal=getBidBalance(b);
    const daysAgo=Math.floor((new Date(tk+'T12:00')-new Date(b.completion_date+'T12:00'))/86400000);
    const {daysUntilDeadline}=getLienTimeline(b);
    const deadlineUrgent=daysUntilDeadline<=30&&daysUntilDeadline>0;
    const deadlineExpired=daysUntilDeadline<=0;
    const countdownTag=deadlineExpired?'<span style="display:inline-block;font-size:9px;font-weight:800;text-transform:uppercase;padding:2px 5px;border-radius:3px;background:#000;color:#FFB3B3;margin-left:4px">Lien window expired</span>':
      deadlineUrgent?'<span style="display:inline-block;font-size:9px;font-weight:800;text-transform:uppercase;padding:2px 5px;border-radius:3px;background:#A32D2D;color:#fff;margin-left:4px">'+daysUntilDeadline+'d to file</span>':'';
    const urgTag=daysAgo>=30?'<span style="display:inline-block;font-size:9px;font-weight:800;text-transform:uppercase;padding:2px 5px;border-radius:3px;background:#A32D2D;color:#fff;margin-left:4px">30+ days</span>':
      daysAgo>=7?'<span style="display:inline-block;font-size:9px;font-weight:800;text-transform:uppercase;padding:2px 5px;border-radius:3px;background:#C0720A;color:#fff;margin-left:4px">Overdue</span>':'';
    const stage=getBidCollStage(b);const next=getNextCollAction(stage);
    const lienStage=stage==='lien_filed';const isFileable=stage==='intent'||stage==='lien_ready';
    let actBtns='';
    if(c.phone)actBtns+='<a href="tel:'+c.phone.replace(/\D/g,'')+'" onclick="autoLogContact('+c.id+',\'call\')" class="btn btn-sm" style="font-size:11px">Call</a>';
    if(next.smsKey&&c.phone)actBtns+='<button onclick="collSendSMS(bids.find(x=>x.id=='+b.id+'),\''+next.smsKey+'\')" class="btn btn-sm" style="font-size:11px;border-color:var(--amber);color:#856404;background:var(--amber-lt)">'+next.label+'</button>';
    else if(isFileable)actBtns+='<button onclick="showFileLienDirect('+b.id+')" class="btn btn-sm" style="font-size:11px;background:#3D0000;color:#FFB3B3;border-color:#3D0000">⚖️ File Lien</button>';
    else if(lienStage)actBtns+='<button onclick="printKansasLien('+b.id+')" class="btn btn-sm" style="font-size:11px;background:#3D0000;color:#FFB3B3;border-color:#3D0000">⚖️ View lien doc</button>';
    actBtns+='<button onclick="openPayPanel('+b.id+')" class="btn btn-sm btn-g" style="font-size:11px">Collect →</button>';
    finalPayItems.push(
      '<div class="tf-card">'+
        '<div class="tf-icon">💰</div>'+
        '<div class="tf-body">'+
          '<div class="tf-name">'+escHtml(c.name)+urgTag+countdownTag+'</div>'+
          '<div class="tf-sub" style="color:#A32D2D">'+fmt(bal)+' owed · '+daysAgo+'d since completion</div>'+
        '</div>'+
        '<div class="tf-acts">'+actBtns+'</div>'+
      '</div>'
    );
  });

  // COLLECT + SCHEDULE — Won bids not yet completed
  bids.filter(b=>b.status==='Closed Won'&&!b.completion_date&&!b.clientCancelled).forEach(b=>{
    // If no deposit was required treat as paid — $0-deposit and cash-upfront jobs
    const depositRequired=(b.deposit||0)>0;
    const depositPaid=!depositRequired||getBidPaid(b.id)>0;
    const hasJob=jobs.some(j=>(j.bid_id===b.id||(j.client_id===b.client_id&&!j.bid_id))&&j.eventType!=='estimate');
    if(hasJob&&depositPaid)return;
    const c=getClientById(b.client_id);
    const cDisp=c?c.name:b.client_name||b.name||'Client';
    if(!hasJob&&depositPaid){
      // Deposit collected (or not required) — just needs scheduling
      scheduleItems.push(
        '<div class="tf-card">'+
          '<div class="tf-icon">📅</div>'+
          '<div class="tf-body">'+
            '<div class="tf-name">'+escHtml(cDisp)+'</div>'+
            '<div class="tf-sub" style="color:var(--blue)">'+fmt(b.amount)+' · deposit paid · not yet scheduled</div>'+
          '</div>'+
          '<div class="tf-acts">'+
            '<button onclick="schedFromBid('+b.id+')" class="btn btn-sm btn-p" style="font-size:11px">Schedule →</button>'+
          '</div>'+
        '</div>'
      );
    } else {
      // Deposit still needed — goes to Deposit & Schedule
      const depAmt=depositRequired?fmt(b.deposit):fmt(b.amount);
      const subText=hasJob?'Job in progress · deposit not collected · '+depAmt:'Deposit required before scheduling · '+depAmt;
      depositItems.push(
        '<div class="tf-card">'+
          '<div class="tf-icon">'+(hasJob?'💰':'💳')+'</div>'+
          '<div class="tf-body">'+
            '<div class="tf-name">'+escHtml(cDisp)+'</div>'+
            '<div class="tf-sub" style="color:'+(hasJob?'#A32D2D':'var(--blue)')+'">'+subText+'</div>'+
          '</div>'+
          '<div class="tf-acts">'+
            '<button onclick="openPayPanel('+b.id+',\'deposit\')" class="btn btn-sm" style="font-size:11px;border-color:var(--blue);color:var(--blue)">Deposit</button>'+
            '<button onclick="_markDepositCash('+b.id+')" class="btn btn-sm" style="font-size:11px;color:var(--text3)">Paid Cash</button>'+
          '</div>'+
        '</div>'
      );
    }
  });

  // CLOSE — 2nd follow-up needed
  bids.filter(b=>b.status==='Pending'&&!b.signingToken&&!b.draft&&(b.noResponseCount||0)>=1).forEach(b=>{
    const c=getClientById(b.client_id);if(!c)return;
    const fn=c.name.split(' ')[0];
    const smsBody=encodeURIComponent('Hey '+fn+', just wanted to see if this is still something you\'re wanting to move forward with?');
    const daysOut=b.followup?Math.floor((new Date(tk+'T12:00')-new Date(b.followup+'T12:00'))/86400000):0;
    pendingItems.push(
      '<div class="tf-card">'+
        '<div class="tf-icon">🔥</div>'+
        '<div class="tf-body">'+
          '<div class="tf-name">'+escHtml(c.name)+'</div>'+
          '<div class="tf-sub" style="color:#A32D2D">2nd follow-up · '+fmt(b.amount)+' · '+Math.abs(daysOut)+'d waiting</div>'+
        '</div>'+
        '<div class="tf-acts">'+
          (c.phone?'<a href="tel:'+c.phone.replace(/\D/g,'')+'" onclick="autoLogContact('+c.id+',\'call\')" class="btn btn-sm" style="font-size:11px">Call</a>':'')+
          (c.phone?'<a href="sms:'+c.phone.replace(/\D/g,'')+'&body='+smsBody+'" onclick="autoLogContact('+c.id+',\'second_followup\');markFollowupSent('+b.id+')" class="btn btn-sm" style="font-size:11px;border-color:var(--amber);color:#856404;background:var(--amber-lt)">📱 Send</a>':'')+
          '<button onclick="_snoozeFollowup('+b.id+',2)" class="btn btn-sm" style="font-size:11px;color:var(--text3)">Snooze 2d</button>'+
          '<button onclick="markFUWon('+b.id+','+b.client_id+')" class="btn btn-sm btn-g" style="font-size:11px">Won ✓</button>'+
        '</div>'+
      '</div>'
    );
  });

  // CLOSE — Follow-up overdue
  bids.filter(b=>b.status==='Pending'&&!b.signingToken&&!b.draft&&b.followup&&b.followup<=tk&&!(b.noResponseCount>=1)).forEach(b=>{
    const c=getClientById(b.client_id);if(!c)return;
    const fn=c.name.split(' ')[0];
    const stage=b.followupStage||1;
    const msgs=['Hey '+fn+', just checking in — did you get a chance to look over the proposal? Happy to answer any questions.','Hi '+fn+', wanted to follow up on the estimate I sent over. Let me know if you\'d like to move forward or have any questions.','Hey '+fn+', I have an opening coming up that might work great for your project. Would love to get it scheduled — let me know!'];
    const smsBody=encodeURIComponent(msgs[Math.min(stage-1,msgs.length-1)]);
    const daysOut=Math.floor((new Date(tk+'T12:00')-new Date(b.followup+'T12:00'))/86400000);
    pendingItems.push(
      '<div class="tf-card">'+
        '<div class="tf-icon">⏰</div>'+
        '<div class="tf-body">'+
          '<div class="tf-name">'+escHtml(c.name)+'</div>'+
          '<div class="tf-sub" style="color:var(--amber)">Follow-up #'+stage+' · '+(daysOut>0?daysOut+'d overdue':'due today')+' · '+fmt(b.amount)+'</div>'+
        '</div>'+
        '<div class="tf-acts">'+
          (c.phone?'<a href="sms:'+c.phone.replace(/\D/g,'')+'&body='+smsBody+'" onclick="autoLogContact('+c.id+',\'followup_sent\');markFollowupSent('+b.id+')" class="btn btn-sm" style="font-size:11px;border-color:var(--amber);color:#856404;background:var(--amber-lt)">📱 Send</a>':'')+
          (c.phone?'<a href="tel:'+c.phone.replace(/\D/g,'')+'" onclick="autoLogContact('+c.id+',\'call\')" class="btn btn-sm" style="font-size:11px">Call</a>':'')+
          '<button onclick="_snoozeFollowup('+b.id+',2)" class="btn btn-sm" style="font-size:11px;color:var(--text3)">Snooze 2d</button>'+
          '<button onclick="markFUWon('+b.id+','+b.client_id+')" class="btn btn-sm btn-g" style="font-size:11px">Won ✓</button>'+
        '</div>'+
      '</div>'
    );
  });

  // CLOSE — Awaiting signature
  bids.filter(b=>b.signingToken&&b.status==='Pending').forEach(b=>{
    const c=getClientById(b.client_id);if(!c)return;
    const days=b.bid_date?Math.floor((new Date(tk+'T12:00')-new Date(b.bid_date+'T12:00'))/86400000):0;
    const urgColor=days>=14?'#A32D2D':days>=7?'var(--amber)':'var(--text3)';
    const daysStr=days===0?'Sent today':days===1?'1 day waiting':days+'d waiting';
    // Show three distinct open timestamps + view counts per bid
    const _hubTs=(typeof _proposalViewsByBidHubClient!=='undefined'&&_proposalViewsByBidHubClient)?_proposalViewsByBidHubClient[String(b.id)]:null;
    const _clientTs=(typeof _proposalViewsByBidClient!=='undefined'&&_proposalViewsByBidClient)?_proposalViewsByBidClient[String(b.id)]:null;
    const _contractorTs=(typeof _proposalViewsByBidContractor!=='undefined'&&_proposalViewsByBidContractor)?_proposalViewsByBidContractor[String(b.id)]:null;
    const _hubCnt=(typeof _proposalViewsByBidHubCount!=='undefined'&&_proposalViewsByBidHubCount)?(_proposalViewsByBidHubCount[String(b.id)]||0):0;
    const _clientCnt=(typeof _proposalViewsByBidClientCount!=='undefined'&&_proposalViewsByBidClientCount)?(_proposalViewsByBidClientCount[String(b.id)]||0):0;
    // Timezone-aware timestamp: "Today at 2:34 PM", "Yesterday at 9:15 AM", "Mon, May 25 at 3:20 PM"
    const _localTs=ts=>{
      if(!ts)return'';
      const d=new Date(ts);
      const m=Math.floor((Date.now()-d)/60000);
      if(m<2)return'just now';
      if(m<60)return m+'m ago';
      const t=d.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
      const today=new Date();today.setHours(0,0,0,0);
      const yest=new Date(today-86400000);
      if(d>=today)return'Today at '+t;
      if(d>=yest)return'Yesterday at '+t;
      return d.toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'})+' at '+t;
    };
    let viewedBadge='';
    if(_hubTs){
      const _cStr=_hubCnt>1?' · '+_hubCnt+'×':'';
      viewedBadge='<div style="font-size:11px;font-weight:700;color:#2563eb;margin-top:3px">🔗 Hub opened · '+_localTs(_hubTs)+_cStr+'</div>';
    }
    if(_clientTs){
      const _cStr=_clientCnt>1?' · '+_clientCnt+'×':'';
      viewedBadge+='<div style="font-size:11px;font-weight:700;color:#16a34a;margin-top:2px">👁 Proposal opened · '+_localTs(_clientTs)+_cStr+'</div>';
    }
    if(!_hubTs&&!_clientTs){
      viewedBadge='<div style="font-size:11px;color:var(--text3);margin-top:3px">Client hasn\'t opened yet</div>';
    }
    if(_contractorTs){
      viewedBadge+='<div style="font-size:10px;color:var(--text3);margin-top:1px">You previewed · '+_localTs(_contractorTs)+'</div>';
    }
    pendingItems.push(
      '<div class="tf-card">'+
        '<div class="tf-icon">📨</div>'+
        '<div class="tf-body">'+
          '<div class="tf-name">'+escHtml(c.name)+'</div>'+
          '<div class="tf-sub" style="color:'+urgColor+'">'+fmt(b.amount)+' · '+daysStr+'</div>'+
          viewedBadge+
        '</div>'+
        '<div class="tf-acts">'+
          (b.proposalHtml?'<button onclick="viewSavedProposal('+b.id+')" class="btn btn-sm" style="font-size:11px">View</button>':'')+
          '<button onclick="resendProposalLink('+b.id+')" class="btn btn-sm" style="font-size:11px">Resend</button>'+
          '<button onclick="discardInProgressBid('+b.id+')" class="btn btn-sm" style="font-size:11px;color:#A32D2D">Delete</button>'+
        '</div>'+
      '</div>'
    );
  });

  // BUILD — Unsaved wizard draft
  let draft=loadEstFullDraft();
  if(draft&&draft.cname){
    const alreadyWon=bids.some(b=>b.status==='Closed Won'&&(b.client_name||b.name||'').toLowerCase().trim()===(draft.cname||'').toLowerCase().trim());
    if(alreadyWon){clearEstFullDraft();draft=null;}
  }
  const _activeDraftBidId=draft?.lastBidId||null;
  if(draft&&draft.cname){
    buildItems.push(
      '<div class="tf-card">'+
        '<div class="tf-icon">✏️</div>'+
        '<div class="tf-body">'+
          '<div class="tf-name">'+escHtml(draft.cname)+'</div>'+
          '<div class="tf-sub" style="color:var(--text3)">Unsaved draft — finish &amp; send</div>'+
        '</div>'+
        '<div class="tf-acts">'+
          '<button onclick="resumeEstimateDraft()" class="btn btn-sm btn-p" style="font-size:11px">Resume →</button>'+
          '<button onclick="clearEstFullDraft();renderDash()" class="btn btn-sm" style="font-size:11px;color:var(--text3)">Discard</button>'+
        '</div>'+
      '</div>'
    );
  }
  // RECOVER — backup snapshot holds an unsaved estimate richer than the live draft.
  // Surfaces in surf_draft / est_full_draft that the live state lost are still frozen
  // in the boot snapshot. Offer one-tap recovery when the backup beats what's loaded.
  if(typeof _scanRecoverableEstimate==='function'){
    const _rec=_scanRecoverableEstimate();
    const _liveSurf=(draft&&Array.isArray(draft.surfaces))?draft.surfaces.length:0;
    if(_rec&&_rec.surf>_liveSurf){
      buildItems.push(
        '<div class="tf-card" style="border:1px solid #9DBEE5;background:#F0F7FF">'+
          '<div class="tf-icon">♻️</div>'+
          '<div class="tf-body">'+
            '<div class="tf-name">'+escHtml(_rec.cname||'Unsaved estimate')+'</div>'+
            '<div class="tf-sub" style="color:#1a365d">Backup found — '+_rec.surf+' surfaces · '+_rec.rooms+' rooms</div>'+
          '</div>'+
          '<div class="tf-acts">'+
            '<button onclick="recoverLostEstimate()" class="btn btn-sm btn-p" style="font-size:11px">Recover →</button>'+
          '</div>'+
        '</div>'
      );
    }
  }
  bids.filter(b=>!b.signingToken&&(b.draft||b.status==='Pending'||(b.status==='Draft'&&b.geiLines!==undefined))&&b.id!==_activeDraftBidId).forEach(b=>{
    const c=getClientById(b.client_id);
    const displayName=c?.name||b.client_name||b.name||'';
    if(!displayName)return;
    const days=b.bid_date?Math.floor((new Date(tk+'T12:00')-new Date(b.bid_date+'T12:00'))/86400000):0;
    const isDraft=b.status==='Draft'||b.draft;
    const subLabel=isDraft&&!b.amount?'In progress — finish &amp; send':isDraft?'Draft — finish &amp; send':(fmt(b.amount)+' · built '+(days===0?'today':days+'d ago')+' · not sent yet');
    buildItems.push(
      '<div class="tf-card">'+
        '<div class="tf-icon">✏️</div>'+
        '<div class="tf-body">'+
          '<div class="tf-name">'+escHtml(displayName)+'</div>'+
          (b.type?'<div class="tf-sub" style="font-size:12px;font-weight:600;color:var(--text2);margin-bottom:1px">'+escHtml(b.type)+'</div>':'')+
          '<div class="tf-sub" style="color:var(--text3)">'+subLabel+'</div>'+
        '</div>'+
        '<div class="tf-acts">'+
          '<button onclick="'+(b.geiLines!==undefined?'openGenericEstimate(getClientById('+b.client_id+'),'+b.id+',\''+escHtml(b.trade_type||'general')+'\')':'openEditBid('+b.id+','+(b.lastStep||1)+')')+'" class="btn btn-sm btn-p" style="font-size:11px">Resume →</button>'+
          '<button onclick="discardInProgressBid('+b.id+')" class="btn btn-sm" style="font-size:11px;color:var(--text3)">Discard</button>'+
        '</div>'+
      '</div>'
    );
  });

  // BUILD — New leads with no estimates yet
  const newLeads=clients.filter(c=>{
    if(getClientStage(c.id).stage!=='new')return false;
    if(bids.some(b=>b.client_id===c.id))return false;
    if(jobs.some(j=>j.client_id===c.id&&j.eventType==='estimate'))return false;
    return true;
  });
  if(newLeads.length){
    buildItems.push(
      '<div class="tf-card">'+
        '<div class="tf-icon">🙋</div>'+
        '<div class="tf-body">'+
          '<div class="tf-name">'+(newLeads.length===1?'1 new lead ready':newLeads.length+' new leads ready')+'</div>'+
          '<div class="tf-sub" style="color:var(--blue)">Build estimates to move them forward</div>'+
        '</div>'+
        '<div class="tf-acts"><button onclick="goPg(\'pg-leads\')" class="btn btn-sm btn-p" style="font-size:11px">View leads →</button></div>'+
      '</div>'
    );
  }

  const showFinalPay=true,showDepSched=true,showPending=true,showBuild=true;

  // Section builder — defaultOpen=true makes the section expand on first render
  const _sec=(id,icon,label,color,items,show,defaultOpen=false)=>{
    if(!show||!items.length)return '';
    if(defaultOpen&&window['_mmtCol_'+id]===undefined)window['_mmtCol_'+id]=false;
    const col=window['_mmtCol_'+id]!==false;
    return '<div class="mmt-sec">'+
      '<div class="mmt-sec-hdr" onclick="_mmtToggle(\''+id+'\')">'+
        '<span style="font-size:14px">'+icon+'</span>'+
        '<span class="mmt-sec-label" style="color:'+color+'">'+label+'</span>'+
        '<span class="mmt-sec-badge">'+items.length+'</span>'+
        '<span class="mmt-sec-chev">'+(col?'›':'⌄')+'</span>'+
      '</div>'+
      (col?'':'<div>'+items.join('')+'</div>')+
    '</div>';
  };

  const totalShown=(showBuild?buildItems.length:0)+(showPending?pendingItems.length:0)+(showDepSched?depositItems.length+scheduleItems.length:0)+(showFinalPay?finalPayItems.length:0)+alertItems.length;
  const _feedSub=document.getElementById('dash-feed-sub');

  if(!totalShown){
    const msg='You\'re caught up — nothing to chase right now.';
    el.innerHTML='<div style="padding:14px;font-size:13px;color:var(--text3)">'+msg+'</div>';
    if(_feedSub)_feedSub.textContent='all caught up';
    return;
  }

  if(_feedSub){
    const parts=[];
    if(showBuild&&buildItems.length)parts.push(buildItems.length+' to build');
    if(showPending&&pendingItems.length)parts.push(pendingItems.length+' pending');
    if(showDepSched&&(depositItems.length+scheduleItems.length))parts.push((depositItems.length+scheduleItems.length)+' to deposit/schedule');
    if(showFinalPay&&finalPayItems.length)parts.push(finalPayItems.length+' to collect');
    _feedSub.textContent=parts.join(' · ')||'all caught up';
  }

  el.innerHTML=
    (alertItems.length?'<div>'+alertItems.join('')+'</div>':'')+
    _sec('build','✏️','Build','var(--text2)',buildItems,showBuild)+
    _sec('pending','📨','Pending','#7c3aed',pendingItems,showPending)+
    _sec('dep-sched','💳','Deposit & Schedule','var(--blue)',[...depositItems,...scheduleItems],showDepSched,true)+
    _sec('collect','💰','Collect','#A32D2D',finalPayItems,showFinalPay,true);
}

function checkGoalPrompt(){
  if(S.goalMonthly)return;
  if(window._goalPromptShownThisSession)return;
  const paidJobs=bids.filter(b=>b.status==='Closed Won'&&getBidBalance(b)<=0.01);
  if(paidJobs.length<5)return;
  if(window._goalPromptShown)return;
  window._goalPromptShown=true;
  const avgVal=Math.round(paidJobs.reduce((s,b)=>s+b.amount,0)/paidJobs.length);
  setTimeout(()=>{
    const overlay=document.createElement('div');
    overlay.className='zmodal-overlay';
    const box=document.createElement('div');
    box.className='zmodal';
    box.innerHTML=
      '<div style="font-size:22px;text-align:center;margin-bottom:8px">🎯</div>'+
      '<div class="zmodal-title" style="text-align:center">5 paid jobs — milestone!</div>'+
      '<div class="zmodal-msg" style="text-align:center">Your average job is '+fmt(avgVal)+'. Set a monthly revenue goal and the app will track your progress and tell you exactly how many estimates you need.</div>'+
      '<div class="zmodal-btns" style="flex-direction:column;gap:8px">'+
        '<input type="number" id="goal-prompt-input" placeholder="Monthly goal e.g. 8000" min="0" step="500" '+
          'style="font-size:18px;font-weight:700;padding:12px;border-radius:var(--r);border:2px solid var(--blue);background:var(--bg2);color:var(--text);width:100%;box-sizing:border-box;text-align:center">'+
        '<button id="goal-prompt-set" class="btn btn-p" style="font-size:15px;padding:12px;width:100%">Set my goal</button>'+
        '<button id="goal-prompt-skip" class="btn" style="font-size:13px;padding:10px;width:100%;color:var(--text3)">Maybe later</button>'+
      '</div>';
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    document.getElementById('goal-prompt-set').onclick=()=>{
      const val=parseFloat(document.getElementById('goal-prompt-input').value)||0;
      if(!val)return;
      S.goalMonthly=val;
      saveAll();
      overlay.remove();
      renderDash();
    };
    document.getElementById('goal-prompt-skip').onclick=()=>{
      window._goalPromptShownThisSession=true;
      overlay.remove();
    };
    overlay.addEventListener('click',e=>{if(e.target===overlay){window._goalPromptShownThisSession=true;overlay.remove();}});
  },800);
}

function renderGoal(){
  const el=document.getElementById('dash-goal');if(!el)return;
  const goal=S.goalMonthly||0;
  const paidJobs=bids.filter(b=>b.status==='Closed Won'&&getBidBalance(b)<=0.01);
  if(!goal||paidJobs.length<5){el.innerHTML='';return;}

  const now=new Date();
  const monthKey=(now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0'));
  const monthInc=income.filter(i=>i.date&&i.date.startsWith(monthKey)).reduce((s,i)=>s+i.amount,0);

  const wonAll=bids.filter(b=>b.status==='Closed Won');
  const decidedAll=bids.filter(b=>b.status==='Closed Won'||b.status==='Closed Lost'||b.status==='Abandoned');
  const avgJobVal=wonAll.length>=3?Math.round(wonAll.reduce((s,b)=>s+b.amount,0)/wonAll.length):0;
  const closeRate=decidedAll.length>=5?wonAll.length/decidedAll.length:null;

  const pct=Math.min(100,Math.round(monthInc/goal*100));
  const remaining=Math.max(0,goal-monthInc);
  const onTrack=monthInc>=goal*(now.getDate()/new Date(now.getFullYear(),now.getMonth()+1,0).getDate());

  const barColor=pct>=100?'var(--green)':pct>=60?'var(--blue)':pct>=30?'var(--amber)':'#A32D2D';

  let html=
    '<div style="background:var(--bg);border:1px solid var(--border);border-radius:var(--rl);padding:14px 16px">'+
      '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px">'+
        '<div style="font-size:12px;font-weight:700;color:var(--text2)">'+now.toLocaleString('default',{month:'long'})+' goal</div>'+
        '<div style="font-size:12px;color:var(--text3)">'+fmt(monthInc)+' of '+fmt(goal)+'</div>'+
      '</div>'+
      '<div style="background:var(--border);border-radius:4px;height:10px;margin-bottom:8px;overflow:hidden">'+
        '<div style="height:100%;border-radius:4px;background:'+barColor+';width:'+pct+'%;transition:width .3s"></div>'+
      '</div>'+
      '<div style="display:flex;justify-content:space-between;align-items:center">'+
        '<div style="font-size:13px;font-weight:700;color:'+barColor+'">'+
          (pct>=100?'🎯 Goal hit!':pct+'% — '+fmt(remaining)+' to go')+
        '</div>'+
        '<div style="font-size:11px;color:'+(onTrack?'var(--green-mid)':'var(--amber)')+'">'+
          (onTrack?'On track':'Behind pace')+
        '</div>'+
      '</div>';

  if(remaining>0&&avgJobVal>0&&closeRate!==null){
    const jobsNeeded=Math.ceil(remaining/avgJobVal);
    const estsNeeded=Math.ceil(jobsNeeded/closeRate);
    html+=
      '<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);display:grid;grid-template-columns:repeat(3,1fr);gap:8px;text-align:center">'+
        '<div><div style="font-size:18px;font-weight:800;color:var(--blue)">'+fmt(remaining)+'</div><div style="font-size:10px;color:var(--text3)">Still needed</div></div>'+
        '<div><div style="font-size:18px;font-weight:800">'+jobsNeeded+'</div><div style="font-size:10px;color:var(--text3)">Jobs to close</div></div>'+
        '<div><div style="font-size:18px;font-weight:800;color:var(--amber)">'+estsNeeded+'</div><div style="font-size:10px;color:var(--text3)">Estimates needed</div></div>'+
      '</div>'+
      '<div style="font-size:10px;color:var(--text3);margin-top:6px;text-align:center">Based on '+fmt(avgJobVal)+' avg job · '+(Math.round(closeRate*100))+'% close rate</div>';
  } else if(remaining>0&&decidedAll.length<5){
    html+=
      '<div style="margin-top:8px;font-size:11px;color:var(--text3);text-align:center">Need '+Math.max(0,5-decidedAll.length)+' more decided bids to calculate estimates needed</div>';
  }

  html+='</div>';
  el.innerHTML=html;
}

function renderLeadSources(){
  const el=document.getElementById('dash-sources');if(!el)return;
  if(!clients.length){
    el.innerHTML='<div class="empty">No clients yet. Lead source tracking starts when you add your first client.</div>';
    return;
  }

  const PALETTE=['#185FA5','#63B841','#D85A30','#7F77DD','#E89A3C','#3BAABF','#A32D2D','#2C7A3A','#8C8C8C'];
  const ICONS={'Door to door':'🚪','Door hanger':'📄','Vehicle / truck wrap':'🚛','Yard sign':'🪧','Word of mouth':'💬','Word of mouth (organic)':'💬','Referral':'🤝','Referral — someone sent them':'🤝','Real estate agent':'🏡','Property manager':'🏢','Builder / contractor':'🔨','Repeat customer':'🔄','Google / online':'🔍','Facebook':'📘','Nextdoor':'🏘️','Instagram':'📸','Craigslist':'📋','Church / community':'⛪','Neighborhood event':'🎪','Other':'📋','No source set':'❓'};

  const sources={};
  clients.forEach(c=>{
    const src=c.source||'No source set';
    if(!sources[src])sources[src]={leads:0,won:0,lost:0,revenue:0,color:''};
    sources[src].leads++;
    const cb=getClientBids(c.id);
    const wonBids=cb.filter(b=>b.status==='Closed Won');
    if(wonBids.length){
      sources[src].won++;
      sources[src].revenue+=wonBids.reduce((s,b)=>s+(b.amount||0),0);
    } else if(cb.some(b=>b.status==='Closed Lost'||b.status==='Abandoned')){
      sources[src].lost++;
    }
  });

  const rows=Object.entries(sources).sort((a,b)=>b[1].revenue-a[1].revenue||b[1].leads-a[1].leads);
  rows.forEach(([src,d],i)=>d.color=PALETTE[i%PALETTE.length]);

  const totalLeads=rows.reduce((s,[,d])=>s+d.leads,0);
  if(!totalLeads){el.innerHTML='<div class="empty">Add a lead source when creating clients to track this.</div>';return;}

  // Aggregate marketing spend by lead source
  const mktCosts={};
  expenses.filter(e=>e.cat==='marketing'&&e.lead_source).forEach(e=>{
    mktCosts[e.lead_source]=(mktCosts[e.lead_source]||0)+e.amount;
  });
  const hasAnyROI=Object.keys(mktCosts).length>0;

  const showAll=window._leadSrcExpanded;
  const visible=showAll?rows:rows.slice(0,6);
  const noSrc=clients.filter(c=>!c.source).length;

  const tbodyRows=visible.map(([src,d])=>{
    const decided=d.won+d.lost;
    const cr=decided>0?Math.round(d.won/decided*100):null;
    const crCls=cr===null?'':cr>=40?' green':cr>=25?'':' red';
    const crStr=cr!==null?cr+'%':'—';
    const cost=mktCosts[src]||0;
    const roi=cost>0&&d.revenue>0?Math.round(d.revenue/cost*10)/10:null;
    const roiStr=roi!==null?(roi+'×'):cost>0?'0×':'—';
    const roiCls=roi===null?'':roi>=3?' green':roi>=1?'':' red';
    return `<tr>
      <td style="font-weight:700">${ICONS[src]||'📋'} ${escHtml(src)}</td>
      <td class="num">${d.leads}</td>
      <td class="num">${d.won}</td>
      <td class="num${crCls}">${crStr}</td>
      <td class="num">${d.revenue>0?fmtShort(d.revenue):'—'}</td>
      ${hasAnyROI?`<td class="num">${cost>0?fmtShort(cost):'—'}</td><td class="num${roiCls}">${roiStr}</td>`:''}
    </tr>`;
  }).join('');

  const toggleBtn=rows.length>6
    ?showAll
      ?`<button onclick="window._leadSrcExpanded=false;renderLeadSources()" style="border:none;background:none;cursor:pointer;font-size:12px;color:var(--text3);padding:8px 0;display:block;width:100%;text-align:center">&#8963; Show less</button>`
      :`<button onclick="window._leadSrcExpanded=true;renderLeadSources()" style="border:none;background:none;cursor:pointer;font-size:12px;color:var(--blue);padding:8px 0;font-weight:700;display:block;width:100%;text-align:center">&#8964; Show all ${rows.length-6} more</button>`
    :'';

  const noSrcNote=noSrc?`<div style="font-size:11px;color:var(--text3);padding:8px 18px 4px">${noSrc} client${noSrc>1?'s':''} with no source set</div>`:'';
  const roiHint=!hasAnyROI?`<div style="font-size:11px;color:var(--text3);padding:6px 18px 10px">💡 Log an <strong>Advertising &amp; marketing</strong> expense to see Cost &amp; ROI columns</div>`:'';

  el.innerHTML=`<div style="overflow-x:auto"><table class="tbl">
    <thead><tr>
      <th>Source</th>
      <th style="text-align:right">Leads</th>
      <th style="text-align:right">Won</th>
      <th style="text-align:right">Close %</th>
      <th style="text-align:right">Revenue</th>
      ${hasAnyROI?'<th style="text-align:right">Cost</th><th style="text-align:right">ROI</th>':''}
    </tr></thead>
    <tbody>${tbodyRows}</tbody>
  </table></div>
  ${toggleBtn}${noSrcNote}${roiHint}`;
}

function closeSourceDetail(){const el=document.getElementById('source-detail');if(el)el.style.display='none';}
function showSourceDetail(src){
  const el=document.getElementById('source-detail');if(!el)return;
  const ICONS={'Door to door':'🚪','Door hanger':'📄','Vehicle / truck wrap':'🚛','Yard sign':'🪧','Word of mouth':'💬','Word of mouth (organic)':'💬','Referral':'🤝','Referral — someone sent them':'🤝','Real estate agent':'🏡','Property manager':'🏢','Builder / contractor':'🔨','Repeat customer':'🔄','Google / online':'🔍','Facebook':'📘','Nextdoor':'🏘️','Instagram':'📸','Craigslist':'📋','Church / community':'⛪','Neighborhood event':'🎪','Other':'📋','No source set':'❓'};
  const srcClients=clients.filter(c=>(c.source||'Unknown')===src);
  let won=0,lost=0,revenue=0,pending=0;
  srcClients.forEach(c=>{
    const cb=getClientBids(c.id);
    const wonBids=cb.filter(b=>b.status==='Closed Won');
    if(wonBids.length){won++;revenue+=wonBids.reduce((s,b)=>s+(b.amount||0),0);}
    else if(cb.some(b=>b.status==='Closed Lost'||b.status==='Abandoned')){lost++;}
    if(cb.some(b=>b.status==='Pending'))pending++;
  });
  const decided=won+lost;
  const cr=decided>0?Math.round(won/decided*100):null;
  const crColor=cr===null?'var(--text3)':cr>=40?'var(--green-mid)':cr>=25?'var(--amber)':'#A32D2D';
  const avgVal=won>0?fmt(Math.round(revenue/won)):'—';
  el.style.display='block';
  el.innerHTML=
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'+
      '<div style="font-size:13px;font-weight:700">'+(ICONS[src]||'📋')+' '+escHtml(src||'')+'</div>'+
      '<button onclick="closeSourceDetail()" style="border:none;background:none;font-size:16px;cursor:pointer;color:var(--text3)">&#10005;</button>'+
    '</div>'+
    '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;text-align:center">'+
      '<div><div style="font-size:20px;font-weight:800">'+srcClients.length+'</div><div style="font-size:10px;color:var(--text3)">Leads</div></div>'+
      '<div><div style="font-size:20px;font-weight:800;color:'+crColor+'">'+(cr!==null?cr+'%':'—')+'</div><div style="font-size:10px;color:var(--text3)">Close rate</div></div>'+
      '<div><div style="font-size:20px;font-weight:800;color:var(--green-mid)">'+(revenue>0?fmt(revenue):'—')+'</div><div style="font-size:10px;color:var(--text3)">Revenue</div></div>'+
      '<div><div style="font-size:20px;font-weight:800">'+avgVal+'</div><div style="font-size:10px;color:var(--text3)">Avg job</div></div>'+
    '</div>'+
    (pending>0?'<div style="font-size:11px;color:var(--amber);margin-top:8px;text-align:center">'+pending+' pending bid'+(pending>1?'s':'')+' — not yet counted in close rate</div>':'');
}
const CLOSE_RATE = 0.60; // 60% industry avg for professional solo painter in Kansas

function renderPipeline(){
  const el=document.getElementById('dash-pipeline');if(!el)return;
  const tk=todayKey();

  function weekMonday(dateStr){
    const d=parseD(dateStr),dow=d.getDay(),diff=dow===0?-6:(1-dow);
    d.setDate(d.getDate()+diff);return dateKey(d);
  }
  function paintDaysInWeek(monday){
    let n=0;
    for(let i=0;i<5;i++){
      const day=addDays(monday,i);
      const hasJob=jobs.some(j=>j.eventType!=='estimate'&&parseInt(j.days)>=1&&(()=>{const d=parseInt(j.days)||1;for(let k=0;k<d;k++)if(addDays(j.start,k)===day)return true;return false;})());
      if(hasJob)n++;
    }
    return n;
  }

  const thisMonday=weekMonday(tk);
  const nextMonday=addDays(thisMonday,7);
  const weekAfterMonday=addDays(thisMonday,14);

  const w1paint=paintDaysInWeek(thisMonday);
  const w2paint=paintDaysInWeek(nextMonday);
  const w3paint=paintDaysInWeek(weekAfterMonday);

  const totalWorkDays=5;
  const openDaysAhead=(totalWorkDays-w2paint)+(totalWorkDays-w3paint);
  const avgJobDays=3;
  const estimatesNeeded=Math.ceil(openDaysAhead/avgJobDays/CLOSE_RATE);

  function weekBar(booked,total,color){
    const filled=Math.round(booked/total*5);
    let bar='';
    for(let i=0;i<5;i++)bar+='<div style="flex:1;height:10px;border-radius:2px;background:'+(i<filled?color:'var(--border)')+';margin:0 1px"></div>';
    return '<div style="display:flex;gap:0;margin-bottom:3px">'+bar+'</div>';
  }

  function statusLabel(booked){
    if(booked>=4)return{t:'Booked',c:'var(--green-mid)'};
    if(booked>=2)return{t:'Partial',c:'var(--amber)'};
    return{t:'Open',c:'var(--red)'};
  }

  const w1s=statusLabel(w1paint),w2s=statusLabel(w2paint),w3s=statusLabel(w3paint);

  let healthColor,healthMsg,action='';
  if(w2paint>=4&&w3paint>=4){
    healthColor='var(--green-mid)';
    healthMsg='Pipeline full — focus on the work.';
  } else if(w2paint>=2||w3paint>=2){
    healthColor='var(--amber)';
    healthMsg='Pipeline needs attention.';
    action=estimatesNeeded>0?'Run <strong>'+estimatesNeeded+' estimate'+(estimatesNeeded>1?'s':'')+' this week</strong> to fill open days.':'';
  } else {
    healthColor='#A32D2D';
    healthMsg='Pipeline is thin — book estimates now.';
    action='You need <strong>'+estimatesNeeded+' estimate'+(estimatesNeeded>1?'s':'')+' this week</strong> to stay booked. Best days: Tuesday + Thursday evening.';
  }

  const w1label=parseD(thisMonday).toLocaleDateString('en-US',{month:'short',day:'numeric'});
  const w2label=parseD(nextMonday).toLocaleDateString('en-US',{month:'short',day:'numeric'});
  const w3label=parseD(weekAfterMonday).toLocaleDateString('en-US',{month:'short',day:'numeric'});

  el.innerHTML=
    '<div style="background:var(--bg);border:1px solid var(--border);border-radius:var(--rl);padding:14px;margin-bottom:10px">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">'+
        '<div style="font-size:13px;font-weight:700;color:var(--text)">Pipeline</div>'+
        '<div style="font-size:11px;font-weight:700;color:'+healthColor+'">'+healthMsg+'</div>'+
      '</div>'+
      '<div style="display:grid;grid-template-columns:60px 1fr auto;gap:6px 10px;align-items:center;margin-bottom:10px">'+
        '<div style="font-size:10px;color:var(--text3)">This week</div>'+
        '<div>'+weekBar(w1paint,5,w1s.c)+'</div>'+
        '<div style="font-size:10px;font-weight:700;color:'+w1s.c+';white-space:nowrap">'+w1paint+'/5 days</div>'+
        '<div style="font-size:10px;color:var(--text3)">'+w2label+'</div>'+
        '<div>'+weekBar(w2paint,5,w2s.c)+'</div>'+
        '<div style="font-size:10px;font-weight:700;color:'+w2s.c+';white-space:nowrap">'+w2paint+'/5 days</div>'+
        '<div style="font-size:10px;color:var(--text3)">'+w3label+'</div>'+
        '<div>'+weekBar(w3paint,5,w3s.c)+'</div>'+
        '<div style="font-size:10px;font-weight:700;color:'+w3s.c+';white-space:nowrap">'+w3paint+'/5 days</div>'+
      '</div>'+
      (action?'<div style="font-size:12px;color:var(--text2);line-height:1.6">'+action+'</div>':'')+
    '</div>';
}
function openIntakeFormModal(){
  const base=typeof _clientBaseUrl==='function'?_clientBaseUrl():window.location.origin+window.location.pathname.split('index.html')[0];
  const url=base+'intake.html';
  const ov=document.createElement('div');ov.className='zmodal-overlay';
  ov.innerHTML='<div class="zmodal" style="max-width:360px">'+
    '<div class="zmodal-title">📋 Client Intake Form</div>'+
    '<div style="font-size:13px;color:var(--text2);margin-bottom:14px;line-height:1.5">Share this link with prospects so they can submit their info before you arrive. New submissions appear automatically at the top of Leads.</div>'+
    '<div style="display:flex;align-items:center;gap:8px;background:var(--bg);border:1px solid var(--border2);border-radius:var(--r);padding:10px 12px;margin-bottom:14px">'+
      '<div style="font-size:12px;color:var(--text3);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml(url)+'</div>'+
      '<button id="_intake-copy-btn" onclick="_copyIntakeUrl(\''+escHtml(url)+'\')" style="flex-shrink:0;padding:6px 12px;border-radius:6px;border:1px solid var(--border2);background:var(--bg2);font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;color:var(--text)">Copy</button>'+
    '</div>'+
    '<div style="display:flex;gap:8px">'+
      '<button onclick="window.open(\''+escHtml(url)+'\',\'_blank\')" class="btn btn-g" style="flex:1">Open form ↗</button>'+
      '<button onclick="this.closest(\'.zmodal-overlay\').remove()" class="btn" style="flex:1">Done</button>'+
    '</div>'+
  '</div>';
  document.body.appendChild(ov);
}
function _copyIntakeUrl(url){
  navigator.clipboard.writeText(url).then(()=>{
    const btn=document.getElementById('_intake-copy-btn');
    if(btn){const orig=btn.textContent;btn.textContent='✓ Copied';setTimeout(()=>{btn.textContent=orig;},1600);}
    if(typeof showToast==='function')showToast('Intake form link copied','📋');
  }).catch(()=>{if(typeof showToast==='function')showToast('Could not copy link','⚠️');});
}
function renderLeadsPage(){
  const el=document.getElementById('leads-list');if(!el)return;
  const LEAD_STAGES=['incomplete','new','est_scheduled','est_ready','bid_out','bid_urgent','abandoned'];
  const filterToStages={
    all:LEAD_STAGES,
    incomplete:['incomplete'],
    new:['new'],
    estimate:['est_scheduled'],
    follow_up:['bid_urgent','abandoned'],
    pending:['est_ready','bid_out']
  };
  const allowed=filterToStages[leadFilter]||LEAD_STAGES;
  const filtered=clients.filter(c=>{
    const s=getClientStage(c.id).stage;
    return allowed.includes(s);
  }).sort((a,b)=>{
    const pa=getClientStage(a.id).priority||9,pb=getClientStage(b.id).priority||9;
    return pa-pb;
  });
  // Update leads badge
  const allLeadClients=clients.filter(c=>LEAD_STAGES.includes(getClientStage(c.id).stage));
  const badge=document.getElementById('nb-leads-badge');
  if(badge){
    const fu=allLeadClients.filter(c=>{const s=getClientStage(c.id);return s.stage==='follow_up'||s.stage==='bid_urgent';});
    badge.textContent=fu.length||'';badge.style.display=fu.length?'':'none';
  }
  // Update tbar eyebrow
  const leadsEyebrow=document.getElementById('leads-tbar-eyebrow');
  if(leadsEyebrow){
    const allLeadCount=clients.filter(c=>LEAD_STAGES.includes(getClientStage(c.id).stage)).length;
    const fuCount=clients.filter(c=>{const s=getClientStage(c.id).stage;return s==='bid_urgent'||s==='abandoned';}).length;
    leadsEyebrow.textContent=allLeadCount+' lead'+(allLeadCount!==1?'s':'')+(fuCount?' · '+fuCount+' need follow-up':'');
  }

  if(!filtered.length){el.innerHTML=_inboundReviewHTML()+'<div class="empty"><div class="em-emoji">🎯</div><h3>No '+( leadFilter==='all'?'active leads':leadFilter.replace('_',' '))+' right now</h3><p>Add a lead above to start tracking prospects.</p></div>';return;}

  const stgBdgMap={
    incomplete:    {cls:'sf-pending', label:'NEEDS SETUP'},
    new:           {cls:'sf-new',     label:'NEW LEAD'},
    est_scheduled: {cls:'sf-upcoming',label:'EST BOOKED'},
    est_ready:     {cls:'sf-deposit', label:'EST READY'},
    bid_out:       {cls:'sf-pending', label:'BID OUT'},
    bid_urgent:    {cls:'sf-overdue', label:'FOLLOW UP'},
    abandoned:     {cls:'sf-done',    label:'COLD'},
  };

  el.innerHTML=_inboundReviewHTML()+filtered.map(c=>{
    const st=getClientStage(c.id);
    const pendBids=getClientBids(c.id).filter(b=>b.status==='Pending');
    const bidAmtDisplay=pendBids.length>1?pendBids.length+' bids out':pendBids.length===1?fmtShort(pendBids[0].amount):'';
    const addrLine=c.addr?c.addr.split(',')[0]:'No address yet';
    const addrColor=c.addr?'':'color:var(--c-amber)';
    const sbdg=stgBdgMap[st.stage]||{cls:'sf-done',label:st.label.toUpperCase()};
    const daysSince=c.created?Math.floor((new Date()-new Date(c.created+'T12:00'))/86400000):0;

    return '<div class="client-card" data-lp-id="'+c.id+'" data-lp-type="lead" data-lp-label="'+escHtml(c.name||'lead')+'" onclick="openClientDetail('+c.id+',\'leads\')" style="margin-bottom:8px">'+
      '<div class="cc-row">'+
        '<div class="cc-l">'+
          '<div class="cc-avatar">'+initials(c.name)+'</div>'+
          '<div style="min-width:0;flex:1">'+
            '<div class="cc-name">'+escHtml(c.name)+'</div>'+
            '<div class="cc-meta" style="'+addrColor+'">'+escHtml(addrLine)+'</div>'+
            '<div class="cc-stats">'+
              (c.source?'<span class="cc-stat">'+escHtml(c.source)+'</span>':'')+
              (bidAmtDisplay?'<span class="cc-stat">'+bidAmtDisplay+'</span>':'')+
            '</div>'+
          '</div>'+
        '</div>'+
        '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">'+
          '<span class="bdg-soft '+sbdg.cls+'">'+sbdg.label+'</span>'+
          (daysSince>0?'<span style="font-size:10px;color:var(--text3);font-weight:600">'+daysSince+'d</span>':'')+
        '</div>'+
      '</div>'+
    '</div>';
  }).join('');
}

// ── Proposals page ───────────────────────────────────────────────────────
function _pfToggleYr(yr){window['_pfYr_'+yr]=window['_pfYr_'+yr]!==true;renderProposalsPage();}
function _pfToggleMo(yr,mo){window['_pfMo_'+yr+'_'+mo]=window['_pfMo_'+yr+'_'+mo]!==true;renderProposalsPage();}

// Standalone bid detail popup — opens from proposals page or anywhere
function openBidDetail(bidId,view){
  view=view||'bid';
  const b=bids.find(x=>x.id===bidId);if(!b)return;
  document.querySelector('[data-bdov]')?.remove();
  const ov=document.createElement('div');
  ov.setAttribute('data-bdov','1');
  ov.style.cssText='position:fixed;inset:0;background:var(--bg);z-index:10001;overflow-y:auto;-webkit-overflow-scrolling:touch';
  const c=getClientById(b.client_id)||{name:b.client_name||b.name||''};
  const dateStr=b.signedAt?new Date(b.signedAt).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}):(b.bid_date||'');
  function _tabBtn(v,label,active){return '<button id="bdd-tab-'+v+'" onclick="_bddView(\''+v+'\')" style="padding:7px 16px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;border:1.5px solid '+(active?'var(--blue)':'var(--border2)')+';background:'+(active?'var(--blue-lt)':'var(--bg)')+';color:'+(active?'var(--blue-dk)':'var(--text2)')+'">'+label+'</button>';}
  ov.innerHTML=
    '<div style="position:sticky;top:0;background:var(--bg);border-bottom:2px solid var(--border);padding:10px 14px;display:flex;align-items:center;gap:10px;z-index:2">'+
      '<button onclick="document.querySelector(\'[data-bdov]\').remove()" style="padding:7px 12px;border-radius:8px;border:1.5px solid var(--border2);background:var(--bg2);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;color:var(--text);white-space:nowrap">✕ Close</button>'+
      '<div id="bdd-tabs" style="display:flex;gap:6px;flex:1;justify-content:center">'+_tabBtn('bid','📋 Our bid',view==='bid')+_tabBtn('proposal','📄 Client view',view==='proposal')+'</div>'+
      '<div style="width:70px"></div>'+
    '</div>'+
    '<div style="padding:14px 16px;background:#1a365d;color:#fff">'+
      '<div style="font-size:12px;opacity:.7;font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">'+escHtml(c.name)+'</div>'+
      '<div style="font-size:17px;font-weight:800">'+escHtml(b.type||b.trade_type||'Proposal')+'</div>'+
      (b.addr?'<div style="font-size:12px;opacity:.7;margin-top:2px">'+escHtml(b.addr)+'</div>':'')+
      '<div style="font-size:12px;opacity:.7;margin-top:4px">'+(dateStr?'Signed '+dateStr+' · ':'')+fmt(b.amount)+'</div>'+
    '</div>'+
    '<div id="bdd-bid-pane" style="padding:16px;max-width:680px;margin:0 auto"></div>'+
    '<div id="bdd-proposal-pane" style="padding:16px;max-width:680px;margin:0 auto;display:none"></div>';
  document.body.appendChild(ov);

  // Bid pane — internal contractor details
  const pays=getBidPayments(bidId);
  const paid=getBidPaid(bidId);
  const PAINT={'std':'Standard (Behr/Valspar)','prem':'Sherwin-Williams Premium','ultra':'SW Emerald Ultra'};
  const COND={'1.0':'Good — minor prep','1.2':'Fair — moderate prep','1.5':'Poor — heavy prep'};
  const surfs=b.surfaces||[];
  const scope=b.scope?Object.entries(b.scope).filter(([,v])=>v).map(([k])=>{const s=typeof SCOPE_ITEMS!=='undefined'?SCOPE_ITEMS.find(x=>x.id===k):null;return s?s.label:k;}):[];
  const SURF={'walls':'Walls','ceiling':'Ceiling','trim':'Trim','doors':'Doors','windows':'Windows','cabinets':'Cabinets','ext_walls':'Siding','ext_trim':'Ext trim','deck':'Deck','fence':'Fence','epoxy':'Epoxy floor'};
  let bidHTML='';
  if(b.geiLines&&b.geiLines.length){
    bidHTML+='<div class="card" style="margin-bottom:12px"><div style="font-size:11px;font-weight:800;text-transform:uppercase;color:var(--text3);margin-bottom:10px">Line items</div>'+
      b.geiLines.map(l=>'<div style="display:flex;justify-content:space-between;align-items:baseline;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px"><span style="flex:1;padding-right:12px">'+escHtml(l.desc||l.name||'')+'</span><span style="font-weight:700;color:var(--green-mid);white-space:nowrap">'+fmt(l.total||l.amount||0)+'</span></div>').join('')+
      '<div style="display:flex;justify-content:space-between;padding:10px 0 0;font-size:15px;font-weight:800"><span>Total</span><span style="color:var(--green-mid)">'+fmt(b.amount)+'</span></div>'+
    '</div>';
  }else if(surfs.length){
    bidHTML+='<div class="card" style="margin-bottom:12px"><div style="font-size:11px;font-weight:800;text-transform:uppercase;color:var(--text3);margin-bottom:10px">Surfaces</div>'+
      surfs.map(s=>'<div style="display:flex;justify-content:space-between;font-size:13px;padding:5px 0;border-bottom:1px solid var(--border)"><span>'+(SURF[s.type]||s.type)+(s.room?' · '+escHtml(s.room):'')+'</span><span style="color:var(--text2)">'+((s.qty||s.sqft||0)+' '+(s.unit||'sqft'))+'</span></div>').join('')+
    '</div>';
    if(b.paint||b.condition)bidHTML+='<div class="card" style="margin-bottom:12px"><div style="font-size:12px;color:var(--text2);margin-bottom:6px"><strong>Paint:</strong> '+(PAINT[b.paint]||b.paint||'—')+'</div><div style="font-size:12px;color:var(--text2)"><strong>Condition:</strong> '+(COND[b.condition]||b.condition||'—')+'</div></div>';
    if(scope.length)bidHTML+='<div class="card" style="margin-bottom:12px"><div style="font-size:11px;font-weight:800;text-transform:uppercase;color:var(--text3);margin-bottom:8px">Scope of work</div>'+scope.map(s=>'<div style="font-size:13px;padding:4px 0;border-bottom:1px solid var(--border)">'+escHtml(s)+'</div>').join('')+'</div>';
  }else{
    bidHTML+='<div class="card" style="margin-bottom:12px"><div style="font-size:13px;color:var(--text3);text-align:center;padding:12px 0;font-style:italic">No line items or surfaces stored for this bid.</div></div>';
  }
  if(b.notes)bidHTML+='<div class="card" style="margin-bottom:12px"><div style="font-size:11px;font-weight:800;text-transform:uppercase;color:var(--text3);margin-bottom:6px">Notes</div><div style="font-size:13px;color:var(--text2);line-height:1.6">'+escHtml(b.notes)+'</div></div>';
  if(pays.length){
    bidHTML+='<div class="card" style="margin-bottom:12px"><div style="font-size:11px;font-weight:800;text-transform:uppercase;color:var(--text3);margin-bottom:8px">Payment history</div>'+
      pays.map(p=>{const ref=p.type==='refund';return '<div style="display:flex;justify-content:space-between;font-size:12px;padding:5px 0;border-bottom:1px solid var(--border)"><span style="color:var(--text2)">'+p.date+' · '+(ref?'REFUND':escHtml(p.method||p.type||'')+(p.ref?' #'+escHtml(p.ref):''))+'</span><span style="font-weight:700;color:'+(ref?'#A32D2D':'var(--green-mid)')+'">'+( ref?'↩ -':'+' )+fmt(Math.abs(p.amount))+'</span></div>';}).join('')+
      '<div style="display:flex;justify-content:space-between;font-size:14px;font-weight:800;padding:8px 0 0"><span>Total paid</span><span style="color:var(--green-mid)">'+fmt(paid)+'</span></div>'+
    '</div>';
  }
  // Change order history
  const _bidCOsHistory=b.changeOrders||[];
  if(_bidCOsHistory.length){
    bidHTML+='<div class="card" style="margin-bottom:12px"><div style="font-size:11px;font-weight:800;text-transform:uppercase;color:var(--text3);margin-bottom:8px">Change Orders</div>'+
      _bidCOsHistory.map(co=>{
        const _signed=!!co.signedAt;
        const _delta=(co.type==='sub'?'−':'+')+fmt(co.amount);
        const _color=co.type==='sub'?'#A32D2D':'var(--green-mid)';
        return '<div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;padding:7px 0;border-bottom:1px solid var(--border)">'+
          '<div><span style="font-weight:700;background:var(--border2);padding:1px 7px;border-radius:10px;font-size:10px;margin-right:6px">CO #'+co.coNum+'</span>'+escHtml(co.desc||'')+'</div>'+
          '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0">'+
            '<span style="font-weight:700;color:'+_color+'">'+_delta+'</span>'+
            '<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;background:'+(_signed?'#D1FAE5':'#FEF3C7')+';color:'+(_signed?'#065F46':'#92400E')+'">'+(_signed?'Signed':'Pending')+'</span>'+
          '</div>'+
        '</div>';
      }).join('')+
    '</div>';
  }
  // Close-out controls — only for sent estimates that never closed.
  const _isLost=b.status==='Closed Lost'||b.status==='Abandoned';
  const _isWon=b.status==='Closed Won';
  if(_isLost){
    const _lostDate=b.lostAt?new Date(b.lostAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'';
    bidHTML+='<div class="card" style="margin-bottom:12px;border:1px solid #F0C9C9;background:#FEF2F2">'+
      '<div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#A32D2D;margin-bottom:6px">Closed — lost</div>'+
      '<div style="font-size:13px;color:var(--text2);line-height:1.6">'+escHtml(b.lostReason||'Marked lost')+(_lostDate?' · '+_lostDate:'')+'</div>'+
      (b.lostNote?'<div style="font-size:12px;color:var(--text3);line-height:1.6;margin-top:4px;font-style:italic">“'+escHtml(b.lostNote)+'”</div>':'')+
      '<button onclick="reopenEstimate('+bidId+')" class="btn btn-sm" style="margin-top:10px;font-size:12px;font-weight:700">↩ Reopen estimate</button>'+
    '</div>';
  }else if(b.signingToken&&!_isWon&&!b.clientCancelled){
    bidHTML+='<div class="card" style="margin-bottom:12px">'+
      '<div style="font-size:11px;font-weight:800;text-transform:uppercase;color:var(--text3);margin-bottom:6px">Didn’t close?</div>'+
      '<div style="font-size:12px;color:var(--text3);line-height:1.6;margin-bottom:10px">If this estimate won’t move forward, close it out so it stops sitting in “Awaiting signature.”</div>'+
      '<button onclick="openCloseOutEstimate('+bidId+')" class="btn btn-sm" style="font-size:12px;font-weight:700;color:#A32D2D;border-color:#E5B5B5;background:#FEF2F2">Close out — mark as lost</button>'+
    '</div>';
  }
  bidHTML+='<div style="height:24px"></div>';
  document.getElementById('bdd-bid-pane').innerHTML=bidHTML||'<div style="padding:20px;text-align:center;color:var(--text3)">No details stored.</div>';

  // Proposal pane — what the client received
  const propPane=document.getElementById('bdd-proposal-pane');
  const storageKey=b.signingKey||b.proposalKey||null;
  function _sigBadge(){
    if(!b.signedAt)return '';
    return '<div style="background:#D1FAE5;border:1px solid #6EE7B7;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:12px;color:#065F46;display:flex;align-items:center;gap:8px"><span style="font-size:16px">✓</span><span><strong>Signed</strong> '+new Date(b.signedAt).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})+(b.signedName?' by '+escHtml(b.signedName):'')+'</span></div>';
  }
  function _sigFooter(sigUrl){
    if(!b.signedAt||!sigUrl)return '';
    const sigDate=new Date(b.signedAt);
    const dateStr=sigDate.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});
    const timeStr=sigDate.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true});
    return '<div style="margin-top:20px;padding:16px 18px;border-top:2px solid #e2e8f0;background:#f8fafc">'+
      '<div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;margin-bottom:10px">Client Signature</div>'+
      '<img src="'+sigUrl+'" alt="Client signature" style="display:block;max-width:240px;height:auto;border:1px solid #e2e8f0;border-radius:4px;background:#fff;margin-bottom:10px">'+
      '<div style="font-size:13px;font-weight:700;color:#1a365d">'+(b.signedName?escHtml(b.signedName):'')+'</div>'+
      '<div style="font-size:11px;color:#64748b;margin-top:2px">Signed '+dateStr+' at '+timeStr+'</div>'+
      '</div>';
  }
  function _renderPropHTML(html,extraTop){
    propPane.innerHTML=(extraTop||'')+_sigBadge()+html+_sigFooter(b.signatureDataUrl||'');
  }
  if(b.proposalHtml){
    _renderPropHTML(b.proposalHtml);
    // Background-fetch signature image if not yet cached
    if(b.signedAt&&b.signatureDataUrl===undefined&&storageKey&&typeof _supa!=='undefined'){
      _supa.storage.from('proposals').download(storageKey).then(({data})=>{
        if(!data)return;
        data.text().then(txt=>{try{const p=JSON.parse(txt);b.signatureDataUrl=p.signatureDataUrl||'';_renderPropHTML(b.proposalHtml);}catch(e){}});
      }).catch(()=>{});
    }
  }else if(storageKey&&typeof _supa!=='undefined'){
    propPane.innerHTML='<div style="padding:40px 16px;text-align:center;color:var(--text3);font-size:13px">Loading proposal…</div>';
    _supa.storage.from('proposals').download(storageKey).then(({data,error})=>{
      if(error||!data){propPane.innerHTML='<div style="padding:40px 16px;text-align:center;color:var(--text3);font-size:13px;font-style:italic">Could not load proposal from storage.</div>';return;}
      data.text().then(txt=>{
        try{
          const prop=JSON.parse(txt);
          const html=prop.proposalHtml||'';
          if(!html){propPane.innerHTML='<div style="padding:40px;text-align:center;color:var(--text3);font-style:italic">No HTML found in stored proposal.</div>';return;}
          // Cache on bid so future opens are instant
          b.proposalHtml=html;
          b.signatureDataUrl=prop.signatureDataUrl||'';
          let colorTop='';
          const choices=prop.colorChoices||[];
          if(choices.length)colorTop='<div style="background:#EFF6FF;border:1.5px solid #BFDBFE;border-radius:10px;padding:14px 16px;margin-bottom:16px"><div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#1E40AF;margin-bottom:10px">🎨 Client Color Selections</div>'+choices.map(ch=>'<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #DBEAFE;font-size:13px"><span style="font-weight:600;color:#1E3A5F">'+escHtml(ch.room)+'</span><span style="color:#1E40AF;font-weight:700">'+escHtml(ch.colorName)+(ch.swCode?' <span style="font-size:11px;opacity:.7">('+escHtml(ch.swCode)+')</span>':'')+'</span></div>').join('')+'</div>';
          _renderPropHTML(html,colorTop);
        }catch(e){propPane.innerHTML='<div style="padding:40px;text-align:center;color:var(--text3);font-style:italic">Error parsing proposal.</div>';}
      });
    }).catch(()=>{propPane.innerHTML='<div style="padding:40px 16px;text-align:center;color:var(--text3);font-size:13px;font-style:italic">Could not load proposal.</div>';});
  }else{
    propPane.innerHTML='<div style="padding:40px 16px;text-align:center;color:var(--text3);font-size:14px;font-style:italic">No proposal on file for this bid.</div>';
  }
  _bddView(view);
}
function _bddView(v){
  ['bid','proposal'].forEach(x=>{
    const pane=document.getElementById('bdd-'+x+'-pane');
    const tab=document.getElementById('bdd-tab-'+x);
    if(pane)pane.style.display=x===v?'':'none';
    if(tab){const a=x===v;tab.style.borderColor=a?'var(--blue)':'var(--border2)';tab.style.background=a?'var(--blue-lt)':'var(--bg)';tab.style.color=a?'var(--blue-dk)':'var(--text2)';}
  });
}

let _proposalFilter='all';
function setProposalFilter(f,btn){
  _proposalFilter=f;
  document.querySelectorAll('#pg-proposals .fb').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  renderProposalsPage();
}
function renderProposalsPage(){
  const allBids=bids.filter(b=>b.id);
  const sentBids=allBids.filter(b=>b.signingToken);
  const draftBids=allBids.filter(b=>!b.signingToken&&(b.draft||b.status==='Draft'||b.status==='Pending'));
  const signed=sentBids.filter(b=>b.status==='Closed Won');
  const awaiting=sentBids.filter(b=>b.status==='Pending'||b.status==='Draft');
  const declined=sentBids.filter(b=>b.status==='Closed Lost'||b.status==='Abandoned');
  const counts={all:allBids.length,draft:draftBids.length,awaiting_sig:awaiting.length,signed:signed.length,declined:declined.length};
  ['all','draft','awaiting_sig','signed','declined'].forEach(k=>{
    const el=document.getElementById('pft-c-'+k);
    if(el){el.textContent=counts[k]||'';el.style.display=counts[k]?'':'none';}
  });
  const closeRate=sentBids.length?Math.round(signed.length/sentBids.length*100):0;
  const eyebrow=document.getElementById('proposals-eyebrow');
  if(eyebrow)eyebrow.textContent=sentBids.length+' sent · '+closeRate+'% close rate';
  const totalSent=sentBids.reduce((s,b)=>s+(b.amount||0),0);
  const signedAmt=signed.reduce((s,b)=>s+(b.amount||0),0);
  const awaitingAmt=awaiting.reduce((s,b)=>s+(b.amount||0),0);
  const mets=document.getElementById('proposals-mets');
  if(mets)mets.innerHTML=
    '<div class="met"><div class="met-l">Sent</div><div class="met-v">'+fmt(totalSent)+'</div><div class="met-s">'+sentBids.length+' proposals</div></div>'+
    '<div class="met"><div class="met-l">Signed</div><div class="met-v" style="color:var(--green)">'+fmt(signedAmt)+'</div><div class="met-s up">'+signed.length+' clients</div></div>'+
    '<div class="met"><div class="met-l">Awaiting sig</div><div class="met-v" style="color:var(--amber)">'+fmt(awaitingAmt)+'</div><div class="met-s">'+awaiting.length+' clients</div></div>'+
    '<div class="met"><div class="met-l">Close rate</div><div class="met-v">'+closeRate+'<span class="unit">%</span></div><div class="met-s">of sent</div></div>';
  const f=_proposalFilter;
  const filtered=f==='all'?allBids:f==='draft'?draftBids:f==='signed'?signed:f==='awaiting_sig'?awaiting:declined;
  const list=document.getElementById('proposals-list');
  if(!list)return;
  if(!filtered.length){
    list.innerHTML='<div class="empty"><div class="em-emoji">📨</div><h3>Nothing here</h3><p>Try a different filter, or start a new estimate from a client card.</p></div>';
    return;
  }

  // Signed tab — year/month accordion with proposal detail cards
  if(f==='signed'){
    const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
    const SHORT_MO=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const byYear={};
    const sortedSigned=[...filtered].map(b=>{
      const dk=b.signedAt?new Date(b.signedAt).toISOString().slice(0,10):(b.completion_date||b.bid_date||'');
      return {...b,_dk:dk};
    }).sort((a,b)=>b._dk.localeCompare(a._dk));
    sortedSigned.forEach(b=>{
      const yr=b._dk.slice(0,4)||'—';
      const mo=b._dk.slice(0,7)||'—';
      if(!byYear[yr])byYear[yr]={};
      if(!byYear[yr][mo])byYear[yr][mo]=[];
      byYear[yr][mo].push(b);
    });
    const years=Object.keys(byYear).sort((a,b)=>b.localeCompare(a));
    if(years.length){
      const ry=years[0];
      if(window['_pfYr_'+ry]===undefined)window['_pfYr_'+ry]=true;
      const rmos=Object.keys(byYear[ry]).sort((a,b)=>b.localeCompare(a));
      if(rmos.length&&window['_pfMo_'+ry+'_'+rmos[0]]===undefined)window['_pfMo_'+ry+'_'+rmos[0]]=true;
    }
    function _pfCard(b){
      const c=getClientById(b.client_id)||{name:b.client_name||b.name||'Unknown'};
      const dateStr=b.signedAt?new Date(b.signedAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):(b._dk||'');
      const proj=b.addr||b.type||b.trade_type||'Proposal';
      return '<div class="card" style="margin:0 0 10px;border-radius:12px">'+
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">'+
          '<div style="flex:1;min-width:0">'+
            '<div style="font-size:15px;font-weight:800">'+escHtml(c.name)+'</div>'+
            '<div style="font-size:11px;color:var(--text3);margin-top:2px">'+escHtml((proj+'').split(',')[0])+'</div>'+
            '<div style="font-size:11px;color:var(--green-mid);font-weight:600;margin-top:3px">✓ Signed '+dateStr+(b.signedName?' · '+escHtml(b.signedName):'')+'</div>'+
          '</div>'+
          '<div style="font-size:18px;font-weight:800;color:var(--green-mid);margin-left:12px;flex-shrink:0">'+fmt(b.amount)+'</div>'+
        '</div>'+
        '<div style="display:flex;gap:8px">'+
          '<button onclick="openBidDetail('+b.id+',\'bid\')" class="btn btn-sm" style="flex:1;justify-content:center;font-size:12px;font-weight:700">📋 Our bid</button>'+
          (b.proposalHtml?'<button onclick="openBidDetail('+b.id+',\'proposal\')" class="btn btn-sm" style="flex:1;justify-content:center;font-size:12px;font-weight:700;background:var(--blue-lt);color:var(--blue-dk);border-color:var(--blue)">📄 Client view</button>':'<span style="flex:1;font-size:11px;color:var(--text3);display:flex;align-items:center;justify-content:center;font-style:italic">No proposal saved</span>')+
        '</div>'+
      '</div>';
    }
    const accHTML=years.map(yr=>{
      const yrOpen=window['_pfYr_'+yr]===true;
      const yrBids=Object.values(byYear[yr]).flat();
      const months=Object.keys(byYear[yr]).sort((a,b)=>b.localeCompare(a));
      const moHTML=yrOpen?months.map(mo=>{
        const moOpen=window['_pfMo_'+yr+'_'+mo]===true;
        const moBids=byYear[yr][mo];
        const moIdx=parseInt(mo.slice(5))-1;
        return '<div style="border-top:1px solid var(--border)">'+
          '<div onclick="_pfToggleMo(\''+yr+'\',\''+mo+'\')" style="display:flex;align-items:center;gap:8px;padding:10px 16px 10px 28px;cursor:pointer;-webkit-user-select:none;user-select:none">'+
            '<span style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;flex:1;color:var(--text2)">'+SHORT_MO[moIdx]+'</span>'+
            '<span style="font-size:11px;font-weight:700;background:var(--border2);border-radius:10px;padding:1px 8px;color:var(--text2)">'+moBids.length+'</span>'+
            '<span style="font-size:13px;color:var(--text3);width:14px;text-align:center">'+(moOpen?'⌄':'›')+'</span>'+
          '</div>'+
          (moOpen?'<div style="padding:4px 14px 14px">'+moBids.map(_pfCard).join('')+'</div>':'')+
        '</div>';
      }).join(''):'';
      return '<div style="border-top:1px solid var(--line);background:var(--bg)">'+
        '<div onclick="_pfToggleYr(\''+yr+'\')" style="display:flex;align-items:center;gap:10px;padding:14px 16px;cursor:pointer;-webkit-user-select:none;user-select:none;background:var(--cream)">'+
          '<span style="font-size:16px;font-weight:800;flex:1">'+yr+'</span>'+
          '<span style="font-size:12px;font-weight:700;background:var(--border2);border-radius:10px;padding:2px 10px;color:var(--text2)">'+yrBids.length+' proposal'+(yrBids.length!==1?'s':'')+'</span>'+
          '<span style="font-size:14px;color:var(--text3);width:14px;text-align:center">'+(yrOpen?'⌄':'›')+'</span>'+
        '</div>'+moHTML+'</div>';
    }).join('');
    list.innerHTML=accHTML||'<div class="empty">No signed proposals.</div>';
    return;
  }

  // All other tabs — flat table
  const statusChip=b=>{
    if(b.clientCancelled)return '<span class="bdg-soft sf-lost">🚫 CLIENT CANCELLED</span>';
    if(b.status==='Closed Won')return '<span class="bdg-soft sf-won">SIGNED</span>';
    if(b.status==='Closed Lost'||b.status==='Abandoned')return '<span class="bdg-soft sf-lost">DECLINED</span>';
    if(b.draft||b.status==='Draft')return '<span class="bdg-soft sf-done">DRAFT</span>';
    if(b.signingToken)return '<span class="bdg-soft sf-pending">AWAITING SIG</span>';
    return '<span class="bdg-soft sf-done">PENDING</span>';
  };
  const typeChip=b=>{
    if(b.isTM)return '<span style="font-size:9px;color:var(--text3);font-weight:700">⏱️ T&M · </span>';
    if(b.geiLines!==undefined)return '<span style="font-size:9px;color:var(--text3);font-weight:700">BYO · </span>';
    return '';
  };
  const rows=filtered.map(b=>{
    const c=getClientById(b.client_id)||{name:b.client_name||b.name||'Unknown'};
    const proj=b.addr||b.type||'—';
    const _depPaid=getBidPaid(b.id);const deposit=b.status==='Closed Won'&&(b.deposit||0)>0.01&&_depPaid>=(b.deposit-0.01)?'<div style="font-size:10px;color:var(--green);font-weight:700;margin-top:2px">Deposit '+fmt(b.deposit)+' received</div>':'';
    const _lostLine=(b.status==='Closed Lost'&&b.lostReason)?'<div style="font-size:10px;color:#A32D2D;font-weight:600;margin-top:2px">'+escHtml(b.lostReason)+'</div>':'';
    const amt=b.isTM&&b.tmNteCap?'~'+fmt(b.amount)+' NTE '+fmt(b.tmNteCap):(b.amount?fmt(b.amount):'—');
    const revFn=(b.status==='Closed Won'||b.clientCancelled)?'openBidDetail('+b.id+',\'bid\')':(b.geiLines!==undefined?'openGenericEstimate(getClientById('+b.client_id+'),'+b.id+',\''+escHtml(b.trade_type||'general')+'\')':'openEditBid('+b.id+')');
    // Sent estimate that hasn't closed → offer a one-tap close-out.
    const _canCloseOut=b.signingToken&&b.status!=='Closed Won'&&b.status!=='Closed Lost'&&b.status!=='Abandoned'&&!b.clientCancelled;
    const _coBtn=_canCloseOut?'<button class="btn btn-sm" onclick="event.stopPropagation();openCloseOutEstimate('+b.id+')" style="font-size:11px;font-weight:700;color:#A32D2D;border-color:#E5B5B5;background:#FEF2F2;margin-right:6px">Close out</button>':'';
    return '<tr style="cursor:pointer" onclick="'+revFn+'">'+
      '<td><div style="font-weight:800">'+escHtml(c.name)+'</div>'+
      '<div style="font-size:10px;color:var(--text3);font-weight:500;margin-top:2px">'+typeChip(b)+escHtml((proj+'').split(',')[0])+'</div>'+deposit+_lostLine+'</td>'+
      '<td>'+statusChip(b)+'</td>'+
      '<td class="muted">'+escHtml(b.bid_date||'')+'</td>'+
      '<td class="num">'+amt+'</td>'+
      '<td style="text-align:right;white-space:nowrap">'+_coBtn+'<button class="btn btn-sm btn-p" onclick="event.stopPropagation();'+revFn+'">Open →</button></td>'+
      '</tr>';
  }).join('');
  list.innerHTML='<div class="card card-pad-0" style="overflow:hidden">'+
    '<div class="card-hd"><div class="card-hd-title">Proposals</div></div>'+
    '<table class="tbl"><thead><tr><th>Client &amp; project</th><th>Status</th><th>Date</th><th class="num">Amount</th><th></th></tr></thead>'+
    '<tbody>'+rows+'</tbody></table></div>';
}

// ── Estimates page ────────────────────────────────────────────────────────
let _estFilter='all';
function setEstFilter(f,btn){
  _estFilter=f;
  document.querySelectorAll('#pg-estimates .fb').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  renderEstimatesPage();
}
function renderEstimatesPage(){
  const allBids=bids.filter(b=>b.id);
  const _bidType=b=>b.isTM?'tm':(b.geiLines!==undefined?'freeform':'scope');
  const f=_estFilter;
  let filtered;
  if(f==='all')filtered=allBids;
  else if(f==='draft')filtered=allBids.filter(b=>b.draft||b.status==='Draft');
  else filtered=allBids.filter(b=>_bidType(b)===f);
  const total=allBids.length;
  const drafts=allBids.filter(b=>b.draft||b.status==='Draft').length;
  const awaiting=allBids.filter(b=>b.signingToken&&b.status==='Pending').length;
  const eyebrow=document.getElementById('estimates-eyebrow');
  if(eyebrow)eyebrow.textContent=total+' estimates · '+drafts+' draft'+(drafts===1?'':'s')+' · '+awaiting+' awaiting sig';
  const hd=document.getElementById('estimates-hd-title');
  if(hd)hd.textContent=f==='all'?'All estimates':f==='tm'?'Time & Materials':f==='freeform'?'Build Your Own':f==='draft'?'Drafts':'Scope & Price';
  const wrap=document.getElementById('estimates-tbl-wrap');
  const empty=document.getElementById('estimates-empty');
  if(!wrap)return;
  if(!filtered.length){wrap.innerHTML='';if(empty)empty.style.display='';return;}
  if(empty)empty.style.display='none';
  const typeChip=b=>{
    if(b.isTM)return '<span class="bdg-soft sf-pending">T&amp;M</span>';
    if(b.geiLines!==undefined)return '<span class="bdg-soft sf-active">Build Your Own</span>';
    return '<span class="bdg-soft sf-deposit">Scope &amp; Price</span>';
  };
  const statusChip=b=>{
    if(b.clientCancelled)return '<span class="bdg-soft sf-lost">🚫 CLIENT CANCELLED</span>';
    if(b.status==='Closed Won')return '<span class="bdg-soft sf-won">SIGNED</span>';
    if(b.status==='Closed Lost'||b.status==='Abandoned')return '<span class="bdg-soft sf-lost">DECLINED</span>';
    if(b.draft||b.status==='Draft')return '<span class="bdg-soft sf-done">DRAFT</span>';
    if(b.signingToken)return '<span class="bdg-soft sf-pending">AWAITING SIG</span>';
    return '<span class="bdg-soft sf-done">PENDING</span>';
  };
  const rows=filtered.map(b=>{
    const c=getClientById(b.client_id)||{name:b.client_name||b.name||'Unknown'};
    const proj=b.addr||b.type||'—';
    const amt=b.isTM&&b.tmNteCap?'~'+fmt(b.amount)+' / NTE '+fmt(b.tmNteCap):(b.amount?fmt(b.amount):'—');
    const revFn=b.geiLines!==undefined?'openGenericEstimate(getClientById('+b.client_id+'),'+b.id+',\''+escHtml(b.trade_type||'general')+'\')'  :'openEditBid('+b.id+')';
    return '<tr style="cursor:pointer" onclick="'+revFn+'">'+
      '<td><div style="font-weight:800">'+escHtml(c.name)+'</div>'+
      '<div style="font-size:10px;color:var(--text3);font-weight:500;margin-top:2px">'+escHtml((proj+'').split(',')[0])+'</div></td>'+
      '<td>'+typeChip(b)+'</td>'+
      '<td>'+statusChip(b)+'</td>'+
      '<td class="muted">'+escHtml(b.bid_date||'')+'</td>'+
      '<td class="num">'+amt+'</td>'+
      '<td style="text-align:right"><button class="btn btn-sm btn-p" onclick="event.stopPropagation();'+revFn+'">Open →</button></td>'+
      '</tr>';
  }).join('');
  wrap.innerHTML='<table class="tbl"><thead><tr><th>Client &amp; project</th><th>Type</th><th>Status</th><th>Date</th><th class="num">Amount</th><th></th></tr></thead><tbody>'+rows+'</tbody></table>';
}

// ── Dashboard widget drag-to-reorder ──────────────────────────────────────
const _DASH_DEFAULT_ORDER = ['kpi','pipeline','feed','quick','calendar','sources'];

function _getDashWidgetOrder() {
  const saved = S.dashWidgetOrder;
  if (Array.isArray(saved) && saved.length >= 3) return saved;
  return _DASH_DEFAULT_ORDER.slice();
}

function _applyDashOrder(order) {
  const root = document.getElementById('dash-widget-root');
  if (!root) return;
  order.forEach(id => {
    const el = root.querySelector(`.td-dw[data-dw="${id}"]`);
    if (el) root.appendChild(el);
  });
  // Append any widgets not present in a saved order (e.g. new widgets added in
  // an app update) in their default position so they never get orphaned.
  _DASH_DEFAULT_ORDER.forEach(id => {
    if (order.includes(id)) return;
    const el = root.querySelector(`.td-dw[data-dw="${id}"]`);
    if (el) root.appendChild(el);
  });
}

let _dashSortActive = false;

function _initDashDrag() {
  const root = document.getElementById('dash-widget-root');
  if (!root || _dashSortActive) return;

  // Apply saved order
  _applyDashOrder(_getDashWidgetOrder());

  let editMode = false, lpTimer = null;
  let dragEl = null, ghost = null, placeholder = null, doneBtn = null;
  let offX = 0, offY = 0;

  function getWidgets() {
    return [...root.querySelectorAll(':scope>.td-dw')];
  }

  // While editing, swallow any click inside the dashboard so widgets can't be
  // opened/navigated — only the Done button (outside root) stays live.
  function _swallowClick(e) { if (editMode) { e.preventDefault(); e.stopPropagation(); } }

  function enter() {
    if (editMode) return;
    editMode = true;
    navigator.vibrate?.(45);
    root.classList.add('td-drag-active');
    root.addEventListener('click', _swallowClick, true);
    doneBtn = document.createElement('button');
    doneBtn.className = 'td-sort-done-btn';
    doneBtn.textContent = 'Done';
    doneBtn.addEventListener('click', exit);
    document.body.appendChild(doneBtn);
  }

  function exit() {
    editMode = false;
    root.classList.remove('td-drag-active');
    root.removeEventListener('click', _swallowClick, true);
    document.body.classList.remove('td-pressing');
    doneBtn?.remove(); doneBtn = null;
    ghost?.remove(); ghost = null;
    placeholder?.remove(); placeholder = null;
    if (dragEl) { dragEl.style.cssText = ''; dragEl = null; }
    // Save new order to the per-individual-user prefs store (keyed by auth.uid),
    // NOT the shared business settings blob — so each person's layout is isolated.
    const newOrder = getWidgets().map(el => el.dataset.dw);
    S.dashWidgetOrder = newOrder;
    if (typeof _saveUserPrefs === 'function') _saveUserPrefs();
    showToast('Dashboard layout saved', '✓');
  }

  // Long press on the dashboard page (not on buttons)
  let _pressX = 0, _pressY = 0;
  root.addEventListener('pointerdown', e => {
    // Don't trigger on interactive elements
    if (e.target.closest('button,a,input,select,textarea,[onclick]')) return;
    const widget = e.target.closest('.td-dw');
    if (!widget) return;
    if (editMode) { document.body.classList.add('td-pressing'); startDrag(e, widget); return; }
    _pressX = e.clientX; _pressY = e.clientY;
    document.body.classList.add('td-pressing'); // kill iOS text-selection during the hold
    lpTimer = setTimeout(enter, 450);
  }, { passive: true });

  function clearLp() {
    clearTimeout(lpTimer); lpTimer = null;
    if (!editMode) document.body.classList.remove('td-pressing');
  }
  // Only cancel the long-press if the finger travels past a tolerance — small jitter is fine
  root.addEventListener('pointermove', e => {
    if (lpTimer == null) return;
    if (Math.hypot(e.clientX - _pressX, e.clientY - _pressY) > 12) clearLp();
  }, { passive: true });
  root.addEventListener('pointerup', clearLp, { passive: true });
  root.addEventListener('pointercancel', clearLp, { passive: true });

  function startDrag(e, el) {
    dragEl = el;
    const rect = el.getBoundingClientRect();
    offX = e.clientX - rect.left;
    offY = e.clientY - rect.top;

    ghost = el.cloneNode(true);
    ghost.removeAttribute('id');
    ghost.className = 'td-dw td-drag-ghost';
    ghost.style.cssText = `width:${rect.width}px;left:${rect.left}px;top:${rect.top}px;background:var(--bg-card)`;
    document.body.appendChild(ghost);

    placeholder = document.createElement('div');
    placeholder.className = 'td-drag-placeholder';
    placeholder.style.height = rect.height + 'px';
    el.replaceWith(placeholder);
    el.style.display = 'none';

    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', onDrop, { once: true });
    document.addEventListener('pointercancel', onDrop, { once: true });
  }

  function onMove(e) {
    if (!ghost || !dragEl) return;
    e.preventDefault();
    ghost.style.left = (e.clientX - offX) + 'px';
    ghost.style.top = (e.clientY - offY) + 'px';
    // Find insertion point (vertical axis)
    const widgets = getWidgets();
    let before = null;
    for (const w of widgets) {
      if (w === dragEl) continue;
      const r = w.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) { before = w; break; }
    }
    if (before) root.insertBefore(placeholder, before);
    else root.appendChild(placeholder);
  }

  function onDrop() {
    document.removeEventListener('pointermove', onMove);
    document.body.classList.remove('td-pressing');
    if (!dragEl || !placeholder) return;
    dragEl.style.display = '';
    placeholder.replaceWith(dragEl);
    ghost?.remove(); ghost = null;
    placeholder = null; dragEl = null;
  }

  _dashSortActive = true;
}

// ── Dashboard KPI tile drag-to-reorder (grid-aware) ───────────────────────
const _DASH_KPI_DEFAULT = ['revenue','expenses','mileage','taxes','profit','avgjob'];

function _getKpiOrder() {
  const saved = S.dashKpiOrder;
  if (Array.isArray(saved) && saved.length && saved.every(id => _DASH_KPI_DEFAULT.includes(id))) return saved;
  return _DASH_KPI_DEFAULT.slice();
}

function _applyKpiOrder() {
  const cont = document.getElementById('dash-mets-inner');
  if (!cont) return;
  const order = _getKpiOrder();
  order.forEach(id => {
    const el = cont.querySelector(`.met[data-kpi="${id}"]`);
    if (el) cont.appendChild(el);
  });
  // Append any tile not in the saved order (e.g. a new tile in a future update)
  // in its default position so it never gets orphaned.
  _DASH_KPI_DEFAULT.forEach(id => {
    if (order.includes(id)) return;
    const el = cont.querySelector(`.met[data-kpi="${id}"]`);
    if (el) cont.appendChild(el);
  });
}

let _kpiSortActive = false;

function _initKpiDrag() {
  const cont = document.getElementById('dash-mets-inner');
  if (!cont) return; // employee daily view has no KPI grid — no-op
  // The grid is rebuilt every renderDash(), so the element identity changes.
  // Bind to whichever container is live now, flagged on the element itself so
  // the same node is never double-bound.
  if (cont._kpiDragBound) return;
  cont._kpiDragBound = true;

  let editMode = false, lpTimer = null;
  let dragEl = null, ghost = null, placeholder = null, doneBtn = null;
  let offX = 0, offY = 0;

  function getTiles() {
    return [...cont.querySelectorAll(':scope>.met[data-kpi]')];
  }

  function _swallowClick(e) { if (editMode) { e.preventDefault(); e.stopPropagation(); } }

  function enter() {
    if (editMode) return;
    editMode = true;
    navigator.vibrate?.(45);
    cont.classList.add('td-drag-active');
    cont.addEventListener('click', _swallowClick, true);
    doneBtn = document.createElement('button');
    doneBtn.className = 'td-sort-done-btn';
    doneBtn.textContent = 'Done';
    doneBtn.addEventListener('click', exit);
    document.body.appendChild(doneBtn);
  }

  function exit() {
    editMode = false;
    cont.classList.remove('td-drag-active');
    cont.removeEventListener('click', _swallowClick, true);
    document.body.classList.remove('td-pressing');
    doneBtn?.remove(); doneBtn = null;
    ghost?.remove(); ghost = null;
    placeholder?.remove(); placeholder = null;
    if (dragEl) { dragEl.style.cssText = ''; dragEl = null; }
    const newOrder = getTiles().map(el => el.dataset.kpi);
    S.dashKpiOrder = newOrder;
    if (typeof _saveUserPrefs === 'function') _saveUserPrefs();
    showToast('Layout saved', '✓');
  }

  let _pressX = 0, _pressY = 0;
  cont.addEventListener('pointerdown', e => {
    const tile = e.target.closest('.met[data-kpi]');
    if (!tile) return;
    if (editMode) { document.body.classList.add('td-pressing'); startDrag(e, tile); return; }
    _pressX = e.clientX; _pressY = e.clientY;
    document.body.classList.add('td-pressing');
    lpTimer = setTimeout(enter, 450);
  }, { passive: true });

  function clearLp() {
    clearTimeout(lpTimer); lpTimer = null;
    if (!editMode) document.body.classList.remove('td-pressing');
  }
  cont.addEventListener('pointermove', e => {
    if (lpTimer == null) return;
    if (Math.hypot(e.clientX - _pressX, e.clientY - _pressY) > 12) clearLp();
  }, { passive: true });
  cont.addEventListener('pointerup', clearLp, { passive: true });
  cont.addEventListener('pointercancel', clearLp, { passive: true });

  function startDrag(e, el) {
    dragEl = el;
    const rect = el.getBoundingClientRect();
    offX = e.clientX - rect.left;
    offY = e.clientY - rect.top;

    ghost = el.cloneNode(true);
    ghost.removeAttribute('id');
    ghost.className = 'met td-drag-ghost';
    ghost.style.cssText = `width:${rect.width}px;height:${rect.height}px;left:${rect.left}px;top:${rect.top}px;background:var(--bg-card)`;
    document.body.appendChild(ghost);

    placeholder = document.createElement('div');
    placeholder.className = 'td-drag-placeholder';
    placeholder.style.width = rect.width + 'px';
    placeholder.style.height = rect.height + 'px';
    el.replaceWith(placeholder);
    el.style.display = 'none';

    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', onDrop, { once: true });
    document.addEventListener('pointercancel', onDrop, { once: true });
  }

  function onMove(e) {
    if (!ghost || !dragEl) return;
    e.preventDefault();
    ghost.style.left = (e.clientX - offX) + 'px';
    ghost.style.top = (e.clientY - offY) + 'px';
    // Grid-aware insertion: find the tile whose center is nearest the pointer,
    // then insert before or after it based on which side the pointer is on.
    const px = e.clientX, py = e.clientY;
    let nearest = null, nearDist = Infinity, nearRect = null;
    for (const t of getTiles()) {
      if (t === dragEl) continue;
      const r = t.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const d = Math.hypot(cx - px, cy - py);
      if (d < nearDist) { nearDist = d; nearest = t; nearRect = r; }
    }
    if (!nearest) { cont.appendChild(placeholder); return; }
    const cx = nearRect.left + nearRect.width / 2, cy = nearRect.top + nearRect.height / 2;
    // Decide side using the dominant axis relative to the nearest tile's center.
    const after = Math.abs(px - cx) > Math.abs(py - cy) ? px > cx : py > cy;
    if (after) nearest.after(placeholder);
    else nearest.before(placeholder);
  }

  function onDrop() {
    document.removeEventListener('pointermove', onMove);
    document.body.classList.remove('td-pressing');
    if (!dragEl || !placeholder) return;
    dragEl.style.display = '';
    placeholder.replaceWith(dragEl);
    ghost?.remove(); ghost = null;
    placeholder = null; dragEl = null;
  }

  _kpiSortActive = true;
}

// ── Jobs page ─────────────────────────────────────────────────────────────
