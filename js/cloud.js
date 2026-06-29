let _stripeConnectStatus=null; // cached: {connected, charges_enabled, details_submitted, stripe_account_id}
Object.defineProperty(window,'_stripeConnectStatus',{get:()=>_stripeConnectStatus,set:v=>{_stripeConnectStatus=v;},configurable:true});

// ── Employee invite URL handling ─────────────────────────────────────────────
(function(){
  const params=new URLSearchParams(window.location.search);
  const raw=params.get('emp_invite');
  if(raw){
    try{
      const inv=JSON.parse(atob(raw));
      if(inv.cid&&inv.eid)localStorage.setItem('_pendingEmpInvite',JSON.stringify(inv));
    }catch(_e){}
    history.replaceState(null,'',window.location.pathname);
  }
})();

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
  if(!supaEnabled()){
    if(el)el.innerHTML='<div style="font-size:12px;color:var(--text3)">Cloud sync required to use Stripe Connect.</div>';
    return;
  }
  // _supaUser may be null on first settings open if the app loaded from cache (offline mode).
  // getSession() reads the token from localStorage instantly — no network needed.
  if(!_supaUser&&_supa){
    try{const{data:{session}}=await _supa.auth.getSession();if(session?.user)_supaUser=session.user;}catch(_e){}
  }
  if(!_supaUser){
    if(el)el.innerHTML=
      '<div style="font-size:12px;color:var(--text3);margin-bottom:10px;line-height:1.5">Sign in to your TradeDesk account to connect Stripe and accept card or bank payments.</div>'+
      '<button onclick="supaShowLogin({force:true})" style="border:none;background:var(--blue);color:#fff;border-radius:20px;padding:8px 16px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">Sign in to TradeDesk →</button>';
    return;
  }
  const data=await _fetchStripeConnectStatus();
  if(!data){if(el)el.innerHTML='<div style="font-size:12px;color:var(--red)">Could not check Stripe status.</div>';return;}
  if(el)_renderStripeConnectUI(el,data);
}

function _renderStripeConnectUI(el,data){
  if(!el)return;
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
  // Express connected accounts are managed at express.stripe.com, not dashboard.stripe.com
  window.open('https://express.stripe.com/','_blank');
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
        '<div style="font-size:12px;color:var(--text3);margin-bottom:14px">'+escHtml(c.name||'')+' · '+fmt(balance)+' due</div>'+
        '<div style="background:var(--bg);border:1px solid var(--border2);border-radius:var(--r);padding:10px 12px;font-size:12px;word-break:break-all;color:var(--text2);margin-bottom:14px;user-select:all">'+url+'</div>'+
        '<button onclick="navigator.clipboard.writeText(\''+url+'\').then(()=>showToast(\'Copied!\',\'📋\'));this.textContent=\'✓ Copied\'" style="width:100%;padding:12px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:8px">📋 Copy link</button>'+
        (c.phone?'<button onclick="this.closest(\'.zmodal-overlay\').remove();window.location.href=\'sms:\'+\''+c.phone.replace(/\D/g,'')+'\'+\'?body=\'+encodeURIComponent(\'Hi '+escHtml(c.name.split(' ')[0])+', here\\\'s your payment link for '+fmt(balance)+' owed to '+(S.bname||'us')+': '+url+' — Thank you!\')" style="width:100%;padding:12px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;margin-bottom:8px">📱 Open in Messages</button>':'')+
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
      // Seed from accounts only when S is empty — S (zj_data.settings + localStorage)
      // is the source of truth once the user has saved Settings. Overwriting here
      // reverted every Settings save back to the onboarding values on reload.
      const _seeded=[];
      if(_account?.business_name&&!S.bname){S.bname=_account.business_name;_seeded.push('bname');}
      if(_account?.phone&&!S.bphone){S.bphone=_account.phone;_seeded.push('bphone');}
      if(_account?.license_info&&!S.blic){S.blic=_account.license_info;_seeded.push('blic');}
      if(_account?.state&&!S.state){S.state=_account.state;_seeded.push('state');}
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
      if(typeof _applyEmployeeNavGating==='function')_applyEmployeeNavGating();
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
      if(typeof _applyEmployeeNavGating==='function')_applyEmployeeNavGating();
      localStorage.removeItem('_pendingEmpInvite');
      showToast('Welcome to the team, '+escHtml(inviteRow.name||'there')+'! 👋','✅');
      try{localStorage.setItem('zp3_acct_'+_supaUser.id,JSON.stringify({user:_user,activeTrade:'painting',isEmployee:true,contractorUserId:_contractorUserId}));}catch(_e){}
      return true;
    }
    // No team_members row — try _pendingEmpInvite as a fallback (covers cases where
    // the contractor's invite flow didn't write a team_members row before this fix)
    const _pi=JSON.parse(localStorage.getItem('_pendingEmpInvite')||'null');
    if(_pi?.cid){
      const{error:_piErr}=await _supa.from('team_members').upsert({contractor_user_id:_pi.cid,email:_supaUser.email,employee_user_id:_supaUser.id,active:true,joined_at:new Date().toISOString()},{onConflict:'contractor_user_id,email'});
      if(!_piErr){
        _isEmployee=true;_contractorUserId=_pi.cid;
        _employeeRecord={contractor_user_id:_pi.cid,email:_supaUser.email,employee_user_id:_supaUser.id,active:true};
        _user={id:_supaUser.id,email:_supaUser.email,name:'',role:'tech',account_id:null};
        applyPermissions();
        if(typeof _applyEmployeeNavGating==='function')_applyEmployeeNavGating();
        localStorage.removeItem('_pendingEmpInvite');
        showToast('Welcome to the crew! 👋','✅');
        try{localStorage.setItem('zp3_acct_'+_supaUser.id,JSON.stringify({user:_user,activeTrade:'painting',isEmployee:true,contractorUserId:_contractorUserId}));}catch(_e){}
        return true;
      }
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
        if(_ac.account){_account=_ac.account;if(_account.business_name&&!S.bname)S.bname=_account.business_name;if(_account.phone&&!S.bphone)S.bphone=_account.phone;}
        if(_ac.config)_config=_ac.config;
        _renderNavTradeSwitcher();applyPermissions();
        if(_isEmployee&&typeof _applyEmployeeNavGating==='function')_applyEmployeeNavGating();
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
    licenses:[...licenses],events:[...events],contracts:[...contracts],agreements:[...agreements],photos:[...photos],
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
  ({clients,bids,jobs,payments,liens,income,expenses,mileage,timeEntries,licenses,events,contracts,agreements,photos}=_devSavedState);
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
// Supabase endpoint. DEFAULT = DIRECT to Supabase — validated on AT&T Fiber (the exact
// network §15.2's /api proxy was built for), which now resolves *.supabase.co fine.
// Direct pays ZERO Cloudflare /api cost. The /api Pages-Function proxy is RETAINED as
// the safety net, reached two ways:
//   (a) explicit override: ?supadirect=0 (persists) forces the proxy; ?supadirect=1 forces direct.
//   (b) AUTO-FALLBACK (supaInit): if direct is unreachable on a network (can't DNS-resolve
//       / blocked), the boot probe silently switches THIS session to the proxy so the app
//       still loads. So even an untested carrier self-heals — direct where it works, proxy
//       where it must, never an outage.
const _SUPA_DIRECT_URL = 'https://mwtsmctajhrrybblgorf.supabase.co';
const _SUPA_PROXY_URL = location.origin + '/api';
(function(){try{const p=new URLSearchParams(location.search);const v=p.get('supadirect');
  if(v==='1')localStorage.setItem('zp3_supa_mode','direct');
  if(v==='0')localStorage.setItem('zp3_supa_mode','proxy');
}catch(_e){}})();
const _supaMode=(()=>{try{return localStorage.getItem('zp3_supa_mode');}catch(_e){return null;}})();
// `let` so the supaInit auto-fallback can flip it to the proxy before the client is built.
let SUPA_URL = (_supaMode==='proxy') ? _SUPA_PROXY_URL : _SUPA_DIRECT_URL;
const SUPA_KEY = 'sb_publishable_kaahEa5tFydocUuYi8plHg_K78HPyvJ';
const APP_VERSION='06.28.26.47';
let _supa=null,_supaUser=null,_syncTimer=null,_syncStatus='local',_supaCloudLoaded=false,_lastLocalSaveAt=0;
let _syncBroadcastChannel=null,_realtimeSubscribed=false,_loadInProgress=false,_broadcastReloadTimer=null,_broadcastPending=false;
const _deviceId=Math.random().toString(36).slice(2,10);
// Expose sync state and auth objects on window so E2E tests can observe/stub them
Object.defineProperty(window,'_syncStatus',{get:()=>_syncStatus,configurable:true});
Object.defineProperty(window,'_supaCloudLoaded',{get:()=>_supaCloudLoaded,configurable:true});
Object.defineProperty(window,'_supa',{get:()=>_supa,set:v=>{_supa=v;},configurable:true});
Object.defineProperty(window,'_supaUser',{get:()=>_supaUser,set:v=>{_supaUser=v;},configurable:true});

// Tracks IDs present in each table after the last successful load or save.
// Used to detect deletions (record in _lastKnownIds but not in current array).
let _lastKnownIds={
  td_clients:new Set(),td_bids:new Set(),td_jobs:new Set(),
  td_income:new Set(),td_expenses:new Set(),td_mileage:new Set(),
  td_payments:new Set(),td_liens:new Set(),td_time_entries:new Set(),
  td_licenses:new Set(),td_events:new Set(),td_contracts:new Set(),td_agreements:new Set(),td_photos:new Set()
};

// CONCURRENCY-SAFE SWEEP (CLAUDE.md §9.8). The cloud save soft-deletes rows that
// "disappeared" from this device's snapshot. Inferring deletes that way clobbers
// concurrent devices: a peer's brand-new row, not yet merged here, looks "missing"
// and gets deleted. Instead we soft-delete ONLY ids the user EXPLICITLY deleted on
// THIS device, recorded here at each delete site via _recordLocalDelete(). A row
// merely absent (a peer's, not-yet-synced) is never swept. Even bulk wipes
// (clearAllData / clear*Only) just go through _userDelete, which records every id
// that vanished — no special flag needed, and it survives the deferred async save.
let _locallyDeletedIds={
  td_clients:new Set(),td_bids:new Set(),td_jobs:new Set(),
  td_income:new Set(),td_expenses:new Set(),td_mileage:new Set(),
  td_payments:new Set(),td_liens:new Set(),td_time_entries:new Set(),
  td_licenses:new Set(),td_events:new Set(),td_contracts:new Set(),td_agreements:new Set(),td_photos:new Set()
};
// Record an explicit local delete so the next save propagates it (and ONLY it).
// Call with the synced table name + the id(s) removed from that table's array —
// INCLUDING cascade removals (deleting a client also removes its bids/jobs/… → record
// each under its own table). Safe no-op for unknown tables / empty ids.
function _recordLocalDelete(tbl,...ids){
  if(!_locallyDeletedIds[tbl])return;
  ids.forEach(id=>{if(id!==undefined&&id!==null)_locallyDeletedIds[tbl].add(String(id));});
}

// Wrap a user-initiated delete action: snapshot every synced array's ids, run the
// delete (its synchronous array mutations + any cascade), then record EVERY id that
// disappeared as an explicit delete. Because the mutations are synchronous, nothing
// else can change the arrays between snapshot and diff, so this captures exactly what
// the user deleted — cascades included — and nothing a concurrent peer touched.
// Usage: wrap the function body's mutation+save, e.g.
//   function deleteBid(id){ if(!confirm)return; _userDelete(()=>{ bids=bids.filter(b=>b.id!==id); saveAll(); }); }
function _userDelete(fn){
  const before={};
  for(const t of _TD_TABLES){ try{ before[t.t]=new Set((t.get()||[]).map(r=>String(r.id))); }catch(_e){ before[t.t]=new Set(); } }
  const ret=fn();
  for(const t of _TD_TABLES){
    let now; try{ now=new Set((t.get()||[]).map(r=>String(r.id))); }catch(_e){ continue; }
    before[t.t].forEach(id=>{ if(!now.has(id)) _recordLocalDelete(t.t,id); });
  }
  return ret;
}

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
  {t:'td_agreements',  get:()=>agreements,  set:v=>{agreements.length=0;v.forEach(r=>agreements.push(r));}, tx:null},
  {t:'td_photos',      get:()=>photos,      set:v=>{photos.length=0;v.forEach(r=>photos.push(r));},
    tx:arr=>arr.filter(p=>p.storagePath||p.url).map(({id,url,storagePath,type,caption,client_id,client_name,job_id,job_name,uploadedAt})=>({id,url,storagePath:storagePath||'',type,caption,client_id,client_name,job_id,job_name,uploadedAt}))},
];
// True when a Supabase error means "this table doesn't exist in the DB yet" — e.g. a
// new feature table on a deploy that runs ahead of its migration. Both preview and
// production proxy to the SAME Supabase project, so an unmerged migration means the
// table is absent for everyone. Such an error must never abort load/save — that would
// trap every device in an offline loop. Real errors (auth, network) are not matched.
function _isMissingTableErr(err){
  return !!err&&(err.code==='42P01'||err.code==='PGRST205'||/does not exist|could not find the table|schema cache/i.test(err.message||''));
}

// Tables whose money fields are redacted for the CURRENT employee session, derived
// from their team permissions (the SAME matrix the server RPC load_account_data
// enforces). Used in TWO places that MUST agree:
//   1. The server zeroes these tables' money keys on load.
//   2. supaSaveToCloud SKIPS writing these tables back — so a redacted (zeroed)
//      array can NEVER overwrite the contractor's real amounts. This guard is
//      permission-derived, not RPC-derived, so corruption is impossible even
//      before the RPC migration reaches production (where load falls back to the
//      raw, unredacted select). Contractors (not _isEmployee) redact nothing.
function _employeeRedactedTables(){
  if(!_isEmployee)return new Set();
  const p=(_employeeRecord&&_employeeRecord.permissions)||{};
  const fin=!!p.financials;
  const red=new Set();
  if(!(fin||p.estimate))red.add('td_bids');
  if(!fin)             red.add('td_income');
  if(!(fin||p.collect))red.add('td_payments');
  if(!(fin||p.collect))red.add('td_liens');
  if(!(fin||p.expenses))red.add('td_expenses');
  if(!(fin||p.mileage))red.add('td_mileage');
  return red;
}

// ── Long-press delete (3s hold on any [data-lp-id] element) ────────────────
let _lpTimer=null,_lpFired=false,_lpStartX=0,_lpStartY=0;
(function(){
  const s=document.createElement('style');
  s.textContent='[data-lp-id]{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;}';
  (document.head||document.documentElement).appendChild(s);
  function _lpStart(e){
    const row=e.target.closest('[data-lp-id]');
    if(!row)return;
    if(e.target.closest('button,select,input,a,label'))return;
    clearTimeout(_lpTimer);_lpFired=false;
    const t=e.touches?e.touches[0]:e;
    _lpStartX=t.clientX;_lpStartY=t.clientY;
    _lpTimer=setTimeout(()=>{_lpTimer=null;_lpFired=true;_showLpDeletePopup(row);},3000);
  }
  function _lpMove(e){
    if(!_lpTimer)return;
    const t=e.touches?e.touches[0]:e;
    if(Math.abs(t.clientX-_lpStartX)>8||Math.abs(t.clientY-_lpStartY)>8){clearTimeout(_lpTimer);_lpTimer=null;}
  }
  function _lpCancel(){clearTimeout(_lpTimer);_lpTimer=null;}
  document.addEventListener('touchstart',_lpStart,{passive:true});
  document.addEventListener('touchend',_lpCancel);
  document.addEventListener('touchmove',_lpMove,{passive:true});
  document.addEventListener('mousedown',_lpStart);
  document.addEventListener('mouseup',_lpCancel);
  document.addEventListener('mousemove',_lpMove);
  document.addEventListener('click',e=>{if(_lpFired){_lpFired=false;e.stopPropagation();e.preventDefault();}},true);
  document.addEventListener('contextmenu',e=>{if(e.target.closest('[data-lp-id]'))e.preventDefault();});
})();
function _showLpDeletePopup(row){
  _lpFired=false; // reset immediately — popup buttons must not be swallowed by capture handler
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
  if(type==='income'){_userDelete(()=>{income=income.filter(x=>x.id!==nid);_flushSaveNow&&_flushSaveNow();});if(typeof renderIncome==='function')renderIncome();}
  else if(type==='payment'){_userDelete(()=>{payments=payments.filter(x=>x.id!==nid);_flushSaveNow&&_flushSaveNow();});if(typeof renderIncome==='function')renderIncome();}
  else if(type==='expense'){if(typeof delExpense==='function')delExpense(nid);}
  else if(type==='mileage'){if(typeof delMileage==='function')delMileage(nid);}
  else if(type==='lead'||type==='client'){_lpDeleteClientById(nid,type);}
  else if(type==='bid'){
    // Mirror deleteBid()'s cascade so a long-pressed proposal is fully cleaned up:
    // its payment records and any lien go with it, and every surface re-renders.
    const _delBid=bids.find(x=>x.id===nid);const _delClientId=_delBid?_delBid.client_id:null;
    _userDelete(()=>{
      bids=bids.filter(x=>x.id!==nid);
      if(typeof payments!=='undefined')payments=payments.filter(p=>p.bid_id!==nid);
      if(typeof liens!=='undefined')liens=liens.filter(l=>l.bid_id!==nid);
      _flushSaveNow&&_flushSaveNow();
    });
    if(typeof renderClientDetail==='function')renderClientDetail();
    if(typeof renderJobsHistory==='function')renderJobsHistory();
    if(typeof renderJobsPage==='function')renderJobsPage();
    if(typeof renderCalendar==='function')renderCalendar();
    if(typeof renderDash==='function')renderDash();
    if(_delClientId&&typeof _uploadClientHub==='function')_uploadClientHub(_delClientId).catch(()=>{});
  }
  else if(type==='job'){
    // Remove a single scheduled job/calendar event (jobs array record).
    _userDelete(()=>{
      jobs=jobs.filter(x=>x.id!==nid);
      _flushSaveNow&&_flushSaveNow();
    });
    if(typeof renderClientDetail==='function')renderClientDetail();
    if(typeof renderCalendar==='function')renderCalendar();
    if(typeof renderJobsPage==='function')renderJobsPage();
    if(typeof renderDash==='function')renderDash();
  }
}
function _lpDeleteClientById(id,fromType){
  _userDelete(()=>{
    clients=clients.filter(x=>x.id!==id);
    bids=bids.filter(b=>b.client_id!==id);
    jobs=jobs.filter(j=>j.client_id!==id);
    mileage=mileage.filter(m=>m.client_id!==id);
    income=income.filter(i=>i.client_id!==id);
    expenses=expenses.filter(e=>e.client_id!==id);
    _flushSaveNow&&_flushSaveNow();
  });
  if(fromType==='lead'){if(typeof renderLeadsPage==='function')renderLeadsPage();}
  else{if(typeof renderClientList==='function')renderClientList();}
}

let _proposalViews={};
let _proposalViewsByBid={};
// Three separate timestamp maps per bid_id — each tracks a distinct open event:
let _proposalViewsByBidHubClient={};   // client opened the shared hub link (client.html)
let _proposalViewsByBidClient={};      // client opened a specific proposal (sign.html)
let _proposalViewsByBidContractor={};  // contractor previewed the proposal
// View count maps — how many times each event type has occurred per bid
let _proposalViewsByBidHubCount={};    // number of hub opens
let _proposalViewsByBidClientCount={}; // number of proposal opens
// Expose on window so Playwright E2E tests can inject test data via page.evaluate()
// (let declarations are not window properties in browser scripts)
Object.defineProperty(window,'_proposalViewsByBidHubClient',{get:()=>_proposalViewsByBidHubClient,set:v=>{_proposalViewsByBidHubClient=v;},configurable:true});
Object.defineProperty(window,'_proposalViewsByBidClient',{get:()=>_proposalViewsByBidClient,set:v=>{_proposalViewsByBidClient=v;},configurable:true});
Object.defineProperty(window,'_proposalViewsByBidContractor',{get:()=>_proposalViewsByBidContractor,set:v=>{_proposalViewsByBidContractor=v;},configurable:true});
Object.defineProperty(window,'_proposalViewsByBidHubCount',{get:()=>_proposalViewsByBidHubCount,set:v=>{_proposalViewsByBidHubCount=v;},configurable:true});
Object.defineProperty(window,'_proposalViewsByBidClientCount',{get:()=>_proposalViewsByBidClientCount,set:v=>{_proposalViewsByBidClientCount=v;},configurable:true});
// true when data came from localStorage cache, not a live Supabase fetch.
// supaSaveToCloud() checks this + runs a sanity guard to prevent pushing
// incomplete in-memory state over real cloud data.
let _loadedFromCacheOnly=false;
let _mergeOnSignIn=false; // true when offline data in memory needs merging after SIGNED_IN
let _loadedDataOwner=null; // user id whose business data is currently in memory (cross-account guard)
let _cloudTimersStarted=false; // prevent duplicate setInterval/addEventListener on PTR re-load
let _checkSigsBusy=false;      // prevent concurrent clawback writes
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
    // Employee vehicle picker (after boot, if not already selected today)
    setTimeout(()=>{
      if(typeof _checkEmployeeVehiclePicker==='function')_checkEmployeeVehiclePicker();
      // Crew location tracking — inits if the contractor enabled it and the person
      // (employee or the owner tracking their own time) consents; shown after the
      // vehicle picker so they don't stack. Business-hours gating is in _geoTrackInit().
      if(typeof _geoTrackInit==='function')setTimeout(_geoTrackInit,1400);
    },700);
  },320);
}
// One-time recovery snapshot — runs the instant the app boots, BEFORE any cloud
// load can overwrite zp3_cloud_cache. Freezes the device's current local data into
// an untouchable key so a destructive sign-in merge can never erase it. Recoverable
// per-bid via recoverBidRooms() / the "Recover rooms" button. Never overwritten once
// written (the first boot after a data loss is the one that still holds the good copy).
function _captureRecoverySnapshot(){
  try{
    if(localStorage.getItem('zp3_recovery_snapshot'))return; // already frozen — never clobber
    const snap={
      ts:Date.now(),
      cloud_cache:localStorage.getItem('zp3_cloud_cache')||null,
      est_full_draft:localStorage.getItem('zp3_est_full_draft')||null,
      surf_draft:localStorage.getItem('zp3_surf_draft')||null,
      offline_pending:localStorage.getItem('zp3_offline_pending')||null,
    };
    // Only persist if there is at least one source with data — avoids freezing an empty snapshot
    if(snap.cloud_cache||snap.est_full_draft||snap.surf_draft||snap.offline_pending){
      localStorage.setItem('zp3_recovery_snapshot',JSON.stringify(snap));
    }
  }catch(_e){}
}
// Count of distinct rooms/surfaces on a bid — used to decide which copy of a bid is
// "richer" so a merge or recovery never replaces a fuller record with a sparser one.
function _bidRichness(b){
  if(!b)return -1;
  const surf=Array.isArray(b.surfaces)?b.surfaces.length:0;
  const rooms=(b.roomScopeMap&&typeof b.roomScopeMap==='object')?Object.keys(b.roomScopeMap).length:0;
  return surf*100+rooms; // surfaces weighted heavier — they are the measurements that get lost
}
// Pick the authoritative copy when the same bid id exists in two places: newest
// `updated` stamp wins; if stamps tie or are missing, the richer copy wins.
function _pickBid(a,b){
  if(!a)return b;if(!b)return a;
  const ua=+a.updated||0, ub=+b.updated||0;
  if(ua!==ub)return ua>ub?a:b;
  return _bidRichness(a)>=_bidRichness(b)?a:b;
}
// Scan all local recovery sources for a copy of `bidId` richer than the one in memory,
// and restore its surfaces + roomScopeMap. Returns true if anything was recovered.
function recoverBidRooms(bidId){
  const live=bids.find(x=>String(x.id)===String(bidId));
  if(!live){if(typeof showToast==='function')showToast('Bid not found','⚠️');return false;}
  const candidates=[];
  const _pushFromBlob=(raw)=>{
    if(!raw)return;
    try{const d=JSON.parse(raw);
      if(Array.isArray(d.bids)){const m=d.bids.find(x=>String(x.id)===String(bidId));if(m)candidates.push(m);}
    }catch(_e){}
  };
  const _pushFromDraft=(raw)=>{
    if(!raw)return;
    try{const d=JSON.parse(raw);
      // est_full_draft holds the in-progress estimate; only adopt it if it targets this bid
      if((d.lastBidId&&String(d.lastBidId)===String(bidId))||(d.clientId&&String(d.clientId)===String(live.client_id))){
        candidates.push({id:bidId,surfaces:d.surfaces||[],roomScopeMap:d.roomScopeMap||{}});
      }
    }catch(_e){}
  };
  // 1) Frozen recovery snapshot (captured at boot — the safest source)
  let snap=null;try{snap=JSON.parse(localStorage.getItem('zp3_recovery_snapshot')||'null');}catch(_e){}
  if(snap){_pushFromBlob(snap.cloud_cache);_pushFromBlob(snap.offline_pending);_pushFromDraft(snap.est_full_draft);}
  // 2) Live local sources (may already be overwritten, but harmless to check)
  _pushFromBlob(localStorage.getItem('zp3_cloud_cache'));
  _pushFromBlob(localStorage.getItem('zp3_offline_pending'));
  _pushFromDraft(localStorage.getItem('zp3_est_full_draft'));
  // Choose the richest candidate that beats what's in memory now
  let best=null;
  candidates.forEach(c=>{if(_bidRichness(c)>_bidRichness(best))best=c;});
  if(!best||_bidRichness(best)<=_bidRichness(live)){
    if(typeof showToast==='function')showToast('No richer copy found to recover','ℹ️');
    return false;
  }
  if(Array.isArray(best.surfaces)&&best.surfaces.length)live.surfaces=JSON.parse(JSON.stringify(best.surfaces));
  if(best.roomScopeMap&&Object.keys(best.roomScopeMap).length)live.roomScopeMap=JSON.parse(JSON.stringify(best.roomScopeMap));
  live.updated=Date.now();
  saveAll();
  if(typeof renderClientDetail==='function')renderClientDetail();
  if(typeof showToast==='function')showToast('Recovered '+(Array.isArray(best.surfaces)?best.surfaces.length:0)+' surfaces','✅');
  return true;
}
window.recoverBidRooms=recoverBidRooms;

async function supaInit(){
  if(!supaEnabled())return;
  _captureRecoverySnapshot(); // FIRST — freeze local data before any cloud load can overwrite it
  // AUTO-FALLBACK: if we're set to talk DIRECT to Supabase, confirm this network can
  // actually reach it before building the client. A 2.5s health probe — any HTTP
  // response (even 401) means reachable → stay direct; a DNS/network/timeout error
  // means this carrier can't resolve *.supabase.co → silently switch to the /api proxy
  // for this session so the app still loads. The probe runs only in direct mode, so
  // proxy-forced sessions pay nothing.
  if(SUPA_URL===_SUPA_DIRECT_URL){
    let _directOk=false;
    try{
      const _c=new AbortController();const _t=setTimeout(()=>_c.abort(),2500);
      await fetch(_SUPA_DIRECT_URL+'/auth/v1/health',{signal:_c.signal});
      clearTimeout(_t);_directOk=true;
    }catch(_e){_directOk=false;}
    if(!_directOk){SUPA_URL=_SUPA_PROXY_URL;try{localStorage.setItem('zp3_supa_fellback','1');}catch(_e2){}}
  }
  try{
    _supa=supabase.createClient(SUPA_URL,SUPA_KEY,{
      auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,storage:window.localStorage}
    });
    // Realtime connects straight to Supabase — WebSocket proxying through
    // Cloudflare Pages is unreliable, and a dead socket silently kills
    // cross-device live sync. REST now ALSO defaults to direct (see SUPA_URL);
    // the /api proxy is the auto-fallback when direct can't be reached. If the
    // direct socket fails, the 30s zj_data poll covers it.
    try{_supa.realtime.endPoint='wss://mwtsmctajhrrybblgorf.supabase.co/realtime/v1/websocket';}catch(_e){}
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
        if(typeof _fetchScopeRates==='function')_fetchScopeRates();
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
          if(_cd._owner)_loadedDataOwner=_cd._owner; // tag whose data is in memory (cross-account guard)
          clients=_cd.clients||[];bids=_cd.bids||[];jobs=_cd.jobs||[];
          payments=_cd.payments||[];income=_cd.income||[];expenses=_cd.expenses||[];
          mileage=_cd.mileage||[];liens=_cd.liens||[];timeEntries=_cd.timeEntries||[];
          if(_cd.licenses?.length)licenses=_cd.licenses;
          if(_cd.events?.length)events=_cd.events;
          if(_cd.contracts?.length)contracts=_cd.contracts;if(_cd.agreements?.length)agreements=_cd.agreements;
          if(_cd.photos?.length)photos=_cd.photos;
          if(_cd.checksState&&Object.keys(_cd.checksState).length)checksState=_cd.checksState;
          if(_cd.settings){_mergeIncomingSettings(_cd.settings,'zp3_cloud_cache (no-session boot)');applySettings();_refillSettingsFormUnlessEditing();}
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
        // Different account than the data currently in memory — full reset before loading.
        // Compare against _loadedDataOwner (not _supaUser): after an involuntary SIGNED_OUT
        // (token expiry) _supaUser is null yet the previous account's records are still in
        // memory, so checking _supaUser alone would miss the swap and bleed data across.
        const _incomingId=session.user.id;
        if((_loadedDataOwner&&_incomingId!==_loadedDataOwner)||(_supaCloudLoaded&&_supaUser&&_incomingId!==_supaUser.id)){
          _supaCloudLoaded=false;_mergeOnSignIn=false;_realtimeSubscribed=false;_loadInProgress=false;
          clearTimeout(_syncTimer);_syncTimer=null;
          _devSupportMode=false;_devSupportName='';_devSavedState=null;
          // Wipe the outgoing account's in-memory records so they can't be merged/pushed up.
          clients=[];bids=[];jobs=[];payments=[];income=[];expenses=[];mileage=[];liens=[];
          localStorage.removeItem('zp3_offline_pending');
          _loadedDataOwner=null;
          // Previous user's settings timestamp must never beat this user's cloud copy
          S.settingsTs=0;
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
          // _readOwnedOfflinePending() discards (and clears) any blob owned by a different
          // account, so foreign offline data can never be folded into this account.
          const _op=_readOwnedOfflinePending();
          const _hasPendingData=!!_op;
          if(_mergeOnSignIn||_hasPendingData){
            _mergeOnSignIn=false;
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
            const _jSet=new Set(jobs.map(j=>j.id));
            let _merged=false;
            _oClients.filter(c=>!_cSet.has(c.id)).forEach(c=>{clients.push(c);_merged=true;});
            _oJobs.filter(j=>!_jSet.has(j.id)).forEach(j=>{jobs.push(j);_merged=true;});
            // BIDS: non-destructive merge. The cloud copy must NEVER blindly replace a
            // local copy of the same id — a stale cloud draft (e.g. saved before its room
            // measurements existed) would otherwise erase the complete local record.
            // For each id, keep whichever copy is newer (updated stamp) or richer (more
            // surfaces/rooms). This is the fix for the Adam-Ryder room-data loss.
            const _cloudBidById=new Map(bids.map(b=>[String(b.id),b]));
            _oBids.forEach(ob=>{
              const key=String(ob.id);
              const cb=_cloudBidById.get(key);
              if(!cb){bids.push(ob);_cloudBidById.set(key,ob);_merged=true;return;}
              const winner=_pickBid(ob,cb);
              if(winner!==cb){
                const idx=bids.findIndex(x=>String(x.id)===key);
                if(idx>-1)bids[idx]=winner;
                _cloudBidById.set(key,winner);
                _merged=true;
              }
            });
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
          // Re-render Stripe Connect UI if settings is open (was showing "sign in" while session refreshed)
          if(document.getElementById('pg-settings')?.classList.contains('active'))loadStripeConnectStatus();
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
          // Clear the cross-account merge state. _mergeOnSignIn stays true after any offline
          // period; zp3_offline_pending holds THIS account's full data blob. If either survives
          // a deliberate sign-out, the next account to sign in triggers the SIGNED_IN merge path
          // (line ~696) and this account's records get pushed into theirs. Hard-clear both, plus
          // the cloud cache, so no data from this account can leak into the next one.
          _mergeOnSignIn=false;_loadedFromCacheOnly=false;_loadedDataOwner=null;
          localStorage.removeItem('zp3_offline_pending');
          localStorage.removeItem('zp3_cloud_cache');
          clients=[];bids=[];jobs=[];payments=[];income=[];expenses=[];mileage=[];liens=[];
          // settingsTs:0 — zp3_S is shared across accounts on this device. Without
          // zeroing the timestamp, these blanked settings beat the next account's
          // cloud copy in _mergeIncomingSettings and then get pushed up, wiping
          // their saved business info.
          S={...S,bname:'',bphone:'',blic:'',bemail:'',vehicles:[],weatherLat:null,weatherLon:null,locationDenied:false,settingsTs:0};
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
        if(_cd.contracts?.length)contracts=_cd.contracts;if(_cd.agreements?.length)agreements=_cd.agreements;
        if(_cd.photos?.length)photos=_cd.photos;
        if(_cd.checksState&&Object.keys(_cd.checksState).length)checksState=_cd.checksState;
        if(_cd.settings){_mergeIncomingSettings(_cd.settings,'zp3_cloud_cache (offline boot, session present)');applySettings();_refillSettingsFormUnlessEditing();}
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
const ROLE_COLORS={owner:'#185FA5',painter:'#3B6D11',estimator:'#8B4513',tech:'#2D5DA8',office:'#5B3BA3',manager:'#185FA5'};
const ROLE_BG={owner:'#EBF2FB',painter:'#EAF3DE',estimator:'#FFF0E0',tech:'#DCE8FA',office:'#EDE8FA',manager:'#EBF2FB'};

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
  // saveAll, NOT saveSettings — this runs at every boot, before the settings
  // form is ever filled. saveSettings() here harvested the EMPTY form and wiped
  // every saved setting on each app open (then pushed the wiped copy to cloud
  // with a fresh settingsTs, beating the user's real saves on every device).
  // No settingsTs bump either: at boot the local copy may be stale — claiming
  // "newest" here would make stale data beat the cloud copy in the merge.
  saveAll();
  // Capture GPS if explicitly requested or first time registering
  if(updateLocation||idx===-1){
    geoIfGranted(pos=>{
      const devIdx=S.devices.findIndex(d=>d.id===id);
      if(devIdx>-1){
        S.devices[devIdx].lat=pos.coords.latitude;
        S.devices[devIdx].lon=pos.coords.longitude;
        S.devices[devIdx].locAt=now;
        saveAll(); // direct S mutation — never harvest the form outside the Settings UI
        const tpl=document.getElementById('team-page-devices');
        const tsl=document.getElementById('device-list');
        if(tpl||tsl)renderTeam();
      }
    });
  }
}
// ── Employee Invite Flow ─────────────────────────────────────────────────────
const _EMP_ROLE_PRESETS={
  tech:    {collect:true,expenses:true,mileage:true},
  office:  {leads:true,clients:true,estimate:true,schedule:true,collect:true},
  manager: {leads:true,estimate:true,schedule:true,clients:true,collect:true,expenses:true,mileage:true,team:true,payroll:true},
  owner:   {leads:true,estimate:true,schedule:true,clients:true,collect:true,expenses:true,mileage:true,financials:true,team:true,payroll:true}
};
const _EMP_PERM_INFO={
  leads:'Sees the Leads page and can add follow-up notes, update lead status, and schedule estimates. For office staff making outbound calls.',
  estimate:'Creates proposals, runs the estimate builder, and sends to clients for signing.',
  schedule:'Updates job dates on the calendar and changes job status (scheduled → active → complete).',
  collect:'Records cash or check payments and sends pay links to clients for an outstanding balance.',
  clients:'Adds new clients and edits contact info, addresses, and notes. Cannot delete clients.',
  expenses:'Adds expense receipts — for field workers buying materials or supplies on the job.',
  mileage:'Logs drive trips for IRS deduction tracking and reimbursement.',
  financials:'Sees the Books page, income/expense totals, P&L, and tax estimates. Off by default for most field workers.',
  team:'Adds and invites team members and manages company vehicles. Usually managers only.',
  payroll:'Sees and edits employee pay rates and the crew location map, and views the Job Profit report. Highly sensitive — managers only. Pay rates are never visible to employees without this.'
};
const _EMP_PERM_LABELS={
  leads:'Work leads',estimate:'Estimate jobs',schedule:'Schedule jobs',collect:'Collect payments',
  clients:'Edit clients',expenses:'Log expenses',mileage:'Log mileage',
  financials:'View financials',team:'Manage team',payroll:'Pay & profit'
};
const _EMP_CLASSIFICATIONS=['','Apprentice','Journeyman','Master','Foreman / Lead','Helper','Subcontractor'];
function _togglePermInfo(id){const el=document.getElementById(id);if(el)el.style.display=el.style.display==='block'?'none':'block';}
function _setEmpRolePreset(role){
  const preset=_EMP_ROLE_PRESETS[role]||{};
  Object.keys(_EMP_PERM_LABELS).forEach(p=>{
    const el=document.getElementById('_perm-'+p);
    if(el)el.checked=!!preset[p];
  });
}
function openInviteEmployeeModal(){
  document.getElementById('_emp-invite-ov')?.remove();
  const ov=document.createElement('div');ov.id='_emp-invite-ov';ov.className='zmodal-overlay';
  const box=document.createElement('div');box.className='zmodal';
  const permRows=Object.keys(_EMP_PERM_LABELS).map(p=>{
    const label=escHtml(_EMP_PERM_LABELS[p]);
    const info=escHtml(_EMP_PERM_INFO[p]);
    return '<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">'+
      '<input type="checkbox" id="_perm-'+p+'" style="width:20px;height:20px;margin-top:1px;flex-shrink:0;accent-color:var(--blue);cursor:pointer">'+
      '<div style="flex:1;min-width:0">'+
        '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">'+
          '<label for="_perm-'+p+'" style="font-size:14px;font-weight:600;cursor:pointer">'+label+'</label>'+
          '<button onclick="_togglePermInfo(\'_pi-'+p+'\')" style="width:18px;height:18px;border-radius:50%;border:1px solid var(--border2);background:var(--bg2);color:var(--text3);font-size:10px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;padding:0;font-family:inherit;line-height:1">i</button>'+
        '</div>'+
        '<div id="_pi-'+p+'" style="display:none;font-size:12px;color:var(--text2);margin-top:4px;line-height:1.5">'+info+'</div>'+
      '</div>'+
    '</div>';
  }).join('');
  box.innerHTML=
    '<div style="font-size:17px;font-weight:800;margin-bottom:14px">Add Team Member</div>'+
    '<div class="fg fg2" style="margin-bottom:10px">'+
      '<div class="f"><label>Full name <span style="color:var(--c-red)">*</span></label>'+
        '<input id="_inv-name" placeholder="Blake Sample" style="font-size:14px;padding:10px" autocomplete="off"></div>'+
      '<div class="f"><label>Phone</label>'+
        '<input id="_inv-phone" placeholder="785-555-5250" type="tel" style="font-size:14px;padding:10px" autocomplete="off"></div>'+
    '</div>'+
    '<div class="f" style="margin-bottom:4px"><label>Email <span style="font-size:10px;font-weight:400;color:var(--text3)">(for app access)</span></label>'+
      '<input id="_inv-email" placeholder="blake@email.com" type="email" style="font-size:14px;padding:10px" autocomplete="off"></div>'+
    '<div style="font-size:11px;color:var(--text3);margin-bottom:14px;line-height:1.4">Enter their email then tap "Add &amp; Invite" — they\'ll get a sign-in link and see your jobs, clients, and estimates.</div>'+
    '<div class="f" style="margin-bottom:10px"><label>Access role</label>'+
      '<select id="_inv-role" onchange="_setEmpRolePreset(this.value)" style="font-size:14px;padding:10px">'+
        '<option value="tech">Field Tech</option>'+
        '<option value="office">Office / CSR</option>'+
        '<option value="manager">Manager</option>'+
        '<option value="owner">Owner / Admin</option>'+
      '</select></div>'+
    '<div class="f" style="margin-bottom:14px"><label>Classification <span style="font-size:10px;font-weight:400;color:var(--text3)">(optional)</span></label>'+
      '<select id="_inv-class" style="font-size:14px;padding:10px">'+
        _EMP_CLASSIFICATIONS.map(c=>'<option value="'+escHtml(c)+'">'+escHtml(c||'— None —')+'</option>').join('')+
      '</select></div>'+
    '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:2px">Permissions</div>'+
    permRows+
    '<div style="height:14px"></div>'+
    '<button onclick="_submitInviteEmployee()" style="width:100%;padding:13px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;min-height:44px">Add &amp; Invite</button>'+
    '<button onclick="this.closest(\'.zmodal-overlay\').remove()" style="width:100%;margin-top:8px;padding:10px;border-radius:var(--r);border:none;background:none;color:var(--text3);font-size:13px;cursor:pointer;font-family:inherit">Cancel</button>';
  ov.appendChild(box);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  setTimeout(()=>{document.getElementById('_inv-name')?.focus();_setEmpRolePreset('tech');},80);
}
async function _submitInviteEmployee(){
  const name=(document.getElementById('_inv-name')?.value||'').trim();
  if(!name){zAlert('Enter a name.');return;}
  const phone=(document.getElementById('_inv-phone')?.value||'').trim();
  const email=(document.getElementById('_inv-email')?.value||'').trim();
  const role=document.getElementById('_inv-role')?.value||'tech';
  const classification=(document.getElementById('_inv-class')?.value||'').trim();
  const permissions={};
  Object.keys(_EMP_PERM_LABELS).forEach(p=>{permissions[p]=!!(document.getElementById('_perm-'+p)?.checked);});
  const newEmp={id:Date.now(),name,phone,email,role,classification,permissions};
  if(!S.employees)S.employees=[];
  S.employees.push(newEmp);
  _settingsChanged();saveAll();
  // Build invite link
  const cid=_contractorUserId||_supaUser?.id||'';
  const inviteLink=window.location.origin+window.location.pathname+'?emp_invite='+btoa(JSON.stringify({cid,eid:newEmp.id,email:email||'',bname:S.bname||'',ename:name||''}));
  // Sync to team_members so email-match works when employee signs up
  if(email&&supaEnabled()&&_supaUser){
    _supa.from('team_members').upsert({contractor_user_id:cid,email,name,role:newEmp.role,active:false,invited_at:new Date().toISOString()},{onConflict:'contractor_user_id,email'}).then(({error})=>{if(error)console.warn('team_members upsert:',error);});
  }
  // Send branded invite email if address provided
  if(email&&supaEnabled()&&_supaUser){
    const{data:{session:_invSess}}=await _supa.auth.getSession();
    const _invToken=_invSess?.access_token;
    if(_invToken)fetch(SUPA_URL+'/functions/v1/send-invite-email',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+_invToken},
      body:JSON.stringify({to:email,empName:name,businessName:S.bname||'Your Contractor',inviteUrl:inviteLink,replyTo:_supaUser?.email||''})
    }).catch(()=>{});
  }
  // Show step 2 in same modal
  const box=document.getElementById('_emp-invite-ov')?.querySelector('.zmodal');
  if(!box)return;
  const _emailSentLine=email?'<div style="font-size:13px;color:var(--green-mid);margin-bottom:10px">📧 Invite sent to '+escHtml(email)+'</div>':'';
  box.innerHTML=
    '<div style="font-size:17px;font-weight:800;margin-bottom:6px">Invite Link Ready</div>'+
    _emailSentLine+
    '<div style="font-size:13px;color:var(--text2);margin-bottom:14px">Share this link with <strong>'+escHtml(name)+'</strong>:</div>'+
    '<div id="_inv-link-box" style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:10px;font-size:11px;word-break:break-all;color:var(--text2);margin-bottom:12px;line-height:1.5">'+escHtml(inviteLink)+'</div>'+
    '<button id="_inv-copy-btn" onclick="_copyInviteLink(\''+escHtml(inviteLink)+'\')" style="width:100%;padding:13px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;min-height:44px;margin-bottom:8px">Copy Link</button>'+
    '<button onclick="this.closest(\'.zmodal-overlay\').remove();renderTeam()" style="width:100%;padding:10px;border-radius:var(--r);border:none;background:none;color:var(--text3);font-size:13px;cursor:pointer;font-family:inherit">Close</button>';
}
function _copyInviteLink(link){
  if(navigator.clipboard){navigator.clipboard.writeText(link).then(()=>{
    const btn=document.getElementById('_inv-copy-btn');
    if(btn){btn.textContent='✓ Copied!';btn.style.background='var(--green-mid)';setTimeout(()=>{btn.textContent='Copy Link';btn.style.background='var(--blue)';},2000);}
  });}else{
    try{const ta=document.createElement('textarea');ta.value=link;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);
    const btn=document.getElementById('_inv-copy-btn');if(btn){btn.textContent='✓ Copied!';btn.style.background='var(--green-mid)';setTimeout(()=>{btn.textContent='Copy Link';btn.style.background='var(--blue)';},2000);}}catch(_e){}
  }
}

// ── Dispatch Board ───────────────────────────────────────────────────────────
function renderDispatch(){
  const el=document.getElementById('pg-dispatch');if(!el)return;
  const tk=todayKey();
  const emps=S.employees||[];
  // Today's active jobs: start<=today AND start+days-1>=today
  const todayJobs=jobs.filter(j=>{
    if(j.completion_date||j.cancelled||j.status==='done')return false;
    const start=j.start||j.date||'';
    if(!start)return false;
    const end=addDays(start,(parseInt(j.days)||1)-1);
    return start<=tk&&end>=tk;
  });
  const unassigned=todayJobs.filter(j=>!j.assignedTo);
  function _jobCard(j,empId){
    const c=clients.find(x=>x.id===j.client_id)||{name:j.clientName||j.name||'Job'};
    const addr=escHtml(j.addr||c.addr||'');
    const note=escHtml(j.notes||j.description||'');
    const empName=empId?(S.employees||[]).find(e=>e.id==empId)?.name||'':'';
    const assignBtn=empId
      ?'<button onclick="_dispatchUnassign('+j.id+')" style="font-size:11px;padding:5px 10px;border-radius:var(--r);border:1px solid var(--border2);background:none;cursor:pointer;font-family:inherit;min-height:36px">Unassign</button>'
      :'<button onclick="_dispatchAssign('+j.id+')" style="font-size:11px;padding:5px 10px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;cursor:pointer;font-family:inherit;min-height:36px">Assign →</button>';
    const orderBtns='<div style="display:flex;gap:4px">'+
      '<button onclick="_dispatchMoveUp('+j.id+(empId?',\''+empId+'\'':'')+',\''+empId+'\')" style="font-size:13px;width:30px;height:30px;border-radius:var(--r);border:1px solid var(--border2);background:none;cursor:pointer">↑</button>'+
      '<button onclick="_dispatchMoveDown('+j.id+(empId?',\''+empId+'\'':'')+',\''+empId+'\')" style="font-size:13px;width:30px;height:30px;border-radius:var(--r);border:1px solid var(--border2);background:none;cursor:pointer">↓</button>'+
      '</div>';
    return '<div style="padding:10px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);margin-bottom:8px">'+
      '<div style="font-size:13px;font-weight:700;margin-bottom:3px">'+escHtml(c.name)+'</div>'+
      (addr?'<div style="font-size:11px;color:var(--text3);margin-bottom:4px">'+addr+'</div>':'')+
      (note?'<div style="font-size:11px;color:var(--text2);margin-bottom:6px;line-height:1.4">'+note+'</div>':'')+
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:6px">'+
        orderBtns+assignBtn+
      '</div>'+
    '</div>';
  }
  const unassignedHtml=unassigned.length
    ?unassigned.map(j=>_jobCard(j,null)).join('')
    :'<div style="font-size:12px;color:var(--text3);padding:8px 0">No unassigned jobs today.</div>';
  const empCols=emps.map(emp=>{
    const empJobs=todayJobs.filter(j=>String(j.assignedTo)===String(emp.id)&&j.assignedDate===tk)
      .sort((a,b2)=>(a.dispatchOrder||0)-(b2.dispatchOrder||0));
    const rc=ROLE_COLORS[emp.role]||'var(--text2)';
    const optBtn=empJobs.length>=2
      ?'<button onclick="_dispatchOptimizeRoute(\''+emp.id+'\')" style="font-size:10px;font-weight:700;padding:3px 8px;border-radius:var(--r);border:1px solid var(--blue);background:var(--blue-lt);color:var(--blue);cursor:pointer;font-family:inherit">⚡ Optimize route</button>'
      :'';
    return '<div style="min-width:200px;flex:1;max-width:320px">'+
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:8px;padding:0 2px">'+
        '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:'+rc+'">'+escHtml(emp.name)+'</div>'+optBtn+
      '</div>'+
      (empJobs.length?empJobs.map(j=>_jobCard(j,emp.id)).join('')
        :'<div style="font-size:12px;color:var(--text3);padding:8px;background:var(--bg2);border:1px dashed var(--border);border-radius:var(--r)">No jobs assigned</div>')+
    '</div>';
  }).join('');
  el.innerHTML=
    '<div class="tbar"><div class="tbar-title">📋 Dispatch Board</div>'+
      '<div style="display:flex;gap:6px">'+
        (S.teamTracking?'<button onclick="_renderCrewMap()" style="font-size:12px;padding:6px 12px;border-radius:var(--r);border:1px solid var(--border2);background:none;cursor:pointer;font-family:inherit">📍 Crew map</button>':'')+
        '<button onclick="goPg(\'pg-jobs\')" style="font-size:12px;padding:6px 12px;border-radius:var(--r);border:1px solid var(--border2);background:none;cursor:pointer;font-family:inherit">← Jobs</button>'+
      '</div>'+
    '</div>'+
    '<div style="padding:0 12px 12px">'+
      '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:8px">Unassigned</div>'+
      '<div id="dispatch-unassigned" style="margin-bottom:20px">'+unassignedHtml+'</div>'+
      (emps.length
        ?'<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:8px">By Employee</div>'+
          '<div style="display:flex;gap:12px;overflow-x:auto;padding-bottom:8px">'+empCols+'</div>'
        :'<div style="font-size:13px;color:var(--text3);padding:12px 0">No employees added yet. Add team members in the Team tab.</div>')+
    '</div>';
}
function _dispatchAssign(jobId){
  const emps=S.employees||[];
  if(!emps.length){zAlert('No employees added yet. Add team members in the Team tab first.');return;}
  const tk=todayKey();
  const ov=document.createElement('div');ov.className='zmodal-overlay';
  const sheet=document.createElement('div');
  sheet.style.cssText='position:fixed;bottom:0;left:0;right:0;background:var(--bg);border-radius:16px 16px 0 0;padding:20px 16px;box-shadow:0 -4px 24px rgba(0,0,0,.15);opacity:0;transform:translateY(16px);transition:opacity .22s cubic-bezier(.22,1,.36,1),transform .22s cubic-bezier(.22,1,.36,1)';
  sheet.innerHTML='<div style="font-size:15px;font-weight:800;margin-bottom:14px">Assign to Employee</div>'+
    emps.map(e=>'<button onclick="_dispatchDoAssign('+jobId+',\''+e.id+'\');this.closest(\'.zmodal-overlay\').remove()" style="display:block;width:100%;text-align:left;padding:12px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);cursor:pointer;font-family:inherit;font-size:14px;font-weight:600;margin-bottom:8px;min-height:44px">'+escHtml(e.name)+' <span style="font-size:11px;font-weight:400;color:var(--text3)">'+escHtml(e.role||'')+'</span></button>').join('')+
    '<button onclick="this.closest(\'.zmodal-overlay\').remove()" style="width:100%;padding:10px;border-radius:var(--r);border:none;background:none;color:var(--text3);font-size:13px;cursor:pointer;font-family:inherit;margin-top:4px">Cancel</button>';
  ov.appendChild(sheet);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  requestAnimationFrame(()=>{sheet.style.opacity='1';sheet.style.transform='translateY(0)';});
}
function _dispatchDoAssign(jobId,empId){
  const j=jobs.find(x=>x.id===jobId);if(!j)return;
  j.assignedTo=empId;j.assignedDate=todayKey();
  // Durable record of everyone ever assigned — powers the crew trust ranking on estimates.
  if(!Array.isArray(j.crewHistory))j.crewHistory=[];
  if(!j.crewHistory.map(String).includes(String(empId)))j.crewHistory.push(empId);
  saveAll();renderDispatch();showToast('Job assigned','📋');
}
function _dispatchUnassign(jobId){
  const j=jobs.find(x=>x.id===jobId);if(!j)return;
  zConfirm('Unassign this job?',()=>{
    delete j.assignedTo;delete j.assignedDate;
    saveAll();renderDispatch();showToast('Job unassigned','↩️');
  },{title:'Unassign Job',yes:'Unassign',danger:false});
}
function _dispatchMoveUp(jobId,empId){
  const tk=todayKey();
  const empJobs=jobs.filter(j=>String(j.assignedTo)===String(empId)&&j.assignedDate===tk).sort((a,b2)=>(a.dispatchOrder||0)-(b2.dispatchOrder||0));
  const idx=empJobs.findIndex(j=>j.id===jobId);if(idx<=0)return;
  const temp=empJobs[idx-1].dispatchOrder||0;
  empJobs[idx-1].dispatchOrder=empJobs[idx].dispatchOrder||0;
  empJobs[idx].dispatchOrder=temp===empJobs[idx].dispatchOrder?temp-1:temp;
  empJobs.forEach((j,i)=>{j.dispatchOrder=i;});
  saveAll();renderDispatch();
}
function _dispatchMoveDown(jobId,empId){
  const tk=todayKey();
  const empJobs=jobs.filter(j=>String(j.assignedTo)===String(empId)&&j.assignedDate===tk).sort((a,b2)=>(a.dispatchOrder||0)-(b2.dispatchOrder||0));
  const idx=empJobs.findIndex(j=>j.id===jobId);if(idx<0||idx>=empJobs.length-1)return;
  empJobs.forEach((j,i)=>{j.dispatchOrder=i;});
  const temp=empJobs[idx+1].dispatchOrder;
  empJobs[idx+1].dispatchOrder=empJobs[idx].dispatchOrder;
  empJobs[idx].dispatchOrder=temp;
  saveAll();renderDispatch();
}

// ── Route optimization (office → ordered job sites, nearest-neighbor) ─────────
// Office origin = the business address, geocoded once and cached on S.
async function _geoOfficeCoords(){
  if(S.officeLat&&S.officeLon)return{lat:S.officeLat,lng:S.officeLon};
  const addr=[S.baddr,S.bcity,S.state,S.bzip].filter(Boolean).join(', ');
  if(!addr||typeof _resolveCoords!=='function')return null;
  try{
    const r=await _resolveCoords(addr);
    if(r&&r.lat){S.officeLat=r.lat;S.officeLon=r.lng;saveAll();return{lat:r.lat,lng:r.lng};}
  }catch(_e){}
  return null;
}
async function _dispatchOptimizeRoute(empId){
  const tk=todayKey();
  const empJobs=jobs.filter(j=>String(j.assignedTo)===String(empId)&&j.assignedDate===tk);
  if(empJobs.length<2){showToast('Need at least 2 jobs to optimize','📋');return;}
  showToast('Optimizing route…','⏳');
  const office=await _geoOfficeCoords();
  if(!office){zAlert('Add your business address in Settings first — it\'s the starting point for route optimization.');return;}
  // Geocode each job (reuse the geo-track cache helper if present)
  const pts=[];
  for(const j of empJobs){
    let c=null;
    if(j.lat&&j.lon)c={lat:j.lat,lng:j.lon};
    else{
      const cl=clients.find(x=>x.id===j.client_id);
      const addr=j.addr||(cl&&cl.addr)||'';
      if(addr&&typeof _resolveCoords==='function'){try{const r=await _resolveCoords(addr);if(r&&r.lat){c={lat:r.lat,lng:r.lng};j.lat=r.lat;j.lon=r.lng;}}catch(_e){}}
    }
    pts.push({job:j,coord:c});
  }
  const located=pts.filter(p=>p.coord);
  if(located.length<2){zAlert('Could not locate enough job addresses to optimize. Check the addresses on these jobs.');return;}
  // Nearest-neighbor from the office
  const remaining=located.slice();
  const ordered=[];
  let cur=office,totalMi=0;
  while(remaining.length){
    let bi=0,bd=Infinity;
    remaining.forEach((p,i)=>{const d=_haversineMiles(cur,p.coord);if(d<bd){bd=d;bi=i;}});
    totalMi+=bd;cur=remaining[bi].coord;ordered.push(remaining[bi]);remaining.splice(bi,1);
  }
  // Any un-located jobs keep their relative order at the end
  pts.filter(p=>!p.coord).forEach(p=>ordered.push(p));
  ordered.forEach((p,i)=>{p.job.dispatchOrder=i;});
  saveAll();renderDispatch();
  const miTxt=Math.round(totalMi*10)/10;
  showToast('Route optimized · ~'+miTxt+' mi from office','🗺');
}

// ── Crew live map (manager view of last-known location per employee) ──────────
async function _renderCrewMap(){
  document.getElementById('_crew-map-ov')?.remove();
  const ov=document.createElement('div');ov.id='_crew-map-ov';ov.className='zmodal-overlay';
  const box=document.createElement('div');box.className='zmodal';
  box.innerHTML='<div style="font-size:17px;font-weight:800;margin-bottom:4px">📍 Crew locations</div>'+
    '<div style="font-size:12px;color:var(--text3);margin-bottom:14px">Last-known position during today\'s business hours.</div>'+
    '<div id="_crew-map-body" style="font-size:13px;color:var(--text3)">Loading…</div>'+
    '<button onclick="this.closest(\'.zmodal-overlay\').remove()" style="width:100%;padding:10px;border-radius:var(--r);border:none;background:none;color:var(--text3);font-size:13px;cursor:pointer;font-family:inherit;margin-top:10px">Close</button>';
  ov.appendChild(box);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  if(!supaEnabled()||!_supaUser){const b=document.getElementById('_crew-map-body');if(b)b.textContent='Sign in to see crew locations.';return;}
  const cid=_contractorUserId||_supaUser.id;
  const since=new Date(Date.now()-12*3600000).toISOString();
  let rows=[];
  try{
    const{data}=await _supa.from('location_pings').select('employee_user_id,lat,lon,ts')
      .eq('contractor_user_id',cid).gte('ts',since).order('ts',{ascending:false});
    rows=data||[];
  }catch(_e){}
  const latest={};
  rows.forEach(r=>{if(!latest[r.employee_user_id])latest[r.employee_user_id]=r;});
  const keys=Object.keys(latest);
  const b=document.getElementById('_crew-map-body');if(!b)return;
  if(!keys.length){b.innerHTML='<div style="padding:8px 0">No location pings yet today. Crew appear here once they\'re on the clock with sharing enabled.</div>';return;}
  b.innerHTML=keys.map(uid=>{
    const r=latest[uid];
    const emp=(S.employees||[]).find(e=>String(e.employee_user_id||'')===uid)||{};
    const nm=escHtml(emp.name||'Crew member');
    const ago=_timeAgo(r.ts);
    const mapUrl='https://www.google.com/maps?q='+r.lat+','+r.lon;
    return '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);margin-bottom:8px">'+
      '<div><div style="font-size:13px;font-weight:700">'+nm+'</div><div style="font-size:11px;color:var(--text3)">📍 '+ago+'</div></div>'+
      '<a href="'+mapUrl+'" target="_blank" style="font-size:11px;font-weight:700;background:var(--blue-lt);color:var(--blue);border:1px solid var(--blue);border-radius:var(--r);padding:6px 10px;text-decoration:none">🗺 Map</a>'+
    '</div>';
  }).join('');
}

// ── Vehicle-start-of-shift picker ────────────────────────────────────────────
function _checkEmployeeVehiclePicker(){
  if(!_isEmployee)return;
  const tk=todayKey();
  const key='emp_vehicle_'+tk;
  if(localStorage.getItem(key))return;
  const vehs=S.vehicles||[];
  const ov=document.createElement('div');ov.id='_vehicle-picker-ov';ov.className='zmodal-overlay';
  const sheet=document.createElement('div');
  sheet.style.cssText='position:fixed;bottom:0;left:0;right:0;background:var(--bg);border-radius:16px 16px 0 0;padding:20px 16px;box-shadow:0 -4px 24px rgba(0,0,0,.15);opacity:0;transform:translateY(16px);transition:opacity .22s cubic-bezier(.22,1,.36,1),transform .22s cubic-bezier(.22,1,.36,1)';
  const vehList=vehs.map(v=>{
    const label=[v.year,v.make,v.model].filter(Boolean).join(' ')||escHtml(v.name||v.id||'Vehicle');
    return '<button onclick="_pickVehicle(\''+v.id+'\',\''+escHtml(label)+'\')" style="display:block;width:100%;text-align:left;padding:12px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);cursor:pointer;font-family:inherit;font-size:14px;font-weight:600;margin-bottom:8px;min-height:44px">🚗 '+escHtml(label)+'</button>';
  }).join('');
  sheet.innerHTML=
    '<div style="font-size:15px;font-weight:800;margin-bottom:4px">Which vehicle are you in today?</div>'+
    '<div style="font-size:12px;color:var(--text3);margin-bottom:14px">Drive time is only logged for company vehicles — personal vehicle trips stay private.</div>'+
    vehList+
    '<button onclick="_pickVehicle(\'personal\',\'Personal vehicle\')" style="display:block;width:100%;text-align:left;padding:12px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);cursor:pointer;font-family:inherit;font-size:14px;font-weight:500;margin-bottom:8px;min-height:44px;color:var(--text2)">🚗 My personal vehicle — no mileage logged</button>'+
    '<button onclick="_pickVehicle(\'none\',\'On foot\')" style="display:block;width:100%;text-align:left;padding:12px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);cursor:pointer;font-family:inherit;font-size:14px;font-weight:500;margin-bottom:8px;min-height:44px;color:var(--text2)">🚶 On foot / no vehicle</button>';
  ov.appendChild(sheet);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  requestAnimationFrame(()=>{sheet.style.opacity='1';sheet.style.transform='translateY(0)';});
}
function _pickVehicle(vid,label){
  const tk=todayKey();
  localStorage.setItem('emp_vehicle_'+tk,vid);
  document.getElementById('_vehicle-picker-ov')?.remove();
  const icon=vid==='none'?'🚶':'🚗';
  showToast(vid==='personal'?'No mileage logged for personal vehicle':'Logged to '+label,icon);
  const vd=document.getElementById('_emp-vehicle-display');
  if(vd)vd.textContent=vid==='none'?'':vid==='personal'?'🚗 Personal vehicle':'🚗 Driving: '+label;
}
// Returns true when the employee's shift vehicle should have mileage tracked (company vehicle)
function _isCompanyVehicleToday(){
  const v=localStorage.getItem('emp_vehicle_'+todayKey());
  return !!(v&&v!=='none'&&v!=='personal');
}

// ── Estimate access requests (owner side) ──────────────────────────────────
// Employees without `estimate` permission tap a greyed entry point → a row lands
// in td_permission_requests; the owner approves (flips permissions.estimate) or
// denies, here on the Team page.
let _pendingPermReqs=[];
let _permReqsLoaded=false;

async function _loadPendingPermRequests(){
  if(_isEmployee||typeof _supa==='undefined'||!_supa||!_supaUser)return;
  try{
    const{data,error}=await _supa.from('td_permission_requests').select('*')
      .eq('contractor_user_id',_supaUser.id).eq('status','pending').order('created_at',{ascending:true});
    if(error){if(_isMissingTableErr(error))return;throw error;}
    _pendingPermReqs=data||[];
    if(typeof renderTeam==='function')renderTeam();
    _refreshPermReqBadge();
  }catch(e){console.warn('load perm requests:',e);}
}

function _refreshPermReqBadge(){
  const n=_pendingPermReqs.length;
  ['nb-team','mtb-team','mmi-team'].forEach(id=>{
    const el=document.getElementById(id);if(!el)return;
    let b=el.querySelector('.perm-req-badge');
    if(n>0){
      if(!b){b=document.createElement('span');b.className='perm-req-badge';
        b.style.cssText='display:inline-block;min-width:16px;height:16px;line-height:16px;text-align:center;background:#A32D2D;color:#fff;font-size:10px;font-weight:800;border-radius:8px;margin-left:4px;padding:0 4px';
        el.appendChild(b);}
      b.textContent=String(n);
    }else if(b){b.remove();}
  });
}

async function _approvePermissionRequest(reqId){
  const req=_pendingPermReqs.find(r=>r.id===reqId);if(!req)return;
  try{
    const emp=(S.employees||[]).find(e=>(e.email||'').toLowerCase()===(req.employee_email||'').toLowerCase());
    if(emp){emp.permissions=emp.permissions||{};emp.permissions.estimate=true;_settingsChanged();}
    await _supa.from('team_members').update({permissions:emp?emp.permissions:{estimate:true}})
      .eq('contractor_user_id',_supaUser.id).eq('email',req.employee_email);
    await _supa.from('td_permission_requests').update({status:'approved',resolved_at:new Date().toISOString(),resolved_by:_supaUser.id}).eq('id',reqId);
    _pendingPermReqs=_pendingPermReqs.filter(r=>r.id!==reqId);
    if(typeof showToast==='function')showToast('Estimate access granted to '+(req.employee_name||req.employee_email||'employee'),'✅');
    if(typeof saveAll==='function')saveAll();
    renderTeam();_refreshPermReqBadge();
  }catch(e){console.warn('approve failed:',e);if(typeof showToast==='function')showToast('Could not approve.','⚠️');}
}

async function _denyPermissionRequest(reqId){
  const req=_pendingPermReqs.find(r=>r.id===reqId);if(!req)return;
  try{
    await _supa.from('td_permission_requests').update({status:'denied',resolved_at:new Date().toISOString(),resolved_by:_supaUser.id}).eq('id',reqId);
    _pendingPermReqs=_pendingPermReqs.filter(r=>r.id!==reqId);
    if(typeof showToast==='function')showToast('Request denied.','🚫');
    renderTeam();_refreshPermReqBadge();
  }catch(e){console.warn('deny failed:',e);}
}

function renderTeam(){
  const el=document.getElementById('team-list');
  const el2=document.getElementById('team-page-list');
  if(!el&&!el2)return;
  // Owner: lazy-load pending estimate-access requests once, then re-render.
  if(!_isEmployee&&supaEnabled()&&_supaUser&&!_permReqsLoaded){_permReqsLoaded=true;_loadPendingPermRequests();}
  const _reqHtml=(!_isEmployee&&_pendingPermReqs.length)
    ?'<div style="margin-bottom:10px"><div style="font-size:11px;font-weight:800;text-transform:uppercase;color:var(--text3);margin-bottom:6px">Pending access requests</div>'+
      _pendingPermReqs.map(r=>
        '<div style="padding:10px;background:#FFF7ED;border:1px solid #FED7AA;border-radius:var(--r);margin-bottom:8px">'+
          '<div style="font-size:13px;font-weight:700">'+escHtml(r.employee_name||r.employee_email||'Employee')+'</div>'+
          '<div style="font-size:11px;color:var(--text3);margin:2px 0 8px">requests <b>Estimate</b> access</div>'+
          '<div style="display:flex;gap:8px">'+
            '<button onclick="_approvePermissionRequest(\''+r.id+'\')" style="flex:1;padding:7px;border-radius:var(--r);border:none;background:#0E6B39;color:#fff;font-weight:700;font-size:12px;cursor:pointer;font-family:inherit">Approve</button>'+
            '<button onclick="_denyPermissionRequest(\''+r.id+'\')" style="flex:1;padding:7px;border-radius:var(--r);border:1px solid var(--border2);background:none;font-weight:700;font-size:12px;cursor:pointer;font-family:inherit">Deny</button>'+
          '</div>'+
        '</div>').join('')+'</div>'
    :'';
  // Refresh pay-rate cache from team_members (RLS-gated) then re-render once loaded
  if(_canViewComp()&&supaEnabled()&&_supaUser&&!_teamCompLoaded){
    _teamCompLoaded=true;_loadTeamComp().then(()=>renderTeam());
  }
  const emps=S.employees||[];
  const empHtml=!emps.length
    ?'<div style="font-size:12px;color:var(--text3);padding:6px 0">No team members yet — just you. Add someone when you hire.</div>'
    :emps.map((e,i)=>{
      const rc=ROLE_COLORS[e.role]||'var(--text2)';const rb=ROLE_BG[e.role]||'var(--bg2)';
      const perms=Object.entries(e.permissions||{}).filter(([,v])=>v).map(([k])=>_EMP_PERM_LABELS[k]||PERM_LABELS[k]||k).join(', ')||'No permissions';
      const _roleLabel={tech:'Field Tech',office:'Office / CSR',manager:'Manager',owner:'Owner'}[e.role]||e.role;
      const _classTag=e.classification?'<span style="font-size:10px;font-weight:600;background:var(--bg3,#f1f5f9);color:var(--text2);padding:1px 7px;border-radius:8px;margin-left:4px">'+escHtml(e.classification)+'</span>':'';
      const _ec=_teamComp[(e.email||'').toLowerCase()];
      const _payTag=(_canViewComp()&&_ec&&_ec.pay_rate)?'<span style="font-size:10px;font-weight:700;background:#ECFDF5;color:#0E6B39;padding:1px 7px;border-radius:8px;margin-left:4px">'+(_ec.pay_type==='salary'?'$'+Math.round(_ec.pay_rate/1000)+'k/yr':'$'+_ec.pay_rate+'/hr')+'</span>':'';
      return '<div style="padding:10px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);margin-bottom:8px">'+
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px">'+
          '<div style="display:flex;align-items:center;gap:8px">'+
            '<div style="width:34px;height:34px;border-radius:50%;background:'+rc+';display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:14px;flex-shrink:0">'+escHtml(e.name.charAt(0).toUpperCase())+'</div>'+
            '<div><div style="font-size:13px;font-weight:700">'+escHtml(e.name||'')+'</div>'+
            '<span style="font-size:10px;font-weight:700;background:'+rb+';color:'+rc+';padding:1px 7px;border-radius:8px">'+escHtml(_roleLabel)+'</span>'+_classTag+_payTag+'</div>'+
          '</div>'+
          (e.role!=='owner'?'<button onclick="openEditEmployeeModal('+i+')" style="font-size:11px;padding:4px 10px;border-radius:var(--r);border:1px solid var(--border2);background:none;cursor:pointer;font-family:inherit">Edit</button>':'')+
        '</div>'+
        (e.phone?'<div style="font-size:11px;color:var(--text3);margin-top:4px">📞 '+escHtml(e.phone)+'</div>':'')+
        (e.email?'<div style="font-size:11px;color:var(--text3);margin-top:3px">📧 '+escHtml(e.email)+' <span style="font-size:9px;font-weight:700;background:#dcfce7;color:#15803d;padding:1px 5px;border-radius:6px">Invite sent</span></div>':'')+
        '<div style="font-size:10px;color:var(--text3);margin-top:4px;line-height:1.5">'+perms+'</div>'+
      '</div>';
    }).join('');
  if(el)el.innerHTML=_reqHtml+empHtml;
  if(el2)el2.innerHTML=_reqHtml+empHtml;
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
    const dname=escHtml(d.name||d.label);
    const typeTag=d.name?' <span style="font-size:9px;font-weight:600;background:var(--bg3,#f1f5f9);color:var(--text3);padding:1px 6px;border-radius:8px">'+escHtml(d.label)+'</span>':'';
    return '<div style="padding:10px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);margin-bottom:8px'+(hasLoc?';cursor:pointer':'')+'" '+(hasLoc?'onclick="window.open(\''+mapUrl+'\',\'_blank\')"':'')+'>'+
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px">'+
        '<div style="display:flex;align-items:center;gap:10px">'+
          '<div style="font-size:22px">'+(d.label==='iPad'||d.label==='iPhone'?'📱':'💻')+'</div>'+
          '<div>'+
            '<div style="font-size:13px;font-weight:700">'+dname+(isMe?' <span style="font-size:9px;background:var(--blue);color:#fff;padding:1px 6px;border-radius:8px">This device</span>':'')+typeTag+'</div>'+
            '<div style="font-size:10px;color:'+(isActive?'var(--green-mid)':'var(--text3)')+'">'+
              (isActive?'🟢 Active':'⚪ Last seen '+ago)+'</div>'+
            (hasLoc?'<div style="font-size:10px;color:var(--blue);margin-top:1px">📍 Tap to view on map · '+locAgo+'</div>':'')+
          '</div>'+
        '</div>'+
        '<div style="display:flex;gap:6px;align-items:center">'+
          (hasLoc?'<span style="font-size:11px;font-weight:700;background:var(--blue-lt);color:var(--blue);border:1px solid var(--blue);border-radius:var(--r);padding:5px 10px;white-space:nowrap">🗺 Map</span>':'')+
          '<button onclick="event.stopPropagation();renameDevice(\''+d.id+'\')" style="font-size:10px;color:var(--text2);border:1px solid var(--border2);border-radius:var(--r);padding:5px 8px;background:none;cursor:pointer;font-family:inherit">Rename</button>'+
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
  _settingsChanged();renderTeam();
}
function renameDevice(id){
  const dev=(S.devices||[]).find(d=>d.id===id);
  if(!dev)return;
  zPrompt('Name this device so you can tell your iPads apart — e.g. "Front Office", "Truck 2 iPad".',name=>{
    name=(name||'').trim().slice(0,40);
    const d=(S.devices||[]).find(x=>x.id===id);
    if(!d)return;
    if(name)d.name=name;else delete d.name;
    _settingsChanged();renderTeam();
  },{title:'Name this device',placeholder:'Front Office iPad',value:dev.name||''});
}
// ── Team compensation (pay rates live in team_members with RLS, never in S) ───
// _teamComp caches pay_type/pay_rate by lowercased email so the (synchronous)
// employee modal can pre-fill without a per-open round trip. Populated by
// _loadTeamComp() on team-page render.
let _teamComp={};
let _teamCompLoaded=false;
// Only the account owner or a payroll-permitted manager may see/edit pay.
function _canViewComp(){
  if(!_isEmployee)return true;                       // contractor/owner
  return !!_employeeRecord?.permissions?.payroll;    // manager with payroll perm
}
// Effective hourly rate for job costing: salary ÷ 2080 work-hours, else the rate as-is.
function _empEffectiveHourly(comp){
  if(!comp||!comp.pay_rate)return 0;
  return comp.pay_type==='salary'?(comp.pay_rate/2080):comp.pay_rate;
}
// Loaded hourly = wage × burden multiplier (payroll taxes, workers' comp, insurance).
function _empLoadedHourly(comp){
  return _empEffectiveHourly(comp)*(S.laborBurden||1.3);
}
async function _loadTeamComp(){
  if(!supaEnabled()||!_supaUser||!_canViewComp())return;
  const cid=_contractorUserId||_supaUser.id;
  try{
    const{data,error}=await _supa.from('team_members')
      .select('email,pay_type,pay_rate').eq('contractor_user_id',cid);
    if(error||!data)return;
    const next={};
    data.forEach(r=>{if(r.email)next[r.email.toLowerCase()]={pay_type:r.pay_type||'hourly',pay_rate:r.pay_rate||0};});
    _teamComp=next;
  }catch(_e){}
}
function _empPayTypeSync(){
  const t=document.getElementById('emp-pay-type')?.value;
  const lbl=document.getElementById('emp-pay-rate-lbl');
  const inp=document.getElementById('emp-pay-rate');
  if(lbl)lbl.textContent=t==='salary'?'Annual salary':'Hourly rate';
  if(inp)inp.placeholder=t==='salary'?'55000':'28';
}
function _employeeModalHTML(emp,idx){
  const isNew=idx==null;
  const e=emp||{name:'',role:'tech',phone:'',email:'',classification:'',permissions:{}};
  // Map legacy role values to the new system
  const _legacyMap={employee:'tech',estimator:'tech',foreman:'manager',painter:'tech'};
  const _eRole=_legacyMap[e.role]||e.role||'tech';
  const _eClass=e.classification||'';
  const _eComp=_teamComp[(e.email||'').toLowerCase()]||{pay_type:'hourly',pay_rate:0};
  return '<div style="font-size:17px;font-weight:800;margin-bottom:14px">'+(isNew?'Add team member':'Edit '+escHtml(e.name||''))+'</div>'+
    '<div class="fg fg2" style="margin-bottom:12px">'+
      '<div class="f"><label>Full name</label><input id="emp-name" value="'+escHtml(e.name||'')+'" placeholder="John Smith" style="font-size:15px;padding:10px"></div>'+
      '<div class="f"><label>Phone</label><input id="emp-phone" type="tel" value="'+escHtml(e.phone||'')+'" placeholder="XXX-XXX-XXXX" maxlength="12" oninput="fmtPhone(this)" style="font-size:15px;padding:10px"></div>'+
    '</div>'+
    '<div class="f" style="margin-bottom:12px"><label>Email (for app access)</label>'+
      '<input id="emp-email" type="email" value="'+escHtml(e.email||'')+'" placeholder="employee@email.com" style="font-size:14px;padding:10px">'+
      '<div style="font-size:10px;color:var(--text3);margin-top:4px">They\'ll receive an employment agreement to sign — then get their account setup link.</div>'+
    '</div>'+
    '<div class="fg fg2" style="margin-bottom:12px">'+
      '<div class="f" style="margin:0"><label>Access role</label>'+
        '<select id="emp-role" onchange="_setEmpRolePreset(this.value)" style="font-size:14px;padding:10px">'+
          '<option value="tech"'+(_eRole==='tech'?' selected':'')+'>Field Tech</option>'+
          '<option value="office"'+(_eRole==='office'?' selected':'')+'>Office / CSR</option>'+
          '<option value="manager"'+(_eRole==='manager'?' selected':'')+'>Manager</option>'+
          '<option value="owner"'+(_eRole==='owner'?' selected':'')+'>Owner / Admin</option>'+
        '</select></div>'+
      '<div class="f" style="margin:0"><label>Classification <span style="font-size:10px;font-weight:400;color:var(--text3)">(optional)</span></label>'+
        '<select id="emp-classification" style="font-size:14px;padding:10px">'+
          _EMP_CLASSIFICATIONS.map(c=>'<option value="'+escHtml(c)+'"'+(c===_eClass?' selected':'')+'>'+escHtml(c||'— None —')+'</option>').join('')+
        '</select></div>'+
    '</div>'+
    (_canViewComp()?
      '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">'+
        '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text3)">Pay</div>'+
        '<button type="button" onclick="var d=document.getElementById(\'_pay-info-tip\');d.style.display=d.style.display===\'none\'?\'block\':\'none\'" style="width:16px;height:16px;border-radius:50%;border:1px solid var(--text3);background:none;color:var(--text3);font-size:10px;font-weight:700;cursor:pointer;padding:0;font-family:inherit;line-height:16px;text-align:center;flex-shrink:0">?</button>'+
      '</div>'+
      '<div id="_pay-info-tip" style="display:none;font-size:12px;color:var(--text2);background:var(--bg2);border-radius:var(--r);padding:10px 12px;margin-bottom:10px;line-height:1.55">'+
        'Pay rates are stored securely and only visible to people with the <strong>Pay &amp; profit</strong> permission. Employees <em>never</em> see this — not in their daily view or anywhere else in the app. It\'s used to calculate loaded labor cost and profit margin on each job in the Job Profit report.'+
      '</div>'+
      '<div style="margin-bottom:8px"></div>'+
      '<div style="display:grid;grid-template-columns:140px 1fr;gap:10px;margin-bottom:14px">'+
        '<div class="f" style="margin:0"><label>Pay type</label>'+
          '<select id="emp-pay-type" onchange="_empPayTypeSync()" style="font-size:14px;padding:10px">'+
            '<option value="hourly"'+(_eComp.pay_type!=='salary'?' selected':'')+'>Hourly</option>'+
            '<option value="salary"'+(_eComp.pay_type==='salary'?' selected':'')+'>Salary</option>'+
          '</select></div>'+
        '<div class="f" style="margin:0"><label id="emp-pay-rate-lbl">'+(_eComp.pay_type==='salary'?'Annual salary':'Hourly rate')+'</label>'+
          '<div style="display:flex;align-items:center;gap:6px"><span style="font-size:14px;color:var(--text2);font-weight:600">$</span>'+
          '<input id="emp-pay-rate" type="number" min="0" step="0.5" value="'+(_eComp.pay_rate||'')+'" placeholder="'+(_eComp.pay_type==='salary'?'55000':'28')+'" style="font-size:14px;padding:10px;flex:1"></div></div>'+
      '</div>'
    :'')+
    '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:8px">Permissions</div>'+
    '<div style="display:grid;gap:6px;margin-bottom:14px">'+
      Object.entries(_EMP_PERM_LABELS).map(([k,lbl])=>{
        const checked=e.permissions&&e.permissions[k];
        const info=_EMP_PERM_INFO[k]||'';
        return '<div style="background:var(--bg2);border-radius:var(--r)">'+
          '<label style="display:flex;align-items:center;gap:10px;font-size:13px;cursor:pointer;padding:8px 10px">'+
            '<input type="checkbox" id="_perm-'+k+'"'+(checked?' checked':'')+' style="width:16px;height:16px;cursor:pointer;flex-shrink:0;accent-color:var(--blue)">'+
            '<span style="flex:1">'+escHtml(lbl)+'</span>'+
            (info?'<button type="button" onclick="event.preventDefault();event.stopPropagation();var d=this.parentElement.parentElement.querySelector(\'.perm-info\');d.style.display=d.style.display===\'none\'?\'block\':\'none\'" style="width:18px;height:18px;border-radius:50%;border:1.5px solid var(--text3);background:none;color:var(--text3);font-size:11px;font-weight:700;cursor:pointer;flex-shrink:0;padding:0;font-family:inherit;line-height:18px;text-align:center">?</button>':'')+
          '</label>'+
          (info?'<div class="perm-info" style="display:none;font-size:12px;color:var(--text3);padding:0 10px 10px 34px;line-height:1.45">'+escHtml(info)+'</div>':'')+
        '</div>';
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
  Object.keys(_EMP_PERM_LABELS).forEach(k=>{perms[k]=!!(document.getElementById('_perm-'+k)?.checked);});
  const isNew=idx==null;
  const _empRoleEl=document.getElementById('emp-role');
  const _empPhoneEl=document.getElementById('emp-phone');
  const _empClassEl=document.getElementById('emp-classification');
  const _empId=isNew?Date.now():(S.employees[idx]?S.employees[idx].id||Date.now():Date.now());
  const _empRole=_empRoleEl?_empRoleEl.value||'tech':'tech';
  const _empPhoneRaw=_empPhoneEl?_empPhoneEl.value||'':'';
  const _empPhone=_empPhoneRaw.trim();
  const _empClass=(_empClassEl?_empClassEl.value||'':'').trim();
  // Pay fields only exist in the DOM when the editor can view comp. Capture them
  // here (before the modal is removed) so they ride along on the team_members upsert.
  const _canComp=_canViewComp();
  const _payType=_canComp?(document.getElementById('emp-pay-type')?.value||'hourly'):null;
  const _payRate=_canComp?(parseFloat(document.getElementById('emp-pay-rate')?.value)||0):null;
  const emp={id:_empId,name,email,role:_empRole,classification:_empClass,phone:_empPhone,permissions:perms};
  if(!S.employees)S.employees=[];
  if(!isNew)S.employees[idx]=emp;else S.employees.push(emp);
  _settingsChanged();document.getElementById('emp-modal-overlay')?.remove();renderTeam();
  // Sync to Supabase team_members and send invite if email provided
  if(email&&_supa&&_supaUser){
    // permissions MUST ride along: has_team_perm() and the load_account_data RPC
    // read team_members.permissions server-side. Without this the column stays
    // '{}' forever, so every employee perm reads false — locking employees out of
    // everything (a collect tech wouldn't even see payment amounts). This is the
    // authoritative write the owner's permission checkboxes depend on.
    const tmRow={contractor_user_id:_supaUser.id,email,name,role:emp.role,permissions:emp.permissions||{},active:false,invited_at:new Date().toISOString()};
    // Pay is written ONLY when the editor can view comp — otherwise the columns are
    // omitted from the upsert so existing pay_rate is preserved, never clobbered to 0.
    if(_canComp){tmRow.pay_type=_payType;tmRow.pay_rate=_payRate;_teamComp[email]={pay_type:_payType,pay_rate:_payRate};}
    const{error}=await _supa.from('team_members').upsert(tmRow,{onConflict:'contractor_user_id,email'});
    if(error){console.warn('team_members upsert failed:',error);return;}
    // Auto-create employment agreement; signing IS the onboarding step
    if(isNew){
      const cid=_supaUser.id;
      const inviteUrl=window.location.origin+window.location.pathname+'?emp_invite='+btoa(JSON.stringify({cid,eid:emp.id,email:emp.email||'',bname:S.bname||'',ename:emp.name||''}));
      const{data:{session:_saveSess}}=await _supa.auth.getSession();
      const _saveToken=_saveSess?.access_token;
      // Build the signing link — embed inviteUrl in the contract snapshot so
      // contract-sign.html shows "Set up your account" after the employee signs.
      let signUrl=inviteUrl; // fallback: direct link if agreements feature unavailable
      if(typeof _agEmploymentBody==='function'){
        try{
          const agId=Date.now()+1;
          const agToken=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
          const agKey='agreements/'+cid+'/'+agId+'_'+agToken+'.json';
          const agRecord={id:agId,type:'employment',party:emp.name,
            title:'Employment Agreement — '+emp.name,body:_agEmploymentBody(emp.name),
            profitPct:null,cadence:'',partyEmployeeId:emp.id,
            effectiveDate:todayKey(),status:'sent',
            createdAt:new Date().toISOString(),
            signingToken:agToken,signingKey:agKey,signedAt:null,signerName:null,sigData:null};
          if(!agreements)agreements=[];
          agreements.push(agRecord);
          const snapshot={id:agId,token:agToken,contractorUserId:cid,
            type:'employment',party:emp.name,title:agRecord.title,body:agRecord.body,
            effectiveDate:agRecord.effectiveDate,
            businessName:getBusinessName()||'',ownerName:getOwnerName()||'',
            notifyEmail:_supaUser.email||'',
            status:'sent',signedAt:null,signerName:null,sigData:null,
            createdAt:agRecord.createdAt,inviteUrl};
          await _supa.storage.from('proposals').upload(agKey,JSON.stringify(snapshot),{contentType:'application/json',upsert:true,cacheControl:'0'});
          saveAll();
          const _base=_clientBaseUrl?_clientBaseUrl():(window.location.origin+window.location.pathname.split('index.html')[0]);
          signUrl=_base+'contract-sign.html?t='+agToken+'&u='+cid+'&a='+agId;
        }catch(_agErr){console.warn('auto-employment-agreement:',_agErr);}
      }
      if(_saveToken&&email){
        try{
          const _invRes=await fetch(SUPA_URL+'/functions/v1/send-invite-email',{
            method:'POST',
            headers:{'Content-Type':'application/json','Authorization':'Bearer '+_saveToken},
            body:JSON.stringify({to:email,empName:emp.name,businessName:S.bname||'Your Contractor',inviteUrl:signUrl,replyTo:_supaUser.email||''})
          });
          if(_invRes.ok)showToast('Agreement sent to '+email,'📝');
          else showToast('Saved — email failed','⚠️');
        }catch(_e){showToast('Saved — email failed','⚠️');}
      }
    }
  }
}
function removeEmployee(idx){
  if(!S.employees)return;
  S.employees.splice(idx,1);
  _settingsChanged();document.getElementById('emp-modal-overlay')?.remove();renderTeam();
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
  const _subExisting=(S.subcontractors||[])[idx];
  const _subId=idx==null?Date.now():(_subExisting?_subExisting.id||Date.now():Date.now());
  const _subTradeEl=document.getElementById('sub-trade');
  const _subPhoneEl=document.getElementById('sub-phone');
  const _subEmailEl=document.getElementById('sub-email');
  const _subRateEl=document.getElementById('sub-rate');
  const _subTrade=(_subTradeEl?_subTradeEl.value||'':'').trim();
  const _subPhone=(_subPhoneEl?_subPhoneEl.value||'':'').trim();
  const _subEmail=(_subEmailEl?_subEmailEl.value||'':'').trim();
  const _subRate=(_subRateEl?_subRateEl.value||'':'').trim();
  const sub={id:_subId,name,trade:_subTrade,phone:_subPhone,email:_subEmail,rate:_subRate};
  if(!S.subcontractors)S.subcontractors=[];
  if(idx==null)S.subcontractors.push(sub);else S.subcontractors[idx]=sub;
  _settingsChanged();document.getElementById('_sub-modal-ov')?.remove();renderTeam();
  showToast(idx==null?'Subcontractor added':'Saved','✓');
}
function _removeSub(idx){
  if(!S.subcontractors)return;
  S.subcontractors.splice(idx,1);
  _settingsChanged();document.getElementById('_sub-modal-ov')?.remove();renderTeam();
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
    // Remember whose data this is so a later sign-in by a different account triggers
    // the wipe-before-load guard rather than merging this account's records into theirs.
    if(_op._owner&&!_loadedDataOwner)_loadedDataOwner=_op._owner;
    for(const{t,get}of _TD_TABLES){
      const key=t.replace(/^td_/,'').replace(/_([a-z])/g,(_m,c)=>c.toUpperCase());
      const pending=_op[key]||[];
      if(pending.length){
        const arr=get();const existingIds=new Set(arr.map(r=>String(r.id)));
        pending.filter(r=>!existingIds.has(String(r.id))).forEach(r=>arr.push(r));
      }
    }
  }catch(_e){}
}
function _enterOfflineMode(){
  document.getElementById('supa-login-overlay')?.remove();
  // Load from cache so the app has real data, not an empty shell
  const _cc=localStorage.getItem('zp3_cloud_cache');
  if(_cc){
    try{
      const _cd=JSON.parse(_cc);
      if(_cd._owner)_loadedDataOwner=_cd._owner; // tag whose data is in memory (cross-account guard)
      clients=_cd.clients||[];bids=_cd.bids||[];jobs=_cd.jobs||[];
      payments=_cd.payments||[];income=_cd.income||[];expenses=_cd.expenses||[];
      mileage=_cd.mileage||[];liens=_cd.liens||[];timeEntries=_cd.timeEntries||[];
      if(_cd.licenses?.length)licenses=_cd.licenses;
      if(_cd.events?.length)events=_cd.events;
      if(_cd.contracts?.length)contracts=_cd.contracts;if(_cd.agreements?.length)agreements=_cd.agreements;
      if(_cd.photos?.length)photos=_cd.photos;
      if(_cd.checksState&&Object.keys(_cd.checksState).length)checksState=_cd.checksState;
      if(_cd.settings){_mergeIncomingSettings(_cd.settings,'zp3_cloud_cache (cache restore)');applySettings();_refillSettingsFormUnlessEditing();}
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
  const _pendingInvite=JSON.parse(localStorage.getItem('_pendingEmpInvite')||'null');
  const _inviteBanner=_pendingInvite
    ?'<div style="background:#EFF6FF;border:1.5px solid #3B82F6;border-radius:var(--r);padding:12px 14px;margin-bottom:20px">'+
      '<div style="font-size:13px;font-weight:700;color:#1D4ED8;margin-bottom:2px">You\'ve been invited to join a crew on TradeDesk</div>'+
      '<div style="font-size:12px;color:#1e40af;line-height:1.5">Create a free account or sign in below to accept the invite and see your assigned jobs.</div>'+
      '</div>'
    :'';
  const overlay=document.createElement('div');
  overlay.id='supa-login-overlay';
  overlay.style.cssText='position:fixed;inset:0;z-index:9999;background:var(--bg);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px';
  const _inputStyle='font-size:16px;padding:12px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);width:100%;box-sizing:border-box';
  overlay.innerHTML= _pendingInvite
    ? (function(){
        const _piBname=escHtml(_pendingInvite.bname||'Your contractor');
        const _piEname=(_pendingInvite.ename||'').split(/[\s,]+/)[0];
        const _piEmail=_pendingInvite.email||'';
        const _roStyle=_inputStyle+';background:var(--bg3);color:var(--text3);cursor:default';
        return '<div style="max-width:360px;width:100%">'+
          '<div style="text-align:center;margin-bottom:24px">'+
            '<div style="font-size:36px;margin-bottom:10px">👷</div>'+
            '<div style="font-size:22px;font-weight:800;letter-spacing:-.02em;margin-bottom:6px">'+(_piEname?'Hey '+escHtml(_piEname)+', you\'re invited!':'You\'ve been invited!')+'</div>'+
            '<div style="font-size:13px;color:var(--text3);line-height:1.5"><strong style="color:var(--text2)">'+_piBname+'</strong> has added you to their crew on TradeDesk. Set up your account to see your assigned jobs.</div>'+
          '</div>'+
          '<div class="f" style="margin-bottom:10px"><label>Email</label>'+
            (_piEmail
              ?'<input type="email" id="supa-email" value="'+escHtml(_piEmail)+'" readonly style="'+_roStyle+'">'
              :'<input type="email" id="supa-email" placeholder="The email your invite was sent to" style="'+_inputStyle+'">'
            )+'</div>'+
          '<div class="f" style="margin-bottom:20px"><label>Create a password</label>'+
            '<input type="password" id="supa-pass" placeholder="Min 6 characters" autocomplete="new-password" style="'+_inputStyle+'"></div>'+
          '<button onclick="_supaEmpSignUp()" style="width:100%;padding:15px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:16px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:8px">Join the crew →</button>'+
          '<div id="supa-login-err" style="font-size:12px;color:#A32D2D;margin-top:12px;text-align:center;min-height:16px"></div>'+
          '</div>';
      })()
    : // ── Normal login ──────────────────────────────────────────────────────
      '<div style="max-width:360px;width:100%">'+
      '<div style="font-size:24px;font-weight:800;margin-bottom:4px">TradeDesk</div>'+
      '<div style="font-size:13px;color:var(--text3);margin-bottom:28px">Sign in to sync your data across devices</div>'+
      '<div class="f" style="margin-bottom:12px"><label>Email</label>'+
        '<input type="email" id="supa-email" placeholder="your@email.com" style="'+_inputStyle+'"></div>'+
      '<div class="f" style="margin-bottom:20px"><label>Password</label>'+
        '<input type="password" id="supa-pass" placeholder="Password" style="'+_inputStyle+'"></div>'+
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
async function _supaEmpSignUp(){
  const email=document.getElementById('supa-email')?.value?.trim();
  const pass=document.getElementById('supa-pass')?.value;
  const err=document.getElementById('supa-login-err');
  if(!email||!email.includes('@')){if(err){err.style.color='#A32D2D';err.textContent='Enter the email address your invite was sent to.';}return;}
  if(!pass||pass.length<6){if(err){err.style.color='#A32D2D';err.textContent='Password must be at least 6 characters.';}return;}
  if(err){err.style.color='var(--text3)';err.textContent='Creating your account...';}
  const{error}=await _supa.auth.signUp({email,password:pass});
  if(error){
    if(error.message?.toLowerCase().includes('already registered')){
      if(err){err.style.color='var(--text3)';err.textContent='Account exists — signing you in...';}
      const{error:siErr}=await _supa.auth.signInWithPassword({email,password:pass});
      if(siErr&&err){err.style.color='#A32D2D';err.textContent=siErr.message;}
    } else {
      if(err){err.style.color='#A32D2D';err.textContent=error.message;}
    }
    return;
  }
  if(err){err.style.color='var(--text3)';err.textContent='Account created — signing you in...';}
  await _supa.auth.signInWithPassword({email,password:pass});
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
  // GoTrue dispatches SIGNED_OUT asynchronously, and its handler is what wipes the
  // outgoing account's in-memory arrays and sets _supaUser=null. If the user signs
  // straight into a DIFFERENT account on the same page (no reload), that wipe can
  // land AFTER the new account's SIGNED_IN already set _supaUser — nulling it back
  // out and bleeding/blanking state. Drain deterministically: the SIGNED_OUT handler
  // clears _deliberateSignOut at the end of its wipe, so wait (bounded) for that flag
  // to drop before returning. Now any subsequent sign-in is a clean SIGNED_IN.
  const _t0=Date.now();
  while(_deliberateSignOut&&Date.now()-_t0<3000){await new Promise(r=>setTimeout(r,25));}
  _deliberateSignOut=false; // safety: never strand the guard if SIGNED_OUT didn't fire
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
// Merge an incoming settings object (cloud row or local cache snapshot) into S.
// If local S carries a newer settingsTs, the incoming copy is stale — e.g. the
// user hit Save then refreshed before the cloud flush finished (settings are
// written LAST in supaSaveToCloud, after all table upserts). Local wins and we
// flag a pending sync so the newer local settings get pushed up.
function _mergeIncomingSettings(ss,src){
  if(!ss)return false;
  if((S.settingsTs||0)>(ss.settingsTs||0)){
    try{localStorage.setItem('zp3_pending_sync','1');}catch(_e){}
    if(typeof supaSaveDebounced==='function')supaSaveDebounced();
    return false;
  }
  const _localTsBefore=S.settingsTs||0;
  const _localVehs=S.vehicles,_localVehsTs=S.vehiclesTs||0;
  S={...S,...ss};
  if(_localVehsTs>(ss.vehiclesTs||0)){S.vehicles=_localVehs;S.vehiclesTs=_localVehsTs;}
  // One-time migration: supplies rate default lowered from $0.40 to $0.25/sqft (2026-06)
  if(S.suppliesRate===0.40){S.suppliesRate=0.25;}
  // Persist the winning copy immediately — without this, a force-close right after
  // the merge boots from a stale zp3_S (cleared values resurrect as their old rate
  // until the next cloud merge; permanently if that boot happens offline).
  try{localStorage.setItem('zp3_S',JSON.stringify(S));}catch(_e){}
  return true;
}
// ── Per-individual-user UI layout (dashboard widget order + nav tab order) ──
// Stored in the user_prefs table keyed by auth.uid() — NOT in zj_data/S, which
// employees share with their contractor. This keeps each person's layout
// isolated (iOS-home-screen model: layout follows the identity, never bleeds).
function _userLayoutCacheKey(){return _supaUser?('td_layout_'+_supaUser.id):null;}
function _cacheUserLayoutLocal(){
  const k=_userLayoutCacheKey();if(!k)return;
  try{localStorage.setItem(k,JSON.stringify({d:S.dashWidgetOrder||null,n:S.navTabOrder||null,k:S.dashKpiOrder||null}));}catch(_e){}
}
async function _loadUserPrefs(){
  // Restore from per-uid local cache first so a force-quit before the cloud
  // round-trip still shows the right user's layout instantly on next boot.
  const k=_userLayoutCacheKey();
  if(k){try{const c=JSON.parse(localStorage.getItem(k)||'null');if(c){if(Array.isArray(c.d))S.dashWidgetOrder=c.d;if(Array.isArray(c.n))S.navTabOrder=c.n;if(Array.isArray(c.k))S.dashKpiOrder=c.k;}}catch(_e){}}
  if(!_supa||!_supaUser)return;
  try{
    const{data}=await _supa.from('user_prefs').select('dash_widget_order,nav_tab_order,kpi_order').eq('user_id',_supaUser.id).maybeSingle();
    if(data){
      if(Array.isArray(data.dash_widget_order))S.dashWidgetOrder=data.dash_widget_order;
      if(Array.isArray(data.nav_tab_order))S.navTabOrder=data.nav_tab_order;
      if(Array.isArray(data.kpi_order))S.dashKpiOrder=data.kpi_order;
      _cacheUserLayoutLocal();
    }
  }catch(_e){}
}
function _saveUserPrefs(){
  // Local cache is synchronous so a force-quit right after a reorder never loses it.
  _cacheUserLayoutLocal();
  if(!_supa||!_supaUser)return;
  try{
    _supa.from('user_prefs').upsert(
      {user_id:_supaUser.id,dash_widget_order:S.dashWidgetOrder||null,nav_tab_order:S.navTabOrder||null,kpi_order:S.dashKpiOrder||null,updated_at:new Date().toISOString()},
      {onConflict:'user_id'}
    ).then(()=>{},()=>{});
  }catch(_e){}
}
// Build the offline-pending snapshot, stamped with the owning account's user id.
// _owner lets the SIGNED_IN merge path refuse to fold one account's offline data
// into a different account (the cross-account-bleed root cause). _owner is null
// only for purely-local data entered before any sign-in (safe to adopt on first login).
function _offlinePendingBlob(){
  // Owner falls back to _loadedDataOwner so a blob written while offline (no _supaUser)
  // is still tagged with the account it came from — the next sign-in checks this.
  return JSON.stringify({_owner:(_supaUser&&_supaUser.id)||_loadedDataOwner||null,clients,bids,jobs,income,expenses:expenses.map(({receipt_img,...r})=>r),mileage,payments,liens,licenses,events:events.slice(-600),contracts,agreements,photos:photos.filter(p=>p.storagePath||p.url),timeEntries:timeEntries.slice(-500),ts:Date.now()});
}
// Read offline-pending, discarding (and clearing) any blob owned by a different
// account than the one now signed in. Returns null when nothing usable remains.
function _readOwnedOfflinePending(){
  let op;try{op=JSON.parse(localStorage.getItem('zp3_offline_pending')||'null');}catch(_e){return null;}
  if(!op)return null;
  if(op._owner&&_supaUser&&op._owner!==_supaUser.id){
    localStorage.removeItem('zp3_offline_pending');
    return null; // belongs to a previous account — never merge it in
  }
  return op;
}
function supaSaveDebounced(){
  // A deliberate sign-out is in progress — never persist or queue the outgoing
  // account's data. This is the last line of defense against cross-account bleed:
  // even if a debounced save was scheduled milliseconds before sign-out, it stops here.
  if(_deliberateSignOut)return;
  if(!supaEnabled())return;
  if(!_supaUser&&!_mergeOnSignIn)return;
  clearTimeout(_syncTimer);
  // Write the snapshot SYNCHRONOUSLY before starting the 2s timer.
  // This is the bulletproof force-quit safety net: iOS may kill the PWA process
  // before visibilitychange or the async catch block can run, but a synchronous
  // localStorage write completes atomically and survives any force-quit.
  // Cleared by supaSaveToCloud() on a successful push. Drain deduplicates on reload.
  if(_supaCloudLoaded||_mergeOnSignIn){
    try{localStorage.setItem('zp3_offline_pending',_offlinePendingBlob());}catch(_e){}
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
  if(syncing){b.textContent='Syncing...';b.style.background='#2563eb';b.style.color='#fff';}
  else{b.textContent='Offline — changes saved locally';b.style.background='#D97706';b.style.color='#1a1a1a';}
  b.style.opacity='1';b.style.transform='translateY(0)';b.style.pointerEvents='auto';
}
function _hideOfflineBanner(){
  const b=document.getElementById('offline-banner');if(!b)return;
  b.style.opacity='0';b.style.transform='translateY(-100%)';b.style.pointerEvents='none';
}
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
      const _jSet=new Set(jobs.map(j=>j.id));
      let _merged=false;
      _oClients.filter(c=>!_cSet.has(c.id)).forEach(c=>{clients.push(c);_merged=true;});
      _oJobs.filter(j=>!_jSet.has(j.id)).forEach(j=>{jobs.push(j);_merged=true;});
      // BIDS: non-destructive — newer/richer copy wins per id (see SIGNED_IN merge).
      // A silent cloud reload must never drop offline-edited room measurements.
      const _cloudBidById=new Map(bids.map(b=>[String(b.id),b]));
      _oBids.forEach(ob=>{
        const key=String(ob.id);const cb=_cloudBidById.get(key);
        if(!cb){bids.push(ob);_cloudBidById.set(key,ob);_merged=true;return;}
        const winner=_pickBid(ob,cb);
        if(winner!==cb){const idx=bids.findIndex(x=>String(x.id)===key);if(idx>-1)bids[idx]=winner;_cloudBidById.set(key,winner);_merged=true;}
      });
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
    // Pull latest state immediately — realtime sockets don't replay missed events,
    // so any changes from other devices during the outage need an explicit pull.
    if(_supaUser&&!_loadInProgress)supaLoadFromCloud({silent:true});
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
        try{localStorage.setItem('zp3_offline_pending',_offlinePendingBlob());}catch(_e){}
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
    const _snap={_owner:(_supaUser&&_supaUser.id)||_loadedDataOwner||null,clients,bids,jobs,payments,income,
      expenses:expenses.map(({receipt_img,...r})=>r),
      mileage,liens,timeEntries,licenses,events,contracts,agreements,photos,checksState,
      settings:S,cached_at:new Date().toISOString()};
    localStorage.setItem('zp3_cloud_cache',JSON.stringify(_snap));
  }catch(_e){}
}

async function supaSaveToCloud(){
  if(_deliberateSignOut){_logSave('skip','deliberate sign-out in progress');return;}
  if(!_supa||!_supaUser){
    if(_mergeOnSignIn){
      try{localStorage.setItem('zp3_offline_pending',_offlinePendingBlob());}catch(_e){}
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
  try{localStorage.setItem('zp3_offline_pending',_offlinePendingBlob());}catch(_e){}
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
  try{
    const receiptImages={};
    expenses.forEach(e=>{if(e.receipt_img)receiptImages[e.id]=e.receipt_img;});
    const _rj=JSON.stringify(receiptImages);
    if(_rj.length<4*1024*1024)localStorage.setItem('zp3_rcpt_imgs',_rj);
    else localStorage.removeItem('zp3_rcpt_imgs');
  }catch(_e){}

  const uid=_devSupportMode
    ?(Object.values(_DEV_SUPPORT_USERS).find(u=>u.name===_devSupportName)?.userId||_supaUser.id)
    :(_isEmployee?_contractorUserId:_supaUser.id);

  try{
    const ts=new Date().toISOString();

    // Settings FIRST — the table loop below takes seconds on mobile (a round-trip
    // per table) and a force-quit mid-save used to lose every settings change.
    // Settings are tiny; landing them immediately makes Save force-quit-proof.
    if(!_isEmployee){
      // Strip only stateRates (anon-readable reference data, never a user setting).
      // locationGranted/locationDenied DO persist to the cloud so the location
      // permission survives a reboot / cloud-authoritative reload — they were
      // previously stripped here, which is why "location permission doesn't save."
      // A wrongly-optimistic granted flag self-corrects on the next real GPS call
      // (getCurrentPosition errors → locationDenied is set), so syncing it is safe.
      const{stateRates:_sr0,...sForCloudFirst}=S;
      const{data:_zjRow,error:_se0}=await _supa.from('zj_data').upsert(
        {user_id:uid,settings:JSON.stringify(sForCloudFirst),checks_state:JSON.stringify(checksState),updated_at:ts},
        {onConflict:'user_id'}
      ).select('updated_at').single();
      if(_se0){throw _se0;}
      window._lastZjUpdatedAt=_zjRow?.updated_at||ts;
    }

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
      // Soft-delete ONLY ids the user EXPLICITLY deleted on this device (recorded in
      // _locallyDeletedIds) — or everything vanished, during a deliberate bulk wipe.
      // A row merely absent from this snapshot (e.g. a peer's row not yet merged here)
      // is NEVER swept, so concurrent devices can't clobber each other's new rows.
      const prev=_lastKnownIds[tbl]||new Set();
      const deleted=_locallyDeletedIds[tbl]||new Set();
      const gone=[...prev].filter(id=>!currentIds.has(id)&&!lockedIds.has(id)&&deleted.has(id));
      if(gone.length){
        for(let i=0;i<gone.length;i+=50){
          const{error:_de}=await _supa.from(tbl).update({deleted_at:ts,updated_at:ts}).in('id',gone.slice(i,i+50)).eq('user_id',uid);
          if(_de)throw _de;
        }
      }
      gone.forEach(id=>deleted.delete(id)); // delete-intent consumed; don't let the set grow
      _lastKnownIds[tbl]=currentIds;
    };

    // Never write back a table the server redacted for this employee — its
    // in-memory money fields are zeroed, and upserting them would overwrite the
    // contractor's real amounts. Permission-derived so it holds even if the RPC
    // fell back to a raw load. Contractors skip nothing.
    const _saveSkip=_employeeRedactedTables();
    for(const {t,get,tx} of _TD_TABLES){
      if(_saveSkip.has(t)){continue;}
      const arr=get();
      try{
        await _upsertTable(t,arr,tx);
      }catch(_te){
        // Unprovisioned table (migration not yet applied) — skip it, keep syncing the
        // rest. Without this, one missing table flips the whole app to offline/error.
        if(_isMissingTableErr(_te)){console.warn('[cloud] skipping save to unprovisioned table',t);continue;}
        throw _te;
      }
    }

    _logSave('ok',{id:_attemptId,mileage:_mileCount});
    localStorage.removeItem('zp3_pending_sync');
    localStorage.removeItem('zp3_offline_pending');
    _writeLocalCache();
    _hideOfflineBanner();
    supaSetStatus('synced');
    // Signal other open devices to reload (send() is async — catch the rejection so it never bubbles)
    if(_syncBroadcastChannel){try{const _bc=_syncBroadcastChannel.send({type:'broadcast',event:'data_saved',payload:{deviceId:_deviceId}});if(_bc&&typeof _bc.catch==='function')_bc.catch(()=>{});}catch(_e){}}
  }catch(e){
    _logSave('throw',{id:_attemptId,name:e?.name,code:e?.code,msg:e?.message||String(e)});
    console.warn('Cloud save failed:',e);
    localStorage.setItem('zp3_pending_sync','1');
    try{localStorage.setItem('zp3_offline_pending',_offlinePendingBlob());}catch(_e){}
    _showOfflineBanner();
    supaSetStatus('error');
  }
}

async function checkNewSignatures(){
  if(_checkSigsBusy||!_supa||!_supaUser)return;
  _checkSigsBusy=true;
  try{
    // Use localStorage as the seen-list — no DB column dependency
    const seenCache=new Set(JSON.parse(localStorage.getItem('zp3_seen_sigs')||'[]'));
    // select('*') — optional columns (epa_*, cancelled_*) may not exist in every
    // environment; an explicit column list would fail the whole query on drift.
    const{data,error}=await _supa.from('signed_proposals')
      .select('*')
      .eq('contractor_user_id',_supaUser.id)
      .order('signed_at',{ascending:false})
      .limit(100);
    if(error)throw error;
    if(data&&data.length){
      let changed=false;const alerts=[];const newSeen=[];const coSignedAlerts=[];
      for(const s of data){
        const key=String(s.bid_id);
        const alreadySeen=seenCache.has(key);
        const bid=bids.find(b=>String(b.id)===key);
        if(!bid){if(!alreadySeen)newSeen.push(key);continue;} // deleted/orphaned
        // Client cancelled within the rescission window (e-signed Notice of Cancellation).
        // Runs before the signed/declined branches and regardless of seenCache — the
        // cancellation always arrives after the signature row was already seen.
        if(s.cancelled_at){
          if(!bid.clientCancelled){
            bid.clientCancelled=true;
            bid.cancelledAt=s.cancelled_at;
            bid.cancelledName=s.cancelled_signed_name||'';
            bid.status='Closed Lost';bid.draft=false;
            // Cancel the linked job too — 'canceled' removes it from every active-job
            // query (today feed, schedule, collect) while keeping the record.
            const _cj=(typeof jobs!=='undefined'?jobs:[]).find(j=>j.bid_id===bid.id);
            if(_cj){_cj.clientCancelled=true;_cj.status='canceled';}
            // Clawback: reverse every recorded payment on this bid so the books reflect
            // the legally required refund (K.S.A. 50-640 / 16 CFR 429: within 10 business days)
            const _cpaid=(typeof payments!=='undefined'?payments:[]).filter(p=>p.bid_id===bid.id&&p.amount>0);
            const _ctotal=_cpaid.reduce((t,p)=>t+p.amount,0);
            const _hasRefund=(typeof payments!=='undefined'?payments:[]).some(p=>p.bid_id===bid.id&&p._cancelRefund);
            if(_ctotal>0&&!_hasRefund){
              payments.push({id:Date.now(),bid_id:bid.id,amount:-_ctotal,date:todayKey(),method:'refund',type:'refund',_cancelRefund:true,note:'Refund — client cancelled within rescission window'});
            }
            changed=true;
            const _isStripe=s.payment_method&&s.payment_method!=='cash'&&s.payment_method!=='check';
            const _refundDays=_isStripe?'5–7':'10';
            if(typeof showToast==='function')showToast('🚫 '+(s.client_name||'Client')+' cancelled — refund'+(_ctotal>0?' '+fmt(_ctotal):'')+' within '+_refundDays+' business days','⚠️');
          }else if(bid.status!=='Closed Lost'){
            // Re-assert the terminal state if a later sync path flipped it back
            bid.status='Closed Lost';changed=true;
          }
          // Always stop here: a cancelled row must never fall through to the signed
          // branch below, which would resurrect the bid to Closed Won on every sync.
          if(!alreadySeen)newSeen.push(key);
          continue;
        }
        // Change orders signed remotely in the client hub — apply to the local bid.
        // Mirrors _submitCOSign bookkeeping: mark the CO signed and roll bid.amount
        // to the new contract total (balance derives from payments via getBidBalance).
        // Runs regardless of seenCache — the signature lands after the row was seen.
        if(Array.isArray(s.change_orders)&&s.change_orders.length&&bid.changeOrders&&bid.changeOrders.length){
          for(const rc of s.change_orders){
            if(!rc||!rc.signedAt)continue;
            const lc=bid.changeOrders.find(x=>x.coNum===rc.coNum);
            if(!lc||lc.signedAt)continue;
            lc.signedAt=rc.signedAt;lc.signerName=rc.signerName||'Client';
            if(rc.signatureData)lc.sigData=rc.signatureData;
            lc.status='signed';
            bid.amount=rc.newAmount!=null?rc.newAmount:Math.max(0,Math.round((bid.amount+(lc.delta||0))*100)/100);
            changed=true;
            coSignedAlerts.push({client:s.client_name||'Client',coNum:lc.coNum,newTotal:bid.amount,clientId:bid.client_id});
          }
        }
        if(s.payment_status==='declined'){
          // Client declined — mark as Closed Lost, not Closed Won
          if(bid.status!=='Closed Lost'){
            bid.status='Closed Lost';bid.draft=false;
            bid.declinedAt=s.signed_at;
            changed=true;
          }
        } else {
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
          // Refresh signature metadata even when already won — the signature image and
          // EPA ack can land after the status flip (or the DB columns were added later).
          if(s.signature_data&&bid.signatureData!==s.signature_data){bid.signatureData=s.signature_data;changed=true;}
          if(s.epa_ack_at&&bid.epaAckAt!==s.epa_ack_at){bid.epaAckAt=s.epa_ack_at;changed=true;}
          if(s.client_signed_name&&!bid.signedName){bid.signedName=s.client_signed_name;changed=true;}
          if(s.signed_at&&!bid.signedAt){bid.signedAt=s.signed_at;changed=true;}
        }
        if(!alreadySeen)newSeen.push(key);
      }
      if(newSeen.length){
        newSeen.forEach(id=>seenCache.add(id));
        localStorage.setItem('zp3_seen_sigs',JSON.stringify([...seenCache].slice(-500)));
      }
      if(changed){
        saveAll();
        [...new Set([...alerts.map(a=>a.clientId),...coSignedAlerts.map(a=>a.clientId)])].forEach(cid=>_refreshClientHub(cid));
        coSignedAlerts.forEach(a=>{if(typeof showToast==='function')showToast('✍️ '+a.client+' signed Change Order #'+a.coNum+' — contract now '+fmt(a.newTotal),'📋');});
        const existing=JSON.parse(localStorage.getItem('zp3_schedule_alerts')||'[]');
        localStorage.setItem('zp3_schedule_alerts',JSON.stringify([...existing,...alerts]));
        renderDash();
        if(coSignedAlerts.length&&typeof renderJobsPage==='function')renderJobsPage();
        if(typeof renderClientDetail==='function'&&typeof currentClientId!=='undefined'&&currentClientId)renderClientDetail();
        if(!window._showingScheduleAlert)setTimeout(showScheduleAlerts,400);
      }
    }
  }catch(e){console.warn('checkNewSignatures:',e);}finally{_checkSigsBusy=false;}
}
async function _fetchProposalViews(){
  if(!_supa||!_supaUser)return;
  try{
    // Edge Function log-proposal-view writes to proposal_views using service key (bypasses RLS).
    // Contractor reads back with their authenticated session — RLS allows SELECT on own rows.
    const{data,error}=await _supa.from('proposal_views')
      .select('bid_id,opened_at,hub_opened_at,hub_view_count,client_opened_at,client_view_count,contractor_opened_at')
      .eq('contractor_user_id',_supaUser.id)
      .not('bid_id','is',null)
      .order('opened_at',{ascending:false});
    if(data&&!error){
      // Build into temporaries first, then swap atomically — prevents a renderDash()
      // mid-flight from seeing an empty dict during the rebuild window (flicker race).
      const _pvBid={},_pvHub={},_pvClient={},_pvCon={},_pvHubCnt={},_pvCliCnt={};
      data.forEach(v=>{
        if(!v.bid_id)return;
        if(!_pvBid[v.bid_id])_pvBid[v.bid_id]=v.opened_at;
        if(v.hub_opened_at&&!_pvHub[v.bid_id])_pvHub[v.bid_id]=v.hub_opened_at;
        if(v.client_opened_at&&!_pvClient[v.bid_id])_pvClient[v.bid_id]=v.client_opened_at;
        if(v.contractor_opened_at&&!_pvCon[v.bid_id])_pvCon[v.bid_id]=v.contractor_opened_at;
        if(v.hub_view_count)_pvHubCnt[v.bid_id]=(v.hub_view_count||0);
        if(v.client_view_count)_pvCliCnt[v.bid_id]=(v.client_view_count||0);
      });
      _proposalViewsByBid=_pvBid;
      _proposalViewsByBidHubClient=_pvHub;
      _proposalViewsByBidClient=_pvClient;
      _proposalViewsByBidContractor=_pvCon;
      _proposalViewsByBidHubCount=_pvHubCnt;
      _proposalViewsByBidClientCount=_pvCliCnt;
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
    '<div style="font-size:18px;font-weight:800;margin-bottom:2px">Schedule '+escHtml(cname||'')+'</div>'+
    '<div style="font-size:12px;color:var(--text3);margin-bottom:16px">'+(bid?fmt(bid.amount)+' · '+days+' day'+(days!==1?'s':''):'')+' painting job</div>'+
    '<div style="background:var(--blue-lt);border:1.5px solid var(--blue);border-radius:var(--r);padding:14px;margin-bottom:14px;text-align:center">'+
      '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--blue);margin-bottom:4px">Next available</div>'+
      '<div style="font-size:22px;font-weight:800;color:var(--blue-dk)">'+startLabel+'</div>'+
      (endLabel?'<div style="font-size:12px;color:var(--blue);margin-top:2px">Through '+fmtD(endKey)+'</div>':'')+
    '</div>'+
    '<div style="font-size:11px;color:var(--text3);text-align:center;margin-bottom:14px">Confirm with client, then tap "Lock it in"</div>'+
    '<div style="display:grid;gap:8px;margin-bottom:8px">'+
      (phone?'<a href="'+smsHref+'" style="display:block;padding:13px;border-radius:var(--r);border:none;background:#27AE60;color:#fff;font-size:15px;font-weight:700;text-align:center;text-decoration:none">📱 Text '+escHtml(firstName||'')+' to confirm</a>':'')+
      (callHref?'<a href="'+callHref+'" style="display:block;padding:11px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);font-size:14px;font-weight:600;text-align:center;text-decoration:none">📞 Call '+escHtml(firstName||'')+'</a>':'')+
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
  const _db=bids.find(b=>b.id===bidId);
  const _cid=_db?.client_id;
  zConfirm('Delete this pending bid? The client\'s signing link will stop working.',()=>{
    const idx=bids.findIndex(b=>b.id===bidId);
    if(idx>-1){_userDelete(()=>{bids.splice(idx,1);clearEstFullDraft();saveAll();});renderDash();
      if(_cid)_uploadClientHub(_cid).catch(e=>console.error('[hub upload]',e));}
  },{title:'Delete pending bid',yes:'Delete',danger:true});
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
        try{const p=JSON.parse(txt);_supa.storage.from('proposals').upload(b.signingKey,JSON.stringify({...p,status:'voided'}),{contentType:'application/json',upsert:true,cacheControl:'0'});}catch(e){}
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
  window._lastCloudLoadAt=Date.now();
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

    // Settings load runs in parallel with the table load below.
    const _settingsP=_supa.from('zj_data').select('settings,checks_state,receipt_images,updated_at').eq('user_id',uid).maybeSingle();

    // EMPLOYEE sessions load through the SECURITY DEFINER RPC load_account_data,
    // which redacts money fields the employee's permissions don't grant — so the
    // contractor's bid amounts / income never reach an employee's browser memory.
    // Contractors (and dev-support) keep the raw per-table select. If the RPC is
    // not yet deployed (migration not merged to prod), fall back to the raw load:
    // visibility is unchanged until the migration lands, but the SAVE guard
    // (_employeeRedactedTables) still prevents any corruption in the meantime.
    const _rawLoad=()=>Promise.all(_TD_TABLES.map(({t})=>
      _supa.from(t).select('id,data').eq('user_id',uid).is('deleted_at',null)
    ));
    let tableResults;
    if(_isEmployee&&!_devSupportMode){
      const{data:_red,error:_rpcErr}=await _supa.rpc('load_account_data',{target_uid:uid});
      if(_rpcErr&&(_isMissingTableErr(_rpcErr)||_rpcErr.code==='PGRST202'||/function|does not exist/i.test(_rpcErr.message||''))){
        console.warn('[cloud] load_account_data RPC unavailable — falling back to raw load (save guard still active)');
        tableResults=await _rawLoad();
      }else if(_rpcErr){
        throw _rpcErr;
      }else{
        // Shape the RPC's {td_bids:[{id,data}],…} object into the per-table
        // {data,error} the loop below expects.
        tableResults=_TD_TABLES.map(({t})=>({data:(_red&&_red[t])||[],error:null}));
      }
    }else{
      tableResults=await _rawLoad();
    }
    const settingsResult=await _settingsP;

    // A table whose migration hasn't reached the live DB yet must NOT abort the entire
    // sync — that would take down ALL cloud loading and trap the app in an offline loop.
    // Skip only "table does not exist" errors; real failures (auth, network) still throw.
    for(let i=0;i<_TD_TABLES.length;i++){
      const err=tableResults[i].error;
      if(err&&!_isMissingTableErr(err))throw err;
    }

    for(let i=0;i<_TD_TABLES.length;i++){
      const{t,set}=_TD_TABLES[i];
      if(tableResults[i].error){console.warn('[cloud] skipping unprovisioned table',t);continue;} // missing table — leave in-memory data untouched
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
    if(sd?.updated_at)window._lastZjUpdatedAt=sd.updated_at;
    if(sd){
      if(sd.checks_state){const cc=(()=>{try{return JSON.parse(sd.checks_state);}catch{return null;}})();if(cc&&Object.keys(cc).length)checksState=cc;}
      if(sd.settings){const ss=(()=>{try{return JSON.parse(sd.settings);}catch{return null;}})();
        if(ss){_mergeIncomingSettings(ss,'cloud zj_data (Supabase)'+(silent?' — BACKGROUND refresh (realtime/broadcast/PTR)':' — BOOT 3/4'));
          if(S.fedMFS===14600)S.fedMFS=15000;if(S.fedSingle===14600)S.fedSingle=15000;
          if(S.fedMFJ===29200)S.fedMFJ=30000;if(S.fedHOH===21900)S.fedHOH=22500;
          if(S.b10===11600)S.b10=11925;if(S.b12===47150)S.b12=48475;
          if(S.b22===100525)S.b22=103350;if(S.b24===191950)S.b24=197300;
          if(S.b32===243725)S.b32=250525;if(S.b35===609350)S.b35=626350;
          const _IRS_RATE_2026=0.725,_IRS_YEAR=2026;
          if(new Date().getFullYear()>=_IRS_YEAR&&S.irsRate<_IRS_RATE_2026){S.irsRate=_IRS_RATE_2026;S.irsRateYear=_IRS_YEAR;}
          applySettings();_refillSettingsFormUnlessEditing();
          if(!_isEmployee&&ss.ownerName&&_supaUser?.id){localStorage.setItem('zp3_uname_'+_supaUser.id,ss.ownerName);if(_user)_user.name=ss.ownerName;}
          if(_isEmployee&&_employeeRecord?.name&&_user){_user.name=_employeeRecord.name;}
        }
      }
    }

    // Override the shared-blob layout with THIS individual's saved layout.
    // For an employee the settings above came from the contractor's zj_data;
    // this restores the employee's own dashboard/nav order keyed by auth.uid().
    await _loadUserPrefs();
    // Re-apply the tab order now that S holds this user's value (boot ran the
    // initial apply before the cloud round-trip). Dashboard order re-applies
    // itself inside renderDash() below.
    if(typeof _applyTabOrder==='function'&&typeof _getTabOrder==='function')_applyTabOrder(_getTabOrder());

    _supaCloudLoaded=true;_loadedFromCacheOnly=false;_mergeOnSignIn=false;
    _loadedDataOwner=(_supaUser&&_supaUser.id)||_loadedDataOwner; // remember whose data is in memory
    supaSetStatus('synced');

    // If _mergeIncomingSettings detected local is newer than cloud it scheduled a
    // debounced save (2 s). Flush it immediately now that _supaCloudLoaded=true so
    // a force-quit right after boot can't outrun the timer and lose settings.
    if(localStorage.getItem('zp3_pending_sync')==='1'){
      clearTimeout(_syncTimer);_syncTimer=null;
      setTimeout(()=>supaSaveToCloud(),50);
    }

    if(!silent){
      setTimeout(()=>{if(_stripeConnectStatus===null)_fetchStripeConnectStatus().catch(()=>{});},500);
      _removeBootOverlay();goPg('pg-dash');
    }

    // De-duplicate and filter BEFORE rendering — prevents flash of duplicate bids on PTR
    const _dedupById=(arr)=>{const seen=new Set();return arr.filter(x=>{if(seen.has(x.id))return false;seen.add(x.id);return true;});};
    const _preLen=clients.length+bids.length+jobs.length;
    clients=_dedupById(clients);bids=_dedupById(bids);jobs=_dedupById(jobs);
    if(clients.length+bids.length+jobs.length<_preLen)setTimeout(()=>_flushSaveNow(),1200);
    bids=bids.filter(b=>!(b.draft===true&&b.status==='Draft'&&b.geiLines===undefined&&(!b.surfaces||!b.surfaces.length)&&!b.signingToken&&!b.amount));
    const _geiSeen=new Set();
    bids=bids.filter(b=>{if(b.geiLines===undefined||b.signingToken||b.amount||(b.geiLines||[]).length)return true;if(b.status!=='Draft'&&b.status!=='Pending')return true;const key=b.client_id+'|'+(b.trade_type||'general');if(_geiSeen.has(key))return false;_geiSeen.add(key);return true;});

    renderDash();buildScopeGrid();
    renderClientList&&renderClientList();renderLeadsPage&&renderLeadsPage();renderJobsPage&&renderJobsPage();renderMoneyPage&&renderMoneyPage();
    if(typeof _startPropQueue==='function')setTimeout(_startPropQueue,5000);
    if(typeof renderIncome==='function')renderIncome();
    if(typeof renderExpenses==='function')renderExpenses();
    if(typeof _fetchScopeRates==='function')_fetchScopeRates();
    if(typeof renderAllMileage==='function')renderAllMileage();
    if(typeof renderFleet==='function')renderFleet();
    if(typeof renderGallery==='function')renderGallery();
    if(typeof renderLicensing==='function')renderLicensing();
    if(typeof renderCalendar==='function')renderCalendar();
    if(typeof renderDashActiveLiens==='function')renderDashActiveLiens();
    if(typeof renderClientDetail==='function'&&typeof currentClientId!=='undefined'&&currentClientId&&document.querySelector('.pg.active')?.id==='pg-client-detail')renderClientDetail();
    clients.forEach(c=>{if(!c.clientToken)_ensureClientToken(c.id);});

    // Remove any duplicate clawback payments created by the concurrent-run race fixed in
    // this commit (two _cancelRefund entries per bid_id — keep the first, drop extras).
    (function _dedupeClawbacks(){
      const seen=new Set();let dirty=false;
      for(let i=payments.length-1;i>=0;i--){
        const p=payments[i];
        if(!p||!p._cancelRefund)continue;
        if(seen.has(p.bid_id)){payments.splice(i,1);dirty=true;}
        else seen.add(p.bid_id);
      }
      if(dirty){saveAll();if(typeof renderDash==='function')renderDash();}
    })();

    // Always fetch proposal views on every load so PTR gets fresh timestamps immediately
    setTimeout(()=>{checkNewSignatures();_fetchProposalViews();if(!window._showingScheduleAlert&&!silent)showScheduleAlerts();},1500);

    if(!silent&&!_cloudTimersStarted){
      _cloudTimersStarted=true;
      setTimeout(()=>{
        if(_supaUser)clients.filter(c=>c.clientToken).forEach(c=>{_uploadClientHub(c.id).catch(()=>{});});
        autoRefreshRates();autoRefreshTaxBrackets();autoRefreshLienRules();
        if(typeof autoRefreshDepositCaps==='function')autoRefreshDepositCaps();
      },4000);
      setTimeout(()=>_checkOdometerPrompt(),3500);
      setInterval(()=>{checkNewSignatures();_fetchProposalViews();},30000);
      // Cross-device change poll: zj_data.updated_at bumps on every cloud save
      // from any device (settings are written first on each save). One tiny row
      // read per 30s guarantees other devices' changes land even when the
      // realtime socket is down. Skipped within 8s of a local save (echo).
      setInterval(async()=>{
        if(!_supaUser||_loadInProgress||document.visibilityState==='hidden')return;
        if(Date.now()-_lastLocalSaveAt<8000)return;
        try{
          const _puid=_devSupportMode?(Object.values(_DEV_SUPPORT_USERS).find(u=>u.name===_devSupportName)?.userId||_supaUser.id):(_isEmployee?_contractorUserId:_supaUser.id);
          const{data:_zr}=await _supa.from('zj_data').select('updated_at').eq('user_id',_puid).maybeSingle();
          if(_zr?.updated_at&&window._lastZjUpdatedAt&&_zr.updated_at!==window._lastZjUpdatedAt){
            supaLoadFromCloud({silent:true});
          }
        }catch(_e){}
      },30000);  // 30s cross-device backstop (realtime socket is the primary, instant path).
                 // Was 1000ms — a visible tab hit zj_data 60×/min = ~3,600 /api reads/hr for
                 // no benefit the socket doesn't already cover. 30s matches the design comment.
      try{
        _supa.channel('sig-feed-'+_supaUser.id)
          .on('postgres_changes',{event:'*',schema:'public',table:'signed_proposals',filter:'contractor_user_id=eq.'+_supaUser.id},()=>{checkNewSignatures();})
          .on('postgres_changes',{event:'*',schema:'public',table:'proposal_views',filter:'contractor_user_id=eq.'+_supaUser.id},()=>{_fetchProposalViews();})
          .subscribe();
      }catch(e){}
      setInterval(()=>_loadPendingInbound(),30000);
      setTimeout(()=>_fetchStripeConnectStatus(),3000);
      setTimeout(()=>_loadPendingInbound(),2000);
      document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){
        checkNewSignatures();_fetchProposalViews();if(_supaUser)_loadPendingInbound();checkNearbyJob();
        // Cross-device freshness without relying on the realtime socket: when the
        // app returns to the foreground, pull the latest cloud state (settings
        // included) if the last load is more than 60s old.
        if(_supaUser&&!_loadInProgress&&Date.now()-(window._lastCloudLoadAt||0)>60000)supaLoadFromCloud({silent:true});
      }});
      // Cross-tab signal: sign.html writes zp3_sig_notify after a successful cash/check save.
      // This fires immediately in the contractor's open TradeDesk tab — no polling delay.
      window.addEventListener('storage',e=>{if(e.key==='zp3_sig_notify'&&e.newValue)checkNewSignatures();});
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
        if(_cd.contracts?.length)contracts=_cd.contracts;if(_cd.agreements?.length)agreements=_cd.agreements;if(_cd.photos?.length)photos=_cd.photos;
        if(_cd.checksState&&Object.keys(_cd.checksState).length)checksState=_cd.checksState;
        if(_cd.settings){_mergeIncomingSettings(_cd.settings,'zp3_cloud_cache (cloud load FAILED — fallback)');applySettings();_refillSettingsFormUnlessEditing();}
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
    // If a peer broadcast arrived while this load was in flight, run one trailing load
    // now (it couldn't reload mid-load) so this device doesn't stay on a stale value.
    if(_broadcastPending){
      _broadcastPending=false;
      clearTimeout(_broadcastReloadTimer);
      _broadcastReloadTimer=setTimeout(()=>{if(!_loadInProgress)supaLoadFromCloud({silent:true});},300);
    }
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
    // zj_data is not in _TD_TABLES (single-row settings, not a record table) but we
    // want instant cross-device settings sync when any device saves. postgres_changes
    // fires on all other subscribed clients the moment the row is written.
    ch.on('postgres_changes',{event:'UPDATE',schema:'public',table:'zj_data',filter:'user_id=eq.'+uid},()=>{
      if(!_loadInProgress&&Date.now()-_lastLocalSaveAt>5000)supaLoadFromCloud({silent:true});
    });
    ch.subscribe();
  }catch(e){console.warn('[realtime] td-sync subscribe failed:',e);}
  try{
    _syncBroadcastChannel=_supa.channel('user-data-'+_supaUser.id);
    _syncBroadcastChannel
      .on('broadcast',{event:'data_saved'},(msg)=>{
        if(msg?.payload?.deviceId===_deviceId&&Date.now()-_lastLocalSaveAt<5000)return;
        // Can't reload during an in-flight load — but DON'T just drop it: remember a
        // peer update arrived so supaLoadFromCloud's finally re-runs one trailing load
        // (otherwise a rapid burst leaves this device on a stale mid-burst value).
        if(_loadInProgress){_broadcastPending=true;return;}
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
  if(typeof renderFleet==='function')renderFleet();
  if(typeof renderGallery==='function')renderGallery();
  if(typeof renderLicensing==='function')renderLicensing();
  if(typeof renderCalendar==='function')renderCalendar();
  if(typeof renderDashActiveLiens==='function')renderDashActiveLiens();
  if(typeof renderClientDetail==='function'&&typeof currentClientId!=='undefined'&&currentClientId&&document.querySelector('.pg.active')?.id==='pg-client-detail')renderClientDetail();
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
  if(document.querySelector('.pg.active')?.id==='pg-leads')renderLeadsPage();
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
  if(document.querySelector('.pg.active')?.id==='pg-leads')renderLeadsPage();
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
  const weekPay=payments.filter(p=>p.amount!==0&&p.date>=monday&&p.date<=tk);
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
        // A job record can lack eventType (it's implicitly a job); the icon already
        // defaults to 🔨 in that case, so default the label to 'job' too — calling
        // .charAt on an undefined eventType throws (cloud.js:3708 console error).
        const et=j.eventType||'job';
        return '<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border)">'+
          '<div style="font-size:16px">'+icon+'</div>'+
          '<div>'+
            '<div style="font-size:13px;font-weight:600">'+escHtml(nm)+'</div>'+
            '<div style="font-size:11px;color:var(--text3)">'+et.charAt(0).toUpperCase()+et.slice(1)+(c&&c.addr?' · '+escHtml(c.addr.split(',')[0]):'')+'</div>'+
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
  // Clear ALL service-worker caches before reloading. The SW serves JS/CSS
  // subresources cache-first (cached||net), so a plain reload of fresh HTML
  // still pulls js/cloud.js — and therefore APP_VERSION — from the stale cache,
  // leaving the app pinned to the old version forever. Deleting the caches here
  // forces every subresource on the next load to miss and fetch fresh from the
  // network, so the new code actually takes effect.
  try{
    if(window.caches){
      const keys=await caches.keys();
      await Promise.all(keys.map(k=>caches.delete(k)));
    }
  }catch(e){}
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
// Fetches version.json (never cached by the SW, and with no-store to bypass the
// browser HTTP cache) and compares the live server version to the running
// APP_VERSION. version.json is the single source of truth — APP_VERSION lives in
// js/cloud.js, not in index.html, so grepping the HTML never worked.
async function _checkVersionOnResume(){
  try{
    const r=await fetch('version.json?_='+Date.now(),{cache:'no-store'});
    if(!r.ok)return;
    const d=await r.json();
    if(d&&d.version&&d.version!==APP_VERSION)await _autoSaveAndReload();
  }catch(e){}
}
// Fires on foreground resume — SW navigate handler covers fresh opens
document.addEventListener('visibilitychange',()=>{if(!document.hidden)_checkVersionOnResume();});

