function openBidNotes(bidId){
  const b=bids.find(x=>x.id===bidId);if(!b)return;
  editingBidId=bidId;lastCreatedBidId=bidId;
  document.getElementById('_bid-notes-ov')?.remove();
  const ov=document.createElement('div');ov.className='zmodal-overlay';ov.id='_bid-notes-ov';
  const box=document.createElement('div');box.className='zmodal';
  box.style.maxWidth='480px';
  box.innerHTML=
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">'+
      '<div style="font-size:16px;font-weight:800">Proposal notes</div>'+
      '<button onclick="this.closest(\'.zmodal-overlay\').remove()" style="border:none;background:none;font-size:22px;cursor:pointer;color:var(--text3);padding:0;line-height:1">'+svgIcon('✕',{size:16})+'</button>'+
    '</div>'+
    '<textarea id="_bid-notes-ta" rows="8" placeholder="Add notes about this proposal..." style="width:100%;box-sizing:border-box;padding:12px;font-size:14px;line-height:1.5;border:1px solid var(--border2);border-radius:var(--r);background:var(--bg);color:var(--text);font-family:inherit;resize:vertical;margin-bottom:14px">'+escHtml(b.notes||'')+'</textarea>'+
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

// THERE IS NO DEFAULT TRADE (owner 2026-09-06: "any trade specific branding
// goes out the window, everything has to be aligned to each of the trades").
//
// This used to fall back to 'painting', and every other fallback in the app
// chained off it, so a plumber whose business_type had not loaded yet, a crew
// session, or any path that lost the trade for a moment got a proposal headed
// "Painting Proposal" with a palette icon on it. That is somebody else's trade
// on his paperwork.
//
// 'general' is the honest answer to "we do not know yet": it is a real trade in
// TRADE_META, it has its own services and scope chips, and _tradeProposalLabel
// below prints it as plain "Proposal" rather than branding his document with a
// word he never chose.
function getActiveTrade(){return _activeTrade||_config?.business_type||'general';}

// What a proposal calls itself. A plumber's says Plumbing, a roofer's says
// Roofing, and one we cannot name says Proposal: never another trade's word.
function _tradeProposalLabel(trade,opts){
  const t=trade||'';
  const m=TRADE_META[t];
  const bare=(opts&&opts.bare)?'Proposal':'Proposal';
  if(!m||t==='general'||t==='other')return bare;
  return m.label+' '+((opts&&opts.lower)?'proposal':'Proposal');
}

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
let _geiClientId=null,_geiEditBidId=null,_geiScanId=null,_geiLines=[],_geiTrade=null,_geiIsCommercial=false,_geiEmergency=false,_geiStep=1,_geiNewWork=false,_geiJobScope='repair';
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
// Last-known estimate address, set at open/resume and by the property gate. The
// editable #gei-addr field is the source of truth when present; this is the
// fallback the resolver uses so the address never depends solely on the DOM.
let _geiCurAddr='';

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
  if(bidId){openGenericEstimate(c,bidId,null,{mode});return;} // resume keeps the bid's own address
  // Owner spec: for a NEW estimate on a client with 2+ properties, pick the
  // address FIRST (right after choosing T&M/BYO), before the builder appears, so
  // it can never land on the wrong one. Add-new is inside the picker. Single-
  // address clients skip straight through, no extra tap.
  if(c&&typeof clientAddresses==='function'&&clientAddresses(c).length>1&&typeof pickClientAddress==='function'){
    pickClientAddress(c.id,addr=>_geiOpenModeAt(c,mode,addr));
    return;
  }
  _geiOpenModeAt(c,mode,c?c.addr:'');
}
function _geiOpenModeAt(c,mode,addr){
  // Drafts belong to a specific property. Only offer a draft to resume when it's
  // for the SAME address the user just picked at the gate: a primary-address
  // draft must never surface (or silently resume) when they picked the rental or
  // added a new address (owner-reported: "added a new address but it started the
  // estimate under primary"). A draft with no addr is treated as the primary.
  const _pick=_geiAddrKey(addr||(c&&c.addr)||'');
  const drafts=c?_geiFindDraftsFor(c.id,mode).filter(b=>!_geiDraftIsEmpty(b)&&_geiAddrKey(b.addr||c.addr||'')===_pick):[];
  if(!drafts.length){openGenericEstimate(c,null,null,{mode,forceAddr:addr});return;}
  _geiShowDraftChooser(c,mode,drafts,addr);
}
// Normalize an address to its street line so "same property" comparisons are
// stable (mirrors data.js siteNoteKey; falls back if that helper isn't loaded).
function _geiAddrKey(a){return (typeof siteNoteKey==='function')?siteNoteKey(a||''):String(a||'').split(',')[0].trim().toLowerCase().replace(/\s+/g,' ');}
function _geiShowDraftChooser(c,mode,drafts,addr){
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
    '<button onclick="_geiStartFreshDraft()" style="display:block;width:100%;padding:13px;border-radius:10px;border:none;background:var(--blue);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;margin-top:4px">'+svgIcon('➕',{size:14})+' Start a fresh '+modeLabel+' proposal</button>'+
    '<button onclick="document.getElementById(\'_gei-draft-chooser\')?.remove()" style="display:block;width:100%;padding:11px;border-radius:10px;border:none;background:none;color:var(--text3);font-size:13px;cursor:pointer;font-family:inherit;margin-top:4px">Cancel</button>';
  ov.appendChild(box);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  ov.dataset.mode=mode;ov.dataset.clientId=c?.id||'';ov.dataset.addr=addr||'';
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
  const mode=ov?.dataset.mode;const clientId=Number(ov?.dataset.clientId);const addr=ov?.dataset.addr||'';
  ov?.remove();
  const c=getClientById(clientId);if(!c)return;
  openGenericEstimate(c,null,null,{mode,forceNew:true,forceAddr:addr});
}

// ── One fact, one home ──────────────────────────────────────────────────────
//
// Owner 2026-09-06: fewer clicks, less setup, and it has to be the smartest
// tool out there. Smart starts with not asking a man something the app has
// already been told.
//
// Every one of these was a question on step 1 whose answer was already sitting
// in the account or on the customer record, and the estimator threw the stored
// answer away and started blank:
//
//   * PROPERTY TYPE. The client form asks single family / condo / rental /
//     commercial / new construction. Step 1 asked Residential or Commercial
//     again, and _geiIsCommercial was hardcoded false on every open.
//   * WORK TYPE. "New construction" is one of those same client-form answers.
//     Step 1 asked Repair or New build as if nobody had said.
//   * HIS HOURLY RATE. S.laborRate is set in Settings and this file NEVER read
//     it: _tmRatePerMan started at 0 every time, so he typed his own rate on
//     every T&M bid, and the send button refused him until he did.
//   * THE DEPOSIT. Hardcoded 25% with nowhere to store his own standard, so a
//     contractor who always takes a third re-set it on every single estimate.
//
// The chain is: what he set on THIS estimate, then this customer's record,
// then his account default, then the trade's. Nothing starts at zero that the
// app has been told, and the screen states the answer instead of asking the
// question.
function _geiFacts(c){
  const pt=String((c&&c.ptype)||'').toLowerCase();
  const rate=Number(S&&S.laborRate)||0;
  const dep=Number(S&&S.depositPct);
  return {
    // The customer's own property type, which is a strictly better answer than
    // a blank toggle: he told us when he wrote the customer down.
    commercial:pt==='commercial',
    // Same field, second question. "New construction" answers both.
    workScope:pt==='new construction'?'improvement':'repair',
    // His rate, not zero.
    laborRate:rate>0?rate:0,
    // His standard deposit, and 25 only when he has never said otherwise.
    depositPct:(dep>0&&dep<=100)?dep:25,
  };
}
// What the summary line on step 1 reads out, in his words. It states what the
// app worked out so he can correct it in one tap, instead of making him
// re-enter it every time to prove he means it.
function _geiFactsLine(){
  const bits=[
    _geiIsCommercial?'Commercial':'Residential',
    _geiJobScope==='improvement'?'new build':'repair',
    _geiEmergency?'emergency rate':'normal hours',
  ];
  return bits.join(', ');
}

function openGenericEstimate(c,bidId,_tradePick,opts){
  // Start of the drafting clock, so "how long to write a proposal" is measurable.
  try{if(typeof lcProposalStarted==='function')lcProposalStarted(c&&c.id!=null?c.id:_geiClientId);}catch(_e){}
  // Mode comes in explicitly (never inherited from whatever estimate was open
  // last): stale _geiIsTM/_geiIsFreeForm from a previous estimate was how a
  // Time & Materials resume could open with Build Your Own state mixed in.
  _geiIsTM=opts?.mode==='tm';
  _geiIsFreeForm=opts?.mode==='byo';
  _geiClientId=c?.id||null;
  _geiEditBidId=bidId||null;
  _geiClientTaxRate=null;
  const _facts=_geiFacts(c);
  _geiLines=[];_byoItems=[];_byoCustomSections=[];_byoCustomTerms='';_geiEmergency=false;_panelSched=null;_geiStep=1;_geiScopeChips=[];_geiScopeNoScope=false;_estCrew=[];_geiExclusions=[];_attachSkipped=[];
  // Resolved, not blanked. An emergency is the one thing nobody can know in
  // advance, so that one still starts off.
  _geiIsCommercial=_facts.commercial;
  _geiJobScope=_facts.workScope;
  _geiNewWork=(_facts.workScope==='improvement');
  if(typeof _geiFactsOpen!=='undefined')_geiFactsOpen=false;
  if(typeof _geiJobOpen!=='undefined')_geiJobOpen=false;
  if(typeof _geiDescUserSet!=='undefined')_geiDescUserSet=false;
  _geiScanId=null;
  // Seeded lines (scan / TrueMeasure) are computed here but NOT applied to
  // _geiLines yet: the resume-an-existing-draft lookup below this block can
  // still overwrite _geiLines wholesale from an old unsent draft, and a seed
  // applied before that point would just get discarded, the exact bug this
  // structure exists to prevent. Applied once, after the resume/new-draft
  // logic has settled (see "Seeded lines land now" below).
  let _geiPendingSeedLines=null;
  // Scanned rooms waiting for an estimate (js/scan.js or the Scan Estimate
  // builder parked them): a fresh estimate for the SAME client opens
  // pre-lined. Two seed shapes: `lines` arrives PRE-PRICED from the Scan
  // Estimate builder (surfaces, multipliers, device counts already baked);
  // `rooms` is the raw measured handoff. Consumed once, never leaks into
  // another client's estimate. scanId rides onto the bid so the proposal can
  // embed the measured floor plan.
  if(window._scanEstimateSeed&&!bidId&&c&&String(window._scanEstimateSeed.clientId)===String(c.id)){
    const seed=window._scanEstimateSeed;window._scanEstimateSeed=null;
    _geiScanId=seed.scanId||null;
    if(Array.isArray(seed.lines)&&seed.lines.length){
      _geiPendingSeedLines=seed.lines.map(l=>({desc:l.desc||'',qty:l.qty||1,unit:l.unit||'ea',rate:l.rate||0,total:l.total!=null?l.total:Math.round((l.qty||1)*(l.rate||0)*100)/100,notes:l.notes||'',_byoSection:l._byoSection||'Interior'}));
      if(typeof showToast==='function')showToast(_geiPendingSeedLines.length+' measured line'+(_geiPendingSeedLines.length>1?'s':'')+' loaded from the scan','📐');
    }else{
    // Billing: room total = measured wall footage x the contractor's per-sq-ft
    // rate (Settings). Rate unset = rooms load with the quantity measured and
    // the price theirs to type, exactly like any hand-entered line.
    const _scanRate=Math.max(0,+(S.scanRateSqFt||0));
    _geiPendingSeedLines=(seed.rooms||[]).map(r=>({
      desc:(r.name||'Room')+' · '+(r.wallSqFt||0)+' wall sq ft, '+(r.ceilHt||'')+' ceilings'+(r.doors||r.windows?' ('+(r.doors||0)+' doors, '+(r.windows||0)+' windows)':''),
      qty:r.wallSqFt||1,unit:'sq ft',rate:_scanRate,total:Math.round((r.wallSqFt||1)*_scanRate*100)/100,notes:'Measured by LiDAR scan',_byoSection:'Interior'
    }));
    if(_geiPendingSeedLines.length&&typeof showToast==='function'){
      const priced=_scanRate>0;
      showToast(_geiPendingSeedLines.length+' scanned room'+(_geiPendingSeedLines.length>1?'s':'')+(priced?' priced at $'+_scanRate+'/sq ft':' loaded, set your rate per room'),'📐');
    }
    }
  }
  // TrueMeasure (js/true-measure.js), one of the TrueSuite's tools: a traced
  // area or run, already confirmed by the contractor, same one-shot
  // consume-and-clear shape as the scan seed above.
  if(window._trueMeasureSeed&&!bidId&&c&&String(window._trueMeasureSeed.clientId)===String(c.id)){
    const seed=window._trueMeasureSeed;window._trueMeasureSeed=null;
    if(Array.isArray(seed.lines)&&seed.lines.length){
      _geiPendingSeedLines=(_geiPendingSeedLines||[]).concat(seed.lines.map(l=>({desc:l.desc||'',qty:l.qty||1,unit:l.unit||'ea',rate:l.rate||0,total:l.total!=null?l.total:Math.round((l.qty||1)*(l.rate||0)*100)/100,notes:l.notes||'',_byoSection:l._byoSection||'Exterior'})));
      if(typeof showToast==='function')showToast('Measured line loaded from TrueMeasure','🛰️');
    }
  }
  // His hourly rate comes from Settings. It used to start at 0, which made him
  // type his own rate on every bid and blocked Send until he did.
  _tmCrewCount=1;_tmRatePerMan=_facts.laborRate;_tmEstHours=0;_tmBillingCycle='weekly';_tmCapAction='Stop & get re-approval';
  document.getElementById('gei-cart-bar')?.remove();
  if(_tradePick)_activeTrade=_tradePick;
  _geiTrade=_tradePick||getActiveTrade();
  const trade=_geiTrade;
  const m=TRADE_META[trade]||{icon:'🔧',label:trade.charAt(0).toUpperCase()+trade.slice(1)};
  const titleEl=document.getElementById('gei-trade-title');
  if(titleEl)titleEl.innerHTML=svgIcon(m.icon,{size:24})+' '+_tradeProposalLabel(trade);
  const eyebrowEl=document.getElementById('gei-tbar-eyebrow');
  if(eyebrowEl)eyebrowEl.textContent=_tradeProposalLabel(trade,{lower:true});
  const sf=(id,val)=>{const el=document.getElementById(id);if(el)el.value=val||'';};
  sf('gei-client',c?.name||'');
  sf('gei-addr',opts?.forceAddr||c?.addr||''); // forceAddr = property chosen at the type gate
  _geiCurAddr=opts?.forceAddr||c?.addr||'';
  if(c?.addr)setTimeout(_geiLookupClientTaxRate,0);
  const DESC_PH={electrical:'e.g. Panel upgrade, add EV charger in garage',plumbing:'e.g. Replace water heater, install shutoff valves',hvac:'e.g. Replace AC unit, charge refrigerant',roofing:'e.g. Full shingle replacement, fix ridge flashing',landscaping:'e.g. Weekly mowing, spring cleanup, new mulch',general:'e.g. Drywall repair, power washing, handyman'};
  sf('gei-desc','');sf('gei-notes','');sf('gei-tax-pct','0');sf('gei-duration','');
  // Site notes (crew-only, client-level) are rendered + prefilled lazily by the
  // shared _geiRenderSiteNoteField when the active layout shows (T&M/BYO chrome
  // or the generic step 3), so it's one field across every estimate type.
  const descEl=document.getElementById('gei-desc');
  if(descEl)descEl.placeholder=DESC_PH[_geiTrade]||'Describe the job';
  const nwEl=document.getElementById('gei-new-work');
  if(nwEl)nwEl.checked=false;
  document.getElementById('gei-date').value=todayKey();
  let _resumingExisting=false;
  if(bidId){
    const b=bids.find(x=>x.id===bidId);
    if(b){
      sf('gei-desc',b.type||'');sf('gei-notes',b.notes||'');if(b.addr){sf('gei-addr',b.addr);_geiCurAddr=b.addr;}
      _geiDescUserSet=!!b.descUserSet;
      if(b.geiLines&&b.geiLines.length)_geiLines=JSON.parse(JSON.stringify(b.geiLines));
      if(b.geiTaxPct)sf('gei-tax-pct',b.geiTaxPct);
      if(b.jobScope)_geiJobScope=b.jobScope;
      if(b.scopeChips)_geiScopeChips=[...b.scopeChips];
      if(Array.isArray(b.exclusions))_geiExclusions=[...b.exclusions];
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
        _tmCrewCount=b.tmCrewCount||1;_tmRatePerMan=b.tmRatePerMan||_facts.laborRate;
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
    // Same-property scoping: only reuse/purge a draft whose address matches the one
    // being opened. Without this, picking a new/other address would silently resume
    // the primary-address draft (the owner-reported wrong-address bug). A draft with
    // no addr is treated as the primary; a legacy direct call with no forceAddr keeps
    // the old primary-scoped behavior.
    const _wantAddr=_geiAddrKey(opts?.forceAddr||c?.addr||'');
    const _addrOk=b=>_geiAddrKey(b.addr||c?.addr||'')===_wantAddr;
    const _tMatch=b=>b.client_id===_geiClientId&&!b.signingToken&&b.geiLines!==undefined&&(b.status==='Draft'||b.status==='Pending')&&_typeOk(b)&&_addrOk(b);
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
      _existingGei.addr=_existingGei.addr||opts?.forceAddr||c?.addr||''; // heal legacy no-addr drafts to their property
      _geiEditBidId=_existingGei.id;
      const _b=_existingGei;
      sf('gei-desc',_b.geiDesc||'');sf('gei-notes',_b.notes||'');
      _geiDescUserSet=!!_b.descUserSet;
      // The resumed draft's address applies, UNLESS the property gate just picked
      // one (forceAddr) — a deliberate pick always wins over a stub's default.
      if(_b.addr&&!opts?.forceAddr){sf('gei-addr',_b.addr);_geiCurAddr=_b.addr;}
      if(_b.geiLines&&_b.geiLines.length)_geiLines=JSON.parse(JSON.stringify(_b.geiLines));
      if(_b.geiTaxPct)sf('gei-tax-pct',_b.geiTaxPct);
      if(_b.geiDuration)sf('gei-duration',_b.geiDuration);
      if(_b.geiNewWork){_geiNewWork=true;if(nwEl)nwEl.checked=true;}
      if(_b.panelSched)_panelSched=JSON.parse(JSON.stringify(_b.panelSched));
      // isTM precedence, legacy dual-flag rows (see _byoAutosave note) must
      // resume as T&M, never as an empty BYO.
      if(_b.isTM){_geiIsTM=true;_geiIsFreeForm=false;_tmCrewCount=_b.tmCrewCount||1;_tmRatePerMan=_b.tmRatePerMan||_facts.laborRate;_tmEstHours=_b.tmEstHours||0;_tmBillingCycle=_b.tmBillingCycle||'weekly';_tmCapAction=_b.tmCapAction||'Stop & get re-approval';}
      else if(_b.isFreeForm){_geiIsFreeForm=true;_geiIsTM=false;}
      if(_b.scopeChips)_geiScopeChips=[..._b.scopeChips];
      if(Array.isArray(_b.exclusions))_geiExclusions=[..._b.exclusions];
      _geiScopeNoScope=!!(_b.scopeNoScope);
      // Deposit % is restored in _tmShowPage/_byoShowPage instead, the field
      // doesn't exist in the DOM yet at this point (rendered lazily on page show).
      // Purge other empty duplicates for this client+trade now that we have the right
      // one: through _userDelete so the delete-intent is RECORDED and the next save's
      // sweep soft-deletes them server-side too. A bare array filter only hid them in
      // memory: every reload re-downloaded the zombies, which the old load-side GEI
      // filter then re-hid, the silent-hide loop behind the owner's 53-vs-43 report.
      _userDelete(()=>{
        bids=bids.filter(b=>b.id===_existingGei.id||!(b.client_id===_geiClientId&&!b.signingToken&&b.geiLines!==undefined&&!b.amount&&!(b.geiLines||[]).length&&(b.status==='Draft'||b.status==='Pending')&&(b.trade_type===_geiTrade||!b.trade_type)&&_addrOk(b)));
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
      addr:opts?.forceAddr||c?.addr||'', // the property this estimate is for, so drafts stay same-property-scoped
      ...(_geiIsTM?{isTM:true}:{}),...(_geiIsFreeForm?{isFreeForm:true}:{})};
    bids.unshift(draftBid);_geiEditBidId=draftBid.id;saveAll();
  }
  // Seeded lines land now, after both the resume-existing-draft lookup AND
  // the fresh-draft creation above, so _geiEditBidId is always valid here.
  // Appended, not replacing, so a scan/TrueMeasure seed is never silently
  // discarded just because this client already had an old unsent draft.
  if(_geiPendingSeedLines&&_geiPendingSeedLines.length){
    _geiLines=_geiLines.concat(_geiPendingSeedLines);
    // BYO mode's actual line-item page (_byoShowPage) reads byoItems off the
    // BID RECORD, never _geiLines, whether that page renders now (a resumed
    // draft jumps straight to step 2) or later (a fresh draft only gets
    // there once the contractor clicks through the wizard). Either way
    // _geiLines alone is invisible in BYO mode, so the seed is ALSO
    // converted and persisted as byoItems, the same shape the old-draft
    // migration above already uses.
    if(_geiIsFreeForm){
      let _nid=(_byoItems||[]).reduce((m,x)=>Math.max(m,x.id||0),0)+1;
      const _seedByo=_geiPendingSeedLines.map(l=>({id:_nid++,section:l._byoSection||'Other',label:l.desc||'',price:(l.qty||1)*(l.rate||0),on:true,required:false,notes:l.notes||''}));
      _byoItems=(_byoItems||[]).concat(_seedByo);
      const _seedBid=bids.find(x=>x.id===_geiEditBidId);
      if(_seedBid){_seedBid.byoItems=(_seedBid.byoItems||[]).concat(JSON.parse(JSON.stringify(_seedByo)));saveAll();}
    }
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
    if(typeof _geiSyncAutoName==='function')_geiSyncAutoName();
    const _descVal=document.getElementById('gei-desc')?.value?.trim();
    if(_descVal){const _tEl=document.getElementById('gei-trade-title');if(_tEl)_tEl.textContent=_descVal;}
  }
  if(typeof _geiRenderJobLine==='function')_geiRenderJobLine();
  goPg('pg-est-generic');
  // The builder is now up: retire the "pick estimate type" screen (kept as the
  // backdrop behind the address gate for multi-property clients) with a soft fade.
  const _sp=document.getElementById('_style-pick-ov');
  if(_sp){_sp.style.opacity='0';_sp.style.transform='translateY(10px)';setTimeout(()=>_sp.remove(),240);}
  if(typeof _stylePickState!=='undefined')try{_stylePickState=null;}catch(e){}
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
  _geiStep=n;
  [1,2,3].forEach(i=>{const el=document.getElementById('gei-s'+i);if(el)el.style.display=(i===n)?'':'none';});
  if(n===1)_geiRenderSiteNoteField('gen'); // generic wizard: field lives in step 1, by the property context
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
// BYO's LINES are the scope. Every item carries a title and a description, and
// the proposal prints both as the Scope of work, so a separate chip picker asks
// him to describe the same job a second time and costs taps on the flow that
// has to be the fastest thing in the app. Owner 2026-09-07: "why am I still
// seeing scope of work selections in BYO? Thought we made that smart off
// descriptions?" He is right, the reader got smart and the input never got
// removed.
//
// T&M keeps it, and that is not an inconsistency. A T&M estimate prices
// material CATEGORIES and an hourly rate: nothing in it says what the crew is
// actually going to do. There the chips are the only scope there is.
//
// A BYO draft written before tonight can still carry chips, and they still
// print on its proposal. Hiding the card outright would strand them on a live
// document with no way to take them off (§7.2), so an estimate that HAS them
// keeps a remove-only card and no way to add more.
function _geiScopeCardMode(prefix){
  if(prefix!=='byo')return 'full';
  return (typeof _geiScopeChips!=='undefined'&&_geiScopeChips&&_geiScopeChips.length)?'legacy':'off';
}
function _geiRenderScopeCard(prefix){
  const wrap=document.getElementById(prefix+'-scopecard-wrap');if(!wrap)return;
  const mode=_geiScopeCardMode(prefix);
  if(mode==='off'){wrap.innerHTML='';wrap.style.display='none';return;}
  wrap.style.display='';
  wrap.innerHTML=
    '<div class="card-hd">'+
      '<div class="card-hd-title">Scope of work</div>'+
      (mode==='full'?'<div style="display:flex;gap:6px"><button class="btn btn-sm" onclick="_openScopeSheet(\''+prefix+'-scope-wrap\')">+ Add scope</button></div>':'')+
    '</div>'+
    (mode==='legacy'?'<div style="padding:11px 16px 2px;font-size:11.5px;color:var(--text-3);line-height:1.5">Your line items and their descriptions are the scope on this proposal now. These older entries still print, remove any you do not want.</div>':'')+
    '<div id="'+prefix+'-scope-wrap"></div>';
}
function _geiRenderProfitGauge(prefix,costOninput){
  const wrap=document.getElementById(prefix+'-gauge-wrap');
  if(!wrap||wrap.children.length)return; // idempotent: preserve gauge/animation state across repeat page shows
  wrap.innerHTML=
    '<input type="number" id="'+prefix+'-expected-cost" style="display:none" oninput="'+costOninput+'">'+
    '<div id="'+prefix+'-drive-line" style="display:none;padding:10px 12px;margin:0 0 10px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2)"></div>'+
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
    '<button class="btn btn-xl btn-full" style="margin-top:8px;background:#0f172a;color:#fff;border-color:#0f172a" onclick="_geiPresent()">'+svgIcon('📱',{size:16,color:'#fff'})+' Present on this screen</button>'+
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
// The field is BUILT once and never reset, with a hardcoded 25 in the markup.
// Two things followed from that: his own default (S.depositPct, whose settings
// help text has always promised it is "applied to every new proposal") was
// ignored, and the last estimate's deposit carried into the next one. Both are
// fixed here, on every page show: the resumed bid's own percent if it has one,
// then his standard, then 25 for a contractor who has never said.
function _geiApplyDepositDefault(prefix){
  const el=document.getElementById(prefix+'-deposit-pct');
  if(!el)return;
  const b=_geiEditBidId?bids.find(x=>x.id===_geiEditBidId):null;
  let pct=Number(b&&b.tmDepositPct);
  // BYO stores dollars, not a percent, so read the percent back off the pair.
  if(!(pct>0)&&b&&Number(b.amount)>0&&Number(b.deposit)>0)pct=Math.round(Number(b.deposit)/Number(b.amount)*100);
  if(!(pct>0&&pct<=100)){
    const own=Number(S&&S.depositPct);
    pct=(own>0&&own<=100)?own:25;
  }
  el.value=String(pct);
}
// Single source of truth for "what % deposit does this estimate use", read by
// _byoAutosave, saveGenericEstimate, sendGenericProposal, _geiSignInPerson, and
// _geiConfirmInPerson so T&M and BYO can never drift onto different formulas.
function _geiDepositPct(){
  const el=document.getElementById(_geiIsTM?'tm-deposit-pct':'byo-deposit-pct');
  const typed=parseFloat(el?.value);
  if(typed>0)return typed;
  // A TYPED ZERO IS AN ANSWER, not a blank. Settings has said "0 = no deposit"
  // since it shipped, but zero fell through to the account default here, so a
  // contractor who wanted none got 25% anyway and only found out when the
  // client's proposal asked for money up front. An empty field is still NaN
  // and still falls through, which is the case the default exists for.
  if(typed===0)return 0;
  // His own standard, learned the first time he changes it (_geiRememberDeposit),
  // and 25 only for a contractor who has never said otherwise.
  const own=Number(S&&S.depositPct);
  return (own>0&&own<=100)?own:25;
}
// What he corrects, the app keeps. He sets a third once and every estimate
// after it opens at a third, the same way the price book learns what he
// charges. Never learned from the value we put there ourselves.
function _geiRememberDeposit(){
  const el=document.getElementById(_geiIsTM?'tm-deposit-pct':'byo-deposit-pct');
  const v=parseFloat(el?.value);
  if(!(v>0&&v<=100))return;
  if(Number(S.depositPct)===v)return;
  S.depositPct=v;
  if(typeof _settingsChanged==='function')_settingsChanged();
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
    depositOninput:'_tmInputChange();_geiRememberDeposit()',
    actionOpts:{sendLabel:'Send T&amp;M proposal'},
  },
  byo:{
    pageId:'gei-byo-page',
    defaultTitle:'Build Your Own proposal',
    editFnName:'_editByoTitle',
    titleSuffix:'Build Your Own',
    gaugeOninput:"this.dataset.userSet='true';_byoUpdateRail();_byoAutosave()",
    depositOninput:'_byoUpdateRail();_byoAutosave();_geiRememberDeposit()',
    actionOpts:{extraButtons:[{label:svgIcon('📋',{size:11})+' Add option',onclick:'_byoDuplicateBid()'}]},
  },
};
// Shared page chrome for both single-page estimate layouts: hide the legacy
// wizard, show the page, render the shared components, brand the title, fill the
// client sub-header, and restore the saved deposit %. Returns the saved bid (or
// undefined) so each mode's show-page can do its own field restores from it.
// Shared internal Site-notes field, ONE code path for every estimate type (T&M,
// BYO, and the generic wizard). Renders the single #gei-sitenote textarea into
// the ACTIVE context's wrap (clearing the others so the id never duplicates) and
// prefills from the CLIENT record. Crew-only, never on the client's proposal.
// Live persistence: the site note writes straight to the CLIENT record as the
// contractor types (debounced saveAll), so a re-render of the surrounding
// section never drops unsaved keystrokes and every internal surface reads the
// same source of truth.
let _geiSiteNoteT=null;
// The property this estimate is for: the edited bid's address if any, else the
// client's primary address. Per-property notes key off this.
function _geiSiteAddr(){
  // The editable #gei-addr field is the source of truth while present (the user
  // can retype the job address). If it's absent, fall back to _geiCurAddr (set at
  // open/resume/gate), then the bid, then the client, so the address never
  // depends solely on a DOM node existing.
  const el=document.getElementById('gei-addr');
  if(el){if(el.value&&el.value.trim())return el.value.trim();}
  else if(_geiCurAddr)return _geiCurAddr;
  const b=(_geiEditBidId!=null&&bids.find)?bids.find(x=>x.id===_geiEditBidId):null;
  if(b&&b.addr)return b.addr;
  const c=(_geiClientId!=null&&clients.find)?clients.find(x=>String(x.id)===String(_geiClientId)):null;
  return (c&&c.addr)||'';
}
// Header sub-line "client · address". Plain confirmation of the property the
// estimate is for (chosen at the type gate for multi-property clients); the
// address is NOT changed from inside the estimate, by owner preference.
function _geiRenderAddrSub(prefix){
  const sub=document.getElementById(prefix+'-page-sub');if(!sub)return;
  const c=getClientById(_geiClientId);
  if(!c){sub.textContent='New proposal';return;}
  const street=(_geiSiteAddr()||'').split(',')[0];
  sub.textContent=(c.name||'')+(street?' · '+street:'');
}
function _geiSiteNoteInput(val){
  if(_geiClientId==null||!clients.find)return;
  const c=clients.find(x=>String(x.id)===String(_geiClientId));if(!c)return;
  setSiteNote(c,_geiSiteAddr(),val);
  if(_geiSiteNoteT)clearTimeout(_geiSiteNoteT);
  _geiSiteNoteT=setTimeout(()=>{try{saveAll();}catch(e){}},400);
}
// ── What is NOT included ────────────────────────────────────────────────────
//
// The single most-named thing missing from a contractor's estimate, and the
// one that turns into a fight: permits, asbestos and mold, structural damage
// found after demo, owner-supplied materials, disposal beyond normal debris.
// Homeowner guides literally teach people to treat a missing exclusions list as
// a red flag and go get another bid, and estimate-terms guides call it the
// first line of defense against a dispute. TradeDesk had nothing.
//
// Presets first because nobody writes these from memory at a kitchen table,
// free text underneath because every job has its own. Same card on every
// estimate type, injected by the shared chrome like everything else.
const _EXCL_COMMON=[
  'Permits, plan review and inspection fees',
  'Hazardous materials (asbestos, lead, mold)',
  'Structural or hidden damage found after demo',
  'Owner-supplied materials and fixtures',
  'Disposal beyond normal job debris',
  'Work not specifically listed above',
];
const _EXCL_BY_TRADE={
  roofing:    ['Deck replacement beyond the sheets listed','Gutter replacement','Interior ceiling or drywall repair'],
  hvac:       ['Electrical service upgrades','Duct replacement or resizing','Gas line modifications'],
  plumbing:   ['Wall, ceiling and floor repair after access','Septic or main sewer line work','Fixture upgrades not listed'],
  electrical: ['Drywall patch and paint after access','Panel or service upgrades','Low-voltage and data wiring'],
  painting:   ['Wallpaper removal','Carpentry and rot repair','Moving heavy or fragile furniture'],
  landscaping:['Irrigation repair','Tree removal','Grading or drainage correction'],
};
function _exclList(trade){
  const t=trade||_geiTrade||(typeof getActiveTrade==='function'?getActiveTrade():'general');
  return [...(_EXCL_BY_TRADE[t]||[]),..._EXCL_COMMON];
}
let _geiExclusions=[];
Object.defineProperty(window,'_geiExclusions',{get:()=>_geiExclusions,set:v=>{_geiExclusions=Array.isArray(v)?v:[];},configurable:true});
function _exclToggle(label){
  const i=_geiExclusions.indexOf(label);
  if(i>=0)_geiExclusions.splice(i,1);else _geiExclusions.push(label);
  _geiRenderExclusions(_geiIsTM?'tm':'byo');
  if(typeof _byoAutosave==='function')_byoAutosave();
}
function _exclAddCustom(){
  const el=document.getElementById('gei-excl-custom');
  const v=(el&&el.value||'').trim();
  if(!v)return;
  if(_geiExclusions.indexOf(v)<0)_geiExclusions.push(v);
  if(el)el.value='';
  _geiRenderExclusions(_geiIsTM?'tm':'byo');
  if(typeof _byoAutosave==='function')_byoAutosave();
}
function _geiRenderExclusions(prefix){
  ['tm','byo','gen'].forEach(p=>{if(p!==prefix){const w=document.getElementById(p+'-excl-wrap');if(w)w.innerHTML='';}});
  const wrap=document.getElementById(prefix+'-excl-wrap');if(!wrap)return;
  const opts=_exclList();
  const chosen=_geiExclusions.slice();
  // Anything he typed himself sits with the presets, so the list reads as one
  // thing and he can turn a custom line back off the same way.
  const all=opts.concat(chosen.filter(c=>opts.indexOf(c)<0));
  wrap.innerHTML='<div class="card card-pad-0" style="margin-bottom:12px">'+
    '<div class="card-hd"><div class="card-hd-title">'+svgIcon('⚠',{size:14})+' What is not included</div>'+
      '<div style="font-size:11px;color:var(--text3);font-weight:600">'+(chosen.length?chosen.length+' on the proposal':'optional')+'</div>'+
    '</div>'+
    '<div style="padding:12px 14px">'+
      '<div style="font-size:11px;color:var(--text-3);margin-bottom:10px;line-height:1.5">Naming the boundary is what stops the argument later. Tap what this job does not cover.</div>'+
      '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">'+
        all.map(l=>{
          const on=chosen.indexOf(l)>=0;
          return '<button type="button" onclick="_exclToggle('+escHtml(JSON.stringify(l))+')" '+
            'style="padding:8px 12px;border-radius:20px;border:1.5px solid '+(on?'var(--blue)':'var(--border2)')+';background:'+(on?'var(--blue-lt)':'var(--bg2)')+';color:'+(on?'var(--blue-dk)':'var(--text)')+';font-size:12px;font-weight:'+(on?'800':'600')+';cursor:pointer;font-family:inherit;min-height:38px;text-align:left">'+
            (on?svgIcon('✓',{size:11})+' ':'')+escHtml(l)+'</button>';
        }).join('')+
      '</div>'+
      '<div style="display:flex;gap:8px">'+
        '<input type="text" id="gei-excl-custom" placeholder="Anything else this job does not cover" onkeydown="if(event.key===\'Enter\'){event.preventDefault();_exclAddCustom();}" '+
          'style="flex:1;min-width:0;font-size:13px;padding:9px 11px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);font-family:inherit">'+
        '<button onclick="_exclAddCustom()" class="btn btn-sm" style="flex-shrink:0;min-height:38px">+ Add</button>'+
      '</div>'+
    '</div>'+
  '</div>';
}

function _geiRenderSiteNoteField(prefix){
  ['tm','byo','gen'].forEach(p=>{if(p!==prefix){const w=document.getElementById(p+'-sitenote-wrap');if(w)w.innerHTML='';}});
  const wrap=document.getElementById(prefix+'-sitenote-wrap');if(!wrap)return;
  const c=(_geiClientId!=null&&clients.find)?clients.find(x=>String(x.id)===String(_geiClientId)):null;
  const addr=_geiSiteAddr();
  const val=c?getSiteNote(c,addr):'';
  const addrShort=(addr||'').split(',')[0].trim();
  // Sits right under the address header, amber inset stripe marks it internal.
  // One id (#gei-sitenote) across T&M, BYO, and the generic wizard.
  wrap.innerHTML='<div class="card card-pad-0" style="margin-bottom:12px;box-shadow:var(--shadow-card),inset 3px 0 0 var(--amber,#8A4E00)">'+
    '<div class="card-hd"><div class="card-hd-title">'+svgIcon('📋',{size:14})+' Property access notes</div></div>'+
    '<div style="padding:12px 14px">'+
      '<div style="font-size:11px;color:var(--text-3);margin-bottom:8px">Crew only, never on the proposal. Saved to '+(addrShort?'<strong>'+escHtml(addrShort)+'</strong> and auto-loads on every future job there':'this property')+'.</div>'+
      '<textarea id="gei-sitenote" rows="3" oninput="_geiSiteNoteInput(this.value)" placeholder="Gate code, dog, where to park, tricky access..." style="width:100%;box-sizing:border-box;padding:10px 12px;border:1.5px solid var(--border2);border-radius:var(--r);font-size:13px;font-family:inherit;background:var(--bg2);color:var(--text);resize:vertical;line-height:1.5">'+escHtml(val)+'</textarea>'+
    '</div>'+
  '</div>';
}
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
  _geiApplyDepositDefault(prefix);
  _geiRenderSiteNoteField(prefix);
  _geiRenderExclusions(prefix);
  // Trade branding in title
  const tmMeta=TRADE_META[_geiTrade||getActiveTrade()]||{icon:'🔧',label:'Trade'};
  const titleEl=document.getElementById(prefix+'-tbar-title');
  // The proposal names itself from the work (see _geiAutoName): the trade label
  // is only the empty-estimate state now, not a name he has to replace.
  if(typeof _geiSyncAutoName==='function')_geiSyncAutoName();
  if(titleEl){const _customName=document.getElementById('gei-desc')?.value?.trim();titleEl.innerHTML=_customName?escHtml(_customName):(svgIcon(tmMeta.icon,{size:24})+' '+tmMeta.label+' · '+m.titleSuffix);}
  // Sub-header: client name · address (address is a picker chip when the client
  // has 2+ properties, so an estimate never silently lands on the wrong one).
  _geiRenderAddrSub(prefix);
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
// Interior and Exterior are PAINTING words. An HVAC man swapping a condenser,
// a plumber setting a water heater and an electrician pulling a panel all have
// exactly one honest answer to "is this interior or exterior", which is "who
// cares", and until now the send button refused to let them past without one.
// So the sections follow the trade: painting keeps the two it actually uses,
// everybody else gets Work.
//
// Old estimates are untouched: a bid whose items sit in "Interior" still shows
// an Interior section, because any section an item names is added back to the
// list below (extraFromItems).
const _BYO_PAINT_SECTIONS=['Interior','Exterior','Materials','Add-ons'];
const _BYO_TRADE_SECTIONS=['Work','Materials','Add-ons'];
function _byoSections(){
  const t=_geiTrade||(typeof getActiveTrade==='function'?getActiveTrade():'');
  return t==='painting'?_BYO_PAINT_SECTIONS.slice():_BYO_TRADE_SECTIONS.slice();
}
// Where a line lands when something other than a person put it there (a spoken
// estimate, a seeded hand-off): the trade's first work section, never Materials,
// because "replace the water heater" is the job and not a part.
function _byoWorkSection(){return _byoSections()[0];}
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
  _geiRenderScopeCard('byo');   // the last legacy chip taking the card with it
  ['tm-scope-wrap','byo-scope-wrap'].forEach(id=>_renderScopeChips(id));
  _updateScopeSheetBtn(label);
  // Scope drives the auto crew-labor estimate, refresh the rail + gauge.
  if(_geiIsFreeForm&&typeof _byoUpdateRail==='function')_byoUpdateRail();
  _byoAutosave();
}
function _toggleScopeNone(){
  _geiScopeNoScope=!_geiScopeNoScope;
  if(_geiScopeNoScope)_geiScopeChips=[];
  _geiRenderScopeCard('byo');
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
function _geiRowActionBtns(editCall,delCall,delTitle,dupCall){
  // COPY, because "Bedroom 1, walls only" then "Bedroom 2, walls only" is the
  // single most repeated act in a room-by-room estimate, and retyping the label,
  // the price and the description every time is the whole reason the fast way
  // to build a bid is still a notepad.
  // ICON, not the word "Copy". Three text buttons on a 390px row squeezed the
  // title column until overflow-wrap:anywhere broke a four-letter word across
  // two lines, which made the header taller and pulled the centered checkbox
  // off the title it belongs to (webkit shard 3, 2026-09-07). Same footprint as
  // the delete button, so the row is exactly as wide as it was before Copy
  // existed, and a phone gets one icon instead of a third word.
  return (dupCall?'<button onclick="event.stopPropagation();'+dupCall+'" title="Duplicate this line" aria-label="Duplicate this line" style="background:none;border:1px solid var(--border2);border-radius:6px;padding:4px 8px;font-size:12px;cursor:pointer;font-family:inherit;color:var(--text3);touch-action:manipulation">'+svgIcon('📋',{size:12})+'</button>':'')+
    '<button onclick="event.stopPropagation();'+editCall+'" title="Edit" style="background:none;border:1px solid var(--border2);border-radius:6px;padding:4px 8px;font-size:12px;cursor:pointer;font-family:inherit;color:var(--blue);touch-action:manipulation">Edit</button>'+
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
    // He named it himself, so the auto name stops writing over it, and the
    // rename is saved the way the old "Name your proposal" field's blur was.
    if(typeof _geiDescUserSet!=='undefined')_geiDescUserSet=true;
    if(typeof _byoAutosave==='function')_byoAutosave();
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
// ── A line is a QUANTITY at a RATE ──────────────────────────────────────────
//
// A BYO item used to carry one flat price and nothing else. Twelve interior
// doors at $95 meant the contractor did 12 x 95 in his head and typed 1140, and
// the price book then learned that an interior door costs $1,140 EACH, because
// _pbLearn was handed the line total and told it was a rate. Every
// multiple-quantity line he ever wrote was poisoning his own book, and the
// hours ride on the same key, so the profit gauge drank it too.
//
// price stays the LINE TOTAL. Every existing reader (the rail, the materials
// subtotal, the pro-rata hours split, _estPricedLines) means the total by it and
// keeps working untouched. qty and rate are what is new, and rate is what the
// book learns.
//
// One normalizer, called from _byoRenderSections, which runs after every change:
// no add path can forget it, and an item saved before this shipped is read as
// one at its old price. Nothing to migrate, nothing to sweep.
// Round half UP at the cent, the way money rounds. Math.round alone does not:
// 2.5 x 3.33 is 8.325, which floats to 832.4999999999999 and rounds DOWN to
// $8.32, a penny off on the client's line for no reason a human could explain.
function _geiCents(n){
  const v=Number(n)||0;
  return Math.round(v*100+(v>=0?1e-9:-1e-9))/100;
}
function _byoNormItem(it){
  if(!it||typeof it!=='object')return it;
  const q=Number(it.qty);
  it.qty=(q>0)?q:1;
  // 'ea' for a row that never had one. The trade's own unit is a DEFAULT for a
  // NEW line in the modal, never a rewrite of something already stored: a
  // roofer opening an old bid must not find its lines relabelled "square".
  it.unit=it.unit||'ea';
  if(!(Number(it.rate)>0)){
    // Pre-quantity item: its price WAS the whole line. Read it at one, and read
    // it EXACTLY. Dividing by a qty it never had would cut a signed line to a
    // twelfth of its value; multiplying by one would inflate it just as far.
    // Either way the number a client already agreed to would move, so a row
    // with no rate is one line at its stored price and nothing else.
    it.rate=Number(it.price)||0;
    it.qty=1;
  }
  it.price=_geiCents(it.qty*it.rate);
  return it;
}
function _byoNormAll(){(_byoItems||[]).forEach(_byoNormItem);}
// "12 × $95.00" when there is a count worth showing, empty at a quantity of one.
function _byoQtyLabel(it){
  if(!it||!(Number(it.qty)>1))return '';
  const u=(it.unit&&it.unit!=='ea')?' '+it.unit:'';
  return it.qty+u+' × '+((typeof fmt==='function')?fmt(it.rate):'$'+it.rate);
}

// Shared item-row renderer, one row shape for BYO items (checkbox toggle +
// edit/delete) and T&M material categories (no checkbox, add/edit/delete only):
// title + price + actions on one header line; notes (if present) run full-width
// below that line instead of being squeezed into a narrow left column next to
// empty grey space under the price/action buttons.
function _geiItemRowHtml(opts){
  const{label,notes,price,qtyLabel,editFn,delFn,delTitle,dupFn,checked,rowOnclick,extraClass}=opts;
  const checkHtml=checked!==undefined?'<div class="byo-check'+(checked?' on':'')+'">'+(checked?svgIcon('✓',{size:14}):'')+'</div>':'';
  return '<div class="byo-row'+(checked?' on':'')+(extraClass?' '+extraClass:'')+'"'+(rowOnclick?' onclick="'+rowOnclick+'"':'')+'>'+
    '<div class="byo-row-hd">'+
      checkHtml+
      '<div class="byo-label">'+escHtml(label)+'</div>'+
      '<div class="byo-price">$'+price.toLocaleString()+'</div>'+
      '<div style="display:flex;gap:4px;flex-shrink:0;margin-left:6px">'+
        _geiRowActionBtns(editFn,delFn,delTitle,dupFn)+
      '</div>'+
    '</div>'+
    // The arithmetic, shown. He typed a count and a rate; this is the app
    // saying what it did with them, so a wrong total is caught here and not on
    // the client's copy.
    (qtyLabel?'<div class="byo-meta" style="font-size:11px;color:var(--text3);font-variant-numeric:tabular-nums">'+escHtml(qtyLabel)+'</div>':'')+
    // A described line shows its words. An undescribed one says so, in the
    // list, where he can see at a glance which lines will reach the client as
    // a bare title. Quiet, not red: this is a nudge, not an error.
    (notes
      ?'<div class="byo-meta" style="font-size:11px;color:var(--text-3)">'+escHtml(notes)+'</div>'
      :(editFn?'<div class="byo-meta" style="font-size:11px;color:var(--text3);opacity:.75" onclick="event.stopPropagation();'+editFn+'">+ Add description</div>':''))+
  '</div>';
}
// ── Start from what he already sells ────────────────────────────────────────
//
// 78% of homeowners hire whoever answers first, and a text inside a minute
// books 73% of the time against 4% after half an hour. The proposal document
// cannot win that race; only the clock can. Everything else in the estimate is
// already free (the name writes itself, the scope comes from the lines, the
// exclusions are presets, the description comes back out of the book), so the
// last expensive thing left is naming the six lines he sells on every job of
// this kind. He has already typed them, on every previous bid.
//
// Two ways in, because they answer two different questions:
//   "Same as last time" -> the lines from his most recent proposal for this
//     trade. The right answer when this job is like the last one.
//   "What you always sell" -> the lines that appear in MOST of his bids for
//     this trade, which is the package he does not think about any more.
//
// Derived at render time from bids he already has. No new store, no catalog to
// maintain, no migration, and it is his own history so it can never suggest
// work he does not do.
const _PKG_MIN_BIDS=3;      // below this there is no "usually", only a last time
const _PKG_SHARE=0.5;       // in at least half his bids to count as usual
function _pkgBidLines(b){
  const out=[];
  if(Array.isArray(b&&b.byoItems))b.byoItems.forEach(it=>{if(it&&it.on!==false&&!it._rrp&&it.label)out.push({label:String(it.label).trim(),unit:it.unit||'',rate:Number(it.rate)>0?Number(it.rate):Number(it.price)||0,notes:it.notes||''});});
  if(!out.length&&Array.isArray(b&&b.geiLines))b.geiLines.forEach(l=>{if(l&&!l._tmLabor&&!l._rrp&&l.desc)out.push({label:String(l.desc).trim(),unit:l.unit||'',rate:Number(l.rate)||0,notes:l.notes||''});});
  return out;
}
// His own bids for this trade, newest first, drafts and empties excluded: a
// blank stub is not a job he sold.
function _pkgHistory(trade){
  const t=trade||_geiTrade||(typeof getActiveTrade==='function'?getActiveTrade():'general');
  if(typeof bids==='undefined')return [];
  return bids.filter(b=>b&&!b.cancelledAt&&(b.trade_type||'general')===t&&b.id!==_geiEditBidId&&_pkgBidLines(b).length)
    .sort((a,b)=>String(b.bid_date||'').localeCompare(String(a.bid_date||''))||(b.id-a.id));
}
function _pkgSuggestions(trade){
  const hist=_pkgHistory(trade);
  const out=[];
  if(!hist.length)return out;
  const last=_pkgBidLines(hist[0]);
  if(last.length)out.push({key:'last',label:'Same as last time',sub:last.length+' line'+(last.length===1?'':'s')+' from '+(hist[0].bid_date||'your last one'),lines:last});
  if(hist.length>=_PKG_MIN_BIDS){
    const seen=new Map();
    hist.forEach(b=>{
      const once=new Set();
      _pkgBidLines(b).forEach(l=>{
        const k=_pbKey(l.label);
        if(!k||once.has(k))return;
        once.add(k);
        const e=seen.get(k)||{n:0,l};
        e.n++;e.l=e.l||l;
        seen.set(k,e);
      });
    });
    const usual=[...seen.values()].filter(e=>e.n/hist.length>=_PKG_SHARE)
      .sort((a,b)=>b.n-a.n).map(e=>e.l);
    // Only worth offering when it is genuinely a package and genuinely
    // different from the last job, or it is the same button twice.
    const lastKeys=new Set(last.map(l=>_pbKey(l.label)));
    const differs=usual.some(l=>!lastKeys.has(_pbKey(l.label)))||usual.length!==last.length;
    if(usual.length>=2&&differs)out.push({key:'usual',label:'What you always sell',sub:usual.length+' line'+(usual.length===1?'':'s')+' on most of your '+hist.length+' jobs',lines:usual});
  }
  return out;
}
// Drop the package in. The BOOK is the source of price and words wherever it
// knows the line, so a package carries his current rate and his current
// description, not whatever they were on the job he copied from.
function _pkgApply(key){
  const pick=_pkgSuggestions().find(x=>x.key===key);
  if(!pick)return;
  // _geiAddRememberedLine is the one path (book price, book words, never a
  // double-up), shared with the attach suggestions below.
  pick.lines.forEach(l=>{_geiAddRememberedLine(l);});
  _geiRefreshLines();
  if(typeof showToast==='function')showToast(pick.label+' added, adjust the counts','⚡');
}
function _pkgCardHTML(){
  if(_byoItems.some(x=>x&&!x._rrp))return '';   // only on an empty estimate
  const sugg=_pkgSuggestions();
  if(!sugg.length)return '';
  return '<div class="card card-pad-0" style="margin-bottom:12px;box-shadow:var(--shadow-card),inset 3px 0 0 var(--blue)">'+
    '<div class="card-hd"><div class="card-hd-title">'+svgIcon('⚡',{size:14})+' Start from what you sell</div></div>'+
    '<div style="padding:12px 14px">'+
      '<div style="font-size:11px;color:var(--text-3);margin-bottom:10px;line-height:1.5">Your own lines, at your current prices, already described. Adjust the counts and send.</div>'+
      sugg.map(x=>'<button onclick="_pkgApply('+escHtml(JSON.stringify(x.key))+')" '+
        'style="width:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;border-radius:var(--r);border:1.5px solid var(--border2);background:var(--bg2);cursor:pointer;font-family:inherit;text-align:left;margin-bottom:8px;min-height:52px">'+
        '<div style="min-width:0">'+
          '<div style="font-size:13px;font-weight:800;color:var(--text)">'+escHtml(x.label)+'</div>'+
          '<div style="font-size:11px;color:var(--text3);margin-top:2px">'+escHtml(x.sub)+'</div>'+
        '</div>'+
        '<span style="font-size:13px;font-weight:800;color:var(--blue);flex-shrink:0">Use →</span>'+
      '</button>').join('')+
    '</div>'+
  '</div>';
}

// ── What goes with what ─────────────────────────────────────────────────────
//
// Owner 2026-09-07: "whoever got a tankless unit also gets the isolation
// valves (service valves, maintenance valves, flush kits, etc)."
//
// The package card above answers "what do I sell on a job like this" and only
// shows on an EMPTY estimate. This answers a different question, and it is the
// one that costs money: the estimate already has the tankless on it, the
// valves are missing, and nobody notices until the truck is at the house. A
// forgotten $180 line is not a rounding error on a callback, it is a return
// trip and an argument about whether it was in the price.
//
// Same source as the packages, for the same reasons: his own bids. No catalog
// to maintain, no trade knowledge baked in that goes stale, and it can never
// suggest work he does not do. The rule is plain association: of his past jobs
// that carried this line, most of them also carried that one.
//
// The measure is WITH the anchor against WITHOUT it, not against how often the
// line shows up overall, and the difference is not academic. A trip charge on
// five of six jobs is on every tankless job too, so by any "appears a lot with
// it" test it looks like an attach. Asked the honest question, does he add it
// BECAUSE of the tankless, it falls straight out: 100% with, 67% without, no
// jump. The isolation valves are 100% with and 0% without. That is the whole
// rule, and it is also why an overall-frequency ceiling was rejected: the
// valves sit on exactly half his jobs, which any such ceiling would have cut.
const _ATTACH_MIN=2;        // he has done the anchor at least twice: once is not a habit
const _ATTACH_SHARE=0.6;    // and brought the companion on most of those
const _ATTACH_JUMP=0.5;     // and clearly more often than on jobs without it
const _ATTACH_SCAN=200;     // most recent bids only, this runs on every re-render
let _attachSkipped=[];      // "not this time", for this estimate only
// Every line on the estimate right now, both shapes, so the anchor can be a
// BYO item or a T&M material category.
function _attachCurrent(){
  const out=new Map();
  if(typeof _byoItems!=='undefined'&&Array.isArray(_byoItems))_byoItems.forEach(it=>{
    if(!it||it._rrp||!it.label)return;const k=_pbKey(it.label);if(k&&!out.has(k))out.set(k,String(it.label).trim());
  });
  if(typeof _geiLines!=='undefined'&&Array.isArray(_geiLines))_geiLines.forEach(l=>{
    if(!l||l._tmLabor||l._rrp||!l.desc)return;const k=_pbKey(l.desc);if(k&&!out.has(k))out.set(k,String(l.desc).trim());
  });
  return out;
}
function _attachSuggestions(trade){
  const cur=_attachCurrent();
  if(!cur.size)return [];
  const hist=_pkgHistory(trade).slice(0,_ATTACH_SCAN);
  if(hist.length<_ATTACH_MIN)return [];
  // One key->line map per past bid, built once. Everything below is set math
  // over these, not another pass through the bids.
  const past=hist.map(b=>{
    const m=new Map();
    _pkgBidLines(b).forEach(l=>{const k=_pbKey(l.label);if(k&&!m.has(k))m.set(k,l);});
    return m;
  });
  const skip=new Set(_attachSkipped||[]);
  const cand=new Map();
  cur.forEach((anchorLabel,anchorKey)=>{
    const withAnchor=past.filter(m=>m.has(anchorKey));
    if(withAnchor.length<_ATTACH_MIN)return;
    const without=past.filter(m=>!m.has(anchorKey));
    const tally=new Map();
    withAnchor.forEach(m=>m.forEach((l,k)=>{
      if(k===anchorKey||cur.has(k)||skip.has(k))return;
      const e=tally.get(k)||{n:0,l};e.n++;e.l=e.l||l;tally.set(k,e);
    }));
    tally.forEach((e,k)=>{
      const share=e.n/withAnchor.length;
      if(share<_ATTACH_SHARE)return;
      // Nothing to compare against means we cannot tell the two apart yet, so
      // the share alone has to carry it.
      if(without.length){
        const other=without.filter(m=>m.has(k)).length/without.length;
        if(share-other<_ATTACH_JUMP)return;   // he sells it anyway, that is not an attach
      }
      const prev=cand.get(k);
      if(prev&&prev.share>=share)return;
      cand.set(k,{key:k,line:e.l,share,n:e.n,of:withAnchor.length,anchorLabel});
    });
  });
  return [...cand.values()].sort((a,b)=>b.share-a.share||b.n-a.n).slice(0,4);
}
// One place that turns a remembered line into a line on THIS estimate, so a
// package and an attach can never price or word it differently. The BOOK wins
// on rate, unit and description wherever it knows the line: a suggestion
// carries his CURRENT price, never whatever it was on the job it came from.
function _geiAddRememberedLine(l){
  if(!l||!l.label)return false;
  const key=_pbKey(l.label);
  if(!key)return false;
  const bk=(typeof _pbFind==='function')?_pbFind(l.label,_pbTrade()):null;
  const rate=(bk&&Number(bk.rate)>0)?bk.rate:(Number(l.rate)||0);
  const notes=(bk&&bk.notes)||l.notes||'';
  if(typeof _geiIsFreeForm!=='undefined'&&_geiIsFreeForm){
    if(_byoItems.some(x=>x&&_pbKey(x.label)===key))return false;
    const secs=_byoSections();
    const sec=(/material/i.test(l.label)&&secs.find(x=>/material/i.test(x)))||secs[0]||'Work';
    const nid=(_byoItems.reduce((m,x)=>Math.max(m,x.id||0),0))+1;
    _byoItems.push(_byoNormItem({id:nid,section:sec,label:l.label,qty:1,
      unit:(bk&&bk.unit)||l.unit||'ea',rate,price:rate,notes,on:true}));
    return true;
  }
  if(_geiLines.some(x=>x&&!x._tmLabor&&_pbKey(x.desc)===key))return false;
  // T&M material categories are a lot, priced as one number, the shape
  // _tmMatCatSave writes. Matching it is what keeps the row editable.
  _geiLines.push({desc:String(l.label).trim(),notes,qty:1,unit:'lot',rate,total:rate});
  return true;
}
function _geiRefreshLines(){
  if(typeof _geiIsFreeForm!=='undefined'&&_geiIsFreeForm){
    _byoRenderSections();_byoUpdateRail();
    if(typeof _byoAutosave==='function')_byoAutosave();
    return;
  }
  if(typeof _tmRenderMatList==='function')_tmRenderMatList();
  if(typeof _tmInputChange==='function')_tmInputChange();
}
function _attachAdd(key){
  const pick=_attachSuggestions().find(x=>x.key===key);
  if(!pick){_geiRefreshLines();return;}
  const ok=_geiAddRememberedLine(pick.line);
  _geiRefreshLines();
  if(ok&&typeof showToast==='function')showToast(pick.line.label+' added','⚡');
}
function _attachAddAll(){
  const sugg=_attachSuggestions();
  let n=0;
  sugg.forEach(s=>{if(_geiAddRememberedLine(s.line))n++;});
  _geiRefreshLines();
  if(n&&typeof showToast==='function')showToast(n+' line'+(n===1?'':'s')+' added','⚡');
}
// "Not this time" is per estimate and not remembered: next job the history may
// say something different, and a permanently muted suggestion is how a tool
// stops telling you the thing you needed to hear.
function _attachSkip(key){
  if(!_attachSkipped.includes(key))_attachSkipped.push(key);
  _geiRefreshLines();
}
function _attachCardHTML(){
  const sugg=_attachSuggestions();
  if(!sugg.length)return '';
  const rows=sugg.map((s,i)=>
    '<div style="display:flex;align-items:center;gap:8px;padding:10px 0'+(i?';border-top:1px solid var(--border)':'')+'">'+
      '<div style="flex:1;min-width:0">'+
        '<div style="font-size:13px;font-weight:700;color:var(--text);overflow-wrap:anywhere">'+escHtml(s.line.label)+'</div>'+
        '<div style="font-size:11px;color:var(--text3);margin-top:2px;overflow-wrap:anywhere">with '+escHtml(s.anchorLabel)+' on '+s.n+' of your last '+s.of+'</div>'+
      '</div>'+
      '<button onclick="_attachAdd('+escHtml(JSON.stringify(s.key))+')" class="btn btn-sm btn-p" style="flex-shrink:0;font-size:12px;padding:8px 14px">Add</button>'+
      '<button onclick="_attachSkip('+escHtml(JSON.stringify(s.key))+')" aria-label="Not this time" title="Not this time" style="flex-shrink:0;background:none;border:none;color:var(--text3);font-size:18px;line-height:1;padding:4px 2px;cursor:pointer;font-family:inherit">×</button>'+
    '</div>').join('');
  return '<div class="card card-pad-0" style="margin-bottom:12px;box-shadow:var(--shadow-card),inset 3px 0 0 var(--amber,#B7791F)">'+
    '<div class="card-hd"><div class="card-hd-title">'+svgIcon('🔗',{size:14})+' Usually goes with this</div>'+
      (sugg.length>1?'<button onclick="_attachAddAll()" class="btn btn-sm" style="font-size:11px;padding:6px 10px">Add all</button>':'')+
    '</div>'+
    '<div style="padding:2px 14px 12px">'+rows+'</div>'+
  '</div>';
}

function _byoRenderSections(){
  _injectRrpItems();
  _byoNormAll();
  const wrap=document.getElementById('byo-sections');if(!wrap)return;
  const _defSecs=_byoSections();
  const extraFromItems=_byoItems.map(x=>x.section).filter(s=>!_defSecs.includes(s));
  const allExtra=[..._byoCustomSections,...extraFromItems.filter(s=>!_byoCustomSections.includes(s))];
  const sections=[..._defSecs,...new Set(allExtra)];
  const secHtml=sections.map(sec=>{
    const rows=_byoItems.filter(it=>it.section===sec);
    const isCustom=!_defSecs.includes(sec);
    const rowHtml=rows.length?rows.map(it=>{
      const idx=_byoItems.indexOf(it);
      return _geiItemRowHtml({
        checked:it.on,rowOnclick:'_byoToggle('+idx+')',
        label:it.label,notes:(it.notes&&!it._rrp)?it.notes:'',price:it.price,qtyLabel:_byoQtyLabel(it),
        editFn:'_byoEditItem('+idx+')',delFn:'_byoDelItem('+idx+')',dupFn:it._rrp?'':'_byoDupItem('+idx+')'
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
  // The package card sits ABOVE the sections and only on an empty estimate: it
  // is the fastest way in, and once there is a line on the bid it has done its
  // job and gets out of the way.
  // The attach card goes directly under the work and ABOVE "+ Add section":
  // it is about the lines that are already on the estimate, and putting a
  // rarely-used structural control between them buried it three cards down.
  wrap.innerHTML=_pkgCardHTML()+secHtml+_attachCardHTML()+addSecBtn+tcCard;
}
function _byoToggle(idx){
  if(_byoItems[idx]&&!_byoItems[idx].required){_byoItems[idx].on=!_byoItems[idx].on;_byoRenderSections();_byoUpdateRail();_byoAutosave();}
}
function _byoAutosave(){
  if(!_geiEditBidId)return;
  const b=bids.find(x=>x.id===_geiEditBidId);
  if(!b)return;
  // openGenericEstimate always pre-creates an empty draft stub before any save
  // happens (autosave/resume resilience), and THIS function, not the Save
  // button, is what actually writes a new estimate's first real content onto
  // it, every item/field handler below calls _byoAutosave, for both BYO and
  // T&M. So the empty-stub-to-real-content transition happens here, capture it
  // before mutating.
  const _wasEmpty=_geiDraftIsEmpty(b);
  // "Name your proposal" (#gei-desc) used to only get captured by the explicit Save
  // button (saveGenericEstimate): every autosave silently dropped a name edit until
  // the user hit Save, so backing out mid-edit lost the new name.
  const _trade=_geiTrade||getActiveTrade();
  const _typeLabel=_geiIsTM?'Time & Materials Proposal':_geiIsFreeForm?'Custom Proposal':_tradeProposalLabel(_trade);
  const _descVal=document.getElementById('gei-desc')?.value||'';
  b.type=_descVal||_typeLabel;
  b.geiDesc=_descVal;
  b.descUserSet=!!_geiDescUserSet;
  b.byoItems=JSON.parse(JSON.stringify(_byoItems));
  b.byoCustomSections=[..._byoCustomSections];
  // Stamp the bid's REAL type, this used to write isFreeForm=true on every
  // autosave, so a Time & Materials draft carried BOTH flags and resumed as
  // Build Your Own with empty items (the "my work disappeared" bug).
  b.isFreeForm=_geiIsFreeForm&&!_geiIsTM;
  b.estCrew=[..._estCrew];
  b.exclusions=[..._geiExclusions];
  // THE PROMISE, frozen. _estLaborHours() is derived live from the price book
  // and his scope history, so it MOVES as the book learns. Stamping it here is
  // what lets the job compare what really happened against what this estimate
  // actually said, instead of against a number that has since drifted
  // (js/jobs.js _jobOverrun). Zero is stored as zero on purpose: a bid with no
  // hours behind it has no promise to be over.
  b.estHours=_estLaborHours();
  b.estCrewSize=_estCrew.length||1;
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
  // The "wrote a proposal" moment: fires exactly once, the first time this
  // draft actually holds real content, regardless of which field triggered it.
  if(_wasEmpty&&!_geiDraftIsEmpty(b)){
    try{if(typeof lcProposalSaved==='function')lcProposalSaved(b.id,b.client_id);}catch(_e){}
  }
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
  const trade=_geiTrade||(typeof getActiveTrade==='function'?getActiveTrade():'general');
  const allItems=[..._GEN_SCOPE,...((typeof TRADE_SCOPE_ITEMS!=='undefined'&&TRADE_SCOPE_ITEMS[trade])||[])];
  let hrs=0;
  const _chipHrsKeys=new Set();
  (_geiScopeChips||[]).forEach(label=>{
    const item=allItems.find(x=>x.label===label);
    if(!item||!item.id)return;
    const own=_scopeHistoryHrs(item.id);
    if(own!=null){hrs+=own;_chipHrsKeys.add(_pbKey(label));return;}
    const rate=(typeof window!=='undefined'&&window._scopeRates)?window._scopeRates[item.id+':'+trade]:null;
    if(rate&&rate.sample_count>=5&&rate.median_min>0){hrs+=rate.median_min/60;_chipHrsKeys.add(_pbKey(label));}
  });
  // Priced lines carry hours too (see _pbLearnHours). A line whose description
  // repeats a chip that ALREADY contributed hours is the same work said twice
  // and is counted once. A chip that contributed nothing (no history, no
  // benchmark) does not suppress the line, or the fast path would lose the
  // hours the price book actually knows.
  _estPricedLines().forEach(l=>{
    if(_chipHrsKeys.has(_pbKey(l.desc)))return;
    // MEASURED BEATS SPLIT. A line he has actually clocked into carries its own
    // history now (the clock can see the work he sold, js/jobs.js
    // _jobScopesFromBid), keyed line:<pbKey>. That is a real stopwatch on this
    // exact service, so it outranks the pro-rata figure _pbLearnFromJob derives
    // when nobody timed it.
    const own=_scopeHistoryHrs('line:'+_pbKey(l.desc));
    if(own!=null){hrs+=own;return;}
    const h=_pbHrs(_pbFind(l.desc,trade));
    if(h!=null)hrs+=h;
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
  try{const dt=new Date(d+'T12:00:00');return dt.toLocaleDateString('en-US',{year:'numeric',month:'2-digit',day:'2-digit'});}catch(e){return d;}
}
// Loaded hourly rate (wage × payroll burden) for one employee email, from the pay-rate cache.
function _empLoadedFor(email){
  const comp=(typeof _teamComp!=='undefined'&&_teamComp)?_teamComp[(email||'').toLowerCase()]:null;
  return (comp&&typeof _empLoadedHourly==='function')?_empLoadedHourly(comp):0;
}
// ── What it costs him to get there ──────────────────────────────────────────
//
// Owner 2026-09-06. The 45-minutes-each-way service call is the job that
// quietly loses money, and a contractor almost never works that out on paper.
// We are the only tool that can tell him before he sends the bid, because we
// already log every drive he makes.
//
// It runs on EVERY estimate and almost never costs a network call, because it
// resolves cheapest first:
//   1. Has he driven there before? Use what the truck actually did. Real miles,
//      real minutes, free, instant, works with no signal, and better than any
//      router because it is that road at that hour in his truck.
//   2. Coordinates on both ends? Straight line times a road factor. Within a
//      few percent, free, offline.
//   3. Neither? Return nothing and say nothing. Never invent a drive.
//
// Deliberately NOT a line on the customer's proposal. This is cost, and what he
// charges for a trip is a separate decision he already has a tool for.
const _DRV_ROAD_FACTOR=1.25;   // straight line to road miles, flat country
const _DRV_MPH=32;             // mixed local driving, only used without history
const _DRV_QUIET_MIN=10;       // under this each way, count it but do not natter
const _DRV_MAX_VISITS=30;

// Where his day starts. Not a setting: the shop if he has one, then the home
// office, then the business address, which _migrateShopToPlaces already turns
// into a shop place. Named on the line so a wrong guess is visible.
function _drvOrigin(){
  const rows=(typeof places!=='undefined'&&Array.isArray(places))?places:[];
  const rank=p=>p&&p.kind==='shop'?0:(p&&p.kind==='home_office')?1:9;
  const cand=rows.filter(p=>rank(p)<9&&Number(p.lat)&&Number(p.lon)).sort((a,b)=>rank(a)-rank(b));
  if(cand.length)return{name:cand[0].name||'the shop',lat:+cand[0].lat,lon:+cand[0].lon,kind:cand[0].kind};
  const la=Number(S&&S.officeLat),lo=Number(S&&S.officeLon);
  if(la&&lo)return{name:'the shop',lat:la,lon:lo,kind:'shop'};
  return null;
}
function _drvClientCoords(clientId){
  try{
    const c=JSON.parse(localStorage.getItem('zp3_nearby_geo')||'{}')[clientId];
    if(c&&Number(c.lat)&&Number(c.lon))return{lat:+c.lat,lon:+c.lon};
  }catch(_e){}
  return null;
}
// What the truck actually did, median over every logged run between these two.
function _drvFromHistory(originName,clientName){
  const rows=(typeof mileage!=='undefined'&&Array.isArray(mileage))?mileage:[];
  const nm=v=>String(v||'').trim().toLowerCase();
  const o=nm(originName),c=nm(clientName);
  if(!o||!c)return null;
  const hits=[];
  rows.forEach(m=>{
    if(!m)return;
    const f=nm(m.from_name),t=nm(m.to_name);
    if(!((f===o&&t===c)||(f===c&&t===o)))return;
    const mi=Number(m.miles)||0;
    if(mi<=0)return;
    const a=Date.parse(m.startedIso||''),b=Date.parse(m.endedIso||'');
    const min=(a>0&&b>a)?Math.round((b-a)/60000):0;
    hits.push({mi,min});
  });
  if(!hits.length)return null;
  const med=arr=>{const v=arr.slice().sort((x,y)=>x-y);const i=Math.floor(v.length/2);return v.length%2?v[i]:(v[i-1]+v[i])/2;};
  const miles=med(hits.map(h=>h.mi));
  const mins=hits.map(h=>h.min).filter(v=>v>0);
  return{
    miles:Math.round(miles*10)/10,
    minutes:Math.round(mins.length?med(mins):(miles/_DRV_MPH*60)),
    source:'driven',
  };
}
function _drvFromCoords(origin,dest){
  if(!origin||!dest||typeof _haversineMiles!=='function')return null;
  let mi=0;
  try{mi=_haversineMiles({lat:origin.lat,lng:origin.lon},{lat:dest.lat,lng:dest.lon});}catch(_e){return null;}
  if(!(mi>0))return null;
  const miles=Math.round(mi*_DRV_ROAD_FACTOR*10)/10;
  return{miles,minutes:Math.round(miles/_DRV_MPH*60),source:'estimated'};
}
// One way. Null when we genuinely cannot tell, which is not the same as zero.
function _geiDriveLeg(){
  const origin=_drvOrigin();
  if(!origin)return null;
  const c=_geiClientId?((typeof clients!=='undefined'&&clients.find)?clients.find(x=>String(x.id)===String(_geiClientId)):null):null;
  const hist=_drvFromHistory(origin.name,c&&c.name);
  if(hist)return Object.assign({origin},hist);
  const dest=_drvClientCoords(_geiClientId);
  const est=_drvFromCoords(origin,dest);
  return est?Object.assign({origin},est):null;
}
// A three day job is three round trips. Without this the number is a toy.
function _geiDriveVisits(){
  if(!_geiIsTM)return 1;
  const hrs=Number(_tmEstHours)||0;
  if(hrs<=0)return 1;
  return Math.max(1,Math.min(_DRV_MAX_VISITS,Math.ceil(hrs/8)));
}
// He may already be billing the trip. That drive is then revenue as well as
// cost, and counting only the cost side would understate the job twice over.
// A heuristic on the line's own words, which is what a trip charge is called.
function _geiTripChargeOnBid(){
  const re=/\b(trip charge|trip fee|service call|diagnostic|call out|callout)\b/i;
  let sum=0;
  (_byoItems||[]).forEach(it=>{if(it&&it.on&&re.test(String(it.label||'')))sum+=Number(it.price)||0;});
  (_geiLines||[]).forEach(l=>{if(l&&re.test(String(l.desc||'')))sum+=Number(l.total!=null?l.total:(l.rate||0))||0;});
  return sum;
}
// The whole thing: what the driving on this job costs him, net of anything he
// is already charging for it.
function _geiDriveCost(){
  if(S&&S.countDriveCost===false)return null;
  const leg=_geiDriveLeg();
  if(!leg)return null;
  const visits=_geiDriveVisits();
  const perHr=(_estCrew.length&&_hasEmployees())
    ? _estCrew.reduce((s,e)=>s+_empLoadedFor(e),0)
    : _ownerLoadedHourly();
  const rate=Number(S&&S.irsRate)||0.725;
  const minutes=leg.minutes*2*visits;
  const miles=Math.round(leg.miles*2*visits*10)/10;
  const gross=Math.round((minutes/60)*perHr + miles*rate);
  const billed=_geiTripChargeOnBid();
  const cost=Math.max(0,gross-billed);
  return{
    minutes,miles,cost,gross,billed,visits,
    origin:leg.origin&&leg.origin.name,
    source:leg.source,
    // Worth a word on screen, or short enough to just fold into the number.
    quiet:leg.minutes<_DRV_QUIET_MIN,
    // Asked once, with a real job on the screen, never at signup.
    ask:(S&&S.countDriveCost===undefined)&&leg.minutes>=_DRV_QUIET_MIN,
  };
}
function _geiSetDriveCost(on){
  S.countDriveCost=!!on;
  if(typeof _settingsChanged==='function')_settingsChanged();
  if(_geiIsFreeForm&&typeof _byoUpdateRail==='function')_byoUpdateRail();
  else if(typeof _tmInputChange==='function')_tmInputChange();
}

// His own time, loaded, the same way Crew Cost already values it (finance.js
// builds exactly this from S.ownerPayType/ownerPayRate). One helper so the
// estimate and the books can never disagree about what an hour of his costs.
// ── How long his price holds ────────────────────────────────────────────────
// The proposal has always printed "Valid until: <date>", and it meant nothing:
// generic-estimate computed send-date+30 at RENDER time, sign.html computed
// createdAt+30 of its own, and bids.js computed bid_date+30 of its own. Three
// clocks, three answers, none of them stored, so reopening a three-week-old
// proposal silently handed the client another fresh 30 days and nothing on the
// contractor's side ever knew a price had gone stale.
//
// One number, stamped once, at send. Everything else reads it.
const _EST_VALID_DEFAULT=30;
function _estValidDays(){
  const n=Number(typeof S!=='undefined'&&S?S.estValidDays:0);
  return (n>0&&n<=365)?Math.round(n):_EST_VALID_DEFAULT;
}
// A date key is YYYY-MM-DD or it is not a date. Checked by SHAPE, never by
// handing junk to the Date parser and trusting it to say no: WebKit reads
// "12345T12:00" as the year 12345 and prints 01/01/12345 where Chromium
// returns Invalid Date. Every reader below goes through this.
const _VALID_KEY_RE=/^\d{4}-\d{2}-\d{2}$/;
function _isDateKey(k){return _VALID_KEY_RE.test(String(k||''));}
// The date THIS bid's price holds until. A sent bid carries its own stamp, so
// what the client received is what everyone sees forever after. An unsent draft
// projects from today, because that is what it would be if he sent it now. A
// stamp that is not a date key is not a promise, so it projects too.
function _bidValidUntil(b){
  if(b&&_isDateKey(b.validUntil))return b.validUntil;
  const from=(b&&_isDateKey(b.proposalSentDate)&&b.proposalSentDate)||(b&&_isDateKey(b.bid_date)&&b.bid_date)||todayKey();
  return addDays(from,_estValidDays());
}
// Days until the price expires. 0 = today, negative = already expired.
function _bidValidDaysLeft(b){
  const k=_bidValidUntil(b);
  if(!_isDateKey(k))return null;
  const a=new Date(todayKey()+'T12:00'),z=new Date(k+'T12:00');
  if(isNaN(z))return null;
  return Math.round((z-a)/86400000);
}
function _fmtValidUntil(key){
  if(!_isDateKey(key))return'';
  const d=new Date(String(key)+'T12:00');
  return isNaN(d)?'':d.toLocaleDateString('en-US',{year:'numeric',month:'2-digit',day:'2-digit'});
}
function _ownerLoadedHourly(){
  if(typeof _empLoadedHourly!=='function')return 0;
  const rate=Number(S&&S.ownerPayRate)||0;
  if(rate<=0)return 0;
  return _empLoadedHourly({pay_type:S.ownerPayType||'hourly',pay_rate:rate})||0;
}

// What this bid costs him in labor.
//
// It used to return 0 for anybody with no crew assigned, on the grounds that a
// solo operator's labor is "already priced into the line items". That confuses
// revenue with cost. On a fixed price his own hours ARE the cost, and leaving
// them out meant the gauge computed margin on materials alone and showed most
// of this market a number far better than the truth. A calculator that
// flatters him is worse than none: the day he works it out on paper he never
// trusts the app again.
//
// Crew assigned: their loaded rates, unchanged. Nobody assigned: it is him.
function _estLaborCost(){
  const hrs=_estLaborHours();
  if(hrs<=0)return 0;
  if(_estCrew.length&&_hasEmployees()){
    const crewRate=_estCrew.reduce((s,email)=>s+_empLoadedFor(email),0);
    return Math.round(hrs*crewRate);
  }
  const own=_ownerLoadedHourly();
  return own>0?Math.round(hrs*own):0;
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
// One line in the COST breakdown, never on the customer's proposal. It states
// what it worked out and where it drove from, so a wrong origin is visible, and
// it asks the count-it question exactly once, with a real job on the screen
// instead of at signup where nobody can answer it honestly.
function _geiRenderDriveLine(type,d){
  const el=document.getElementById(type+'-drive-line');
  if(!el)return;
  if(!d||d.quiet||!(d.cost>0)){el.style.display='none';el.innerHTML='';return;}
  const mi=d.miles.toLocaleString('en-US',{maximumFractionDigits:1});
  const trips=d.visits>1?(' \u00b7 '+d.visits+' trips'):'';
  const netNote=d.billed>0?('<div style="font-size:10.5px;color:var(--text3);margin-top:3px">Less the '+(typeof fmt==='function'?fmt(d.billed):'$'+d.billed)+' you are already charging for the trip.</div>'):'';
  const ask=d.ask?
    '<div style="display:flex;gap:8px;margin-top:8px">'+
      '<button onclick="_geiSetDriveCost(true)" class="btn btn-sm" style="flex:1">Always count it</button>'+
      '<button onclick="_geiSetDriveCost(false)" class="btn btn-sm" style="flex:1">Never</button>'+
    '</div>':'';
  el.style.display='';
  el.innerHTML=
    '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px">'+
      '<span style="font-size:12px;color:var(--text2)">Driving from '+escHtml(d.origin||'the shop')+
        ' \u00b7 '+d.minutes+' min \u00b7 '+mi+' mi'+trips+'</span>'+
      '<span style="font-size:13px;font-weight:700;color:var(--text)">'+(typeof fmt==='function'?fmt(d.cost):'$'+d.cost)+'</span>'+
    '</div>'+netNote+ask;
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
  // The same honest caveat one level down. A line built straight from the price
  // book carries no measured hours until a job containing it has been finished
  // (see _pbLearnHours), so its labor is not in the cost at all and the margin
  // shown is materials-only for those lines. Skipped when he typed the cost
  // himself, that number is his and needs no apology.
  const _cEl=document.getElementById(type+'-expected-cost');
  if(!(_cEl&&_cEl.dataset&&_cEl.dataset.userSet)){
    const _cov=_estHoursCoverage();
    if(_cov.total>0&&_cov.known<_cov.total){
      const _n=_cov.total-_cov.known;
      msg='Labor not counted on '+_n+' line'+(_n>1?'s':'')+' yet, it learns from your clock the first time you finish one.';
    }
  }
  // The honest caveat. If this bid has hours on it and we have no idea what an
  // hour of HIS time costs, the number on screen is materials-only and it is
  // flattering him. Say so on the gauge rather than let him read it as profit.
  if(!_estCrew.length&&_ownerLoadedHourly()<=0&&_estLaborHours()>0){
    msg='Your own time is not costed yet. Add your pay rate in Settings for a true number.';
  }
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
  // The name follows the work: adding or turning off a line renames the
  // proposal live, unless he has named it himself (_geiDescUserSet).
  _geiRefreshAutoTitle('byo');
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
  const _byoDrive=(typeof _geiDriveCost==='function')?_geiDriveCost():null;
  const _autoCost=_matTotal+_laborCost+((_byoDrive&&_byoDrive.cost)||0);
  _geiRenderDriveLine('byo',_byoDrive);
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
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px">'+
      '<div style="font-weight:800;font-size:16px">Add to '+escHtml(sec)+'</div>'+
      '<div id="_bya-count" style="font-size:12px;font-weight:700;color:var(--text3)"></div>'+
    '</div>'+
    '<div id="_bya-book"></div>'+
    '<div class="f" style="margin-bottom:4px"><label>Title <span style="font-weight:400;color:var(--text3)">, the client sees this</span></label><input type="text" id="_bya-label" placeholder="e.g. Bedroom 3, walls only" autocomplete="off"></div>'+
    '<div id="_bya-sugg" style="margin-bottom:10px"></div>'+
    _byaQtyRateHTML(1,'','')+
    _byaDescFieldHTML('')+
    '<div style="display:flex;gap:10px;margin-top:14px">'+
      '<button onclick="document.getElementById(\'_byo-add-modal\')?.remove()" class="btn" style="flex:1" id="_bya-close">Cancel</button>'+
      '<button data-sec="'+escHtml(sec)+'" onclick="_byaConfirm(this.dataset.sec)" class="btn btn-p" style="flex:2">Add item</button>'+
    '</div></div>';
  document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  _byaDescHint();_byaLineMath();_byaLineMath();
  _byaRenderBook(sec);
  // The search is wired synchronously: the field exists the moment the sheet is
  // in the DOM, and a listener that only attaches 50ms later misses whatever he
  // typed in the meantime. Only the focus call needs to wait for the paint.
  document.getElementById('_bya-label')?.addEventListener('input',()=>_byaSuggest(sec));
  setTimeout(()=>{
    const labelEl=document.getElementById('_bya-label');
    const priceEl=document.getElementById('_bya-price');
    const notesEl=document.getElementById('_bya-notes');
    if(labelEl)labelEl.focus();
    if(notesEl){
      // Enter makes a newline in notes; only Tab saves and advances. On a phone
      // there is no Tab key, which is what the Add item button is for.
      notesEl.addEventListener('keydown',e=>{
        if(e.key==='Tab'&&!e.shiftKey){
          e.preventDefault();
          _byaConfirmAndNext(sec);
        }
      });
    }
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
// What he has charged before, at the top of the sheet, one tap each. This is
// the whole answer to why a Build Your Own estimate cost ninety interactions
// and a template one cost nineteen: the same work, except one of them made him
// type it. A tap here adds the line and leaves the sheet open, so four items
// is four taps and a Done, not four rounds of typing.
function _byaRenderBook(sec){
  const el=document.getElementById('_bya-book');if(!el)return;
  const book=_pbList().slice(0,6);
  if(!book.length){el.innerHTML='';return;}
  el.innerHTML=
    '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:8px">What you usually charge</div>'+
    '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px">'+
      book.map((b,i)=>'<button data-sec="'+escHtml(sec)+'" data-i="'+i+'" onclick="_byaAddFromBook(this.dataset.sec,+this.dataset.i)" '+
        'style="display:inline-flex;flex-direction:column;align-items:flex-start;padding:7px 11px;border-radius:var(--r);border:1.5px solid var(--border2);background:var(--bg2);cursor:pointer;font-family:inherit;text-align:left;max-width:100%">'+
        '<span style="font-size:12px;font-weight:700;color:var(--text);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml(b.desc)+'</span>'+
        '<span style="font-size:10px;color:var(--text3)">'+(typeof fmt==='function'?fmt(b.rate):'$'+b.rate)+'</span>'+
      '</button>').join('')+
    '</div>'+
    '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:8px">Or type it</div>';
}
// Six chips, never sixty. Past that, the field he is already typing in does the
// searching: three letters beats scrolling forty pills every time, and it is
// the same shape as the who-is-it-for picker, so "find what I have, or make a
// new one" is one pattern in this app and not two (7.3).
function _byaSuggest(sec){
  const wrap=document.getElementById('_bya-sugg');if(!wrap)return;
  const q=(document.getElementById('_bya-label')?.value||'').trim();
  if(q.length<2){wrap.innerHTML='';return;}
  const ql=_pbKey(q);
  const hits=_pbList().filter(b=>_pbKey(b.desc).includes(ql)||_pbSimilar(b.desc,q)>=0.5).slice(0,5);
  if(!hits.length){wrap.innerHTML='';return;}
  wrap.innerHTML=hits.map(b=>{
    const i=_pbList().indexOf(b);
    return '<button data-sec="'+escHtml(sec)+'" data-i="'+i+'" onclick="_byaAddFromBook(this.dataset.sec,+this.dataset.i)" '+
      'style="width:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 11px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);cursor:pointer;font-family:inherit;text-align:left;margin-bottom:5px">'+
      '<span style="font-size:13px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml(b.desc)+'</span>'+
      '<span style="font-size:12px;font-weight:700;color:var(--text3);flex-shrink:0">'+(typeof fmt==='function'?fmt(b.rate):'$'+b.rate)+'</span>'+
    '</button>';
  }).join('');
}
// ONE description field, both modals, so the add and the edit can never drift
// apart on what it is called or what it says (the two used to disagree on
// nothing but they were two copies waiting to).
//
// It is called Description, not Notes, because Notes reads like something for
// HIM. It says the client reads it, because that is the fact that gets it
// filled in. It is NOT required: making it required adds keystrokes to the one
// flow we measure and ratchet down (CLAUDE.md 12.2), and a field people are
// forced past gets junk typed into it. It is encouraged, and the price book
// makes it free from the second job on.
// Count, unit and rate on one row, with the line total spelled out underneath.
// ONE block, both modals, same reason the description field is shared: two
// copies of a money input is two chances for them to disagree.
//
// The rate field keeps the id _bya-price. It is the same box it always was and
// it still holds a per-line number at a quantity of one, so nothing that reads
// it has to change and every existing test still finds it.
// EVERY TRADE PRICES IN ITS OWN UNIT, and a list that does not carry his is
// the tool telling him it was not built for him. The pattern is all over the
// review data: software that treats a roof replacement like a plumbing service
// call loses roofing offices inside a few months. A roofer prices SQUARES, HVAC
// prices TONS, concrete and landscaping price CUBIC YARDS.
//
// His trade's units come first, then the ones every trade uses. Nothing is
// hidden: the full list is always there, because a plumber does occasionally
// sell a square of roof and a hard filter would strand him.
const _UNITS_COMMON=['ea','hr','day','lot','sq ft','lin ft'];
const _UNITS_BY_TRADE={
  roofing:    ['square','sq ft','lin ft','bundle'],
  hvac:       ['ton','ea','system','CFM','lin ft'],
  landscaping:['cu yd','sq ft','ea','ton','flat','plant'],
  painting:   ['sq ft','room','gal','lin ft'],
  plumbing:   ['ea','fixture','lin ft','hr'],
  electrical: ['ea','circuit','fixture','lin ft'],
  general:    ['ea','sq ft','lin ft','cu yd'],
};
const _UNITS_EXTRA=['gal','sq yd','cu yd','ton','square','bundle','fixture','circuit','system','plant','sheet','box','roll','week','month','%'];
function _byaUnitList(trade){
  const t=trade||_geiTrade||(typeof getActiveTrade==='function'?getActiveTrade():'general');
  const seen=new Set(),out=[];
  [...(_UNITS_BY_TRADE[t]||[]),..._UNITS_COMMON,..._UNITS_EXTRA].forEach(u=>{
    const k=String(u).toLowerCase();
    if(seen.has(k))return;
    seen.add(k);out.push(u);
  });
  return out;
}
function _byaQtyRateHTML(qty,unit,rate){
  const q=(Number(qty)>0)?Number(qty):1;
  const units=_byaUnitList();
  const cur=unit||units[0]||'ea';
  // A unit saved on an older line (or by a trade he has since switched away
  // from) still has to appear, or editing that line would silently retitle it.
  const list=units.includes(cur)?units:[cur,...units];
  return '<div class="f" style="margin-bottom:6px">'+
    '<label>How many, and what each</label>'+
    '<div style="display:flex;gap:8px;align-items:center">'+
      '<input type="text" inputmode="decimal" id="_bya-qty" value="'+q+'" oninput="_byaLineMath()" aria-label="Quantity" '+
        'style="width:72px;flex-shrink:0;text-align:center;font-weight:700">'+
      '<select id="_bya-unit" onchange="_byaLineMath()" aria-label="Unit" style="width:104px;flex-shrink:0;font-family:inherit">'+
        list.map(u=>'<option value="'+escHtml(u)+'"'+(u===cur?' selected':'')+'>'+escHtml(u)+'</option>').join('')+
      '</select>'+
      '<div class="input-prefix" style="flex:1;min-width:0"><span>$</span>'+
        '<input type="text" inputmode="numeric" id="_bya-price" value="'+(rate?Number(rate).toLocaleString('en-US'):'')+'" placeholder="0" oninput="_byaFormatPriceInput(this);_byaLineMath()" aria-label="Rate"></div>'+
    '</div>'+
    '<div id="_bya-line-total" style="font-size:12px;font-weight:700;color:var(--text3);margin-top:6px;font-variant-numeric:tabular-nums"></div>'+
  '</div>';
}
// The multiply, done out loud. Silent at a quantity of one, where there is no
// arithmetic to show and a line saying "1 × $95 = $95" is just noise.
function _byaLineMath(){
  const el=document.getElementById('_bya-line-total');if(!el)return;
  const q=parseFloat((document.getElementById('_bya-qty')?.value||'').replace(/,/g,''))||0;
  const r=_byaPriceValue('_bya-price');
  const u=document.getElementById('_bya-unit')?.value||'ea';
  if(!(q>1)||!(r>0)){el.textContent='';return;}
  const t=_geiCents(q*r);
  el.textContent=q+' '+u+' × '+((typeof fmt==='function')?fmt(r):'$'+r)+' = '+((typeof fmt==='function')?fmt(t):'$'+t);
}
function _byaQtyValue(){const v=parseFloat((document.getElementById('_bya-qty')?.value||'').replace(/,/g,''));return (v>0)?v:1;}
function _byaUnitValue(){return document.getElementById('_bya-unit')?.value||_byaUnitList()[0]||'ea';}

function _byaDescFieldHTML(val){
  return '<div class="f" style="margin-bottom:6px">'+
    '<label>Description <span style="font-weight:400;color:var(--text3)">, what it consists of</span></label>'+
    '<textarea id="_bya-notes" rows="3" oninput="_byaDescHint()" placeholder="e.g. Two coats, ceilings included, all trim cut in by hand" style="width:100%;box-sizing:border-box;resize:vertical;font-family:inherit">'+escHtml(val||'')+'</textarea>'+
    '<div id="_bya-desc-hint" style="font-size:11px;color:var(--text3);line-height:1.5;margin-top:4px"></div>'+
  '</div>';
}
// The nudge. Present when the field is empty, gone the moment he writes
// anything, so it reads as encouragement rather than an error he has to clear.
function _byaDescHint(){
  const el=document.getElementById('_bya-desc-hint');if(!el)return;
  const v=(document.getElementById('_bya-notes')?.value||'').trim();
  el.innerHTML=v?'':'Worth 10 seconds: a line with no description prints as just its title, and a vague scope is the top reason clients push back on a price.';
}

function _byaAddFromBook(sec,i){
  const b=_pbList()[i];if(!b)return;
  // Whatever he had half-typed was him looking for THIS, so the field clears
  // and the search closes rather than leaving a stale fragment behind.
  const _l=document.getElementById('_bya-label');if(_l)_l.value='';
  const _sg=document.getElementById('_bya-sugg');if(_sg)_sg.innerHTML='';
  const nextId=(_byoItems.reduce((m,x)=>Math.max(m,x.id),0))+1;
  // The book's own words come with it. This is the whole payoff: the second
  // time he sells a water heater swap, the client's proposal already explains
  // what a water heater swap consists of, and he typed nothing.
  _byoItems.push(_byoNormItem({id:nextId,section:sec,label:b.desc,qty:1,unit:b.unit||'ea',rate:b.rate,price:b.rate,notes:b.notes||'',on:true}));
  _pbLearn(b.desc,b.rate,b.unit);   // used again, so it climbs
  _byoRenderSections();_byoUpdateRail();_byoAutosave();
  // The sheet stays open on purpose: he is usually adding several.
  _byaBumpCount();
  _byaRenderBook(sec);
}
function _byaBumpCount(){
  const el=document.getElementById('_bya-count');
  if(!el)return;
  const n=(parseInt(el.dataset.n||'0',10)||0)+1;
  el.dataset.n=String(n);
  el.textContent=n+' added';
  const close=document.getElementById('_bya-close');
  if(close)close.textContent='Done';
}
function _byaConfirm(sec){
  const label=(document.getElementById('_bya-label')?.value||'').trim();
  const rate=_byaPriceValue('_bya-price');
  const qty=_byaQtyValue(),unit=_byaUnitValue();
  const notes=(document.getElementById('_bya-notes')?.value||'').trim();
  if(!label)return;
  const nextId=(_byoItems.reduce((m,x)=>Math.max(m,x.id),0))+1;
  _byoItems.push(_byoNormItem({id:nextId,section:sec,label,qty,unit,rate,price:qty*rate,notes,on:true}));
  // THE RATE, never the line total. Handing the book 12 doors' worth of money
  // and calling it the price of a door is the bug this whole change exists for.
  _pbLearn(label,rate,unit,notes);
  document.getElementById('_byo-add-modal')?.remove();
  _byoRenderSections();_byoUpdateRail();_byoAutosave();
}
function _byaConfirmAndNext(sec){
  // Save current item (if label is filled) then immediately open a fresh modal for same section
  const label=(document.getElementById('_bya-label')?.value||'').trim();
  const rate=_byaPriceValue('_bya-price');
  const qty=_byaQtyValue(),unit=_byaUnitValue();
  const notes=(document.getElementById('_bya-notes')?.value||'').trim();
  if(label){
    const nextId=(_byoItems.reduce((m,x)=>Math.max(m,x.id),0))+1;
    _byoItems.push(_byoNormItem({id:nextId,section:sec,label,qty,unit,rate,price:qty*rate,notes,on:true}));
    _pbLearn(label,rate,unit,notes);
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
    '<div class="f" style="margin-bottom:10px"><label>Title <span style="font-weight:400;color:var(--text3)">, the client sees this</span></label><input type="text" id="_bya-label" value="'+escHtml(it.label)+'" placeholder="e.g. Bedroom 3, walls only"></div>'+
    _byaQtyRateHTML(it.qty,it.unit,(Number(it.rate)>0?it.rate:it.price))+
    _byaDescFieldHTML(it.notes||'')+
    '<div style="display:flex;gap:10px">'+
      '<button onclick="document.getElementById(\'_byo-add-modal\')?.remove()" class="btn" style="flex:1">Cancel</button>'+
      '<button onclick="_byaEditConfirm('+idx+')" class="btn btn-p" style="flex:2">Save changes</button>'+
    '</div></div>';
  document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  _byaDescHint();
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
  const rate=_byaPriceValue('_bya-price');
  const qty=_byaQtyValue(),unit=_byaUnitValue();
  const notes=(document.getElementById('_bya-notes')?.value||'').trim();
  if(!label)return;
  it.label=label;it.qty=qty;it.unit=unit;it.rate=rate;it.notes=notes;
  _byoNormItem(it);
  // Editing an item is the other moment he writes the words. Teach the book
  // here too, or a description added on the second pass is lost to the next job.
  _pbLearn(label,rate,unit,notes);
  document.getElementById('_byo-add-modal')?.remove();
  _byoRenderSections();_byoUpdateRail();_byoAutosave();
}
// A copy lands directly under the original, named so he can tell them apart at
// a glance and so two rows reading exactly the same thing never reach a client.
// Everything else rides along: quantity, unit, rate and the description, which
// is the part that made copying worth doing.
function _byoDupItem(idx){
  const it=_byoItems[idx];if(!it||it._rrp)return;
  const base=String(it.label||'').replace(/\s*\((\d+)\)$/,'').trim();
  let n=2,name=base+' (2)';
  while(_byoItems.some(x=>String(x.label||'').trim()===name)){n++;name=base+' ('+n+')';}
  const copy=_byoNormItem(Object.assign({},JSON.parse(JSON.stringify(it)),{
    id:(_byoItems.reduce((m,x)=>Math.max(m,x.id||0),0))+1,
    label:name,on:true
  }));
  _byoItems.splice(idx+1,0,copy);
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
  const all=[..._byoSections(),..._byoCustomSections];
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
  if(_byoSections().includes(sec))return;
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
// ── Options on one job ──────────────────────────────────────────────────────
//
// Options were added for Zach's Bettis bids, and the shape they took is right:
// two GENUINELY different proposals, each its own record, its own scope, its
// own total, its own signed contract. That does not change.
//
// What was missing is the half the client lives in. He got two separate
// documents and two links and was left to compare them himself, when every
// HVAC and roofing tool ships options on ONE document because that is what
// moves the conversation from "yes or no" to "which one".
//
// So the bids stay separate and gain a shared group id. The proposal prints
// the whole group with its prices, whichever option the client opened, and
// signing one retires the others. Nothing about the Bettis flow moves.
// The client's own link to one option's document. One builder, used by the
// options list on the proposal AND by the difference block, so wherever a
// sibling option is named the client can actually get to it.
function _geiSignUrlFor(x){
  const base=(typeof _clientBaseUrl==='function')?_clientBaseUrl():'';
  const uid=(typeof _supaUser!=='undefined'&&_supaUser)?_supaUser.id:'';
  return (x&&x.signingToken&&base)?(base+'sign.html?t='+encodeURIComponent(x.signingToken)+'&u='+encodeURIComponent(uid)+'&b='+x.id):'';
}
function _optionGroupOf(b){return b?(b.optionGroup||null):null;}
// Every proposal in one group, oldest first, so A stays A.
function _optionSiblings(b){
  const g=_optionGroupOf(b);
  if(!g||typeof bids==='undefined')return [];
  return bids.filter(x=>x&&x.optionGroup===g&&!x.cancelledAt)
    .sort((x,y)=>String(x.optionLabel||'').localeCompare(String(y.optionLabel||''))||(x.id-y.id));
}
// A, B, C… The next free letter in the group, so a third option is not "B" again.
function _optionNextLabel(sibs){
  const used=new Set((sibs||[]).map(x=>String(x.optionLabel||'').toUpperCase()));
  for(let i=0;i<26;i++){const L=String.fromCharCode(65+i);if(!used.has(L))return L;}
  return 'X';
}
// One option signed means the rest were not chosen. lostReason is the field the
// contractor's own "Mark Lost" already writes, so these land in the Declined
// tab and the dashboard with no new UI anywhere.
function _optionRetireSiblings(wonBid){
  const sibs=_optionSiblings(wonBid);
  if(sibs.length<2)return false;
  let changed=false;
  sibs.forEach(x=>{
    if(x.id===wonBid.id)return;
    if(x.status==='Closed Won'||x.status==='Closed Lost')return;
    x.status='Closed Lost';x.draft=false;
    x.lostReason='Client chose Option '+(wonBid.optionLabel||'another');
    x.lostAt=wonBid.signedAt||new Date().toISOString();
    changed=true;
  });
  return changed;
}

function _byoDuplicateBid(){
  if(!_geiEditBidId){showToast('Save your draft first, then duplicate','⚠️');return;}
  saveGenericEstimate(true);
  const src=bids.find(x=>x.id===_geiEditBidId);
  if(!src){showToast('Proposal not found','⚠️');return;}
  // Label the original "Option A" so both show distinct names in the bid list.
  // Option A/B is a CHOSEN name, not the auto one, so both sides are marked
  // descUserSet: the auto name must never write over it, and the client's
  // proposal must print it (the whole point of options is that the client can
  // tell them apart).
  const baseName=(src.type||'Custom Proposal').replace(/[,\s-]*Option\s+[A-Z]$/i,'').trim();
  // The group is the FIRST option's own id: stable, already unique, and it
  // needs no new id space or migration.
  if(!src.optionGroup){src.optionGroup=src.id;src.optionLabel='A';}
  if(!/option [a-z]$/i.test(src.type||'')){
    src.type=baseName+', Option A';
    src.geiDesc=src.type;
    src.descUserSet=true;
    _geiDescUserSet=true;
    const descEl=document.getElementById('gei-desc');
    if(descEl)descEl.value=src.type;
    const titleEl=document.getElementById('byo-tbar-title');
    if(titleEl)titleEl.textContent=src.type;
  }
  const copy=JSON.parse(JSON.stringify(src));
  copy.id=_newBidId();
  copy.optionGroup=src.optionGroup;
  copy.optionLabel=_optionNextLabel(_optionSiblings(src).concat([src]));
  copy.type=baseName+', Option '+copy.optionLabel;
  copy.geiDesc=copy.type;
  copy.descUserSet=true;
  copy.status='Draft';copy.draft=true;
  copy.signingToken=undefined;copy.proposalKey=undefined;copy.proposalSentDate=undefined;
  bids.unshift(copy);saveAll();
  // Open the COPY. _byoShowPage takes no arguments and reads _geiEditBidId, so
  // the old call here was a no-op that left the editor on Option A while the
  // toast said "edit Option B now": every change he made after tapping the
  // button landed on the wrong document. openGenericEstimate is the one path
  // that actually switches which bid is open.
  const _dupC=(typeof clients!=='undefined')?clients.find(x=>x&&x.id===copy.client_id):null;
  openGenericEstimate(_dupC||{id:copy.client_id,name:copy.client_name||copy.name||''},copy.id,copy.trade_type||_geiTrade,{mode:'byo'});
  showToast('Duplicated: edit Option '+copy.optionLabel+' now','📋');
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
// ─── Presentation mode ───────────────────────────────────────────────────────
// The tablet on the kitchen table. Owner 2026-09-07: "so smart like Jarvis and
// easy to get done it can be presented on at the home."
//
// Every part of that already existed and was pointed the wrong way. The preview
// overlay is captioned "how they'll see it" and framed for HIM. The options only
// appear together on a document the client has to be emailed first. "Sign in
// person" is a button he has to reach past the client's shoulder to find. So
// this adds no new document, no new signing path and no new record: it is the
// same proposal HTML (sendGenericProposal), the same option group
// (_optionOffered) and the same signature sheet (_geiSignInPerson), arranged
// for a screen he turns around and hands across the table.
//
// Which one is a real offer is decided in ONE place, here, and the client's
// document (_optionsSection) reads the same function. A half-written draft is
// not an offer and must never carry a price into a client's hands, on paper or
// on the tablet, and the two can never disagree about it.
function _optionOffered(cur){
  const sibs=(typeof _optionSiblings==='function')?_optionSiblings(cur):[];
  return sibs.filter(x=>(cur&&x.id===cur.id)||x.proposalSentDate||x.signingToken||x.status==='Pending'||x.status==='Closed Won');
}
// The options to put in front of the client: the group if there is one, else
// just the proposal that is open.
function _presentList(){
  const cur=(typeof bids!=='undefined'&&typeof _geiEditBidId!=='undefined'&&_geiEditBidId)?bids.find(x=>x.id===_geiEditBidId):null;
  if(!cur)return [];
  const off=_optionOffered(cur);
  return off.length?off:[cur];
}
// HE marks the recommendation. Nothing is badged until he taps the star.
// Auto-badging the middle option by price is the textbook anchor and it was
// deliberately not built: it puts a recommendation in the contractor's mouth
// that he never made, in front of the client, on his own letterhead.
function _presentRecId(list){
  const m=(list||[]).find(x=>x&&x.optionRecommended);
  return m?m.id:null;
}
function _presentSetRec(bidId){
  const list=_presentList();
  if(!list.length)return;
  const already=list.some(x=>x&&x.optionRecommended&&String(x.id)===String(bidId));
  list.forEach(x=>{x.optionRecommended=(!already&&String(x.id)===String(bidId));});
  try{if(typeof saveAll==='function')saveAll();}catch(_e){}
  _presentChooser(_presentList());
}
function _presentClose(){
  const ov=document.getElementById('_gei-present-ov');
  if(ov)ov.remove();
}
// One shell for both screens. Two overlays stacked is how a "Back to options"
// ends up behind the document it was supposed to replace.
function _presentShell(inner){
  let ov=document.getElementById('_gei-present-ov');
  if(!ov){
    ov=document.createElement('div');
    ov.id='_gei-present-ov';
    ov.style.cssText='position:fixed;inset:0;z-index:9650;background:#1B1612;display:flex;flex-direction:column;animation:td-pg-enter .2s cubic-bezier(.22,1,.36,1) both';
    document.body.appendChild(ov);
  }
  ov.innerHTML=inner;
  return ov;
}
function _presentHdr(sub){
  const biz=(typeof S!=='undefined'&&S.bname)||(typeof getBusinessName==='function'?getBusinessName():'')||'';
  return '<div style="flex-shrink:0;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px;border-bottom:1px solid rgba(245,239,226,.10);box-sizing:border-box">'+
    '<div style="min-width:0"><div style="font-size:15px;font-weight:800;color:#F5EFE2;letter-spacing:.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml(biz)+'</div>'+
      (sub?'<div style="font-size:11.5px;color:rgba(245,239,226,.62);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml(sub)+'</div>':'')+
    '</div>'+
    '<button id="present-exit" onclick="_presentClose()" aria-label="Exit presentation" style="flex-shrink:0;background:rgba(245,239,226,.10);border:none;color:rgba(245,239,226,.75);width:34px;height:34px;border-radius:9px;font-size:18px;line-height:1;cursor:pointer;font-family:inherit;touch-action:manipulation">×</button>'+
  '</div>';
}
function _presentName(b){
  if(!b)return 'Proposal';
  return b.optionLabel?('Option '+b.optionLabel):(String(b.type||'Proposal').trim()||'Proposal');
}
function _presentMoney(n){return '$'+(Number(n)||0).toLocaleString('en-US',{maximumFractionDigits:0});}
// Entry point. Save first: from here on the client is reading it, and a number
// on screen that is not the number on the record is the one mistake this whole
// mode exists to avoid.
async function _geiPresent(){
  try{if(typeof saveGenericEstimate==='function')saveGenericEstimate(true);}catch(_e){}
  const list=_presentList();
  if(!list.length){showToast('Save your proposal first','⚠️');return;}
  if(list.length===1){return _presentOpen(list[0].id);}
  _presentChooser(list);
}
// The lines on an option RIGHT NOW. For the one he has open that means the
// editor, not the record: he may have changed it thirty seconds ago and the
// client is about to read it.
function _presentLines(b,cur){
  if(cur&&b&&b.id===cur.id){
    const live=[];
    if(typeof _byoItems!=='undefined'&&Array.isArray(_byoItems))_byoItems.forEach(it=>{
      if(it&&it.on!==false&&!it._rrp&&it.label)live.push({label:String(it.label).trim(),unit:it.unit||'',rate:Number(it.rate)||0,notes:it.notes||''});
    });
    if(!live.length&&typeof _geiLines!=='undefined'&&Array.isArray(_geiLines))_geiLines.forEach(l=>{
      if(l&&!l._tmLabor&&!l._rrp&&l.desc)live.push({label:String(l.desc).trim(),unit:l.unit||'',rate:Number(l.rate)||0,notes:l.notes||''});
    });
    if(live.length)return live;
  }
  return _pkgBidLines(b);
}
// Said once, not three times. Three cards that each repeat "tear off, haul
// away, ice and water shield" make the client read the same paragraph three
// times to find the two lines that actually differ, and the two lines that
// differ ARE the decision. Pull the common work up into one rail and every
// card underneath is nothing but its own answer.
function _presentShared(list,cur){
  if(!list||list.length<2)return [];
  const sets=list.map(b=>{
    const m=new Map();
    _presentLines(b,cur).forEach(l=>{const k=_pbKey(l.label);if(k&&!m.has(k))m.set(k,l);});
    return m;
  });
  const out=[];
  sets[0].forEach((l,k)=>{if(sets.every(m=>m.has(k)))out.push(l);});
  return out;
}
function _presentUnique(b,list,cur){
  const shared=new Set(_presentShared(list,cur).map(l=>_pbKey(l.label)));
  const seen=new Set();
  return _presentLines(b,cur).filter(l=>{
    const k=_pbKey(l.label);
    if(!k||shared.has(k)||seen.has(k))return false;
    seen.add(k);return true;
  });
}
// The deposit is what he actually has to pay today, and it is the number that
// decides whether "yes" happens now or "let me talk to my wife" happens now.
function _presentDeposit(b,me,total){
  if(me){
    const pct=(typeof _geiDepositPct==='function')?_geiDepositPct():0;
    return pct>0?Math.round(total*pct/100*100)/100:0;
  }
  return Number(b&&b.deposit)||0;
}
function _presentCount(n){return ['','One','Two','Three','Four','Five','Six'][n]||'Your';}
function _presentChooser(list){
  const cur=(typeof bids!=='undefined'&&typeof _geiEditBidId!=='undefined'&&_geiEditBidId)?bids.find(x=>x.id===_geiEditBidId):null;
  const recId=_presentRecId(list);
  // His brand, not our navy. This is his letterhead and the client is looking
  // at it in his truck's colours if he set one (adaBrand already clamped it so
  // it holds contrast as a background under white text).
  let accent='#1a365d';
  if(typeof S!=='undefined'&&S&&S.brandColor){
    const bh=(typeof adaBrand==='function'?adaBrand(S.brandColor):S.brandColor).replace('#','');
    if(/^[0-9a-f]{6}$/i.test(bh))accent='#'+bh;
  }
  const shared=_presentShared(list,cur);
  const warranty=(typeof S!=='undefined'&&S&&S.warrantyPeriod)?String(S.warrantyPeriod):'';
  const cards=list.map(b=>{
    const me=!!(cur&&b.id===cur.id);
    const amt=me&&typeof calcGeiTotal==='function'?(calcGeiTotal().total||0):(Number(b.amount)||0);
    const dep=_presentDeposit(b,me,amt);
    const rec=!!(recId&&String(b.id)===String(recId));
    const head=String(b.type||'').replace(/[,\s-]*Option\s+[A-Z]$/i,'').trim();
    const uniq=_presentUnique(b,list,cur);
    const rows=uniq.slice(0,6).map(l=>
      '<li style="font-size:13px;line-height:1.55;color:#2C2620;margin-bottom:5px;overflow-wrap:anywhere">'+escHtml(l.label)+'</li>').join('');
    const more=Math.max(0,uniq.length-6);
    const star=svgIcon('★',{size:16,color:rec?accent:'#C9C2B6'});
    const idAttr=escHtml(JSON.stringify(String(b.id)));
    return '<div style="position:relative;display:flex;flex-direction:column;min-width:0;background:#fff;border-radius:4px;'+
        'border:1px solid '+(rec?accent:'#DED7CA')+';'+(rec?'box-shadow:0 10px 34px rgba(0,0,0,.30)':'box-shadow:0 3px 14px rgba(0,0,0,.18)')+';overflow:hidden">'+
      // Reserved on every card, filled on one. Rendered only where it applies,
      // the badged card's price sat lower than the others and the column of
      // numbers the client is comparing stopped lining up.
      '<div style="height:24px;flex-shrink:0;background:'+(rec?accent:'transparent')+';color:#fff;font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:.14em;padding:0 14px;display:flex;align-items:center">'+(rec?'Our recommendation':'')+'</div>'+
      '<button onclick="_presentSetRec('+idAttr+')" aria-label="Mark as our recommendation" style="position:absolute;top:33px;right:11px;background:none;border:none;padding:4px;cursor:pointer;line-height:1;font-family:inherit;touch-action:manipulation">'+star+'</button>'+
      '<div style="padding:14px 16px 0">'+
        '<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.16em;color:#8C8375">'+escHtml(_presentName(b))+'</div>'+
        '<div style="font-size:15px;font-weight:700;color:#1B1612;line-height:1.3;margin-top:4px;min-height:2.6em;padding-right:24px;overflow-wrap:anywhere">'+escHtml(head||'')+'</div>'+
        // tabular-nums is load-bearing: three prices in a row with proportional
        // digits do not line up at their commas and the comparison reads sloppy.
        '<div style="font-size:38px;font-weight:800;color:#1B1612;letter-spacing:-1.5px;line-height:1;margin-top:10px;font-variant-numeric:tabular-nums">'+_presentMoney(amt)+'</div>'+
        (dep>0?'<div style="font-size:11.5px;color:#6B6355;margin-top:6px;font-variant-numeric:tabular-nums">'+_presentMoney(dep)+' to get started</div>':'')+
      '</div>'+
      (rows
        ?'<div style="padding:14px 16px 0"><div style="font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:.14em;color:'+accent+';margin-bottom:8px">'+(list.length>1&&shared.length?'What this adds':'Includes')+'</div>'+
          '<ul style="margin:0;padding-left:17px">'+rows+'</ul>'+
          (more?'<div style="font-size:11.5px;color:#8C8375;margin-top:2px">and '+more+' more</div>':'')+
        '</div>'
        :(shared.length?'<div style="padding:14px 16px 0;font-size:12.5px;color:#8C8375;line-height:1.5">The work listed above, nothing added.</div>':''))+
      '<div style="padding:16px;margin-top:auto">'+
        '<button onclick="_presentOpen('+idAttr+')" style="width:100%;padding:14px;border-radius:3px;border:1px solid '+accent+';background:'+(rec?accent:'#fff')+';color:'+(rec?'#fff':accent)+';font-size:15px;font-weight:800;letter-spacing:.01em;cursor:pointer;font-family:inherit;touch-action:manipulation">See the details</button>'+
      '</div>'+
    '</div>';
  }).join('');
  const sharedRail=(shared.length||warranty)
    ?'<div style="border:1px solid rgba(245,239,226,.14);border-radius:4px;padding:14px 16px;margin-bottom:18px;background:rgba(245,239,226,.04)">'+
      '<div style="font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:.16em;color:rgba(245,239,226,.55);margin-bottom:'+(shared.length?'9px':'0')+'">Every option includes</div>'+
      // The separator TRAILS its item, it never leads the next one. Leading it,
      // a wrap on a phone put a stray slash at the start of every line.
      (shared.length?'<div style="display:flex;flex-wrap:wrap;gap:4px 0">'+shared.slice(0,10).map((l,i,a)=>
        '<span style="font-size:13px;color:#F5EFE2;line-height:1.55;white-space:nowrap">'+escHtml(l.label)+(i<a.length-1?'<span style="color:rgba(245,239,226,.30);padding:0 9px">/</span>':'')+'</span>').join('')+'</div>':'')+
      (warranty?'<div style="font-size:12px;color:rgba(245,239,226,.62);margin-top:'+(shared.length?'10px':'6px')+';padding-top:'+(shared.length?'10px':'0')+';'+(shared.length?'border-top:1px solid rgba(245,239,226,.10)':'')+'">'+escHtml(warranty)+' workmanship warranty, in writing, on every option.</div>':'')+
    '</div>'
    :'';
  _presentShell(
    _presentHdr('Prepared for '+((cur&&(cur.client_name||cur.name))||'you'))+
    // margin:auto inside a flex column centres the block when the screen has
    // room and still scrolls when it does not, which justify-content cannot do
    // without clipping the top of a tall list.
    '<div style="flex:1;overflow-y:auto;padding:22px 16px 30px;box-sizing:border-box;display:flex;flex-direction:column">'+
      '<div style="max-width:1060px;width:100%;margin:auto">'+
        '<div style="margin-bottom:18px">'+
          '<div style="font-size:24px;font-weight:800;color:#F5EFE2;letter-spacing:-.4px">'+_presentCount(list.length)+' ways to do this job</div>'+
          '<div style="font-size:13px;color:rgba(245,239,226,.62);margin-top:5px">Same crew, same warranty. The difference is below. Tap one to read it in full and sign it right here.</div>'+
        '</div>'+
        sharedRail+
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(248px,1fr));gap:14px;align-items:stretch">'+cards+'</div>'+
      '</div>'+
    '</div>'
  );
}
// The document, full screen, with the signature one tap away. Switching to a
// sibling goes through openGenericEstimate, the same path every resume button
// uses: the editor really is on that bid, so the total, the terms and the
// signature all belong to the option on screen.
async function _presentOpen(bidId){
  const cur=(typeof bids!=='undefined'&&typeof _geiEditBidId!=='undefined'&&_geiEditBidId)?bids.find(x=>x.id===_geiEditBidId):null;
  if(!cur||String(bidId)!==String(cur.id)){
    const b=(typeof bids!=='undefined')?bids.find(x=>String(x.id)===String(bidId)):null;
    if(!b){showToast('Option not found','⚠️');return;}
    try{if(typeof saveGenericEstimate==='function')saveGenericEstimate(true);}catch(_e){}
    const c=(typeof getClientById==='function')?getClientById(b.client_id):null;
    openGenericEstimate(c||{id:b.client_id,name:b.client_name||b.name||''},b.id,b.trade_type||'general');
  }
  let html='';
  // sendGenericProposal is async: awaited, or the client is handed a tablet
  // showing "[object Promise]" where the contract should be.
  try{html=(typeof sendGenericProposal==='function')?(await sendGenericProposal(true,{silent:true})||''):'';}catch(_e){html='';}
  if(!html){showToast('Add items to this proposal first','⚠️');return;}
  const open=(typeof bids!=='undefined'&&typeof _geiEditBidId!=='undefined'&&_geiEditBidId)?bids.find(x=>x.id===_geiEditBidId):null;
  const multi=_presentList().length>1;
  _presentShell(
    _presentHdr(multi?('Reading '+_presentName(open)):'')+
    '<div style="flex:1;overflow-y:auto;padding:18px 16px;box-sizing:border-box;background:#EFEBE3;overflow-wrap:anywhere;display:flex;flex-direction:column"><div style="max-width:760px;width:100%;margin:auto">'+html+'</div></div>'+
    '<div style="flex-shrink:0;display:flex;gap:10px;padding:12px 16px;padding-bottom:calc(12px + env(safe-area-inset-bottom,0px));border-top:1px solid rgba(245,239,226,.10);box-sizing:border-box">'+
      // ALWAYS a way out down here, not just when there are options behind it.
      // Owner 2026-09-07: on a phone with one option there was no back button.
      // The header × is a 34px target in the far corner, and the only thing
      // under his thumb was Approve & sign, on the screen where a mis-tap
      // signs a contract. When nothing is behind it the button closes instead
      // of going back, because Back with nowhere to go is its own trap.
      '<button id="present-back" onclick="'+(multi?'_geiPresent()':'_presentClose()')+'" style="flex:0 0 auto;padding:14px 18px;border-radius:3px;border:1px solid rgba(245,239,226,.26);background:none;color:rgba(245,239,226,.85);font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;touch-action:manipulation">'+(multi?'Back':'Close')+'</button>'+
      '<button id="present-sign" onclick="_presentSign()" style="flex:1;min-width:0;padding:14px;border-radius:3px;border:none;background:#0E6B39;color:#fff;font-size:16px;font-weight:800;cursor:pointer;font-family:inherit;touch-action:manipulation">'+svgIcon('✍',{size:16,color:'#fff'})+' Approve &amp; sign</button>'+
    '</div>'
  );
}
// The signature sheet is z-index 9700, deliberately above this overlay: a
// client who backs out of signing lands back on the proposal, not in the
// contractor's editor.
function _presentSign(){
  if(typeof _geiSignInPerson==='function')_geiSignInPerson();
}
// ─── Comparison proposal picker ─────────────────────────────────────────────
// Show a picker so the contractor can send two side-by-side options to a client.
// The picker lets the contractor preview the comparison before sending.
function _openComparisonPicker(){
  if(!_geiClientId){showToast('Open from a client to compare proposals','ℹ️');return;}
  const clientBids=bids.filter(x=>(x.client_id===_geiClientId)&&(x.isFreeForm||x.geiLines));
  if(clientBids.length<2){showToast('You need at least 2 saved proposals for this client to compare','ℹ️');return;}
  document.getElementById('_cmp-picker-ov')?.remove();
  const ov=document.createElement('div');
  ov.id='_cmp-picker-ov';
  ov.style.cssText='position:fixed;inset:0;z-index:9600;background:#0009;display:flex;align-items:flex-end;justify-content:center';
  const box=document.createElement('div');
  box.style.cssText='background:#fff;border-radius:18px 18px 0 0;width:100%;max-width:520px;padding:20px 16px 32px;box-sizing:border-box;max-height:80vh;overflow-y:auto';
  const rows=clientBids.map((b,i)=>{
    const total=b.amount||0;
    const label=b.type||('Proposal '+(i+1));
    return `<label style="display:flex;align-items:center;gap:12px;padding:12px;border:1.5px solid var(--border2);border-radius:10px;margin-bottom:8px;cursor:pointer"><input type="checkbox" name="cmp-bid" value="${b.id}" style="width:20px;height:20px;accent-color:var(--blue);flex-shrink:0"><span style="flex:1"><span style="font-size:14px;font-weight:700;display:block">${escHtml(label)}</span><span style="font-size:12px;color:var(--text-3)">$${total.toLocaleString()} · ${b.status||'Draft'}</span></span></label>`;
  }).join('');
  box.innerHTML=`<div style="font-size:17px;font-weight:800;margin-bottom:4px">${svgIcon('📊',{size:17})} Compare & Send</div><div style="font-size:13px;color:var(--text-3);margin-bottom:16px">Pick exactly 2 proposals, your client will see both side by side and can choose one.</div>${rows}<button onclick="_buildComparisonPreview()" style="width:100%;padding:14px;border-radius:var(--rl);border:none;background:var(--blue);color:#fff;font-size:16px;font-weight:700;cursor:pointer;font-family:inherit;touch-action:manipulation;margin-top:8px">${svgIcon('👁',{size:16,color:'#fff'})} Preview comparison</button><button onclick="document.getElementById('_cmp-picker-ov')?.remove()" style="width:100%;padding:12px;border-radius:var(--rl);border:none;background:none;color:var(--text-3);font-size:14px;cursor:pointer;font-family:inherit;margin-top:6px">Cancel</button>`;
  ov.appendChild(box);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
}
function _buildComparisonPreview(){
  const checked=[...document.querySelectorAll('input[name="cmp-bid"]:checked')].map(x=>x.value);
  if(checked.length!==2){showToast('Select exactly 2 proposals to compare','⚠️');return;}
  const bidA=bids.find(x=>x.id===checked[0]);
  const bidB=bids.find(x=>x.id===checked[1]);
  if(!bidA||!bidB){showToast('Proposals not found','⚠️');return;}
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
  //, or none selected, means the OWNER is on the job, and his hours are now
  // costed at his own loaded rate too (_estLaborCost): counting them at zero is
  // what made the gauge flatter every solo contractor. The old code before that
  // fed the labor BILLING amount as "cost", which hid all labor profit and made
  // every T&M job read as underpriced.
  const _tmCrewCost=(typeof _estLaborCost==='function')?_estLaborCost():0;
  // Getting there is a cost too, and on a short job it can be most of it.
  const _tmDrive=(typeof _geiDriveCost==='function')?_geiDriveCost():null;
  const _tmTrueCost=Math.round(matRaw+_tmCrewCost+((_tmDrive&&_tmDrive.cost)||0));
  _geiRenderDriveLine('tm',_tmDrive);
  const _tmCostEl=document.getElementById('tm-expected-cost');
  if(_tmCostEl&&!_tmCostEl.dataset.userSet){_tmCostEl.value=_tmTrueCost>0?_tmTrueCost:'';}
  _updateMarginGauge('tm',total);
  _byoAutosave();
}
function _tmRenderMatList(){
  const el=document.getElementById('tm-mat-list');if(!el)return;
  const mats=_geiLines.map((l,i)=>({l,i})).filter(x=>!x.l._tmLabor);
  if(!mats.length){
    el.innerHTML='<div class="tm-mat-empty">No material categories yet, tap "+ Add category" to start.</div>'+_attachCardHTML();
    return;
  }
  // Same card as BYO (§7.3): a T&M job forgets the isolation valves exactly the
  // same way a fixed-price one does, and one renderer is what keeps the two
  // from drifting apart again.
  el.innerHTML=mats.map(({l,i})=>{
    const rawTotal=l.total||((l.qty||0)*(l.rate||0));
    return _geiItemRowHtml({
      label:l.desc||'Untitled',notes:l.notes||'',price:rawTotal||0,
      editFn:'_tmEditMatCat('+i+')',delFn:'_tmDelMatCat('+i+')',delTitle:'Remove category'
    });
  }).join('')+_attachCardHTML();
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
    '<div class="f" style="margin-bottom:6px"><label>Description <span style="font-weight:400;color:var(--text3)">, what it consists of</span></label><textarea id="tcm-notes" rows="3" placeholder="e.g. Sherwin-Williams Duration, two coats, tinted to the approved color" style="width:100%;box-sizing:border-box;resize:vertical;font-family:inherit">'+escHtml(l?.notes||'')+'</textarea></div>'+
    '<div style="font-size:11px;color:var(--text3);margin-bottom:14px">The client reads this on the proposal. Tab from here to save.</div>'+
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
  // Same moment BYO's modal teaches the book, so a T&M category he describes
  // once arrives already described on the next job.
  _pbLearn(name,cost,'lot',notes);
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
    (!hasLines?'<div style="text-align:center;padding:24px 0;font-size:13px;color:var(--text3)">Tap <strong>+ Add line</strong> to start building your proposal.</div>':'');
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
      '<button class="btn btn-p" onclick="_geiConfirmFreeFormAdd('+(isEdit?d._edit:-1)+')" style="margin-bottom:8px">'+(isEdit?'Update line':'Add to proposal')+'</button>'+
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

// The "Set up your services" gate is DELETED (owner 2026-09-06: "any trade
// specific branding goes out the window, everything has to be aligned to each
// of the trades", and less setup).
//
// It asked "what kind of work do you do?" 900ms after boot and again the first
// time anybody opened step 2, from a hardcoded list of TEN ELECTRICAL
// categories: Panels & Circuits, EV & Solar, Smart Home & Security. A plumber
// was asked which of those he does. Worse, GEI_BUNDLES held nothing but
// electrical job ids, so a plumber who answered it filtered his own service
// list down to zero rows and had to find the "search all" link to recover.
//
// Nothing replaces it, because the question is already asked properly: the
// onboarding service picker (js/settings.js obStepServices) offers his own
// trade's real jobs at his own prices, once, at signup. Everybody now sees
// every service their trade ships with, organised by that trade's own
// categories, and the add sheet's search covers the rest.
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

  let html='';
  if(_geiEmergency)html+=`<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:var(--r);padding:9px 12px;font-size:12px;color:#b91c1c;margin-bottom:12px;font-weight:600">${svgIcon('🚨',{size:12,color:'#b91c1c'})} Emergency mode, labor rates ×1.5 · after-hours surcharge added</div>`;
  if(_geiNewWork)html+=`<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:var(--r);padding:7px 12px;font-size:12px;color:#15803d;margin-bottom:12px;font-weight:600">${svgIcon('🏗',{size:12,color:'#15803d'})} New construction rates active, lower labor</div>`;

  // Category tile grid for trades with categories
  const cats=TRADE_JOB_CATS[trade];
  if(cats){
    const jobById=Object.fromEntries(jobs.map(j=>[j.id,j]));
    html+=`<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">`;
    for(const [catLabel,ids] of Object.entries(cats)){
      const catJobs=ids.map(id=>jobById[id]).filter(Boolean);
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
// The summary line and the controls behind it. Open once and it stays open for
// the rest of the estimate, because a man who had to correct the guess is
// probably about to correct another one.
let _geiFactsOpen=false;
function _geiToggleFacts(){
  _geiFactsOpen=!_geiFactsOpen;
  _geiSyncJobTypeButtons();
}
function _geiRenderFactsLine(){
  const txt=document.getElementById('gei-facts-text');
  const card=document.getElementById('gei-facts-card');
  const chev=document.getElementById('gei-facts-chev');
  if(txt)txt.textContent=_geiFactsLine();
  if(card)card.style.display=_geiFactsOpen?'':'none';
  if(chev)chev.textContent=_geiFactsOpen?'Done':'Change';
}

// Who it is for, where, and when: one line he reads, not three fields he fills.
// Name and address arrived from the who-is-it-for gate and the date is today,
// so the normal case is zero taps. Same reveal shape as the facts line above.
let _geiJobOpen=false;
function _geiToggleJob(){
  _geiJobOpen=!_geiJobOpen;
  _geiRenderJobLine();
}
function _geiJobLineText(){
  const v=id=>{const e=document.getElementById(id);return e?(e.value||'').trim():'';};
  const name=v('gei-client');
  const addr=v('gei-addr');
  const parts=[];
  if(name)parts.push(name);
  if(addr)parts.push(addr);
  if(!parts.length)return 'Add who this is for';
  const d=v('gei-date');
  if(d&&typeof todayKey==='function'&&d!==todayKey()&&typeof _shortDate==='function')parts.push(_shortDate(d));
  return parts.join(' \u00b7 ');
}
function _geiRenderJobLine(){
  const txt=document.getElementById('gei-job-text');
  const card=document.getElementById('gei-job-fields');
  const chev=document.getElementById('gei-job-chev');
  if(txt)txt.textContent=_geiJobLineText();
  if(card)card.style.display=_geiJobOpen?'':'none';
  if(chev)chev.textContent=_geiJobOpen?'Done':'Change';
}
// What the proposal is called, derived from the work he already described.
// Contractors do not name documents: every competitor identifies a quote by
// number + customer, and a "Name your proposal" box just makes him type the
// first line item a second time. So the name is written for him from the work
// itself and stays editable through the title-bar pencil, which is the rename
// control the screen already had.
//   one thing   -> "Water heater replacement"
//   several     -> "Water heater replacement +2 more"
//   nothing yet -> the trade's own proposal label
function _geiAutoName(){
  const labels=[];
  if(_geiIsFreeForm)(_byoItems||[]).forEach(it=>{if(it&&it.on&&!it._rrp&&it.label)labels.push(it.label);});
  (_geiScopeChips||[]).forEach(l=>{if(l&&labels.indexOf(l)<0)labels.push(l);});
  if(!_geiIsFreeForm)(_geiLines||[]).forEach(l=>{if(l&&!l._tmLabor&&l.desc&&labels.indexOf(l.desc)<0)labels.push(l.desc);});
  if(!labels.length)return _tradeProposalLabel(_geiTrade||(typeof getActiveTrade==='function'?getActiveTrade():'general'));
  const first=String(labels[0]).trim();
  return labels.length>1?first+' +'+(labels.length-1)+' more':first;
}
// The stored name, auto when he has not renamed it. #gei-desc is the carrier
// every save/send path already reads, so writing it here keeps all of them
// untouched; _geiDescUserSet marks a name he typed himself so the auto name
// never overwrites it.
let _geiDescUserSet=false;
function _geiSyncAutoName(){
  const el=document.getElementById('gei-desc');
  if(!el||_geiDescUserSet)return;
  el.value=_geiAutoName();
}
// Write the auto name and repaint the title bar showing it. No-op the moment
// he renames it by hand.
function _geiRefreshAutoTitle(prefix){
  if(_geiDescUserSet)return;
  _geiSyncAutoName();
  const el=document.getElementById(prefix+'-tbar-title');
  if(el&&!el.querySelector('input')){
    const n=document.getElementById('gei-desc')?.value||'';
    if(n)el.textContent=n;
  }
}

function _geiSyncJobTypeButtons(){
  _geiRenderFactsLine();
  if(typeof _geiRenderJobLine==='function')_geiRenderJobLine();
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
      <button class="btn btn-p" onclick="_geiConfirmFreeForm(${JSON.stringify(job).replace(/"/g,'&quot;')})" style="margin-bottom:8px">Add to proposal</button>
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

// ── The price book, which now fills itself ──────────────────────────────────
//
// It has existed for a long time and been useless for exactly as long: a
// contractor could tap "Save to price book" on a line, the row landed in
// S.priceBook[trade], and the function that read it back, _geiAddFromBook, had
// no call site anywhere in the app. He could save prices for a year and never
// once get one back.
//
// So it learns instead of being filed. Every line he deliberately adds is
// remembered with what he charged, how many times he has used it and when, and
// the ones he actually uses float to the top of the add sheet. The point is
// that after two weeks of working, his own book is the fastest thing in here,
// and he never typed a word into a settings screen to build it.
//
// Learned on a deliberate add, never on a keystroke: _byoAutosave fires on
// field handlers, so learning there would fill the book with "Repl" and "Repla".
const _PB_MAX=200;
const _PB_DRIFT=0.25;          // a quarter off is a decision, not a typo
const _PB_STOP=['the','a','an','and','or','of','to','for','with','on','in','at','new'];
function _pbTrade(){return _geiTrade||(typeof getActiveTrade==='function'?getActiveTrade():'general')||'general';}
function _pbKey(d){return String(d||'').trim().toLowerCase().replace(/\s+/g,' ');}
function _pbWords(d){return _pbKey(d).replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(w=>w&&!_PB_STOP.includes(w));}
// "Water heater replace" and "Replace water heater" are one service. Compared on
// the words that carry meaning, so word order and punctuation stop mattering.
function _pbSimilar(a,b){
  const A=new Set(_pbWords(a)),B=new Set(_pbWords(b));
  if(!A.size||!B.size)return 0;
  let hit=0;A.forEach(w=>{if(B.has(w))hit++;});
  return hit/(A.size+B.size-hit);
}
function _pbBook(trade){
  // A stored book that is not an array (a bad sync, a hand-edited settings blob)
  // must not take the add sheet down with it: the sheet is how he adds a line at
  // all, and losing it costs him the estimate, not just the suggestions.
  const raw=S.priceBook&&S.priceBook[trade||_pbTrade()];
  return Array.isArray(raw)?raw:[];
}
function _pbList(trade){
  // n===1 means seen once and NOT yet offered. This is the rule that keeps the
  // book clean without anybody maintaining it: "Bedroom 3, walls only" is typed
  // once and never comes back, so it never becomes a suggestion, while
  // "Replace 40 gal water heater" earns its place the second time he uses it.
  // ServiceTitan makes the book a project you finish before you can work. This
  // one is a byproduct of working.
  return _pbBook(trade).filter(x=>(x.n||1)>=2)
    .sort((a,b)=>((b.n||1)-(a.n||1))||String(b.last||'').localeCompare(String(a.last||'')));
}
function _pbFind(desc,trade){
  const book=_pbBook(trade);
  const key=_pbKey(desc);
  return book.find(x=>_pbKey(x.desc)===key)||book.find(x=>_pbSimilar(x.desc,desc)>=0.8)||null;
}
// THE DESCRIPTION IS THE PART THAT SELLS, AND IT WAS THE PART NOBODY TYPED.
// The book remembered a line's price, unit, count and hours, but never the
// sentence saying what the work consists of, so that sentence had to be
// retyped on every estimate forever and it simply never was: the proposal fell
// back to "Labor and materials per agreed scope", which is the vague scope line
// homeowners push back on (research 2026-09-07). Remembering it makes the
// FIRST job the only one he ever types it on.
//
// An empty description never erases a stored one. He may add a line in a hurry
// from the book and fill the words in later, and losing the good sentence
// because of a fast add would teach him not to trust the field.
function _pbLearn(desc,rate,unit,notes){
  const d=String(desc||'').trim();
  const r=Number(rate)||0;
  if(!d||d.length<3||r<=0)return;
  const _n=String(notes||'').trim();
  const trade=_pbTrade();
  if(!S.priceBook||typeof S.priceBook!=='object')S.priceBook={};
  if(!Array.isArray(S.priceBook[trade]))S.priceBook[trade]=[];
  const book=S.priceBook[trade];
  const hit=_pbFind(d,trade);
  if(hit){
    const was=Number(hit.rate)||0;
    hit.n=(hit.n||1)+1;
    hit.last=todayKey();
    hit.unit=unit||hit.unit||'ea';
    if(_n)hit.notes=_n;
    // A quarter off the stored price is either a real change or a one-off he
    // does not want remembered, and guessing wrong either freezes an old price
    // or poisons a good one. So ask, once, and only for a line he already uses.
    if(was>0&&Math.abs(r-was)/was>_PB_DRIFT&&(hit.n||0)>2){
      const _keep=was;
      if(typeof zConfirm==='function'){
        setTimeout(()=>zConfirm(
          'You charged '+(typeof fmt==='function'?fmt(r):'$'+r)+' for "'+escHtml(hit.desc)+'" this time. It was '+(typeof fmt==='function'?fmt(_keep):'$'+_keep)+'.',
          ()=>{hit.rate=r;if(typeof _settingsChanged==='function')_settingsChanged();},
          {title:'Is that your price now?',yes:'Yes, update it',no:'Just this job'}),0);
      }else{hit.rate=r;}
    }else{
      hit.rate=r;
    }
  }else{
    // n:1, remembered but not offered until he uses it again.
    book.push({desc:d,unit:unit||'ea',rate:r,n:1,last:todayKey(),...(_n?{notes:_n}:{})});
    if(book.length>_PB_MAX){
      // The one-offs go first: never used twice, oldest of those first.
      book.sort((a,b)=>((b.n||1)-(a.n||1))||String(b.last||'').localeCompare(String(a.last||'')));
      book.length=_PB_MAX;
    }
  }
  if(typeof _settingsChanged==='function')_settingsChanged();
}
function _pbLearnAll(){
  try{
    // The DESCRIPTION rides along on every save, or the smarts only reach the
    // one path whose modal happens to pass it. T&M material categories and
    // fixed-scope lines carry notes too (tcm-notes), and dropping them here
    // meant those two estimate types could never teach the book what their
    // work consists of. An empty one is still harmless: _pbLearn refuses to
    // erase a stored description with a blank.
    (_byoItems||[]).forEach(i=>_pbLearn(i.label,(Number(i.rate)>0?i.rate:i.price),i.unit,i.notes));
    // Labor lines are the crew rate, not a thing he sells, so they stay out.
    (_geiLines||[]).forEach(l=>{if(!l._tmLabor)_pbLearn(l.desc,l.rate,l.unit,l.notes);});
  }catch(_e){}
}

// How long a price-book line actually takes him, learned from the clock and
// never asked for.
//
// The profit gauge used to read hours ONLY from scope chips (_estLaborHours),
// so an estimate built the fast way, straight out of the price book, priced
// its labor at zero and showed a margin that was materials-only. A calculator
// that flatters him is worse than none (see _estLaborCost), and this is the
// same class of bug one level down.
//
// So when a job is completed, its measured hours are split across the bid's
// own lines in proportion to their price and recorded here. One job is a rough
// split; the median across jobs converges on the truth, exactly the way
// _scopeHistoryHrs already works for scope chips. Nothing is typed.
function _pbLearnHours(desc,hrs,trade){
  const h=Number(hrs)||0;
  if(!(h>0))return;
  const t=trade||_pbTrade();
  const hit=_pbFind(desc,t);
  if(!hit)return;
  if(!Array.isArray(hit.h))hit.h=[];
  hit.h.push(Math.round(h*100)/100);
  if(hit.h.length>20)hit.h=hit.h.slice(-20);
}
// Teach the price book what a finished job actually took. Called once, when a
// job is completed with real hours on it. The job knows its total measured
// hours; the bid knows which lines it was made of; the split is pro-rata by
// price because a line worth twice as much is, on average, twice the work.
// Rough at n=1, right by n=5, and it costs him nothing.
function _pbLearnFromJob(bid,hours){
  try{
    const h=Number(hours)||0;
    if(!bid||!(h>0))return false;
    const trade=bid.trade_type||'general';
    const lines=[];
    if(Array.isArray(bid.byoItems))bid.byoItems.forEach(it=>{if(it&&it.on&&!it._rrp&&it.label)lines.push({desc:it.label,price:Number(it.price)||0});});
    if(!lines.length&&Array.isArray(bid.geiLines))bid.geiLines.forEach(l=>{if(l&&!l._tmLabor&&l.desc)lines.push({desc:l.desc,price:(Number(l.qty)||1)*(Number(l.rate)||0)});});
    // Scope chips record their own measured hours through S.scopeHistory, so a
    // line repeating a REAL scope chip is skipped here rather than counted
    // twice by _estLaborHours. A chip that is not a known scope item has no
    // such home, so its line still learns.
    const _defs=[..._GEN_SCOPE,...((typeof TRADE_SCOPE_ITEMS!=='undefined'&&TRADE_SCOPE_ITEMS[trade])||[])];
    const chips=new Set((bid.scopeChips||[]).filter(l=>_defs.some(x=>x&&x.id&&x.label===l)).map(l=>_pbKey(l)));
    // A line that was CLOCKED does not need a guess. Splitting a job total
    // across it too would teach the book twice from one day's work, once
    // measured and once estimated, and the estimate would drift up.
    const priced=lines.filter(l=>l.price>0&&!chips.has(_pbKey(l.desc))&&_scopeHistoryHrs('line:'+_pbKey(l.desc))==null);
    const sum=priced.reduce((s,l)=>s+l.price,0);
    if(!priced.length||sum<=0)return false;
    priced.forEach(l=>_pbLearnHours(l.desc,h*(l.price/sum),trade));
    return true;
  }catch(_e){return false;}
}
// Median of what it took, null until it has been measured at least once.
function _pbHrs(entry){
  const vals=((entry&&entry.h)||[]).filter(v=>typeof v==='number'&&v>0).sort((a,b)=>a-b);
  if(!vals.length)return null;
  const m=Math.floor(vals.length/2);
  return vals.length%2?vals[m]:(vals[m-1]+vals[m])/2;
}
// The bid's own priced lines, one shape for BYO items and generic lines, so
// the hours math and the coverage note both read the same list.
function _estPricedLines(){
  const out=[];
  if(_geiIsFreeForm)(_byoItems||[]).forEach(it=>{if(it&&it.on&&!it._rrp&&it.label)out.push({desc:it.label,price:Number(it.price)||0});});
  else (_geiLines||[]).forEach(l=>{if(l&&!l._tmLabor&&l.desc)out.push({desc:l.desc,price:(Number(l.qty)||1)*(Number(l.rate)||0)});});
  return out;
}
// How much of this bid's labor is actually known: {known, total} line counts.
// Drives the honest note on the gauge, an unmeasured line is reported as not
// counted rather than quietly costed at zero.
function _estHoursCoverage(){
  if(_geiIsTM)return{known:1,total:1};
  const trade=_pbTrade();
  const lines=_estPricedLines();
  let known=0;
  lines.forEach(l=>{if(_pbHrs(_pbFind(l.desc,trade))!=null)known++;});
  (_geiScopeChips||[]).forEach(()=>{});
  return{known,total:lines.length};
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
  const dateStr=new Date().toLocaleDateString('en-US',{year:'numeric',month:'2-digit',day:'2-digit'});
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

// When an estimate is saved at an address the client doesn't have on file yet
// (typed into the editable address field, or added via the picker's New-address),
// roll it into the client's property list so it shows up in the Properties
// accordion, not just on the bid. Owner-reported: "subsequent properties added
// on an estimate don't roll over to the accordion."
function _geiEnsureClientProperty(clientId,addr){
  addr=(addr||'').trim();
  if(!addr)return;
  const c=(typeof getClientById==='function')?getClientById(clientId):(typeof clients!=='undefined'?clients.find(x=>x.id===clientId):null);
  if(!c)return;
  const norm=a=>(typeof _addrKey==='function')?_addrKey(a):(a||'').trim().toLowerCase();
  const key=norm(addr);
  if(!key)return;
  const existing=(typeof clientAddresses==='function')?clientAddresses(c):[{addr:c.addr}];
  if(existing.some(a=>norm(a.addr)===key))return; // already the primary or a saved extra
  c.extraAddresses=c.extraAddresses||[];
  c.extraAddresses.push({label:'Additional property',addr});
}
function saveGenericEstimate(draft){
  const v=id=>document.getElementById(id)?.value||'';
  _geiEnsureClientProperty(_geiClientId,v('gei-addr'));
  // Saving is the other deliberate moment worth learning from: it catches the
  // T&M material lines, which are edited in a grid rather than added through a
  // sheet, and any BYO line whose price was changed after it was added.
  _pbLearnAll();
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
  const _typeLabel=_geiIsTM?'Time & Materials Proposal':_geiIsFreeForm?'Custom Proposal':_tradeProposalLabel(trade);
  // Extract BYO field values before object literals, Safari fails to parse ?.?? inside spread conditionals
  const _byoTermsEl=document.getElementById('byo-custom-terms');
  const _byoTermsSave=_byoTermsEl?_byoTermsEl.value:(_byoCustomTerms||'');
  const _byoSecsSave=[..._byoCustomSections];
  if(_geiEditBidId){
    const b=bids.find(x=>x.id===_geiEditBidId);
    if(b){
      // openGenericEstimate always pre-creates an empty draft stub and sets
      // _geiEditBidId before any save happens (autosave/resume resilience), so
      // this branch, not the "new bid" one below, is what a NEW estimate's
      // first-ever save actually runs through. Capture emptiness BEFORE
      // mutating: the transition from stub to real content is the "wrote a
      // proposal" moment the "new bid" branch's lcProposalSaved can never fire.
      const _wasEmpty=_geiDraftIsEmpty(b);
      b.amount=total;b.type=v('gei-desc')||_typeLabel;b.geiDesc=v('gei-desc')||'';b.descUserSet=!!_geiDescUserSet;
      b.notes=v('gei-notes');b.geiLines=JSON.parse(JSON.stringify(_geiLines));
      b.geiTaxPct=taxPct;b.jobScope=_geiJobScope||'repair';b.salesTaxRate=parseFloat(S.salesTaxRate)||0;b.status=draft?'Draft':'Pending';b.draft=!!draft;
      b.geiDuration=v('gei-duration')||'';b.geiNewWork=_geiNewWork||false;
      b.trade_type=trade;b.deposit=_deposit;b.isFreeForm=_geiIsFreeForm||false;
      b.scopeChips=[..._geiScopeChips];
      b.scopeNoScope=_geiScopeNoScope||false;
      // The promise, stamped on the deliberate save too, not only on autosave
      // (_byoAutosave). Relying on an autosave having happened first is how a
      // bid reaches a job with nothing to measure it against.
      b.estHours=_estLaborHours();
      b.estCrew=[..._estCrew];
      b.estCrewSize=_estCrew.length||1;
      b.exclusions=[..._geiExclusions];
      if(_geiIsFreeForm&&_byoItems.length)b.byoItems=JSON.parse(JSON.stringify(_byoItems));
      if(_geiIsFreeForm){b.byoCustomSections=_byoSecsSave;b.byoCustomTerms=_byoTermsSave;}
      if(_panelSched)b.panelSched=JSON.parse(JSON.stringify(_panelSched));else delete b.panelSched;
      Object.assign(b,_tmFields);
      saveAll();
      if(_wasEmpty&&!_geiDraftIsEmpty(b)){
        try{if(typeof lcProposalSaved==='function')lcProposalSaved(b.id,b.client_id);}catch(_e){}
      }
    }
  } else {
    const newBid={
      id:_newBidId(),client_id:_geiClientId,
      client_name:v('gei-client'),name:v('gei-client'),
      phone:'',addr:v('gei-addr'),
      bid_date:v('gei-date')||todayKey(),
      amount:total,deposit:_deposit,
      type:v('gei-desc')||_typeLabel,geiDesc:v('gei-desc')||'',descUserSet:!!_geiDescUserSet,
      notes:v('gei-notes'),status:draft?'Draft':'Pending',draft:!!draft,
      isFreeForm:_geiIsFreeForm||false,
      ...(_geiScanId?{scanId:_geiScanId}:{}),
      ...(_geiIsFreeForm&&_byoItems.length?{byoItems:JSON.parse(JSON.stringify(_byoItems))}:{}),
      ...(_geiIsFreeForm?{byoCustomSections:_byoSecsSave,byoCustomTerms:_byoTermsSave}:{}),
      geiLines:JSON.parse(JSON.stringify(_geiLines)),geiTaxPct:taxPct,
      geiDuration:v('gei-duration')||'',geiNewWork:_geiNewWork||false,
      scopeChips:[..._geiScopeChips],
      scopeNoScope:_geiScopeNoScope||false,
      estHours:_estLaborHours(),estCrew:[..._estCrew],estCrewSize:_estCrew.length||1,
      exclusions:[..._geiExclusions],
      trade_type:trade,...(_panelSched?{panelSched:JSON.parse(JSON.stringify(_panelSched))}:{}),..._tmFields,
    };
    bids.unshift(newBid);_geiEditBidId=newBid.id;saveAll();
    // Proposal exists: closes the drafting clock and starts the sent/signed funnel.
    try{if(typeof lcProposalSaved==='function')lcProposalSaved(newBid.id,newBid.client_id);}catch(_e){}
  }
  // Site notes → per-property note on the CLIENT record (never the bid, so they
  // never reach the proposal). One shared save for every estimate type (T&M,
  // BYO, future). Only write when the field was actually rendered (guards
  // against a save from a screen that never showed it wiping an existing note).
  const _snEl=document.getElementById('gei-sitenote');
  if(_snEl&&_geiClientId!=null&&clients.find){const _c=clients.find(x=>String(x.id)===String(_geiClientId));if(_c){setSiteNote(_c,_geiSiteAddr(),_snEl.value.trim());saveAll();}}
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

async function sendGenericProposal(previewOnly,opts){
  saveGenericEstimate(true); // draft=true skips navigation, modal shows over estimate page
  _saveToLineHistory();
  if(!previewOnly){
    // BYO line items already define the scope; chips are optional summary only.
    // Only block if there are no chips, no line items, and the contractor hasn't explicitly skipped.
    const _hasLineItems=_geiIsFreeForm?_byoItems.some(it=>it.on):_geiLines.length>0;
    if(!_geiScopeChips.length&&!_geiScopeNoScope&&!_hasLineItems){zAlert('Add scope items or tap "None" to skip scope on this proposal.',{title:'Scope required'});return;}
    // A proposal needs a price. That is the whole list.
    //
    // It used to need a line in Materials AND a line in Interior or Exterior,
    // which meant a plumber who had typed "Replace 40 gal water heater, $1,850"
    // was refused at the send button, in painting vocabulary, after he had
    // already done the work of writing the bid. That is the worst moment in an
    // app to tell somebody no, and it made every fast path we have (the seeded
    // services, the price-book chips, a spoken estimate) end in a wall.
    if(_geiIsTM){
      // The rate and the hours ARE the bid on a time and materials job, so
      // those stay. A service call with no parts is an ordinary T&M job and is
      // no longer refused for having no materials.
      if(!_tmRatePerMan||!_tmEstHours){zAlert('Enter your hourly rate and estimated days in the Rates & crew section.',{title:'Time & labor required'});return;}
    }else if(_geiIsFreeForm){
      const _byoOn=_byoItems.filter(it=>it.on);
      if(!_byoOn.length){zAlert('Add at least one line before you send this.',{title:'Nothing to send yet'});return;}
    }
    // Build minimal proposal for sign.html
    if(!navigator.onLine){zAlert('You\'re offline, the proposal link can\'t be activated right now.\n\nYour proposal is saved. Once you\'re back online, open this proposal and tap Send to send the link to your client.',{title:'No internet connection'});return;}
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
      if(!_routed&&typeof zAlert==='function')zAlert('Couldn\'t send the proposal to the GC. Check your connection and try again.',{title:'Proposal not sent'});
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
  // The Project line is the CLIENT's header, so it only carries a name the
  // contractor actually chose. The auto name (_geiAutoName) is derived from the
  // first line item and exists so he can find the proposal in his own list,
  // printing it here would put that item's words on the document twice: once as
  // the title, once in Scope of work. Auto name -> the trade service label.
  const jobDesc=escHtml(_geiDescUserSet?v('gei-desc'):'');const duration=escHtml(v('gei-duration'));
  const _tradeM=TRADE_META[trade]||null;
  const tradeName=(_tradeM&&_tradeM.label)||'Service';
  const estNum=_geiEditBidId?String(_geiEditBidId).slice(-6):'-';
  const _geiNow=new Date();
  const dateStr=_geiNow.toLocaleDateString('en-US',{year:'numeric',month:'2-digit',day:'2-digit'});
  // The price-hold date is decided ONCE, here, and written onto the bid before
  // the document is built, so the printed date, the snapshot the client signs,
  // the portal chip and the dashboard all read the same stamp (see
  // _bidValidUntil). A preview never stamps: nothing has been promised yet.
  const _bidForValid=_geiEditBidId?bids.find(x=>x.id===_geiEditBidId):null;
  const _validUntilKey=(_bidForValid&&_bidForValid.validUntil)||addDays(todayKey(),_estValidDays());
  if(!previewOnly&&_bidForValid&&!_bidForValid.validUntil)_bidForValid.validUntil=_validUntilKey;
  const _geiExpD=_fmtValidUntil(_validUntilKey);
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
  const _hdrLabel=_geiIsTM?'Time &amp; Materials':_tradeProposalLabel(trade);
  // No standalone NTE pricing row, the cap is already disclosed in the Terms &
  // Conditions "Contract type" clause below, so this isn't a lost disclosure, just
  // one less dollar figure sitting in the pricing table.
  // Scope section, the scope-CHIP picker (with its plain-English clientDesc
  // explanations) is the one shared, cross-mode "what's included" definition, so
  // it renders whenever any chips are selected, in EVERY estimate type. BYO's
  // own line-item section list is additional structured detail specific to BYO
  // and renders alongside it, not instead of it (previously an if/else silently
  // dropped the selected scope chips whenever BYO had any line items on).
  // One exception, added 2026-09-06: a chip whose label is also a line item is
  // the SAME work written twice, and the client reads it twice in one section.
  // The line item wins (it is the priced, itemized one) and the chip is
  // dropped. Chips that say something the items do not still print.
  const _scopeBlocks=[];
  const _itemLabelKeys=new Set((_geiIsFreeForm?_byoItems.filter(it=>it&&it.on&&!it._rrp):[]).map(it=>_pbKey(it.label)));
  const _chipsToPrint=_geiScopeChips.filter(l=>!_itemLabelKeys.has(_pbKey(l)));
  if(_chipsToPrint.length&&!_geiScopeNoScope){
    const _allChipDefs=[...(TRADE_SCOPE_CHIPS[_geiTrade]||[]),...(TRADE_SCOPE_CHIPS.general||[]),..._GEN_SCOPE];
    const _listItems=_chipsToPrint.map(l=>{
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
      // The count is part of the scope, not a pricing detail: "12 doors" and
      // "1 door" are different jobs and the client should read which one they
      // agreed to. The RATE stays off the proposal, same one-price rule the
      // document already follows.
      const rows='<ol style="margin:4px 0 0;padding-left:18px">'+its.map(it=>{
        const _q=(Number(it.qty)>1)?` <span style="font-size:10.5px;color:#718096">(${escHtml(String(it.qty))}${it.unit&&it.unit!=='ea'?' '+escHtml(it.unit):''})</span>`:'';
        return `<li style="font-size:11.5px;color:#4a5568;line-height:1.7;overflow-wrap:anywhere">${escHtml(it.label)}${_q}<span style="font-size:10.5px;color:#718096">, ${escHtml(it.notes||_fallbackDesc)}</span></li>`;
      }).join('')+'</ol>';
      // Sub-section headers match the document's one header style (accent, same
      // scale as "Scope of work"): the old hardcoded gray read as a different
      // font family entirely and made the section look mismatched.
      return `<div style="margin-bottom:10px"><div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:${_pAccent};margin-bottom:2px">${escHtml(sec)}</div>${rows}</div>`;
    }).join('');
    _scopeBlocks.push(_secBlocks2);
  }
  // EVERY ESTIMATE TYPE GETS A SCOPE SECTION, not just BYO. Until now the
  // section was built from scope chips plus BYO items only, so a T&M or
  // fixed-scope proposal with no chips selected printed NO description of the
  // work at all: the client got a price table and nothing saying what they were
  // buying. The lines are already there and already carry a title and a
  // description (owner 2026-09-07: "scope of work pulls from title and the
  // description"), so they say it here in words, priced rows stay in the table
  // below where they belong.
  if(!_geiIsFreeForm&&!_geiScopeNoScope){
    const _lineScope=(_geiLines||[]).filter(l=>l&&!l._tmLabor&&!l._rrp&&String(l.desc||'').trim()
      &&!_chipsToPrint.some(c=>_pbKey(c)===_pbKey(l.desc)));
    if(_lineScope.length){
      const _rows='<ol style="margin:0 0 10px;padding-left:18px">'+_lineScope.map(l=>{
        const d=String(l.notes||'').trim();
        return `<li style="font-size:11.5px;color:#4a5568;line-height:1.7;overflow-wrap:anywhere">${escHtml(l.desc)}${d?`<span style="font-size:10.5px;color:#718096">, ${escHtml(d)}</span>`:''}</li>`;
      }).join('')+'</ol>';
      _scopeBlocks.push(_rows);
    }
  }
  // ── The other options, on this document ─────────────────────────────────
  // Whichever option the client opened, they can see the whole choice and what
  // each one costs. A price is only shown once that option has actually been
  // sent: a half-written draft is not an offer and must never reach a client.
  let _optionsSection='';
  {
    const _thisBid=_geiEditBidId?bids.find(x=>x.id===_geiEditBidId):null;
    // Same rule as the tablet (_optionOffered), one function, so the document
    // and presentation mode can never disagree about what the client is
    // choosing from.
    const _offered=(typeof _optionOffered==='function')?_optionOffered(_thisBid):[];
    if(_offered.length>1){
      // The client must be able to GET to the other one. A price with no way to
      // read what it buys is worse than not listing it: they can see there is a
      // cheaper option and cannot find out what it leaves out. Each sibling that
      // has a signing link becomes a link; the one they are reading does not.
      const _oUrl=_geiSignUrlFor;
      const _rows=_offered.map(x=>{
        const _me=_thisBid&&x.id===_thisBid.id;
        const _amt=_me?total:(Number(x.amount)||0);
        // The LABEL names the option, not the stored title. The title of the
        // one being sent has already been rewritten by the live editor (an
        // unnamed proposal auto-names itself), so reading it back here printed
        // "Custom Proposal" where the client needed to see "Option B".
        const _nm=x.optionLabel?('Option '+x.optionLabel):String(x.type||'').replace(/^.*?,\s*(Option\s+[A-Z])$/i,'$1');
        // A one-line headline of what that option IS, so the price has meaning.
        // Suppressed on the one they are reading: this whole page is its
        // description, and repeating a title above it is noise.
        const _hd=_me?'':String(x.type||'').replace(/[,\s-]*Option\s+[A-Z]$/i,'').trim();
        const _u=_me?'':_oUrl(x);
        const _inner=`<div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;width:100%">
            <div style="min-width:0">
              <div style="font-size:12px;font-weight:800;color:${_me?_pAccent:'#4a5568'}">${escHtml(_nm)}${_me?' <span style="font-weight:700;font-size:10px;color:#718096">, this one</span>':(_u?' <span style="font-weight:700;font-size:10px;color:'+_pAccent+'">, read it →</span>':'')}</div>
              ${_hd?`<div style="font-size:10.5px;color:#718096;margin-top:1px;overflow-wrap:anywhere">${escHtml(_hd)}</div>`:''}
            </div>
            <div style="font-size:14px;font-weight:800;color:#111;white-space:nowrap">${'$'+_amt.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
          </div>`;
        const _box=`display:flex;padding:9px 12px;border-radius:8px;margin-bottom:6px;background:${_me?'#EBF2FB':'#f8fafc'};border:1.5px solid ${_me?_pAccent:'#e2e8f0'}`;
        return _u
          ? `<a href="${escHtml(_u)}" target="_top" style="${_box};text-decoration:none;color:inherit">${_inner}</a>`
          : `<div style="${_box}">${_inner}</div>`;
      }).join('');
      _optionsSection=`<div style="padding:14px 18px;border-bottom:1px solid #e2e8f0;background:#fbfcfe"><div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:${_pAccent};margin-bottom:10px">Your options</div>${_rows}<div style="font-size:10.5px;color:#718096;margin-top:4px">Tap any option to read it. Sign the one you want, and the others simply close out.</div></div>`;
    }
  }

  // The boundary, on the client's copy, right after the scope. It answers the
  // question the scope raises ("is X in there?") at the moment they ask it,
  // instead of in the terms accordion where nobody looks until there is an
  // argument.
  const _exclSection=_geiExclusions.length
    ?`<div style="padding:14px 18px;border-bottom:1px solid #e2e8f0"><div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;margin-bottom:8px">Not included</div><ul style="margin:0;padding-left:18px">${_geiExclusions.map(x=>`<li style="font-size:11.5px;color:#4a5568;line-height:1.7;overflow-wrap:anywhere">${escHtml(x)}</li>`).join('')}</ul><div style="font-size:10.5px;color:#718096;margin-top:8px">If any of this turns out to be needed, it is priced and approved in a written change order before that work starts.</div></div>`
    :'';

  // ── What the other options add ──────────────────────────────────────────
  // Owner's question, 2026-09-07: on the option that does NOT replace the deck,
  // does the client see that? The scope was already right (it prints this
  // option's own lines and nothing else), but "right" was silent: the cheap
  // option read as complete, because nothing on the page said what the dearer
  // one buys. That is the whole good-better-best mechanic and it was missing
  // from the document.
  //
  // Derived, never typed: any line a sibling offer carries that this one does
  // not. He cannot forget to write it and it cannot go stale when he edits an
  // option.
  let _optDiffSection='';
  {
    const _dBid=_geiEditBidId?bids.find(x=>x.id===_geiEditBidId):null;
    const _dOff=(typeof _optionOffered==='function')?_optionOffered(_dBid):[];
    if(_dBid&&_dOff.length>1&&typeof _presentLines==='function'){
      const _mine=new Set(_presentLines(_dBid,_dBid).map(l=>_pbKey(l.label)));
      const _blocks=_dOff.map(x=>{
        if(x.id===_dBid.id)return '';
        const _extra=_pkgBidLines(x).filter(l=>l.label&&!_mine.has(_pbKey(l.label)));
        if(!_extra.length)return '';
        const _nm=x.optionLabel?('Option '+x.optionLabel):String(x.type||'the other option');
        const _amt=Number(x.amount)||0;
        const _seen=new Set();
        const _li=_extra.filter(l=>{const k=_pbKey(l.label);if(_seen.has(k))return false;_seen.add(k);return true;})
          .slice(0,6).map(l=>`<li style="font-size:11.5px;color:#4a5568;line-height:1.7;overflow-wrap:anywhere">${escHtml(l.label)}</li>`).join('');
        // The option NAME is the way into it. Telling a client what they are
        // missing and leaving them to text about it is how a proposal turns
        // into an evening of back and forth: the answer has to be a tap that
        // lands them on that option's own document, where they can sign it.
        const _u=_geiSignUrlFor(x);
        const _hd=`${escHtml(_nm)}${_amt?` <span style="font-weight:700;color:#718096">(${'$'+_amt.toLocaleString('en-US',{maximumFractionDigits:0})})</span>`:''} also includes`;
        return `<div style="margin-bottom:10px"><div style="font-size:11.5px;font-weight:800;color:${_pAccent};margin-bottom:4px">${_hd}</div><ul style="margin:0 0 6px;padding-left:18px">${_li}</ul>${_u?`<a href="${escHtml(_u)}" target="_top" style="display:inline-block;font-size:11.5px;font-weight:800;color:${_pAccent};text-decoration:none;border:1.5px solid ${_pAccent};border-radius:6px;padding:6px 12px">Switch to ${escHtml(_nm)} &rarr;</a>`:''}</div>`;
      }).filter(Boolean).join('');
      if(_blocks)_optDiffSection=`<div style="padding:14px 18px;border-bottom:1px solid #e2e8f0;background:#fbfcfe"><div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;margin-bottom:8px">Not in this option</div>${_blocks}<div style="font-size:10.5px;color:#718096">Nothing to sign twice: signing another option replaces this one.</div></div>`;
    }
  }

  const _scopeSection=_scopeBlocks.length
    ?`<div style="padding:14px 18px 6px;border-bottom:1px solid #e2e8f0;background:#f8fafc"><div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:${_pAccent};margin-bottom:10px">Scope of work</div>${_scopeBlocks.join('')}</div>`
    :'';
  const _geiEpaClient=_geiClientId?clients.find(c=>c.id===_geiClientId):null;
  // EPA RRP is a PER-PROPERTY fact: read year built + rrpDisturb for the exact
  // address this estimate is for (bid addr, else client primary), not the client
  // as a whole, so a pre-1978 rental triggers it while a new-build at the same
  // client does not. getProperty falls back to client-level for the primary.
  const _geiProp=(_geiEpaClient&&typeof getProperty==='function')?getProperty(_geiEpaClient,(typeof _geiSiteAddr==='function'?_geiSiteAddr():(_geiEpaClient.addr||''))):{};
  const _geiYearBuilt=_geiProp.yearBuilt||(_geiEpaClient?_geiEpaClient.yearBuilt||null:null);
  // EPA RRP (lead-safe) applies to pre-1978 homes where paint will be disturbed.
  // Mirrors _indEpaRequired on the industry path; this declaration was dropped in a
  // refactor while line 2677 still referenced it → ReferenceError aborting every send.
  const _geiEpaRequired=!!(_geiYearBuilt&&_geiYearBuilt<1978&&((_geiProp.rrpDisturb==='yes')||(_geiEpaClient&&_geiEpaClient.rrpDisturb==='yes')||(typeof _rrpPaintAnswer!=='undefined'&&_rrpPaintAnswer==='yes')));
  const _rrpSection='';
  // TOTAL is the one number a client should remember, sized and weighted like a
  // deliberate focal point (matches the confident-number treatment sign.html's own
  // amount display uses), not just another table row.
  const _totalFooterRows=`<tr style="background:${_pAccent};color:#fff"><td style="padding:14px 18px;font-weight:800;font-size:13px;letter-spacing:.02em">${_geiIsTM?'ESTIMATED TOTAL':'TOTAL'}</td><td style="padding:14px 18px;text-align:right;font-weight:900;font-size:21px;letter-spacing:-.3px;white-space:nowrap">${totalFmt}</td></tr>${_tmDepRow}`;
  // BYO's line items are already fully listed (name + notes) under "Scope of work"
  // above: once per-item prices came out, this table would just repeat the same
  // section headers and names a second time with nothing new to show. T&M doesn't
  // list materials anywhere else, so it keeps the full item table.
  // A scan-born proposal carries the client's own measured floor plan, the
  // thing no competitor CRM can put on paper. SVG colors carry fallbacks so
  // it renders identically in the app, sign.html, and the hub.
  const _scanPlanSection=(_geiScanId&&typeof getScans==='function')?(()=>{
    const _sc=getScans().find(x=>String(x.id)===String(_geiScanId));
    if(!_sc)return '';
    // Color-keyed to the quote (Conduit's close-rate move, research
    // 2026-08-09: showing the customer their own house sells the job): every
    // room that carries quote lines gets a tint + a legend chip with its
    // room total; rooms not in this quote stay paper-white. Lines are keyed
    // by the 'Room · surface' desc prefix the scan builder writes.
    const _pal=['#DCE8F5','#E7F0DC','#F5E9D4','#EFE0EF','#E0EFEA','#F2E3DD'];
    const _fills={},_legend=[];
    (_sc.rooms||[]).forEach((r,gi)=>{
      const rl=_geiLines.filter(l=>((l.desc||'').indexOf((r.label||'')+' · ')===0));
      if(!rl.length||!r.label)return;
      const col=_pal[_legend.length%_pal.length];
      _fills[gi]=col;
      _legend.push('<span style="display:inline-flex;align-items:center;gap:5px;font-size:10px;color:#4a5568;font-weight:700"><span style="width:10px;height:10px;border-radius:3px;background:'+col+';border:1px solid #cbd5e0"></span>'+escHtml(r.label)+' · $'+Math.round(rl.reduce((t,l)=>t+(+l.total||0),0)).toLocaleString('en-US')+'</span>');
    });
    const _sts=(typeof _scanStories==='function')?_scanStories(_sc):[1];
    const _plans=_sts.map(st=>
      (_sts.length>1?'<div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;margin:6px 0 4px">Floor '+st+'</div>':'')+
      _scanPlanSvg(_sc,{lens:'plan',story:(_sts.length>1?st:null),roomFills:_fills})).join('');
    return '<div style="padding:16px 18px;border-bottom:1px solid #e2e8f0"><div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;margin-bottom:8px">Measured floor plan · LiDAR scan</div>'+_plans+
      (_legend.length?'<div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:8px">'+_legend.join('')+'</div>':'')+'</div>';
  })():'';
  const _lineItemsSection=_geiIsFreeForm
    ?`<table style="width:100%;border-collapse:collapse"><tfoot>${_totalFooterRows}</tfoot></table>`
    :`<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:#f1f5f9;border-bottom:2px solid #e2e8f0"><th colspan="2" style="padding:8px 18px;text-align:left;font-weight:800;text-transform:uppercase;color:#64748b;font-size:9px;letter-spacing:.08em">Description</th></tr></thead><tbody>${lineRows}</tbody><tfoot>${_totalFooterRows}</tfoot></table>`;
  const proposalHtml=`<div style="background:#fff;color:#1a1a1a;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 4px 24px rgba(0,0,0,.10)"><div style="background:linear-gradient(135deg,${_pAccent} 0%,${_pAccent2} 100%);color:#fff;padding:24px 28px;display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid rgba(255,255,255,.1)">${_proposalBizHeader(_bnameRaw,_bphoneRaw,_blicRaw)}<div style="text-align:right;padding-top:4px"><div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.12em;opacity:.9;margin-bottom:8px">${_hdrLabel}</div><div style="font-size:11px;opacity:.6;margin-bottom:2px"># ${estNum}</div><div style="font-size:11px;opacity:.6">Date: ${dateStr}</div></div></div><div style="display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid #e2e8f0"><div style="padding:14px 18px;border-right:1px solid #e2e8f0"><div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;margin-bottom:6px">Customer</div><div style="font-size:14px;font-weight:700;color:${_pAccent}">${clientName}</div>${clientAddr?`<div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;margin-top:7px">Address</div><div style="font-size:12px;color:#4a5568;margin-top:1px">${clientAddr}</div>`:''}${clientPhone?`<div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;margin-top:7px">Phone</div><div style="font-size:12px;color:#4a5568;margin-top:1px">${clientPhone}</div>`:''}</div><div style="padding:14px 18px"><div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;margin-bottom:6px">Project</div><div style="font-size:13px;font-weight:600;color:${_pAccent}">${jobDesc||tradeName+' service'}</div>${duration?`<div style="font-size:11px;color:#718096;margin-top:6px">Est. duration: ${duration}</div>`:''}<div style="font-size:11px;color:#718096;margin-top:3px">Valid until: ${_geiExpD}</div></div></div>${_optionsSection}${_scopeSection}${_exclSection}${_optDiffSection}${_rrpSection}${_scanPlanSection}${_lineItemsSection}${notesHtml}${_propPanelHtml}</div>`;
  // Terms & Conditions is NOT part of the document the client reviews first,
  // it only appears in the accordion under the signature on the actual sign
  // step (owner directive 2026-07-13). The preview mirrors that: it shows
  // only the document, same as sign.html's Review step before Approve & Sign.
  // The document the client would receive, kept so the in-person sheet can put
  // the SAME one in front of them (_geiSignInPerson). Building it twice, once
  // for the screen and once for the signature, is how the two drift apart.
  window._geiLastProposalHtml=proposalHtml;
  if(previewOnly){if(!opts||!opts.silent)_showProposalPreviewOverlay(proposalHtml);return proposalHtml;}
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
    // The price-hold date travels WITH the proposal, so the portal stops
    // recomputing its own +30 from createdAt and an extended price actually
    // reads as extended on the client's screen.
    validUntil:_validUntilKey,
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
    // THIS is the real send moment: proposals.js _commitProposalSent (Text/Email
    // share) also logs proposal_sent, but that only fires if the contractor taps
    // one of those specific share options. A contractor who just copies the link
    // (or the hub URL above) never hits that path, so the milestone belongs here,
    // once=true dedupes if _commitProposalSent also fires later for the same bid.
    try{if(typeof logLifecycle==='function')logLifecycle('proposal_sent',{bidId:b.id,clientId:b.client_id});}catch(_e){}
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
    el.innerHTML='<div style="padding:14px;background:var(--bg2);border-radius:var(--r);text-align:center;font-size:12px;color:var(--text3)">Add equipment above to see the proposal</div>';
    return;
  }
  const crewLabel=r.crew===1?'Solo: you handle it':r.crew===2?'You + 1 helper needed':r.crew===3?'3-person crew needed':'Full 4-person crew';
  const crewColor=r.crew===1?'#16a34a':r.crew===2?'#2563eb':r.crew>=3?'#d97706':'#1a1a1a';
  const liftLine=r.liftNeeded?'<div style="margin-top:6px;padding:7px 10px;background:#fff7ed;border-radius:var(--r);font-size:11px;color:#c2410c;font-weight:600">'+svgIcon('⚠',{size:11,color:'#c2410c'})+' Man-lift rental likely needed (~$350/day): add as line item if not on site</div>':'';
  const scaffLine=r.flags.some(f=>f&&f.includes('Scaffolding'))?'<div style="margin-top:6px;padding:7px 10px;background:#fef9c3;border-radius:var(--r);font-size:11px;color:#854d0e;font-weight:600">'+svgIcon('🏗',{size:11,color:'#854d0e'})+' Scaffolding may be needed on one or more pieces, verify on-site</div>':'';
  el.innerHTML=
    '<div style="background:linear-gradient(135deg,#1a365d 0%,#2a4a7f 100%);border-radius:var(--r);padding:16px;color:#fff">'+
      '<div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;opacity:.7;margin-bottom:10px">Proposal Summary</div>'+
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
        '<div style="font-size:10px;opacity:.65;margin-bottom:4px">Proposal range</div>'+
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
    showToast('Industrial proposal saved','💾');
    if(document.getElementById('cdt-bids-content')?.style.display!=='none')setTimeout(()=>renderCDBids(),100);
  }
  return true;
}
async function _sendIndProposal(){
  if(!_saveIndBid(true))return; // save first, bail if no pieces
  if(!navigator.onLine){zAlert('You\'re offline, the proposal link can\'t be activated right now.\n\nYour proposal is saved. Once you\'re back online, open this proposal and tap Send to send the link to your client.',{title:'No internet connection'});return;}
  if(!supaEnabled()||!_supaUser){zAlert('Sign in to send client links.');return;}
  const r=_calcInd();
  const c=_indClient;
  const{color,primerColor,finish,colorNotes,notes}=_indReadColorFields();
  const tier=IND_TIERS[_indTier];
  const bname=escHtml(S.bname||getBusinessName()||'');
  const bphone=escHtml(S.bphone||'');const blic=escHtml(S.blic||'');
  const clientName=escHtml(c?.name||'');const clientAddr=escHtml(c?.addr||'');
  const dateStr=new Date().toLocaleDateString('en-US',{year:'numeric',month:'2-digit',day:'2-digit'});
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
  const proposalHtml=`<div style="background:#fff;color:#1a1a1a;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 4px 24px rgba(0,0,0,.10)"><div style="background:linear-gradient(135deg,#7c2d12 0%,#c2410c 100%);color:#fff;padding:20px 24px;display:flex;justify-content:space-between;align-items:flex-start"><div><div style="font-size:18px;font-weight:800">${bname}</div>${bphone?`<div style="font-size:12px;opacity:.7;margin-top:3px">${bphone}</div>`:''}${blic?`<div style="font-size:11px;opacity:.6;margin-top:2px">Lic# ${blic}</div>`:''}</div><div style="text-align:right"><div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.12em;opacity:.9">${svgIcon('🏗',{size:11,color:'#fff'})} Industrial Coating Proposal</div><div style="font-size:11px;opacity:.6;margin-top:6px"># ${estNum}</div><div style="font-size:11px;opacity:.6">Date: ${dateStr}</div></div></div><div style="display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid #e2e8f0"><div style="padding:14px 18px;border-right:1px solid #e2e8f0"><div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;margin-bottom:6px">Customer</div><div style="font-size:14px;font-weight:700;color:#7c2d12">${clientName}</div>${clientAddr?`<div style="font-size:12px;color:#4a5568;margin-top:4px">${clientAddr}</div>`:''}</div><div style="padding:14px 18px"><div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;margin-bottom:6px">Project</div><div style="font-size:13px;font-weight:600;color:#7c2d12">Industrial Equipment Coating</div><div style="font-size:11px;color:#718096;margin-top:3px">${tier.badge} ${tier.name} Specification</div><div style="font-size:11px;color:#718096;margin-top:2px">Valid 30 days from date above</div></div></div><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:#f1f5f9;border-bottom:2px solid #e2e8f0"><th style="padding:8px 14px;text-align:left;font-weight:800;text-transform:uppercase;color:#64748b;font-size:9px;letter-spacing:.08em">Equipment</th><th style="padding:8px 8px;text-align:center;font-weight:800;text-transform:uppercase;color:#64748b;font-size:9px;width:40px">Qty</th><th style="padding:8px 8px;text-align:right;font-weight:800;text-transform:uppercase;color:#64748b;font-size:9px;width:72px">~Sq Ft</th><th style="padding:8px 14px;text-align:left;font-weight:800;text-transform:uppercase;color:#64748b;font-size:9px">Notes</th></tr></thead><tbody>${equipRows}</tbody></table><div style="padding:14px 18px;border-top:1px solid #e2e8f0;background:#fafafa"><div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#7c2d12;margin-bottom:8px">Coating Specification</div><div style="font-size:12px;color:#374151;line-height:1.9"><div><strong>Prep method:</strong> ${escHtml(tier.desc)}</div><div><strong>Primer:</strong> ${escHtml(resolvedPrimer)}</div><div><strong>Topcoat:</strong> ${escHtml(resolvedTopcoat)}</div><div><strong>Finish:</strong> ${escHtml(finish)}</div>${colorNotes?`<div><strong>Color notes:</strong> ${escHtml(colorNotes)}</div>`:''}</div></div><div style="display:grid;grid-template-columns:1fr 1fr 1fr;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0"><div style="padding:12px 14px;border-right:1px solid #e2e8f0"><div style="font-size:10px;color:#94a3b8;margin-bottom:3px">Surface Area</div><div style="font-size:16px;font-weight:800;color:#374151">${r.totalSqft.toLocaleString()} sqft</div></div><div style="padding:12px 14px;border-right:1px solid #e2e8f0"><div style="font-size:10px;color:#94a3b8;margin-bottom:3px">Duration</div><div style="font-size:16px;font-weight:800;color:#374151">${r.calDays}–${r.calDays+1} days</div></div><div style="padding:12px 14px"><div style="font-size:10px;color:#94a3b8;margin-bottom:3px">Crew</div><div style="font-size:16px;font-weight:800;color:#374151">${crewLabel}</div></div></div>${liftWarning}<table style="width:100%;border-collapse:collapse"><tr style="background:#7c2d12;color:#fff"><td style="padding:12px 18px;font-weight:800;font-size:13px">ESTIMATE RANGE</td><td style="padding:12px 18px;text-align:right;font-weight:800;font-size:14px">${rangeStr}</td></tr><tr style="background:#c2410c;color:rgba(255,255,255,.88)"><td style="padding:7px 18px;font-size:12px;font-weight:800">MIDPOINT PROPOSAL</td><td style="padding:7px 18px;text-align:right;font-size:13px;font-weight:800">${totalFmt}</td></tr><tr style="background:#9a3412;color:rgba(255,255,255,.85)"><td style="padding:6px 18px;font-size:11px;font-weight:600">25% Deposit Due Before Work Begins</td><td style="padding:6px 18px;text-align:right;font-size:12px;font-weight:700">${depositFmt}</td></tr></table>${notesSection}<div style="padding:18px 24px;border-top:2px solid #e2e8f0;background:#f8fafc"><div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#7c2d12;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #e2e8f0">Terms &amp; Conditions</div><div style="font-size:11px;color:#2d3748;line-height:2"><div>1. <strong>Deposit:</strong> 25% due before work begins.</div><div>2. <strong>Balance:</strong> Remainder due upon completion.</div><div>3. <strong>Warranty:</strong> All workmanship warranted for 1 year.</div></div></div></div>`;
  const token=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
  const proposalKey=`proposals/${_supaUser.id}/${_indBidId}_${token}.json`;
  // Per-property EPA RRP: key year built + rrpDisturb to THIS estimate's address
  // (industrial bid addr, else client primary), so it reflects the actual site.
  const _indAddr=(typeof bids!=='undefined'&&bids.find?((bids.find(x=>x.id===_indBidId)||{}).addr):'')||(c&&c.addr)||'';
  const _indProp=(c&&typeof getProperty==='function')?getProperty(c,_indAddr):{};
  const _indYearBuilt=_indProp.yearBuilt||(c?c.yearBuilt||null:null);
  const _indEpaRequired=!!(_indYearBuilt&&_indYearBuilt<1978&&((_indProp.rrpDisturb==='yes')||(c&&c.rrpDisturb==='yes')||(typeof _rrpPaintAnswer!=='undefined'&&_rrpPaintAnswer==='yes')));
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
// The proposal document, rendered into the in-person sheet. Built by the same
// call that builds the emailed one (sendGenericProposal in silent preview mode,
// which promises nothing and stamps nothing), so there is exactly one document
// in the product. Scrolls inside its own box: the sheet is already tall and the
// signature has to stay reachable on a phone.
function _geiIpDoc(){
  try{
    if(typeof sendGenericProposal==='function')sendGenericProposal(true,{silent:true});
  }catch(_e){}
  return (typeof window!=='undefined'&&window._geiLastProposalHtml)||'';
}
function _geiIpDocHTML(){
  const doc=_geiIpDoc();
  if(!doc)return'';
  return'<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:8px">What they are signing</div>'+
    '<div id="gei-ip-doc" style="max-height:46vh;overflow-y:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--border);border-radius:var(--r);padding:8px;background:var(--bg2);margin-bottom:16px">'+doc+'</div>';
}

// ── The signature is never left on the phone ────────────────────────────────
// An in-person signature used to go to signed_proposals as a fire-and-forget
// insert inside a try/catch that console.warned and moved on. In a basement
// with no signal that is the single most important record in the business,
// silently lost, while the bid itself saved fine and looked signed.
//
// Same shape the photo queue already uses (_drainPhotoQueue, js/jobs.js): park
// the pending write ON THE BID, which syncs, survives a force-quit and drains
// on the next connection. No new storage, no new durability story.
function _geiQueueSignature(bid,row){
  if(!bid||!row)return;
  bid.sigPending=row;
  try{saveAll();}catch(_e){}
}
async function _drainSignatureQueue(){
  if(typeof supaEnabled!=='function'||!supaEnabled())return;
  if(typeof _supaUser==='undefined'||!_supaUser||!_supa)return;
  let dirty=false;
  for(const b of (typeof bids!=='undefined'?bids:[])){
    const row=b&&b.sigPending;
    if(!row)continue;
    try{
      const{data:rows}=await _supa.from('signed_proposals').select('id')
        .eq('bid_id',String(b.id)).eq('contractor_user_id',_supaUser.id).limit(1);
      if(rows&&rows[0])await _supa.from('signed_proposals').update(row).eq('id',rows[0].id);
      else await _supa.from('signed_proposals').insert(row);
      delete b.sigPending;dirty=true;
      if(b.client_id&&typeof _uploadClientHub==='function')_uploadClientHub(b.client_id).catch(()=>{});
    }catch(_e){/* still no signal: it stays queued, on the bid, for next time */}
  }
  if(dirty){try{saveAll();}catch(_e){}}
}
function _geiSignInPerson(){
  saveGenericEstimate(true);
  const bid=bids.find(x=>x.id===_geiEditBidId);
  if(!bid){showToast('Save your proposal first','⚠️');return;}
  if(!bid.client_id){showToast('Link this proposal to a client first','⚠️');return;}
  const{total}=calcGeiTotal();
  if(!total){showToast('Add items to your proposal before signing','⚠️');return;}
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
        // THE DOCUMENT THEY ARE SIGNING (owner 2026-09-06: "I want it done and
        // prepared in person, sign on the spot"). This sheet used to show a
        // total, a deposit and a signature box, so the version used face to
        // face was weaker than the one sign.html puts in front of a remote
        // client, and it was also the one most likely to be argued about
        // later. Same HTML, built once by sendGenericProposal and reused here,
        // so the in-person contract and the emailed one can never differ.
        _geiIpDocHTML()+
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
  if(!bid){showToast('Proposal not found','⚠️');return;}
  const{total}=calcGeiTotal();
  const depPct=_geiDepositPct();
  const depAmt=Math.round(total*depPct/100*100)/100;
  const ts=new Date().toISOString();
  bid.amount=total;bid.deposit=depAmt;bid.status='Closed Won';bid.draft=false;
  bid.signedAt=ts;bid.estStatus='signed';
  // Same rule the remote path applies (cloud.js _applySigStatusToBid): the
  // options he did not pick close out instead of sitting in Pending. AFTER
  // signedAt is stamped, because that is the date the others are lost on.
  _optionRetireSiblings(bid);
  // The exact document that was on screen when they signed, kept as the legal
  // record the same way the remote send keeps it (_finalizeProposalSend). An
  // in-person signature had no snapshot at all before this.
  if(!bid.proposalHtml&&typeof window!=='undefined'&&window._geiLastProposalHtml)bid.proposalHtml=window._geiLastProposalHtml;
  // MINT THE HUB TOKEN NOW, NOT WHEN THE NETWORK SAYS SO. It is random hex and
  // needs nothing but the device, yet it was only ever created inside
  // _uploadClientHub. So the client he just signed at the kitchen table, who is
  // usually brand new, had no hub link at the exact moment he tapped "Text them
  // their copy": a race when online and a flat failure when not. The token
  // exists immediately; the hub contents publish when there is signal.
  if(bid.client_id&&typeof _ensureClientToken==='function')_ensureClientToken(bid.client_id);
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
  // The presentation is over the moment it is signed. Close it here so "Back
  // to home" doesn't peel back to a stale proposal still on screen behind it.
  try{if(typeof _presentClose==='function')_presentClose();}catch(_e){}
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
      // Do the two things that are only possible WHILE HE IS STILL IN THE ROOM.
      // The deposit leads because card-in-hand right after a signature is the
      // best collection moment in the business, and this screen used to walk
      // straight past it to "Back to home".
      (depAmt>0?'<button onclick="_geiCollectDepositNow('+bid.id+')" style="width:100%;padding:14px;border-radius:var(--rl,12px);border:none;background:var(--green,#16a34a);color:#fff;font-size:16px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:8px">'+svgIcon('💳',{size:16,color:'#fff'})+' Collect '+fmt(depAmt)+' now</button>':'')+
      '<button onclick="_geiTextSignedCopy('+bid.id+')" style="width:100%;padding:13px;border-radius:var(--rl,12px);border:1px solid var(--border2);background:var(--bg2);color:var(--text);font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:8px">'+svgIcon('📱',{size:15})+' Text them their copy</button>'+
      '<button onclick="document.getElementById(\'_gei-ip-ov\').remove();goPg(\'pg-dash\');setTimeout(showScheduleAlerts,400)" style="width:100%;padding:14px;border-radius:var(--rl,12px);border:none;background:var(--blue);color:#fff;font-size:16px;font-weight:700;cursor:pointer;font-family:inherit">'+svgIcon('🏠',{size:16,color:'#fff'})+' Back to home</button>'+
    '</div>';
  }
  // QUEUE FIRST, THEN SEND. The row is parked on the bid before any network is
  // attempted, so a signature taken in a basement is on the device, in a record
  // that syncs, and drains the moment there is signal (_drainSignatureQueue).
  // This used to be a bare insert whose only failure handling was a console
  // warning, which meant no signal equalled no signature, silently.
  const _sigRow={bid_id:String(bid.id),contractor_user_id:(typeof _supaUser!=='undefined'&&_supaUser)?_supaUser.id:null,
    client_name:bid.client_name,client_signed_name:pname||typed,
    signed_at:ts,signature_data:sigData,
    payment_status:'pending',deposit:depAmt,amount:total};
  if(bid.client_id){
    _geiQueueSignature(bid,_sigRow);
    if(typeof _drainSignatureQueue==='function')_drainSignatureQueue();
  }
}
