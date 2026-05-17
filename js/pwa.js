// ── PWA enhancements: Badging, Wake Lock, Web Share, Shortcuts ────────────────

// ── Badge API ─────────────────────────────────────────────────────────────────
// Shows a count on the home screen icon of pending actions (unsigned proposals,
// open follow-ups due today or overdue).

function _pwaUpdateBadge(){
  if(!('setAppBadge' in navigator))return;
  try{
    const tk=todayKey();
    const unsigned=(bids||[]).filter(b=>
      b.status==='Sent'&&b.hubToken&&!b.signedAt
    ).length;
    const overdue=(bids||[]).filter(b=>
      b.followup&&b.followup<=tk&&b.status==='Sent'&&!b.signedAt
    ).length;
    const count=unsigned+overdue;
    if(count>0)navigator.setAppBadge(count);
    else navigator.clearAppBadge();
  }catch(e){}
}

// Call after every renderDash so badge stays current
const _origRenderDash=typeof renderDash==='function'?renderDash:null;
if(_origRenderDash){
  const _patchedRenderDash=function(){
    _origRenderDash.apply(this,arguments);
    _pwaUpdateBadge();
  };
  // Only patch if renderDash is a named global (defined before pwa.js loads)
  if(typeof window!=='undefined')window._pwaUpdateBadge=_pwaUpdateBadge;
}

// ── Wake Lock API ─────────────────────────────────────────────────────────────
// Keeps screen on during active GPS drive tracking and during estimate entry.
// Released automatically when drive ends or estimate closes.

let _wakeLock=null;

async function _wakeLockRequest(){
  if(!('wakeLock' in navigator))return;
  if(_wakeLock)return;
  try{
    _wakeLock=await navigator.wakeLock.request('screen');
    _wakeLock.addEventListener('release',()=>{_wakeLock=null;});
  }catch(e){_wakeLock=null;}
}

async function _wakeLockRelease(){
  if(!_wakeLock)return;
  try{await _wakeLock.release();}catch(e){}
  _wakeLock=null;
}

// Re-acquire wake lock when tab becomes visible again (iOS releases it on hide)
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible'&&_wakeLockShouldHold())_wakeLockRequest();
});

function _wakeLockShouldHold(){
  // Hold if a drive is active or an estimate page is open
  if(typeof gps!=='undefined'&&gps&&gps.active)return true;
  const active=document.querySelector('.pg.active');
  if(!active)return false;
  const id=active.id||'';
  return id==='pg-est'||id==='pg-est-generic';
}

// ── Web Share API ─────────────────────────────────────────────────────────────
// Opens native iOS share sheet (AirDrop, Messages, Mail, etc.).
// Falls back to clipboard copy if share not supported.

async function pwaShare({title,text,url}){
  if(navigator.share&&navigator.canShare&&navigator.canShare({title,text,url})){
    try{
      await navigator.share({title,text,url});
      return true;
    }catch(e){
      if(e.name==='AbortError')return false; // user cancelled — not an error
    }
  }
  // Fallback: copy URL to clipboard
  if(navigator.clipboard&&url){
    try{
      await navigator.clipboard.writeText(url);
      showToast('Link copied to clipboard','📋');
      return true;
    }catch(e){}
  }
  return false;
}

// ── Shortcut & Share-Target handler ──────────────────────────────────────────
// Reads ?shortcut= query param set by manifest shortcuts and share_target.
// Runs after app data has loaded (called from cloud.js post-init).

function _pwaHandleShortcut(){
  const p=new URLSearchParams(window.location.search);
  const sc=p.get('shortcut');
  if(!sc)return;
  // Strip param from URL without reload so refresh doesn't re-trigger
  const clean=window.location.pathname;
  history.replaceState(null,'',clean);
  // Small delay so app UI has rendered
  setTimeout(()=>{
    if(sc==='estimate'){
      // Navigate to dashboard then open trade picker
      goPg('pg-dash');
      setTimeout(()=>typeof newEstimate==='function'&&newEstimate(),200);
    }
    else if(sc==='expense'){
      goPg('pg-finance');
      setTimeout(()=>typeof openExpenseFlow==='function'&&openExpenseFlow(),200);
    }
    else if(sc==='clockin'){
      goPg('pg-jobs');
      // Find first active job and open clock-in sheet
      setTimeout(()=>{
        const active=(typeof jobs!=='undefined'?jobs:[]).find(j=>{
          const tk=todayKey();
          return j.start<=tk&&addDays(j.start,(parseInt(j.days)||1)-1)>=tk;
        });
        if(active&&typeof openClockInSheet==='function')openClockInSheet(active.id);
        else showToast('No active job today — open a job to clock in','⏱️');
      },300);
    }
    else if(sc==='share-photo'){
      // Shared image from another app → open expense flow with photo attached
      _pwaHandleSharedPhoto();
    }
  },400);
}

async function _pwaHandleSharedPhoto(){
  // share_target POSTs a multipart form to /?shortcut=share-photo
  // By the time JS runs, the POST body is gone — use Cache API to retrieve it
  // (standard pattern for share_target with files)
  if(!('caches' in window))return;
  try{
    const cache=await caches.open('share-target-v1');
    const keys=await cache.keys();
    if(!keys.length)return;
    const resp=await cache.match(keys[0]);
    if(!resp)return;
    const formData=await resp.formData();
    const file=formData.get('photo');
    await cache.delete(keys[0]);
    if(!file||!(file instanceof File))return;
    goPg('pg-finance');
    setTimeout(()=>{
      openExpenseFlow();
      setTimeout(()=>{
        // Pre-fill the photo in the expense modal
        const blob=new Blob([file],{type:file.type||'image/jpeg'});
        _showReceiptScanner(blob,async b=>{
          const b64=await compressAndEncodeImage(b,900,0.75);
          _expState.imageData={b64,type:'image/jpeg'};_expState.hasReceipt=true;
          const preview=document.getElementById('exp-preview-img');
          if(preview){
            preview.style.display='block';
            preview.innerHTML='<img src="data:image/jpeg;base64,'+b64+'" style="max-height:80px;border-radius:8px;border:1px solid var(--border)"><div style="font-size:11px;color:var(--green-mid);margin-top:4px;font-weight:700">📎 Photo attached</div>';
          }
        });
      },300);
    },400);
  }catch(e){}
}

// ── Web Push Notifications ────────────────────────────────────────────────────
// VAPID public key — private key lives server-side (Supabase Edge Function).
// To trigger background pushes: deploy edge fn that queries push_subscriptions
// and calls web-push sendNotification when a bid.status changes to 'Signed'.
const _VAPID_PUBLIC_KEY='BEq_Ly35TQZL3U-6i8x4HD_csk12QxgPvoX4yBU7nU6ao_z7TE7zmjd3UyCL3mptc-mGEajzauwD-9K5YTW82dA';

function _vapidKeyToUint8(b64){
  const pad='='.repeat((4-b64.length%4)%4);
  const raw=atob((b64+pad).replace(/-/g,'+').replace(/_/g,'/'));
  return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));
}

async function _pwaRequestPushPermission(){
  if(!('Notification' in window)||!('serviceWorker' in navigator)||!('PushManager' in window)){
    showToast('Push notifications not supported on this device','⚠️');return false;
  }
  const perm=await Notification.requestPermission();
  if(perm!=='granted'){
    showToast('Notifications blocked — enable in iOS Settings → TradeDesk','⚠️',5000);
    return false;
  }
  const ok=await _pwaSubscribePush();
  if(ok){showToast('Notifications enabled','🔔');}
  _updateNotifSettings();
  return ok;
}

async function _pwaSubscribePush(){
  try{
    const reg=await navigator.serviceWorker.ready;
    const existing=await reg.pushManager.getSubscription();
    if(existing){_pwaSavePushSub(existing);return true;}
    const sub=await reg.pushManager.subscribe({
      userVisibleOnly:true,
      applicationServerKey:_vapidKeyToUint8(_VAPID_PUBLIC_KEY)
    });
    _pwaSavePushSub(sub);
    return true;
  }catch(e){console.warn('[Push] subscribe failed:',e);return false;}
}

async function _pwaSavePushSub(sub){
  if(!window._supaUser||!window.supabase)return;
  const p256=sub.getKey('p256dh');
  const auth=sub.getKey('auth');
  try{
    await window.supabase.from('push_subscriptions').upsert({
      user_id:window._supaUser.id,
      endpoint:sub.endpoint,
      p256dh:p256?btoa(String.fromCharCode(...new Uint8Array(p256))):null,
      auth:auth?btoa(String.fromCharCode(...new Uint8Array(auth))):null,
      updated_at:new Date().toISOString()
    },{onConflict:'user_id'});
  }catch(e){} // table may not exist yet — silent fail until deployed
}

function _pwaLocalNotify(title,body,data){
  if(!('serviceWorker' in navigator)||Notification.permission!=='granted')return;
  navigator.serviceWorker.ready.then(reg=>{
    reg.showNotification(title,{
      body,icon:'/icon-192.png',badge:'/icon-96.png',
      data:data||{},vibrate:[200,100,200],requireInteraction:false
    });
  });
}

function _updateNotifSettings(){
  const lbl=document.getElementById('notif-status-label');
  const sub=document.getElementById('notif-status-sub');
  const dot=document.getElementById('notif-status-dot');
  const btn=document.getElementById('notif-enable-btn');
  if(!lbl)return;
  const perm='Notification' in window?Notification.permission:'unsupported';
  if(perm==='granted'){
    lbl.textContent='Notifications: On ✓';
    if(sub)sub.textContent='You\'ll be notified when a proposal is signed';
    if(dot)dot.style.background='var(--green-mid)';
    if(btn){btn.textContent='✓ Notifications enabled';btn.disabled=true;btn.style.opacity='.6';}
  }else if(perm==='denied'){
    lbl.textContent='Notifications: Blocked';
    if(sub)sub.textContent='Go to iOS Settings → TradeDesk → Notifications to allow';
    if(dot)dot.style.background='var(--red)';
    if(btn){btn.textContent='Blocked — open iOS Settings';btn.disabled=true;btn.style.opacity='.6';}
  }else if(perm==='unsupported'){
    lbl.textContent='Not supported on this device';
    if(sub)sub.textContent='iOS 16.4+ PWA required';
    if(dot)dot.style.background='var(--text3)';
    if(btn)btn.style.display='none';
  }else{
    lbl.textContent='Notifications: Off';
    if(sub)sub.textContent='Tap to enable — get notified when clients sign proposals';
    if(dot)dot.style.background='var(--amber)';
    if(btn){btn.textContent='🔔 Enable notifications';btn.disabled=false;btn.style.opacity='';}
  }
}

// Handle notification tap — SW posts NOTIFICATION_CLICK, navigate to right page
navigator.serviceWorker&&navigator.serviceWorker.addEventListener('message',e=>{
  if(e.data?.type==='NOTIFICATION_CLICK'){
    const url=e.data.url||'';
    if(url.includes('pg-clients')||!url)goPg('pg-clients');
  }
});

// ── Expose wake lock controls to drive and estimate modules ───────────────────
window._wakeLockRequest=_wakeLockRequest;
window._wakeLockRelease=_wakeLockRelease;
window._pwaRequestPushPermission=_pwaRequestPushPermission;
window._updateNotifSettings=_updateNotifSettings;
window._pwaLocalNotify=_pwaLocalNotify;
