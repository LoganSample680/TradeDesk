function openClientDetail(cid,origin){
  currentClientId=cid;
  // origin: 'dash' | 'leads' | 'clients' | true (legacy dash compat)
  window._clientDetailOrigin=(origin===true||origin==='dash')?'dash':(origin==='leads'?'leads':'clients');
  window._fromDash=(window._clientDetailOrigin==='dash');
  renderClientDetail();
  goPg('pg-client-detail');
  const bb=document.getElementById('cd-back-btn');
  if(bb)bb.textContent=window._clientDetailOrigin==='dash'?'← Home':window._clientDetailOrigin==='leads'?'← Leads':'← All clients';
}

// True for contractors/owners always, and for employees only when granted the
// `estimate` team permission. The estimate entry points are greyed for employees
// without it, and any attempt routes through the request-access popup instead.
function _canEstimate(){ return !_isEmployee || !!(_employeeRecord&&_employeeRecord.permissions&&_employeeRecord.permissions.estimate); }

function openEstimateForClient(){
  // Permission gate FIRST — covers both entry points (dashboard quick action and
  // the client-record buttons both funnel here). A non-estimate employee gets the
  // request-access popup, never the estimator.
  if(!_canEstimate()){ _showEstimateRequestModal(); return; }
  const c=getClientById(currentClientId);
  if(!c){showWorkflowGate('Select a client first before starting an estimate.','Choose Client','function(){goPg(\'pg-clients\');}');return;}
  const r=getClientRisk(c.id);
  if(r==='blacklisted'){zAlert('This client is blacklisted. Estimates are blocked.',{title:'🚫 Blocked'});return;}
  if(r==='high_risk'){
    zConfirm('⚠️ This client previously required a lien for payment. Continue with estimate?',
      ()=>_rrpGateThenEstimate(c),{title:'High risk client',yes:'Proceed',danger:true});
    return;
  }
  _rrpGateThenEstimate(c);
}
// Popup shown when a non-estimate employee taps a (greyed) estimate entry point:
// offer to request access from the owner/manager.
function _showEstimateRequestModal(){
  if(typeof zConfirm==='function'){
    zConfirm("You don't have permission to create estimates yet. Send a request to your manager for access?",
      ()=>_submitEstimateRequest(),
      {title:'🔒 Estimate access',yes:'Request access'});
  }else if(typeof zAlert==='function'){
    zAlert('You do not have permission to create estimates. Ask your manager for access.',{title:'Permission needed'});
  }
}

// Insert a pending permission request the owner sees on their Team page. The
// unique partial index (one pending per contractor/employee/perm) makes a repeat
// tap a no-op rather than a duplicate.
async function _submitEstimateRequest(){
  if(!_isEmployee||typeof _supa==='undefined'||!_supa||!_supaUser||!_contractorUserId){
    if(typeof showToast==='function')showToast('Could not send request.','⚠️');return;
  }
  try{
    const row={contractor_user_id:_contractorUserId,employee_user_id:_supaUser.id,
      employee_email:_supaUser.email||'',employee_name:(_employeeRecord&&_employeeRecord.name)||'',
      perm:'estimate',status:'pending'};
    const{error}=await _supa.from('td_permission_requests').insert(row);
    if(error){
      if(/duplicate|unique|23505/i.test((error.message||'')+(error.code||''))){
        if(typeof showToast==='function')showToast('Request already sent — pending approval.','⏳');return;
      }
      throw error;
    }
    if(typeof showToast==='function')showToast('Access request sent to your manager.','📤');
  }catch(e){console.warn('estimate request failed:',e);if(typeof showToast==='function')showToast('Could not send request.','⚠️');}
}

// Trades that categorically never disturb painted surfaces — skip RRP question
const _RRP_EXEMPT_TRADES=['landscaping'];
function _rrpGateThenEstimate(c){
  if(!c)return;
  const _trade=typeof getActiveTrade==='function'?getActiveTrade():'painting';
  if(c.yearBuilt&&c.yearBuilt<1978&&!_RRP_EXEMPT_TRADES.includes(_trade)){
    if((c.addr||'').trim()){
      // Open estimate picker first so it's the backdrop behind the RRP modal
      _gateAddressThenEstimate(c);
      // Force-show picker instantly (skip fade-in) so it's fully visible when RRP modal overlays
      const _spOv=document.getElementById('_style-pick-ov');
      if(_spOv){_spOv.style.transition='none';_spOv.style.opacity='1';_spOv.style.transform='translateY(0)';}
      _showRrpModal(c,()=>{});
    } else {
      _showRrpModal(c,()=>_gateAddressThenEstimate(c));
    }
    return;
  }
  if(typeof _rrpPaintAnswer!=='undefined')_rrpPaintAnswer='no';
  _gateAddressThenEstimate(c);
}
function _showRrpModal(c,onProceed){
  if(!c)return;
  document.getElementById('_rrp-gate-overlay')?.remove();
  const hasCert=(typeof licenses!=='undefined')&&licenses.some(l=>
    ['epa_firm','epa_renovator'].includes(l.typeId)&&(!l.expiryDate||l.expiryDate>=todayKey()));
  const ov=document.createElement('div');ov.className='zmodal-overlay';ov.id='_rrp-gate-overlay';
  const box=document.createElement('div');box.className='zmodal';
  box.innerHTML=
    '<div style="font-size:16px;font-weight:800;margin-bottom:4px">⚠️ Pre-1978 Home — Built '+c.yearBuilt+'</div>'+
    '<div style="font-size:13px;color:var(--text2);margin-bottom:8px;line-height:1.5">Will painted surfaces be disturbed during this job?</div>'+
    '<div style="font-size:11.5px;color:var(--text3);margin-bottom:14px;line-height:1.5">EPA RRP applies when &gt;6 sq ft interior or &gt;20 sq ft exterior painted surface is disturbed.</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">'+
      '<button onclick="_rrpModalNo()" style="padding:13px;border-radius:var(--r);border:2px solid var(--border2);background:var(--bg2);color:var(--text1);font-size:15px;font-weight:700;cursor:pointer;font-family:inherit">No</button>'+
      '<button onclick="_rrpModalYes()" style="padding:13px;border-radius:var(--r);border:2px solid #d97706;background:#fef3c7;color:#92400e;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">Yes — I\'m certified</button>'+
    '</div>'+
    '<div id="_rrp-cert-msg" style="display:none"></div>';
  ov.appendChild(box);document.body.appendChild(ov);
  window._rrpModalNo=function(){
    if(typeof _rrpPaintAnswer!=='undefined')_rrpPaintAnswer='no';
    // Persist on the client — proposal send may happen in a later session
    c.rrpDisturb='no';if(typeof saveAll==='function')saveAll();
    document.getElementById('_rrp-gate-overlay')?.remove();
    onProceed();
  };
  window._rrpModalYes=function(){
    if(typeof _rrpPaintAnswer!=='undefined')_rrpPaintAnswer='yes';
    c.rrpDisturb='yes';if(typeof saveAll==='function')saveAll();
    if(hasCert){document.getElementById('_rrp-gate-overlay')?.remove();onProceed();return;}
    const msg=document.getElementById('_rrp-cert-msg');
    if(!msg)return;
    msg.style.display='block';
    msg.innerHTML=
      '<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:var(--r);padding:12px;margin-bottom:10px">'+
        '<div style="font-size:13px;font-weight:800;color:#a32d2d;margin-bottom:6px">RRP certification required before this estimate can proceed.</div>'+
        '<div style="margin-top:8px">'+
          '<div style="font-size:12px;font-weight:800;color:#92400e;margin-bottom:6px">EPA RRP certification required</div>'+
          '<div style="font-size:12px;color:var(--text1);margin-bottom:6px;line-height:1.6">Pre-1978 homes: you need EPA RRP certification before disturbing any painted surfaces. Work without it and you\'re exposed to serious fines.</div>'+
          '<div style="font-size:13px;font-weight:800;color:#a32d2d;margin-bottom:6px">Fines: up to $37,500 per violation, per day.</div>'+
          '<div style="font-size:12px;color:var(--text2);line-height:1.5">Getting certified: one-day course, ~$200–$300, valid 5 years. Search "EPA RRP certification [your state]" to find a local provider.</div>'+
        '</div>'+
      '</div>'+
      '<button onclick="typeof _closeStylePicker===\'function\'&&_closeStylePicker();document.getElementById(\'_rrp-gate-overlay\')?.remove();goPg(\'pg-licensing\');setTimeout(()=>openAddLicense(\'epa_firm\'),200)" style="width:100%;padding:12px;border-radius:var(--r);border:none;background:#92400e;color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:8px">Add my RRP cert → Licensing</button>'+
      '<button onclick="document.getElementById(\'_rrp-gate-overlay\')?.remove()" style="width:100%;padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:none;color:var(--text3);font-size:13px;cursor:pointer;font-family:inherit">Cancel</button>';

  };
}
function _gateAddressThenEstimate(c){
  if(!c)return;
  if(!(c.addr||'').trim()){
    // Lead has no address — must collect before building an estimate
    const ov=document.createElement('div');ov.className='zmodal-overlay';ov.id='_addr-gate-overlay';
    const box=document.createElement('div');box.className='zmodal';
    box.innerHTML=
      '<div style="font-size:18px;margin-bottom:6px">📍 Address required</div>'+
      '<div style="font-size:13px;color:var(--text2);margin-bottom:14px;line-height:1.5">Add '+escHtml(c.name)+'\'s property address before starting an estimate. You can\'t measure or quote without it.</div>'+
      '<div style="position:relative;margin-bottom:14px">'+
'<input id="_addr-gate-inp" type="text" placeholder="123 Main St, City, ST" autocomplete="off" '+
  'style="width:100%;box-sizing:border-box;padding:11px 12px;border:1.5px solid var(--border2);border-radius:var(--r);font-size:15px;font-family:inherit;background:var(--bg2);color:var(--text)">'+
'</div>'+
      '<button id="_addr-gate-ok" style="width:100%;padding:14px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:8px">Save &amp; start estimate</button>'+
      '<button onclick="document.getElementById(\'_addr-gate-overlay\').remove()" style="width:100%;padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:none;color:var(--text3);font-size:14px;cursor:pointer;font-family:inherit">Cancel</button>';
    ov.appendChild(box);document.body.appendChild(ov);
    const _agInp=document.getElementById('_addr-gate-inp');
    if(_agInp&&typeof _addrAutoFull==='function')_addrAutoFull(_agInp,null);
    setTimeout(()=>_agInp?.focus(),100);
    document.getElementById('_addr-gate-ok').onclick=()=>{
      const addr=(document.getElementById('_addr-gate-inp')?.value||'').trim();
      if(!addr){const inp=document.getElementById('_addr-gate-inp');if(inp){inp.style.borderColor='#A32D2D';inp.placeholder='Enter address to continue';}return;}
      const idx=clients.findIndex(x=>x.id===c.id);
      if(idx>=0){
        const _p=typeof _parseAddrParts==='function'?_parseAddrParts(addr):{street:addr,city:'',state:'',zip:''};
        clients[idx].addr=addr;
        if(_p.street)clients[idx].street=_p.street;
        if(_p.city)clients[idx].city=_p.city;
        if(_p.state)clients[idx].state=_p.state;
        if(_p.zip)clients[idx].zip=_p.zip;
        saveAll();
        if(_p.street&&_p.city&&typeof _lookupPropertyData==='function')
          _lookupPropertyData(clients[idx].id,{street:_p.street,city:_p.city,state:_p.state||'',zip:_p.zip||''});
      }
      ov.remove();
      _checkMultiPropertyThenOpen(clients.find(x=>x.id===c.id)||c);
    };
    return;
  }
  _checkMultiPropertyThenOpen(c);
}
function _checkMultiPropertyThenOpen(c){
  if(!c)return;
  // If client already has any in-progress bid (Pending+draft), offer to resume it
  const activeBids=bids.filter(b=>b.client_id===c.id&&!b.signingToken&&(
    (b.status==='Pending'&&b.draft===true)||
    (b.draft===true&&b.surfaces&&b.surfaces.length>0)
  ));
  if(activeBids.length>0){
    const resumeTarget=activeBids[0];
    const addrHint=resumeTarget.addr?' ('+resumeTarget.addr+')':'';
    zConfirm(c.name+' has an estimate in progress'+addrHint+'. Resume it or start one for a different property?',
      ()=>{
        if(activeBids.length===1){openEditBid(resumeTarget.id);}
        else{
          // Multiple in-progress — show picker
          const ov=document.createElement('div');ov.className='zmodal-overlay';
          const box=document.createElement('div');box.className='zmodal';
          box.innerHTML='<div style="font-size:16px;font-weight:800;margin-bottom:12px">Choose estimate to resume</div>'+
            activeBids.map(b=>'<button onclick="this.closest(\'.zmodal-overlay\').remove();openEditBid('+b.id+')" style="width:100%;padding:11px 14px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);cursor:pointer;font-family:inherit;text-align:left;margin-bottom:8px;font-size:13px;color:var(--text)">'+escHtml(b.addr||b.name||'Estimate')+'<span style="font-size:11px;color:var(--text3);display:block;margin-top:2px">'+escHtml(b.bid_date||'')+'</span></button>').join('')+
            '<button onclick="this.closest(\'.zmodal-overlay\').remove()" style="width:100%;padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:none;color:var(--text3);font-size:13px;cursor:pointer;font-family:inherit">Cancel</button>';
          ov.appendChild(box);document.body.appendChild(ov);
          ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
        }
      },
      {title:'Estimate in progress',yes:'Resume estimate',no:'Different property',danger:false,
       onNo:()=>_askNewPropertyAddress(c)});
    return;
  }
  _doOpenEstimate(c);
}
function _askNewPropertyAddress(c){
  // Show inline address prompt before opening estimate for a new property
  const ov=document.createElement('div');ov.className='zmodal-overlay';ov.id='_new-prop-overlay';
  const box=document.createElement('div');box.className='zmodal';
  box.innerHTML=
    '<div style="font-size:17px;font-weight:800;margin-bottom:4px">New property address</div>'+
    '<div style="font-size:13px;color:var(--text3);margin-bottom:14px">Enter the address for this job</div>'+
    '<div style="position:relative;margin-bottom:14px"><input id="_new-prop-addr" type="text" placeholder="123 Main St, City, ST" autocomplete="off" '+
      'style="width:100%;box-sizing:border-box;padding:11px 12px;border:1.5px solid var(--border2);border-radius:var(--r);font-size:15px;font-family:inherit;background:var(--bg2);color:var(--text)"></div>'+
    '<button id="_new-prop-ok" style="width:100%;padding:14px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:8px">Open estimate</button>'+
    '<button onclick="document.getElementById(\'_new-prop-overlay\').remove()" style="width:100%;padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:none;color:var(--text3);font-size:14px;cursor:pointer;font-family:inherit">Cancel</button>';
  ov.appendChild(box);document.body.appendChild(ov);
  const inp=document.getElementById('_new-prop-addr');
  if(inp&&typeof _addrAutoFull==='function')_addrAutoFull(inp,null);
  if(inp)setTimeout(()=>inp.focus(),80);
  const go=()=>{
    const addr=(inp?inp.value.trim():'')||c.addr||'';
    document.getElementById('_new-prop-overlay')?.remove();
    _doOpenEstimate(c,addr);
  };
  document.getElementById('_new-prop-ok').addEventListener('click',go);
  if(inp)inp.addEventListener('keydown',e=>{if(e.key==='Enter')go();});
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
}
let _tradePickCb=null;
Object.defineProperty(window,'_tradePickCb',{get:()=>_tradePickCb,set:v=>{_tradePickCb=v;},configurable:true});
function _showTradePicker(title,cb){
  _tradePickCb=cb;
  const lines=_getTradeLines();
  const ov=document.createElement('div');ov.className='zmodal-overlay';ov.id='_trade-pick-ov';
  const box=document.createElement('div');box.className='zmodal';
  box.innerHTML=
    '<div style="font-size:17px;font-weight:800;margin-bottom:4px">'+title+'</div>'+
    '<div style="font-size:13px;color:var(--text3);margin-bottom:14px">Which trade is this for?</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">'+
    lines.map(id=>{const m=TRADE_META[id]||{icon:'🔧',label:id};return'<button onclick="_pickTrade(\''+id+'\')" style="padding:14px 10px;border-radius:var(--r);border:1.5px solid var(--border2);background:var(--bg2);cursor:pointer;font-family:inherit;text-align:center"><div style="font-size:22px;margin-bottom:4px">'+m.icon+'</div><div style="font-size:13px;font-weight:700;color:var(--text)">'+m.label+'</div></button>';}).join('')+
    '</div>'+
    '<button onclick="document.getElementById(\'_trade-pick-ov\')?.remove()" style="width:100%;padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:none;color:var(--text3);font-size:14px;cursor:pointer;font-family:inherit">Cancel</button>';
  ov.appendChild(box);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
}
function _pickTrade(id){
  document.getElementById('_trade-pick-ov')?.remove();
  if(id==='_industrial'){
    _tradePickCb=null;
    openIndustrialEquipEstimate(getClientById(currentClientId));
    return;
  }
  if(id==='_tm'){
    _tradePickCb=null;
    openTMEstimate(getClientById(currentClientId));
    return;
  }
  if(_tradePickCb){_tradePickCb(id);_tradePickCb=null;}
}

// ── 3-way estimate style picker ──────────────────────────────────────────────
let _stylePickState=null;
Object.defineProperty(window,'_stylePickState',{get:()=>_stylePickState,set:v=>{_stylePickState=v;},configurable:true});
function _closeStylePicker(){
  const ov=document.getElementById('_style-pick-ov');
  if(ov){ov.style.opacity='0';ov.style.transform='translateY(14px)';setTimeout(()=>ov.remove(),380);}
}
function _showEstimateStylePicker(c,overrideAddr){
  _stylePickState={c,overrideAddr};
  const trade=getActiveTrade();
  const _SCOPE_DESC={
    painting:'You define the work, the client sees one bottom-line price. Best for clearly-defined jobs like a full repaint or exterior project.',
    electrical:'You define the work, the client sees one bottom-line price. Best for service upgrades, panel installs, or any clearly-scoped electrical job.',
    plumbing:'You define the work, the client sees one bottom-line price. Best for fixture replacements, pipe repairs, or clearly-scoped plumbing installs.',
    hvac:'You define the work, the client sees one bottom-line price. Best for equipment installs, duct work, or any clearly-scoped HVAC job.',
    roofing:'You define the work, the client sees one bottom-line price. Best for full replacements, repairs, or gutter installs with known scope.',
    landscaping:'You define the work, the client sees one bottom-line price. Best for installs, hardscape, or irrigation projects with a defined deliverable.',
    general:'You define the work, the client sees one bottom-line price. Best for any job with a fixed scope and a single deliverable.',
  };
  const _TIPS={
    painting:'Most painters use <b>Scope &amp; Price</b> for new clients and <b>T&M</b> for repeat customers with open-ended work. <b>Build Your Own</b> shines for upsells.',
    electrical:'Most electricians use <b>Scope &amp; Price</b> for installs and upgrades, <b>T&M</b> for troubleshooting and service calls, and <b>Build Your Own</b> for whole-home packages.',
    plumbing:'Most plumbers use <b>Scope &amp; Price</b> for installs and replacements, <b>T&M</b> for service calls with unknown scope, and <b>Build Your Own</b> for remodel packages.',
    hvac:'Most HVAC contractors use <b>Scope &amp; Price</b> for equipment installs, <b>T&M</b> for diagnostics and service calls, and <b>Build Your Own</b> for maintenance packages.',
    roofing:'Most roofers use <b>Scope &amp; Price</b> for replacements, <b>T&M</b> for repairs with unknown damage extent, and <b>Build Your Own</b> for full exterior packages.',
    landscaping:'Most landscapers use <b>Scope &amp; Price</b> for install projects, <b>T&M</b> for open-ended maintenance, and <b>Build Your Own</b> for seasonal service packages.',
    general:'Use <b>Scope &amp; Price</b> for fixed deliverables, <b>T&M</b> for open-ended or uncertain scope, and <b>Build Your Own</b> when the client wants to choose their services.',
  };
  const scopeDesc=_SCOPE_DESC[trade]||_SCOPE_DESC.general;
  const tipText=_TIPS[trade]||_TIPS.general;
  const ov=document.createElement('div');
  ov.id='_style-pick-ov';
  ov.style.cssText='position:fixed;inset:0;z-index:9000;background:var(--bg2);overflow-y:auto;opacity:0;transform:translateY(22px);transition:opacity .38s ease,transform .42s cubic-bezier(.22,.8,.2,1)';
  const isPainting=trade==='painting'||trade==='general';
  const card=(id,tone,icon,eyebrow,title,sub,bullets)=>{
    const bul=bullets.map(b=>'<li><span>✓</span>'+b+'</li>').join('');
    return `<button class="chooser-card chooser-${tone}" onclick="_pickEstStyle('${id}')">
      <div class="chooser-card-eyebrow">${eyebrow}</div>
      <div class="chooser-card-icon">${icon}</div>
      <div class="chooser-card-title">${title}</div>
      <div class="chooser-card-sub">${sub}</div>
      <ul class="chooser-card-bullets">${bul}</ul>
      <div class="chooser-card-cta">Start →</div>
    </button>`;
  };
  ov.innerHTML=
    '<div style="max-width:1100px;margin:0 auto;padding:24px 20px 40px">'+
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">'+
        '<div>'+
          '<div class="tbar-eyebrow">Pick estimate type</div>'+
          '<div class="tbar-title">How are you billing this job?</div>'+
        '</div>'+
        '<button class="btn btn-ghost" onclick="_closeStylePicker()">Cancel</button>'+
      '</div>'+
      '<div class="chooser-grid">'+
        card('scope','denim',isPainting?'🖌️':'📋','Most popular',
          isPainting?'Interior / Exterior':'Scope &amp; Price',
          isPainting?'Surface-by-surface pricing':'Fixed scope, one final number',
          isPainting
            ?['Interior, exterior &amp; cabinet','Auto-calculates from room sq ft','Single-price proposal','Deposit collected upfront']
            :['Line items private from client','Internal labor + materials math','Single-price proposal','Deposit collected upfront'])+
        card('tm','amber','⏱️','Unknown scope','Time &amp; Materials','Flexible billing when you can\'t lock in a price',
          ['Hourly rate + crew size','Materials at cost + markup','Not-to-exceed cap (optional)','Weekly invoicing'])+
        card('freeform','green','🧩','A la carte','Build Your Own','List every service with its own price',
          ['Price each service individually','Mix labor, materials &amp; add-ons','Deposit collected upfront','Easy to upsell extras'])+
      '</div>'+
    '</div>';
  document.body.appendChild(ov);
  requestAnimationFrame(()=>requestAnimationFrame(()=>{ov.style.opacity='1';ov.style.transform='translateY(0)';}));
}
function _pickEstStyle(style){
  const ov=document.getElementById('_style-pick-ov');
  const doIt=()=>{
    const {c,overrideAddr}=_stylePickState||{};
    if(!c)return;
    _stylePickState=null;
    if(style==='scope'){_doOpenScopeEstimate(c,overrideAddr);}
    else if(style==='tm'){openTMEstimate(c);}
    else if(style==='freeform'){openFreeFormEstimate(c);}
  };
  if(ov){doIt();ov.style.opacity='0';ov.style.transform='translateY(10px)';setTimeout(()=>ov.remove(),220);}
  else{doIt();}
}
function _doOpenScopeEstimate(c,overrideAddr){
  // Explicitly reset TM/BYO flags so switching types doesn't carry over the previous mode
  if(typeof _geiIsTM!=='undefined')_geiIsTM=false;
  if(typeof _geiIsFreeForm!=='undefined')_geiIsFreeForm=false;
  _doOpenEstimate(c,overrideAddr,getActiveTrade());
}

function _doOpenEstimate(c,_overrideAddr,_forceTrade){
  if(!_forceTrade){
    // Multi-trade: ask which trade first, then show 3-type picker with correct branding
    const lines=_getTradeLines();
    if(lines.length>1){
      _showTradePicker('Which trade is this job for?',t=>{
        _activeTrade=t;_renderNavTradeSwitcher();
        _showEstimateStylePicker(c,_overrideAddr);
      });
      return;
    }
    _showEstimateStylePicker(c,_overrideAddr);
    return;
  }
  const _trade=_forceTrade||getActiveTrade();
  _activeTrade=_trade;_renderNavTradeSwitcher();
  if(_trade!=='painting'&&_trade!=='general'){
    openGenericEstimate(c,null,_trade);
    return;
  }
  _resetNotesForNewEstimate();
  // Full state wipe — prevents ANY bleed from a prior estimate session
  _pendingSignToken=null;
  const _plbD=document.getElementById('proposal-link-bar');if(_plbD){_plbD.style.display='none';_plbD.dataset.signingUrl='';}
  const _sBtnD=document.getElementById('send-proposal-btn');if(_sBtnD){_sBtnD.textContent='🔗 Send to client';_sBtnD.disabled=false;}
  _swLastProductByCategory={};
  estSurfaces=[];estSurfId=0;clearSurfDraft();
  scopeActiveMap={};scopeHrsStore={};roomScopeMap={};
  estPropertyTier={key:'avg',mult:1.00,paint:'ProMar 200',products:{interior:'pm200',exterior:'spe',trim:'pm200t'}};
  surfRoom='';surfColor='';surfJobType='interior';surfWhatSelected=[];surfBQueue=[];surfBIdx=0;surfBMeasurements={};_swLastProductByCategory={};
  // Clear persistent DOM fields so they don't bleed from the previous estimate
  ['surf-room-name','laser-room-name','manual-room-name'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const _sigTyped=document.getElementById('sig-typed');if(_sigTyped)_sigTyped.value='';
  const _sigPrev=document.getElementById('sig-typed-preview');if(_sigPrev)_sigPrev.textContent='';
  estLinkedClientId=currentClientId;
  editingBidId=null;
  // Reuse only a truly empty draft for this client (no surfaces, never worked on) — prevents
  // orphan bids from accidental navigation away at step 1. Does NOT touch Pending bids with
  // surfaces — those are real jobs for other properties and must stay in Estimates in Progress.
  const _curTrade=getActiveTrade();
  const _existingDraft=bids.find(b=>b.client_id===c.id&&b.draft===true&&b.status==='Draft'&&!b.signingToken&&(!b.surfaces||!b.surfaces.length)&&(b.trade_type===_curTrade||!b.trade_type));
  if(_existingDraft){
    lastCreatedBidId=_existingDraft.id;
    if(_existingDraft.surfaces&&_existingDraft.surfaces.length){
      estSurfaces=[..._existingDraft.surfaces];
      estSurfId=estSurfaces.reduce((mx,s)=>Math.max(mx,s.id||0),0);
    }
    if(_existingDraft.roomScopeMap)roomScopeMap=JSON.parse(JSON.stringify(_existingDraft.roomScopeMap));
    showToast('Resuming your previous estimate','✏️');
  } else {
    // Create a draft bid immediately so notes have an ID to attach to from the first stroke
    const draftBid={
      id:_newBidId(),
      client_id:c.id,
      client_name:c.name||'',
      name:c.name||'',
      phone:c.phone||'',
      addr:c.addr||'',
      bid_date:todayKey(),
      amount:0,
      status:'Draft',
      draft:true,
      notesCanvas:null,
      surfaces:[],
      scope:{},
      trade_type:_trade,
    };
    bids.unshift(draftBid);
    lastCreatedBidId=draftBid.id;
    saveAll();
  }
  setTimeout(()=>{
    const sf=(id,val)=>{const el=document.getElementById(id);if(el)el.value=val;};
    sf('e-cname',c.name||'');
    sf('e-cphone',c.phone||'');
    sf('e-caddr',_overrideAddr||c.addr||'');
    if((_overrideAddr||c.addr)&&typeof _paintLookupClientTaxRate==='function')_paintLookupClientTaxRate();
    // If client has multiple addresses, show a picker hint below the address field (skip if override provided)
    _estAddrOptions=_overrideAddr?[{label:'New property',addr:_overrideAddr}]:[{label:'Primary',addr:c.addr||''},...(c.extraAddresses||[])];
    const _addrField=document.getElementById('e-caddr');
    const _oldHint=document.getElementById('_est-addr-picker');if(_oldHint)_oldHint.remove();
    if(_addrField&&_estAddrOptions.length>1){
      const _hint=document.createElement('div');_hint.id='_est-addr-picker';
      _hint.style.cssText='margin-top:4px;display:flex;gap:6px;flex-wrap:wrap';
      _hint.innerHTML=_estAddrOptions.map((a,i)=>'<button type="button" onclick="_pickEstAddr('+i+')" style="font-size:10px;padding:4px 9px;border:1px solid '+(i===0?'var(--blue)':'var(--border2)')+';border-radius:20px;background:'+(i===0?'var(--blue)':'var(--bg2)')+';color:'+(i===0?'#fff':'var(--text3)')+';cursor:pointer;font-family:inherit;font-weight:600">'+escHtml(a.label)+'</button>').join('');
      _addrField.parentElement.appendChild(_hint);
    }
    sf('e-cnotes','');
    if(c.ptype){const el=document.getElementById('e-cprop');if(el)el.value=c.ptype;}
    if(S.bname)sf('e-bname',S.bname);
    if(S.bphone)sf('e-bphone',S.bphone);
    if(S.blic)sf('e-blic',S.blic);
    sf('e-r-walls',S.rWalls||1.30);sf('e-r-ceil',S.rCeil||1.00);sf('e-r-trim',S.rTrim||3.25);sf('e-r-walls-adv',S.rWalls||1.30);sf('e-r-ceil-adv',S.rCeil||1.00);sf('e-r-trim-adv',S.rTrim||3.25);sf('e-r-door',S.rDoor||95);sf('e-r-door-adv',S.rDoor||95);sf('e-r-win',S.rWin||50);sf('e-r-ext',S.rExt||1.10);sf('e-r-deck',S.rDeck||1.00);
    sf('e-r-door',S.rDoor||95);sf('e-r-win',S.rWin||50);sf('e-r-ext',S.rExt||1.10);
    sf('e-r-deck',S.rDeck||1.00);sf('e-paint-rate',83);
    SCOPE_ITEMS.forEach(sc=>{sf(sc.rateKey,sc.defaultRate);});
    const cmiles=getClientMileage(currentClientId);
    const totalMiles=cmiles.reduce((s,m)=>s+(m.miles||0),0);
    if(totalMiles>0){
      sf('e-travel', (Math.round(totalMiles*10)/10).toString());
      const tel=document.getElementById('e-travel');
      if(tel){tel.style.background='var(--green-lt)';tel.title=cmiles.length+' GPS trip(s) pre-filled';}
    } else {
      sf('e-travel','0');
    }
    const sel=document.getElementById('e-client-sel');
    if(sel){
      let found=false;
      for(let i=0;i<sel.options.length;i++){if(parseInt(sel.options[i].value)===currentClientId){sel.selectedIndex=i;found=true;break;}}
    }
    const linked=document.getElementById('e-client-linked');
    if(linked)linked.innerHTML='<span class="conn-tag">'+escHtml(c.name)+'</span>';
    const adj=document.getElementById('est-adj');if(adj)adj.value=0;
    const adjv=document.getElementById('est-adj-val');if(adjv)adjv.textContent='0%';
    ['adj-type-hidden','adj-reason-hidden','inc-notes'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
    const _ars=document.getElementById('adj-reason-summary');if(_ars)_ars.style.display='none';
    scopeActiveMap={};scopeHrsStore={};roomScopeMap={};estPropertyTier={key:'avg',mult:1.00,paint:'ProMar 200'};
  SCOPE_ITEMS.forEach(s=>{const cb=document.getElementById('est-sc-'+s.id),tog=document.getElementById('est-st-'+s.id);if(cb){cb.checked=false;if(tog)tog.classList.remove('on');}});
    const epEl=document.getElementById('e-paint');if(epEl)epEl.value='interior';const custEl2=document.getElementById('e-customer-paint');if(custEl2)custEl2.value='';
    document.querySelectorAll('#paint-picker .surf-type-btn').forEach(b=>b.classList.remove('active-surf-btn'));
    const edEl=document.getElementById('e-days');
    if(edEl){edEl.value='';edEl.style.borderColor='#A32D2D';edEl.style.background='var(--red-lt)';}
    const ecEl=document.getElementById('e-cond');if(ecEl)ecEl.value='1.0';
  const wknd=document.getElementById('e-allow-weekend');if(wknd)wknd.checked=false;
    document.querySelectorAll('[id^=cond-]').forEach(b=>b.classList.remove('active-surf-btn'));
    // Mark client fields as filled (they came from record) — clears red borders
    ['e-cname','e-cphone','e-caddr'].forEach(id=>{
      const el=document.getElementById(id);
      if(el&&el.value){markFieldFilled(el);}
    });
    // Re-check step 1 readiness — client fields filled, paint/days still needed
    checkStep1Ready();
    renderEstSurfs();
    goEstStep(1);
    goEstStep(3); // Jump to surfaces (step 2 is merged in)
  },50);
  goPg('pg-est');
}

let dashYear=new Date().getFullYear();
Object.defineProperty(window,'dashYear',{get:()=>dashYear,set:v=>{dashYear=v;},configurable:true});
let dashPeriod='year';
Object.defineProperty(window,'dashPeriod',{get:()=>dashPeriod,set:v=>{dashPeriod=v;},configurable:true});

function _dashInRange(dateStr){
  const ds=String(dateStr==null?'':dateStr);
  if(!ds)return false;
  // shadow local to use coerced string
  dateStr=ds;
  if(dashPeriod==='all')return true;
  if(dashPeriod==='year')return dateStr.startsWith(String(dashYear));
  const cm=new Date().getMonth();
  if(dashPeriod==='month')return dateStr.startsWith(String(dashYear)+'-'+String(cm+1).padStart(2,'0'));
  if(dashPeriod==='quarter'){
    const cq=Math.floor(cm/3);
    const months=[[1,2,3],[4,5,6],[7,8,9],[10,11,12]][cq].map(m=>String(dashYear)+'-'+String(m).padStart(2,'0'));
    return months.some(m=>dateStr.startsWith(m));
  }
  return dateStr.startsWith(String(dashYear));
}

function initDashYear(){
  const sel=document.getElementById('dash-year-sel');
  if(!sel)return;
  const years=new Set();
  const cy=new Date().getFullYear();
  years.add(cy);
  income.forEach(r=>{if(r.date)years.add(parseInt(r.date.slice(0,4)));});
  expenses.forEach(e=>{if(e.date)years.add(parseInt(e.date.slice(0,4)));});
  mileage.forEach(m=>{if(m.date)years.add(parseInt(m.date.slice(0,4)));});
  const sorted=[...years].filter(y=>y>2015&&y<=cy+1).sort((a,b)=>b-a);
  sel.innerHTML=sorted.map(y=>'<option value="'+y+'"'+(y===dashYear?' selected':'')+'>'+y+'</option>').join('');
  const lbl=document.getElementById('dash-year-label');
  if(lbl)lbl.textContent=dashYear;
  const ybw=document.getElementById('dash-year-btn-wrap');
  if(ybw)ybw.style.display=dashPeriod==='all'?'none':'';
}

function setDashYear(yr){
  dashYear=parseInt(yr);
  const lbl=document.getElementById('dash-year-label');
  if(lbl)lbl.textContent=dashYear;
  renderDash();
}

function setDashPeriod(p){
  dashPeriod=p;
  ['month','quarter','year','all'].forEach(id=>{
    const btn=document.getElementById('dps-'+id);
    if(btn)btn.classList.toggle('on',id===p);
  });
  const ybw=document.getElementById('dash-year-btn-wrap');
  if(ybw)ybw.style.display=p==='all'?'none':'';
  renderDash();
}

function _clientBaseUrl(){
  if(S.subdomain)return 'https://'+S.subdomain+'.tradedeskpro.app/';
  return window.location.origin+window.location.pathname.split('index.html')[0];
}

// ── Client hub directory (one row per client with hub status + share actions) ──
function _clientHubUrl(c){
  if(!c?.clientToken||!_supaUser)return null;
  return _clientBaseUrl()+'client.html?t='+c.clientToken+'&u='+_supaUser.id+'&c='+c.id;
}
function renderClientHubPage(){
  const el=document.getElementById('client-hub-list');if(!el)return;
  const subEl=document.getElementById('client-hub-sub');
  // Newest activity first — sort by created date desc as a reasonable default
  const sorted=[...clients].sort((a,b)=>(b.created||'').localeCompare(a.created||''));
  if(subEl)subEl.textContent=sorted.length?sorted.length+' client'+(sorted.length!==1?'s':'')+'  · tap any row to preview':'Every client has a private project portal — preview, share, or copy any link.';
  if(!sorted.length){
    el.innerHTML='<div class="card hub-empty-card"><div style="font-size:36px;margin-bottom:8px">📂</div><h3>No clients yet</h3><p>Add your first client from the Clients tab and a private hub link is created automatically.</p><button class="btn btn-p" onclick="goPg(\'pg-clients\')">Go to Clients →</button></div>';
    return;
  }
  const rowHtml=c=>{
    const url=_clientHubUrl(c);
    if(!url)return ''; // token not yet generated — skip row
    const _stg=getClientStage(c.id);
    const statusBadge=_stg?`<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:20px;background:${_stg.color}22;color:${_stg.color};white-space:nowrap">${escHtml(_stg.label)}</span>`:'';
    const phone=(c.phone||'').replace(/\D/g,'');
    const firstName=(c.name||'there').split(/[\s,]+/)[0];
    const bname=S.bname||'TradeDesk';
    const smsBody=_smsApply(S.smsHub||_getSmsDefaults().hub,{name:firstName,business:bname,url});
    const addrLine=c.addr?c.addr.split(',')[0]:'';
    const metaParts=[addrLine?escHtml(addrLine):'',c.phone?escHtml(c.phone):''].filter(Boolean).join(' · ');
    const actions='<button class="btn btn-sm" onclick="event.stopPropagation();_previewClientHub(\''+url+'\',\''+escHtml(c.name||'')+'\','+c.id+')" >👁 Preview</button>'+
      '<button class="btn btn-sm" onclick="event.stopPropagation();_clientHubCopy(\''+url+'\',this)">📋 Copy</button>'+
      (phone?'<button class="btn btn-sm btn-p" onclick="event.stopPropagation();window.location.href=\'sms:'+phone+'?body='+encodeURIComponent(smsBody)+'\'">📱 Send</button>':'');
    return '<div class="hub-dir-row" onclick="openClientDetail('+c.id+',\'clients\')">'+
      '<div class="hub-dir-l">'+
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">'+
          '<div class="hub-dir-name">'+escHtml(c.name||'Unnamed client')+'</div>'+
          statusBadge+
        '</div>'+
        (metaParts?'<div class="hub-dir-meta">'+metaParts+'</div>':'')+
      '</div>'+
      '<div class="hub-dir-r">'+actions+'</div>'+
    '</div>';
  };
  el.innerHTML='<div class="card card-pad-0">'+sorted.map(rowHtml).join('')+'</div>';
}
function _previewClientHub(url,clientName,clientId){
  if(!url)return;
  // Log as contractor preview so "You previewed" badge appears on the dashboard.
  // We make the call from here (main app context) where _supaUser and bids[] are live,
  // then open the iframe with &preview=1 so client.html skips its own hub tracking.
  if(_supaUser&&clientId){
    const _pvBids=bids.filter(b=>b.client_id===clientId&&b.signingToken);
    _pvBids.forEach(b=>{
      fetch(SUPA_URL+'/functions/v1/log-proposal-view',{
        method:'POST',
        headers:{'Content-Type':'application/json','apikey':SUPA_KEY,'Authorization':'Bearer '+SUPA_KEY},
        body:JSON.stringify({contractorUserId:_supaUser.id,bidId:String(b.id),viewerType:'contractor'})
      }).catch(()=>{});
    });
  }
  const previewUrl=url+(url.includes('?')?'&':'?')+'preview=1';
  let ov=document.getElementById('_hub-preview-ov');
  if(!ov){
    ov=document.createElement('div');
    ov.id='_hub-preview-ov';
    ov.style.cssText='position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;background:#000';
    document.body.appendChild(ov);
  }
  ov.innerHTML=
    '<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:#1B1612;flex-shrink:0;padding-top:max(10px,env(safe-area-inset-top))">'+
      '<button onclick="document.getElementById(\'_hub-preview-ov\').remove()" style="display:flex;align-items:center;gap:5px;background:rgba(255,255,255,.12);border:none;color:#fff;font-size:13px;font-weight:700;padding:7px 12px;border-radius:8px;cursor:pointer;font-family:inherit">'+
        '← TradeDesk'+
      '</button>'+
      '<div style="font-size:13px;color:rgba(255,255,255,.6);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+(clientName?escHtml(clientName)+' — Hub preview':'Hub preview')+'</div>'+
    '</div>'+
    '<iframe src="'+previewUrl+'" style="flex:1;border:none;width:100%" allow="payment"></iframe>';
  ov.style.display='flex';
}
function _clientHubCopy(url,btn){
  navigator.clipboard.writeText(url).then(()=>{
    if(btn){const orig=btn.textContent;btn.textContent='✓ Copied';setTimeout(()=>{btn.textContent=orig;},1600);}
    if(typeof showToast==='function')showToast('Hub link copied','📋');
  }).catch(()=>{
    if(typeof showToast==='function')showToast('Could not copy link','⚠️');
  });
}
function pipelineResendSms(bidId){
  const b=bids.find(x=>x.id===bidId);
  if(!b||!b.signingToken)return;
  const baseUrl=_clientBaseUrl();
  const signUrl=baseUrl+'sign.html?t='+b.signingToken+'&u='+(window._supaUser?.id||'')+'&b='+bidId;
  const c=getClientById(b.client_id);
  const hubUrl=c?.clientToken?baseUrl+'client.html?t='+c.clientToken+'&u='+(_supaUser?.id||'')+'&c='+c.id:null;
  const url=hubUrl||signUrl;
  const firstName=(c?c.name:b.client_name||b.name||'Client').split(/[\s,&]+/)[0];
  const bname=S.bname||'TradeDesk';
  const phone=(c?.phone||b.phone||'').replace(/\D/g,'');
  const msg=_smsApply(S.smsFollowup||_getSmsDefaults().followup,{name:firstName,business:bname,url});
  window.location.href='sms:'+phone+'?body='+encodeURIComponent(msg);
}
function onClientSearch(inp){
  const q=inp.value.trim();
  if(q){
    const el=document.getElementById('client-list');
    const tk=todayKey();
    const ql=q.toLowerCase();
    const matched=clients.filter(c=>
      (c.name||'').toLowerCase().includes(ql)||
      (c.addr||'').toLowerCase().includes(ql)||
      (c.phone||'').replace(/\D/g,'').includes(q.replace(/\D/g,''))||
      (c.source||'').toLowerCase().includes(ql)
    );
    if(!matched.length){el.innerHTML='<div class="empty">No clients match "'+escHtml(q)+'".</div>';return;}
    el.innerHTML=matched.map(c=>{
      const s=getClientStage(c.id);
      const pendBids=getClientBids(c.id).filter(b=>b.status==='Pending');
      const pendBidSuffix=pendBids.length>1?' · '+pendBids.length+' bids out':pendBids.length===1?' · '+fmt(pendBids[0].amount):'';
      return '<div class="client-card" onclick="openClientDetail('+c.id+')" style="margin-bottom:4px">'+
        '<div style="display:flex;align-items:center;gap:10px">'+
          '<div class="cc-avatar" style="width:36px;height:36px;font-size:12px;flex-shrink:0;'+stageAvatar(s.stage)+'">'+initials(c.name)+'</div>'+
          '<div style="flex:1;min-width:0">'+
            '<div style="font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml(c.name)+'</div>'+
            '<div style="font-size:11px;color:var(--text3)">'+s.label+pendBidSuffix+'</div>'+
          '</div>'+
          '<svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke:var(--text3);fill:none;stroke-width:2;flex-shrink:0"><polyline points="9 18 15 12 9 6"/></svg>'+
        '</div>'+
      '</div>';
    }).join('');
  } else {
    renderClientList();
  }
}

function setCF(f,btn){
  clientFilter=f;
  document.querySelectorAll('[id^=cft-]').forEach(b=>b.classList.remove('active'));
  if(btn){
    btn.classList.add('active');
  } else {
    const active=document.getElementById('cft-'+f);
    if(active)active.classList.add('active');
  }
  renderClientList();
}
function populateClientSelectors(){
  const opts='<option value="">— Select client —</option>'+clients.map(c=>`<option value="${c.id}">${escHtml(c.name)}</option>`).join('');
  ['e-client-sel','inc-client-sel','mil-client-sel'].forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML=opts;});
}
function getClientStage(cid){
  const tk=todayKey();
  const cbids=getClientBids(cid);
  const cjobs=getClientJobs(cid).filter(j=>j.eventType!=='estimate');
  const estJobs=getClientJobs(cid).filter(j=>j.eventType==='estimate');

  const activeJob=cjobs.find(j=>{
    const d=parseInt(j.days)||1;
    for(let i=0;i<d;i++)if(addDays(j.start,i)===tk)return true;
    return false;
  });
  if(activeJob)return{stage:'active',label:'Active job today',color:'var(--green-mid)',priority:1};

  // Check won bids FIRST — a client who signed and paid is never a "lead"
  const wonBids=cbids.filter(b=>b.status==='Closed Won');
  if(wonBids.length){
    const unpaid=wonBids.filter(b=>getBidBalance(b)>0.01);
    const paid=wonBids.filter(b=>getBidBalance(b)<=0.01);
    const completeUnpaid=unpaid.filter(b=>b.completion_date);
    if(completeUnpaid.length)return{stage:'balance_due',label:'Balance due',color:'#A32D2D',priority:2};
    const scheduled=cjobs.find(j=>j.bid_id&&wonBids.find(b=>b.id===j.bid_id)&&j.start>=tk&&j.status!=='done');
    if(scheduled)return{stage:'scheduled',label:'Job scheduled',color:'#185FA5',priority:4};
    if(unpaid.length)return{stage:'signed',label:'Signed — schedule job',color:'var(--blue)',priority:3};
    if(paid.length)return{stage:'paid',label:'Paid in full',color:'var(--green)',priority:8};
  }

  const pendingBids=cbids.filter(b=>b.status==='Pending');
  if(pendingBids.length){
    const sentBids=pendingBids.filter(b=>b.signingToken);
    const unsentBids=pendingBids.filter(b=>!b.signingToken);
    // Saved but never sent to client — show as 'est_ready' (distinct from sent bids)
    if(!sentBids.length&&unsentBids.length){
      return{stage:'est_ready',label:'Estimate ready to send',color:'var(--blue)',priority:5};
    }
    const activePending=sentBids.length?sentBids:unsentBids;
    const oldest=activePending.reduce((a,b)=>a.bid_date<b.bid_date?a:b);
    const days=oldest.bid_date?Math.floor((new Date(tk)-new Date(oldest.bid_date+'T12:00:00'))/(1000*60*60*24)):0;
    if(days>=30)return{stage:'abandoned',label:'Bid abandoned ('+days+'d)',color:'#999',priority:9};
    if(days>=14)return{stage:'bid_urgent',label:'Bid out '+days+'d — follow up',color:'var(--amber)',priority:5};
    return{stage:'bid_out',label:'Bid out',color:'#D85A30',priority:6};
  }

  const hasAnyBid=cbids.length>0;
  const upcomingEst=estJobs.find(j=>j.status!=='canceled'&&j.start>=tk);
  if(upcomingEst&&!hasAnyBid)return{stage:'est_scheduled',label:'Estimate '+parseD(upcomingEst.start).toLocaleDateString('en-US',{month:'short',day:'numeric'})+(upcomingEst.time?' @ '+upcomingEst.time:''),color:'#7F77DD',priority:7};

  const hasActiveBid=cbids.some(b=>b.status==='Pending'||b.status==='Closed Won');
  if(hasAnyBid&&!hasActiveBid)return{stage:'abandoned',label:'Abandoned',color:'#999',priority:9};

  const _c=clients.find(x=>x.id===cid);
  if(!_c||!(_c.addr||'').trim())return{stage:'incomplete',label:'Needs onboarding',color:'var(--amber)',priority:11};
  return{stage:'new',label:'New lead',color:'var(--text3)',priority:10};
}

function renderClientList(){
  populateClientSelectors();
  const tk=todayKey();
  const el=document.getElementById('client-list');
  if(!el)return;

  // Clients page only shows contacts who have signed an estimate (or beyond)
  const CLIENT_STAGES=['signed','scheduled','active','balance_due','paid'];
  const STAGE_BUCKETS={
    won:    c=>['signed','scheduled'].includes(getClientStage(c.id).stage),
    active: c=>getClientStage(c.id).stage==='active',
    collect:c=>getClientStage(c.id).stage==='balance_due',
    closed: c=>getClientStage(c.id).stage==='paid',
  };

  const countEl=document.getElementById('cf-tab-counts');
  if(countEl){
    const counts={};
    Object.keys(STAGE_BUCKETS).forEach(k=>{counts[k]=clients.filter(STAGE_BUCKETS[k]).length;});
    const labels={won:'Won',active:'Active',collect:'Collect',closed:'Closed'};
    Object.keys(counts).forEach(k=>{
      const btn=document.getElementById('cft-'+k);
      if(btn)btn.innerHTML=labels[k]+(counts[k]?'<span class="fb-count">'+counts[k]+'</span>':'');
    });
    const allTotal=clients.filter(c=>CLIENT_STAGES.includes(getClientStage(c.id).stage)).length;
    const allBtn=document.getElementById('cft-all');
    if(allBtn)allBtn.innerHTML='All'+(allTotal?'<span class="fb-count">'+allTotal+'</span>':'');
  }

  let filtered=clientFilter==='all'
    ?clients.filter(c=>CLIENT_STAGES.includes(getClientStage(c.id).stage))
    :(STAGE_BUCKETS[clientFilter]?clients.filter(STAGE_BUCKETS[clientFilter]):clients.filter(c=>CLIENT_STAGES.includes(getClientStage(c.id).stage)));

  if(!filtered.length){
    const emptyMsgs={
      won:'No signed jobs waiting to schedule.',active:'No active jobs today.',
      collect:'No outstanding balances.',closed:'No closed jobs yet.',
      all:'No clients yet — contacts become clients once they sign an estimate.'
    };
    el.innerHTML='<div class="empty">'+(emptyMsgs[clientFilter]||'No clients here.')+'</div>';
    return;
  }

  const withStage=filtered.map(c=>({c,s:getClientStage(c.id)}));
  if(clientFilter==='all'){
    withStage.sort((a,b)=>a.s.priority-b.s.priority);
  } else {
    withStage.sort((a,b)=>(b.c.created||'').localeCompare(a.c.created||''));
  }

  // Update tbar eyebrow
  const eyebrowEl=document.getElementById('clients-tbar-eyebrow');
  if(eyebrowEl){
    const activeCount=clients.filter(c=>getClientStage(c.id).stage==='active').length;
    eyebrowEl.textContent=clients.length+' client'+(clients.length!==1?'s':'')+' · '+activeCount+' active today';
  }

  el.innerHTML=withStage.map(({c,s})=>{
    const wonBids=getClientBids(c.id).filter(b=>b.status==='Closed Won');
    const totalOwed=wonBids.reduce((sum,b)=>sum+getBidBalance(b),0);
    const pendBids=getClientBids(c.id).filter(b=>b.status==='Pending');
    const hasBal=totalOwed>0.01;
    const ltv=wonBids.reduce((sum,b)=>sum+(b.amount||0),0);
    const addrPart=(c.addr||'').split(',')[0];
    // Overdue 30+ days badge
    const _overduebal=hasBal&&wonBids.some(b=>{
      const bal=getBidBalance(b);if(bal<0.01)return false;
      const startDate=new Date(b.completion_date||b.signedAt||Date.now());
      return Math.floor((Date.now()-startDate.getTime())/86400000)>=30;
    });

    // Status badge
    const bdgMap={
      active:      {cls:'sf-active',   label:'ACTIVE'},
      scheduled:   {cls:'sf-upcoming', label:'SCHEDULED'},
      balance_due: {cls:'sf-overdue',  label:'BALANCE DUE'},
      paid:        {cls:'sf-won',      label:'PAID'},
      signed:      {cls:'sf-deposit',  label:'SIGNED'},
      est_ready:   {cls:'sf-deposit',  label:'EST READY'},
    };
    const bdg=bdgMap[s.stage]||{cls:'sf-done',label:s.label.toUpperCase()};

    const cardCls=s.stage==='active'?'client-card has-active':
                  (s.stage==='signed'||s.stage==='scheduled')?'client-card has-bid':
                  'client-card';

    return '<div class="'+cardCls+'" data-lp-id="'+c.id+'" data-lp-type="client" data-lp-label="'+escHtml(c.name||'client')+'" onclick="openClientDetail('+c.id+')" style="margin-bottom:8px">'+
      '<div class="cc-row">'+
        '<div class="cc-l">'+
          '<div class="cc-avatar">'+initials(c.name)+'</div>'+
          '<div style="min-width:0;flex:1">'+
            '<div class="cc-name">'+escHtml(c.name)+'</div>'+
            '<div class="cc-meta">'+escHtml(addrPart||c.phone||'No address')+'</div>'+
            '<div class="cc-stats">'+
              (ltv>0?'<span class="cc-stat">'+fmt(ltv)+' LTV</span>':'')+
              (c.source?'<span class="cc-stat">'+escHtml(c.source)+'</span>':'')+
              (hasBal?'<span class="cc-stat" style="color:var(--c-red);background:var(--c-red-soft);border-color:var(--c-red-edge)">'+fmt(totalOwed)+' owed</span>':'')+
              (_overduebal?'<span class="cc-stat" style="color:#fff;background:#A32D2D;border-color:#A32D2D;font-weight:800">30+ days overdue</span>':'')+
              (pendBids.length&&!hasBal?'<span class="cc-stat">'+pendBids.length+' bid'+(pendBids.length>1?'s':'')+' out</span>':'')+
            '</div>'+
          '</div>'+
        '</div>'+
        '<span class="bdg-soft '+bdg.cls+'" style="flex-shrink:0">'+bdg.label+'</span>'+
      '</div>'+
    '</div>';
  }).join('');
  const pb=bids.filter(b=>b.status==='Pending').length;
  const badge=document.getElementById('nb-bid-badge');if(badge){badge.textContent=pb;badge.style.display=pb?'flex':'none';}
  return;
  let filtered2=clients;

  if(!filtered.length){el.innerHTML='<div class="empty">No clients here.</div>';return;}

}
function togglePipeGroup(key){
  if(!window._pipelineExpand)window._pipelineExpand={};
  window._pipelineExpand[key]=!window._pipelineExpand[key];
  const grp=document.getElementById('pipe-grp-'+key);
  if(grp)grp.style.display=window._pipelineExpand[key]?'block':'none';
  const grpDiv=document.querySelector('[data-pkey="'+key+'"]');
  if(grpDiv){const a=grpDiv.querySelector('span');if(a)a.style.transform=window._pipelineExpand[key]?'rotate(90deg)':'';}
  if(typeof arrows!=='undefined'&&arrows&&arrows.forEach)arrows.forEach(a=>a.style.transform=window._pipelineExpand[key]?'rotate(90deg)':'');
}
function checkClientDupe(val){
  const warn=document.getElementById('cf-dupe-warn');if(!warn)return;
  if(!val||val.trim().length<3){warn.style.display='none';return;}
  const name=val.trim().toLowerCase().replace(/\s+/g,' ');
  const match=clients.find(c=>{
    if(editClientId&&c.id===editClientId)return false;
    return (c.name||'').toLowerCase().replace(/\s+/g,' ')===name;
  });
  if(match){warn.style.display='';warn.textContent='⚠ '+match.name+' is already in your records — is this a different client?';}
  else{warn.style.display='none';}
}
function openNewClient(){
  editClientId=null;
  const srch=document.getElementById('cf-search');if(srch)srch.value='';
  document.getElementById('cf-title').textContent='New lead';
  document.getElementById('cf-del').style.display='none';
  ['cf-name','cf-phone','cf-street','cf-city','cf-state','cf-zip','cf-ref','cf-notes'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const dw=document.getElementById('cf-dupe-warn');if(dw)dw.style.display='none';;
  const csrc=document.getElementById('cf-source');if(csrc)csrc.value='';
  const crw=document.getElementById('cf-ref-wrap');if(crw)crw.style.display='none';
  document.getElementById('cf-ptype').value='Single family home';
  document.getElementById('client-list').style.display='none';
  const sw=document.getElementById('cf-search-wrap');if(sw)sw.style.display='none';
  document.getElementById('client-form-wrap').style.display='block';
  const pt=document.getElementById('clients-page-title');if(pt)pt.textContent='New Lead';
  const nb=document.getElementById('clients-new-btn');if(nb)nb.style.display='none';
  window.scrollTo(0,0);
  setTimeout(()=>{const n=document.getElementById('cf-name');if(n)n.focus();},100);
}
function checkYearBuilt(){
  const yr=parseInt(document.getElementById('cf-year-built')?.value||'');
  const warn=document.getElementById('cf-year-warn');
  if(warn)warn.style.display=(yr&&yr<1978)?'block':'none';
}
function _updateAddrComputed(){
  const street=(document.getElementById('cf-street')?.value||'').trim();
  const city=(document.getElementById('cf-city')?.value||'').trim();
  const btn=document.getElementById('cf-year-lookup');
  if(btn)btn.style.display=(street&&city)?'inline-block':'none';
}
function updateYearLookupBtn(){_updateAddrComputed();}
function lookupYearBuilt(){
  const street=(document.getElementById('cf-street')?.value||'').trim();
  const city=(document.getElementById('cf-city')?.value||'').trim();
  const state=(document.getElementById('cf-state')?.value||'').trim();
  const addr=[street,city,state].filter(Boolean).join(', ');
  if(addr)window.open('https://www.google.com/search?q=year+built+'+encodeURIComponent(addr),'_blank');
}
function _parseAddrParts(addr){
  const m=(addr||'').match(/^(.+?),\s*(.+?),?\s*([A-Z]{2})\s*(\d{5}(?:-\d{4})?)?$/i);
  return m?{street:m[1].trim(),city:m[2].trim(),state:m[3].toUpperCase(),zip:(m[4]||'').trim()}:{street:(addr||'').trim(),city:'',state:'',zip:''};
}
function openEditClient(){
  const c=getClientById(currentClientId);if(!c)return;
  editClientId=currentClientId;
  document.getElementById('cf-title').textContent='Edit client';
  document.getElementById('cf-del').style.display='inline-block';
  document.getElementById('cf-name').value=c.name||'';
  document.getElementById('cf-phone').value=formatPhoneDisplay(c.phone||'');
  const _ep=_parseAddrParts(c.addr||'');
  document.getElementById('cf-street').value=c.street||_ep.street||'';
  document.getElementById('cf-city').value=c.city||_ep.city||'';
  document.getElementById('cf-state').value=c.state||_ep.state||'';
  document.getElementById('cf-zip').value=c.zip||_ep.zip||'';
  document.getElementById('cf-ptype').value=c.ptype||'Single family home';
  document.getElementById('cf-email').value=c.email||'';
  document.getElementById('cf-ref').value=c.ref||'';
  const csrc2=document.getElementById('cf-source');if(csrc2)csrc2.value=c.source||'';
  const cocc=document.getElementById('cf-occupation');if(cocc)cocc.value=c.occupation||'';
  const ctier=document.getElementById('cf-tier');if(ctier)ctier.value=c.tier||'';
  const crw2=document.getElementById('cf-ref-wrap');if(crw2)crw2.style.display=c.source==='Referral'?'block':'none';
  document.getElementById('cf-notes').value=c.notes||'';
  const cyb=document.getElementById('cf-year-built');if(cyb)cyb.value=c.yearBuilt||'';
  checkYearBuilt();updateYearLookupBtn();
  window._editClientOrigin=window._clientDetailOrigin||'clients';
  goPg('pg-clients');
  setTimeout(()=>{document.getElementById('client-form-wrap').style.display='block';document.getElementById('client-form-wrap').scrollIntoView({behavior:'smooth',block:'nearest'});},50);
}
function showFErr(fieldId,errId,msg){
  const f=document.getElementById(fieldId);
  const e=document.getElementById(errId);
  if(f){f.style.borderColor='#A32D2D';f.style.background='var(--red-lt)';}
  if(e){e.textContent=msg;e.style.display='block';}
  if(f){f.scrollIntoView&&f.scrollIntoView({behavior:'smooth',block:'center'});f.focus();}
}
function clearFErr(fieldId){
  const f=document.getElementById(fieldId);
  const e=document.getElementById('err-'+fieldId);
  if(f){f.style.borderColor='';f.style.background='';}
  if(e){e.textContent='';e.style.display='none';}
}
function saveClient(){
  if(_submitting)return;
  _submitting=true;setTimeout(()=>{_submitting=false;},1500);
  // Clear all field errors first
  ['cf-name','cf-phone','cf-street','cf-source'].forEach(clearFErr);
  const name=v('cf-name').trim();
  if(!name){_submitting=false;showFErr('cf-name','err-cf-name','Enter a name.');return;}
  const phone=v('cf-phone').trim();
  if(!phone){_submitting=false;showFErr('cf-phone','err-cf-phone','Enter a phone number.');return;}
  if(phone.replace(/\D/g,'').length<10){_submitting=false;showFErr('cf-phone','err-cf-phone','Enter a valid 10-digit phone number.');return;}
  // Address is optional — leads often come in without one; add later from profile
  const street=v('cf-street').trim();
  const city=v('cf-city').trim();
  const state=v('cf-state').trim().toUpperCase();
  const zip=v('cf-zip').trim();
  const addr=[street,city,[state,zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const source=v('cf-source')||'';
  if(!source){_submitting=false;showFErr('cf-source','err-cf-source','Select a lead source — this tracks what\'s working.');return;}
  const isNew=!editClientId;
  if(isNew){
    const ph=phone.replace(/\D/g,'');
    const nameLow=name.toLowerCase().replace(/\s+/g,' ');
    const realPhone=ph.length===10&&!/^(\d)\1+$/.test(ph);
    // Name match = hard block (almost certainly a re-entry of the same person)
    const nameDupe=clients.find(x=>x.id!==editClientId&&(x.name||'').toLowerCase().replace(/\s+/g,' ')===nameLow);
    if(nameDupe){_submitting=false;showFErr('cf-name','err-cf-name',nameDupe.name+' is already in your list. Is this a different person with the same name?');return;}
    // Phone match = soft warning — two people can share a number (family), allow override
    const phoneDupe=realPhone?clients.find(x=>x.id!==editClientId&&(x.phone||'').replace(/\D/g,'')===ph):null;
    if(phoneDupe&&!_allowPhoneDupe){
      _submitting=false;
      const errEl=document.getElementById('err-cf-phone');
      if(errEl){
        errEl.innerHTML='This number is already on file for <strong>'+escHtml(phoneDupe.name)+'</strong>. Same person? If not, <button onclick="_allowPhoneDupe=true;saveClient()" style="background:none;border:none;color:var(--blue);font-weight:700;cursor:pointer;padding:0;font-size:inherit;font-family:inherit">save anyway →</button>';
        errEl.style.display='block';
      }
      return;
    }
    // Address match = info only — landlords and shared addresses are valid
    if(street&&city){
      const addrNorm=addr.toLowerCase().replace(/\s+/g,' ');
      const addrDupe=clients.find(x=>x.id!==editClientId&&x.addr&&x.addr.toLowerCase().replace(/\s+/g,' ')===addrNorm);
      if(addrDupe){
        const errEl=document.getElementById('err-cf-addr');
        if(errEl){errEl.textContent='Note: this address is already on file for '+addrDupe.name+'.';errEl.style.color='var(--text3)';errEl.style.display='block';}
      }
    }
  }
  _allowPhoneDupe=false;
  const ref=v('cf-ref')||'';
  const occupation=v('cf-occupation')||'';
  const tier=v('cf-tier')||'';
  const _existingClient=editClientId?clients.find(x=>x.id===editClientId):null;
  const _ybRaw=parseInt(document.getElementById('cf-year-built')?.value||'');
  const c={id:editClientId||Date.now(),name,phone:v('cf-phone'),email:v('cf-email'),
    addr,street,city,state,zip,
    ptype:v('cf-ptype'),source,ref,notes:v('cf-notes'),created:todayKey(),
    yearBuilt:_ybRaw||_existingClient?.yearBuilt||null,
    sqft:_existingClient?.sqft||null,estimatedValue:_existingClient?.estimatedValue||null,
    propertyType:_existingClient?.propertyType||null,stories:_existingClient?.stories||null,
    exteriorMaterial:_existingClient?.exteriorMaterial||null,lastSaleDate:_existingClient?.lastSaleDate||null,
    lastSalePrice:_existingClient?.lastSalePrice||null,lotSize:_existingClient?.lotSize||null,
    roofType:_existingClient?.roofType||null,garage:_existingClient?.garage||null,
    bedrooms:_existingClient?.bedrooms||null,bathrooms:_existingClient?.bathrooms||null,
    isRental:_existingClient?.isRental||null,assessorUrl:_existingClient?.assessorUrl||null,
    propDataSource:_existingClient?.propDataSource||null,propDataExact:_existingClient?.propDataExact??null,
    propDataFetchedAt:_existingClient?.propDataFetchedAt||null,
    extraAddresses:_existingClient?.extraAddresses||[],clientToken:_existingClient?.clientToken||'',clientHubKey:_existingClient?.clientHubKey||''};
  if(editClientId){const i=clients.findIndex(x=>x.id===editClientId);if(i>=0)clients[i]=c;}
  else{
    clients.push(c);
    _ensureClientToken(c.id);
    // Auto-generate hub immediately so onboarding link works on first send
    if(supaEnabled()&&_supaUser)_uploadClientHub(c.id).catch(()=>{});
  }
  saveAll();
  const _prevAddr=_existingClient?.addr||'';
  const _noPropData=!_existingClient?.propDataFetchedAt;
  if(street&&city&&(addr!==_prevAddr||_noPropData))_lookupPropertyData(c.id,{street,city,state,zip});
  if(isNew){
    closeClientForm();
    currentClientId=c.id;
    renderClientDetail();
    goPg('pg-client-detail');
  } else {
    closeClientForm();
    renderClientList();
    if(window._editClientOrigin==='leads')goPg('pg-leads');
  }
}
function deleteClient(){
  if(!editClientId)return;
  zConfirm('Permanently delete this client and ALL their bids, jobs, expenses, and mileage?',()=>{
    const id=editClientId;
    _userDelete(()=>{
      clients=clients.filter(x=>x.id!==id);
      bids=bids.filter(b=>b.client_id!==id);
      jobs=jobs.filter(j=>j.client_id!==id);
      mileage=mileage.filter(m=>m.client_id!==id);
      income=income.filter(i=>i.client_id!==id);
      expenses=expenses.filter(e=>e.client_id!==id);
      _flushSaveNow&&_flushSaveNow();
    });
    closeClientForm();goPg('pg-clients');
  },{title:'Delete client',yes:'Delete everything',danger:true});
}
function closeClientForm(){
  document.getElementById('client-form-wrap').style.display='none';
  document.getElementById('client-list').style.display='';
  const sw2=document.getElementById('cf-search-wrap');if(sw2)sw2.style.display='';
  const pt=document.getElementById('clients-page-title');if(pt)pt.textContent='Clients';
  const nb=document.getElementById('clients-new-btn');if(nb)nb.style.display='';
  editClientId=null;
}

// ── Contact Import ──────────────────────────────────────────
let _importContacts=[];

function openImportContacts(){
  const m=document.getElementById('import-modal');
  if(!m)return;
  _importContacts=[];
  document.getElementById('import-preview').style.display='none';
  const phoneOpt=document.getElementById('import-phone-opt');
  if(phoneOpt)phoneOpt.style.display=('contacts' in navigator&&'ContactsManager' in window)?'block':'none';
  m.style.display='flex';
}

function closeImportModal(){
  const m=document.getElementById('import-modal');
  if(m)m.style.display='none';
}

async function _importPhoneContacts(){
  try{
    const raw=await navigator.contacts.select(['name','tel','email'],{multiple:true});
    if(!raw||!raw.length){showToast('No contacts selected','ℹ️');return;}
    const parsed=raw.map(c=>({
      name:(c.name&&c.name[0])||'',
      phone:(c.tel&&c.tel[0])||'',
      email:(c.email&&c.email[0])||'',
      addr:'',city:'',state:'',zip:''
    })).filter(c=>c.name&&c.phone);
    _showImportPreview(parsed);
  }catch(e){showToast('Contact access denied','⚠️');}
}

function _handleImportFile(file){
  if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    const text=e.target.result;
    const ext=(file.name.split('.').pop()||'').toLowerCase();
    const parsed=(ext==='vcf'||ext==='vcard')?_parseVCard(text):_parseCSV(text);
    if(!parsed.length){showToast('No contacts found in file','⚠️');return;}
    _showImportPreview(parsed);
  };
  reader.readAsText(file);
}

const _IMPORT_FIELDS={
  name:    /^(full.?name|name|client|customer|contact|display.?name|client.?name)$/i,
  first:   /^(first.?name|first|fname|given.?name|forename)$/i,
  last:    /^(last.?name|last|lname|surname|family.?name)$/i,
  phone:   /^(phone|mobile|cell|telephone|tel|ph|number|phone.?number|mobile.?number|cell.?number|primary.?phone)$/i,
  email:   /^(email|e.?mail|email.?address)$/i,
  address: /^(address|street|addr|location|service.?address|street.?address|mailing.?address)$/i,
  city:    /^(city|town|municipality)$/i,
  state:   /^(state|province|st)$/i,
  zip:     /^(zip|postal|postal.?code|zip.?code)$/i,
};

function _parseCSV(text){
  const lines=text.split(/\r?\n/).filter(l=>l.trim());
  if(lines.length<2)return[];
  const headers=_csvRow(lines[0]).map(h=>h.trim());
  const map={};
  headers.forEach((h,i)=>{
    for(const[field,re] of Object.entries(_IMPORT_FIELDS)){
      if(re.test(h)&&!Object.values(map).includes(field)){map[i]=field;break;}
    }
  });
  const contacts=[];
  for(let r=1;r<lines.length;r++){
    const cols=_csvRow(lines[r]);
    const raw={};
    Object.entries(map).forEach(([i,field])=>{raw[field]=(cols[i]||'').trim();});
    if(!raw.name&&(raw.first||raw.last))raw.name=[raw.first,raw.last].filter(Boolean).join(' ');
    if(!raw.name||!raw.phone)continue;
    contacts.push({name:raw.name,phone:raw.phone,email:raw.email||'',addr:raw.address||'',city:raw.city||'',state:raw.state||'',zip:raw.zip||''});
  }
  return contacts;
}

function _csvRow(line){
  const cols=[];let cur='';let inQ=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(ch==='"'&&!inQ){inQ=true;continue;}
    if(ch==='"'&&inQ&&(i===line.length-1||line[i+1]===',')){inQ=false;continue;}
    if(ch===','&&!inQ){cols.push(cur);cur='';continue;}
    cur+=ch;
  }
  cols.push(cur);
  return cols;
}

function _parseVCard(text){
  const contacts=[];
  const cards=text.split(/BEGIN:VCARD/i).slice(1);
  cards.forEach(card=>{
    const get=re=>{const m=card.match(re);return m?(m[1]||'').trim():'';};
    let name=get(/^FN[^:\r\n]*:(.+)$/m);
    if(!name){
      const n=get(/^N[^:\r\n]*:(.+)$/m);
      if(n){const p=n.split(';');name=[p[1],p[0]].filter(Boolean).join(' ');}
    }
    const phone=get(/^TEL[^:\r\n]*:(.+)$/m);
    const email=get(/^EMAIL[^:\r\n]*:(.+)$/m);
    const adr=get(/^ADR[^:\r\n]*:(.+)$/m);
    let addr='',city='',state='',zip='';
    if(adr){const p=adr.split(';');addr=(p[2]||'').trim();city=(p[3]||'').trim();state=(p[4]||'').trim();zip=(p[5]||'').trim();}
    if(name&&phone)contacts.push({name,phone,email,addr,city,state,zip});
  });
  return contacts;
}

function _showImportPreview(parsed){
  const existingPhones=new Set(clients.map(c=>(c.phone||'').replace(/\D/g,'')));
  const existingNames=new Set(clients.map(c=>(c.name||'').toLowerCase().trim()));
  const toImport=parsed.filter(c=>{
    const ph=c.phone.replace(/\D/g,'');
    return ph.length>=7&&!existingPhones.has(ph)&&!existingNames.has((c.name||'').toLowerCase().trim());
  });
  const skipped=parsed.length-toImport.length;
  _importContacts=toImport;
  const preview=document.getElementById('import-preview');
  const summary=document.getElementById('import-preview-summary');
  const list=document.getElementById('import-preview-list');
  const btn=document.getElementById('import-confirm-btn');
  if(!preview)return;
  const hasEmail=toImport.some(c=>c.email);
  const hasAddr=toImport.some(c=>c.addr||c.city);
  summary.innerHTML='<strong>'+toImport.length+' contacts ready to import</strong>'+
    (hasEmail?' <span style="color:var(--green-mid)">· Email ✓</span>':'')+
    (hasAddr?' <span style="color:var(--green-mid)">· Address ✓</span>':'')+
    (skipped?' <span style="color:var(--text3)">· '+skipped+' skipped (already in list)</span>':'');
  list.innerHTML=toImport.slice(0,25).map(c=>
    '<div style="padding:7px 10px;border-bottom:1px solid var(--border2)">'+
      '<strong>'+escHtml(c.name)+'</strong>'+
      '<span style="color:var(--text3);margin-left:8px">'+escHtml(c.phone)+'</span>'+
      (c.email?'<span style="color:var(--text3);margin-left:8px">'+escHtml(c.email)+'</span>':'')+
    '</div>'
  ).join('')+(toImport.length>25?'<div style="padding:7px 10px;color:var(--text3)">…and '+(toImport.length-25)+' more</div>':'');
  if(btn)btn.textContent='Import '+toImport.length+' contacts';
  preview.style.display='block';
}

function _doImport(){
  if(!_importContacts.length)return;
  const today=todayKey();
  let added=0;
  _importContacts.forEach((c,i)=>{
    const id=Date.now()+i;
    const addr=[c.addr,c.city,[c.state,c.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    const nc={id,name:c.name,phone:c.phone,email:c.email||'',
      addr,street:c.addr||'',city:c.city||'',state:c.state||'',zip:c.zip||'',
      source:'Existing Contact',ref:'',notes:'',created:today,ptype:'',
      extraAddresses:[],clientToken:'',clientHubKey:''};
    clients.push(nc);
    _ensureClientToken(nc.id);
    added++;
  });
  saveAll();
  renderClients();
  closeImportModal();
  showToast(added+' contact'+(added!==1?'s':'')+' imported','✅');
  _importContacts=[];
}

function setCDTab(tab,btn){
  cdTab=tab;
  ['overview','mileage','bids','jobs','expenses','contracts'].forEach(t=>{
    const el=document.getElementById('cdt-'+t+'-content');if(el)el.style.display=t===tab?'block':'none';
    const b=document.getElementById('cdt-'+t);if(b)b.classList.toggle('active',t===tab);
  });
  if(tab==='mileage')renderCDMileage();
  if(tab==='bids')renderCDBids();
  if(tab==='jobs')renderCDJobs();
  if(tab==='expenses')renderCDExpenses();
  if(tab==='contracts')renderClientContracts(currentClientId);
}
function renderClientDetail(){
  const c=getClientById(currentClientId);if(!c)return;
  // Lazy-load property data for this client if not yet fetched
  if((c.addr||c.street)&&!c.propDataFetchedAt&&typeof _lookupPropertyData==='function'){
    const _lp=c.street&&c.city?{street:c.street,city:c.city,state:c.state||'',zip:c.zip||''}
      :(typeof _parseAddrParts==='function'?_parseAddrParts(c.addr||''):{street:c.addr||'',city:'',state:'',zip:''});
    if(_lp.street)setTimeout(()=>_lookupPropertyData(c.id,_lp),500);
  }
  // Compute financials up front so hero tiles can use them
  const _cbids=getClientBids(currentClientId);
  const _wonBids=_cbids.filter(b=>b.status==='Closed Won');
  const _totalOwed=_wonBids.reduce((sum,b)=>sum+getBidBalance(b),0);
  const _totalPaidAll=_wonBids.reduce((sum,b)=>sum+getBidPaid(b.id),0);
  const _ltv=_wonBids.reduce((sum,b)=>sum+(b.amount||0),0);
  const _tier=getClientTier(c);
  const _lastContactStr=(()=>{
    const d=c.last_contact_date;if(!d)return '—';
    const days=Math.floor((Date.now()-new Date(d+'T12:00').getTime())/86400000);
    if(days<1)return 'Today';if(days===1)return '1d ago';if(days<30)return days+'d ago';
    if(days<365)return Math.round(days/30)+'mo ago';return Math.round(days/365)+'y ago';
  })();
  const _eyebrow='TIER '+_tier+(c.source?' · '+escHtml(c.source):'')+(_ltv>0?' · LTV '+fmt(_ltv):'');
  document.getElementById('cd-hdr').innerHTML=
    '<div class="detail-eyebrow">'+
      '<span>'+_eyebrow+'</span>'+
      '<button class="btn btn-sm" onclick="openEditClient()" style="background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.2);color:#fff">Edit</button>'+
    '</div>'+
    '<div class="detail-name">'+escHtml(c.name)+' '+riskBadge(c.id)+'</div>'+
    '<div class="detail-addr">'+
      escHtml(c.addr||'No address')+(c.ptype?' · '+escHtml(c.ptype):'')+(c.yearBuilt?' · Built '+c.yearBuilt:'')+
      (getActiveTrade()==='painting'&&!c.yearBuilt?'<span onclick="openEditClient()" style="color:#fbbf24;font-weight:700;cursor:pointer;margin-left:6px">⚠️ Add year built</span>':'')+
    '</div>'+
    '<div class="detail-actions">'+
      (c.phone?'<button class="btn" onclick="callClient()">📞 Call</button>':'')+
      (c.phone?'<button class="btn" onclick="textClient();event.stopPropagation()">💬 SMS</button>':'')+
      (c.email?'<button class="btn" onclick="emailClient()">✉️ Email</button>':'')+
      (!gps.active?'<button class="btn" onclick="startDriveToClient()">🚗 Drive there</button>':'')+
      '<button class="btn" onclick="showHubMenu('+c.id+')">🔗 Client hub</button>'+
      '<button class="btn btn-p"'+(_canEstimate()?'':' style="opacity:.55"')+' onclick="openEstimateForClient()">'+(_canEstimate()?'':'🔒 ')+'+ New estimate</button>'+
    '</div>'+
    '';
  // Metric tiles — outside hero in split-3-eq grid
  const _heroMets=document.getElementById('cd-hero-mets');
  if(_heroMets){
    const _met=(label,val,sub,color)=>
      '<div class="met">'+
        '<div class="met-l">'+label+'</div>'+
        '<div class="met-v"'+(color?' style="color:'+color+'"':'')+'>'+(val||'—')+'</div>'+
        (sub?'<div class="met-s">'+sub+'</div>':'')+
      '</div>';
    _heroMets.innerHTML=
      _met('Lifetime value',_ltv>0?fmt(_ltv):null,_wonBids.length+' job'+(  _wonBids.length!==1?'s':''))||
      _met('Lifetime value','—','No completed jobs')+
      _met('Open balance',_totalOwed>0.01?fmt(_totalOwed):(_totalPaidAll>0?'$0':null),
        _totalOwed>0.01?_totalPaidAll>0?fmt(_totalPaidAll)+' paid · '+fmt(_totalOwed+_totalPaidAll)+' total':'Balance due':
        _totalPaidAll>0?'Paid in full':null,
        _totalOwed>0.01?'var(--c-red)':_totalPaidAll>0?'var(--c-green)':null)+
      _met('Last contact',_lastContactStr,c.last_contact_date||'');
    // Fix: render all 3 tiles properly
    _heroMets.innerHTML=
      _met('Lifetime value',_ltv>0?fmt(_ltv):'—',_wonBids.length+' job'+(_wonBids.length!==1?'s':'') ,null)+
      _met('Open balance',_totalOwed>0.01?fmt(_totalOwed):'$0',
        _totalOwed>0.01?(_totalPaidAll>0?fmt(_totalPaidAll)+' paid · '+fmt(_totalOwed+_totalPaidAll)+' total':'Balance due'):
        _totalPaidAll>0?'Paid in full':'—',
        _totalOwed>0.01?'var(--c-red)':null)+
      _met('Last contact',_lastContactStr,'',null);
  }
  if(gps.active&&gps.clientId===currentClientId){
    document.getElementById('cd-drive-idle').style.display='none';
    document.getElementById('cd-drive-end').style.display='none';
    document.getElementById('cd-drive-active').style.display='block';
    const ap=document.getElementById('cd-active-purpose');
    if(ap)ap.textContent=gps.purpose||'Work drive';
    const av=document.getElementById('cd-active-vehicle');
    if(av)av.textContent=gps.vehicle||'';
  } else if(gps.active&&gps.clientId!==currentClientId){
    resetDriveUI();
    const idle=document.getElementById('cd-drive-idle');
    if(idle){
      idle.style.display='block';
      idle.innerHTML='<div style="font-size:11px;color:var(--amber);text-align:center;padding:4px 0">Drive in progress for another client</div>';
    }
  } else {
    resetDriveUI();
  }
  const cbids=_cbids,cjobs=getClientJobs(currentClientId);
  const wonBids=_wonBids;
  const totalOwed=_totalOwed;
  const totalPaidAll=_totalPaidAll;
  const balanceHTML=totalOwed>0.01?
    `<div style="background:#FFF0F0;border:2px solid #A32D2D;border-radius:var(--rl);padding:12px 14px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#A32D2D;margin-bottom:3px">Balance due</div>
        <div style="font-size:22px;font-weight:800;color:#A32D2D">${fmt(totalOwed)}</div>
        ${totalPaidAll>0?`<div style="font-size:11px;color:var(--text3);margin-top:2px">${fmt(totalPaidAll)} paid · ${fmt(totalPaidAll+totalOwed)} total</div>`:''}
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
        <button onclick="openQuickPayFromOverview()" class="btn btn-g" style="font-size:13px;padding:10px 14px">+ Log payment</button>
        <button onclick="setCDTab('bids',document.getElementById('cdt-bids'))" class="btn btn-sm" style="font-size:11px">View bids</button>
      </div>
    </div>`
    :totalPaidAll>0?
    `<div style="background:var(--green-lt);border:1px solid #97C459;border-radius:var(--rl);padding:10px 14px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center">
      <div style="font-size:12px;font-weight:700;color:var(--green-mid)">✓ Paid in full</div>
      <div style="font-size:14px;font-weight:700;color:var(--green-mid)">${fmt(totalPaidAll)}</div>
    </div>`:'';
  // Lien alert — any won bid with balance overdue 30+ days
  const _lienBid=_wonBids.find(b=>{
    const bal=getBidBalance(b);if(bal<0.01)return false;
    const startDate=new Date(b.completion_date||b.signedAt||Date.now());
    const daysElapsed=Math.floor((Date.now()-startDate.getTime())/86400000);
    return daysElapsed>=30;
  });
  let lienAlertHTML='';
  if(_lienBid){
    const _lienBal=getBidBalance(_lienBid);
    const _lienFC=typeof _calcFinanceCharge==='function'?_calcFinanceCharge(_lienBid):0;
    const _lienTotal=_lienBal+_lienFC;
    lienAlertHTML=`<div style="background:#3D0000;border:2px solid #A32D2D;border-radius:var(--rl);padding:12px 14px;margin-bottom:10px">
      <div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#FFB3B3;margin-bottom:8px">⚠️ Balance overdue 30+ days</div>
      <div style="font-size:12px;color:rgba(255,179,179,.75);line-height:1.9;margin-bottom:10px">
        <div style="display:flex;justify-content:space-between"><span>Contract balance:</span><span style="font-weight:700;color:#FFB3B3">${fmt(_lienBal)}</span></div>
        ${_lienFC>0.01?`<div style="display:flex;justify-content:space-between"><span>Finance charge:</span><span style="font-weight:700;color:#FFB3B3">${fmt(_lienFC)}</span></div>`:''}
        <div style="border-top:1px solid rgba(163,45,45,.5);margin:4px 0"></div>
        <div style="display:flex;justify-content:space-between;font-weight:800;color:#FFB3B3"><span>Total lienable:</span><span>${fmt(_lienTotal)}</span></div>
      </div>
      <button onclick="showFileLienDirect(${_lienBid.id})" style="width:100%;padding:10px;border-radius:var(--r);border:none;background:#A32D2D;color:#FFB3B3;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">📋 Prepare Lien Document</button>
    </div>`;
  }
  const intakeInfoHTML=(c.callTime||c.notes)?`<div style="padding-top:10px;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:6px">${c.callTime?`<div style="font-size:12px;color:var(--text2)"><span style="font-weight:700">📞 Best time to call:</span> ${escHtml(c.callTime)}</div>`:''}${c.notes?`<div style="font-size:12px;color:var(--text2)"><span style="font-weight:700">📋 Intake notes:</span> ${escHtml(c.notes)}</div>`:''}</div>`:'';
  const epaHTML=(c.yearBuilt&&c.yearBuilt<1978)?`<div style="background:var(--amber-lt);border:1px solid var(--amber);border-radius:var(--r);padding:8px 12px;${balanceHTML||intakeInfoHTML?'margin-top:10px;':''}font-size:12px;font-weight:700;color:#856404">⚠️ Pre-1978 — EPA RRP applies if &gt;6 sq ft interior or &gt;20 sq ft exterior paint disturbed</div>`:'';
  const _metsContent=balanceHTML+lienAlertHTML+intakeInfoHTML+epaHTML;
  const _metsEl=document.getElementById('cd-client-mets');
  _metsEl.innerHTML=_metsContent;
  _metsEl.style.display=_metsContent?'':'none';
  // Estimate action buttons — context-aware based on pipeline stage
  const _cdStage=getClientStage(currentClientId).stage;
  const _cdActions=document.getElementById('cd-estimate-actions');
  if(_cdActions){
    if(_cdStage==='incomplete'){
      const _onbSent=c.onboardingSentAt?'Link sent '+_relTime(c.onboardingSentAt):'';
      _cdActions.innerHTML=
        '<div style="background:var(--amber-lt);border:1.5px solid var(--amber);border-radius:var(--rl);padding:14px 16px;margin-bottom:4px">'+
          '<div style="font-size:12px;font-weight:700;color:#856404;margin-bottom:10px">📋 Needs onboarding — send link so they can fill in their address &amp; project details</div>'+
          '<button onclick="sendOnboardingLink('+c.id+')" style="width:100%;padding:13px;border-radius:var(--r);border:none;background:var(--amber);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">📲 Send onboarding link</button>'+
          (_onbSent?'<div style="font-size:11px;color:#856404;margin-top:8px;text-align:center">'+_onbSent+'</div>':'')+
        '</div>';
    }else{
      _cdActions.innerHTML=
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'+
          '<button onclick="schedForClient()" style="padding:12px;border-radius:var(--rl);border:1px solid var(--border2);background:var(--bg);color:var(--text);font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;display:flex;flex-direction:column;align-items:center;gap:4px">'+
            '<span style="font-size:18px">📅</span><span>Schedule estimate</span>'+
            '<span style="font-size:10px;color:var(--text3);font-weight:400">Pick a date &amp; time</span>'+
          '</button>'+
          '<button onclick="openEstimateForClient()" style="padding:12px;border-radius:var(--rl);border:1px solid var(--blue);background:var(--blue-lt);color:var(--blue-dk);font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;display:flex;flex-direction:column;align-items:center;gap:4px'+(_canEstimate()?'':';opacity:.55')+'">'+
            '<span style="font-size:18px">'+(_canEstimate()?'📋':'🔒')+'</span><span>Start estimate now</span>'+
            '<span style="font-size:10px;color:var(--blue);font-weight:400">I\'m already here</span>'+
          '</button>'+
        '</div>';
    }
  }
  renderCDTimeline();
  renderClientNotes();
  renderCDRisk();
  renderCDEstimatesUpcoming();
  renderCDOpportunities();
  renderCDAddresses();
  renderTodayLegs();
  setCDTab('overview',document.getElementById('cdt-overview'));
}
function renderCDRisk(){
  const el=document.getElementById('cd-risk-content');if(!el)return;
  const c=getClientById(currentClientId);if(!c)return;
  const r=c.riskLevel||'normal';
  const flags=c.riskFlags||[];
  const LEVELS=['normal','watch','high_risk','blacklisted'];
  const LABELS={normal:'Normal',watch:'Watch',high_risk:'High risk',blacklisted:'Blacklisted'};
  const COLORS={normal:'var(--text3)',watch:'var(--amber)',high_risk:'#A32D2D',blacklisted:'#000'};
  el.innerHTML=
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">'+
      '<div>'+
        '<div style="font-size:14px;font-weight:700;color:'+COLORS[r]+'">'+LABELS[r]+'</div>'+
        (flags.length?'<div style="font-size:11px;color:var(--text3);margin-top:2px">Flags: '+flags.join(', ')+'</div>':'')+
      '</div>'+
    '</div>'+
    '<div style="display:flex;gap:6px;flex-wrap:wrap">'+
      LEVELS.map(lvl=>
        '<button onclick="setClientRisk('+currentClientId+',\''+lvl+'\');renderClientDetail()" '+
        'style="font-size:11px;padding:5px 10px;border-radius:var(--r);border:2px solid '+(r===lvl?COLORS[lvl]:'var(--border2)')+
        ';background:'+(r===lvl?'var(--bg2)':'none')+';color:'+(r===lvl?COLORS[lvl]:'var(--text3)')+
        ';cursor:pointer;font-weight:'+(r===lvl?'800':'500')+';font-family:inherit">'+
          LABELS[lvl]+
        '</button>'
      ).join('')+
    '</div>'+
    (r==='blacklisted'?'<div style="font-size:11px;color:#A32D2D;margin-top:8px;font-weight:700">Estimates and scheduling are blocked for this client.</div>':'')+
    (r==='high_risk'?'<div style="font-size:11px;color:var(--amber);margin-top:8px">⚠️ Previous lien filed. Require full payment before scheduling.</div>':'');
}
function renderClientNotes(){
  const c=getClientById(currentClientId);if(!c)return;
  const el=document.getElementById('cd-notes-list');if(!el)return;
  const notes=(Array.isArray(c.notes)?c.notes:[]).slice().sort((a,b)=>(a.ts||'').localeCompare(b.ts||''));
  if(!notes.length){el.innerHTML='<div style="font-size:12px;color:var(--text3);padding:4px 0">No notes yet.</div>';return;}
  el.innerHTML=notes.map(n=>{
    const dt=new Date(n.ts).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
    return '<div style="display:flex;align-items:flex-start;gap:8px;padding:7px 0;border-bottom:1px solid var(--border)">'+
      '<div style="flex:1;min-width:0">'+
        '<div style="font-size:13px;color:var(--text);line-height:1.4">'+escHtml(n.text)+'</div>'+
        '<div style="font-size:10px;color:var(--text3);margin-top:2px">'+dt+'</div>'+
      '</div>'+
      '<button class="btn-del" onclick="deleteClientNote(\''+n.id+'\')" style="flex-shrink:0;font-size:11px;padding:3px 6px">✕</button>'+
    '</div>';
  }).join('');
}
function addClientNote(){
  const inp=document.getElementById('cd-note-input');if(!inp)return;
  const text=(inp.value||'').trim();if(!text)return;
  const c=getClientById(currentClientId);if(!c)return;
  if(!c.notes)c.notes=[];
  c.notes.push({id:Date.now()+'_'+Math.random().toString(36).slice(2,6),text,ts:new Date().toISOString()});
  inp.value='';
  saveAll();renderClientNotes();
}
function deleteClientNote(noteId){
  const c=getClientById(currentClientId);if(!c)return;
  c.notes=(c.notes||[]).filter(n=>n.id!==noteId);
  saveAll();renderClientNotes();
}
function renderCDTimeline(){
  const cbids=getClientBids(currentClientId),cjobs=getClientJobs(currentClientId),cmiles=getClientMileage(currentClientId);
  const events=[];
  cbids.forEach(b=>{
    events.push({date:b.bid_date||'',type:'bid',id:b.id,label:`Bid — ${fmt(b.amount)}`,meta:b.status,color:'bid'});
    (b.collHistory||[]).forEach(h=>{
      if(!h.ts)return;
      const dateStr=h.ts.slice(0,10);
      const stageInfo=COLL_STAGES[h.stage]||{};
      const stageLabel=stageInfo.label||h.stage;
      const noteText=h.note&&h.note!==stageLabel?h.note:'';
      events.push({date:dateStr,type:'coll',label:'Collection: '+stageLabel,meta:escHtml(noteText)+(noteText?' · ':'')+fmt(b.amount)+' job',color:'coll'});
    });
    if(b.completion_date)events.push({date:b.completion_date,type:'complete',label:'Job completed — '+fmt(b.amount),meta:escHtml(b.type||'Painting job'),color:'active'});
  });
  const allPays=payments.filter(p=>cbids.some(b=>b.id===p.bid_id));
  allPays.forEach(p=>{
    if(!p.date)return;
    const isRefund=p.type==='refund';
    events.push({date:p.date,type:'payment',label:(isRefund?'Refund — ':'Payment — ')+fmt(Math.abs(p.amount)),meta:escHtml(p.method||'')+(p.ref?' #'+escHtml(p.ref):''),color:isRefund?'lost':'payment'});
  });
  cjobs.forEach(j=>{
    if(j.eventType==='estimate'){
      const isCanceled=j.status==='canceled';
      events.push({
        date:j.cancelDate||j.start||'',
        type:'estimate',
        label:isCanceled?'Estimate '+escHtml(j.cancelReason):'Estimate visit'+(j.time?' @ '+fmtTime(j.time):''),
        meta:isCanceled?'Canceled '+j.cancelDate:(j.start+(j.addr?' · '+escHtml(j.addr):'')),
        color:isCanceled?'canceled':'estimate'
      });
    } else {
      events.push({date:j.start||'',type:'job',label:'Job scheduled — '+j.days+' day'+(j.days>1?'s':''),meta:fmt(j.value||0),color:'active'});
    }
  });
  cmiles.forEach(m=>events.push({date:m.date||'',type:'mile',label:`Drive: ${(m.miles||0).toFixed(1)} mi${m.gps?' (GPS)':''}`,meta:`${escHtml(m.purpose||'Trip')}${m.from?' · from '+escHtml(m.from):''}`,color:'mile'}));
  events.sort((a,b)=>b.date.localeCompare(a.date));
  const el=document.getElementById('cd-timeline');
  if(!events.length){el.innerHTML='<div class="empty">No activity yet. Add a bid or drive to this client.</div>';return;}
  const byDate={};
  [...events].sort((a,b)=>b.date.localeCompare(a.date)).forEach(e=>{
    if(!byDate[e.date])byDate[e.date]=[];
    byDate[e.date].push(e);
  });
  const tk=todayKey();
  el.innerHTML='<div class="timeline">'+
    Object.entries(byDate).map(([date,evts],groupIdx)=>{
      const isToday=date===tk;
      const dayLabel=isToday?'Today':parseD(date).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
      const domId='tl-group-'+groupIdx;
      const items=evts.map(e=>{
        const isBid=e.type==='bid';
        const inner='<div class="tl-dot '+e.color+'"></div><div class="tl-label">'+e.label+'</div><div class="tl-meta">'+(e.meta||'')+(isBid?' · <span style="font-size:10px;color:var(--blue)">tap to edit</span>':'')+' </div>';
        if(isBid)return '<div class="tl-item" onclick="viewBidFromTimeline('+e.id+')" style="cursor:pointer">'+inner+'</div>';
        return '<div class="tl-item">'+inner+'</div>';
      }).join('');
      return '<div style="margin-bottom:8px">'+
        '<div data-tlgroup="'+domId+'" onclick="toggleTlGroup(this.dataset.tlgroup)" style="display:flex;align-items:center;gap:8px;padding:5px 0;cursor:pointer;user-select:none">'+
          '<span id="'+domId+'-arrow" style="font-size:10px;color:var(--text3);transition:transform .2s;display:inline-block">▶</span>'+
          '<span style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:'+(isToday?'var(--blue)':'var(--text3)')+'">'+dayLabel+'</span>'+
          '<span style="font-size:10px;color:var(--text3)">('+evts.length+')</span>'+
        '</div>'+
        '<div id="'+domId+'" style="display:none;padding-left:4px">'+items+'</div>'+
      '</div>';
    }).join('')+
  '</div>';
}
function toggleTlGroup(id){
  const el=document.getElementById(id);
  const arrow=document.getElementById(id+'-arrow');
  if(!el)return;
  const open=el.style.display!=='none';
  el.style.display=open?'none':'block';
  if(arrow)arrow.style.transform=open?'':'rotate(90deg)';
}
function renderCDExpenses(){
  const el=document.getElementById('cdt-expenses-list');if(!el)return;
  const cexp=getClientExpenses(currentClientId);
  const total=cexp.reduce((s,e)=>s+(e.amount||0),0);
  if(!cexp.length){
    el.innerHTML='<div class="empty">No expenses logged for this client yet.<br><br>Tap + Log expense to add one.</div>';
    return;
  }
  const byBid={};
  cexp.forEach(e=>{
    const key=e.job_id||'unlinked';
    if(!byBid[key])byBid[key]={name:e.job_name||'General expenses',items:[],total:0};
    byBid[key].items.push(e);
    byBid[key].total+=e.amount;
  });
  let html='<div class="mets" style="margin-bottom:12px">'+
    '<div class="met"><div class="met-l">Total spent</div><div class="met-v" style="color:#A32D2D">'+fmt(total)+'</div></div>'+
    '<div class="met"><div class="met-l">Receipts</div><div class="met-v">'+cexp.filter(e=>!e.receipt||!e.receipt.includes('No')).length+'/'+cexp.length+'</div></div>'+
  '</div>';
  Object.entries(byBid).forEach(([key,group])=>{
    html+='<div style="margin-bottom:14px">'+
      '<div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;margin-bottom:6px">'+escHtml(group.name)+'</div>'+
      group.items.map(e=>
        '<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid var(--border)">'+
          '<div style="flex:1;min-width:0">'+
            '<div style="font-size:13px;font-weight:700">'+escHtml(e.vendor)+'</div>'+
            '<div style="font-size:11px;color:var(--text3)">'+e.cat+' · '+e.date+'</div>'+
          '</div>'+
          '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0">'+
            '<span style="font-size:13px;font-weight:700;color:#A32D2D">'+fmt(e.amount)+'</span>'+
            '<button class="btn-del" onclick="delExpenseFromCD('+e.id+')">✕</button>'+
          '</div>'+
        '</div>'
      ).join('')+
      '<div style="display:flex;justify-content:flex-end;padding:6px 0;font-size:12px;font-weight:700;color:var(--text3)">Subtotal: '+fmt(group.total)+'</div>'+
    '</div>';
  });
  el.innerHTML=html;
}
function delExpenseFromCD(id){
  zConfirm('Delete this expense?',()=>{
    _userDelete(()=>{expenses=expenses.filter(e=>e.id!==id);saveAll();});
    renderCDExpenses();renderDash();
  },{title:'Delete expense',danger:true});
}

function renderCDMileage(){
  const cmiles=getClientMileage(currentClientId);
  const total=cmiles.reduce((s,m)=>s+(m.miles||0),0);
  const byPurp={};
  cmiles.forEach(m=>{const p=m.purpose||'Trip';byPurp[p]=(byPurp[p]||0)+(m.miles||0);});
  const purposeSummary=Object.entries(byPurp).sort((a,b)=>b[1]-a[1]).map(([p,mi])=>
    '<div style="display:flex;justify-content:space-between;font-size:11px;padding:3px 0;border-bottom:1px solid var(--border)">'+
    '<span style="color:var(--text2)">'+p+'</span>'+
    '<span style="font-weight:700">'+mi.toFixed(1)+' mi</span></div>'
  ).join('');
  document.getElementById('cd-mile-summary').innerHTML=
    '<div class="mets" style="margin-bottom:'+(Object.keys(byPurp).length>1?'8px':'0')+'">'+
      '<div class="met"><div class="met-l">Total trips</div><div class="met-v">'+cmiles.length+'</div></div>'+
      '<div class="met"><div class="met-l">Total miles</div><div class="met-v">'+total.toFixed(1)+' mi</div></div>'+
      '<div class="met"><div class="met-l">Deduction</div><div class="met-v">'+fmt(total*IRS())+'</div></div>'+
    '</div>'+
    (Object.keys(byPurp).length>1?
      '<div style="padding:8px 0">'+
        '<div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text3);margin-bottom:4px">By purpose</div>'+
        purposeSummary+
      '</div>':''
    );
  const el=document.getElementById('cd-mile-list');
  if(!cmiles.length){el.innerHTML='<div class="empty">No trips yet.<br>Tap "Drive to this job" above to start tracking.</div>';return;}
  el.innerHTML=[...cmiles].sort((a,b)=>b.date.localeCompare(a.date)).map(m=>`<div class="mile-row"><div class="mile-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="10" r="3"/><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/></svg></div><div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:700">${escHtml(m.from||'Start')} → ${escHtml(m.to||'Destination')}</div><div style="font-size:11px;color:var(--text3)">${m.date} · <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${(MILE_PURPOSE_COLORS[m.purpose||'Other']||MILE_PURPOSE_COLORS['Other']).dot};margin-right:2px;vertical-align:middle"></span><select onchange="editMilePurpose(${m.id},this.value)" onclick="event.stopPropagation()" style="font-size:11px;border:none;background:transparent;color:${(MILE_PURPOSE_COLORS[m.purpose||'Other']||MILE_PURPOSE_COLORS['Other']).text};font-weight:700;cursor:pointer;font-family:inherit;padding:1px 2px;border-radius:3px">${MILE_PURPOSES.map(p=>`<option value="${p}"${(m.purpose||'Other')===p?' selected':''}>${p}</option>`).join('')}</select>${m.gps?' · <span class="bdg bdg-gps">GPS</span>':''}</div></div><div style="text-align:right;flex-shrink:0"><div style="font-size:13px;font-weight:700">${(m.miles||0).toFixed(1)} mi</div><div style="font-size:10px;color:var(--green-mid)">${fmt((m.miles||0)*IRS())}</div></div><button class="btn-del" onclick="delMileage(${m.id})">✕</button></div>`).join('');
}
function renderCDBids(){
  const cbids=getClientBids(currentClientId);
  const scheduledIds=new Set(jobs.filter(j=>j.bid_id).map(j=>j.bid_id));
  const SBADGE={Pending:'bdg-pending','Closed Won':'bdg-won','Closed Lost':'bdg-lost',Abandoned:'bdg-abandoned'};
  const el=document.getElementById('cd-bids-list');
  const alertEl=document.getElementById('cd-overdue-alerts');
  if(alertEl){
    const tk=todayKey();
    const alerts=cbids.filter(b=>b.status==='Closed Won'&&getBidBalance(b)>0.01&&b.completion_date);
    alertEl.innerHTML=alerts.map(b=>{
      const days=daysSince(b.completion_date);
      const lien=getBidLien(b.id);
      if(lien&&lien.status==='filed')return '<div class="lien-banner"><div><span style="font-size:11px;font-weight:800">⚠ LIEN FILED</span><br><span style="font-size:12px">'+fmt(getBidBalance(b))+' outstanding · '+escHtml(lien.county)+'</span></div><button class="btn btn-sm" onclick="openLienPanel('+b.id+')" style="background:rgba(255,100,100,.2);border-color:rgba(255,100,100,.4);color:#FFB3B3;font-size:11px">Edit lien</button></div>';
      if(lien&&lien.status==='intent')return '<div class="overdue-banner"><div><span style="font-size:11px;font-weight:700;color:var(--red)">NOTICE OF INTENT SENT</span><br><span style="font-size:12px">'+fmt(getBidBalance(b))+' owed · '+days+' days since completion</span></div><button class="btn btn-sm btn-r" onclick="openLienPanel('+b.id+')">Update lien</button></div>';
      if(days>=30)return '<div class="overdue-banner"><div><span style="font-size:11px;font-weight:700;color:var(--red)">'+days+' DAYS OVERDUE</span><br><span style="font-size:12px">'+fmt(getBidBalance(b))+' owed since '+b.completion_date+'</span></div><button class="btn btn-sm btn-r" onclick="openLienPanel('+b.id+')">File lien</button></div>';
      if(days>=7)return '<div class="tip tip-w"><strong>Balance '+days+' days past completion</strong> — '+fmt(getBidBalance(b))+' owed. <button class="btn btn-sm" onclick="openPayPanel('+b.id+')" style="margin-left:6px">Log payment</button></div>';
      return '';
    }).join('');
  }
  if(!cbids.length){el.innerHTML='<div class="empty">No bids yet. Tap "+ Add bid" above.</div>';return;}
  const latestBidId=cbids.length?cbids[0].id:null;
  const _rrpClient=getClientById(currentClientId);
  const _rrpRequired=!!(_rrpClient&&_rrpClient.yearBuilt&&_rrpClient.yearBuilt<1978);
  el.innerHTML=cbids.map(b=>{
    const ps=payStatus(b);
    const paid=getBidPaid(b.id);
    const balance=getBidBalance(b);
    const total=b.amount||0;
    const pct=total>0?Math.min(100,Math.round(paid/total*100)):0;
    const bpays=getBidPayments(b.id);
    const lien=getBidLien(b.id);
    const days=b.completion_date?daysSince(b.completion_date):0;
    const isWon=b.status==='Closed Won';
    let payHTML='';
    if(isWon){
      const balColor=balance>0.01?'#A32D2D':'var(--green-mid)';
      payHTML+='<div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border)">';
      payHTML+='<div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px"><span style="color:var(--text2)">Payment progress</span><span><span class="bdg '+ps.cls+'">'+ps.label+'</span></span></div>';
      payHTML+='<div class="pay-bar"><div class="pay-fill" style="width:'+pct+'%;background:'+ps.color+';"></div></div>';
      payHTML+='<div style="display:flex;justify-content:space-between;font-size:12px;margin-top:3px"><span style="color:var(--text2)">Paid: <strong style="color:var(--green-mid)">'+fmt(paid)+'</strong></span><span style="color:var(--text2)">Balance: <strong style="color:'+balColor+'">'+fmt(balance)+'</strong></span><span style="color:var(--text2)">Total: <strong>'+fmt(total)+'</strong></span></div>';
      if(bpays.length){
        payHTML+='<div style="margin-top:8px;background:var(--bg2);border-radius:var(--r);padding:8px 10px">';
        payHTML+='<div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text3);margin-bottom:5px">Payment history</div>';
        payHTML+=bpays.map(p=>{const isRef=p.type==='refund';const amtDisp=isRef?'<strong style="color:#A32D2D">↩ -'+fmt(Math.abs(p.amount))+'</strong>':'<strong style="color:var(--green-mid)">+'+fmt(p.amount)+'</strong>';const typeLabel=isRef?'REFUND':(escHtml(p.method)+(p.ref?' #'+escHtml(p.ref):''));return '<div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;padding:3px 0;border-bottom:1px solid var(--border)"><span style="color:var(--text2)">'+p.date+' · '+typeLabel+'</span><span>'+amtDisp+' <button class="btn-del" onclick="deletePay('+p.id+')" style="font-size:10px">✕</button></span></div>';}).join('');
        payHTML+='</div>';
      }
      if(lien){
        const lstatLabel={intent:'Notice of intent sent',filed:'LIEN FILED WITH COUNTY',attorney:'Referred to attorney',resolved:'Lien resolved & released'}[lien.status]||lien.status;
        const lbg=lien.status==='resolved'?'var(--green-lt)':(lien.status==='filed'?'#3D0000':'var(--red-lt)');
        const ltxt=lien.status==='resolved'?'var(--green)':(lien.status==='filed'?'#FFB3B3':'var(--red)');
        payHTML+='<div style="margin-top:8px;background:'+lbg+';border-radius:var(--r);padding:8px 10px;display:flex;justify-content:space-between;align-items:center">';
        payHTML+='<div><div style="font-size:11px;font-weight:800;color:'+ltxt+'">'+lstatLabel+'</div><div style="font-size:10px;color:'+ltxt+';opacity:.8">'+lien.date+(lien.county?' · '+escHtml(lien.county):'')+(lien.amount?' · '+fmt(lien.amount):'')+' claimed</div></div>';
        payHTML+='<button class="btn btn-sm" onclick="openLienPanel('+b.id+')" style="font-size:10px">Edit</button></div>';
      }
      payHTML+='</div>';
      if(b.completion_date&&days>0&&balance>0.01){
        const cs=getBidCollStage(b);
        const csInfo=COLL_STAGES[cs]||{};
        payHTML+='<div style="font-size:10px;color:'+(days>=30?'#A32D2D':days>=14?'var(--amber)':'var(--text3)')+';margin-top:4px">Job completed '+b.completion_date+' · '+days+' day'+(days!==1?'s':'')+' since completion'+(days>=7?' · follow up on balance':'')+(csInfo.label?' &nbsp;·&nbsp; <strong style="color:'+csInfo.color+'">'+csInfo.label+'</strong>':'')+' </div>';
      }
    }
    const actBtns=[];
    if(isWon){
      // Close job button — when won but not yet marked complete
      if(!b.completion_date){const linkedJob=jobs.find(j=>j.bid_id===b.id||j.client_id===b.client_id);const jid=linkedJob?.id;if(jid)actBtns.push('<button class="btn btn-sm" onclick="markJobDone('+jid+')" style="background:var(--green-lt);color:var(--green-mid);border-color:var(--green-mid)">✓ Close job</button>');}
      if(balance>0.01)actBtns.push('<button class="btn btn-sm btn-g" onclick="openPayPanel('+b.id+')">+ Log payment</button>');
      if(balance>0.01&&_stripeConnectStatus?.charges_enabled)actBtns.push('<button class="btn btn-sm" onclick="sendPaymentLink('+b.id+')" style="background:#635BFF;color:#fff;border-color:#635BFF;font-size:11px">💳 Send pay link</button>');
      if(balance>0.01&&b.completion_date){const _c=getClientById(b.client_id);if(_c&&_c.phone){const _msg=encodeURIComponent('Hi '+(_c.name||'').split(' ')[0]+', this is '+(S.bname||'your contractor')+'. Just a friendly reminder that a balance of '+fmt(balance)+' is outstanding for your job at '+(b.addr||_c.addr||'your property')+'. Please let us know when you can take care of this. Thank you!');actBtns.push('<a href="sms:'+_c.phone.replace(/\D/g,'')+'&body='+_msg+'" onclick="autoLogContact('+b.client_id+',\'payment_request\')" class="btn btn-sm" style="background:var(--green-lt);color:var(--green-mid);border-color:var(--green-mid);text-decoration:none">📲 Request pay</a>');}}
      if(getBidPaid(b.id)>(b.amount||0)+0.01)actBtns.push('<button class="btn btn-sm" onclick="openPayPanel('+b.id+')" style="background:#FFF0F0;color:#A32D2D;border-color:#A32D2D">↩ Issue refund</button>');
      actBtns.push('<button class="btn btn-sm" onclick="toggleBidSummary('+b.id+')" style="background:var(--bg2);border-color:var(--border2)">&#128196; View bid</button>');
      actBtns.push('<button class="btn btn-sm" onclick="printInvoice('+b.id+')" style="background:var(--bg2);border-color:var(--border2)">&#128438; Print invoice</button>');
      if(!scheduledIds.has(b.id))actBtns.push('<button class="btn btn-sm btn-p" onclick="schedFromBid('+b.id+')">Schedule →</button>');
      if(!lien&&balance>0.01&&days>=14)actBtns.push('<button class="btn btn-sm btn-r" onclick="showFileLienDirect('+b.id+')">⚖️ File lien</button>');
      else if(lien&&lien.status!=='resolved')actBtns.push('<button class="btn btn-sm btn-r" onclick="openLienPanel('+b.id+')">Lien status</button>');
      // SMS escalation buttons based on days overdue
      if(balance>0.01&&days>=7&&days<14)actBtns.push('<button class="btn btn-sm" onclick="collSendSMS(bids.find(b=>b.id=='+b.id+'),\'reminder\')" style="background:var(--amber-lt);color:#856404;border-color:var(--amber)">💬 Remind</button>');
      if(balance>0.01&&days>=14&&days<21)actBtns.push('<button class="btn btn-sm" onclick="collSendSMS(bids.find(b=>b.id=='+b.id+'),\'second\')" style="background:var(--amber-lt);color:#856404;border-color:var(--amber)">💬 2nd notice</button>');
      if(balance>0.01&&days>=21)actBtns.push('<button class="btn btn-sm btn-r" onclick="collSendSMS(bids.find(b=>b.id=='+b.id+'),\'intent\')">💬 Intent to lien</button>');
      if(lien&&lien.status!=='resolved'&&getBidBalance(b)<=0.01)actBtns.push('<button class="btn btn-sm" onclick="releaseLien('+b.id+')" style="background:var(--green-lt);color:var(--green);border-color:var(--green)">✓ Release lien</button>');
      actBtns.push('<button class="btn btn-sm" onclick="openEditBid('+b.id+')" style="background:var(--blue-lt);color:var(--blue-dk);border-color:var(--blue)">✎ Revise bid</button>');
      actBtns.push('<button class="btn btn-sm" onclick="showSupplyList('+b.id+')" style="background:#FFF0E8;color:#854F0B;border-color:#E89B50">📦 Supply list</button>');
      actBtns.push('<button class="btn btn-sm" onclick="recoverBidRooms('+b.id+')" style="background:#F0F7FF;color:#1a365d;border-color:#9DBEE5">♻️ Recover rooms</button>');
      actBtns.push('<button class="btn-del" onclick="deleteBid('+b.id+')" style="font-size:11px;padding:5px 8px">Delete</button>');
    }
    if(!isWon){
      actBtns.push('<button class="btn btn-sm" onclick="sendBidEmail('+b.id+')" style="background:var(--bg2);border-color:var(--border2)">&#9993; Send email</button>');
      const _reviseFn=b.geiLines!==undefined?'openGenericEstimate(getClientById('+b.client_id+'),'+b.id+',\''+escHtml(b.trade_type||'general')+'\')':'openEditBid('+b.id+')';
      actBtns.push('<button class="btn btn-sm" onclick="'+_reviseFn+'" style="background:var(--blue-lt);color:var(--blue-dk);border-color:var(--blue)">✎ Revise bid</button>');
      actBtns.push('<button class="btn btn-sm" onclick="openBidNotes('+b.id+')" style="background:var(--amber-lt);color:#856404;border-color:var(--amber)">📝 Notes</button>');
      actBtns.push('<button class="btn btn-sm" onclick="recoverBidRooms('+b.id+')" style="background:#F0F7FF;color:#1a365d;border-color:#9DBEE5">♻️ Recover rooms</button>');
      actBtns.push('<button class="btn btn-sm" onclick="markBidHandshake('+b.id+')" style="background:#FFF8E8;color:#856404;border-color:var(--amber);font-size:11px">🤝 Handshake</button>');
      actBtns.push('<button class="btn btn-sm" onclick="markBidAbandoned('+b.id+')" style="background:#FFF8F0;color:#A32D2D;border-color:#A32D2D">No response</button>');
      actBtns.push('<button class="btn-del" onclick="deleteBid('+b.id+')" style="font-size:11px;padding:5px 8px">Delete</button>');
    }
    return '<div class="card" style="margin-bottom:8px" id="bid-card-'+b.id+'" data-lp-id="'+b.id+'" data-lp-type="bid" data-lp-label="'+escHtml((b.type||'Proposal')+(b.amount?' · '+fmt(b.amount):''))+'">'+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start">'+
        '<div>'+(b.id===latestBidId&&cbids.length>1?'<span style="font-size:10px;font-weight:800;background:var(--blue);color:#fff;padding:1px 6px;border-radius:8px;margin-bottom:4px;display:inline-block">Latest</span><br>':'')+'<div style="font-size:14px;font-weight:700">'+escHtml(b.type||'Painting job')+'</div>'+
          '<div style="font-size:11px;color:var(--text3)">'+
            (b.status==='Pending'&&b.bid_date?
              (()=>{const d=Math.floor((new Date(todayKey())-new Date(b.bid_date+'T12:00:00'))/(86400000));
               return '<span style="color:'+(d>=14?'#A32D2D':d>=7?'var(--amber)':'var(--text3)')+'">Sent '+b.bid_date+(d>0?' · '+d+' day'+(d>1?'s':'')+' ago':'')+'</span>';})()
            :(b.bid_date||''))+
            ' · '+(b.days||2)+' day'+(b.days!==1?'s':'')+' est.'+
          '</div>'+
          (b.notes?'<div style="font-size:11px;color:var(--text3);margin-top:2px">'+escHtml(b.notes.substring(0,60))+'</div>':'')+
          (b.status==='Pending'&&b.signingToken&&typeof _proposalViewsByBidClient!=='undefined'?
            (()=>{
              const hubTs=_proposalViewsByBidHubClient&&_proposalViewsByBidHubClient[String(b.id)];
              const clientTs=_proposalViewsByBidClient&&_proposalViewsByBidClient[String(b.id)];
              const contractorTs=_proposalViewsByBidContractor&&_proposalViewsByBidContractor[String(b.id)];
              const hubCnt=(typeof _proposalViewsByBidHubCount!=='undefined'&&_proposalViewsByBidHubCount)?(_proposalViewsByBidHubCount[String(b.id)]||0):0;
              const clientCnt=(typeof _proposalViewsByBidClientCount!=='undefined'&&_proposalViewsByBidClientCount)?(_proposalViewsByBidClientCount[String(b.id)]||0):0;
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
              let badge='';
              if(hubTs){
                const cStr=hubCnt>1?' · '+hubCnt+'×':'';
                badge+='<div style="font-size:11px;color:#2563eb;margin-top:2px">🔗 Hub opened · '+_localTs(hubTs)+cStr+'</div>';
              }
              if(clientTs){
                const cStr=clientCnt>1?' · '+clientCnt+'×':'';
                badge+='<div style="font-size:11px;color:var(--green-mid);margin-top:2px">👁 Proposal opened · '+_localTs(clientTs)+cStr+'</div>';
              }
              if(!hubTs&&!clientTs){
                badge+='<div style="font-size:11px;color:var(--text3);margin-top:2px">Client hasn\'t opened yet</div>';
              }
              if(contractorTs){
                badge+='<div style="font-size:10px;color:var(--text3);margin-top:1px">You previewed · '+_localTs(contractorTs)+'</div>';
              }
              return badge;
            })():'')+
        '</div>'+
        '<div style="text-align:right">'+
          (b.isTM?'<span style="display:inline-block;font-size:10px;font-weight:700;background:#dbeafe;color:#1d4ed8;border-radius:10px;padding:2px 7px;margin-bottom:3px">⏱️ T&M</span><br>':'')+
          '<div style="font-size:16px;font-weight:700;color:var(--green-mid)">'+(b.isTM&&b.tmNteCap?'Est. '+fmt(b.amount)+' / NTE '+fmt(b.tmNteCap):fmt(b.amount))+'</div>'+
          (b.isTM&&b.tmDepositAmt?'<div style="font-size:11px;color:var(--text3)">Deposit: '+fmt(b.tmDepositAmt)+'</div>':'')+
          '<span class="bdg '+(SBADGE[b.status]||'')+'">'+b.status+'</span>'+
          (_rrpRequired?'<span style="font-size:10px;background:#fef3c7;color:#92400e;border-radius:4px;padding:2px 6px;font-weight:700;margin-left:4px">RRP</span>':'')+
          (b.handshake?'<br><span style="font-size:10px;font-weight:700;background:#FFF8E8;color:#856404;border:1px solid var(--amber);border-radius:4px;padding:1px 6px;white-space:nowrap;display:inline-block;margin-top:3px">🤝 Handshake</span>':'')+
        '</div>'+
      '</div>'+
      payHTML+
      (actBtns.length?'<div class="brow" style="margin-top:8px">'+actBtns.join('')+'</div>':'')+
      (scheduledIds.has(b.id)?'<div style="margin-top:4px"><span class="conn-tag">Scheduled on calendar</span></div>':'')+
      '</div>';
  }).join('');
}

// ── Client Proposals Popup ────────────────────────────────────────────
function openClientProposals(clientId){
  const c=getClientById(clientId);if(!c)return;
  const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
  const SHORT_MO=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // All won bids newest-first, keyed by signed date
  const wonBids=getClientBids(clientId)
    .filter(b=>b.status==='Closed Won')
    .map(b=>{
      const dk=b.signedAt?new Date(b.signedAt).toISOString().slice(0,10):(b.completion_date||b.bid_date||'');
      return {...b,_dk:dk};
    })
    .sort((a,b)=>b._dk.localeCompare(a._dk));

  // Group year → month
  const byYear={};
  wonBids.forEach(b=>{
    const yr=b._dk.slice(0,4)||'—';
    const mo=b._dk.slice(0,7)||'—';
    if(!byYear[yr])byYear[yr]={};
    if(!byYear[yr][mo])byYear[yr][mo]=[];
    byYear[yr][mo].push(b);
  });
  const years=Object.keys(byYear).sort((a,b)=>b.localeCompare(a));

  // Default: most recent year + month open
  if(years.length){
    const ry=years[0];
    if(window['_cpYr_'+ry]===undefined)window['_cpYr_'+ry]=true;
    const rmos=Object.keys(byYear[ry]).sort((a,b)=>b.localeCompare(a));
    if(rmos.length&&window['_cpMo_'+ry+'_'+rmos[0]]===undefined)window['_cpMo_'+ry+'_'+rmos[0]]=true;
  }

  function _bidCard(b){
    const dateStr=b.signedAt
      ?new Date(b.signedAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})
      :(b._dk||'Unknown date');
    const signedLine=b.signedAt
      ?'<span style="color:var(--green-mid);font-size:11px;font-weight:600">✓ Signed '+dateStr+(b.signedName?' · '+escHtml(b.signedName):'')+'</span>'
      :'<span style="color:var(--text3);font-size:11px">Won '+dateStr+'</span>';
    return '<div class="card" style="margin:0 0 10px;border-radius:12px">'+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">'+
        '<div style="flex:1;min-width:0">'+
          '<div style="font-size:15px;font-weight:700;margin-bottom:3px">'+escHtml(b.type||b.trade_type||'Proposal')+'</div>'+
          signedLine+
        '</div>'+
        '<div style="font-size:18px;font-weight:800;color:var(--green-mid);margin-left:12px;flex-shrink:0">'+fmt(b.amount)+'</div>'+
      '</div>'+
      '<div style="display:flex;gap:8px">'+
        '<button onclick="_cpOpen('+b.id+',\'bid\')" class="btn btn-sm" style="flex:1;justify-content:center;font-size:12px;font-weight:700">📋 Our bid</button>'+
        (b.proposalHtml
          ?'<button onclick="_cpOpen('+b.id+',\'proposal\')" class="btn btn-sm" style="flex:1;justify-content:center;font-size:12px;font-weight:700;background:var(--blue-lt);color:var(--blue-dk);border-color:var(--blue)">📄 Client view</button>'
          :'<span style="flex:1;font-size:11px;color:var(--text3);display:flex;align-items:center;justify-content:center;font-style:italic">No proposal saved</span>')+
      '</div>'+
    '</div>';
  }

  function _accordionHTML(){
    if(!wonBids.length)return '<div style="padding:40px 16px;text-align:center;color:var(--text3);font-size:14px">No signed proposals yet.</div>';
    return years.map(yr=>{
      const yrOpen=window['_cpYr_'+yr]===true;
      const yrBids=Object.values(byYear[yr]).flat();
      const months=Object.keys(byYear[yr]).sort((a,b)=>b.localeCompare(a));
      const moHTML=yrOpen?months.map(mo=>{
        const moOpen=window['_cpMo_'+yr+'_'+mo]===true;
        const moBids=byYear[yr][mo];
        const moIdx=parseInt(mo.slice(5))-1;
        return '<div style="border-top:1px solid var(--border)">'+
          '<div onclick="_cpToggleMo(\''+yr+'\',\''+mo+'\')" style="display:flex;align-items:center;gap:8px;padding:10px 16px 10px 28px;cursor:pointer;-webkit-user-select:none;user-select:none">'+
            '<span style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;flex:1;color:var(--text2)">'+SHORT_MO[moIdx]+'</span>'+
            '<span style="font-size:11px;font-weight:700;background:var(--border2);border-radius:10px;padding:1px 8px;color:var(--text2)">'+moBids.length+'</span>'+
            '<span style="font-size:13px;color:var(--text3);width:14px;text-align:center">'+(moOpen?'⌄':'›')+'</span>'+
          '</div>'+
          (moOpen?'<div style="padding:4px 14px 14px">'+moBids.map(_bidCard).join('')+'</div>':'')+
        '</div>';
      }).join(''):'';
      return '<div style="border-top:1px solid var(--line)">'+
        '<div onclick="_cpToggleYr(\''+yr+'\')" style="display:flex;align-items:center;gap:10px;padding:14px 16px;cursor:pointer;-webkit-user-select:none;user-select:none;background:var(--cream)">'+
          '<span style="font-size:16px;font-weight:800;flex:1;color:var(--text)">'+yr+'</span>'+
          '<span style="font-size:12px;font-weight:700;background:var(--border2);border-radius:10px;padding:2px 10px;color:var(--text2)">'+yrBids.length+' proposal'+(yrBids.length!==1?'s':'')+'</span>'+
          '<span style="font-size:14px;color:var(--text3);width:14px;text-align:center">'+(yrOpen?'⌄':'›')+'</span>'+
        '</div>'+
        moHTML+
      '</div>';
    }).join('');
  }

  document.querySelector('[data-cpov]')?.remove();
  const ov=document.createElement('div');
  ov.setAttribute('data-cpov','1');
  ov.style.cssText='position:fixed;inset:0;background:var(--bg);z-index:10001;overflow-y:auto;-webkit-overflow-scrolling:touch;display:flex;flex-direction:column';
  ov.innerHTML=
    '<div id="cp-list" style="flex:1">'+
      '<div style="position:sticky;top:0;background:#1a365d;color:#fff;padding:14px 16px;display:flex;justify-content:space-between;align-items:center;z-index:2">'+
        '<div>'+
          '<div style="font-size:16px;font-weight:800">Proposals</div>'+
          '<div style="font-size:12px;opacity:.7;margin-top:1px">'+escHtml(c.name)+'</div>'+
        '</div>'+
        '<button onclick="document.querySelector(\'[data-cpov]\').remove()" style="background:rgba(255,255,255,.2);border:none;color:#fff;padding:7px 16px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">Close</button>'+
      '</div>'+
      '<div id="cp-accordion">'+_accordionHTML()+'</div>'+
    '</div>'+
    '<div id="cp-detail" style="display:none;flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch">'+
      '<div style="position:sticky;top:0;background:var(--bg);border-bottom:2px solid var(--border);padding:10px 14px;display:flex;align-items:center;gap:10px;z-index:2">'+
        '<button onclick="_cpBack()" style="padding:7px 12px;border-radius:8px;border:1.5px solid var(--border2);background:var(--bg2);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;color:var(--text);white-space:nowrap">← Back</button>'+
        '<div id="cp-tabs" style="display:flex;gap:6px;flex:1;justify-content:center"></div>'+
        '<div style="width:70px"></div>'+
      '</div>'+
      '<div id="cp-bid-pane" style="padding:16px;max-width:680px;margin:0 auto"></div>'+
      '<div id="cp-prop-pane" style="padding:16px;max-width:680px;margin:0 auto;display:none"></div>'+
    '</div>';
  document.body.appendChild(ov);

  window._cpRefresh=()=>{const acc=document.getElementById('cp-accordion');if(acc)acc.innerHTML=_accordionHTML();};
}

function _cpToggleYr(yr){
  window['_cpYr_'+yr]=window['_cpYr_'+yr]!==true;
  window._cpRefresh?.();
}
function _cpToggleMo(yr,mo){
  window['_cpMo_'+yr+'_'+mo]=window['_cpMo_'+yr+'_'+mo]!==true;
  window._cpRefresh?.();
}
function _cpBack(){
  const ov=document.querySelector('[data-cpov]');if(!ov)return;
  document.getElementById('cp-list').style.display='';
  document.getElementById('cp-detail').style.display='none';
  ov.scrollTop=0;
}
function _cpOpen(bidId,view){
  const b=bids.find(x=>x.id===bidId);if(!b)return;
  const ov=document.querySelector('[data-cpov]');if(!ov)return;
  document.getElementById('cp-list').style.display='none';
  document.getElementById('cp-detail').style.display='';
  ov.scrollTop=0;

  // Build bid pane (internal contractor view)
  const pays=getBidPayments(bidId);
  const paid=getBidPaid(bidId);
  const PAINT={'std':'Standard (Behr/Valspar)','prem':'Sherwin-Williams Premium','ultra':'SW Emerald Ultra'};
  const COND={'1.0':'Good — minor prep','1.2':'Fair — moderate prep','1.5':'Poor — heavy prep'};
  const surfs=b.surfaces||[];
  const scope=b.scope?Object.entries(b.scope).filter(([,v])=>v).map(([k])=>{const s=SCOPE_ITEMS?.find(x=>x.id===k);return s?s.label:k;}):[];
  const SURF={'walls':'Walls','ceiling':'Ceiling','trim':'Trim','doors':'Doors','windows':'Windows','cabinets':'Cabinets','ext_walls':'Siding','ext_trim':'Ext trim','deck':'Deck','fence':'Fence','epoxy':'Epoxy floor'};
  const dateStr=b.signedAt?new Date(b.signedAt).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}):(b.bid_date||'');

  let bidHTML=
    '<div style="background:var(--blue-lt);border-radius:12px;padding:16px;margin-bottom:16px">'+
      '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--blue-dk);margin-bottom:6px">Signed proposal</div>'+
      '<div style="font-size:20px;font-weight:800;color:var(--text);margin-bottom:2px">'+escHtml(b.type||b.trade_type||'Proposal')+'</div>'+
      (b.addr?'<div style="font-size:12px;color:var(--text2);margin-top:2px">'+escHtml(b.addr)+'</div>':'')+
      '<div style="font-size:12px;color:var(--text3);margin-top:4px">'+(dateStr?'Signed '+dateStr+' · ':'')+fmt(b.amount)+' total</div>'+
    '</div>';

  if(b.geiLines&&b.geiLines.length){
    bidHTML+='<div class="card" style="margin-bottom:12px"><div style="font-size:11px;font-weight:800;text-transform:uppercase;color:var(--text3);margin-bottom:10px">Line items</div>'+
      b.geiLines.map(l=>'<div style="display:flex;justify-content:space-between;align-items:baseline;padding:5px 0;border-bottom:1px solid var(--border);font-size:13px"><span>'+escHtml(l.desc||l.name||'')+'</span><span style="font-weight:700;color:var(--green-mid)">'+fmt(l.total||l.amount||0)+'</span></div>').join('')+
      '<div style="display:flex;justify-content:space-between;padding:8px 0 0;font-size:14px;font-weight:800"><span>Total</span><span style="color:var(--green-mid)">'+fmt(b.amount)+'</span></div>'+
    '</div>';
  }else if(surfs.length){
    bidHTML+='<div class="card" style="margin-bottom:12px"><div style="font-size:11px;font-weight:800;text-transform:uppercase;color:var(--text3);margin-bottom:10px">Surfaces</div>'+
      surfs.map(s=>'<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0;border-bottom:1px solid var(--border)"><span>'+(SURF[s.type]||s.type)+(s.room?' · '+escHtml(s.room):'')+'</span><span style="color:var(--text2)">'+((s.qty||s.sqft||0)+' '+(s.unit||'sqft'))+'</span></div>').join('')+
    '</div>';
    if(b.paint||b.condition)bidHTML+='<div class="card" style="margin-bottom:12px"><div style="font-size:12px;color:var(--text2);margin-bottom:4px"><strong>Paint:</strong> '+(PAINT[b.paint]||b.paint||'—')+'</div><div style="font-size:12px;color:var(--text2)"><strong>Condition:</strong> '+(COND[b.condition]||b.condition||'—')+'</div></div>';
    if(scope.length)bidHTML+='<div class="card" style="margin-bottom:12px"><div style="font-size:11px;font-weight:800;text-transform:uppercase;color:var(--text3);margin-bottom:8px">Scope of work</div>'+scope.map(s=>'<div style="font-size:13px;padding:3px 0;border-bottom:1px solid var(--border)">'+escHtml(s)+'</div>').join('')+'</div>';
  }

  if(b.notes)bidHTML+='<div class="card" style="margin-bottom:12px"><div style="font-size:11px;font-weight:800;text-transform:uppercase;color:var(--text3);margin-bottom:6px">Notes</div><div style="font-size:13px;color:var(--text2);line-height:1.5">'+escHtml(b.notes)+'</div></div>';

  if(pays.length){
    bidHTML+='<div class="card" style="margin-bottom:12px"><div style="font-size:11px;font-weight:800;text-transform:uppercase;color:var(--text3);margin-bottom:8px">Payment history</div>'+
      pays.map(p=>{const ref=p.type==='refund';return '<div style="display:flex;justify-content:space-between;font-size:12px;padding:5px 0;border-bottom:1px solid var(--border)"><span style="color:var(--text2)">'+p.date+' · '+(ref?'REFUND':escHtml(p.method||p.type)+(p.ref?' #'+escHtml(p.ref):''))+'</span><span style="font-weight:700;color:'+(ref?'#A32D2D':'var(--green-mid)')+'">'+( ref?'↩ -':'+' )+fmt(Math.abs(p.amount))+'</span></div>';}).join('')+
      '<div style="display:flex;justify-content:space-between;font-size:13px;font-weight:800;padding:8px 0 0"><span>Total paid</span><span style="color:var(--green-mid)">'+fmt(paid)+'</span></div>'+
    '</div>';
  }

  document.getElementById('cp-bid-pane').innerHTML=bidHTML;

  // Build proposal pane (client view)
  const propPane=document.getElementById('cp-prop-pane');
  const _cpStorageKey=b.signingKey||b.proposalKey||null;
  const _cpSignedBadge=b.signedAt?'<div style="background:#D1FAE5;border:1px solid #6EE7B7;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:12px;color:#065F46;display:flex;align-items:center;gap:8px"><span style="font-size:16px">✓</span><span><strong>Signed</strong> '+new Date(b.signedAt).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})+(b.signedName?' by '+escHtml(b.signedName):'')+'</span></div>':'';
  // Signature block pinned at the bottom of the client view — image from the stored
  // proposal JSON when available, falling back to the name/timestamp on the bid so the
  // block still shows when the storage write was missed at signing time.
  function _cpSigBlock(prop){
    const name=(prop&&prop.signerName)||b.signedName||'';
    const at=(prop&&prop.signedAt)||b.signedAt||'';
    if(!at)return '';
    const dt=new Date(at).toLocaleString('en-US',{month:'long',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
    const _sigUrl=(prop&&prop.signatureDataUrl)||b.signatureData||null;
    const img=_sigUrl?'<div style="background:#fff;border:1.5px solid var(--border2);border-radius:10px;padding:12px;margin:10px 0;text-align:center"><img src="'+_sigUrl+'" style="max-width:100%;max-height:110px" alt="Client signature"></div>':'';
    return '<div id="cp-sig-block" style="margin-top:20px;border-top:2px solid var(--border2);padding-top:14px">'+
      '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);margin-bottom:8px">Client Signature</div>'+img+
      '<div style="font-size:13px;color:var(--text2)"><strong>'+escHtml(name||'—')+'</strong> · '+dt+'</div>'+
    '</div>';
  }
  function _cpRenderProp(html,colorTop){propPane.innerHTML=(colorTop||'')+_cpSignedBadge+html+_cpSigBlock(null);}
  if(b.proposalHtml){
    _cpRenderProp(b.proposalHtml);
    // Also fetch color choices + signature image if signed
    if(_cpStorageKey&&b.signedAt&&typeof _supa!=='undefined'){
      _supa.storage.from('proposals').download(_cpStorageKey).then(({data})=>{if(!data)return;data.text().then(txt=>{try{
        const prop=JSON.parse(txt);
        // Upgrade the signature block with the drawn signature image
        if(prop.signatureDataUrl||prop.signerName){const old=document.getElementById('cp-sig-block');const wrap=document.createElement('div');wrap.innerHTML=_cpSigBlock(prop);if(old&&wrap.firstChild)old.replaceWith(wrap.firstChild);else if(wrap.firstChild)propPane.appendChild(wrap.firstChild);}
        const choices=prop.colorChoices||[];if(!choices.length)return;const cd=document.createElement('div');cd.style.cssText='background:#EFF6FF;border:1.5px solid #BFDBFE;border-radius:10px;padding:14px 16px;margin-bottom:16px';cd.innerHTML='<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#1E40AF;margin-bottom:10px">🎨 Client Color Selections</div>'+choices.map(ch=>'<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #DBEAFE;font-size:13px"><span style="font-weight:600;color:#1E3A5F">'+escHtml(ch.room)+'</span><span style="color:#1E40AF;font-weight:700">'+escHtml(ch.colorName)+(ch.swCode?' <span style="font-size:11px;opacity:.7">('+escHtml(ch.swCode)+')</span>':'')+'</span></div>').join('');propPane.insertBefore(cd,propPane.firstChild);}catch(e){}});}).catch(()=>{});
    }
  }else if(_cpStorageKey&&typeof _supa!=='undefined'){
    propPane.innerHTML='<div style="padding:40px 16px;text-align:center;color:var(--text3);font-size:13px">Loading proposal…</div>';
    _supa.storage.from('proposals').download(_cpStorageKey).then(({data,error})=>{
      if(error||!data){propPane.innerHTML='<div style="padding:40px;text-align:center;color:var(--text3);font-style:italic">Could not load proposal.</div>';return;}
      data.text().then(txt=>{try{
        const prop=JSON.parse(txt);
        const html=prop.proposalHtml||'';
        if(!html){propPane.innerHTML='<div style="padding:40px;text-align:center;color:var(--text3);font-style:italic">No HTML in stored proposal.</div>';return;}
        b.proposalHtml=html;
        let colorTop='';
        const choices=prop.colorChoices||[];
        if(choices.length)colorTop='<div style="background:#EFF6FF;border:1.5px solid #BFDBFE;border-radius:10px;padding:14px 16px;margin-bottom:16px"><div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#1E40AF;margin-bottom:10px">🎨 Client Color Selections</div>'+choices.map(ch=>'<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #DBEAFE;font-size:13px"><span style="font-weight:600;color:#1E3A5F">'+escHtml(ch.room)+'</span><span style="color:#1E40AF;font-weight:700">'+escHtml(ch.colorName)+(ch.swCode?' <span style="font-size:11px;opacity:.7">('+escHtml(ch.swCode)+')</span>':'')+'</span></div>').join('')+'</div>';
        propPane.innerHTML=colorTop+_cpSignedBadge+html+_cpSigBlock(prop);
      }catch(e){propPane.innerHTML='<div style="padding:40px;text-align:center;color:var(--text3);font-style:italic">Error parsing proposal.</div>';}});
    }).catch(()=>{propPane.innerHTML='<div style="padding:40px;text-align:center;color:var(--text3);font-style:italic">Could not load proposal.</div>';});
  }else{
    propPane.innerHTML='<div style="padding:40px 16px;text-align:center;color:var(--text3);font-size:14px;font-style:italic">No proposal on file for this bid.</div>';
  }

  // Render tabs
  function _tabBtn(v,label,active){
    return '<button id="cp-tab-'+v+'" onclick="_cpView(\''+v+'\')" style="padding:7px 16px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;border:1.5px solid '+(active?'var(--blue)':'var(--border2)')+';background:'+(active?'var(--blue-lt)':'var(--bg)')+';color:'+(active?'var(--blue-dk)':'var(--text2)')+'">'+label+'</button>';
  }
  document.getElementById('cp-tabs').innerHTML=_tabBtn('bid','📋 Our bid',view==='bid')+_tabBtn('proposal','📄 Client view',view==='proposal');
  _cpView(view);
}
function _cpView(v){
  ['bid','proposal'].forEach(x=>{
    const pane=document.getElementById('cp-'+x+'-pane');
    const tab=document.getElementById('cp-tab-'+x);
    if(pane)pane.style.display=x===v?'':'none';
    if(tab){
      const active=x===v;
      tab.style.borderColor=active?'var(--blue)':'var(--border2)';
      tab.style.background=active?'var(--blue-lt)':'var(--bg)';
      tab.style.color=active?'var(--blue-dk)':'var(--text2)';
    }
  });
}

function renderCDJobs(){
  const cjobs=getClientJobs(currentClientId);
  const tk=todayKey();
  const el=document.getElementById('cd-jobs-list');
  const paintJobs=cjobs.filter(j=>j.eventType!=='estimate');
  if(!paintJobs.length){el.innerHTML='<div class="empty">No paint jobs scheduled yet.</div>';return;}
  el.innerHTML=paintJobs.map(j=>{
    const isActive=j.start<=tk&&addDays(j.start,(parseInt(j.days)||1)-1)>=tk;
    const isDone=j.status==='done';
    const endDay=addDays(j.start,(parseInt(j.days)||1)-1);
    const isPast=endDay<tk;
    const cmiles=getClientMileage(currentClientId).filter(m=>m.date>=j.start&&m.date<=addDays(endDay,7));
    const jobMiles=cmiles.reduce((s,m)=>s+(m.miles||0),0);
    let statusBdg='';
    if(isDone)statusBdg='<span class="bdg bdg-done">Done</span> <button onclick="reopenJob('+j.id+')" style="font-size:10px;padding:2px 8px;border-radius:10px;border:1px solid var(--border2);background:none;color:var(--text3);cursor:pointer;font-family:inherit;margin-left:4px">Reopen</button>';
    else if(isActive)statusBdg='<span class="bdg bdg-active">Active today</span>';
    else if(isPast)statusBdg='<span class="bdg bdg-pending">Needs completion date</span>';
    else statusBdg='<span class="bdg bdg-upcoming">Upcoming</span>';
    let milesHTML='';
    if(jobMiles>0){
      milesHTML='<div style="font-size:11px;color:var(--text2);margin-top:4px">'+
        '<svg viewBox="0 0 24 24" style="width:11px;height:11px;stroke:var(--blue);fill:none;stroke-width:2;vertical-align:middle;margin-right:3px"><circle cx="12" cy="10" r="3"/><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/></svg>'+
        jobMiles.toFixed(1)+' mi driven · '+fmt(jobMiles*IRS())+' deduction</div>';
    }
    let doneBtn='';
    if(!isDone&&(isActive||isPast)){
      doneBtn='<button class="btn btn-sm btn-g" onclick="markJobDone('+j.id+')">Mark complete</button>';
    }
    if(isDone&&j.completion_date){
      doneBtn='<span style="font-size:11px;color:var(--text3)">Completed '+j.completion_date+'</span>';
    }
    let clockBtnCD='';
    if(!isDone){
      const isClockedHere=_activeTimer&&_activeTimer.jobId===j.id;
      if(isClockedHere){
        const _el2=Math.floor((Date.now()-_activeTimer.startTime)/1000);
        const _h2=Math.floor(_el2/3600),_m2=Math.floor((_el2%3600)/60),_s2=_el2%60;
        const _ts2=(_h2?_h2+'h ':'')+_m2+':'+((_s2<10?'0':'')+_s2);
        const _sl2=_activeTimer.scopeLabel?_activeTimer.scopeLabel+' ':'';
        clockBtnCD='<button class="btn btn-sm" onclick="clockOut()" style="border-color:#E97B00;color:#E97B00;background:#FFF3E0">⏹ '+_sl2+_ts2+'</button>';
      }else{
        const logged=getJobClockTotal(j.id);
        const loggedLabel=logged>0?_fmtMin(logged)+' logged · ':'';
        clockBtnCD='<button class="btn btn-sm" onclick="openClockInSheet('+j.id+')" style="border-color:var(--border2);color:var(--text2)">▶ '+(logged>0?loggedLabel:'')+'Clock in</button>';
      }
    }
    return '<div class="card" style="margin-bottom:8px;border-left:3px solid '+(j.color||'var(--blue)')+'" data-lp-id="'+j.id+'" data-lp-type="job" data-lp-label="'+escHtml(j.name||'job')+'">'+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start">'+
        '<div style="flex:1;min-width:0">'+
          '<div style="font-size:14px;font-weight:700">'+escHtml(j.name||'')+'</div>'+
          '<div style="font-size:11px;color:var(--text3)">'+parseD(j.start).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})+(j.time?' @ '+fmtTime(j.time):'')+' · '+(j.eventType==='estimate'?(j.hours?j.hours+'hr estimate':'Estimate visit'):j.days+' day'+(j.days>1?'s':''))+(j.addr?' · '+escHtml(j.addr):'')+' </div>'+
          milesHTML+
        '</div>'+
        '<div style="text-align:right;flex-shrink:0">'+
          (j.value?'<div style="font-size:14px;font-weight:700;color:var(--green-mid)">'+fmt(j.value)+'</div>':'')+
          statusBdg+
        '</div>'+
      '</div>'+
      '<div class="brow" style="margin-top:8px">'+
        (doneBtn?doneBtn:'')+clockBtnCD+'<button class="btn-del" onclick="deleteJob('+j.id+')" style="font-size:11px;padding:5px 8px;color:#A32D2D">Remove</button>'+
      '</div>'+
    '</div>';
  }).join('');
}

function callClient(){const c=getClientById(currentClientId);if(c&&c.phone)window.location.href='tel:'+c.phone.replace(/\D/g,'');}
function textClient(){
  const c=getClientById(currentClientId);if(!c?.phone)return;
  const phone=c.phone.replace(/\D/g,'');
  const existing=document.getElementById('_text-compose-ov');if(existing)existing.remove();
  const ov=document.createElement('div');
  ov.id='_text-compose-ov';
  ov.style.cssText='position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;justify-content:flex-end;background:rgba(0,0,0,.45)';
  ov.onclick=e=>{if(e.target===ov)ov.remove();};
  const sheet=document.createElement('div');
  sheet.style.cssText='background:var(--bg);border-radius:16px 16px 0 0;padding:16px 16px 32px;display:flex;flex-direction:column;gap:10px';
  const sendBtn=document.createElement('button');
  sendBtn.textContent='Open in Messages →';
  sendBtn.style.cssText='padding:14px;border:none;border-radius:var(--r);background:var(--blue);color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit';
  sendBtn.onclick=()=>{
    const body=document.getElementById('_text-compose-body')?.value.trim()||'';
    const sep=/iphone|ipad/i.test(navigator.userAgent)?'&':'?';
    window.location.href='sms:'+phone+sep+'body='+encodeURIComponent(body);
    ov.remove();
  };
  const cancelBtn=document.createElement('button');
  cancelBtn.textContent='Cancel';
  cancelBtn.style.cssText='padding:10px;border:1px solid var(--border2);border-radius:var(--r);background:none;color:var(--text3);font-size:13px;cursor:pointer;font-family:inherit';
  cancelBtn.onclick=()=>ov.remove();
  const grip=document.createElement('div');
  grip.style.cssText='width:36px;height:4px;background:var(--border2);border-radius:2px;margin:0 auto 4px';
  const title=document.createElement('div');
  title.style.cssText='font-size:14px;font-weight:700;color:var(--text2)';
  title.textContent='Text '+c.name;
  const ta=document.createElement('textarea');
  ta.id='_text-compose-body';ta.rows=4;ta.placeholder='Type your message...';
  ta.style.cssText='font-size:15px;padding:10px 12px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg);color:var(--text);font-family:inherit;resize:none;width:100%;box-sizing:border-box';
  [grip,title,ta,sendBtn,cancelBtn].forEach(el=>sheet.appendChild(el));
  ov.appendChild(sheet);document.body.appendChild(ov);
  setTimeout(()=>ta.focus(),100);
}
function emailClient(){const c=getClientById(currentClientId);if(c&&c.email)window.open('mailto:'+c.email);}
let _mapsPickerAddrs=[];
function openMapsDir(){
  const c=getClientById(currentClientId);if(!c||!c.addr)return zAlert('No address on file for this client.');
  const extras=(c.extraAddresses||[]).filter(a=>a.addr);
  if(extras.length===0){window.open('https://maps.apple.com/?daddr='+encodeURIComponent(c.addr),'_blank');return;}
  _mapsPickerAddrs=[{label:'Primary',addr:c.addr},...extras];
  const btns=_mapsPickerAddrs.map((a,i)=>'<button onclick="_mapsPickAddr('+i+')" style="display:block;width:100%;text-align:left;padding:11px 14px;border:1px solid var(--border2);border-radius:var(--r);background:var(--bg2);font-size:13px;cursor:pointer;font-family:inherit;color:var(--text);margin-bottom:6px"><span style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text3);display:block;margin-bottom:2px">'+escHtml(a.label)+'</span>'+escHtml(a.addr)+'</button>').join('');
  zAlert('<div style="text-align:left">'+btns+'</div>',{title:'Get directions to...'});
}
function _mapsPickAddr(idx){
  const a=_mapsPickerAddrs[idx];
  if(a)window.open('https://maps.apple.com/?daddr='+encodeURIComponent(a.addr),'_blank');
  document.querySelector('.zmodal-overlay')?.remove();
}
let _cdAddrList=[];
function _cdMapAddr(i){const a=_cdAddrList[i];if(a)window.open('https://maps.apple.com/?daddr='+encodeURIComponent(a),'_blank');}
function renderCDAddresses(){
  const el=document.getElementById('cd-addresses-list');if(!el)return;
  const c=getClientById(currentClientId);if(!c)return;
  const extras=(c.extraAddresses||[]);
  _cdAddrList=[c.addr,...extras.map(a=>a.addr)];
  const openKey='_cdpropOpen_'+currentClientId;
  const isOpen=!!window[openKey];
  const hasProp=!!(c.yearBuilt||c.sqft||c.estimatedValue||c.stories||c.bedrooms||c.bathrooms||c.exteriorMaterial||c.roofType||c.garage||c.lotSize||c.lastSaleDate||c.isRental);
  const pre78Badge=c.yearBuilt&&c.yearBuilt<1978?`<span style="font-size:10px;background:rgba(163,45,45,.12);color:#A32D2D;border-radius:4px;padding:2px 5px;font-weight:700;margin-left:5px">⚠️ Pre-1978</span>`:'';
  const srcBadge=c.propDataFetchedAt
    ?(c.propDataExact===false?`<span style="font-size:10px;color:var(--text3);margin-left:4px">(area avg)</span>`:'')
    :(c.street&&c.city?`<button onmousedown="event.stopPropagation()" onclick="event.stopPropagation();_lookupPropertyData(${c.id},{street:'${escHtml(c.street||'')}',city:'${escHtml(c.city||'')}',state:'${escHtml(c.state||'')}',zip:'${escHtml(c.zip||'')}'});this.disabled=true;this.textContent='Looking up…'" style="font-size:11px;color:var(--blue);background:none;border:none;cursor:pointer;padding:0;font-family:inherit;margin-left:6px">🏠 Look up</button>`:'');
  const chevron=hasProp?`<span style="font-size:9px;color:var(--text3);display:inline-block;transform:rotate(${isOpen?90:0}deg);transition:transform .15s;margin-right:2px">▶</span>`:'';
  const propPanel=hasProp&&isOpen?`<div style="padding:10px 0 4px;border-top:1px solid var(--border);margin-top:8px">
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:8px${c.exteriorMaterial||c.roofType||c.garage||c.isRental||c.lastSaleDate||c.lastSalePrice||c.assessorUrl?';margin-bottom:8px':''}">
      ${c.yearBuilt?`<div style="min-width:0"><div style="font-size:15px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.yearBuilt}</div><div style="font-size:10px;color:var(--text3)">📅 Year built</div></div>`:''}
      ${c.sqft?`<div style="min-width:0"><div style="font-size:15px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${Number(c.sqft).toLocaleString()}</div><div style="font-size:10px;color:var(--text3)">📐 Sq ft</div></div>`:''}
      ${c.estimatedValue?`<div style="min-width:0"><div style="font-size:14px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${fmt(c.estimatedValue)}</div><div style="font-size:10px;color:var(--text3)">💰 Est. value</div></div>`:''}
      ${c.stories?`<div style="min-width:0"><div style="font-size:15px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.stories}</div><div style="font-size:10px;color:var(--text3)">🏢 Stories</div></div>`:''}
      ${c.bedrooms?`<div style="min-width:0"><div style="font-size:15px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.bedrooms}</div><div style="font-size:10px;color:var(--text3)">🛏 Beds</div></div>`:''}
      ${c.bathrooms?`<div style="min-width:0"><div style="font-size:15px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.bathrooms}</div><div style="font-size:10px;color:var(--text3)">🛁 Baths</div></div>`:''}
      ${c.lotSize?`<div style="min-width:0"><div style="font-size:15px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(String(c.lotSize))}</div><div style="font-size:10px;color:var(--text3)">🌳 Lot</div></div>`:''}
    </div>
    ${c.exteriorMaterial||c.roofType||c.garage||c.isRental?`<div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:${c.lastSaleDate||c.lastSalePrice||c.assessorUrl?'8px':'0'}">
      ${c.exteriorMaterial?`<span style="font-size:11px;background:var(--bg);border:1px solid var(--border2);border-radius:20px;padding:3px 8px">🏠 ${escHtml(String(c.exteriorMaterial))}</span>`:''}
      ${c.roofType?`<span style="font-size:11px;background:var(--bg);border:1px solid var(--border2);border-radius:20px;padding:3px 8px">🏗️ ${escHtml(String(c.roofType))}</span>`:''}
      ${c.garage?`<span style="font-size:11px;background:var(--bg);border:1px solid var(--border2);border-radius:20px;padding:3px 8px">🚗 ${escHtml(String(c.garage))}</span>`:''}
      ${c.isRental?`<span style="font-size:11px;background:rgba(233,123,0,.12);border:1px solid rgba(233,123,0,.3);border-radius:20px;padding:3px 8px;color:#E97B00;font-weight:700">🔑 Rental</span>`:''}
    </div>`:''}
    ${c.lastSaleDate||c.lastSalePrice?`<div style="font-size:12px;color:var(--text3);padding-top:6px;border-top:1px solid var(--border);margin-bottom:${c.assessorUrl?'6px':'0'}">Last sold ${c.lastSaleDate?new Date(c.lastSaleDate).toLocaleDateString('en-US',{month:'short',year:'numeric'}):''}${c.lastSalePrice?' · <strong style="color:var(--text)">'+fmt(c.lastSalePrice)+'</strong>':''}</div>`:''}
    ${c.assessorUrl?`<a href="${escHtml(c.assessorUrl)}" target="_blank" style="font-size:11px;color:var(--blue)">${c.propDataSource==='zillow'?'View on Zillow →':'County record →'}</a>`:''}
  </div>`:''
  let html=`<div style="padding:9px 0${extras.length?';border-bottom:1px solid var(--border)':''}">
    <div onclick="window['${openKey}']=!window['${openKey}'];renderCDAddresses()" style="display:flex;justify-content:space-between;align-items:flex-start;cursor:${hasProp?'pointer':'default'}">
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:700;display:flex;align-items:center;flex-wrap:wrap;gap:2px">Primary${pre78Badge}${srcBadge}</div>
        <div style="font-size:13px;color:var(--text2);margin-top:2px">${escHtml(c.addr||'No address')}</div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;margin-left:8px;margin-top:2px">
        ${chevron}
        <button onmousedown="event.stopPropagation()" onclick="event.stopPropagation();_cdMapAddr(0)" style="background:none;border:1px solid var(--border2);border-radius:var(--r);padding:5px 10px;font-size:11px;cursor:pointer;font-family:inherit;color:var(--text3)">Map</button>
      </div>
    </div>
    ${propPanel}
  </div>`;
  extras.forEach((a,i)=>{
    html+=`<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0${i<extras.length-1?';border-bottom:1px solid var(--border)':''}">
      <div><div style="font-size:12px;font-weight:700;color:var(--text3)">${escHtml(a.label||'Property '+(i+2))}</div><div style="font-size:13px;color:var(--text2);margin-top:2px">${escHtml(a.addr)}</div></div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        <button onclick="_cdMapAddr(${i+1})" style="background:none;border:1px solid var(--border2);border-radius:var(--r);padding:5px 10px;font-size:11px;cursor:pointer;font-family:inherit;color:var(--text3)">Map</button>
        <button onclick="removeClientAddress(${i})" style="background:none;border:1px solid #A32D2D;border-radius:var(--r);padding:5px 8px;font-size:11px;cursor:pointer;font-family:inherit;color:#A32D2D">✕</button>
      </div></div>`;
  });
  if(!c.addr&&extras.length===0)html+='<div style="font-size:12px;color:var(--text3);padding:6px 0 2px">No address — edit client to add one.</div>';
  el.innerHTML=html;
}
function openAddAddressModal(){
  const overlay=document.createElement('div');overlay.className='zmodal-overlay';
  overlay.innerHTML='<div class="zmodal" style="max-width:360px"><div class="zmodal-title">Add property address</div>'+
    '<div class="f" style="margin-bottom:10px"><label style="font-size:11px;font-weight:700;display:block;margin-bottom:4px">Label (e.g. Vacation home, Rental)</label>'+
    '<input id="_aa-label" placeholder="Vacation home" style="width:100%;box-sizing:border-box;padding:9px;border:1px solid var(--border2);border-radius:var(--r);background:var(--bg2);color:var(--text);font-size:13px;font-family:inherit"></div>'+
    '<div class="f" style="margin-bottom:14px;position:relative"><label style="font-size:11px;font-weight:700;display:block;margin-bottom:4px">Address <span style="color:#A32D2D">*</span></label>'+
    '<input id="_aa-addr" placeholder="5678 Oak Ave, Wichita KS 67206" autocomplete="off" style="width:100%;box-sizing:border-box;padding:9px;border:1px solid var(--border2);border-radius:var(--r);background:var(--bg2);color:var(--text);font-size:13px;font-family:inherit"></div>'+
    '<div style="display:flex;gap:8px">'+
      '<button onclick="saveAddClientAddress()" class="btn btn-g" style="flex:1">Add</button>'+
      '<button onclick="this.closest(\'.zmodal-overlay\').remove()" class="btn" style="flex:1">Cancel</button>'+
    '</div></div>';
  document.body.appendChild(overlay);
  const _aaInp=document.getElementById('_aa-addr');
  if(_aaInp&&typeof _addrAutoFull==='function')_addrAutoFull(_aaInp,null);
  setTimeout(()=>{const el=document.getElementById('_aa-label');if(el)el.focus();},80);
}
function saveAddClientAddress(){
  const addr=(document.getElementById('_aa-addr')?.value||'').trim();
  if(!addr){zAlert('Enter an address.');return;}
  const label=(document.getElementById('_aa-label')?.value||'').trim()||'Additional property';
  const c=getClientById(currentClientId);if(!c)return;
  if(!c.extraAddresses)c.extraAddresses=[];
  c.extraAddresses.push({label,addr});
  saveAll();
  document.querySelector('.zmodal-overlay')?.remove();
  renderCDAddresses();
}
function removeClientAddress(idx){
  const c=getClientById(currentClientId);if(!c||!c.extraAddresses)return;
  zConfirm('Remove this address?',()=>{
    c.extraAddresses.splice(idx,1);
    saveAll();
    renderCDAddresses();
  });
}
