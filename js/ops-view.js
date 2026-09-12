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

/* ── Entering ─────────────────────────────────────────────────────────────── */

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
async function opsViewBoot(){
  let want=false, wantTarget=null, wantPerson=null;
  try{
    const p=new URLSearchParams(location.search);
    if(p.get('ops')==='1')want=true;
    if(sessionStorage.getItem('zp3_ops_open')==='1')want=true;
    // The portal names who to open, so an embedded view never shows a picker
    // inside the frame: the portal already asked that question.
    wantTarget=p.get('t');wantPerson=p.get('p');
  }catch(_e){}
  if(!want)return;
  const roster=await opsViewRoster();
  if(!roster.length){window._opsArming=false;_opsTell('denied');return;}   // not on the allowlist: as if the param was never there
  window._opsRoster=roster;
  if(wantTarget){
    const asked=roster.find(r=>r.contractor_user_id===wantTarget&&(!wantPerson||r.person_user_id===wantPerson))
             || roster.find(r=>r.contractor_user_id===wantTarget&&r.role==='owner');
    if(asked)return opsViewEnter(asked);
    _opsTell('not-found');
    if(_opsEmbedded())return;
  }
  const saved=(()=>{try{return JSON.parse(sessionStorage.getItem('zp3_ops_person')||'null');}catch(_e){return null;}})();
  const match=saved&&roster.find(r=>r.person_user_id===saved.person_user_id&&r.contractor_user_id===saved.contractor_user_id);
  if(match)return opsViewEnter(match);
  opsViewPicker();
}

// Who is on this roster, grouped by business. Built on .zmodal-overlay, the
// app's centered-prompt convention (§7.3), not a hand-rolled sheet.
function opsViewPicker(){
  _opsInjectCss();
  const roster=window._opsRoster||[];
  const byBiz=new Map();
  roster.forEach(r=>{ if(!byBiz.has(r.contractor_user_id))byBiz.set(r.contractor_user_id,[]); byBiz.get(r.contractor_user_id).push(r); });
  const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const groups=[...byBiz.values()].map(people=>`
    <div class="ops-pick-biz">
      <div class="ops-pick-biz-name">${esc(people[0].business)}</div>
      ${people.map(p=>`<button class="ops-pick-person" data-cid="${esc(p.contractor_user_id)}" data-pid="${esc(p.person_user_id)}">
        <span class="ops-pick-who">${esc(p.person_name||p.person_email||'Unknown')}</span>
        <span class="ops-pick-role">${esc(p.role==='owner'?'Owner':(p.role||'crew'))}${p.active===false?' · inactive':''}</span>
      </button>`).join('')}
    </div>`).join('');
  const ov=document.createElement('div');
  ov.className='zmodal-overlay';
  ov.id='ops-picker';
  ov.innerHTML=`<div class="zmodal" style="max-width:420px;width:100%">
    <div class="ops-pick-title">Support view</div>
    <div class="ops-pick-sub">Read only. Pick whose app you want to see.</div>
    <div class="ops-pick-list">${groups||'<div class="ops-pick-sub">No accounts.</div>'}</div>
    <button class="ops-pick-cancel" id="ops-pick-cancel">Cancel</button>
  </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click',e=>{
    const btn=e.target.closest('.ops-pick-person');
    if(btn){
      const row=(window._opsRoster||[]).find(r=>r.contractor_user_id===btn.dataset.cid&&r.person_user_id===btn.dataset.pid);
      if(row){ov.remove();opsViewEnter(row);}
      return;
    }
    if(e.target.id==='ops-pick-cancel'||e.target===ov)ov.remove();
  });
}

// Open one person's app.
async function opsViewEnter(person){
  if(!person||!person.contractor_user_id)return;
  const switching=!!window._opsView;
  window._opsView={
    target:person.contractor_user_id,
    personUid:person.person_user_id,
    personName:person.person_name||person.person_email||'Unknown',
    business:person.business,
    role:person.role,
    perms:person.permissions||{}
  };
  try{sessionStorage.setItem('zp3_ops_open','1');
      sessionStorage.setItem('zp3_ops_person',JSON.stringify({contractor_user_id:person.contractor_user_id,person_user_id:person.person_user_id}));}catch(_e){}

  // Stop the app writing anything, before a single row of theirs is in memory.
  _opsStopSync();
  _opsSealClient();

  // On the record: who looked, whose account, whose view. Logged before the read
  // so a look is recorded even if the load then fails.
  try{await _supa.rpc('ops_view_open',{p_target:person.contractor_user_id,p_person:person.person_user_id});}catch(_e){}

  // Switching PEOPLE inside one business is only a permission change: the rows
  // are already in memory, so no reload and no second read.
  if(!switching||_opsView.target!==window._opsLoadedTarget){
    const ok=await _opsLoadAccount(person.contractor_user_id);
    if(!ok){ if(typeof showToast==='function')showToast('Could not load that account','❌'); return; }
    window._opsLoadedTarget=person.contractor_user_id;
  }
  window._opsArming=false;   // _opsView is the lock from here on
  _opsApplyPerson();
  if(_opsEmbedded())_opsTell('entered',{target:_opsView.target,person:_opsView.personUid,name:_opsView.personName,business:_opsView.business,role:_opsView.role});
  else _opsChrome();
  _opsRepaint();
}

// Their rows, into the arrays the app already renders from. Deliberately its own
// read rather than a call into _devLoadUserAccount (js/cloud.js:568): that one
// snapshots and restores the viewer's own state in memory, which is precisely
// the cross-account path this mode refuses to have. Exit here is a hard reload.
async function _opsLoadAccount(uid){
  try{
    const[tableResults,settingsResult,teamResult]=await Promise.all([
      Promise.all(_TD_TABLES.map(({t})=>_supa.from(t).select('id,data').eq('user_id',uid).is('deleted_at',null))),
      _supa.from('zj_data').select('settings,checks_state').eq('user_id',uid).maybeSingle(),
      _supa.from('team_members').select('*').eq('contractor_user_id',uid)
    ]);
    if(tableResults.some(r=>r&&r.error))return false;
    for(let i=0;i<_TD_TABLES.length;i++){
      const{t,set}=_TD_TABLES[i];
      set((tableResults[i].data||[]).map(r=>r.data));
      // The sync bookkeeping is emptied, not filled: nothing in this session may
      // ever compare their rows against the viewer's account and decide to write.
      // (_lastKnownIds/_syncedHash are top-level `let`s in cloud.js, so they are
      // reachable by name across scripts but never as window properties.)
      try{_lastKnownIds[t]=new Set();}catch(_e){}
      try{_syncedHash[t]=new Map();}catch(_e){}
    }
    if(settingsResult&&settingsResult.data&&settingsResult.data.settings){
      try{Object.assign(S,JSON.parse(settingsResult.data.settings));}catch(_e){}
    }
    window._opsTeam=(teamResult&&teamResult.data)||[];
    return true;
  }catch(_e){return false;}
}

// Render as this person. Crew see the app through _isEmployee plus their
// permissions (js/clients.js:15 and friends read exactly these two), so the
// support view sets the same two globals rather than inventing a parallel mask.
function _opsApplyPerson(){
  const v=window._opsView;if(!v)return;
  if(v.role==='owner'){
    _isEmployee=false;_employeeRecord=null;_contractorUserId=null;
  }else{
    const row=(window._opsTeam||[]).find(r=>r.employee_user_id===v.personUid);
    _isEmployee=true;
    _contractorUserId=v.target;
    _employeeRecord=row||{contractor_user_id:v.target,employee_user_id:v.personUid,name:v.personName,role:v.role,permissions:v.perms,active:true};
  }
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
function _opsInjectCss(){
  if(document.getElementById('ops-view-css'))return;
  const st=document.createElement('style');
  st.id='ops-view-css';
    st.textContent=`
      :root{--ops-h:30px}
      #ops-strip{position:fixed;top:0;left:0;right:0;z-index:100001;height:calc(var(--ops-h) + env(safe-area-inset-top,0px));padding:0 10px;padding-top:env(safe-area-inset-top,0px);background:#7C3D0A;color:#fff;display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;font-weight:700;box-shadow:0 1px 0 rgba(0,0,0,.25)}
      #ops-strip .ops-who{display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #ops-strip .ops-tag{background:rgba(255,255,255,.18);border-radius:5px;padding:1px 6px;font-size:10px;letter-spacing:.4px}
      #ops-strip button{border:0;border-radius:6px;padding:4px 10px;font-size:11px;font-weight:800;cursor:pointer;background:rgba(255,255,255,.18);color:#fff;transition:background .15s ease}
      #ops-strip button:active{background:rgba(255,255,255,.32)}
      #ops-strip .ops-exit{background:#fff;color:#7C3D0A}
      body.ops-view #app{padding-top:calc(var(--ops-h) + env(safe-area-inset-top,0px))}
      body.ops-view #nav{top:calc(var(--ops-h) + env(safe-area-inset-top,0px))}
      body.ops-view #clock-banner{top:calc(var(--ops-h) + env(safe-area-inset-top,0px))}
      @media(max-width:900px){
        body.ops-view #mobile-topbar{top:calc(var(--ops-h) + env(safe-area-inset-top,0px));padding-top:0;height:56px}
        body.ops-view #app{padding-top:calc(56px + var(--ops-h) + env(safe-area-inset-top,0px))}
        body.ops-view .drive-banner{top:calc(56px + var(--ops-h) + env(safe-area-inset-top,0px))}
      }
      .ops-pick-title{font-size:18px;font-weight:800;letter-spacing:-.2px}
      .ops-pick-sub{font-size:12px;color:var(--text3);margin-top:2px}
      .ops-pick-list{margin-top:14px;display:flex;flex-direction:column;gap:12px;max-height:60vh;overflow-y:auto}
      .ops-pick-biz-name{font-size:11px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:var(--text3);margin-bottom:5px}
      .ops-pick-person{width:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 13px;margin-bottom:6px;border:1px solid var(--line);border-radius:10px;background:var(--card);cursor:pointer;text-align:left;transition:transform .15s cubic-bezier(.22,1,.36,1),border-color .15s ease}
      .ops-pick-person:active{transform:scale(.99);border-color:#7C3D0A}
      .ops-pick-who{font-size:14px;font-weight:700;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .ops-pick-role{font-size:11px;color:var(--text3);flex-shrink:0}
      .ops-pick-cancel{margin-top:14px;width:100%;padding:11px;border:1px solid var(--line);border-radius:10px;background:transparent;font-size:13px;font-weight:700;cursor:pointer}
  `;
  document.head.appendChild(st);
}

function _opsChrome(){
  const v=window._opsView;if(!v)return;
  _opsInjectCss();
  let bar=document.getElementById('ops-strip');
  if(!bar){
    bar=document.createElement('div');
    bar.id='ops-strip';
    document.body.appendChild(bar);
    bar.addEventListener('click',e=>{
      if(e.target.closest('.ops-exit'))return opsViewExit();
      if(e.target.closest('.ops-switch'))return opsViewPicker();
    });
  }
  const who=(v.role==='owner'?'Owner':(v.role||'crew'));
  bar.innerHTML=`<span class="ops-who"><span class="ops-tag">READ ONLY</span> ${_opsEsc(v.personName)} · ${_opsEsc(v.business)} <span class="ops-tag">${_opsEsc(who)}</span></span>
    <span style="display:flex;gap:6px;flex-shrink:0"><button class="ops-switch">Switch</button><button class="ops-exit">Exit</button></span>`;
  document.body.classList.add('ops-view');
}

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

/* ── Arming ───────────────────────────────────────────────────────────────── */
// Deliberately NOT wired into the boot sequence: the waiter only exists when the
// ops link asked for it, so a normal boot carries zero extra work and the boot
// path keeps exactly the shape it has today.
(function(){
  let want=false;
  try{
    want=new URLSearchParams(location.search).get('ops')==='1'
       ||sessionStorage.getItem('zp3_ops_open')==='1';
  }catch(_e){}
  if(!want)return;
  window._opsArming=true;    // read-only from this instant, not from when the roster answers
  let tries=0;
  const t=setInterval(()=>{
    if(++tries>120){clearInterval(t);window._opsArming=false;return;}   // 60s, then give up quietly
    if(typeof _supa!=='undefined'&&_supa&&_supaUser&&_supaCloudLoaded){
      clearInterval(t);
      opsViewBoot();
    }
  },500);
})();

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
    if(row)opsViewEnter(row);
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
