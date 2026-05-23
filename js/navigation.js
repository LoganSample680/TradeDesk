function openMobileMore(){const p=document.getElementById('mtb-more-popup');if(p)p.style.display='block';}
function closeMobileMore(){const p=document.getElementById('mtb-more-popup');if(p)p.style.display='none';}
function mobileNavTo(pg){closeMobileMore();goPg(pg);}
function goPg(id){
  // Redirect employees away from restricted pages
  if(_isEmployee&&['pg-leads','pg-taxes','pg-tracker','pg-team','pg-settings','pg-checklist'].includes(id))id='pg-dash';
  // Preserve currentClientId across navigation — only clear on explicit new client selection
  if(id==='pg-dash')window._fromDash=false;
  document.querySelectorAll('.pg').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nb').forEach(b=>b.classList.remove('active'));
  const _pgEl=document.getElementById(id);
  if(!_pgEl){console.error('[goPg] element not found:',id);if(id!=='pg-dash')goPg('pg-dash');return;}
  _pgEl.classList.add('active');
  const nb=document.getElementById({
    'pg-leads':'nb-leads','pg-jobs':'nb-jobs','pg-money':'nb-money',
    'pg-schedule':'nb-jobs',
    'pg-clients':'nb-clients','pg-cal':'nb-cal','pg-tracker':'nb-tracker','pg-gallery':'nb-gallery',
    'pg-team':'nb-team','pg-licensing':'nb-licensing',
    'pg-taxes':'nb-taxes','pg-settings':'nb-settings','pg-checklist':'nb-settings',
    'pg-proposals':'nb-proposals',
    'pg-client-detail':window._clientDetailOrigin==='leads'?'nb-leads':'nb-clients'
  }[id]||('nb-'+id.replace('pg-','')));if(nb)nb.classList.add('active');
  // Sync mobile bottom tab bar
  const _mtbMap={'pg-dash':'mtb-dash','pg-leads':'mtb-leads','pg-clients':'mtb-clients','pg-jobs':'mtb-jobs',
    'pg-client-detail':window._clientDetailOrigin==='leads'?'mtb-leads':'mtb-clients'};
  document.querySelectorAll('.mtb').forEach(b=>b.classList.remove('active'));
  const _mtb=document.getElementById(_mtbMap[id]||'');
  if(_mtb)_mtb.classList.add('active');
  else{const _mm=document.getElementById('mtb-more');if(_mm)_mm.classList.add('active');}
  document.querySelectorAll('.mmi').forEach(b=>b.classList.remove('active-pg'));
  const _mmiKey={'pg-money':'mmi-money','pg-cal':'mmi-cal','pg-tracker':'mmi-tracker','pg-team':'mmi-team','pg-taxes':'mmi-taxes','pg-leads':'mmi-leads','pg-settings':'mmi-settings','pg-checklist':'mmi-settings','pg-schedule':'mmi-cal','pg-licensing':'mmi-licensing','pg-proposals':'mmi-proposals'}[id];
  if(_mmiKey){const _mi=document.getElementById(_mmiKey);if(_mi)_mi.classList.add('active-pg');}
  window.scrollTo({top:0,left:0,behavior:"instant"});document.body.scrollTop=0;document.documentElement.scrollTop=0;
  if(id==='pg-dash')renderDash();
  if(id==='pg-clients'){
    const CLIENT_FILTER_TABS=['all','won','active','collect','closed'];
    const cf=CLIENT_FILTER_TABS.includes(clientFilter)?clientFilter:'all';
    setCF(cf,document.getElementById('cft-'+cf));
  }
  if(id==='pg-cal')renderCalendar();
  if(id==='pg-schedule'){populateSchedSelect();buildColorRow();const _jt=document.getElementById('sched-tab-job');if(_jt)_jt.style.display='';try{setSchedType(schedType,document.getElementById(schedType==='estimate'?'sched-tab-est':'sched-tab-job'));}catch(e){}setTimeout(validateEstimateTime,100);}
  if(id==='pg-tracker'){trackerYear=new Date().getFullYear();_trackerYearManual=false;renderTrackerTab();populateExpJobSel();}
  if(id==='pg-taxes')calcTax();
  if(id==='pg-settings'){buildScopeDefaultsUI();
    loadSettingsForm();renderVehicleSettings();updateLocationBtn();renderTeam();loadStripeConnectStatus();_renderSettingsTradeSections();_renderDevTradeCard();renderSettingsTrades();
    if(window._scrollToVehicles){
      window._scrollToVehicles=false;
      setTimeout(()=>{
        const el=document.getElementById('settings-vehicles-section');
        if(el)el.scrollIntoView({behavior:'smooth',block:'center'});
        const inp=document.getElementById('set-new-veh');
        if(inp){inp.focus();inp.style.borderColor='var(--blue)';inp.style.boxShadow='0 0 0 3px rgba(24,95,165,.2)';setTimeout(()=>{inp.style.borderColor='';inp.style.boxShadow='';},2500);}
      },150);
    }
  }
  if(id==='pg-team')renderTeam();
  if(id==='pg-licensing')renderLicensing();
  if(id==='pg-checklist')renderChecklist();
  if(id==='pg-leads')renderLeadsPage();
  if(id==='pg-jobs')renderJobsPage();
  if(id==='pg-proposals')renderProposalsPage();
  if(id==='pg-money')renderMoneyPage();
  if(id==='pg-est'){buildScopeGrid();window._wakeLockRequest&&window._wakeLockRequest();}
  else if(id!=='pg-est-generic'){window._wakeLockRelease&&window._wakeLockRelease();}
  if(id==='pg-client-hub')renderClientHubPage();
}
