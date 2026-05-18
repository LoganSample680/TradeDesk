function openBidNotes(bidId){editingBidId=bidId;lastCreatedBidId=bidId;}
function showNotesFab(){}
function hideNotesFab(){}

function toggleNotesPanel(){}
function notesExpandCanvas(){}
function clearNotesPanel(){}
function _resetNotesForNewEstimate(){}

let hittersFilter='all';
function setHittersFilter(f,btn){
  hittersFilter=f;
  ['all','A','B'].forEach(t=>{
    const b=document.getElementById('hl-filter-'+t);
    if(b){b.style.background=t===f?'var(--blue)':'';b.style.color=t===f?'#fff':'';b.style.borderColor=t===f?'var(--blue)':'var(--border2)';}
  });
  renderHittersList();
}
function renderHittersList(){
  const el=document.getElementById('hl-list');
  const stats=document.getElementById('hl-stats');
  if(!el)return;
  if(!clients.length){el.innerHTML='<div class="empty">No clients yet. Add clients and set their occupation to build your Top Clients list.</div>';return;}
  // Score each client
  const scored=clients.map(c=>{
    const tier=getClientTier(c);
    const cBids=getClientBids(c.id);
    const revenue=getClientIncome(c.id).reduce((s,i)=>s+i.amount,0);
    const wonJobs=cBids.filter(b=>b.status==='Closed Won').length;
    const hasEmail=!!c.email;
    const lastContact=cBids.length?cBids.sort((a,b)=>(b.bid_date||'').localeCompare(a.bid_date||''))[0].bid_date:'';
    const daysSince=lastContact?Math.floor((new Date()-new Date(lastContact+'T12:00'))/86400000):999;
    // Score: A=3pts, B=2pts, C=1pt + revenue bonuses + realtor bonus
    let score=(tier==='A'?30:tier==='B'?20:10);
    score+=Math.min(revenue/1000,30); // up to 30pts for revenue
    score+=wonJobs*5;
    if(c.occupation==='Realtor / Real estate agent'||c.occupation==='Property manager')score+=20;
    if(c.source==='Real estate agent')score+=15;
    if(daysSince<90)score+=10;
    if(hasEmail)score+=5;
    return{c,tier,revenue,wonJobs,score,daysSince,hasEmail,lastContact};
  })
  .filter(x=>hittersFilter==='all'||x.tier===hittersFilter)
  .sort((a,b)=>b.score-a.score);

  // Stats header
  const aCount=clients.filter(c=>getClientTier(c)==='A').length;
  const bCount=clients.filter(c=>getClientTier(c)==='B').length;
  const realtors=clients.filter(c=>c.occupation==='Realtor / Real estate agent'||c.source==='Real estate agent').length;
  stats.innerHTML=
    '<div class="mets">'+
      '<div class="met"><div class="met-l">A-tier clients</div><div class="met-v" style="color:var(--green-mid)">'+aCount+'</div></div>'+
      '<div class="met"><div class="met-l">B-tier clients</div><div class="met-v" style="color:var(--blue)">'+bCount+'</div></div>'+
      '<div class="met"><div class="met-l">Realtors / PMs</div><div class="met-v" style="color:var(--amber)">'+realtors+'</div></div>'+
    '</div>';

  if(!scored.length){
    el.innerHTML='<div class="empty">No '+hittersFilter+'-tier clients yet.</div>';
    return;
  }

  el.innerHTML=scored.map(({c,tier,revenue,wonJobs,score,daysSince,hasEmail,lastContact})=>{
    const tierColor=getTierColor(tier);
    const isRealtor=c.occupation==='Realtor / Real estate agent'||c.source==='Real estate agent';
    const isPM=c.occupation==='Property manager'||c.source==='Property manager';
    const daysLabel=daysSince===999?'No contact yet':daysSince===0?'Today':daysSince===1?'Yesterday':daysSince+' days ago';
    return '<div onclick="openClientDetail('+c.id+')" class="card" style="cursor:pointer;margin-bottom:8px;border-left:3px solid '+tierColor+'">'+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">'+
        '<div style="flex:1;min-width:0">'+
          '<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;flex-wrap:wrap">'+
            '<div style="font-size:14px;font-weight:700">'+c.name+'</div>'+
            '<span style="font-size:10px;font-weight:800;padding:2px 6px;border-radius:10px;background:'+tierColor+'22;color:'+tierColor+'">'+tier+'-tier</span>'+
            (isRealtor?'<span style="font-size:10px;font-weight:700;color:var(--amber)">🏡 Realtor</span>':'')+ 
            (isPM?'<span style="font-size:10px;font-weight:700;color:var(--blue)">🏢 PM</span>':'')+
          '</div>'+
          (c.occupation?'<div style="font-size:11px;color:var(--text2);margin-bottom:2px">'+c.occupation+'</div>':'')+
          '<div style="font-size:11px;color:var(--text3)">Last contact: '+daysLabel+
            (revenue?' · '+fmt(revenue)+' lifetime':'')+
            (wonJobs?' · '+wonJobs+' job'+(wonJobs!==1?'s':''):'')+
          '</div>'+
        '</div>'+
        '<div style="text-align:right;flex-shrink:0">'+
          '<div style="font-size:11px;font-weight:700;color:var(--text3)">Score</div>'+
          '<div style="font-size:18px;font-weight:800;color:'+tierColor+'">'+Math.round(score)+'</div>'+
        '</div>'+
      '</div>'+
      (hasEmail?
        '<div style="margin-top:8px;display:flex;gap:6px">'+
          '<a href="mailto:'+c.email+'" onclick="event.stopPropagation()" class="btn btn-sm" style="font-size:11px;text-decoration:none">📧 Email</a>'+
          (c.phone?'<a href="sms:'+c.phone.replace(/\D/g,'')+'" onclick="event.stopPropagation()" class="btn btn-sm" style="font-size:11px;text-decoration:none">💬 Text</a>':'')+ 
        '</div>':
        (c.phone?
          '<div style="margin-top:8px">'+
            '<a href="sms:'+c.phone.replace(/\D/g,'')+'" onclick="event.stopPropagation()" class="btn btn-sm" style="font-size:11px;text-decoration:none">💬 Text</a>'+
          '</div>':'')
      )+
    '</div>';
  }).join('');
}





function applyPermissions(){
  const taxNav=document.getElementById('nb-taxes');
  if(taxNav)taxNav.style.display=canSeeTaxes()?'':'none';
  // Hide restricted nav items for employees
  if(_isEmployee){
    ['nb-leads','nb-tracker','nb-team','nb-settings',
     'mtb-leads','mmi-tracker','mmi-taxes','mmi-team','mmi-settings','mmi-money'].forEach(id=>{
      const el=document.getElementById(id);if(el)el.style.display='none';
    });
    // Also hide taxes nav button (already hidden by canSeeTaxes but be explicit)
    if(taxNav)taxNav.style.display='none';
  }
  _renderDevTradeCard();
  // Update nav user section
  const nameEl=document.getElementById('nav-user-name');
  const roleEl=document.getElementById('nav-user-role');
  const avatarEl=document.getElementById('nav-user-avatar');
  const _meta=_supaUser?.user_metadata;
  const _metaName=_meta?.full_name||_meta?.name||'';
  const name=_isEmployee?(_employeeRecord?.name||'Employee'):(getOwnerName()||_metaName||'My Account');
  if(nameEl)nameEl.textContent=name;
  if(roleEl)roleEl.textContent=_isEmployee?'Employee':getRole().charAt(0).toUpperCase()+getRole().slice(1);
  if(avatarEl)avatarEl.textContent=name.charAt(0).toUpperCase();
}

// ── Multi-trade support ───────────────────────────────────────────────
const TRADE_META={
  painting:  {icon:'🎨',label:'Painting'},
  plumbing:  {icon:'🔧',label:'Plumbing'},
  electrical:{icon:'⚡',label:'Electrical'},
  hvac:      {icon:'❄️',label:'HVAC'},
  roofing:   {icon:'🏠',label:'Roofing'},
  landscaping:{icon:'🌿',label:'Landscaping'},
  general:   {icon:'🔨',label:'General'},
  other:     {icon:'🛠',label:'Other'},
};
let _activeTrade=null; // set on login from account_config.business_type

function getActiveTrade(){return _activeTrade||_config?.business_type||'painting';}

function setActiveTrade(type){
  _activeTrade=type;
  _renderNavTradeSwitcher();
  _renderDevTradeCard();
  _renderSettingsTradeSections();
}

function _getTradeLines(){
  const raw=_config?.trade_lines;
  if(!raw)return[getActiveTrade()];
  if(Array.isArray(raw))return raw;
  return raw.split(',').map(s=>s.trim()).filter(Boolean);
}

function _renderNavTradeSwitcher(){
  const wrap=document.getElementById('nav-trade-switcher');
  const pills=document.getElementById('nav-trade-pills');
  if(!wrap||!pills)return;
  const lines=_getTradeLines();
  if(lines.length<=1){wrap.style.display='none';return;}
  wrap.style.display='';
  const active=getActiveTrade();
  pills.innerHTML=lines.map(t=>{
    const m=TRADE_META[t]||{icon:'🔧',label:t};
    const sel=t===active;
    return`<button onclick="setActiveTrade('${t}')" style="padding:4px 8px;border-radius:20px;border:1px solid ${sel?'var(--blue)':'rgba(255,255,255,.15)'};background:${sel?'var(--blue)':'rgba(255,255,255,.06)'};color:${sel?'#fff':'rgba(255,255,255,.55)'};font-size:11px;font-weight:${sel?700:400};cursor:pointer;font-family:inherit">${m.icon} ${m.label}</button>`;
  }).join('');
}

// ── Generic estimate (non-painting trades) ────────────────────────────
let _geiClientId=null,_geiEditBidId=null,_geiLines=[],_geiTrade=null,_geiIsCommercial=false,_geiEmergency=false,_geiStep=1,_geiNewWork=false;
let _panelSched=null; // null = not active, obj = panel schedule data
let _geiIsTM=false,_tmCrewCount=1,_tmRatePerMan=0,_tmEstHours=0,_tmBillingCycle='weekly';
let _tmMatMarkup=0,_tmCapAction='Stop & get re-approval';
let _geiIsFreeForm=false;

function openTMEstimate(c,bidId){
  _geiIsTM=true;_geiIsFreeForm=false;
  openGenericEstimate(c,bidId,null);
}
function openFreeFormEstimate(c,bidId){
  _geiIsFreeForm=true;_geiIsTM=false;
  openGenericEstimate(c,bidId,null);
}

function openGenericEstimate(c,bidId,_tradePick){
  _geiClientId=c?.id||null;
  _geiEditBidId=bidId||null;
  _geiLines=[];_byoItems=[];_geiIsCommercial=false;_geiEmergency=false;_panelSched=null;_geiStep=1;_geiNewWork=false;
  const _wasTM=_geiIsTM,_wasFF=_geiIsFreeForm;
  _geiIsTM=false;_geiIsFreeForm=false;
  if(_wasTM){_geiIsTM=true;}else{_tmCrewCount=1;_tmRatePerMan=0;_tmEstHours=0;_tmBillingCycle='weekly';_tmMatMarkup=0;_tmCapAction='Stop & get re-approval';}
  if(_wasFF)_geiIsFreeForm=true;
  document.getElementById('gei-cart-bar')?.remove();
  if(_tradePick)_activeTrade=_tradePick;
  _geiTrade=_tradePick||getActiveTrade();
  const trade=_geiTrade;
  const m=TRADE_META[trade]||{icon:'🔧',label:trade.charAt(0).toUpperCase()+trade.slice(1)};
  const titleEl=document.getElementById('gei-trade-title');
  if(titleEl)titleEl.textContent=m.icon+' '+m.label+' Proposal';
  const eyebrowEl=document.getElementById('gei-tbar-eyebrow');
  if(eyebrowEl)eyebrowEl.textContent=m.label+' proposal';
  const sf=(id,val)=>{const el=document.getElementById(id);if(el)el.value=val||'';};
  sf('gei-client',c?.name||'');
  sf('gei-addr',c?.addr||'');
  const DESC_PH={electrical:'e.g. Panel upgrade, add EV charger in garage',plumbing:'e.g. Replace water heater, install shutoff valves',hvac:'e.g. Replace AC unit, charge refrigerant',roofing:'e.g. Full shingle replacement, fix ridge flashing',landscaping:'e.g. Weekly mowing, spring cleanup, new mulch',general:'e.g. Drywall repair, power washing, handyman'};
  sf('gei-desc','');sf('gei-notes','');sf('gei-tax-pct','0');sf('gei-duration','');
  const descEl=document.getElementById('gei-desc');
  if(descEl)descEl.placeholder=DESC_PH[_geiTrade]||'Describe the job';
  const nwEl=document.getElementById('gei-new-work');
  if(nwEl)nwEl.checked=false;
  document.getElementById('gei-date').value=todayKey();
  if(bidId){
    const b=bids.find(x=>x.id===bidId);
    if(b){
      sf('gei-desc',b.type||'');sf('gei-notes',b.notes||'');
      if(b.geiLines&&b.geiLines.length)_geiLines=JSON.parse(JSON.stringify(b.geiLines));
      if(b.geiTaxPct)sf('gei-tax-pct',b.geiTaxPct);
      if(b.geiDuration)sf('gei-duration',b.geiDuration);
      if(b.geiNewWork){_geiNewWork=true;if(nwEl)nwEl.checked=true;}
      if(b.panelSched)_panelSched=JSON.parse(JSON.stringify(b.panelSched));
      if(b.isTM){
        _geiIsTM=true;
        _tmCrewCount=b.tmCrewCount||1;_tmRatePerMan=b.tmRatePerMan||0;
        _tmEstHours=b.tmEstHours||0;_tmBillingCycle=b.tmBillingCycle||'weekly';
        _tmMatMarkup=b.tmMatMarkup||b.geiTaxPct||0;
        _tmCapAction=b.tmCapAction||'Stop & get re-approval';
      }
      if(b.isFreeForm)_geiIsFreeForm=true;
    }
  }
  if(!_geiEditBidId){
    // Reuse any existing GEI draft or unsent bid for this client+trade (prevents duplicates).
    // Two-pass: exact trade match first; then heal old bids with undefined trade_type.
    const _tMatch=b=>b.client_id===_geiClientId&&!b.signingToken&&b.geiLines!==undefined&&(b.status==='Draft'||b.status==='Pending');
    let _existingGei=bids.find(b=>_tMatch(b)&&b.trade_type===_geiTrade);
    if(!_existingGei){
      // Fallback: pick up old bids that predate the trade_type field
      _existingGei=bids.find(b=>_tMatch(b)&&(b.trade_type===undefined||b.trade_type===null||b.trade_type===''));
    }
    if(_existingGei){
      _existingGei.trade_type=_geiTrade; // heal legacy bids
      _geiEditBidId=_existingGei.id;
      const _b=_existingGei;
      sf('gei-desc',_b.type||'');sf('gei-notes',_b.notes||'');
      if(_b.geiLines&&_b.geiLines.length)_geiLines=JSON.parse(JSON.stringify(_b.geiLines));
      if(_b.geiTaxPct)sf('gei-tax-pct',_b.geiTaxPct);
      if(_b.geiDuration)sf('gei-duration',_b.geiDuration);
      if(_b.geiNewWork){_geiNewWork=true;if(nwEl)nwEl.checked=true;}
      if(_b.panelSched)_panelSched=JSON.parse(JSON.stringify(_b.panelSched));
      if(_b.isFreeForm)_geiIsFreeForm=true;
      if(_b.isTM){_geiIsTM=true;_tmCrewCount=_b.tmCrewCount||1;_tmRatePerMan=_b.tmRatePerMan||0;_tmEstHours=_b.tmEstHours||0;_tmBillingCycle=_b.tmBillingCycle||'weekly';_tmMatMarkup=_b.tmMatMarkup||_b.geiTaxPct||20;_tmCapAction=_b.tmCapAction||'Stop & get re-approval';}
      // Purge other empty duplicates for this client+trade now that we have the right one
      bids=bids.filter(b=>b.id===_existingGei.id||!(b.client_id===_geiClientId&&!b.signingToken&&b.geiLines!==undefined&&!b.amount&&!(b.geiLines||[]).length&&(b.status==='Draft'||b.status==='Pending')&&(b.trade_type===_geiTrade||!b.trade_type)));
      saveAll();
    }
  }
  if(!_geiEditBidId){
    const draftBid={id:_newBidId(),client_id:_geiClientId,client_name:c?.name||'',bid_date:todayKey(),amount:0,deposit:0,type:(TRADE_META[_geiTrade]?.label||'Trade')+' estimate',notes:'',status:'Draft',draft:true,trade_type:_geiTrade,geiLines:[],geiTaxPct:0};
    bids.unshift(draftBid);_geiEditBidId=draftBid.id;saveAll();
  }
  goPg('pg-est-generic');
  goGeiStep(1);
}

function goGeiStep(n){
  // T&M mode — single-page layout
  if(_geiIsTM){
    _geiStep=n;
    _tmShowPage();
    window.scrollTo({top:0,behavior:'instant'});
    return;
  }
  // BYO / free-form mode — single-page layout
  if(_geiIsFreeForm){
    _geiStep=n;
    _byoShowPage();
    window.scrollTo({top:0,behavior:'instant'});
    return;
  }
  // If going to Step 2 and no bundles are set, show the onboarding picker first (skip for free-form)
  if(n===2&&(!S.myBundles||!S.myBundles.length)&&!_geiIsFreeForm){
    showGeiOnboarding();return;
  }
  _geiStep=n;
  [1,2,3].forEach(i=>{const el=document.getElementById('gei-s'+i);if(el)el.style.display=(i===n)?'':'none';});
  window.scrollTo({top:0,behavior:'instant'});
  _geiRenderStepBar();
  _geiSyncScopeButtons();
  const show=v=>id=>{const d=document.getElementById(id);if(d)d.style.display=v;};
  // Always hide all mode chips/sections first
  ['gei-tm-chip','gei-tm-reason-wrap','gei-tm-crew','gei-tm-terms','gei-ff-chip'].forEach(id=>{
    const d=document.getElementById(id);if(d)d.style.display='none';
  });
  const svcWrap=document.getElementById('gei-svc-wrap');
  if(_geiIsTM){
    show('block')('gei-tm-chip');show('block')('gei-tm-reason-wrap');
    if(n===2)show('block')('gei-tm-crew');
    if(n===3){show('block')('gei-tm-terms');_tmSyncCycleButtons();_tmCalcDeposit();_tmCalcNte();}
    const titleEl=document.getElementById('gei-trade-title');
    if(titleEl)titleEl.textContent='⏱️ Time & Materials';
    const eyebrowEl=document.getElementById('gei-tbar-eyebrow');
    if(eyebrowEl)eyebrowEl.textContent='T&M estimate';
    if(svcWrap)svcWrap.style.display='none';
    if(n===2){
      const cd=document.getElementById('tm-crew-display');if(cd)cd.textContent=_tmCrewCount;
      const ri=document.getElementById('tm-rate');if(ri&&_tmRatePerMan)ri.value=_tmRatePerMan;
      const hi=document.getElementById('tm-hours');if(hi&&_tmEstHours)hi.value=_tmEstHours;
      if(_tmRatePerMan||_tmEstHours)_tmRecalc();
    }
    if(n===1){
      const b=bids.find(x=>x.id===_geiEditBidId);
      if(b?.tmReason){const rs=document.getElementById('tm-reason');if(rs)rs.value=b.tmReason;}
      if(b?.tmReasonNote){const rn=document.getElementById('tm-reason-note');if(rn)rn.value=b.tmReasonNote;}
    }
  } else if(_geiIsFreeForm){
    show('block')('gei-ff-chip');
    if(svcWrap)svcWrap.style.display='none';
    const titleEl=document.getElementById('gei-trade-title');
    if(titleEl)titleEl.textContent='✏️ Build Your Own';
    const eyebrowEl=document.getElementById('gei-tbar-eyebrow');
    if(eyebrowEl)eyebrowEl.textContent='Free-form estimate';
  } else {
    if(svcWrap)svcWrap.style.display='flex';
  }
  const bar=document.getElementById('gei-cart-bar');
  if(bar)bar.style.display=(n===2&&_geiLines.length)?'flex':'none';
  if(n===2){
    if(_geiIsFreeForm)_geiRenderFreeFormBuilder();
    else if(!_geiIsTM)_geiRenderTemplates();
    _geiRenderCartBar();
  }
  if(n===3){renderGeiLines();calcGeiTotal();_panelRenderSection();}
}

// ── T&M helpers ──────────────────────────────────────────────────────────────
function _tmAdj(delta){
  _tmCrewCount=Math.max(1,_tmCrewCount+delta);
  const d=document.getElementById('tm-crew-display');if(d)d.textContent=_tmCrewCount;
  _tmRecalc();
}
function _tmRecalc(){
  _tmCrewCount=parseInt(document.getElementById('tm-crew-display')?.textContent)||_tmCrewCount||1;
  _tmRatePerMan=parseFloat(document.getElementById('tm-rate')?.value)||0;
  _tmEstHours=parseFloat(document.getElementById('tm-hours')?.value)||0;
  const labor=_tmCrewCount*_tmRatePerMan*_tmEstHours;
  const el=document.getElementById('tm-labor-est');
  if(el)el.textContent=labor?'$'+labor.toLocaleString('en-US',{maximumFractionDigits:0}):'—';
  const fml=document.getElementById('tm-crew-formula');
  if(fml)fml.textContent=(_tmRatePerMan&&_tmEstHours)?_tmCrewCount+' worker'+(_tmCrewCount>1?'s':'')+' × $'+_tmRatePerMan+'/hr × '+_tmEstHours+'hrs':'Enter rate & hours above';
  // Upsert labor line
  const idx=_geiLines.findIndex(l=>l._tmLabor);
  const desc='Labor — '+_tmCrewCount+' worker'+(_tmCrewCount>1?'s':'')+' @ $'+_tmRatePerMan+'/hr';
  const line={desc,qty:_tmEstHours,unit:'hr',rate:Math.round(_tmRatePerMan*_tmCrewCount),_tmLabor:true,total:Math.round(_tmRatePerMan*_tmCrewCount*_tmEstHours)};
  if(idx>=0){if(labor>0)_geiLines[idx]=line;else _geiLines.splice(idx,1);}
  else if(labor>0)_geiLines.unshift(line);
  renderGeiLines();calcGeiTotal();
}
function _tmCalcDeposit(){
  const {sub}=calcGeiTotal();
  const pct=parseFloat(document.getElementById('tm-dep-pct')?.value)||20;
  const amt=Math.round(sub*pct/100);
  const el=document.getElementById('tm-dep-amt');
  if(el)el.textContent=amt?'$'+amt.toLocaleString('en-US',{maximumFractionDigits:0}):'—';
  // Also update NTE suggestion if not manually set
  _tmCalcNte();
}
function _tmCalcNte(){
  const on=document.getElementById('tm-nte-on')?.checked;
  const wrap=document.getElementById('tm-nte-wrap');
  if(wrap)wrap.style.display=on?'block':'none';
  if(!on)return;
  const cap=document.getElementById('tm-nte-cap');
  if(cap&&(!cap.value||parseFloat(cap.value)===0)){
    const{sub}=calcGeiTotal();
    if(sub>0)cap.value=Math.round(sub*1.15/500)*500; // round to nearest $500
  }
}
function _tmSetCycle(v){
  _tmBillingCycle=v;
  _tmSyncCycleButtons();
}
function _tmSyncCycleButtons(){
  ['weekly','biweekly','milestone','completion'].forEach(c=>{
    const btn=document.getElementById('tmc-'+c);
    if(!btn)return;
    const active=_tmBillingCycle===c;
    btn.style.background=active?'var(--blue)':'var(--bg2)';
    btn.style.color=active?'#fff':'var(--text2)';
    btn.style.border=active?'1.5px solid var(--blue)':'1.5px solid var(--border2)';
  });
}

// ── T&M single-page layout (matches design spec EstimateTM.jsx) ──────────────
function _tmShowPage(){
  // Hide legacy wizard UI inside pg-est-generic
  ['gei-old-tbar','gei-step-bar','gei-s1','gei-s2','gei-s3'].forEach(id=>{
    const el=document.getElementById(id);if(el)el.style.display='none';
  });
  const p=document.getElementById('gei-tm-page');if(p)p.style.display='';
  // Trade branding in title
  const _tm=TRADE_META[_geiTrade||getActiveTrade()]||{icon:'🔧',label:'Trade'};
  const titleEl=document.getElementById('tm-tbar-title');if(titleEl)titleEl.textContent=_tm.icon+' '+_tm.label+' · Time & Materials';
  // Sub-header: client name · address
  const c=getClientById(_geiClientId);
  const sub=document.getElementById('tm-page-sub');
  if(sub){
    const parts=[];
    if(c?.name)parts.push(c.name);
    if(c?.addr)parts.push(c.addr.split(',')[0]);
    sub.textContent=parts.join(' · ')||'New estimate';
  }
  // Populate inputs from current state
  const setV=(id,v)=>{const e=document.getElementById(id);if(e)e.value=(v===0||v)?v:''};
  setV('tm-i-rate',_tmRatePerMan||'');
  setV('tm-i-hours',_tmEstHours||'');
  const crewDisp=document.getElementById('tm-i-crew-count');
  if(crewDisp)crewDisp.textContent=Math.max(1,_tmCrewCount||1);
  setV('tm-i-markup',_tmMatMarkup||'');
  const b=bids.find(x=>x.id===_geiEditBidId);
  if(b?.tmNteCap)setV('tm-i-nte',b.tmNteCap);
  if(b?.tmCapAction){setV('tm-i-cap-action',b.tmCapAction);_tmCapAction=b.tmCapAction;}
  _tmRenderMatList();
  _tmInputChange();
  _tmSyncCadence();
}
function _tmHidePage(){
  const p=document.getElementById('gei-tm-page');if(p)p.style.display='none';
  ['gei-old-tbar','gei-step-bar'].forEach(id=>{
    const el=document.getElementById(id);if(el)el.style.display='';
  });
}

// ── Build Your Own single-page layout ────────────────────────────────────────
let _byoItems=[];
const _BYO_DEFAULT_SECTIONS=['Interior','Add-ons','Exterior'];
function _byoShowPage(){
  _tmHidePage(); // must run first — _tmHidePage re-shows gei-old-tbar, then we hide it below
  ['gei-old-tbar','gei-step-bar','gei-s1','gei-s2','gei-s3'].forEach(id=>{
    const el=document.getElementById(id);if(el)el.style.display='none';
  });
  const p=document.getElementById('gei-byo-page');if(p)p.style.display='';
  // Trade branding in title
  const _bm=TRADE_META[_geiTrade||getActiveTrade()]||{icon:'🔧',label:'Trade'};
  const byoTitle=document.getElementById('byo-tbar-title');if(byoTitle)byoTitle.textContent=_bm.icon+' '+_bm.label+' · Build Your Own';
  const c=getClientById(_geiClientId);
  const sub=document.getElementById('byo-page-sub');
  if(sub){const parts=[];if(c?.name)parts.push(c.name);if(c?.addr)parts.push(c.addr.split(',')[0]);sub.textContent=parts.join(' · ')||'New estimate';}
  // Load items from saved bid, otherwise start blank
  const b=bids.find(x=>x.id===_geiEditBidId);
  if(b?.byoItems&&b.byoItems.length){_byoItems=b.byoItems.map(x=>({...x}));}
  else{_byoItems=[];}
  _byoRenderSections();
  _byoUpdateRail();
}
function _byoHidePage(){
  const p=document.getElementById('gei-byo-page');if(p)p.style.display='none';
  ['gei-old-tbar','gei-step-bar'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='';});
}
function _byoRenderSections(){
  const wrap=document.getElementById('byo-sections');if(!wrap)return;
  const sections=[..._BYO_DEFAULT_SECTIONS,...new Set(_byoItems.map(x=>x.section).filter(s=>!_BYO_DEFAULT_SECTIONS.includes(s)))];
  wrap.innerHTML=sections.map(sec=>{
    const rows=_byoItems.filter(it=>it.section===sec);
    const rowHtml=rows.length?rows.map(it=>{
      const idx=_byoItems.indexOf(it);
      return '<div class="byo-row'+(it.on?' on':'')+'" onclick="_byoToggle('+idx+')">'+
        '<div class="byo-check'+(it.on?' on':'')+'">'+( it.on?'✓':''  )+'</div>'+
        '<div class="byo-body">'+
          '<div class="byo-label">'+escHtml(it.label)+'</div>'+
          (it.notes?'<div class="byo-meta" style="font-size:11px;color:var(--text-3)">'+escHtml(it.notes)+'</div>':'')+
        '</div>'+
        '<div class="byo-price">$'+it.price.toLocaleString()+'</div>'+
        '<button class="tm-mat-del" onclick="event.stopPropagation();_byoDelItem('+idx+')" title="Remove">×</button>'+
      '</div>';
    }).join(''):
    '<div style="padding:14px 16px;font-size:12px;color:var(--text-3);font-style:italic">No items yet — tap + Add item</div>';
    return '<div class="card card-pad-0" style="margin-bottom:12px">'+
      '<div class="card-hd"><div class="card-hd-title">'+escHtml(sec)+'</div>'+
      '<button class="btn btn-sm" onclick="_byoAddItem(\''+escHtml(sec)+'\')">+ Add item</button></div>'+
      '<div>'+rowHtml+'</div>'+
    '</div>';
  }).join('');
}
function _byoToggle(idx){
  if(_byoItems[idx]&&!_byoItems[idx].required){_byoItems[idx].on=!_byoItems[idx].on;_byoRenderSections();_byoUpdateRail();}
}
function _byoDelItem(idx){
  if(_byoItems[idx]&&!_byoItems[idx].required){_byoItems.splice(idx,1);_byoRenderSections();_byoUpdateRail();}
}
function _byoUpdateRail(){
  const selected=_byoItems.filter(it=>it.on);
  const total=selected.reduce((s,it)=>s+it.price,0);
  const depPct=(parseFloat(document.getElementById('byo-deposit-pct')?.value)||30)/100;
  const deposit=Math.round(total*depPct);
  const setT=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
  setT('byo-rail-total','$'+total.toLocaleString());
  setT('byo-rail-meta',selected.length+' of '+_byoItems.length+' items');
  setT('byo-rail-sub','$'+total.toLocaleString());
  setT('byo-rail-deposit','$'+deposit.toLocaleString());
  setT('byo-rail-balance','$'+(total-deposit).toLocaleString());
  _geiLines=selected.map(it=>({desc:it.label,qty:1,unit:'ea',rate:it.price,total:it.price,_byoSection:it.section}));
}
function _byoAddItem(sec){
  document.getElementById('_byo-add-modal')?.remove();
  const ov=document.createElement('div');ov.id='_byo-add-modal';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box';
  ov.innerHTML='<div style="background:var(--bg);border-radius:14px;width:100%;max-width:480px;padding:20px 16px 24px;max-height:90vh;overflow-y:auto">'+
    '<div style="font-weight:800;font-size:16px;margin-bottom:16px">Add to '+escHtml(sec)+'</div>'+
    '<div class="f" style="margin-bottom:10px"><label>What is it?</label><input type="text" id="_bya-label" placeholder="e.g. Bedroom 3 — walls only"></div>'+
    '<div class="f" style="margin-bottom:10px"><label>Price ($)</label><div class="input-prefix"><span>$</span><input type="number" id="_bya-price" placeholder="0" min="0" step="50"></div></div>'+
    '<div class="f" style="margin-bottom:16px"><label>Notes <span style="font-weight:400;color:var(--text-3)">(optional)</span></label><input type="text" id="_bya-notes" placeholder="e.g. Two coats, ceilings included"></div>'+
    '<div style="display:flex;gap:10px">'+
      '<button onclick="document.getElementById(\'_byo-add-modal\')?.remove()" class="btn" style="flex:1">Cancel</button>'+
      '<button onclick="_byaConfirm(\''+escHtml(sec)+'\')" class="btn btn-p" style="flex:2">Add item</button>'+
    '</div></div>';
  document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  setTimeout(()=>document.getElementById('_bya-label')?.focus(),50);
}
function _byaConfirm(sec){
  const label=(document.getElementById('_bya-label')?.value||'').trim();
  const price=parseFloat(document.getElementById('_bya-price')?.value)||0;
  const notes=(document.getElementById('_bya-notes')?.value||'').trim();
  if(!label)return;
  const nextId=(_byoItems.reduce((m,x)=>Math.max(m,x.id),0))+1;
  _byoItems.push({id:nextId,section:sec,label,price,notes,on:true});
  document.getElementById('_byo-add-modal')?.remove();
  _byoRenderSections();_byoUpdateRail();
}
function _byoPreviewClient(){showToast('Preview coming soon — save first to get a link','👁');}
function _tmCrewStep(delta){
  _tmCrewCount=Math.max(1,Math.min(20,(_tmCrewCount||1)+delta));
  const d=document.getElementById('tm-i-crew-count');if(d)d.textContent=_tmCrewCount;
  const lbl=document.getElementById('tm-i-crew-label');
  if(lbl)lbl.textContent=_tmCrewCount===1?'solo':_tmCrewCount===2?'me + helper':'crew';
  _tmInputChange();
}
function _tmInputChange(){
  _tmRatePerMan=parseFloat(document.getElementById('tm-i-rate')?.value)||0;
  // Crew count driven by stepper; read stepper display, not a select
  const crewDisp=document.getElementById('tm-i-crew-count');
  if(crewDisp)_tmCrewCount=parseInt(crewDisp.textContent)||_tmCrewCount||1;
  _tmEstHours=parseFloat(document.getElementById('tm-i-hours')?.value)||0;
  _tmMatMarkup=parseFloat(document.getElementById('tm-i-markup')?.value)||0;
  const labor=_tmCrewCount*_tmRatePerMan*_tmEstHours;
  // Upsert labor line in _geiLines (same shape the rest of the app expects)
  const idx=_geiLines.findIndex(l=>l._tmLabor);
  const desc='Labor — '+_tmCrewCount+' worker'+(_tmCrewCount>1?'s':'')+' @ $'+_tmRatePerMan+'/hr';
  const line={desc,qty:_tmEstHours,unit:'hr',rate:Math.round(_tmRatePerMan*_tmCrewCount),_tmLabor:true,total:Math.round(_tmRatePerMan*_tmCrewCount*_tmEstHours)};
  if(idx>=0){if(labor>0)_geiLines[idx]=line;else _geiLines.splice(idx,1);}
  else if(labor>0)_geiLines.unshift(line);
  // Stat tiles
  const dayRate=_tmCrewCount*_tmRatePerMan*8;
  const days=_tmEstHours>0?Math.ceil(_tmEstHours/8):0;
  const setT=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v};
  setT('tm-stat-day','$'+dayRate.toLocaleString());
  setT('tm-stat-day-s',_tmRatePerMan&&_tmCrewCount?_tmCrewCount+'-person crew · 8hr day':'enter rate & crew');
  setT('tm-stat-labor','$'+labor.toLocaleString());
  setT('tm-stat-labor-s',(_tmRatePerMan&&_tmEstHours)?_tmEstHours+'hr × '+_tmCrewCount+' × $'+_tmRatePerMan:'—');
  setT('tm-stat-days',days);
  // Materials subtotal — markup baked in, invisible to client
  const matRaw=_geiLines.filter(l=>!l._tmLabor).reduce((s,l)=>s+(l.total||(l.qty||0)*(l.rate||0)),0);
  const markupMult=_tmMatMarkup>0?(1+_tmMatMarkup/100):1;
  const markedUpMat=Math.round(matRaw*markupMult);
  const total=labor+markedUpMat;
  // Rail breakdown
  setT('tm-rail-total','$'+total.toLocaleString());
  setT('tm-rail-labor','$'+labor.toLocaleString());
  setT('tm-rail-mat','$'+markedUpMat.toLocaleString());
  let nte=parseFloat(document.getElementById('tm-i-nte')?.value)||0;
  const nteInp=document.getElementById('tm-i-nte');
  if(nteInp&&nte>0&&nte<total){
    nteInp.style.borderColor='var(--red)';
    nteInp.title='NTE cap cannot be less than the estimated total ($'+total.toLocaleString()+')';
  } else if(nteInp){nteInp.style.borderColor='';nteInp.title='';}
  const nteRow=document.getElementById('tm-rail-nte-row');
  if(nteRow)nteRow.style.display=nte>0?'flex':'none';
  if(nte>0)setT('tm-rail-nte-amt','$'+nte.toLocaleString());
  // Mirror values to legacy DOM ids so saveGenericEstimate/sendGenericProposal pick them up
  const setV=(id,v)=>{const e=document.getElementById(id);if(e)e.value=v;};
  setV('tm-rate',_tmRatePerMan);
  setV('tm-hours',_tmEstHours);
  const cd=document.getElementById('tm-crew-display');if(cd)cd.textContent=_tmCrewCount;
  setV('tm-nte-cap',nte||'');
  setV('tm-dep-pct',20);
  const nteOn=document.getElementById('tm-nte-on');if(nteOn)nteOn.checked=nte>0;
  setV('gei-tax-pct',_tmMatMarkup); // materials markup folds into the existing tax/markup field
  // Keep the legacy line items + totals in sync (used by save/proposal)
  if(typeof renderGeiLines==='function')renderGeiLines();
  if(typeof calcGeiTotal==='function')calcGeiTotal();
}
function _tmRenderMatList(){
  const el=document.getElementById('tm-mat-list');if(!el)return;
  const mats=_geiLines.map((l,i)=>({l,i})).filter(x=>!x.l._tmLabor);
  if(!mats.length){
    el.innerHTML='<div class="tm-mat-empty">No material categories yet — tap "+ Add category" to start.</div>';
    return;
  }
  const mm=_tmMatMarkup>0?(1+_tmMatMarkup/100):1;
  el.innerHTML=mats.map(({l,i})=>{
    const rawTotal=l.total||((l.qty||0)*(l.rate||0));
    const dispTotal=Math.round(rawTotal*mm);
    return '<div class="tm-mat-row">'+
      '<div style="flex:1;cursor:pointer;min-width:0" onclick="_tmEditMatCat('+i+')">'+
        '<div class="tm-mat-cat">'+escHtml(l.desc||'Untitled')+'</div>'+
        (l.notes?'<div class="tm-mat-notes">'+escHtml(l.notes)+'</div>':'')+
      '</div>'+
      '<div style="display:flex;align-items:flex-start;gap:0">'+
        '<div class="tm-mat-est">$'+(dispTotal||0).toLocaleString()+'</div>'+
        '<button class="tm-mat-del" onclick="_tmDelMatCat('+i+')" title="Remove category">×</button>'+
      '</div>'+
    '</div>';
  }).join('');
}
function _tmAddMatCat(){ _tmMatCatModal(-1); }
function _tmEditMatCat(idx){ _tmMatCatModal(idx); }
function _tmMatCatModal(idx){
  const isEdit=idx>=0;
  const l=isEdit?_geiLines[idx]:null;
  if(isEdit&&(!l||l._tmLabor))return;
  const cur=isEdit?(l.total||((l.qty||0)*(l.rate||0))):0;
  document.getElementById('_tm-mat-modal')?.remove();
  const ov=document.createElement('div');
  ov.id='_tm-mat-modal';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box';
  ov.innerHTML='<div style="background:var(--bg);border-radius:14px;width:100%;max-width:480px;padding:20px 16px 24px;max-height:90vh;overflow-y:auto">'+
    '<div style="font-weight:800;font-size:16px;color:var(--text);margin-bottom:16px">'+(isEdit?'Edit category':'Add material category')+'</div>'+
    '<div class="f" style="margin-bottom:10px"><label>Category name</label><input type="text" id="tcm-name" placeholder="e.g. Paint &amp; primer" value="'+escHtml(l?.desc||'')+'" style="font-size:15px"></div>'+
    '<div class="f" style="margin-bottom:10px"><label>Notes <span style="font-weight:400;color:var(--text3)">(optional)</span></label><input type="text" id="tcm-notes" placeholder="Brand, product type, etc." value="'+escHtml(l?.notes||'')+'"></div>'+
    '<div class="f" style="margin-bottom:16px"><label>Estimated cost ($)</label><div class="input-prefix"><span>$</span><input type="number" id="tcm-cost" min="0" step="10" placeholder="0" value="'+(cur||'')+'" inputmode="decimal"></div></div>'+
    '<div style="display:flex;gap:10px">'+
      '<button onclick="document.getElementById(\'_tm-mat-modal\')?.remove()" class="btn" style="flex:1">Cancel</button>'+
      '<button onclick="_tmMatCatSave('+idx+')" class="btn btn-p" style="flex:2">'+(isEdit?'Save changes':'Add category')+'</button>'+
    '</div>'+
  '</div>';
  document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  setTimeout(()=>document.getElementById('tcm-name')?.focus(),50);
}
function _tmMatCatSave(idx){
  const name=(document.getElementById('tcm-name')?.value||'').trim();
  if(!name){document.getElementById('tcm-name')?.focus();return;}
  const notes=(document.getElementById('tcm-notes')?.value||'').trim();
  const cost=parseFloat(document.getElementById('tcm-cost')?.value)||0;
  if(idx>=0){
    const l=_geiLines[idx];if(!l)return;
    l.desc=name;l.notes=notes;l.qty=1;l.unit='lot';l.rate=cost;l.total=cost;
  } else {
    _geiLines.push({desc:name,notes,qty:1,unit:'lot',rate:cost,total:cost});
  }
  document.getElementById('_tm-mat-modal')?.remove();
  _tmRenderMatList();_tmInputChange();
}
function _tmDelMatCat(idx){
  const l=_geiLines[idx];if(!l||l._tmLabor)return;
  if(!confirm('Remove "'+(l.desc||'this category')+'"?'))return;
  _geiLines.splice(idx,1);
  _tmRenderMatList();_tmInputChange();
}
function _tmCadence(v){_tmBillingCycle=v;_tmSyncCadence();}
function _tmSyncCadence(){
  ['weekly','milestone','completion'].forEach(c=>{
    const el=document.getElementById('tm-cad-'+c);if(!el)return;
    if(_tmBillingCycle===c)el.classList.add('on');else el.classList.remove('on');
  });
}
function _tmPreviewClient(){
  // Save draft first so the latest data is persisted, then open the existing proposal preview flow
  saveGenericEstimate(true);
  // Fall back to sending if no dedicated preview exists yet
  showToast('Preview as client — sending proposal flow opens for review','👁');
  if(typeof sendGenericProposal==='function')sendGenericProposal();
}

function _geiBack(){
  if(_geiStep>1)goGeiStep(_geiStep-1);
  else{document.getElementById('gei-cart-bar')?.remove();goPg('pg-clients');}
}

// ── Free-form (Build Your Own) builder ───────────────────────────────────────
function _geiRenderFreeFormBuilder(){
  const el=document.getElementById('gei-templates');if(!el)return;
  const curTrade=_geiTrade||'general';
  const allHist=(S.lineHistory||[]).slice().sort((a,b)=>(b.count||0)-(a.count||0));
  const hist=allHist.filter(h=>!h.trade||h.trade===curTrade||h.trade==='general').slice(0,6);
  const histHtml=hist.length?
    '<div style="margin-bottom:14px">'+
      '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:8px">Recently used — '+curTrade.charAt(0).toUpperCase()+curTrade.slice(1)+'</div>'+
      '<div style="display:flex;flex-wrap:wrap;gap:6px">'+
      hist.map((h,i)=>{const realIdx=allHist.findIndex(x=>x.desc===h.desc&&x.trade===h.trade);return'<button onclick="_geiHistoryChipAdd('+realIdx+')" style="padding:6px 12px;border-radius:20px;border:1.5px solid var(--border2);background:var(--bg2);font-size:12px;cursor:pointer;font-family:inherit;color:var(--text2);display:inline-flex;align-items:center;gap:5px">'+escHtml(h.desc)+'<span style="color:var(--blue);font-weight:700">$'+(h.rate||0).toLocaleString('en-US',{maximumFractionDigits:0})+'</span></button>';}).join('')+
      '</div></div>':'';
  const hasLines=_geiLines.length>0;
  el.innerHTML=
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">'+
      '<div style="font-size:13px;font-weight:700;color:var(--text)">Line items</div>'+
      '<button onclick="_geiAddFreeFormLine()" class="btn btn-p btn-sm" style="padding:6px 14px;font-size:12px">+ Add line</button>'+
    '</div>'+
    histHtml+
    '<div id="gei-ff-lines"></div>'+
    (!hasLines?'<div style="text-align:center;padding:24px 0;font-size:13px;color:var(--text3)">Tap <strong>+ Add line</strong> to start building your estimate.</div>':'');
  _geiRenderFreeFormLines();
}
function _geiRenderFreeFormLines(){
  const el=document.getElementById('gei-ff-lines');if(!el)return;
  if(!_geiLines.length){el.innerHTML='';return;}
  el.innerHTML=_geiLines.map((l,i)=>{
    const total=(l.qty||1)*(l.rate||0);
    const totalFmt='$'+total.toLocaleString('en-US',{maximumFractionDigits:0});
    return'<div style="background:var(--bg2);border-radius:var(--r);border:1px solid var(--border2);padding:11px 13px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:flex-start;gap:10px">'+
      '<div style="flex:1;min-width:0">'+
        '<div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:2px">'+escHtml(l.desc||'—')+'</div>'+
        '<div style="font-size:11px;color:var(--text3)">'+(l.qty||1)+' '+(l.unit||'ea')+' @ $'+(l.rate||0).toLocaleString('en-US',{maximumFractionDigits:0})+'</div>'+
      '</div>'+
      '<div style="display:flex;align-items:center;gap:6px;flex-shrink:0">'+
        '<div style="font-size:15px;font-weight:800;color:var(--blue)">'+totalFmt+'</div>'+
        '<button onclick="_geiEditFreeFormLine('+i+')" style="background:none;border:none;cursor:pointer;color:var(--blue);font-size:11px;font-weight:700;font-family:inherit;padding:3px 6px;border-radius:4px;border:1px solid var(--blue)">Edit</button>'+
        '<button onclick="_geiLines.splice('+i+',1);_geiRenderFreeFormBuilder();_geiRenderCartBar();" style="background:none;border:none;cursor:pointer;color:var(--text3);font-size:20px;padding:0;line-height:1">×</button>'+
      '</div>'+
    '</div>';
  }).join('');
}
function _geiHistoryChipAdd(i){
  const hist=(S.lineHistory||[]).slice().sort((a,b)=>(b.count||0)-(a.count||0));
  const h=hist[i];if(!h)return;
  _geiLines.push({desc:h.desc,qty:h.qty||1,unit:h.unit||'ea',rate:h.rate||0,total:(h.qty||1)*(h.rate||0)});
  _geiRenderFreeFormBuilder();_geiRenderCartBar();
}
function _geiAddFreeFormLine(prefill){
  const d=prefill||{};
  const isEdit=d._edit!==undefined;
  const ov=document.createElement('div');
  ov.id='_ff-add-ov';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box';
  ov.innerHTML=
    '<div style="background:var(--bg);border-radius:var(--rl);padding:20px 18px 24px;width:100%;max-width:480px;box-sizing:border-box;max-height:90vh;overflow-y:auto">'+
      '<div style="font-size:15px;font-weight:800;color:var(--text);margin-bottom:14px">'+(isEdit?'Edit line':'Add line item')+'</div>'+
      '<div class="f" style="margin-bottom:10px"><label>Description</label>'+
        '<input id="_ffa-desc" type="text" value="'+escHtml(d.desc||'')+'" placeholder="e.g. Interior paint — 2 coats, Labor, Material" autocomplete="off" style="font-size:14px">'+
      '</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px">'+
        '<div class="f"><label>Qty</label><input id="_ffa-qty" type="number" value="'+(d.qty||1)+'" min="0.01" step="any" oninput="_ffaLiveTotal()" style="font-size:14px"></div>'+
        '<div class="f"><label>Unit</label><input id="_ffa-unit" type="text" value="'+escHtml(d.unit||'ea')+'" placeholder="ea" style="font-size:14px"></div>'+
        '<div class="f"><label>Price per unit ($)</label><input id="_ffa-rate" type="number" value="'+(d.rate||'')+'" min="0" step="any" placeholder="0" oninput="_ffaLiveTotal()" style="font-size:14px"></div>'+
      '</div>'+
      '<div style="display:flex;justify-content:space-between;align-items:center;background:var(--bg2);padding:9px 12px;border-radius:var(--r);margin-bottom:14px">'+
        '<span style="font-size:12px;color:var(--text2)">Line total</span>'+
        '<span id="_ffa-total-disp" style="font-size:18px;font-weight:800;color:var(--blue)">'+(d.qty&&d.rate?'$'+((d.qty||1)*(d.rate||0)).toLocaleString('en-US',{maximumFractionDigits:0}):'—')+'</span>'+
      '</div>'+
      '<button class="btn btn-p" onclick="_geiConfirmFreeFormAdd('+(isEdit?d._edit:-1)+')" style="margin-bottom:8px">'+(isEdit?'Update line':'Add to estimate')+'</button>'+
      '<button class="btn" onclick="document.getElementById(\'_ff-add-ov\')?.remove()" style="color:var(--text2);font-size:13px">Cancel</button>'+
    '</div>';
  document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  setTimeout(()=>document.getElementById('_ffa-desc')?.focus(),100);
}
function _ffaLiveTotal(){
  const qty=parseFloat(document.getElementById('_ffa-qty')?.value)||0;
  const rate=parseFloat(document.getElementById('_ffa-rate')?.value)||0;
  const el=document.getElementById('_ffa-total-disp');
  if(el)el.textContent=(qty&&rate)?'$'+(qty*rate).toLocaleString('en-US',{maximumFractionDigits:0}):'—';
}
function _geiConfirmFreeFormAdd(editIdx){
  const desc=(document.getElementById('_ffa-desc')?.value||'').trim();
  if(!desc){const inp=document.getElementById('_ffa-desc');if(inp){inp.style.borderColor='#dc2626';inp.focus();}return;}
  const qty=parseFloat(document.getElementById('_ffa-qty')?.value)||1;
  const unit=(document.getElementById('_ffa-unit')?.value||'ea').trim();
  const rate=parseFloat(document.getElementById('_ffa-rate')?.value)||0;
  document.getElementById('_ff-add-ov')?.remove();
  const line={desc,qty,unit,rate,total:qty*rate};
  if(editIdx>=0&&editIdx<_geiLines.length)_geiLines[editIdx]=line;
  else _geiLines.push(line);
  _geiRenderFreeFormBuilder();_geiRenderCartBar();
}
function _geiEditFreeFormLine(i){
  const l=_geiLines[i];if(!l)return;
  _geiAddFreeFormLine({...l,_edit:i});
}

function _geiRenderStepBar(){
  const el=document.getElementById('gei-step-bar');if(!el)return;
  const steps=['Job info','Build','Review'];
  el.innerHTML='<div class="steps" style="margin-bottom:16px">'
    +steps.map((s,i)=>{
      const n=i+1;
      const cls=n===_geiStep?'step active':n<_geiStep?'step done':'step';
      const sep=i<steps.length-1?'<div class="ssep"></div>':'';
      return `<div class="${cls}"><div class="snum">${n}</div><span class="slbl">${s}</span></div>${sep}`;
    }).join('')
    +'</div>';
}

function _geiSyncScopeButtons(){
  const resi=document.getElementById('gei-resi-btn');
  const comm=document.getElementById('gei-comm-btn');
  const emrg=document.getElementById('gei-emrg-btn');
  if(resi){resi.style.border=`2px solid ${!_geiIsCommercial?'var(--blue)':'var(--border2)'}`;resi.style.background=!_geiIsCommercial?'var(--blue-lt)':'var(--bg2)';resi.style.color=!_geiIsCommercial?'var(--blue-dk)':'var(--text2)';}
  if(comm){comm.style.border=`2px solid ${_geiIsCommercial?'var(--blue)':'var(--border2)'}`;comm.style.background=_geiIsCommercial?'var(--blue-lt)':'var(--bg2)';comm.style.color=_geiIsCommercial?'var(--blue-dk)':'var(--text2)';}
  if(emrg){emrg.style.border=`2px solid ${_geiEmergency?'#dc2626':'var(--border2)'}`;emrg.style.background=_geiEmergency?'#fef2f2':'var(--bg2)';emrg.style.color=_geiEmergency?'#dc2626':'var(--text2)';}
}

function _geiPriceMult(){
  // Apply property tier multiplier to default job prices
  const c=clients.find(x=>x.id===_geiClientId);
  const tier=c?.propertyTier||'standard';
  if(tier==='premium')return 1.25;
  if(tier==='basic')return 0.85;
  return 1.0;
}

function _geiTierBadge(){
  const c=clients.find(x=>x.id===_geiClientId);
  if(!c?.propertyTier||c.propertyTier==='standard')return'';
  const tier=c.propertyTier;
  const cfg={
    premium:{label:'Premium property',bg:'#fef3c7',color:'#92400e'},
    basic:  {label:'Rental / budget',bg:'#fee2e2',color:'#991b1b'},
  }[tier]||null;
  if(!cfg)return'';
  return `<div style="font-size:11px;font-weight:700;background:${cfg.bg};color:${cfg.color};border-radius:20px;padding:3px 10px;display:inline-block;margin-bottom:12px">${cfg.label} · prices adjusted</div>`;
}


function _geiLocationMult(){return STATE_LABOR_MULT[S.state]||1.0;}

function _geiJobPrice(job){
  const propMult=_geiPriceMult();
  const custom=(S.myRates||{})[job.id];
  if(custom){
    return{labor:Math.round((custom.labor||0)*propMult),mat:Math.round((custom.mat||0)*propMult),isCustom:true};
  }
  const locMult=_geiLocationMult();
  const emergMult=_geiEmergency?1.5:1.0;
  const nwMult=(_geiNewWork&&(job.nw??1)<1)?(job.nw??1):1.0;
  return{labor:Math.round((job.labor||0)*nwMult*locMult*emergMult*propMult),mat:Math.round((job.mat||0)*propMult),isCustom:false};
}

function _geiAddWithRate(job,inputEl){
  const entered=parseInt(inputEl?.value)||0;
  const p=_geiJobPrice(job);
  const marketTotal=p.labor+(p.mat||0);
  if(entered!==marketTotal&&entered>0){
    S.myRates=S.myRates||{};
    S.myRates[job.id]={labor:entered,mat:0};
    saveAll();
    showToast('Rate saved for '+job.name,'💾');
  }
  if(job.gasLic)showToast('Gas work — verify you\'re licensed for gas in your state','⚠️');
  if(job.freeForm){_geiShowFreeFormModal(job);return;}
  const rate=entered||marketTotal;
  if(job.custom){
    const unitLabel={sqft:'square footage','lin ft':'linear feet',kW:'kilowatts',kWh:'kilowatt-hours',fixture:'number of fixtures'}[job.unit]||job.unit;
    const raw=prompt('Enter '+unitLabel+' for: '+job.name);
    if(!raw)return;
    const qty=parseFloat(raw);if(!qty||isNaN(qty))return;
    _geiLines.push({desc:job.name+' — labor',qty,unit:job.unit,rate:Math.round(p.labor),total:qty*Math.round(p.labor),jobId:job.id});
    if(p.mat>0)_geiLines.push({desc:job.matDesc||'Materials',qty,unit:job.unit,rate:p.mat,total:qty*p.mat});
  } else {
    if(p.labor>0)_geiLines.push({desc:job.name+' — labor',qty:1,unit:job.unit,rate:p.labor,total:p.labor,jobId:job.id});
    if(p.mat>0)_geiLines.push({desc:job.matDesc||'Materials',qty:1,unit:job.unit,rate:p.mat,total:p.mat});
  }
  renderGeiLines();calcGeiTotal();
}

function _geiVisibleJobIds(){
  const bundles=S.myBundles||[];
  if(!bundles.length||bundles[0]==='__all')return null;
  const ids=new Set();
  bundles.forEach(b=>(GEI_BUNDLES[b]||[]).forEach(id=>ids.add(id)));
  return ids;
}

function _geiOpenCatSheet(catLabel){
  const trade=_geiTrade||'general';
  const allJobs=TRADE_JOBS[trade]||TRADE_JOBS.general;
  const scope=_geiIsCommercial?'commercial':'resi';
  const jobs=allJobs.filter(j=>!j.scope||j.scope==='both'||j.scope===scope);
  const ids=(TRADE_JOB_CATS[trade]||{})[catLabel]||[];
  const jobById=Object.fromEntries(jobs.map(j=>[j.id,j]));
  const catJobs=ids.map(id=>jobById[id]).filter(Boolean);
  const mult=_geiPriceMult();

  const ov=document.createElement('div');
  ov.id='_gei-cat-ov';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box';
  ov.onclick=e=>{if(e.target===ov)ov.remove();};

  const sheet=document.createElement('div');
  sheet.style.cssText='background:var(--bg);border-radius:var(--rl);width:100%;max-width:460px;padding:16px 16px 24px;max-height:80vh;overflow-y:auto;box-sizing:border-box';

  const rows=catJobs.map(job=>{
    const p=_geiJobPrice(job);
    const defaultTotal=p.labor+(p.mat||0);
    const isCustomRate=p.isCustom;
    const gasTag=job.gasLic?`<span style="font-size:10px;background:#fef3c7;color:#92400e;border-radius:3px;padding:1px 5px;margin-left:6px">GAS LIC</span>`:'';
    const rateLabel=isCustomRate
      ?`<span style="color:#16a34a;font-size:10px;margin-top:2px">✓ your rate</span>`
      :`<span style="color:var(--text3);font-size:10px;margin-top:2px">📍 ${S.state||'US'} avg${_geiNewWork&&(job.nw||1)<1?' · new work':''}</span>`;
    const inputBorder=isCustomRate?'border:1.5px solid #16a34a':'border:1.5px solid var(--border2)';
    const inputColor=isCustomRate?'color:#16a34a':'color:var(--blue)';
    const inputId='_gei-rate-'+job.id;
    return `<div style="display:flex;align-items:center;gap:10px;padding:11px 14px;border:1.5px solid var(--border2);border-radius:var(--r);background:var(--bg2);margin-bottom:7px;box-sizing:border-box">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700;color:var(--text)">${escHtml(job.name)}${gasTag}</div>
        ${rateLabel}
      </div>
      <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
        <span style="font-size:12px;color:var(--text3)">$</span>
        <input type="number" id="${inputId}" value="${defaultTotal}" min="0" step="1"
          style="width:74px;padding:5px 4px;border-radius:var(--r);${inputBorder};font-size:14px;font-weight:800;${inputColor};text-align:right;background:var(--bg);font-family:inherit"
          onclick="event.stopPropagation()">
        <button onclick="_geiAddWithRate(${JSON.stringify(job).replace(/"/g,'&quot;')},document.getElementById('${inputId}'));document.getElementById('_gei-cat-ov')?.remove();_geiRenderCartBar()"
          style="padding:7px 12px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-weight:700;font-size:13px;cursor:pointer;white-space:nowrap">+ Add</button>
      </div>
    </div>`;
  }).join('');

  const firstTimeBanner=(!S.myRates||!Object.keys(S.myRates).length)?`<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:var(--r);padding:10px 14px;margin-bottom:12px;font-size:12px;color:#1e40af;line-height:1.5">📍 Showing <strong>${S.state||'US'} market averages</strong> (BLS labor data). Edit any price to set your own rate — saves automatically.</div>`:'';
  const newWorkBadge=_geiNewWork?`<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:var(--r);padding:6px 12px;margin-bottom:10px;font-size:12px;color:#15803d;font-weight:600">🏗️ New construction rates active — lower labor</div>`:'';
  sheet.innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <div style="font-size:16px;font-weight:800;color:var(--text)">${catLabel}</div>
      <button onclick="document.getElementById('_gei-cat-ov')?.remove()" style="background:none;border:none;font-size:24px;cursor:pointer;color:var(--text3);padding:0;line-height:1">×</button>
    </div>
    ${firstTimeBanner}${newWorkBadge}${_geiTierBadge()}
    ${rows||'<div style="font-size:13px;color:var(--text3);text-align:center;padding:20px 0">No services in this category for current scope.</div>'}`;
  ov.appendChild(sheet);
  document.body.appendChild(ov);
}

function _geiRenderCartBar(){
  const bar=document.getElementById('gei-cart-bar')||(()=>{
    const b=document.createElement('div');
    b.id='gei-cart-bar';
    b.style.cssText='position:fixed;bottom:0;left:0;right:0;z-index:8000;background:var(--blue);padding:13px 20px 30px;display:flex;justify-content:space-between;align-items:center;cursor:pointer;box-shadow:0 -2px 16px rgba(0,0,0,.15)';
    b.onclick=()=>goGeiStep(3);
    document.body.appendChild(b);
    return b;
  })();
  const{sub}=calcGeiTotal();
  const n=_geiLines.length;
  if(!n||_geiStep!==2){bar.style.display='none';return;}
  bar.style.display='flex';
  bar.innerHTML=`<span style="color:#fff;font-size:13px;font-weight:600">${n} item${n!==1?'s':''} added</span><span style="color:#fff;font-size:16px;font-weight:800">$${sub.toLocaleString('en-US',{maximumFractionDigits:0})} · Review →</span>`;
}

function _geiRenderTemplates(){
  const el=document.getElementById('gei-templates');if(!el)return;
  const trade=_geiTrade||'general';
  const allJobs=TRADE_JOBS[trade]||TRADE_JOBS.general;
  const scope=_geiIsCommercial?'commercial':'resi';
  const jobs=allJobs.filter(j=>!j.scope||j.scope==='both'||j.scope===scope);
  const visibleIds=_geiVisibleJobIds();

  let html='';
  if(_geiEmergency)html+=`<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:var(--r);padding:9px 12px;font-size:12px;color:#b91c1c;margin-bottom:12px;font-weight:600">🚨 Emergency mode — labor rates ×1.5 · after-hours surcharge added</div>`;
  if(_geiNewWork)html+=`<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:var(--r);padding:7px 12px;font-size:12px;color:#15803d;margin-bottom:12px;font-weight:600">🏗️ New construction rates active — lower labor</div>`;

  // Category tile grid for trades with categories
  const cats=TRADE_JOB_CATS[trade];
  if(cats){
    const jobById=Object.fromEntries(jobs.map(j=>[j.id,j]));
    html+=`<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">`;
    for(const [catLabel,ids] of Object.entries(cats)){
      const catJobs=ids.map(id=>jobById[id]).filter(Boolean).filter(j=>!visibleIds||visibleIds.has(j.id));
      if(!catJobs.length)continue;
      const parts=catLabel.split(' ');
      const emoji=parts[0];
      const name=parts.slice(1).join(' ');
      const safeLabel=escHtml(catLabel);
      html+=`<button data-cat="${escHtml(catLabel)}" onclick="_geiOpenCatSheet(this.dataset.cat)"
        style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:14px 8px;border-radius:var(--rl);border:1.5px solid var(--border2);background:var(--bg2);cursor:pointer;font-family:inherit;gap:5px;min-height:85px;text-align:center">
        <span style="font-size:28px;line-height:1">${emoji}</span>
        <span style="font-size:12px;font-weight:700;color:var(--text)">${escHtml(name)}</span>
        <span style="font-size:10px;color:var(--text3)">${catJobs.length} service${catJobs.length!==1?'s':''}</span>
      </button>`;
    }
    html+=`</div>`;
    if(visibleIds){
      const totalCount=(TRADE_JOBS[trade]||[]).length;
      html+=`<button onclick="_geiShowAllServices()" style="width:100%;margin-top:12px;padding:10px;background:none;border:1px dashed var(--border2);border-radius:var(--r);color:var(--text3);font-size:12px;cursor:pointer;font-family:inherit">+ Find unlisted service (search all ${totalCount} services)</button>`;
    }
  } else {
    // Flat chip fallback for general/other
    const makeChip=job=>{
      const p=_geiJobPrice(job);
      const total=p.labor+(p.mat||0);
      const priceStr=job.custom?`$${total}/${job.unit}`:`$${total.toLocaleString()}`;
      const safeJob=escHtml(JSON.stringify(job));
      return `<button onclick="_geiAddTemplate(JSON.parse(this.dataset.job));_geiRenderCartBar()" data-job="${safeJob}" style="display:inline-flex;flex-direction:column;align-items:flex-start;padding:8px 12px;border-radius:var(--r);border:1.5px solid var(--border2);background:var(--bg2);cursor:pointer;font-family:inherit;text-align:left"><span style="font-size:12px;font-weight:700;color:var(--text)">${escHtml(job.name)}</span><span style="font-size:10px;color:var(--text3)">${priceStr}</span></button>`;
    };
    html+=`<div style="display:flex;flex-wrap:wrap;gap:6px">${jobs.map(makeChip).join('')}</div>`;
  }
  el.innerHTML=html;
}

function _geiShowAllServices(){
  S.myBundles=['__all'];saveAll();_geiRenderTemplates();showToast('Showing all services','✓');
}

function showGeiOnboarding(opts){
  if(!opts?.force&&S.myBundles&&S.myBundles.length)return;
  const BUNDLE_CARDS=[
    {id:'residential',   emoji:'🏠', label:'Residential\nService'},
    {id:'panels_circuits',emoji:'⚡',label:'Panels &\nCircuits'},
    {id:'service_upgrades',emoji:'🔧',label:'Service\nUpgrades'},
    {id:'ev_solar',      emoji:'☀️', label:'EV & Solar'},
    {id:'outdoor_pool',  emoji:'🏊', label:'Outdoor\n& Pool'},
    {id:'smart_security',emoji:'🔒', label:'Smart Home\n& Security'},
    {id:'appliances',    emoji:'🍳', label:'Appliance\nCircuits'},
    {id:'diagnostics',   emoji:'🔍', label:'Diagnostics\n& Specialty'},
    {id:'new_construction',emoji:'🏗️',label:'New\nConstruction'},
    {id:'commercial',    emoji:'🏢', label:'Commercial'},
  ];
  const selected=new Set();
  const ov=document.createElement('div');
  ov.id='_gei-onboard-ov';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box';
  function render(){
    const stateStr=S.state||'US';
    const mult=STATE_LABOR_MULT[S.state]||1.0;
    const multNote=mult!==1.0?` (${mult>1?'+':''}${Math.round((mult-1)*100)}% vs national avg)`:'';
    ov.innerHTML=`<div style="background:var(--bg);border-radius:var(--rl);width:100%;max-width:480px;max-height:90vh;overflow-y:auto;box-sizing:border-box;padding:22px 18px 28px">
      <div style="font-size:20px;font-weight:800;color:var(--text);margin-bottom:4px">⚡ Set up your services</div>
      <div style="font-size:12px;color:var(--text3);margin-bottom:14px">Takes about 30 seconds · you can change this anytime</div>
      <div style="background:var(--blue-lt);border:1px solid var(--blue);border-radius:var(--r);padding:10px 14px;margin-bottom:16px;font-size:12px;color:var(--blue-dk)">
        📍 You're in <strong>${stateStr}</strong> — market rates loaded${multNote}
        <button onclick="document.getElementById('_gei-state-sel')?.classList.toggle('show')" style="margin-left:8px;background:none;border:none;color:var(--blue);font-size:11px;cursor:pointer;text-decoration:underline;font-family:inherit">Change</button>
        <select id="_gei-state-sel" class="show" onchange="S.state=this.value;saveAll();showGeiOnboarding()" style="display:block;margin-top:8px;padding:6px 8px;border-radius:var(--r);border:1px solid var(--border2);font-size:13px;background:var(--bg);color:var(--text);width:100%">
          ${['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'].map(st=>`<option value="${st}"${S.state===st?' selected':''}>${st}</option>`).join('')}
        </select>
      </div>
      <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:10px">What kind of work do you do? <span style="font-weight:400;color:var(--text3)">(tap all that apply)</span></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:18px">
        ${BUNDLE_CARDS.map(b=>{
          const on=selected.has(b.id);
          return `<button onclick="_geiOnboardToggle('${b.id}')" data-bid="${b.id}" style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:14px 8px;border-radius:var(--rl);border:2px solid ${on?'var(--blue)':'var(--border2)'};background:${on?'var(--blue-lt)':'var(--bg2)'};cursor:pointer;font-family:inherit;gap:5px;min-height:80px;text-align:center;box-sizing:border-box">
            <span style="font-size:26px;line-height:1">${b.emoji}</span>
            <span style="font-size:11px;font-weight:700;color:${on?'var(--blue-dk)':'var(--text)'};white-space:pre-line;line-height:1.3">${b.label}</span>
            ${on?'<span style="font-size:10px;color:var(--blue);font-weight:700">✓</span>':''}
          </button>`;
        }).join('')}
      </div>
      <button onclick="_geiOnboardFinish()" id="_gei-ob-btn" style="width:100%;padding:14px;border-radius:var(--rl);border:none;background:${selected.size?'var(--blue)':'var(--border2)'};color:${selected.size?'#fff':'var(--text3)'};font-weight:800;font-size:15px;cursor:${selected.size?'pointer':'default'};font-family:inherit;margin-bottom:10px">
        ${selected.size?`Get started → (${selected.size} service type${selected.size!==1?'s':''})`:'Select at least one service type'}
      </button>
      <button onclick="_geiOnboardSkip()" style="width:100%;padding:10px;background:none;border:none;color:var(--text3);font-size:12px;cursor:pointer;font-family:inherit">Set up later — you'll be reminded next time</button>
    </div>`;
  }
  window._geiOnboardToggle=function(id){
    if(selected.has(id))selected.delete(id);else selected.add(id);
    document.getElementById('_gei-onboard-ov')?.remove();
    document.body.appendChild(ov);
    render();
  };
  window._geiOnboardFinish=function(){
    if(!selected.size)return;
    S.myBundles=[...selected];S.hasOnboarded=true;saveAll();
    ov.remove();showToast('Services set up — showing '+S.state+' market rates','✓');
  };
  window._geiOnboardSkip=function(){
    ov.remove(); // session-only dismiss — myBundles stays unset, popup re-appears next load
  };
  render();
  document.body.appendChild(ov);
}

function _geiSetScope(commercial){
  _geiIsCommercial=!!commercial;
  _geiSyncScopeButtons();
  if(_geiStep===2)_geiRenderTemplates();
}

function _geiToggleEmergency(){
  _geiEmergency=!_geiEmergency;
  _geiSyncScopeButtons();
  if(_geiEmergency&&!_geiLines.some(l=>l.desc&&l.desc.includes('Emergency'))){
    _geiLines.unshift({desc:'Emergency / after-hours service call',qty:1,unit:'ea',rate:125,total:125});
    if(_geiStep===3){renderGeiLines();calcGeiTotal();}
    _geiRenderCartBar();
  }
  if(_geiStep===2)_geiRenderTemplates();
}

function _geiAddTemplate(job){
  if(job.gasLic)showToast('Gas work — verify you\'re licensed for gas in your state','⚠️');
  if(job.freeForm){_geiShowFreeFormModal(job);return;}
  const laborRate=_geiEmergency?Math.round(job.labor*1.5):job.labor;
  if(job.custom){
    const unitLabel={sqft:'square footage','lin ft':'linear feet',kW:'kilowatts',kWh:'kilowatt-hours',fixture:'number of fixtures'}[job.unit]||job.unit;
    const raw=prompt('Enter '+unitLabel+' for: '+job.name);
    if(!raw)return;
    const qty=parseFloat(raw);if(!qty||isNaN(qty))return;
    if(laborRate>0)_geiLines.push({desc:job.name+' — labor',qty,unit:job.unit,rate:laborRate,total:qty*laborRate});
    if(job.mat>0)_geiLines.push({desc:job.matDesc||'Materials',qty,unit:job.unit,rate:job.mat,total:qty*job.mat});
  } else {
    if(laborRate>0)_geiLines.push({desc:job.name+' — labor',qty:1,unit:job.unit,rate:laborRate,total:laborRate});
    if(job.mat>0)_geiLines.push({desc:job.matDesc||'Materials',qty:1,unit:job.unit,rate:job.mat,total:job.mat});
  }
  renderGeiLines();calcGeiTotal();
}

function _geiShowFreeFormModal(job){
  const laborRate=_geiEmergency?Math.round(job.labor*1.5):job.labor;
  const isCustomQty=!!job.custom;
  const unitLabel={sqft:'sqft','lin ft':'lin ft',kW:'kW',kWh:'kWh',fixture:'fixtures'}[job.unit]||job.unit;
  const ov=document.createElement('div');
  ov.id='_gei-ff-ov';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box';
  ov.innerHTML=`
    <div style="background:var(--bg);border-radius:14px;padding:20px 18px 24px;width:100%;max-width:480px;box-sizing:border-box;max-height:90vh;overflow-y:auto">
      <div style="font-size:14px;font-weight:800;color:var(--text);margin-bottom:4px">${escHtml(job.name)}</div>
      <div style="font-size:12px;color:var(--text3);margin-bottom:14px">${escHtml(job.freeFormLabel||'Specify brand/model')}</div>
      <div class="f" style="margin-bottom:10px"><label>Brand / model</label>
        <input id="_ff-model" type="text" placeholder="${escHtml(job.freeFormLabel||'e.g. Mitsubishi MSZ-GL09NA')}" style="font-size:14px" autocomplete="off">
      </div>
      ${isCustomQty?`<div class="fg fg2" style="margin-bottom:10px">
        <div class="f"><label>Quantity (${unitLabel})</label><input id="_ff-qty" type="number" value="1" min="0.1" step="any" style="font-size:14px"></div>
        <div></div>
      </div>`:''}
      <div class="fg fg2" style="margin-bottom:14px">
        <div class="f"><label>Labor rate ($/${job.unit})</label><input id="_ff-labor" type="number" value="${laborRate}" min="0" step="any" style="font-size:14px"></div>
        ${job.mat>0?`<div class="f"><label>Material cost ($/${job.unit})</label><input id="_ff-mat" type="number" value="${job.mat}" min="0" step="any" style="font-size:14px"></div>`:'<div></div>'}
      </div>
      <button class="btn btn-p" onclick="_geiConfirmFreeForm(${JSON.stringify(job).replace(/"/g,'&quot;')})" style="margin-bottom:8px">Add to estimate</button>
      <button class="btn" onclick="document.getElementById('_gei-ff-ov')?.remove()" style="color:var(--text2);font-size:13px">Cancel</button>
    </div>`;
  document.body.appendChild(ov);
  setTimeout(()=>document.getElementById('_ff-model')?.focus(),100);
}

function _geiConfirmFreeForm(job){
  const model=(document.getElementById('_ff-model')?.value||'').trim();
  const laborRate=parseFloat(document.getElementById('_ff-labor')?.value)||0;
  const matRate=parseFloat(document.getElementById('_ff-mat')?.value)||0;
  const qty=parseFloat(document.getElementById('_ff-qty')?.value)||1;
  document.getElementById('_gei-ff-ov')?.remove();
  const modelTag=model?' — '+model:'';
  if(laborRate>0)_geiLines.push({desc:job.name+modelTag+' — labor',qty,unit:job.unit,rate:laborRate,total:qty*laborRate});
  if(matRate>0)_geiLines.push({desc:(model||job.matDesc||'Materials')+modelTag,qty,unit:job.unit,rate:matRate,total:qty*matRate});
  renderGeiLines();calcGeiTotal();
}

function _geiAddFromBook(i){
  const trade=_geiTrade||'general';
  const book=(S.priceBook&&S.priceBook[trade])||[];
  if(!book[i])return;
  _geiLines.push({desc:book[i].desc,qty:1,unit:book[i].unit||'',rate:book[i].rate,total:book[i].rate});
  renderGeiLines();calcGeiTotal();
}

function _geiSaveToPriceBook(i){
  const line=_geiLines[i];if(!line||!line.desc||!line.rate)return;
  const trade=_geiTrade||'general';
  if(!S.priceBook)S.priceBook={};
  if(!S.priceBook[trade])S.priceBook[trade]=[];
  if(S.priceBook[trade].some(x=>x.desc===line.desc&&x.rate===line.rate)){showToast('Already in price book');return;}
  S.priceBook[trade].push({desc:line.desc,unit:line.unit||'ea',rate:line.rate});
  saveAll();showToast('Saved to price book','🔖');
  _geiRenderTemplates();
}


function renderGeiLines(){
  const el=document.getElementById('gei-lines');if(!el)return;
  if(!_geiLines.length){
    el.innerHTML='<div style="font-size:13px;color:var(--text3);text-align:center;padding:20px 0">No line items yet — tap <strong>+ Add line</strong> above.</div>';
    return;
  }
  el.innerHTML=_geiLines.map((l,i)=>{
    const total=((l.qty||1)*(l.rate||0));
    const totalFmt='$'+total.toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0});
    const isLabor=l._tmLabor;
    return `<div style="background:var(--bg2);border-radius:var(--rl);border:1px solid var(--border2);padding:13px 14px;margin-bottom:8px">
      <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:10px">
        <input type="text" value="${escHtml(l.desc||'')}" ${isLabor?'readonly':''} oninput="_geiLines[${i}].desc=this.value" placeholder="Description" style="flex:1;background:transparent;border:none;border-bottom:1.5px solid var(--border2);font-size:14px;font-weight:600;font-family:inherit;color:var(--text);padding:2px 0 7px;outline:none;${isLabor?'opacity:.7;':''}">
        ${isLabor?'':`<button onclick="_geiLines.splice(${i},1);renderGeiLines();calcGeiTotal();_geiRenderCartBar()" style="background:none;border:none;cursor:pointer;color:var(--text3);font-size:22px;padding:0 2px;line-height:1;flex-shrink:0;margin-top:-2px" aria-label="Remove">×</button>`}
      </div>
      <div style="display:grid;grid-template-columns:60px 50px 1fr 90px;gap:8px;align-items:end">
        <div>
          <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:4px">Qty</div>
          <input type="number" value="${l.qty||1}" min="0" step="any" inputmode="decimal" ${isLabor?'readonly':''}
            oninput="_geiLines[${i}].qty=parseFloat(this.value)||1;calcGeiTotal();document.getElementById('gei-line-total-${i}').textContent='$'+((parseFloat(this.value)||1)*(${l.rate||0})).toLocaleString('en-US',{maximumFractionDigits:0})"
            style="width:100%;padding:6px 4px;border-radius:var(--r);border:1px solid var(--border2);font-size:14px;text-align:center;background:var(--bg);color:var(--text);font-family:inherit;box-sizing:border-box;${isLabor?'opacity:.7;':''}">
        </div>
        <div>
          <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:4px">Unit</div>
          <input type="text" value="${escHtml(l.unit||'ea')}" ${isLabor?'readonly':''} oninput="_geiLines[${i}].unit=this.value"
            style="width:100%;padding:6px 4px;border-radius:var(--r);border:1px solid var(--border2);font-size:12px;text-align:center;background:var(--bg);color:var(--text2);font-family:inherit;box-sizing:border-box;${isLabor?'opacity:.7;':''}">
        </div>
        <div>
          <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:4px">Rate ($)</div>
          <input type="number" value="${l.rate||''}" min="0" step="any" inputmode="decimal" ${isLabor?'readonly':''}
            oninput="_geiLines[${i}].rate=parseFloat(this.value)||0;calcGeiTotal();document.getElementById('gei-line-total-${i}').textContent='$'+((${l.qty||1})*(parseFloat(this.value)||0)).toLocaleString('en-US',{maximumFractionDigits:0})"
            onblur="_geiRateBlur(${i},this.value)" placeholder="0"
            style="width:100%;padding:6px 8px;border-radius:var(--r);border:1px solid var(--border2);font-size:14px;text-align:right;background:var(--bg);color:var(--text);font-family:inherit;box-sizing:border-box;${isLabor?'opacity:.7;':''}">
        </div>
        <div style="text-align:right">
          <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:4px">Total</div>
          <div id="gei-line-total-${i}" style="font-size:18px;font-weight:800;color:var(--blue);line-height:1.2">${totalFmt}</div>
        </div>
      </div>
      ${isLabor?'':`<div style="display:flex;justify-content:flex-end;margin-top:8px"><button onclick="_geiSaveToPriceBook(${i})" style="background:none;border:none;cursor:pointer;color:var(--text3);font-size:11px;font-weight:600;font-family:inherit;padding:0;display:flex;align-items:center;gap:3px">🔖 Save to price book</button></div>`}
    </div>`;
  }).join('');
}

function addGeiLine(){_geiLines.push({desc:'',qty:1,unit:'ea',rate:'',total:0});renderGeiLines();calcGeiTotal();}

function _saveToLineHistory(){
  if(!_geiLines.length)return;
  if(!S.lineHistory)S.lineHistory=[];
  _geiLines.forEach(l=>{
    if(!l.desc||l._tmLabor)return;
    const key=l.desc.toLowerCase().trim();
    const idx=S.lineHistory.findIndex(h=>(h.desc||'').toLowerCase().trim()===key);
    if(idx>=0){
      S.lineHistory[idx].count=(S.lineHistory[idx].count||0)+1;
      if(l.rate)S.lineHistory[idx].rate=l.rate;
      if(l.unit)S.lineHistory[idx].unit=l.unit;
      if(l.qty)S.lineHistory[idx].qty=l.qty;
      S.lineHistory[idx].lastUsed=Date.now();
      S.lineHistory[idx].trade=_geiTrade||'general';
    }else{
      S.lineHistory.push({desc:l.desc,qty:l.qty||1,unit:l.unit||'ea',rate:l.rate||0,count:1,lastUsed:Date.now(),trade:_geiTrade||'general'});
    }
  });
  S.lineHistory.sort((a,b)=>(b.count||0)-(a.count||0));
  if(S.lineHistory.length>100)S.lineHistory.length=100;
  saveAll();
}

function _geiRateBlur(i,val){
  const line=_geiLines[i];if(!line||!line.jobId)return;
  let job=null;
  for(const t of Object.values(TRADE_JOBS)){job=(t||[]).find(j=>j.id===line.jobId);if(job)break;}
  if(!job)return;
  const p=_geiJobPrice(job);
  const market=p.labor+(p.mat||0);
  const entered=parseInt(val)||0;
  if(entered>0&&entered!==market){
    S.myRates=S.myRates||{};S.myRates[line.jobId]={labor:entered,mat:0};saveAll();showToast('Rate saved','💾');
  }
}

// ─── Panel Schedule Builder ───────────────────────────────────────────────────
function _panelAutoGauge(a){const hits=Object.keys(_PANEL_GAUGE).map(Number).filter(k=>k>=a);return _PANEL_GAUGE[hits.length?Math.min(...hits):200]||'';}

function _panelCalcBalance(){
  if(!_panelSched)return{l1:0,l2:0,slots:0,used:0,imbalance:0};
  const {panelAmps,circuits}=_panelSched;
  const slots=_PANEL_SLOTS[panelAmps]||40;
  let l1=0,l2=0,used=0;
  (circuits||[]).forEach(c=>{
    const a=+c.amps||0;
    if(c.phase==='2pole'){l1+=a;l2+=a;used+=2;}
    else if(c.phase==='L2'){l2+=a;used+=1;}
    else{l1+=a;used+=1;}
  });
  const imbalance=Math.max(l1,l2)>0?Math.abs(l1-l2)/Math.max(l1,l2):0;
  return{l1,l2,slots,used,imbalance,spare:Math.max(0,slots-used)};
}

function _panelRenderSection(){
  const el=document.getElementById('gei-panel-section');if(!el)return;
  if(_geiTrade!=='electrical'){el.innerHTML='';return;}
  if(!_panelSched){
    el.innerHTML=`<button onclick="_panelOpen()" style="width:100%;padding:12px;border-radius:var(--r);border:1.5px dashed var(--border2);background:var(--bg2);color:var(--text3);font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;text-align:center">📋 Add panel schedule <span style="font-size:11px;font-weight:400">(optional — leave with the panel)</span></button>`;
    return;
  }
  const {l1,l2,slots,used,imbalance,spare}=_panelCalcBalance();
  const pa=_panelSched.panelAmps||200;
  const imbalBadge=imbalance>0.10?`<span style="background:#fef2f2;color:#dc2626;border:1px solid #fca5a5;border-radius:4px;padding:2px 7px;font-size:11px;font-weight:700;margin-left:8px">⚠️ ${(imbalance*100).toFixed(0)}% imbalance</span>`:'<span style="background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0;border-radius:4px;padding:2px 7px;font-size:11px;font-weight:700;margin-left:8px">✓ balanced</span>';
  const circuits=_panelSched.circuits||[];
  const rowStyle='display:grid;grid-template-columns:1fr 52px 70px 60px 34px 34px 20px;gap:4px;align-items:center;margin-bottom:5px';
  const hdStyle='font-size:10px;font-weight:700;color:var(--text3);text-align:center';
  let rows=`<div style="${rowStyle};margin-bottom:8px">
    <div style="${hdStyle};text-align:left">Circuit description</div>
    <div style="${hdStyle}">Amps</div>
    <div style="${hdStyle}">Phase</div>
    <div style="${hdStyle}">Wire gauge</div>
    <div style="${hdStyle}">AFCI</div>
    <div style="${hdStyle}">GFCI</div>
    <div></div>
  </div>`;
  circuits.forEach((c,i)=>{
    const phaseOpts=['L1','L2','2pole'].map(p=>`<option value="${p}"${c.phase===p?' selected':''}>${p==='2pole'?'2-pole':p}</option>`).join('');
    rows+=`<div style="${rowStyle}">
      <input type="text" value="${escHtml(c.desc||'')}" oninput="_panelSched.circuits[${i}].desc=this.value" placeholder="e.g. Kitchen outlets" style="padding:6px 7px;border-radius:var(--r);border:1px solid var(--border2);font-size:12px;font-family:inherit;background:var(--bg2);color:var(--text);width:100%;box-sizing:border-box">
      <input type="number" value="${c.amps||''}" min="1" max="400" step="1" oninput="_panelSched.circuits[${i}].amps=+this.value;_panelSched.circuits[${i}].gauge=_panelSched.circuits[${i}].gauge||_panelAutoGauge(+this.value);_panelRenderSection()" placeholder="20" style="padding:6px 4px;border-radius:var(--r);border:1px solid var(--border2);font-size:12px;text-align:center;background:var(--bg2);color:var(--text);width:100%;box-sizing:border-box">
      <select oninput="_panelSched.circuits[${i}].phase=this.value;_panelRenderSection()" style="padding:6px 4px;border-radius:var(--r);border:1px solid var(--border2);font-size:12px;background:var(--bg2);color:var(--text);width:100%;box-sizing:border-box">${phaseOpts}</select>
      <input type="text" value="${escHtml(c.gauge||'')}" oninput="_panelSched.circuits[${i}].gauge=this.value" placeholder="12 AWG" style="padding:6px 4px;border-radius:var(--r);border:1px solid var(--border2);font-size:11px;background:var(--bg2);color:var(--text3);width:100%;box-sizing:border-box">
      <label style="display:flex;align-items:center;justify-content:center;cursor:pointer"><input type="checkbox" ${c.afci?'checked':''} onchange="_panelSched.circuits[${i}].afci=this.checked" style="width:16px;height:16px;cursor:pointer"></label>
      <label style="display:flex;align-items:center;justify-content:center;cursor:pointer"><input type="checkbox" ${c.gfci?'checked':''} onchange="_panelSched.circuits[${i}].gfci=this.checked" style="width:16px;height:16px;cursor:pointer"></label>
      <button onclick="_panelRemoveCircuit(${i})" style="background:none;border:none;cursor:pointer;color:var(--text3);font-size:16px;padding:0;line-height:1">×</button>
    </div>`;
  });
  const l1Pct=Math.max(l1,l2)>0?Math.round(l1/Math.max(l1,l2)*100):50;
  const l2Pct=Math.max(l1,l2)>0?Math.round(l2/Math.max(l1,l2)*100):50;
  el.innerHTML=`<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text3)">📋 Panel schedule</div>
      <div style="display:flex;gap:6px">
        <button onclick="_panelPrint()" style="padding:5px 11px;border-radius:var(--r);border:1.5px solid var(--border2);background:var(--bg2);font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;color:var(--text2)">🖨️ Print</button>
        <button onclick="_panelClose()" style="padding:5px 11px;border-radius:var(--r);border:1.5px solid #fca5a5;background:#fef2f2;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;color:#dc2626">Remove</button>
      </div>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:6px">
        <label style="font-size:12px;color:var(--text2);white-space:nowrap">Panel size:</label>
        <select onchange="_panelSched.panelAmps=+this.value;_panelRenderSection()" style="padding:6px 8px;border-radius:var(--r);border:1.5px solid var(--border2);font-size:13px;font-weight:700;background:var(--bg2);color:var(--text)">
          ${[100,150,200,400].map(a=>`<option value="${a}"${pa===a?' selected':''}>${a}A</option>`).join('')}
        </select>
      </div>
      <div style="font-size:12px;color:var(--text2)">${used} of ${slots} slots used · <strong>${spare} spare</strong>${imbalBadge}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
      <div style="background:var(--bg2);border-radius:var(--r);padding:8px 10px">
        <div style="font-size:10px;font-weight:700;color:var(--text3);margin-bottom:4px">L1 LEG</div>
        <div style="font-size:18px;font-weight:800;color:var(--text)">${l1}A</div>
        <div style="height:6px;background:var(--border);border-radius:3px;margin-top:5px"><div style="height:100%;width:${l1Pct}%;background:var(--blue);border-radius:3px"></div></div>
      </div>
      <div style="background:var(--bg2);border-radius:var(--r);padding:8px 10px">
        <div style="font-size:10px;font-weight:700;color:var(--text3);margin-bottom:4px">L2 LEG</div>
        <div style="font-size:18px;font-weight:800;color:var(--text)">${l2}A</div>
        <div style="height:6px;background:var(--border);border-radius:3px;margin-top:5px"><div style="height:100%;width:${l2Pct}%;background:#7c3aed;border-radius:3px"></div></div>
      </div>
    </div>
    <div id="panel-rows">${rows}</div>
    <button onclick="_panelAddCircuit()" class="btn btn-sm" style="width:100%;padding:8px;font-size:12px;margin-top:4px">+ Add circuit</button>
  </div>`;
}

function _panelOpen(){
  _panelSched={panelAmps:200,circuits:[]};
  _panelAddCircuit();_panelRenderSection();
}
function _panelClose(){_panelSched=null;_panelRenderSection();}
function _panelAddCircuit(){
  if(!_panelSched)return;
  _panelSched.circuits.push({desc:'',amps:20,phase:'L1',gauge:'12 AWG',afci:false,gfci:false});
  _panelRenderSection();
}
function _panelRemoveCircuit(i){
  if(!_panelSched)return;
  _panelSched.circuits.splice(i,1);_panelRenderSection();
}

function _panelPrint(){
  if(!_panelSched)return;
  const {l1,l2,slots,used,imbalance,spare}=_panelCalcBalance();
  const pa=_panelSched.panelAmps;
  const circuits=_panelSched.circuits||[];
  const client=document.getElementById('gei-client')?.value||'';
  const addr=document.getElementById('gei-addr')?.value||'';
  const dateStr=new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'});
  const biz=S.bname||getBusinessName()||'';
  const imbalTxt=imbalance>0.10?`<span style="color:#dc2626;font-weight:700">⚠️ ${(imbalance*100).toFixed(0)}% imbalance — rebalance recommended</span>`:`<span style="color:#16a34a;font-weight:700">✓ Balanced (${(imbalance*100).toFixed(0)}% difference)</span>`;
  const rows=circuits.map((c,i)=>`<tr>
    <td style="text-align:center;padding:4px 6px;border:1px solid #ccc">${i+1}</td>
    <td style="padding:4px 8px;border:1px solid #ccc">${escHtml(c.desc||'—')}</td>
    <td style="text-align:center;padding:4px 6px;border:1px solid #ccc;font-weight:700">${c.amps||''}A</td>
    <td style="text-align:center;padding:4px 6px;border:1px solid #ccc">${c.phase==='2pole'?'2-pole':c.phase}</td>
    <td style="text-align:center;padding:4px 6px;border:1px solid #ccc">${escHtml(c.gauge||'')}</td>
    <td style="text-align:center;padding:4px 6px;border:1px solid #ccc">${c.afci?'✓':''}</td>
    <td style="text-align:center;padding:4px 6px;border:1px solid #ccc">${c.gfci?'✓':''}</td>
  </tr>`).join('');
  const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Panel Schedule</title>
  <style>
    body{font-family:-apple-system,Arial,sans-serif;margin:0;padding:20px;font-size:13px;color:#111}
    h1{font-size:18px;margin:0 0 4px}
    .meta{color:#555;font-size:12px;margin-bottom:16px}
    .stats{display:flex;gap:24px;margin-bottom:16px;background:#f5f5f5;padding:10px 14px;border-radius:6px}
    .stat{text-align:center}.stat-val{font-size:22px;font-weight:800}.stat-lbl{font-size:10px;color:#666;text-transform:uppercase}
    table{width:100%;border-collapse:collapse;font-size:12px}
    th{background:#1a1a2e;color:#fff;padding:6px 8px;border:1px solid #ccc;font-size:11px;text-align:center}
    @media print{button{display:none!important}}
  </style></head><body>
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
    <div><h1>⚡ Panel Schedule</h1><div class="meta">${escHtml(biz)}${client?' · '+escHtml(client):''}${addr?' · '+escHtml(addr):''}<br>Date: ${dateStr}</div></div>
    <div style="text-align:right;font-size:13px"><strong>${pa}A Main Panel</strong><br>${used} of ${slots} slots used · ${spare} spare<br>${imbalTxt}</div>
  </div>
  <div class="stats">
    <div class="stat"><div class="stat-val">${l1}A</div><div class="stat-lbl">L1 Leg</div></div>
    <div class="stat"><div class="stat-val">${l2}A</div><div class="stat-lbl">L2 Leg</div></div>
    <div class="stat"><div class="stat-val">${Math.abs(l1-l2)}A</div><div class="stat-lbl">Difference</div></div>
    <div class="stat"><div class="stat-val">${spare}</div><div class="stat-lbl">Spare slots</div></div>
  </div>
  <table><thead><tr>
    <th>#</th><th style="text-align:left">Circuit description</th><th>Amps</th><th>Phase</th><th>Wire gauge</th><th>AFCI</th><th>GFCI</th>
  </tr></thead><tbody>${rows}</tbody></table>
  <div style="margin-top:16px;font-size:10px;color:#888;border-top:1px solid #ddd;padding-top:8px">Generated by TradeDesk · ${biz} · ${dateStr}</div>
  <button onclick="window.print()" style="margin-top:16px;padding:10px 24px;background:#1a1a2e;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:700;cursor:pointer">🖨️ Print / Save PDF</button>
  </body></html>`;
  const win=window.open('','_blank');
  if(win){win.document.write(html);win.document.close();}
  else showToast('Allow pop-ups to print','⚠️');
}

function calcGeiTotal(){
  const sub=_geiLines.reduce((s,l)=>s+(l.qty||1)*(l.rate||0),0);
  const pct=parseFloat(document.getElementById('gei-tax-pct')?.value)||0;
  const tax=sub*pct/100;
  const total=sub+tax;
  const fmt=n=>'$'+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
  set('gei-subtotal',fmt(sub));set('gei-tax-amt',fmt(tax));set('gei-total',fmt(total));
  return{sub,tax,total};
}

function saveGenericEstimate(draft){
  const v=id=>document.getElementById(id)?.value||'';
  const{total,sub}=calcGeiTotal();
  const trade=_geiTrade||getActiveTrade();
  const taxPct=parseFloat(v('gei-tax-pct'))||0;
  // T&M extra fields
  const _tmNteFromNew=parseFloat(v('tm-i-nte'))||0;
  const _tmFields=_geiIsTM?{
    isTM:true,
    tmReason:v('tm-reason'),tmReasonNote:v('tm-reason-note'),
    tmCrewCount:_tmCrewCount,tmRatePerMan:_tmRatePerMan,tmEstHours:_tmEstHours,
    tmBillingCycle:_tmBillingCycle||'weekly',
    tmMatMarkup:_tmMatMarkup,
    tmCapAction:v('tm-i-cap-action')||_tmCapAction||'',
    tmDepositPct:parseFloat(v('tm-dep-pct'))||20,
    tmDepositAmt:Math.round(sub*(parseFloat(v('tm-dep-pct'))||20)/100),
    tmNteEnabled:(_tmNteFromNew>0)||(document.getElementById('tm-nte-on')?.checked||false),
    tmNteCap:_tmNteFromNew||parseFloat(v('tm-nte-cap'))||0,
  }:{isTM:false};
  const _deposit=_geiIsTM?(_tmFields.tmDepositAmt||0):Math.round(total*0.25*100)/100;
  const _typeLabel=_geiIsTM?'Time & Materials Proposal':_geiIsFreeForm?'Custom Proposal':(TRADE_META[trade]?.label||'Trade')+' Proposal';
  if(_geiEditBidId){
    const b=bids.find(x=>x.id===_geiEditBidId);
    if(b){
      b.amount=total;b.type=v('gei-desc')||_typeLabel;
      b.notes=v('gei-notes');b.geiLines=JSON.parse(JSON.stringify(_geiLines));
      b.geiTaxPct=taxPct;b.status=draft?'Draft':'Pending';b.draft=!!draft;
      b.geiDuration=v('gei-duration')||'';b.geiNewWork=_geiNewWork||false;
      b.trade_type=trade;b.deposit=_deposit;b.isFreeForm=_geiIsFreeForm||false;
      if(_geiIsFreeForm&&_byoItems.length)b.byoItems=JSON.parse(JSON.stringify(_byoItems));
      if(_panelSched)b.panelSched=JSON.parse(JSON.stringify(_panelSched));else delete b.panelSched;
      Object.assign(b,_tmFields);
      saveAll();
    }
  } else {
    const newBid={
      id:_newBidId(),client_id:_geiClientId,
      client_name:v('gei-client'),name:v('gei-client'),
      phone:'',addr:v('gei-addr'),
      bid_date:v('gei-date')||todayKey(),
      amount:total,deposit:_deposit,
      type:v('gei-desc')||_typeLabel,
      notes:v('gei-notes'),status:draft?'Draft':'Pending',draft:!!draft,
      isFreeForm:_geiIsFreeForm||false,
      ...(_geiIsFreeForm&&_byoItems.length?{byoItems:JSON.parse(JSON.stringify(_byoItems))}:{}),
      geiLines:JSON.parse(JSON.stringify(_geiLines)),geiTaxPct:taxPct,
      geiDuration:v('gei-duration')||'',geiNewWork:_geiNewWork||false,
      trade_type:trade,...(_panelSched?{panelSched:JSON.parse(JSON.stringify(_panelSched))}:{}),..._tmFields,
    };
    bids.unshift(newBid);_geiEditBidId=newBid.id;saveAll();
  }
  if(!draft)_saveToLineHistory();
  showToast(draft?'Draft saved':'Proposal saved','✅');
  if(!draft)goPg('pg-clients');
}

async function sendGenericProposal(){
  saveGenericEstimate(true); // draft=true skips navigation — modal shows over estimate page
  _saveToLineHistory();
  // Build minimal proposal for sign.html
  if(!supaEnabled()||!_supaUser){zAlert('Sign in to send client links.');return;}
  if(!navigator.onLine){zAlert('You\'re offline — the proposal link can\'t be activated right now.\n\nYour estimate is saved. Once you\'re back online, open this bid and tap Send to send the link to your client.',{title:'No internet connection'});return;}
  if(_stripeConnectStatus===null)_fetchStripeConnectStatus().catch(()=>{});
  const v=id=>document.getElementById(id)?.value||'';
  const{total,sub}=calcGeiTotal();
  const trade=_geiTrade||getActiveTrade();
  const taxPct=parseFloat(v('gei-tax-pct'))||0;
  const bname=escHtml(S.bname||getBusinessName()||'');
  const bphone=escHtml(S.bphone||'');const blic=escHtml(S.blic||'');
  const clientName=escHtml(v('gei-client'));const clientAddr=escHtml(v('gei-addr'));
  const jobDesc=escHtml(v('gei-desc'));const duration=escHtml(v('gei-duration'));
  const tradeName=TRADE_META[trade]?.label||'Service';const tradeIcon=TRADE_META[trade]?.icon||'🔧';
  const estNum=_geiEditBidId?String(_geiEditBidId).slice(-6):'—';
  const dateStr=new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  const totalFmt='$'+total.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const _tmDepPct=parseFloat(v('tm-dep-pct'))||20;
  const _tmDepAmt=_geiIsTM?Math.round(sub*_tmDepPct/100):Math.round(total*0.25*100)/100;
  const _tmNteCap=parseFloat(v('tm-nte-cap'))||0;
  const depositFmt='$'+_tmDepAmt.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const _tmDepRow=_geiIsTM
    ?`<tr style="background:#0369a1;color:rgba(255,255,255,.88)"><td colspan="2" style="padding:6px 18px;font-size:11px;font-weight:600">Mobilization Deposit (${_tmDepPct}%) Due Before Work Begins</td><td style="padding:6px 18px;text-align:right;font-size:12px;font-weight:700">${depositFmt}</td></tr>`
    :`<tr style="background:#2a4a7f;color:rgba(255,255,255,.88)"><td colspan="2" style="padding:6px 18px;font-size:11px;font-weight:600">25% Deposit Due Before Work Begins</td><td style="padding:6px 18px;text-align:right;font-size:12px;font-weight:700">${depositFmt}</td></tr>`;
  const _tmPayTerms=_geiIsTM
    ?`<div style="font-size:11px;color:#2d3748;line-height:2"><div>1. <strong>Contract type:</strong> Time &amp; Materials${_tmNteCap?` — not to exceed $${_tmNteCap.toLocaleString()}`:' (T&amp;M)'}</div><div>2. <strong>Mobilization deposit:</strong> ${_tmDepPct}% (${depositFmt}) due before work begins.</div><div>3. <strong>Billing:</strong> ${_tmBillingCycle==='weekly'?'Weekly':'Bi-weekly'} invoices with time sheets and material receipts attached.</div><div>4. <strong>Warranty:</strong> All workmanship warranted for 1 year.</div></div>`
    :`<div style="font-size:11px;color:#2d3748;line-height:2"><div>1. <strong>Deposit:</strong> 25% due before work begins.</div><div>2. <strong>Balance:</strong> Remainder due upon completion.</div><div>3. <strong>Warranty:</strong> All workmanship warranted for 1 year.</div></div>`;
  const _tmPropMarkupMult=(_geiIsTM&&_tmMatMarkup>0)?(1+_tmMatMarkup/100):1;
  const lineRows=_geiLines.filter(l=>l.desc||l.rate).map(l=>{
    let amt=(l.qty||1)*(l.rate||0);
    // For T&M, bake markup into material prices — client never sees the markup percentage
    if(_geiIsTM&&!l._tmLabor)amt=Math.round(amt*_tmPropMarkupMult);
    return `<tr style="border-bottom:1px solid #e2e8f0"><td style="padding:9px 18px;font-size:12px;color:#2d3748">${escHtml(l.desc||'')}${l.qty!==1?`<span style="color:#94a3b8;font-size:11px"> ×${l.qty}</span>`:''}</td><td style="padding:9px 6px;text-align:center;font-size:12px;color:#64748b">${l.qty||1}</td><td style="padding:9px 18px 9px 4px;text-align:right;font-size:12px;font-weight:600;color:#1a365d">$${amt.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td></tr>`;
  }).join('');
  // Suppress markup/tax row for T&M — markup is already in the line prices
  const taxRow=(!_geiIsTM&&taxPct)?`<tr style="border-bottom:1px solid #e2e8f0;background:#f8fafc"><td colspan="2" style="padding:8px 18px;font-size:12px;color:#64748b">Tax / markup (${taxPct}%)</td><td style="padding:8px 18px;text-align:right;font-size:12px;color:#64748b">$${(total*(taxPct/(100+taxPct))).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td></tr>`:'';
  const notesHtml=v('gei-notes')?`<div style="padding:14px 24px;border-top:1px solid #e2e8f0;font-size:12px;color:#4a5568;line-height:1.6"><strong style="color:#1a365d">Notes:</strong> ${escHtml(v('gei-notes'))}</div>`:'';
  let _propPanelHtml='';
  if(_panelSched){
    const {l1:_pl1,l2:_pl2,imbalance:_pimb}=_panelCalcBalance();
    const _pRows=(_panelSched.circuits||[]).map((c,i)=>`<tr><td style="text-align:center;padding:4px 6px;border:1px solid #cbd5e1;font-size:11px">${i+1}</td><td style="padding:4px 8px;border:1px solid #cbd5e1;font-size:11px">${escHtml(c.desc||'—')}</td><td style="text-align:center;padding:4px 6px;border:1px solid #cbd5e1;font-size:11px">${c.amps||''}A</td><td style="text-align:center;padding:4px 6px;border:1px solid #cbd5e1;font-size:11px">${c.phase==='2pole'?'2-pole':c.phase}</td><td style="text-align:center;padding:4px 6px;border:1px solid #cbd5e1;font-size:11px">${escHtml(c.gauge||'')}</td><td style="text-align:center;padding:4px 6px;border:1px solid #cbd5e1;font-size:11px">${c.afci?'✓':''}</td><td style="text-align:center;padding:4px 6px;border:1px solid #cbd5e1;font-size:11px">${c.gfci?'✓':''}</td></tr>`).join('');
    _propPanelHtml=`<div style="padding:16px 24px;border-top:2px solid #e2e8f0"><div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#1a365d;margin-bottom:10px">📋 Panel Schedule — ${_panelSched.panelAmps}A</div><p style="font-size:11px;color:#64748b;margin:0 0 8px">L1 leg: ${_pl1}A · L2 leg: ${_pl2}A${_pimb>0.10?' · <strong style="color:#dc2626">⚠️ Rebalance recommended</strong>':' · ✓ Balanced'}</p><table style="width:100%;border-collapse:collapse"><thead><tr><th style="background:#1a365d;color:#fff;padding:5px 6px;border:1px solid #cbd5e1;font-size:10px">#</th><th style="background:#1a365d;color:#fff;padding:5px 8px;border:1px solid #cbd5e1;text-align:left;font-size:10px">Circuit</th><th style="background:#1a365d;color:#fff;padding:5px 6px;border:1px solid #cbd5e1;font-size:10px">Amps</th><th style="background:#1a365d;color:#fff;padding:5px 6px;border:1px solid #cbd5e1;font-size:10px">Phase</th><th style="background:#1a365d;color:#fff;padding:5px 6px;border:1px solid #cbd5e1;font-size:10px">Wire</th><th style="background:#1a365d;color:#fff;padding:5px 6px;border:1px solid #cbd5e1;font-size:10px">AFCI</th><th style="background:#1a365d;color:#fff;padding:5px 6px;border:1px solid #cbd5e1;font-size:10px">GFCI</th></tr></thead><tbody>${_pRows}</tbody></table></div>`;
  }
  const _hdrLabel=_geiIsTM?'⏱️ Time &amp; Materials':tradeIcon+' Service Proposal';
  const _nteRow=(_geiIsTM&&_tmNteCap)?`<tr style="background:#075985;color:rgba(255,255,255,.8)"><td colspan="2" style="padding:5px 18px;font-size:11px">Not-to-exceed cap</td><td style="padding:5px 18px;text-align:right;font-size:11px;font-weight:700">$${_tmNteCap.toLocaleString()}</td></tr>`:'';
  const proposalHtml=`<div style="background:#fff;color:#1a1a1a;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 4px 24px rgba(0,0,0,.10)"><div style="background:linear-gradient(135deg,#1a365d 0%,#2a4a7f 100%);color:#fff;padding:20px 24px;display:flex;justify-content:space-between;align-items:flex-start"><div><div style="font-size:18px;font-weight:800">${bname}</div>${bphone?`<div style="font-size:12px;opacity:.7;margin-top:3px">${bphone}</div>`:''}${blic?`<div style="font-size:11px;opacity:.6;margin-top:2px">Lic# ${blic}</div>`:''}</div><div style="text-align:right"><div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.12em;opacity:.9">${_hdrLabel}</div><div style="font-size:11px;opacity:.6;margin-top:6px"># ${estNum}</div><div style="font-size:11px;opacity:.6">Date: ${dateStr}</div></div></div><div style="display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid #e2e8f0"><div style="padding:14px 18px;border-right:1px solid #e2e8f0"><div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;margin-bottom:6px">Customer</div><div style="font-size:14px;font-weight:700;color:#1a365d">${clientName}</div>${clientAddr?`<div style="font-size:12px;color:#4a5568;margin-top:4px">${clientAddr}</div>`:''}</div><div style="padding:14px 18px"><div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;margin-bottom:6px">Project</div><div style="font-size:13px;font-weight:600;color:#1a365d">${jobDesc||tradeName+' service'}</div>${duration?`<div style="font-size:11px;color:#718096;margin-top:5px">Est. duration: ${duration}</div>`:''}<div style="font-size:11px;color:#718096;margin-top:3px">Valid 30 days</div></div></div><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:#f1f5f9;border-bottom:2px solid #e2e8f0"><th style="padding:8px 18px;text-align:left;font-weight:800;text-transform:uppercase;color:#64748b;font-size:9px;letter-spacing:.08em">Description</th><th style="padding:8px 6px;text-align:center;font-weight:800;text-transform:uppercase;color:#64748b;font-size:9px;letter-spacing:.08em;width:40px">Qty</th><th style="padding:8px 18px 8px 4px;text-align:right;font-weight:800;text-transform:uppercase;color:#64748b;font-size:9px;letter-spacing:.08em;width:90px">Amount</th></tr></thead><tbody>${lineRows}</tbody><tfoot>${taxRow}<tr style="background:#1a365d;color:#fff"><td colspan="2" style="padding:12px 18px;font-weight:800;font-size:15px">${_geiIsTM?'ESTIMATED TOTAL':'TOTAL'}</td><td style="padding:12px 18px;text-align:right;font-weight:800;font-size:15px">${totalFmt}</td></tr>${_tmDepRow}${_nteRow}</tfoot></table>${notesHtml}${_propPanelHtml}<div style="padding:18px 24px;border-top:2px solid #e2e8f0;background:#f8fafc"><div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#1a365d;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #e2e8f0">Payment Terms</div>${_tmPayTerms}</div></div>`;
  const bidId=_geiEditBidId;
  const token=Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2);
  const proposalKey=`proposals/${_supaUser.id}/${bidId}_${token}.json`;
  const proposalData={
    id:bidId,token,clientName:v('gei-client'),businessName:S.bname||getBusinessName(),
    contractorUserId:_supaUser.id,contractorEmail:_supaUser.email,
    proposalHtml,clientAddr:v('gei-addr'),
    amount:total,deposit:Math.round(total*0.25*100)/100,
    createdAt:new Date().toISOString(),status:'pending',
    notifyEmail:_supaUser.email,businessPhone:S.bphone||'',
    stripeConnectEnabled:!!(_stripeConnectStatus?.charges_enabled),
    trade_type:trade,
  };
  const _uploadRes=await _supa.storage.from('proposals').upload(proposalKey,JSON.stringify(proposalData),{contentType:'application/json',upsert:true}).catch(e=>({error:e}));
  if(_uploadRes?.error){showToast('Upload failed — check connection and try again','error');console.error('[proposal upload]',_uploadRes.error);return;}
  const b=bids.find(x=>x.id===bidId);
  if(b){
    b.signingToken=token;b.proposalKey=proposalKey;
    // Mark Pending now so hub snapshot shows the proposal — _commitProposalSent still
    // fires on Text/Email but is safe to call twice (idempotent status change)
    if(b.status==='Draft'||!b.status)b.status='Pending';
    b.draft=false;
    if(!b.proposalSentDate)b.proposalSentDate=todayKey();
    saveAll();
  }
  const baseUrl=_clientBaseUrl();
  const signingUrl=baseUrl+'sign.html?t='+token+'&u='+_supaUser.id+'&b='+bidId;
  const shortUrl=await shortenUrl(signingUrl);
  const signingDirectUrl=shortUrl||signingUrl;
  let shareUrl=signingDirectUrl;
  if(b?.client_id){
    try{const _hu=await _uploadClientHub(b.client_id);if(_hu)shareUrl=_hu;}catch(e){}
  }
  const bar=document.getElementById('proposal-link-bar');
  const input=document.getElementById('proposal-link-input');
  const _cl=getClientById(b?.client_id);
  if(bar){
    bar.dataset.signingUrl=shareUrl;
    bar.dataset.signingDirectUrl=signingDirectUrl;
    bar.dataset.cname=clientName;
    bar.dataset.bname=bname;
    bar.dataset.cphone=(_cl?.phone||'').replace(/\D/g,'');
    bar.dataset.cemail=_cl?.email||'';
  }
  if(input)input.value=shareUrl;
  _pendingSignToken={bidId,token,proposalKey};
  // Show sharing sheet
  const _gsov=document.createElement('div');
  _gsov.id='_gei-share-ov';
  _gsov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box';
  const _geiShareName=clientName||'Client';
  const _geiShareFirst=_geiShareName.split(' ')[0];
  const _geiShareShort=shareUrl.replace(/^https?:\/\//,'');
  const _geiSharePreview=_geiShareShort.length>44?_geiShareShort.slice(0,44)+'…':_geiShareShort;
  _gsov.innerHTML='<div style="background:#fff;border-radius:14px;width:100%;max-width:480px;padding:20px 16px 24px;max-height:90vh;overflow-y:auto"><div style="text-align:center;margin-bottom:16px"><div style="font-size:15px;font-weight:800;color:var(--text1);margin-bottom:4px">📨 Send to client</div><div style="font-size:13px;color:var(--text2)">'+_geiShareName+' · '+_geiSharePreview+'</div></div><div style="display:flex;flex-direction:column;gap:10px"><button onclick="pwaShare({title:\''+(bname||S.company||'Your Contractor')+' Proposal\',text:\'Hi '+_geiShareFirst+' — '+(bname||S.company||'us')+' sent your estimate. Tap to review and approve.\',url:document.getElementById(\'proposal-link-bar\')?.dataset.signingUrl||document.getElementById(\'proposal-link-input\')?.value||\'\'});document.getElementById(\'_gei-share-ov\')?.remove();" style="width:100%;padding:16px;border-radius:var(--rl);border:none;background:var(--blue);color:#fff;font-size:16px;font-weight:700;cursor:pointer;font-family:inherit">⬆️ Send to client</button><button onclick="document.getElementById(\'_gei-share-ov\')?.remove();goPg(\'pg-clients\')" style="width:100%;padding:14px;border-radius:var(--rl);border:none;background:var(--gray-lt);color:var(--text2);font-size:15px;font-weight:600;cursor:pointer;font-family:inherit">✓ Done</button></div></div>';
  document.body.appendChild(_gsov);
  _gsov.addEventListener('click',e=>{if(e.target===_gsov){_gsov.remove();goPg('pg-clients');}});
  showToast('Proposal link ready — tap to send','🔗');
}
function _geiCopyShareLink(btn){
  const url=_proposalShareData().url;
  if(!url)return;
  navigator.clipboard.writeText(url).catch(()=>{});
  if(btn){btn.textContent='✓ Copied!';setTimeout(()=>btn.textContent='📋 Copy link',2000);}
}

// ─── Industrial Equipment Estimate ──────────────────────────────────────────
let _indPieces=[],_indTier='appearance',_indClientId=null,_indBidId=null,_indClient=null;

function openIndustrialEquipEstimate(c,bidId){
  _indClient=c||null;_indClientId=c?.id||null;_indBidId=bidId||null;
  _indPieces=[];_indTier='appearance';
  if(bidId){const b=bids.find(x=>x.id===bidId);if(b){_indPieces=JSON.parse(JSON.stringify(b.indPieces||[]));_indTier=b.indTier||'appearance';}}
  const ov=document.createElement('div');ov.className='zmodal-overlay';ov.id='ind-equip-ov';
  const box=document.createElement('div');
  box.style.cssText='background:var(--bg);border-radius:var(--rl) var(--rl) 0 0;width:100%;max-width:520px;max-height:92vh;overflow-y:auto;padding-bottom:24px';
  box.id='ind-equip-box';
  ov.appendChild(box);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  _renderIndModal();
}
function _renderIndModal(){
  const box=document.getElementById('ind-equip-box');if(!box)return;
  const c=_indClient;
  const tierHtml=Object.keys(IND_TIERS).map(k=>{
    const t=IND_TIERS[k];const sel=k===_indTier;
    return '<button onclick="_setIndTier(\''+k+'\')" style="padding:10px 8px;border-radius:var(--r);border:2px solid '+(sel?'var(--blue)':'var(--border2)')+';background:'+(sel?'var(--blue-lt)':'var(--bg2)')+';cursor:pointer;font-family:inherit;text-align:left;width:100%">'+
      '<div style="font-size:12px;font-weight:700;color:'+(sel?'var(--blue-dk)':'var(--text)')+'">'+(sel?'✓ ':'')+t.badge+' '+t.name+'</div>'+
      '<div style="font-size:10px;color:var(--text3);margin-top:2px;line-height:1.4">'+t.desc+'</div></button>';
  }).join('');
  const typeOpts=Object.keys(IND_EQUIP_TYPES).map(k=>'<option value="'+k+'">'+IND_EQUIP_TYPES[k].name+'</option>').join('');
  const existingBid=_indBidId?bids.find(x=>x.id===_indBidId):null;
  const savedColor=existingBid?.indColor||'';
  const savedPrimer=existingBid?.indPrimerColor||'';
  const savedFinish=existingBid?.indFinish||'Gloss';
  const savedColorNotes=existingBid?.indColorNotes||'';
  box.innerHTML=
    '<div style="position:sticky;top:0;background:var(--bg);z-index:10;padding:16px 16px 12px;border-bottom:1px solid var(--border)">'+
      '<div style="display:flex;align-items:center;justify-content:space-between">'+
        '<div><div style="font-size:17px;font-weight:800">🏗️ Industrial Equipment</div>'+
          '<div style="font-size:12px;color:var(--text3);margin-top:2px">'+(c?escHtml(c.name):'No client')+'</div></div>'+
        '<button onclick="document.getElementById(\'ind-equip-ov\').remove()" style="width:30px;height:30px;border-radius:50%;border:none;background:var(--bg2);color:var(--text2);font-size:18px;cursor:pointer;font-family:inherit">×</button>'+
      '</div>'+
    '</div>'+
    '<div style="padding:14px 16px 0">'+

    // ── AI Scope Helper ──
    '<div style="margin-bottom:14px;padding:12px;background:linear-gradient(135deg,#fffbeb,#fff7ed);border-radius:var(--r);border:1.5px solid #fed7aa">'+
      '<div style="font-size:11px;font-weight:800;color:#c2410c;margin-bottom:8px;display:flex;align-items:center;gap:6px">'+
        '<span>✨</span> AI Scope Helper'+
        '<span style="font-size:10px;font-weight:500;color:#9a3412;margin-left:4px">— describe what you see, we\'ll suggest the equipment</span>'+
      '</div>'+
      '<textarea id="ind-desc-inp" rows="2" placeholder="e.g. Two small drum dryers, a baghouse, and the control house — heavy rust on dryers, last painted 5+ years ago" style="width:100%;box-sizing:border-box;padding:9px 10px;border:1.5px solid #fed7aa;border-radius:var(--r);background:#fff;color:var(--text);font-size:12px;font-family:inherit;resize:vertical;margin-bottom:8px"></textarea>'+
      '<div style="display:flex;align-items:center;gap:8px">'+
        '<button onclick="_indAiSuggest()" style="padding:8px 14px;border-radius:var(--r);border:none;background:#c2410c;color:#fff;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;flex-shrink:0">Find equipment →</button>'+
        '<div id="ind-desc-suggestions" style="flex:1;font-size:11px;color:var(--text3)">Describe the job and tap Find →</div>'+
      '</div>'+
    '</div>'+

    // ── Coating Tier ──
    '<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:var(--text3);margin-bottom:8px">Coating Tier</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px;margin-bottom:10px">'+tierHtml+'</div>'+
    '<div style="font-size:10px;color:var(--text3);margin-bottom:14px;padding:7px 10px;background:var(--bg2);border-radius:var(--r)">'+
      '<strong style="color:var(--text2)">Products:</strong> '+IND_TIERS[_indTier].products+'</div>'+

    // ── Equipment picker ──
    '<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:var(--text3);margin-bottom:8px">Add Equipment Pieces</div>'+
    '<div style="display:grid;grid-template-columns:1fr 60px auto;gap:8px;align-items:center;margin-bottom:6px">'+
      '<select id="ind-type-sel" onchange="_indTypeChange()" style="padding:9px 8px;border:1.5px solid var(--border2);border-radius:var(--r);background:var(--bg2);color:var(--text);font-size:12px;font-family:inherit">'+typeOpts+'</select>'+
      '<input id="ind-qty" type="number" value="1" min="1" max="99" style="padding:9px 6px;border:1.5px solid var(--border2);border-radius:var(--r);background:var(--bg2);color:var(--text);font-size:13px;font-family:inherit;text-align:center">'+
      '<button onclick="_addIndPiece()" style="padding:9px 12px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap">+ Add</button>'+
    '</div>'+
    '<div id="ind-custom-sqft-row" style="display:none;margin-bottom:8px">'+
      '<input id="ind-custom-sqft" type="number" placeholder="Enter square footage for this piece" min="1" style="width:100%;box-sizing:border-box;padding:9px 10px;border:1.5px solid var(--border2);border-radius:var(--r);background:var(--bg2);color:var(--text);font-size:13px;font-family:inherit">'+
    '</div>'+
    '<div id="ind-pieces-list" style="margin-bottom:14px"></div>'+
    '<div id="ind-result-card"></div>'+

    // ── Notes ──
    '<div style="margin-top:14px">'+
      '<div style="font-size:10px;font-weight:700;color:var(--text3);margin-bottom:5px;text-transform:uppercase;letter-spacing:.06em">Notes / Access concerns</div>'+
      '<textarea id="ind-notes" rows="2" placeholder="e.g. Equipment in use until Friday, man-lift already on site" style="width:100%;box-sizing:border-box;padding:9px 10px;border:1.5px solid var(--border2);border-radius:var(--r);background:var(--bg2);color:var(--text);font-size:13px;font-family:inherit;resize:vertical"></textarea>'+
    '</div>'+

    // ── Paint & Color Specs ──
    '<div style="margin-top:14px;padding:12px;background:var(--bg2);border-radius:var(--r);border:1px solid var(--border2)">'+
      '<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:var(--text3);margin-bottom:10px">🎨 Paint & Color Specs</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">'+
        '<div>'+
          '<div style="font-size:11px;font-weight:600;color:var(--text2);margin-bottom:4px">Topcoat color</div>'+
          '<input id="ind-color" value="'+escHtml(savedColor)+'" placeholder="e.g. Bettis Red, Black, RAL 7016" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid var(--border2);border-radius:var(--r);background:var(--bg);color:var(--text);font-size:12px;font-family:inherit">'+
        '</div>'+
        '<div>'+
          '<div style="font-size:11px;font-weight:600;color:var(--text2);margin-bottom:4px">Finish</div>'+
          '<select id="ind-finish" style="width:100%;padding:8px 8px;border:1.5px solid var(--border2);border-radius:var(--r);background:var(--bg);color:var(--text);font-size:12px;font-family:inherit">'+
            ['Gloss','Semi-Gloss','Satin','Flat/Matte','Industrial Gloss'].map(f=>'<option'+(f===savedFinish?' selected':'')+'>'+f+'</option>').join('')+
          '</select>'+
        '</div>'+
      '</div>'+
      '<div style="margin-bottom:10px">'+
        '<div style="font-size:11px;font-weight:600;color:var(--text2);margin-bottom:4px">Primer / base coat</div>'+
        '<input id="ind-primer-color" value="'+escHtml(savedPrimer)+'" placeholder="'+escHtml(IND_TIERS[_indTier].products.split('→')[0]?.trim()||'Per spec')+'" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid var(--border2);border-radius:var(--r);background:var(--bg);color:var(--text);font-size:12px;font-family:inherit">'+
      '</div>'+
      '<div>'+
        '<div style="font-size:11px;font-weight:600;color:var(--text2);margin-bottom:4px">Color matching / special notes</div>'+
        '<input id="ind-color-notes" value="'+escHtml(savedColorNotes)+'" placeholder="e.g. Match fleet color, client providing color sample" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid var(--border2);border-radius:var(--r);background:var(--bg);color:var(--text);font-size:12px;font-family:inherit">'+
      '</div>'+
    '</div>'+

    // ── Actions ──
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px">'+
      '<button onclick="_saveIndBid()" style="padding:14px;border-radius:var(--r);border:1.5px solid var(--border2);background:var(--bg2);color:var(--text2);font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">💾 Save Draft</button>'+
      '<button onclick="_sendIndProposal()" style="padding:14px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">🔗 Save & Send to Client</button>'+
    '</div>'+
    '</div>';
  _renderIndPieces();_renderIndResult();
}
function _indAiSuggest(){
  const text=(document.getElementById('ind-desc-inp')?.value||'').toLowerCase();
  const suggEl=document.getElementById('ind-desc-suggestions');if(!suggEl)return;
  if(text.trim().length<5){suggEl.innerHTML='<span style="color:var(--text3)">Add more detail and try again</span>';return;}
  const found=[];
  for(const[typeKey,words]of Object.entries(IND_KEYWORDS)){
    if(words.some(w=>text.includes(w)))found.push(typeKey);
  }
  if(!found.length){suggEl.innerHTML='<span style="color:var(--text3)">No matches — try: drum dryer, silo, baghouse, conveyor, crane, tank…</span>';return;}
  suggEl.innerHTML='<div style="font-size:10px;color:var(--text3);margin-bottom:6px">Tap to add:</div>'+
    found.map(k=>'<button onclick="_addIndFromSuggest(\''+k+'\')" style="padding:5px 10px;border-radius:20px;border:1.5px solid #c2410c;background:#fff7ed;color:#c2410c;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;margin:2px 3px 2px 0">+'+escHtml(IND_EQUIP_TYPES[k].name)+'</button>').join('');
}
function _addIndFromSuggest(typeKey){
  const typ=IND_EQUIP_TYPES[typeKey];if(!typ)return;
  let sqft=typ.sqft;
  if(!sqft){sqft=parseInt(prompt('Square footage for '+typ.name+' (estimate OK):')||'0');if(!sqft)return;}
  _indPieces.push({typeKey,qty:1,sqft,name:typ.name,lift:typ.lift,note:typ.note});
  _renderIndPieces();_renderIndResult();
}
function _indTypeChange(){
  const sel=document.getElementById('ind-type-sel');if(!sel)return;
  const typ=IND_EQUIP_TYPES[sel.value];
  const row=document.getElementById('ind-custom-sqft-row');
  if(row)row.style.display=(typ&&typ.sqft===0)?'':'none';
}
function _setIndTier(k){_indTier=k;_renderIndModal();}
function _addIndPiece(){
  const sel=document.getElementById('ind-type-sel');if(!sel)return;
  const typeKey=sel.value;const typ=IND_EQUIP_TYPES[typeKey];if(!typ)return;
  const qty=Math.max(1,parseInt(document.getElementById('ind-qty')?.value)||1);
  let sqft=typ.sqft;
  if(sqft===0){
    sqft=parseInt(document.getElementById('ind-custom-sqft')?.value)||0;
    if(!sqft){showToast('Enter square footage for this piece','⚠️');return;}
  }
  _indPieces.push({typeKey,qty,sqft,name:typ.name,lift:typ.lift,note:typ.note});
  _renderIndPieces();_renderIndResult();
}
function _removeIndPiece(i){_indPieces.splice(i,1);_renderIndPieces();_renderIndResult();}
function _renderIndPieces(){
  const el=document.getElementById('ind-pieces-list');if(!el)return;
  if(!_indPieces.length){el.innerHTML='<div style="font-size:12px;color:var(--text3);padding:8px 0;text-align:center;border:1.5px dashed var(--border2);border-radius:var(--r)">No equipment added yet — use the helper above or select a type</div>';return;}
  el.innerHTML='<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:6px">Equipment list</div>'+
    _indPieces.map((p,i)=>{
      const totalSqft=p.qty*p.sqft;
      return '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:var(--bg2);border-radius:var(--r);margin-bottom:5px;border:1px solid var(--border)">'+
        '<div style="min-width:0;flex:1">'+
          '<div style="font-size:12px;font-weight:700;color:var(--text)">'+(p.qty>1?p.qty+'× ':'')+p.name+'</div>'+
          '<div style="font-size:10px;color:var(--text3);margin-top:1px">'+
            (totalSqft?'~'+totalSqft.toLocaleString()+' sq ft':'custom sq ft')+
            (p.lift?' · <span style="color:#c2410c;font-weight:600">⚠️ Lift needed</span>':'')+
            (p.note?' · '+escHtml(p.note):'')+
          '</div>'+
        '</div>'+
        '<button onclick="_removeIndPiece('+i+')" style="flex-shrink:0;margin-left:10px;background:none;border:none;color:var(--text3);font-size:18px;cursor:pointer;font-family:inherit;padding:0 4px">×</button>'+
      '</div>';
    }).join('');
}
function _calcInd(){
  const tier=IND_TIERS[_indTier];
  const totalSqft=_indPieces.reduce((s,p)=>s+p.qty*p.sqft,0);
  if(!totalSqft)return null;
  const prepSqft=_indPieces.reduce((s,p)=>s+p.qty*p.sqft*(IND_EQUIP_TYPES[p.typeKey]?.prepRatio||0.4),0);
  const prepManDays=prepSqft/tier.prepRate;
  const paintManDays=(totalSqft*tier.coats)/tier.paintRate;
  const totalManDays=prepManDays+paintManDays;
  let crew=1;
  if(totalManDays>3)crew=2;
  if(totalManDays>8)crew=3;
  if(totalManDays>18)crew=4;
  const calDays=Math.ceil(totalManDays/crew);
  const matCost=Math.round(totalSqft*tier.matPerSqft);
  const laborCost=Math.round(totalManDays*tier.laborRate);
  const totalMid=matCost+laborCost;
  const liftNeeded=_indPieces.some(p=>p.lift);
  const flags=[..._indPieces.reduce((s,p)=>{if(p.note)s.add(p.note);return s;},new Set())];
  return{totalSqft,prepManDays,paintManDays,totalManDays,crew,calDays,matCost,laborCost,
    totalLow:Math.round(totalMid*0.90),totalHigh:Math.round(totalMid*1.15),liftNeeded,flags};
}
function _renderIndResult(){
  const el=document.getElementById('ind-result-card');if(!el)return;
  const r=_calcInd();
  if(!r){
    el.innerHTML='<div style="padding:14px;background:var(--bg2);border-radius:var(--r);text-align:center;font-size:12px;color:var(--text3)">Add equipment above to see the estimate</div>';
    return;
  }
  const crewLabel=r.crew===1?'Solo — you handle it':r.crew===2?'You + 1 helper needed':r.crew===3?'3-person crew needed':'Full 4-person crew';
  const crewColor=r.crew===1?'#16a34a':r.crew===2?'#2563eb':r.crew>=3?'#d97706':'#1a1a1a';
  const liftLine=r.liftNeeded?'<div style="margin-top:6px;padding:7px 10px;background:#fff7ed;border-radius:var(--r);font-size:11px;color:#c2410c;font-weight:600">⚠️ Man-lift rental likely needed (~$350/day) — add as line item if not on site</div>':'';
  const scaffLine=r.flags.some(f=>f&&f.includes('Scaffolding'))?'<div style="margin-top:6px;padding:7px 10px;background:#fef9c3;border-radius:var(--r);font-size:11px;color:#854d0e;font-weight:600">🏗️ Scaffolding may be needed on one or more pieces — verify on-site</div>':'';
  el.innerHTML=
    '<div style="background:linear-gradient(135deg,#1a365d 0%,#2a4a7f 100%);border-radius:var(--r);padding:16px;color:#fff">'+
      '<div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;opacity:.7;margin-bottom:10px">Estimate Summary</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">'+
        '<div><div style="font-size:10px;opacity:.65">Surface area</div><div style="font-size:20px;font-weight:800">'+r.totalSqft.toLocaleString()+'<span style="font-size:11px;font-weight:400;opacity:.8"> sq ft</span></div></div>'+
        '<div><div style="font-size:10px;opacity:.65">Duration</div><div style="font-size:20px;font-weight:800">'+r.calDays+'–'+(r.calDays+1)+'<span style="font-size:11px;font-weight:400;opacity:.8"> days</span></div></div>'+
        '<div><div style="font-size:10px;opacity:.65">Materials</div><div style="font-size:15px;font-weight:700">'+fmt(r.matCost)+'</div></div>'+
        '<div><div style="font-size:10px;opacity:.65">Labor</div><div style="font-size:15px;font-weight:700">'+fmt(r.laborCost)+'</div></div>'+
      '</div>'+
      '<div style="border-top:1px solid rgba(255,255,255,.2);padding-top:10px;margin-bottom:10px">'+
        '<div style="font-size:10px;opacity:.65;margin-bottom:3px">Crew</div>'+
        '<div style="font-size:14px;font-weight:800">'+crewLabel+'</div>'+
      '</div>'+
      '<div style="border-top:1px solid rgba(255,255,255,.2);padding-top:12px">'+
        '<div style="font-size:10px;opacity:.65;margin-bottom:4px">Bid range</div>'+
        '<div style="font-size:24px;font-weight:800">'+fmt(r.totalLow)+' – '+fmt(r.totalHigh)+'</div>'+
        '<div style="font-size:10px;opacity:.55;margin-top:2px">25% deposit = '+fmt(Math.round((r.totalLow+r.totalHigh)/2*0.25))+'</div>'+
      '</div>'+
    '</div>'+
    liftLine+scaffLine;
}
function _indReadColorFields(){
  return{
    color:(document.getElementById('ind-color')?.value||'').trim(),
    primerColor:(document.getElementById('ind-primer-color')?.value||'').trim(),
    finish:document.getElementById('ind-finish')?.value||'Gloss',
    colorNotes:(document.getElementById('ind-color-notes')?.value||'').trim(),
    notes:(document.getElementById('ind-notes')?.value||'').trim(),
  };
}
function _saveIndBid(silent){
  if(!_indPieces.length){if(!silent)showToast('Add at least one piece of equipment','⚠️');return false;}
  const r=_calcInd();if(!r)return false;
  const c=getClientById(_indClientId);
  const{color,primerColor,finish,colorNotes,notes}=_indReadColorFields();
  const midPrice=Math.round((r.totalLow+r.totalHigh)/2);
  const bidData={
    id:_indBidId||_newBidId(),client_id:_indClientId,client_name:c?.name||'',
    bid_date:todayKey(),amount:midPrice,deposit:Math.round(midPrice*0.25),
    type:'Industrial Equipment Coating',trade_type:'painting',status:'Pending',draft:true,
    notes,indPieces:_indPieces,indTier:_indTier,indResult:r,
    indColor:color,indPrimerColor:primerColor,indFinish:finish,indColorNotes:colorNotes,
  };
  if(_indBidId){const idx=bids.findIndex(x=>x.id===_indBidId);if(idx>=0)bids[idx]={...bids[idx],...bidData};}
  else{bids.unshift(bidData);_indBidId=bidData.id;}
  saveAll();
  if(!silent){
    document.getElementById('ind-equip-ov')?.remove();
    showToast('Industrial bid saved','💾');
    if(document.getElementById('cdt-bids-content')?.style.display!=='none')setTimeout(()=>renderCDBids(),100);
  }
  return true;
}
async function _sendIndProposal(){
  if(!_saveIndBid(true))return; // save first, bail if no pieces
  if(!supaEnabled()||!_supaUser){zAlert('Sign in to send client links.');return;}
  if(!navigator.onLine){zAlert('You\'re offline — the proposal link can\'t be activated right now.\n\nYour estimate is saved. Once you\'re back online, open this bid and tap Send to send the link to your client.',{title:'No internet connection'});return;}
  const r=_calcInd();
  const c=_indClient;
  const{color,primerColor,finish,colorNotes,notes}=_indReadColorFields();
  const tier=IND_TIERS[_indTier];
  const bname=escHtml(S.bname||getBusinessName()||'');
  const bphone=escHtml(S.bphone||'');const blic=escHtml(S.blic||'');
  const clientName=escHtml(c?.name||'');const clientAddr=escHtml(c?.addr||'');
  const dateStr=new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  const estNum=String(_indBidId).slice(-6);
  const midPrice=Math.round((r.totalLow+r.totalHigh)/2);
  const totalFmt='$'+midPrice.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const depositFmt='$'+Math.round(midPrice*0.25).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const rangeStr='$'+r.totalLow.toLocaleString()+' – $'+r.totalHigh.toLocaleString();
  const crewLabel=r.crew===1?'Solo':r.crew===2?'2-Person':r.crew===3?'3-Person':'4-Person';
  const resolvedPrimer=primerColor||(tier.products.split('→')[0]?.trim()||'Per spec');
  const resolvedTopcoat=color||(tier.products.split('→')[1]?.trim()||'Per spec');
  const equipRows=_indPieces.map(p=>{
    const totalSqft=p.qty*p.sqft;
    return `<tr style="border-bottom:1px solid #e2e8f0"><td style="padding:9px 14px;font-size:12px;font-weight:600;color:#2d3748">${escHtml(p.name)}</td><td style="padding:9px 8px;text-align:center;font-size:12px;color:#64748b">${p.qty}</td><td style="padding:9px 8px;text-align:right;font-size:12px;color:#64748b">${totalSqft?totalSqft.toLocaleString():'-'}</td><td style="padding:9px 14px;font-size:11px;color:#94a3b8">${escHtml(p.note||'')}${p.lift?' ⚠️ Lift':''}${p.note&&p.lift?' / ':''}</td></tr>`;
  }).join('');
  const liftWarning=r.liftNeeded?'<div style="padding:10px 18px;background:#fff7ed;border-bottom:1px solid #fed7aa;font-size:11px;color:#c2410c;font-weight:600">⚠️ Man-lift rental likely required (~$350/day) — verify availability before scheduling</div>':'';
  const notesSection=notes?`<div style="padding:14px 24px;border-top:1px solid #e2e8f0;font-size:12px;color:#4a5568;line-height:1.6"><strong style="color:#7c2d12">Site Notes:</strong> ${escHtml(notes)}</div>`:'';
  const proposalHtml=`<div style="background:#fff;color:#1a1a1a;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 4px 24px rgba(0,0,0,.10)"><div style="background:linear-gradient(135deg,#7c2d12 0%,#c2410c 100%);color:#fff;padding:20px 24px;display:flex;justify-content:space-between;align-items:flex-start"><div><div style="font-size:18px;font-weight:800">${bname}</div>${bphone?`<div style="font-size:12px;opacity:.7;margin-top:3px">${bphone}</div>`:''}${blic?`<div style="font-size:11px;opacity:.6;margin-top:2px">Lic# ${blic}</div>`:''}</div><div style="text-align:right"><div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.12em;opacity:.9">🏗️ Industrial Coating Estimate</div><div style="font-size:11px;opacity:.6;margin-top:6px"># ${estNum}</div><div style="font-size:11px;opacity:.6">Date: ${dateStr}</div></div></div><div style="display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid #e2e8f0"><div style="padding:14px 18px;border-right:1px solid #e2e8f0"><div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;margin-bottom:6px">Customer</div><div style="font-size:14px;font-weight:700;color:#7c2d12">${clientName}</div>${clientAddr?`<div style="font-size:12px;color:#4a5568;margin-top:4px">${clientAddr}</div>`:''}</div><div style="padding:14px 18px"><div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;margin-bottom:6px">Project</div><div style="font-size:13px;font-weight:600;color:#7c2d12">Industrial Equipment Coating</div><div style="font-size:11px;color:#718096;margin-top:3px">${tier.badge} ${tier.name} Specification</div><div style="font-size:11px;color:#718096;margin-top:2px">Valid 30 days from date above</div></div></div><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:#f1f5f9;border-bottom:2px solid #e2e8f0"><th style="padding:8px 14px;text-align:left;font-weight:800;text-transform:uppercase;color:#64748b;font-size:9px;letter-spacing:.08em">Equipment</th><th style="padding:8px 8px;text-align:center;font-weight:800;text-transform:uppercase;color:#64748b;font-size:9px;width:40px">Qty</th><th style="padding:8px 8px;text-align:right;font-weight:800;text-transform:uppercase;color:#64748b;font-size:9px;width:72px">~Sq Ft</th><th style="padding:8px 14px;text-align:left;font-weight:800;text-transform:uppercase;color:#64748b;font-size:9px">Notes</th></tr></thead><tbody>${equipRows}</tbody></table><div style="padding:14px 18px;border-top:1px solid #e2e8f0;background:#fafafa"><div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#7c2d12;margin-bottom:8px">Coating Specification</div><div style="font-size:12px;color:#374151;line-height:1.9"><div><strong>Prep method:</strong> ${escHtml(tier.desc)}</div><div><strong>Primer:</strong> ${escHtml(resolvedPrimer)}</div><div><strong>Topcoat:</strong> ${escHtml(resolvedTopcoat)}</div><div><strong>Finish:</strong> ${escHtml(finish)}</div>${colorNotes?`<div><strong>Color notes:</strong> ${escHtml(colorNotes)}</div>`:''}</div></div><div style="display:grid;grid-template-columns:1fr 1fr 1fr;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0"><div style="padding:12px 14px;border-right:1px solid #e2e8f0"><div style="font-size:10px;color:#94a3b8;margin-bottom:3px">Surface Area</div><div style="font-size:16px;font-weight:800;color:#374151">${r.totalSqft.toLocaleString()} sqft</div></div><div style="padding:12px 14px;border-right:1px solid #e2e8f0"><div style="font-size:10px;color:#94a3b8;margin-bottom:3px">Duration</div><div style="font-size:16px;font-weight:800;color:#374151">${r.calDays}–${r.calDays+1} days</div></div><div style="padding:12px 14px"><div style="font-size:10px;color:#94a3b8;margin-bottom:3px">Crew</div><div style="font-size:16px;font-weight:800;color:#374151">${crewLabel}</div></div></div>${liftWarning}<table style="width:100%;border-collapse:collapse"><tr style="background:#7c2d12;color:#fff"><td style="padding:12px 18px;font-weight:800;font-size:13px">ESTIMATE RANGE</td><td style="padding:12px 18px;text-align:right;font-weight:800;font-size:14px">${rangeStr}</td></tr><tr style="background:#c2410c;color:rgba(255,255,255,.88)"><td style="padding:7px 18px;font-size:12px;font-weight:800">MIDPOINT BID</td><td style="padding:7px 18px;text-align:right;font-size:13px;font-weight:800">${totalFmt}</td></tr><tr style="background:#9a3412;color:rgba(255,255,255,.85)"><td style="padding:6px 18px;font-size:11px;font-weight:600">25% Deposit Due Before Work Begins</td><td style="padding:6px 18px;text-align:right;font-size:12px;font-weight:700">${depositFmt}</td></tr></table>${notesSection}<div style="padding:18px 24px;border-top:2px solid #e2e8f0;background:#f8fafc"><div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#7c2d12;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #e2e8f0">Payment Terms</div><div style="font-size:11px;color:#2d3748;line-height:2"><div>1. <strong>Deposit:</strong> 25% due before work begins.</div><div>2. <strong>Balance:</strong> Remainder due upon completion.</div><div>3. <strong>Warranty:</strong> All workmanship warranted for 1 year.</div></div></div></div>`;
  const token=Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2);
  const proposalKey=`proposals/${_supaUser.id}/${_indBidId}_${token}.json`;
  const proposalData={
    id:_indBidId,token,clientName:c?.name||'',businessName:S.bname||getBusinessName(),
    contractorUserId:_supaUser.id,contractorEmail:_supaUser.email,
    proposalHtml,clientAddr:c?.addr||'',amount:midPrice,deposit:Math.round(midPrice*0.25),
    createdAt:new Date().toISOString(),status:'pending',notifyEmail:_supaUser.email,
    businessPhone:S.bphone||'',stripeConnectEnabled:!!(_stripeConnectStatus?.charges_enabled),
    trade_type:'painting',
  };
  showToast('Uploading proposal…','⏳');
  await _supa.storage.from('proposals').upload(proposalKey,JSON.stringify(proposalData),{contentType:'application/json',upsert:true}).catch(e=>console.error('[ind proposal upload]',e));
  const b=bids.find(x=>x.id===_indBidId);
  if(b){b.signingToken=token;b.proposalKey=proposalKey;b.proposalHtml=proposalHtml;saveAll();}
  const baseUrl=_clientBaseUrl();
  const signingUrl=baseUrl+'sign.html?t='+token+'&u='+_supaUser.id+'&b='+_indBidId;
  const shortUrl=await shortenUrl(signingUrl).catch(()=>null);
  const shareUrl=shortUrl||signingUrl;
  try{await navigator.clipboard.writeText(shareUrl);}catch(e){}
  document.getElementById('ind-equip-ov')?.remove();
  showToast('Proposal link copied to clipboard — text or email it to the client','🔗');
  if(typeof renderCDBids==='function')setTimeout(renderCDBids,120);
}
// ─── End Industrial Equipment Estimate ───────────────────────────────────────
