// ── Submit guard — prevents double-tap on any button ─────────────────────
let _submitting=false,_allowPhoneDupe=false;
let clients=[],bids=[],jobs=[],income=[],expenses=[],mileage=[],checksState={},payments=[],liens=[],events=[],timeEntries=[],photos=[],licenses=[],contracts=[];
// Expose bids and clients on window so Playwright E2E tests can inject test data
Object.defineProperty(window,'bids',{get:()=>bids,set:v=>{bids=v;},configurable:true});
Object.defineProperty(window,'clients',{get:()=>clients,set:v=>{clients=v;},configurable:true});
function _newBidId(){return Date.now()*1000+Math.floor(Math.random()*999);}
let currentClientId=null,editClientId=null,clientFilter='all';
let estSurfaces=[],estSurfId=0,estStep=1,estLinkedClientId=null,editingBidId=null,lastCreatedBidId=null;
let _pendingSignToken=null; // {bidId,token,proposalKey} — committed to bid only when SMS/email is actually sent
let _estAddrOptions=[];
function _pickEstAddr(i){
  const a=_estAddrOptions[i];if(!a)return;
  const f=document.getElementById('e-caddr');if(f){f.value=a.addr;markFieldFilled(f);saveEstFullDraft();}
  document.querySelectorAll('#_est-addr-picker button').forEach((b,j)=>{
    b.style.background=j===i?'var(--blue)':'var(--bg2)';
    b.style.color=j===i?'#fff':'var(--text3)';
    b.style.borderColor=j===i?'var(--blue)':'var(--border2)';
  });
}
let scopeHrsStore={};  // legacy — now keyed by room: roomScopeMap[roomName][scopeId]
let scopeActiveMap={};  // legacy — now keyed by room
let roomScopeMap={};  // PRIMARY: {roomName: {scopeId: {active:bool, hrs:N, rate:N, cost:N}}}
let estPropertyTier={key:'avg',mult:1.00,paint:'ProMar 200'};  // property profile for this estimate
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
  if(_weatherLoading)return _weatherCache;
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


let S={bitlyKey:'',mapboxKey:'',goalMonthly:0,laborRate:45,irsRate:.725,irsRateYear:2026,bracketYear:0,taxYear:2026,fedSingle:15000,fedMFJ:30000,fedMFS:15000,fedHOH:22500,b10:11925,b12:48475,b22:103350,b24:197300,b32:250525,b35:626350,ksLow:3.1,ksTop:33000,ksHigh:5.7,ksStdS:3500,ksStdM:8000,bname:'',bphone:'',blic:'Licensed & Insured',veh:'',margin:40,cov:350,mm:15,rWalls:1.30,rCeil:1.00,rTrim:3.25,rDoor:95,rWin:50,rExt:1.10,rDeck:1.00,suppliesRate:0.40,timeOff:[],employees:[],devices:[],subcontractors:[],logoData:'',brandColor:'',bwebsite:'',subdomain:'',stateRates:{},priceBook:{}};

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

// Default configs by business type
function getRole(){return _user?.role||'owner';}
function isOwner(){return !_isEmployee&&(getRole()==='owner'||getRole()==='co-owner');}
function isEmployee(){return _isEmployee;}
function canSeeTaxes(){return isOwner();}
function isLifetimeAccount(){return !!_account?.is_lifetime;}
function getBusinessName(){return _account?.business_name||S.bname||'TradeDesk';}
function getUserName(){return _user?.name||'';}
function getOwnerName(){
  // Check localStorage first (device-specific, fast)
  if(_supaUser?.id){
    const stored=localStorage.getItem('zp3_uname_'+_supaUser.id);
    if(stored)return stored;
  }
  // Fall back to S.ownerName (synced from Supabase on other devices)
  if(S.ownerName)return S.ownerName;
  return _user?.name||'';
}
function setOwnerName(name){
  if(_supaUser?.id)localStorage.setItem('zp3_uname_'+_supaUser.id,name);
  if(_user)_user.name=name;
  // Also store in S so it syncs to Supabase with the rest of settings
  S.ownerName=name;
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

function saveAll(){if(_devSupportMode){_flushSaveNow();return;}if(_isEmployee){supaSaveDebounced();return;}try{
  localStorage.setItem('zp3_S',JSON.stringify(S));
  // These arrays are localStorage-only (not in Supabase schema) — safe to keep local
  localStorage.setItem('zp3_chk',JSON.stringify(checksState));
  localStorage.setItem('zp3_ev',JSON.stringify(events.slice(-600)));
  localStorage.setItem('zp3_photos',JSON.stringify(photos.slice(-300)));
  localStorage.setItem('zp3_lic',JSON.stringify(licenses));
  localStorage.setItem('zp3_contracts',JSON.stringify(contracts));
  // Offline-pending: write synchronously so a force-quit can never outrun a timer
  if(typeof _mergeOnSignIn!=='undefined'&&_mergeOnSignIn&&!_supaUser){
    localStorage.setItem('zp3_offline_pending',JSON.stringify({clients,bids,jobs,ts:Date.now()}));
  }
}catch(e){}supaSaveDebounced();}
function loadAll(){
  // Business data (clients, bids, jobs, etc.) lives in Supabase only — start empty, populated by supaLoadFromCloud()
  clients=[];bids=[];jobs=[];income=[];expenses=[];mileage=[];payments=[];liens=[];timeEntries=[];
  // Load settings + localStorage-only arrays
  try{
    const lp=(k,d)=>{const s=localStorage.getItem(k);return s?JSON.parse(s):d;};
    const ss=localStorage.getItem('zp3_S');
    if(ss){const parsed=JSON.parse(ss);S={...S,...parsed};}
    checksState=lp('zp3_chk',{});
    events=lp('zp3_ev',[]);
    photos=lp('zp3_photos',[]);
    licenses=lp('zp3_lic',[]);
    contracts=lp('zp3_contracts',[]);
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

