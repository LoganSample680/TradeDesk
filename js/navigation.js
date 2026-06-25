function openMobileMore(){const p=document.getElementById('mtb-more-popup');if(p)p.style.display='block';}
function closeMobileMore(){const p=document.getElementById('mtb-more-popup');if(p)p.style.display='none';}
function mobileNavTo(pg){closeMobileMore();goPg(pg);}
function goPg(id){
  // Redirect employees away from restricted pages
  if(_isEmployee){
    const _empBlocked=['pg-taxes','pg-tracker','pg-team','pg-settings','pg-checklist',
      'pg-dispatch','pg-licensing','pg-contracts','pg-client-hub','pg-money'];
    if(_empBlocked.includes(id))id='pg-dash';
    else if(id==='pg-leads'&&!_employeeRecord?.permissions?.leads)id='pg-dash';
  }
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
    'pg-team':'nb-team','pg-licensing':'nb-licensing','pg-contracts':'nb-contracts',
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
  const _mmiKey={'pg-money':'mmi-money','pg-cal':'mmi-cal','pg-tracker':'mmi-tracker','pg-team':'mmi-team','pg-taxes':'mmi-taxes','pg-leads':'mmi-leads','pg-settings':'mmi-settings','pg-checklist':'mmi-settings','pg-schedule':'mmi-cal','pg-licensing':'mmi-licensing','pg-contracts':'mmi-contracts','pg-proposals':'mmi-proposals'}[id];
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
  if(id==='pg-taxes'){_taxPageYear=new Date().getFullYear();calcTax();}
  if(id==='pg-settings'){buildScopeDefaultsUI();
    loadSettingsForm();updateLocationBtn();renderTeam();loadStripeConnectStatus();_renderSettingsTradeSections();_renderDevTradeCard();renderSettingsTrades();
    if(window._scrollToVehicles){
      window._scrollToVehicles=false;
      // Vehicles now managed in Fleet & Team — redirect there
      setTimeout(()=>{ goPg('pg-team'); setFleetTab('fleet'); },150);
    }
  }
  if(id==='pg-team'){renderTeam();renderFleetVehicles();}
  if(id==='pg-dispatch'){if(typeof renderDispatch==='function')renderDispatch();}
  if(id==='pg-licensing')renderLicensing();
  if(id==='pg-contracts'){renderContracts();if(typeof refreshAgreementSignatures==='function')refreshAgreementSignatures();}
  if(id==='pg-checklist')renderChecklist();
  if(id==='pg-leads')renderLeadsPage();
  if(id==='pg-jobs')renderJobsPage();
  if(id==='pg-proposals')renderProposalsPage();
  if(id==='pg-money')renderMoneyPage();
  if(id==='pg-est'){buildScopeGrid();window._wakeLockRequest&&window._wakeLockRequest();}
  else if(id!=='pg-est-generic'){window._wakeLockRelease&&window._wakeLockRelease();}
  if(id==='pg-client-hub')renderClientHubPage();
}

function _applyEmployeeNavGating(){
  // Hide every contractor-only nav button (sidebar + mobile more menu)
  const _gatedIds=['nb-tracker','nb-taxes','nb-team','nb-settings','nb-licensing','nb-contracts','nb-hub','nb-money',
   'mmi-tracker','mmi-taxes','mmi-team','mmi-settings','mmi-licensing','mmi-contracts','mmi-hub','mmi-money',
  ];
  // Only hide leads nav if the employee doesn't have the leads permission
  if(!_employeeRecord?.permissions?.leads)_gatedIds.push('nb-leads','mtb-leads','mmi-leads');
  _gatedIds.forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});
  // Hide the Dispatch button inside the Jobs page header for employees
  const _dispBtn=document.getElementById('jobs-dispatch-btn');if(_dispBtn)_dispBtn.style.display='none';
  // nav-user avatar: show employee name/role but don't link to settings
  const nu=document.getElementById('nav-user');
  if(nu){nu.style.cursor='default';nu.onclick=null;}
  const nr=document.getElementById('nav-user-role');
  if(nr)nr.textContent=(_employeeRecord?.role||'employee').charAt(0).toUpperCase()+(_employeeRecord?.role||'employee').slice(1);
}

// ── Tab bar drag-to-reorder ────────────────────────────────────────────────
const _MTB_DEFAULT_ORDER = ['dash','leads','clients','jobs'];

function _getTabOrder() {
  const saved = S.navTabOrder;
  if (Array.isArray(saved) && saved.length === 4) return saved;
  return _MTB_DEFAULT_ORDER.slice();
}

function _applyTabOrder(order) {
  const inner = document.getElementById('mtb-inner');
  if (!inner) return;
  order.forEach(id => {
    const btn = document.getElementById('mtb-' + id);
    if (btn) inner.appendChild(btn);
  });
}

function _initTabBarDrag() {
  const tabbar = document.getElementById('mobile-tabbar');
  const inner = document.getElementById('mtb-inner');
  if (!tabbar || !inner) return;

  // Apply saved order on init
  _applyTabOrder(_getTabOrder());

  let editMode = false, lpTimer = null;
  let dragEl = null, ghost = null, placeholder = null, doneBtn = null;
  let offX = 0, offY = 0;

  function getButtons() {
    return [...inner.querySelectorAll('.mtb[data-tab]')];
  }

  // While editing, swallow tab clicks so a tap reorders instead of navigating —
  // only the Done button (outside the tab bar) stays live.
  function _swallowClick(e) { if (editMode) { e.preventDefault(); e.stopPropagation(); } }

  function enter() {
    if (editMode) return;
    editMode = true;
    navigator.vibrate?.(45);
    tabbar.classList.add('td-drag-active');
    inner.classList.add('td-drag-active', 'mtb-inner');
    tabbar.addEventListener('click', _swallowClick, true);
    doneBtn = document.createElement('button');
    doneBtn.className = 'td-sort-done-btn';
    doneBtn.textContent = 'Done';
    doneBtn.addEventListener('click', exit);
    document.body.appendChild(doneBtn);
  }

  function exit() {
    editMode = false;
    tabbar.classList.remove('td-drag-active');
    inner.classList.remove('td-drag-active', 'mtb-inner');
    tabbar.removeEventListener('click', _swallowClick, true);
    document.body.classList.remove('td-pressing');
    doneBtn?.remove(); doneBtn = null;
    ghost?.remove(); ghost = null;
    placeholder?.remove(); placeholder = null;
    if (dragEl) { dragEl.style.cssText = ''; dragEl = null; }
    // Save to the per-individual-user prefs store (keyed by auth.uid), not the
    // shared business settings blob — keeps each person's tab order isolated.
    const newOrder = getButtons().map(b => b.dataset.tab);
    S.navTabOrder = newOrder;
    if (typeof _saveUserPrefs === 'function') _saveUserPrefs();
  }

  // Long press detection
  let _pressX = 0, _pressY = 0;
  tabbar.addEventListener('pointerdown', e => {
    const btn = e.target.closest('.mtb[data-tab]');
    if (!btn) return;
    if (editMode) { document.body.classList.add('td-pressing'); startDrag(e, btn); return; }
    _pressX = e.clientX; _pressY = e.clientY;
    document.body.classList.add('td-pressing');
    lpTimer = setTimeout(enter, 450);
  }, { passive: true });

  function clearLp() {
    clearTimeout(lpTimer); lpTimer = null;
    if (!editMode) document.body.classList.remove('td-pressing');
  }
  tabbar.addEventListener('pointermove', e => {
    if (lpTimer == null) return;
    if (Math.hypot(e.clientX - _pressX, e.clientY - _pressY) > 12) clearLp();
  }, { passive: true });
  tabbar.addEventListener('pointerup', clearLp, { passive: true });
  tabbar.addEventListener('pointercancel', clearLp, { passive: true });

  function startDrag(e, el) {
    dragEl = el;
    const rect = el.getBoundingClientRect();
    offX = e.clientX - rect.left;
    offY = e.clientY - rect.top;

    ghost = el.cloneNode(true);
    ghost.removeAttribute('id');
    ghost.className = 'mtb td-drag-ghost';
    ghost.style.cssText = `width:${rect.width}px;height:${rect.height}px;left:${rect.left}px;top:${rect.top}px;display:flex;flex-direction:column;align-items:center;justify-content:center;background:var(--ink);color:var(--text-cream)`;
    document.body.appendChild(ghost);

    placeholder = document.createElement('div');
    placeholder.className = 'td-drag-placeholder';
    placeholder.style.cssText = `width:${rect.width}px;height:${rect.height}px;display:inline-flex;`;
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
    // Find insertion point (horizontal axis)
    const btns = getButtons();
    let before = null;
    for (const btn of btns) {
      if (btn === dragEl) continue;
      const r = btn.getBoundingClientRect();
      if (e.clientX < r.left + r.width / 2) { before = btn; break; }
    }
    if (before) inner.insertBefore(placeholder, before);
    else inner.appendChild(placeholder);
  }

  function onDrop() {
    document.removeEventListener('pointermove', onMove);
    document.body.classList.remove('td-pressing');
    if (!dragEl || !placeholder) return;
    dragEl.style.display = '';
    placeholder.replaceWith(dragEl);
    ghost?.remove(); ghost = null;
    placeholder = null; dragEl = null;
    // Don't exit edit mode on drop — user taps Done to confirm
  }
}
