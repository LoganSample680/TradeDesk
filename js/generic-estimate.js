function openBidNotes(bidId){
  const b=bids.find(x=>x.id===bidId);if(!b)return;
  editingBidId=bidId;lastCreatedBidId=bidId;
  document.getElementById('_bid-notes-ov')?.remove();
  const ov=document.createElement('div');ov.className='zmodal-overlay';ov.id='_bid-notes-ov';
  const box=document.createElement('div');box.className='zmodal';
  box.style.maxWidth='480px';
  box.innerHTML=
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">'+
      '<div style="font-size:16px;font-weight:800">Bid notes</div>'+
      '<button onclick="this.closest(\'.zmodal-overlay\').remove()" style="border:none;background:none;font-size:22px;cursor:pointer;color:var(--text3);padding:0;line-height:1">'+svgIcon('✕',{size:16})+'</button>'+
    '</div>'+
    '<textarea id="_bid-notes-ta" rows="8" placeholder="Add notes about this bid..." style="width:100%;box-sizing:border-box;padding:12px;font-size:14px;line-height:1.5;border:1px solid var(--border2);border-radius:var(--r);background:var(--bg);color:var(--text);font-family:inherit;resize:vertical;margin-bottom:14px">'+escHtml(b.notes||'')+'</textarea>'+
    '<div style="display:flex;gap:8px">'+
      '<button onclick="this.closest(\'.zmodal-overlay\').remove()" style="flex:1;padding:12px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">Cancel</button>'+
      '<button onclick="_saveBidNotes('+bidId+')" style="flex:2;padding:12px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">Save</button>'+
    '</div>';
  ov.appendChild(box);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  setTimeout(()=>{const ta=document.getElementById('_bid-notes-ta');if(ta){ta.focus();ta.setSelectionRange(ta.value.length,ta.value.length);}},50);
}
function _saveBidNotes(bidId){
  const b=bids.find(x=>x.id===bidId);if(!b)return;
  const ta=document.getElementById('_bid-notes-ta');
  b.notes=(ta?ta.value:'').trim();
  saveAll();
  document.getElementById('_bid-notes-ov')?.remove();
  if(typeof renderClientDetail==='function')try{renderClientDetail();}catch(e){}
  if(typeof renderDash==='function')try{renderDash();}catch(e){}
  showToast('Notes saved','✓');
}
function showNotesFab(){}
function hideNotesFab(){}

function toggleNotesPanel(){}
function notesExpandCanvas(){}
function clearNotesPanel(){}
function _resetNotesForNewEstimate(){}

let hittersFilter='all';
Object.defineProperty(window,'hittersFilter',{get:()=>hittersFilter,set:v=>{hittersFilter=v;},configurable:true});
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
            '<div style="font-size:14px;font-weight:700">'+escHtml(c.name)+'</div>'+
            '<span style="font-size:10px;font-weight:800;padding:2px 6px;border-radius:10px;background:'+tierColor+'22;color:'+tierColor+'">'+tier+'-tier</span>'+
            (isRealtor?'<span style="font-size:10px;font-weight:700;color:var(--amber)">'+svgIcon('🏡',{size:10})+' Realtor</span>':'')+ 
            (isPM?'<span style="font-size:10px;font-weight:700;color:var(--blue)">'+svgIcon('🏢',{size:10})+' PM</span>':'')+
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
          '<a href="mailto:'+escHtml(c.email)+'" onclick="event.stopPropagation()" class="btn btn-sm" style="font-size:11px;text-decoration:none">'+svgIcon('📧',{size:11})+' Email</a>'+
          (c.phone?'<a href="sms:'+c.phone.replace(/\D/g,'')+'" onclick="event.stopPropagation()" class="btn btn-sm" style="font-size:11px;text-decoration:none">'+svgIcon('💬',{size:11})+' Text</a>':'')+ 
        '</div>':
        (c.phone?
          '<div style="margin-top:8px">'+
            '<a href="sms:'+c.phone.replace(/\D/g,'')+'" onclick="event.stopPropagation()" class="btn btn-sm" style="font-size:11px;text-decoration:none">'+svgIcon('💬',{size:11})+' Text</a>'+
          '</div>':'')
      )+
    '</div>';
  }).join('');
}





function applyPermissions(){
  const taxNav=document.getElementById('nb-taxes');
  if(taxNav)taxNav.style.display=canSeeTaxes()?'':'none';
  const mmiTax=document.getElementById('mmi-taxes');
  if(mmiTax)mmiTax.style.display=canSeeTaxes()?'':'none';
  // Every other contractor-only nav item (symmetric hide-for-employee/restore-for-owner):
  // always run so a stale gate from an earlier account in the same tab can't survive a
  // switch to a different account (see _applyEmployeeNavGating for why this must be
  // unconditional, not just called when the incoming account happens to be an employee).
  _applyEmployeeNavGating();
  _renderDevTradeCard();
  // Update nav user section
  const nameEl=document.getElementById('nav-user-name');
  const roleEl=document.getElementById('nav-user-role');
  const avatarEl=document.getElementById('nav-user-avatar');
  const _meta=_supaUser?.user_metadata;
  const _metaName=_meta?.full_name||_meta?.name||'';
  const _rawName=_isEmployee?(_employeeRecord?.name||'Employee'):(getOwnerName()||_metaName||'');
  // Never display an email address as the nav name, fall back to business name
  const name=(_rawName&&!_rawName.includes('@'))?_rawName:(S.bname||'My Account');
  if(nameEl)nameEl.textContent=name;
  if(roleEl)roleEl.textContent=_isEmployee?'Employee':getRole().charAt(0).toUpperCase()+getRole().slice(1);
  if(avatarEl)avatarEl.innerHTML=(name==='My Account'?svgIcon('👤',{size:18}):escHtml(name.charAt(0).toUpperCase()));
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

// ── Scope-of-work chips ───────────────────────────────────────────────
const _GEN_SCOPE=[
  {label:'Demo & removal',icon:'🔨',clientDesc:'Demo and remove existing materials per agreed scope'},
  {label:'Site prep',icon:'🧹',clientDesc:'Prepare and protect work area before work begins'},
  {label:'Haul-off',icon:'🚛',clientDesc:'Remove and dispose of all job debris'},
  {label:'Punch list',icon:'📋',clientDesc:'Final walkthrough and completion of outstanding items'},
];
const TRADE_SCOPE_CHIPS={
  painting:[
    {label:'Interior painting',icon:'🏠',clientDesc:'Walls, ceilings, and trim in agreed rooms'},
    {label:'Exterior painting',icon:'🏡',clientDesc:'All agreed exterior surfaces, siding, trim, and accents'},
    {label:'Cabinet painting',icon:'🗄️',clientDesc:'Prep, prime, and finish coat on cabinet doors and boxes'},
    {label:'Deck / fence stain',icon:'🪵',clientDesc:'Clean and apply semi-transparent or solid stain'},
    {label:'Move furniture',icon:'🪑',clientDesc:'Move and replace furniture as needed for access'},
    {label:'Protect floors',icon:'🛡️',clientDesc:'Canvas or plastic drop cloths on all work surfaces'},
    {label:'Tape & masking',icon:'🎭',clientDesc:'Mask trim, glass, hardware, and fixtures'},
    {label:'Caulking',icon:'💧',clientDesc:'Fill gaps at trim joints and wall/ceiling transitions'},
    {label:'Sanding',icon:'🪚',clientDesc:'Sand surfaces smooth prior to painting'},
    {label:'Spackle & patch',icon:'🔧',clientDesc:'Fill holes, cracks, and imperfections'},
    {label:'Prime coat',icon:'🖌️',clientDesc:'Apply primer to bare surfaces and repairs'},
    {label:'Ceilings',icon:'⬆️',clientDesc:'Two coats on ceiling surfaces'},
    {label:'Trim & doors',icon:'🚪',clientDesc:'Semigloss finish on all trim, doors, and casings'},
    {label:'Popcorn removal',icon:'⚡',clientDesc:'Scrape and smooth textured ceiling surface'},
    {label:'Wallpaper removal',icon:'📜',clientDesc:'Strip existing wallpaper and prepare wall for paint'},
    {label:'Pressure washing',icon:'💦',clientDesc:'Pressure wash exterior surfaces prior to painting'},
    {label:'Scaffolding',icon:'🏗️',clientDesc:'Set up and remove scaffolding for elevated access'},
  ],
  plumbing:[
    {label:'Water heater',icon:'🌊',clientDesc:'Supply and install new water heater unit'},
    {label:'Fixtures',icon:'🚿',clientDesc:'Remove and install bathroom or kitchen fixtures'},
    {label:'Rough-in',icon:'🔩',clientDesc:'Run supply and drain lines per plan'},
    {label:'Supply lines',icon:'💧',clientDesc:'Replace supply lines to fixtures'},
    {label:'Drain / sewer',icon:'🌀',clientDesc:'Clean, repair, or replace drain and sewer lines'},
    {label:'Leak repair',icon:'🔧',clientDesc:'Locate and repair active leaks'},
    {label:'Toilet / bidet',icon:'🪠',clientDesc:'Remove old unit and install new fixture'},
    {label:'Sump pump',icon:'💦',clientDesc:'Install or replace sump pump'},
  ],
  electrical:[
    {label:'Panel upgrade',icon:'⚡',clientDesc:'Replace existing panel and update electrical service'},
    {label:'Outlets & switches',icon:'🔌',clientDesc:'Install or replace outlets and switch plates'},
    {label:'Lighting fixtures',icon:'💡',clientDesc:'Remove and install new lighting fixtures'},
    {label:'EV charger',icon:'🚗',clientDesc:'Install Level 2 EV charging outlet'},
    {label:'Ceiling fans',icon:'🌀',clientDesc:'Install ceiling fan with lighting kit'},
    {label:'Generator hookup',icon:'🔋',clientDesc:'Install transfer switch and connect generator'},
    {label:'Smoke / CO detectors',icon:'🔔',clientDesc:'Install interconnected smoke and CO detectors'},
    {label:'Underground conduit',icon:'🕳️',clientDesc:'Trench and run underground conduit'},
  ],
  hvac:[
    {label:'New AC / furnace',icon:'❄️',clientDesc:'Remove existing unit and install new system'},
    {label:'Ductwork',icon:'🌬️',clientDesc:'Install, repair, or modify duct system'},
    {label:'Mini-split',icon:'🏠',clientDesc:'Install ductless mini-split indoor and outdoor units'},
    {label:'Thermostat',icon:'🌡️',clientDesc:'Install programmable or smart thermostat'},
    {label:'Refrigerant service',icon:'🧊',clientDesc:'Check, recharge, or reclaim refrigerant'},
    {label:'Tankless water heater',icon:'🔥',clientDesc:'Supply and install tankless unit with updated gas line'},
    {label:'Maintenance / tune-up',icon:'🔧',clientDesc:'Full system inspection, cleaning, and calibration'},
  ],
  roofing:[
    {label:'Shingle replacement',icon:'🏠',clientDesc:'Remove old roofing and install new shingles'},
    {label:'Flat / TPO',icon:'🔲',clientDesc:'Install or repair flat roof membrane'},
    {label:'Gutters',icon:'🌧️',clientDesc:'Install or replace gutters and downspouts'},
    {label:'Flashing',icon:'⚡',clientDesc:'Replace or seal flashing at penetrations and transitions'},
    {label:'Skylight',icon:'🌞',clientDesc:'Install or replace skylight with new flashing kit'},
    {label:'Soffit & fascia',icon:'🏗️',clientDesc:'Replace damaged soffit and fascia boards'},
    {label:'Chimney / cap',icon:'🧱',clientDesc:'Repair, reline, or cap chimney'},
  ],
  landscaping:[
    {label:'Mow & edge',icon:'🌿',clientDesc:'Mow lawn and edge along all borders'},
    {label:'Mulch & beds',icon:'🌸',clientDesc:'Install fresh mulch in all planting beds'},
    {label:'Tree / shrub trim',icon:'✂️',clientDesc:'Shape and trim trees and shrubs'},
    {label:'Irrigation',icon:'💧',clientDesc:'Install, repair, or adjust irrigation system'},
    {label:'Sod / seeding',icon:'🌱',clientDesc:'Grade and install new sod or seed lawn'},
    {label:'Hardscape',icon:'🪨',clientDesc:'Install pavers, stone, or concrete features'},
    {label:'Leaf / debris cleanup',icon:'🍂',clientDesc:'Blow, rake, and remove leaves and debris'},
  ],
  general:[
    {label:'Framing',icon:'🏗️',clientDesc:'Rough framing per structural plans'},
    {label:'Drywall',icon:'🧱',clientDesc:'Hang, tape, mud, and finish drywall'},
    {label:'Windows & doors',icon:'🪟',clientDesc:'Install new windows and/or exterior doors'},
    {label:'Insulation',icon:'🔥',clientDesc:'Install batt, blown, or foam insulation'},
    {label:'Trim / finish',icon:'🪵',clientDesc:'Install interior trim, casings, and base'},
    {label:'Power washing',icon:'🚿',clientDesc:'Pressure wash surfaces prior to work'},
    {label:'Fencing',icon:'🚧',clientDesc:'Install new fence with posts and hardware'},
    {label:'Concrete',icon:'⬜',clientDesc:'Form, pour, and finish concrete per plan'},
  ],
  other:[
    {label:'Framing',icon:'🏗️',clientDesc:'Rough framing per structural plans'},
    {label:'Drywall',icon:'🧱',clientDesc:'Hang, tape, mud, and finish drywall'},
    {label:'Tile work',icon:'⬜',clientDesc:'Install or replace tile on floors or walls'},
    {label:'Windows & doors',icon:'🪟',clientDesc:'Install new windows and/or exterior doors'},
    {label:'Trim / finish',icon:'🪵',clientDesc:'Install interior trim, casings, and base'},
    {label:'Power washing',icon:'🚿',clientDesc:'Pressure wash surfaces prior to work'},
    {label:'Fencing',icon:'🚧',clientDesc:'Install new fence with posts and hardware'},
  ],
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
    return`<button onclick="setActiveTrade('${t}')" style="padding:4px 8px;border-radius:20px;border:1px solid ${sel?'var(--blue)':'rgba(255,255,255,.15)'};background:${sel?'var(--blue)':'rgba(255,255,255,.06)'};color:${sel?'#fff':'rgba(255,255,255,.55)'};font-size:11px;font-weight:${sel?700:400};cursor:pointer;font-family:inherit">${svgIcon(m.icon,{size:11})} ${m.label}</button>`;
  }).join('');
}

// ── Generic estimate (non-painting trades) ────────────────────────────
let _geiClientId=null,_geiEditBidId=null,_geiLines=[],_geiTrade=null,_geiIsCommercial=false,_geiEmergency=false,_geiStep=1,_geiNewWork=false,_geiJobScope='repair';
Object.defineProperty(window,'_geiClientId',{get:()=>_geiClientId,set:v=>{_geiClientId=v;},configurable:true});
Object.defineProperty(window,'_geiEditBidId',{get:()=>_geiEditBidId,set:v=>{_geiEditBidId=v;},configurable:true});
Object.defineProperty(window,'_geiLines',{get:()=>_geiLines,set:v=>{_geiLines=v;},configurable:true});
Object.defineProperty(window,'_geiTrade',{get:()=>_geiTrade,set:v=>{_geiTrade=v;},configurable:true});
let _geiScopeChips=[];
Object.defineProperty(window,'_geiScopeChips',{get:()=>_geiScopeChips,set:v=>{_geiScopeChips=v;},configurable:true});
let _geiScopeNoScope=false;
Object.defineProperty(window,'_geiScopeNoScope',{get:()=>_geiScopeNoScope,set:v=>{_geiScopeNoScope=v;},configurable:true});
// Crew assigned to this bid (employee emails). Each adds their loaded payroll cost as a
// real expense; more people on the job → bigger cost. Hours come automatically from scope.
let _estCrew=[];
let _panelSched=null; // null = not active, obj = panel schedule data
let _geiIsTM=false,_tmCrewCount=1,_tmRatePerMan=0,_tmEstHours=0,_tmBillingCycle='weekly';
Object.defineProperty(window,'_geiIsTM',{get:()=>_geiIsTM,set:v=>{_geiIsTM=v;},configurable:true});
Object.defineProperty(window,'_tmCrewCount',{get:()=>_tmCrewCount,set:v=>{_tmCrewCount=v;},configurable:true});
Object.defineProperty(window,'_tmRatePerMan',{get:()=>_tmRatePerMan,set:v=>{_tmRatePerMan=v;},configurable:true});
Object.defineProperty(window,'_tmEstHours',{get:()=>_tmEstHours,set:v=>{_tmEstHours=v;},configurable:true});
Object.defineProperty(window,'_tmBillingCycle',{get:()=>_tmBillingCycle,set:v=>{_tmBillingCycle=v;},configurable:true});
let _tmCapAction='Stop & get re-approval';
let _geiIsFreeForm=false;
Object.defineProperty(window,'_geiIsFreeForm',{get:()=>_geiIsFreeForm,set:v=>{_geiIsFreeForm=v;},configurable:true});
let _geiClientTaxRate=null,_geiTaxLookupTimer=null;

function _geiOnAddrInput(){
  clearTimeout(_geiTaxLookupTimer);
  _geiTaxLookupTimer=setTimeout(_geiLookupClientTaxRate,700);
}
async function _geiLookupClientTaxRate(){
  const addr=(document.getElementById('gei-addr')?.value||'').trim();
  const zip=typeof _extractZip==='function'?_extractZip(addr):null;
  const state=typeof detectStateFromAddr==='function'?detectStateFromAddr(addr):null;
  if(!zip&&!state){_geiClientTaxRate=null;calcGeiTotal();if(_geiIsFreeForm)_byoUpdateRail();return;}
  if(typeof lookupSalesTaxRate==='function'){
    const r=await lookupSalesTaxRate(zip||'',state||(S&&S.state)||'KS');
    // Only use DB-sourced rates (db_zip or db_state), never show hardcoded base rate
    _geiClientTaxRate=(r&&r.source&&r.source!=='hardcoded')?r:null;
    calcGeiTotal();
    if(_geiIsFreeForm)_byoUpdateRail();
  }
}

function openTMEstimate(c,bidId){_geiOpenModeEstimate(c,bidId,'tm');}
function openFreeFormEstimate(c,bidId){_geiOpenModeEstimate(c,bidId,'byo');}

// Unsent estimate-builder drafts for a client, filtered by estimate type.
// 'tm' matches only Time & Materials drafts; 'byo' matches everything else
// (legacy scope drafts auto-migrate to Build Your Own on resume, so they
// count as BYO). This is THE draft-matching rule, the resume chooser and
// openGenericEstimate's silent-reuse both use it, so they can never disagree.
function _geiFindDraftsFor(clientId,mode){
  return bids.filter(b=>b.client_id===clientId&&!b.signingToken&&b.geiLines!==undefined
    &&(b.status==='Draft'||b.status==='Pending')
    &&(mode==='tm'?!!b.isTM:mode==='byo'?!b.isTM:true));
}
function _geiDraftIsEmpty(b){return !b.amount&&!(b.geiLines||[]).length&&!(b.byoItems||[]).length;}
// Plain-English estimate-type label for a bid, spelled out, never an acronym.
// Used anywhere a bid surfaces outside the estimate builder (Make Money Today
// feed, pickers) so the contractor can always tell which type they chose.
function _estimateTypeLabel(b){
  if(!b)return'';
  if(b.isTM)return'Time & Materials';
  if(b.isFreeForm)return'Build Your Own';
  return'';
}

// ── Active-estimate marker, auto-resume after a tab switch/app reopen ───────
// While an estimate is open, a marker records where the contractor is. If the
// app reloads (phone tab switch, accidental close), boot jumps straight back
// into that estimate, it's the thing they were most likely coming back to
// finish. The marker clears when they LEAVE the estimate on purpose (bottom
// nav, back to the type picker), so deliberate exits never bounce them back.
function _geiMarkActive(){
  try{
    if(!_geiEditBidId)return;
    localStorage.setItem('zp3_active_estimate',JSON.stringify({
      bidId:_geiEditBidId,clientId:_geiClientId,
      uid:(typeof _supaUser!=='undefined'&&_supaUser)?_supaUser.id:null,
      ts:Date.now(),
    }));
  }catch(_e){}
}
function _geiClearActive(){try{localStorage.removeItem('zp3_active_estimate');}catch(_e){}}
// Called once from the boot reveal chain. Every guard is a reason NOT to hijack
// the open: stale marker (>12h), different account, employee account, bid gone,
// or bid already sent/decided: in all of those, boot lands on the dashboard.
function _maybeResumeActiveEstimate(){
  // Already inside the estimate editor → nothing to resume. Bail WITHOUT
  // clearing the marker (it belongs to the editor that's open right now).
  // Without this guard, the boot timer that schedules this (cloud.js, 120ms
  // after reveal) can fire AFTER the user has already navigated into an
  // estimate: re-opening it underneath them and reassigning _geiLines,
  // which discards any unsaved in-memory edits. Same race the WebKit CI
  // shards kept tripping when a spec opened an estimate right after boot.
  if(document.querySelector('.pg.active')?.id==='pg-est-generic')return false;
  let m=null;
  try{m=JSON.parse(localStorage.getItem('zp3_active_estimate')||'null');}catch(_e){}
  if(!m||!m.bidId)return false;
  if(Date.now()-(m.ts||0)>12*3600*1000){_geiClearActive();return false;}
  if(typeof _isEmployee!=='undefined'&&_isEmployee){_geiClearActive();return false;}
  const uid=(typeof _supaUser!=='undefined'&&_supaUser)?_supaUser.id:null;
  if((m.uid||null)!==(uid||null)){_geiClearActive();return false;}
  const b=bids.find(x=>String(x.id)===String(m.bidId));
  if(!b||b.signingToken||!(b.status==='Draft'||b.status==='Pending')){_geiClearActive();return false;}
  const c=getClientById(m.clientId)||getClientById(b.client_id);
  if(!c){_geiClearActive();return false;}
  openGenericEstimate(c,b.id,b.trade_type||'general');
  return true;
}

// UI entry point for both estimate types. The rule the owner set: never
// silently resume a draft that has real content, never create junk duplicates.
//  • explicit bidId → open that bid (resume buttons, revise flows)
//  • non-empty unsent draft(s) of the SAME type exist → chooser: resume one
//    of them, or deliberately start a fresh version alongside them
//  • only empty stubs (or nothing) → open directly; empty stubs are reused
//    silently so abandoning the type picker twice never piles up blank drafts
function _geiOpenModeEstimate(c,bidId,mode){
  if(bidId){openGenericEstimate(c,bidId,null,{mode});return;}
  const drafts=c?_geiFindDraftsFor(c.id,mode).filter(b=>!_geiDraftIsEmpty(b)):[];
  if(!drafts.length){openGenericEstimate(c,null,null,{mode});return;}
  _geiShowDraftChooser(c,mode,drafts);
}
function _geiShowDraftChooser(c,mode,drafts){
  document.getElementById('_gei-draft-chooser')?.remove();
  const modeLabel=mode==='tm'?'Time & Materials':'Build Your Own';
  const ov=document.createElement('div');ov.className='zmodal-overlay';ov.id='_gei-draft-chooser';
  const box=document.createElement('div');box.className='zmodal';box.style.maxWidth='440px';
  const rows=drafts.map(b=>{
    const items=(b.byoItems||[]).length||(b.geiLines||[]).length;
    const parts=[];
    if(b.amount)parts.push('$'+Number(b.amount).toLocaleString());
    if(items)parts.push(items+' item'+(items>1?'s':''));
    if(b.bid_date)parts.push('started '+b.bid_date);
    return '<button data-bid="'+b.id+'" onclick="_geiResumeChosenDraft(this.dataset.bid)" style="display:block;width:100%;text-align:left;padding:12px 14px;border:1.5px solid var(--border2);border-radius:10px;background:var(--bg2);cursor:pointer;font-family:inherit;margin-bottom:8px">'+
      '<span style="font-size:14px;font-weight:700;color:var(--text);display:block">'+escHtml(b.type||modeLabel+' draft')+'</span>'+
      '<span style="font-size:12px;color:var(--text3)">'+escHtml(parts.join(' · ')||'No details yet')+'</span>'+
    '</button>';
  }).join('');
  box.innerHTML=
    '<div style="font-size:16px;font-weight:800;margin-bottom:4px">Unsent '+modeLabel+' draft'+(drafts.length>1?'s':'')+'</div>'+
    '<div style="font-size:13px;color:var(--text3);margin-bottom:14px">'+escHtml(c?.name||'This client')+' already has '+(drafts.length>1?drafts.length+' unsent drafts':'an unsent draft')+' of this type. Pick one to keep working on it, or start a fresh version to send alongside it.</div>'+
    rows+
    '<button onclick="_geiStartFreshDraft()" style="display:block;width:100%;padding:13px;border-radius:10px;border:none;background:var(--blue);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;margin-top:4px">'+svgIcon('➕',{size:14})+' Start a fresh '+modeLabel+' estimate</button>'+
    '<button onclick="document.getElementById(\'_gei-draft-chooser\')?.remove()" style="display:block;width:100%;padding:11px;border-radius:10px;border:none;background:none;color:var(--text3);font-size:13px;cursor:pointer;font-family:inherit;margin-top:4px">Cancel</button>';
  ov.appendChild(box);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  ov.dataset.mode=mode;ov.dataset.clientId=c?.id||'';
}
function _geiResumeChosenDraft(bidId){
  const ov=document.getElementById('_gei-draft-chooser');
  const mode=ov?.dataset.mode;const clientId=Number(ov?.dataset.clientId);
  ov?.remove();
  const c=getClientById(clientId);if(!c)return;
  openGenericEstimate(c,Number(bidId)||bidId,null,{mode});
}
function _geiStartFreshDraft(){
  const ov=document.getElementById('_gei-draft-chooser');
  const mode=ov?.dataset.mode;const clientId=Number(ov?.dataset.clientId);
  ov?.remove();
  const c=getClientById(clientId);if(!c)return;
  openGenericEstimate(c,null,null,{mode,forceNew:true});
}

function openGenericEstimate(c,bidId,_tradePick,opts){
  // Mode comes in explicitly (never inherited from whatever estimate was open
  // last): stale _geiIsTM/_geiIsFreeForm from a previous estimate was how a
  // Time & Materials resume could open with Build Your Own state mixed in.
  _geiIsTM=opts?.mode==='tm';
  _geiIsFreeForm=opts?.mode==='byo';
  _geiClientId=c?.id||null;
  _geiEditBidId=bidId||null;
  _geiClientTaxRate=null;
  _geiLines=[];_byoItems=[];_byoCustomSections=[];_byoCustomTerms='';_geiIsCommercial=false;_geiEmergency=false;_panelSched=null;_geiStep=1;_geiNewWork=false;_geiJobScope='repair';_geiScopeChips=[];_geiScopeNoScope=false;_estCrew=[];
  _tmCrewCount=1;_tmRatePerMan=0;_tmEstHours=0;_tmBillingCycle='weekly';_tmCapAction='Stop & get re-approval';
  document.getElementById('gei-cart-bar')?.remove();
  if(_tradePick)_activeTrade=_tradePick;
  _geiTrade=_tradePick||getActiveTrade();
  const trade=_geiTrade;
  const m=TRADE_META[trade]||{icon:'🔧',label:trade.charAt(0).toUpperCase()+trade.slice(1)};
  const titleEl=document.getElementById('gei-trade-title');
  if(titleEl)titleEl.innerHTML=svgIcon(m.icon,{size:24})+' '+m.label+' Proposal';
  const eyebrowEl=document.getElementById('gei-tbar-eyebrow');
  if(eyebrowEl)eyebrowEl.textContent=m.label+' proposal';
  const sf=(id,val)=>{const el=document.getElementById(id);if(el)el.value=val||'';};
  sf('gei-client',c?.name||'');
  sf('gei-addr',c?.addr||'');
  if(c?.addr)setTimeout(_geiLookupClientTaxRate,0);
  const DESC_PH={electrical:'e.g. Panel upgrade, add EV charger in garage',plumbing:'e.g. Replace water heater, install shutoff valves',hvac:'e.g. Replace AC unit, charge refrigerant',roofing:'e.g. Full shingle replacement, fix ridge flashing',landscaping:'e.g. Weekly mowing, spring cleanup, new mulch',general:'e.g. Drywall repair, power washing, handyman'};
  sf('gei-desc','');sf('gei-notes','');sf('gei-tax-pct','0');sf('gei-duration','');
  const descEl=document.getElementById('gei-desc');
  if(descEl)descEl.placeholder=DESC_PH[_geiTrade]||'Describe the job';
  const nwEl=document.getElementById('gei-new-work');
  if(nwEl)nwEl.checked=false;
  document.getElementById('gei-date').value=todayKey();
  let _resumingExisting=false;
  if(bidId){
    const b=bids.find(x=>x.id===bidId);
    if(b){
      sf('gei-desc',b.type||'');sf('gei-notes',b.notes||'');
      if(b.geiLines&&b.geiLines.length)_geiLines=JSON.parse(JSON.stringify(b.geiLines));
      if(b.geiTaxPct)sf('gei-tax-pct',b.geiTaxPct);
      if(b.jobScope)_geiJobScope=b.jobScope;
      if(b.scopeChips)_geiScopeChips=[...b.scopeChips];
      _geiScopeNoScope=!!(b.scopeNoScope);
      if(b.geiDuration)sf('gei-duration',b.geiDuration);
      if(b.geiNewWork){_geiNewWork=true;if(nwEl)nwEl.checked=true;}
      if(b.panelSched)_panelSched=JSON.parse(JSON.stringify(b.panelSched));
      // An explicitly-resumed bid's OWN type wins, the record knows what it is,
      // regardless of which button or stale state got us here. isTM takes
      // precedence: bids autosaved before the dual-flag fix carry BOTH flags,
      // and letting isFreeForm win resumed T&M drafts as empty BYO estimates.
      if(b.isTM){
        _geiIsTM=true;_geiIsFreeForm=false;
        _tmCrewCount=b.tmCrewCount||1;_tmRatePerMan=b.tmRatePerMan||0;
        _tmEstHours=b.tmEstHours||0;_tmBillingCycle=b.tmBillingCycle||'weekly';
        _tmCapAction=b.tmCapAction||'Stop & get re-approval';
      }
      else if(b.isFreeForm){_geiIsFreeForm=true;_geiIsTM=false;}
      // Deposit % is restored in _tmShowPage/_byoShowPage instead, the field
      // doesn't exist in the DOM yet at this point (rendered lazily on page show).
      _resumingExisting=true;
    }
  }
  if(!_geiEditBidId&&!opts?.forceNew){
    // Reuse an existing unsent draft for this client (prevents duplicates).
    // When a mode was picked (tm/byo), only drafts of that SAME type are
    // candidates: picking Time & Materials must never silently resume a
    // Build Your Own draft and drag its items along (the cross-type "bleed"
    // the owner hit). Two-pass within candidates: exact trade match first,
    // then heal old bids that predate the trade_type field.
    // Non-empty candidates only reach here via the resume chooser
    // (_geiOpenModeEstimate) when a mode is set; direct legacy calls keep the
    // old silent-resume behavior unchanged.
    const _mode=opts?.mode;
    const _typeOk=b=>_mode==='tm'?!!b.isTM:_mode==='byo'?!b.isTM:true;
    const _tMatch=b=>b.client_id===_geiClientId&&!b.signingToken&&b.geiLines!==undefined&&(b.status==='Draft'||b.status==='Pending')&&_typeOk(b);
    let _existingGei=bids.find(b=>_tMatch(b)&&b.trade_type===_geiTrade);
    if(!_existingGei){
      // Fallback: pick up old bids that predate the trade_type field
      _existingGei=bids.find(b=>_tMatch(b)&&(b.trade_type===undefined||b.trade_type===null||b.trade_type===''));
    }
    if(!_existingGei&&_mode){
      // Mode flows aren't trade-scoped, the chooser found drafts by type only,
      // so match by type across trades too rather than spawning a duplicate.
      _existingGei=bids.find(_tMatch);
    }
    if(_existingGei){
      _existingGei.trade_type=_geiTrade; // heal legacy bids
      _geiEditBidId=_existingGei.id;
      const _b=_existingGei;
      sf('gei-desc',_b.geiDesc||'');sf('gei-notes',_b.notes||'');
      if(_b.geiLines&&_b.geiLines.length)_geiLines=JSON.parse(JSON.stringify(_b.geiLines));
      if(_b.geiTaxPct)sf('gei-tax-pct',_b.geiTaxPct);
      if(_b.geiDuration)sf('gei-duration',_b.geiDuration);
      if(_b.geiNewWork){_geiNewWork=true;if(nwEl)nwEl.checked=true;}
      if(_b.panelSched)_panelSched=JSON.parse(JSON.stringify(_b.panelSched));
      // isTM precedence, legacy dual-flag rows (see _byoAutosave note) must
      // resume as T&M, never as an empty BYO.
      if(_b.isTM){_geiIsTM=true;_geiIsFreeForm=false;_tmCrewCount=_b.tmCrewCount||1;_tmRatePerMan=_b.tmRatePerMan||0;_tmEstHours=_b.tmEstHours||0;_tmBillingCycle=_b.tmBillingCycle||'weekly';_tmCapAction=_b.tmCapAction||'Stop & get re-approval';}
      else if(_b.isFreeForm){_geiIsFreeForm=true;_geiIsTM=false;}
      if(_b.scopeChips)_geiScopeChips=[..._b.scopeChips];
      _geiScopeNoScope=!!(_b.scopeNoScope);
      // Deposit % is restored in _tmShowPage/_byoShowPage instead, the field
      // doesn't exist in the DOM yet at this point (rendered lazily on page show).
      // Purge other empty duplicates for this client+trade now that we have the right
      // one: through _userDelete so the delete-intent is RECORDED and the next save's
      // sweep soft-deletes them server-side too. A bare array filter only hid them in
      // memory: every reload re-downloaded the zombies, which the old load-side GEI
      // filter then re-hid, the silent-hide loop behind the owner's 53-vs-43 report.
      _userDelete(()=>{
        bids=bids.filter(b=>b.id===_existingGei.id||!(b.client_id===_geiClientId&&!b.signingToken&&b.geiLines!==undefined&&!b.amount&&!(b.geiLines||[]).length&&(b.status==='Draft'||b.status==='Pending')&&(b.trade_type===_geiTrade||!b.trade_type)));
      });
      _resumingExisting=true;
      saveAll();
    }
  }
  if(!_geiEditBidId){
    const _draftClientName=c?c.name||'':'';
    const _draftTypeLabel=_geiIsTM?'Time & Materials':_geiIsFreeForm?'Build Your Own':((TRADE_META&&TRADE_META[_geiTrade])?TRADE_META[_geiTrade].label||'Trade':'Trade');
    // Stamp the picked type on the stub immediately, a typeless stub can't be
    // found by the type-aware reuse above, so backing out and re-picking the
    // same type would spawn a duplicate blank draft every time.
    const draftBid={id:_newBidId(),client_id:_geiClientId,client_name:_draftClientName,bid_date:todayKey(),amount:0,deposit:0,type:_draftTypeLabel+' estimate',notes:'',status:'Draft',draft:true,trade_type:_geiTrade,geiLines:[],geiTaxPct:0,
      ...(_geiIsTM?{isTM:true}:{}),...(_geiIsFreeForm?{isFreeForm:true}:{})};
    bids.unshift(draftBid);_geiEditBidId=draftBid.id;saveAll();
  }
  // Auto-migrate old step-based estimates to BYO freeform when resumed
  if(_resumingExisting&&!_geiIsTM&&!_geiIsFreeForm){
    _geiIsFreeForm=true;
    if(_geiLines.length){
      let nid=1;
      _byoItems=_geiLines.map(l=>({id:nid++,section:l._byoSection||'Other',label:l.desc||'',price:(l.qty||1)*(l.rate||0),on:true,required:false,notes:l.notes||''}));
      _byoCustomSections=[...(new Set(_byoItems.map(x=>x.section)))].filter(s=>!['Interior','Exterior','Materials'].includes(s));
      _geiLines=[];
    }
    const _migBid=bids.find(x=>x.id===_geiEditBidId);
    if(_migBid){_migBid.isFreeForm=true;if(_byoItems.length){_migBid.byoItems=JSON.parse(JSON.stringify(_byoItems));_migBid.byoCustomSections=[..._byoCustomSections];}saveAll();}
  }
  // Restore scope title from saved description when reopening an existing bid
  if(!_geiIsTM&&!_geiIsFreeForm){
    const _descVal=document.getElementById('gei-desc')?.value?.trim();
    if(_descVal){const _tEl=document.getElementById('gei-trade-title');if(_tEl)_tEl.textContent=_descVal;}
  }
  goPg('pg-est-generic');
  goGeiStep(_resumingExisting?2:1);
}

function goGeiStep(n){
  // T&M mode, step 1: job type picker (same as scope), step 2+: single-page T&M layout
  if(_geiIsTM){
    if(n===1){
      _tmHidePage(); // hides gei-tm-page, re-shows gei-old-tbar + gei-step-bar
      const byoP=document.getElementById('gei-byo-page');if(byoP)byoP.style.display='none';
      _geiStep=1;
      [1,2,3].forEach(i=>{const el=document.getElementById('gei-s'+i);if(el)el.style.display=(i===1)?'':'none';});
      _geiSyncJobTypeButtons();
      window.scrollTo({top:0,behavior:'instant'});
      return;
    }
    const byoP=document.getElementById('gei-byo-page');if(byoP)byoP.style.display='none';
    _geiStep=n;
    _tmShowPage();
    window.scrollTo({top:0,behavior:'instant'});
    return;
  }
  // BYO / free-form mode, step 1: job type picker (same as scope), step 2+: BYO page
  if(_geiIsFreeForm){
    if(n===1){
      _byoHidePage(); // hides gei-byo-page, re-shows gei-old-tbar + gei-step-bar
      const tmP=document.getElementById('gei-tm-page');if(tmP)tmP.style.display='none';
      _geiStep=1;
      [1,2,3].forEach(i=>{const el=document.getElementById('gei-s'+i);if(el)el.style.display=(i===1)?'':'none';});
      _geiSyncJobTypeButtons();
      window.scrollTo({top:0,behavior:'instant'});
      return;
    }
    const tmP=document.getElementById('gei-tm-page');if(tmP)tmP.style.display='none';
    _geiStep=n;
    _byoShowPage();
    window.scrollTo({top:0,behavior:'instant'});
    return;
  }
  // Scope & Price (step-based): hide both single-page layouts before showing wizard steps
  const _tmP=document.getElementById('gei-tm-page');if(_tmP)_tmP.style.display='none';
  const _byoP=document.getElementById('gei-byo-page');if(_byoP)_byoP.style.display='none';
  // If going to Step 2 and no bundles are set, show the onboarding picker first
  if(n===2&&(!S.myBundles||!S.myBundles.length)){showGeiOnboarding();return;}
  _geiStep=n;
  [1,2,3].forEach(i=>{const el=document.getElementById('gei-s'+i);if(el)el.style.display=(i===n)?'':'none';});
  window.scrollTo({top:0,behavior:'instant'});
  _geiRenderStepBar();
  _geiSyncScopeButtons();
  ['gei-tm-chip','gei-tm-reason-wrap','gei-tm-crew','gei-tm-terms','gei-ff-chip'].forEach(id=>{
    const d=document.getElementById(id);if(d)d.style.display='none';
  });
  const svcWrap=document.getElementById('gei-svc-wrap');
  if(svcWrap)svcWrap.style.display='flex';
  const bar=document.getElementById('gei-cart-bar');
  if(bar)bar.style.display=(n===2&&_geiLines.length)?'flex':'none';
  if(n===2){_geiRenderTemplates();_geiRenderCartBar();}
  if(n===1){_geiSyncJobTypeButtons();}
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
  if(el)el.textContent=labor?'$'+labor.toLocaleString('en-US',{maximumFractionDigits:0}):'-';
  const fml=document.getElementById('tm-crew-formula');
  if(fml)fml.textContent=(_tmRatePerMan&&_tmEstHours)?_tmCrewCount+' worker'+(_tmCrewCount>1?'s':'')+' × $'+_tmRatePerMan+'/hr × '+_tmEstHours+'hrs':'Enter rate & hours above';
  // Upsert labor line
  const idx=_geiLines.findIndex(l=>l._tmLabor);
  const desc='Labor: '+_tmCrewCount+' worker'+(_tmCrewCount>1?'s':'')+' @ $'+_tmRatePerMan+'/hr';
  const line={desc,qty:_tmEstHours,unit:'hr',rate:Math.round(_tmRatePerMan*_tmCrewCount),_tmLabor:true,total:Math.round(_tmRatePerMan*_tmCrewCount*_tmEstHours)};
  if(idx>=0){if(labor>0)_geiLines[idx]=line;else _geiLines.splice(idx,1);}
  else if(labor>0)_geiLines.unshift(line);
  renderGeiLines();calcGeiTotal();
  _byoAutosave();
}
function _tmCalcDeposit(){
  const {sub}=calcGeiTotal();
  const pct=parseFloat(document.getElementById('tm-dep-pct')?.value)||20;
  const amt=Math.round(sub*pct/100);
  const el=document.getElementById('tm-dep-amt');
  if(el)el.textContent=amt?'$'+amt.toLocaleString('en-US',{maximumFractionDigits:0}):'-';
  // Also update NTE suggestion if not manually set
  _tmCalcNte();
  _byoAutosave();
}
function _tmCalcNte(){
  const on=document.getElementById('tm-nte-on')?.checked;
  const wrap=document.getElementById('tm-nte-wrap');
  if(wrap)wrap.style.display=on?'block':'none';
  if(!on){_byoAutosave();return;}
  const cap=document.getElementById('tm-nte-cap');
  if(cap&&(!cap.value||parseFloat(cap.value)===0)){
    const{sub}=calcGeiTotal();
    if(sub>0)cap.value=Math.round(sub*1.15/500)*500; // round to nearest $500
  }
  _byoAutosave();
}
function _tmSetCycle(v){
  _tmBillingCycle=v;
  _tmSyncCycleButtons();
  _byoAutosave();
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

// ── T&M / BYO shared markup, one template, rendered per-prefix ─────────────
// The two single-page layouts (EstimateTM.jsx / EstimateBYO.jsx equivalents) share
// identical structure for the top bar, the profit gauge, and the Send/Preview/
// Sign-in-person action row, only ids and a handful of parameters differ per mode.
// Rendering from one function means a future change to any of these can never
// silently apply to only one of the two modes (see the _tmPreviewClient regression
// this consolidation followed).
function _geiRenderTopBar(prefix,defaultTitle,editFnName){
  const wrap=document.getElementById(prefix+'-topbar-wrap');if(!wrap)return;
  wrap.innerHTML=
    '<div class="tbar-l">'+
      '<button class="link-back" onclick="_geiBack()">← Job type</button>'+
      '<div class="tbar-title" style="display:flex;align-items:center;gap:8px;line-height:1">'+
        '<span id="'+prefix+'-tbar-title">'+defaultTitle+'</span>'+
        '<button onclick="'+editFnName+'()" id="'+prefix+'-edit-title-btn" title="Rename proposal" style="background:none;border:none;padding:0 3px;cursor:pointer;font-size:16px;line-height:1;touch-action:manipulation;flex-shrink:0;opacity:.45;color:var(--text)">'+svgIcon('✏',{size:16})+'</button>'+
      '</div>'+
      '<div class="tbar-sub" id="'+prefix+'-page-sub">-</div>'+
    '</div>'+
    '<div class="tbar-r">'+
      '<button class="btn" onclick="saveGenericEstimate(true)">'+svgIcon('💾',{size:14})+' Save draft</button>'+
      '<button class="btn btn-ghost" onclick="_geiBack()">Cancel</button>'+
    '</div>';
}
function _geiRenderScopeCard(prefix){
  const wrap=document.getElementById(prefix+'-scopecard-wrap');if(!wrap)return;
  wrap.innerHTML=
    '<div class="card-hd">'+
      '<div class="card-hd-title">Scope of work</div>'+
      '<div style="display:flex;gap:6px"><button class="btn btn-sm" onclick="_openScopeSheet(\''+prefix+'-scope-wrap\')">+ Add scope</button></div>'+
    '</div>'+
    '<div id="'+prefix+'-scope-wrap"></div>';
}
function _geiRenderProfitGauge(prefix,costOninput){
  const wrap=document.getElementById(prefix+'-gauge-wrap');
  if(!wrap||wrap.children.length)return; // idempotent: preserve gauge/animation state across repeat page shows
  wrap.innerHTML=
    '<input type="number" id="'+prefix+'-expected-cost" style="display:none" oninput="'+costOninput+'">'+
    '<div id="'+prefix+'-gauge-hint" style="display:none"></div>'+
    '<div id="'+prefix+'-profit-gauge" style="display:none;opacity:0;transition:opacity .32s ease">'+
      // Hard-edged stops at the EXACT _updateMarginGauge breakpoints (22/35/55%) so
      // the dot always sits on a track color matching its own computed color, no
      // blend zone where the number renders amber over a still-green track (or
      // vice versa). 55%+ is amber all the way to 100%, matching the JS: past the
      // green cap, margin is never re-flagged as red, only "double-check" amber.
      '<div style="position:relative;height:7px;border-radius:5px;background:linear-gradient(to right,#991B1B 0%,#EF4444 2%,#EF4444 22%,#F59E0B 22%,#F59E0B 35%,#22C55E 35%,#22C55E 55%,#F59E0B 55%,#F59E0B 100%);margin:14px 10px 26px">'+
        '<div id="'+prefix+'-gauge-dot" style="position:absolute;top:50%;transform:translate(-50%,-50%);width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 0 0 3px #22C55E,0 2px 8px rgba(0,0,0,.25);left:50%;transition:left .55s cubic-bezier(.22,1,.36,1),box-shadow .4s ease"></div>'+
      '</div>'+
      '<div style="text-align:center;padding-bottom:12px">'+
        '<div id="'+prefix+'-gauge-pct" style="font-size:30px;font-weight:900;line-height:1.1;color:var(--text);transition:color .4s ease">-</div>'+
        '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text3);margin:2px 0 2px">Profit %</div>'+
        '<div id="'+prefix+'-gauge-dollars" style="font-size:15px;font-weight:700;margin:0 0 5px;transition:color .4s ease"></div>'+
        '<div id="'+prefix+'-gauge-msg" style="font-size:11.5px;color:var(--text3);min-height:16px"></div>'+
      '</div>'+
    '</div>';
}
function _geiRenderActionButtons(prefix,opts){
  const wrap=document.getElementById(prefix+'-actions-wrap');if(!wrap)return;
  const o=opts||{};
  const cols=o.extraButtons?o.extraButtons.length+2:2;
  const extra=(o.extraButtons||[]).map(b=>'<button class="btn btn-sm" style="background:var(--bg2);color:var(--text2);font-size:11px;padding:8px 4px" onclick="'+b.onclick+'">'+b.label+'</button>').join('');
  wrap.innerHTML=
    '<button class="btn btn-p btn-xl btn-full" style="margin-top:14px" onclick="sendGenericProposal()">'+svgIcon('📨',{size:16})+' '+(o.sendLabel||'Send proposal')+'</button>'+
    '<button class="btn btn-xl btn-full" style="margin-top:8px;background:var(--green);color:#fff;border-color:var(--green)" onclick="_geiSignInPerson()">'+svgIcon('✍',{size:16})+' Sign in person</button>'+
    '<div style="display:grid;grid-template-columns:repeat('+cols+',1fr);gap:6px;margin-top:8px">'+
      '<button class="btn btn-sm" style="background:var(--bg2);color:var(--text2);font-size:11px;padding:8px 4px" onclick="'+(o.previewOnclick||'_geiPreviewClient()')+'">'+svgIcon('👁',{size:11})+' Preview</button>'+
      extra+
      '<button class="btn btn-sm" style="background:var(--bg2);color:var(--text2);font-size:11px;padding:8px 4px" onclick="_openComparisonPicker()">'+svgIcon('📊',{size:11})+' Compare</button>'+
    '</div>';
}
function _geiPreviewClient(){sendGenericProposal(true);}
function _geiRenderDepositField(prefix,onInputExpr){
  const wrap=document.getElementById(prefix+'-deposit-wrap');
  if(!wrap||wrap.children.length)return;
  wrap.innerHTML=
    '<div class="summary-row" style="align-items:center">'+
      '<span style="display:flex;align-items:center;gap:6px;font-size:14px;font-weight:600">Deposit %</span>'+
      '<span style="display:flex;align-items:center;gap:4px">'+
        '<input type="number" id="'+prefix+'-deposit-pct" value="25" min="0" max="100" step="5"'+
          ' oninput="'+onInputExpr+'"'+
          ' style="width:68px;padding:8px 10px;border-radius:8px;border:1.5px solid var(--border2);font-size:17px;font-weight:700;text-align:center;font-family:inherit;-moz-appearance:textfield">'+
        '<span style="font-size:15px;font-weight:700">%</span>'+
      '</span>'+
    '</div>'+
    '<div class="summary-row" style="color:var(--text-3)"><span>Balance later</span><span id="'+prefix+'-rail-balance">$0</span></div>';
}
// Single source of truth for "what % deposit does this estimate use", read by
// _byoAutosave, saveGenericEstimate, sendGenericProposal, _geiSignInPerson, and
// _geiConfirmInPerson so T&M and BYO can never drift onto different formulas.
function _geiDepositPct(){
  const el=document.getElementById(_geiIsTM?'tm-deposit-pct':'byo-deposit-pct');
  return parseFloat(el?.value)||25;
}

// ── Estimate mode registry ────────────────────────────────────────────────────
// The DIFFERENCES between T&M and BYO live here as data. The behavior that uses
// them (_geiShowSharedChrome and the shared render functions above) is one code
// path: a change to how either page looks or boots automatically hits both.
//
// SHARED KERNEL, the constant baseline every estimate type builds on. A new
// estimate type (fixed-price, subscription, whatever comes next) is a new entry
// in _GEI_MODES plus its own genuinely-unique fields (like T&M's crew/rate/days
// inputs or BYO's line-item sections), it reuses everything below, it never
// re-implements it:
//   • Page chrome:        _geiShowSharedChrome / _geiHidePage
//   • Rendered components: _geiRenderTopBar, _geiRenderScopeCard,
//                          _geiRenderProfitGauge, _geiRenderActionButtons,
//                          _geiRenderDepositField
//   • Deposit math:        _geiDepositPct (single source of truth, used by
//                          saveGenericEstimate, sendGenericProposal,
//                          _byoAutosave, _geiSignInPerson, _geiConfirmInPerson)
//   • Scope-of-work:       TRADE_SCOPE_CHIPS / _GEN_SCOPE, _toggleScopeChip,
//                          _renderScopeChips, _openScopeSheet, the one
//                          "what's included" definition every mode shares;
//                          it always carries into the sent proposal
//                          (see the _scopeBlocks assembly in sendGenericProposal)
//   • Save/send/sign:      saveGenericEstimate, sendGenericProposal,
//                          _geiSignInPerson, _geiConfirmInPerson
//   • Proposal T&C:        the single clause array in sendGenericProposal,
//                          shared legal clauses exist once; a mode only
//                          supplies its own payment-terms clauses at the top
// If a change only touches one mode's genuinely-unique behavior, it belongs in
// that mode's own function (_tmInputChange, _byoUpdateRail, etc.): not here.
const _GEI_MODES={
  tm:{
    pageId:'gei-tm-page',
    defaultTitle:'Time &amp; Materials proposal',
    editFnName:'_editTMTitle',
    titleSuffix:'Time & Materials',
    gaugeOninput:'_tmInputChange()',
    depositOninput:'_tmInputChange()',
    actionOpts:{sendLabel:'Send T&amp;M proposal'},
  },
  byo:{
    pageId:'gei-byo-page',
    defaultTitle:'Build Your Own proposal',
    editFnName:'_editByoTitle',
    titleSuffix:'Build Your Own',
    gaugeOninput:"this.dataset.userSet='true';_byoUpdateRail();_byoAutosave()",
    depositOninput:'_byoUpdateRail();_byoAutosave()',
    actionOpts:{extraButtons:[{label:svgIcon('📋',{size:11})+' Option B',onclick:'_byoDuplicateBid()'}]},
  },
};
// Shared page chrome for both single-page estimate layouts: hide the legacy
// wizard, show the page, render the shared components, brand the title, fill the
// client sub-header, and restore the saved deposit %. Returns the saved bid (or
// undefined) so each mode's show-page can do its own field restores from it.
function _geiShowSharedChrome(prefix){
  const m=_GEI_MODES[prefix];if(!m)return;
  ['gei-old-tbar','gei-step-bar','gei-s1','gei-s2','gei-s3'].forEach(id=>{
    const el=document.getElementById(id);if(el)el.style.display='none';
  });
  const p=document.getElementById(m.pageId);if(p)p.style.display='';
  _geiRenderTopBar(prefix,m.defaultTitle,m.editFnName);
  _geiRenderScopeCard(prefix);
  _geiRenderProfitGauge(prefix,m.gaugeOninput);
  _geiRenderActionButtons(prefix,m.actionOpts);
  _geiRenderDepositField(prefix,m.depositOninput);
  // Trade branding in title
  const tmMeta=TRADE_META[_geiTrade||getActiveTrade()]||{icon:'🔧',label:'Trade'};
  const titleEl=document.getElementById(prefix+'-tbar-title');
  if(titleEl){const _customName=document.getElementById('gei-desc')?.value?.trim();titleEl.innerHTML=_customName?escHtml(_customName):(svgIcon(tmMeta.icon,{size:24})+' '+tmMeta.label+' · '+m.titleSuffix);}
  // Sub-header: client name · address
  const c=getClientById(_geiClientId);
  const sub=document.getElementById(prefix+'-page-sub');
  if(sub){
    const parts=[];
    if(c?.name)parts.push(c.name);
    if(c?.addr)parts.push(c.addr.split(',')[0]);
    sub.textContent=parts.join(' · ')||'New estimate';
  }
  // Restore deposit % from saved bid (back-calculate from deposit/amount): the
  // field was rendered fresh above, so this must come after _geiRenderDepositField.
  const b=bids.find(x=>x.id===_geiEditBidId);
  if(b?.amount>0&&b?.deposit>0){
    const depEl=document.getElementById(prefix+'-deposit-pct');
    if(depEl)depEl.value=Math.round((b.deposit/b.amount)*100);
  }
  _geiMarkActive(); // estimate is open, a reload should come straight back here
  return b;
}
function _geiHidePage(pageId){
  const p=document.getElementById(pageId);if(p)p.style.display='none';
  ['gei-old-tbar','gei-step-bar'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='';});
}

// ── T&M single-page layout (matches design spec EstimateTM.jsx) ──────────────
function _tmShowPage(){
  const b=_geiShowSharedChrome('tm');
  // Populate inputs from current state, comma-formatted like the price fields
  // elsewhere (_fmtMoneyInput/_moneyVal), so a restored value displays the same
  // way it would after the contractor typed it.
  const setV=(id,v)=>{const e=document.getElementById(id);if(e)e.value=(v===0||v)?Number(v).toLocaleString('en-US'):''};
  setV('tm-i-rate',_tmRatePerMan||'');
  setV('tm-i-days',_tmEstHours?Math.round(_tmEstHours/8):'');
  const crewDisp=document.getElementById('tm-i-crew-count');
  if(crewDisp)crewDisp.textContent=Math.max(1,_tmCrewCount||1);
  if(b?.tmNteCap)setV('tm-i-nte',b.tmNteCap);
  if(b?.tmCapAction){setV('tm-i-cap-action',b.tmCapAction);_tmCapAction=b.tmCapAction;}
  // Restore who's on the job, drives the true-cost gauge via the shared crew picker.
  _estCrew=Array.isArray(b&&b.estCrew)?[...b.estCrew]:[];
  _injectRrpItems();
  _tmRenderMatList();
  _tmInputChange();
  _tmSyncCadence();
  _renderScopeChips('tm-scope-wrap');
}
function _tmHidePage(){_geiHidePage('gei-tm-page');}

// ── Build Your Own single-page layout ────────────────────────────────────────
let _byoItems=[],_byoCustomSections=[],_byoCustomTerms='';
const _BYO_DEFAULT_SECTIONS=['Interior','Exterior','Materials','Add-ons'];
const _RRP_BYO_SECTION='RRP: Lead-Safe Protocol';
const _RRP_ITEMS=[
  {label:'Lead-safe setup & interior containment',hint:'Plastic sheeting 6 ft from work surfaces; sealed ducts, vents, door coverings (EPA §745.85)',price:0,_scope:'interior'},
  {label:'Exterior containment',hint:'Ground cover 10 ft out from building; vertical barriers within 10 ft of property line (EPA §745.85)',price:0,_scope:'exterior'},
  {label:'HEPA-equipped prep',hint:'HEPA-shrouded sanding only, no torching, no dry power sanding, no heat guns >1,100°F (EPA §745.85)',price:0},
  {label:'HEPA vacuum service',hint:'HEPA vacuum cleanup at end of each workday and at completion (EPA §745.85)',price:0},
  {label:'Lead-safe cleanup',hint:'Wet-wash + HEPA-vac + wet-wash cycle until no dust or debris remains (EPA §745.85)',price:0},
  {label:'Cleaning verification',hint:'Certified renovator wipe test vs EPA card on all sills, floors, and counters (EPA §745.85(b))',price:0},
  {label:'Lead waste disposal',hint:'All debris bagged, sealed, and transported per EPA requirements (EPA §745.85)',price:0},
];
const _RRP_PROPOSAL_LINES=[
  'Containment: Plastic on floors, walls, and HVAC vents. 10-ft exterior perimeter outside.',
  'No high-dust methods, No torching, no power-sanding without HEPA, no heat guns above 1,100°F.',
  'HEPA everything, HEPA-attached tools and HEPA vacuums on every cleanup pass.',
  'Daily lockdown, Work area sealed at end of day. Debris bagged and tied off.',
  'Cleaning verification, Wet-clean, HEPA-vac, wet-clean again, then a wipe-test against EPA’s clearance card.',
  'Documentation: Signed work plan, Renovate Right pamphlet, and post-job verification record.',
];
function _byoShowPage(){
  _tmHidePage(); // must run first, it re-shows gei-old-tbar; the shared chrome re-hides it
  const b=_geiShowSharedChrome('byo');
  // Load items from saved bid, otherwise start blank
  if(b?.byoItems&&b.byoItems.length){_byoItems=b.byoItems.map(x=>({...x}));}
  else{_byoItems=[];}
  _byoCustomSections=b?.byoCustomSections?[...b.byoCustomSections]:[];
  _byoCustomTerms=b?.byoCustomTerms||'';
  _estCrew=Array.isArray(b&&b.estCrew)?[...b.estCrew]:[];
  _injectRrpItems();
  _byoRenderSections();
  _byoUpdateRail(); // also renders the auto crew-labor cost line
  _renderScopeChips('byo-scope-wrap');
}
function _byoHidePage(){_geiHidePage('gei-byo-page');}
function _toggleScopeChip(label){
  _geiScopeNoScope=false;
  const idx=_geiScopeChips.indexOf(label);
  if(idx>=0)_geiScopeChips.splice(idx,1);else _geiScopeChips.push(label);
  ['tm-scope-wrap','byo-scope-wrap'].forEach(id=>_renderScopeChips(id));
  _updateScopeSheetBtn(label);
  // Scope drives the auto crew-labor estimate, refresh the rail + gauge.
  if(_geiIsFreeForm&&typeof _byoUpdateRail==='function')_byoUpdateRail();
  _byoAutosave();
}
function _toggleScopeNone(){
  _geiScopeNoScope=!_geiScopeNoScope;
  if(_geiScopeNoScope)_geiScopeChips=[];
  ['tm-scope-wrap','byo-scope-wrap'].forEach(id=>_renderScopeChips(id));
  _byoAutosave();
}
function _updateScopeSheetBtn(label){
  if(!label||typeof label!=='string')return;
  const sid='_scb-'+label.replace(/[^a-z0-9]/gi,'_');
  const btn=document.getElementById(sid);if(!btn)return;
  const on=_geiScopeChips.includes(label);
  btn.style.borderColor=on?'var(--blue)':'var(--border2)';
  btn.style.background=on?'var(--blue-lt,#e6f0fb)':'var(--bg-card,var(--bg2))';
  const lbl=btn.querySelector('._sc-lbl');if(lbl)lbl.style.color=on?'var(--blue)':'var(--text)';
  const ck=btn.querySelector('._sc-ck');
  if(ck){ck.style.background=on?'var(--blue)':'transparent';ck.style.borderColor=on?'var(--blue)':'var(--border2)';ck.innerHTML=on?svgIcon('✓',{size:9,color:'#fff'}):'';}
}
function _renderScopeChips(containerId){
  const wrap=document.getElementById(containerId);if(!wrap)return;
  wrap.style.display='block';
  const trade=_geiTrade||getActiveTrade();
  const tradeItems=(typeof TRADE_SCOPE_ITEMS!=='undefined'&&TRADE_SCOPE_ITEMS[trade])||TRADE_SCOPE_CHIPS[trade]||[];
  const allItems=[..._GEN_SCOPE,...tradeItems];
  if(!_geiScopeChips.length){
    if(_geiScopeNoScope){
      wrap.innerHTML='<div style="padding:12px 16px;display:flex;flex-wrap:wrap;gap:6px">'+
        '<span onclick="_toggleScopeNone()" style="display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border-radius:20px;background:var(--blue-lt,#e6f0fb);color:var(--blue);border:1.5px solid var(--blue);font-size:12px;font-weight:700;cursor:pointer">&#8709; None<span style="font-size:11px;font-weight:900;opacity:.6;margin-left:2px">&#xd7;</span></span>'+
      '</div>';
    }else{
      wrap.innerHTML='<div style="padding:10px 16px">'+
        '<button type="button" onclick="_openScopeSheet(\''+containerId+'\')" style="display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:20px;background:var(--bg2);border:1.5px dashed var(--border2);font-size:13px;font-weight:600;color:var(--text3);cursor:pointer;font-family:inherit">'+
        '<span style="font-size:16px;line-height:1">+</span> Add scope of work</button>'+
      '</div>';
    }
    return;
  }
  // Render selected scope as clean line items (not pills), one per row with a divider.
  let html='<div style="padding:4px 0">';
  _geiScopeChips.forEach((l,i)=>{
    const c=allItems.find(x=>x.label===l)||{icon:'✓',label:l};
    const border=i<_geiScopeChips.length-1?'border-bottom:1px solid var(--border)':'';
    html+='<div style="display:flex;align-items:center;gap:11px;padding:11px 16px;'+border+'">'+
      '<span style="font-size:17px;line-height:1;flex-shrink:0">'+svgIcon(c.icon||'✓',{size:17})+'</span>'+
      '<span style="flex:1;min-width:0;font-size:13px;font-weight:700;color:var(--text);line-height:1.35">'+escHtml(c.label)+'</span>'+
      '<button type="button" onclick="_toggleScopeChip('+escHtml(JSON.stringify(l))+')" aria-label="Remove '+escHtml(c.label)+'" style="flex-shrink:0;border:none;background:none;color:var(--text3);font-size:18px;font-weight:700;cursor:pointer;padding:2px 6px;line-height:1;font-family:inherit">×</button>'+
    '</div>';
  });
  html+='</div>';
  wrap.innerHTML=html;
}
function _openScopeSheet(containerId){
  document.getElementById('_scope-sheet-ov')?.remove();
  const ov=document.createElement('div');ov.className='zmodal-overlay';ov.id='_scope-sheet-ov';
  ov.onclick=e=>{if(e.target===ov)ov.remove();};
  const trade=_geiTrade||getActiveTrade();
  const tradeItems=(typeof TRADE_SCOPE_ITEMS!=='undefined'&&TRADE_SCOPE_ITEMS[trade]);
  // Centered like every other modal in the app (.zmodal: fade+slide+scale via
  // the shared td-modal-in keyframe, §8.4): this used to hardcode
  // position:fixed;bottom:0, pinning it to the viewport bottom and overriding
  // .zmodal-overlay's centering instead of using the shared modal pattern.
  const sheet=document.createElement('div');
  sheet.className='zmodal';
  sheet.style.cssText='max-width:480px;max-height:80vh;overflow-y:auto';
  let itemsHtml;
  if(tradeItems&&tradeItems.length){
    const allItems=[..._GEN_SCOPE,...tradeItems];
    itemsHtml='<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'+
      allItems.map(s=>{
        const on=_geiScopeChips.includes(s.label);
        const sid='_scb-'+s.label.replace(/[^a-z0-9]/gi,'_');
        return '<div id="'+sid+'" onclick="_toggleScopeChip('+escHtml(JSON.stringify(s.label))+')" style="display:flex;align-items:center;gap:10px;padding:12px 13px;border-radius:14px;border:1.5px solid '+(on?'var(--blue)':'var(--border2)')+';background:'+(on?'var(--blue-lt,#e6f0fb)':'var(--bg-card,var(--bg2))')+';cursor:pointer;-webkit-tap-highlight-color:transparent;transition:background .14s,border-color .14s;min-height:52px">'+
          '<span style="font-size:19px;line-height:1;flex-shrink:0">'+svgIcon(s.icon||'✓',{size:19})+'</span>'+
          '<span class="_sc-lbl" style="font-size:13px;font-weight:700;color:'+(on?'var(--blue)':'var(--text)')+';flex:1;line-height:1.25">'+escHtml(s.label)+'</span>'+
          '<span class="_sc-ck" style="flex-shrink:0;width:20px;height:20px;border-radius:50%;border:1.5px solid '+(on?'var(--blue)':'var(--border2)')+';background:'+(on?'var(--blue)':'transparent')+';display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:900;color:#fff">'+(on?svgIcon('✓',{size:9,color:'#fff'}):'')+'</span>'+
        '</div>';
      }).join('')+
    '</div>';
  }else{
    const chips=[..._GEN_SCOPE,...(TRADE_SCOPE_CHIPS[trade]||[])];
    itemsHtml='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px">'+
      chips.map(c=>{
        const on=_geiScopeChips.includes(c.label);
        const sid='_scb-'+c.label.replace(/[^a-z0-9]/gi,'_');
        return '<button type="button" id="'+sid+'" onclick="_toggleScopeChip('+escHtml(JSON.stringify(c.label))+')" style="display:flex;align-items:center;gap:10px;text-align:left;padding:11px 12px;border-radius:14px;border:1.5px solid '+(on?'var(--blue)':'var(--border2)')+';background:'+(on?'var(--blue-lt,#e6f0fb)':'var(--bg-card,var(--bg2))')+';cursor:pointer;font-family:inherit;min-height:52px;-webkit-tap-highlight-color:transparent;transition:background .14s,border-color .14s">'+
          '<span style="font-size:19px;line-height:1;flex-shrink:0">'+svgIcon(c.icon,{size:19})+'</span>'+
          '<span class="_sc-lbl" style="font-size:13px;font-weight:600;color:'+(on?'var(--blue)':'var(--text)')+';flex:1;line-height:1.25">'+escHtml(c.label)+'</span>'+
          '<span class="_sc-ck" style="flex-shrink:0;width:20px;height:20px;border-radius:50%;border:1.5px solid '+(on?'var(--blue)':'var(--border2)')+';background:'+(on?'var(--blue)':'transparent')+';display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:900;color:#fff">'+(on?svgIcon('✓',{size:9,color:'#fff'}):'')+'</span>'+
        '</button>';
      }).join('')+
    '</div>';
  }
  sheet.innerHTML=
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">'+
    '<div style="font-size:15px;font-weight:800">Scope of work</div>'+
    '<button onclick="document.getElementById(\'_scope-sheet-ov\').remove()" style="padding:6px 18px;border-radius:20px;border:none;background:var(--blue);color:#fff;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">Done</button>'+
    '</div>'+itemsHtml;
  ov.appendChild(sheet);document.body.appendChild(ov);
}
// Shared Edit/Remove button pair for a line-item row, used by both BYO's
// item rows and T&M's material category rows so the two lists look and
// behave identically. event.stopPropagation() keeps a wrapping row-level
// onclick (BYO toggles on/off; T&M opens edit) from also firing.
function _geiRowActionBtns(editCall,delCall,delTitle){
  return '<button onclick="event.stopPropagation();'+editCall+'" title="Edit" style="background:none;border:1px solid var(--border2);border-radius:6px;padding:4px 8px;font-size:12px;cursor:pointer;font-family:inherit;color:var(--blue);touch-action:manipulation">Edit</button>'+
    '<button onclick="event.stopPropagation();'+delCall+'" title="'+(delTitle||'Remove')+'" style="background:none;border:1px solid var(--border2);border-radius:6px;padding:4px 8px;font-size:12px;cursor:pointer;font-family:inherit;color:#A32D2D;touch-action:manipulation">'+svgIcon('✕',{size:12})+'</button>';
}
function _editEstTitle(titleId,btnId){
  const titleEl=document.getElementById(titleId);
  const btn=document.getElementById(btnId);
  if(!titleEl||titleEl.querySelector('input'))return;
  const prev=titleEl.textContent.trim();
  const inp=document.createElement('input');
  inp.type='text';inp.value=prev;
  inp.style.cssText='font-family:var(--font-display);font-size:inherit;font-weight:900;letter-spacing:-1.2px;color:var(--text);background:transparent;border:none;border-bottom:2px solid var(--blue);outline:none;width:240px;max-width:55vw;padding:0 0 2px;line-height:1';
  titleEl.textContent='';titleEl.appendChild(inp);
  if(btn)btn.style.opacity='0';
  inp.focus();inp.select();
  let _done=false;
  const commit=()=>{
    if(_done)return;_done=true;
    const val=inp.value.trim()||prev;
    titleEl.textContent=val;
    if(btn)btn.style.opacity='';
    const descEl=document.getElementById('gei-desc');if(descEl)descEl.value=val;
  };
  const cancel=()=>{
    if(_done)return;_done=true;
    titleEl.textContent=prev;
    if(btn)btn.style.opacity='';
  };
  inp.addEventListener('blur',commit);
  inp.addEventListener('keydown',e=>{
    if(e.key==='Enter'){e.preventDefault();inp.removeEventListener('blur',commit);commit();}
    if(e.key==='Escape'){e.preventDefault();inp.removeEventListener('blur',commit);cancel();}
  });
}
function _editByoTitle(){_editEstTitle('byo-tbar-title','byo-edit-title-btn');}
function _editTMTitle(){_editEstTitle('tm-tbar-title','tm-edit-title-btn');}
function _editScopeTitle(){_editEstTitle('gei-trade-title','scope-edit-title-btn');}
// Shared item-row renderer, one row shape for BYO items (checkbox toggle +
// edit/delete) and T&M material categories (no checkbox, add/edit/delete only):
// title + price + actions on one header line; notes (if present) run full-width
// below that line instead of being squeezed into a narrow left column next to
// empty grey space under the price/action buttons.
function _geiItemRowHtml(opts){
  const{label,notes,price,editFn,delFn,delTitle,checked,rowOnclick,extraClass}=opts;
  const checkHtml=checked!==undefined?'<div class="byo-check'+(checked?' on':'')+'">'+(checked?svgIcon('✓',{size:14}):'')+'</div>':'';
  return '<div class="byo-row'+(checked?' on':'')+(extraClass?' '+extraClass:'')+'"'+(rowOnclick?' onclick="'+rowOnclick+'"':'')+'>'+
    '<div class="byo-row-hd">'+
      checkHtml+
      '<div class="byo-label">'+escHtml(label)+'</div>'+
      '<div class="byo-price">$'+price.toLocaleString()+'</div>'+
      '<div style="display:flex;gap:4px;flex-shrink:0;margin-left:6px">'+
        _geiRowActionBtns(editFn,delFn,delTitle)+
      '</div>'+
    '</div>'+
    (notes?'<div class="byo-meta" style="font-size:11px;color:var(--text-3)">'+escHtml(notes)+'</div>':'')+
  '</div>';
}
function _byoRenderSections(){
  _injectRrpItems();
  const wrap=document.getElementById('byo-sections');if(!wrap)return;
  const extraFromItems=_byoItems.map(x=>x.section).filter(s=>!_BYO_DEFAULT_SECTIONS.includes(s));
  const allExtra=[..._byoCustomSections,...extraFromItems.filter(s=>!_byoCustomSections.includes(s))];
  const sections=[..._BYO_DEFAULT_SECTIONS,...new Set(allExtra)];
  const secHtml=sections.map(sec=>{
    const rows=_byoItems.filter(it=>it.section===sec);
    const isCustom=!_BYO_DEFAULT_SECTIONS.includes(sec);
    const rowHtml=rows.length?rows.map(it=>{
      const idx=_byoItems.indexOf(it);
      return _geiItemRowHtml({
        checked:it.on,rowOnclick:'_byoToggle('+idx+')',
        label:it.label,notes:(it.notes&&!it._rrp)?it.notes:'',price:it.price,
        editFn:'_byoEditItem('+idx+')',delFn:'_byoDelItem('+idx+')'
      });
    }).join(''):
    '<div style="padding:14px 16px;font-size:12px;color:var(--text-3);font-style:italic">No items yet, tap + Add item</div>';
    return '<div class="card card-pad-0" style="margin-bottom:12px">'+
      '<div class="card-hd"><div class="card-hd-title">'+escHtml(sec)+'</div>'+
      '<div style="display:flex;gap:6px">'+
        (isCustom?'<button class="btn btn-sm" data-sec="'+escHtml(sec)+'" onclick="_byoDeleteSection(this.dataset.sec)" style="color:#A32D2D;border-color:#A32D2D" title="Remove section">'+svgIcon('✕',{size:12})+'</button>':'')+
        '<button class="btn btn-sm" data-sec="'+escHtml(sec)+'" onclick="_byoAddItem(this.dataset.sec)">+ Add item</button>'+
      '</div></div>'+
      '<div>'+rowHtml+'</div>'+
    '</div>';
  }).join('');
  const addSecBtn='<div style="margin-bottom:12px">'+
    '<button class="btn btn-ghost btn-full" onclick="_byoAddSection()" style="border:1.5px dashed var(--border2)">+ Add section</button>'+
  '</div>';
  const tcCard='<div class="card card-pad-0" style="margin-bottom:12px">'+
    '<div class="card-hd"><div class="card-hd-title">'+svgIcon('📋',{size:14})+' Terms &amp; Conditions</div></div>'+
    '<div style="padding:12px 14px">'+
      '<div style="font-size:11px;color:var(--text-3);margin-bottom:8px">Custom terms print on the proposal below the standard payment terms.</div>'+
      '<textarea id="byo-custom-terms" rows="5" placeholder="e.g. All paint supplied by client. Contractor not responsible for pre-existing damage to surfaces..." '+
        'oninput="_byoCustomTerms=this.value;_byoAutosave()" '+
        'style="width:100%;padding:10px 12px;border:1.5px solid var(--border2);border-radius:var(--r);font-size:13px;font-family:inherit;background:var(--bg2);color:var(--text);resize:vertical;box-sizing:border-box;line-height:1.5">'+escHtml(_byoCustomTerms||'')+'</textarea>'+
    '</div>'+
  '</div>';
  wrap.innerHTML=secHtml+addSecBtn+tcCard;
}
function _byoToggle(idx){
  if(_byoItems[idx]&&!_byoItems[idx].required){_byoItems[idx].on=!_byoItems[idx].on;_byoRenderSections();_byoUpdateRail();_byoAutosave();}
}
function _byoAutosave(){
  if(!_geiEditBidId)return;
  const b=bids.find(x=>x.id===_geiEditBidId);
  if(!b)return;
  // "Name your proposal" (#gei-desc) used to only get captured by the explicit Save
  // button (saveGenericEstimate): every autosave silently dropped a name edit until
  // the user hit Save, so backing out mid-edit lost the new name.
  const _trade=_geiTrade||getActiveTrade();
  const _typeLabel=_geiIsTM?'Time & Materials Proposal':_geiIsFreeForm?'Custom Proposal':(TRADE_META[_trade]?.label||'Trade')+' Proposal';
  const _descVal=document.getElementById('gei-desc')?.value||'';
  b.type=_descVal||_typeLabel;
  b.geiDesc=_descVal;
  b.byoItems=JSON.parse(JSON.stringify(_byoItems));
  b.byoCustomSections=[..._byoCustomSections];
  // Stamp the bid's REAL type, this used to write isFreeForm=true on every
  // autosave, so a Time & Materials draft carried BOTH flags and resumed as
  // Build Your Own with empty items (the "my work disappeared" bug).
  b.isFreeForm=_geiIsFreeForm&&!_geiIsTM;
  b.estCrew=[..._estCrew];
  b.scopeChips=[..._geiScopeChips];
  b.scopeNoScope=_geiScopeNoScope||false;
  const _termsEl=document.getElementById('byo-custom-terms');
  if(_termsEl)b.byoCustomTerms=_termsEl.value;
  const {total}=calcGeiTotal();
  if(total>0){
    b.amount=total;
    b.deposit=Math.round(total*_geiDepositPct()/100);
  }
  if(_geiIsTM){
    b.isTM=true;
    b.isFreeForm=false;
    b.tmCrewCount=_tmCrewCount;
    b.tmRatePerMan=_tmRatePerMan;
    b.tmEstHours=_tmEstHours;
    b.tmBillingCycle=_tmBillingCycle;
    // T&M's actual content lives in _geiLines (labor line + material categories)
    //, without this, autosave captured the rate/crew numbers but silently
    // dropped every material category until the user hit "Save draft".
    b.geiLines=JSON.parse(JSON.stringify(_geiLines));
    const _nteCap=(typeof _moneyVal==='function'?_moneyVal('tm-i-nte'):0)||0;
    b.tmNteCap=_nteCap;
    b.tmNteEnabled=_nteCap>0;
    b.tmCapAction=document.getElementById('tm-i-cap-action')?.value||_tmCapAction||'';
  }
  saveAll();
  _geiMarkActive(); // keep the auto-resume marker fresh on every save
}
function _injectRrpItems(){
  const _rrpC=_geiClientId?clients.find(c=>c.id===_geiClientId):null;
  const _clientRrp=_rrpC?.rrpDisturb==='yes';
  if((typeof _rrpPaintAnswer==='undefined'||_rrpPaintAnswer!=='yes')&&!_clientRrp)return;
  if(_clientRrp&&(typeof _rrpPaintAnswer==='undefined'||_rrpPaintAnswer!=='yes'))_rrpPaintAnswer='yes';
  if(_geiIsFreeForm){
    // Determine which scopes have work (ignore existing RRP items)
    const workItems=_byoItems.filter(x=>!x._rrp);
    const workSections=workItems.map(x=>(x.section||'').toLowerCase());
    const hasInterior=workItems.length===0||workSections.some(s=>/(interior|inside|trim|wall|drywall|ceiling)/i.test(s));
    const hasExterior=workItems.length>0&&workSections.some(s=>/(exterior|outside|siding|fascia|deck|fence|eave)/i.test(s));
    // Preserve prices the contractor may have already entered
    const priceMap=Object.fromEntries(_byoItems.filter(x=>x._rrp).map(x=>[x.label,x.price]));
    // Remove and re-sync so adding an Exterior section auto-adds exterior containment
    _byoItems=_byoItems.filter(x=>!x._rrp);
    _byoCustomSections=_byoCustomSections.filter(s=>s!==_RRP_BYO_SECTION);
    const toInject=_RRP_ITEMS.filter(r=>{
      if(r._scope==='interior')return hasInterior;
      if(r._scope==='exterior')return hasExterior;
      return true;
    });
    if(toInject.length>0){
      _byoCustomSections.push(_RRP_BYO_SECTION);
      let nid=(workItems.reduce((m,x)=>Math.max(m,x.id||0),0))+1;
      toInject.forEach(r=>{_byoItems.push({id:nid++,section:_RRP_BYO_SECTION,label:r.label,price:priceMap[r.label]||0,notes:r.hint,on:true,required:false,_rrp:true});});
    }
  }
  if(_geiIsTM&&!_geiLines.some(x=>x._rrp)){
    _RRP_ITEMS.forEach(r=>{_geiLines.push({desc:r.label,notes:r.hint,qty:1,unit:'lot',rate:0,total:0,_rrp:true});});
  }
}
// True if the contractor has at least one team member on payroll.
function _hasEmployees(){return !!(typeof S!=='undefined'&&Array.isArray(S.employees)&&S.employees.length);}
// Median of the contractor's own recorded hours for a scope (from past job debriefs), or null.
function _scopeHistoryHrs(id){
  const h=(typeof S!=='undefined'&&S.scopeHistory&&S.scopeHistory[id])||[];
  const vals=h.map(x=>x&&x.hrs).filter(v=>typeof v==='number'&&v>0).sort((a,b)=>a-b);
  if(!vals.length)return null;
  const m=Math.floor(vals.length/2);
  return vals.length%2?vals[m]:(vals[m-1]+vals[m])/2;
}
// Estimated crew hours for this bid, derived automatically from the selected scope:
// the contractor's own debrief history first, then the crowdsourced benchmark median.
// Returns 0 when no scope has time data yet (the gauge stays materials-only until it does).
function _estLaborHours(){
  // T&M knows its hours exactly (days × 8 × the contractor's own entry), no
  // scope-history estimation needed. This one branch makes the entire crew
  // picker + payroll-cost stack (_estLaborCost, _renderLaborPicker) work for
  // both estimate types without duplicating any of it.
  if(_geiIsTM)return _tmEstHours||0;
  const trade=_geiTrade||(typeof getActiveTrade==='function'?getActiveTrade():'painting');
  const allItems=[..._GEN_SCOPE,...((typeof TRADE_SCOPE_ITEMS!=='undefined'&&TRADE_SCOPE_ITEMS[trade])||[])];
  let hrs=0;
  (_geiScopeChips||[]).forEach(label=>{
    const item=allItems.find(x=>x.label===label);
    if(!item||!item.id)return;
    const own=_scopeHistoryHrs(item.id);
    if(own!=null){hrs+=own;return;}
    const rate=(typeof window!=='undefined'&&window._scopeRates)?window._scopeRates[item.id+':'+trade]:null;
    if(rate&&rate.sample_count>=5&&rate.median_min>0)hrs+=rate.median_min/60;
  });
  return Math.round(hrs*10)/10;
}
// Trust signal for ranking crew, lifetime jobs worked + total dollar value of those jobs.
// Uses the durable crewHistory recorded on each job (falls back to current assignment).
function _employeeTrust(emp){
  const eid=String(emp&&emp.id);
  let count=0,dollars=0;
  (typeof jobs!=='undefined'?jobs:[]).forEach(j=>{
    const inHist=Array.isArray(j.crewHistory)&&j.crewHistory.map(String).includes(eid);
    if(!inHist&&String(j.assignedTo)!==eid)return;
    count++;
    const bid=(j.bid_id&&typeof bids!=='undefined')?bids.find(b=>b.id===j.bid_id):null;
    dollars+=((bid&&bid.amount)||j.amount||0);
  });
  return {count,dollars};
}
// Order employees most-trusted first: by lifetime job count, then lifetime dollars, then name.
function _crewByTrust(emps){
  return [...emps].map(e=>({e,t:_employeeTrust(e)}))
    .sort((a,b)=>(b.t.count-a.t.count)||(b.t.dollars-a.t.dollars)||((a.e.name||'').localeCompare(b.e.name||'')))
    .map(x=>x.e);
}
// Returns the nearest upcoming job already booked for this employee (start >= today,
// not canceled/completed). Used to show calendar-availability warnings in the crew picker.
function _empNextJob(emp){
  if(!emp)return null;
  const eid=String(emp.id);
  const tk=typeof todayKey==='function'?todayKey():'';
  const jobList=typeof jobs!=='undefined'?jobs:[];
  const upcoming=jobList.filter(j=>{
    if(!j.start||j.start<tk)return false;
    if(j.status==='canceled'||j.status==='completed')return false;
    const inCrew=Array.isArray(j.crewHistory)&&j.crewHistory.map(String).includes(eid);
    return String(j.assignedTo)===eid||inCrew;
  }).sort((a,b)=>(a.start||'').localeCompare(b.start||''));
  return upcoming[0]||null;
}
function _shortDate(d){
  if(!d)return'';
  try{const dt=new Date(d+'T12:00:00');return dt.toLocaleDateString('en-US',{month:'short',day:'numeric'});}catch(e){return d;}
}
// Loaded hourly rate (wage × payroll burden) for one employee email, from the pay-rate cache.
function _empLoadedFor(email){
  const comp=(typeof _teamComp!=='undefined'&&_teamComp)?_teamComp[(email||'').toLowerCase()]:null;
  return (comp&&typeof _empLoadedHourly==='function')?_empLoadedHourly(comp):0;
}
// Crew payroll the owner pays out of this bid = job hours × the loaded rate of EACH assigned
// crew member (so two people cost ~2× one). Solo operators (no crew assigned) → 0, since their
// labor is already priced into the line items. Hours come automatically from the scope.
function _estLaborCost(){
  if(!_hasEmployees()||!_estCrew.length)return 0;
  const hrs=_estLaborHours();
  if(hrs<=0)return 0;
  const crewRate=_estCrew.reduce((s,email)=>s+_empLoadedFor(email),0);
  return Math.round(hrs*crewRate);
}
// Toggle an employee on/off this job's crew, then refresh the expense + gauge.
// Mode-aware: T&M refreshes through _tmInputChange, BYO through _byoUpdateRail.
function _toggleCrewMember(email){
  email=(email||'').toLowerCase();
  const i=_estCrew.indexOf(email);
  if(i>=0)_estCrew.splice(i,1);else _estCrew.push(email);
  const costEl=document.getElementById(_geiIsTM?'tm-expected-cost':'byo-expected-cost');
  if(costEl)delete costEl.dataset.userSet; // crew payroll drives the cost now
  if(_geiIsTM){if(typeof _tmInputChange==='function')_tmInputChange();return;} // _tmInputChange autosaves
  if(typeof _byoUpdateRail==='function')_byoUpdateRail();
  if(typeof _byoAutosave==='function')_byoAutosave();
}
// Render the crew picker + red payroll-expense figure into {type}-labor-cost-wrap.
// Hidden entirely when there are no employees (solo operator → cost is materials only).
function _renderLaborPicker(type){
  const wrap=document.getElementById(type+'-labor-cost-wrap');
  if(!wrap)return;
  if(!_hasEmployees()){wrap.style.display='none';wrap.innerHTML='';return;}
  // Pull fresh pay rates once if the cache is empty (RLS-gated; owner/payroll-manager only).
  if(typeof _loadTeamComp==='function'&&typeof _teamCompLoaded!=='undefined'&&!_teamCompLoaded){
    _teamCompLoaded=true;
    _loadTeamComp().then(()=>{if(type==='byo'&&typeof _byoUpdateRail==='function')_byoUpdateRail();}).catch(()=>{});
  }
  // Most-trusted crew first, ranked by lifetime jobs worked, then dollars handled.
  const emps=_crewByTrust((S.employees||[]).filter(e=>e&&e.name));
  const chips=emps.map((e,i)=>{
    const email=(e.email||'').toLowerCase();
    const on=_estCrew.indexOf(email)>=0;
    const first=(e.name||'').split(' ')[0]||e.name;
    const t=_employeeTrust(e);
    const star=i===0&&t.count>0?svgIcon('★',{size:11})+' ':''; // top-ranked, proven crew
    const jobsTag=t.count>0?'<span style="opacity:.6;font-weight:600"> · '+t.count+'</span>':'';
    const nj=_empNextJob(e);
    const bookedTag=nj?'<span style="opacity:.75;font-weight:600;color:#B45309"> · '+_shortDate(nj.start)+'</span>':'';
    const titleTxt=t.count+' jobs · '+fmt(t.dollars)+' lifetime'+(nj?' · Booked '+_shortDate(nj.start):'· Available');
    const borderColor=on?'#A32D2D':nj?'#D97706':'var(--border2)';
    const bgColor=on?'#FEF2F2':nj?'#FFFBEB':'var(--bg)';
    const textColor=on?'#A32D2D':nj?'#92400E':'var(--text2)';
    return '<span onclick="_toggleCrewMember('+escHtml(JSON.stringify(email))+')" title="'+titleTxt+'" style="display:inline-flex;align-items:center;gap:4px;padding:4px 9px;border-radius:14px;font-size:11px;font-weight:700;cursor:pointer;border:1.5px solid '+borderColor+';background:'+bgColor+';color:'+textColor+'">'+(on?'−':'+')+' '+star+escHtml(first)+jobsTag+bookedTag+'</span>';
  }).join('');
  const hrs=_estLaborHours();
  const cost=_estLaborCost();
  let body;
  // Check if any selected crew member has an upcoming booking conflict.
  const bookedSelected=emps.filter(e=>_estCrew.indexOf((e.email||'').toLowerCase())>=0&&_empNextJob(e));
  if(!_estCrew.length){
    body='<span style="color:var(--text3)">Tap a name to add who\'s on this job, their pay + benefits become a job cost.</span>';
  }else if(cost<=0){
    body='<span style="color:var(--c-amber)">Set pay rates on the Team page (or build job-time history) to price this crew.</span>';
  }else{
    const ppl=_estCrew.length;
    const conflictNote=bookedSelected.length?'<div style="margin-top:4px;font-size:10px;color:#B45309">'+svgIcon('⚠',{size:10})+' '+bookedSelected.map(e=>(e.name||'').split(' ')[0]+' has a job '+_shortDate(_empNextJob(e).start)).join(' · ')+'</div>':'';
    body='<span style="color:#A32D2D;font-weight:800;font-size:14px">− '+fmt(cost)+'</span>'+
      '<span style="color:var(--text3)"> crew payroll · '+ppl+' '+(ppl>1?'people':'person')+' · ~'+hrs+' hrs · incl. benefits</span>'+conflictNote;
  }
  wrap.style.display='';
  wrap.innerHTML=
    '<div class="td-micro" style="margin-bottom:6px">Crew on this job <span style="font-weight:500;color:var(--text3);text-transform:none;letter-spacing:0">(their pay is your cost)</span></div>'+
    '<div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:7px">'+chips+'</div>'+
    '<div style="font-size:11px;line-height:1.5;min-height:14px">'+body+'</div>'+
    '<div class="summary-divider"></div>';
}
function _updateMarginGauge(type,total){
  const gWrap=document.getElementById(type+'-profit-gauge');
  if(!gWrap)return;
  const hint=document.getElementById(type+'-gauge-hint');
  const cost=parseFloat(document.getElementById(type+'-expected-cost')?.value)||0;
  if(!cost||cost<=0||!total||total<=0){
    // Cancel any in-flight show animation so a pending rAF can't flip opacity back
    // to '1' after we start hiding (was a flaky-test + visual-flicker source).
    if(gWrap._showRaf){cancelAnimationFrame(gWrap._showRaf);gWrap._showRaf=0;}
    gWrap.style.opacity='0';
    // Gate the hide on the REAL condition (cost still cleared) rather than the
    // race-prone opacity value, deterministic regardless of stray animations.
    setTimeout(()=>{
      const _c=parseFloat(document.getElementById(type+'-expected-cost')?.value)||0;
      if(!_c||_c<=0)gWrap.style.display='none';
    },340);
    if(hint)hint.style.display='';
    return;
  }
  if(hint)hint.style.display='none';
  const margin=Math.round((total-cost)/total*100);
  // Dot sits at its own margin % along the bar so its position matches the gradient
  // colour beneath it (red=low margin on the left → green band → amber when very high).
  const pos=Math.min(Math.max(margin,2),98);
  let color,msg;
  if(margin<0){color='#DC2626';msg='Below cost, you’re losing money on this job';}
  else if(margin<22){color='#EF4444';msg='Underpriced: consider raising your rate';}
  else if(margin<35){color='#F59E0B';msg='Below target, a bit of room to grow';}
  else if(margin<55){color='#22C55E';msg='Priced right, solid margin for this job';}
  // Owner call (2026-07-06): green ending at 75% read as "everything's fine" on
  // margins that usually mean a cost got missed, green now tops out at 55%.
  else if(margin<75){color='#F59E0B';msg='High margin, double-check your cost numbers';}
  else{color='#F59E0B';msg='Very high margin, double-check your numbers';}
  const dot=document.getElementById(type+'-gauge-dot');
  const pct=document.getElementById(type+'-gauge-pct');
  const msgEl=document.getElementById(type+'-gauge-msg');
  const wasHidden=gWrap.style.display==='none'||!parseFloat(gWrap.style.opacity||'0');
  if(wasHidden){
    gWrap.style.display='';
    if(dot){dot.style.transition='none';dot.style.left='50%';dot.style.boxShadow='0 0 0 3px rgba(100,100,100,.2),0 2px 6px rgba(0,0,0,.12)';}
    // Track the rAF handle so a subsequent hide can cancel this pending show.
    gWrap._showRaf=requestAnimationFrame(()=>{gWrap._showRaf=requestAnimationFrame(()=>{
      gWrap._showRaf=0;
      gWrap.style.opacity='1';
      if(dot){
        dot.style.transition='left .6s cubic-bezier(.22,1,.36,1),box-shadow .4s ease';
        dot.style.left=pos+'%';
        dot.style.boxShadow='0 0 0 3px '+color+',0 2px 8px rgba(0,0,0,.25)';
      }
    });});
  }else{
    if(dot){dot.style.left=pos+'%';dot.style.boxShadow='0 0 0 3px '+color+',0 2px 8px rgba(0,0,0,.25)';}
  }
  const profit=total-cost;
  const profitFmt='$'+Math.round(profit).toLocaleString('en-US');
  const dollarsEl=document.getElementById(type+'-gauge-dollars');
  if(pct){pct.textContent=margin+'%';pct.style.color=color;}
  if(dollarsEl){dollarsEl.textContent=profitFmt+' profit';dollarsEl.style.color=color==='#22C55E'?'var(--text3)':color;}
  if(msgEl){msgEl.textContent=msg;msgEl.style.color=color==='#22C55E'?'var(--text3)':color;}
}
function _byoDelItem(idx){
  if(_byoItems[idx]&&!_byoItems[idx].required){_byoItems.splice(idx,1);_byoRenderSections();_byoUpdateRail();_byoAutosave();}
}
function _byoUpdateRail(){
  const selected=_byoItems.filter(it=>it.on);
  const sub=selected.reduce((s,it)=>s+it.price,0);
  _geiLines=selected.map(it=>({desc:it.label,qty:1,unit:'ea',rate:it.price,total:it.price,notes:it.notes||'',_byoSection:it.section,_rrp:it._rrp||false}));

  // Sales tax
  let salesTax=0;
  const _stKey=(typeof detectStateFromAddr==='function'?detectStateFromAddr(document.getElementById('gei-addr')?.value||''):null)||(S&&S.state)||'KS';
  const _stRate=_geiClientTaxRate!==null?(_geiClientTaxRate.rate??0):(parseFloat(S&&S.salesTaxRate)||0);
  const taxRow=document.getElementById('byo-rail-tax-row');
  const taxAmt=document.getElementById('byo-rail-tax-amt');
  const taxLbl=document.getElementById('byo-rail-tax-lbl');
  if(_stRate>0&&typeof calcSalesTax==='function'&&sub>0){
    const _stScope=_geiJobScope||'repair';
    const _stResult=calcSalesTax({state:_stKey,tradeType:_geiTrade||'general',scope:_stScope,
      propertyType:_geiIsCommercial?'commercial':'residential',taxRate:_stRate,lineItems:_geiLines.map(l=>{
        const sec=(l._byoSection||'').toLowerCase();
        const lineType=sec==='materials'?'materials':(sec==='interior'||sec==='exterior')?'labor':null;
        return {desc:l.desc,total:l.total,lineType};
      })});
    salesTax=_stResult.taxAmount||0;
    if(taxRow&&taxAmt&&taxLbl){
      if(salesTax>0){
        const isFull=_stResult.treatment?.type==='service'||_stResult.treatment?.laborTaxable;
        taxLbl.textContent=isFull?'Sales tax ('+_stRate+'%)':'Materials tax ('+_stRate+'%)';
        taxAmt.textContent='$'+salesTax.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
        taxRow.style.display='';
      } else if(_stResult.treatment&&!_stResult.treatment.customerTax){
        taxLbl.textContent=_stScope==='improvement'?'Sales tax, capital improvement':'Sales tax (exempt)';
        taxAmt.textContent='$0.00';
        taxRow.style.display='';
      } else {
        if(taxRow)taxRow.style.display='none';
      }
    }
  } else {
    if(taxRow)taxRow.style.display='none';
  }

  const total=sub+salesTax;
  const depPct=_geiDepositPct()/100;
  const deposit=Math.round(total*depPct);
  const setT=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
  const fmt=n=>'$'+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  setT('byo-rail-sub',fmt(sub));
  setT('byo-rail-total',fmt(total));
  setT('byo-rail-deposit',fmt(deposit));
  setT('byo-rail-balance',fmt(total-deposit));
  // Expected cost = Materials line items + (when the contractor has employees) crew labor cost.
  // Solo operators have no employees, so labor is 0 and cost stays materials-only.
  const _matTotal=_byoItems.filter(it=>it.on&&!it._rrp&&(it.section||'').toLowerCase()==='materials').reduce((s,it)=>s+it.price,0);
  const _laborCost=(typeof _estLaborCost==='function')?_estLaborCost():0;
  const _autoCost=_matTotal+_laborCost;
  const _railCostEl=document.getElementById('byo-expected-cost');
  if(_railCostEl&&!_railCostEl.dataset.userSet){
    if(_autoCost>0){_railCostEl.value=_autoCost;_railCostEl.dataset.autoFilled='true';}
    else if(_railCostEl.dataset.autoFilled){_railCostEl.value='';delete _railCostEl.dataset.autoFilled;}
  }
  if(typeof _renderLaborPicker==='function')_renderLaborPicker('byo');
  // Margin is calculated on pre-tax revenue (sub): sales tax is pass-through to the
  // government and not the contractor's earnings, so including it inflates the margin.
  _updateMarginGauge('byo',sub);
}
// Comma-formats a BYO price field as the contractor types, native type="number"
// inputs reject commas outright in every browser, so this field is plain text
// with a digits-only filter + live thousands-grouping instead.
function _byaFormatPriceInput(el){
  const raw=(el.value||'').replace(/[^\d]/g,'');
  el.value=raw?Number(raw).toLocaleString('en-US'):'';
}
function _byaPriceValue(id){
  return parseFloat((document.getElementById(id)?.value||'').replace(/,/g,''))||0;
}
function _byoAddItem(sec){
  document.getElementById('_byo-add-modal')?.remove();
  const ov=document.createElement('div');ov.id='_byo-add-modal';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box';
  ov.innerHTML='<div style="background:var(--bg);border-radius:14px;width:100%;max-width:480px;padding:20px 16px 24px;max-height:90vh;overflow-y:auto">'+
    '<div style="font-weight:800;font-size:16px;margin-bottom:16px">Add to '+escHtml(sec)+'</div>'+
    '<div class="f" style="margin-bottom:10px"><label>What is it?</label><input type="text" id="_bya-label" placeholder="e.g. Bedroom 3, walls only"></div>'+
    '<div class="f" style="margin-bottom:10px"><label>Price ($)</label><div class="input-prefix"><span>$</span><input type="text" inputmode="numeric" id="_bya-price" placeholder="0" oninput="_byaFormatPriceInput(this)"></div></div>'+
    '<div class="f" style="margin-bottom:6px"><label>Notes <span style="font-weight:400;color:var(--text-3)">(optional)</span></label><textarea id="_bya-notes" rows="3" placeholder="e.g. Two coats, ceilings included" style="width:100%;box-sizing:border-box;resize:vertical;font-family:inherit"></textarea></div>'+
    '<div style="font-size:11px;color:var(--text-3);margin-bottom:14px">Tab from Notes to save &amp; add another</div>'+
    '<div style="display:flex;gap:10px">'+
      '<button onclick="document.getElementById(\'_byo-add-modal\')?.remove()" class="btn" style="flex:1">Cancel</button>'+
      '<button data-sec="'+escHtml(sec)+'" onclick="_byaConfirm(this.dataset.sec)" class="btn btn-p" style="flex:2">Add item</button>'+
    '</div></div>';
  document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  setTimeout(()=>{
    const labelEl=document.getElementById('_bya-label');
    const priceEl=document.getElementById('_bya-price');
    const notesEl=document.getElementById('_bya-notes');
    if(labelEl)labelEl.focus();
    // Tab from label → price (default), Tab from price → notes (default)
    // Tab or Enter from notes → save + open next
    if(notesEl){
      // Enter now makes a newline in the notes textarea, only Tab saves & advances.
      notesEl.addEventListener('keydown',e=>{
        if(e.key==='Tab'&&!e.shiftKey){
          e.preventDefault();
          _byaConfirmAndNext(sec);
        }
      });
    }
    // Enter on label or price → move to next field
    if(labelEl){
      labelEl.addEventListener('keydown',e=>{
        if(e.key==='Enter'){e.preventDefault();priceEl?.focus();}
      });
    }
    if(priceEl){
      priceEl.addEventListener('keydown',e=>{
        if(e.key==='Enter'){e.preventDefault();notesEl?.focus();}
      });
    }
  },50);
}
function _byaConfirm(sec){
  const label=(document.getElementById('_bya-label')?.value||'').trim();
  const price=_byaPriceValue('_bya-price');
  const notes=(document.getElementById('_bya-notes')?.value||'').trim();
  if(!label)return;
  const nextId=(_byoItems.reduce((m,x)=>Math.max(m,x.id),0))+1;
  _byoItems.push({id:nextId,section:sec,label,price,notes,on:true});
  document.getElementById('_byo-add-modal')?.remove();
  _byoRenderSections();_byoUpdateRail();_byoAutosave();
}
function _byaConfirmAndNext(sec){
  // Save current item (if label is filled) then immediately open a fresh modal for same section
  const label=(document.getElementById('_bya-label')?.value||'').trim();
  const price=_byaPriceValue('_bya-price');
  const notes=(document.getElementById('_bya-notes')?.value||'').trim();
  if(label){
    const nextId=(_byoItems.reduce((m,x)=>Math.max(m,x.id),0))+1;
    _byoItems.push({id:nextId,section:sec,label,price,notes,on:true});
    _byoRenderSections();_byoUpdateRail();_byoAutosave();
  }
  // Open next item modal for the same section
  _byoAddItem(sec);
}
function _byoEditItem(idx){
  const it=_byoItems[idx];if(!it)return;
  document.getElementById('_byo-add-modal')?.remove();
  const ov=document.createElement('div');ov.id='_byo-add-modal';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box';
  ov.innerHTML='<div style="background:var(--bg);border-radius:14px;width:100%;max-width:480px;padding:20px 16px 24px;max-height:90vh;overflow-y:auto">'+
    '<div style="font-weight:800;font-size:16px;margin-bottom:16px">Edit item</div>'+
    '<div class="f" style="margin-bottom:10px"><label>What is it?</label><input type="text" id="_bya-label" value="'+escHtml(it.label)+'" placeholder="e.g. Bedroom 3, walls only"></div>'+
    '<div class="f" style="margin-bottom:10px"><label>Price ($)</label><div class="input-prefix"><span>$</span><input type="text" inputmode="numeric" id="_bya-price" value="'+(it.price?Number(it.price).toLocaleString('en-US'):'')+'" placeholder="0" oninput="_byaFormatPriceInput(this)"></div></div>'+
    '<div class="f" style="margin-bottom:16px"><label>Notes <span style="font-weight:400;color:var(--text-3)">(optional)</span></label><textarea id="_bya-notes" rows="4" placeholder="e.g. Two coats, ceilings included" style="width:100%;box-sizing:border-box;resize:vertical;font-family:inherit">'+escHtml(it.notes||'')+'</textarea></div>'+
    '<div style="display:flex;gap:10px">'+
      '<button onclick="document.getElementById(\'_byo-add-modal\')?.remove()" class="btn" style="flex:1">Cancel</button>'+
      '<button onclick="_byaEditConfirm('+idx+')" class="btn btn-p" style="flex:2">Save changes</button>'+
    '</div></div>';
  document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  setTimeout(()=>{
    const labelEl=document.getElementById('_bya-label');
    const priceEl=document.getElementById('_bya-price');
    const notesEl=document.getElementById('_bya-notes');
    if(labelEl){
      labelEl.focus();
      labelEl.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();priceEl?.focus();}});
    }
    if(priceEl){priceEl.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();notesEl?.focus();}});}
    // Enter makes a newline in the notes textarea, Save changes button submits.
  },50);
}
function _byaEditConfirm(idx){
  const it=_byoItems[idx];if(!it)return;
  const label=(document.getElementById('_bya-label')?.value||'').trim();
  const price=_byaPriceValue('_bya-price');
  const notes=(document.getElementById('_bya-notes')?.value||'').trim();
  if(!label)return;
  it.label=label;it.price=price;it.notes=notes;
  document.getElementById('_byo-add-modal')?.remove();
  _byoRenderSections();_byoUpdateRail();_byoAutosave();
}
function _byoAddSection(){
  document.getElementById('_byo-sec-modal')?.remove();
  const ov=document.createElement('div');ov.id='_byo-sec-modal';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box';
  ov.innerHTML='<div style="background:var(--bg);border-radius:14px;width:100%;max-width:380px;padding:20px 16px 24px">'+
    '<div style="font-weight:800;font-size:16px;margin-bottom:16px">New section</div>'+
    '<div class="f" style="margin-bottom:16px"><label>Section name</label>'+
      '<input type="text" id="_byo-sec-name" placeholder="e.g. Prep work, Ceilings, Garage..."></div>'+
    '<div style="display:flex;gap:10px">'+
      '<button onclick="document.getElementById(\'_byo-sec-modal\')?.remove()" class="btn" style="flex:1">Cancel</button>'+
      '<button onclick="_byoConfirmSection()" class="btn btn-p" style="flex:2">Add section</button>'+
    '</div></div>';
  document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  setTimeout(()=>document.getElementById('_byo-sec-name')?.focus(),50);
}
function _byoConfirmSection(){
  const name=(document.getElementById('_byo-sec-name')?.value||'').trim();
  if(!name)return;
  const all=[..._BYO_DEFAULT_SECTIONS,..._byoCustomSections];
  if(all.map(s=>s.toLowerCase()).includes(name.toLowerCase())){
    const inp=document.getElementById('_byo-sec-name');
    if(inp){inp.style.borderColor='#A32D2D';inp.placeholder='That section already exists';}
    return;
  }
  _byoCustomSections.push(name);
  document.getElementById('_byo-sec-modal')?.remove();
  _byoRenderSections();_byoAutosave();
}
function _byoDeleteSection(sec){
  if(_BYO_DEFAULT_SECTIONS.includes(sec))return;
  const hasItems=_byoItems.some(x=>x.section===sec);
  const doDelete=()=>{
    _byoCustomSections=_byoCustomSections.filter(s=>s!==sec);
    _byoItems=_byoItems.filter(x=>x.section!==sec);
    _byoRenderSections();_byoUpdateRail();_byoAutosave();
  };
  if(hasItems){zConfirm('Remove the "'+sec+'" section and all its items?',doDelete,{title:'Remove section',yes:'Remove',danger:true});}
  else doDelete();
}
function _byoPreviewClient(){_geiPreviewClient();}
function _byoDuplicateBid(){
  if(!_geiEditBidId){showToast('Save your draft first, then duplicate','⚠️');return;}
  saveGenericEstimate(true);
  const src=bids.find(x=>x.id===_geiEditBidId);
  if(!src){showToast('Bid not found','⚠️');return;}
  // Label the original "Option A" so both show distinct names in the bid list
  const baseName=(src.type||'Custom Proposal').replace(/\s*-\s*Option\s+[AB]$/i,'').trim();
  if(!/option [ab]$/i.test(src.type||'')){
    src.type=baseName+', Option A';
    const descEl=document.getElementById('gei-desc');
    if(descEl)descEl.value=src.type;
    const titleEl=document.getElementById('byo-tbar-title');
    if(titleEl)titleEl.textContent=src.type;
  }
  const copy=JSON.parse(JSON.stringify(src));
  copy.id=_newBidId();
  copy.type=baseName+', Option B';
  copy.status='Draft';copy.draft=true;
  copy.signingToken=undefined;copy.proposalKey=undefined;copy.proposalSentDate=undefined;
  bids.unshift(copy);saveAll();
  // Open the copy in the editor
  _byoShowPage({id:copy.client_id,name:copy.client_name||copy.name||''},copy.id);
  showToast('Duplicated: edit Option B now','📋');
}
function _showProposalPreviewOverlay(proposalHtml){
  document.getElementById('_prop-preview-ov')?.remove();
  const ov=document.createElement('div');
  ov.id='_prop-preview-ov';
  ov.style.cssText='position:fixed;inset:0;z-index:9500;background:#0007;display:flex;flex-direction:column';
  const hdr=document.createElement('div');
  hdr.style.cssText='background:#1a365d;color:#fff;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0';
  hdr.innerHTML='<span style="font-size:15px;font-weight:800">'+svgIcon('👁',{size:15,color:'#fff'})+' Client preview, how they\'ll see it</span><button onclick="document.getElementById(\'_prop-preview-ov\')?.remove()" style="background:rgba(255,255,255,.15);border:none;color:#fff;padding:7px 14px;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;touch-action:manipulation">'+svgIcon('✕',{size:14,color:'#fff'})+' Close</button>';
  const body=document.createElement('div');
  // flex:0 1 auto (not flex:1): the card hugs its own content height instead
  // of stretching to fill the screen. Short proposals no longer leave a slab
  // of flat gray dead space below the card; long ones still scroll normally.
  body.style.cssText='flex:0 1 auto;overflow-y:auto;max-height:calc(100vh - 56px);padding:16px;box-sizing:border-box;background:#f0f4f8;overflow-wrap:anywhere';
  body.innerHTML=proposalHtml;
  ov.appendChild(hdr);ov.appendChild(body);
  document.body.appendChild(ov);
}
// ─── Comparison proposal picker ─────────────────────────────────────────────
// Show a picker so the contractor can send two side-by-side options to a client.
// The picker lets the contractor preview the comparison before sending.
function _openComparisonPicker(){
  if(!_geiClientId){showToast('Open from a client to compare bids','ℹ️');return;}
  const clientBids=bids.filter(x=>(x.client_id===_geiClientId)&&(x.isFreeForm||x.geiLines));
  if(clientBids.length<2){showToast('You need at least 2 saved bids for this client to compare','ℹ️');return;}
  document.getElementById('_cmp-picker-ov')?.remove();
  const ov=document.createElement('div');
  ov.id='_cmp-picker-ov';
  ov.style.cssText='position:fixed;inset:0;z-index:9600;background:#0009;display:flex;align-items:flex-end;justify-content:center';
  const box=document.createElement('div');
  box.style.cssText='background:#fff;border-radius:18px 18px 0 0;width:100%;max-width:520px;padding:20px 16px 32px;box-sizing:border-box;max-height:80vh;overflow-y:auto';
  const rows=clientBids.map((b,i)=>{
    const total=b.amount||0;
    const label=b.type||('Bid '+(i+1));
    return `<label style="display:flex;align-items:center;gap:12px;padding:12px;border:1.5px solid var(--border2);border-radius:10px;margin-bottom:8px;cursor:pointer"><input type="checkbox" name="cmp-bid" value="${b.id}" style="width:20px;height:20px;accent-color:var(--blue);flex-shrink:0"><span style="flex:1"><span style="font-size:14px;font-weight:700;display:block">${escHtml(label)}</span><span style="font-size:12px;color:var(--text-3)">$${total.toLocaleString()} · ${b.status||'Draft'}</span></span></label>`;
  }).join('');
  box.innerHTML=`<div style="font-size:17px;font-weight:800;margin-bottom:4px">${svgIcon('📊',{size:17})} Compare & Send</div><div style="font-size:13px;color:var(--text-3);margin-bottom:16px">Pick exactly 2 bids, your client will see both side by side and can choose one.</div>${rows}<button onclick="_buildComparisonPreview()" style="width:100%;padding:14px;border-radius:var(--rl);border:none;background:var(--blue);color:#fff;font-size:16px;font-weight:700;cursor:pointer;font-family:inherit;touch-action:manipulation;margin-top:8px">${svgIcon('👁',{size:16,color:'#fff'})} Preview comparison</button><button onclick="document.getElementById('_cmp-picker-ov')?.remove()" style="width:100%;padding:12px;border-radius:var(--rl);border:none;background:none;color:var(--text-3);font-size:14px;cursor:pointer;font-family:inherit;margin-top:6px">Cancel</button>`;
  ov.appendChild(box);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
}
function _buildComparisonPreview(){
  const checked=[...document.querySelectorAll('input[name="cmp-bid"]:checked')].map(x=>x.value);
  if(checked.length!==2){showToast('Select exactly 2 bids to compare','⚠️');return;}
  const bidA=bids.find(x=>x.id===checked[0]);
  const bidB=bids.find(x=>x.id===checked[1]);
  if(!bidA||!bidB){showToast('Bids not found','⚠️');return;}
  const fmt=n=>'$'+(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const makeCard=(b,label,accentColor)=>{
    const lineRows=(b.geiLines||[]).filter(l=>l.desc||l.rate).map(l=>`<tr style="border-bottom:1px solid #e2e8f0"><td style="padding:7px 12px;font-size:12px;color:#2d3748;overflow-wrap:anywhere"><div>${escHtml(l.desc||'')}${l.qty!==1?`<span style="color:#94a3b8;font-size:11px"> ×${l.qty}</span>`:''}</div>${l.notes?`<div style="font-size:11px;color:#718096;margin-top:2px">${escHtml(l.notes)}</div>`:''}</td><td style="padding:7px 8px;text-align:right;font-size:12px;font-weight:600;color:#1a365d">${fmt((l.qty||1)*(l.rate||0))}</td></tr>`).join('');
    const notes=b.notes?`<div style="padding:10px 14px;border-top:1px solid #e2e8f0;font-size:12px;color:#4a5568;line-height:1.5;overflow-wrap:anywhere"><strong>Notes:</strong> ${escHtml(b.notes)}</div>`:'';
    return `<div style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 2px 12px rgba(0,0,0,.08);margin-bottom:16px"><div style="background:${accentColor};color:#fff;padding:14px 16px"><div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;opacity:.85">Option</div><div style="font-size:20px;font-weight:800;margin-top:2px">${label}</div><div style="font-size:13px;opacity:.85;margin-top:4px">${escHtml(b.type||'Proposal')}</div></div><table style="width:100%;border-collapse:collapse;font-size:12px"><tbody>${lineRows}</tbody><tfoot><tr style="background:${accentColor};color:#fff"><td style="padding:10px 14px;font-weight:800;font-size:14px">TOTAL</td><td style="padding:10px 14px;text-align:right;font-weight:800;font-size:14px">${fmt(b.amount)}</td></tr></tfoot></table>${notes}<div style="padding:12px 14px;background:#f8fafc;text-align:center"><button style="width:100%;padding:12px;border-radius:10px;border:2px solid ${accentColor};background:#fff;color:${accentColor};font-size:15px;font-weight:800;cursor:pointer;font-family:inherit;touch-action:manipulation">${svgIcon('✓',{size:15,color:accentColor})} I choose this option</button></div></div>`;
  };
  const compHtml=`<div style="max-width:560px;margin:0 auto;padding:16px 0"><div style="text-align:center;padding:16px 0 20px"><div style="font-size:18px;font-weight:800;color:#1a365d">Choose your option</div><div style="font-size:13px;color:#718096;margin-top:4px">Both options are from the same contractor. Review each and tap to accept the one that works best for you.</div></div>${makeCard(bidA,'A','#1a365d')}${makeCard(bidB,'B','#2a4a7f')}</div>`;
  document.getElementById('_cmp-picker-ov')?.remove();
  _showProposalPreviewOverlay(compHtml);
}
// ─── End comparison ──────────────────────────────────────────────────────────
function _tmCrewStep(delta){
  _tmCrewCount=Math.max(1,Math.min(20,(_tmCrewCount||1)+delta));
  const d=document.getElementById('tm-i-crew-count');if(d)d.textContent=_tmCrewCount;
  const lbl=document.getElementById('tm-i-crew-label');
  if(lbl)lbl.textContent=_tmCrewCount===1?'solo':_tmCrewCount===2?'me + helper':'crew';
  _tmInputChange();
}
function _tmInputChange(){
  _tmRatePerMan=_moneyVal('tm-i-rate');
  // Crew count driven by stepper; read stepper display, not a select
  const crewDisp=document.getElementById('tm-i-crew-count');
  if(crewDisp)_tmCrewCount=parseInt(crewDisp.textContent)||_tmCrewCount||1;
  // The field is "Estimated days", _tmEstHours (shared with save/resume/the legacy
  // wizard) stays a real hour count internally, just derived from days×8 now.
  const daysInput=_moneyVal('tm-i-days');
  _tmEstHours=daysInput*8;
  const labor=_tmCrewCount*_tmRatePerMan*_tmEstHours;
  // Upsert labor line in _geiLines (same shape the rest of the app expects)
  const idx=_geiLines.findIndex(l=>l._tmLabor);
  const desc='Labor: '+_tmCrewCount+' worker'+(_tmCrewCount>1?'s':'')+' @ $'+_tmRatePerMan+'/hr';
  const line={desc,qty:_tmEstHours,unit:'hr',rate:Math.round(_tmRatePerMan*_tmCrewCount),_tmLabor:true,total:Math.round(_tmRatePerMan*_tmCrewCount*_tmEstHours)};
  if(idx>=0){if(labor>0)_geiLines[idx]=line;else _geiLines.splice(idx,1);}
  else if(labor>0)_geiLines.unshift(line);
  // Stat tiles
  const dayRate=_tmCrewCount*_tmRatePerMan*8;
  const setT=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v};
  setT('tm-stat-day','$'+dayRate.toLocaleString());
  setT('tm-stat-day-s',_tmRatePerMan&&_tmCrewCount?_tmCrewCount+'-person crew · 8hr day':'enter rate & crew');
  setT('tm-stat-labor','$'+labor.toLocaleString());
  setT('tm-stat-labor-s',(_tmRatePerMan&&daysInput)?daysInput+'d × 8hr × '+_tmCrewCount+' × $'+_tmRatePerMan:'-');
  setT('tm-stat-days',_tmEstHours);
  // Materials subtotal, shown at raw cost, no markup applied
  const matRaw=_geiLines.filter(l=>!l._tmLabor).reduce((s,l)=>s+(l.total||(l.qty||0)*(l.rate||0)),0);
  const total=labor+matRaw;
  // Rail breakdown
  setT('tm-rail-total','$'+total.toLocaleString());
  setT('tm-rail-labor','$'+labor.toLocaleString());
  setT('tm-rail-mat','$'+matRaw.toLocaleString());
  const _tmDeposit=Math.round(total*_geiDepositPct())/100;
  setT('tm-rail-balance','$'+(total-_tmDeposit).toLocaleString());
  let nte=_moneyVal('tm-i-nte');
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
  const nteOn=document.getElementById('tm-nte-on');if(nteOn)nteOn.checked=nte>0;
  // Keep the legacy line items + totals in sync (used by save/proposal)
  if(typeof renderGeiLines==='function')renderGeiLines();
  if(typeof calcGeiTotal==='function')calcGeiTotal();
  // Crew picker (shared with BYO), who's actually on this job drives true labor cost.
  if(typeof _renderLaborPicker==='function')_renderLaborPicker('tm');
  // TRUE cost feeds the gauge: materials at raw cost + what the selected crew
  // actually costs the business (loaded pay rates × the T&M hours). No employees
  //, or none selected, means the OWNER is doing the work: their labor costs
  // the business $0 and the labor revenue correctly reads as profit. The old
  // code fed the labor BILLING amount as "cost", which hid all labor profit and
  // made every T&M job read as underpriced.
  const _tmCrewCost=(typeof _estLaborCost==='function')?_estLaborCost():0;
  const _tmTrueCost=Math.round(matRaw+_tmCrewCost);
  const _tmCostEl=document.getElementById('tm-expected-cost');
  if(_tmCostEl&&!_tmCostEl.dataset.userSet){_tmCostEl.value=_tmTrueCost>0?_tmTrueCost:'';}
  _updateMarginGauge('tm',total);
  _byoAutosave();
}
function _tmRenderMatList(){
  const el=document.getElementById('tm-mat-list');if(!el)return;
  const mats=_geiLines.map((l,i)=>({l,i})).filter(x=>!x.l._tmLabor);
  if(!mats.length){
    el.innerHTML='<div class="tm-mat-empty">No material categories yet, tap "+ Add category" to start.</div>';
    return;
  }
  el.innerHTML=mats.map(({l,i})=>{
    const rawTotal=l.total||((l.qty||0)*(l.rate||0));
    return _geiItemRowHtml({
      label:l.desc||'Untitled',notes:l.notes||'',price:rawTotal||0,
      editFn:'_tmEditMatCat('+i+')',delFn:'_tmDelMatCat('+i+')',delTitle:'Remove category'
    });
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
    '<div class="f" style="margin-bottom:10px"><label>Estimated cost ($)</label><div class="input-prefix"><span>$</span><input type="number" id="tcm-cost" min="0" step="10" placeholder="0" value="'+(cur||'')+'" inputmode="decimal"></div></div>'+
    '<div class="f" style="margin-bottom:6px"><label>Notes <span style="font-weight:400;color:var(--text3)">(optional)</span></label><textarea id="tcm-notes" rows="3" placeholder="Brand, product type, etc." style="width:100%;box-sizing:border-box;resize:vertical;font-family:inherit">'+escHtml(l?.notes||'')+'</textarea></div>'+
    '<div style="font-size:11px;color:var(--text3);margin-bottom:14px">Tab from Notes to save</div>'+
    '<div style="display:flex;gap:10px">'+
      '<button onclick="document.getElementById(\'_tm-mat-modal\')?.remove()" class="btn" style="flex:1">Cancel</button>'+
      '<button onclick="_tmMatCatSave('+idx+')" class="btn btn-p" style="flex:2">'+(isEdit?'Save changes':'Add category')+'</button>'+
    '</div>'+
  '</div>';
  document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  setTimeout(()=>{
    const nameEl=document.getElementById('tcm-name');
    const costEl=document.getElementById('tcm-cost');
    const notesEl=document.getElementById('tcm-notes');
    if(nameEl)nameEl.focus();
    // Same tab-chain as BYO's "Add item" modal (§ notes structure must match): Name → Cost
    // → Notes, Tab from Notes saves. Enter now makes a newline in the notes textarea.
    if(notesEl){
      notesEl.addEventListener('keydown',e=>{
        if(e.key==='Tab'&&!e.shiftKey){e.preventDefault();_tmMatCatSave(idx);}
      });
    }
    if(nameEl){
      nameEl.addEventListener('keydown',e=>{
        if(e.key==='Enter'){e.preventDefault();costEl?.focus();}
      });
    }
    if(costEl){
      costEl.addEventListener('keydown',e=>{
        if(e.key==='Enter'){e.preventDefault();notesEl?.focus();}
      });
    }
  },50);
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
function _tmCadence(v){_tmBillingCycle=v;_tmSyncCadence();_byoAutosave();}
function _tmSyncCadence(){
  ['weekly','milestone','completion'].forEach(c=>{
    const el=document.getElementById('tm-cad-'+c);if(!el)return;
    if(_tmBillingCycle===c)el.classList.add('on');else el.classList.remove('on');
  });
}
function _tmPreviewClient(){_geiPreviewClient();}

function _geiBack(){
  if(_geiStep>1){goGeiStep(_geiStep-1);return;}
  _geiToStylePicker();
}
function _geiToStylePicker(){
  document.getElementById('gei-cart-bar')?.remove();
  const c=getClientById(_geiClientId);
  if(c&&typeof _showEstimateStylePicker==='function')_showEstimateStylePicker(c);
  else goPg('pg-client-detail');
}

// ── Free-form (Build Your Own) builder ───────────────────────────────────────
function _geiRenderFreeFormBuilder(){
  const el=document.getElementById('gei-templates');if(!el)return;
  const curTrade=_geiTrade||'general';
  const allHist=(S.lineHistory||[]).slice().sort((a,b)=>(b.count||0)-(a.count||0));
  const hist=allHist.filter(h=>!h.trade||h.trade===curTrade||h.trade==='general').slice(0,6);
  const histHtml=hist.length?
    '<div style="margin-bottom:14px">'+
      '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:8px">Recently used, '+curTrade.charAt(0).toUpperCase()+curTrade.slice(1)+'</div>'+
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
        '<div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:2px">'+escHtml(l.desc||'-')+'</div>'+
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
        '<input id="_ffa-desc" type="text" value="'+escHtml(d.desc||'')+'" placeholder="e.g. Interior paint, 2 coats, Labor, Material" autocomplete="off" style="font-size:14px">'+
      '</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px">'+
        '<div class="f"><label>Qty</label><input id="_ffa-qty" type="number" value="'+(d.qty||1)+'" min="0.01" step="any" oninput="_ffaLiveTotal()" style="font-size:14px"></div>'+
        '<div class="f"><label>Unit</label><input id="_ffa-unit" type="text" value="'+escHtml(d.unit||'ea')+'" placeholder="ea" style="font-size:14px"></div>'+
        '<div class="f"><label>Price per unit ($)</label><input id="_ffa-rate" type="number" value="'+(d.rate||'')+'" min="0" step="any" placeholder="0" oninput="_ffaLiveTotal()" style="font-size:14px"></div>'+
      '</div>'+
      '<div style="display:flex;justify-content:space-between;align-items:center;background:var(--bg2);padding:9px 12px;border-radius:var(--r);margin-bottom:14px">'+
        '<span style="font-size:12px;color:var(--text2)">Line total</span>'+
        '<span id="_ffa-total-disp" style="font-size:18px;font-weight:800;color:var(--blue)">'+(d.qty&&d.rate?'$'+((d.qty||1)*(d.rate||0)).toLocaleString('en-US',{maximumFractionDigits:0}):'-')+'</span>'+
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
  if(el)el.textContent=(qty&&rate)?'$'+(qty*rate).toLocaleString('en-US',{maximumFractionDigits:0}):'-';
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
    _settingsChanged();
    showToast('Rate saved for '+job.name,'💾');
  }
  if(job.gasLic)showToast('Gas work, verify you\'re licensed for gas in your state','⚠️');
  if(job.freeForm){_geiShowFreeFormModal(job);return;}
  const rate=entered||marketTotal;
  if(job.custom){
    const unitLabel={sqft:'square footage','lin ft':'linear feet',kW:'kilowatts',kWh:'kilowatt-hours',fixture:'number of fixtures'}[job.unit]||job.unit;
    const raw=prompt('Enter '+unitLabel+' for: '+job.name);
    if(!raw)return;
    const qty=parseFloat(raw);if(!qty||isNaN(qty))return;
    _geiLines.push({desc:job.name+', labor',qty,unit:job.unit,rate:Math.round(p.labor),total:qty*Math.round(p.labor),jobId:job.id});
    if(p.mat>0)_geiLines.push({desc:job.matDesc||'Materials',qty,unit:job.unit,rate:p.mat,total:qty*p.mat});
  } else {
    if(p.labor>0)_geiLines.push({desc:job.name+', labor',qty:1,unit:job.unit,rate:p.labor,total:p.labor,jobId:job.id});
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
      ?`<span style="color:#16a34a;font-size:10px;margin-top:2px">${svgIcon('✓',{size:10,color:'#16a34a'})} your rate</span>`
      :`<span style="color:var(--text3);font-size:10px;margin-top:2px">${svgIcon('📍',{size:10})} ${S.state||'US'} avg${_geiNewWork&&(job.nw||1)<1?' · new work':''}</span>`;
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

  const firstTimeBanner=(!S.myRates||!Object.keys(S.myRates).length)?`<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:var(--r);padding:10px 14px;margin-bottom:12px;font-size:12px;color:#1e40af;line-height:1.5">${svgIcon('📍',{size:12,color:'#1e40af'})} Showing <strong>${S.state||'US'} market averages</strong> (BLS labor data). Edit any price to set your own rate, saves automatically.</div>`:'';
  const newWorkBadge=_geiNewWork?`<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:var(--r);padding:6px 12px;margin-bottom:10px;font-size:12px;color:#15803d;font-weight:600">${svgIcon('🏗',{size:12,color:'#15803d'})} New construction rates active, lower labor</div>`:'';
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
  if(_geiEmergency)html+=`<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:var(--r);padding:9px 12px;font-size:12px;color:#b91c1c;margin-bottom:12px;font-weight:600">${svgIcon('🚨',{size:12,color:'#b91c1c'})} Emergency mode, labor rates ×1.5 · after-hours surcharge added</div>`;
  if(_geiNewWork)html+=`<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:var(--r);padding:7px 12px;font-size:12px;color:#15803d;margin-bottom:12px;font-weight:600">${svgIcon('🏗',{size:12,color:'#15803d'})} New construction rates active, lower labor</div>`;

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
        <span style="font-size:28px;line-height:1">${svgIcon(emoji,{size:28})}</span>
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
  S.myBundles=['__all'];_settingsChanged();_geiRenderTemplates();showToast('Showing all services','✓');
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
      <div style="font-size:20px;font-weight:800;color:var(--text);margin-bottom:4px">${svgIcon('⚡',{size:20})} Set up your services</div>
      <div style="font-size:12px;color:var(--text3);margin-bottom:14px">Takes about 30 seconds · you can change this anytime</div>
      <div style="background:var(--blue-lt);border:1px solid var(--blue);border-radius:var(--r);padding:10px 14px;margin-bottom:16px;font-size:12px;color:var(--blue-dk)">
        ${svgIcon('📍',{size:12,color:'var(--blue-dk)'})} You're in <strong>${stateStr}</strong>, market rates loaded${multNote}
        <button onclick="document.getElementById('_gei-state-sel')?.classList.toggle('show')" style="margin-left:8px;background:none;border:none;color:var(--blue);font-size:11px;cursor:pointer;text-decoration:underline;font-family:inherit">Change</button>
        <select id="_gei-state-sel" class="show" onchange="S.state=this.value;_settingsChanged();showGeiOnboarding()" style="display:block;margin-top:8px;padding:6px 8px;border-radius:var(--r);border:1px solid var(--border2);font-size:13px;background:var(--bg);color:var(--text);width:100%">
          ${['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'].map(st=>`<option value="${st}"${S.state===st?' selected':''}>${st}</option>`).join('')}
        </select>
      </div>
      <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:10px">What kind of work do you do? <span style="font-weight:400;color:var(--text3)">(tap all that apply)</span></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:18px">
        ${BUNDLE_CARDS.map(b=>{
          const on=selected.has(b.id);
          return `<button onclick="_geiOnboardToggle('${b.id}')" data-bid="${b.id}" style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:14px 8px;border-radius:var(--rl);border:2px solid ${on?'var(--blue)':'var(--border2)'};background:${on?'var(--blue-lt)':'var(--bg2)'};cursor:pointer;font-family:inherit;gap:5px;min-height:80px;text-align:center;box-sizing:border-box">
            <span style="font-size:26px;line-height:1">${svgIcon(b.emoji,{size:26})}</span>
            <span style="font-size:11px;font-weight:700;color:${on?'var(--blue-dk)':'var(--text)'};white-space:pre-line;line-height:1.3">${b.label}</span>
            ${on?'<span style="font-size:10px;color:var(--blue);font-weight:700">'+svgIcon('✓',{size:10,color:'var(--blue)'})+'</span>':''}
          </button>`;
        }).join('')}
      </div>
      <button onclick="_geiOnboardFinish()" id="_gei-ob-btn" style="width:100%;padding:14px;border-radius:var(--rl);border:none;background:${selected.size?'var(--blue)':'var(--border2)'};color:${selected.size?'#fff':'var(--text3)'};font-weight:800;font-size:15px;cursor:${selected.size?'pointer':'default'};font-family:inherit;margin-bottom:10px">
        ${selected.size?`Get started → (${selected.size} service type${selected.size!==1?'s':''})`:'Select at least one service type'}
      </button>
      <button onclick="_geiOnboardSkip()" style="width:100%;padding:10px;background:none;border:none;color:var(--text3);font-size:12px;cursor:pointer;font-family:inherit">Set up later, you'll be reminded next time</button>
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
    S.myBundles=[...selected];S.hasOnboarded=true;_settingsChanged();
    ov.remove();showToast('Services set up, showing '+S.state+' market rates','✓');
  };
  window._geiOnboardSkip=function(){
    ov.remove(); // session-only dismiss, myBundles stays unset, popup re-appears next load
  };
  render();
  document.body.appendChild(ov);
}

function _geiSetScope(commercial){
  _geiIsCommercial=!!commercial;
  _geiSyncScopeButtons();
  if(_geiStep===2)_geiRenderTemplates();
}

function _geiSetPropertyType(type){
  _geiIsCommercial=(type==='commercial');
  _geiSyncJobTypeButtons();
  if(_geiStep===2)_geiRenderTemplates();
  calcGeiTotal();
}
function _geiSetWorkType(scope){
  _geiJobScope=scope;
  _geiNewWork=(scope==='improvement');
  _geiSyncJobTypeButtons();
  if(_geiStep===2)_geiRenderTemplates();
  calcGeiTotal();
}
function _geiSyncJobTypeButtons(){
  const _propActive=_geiIsCommercial?'comm':'res';
  ['res','comm'].forEach(k=>{
    const btn=document.getElementById('gei-prop-'+k);if(!btn)return;
    const on=k===_propActive;
    btn.style.border='2px solid '+(on?'var(--blue)':'var(--border2)');
    btn.style.background=on?'var(--blue-lt)':'var(--bg2)';
    btn.style.color=on?'var(--blue-dk)':'var(--text2)';
  });
  const _workActive=_geiJobScope==='improvement'?'newbuild':'repair';
  ['repair','newbuild'].forEach(k=>{
    const btn=document.getElementById('gei-work-'+k);if(!btn)return;
    const on=k===_workActive;
    btn.style.border='2px solid '+(on?'var(--blue)':'var(--border2)');
    btn.style.background=on?'var(--blue-lt)':'var(--bg2)';
    btn.style.color=on?'var(--blue-dk)':'var(--text2)';
  });
  const noteEl=document.getElementById('gei-jtype-note');
  if(!noteEl)return;
  if(_geiJobScope==='improvement'&&typeof getJobTaxTreatment==='function'){
    const st=(typeof detectStateFromAddr==='function'?detectStateFromAddr(document.getElementById('gei-addr')?.value||''):null)||(S&&S.state)||'KS';
    const t=getJobTaxTreatment(st,_geiTrade||'general','improvement',_geiIsCommercial?'commercial':'residential');
    noteEl.innerHTML=t.certificate?svgIcon('⚠',{size:11})+' '+escHtml(t.certificate.form)+' required: client must sign before work begins.':'New construction: no tax';
    noteEl.style.color=t.certificate?'var(--amber-dk)':'var(--text3)';
  } else {
    noteEl.textContent='';
  }
}

function _geiSetJobScope(scope){
  _geiJobScope=scope;
  _geiSyncJobScopeButtons();
  calcGeiTotal();
}

function _geiSyncJobScopeButtons(){
  ['improvement','repair'].forEach(s=>{
    const btn=document.getElementById('gei-jscope-'+s);
    if(!btn)return;
    const active=_geiJobScope===s;
    btn.style.border='2px solid '+(active?'var(--blue)':'var(--border2)');
    btn.style.background=active?'var(--blue-lt)':'var(--bg2)';
    btn.style.color=active?'var(--blue-dk)':'var(--text2)';
  });
  // Show certificate note if improvement + state requires cert
  const noteEl=document.getElementById('gei-jscope-note');
  if(noteEl&&_geiJobScope==='improvement'&&typeof getJobTaxTreatment==='function'){
    const stateKey=(typeof detectStateFromAddr==='function'?detectStateFromAddr(document.getElementById('gei-addr')?.value||''):null)||(S&&S.state)||'KS';
    const t=getJobTaxTreatment(stateKey,_geiTrade||'general','improvement',_geiIsCommercial?'commercial':'residential');
    noteEl.innerHTML=t.certificate?svgIcon('⚠',{size:11})+' '+escHtml(t.certificate.form)+' required: client must sign before work begins.':'New construction: no tax';
    noteEl.style.color=t.certificate?'var(--amber-dk)':'var(--text3)';
  } else if(noteEl){
    noteEl.textContent='';
  }
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
  if(job.gasLic)showToast('Gas work, verify you\'re licensed for gas in your state','⚠️');
  if(job.freeForm){_geiShowFreeFormModal(job);return;}
  const laborRate=_geiEmergency?Math.round(job.labor*1.5):job.labor;
  if(job.custom){
    const unitLabel={sqft:'square footage','lin ft':'linear feet',kW:'kilowatts',kWh:'kilowatt-hours',fixture:'number of fixtures'}[job.unit]||job.unit;
    const raw=prompt('Enter '+unitLabel+' for: '+job.name);
    if(!raw)return;
    const qty=parseFloat(raw);if(!qty||isNaN(qty))return;
    if(laborRate>0)_geiLines.push({desc:job.name+', labor',qty,unit:job.unit,rate:laborRate,total:qty*laborRate});
    if(job.mat>0)_geiLines.push({desc:job.matDesc||'Materials',qty,unit:job.unit,rate:job.mat,total:qty*job.mat});
  } else {
    if(laborRate>0)_geiLines.push({desc:job.name+', labor',qty:1,unit:job.unit,rate:laborRate,total:laborRate});
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
  const modelTag=model?', '+model:'';
  if(laborRate>0)_geiLines.push({desc:job.name+modelTag+', labor',qty,unit:job.unit,rate:laborRate,total:qty*laborRate});
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
  _settingsChanged();showToast('Saved to price book','🔖');
  _geiRenderTemplates();
}


function renderGeiLines(){
  const el=document.getElementById('gei-lines');if(!el)return;
  if(!_geiLines.length){
    el.innerHTML='<div style="font-size:13px;color:var(--text3);text-align:center;padding:20px 0">No line items yet, tap <strong>+ Add line</strong> above.</div>';
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
      ${isLabor?'':`<div style="display:flex;justify-content:flex-end;margin-top:8px"><button onclick="_geiSaveToPriceBook(${i})" style="background:none;border:none;cursor:pointer;color:var(--text3);font-size:11px;font-weight:600;font-family:inherit;padding:0;display:flex;align-items:center;gap:3px">${svgIcon('🔖',{size:11})} Save to price book</button></div>`}
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
  _settingsChanged();
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
    S.myRates=S.myRates||{};S.myRates[line.jobId]={labor:entered,mat:0};_settingsChanged();showToast('Rate saved','💾');
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
    el.innerHTML=`<button onclick="_panelOpen()" style="width:100%;padding:12px;border-radius:var(--r);border:1.5px dashed var(--border2);background:var(--bg2);color:var(--text3);font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;text-align:center">${svgIcon('📋',{size:13})} Add panel schedule <span style="font-size:11px;font-weight:400">(optional: leave with the panel)</span></button>`;
    return;
  }
  const {l1,l2,slots,used,imbalance,spare}=_panelCalcBalance();
  const pa=_panelSched.panelAmps||200;
  const imbalBadge=imbalance>0.10?`<span style="background:#fef2f2;color:#dc2626;border:1px solid #fca5a5;border-radius:4px;padding:2px 7px;font-size:11px;font-weight:700;margin-left:8px">${svgIcon('⚠',{size:11,color:'#dc2626'})} ${(imbalance*100).toFixed(0)}% imbalance</span>`:`<span style="background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0;border-radius:4px;padding:2px 7px;font-size:11px;font-weight:700;margin-left:8px">${svgIcon('✓',{size:11,color:'#16a34a'})} balanced</span>`;
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
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text3)">${svgIcon('📋',{size:11})} Panel schedule</div>
      <div style="display:flex;gap:6px">
        <button onclick="_panelPrint()" style="padding:5px 11px;border-radius:var(--r);border:1.5px solid var(--border2);background:var(--bg2);font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;color:var(--text2)">${svgIcon('🖨',{size:12})} Print</button>
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
  const imbalTxt=imbalance>0.10?`<span style="color:#dc2626;font-weight:700">${svgIcon('⚠',{size:13,color:'#dc2626'})} ${(imbalance*100).toFixed(0)}% imbalance, rebalance recommended</span>`:`<span style="color:#16a34a;font-weight:700">${svgIcon('✓',{size:13,color:'#16a34a'})} Balanced (${(imbalance*100).toFixed(0)}% difference)</span>`;
  const rows=circuits.map((c,i)=>`<tr>
    <td style="text-align:center;padding:4px 6px;border:1px solid #ccc">${i+1}</td>
    <td style="padding:4px 8px;border:1px solid #ccc">${escHtml(c.desc||'-')}</td>
    <td style="text-align:center;padding:4px 6px;border:1px solid #ccc;font-weight:700">${c.amps||''}A</td>
    <td style="text-align:center;padding:4px 6px;border:1px solid #ccc">${c.phase==='2pole'?'2-pole':c.phase}</td>
    <td style="text-align:center;padding:4px 6px;border:1px solid #ccc">${escHtml(c.gauge||'')}</td>
    <td style="text-align:center;padding:4px 6px;border:1px solid #ccc">${c.afci?svgIcon('✓',{size:12}):''}</td>
    <td style="text-align:center;padding:4px 6px;border:1px solid #ccc">${c.gfci?svgIcon('✓',{size:12}):''}</td>
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
    <div><h1>${svgIcon('⚡',{size:18})} Panel Schedule</h1><div class="meta">${escHtml(biz)}${client?' · '+escHtml(client):''}${addr?' · '+escHtml(addr):''}<br>Date: ${dateStr}</div></div>
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
  <div style="margin-top:16px;font-size:10px;color:#888;border-top:1px solid #ddd;padding-top:8px">Generated by TradeDesk · ${escHtml(biz)} · ${dateStr}</div>
  <button onclick="window.print()" style="margin-top:16px;padding:10px 24px;background:#1a1a2e;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:700;cursor:pointer">${svgIcon('🖨',{size:14,color:'#fff'})} Print / Save PDF</button>
  </body></html>`;
  const win=window.open('','_blank');
  if(win){win.document.write(html);win.document.close();}
  else showToast('Allow pop-ups to print','⚠️');
}

function calcGeiTotal(){
  const sub=_geiLines.reduce((s,l)=>s+(l.qty||1)*(l.rate||0),0);
  const pct=parseFloat(document.getElementById('gei-tax-pct')?.value)||0;
  const markup=sub*pct/100;

  // Sales tax, separate from markup, based on state rules and job scope
  let salesTax=0,salesTaxTreatment=null;
  const _stKey=(typeof detectStateFromAddr==='function'?detectStateFromAddr(document.getElementById('gei-addr')?.value||''):null)||(S&&S.state)||'KS';
  const _stScope=_geiJobScope||(_geiIsTM?'tm':'repair');
  // Rate: always use client address ZIP/state lookup; fall back to contractor setting only when no address yet
  const _stRate=_geiClientTaxRate!==null?(_geiClientTaxRate.rate??0):(parseFloat(S.salesTaxRate)||0);
  if(typeof calcSalesTax==='function'&&_stRate>0){
    const _liItems=_geiLines.map(l=>{
      if(l._tmLabor)return{desc:l.desc||'',total:(l.qty||1)*(l.rate||0),lineType:'labor'};
      const sec=(l._byoSection||'').toLowerCase();
      const lineType=sec==='materials'?'materials':(sec==='interior'||sec==='exterior')?'labor':null;
      return{desc:l.desc||'',total:(l.qty||1)*(l.rate||0),lineType};
    });
    const _stResult=calcSalesTax({state:_stKey,tradeType:_geiTrade||'general',scope:_stScope,
      propertyType:_geiIsCommercial?'commercial':'residential',taxRate:_stRate,lineItems:_liItems});
    salesTax=_stResult.taxAmount||0;
    salesTaxTreatment=_stResult.treatment;
  }

  const total=sub+markup+salesTax;
  const fmt=n=>'$'+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
  set('gei-subtotal',fmt(sub));set('gei-tax-amt',fmt(markup));set('gei-total',fmt(total));

  // Update sales tax row
  const stRow=document.getElementById('gei-sales-tax-row');
  const stAmt=document.getElementById('gei-sales-tax-amt');
  const stLbl=document.getElementById('gei-sales-tax-lbl');
  if(stRow&&stAmt&&stLbl){
    if(!_stRate){
      stRow.style.display='none';
    } else if(salesTaxTreatment&&!salesTaxTreatment.customerTax){
      stRow.style.display='flex';
      stAmt.textContent='$0.00';
      stLbl.textContent=_stScope==='improvement'?'Sales tax, capital improvement':'Sales tax (exempt)';
      stAmt.style.color='var(--text3)';
    } else if(salesTax>0){
      stRow.style.display='flex';
      stAmt.textContent=fmt(salesTax);
      stAmt.style.color='var(--text2)';
      const isGR=salesTaxTreatment?.type==='gross_receipts';
      const isFull=salesTaxTreatment?.type==='service'||salesTaxTreatment?.laborTaxable;
      stLbl.textContent=(isGR?(salesTaxTreatment.label||'Tax'):(isFull?'Sales tax':'Materials tax'))
        +' ('+_stRate+'%)';
    } else {
      stRow.style.display='none';
    }
  }

  // Rate-not-set prompt: only show when no client address lookup has been done yet
  const prompt=document.getElementById('gei-tax-rate-prompt');
  if(prompt)prompt.style.display=(_geiClientTaxRate===null&&!_stRate&&sub>0&&_stScope!=='improvement')?'flex':'none';
  // Rate note: show when lookup returned a fallback warning or confirm client-ZIP rate
  const rateNote=document.getElementById('gei-tax-rate-note');
  if(rateNote){
    if(_geiClientTaxRate?.warning&&sub>0&&_stScope!=='improvement'){
      rateNote.innerHTML=svgIcon('⚠',{size:11})+' '+escHtml(_geiClientTaxRate.warning);rateNote.style.color='var(--amber-dk,#b45309)';rateNote.style.display='block';
    } else if(_geiClientTaxRate?.source==='db_zip'&&_stRate>0){
      rateNote.textContent='Rate: '+_stRate+'% (client address ZIP)';rateNote.style.color='var(--text3)';rateNote.style.display='block';
    } else {
      rateNote.style.display='none';
    }
  }

  // Margin on pre-tax revenue: sub + markup but not salesTax (pass-through to government).
  _updateMarginGauge('gei',sub+markup);
  return{sub,tax:markup+salesTax,markup,salesTax,total};
}

function saveGenericEstimate(draft){
  const v=id=>document.getElementById(id)?.value||'';
  const{total}=calcGeiTotal();
  const trade=_geiTrade||getActiveTrade();
  const taxPct=parseFloat(v('gei-tax-pct'))||0;
  // T&M extra fields
  const _tmNteFromNew=parseFloat(v('tm-i-nte'))||0;
  const _tmNteOnEl=document.getElementById('tm-nte-on');
  const _tmNteOnChecked=_tmNteOnEl?(_tmNteOnEl.checked||false):false;
  const _tmFields=_geiIsTM?{
    isTM:true,
    tmReason:v('tm-reason'),tmReasonNote:v('tm-reason-note'),
    tmCrewCount:_tmCrewCount,tmRatePerMan:_tmRatePerMan,tmEstHours:_tmEstHours,
    tmBillingCycle:_tmBillingCycle||'weekly',
    tmCapAction:v('tm-i-cap-action')||_tmCapAction||'',
    tmDepositPct:_geiDepositPct(),
    tmDepositAmt:Math.round(total*_geiDepositPct()/100),
    tmNteEnabled:(_tmNteFromNew>0)||_tmNteOnChecked,
    tmNteCap:_tmNteFromNew||parseFloat(v('tm-nte-cap'))||0,
  }:{isTM:false};
  let _deposit=_geiIsTM?(_tmFields.tmDepositAmt||0):Math.round(total*_geiDepositPct()/100);
  // State max-deposit cap (home-improvement compliance). Parse state from client
  // address like proposals.js _buildClientHubSnapshot, fall back to S.state then KS.
  if(typeof _maxDeposit==='function'){
    const _depAddrM=(v('gei-addr')||'').toUpperCase().match(/\b(AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/);
    const _depState=(_depAddrM?_depAddrM[1]:null)||(typeof S!=='undefined'&&S.state)||'KS';
    const _depMax=_maxDeposit(_depState,total);
    if(_deposit>_depMax+0.005){
      _deposit=Math.round(_depMax*100)/100;
      if(_geiIsTM)_tmFields.tmDepositAmt=_deposit;
      if(typeof showToast==='function'&&typeof _depositCapNote==='function'){
        showToast('Deposit capped to $'+_deposit.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+', '+_depositCapNote(_depState),'⚠️',6000);
      }
    }
  }
  const _typeLabel=_geiIsTM?'Time & Materials Proposal':_geiIsFreeForm?'Custom Proposal':(TRADE_META[trade]?.label||'Trade')+' Proposal';
  // Extract BYO field values before object literals, Safari fails to parse ?.?? inside spread conditionals
  const _byoTermsEl=document.getElementById('byo-custom-terms');
  const _byoTermsSave=_byoTermsEl?_byoTermsEl.value:(_byoCustomTerms||'');
  const _byoSecsSave=[..._byoCustomSections];
  if(_geiEditBidId){
    const b=bids.find(x=>x.id===_geiEditBidId);
    if(b){
      b.amount=total;b.type=v('gei-desc')||_typeLabel;b.geiDesc=v('gei-desc')||'';
      b.notes=v('gei-notes');b.geiLines=JSON.parse(JSON.stringify(_geiLines));
      b.geiTaxPct=taxPct;b.jobScope=_geiJobScope||'repair';b.salesTaxRate=parseFloat(S.salesTaxRate)||0;b.status=draft?'Draft':'Pending';b.draft=!!draft;
      b.geiDuration=v('gei-duration')||'';b.geiNewWork=_geiNewWork||false;
      b.trade_type=trade;b.deposit=_deposit;b.isFreeForm=_geiIsFreeForm||false;
      b.scopeChips=[..._geiScopeChips];
      b.scopeNoScope=_geiScopeNoScope||false;
      if(_geiIsFreeForm&&_byoItems.length)b.byoItems=JSON.parse(JSON.stringify(_byoItems));
      if(_geiIsFreeForm){b.byoCustomSections=_byoSecsSave;b.byoCustomTerms=_byoTermsSave;}
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
      type:v('gei-desc')||_typeLabel,geiDesc:v('gei-desc')||'',
      notes:v('gei-notes'),status:draft?'Draft':'Pending',draft:!!draft,
      isFreeForm:_geiIsFreeForm||false,
      ...(_geiIsFreeForm&&_byoItems.length?{byoItems:JSON.parse(JSON.stringify(_byoItems))}:{}),
      ...(_geiIsFreeForm?{byoCustomSections:_byoSecsSave,byoCustomTerms:_byoTermsSave}:{}),
      geiLines:JSON.parse(JSON.stringify(_geiLines)),geiTaxPct:taxPct,
      geiDuration:v('gei-duration')||'',geiNewWork:_geiNewWork||false,
      scopeChips:[..._geiScopeChips],
      scopeNoScope:_geiScopeNoScope||false,
      trade_type:trade,...(_panelSched?{panelSched:JSON.parse(JSON.stringify(_panelSched))}:{}),..._tmFields,
    };
    bids.unshift(newBid);_geiEditBidId=newBid.id;saveAll();
  }
  if(!draft)_saveToLineHistory();
  showToast(draft?'Draft saved':'Proposal saved','✅');
  if(!draft)goPg('pg-clients');
}

// Full Terms & Conditions, ONE clause list for both T&M and BYO, built fresh
// from live estimate state (owner directive 2026-07-13: moved out of the
// proposal body and into the signature step's accordion, so the numbered
// clauses live in exactly one place, the accordion right where the client
// signs: instead of a wall of legal text before it). Called both when
// sending a proposal (stored as proposalData.termsHtml, read back by
// sign.html) and when signing in person (_geiSignInPerson, same live
// session) so the two paths can never drift apart. Deposit amount/percentage
// is deliberately NOT a clause here, it's already its own line in the
// proposal's deposit/balance summary.
function _geiBuildTermsHtml(){
  const bname=S.bname||getBusinessName()||'';
  const _party=bname||'Contractor';
  const _stateKey=(typeof detectStateFromAddr==='function'?detectStateFromAddr(v('gei-addr')):null)||(S&&S.state)||'KS';
  const _tmNteCap=parseFloat(v('tm-nte-cap'))||0;
  const _fcPct=(S&&S.financeChargePct!=null?parseFloat(S.financeChargePct):1.5);
  const _fcApr=Math.round(_fcPct*12*10)/10;
  const _warrantyPeriod=S?.warrantyPeriod||'1 year';
  const _warrantyClause=_geiTrade==='painting'
    ?`${_party} warrants workmanship against peeling, cracking, and finish defects for ${_warrantyPeriod} from substantial completion, provided surfaces were in sound condition and properly disclosed prior to work. Client-supplied materials carry no workmanship warranty on finish quality. Manufacturer warranties on materials pass through to Buyer.`
    :_geiTrade==='landscaping'
      ?`${_party} warrants all plant material and hardscaping workmanship for ${_warrantyPeriod} from substantial completion. Living plant material is subject to proper watering and care by client after installation. Manufacturer warranties on materials pass through to Buyer.`
      :`${_party} warrants all workmanship against defects in labor and installation for ${_warrantyPeriod} from substantial completion. Manufacturer warranties on materials pass through to Buyer.`;
  const _permitClause=_geiTrade==='painting'
    ?`Painting and surface work does not typically require permits for standard residential repainting. If your municipality requires a permit for your specific project, ${_party} will notify you in advance. Any permit fees will be billed at cost with prior approval.`
    :`${_party} shall obtain all permits and inspections required for this scope of work in accordance with applicable local ordinances and codes. Any permit fees not included in this proposal will be billed at cost with prior Buyer approval.`;
  // sign.html's legacy-proposal patcher keys on the "<div>N. <strong>Title:"
  // shape: preserved verbatim by the renderer below.
  const _cancelClause=`Buyer may cancel within ${(typeof STATE_CANCEL!=='undefined'&&STATE_CANCEL[_stateKey])?STATE_CANCEL[_stateKey].days:3} business days of signing (${_cancelCitation(_stateKey)}) for a full refund of any deposit. After that period, if Buyer cancels or fails to proceed, the deposit is retained as liquidated damages for mobilization, scheduling, administrative, and material procurement costs, a reasonable estimate of actual damages, not a penalty. ${bname}'s right to retain the deposit is conditioned on ${bname}'s readiness and willingness to perform. If ${bname} fails to substantially complete the agreed scope of work through no fault of Buyer, the deposit shall be refunded in full. The deposit does not compensate for work not performed.`;
  const _modeTerms=_geiIsTM?[
    ['Contract type',`Time &amp; Materials${_tmNteCap?`, not to exceed $${_tmNteCap.toLocaleString()}`:' (T&amp;M)'}`],
    ['Cancellation &amp; Deposits',_cancelClause],
    ['Billing',`${_tmBillingCycle==='weekly'?'Weekly':'Bi-weekly'} invoices with time sheets and material receipts attached.`],
  ]:[
    ['Cancellation &amp; Deposits',_cancelClause],
  ];
  const _termsClauses=[
    ..._modeTerms,
    ['Change Orders','Any additional work not described herein requires a written change order approved and signed by the client.'],
    ['Limitation of Liability',`${_party} is not responsible for pre-existing conditions or damage not disclosed prior to the start of work.`],
    ['Mechanic&#39;s Lien',_lienNotice(_stateKey,_party)],
    ['Finance Charges',`Unpaid balances remaining 30 days after job completion are subject to a finance charge of ${_fcPct}% per month (${_fcApr}% APR) on the outstanding balance, accruing monthly until paid in full. Finance charges will appear as a separate line item on the client account.`],
    ['Workmanship Warranty',_warrantyClause],
    ['Permits &amp; Inspections',_permitClause],
    ['Schedule &amp; Delays',`Completion dates are good-faith estimates and may be extended due to weather, material shortages, inspection delays, subcontractor availability, or other circumstances beyond ${_party}&apos;s reasonable control. ${_party} will provide timely written or verbal notice of any material delay.`],
    ['Insurance',`${_party} maintains general liability insurance and, where required by law, workers&apos; compensation insurance. A certificate of insurance will be provided to Buyer upon written request prior to commencement of work.`],
    ['Dispute Resolution','In the event of a dispute, both parties agree to attempt good-faith negotiation before pursuing arbitration or litigation. The prevailing party in any legal proceeding to enforce this agreement shall be entitled to recover reasonable attorney&apos;s fees and costs, to the extent permitted by law.'],
  ];
  const _clausesHtml='<div style="font-size:11px;color:#2d3748;line-height:2">'+_termsClauses.map((c,i)=>`<div>${i+1}. <strong>${c[0]}:</strong> ${c[1]}</div>`).join('')+'</div>';
  const _byoTermsEl2=document.getElementById('byo-custom-terms');
  const _byoTermsText=(_byoTermsEl2?_byoTermsEl2.value:(_byoCustomTerms||'')).trim();
  const _customTermsBlock=_byoTermsText
    ?`<div style="margin-top:14px;padding-top:14px;border-top:1px solid #e2e8f0"><div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#1a365d;margin-bottom:8px">Additional Terms</div><div style="font-size:11px;color:#2d3748;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere">${escHtml(_byoTermsText)}</div></div>`
    :'';
  return _clausesHtml+_customTermsBlock;
}

async function sendGenericProposal(previewOnly){
  saveGenericEstimate(true); // draft=true skips navigation, modal shows over estimate page
  _saveToLineHistory();
  if(!previewOnly){
    // BYO line items already define the scope; chips are optional summary only.
    // Only block if there are no chips, no line items, and the contractor hasn't explicitly skipped.
    const _hasLineItems=_geiIsFreeForm?_byoItems.some(it=>it.on):_geiLines.length>0;
    if(!_geiScopeChips.length&&!_geiScopeNoScope&&!_hasLineItems){zAlert('Add scope items or tap "None" to skip scope on this proposal.',{title:'Scope required'});return;}
    if(_geiIsTM){
      if(!_tmRatePerMan||!_tmEstHours){zAlert('Enter your hourly rate and estimated days in the Rates & crew section.',{title:'Time & labor required'});return;}
      if(!_geiLines.some(l=>!l._tmLabor&&l.desc)){zAlert('Add at least one material or cost item in the Materials section.',{title:'Materials required'});return;}
    }else if(_geiIsFreeForm){
      const _byoOn=_byoItems.filter(it=>it.on);
      if(!_byoOn.some(it=>it.section==='Materials')){zAlert('Add at least one item in the Materials section.',{title:'Materials required'});return;}
      if(!_byoOn.some(it=>it.section==='Interior'||it.section==='Exterior')){zAlert('Add at least one line item in Interior or Exterior.',{title:'Work items required'});return;}
    }
    // Build minimal proposal for sign.html
    if(!navigator.onLine){zAlert('You\'re offline, the proposal link can\'t be activated right now.\n\nYour estimate is saved. Once you\'re back online, open this bid and tap Send to send the link to your client.',{title:'No internet connection'});return;}
    if(!supaEnabled()||!_supaUser){zAlert('Sign in to send client links.');return;}
  }
  if(_stripeConnectStatus===null)_fetchStripeConnectStatus().catch(()=>{});
  const v=id=>{const _e=document.getElementById(id);return _e?(_e.value||''):'';};
  const{total}=calcGeiTotal();
  // GC-bid mode: this estimate is a sub's itemized bid to a LINKED GC, not a
  // homeowner proposal. Route it to the GC as a signable bid (amount + scope +
  // line count) and stop, never mint a client sign-link. Fires only when
  // _openBidBuilder stamped the context; normal client sends skip this entirely.
  if(!previewOnly&&typeof window!=='undefined'&&window._gcBidCtx&&typeof _maybeRouteGcBid==='function'){
    // Stale-context guard: route as a GC bid ONLY if THIS estimate's client is
    // the linked GC's card. If the sub abandoned a bid and started a normal
    // estimate, the client won't match, clear the context and send normally.
    const _cliCard=(typeof clients!=='undefined')?clients.find(c=>c&&String(c.id)===String(_geiClientId)):null;
    if(_cliCard&&String(_cliCard.gcLinkId||'')===String(window._gcBidCtx.gcUid)){
      const _bidScope=(_geiScopeChips&&_geiScopeChips.length)?_geiScopeChips.join(', '):(v('gei-desc')||'');
      const _bidLines=_geiIsFreeForm?_byoItems.filter(it=>it.on).length:_geiLines.length;
      const _routed=await _maybeRouteGcBid(total,_bidScope,_bidLines);
      if(!_routed&&typeof zAlert==='function')zAlert('Couldn\'t send the bid to the GC. Check your connection and try again.',{title:'Bid not sent'});
      return;
    }
    window._gcBidCtx=null; // stale: fall through to the normal client send
  }
  const trade=_geiTrade||getActiveTrade();
  const bname=escHtml(S.bname||getBusinessName()||'');
  const bphone=escHtml(S.bphone||'');const blic=escHtml(S.blic||'');
  const _bnameRaw=S.bname||getBusinessName()||'';const _bphoneRaw=S.bphone||'';const _blicRaw=S.blic||'';
  const clientName=escHtml(v('gei-client'));const clientAddr=escHtml(v('gei-addr'));
  const _clientRec=_geiClientId?clients.find(c=>c.id===_geiClientId):null;
  const clientPhone=escHtml(_clientRec?.phone||'');
  const jobDesc=escHtml(v('gei-desc'));const duration=escHtml(v('gei-duration'));
  const _tradeM=TRADE_META[trade]||null;
  const tradeName=(_tradeM&&_tradeM.label)||'Service';
  const estNum=_geiEditBidId?String(_geiEditBidId).slice(-6):'-';
  const _geiNow=new Date();
  const dateStr=_geiNow.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  const _geiExpD=new Date(_geiNow.getTime()+30*86400000).toLocaleDateString('en-US',{month:'numeric',day:'numeric',year:'numeric'});
  const totalFmt='$'+total.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const _tmDepPct=_geiDepositPct();
  // Deposit is a % of the client-facing TOTAL (incl. tax): the label says "(N%)" next
  // to the estimated total, so computing from the pre-tax subtotal reads as a math error.
  const _tmDepAmt=Math.round(total*_tmDepPct)/100;
  const _tmNteCap=parseFloat(v('tm-nte-cap'))||0;
  const depositFmt='$'+_tmDepAmt.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  // MUST be declared before the template literals below that use it, TDZ if declared after
  // Use the client's job address state, not the contractor's home state
  const _stateKey=(typeof detectStateFromAddr==='function'?detectStateFromAddr(v('gei-addr')):null)||(S&&S.state)||'KS';
  // Proposal accent, uses the contractor's own S.brandColor (set in Settings →
  // Branding) when present, same hex→rgb→lighter-shade treatment as the sign-in
  // boot overlay, so a branded account's proposal actually looks like THEIRS
  // instead of generic navy. Falls back to the original navy when unset, zero
  // visual change for every account that hasn't picked a brand color.
  let _pAccent='#1a365d',_pAccent2='#2a4a7f';
  if(S&&S.brandColor){
    // adaBrand clamp: the accent renders as text on white AND as a bg under
    // white text, a light brand pick would fail WCAG both ways. Belt for
    // legacy stored values; settings.js also clamps at save time now.
    const _bh=(typeof adaBrand==='function'?adaBrand(S.brandColor):S.brandColor).replace('#','');
    const _br=parseInt(_bh.substr(0,2),16),_bg=parseInt(_bh.substr(2,2),16),_bb=parseInt(_bh.substr(4,2),16);
    if(!isNaN(_br)&&!isNaN(_bg)&&!isNaN(_bb)){
      _pAccent='rgb('+_br+','+_bg+','+_bb+')';
      _pAccent2='rgb('+Math.min(255,_br+42)+','+Math.min(255,_bg+42)+','+Math.min(255,_bb+42)+')';
    }
  }
  // One deposit-row template for both modes, only the label wording and accent
  // color differ (T&M calls it a mobilization deposit).
  const _tmDepRow=`<tr style="background:${_geiIsTM?'#0369a1':_pAccent2};color:rgba(255,255,255,.88)"><td style="padding:6px 18px;font-size:11px;font-weight:600">${_geiIsTM?`Mobilization Deposit (${_tmDepPct}%)`:`${_tmDepPct}% Deposit`} Due Before Work Begins</td><td style="padding:6px 18px;text-align:right;font-size:12px;font-weight:700;white-space:nowrap">${depositFmt}</td></tr>`;
  // Full Terms & Conditions, built once, shared by the stored proposal
  // (accordion under the signature in sign.html) and the contractor's own
  // Preview overlay below. No longer embedded in the proposal document body.
  const _fullTermsHtml=_geiBuildTermsHtml();
  // Owner directive: the client-facing proposal shows exactly two dollar figures,
  // the final TOTAL and the deposit due, never a per-room, per-material, or tax/markup
  // breakdown. Research on painting/remodeling proposals backs this: a visible price per
  // line lets clients cherry-pick or self-supply materials/labor against the number they
  // see. Line items below carry scope description only, no qty/amount columns.
  const _mkLineRow=(l,isRrp,suppressNotes)=>{
    // BYO's own notes already print in full under "Scope of work" above (_scopeBlocks):
    // repeating them again here doubled the same paragraph within one proposal and ate
    // up a lot of extra room. Suppressed for regular BYO lines; RRP and T&M lines have
    // no scope-of-work duplicate, so their notes still need to show here.
    const notesHtml=(l.notes&&!suppressNotes)?`<div style="font-size:11px;color:#718096;margin-top:2px">${escHtml(l.notes)}</div>`:'';
    return `<tr style="border-bottom:1px solid #e2e8f0"><td colspan="2" style="padding:9px 18px;font-size:12px;color:#2d3748;overflow-wrap:anywhere"><div>${escHtml(l.desc||'')}${l.qty!==1?`<span style="color:#94a3b8;font-size:11px"> ×${l.qty}</span>`:''}</div>${notesHtml}</td></tr>`;
  };
  let lineRows;
  if(_geiIsFreeForm){
    const _allPropLines=_geiLines.filter(l=>l.desc||l.rate);
    const _propSecs=[...(new Set(_allPropLines.map(l=>l._byoSection||'')))].filter(s=>s!==_RRP_BYO_SECTION);
    if(_allPropLines.some(l=>l._byoSection===_RRP_BYO_SECTION))_propSecs.push(_RRP_BYO_SECTION);
    lineRows=_propSecs.map(sec=>{
      const sLines=_allPropLines.filter(l=>(l._byoSection||'')=== sec);
      if(!sLines.length)return '';
      const isRrpSec=sec===_RRP_BYO_SECTION;
      const secHeader=sec?`<tr><td colspan="2" style="padding:5px 18px 4px;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.09em;color:${isRrpSec?'#92400e':'#64748b'};background:${isRrpSec?'#fffbeb':'#f8fafc'};border-bottom:1px solid #e2e8f0">${escHtml(sec)}</td></tr>`:'';
      return secHeader+sLines.map(l=>{
        const isRrp=l._rrp||isRrpSec;
        return _mkLineRow(l,isRrp,!isRrp);
      }).join('');
    }).join('');
  }else{
    // T&M and other flows: flat list
    lineRows=_geiLines.filter(l=>l.desc||l.rate).map(l=>_mkLineRow(l,l._rrp||false)).join('');
  }
  const notesHtml=v('gei-notes')?`<div style="padding:14px 24px;border-top:1px solid #e2e8f0;font-size:12px;color:#4a5568;line-height:1.6;overflow-wrap:anywhere"><strong style="color:${_pAccent}">Notes:</strong> ${escHtml(v('gei-notes'))}</div>`:'';
  let _propPanelHtml='';
  if(_panelSched){
    const {l1:_pl1,l2:_pl2,imbalance:_pimb}=_panelCalcBalance();
    const _pRows=(_panelSched.circuits||[]).map((c,i)=>`<tr><td style="text-align:center;padding:4px 6px;border:1px solid #cbd5e1;font-size:11px">${i+1}</td><td style="padding:4px 8px;border:1px solid #cbd5e1;font-size:11px">${escHtml(c.desc||'-')}</td><td style="text-align:center;padding:4px 6px;border:1px solid #cbd5e1;font-size:11px">${c.amps||''}A</td><td style="text-align:center;padding:4px 6px;border:1px solid #cbd5e1;font-size:11px">${c.phase==='2pole'?'2-pole':c.phase}</td><td style="text-align:center;padding:4px 6px;border:1px solid #cbd5e1;font-size:11px">${escHtml(c.gauge||'')}</td><td style="text-align:center;padding:4px 6px;border:1px solid #cbd5e1;font-size:11px">${c.afci?'✓':''}</td><td style="text-align:center;padding:4px 6px;border:1px solid #cbd5e1;font-size:11px">${c.gfci?'✓':''}</td></tr>`).join('');
    _propPanelHtml=`<div style="padding:16px 24px;border-top:2px solid #e2e8f0"><div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:${_pAccent};margin-bottom:10px">Panel Schedule, ${_panelSched.panelAmps}A</div><p style="font-size:11px;color:#64748b;margin:0 0 8px">L1 leg: ${_pl1}A · L2 leg: ${_pl2}A${_pimb>0.10?' · <strong style="color:#dc2626">Rebalance recommended</strong>':' · ✓ Balanced'}</p><table style="width:100%;border-collapse:collapse"><thead><tr><th style="background:${_pAccent};color:#fff;padding:5px 6px;border:1px solid #cbd5e1;font-size:10px">#</th><th style="background:${_pAccent};color:#fff;padding:5px 8px;border:1px solid #cbd5e1;text-align:left;font-size:10px">Circuit</th><th style="background:${_pAccent};color:#fff;padding:5px 6px;border:1px solid #cbd5e1;font-size:10px">Amps</th><th style="background:${_pAccent};color:#fff;padding:5px 6px;border:1px solid #cbd5e1;font-size:10px">Phase</th><th style="background:${_pAccent};color:#fff;padding:5px 6px;border:1px solid #cbd5e1;font-size:10px">Wire</th><th style="background:${_pAccent};color:#fff;padding:5px 6px;border:1px solid #cbd5e1;font-size:10px">AFCI</th><th style="background:${_pAccent};color:#fff;padding:5px 6px;border:1px solid #cbd5e1;font-size:10px">GFCI</th></tr></thead><tbody>${_pRows}</tbody></table></div>`;
  }
  const _hdrLabel=_geiIsTM?'Time &amp; Materials':tradeName+' Proposal';
  // No standalone NTE pricing row, the cap is already disclosed in the Terms &
  // Conditions "Contract type" clause below, so this isn't a lost disclosure, just
  // one less dollar figure sitting in the pricing table.
  // Scope section, the scope-CHIP picker (with its plain-English clientDesc
  // explanations) is the one shared, cross-mode "what's included" definition, so
  // it renders whenever any chips are selected, in EVERY estimate type. BYO's
  // own line-item section list is additional structured detail specific to BYO
  // and renders alongside it, not instead of it (previously an if/else silently
  // dropped the selected scope chips whenever BYO had any line items on).
  const _scopeBlocks=[];
  if(_geiScopeChips.length&&!_geiScopeNoScope){
    const _allChipDefs=[...(TRADE_SCOPE_CHIPS[_geiTrade]||[]),...(TRADE_SCOPE_CHIPS.general||[]),..._GEN_SCOPE];
    const _listItems=_geiScopeChips.map(l=>{
      const chip=_allChipDefs.find(c=>c.label===l);
      const desc=chip&&chip.clientDesc?`<span style="font-size:10.5px;color:#718096">, ${escHtml(chip.clientDesc)}</span>`:'';
      return `<li style="font-size:11.5px;color:#4a5568;line-height:1.7;overflow-wrap:anywhere">${escHtml(l)}${desc}</li>`;
    }).join('');
    _scopeBlocks.push(`<ol style="margin:0 0 10px;padding-left:18px">${_listItems}</ol>`);
  }
  const _byoWorkItems2=_geiIsFreeForm?_byoItems.filter(it=>it.on&&!it._rrp):[];
  if(_geiIsFreeForm&&_byoWorkItems2.length>0&&!_geiScopeNoScope){
    const _scopeSecs2=[...(new Set(_byoWorkItems2.map(it=>it.section)))].filter(Boolean);
    const _secBlocks2=_scopeSecs2.map(sec=>{
      const its=_byoWorkItems2.filter(it=>it.section===sec);
      // Items without notes get a quiet section-appropriate descriptor, a bare
      // one-word line ("1. Room") next to fully-described scope items reads as an
      // unfinished document to the client.
      const _fallbackDesc=/material/i.test(sec)?'Included in project total':'Labor and materials per agreed scope';
      const rows='<ol style="margin:4px 0 0;padding-left:18px">'+its.map(it=>`<li style="font-size:11.5px;color:#4a5568;line-height:1.7;overflow-wrap:anywhere">${escHtml(it.label)}<span style="font-size:10.5px;color:#718096">, ${escHtml(it.notes||_fallbackDesc)}</span></li>`).join('')+'</ol>';
      // Sub-section headers match the document's one header style (accent, same
      // scale as "Scope of work"): the old hardcoded gray read as a different
      // font family entirely and made the section look mismatched.
      return `<div style="margin-bottom:10px"><div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:${_pAccent};margin-bottom:2px">${escHtml(sec)}</div>${rows}</div>`;
    }).join('');
    _scopeBlocks.push(_secBlocks2);
  }
  const _scopeSection=_scopeBlocks.length
    ?`<div style="padding:14px 18px 6px;border-bottom:1px solid #e2e8f0;background:#f8fafc"><div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:${_pAccent};margin-bottom:10px">Scope of work</div>${_scopeBlocks.join('')}</div>`
    :'';
  const _geiEpaClient=_geiClientId?clients.find(c=>c.id===_geiClientId):null;
  const _geiYearBuilt=_geiEpaClient?_geiEpaClient.yearBuilt||null:null;
  // EPA RRP (lead-safe) applies to pre-1978 homes where paint will be disturbed.
  // Mirrors _indEpaRequired on the industry path; this declaration was dropped in a
  // refactor while line 2677 still referenced it → ReferenceError aborting every send.
  const _geiEpaRequired=!!(_geiYearBuilt&&_geiYearBuilt<1978&&((_geiEpaClient&&_geiEpaClient.rrpDisturb==='yes')||(typeof _rrpPaintAnswer!=='undefined'&&_rrpPaintAnswer==='yes')));
  const _rrpSection='';
  // TOTAL is the one number a client should remember, sized and weighted like a
  // deliberate focal point (matches the confident-number treatment sign.html's own
  // amount display uses), not just another table row.
  const _totalFooterRows=`<tr style="background:${_pAccent};color:#fff"><td style="padding:14px 18px;font-weight:800;font-size:13px;letter-spacing:.02em">${_geiIsTM?'ESTIMATED TOTAL':'TOTAL'}</td><td style="padding:14px 18px;text-align:right;font-weight:900;font-size:21px;letter-spacing:-.3px;white-space:nowrap">${totalFmt}</td></tr>${_tmDepRow}`;
  // BYO's line items are already fully listed (name + notes) under "Scope of work"
  // above: once per-item prices came out, this table would just repeat the same
  // section headers and names a second time with nothing new to show. T&M doesn't
  // list materials anywhere else, so it keeps the full item table.
  const _lineItemsSection=_geiIsFreeForm
    ?`<table style="width:100%;border-collapse:collapse"><tfoot>${_totalFooterRows}</tfoot></table>`
    :`<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:#f1f5f9;border-bottom:2px solid #e2e8f0"><th colspan="2" style="padding:8px 18px;text-align:left;font-weight:800;text-transform:uppercase;color:#64748b;font-size:9px;letter-spacing:.08em">Description</th></tr></thead><tbody>${lineRows}</tbody><tfoot>${_totalFooterRows}</tfoot></table>`;
  const proposalHtml=`<div style="background:#fff;color:#1a1a1a;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 4px 24px rgba(0,0,0,.10)"><div style="background:linear-gradient(135deg,${_pAccent} 0%,${_pAccent2} 100%);color:#fff;padding:24px 28px;display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid rgba(255,255,255,.1)">${_proposalBizHeader(_bnameRaw,_bphoneRaw,_blicRaw)}<div style="text-align:right;padding-top:4px"><div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.12em;opacity:.9;margin-bottom:8px">${_hdrLabel}</div><div style="font-size:11px;opacity:.6;margin-bottom:2px"># ${estNum}</div><div style="font-size:11px;opacity:.6">Date: ${dateStr}</div></div></div><div style="display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid #e2e8f0"><div style="padding:14px 18px;border-right:1px solid #e2e8f0"><div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;margin-bottom:6px">Customer</div><div style="font-size:14px;font-weight:700;color:${_pAccent}">${clientName}</div>${clientAddr?`<div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;margin-top:7px">Address</div><div style="font-size:12px;color:#4a5568;margin-top:1px">${clientAddr}</div>`:''}${clientPhone?`<div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;margin-top:7px">Phone</div><div style="font-size:12px;color:#4a5568;margin-top:1px">${clientPhone}</div>`:''}</div><div style="padding:14px 18px"><div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;margin-bottom:6px">Project</div><div style="font-size:13px;font-weight:600;color:${_pAccent}">${jobDesc||tradeName+' service'}</div>${duration?`<div style="font-size:11px;color:#718096;margin-top:6px">Est. duration: ${duration}</div>`:''}<div style="font-size:11px;color:#718096;margin-top:3px">Valid until: ${_geiExpD}</div></div></div>${_scopeSection}${_rrpSection}${_lineItemsSection}${notesHtml}${_propPanelHtml}</div>`;
  // Terms & Conditions is NOT part of the document the client reviews first,
  // it only appears in the accordion under the signature on the actual sign
  // step (owner directive 2026-07-13). The preview mirrors that: it shows
  // only the document, same as sign.html's Review step before Approve & Sign.
  if(previewOnly){_showProposalPreviewOverlay(proposalHtml);return;}
  const bidId=_geiEditBidId;
  const token=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
  const proposalKey=`proposals/${_supaUser.id}/${bidId}_${token}.json`;
  // Extract optional chaining out of object literal, Safari chokes on ?. inside { }
  const _stripeEnabled=_stripeConnectStatus?(_stripeConnectStatus.charges_enabled?true:false):false;
  const proposalData={
    id:bidId,token,clientName:v('gei-client'),businessName:S.bname||getBusinessName(),
    contractorUserId:_effectiveUid(),contractorEmail:_supaUser.email,
    clientId:_geiClientId||null,
    proposalHtml,termsHtml:_fullTermsHtml,clientAddr:v('gei-addr'),
    amount:total,deposit:_tmDepAmt,
    createdAt:new Date().toISOString(),status:'pending',
    notifyEmail:_supaUser.email,businessPhone:S.bphone||'',
    stripeConnectEnabled:_stripeEnabled,
    // Which manual pay options the client sees at signing (Settings → How you get
    // paid). Default-true so proposals from before this shipped still show all.
    acceptCash:S.acceptCash!==false,acceptCheck:S.acceptCheck!==false,allowPayLater:S.allowPayLater!==false,
    trade_type:trade,
    state:_stateKey,
    cancelDays:(typeof STATE_CANCEL!=='undefined'&&STATE_CANCEL[_stateKey])?STATE_CANCEL[_stateKey].days:3,
    cancelStatute:_cancelCitation(_stateKey),
    lienStatute:(typeof STATE_LIEN!=='undefined'&&STATE_LIEN[_stateKey])?STATE_LIEN[_stateKey].statute:'applicable mechanic\'s lien statutes',
    yearBuilt:_geiYearBuilt,
    epaRequired:_geiEpaRequired,
    rrpFirmCertNum:(()=>{const l=(typeof licenses!=='undefined'?licenses:[]).find(x=>x.typeId==='epa_firm'&&(!x.expiryDate||x.expiryDate>=todayKey()));return l?.licenseNumber||'';})(),
    rrpRenovatorName:(()=>{const l=(typeof licenses!=='undefined'?licenses:[]).find(x=>x.typeId==='epa_renovator'&&(!x.expiryDate||x.expiryDate>=todayKey()));return l?.holderName||'';})(),
    rrpRenovatorCertNum:(()=>{const l=(typeof licenses!=='undefined'?licenses:[]).find(x=>x.typeId==='epa_renovator'&&(!x.expiryDate||x.expiryDate>=todayKey()));return l?.licenseNumber||'';})(),
    bwebsite:S.bwebsite||'',
    baddr:S.baddr||'',
    poweredBy:S.poweredBy!==false,
  };
  const _uploadRes=await _supa.storage.from('proposals').upload(proposalKey,JSON.stringify(proposalData),{contentType:'application/json',upsert:true,cacheControl:'0'}).catch(e=>({error:e}));
  if(_uploadRes&&_uploadRes.error){showToast('Upload failed, check connection and try again','error');console.error('[proposal upload]',_uploadRes.error);return;}
  const b=bids.find(x=>x.id===bidId);
  if(b){
    b.signingToken=token;b.proposalKey=proposalKey;
    // Mark Pending now so hub snapshot shows the proposal, _commitProposalSent still
    // fires on Text/Email but is safe to call twice (idempotent status change)
    if(b.status==='Draft'||!b.status)b.status='Pending';
    b.draft=false;
    if(!b.proposalSentDate)b.proposalSentDate=todayKey();
    saveAll();
    // saveAll() only SCHEDULES a debounced cloud write (2s timer), force + await it
    // now so the bid's signingToken/proposalKey/status are confirmed in td_bids
    // before this function proceeds (same fire-and-forget gap fixed in _sendCOToHub).
    try{await _flushSaveNow();}catch(_e){}
  }
  const baseUrl=_clientBaseUrl();
  const signingUrl=baseUrl+'sign.html?t='+token+'&u='+_effectiveUid()+'&b='+bidId;
  const shortUrl=await shortenUrl(signingUrl);
  const signingDirectUrl=shortUrl||signingUrl;
  let shareUrl=signingDirectUrl;
  if(b&&b.client_id){
    try{const _hu=await _uploadClientHub(b.client_id);if(_hu)shareUrl=_hu;}catch(e){}
  }
  const _cl=getClientById(b?b.client_id:null);
  // RAW strings only, this object feeds PLAIN-TEXT surfaces (sms: body, email
  // body, navigator.share). `bname`/`clientName` above are escHtml'd for the
  // proposal HTML; reusing them here printed "&amp;" literally in the client's
  // text message. HTML consumers (compose modal) re-escape at injection.
  _pendingShareData={
    url:shareUrl,
    cname:(_cl&&_cl.name)||v('gei-client')||'Client',
    bname:_bnameRaw,
    cphone:((_cl&&_cl.phone)||'').replace(/\D/g,''),
    cemail:(_cl&&_cl.email)||'',
  };
  _pendingSignToken={bidId,token,proposalKey};
  // Show send overlay (centered modal), lets user choose Text / Email / Other app
  _showGeiSendOverlay();
  // Hide the generate button so user can't double-submit
  const geiSendBtn=document.getElementById('gei-send-btn');
  if(geiSendBtn)geiSendBtn.style.display='none';
}
function _geiCopyShareLink(btn){
  const url=_proposalShareData().url;
  if(!url)return;
  navigator.clipboard.writeText(url).catch(()=>{});
  if(btn){btn.innerHTML=svgIcon('✓',{size:14})+' Copied!';setTimeout(()=>{btn.innerHTML=svgIcon('📋',{size:14})+' Copy link';},2000);}
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
      '<div style="font-size:12px;font-weight:700;color:'+(sel?'var(--blue-dk)':'var(--text)')+'">'+(sel?svgIcon('✓',{size:12,color:'var(--blue-dk)'})+' ':'')+t.badge+' '+t.name+'</div>'+
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
        '<div><div style="font-size:17px;font-weight:800">'+svgIcon('🏗',{size:17})+' Industrial Equipment</div>'+
          '<div style="font-size:12px;color:var(--text3);margin-top:2px">'+(c?escHtml(c.name):'No client')+'</div></div>'+
        '<button onclick="document.getElementById(\'ind-equip-ov\').remove()" style="width:30px;height:30px;border-radius:50%;border:none;background:var(--bg2);color:var(--text2);font-size:18px;cursor:pointer;font-family:inherit">×</button>'+
      '</div>'+
    '</div>'+
    '<div style="padding:14px 16px 0">'+

    // ── AI Scope Helper ──
    '<div style="margin-bottom:14px;padding:12px;background:linear-gradient(135deg,#fffbeb,#fff7ed);border-radius:var(--r);border:1.5px solid #fed7aa">'+
      '<div style="font-size:11px;font-weight:800;color:#c2410c;margin-bottom:8px;display:flex;align-items:center;gap:6px">'+
        '<span>'+svgIcon('✨',{size:12,color:'#c2410c'})+'</span> AI Scope Helper'+
        '<span style="font-size:10px;font-weight:500;color:#9a3412;margin-left:4px">- describe what you see, we\'ll suggest the equipment</span>'+
      '</div>'+
      '<textarea id="ind-desc-inp" rows="2" placeholder="e.g. Two small drum dryers, a baghouse, and the control house, heavy rust on dryers, last painted 5+ years ago" style="width:100%;box-sizing:border-box;padding:9px 10px;border:1.5px solid #fed7aa;border-radius:var(--r);background:#fff;color:var(--text);font-size:12px;font-family:inherit;resize:vertical;margin-bottom:8px"></textarea>'+
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
      '<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:var(--text3);margin-bottom:10px">'+svgIcon('🎨',{size:10})+' Paint & Color Specs</div>'+
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
      '<button onclick="_saveIndBid()" style="padding:14px;border-radius:var(--r);border:1.5px solid var(--border2);background:var(--bg2);color:var(--text2);font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">'+svgIcon('💾',{size:14})+' Save Draft</button>'+
      '<button onclick="_sendIndProposal()" style="padding:14px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">'+svgIcon('🔗',{size:14,color:'#fff'})+' Save & Send to Client</button>'+
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
  if(!found.length){suggEl.innerHTML='<span style="color:var(--text3)">No matches, try: drum dryer, silo, baghouse, conveyor, crane, tank…</span>';return;}
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
  if(!_indPieces.length){el.innerHTML='<div style="font-size:12px;color:var(--text3);padding:8px 0;text-align:center;border:1.5px dashed var(--border2);border-radius:var(--r)">No equipment added yet, use the helper above or select a type</div>';return;}
  el.innerHTML='<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:6px">Equipment list</div>'+
    _indPieces.map((p,i)=>{
      const totalSqft=p.qty*p.sqft;
      return '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:var(--bg2);border-radius:var(--r);margin-bottom:5px;border:1px solid var(--border)">'+
        '<div style="min-width:0;flex:1">'+
          '<div style="font-size:12px;font-weight:700;color:var(--text)">'+(p.qty>1?p.qty+'× ':'')+p.name+'</div>'+
          '<div style="font-size:10px;color:var(--text3);margin-top:1px">'+
            (totalSqft?'~'+totalSqft.toLocaleString()+' sq ft':'custom sq ft')+
            (p.lift?' · <span style="color:#c2410c;font-weight:600">'+svgIcon('⚠',{size:10,color:'#c2410c'})+' Lift needed</span>':'')+
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
  const crewLabel=r.crew===1?'Solo: you handle it':r.crew===2?'You + 1 helper needed':r.crew===3?'3-person crew needed':'Full 4-person crew';
  const crewColor=r.crew===1?'#16a34a':r.crew===2?'#2563eb':r.crew>=3?'#d97706':'#1a1a1a';
  const liftLine=r.liftNeeded?'<div style="margin-top:6px;padding:7px 10px;background:#fff7ed;border-radius:var(--r);font-size:11px;color:#c2410c;font-weight:600">'+svgIcon('⚠',{size:11,color:'#c2410c'})+' Man-lift rental likely needed (~$350/day): add as line item if not on site</div>':'';
  const scaffLine=r.flags.some(f=>f&&f.includes('Scaffolding'))?'<div style="margin-top:6px;padding:7px 10px;background:#fef9c3;border-radius:var(--r);font-size:11px;color:#854d0e;font-weight:600">'+svgIcon('🏗',{size:11,color:'#854d0e'})+' Scaffolding may be needed on one or more pieces, verify on-site</div>':'';
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
  if(!navigator.onLine){zAlert('You\'re offline, the proposal link can\'t be activated right now.\n\nYour estimate is saved. Once you\'re back online, open this bid and tap Send to send the link to your client.',{title:'No internet connection'});return;}
  if(!supaEnabled()||!_supaUser){zAlert('Sign in to send client links.');return;}
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
    return `<tr style="border-bottom:1px solid #e2e8f0"><td style="padding:9px 14px;font-size:12px;font-weight:600;color:#2d3748">${escHtml(p.name)}</td><td style="padding:9px 8px;text-align:center;font-size:12px;color:#64748b">${p.qty}</td><td style="padding:9px 8px;text-align:right;font-size:12px;color:#64748b">${totalSqft?totalSqft.toLocaleString():'-'}</td><td style="padding:9px 14px;font-size:11px;color:#94a3b8">${escHtml(p.note||'')}${p.lift?' '+svgIcon('⚠',{size:11,color:'#94a3b8'})+' Lift':''}${p.note&&p.lift?' / ':''}</td></tr>`;
  }).join('');
  const liftWarning=r.liftNeeded?'<div style="padding:10px 18px;background:#fff7ed;border-bottom:1px solid #fed7aa;font-size:11px;color:#c2410c;font-weight:600">'+svgIcon('⚠',{size:11,color:'#c2410c'})+' Man-lift rental likely required (~$350/day): verify availability before scheduling</div>':'';
  const notesSection=notes?`<div style="padding:14px 24px;border-top:1px solid #e2e8f0;font-size:12px;color:#4a5568;line-height:1.6"><strong style="color:#7c2d12">Site Notes:</strong> ${escHtml(notes)}</div>`:'';
  const proposalHtml=`<div style="background:#fff;color:#1a1a1a;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 4px 24px rgba(0,0,0,.10)"><div style="background:linear-gradient(135deg,#7c2d12 0%,#c2410c 100%);color:#fff;padding:20px 24px;display:flex;justify-content:space-between;align-items:flex-start"><div><div style="font-size:18px;font-weight:800">${bname}</div>${bphone?`<div style="font-size:12px;opacity:.7;margin-top:3px">${bphone}</div>`:''}${blic?`<div style="font-size:11px;opacity:.6;margin-top:2px">Lic# ${blic}</div>`:''}</div><div style="text-align:right"><div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.12em;opacity:.9">${svgIcon('🏗',{size:11,color:'#fff'})} Industrial Coating Estimate</div><div style="font-size:11px;opacity:.6;margin-top:6px"># ${estNum}</div><div style="font-size:11px;opacity:.6">Date: ${dateStr}</div></div></div><div style="display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid #e2e8f0"><div style="padding:14px 18px;border-right:1px solid #e2e8f0"><div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;margin-bottom:6px">Customer</div><div style="font-size:14px;font-weight:700;color:#7c2d12">${clientName}</div>${clientAddr?`<div style="font-size:12px;color:#4a5568;margin-top:4px">${clientAddr}</div>`:''}</div><div style="padding:14px 18px"><div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;margin-bottom:6px">Project</div><div style="font-size:13px;font-weight:600;color:#7c2d12">Industrial Equipment Coating</div><div style="font-size:11px;color:#718096;margin-top:3px">${tier.badge} ${tier.name} Specification</div><div style="font-size:11px;color:#718096;margin-top:2px">Valid 30 days from date above</div></div></div><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:#f1f5f9;border-bottom:2px solid #e2e8f0"><th style="padding:8px 14px;text-align:left;font-weight:800;text-transform:uppercase;color:#64748b;font-size:9px;letter-spacing:.08em">Equipment</th><th style="padding:8px 8px;text-align:center;font-weight:800;text-transform:uppercase;color:#64748b;font-size:9px;width:40px">Qty</th><th style="padding:8px 8px;text-align:right;font-weight:800;text-transform:uppercase;color:#64748b;font-size:9px;width:72px">~Sq Ft</th><th style="padding:8px 14px;text-align:left;font-weight:800;text-transform:uppercase;color:#64748b;font-size:9px">Notes</th></tr></thead><tbody>${equipRows}</tbody></table><div style="padding:14px 18px;border-top:1px solid #e2e8f0;background:#fafafa"><div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#7c2d12;margin-bottom:8px">Coating Specification</div><div style="font-size:12px;color:#374151;line-height:1.9"><div><strong>Prep method:</strong> ${escHtml(tier.desc)}</div><div><strong>Primer:</strong> ${escHtml(resolvedPrimer)}</div><div><strong>Topcoat:</strong> ${escHtml(resolvedTopcoat)}</div><div><strong>Finish:</strong> ${escHtml(finish)}</div>${colorNotes?`<div><strong>Color notes:</strong> ${escHtml(colorNotes)}</div>`:''}</div></div><div style="display:grid;grid-template-columns:1fr 1fr 1fr;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0"><div style="padding:12px 14px;border-right:1px solid #e2e8f0"><div style="font-size:10px;color:#94a3b8;margin-bottom:3px">Surface Area</div><div style="font-size:16px;font-weight:800;color:#374151">${r.totalSqft.toLocaleString()} sqft</div></div><div style="padding:12px 14px;border-right:1px solid #e2e8f0"><div style="font-size:10px;color:#94a3b8;margin-bottom:3px">Duration</div><div style="font-size:16px;font-weight:800;color:#374151">${r.calDays}–${r.calDays+1} days</div></div><div style="padding:12px 14px"><div style="font-size:10px;color:#94a3b8;margin-bottom:3px">Crew</div><div style="font-size:16px;font-weight:800;color:#374151">${crewLabel}</div></div></div>${liftWarning}<table style="width:100%;border-collapse:collapse"><tr style="background:#7c2d12;color:#fff"><td style="padding:12px 18px;font-weight:800;font-size:13px">ESTIMATE RANGE</td><td style="padding:12px 18px;text-align:right;font-weight:800;font-size:14px">${rangeStr}</td></tr><tr style="background:#c2410c;color:rgba(255,255,255,.88)"><td style="padding:7px 18px;font-size:12px;font-weight:800">MIDPOINT BID</td><td style="padding:7px 18px;text-align:right;font-size:13px;font-weight:800">${totalFmt}</td></tr><tr style="background:#9a3412;color:rgba(255,255,255,.85)"><td style="padding:6px 18px;font-size:11px;font-weight:600">25% Deposit Due Before Work Begins</td><td style="padding:6px 18px;text-align:right;font-size:12px;font-weight:700">${depositFmt}</td></tr></table>${notesSection}<div style="padding:18px 24px;border-top:2px solid #e2e8f0;background:#f8fafc"><div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#7c2d12;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #e2e8f0">Terms &amp; Conditions</div><div style="font-size:11px;color:#2d3748;line-height:2"><div>1. <strong>Deposit:</strong> 25% due before work begins.</div><div>2. <strong>Balance:</strong> Remainder due upon completion.</div><div>3. <strong>Warranty:</strong> All workmanship warranted for 1 year.</div></div></div></div>`;
  const token=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
  const proposalKey=`proposals/${_supaUser.id}/${_indBidId}_${token}.json`;
  const _indYearBuilt=c?c.yearBuilt||null:null;
  const _indEpaRequired=!!(_indYearBuilt&&_indYearBuilt<1978&&((c&&c.rrpDisturb==='yes')||(typeof _rrpPaintAnswer!=='undefined'&&_rrpPaintAnswer==='yes')));
  const proposalData={
    id:_indBidId,token,clientName:c?.name||'',businessName:S.bname||getBusinessName(),
    contractorUserId:_effectiveUid(),contractorEmail:_supaUser.email,
    proposalHtml,clientAddr:c?.addr||'',amount:midPrice,deposit:Math.round(midPrice*0.25),
    createdAt:new Date().toISOString(),status:'pending',notifyEmail:_supaUser.email,
    businessPhone:S.bphone||'',stripeConnectEnabled:_stripeConnectStatus?(_stripeConnectStatus.charges_enabled?true:false):false,
    acceptCash:S.acceptCash!==false,acceptCheck:S.acceptCheck!==false,allowPayLater:S.allowPayLater!==false,
    trade_type:'painting',
    yearBuilt:_indYearBuilt,
    epaRequired:_indEpaRequired,
    rrpFirmCertNum:(()=>{const l=(typeof licenses!=='undefined'?licenses:[]).find(x=>x.typeId==='epa_firm'&&(!x.expiryDate||x.expiryDate>=todayKey()));return l?.licenseNumber||'';})(),
    rrpRenovatorName:(()=>{const l=(typeof licenses!=='undefined'?licenses:[]).find(x=>x.typeId==='epa_renovator'&&(!x.expiryDate||x.expiryDate>=todayKey()));return l?.holderName||'';})(),
    rrpRenovatorCertNum:(()=>{const l=(typeof licenses!=='undefined'?licenses:[]).find(x=>x.typeId==='epa_renovator'&&(!x.expiryDate||x.expiryDate>=todayKey()));return l?.licenseNumber||'';})(),
    poweredBy:S.poweredBy!==false,
  };
  showToast('Uploading proposal…','⏳');
  await _supa.storage.from('proposals').upload(proposalKey,JSON.stringify(proposalData),{contentType:'application/json',upsert:true,cacheControl:'0'}).catch(e=>console.error('[ind proposal upload]',e));
  const b=bids.find(x=>x.id===_indBidId);
  if(b){b.signingToken=token;b.proposalKey=proposalKey;b.proposalHtml=proposalHtml;saveAll();}
  const baseUrl=_clientBaseUrl();
  const signingUrl=baseUrl+'sign.html?t='+token+'&u='+_effectiveUid()+'&b='+_indBidId;
  const shortUrl=await shortenUrl(signingUrl).catch(()=>null);
  const shareUrl=shortUrl||signingUrl;
  try{await navigator.clipboard.writeText(shareUrl);}catch(e){}
  document.getElementById('ind-equip-ov')?.remove();
  showToast('Proposal link copied to clipboard, text or email it to the client','🔗');
  if(typeof renderCDBids==='function')setTimeout(renderCDBids,120);
}
// ─── End Industrial Equipment Estimate ───────────────────────────────────────

// ── Sales Tax Rate Setup Modal ────────────────────────────────────────────────
function openSalesTaxSetup(){
  if(document.getElementById('sales-tax-setup-overlay'))return;
  const ov=document.createElement('div');
  ov.id='sales-tax-setup-overlay';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:flex-end;justify-content:center';
  ov.onclick=e=>{if(e.target===ov)ov.remove();};
  const stCode=(S&&S.state)||'KS';
  const stName=(typeof STATE_NAMES!=='undefined'&&STATE_NAMES[stCode])||stCode;
  const curRate=parseFloat(S&&S.salesTaxRate)||0;
  ov.innerHTML=
    '<div style="background:var(--bg1);border-radius:16px 16px 0 0;padding:20px;width:100%;max-width:480px;animation:td-pg-enter .22s cubic-bezier(.22,1,.36,1) both">'+
      '<div style="font-size:16px;font-weight:700;color:var(--text1);margin-bottom:4px">Sales Tax Rate</div>'+
      '<div style="font-size:12px;color:var(--text3);margin-bottom:16px">'+stName+', rate charged on taxable materials on your proposals</div>'+
      '<div style="display:flex;gap:8px;margin-bottom:10px">'+
        '<input id="stsu-zip" placeholder="ZIP code" maxlength="5" inputmode="numeric"'+
          ' style="flex:1;padding:10px 12px;border:1.5px solid var(--border2);border-radius:8px;font-size:14px;background:var(--bg2);color:var(--text1)">'+
        '<button onclick="_stsuLookup()" style="padding:10px 14px;background:var(--blue);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">Look up</button>'+
      '</div>'+
      '<div id="stsu-lookup-result" style="font-size:11px;color:var(--text3);min-height:16px;margin-bottom:10px"></div>'+
      '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);margin-bottom:6px">Or enter manually</div>'+
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:20px">'+
        '<input id="stsu-rate" type="number" step="0.001" min="0" max="20" placeholder="e.g. 9.350"'+
          ' value="'+(curRate||'')+'"'+
          ' style="flex:1;padding:10px 12px;border:1.5px solid var(--border2);border-radius:8px;font-size:14px;background:var(--bg2);color:var(--text1)">'+
        '<span style="font-size:14px;color:var(--text2);font-weight:600">%</span>'+
      '</div>'+
      '<button onclick="_stsuSave()" style="width:100%;padding:13px;background:var(--blue);color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer">Save rate</button>'+
      '<button onclick="document.getElementById(\'sales-tax-setup-overlay\')?.remove()" style="width:100%;padding:10px;background:none;color:var(--text3);border:none;font-size:13px;cursor:pointer;margin-top:6px">Cancel</button>'+
    '</div>';
  document.body.appendChild(ov);
}

async function _stsuLookup(){
  const zipEl=document.getElementById('stsu-zip');
  const res=document.getElementById('stsu-lookup-result');
  if(!res||!zipEl)return;
  const zip=(zipEl.value||'').trim();
  if(!/^\d{5}$/.test(zip)){res.textContent='Enter a valid 5-digit ZIP code';res.style.color='var(--amber-dk,#b45309)';return;}
  res.textContent='Looking up…';res.style.color='var(--text3)';
  if(typeof lookupSalesTaxRate==='function'){
    const r=await lookupSalesTaxRate(zip,(S&&S.state)||'KS');
    const rateEl=document.getElementById('stsu-rate');
    if(rateEl)rateEl.value=r.rate;
    if(r.warning){res.textContent=r.warning;res.style.color='var(--amber-dk,#b45309)';}
    else{res.textContent='Rate found for ZIP '+zip+': '+r.rate+'%';res.style.color='var(--green-dk,#15803d)';}
  }
}

function _stsuSave(){
  const rate=parseFloat(document.getElementById('stsu-rate')?.value)||0;
  if(S){S.salesTaxRate=rate;S.salesTaxRateSource='manual';S.settingsTs=Date.now();}
  if(typeof saveAll==='function')saveAll();
  document.getElementById('sales-tax-setup-overlay')?.remove();
  if(typeof calcGeiTotal==='function')calcGeiTotal();
  if(typeof showToast==='function')showToast(rate?'Sales tax rate set to '+rate+'%':'Sales tax rate cleared','✓');
}

// ─── Sign in person, T&M and Build Your Own ─────────────────────────────────
function _geiSignInPerson(){
  saveGenericEstimate(true);
  const bid=bids.find(x=>x.id===_geiEditBidId);
  if(!bid){showToast('Save your estimate first','⚠️');return;}
  if(!bid.client_id){showToast('Link this estimate to a client first','⚠️');return;}
  const{total}=calcGeiTotal();
  if(!total){showToast('Add items to your estimate before signing','⚠️');return;}
  const cname=document.getElementById('gei-client')?.value||bid.client_name||'Client';
  const depPct=_geiDepositPct();
  const depAmt=Math.round(total*depPct/100*100)/100;
  const bal=Math.round((total-depAmt)*100)/100;
  const fmt=n=>'$'+(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const depLabel=_geiIsTM?'Mobilization deposit ('+depPct+'%)':'Deposit ('+depPct+'%)';
  document.getElementById('_gei-ip-ov')?.remove();
  const ov=document.createElement('div');
  ov.id='_gei-ip-ov';
  ov.style.cssText='position:fixed;inset:0;z-index:9700;background:#0008;display:flex;align-items:flex-end;justify-content:center;padding:0';
  ov.innerHTML=
    '<div style="background:var(--bg-card,#fff);border-radius:18px 18px 0 0;width:100%;max-width:520px;max-height:92vh;overflow-y:auto;box-sizing:border-box">'+
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:16px 18px 12px;border-bottom:1px solid var(--border)">'+
        '<div style="font-size:17px;font-weight:800">'+svgIcon('✍',{size:17})+' Sign in person</div>'+
        '<button onclick="document.getElementById(\'_gei-ip-ov\').remove()" style="background:none;border:none;font-size:22px;color:var(--text3);cursor:pointer;padding:0;line-height:1">×</button>'+
      '</div>'+
      '<div style="padding:14px 18px 28px">'+
        '<div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:12px 14px;margin-bottom:16px">'+
          '<div style="font-size:13px;font-weight:700;margin-bottom:8px">'+escHtml(cname)+'</div>'+
          '<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0;border-bottom:1px solid var(--border)"><span style="color:var(--text3)">Contract total</span><strong style="color:var(--blue)">'+fmt(total)+'</strong></div>'+
          (depAmt>0
            ?'<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:1px solid var(--border)"><span style="color:var(--text3)">'+depLabel+'</span><strong style="color:var(--green)">'+fmt(depAmt)+'</strong></div>'+
              '<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0"><span style="color:var(--text3)">Balance on completion</span><strong>'+fmt(bal)+'</strong></div>'
            :'<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0"><span style="color:var(--text3)">Due on completion</span><strong>'+fmt(total)+'</strong></div>'
          )+
        '</div>'+
        // The ONE shared signing pad + the ONE shared terms block (esign.js)
        //, same layout, same capture code, same substance as sign.html's
        // remote signature for this exact document. Full clause list, not a
        // one-line summary, this in-person signature IS the contract.
        esignPadHTML('gei-ip',{nameId:'gei-ip-pname'})+
        esignConsentHTML('gei-ip',_geiBuildTermsHtml())+
        '<button id="gei-ip-confirm-btn" onclick="_geiConfirmInPerson()" disabled style="width:100%;padding:14px;border-radius:var(--rl,12px);border:none;background:var(--bg2);color:var(--text3);font-size:16px;font-weight:700;cursor:not-allowed;font-family:inherit;margin-bottom:10px;transition:background .15s,color .15s">Confirm &amp; close job</button>'+
        '<button onclick="document.getElementById(\'_gei-ip-ov\').remove()" style="width:100%;padding:11px;border-radius:var(--rl,12px);border:none;background:none;color:var(--text3);font-size:14px;cursor:pointer;font-family:inherit">Cancel</button>'+
      '</div>'+
    '</div>';
  document.body.appendChild(ov);
  // Shared e-sign pad (esign.js): markup, listeners, typed-preview all live there.
  // Wired synchronously, the canvas is already in the DOM by this point, and
  // deferring via setTimeout only opens a window where a fast confirm finds no
  // registered pad yet (esignResult returns "no-pad").
  esignWire('gei-ip',{nameId:'gei-ip-pname',onInk:()=>_geiIpCheckReady(),onType:()=>_geiIpCheckReady(),onClear:()=>_geiIpCheckReady()});
}
function _geiIpClearSig(){esignClear('gei-ip');}
function _geiIpCheckReady(){
  const btn=document.getElementById('gei-ip-confirm-btn');
  if(!btn)return;
  const nameOk=(document.getElementById('gei-ip-pname')?.value||'').trim().length>2;
  const ready=nameOk||(typeof esignHasInk==='function'&&esignHasInk('gei-ip'));
  btn.disabled=!ready;
  btn.style.background=ready?'var(--green)':'var(--bg2)';
  btn.style.color=ready?'#fff':'var(--text3)';
  btn.style.cursor=ready?'pointer':'not-allowed';
}
async function _geiConfirmInPerson(){
  const pname=(document.getElementById('gei-ip-pname')?.value||'').trim();
  const typed=pname;
  if(!pname&&!(typeof esignHasInk==='function'&&esignHasInk('gei-ip'))){showToast('Type your name or draw a signature above','⚠️');return;}
  const bid=bids.find(x=>x.id===_geiEditBidId);
  if(!bid){showToast('Bid not found','⚠️');return;}
  const{total}=calcGeiTotal();
  const depPct=_geiDepositPct();
  const depAmt=Math.round(total*depPct/100*100)/100;
  const ts=new Date().toISOString();
  bid.amount=total;bid.deposit=depAmt;bid.status='Closed Won';bid.draft=false;
  bid.signedAt=ts;bid.estStatus='signed';
  const clientName=document.getElementById('gei-client')?.value||bid.client_name||'Client';
  bid.client_name=bid.client_name||clientName;
  saveAll();
  renderDash();
  // Queue schedule alert, fires after user taps "Back to home" and lands on dashboard
  const _alerts=JSON.parse(localStorage.getItem('zp3_schedule_alerts')||'[]');
  _alerts.push({name:clientName,bidId:bid.id,clientId:bid.client_id,isPaid:false});
  localStorage.setItem('zp3_schedule_alerts',JSON.stringify(_alerts));
  // Signature image for the DB record, shared result path (typed name renders
  // in the one cursive face when nothing was drawn).
  const _sigR=esignResult('gei-ip',{requireTyped:false,typedAsSig:true});
  const sigData=_sigR.ok?_sigR.sigData:'';
  // Show confirmation screen immediately
  const ov=document.getElementById('_gei-ip-ov');
  const fmt=n=>'$'+(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const dtFmt=new Date(ts).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
  if(ov){
    ov.innerHTML='<div style="background:var(--bg-card,#fff);border-radius:18px 18px 0 0;width:100%;max-width:520px;padding:32px 24px 40px;box-sizing:border-box;text-align:center">'+
      '<div style="font-size:48px;margin-bottom:12px">'+svgIcon('✅',{size:48,color:'#16a34a'})+'</div>'+
      '<div style="font-size:20px;font-weight:900;color:var(--text);margin-bottom:8px">You\'re all set!</div>'+
      '<div style="font-size:14px;color:var(--text3);margin-bottom:24px">The contract has been signed.</div>'+
      '<div style="background:#f0fdf4;border:1.5px solid #86efac;border-radius:10px;padding:16px;margin-bottom:24px;text-align:left">'+
        '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#15803d;margin-bottom:10px">Confirmation</div>'+
        '<div style="font-size:12px;display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #dcfce7"><span style="color:#374151">Contract total</span><strong style="color:#15803d">'+fmt(total)+'</strong></div>'+
        (depAmt>0?'<div style="font-size:12px;display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #dcfce7"><span style="color:#374151">Deposit due</span><strong>'+fmt(depAmt)+'</strong></div>':'')+
        '<div style="font-size:12px;display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #dcfce7"><span style="color:#374151">Signed by</span><strong>'+escHtml(pname)+'</strong></div>'+
        '<div style="font-size:12px;display:flex;justify-content:space-between;padding:4px 0"><span style="color:#374151">Date &amp; time</span><span>'+dtFmt+'</span></div>'+
      '</div>'+
      '<button onclick="document.getElementById(\'_gei-ip-ov\').remove();goPg(\'pg-dash\');setTimeout(showScheduleAlerts,400)" style="width:100%;padding:14px;border-radius:var(--rl,12px);border:none;background:var(--blue);color:#fff;font-size:16px;font-weight:700;cursor:pointer;font-family:inherit">'+svgIcon('🏠',{size:16,color:'#fff'})+' Back to home</button>'+
    '</div>';
  }
  // Background: write to signed_proposals + upload client hub
  if(typeof supaEnabled==='function'&&supaEnabled()&&typeof _supaUser!=='undefined'&&_supaUser&&bid.client_id){(async()=>{
    const row={bid_id:String(bid.id),contractor_user_id:_supaUser.id,
      client_name:bid.client_name,client_signed_name:pname||typed,
      signed_at:ts,signature_data:sigData,
      payment_status:'pending',deposit:depAmt,amount:total};
    try{
      const{data:rows}=await _supa.from('signed_proposals').select('id')
        .eq('bid_id',String(bid.id)).eq('contractor_user_id',_supaUser.id).limit(1);
      if(rows&&rows[0])await _supa.from('signed_proposals').update(row).eq('id',rows[0].id);
      else await _supa.from('signed_proposals').insert(row);
      if(typeof _uploadClientHub==='function')_uploadClientHub(bid.client_id).catch(()=>{});
    }catch(e){console.warn('gei in-person sign save:',e);}
  })();}
}
