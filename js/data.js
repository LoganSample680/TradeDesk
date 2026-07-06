// ── Submit guard — prevents double-tap on any button ─────────────────────
let _submitting=false,_allowPhoneDupe=false;
let clients=[],bids=[],jobs=[],income=[],expenses=[],mileage=[],maintenance=[],checksState={},payments=[],liens=[],events=[],timeEntries=[],photos=[],licenses=[],contracts=[],agreements=[];
// Expose all data arrays and employee record on window so Playwright E2E tests can read/write them.
// All are module-scoped `let` variables (not on window by default in non-module scripts).
Object.defineProperty(window,'bids',{get:()=>bids,set:v=>{bids=v;},configurable:true});
Object.defineProperty(window,'clients',{get:()=>clients,set:v=>{clients=v;},configurable:true});
Object.defineProperty(window,'jobs',{get:()=>jobs,set:v=>{jobs=v;},configurable:true});
Object.defineProperty(window,'payments',{get:()=>payments,set:v=>{payments=v;},configurable:true});
Object.defineProperty(window,'income',{get:()=>income,set:v=>{income=v;},configurable:true});
Object.defineProperty(window,'expenses',{get:()=>expenses,set:v=>{expenses=v;},configurable:true});
Object.defineProperty(window,'mileage',{get:()=>mileage,set:v=>{mileage=v;},configurable:true});
Object.defineProperty(window,'maintenance',{get:()=>maintenance,set:v=>{maintenance=v;},configurable:true});
Object.defineProperty(window,'liens',{get:()=>liens,set:v=>{liens=v;},configurable:true});
Object.defineProperty(window,'timeEntries',{get:()=>timeEntries,set:v=>{timeEntries=v;},configurable:true});
Object.defineProperty(window,'photos',{get:()=>photos,set:v=>{photos=v;},configurable:true});
Object.defineProperty(window,'licenses',{get:()=>licenses,set:v=>{licenses=v;},configurable:true});
Object.defineProperty(window,'contracts',{get:()=>contracts,set:v=>{contracts=v;},configurable:true});
Object.defineProperty(window,'agreements',{get:()=>agreements,set:v=>{agreements=v;},configurable:true});
// `events` is a module-scoped let; expose a getter so emitEvent (dashboard.js) can push to it.
function _tdGetEvents(){return events;}
Object.defineProperty(window,'_employeeRecord',{get:()=>_employeeRecord,set:v=>{_employeeRecord=v;},configurable:true});
function _newBidId(){return Date.now()*1000+Math.floor(Math.random()*999);}
let currentClientId=null,editClientId=null,clientFilter='all';
Object.defineProperty(window,'currentClientId',{get:()=>currentClientId,set:v=>{currentClientId=v;},configurable:true});
Object.defineProperty(window,'editClientId',{get:()=>editClientId,set:v=>{editClientId=v;},configurable:true});
let estLinkedClientId=null,editingBidId=null,lastCreatedBidId=null;
let _pendingSignToken=null; // {bidId,token,proposalKey} — committed to bid only when SMS/email is actually sent
let _pendingShareData=null; // {url,cname,bname,cphone,cemail} for the just-generated proposal link — read by _proposalShareData()
let sigCanvas,sigCtx,isSigning=false;
let trackerTab='income',cdTab='overview',trackerYear=new Date().getFullYear();
let selectedColor='#185FA5';
let schedType='estimate';
let availYear,availMonth,calYear,calMonth;
let _weatherCache=null,_weatherCacheTime=0,_weatherLoading=false;
// WMO weather code → {icon, label, rain}
function _wmoIcon(code,precip){
  if(precip>=60)return{icon:'🌧️',label:'Rain',rain:true};
  if(precip>=30)return{icon:'🌦️',label:'Showers',rain:true};
  if(code===0)return{icon:'☀️',label:'Sunny',rain:false};
  if(code<=2)return{icon:'⛅',label:'Partly cloudy',rain:false};
  if(code<=3)return{icon:'☁️',label:'Cloudy',rain:false};
  if(code<=48)return{icon:'🌫️',label:'Fog',rain:false};
  if(code<=67)return{icon:'🌧️',label:'Rain',rain:true};
  if(code<=77)return{icon:'🌨️',label:'Snow',rain:false};
  if(code<=82)return{icon:'🌧️',label:'Rain',rain:true};
  if(code<=99)return{icon:'⛈️',label:'Storm',rain:true};
  return{icon:'🌤️',label:'',rain:false};
}
async function fetchWeather(){
  const now=Date.now();
  if(_weatherCache&&now-_weatherCacheTime<1800000)return _weatherCache;
  if(_weatherLoading)return _weatherCache||{};  // cache is null until first fetch resolves — never hand back null (callers do weather[dateKey])
  _weatherLoading=true;
  try{
    if(!S.weatherLat||!S.weatherLon){console.warn('No location set — skipping weather');return{};}
    const lat=S.weatherLat,lon=S.weatherLon;
    const url='https://api.open-meteo.com/v1/forecast?latitude='+lat+'&longitude='+lon+
      '&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max'+
      '&temperature_unit=fahrenheit&timezone=America%2FChicago&forecast_days=14';
    const res=await fetch(url);
    const data=await res.json();
    const map={};
    (data.daily?.time||[]).forEach((date,i)=>{
      const code=data.daily.weathercode[i]||0;
      const precip=data.daily.precipitation_probability_max[i]||0;
      const hi=Math.round(data.daily.temperature_2m_max[i]||0);
      const lo=Math.round(data.daily.temperature_2m_min[i]||0);
      const w=_wmoIcon(code,precip);
      map[date]={...w,hi,lo,precip};
    });
    _weatherCache=map;_weatherCacheTime=now;
    return map;
  }catch(e){console.warn('Weather fetch failed:',e);return {};}
  finally{_weatherLoading=false;}
}
const now=new Date();
calYear=now.getFullYear();calMonth=now.getMonth();
availYear=now.getFullYear();availMonth=now.getMonth();

let gps={active:false,startCoords:null,endCoords:null,startTime:null,clientId:null,timerInt:null};
let _activeTimer=null; // {jobId,jobName,clientName,startTime,timerInterval}


let S={bitlyKey:'',goalMonthly:0,laborRate:45,irsRate:.725,irsRateYear:2026,bracketYear:0,taxYear:2026,fedSingle:15000,fedMFJ:30000,fedMFS:15000,fedHOH:22500,b10:11925,b12:48475,b22:103350,b24:197300,b32:250525,b35:626350,ksLow:3.1,ksTop:33000,ksHigh:5.7,ksStdS:3500,ksStdM:8000,bname:'',bphone:'',blic:'Licensed & Insured',veh:'',margin:40,cov:350,mm:15,rWalls:1.30,rCeil:1.00,rTrim:3.25,rDoor:95,rWin:50,rExt:1.10,rDeck:1.00,suppliesRate:0.25,timeOff:[],employees:[],devices:[],subcontractors:[],logoData:'',brandColor:'',bwebsite:'',subdomain:'',stateRates:{},priceBook:{},baddr:'',bcity:'',bzip:'',poweredBy:true,customTerms:'',coTerms:'',serviceStates:[],salesTaxRate:0,salesTaxRateSource:'',teamTracking:true,trackStart:'07:00',trackEnd:'18:00',geofenceFt:300,officeLat:0,officeLon:0,laborBurden:1.3,ownerPayType:'hourly',ownerPayRate:0};

// ZJ's logo — SVG recreation for proposal header (dark-background safe: white Z, gray J, slash)
// Only shown for ZJ's Painting account — other accounts see plain business name text.
// Returns logo <img> for branded accounts, plain text for others
// Priority: 1) S.logoData (user-uploaded), 2) ZJ auto-embed, 3) plain text
function _proposalBizHeader(bname,bphone,blic){
  const logoSrc=S.logoData||'';
  const logoInner=logoSrc?'<img src="'+logoSrc+'" style="height:72px;max-width:220px;object-fit:contain;display:block" alt="'+escHtml(bname)+'">':'<div style="font-size:21px;font-weight:800;line-height:1.1">'+escHtml(bname)+'</div>';
  const logoHtml='<div class="brand-logo-slot">'+logoInner+'</div>';
  return '<div>'+logoHtml+
    (bphone?'<div style="font-size:12px;margin-top:4px;opacity:.85">P '+escHtml(bphone)+'</div>':'')+
    (blic?'<div style="font-size:11px;margin-top:2px;opacity:.75">'+escHtml(blic)+'</div>':'')+
  '</div>';
}

// ── Account / User / Config global state ─────────────────────────────
let _account=null;   // accounts row
let _user=null;      // users row
let _config=null;    // account_config row
let _accountUsers=[]; // account_users rows
let _vehicles=[];    // vehicles rows
let _isEmployee=false;        // true when logged-in user belongs to another contractor
let _contractorUserId=null;   // contractor's user_id (set when _isEmployee)
let _employeeRecord=null;     // team_members row for this employee
Object.defineProperty(window,'_config',{get:()=>_config,set:v=>{_config=v;},configurable:true});
Object.defineProperty(window,'_isEmployee',{get:()=>_isEmployee,set:v=>{_isEmployee=v;},configurable:true});
// Bridge the rest of the employee-context trio so window assignment reaches the real
// module `let`s (not a dead own-property). Without this, `window._contractorUserId=…`
// silently no-ops and code reading the bare `_contractorUserId` still sees null —
// e.g. _submitEstimateRequest's `if(!_contractorUserId) return` guard. Prod sets the
// bare lets directly; only external callers (tests) assign via window, so this is
// purely additive and matches the _isEmployee bridge above.
Object.defineProperty(window,'_contractorUserId',{get:()=>_contractorUserId,set:v=>{_contractorUserId=v;},configurable:true});
Object.defineProperty(window,'_employeeRecord',{get:()=>_employeeRecord,set:v=>{_employeeRecord=v;},configurable:true});

// EFFECTIVE ACCOUNT UID — whose BUSINESS this session acts for. Every client-facing
// money/identity artifact (hub + pay + signing links' u= param, proposal snapshot
// contractorUserId, signature/view-tracking rows, storage paths) must carry THIS uid,
// never raw _supaUser.id: a crew login stamping its own uid pointed Stripe checkout
// lookups, signature notifications and hub uploads at an account that doesn't exist
// (employees have no users/account_config row) — payments from crew-sent links could
// never reach the owner. Owner → self; crew → the boss; dev-support → the target.
function _effectiveUid(){
  try{
    if(typeof _devSupportMode!=='undefined'&&_devSupportMode&&typeof _DEV_SUPPORT_USERS!=='undefined'){
      const u=Object.values(_DEV_SUPPORT_USERS).find(x=>x.name===_devSupportName)?.userId;
      if(u)return u;
    }
  }catch(_e){}
  if(typeof _isEmployee!=='undefined'&&_isEmployee&&_contractorUserId)return _contractorUserId;
  return (typeof _supaUser!=='undefined'&&_supaUser&&_supaUser.id)||null;
}

// Default configs by business type
function getRole(){return _user?.role||'owner';}
function isOwner(){return !_isEmployee&&(getRole()==='owner'||getRole()==='co-owner');}
function isEmployee(){return _isEmployee;}
function canSeeTaxes(){return isOwner();}
function isLifetimeAccount(){return !!_account?.is_lifetime;}
function getBusinessName(){return _account?.business_name||S.bname||'TradeDesk';}
function getUserName(){const n=_user?.name||'';return n.includes('@')?'':n;}
function getOwnerName(){
  // Check localStorage first (device-specific, fast)
  if(_supaUser?.id){
    const stored=localStorage.getItem('zp3_uname_'+_supaUser.id);
    if(stored&&!stored.includes('@'))return stored;
  }
  // Fall back to S.ownerName (synced from Supabase on other devices)
  if(S.ownerName&&!S.ownerName.includes('@'))return S.ownerName;
  const n=_user?.name||'';
  return n.includes('@')?'':n;
}
function setOwnerName(name){
  // Silently reject email addresses stored as names (data corruption guard)
  const safe=name&&!name.includes('@')?name:'';
  if(_supaUser?.id){
    if(safe)localStorage.setItem('zp3_uname_'+_supaUser.id,safe);
    else localStorage.removeItem('zp3_uname_'+_supaUser.id);
  }
  if(_user)_user.name=safe;
  if(S.ownerName!==safe){S.ownerName=safe;S.settingsTs=Date.now();}
}
let FED_BRACKETS={single:[],mfj:[],mfs:[],hoh:[]};
let STD_DED={single:14600,mfj:29200,mfs:14600,hoh:21900};
let KS_BRACKETS={single:[],mfj:[],mfs:[],hoh:[]};
let KS_STD={single:3500,mfj:8000,mfs:4000,hoh:6000};
// IRS published values — 7-year rolling history for historical tax reports
function _getBracketsForYear(yr){
  const n=parseInt(yr);
  const thisYear=new Date().getFullYear();
  if(n===thisYear)return{fedSingle:S.fedSingle||15000,fedMFJ:S.fedMFJ||30000,fedMFS:S.fedMFS||15000,fedHOH:S.fedHOH||22500,b10:S.b10||11925,b12:S.b12||48475,b22:S.b22||103350,b24:S.b24||197300,b32:S.b32||250525,b35:S.b35||626350,irsRate:S.irsRate||.725};
  return TAX_HISTORY[n]||TAX_HISTORY[2025];
}
function _getFedBracketsForYear(yr){
  const b=_getBracketsForYear(yr);
  const mfjBkts=[[b.b10*2,.10],[b.b12*2,.12],[b.b22*2,.22],[b.b24*2,.24],[b.b32*2,.32],[b.b35*2,.35],[Infinity,.37]];
  return{single:[[b.b10,.10],[b.b12,.12],[b.b22,.22],[b.b24,.24],[b.b32,.32],[b.b35,.35],[Infinity,.37]],mfj:mfjBkts,mfs:[[b.b10,.10],[b.b12,.12],[b.b22,.22],[b.b24,.24],[b.b32,.32],[b.b35*.6,.35],[Infinity,.37]],hoh:[[16550,.10],[63100,.12],[b.b22,.22],[b.b24,.24],[b.b32,.32],[b.b35,.35],[Infinity,.37]],qss:mfjBkts};
}
function _getStdDedForYear(yr,status){const b=_getBracketsForYear(yr);return{single:b.fedSingle,mfj:b.fedMFJ,mfs:b.fedMFS,hoh:b.fedHOH,qss:b.fedMFJ}[status]||b.fedSingle;}
function _getIrsRateForYear(yr){return _getBracketsForYear(yr).irsRate||S.irsRate||.725;}
function _getActiveStateData(){
  if(S.stateRates&&S.state&&S.stateRates[S.state])return S.stateRates[S.state];
  return{noTax:!S.ksLow&&!S.ksHigh,low:S.ksLow||0,high:S.ksHigh||0,top:S.ksTop||0,stdS:S.ksStdS||0,stdM:S.ksStdM||0};
}
function _buildStateBrackets(data,status){
  if(!data||data.noTax)return[[Infinity,0]];
  const mult=status==='mfj'||status==='qss'?2:status==='mfs'?0.9:1;
  const bkts=data.brackets;
  if(bkts&&bkts.length){
    return bkts.map((b,i)=>[i===bkts.length-1?Infinity:Math.round(b.top*mult),b.rate/100]);
  }
  const low=(data.low||0)/100,high=(data.high||0)/100,top=data.top||0;
  if(!high)return[[Infinity,0]];
  if(!top||top>=999999||low===high)return[[Infinity,high]];
  return[[Math.round(top*mult),low],[Infinity,high]];
}


// Persist S after a direct in-memory mutation (S.devices, S.timeOff, S.employees…).
// Bumps settingsTs so the change wins the cloud merge — WITHOUT reading the
// settings form. saveSettings() harvests the form and must only ever be called
// from the Settings UI; calling it from anywhere else wipes every saved value
// with whatever happens to be in the (usually empty) form inputs.
function _settingsChanged(){S.settingsTs=Date.now();saveAll();}
function saveAll(){if(_devSupportMode){_flushSaveNow();return;}if(_isEmployee){supaSaveDebounced();return;}try{
  // Settings are the most critical local write — if quota is blown, evict the
  // bulky image caches (rebuilt from cloud on demand) and retry rather than
  // silently losing every settings change until the next successful cloud save.
  try{localStorage.setItem('zp3_S',JSON.stringify(S));}
  catch(_qe){
    try{
      localStorage.removeItem('zp3_photos');localStorage.removeItem('zp3_rcpt_imgs');
      localStorage.setItem('zp3_S',JSON.stringify(S));
    }catch(_qe2){
      // Last resort: logoData can be several MB — split it out so the rest of S lands safely
      try{
        const{logoData:_ld,..._sNoLogo}=S;
        if(_ld)try{localStorage.setItem('zp3_logo',_ld);}catch(_e){}
        localStorage.setItem('zp3_S',JSON.stringify(_sNoLogo));
      }catch(_qe3){console.warn('zp3_S save failed (quota):',_qe3);}
    }
  }
  // These arrays are localStorage-only (not in Supabase schema) — safe to keep local
  localStorage.setItem('zp3_chk',JSON.stringify(checksState));
  localStorage.setItem('zp3_ev',JSON.stringify(events.slice(-600)));
  localStorage.setItem('zp3_photos',JSON.stringify(photos.slice(-300)));
  localStorage.setItem('zp3_lic',JSON.stringify(licenses));
  localStorage.setItem('zp3_contracts',JSON.stringify(contracts));
  localStorage.setItem('zp3_agreements',JSON.stringify(agreements));
  localStorage.setItem('zp3_maint',JSON.stringify(maintenance));
  // Offline-pending: write synchronously so a force-quit can never outrun a timer.
  // Use the shared owner-stamped blob so this account's data can never be merged
  // into a different account on the next sign-in (cross-account-bleed guard).
  if(typeof _mergeOnSignIn!=='undefined'&&_mergeOnSignIn&&!_supaUser){
    if(typeof _offlinePendingBlob==='function')localStorage.setItem('zp3_offline_pending',_offlinePendingBlob());
    else localStorage.setItem('zp3_offline_pending',JSON.stringify({clients,bids,jobs,ts:Date.now()}));
  }
}catch(e){}supaSaveDebounced();}
function loadAll(){
  // Business data (clients, bids, jobs, etc.) lives in Supabase only — start empty, populated by supaLoadFromCloud()
  clients=[];bids=[];jobs=[];income=[];expenses=[];mileage=[];payments=[];liens=[];timeEntries=[];
  // Load settings + localStorage-only arrays
  try{
    const lp=(k,d)=>{const s=localStorage.getItem(k);try{return s?JSON.parse(s):d;}catch(e){return d;}};
    const ss=localStorage.getItem('zp3_S');
    if(ss){
      const parsed=JSON.parse(ss);
      // If logoData was split out due to quota pressure, merge it back in
      if(!parsed.logoData){const _ld=localStorage.getItem('zp3_logo');if(_ld)parsed.logoData=_ld;}
      S={...S,...parsed};
    }
    checksState=lp('zp3_chk',{});
    events=lp('zp3_ev',[]);
    photos=lp('zp3_photos',[]);
    licenses=lp('zp3_lic',[]);
    contracts=lp('zp3_contracts',[]);
    agreements=lp('zp3_agreements',[]);
    maintenance=lp('zp3_maint',[]);
    // td_maintenance sync requires an id on every record; very old service
    // records predating the id field get one now so they can ride the upload.
    maintenance.forEach((m,i)=>{if(!m.id)m.id=Date.now()+i;});
    // Tax bracket migrations
    if(S.fedMFS===14600)S.fedMFS=15000;
    if(S.fedSingle===14600)S.fedSingle=15000;
    if(S.fedMFJ===29200)S.fedMFJ=30000;
    if(S.fedHOH===21900)S.fedHOH=22500;
    if(S.b10===11600)S.b10=11925;
    if(S.b12===47150)S.b12=48475;
    if(S.b22===100525)S.b22=103350;
    if(S.b24===191950)S.b24=197300;
    if(S.b32===243725)S.b32=250525;
    if(S.b35===609350)S.b35=626350;
    S.teamTracking=true; // crew tracking is mandatory — no longer user-toggleable
    if(S.irsRate===0.67||S.irsRate===0.670)S.irsRate=0.700;
    if(new Date().getFullYear()>=2026&&S.irsRate<0.725){S.irsRate=0.725;S.irsRateYear=new Date().getFullYear();}
    try{localStorage.setItem('zp3_S',JSON.stringify(S));}catch(e){}
  }catch(e){}
  // Nuke stale Supabase-managed keys left by old app versions
  try{['zp3_clients','zp3_bids','zp3_jobs','zp3_inc','zp3_exp','zp3_mil','zp3_pay','zp3_lien','zp3_te'].forEach(k=>localStorage.removeItem(k));}catch(e){}
}

function getClientById(id){return clients.find(c=>c.id===id);}
function getClientTier(c){
  if(!c)return 'C';
  if(c.tier)return c.tier;
  const A_OCC=['Realtor / Real estate agent','Property manager','Doctor / physician','Attorney / lawyer','Executive / business owner','Contractor / builder','Landlord / investor'];
  const B_OCC=['Engineer / tech','Nurse / healthcare','Teacher / educator','Government / military','Sales professional'];
  if(c.source==='Referral'||c.source==='Real estate agent'||c.source==='Repeat customer')return 'A';
  if(c.occupation&&A_OCC.includes(c.occupation))return 'A';
  if(c.occupation&&B_OCC.includes(c.occupation))return 'B';
  return 'C';
}
function getTierColor(t){return t==='A'?'var(--green-mid)':t==='B'?'var(--blue)':'var(--text3)';} 
function getClientMileage(cid){return mileage.filter(m=>m.client_id===cid);}
function getClientExpenses(cid){return expenses.filter(e=>e.client_id===cid);}
function getClientBids(cid){return bids.filter(b=>b.client_id===cid&&b.status!=='opportunity'&&(!b.draft||b.status==='Closed Won'));}
function getClientJobs(cid){return jobs.filter(j=>j.client_id===cid);}
function getClientIncome(cid){return income.filter(i=>i.client_id===cid);}

// ── Property lookup (Redfin via Cloudflare Tunnel proxy) ─────────────────────
const _propLookupTimers={};
async function _lookupProperty(addr,cardId){
  clearTimeout(_propLookupTimers[cardId]);
  const card=document.getElementById('prop-card-'+cardId);
  if(!card)return;
  // Need a reasonably complete address before firing
  const hasZip=/\b\d{5}\b/.test(addr);
  const hasCityState=/[A-Za-z]{2,},?\s+[A-Z]{2}\b/.test(addr);
  if(!hasZip&&!hasCityState){card.style.display='none';return;}
  _propLookupTimers[cardId]=setTimeout(async()=>{
    card.style.display='block';
    card.innerHTML='<div style="color:var(--text3);font-size:11px">Looking up property…</div>';
    try{
      const _ctrl=new AbortController();
      const _t=setTimeout(()=>_ctrl.abort(),12000);
      let res;try{res=await fetch('/api/property?addr='+encodeURIComponent(addr),{signal:_ctrl.signal});}finally{clearTimeout(_t);}
      if(res.status===204||!res.ok){card.style.display='none';return;}
      const d=await res.json();
      if(d.error){card.style.display='none';return;}
      const fmt=n=>n?'$'+Number(n).toLocaleString():'—';
      const leadPaint=d.yearBuilt&&d.yearBuilt<1978;
      card.innerHTML=
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'+
          '<span style="font-weight:600;color:var(--text)">Property Info</span>'+
          (leadPaint?'<span style="font-size:10px;background:#fef2f2;color:#991b1b;padding:2px 8px;border-radius:4px;font-weight:700">⚠ Pre-1978</span>':'')+
        '</div>'+
        (leadPaint?'<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:6px;padding:6px 10px;margin-bottom:8px;color:#991b1b;font-size:11px;font-weight:600;line-height:1.4">Lead paint protocol required — EPA RRP Rule applies to renovation work</div>':'')+
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 16px">'+
          '<div><div style="color:var(--text3);font-size:11px">Est. value</div><div style="font-weight:600">'+fmt(d.estValue)+'</div></div>'+
          '<div><div style="color:var(--text3);font-size:11px">Sq ft</div><div style="font-weight:600">'+(d.sqft?Number(d.sqft).toLocaleString()+'  sqft':'—')+'</div></div>'+
          '<div><div style="color:var(--text3);font-size:11px">Year built</div><div style="font-weight:600">'+(Number(d.yearBuilt)||'—')+'</div></div>'+
          '<div><div style="color:var(--text3);font-size:11px">Last sale</div><div style="font-weight:600">'+fmt(d.lastSalePrice)+'</div></div>'+
        '</div>';
    }catch(e){card.style.display='none';}
  },1200);
}


// ── Crowdsourced scope-timing benchmarks ──────────────────────────────────────
// _scopeRates: { 'scope_id:trade': { median_min, p25_min, p75_min, sample_count } }
// Populated from td_scope_rates table on boot; used for live scope-timing hints.
window._scopeRates = {};

function _applyScopeRates(rates) {
  const map = {};
  (rates || []).forEach(r => { map[r.scope_id + ':' + r.trade] = r; });
  window._scopeRates = map;
}

function _fetchScopeRates() {
  if (typeof _supa === 'undefined' || !_supa) return;
  _supa.from('td_scope_rates').select('*').then(({ data }) => {
    if (data && data.length) _applyScopeRates(data);
  }).catch(() => {});
}

// Upload debrief data for one job and trigger re-aggregation.
// Called by saveDebriefAndComplete after the local save.
function _submitScopeBenchmarks(rows) {
  if (!rows.length || typeof _supa === 'undefined' || !_supa || !_user?.id) return;
  _supa.from('td_scope_benchmarks').insert(rows).then(() => {
    _supa.functions.invoke('aggregate-scope-benchmarks').then(({ data }) => {
      if (data?.rates?.length) _applyScopeRates(data.rates);
    }).catch(() => {});
  }).catch(() => {});
}
