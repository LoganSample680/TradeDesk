let _stripeConnectStatus=null; // cached: {connected, charges_enabled, details_submitted, stripe_account_id}

async function _fetchStripeConnectStatus(){
  if(!supaEnabled()||!_supaUser)return null;
  // Serve from localStorage cache (1-hour TTL) so hub sharing is instant after first load
  const _cacheKey='td_stripe_status_'+(_supaUser?.id||'');
  try{
    const _cached=JSON.parse(localStorage.getItem(_cacheKey)||'null');
    if(_cached&&_cached.ts&&(Date.now()-_cached.ts)<3600000){
      _stripeConnectStatus=_cached.data;return _cached.data;
    }
  }catch(e){}
  try{
    const session=await _supa.auth.getSession();
    const token=session?.data?.session?.access_token;
    if(!token)return null;
    const res=await fetch(SUPA_URL+'/functions/v1/stripe-connect-status',{
      method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'{}'
    });
    const data=await res.json();
    _stripeConnectStatus=data;
    try{localStorage.setItem(_cacheKey,JSON.stringify({ts:Date.now(),data}));}catch(e){}
    return data;
  }catch(e){return null;}
}
async function loadStripeConnectStatus(){
  const el=document.getElementById('stripe-connect-status-ui');
  if(!supaEnabled()||!_supaUser){
    if(el)el.innerHTML='<div style="font-size:12px;color:var(--text3)">Sign in to connect Stripe.</div>';return;
  }
  const data=await _fetchStripeConnectStatus();
  if(!data){if(el)el.innerHTML='<div style="font-size:12px;color:var(--red)">Could not check Stripe status.</div>';return;}
  if(el)_renderStripeConnectUI(el,data);
}

function _renderStripeConnectUI(el,data){
  if(!data||!data.connected){
    el.innerHTML=
      '<div style="font-size:13px;color:var(--text2);margin-bottom:10px;line-height:1.5">Connect your Stripe account so clients can pay you directly via card or bank transfer. Money lands in your Stripe account instantly.</div>'+
      '<button class="btn btn-p" onclick="startStripeConnect()" style="font-size:13px;padding:10px 18px">⚡ Connect Stripe Account</button>';
    return;
  }
  if(data.connected&&!data.charges_enabled){
    el.innerHTML=
      '<div style="display:flex;align-items:center;gap:8px;background:#FFF8F0;border:1px solid var(--amber);border-radius:var(--r);padding:10px 12px;margin-bottom:10px">'+
        '<span style="font-size:16px">⚠️</span>'+
        '<div>'+
          '<div style="font-size:13px;font-weight:700;color:#856404">Stripe setup incomplete</div>'+
          '<div style="font-size:11px;color:var(--text3)">Account created but onboarding not finished.</div>'+
        '</div>'+
      '</div>'+
      '<button class="btn btn-p btn-sm" onclick="startStripeConnect()">Resume setup →</button>';
    return;
  }
  // Fully connected
  el.innerHTML=
    '<div style="display:flex;align-items:center;gap:8px;background:var(--green-lt);border:1px solid var(--green);border-radius:var(--r);padding:10px 12px;margin-bottom:10px">'+
      '<span style="font-size:18px">✅</span>'+
      '<div style="flex:1">'+
        '<div style="font-size:13px;font-weight:700;color:var(--green-mid)">Stripe connected — payments active</div>'+
        '<div style="font-size:11px;color:var(--text3)">Account: '+escHtml(data.stripe_account_id)+(data.payouts_enabled?' · Payouts on':' · Payouts pending')+'</div>'+
      '</div>'+
    '</div>'+
    '<button class="btn btn-sm" onclick="openStripeConnect()" style="font-size:11px;color:var(--text3)">Manage in Stripe →</button>';
}

async function startStripeConnect(){
  if(!supaEnabled()||!_supaUser){zAlert('Sign in first.');return;}
  const btn=event?.target;if(btn){btn.disabled=true;btn.textContent='Starting…';}
  try{
    const session=await _supa.auth.getSession();
    const token=session?.data?.session?.access_token;
    const res=await fetch(SUPA_URL+'/functions/v1/stripe-connect-onboard',{
      method:'POST',
      headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify({returnUrl:(window._tdNativeReturnUrl||window.location.href.split('#')[0])})
    });
    const data=await res.json();
    if(data.error){zAlert('Stripe error: '+data.error);if(btn){btn.disabled=false;btn.textContent='⚡ Connect Stripe Account';}return;}
    window.location.href=data.url;
  }catch(e){
    zAlert('Could not start Stripe Connect: '+e.message);
    if(btn){btn.disabled=false;btn.textContent='⚡ Connect Stripe Account';}
  }
}

function openStripeConnect(){
  window.open('https://dashboard.stripe.com/','_blank');
}

async function checkStripeConnectReturn(){
  const params=new URLSearchParams(window.location.search);
  if(params.get('stripe_connected')==='1'){
    history.replaceState(null,'',window.location.pathname);
    await loadStripeConnectStatus();
    const st=_stripeConnectStatus;
    if(st?.charges_enabled){
      showToast('Stripe connected! You can now receive card payments.','✅');
    } else {
      showToast('Stripe setup needs a bit more info — check Settings → Stripe.','⚠️');
    }
    goPg('pg-settings');
  } else if(params.get('stripe_reauth')==='1'){
    history.replaceState(null,'',window.location.pathname);
    await startStripeConnect();
  }
}

async function sendPaymentLink(bidId){
  const bid=bids.find(b=>b.id===bidId);if(!bid)return;
  const c=getClientById(bid.client_id);if(!c)return;
  const balance=getBidBalance(bid);
  if(balance<0.50){zAlert('No balance outstanding on this bid.');return;}
  if(!navigator.onLine){
    zAlert('Payment links require an internet connection — Stripe can\'t create a checkout session offline.\n\nOnce you\'re back online, tap Send Pay Link and it\'ll go right through. You can also record a manual cash or check payment now.',{title:'No internet connection'});
    return;
  }
  if(!supaEnabled()||!_supaUser){zAlert('Sign in to send payment links.');return;}
  if(!_stripeConnectStatus?.charges_enabled){
    zAlert('Connect your Stripe account in Settings first.','',{title:'Stripe not connected'});goPg('pg-settings');return;
  }
  try{
    showToast('Creating payment link…','⏳');
    const session=await _supa.auth.getSession();
    const token=session?.data?.session?.access_token;
    const baseUrl=window.location.href.split('#')[0];
    const _depPaid=getBidPaid(bid.id)>0;
    const res=await fetch(SUPA_URL+'/functions/v1/create-checkout',{
      method:'POST',
      headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify({
        amount:Math.round(balance*100),
        currency:'usd',
        paymentMethod:'card',
        paymentType:_depPaid?'full':'deposit',
        proposalKey:null,
        clientName:c.name,
        businessName:S.bname||'Your Contractor',
        bidId:String(bid.id),
        contractorUserId:_supaUser.id,
        notifyEmail:_supaUser.email,
        successUrl:baseUrl+'#paid-'+bid.id,
        cancelUrl:baseUrl+'#cancel-'+bid.id,
      })
    });
    const data=await res.json();
    if(data.error){zAlert('Error: '+data.error);return;}
    // Show link modal (copy fallback) then attempt SMS
    const _showPayLinkModal=(url)=>{
      const ov=document.createElement('div');ov.className='zmodal-overlay';
      const box=document.createElement('div');box.className='zmodal';
      box.innerHTML=
        '<div style="font-size:17px;font-weight:800;margin-bottom:4px">💳 Payment link ready</div>'+
        '<div style="font-size:12px;color:var(--text3);margin-bottom:14px">'+c.name+' · '+fmt(balance)+' due</div>'+
        '<div style="background:var(--bg);border:1px solid var(--border2);border-radius:var(--r);padding:10px 12px;font-size:12px;word-break:break-all;color:var(--text2);margin-bottom:14px;user-select:all">'+url+'</div>'+
        '<button onclick="navigator.clipboard.writeText(\''+url+'\').then(()=>showToast(\'Copied!\',\'📋\'));this.textContent=\'✓ Copied\'" style="width:100%;padding:12px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:8px">📋 Copy link</button>'+
        (c.phone?'<button onclick="this.closest(\'.zmodal-overlay\').remove();window.location.href=\'sms:\'+\''+c.phone.replace(/\D/g,'')+'\'+\'?body=\'+encodeURIComponent(\'Hi '+c.name.split(' ')[0]+', here\\\'s your payment link for '+fmt(balance)+' owed to '+(S.bname||'us')+': '+url+' — Thank you!\')" style="width:100%;padding:12px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;margin-bottom:8px">📱 Open in Messages</button>':'')+
        '<button onclick="this.closest(\'.zmodal-overlay\').remove()" style="width:100%;padding:10px;border-radius:var(--r);border:none;background:none;color:var(--text3);font-size:13px;cursor:pointer;font-family:inherit">Close</button>';
      ov.appendChild(box);document.body.appendChild(ov);
      ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
      navigator.clipboard.writeText(url).catch(()=>{});
    };
    _showPayLinkModal(data.url);
    autoLogContact(bid.client_id,'payment_link_sent');
  }catch(e){
    zAlert('Could not create payment link: '+e.message);
  }
}
// ── Account + User loader ─────────────────────────────────────────────
async function loadAccountData(){
  if(!_supa||!_supaUser)return false;
  try{
    const{data:u}=await _supa.from('users').select('*').eq('id',_supaUser.id).maybeSingle();
    if(u&&u.account_id){
      _user=u;
      const{data:a}=await _supa.from('accounts').select('*').eq('id',u.account_id).maybeSingle();
      _account=a;
      const{data:cfg}=await _supa.from('account_config').select('*').eq('account_id',u.account_id).maybeSingle();
      _config=cfg;
      const{data:vehs}=await _supa.from('vehicles').select('*').eq('account_id',u.account_id);
      _vehicles=vehs||[];
      if(_account?.business_name)S.bname=_account.business_name;
      if(_account?.phone)S.bphone=_account.phone;
      if(_account?.license_info)S.blic=_account.license_info;
      if(_account?.state)S.state=_account.state;
      _activeTrade=_config?.business_type||'painting';
      _renderNavTradeSwitcher();
      applyPermissions();
      // Cache for offline restore
      try{localStorage.setItem('zp3_acct_'+_supaUser.id,JSON.stringify({user:_user,account:_account,config:_config,activeTrade:_activeTrade,isEmployee:false}));}catch(_e){}
      return true;
    }
    // Check if this user is a linked employee
    const{data:empRow}=await _supa.from('team_members').select('*').eq('employee_user_id',_supaUser.id).eq('active',true).maybeSingle();
    if(empRow){
      _isEmployee=true;_contractorUserId=empRow.contractor_user_id;_employeeRecord=empRow;
      _user={id:_supaUser.id,email:_supaUser.email,name:empRow.name,role:empRow.role||'employee',account_id:null};
      applyPermissions();
      try{localStorage.setItem('zp3_acct_'+_supaUser.id,JSON.stringify({user:_user,activeTrade:'painting',isEmployee:true,contractorUserId:_contractorUserId}));}catch(_e){}
      return true;
    }
    // Check for pending invite (email match, not yet linked)
    const{data:inviteRow}=await _supa.from('team_members').select('*').eq('email',_supaUser.email).is('employee_user_id',null).maybeSingle();
    if(inviteRow){
      await _supa.from('team_members').update({employee_user_id:_supaUser.id,active:true,joined_at:new Date().toISOString()}).eq('id',inviteRow.id);
      _isEmployee=true;_contractorUserId=inviteRow.contractor_user_id;
      _employeeRecord={...inviteRow,employee_user_id:_supaUser.id,active:true};
      _user={id:_supaUser.id,email:_supaUser.email,name:inviteRow.name,role:inviteRow.role||'employee',account_id:null};
      applyPermissions();
      try{localStorage.setItem('zp3_acct_'+_supaUser.id,JSON.stringify({user:_user,activeTrade:'painting',isEmployee:true,contractorUserId:_contractorUserId}));}catch(_e){}
      return true;
    }
    // No users row — check for pre-schema user via zj_data
    const{data:zd}=await _supa.from('zj_data').select('user_id').eq('user_id',_supaUser.id).maybeSingle();
    if(zd){
      _user={id:_supaUser.id,email:_supaUser.email,name:getOwnerName()||'',role:'owner',account_id:null};
      applyPermissions();
      try{localStorage.setItem('zp3_acct_'+_supaUser.id,JSON.stringify({user:_user,activeTrade:_activeTrade||'painting',isEmployee:false}));}catch(_e){}
      return true;
    }
    return false;
  }catch(e){
    console.warn('loadAccountData failed:',e);
    // Network failure — restore from cache so offline sign-in still reaches supaLoadFromCloud()
    try{
      const _ac=JSON.parse(localStorage.getItem('zp3_acct_'+_supaUser.id)||'null');
      if(_ac){
        _user=_ac.user||{id:_supaUser.id,email:_supaUser.email,name:getOwnerName()||'',role:'owner',account_id:null};
        if(_ac.isEmployee){_isEmployee=true;_contractorUserId=_ac.contractorUserId;}
        _activeTrade=_ac.activeTrade||'painting';
        if(_ac.account){_account=_ac.account;if(_account.business_name)S.bname=_account.business_name;if(_account.phone)S.bphone=_account.phone;}
        if(_ac.config)_config=_ac.config;
        _renderNavTradeSwitcher();applyPermissions();
        return true;
      }
    }catch(_ce){}
    return false;
  }
}

// ── Dev Support View ──────────────────────────────────────────────────
// Developer access to user data for troubleshooting is disclosed in TradeDesk's
// Terms of Service accepted at account creation. Supabase RLS policy "dev_support_read"
// on zj_data grants logansample97 read access for support purposes.
let _devSupportMode=false,_devSupportName='',_devSavedState=null;
const _DEV_SUPPORT_USERS={
  zach:{name:'Zach',userId:'6201cb8c-c4de-4bf2-bdf7-0376f0577cc4'},
};
async function _devLoadUserAccount(key){
  if(!_config?.is_dev)return;
  clearTimeout(_syncTimer);
  await supaSaveToCloud();
  const u=_DEV_SUPPORT_USERS[key];
  if(!u){showToast('Unknown support user','⚠️');return;}
  // Load all per-record tables for target user in parallel (requires dev_support RLS policy)
  const[tableResults,settingsResult]=await Promise.all([
    Promise.all(_TD_TABLES.map(({t})=>_supa.from(t).select('id,data').eq('user_id',u.userId).is('deleted_at',null))),
    _supa.from('zj_data').select('settings,checks_state').eq('user_id',u.userId).maybeSingle()
  ]);
  if(tableResults.some(r=>r.error)){showToast('Load failed — run dev_support SQL policy in Supabase','❌');return;}
  // Snapshot dev's own state (all arrays + _lastKnownIds) so exit restores cleanly
  _devSavedState={
    clients:[...clients],bids:[...bids],jobs:[...jobs],payments:[...payments],liens:[...liens],
    income:[...income],expenses:[...expenses],mileage:[...mileage],timeEntries:[...timeEntries],
    licenses:[...licenses],events:[...events],contracts:[...contracts],photos:[...photos],
    S:JSON.parse(JSON.stringify(S)),
    lastKnownIds:Object.fromEntries(Object.entries(_lastKnownIds).map(([k,v])=>[k,[...v]]))
  };
  // Load target user's records into memory
  for(let i=0;i<_TD_TABLES.length;i++){
    const{t,set}=_TD_TABLES[i];
    const rows=(tableResults[i].data||[]).map(r=>r.data);
    set(rows);
    _lastKnownIds[t]=new Set((tableResults[i].data||[]).map(r=>String(r.id)));
  }
  if(settingsResult.data?.settings){try{const zS=JSON.parse(settingsResult.data.settings);Object.assign(S,zS);}catch(e){}}
  _devSupportMode=true;_devSupportName=u.name;
  window._devUnloadGuard=e=>{e.preventDefault();e.returnValue='';};
  window.addEventListener('beforeunload',window._devUnloadGuard);
  _renderDevTradeCard();renderDash();
  renderClientList&&renderClientList();renderJobsPage&&renderJobsPage();renderMoneyPage&&renderMoneyPage();
  showToast('Viewing '+_devSupportName+'\'s account','👁');
}
async function _devExitSupportMode(){
  if(!_devSavedState)return;
  clearTimeout(_syncTimer);_syncTimer=null;
  if(_pendingSavePromise){try{await _pendingSavePromise;}catch(e){console.warn('[support exit] pending save failed:',e);}}
  window.removeEventListener('beforeunload',window._devUnloadGuard);
  ({clients,bids,jobs,payments,liens,income,expenses,mileage,timeEntries,licenses,events,contracts,photos}=_devSavedState);
  if(_devSavedState.S){const dS=_devSavedState.S;Object.keys(S).forEach(k=>{if(!(k in dS))delete S[k];});Object.assign(S,dS);}
  if(_devSavedState.lastKnownIds){for(const[k,v]of Object.entries(_devSavedState.lastKnownIds))_lastKnownIds[k]=new Set(v);}
  _devSupportMode=false;_devSupportName='';_devSavedState=null;
  saveAll();
  _renderDevTradeCard();renderDash();
  renderClientList&&renderClientList();renderJobsPage&&renderJobsPage();renderMoneyPage&&renderMoneyPage();
  showToast('Back to your account','✓');
}

function _devRenderSnapshots(key){
  try{
    const snaps=JSON.parse(localStorage.getItem('zp3_dev_snaps_'+key)||'[]');
    if(!snaps.length)return '';
    const rows=snaps.map((s,i)=>{
      const d=new Date(s.ts);
      const label=d.toLocaleDateString('en-US',{month:'short',day:'numeric'})+' '+d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:11px;color:var(--text2)">${label}</span>
        <button onclick="_devRestoreSnapshot('${key}',${i})" style="font-size:10px;padding:3px 8px;border:1px solid var(--red);border-radius:4px;background:none;color:var(--red);cursor:pointer;font-family:inherit">Restore</button>
      </div>`;
    }).join('');
    return `<div style="margin-top:10px;padding:8px 10px;background:var(--bg2);border-radius:var(--r)">
      <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:var(--text3);margin-bottom:6px">Auto-backups (last ${snaps.length})</div>
      ${rows}
    </div>`;
  }catch(e){return '';}
}
async function _devRestoreSnapshot(key,idx){
  const snaps=JSON.parse(localStorage.getItem('zp3_dev_snaps_'+key)||'[]');
  const snap=snaps[idx];if(!snap)return;
  const d=new Date(snap.ts);
  const label=d.toLocaleDateString('en-US',{month:'short',day:'numeric'})+' at '+d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
  zConfirm('Restore Zach\'s data to the snapshot from '+label+'? This overwrites his current Supabase data.',async()=>{
    const u=_DEV_SUPPORT_USERS[key];if(!u)return;
    const{error}=await _supa.from('zj_data').update(snap.data).eq('user_id',u.userId);
    if(error){showToast('Restore failed: '+error.message,'❌');return;}
    showToast('Restored to '+label,'✓');
    // If currently in support mode, reload Zach's data into memory
    if(_devSupportMode){
      const p=(s,fb)=>{try{return s?JSON.parse(s):fb}catch{return fb}};
      clients=p(snap.data.clients,[]);bids=p(snap.data.bids,[]);jobs=p(snap.data.jobs,[]);
      payments=p(snap.data.payments,[]);liens=p(snap.data.liens,[]);
      income=p(snap.data.income,[]);expenses=p(snap.data.expenses,[]);
      mileage=p(snap.data.mileage,[]);timeEntries=p(snap.data.time_entries,[]);
      renderDash();renderClientList&&renderClientList();renderJobsPage&&renderJobsPage();
    }
  },{title:'Restore backup',yes:'Restore',danger:true});
}
// ── Toast notifications ────────────────────────────────────────────────
const SUPA_URL = 'https://mwtsmctajhrrybblgorf.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im13dHNtY3RhamhycnliYmxnb3JmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNjIwNjMsImV4cCI6MjA5MDczODA2M30.-FMn1pEs9PpCvv8eGwSbtucWAWvcfEcQ1SYx4nD207M';
const APP_VERSION='05.20.26.179';
let _supa=null,_supaUser=null,_syncTimer=null,_syncStatus='local',_supaCloudLoaded=false,_lastLocalSaveAt=0;
let _syncBroadcastChannel=null,_realtimeSubscribed=false,_loadInProgress=false,_broadcastReloadTimer=null;
const _deviceId=Math.random().toString(36).slice(2,10);

// Tracks IDs present in each table after the last successful load or save.
// Used to detect deletions (record in _lastKnownIds but not in current array).
let _lastKnownIds={
  td_clients:new Set(),td_bids:new Set(),td_jobs:new Set(),
  td_income:new Set(),td_expenses:new Set(),td_mileage:new Set(),
  td_payments:new Set(),td_liens:new Set(),td_time_entries:new Set(),
  td_licenses:new Set(),td_events:new Set(),td_contracts:new Set(),td_photos:new Set()
};

// Per-record table definitions — one entry per data type.
// arr: getter for the live in-memory array
// set: setter (replaces array contents in-place; keeps same reference for other code)
// transform: strip fields that shouldn't go to Supabase (e.g. inline base64)
const _TD_TABLES=[
  {t:'td_clients',     get:()=>clients,     set:v=>{clients.length=0;v.forEach(r=>clients.push(r));},     tx:null},
  {t:'td_bids',        get:()=>bids,        set:v=>{bids.length=0;v.forEach(r=>bids.push(r));},           tx:null},
  {t:'td_jobs',        get:()=>jobs,        set:v=>{jobs.length=0;v.forEach(r=>jobs.push(r));},           tx:null},
  {t:'td_income',      get:()=>income,      set:v=>{income.length=0;v.forEach(r=>income.push(r));},       tx:null},
  {t:'td_expenses',    get:()=>expenses,    set:v=>{expenses.length=0;v.forEach(r=>expenses.push(r));},   tx:arr=>arr.map(({receipt_img,...r})=>r)},
  {t:'td_mileage',     get:()=>mileage,     set:v=>{mileage.length=0;v.forEach(r=>mileage.push(r));},     tx:null},
  {t:'td_payments',    get:()=>payments,    set:v=>{payments.length=0;v.forEach(r=>payments.push(r));},   tx:null},
  {t:'td_liens',       get:()=>liens,       set:v=>{liens.length=0;v.forEach(r=>liens.push(r));},         tx:null},
  {t:'td_time_entries',get:()=>timeEntries, set:v=>{timeEntries.length=0;v.forEach(r=>timeEntries.push(r));}, tx:arr=>arr.slice(-500)},
  {t:'td_licenses',    get:()=>licenses,    set:v=>{licenses.length=0;v.forEach(r=>licenses.push(r));},   tx:null},
  {t:'td_events',      get:()=>events,      set:v=>{events.length=0;v.forEach(r=>events.push(r));},       tx:arr=>arr.slice(-600)},
  {t:'td_contracts',   get:()=>contracts,   set:v=>{contracts.length=0;v.forEach(r=>contracts.push(r));}, tx:null},
  {t:'td_photos',      get:()=>photos,      set:v=>{photos.length=0;v.forEach(r=>photos.push(r));},
    tx:arr=>arr.filter(p=>p.storagePath||p.url).map(({id,url,storagePath,type,caption,client_id,client_name,job_id,job_name,uploadedAt})=>({id,url,storagePath:storagePath||'',type,caption,client_id,client_name,job_id,job_name,uploadedAt}))},
];

// ── Long-press delete (3s hold on any [data-lp-id] element) ────────────────
let _lpTimer=null,_lpFired=false;
(function(){
  const s=document.createElement('style');
  s.textContent='[data-lp-id]{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;}';
  (document.head||document.documentElement).appendChild(s);
  function _lpStart(e){
    const row=e.target.closest('[data-lp-id]');
    if(!row)return;
    if(e.target.closest('button,select,input,a,label'))return;
    clearTimeout(_lpTimer);_lpFired=false;
    _lpTimer=setTimeout(()=>{_lpTimer=null;_lpFired=true;_showLpDeletePopup(row);},3000);
  }
  function _lpCancel(){clearTimeout(_lpTimer);_lpTimer=null;}
  document.addEventListener('touchstart',_lpStart,{passive:true});
  document.addEventListener('touchend',_lpCancel);
  document.addEventListener('touchmove',_lpCancel,{passive:true});
  document.addEventListener('mousedown',_lpStart);
  document.addEventListener('mouseup',_lpCancel);
  document.addEventListener('click',e=>{if(_lpFired){_lpFired=false;e.stopPropagation();e.preventDefault();}},true);
  document.addEventListener('contextmenu',e=>{if(e.target.closest('[data-lp-id]'))e.preventDefault();});
})();
function _showLpDeletePopup(row){
  document.getElementById('_lp-del-popup')?.remove();
  const id=row.dataset.lpId,type=row.dataset.lpType,label=row.dataset.lpLabel||'this record';
  const isClient=(type==='lead'||type==='client');
  const sub=isClient?'Also removes all their bids, jobs, and expenses.':'This cannot be undone.';
  const ov=document.createElement('div');
  ov.id='_lp-del-popup';
  ov.style.cssText='position:fixed;inset:0;z-index:99990;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);padding:20px';
  ov.innerHTML='<div style="background:var(--bg);border-radius:16px;padding:24px;width:100%;max-width:300px;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.35)">'+
    '<div style="font-size:32px;margin-bottom:8px">🗑️</div>'+
    '<div style="font-size:15px;font-weight:800;margin-bottom:4px">Delete '+escHtml(label)+'?</div>'+
    '<div style="font-size:12px;color:var(--text3);margin-bottom:20px;line-height:1.4">'+sub+'</div>'+
    '<div style="display:flex;gap:10px">'+
      '<button onclick="document.getElementById(\'_lp-del-popup\').remove()" style="flex:1;padding:12px;border:1.5px solid var(--border);background:var(--bg2);border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">Cancel</button>'+
      '<button id="_lp-del-btn" style="flex:1;padding:12px;border:none;background:#A32D2D;color:#fff;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">Delete</button>'+
    '</div>'+
  '</div>';
  document.body.appendChild(ov);
  document.getElementById('_lp-del-btn').onclick=()=>{ov.remove();_lpDoDelete(id,type);};
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
}
function _lpDoDelete(id,type){
  const nid=parseInt(id,10);
  if(type==='income'){income=income.filter(x=>x.id!==nid);_flushSaveNow&&_flushSaveNow();if(typeof renderIncome==='function')renderIncome();}
  else if(type==='payment'){payments=payments.filter(x=>x.id!==nid);_flushSaveNow&&_flushSaveNow();if(typeof renderIncome==='function')renderIncome();}
  else if(type==='expense'){if(typeof delExpense==='function')delExpense(nid);}
  else if(type==='mileage'){if(typeof delMileage==='function')delMileage(nid);}
  else if(type==='lead'||type==='client'){_lpDeleteClientById(nid,type);}
}
function _lpDeleteClientById(id,fromType){
  clients=clients.filter(x=>x.id!==id);
  bids=bids.filter(b=>b.client_id!==id);
  jobs=jobs.filter(j=>j.client_id!==id);
  mileage=mileage.filter(m=>m.client_id!==id);
  income=income.filter(i=>i.client_id!==id);
  expenses=expenses.filter(e=>e.client_id!==id);
  _flushSaveNow&&_flushSaveNow();
  if(fromType==='lead'){if(typeof renderLeadsPage==='function')renderLeadsPage();}
  else{if(typeof renderClientList==='function')renderClientList();}
}

let _proposalViews={};
// true when data came from localStorage cache, not a live Supabase fetch.
// supaSaveToCloud() checks this + runs a sanity guard to prevent pushing
// incomplete in-memory state over real cloud data.
let _loadedFromCacheOnly=false;
let _mergeOnSignIn=false; // true when offline data in memory needs merging after SIGNED_IN
let _sessionRestoreInProgress=false;
function supaEnabled(){return !!(SUPA_URL&&SUPA_KEY);}
function _removeBootOverlay(){
  const o=document.getElementById('supa-boot-overlay');if(!o)return;
  o.classList.add('td-fadeout');
  setTimeout(()=>{
    o.remove();
    const resumeBid=localStorage.getItem('_sw_resume_bid');
    if(resumeBid){
      localStorage.removeItem('_sw_resume_bid');
      const bid=bids.find(b=>String(b.id)===resumeBid);
      if(bid){
        setTimeout(()=>{
          // Generic/T&M/BYO bids — openGenericEstimate reads b.isTM / b.isFreeForm internally
          if(bid.geiLines!==undefined){
            openGenericEstimate(getClientById(bid.client_id),bid.id,bid.trade_type||'general');
          }else{
            openEditBid(bid.id);
          }
        },80);
      }
    }
    // Restore any unsaved form fields that were open when auto-update fired
    try{
      const raw=localStorage.getItem('_form_snap');
      if(raw){
        localStorage.removeItem('_form_snap');
        const snap=JSON.parse(raw);
        const{_pg,_clientFormOpen,_editClientId,...fields}=snap;
        // Client form restore must run even if no fields were typed yet
        if(_clientFormOpen&&!_editClientId){
          setTimeout(()=>{
            goPg('pg-clients');
            openNewClient();
            if(Object.keys(fields).length>0){
              setTimeout(()=>{
                Object.entries(fields).forEach(([id,val])=>{
                  const el=document.getElementById(id);
                  if(el&&val!==undefined)el.value=val;
                });
                showToast('New lead form restored — review and save','📋');
              },80);
            }
          },200);
          return;
        }
        const hasFields=Object.keys(fields).length>0;
        if(!hasFields)return;
        // Navigate to the right page for non-client-form restores
        if(_pg&&_pg!=='pg-dash'&&_pg!=='pg-est'&&_pg!=='pg-est-generic')goPg(_pg);
        setTimeout(()=>{
          let restored=0;
          Object.entries(fields).forEach(([id,val])=>{
            const el=document.getElementById(id);
            if(el&&val!==undefined){el.value=val;restored++;}
          });
          if(restored>0)showToast('Form data restored — review and save','📋');
        },150);
      }
    }catch(e){}
    // Handle PWA shortcuts and share-target after app is fully rendered
    setTimeout(()=>{
      window._pwaHandleShortcut&&window._pwaHandleShortcut();
    },500);
  },320);
}
async function supaInit(){
  if(!supaEnabled())return;
  try{
    _supa=supabase.createClient(SUPA_URL,SUPA_KEY,{
      auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,storage:window.localStorage}
    });
    const{data:{session}}=await _supa.auth.getSession();
    if(session){
      _supaUser=session.user;
      _saveSessionBackup(session);
      const hasAccount=await loadAccountData();
      if(hasAccount){
        await supaLoadFromCloud();
        _supaCloudLoaded=true;
      } else {
        // Signed in but no data at all — go to app, let them use it
        _removeBootOverlay();
        renderDash();buildScopeGrid();
        supaSetStatus('cloud');
      }
    } else {
      // No valid session — load from cache if available, regardless of navigator.onLine
      // (iOS reports onLine:true even on airplane mode, so the flag is not reliable).
      // onAuthStateChange + _startOfflineWatcher must always be reached below, so no early return.
      let _cacheLoaded=false;
      const _cc=localStorage.getItem('zp3_cloud_cache');
      if(_cc){
        try{
          const _cd=JSON.parse(_cc);
          clients=_cd.clients||[];bids=_cd.bids||[];jobs=_cd.jobs||[];
          payments=_cd.payments||[];income=_cd.income||[];expenses=_cd.expenses||[];
          mileage=_cd.mileage||[];liens=_cd.liens||[];timeEntries=_cd.timeEntries||[];
          if(_cd.licenses?.length)licenses=_cd.licenses;
          if(_cd.events?.length)events=_cd.events;
          if(_cd.contracts?.length)contracts=_cd.contracts;
          if(_cd.photos?.length)photos=_cd.photos;
          if(_cd.checksState&&Object.keys(_cd.checksState).length)checksState=_cd.checksState;
          if(_cd.settings){S={...S,..._cd.settings};applySettings();loadSettingsForm();}
          _mergeOfflinePendingToMemory(); // surface any records not yet pushed to cloud
          _loadedFromCacheOnly=true;
          _mergeOnSignIn=true;
          _removeBootOverlay();renderDash();buildScopeGrid();
          _showOfflineBanner();
          supaSetStatus('error');
          _cacheLoaded=true;
        }catch(_ce){}
      }
      if(!_cacheLoaded){
        // Online or cache parse failed — show login screen
        _removeBootOverlay();
        renderDash();buildScopeGrid();
        supaSetStatus('local');
        supaShowLogin();
      }
    }
    _supa.auth.onAuthStateChange(async(event,session)=>{
      if(event==='SIGNED_IN'){
        // Suppress during onboarding — obSubmit handles its own flow
        if(window._obInProgress){return;}
        // TOKEN_REFRESHED in Supabase v2 can fire as SIGNED_IN — never reload cloud data
        // on a background token refresh; only load once per page session on explicit sign-in
        if(_supaCloudLoaded && _supaUser && session.user.id===_supaUser.id){return;}
        if(_supaCloudLoaded && _supaUser && session.user.id!==_supaUser.id){
          // Different user signed in on same device — full reset before loading their data
          _supaCloudLoaded=false;_mergeOnSignIn=false;_realtimeSubscribed=false;_loadInProgress=false;
          clearTimeout(_syncTimer);_syncTimer=null;
          _devSupportMode=false;_devSupportName='';_devSavedState=null;
        }
        _supaUser=session.user;
        _saveSessionBackup(session);
        document.getElementById('supa-login-overlay')?.remove();
        document.getElementById('welcome-overlay')?.remove();
        const hasAccount=await loadAccountData();
        if(hasAccount){
          // Trigger merge path if _mergeOnSignIn is set OR if zp3_offline_pending exists.
          // The flag may be false after a force-quit restart even if there is pending data —
          // checking the key directly means no offline record is ever silently dropped.
          const _hasPendingData=!!localStorage.getItem('zp3_offline_pending');
          if(_mergeOnSignIn||_hasPendingData){
            _mergeOnSignIn=false;
            const _op=(() => {try{return JSON.parse(localStorage.getItem('zp3_offline_pending')||'null');}catch(_e){return null;}})();
            // Deduplicate by ID across in-memory + pending — saveAll() writes all current
            // clients to pending, so without dedup the same record appears in both arrays
            // and gets pushed twice when neither ID is yet in the cloud.
            const _oClients=[...new Map([...(_op?.clients||[]),...clients].map(c=>[c.id,c])).values()];
            const _oBids=[...new Map([...(_op?.bids||[]),...bids].map(b=>[b.id,b])).values()];
            const _oJobs=[...new Map([...(_op?.jobs||[]),...jobs].map(j=>[j.id,j])).values()];
            localStorage.removeItem('zp3_offline_pending');
            await supaLoadFromCloud(); // non-silent: sets up timers, renders, navigates
            // Merge offline additions that aren't already in cloud data
            const _cSet=new Set(clients.map(c=>c.id));
            const _bSet=new Set(bids.map(b=>b.id));
            const _jSet=new Set(jobs.map(j=>j.id));
            let _merged=false;
            _oClients.filter(c=>!_cSet.has(c.id)).forEach(c=>{clients.push(c);_merged=true;});
            _oBids.filter(b=>!_bSet.has(b.id)).forEach(b=>{bids.push(b);_merged=true;});
            _oJobs.filter(j=>!_jSet.has(j.id)).forEach(j=>{jobs.push(j);_merged=true;});
            if(_merged){await _flushSaveNow();renderDash();}
            goPg('pg-dash'); // ensure we land on home whether cloud load succeeded or fell back to cache
            typeof _drainHubQueue==='function'&&_drainHubQueue();
            typeof _drainPhotoQueue==='function'&&_drainPhotoQueue();
          } else {
            await supaLoadFromCloud();
            goPg('pg-dash');
          }
        } else {
          _removeBootOverlay();
          renderDash();buildScopeGrid();
          supaSetStatus('cloud');
          goPg('pg-dash');
        }
      } else if(event==='TOKEN_REFRESHED'){
        // Token silently refreshed — update user ref. If we were in offline/cache mode,
        // this is the signal that we're back online with a valid session; sync now.
        if(session){
          _supaUser=session.user;
          _saveSessionBackup(session);
          if(!_supaCloudLoaded||_loadedFromCacheOnly||_mergeOnSignIn)_onReconnect();
        }
        return;
      } else if(event==='INITIAL_SESSION'){
        if(session){_supaUser=session.user;_saveSessionBackup(session);}
        return;
      } else if(event==='SIGNED_OUT'){
        _supaUser=null;_user=null;_account=null;_config=null;
        // Only wipe local data when the user explicitly clicked sign out.
        // Supabase fires SIGNED_OUT on token refresh failures too (e.g. offline, network blip).
        // navigator.onLine is unreliable on iOS — don't use it. Always prefer cache.
        if(_deliberateSignOut){
          clearTimeout(_syncTimer);_syncTimer=null; // prevent a live timer from flushing emptied arrays
          _supaCloudLoaded=false;_realtimeSubscribed=false;_loadInProgress=false;clearTimeout(_broadcastReloadTimer);_broadcastReloadTimer=null;
          clients=[];bids=[];jobs=[];payments=[];income=[];expenses=[];mileage=[];liens=[];
          S={...S,bname:'',bphone:'',blic:'',bemail:'',vehicles:[],weatherLat:null,weatherLon:null,locationDenied:false};
          saveAll();
          _deliberateSignOut=false;
          supaSetStatus('local');
          supaShowLogin({force:true});
        } else if(localStorage.getItem('zp3_cloud_cache')){
          // Non-deliberate sign-out (token refresh failure or rotation) — keep data in memory.
          // Stop autoRefresh immediately so Supabase doesn't keep retrying offline and
          // firing SIGNED_OUT in a loop. _startOfflineWatcher's online handler restarts it.
          if(_supa)_supa.auth.stopAutoRefresh();
          // autoRefreshToken fires TOKEN_REFRESHED within ms if it was just a rotation.
          // Delay the banner 1s so routine rotations don't cause a visible flash.
          _loadedFromCacheOnly=true;
          _mergeOnSignIn=true;
          supaSetStatus('error');
          clearTimeout(window._offlineBannerTimer);
          window._offlineBannerTimer=setTimeout(()=>{if(_mergeOnSignIn&&!_supaUser)_showOfflineBanner();},3000);
        } else {
          supaSetStatus('local');
          supaShowLogin();
        }
      }
    });
    _startOfflineWatcher();
  }catch(e){
    console.warn('Supabase init failed:',e);
    // Even if Supabase itself won't init (e.g. no network), try serving from cache
    const _cc=localStorage.getItem('zp3_cloud_cache');
    if(_cc){
      try{
        const _cd=JSON.parse(_cc);
        clients=_cd.clients||[];bids=_cd.bids||[];jobs=_cd.jobs||[];
        payments=_cd.payments||[];income=_cd.income||[];expenses=_cd.expenses||[];
        mileage=_cd.mileage||[];liens=_cd.liens||[];timeEntries=_cd.timeEntries||[];
        if(_cd.licenses?.length)licenses=_cd.licenses;
        if(_cd.events?.length)events=_cd.events;
        if(_cd.contracts?.length)contracts=_cd.contracts;
        if(_cd.photos?.length)photos=_cd.photos;
        if(_cd.checksState&&Object.keys(_cd.checksState).length)checksState=_cd.checksState;
        if(_cd.settings){S={...S,..._cd.settings};applySettings();loadSettingsForm();}
        _mergeOfflinePendingToMemory(); // surface any records not yet pushed to cloud
        _supaCloudLoaded=true;
        _loadedFromCacheOnly=true;
        _removeBootOverlay();renderDash();buildScopeGrid();
        _showOfflineBanner();
        supaSetStatus('error');
        return;
      }catch(_ce){}
    }
    _removeBootOverlay();
    renderDash();buildScopeGrid();
    supaSetStatus('local');
  }
}

// ══════════════════════════════════════════════════════════════════
// TEAM & FLEET MANAGEMENT
// ══════════════════════════════════════════════════════════════════
const PERM_LABELS={canEstimate:'Estimate jobs',canSchedule:'Schedule jobs',canSeeFinancials:'View financials',canEditClients:'Edit clients',canManageTeam:'Manage team'};
const ROLE_COLORS={owner:'#185FA5',painter:'#3B6D11',estimator:'#8B4513'};
const ROLE_BG={owner:'#EBF2FB',painter:'#EAF3DE',estimator:'#FFF0E0'};

function _initDeviceId(){
  let id=localStorage.getItem('zp3_device_id');
  if(!id){id='dev_'+Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2);localStorage.setItem('zp3_device_id',id);}
  return id;
}
function _deviceLabel(){
  const ua=navigator.userAgent;
  if(/iPad/.test(ua))return'iPad';
  if(/iPhone/.test(ua))return'iPhone';
  if(/Android.*Tablet|Android.*SM-T/i.test(ua))return'Android Tablet';
  if(/Android/i.test(ua))return'Android';
  if(/Macintosh/.test(ua))return'Mac';
  if(/Windows/.test(ua))return'Windows PC';
  return'Device';
}
function registerDevice(updateLocation){
  const id=_initDeviceId();
  const label=_deviceLabel();
  const now=new Date().toISOString();
  if(!S.devices)S.devices=[];
  const idx=S.devices.findIndex(d=>d.id===id);
  if(idx>-1){S.devices[idx].lastSeen=now;S.devices[idx].label=label;}
  else S.devices.push({id,label,lastSeen:now,addedAt:now});
  saveSettings();
  // Capture GPS if explicitly requested or first time registering
  if(updateLocation||idx===-1){
    geoIfGranted(pos=>{
      const devIdx=S.devices.findIndex(d=>d.id===id);
      if(devIdx>-1){
        S.devices[devIdx].lat=pos.coords.latitude;
        S.devices[devIdx].lon=pos.coords.longitude;
        S.devices[devIdx].locAt=now;
        saveSettings();
        const tpl=document.getElementById('team-page-devices');
        const tsl=document.getElementById('device-list');
        if(tpl||tsl)renderTeam();
      }
    });
  }
}
function renderTeam(){
  const el=document.getElementById('team-list');
  const el2=document.getElementById('team-page-list');
  if(!el&&!el2)return;
  const emps=S.employees||[];
  const empHtml=!emps.length
    ?'<div style="font-size:12px;color:var(--text3);padding:6px 0">No team members yet — just you. Add someone when you hire.</div>'
    :emps.map((e,i)=>{
      const rc=ROLE_COLORS[e.role]||'var(--text2)';const rb=ROLE_BG[e.role]||'var(--bg2)';
      const perms=Object.entries(e.permissions||{}).filter(([,v])=>v).map(([k])=>PERM_LABELS[k]||k).join(', ')||'No permissions';
      return '<div style="padding:10px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);margin-bottom:8px">'+
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px">'+
          '<div style="display:flex;align-items:center;gap:8px">'+
            '<div style="width:34px;height:34px;border-radius:50%;background:'+rc+';display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:14px;flex-shrink:0">'+e.name.charAt(0).toUpperCase()+'</div>'+
            '<div><div style="font-size:13px;font-weight:700">'+e.name+'</div>'+
            '<span style="font-size:10px;font-weight:700;background:'+rb+';color:'+rc+';padding:1px 7px;border-radius:8px;text-transform:capitalize">'+e.role+'</span></div>'+
          '</div>'+
          (e.role!=='owner'?'<button onclick="openEditEmployeeModal('+i+')" style="font-size:11px;padding:4px 10px;border-radius:var(--r);border:1px solid var(--border2);background:none;cursor:pointer;font-family:inherit">Edit</button>':'')+
        '</div>'+
        (e.phone?'<div style="font-size:11px;color:var(--text3);margin-top:4px">📞 '+e.phone+'</div>':'')+
        (e.email?'<div style="font-size:11px;color:var(--text3);margin-top:3px">📧 '+e.email+' <span style="font-size:9px;font-weight:700;background:#dcfce7;color:#15803d;padding:1px 5px;border-radius:6px">Invite sent</span></div>':'')+
        '<div style="font-size:10px;color:var(--text3);margin-top:4px;line-height:1.5">'+perms+'</div>'+
      '</div>';
    }).join('');
  if(el)el.innerHTML=empHtml;
  if(el2)el2.innerHTML=empHtml;
  // Devices
  const devs=S.devices||[];
  const myId=_initDeviceId();
  const devHtml=!devs.length?'<div style="font-size:11px;color:var(--text3)">No devices registered yet.</div>':devs.map(d=>{
    const isMe=d.id===myId;
    const ago=d.lastSeen?_timeAgo(d.lastSeen):'never';
    const isActive=d.lastSeen&&(Date.now()-new Date(d.lastSeen).getTime())<3600000;
    const hasLoc=d.lat&&d.lon;
    const mapUrl=hasLoc?'https://www.google.com/maps?q='+d.lat+','+d.lon:'';
    const locAgo=hasLoc&&d.locAt?_timeAgo(d.locAt):'';
    return '<div style="padding:10px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);margin-bottom:8px'+(hasLoc?';cursor:pointer':'')+'" '+(hasLoc?'onclick="window.open(\''+mapUrl+'\',\'_blank\')"':'')+'>'+
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px">'+
        '<div style="display:flex;align-items:center;gap:10px">'+
          '<div style="font-size:22px">'+(d.label==='iPad'||d.label==='iPhone'?'📱':'💻')+'</div>'+
          '<div>'+
            '<div style="font-size:13px;font-weight:700">'+d.label+(isMe?' <span style="font-size:9px;background:var(--blue);color:#fff;padding:1px 6px;border-radius:8px">This device</span>':'')+'</div>'+
            '<div style="font-size:10px;color:'+(isActive?'var(--green-mid)':'var(--text3)')+'">'+
              (isActive?'🟢 Active':'⚪ Last seen '+ago)+'</div>'+
            (hasLoc?'<div style="font-size:10px;color:var(--blue);margin-top:1px">📍 Tap to view on map · '+locAgo+'</div>':'')+
          '</div>'+
        '</div>'+
        '<div style="display:flex;gap:6px;align-items:center">'+
          (hasLoc?'<span style="font-size:11px;font-weight:700;background:var(--blue-lt);color:var(--blue);border:1px solid var(--blue);border-radius:var(--r);padding:5px 10px;white-space:nowrap">🗺 Map</span>':'')+
          (!isMe?'<button onclick="event.stopPropagation();removeDevice(\''+d.id+'\')" style="font-size:10px;color:#A32D2D;border:1px solid #A32D2D;border-radius:var(--r);padding:5px 8px;background:none;cursor:pointer;font-family:inherit">Remove</button>':'')+
        '</div>'+
      '</div>'+
    '</div>';
  }).join('');
  const del=document.getElementById('device-list');if(del)del.innerHTML=devHtml;
  const del2=document.getElementById('team-page-devices');if(del2)del2.innerHTML=devHtml;
  // Subcontractors
  const subs=S.subcontractors||[];
  const subEl=document.getElementById('team-page-subs');
  if(subEl){
    subEl.innerHTML=!subs.length
      ?'<div style="font-size:12px;color:var(--text3);padding:6px 0">No subs yet. Add a subcontractor to assign them to jobs and track what you owe.</div>'
      :subs.map((s,i)=>
          '<div style="padding:10px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);margin-bottom:8px">'+
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px">'+
              '<div style="display:flex;align-items:center;gap:8px">'+
                '<div style="width:34px;height:34px;border-radius:50%;background:var(--amber);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:14px;flex-shrink:0">'+(s.name||'?').charAt(0).toUpperCase()+'</div>'+
                '<div>'+
                  '<div style="font-size:13px;font-weight:700">'+escHtml(s.name||'')+'</div>'+
                  (s.trade?'<div style="font-size:11px;color:var(--text3)">'+escHtml(s.trade)+'</div>':'')+
                '</div>'+
              '</div>'+
              '<button onclick="openEditSubModal('+i+')" style="font-size:11px;padding:4px 10px;border-radius:var(--r);border:1px solid var(--border2);background:none;cursor:pointer;font-family:inherit">Edit</button>'+
            '</div>'+
            (s.phone?'<div style="font-size:11px;color:var(--text3);margin-top:4px">📞 '+escHtml(s.phone)+'</div>':'')+
            (s.rate?'<div style="font-size:11px;color:var(--text3);margin-top:2px">💰 '+escHtml(s.rate)+'</div>':'')+
          '</div>'
        ).join('');
  }
}
function _timeAgo(iso){
  const ms=Date.now()-new Date(iso).getTime();
  if(ms<60000)return'just now';
  if(ms<3600000)return Math.round(ms/60000)+'m ago';
  if(ms<86400000)return Math.round(ms/3600000)+'h ago';
  return Math.round(ms/86400000)+'d ago';
}
function removeDevice(id){
  S.devices=(S.devices||[]).filter(d=>d.id!==id);
  saveSettings();renderTeam();
}
function _employeeModalHTML(emp,idx){
  const isNew=idx==null;
  const e=emp||{name:'',role:'painter',phone:'',email:'',permissions:{canEstimate:true,canSchedule:true,canSeeFinancials:false,canEditClients:true,canManageTeam:false}};
  return '<div style="font-size:17px;font-weight:800;margin-bottom:14px">'+(isNew?'Add team member':'Edit '+e.name)+'</div>'+
    '<div class="fg fg2" style="margin-bottom:12px">'+
      '<div class="f"><label>Full name</label><input id="emp-name" value="'+(e.name||'')+'" placeholder="John Smith" style="font-size:15px;padding:10px"></div>'+
      '<div class="f"><label>Phone</label><input id="emp-phone" type="tel" value="'+(e.phone||'')+'" placeholder="XXX-XXX-XXXX" maxlength="12" oninput="fmtPhone(this)" style="font-size:15px;padding:10px"></div>'+
    '</div>'+
    '<div class="f" style="margin-bottom:12px"><label>Email (for app access)</label>'+
      '<input id="emp-email" type="email" value="'+(e.email||'')+'" placeholder="employee@email.com" style="font-size:14px;padding:10px">'+
      '<div style="font-size:10px;color:var(--text3);margin-top:4px">Enter their email then tap "Send Invite" — they\'ll get a sign-in link and see your jobs, clients, and estimates.</div>'+
    '</div>'+
    '<div class="f" style="margin-bottom:12px"><label>Role</label>'+
      '<select id="emp-role" style="font-size:14px;padding:10px">'+
        '<option value="employee"'+((!e.role||e.role==='employee')?' selected':'')+'>Field employee</option>'+
        '<option value="estimator"'+(e.role==='estimator'?' selected':'')+'>Estimator</option>'+
        '<option value="foreman"'+(e.role==='foreman'?' selected':'')+'>Foreman</option>'+
        '<option value="painter"'+(e.role==='painter'?' selected':'')+'>Painter</option>'+
        '<option value="owner"'+(e.role==='owner'?' selected':'')+'>Owner / Co-owner</option>'+
      '</select>'+
    '</div>'+
    '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:8px">Permissions</div>'+
    '<div style="display:grid;gap:6px;margin-bottom:14px">'+
      Object.entries(PERM_LABELS).map(([k,lbl])=>{
        const checked=e.permissions&&e.permissions[k];
        return '<label style="display:flex;align-items:center;gap:10px;font-size:13px;cursor:pointer;padding:8px;background:var(--bg2);border-radius:var(--r)">'+
          '<input type="checkbox" id="emp-p-'+k+'"'+(checked?' checked':'')+' style="width:16px;height:16px;cursor:pointer">'+lbl+'</label>';
      }).join('')+
    '</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'+
      (!isNew?'<button onclick="removeEmployee('+idx+')" style="padding:10px;border-radius:var(--r);border:1px solid #A32D2D;background:none;color:#A32D2D;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">Remove</button>':'<div></div>')+
      '<button onclick="_saveEmployee('+(isNew?'null':idx)+')" style="padding:10px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">'+(isNew?'Add & Invite':'Save')+'</button>'+
    '</div>'+
    '<button onclick="document.getElementById(\'emp-modal-overlay\').remove()" style="width:100%;padding:8px;border:none;background:none;color:var(--text3);font-size:12px;cursor:pointer;font-family:inherit;margin-top:6px">Cancel</button>';
}
function openAddEmployeeModal(){
  _openEmpModal(null,null);
}
function openEditEmployeeModal(idx){
  const e=(S.employees||[])[idx];
  _openEmpModal(e,idx);
}
function _openEmpModal(emp,idx){
  document.getElementById('emp-modal-overlay')?.remove();
  const ov=document.createElement('div');ov.id='emp-modal-overlay';ov.className='zmodal-overlay';
  const box=document.createElement('div');box.className='zmodal';
  box.innerHTML=_employeeModalHTML(emp,idx);
  ov.appendChild(box);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  setTimeout(()=>document.getElementById('emp-name')?.focus(),100);
}
async function _saveEmployee(idx){
  const name=document.getElementById('emp-name')?.value?.trim();
  if(!name){zAlert('Enter a name.');return;}
  const email=(document.getElementById('emp-email')?.value?.trim()||'').toLowerCase();
  const perms={};
  Object.keys(PERM_LABELS).forEach(k=>{perms[k]=!!(document.getElementById('emp-p-'+k)?.checked);});
  const isNew=idx==null;
  const emp={id:isNew?Date.now():(S.employees[idx]?.id||Date.now()),name,email,role:document.getElementById('emp-role')?.value||'employee',phone:document.getElementById('emp-phone')?.value?.trim()||'',permissions:perms};
  if(!S.employees)S.employees=[];
  if(!isNew)S.employees[idx]=emp;else S.employees.push(emp);
  saveSettings();document.getElementById('emp-modal-overlay')?.remove();renderTeam();
  // Sync to Supabase team_members and send invite if email provided
  if(email&&_supa&&_supaUser){
    const tmRow={contractor_user_id:_supaUser.id,email,name,role:emp.role,active:false,invited_at:new Date().toISOString()};
    const{error}=await _supa.from('team_members').upsert(tmRow,{onConflict:'contractor_user_id,email'});
    if(error){console.warn('team_members upsert failed:',error);return;}
    // Send magic-link invite
    if(isNew){
      const{error:invErr}=await _supa.auth.signInWithOtp({email,options:{shouldCreateUser:true,emailRedirectTo:window.location.origin}});
      if(invErr)showToast('Saved — invite email failed: '+invErr.message,'⚠️');
      else showToast('Invite sent to '+email,'📧');
    }
  }
}
function removeEmployee(idx){
  if(!S.employees)return;
  S.employees.splice(idx,1);
  saveSettings();document.getElementById('emp-modal-overlay')?.remove();renderTeam();
}

// ── Subcontractor management ─────────────────────────────────────────────────
function _subModalHTML(sub,idx){
  const isNew=idx==null;
  const s=sub||{name:'',trade:'',phone:'',email:'',rate:''};
  return '<div style="font-size:17px;font-weight:800;margin-bottom:14px">'+(isNew?'Add subcontractor':'Edit '+escHtml(s.name||'Sub'))+'</div>'+
    '<div class="fg fg2" style="margin-bottom:12px">'+
      '<div class="f"><label>Full name</label><input id="sub-name" value="'+escHtml(s.name||'')+'" placeholder="Mike Garcia" style="font-size:15px;padding:10px"></div>'+
      '<div class="f"><label>Trade</label><input id="sub-trade" value="'+escHtml(s.trade||'')+'" placeholder="Drywall, Electrical, Plumbing..." style="font-size:14px;padding:10px"></div>'+
    '</div>'+
    '<div class="fg fg2" style="margin-bottom:12px">'+
      '<div class="f"><label>Phone</label><input id="sub-phone" type="tel" value="'+escHtml(s.phone||'')+'" placeholder="XXX-XXX-XXXX" maxlength="12" oninput="fmtPhone(this)" style="font-size:15px;padding:10px"></div>'+
      '<div class="f"><label>Email</label><input id="sub-email" type="email" value="'+escHtml(s.email||'')+'" placeholder="sub@email.com" style="font-size:14px;padding:10px"></div>'+
    '</div>'+
    '<div class="f" style="margin-bottom:16px"><label>Rate / notes</label>'+
      '<input id="sub-rate" value="'+escHtml(s.rate||'')+'" placeholder="e.g. $45/hr or $800 per room" style="font-size:14px;padding:10px">'+
    '</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'+
      (!isNew?'<button onclick="_removeSub('+idx+')" style="padding:10px;border-radius:var(--r);border:1px solid #A32D2D;background:none;color:#A32D2D;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">Remove</button>':'<div></div>')+
      '<button onclick="_saveSub('+(isNew?'null':idx)+')" style="padding:10px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">'+(isNew?'Add':'Save')+'</button>'+
    '</div>'+
    '<button onclick="document.getElementById(\'_sub-modal-ov\').remove()" style="width:100%;padding:8px;border:none;background:none;color:var(--text3);font-size:12px;cursor:pointer;font-family:inherit;margin-top:6px">Cancel</button>';
}
function openAddSubModal(){_openSubModal(null,null);}
function openEditSubModal(idx){_openSubModal((S.subcontractors||[])[idx],idx);}
function _openSubModal(sub,idx){
  document.getElementById('_sub-modal-ov')?.remove();
  const ov=document.createElement('div');ov.id='_sub-modal-ov';ov.className='zmodal-overlay';
  const box=document.createElement('div');box.className='zmodal';
  box.innerHTML=_subModalHTML(sub,idx);
  ov.appendChild(box);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  setTimeout(()=>document.getElementById('sub-name')?.focus(),100);
}
function _saveSub(idx){
  const name=(document.getElementById('sub-name')?.value||'').trim();
  if(!name)return showToast('Enter a name','⚠️');
  const sub={id:idx==null?Date.now():((S.subcontractors||[])[idx]?.id||Date.now()),name,trade:(document.getElementById('sub-trade')?.value||'').trim(),phone:(document.getElementById('sub-phone')?.value||'').trim(),email:(document.getElementById('sub-email')?.value||'').trim(),rate:(document.getElementById('sub-rate')?.value||'').trim()};
  if(!S.subcontractors)S.subcontractors=[];
  if(idx==null)S.subcontractors.push(sub);else S.subcontractors[idx]=sub;
  saveSettings();document.getElementById('_sub-modal-ov')?.remove();renderTeam();
  showToast(idx==null?'Subcontractor added':'Saved','✓');
}
function _removeSub(idx){
  if(!S.subcontractors)return;
  S.subcontractors.splice(idx,1);
  saveSettings();document.getElementById('_sub-modal-ov')?.remove();renderTeam();
}

// ══════════════════════════════════════════════════════════════════
// HIRING READINESS CALCULATOR
// ══════════════════════════════════════════════════════════════════
function renderHiringCalc(){
  const el=document.getElementById('hiring-calc-root');if(!el)return;

  // Pull trailing 90-day financials
  const cutoff=addDays(todayKey(),-90);
  const rev90=income.filter(r=>r.date>=cutoff).reduce((s,r)=>s+(r.amount||0),0);
  const exp90=expenses.filter(e=>e.date>=cutoff).reduce((s,e)=>s+(e.amount||0),0);
  const profit90=Math.max(0,rev90-exp90);
  const monthlyProfit=Math.round(profit90/3);
  const monthlyRev=Math.round(rev90/3);

  // W-2 cost model — painter wages $18-30/hr typical in KS
  const targetHr=parseInt(el.dataset.hr||22);
  const annualGross=targetHr*2080;
  const empFICA=Math.round(annualGross*0.0765);
  const futa=Math.min(420,Math.round(annualGross*0.06));
  const suta=Math.min(700,Math.round(annualGross*0.035));
  const workersComp=Math.round(annualGross*0.072); // ~$7.20/$100 payroll for KS painting
  const health=6000; // $500/mo employer contribution (conservative)
  const retirement=Math.round(annualGross*0.03); // 3% 401k match
  const misc=1200; // tools, uniform, training
  const totalAnnual=annualGross+empFICA+futa+suta+workersComp+health+retirement+misc;
  const totalMonthly=Math.round(totalAnnual/12);
  const effectiveRate=Math.round(totalAnnual/annualGross*100);

  // Hiring readiness signal
  const ratio=monthlyProfit>0?monthlyProfit/totalMonthly:0;
  let signal,sigColor,sigBg,advice;
  if(ratio>=2.5){
    signal='🟢 Ready to hire';sigColor='#1a7340';sigBg='#EAF3DE';
    advice='Your profit covers the full cost of a W-2 employee '+ratio.toFixed(1)+'x over. You have the buffer to hire, train, and absorb slow months.';
  }else if(ratio>=1.5){
    signal='🟡 Getting close';sigColor='#856404';sigBg='#FEF3C7';
    advice='You could technically afford it, but the margin is thin. One slow month could put you in the red. Aim to grow monthly profit to '+fmt(Math.round(totalMonthly*2.5))+' before hiring.';
  }else{
    signal='🔴 Not yet';sigColor='#A32D2D';sigBg='#FEE8E8';
    advice='Monthly profit of '+fmt(monthlyProfit)+' doesn\'t cover the '+fmt(totalMonthly)+'/mo cost of a W-2 hire. You need '+fmt(Math.round(totalMonthly*2.5))+'/mo profit to hire safely.';
  }

  // How many extra jobs/month needed
  const avgJobVal=bids.filter(b=>b.status==='Closed Won').reduce((s,b,_,a)=>s+(b.amount||0)/(a.length||1),0)||2500;
  const avgProfit=avgJobVal*(S.margin||40)/100;
  const jobsNeeded=avgProfit>0?Math.ceil(totalMonthly*1.5/avgProfit):0;

  el.innerHTML=
    '<div class="card">'+
      '<div style="font-size:17px;font-weight:800;margin-bottom:2px">Hiring readiness</div>'+
      '<div style="font-size:12px;color:var(--text3);margin-bottom:14px">Based on your last 90 days — W-2 employee full cost model</div>'+

      // Status banner
      '<div style="background:'+sigBg+';border-radius:var(--r);padding:14px;margin-bottom:14px">'+
        '<div style="font-size:16px;font-weight:800;color:'+sigColor+';margin-bottom:4px">'+signal+'</div>'+
        '<div style="font-size:12px;color:'+sigColor+';line-height:1.6">'+advice+'</div>'+
      '</div>'+

      // Wage slider
      '<div style="margin-bottom:14px">'+
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'+
          '<label style="font-size:12px;font-weight:700;color:var(--text2)">Target wage</label>'+
          '<span id="hiring-hr-disp" style="font-size:16px;font-weight:800;color:var(--blue)">$'+targetHr+'/hr</span>'+
        '</div>'+
        '<input type="range" min="15" max="35" step="1" value="'+targetHr+'" id="hiring-hr-slider"'+
        ' oninput="document.getElementById(\'hiring-hr-disp\').textContent=\'$\'+this.value+\'/hr\'"'+
        ' onchange="document.getElementById(\'hiring-calc-root\').dataset.hr=this.value;renderHiringCalc()"'+
        ' style="width:100%;accent-color:var(--blue)">'+
        '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text3);margin-top:2px"><span>$15/hr</span><span>$35/hr</span></div>'+
      '</div>'+

      // Cost breakdown
      '<div style="background:var(--bg2);border-radius:var(--r);border:1px solid var(--border);padding:12px;margin-bottom:14px">'+
        '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:10px">True W-2 cost breakdown</div>'+
        _hiringRow('Gross wages ('+targetHr+'/hr × 2,080 hrs)',annualGross,true)+
        _hiringRow('Employer FICA (7.65%)',empFICA,false)+
        _hiringRow('Federal unemployment (FUTA)',futa,false)+
        _hiringRow('State unemployment (SUTA)',suta,false)+
        _hiringRow('Workers comp (painting ~7.2%)',workersComp,false)+
        _hiringRow('Health insurance (employer share)',health,false)+
        _hiringRow('401k match (3%)',retirement,false)+
        _hiringRow('Tools, uniform, training',misc,false)+
        '<div style="border-top:2px solid var(--border);margin-top:8px;padding-top:8px;display:flex;justify-content:space-between">'+
          '<span style="font-size:13px;font-weight:800">Total annual cost</span>'+
          '<span style="font-size:13px;font-weight:800;color:#A32D2D">'+fmt(totalAnnual)+'</span>'+
        '</div>'+
        '<div style="font-size:11px;color:var(--text3);margin-top:4px">= '+fmt(totalMonthly)+'/mo · '+effectiveRate+'% above base wage</div>'+
      '</div>'+

      // Your numbers
      '<div style="background:var(--bg2);border-radius:var(--r);border:1px solid var(--border);padding:12px;margin-bottom:14px">'+
        '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:10px">Your last 90 days</div>'+
        _hiringRow('Avg monthly revenue',monthlyRev,true)+
        _hiringRow('Avg monthly expenses',Math.round(exp90/3),false)+
        '<div style="border-top:2px solid var(--border);margin:8px 0;padding-top:8px;display:flex;justify-content:space-between">'+
          '<span style="font-size:13px;font-weight:800">Avg monthly profit</span>'+
          '<span style="font-size:13px;font-weight:800;color:'+(monthlyProfit>0?'var(--green-mid)':'#A32D2D')+'">'+fmt(monthlyProfit)+'</span>'+
        '</div>'+
        '<div style="font-size:11px;color:var(--text3)">Profit covers employee cost '+ratio.toFixed(1)+'x · need 2.5x to hire safely</div>'+
        (jobsNeeded>0?'<div style="font-size:11px;color:var(--blue);margin-top:4px;font-weight:600">Need ~'+jobsNeeded+' more jobs/month to hire comfortably (at avg '+fmt(Math.round(avgJobVal))+' job value)</div>':'')+
      '</div>'+

      // W-2 vs 1099
      '<div style="background:var(--bg2);border-radius:var(--r);border:1px solid var(--border);padding:12px">'+
        '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:10px">W-2 vs 1099 — the real talk</div>'+
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'+
          '<div style="padding:10px;background:#EAF3DE;border-radius:var(--r)">'+
            '<div style="font-size:11px;font-weight:800;color:var(--green-mid);margin-bottom:6px">✅ W-2 Employee</div>'+
            '<div style="font-size:10px;color:var(--text2);line-height:1.7">You control their hours &amp; methods<br>Build real team culture<br>Workers comp covers injuries<br>Loyalty + retention<br>Easier to train your way<br>Qualifies for benefits</div>'+
          '</div>'+
          '<div style="padding:10px;background:#FEE8E8;border-radius:var(--r)">'+
            '<div style="font-size:11px;font-weight:800;color:#A32D2D;margin-bottom:6px">⚠️ 1099 "Copout"</div>'+
            '<div style="font-size:10px;color:var(--text2);line-height:1.7">IRS misclassification risk<br>YOU may be liable for injuries<br>Worker pays 15.3% FICA<br>No control over their methods<br>Harder to enforce standards<br>Damages trust &amp; culture</div>'+
          '</div>'+
        '</div>'+
        '<div style="font-size:11px;color:var(--text3);margin-top:10px;line-height:1.7">'+
          '<strong>Bottom line:</strong> 1099 saves money short-term but IRS can reclassify workers who follow your schedule, use your tools, and work only for you. Penalties are severe. Do it right with W-2 from day one.'+
        '</div>'+
      '</div>'+
    '</div>';
}
function _hiringRow(label,amount,isGross){
  return '<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border);font-size:12px">'+
    '<span style="color:var(--text2)">'+(isGross?'<strong>':'')+label+(isGross?'</strong>':'')+'</span>'+
    '<span style="font-weight:'+(isGross?'800':'600')+';color:'+(isGross?'var(--text)':'var(--text2)')+'">'+fmt(amount)+'/yr</span>'+
  '</div>';
}

// Merge any records written to zp3_offline_pending into the current in-memory arrays.
// Called after every cache load so a force-quit mid-session never hides data from the user.
// Does NOT remove the key — it stays until a successful cloud push clears it (line ~1411).
function _mergeOfflinePendingToMemory(){
  try{
    const _op=JSON.parse(localStorage.getItem('zp3_offline_pending')||'null');
    if(!_op)return;
    const _cSet=new Set(clients.map(c=>c.id));
    const _bSet=new Set(bids.map(b=>b.id));
    const _jSet=new Set(jobs.map(j=>j.id));
    (_op.clients||[]).filter(c=>!_cSet.has(c.id)).forEach(c=>clients.push(c));
    (_op.bids||[]).filter(b=>!_bSet.has(b.id)).forEach(b=>bids.push(b));
    (_op.jobs||[]).filter(j=>!_jSet.has(j.id)).forEach(j=>jobs.push(j));
  }catch(_e){}
}
function _enterOfflineMode(){
  document.getElementById('supa-login-overlay')?.remove();
  // Load from cache so the app has real data, not an empty shell
  const _cc=localStorage.getItem('zp3_cloud_cache');
  if(_cc){
    try{
      const _cd=JSON.parse(_cc);
      clients=_cd.clients||[];bids=_cd.bids||[];jobs=_cd.jobs||[];
      payments=_cd.payments||[];income=_cd.income||[];expenses=_cd.expenses||[];
      mileage=_cd.mileage||[];liens=_cd.liens||[];timeEntries=_cd.timeEntries||[];
      if(_cd.licenses?.length)licenses=_cd.licenses;
      if(_cd.events?.length)events=_cd.events;
      if(_cd.contracts?.length)contracts=_cd.contracts;
      if(_cd.photos?.length)photos=_cd.photos;
      if(_cd.checksState&&Object.keys(_cd.checksState).length)checksState=_cd.checksState;
      if(_cd.settings){S={...S,..._cd.settings};applySettings();loadSettingsForm();}
    }catch(_ce){}
  }
  _mergeOfflinePendingToMemory(); // show any records created since the last cloud sync
  _loadedFromCacheOnly=true;
  _mergeOnSignIn=true; // merge any new records entered here when SIGNED_IN fires
  _removeBootOverlay();renderDash();buildScopeGrid();
  goPg('pg-dash'); // always land on home, not whatever page the login overlay sat on top of
  _showOfflineBanner();
  // Immediately probe for connection so re-auth fires without waiting for the 5s tick
  setTimeout(()=>_probeAndSync(),500);
}
function supaShowLogin(opts={}){
  if(!supaEnabled())return;
  // Never interrupt the user with a login screen if they have a session backup
  // (setSession() will silently re-auth on the next connection probe) or cached data
  // (the app is fully usable offline). Only bypass this guard when _deliberateSignOut
  // explicitly requested the login screen, or when the backup token has confirmed expired.
  if(!opts.force){
    if(localStorage.getItem('zp3_session_backup'))return;
    if(localStorage.getItem('zp3_cloud_cache'))return;
  }
  if(document.getElementById('supa-login-overlay'))return;
  const overlay=document.createElement('div');
  overlay.id='supa-login-overlay';
  overlay.style.cssText='position:fixed;inset:0;z-index:9999;background:var(--bg);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px';
  overlay.innerHTML=
    '<div style="max-width:360px;width:100%">'+
    '<div style="font-size:24px;font-weight:800;margin-bottom:4px">TradeDesk</div>'+
    '<div style="font-size:13px;color:var(--text3);margin-bottom:28px">Sign in to sync your data across devices</div>'+
    '<div class="f" style="margin-bottom:12px"><label>Email</label>'+
    '<input type="email" id="supa-email" placeholder="your@email.com" style="font-size:16px;padding:12px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);width:100%;box-sizing:border-box"></div>'+
    '<div class="f" style="margin-bottom:20px"><label>Password</label>'+
    '<input type="password" id="supa-pass" placeholder="Password" style="font-size:16px;padding:12px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);width:100%;box-sizing:border-box"></div>'+
    '<button onclick="supaSignIn()" style="width:100%;padding:14px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:10px">Sign in</button>'+
    '<div style="text-align:right;margin-bottom:10px"><button onclick="supaForgotPassword()" style="border:none;background:none;color:var(--blue);font-size:13px;cursor:pointer;font-family:inherit;padding:0;text-decoration:underline">Forgot password?</button></div>'+
    '<button onclick="document.getElementById(\'supa-login-overlay\').remove();showOnboarding()" style="width:100%;padding:12px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;margin-bottom:16px">Create account</button>'+
    '<button onclick="_enterOfflineMode()" style="width:100%;padding:10px;border:none;background:none;color:var(--text3);font-size:13px;cursor:pointer;font-family:inherit">Use offline (data stays on this device only)</button>'+
    '<div id="supa-login-err" style="font-size:12px;color:#A32D2D;margin-top:10px;text-align:center;min-height:16px"></div>'+
    '</div>';
  document.body.appendChild(overlay);
  setTimeout(()=>document.getElementById('supa-email')?.focus(),100);
}

async function supaSignIn(){
  const email=document.getElementById('supa-email')?.value?.trim();
  const pass=document.getElementById('supa-pass')?.value;
  const err=document.getElementById('supa-login-err');
  if(!email||!pass){if(err)err.textContent='Enter email and password.';return;}
  if(err)err.textContent='Signing in...';
  // Attempt real auth — on network failure (no HTTP status, or thrown exception),
  // enter offline mode automatically if we have cached data. This works on iOS where
  // navigator.onLine unreliably returns true even on airplane mode.
  let _authErr=null;
  try{const{error}=await _supa.auth.signInWithPassword({email,password:pass});_authErr=error;}
  catch(e){_authErr={status:0};}
  if(_authErr){
    if(!_authErr.status&&localStorage.getItem('zp3_cloud_cache')){_enterOfflineMode();return;}
    if(err)err.textContent=_authErr.message||'No internet connection.';
  }
}
async function supaForgotPassword(){
  const email=document.getElementById('supa-email')?.value?.trim();
  const err=document.getElementById('supa-login-err');
  if(!email){if(err){err.style.color='#A32D2D';err.textContent='Enter your email address above first.';}return;}
  if(err){err.style.color='var(--text3)';err.textContent='Sending reset link...';}
  const{error}=await _supa.auth.resetPasswordForEmail(email,{redirectTo:window.location.href});
  if(error){if(err){err.style.color='#A32D2D';err.textContent=error.message;}}
  else{if(err){err.style.color='#1a7340';err.textContent='Reset link sent — check your email.';}}
}
let _deliberateSignOut=false;
function _saveSessionBackup(session){
  if(!session)return;
  try{localStorage.setItem('zp3_session_backup',JSON.stringify({
    access_token:session.access_token,
    refresh_token:session.refresh_token
  }));}catch(_e){}
}
async function supaSignOut(){
  _deliberateSignOut=true;
  // scope:'local' clears this device only — refresh token stays valid server-side.
  // scope:'global' (the default) revokes the token on the server, so the backup key
  // can't be used to silently re-auth when the user comes back online.
  if(_supa)await _supa.auth.signOut({scope:'local'});
}

// ── Supabase Storage helpers for receipt photos ───────────────────────
async function _uploadReceiptToStorage(expenseId,b64){
  if(!_supa||!_supaUser||_isEmployee)return null;
  let targetUserId=_supaUser.id;
  if(_devSupportMode){
    const su=Object.values(_DEV_SUPPORT_USERS).find(u=>u.name===_devSupportName);
    if(!su)return null;
    targetUserId=su.userId;
  }
  const path=targetUserId+'/'+expenseId+'.jpg';
  const byteStr=atob(b64);
  const arr=new Uint8Array(byteStr.length);
  for(let i=0;i<byteStr.length;i++)arr[i]=byteStr.charCodeAt(i);
  const blob=new Blob([arr],{type:'image/jpeg'});
  const{error}=await _supa.storage.from('receipts').upload(path,blob,{contentType:'image/jpeg',upsert:true});
  if(error)throw error;
  return path;
}
async function _getReceiptSignedUrl(receiptKey,expiresIn=300){
  if(!_supa||!receiptKey)return null;
  const{data,error}=await _supa.storage.from('receipts').createSignedUrl(receiptKey,expiresIn);
  if(error)throw error;
  return data?.signedUrl||null;
}
async function _downloadReceiptAsDataUrl(receiptKey){
  if(!_supa||!receiptKey)return null;
  const{data,error}=await _supa.storage.from('receipts').download(receiptKey);
  if(error)throw error;
  return new Promise(resolve=>{const r=new FileReader();r.onload=e=>resolve(e.target.result);r.readAsDataURL(data);});
}
async function _deleteReceiptFromStorage(receiptKey){
  if(!_supa||!receiptKey)return;
  const{error}=await _supa.storage.from('receipts').remove([receiptKey]);
  if(error)throw error;
}
function supaSaveDebounced(){
  if(!supaEnabled())return;
  if(!_supaUser&&!_mergeOnSignIn)return;
  clearTimeout(_syncTimer);
  // Write the snapshot SYNCHRONOUSLY before starting the 2s timer.
  // This is the bulletproof force-quit safety net: iOS may kill the PWA process
  // before visibilitychange or the async catch block can run, but a synchronous
  // localStorage write completes atomically and survives any force-quit.
  // Cleared by supaSaveToCloud() on a successful push. Drain deduplicates on reload.
  if(_supaCloudLoaded||_mergeOnSignIn){
    try{localStorage.setItem('zp3_offline_pending',JSON.stringify({clients,bids,jobs,ts:Date.now()}));}catch(_e){}
  }
  _syncTimer=setTimeout(()=>{_syncTimer=null;supaSaveToCloud();},2000);
  if(_supaUser)supaSetStatus('syncing');
}
// Cancel the 2s debounce and push the full state to Supabase RIGHT NOW.
// Returns the in-flight save promise so callers can await it.
// Tracks the latest in-flight save in _pendingSavePromise so other code paths
// (e.g. pull-to-refresh) can await it before reloading from cloud.
let _pendingSavePromise=null;
function _flushSaveNow(){
  if(_syncTimer){clearTimeout(_syncTimer);_syncTimer=null;}
  _pendingSavePromise=supaSaveToCloud().finally(()=>{_pendingSavePromise=null;});
  return _pendingSavePromise;
}

// ── Offline / reconnect watcher ────────────────────────────────────────────
function _showOfflineBanner(syncing){
  const b=document.getElementById('offline-banner');if(!b)return;
  if(syncing){b.textContent='Syncing...';b.style.cssText+='background:#2563eb;color:#fff;display:block';}
  else{b.textContent='Offline — changes saved locally';b.style.cssText+='background:#D97706;color:#1a1a1a;display:block';}
}
function _hideOfflineBanner(){const b=document.getElementById('offline-banner');if(b)b.style.display='none';}
async function _onReconnect(){
  if(!_supa||!_supaUser)return;
  const hasPending=localStorage.getItem('zp3_pending_sync')==='1';

  // Case 1: Never loaded from Supabase (no cache, started offline).
  // Snapshot any in-memory additions, do a fresh cloud load, merge additions back,
  // then push. This prevents offline-entered records from being silently lost.
  if(!_supaCloudLoaded){
    _showOfflineBanner(true);
    try{
      // Snapshot records the contractor entered while offline (in-memory only)
      const _oClients=[...clients],_oBids=[...bids],_oJobs=[...jobs];
      await supaLoadFromCloud({silent:true}); // restores cloud data + sets _supaCloudLoaded=true
      // Merge: append any offline-created records not present in cloud
      const _cSet=new Set(clients.map(c=>c.id));
      const _bSet=new Set(bids.map(b=>b.id));
      const _jSet=new Set(jobs.map(j=>j.id));
      let _merged=false;
      _oClients.filter(c=>!_cSet.has(c.id)).forEach(c=>{clients.push(c);_merged=true;});
      _oBids.filter(b=>!_bSet.has(b.id)).forEach(b=>{bids.push(b);_merged=true;});
      _oJobs.filter(j=>!_jSet.has(j.id)).forEach(j=>{jobs.push(j);_merged=true;});
      if(_merged){await _flushSaveNow();renderDash();}
      localStorage.removeItem('zp3_pending_sync');
      _hideOfflineBanner();
      typeof _drainHubQueue==='function'&&_drainHubQueue();
      typeof _drainPhotoQueue==='function'&&_drainPhotoQueue();
    }catch(e){_showOfflineBanner(false);}
    return;
  }

  // Case 2: Loaded from cache, no user writes — just refresh from cloud silently.
  if(_loadedFromCacheOnly&&!hasPending){
    _showOfflineBanner(true);
    try{
      await supaLoadFromCloud({silent:true});renderDash&&renderDash();_hideOfflineBanner();
      typeof _drainHubQueue==='function'&&_drainHubQueue();
      typeof _drainPhotoQueue==='function'&&_drainPhotoQueue();
    }catch(e){_showOfflineBanner(false);}
    return;
  }

  // Case 3: Network blip mid-session (or cache load + user made offline writes).
  // Sanity guard inside supaSaveToCloud() prevents pushing incomplete data.
  if(!hasPending){
    // Nothing to sync and cloud is fully loaded — routine token rotation triggered
    // _mergeOnSignIn via SIGNED_OUT but TOKEN_REFRESHED confirms we're still online.
    // Clear the flag and cancel/hide the banner so it doesn't linger.
    _mergeOnSignIn=false;clearTimeout(window._offlineBannerTimer);_hideOfflineBanner();
    return;
  }
  _showOfflineBanner(true);
  try{
    await _flushSaveNow();
    localStorage.removeItem('zp3_pending_sync');
    _hideOfflineBanner();
    typeof _drainHubQueue==='function'&&_drainHubQueue();
    typeof _drainPhotoQueue==='function'&&_drainPhotoQueue();
  }catch(e){_showOfflineBanner(false);}
}
async function _probeAndSync(){
  try{
    await fetch('/version.json?_='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(5000)});
    _hideOfflineBanner(); // connection confirmed — hide immediately, sync in background
    // No active user — try silent session restore regardless of _mergeOnSignIn.
    // _mergeOnSignIn is only true after involuntary SIGNED_OUT; after deliberate sign-out
    // the flag stays false, but we still want to re-auth when the backup token is present.
    if(_supa&&!_supaUser&&!_sessionRestoreInProgress){
      const _bk=(()=>{try{return JSON.parse(localStorage.getItem('zp3_session_backup')||'null');}catch(_e){return null;}})();
      if(_bk?.access_token&&_bk?.refresh_token){
        _sessionRestoreInProgress=true;
        _supa.auth.setSession(_bk).then(({data:{session}})=>{
          _sessionRestoreInProgress=false;
          if(!session){
            // Refresh token confirmed expired (not a network error — Supabase returned null).
            // Clear the stale backup so future probes don't keep trying it.
            localStorage.removeItem('zp3_session_backup');
            supaShowLogin({force:true});
            return;
          }
          if(!_supaUser){
            // Auth event hasn't fired yet — drive reconnect ourselves
            _supaUser=session.user;
            _saveSessionBackup(session);
            _mergeOnSignIn=false;
            _onReconnect();
          }
          // If auth event already set _supaUser, reconnect was handled there
        }).catch(()=>{
          // Network error during token exchange — don't show login, retry on next probe
          _sessionRestoreInProgress=false;
        });
      }
      // No backup — stay on current screen; don't call supaShowLogin() repeatedly from tick
      return;
    }
    _onReconnect();
  }catch(e){if(_isOfflineState())_showOfflineBanner(false);}
}
function _isOfflineState(){
  return !_supaCloudLoaded||_loadedFromCacheOnly||_mergeOnSignIn||localStorage.getItem('zp3_pending_sync')==='1';
}
function _startOfflineWatcher(){
  // Restart auto-refresh and probe on connectivity restore.
  window.addEventListener('online',()=>{if(_supa)_supa.auth.startAutoRefresh();_probeAndSync();});
  // Stop auto-refresh when the browser reports offline so Supabase doesn't fire
  // SIGNED_OUT repeatedly from failed refresh attempts while disconnected.
  window.addEventListener('offline',()=>{if(_supa)_supa.auth.stopAutoRefresh();});
  document.addEventListener('visibilitychange',()=>{
    // Flush offline-pending to localStorage the moment the app is backgrounded —
    // last chance to persist before iOS suspends or kills the process. Fire whenever
    // there's any unsaved data: pending debounced save, offline mode, or a failed
    // push that hasn't drained yet. (Before v05.19.26.129 this only fired when
    // _supaUser was null, which stopped working once we paused autoRefresh on offline.)
    if(document.visibilityState==='hidden'){
      const _hasUnsaved=_syncTimer||_mergeOnSignIn||localStorage.getItem('zp3_pending_sync')==='1';
      if(_hasUnsaved){
        try{localStorage.setItem('zp3_offline_pending',JSON.stringify({clients,bids,jobs,ts:Date.now()}));}catch(_e){}
      }
    }
    if(document.visibilityState==='visible'&&_isOfflineState())_probeAndSync();
  });
  // 5s when offline (banner showing), 30s when fully synced
  const _tick=()=>{
    const offline=_isOfflineState();
    if(offline)_probeAndSync();
    setTimeout(_tick,offline?5000:30000);
  };
  setTimeout(_tick,5000);
}

// Diagnostic: ring buffer of recent save attempts so we can see WHY a save
// failed when PTR has to rescue records. Inspect via window._saveLog in dev tools.
window._saveLog=window._saveLog||[];
function _logSave(stage,info){
  window._saveLog.push({t:new Date().toISOString(),stage,info});
  if(window._saveLog.length>40)window._saveLog.shift();
}
function _writeLocalCache(){
  try{
    const _snap={clients,bids,jobs,payments,income,
      expenses:expenses.map(({receipt_img,...r})=>r),
      mileage,liens,timeEntries,licenses,events,contracts,photos,checksState,
      settings:S,cached_at:new Date().toISOString()};
    localStorage.setItem('zp3_cloud_cache',JSON.stringify(_snap));
  }catch(_e){}
}

async function supaSaveToCloud(){
  if(!_supa||!_supaUser){
    if(_mergeOnSignIn){
      try{localStorage.setItem('zp3_offline_pending',JSON.stringify({clients,bids,jobs,income,expenses:expenses.map(({receipt_img,...r})=>r),mileage,payments,liens,ts:Date.now()}));}catch(_e){}
    }
    _logSave('skip','no _supa or _supaUser');return;
  }
  if(!_supaCloudLoaded){_logSave('skip','_supaCloudLoaded=false');return;}

  // Sanity guard — refuse to push if critical arrays unexpectedly empty vs cache
  if(_loadedFromCacheOnly){
    const _sc=localStorage.getItem('zp3_cloud_cache');
    if(_sc){try{
      const _scd=JSON.parse(_sc);
      const _wipe=(arr,key)=>arr.length===0&&(_scd[key]||[]).length>0;
      if(_wipe(clients,'clients')||_wipe(mileage,'mileage')||_wipe(bids,'bids')||_wipe(income,'income')){
        _logSave('sanity-abort',{clients:clients.length,mileage:mileage.length});
        localStorage.setItem('zp3_pending_sync','1');_showOfflineBanner();return;
      }
    }catch(_e){}}
  }

  const _attemptId=Date.now()+'-'+Math.random().toString(36).slice(2,5);
  const _mileCount=mileage.length;
  _lastLocalSaveAt=Date.now();
  _logSave('start',{id:_attemptId,mileage:_mileCount,page:document.querySelector('.pg.active')?.id});

  // Force-quit safety net — written before any async work
  try{localStorage.setItem('zp3_offline_pending',JSON.stringify({clients,bids,jobs,income,expenses:expenses.map(({receipt_img,...r})=>r),mileage,payments,liens,ts:Date.now()}));}catch(_e){}
  _writeLocalCache();

  // Lazy-migrate up to 3 inline receipt_img → Supabase Storage
  if(!_devSupportMode&&!_isEmployee&&_supaUser){
    const toMigrate=expenses.filter(e=>e.receipt_img&&!e.receipt_key).slice(0,3);
    for(const e of toMigrate){
      try{
        const b64=e.receipt_img.includes(',')?e.receipt_img.split(',')[1]:e.receipt_img;
        const key=await _uploadReceiptToStorage(e.id,b64);
        if(key){e.receipt_key=key;e.receipt_img=null;}
      }catch(err){console.warn('[receipt migrate]',err);}
    }
  }

  // Cache receipt images still using inline storage
  const receiptImages={};
  expenses.forEach(e=>{if(e.receipt_img)receiptImages[e.id]=e.receipt_img;});
  try{
    const _rj=JSON.stringify(receiptImages);
    if(_rj.length<4*1024*1024)localStorage.setItem('zp3_rcpt_imgs',_rj);
    else localStorage.removeItem('zp3_rcpt_imgs');
  }catch(_e){}

  const uid=_devSupportMode
    ?(Object.values(_DEV_SUPPORT_USERS).find(u=>u.name===_devSupportName)?.userId||_supaUser.id)
    :(_isEmployee?_contractorUserId:_supaUser.id);

  try{
    const ts=new Date().toISOString();

    // Batch upsert helper: upserts all live records, soft-deletes any that vanished
    const _upsertTable=async(tbl,arr,txFn)=>{
      const rows=(txFn?txFn(arr):arr);
      const currentIds=new Set(rows.map(r=>String(r.id)));
      // Fetch server-locked records (updated_at > 1 year from now = admin-deleted, must not overwrite)
      const lockCutoff=new Date(Date.now()+365*24*60*60*1000).toISOString();
      const{data:lockedRows}=await _supa.from(tbl).select('id').eq('user_id',uid).gt('updated_at',lockCutoff);
      const lockedIds=new Set((lockedRows||[]).map(r=>String(r.id)));
      if(lockedIds.size){
        // Evict locked records from local memory so they don't resurface
        const tdef=_TD_TABLES.find(x=>x.t===tbl);
        if(tdef?.set) tdef.set(rows.filter(r=>!lockedIds.has(String(r.id))));
        lockedIds.forEach(id=>currentIds.delete(id));
      }
      // Upsert live records in batches of 50 (excluding locked)
      if(rows.length){
        const dbRows=rows.filter(r=>!lockedIds.has(String(r.id))).map(r=>({id:String(r.id),user_id:uid,data:r,updated_at:ts,deleted_at:null}));
        for(let i=0;i<dbRows.length;i+=50){
          const{error}=await _supa.from(tbl).upsert(dbRows.slice(i,i+50),{onConflict:'id,user_id'});
          if(error)throw error;
        }
      }
      // Soft-delete records that were removed locally since last known state (never touch locked)
      const prev=_lastKnownIds[tbl]||new Set();
      const gone=[...prev].filter(id=>!currentIds.has(id)&&!lockedIds.has(id));
      if(gone.length){
        for(let i=0;i<gone.length;i+=50){
          const{error:_de}=await _supa.from(tbl).update({deleted_at:ts,updated_at:ts}).in('id',gone.slice(i,i+50)).eq('user_id',uid);
          if(_de)throw _de;
        }
      }
      _lastKnownIds[tbl]=currentIds;
    };

    for(const {t,get,tx} of _TD_TABLES){
      const arr=get();
      await _upsertTable(t,arr,tx);
    }

    // Settings + checksState stay in zj_data (single-writer object, no concurrent conflict)
    if(!_isEmployee){
      const{stateRates:_sr,locationDenied:_ld,locationGranted:_lg,...sForCloud}=S;
      const{error:_se}=await _supa.from('zj_data').upsert(
        {user_id:uid,settings:JSON.stringify(sForCloud),checks_state:JSON.stringify(checksState),updated_at:ts},
        {onConflict:'user_id'}
      );
      if(_se)console.warn('[td settings]',_se);
    }

    _logSave('ok',{id:_attemptId,mileage:_mileCount});
    localStorage.removeItem('zp3_pending_sync');
    localStorage.removeItem('zp3_offline_pending');
    _writeLocalCache();
    _hideOfflineBanner();
    supaSetStatus('synced');
    // Signal other open devices to reload
    if(_syncBroadcastChannel){try{_syncBroadcastChannel.send({type:'broadcast',event:'data_saved',payload:{deviceId:_deviceId}});}catch(_e){}}
  }catch(e){
    _logSave('throw',{id:_attemptId,name:e?.name,code:e?.code,msg:e?.message||String(e)});
    console.warn('Cloud save failed:',e);
    localStorage.setItem('zp3_pending_sync','1');
    try{localStorage.setItem('zp3_offline_pending',JSON.stringify({clients,bids,jobs,income,expenses:expenses.map(({receipt_img,...r})=>r),mileage,payments,liens,ts:Date.now()}));}catch(_e){}
    _showOfflineBanner();
    supaSetStatus('error');
  }
}

async function checkNewSignatures(){
  if(!_supa||!_supaUser)return;
  try{
    // Use localStorage as the seen-list — no DB column dependency
    const seenCache=new Set(JSON.parse(localStorage.getItem('zp3_seen_sigs')||'[]'));
    const{data,error}=await _supa.from('signed_proposals')
      .select('bid_id,client_name,payment_method,payment_status,signed_at,client_signed_name')
      .eq('contractor_user_id',_supaUser.id)
      .order('signed_at',{ascending:false})
      .limit(100);
    if(error)throw error;
    if(data&&data.length){
      let changed=false;const alerts=[];const newSeen=[];
      for(const s of data){
        const key=String(s.bid_id);
        const alreadySeen=seenCache.has(key);
        const bid=bids.find(b=>String(b.id)===key);
        if(!bid){if(!alreadySeen)newSeen.push(key);continue;} // deleted/orphaned
        if(bid.status!=='Closed Won'){
          // Always fix the status regardless of seenCache — data may have been reset
          bid.status='Closed Won';bid.draft=false;
          bid.signedAt=s.signed_at;
          bid.signedName=s.client_signed_name||s.client_name;
          bid.paymentMethod=s.payment_method;
          changed=true;
          if(!alreadySeen){
            alerts.push({name:s.client_name||'Client',bidId:bid.id,clientId:bid.client_id,isPaid:s.payment_status==='paid'});
          }
        }
        if(!alreadySeen)newSeen.push(key);
      }
      if(newSeen.length){
        newSeen.forEach(id=>seenCache.add(id));
        localStorage.setItem('zp3_seen_sigs',JSON.stringify([...seenCache].slice(-500)));
      }
      if(changed){
        saveAll();
        [...new Set(alerts.map(a=>a.clientId))].forEach(cid=>_refreshClientHub(cid));
        const existing=JSON.parse(localStorage.getItem('zp3_schedule_alerts')||'[]');
        localStorage.setItem('zp3_schedule_alerts',JSON.stringify([...existing,...alerts]));
        renderDash();
        if(!window._showingScheduleAlert)setTimeout(showScheduleAlerts,400);
      }
    }
  }catch(e){console.warn('checkNewSignatures:',e);}
}
async function _fetchProposalViews(){
  if(!_supa||!_supaUser)return;
  try{
    const{data}=await _supa.from('proposal_views')
      .select('client_id,opened_at')
      .eq('contractor_user_id',_supaUser.id)
      .order('opened_at',{ascending:false});
    if(data){
      _proposalViews={};
      data.forEach(v=>{if(!_proposalViews[v.client_id])_proposalViews[v.client_id]=v.opened_at;});
      renderDash();
    }
  }catch(e){}
}
function showScheduleAlerts(){
  let alerts=JSON.parse(localStorage.getItem('zp3_schedule_alerts')||'[]');
  // Discard any alerts whose bid no longer exists locally — they can't be scheduled
  alerts=alerts.filter(a=>bids.find(b=>String(b.id)===String(a.bidId)));
  localStorage.setItem('zp3_schedule_alerts',JSON.stringify(alerts));
  if(!alerts.length){window._showingScheduleAlert=false;return;}
  window._showingScheduleAlert=true;
  const a=alerts[0];
  const remaining=alerts.slice(1);
  localStorage.setItem('zp3_schedule_alerts',JSON.stringify(remaining));
  window._currentScheduleAlert=a;

  // Remove any existing schedule alert modal
  document.getElementById('_sched-alert-overlay')?.remove();

  const payLine=a.isPaid?' and paid their deposit':'';
  const moreNote=remaining.length?' <span style="color:var(--text3);font-weight:400">('+remaining.length+' more waiting)</span>':'';

  const ov=document.createElement('div');ov.className='zmodal-overlay';ov.id='_sched-alert-overlay';
  const box=document.createElement('div');box.className='zmodal';
  const _alertBid=bids.find(b=>String(b.id)===String(a.bidId));
  const _depositAlready=_alertBid?getBidPaid(_alertBid.id)>0:false;
  const _stripeReady=_stripeConnectStatus?.charges_enabled;
  const _depositAmt=_alertBid?Math.round((_alertBid.amount||0)*0.25*100)/100:0;
  box.innerHTML=
    '<div style="text-align:center;font-size:32px;margin-bottom:6px">'+(a.isPaid?'💰':'🎉')+'</div>'+
    '<div style="font-size:18px;font-weight:800;text-align:center;margin-bottom:4px">New signature!'+moreNote+'</div>'+
    '<div style="font-size:14px;color:var(--text3);text-align:center;margin-bottom:20px">'+
      escHtml(a.name)+' signed their painting proposal'+payLine+'.'+
    '</div>'+
    '<button id="_sched-alert-yes" style="width:100%;padding:16px;border-radius:var(--r);border:none;background:var(--green);color:#fff;font-size:16px;font-weight:800;cursor:pointer;font-family:inherit;margin-bottom:'+((!_depositAlready&&_stripeReady&&_depositAmt>0)?'8px':'16px')+'">'+
      'Schedule now →'+
    '</button>'+
    ((!_depositAlready&&_stripeReady&&_depositAmt>0)?
      '<button id="_sched-alert-deposit" style="width:100%;padding:14px;border-radius:var(--r);border:none;background:#635BFF;color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:16px">'+
        '💳 Collect '+fmt(_depositAmt)+' deposit now'+
      '</button>':'')+
    '<div style="text-align:center">'+
      '<button id="_sched-alert-later" style="background:none;border:none;color:var(--text3);font-size:12px;cursor:pointer;font-family:inherit;padding:4px 8px;text-decoration:underline;text-underline-offset:2px">'+
        'Later'+(remaining.length?' · '+remaining.length+' more':'')+
      '</button>'+
    '</div>';
  ov.appendChild(box);document.body.appendChild(ov);

  document.getElementById('_sched-alert-yes').addEventListener('click',()=>{
    ov.remove();
    window._showingScheduleAlert=false;
    showScheduleSuggestion(a.clientId,a.bidId,a.name);
  });
  document.getElementById('_sched-alert-deposit')?.addEventListener('click',()=>{
    ov.remove();
    window._showingScheduleAlert=false;
    if(a.bidId)openPayPanel(a.bidId,'deposit');
  });
  document.getElementById('_sched-alert-later').addEventListener('click',()=>{
    ov.remove();
    const q=JSON.parse(localStorage.getItem('zp3_schedule_alerts')||'[]');
    const hasMore=q.length>0;
    // Only re-queue if bid still exists — orphaned alerts die here
    const bidStillExists=window._currentScheduleAlert&&bids.find(b=>String(b.id)===String(window._currentScheduleAlert.bidId));
    if(bidStillExists)q.push(window._currentScheduleAlert);
    window._currentScheduleAlert=null;
    localStorage.setItem('zp3_schedule_alerts',JSON.stringify(q));
    window._showingScheduleAlert=false;
    if(hasMore)showScheduleAlerts();
  });
}
function deferScheduleAlert(){
  document.getElementById('sched-suggest-overlay')?.remove();
  if(window._currentScheduleAlert){
    const q=JSON.parse(localStorage.getItem('zp3_schedule_alerts')||'[]');
    q.push(window._currentScheduleAlert);
    localStorage.setItem('zp3_schedule_alerts',JSON.stringify(q));
    window._currentScheduleAlert=null;
    if(q.length>1)showToast(q.length+' clients waiting to schedule','📋');
    setTimeout(showScheduleAlerts,400);
  }
}
function showScheduleSuggestion(clientId,bidId,clientNameFallback){
  const bid=bidId?bids.find(b=>b.id===bidId):null;
  const c=clientId?getClientById(clientId):null;
  const cname=c?.name||bid?.client_name||clientNameFallback||'Client';
  const firstName=cname.split(/[\s,]+/)[0];
  const phone=(c?.phone||bid?.phone||'').replace(/\D/g,'');
  const days=bid?.days||2;
  const allowWknd=!!(bid?.allowWeekend);
  const bname=S.bname||'TradeDesk';

  const startKey=getNextAvailForBid(bid);
  const endKey=_jobEndDate(startKey,days,allowWknd);
  const fmtD=k=>parseD(k).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
  const startLabel=fmtD(startKey);
  const endLabel=startKey===endKey?'':' – '+fmtD(endKey);
  const rangeLabel=startLabel+endLabel+(days>1?' ('+days+' days)':'');

  const smsMsg='Hey '+firstName+'! It\'s '+bname+'. Great news — you\'re all set. 🎨\n\nOur next available start date is '+startLabel+'. Does that work for you?\n\nJust reply YES and we\'ll lock you in!';
  const smsHref='sms:'+(phone||'')+'&body='+encodeURIComponent(smsMsg);
  const callHref=phone?'tel:'+phone:'';

  const ov=document.createElement('div');ov.className='zmodal-overlay';ov.id='sched-suggest-overlay';
  const box=document.createElement('div');box.className='zmodal';
  box.innerHTML=
    '<div style="font-size:18px;font-weight:800;margin-bottom:2px">Schedule '+cname+'</div>'+
    '<div style="font-size:12px;color:var(--text3);margin-bottom:16px">'+(bid?fmt(bid.amount)+' · '+days+' day'+(days!==1?'s':''):'')+' painting job</div>'+
    '<div style="background:var(--blue-lt);border:1.5px solid var(--blue);border-radius:var(--r);padding:14px;margin-bottom:14px;text-align:center">'+
      '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--blue);margin-bottom:4px">Next available</div>'+
      '<div style="font-size:22px;font-weight:800;color:var(--blue-dk)">'+startLabel+'</div>'+
      (endLabel?'<div style="font-size:12px;color:var(--blue);margin-top:2px">Through '+fmtD(endKey)+'</div>':'')+
    '</div>'+
    '<div style="font-size:11px;color:var(--text3);text-align:center;margin-bottom:14px">Confirm with client, then tap "Lock it in"</div>'+
    '<div style="display:grid;gap:8px;margin-bottom:8px">'+
      (phone?'<a href="'+smsHref+'" style="display:block;padding:13px;border-radius:var(--r);border:none;background:#27AE60;color:#fff;font-size:15px;font-weight:700;text-align:center;text-decoration:none">📱 Text '+firstName+' to confirm</a>':'')+
      (callHref?'<a href="'+callHref+'" style="display:block;padding:11px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);font-size:14px;font-weight:600;text-align:center;text-decoration:none">📞 Call '+firstName+'</a>':'')+
    '</div>'+
    '<button id="sched-lock-btn" onclick="quickScheduleJob('+bidId+',\''+startKey+'\','+clientId+')" style="width:100%;padding:14px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:8px">✓ Lock it in — '+startLabel+'</button>'+
    '<button onclick="document.getElementById(\'sched-suggest-overlay\').remove();'+(bidId?'schedFromBid('+bidId+')':'goPg(\'pg-schedule\')')+'" style="width:100%;padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:none;color:var(--text3);font-size:13px;cursor:pointer;font-family:inherit;margin-bottom:6px">Pick a different date</button>'+
    '<button onclick="deferScheduleAlert()" style="width:100%;padding:8px;border:none;background:none;color:var(--text3);font-size:12px;cursor:pointer;font-family:inherit">Later</button>';
  ov.appendChild(box);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
}
function quickScheduleJob(bidId,startKey,clientId){
  const bid=bidId?bids.find(b=>b.id===bidId):null;
  if(!bid){zAlert('Bid not found.');return;}
  // Guard: already scheduled?
  if(jobs.some(j=>j.bid_id===bidId&&j.eventType==='job'&&j.status!=='canceled')){
    zAlert('This job is already on the calendar.',{title:'Already scheduled'});
    document.getElementById('sched-suggest-overlay')?.remove();return;
  }
  const days=bid.days||2;
  const name=(bid.client_name||bid.name||'Job')+(bid.type?' — '+bid.type:'');
  jobs.push({
    id:Date.now(),bid_id:bidId,client_id:clientId||bid.client_id,
    name,addr:bid.addr||'',start:startKey,days,buffer:1,
    value:bid.amount||0,color:'#185FA5',eventType:'job',
    time:'',hours:null,notes:bid.notes||'',status:'upcoming'
  });
  saveAll();renderDash();renderJobsPage&&renderJobsPage();
  window._currentScheduleAlert=null;
  document.getElementById('sched-suggest-overlay')?.remove();
  showToast(name+' scheduled for '+parseD(startKey).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}),'📅');
  const _nextAlerts=JSON.parse(localStorage.getItem('zp3_schedule_alerts')||'[]');
  const _moreStr=_nextAlerts.length?' · '+_nextAlerts.length+' more client'+(_nextAlerts.length>1?'s':'')+' to schedule':'';
  // Offer to go to calendar, then chain to next alert either way
  setTimeout(()=>zConfirm('Job locked in for '+parseD(startKey).toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})+'.'+_moreStr+'\n\nView on calendar?',
    ()=>{goPg('pg-cal');setTimeout(showScheduleAlerts,600);},
    {title:'✓ Scheduled!',yes:'View calendar',no:_nextAlerts.length?'Next client ('+_nextAlerts.length+')':'Done',danger:false,
    onNo:()=>setTimeout(showScheduleAlerts,300)}),400);
}
function discardInProgressBid(bidId){
  if(!confirm('Discard this estimate?'))return;
  const _db=bids.find(b=>b.id===bidId);
  const _cid=_db?.client_id;
  const idx=bids.findIndex(b=>b.id===bidId);
  if(idx>-1){bids.splice(idx,1);clearEstFullDraft();saveAll();renderDash();
    if(_cid)_uploadClientHub(_cid).catch(e=>console.error('[hub upload]',e));}
}
function cancelProposalLink(bidId){
  zConfirm('Cancel this proposal link? The client\'s link will stop working.',()=>{
    const b=bids.find(x=>x.id===bidId);
    if(!b)return;
    delete b.signingToken;delete b.signingKey;b.draft=true;
    saveAll();renderDash();showToast('Proposal link cancelled','✓');
  },{title:'Cancel proposal?',yes:'Cancel link',danger:true});
}
function editSentBid(bidId){
  const b=bids.find(x=>x.id===bidId);if(!b)return;
  // Void the old proposal in storage so the old link stops working
  if(b.signingKey&&_supa){
    _supa.storage.from('proposals').download(b.signingKey).then(({data})=>{
      if(!data)return;
      data.text().then(txt=>{
        try{const p=JSON.parse(txt);_supa.storage.from('proposals').upload(b.signingKey,JSON.stringify({...p,status:'voided'}),{contentType:'application/json',upsert:true});}catch(e){}
      });
    });
  }
  delete b.signingToken;delete b.signingKey;b.draft=true;
  saveAll();openEditBid(bidId,b.lastStep||1);
}
function resendProposalLink(bidId){
  const b=bids.find(x=>x.id===bidId);
  if(!b)return;
  const baseUrl=_clientBaseUrl();
  const c=getClientById(b.client_id);
  const hubUrl=c?.clientToken?baseUrl+'client.html?t='+c.clientToken+'&u='+(_supaUser?.id||'')+'&c='+c.id:null;
  if(hubUrl&&c?.phone){
    const firstName=(c.name||b.client_name||'there').split(' ')[0];
    const biz=S.bname||'your contractor';
    const msg='Hi '+firstName+', '+biz+' sent you a proposal to review and sign. Open your project hub here: '+hubUrl;
    window.location.href='sms:'+c.phone.replace(/\D/g,'')+'?body='+encodeURIComponent(msg);
  } else if(hubUrl){
    navigator.clipboard.writeText(hubUrl).then(()=>showToast('Hub link copied','📋')).catch(()=>{});
  } else if(b.signingToken){
    const sigUrl=baseUrl+'sign.html?t='+b.signingToken+'&u='+(_supaUser?.id||'')+'&b='+bidId;
    navigator.clipboard.writeText(sigUrl).then(()=>showToast('Proposal link copied','🔗')).catch(()=>{});
  }
}
async function supaLoadFromCloud({silent=false}={}){
  if(!_supa||!_supaUser)return;
  if(_loadInProgress)return;
  _loadInProgress=true;
  if(silent){
    // Server state wins — cancel any pending debounce without flushing it.
    // Flushing stale local data before loading would re-insert records deleted on another device.
    if(_syncTimer){clearTimeout(_syncTimer);_syncTimer=null;}
  }else{
    if(_syncTimer){clearTimeout(_syncTimer);_syncTimer=null;try{await supaSaveToCloud();}catch(e){}}
    else if(_pendingSavePromise){try{await _pendingSavePromise;}catch(e){}}
  }  try{
    const uid=_devSupportMode
      ?(Object.values(_DEV_SUPPORT_USERS).find(u=>u.name===_devSupportName)?.userId||_supaUser.id)
      :(_isEmployee?_contractorUserId:_supaUser.id);

    const[tableResults,settingsResult]=await Promise.all([
      Promise.all(_TD_TABLES.map(({t})=>
        _supa.from(t).select('id,data').eq('user_id',uid).is('deleted_at',null)
      )),
      _supa.from('zj_data').select('settings,checks_state,receipt_images').eq('user_id',uid).maybeSingle()
    ]);

    for(let i=0;i<_TD_TABLES.length;i++){if(tableResults[i].error)throw tableResults[i].error;}

    for(let i=0;i<_TD_TABLES.length;i++){
      const{t,set}=_TD_TABLES[i];
      const rows=(tableResults[i].data||[]).map(r=>r.data);
      set(rows);
      _lastKnownIds[t]=new Set((tableResults[i].data||[]).map(r=>String(r.id)));
    }

    const _lsRcpt=(()=>{try{return JSON.parse(localStorage.getItem('zp3_rcpt_imgs')||'{}')}catch{return{}}})();
    const _dbRcpt=(()=>{try{const v=settingsResult.data?.receipt_images;return v?JSON.parse(v):{}}catch{return{}}})();
    const rcptImgs={..._lsRcpt,..._dbRcpt};
    expenses=expenses.map(e=>rcptImgs[e.id]?{...e,receipt_img:rcptImgs[e.id]}:e);
    expenses.sort((a,b)=>(a.date||'9').localeCompare(b.date||'9'));

    const sd=settingsResult.data;
    if(sd){
      if(sd.checks_state){const cc=(()=>{try{return JSON.parse(sd.checks_state);}catch{return null;}})();if(cc&&Object.keys(cc).length)checksState=cc;}
      if(sd.settings){const ss=(()=>{try{return JSON.parse(sd.settings);}catch{return null;}})();
        if(ss){S={...S,...ss};
          if(S.fedMFS===14600)S.fedMFS=15000;if(S.fedSingle===14600)S.fedSingle=15000;
          if(S.fedMFJ===29200)S.fedMFJ=30000;if(S.fedHOH===21900)S.fedHOH=22500;
          if(S.b10===11600)S.b10=11925;if(S.b12===47150)S.b12=48475;
          if(S.b22===100525)S.b22=103350;if(S.b24===191950)S.b24=197300;
          if(S.b32===243725)S.b32=250525;if(S.b35===609350)S.b35=626350;
          const _IRS_RATE_2026=0.725,_IRS_YEAR=2026;
          if(new Date().getFullYear()>=_IRS_YEAR&&S.irsRate<_IRS_RATE_2026){S.irsRate=_IRS_RATE_2026;S.irsRateYear=_IRS_YEAR;}
          applySettings();loadSettingsForm();
          if(!_isEmployee&&ss.ownerName&&_supaUser?.id){localStorage.setItem('zp3_uname_'+_supaUser.id,ss.ownerName);if(_user)_user.name=ss.ownerName;}
          if(_isEmployee&&_employeeRecord?.name&&_user){_user.name=_employeeRecord.name;}
        }
      }
    }

    _supaCloudLoaded=true;_loadedFromCacheOnly=false;_mergeOnSignIn=false;
    supaSetStatus('synced');

    if(!silent){
      setTimeout(()=>{if(_stripeConnectStatus===null)_fetchStripeConnectStatus().catch(()=>{});},500);
      _removeBootOverlay();goPg('pg-dash');
    }
    renderDash();buildScopeGrid();
    renderClientList&&renderClientList();renderLeadsPage&&renderLeadsPage();renderJobsPage&&renderJobsPage();renderMoneyPage&&renderMoneyPage();
    if(typeof renderIncome==='function')renderIncome();
    if(typeof renderExpenses==='function')renderExpenses();
    if(typeof renderAllMileage==='function')renderAllMileage();

    const _dedupById=(arr)=>{const seen=new Set();return arr.filter(x=>{if(seen.has(x.id))return false;seen.add(x.id);return true;});};
    const _preLen=clients.length+bids.length+jobs.length;
    clients=_dedupById(clients);bids=_dedupById(bids);jobs=_dedupById(jobs);
    if(clients.length+bids.length+jobs.length<_preLen)setTimeout(()=>_flushSaveNow(),1200);
    bids=bids.filter(b=>!(b.draft===true&&b.status==='Draft'&&b.geiLines===undefined&&(!b.surfaces||!b.surfaces.length)&&!b.signingToken&&!b.amount));
    const _geiSeen=new Set();
    bids=bids.filter(b=>{if(b.geiLines===undefined||b.signingToken||b.amount||(b.geiLines||[]).length)return true;if(b.status!=='Draft'&&b.status!=='Pending')return true;const key=b.client_id+'|'+(b.trade_type||'general');if(_geiSeen.has(key))return false;_geiSeen.add(key);return true;});
    clients.forEach(c=>{if(!c.clientToken)_ensureClientToken(c.id);});

    if(!silent){
      setTimeout(()=>{
        if(_supaUser)clients.filter(c=>c.clientToken).forEach(c=>{_uploadClientHub(c.id).catch(()=>{});});
        autoRefreshRates();autoRefreshTaxBrackets();autoRefreshLienRules();
      },4000);
      setTimeout(()=>_checkOdometerPrompt(),3500);
      setTimeout(async()=>{await checkNewSignatures();_fetchProposalViews();if(!window._showingScheduleAlert)showScheduleAlerts();},2000);
      setInterval(()=>{checkNewSignatures();_fetchProposalViews();},30000);
      try{
        _supa.channel('sig-feed-'+_supaUser.id)
          .on('postgres_changes',{event:'*',schema:'public',table:'signed_proposals',filter:'contractor_user_id=eq.'+_supaUser.id},()=>{checkNewSignatures();})
          .subscribe();
      }catch(e){}
      setInterval(()=>_loadPendingInbound(),30000);
      setTimeout(()=>_fetchStripeConnectStatus(),3000);
      setTimeout(()=>_loadPendingInbound(),2000);
      document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){checkNewSignatures();if(_supaUser)_loadPendingInbound();checkNearbyJob();}});
      setTimeout(()=>requestLocationPermission(()=>{},()=>{}),1200);
      setTimeout(()=>checkNearbyJob(),4000);
    }

    try{
      const _op=JSON.parse(localStorage.getItem('zp3_offline_pending')||'null');
      if(_op){
        let _merged=false;
        for(const{t,get}of _TD_TABLES){
          const key=t.replace(/^td_/,'').replace(/_([a-z])/g,(_m,c)=>c.toUpperCase());
          const pending=_op[key]||[];
          if(pending.length){
            const arr=get();const existingIds=new Set(arr.map(r=>String(r.id)));
            pending.filter(r=>!existingIds.has(String(r.id))).forEach(r=>{arr.push(r);_merged=true;});
          }
        }
        if(!_merged)localStorage.removeItem('zp3_offline_pending');
        if(_merged)setTimeout(()=>_flushSaveNow(),800);
      }
    }catch(_oe){}

    _writeLocalCache();
    localStorage.removeItem('zp3_pending_sync');
    _hideOfflineBanner();

    if(!_realtimeSubscribed){_realtimeSubscribed=true;_initRealtimeSubscriptions(uid);}
  }catch(e){
    console.warn('Cloud load failed:',e);
    const _cc=localStorage.getItem('zp3_cloud_cache');
    if(_cc){
      try{
        const _cd=JSON.parse(_cc);
        clients=_cd.clients||[];bids=_cd.bids||[];jobs=_cd.jobs||[];
        payments=_cd.payments||[];income=_cd.income||[];expenses=_cd.expenses||[];
        mileage=_cd.mileage||[];liens=_cd.liens||[];timeEntries=_cd.timeEntries||[];
        if(_cd.licenses?.length)licenses=_cd.licenses;if(_cd.events?.length)events=_cd.events;
        if(_cd.contracts?.length)contracts=_cd.contracts;if(_cd.photos?.length)photos=_cd.photos;
        if(_cd.checksState&&Object.keys(_cd.checksState).length)checksState=_cd.checksState;
        if(_cd.settings){S={...S,..._cd.settings};applySettings();loadSettingsForm();}
        _loadedFromCacheOnly=true;_supaCloudLoaded=true;
        try{
          const _op=JSON.parse(localStorage.getItem('zp3_offline_pending')||'null');
          if(_op){
            for(const{t,get}of _TD_TABLES){
              const key=t.replace(/^td_/,'').replace(/_([a-z])/g,(_m,c)=>c.toUpperCase());
              const pending=_op[key]||[];
              if(pending.length){
                const arr=get();const existingIds=new Set(arr.map(r=>String(r.id)));
                pending.filter(r=>!existingIds.has(String(r.id))).forEach(r=>arr.push(r));
              }
            }
          }
        }catch(_oe){}
        if(!silent){_removeBootOverlay();renderDash();buildScopeGrid();}
        _showOfflineBanner();supaSetStatus('error');return;
      }catch(_ce){console.warn('Cache load failed:',_ce);}
    }
    _removeBootOverlay();renderDash();buildScopeGrid();supaSetStatus('error');
  }finally{
    _loadInProgress=false;
  }
}
function _initRealtimeSubscriptions(uid){
  try{
    const ch=_supa.channel('td-sync-'+uid);
    for(const{t}of _TD_TABLES){
      ch.on('postgres_changes',{event:'*',schema:'public',table:t,filter:'user_id=eq.'+uid},(payload)=>{
        _applyRealtimeRecord(t,payload);
      });
    }
    ch.subscribe();
  }catch(e){console.warn('[realtime] td-sync subscribe failed:',e);}
  try{
    _syncBroadcastChannel=_supa.channel('user-data-'+_supaUser.id);
    _syncBroadcastChannel
      .on('broadcast',{event:'data_saved'},(msg)=>{
        if(msg?.payload?.deviceId===_deviceId&&Date.now()-_lastLocalSaveAt<5000)return;
        if(_loadInProgress)return;
        // Small delay: lets postgres_changes per-record patches arrive first (smoother).
        // If realtime already handled everything, the reload is a cheap no-op.
        clearTimeout(_broadcastReloadTimer);
        _broadcastReloadTimer=setTimeout(()=>{if(!_loadInProgress)supaLoadFromCloud({silent:true});},300);
      })
      .subscribe();
  }catch(_e){}
}
function _applyRealtimeRecord(tbl,payload){
  const desc=_TD_TABLES.find(d=>d.t===tbl);
  if(!desc)return;
  const arr=desc.get();
  const ev=payload.eventType;
  const rec=payload.new;
  if((ev==='INSERT'||ev==='UPDATE')&&rec){
    if(rec.deleted_at){
      const idx=arr.findIndex(r=>String(r.id)===String(rec.id));
      if(idx!==-1){arr.splice(idx,1);_lastKnownIds[tbl]?.delete(String(rec.id));}
    }else{
      const data=rec.data||rec;
      const recId=String(data.id!=null?data.id:rec.id);
      const idx=arr.findIndex(r=>String(r.id)===recId);
      if(idx!==-1){
        arr[idx]=data;
      }else if(!_lastKnownIds[tbl]?.has(recId)){
        // Only add if this ID was never known to us — if it was known but
        // isn't in arr, we deleted it locally and another device's stale
        // save is trying to resurrect it. Ignore it.
        arr.push(data);_lastKnownIds[tbl]?.add(recId);
      }
    }
  }else if(ev==='DELETE'&&payload.old){
    const idx=arr.findIndex(r=>String(r.id)===String(payload.old.id));
    if(idx!==-1){arr.splice(idx,1);_lastKnownIds[tbl]?.delete(String(payload.old.id));}
  }
  _writeLocalCache();
  renderDash&&renderDash();buildScopeGrid&&buildScopeGrid();
  renderClientList&&renderClientList();renderLeadsPage&&renderLeadsPage();
  renderJobsPage&&renderJobsPage();renderMoneyPage&&renderMoneyPage();
  if(typeof renderIncome==='function')renderIncome();
  if(typeof renderExpenses==='function')renderExpenses();
  if(typeof renderAllMileage==='function')renderAllMileage();
}

// ── Inbound leads (onboarding form + QR intake) ───────────────────────────
let _pendingInbound=[];
const _processedInboundIds=new Set();
async function _loadPendingInbound(){
  if(!_supa||!_supaUser)return;
  try{
    const{data}=await _supa.from('inbound_leads').select('*').eq('account_id',_supaUser.id).eq('status','pending').order('created_at',{ascending:false});
    if(!data)return;
    // Split: onboard_link rows (have client_id) auto-merge; QR rows go to review queue
    const toMerge=data.filter(r=>!!r.client_id);
    const toReview=data.filter(r=>!r.client_id);
    // Update _pendingInbound BEFORE rendering so _inboundReviewHTML has correct state
    _pendingInbound=toReview;
    _updateInboundBadge();
    for(const row of toMerge){_onNewInboundLead(row);}
  }catch(e){}
}
function _onNewInboundLead(row){
  // Auto-apply if we can match by client_id (onboarding link submission)
  if(row.client_id){
    const c=clients.find(x=>x.id===Number(row.client_id));
    if(c){
      // Guard: don't process the same row twice in one session (prevents forced
      // navigation mid-tap when the 30s poll fires before Supabase update commits)
      if(_processedInboundIds.has(row.id))return;
      _processedInboundIds.add(row.id);
      if(row.addr&&!c.addr){c.addr=row.addr;}
      if(row.street&&!c.street){c.street=row.street;}
      if(row.city&&!c.city){c.city=row.city;}
      if(row.state&&!c.state){c.state=row.state;}
      if(row.zip&&!c.zip){c.zip=row.zip;}
      if(row.notes){c.notes=(c.notes?c.notes+'\n':'')+row.notes;}
      if(row.call_time){c.callTime=row.call_time;}
      saveAll();
      // Mark as applied
      _supa.from('inbound_leads').update({status:'applied'}).eq('id',row.id).then(()=>{});
      // Re-upload hub with new address so client.html shows updated info
      _uploadClientHub(Number(row.client_id)).catch(()=>{});
      // Trigger property lookup now that we have the address
      if(row.street&&row.city)_lookupPropertyData(Number(row.client_id),{street:row.street,city:row.city,state:row.state||'',zip:row.zip||''});
      showToast((c.name||'Lead')+' completed their onboarding — tap to view','📋');
      // Navigate directly to the client: avoids lead "disappearing" from whatever filter tab is active
      openClientDetail(Number(row.client_id),'leads');
      return;
    }
  }
  // Unknown lead (QR form) — queue for review
  _pendingInbound.unshift(row);
  _updateInboundBadge();
  showToast('New lead from '+(row.source==='qr_form'?'QR form':'intake form')+' — tap to review','🆕');
  if(_activePg==='pg-leads')renderLeadsPage();
}
function _updateInboundBadge(){
  const n=_pendingInbound.filter(x=>x.status==='pending').length;
  const b=document.getElementById('nb-leads-badge');
  if(b){b.textContent=n||'';b.style.display=n?'':'none';}
  const mb=document.getElementById('mtb-leads-dot');
  if(mb)mb.style.display=n?'':'none';
}
function _inboundReviewHTML(){
  const pending=_pendingInbound.filter(x=>x.status==='pending');
  if(!pending.length)return'';
  return'<div style="margin-bottom:14px">'+
    '<div style="font-size:13px;font-weight:700;margin-bottom:8px;display:flex;align-items:center;gap:6px">'+
      '<span style="background:var(--blue);color:#fff;border-radius:50%;width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;font-size:11px">'+pending.length+'</span>'+
      'New leads waiting</div>'+
    pending.map(row=>'<div style="background:var(--bg2);border:1.5px solid var(--blue);border-radius:var(--rl);padding:14px;margin-bottom:8px">'+
      '<div style="font-size:14px;font-weight:700;margin-bottom:2px">'+(row.name||'Unknown')+'</div>'+
      (row.phone?'<div style="font-size:12px;color:var(--text3);margin-bottom:2px">'+row.phone+'</div>':'')+
      (row.addr?'<div style="font-size:12px;color:var(--text2);margin-bottom:2px">'+row.addr+'</div>':'')+
      (row.notes?'<div style="font-size:12px;color:var(--text3);margin-bottom:8px;font-style:italic">"'+row.notes+'"</div>':'<div style="margin-bottom:8px"></div>')+
      '<div style="display:flex;gap:8px">'+
        '<button onclick="_promoteInbound(\''+row.id+'\')" style="flex:1;padding:10px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">Add to pipeline</button>'+
        '<button onclick="_dismissInbound(\''+row.id+'\')" style="padding:10px 14px;border-radius:var(--r);border:1px solid var(--border2);background:none;color:var(--text3);font-size:13px;cursor:pointer;font-family:inherit">Dismiss</button>'+
      '</div>'+
    '</div>').join('')+
  '</div>';
}
async function _promoteInbound(id){
  const row=_pendingInbound.find(x=>x.id===id);if(!row)return;
  // Create client record
  const newClient={id:Date.now(),name:row.name||'Unknown',phone:row.phone||'',email:'',addr:row.addr||'',ptype:'Single family home',source:'QR form',ref:'',notes:row.notes||'',created:todayKey(),extraAddresses:[],clientToken:'',clientHubKey:''};
  clients.push(newClient);_ensureClientToken(newClient.id);
  saveAll();
  // Mark inbound as applied
  _pendingInbound=_pendingInbound.filter(x=>x.id!==id);
  _updateInboundBadge();
  try{await _supa.from('inbound_leads').update({status:'applied'}).eq('id',id);}catch(e){}
  renderLeadsPage();
  // Open the new client detail
  currentClientId=newClient.id;renderClientDetail();goPg('pg-client-detail');
  showToast(row.name+' added to pipeline','✓');
}
async function _dismissInbound(id){
  _pendingInbound=_pendingInbound.filter(x=>x.id!==id);
  _updateInboundBadge();
  try{await _supa.from('inbound_leads').update({status:'dismissed'}).eq('id',id);}catch(e){}
  if(_activePg==='pg-leads')renderLeadsPage();
}

function supaSetStatus(s){
  _syncStatus=s;
  const el=document.getElementById('supa-status');
  if(!el)return;
  // Only show errors — syncing/synced are silent
  if(s==='error'){
    el.textContent='⚠️ Sync error — check connection';
    el.style.color='#A32D2D';
    el.style.opacity='1';
  } else {
    el.textContent='';
    el.style.opacity='0';
  }
}

// ── Automation: proposal auto-escalation ─────────────────────────────────────
function autoEscalateProposals(){
  const tk=todayKey();
  let changed=false;
  bids.filter(b=>b.status==='Pending'&&b.proposalSentDate).forEach(b=>{
    const lastFollowup=b.last_followup_date||b.proposalSentDate;
    const daysSinceFollowup=Math.floor((new Date(tk+'T12:00')-new Date(lastFollowup+'T12:00'))/86400000);
    if(daysSinceFollowup>=7){
      b.noResponseCount=(b.noResponseCount||0)+1;
      b.last_followup_date=tk;
      changed=true;
    }
  });
  if(changed)saveAll();
}

// ── Automation: past-due job detection ───────────────────────────────────────
function getPastDueJobs(){
  const tk=todayKey();
  return jobs.filter(j=>{
    if(j.status==='done'||j.status==='canceled')return false;
    if(j.eventType==='estimate')return false;
    const d=parseInt(j.days)||1;
    const endDay=addDays(j.start,d-1);
    return endDay<tk;
  });
}

// ── Automation: seasonal outreach ────────────────────────────────────────────
function getSeasonalOutreachClients(){
  const tk=todayKey();
  const mo=new Date(tk+'T12:00').getMonth()+1; // 1-12
  const inSeason=(mo>=3&&mo<=5)||(mo>=9&&mo<=11);
  if(!inSeason)return[];
  const cutoff=addDays(tk,-180);
  return clients.filter(c=>{
    if(!c.id)return false;
    const hasPastJob=jobs.some(j=>j.client_id===c.id&&j.status==='done');
    if(!hasPastJob)return false;
    const lastContact=c.last_contact_date||'2000-01-01';
    return lastContact<cutoff;
  }).slice(0,3);
}

// ── Automation: weekly Friday summary ────────────────────────────────────────
function checkFridaySummary(){
  if(!_supaUser)return; // don't show before login
  const now=new Date();
  if(now.getDay()!==5)return; // only on Fridays
  const tk=todayKey();
  // Get Monday of current week
  const dow=now.getDay(); // 5
  const monday=addDays(tk,-(dow-1));
  const fridayKey='zp3_last_friday_summary_'+(_supaUser?.id||'anon');
  const lastShown=localStorage.getItem(fridayKey)||'';
  if(lastShown===monday)return; // already shown this week
  localStorage.setItem(fridayKey,monday);

  // Revenue this week (payments)
  const weekPay=payments.filter(p=>p.amount>0&&p.date>=monday&&p.date<=tk);
  const weekRev=weekPay.reduce((s,p)=>s+p.amount,0);
  // Jobs completed this week
  const weekDone=jobs.filter(j=>j.completion_date&&j.completion_date>=monday&&j.completion_date<=tk&&j.status==='done').length;
  // Proposals sent this week
  const weekProps=bids.filter(b=>b.proposalSentDate&&b.proposalSentDate>=monday&&b.proposalSentDate<=tk).length;
  // Pending pipeline value
  const pendingVal=bids.filter(b=>b.status==='Pending').reduce((s,b)=>s+b.amount,0);
  // Total outstanding balance
  const outstanding=bids.filter(b=>b.status==='Closed Won').reduce((s,b)=>s+getBidBalance(b),0);

  const ov=document.createElement('div');ov.className='zmodal-overlay';
  const box=document.createElement('div');box.className='zmodal';
  box.innerHTML=
    '<div style="text-align:center;font-size:28px;margin-bottom:6px">📊</div>'+
    '<div style="font-size:16px;font-weight:800;text-align:center;margin-bottom:16px">Week in Review</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">'+
      '<div style="background:var(--green-lt);border-radius:var(--r);padding:12px;text-align:center">'+
        '<div style="font-size:20px;font-weight:800;color:var(--green-mid)">'+fmt(weekRev)+'</div>'+
        '<div style="font-size:11px;color:var(--text2);margin-top:2px">Collected</div>'+
      '</div>'+
      '<div style="background:var(--blue-lt);border-radius:var(--r);padding:12px;text-align:center">'+
        '<div style="font-size:20px;font-weight:800;color:var(--blue)">'+weekDone+'</div>'+
        '<div style="font-size:11px;color:var(--text2);margin-top:2px">Jobs done</div>'+
      '</div>'+
      '<div style="background:var(--amber-lt);border-radius:var(--r);padding:12px;text-align:center">'+
        '<div style="font-size:20px;font-weight:800;color:var(--amber)">'+weekProps+'</div>'+
        '<div style="font-size:11px;color:var(--text2);margin-top:2px">Proposals sent</div>'+
      '</div>'+
      '<div style="background:var(--bg2);border-radius:var(--r);padding:12px;text-align:center">'+
        '<div style="font-size:20px;font-weight:800;color:var(--text)">'+fmt(pendingVal)+'</div>'+
        '<div style="font-size:11px;color:var(--text2);margin-top:2px">In pipeline</div>'+
      '</div>'+
    '</div>'+
    (outstanding>0.01?
      '<div style="background:var(--amber-lt);border-radius:var(--r);padding:10px 12px;margin-bottom:14px;font-size:12px;color:var(--amber);text-align:center">'+
        '<strong>'+fmt(outstanding)+'</strong> still owed across completed jobs'+
      '</div>':'')+'<button onclick="this.closest(\'.zmodal-overlay\').remove()" style="width:100%;padding:13px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">Have a great weekend ✌️</button>';
  ov.appendChild(box);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
}

// ── Automation: daily morning briefing ───────────────────────────────────────
function showDailyBriefing(){
  if(!_supaUser)return; // don't show before login
  const briefingKey='zp3_last_briefing_'+(_supaUser?.id||'anon');
  const tk=todayKey();
  const lastBriefing=localStorage.getItem(briefingKey)||'';

  // Run silent automations every load regardless
  autoEscalateProposals();

  // Only show briefing modal once per day
  if(lastBriefing===tk){
    // Still show unpaid alert if needed (non-briefing days get this as standalone)
    setTimeout(checkUnpaidOnLoad,1200);
    return;
  }
  localStorage.setItem(briefingKey,tk);

  // ── Gather briefing data ──
  // Today's jobs
  const todayJobs=jobs.filter(j=>{
    if(j.eventType==='estimate'||j.status==='canceled')return false;
    const d=parseInt(j.days)||1;
    for(let i=0;i<d;i++){if(addDays(j.start,i)===tk)return true;}
    return false;
  });
  // Today's estimates
  const todayEsts=jobs.filter(j=>j.eventType==='estimate'&&addDays(j.start,0)===tk&&j.status!=='canceled');
  // Supply reminder — jobs tomorrow
  const tmr=addDays(tk,1);
  const tmrJobs=jobs.filter(j=>{
    if(j.eventType==='estimate'||j.status==='canceled')return false;
    const d=parseInt(j.days)||1;
    for(let i=0;i<d;i++){if(addDays(j.start,i)===tmr)return true;}
    return false;
  });
  // Top unpaid balance
  const unpaid=bids.filter(b=>b.status==='Closed Won'&&getBidBalance(b)>0.01&&b.completion_date)
    .map(b=>({b,days:Math.floor((new Date(tk+'T12:00')-new Date(b.completion_date+'T12:00'))/86400000)}))
    .filter(x=>x.days>0).sort((a,b)=>b.days-a.days);
  const totalOwed=unpaid.reduce((s,x)=>s+getBidBalance(x.b),0);
  // Overdue follow-ups
  const dueFollowups=bids.filter(b=>b.status==='Pending'&&!b.signingToken&&b.followup&&b.followup<=tk);
  // Past-due jobs
  const pastDue=getPastDueJobs();
  // Seasonal outreach
  const seasonal=getSeasonalOutreachClients();

  // ── Build sections ──
  let sections='';

  // Today's schedule
  const schedItems=[...todayJobs,...todayEsts];
  if(schedItems.length>0){
    sections+=
      '<div style="margin-bottom:14px">'+
      '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);margin-bottom:8px">Today\'s Schedule</div>'+
      schedItems.map(j=>{
        const c=getClientById(j.client_id);
        const nm=c?c.name:'Unknown';
        const icon=j.eventType==='estimate'?'📋':'🔨';
        return '<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border)">'+
          '<div style="font-size:16px">'+icon+'</div>'+
          '<div>'+
            '<div style="font-size:13px;font-weight:600">'+escHtml(nm)+'</div>'+
            '<div style="font-size:11px;color:var(--text3)">'+j.eventType.charAt(0).toUpperCase()+j.eventType.slice(1)+(c&&c.addr?' · '+escHtml(c.addr.split(',')[0]):'')+'</div>'+
          '</div>'+
        '</div>';
      }).join('')+
      '</div>';
  }

  // Top money action
  if(unpaid.length>0){
    const top=unpaid[0];
    const tc=getClientById(top.b.client_id);
    const stage=getBidCollStage(top.b);
    const next=getNextCollAction(stage);
    const isFileable=stage==='intent'||stage==='lien_ready';
    sections+=
      '<div style="margin-bottom:14px">'+
      '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);margin-bottom:8px">Money to Collect</div>'+
      '<div style="background:var(--amber-lt);border-radius:var(--r);padding:10px 12px">'+
        '<div style="font-size:13px;font-weight:700">'+fmt(totalOwed)+' owed'+
          (unpaid.length>1?' across '+unpaid.length+' jobs':'')+
        '</div>'+
        '<div style="font-size:11px;color:var(--text2);margin-top:2px">Most urgent: '+escHtml(tc?tc.name:'Client')+' · '+top.days+'d overdue</div>'+
        '<div style="display:flex;gap:6px;margin-top:8px">'+
          (tc&&tc.phone&&next.smsKey?
            '<button onclick="collSendSMS(bids.find(x=>x.id=='+top.b.id+'),\''+next.smsKey+'\');this.closest(\'.zmodal-overlay\').remove()" style="flex:1;padding:9px;border-radius:var(--r);border:none;background:var(--amber);color:#1a1a1a;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">'+next.label+'</button>':
            (isFileable?
              '<button onclick="this.closest(\'.zmodal-overlay\').remove();showFileLienDirect('+top.b.id+')" style="flex:1;padding:9px;border-radius:var(--r);border:none;background:#3D0000;color:#FFB3B3;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">⚖️ File Lien</button>':
              (tc&&tc.phone?'<a href="tel:'+tc.phone.replace(/\D/g,'')+'" onclick="autoLogContact('+tc.id+',\'call\');this.closest(\'.zmodal-overlay\').remove()" style="flex:1;padding:9px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;text-decoration:none;display:block;text-align:center">📞 Call '+escHtml(tc.name.split(' ')[0])+'</a>':'')))+
          '<button onclick="openPayPanel('+top.b.id+');this.closest(\'.zmodal-overlay\').remove()" style="flex:1;padding:9px;border-radius:var(--r);border:none;background:var(--green);color:#fff;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">Log payment</button>'+
        '</div>'+
      '</div>'+
      '</div>';
  }

  // Overdue follow-ups
  if(dueFollowups.length>0){
    sections+=
      '<div style="margin-bottom:14px">'+
      '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);margin-bottom:8px">Follow-ups Due ('+dueFollowups.length+')</div>'+
      dueFollowups.slice(0,2).map(b=>{
        const c=getClientById(b.client_id);
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border)">'+
          '<div style="font-size:13px;font-weight:600">'+escHtml(c?c.name:b.client_name||'Client')+'</div>'+
          '<div style="display:flex;gap:6px">'+
            (c&&c.phone?'<a href="sms:'+c.phone.replace(/\D/g,'')+'&body='+encodeURIComponent('Hi '+( c.name.split(' ')[0])+', just following up on your estimate — any questions?')+'" onclick="markFollowupSent('+b.id+');autoLogContact('+c.id+',\'followup_sent\')" style="padding:5px 10px;border-radius:20px;background:var(--blue-lt);color:var(--blue);font-size:11px;font-weight:700;text-decoration:none">Text</a>':'')+
          '</div>'+
        '</div>';
      }).join('')+
      (dueFollowups.length>2?'<div style="font-size:11px;color:var(--text3);padding-top:5px">+'+( dueFollowups.length-2)+' more in Leads</div>':'')+
      '</div>';
  }

  // Past-due jobs
  if(pastDue.length>0){
    sections+=
      '<div style="margin-bottom:14px">'+
      '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);margin-bottom:8px">Jobs That May Be Done</div>'+
      pastDue.slice(0,2).map(j=>{
        const c=getClientById(j.client_id);
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border)">'+
          '<div>'+
            '<div style="font-size:13px;font-weight:600">'+escHtml(c?c.name:'Client')+'</div>'+
            '<div style="font-size:11px;color:var(--text3)">Scheduled '+j.start+' · Was it finished?</div>'+
          '</div>'+
          '<button onclick="confirmJobDone('+j.id+')" style="padding:6px 12px;border-radius:20px;border:1px solid var(--green-mid);background:var(--green-lt);color:var(--green-mid);font-size:11px;font-weight:700;cursor:pointer;font-family:inherit">Mark done</button>'+
        '</div>';
      }).join('')+
      '</div>';
  }

  // Supply reminder for tomorrow
  if(tmrJobs.length>0){
    const tmrClients=tmrJobs.map(j=>{const c=getClientById(j.client_id);return c?c.name:'Job';}).slice(0,2).join(', ');
    // Find the first tomorrow job that has a paint estimate (surfaces data)
    const paintBid=tmrJobs.map(j=>j.bid_id?bids.find(b=>b.id===j.bid_id):null).find(b=>b&&(b.surfaces||[]).length>0);
    const checklistAction=paintBid
      ?'showSupplyList('+paintBid.id+');this.closest(\'.zmodal-overlay\').remove()'
      :'goPg(\'pg-checklist\');this.closest(\'.zmodal-overlay\').remove()';
    const checklistLabel=paintBid?'View supply list →':'View checklist →';
    sections+=
      '<div style="background:var(--blue-lt);border-radius:var(--r);padding:10px 12px;margin-bottom:14px">'+
        '<div style="font-size:12px;font-weight:700;color:var(--blue);margin-bottom:3px">🛒 Supply check for tomorrow</div>'+
        '<div style="font-size:12px;color:var(--text2)">Job'+(tmrJobs.length>1?'s':'')+': '+escHtml(tmrClients)+'</div>'+
        '<div style="margin-top:6px"><button onclick="'+checklistAction+'" style="padding:6px 14px;border-radius:20px;border:none;background:var(--blue);color:#fff;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit">'+checklistLabel+'</button></div>'+
      '</div>';
  }

  // Seasonal outreach
  if(seasonal.length>0){
    const mo=new Date(tk+'T12:00').getMonth()+1;
    const season=mo>=3&&mo<=5?'Spring painting season':'Fall season';
    sections+=
      '<div style="margin-bottom:14px">'+
      '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);margin-bottom:8px">'+season+' — Past Clients to Reach</div>'+
      seasonal.map(c=>{
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border)">'+
          '<div style="font-size:13px;font-weight:600">'+escHtml(c.name)+'</div>'+
          '<div style="display:flex;gap:6px">'+
            (c.phone?'<a href="sms:'+c.phone.replace(/\D/g,'')+'&body='+encodeURIComponent('Hi '+c.name.split(' ')[0]+', it\'s '+( S.bname||'ZJ\'s Painting')+'. '+season+' is a great time for exterior or interior work — want a quick quote?')+'" onclick="autoLogContact('+c.id+',\'seasonal_outreach\')" style="padding:5px 10px;border-radius:20px;background:var(--green-lt);color:var(--green-mid);font-size:11px;font-weight:700;text-decoration:none">Text</a>':'')+
          '</div>'+
        '</div>';
      }).join('')+
      '</div>';
  }

  // If nothing to show, skip modal (clean days)
  if(!sections&&schedItems&&schedItems.length===0){
    setTimeout(checkFridaySummary,800);
    return;
  }

  // If truly nothing (no sections built AND no schedule), still skip
  if(!sections){
    setTimeout(checkFridaySummary,800);
    return;
  }

  const ov=document.createElement('div');ov.className='zmodal-overlay';
  const box=document.createElement('div');box.className='zmodal';
  const todayFmt=new Date(tk+'T12:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});
  box.innerHTML=
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">'+
      '<div>'+
        '<div style="font-size:16px;font-weight:800">Good morning ☀️</div>'+
        '<div style="font-size:11px;color:var(--text3)">'+todayFmt+'</div>'+
      '</div>'+
      '<button onclick="this.closest(\'.zmodal-overlay\').remove()" style="width:30px;height:30px;border-radius:50%;border:1px solid var(--border);background:var(--bg2);font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--text2)">×</button>'+
    '</div>'+
    sections+
    '<button onclick="this.closest(\'.zmodal-overlay\').remove()" style="width:100%;padding:13px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;margin-top:4px">Let\'s get to work</button>';
  ov.appendChild(box);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});

  // Check Friday summary after briefing closes (without stacking another modal immediately)
  setTimeout(checkFridaySummary,2000);
}

// ── Auto-update: SW signals reload; auto-save draft first ────────────────────
function _showUpdateOverlay(){
  // Painted SYNCHRONOUSLY before any await/reload so the user never sees the
  // dashboard flash through during the save+reload window. Same look as the
  // boot overlay so reload feels seamless.
  if(document.getElementById('_update-ov'))return;
  const logo=S?.logoData||'';
  const name=S?.bname||'TradeDesk';
  const color=S?.brandColor||'#185FA5';
  const hasBrand=!!S?.brandColor;
  const bg=hasBrand?color:'#0D1117';
  const barFg=hasBrand?'rgba(0,0,0,0.35)':color;
  const barBg=hasBrand?'rgba(0,0,0,0.2)':'rgba(255,255,255,0.08)';
  const logoBlock=logo
    ?'<img src="'+logo+'" style="max-height:260px;max-width:86vw;width:auto;object-fit:contain;display:block;animation:td-logoin .35s cubic-bezier(.22,1,.36,1) both">'
    :'<div style="font-size:44px;font-weight:900;color:#fff;letter-spacing:-2px;animation:td-logoin .3s ease both">TradeDesk</div>';
  const ov=document.createElement('div');
  ov.id='_update-ov';
  ov.style.cssText='position:fixed;inset:0;z-index:99999;background:'+bg+';display:flex;flex-direction:column;align-items:center;justify-content:center';
  ov.innerHTML=
    '<div style="flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:18px;padding:0 24px">'+
      logoBlock+
    '</div>'+
    '<div style="width:100%;padding:0 0 52px">'+
      '<div style="height:3px;background:'+barBg+';border-radius:99px;margin:0 32px;overflow:hidden">'+
        '<div style="height:100%;background:'+barFg+';border-radius:99px;animation:td-bar 2.8s cubic-bezier(.4,0,.2,1) forwards"></div>'+
      '</div>'+
    '</div>';
  document.body.appendChild(ov);
}
let _reloadPending=false;
function _snapshotForms(){
  // Capture all visible form inputs so unsaved data (client form, expense
  // modal, log-trip modal, etc.) survives the auto-update reload.
  const snap={};
  const activePg=document.querySelector('.pg.active');
  if(activePg){
    activePg.querySelectorAll('input:not([type=hidden]):not([type=file]),textarea,select').forEach(el=>{
      if(el.id&&el.value)snap[el.id]=el.value;
    });
    snap._pg=activePg.id;
  }
  // Track if the new-client form was open (so we can re-open it on restore)
  const cfWrap=document.getElementById('client-form-wrap');
  if(cfWrap&&cfWrap.style.display!=='none'){
    snap._clientFormOpen=true;
    snap._editClientId=editClientId||null;
  }
  // Also capture any open modal overlays (expense, income, trip modals)
  document.querySelectorAll('.zmodal-overlay').forEach(modal=>{
    modal.querySelectorAll('input:not([type=hidden]):not([type=file]),textarea,select').forEach(el=>{
      if(el.id&&el.value)snap[el.id]=el.value;
    });
  });
  return snap;
}
async function _autoSaveAndReload(){
  if(_reloadPending)return; // SW_UPDATED + version.json poll can both fire — only the first wins
  _reloadPending=true;
  if(_devSupportMode){location.reload();return;} // dev's own data already saved on support entry — never push support user data to cloud
  document.body.style.visibility='hidden'; // hide current page during save — boot overlay handles the visual after reload
  // Snapshot any open forms before saving/reloading
  try{
    const snap=_snapshotForms();
    if(Object.keys(snap).length>1)localStorage.setItem('_form_snap',JSON.stringify(snap));
  }catch(e){}
  const activePg=document.querySelector('.pg.active')?.id||'';
  try{
    if(activePg==='pg-est')saveEstFullDraft();
    if(activePg==='pg-est-generic')saveGenericEstimate(true);
  }catch(e){}
  // Save resume state so we land back in the right place after reload
  if(activePg==='pg-est-generic'&&_geiEditBidId){
    localStorage.setItem('_sw_resume_bid',String(_geiEditBidId));
  }else if(activePg==='pg-est'&&editingBidId){
    localStorage.setItem('_sw_resume_bid',String(editingBidId));
  }
  // ALWAYS flush — even when _syncTimer is null, in-memory state may have
  // changes from a fire-and-forget save (saveLoggedTrip / saveEndDriveModal)
  // that hasn't completed yet. Awaiting an idempotent full-state push
  // guarantees the latest data is in the cloud before reload.
  if(_syncTimer){clearTimeout(_syncTimer);_syncTimer=null;}
  try{await supaSaveToCloud();}catch(e){}
  // Navigate to a timestamped URL so Chrome's HTTP cache has no entry to serve.
  // location.reload() respects the HTTP cache and can serve stale HTML forever.
  window.location.replace('/?_v='+Date.now());
}

// Catches pull-to-refresh, app close, app switch — fires synchronously when
// the page is about to be hidden/unloaded. Browser navigation kills the 2s
// debounce timer; this is the only reliable way to flush pending changes.
// ── Dev tools: receipt storage migration & recovery ───────────────────
window._migrateReceiptsToStorage=async function(){
  if(!_supa||!_supaUser){console.warn('Not signed in');return;}
  const pending=expenses.filter(e=>e.receipt_img&&!e.receipt_key);
  if(!pending.length){console.log('Nothing to migrate — all receipts already in bucket');return;}
  console.log('Migrating',pending.length,'receipts to storage...');
  let ok=0,fail=0;
  for(const e of pending){
    try{
      const b64=e.receipt_img.includes(',')?e.receipt_img.split(',')[1]:e.receipt_img;
      const key=await _uploadReceiptToStorage(e.id,b64);
      if(key){e.receipt_key=key;e.receipt_img=null;ok++;}
    }catch(err){console.warn('Failed expense',e.id,err);fail++;}
  }
  console.log('Done:',ok,'migrated,',fail,'failed');
  if(ok>0){_flushSaveNow();console.log('Saved to cloud.');}
};
window._restoreReceiptsFromStorage=async function(){
  if(!_supa||!_supaUser){console.warn('Not signed in');return;}
  const{data:files,error}=await _supa.storage.from('receipts').list(_supaUser.id,{limit:1000});
  if(error){console.error(error);return;}
  if(!files?.length){console.log('No files in bucket for this user');return;}
  const bucketIds=new Set(files.map(f=>parseInt(f.name)));
  let restored=0;
  expenses.forEach(e=>{
    if(!e.receipt_key&&bucketIds.has(e.id)){
      e.receipt_key=_supaUser.id+'/'+e.id+'.jpg';
      restored++;
    }
  });
  console.log('Restored receipt_key on',restored,'expenses');
  if(restored>0){_flushSaveNow();console.log('Saved.');}
};
window.addEventListener('pagehide',()=>{
  if(_syncTimer){clearTimeout(_syncTimer);_syncTimer=null;supaSaveToCloud();}
});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden&&_syncTimer){clearTimeout(_syncTimer);_syncTimer=null;supaSaveToCloud();}
});

// ── Persistent version check: fires every time app comes to foreground ────────
// Fetches the FULL HTML page with cache:'reload' — this bypasses the browser
// cache AND the SW's own cache (SW checks e.request.cache==='reload' and goes
// straight to network). The fresh HTML is stored into the SW cache so that the
// subsequent location.reload() is instant. We then extract the version string
// embedded in the fetched HTML and compare to the running APP_VERSION.
async function _checkVersionOnResume(){
  try{
    const r=await fetch(location.pathname,{cache:'reload'});
    if(!r.ok)return;
    const html=await r.text();
    const m=html.match(/const APP_VERSION='([^']+)'/);
    if(m&&m[1]!==APP_VERSION)await _autoSaveAndReload();
  }catch(e){}
}
// Fires on foreground resume — SW navigate handler covers fresh opens
document.addEventListener('visibilitychange',()=>{if(!document.hidden)_checkVersionOnResume();});

