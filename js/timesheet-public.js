// ── The public timesheet page (owner 2026-09-05) ─────────────────────────────
//
// timesheet.html is what the link in a submitted timesheet text opens. It
// runs as anon, needs no app and no login, and shows the boss EXACTLY what
// the person saw: the same week bars, the same day rail, drawn by the same
// code (js/timelog.js), read only, with Reject in soft grey and Approve as
// the one dark button underneath.
//
// timelog.js has no load-time side effects and reads the app's globals only
// when called, so this file supplies those globals (the settings, the
// arrays, the lookups) from the one RPC answer, then lets the app's own
// builders draw. Nothing about the chart is copied (CLAUDE.md 7.3).
//
// One RPC in (timesheet_public, by token), one RPC out (timesheet_decide).
// The token is the whole secret of the page and it lives only in the URL.

// READ ONLY, DECLARED ONCE. js/timelog.js asks _tlReadOnly() before it offers
// any action at all, so nothing here has to remember to stub the next gate.
window._tlViewOnly=true;

// ── The globals js/timelog.js expects (js/data.js defines them in the app) ──
var S={bname:'',bizTz:'America/Chicago',ownerName:'',hapticsOff:true};
var clients=[],bids=[],jobs=[],mileage=[],timeEntries=[];
var _supaUser=null,_contractorUserId=null,_isEmployee=false,_employeeRecord=null;
var _tsp={token:'',data:null,jobs:{},name:'',busy:false};

// Belt and braces only: _tlReadOnly() above is the guard that matters.
function _canViewComp(){return false;}
function bizTz(){return S.bizTz;}
function _bizTzName(){return S.bizTz;}
function _geoBizTz(){return S.bizTz;}
function _geoIsOffJobSource(s){return String(s||'')==='stop';}
function _geoShopAddr(){return '';}
function getOwnerName(){return _tsp.name||'';}
function getClientById(){return null;}
function _tlLoggedByInfo(){return {loggedByName:_tsp.name||''};}
function showToast(){}
function _fmtMin(m){const h=Math.floor(m/60),rem=m%60;return (h?h+'h ':'')+(rem?rem+'m':'');}
if(typeof dateKey!=='function'){
  window.dateKey=function(d){const x=(d instanceof Date)?d:new Date(d);return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');};
}
if(typeof todayKey!=='function'){window.todayKey=function(){return dateKey(new Date());};}
function _bizDateStr(d){
  try{return new Intl.DateTimeFormat('en-CA',{timeZone:S.bizTz,year:'numeric',month:'2-digit',day:'2-digit'}).format(d);}
  catch(_e){return dateKey(d);}
}
function _bkMonthLabel(mo){
  const[y,m]=String(mo||'').split('-');
  return(y&&m)?new Date(parseInt(y),parseInt(m)-1,1).toLocaleDateString('en-US',{month:'long',year:'numeric'}):String(mo||'');
}
// The job a row points at, named the way the RPC named it: job name, client
// name, address. The app resolves these from its synced arrays; here the
// server did it, once, for exactly the rows on the page.
function _tlJobClientInfo(jobId){
  const j=_tsp.jobs[String(jobId)];
  if(!j)return {jobName:'-',clientName:'-',addr:''};
  return {jobName:j.job_name||'-',clientName:j.client_name||j.job_name||'-',addr:j.addr||''};
}
// _timeLogRows (js/timelog.js) asks this for the derived rows. The answer is
// the RPC's, and every row is this one person's.
function _fetchCrewLabor(){
  const d=_tsp.data||{};
  const name={};
  (d.time||[]).concat(d.shop||[]).forEach(e=>{if(e&&e.employee_user_id)name[e.employee_user_id]=_tsp.name||'Crew';});
  return Promise.resolve({name,entries:d.time||[],shopEntries:d.shop||[]});
}

// ── Supabase, as anon, same constants sign.html uses ────────────────────────
const SUPA_URL='https://mwtsmctajhrrybblgorf.supabase.co';
const SUPA_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im13dHNtY3RhamhycnliYmxnb3JmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNjIwNjMsImV4cCI6MjA5MDczODA2M30.-FMn1pEs9PpCvv8eGwSbtucWAWvcfEcQ1SYx4nD207M';
let _supa=null;
function _tspSupa(){
  if(_supa)return _supa;
  if(typeof supabase==='undefined'||!supabase||!supabase.createClient)return null;
  _supa=supabase.createClient(SUPA_URL,SUPA_KEY,{auth:{persistSession:false,autoRefreshToken:false,storageKey:'sb-timesheet-isolated'}});
  return _supa;
}

// ── Formatting ───────────────────────────────────────────────────────────────
function _tspWhen(iso){
  const d=new Date(iso||0);
  if(!isFinite(d)||!iso)return '';
  return d.toLocaleDateString('en-US',{month:'short',day:'numeric'})+', '+d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
}
function _tspRange(wk){
  try{return String(_tlWeekLabel(wk)).replace(/^Week of /,'').replace(/\s*[–-]\s*/,' to ');}catch(_e){return String(wk||'');}
}

// ── Paint ────────────────────────────────────────────────────────────────────
function _tspChip(){
  const d=_tsp.data||{};
  const st=String(d.status||'');
  if(st==='approved')return '<span class="tsp-chip ok">'+svgIcon('✓',{size:11})+' Approved '+escHtml(_tspWhen(d.approved_at))+'</span>';
  if(st==='rejected')return '<span class="tsp-chip back">'+svgIcon('↩',{size:11})+' Sent back '+escHtml(_tspWhen(d.rejected_at))+'</span>';
  return '<span class="tsp-chip ok">'+svgIcon('🔒',{size:11})+' Submitted '+escHtml(_tspWhen(d.submitted_at))+(Number(d.version)>1?' · corrected':'')+'</span>';
}
function _tspHeader(){
  const d=_tsp.data||{};
  const el=document.getElementById('tsp-head');
  if(!el)return;
  el.innerHTML=
    '<div class="tsp-biz">'+(d.business_name?escHtml(d.business_name):'Timesheet')+'</div>'+
    '<div class="tsp-title">'+
      '<div class="tsp-who"><div class="tsp-eyebrow">Timesheet</div><div class="tsp-name">'+escHtml(d.person_name||'Crew')+'</div>'+
        '<div class="tsp-range">'+escHtml(_tspRange(String(d.week_start||'').slice(0,10)))+'</div></div>'+
      _tspChip()+
    '</div>';
}
function _tspFooter(){
  const d=_tsp.data||{};
  const el=document.getElementById('tsp-foot');
  if(!el)return;
  const st=String(d.status||'');
  if(st==='approved'){
    el.innerHTML='<div class="tsp-done ok">'+svgIcon('✓',{size:14})+' Approved '+escHtml(_tspWhen(d.approved_at))+'</div>';
  }else if(st==='rejected'){
    el.innerHTML='<div class="tsp-done back">'+svgIcon('↩',{size:14})+' Sent back '+escHtml(_tspWhen(d.rejected_at))+
      (d.reject_note?'<div class="tsp-done-note">“'+escHtml(String(d.reject_note))+'”</div>':'')+'</div>'+
      '<div class="tsp-fine">A corrected timesheet will show up at this same link.</div>';
  }else{
    el.innerHTML=
      '<div id="tsp-reject-box" class="tsp-reject-box" hidden>'+
        '<label for="tsp-note" class="tsp-label">What is wrong?</label>'+
        '<textarea id="tsp-note" class="tsp-note" rows="2" maxlength="300" placeholder="Thursday should be 8, you left at 4"></textarea>'+
        '<div class="tsp-row"><button type="button" class="tsp-btn grey" onclick="_tspRejectCancel()">Cancel</button>'+
        '<button type="button" id="tsp-reject-go" class="tsp-btn dark" onclick="_tspDecide(\'reject\')">Send back</button></div>'+
      '</div>'+
      '<button type="button" id="tsp-reject" class="tsp-btn grey" onclick="_tspRejectOpen()">Reject</button>'+
      '<button type="button" id="tsp-approve" class="tsp-btn dark" onclick="_tspDecide(\'approve\')">'+svgIcon('✓',{size:14})+' Approve</button>';
  }
}
function _tspRejectOpen(){
  const box=document.getElementById('tsp-reject-box');
  const rj=document.getElementById('tsp-reject'),ap=document.getElementById('tsp-approve');
  if(box)box.hidden=false;
  if(rj)rj.hidden=true;
  if(ap)ap.hidden=true;
  try{document.getElementById('tsp-note').focus();}catch(_e){}
}
function _tspRejectCancel(){
  const box=document.getElementById('tsp-reject-box');
  const rj=document.getElementById('tsp-reject'),ap=document.getElementById('tsp-approve');
  if(box)box.hidden=true;
  if(rj)rj.hidden=false;
  if(ap)ap.hidden=false;
}
// The bars and the rail, through the app's own level builder. The link is
// ONE week, so the drill never leaves it: the month is not a level here.
async function _tspRender(){
  const el=document.getElementById('tsp-body');
  if(!el||!_tsp.data)return;
  const wk=String(_tsp.data.week_start||'').slice(0,10);
  const rows=await _timeLogRows(null);
  _tlLastRows=rows;_tlLastCid=null;
  if(!_tlDrill||_tlDrill.level==='month'||!_tlDrill.wk)_tlDrill={level:'week',mo:wk.slice(0,7),wk:wk,day:null,uid:null};
  _tlDrill.wk=wk;_tlDrill.uid=null;
  const lv=_tlLevelsHtml(rows,wk.slice(0,7),{share:false});
  el.className='tsp-body tsp-'+_tlDrill.level;
  if(!lv){el.innerHTML='<div class="tsp-empty">Nothing logged this week.</div>';return;}
  el.innerHTML=lv.head+
    '<div class="tl-drill-body'+(_tlMonthDir?' tl-mbars-'+_tlMonthDir:'')+'"'+_tlDrillXStyle()+'>'+lv.body+'</div>';
}
// js/timelog.js's own renderTimeLog is what the drill calls after a tap; on
// this page the drill repaints through here. Declared after timelog.js so
// this is the one that wins.
function renderTimeLog(){return _tspRender();}

// ── Approve / Reject ─────────────────────────────────────────────────────────
async function _tspDecide(decision){
  if(_tsp.busy)return false;
  const sb=_tspSupa();
  if(!sb)return _tspFail('Could not reach the server, try again');
  const note=decision==='reject'?String((document.getElementById('tsp-note')||{}).value||'').trim():null;
  if(decision==='reject'&&!note){try{document.getElementById('tsp-note').focus();}catch(_e){}return false;}
  _tsp.busy=true;
  document.querySelectorAll('#tsp-foot button').forEach(b=>{b.disabled=true;});
  try{
    const{data,error}=await sb.rpc('timesheet_decide',{p_token:_tsp.token,p_decision:decision,p_note:note,p_name:null});
    if(error)throw error;
    Object.assign(_tsp.data,data||{},{status:(data&&data.status)||(decision==='approve'?'approved':'rejected')});
    if(decision==='reject'&&!_tsp.data.reject_note)_tsp.data.reject_note=note;
    _tspHeader();_tspFooter();
    return true;
  }catch(_e){
    _tsp.busy=false;
    document.querySelectorAll('#tsp-foot button').forEach(b=>{b.disabled=false;});
    return _tspFail('That did not save, try again');
  }finally{_tsp.busy=false;}
}
function _tspFail(msg){
  const el=document.getElementById('tsp-err');
  if(el){el.textContent=msg;el.hidden=false;}
  return false;
}

// ── Boot ─────────────────────────────────────────────────────────────────────
function _tspState(kind,msg){
  const el=document.getElementById('tsp-state');
  if(!el)return;
  el.hidden=false;
  el.innerHTML='<div class="tsp-state-t">'+escHtml(kind)+'</div>'+(msg?'<div class="tsp-state-m">'+escHtml(msg)+'</div>':'');
  const page=document.getElementById('tsp-page');if(page)page.hidden=true;
}
async function _tspBoot(){
  const token=String(new URLSearchParams(location.search).get('t')||'').trim();
  _tsp.token=token;
  if(!token)return _tspState('This link is not complete','Open it from the text message it came in.');
  const sb=_tspSupa();
  if(!sb)return _tspState('Could not load','Check your connection and try again.');
  let data=null;
  try{
    const r=await sb.rpc('timesheet_public',{p_token:token});
    if(r&&r.error)throw r.error;
    data=r&&r.data;
  }catch(_e){return _tspState('Could not load','Check your connection and try again.');}
  if(!data||!data.week_start)return _tspState('This timesheet is not here','The link may be old or mistyped.');
  _tsp.data=data;
  _tsp.name=String(data.person_name||'Crew');
  S.bname=String(data.business_name||'');
  S.bizTz=String(data.biz_tz||'America/Chicago');
  _tsp.jobs={};
  (data.time||[]).forEach(e=>{if(e&&e.job_id!=null&&(e.job_name||e.client_name))_tsp.jobs[String(e.job_id)]={job_name:e.job_name,client_name:e.client_name,addr:e.addr};});
  timeEntries.length=0;(data.manual||[]).forEach(m=>{if(m&&typeof m==='object')timeEntries.push(m);});
  document.title=(_tsp.name?_tsp.name+' · ':'')+'Timesheet '+_tspRange(String(data.week_start).slice(0,10));
  _tspHeader();
  await _tspRender();
  _tspFooter();
  const page=document.getElementById('tsp-page');if(page)page.hidden=false;
}
document.addEventListener('DOMContentLoaded',()=>{_tspBoot();});
