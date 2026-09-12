// js/ops-view.js: the read-only support view.
//
// What it is: the REAL app, pointed at another account's rows, rendered the way
// the PERSON you picked sees it (owner or crew, their permissions), with a slim
// strip across the top to switch people or get out. Nothing about the app is
// mocked or re-skinned; every screen is the screen they are looking at.
//
// Read only, in three layers, strongest first:
//   1. The DATABASE. 20261005_ops_view_readonly.sql grants an ops admin SELECT
//      on another account and nothing else. No insert/update/delete policy for
//      a target account exists anywhere, so a write cannot land even if every
//      line below were deleted.
//   2. The CLIENT is sealed (_opsSealClient): the Supabase client's write verbs
//      are replaced with no-ops for the duration, so the app never even asks.
//   3. The WRITE PATHS bail early (opsReadOnly() checks in saveAll,
//      supaSaveToCloud, _flushSaveNow, _writeLocalCache, _geoEnqueue,
//      _canDelete, telemetry). This layer exists so nothing throws or queues,
//      not because layers 1 and 2 need help.
//
// The other direction matters just as much: their rows sit in the same arrays
// the app normally saves FROM, so the danger is writing Jack's data into the
// viewer's own account. That is why _writeLocalCache is gated, why sync is off
// entirely, and why exit is a hard reload rather than restoring a snapshot from
// memory the way the older dev-support mode does.

// The view, or null. Read by opsReadOnly() everywhere else in the app.
window._opsView = null;

function opsReadOnly(){ return !!window._opsView || !!window._opsArming; }

// _opsArming is set SYNCHRONOUSLY at load when the ops link asked for a view,
// before the roster call has answered. Boot-time work that must never run in a
// support view (geo tracking prompting the VIEWER for location, js/geo-track.js)
// starts long before that answer arrives, so the lock has to lead it. It clears
// the moment the server says no, and a page nobody opened with ?ops=1 never sets
// it at all.

// Embedded in the ops portal (ops.html) rather than opened directly. The portal
// owns the chrome in that case: it draws the header, the person switcher and the
// exit, so this module draws none of them and takes its orders by postMessage.
function _opsEmbedded(){ try{ return window.parent && window.parent !== window; }catch(_e){ return false; } }

function _opsTell(type, extra){
  if(!_opsEmbedded())return;
  try{ window.parent.postMessage(Object.assign({source:'td-ops-view', type}, extra||{}), location.origin); }catch(_e){}
}

// Reads the support view is allowed to make. Everything else the app might call
// while a view is open is either a write (blocked) or an auth.uid()-scoped read
// that would answer with the VIEWER's own data and quietly mix two accounts.
const _OPS_RPC_OK = new Set(['ops_view_roster','ops_view_open']);

/* ── Booting AS the target ────────────────────────────────────────────────── */
// Called by loadAccountData (js/cloud.js) instead of the normal owner/crew
// resolution when the page was opened as a support view. It answers one
// question: whose app is this? Everything downstream, the rows, the settings,
// the branding, the permissions, follows from that, which is why the old
// approach of booting the viewer and swapping rows in afterwards could never be
// made right.
async function _opsLoadIdentity(){
  const boot=window._OPS_BOOT;
  if(!boot||!boot.target)return false;
  // The roster is the authorization probe, exactly as it is for the portal.
  const roster=await opsViewRoster();
  const person=roster.find(r=>r.contractor_user_id===boot.target&&r.person_user_id===boot.person)
            || roster.find(r=>r.contractor_user_id===boot.target&&r.role==='owner');
  if(!person){ _opsTell('denied'); _opsRefuse('This login is not allowed to view that account.'); return false; }

  window._opsRoster=roster;
  window._opsView={
    target:person.contractor_user_id, personUid:person.person_user_id,
    personName:person.person_name||person.person_email||'Unknown',
    business:person.business, role:person.role, perms:person.permissions||{}
  };
  window._opsArming=false;           // _opsView is the read-only lock from here
  _opsSealClient();
  _opsStopSync();

  // Their identity, so getBusinessName() and every branded surface answer with
  // THEIR name rather than falling back to the viewer's account row.
  try{
    const{data:acct}=await _supa.from('accounts').select('*').eq('owner_id',person.contractor_user_id).maybeSingle();
    if(acct){ _account=acct; }
  }catch(_e){}
  try{
    const{data:team}=await _supa.from('team_members').select('*').eq('contractor_user_id',person.contractor_user_id);
    window._opsTeam=team||[];
  }catch(_e){ window._opsTeam=[]; }

  // Every screen reads the account through _contractorUserId, so a support view
  // is an "employee" of the target whatever the person's role: the owner view
  // simply carries every permission.
  _isEmployee=true;
  _contractorUserId=person.contractor_user_id;
  const row=(window._opsTeam||[]).find(r=>r.employee_user_id===person.person_user_id);
  _employeeRecord=(person.role==='owner')
    ? {contractor_user_id:person.contractor_user_id,employee_user_id:person.person_user_id,
       name:person.person_name,role:'owner',active:true,
       permissions:{team:true,financials:true,estimate:true,payroll:true,schedule:true,clients:true,jobs:true}}
    : (row||{contractor_user_id:person.contractor_user_id,employee_user_id:person.person_user_id,
             name:person.person_name,role:person.role,permissions:person.permissions||{},active:true});

  try{await _supa.rpc('ops_view_open',{p_target:person.contractor_user_id,p_person:person.person_user_id});}catch(_e){}
  _opsTell('entered',{target:person.contractor_user_id,person:person.person_user_id,
                      name:window._opsView.personName,business:window._opsView.business,role:person.role});
  _opsPaintChrome();
  return true;
}

// A view that cannot load says so and shows nothing. It must never fall through
// to the viewer's own app wearing somebody else's label.
function _opsRefuse(msg){
  window._OPS_BOOT=null; window._opsView=null; window._opsArming=false;
  try{
    document.body.innerHTML='<div style="font:14px/1.6 -apple-system,BlinkMacSystemFont,sans-serif;'+
      'padding:40px 24px;text-align:center;color:#4a4a4a">'+
      '<div style="font-size:16px;font-weight:800;margin-bottom:6px">Support view unavailable</div>'+
      _opsEsc(msg)+'</div>';
  }catch(_e){}
}

// The name in the chrome comes from _account, which is now theirs; these are the
// surfaces that painted before the account resolved.
function _opsPaintChrome(){
  try{
    const name=(typeof getBusinessName==='function')?getBusinessName():(window._opsView&&window._opsView.business);
    document.querySelectorAll('#nav-user-name,#mobile-topbar-brand .brand-name,#boot-biz-name').forEach(el=>{ el.textContent=name; });
    if(typeof applyPermissions==='function')applyPermissions();
  }catch(_e){}
}

/* ── Switching person inside the account already loaded ───────────────────── */

// The roster is also the authorization probe, same trick fleet_support_roster
// already uses (js/cloud.js:549): rows back means the server said yes. Zero rows
// is "not an ops admin", and the picker never appears.
async function opsViewRoster(){
  try{
    if(typeof _supa==='undefined'||!_supa||!_supaUser)return [];
    const{data,error}=await _supa.rpc('ops_view_roster');
    if(error||!Array.isArray(data))return [];
    return data;
  }catch(_e){return [];}
}

// Boot hook. The link (?ops=1) opens the picker; a person already chosen in this
// tab survives a navigation within the session.
// Closed with the portal (see ops.html): a direct ?ops=1 link must not enter
// either, or the same bleed happens with no portal chrome to explain it.
function _opsApplyPerson(){
  const v=window._opsView;if(!v)return;
  // Always an "employee" of the target, whatever the role: that is what points
  // every screen at their account rather than the viewer's. An owner view simply
  // carries every permission.
  _isEmployee=true;
  _contractorUserId=v.target;
  if(v.role==='owner'){
    _employeeRecord={contractor_user_id:v.target,employee_user_id:v.personUid,name:v.personName,role:'owner',active:true,
      permissions:{team:true,financials:true,estimate:true,payroll:true,schedule:true,clients:true,jobs:true}};
  }else{
    const row=(window._opsTeam||[]).find(r=>r.employee_user_id===v.personUid);
    _employeeRecord=row||{contractor_user_id:v.target,employee_user_id:v.personUid,name:v.personName,role:v.role,permissions:v.perms,active:true};
  }
}

// Switching between people on the SAME account is a permission change: the rows
// on screen belong to the business, not the person. A different account is a
// different boot, and the portal reloads the frame for it.
function opsViewSwitchPerson(person){
  if(!window._opsView||!person||person.contractor_user_id!==window._opsView.target)return false;
  window._opsView.personUid=person.person_user_id;
  window._opsView.personName=person.person_name||person.person_email||'Unknown';
  window._opsView.role=person.role;
  window._opsView.perms=person.permissions||{};
  _opsApplyPerson();
  _opsPaintChrome();
  _opsRepaint();
  return true;
}

function _opsRepaint(){
  try{
    if(typeof renderDash==='function')renderDash();
    if(typeof renderClientList==='function')renderClientList();
    if(typeof renderJobsPage==='function')renderJobsPage();
    if(typeof renderMoneyPage==='function')renderMoneyPage();
    if(typeof renderFleet==='function')renderFleet();
  }catch(_e){}
}

/* ── The strip ────────────────────────────────────────────────────────────── */
// Almost full screen on purpose (owner 2026-09-12): the app gets the whole
// viewport, the support view takes one 30px strip and gets out of the way. The
// strip RESERVES its height on #app, #nav and #mobile-topbar rather than
// floating over them (§15.1: a fixed bar may never cover content).
// The picker and the strip share one stylesheet, injected on first use by
// either of them: the picker is drawn BEFORE any strip exists, and building the
// CSS inside the strip left the first picker unstyled.
function _opsEsc(s){return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}

/* ── Leaving ──────────────────────────────────────────────────────────────── */
// A hard reload back to a clean URL, after clearing every cache that could be
// holding their rows. Same wall the dual-hat switch uses (§9.10): the clean boot
// IS the reset machinery, so no restore path can leave one account's data behind
// in the other's session.
function opsViewExit(){
  opsViewClearTraces();
  window._opsView=null;
  window._opsReload();
}

// Everything of theirs that could outlive the tab, gone before the reload.
function opsViewClearTraces(){
  try{
    sessionStorage.removeItem('zp3_ops_open');
    sessionStorage.removeItem('zp3_ops_person');
    localStorage.removeItem('zp3_cloud_cache');
    localStorage.removeItem('zp3_delta_meta');
    localStorage.removeItem('zp3_offline_pending');
    localStorage.removeItem('zp3_rcpt_imgs');
  }catch(_e){}
}

// The navigation, behind a window property on purpose: location.replace cannot be
// reassigned in a page, so a spec can only prove the exit navigates if the call
// goes through something it can stand in for.
window._opsReload=function(){ location.replace(location.origin+location.pathname); };

/* ── The seals ────────────────────────────────────────────────────────────── */

// Every timer that could fire a save, stopped before their data is loaded.
function _opsStopSync(){
  try{if(typeof _syncTimer!=='undefined'&&_syncTimer){clearTimeout(_syncTimer);_syncTimer=null;}}catch(_e){}
  try{if(typeof _heartbeatTimer!=='undefined'&&_heartbeatTimer){clearInterval(_heartbeatTimer);_heartbeatTimer=null;}}catch(_e){}
  try{if(typeof _supaRealtimeUnsub==='function')_supaRealtimeUnsub();}catch(_e){}
}

// One choke point beats forty. The client itself loses its write verbs, so any
// call site anywhere in the app (including one written next year that never
// heard of this mode) asks for nothing and gets a quiet empty answer instead of
// a console error or a queued retry.
function _opsSealClient(){
  _opsSealObject((typeof _supa!=='undefined')?_supa:null);
}

function _opsSealObject(c){
  if(!c||c.__opsSealed)return;
  const blocked=(what)=>{try{console.warn('[ops view] read only, blocked:',what);}catch(_e){}return Promise.resolve({data:null,error:null});};
  const thenable=(what)=>{const p=blocked(what);p.select=()=>p;p.eq=()=>p;p.single=()=>p;p.maybeSingle=()=>p;return p;};

  const _from=c.from.bind(c);
  c.from=(t)=>{
    const q=_from(t);
    ['insert','update','upsert','delete'].forEach(m=>{q[m]=()=>thenable(m+' '+t);});
    return q;
  };
  const _rpc=c.rpc.bind(c);
  c.rpc=(fn,args,opts)=>_OPS_RPC_OK.has(fn)?_rpc(fn,args,opts):thenable('rpc '+fn);
  try{
    const _sfrom=c.storage.from.bind(c.storage);
    c.storage.from=(b)=>{
      const s=_sfrom(b);
      ['upload','uploadToSignedUrl','remove','move','copy','createSignedUploadUrl'].forEach(m=>{s[m]=()=>blocked('storage '+m+' '+b);});
      return s;
    };
  }catch(_e){}
  try{ c.functions.invoke=(n)=>blocked('function '+n); }catch(_e){}
  c.__opsSealed=true;
}

// Arming and entry now happen at the top of the page (the inline block in
// index.html) and in _opsLoadIdentity, which loadAccountData calls instead of
// resolving this login's own account. The old waiter that entered a view AFTER
// boot is deleted, not disabled: entering late is exactly what let this device's
// state render under somebody else's name.

/* ── The way in from inside the app ───────────────────────────────────────── */
// A row in Settings > Developer that opens the portal, shown only to an ops
// admin. is_ops_admin() is the same gate the portal and every ops_* function
// use, so this cannot show a row that leads anywhere the caller is not allowed.
// Called when the Developer panel opens (js/settings.js), never at boot: a
// customer's session must not spend a round trip on a question about us.
// The answer is cached for the session (on window, so it can be inspected and
// cleared): the question does not change while somebody is signed in.
window._opsAdminAnswer=null;
async function _opsAdminRow(){
  const row=document.getElementById('ops-portal-row');
  if(!row)return;
  if(window._opsAdminAnswer===null){
    try{
      if(typeof _supa==='undefined'||!_supa||!_supaUser)return;
      const{data,error}=await _supa.rpc('is_ops_admin');
      window._opsAdminAnswer=!error&&data===true;
    }catch(_e){window._opsAdminAnswer=false;}
  }
  row.hidden=!window._opsAdminAnswer;
  row.style.display=window._opsAdminAnswer?'flex':'none';
}

/* ── Remote control from the portal ───────────────────────────────────────── */
// ops.html drives the frame: switch to another person on the same account, or
// hand back. Same-origin only, and only the two verbs, so the frame can never be
// steered into anything the portal does not already offer.
window.addEventListener('message',ev=>{
  if(ev.origin!==location.origin)return;
  const d=ev.data;
  if(!d||d.source!=='td-ops-portal')return;
  if(d.type==='switch'&&d.person_user_id){
    const row=(window._opsRoster||[]).find(r=>r.person_user_id===d.person_user_id&&r.contractor_user_id===d.contractor_user_id);
    if(row&&!opsViewSwitchPerson(row))_opsTell('needs-reload');
    return;
  }
  if(d.type==='exit'){
    // Clearing is the point; the reload is the portal's to do by dropping the frame.
    opsViewClearTraces();
    window._opsView=null;
    _opsTell('exited');
  }
});

// Test hook: the seal is the layer a spec can actually exercise without a real
// Supabase client, so it is reachable by name (tests/e2e-ops-view.spec.js).
window._opsSealClientFor=_opsSealObject;

if(typeof module!=='undefined'&&module.exports)module.exports={opsReadOnly};
