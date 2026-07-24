let _stripeConnectStatus=null; // cached: {connected, charges_enabled, details_submitted, stripe_account_id}
Object.defineProperty(window,'_stripeConnectStatus',{get:()=>_stripeConnectStatus,set:v=>{_stripeConnectStatus=v;},configurable:true});

// ── Invite URL handling (employee + sub referral) ────────────────────────────
// ?sub_invite= is a REFERRAL, not an access grant: it carries only marketing
// prefill (inviter's business name, the sub's name/trade) for the signup
// screen. The sub creates their own completely separate account, nothing in
// the payload links to the inviter's data, so forgeable base64 is fine here,
// unlike ?emp_invite= which mints server-verified claim tokens.
function _parseSubInvitePayload(raw){
  try{
    const inv=JSON.parse(atob(raw));
    if(inv&&(inv.bn||inv.n))return{bn:String(inv.bn||''),n:String(inv.n||''),t:String(inv.t||'')};
  }catch(_e){}
  return null;
}
(function(){
  const params=new URLSearchParams(window.location.search);
  const raw=params.get('emp_invite');
  if(raw){
    try{
      const inv=JSON.parse(atob(raw));
      if(inv.cid&&inv.eid)localStorage.setItem('_pendingEmpInvite',JSON.stringify(inv));
    }catch(_e){}
  }
  const subRaw=params.get('sub_invite');
  if(subRaw){
    const si=_parseSubInvitePayload(subRaw);
    if(si)localStorage.setItem('_pendingSubInvite',JSON.stringify(si));
  }
  // &grant= rides alongside ?sub_invite=: an opaque single-use token for the
  // server-side snapshot (inviter-as-lead + payment history). The data itself
  // never travels in the URL, redemption happens post-signup via RPC.
  const grantTok=params.get('grant');
  if(grantTok&&/^[a-f0-9]{16,64}$/i.test(grantTok))localStorage.setItem('_pendingSubInviteGrant',grantTok);
  if(raw||subRaw||grantTok)history.replaceState(null,'',window.location.pathname);
})();

async function _fetchStripeConnectStatus(){
  if(!supaEnabled()||!_supaUser)return null;
  // CREW: the status that matters is the BOSS's (payments from any link route to the
  // account in the link's u= param, the effective uid). The Edge Function verifies
  // the team link server-side before honoring the target. Cache is keyed by the
  // EFFECTIVE account so an owner-and-crew dual identity never reads a stale mix.
  const _statusUid=(typeof _effectiveUid==='function'&&_effectiveUid())||_supaUser?.id||'';
  const _cacheKey='td_stripe_status_'+_statusUid;
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
      method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify(_isEmployee&&_statusUid!==_supaUser.id?{target:_statusUid}:{})
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
  // getSession() reads the token from localStorage instantly, no network needed.
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
    // A stored account the backend couldn't verify in THIS environment (e.g. a
    // live account viewed from a test-mode preview, or a deleted account). Offer
    // an explicit reset so a fresh account can be connected, the dead-Connect trap.
    if(data&&data.has_stored_account){
      el.innerHTML=
        '<div style="display:flex;align-items:flex-start;gap:8px;background:#FFF8F0;border:1px solid var(--amber);border-radius:var(--r);padding:10px 12px;margin-bottom:10px">'+
          '<span style="font-size:16px">'+svgIcon('⚠',{size:16})+'</span>'+
          '<div>'+
            '<div style="font-size:13px;font-weight:700;color:#856404">Existing Stripe connection can’t be verified here</div>'+
            '<div style="font-size:11px;color:var(--text3);line-height:1.5">A Stripe account is linked but isn’t reachable in this environment (test vs live mode). Reset the connection to link a fresh account.</div>'+
          '</div>'+
        '</div>'+
        '<button class="btn btn-p btn-sm" onclick="startStripeConnect()">'+svgIcon('⚡')+' Connect a new account</button>'+
        '<button class="btn btn-sm" onclick="disconnectStripeConnect()" style="margin-left:8px;font-size:12px;color:var(--red)">Reset connection</button>';
      return;
    }
    el.innerHTML=
      '<div style="font-size:13px;color:var(--text2);margin-bottom:10px;line-height:1.5">Connect your Stripe account so clients can pay you directly via card or bank transfer. Money lands in your Stripe account instantly.</div>'+
      '<button class="btn btn-p" onclick="startStripeConnect()" style="font-size:13px;padding:10px 18px">'+svgIcon('⚡')+' Connect Stripe Account</button>';
    return;
  }
  if(data.connected&&!data.charges_enabled){
    el.innerHTML=
      '<div style="display:flex;align-items:center;gap:8px;background:#FFF8F0;border:1px solid var(--amber);border-radius:var(--r);padding:10px 12px;margin-bottom:10px">'+
        '<span style="font-size:16px">'+svgIcon('⚠',{size:16})+'</span>'+
        '<div>'+
          '<div style="font-size:13px;font-weight:700;color:#856404">Stripe setup incomplete</div>'+
          '<div style="font-size:11px;color:var(--text3)">Account created but onboarding not finished.</div>'+
        '</div>'+
      '</div>'+
      '<button class="btn btn-p btn-sm" onclick="startStripeConnect()">Resume setup →</button>'+
      '<button class="btn btn-sm" onclick="disconnectStripeConnect()" style="margin-left:8px;font-size:12px;color:var(--red)">Disconnect</button>';
    return;
  }
  // Fully connected
  el.innerHTML=
    '<div style="display:flex;align-items:center;gap:8px;background:var(--green-lt);border:1px solid var(--green);border-radius:var(--r);padding:10px 12px;margin-bottom:10px">'+
      '<span style="font-size:18px">'+svgIcon('✅',{size:18})+'</span>'+
      '<div style="flex:1">'+
        '<div style="font-size:13px;font-weight:700;color:var(--green-mid)">Stripe connected, payments active</div>'+
        '<div style="font-size:11px;color:var(--text3)">Account: '+escHtml(data.stripe_account_id)+(data.payouts_enabled?' · Payouts on':' · Payouts pending')+'</div>'+
      '</div>'+
    '</div>'+
    '<button class="btn btn-sm" onclick="openStripeConnect()" style="font-size:11px;color:var(--text3)">Manage in Stripe →</button>'+
    '<button class="btn btn-sm" onclick="disconnectStripeConnect()" style="margin-left:8px;font-size:11px;color:var(--red)">Disconnect</button>';
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
    if(data.error){zAlert('Stripe error: '+data.error);if(btn){btn.disabled=false;btn.textContent='Connect Stripe Account';}return;}
    window.location.href=data.url;
  }catch(e){
    zAlert('Could not start Stripe Connect: '+e.message);
    if(btn){btn.disabled=false;btn.textContent='Connect Stripe Account';}
  }
}

function openStripeConnect(){
  // Express connected accounts are managed at express.stripe.com, not dashboard.stripe.com
  window.open('https://express.stripe.com/','_blank');
}

// Unlink Stripe from this account, clears the stored pointer so the next
// "Connect" starts fresh onboarding. Does NOT touch the Stripe account itself
// (it may be the owner's real account). Replaces the manual Supabase clear we
// used to run before reconnecting a test account.
async function disconnectStripeConnect(){
  if(!supaEnabled()||!_supaUser){zAlert('Sign in first.');return;}
  zConfirm(
    'This unlinks Stripe from your TradeDesk account. Your Stripe account itself is not deleted, you can reconnect anytime. Clients won’t be able to pay online until you reconnect.',
    async ()=>{
      try{
        const session=await _supa.auth.getSession();
        const token=session?.data?.session?.access_token;
        const res=await fetch(SUPA_URL+'/functions/v1/stripe-connect-disconnect',{
          method:'POST',
          headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
          body:'{}'
        });
        const data=await res.json();
        if(!res.ok||data.error){zAlert('Could not disconnect: '+(data.error||('HTTP '+res.status)));return;}
        // Drop the cached status so the UI immediately reflects the unlink, then re-render.
        try{localStorage.removeItem('td_stripe_status_'+(_supaUser?.id||''));}catch(e){}
        _stripeConnectStatus={connected:false};
        if(typeof _renderIntegrations==='function')_renderIntegrations();
        loadStripeConnectStatus();
        if(typeof showToast==='function')showToast('Stripe disconnected','✅',4000);
      }catch(e){
        zAlert('Could not disconnect Stripe: '+e.message);
      }
    },
    {title:'Disconnect Stripe?',yes:'Disconnect',no:'Keep connected'}
  );
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
      showToast('Stripe setup needs a bit more info, check Settings → Stripe.','⚠️');
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
    zAlert('Payment links require an internet connection, Stripe can\'t create a checkout session offline.\n\nOnce you\'re back online, tap Send Pay Link and it\'ll go right through. You can also record a manual cash or check payment now.',{title:'No internet connection'});
    return;
  }
  if(!supaEnabled()||!_supaUser){zAlert('Sign in to send payment links.');return;}
  if(!_stripeConnectStatus?.charges_enabled){
    zAlert('Connect your Stripe account in Settings first.','',{title:'Stripe not connected'});goPg('pg-settings');return;
  }
  try{
    showToast('Creating payment link…','⏳');
    // Send the client's HUB link, not a Stripe hosted-checkout redirect. The hub
    // homepage shows the balance and pays inline via the embedded Payment Element
    // (client.html), so the customer never leaves for checkout.stripe.com: one
    // consistent, higher-converting embedded flow. _uploadClientHub mints the token
    // (if absent) and publishes the current snapshot so the link resolves.
    await _uploadClientHub(c.id);
    if(!c.clientToken)throw new Error('Could not create the client hub link.');
    const url=_clientBaseUrl()+'client.html?t='+c.clientToken+'&u='+_effectiveUid()+'&c='+c.id;
    // Show link modal (copy fallback) then attempt SMS
    const _showPayLinkModal=(url)=>{
      const ov=document.createElement('div');ov.className='zmodal-overlay';
      const box=document.createElement('div');box.className='zmodal';
      box.innerHTML=
        '<div style="font-size:17px;font-weight:800;margin-bottom:4px">'+svgIcon('💳')+' Payment link ready</div>'+
        '<div style="font-size:12px;color:var(--text3);margin-bottom:14px">'+escHtml(c.name||'')+' · '+fmt(balance)+' due</div>'+
        '<div style="background:var(--bg);border:1px solid var(--border2);border-radius:var(--r);padding:10px 12px;font-size:12px;word-break:break-all;color:var(--text2);margin-bottom:14px;user-select:all">'+url+'</div>'+
        '<button onclick="navigator.clipboard.writeText(\''+url+'\').then(()=>showToast(\'Copied!\',\'📋\'));this.textContent=\'✓ Copied\'" style="width:100%;padding:12px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:8px">'+svgIcon('📋')+' Copy link</button>'+
        (c.phone?'<button onclick="this.closest(\'.zmodal-overlay\').remove();window.location.href=\'sms:\'+\''+c.phone.replace(/\D/g,'')+'\'+\'?body=\'+encodeURIComponent(\'Hi '+escHtml(c.name.split(' ')[0])+', here\\\'s your payment link for '+fmt(balance)+' owed to '+(S.bname||'us')+': '+url+', Thank you!\')" style="width:100%;padding:12px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;margin-bottom:8px">'+svgIcon('📱')+' Open in Messages</button>':'')+
        '<button onclick="this.closest(\'.zmodal-overlay\').remove()" style="width:100%;padding:10px;border-radius:var(--r);border:none;background:none;color:var(--text3);font-size:13px;cursor:pointer;font-family:inherit">Close</button>';
      ov.appendChild(box);document.body.appendChild(ov);
      ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
      navigator.clipboard.writeText(url).catch(()=>{});
    };
    _showPayLinkModal(url);
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
      // This account has its own accounts row, it's a real owner/co-owner account, never
      // a linked crew member. Reset explicitly: _isEmployee/_employeeRecord/_contractorUserId
      // are shared globals that stay true/set from a PREVIOUS account's sign-in earlier in
      // this tab (switching accounts doesn't reload the page), so without this an owner
      // signing in right after an employee session inherits the employee's nav gating,
      // Settings, Team, Tracker, etc. all vanish even though this account is a full owner.
      _isEmployee=false;_employeeRecord=null;_contractorUserId=null;
      _user=u;
      const{data:a}=await _supa.from('accounts').select('*').eq('id',u.account_id).maybeSingle();
      _account=a;
      const{data:cfg}=await _supa.from('account_config').select('*').eq('account_id',u.account_id).maybeSingle();
      _config=cfg;
      const{data:vehs}=await _supa.from('vehicles').select('*').eq('account_id',u.account_id);
      _vehicles=vehs||[];
      // Seed from accounts only when S is empty, S (zj_data.settings + localStorage)
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
    // ── CREW LINKING ─────────────────────────────────────────────────────────
    // Shared helper: finalize this session as a linked crew member.
    const _linkAsCrew=(row,welcome)=>{
      _isEmployee=true;_contractorUserId=row.contractor_user_id;_employeeRecord=row;
      _user={id:_supaUser.id,email:_supaUser.email,name:row.name||'',role:row.role||'employee',account_id:null};
      applyPermissions();
      // Owner report 2026-07-17: a returning already-linked crew member landed
      // in a stale test account with zero indication anything had happened,
      // just a silent redirect into someone else's business. Every crew
      // auto-link now shows SOMETHING, first-join keeps its warmer welcome,
      // a returning session gets a plain factual toast, so a wrong link is
      // never silent, the signed-in person always has a signal to notice.
      if(welcome)showToast('Welcome to the team, '+escHtml(row.name||'there')+'! 👋','✅');
      else showToast('Signed in as crew ('+escHtml(row.role||'employee')+'). Not expecting this? Contact the business that invited you.','👷',6000);
      try{localStorage.setItem('zp3_acct_'+_supaUser.id,JSON.stringify({user:_user,activeTrade:'painting',isEmployee:true,contractorUserId:_contractorUserId}));}catch(_e){}
      return true;
    };
    const _pend=(()=>{try{return JSON.parse(localStorage.getItem('_pendingEmpInvite')||'null');}catch(_e){return null;}})();
    // (0) SERVER-VERIFIED TOKEN, the forge-proof path. Links regardless of which
    // email the crew member signed up with (the old flows silently dead-ended on a
    // mismatch); single-use and expiring, validated entirely server-side.
    if(_pend?.tok){
      try{
        const{data:_cl,error:_clErr}=await _supa.rpc('claim_crew_invite',{tok:_pend.tok});
        if(!_clErr&&_cl?.ok){
          localStorage.removeItem('_pendingEmpInvite');
          return _linkAsCrew({id:_cl.team_member_id,contractor_user_id:_cl.contractor_user_id,employee_user_id:_supaUser.id,name:_cl.name||_pend.ename||'',role:_cl.role||'tech',permissions:_cl.permissions||{},active:true},true);
        }
        // invalid / used / expired → fall through; the mismatch alert below explains.
      }catch(_e){} // RPC not deployed yet → legacy paths below, unchanged
    }
    // (1) Already-linked crew member. LIST, not maybeSingle, an employee active on
    // two crews (subs work for multiple GCs) used to ERROR the lookup and fall
    // through to "not nested". Deterministic pick: remembered choice, else the most
    // recently joined; window.switchCrew(cid) re-targets and reloads.
    const{data:empRows}=await _supa.from('team_members').select('*').eq('employee_user_id',_supaUser.id).eq('active',true).order('joined_at',{ascending:false});
    if(empRows&&empRows.length){
      let empRow=empRows[0];
      if(empRows.length>1){
        window._crewChoices=empRows.map(r=>({contractor_user_id:r.contractor_user_id,name:r.name,role:r.role}));
        const _pick=(()=>{try{return localStorage.getItem('zp3_crew_choice_'+_supaUser.id);}catch(_e){return null;}})();
        const _hit=_pick&&empRows.find(r=>String(r.contractor_user_id)===String(_pick));
        if(_hit)empRow=_hit;
      }
      return _linkAsCrew(empRow,false);
    }
    // (2) Pending invite by EMAIL MATCH, server-side (SECURITY DEFINER). Under strict
    // RLS the employee can't even SEE their unlinked roster row (employee_user_id null
    // → no policy grants it), so the legacy client-side select+update silently linked
    // NOTHING on a from-migrations stack, hosted only worked via dashboard-era
    // permissive policies (same drift family as the missing columns, caught live by
    // the crew certification). The RPC links the most recent unlinked row for this
    // login's email atomically; the email comes from auth.users, never the client.
    try{
      const{data:_em,error:_emErr}=await _supa.rpc('claim_crew_by_email');
      if(!_emErr&&_em?.ok){
        localStorage.removeItem('_pendingEmpInvite');
        return _linkAsCrew({id:_em.team_member_id,contractor_user_id:_em.contractor_user_id,employee_user_id:_supaUser.id,name:_em.name||'',role:_em.role||'tech',permissions:_em.permissions||{},active:true},true);
      }
    }catch(_e){} // RPC not deployed → legacy path below (hosted-compat)
    const{data:inviteRows}=await _supa.from('team_members').select('*').eq('email',_supaUser.email).is('employee_user_id',null).order('invited_at',{ascending:false});
    const inviteRow=inviteRows&&inviteRows[0];
    if(inviteRow){
      await _supa.from('team_members').update({employee_user_id:_supaUser.id,active:true,joined_at:new Date().toISOString()}).eq('id',inviteRow.id);
      localStorage.removeItem('_pendingEmpInvite');
      return _linkAsCrew({...inviteRow,employee_user_id:_supaUser.id,active:true},true);
    }
    // (3) Legacy fallback: unsigned _pendingEmpInvite payload (pre-token links).
    const _pi=_pend;
    if(_pi?.cid){
      const{error:_piErr}=await _supa.from('team_members').upsert({contractor_user_id:_pi.cid,email:_supaUser.email,employee_user_id:_supaUser.id,active:true,joined_at:new Date().toISOString()},{onConflict:'contractor_user_id,email'});
      if(!_piErr){
        _isEmployee=true;_contractorUserId=_pi.cid;
        _employeeRecord={contractor_user_id:_pi.cid,email:_supaUser.email,employee_user_id:_supaUser.id,active:true};
        _user={id:_supaUser.id,email:_supaUser.email,name:'',role:'tech',account_id:null};
        applyPermissions();
        localStorage.removeItem('_pendingEmpInvite');
        showToast('Welcome to the crew! 👋','✅');
        try{localStorage.setItem('zp3_acct_'+_supaUser.id,JSON.stringify({user:_user,activeTrade:'painting',isEmployee:true,contractorUserId:_contractorUserId}));}catch(_e){}
        return true;
      }
    }
    // (4) A crew invite is pending but NOTHING linked: the crew member almost
    // certainly signed up with a different email than the boss put on the roster.
    // This used to dead-end SILENTLY into a brand-new empty owner account, the
    // worst possible first impression. Say it out loud, then continue (they may
    // legitimately also be an owner).
    if(_pend&&(_pend.cid||_pend.tok)){
      localStorage.removeItem('_pendingEmpInvite');
      try{zAlert('Your crew invite from '+escHtml(_pend.bname||'your contractor')+' couldn’t be linked to this login ('+escHtml(_supaUser.email||'')+').\n\nIf you signed up with a different email than the invite was sent to, ask '+escHtml(_pend.bname||'them')+' to re-send the invite to this address. Continuing as a new business account for now.',{title:'Invite not linked'});}catch(_e){}
    }
    // No users row, check for pre-schema user via zj_data
    const{data:zd}=await _supa.from('zj_data').select('user_id').eq('user_id',_supaUser.id).maybeSingle();
    if(zd){
      _isEmployee=false;_employeeRecord=null;_contractorUserId=null;
      _user={id:_supaUser.id,email:_supaUser.email,name:getOwnerName()||'',role:'owner',account_id:null};
      applyPermissions();
      try{localStorage.setItem('zp3_acct_'+_supaUser.id,JSON.stringify({user:_user,activeTrade:_activeTrade||'painting',isEmployee:false}));}catch(_e){}
      return true;
    }
    return false;
  }catch(e){
    console.warn('loadAccountData failed:',e);
    // Network failure, restore from cache so offline sign-in still reaches supaLoadFromCloud()
    try{
      const _ac=JSON.parse(localStorage.getItem('zp3_acct_'+_supaUser.id)||'null');
      if(_ac){
        _user=_ac.user||{id:_supaUser.id,email:_supaUser.email,name:getOwnerName()||'',role:'owner',account_id:null};
        // Explicit both ways, _isEmployee is a shared global that may already be true
        // from a different account earlier in this tab (see _applyEmployeeNavGating).
        if(_ac.isEmployee){_isEmployee=true;_contractorUserId=_ac.contractorUserId;}
        else{_isEmployee=false;_contractorUserId=null;_employeeRecord=null;}
        _activeTrade=_ac.activeTrade||'painting';
        if(_ac.account){_account=_ac.account;if(_account.business_name&&!S.bname)S.bname=_account.business_name;if(_account.phone&&!S.bphone)S.bphone=_account.phone;}
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
  await _flushSaveNow();
  const u=_DEV_SUPPORT_USERS[key];
  if(!u){showToast('Unknown support user','⚠️');return;}
  // Load all per-record tables for target user in parallel (requires dev_support RLS policy)
  const[tableResults,settingsResult]=await Promise.all([
    Promise.all(_TD_TABLES.map(({t})=>_supa.from(t).select('id,data').eq('user_id',u.userId).is('deleted_at',null))),
    _supa.from('zj_data').select('settings,checks_state').eq('user_id',u.userId).maybeSingle()
  ]);
  if(tableResults.some(r=>r.error)){showToast('Load failed, run dev_support SQL policy in Supabase','❌');return;}
  // Snapshot dev's own state (all arrays + _lastKnownIds) so exit restores cleanly
  _devSavedState={
    clients:[...clients],bids:[...bids],jobs:[...jobs],payments:[...payments],liens:[...liens],
    income:[...income],expenses:[...expenses],mileage:[...mileage],timeEntries:[...timeEntries],
    licenses:[...licenses],events:[...events],contracts:[...contracts],agreements:[...agreements],photos:[...photos],
    S:JSON.parse(JSON.stringify(S)),
    lastKnownIds:Object.fromEntries(Object.entries(_lastKnownIds).map(([k,v])=>[k,[...v]])),
    syncedHash:Object.fromEntries(Object.entries(_syncedHash).map(([k,v])=>[k,[...v]]))
  };
  // Load target user's records into memory
  for(let i=0;i<_TD_TABLES.length;i++){
    const{t,set}=_TD_TABLES[i];
    const rows=(tableResults[i].data||[]).map(r=>r.data);
    set(rows);
    _lastKnownIds[t]=new Set((tableResults[i].data||[]).map(r=>String(r.id)));
    // DELTA: rebuild the synced-hash from the TARGET account's rows so the dev's own
    // row hashes can't linger and suppress a target-account upload (cross-account bleed).
    _syncedHash[t]=new Map((tableResults[i].data||[]).map(r=>[String(r.id),_hashPayload(r.data)]));
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
  if(_devSavedState.syncedHash){for(const[k,v]of Object.entries(_devSavedState.syncedHash))_syncedHash[k]=new Map(v);}
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
// Supabase endpoint. DEFAULT = DIRECT to Supabase, validated on AT&T Fiber (the exact
// network §15.2's /api proxy was built for), which now resolves *.supabase.co fine.
// Direct pays ZERO Cloudflare /api cost. The /api Pages-Function proxy is RETAINED as
// the safety net, reached two ways:
//   (a) explicit override: ?supadirect=0 (persists) forces the proxy; ?supadirect=1 forces direct.
//   (b) AUTO-FALLBACK (supaInit): if direct is unreachable on a network (can't DNS-resolve
//       / blocked), the boot probe silently switches THIS session to the proxy so the app
//       still loads. So even an untested carrier self-heals, direct where it works, proxy
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
const APP_VERSION='07.23.26.10';
let _supa=null,_supaUser=null,_syncTimer=null,_syncStatus='local',_supaCloudLoaded=false,_lastLocalSaveAt=0;
let _syncBroadcastChannel=null,_realtimeSubscribed=false,_loadInProgress=false,_activeLoadPromise=null,_broadcastReloadTimer=null,_broadcastPending=false,_reconcileTimer=null,_writeCacheTimer=null,_rtRenderTimer=null;
// _realtimeSubscribed flips true when subscription is INITIATED; _tdRealtimeReady
// flips true only when the td-sync channel confirms SUBSCRIBED (delivery is live).
// Anything that depends on actually RECEIVING peer changes should gate on this, not
// on the initiation flag, waiting on the initiation flag races ahead of delivery.
let _tdRealtimeReady=false;
try{Object.defineProperty(window,'_tdRealtimeReady',{get:()=>_tdRealtimeReady,set:v=>{_tdRealtimeReady=v;},configurable:true});}catch(_e){}
const _deviceId=Math.random().toString(36).slice(2,10);
// COALESCED RECONCILE, every cross-device "something changed, re-read the cloud" trigger
// (the zj_data postgres_changes handler, the data_saved broadcast, and the reconcile
// heartbeat) funnels through here instead of each calling supaLoadFromCloud itself. A single
// debounced timer means a peer's ONE save, which fans out into a per-record patch, a settings
// write, a marker write, and a broadcast, collapses to ONE trailing reload, not four (the
// "render storm" the ratchet caught). The per-record patch path is untouched: it still applies
// + renders the row immediately; this only coalesces the heavier full-reload backstops. Because
// EVERY trigger (heartbeat included) schedules the same reconcile, a dropped realtime event is
// still caught, the backstop is preserved, unlike a "suppress while the socket was recently
// active" gate, which wrongly swallowed a dropped event that followed a delivered one.
function _scheduleReconcile(delay){
  if(_loadInProgress){_broadcastPending=true;return;} // a load is running, its finally re-fires
  if(_reconcileTimer)return;                          // one already queued, coalesce into it
  _reconcileTimer=setTimeout(()=>{
    _reconcileTimer=null;
    if(_loadInProgress){_broadcastPending=true;return;}
    supaLoadFromCloud({silent:true});
  },delay==null?300:delay);
}
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

// DELTA SYNC. Per-table Map(id -> content hash of the row payload the SERVER currently
// holds. On save we upload ONLY rows whose hash changed since the last sync, instead of
// re-upserting the whole account every time. The hash has no false negatives (any byte
// change flips it, so a real edit can never be silently skipped); a false positive only
// causes a harmless re-upload of an identical row; a MISSING entry is treated as changed
// → uploaded, so any path that doesn't warm the map degrades to today's full-upload.
//
// THE ONE DISCIPLINE: the hash input is ALWAYS the object that is/was the DB `data`
// column: txFn(arr) on save, the loaded `r.data` on load, via _hashPayload(). And
// _syncedHash[id] is written ONLY AFTER that id's upsert batch resolves with no error,
// never optimistically. NOT persisted: rebuilt from cloud on every load (the only
// authoritative source of "what the server has"); an offline/cache boot leaves it empty
// → safe full upload on reconnect.
let _syncedHash={};
// PENDING-EDIT GATE for the Phase-3 per-field merge: _rowSyncedAt[tbl] = Map(id → client-ms
// of the last moment this row was KNOWN IN SYNC with the cloud (uploaded by us, loaded from
// the cloud, or taken whole from a realtime event). _opApplyIncoming only protects a local
// field whose clock is NEWER than this, i.e. a genuinely PENDING (not-yet-uploaded) edit.
// Without the gate, a device with a fast wall clock keeps "protecting" fields it already
// uploaded long ago, silently rejecting every genuine peer update for the skew duration.
// Client-clock domain on BOTH sides of the gate comparison, so skew cannot break it.
// NOT persisted, resets like _syncedHash (a fresh boot treats nothing as pending).
let _rowSyncedAt={};
// _rowServerTs[tbl] = Map(id → SERVER updated_at ms of the newest cloud copy of this row
// this device has taken (load / delta merge / realtime). The peer-op applier uses it to
// skip STALE ops, an op minted before the row snapshot we hold is already embodied in
// that snapshot (the server trigger stamps updated_at at commit, i.e. after the op's
// mint time), so applying it would regress the row. 10s of slack absorbs author-clock
// skew. NOT persisted, rebuilt by the same paths that rebuild _syncedHash.
let _rowServerTs={};
// Ids the MOST RECENT load explicitly soft-deleted (deleted_at rode the delta),
// {tbl: Set(id)}, reset at each load's start. The reconnect merge-back consults this
// so it never resurrects a row a peer deliberately deleted during our outage.
let _lastLoadDeletes={};
// Fast deterministic 32-bit string hash (FNV-1a) over the JSON of a row payload.
// CANONICAL serialization for hashing, key-order-independent, matching
// JSON.stringify's semantics for undefined/function values. THE BUG THIS FIXES
// (diagnosed 2026-07-03 via _deltaStats.rows + field-diff instrumentation):
// JSON.stringify is key-order-sensitive, but Postgres jsonb RE-SORTS object
// keys: so the save-side hash (in-memory insertion order) never matched the
// load/reconcile-side hash (jsonb order) for any row whose key order differed.
// Every reconcile rebaselined those rows to the jsonb hash, the next save saw a
// "change" and re-uploaded them, and reconcile flipped the baseline right back:
// perpetual phantom re-uploads (42 byte-identical clients per save on the cert
// account: silent write amplification on ANY real account). Sorting keys makes
// the fingerprint identical for identical DATA regardless of ordering.
function _canonicalJson(v){
  if(v===null)return 'null';
  const t=typeof v;
  if(t==='undefined'||t==='function')return undefined;   // caller decides (object: omit; array: null)
  if(t!=='object')return JSON.stringify(v);
  // Honor toJSON() like JSON.stringify does, else a Date (or any toJSON object)
  // would serialize as {} on the save side but as its string form after the jsonb
  // round-trip → a phantom hash mismatch. No synced field holds a Date today; this
  // is a guard so a future one can't silently reintroduce the re-upload loop.
  if(typeof v.toJSON==='function'){try{return _canonicalJson(v.toJSON());}catch(_e){}}
  if(Array.isArray(v))return '['+v.map(x=>{const s=_canonicalJson(x);return s===undefined?'null':s;}).join(',')+']';
  const parts=[];
  for(const k of Object.keys(v).sort()){
    const s=_canonicalJson(v[k]);
    if(s!==undefined)parts.push(JSON.stringify(k)+':'+s);
  }
  return '{'+parts.join(',')+'}';
}
function _hashPayload(obj){
  let str; try{ str=_canonicalJson(obj); }catch(_e){ return null; }
  if(str===undefined) return null;
  let h=0x811c9dc5;
  for(let i=0;i<str.length;i++){ h^=str.charCodeAt(i); h=(h+((h<<1)+(h<<4)+(h<<7)+(h<<8)+(h<<24)))>>>0; }
  return h.toString(36);
}
// Test/telemetry hook: counts rows actually uploaded vs skipped on each save pass.
window._deltaStats={upserts:0,skips:0,rows:[]};
// Test hook: does the synced-hash map currently hold an entry for this id?
window.__hashHas=(tbl,id)=>!!(_syncedHash[tbl]&&_syncedHash[tbl].has(String(id)));

// ── OPLOG PHASE 0, Hybrid Logical Clock + SHADOW op-derivation ────────────────
// Groundwork for offline-first field-level sync (plan: custom oplog). PHASE 0 IS
// PURELY OBSERVATIONAL: it derives the per-field ops a save WOULD emit and counts
// them into window._opStats, but writes nothing authoritative and changes no merge
// or save behavior. Gated behind window._opLogShadow (default OFF) and fully wrapped
// in try/catch so it can NEVER perturb the real save path. Validates, against real
// boots/merges, that the diff produces no phantom deletes (the §9.8 trap) before any
// later phase makes ops authoritative.

// HLC = (physicalMillis, counter, deviceId) → monotonic sortable string. Persisted
// synchronously and owner-stamped so a reload can't mint an HLC lower than one already
// emitted (which would break total order). max(localPhysical, lastHlc.physical) absorbs
// a backwards wall-clock (NTP correction / manual change / the iOS clock-jump quirk).
let _hlcLast=null; // {ms,c}
function _hlcOwner(){return (_supaUser&&_supaUser.id)||null;}
function _hlcInit(){
  try{
    const raw=localStorage.getItem('zp3_hlc');
    if(raw){const o=JSON.parse(raw);if(o&&o._owner===_hlcOwner()&&typeof o.ms==='number')_hlcLast={ms:o.ms,c:o.c|0};}
  }catch(_e){}
}
function _hlcStr(ms,c){return ms.toString(36).padStart(9,'0')+'.'+(c>>>0).toString(36).padStart(4,'0')+'.'+_deviceId;}
function _hlcNow(){
  const phys=Date.now();
  let ms,c;
  if(_hlcLast&&_hlcLast.ms>=phys){ms=_hlcLast.ms;c=_hlcLast.c+1;}
  else{ms=phys;c=0;}
  _hlcLast={ms,c};
  try{localStorage.setItem('zp3_hlc',JSON.stringify({ms,c,_owner:_hlcOwner()}));}catch(_e){}
  return _hlcStr(ms,c);
}
// Advance the local clock past a clock observed from a peer op (used by later phases).
function _hlcObserve(ms,c){
  if(typeof ms!=='number')return;
  if(!_hlcLast||ms>_hlcLast.ms||(ms===_hlcLast.ms&&c>_hlcLast.c)){_hlcLast={ms,c:(c|0)};}
}

// Canonical payload for a table = the txFn output (exactly what _syncedHash hashes and
// what td_* stores), so shadow ops diff the SAME bytes the cloud round-trips.
function _opCanonicalRows(tdef){const arr=tdef.get()||[];return tdef.tx?tdef.tx(arr):arr;}
// Tables whose canonical payload is a capped suffix (.slice). A row falling out of the
// cap window is an EVICTION, never a user delete, so these are exempt from any
// delete-by-absence accounting (FM-3).
const _OP_CAPPED=new Set(['td_events','td_time_entries']);
let _opPrevPayload={};   // {tbl: Map(id -> canonical payload)}, diff baseline
let _opPrevOwner=null;   // owner the baseline belongs to (cross-account guard)
let _opRing=[];          // last N derived ops, for inspection (capped)
window._opStats={emitted:0,creates:0,updates:0,phantomDeleteCandidates:0};
// Master gate for ALL oplog work (Phase 0 derive/observe, Phase 1 durable log + field
// clocks, Phase 2 td_ops sync, Phase 3 AUTHORITATIVE per-field merge). PHASE 3 FLIPS THIS
// ON BY DEFAULT, the field-clock-protected merge is now live. KILL-SWITCH: set
// localStorage 'zp3_oplog_off'='1' to instantly fall back to whole-row sync with no deploy.
// An explicit pre-set value (e.g. a test's addInitScript) always wins.
window._opLogShadow=(window._opLogShadow!==undefined&&window._opLogShadow!==null)
  ? window._opLogShadow
  : (()=>{try{return localStorage.getItem('zp3_oplog_off')!=='1';}catch(_e){return true;}})();
// Test hook: does the persisted HLC strictly order before another? (for convergence tests)
window.__hlcNow=()=>{try{return _hlcNow();}catch(_e){return null;}};
// Test hook: the most recently derived shadow op for a given table+id (or null).
window.__opLast=(tbl,id)=>{for(let i=_opRing.length-1;i>=0;i--){const o=_opRing[i];if(o.table===tbl&&o.rowId===String(id))return o;}return null;};

// Deep-clone a canonical payload for the baseline. CRITICAL: _opCanonicalRows returns
// the LIVE array objects for tx:null tables, so storing them directly would mean an
// in-place field edit (bid.amount=X) mutates the baseline too → the diff sees no change
// (FM-1). The baseline must be an immutable snapshot, so we clone.
function _opClone(r){try{return JSON.parse(JSON.stringify(r));}catch(_e){return r;}}
// Rebuild the diff baseline from the authoritative rows (mirrors the _syncedHash rebuild).
// MUST run AFTER all post-load array mutation (dedupe, draft-bid filter) so the baseline
// equals the settled state, else those filtered rows look like deletes on the next diff.
function _opRebaseline(){
  if(!window._opLogShadow)return;
  try{
    const owner=_hlcOwner();
    // Reset field clocks ONLY on a genuine account switch (A→B), NEVER on a fresh boot
    // (_opPrevOwner null), else we'd wipe the clocks _opDbLoad just rehydrated from the
    // durable IndexedDB log, breaking cross-reload field-clock durability (Phase 1 invariant).
    if(_opPrevOwner && owner!==_opPrevOwner)_fieldClocks={};
    _opPrevOwner=owner;
    _opPrevPayload={};
    for(const tdef of _TD_TABLES){
      const m=new Map();
      for(const r of _opCanonicalRows(tdef))m.set(String(r.id),_opClone(r));
      _opPrevPayload[tdef.t]=m;
    }
  }catch(_e){}
}
// SHADOW derive, called at the save choke-point. Emits the create/update ops the diff
// implies (vs the baseline) and COUNTS would-be absence-deletes without acting on them.
// Deletes are intentionally NOT derived here, in the real design they come only via the
// _userDelete channel (FM-2); counting absence here just proves the diff stays clean.
function _opShadowDerive(onlyTbl){
  if(!window._opLogShadow)return;
  try{
    const owner=_hlcOwner();
    if(owner!==_opPrevOwner){_opRebaseline();} // account switched → fresh baseline, no bleed
    // An employee's redacted in-memory view (zeroed amounts etc.) is never real data, it
    // must never advance a FIELD CLOCK (the local merge-priority signal _opApplyIncoming
    // uses). supaSaveToCloud's _saveSkip correctly stops the redacted zero from reaching
    // the SERVER (cloud.js ~3862), but this derive runs BEFORE that skip-set is computed,
    // so without this guard it stamped a fresh, newer field clock from the zeroed value
    // anyway. That phantom "locally edited, newer than the server" clock then outranked
    // the contractor's real server row on the next reload's merge, a redacted employee
    // save silently zeroed the contractor's real bid amount in MEMORY, even though the
    // network was never touched. The op itself (ring + durable log) still gets created
    // as before, the crew op-SYNC channel deliberately keeps redacted ops local and
    // filters them only at push time (see the "redacted-table ops never push" test):
    // only the field-clock stamp is skipped, since that's the piece that poisons merges.
    const _redact=(typeof _employeeRedactedTables==='function')?_employeeRedactedTables():new Set();
    for(const tdef of _TD_TABLES){
      const tbl=tdef.t;
      if(onlyTbl&&tbl!==onlyTbl)continue; // targeted derive (peer-op apply flushes ONE table's pending intent first)
      const prev=_opPrevPayload[tbl]||new Map();
      const next=new Map();
      for(const r of _opCanonicalRows(tdef)){
        const id=String(r.id);next.set(id,_opClone(r)); // store an immutable snapshot, not the live ref
        const p=prev.get(id);
        if(p&&_hashPayload(p)===_hashPayload(r))continue; // unchanged (canonical, key-order-safe)
        const fields={};
        if(!p){Object.assign(fields,r);}                  // create: all fields
        // Per-field diff must use the SAME canonical comparison as the row-level gate above
        //, raw JSON.stringify is key-order-sensitive, so a field whose nested object merely
        // round-tripped through Postgres jsonb with its keys re-sorted (no data change) could
        // mis-flag as "changed" here even though the row-level gate correctly saw no change
        // overall, stamping a fresh field clock from a phantom edit (feeds the same
        // hash-baseline-churn bug fixed in _opApplyIncoming above).
        else for(const k in r){if(_canonicalJson(r[k])!==_canonicalJson(p[k]))fields[k]=r[k];}
        if(!p)window._opStats.creates++;else window._opStats.updates++;
        window._opStats.emitted++;
        const _ohlc=_hlcNow();
        const _op={hlc:_ohlc,owner,table:tbl,rowId:id,fields};
        _opRing.push(_op);
        if(_opRing.length>2000)_opRing.shift();
        // Redacted table: keep the op itself (ring + durable log) so the crew push-time
        // filter still has something to filter, but never let a zeroed/redacted value
        // stamp a field clock; that's the local merge-priority signal, and a phantom
        // "newer" clock from a redacted view must never outrank the real server value.
        if(!_redact.has(tbl))_opStampFields(tbl,id,fields,_ohlc); // PHASE 1: per-field HLC field clocks
        _opPersist(_op);                     // PHASE 1: durable IndexedDB op log
      }
      // Would-be absence-deletes (NOT emitted). Capped tables exempt (eviction≠delete).
      if(!_OP_CAPPED.has(tbl)){
        for(const id of prev.keys())if(!next.has(id))window._opStats.phantomDeleteCandidates++;
      }
      _opPrevPayload[tbl]=next; // incremental: next diff is vs the state we just observed
    }
  }catch(_e){}
}

// ── OPLOG PHASE 1, durable IndexedDB op log + per-field HLC field clocks ──────
// Phase 0 kept derived ops only in an in-memory ring (lost on reload). Phase 1 makes the
// log DURABLE (IndexedDB store 'ops') so a mid-edit crash/reload doesn't lose the intent,
// and records a per-field HLC "field clock", WHEN each field of each row was last set,
// the substrate Phase 2's per-field merge resolves conflicts with. Still gated behind
// window._opLogShadow and still observe-only (nothing authoritative reads it yet, Phase 3).
function _hlcParse(str){try{const p=String(str).split('.');const ms=parseInt(p[0],36);const c=parseInt(p[1],36);if(isNaN(ms))return null;return{ms,c:c||0,dev:p[2]||''};}catch(_e){return null;}}

const _OP_DB_NAME='zp3_oplog',_OP_DB_VER=1,_OP_STORE='ops';
let _opDbPromise=null;
function _opDbOpen(){
  if(_opDbPromise)return _opDbPromise;
  _opDbPromise=new Promise(res=>{
    try{
      if(typeof indexedDB==='undefined'){res(null);return;}
      const req=indexedDB.open(_OP_DB_NAME,_OP_DB_VER);
      req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(_OP_STORE)){const st=db.createObjectStore(_OP_STORE,{keyPath:'seq',autoIncrement:true});st.createIndex('synced','synced',{unique:false});}};
      req.onsuccess=()=>res(req.result);
      req.onerror=()=>res(null);   // best-effort: a blocked/unavailable IDB never breaks the app
    }catch(_e){res(null);}
  });
  return _opDbPromise;
}
function _opStore(mode){return _opDbOpen().then(db=>{try{return db?db.transaction(_OP_STORE,mode).objectStore(_OP_STORE):null;}catch(_e){return null;}});}
function _opPersist(op){
  if(!window._opLogShadow)return;
  try{_opStore('readwrite').then(st=>{if(st)try{st.add(Object.assign({synced:0,ts:Date.now()},op));}catch(_e){}}).catch(()=>{});}catch(_e){}
}
function _opDbAll(){return _opStore('readonly').then(st=>st?new Promise(res=>{try{const r=st.getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>res([]);}catch(_e){res([]);}}):[]);}
function _opDbCount(){return _opDbAll().then(a=>a.length);}
// Unsynced (pending) ops via the 'synced' INDEX: O(pending), never a full-store scan.
// At many-writer scale the hot path (every save, every reconnect rebase) reads this;
// the prune-on-ack below keeps the pending set tiny, so this stays effectively free.
function _opDbUnsynced(){return _opStore('readonly').then(st=>st?new Promise(res=>{try{const r=st.index('synced').getAll(0);r.onsuccess=()=>res(r.result||[]);r.onerror=()=>res([]);}catch(_e){res([]);}}):[]);}
// PRUNE ops by seq, used after a successful push/ack. Ops are DELETED, not flagged:
// the durable log holds only un-acked intent, so it stays O(pending edits) instead of
// growing without bound (the review's unbounded-oplog-cost finding, now closed).
function _opDbPrune(seqs){if(!seqs||!seqs.length)return Promise.resolve();return _opStore('readwrite').then(st=>{if(!st)return;for(const seq of seqs){try{st.delete(seq);}catch(_e){}}});}
// ACK: a successful cloud save proves every op at-or-below `ceiling` is embodied in the
// state that save just uploaded, prune them. Ops stamped DURING the in-flight save
// (user kept editing) carry a later HLC and survive to the next save. Field clocks are
// deliberately NOT pruned, the per-field merge still needs them after the ack.
function _opDbPruneAcked(ceiling){
  if(!ceiling)return Promise.resolve();
  return _opDbUnsynced().then(ops=>_opDbPrune((ops||[]).filter(o=>_hlcCmp(o.hlc,ceiling)<=0).map(o=>o.seq))).catch(()=>{});
}
// Hard-clear the entire op store, account switch only (bug #39 posture: nothing of the
// outgoing account's footprint may survive on this device).
function _opDbClear(){return _opStore('readwrite').then(st=>{if(st)try{st.clear();}catch(_e){}}).catch(()=>{});}

// Per-field HLC clocks: {tbl:{rowId:{field:hlcStr}}}. Stamped whenever a field changes.
let _fieldClocks={};
function _opStampFields(tbl,id,fields,hlc){
  const t=_fieldClocks[tbl]||(_fieldClocks[tbl]={});
  const row=t[String(id)]||(t[String(id)]={});
  for(const k in fields)row[k]=hlc;
}
function _opFieldClock(tbl,id,field){return ((_fieldClocks[tbl]||{})[String(id)]||{})[field]||null;}
function _opFieldClocks(tbl,id){return (_fieldClocks[tbl]||{})[String(id)]||{};}
// Boot: rehydrate field clocks + advance the HLC past every persisted op, so durability
// survives a reload and the clock can never go backwards relative to an already-logged op.
function _opDbLoad(){
  if(!window._opLogShadow)return Promise.resolve();
  return _opDbAll().then(ops=>{for(const op of (ops||[])){try{_opStampFields(op.table,op.rowId,op.fields||{},op.hlc);const m=_hlcParse(op.hlc);if(m)_hlcObserve(m.ms,m.c);}catch(_e){}}}).catch(()=>{});
}
window.__opDbCount=()=>_opDbCount();
window.__opDbUnsynced=()=>_opDbUnsynced();
window.__opPruneAcked=(c)=>_opDbPruneAcked(c);
window.__fieldClock=(tbl,id,field)=>_opFieldClock(tbl,id,field);

// ── OPLOG PHASE 2, td_ops table + per-field HLC merge ────────────────────────
// Per-field last-writer-wins by HLC: given local + incoming rows and their field clocks,
// the merge keeps, FOR EACH FIELD, the value whose HLC is higher, so concurrent edits to
// DIFFERENT fields of the same row BOTH survive (whole-row LWW drops one side). Computed
// and validated in shadow mode here; Phase 3 makes it the authoritative merge.
function _hlcCmp(a,b){if(a===b)return 0;if(!a)return -1;if(!b)return 1;return a>b?1:-1;}
function _opMergeRows(tbl,localRow,localClocks,incomingRow,incomingClocks){
  localRow=localRow||{};incomingRow=incomingRow||{};
  const out={};const keys=new Set([...Object.keys(localRow),...Object.keys(incomingRow)]);
  for(const k of keys){
    const lc=(localClocks&&localClocks[k])||'';
    const ic=(incomingClocks&&incomingClocks[k])||'';
    if(_hlcCmp(ic,lc)>0&&(k in incomingRow))out[k]=incomingRow[k];   // incoming field is newer
    else if(k in localRow)out[k]=localRow[k];                        // keep local (newer or tie)
    else out[k]=incomingRow[k];                                      // only incoming has it
  }
  return out;
}
window.__opMerge=(tbl,lr,lc,ir,ic)=>{try{return _opMergeRows(tbl,lr,lc,ir,ic);}catch(_e){return null;}};

// ── OPLOG PHASE 3, AUTHORITATIVE per-field merge on incoming records ──────────
// When a peer's row arrives (realtime / load), instead of clobbering the whole local row
// we keep, FOR EACH FIELD, our local value IFF this device edited that field MORE RECENTLY
// than the incoming version (local field-clock ms > the incoming row's updated_at ms),
// otherwise we take the incoming value. So a concurrent edit to a DIFFERENT field survives
// a peer's save, and a field nobody locally touched still syncs in. STRICTLY SAFER than the
// old whole-row replace: it only ever protects a provably-newer local field, and falls back
// to the incoming row whenever there's nothing to protect or anything goes wrong (fail-safe).
function _opApplyIncoming(tbl,localRow,incomingRow,incomingUpdatedAt,_src){
  try{
    if(!window._opLogShadow||!localRow||!incomingRow||typeof incomingRow!=='object')return incomingRow;
    // Missing incoming clock → incMs=0. This is a REAL path, not an edge case: crew FULL
    // loads ride the load_account_data RPC whose redacted rows carry NO updated_at. The
    // old `return incomingRow` bail whole-row-replaced on exactly those loads, erasing a
    // crew device's own clocked fields (the 5-writer marker loss: the server row is the
    // concurrent-upsert LWW winner, so taking it whole drops every other writer's field
    // locally, and the restamped bookkeeping made the loss look "in sync"). With incMs=0
    // the same merge below runs: pending local fields (clock newer than the row's last
    // in-sync moment) win, local-only clocked fields survive, everything else takes the
    // incoming value, identical rules to a timestamped row.
    const incMs=(incomingUpdatedAt?new Date(incomingUpdatedAt).getTime():0)||0;
    const id=String(incomingRow.id!=null?incomingRow.id:localRow.id);
    const clocks=_opFieldClocks(tbl,id);
    // PENDING GATE: only protect fields edited AFTER this row was last known in sync with
    // the cloud (uploaded/loaded/taken from realtime, see _rowSyncedAt). An edit that
    // already reached the cloud needs no protection (the incoming row reflects or
    // deliberately supersedes it), and gating on it kills the clock-skew failure where a
    // fast local clock rejected genuine peer updates for the whole skew duration. Both
    // sides of THIS comparison are client-clock ms, so skew cannot affect the gate itself.
    const syncedAt=(_rowSyncedAt[tbl]&&_rowSyncedAt[tbl].get(id))||0;
    const out={};let keptLocal=false;
    const keys=new Set([...Object.keys(localRow),...Object.keys(incomingRow)]);
    for(const k of keys){
      const fc=clocks[k];
      const fcMs=fc?((_hlcParse(fc)||{}).ms||0):0;
      if(fcMs>incMs&&fcMs>syncedAt&&(k in localRow)){out[k]=localRow[k];keptLocal=true;} // PENDING local edit is newer → keep it
      else if(k in incomingRow)out[k]=incomingRow[k];                     // take the incoming value
      // Local-only field. If THIS DEVICE set it (a field clock exists), it must SURVIVE
      // the merge output even when nothing else is protected: a concurrent peer save
      // whose base predates our upload arrives as a whole row WITHOUT our field, and
      // returning `incomingRow` here silently erased an edit that had already reached
      // the cloud (the N-writer same-row loss). Keeping it (and returning `out`) makes
      // the merged row hash-differ from the incoming row → the next save re-uploads the
      // union. A local-only field with NO clock (we never set it) keeps the old
      // whole-row-take semantics, so a field a peer deliberately dropped still drops.
      //   TRIED gating this on fcMs>syncedAt (only protect if still "pending") to fix a
      // separate over-upload bug (a field cleared long ago kept permanently poisoning the
      // hash baseline), reverted. Local field clocks are a client-side HLC timestamp
      // stamped the instant an edit happens; incMs/syncedAt are SERVER commit timestamps
      // that lag behind by real network latency. Under genuine concurrent multi-writer
      // load a device's own just-landed edit can easily have fcMs <= syncedAt (its own
      // save's ack arrives, bumping syncedAt, before a racing peer's stale-base push is
      // even processed), the gate then dropped that device's OWN field the instant a
      // concurrent peer's push arrived, confirmed by the swarm-convergence flow test
      // (12 concurrent writers, only 5/12 kept their own marker). Never losing a real
      // edit under concurrency is a stronger guarantee than avoiding an occasional
      // harmless re-upload, the over-upload bug needs a different fix (e.g. pruning
      // truly stale field clocks after a safe time window), not a recency gate here.
      else{out[k]=localRow[k];if(fc)keptLocal=true;}
    }
    const res=keptLocal?out:incomingRow; // nothing protected → byte-identical to the old whole-row replace
    // SYNC TRACE (window._syncTrace, default off, certification diagnostics): record any
    // merge whose OUTPUT lost a field the local row held, tagged with the calling path.
    // A union merge (keptLocal) copies every local key into `out`, so a non-empty `lost`
    // means a whole-row take, the exact event the crew marker-loss hunt needs named.
    try{
      if(window._syncTrace){
        const lost=[];for(const k in localRow){if(!(k in res))lost.push(k);}
        if(lost.length)(window._syncTraceLog||(window._syncTraceLog=[])).push({t:Date.now(),src:_src||'',tbl,id,incMs,lost});
      }
    }catch(_e){}
    return res;
  }catch(_e){return incomingRow;}
}
window.__opApplyIncoming=(tbl,lr,ir,ts)=>{try{return _opApplyIncoming(tbl,lr,ir,ts);}catch(_e){return ir;}};

// ── OPLOG, LOAD-BEARING op channel (the 100-writer capability) ────────────────
// The td_* row upserts carry WHOLE rows, so two devices saving different fields of the
// SAME row inside the propagation window overwrite each other server-side, the one
// concurrency class the Phase-3 pending-field merge cannot save (an edit that already
// UPLOADED isn't "pending", so the peer's whole-row upsert clobbers it everywhere).
// td_ops closes it: every save also publishes its per-field ops (field + value + HLC);
// peers apply ops FIELD-BY-FIELD, guarded by their own field clocks, concurrent edits
// to different fields of one row all survive on every device, and each device's next
// organic save uploads its merged row, converging the server's whole-row copy to the
// union. Ops disseminate three ways: realtime td_ops INSERTs (instant), the pull below
// piggybacked on every save, and the pull at the end of every (re)load/reconcile.

// Apply peer ops (from the pull or a realtime td_ops event) to the in-memory arrays.
// Idempotent and order-independent: a field moves only when the op's HLC beats the
// field's current clock (LWW register per field), so replays and out-of-order delivery
// are harmless. Guards, in order:
//   • own-device echo dropped by the callers (device_id);
//   • STALE op (older than the row snapshot we hold, per _rowServerTs, −10s skew slack)
//     skipped: its effect is already embodied in that snapshot;
//   • local pending intent flushed FIRST (targeted derive) so our un-derived edits get
//     their own (later) clocks before the comparison, never silently absorbed;
//   • unknown row: a CREATE op (fields carry `id`) materializes it unless this device
//     deliberately deleted that id (same resurrection rule as _applyRealtimeRecord);
//     a partial op for an unknown row is skipped (the row snapshot delivers it whole).
// _syncedHash is deliberately NOT stamped: the merged local row now differs from the
// server row, so the next organic save re-uploads the union, that, not an op-triggered
// save (which would storm at N devices), is how the server's row copy converges.
function _opApplyPeerOps(ops){
  if(!window._opLogShadow||!ops||!ops.length)return;
  let touched=false;
  try{
    const tables=new Set();ops.forEach(o=>{if(o&&o.op_table)tables.add(o.op_table);});
    tables.forEach(t=>{try{_opShadowDerive(t);}catch(_e){}}); // flush OUR pending intent for these tables first
    for(const op of ops){
      const tbl=op&&op.op_table;
      const tdef=_TD_TABLES.find(d=>d.t===tbl);
      if(!tdef||!op.fields||typeof op.fields!=='object')continue;
      const id=String(op.row_id);
      const om=(_hlcParse(op.hlc)||{}).ms||0;
      const rts=(_rowServerTs[tbl]&&_rowServerTs[tbl].get(id))||0;
      if(rts&&om&&om<rts-10000)continue; // stale: predates the row copy we already hold
      const arr=tdef.get()||[];
      let idx=arr.findIndex(r=>String(r.id)===id);
      let createdHere=false;
      if(idx===-1){
        if(op.fields.id===undefined)continue;                                  // partial op, row unknown, row snapshot will bring it
        // TOMBSTONE-ECHO GUARD: ops publish only AFTER their row commits, so a CREATE op
        // OLDER than our row snapshot describes a row the snapshot already accounted for,
        // and since it's not in our arrays, the snapshot saw its soft-DELETE. Materializing
        // it would resurrect a freshly-deleted row in memory (seen live: swarm devices that
        // booted inside the ops-pull overlap window held a ghost bid an earlier spec had
        // just deleted; later-booting devices didn't: 8-vs-4 byte-equal split). A genuinely
        // NEW row always carries an op newer than any snapshot we hold; if clock skew makes
        // us skip one, its own row INSERT event / next delta delivers it, rows are the backstop.
        try{if(om&&_deltaCursor&&om<=new Date(_deltaCursor).getTime())continue;}catch(_e){}
        if(_lastKnownIds[tbl]&&_lastKnownIds[tbl].has(id))continue;            // we deleted it locally, never resurrect
        if(_locallyDeletedIds[tbl]&&_locallyDeletedIds[tbl].has(id))continue;
        arr.push({});idx=arr.length-1;createdHere=true;
      }
      const row=arr[idx];
      let applied=false;
      for(const k in op.fields){
        if(_hlcCmp(op.hlc,_opFieldClock(tbl,id,k))>0){
          row[k]=op.fields[k];
          _opStampFields(tbl,id,{[k]:1},op.hlc); // field clock = the op's clock (LWW register state)
          applied=true;
        }
      }
      if(applied){
        touched=true;
        if(createdHere){
          // INVARIANT: ops are published only AFTER the author's row upserts commit, so a
          // CREATE op guarantees this exact row content is already IN the cloud. Stamp the
          // synced hash (op fields ARE the author's canonical payload, same key order) and
          // the sync bookkeeping so this device treats the row as in-sync and its next save
          // no-ops. Without this, the receiver re-UPSERTED a row it merely learned about,
          // racing a concurrent delete and resurrecting it (seen live: B's delete undone
          // by A's echo of its own pointless upsert).
          (_lastKnownIds[tbl]||(_lastKnownIds[tbl]=new Set())).add(id);
          (_syncedHash[tbl]||(_syncedHash[tbl]=new Map())).set(id,_hashPayload(row));
          (_rowSyncedAt[tbl]||(_rowSyncedAt[tbl]=new Map())).set(id,Date.now());
          if(om)(_rowServerTs[tbl]||(_rowServerTs[tbl]=new Map())).set(id,om);
        }
        // Baseline the settled row so the NEXT derive doesn't re-emit the peer's fields
        // as ops from THIS device (op echo loop).
        try{(_opPrevPayload[tbl]||(_opPrevPayload[tbl]=new Map())).set(id,_opClone(row));}catch(_e){}
      }else if(createdHere){arr.pop();} // every field lost to newer local clocks, drop the empty shell
    }
  }catch(_e){}
  if(touched){
    clearTimeout(_writeCacheTimer);_writeCacheTimer=setTimeout(()=>{_writeCacheTimer=null;try{_writeLocalCache();}catch(_e){}},250);
    // Deliberately NO direct render AND NO save here. Render: the op INSERT event almost
    // always precedes the row event for the SAME save (which renders via
    // _applyRealtimeRecord); doubling the pass broke the glitch-free render budget (9>8,
    // live). Save: ops are published only AFTER the author's rows committed, so applied
    // op values are ALREADY in the cloud, a receiver-side save uploads nothing new, but
    // its cursor bump caused reconcile churn on every peer and its blind upsert raced
    // concurrent deletes (both seen live). The one thing that ever needs a receiver-side
    // upload is a UNION (a kept local field), and the row-merge paths that produce unions
    // schedule that save themselves.
  }
}
window.__opApplyPeerOps=(ops)=>{try{_opApplyPeerOps(ops);return true;}catch(_e){return false;}};

// Owner-scoped ops-pull cursor (a shared key would bleed one account's position into the next).
function _opsSinceKey(){return 'zp3_ops_since_'+((_supaUser&&_supaUser.id)||'anon');}
// Where to pull ops FROM: our stored position, floored at (row cursor − 10s). Ops older
// than the row snapshot are embodied in it (and the _rowServerTs guard would skip them
// anyway): a fresh device must not replay the account's whole op history over the rows
// it just loaded. Returns '' when neither exists (caller then skips the ops leg).
function _opsPullSince(baseCursor){
  let since=localStorage.getItem(_opsSinceKey())||'';
  if(baseCursor){try{const fl=_hlcStr(new Date(baseCursor).getTime()-10000,0);if(fl>since)since=fl;}catch(_e){}}
  return since;
}
// Fold a pulled ops batch in: advance the HLC + our pull cursor past every op, apply
// the peers' (own-device echoes dropped). Shared by the RPC ops leg and _opSyncOps.
function _opIngestPulled(ops){
  if(!ops||!ops.length)return;
  let mx=localStorage.getItem(_opsSinceKey())||'';
  const peer=[];
  for(const o of ops){
    const m=_hlcParse(o.hlc);if(m)_hlcObserve(m.ms,m.c); // converge the clock toward peers
    if(_hlcCmp(o.hlc,mx)>0)mx=o.hlc;
    if(o.device_id!==_deviceId)peer.push(o);
  }
  if(peer.length)_opApplyPeerOps(peer);
  if(mx)try{localStorage.setItem(_opsSinceKey(),mx);}catch(_e){}
}
// Ops sync: PUSH this device's un-acked ops to td_ops (chunked), prune them on success,
// then PULL peers' ops since our cursor and apply them. Best-effort: a missing td_ops
// table or any error is swallowed, rows remain the correctness backstop. CREW logins
// participate fully: their ops carry the CONTRACTOR's user_id (the td_ops_crew RLS
// policy authorizes exactly that for actively-linked members, permission-filtered per
// op_table), so the per-field concurrency protection covers crew writers too. Only
// dev-support impersonation stays off the channel (read-only posture).
let _opSyncRunning=false;
async function _opSyncOps(){
  if(!window._opLogShadow||!_supa||!_supaUser||_opSyncRunning)return;
  if(_devSupportMode)return;
  const _opUid=_isEmployee?_contractorUserId:_supaUser.id;
  if(!_opUid)return;
  _opSyncRunning=true;
  try{
    // Never push another login's ops, and never push ops for tables this crew
    // member's permissions redact, the server would reject the whole batch (the
    // td_ops_crew policy is the enforced twin of this filter).
    const _redact=_employeeRedactedTables();
    const unsynced=(await _opDbUnsynced()).filter(op=>op.owner===_supaUser.id&&!_redact.has(op.table));
    if(unsynced.length){
      for(let i=0;i<unsynced.length;i+=200){
        const slice=unsynced.slice(i,i+200);
        const{error}=await _supa.from('td_ops').insert(slice.map(op=>({hlc:op.hlc,user_id:_opUid,op_table:op.table,row_id:String(op.rowId),fields:op.fields||{},device_id:_deviceId})));
        if(error)break;              // keep them pending; retry next sync
        await _opDbPrune(slice.map(o=>o.seq));
      }
    }
    const since=_opsPullSince(_deltaCursor);
    let q=_supa.from('td_ops').select('hlc,op_table,row_id,fields,device_id').eq('user_id',_opUid).order('hlc',{ascending:true}).limit(500);
    if(since)q=q.gt('hlc',since);
    const{data,error}=await q;
    if(!error)_opIngestPulled(data||[]);
  }catch(_e){}
  finally{_opSyncRunning=false;}
}
window.__opSync=()=>{try{return _opSyncOps()||Promise.resolve();}catch(_e){return Promise.resolve();}};

// CONCURRENCY-SAFE SWEEP (CLAUDE.md §9.8). The cloud save soft-deletes rows that
// "disappeared" from this device's snapshot. Inferring deletes that way clobbers
// concurrent devices: a peer's brand-new row, not yet merged here, looks "missing"
// and gets deleted. Instead we soft-delete ONLY ids the user EXPLICITLY deleted on
// THIS device, recorded here at each delete site via _recordLocalDelete(). A row
// merely absent (a peer's, not-yet-synced) is never swept. Even bulk wipes
// (clearAllData / clear*Only) just go through _userDelete, which records every id
// that vanished, no special flag needed, and it survives the deferred async save.
// _locallyDeletedIds itself is initialized further down, right after _TD_TABLES
// (this object is BUILT FROM that list, see the note there), _TD_TABLES is a
// const declared later in this file, so referencing it here would throw before
// the page even loads. The function declarations below are hoisted and safe to
// keep here; only the data they touch needs to come after _TD_TABLES exists.
let _locallyDeletedIds;
// Record an explicit local delete so the next save propagates it (and ONLY it).
// Call with the synced table name + the id(s) removed from that table's array,
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
// the user deleted, cascades included, and nothing a concurrent peer touched.
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

// DEV-ONLY DELETE GATE (owner directive): nobody deletes in normal use, they edit,
// and old records auto-archive (kept forever). The ONE exception is the dev/owner
// purging a rare duplicate via the hidden 3s long-press (below). is_dev comes from
// the account config; dev-support mode counts too (only is_dev accounts can enter it).
function _canDelete(){try{if(window._e2eAllowDelete)return true;return !!((typeof _config!=='undefined'&&_config&&_config.is_dev)||(typeof _devSupportMode!=='undefined'&&_devSupportMode));}catch(_e){return false;}}
window._canDelete=_canDelete;

// A dev deletion HARD-removes the actual DB row (for dupe cleanup, "delete the
// actual row too"), not a soft-delete: Supabase realtime emits a DELETE event so
// online peers drop it live via _applyRealtimeRecord. Removes from memory + records
// the intent so nothing local resurrects it. Best-effort, fire-and-forget.
function _devHardPurge(tbl,id){
  try{
    const def=_TD_TABLES.find(d=>d.t===tbl);
    if(def){const arr=def.get()||[];const idx=arr.findIndex(r=>String(r.id)===String(id));if(idx!==-1){arr.splice(idx,1);def.set&&def.set(arr.slice());}}
  }catch(_e){}
  if(typeof _recordLocalDelete==='function')_recordLocalDelete(tbl,id);
  try{const uid=(typeof _effectiveUid==='function'&&_effectiveUid())||(_supaUser&&_supaUser.id);if(_supa&&uid)_supa.from(tbl).delete().eq('id',String(id)).eq('user_id',uid).then(()=>{},()=>{});}catch(_e){}
}

// Per-record table definitions, one entry per data type.
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
  {t:'td_maintenance', get:()=>maintenance, set:v=>{maintenance.length=0;v.forEach(r=>maintenance.push(r));}, tx:null},
  {t:'td_photos',      get:()=>photos,      set:v=>{photos.length=0;v.forEach(r=>photos.push(r));},
    tx:arr=>arr.filter(p=>p.storagePath||p.url).map(({id,url,storagePath,type,caption,client_id,client_name,job_id,job_name,uploadedAt})=>({id,url,storagePath:storagePath||'',type,caption,client_id,client_name,job_id,job_name,uploadedAt}))},
];
// Root cause (found 2026-07-10): this used to be a hand-listed object literal
// that fell out of sync with _TD_TABLES above, td_maintenance was missing.
// _recordLocalDelete no-ops silently for any table absent here
// (`if(!_locallyDeletedIds[tbl])return;`), so deleteMaintenanceRecord's
// _userDelete call recorded nothing: the cloud sweep never saw the id as
// deleted, never soft-deleted it server-side, and the row resurrected on the
// next load. Deleting a vehicle service record simply didn't stick. Built
// FROM _TD_TABLES now so a future table can never repeat this class of bug.
_locallyDeletedIds=Object.fromEntries(_TD_TABLES.map(({t})=>[t,new Set()]));
// Dev-time guard: reports if _TD_TABLES ever gains a table this object
// doesn't cover (the exact defect above), a silent multi-week data-loss bug
// turned into an immediate, loud console error instead. Self-checking since
// the object is now derived, but stays as a permanent regression tripwire in
// case anything ever re-hardcodes it.
function _assertLocallyDeletedIdsComplete(){
  const missing=_TD_TABLES.map(({t})=>t).filter(t=>!_locallyDeletedIds[t]);
  if(missing.length)console.error('[_locallyDeletedIds] missing table(s): deletes on '+missing.join(', ')+' will never sweep from the cloud:',missing);
  return missing;
}
_assertLocallyDeletedIdsComplete();
// True when a Supabase error means "this table doesn't exist in the DB yet", e.g. a
// new feature table on a deploy that runs ahead of its migration. Both preview and
// production proxy to the SAME Supabase project, so an unmerged migration means the
// table is absent for everyone. Such an error must never abort load/save: that would
// trap every device in an offline loop. Real errors (auth, network) are not matched.
function _isMissingTableErr(err){
  return !!err&&(err.code==='42P01'||err.code==='PGRST205'||/does not exist|could not find the table|schema cache/i.test(err.message||''));
}

// Tables whose money fields are redacted for the CURRENT employee session, derived
// from their team permissions (the SAME matrix the server RPC load_account_data
// enforces). Used in TWO places that MUST agree:
//   1. The server zeroes these tables' money keys on load.
//   2. supaSaveToCloud SKIPS writing these tables back, so a redacted (zeroed)
//      array can NEVER overwrite the contractor's real amounts. This guard is
//      permission-derived, not RPC-derived, so corruption is impossible even
//      before the RPC migration reaches production (where load falls back to the
//      raw, unredacted select). Contractors (not _isEmployee) redact nothing.
// Multi-crew: remember which boss this login works under next boot, then reload into
// it. window._crewChoices (set at link time when >1 active crew) lists the options.
window.switchCrew=function(cid){
  try{if(_supaUser&&cid)localStorage.setItem('zp3_crew_choice_'+_supaUser.id,String(cid));}catch(_e){}
  location.reload();
};

// KEEP IN LOCKSTEP with crew_perm() in supabase/migrations/20260715_crew_rls_and_invites.sql
//, that policy function is the SERVER-enforced twin of this map (crew writes/reads/ops
// are permission-gated per table by the database, not just by this client-side skip).
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
    // Every other [data-lp-id] row is a DEV-ONLY hard-purge gesture, inert for
    // real users. Time Log rows are the one exception, the gesture there
    // calls deleteTimeEntry(), a real soft-delete that already re-checks
    // ownership/permission itself (js/jobs.js) and is only rendered onto rows
    // _tlCanEdit() already approved (js/timelog.js _tlRow), so it's safe to
    // let regular contractors/employees use it, not just dev mode.
    const devOk=typeof _canDelete==='function'&&_canDelete();
    const timelogOk=row.dataset.lpType==='timelog';
    if(!devOk&&!timelogOk)return;
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
  _lpFired=false; // reset immediately, popup buttons must not be swallowed by capture handler
  document.getElementById('_lp-del-popup')?.remove();
  const id=row.dataset.lpId,type=row.dataset.lpType,label=row.dataset.lpLabel||'this record';
  const isClient=(type==='lead'||type==='client');
  const sub=isClient?'Also removes all their bids, jobs, and expenses.':'This cannot be undone.';
  const ov=document.createElement('div');
  ov.id='_lp-del-popup';
  ov.style.cssText='position:fixed;inset:0;z-index:99990;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);padding:20px';
  ov.innerHTML='<div style="background:var(--bg);border-radius:16px;padding:24px;width:100%;max-width:300px;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.35)">'+
    '<div style="font-size:32px;margin-bottom:8px">'+svgIcon('🗑',{size:32})+'</div>'+
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
  // timelog is the one non-dev-gated type (see _lpStart), deleteTimeEntry()
  // is a real soft-delete that re-checks ownership/permission itself, unlike
  // every other branch below which is a dev-only hard purge.
  if(type==='timelog'){if(typeof deleteTimeEntry==='function')deleteTimeEntry(parseInt(id,10));return;}
  if(typeof _canDelete==='function'&&!_canDelete())return; // DEV-ONLY (defense in depth)
  const nid=parseInt(id,10);
  // DEV HARD DELETE (owner directive): the long-press purges the ACTUAL row(s) via
  // _devHardPurge, not a soft-delete, for rare dupe cleanup. Realtime DELETE events
  // propagate to online peers. Cascades mirror the old soft-delete cascade shapes.
  if(type==='income'){_devHardPurge('td_income',nid);if(typeof renderIncome==='function')renderIncome();}
  else if(type==='payment'){_devHardPurge('td_payments',nid);if(typeof renderIncome==='function')renderIncome();if(typeof renderClientDetail==='function')renderClientDetail();}
  else if(type==='expense'){_devHardPurge('td_expenses',nid);if(typeof renderExpenses==='function')renderExpenses();}
  else if(type==='mileage'){_devHardPurge('td_mileage',nid);if(typeof renderAllMileage==='function')renderAllMileage();}
  else if(type==='lead'||type==='client'){_lpDeleteClientById(nid,type);}
  else if(type==='bid'){
    const _delBid=bids.find(x=>x.id===nid);const _delClientId=_delBid?_delBid.client_id:null;
    // Cascade: the bid + its payments + any lien.
    if(typeof payments!=='undefined')payments.filter(p=>p.bid_id===nid).map(p=>p.id).forEach(pid=>_devHardPurge('td_payments',pid));
    if(typeof liens!=='undefined')liens.filter(l=>l.bid_id===nid).map(l=>l.id).forEach(lid=>_devHardPurge('td_liens',lid));
    _devHardPurge('td_bids',nid);
    if(typeof renderClientDetail==='function')renderClientDetail();
    if(typeof renderJobsHistory==='function')renderJobsHistory();
    if(typeof renderJobsPage==='function')renderJobsPage();
    if(typeof renderCalendar==='function')renderCalendar();
    if(typeof renderDash==='function')renderDash();
    if(_delClientId&&typeof _uploadClientHub==='function')_uploadClientHub(_delClientId).catch(()=>{});
  }
  else if(type==='job'){
    _devHardPurge('td_jobs',nid);
    if(typeof renderClientDetail==='function')renderClientDetail();
    if(typeof renderCalendar==='function')renderCalendar();
    if(typeof renderJobsPage==='function')renderJobsPage();
    if(typeof renderDash==='function')renderDash();
  }
}
function _lpDeleteClientById(id,fromType){
  // Cascade hard-purge: the client + everything referencing it.
  try{if(typeof bids!=='undefined')bids.filter(b=>b.client_id===id).map(b=>b.id).forEach(bid=>{if(typeof payments!=='undefined')payments.filter(p=>p.bid_id===bid).map(p=>p.id).forEach(pid=>_devHardPurge('td_payments',pid));if(typeof liens!=='undefined')liens.filter(l=>l.bid_id===bid).map(l=>l.id).forEach(lid=>_devHardPurge('td_liens',lid));_devHardPurge('td_bids',bid);});}catch(_e){}
  try{if(typeof jobs!=='undefined')jobs.filter(j=>j.client_id===id).map(j=>j.id).forEach(jid=>_devHardPurge('td_jobs',jid));}catch(_e){}
  try{if(typeof mileage!=='undefined')mileage.filter(m=>m.client_id===id).map(m=>m.id).forEach(mid=>_devHardPurge('td_mileage',mid));}catch(_e){}
  try{if(typeof income!=='undefined')income.filter(i=>i.client_id===id).map(i=>i.id).forEach(iid=>_devHardPurge('td_income',iid));}catch(_e){}
  try{if(typeof expenses!=='undefined')expenses.filter(e=>e.client_id===id).map(e=>e.id).forEach(eid=>_devHardPurge('td_expenses',eid));}catch(_e){}
  _devHardPurge('td_clients',id);
  if(fromType==='lead'){if(typeof renderLeadsPage==='function')renderLeadsPage();}
  else{if(typeof renderClientList==='function')renderClientList();}
  if(typeof renderDash==='function')renderDash();
}

let _proposalViews={};
let _proposalViewsByBid={};
// Three separate timestamp maps per bid_id, each tracks a distinct open event:
let _proposalViewsByBidHubClient={};   // client opened the shared hub link (client.html)
let _proposalViewsByBidClient={};      // client opened a specific proposal (sign.html)
let _proposalViewsByBidContractor={};  // contractor previewed the proposal
// View count maps, how many times each event type has occurred per bid
let _proposalViewsByBidHubCount={};    // number of hub opens
let _proposalViewsByBidClientCount={}; // number of proposal opens
// Sign-flow funnel, furthest step the client reached inside sign.html
let _proposalViewsByBidStep={};        // bid_id → 'approved'|'signature_ready'|'payment_viewed'|'method_selected'|'signed'
let _proposalViewsByBidStepAt={};      // bid_id → timestamp that step was first reached
// Expose on window so Playwright E2E tests can inject test data via page.evaluate()
// (let declarations are not window properties in browser scripts)
Object.defineProperty(window,'_proposalViewsByBidHubClient',{get:()=>_proposalViewsByBidHubClient,set:v=>{_proposalViewsByBidHubClient=v;},configurable:true});
Object.defineProperty(window,'_proposalViewsByBidClient',{get:()=>_proposalViewsByBidClient,set:v=>{_proposalViewsByBidClient=v;},configurable:true});
Object.defineProperty(window,'_proposalViewsByBidContractor',{get:()=>_proposalViewsByBidContractor,set:v=>{_proposalViewsByBidContractor=v;},configurable:true});
Object.defineProperty(window,'_proposalViewsByBidHubCount',{get:()=>_proposalViewsByBidHubCount,set:v=>{_proposalViewsByBidHubCount=v;},configurable:true});
Object.defineProperty(window,'_proposalViewsByBidClientCount',{get:()=>_proposalViewsByBidClientCount,set:v=>{_proposalViewsByBidClientCount=v;},configurable:true});
Object.defineProperty(window,'_proposalViewsByBidStep',{get:()=>_proposalViewsByBidStep,set:v=>{_proposalViewsByBidStep=v;},configurable:true});
Object.defineProperty(window,'_proposalViewsByBidStepAt',{get:()=>_proposalViewsByBidStepAt,set:v=>{_proposalViewsByBidStepAt=v;},configurable:true});
// true when data came from localStorage cache, not a live Supabase fetch.
// supaSaveToCloud() checks this + runs a sanity guard to prevent pushing
// incomplete in-memory state over real cloud data.
let _loadedFromCacheOnly=false;
// True once this session has either (a) authoritatively loaded the cloud settings, or
// (b) confirmed this is a brand-new account with nothing in the cloud to clobber. Until
// then, supaSaveToCloud must NOT push the settings blob, a fresh/cache-wiped boot starts
// with DEFAULT settings (goal 0, location off), and pushing those before the real values
// load overwrites the saved cloud settings (the "settings/location don't stick" bug).
let _authSettingsLoaded=false;
// Deliberate, user-initiated "Clear all data" wipe. When true, supaSaveToCloud's
// accidental-wipe sanity guard is bypassed, emptying every array IS the intent, so the
// soft-delete sweep MUST reach the cloud (else the cleared rows resurrect on reload).
let _deliberateWipe=false;
function _setDeliberateWipe(v){_deliberateWipe=!!v;}
let _mergeOnSignIn=false; // true when offline data in memory needs merging after SIGNED_IN
let _loadedDataOwner=null; // user id whose business data is currently in memory (cross-account guard)
let _cloudTimersStarted=false; // prevent duplicate setInterval/addEventListener on PTR re-load
let _checkSigsBusy=false;      // prevent concurrent clawback writes
let _sessionRestoreInProgress=false;
function supaEnabled(){return !!(SUPA_URL&&SUPA_KEY);}
// Boot waterfall arming, popup-gated. Cards start hidden (boot-hold); ~220ms in
// we sample for an open popup (boot-time alerts spawn right around overlay
// removal). None → pour immediately. One up → hold until the LAST popup closes
// (debounced 220ms so chained popups stay first), then pour. 20s failsafe so a
// detection miss can never leave the dashboard permanently hidden.
function _armBootCascade(){
  const d=document.getElementById('pg-dash');
  if(!d||!d.classList.contains('active'))return;
  // Cascade plays RIGHT AWAY as the boot overlay lifts, including BEHIND a boot
  // popup (owner: blank white behind a popup looks odd; the dashboard should be
  // filling in under the popup's scrim). Delays are assigned over VISIBLE cards
  // ONLY, so hidden/empty widgets (crew/alerts/contracts with no data) leave no
  // gaps: the ripple flows smoothly top→bottom over exactly what's on screen.
  // Backwards `both` fill keeps each card invisible until its own delay elapses,
  // so no boot-hold class (and no blank-hold) is needed.
  let count=0;
  try{
    const root=d.querySelector('#dash-widget-root');
    const tbar=d.querySelector('.tbar');
    const base=60,step=95;
    if(tbar)tbar.style.animationDelay='0ms';
    if(root){
      let i=0;
      [...root.children].forEach(el=>{
        if(el.nodeType!==1||!el.classList.contains('td-dw'))return;
        const visible=el.offsetHeight>2;          // read BEFORE the class → natural layout height
        el.style.animationDelay=(base+(visible?i:Math.max(0,i-1))*step)+'ms';
        if(visible)i++;
      });
      count=i;
    }
  }catch(_e){}
  d.classList.add('boot-cascade');
  const total=60+Math.max(1,count)*95+720+260;    // last card start + travel + slack
  setTimeout(()=>{try{
    d.classList.remove('boot-cascade');
    d.querySelectorAll('.tbar,#dash-widget-root>.td-dw').forEach(el=>{el.style.animationDelay='';});
  }catch(_e){}},total);
}
function _removeBootOverlay(immediate){
  const o=document.getElementById('supa-boot-overlay');if(!o)return;
  // A version/SW update arrived during this boot and a reload is queued (new
  // preview/production build). Keep the loading screen UP and reload beneath it,
  // fading out, flashing the dash, then re-showing a second loading screen is the
  // "boot screen shows twice" bug. One continuous load, slightly longer.
  if(typeof _deferredReload!=='undefined'&&(_deferredReload||_reloadPending))return;
  // Signed-out boot goes straight to the login screen (immediate=true): there's no
  // dashboard to reveal, so the "let the intro breathe" min-hold and the card
  // cascade below are pure dead time, the owner sits watching a spinner before a
  // login they could already be typing into. Skip both and let the login fade in.
  if(!immediate){
    // MIN STAGE TIME (owner: "is our boot screen too short?", yes, on fast loads
    // the intro was cut off mid-breath). Hold the overlay until it has been on
    // screen ≥2s: one halo pulse + a wordmark sheen play before the lift-away.
    // Slow loads are unaffected, real loading always governs.
    try{
      const _t0=window._sboT0||0;
      if(_t0&&!o._minWaited){
        const _left=4000-(Date.now()-_t0);   // ≥4s on screen (owner: 2.8s felt too short), the intro gets room to breathe
        if(_left>60){o._minWaited=true;setTimeout(_removeBootOverlay,_left);return;}
      }
    }catch(_e){}
    // Boot waterfall, popup-gated (owner rule: "waterfall builds after popups;
    // no popups → after boot load"). _armBootCascade holds the cards invisible,
    // waits out any boot popup (collect alert, verdicts), then pours them in.
    try{_armBootCascade();}catch(_e){}
  }
  o.classList.add('td-fadeout');
  setTimeout(()=>{
    o.remove();
    const resumeBid=localStorage.getItem('_sw_resume_bid');
    if(resumeBid){
      localStorage.removeItem('_sw_resume_bid');
      const bid=bids.find(b=>String(b.id)===resumeBid);
      if(bid){
        setTimeout(()=>{
          // openGenericEstimate reads b.isTM / b.isFreeForm internally
          openGenericEstimate(getClientById(bid.client_id),bid.id,bid.trade_type||'general');
        },80);
      }
    }
    else{
      // Auto-resume: if the contractor was mid-estimate when the app closed or
      // the phone switched tabs, jump straight back into it, that unfinished
      // estimate is what they're most likely coming back for. All the guards
      // (same account, fresh, bid still unsent) live in the function.
      setTimeout(()=>{if(typeof _maybeResumeActiveEstimate==='function')_maybeResumeActiveEstimate();},120);
    }
    // The pipe inbox: payments/job addresses from linked GCs land
    // automatically: kicked shortly after boot so it never competes with
    // the boot render. No-op for accounts with no links.
    setTimeout(()=>{if(typeof _ingestPipeInbox==='function')_ingestPipeInbox(true);},1800);
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
                showToast('New lead form restored, review and save','📋');
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
          if(restored>0)showToast('Form data restored, review and save','📋');
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
      // Crew location tracking, inits if the contractor enabled it and the person
      // (employee or the owner tracking their own time) consents; shown after the
      // vehicle picker so they don't stack. Business-hours gating is in _geoTrackInit().
      if(typeof _geoTrackInit==='function')setTimeout(_geoTrackInit,1400);
    },700);
  },320);
}
// Count of distinct rooms/surfaces on a bid, used by the sync merge to decide
// which copy of a bid is "richer" so a merge never replaces a fuller record with
// a sparser one. (surfaces/roomScopeMap are legacy paint-era fields, still
// meaningful as a tiebreaker for old records; `updated` stamp decides first.)
function _bidRichness(b){
  if(!b)return -1;
  const surf=Array.isArray(b.surfaces)?b.surfaces.length:0;
  const rooms=(b.roomScopeMap&&typeof b.roomScopeMap==='object')?Object.keys(b.roomScopeMap).length:0;
  return surf*100+rooms; // surfaces weighted heavier, they are the measurements that get lost
}
// Pick the authoritative copy when the same bid id exists in two places: newest
// `updated` stamp wins; if stamps tie or are missing, the richer copy wins.
function _pickBid(a,b){
  if(!a)return b;if(!b)return a;
  const ua=+a.updated||0, ub=+b.updated||0;
  if(ua!==ub)return ua>ub?a:b;
  return _bidRichness(a)>=_bidRichness(b)?a:b;
}
async function supaInit(){
  if(!supaEnabled())return;
  // OAuth return: capture the session params from the URL and SCRUB them from the
  // address bar IMMEDIATELY, on the first tick of boot, before the health probe or
  // any analytics beacon can read the current URL. The tokens ride back in the URL
  // (hash for Apple's implicit return, ?code= for PKCE); leaving them there even for
  // a moment lets a beacon / browser history / a screenshot capture a live token.
  // Stash them in memory and finish the handshake once the client is built below.
  let _oauthRet=null;
  try{
    const _oauthProv=localStorage.getItem('_oauthPending');
    if(_oauthProv){
      const _u=new URL(window.location.href);
      const _hp=new URLSearchParams((window.location.hash||'').replace(/^#/,''));
      _oauthRet={
        prov:_oauthProv,
        code:_u.searchParams.get('code'),
        htok:_hp.get('access_token'),
        hrefresh:_hp.get('refresh_token'),
        err:_u.searchParams.get('error_description')||_u.searchParams.get('error')||_hp.get('error_description')||_hp.get('error')
      };
      // Wipe tokens/code out of the URL right now (kept the origin+path only).
      try{history.replaceState(null,'',_u.origin+_u.pathname);}catch(_e){}
    }
  }catch(_e){}
  // AUTO-FALLBACK: if we're set to talk DIRECT to Supabase, confirm this network can
  // actually reach it before building the client. A 2.5s health probe, any HTTP
  // response (even 401) means reachable → stay direct; a DNS/network/timeout error
  // means this carrier can't resolve *.supabase.co → silently switch to the /api proxy
  // for this session so the app still loads. The probe runs only in direct mode, so
  // proxy-forced sessions pay nothing.
  if(SUPA_URL===_SUPA_DIRECT_URL){
    let _directOk=false;
    try{
      const _c=new AbortController();const _t=setTimeout(()=>_c.abort(),900);
      // Send the anon apikey so the health endpoint answers 200 instead of 401.
      // We only care that SOMETHING answered (reachability), but a bare 401 prints
      // a red error line in the console on every boot; the key makes it clean.
      await fetch(_SUPA_DIRECT_URL+'/auth/v1/health',{signal:_c.signal,headers:{apikey:SUPA_KEY}});
      clearTimeout(_t);_directOk=true;
    }catch(_e){_directOk=false;}
    if(!_directOk){SUPA_URL=_SUPA_PROXY_URL;try{localStorage.setItem('zp3_supa_fellback','1');}catch(_e2){}}
  }
  try{
    _supa=supabase.createClient(SUPA_URL,SUPA_KEY,{
      auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,storage:window.localStorage},
      // HARD FETCH TIMEOUT (30s): supabase-js has none, so a single stalled request left a
      // save pending FOREVER, _pendingSavePromise never settled, every reconcile reload
      // deferred behind it, and the device stopped converging until a page reload (observed
      // live: the wedged A→B delete + the sibling sign-in hang). An aborted request rejects
      // → the save's finally clears the pending promise → the retry path takes over.
      // Callers that pass their own AbortSignal keep it (realtime uses WebSocket, unaffected).
      global:{fetch:(url,opts={})=>{
        if(opts.signal)return fetch(url,opts);
        const _ac=new AbortController();
        const _tt=setTimeout(()=>{try{_ac.abort();}catch(_e){}},30000);
        return fetch(url,{...opts,signal:_ac.signal}).finally(()=>clearTimeout(_tt));
      }}
    });
    // Realtime connects straight to Supabase, WebSocket proxying through
    // Cloudflare Pages is unreliable, and a dead socket silently kills
    // cross-device live sync. REST now ALSO defaults to direct (see SUPA_URL);
    // the /api proxy is the auto-fallback when direct can't be reached. If the
    // direct socket fails, the reconcile heartbeat covers it.
    // GATED on non-localhost: forcing the HOSTED socket unconditionally created a
    // ZOMBIE subscription on any non-hosted backend, the socket connects to the
    // cloud project (valid key), reports SUBSCRIBED, and never delivers an event,
    // because the data lives elsewhere (the local test stack today; the self-hosted
    // Proxmox Supabase after the migration, this line would have silently killed
    // realtime for the entire production app there). On localhost the endpoint
    // derives from SUPA_URL, and the local /api proxy carries the WS upgrade.
    // Derived from _SUPA_DIRECT_URL (one source of truth for the migration).
    try{
      if(!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)){
        _supa.realtime.endPoint=_SUPA_DIRECT_URL.replace(/^https/,'wss')+'/realtime/v1/websocket';
      }
    }catch(_e){}
    // OAuth return handshake. signInWithOAuth (Google/Apple) redirects the browser
    // to the provider and back here with the session in the URL (?code= for PKCE,
    // or #access_token= for implicit). The client is built detectSessionInUrl:false
    // so recovery / magic links aren't silently consumed, which means an OAuth
    // return would otherwise be ignored and the user never actually signs in. We
    // complete it by hand, but ONLY when _oauthPending was set by _obOAuth right
    // before the redirect, so a stray recovery ?code= is never touched. Then scrub
    // the params so a refresh or Back can't re-run the exchange or leave the token
    // sitting in the address bar / history.
    try{
      if(_oauthRet){
        // The provider / Supabase can hand back an explicit error instead of a code
        // (denied consent, provider not configured, redirect-url mismatch). Surface it
        // rather than silently landing in local mode looking "not synced". The tokens
        // were already scrubbed from the URL at the top of boot; we finish with the
        // in-memory copy here now that _supa exists.
        let _oaFail=_oauthRet.err||null;
        if(_oauthRet.code&&_supa.auth.exchangeCodeForSession){
          try{const{error:_ee}=await _supa.auth.exchangeCodeForSession(_oauthRet.code);if(_ee)_oaFail=_ee.message||String(_ee);}
          catch(_e){_oaFail=(_e&&_e.message)||String(_e);}
        } else if(_oauthRet.htok&&_supa.auth.setSession){
          try{const{error:_se}=await _supa.auth.setSession({access_token:_oauthRet.htok,refresh_token:_oauthRet.hrefresh});if(_se)_oaFail=_se.message||String(_se);}
          catch(_e){_oaFail=(_e&&_e.message)||String(_e);}
        } else if(!_oauthRet.err){
          // Marked pending but came back with neither a code nor a token: the redirect
          // likely landed on a different origin than the one that started the flow (so
          // the PKCE verifier isn't in this localStorage), or the params were stripped.
          _oaFail='no auth code returned (redirect landed without ?code=)';
        }
        localStorage.removeItem('_oauthPending');
        if(_oaFail){
          console.warn('[oauth] '+_oauthRet.prov+' sign-in did not complete:',_oaFail);
          window._oauthFailMsg=_oauthRet.prov+' sign-in did not finish: '+_oaFail;
        }
      }
    }catch(_e){console.warn('[oauth] handshake error:',_e);}
    // Surface an OAuth failure to the user once boot settles (after the overlay lifts),
    // so a failed social sign-in reads as an error, not a mysterious not-synced screen.
    if(window._oauthFailMsg){setTimeout(()=>{try{if(typeof showToast==='function')showToast(window._oauthFailMsg,'⚠️',7000);}catch(_e){}window._oauthFailMsg=null;},1200);}
    const{data:{session}}=await _supa.auth.getSession();
    if(session){
      _supaUser=session.user;
      _hlcInit(); // PHASE 0 oplog: load this owner's persisted HLC so it can't go backwards across reloads
      _opDbLoad(); // PHASE 1 oplog: rehydrate the durable op log + field clocks from IndexedDB
      _saveSessionBackup(session);
      const hasAccount=await loadAccountData();
      if(hasAccount){
        await supaLoadFromCloud();
        _supaCloudLoaded=true;
      } else {
        // Signed in but no data at all. Route them INTO onboarding ONLY when THIS boot
        // actually came back from a Google/Apple redirect (_oauthRet is set by the
        // handshake above). That's the real "first-time social signup" case, and it's
        // the ONLY time we want the full-screen onboarding overlay to auto-open. Any
        // other accountless boot (an abandoned/empty account, and every test-harness
        // boot, which never carries OAuth params) gets the plain empty dashboard, not
        // an overlay that would block the whole UI.
        _authSettingsLoaded=true;
        supaSetStatus('cloud');
        if(_oauthRet&&!window._obInProgress&&typeof _beginOAuthOnboarding==='function'){
          _beginOAuthOnboarding();
        } else {
          _removeBootOverlay();
          renderDash();
          if(typeof _fetchScopeRates==='function')_fetchScopeRates();
        }
      }
    } else {
      // No valid session, load from cache if available, regardless of navigator.onLine
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
          if(_cd.maintenance?.length)maintenance=_cd.maintenance;
          if(_cd.checksState&&Object.keys(_cd.checksState).length)checksState=_cd.checksState;
          if(_cd.settings){_mergeIncomingSettings(_cd.settings,'zp3_cloud_cache (no-session boot)');applySettings();_refillSettingsFormUnlessEditing();}
          _mergeOfflinePendingToMemory(); // surface any records not yet pushed to cloud
          _loadedFromCacheOnly=true;
          _mergeOnSignIn=true;
          _removeBootOverlay();renderDash();
          _showOfflineBanner();
          supaSetStatus('error');
          _cacheLoaded=true;
        }catch(_ce){}
      }
      if(!_cacheLoaded){
        // Online or cache parse failed, show login screen. immediate=true: no
        // session means we're going to login, not a dashboard, so fade the boot
        // overlay out now instead of holding the spinner for the 4s intro.
        _removeBootOverlay(true);
        renderDash();
        supaSetStatus('local');
        supaShowLogin();
      }
    }
    _supa.auth.onAuthStateChange(async(event,session)=>{
      if(event==='SIGNED_IN'){
        // Suppress during onboarding, obSubmit handles its own flow
        if(window._obInProgress){return;}
        // TOKEN_REFRESHED in Supabase v2 can fire as SIGNED_IN, never reload cloud data
        // on a background token refresh; only load once per page session on explicit sign-in
        if(_supaCloudLoaded && _supaUser && session.user.id===_supaUser.id){return;}
        // Different account than the data currently in memory, full reset before loading.
        // Compare against _loadedDataOwner (not _supaUser): after an involuntary SIGNED_OUT
        // (token expiry) _supaUser is null yet the previous account's records are still in
        // memory, so checking _supaUser alone would miss the swap and bleed data across.
        const _incomingId=session.user.id;
        if((_loadedDataOwner&&_incomingId!==_loadedDataOwner)||(_supaCloudLoaded&&_supaUser&&_incomingId!==_supaUser.id)){
          _supaCloudLoaded=false;_mergeOnSignIn=false;_realtimeSubscribed=false;_tdRealtimeReady=false;_loadInProgress=false;
          _authSettingsLoaded=false; // hide the setup checklist until the incoming account's settings load (no flash)
          clearTimeout(_syncTimer);_syncTimer=null;
          // Close the OUTGOING account's still-live realtime channels (bug #39): an involuntary
          // SIGNED_OUT (token expiry) never ran _wipeLocalAccountData, so the prior account's
          // td-sync-<uid> subscription is still delivering its rows. Without this, those rows
          // re-push into the incoming account's arrays right after this reset clears them.
          _teardownRealtimeChannels();
          _devSupportMode=false;_devSupportName='';_devSavedState=null;
          // Outgoing account's employee identity must never leak into the incoming account,
          // loadAccountData() re-derives this from the incoming account's own row, but reset
          // it here too as the single foundational cross-account boundary (belt-and-suspenders
          // with the per-branch resets in loadAccountData).
          _isEmployee=false;_employeeRecord=null;_contractorUserId=null;
          // Wipe the outgoing account's in-memory records so they can't be merged/pushed up.
          clients=[];bids=[];jobs=[];payments=[];income=[];expenses=[];mileage=[];liens=[];
          // Inbound-lead review queue lives OUTSIDE these arrays and was never cleared
          // here: the incoming account's Leads page kept rendering the outgoing
          // account's unreviewed QR/intake leads until its own poll happened to
          // overwrite it (not guaranteed, see _loadPendingInbound's early-returns).
          _pendingInbound=[];_processedInboundIds.clear();
          _updateInboundBadge();
          localStorage.removeItem('zp3_offline_pending');
          _loadedDataOwner=null;
          // Account switch: drop the outgoing account's delta cursor so it can't be
          // written into the incoming account's delta_meta (owner guards the read, but
          // the in-memory cursor is global). Next load rebuilds it for this account.
          _deltaCursor=null;
          // Pipe/bid caches are keyed to the outgoing account, drop them so the
          // incoming account re-loads its OWN links + incoming bids (no cross-bleed).
          _subBids=null;window._subBidsKicked=false;
          // Previous user's settings timestamp must never beat this user's cloud copy
          S.settingsTs=0;
        }
        _supaUser=session.user;
        _saveSessionBackup(session);
        document.getElementById('supa-login-overlay')?.remove();
        document.getElementById('welcome-overlay')?.remove();
        // Navigate to the dashboard NOW, before awaiting the account load below.
        // loadAccountData() runs several sequential Supabase queries (users, accounts,
        // account_config, vehicles), without this, removing the login overlay exposes
        // whatever page was active underneath for that entire duration. Signing out is
        // only reachable from Settings, so every account switch on the same device
        // landed the incoming account back on Settings until the load finally finished
        // and the goPg('pg-dash') calls below caught up.
        goPg('pg-dash');
        const hasAccount=await loadAccountData();
        if(hasAccount){
          // Trigger merge path if _mergeOnSignIn is set OR if zp3_offline_pending exists.
          // The flag may be false after a force-quit restart even if there is pending data,
          // checking the key directly means no offline record is ever silently dropped.
          // _readOwnedOfflinePending() discards (and clears) any blob owned by a different
          // account, so foreign offline data can never be folded into this account.
          const _op=_readOwnedOfflinePending();
          const _hasPendingData=!!_op;
          if(_mergeOnSignIn||_hasPendingData){
            _mergeOnSignIn=false;
            // Deduplicate by ID across in-memory + pending, saveAll() writes all current
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
            // local copy of the same id, a stale cloud draft (e.g. saved before its room
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
          // Brand-new account (no cloud data), settings saves are safe (nothing to clobber).
          // NOTE: onboarding routing for first-time social sign-ins lives in the BOOT
          // path only (see the boot brand-new branch). A real Google/Apple signup always
          // redirects away and reloads, so it lands on boot, never here. This in-tab
          // SIGNED_IN branch is reached by same-device account switches, which must land
          // on the dashboard, not onboarding.
          _authSettingsLoaded=true;
          _removeBootOverlay();
          renderDash();
          supaSetStatus('cloud');
          goPg('pg-dash');
        }
        // Existing-account sub-invite: a contractor who already runs TradeDesk
        // arrived via a referral link and SIGNED IN (not onboarded, new
        // accounts are suppressed by the _obInProgress return at the top, and
        // obSubmit redeems their grant itself). Forge the link + accrue the
        // referrer's reward now, and OFFER their payment history. Runs after the
        // load above so the payer card lands in the right account's data.
        if(localStorage.getItem('_pendingSubInviteGrant')){
          try{await _redeemSubInviteGrantForExisting();}catch(_e){}
        }
      } else if(event==='TOKEN_REFRESHED'){
        // Token silently refreshed, update user ref. If we were in offline/cache mode,
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
        // navigator.onLine is unreliable on iOS, don't use it. Always prefer cache.
        if(_deliberateSignOut){
          // Full hard-wipe of this account's footprint (arrays, cloud cache, offline blob,
          // cross-account merge state, delta-sync baselines, settings), see
          // _wipeLocalAccountData. Shared with supaSignOut so the wipe still happens if this
          // event fires late, and so a future sign-out path can't miss part of the cleanup.
          _wipeLocalAccountData();
          _deliberateSignOut=false;
          supaSetStatus('local');
          supaShowLogin({force:true});
        } else if(localStorage.getItem('zp3_cloud_cache')){
          // Non-deliberate sign-out (token refresh failure or rotation), keep data in memory.
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
          if(_cd.maintenance?.length)maintenance=_cd.maintenance;
        if(_cd.checksState&&Object.keys(_cd.checksState).length)checksState=_cd.checksState;
        if(_cd.settings){_mergeIncomingSettings(_cd.settings,'zp3_cloud_cache (offline boot, session present)');applySettings();_refillSettingsFormUnlessEditing();}
        _mergeOfflinePendingToMemory(); // surface any records not yet pushed to cloud
        _supaCloudLoaded=true;
        _loadedFromCacheOnly=true;
        _removeBootOverlay();renderDash();
        _showOfflineBanner();
        supaSetStatus('error');
        return;
      }catch(_ce){}
    }
    _removeBootOverlay();
    renderDash();
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
  // saveAll, NOT saveSettings, this runs at every boot, before the settings
  // form is ever filled. saveSettings() here harvested the EMPTY form and wiped
  // every saved setting on each app open (then pushed the wiped copy to cloud
  // with a fresh settingsTs, beating the user's real saves on every device).
  // No settingsTs bump either: at boot the local copy may be stale, claiming
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
        saveAll(); // direct S mutation, never harvest the form outside the Settings UI
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
  expenses:'Adds expense receipts, for field workers buying materials or supplies on the job.',
  mileage:'Logs drive trips for IRS deduction tracking and reimbursement.',
  financials:'Sees the Books page, income/expense totals, P&L, and tax estimates. Off by default for most field workers.',
  team:'Adds and invites team members and manages company vehicles. Usually managers only.',
  payroll:'Sees and edits employee pay rates and the crew location map, and views the Job Profit report. Highly sensitive, managers only. Pay rates are never visible to employees without this.'
};
const _EMP_PERM_LABELS={
  leads:'Work leads',estimate:'Estimate jobs',schedule:'Schedule jobs',collect:'Collect payments',
  clients:'Edit clients',expenses:'Log expenses',mileage:'Log mileage',
  financials:'View financials',team:'Manage team',payroll:'Pay & profit'
};
const _EMP_CLASSIFICATIONS=['','Apprentice','Journeyman','Master','Foreman / Lead','Helper','Subcontractor'];
function _togglePermInfo(id){const el=document.getElementById(id);if(el)el.style.display=el.style.display==='block'?'none':'block';}
// Collapsible Permissions block in the team-member modal (default closed). max-height
// transition (not display) so it animates per the app's motion standard (§8.4).
function _togglePermsAccordion(hdr){
  const acc=hdr.parentElement.querySelector('.perms-acc');
  const chev=hdr.querySelector('.perms-chev');
  if(!acc)return;
  const open=acc.style.maxHeight&&acc.style.maxHeight!=='0px';
  acc.style.maxHeight=open?'0px':(acc.scrollHeight+24)+'px';
  if(chev)chev.style.transform=open?'':'rotate(90deg)';
}
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
    '<div style="font-size:11px;color:var(--text3);margin-bottom:14px;line-height:1.4">Enter their email then tap "Add &amp; Invite", they\'ll get a sign-in link and see your jobs, clients, and estimates.</div>'+
    '<div class="f" style="margin-bottom:10px"><label>Access role</label>'+
      '<select id="_inv-role" onchange="_setEmpRolePreset(this.value)" style="font-size:14px;padding:10px">'+
        '<option value="tech">Field Tech</option>'+
        '<option value="office">Office / CSR</option>'+
        '<option value="manager">Manager</option>'+
        '<option value="owner">Owner / Admin</option>'+
      '</select></div>'+
    '<div class="f" style="margin-bottom:14px"><label>Classification <span style="font-size:10px;font-weight:400;color:var(--text3)">(optional)</span></label>'+
      '<select id="_inv-class" style="font-size:14px;padding:10px">'+
        _EMP_CLASSIFICATIONS.map(c=>'<option value="'+escHtml(c)+'">'+escHtml(c||'- None -')+'</option>').join('')+
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
// Mint a SERVER-VERIFIED single-use invite token (crew_invites row) for a roster
// entry. The legacy ?emp_invite= payload is forgeable base64 that only ever linked
// via email-match; the token links regardless of sign-up email and can't be forged
// (it exists only as a row the contractor created; claim_crew_invite burns it).
// Returns the token or null (migration not deployed / offline / no roster row),
// callers fall back to the legacy email-match-only link, so deploys stay safe.
async function _mintCrewInviteToken(cid,email){
  try{
    if(!_supa||!_supaUser||!email)return null;
    const{data:tmRow,error:tmErr}=await _supa.from('team_members').select('id').eq('contractor_user_id',cid).eq('email',email).maybeSingle();
    if(tmErr||!tmRow)return null;
    const{data:inv,error:invErr}=await _supa.from('crew_invites').insert({contractor_user_id:cid,team_member_id:tmRow.id,email}).select('token').single();
    if(invErr||!inv)return null;
    return inv.token;
  }catch(_e){return null;}
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
  // Build invite link. Sync team_members FIRST (awaited) so the server-minted token
  // can reference the roster row; the link then carries `tok`, the forge-proof,
  // single-use claim path that links even if the crew member signs up with a
  // different email. Email-match remains the fallback when minting is unavailable.
  const cid=_contractorUserId||_supaUser?.id||'';
  let _invTok=null;
  if(email&&supaEnabled()&&_supaUser){
    const{error}=await _supa.from('team_members').upsert({contractor_user_id:cid,email,name,role:newEmp.role,permissions:permissions||{},active:false,invited_at:new Date().toISOString()},{onConflict:'contractor_user_id,email'});
    if(error)console.warn('team_members upsert:',error);
    else _invTok=await _mintCrewInviteToken(cid,email);
  }
  const inviteLink=window.location.origin+window.location.pathname+'?emp_invite='+btoa(JSON.stringify({cid,eid:newEmp.id,email:email||'',bname:S.bname||'',ename:name||'',tok:_invTok||undefined}));
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
  const _emailSentLine=email?'<div style="font-size:13px;color:var(--green-mid);margin-bottom:10px">'+svgIcon('📧')+' Invite sent to '+escHtml(email)+'</div>':'';
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
  }).catch(()=>{});}else{
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
    // Composite field note (client site note + this job's note + hazard flag),
    // read-only here, same helper the dashboard/on-site cards use.
    const note=(typeof _jobFieldNote==='function')?_jobFieldNote(j):(j.notes?escHtml(j.notes):'');
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
      (note?'<div style="margin-bottom:6px">'+note+'</div>':'')+
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:6px">'+
        orderBtns+assignBtn+
      '</div>'+
    '</div>';
  }
  const unassignedHtml=unassigned.length
    ?unassigned.map(j=>_jobCard(j,null)).join('')
    :'<div style="font-size:12px;color:var(--text3);padding:8px 0">No unassigned jobs today.</div>';
  const empCols=emps.map(emp=>{
    // todayJobs is already date-range-filtered above, assignment now persists
    // for a job's whole span (owner spec 2026-07-18), no separate "was this
    // reconfirmed today" gate needed.
    const empJobs=todayJobs.filter(j=>String(j.assignedTo)===String(emp.id))
      .sort((a,b2)=>(a.dispatchOrder||0)-(b2.dispatchOrder||0));
    const rc=ROLE_COLORS[emp.role]||'var(--text2)';
    const optBtn=empJobs.length>=2
      ?'<button onclick="_dispatchOptimizeRoute(\''+emp.id+'\')" style="font-size:10px;font-weight:700;padding:3px 8px;border-radius:var(--r);border:1px solid var(--blue);background:var(--blue-lt);color:var(--blue);cursor:pointer;font-family:inherit">'+svgIcon('⚡')+' Optimize route</button>'
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
    '<div class="tbar"><div class="tbar-title">'+svgIcon('📋')+' Dispatch Board</div>'+
      '<div style="display:flex;gap:6px">'+
        (S.teamTracking?'<button onclick="_renderCrewMap()" style="font-size:12px;padding:6px 12px;border-radius:var(--r);border:1px solid var(--border2);background:none;cursor:pointer;font-family:inherit">'+svgIcon('📍')+' Crew map</button>':'')+
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
  // Owner spec 2026-07-18: assignment now persists for the job's whole span,
  // no daily "assignedDate" reconfirmation stamp needed or read anywhere.
  j.assignedTo=empId;
  // Durable record of everyone ever assigned, powers the crew trust ranking on estimates.
  if(!Array.isArray(j.crewHistory))j.crewHistory=[];
  if(!j.crewHistory.map(String).includes(String(empId)))j.crewHistory.push(empId);
  // Geocode the job address NOW, on the owner's device, and stamp lat/lon on the
  // row: the employee's GPS ping handler then fences against stored coordinates
  // instead of doing network geocodes mid-ping (the interleaving that scrambled
  // arrive/depart transitions on slow connections).
  if(!(j.lat&&j.lon)){
    const _jc=clients.find(x=>x.id===j.client_id);
    const _jaddr=j.addr||(_jc&&_jc.addr)||'';
    if(_jaddr&&typeof _resolveCoords==='function'){
      _resolveCoords(_jaddr).then(r=>{
        if(r&&r.lat){const _lj=jobs.find(x=>String(x.id)===String(jobId));if(_lj){_lj.lat=r.lat;_lj.lon=r.lng;saveAll();}}
      }).catch(()=>{});
    }
  }
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
  const empJobs=jobs.filter(j=>String(j.assignedTo)===String(empId)&&_jobActiveOn(j,tk)).sort((a,b2)=>(a.dispatchOrder||0)-(b2.dispatchOrder||0));
  const idx=empJobs.findIndex(j=>j.id===jobId);if(idx<=0)return;
  // Normalize to 0..n-1 in current sorted order BEFORE swapping (mirrors _dispatchMoveDown).
  // Doing the forEach reindex AFTER the swap clobbered it, it overwrote dispatchOrder from
  // the pre-swap array positions, so the up-arrow never actually moved the job up.
  empJobs.forEach((j,i)=>{j.dispatchOrder=i;});
  const temp=empJobs[idx-1].dispatchOrder;
  empJobs[idx-1].dispatchOrder=empJobs[idx].dispatchOrder;
  empJobs[idx].dispatchOrder=temp;
  saveAll();renderDispatch();
}
function _dispatchMoveDown(jobId,empId){
  const tk=todayKey();
  const empJobs=jobs.filter(j=>String(j.assignedTo)===String(empId)&&_jobActiveOn(j,tk)).sort((a,b2)=>(a.dispatchOrder||0)-(b2.dispatchOrder||0));
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
  const empJobs=jobs.filter(j=>String(j.assignedTo)===String(empId)&&_jobActiveOn(j,tk));
  if(empJobs.length<2){showToast('Need at least 2 jobs to optimize','📋');return;}
  showToast('Optimizing route…','⏳');
  const office=await _geoOfficeCoords();
  if(!office){zAlert('Add your business address in Settings first, it\'s the starting point for route optimization.');return;}
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
  box.innerHTML='<div style="font-size:17px;font-weight:800;margin-bottom:4px">'+svgIcon('📍')+' Crew locations</div>'+
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
      '<div><div style="font-size:13px;font-weight:700">'+nm+'</div><div style="font-size:11px;color:var(--text3)">'+svgIcon('📍')+' '+ago+'</div></div>'+
      '<a href="'+mapUrl+'" target="_blank" style="font-size:11px;font-weight:700;background:var(--blue-lt);color:var(--blue);border:1px solid var(--blue);border-radius:var(--r);padding:6px 10px;text-decoration:none">'+svgIcon('🗺')+' Map</a>'+
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
    return '<button onclick="_pickVehicle(\''+v.id+'\',\''+escHtml(label)+'\')" style="display:block;width:100%;text-align:left;padding:12px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);cursor:pointer;font-family:inherit;font-size:14px;font-weight:600;margin-bottom:8px;min-height:44px">'+svgIcon('🚗')+' '+escHtml(label)+'</button>';
  }).join('');
  sheet.innerHTML=
    '<div style="font-size:15px;font-weight:800;margin-bottom:4px">Which vehicle are you in today?</div>'+
    '<div style="font-size:12px;color:var(--text3);margin-bottom:14px">Drive time is only logged for company vehicles, personal vehicle trips stay private.</div>'+
    vehList+
    '<button onclick="_pickVehicle(\'personal\',\'Personal vehicle\')" style="display:block;width:100%;text-align:left;padding:12px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);cursor:pointer;font-family:inherit;font-size:14px;font-weight:500;margin-bottom:8px;min-height:44px;color:var(--text2)">'+svgIcon('🚗')+' My personal vehicle, no mileage logged</button>'+
    '<button onclick="_pickVehicle(\'none\',\'On foot\')" style="display:block;width:100%;text-align:left;padding:12px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);cursor:pointer;font-family:inherit;font-size:14px;font-weight:500;margin-bottom:8px;min-height:44px;color:var(--text2)">'+svgIcon('🚶')+' On foot / no vehicle</button>';
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
    ?'<div style="font-size:12px;color:var(--text3);padding:6px 0">No team members yet, just you. Add someone when you hire.</div>'
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
        (e.phone?'<div style="font-size:11px;color:var(--text3);margin-top:4px">'+svgIcon('📞')+' '+escHtml(e.phone)+'</div>':'')+
        (e.email?'<div style="font-size:11px;color:var(--text3);margin-top:3px">'+svgIcon('📧')+' '+escHtml(e.email)+' <span style="font-size:9px;font-weight:700;background:#dcfce7;color:#15803d;padding:1px 5px;border-radius:6px">Invite sent</span></div>':'')+
        '<div style="font-size:10px;color:var(--text3);margin-top:4px;line-height:1.5">'+perms+'</div>'+
      '</div>';
    }).join('');
  if(el)el.innerHTML=_reqHtml+empHtml;
  if(el2)el2.innerHTML=_reqHtml+empHtml;
  const _psCard=document.getElementById('payroll-setup-card');
  if(_psCard){
    const _hasW2=emps.some(e=>e.role!=='owner');
    if(!_isEmployee&&_hasW2){_psCard.style.display='block';if(typeof renderPayrollSetupCard==='function')renderPayrollSetupCard();}
    else _psCard.style.display='none';
  }
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
          '<div style="font-size:22px">'+(d.label==='iPad'||d.label==='iPhone'?svgIcon('📱',{size:22}):svgIcon('💻',{size:22}))+'</div>'+
          '<div>'+
            '<div style="font-size:13px;font-weight:700">'+dname+(isMe?' <span style="font-size:9px;background:var(--blue);color:#fff;padding:1px 6px;border-radius:8px">This device</span>':'')+typeTag+'</div>'+
            '<div style="font-size:10px;color:'+(isActive?'var(--green-mid)':'var(--text3)')+'">'+
              (isActive?svgIcon('🟢')+' Active':svgIcon('⚪')+' Last seen '+ago)+'</div>'+
            (hasLoc?'<div style="font-size:10px;color:var(--blue);margin-top:1px">'+svgIcon('📍')+' Tap to view on map · '+locAgo+'</div>':'')+
          '</div>'+
        '</div>'+
        '<div style="display:flex;gap:6px;align-items:center">'+
          (hasLoc?'<span style="font-size:11px;font-weight:700;background:var(--blue-lt);color:var(--blue);border:1px solid var(--blue);border-radius:var(--r);padding:5px 10px;white-space:nowrap">'+svgIcon('🗺')+' Map</span>':'')+
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
  // Lazy-load standing business links once, then re-render so linked subs get
  // their "On TradeDesk" badge (mirrors the _teamCompLoaded pattern above).
  if(subEl&&subs.length&&_bizLinks===null&&!window._bizLinksKicked&&supaEnabled()&&_supaUser){
    window._bizLinksKicked=true;_loadBizLinks().then(()=>renderTeam());
  }
  // Referral earnings: lazy-load the referrer's reward ledger once, then
  // re-render so the "free months earned" card appears (mirrors the _bizLinks
  // pattern above). Only fires for signed-in accounts; card is empty until a
  // referral converts, so it's invisible for everyone who hasn't referred.
  if(subEl&&_referralRewards===null&&!window._refRewardsKicked&&supaEnabled()&&_supaUser){
    window._refRewardsKicked=true;_loadReferralRewards().then(()=>renderTeam());
  }
  if(subEl){
    const _refCard=_referralRewardCardHTML(_referralRewards||[]);
    subEl.innerHTML=_refCard+(!subs.length
      ?'<div style="font-size:12px;color:var(--text3);padding:6px 0">No subs yet. Add a subcontractor to assign them to jobs and track what you owe.</div>'
      :('<button onclick="open1099Report()" style="width:100%;margin-bottom:10px;padding:9px;border-radius:var(--r);border:1.5px solid var(--blue);background:var(--blue-lt,rgba(45,93,168,.06));color:var(--blue);font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">'+svgIcon('📋')+' 1099 payments report, who you paid, per job</button>')+
       subs.map((s,i)=>
          '<div style="padding:10px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);margin-bottom:8px">'+
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px">'+
              '<div style="display:flex;align-items:center;gap:8px">'+
                '<div style="width:34px;height:34px;border-radius:50%;background:var(--amber);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:14px;flex-shrink:0">'+(s.name||'?').charAt(0).toUpperCase()+'</div>'+
                '<div>'+
                  '<div style="font-size:13px;font-weight:700">'+escHtml(s.name||'')+'</div>'+
                  (s.trade?'<div style="font-size:11px;color:var(--text3)">'+escHtml(s.trade)+'</div>':'')+
                '</div>'+
              '</div>'+
              '<div style="display:flex;gap:6px;flex-shrink:0;align-items:center">'+
                (_bizLinkForRosterId(s.id)
                  ?'<span style="font-size:10px;font-weight:800;background:#ECFDF5;color:var(--green-mid,#0E6B39);padding:3px 9px;border-radius:10px;white-space:nowrap">'+svgIcon('🔗',{size:10})+' On TradeDesk</span>'
                  :'<button onclick="_inviteSubToTradeDesk('+i+')" style="font-size:11px;padding:4px 10px;border-radius:var(--r);border:1px solid '+(s.tdInvitedAt?'var(--border2)':'var(--blue)')+';background:none;color:'+(s.tdInvitedAt?'var(--text3)':'var(--blue)')+';cursor:pointer;font-family:inherit;font-weight:600">'+(s.tdInvitedAt?'Re-invite':'Invite to TradeDesk')+'</button>')+
                '<button onclick="openEditSubModal('+i+')" style="font-size:11px;padding:4px 10px;border-radius:var(--r);border:1px solid var(--border2);background:none;cursor:pointer;font-family:inherit">Edit</button>'+
              '</div>'+
            '</div>'+
            (s.phone?'<div style="font-size:11px;color:var(--text3);margin-top:4px">'+svgIcon('📞')+' '+escHtml(s.phone)+'</div>':'')+
            (s.rate?'<div style="font-size:11px;color:var(--text3);margin-top:2px">'+svgIcon('💰')+' '+escHtml(s.rate)+'</div>':'')+
          '</div>'
        ).join(''));
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
  zPrompt('Name this device so you can tell your iPads apart, e.g. "Front Office", "Truck 2 iPad".',name=>{
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
  if(lbl)lbl.textContent=t==='salary'?'Salary':'Rate';
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
  return '<div style="font-size:17px;font-weight:800;margin-bottom:'+(isNew?'4px':'14px')+'">'+(isNew?'Add W-2 Employee':'Edit '+escHtml(e.name||''))+'</div>'+
    (isNew?'<div style="font-size:12px;color:var(--text2);margin-bottom:14px;line-height:1.4">You control how, when, and where they work, you set the hours, direct the job, provide the tools. That\'s an employee.</div>':'')+
    '<div class="fg fg2" style="margin-bottom:12px">'+
      '<div class="f"><label>Full name</label><input id="emp-name" value="'+escHtml(e.name||'')+'" placeholder="John Smith" style="font-size:15px;padding:10px"></div>'+
      '<div class="f"><label>Phone</label><input id="emp-phone" type="tel" value="'+escHtml(e.phone||'')+'" placeholder="XXX-XXX-XXXX" maxlength="12" oninput="fmtPhone(this)" style="font-size:15px;padding:10px"></div>'+
    '</div>'+
    '<div class="f" style="margin-bottom:12px"><label>Email (for app access)</label>'+
      '<input id="emp-email" type="email" value="'+escHtml(e.email||'')+'" placeholder="employee@email.com" style="font-size:14px;padding:10px">'+
      '<div style="font-size:10px;color:var(--text3);margin-top:4px">They\'ll receive an employment agreement to sign, then get their account setup link.</div>'+
    '</div>'+
    '<div class="fg fg2" style="margin-bottom:12px">'+
      '<div class="f" style="margin:0"><label>Access role</label>'+
        '<select id="emp-role" onchange="_setEmpRolePreset(this.value)" style="font-size:14px;padding:10px">'+
          '<option value="tech"'+(_eRole==='tech'?' selected':'')+'>Field Tech</option>'+
          '<option value="office"'+(_eRole==='office'?' selected':'')+'>Office / CSR</option>'+
          '<option value="manager"'+(_eRole==='manager'?' selected':'')+'>Manager</option>'+
          '<option value="owner"'+(_eRole==='owner'?' selected':'')+'>Owner / Admin</option>'+
        '</select></div>'+
      '<div class="f" style="margin:0"><label>Classification</label>'+
        '<select id="emp-classification" style="font-size:14px;padding:10px">'+
          _EMP_CLASSIFICATIONS.map(c=>'<option value="'+escHtml(c)+'"'+(c===_eClass?' selected':'')+'>'+escHtml(c||'- None -')+'</option>').join('')+
        '</select></div>'+
    '</div>'+
    (_canViewComp()?
      '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">'+
        '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text3)">Pay</div>'+
        '<button type="button" onclick="var d=document.getElementById(\'_pay-info-tip\');d.style.display=d.style.display===\'none\'?\'block\':\'none\'" style="width:16px;height:16px;border-radius:50%;border:1px solid var(--text3);background:none;color:var(--text3);font-size:10px;font-weight:700;cursor:pointer;padding:0;font-family:inherit;line-height:16px;text-align:center;flex-shrink:0">?</button>'+
      '</div>'+
      '<div id="_pay-info-tip" style="display:none;font-size:12px;color:var(--text2);background:var(--bg2);border-radius:var(--r);padding:10px 12px;margin-bottom:10px;line-height:1.55">'+
        'Pay rates are stored securely and only visible to people with the <strong>Pay &amp; profit</strong> permission. Employees <em>never</em> see this, not in their daily view or anywhere else in the app. It\'s used to calculate loaded labor cost and profit margin on each job in the Job Profit report.'+
      '</div>'+
      '<div style="display:grid;grid-template-columns:140px 1fr;gap:10px;margin-bottom:14px">'+
        '<div class="f" style="margin:0"><label>Pay type</label>'+
          '<select id="emp-pay-type" onchange="_empPayTypeSync()" style="font-size:14px;padding:10px">'+
            '<option value="hourly"'+(_eComp.pay_type!=='salary'?' selected':'')+'>Hourly</option>'+
            '<option value="salary"'+(_eComp.pay_type==='salary'?' selected':'')+'>Salary</option>'+
          '</select></div>'+
        '<div class="f" style="margin:0"><label id="emp-pay-rate-lbl">'+(_eComp.pay_type==='salary'?'Salary':'Rate')+'</label>'+
          '<div style="display:flex;align-items:center;gap:6px"><span style="font-size:14px;color:var(--text2);font-weight:600">$</span>'+
          '<input id="emp-pay-rate" type="text" inputmode="decimal" value="'+(_eComp.pay_rate?_moneyStr(_eComp.pay_rate).replace(/\.00$/,''):'')+'" placeholder="'+(_eComp.pay_type==='salary'?'55000':'28')+'" oninput="_fmtMoneyInput(this)" style="font-size:14px;padding:10px;flex:1"></div></div>'+
      '</div>'
    :'')+
    '<div onclick="_togglePermsAccordion(this)" style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none;padding:10px 0;margin-bottom:2px">'+
      '<span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text3)">Permissions'+
        ((e.permissions?Object.values(e.permissions).filter(Boolean).length:0)?' · '+Object.values(e.permissions).filter(Boolean).length+' on':'')+'</span>'+
      '<span class="perms-chev" style="font-size:11px;color:var(--text3);transition:transform .18s cubic-bezier(.22,1,.36,1)">'+svgIcon('▶',{size:11})+'</span>'+
    '</div>'+
    '<div class="perms-acc" style="max-height:0;overflow:hidden;transition:max-height .2s cubic-bezier(.22,1,.36,1)">'+
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
  const _payRate=_canComp?_moneyVal('emp-pay-rate'):null;
  const emp={id:_empId,name,email,role:_empRole,classification:_empClass,phone:_empPhone,permissions:perms};
  if(!S.employees)S.employees=[];
  // Captured before the push so it reflects the roster as it was walking in,
  // picks the prompt's framing: first-ever hire gets full business setup,
  // every later hire leads with that person's own W-4/I-9/new-hire paperwork.
  const _priorNonOwnerCount=S.employees.filter(e=>e.role!=='owner').length;
  if(!isNew)S.employees[idx]=emp;else S.employees.push(emp);
  _settingsChanged();document.getElementById('emp-modal-overlay')?.remove();renderTeam();
  if(isNew&&_empRole!=='owner'&&typeof _showPayrollSetupPrompt==='function')_showPayrollSetupPrompt(_empId,_priorNonOwnerCount===0);
  // Sync to Supabase team_members and send invite if email provided
  if(email&&_supa&&_supaUser){
    // permissions MUST ride along: has_team_perm() and the load_account_data RPC
    // read team_members.permissions server-side. Without this the column stays
    // '{}' forever, so every employee perm reads false, locking employees out of
    // everything (a collect tech wouldn't even see payment amounts). This is the
    // authoritative write the owner's permission checkboxes depend on.
    const tmRow={contractor_user_id:_supaUser.id,email,name,role:emp.role,permissions:emp.permissions||{},active:false,invited_at:new Date().toISOString()};
    // Pay is written ONLY when the editor can view comp, otherwise the columns are
    // omitted from the upsert so existing pay_rate is preserved, never clobbered to 0.
    if(_canComp){tmRow.pay_type=_payType;tmRow.pay_rate=_payRate;_teamComp[email]={pay_type:_payType,pay_rate:_payRate};}
    const{error}=await _supa.from('team_members').upsert(tmRow,{onConflict:'contractor_user_id,email'});
    if(error){console.warn('team_members upsert failed:',error);return;}
    // Auto-create employment agreement; signing IS the onboarding step
    if(isNew){
      const cid=_supaUser.id;
      const _tok2=await _mintCrewInviteToken(cid,emp.email); // server-verified claim token (null → legacy email-match link)
      const inviteUrl=window.location.origin+window.location.pathname+'?emp_invite='+btoa(JSON.stringify({cid,eid:emp.id,email:emp.email||'',bname:S.bname||'',ename:emp.name||'',tok:_tok2||undefined}));
      const{data:{session:_saveSess}}=await _supa.auth.getSession();
      const _saveToken=_saveSess?.access_token;
      // Build the signing link, embed inviteUrl in the contract snapshot so
      // contract-sign.html shows "Set up your account" after the employee signs.
      let signUrl=inviteUrl; // fallback: direct link if agreements feature unavailable
      if(typeof _agEmploymentBody==='function'){
        try{
          const agId=Date.now()+1;
          const agToken=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
          const agKey='agreements/'+cid+'/'+agId+'_'+agToken+'.json';
          const agRecord={id:agId,type:'employment',party:emp.name,
            title:'Employment Agreement, '+emp.name,body:_agEmploymentBody(emp.name),
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
          else showToast('Saved: email failed','⚠️');
        }catch(_e){showToast('Saved: email failed','⚠️');}
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
  const s=sub||{name:'',trade:'',phone:'',email:'',rate:'',ein:'',addr:'',w9:false};
  return '<div style="font-size:17px;font-weight:800;margin-bottom:'+(isNew?'4px':'14px')+'">'+(isNew?'Add 1099 Sub Contractor':'Edit '+escHtml(s.name||'Sub'))+'</div>'+
    (isNew?'<div style="font-size:12px;color:var(--text2);margin-bottom:12px;line-height:1.4">They run their own business, their own schedule, their own tools, their own insurance. You\'re paying a business, not directing an employee.</div>'+
    '<div style="background:#FFF8F0;border:1px solid var(--amber);border-radius:var(--r);padding:10px 12px;margin-bottom:14px;font-size:12px;color:#7A4A00;line-height:1.5">'+
      '<strong>Misclassifying an employee as a 1099 is one of the most audited issues at the IRS and state labor boards</strong>, back taxes, penalties up to 100% of what you owed, and the owner held personally liable. The test: do you control how/when/where they work? Do they carry their own insurance and business risk? If you\'re supervising them like staff, they\'re staff, not a 1099. Not sure? Ask your accountant before you guess wrong.'+
    '</div>':'')+
    '<div class="fg fg2" style="margin-bottom:12px">'+
      '<div class="f"><label>Full name</label><input id="sub-name" value="'+escHtml(s.name||'')+'" placeholder="Mike Garcia" style="font-size:15px;padding:10px"></div>'+
      '<div class="f"><label>Trade</label><input id="sub-trade" value="'+escHtml(s.trade||'')+'" placeholder="Drywall, Electrical, Plumbing..." style="font-size:14px;padding:10px"></div>'+
    '</div>'+
    '<div class="fg fg2" style="margin-bottom:12px">'+
      '<div class="f"><label>Phone</label><input id="sub-phone" type="tel" value="'+escHtml(s.phone||'')+'" placeholder="XXX-XXX-XXXX" maxlength="12" oninput="fmtPhone(this)" style="font-size:15px;padding:10px"></div>'+
      '<div class="f"><label>Email</label><input id="sub-email" type="email" value="'+escHtml(s.email||'')+'" placeholder="sub@email.com" style="font-size:14px;padding:10px"></div>'+
    '</div>'+
    '<div class="f" style="margin-bottom:12px"><label>Rate / notes</label>'+
      '<input id="sub-rate" value="'+escHtml(s.rate||'')+'" placeholder="e.g. $45/hr or $800 per room" style="font-size:14px;padding:10px">'+
    '</div>'+
    '<div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:10px;margin-bottom:16px">'+
      '<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:8px">1099-NEC filing info <span style="font-weight:400;text-transform:none;letter-spacing:0">(needed if you pay them $600+/yr)</span></div>'+
      '<div class="fg fg2" style="margin-bottom:8px">'+
        '<div class="f"><label>EIN or SSN</label><input id="sub-ein" value="'+escHtml(s.ein||'')+'" placeholder="XX-XXXXXXX" style="font-size:14px;padding:10px"></div>'+
        '<div class="f" style="display:flex;align-items:flex-end;padding-bottom:2px"><label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;text-transform:none;letter-spacing:0"><input type="checkbox" id="sub-w9" '+(s.w9?'checked':'')+' style="width:16px;height:16px;accent-color:var(--blue)"> W-9 on file</label></div>'+
      '</div>'+
      '<div class="f"><label>Mailing address</label><input id="sub-addr" value="'+escHtml(s.addr||'')+'" placeholder="Street, City, ST ZIP" style="font-size:13px;padding:10px"></div>'+
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
  const _subEin=(document.getElementById('sub-ein')?.value||'').trim();
  const _subAddr=(document.getElementById('sub-addr')?.value||'').trim();
  const _subW9=!!document.getElementById('sub-w9')?.checked;
  const sub={id:_subId,name,trade:_subTrade,phone:_subPhone,email:_subEmail,rate:_subRate,ein:_subEin,addr:_subAddr,w9:_subW9};
  if(!S.subcontractors)S.subcontractors=[];
  if(idx==null)S.subcontractors.push(sub);else S.subcontractors[idx]=sub;
  _settingsChanged();document.getElementById('_sub-modal-ov')?.remove();renderTeam();
  showToast(idx==null?'Subcontractor added':'Saved','✓');
  // The invite moment: a brand-new sub with a phone or email is a warm
  // referral: they run a trade business too. One tap sends it: email goes
  // out behind the scenes (CAN-SPAM-guarded server-side); phone opens their
  // own texting app (TCPA: the contractor must be the one who hits send).
  if(idx==null&&(sub.phone||sub.email)&&typeof zConfirm==='function'){
    const _first=(sub.name||'').split(/\s+/)[0]||'They';
    zConfirm('You already trust '+_first+' on your jobs, set them up with the same tools you run on, free for them. They start with a head start: everything you\'ve paid them is already on their books, so it feels like home from day one. And it stays your world, your clients and numbers never cross over.\n\nRefer businesses that stick with TradeDesk and earn free months.',
      ()=>_inviteSubToTradeDesk(S.subcontractors.length-1),
      {title:'Set '+_first+' up on TradeDesk?',yes:(sub.email?'Email':'Text')+' '+_first+' the invite',no:'Maybe later',danger:false});
  }
}
function _removeSub(idx){
  if(!S.subcontractors)return;
  S.subcontractors.splice(idx,1);
  _settingsChanged();document.getElementById('_sub-modal-ov')?.remove();renderTeam();
}

// ── Invite a sub to get their OWN TradeDesk account ──────────────────────────
// The growth loop: every 1099 sub is itself a trade business, the exact
// customer TradeDesk is for. This is NOT the employee invite (?emp_invite=,
// which links a crew login into THIS account); the sub gets a referral link
// to create a completely separate account of their own.
function _subInviteLink(sub,grantToken){
  const payload={bn:S.bname||'',n:(sub&&sub.name)||'',t:(sub&&sub.trade)||''};
  return window.location.origin+window.location.pathname+'?sub_invite='+btoa(JSON.stringify(payload))+(grantToken?'&grant='+grantToken:'');
}
// Navigation isolated so tests can stub it without triggering a real sms: intent.
function _subInviteNavigate(href){window.location.href=href;}
function _subInviteMsg(sub,link){
  const first=(sub&&sub.name?sub.name:'').split(/\s+/)[0];
  return 'Hey'+(first?' '+first:'')+', I run my business on TradeDesk (estimates, invoices, getting paid, all of it). Figured you\'d want it for yours too. Free to set up: '+(link||_subInviteLink(sub));
}
function _subInviteSms(sub,link){
  _subInviteNavigate('sms:'+String(sub.phone||'').replace(/\D/g,'')+'&body='+encodeURIComponent(_subInviteMsg(sub,link)));
}
// Everything this contractor has logged as paid to ONE sub, across all years,
// the same two sources as _sub1099Report (sub-category expenses + legacy
// job.subs[] paid rows, deduped by subPayKey), matched by subId or vendor name.
function _subPaymentHistory(sub){
  if(!sub)return[];
  const rows=[];
  const _addr=(bidId,clientId)=>{
    const b=bidId?bids.find(x=>x.id===bidId):null;
    if(b&&b.addr)return b.addr;
    const c=getClientById(clientId||(b&&b.client_id));
    return (c&&c.addr)||'';
  };
  const nameMatch=v=>!!(v&&sub.name&&String(v).toLowerCase()===String(sub.name).toLowerCase());
  // What crosses to the sub is deliberately tight: date + amount + job
  // ADDRESS only (the address keeps their mileage records accurate). Never
  // job names/descriptions: those can carry the GC's client details.
  expenses.filter(e=>_isSubExpense(e)&&((sub.id&&e.subId===sub.id)||(!e.subId&&nameMatch(e.vendor)))).forEach(e=>{
    rows.push({date:e.date||'',amount:e.amount||0,addr:_addr(e.job_id,e.client_id)});
  });
  jobs.forEach(j=>{
    (j.subs||[]).forEach((sp,i)=>{
      if(!sp.paid||!sp.paidDate)return;
      if(expenses.some(e=>e.subPayKey===j.id+':'+i))return;
      if(!((sub.id&&sp.subId===sub.id)||nameMatch(sp.subName)))return;
      rows.push({date:sp.paidDate,amount:sp.amount||0,addr:_addr(j.bid_id,j.client_id)});
    });
  });
  rows.sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  return rows.slice(-500); // cap: newest 500 rows, keeps the grant payload sane
}
// Server-side snapshot for the invite: the inviter's business card + payment
// history with this sub, stored under a random single-use token (the LINK
// carries only the token, see sub_invite_grants migration). Returns the
// token, or null offline/on failure, the invite still goes out either way,
// just without the pre-loaded books.
async function _createSubInviteGrant(sub){
  if(!sub||typeof supaEnabled!=='function'||!supaEnabled()||!_supaUser)return null;
  try{
    const token=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
    const payload={v:1,
      business:{name:S.bname||'',phone:S.bphone||'',email:S.bemail||'',addr:[S.baddr,S.bcity,S.state,S.bzip].filter(Boolean).join(', ')},
      payments:_subPaymentHistory(sub),
      // rosterId lets redemption tie the standing business link back to THIS
      // roster row, so future payments the GC logs to it can flow as offers.
      sub:{name:sub.name||'',trade:sub.trade||'',rosterId:String(sub.id||'')}};
    if(!payload.business.name)return null; // nothing to seed a lead from
    const{error}=await _supa.from('sub_invite_grants').insert({token,contractor_user_id:_supaUser.id,payload});
    return error?null:token;
  }catch(_e){return null;}
}
// Post-signup redemption (called from obSubmit): single-use RPC returns the
// snapshot, which seeds the brand-new account, inviter as first client/lead,
// payments as the opening income ledger.
async function _redeemSubInviteGrant(){
  const token=localStorage.getItem('_pendingSubInviteGrant');
  if(!token)return false;
  localStorage.removeItem('_pendingSubInviteGrant'); // one attempt, never re-fires
  if(typeof supaEnabled!=='function'||!supaEnabled()||!_supaUser)return false;
  try{
    // p_sub_business: the sub's just-entered business name, stored on the
    // standing business_links row the RPC forges alongside the redemption.
    const{data,error}=await _supa.rpc('redeem_sub_invite_grant',{p_token:token,p_sub_business:S.bname||''});
    if(error||!data)return false;
    return _seedFromSubInviteGrant(data);
  }catch(_e){return false;}
}
function _seedFromSubInviteGrant(g){
  if(!g||!g.business||!g.business.name)return false;
  const cid=Date.now();
  // gcLinkId: the redemption RPC stamps the inviter's account id into the
  // payload: the live pipe uses it as the payer card's stable identity
  // (survives renames, never merges two same-name GCs).
  clients.push({id:cid,name:g.business.name,phone:g.business.phone||'',email:g.business.email||'',
    addr:g.business.addr||'',created:new Date().toISOString(),
    notes:'Invited you to TradeDesk, imported automatically',
    extraAddresses:[],clientToken:'',clientHubKey:'',gcLinkId:String(g.gcUserId||'')});
  // .slice defends the RECEIVING account too, a tampered payload can't dump
  // thousands of rows into a brand-new sub's books (creation caps at 500).
  (Array.isArray(g.payments)?g.payments.slice(0,500):[]).forEach((p,i)=>{
    if(!p||!(Number(p.amount)>0))return;
    income.push({id:cid+i+1,bid_id:null,client_id:cid,client_name:g.business.name,
      date:String(p.date||'').replace(/-/g,'').slice(0,8),type:'Job payment',amount:Number(p.amount),
      method:'',notes:('Imported from '+g.business.name+(p.addr?', job @ '+p.addr:'')).slice(0,200),
      created_at:new Date().toISOString()});
  });
  return true;
}
// Existing-account redemption: a contractor who ALREADY runs TradeDesk arrived
// via a sub-invite link and signed in (the "I already use TradeDesk" path):
// never onboarded, so obSubmit's _redeemSubInviteGrant never fired. We still
// want the standing link forged and the inviter's reward accrued (both happen
// server-side in the RPC), and the payer card created so live-pipe payments
// have a home. The one difference from a brand-new account: we OFFER the
// payment-history import instead of force-seeding it, this account already has
// its own books, and silently dumping months of income into them would be
// alarming, not warm. Called from the SIGNED_IN handler after the account load.
async function _redeemSubInviteGrantForExisting(){
  const token=localStorage.getItem('_pendingSubInviteGrant');
  if(!token)return false;
  localStorage.removeItem('_pendingSubInviteGrant'); // one attempt, never re-fires
  if(typeof supaEnabled!=='function'||!supaEnabled()||!_supaUser)return false;
  try{
    const{data,error}=await _supa.rpc('redeem_sub_invite_grant',{p_token:token,p_sub_business:S.bname||''});
    if(error||!data||!data.business||!data.business.name)return false;
    // Link forged + referrer reward accrued server-side. Ensure the payer card
    // exists (keyed on the inviter's account id, rename-proof) so future
    // payments/assignments from them land on one clean card.
    const gcUid=String(data.gcUserId||'');
    const c=_pipePayerClient(data.business.name,gcUid);
    if(c){
      if(!c.phone&&data.business.phone)c.phone=data.business.phone;
      if(!c.email&&data.business.email)c.email=data.business.email;
      if(!c.addr&&data.business.addr)c.addr=data.business.addr;
    }
    saveAll();
    if(typeof renderTeam==='function')renderTeam();
    const pays=(Array.isArray(data.payments)?data.payments:[]).filter(p=>p&&Number(p.amount)>0).slice(0,500);
    const bn=data.business.name;
    if(pays.length&&c&&typeof zConfirm==='function'){
      const tot=pays.reduce((s,p)=>s+Number(p.amount),0);
      const totStr=(typeof fmt==='function')?fmt(tot):('$'+tot);
      // OFFER: never force. escHtml the business name: zConfirm renders via innerHTML.
      zConfirm('You\'re linked with '+escHtml(bn)+', anything they pay you now lands here on its own.\n\nThey\'ve already paid you '+totStr+' across '+pays.length+' job'+(pays.length!==1?'s':'')+'. Want that added to your income too? Skip it if it\'s already on your books.',
        ()=>_importPipeHistory(bn,c.id,pays),
        {title:'Add your history with '+bn+'?',yes:'Add '+totStr+' to my books',no:'No, just link us',danger:false});
    }else{
      showToast('Linked with '+escHtml(bn)+', their payments now land here automatically','🔗');
    }
    return true;
  }catch(_e){return false;}
}
// Import the offered payment history onto an EXISTING account, tied to the
// linked GC's payer card. Collision-proof ids (an established account already
// has income rows). Same tight scope as the seed path: amount + date + address.
function _importPipeHistory(bizName,clientId,pays){
  if(!Array.isArray(pays)||!pays.length)return;
  let base=Date.now();
  pays.forEach(p=>{
    if(!p||!(Number(p.amount)>0))return;
    let id=base++;while(income.some(x=>x&&x.id===id))id++;
    income.push({id,bid_id:null,client_id:clientId,client_name:bizName,
      date:String(p.date||'').replace(/-/g,'').slice(0,8),type:'Job payment',amount:Number(p.amount),
      method:'',notes:('Imported from '+bizName+(p.addr?', job @ '+p.addr:'')).slice(0,200),
      created_at:new Date().toISOString()});
  });
  saveAll();
  if(typeof renderTrackerTab==='function')renderTrackerTab();
  if(typeof renderDash==='function')renderDash();
  showToast(pays.length+' payment'+(pays.length!==1?'s':'')+' from '+escHtml(bizName)+' added to your books','💵');
}
// Fires the invite email behind the scenes via the send-sub-invite-email edge
// function (Resend). Server enforces the CAN-SPAM guardrails: suppression
// list, postal-address footer, unsubscribe link, max 3 sends 7 days apart.
async function _sendSubInviteEmail(sub,link){
  if(!sub||!sub.email)return{ok:false,reason:'no-email'};
  if(typeof supaEnabled!=='function'||!supaEnabled()||!_supaUser)return{ok:false,reason:'offline'};
  try{
    const{data:{session}}=await _supa.auth.getSession();
    const token=session?.access_token;
    if(!token)return{ok:false,reason:'no-session'};
    const res=await fetch(SUPA_URL+'/functions/v1/send-sub-invite-email',{
      method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify({
        to:sub.email,subName:sub.name||'',businessName:S.bname||'',trade:sub.trade||'',
        inviteUrl:link||_subInviteLink(sub),replyTo:S.bemail||undefined,
        postalAddress:[S.baddr,S.bcity,S.state,S.bzip].filter(Boolean).join(', ')||undefined
      })
    });
    const data=await res.json().catch(()=>({}));
    if(res.ok&&data.suppressed)return{ok:false,reason:'suppressed'};
    return res.ok?{ok:true,id:data.id}:{ok:false,reason:data.error||('http-'+res.status)};
  }catch(_e){return{ok:false,reason:'network'};}
}
async function _inviteSubToTradeDesk(idx){
  const sub=(S.subcontractors||[])[idx];
  if(!sub)return;
  sub.tdInvitedAt=new Date().toISOString();
  _settingsChanged();renderTeam();
  const first=(sub.name||'').split(/\s+/)[0]||'them';
  // Snapshot grant first: the link then carries a token that pre-loads the
  // sub's new account (this business as their first lead + payment history).
  // Offline or on failure the invite still goes out, just without the seed.
  let _grantTok=null;
  try{_grantTok=await _createSubInviteGrant(sub);}catch(_e){}
  const link=_subInviteLink(sub,_grantTok);
  // Email on file → fire it behind the scenes. LEGAL LINE (researched, FCC
  // 2015 Glide/TextMe rulings): auto-sending EMAIL is CAN-SPAM-compliant with
  // the server's guardrails, but auto-sending the TEXT would make TradeDesk
  // the TCPA "initiator" of a marketing text with no recipient consent
  // ($500-$1,500 per text, private right of action). Texts therefore stay
  // person-to-person from the contractor's own phone, permanently.
  if(sub.email){
    showToast('Emailing '+first+' their invite…','📧');
    const r=await _sendSubInviteEmail(sub,link);
    if(r.ok)showToast('Invite emailed to '+first+' ✓','📧');
    else if(r.reason==='suppressed')showToast(first+' has unsubscribed from TradeDesk invites'+(sub.phone?', text them instead':''),'⚠️');
    else if(r.reason==='recently-invited'||r.reason==='send-limit-reached')showToast('Already invited recently, give it a few days','📧');
    else if(sub.phone)_subInviteSms(sub,link); // email failed → fall back to a person-to-person text
    else showToast('Email didn\'t go through, try again in a bit','⚠️');
    return;
  }
  if(sub.phone){_subInviteSms(sub,link);return;}
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(_subInviteMsg(sub,link)).then(()=>showToast('Invite copied, paste it anywhere','🔗')).catch(()=>showToast('Couldn\'t copy the invite','⚠️'));
  }else showToast('Add a phone or email to send the invite','⚠️');
}
// Referral attribution, called by obSubmit (settings.js) right after account
// creation: records who brought this signup in, then clears the stash so a
// later re-signup on the same device can't double-claim it.
function _claimSubReferralAttribution(){
  try{
    const _si=JSON.parse(localStorage.getItem('_pendingSubInvite')||'null');
    if(!_si)return false;
    S.referredBy={bname:_si.bn||'',via:'sub_invite',at:new Date().toISOString()};
    localStorage.removeItem('_pendingSubInvite');
    return true;
  }catch(_e){return false;}
}

// ── The live pipe: business links + accept-model payment offers ──────────────
// A standing link between a GC account and a sub account (forged server-side
// at grant redemption, see redeem_sub_invite_grant). Payments the GC logs to
// a linked sub become OFFERS: a card the sub explicitly accepts into their
// own books. The GC never writes into the sub's ledger, ownership stays
// clean, same one-way principle as mailing a check.
// Referral rewards (the referrer's side of the growth loop): every sub who
// signs up through your invite earns YOU a reward, accrued server-side at the
// verified conversion (grant redemption, see redeem_sub_invite_grant). Default
// today is one free month, applied when subscription billing launches. This is
// read-only on the client, the app never writes rewards, only shows them.
let _referralRewards=null; // null = not loaded; [] = loaded, none
async function _loadReferralRewards(force){
  if(_referralRewards!==null&&!force)return _referralRewards;
  if(typeof supaEnabled!=='function'||!supaEnabled()||!_supaUser){_referralRewards=[];return _referralRewards;}
  try{
    const{data,error}=await _supa.from('referral_rewards').select('*')
      .eq('referrer_user_id',_supaUser.id).order('created_at',{ascending:false});
    _referralRewards=error?[]:(data||[]);
  }catch(_e){_referralRewards=[];}
  return _referralRewards;
}
// Loyalty ratio: how many referred contractors who go paid earn one free month.
// Owner decision 2026-07-13: 2-for-1 (a signup alone isn't a free month, it's a
// free month once two of them actually stick and start paying). Change here only;
// the DB just records one row per verified signup, the math lives in the app.
const REFERRALS_PER_FREE_MONTH=2;
// Pure renderer for the referral-earnings card on the Team page. Empty string
// until at least one referral has converted, so it costs nothing for accounts
// that haven't referred anyone. Each reward row = one contractor who signed up
// off this account's invite; every REFERRALS_PER_FREE_MONTH of them = 1 free
// month, always shown with live progress toward the next one so the rule reads
// plainly on the card.
function _referralRewardCardHTML(rewards){
  if(!Array.isArray(rewards)||!rewards.length)return'';
  const active=rewards.filter(r=>r&&r.status!=='void');
  const total=active.length;
  if(!total)return'';
  const per=REFERRALS_PER_FREE_MONTH;
  const months=Math.floor(total/per);   // free months earned so far
  const toward=total%per;               // referrals sitting toward the NEXT month
  const need=per-toward;                // how many more to earn the next month
  const names=active.map(r=>escHtml(r.referred_business_name||'A contractor')).slice(0,3).join(', ');
  const more=total>3?' +'+(total-3)+' more':'';
  const headline=months>0
    ?months+' free month'+(months!==1?'s':'')+' earned'
    :total+' referral'+(total!==1?'s':'')+', '+need+' more to a free month';
  const progress=toward>0
    ?need+' more paid referral'+(need!==1?'s':'')+' earns '+(months>0?'another':'your first')+' free month.'
    :'Every '+per+' contractors you refer who go paid = 1 free month.';
  return '<div style="background:#ECFDF5;border:1.5px solid var(--green-mid,#0E6B39);border-radius:var(--r);padding:12px;margin-bottom:10px">'+
    '<div style="font-size:13px;font-weight:800;color:var(--green-mid,#0E6B39);margin-bottom:3px">'+svgIcon('🎁',{size:13})+' '+headline+'</div>'+
    '<div style="font-size:11px;color:var(--text2);line-height:1.5">'+
      total+' contractor'+(total!==1?'s you invited have':' you invited has')+' signed up ('+names+more+'). '+
      progress+' Credit applies automatically once TradeDesk billing starts.'+
    '</div>'+
  '</div>';
}
let _bizLinks=null; // null = not loaded yet; [] = loaded, none
async function _loadBizLinks(force){
  if(_bizLinks!==null&&!force)return _bizLinks;
  if(typeof supaEnabled!=='function'||!supaEnabled()||!_supaUser){_bizLinks=[];return _bizLinks;}
  try{
    const{data,error}=await _supa.from('business_links').select('*')
      .or('gc_user_id.eq.'+_supaUser.id+',sub_user_id.eq.'+_supaUser.id);
    _bizLinks=error?[]:(data||[]);
  }catch(_e){_bizLinks=[];}
  return _bizLinks;
}
// The link (if any) for a sub ROSTER row in this GC's account, matched by
// roster id, never by name, so renames can't cross-wire two subs.
function _bizLinkForRosterId(rosterId){
  if(!Array.isArray(_bizLinks)||rosterId==null)return null;
  const me=_supaUser?String(_supaUser.id):'';
  return _bizLinks.find(l=>String(l.gc_user_id)===me&&String(l.sub_roster_id)===String(rosterId))||null;
}
// GC side: fire-and-forget offer to a linked sub. No link → silent no-op
// (the payment is still fully logged locally either way).
async function _offerPaymentToLinkedSub(rosterId,pay){
  try{
    if(!pay||!(Number(pay.amount)>0))return false;
    if(typeof supaEnabled!=='function'||!supaEnabled()||!_supaUser)return false;
    await _loadBizLinks();
    const link=_bizLinkForRosterId(rosterId);
    if(!link)return false;
    // Tight scope, enforced here AND by the table (no other columns exist):
    // amount + date + job ADDRESS. Never job names/descriptions.
    const{error}=await _supa.from('payment_offers').insert({
      gc_user_id:_supaUser.id,sub_user_id:link.sub_user_id,
      amount:Number(pay.amount),paid_date:String(pay.date||'').slice(0,10),
      job_addr:String(pay.addr||'').slice(0,200),
      gc_business_name:String(S.bname||link.gc_business_name||'').slice(0,120)
    });
    // escHtml: showToast renders via innerHTML and the sub controls their
    // business name, cross-ACCOUNT strings never enter the DOM raw.
    if(!error)showToast('Payment lands in '+escHtml(link.sub_business_name||'their')+' TradeDesk books automatically','🔗');
    return !error;
  }catch(_e){return false;}
}
// GC side: assigning a linked sub to a job shares the job ADDRESS + start
// date: the moment the sub actually needs it (mileage, routing). Same tight
// scope as payments: no job names, no descriptions, no client details.
async function _offerJobToLinkedSub(rosterId,info){
  try{
    if(!info||!String(info.addr||'').trim())return false;
    if(typeof supaEnabled!=='function'||!supaEnabled()||!_supaUser)return false;
    await _loadBizLinks();
    const link=_bizLinkForRosterId(rosterId);
    if(!link)return false;
    const{error}=await _supa.from('job_assignments').insert({
      gc_user_id:_supaUser.id,sub_user_id:link.sub_user_id,
      job_addr:String(info.addr||'').slice(0,200),start_date:String(info.date||'').slice(0,10),
      gc_business_name:String(S.bname||link.gc_business_name||'').slice(0,120)
    });
    if(!error)showToast('Job address sent to '+escHtml(link.sub_business_name||'their')+' TradeDesk calendar','🔗');
    return !error;
  }catch(_e){return false;}
}

// ── The REVERSE pipe: the sub bids their piece back to the GC ─────────────────
// GC→sub hands over an address (job_assignments). This is the sub pricing that
// work as an independent business and sending the number back for the GC to
// approve: the round-trip that makes the relationship a vendor relationship,
// not a disguised-employee one. Scope that crosses: amount + scope + address.
// The sub's line-item costs, margins, other clients never leave their account.

// The sub's standing link to a specific GC, matched by the GC's ACCOUNT id
// (the payer card's gcLinkId), never by name, so two same-name GCs can't cross.
function _linkForGcUid(gcUid){
  if(!Array.isArray(_bizLinks)||!gcUid)return null;
  const me=_supaUser?String(_supaUser.id):'';
  return _bizLinks.find(l=>String(l.gc_user_id)===String(gcUid)&&String(l.sub_user_id)===me)||null;
}
// Sub side: send a priced bid to a linked GC. No link → silent no-op (the bid
// is meaningless without the standing relationship, and RLS would reject it).
async function _sendBidToGC(info){
  try{
    if(!info)return false;
    const gcUid=String(info.gcUid||'');
    const amount=Number(info.amount);
    if(!gcUid||!(amount>=0))return false;
    if(typeof supaEnabled!=='function'||!supaEnabled()||!_supaUser)return false;
    await _loadBizLinks();
    const link=_linkForGcUid(gcUid);
    if(!link)return false;
    const{error}=await _supa.from('sub_bids').insert({
      sub_user_id:_supaUser.id,gc_user_id:link.gc_user_id,
      job_addr:String(info.addr||'').slice(0,200),
      amount:amount,
      scope:String(info.scope||'').slice(0,2000),
      line_count:Math.max(0,Math.min(9999,Number(info.lineCount)||0)),
      sub_business_name:String(S.bname||link.sub_business_name||'').slice(0,120)
    });
    // escHtml: showToast renders via innerHTML and the GC name is cross-account.
    if(!error)showToast('Bid sent to '+escHtml(link.gc_business_name||'the GC')+' for approval','📤');
    return !error;
  }catch(_e){return false;}
}
// GC side: the bids sent TO me. null = not loaded; [] = loaded, none.
let _subBids=null;
async function _loadSubBids(force){
  if(_subBids!==null&&!force)return _subBids;
  if(typeof supaEnabled!=='function'||!supaEnabled()||!_supaUser){_subBids=[];return _subBids;}
  try{
    const{data,error}=await _supa.from('sub_bids').select('*')
      .eq('gc_user_id',_supaUser.id).order('created_at',{ascending:false});
    _subBids=error?[]:(data||[]);
  }catch(_e){_subBids=[];}
  return _subBids;
}
// GC side: DECLINE an open bid (no signature needed to say no).
async function _declineSubBid(id){
  try{
    if(typeof supaEnabled!=='function'||!supaEnabled()||!_supaUser)return false;
    const{error}=await _supa.from('sub_bids')
      .update({status:'declined',decided_at:new Date().toISOString()})
      .eq('id',id).eq('gc_user_id',_supaUser.id).eq('status','pending');
    if(error)return false;
    const b=(_subBids||[]).find(x=>String(x.id)===String(id));
    if(b)b.status='declined';
    if(typeof renderDash==='function')renderDash();
    showToast('Bid declined','✓');
    return true;
  }catch(_e){return false;}
}
// GC side: SIGN an open bid, the GC e-signs the sub's full scope + price. This
// is the protective artifact: signed_name + signed_at recorded on an immutable
// amount/scope, so the sub holds documented proof the GC agreed to pay it. On
// signing, the agreed price is stamped onto the GC's matching job (by address)
// so the signature literally becomes the agreed amount on that job.
async function _signSubBid(id,signerName){
  try{
    if(typeof supaEnabled!=='function'||!supaEnabled()||!_supaUser)return false;
    const name=String(signerName||'').trim().slice(0,120);
    if(!name)return false;
    const now=new Date().toISOString();
    const{error}=await _supa.from('sub_bids')
      .update({status:'approved',signed_name:name,signed_at:now,decided_at:now})
      .eq('id',id).eq('gc_user_id',_supaUser.id).eq('status','pending');
    if(error)return false;
    const b=(_subBids||[]).find(x=>String(x.id)===String(id));
    if(b){b.status='approved';b.signed_name=name;b.signed_at=now;
      const job=(jobs||[]).find(j=>j&&j.addr&&String(j.addr)===String(b.job_addr||''));
      if(job){job.subBidAmount=Number(b.amount)||0;job.subBidBy=String(b.sub_business_name||'');job.subBidSignedBy=name;saveAll();}
    }
    if(typeof renderDash==='function')renderDash();
    showToast('Signed: '+escHtml((b&&b.sub_business_name)||'the sub')+' is cleared to start','✍️');
    return true;
  }catch(_e){return false;}
}
// GC side: the review-and-sign sheet. Shows the FULL scope + price + address,
// then captures the GC's typed signature. Not a one-tap approve, the signature
// on the full scope is what protects the sub.
function _openBidReview(id){
  const b=(_subBids||[]).find(x=>String(x.id)===String(id));
  if(!b)return;
  const who=escHtml(b.sub_business_name||'A linked sub');
  const addr=escHtml(b.job_addr||'');
  const amt=(typeof fmt==='function')?fmt(Number(b.amount)||0):('$'+(Number(b.amount)||0));
  const scope=escHtml(b.scope||'').replace(/\n/g,'<br>');
  document.querySelectorAll('.zmodal-overlay').forEach(e=>e.remove());
  const overlay=document.createElement('div');overlay.className='zmodal-overlay';
  const boxEl=document.createElement('div');boxEl.className='zmodal';
  boxEl.innerHTML=
    '<div style="font-size:17px;font-weight:800;margin-bottom:2px">'+svgIcon('📥')+' Bid from '+who+'</div>'+
    (addr?'<div style="display:flex;gap:6px;align-items:center;font-size:12px;color:var(--text3);margin-bottom:12px">'+svgIcon('📍',{size:13})+addr+'</div>':'<div style="height:8px"></div>')+
    '<div style="background:var(--bg2);border:1px solid var(--border2);border-radius:var(--r);padding:12px;margin-bottom:12px">'+
      '<div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px">Full scope</div>'+
      '<div style="font-size:13px;color:var(--text);line-height:1.5">'+(scope||'<span style="color:var(--text3)">No scope note provided</span>')+'</div>'+
      '<div style="border-top:1px solid var(--border2);margin-top:10px;padding-top:8px;display:flex;justify-content:space-between;align-items:center"><span style="font-size:12px;color:var(--text3)">Their price</span><span style="font-size:20px;font-weight:800">'+amt+'</span></div>'+
    '</div>'+
    '<div style="font-size:11px;color:var(--text3);line-height:1.4;margin-bottom:8px">Signing records your name + the date against this scope and price, your written OK that '+who+' can start and be paid '+amt+' for it.</div>'+
    '<div class="f" style="margin-bottom:14px"><label style="font-size:11px;font-weight:700;color:var(--text3)">Type your name to sign</label>'+
      '<input type="text" id="bid-sign-name" placeholder="Your full name" autocomplete="name" style="font-size:15px;padding:11px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);width:100%;box-sizing:border-box;color:var(--text);font-family:inherit"></div>'+
    '<div id="bid-sign-err" style="display:none;font-size:11px;color:#A32D2D;margin-bottom:8px"></div>'+
    '<div style="display:flex;flex-wrap:wrap;gap:8px">'+
      '<button onclick="_declineSubBid('+Number(b.id)+');closeTopModal()" style="flex:1;min-width:120px;padding:12px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);font-size:14px;font-weight:600;cursor:pointer;font-family:inherit">Decline</button>'+
      '<button onclick="_submitBidSignature('+Number(b.id)+')" style="flex:1.4;min-width:150px;padding:12px;border-radius:var(--r);border:none;background:var(--green);color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit">Sign &amp; approve '+amt+'</button>'+
    '</div>';
  overlay.appendChild(boxEl);document.body.appendChild(overlay);
  overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});
  setTimeout(()=>document.getElementById('bid-sign-name')?.focus(),60);
}
async function _submitBidSignature(id){
  const name=(document.getElementById('bid-sign-name')?.value||'').trim();
  const err=document.getElementById('bid-sign-err');
  if(!name){if(err){err.style.display='block';err.textContent='Type your name to sign.';}return;}
  const ok=await _signSubBid(id,name);
  if(ok)closeTopModal();
  else if(err){err.style.display='block';err.textContent='Couldn’t sign. Check your connection and try again.';}
}
// GC-side inbox card for pending incoming bids → opens the review-and-sign
// sheet. Empty string when none, so it costs nothing on accounts with no
// linked subs bidding.
function _subBidInboxHTML(bids){
  const pend=(Array.isArray(bids)?bids:[]).filter(b=>b&&b.status==='pending');
  if(!pend.length)return'';
  return pend.map(b=>{
    const who=escHtml(b.sub_business_name||'A linked sub');
    const addr=escHtml(b.job_addr||'');
    const amt=(typeof fmt==='function')?fmt(Number(b.amount)||0):('$'+(Number(b.amount)||0));
    const scope=escHtml(b.scope||'');
    const scopeShort=scope.length>90?scope.slice(0,90)+'…':scope;
    return '<div style="background:var(--bg-card);border:1.5px solid var(--blue);border-radius:var(--r);padding:12px;margin-bottom:10px">'+
      '<div style="font-size:12px;font-weight:800;color:var(--blue);margin-bottom:3px">'+svgIcon('📥',{size:12})+' New bid from '+who+'</div>'+
      '<div style="font-size:14px;font-weight:800;margin-bottom:2px">'+amt+(addr?' · '+addr:'')+'</div>'+
      (scopeShort?'<div style="font-size:12px;color:var(--text2);line-height:1.45;margin:4px 0 8px">'+scopeShort+'</div>':'<div style="height:6px"></div>')+
      '<button onclick="_openBidReview('+Number(b.id)+')" style="width:100%;padding:9px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">'+svgIcon('✍️',{size:13})+' Review &amp; sign</button>'+
    '</div>';
  }).join('');
}
// Sub side: bidding a pipe job opens the REAL estimate builder (owner decision
// 2026-07-13: every bid is an itemized, signable document, never a lump-sum
// quick charge). The job address arrived via the assignment, so we open the
// estimator prefilled with it (no searching) and stamp a GC-bid context; the
// estimator's Send then routes to the linked GC as a signable bid instead of a
// client link (see _maybeRouteGcBid, called from sendGenericProposal).
function _openBidBuilder(jobId){
  const job=(jobs||[]).find(j=>j&&String(j.id)===String(jobId));
  if(!job)return;
  const c=(clients||[]).find(x=>x&&String(x.id)===String(job.client_id));
  const gcUid=(c&&c.gcLinkId)?String(c.gcLinkId):'';
  if(!c||!gcUid){if(typeof showToast==='function')showToast('This job isn’t linked to a GC on TradeDesk','⚠️');return;}
  // GC-bid context the estimator's send step reads. Cleared on send or cancel.
  window._gcBidCtx={gcUid,addr:job.addr||'',jobId:job.id,gcName:c.name||'the GC'};
  if(typeof currentClientId!=='undefined')currentClientId=c.id;
  // Open the estimator prefilled with the GC card as the "client" + the job
  // address override. _doOpenEstimate runs the trade/style pickers as usual.
  if(typeof _doOpenEstimate==='function')_doOpenEstimate(c,job.addr||'');
  else if(typeof openGenericEstimate==='function')openGenericEstimate(c);
}
// Called by sendGenericProposal when a GC-bid context is active: route the
// finished estimate to the linked GC as a signable bid (amount + scope +
// line count) instead of a client sign-link. Returns true if it handled the
// send. Pure enough to unit-test: caller passes the computed total/scope/lines.
async function _maybeRouteGcBid(total,scope,lineCount){
  if(!window._gcBidCtx)return false;
  const ctx=window._gcBidCtx;
  const ok=await _sendBidToGC({gcUid:ctx.gcUid,addr:ctx.addr,amount:Number(total)||0,
    scope:String(scope||''),lineCount:Number(lineCount)||0});
  if(ok){
    const job=(jobs||[]).find(j=>j&&String(j.id)===String(ctx.jobId));
    if(job){job.bidSentAt=new Date().toISOString();job.bidAmount=Number(total)||0;saveAll();}
    window._gcBidCtx=null;
    if(typeof goPg==='function')goPg('pg-dash');
    if(typeof renderDash==='function')renderDash();
  }
  return ok;
}
// The multi-property answer: ONE client record per linked GC, no matter how
// many properties they send work at. Addresses live on each job/income row,
// never stacked onto the client, a builder with 300 lots is still one clean
// card. Created as a bare lead (name only) when missing.
//
// Identity is the GC's ACCOUNT id (gcLinkId), not their display name: a GC
// who renames their business keeps the same card, and two different GCs who
// happen to share a name never get merged into one card. Name matching is
// only the adoption path for the referral-seeded lead (created before this
// stamping existed), and it refuses to adopt a card already stamped for a
// DIFFERENT GC.
function _pipePayerClient(name,gcUid){
  const n=String(name||'').trim();
  const uid=String(gcUid||'');
  if(uid){
    const byId=clients.find(x=>x&&String(x.gcLinkId||'')===uid);
    if(byId)return byId;
  }
  if(!n)return null;
  const c=clients.find(x=>x&&x.name&&String(x.name).toLowerCase()===n.toLowerCase()
    &&(!x.gcLinkId||String(x.gcLinkId)===uid));
  if(c){if(uid&&!c.gcLinkId)c.gcLinkId=uid;return c;}
  // Collision-proof id: two payer cards created in the same millisecond
  // (two new GCs in one ingest) must never share an id.
  let id=Date.now();while(clients.some(x=>x&&x.id===id))id++;
  const fresh={id,name:n,phone:'',email:'',addr:'',created:new Date().toISOString(),
    notes:'Linked contractor on TradeDesk, added automatically',
    extraAddresses:[],clientToken:'',clientHubKey:'',gcLinkId:uid};
  clients.push(fresh);
  return fresh;
}
// Pure converter: one claimed assignment → a scheduled job on MY calendar,
// carrying exactly what the GC shared (address + start date). Value stays 0
// until real money flows through the payment side of the pipe.
function _assignmentToJob(a,clientId){
  if(!a||!String(a.job_addr||'').trim())return null;
  // Strict YYYY-MM-DD or fall back to today, a malformed date would put an
  // Invalid Date into every calendar/pipeline loop that parses job.start.
  const raw=String(a.start_date||'');
  const start=/^\d{4}-\d{2}-\d{2}$/.test(raw)?raw:(typeof todayKey==='function'?todayKey():'');
  return{id:Date.now(),bid_id:null,client_id:clientId||null,
    name:'Job: '+(a.gc_business_name||'linked contractor'),
    addr:String(a.job_addr),start,days:1,buffer:0,value:0,color:'#185FA5',
    eventType:'job',time:'',hours:null,
    notes:'Assigned by '+(a.gc_business_name||'a linked contractor')+' on TradeDesk',
    status:'upcoming',
    // Flags this as pipe-sourced so the Today widget can offer a one-tap
    // "Log mileage" shortcut: the whole reason the address crosses the
    // pipe in the first place is so the sub's drive gets tracked.
    pipeSourced:true};
}
// Pure converter: one accepted offer → an income row on MY books. The ingest
// resolves the payer card via _pipePayerClient (account-id identity) and
// passes its id as forceClientId; the name match here is only the fallback
// for callers without that resolution.
function _paymentOfferToIncome(offer,forceClientId){
  if(!offer||!(Number(offer.amount)>0))return null;
  const payer=(offer.gc_business_name||'').trim();
  const c=(forceClientId==null&&payer)?clients.find(x=>x.name&&x.name.toLowerCase()===payer.toLowerCase()):null;
  return{id:Date.now(),bid_id:null,client_id:forceClientId!=null?forceClientId:(c?c.id:null),client_name:payer||'Contractor',
    date:String(offer.paid_date||'').replace(/-/g,'').slice(0,8),type:'Job payment',amount:Number(offer.amount),
    method:'',notes:('From '+(payer||'a linked contractor')+(offer.job_addr?', job @ '+offer.job_addr:'')).slice(0,200),
    created_at:new Date().toISOString()};
}
// Sub side: the pipe INBOX. Payments and job assignments from linked GCs
// land AUTOMATICALLY (owner decision, no accept tap). The claim is atomic:
// `update … eq status pending → select` returns ONLY the rows THIS call
// flipped, so two of the sub's devices can never double-add the same row.
// The ledger stays the sub's own: landed rows are plain local records they
// can edit or delete like anything hand-entered.
let _pipeIngestRunning=false,_pipeIngestLast=0;
async function _ingestPipeInbox(force){
  if(_pipeIngestRunning)return false;
  if(!force&&Date.now()-_pipeIngestLast<60000)return false; // tab-click debounce
  if(typeof supaEnabled!=='function'||!supaEnabled()||!_supaUser)return false;
  _pipeIngestRunning=true;_pipeIngestLast=Date.now();
  try{
    const now=new Date().toISOString();
    let touched=false;
    try{ // payments → income rows
      const{data:offs}=await _supa.from('payment_offers')
        .update({status:'accepted',decided_at:now})
        .eq('sub_user_id',_supaUser.id).eq('status','pending').select();
      const rows=(offs||[]).map(o=>{
        // Resolve the payer card by GC ACCOUNT id (stable across renames,
        // never merges two same-name GCs), creates the lead if missing,
        // exactly like the assignment path.
        const pc=_pipePayerClient(o.gc_business_name,o.gc_user_id);
        return _paymentOfferToIncome(o,pc?pc.id:null);
      }).filter(Boolean);
      rows.forEach(r=>{
        let id=Date.now();while(income.some(x=>x&&x.id===id))id++;
        r.id=id;income.push(r);
      });
      if(rows.length){
        touched=true;
        // saveAll NOW, before the next network await: these offers are already
        // claimed server-side, a tab killed mid-ingest must not lose them.
        saveAll();
        const total=rows.reduce((s,r)=>s+r.amount,0);
        const amt=typeof fmt==='function'?fmt(total):'$'+total;
        // escHtml: showToast renders via innerHTML; payer name is GC-controlled.
        showToast(rows.length===1
          ?amt+' from '+escHtml(rows[0].client_name||'a linked contractor')+', added to your books'
          :rows.length+' payments ('+amt+') from linked contractors, added to your books','💵');
      }
    }catch(_e){}
    try{ // job assignments → scheduled jobs with the address
      const{data:asgs}=await _supa.from('job_assignments')
        .update({status:'received',received_at:now})
        .eq('sub_user_id',_supaUser.id).eq('status','pending').select();
      let added=0,firstAddr='';
      (asgs||[]).forEach(a=>{
        const c=_pipePayerClient(a.gc_business_name,a.gc_user_id);
        const job=_assignmentToJob(a,c?c.id:null);
        if(job){
          let id=Date.now();while(jobs.some(x=>x&&x.id===id))id++;
          job.id=id;jobs.push(job);added++;if(!firstAddr)firstAddr=job.addr;
        }
      });
      if(added){
        touched=true;
        saveAll(); // same crash-window rule as the payment block
        // escHtml: the address is GC-controlled and showToast uses innerHTML.
        showToast(added===1
          ?'New job @ '+escHtml(firstAddr)+', on your calendar'
          :added+' new job addresses, on your calendar','📅');
      }
    }catch(_e){}
    if(touched){
      // (saveAll already ran inside each landing block, see crash-window note)
      if(typeof supaSaveToCloud==='function')supaSaveToCloud();
      try{
        const pg=document.querySelector('.pg.active')?.id;
        // pg-dash is the common case: it's the FIRST page shown at boot, and
        // this ingest runs 1.8s after boot on purpose (never compete with the
        // boot render), so Today already painted before a job/payment landed.
        // Without this, a job assigned this morning shows the toast but never
        // shows up on Today until the sub navigates away and back.
        if(pg==='pg-dash'&&typeof renderDash==='function')renderDash();
        else if(pg==='pg-tracker'&&typeof renderTrackerTab==='function')renderTrackerTab();
        else if(pg==='pg-cal'&&typeof renderCalGrid==='function')renderCalGrid();
      }catch(_e){}
    }
    return touched;
  }finally{_pipeIngestRunning=false;}
}

// ── 1099 contractor payment tracking ─────────────────────────────────────────
// One yearly ledger per payee across BOTH payment sources:
//  1. expenses with the contract-labor category ('subs' from the full modal,
//     'Subcontractors' from the quick modal), including the rows markSubPaid
//     now auto-writes.
//  2. legacy job.subs[] entries marked paid BEFORE auto-expensing existed
//     (no matching subPayKey expense), so old data still counts.
// Every row resolves its job address (bid.addr → client.addr) because the
// 1099 story is "which job, where, how much."
function _isSubExpense(e){return !!e&&(e.cat==='subs'||e.cat==='Subcontractors');}
function _sub1099Report(yr){
  yr=String(yr||new Date().getFullYear());
  const roster=S.subcontractors||[];
  const byPayee={};
  const _addr=(bidId,clientId)=>{
    const b=bidId?bids.find(x=>x.id===bidId):null;
    if(b&&b.addr)return b.addr;
    const c=getClientById(clientId||(b&&b.client_id));
    return (c&&c.addr)||'';
  };
  const _bucket=(key,label,subId)=>{
    if(!byPayee[key])byPayee[key]={name:label,subId:subId||null,total:0,rows:[]};
    return byPayee[key];
  };
  expenses.filter(e=>_isSubExpense(e)&&e.date&&e.date.startsWith(yr)).forEach(e=>{
    const sub=e.subId?roster.find(x=>x.id===e.subId):roster.find(x=>x.name&&e.vendor&&x.name.toLowerCase()===e.vendor.toLowerCase());
    const key=sub?('id:'+sub.id):('v:'+(e.vendor||'Unknown').toLowerCase());
    const b=_bucket(key,sub?sub.name:(e.vendor||'Unknown'),sub&&sub.id);
    b.total+=(e.amount||0);
    b.rows.push({date:e.date,amount:e.amount||0,job:e.job_name||'',addr:_addr(e.job_id,e.client_id)});
  });
  jobs.forEach(j=>{
    (j.subs||[]).forEach((sp,i)=>{
      if(!sp.paid||!sp.paidDate||!sp.paidDate.startsWith(yr))return;
      if(expenses.some(e=>e.subPayKey===j.id+':'+i))return; // already counted via its expense
      const sub=roster.find(x=>x.id===sp.subId);
      const key=sub?('id:'+sub.id):('v:'+(sp.subName||'Unknown').toLowerCase());
      const b=_bucket(key,sub?sub.name:(sp.subName||'Unknown'),sub&&sub.id);
      b.total+=(sp.amount||0);
      b.rows.push({date:sp.paidDate,amount:sp.amount||0,job:j.name||sp.desc||'',addr:_addr(j.bid_id,j.client_id)});
    });
  });
  const payees=Object.values(byPayee).map(p=>{
    const sub=p.subId?roster.find(x=>x.id===p.subId):null;
    p.total=+p.total.toFixed(2);
    p.needs1099=p.total>=600;
    p.ein=(sub&&sub.ein)||'';
    p.w9=!!(sub&&sub.w9);
    p.addr=(sub&&sub.addr)||'';
    p.rows.sort((a,b)=>(a.date||'').localeCompare(b.date||''));
    return p;
  }).sort((a,b)=>b.total-a.total);
  return {yr,payees,total:+payees.reduce((s,p)=>s+p.total,0).toFixed(2),
          flagged:payees.filter(p=>p.needs1099).length,
          missingW9:payees.filter(p=>p.needs1099&&!(p.w9&&p.ein)).length};
}
function open1099Report(yr){
  const rep=_sub1099Report(yr||trackerYear||new Date().getFullYear());
  document.getElementById('_1099-ov')?.remove();
  const ov=document.createElement('div');ov.id='_1099-ov';ov.className='zmodal-overlay';
  const box=document.createElement('div');box.className='zmodal';box.style.maxWidth='560px';
  box.innerHTML=
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">'+
      '<div style="font-size:17px;font-weight:800">1099 contractor payments, '+rep.yr+'</div>'+
      '<button onclick="document.getElementById(\'_1099-ov\').remove()" style="border:none;background:none;font-size:22px;cursor:pointer;color:var(--text3)">×</button>'+
    '</div>'+
    '<div style="font-size:11px;color:var(--text3);margin-bottom:12px">'+fmt(rep.total)+' paid to '+rep.payees.length+' contractor'+(rep.payees.length!==1?'s':'')+' · '+rep.flagged+' at the $600 1099-NEC threshold'+(rep.missingW9?' · <span style="color:var(--amber);font-weight:700">'+rep.missingW9+' missing W-9/EIN</span>':'')+'</div>'+
    (!rep.payees.length?'<div class="empty">No contractor payments in '+rep.yr+'.<br>Assign a sub on a job sheet and mark them paid, or log an expense under Subcontractors.</div>':
      rep.payees.map(p=>
        '<div style="background:var(--bg2);border:1px solid '+(p.needs1099?'#D4A017':'var(--border)')+';border-radius:var(--r);padding:10px 12px;margin-bottom:10px">'+
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">'+
            '<div style="font-size:14px;font-weight:800">'+escHtml(p.name)+'</div>'+
            '<div style="font-size:15px;font-weight:800">'+fmt(p.total)+'</div>'+
          '</div>'+
          '<div style="font-size:10px;margin:3px 0 7px">'+
            (p.needs1099?'<span style="background:#FFF3CD;border:1px solid #D4A017;color:#6B4C00;font-weight:700;padding:1px 7px;border-radius:8px">1099-NEC required, file by Jan 31</span> ':'')+
            (p.needs1099?(p.w9&&p.ein?'<span style="color:var(--green-mid);font-weight:700">'+svgIcon('✓')+' W-9 + EIN on file</span>':'<span style="color:var(--amber);font-weight:700">'+svgIcon('⚠')+' get W-9'+(p.ein?'':' + EIN')+(p.subId?', edit the sub in Team':', add them to your sub roster (Team) so filing info attaches')+'</span>'):'')+
          '</div>'+
          p.rows.map(r=>
            '<div style="display:flex;justify-content:space-between;gap:8px;font-size:11px;padding:3px 0;border-top:1px solid var(--border)">'+
              '<span style="color:var(--text3);flex-shrink:0">'+r.date+'</span>'+
              '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml(r.job||'-')+(r.addr?' · '+escHtml(r.addr):'')+'</span>'+
              '<span style="font-weight:700;flex-shrink:0">'+fmt(r.amount)+'</span>'+
            '</div>').join('')+
        '</div>').join(''))+
    '<div style="font-size:9px;color:var(--text3);margin-top:4px">Payments from job-sheet sub payouts and Subcontractor expenses. Not tax advice, confirm filing requirements with your tax professional.</div>';
  ov.appendChild(box);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
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

  // W-2 cost model, painter wages $18-30/hr typical in KS
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
    signal=svgIcon('🟢')+' Ready to hire';sigColor='#1a7340';sigBg='#EAF3DE';
    advice='Your profit covers the full cost of a W-2 employee '+ratio.toFixed(1)+'x over. You have the buffer to hire, train, and absorb slow months.';
  }else if(ratio>=1.5){
    signal=svgIcon('🟡')+' Getting close';sigColor='#856404';sigBg='#FEF3C7';
    advice='You could technically afford it, but the margin is thin. One slow month could put you in the red. Aim to grow monthly profit to '+fmt(Math.round(totalMonthly*2.5))+' before hiring.';
  }else{
    signal=svgIcon('🔴')+' Not yet';sigColor='#A32D2D';sigBg='#FEE8E8';
    advice='Monthly profit of '+fmt(monthlyProfit)+' doesn\'t cover the '+fmt(totalMonthly)+'/mo cost of a W-2 hire. You need '+fmt(Math.round(totalMonthly*2.5))+'/mo profit to hire safely.';
  }

  // How many extra jobs/month needed
  const avgJobVal=bids.filter(b=>b.status==='Closed Won').reduce((s,b,_,a)=>s+(b.amount||0)/(a.length||1),0)||2500;
  const avgProfit=avgJobVal*(S.margin||40)/100;
  const jobsNeeded=avgProfit>0?Math.ceil(totalMonthly*1.5/avgProfit):0;

  el.innerHTML=
    '<div class="card">'+
      '<div style="font-size:17px;font-weight:800;margin-bottom:2px">Hiring readiness</div>'+
      '<div style="font-size:12px;color:var(--text3);margin-bottom:14px">Based on your last 90 days, W-2 employee full cost model</div>'+

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
        '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:10px">W-2 vs 1099, the real talk</div>'+
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'+
          '<div style="padding:10px;background:#EAF3DE;border-radius:var(--r)">'+
            '<div style="font-size:11px;font-weight:800;color:var(--green-mid);margin-bottom:6px">'+svgIcon('✅')+' W-2 Employee</div>'+
            '<div style="font-size:10px;color:var(--text2);line-height:1.7">You control their hours &amp; methods<br>Build real team culture<br>Workers comp covers injuries<br>Loyalty + retention<br>Easier to train your way<br>Qualifies for benefits</div>'+
          '</div>'+
          '<div style="padding:10px;background:#FEE8E8;border-radius:var(--r)">'+
            '<div style="font-size:11px;font-weight:800;color:#A32D2D;margin-bottom:6px">'+svgIcon('⚠')+' 1099 "Copout"</div>'+
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
// Does NOT remove the key, it stays until a successful cloud push clears it (line ~1411).
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
          if(_cd.maintenance?.length)maintenance=_cd.maintenance;
      if(_cd.checksState&&Object.keys(_cd.checksState).length)checksState=_cd.checksState;
      if(_cd.settings){_mergeIncomingSettings(_cd.settings,'zp3_cloud_cache (cache restore)');applySettings();_refillSettingsFormUnlessEditing();}
    }catch(_ce){}
  }
  _mergeOfflinePendingToMemory(); // show any records created since the last cloud sync
  _loadedFromCacheOnly=true;
  _mergeOnSignIn=true; // merge any new records entered here when SIGNED_IN fires
  _removeBootOverlay();renderDash();
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
  // Sub referral (?sub_invite=): pitch-first signup screen. Employee invites
  // win if both are somehow present; opts.plain skips the pitch (the "I
  // already have an account" path) without clearing the stash, attribution
  // stays claimable until an account is actually created (obSubmit).
  const _pendingSubInv=(!_pendingInvite&&!opts.plain)?(function(){try{return JSON.parse(localStorage.getItem('_pendingSubInvite')||'null');}catch(_e){return null;}})():null;
  const _inviteBanner=_pendingInvite
    ?'<div style="background:#EFF6FF;border:1.5px solid #3B82F6;border-radius:var(--r);padding:12px 14px;margin-bottom:20px">'+
      '<div style="font-size:13px;font-weight:700;color:#1D4ED8;margin-bottom:2px">You\'ve been invited to join a crew on TradeDesk</div>'+
      '<div style="font-size:12px;color:#1e40af;line-height:1.5">Create a free account or sign in below to accept the invite and see your assigned jobs.</div>'+
      '</div>'
    :'';
  const overlay=document.createElement('div');
  overlay.id='supa-login-overlay';
  // Normal sign-in gets the full-bleed two-panel treatment that matches the
  // onboarding wizard; the invite/sub-referral pitches keep their centered card.
  const _normalLogin=!_pendingInvite&&!_pendingSubInv;
  overlay.style.cssText=_normalLogin
    ?'position:fixed;inset:0;z-index:9999;background:var(--bg);overflow-y:auto;padding:0'
    :'position:fixed;inset:0;z-index:9999;background:var(--bg);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px';
  const _inputStyle='font-size:16px;padding:12px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);width:100%;box-sizing:border-box';
  overlay.innerHTML= _pendingInvite
    ? (function(){
        const _piBname=escHtml(_pendingInvite.bname||'Your contractor');
        const _piEname=(_pendingInvite.ename||'').split(/[\s,]+/)[0];
        const _piEmail=_pendingInvite.email||'';
        const _roStyle=_inputStyle+';background:var(--bg3);color:var(--text3);cursor:default';
        return '<div style="max-width:360px;width:100%">'+
          '<div style="text-align:center;margin-bottom:24px">'+
            '<div style="font-size:36px;margin-bottom:10px">'+svgIcon('👷',{size:36})+'</div>'+
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
    : _pendingSubInv
    ? (function(){
        // ── Sub referral landing ─────────────────────────────────────────────
        const _sbBname=escHtml(_pendingSubInv.bn||'A contractor you work with');
        const _sbFirst=escHtml((_pendingSubInv.n||'').split(/[\s,]+/)[0]||'');
        const _sbTrade=escHtml((_pendingSubInv.t||'').toLowerCase());
        return '<div style="max-width:360px;width:100%">'+
          '<div style="text-align:center;margin-bottom:24px">'+
            '<div style="font-size:36px;margin-bottom:10px">'+svgIcon('🔧',{size:36})+'</div>'+
            '<div style="font-size:22px;font-weight:800;letter-spacing:-.02em;margin-bottom:6px">'+(_sbFirst?'Hey '+_sbFirst+', this one\'s for your business':'Built for your business too')+'</div>'+
            '<div style="font-size:13.5px;color:var(--text3);line-height:1.5"><strong style="color:var(--text2)">'+_sbBname+'</strong> set you up with your own TradeDesk account: your own business, not a login into theirs.</div>'+
          '</div>'+
          // What you actually get, left-aligned + scannable so the value reads at a glance.
          '<div style="border:1px solid var(--border2);border-radius:var(--r);overflow:hidden;margin-bottom:16px">'+
            (localStorage.getItem('_pendingSubInviteGrant')
              ?'<div style="display:flex;gap:10px;padding:12px;background:var(--green-lt,#ECFDF5);border-bottom:1px solid var(--border2)"><div style="flex:none">'+svgIcon('💵',{size:18})+'</div><div style="font-size:12.5px;color:var(--green-mid,#0E6B39);line-height:1.45;font-weight:600">Every dollar '+_sbBname+' has paid you is <strong>already on your books</strong>. Nothing to type in. You start where you are, not from zero.</div></div>'
              :'')+
            '<div style="display:flex;gap:10px;padding:12px;border-bottom:1px solid var(--border2)"><div style="flex:none">'+svgIcon('📍',{size:18})+'</div><div style="font-size:12.5px;color:var(--text2);line-height:1.45">They send you a job, the <strong>address drops onto your calendar</strong>. Just drive out and work.</div></div>'+
            '<div style="display:flex;gap:10px;padding:12px;border-bottom:1px solid var(--border2)"><div style="flex:none">'+svgIcon('🧾',{size:18})+'</div><div style="font-size:12.5px;color:var(--text2);line-height:1.45">Estimate, invoice, e-sign, get paid: the <strong>same tools '+_sbBname+' runs</strong>, now yours'+(_sbTrade?', built for '+_sbTrade+' pros':'')+'.</div></div>'+
            '<div style="display:flex;gap:10px;padding:12px"><div style="flex:none">'+svgIcon('🔒',{size:18})+'</div><div style="font-size:12.5px;color:var(--text2);line-height:1.45">Your clients, your numbers, your money stay <strong>private to you</strong>. They never see your side.</div></div>'+
          '</div>'+
          '<button onclick="document.getElementById(\'supa-login-overlay\').remove();showOnboarding()" style="width:100%;padding:15px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:16px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:10px">Claim my account →</button>'+
          '<button onclick="document.getElementById(\'supa-login-overlay\').remove();supaShowLogin({force:true,plain:true})" style="width:100%;padding:12px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);font-size:14px;font-weight:600;cursor:pointer;font-family:inherit">I already use TradeDesk</button>'+
          '<div id="supa-login-err" style="font-size:12px;color:#A32D2D;margin-top:12px;text-align:center;min-height:16px"></div>'+
          '</div>';
      })()
    : // ── Normal login, branded two-panel, matches the onboarding wizard ─────
      (function(){
        const _wrench=(sz,st)=>'<svg viewBox="0 0 24 24" width="'+sz+'" height="'+sz+'" fill="none" stroke="'+st+'" stroke-width="2.5"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>';
        // Real vendor marks, what every premium app ships, reads as legitimate.
        const _gLogo='<svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 01-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.33A9 9 0 009 18z"/><path fill="#FBBC05" d="M3.97 10.71a5.4 5.4 0 010-3.42V4.96H.96a9 9 0 000 8.08l3.01-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 00.96 4.96L3.97 7.3C4.68 5.17 6.66 3.58 9 3.58z"/></svg>';
        const _aLogo='<svg width="16" height="16" viewBox="0 0 384 512" fill="#fff"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/></svg>';
        const _fldFocus='onfocus="this.style.borderColor=\'var(--blue)\';this.style.background=\'#fff\';this.style.boxShadow=\'0 0 0 3px rgba(37,99,235,.13)\'" onblur="this.style.borderColor=\'#e3e6eb\';this.style.background=\'#f7f8fa\';this.style.boxShadow=\'none\'"';
        const _fld='font-size:15px;padding:12px 14px;border-radius:10px;border:1.5px solid #e3e6eb;background:#f7f8fa;color:var(--text);width:100%;box-sizing:border-box;outline:none;font-family:inherit;transition:border-color .15s,box-shadow .15s,background .15s';
        const _social=(prov,label,bg,fg,bd,icon)=>'<button onclick="_obOAuth(\''+prov+'\')" onmouseover="this.style.filter=\'brightness(.97)\'" onmouseout="this.style.filter=\'none\'" style="display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:12px;border-radius:10px;border:'+bd+';background:'+bg+';color:'+fg+';font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;margin-bottom:10px;transition:filter .15s">'+icon+'<span>'+label+'</span></button>';
        const _bullets=[[svgIcon('📋',{size:15,color:'#fff'}),'Estimates & proposals in minutes'],[svgIcon('💰',{size:15,color:'#fff'}),'Get paid on the spot'],[svgIcon('📍',{size:15,color:'#fff'}),'Mileage, crew & taxes tracked'],[svgIcon('📊',{size:15,color:'#fff'}),'Your whole business, one place']];
        return '<div style="display:flex;min-height:100vh;min-height:100dvh">'+
          // Left brand panel (desktop only), gradient + soft glow for depth
          '<div id="login-left" style="position:relative;overflow:hidden;width:360px;flex-shrink:0;background:linear-gradient(160deg,#111826 0%,#0D1117 60%,#080a0f 100%);padding:48px 38px;flex-direction:column;justify-content:space-between">'+
            '<div style="position:absolute;top:-120px;right:-120px;width:340px;height:340px;background:radial-gradient(circle,rgba(37,99,235,.28),transparent 70%);pointer-events:none"></div>'+
            '<div style="position:relative;z-index:1">'+
              '<div style="display:flex;align-items:center;gap:11px;margin-bottom:48px">'+
                '<div style="width:40px;height:40px;background:linear-gradient(135deg,#2563eb,#1e40af);border-radius:11px;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 18px rgba(37,99,235,.4)">'+_wrench(21,'#fff')+'</div>'+
                '<span class="brand-logo-slot" style="font-size:19px;font-weight:800;color:#fff;letter-spacing:-.02em">TradeDesk</span>'+
              '</div>'+
              '<div style="font-size:29px;font-weight:800;color:#fff;line-height:1.22;letter-spacing:-.025em;margin-bottom:16px">Welcome back.<br>Let\'s get to work.</div>'+
              '<div style="font-size:14px;color:rgba(255,255,255,.55);line-height:1.5;margin-bottom:30px;max-width:250px">Built for the trades. Everything from lead to paid, in your pocket.</div>'+
              '<div style="display:grid;gap:14px">'+
                _bullets.map(f=>
                  '<div style="display:flex;align-items:center;gap:12px;font-size:13.5px;color:rgba(255,255,255,.85)"><span style="width:26px;height:26px;flex:none;border-radius:7px;background:rgba(255,255,255,.09);display:flex;align-items:center;justify-content:center">'+f[0]+'</span><span>'+f[1]+'</span></div>'
                ).join('')+
              '</div>'+
            '</div>'+
            '<div style="position:relative;z-index:1;font-size:11px;color:rgba(255,255,255,.38)">© 2025 TradeDesk</div>'+
          '</div>'+
          // Right form panel (desktop keeps the light gradient; mobile flips to the dark brand backdrop in JS below)
          '<div id="login-form-panel" style="flex:1;display:flex;flex-direction:column;background:radial-gradient(115% 52% at 50% -8%,rgba(45,93,168,.09),transparent 60%),linear-gradient(180deg,#FCFDFF 0%,#F2F5FB 100%);min-height:100%">'+
            // Mobile header, logo lockup on the dark brand backdrop (phones only)
            '<div id="login-mobile-hero" style="display:none;flex-direction:column;align-items:center;justify-content:center;gap:11px;padding:0 20px 24px;text-align:center">'+
              '<div style="display:flex;align-items:center;gap:11px">'+
                '<div style="width:46px;height:46px;background:linear-gradient(135deg,#2D5DA8,#1B3F7A);border-radius:13px;display:flex;align-items:center;justify-content:center;box-shadow:0 10px 26px rgba(45,93,168,.55)">'+_wrench(25,'#fff')+'</div>'+
                '<span style="font-size:23px;font-weight:800;color:#fff;letter-spacing:-.02em">TradeDesk</span>'+
              '</div>'+
              '<div style="font-size:14px;color:rgba(245,239,226,.62);font-weight:500">Welcome back. Let\'s get to work.</div>'+
            '</div>'+
            '<div id="login-form-inner" style="flex:1;display:flex;flex-direction:column;justify-content:center;padding:34px 28px;max-width:404px;width:100%;margin:0 auto;box-sizing:border-box">'+
              _inviteBanner+
              '<div style="margin-bottom:22px"><div style="font-size:25px;font-weight:800;letter-spacing:-.025em;color:var(--text);margin-bottom:4px">Sign in</div><div style="font-size:14px;color:var(--text3)">Pick up right where you left off.</div></div>'+
              _social('google','Continue with Google','#fff','#1f2328','1.5px solid #dadce0',_gLogo)+
              _social('apple','Continue with Apple','#000','#fff','1.5px solid #000',_aLogo)+
              // Email is tucked behind a button so Google/Apple lead; tapping it pops the fields out.
              '<div id="login-email-divider" style="display:flex;align-items:center;gap:10px;margin:16px 0 14px"><div style="flex:1;height:1px;background:var(--border)"></div><span style="font-size:11px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.05em">or</span><div style="flex:1;height:1px;background:var(--border)"></div></div>'+
              '<button id="login-email-toggle" onclick="_loginShowEmail()" onmouseover="this.style.filter=\'brightness(.97)\'" onmouseout="this.style.filter=\'none\'" style="display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:12px;border-radius:10px;border:1.5px solid #dadce0;background:#fff;color:#1f2328;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;transition:filter .15s"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#1f2328" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4.5" width="19" height="15" rx="2.5"></rect><path d="m3 6.5 9 6 9-6"></path></svg><span>Continue with email</span></button>'+
              '<div id="login-email-block" style="display:none">'+
                '<div class="f" style="margin:2px 0 12px"><label style="display:block;font-size:12px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Email</label>'+
                  '<input type="email" id="supa-email" placeholder="you@yourbusiness.com" '+_fldFocus+' style="'+_fld+'"></div>'+
                '<div class="f" style="margin-bottom:8px"><label style="display:block;font-size:12px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Password</label>'+
                  '<input type="password" id="supa-pass" placeholder="••••••••" onkeydown="if(event.key===\'Enter\')supaSignIn()" '+_fldFocus+' style="'+_fld+'"></div>'+
                '<div style="text-align:right;margin-bottom:18px"><button onclick="supaForgotPassword()" style="border:none;background:none;color:var(--blue);font-size:12.5px;font-weight:600;cursor:pointer;font-family:inherit;padding:0">Forgot password?</button></div>'+
                '<button onclick="supaSignIn()" onmouseover="this.style.transform=\'translateY(-1px)\';this.style.boxShadow=\'0 6px 20px rgba(13,17,23,.28)\'" onmouseout="this.style.transform=\'none\';this.style.boxShadow=\'0 3px 12px rgba(13,17,23,.18)\'" style="width:100%;padding:15px;border-radius:11px;border:none;background:linear-gradient(180deg,#1c2431,#0D1117);color:#fff;font-size:16px;font-weight:700;cursor:pointer;font-family:inherit;box-shadow:0 3px 12px rgba(13,17,23,.18);letter-spacing:-.01em;transition:transform .15s,box-shadow .15s">Sign in</button>'+
              '</div>'+
              '<div id="supa-login-err" style="font-size:12px;color:#A32D2D;margin-top:12px;text-align:center;min-height:16px"></div>'+
              '<div style="text-align:center;font-size:13.5px;color:var(--text3);margin-top:20px">New to TradeDesk? <button onclick="document.getElementById(\'supa-login-overlay\').remove();showOnboarding()" style="border:none;background:none;color:var(--blue);font-weight:700;cursor:pointer;font-family:inherit;padding:0;font-size:13.5px">Create your account</button></div>'+
              // Deliberate offline-only entry removed: a crash / cleared cache / new device would
              // wipe an offline-only account with no cloud backup. _enterOfflineMode is kept ONLY
              // as the auth-hiccup fallback (below) for users who already have a synced cloud cache.
            '</div>'+
          '</div>'+
        '</div>';
      })();
  document.body.appendChild(overlay);
  // Responsive: dark brand rail on wide screens, branded hero band on phones (matches onboarding).
  const _wide=window.innerWidth>=760;
  const _ll=document.getElementById('login-left');
  if(_ll)_ll.style.display=_wide?'flex':'none';
  const _lm=document.getElementById('login-mobile-hero');
  if(_lm)_lm.style.display=_wide?'none':'flex';
  // On phones: bring the desktop's dark brand backdrop to the whole screen and
  // float the form in a clean white card (kills the flat-white mobile look).
  const _fp=document.getElementById('login-form-panel');
  const _fi=document.getElementById('login-form-inner');
  if(!_wide){
    if(_fp){
      _fp.style.background='radial-gradient(90% 48% at 50% 2%,rgba(45,93,168,.28),transparent 60%),linear-gradient(165deg,#1B1612 0%,#1E2231 100%)';
      _fp.style.justifyContent='center';
      _fp.style.padding='24px 16px';
    }
    if(_fi){
      _fi.style.flex='0 0 auto';
      _fi.style.background='#fff';
      _fi.style.borderRadius='24px';
      _fi.style.padding='28px 24px';
      _fi.style.boxShadow='0 24px 60px rgba(0,0,0,.5)';
      _fi.style.margin='0 auto';
      _fi.style.maxWidth='430px';
      _fi.style.justifyContent='flex-start';
    }
  }
}
// Reveal the email/password fields when the user chooses "Continue with email".
function _loginShowEmail(){
  const t=document.getElementById('login-email-toggle');
  const d=document.getElementById('login-email-divider');
  const b=document.getElementById('login-email-block');
  if(t)t.style.display='none';
  if(d)d.style.display='none';
  if(b){b.style.display='block';b.style.animation='td-modal-enter .22s cubic-bezier(.22,1,.36,1) both';}
  setTimeout(()=>document.getElementById('supa-email')?.focus(),60);
}

async function supaSignIn(){
  const email=document.getElementById('supa-email')?.value?.trim();
  const pass=document.getElementById('supa-pass')?.value;
  const err=document.getElementById('supa-login-err');
  if(!email||!pass){if(err)err.textContent='Enter email and password.';return;}
  if(err)err.textContent='Signing in...';
  // Attempt real auth, on network failure (no HTTP status, or thrown exception),
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
  else{if(err){err.style.color='#1a7340';err.textContent='Reset link sent, check your email.';}}
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
      if(err){err.style.color='var(--text3)';err.textContent='Account exists, signing you in...';}
      const{error:siErr}=await _supa.auth.signInWithPassword({email,password:pass});
      if(siErr&&err){err.style.color='#A32D2D';err.textContent=siErr.message;}
    } else {
      if(err){err.style.color='#A32D2D';err.textContent=error.message;}
    }
    return;
  }
  if(err){err.style.color='var(--text3)';err.textContent='Account created, signing you in...';}
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
// Tear down EVERY live realtime channel bound to the outgoing account (bug #39 root cause).
// _initRealtimeSubscriptions subscribes td-sync-<uid>, user-data-<uid>, and sig-feed-<uid>
// filtered on the signed-in user's id. These channels are NOT closed on sign-out, so after
// account A signs out and B signs in on the SAME page, A's still-live postgres_changes
// subscription keeps delivering A's rows to _applyRealtimeRecord, which (with _lastKnownIds
// cleared by the wipe) re-pushes A's bid into the now-B bids[], re-stamps _syncedHash, and
// rewrites zp3_cloud_cache via _writeLocalCache(). Removing every channel here is what makes
// the wipe actually stick. Must run on any account exit (deliberate sign-out AND the
// cross-account SIGNED_IN reset where an involuntary SIGNED_OUT never wiped). Idempotent.
function _teardownRealtimeChannels(){
  try{if(_supa&&typeof _supa.removeAllChannels==='function')_supa.removeAllChannels();}catch(_e){}
  _syncBroadcastChannel=null;
  _realtimeSubscribed=false; // force the next account's load to re-subscribe under ITS uid
  _tdRealtimeReady=false;    // channels are gone, delivery is no longer live
  clearTimeout(_broadcastReloadTimer);_broadcastReloadTimer=null;_broadcastPending=false;
  clearTimeout(_reconcileTimer);_reconcileTimer=null;
  clearTimeout(_writeCacheTimer);_writeCacheTimer=null; // a pending debounced cache write would snapshot the OUTGOING account after the wipe
  clearTimeout(_rtRenderTimer);_rtRenderTimer=null;     // a pending coalesced render would paint the outgoing account's rows
}
// Hard-wipe THIS account's entire local footprint so nothing can bleed into the next
// account signed in on the same device (bug #39). Idempotent: safe to call from both
// the SIGNED_OUT handler AND supaSignOut; whichever runs first wins, the other no-ops.
function _wipeLocalAccountData(){
  clearTimeout(_syncTimer);_syncTimer=null; // prevent a live timer from flushing emptied arrays
  _teardownRealtimeChannels(); // CRITICAL: close A's live channels so they can't re-deliver A's rows into B
  _supaCloudLoaded=false;_realtimeSubscribed=false;_loadInProgress=false;clearTimeout(_broadcastReloadTimer);_broadcastReloadTimer=null;clearTimeout(_reconcileTimer);_reconcileTimer=null;clearTimeout(_writeCacheTimer);_writeCacheTimer=null;
  // Reset the "settings are authoritative" gate too. It guards the dashboard setup
  // checklist (dashboard.js): if it survives a sign-out, the next sign-in renders the
  // checklist for one frame against the OLD/empty state before the new load corrects
  // it, the brief onboarding flash on re-sign-in. Keep it hidden until the new load lands.
  _authSettingsLoaded=false;
  // Cross-account merge state: _mergeOnSignIn + the offline blob hold THIS account's data;
  // if either survives, the next account's SIGNED_IN merge pushes this account's records
  // into theirs. Hard-clear them plus the cloud cache so nothing leaks forward.
  _mergeOnSignIn=false;_loadedFromCacheOnly=false;_loadedDataOwner=null;
  localStorage.removeItem('zp3_offline_pending');
  localStorage.removeItem('zp3_cloud_cache');
  // Delta cursor + its sidecar are per-account too, drop both so the next account
  // rebuilds from a full load rather than delta-ing against this account's cursor.
  _deltaCursor=null;localStorage.removeItem('zp3_delta_meta');
  _subBids=null;window._subBidsKicked=false; // incoming-bid cache is per-account
  clients=[];bids=[];jobs=[];payments=[];income=[];expenses=[];mileage=[];liens=[];
  // Inbound-lead review queue is account-scoped in-memory state that lived OUTSIDE
  // the arrays above, the next account's Leads page would keep rendering this
  // account's unreviewed QR/intake leads (and could even promote one into the
  // next account's clients) until its own poll happened to overwrite it, which
  // isn't guaranteed (see _loadPendingInbound's early-returns). Clear both here.
  _pendingInbound=[];_processedInboundIds.clear();
  _updateInboundBadge();
  // Delta-sync baselines are per-account: a stale _syncedHash entry under the next account
  // would suppress re-upload of its own same-id row, and a stale _lastKnownIds set would
  // mis-target the soft-delete sweep. Both rebuild from the next account's cloud load.
  // _rowSyncedAt/_rowServerTs mirror _syncedHash (per-account merge gates), same lifecycle.
  _syncedHash={};_rowSyncedAt={};_rowServerTs={};
  // The durable op log + field clocks + ops-pull cursor are the OUTGOING account's
  // pending intent, surviving the switch would rebase A's edits onto B's data.
  try{_opDbClear();}catch(_e){}
  _fieldClocks={};
  try{if(_supaUser&&_supaUser.id)localStorage.removeItem('zp3_ops_since_'+_supaUser.id);}catch(_e){}
  Object.values(_lastKnownIds).forEach(s=>{if(s&&typeof s.clear==='function')s.clear();});
  // settingsTs:0: zp3_S is shared across accounts on this device. Without zeroing the
  // timestamp these blanked settings beat the next account's cloud copy and overwrite it.
  // vehiclesTs:0 for the same reason: the blanked vehicles:[] must never win the
  // per-field keep-local rule over the next login's real cloud fleet.
  S={...S,bname:'',bphone:'',blic:'',bemail:'',vehicles:[],vehiclesTs:0,weatherLat:null,weatherLon:null,locationDenied:false,settingsTs:0};
  saveAll();
}
async function supaSignOut(){
  _deliberateSignOut=true;
  // scope:'local' clears this device only, refresh token stays valid server-side.
  // scope:'global' (the default) revokes the token on the server, so the backup key
  // can't be used to silently re-auth when the user comes back online.
  if(_supa)await _supa.auth.signOut({scope:'local'});
  // GoTrue dispatches SIGNED_OUT asynchronously, and its handler is what wipes the
  // outgoing account's in-memory arrays and sets _supaUser=null. If the user signs
  // straight into a DIFFERENT account on the same page (no reload), that wipe can
  // land AFTER the new account's SIGNED_IN already set _supaUser, nulling it back
  // out and bleeding/blanking state. Drain deterministically: the SIGNED_OUT handler
  // clears _deliberateSignOut at the end of its wipe, so wait (bounded) for that flag
  // to drop before returning. Now any subsequent sign-in is a clean SIGNED_IN.
  const _t0=Date.now();
  while(_deliberateSignOut&&Date.now()-_t0<3000){await new Promise(r=>setTimeout(r,25));}
  _deliberateSignOut=false; // safety: never strand the guard if SIGNED_OUT didn't fire
  // GUARANTEE the wipe regardless of whether GoTrue actually delivered SIGNED_OUT in time:
  // in local-stack and on slow networks the event can arrive after this drain (or after the
  // next account's SIGNED_IN), so the handler's deliberate-branch wipe never runs and account
  // A's bids/clients/cloud-cache/synced-hash survive into B (bug #39). Idempotent with the
  // handler's own call, so running it here too is safe; B then signs in to a clean slate.
  _supaUser=null;_user=null;_account=null;_config=null;
  _wipeLocalAccountData();
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
// If local S carries a newer settingsTs, the incoming copy is stale, e.g. the
// user hit Save then refreshed before the cloud flush finished (settings are
// written LAST in supaSaveToCloud, after all table upserts). Local wins and we
// flag a pending sync so the newer local settings get pushed up.
function _mergeIncomingSettings(ss,src){
  if(!ss)return false;
  // TEMP DIAGNOSTIC (automation only): trace every settings merge to find the reboot clobber.
  if(navigator.webdriver){try{(window._mergeLog=window._mergeLog||[]).push({src:String(src).slice(0,40),ig:ss&&ss.goalMonthly,it:ss&&ss.settingsTs,lt:S.settingsTs,localNewer:(S.settingsTs||0)>(ss.settingsTs||0)});}catch(_e){}}
  // CROSS-ACCOUNT GUARD (production bug: an E2E/dev vehicle bled into another account on
  // a REAL password login). zp3_S: the settings cache S is painted from on boot, is
  // shared across accounts on one device, so S may still hold the PREVIOUS account's
  // settings. If the settings now arriving belong to a DIFFERENT account, nothing of the
  // old one may survive: take the incoming account's settings wholesale and BYPASS both
  // same-account guards below, the newer-settingsTs bail (which would keep the old
  // account's whole S) and the newer-vehiclesTs keep-local rule (which actively carried
  // the old account's vehicles across). S._sOwner stamps which account S belongs to.
  const _incomingOwner=((typeof _isEmployee!=='undefined'&&_isEmployee)?_contractorUserId:(_supaUser&&_supaUser.id))||null;
  if(S._sOwner&&_incomingOwner&&String(S._sOwner)!==String(_incomingOwner)){
    S={...ss,_sOwner:_incomingOwner};
    if(!Array.isArray(S.vehicles))S.vehicles=[]; // never inherit the old account's vehicles
    if(S.suppliesRate===0.40)S.suppliesRate=0.25;
    try{localStorage.setItem('zp3_S',JSON.stringify(S));}catch(_e){}
    return true;
  }
  if((S.settingsTs||0)>(ss.settingsTs||0)){
    try{localStorage.setItem('zp3_pending_sync','1');}catch(_e){}
    if(typeof supaSaveDebounced==='function')supaSaveDebounced();
    return false;
  }
  const _localTsBefore=S.settingsTs||0;
  const _localVehs=S.vehicles,_localVehsTs=S.vehiclesTs||0;
  S={...S,...ss};
  S._sOwner=_incomingOwner; // stamp owner so the NEXT login can detect an account switch
  if(_localVehsTs>(ss.vehiclesTs||0)){S.vehicles=_localVehs;S.vehiclesTs=_localVehsTs;}
  // One-time migration: supplies rate default lowered from $0.40 to $0.25/sqft (2026-06)
  if(S.suppliesRate===0.40){S.suppliesRate=0.25;}
  // Persist the winning copy immediately, without this, a force-close right after
  // the merge boots from a stale zp3_S (cleared values resurrect as their old rate
  // until the next cloud merge; permanently if that boot happens offline).
  try{localStorage.setItem('zp3_S',JSON.stringify(S));}catch(_e){}
  return true;
}
// ── Per-individual-user UI layout (dashboard widget order + nav tab order) ──
// Stored in the user_prefs table keyed by auth.uid(): NOT in zj_data/S, which
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
  // OFFLINE-REORDER FIX: a dirty flag means the LOCAL layout is newer than the
  // cloud row (the reorder's upsert never landed, offline/failed). Push local
  // up instead of applying the stale cloud copy over it.
  if(k&&localStorage.getItem(k+'_dirty')){_saveUserPrefs();return;}
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
  const k=_userLayoutCacheKey();
  // Dirty until the cloud upsert CONFIRMS, cleared in the success handler only.
  // Offline (or a failed write) leaves the flag, and reconnect/next boot re-pushes.
  if(k){try{localStorage.setItem(k+'_dirty','1');}catch(_e){}}
  if(!_supa||!_supaUser)return;
  try{
    _supa.from('user_prefs').upsert(
      {user_id:_supaUser.id,dash_widget_order:S.dashWidgetOrder||null,nav_tab_order:S.navTabOrder||null,kpi_order:S.dashKpiOrder||null,updated_at:new Date().toISOString()},
      {onConflict:'user_id'}
    ).then(()=>{try{if(k)localStorage.removeItem(k+'_dirty');}catch(_e){}},()=>{});
  }catch(_e){}
}
// Reconnect: if a reorder happened offline, its dirty flag is still set, push
// the local layout the moment the network returns (not just on the next reorder).
window.addEventListener('online',()=>{try{const k=_userLayoutCacheKey();if(k&&localStorage.getItem(k+'_dirty'))_saveUserPrefs();}catch(_e){}});
// Build the offline-pending snapshot, stamped with the owning account's user id.
// _owner lets the SIGNED_IN merge path refuse to fold one account's offline data
// into a different account (the cross-account-bleed root cause). _owner is null
// only for purely-local data entered before any sign-in (safe to adopt on first login).
function _offlinePendingBlob(){
  // Owner falls back to _loadedDataOwner so a blob written while offline (no _supaUser)
  // is still tagged with the account it came from, the next sign-in checks this.
  return JSON.stringify({_owner:(_supaUser&&_supaUser.id)||_loadedDataOwner||null,clients,bids,jobs,income,expenses:expenses.map(({receipt_img,...r})=>r),mileage,payments,liens,licenses,events:events.slice(-600),contracts,agreements,photos:photos.filter(p=>p.storagePath||p.url),timeEntries:timeEntries.slice(-500),maintenance,ts:Date.now()});
}
// Read offline-pending, discarding (and clearing) any blob owned by a different
// account than the one now signed in. Returns null when nothing usable remains.
function _readOwnedOfflinePending(){
  let op;try{op=JSON.parse(localStorage.getItem('zp3_offline_pending')||'null');}catch(_e){return null;}
  if(!op)return null;
  if(op._owner&&_supaUser&&op._owner!==_supaUser.id){
    localStorage.removeItem('zp3_offline_pending');
    return null; // belongs to a previous account, never merge it in
  }
  return op;
}
function supaSaveDebounced(){
  // A deliberate sign-out is in progress, never persist or queue the outgoing
  // account's data. This is the last line of defense against cross-account bleed:
  // even if a debounced save was scheduled milliseconds before sign-out, it stops here.
  if(_deliberateSignOut)return;
  if(!supaEnabled())return;
  if(!_supaUser&&!_mergeOnSignIn)return;
  // Oplog derive at the edit-time choke-point: ops (and their HLC field clocks) are
  // stamped when the user acted, not 2s later, and persisted to IndexedDB immediately,
  // so a force-quit inside the debounce window still keeps the intent. The NETWORK ops
  // sync (td_ops push/pull) runs in supaSaveToCloud's success epilogue, once per real
  // save: not here, where it fired per keystroke-debounce call.
  _opShadowDerive();
  clearTimeout(_syncTimer);
  // Write the snapshot SYNCHRONOUSLY before starting the 2s timer.
  // This is the bulletproof force-quit safety net: iOS may kill the PWA process
  // before visibilitychange or the async catch block can run, but a synchronous
  // localStorage write completes atomically and survives any force-quit.
  // Cleared by supaSaveToCloud() on a successful push. Drain deduplicates on reload.
  if(_supaCloudLoaded||_mergeOnSignIn){
    try{localStorage.setItem('zp3_offline_pending',_offlinePendingBlob());}catch(_e){}
  }
  // The fired save MUST be tracked in _pendingSavePromise (via _flushSaveNow), a bare
  // supaSaveToCloud() here is invisible to the silent-load guard in supaLoadFromCloud,
  // so a reconcile-heartbeat reload racing this in-flight save could replace the arrays
  // + rebuild _syncedHash mid-save and permanently drop the edit being saved (the
  // review-confirmed lost-edit race). _flushSaveNow is the ONE tracked entry point.
  _syncTimer=setTimeout(()=>{_syncTimer=null;_flushSaveNow();},2000);
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
  else{b.textContent='Offline: changes saved locally';b.style.background='#D97706';b.style.color='#1a1a1a';}
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
      // BIDS: non-destructive: newer/richer copy wins per id (see SIGNED_IN merge).
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

  // Case 2: Loaded from cache, no user writes, just refresh from cloud silently.
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
    // Nothing to sync and cloud is fully loaded, routine token rotation triggered
    // _mergeOnSignIn via SIGNED_OUT but TOKEN_REFRESHED confirms we're still online.
    // Clear the flag and cancel/hide the banner so it doesn't linger.
    _mergeOnSignIn=false;clearTimeout(window._offlineBannerTimer);_hideOfflineBanner();
    // Pull latest state immediately, realtime sockets don't replay missed events,
    // so any changes from other devices during the outage need an explicit pull.
    if(_supaUser&&!_loadInProgress)supaLoadFromCloud({silent:true});
    return;
  }
  _showOfflineBanner(true);
  try{
    // Case 4: offline writes pending. PULL-FIRST REBASE, the old push-first order
    // upserted this device's WHOLE stale rows over everything peers committed during
    // the outage (the offline-return clobber: our copy of a shared row still carries
    // the pre-outage values of every field a peer edited meanwhile, and peers' own
    // copies aren't "pending" so nothing protects them from our upsert). Instead:
    //   1. cancel the queued debounce push, its edits are already op-logged (durable
    //      IndexedDB, stamped at edit time) and still in memory, nothing is lost;
    //   2. PULL: the load's per-field rebase overlays our pending offline edits onto
    //      the fresh server state (field clocks protect exactly what we changed);
    //   3. PUSH the merged result + our ops, peers converge field-by-field.
    if(_syncTimer){clearTimeout(_syncTimer);_syncTimer=null;}
    if(_pendingSavePromise){try{await _pendingSavePromise;}catch(_e){}}
    // Snapshot BEFORE the pull: a reconnect must NEVER lose in-memory work. The delta
    // path merges (nothing to lose), but the cursorless FULL fallback replaces the
    // arrays, and the op-log re-append can't rescue rows when IndexedDB is unavailable
    // (private browsing / blocked storage). Merge back whatever the pull dropped,
    // except ids this device deliberately deleted, and the push below re-uploads any
    // row the cloud genuinely lacks (no synced hash → treated as changed).
    const _preSnap=_TD_TABLES.map(({t,get})=>({t,rows:(get()||[]).slice()}));
    await supaLoadFromCloud({silent:true});
    try{
      let _merged=false;
      for(const{t,rows}of _preSnap){
        const tdef=_TD_TABLES.find(x=>x.t===t);if(!tdef)continue;
        const arr=tdef.get()||[];
        const have=new Set(arr.map(r=>String(r.id)));
        const del=_locallyDeletedIds[t];
        const peerDel=_lastLoadDeletes[t];
        for(const r of rows){const id=String(r.id);if(!have.has(id)&&!(del&&del.has(id))&&!(peerDel&&peerDel.has(id))){arr.push(r);_merged=true;}}
      }
      if(_merged&&typeof renderDash==='function')renderDash();
    }catch(_e){}
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
    _hideOfflineBanner(); // connection confirmed, hide immediately, sync in background
    // No active user, try silent session restore regardless of _mergeOnSignIn.
    // _mergeOnSignIn is only true after involuntary SIGNED_OUT; after deliberate sign-out
    // the flag stays false, but we still want to re-auth when the backup token is present.
    if(_supa&&!_supaUser&&!_sessionRestoreInProgress){
      const _bk=(()=>{try{return JSON.parse(localStorage.getItem('zp3_session_backup')||'null');}catch(_e){return null;}})();
      if(_bk?.access_token&&_bk?.refresh_token){
        _sessionRestoreInProgress=true;
        _supa.auth.setSession(_bk).then(({data:{session}})=>{
          _sessionRestoreInProgress=false;
          if(!session){
            // Refresh token confirmed expired (not a network error, Supabase returned null).
            // Clear the stale backup so future probes don't keep trying it.
            localStorage.removeItem('zp3_session_backup');
            supaShowLogin({force:true});
            return;
          }
          if(!_supaUser){
            // Auth event hasn't fired yet, drive reconnect ourselves
            _supaUser=session.user;
            _saveSessionBackup(session);
            _mergeOnSignIn=false;
            _onReconnect();
          }
          // If auth event already set _supaUser, reconnect was handled there
        }).catch(()=>{
          // Network error during token exchange, don't show login, retry on next probe
          _sessionRestoreInProgress=false;
        });
      }
      // No backup, stay on current screen; don't call supaShowLogin() repeatedly from tick
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
    // Flush offline-pending to localStorage the moment the app is backgrounded,
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
// ── DELTA LOAD (incremental cold sign-in) ────────────────────────────────────
// The full-account read on every sign-in is O(all data) and times out on big
// accounts. Delta load pulls ONLY rows changed since this device's last visit
// (server updated_at > cursor), merged onto the cached snapshot. Safe by design:
// ANY doubt (no cache, account mismatch, missing cursor, query error) falls back
// to the full load; and _syncedHash reflects cloud (written only after a save
// confirms), so a locally-edited-unsaved row keeps its OLD hash and still
// re-uploads on the next save, the delta merge never marks local edits synced.
let _deltaCursor=null;
function _readDeltaMeta(uid){
  try{
    const m=JSON.parse(localStorage.getItem('zp3_delta_meta')||'null');
    if(!(m&&m._owner===uid&&m.cursor))return null;
    // SELF-HEAL a poisoned sidecar: a cursor in the future (written before the cursor
    // clamp existed, off a far-future legacy locked row) would make every delta return
    // 0 rows forever. Reject it → this load falls back to FULL and re-establishes a
    // sane cursor. 60s slack matches the write-side clamp.
    if(m.cursor>new Date(Date.now()+60000).toISOString())return null;
    return m;
  }catch(_e){return null;}
}
// Paint the cached full snapshot into the live arrays (in place, via each table's
// set) so the delta merge has a complete base. Returns false when there is no
// cache for THIS account → caller full-loads.
function _paintCacheForDelta(uid){
  try{
    const cc=JSON.parse(localStorage.getItem('zp3_cloud_cache')||'null');
    if(!cc||cc._owner!==uid)return false;
    const byKey={td_clients:cc.clients,td_bids:cc.bids,td_jobs:cc.jobs,td_income:cc.income,td_expenses:cc.expenses,td_mileage:cc.mileage,td_payments:cc.payments,td_liens:cc.liens,td_time_entries:cc.timeEntries,td_licenses:cc.licenses,td_events:cc.events,td_contracts:cc.contracts,td_agreements:cc.agreements,td_photos:cc.photos,td_maintenance:cc.maintenance};
    const _ptTs=Date.now();
    for(const{t,set}of _TD_TABLES){
      const rows=Array.isArray(byKey[t])?byKey[t]:[];
      set(rows);
      // Painted rows came from the cloud-derived cache → in sync as of NOW for the merge's
      // pending-gate. Conservative on purpose: field clocks rehydrated from the op log are
      // all OLDER than this boot, so none can wrongly "protect" a stale value against a
      // peer's update. Genuinely-unsaved offline edits don't rely on the merge, they ride
      // the zp3_offline_pending merge + reconnect flush, which re-uploads them wholesale.
      _rowSyncedAt[t]=new Map(rows.map(r=>[String(r.id),_ptTs]));
    }
    if(cc.checksState&&Object.keys(cc.checksState).length)checksState=cc.checksState;
    return true;
  }catch(_e){return false;}
}
function _writeLocalCache(){
  try{
    const _snap={_owner:(_supaUser&&_supaUser.id)||_loadedDataOwner||null,clients,bids,jobs,payments,income,
      expenses:expenses.map(({receipt_img,...r})=>r),
      mileage,liens,timeEntries,licenses,events,contracts,agreements,photos,maintenance,checksState,
      settings:S,cached_at:new Date().toISOString()};
    localStorage.setItem('zp3_cloud_cache',JSON.stringify(_snap));
    // Delta sidecar: the server-updated_at cursor + known-cloud hashes, owner-scoped.
    // Only written once a load has established a cursor for this account.
    if(_snap._owner&&_deltaCursor){
      const _h={};for(const k of Object.keys(_syncedHash))_h[k]=[..._syncedHash[k]];
      localStorage.setItem('zp3_delta_meta',JSON.stringify({_owner:_snap._owner,cursor:_deltaCursor,syncedHash:_h}));
    }
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

  // Sanity guard, refuse to push if critical arrays unexpectedly empty vs cache.
  // A deliberate "Clear all data" wipe (_deliberateWipe) is the one legitimate way the
  // arrays empty out, so it bypasses the guard and the sweep soft-deletes for real.
  if(_loadedFromCacheOnly&&!_deliberateWipe){
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

  // Derive ops for anything not yet captured (direct supaSaveToCloud callers bypass the
  // debounce): idempotent: the incremental baseline makes a second derive a no-op.
  // Runs BEFORE any network so even a save that throws (offline) has persisted its intent;
  // that durable intent is what the reconnect rebase replays over the server state.
  _opShadowDerive();
  // Ack ceiling: every op at-or-below this HLC is embodied in the state THIS save uploads
  // (sampled after the derive above, so this save's own ops are covered). On success they
  // are pruned; ops minted during the in-flight save carry later HLCs and stay pending.
  const _opAckCeiling=window._opLogShadow?(()=>{try{return _hlcNow();}catch(_e){return null;}})():null;

  const _attemptId=Date.now()+'-'+Math.random().toString(36).slice(2,5);
  const _mileCount=mileage.length;
  _lastLocalSaveAt=Date.now();
  _logSave('start',{id:_attemptId,mileage:_mileCount,page:document.querySelector('.pg.active')?.id});

  // Force-quit safety net, written before any async work
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

    // NOTE: settings + the zj_data sync cursor are written LAST, AFTER the table loop below
    // (see the "SETTINGS + SYNC CURSOR" block). Writing zj_data.updated_at after every td_* row
    // has committed is what fixes the cross-device read-skew, a peer can never read a fresh
    // cursor over stale table data. It also means ONE zj_data write per save (not a settings-first
    // write + a separate marker), so a peer's reload path has a single event to coalesce.

    // Count of rows this save actually wrote (upserts + soft-deletes) across ALL tables.
    // Drives the LAST-WRITTEN sync marker below: the cross-device cursor (zj_data.updated_at)
    // may only advance once every td_* row is committed, see the marker note after the loop.
    let _tableWrites=0;
    // Batch upsert helper: upserts all live records, soft-deletes any that vanished
    const _upsertTable=async(tbl,arr,txFn)=>{
      const rows=(txFn?txFn(arr):arr);
      const currentIds=new Set(rows.map(r=>String(r.id)));
      _syncedHash[tbl]||=new Map();
      const hashes=_syncedHash[tbl];
      // DELTA: upload ONLY rows whose content hash changed since the last sync (or is
      // unknown). The hash is computed over `r` here: the exact post-txFn payload that
      // becomes the DB `data` column: so it round-trips against the load-side rebuild.
      // Computed BEFORE any network so an unchanged table can short-circuit entirely.
      let changed=[];
      for(const r of rows){
        const id=String(r.id);
        const h=_hashPayload(r);
        if(hashes.get(id)===h){ window._deltaStats.skips++; continue; }
        // archived_at:null mirrors deleted_at:null: a LIVE row in memory is by
        // definition not archived, so a re-created/edited id resurfaces on every
        // device (without this, a swept-then-recreated id stayed archived and
        // invisible: the offline-reconnect race caught it live).
        changed.push({id,h,row:{id,user_id:uid,data:r,updated_at:ts,deleted_at:null,archived_at:null}});
      }
      const _pendingDeletes=(_locallyDeletedIds[tbl]&&[..._locallyDeletedIds[tbl]].some(id=>(_lastKnownIds[tbl]||new Set()).has(id)&&!currentIds.has(id)))||false;
      // NO-OP FAST PATH, nothing changed and nothing pending deletion: ZERO round-trips.
      // Before this, a completely idle save still paid one lockedRows SELECT per table
      // (14 sequential reads) every ~2s during editing, the per-save cost that made the
      // bloated-account saves crawl and (at scale) would do the same to any heavy customer.
      // The lockedRows read only matters when we're about to WRITE this table, so it moves
      // below the short-circuit. _lastKnownIds still refreshes so the sweep stays correct.
      if(!changed.length&&!_pendingDeletes){_lastKnownIds[tbl]=currentIds;return;}
      // Fetch server-locked records (updated_at > 1 year from now = admin-deleted, must not overwrite)
      const lockCutoff=new Date(Date.now()+365*24*60*60*1000).toISOString();
      const{data:lockedRows}=await _supa.from(tbl).select('id').eq('user_id',uid).gt('updated_at',lockCutoff);
      const lockedIds=new Set((lockedRows||[]).map(r=>String(r.id)));
      if(lockedIds.size){
        // Evict locked records from local memory so they don't resurface
        const tdef=_TD_TABLES.find(x=>x.t===tbl);
        if(tdef?.set) tdef.set(rows.filter(r=>!lockedIds.has(String(r.id))));
        lockedIds.forEach(id=>currentIds.delete(id));
        changed=changed.filter(c=>!lockedIds.has(c.id));
      }
      if(changed.length){
        // Upsert in batches of 50. Write the synced hash ONLY AFTER each batch resolves
        // with no error, never optimistically, so a thrown batch (→ pending_sync retry)
        // never marks un-sent rows as "synced" and silently drops them next save.
        for(let i=0;i<changed.length;i+=50){
          const slice=changed.slice(i,i+50);
          let{error}=await _supa.from(tbl).upsert(slice.map(c=>c.row),{onConflict:'id,user_id'});
          // DB predating the archival migration: retry the batch without archived_at.
          if(error&&/archived_at/i.test(error.message||'')){
            ({error}=await _supa.from(tbl).upsert(slice.map(c=>{const{archived_at:_a,...r}=c.row;return r;}),{onConflict:'id,user_id'}));
          }
          if(error)throw error;
          const _upTs=Date.now();
          slice.forEach(c=>{hashes.set(c.id,c.h);(_rowSyncedAt[tbl]||(_rowSyncedAt[tbl]=new Map())).set(c.id,_upTs);}); // uploaded → in sync as of now (ends the merge's pending window)
          window._deltaStats.upserts+=slice.length;_tableWrites+=slice.length;
          // Diagnostic: NAME each uploaded row (tbl:id) so a delta-count assertion
          // failure reports WHICH rows uploaded, not just how many (§11.1:
          // instrument, don't guess). Capped so a full-account first save can't bloat.
          try{const _dr=(window._deltaStats.rows||(window._deltaStats.rows=[]));if(_dr.length<200)slice.forEach(c=>_dr.push(tbl+':'+c.id));}catch(_e){}
        }
      }
      // Remove ONLY ids the user EXPLICITLY removed on this device (recorded in
      // _locallyDeletedIds): or everything vanished, during a deliberate bulk wipe.
      // A row merely absent from this snapshot (e.g. a peer's row not yet merged here)
      // is NEVER swept, so concurrent devices can't clobber each other's new rows.
      //
      // DELETE vs ARCHIVE are SEPARATE (owner directive):
      //   • ARCHIVE = automatic, time-based (7-year rule, archive_old_records), keeps
      //     everything, just moves old rows out of the hot set.
      //   • DELETE = a rare, DELIBERATE removal via the hidden press-and-hold-the-record
      //     gesture (no delete buttons anywhere). It soft-deletes (deleted_at): the row
      //     leaves every device's view but STAYS in the table forever ("keep everything
      //     in"), never a hard delete. Still swept ONLY for ids the user explicitly
      //     removed on THIS device (_locallyDeletedIds), never a merely-absent peer row.
      const prev=_lastKnownIds[tbl]||new Set();
      const deleted=_locallyDeletedIds[tbl]||new Set();
      const gone=[...prev].filter(id=>!currentIds.has(id)&&!lockedIds.has(id)&&deleted.has(id));
      if(gone.length){
        for(let i=0;i<gone.length;i+=50){
          const{error:_de}=await _supa.from(tbl).update({deleted_at:ts,updated_at:ts}).in('id',gone.slice(i,i+50)).eq('user_id',uid);
          if(_de)throw _de;
        }
        _tableWrites+=gone.length;
      }
      gone.forEach(id=>{deleted.delete(id);hashes.delete(id);}); // delete-intent consumed; drop the swept row's hash so a re-create re-uploads
      _lastKnownIds[tbl]=currentIds;
    };

    // Never write back a table the server redacted for this employee, its
    // in-memory money fields are zeroed, and upserting them would overwrite the
    // contractor's real amounts. Permission-derived so it holds even if the RPC
    // fell back to a raw load. Contractors skip nothing.
    const _saveSkip=_employeeRedactedTables();
    // PARALLEL: the 14 tables are disjoint, so their upserts/sweeps run concurrently,
    // wall time collapses from 14 sequential round-trips to ~1 (the slowest table). The
    // read-skew invariant is untouched: the SETTINGS + SYNC CURSOR block below runs only
    // after this Promise.all resolves, i.e. after EVERY table's writes have committed.
    await Promise.all(_TD_TABLES.map(async({t,get,tx})=>{
      if(_saveSkip.has(t))return;
      const arr=get();
      try{
        await _upsertTable(t,arr,tx);
      }catch(_te){
        // Unprovisioned table (migration not yet applied), skip it, keep syncing the
        // rest. Without this, one missing table flips the whole app to offline/error.
        if(_isMissingTableErr(_te)){console.warn('[cloud] skipping save to unprovisioned table',t);return;}
        throw _te;
      }
    }));

    // ── SETTINGS + SYNC CURSOR, written LAST (fixes the cross-device read-skew) ──
    // zj_data.updated_at is the cursor every peer polls ("changed → reload"). Writing it AFTER
    // the whole table loop has awaited (⇒ committed) every upsert/soft-delete guarantees the
    // invariant peers rely on: "cursor moved ⇒ ALL table data is already committed", so a peer
    // can never read a fresh cursor over stale data (the read-skew that stuck B one edit behind).
    // Settings ride the SAME write, ONE zj_data event per save, not a settings-first write plus
    // a separate marker, so a peer's reload path has a single event to coalesce (no render storm).
    // Trade-off vs the old settings-first: a force-quit AFTER the tables but BEFORE this write
    // loses only the (tiny) settings delta; the bigger table data has already committed.
    if(!_isEmployee && _authSettingsLoaded){
      // Strip only stateRates (anon-readable reference data, never a user setting).
      // locationGranted/locationDenied DO persist so the location permission survives a reload.
      const{stateRates:_sr0,...sForCloud}=S;
      // LAST-WRITER-WINS by settingsTs: never overwrite a NEWER cloud settings blob with our
      // (possibly stale) copy, but if that happens we STILL bump the cursor when our table rows
      // changed, else the peer that owns the newer settings would never learn of our records.
      let _skipSettings=false,_peerMovedCursor=false;
      try{
        const{data:_curS}=await _supa.from('zj_data').select('settings,updated_at').eq('user_id',uid).maybeSingle();
        if(_curS&&_curS.settings){
          const _curTs=(()=>{try{return (JSON.parse(_curS.settings).settingsTs)||0;}catch(_e){return 0;}})();
          if(_curTs>(S.settingsTs||0))_skipSettings=true;
        }
        // ANTI-BLINDING: our write below overwrites the cursor, and with it, the heartbeat's
        // memory of any PEER save we haven't loaded yet. If the server cursor already moved
        // past what this device last saw, a peer changed something between our last load and
        // this save; queue a reconcile NOW (it runs after this save completes) or the change
        // would become invisible to the heartbeat forever (observed live: B's background save
        // masked A's delete and B kept the deleted bid indefinitely).
        if(_curS&&_curS.updated_at&&window._lastZjUpdatedAt&&_curS.updated_at!==window._lastZjUpdatedAt)_peerMovedCursor=true;
      }catch(_e){}
      if(navigator.webdriver){try{(window._zjWrites=window._zjWrites||[]).push({g:sForCloud.goalMonthly,ts:sForCloud.settingsTs,skip:_skipSettings,cl:_supaCloudLoaded,foc:_loadedFromCacheOnly,page:document.querySelector('.pg.active')?.id||null});}catch(_e){}}
      if(_skipSettings){
        _logSave('skip-settings','cloud settingsTs is newer, not clobbering with a stale local copy');
        // Cursor-only bump so our table changes still propagate to the peer with newer settings.
        if(_tableWrites>0){
          try{const _cTs=new Date().toISOString();const{data:_ck}=await _supa.from('zj_data').update({updated_at:_cTs}).eq('user_id',uid).select('updated_at').single();if(_ck?.updated_at)window._lastZjUpdatedAt=_ck.updated_at;}catch(_e){}
        }
      }else{
        const _wTs=new Date().toISOString();
        const{data:_zjRow,error:_se0}=await _supa.from('zj_data').upsert(
          {user_id:uid,settings:JSON.stringify(sForCloud),checks_state:JSON.stringify(checksState),updated_at:_wTs},
          {onConflict:'user_id'}
        ).select('updated_at').single();
        if(_se0){throw _se0;}
        window._lastZjUpdatedAt=_zjRow?.updated_at||_wTs;
      }
      // Catch up on the peer change our cursor overwrite just masked (see the pre-read note).
      if(_peerMovedCursor)_scheduleReconcile(800);
    } else if(!_isEmployee && !_authSettingsLoaded){
      // Cloud settings haven't hydrated yet (fresh/cache-wiped boot). Do NOT push the default
      // blob over the cloud (the boot clobber), defer to the post-load flush.
      _logSave('skip-settings','settings not hydrated, deferring to post-load flush');
      try{localStorage.setItem('zp3_pending_sync','1');}catch(_e){}
    } else if(_isEmployee && !_devSupportMode && _tableWrites>0){
      // CREW SAVE CURSOR BUMP: crew can't write zj_data (settings stay owner-private),
      // but "cursor moved ⇒ all data committed" must hold for crew writes too, else
      // every peer's heartbeat/delta goes blind to crew edits and only best-effort
      // realtime carries them. The SECURITY DEFINER RPC bumps ONLY updated_at, and
      // runs AFTER the table loop above committed, preserving the read-skew invariant.
      // Missing RPC (old server) → realtime row events still carry the edits.
      try{
        const{data:_bc}=await _supa.rpc('bump_account_cursor',{target:uid});
        if(_bc)window._lastZjUpdatedAt=_bc;
      }catch(_e){}
    }

    _logSave('ok',{id:_attemptId,mileage:_mileCount});
    // Ops epilogue (fire-and-forget, never blocks the save). ORDER MATTERS:
    // 1. _opSyncOps PUBLISHES this device's pending ops to td_ops (pruning each pushed
    //    batch) and pulls+applies peers', the per-field channel that lets N writers
    //    hit the SAME row. Publish must come first or the ack-prune below would silently
    //    eat the per-field intent peers need.
    // 2. _opDbPruneAcked then bounds the log: anything ≤ the ceiling that FAILED to
    //    publish (td_ops missing/unreachable) is dropped anyway, this save's rows
    //    already embody it in the cloud, so nothing is pending; peers degrade to
    //    row-level sync for exactly those edits instead of the log growing forever.
    if(window._opLogShadow){try{_opSyncOps().then(()=>_opDbPruneAcked(_opAckCeiling)).catch(()=>{});}catch(_e){}}
    localStorage.removeItem('zp3_pending_sync');
    localStorage.removeItem('zp3_offline_pending');
    _writeLocalCache();
    _hideOfflineBanner();
    supaSetStatus('synced');
    // Signal other open devices to reload (send() is async, catch the rejection so it never bubbles)
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

// Egress guard: after the first full poll of a session, only rows whose
// updated_at moved past this watermark are fetched, a steady-state 30s tick
// returns ZERO rows instead of re-downloading 100 rows of base64 signature
// images (the standing multi-GB/day leak that blew the Supabase egress cap).
// In-memory on purpose: every fresh page load does one full pass (which also
// serves the "data may have been reset" re-assert), then goes delta.
let _sigPollWatermark=null;
// sig-feed channel health. _sigFeedReady mirrors _tdRealtimeReady's contract; the
// down-flag makes recovery observable: SUBSCRIBED after a failure → one immediate
// catch-up sweep (realtime is at-most-once, pushes during the outage are gone).
let _sigFeedReady=false,_sigFeedDown=false;
function _sigFeedStatus(status){
  if(status==='SUBSCRIBED'){
    const wasDown=_sigFeedDown;
    _sigFeedReady=true;_sigFeedDown=false;
    if(wasDown){checkNewSignatures('rejoin');_fetchProposalViews();}
  }else if(status==='CLOSED'||status==='CHANNEL_ERROR'||status==='TIMED_OUT'){
    _sigFeedReady=false;_sigFeedDown=true;
    try{if(window._obs)_obs.track('sig_feed_down_'+String(status).toLowerCase());}catch(_e){}
  }
}
// Applies one signed_proposals row's decline/signed state to its local bid.
// Shared by the live poll loop below and _reconcilePendingSigStatuses, so the
// two paths can never drift apart on what "declined" vs "signed" means.
// Returns true if it mutated the bid.
function _applySigStatusToBid(bid,s){
  let changed=false;
  if(s.payment_status==='declined'){
    // Client declined, mark as Closed Lost, not Closed Won
    if(bid.status!=='Closed Lost'){
      bid.status='Closed Lost';bid.draft=false;
      bid.declinedAt=s.signed_at;
      changed=true;
    }
    // Client-picked reason (sign.html's decline modal), same field a
    // contractor's own manual "Mark Lost" action populates, so it shows
    // up in the Declined tab / dashboard with no new UI needed.
    if(s.decline_reason&&bid.lostReason!==s.decline_reason){
      bid.lostReason=s.decline_reason;bid.lostAt=bid.lostAt||s.signed_at;
      changed=true;
    }
  }else{
    if(bid.status!=='Closed Won'){
      // Always fix the status regardless of seenCache, data may have been reset
      bid.status='Closed Won';bid.draft=false;
      bid.signedAt=s.signed_at;
      bid.signedName=s.client_signed_name||s.client_name;
      bid.paymentMethod=s.payment_method;
      changed=true;
    }
    // Refresh signature metadata even when already won, the signature image and
    // EPA ack can land after the status flip (or the DB columns were added later).
    if(s.signature_data&&bid.signatureData!==s.signature_data){bid.signatureData=s.signature_data;changed=true;}
    if(s.epa_ack_at&&bid.epaAckAt!==s.epa_ack_at){bid.epaAckAt=s.epa_ack_at;changed=true;}
    if(s.client_signed_name&&!bid.signedName){bid.signedName=s.client_signed_name;changed=true;}
    if(s.signed_at&&!bid.signedAt){bid.signedAt=s.signed_at;changed=true;}
  }
  return changed;
}
// Self-heals bids whose status is stuck out of sync with signed_proposals, e.g.
// a decline landed while this contractor's account had already accumulated
// 100+ more recent signed_proposals rows: checkNewSignatures' full poll only
// ever looks at the most recent 100 (ordered by signed_at), and the delta poll
// only looks past its watermark, so an old stale row can never resurface
// through either path. This runs a direct lookup on the small set of bids
// still showing "Pending" with a signingToken (however few that is, regardless
// of total signature volume), so drift like that gets corrected for good.
async function _reconcilePendingSigStatuses(){
  if(!_supa||!_supaUser)return;
  const pending=(typeof bids!=='undefined'?bids:[]).filter(b=>b.signingToken&&b.status==='Pending'&&b.id);
  if(!pending.length)return;
  try{
    const{data,error}=await _supa.from('signed_proposals')
      .select('*')
      .eq('contractor_user_id',_supaUser.id)
      .in('bid_id',pending.map(b=>String(b.id)));
    if(error||!data||!data.length)return;
    let changed=false;
    data.forEach(s=>{
      const bid=pending.find(b=>String(b.id)===String(s.bid_id));
      if(bid&&_applySigStatusToBid(bid,s))changed=true;
    });
    if(changed){
      saveAll();
      renderDash();
      if(typeof renderProposalsPage==='function')renderProposalsPage();
    }
  }catch(e){console.warn('reconcilePendingSigStatuses:',e);}
}
let _checkSigsPending=false;
async function checkNewSignatures(_src){
  // Coalescing guard: a call landing while another run is in flight must NOT be
  // dropped: with the sig-feed push handler firing on every account-wide insert,
  // a push-triggered run can hold the busy flag at the exact moment the 30s tick
  // (or a second push) arrives. Dropping that call meant a real signature waited
  // for the next poll tick. Instead: remember it, and rerun ONCE after the
  // in-flight run finishes, every caller is now guaranteed a poll that STARTED
  // after their call.
  if(_checkSigsBusy){_checkSigsPending=true;return;}
  if(!_supa||!_supaUser)return;
  _checkSigsBusy=true;
  try{
    // Use localStorage as the seen-list, no DB column dependency
    const seenCache=new Set(JSON.parse(localStorage.getItem('zp3_seen_sigs')||'[]'));
    // select('*'): optional columns (epa_*, cancelled_*) may not exist in every
    // environment; an explicit column list would fail the whole query on drift.
    const _fullPoll=()=>_supa.from('signed_proposals')
      .select('*')
      .eq('contractor_user_id',_supaUser.id)
      .order('signed_at',{ascending:false})
      .limit(100);
    let data,error;
    const _wasFullPoll=!_sigPollWatermark;
    if(_sigPollWatermark){
      // Delta poll: INSERTs land with updated_at=now(); every mutation the loop
      // below cares about (cancellation, remote CO signing, payment-status flip)
      // is an UPDATE, which the td_touch_updated_at trigger re-surfaces here.
      ({data,error}=await _supa.from('signed_proposals')
        .select('*')
        .eq('contractor_user_id',_supaUser.id)
        .gt('updated_at',_sigPollWatermark)
        .order('updated_at',{ascending:false})
        .limit(100));
      // Drift-safe: an environment without the updated_at column (migration not
      // applied) errors here, fall back to the full poll, the pre-fix behavior.
      if(error)({data,error}=await _fullPoll());
    }else{
      ({data,error}=await _fullPoll());
    }
    if(error)throw error;
    // Advance the watermark from whatever came back. ISO timestamps in one fixed
    // format compare correctly as strings. Rows without updated_at (un-migrated
    // database) leave the watermark null, every poll stays full, exactly as today.
    (data||[]).forEach(s=>{if(s.updated_at&&(!_sigPollWatermark||s.updated_at>_sigPollWatermark))_sigPollWatermark=s.updated_at;});
    if(data&&data.length){
      let changed=false;const alerts=[];const newSeen=[];const coSignedAlerts=[];
      for(const s of data){
        const key=String(s.bid_id);
        const alreadySeen=seenCache.has(key);
        const bid=bids.find(b=>String(b.id)===key);
        if(!bid){if(!alreadySeen)newSeen.push(key);continue;} // deleted/orphaned
        // Client cancelled within the rescission window (e-signed Notice of Cancellation).
        // Runs before the signed/declined branches and regardless of seenCache, the
        // cancellation always arrives after the signature row was already seen.
        if(s.cancelled_at){
          if(!bid.clientCancelled){
            bid.clientCancelled=true;
            bid.cancelledAt=s.cancelled_at;
            bid.cancelledName=s.cancelled_signed_name||'';
            bid.status='Closed Lost';bid.draft=false;
            // Cancel the linked job too, 'canceled' removes it from every active-job
            // query (today feed, schedule, collect) while keeping the record.
            const _cj=(typeof jobs!=='undefined'?jobs:[]).find(j=>j.bid_id===bid.id);
            if(_cj){_cj.clientCancelled=true;_cj.status='canceled';}
            // Clawback: reverse every recorded payment on this bid so the books reflect
            // the legally required refund (K.S.A. 50-640 / 16 CFR 429: within 10 business days)
            const _cpaid=(typeof payments!=='undefined'?payments:[]).filter(p=>p.bid_id===bid.id&&p.amount>0);
            const _ctotal=_cpaid.reduce((t,p)=>t+p.amount,0);
            const _hasRefund=(typeof payments!=='undefined'?payments:[]).some(p=>p.bid_id===bid.id&&p._cancelRefund);
            if(_ctotal>0&&!_hasRefund){
              payments.push({id:Date.now(),bid_id:bid.id,amount:-_ctotal,date:todayKey(),method:'refund',type:'refund',_cancelRefund:true,note:'Refund: client cancelled within rescission window'});
            }
            changed=true;
            const _isStripe=s.payment_method&&s.payment_method!=='cash'&&s.payment_method!=='check';
            const _refundDays=_isStripe?'5–7':'10';
            if(typeof showToast==='function')showToast('🚫 '+(s.client_name||'Client')+' cancelled: refund'+(_ctotal>0?' '+fmt(_ctotal):'')+' within '+_refundDays+' business days','⚠️');
          }else if(bid.status!=='Closed Lost'){
            // Re-assert the terminal state if a later sync path flipped it back
            bid.status='Closed Lost';changed=true;
          }
          // Always stop here: a cancelled row must never fall through to the signed
          // branch below, which would resurrect the bid to Closed Won on every sync.
          if(!alreadySeen)newSeen.push(key);
          continue;
        }
        // Change orders signed remotely in the client hub, apply to the local bid.
        // Mirrors _submitCOSign bookkeeping: mark the CO signed and roll bid.amount
        // to the new contract total (balance derives from payments via getBidBalance).
        // Runs regardless of seenCache, the signature lands after the row was seen.
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
        const _wasWon=bid.status==='Closed Won';
        if(_applySigStatusToBid(bid,s))changed=true;
        if(s.payment_status!=='declined'&&!_wasWon&&bid.status==='Closed Won'&&!alreadySeen){
          alerts.push({name:s.client_name||'Client',bidId:bid.id,clientId:bid.client_id,isPaid:s.payment_status==='paid'});
        }
        if(!alreadySeen)newSeen.push(key);
      }
      if(newSeen.length){
        newSeen.forEach(id=>seenCache.add(id));
        localStorage.setItem('zp3_seen_sigs',JSON.stringify([...seenCache].slice(-500)));
      }
      if(changed){
        // Delivery-source telemetry: was this signature caught by the realtime push
        // ('push'), the recovery sweep ('rejoin'), or the fallback poll (default)?
        // One counter per path answers "is realtime actually doing the work?" in
        // the analytics table, the number that proves push reliability in prod.
        if(alerts.length){try{if(window._obs)_obs.track('sig_delivered_'+(_src||'poll'));}catch(_e){}}
        saveAll();
        [...new Set([...alerts.map(a=>a.clientId),...coSignedAlerts.map(a=>a.clientId)])].forEach(cid=>_refreshClientHub(cid));
        coSignedAlerts.forEach(a=>{if(typeof showToast==='function')showToast('✍️ '+a.client+' signed Change Order #'+a.coNum+', contract now '+fmt(a.newTotal),'📋');});
        const existing=JSON.parse(localStorage.getItem('zp3_schedule_alerts')||'[]');
        localStorage.setItem('zp3_schedule_alerts',JSON.stringify([...existing,...alerts]));
        renderDash();
        if(coSignedAlerts.length&&typeof renderJobsPage==='function')renderJobsPage();
        if(typeof renderClientDetail==='function'&&typeof currentClientId!=='undefined'&&currentClientId)renderClientDetail();
        if(!window._showingScheduleAlert)setTimeout(showScheduleAlerts,400);
      }
    }
    // Once per fresh load only, piggybacking on the full poll: catches any bid
    // still stuck "Pending" that this poll's own 100-row/watermark window can't
    // reach. Fire-and-forget, it has its own error handling and never blocks
    // _checkSigsBusy.
    if(_wasFullPoll)_reconcilePendingSigStatuses();
  }catch(e){console.warn('checkNewSignatures:',e);}finally{
    _checkSigsBusy=false;
    if(_checkSigsPending){_checkSigsPending=false;checkNewSignatures(_src);}
  }
}
// The 30s fallback tick. Skips hidden tabs entirely, a backgrounded tab can't
// show the signature alert anyway, and the existing visibilitychange handler
// re-runs both checks the instant the tab is foregrounded, so nothing is lost.
// Realtime (sig-feed channel) remains the primary, instant delivery path.
function _sigPollTick(){
  if(document.visibilityState==='hidden')return;
  checkNewSignatures();_fetchProposalViews();
}
let _pvPollWatermark=null;
async function _fetchProposalViews(){
  if(!_supa||!_supaUser)return;
  try{
    // Watermark probe (egress): steady state asks "is anything newer than what
    // I've seen?", at most ONE tiny row, instead of re-downloading 500 full
    // rows every 30s. Any change → the full rebuild below runs unchanged, so
    // the dict semantics (newest-first, atomic swap) never differ from today.
    // Drift-safe: no updated_at column (un-migrated env) → the probe errors →
    // full poll, the exact pre-fix behavior; rows without updated_at never arm
    // the watermark, so an un-migrated database stays on full polls forever.
    if(_pvPollWatermark){
      const{data:_probe,error:_pErr}=await _supa.from('proposal_views')
        .select('updated_at')
        .eq('contractor_user_id',_supaUser.id)
        .gt('updated_at',_pvPollWatermark)
        .order('updated_at',{ascending:false})
        .limit(1);
      if(!_pErr&&_probe&&!_probe.length)return; // nothing changed, zero-row tick
      // The probe row is the global max updated_at (desc, limit 1), advance from
      // it so an old row's update (outside the top-500 by opened_at below) can't
      // wedge the watermark into probing positive on every tick.
      if(!_pErr&&_probe)_probe.forEach(v=>{if(v.updated_at&&v.updated_at>_pvPollWatermark)_pvPollWatermark=v.updated_at;});
    }
    // Edge Function log-proposal-view writes to proposal_views using service key (bypasses RLS).
    // Contractor reads back with their authenticated session, RLS allows SELECT on own rows.
    // select('*') not an explicit list, furthest_step/_at may not exist yet in
    // every environment (migration drift), and an explicit list would fail the
    // whole query; same defensive pattern as checkNewSignatures above.
    // limit(500): this table grows forever and was fetched UNBOUNDED every 30s.
    // Any proposal a client is actively engaging with is in the newest 500 view
    // rows; older rows only feed stale badges on long-closed bids.
    const{data,error}=await _supa.from('proposal_views')
      .select('*')
      .eq('contractor_user_id',_supaUser.id)
      .not('bid_id','is',null)
      .order('opened_at',{ascending:false})
      .limit(500);
    if(data&&!error){
      data.forEach(v=>{if(v.updated_at&&(!_pvPollWatermark||v.updated_at>_pvPollWatermark))_pvPollWatermark=v.updated_at;});
      // Build into temporaries first, then swap atomically, prevents a renderDash()
      // mid-flight from seeing an empty dict during the rebuild window (flicker race).
      const _pvBid={},_pvHub={},_pvClient={},_pvCon={},_pvHubCnt={},_pvCliCnt={},_pvStep={},_pvStepAt={};
      data.forEach(v=>{
        if(!v.bid_id)return;
        if(!_pvBid[v.bid_id])_pvBid[v.bid_id]=v.opened_at;
        if(v.hub_opened_at&&!_pvHub[v.bid_id])_pvHub[v.bid_id]=v.hub_opened_at;
        if(v.client_opened_at&&!_pvClient[v.bid_id])_pvClient[v.bid_id]=v.client_opened_at;
        if(v.contractor_opened_at&&!_pvCon[v.bid_id])_pvCon[v.bid_id]=v.contractor_opened_at;
        if(v.hub_view_count)_pvHubCnt[v.bid_id]=(v.hub_view_count||0);
        if(v.client_view_count)_pvCliCnt[v.bid_id]=(v.client_view_count||0);
        if(v.furthest_step&&!_pvStep[v.bid_id]){_pvStep[v.bid_id]=v.furthest_step;_pvStepAt[v.bid_id]=v.furthest_step_at||null;}
      });
      // Render ONLY when the view data actually changed. This fetch runs after every
      // load (setTimeout 1500) and on a 30s interval, an unconditional renderDash()
      // here rebuilt the whole dashboard for byte-identical data on every tick, and
      // stacked 2-3 redundant render passes into every reconcile window (named live
      // by the glitch-free budget's caller trace). The maps still swap every time.
      const _pvSig=JSON.stringify([_pvBid,_pvHub,_pvClient,_pvCon,_pvHubCnt,_pvCliCnt,_pvStep]);
      const _pvChanged=_pvSig!==window._pvLastSig;
      window._pvLastSig=_pvSig;
      _proposalViewsByBid=_pvBid;
      _proposalViewsByBidHubClient=_pvHub;
      _proposalViewsByBidClient=_pvClient;
      _proposalViewsByBidContractor=_pvCon;
      _proposalViewsByBidHubCount=_pvHubCnt;
      _proposalViewsByBidClientCount=_pvCliCnt;
      _proposalViewsByBidStep=_pvStep;
      _proposalViewsByBidStepAt=_pvStepAt;
      if(_pvChanged)renderDash();
    }
  }catch(e){}
}
// Sign-flow warmth badge, one line telling the contractor how far the client
// actually got inside the proposal, rendered wherever a pending bid card shows
// its viewed state. 'opened' adds nothing beyond the existing viewed badge;
// 'signed' is redundant with the bid flipping Closed Won, both skipped.
function _signStepBadge(bidId){
  const step=(typeof _proposalViewsByBidStep!=='undefined'&&_proposalViewsByBidStep)?_proposalViewsByBidStep[String(bidId)]:null;
  if(!step)return'';
  const meta={
    approved:{label:'Reviewing: tapped Approve & Sign',color:'#0e7490'},
    signature_ready:{label:'Signature entered, almost there',color:'#7c3aed'},
    payment_viewed:{label:'Reached payment, hot lead',color:'#b45309'},
    method_selected:{label:'Chose how to pay, call them now',color:'#A32D2D'},
  }[step];
  if(!meta)return'';
  return'<div style="font-size:11px;font-weight:800;color:'+meta.color+';margin-top:2px">'+svgIcon('⚡',{size:11})+' '+meta.label+'</div>';
}
function showScheduleAlerts(){
  // Never pop over the boot spinner (owner report 2026-07-14: "popup scheduler
  // is coming in way before the spinner completely boots"). The boot poll can
  // find signatures within the first second, wait for the overlay to finish
  // its fade before surfacing the modal, retrying on a short timer.
  const _bootOv=document.getElementById('supa-boot-overlay');
  if(_bootOv&&_bootOv.isConnected&&getComputedStyle(_bootOv).display!=='none'&&parseFloat(getComputedStyle(_bootOv).opacity)>0.05){
    if(window._schedAlertWaiting)return; // one retry chain only, boot poll + 30s tick can both land here
    window._schedAlertWaiting=true;
    setTimeout(()=>{window._schedAlertWaiting=false;showScheduleAlerts();},700);
    return;
  }
  let alerts=JSON.parse(localStorage.getItem('zp3_schedule_alerts')||'[]');
  // Discard any alerts whose bid no longer exists locally, they can't be scheduled
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
    '<div style="text-align:center;font-size:32px;margin-bottom:6px">'+(a.isPaid?svgIcon('💰',{size:32}):svgIcon('🎉',{size:32}))+'</div>'+
    '<div style="font-size:18px;font-weight:800;text-align:center;margin-bottom:4px">New signature!'+moreNote+'</div>'+
    '<div style="font-size:14px;color:var(--text3);text-align:center;margin-bottom:20px">'+
      escHtml(a.name)+' signed their proposal'+payLine+'.'+
    '</div>'+
    '<button id="_sched-alert-yes" style="width:100%;padding:16px;border-radius:var(--r);border:none;background:var(--green);color:#fff;font-size:16px;font-weight:800;cursor:pointer;font-family:inherit;margin-bottom:'+((!_depositAlready&&_stripeReady&&_depositAmt>0)?'8px':'16px')+'">'+
      'Schedule now →'+
    '</button>'+
    ((!_depositAlready&&_stripeReady&&_depositAmt>0)?
      '<button id="_sched-alert-deposit" style="width:100%;padding:14px;border-radius:var(--r);border:none;background:#635BFF;color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:16px">'+
        svgIcon('💳')+' Collect '+fmt(_depositAmt)+' deposit now'+
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
    // Only re-queue if bid still exists, orphaned alerts die here
    const bidStillExists=window._currentScheduleAlert&&bids.find(b=>String(b.id)===String(window._currentScheduleAlert.bidId));
    if(bidStillExists)q.push(window._currentScheduleAlert);
    window._currentScheduleAlert=null;
    localStorage.setItem('zp3_schedule_alerts',JSON.stringify(q));
    window._showingScheduleAlert=false;
    // "Later" means LATER, silence the whole stack (owner directive 2026-07-14).
    // Chaining straight into showScheduleAlerts() here made N stacked alerts an
    // endless carousel: each Later re-queued the current one and popped the next.
    // The queue survives in localStorage; the next real trigger (new signature
    // event or app boot) re-surfaces it.
    if(q.length)showToast(q.length+' client'+(q.length>1?'s':'')+' waiting to schedule, find them under Jobs','📋');
  });
}
function deferScheduleAlert(){
  document.getElementById('sched-suggest-overlay')?.remove();
  if(window._currentScheduleAlert){
    const q=JSON.parse(localStorage.getItem('zp3_schedule_alerts')||'[]');
    q.push(window._currentScheduleAlert);
    localStorage.setItem('zp3_schedule_alerts',JSON.stringify(q));
    window._currentScheduleAlert=null;
    window._showingScheduleAlert=false;
    // Same "Later means later" rule as the alert modal, never chain into the
    // next alert here (the old setTimeout(showScheduleAlerts) loop).
    if(q.length)showToast(q.length+' client'+(q.length>1?'s':'')+' waiting to schedule','📋');
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

  const smsMsg='Hey '+firstName+'! It\'s '+bname+'. Great news, you\'re all set. 🎨\n\nOur next available start date is '+startLabel+'. Does that work for you?\n\nJust reply YES and we\'ll lock you in!';
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
      (phone?'<a href="'+smsHref+'" style="display:block;padding:13px;border-radius:var(--r);border:none;background:#27AE60;color:#fff;font-size:15px;font-weight:700;text-align:center;text-decoration:none">'+svgIcon('📱')+' Text '+escHtml(firstName||'')+' to confirm</a>':'')+
      (callHref?'<a href="'+callHref+'" style="display:block;padding:11px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);font-size:14px;font-weight:600;text-align:center;text-decoration:none">'+svgIcon('📞')+' Call '+escHtml(firstName||'')+'</a>':'')+
    '</div>'+
    '<button id="sched-lock-btn" onclick="quickScheduleJob('+bidId+',\''+startKey+'\','+clientId+')" style="width:100%;padding:14px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:8px">✓ Lock it in, '+startLabel+'</button>'+
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
  const name=(bid.client_name||bid.name||'Job')+(bid.type?', '+bid.type:'');
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
    {title:svgIcon('✓')+' Scheduled!',yes:'View calendar',no:_nextAlerts.length?'Next client ('+_nextAlerts.length+')':'Done',danger:false,
    onNo:()=>setTimeout(showScheduleAlerts,300)}),400);
}
function discardInProgressBid(bidId){
  // String-cast compare: a realtime-delivered bid can land with a string id (Postgres
  // bigint columns serialize as strings) while this button's onclick always embeds a bare
  // numeric literal (string-concatenated into the HTML attribute loses any quotes). A strict
  // === here silently no-ops the whole delete, confirmed via regression test below.
  const _db=bids.find(b=>String(b.id)===String(bidId));
  const _cid=_db?.client_id;
  zConfirm('Delete this pending bid? The client\'s signing link will stop working.',()=>{
    const idx=bids.findIndex(b=>String(b.id)===String(bidId));
    if(idx>-1){_userDelete(()=>{bids.splice(idx,1);saveAll();});renderDash();
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
  saveAll();openGenericEstimate(getClientById(b.client_id),bidId,b.trade_type||'general');
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
  if(_loadInProgress)return _activeLoadPromise; // AWAIT the in-flight load, a silent no-op here lets _supaCloudLoaded flip true before the merge lands (settings-reboot race)
  _loadInProgress=true;
  let _resolveActiveLoad;_activeLoadPromise=new Promise(r=>{_resolveActiveLoad=r;});
  window._lastCloudLoadAt=Date.now();
  if(silent){
    // Server state wins, cancel any pending debounce without flushing it.
    // Flushing stale local data before loading would re-insert records deleted on another device.
    if(_syncTimer){clearTimeout(_syncTimer);_syncTimer=null;}
    // But DO wait for an already in-flight save (e.g. an offline worker's reconnect flush) to
    // commit first, else this load reads a cloud snapshot taken BEFORE that save landed and
    // set(rows) drops the just-saved row out of memory (the offline/reconnect race).
    // BOUNDED: wait at most 4s. An unbounded await here WEDGED the whole reconcile backstop,
    // this load holds _loadInProgress while waiting, every heartbeat tick skips on it, and a
    // slow/hung background save (bloated account, stalled fetch) starved convergence past the
    // test window (the live A→B delete failure). If the save is still in flight after 4s we
    // DEFER: never load concurrently with a save (that reopens the lost-edit race); release
    // _loadInProgress and retry shortly. Each retry re-waits, so convergence resumes the
    // moment the save resolves (and the fetch timeout guarantees it eventually does).
    if(_pendingSavePromise){
      const _saveDone=await Promise.race([
        _pendingSavePromise.then(()=>true,()=>true),
        new Promise(r=>setTimeout(()=>r(false),4000)),
      ]);
      if(!_saveDone){
        _loadInProgress=false;
        if(_resolveActiveLoad)_resolveActiveLoad();
        _activeLoadPromise=null;
        _scheduleReconcile(1500);
        return;
      }
    }
  }else{
    if(_syncTimer){try{await _flushSaveNow();}catch(e){}}
    else if(_pendingSavePromise){try{await _pendingSavePromise;}catch(e){}}
  }  try{
    const uid=_devSupportMode
      ?(Object.values(_DEV_SUPPORT_USERS).find(u=>u.name===_devSupportName)?.userId||_supaUser.id)
      :(_isEmployee?_contractorUserId:_supaUser.id);

    // ── CURSOR READ-FIRST, the other half of the read-skew fix ──
    // The save writes tables FIRST, cursor LAST ("cursor moved ⇒ all data committed").
    // The load must therefore sample the cursor BEFORE the table snapshot: a stored
    // cursor can then never be NEWER than the data it vouches for. The old code read
    // them the other way around (the "parallel" settings builder is lazy, it actually
    // fired one round-trip AFTER the tables), so a load racing a peer's save could
    // store a fresh cursor over stale data, the heartbeat then compared equal and the
    // device went permanently blind to that peer change (the local-stack B→A failures).
    // Any peer write landing after this sample leaves the server cursor ahead of
    // _lastZjUpdatedAt, so the heartbeat MUST fire within one interval. Zero added
    // latency: the reads were already sequential, just in the wrong order.
    _lastLoadDeletes={}; // fresh record of what THIS load explicitly deletes (reconnect merge-back reads it)
    const settingsResult=await _supa.from('zj_data').select('settings,checks_state,receipt_images,updated_at').eq('user_id',uid).maybeSingle();
    // CREW CURSOR READ-FIRST: crew logins can't read zj_data (settings stay owner-
    // private), so the read above returns null for them. Sample the account cursor
    // via the SECURITY DEFINER RPC, BEFORE the table snapshot, same read-skew
    // discipline as the owner path ("stored cursor never newer than data"). Missing
    // RPC (old server) → null → crew keeps today's full-RPC-reload behavior.
    let _crewCursor=null;
    if(_isEmployee&&!_devSupportMode){
      try{const{data:_cc}=await _supa.rpc('get_account_cursor',{target:uid});if(_cc)_crewCursor=_cc;}catch(_e){}
    }

    // EMPLOYEE sessions load through the SECURITY DEFINER RPC load_account_data,
    // which redacts money fields the employee's permissions don't grant, so the
    // contractor's bid amounts / income never reach an employee's browser memory.
    // Contractors (and dev-support) keep the raw per-table select. If the RPC is
    // not yet deployed (migration not merged to prod), fall back to the raw load:
    // visibility is unchanged until the migration lands, but the SAVE guard
    // (_employeeRedactedTables) still prevents any corruption in the meantime.
    // ARCHIVAL: full loads pull the HOT set only (archived_at null), a decade-old
    // account boots like a young one. Falls back to the unfiltered read on a DB
    // that predates the archival migration (unknown column), so deploy order is safe.
    const _rawLoad=async()=>{
      const _q=(hot)=>Promise.all(_TD_TABLES.map(({t})=>{
        let s=_supa.from(t).select('id,data,updated_at').eq('user_id',uid).is('deleted_at',null);
        if(hot)s=s.is('archived_at',null);
        return s;
      }));
      const res=await _q(true);
      if(res.some(r=>r&&r.error&&/archived_at/i.test(r.error.message||'')))return _q(false);
      return res;
    };
    let tableResults, _isDelta=false, _deltaMeta=null, _deltaBase=null;
    // 2s OVERLAP MARGIN on every delta query: a save's per-table writes commit over a short
    // window, so a reader can observe a later-timestamped row while an earlier one from the
    // same save isn't visible yet, advancing the cursor past a row it never loaded. Querying
    // from cursor-2s re-reads that sliver; the id-keyed merge below is idempotent, so the
    // overlap costs a few duplicate rows and can never lose one.
    const _deltaSince=(cur)=>{try{return new Date(new Date(cur).getTime()-2000).toISOString();}catch(_e){return cur;}};
    // archived_at rides the delta select, archiving bumps updated_at, so the
    // transition reaches every device as an ordinary changed row. On a DB without
    // the column the select errors → the caller falls back to the full load.
    const _deltaQuery=(since)=>Promise.all(_TD_TABLES.map(({t})=>
      _supa.from(t).select('id,data,updated_at,deleted_at,archived_at').eq('user_id',uid).gt('updated_at',_deltaSince(since))
    )).catch(()=>null);
    // ONE-SHOT ATOMIC DELTA, the get_account_delta RPC returns all 14 tables' changed
    // rows in ONE round-trip from ONE Postgres snapshot (a single SELECT = one MVCC
    // snapshot). At N devices the reconcile fan-out is the account's dominant load;
    // this collapses 14 reads to 1 AND removes the residual cross-table skew a
    // multi-statement read leaves open (the 2s overlap margin stays as belt-and-
    // suspenders). SECURITY INVOKER: rows are RLS-scoped to auth.uid(), which equals
    // `uid` on every delta path (employee/dev-support sessions never take one).
    // Returns null when the function isn't deployed (PGRST202) or anything is off,
    // callers fall back to the per-table reads, so deploys in any order stay safe.
    let _rpcOps=null; // ops returned atomically WITH the rows, applied after the row merge
    const _rpcDelta=async(since)=>{
      try{
        // Ops ride the same snapshot when this session runs the op channel, one read
        // per reconcile instead of rows+ops separately (the O(N) cut that matters most
        // when N devices reconcile against one account).
        const _oSince=(window._opLogShadow&&!_isEmployee&&!_devSupportMode)?(_opsPullSince(since)||null):null;
        const{data,error}=await _supa.rpc('get_account_delta',{since:_deltaSince(since),ops_since:_oSince});
        if(error||!data||typeof data!=='object'||!data.tables)return null;
        if(Array.isArray(data.ops)&&data.ops.length)_rpcOps=data.ops;
        return _TD_TABLES.map(({t})=>({data:Array.isArray(data.tables[t])?data.tables[t]:[],error:null}));
      }catch(_e){return null;}
    };
    const _deltaFetch=async(since)=>{
      // get_account_delta is auth.uid()-scoped: a crew login calling it would read
      // its OWN (empty) account. Crew deltas ride the per-table reads, which the
      // crew RLS policies scope to the boss's rows with per-table permissions.
      if(_isEmployee)return _deltaQuery(since);
      return (await _rpcDelta(since))||_deltaQuery(since);
    };
    // DELTA FIRST, a normal contractor cold load pulls only rows changed since this
    // device's last visit (updated_at > cursor; soft-deletes ride via deleted_at),
    // merged onto the cache-painted snapshot. Skips employees and dev-support
    // (redaction/impersonation), and falls back to the full load on any error, so it
    // can only ever make loads faster, never change what data lands.
    if(!silent&&!_isEmployee&&!_devSupportMode){
      _deltaMeta=_readDeltaMeta(uid);
      if(_deltaMeta&&_paintCacheForDelta(uid)){
        const _dres=await _deltaFetch(_deltaMeta.cursor);
        if(_dres&&!_dres.some(r=>r&&r.error&&!_isMissingTableErr(r.error))){
          tableResults=_dres;_isDelta=true;_deltaBase=_deltaMeta.cursor;
          // Restore known-cloud hashes so an unsaved local edit still re-uploads, and
          // seed _lastKnownIds from the painted cache so the delete-sweep stays correct.
          _syncedHash={};for(const[k,v]of Object.entries(_deltaMeta.syncedHash||{}))_syncedHash[k]=new Map(v);
          for(const{t,get}of _TD_TABLES)_lastKnownIds[t]=new Set((get()||[]).map(r=>String(r.id)));
        }
      }
    }else if(silent&&!_devSupportMode&&_supaCloudLoaded&&_deltaCursor&&_deltaCursor<new Date(Date.now()+60000).toISOString()&&_loadedDataOwner===uid){
      // (Crew included: their delta rides the per-table reads under the crew RLS,
      // permitted tables return changed rows, redacted tables return EMPTY, and the
      // id-keyed merge leaves untouched tables exactly as the redacting RPC left them.)
      // SILENT DELTA, the scale fix for reconciles. Every heartbeat / realtime catch-up /
      // trailing reload used to re-read the ENTIRE account (14 full-table selects); on a
      // heavy account that made the very mechanism that keeps devices converged the most
      // expensive thing the app does. The in-memory arrays are already authoritative
      // (_supaCloudLoaded, same owner), so pull only rows changed since the in-memory
      // cursor and merge by id, soft-deletes ride along via deleted_at. Any error falls
      // back to the full read below, so correctness never depends on the delta.
      const _dres=await _deltaFetch(_deltaCursor);
      if(_dres&&!_dres.some(r=>r&&r.error&&!_isMissingTableErr(r.error))){
        tableResults=_dres;_isDelta=true;_deltaBase=_deltaCursor;
      }
    }
    if(!_isDelta){
      if(_isEmployee&&!_devSupportMode){
        const{data:_red,error:_rpcErr}=await _supa.rpc('load_account_data',{target_uid:uid});
        if(_rpcErr&&(_isMissingTableErr(_rpcErr)||_rpcErr.code==='PGRST202'||/function|does not exist/i.test(_rpcErr.message||''))){
          console.warn('[cloud] load_account_data RPC unavailable, falling back to raw load (save guard still active)');
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
    }

    // A table whose migration hasn't reached the live DB yet must NOT abort the entire
    // sync: that would take down ALL cloud loading and trap the app in an offline loop.
    // Skip only "table does not exist" errors; real failures (auth, network) still throw.
    for(let i=0;i<_TD_TABLES.length;i++){
      const err=tableResults[i].error;
      if(err&&!_isMissingTableErr(err))throw err;
    }

    // Advance the delta cursor to the newest server updated_at we observed, the next
    // cold load only pulls rows newer than this. Tracked for BOTH paths so the first
    // full load establishes the cursor that subsequent delta loads read from.
    let _newCursor=_isDelta?_deltaBase:null;
    // CURSOR CLAMP, never advance the delta cursor past sane wall time. Legacy
    // admin-locked rows are stamped updated_at ≈ now()+1 YEAR (the lock convention),
    // and any such row poisons the cursor: every later delta asks "changed since
    // next year?" → 0 rows forever, and the device silently stops converging while
    // believing it's current (the cloud full-suite B→A + redundant-upload failures
    // on the legacy dev account). Far-future rows still MERGE normally below, they
    // just can't drag the cursor with them. 60s of slack absorbs proxy clock jitter.
    const _cursorCeiling=new Date(Date.now()+60000).toISOString();
    // REBASE input, pending CREATE intent per table: ids whose create op is still
    // un-acked in the durable op log. The full-load branch below re-appends those rows
    // (created offline, never uploaded, the array replace would silently drop them).
    // An op is a CREATE iff its fields carry the row's id (derive emits ALL fields on
    // create, only changed fields on update), so a pending EDIT to a row a peer
    // deleted does NOT resurrect it (delete wins, same rule as the delta branch).
    // Set when any row merge kept a local field (or re-appended a pending create), the
    // union/orphan then needs a real upload, scheduled once after the whole merge below.
    let _keptLocalInLoad=false;
    let _pendingCreateIds={};
    // Crew included: a crew device's own pending creates are owned by the EMPLOYEE's uid
    // (ops stamp _hlcOwner() = _supaUser.id), while `uid` here is the BOSS account being
    // loaded: matching on `uid` alone silently excluded every crew create, so a full
    // load racing a crew's first save of its own bid dropped the local copy.
    if(window._opLogShadow&&!_devSupportMode){
      try{
        const _opOwn=(_supaUser&&_supaUser.id)||uid;
        for(const _o of (await _opDbUnsynced())||[]){
          if(_o&&_o.fields&&_o.fields.id!==undefined&&_o.owner===_opOwn)(_pendingCreateIds[_o.table]||(_pendingCreateIds[_o.table]=new Set())).add(String(_o.rowId));
        }
      }catch(_e){}
    }
    // SYNC TRACE (certification diagnostics): name each load's kind, a 'FULL' entry in a
    // window where only silent deltas should run is the marker-loss smoking gun.
    try{if(window._syncTrace)(window._syncTraceLog||(window._syncTraceLog=[])).push({t:Date.now(),src:'load',delta:_isDelta,silent:!!silent});}catch(_e){}
    for(let i=0;i<_TD_TABLES.length;i++){
      const{t,set,get}=_TD_TABLES[i];
      if(tableResults[i].error){console.warn('[cloud] skipping unprovisioned table',t);continue;} // missing table, leave in-memory data untouched
      const data=tableResults[i].data||[];
      for(const r of data){if(r.updated_at&&r.updated_at<_cursorCeiling&&(!_newCursor||r.updated_at>_newCursor))_newCursor=r.updated_at;}
      if(_isDelta){
        // Merge the changed rows onto the cache-painted array by id: a soft-deleted
        // row (deleted_at set) is removed; any other changed row replaces/adds. A row
        // NOT in this delta is untouched (it hasn't changed since the cursor).
        // REBASE: an incoming row never whole-row-clobbers a PENDING local edit, the
        // same per-field _opApplyIncoming the realtime path uses protects any field this
        // device set more recently (offline-return case). The synced hash is stamped
        // from the INCOMING row, so a merge that kept a local field hashes differently
        // → the next save re-uploads the merged row (the re-upload guarantee).
        const byId=new Map((get()||[]).map(r=>[String(r.id),r]));
        const _ldTs=Date.now();
        for(const r of data){
          const id=String(r.id);
          // deleted OR archived, either way the row leaves the hot set on every
          // device through this same path. _lastLoadDeletes records both so the
          // reconnect merge-back never resurrects a row a peer deliberately
          // removed/archived during our outage (restore rides back as an ordinary
          // changed row with archived_at null).
          if(r.deleted_at||r.archived_at){byId.delete(id);_syncedHash[t]&&_syncedHash[t].delete(id);_lastKnownIds[t]&&_lastKnownIds[t].delete(id);_rowSyncedAt[t]&&_rowSyncedAt[t].delete(id);_rowServerTs[t]&&_rowServerTs[t].delete(id);(_lastLoadDeletes[t]||(_lastLoadDeletes[t]=new Set())).add(id);}
          else{
            const _lr=byId.get(id);
            const _mg=_lr?_opApplyIncoming(t,_lr,r.data,r.updated_at,'delta'):r.data;
            if(_mg!==r.data)_keptLocalInLoad=true; // union kept, schedule the upload after the merge
            byId.set(id,_mg);
            (_syncedHash[t]||(_syncedHash[t]=new Map())).set(id,_hashPayload(r.data));
            (_lastKnownIds[t]||(_lastKnownIds[t]=new Set())).add(id);
            (_rowSyncedAt[t]||(_rowSyncedAt[t]=new Map())).set(id,_ldTs);
            if(r.updated_at){try{(_rowServerTs[t]||(_rowServerTs[t]=new Map())).set(id,new Date(r.updated_at).getTime());}catch(_e){}}
          }
        }
        set([...byId.values()]);
      }else{
        // Full load, replace the array with the cloud rows, and rebuild the synced-hash
        // map from the rows AS LOADED (hash each `r.data` exactly as stored, BEFORE the
        // receipt re-injection / expenses sort below, so it matches the next save's txFn
        // payload). Two REBASE guarantees ride the replace (offline-return safety):
        //   1. each incoming row per-field-merges against any local copy, so a pending
        //      local edit survives (hash is of the incoming row → re-uploads next save);
        //   2. local rows the cloud doesn't know AT ALL whose CREATE is still pending in
        //      the op log are re-appended (no hash entry → uploaded on the next save).
        const _localArr=get()||[];
        const _localById=new Map(_localArr.map(r=>[String(r.id),r]));
        const _cloudIds=new Set(data.map(r=>String(r.id)));
        const _merged=data.map(r=>{
          const _lr=_localById.get(String(r.id));
          const _mg=_lr?_opApplyIncoming(t,_lr,r.data,r.updated_at,'full'):r.data;
          if(_mg!==r.data)_keptLocalInLoad=true; // union kept, schedule the upload after the merge
          return _mg;
        });
        const _pendC=_pendingCreateIds[t];
        if(_pendC)for(const _lr of _localArr){
          const _lid=String(_lr.id);
          if(!_cloudIds.has(_lid)&&_pendC.has(_lid)&&!(_locallyDeletedIds[t]&&_locallyDeletedIds[t].has(_lid))){_merged.push(_lr);_keptLocalInLoad=true;}
        }
        set(_merged);
        _lastKnownIds[t]=new Set(data.map(r=>String(r.id)));
        _syncedHash[t]=new Map(data.map(r=>[String(r.id),_hashPayload(r.data)]));
        const _ldTs=Date.now();
        _rowSyncedAt[t]=new Map(data.map(r=>[String(r.id),_ldTs])); // loaded from cloud → in sync now; edits older than this load are not "pending"
        _rowServerTs[t]=new Map(data.map(r=>{let _ms=0;try{_ms=r.updated_at?new Date(r.updated_at).getTime():0;}catch(_e){}return [String(r.id),_ms];}));
      }
    }
    if(_newCursor)_deltaCursor=_newCursor;
    // CREW: the redacted RPC's rows carry no updated_at, so a crew FULL load never
    // establishes a delta cursor from rows. Seed it from the pre-table cursor sample,
    // the cursor is bumped LAST on every save, so "rows newer than it" is the exact
    // delta contract owner devices use. This is what graduates crew from full-RPC
    // reloads to cheap silent deltas.
    if(_isEmployee&&!_deltaCursor&&_crewCursor)_deltaCursor=_crewCursor;
    _loadedDataOwner=uid; // memory now authoritatively holds THIS account's data (gates the silent delta + cross-account guard)

    const _lsRcpt=(()=>{try{return JSON.parse(localStorage.getItem('zp3_rcpt_imgs')||'{}')}catch{return{}}})();
    const _dbRcpt=(()=>{try{const v=settingsResult.data?.receipt_images;return v?JSON.parse(v):{}}catch{return{}}})();
    const rcptImgs={..._lsRcpt,..._dbRcpt};
    expenses=expenses.map(e=>rcptImgs[e.id]?{...e,receipt_img:rcptImgs[e.id]}:e);
    expenses.sort((a,b)=>(a.date||'9').localeCompare(b.date||'9'));

    const sd=settingsResult.data;
    if(sd?.updated_at)window._lastZjUpdatedAt=sd.updated_at;
    // Crew can't read zj_data, their "last applied cursor" is the RPC sample taken
    // BEFORE the table reads (never newer than the data it vouches for; a save that
    // landed mid-load leaves the server cursor ahead → the heartbeat fires next tick).
    else if(_isEmployee&&_crewCursor)window._lastZjUpdatedAt=_crewCursor;
    if(sd){
      if(sd.checks_state){const cc=(()=>{try{return JSON.parse(sd.checks_state);}catch{return null;}})();if(cc&&Object.keys(cc).length)checksState=cc;}
      if(sd.settings){const ss=(()=>{try{return JSON.parse(sd.settings);}catch{return null;}})();
        if(ss){_mergeIncomingSettings(ss,'cloud zj_data (Supabase)'+(silent?', BACKGROUND refresh (realtime/broadcast/PTR)':', BOOT 3/4'));
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
    _authSettingsLoaded=true; // authoritative cloud settings are now in S, settings saves are safe
    _loadedDataOwner=(_supaUser&&_supaUser.id)||_loadedDataOwner; // remember whose data is in memory
    supaSetStatus('synced');

    // If _mergeIncomingSettings detected local is newer than cloud it scheduled a
    // debounced save (2 s). Flush it immediately now that _supaCloudLoaded=true so
    // a force-quit right after boot can't outrun the timer and lose settings.
    if(localStorage.getItem('zp3_pending_sync')==='1'){
      clearTimeout(_syncTimer);_syncTimer=null;
      setTimeout(()=>_flushSaveNow(),50);
    }

    if(!silent){
      // Re-render the setup checklist once the Stripe status resolves: the card
      // treats unknown-Stripe as handled (no flash), so a contractor who actually
      // needs to connect only sees "Turn on card payments" appear here, cleanly.
      setTimeout(()=>{if(_stripeConnectStatus===null)_fetchStripeConnectStatus().then(()=>{if(typeof _renderDashSetupTodo==='function')_renderDashSetupTodo();}).catch(()=>{});},500);
      _removeBootOverlay();goPg('pg-dash');
    }

    // De-duplicate BEFORE rendering, prevents flash of duplicate bids on PTR
    const _dedupById=(arr)=>{const seen=new Set();return arr.filter(x=>{if(seen.has(x.id))return false;seen.add(x.id);return true;});};
    const _preLen=clients.length+bids.length+jobs.length;
    clients=_dedupById(clients);bids=_dedupById(bids);jobs=_dedupById(jobs);
    if(clients.length+bids.length+jobs.length<_preLen)setTimeout(()=>_flushSaveNow(),1200);
    // NOTE: empty-shell draft bids are DELIBERATELY NOT filtered here. The Make Money
    // Today build feed renders them ("In progress, finish & send") with an explicit
    // Discard control, hiding them on load made in-progress estimates vanish on every
    // reload while un-reloaded devices still showed them (owner-reported 53-vs-43
    // device disagreement). Junk drafts are removed by the USER via discardInProgressBid,
    // and duplicate empty GEI drafts by openGenericEstimate's purge, both record real
    // delete intent so the sweep removes them server-side. Never a silent load-side
    // filter (§7): a row either exists everywhere or is deleted everywhere.
    // PHASE 0 oplog: baseline the shadow diff AFTER the dedupe + draft-bid filters above,
    // so filtered rows aren't seen as deletes on the next save (no-op unless _opLogShadow).
    _opRebaseline();
    // A union was kept (or a pending create re-appended) during the merge, the local
    // state now holds something the cloud's rows don't. One debounced save uploads it:
    // kept rows' hashes were stamped from the INCOMING rows (already marked changed) and
    // re-appended rows have no hash at all. Scheduled AFTER the rebaseline above so the
    // debounce's synchronous derive sees baseline==arrays and emits zero phantom ops.
    if(_keptLocalInLoad){try{supaSaveDebounced();}catch(_e){}}
    // Ops catch-up rides every load, the reconcile-side leg of the op channel
    // (realtime is the instant leg, the save epilogue the publish leg). When the RPC
    // carried the ops atomically with the rows, ingest those (zero extra reads) and
    // let _opSyncOps handle only the push leg; otherwise it pulls too (fire-and-forget).
    if(window._opLogShadow){
      try{
        if(_rpcOps)_opIngestPulled(_rpcOps);
        _opSyncOps().catch(()=>{});
      }catch(_e){}
    }

    renderDash();
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
    // this commit (two _cancelRefund entries per bid_id, keep the first, drop extras).
    (function _dedupeClawbacks(){
      const seen=new Set();let dirty=false;
      for(let i=payments.length-1;i>=0;i--){
        const p=payments[i];
        if(!p||!p._cancelRefund)continue;
        if(seen.has(p.bid_id)){
          // Record the delete intent so the next save's sweep soft-deletes the dupe on the
          // SERVER too. Splicing alone removed it only from memory, every load re-downloaded
          // the dupes and re-ran saveAll(), turning this cleanup into a permanent ambient-save
          // generator on any device (the background saves that starved the reconcile backstop).
          if(typeof _recordLocalDelete==='function')_recordLocalDelete('td_payments',p.id);
          payments.splice(i,1);dirty=true;
        }
        else seen.add(p.bid_id);
      }
      if(dirty){saveAll();if(typeof renderDash==='function')renderDash();}
    })();

    // Always fetch proposal views on every load so PTR gets fresh timestamps immediately
    setTimeout(()=>{checkNewSignatures();_fetchProposalViews();if(!window._showingScheduleAlert&&!silent)showScheduleAlerts();},1500);

    if(!silent&&!_cloudTimersStarted){
      _cloudTimersStarted=true;
      // td_ops retention: once per session, prune this account's ops older than 14 days.
      // The op stream only needs to cover the live concurrency window + an offline-return
      // horizon; the td_* rows are the state of record. Fire-and-forget, owner-scoped.
      if(window._opLogShadow&&!_isEmployee&&!_devSupportMode){
        setTimeout(()=>{try{_supa.from('td_ops').delete().eq('user_id',uid).lt('created_at',new Date(Date.now()-14*24*60*60*1000).toISOString()).then(()=>{});}catch(_e){}},8000);
      }
      // SEVEN-YEAR AUTO-ARCHIVE (IRS-aligned, owner directive): once a month the
      // owner's first boot flags records older than the current year minus 7 full
      // years: they leave every device's hot set via ordinary deltas but stay in
      // the DB, restorable from the Archive view. Missing RPC (migration not yet
      // deployed) = silent no-op. S.autoArchive===false opts out.
      if(!_isEmployee&&!_devSupportMode&&S.autoArchive!==false){
        setTimeout(()=>{try{
          const _amKey='zp3_archive_month',_amCur=new Date().toISOString().slice(0,7);
          if(localStorage.getItem(_amKey)!==_amCur){
            localStorage.setItem(_amKey,_amCur);
            _supa.rpc('archive_old_records').then(({data})=>{
              if(data&&Object.keys(data).length){
                // Rows changed server-side: reconcile THIS device now and bump the
                // account cursor so every peer's heartbeat picks the change up too.
                try{_supa.rpc('bump_account_cursor',{target:uid}).then(()=>{},()=>{});}catch(_e){}
                try{_scheduleReconcile(0);}catch(_e){}
              }
            },()=>{});
          }
        }catch(_e){}},15000);
      }
      setTimeout(()=>{
        // PACED hub sweep, the old forEach fired every tokened client's hub
        // upload at once (O(clients) boot burst; see _startHubSweep).
        if(typeof _startHubSweep==='function')_startHubSweep();
        autoRefreshRates();autoRefreshTaxBrackets();autoRefreshLienRules();
        if(typeof autoRefreshDepositCaps==='function')autoRefreshDepositCaps();
      },4000);
      setTimeout(()=>_checkOdometerPrompt(),3500);
      setInterval(_sigPollTick,30000);
      // Cross-device RECONCILE HEARTBEAT, poll zj_data.updated_at on a short timer,
      // ALWAYS, not gated on a realtime event arriving. Supabase Realtime is best-effort
      // (at-most-once): a single postgres_changes / broadcast CAN be dropped. The old design
      // only fast-polled AFTER an event landed (_kickFastReconcile), so a FULLY-dropped event
      // fell through to a slow 30s backstop, a peer's create/delete could stay invisible for
      // up to 30s (the realtime-delete-sync B→A failure). An always-on heartbeat makes the
      // socket a mere accelerator: even with ZERO realtime delivery, a peer change self-heals
      // within one interval. The cursor is safe to trust because the sync marker is bumped
      // LAST on every save (see the marker note), it advances only once all td_* rows commit.
      // Cost: one tiny row read per interval per open tab. The direct-Supabase default (§15.3)
      // keeps it off the /api budget on hosted, and on self-hosted Supabase it's a non-issue,
      // so the interval is tuned for convergence latency, not cost. Skipped within 3s of a
      // local save (our own echo) and while the tab is hidden or a load is already running.
      const _RECONCILE_HEARTBEAT_MS=5000;
      // One tiny cursor read; reload ONLY when it's ahead of what we've applied, the
      // free no-op on the caught-up path. Shared by the heartbeat tick and the
      // return-to-foreground pull so both converge by the same rule.
      window._cursorCheckReconcile=async()=>{
        if(!_supaUser||_loadInProgress||_reconcileTimer)return;
        if(Date.now()-_lastLocalSaveAt<3000)return;
        try{
          const _puid=_devSupportMode?(Object.values(_DEV_SUPPORT_USERS).find(u=>u.name===_devSupportName)?.userId||_supaUser.id):(_isEmployee?_contractorUserId:_supaUser.id);
          if(_isEmployee&&!_devSupportMode){
            // Crew can't SELECT zj_data, the cursor RPC is their heartbeat probe.
            const{data:_ec}=await _supa.rpc('get_account_cursor',{target:_puid});
            if(_ec&&window._lastZjUpdatedAt&&_ec!==window._lastZjUpdatedAt)_scheduleReconcile(0);
            return;
          }
          const{data:_zr}=await _supa.from('zj_data').select('updated_at').eq('user_id',_puid).maybeSingle();
          if(_zr?.updated_at&&window._lastZjUpdatedAt&&_zr.updated_at!==window._lastZjUpdatedAt) _scheduleReconcile(0);
        }catch(_e){}
      };
      // Self-rescheduling with ±20% JITTER, not a fixed setInterval: N devices booted by
      // the same crew (or the same test runner) would otherwise poll in lock-step and
      // hit the cursor row as a thundering herd every 5s. Jitter de-correlates them at
      // zero cost to convergence, the mean cadence is unchanged.
      const _heartbeatTick=()=>{
        // HIDDEN ≠ DEAD: a backgrounded tab used to skip every tick, which left it with
        // ZERO convergence channels whenever realtime was also down/dropping: modern
        // headless (and real phones switching apps) mark background tabs hidden, and a
        // device that can't converge while hidden resurfaces stale. Throttle instead:
        // hidden tabs check at most once per 60s (browsers clamp background timers
        // anyway), visible tabs keep the full cadence. Foregrounding converges
        // immediately via the visibilitychange cursor check below.
        if(!(document.visibilityState==='hidden'&&Date.now()-(window._lastCloudLoadAt||0)<60000)){
          window._cursorCheckReconcile();
        }
        setTimeout(_heartbeatTick,_RECONCILE_HEARTBEAT_MS*(0.8+Math.random()*0.4));
      };
      setTimeout(_heartbeatTick,_RECONCILE_HEARTBEAT_MS);
      // NOTE: the sig-feed-<uid> realtime channel is subscribed in _initRealtimeSubscriptions
      // (gated on _realtimeSubscribed, which resets on account switch), NOT here. _cloudTimersStarted
      // is a one-time guard that never resets, so subscribing sig-feed here meant that after a
      // same-page account switch (bug #39 teardown removes all channels) the next account never
      // got a fresh sig-feed. Co-locating it with the td-sync/user-data channels re-subscribes it
      // per account under the correct uid.
      setInterval(()=>_loadPendingInbound(),30000);
      setTimeout(()=>_fetchStripeConnectStatus(),3000);
      setTimeout(()=>_loadPendingInbound(),2000);
      document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){
        checkNewSignatures();_fetchProposalViews();if(_supaUser)_loadPendingInbound();checkNearbyJob();
        // FOREGROUND = the moment the user looks. The worker pulls the phone out of a
        // pocket: the app must be current NOW, not "within 60s". One tiny cursor read;
        // a reload only happens when a peer actually changed something we haven't seen
        // (the old 60s-gated full reload missed anything a teammate did in the last
        // minute: exactly the crew scenario). Delta-sized when it does fire.
        window._cursorCheckReconcile&&window._cursorCheckReconcile();
      }});
      // Cross-tab signal: sign.html writes zp3_sig_notify after a successful cash/check save.
      // This fires immediately in the contractor's open TradeDesk tab, no polling delay.
      window.addEventListener('storage',e=>{if(e.key==='zp3_sig_notify'&&e.newValue)checkNewSignatures();});
      setTimeout(()=>requestLocationPermission(()=>{},()=>{}),1200);
      // Was 4000ms, checkNearbyJob's cache-first rewrite (js/jobs.js) makes the
      // common case (client book already geocoded from a prior day) resolve
      // near-instantly, so this only needs to trail the location-permission
      // request above, not pad extra wait time on top of it.
      setTimeout(()=>checkNearbyJob(),1500);
      // Reconnects the clock banner/interval to an open (still-clocked-in) entry
      // this person owns, if this device reloaded mid-timer, see
      // _rehydrateActiveTimer (js/jobs.js) for why this is safe/necessary now
      // that clock-in persists immediately instead of only at clock-out.
      typeof _rehydrateActiveTimer==='function'&&_rehydrateActiveTimer();
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
          if(_cd.maintenance?.length)maintenance=_cd.maintenance;
        if(_cd.checksState&&Object.keys(_cd.checksState).length)checksState=_cd.checksState;
        if(_cd.settings){_mergeIncomingSettings(_cd.settings,'zp3_cloud_cache (cloud load FAILED, fallback)');applySettings();_refillSettingsFormUnlessEditing();}
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
        if(!silent){_removeBootOverlay();renderDash();}
        _showOfflineBanner();supaSetStatus('error');return;
      }catch(_ce){console.warn('Cache load failed:',_ce);}
    }
    _removeBootOverlay();renderDash();supaSetStatus('error');
  }finally{
    _loadInProgress=false;
    // A version/SW-update reload arrived mid-load and was deferred (see
    // _autoSaveAndReload). The load has now settled, so it's safe to reload into
    // the new code without stranding the app. setTimeout lets this finally unwind
    // first; _loadInProgress is false now, so the guard there won't re-defer.
    if(_deferredReload){_deferredReload=false;setTimeout(()=>_autoSaveAndReload(),0);}
    if(_resolveActiveLoad)_resolveActiveLoad();_activeLoadPromise=null; // release any caller awaiting this in-flight load
    // A peer change arrived while this load was in flight, run ONE trailing load so
    // this device doesn't stay on a stale value. CRITICAL: if another load is still
    // running when the timer fires, RETRY (don't drop it). The old code dropped the
    // trailing load whenever _loadInProgress was true at the 300ms mark; under a burst
    // on a slow (bloated) account reloads are back-to-back, so the final catch-up read
    // evaporated and the device stayed one update behind (B stuck on 5004; a peer's new
    // bid never pulled). Retrying until the load clears guarantees eventual convergence.
    if(_broadcastPending){
      _broadcastPending=false;
      clearTimeout(_broadcastReloadTimer);
      const _trailing=()=>{
        if(_loadInProgress){_broadcastReloadTimer=setTimeout(_trailing,200);return;}
        supaLoadFromCloud({silent:true});
      };
      _broadcastReloadTimer=setTimeout(_trailing,300);
    }
  }
}
function _initRealtimeSubscriptions(uid){
  try{
    const ch=_supa.channel('td-sync-'+uid);
    for(const{t}of _TD_TABLES){
      ch.on('postgres_changes',{event:'*',schema:'public',table:t,filter:'user_id=eq.'+uid},(payload)=>{
        _applyRealtimeRecord(t,payload,true);
      });
    }
    // td_ops: the INSTANT leg of the per-field op channel. A peer's save publishes its
    // ops here; applying them field-by-field (HLC-guarded) is what lets N devices edit
    // the SAME row concurrently without whole-row clobber. Own-device echoes dropped by
    // device_id; the pull in _opSyncOps is the catch-up leg for anything realtime drops.
    ch.on('postgres_changes',{event:'INSERT',schema:'public',table:'td_ops',filter:'user_id=eq.'+uid},(payload)=>{
      try{
        const op=payload&&payload.new;
        if(!op||op.device_id===_deviceId)return;
        _opApplyPeerOps([op]);
      }catch(_e){}
    });
    // zj_data is not in _TD_TABLES (single-row settings, not a record table) but we
    // want instant cross-device settings sync when any device saves. postgres_changes
    // fires on all other subscribed clients the moment the row is written.
    ch.on('postgres_changes',{event:'UPDATE',schema:'public',table:'zj_data',filter:'user_id=eq.'+uid},(payload)=>{
      // Echo detection by CURSOR VALUE, not by time window. The old guard skipped every
      // zj event within 5s of a local save, which also ate PEER saves in that window
      // (a co-factor in the local-stack B→A blindness). Our own save's echo carries the
      // exact updated_at we just stored in _lastZjUpdatedAt, skip that one; anything
      // else is a cursor state this device hasn't loaded → reconcile (cheap delta now).
      const _evTs=payload?.new?.updated_at;
      if(_evTs&&window._lastZjUpdatedAt&&_evTs===window._lastZjUpdatedAt)return; // own echo / already applied
      // A peer save arrived → coalesced reconcile (handles the in-flight-load case via the
      // scheduler's _broadcastPending trailing reload, so a mid-load peer save is never dropped).
      _scheduleReconcile(300);
    });
    // Track REAL readiness: the channel only delivers peer changes once it reports
    // SUBSCRIBED. Consumers (and cross-device tests) gate on _tdRealtimeReady so they
    // never act in the window between "subscribe called" and "channel actually live".
    ch.subscribe((status)=>{
      if(status==='SUBSCRIBED')_tdRealtimeReady=true;
      else if(status==='CLOSED'||status==='CHANNEL_ERROR'||status==='TIMED_OUT')_tdRealtimeReady=false;
    });
  }catch(e){console.warn('[realtime] td-sync subscribe failed:',e);}
  try{
    // sig-feed: signature + proposal-view notifications for the signed-in contractor.
    // Subscribed here (per account, gated by _realtimeSubscribed) so a same-page account
    // switch re-establishes it under the new uid, see _teardownRealtimeChannels (bug #39).
    // Health-tracked like td-sync above: realtime is at-most-once, so any outage
    // window can silently drop a push, _sigFeedStatus runs one catch-up sweep the
    // moment the channel recovers, instead of leaving it to the next poll tick.
    _supa.channel('sig-feed-'+_supaUser.id)
      .on('postgres_changes',{event:'*',schema:'public',table:'signed_proposals',filter:'contractor_user_id=eq.'+_supaUser.id},()=>{checkNewSignatures('push');})
      .on('postgres_changes',{event:'*',schema:'public',table:'proposal_views',filter:'contractor_user_id=eq.'+_supaUser.id},()=>{_fetchProposalViews();})
      .subscribe(_sigFeedStatus);
  }catch(_sf){}
  try{
    _syncBroadcastChannel=_supa.channel('user-data-'+_supaUser.id);
    _syncBroadcastChannel
      .on('broadcast',{event:'data_saved'},(msg)=>{
        if(msg?.payload?.deviceId===_deviceId&&Date.now()-_lastLocalSaveAt<5000)return;
        // Peer save signalled → coalesced reconcile. The 300ms debounce lets the per-record
        // postgres_changes patches land first (smoother), and coalescing means this broadcast,
        // the zj_data event, and the marker event for the SAME save collapse to one reload.
        _scheduleReconcile(300);
      })
      .subscribe();
  }catch(_e){}
}
function _applyRealtimeRecord(tbl,payload,fromRealtime){
  const desc=_TD_TABLES.find(d=>d.t===tbl);
  if(!desc)return;
  // OWNER GUARD (bug #39 defense-in-depth): only apply rows that belong to the account
  // currently signed in. removeAllChannels() on sign-out closes the prior account's
  // subscription, but an event already queued before teardown could still land here after
  // the account switch, dropping foreign-owner rows ensures A's record can never be folded
  // into B's arrays even in that race. The expected owner is B's uid (contractor's uid for
  // an employee, the dev-support target while in support mode).
  if(fromRealtime){
    const _curOwner=_devSupportMode
      ?(Object.values(_DEV_SUPPORT_USERS).find(u=>u.name===_devSupportName)?.userId)
      :(_isEmployee?_contractorUserId:(_supaUser&&_supaUser.id));
    const _recOwner=(payload.new&&payload.new.user_id)||(payload.old&&payload.old.user_id);
    // Drop ONLY when BOTH owners are known and differ (a genuine foreign-account row).
    // Never drop on a transient-null _curOwner: on an offline worker's reconnect _supaUser
    // is momentarily unset while catch-up events arrive, and dropping its OWN rows there
    // corrupts the delta/lastKnownIds state so the soft-delete sweep loses its queued bid.
    if(_curOwner&&_recOwner&&_recOwner!==_curOwner)return;
  }
  // CONVERGENCE: if a peer change lands WHILE a (silent) load is in flight, that
  // load's set(rows) can overwrite the patch we're about to apply with the pre-change
  // snapshot it already read, the "last update lost" / fresh-create-dropped race that
  // left B on 5004 instead of 5005 and dropped a peer's new bid. Flag a trailing reload
  // (same machinery as the broadcast path); supaLoadFromCloud's finally re-reads the
  // now-committed state so this device converges to the newest value instead of a stale one.
  if(_loadInProgress)_broadcastPending=true;
  const arr=desc.get();
  const ev=payload.eventType;
  const rec=payload.new;
  // DELTA: mirror _lastKnownIds discipline exactly. Wherever we actually patch/push/
  // splice arr, update _syncedHash the SAME way, so a peer's value isn't echoed back as
  // a redundant upload, and a deleted row's stale hash can't suppress a future re-create.
  // In the resurrection-ignore branch we touch neither map (we're keeping it deleted).
  if((ev==='INSERT'||ev==='UPDATE')&&rec){
    if(rec.deleted_at||rec.archived_at){ // archived = removed from the hot set, same handling as a soft delete
      const idx=arr.findIndex(r=>String(r.id)===String(rec.id));
      if(idx!==-1){arr.splice(idx,1);_lastKnownIds[tbl]?.delete(String(rec.id));_syncedHash[tbl]?.delete(String(rec.id));_rowSyncedAt[tbl]?.delete(String(rec.id));_rowServerTs[tbl]?.delete(String(rec.id));try{_opPrevPayload[tbl]&&_opPrevPayload[tbl].delete(String(rec.id));}catch(_e){}}
    }else{
      const data=rec.data||rec;
      const recId=String(data.id!=null?data.id:rec.id);
      const idx=arr.findIndex(r=>String(r.id)===recId);
      if(idx!==-1){
        // PHASE 3 (authoritative, gated): per-field merge so a peer's save can't clobber a
        // field this device edited more recently. Fail-safe: returns `data` unless gated AND
        // a provably-newer PENDING local field exists (see the _rowSyncedAt gate), so the
        // default path is byte-for-byte unchanged.
        const merged=_opApplyIncoming(tbl,arr[idx],data,rec.updated_at,'rt');
        arr[idx]=merged;
        if(rec.updated_at){try{(_rowServerTs[tbl]||(_rowServerTs[tbl]=new Map())).set(recId,new Date(rec.updated_at).getTime());}catch(_e){}}
        // Baseline the applied row so the next derive doesn't re-emit the PEER's fields
        // as ops from THIS device (op echo, at N devices that's N² op traffic per edit).
        try{if(window._opLogShadow)(_opPrevPayload[tbl]||(_opPrevPayload[tbl]=new Map())).set(recId,_opClone(merged));}catch(_e){}
        // CRITICAL: stamp the hash of the INCOMING CLOUD row, never of `merged`. The hash
        // map means "what the server has". When the merge protected a pending local field,
        // merged ≠ data, so hashing `merged` would make the next save see hash-match and
        // SKIP the row, the protected edit would never upload (permanent divergence, the
        // exact bug the review confirmed). Hashing `data` guarantees the mismatch → the
        // merged row re-uploads on the next save and the protected edit reaches every peer.
        _syncedHash[tbl]?.set(recId,_hashPayload(data));
        if(merged===data)(_rowSyncedAt[tbl]||(_rowSyncedAt[tbl]=new Map())).set(recId,Date.now()); // took cloud row whole → in sync; a kept-pending field stays pending
        // UNION → upload: the merge kept a local field the incoming row lacks/loses, so the
        // server's whole-row copy is now missing something only this device holds. The hash
        // above is the INCOMING row's (mismatch armed), this debounced save is what makes
        // the union actually reach the cloud instead of waiting for the user's next edit.
        else{try{supaSaveDebounced();}catch(_e){}}
      }else if(!_lastKnownIds[tbl]?.has(recId)){
        // Only add if this ID was never known to us, if it was known but
        // isn't in arr, we deleted it locally and another device's stale
        // save is trying to resurrect it. Ignore it.
        arr.push(data);_lastKnownIds[tbl]?.add(recId);_syncedHash[tbl]?.set(recId,_hashPayload(data));
        (_rowSyncedAt[tbl]||(_rowSyncedAt[tbl]=new Map())).set(recId,Date.now());
        if(rec.updated_at){try{(_rowServerTs[tbl]||(_rowServerTs[tbl]=new Map())).set(recId,new Date(rec.updated_at).getTime());}catch(_e){}}
        // Baseline the peer's new row too, else the next derive emits a CREATE op echo.
        try{if(window._opLogShadow)(_opPrevPayload[tbl]||(_opPrevPayload[tbl]=new Map())).set(recId,_opClone(data));}catch(_e){}
      }
    }
  }else if(ev==='DELETE'&&payload.old){
    const idx=arr.findIndex(r=>String(r.id)===String(payload.old.id));
    if(idx!==-1){arr.splice(idx,1);_lastKnownIds[tbl]?.delete(String(payload.old.id));_syncedHash[tbl]?.delete(String(payload.old.id));_rowSyncedAt[tbl]?.delete(String(payload.old.id));_rowServerTs[tbl]?.delete(String(payload.old.id));try{_opPrevPayload[tbl]&&_opPrevPayload[tbl].delete(String(payload.old.id));}catch(_e){}}
  }
  // DEBOUNCED cache write: _writeLocalCache serializes the ENTIRE account (+ the delta
  // sidecar) to localStorage on the main thread, a 20-row realtime burst used to do that
  // 20 times back-to-back, janking whatever the user was touching. One trailing write
  // 250ms after the last patch captures the same end state (crash-safety is unaffected:
  // the authoritative copy is the cloud, and saves/loads still write synchronously).
  clearTimeout(_writeCacheTimer);_writeCacheTimer=setTimeout(()=>{_writeCacheTimer=null;try{_writeLocalCache();}catch(_e){}},250);
  // Skip the heavy ~15-container re-render ONLY for this device's OWN write-echoes
  // arriving via realtime: it already rendered them locally at edit time, and rebuilding
  // every container on each echoed row left the page churning under any open modal/sheet
  // so its box never settled (clicks timed out on a slow device, "element not stable").
  // Mirrors the _lastLocalSaveAt guards at cloud.js:3597/3709/3717. Data is always applied above.
  if(fromRealtime&&Date.now()-_lastLocalSaveAt<5000)return;
  if(fromRealtime){
    // BURST-COALESCED render for realtime events: a peer save that touches N rows
    // arrives as N postgres_changes events, and rebuilding all ~15 containers PER
    // EVENT is a render storm that scales with the peer's batch size (seen live:
    // a peer's client-token backfill produced 13 UPDATE events → 14 full rebuilds
    // on the receiver, breaking the glitch-free budget and janking the device).
    // One trailing render 180ms after the last event paints the same end state.
    // Direct callers (the render-parity tests, manual invocations) pass no
    // fromRealtime flag and still dispatch synchronously below.
    clearTimeout(_rtRenderTimer);
    _rtRenderTimer=setTimeout(()=>{_rtRenderTimer=null;try{_renderAllPages();}catch(_e){}},180);
    return;
  }
  _renderAllPages();
}
// The full post-change render chain, every container a synced record can appear in.
function _renderAllPages(){
  renderDash&&renderDash();
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
  // Snapshot which account this call belongs to, if a sign-out/sign-in happens
  // while the request is in flight, _supaUser changes out from under this await,
  // and the response (or its absence) must never be applied against the wrong account.
  const _forUser=_supaUser.id;
  try{
    const{data}=await _supa.from('inbound_leads').select('*').eq('account_id',_supaUser.id).eq('status','pending').order('created_at',{ascending:false});
    if(_supaUser?.id!==_forUser)return; // account switched mid-request, drop this response entirely
    if(!data){_pendingInbound=[];_updateInboundBadge();return;}
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
      showToast((c.name||'Lead')+' completed their onboarding, tap to view','📋');
      // Navigate directly to the client: avoids lead "disappearing" from whatever filter tab is active
      openClientDetail(Number(row.client_id),'leads');
      return;
    }
  }
  // Unknown lead (QR form), queue for review
  _pendingInbound.unshift(row);
  _updateInboundBadge();
  showToast('New lead from '+(row.source==='qr_form'?'QR form':'intake form')+', tap to review','🆕');
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
  // Only show errors, syncing/synced are silent
  if(s==='error'){
    el.textContent='⚠️ Sync error, check connection';
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
  if(navigator.webdriver)return; // never auto-pop the weekly summary modal under automation, it covers the page and blocks clicks (mirrors requestLocationPermission / geo-consent). Real users unaffected.
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
    '<div style="text-align:center;font-size:28px;margin-bottom:6px">'+svgIcon('📊',{size:28})+'</div>'+
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
  if(navigator.webdriver)return; // never auto-pop the boot briefing modal under automation, it covers the page and blocks every click (mirrors requestLocationPermission / geo-consent). Real users unaffected.
  if(!_supaUser)return; // don't show before login
  // Owner: boot popups were appearing DURING the boot screen. Hold until the boot
  // overlay has fully lifted AND the card waterfall has settled, so the briefing/
  // unpaid popup lands OVER the finished dashboard, never over the loading screen.
  if(document.getElementById('supa-boot-overlay')||document.getElementById('_update-ov')||document.getElementById('pg-dash')?.classList.contains('boot-cascade')){
    setTimeout(showDailyBriefing,350);return;
  }
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
  // Supply reminder, jobs tomorrow
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
        const icon=j.eventType==='estimate'?svgIcon('📋'):svgIcon('🔨');
        // A job record can lack eventType (it's implicitly a job); the icon already
        // defaults to 🔨 in that case, so default the label to 'job' too: calling
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
              '<button onclick="this.closest(\'.zmodal-overlay\').remove();showFileLienDirect('+top.b.id+')" style="flex:1;padding:9px;border-radius:var(--r);border:none;background:#3D0000;color:#FFB3B3;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">'+svgIcon('⚖')+' File Lien</button>':
              (tc&&tc.phone?'<a href="tel:'+tc.phone.replace(/\D/g,'')+'" onclick="autoLogContact('+tc.id+',\'call\');this.closest(\'.zmodal-overlay\').remove()" style="flex:1;padding:9px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;text-decoration:none;display:block;text-align:center">'+svgIcon('📞')+' Call '+escHtml(tc.name.split(' ')[0])+'</a>':'')))+
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
            (c&&c.phone?'<a href="sms:'+c.phone.replace(/\D/g,'')+'&body='+encodeURIComponent('Hi '+( c.name.split(' ')[0])+', just following up on your estimate, any questions?')+'" onclick="markFollowupSent('+b.id+');autoLogContact('+c.id+',\'followup_sent\')" style="padding:5px 10px;border-radius:20px;background:var(--blue-lt);color:var(--blue);font-size:11px;font-weight:700;text-decoration:none">Text</a>':'')+
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
        '<div style="font-size:12px;font-weight:700;color:var(--blue);margin-bottom:3px">'+svgIcon('🛒')+' Supply check for tomorrow</div>'+
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
      '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);margin-bottom:8px">'+season+', Past Clients to Reach</div>'+
      seasonal.map(c=>{
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border)">'+
          '<div style="font-size:13px;font-weight:600">'+escHtml(c.name)+'</div>'+
          '<div style="display:flex;gap:6px">'+
            (c.phone?'<a href="sms:'+c.phone.replace(/\D/g,'')+'&body='+encodeURIComponent('Hi '+c.name.split(' ')[0]+', it\'s '+( S.bname||'ZJ\'s Painting')+'. '+season+' is a great time for exterior or interior work, want a quick quote?')+'" onclick="autoLogContact('+c.id+',\'seasonal_outreach\')" style="padding:5px 10px;border-radius:20px;background:var(--green-lt);color:var(--green-mid);font-size:11px;font-weight:700;text-decoration:none">Text</a>':'')+
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
  // Reload bridge, painted SYNCHRONOUSLY before the save/reload so a version
  // update NEVER shows the dashboard flashing between the old and new build. Uses
  // the SAME markup/classes as the redesigned boot overlay (glow, mark, monogram,
  // gradient glowing bar) so old-build → reload → new-build reads as ONE
  // continuous loading screen instead of two separate boots.
  if(document.getElementById('_update-ov'))return;
  const logo=S?.logoData||'';
  const bname=(S?.bname||'').trim();
  const brand=S?.brandColor||'';
  const esc=t=>t.replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
  let r=45,g=93,b=168,lr=115,lg=163,lb=238;
  if(brand){const h=brand.replace('#','');r=parseInt(h.substr(0,2),16)||0;g=parseInt(h.substr(2,2),16)||0;b=parseInt(h.substr(4,2),16)||0;lr=Math.min(255,r+70);lg=Math.min(255,g+70);lb=Math.min(255,b+70);}
  const bg='radial-gradient(120% 80% at 0% 100%,rgba('+r+','+g+','+b+',.34) 0%,transparent 55%),linear-gradient(155deg,#1B1612 0%,#1F2230 100%)';
  const barFg='linear-gradient(90deg,rgb('+r+','+g+','+b+'),rgb('+lr+','+lg+','+lb+'))';
  const barGlow='0 0 12px rgba('+r+','+g+','+b+',.55)';
  const markTile=brand?'background:linear-gradient(135deg,rgb('+r+','+g+','+b+'),rgb('+lr+','+lg+','+lb+'));box-shadow:0 1px 0 rgba(255,255,255,.12) inset,0 12px 36px rgba('+r+','+g+','+b+',.4)':'';
  const mark=logo?'':(bname
    ?'<div class="sbo-mark" style="'+markTile+'"><span class="sbo-monogram">'+esc((bname[0]||'').toUpperCase())+'</span></div>'
    :'<div class="sbo-mark"><svg viewBox="0 0 24 24" fill="none"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg></div>');
  const nameBlock=logo
    ?'<div class="sbo-logo-frame"><img src="'+logo+'"></div>'+(bname?'<div class="sbo-wordmark sbo-bizname" style="font-family:Geist,sans-serif;font-weight:900;color:#fff">'+esc(bname)+'</div>':'')
    :bname
      ?'<div class="sbo-wordmark sbo-bizname" style="font-family:Geist,sans-serif;font-weight:900;color:#fff">'+esc(bname)+'</div>'
      :'<div style="display:flex;align-items:baseline"><span class="sbo-wordmark" style="font-family:Geist,sans-serif;font-weight:900;font-size:44px;color:#fff;letter-spacing:-2px">TradeDesk</span></div>';
  const ov=document.createElement('div');
  ov.id='_update-ov';
  ov.style.cssText='position:fixed;inset:0;z-index:99999;overflow:hidden;background:'+bg+';display:flex;flex-direction:column;align-items:center;justify-content:center';
  ov.innerHTML=
    '<div class="sbo-glow"'+(brand?' style="background:radial-gradient(closest-side,rgba('+r+','+g+','+b+',.30),transparent 65%)"':'')+'></div>'+
    '<div class="sbo-center">'+mark+nameBlock+'<div class="sbo-tag">Updating…</div></div>'+
    '<div class="sbo-foot">'+
      '<div class="sbo-track"><div class="sbo-bar" style="background:'+barFg+';box-shadow:'+barGlow+';animation-duration:1.6s"></div><div class="sbo-sheen"></div></div>'+
      '<div class="sbo-hint">Loading the latest version…</div>'+
    '</div>';
  document.body.appendChild(ov);
}
let _reloadPending=false;
let _deferredReload=false; // a version/SW reload asked to fire mid cold-load, held until the load settles
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
  if(_reloadPending)return; // SW_UPDATED + version.json poll can both fire, only the first wins
  // NEVER reload DURING an in-flight cold load. On a heavy account the initial
  // supaLoadFromCloud can take several seconds; a mid-load reload (below: hide
  // body → wipe SW caches → location.replace) collides with it and strands the
  // app on a hidden/blank page, the "loading then crashed" report. Defer here
  // and let supaLoadFromCloud's finally re-fire once the load settles. Must
  // return BEFORE hiding the body, or the page stays invisible.
  if(_loadInProgress){_deferredReload=true;return;}
  _reloadPending=true;
  if(_devSupportMode){location.reload();return;} // dev's own data already saved on support entry, never push support user data to cloud
  _showUpdateOverlay(); // bridge the reload with a boot-matching loading screen (no dashboard flash, no double-boot look)
  // Snapshot any open forms before saving/reloading
  try{
    const snap=_snapshotForms();
    if(Object.keys(snap).length>1)localStorage.setItem('_form_snap',JSON.stringify(snap));
  }catch(e){}
  const activePg=document.querySelector('.pg.active')?.id||'';
  try{
    if(activePg==='pg-est-generic')saveGenericEstimate(true);
  }catch(e){}
  // Save resume state so we land back in the right place after reload
  if(activePg==='pg-est-generic'&&_geiEditBidId){
    localStorage.setItem('_sw_resume_bid',String(_geiEditBidId));
  }
  // ALWAYS flush, even when _syncTimer is null, in-memory state may have
  // changes from a fire-and-forget save (saveLoggedTrip / saveEndDriveModal)
  // that hasn't completed yet. Awaiting an idempotent full-state push
  // guarantees the latest data is in the cloud before reload.
  if(_syncTimer){clearTimeout(_syncTimer);_syncTimer=null;}
  try{await _flushSaveNow();}catch(e){}
  // Clear ALL service-worker caches before reloading. The SW serves JS/CSS
  // subresources cache-first (cached||net), so a plain reload of fresh HTML
  // still pulls js/cloud.js: and therefore APP_VERSION, from the stale cache,
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

// Catches pull-to-refresh, app close, app switch, fires synchronously when
// the page is about to be hidden/unloaded. Browser navigation kills the 2s
// debounce timer; this is the only reliable way to flush pending changes.
// ── Dev tools: receipt storage migration & recovery ───────────────────
window._migrateReceiptsToStorage=async function(){
  if(!_supa||!_supaUser){console.warn('Not signed in');return;}
  const pending=expenses.filter(e=>e.receipt_img&&!e.receipt_key);
  if(!pending.length){console.log('Nothing to migrate, all receipts already in bucket');return;}
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
  if(_syncTimer)_flushSaveNow(); // tracked: a racing silent load must await it
});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden&&_syncTimer)_flushSaveNow(); // tracked: a racing silent load must await it
});

// ── Persistent version check: fires every time app comes to foreground ────────
// Fetches version.json (never cached by the SW, and with no-store to bypass the
// browser HTTP cache) and compares the live server version to the running
// APP_VERSION. version.json is the single source of truth, APP_VERSION lives in
// js/cloud.js, not in index.html, so grepping the HTML never worked.
async function _checkVersionOnResume(){
  try{
    const r=await fetch('version.json?_='+Date.now(),{cache:'no-store'});
    if(!r.ok)return;
    const d=await r.json();
    if(d&&d.version&&d.version!==APP_VERSION)await _autoSaveAndReload();
  }catch(e){}
}
// Fires on foreground resume, SW navigate handler covers fresh opens
document.addEventListener('visibilitychange',()=>{if(!document.hidden)_checkVersionOnResume();});

