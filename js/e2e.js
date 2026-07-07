// ── TradeDesk E2E Test Runner ─────────────────────────────────────────────
// Call runE2ETest() from the browser console to exercise all major flows.
// Results appear as an overlay in the app — no DevTools needed.

async function runE2ETest(){
  const results=[];
  const pass=(name)=>{results.push({name,ok:true});console.log('%c✓ '+name,'color:#22c55e;font-weight:700');};
  const fail=(name,err)=>{results.push({name,ok:false,err:err?.message||String(err)});console.error('✗ '+name,err);};
  const check=(name,fn)=>{try{fn();pass(name);}catch(e){fail(name,e);}};
  const section=(name)=>{results.push({section:name});console.log('%c── '+name+' ──','color:#93c5fd;font-weight:700');};

  // ── 1. Function existence ─────────────────────────────────────────────────
  section('Core functions defined');
  const mustExist=[
    'loadAll','saveAll','loadAccountData',
    'renderDash','renderClientList','renderJobsPage','renderMoneyPage','renderLeadsPage',
    'goPg','mobileNavTo','openMobileMore',
    'openClientDetail','openEstimateForClient',
    '_doOpenEstimate','_showEstimateStylePicker','_pickEstStyle',
    'openGenericEstimate','openTMEstimate','openFreeFormEstimate',
    'sendProposalViaSms','sendProposalViaEmail',
    'zAlert','zConfirm','showToast','closeTopModal',
    'fmtD','fmt','fmtShort','todayKey','dateKey','addDays','escHtml',
    'applySettings','applyBrandLogo','registerDevice',
    'supaEnabled','supaSaveToCloud','supaLoadFromCloud',
    'renderExpenses','renderTrackerTab','calcTax',
    'renderMileage','showDriveModal',
    'renderSettings','loadSettingsForm','renderLicensing','renderTeam',
    'showNotesFab','hideNotesFab',
    'getActiveTrade','_getTradeLines',
  ];
  // The interior/exterior "Scope & Price" surface estimator was removed —
  // assert its entry points are actually gone, not just unused.
  const mustNotExist=[
    'goSurfStepB','goSurfScopeToMeasure','goSurfStepA','toggleSurfWhat',
    'setSurfJobType','onSurfRoomName','updateSurfWhatUI','saveEstFullDraft',
    'clearEstimatorForm','goEstStep','calcEst','renderEstSurfs','renderEstRunning',
    'buildScopeGrid','toggleScopeRoom','roomScopeOn','scopeOn','sendProposalLink',
    '_doOpenScopeEstimate',
  ];
  for(const fn of mustNotExist){
    check(fn+' was removed with the paint estimator',()=>{
      let val;try{val=eval(fn);}catch(e){val=undefined;}
      if(typeof val==='function')throw new Error(fn+' still exists — should have been deleted');
    });
  }
  for(const fn of mustExist){
    check('typeof '+fn+' === function',()=>{
      // const/let globals are lexical — not on window — use eval to reach them
      let val;try{val=eval(fn);}catch(e){val=undefined;}
      if(typeof val!=='function')throw new Error(fn+' is '+typeof val);
    });
  }

  // ── 2. Global variables defined ───────────────────────────────────────────
  section('Global variables defined');
  const mustBeArray=['clients','bids','jobs','income','expenses','mileage','timeEntries','events','photos','licenses'];
  for(const arr of mustBeArray){
    check(arr+' is an Array',()=>{
      let val;try{val=eval(arr);}catch(e){val=undefined;}
      if(!Array.isArray(val))throw new Error(arr+' is '+typeof val);
    });
  }
  check('S is an object',()=>{if(typeof S!=='object'||!S)throw new Error('S is '+typeof S);});
  check('JOB_COLORS is an Array',()=>{if(!Array.isArray(JOB_COLORS)||!JOB_COLORS.length)throw new Error('JOB_COLORS empty or missing');});
  check('IRS_EXPENSE_CATS is an Array',()=>{if(!Array.isArray(IRS_EXPENSE_CATS)||!IRS_EXPENSE_CATS.length)throw new Error('IRS_EXPENSE_CATS empty or missing');});

  // ── 3. Key DOM elements exist ─────────────────────────────────────────────
  section('Critical DOM elements');
  const mustExistDom=['pg-dash','pg-est-generic','pg-clients','pg-leads','pg-jobs','pg-tracker','pg-settings','pg-taxes',
    'gei-client','gei-addr','gei-desc',
    'supa-boot-overlay'];
  for(const id of mustExistDom){
    check('#'+id+' exists in DOM',()=>{if(!document.getElementById(id))throw new Error('element #'+id+' not found');});
  }
  const mustNotExistDom=['pg-est','surf-step-a','surf-step-b','surf-scope-first','surf-room-name','e-caddr'];
  for(const id of mustNotExistDom){
    check('#'+id+' removed with the paint estimator',()=>{if(document.getElementById(id))throw new Error('element #'+id+' still in DOM — should have been removed');});
  }

  // ── 4. Navigation ─────────────────────────────────────────────────────────
  section('Navigation (goPg)');
  const navPages=['pg-dash','pg-clients','pg-leads','pg-jobs'];
  for(const pg of navPages){
    check('goPg(\''+pg+'\')',()=>{
      goPg(pg);
      const active=document.querySelector('.pg.active')?.id;
      if(active!==pg)throw new Error('expected '+pg+' active, got '+active);
    });
  }
  goPg('pg-dash'); // return to dash

  // ── 5. Generic estimate flow — full walk-through ──────────────────────────
  section('Generic (Scope & Price / T&M / BYO) estimate flow');

  // Need a client to open estimate for
  let tc=clients[0];
  if(!tc){
    // Create a throwaway test client
    tc={id:Date.now(),name:'E2E Test Client',phone:'555-000-0001',addr:'123 Test St',notes:'',created:todayKey()};
    clients.unshift(tc);
    check('created test client',()=>{if(!clients.find(c=>c.id===tc.id))throw new Error('client not in array');});
  } else {
    check('found existing client: '+tc.name,()=>{});
  }

  check('openGenericEstimate navigates to pg-est-generic',()=>{
    openGenericEstimate(tc,null,'general');
    const active=document.querySelector('.pg.active')?.id;
    if(active!=='pg-est-generic')throw new Error('expected pg-est-generic active, got '+active);
  });

  check('gei-client pre-filled with client name',()=>{
    const el=document.getElementById('gei-client');
    if(!el||el.value!==tc.name)throw new Error('gei-client='+JSON.stringify(el?.value));
  });

  goPg('pg-dash');

  // ── 7. Proposal / hub links ───────────────────────────────────────────────
  section('Proposal & hub links');
  const recentBid=bids[0];
  if(recentBid){
    check('sendProposalViaSms exists and is callable',()=>{
      if(typeof sendProposalViaSms!=='function')throw new Error('sendProposalViaSms not a function');
    });
    check('sendProposalViaEmail exists and is callable',()=>{
      if(typeof sendProposalViaEmail!=='function')throw new Error('sendProposalViaEmail not a function');
    });
  } else {
    results.push({name:'proposal tests: no bids yet — skipped',ok:true});
  }

  // ── 8. Finance / books ────────────────────────────────────────────────────
  section('Finance / books page');
  check('renderMoneyPage completes without error',()=>{renderMoneyPage();});
  check('renderExpenses completes without error',()=>{
    goPg('pg-tracker');
    renderExpenses();
  });
  check('calcTax completes without error',()=>{calcTax();});

  // ── 9. Render summary ─────────────────────────────────────────────────────
  goPg('pg-dash');
  _showE2EResults(results);
}

function _showE2EResults(results){
  document.getElementById('_e2e_overlay')?.remove();
  const passed=results.filter(r=>r.ok&&!r.section).length;
  const failed=results.filter(r=>r.ok===false).length;
  const total=results.filter(r=>'ok' in r).length;
  const rows=results.map(r=>{
    if(r.section)return`<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#93c5fd;margin:10px 0 4px">${r.section}</div>`;
    const bg=r.ok?'rgba(34,197,94,.12)':'rgba(239,68,68,.15)';
    const icon=r.ok?svgIcon('✓',{size:12}):svgIcon('✗',{size:12});
    const color=r.ok?'#86efac':'#fca5a5';
    return`<div style="padding:5px 8px;border-radius:4px;margin-bottom:3px;background:${bg};font-size:12px">
      <span style="color:${color};font-weight:700;margin-right:6px">${icon}</span>${r.name}
      ${r.err?`<div style="font-size:10px;color:#fca5a5;margin-top:2px;padding-left:16px">${svgIcon('⚠',{size:10})} ${r.err}</div>`:''}
    </div>`;
  }).join('');
  const html=`<div id="_e2e_overlay" style="position:fixed;inset:0;z-index:99999;background:rgba(10,10,20,.92);padding:16px;overflow-y:auto;font-family:var(--font,monospace)">
    <div style="max-width:560px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <div>
          <div style="font-size:17px;font-weight:800;color:#f1f5f9">E2E Test Results</div>
          <div style="font-size:12px;color:${failed?'#fca5a5':'#86efac'}">${passed}/${total} passed · ${failed} failed</div>
        </div>
        <button onclick="document.getElementById('_e2e_overlay').remove();goPg('pg-dash')" style="padding:8px 16px;background:#185FA5;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">Close</button>
      </div>
      ${rows}
      <div style="margin-top:14px;font-size:11px;color:#64748b">Run again: <code style="color:#93c5fd">runE2ETest()</code> in console</div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend',html);
}

// ── Global error handler — makes JS errors visible in the app ─────────────
// Errors show as a red toast so you don't need DevTools open on iOS.
window.addEventListener('error',e=>{
  if(!e.message||e.message==='Script error.')return; // cross-origin, no info
  const loc=e.filename?e.filename.replace(/.*\//,'')+':'+e.lineno:'';
  const msg=(loc?'['+loc+'] ':'')+e.message;
  if(typeof showToast==='function'){
    showToast(msg,'🔴',8000);
  }
  console.error('[TradeDesk JS Error]',msg,e);
});
window.addEventListener('unhandledrejection',e=>{
  const msg=(e.reason?.message||String(e.reason)||'');
  // Suppress service worker fetch/update errors — these fire every SW update check
  // cycle when offline and are not actionable by the user.
  if(msg.includes('sw.js')||msg.includes('ServiceWorker')||msg.includes('load failed')||msg.includes('Failed to fetch')||(!navigator.onLine&&(msg.includes('NetworkError')||msg.includes('network')||msg.includes('fetch'))))return;
  if(typeof showToast==='function')showToast('Unhandled promise: '+msg,'🔴',8000);
  console.error('[TradeDesk Unhandled Rejection]',msg,e);
});
