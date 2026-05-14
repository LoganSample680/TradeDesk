function openMobileMore(){}
function closeMobileMore(){}
function mobileNavTo(pg){goPg(pg);}
function goPg(id){
  // Redirect employees away from restricted pages
  if(_isEmployee&&['pg-leads','pg-taxes','pg-tracker','pg-team','pg-settings','pg-checklist'].includes(id))id='pg-dash';
  // Preserve currentClientId across navigation — only clear on explicit new client selection
  if(id==='pg-dash')window._fromDash=false;
  if(id!=='pg-est')hideNotesFab();
  document.querySelectorAll('.pg').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nb').forEach(b=>b.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  const nb=document.getElementById({
    'pg-leads':'nb-leads','pg-jobs':'nb-jobs','pg-money':'nb-money',
    'pg-schedule':'nb-jobs',
    'pg-clients':'nb-clients','pg-cal':'nb-cal','pg-tracker':'nb-tracker','pg-gallery':'nb-gallery',
    'pg-team':'nb-team','pg-licensing':'nb-licensing',
    'pg-taxes':'nb-taxes','pg-settings':'nb-settings','pg-checklist':'nb-settings',
    'pg-client-detail':window._clientDetailOrigin==='leads'?'nb-leads':'nb-clients'
  }[id]||('nb-'+id.replace('pg-','')));if(nb)nb.classList.add('active');
  // Sync mobile bottom tab bar
  const _mtbMap={
    'pg-dash':'mtb-dash','pg-leads':'mtb-leads','pg-clients':'mtb-clients','pg-jobs':'mtb-jobs',
    'pg-cal':'mtb-cal','pg-schedule':'mtb-cal',
    'pg-money':'mtb-money','pg-team':'mtb-team','pg-tracker':'mtb-tracker',
    'pg-taxes':'mtb-taxes','pg-licensing':'mtb-licensing',
    'pg-settings':'mtb-settings','pg-checklist':'mtb-settings',
    'pg-client-detail':window._clientDetailOrigin==='leads'?'mtb-leads':'mtb-clients'
  };
  document.querySelectorAll('.mtb').forEach(b=>b.classList.remove('active'));
  const _mtb=document.getElementById(_mtbMap[id]||'');
  if(_mtb){_mtb.classList.add('active');_mtb.scrollIntoView({behavior:'smooth',block:'nearest',inline:'nearest'});}
  window.scrollTo({top:0,left:0,behavior:"instant"});document.body.scrollTop=0;document.documentElement.scrollTop=0;
  if(id==='pg-dash')renderDash();
  if(id==='pg-clients'){
    const CLIENT_FILTER_TABS=['all','won','active','collect','closed'];
    const cf=CLIENT_FILTER_TABS.includes(clientFilter)?clientFilter:'all';
    setCF(cf,document.getElementById('cft-'+cf));
  }
  if(id==='pg-cal')renderCalendar();
  if(id==='pg-schedule'){populateSchedSelect();buildColorRow();const _jt=document.getElementById('sched-tab-job');if(_jt)_jt.style.display='';try{setSchedType(schedType,document.getElementById(schedType==='estimate'?'sched-tab-est':'sched-tab-job'));}catch(e){}setTimeout(validateEstimateTime,100);}
  if(id==='pg-tracker'){renderTrackerTab();populateExpJobSel();}
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
  if(id==='pg-money')renderMoneyPage();
  if(id==='pg-est'){buildScopeGrid();showNotesFab();}
}
