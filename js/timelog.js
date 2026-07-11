// ── Time Log — chronological "where did my time go" view ───────────────────
// Merges two time-tracking sources that don't otherwise talk to each other:
//   1. timeEntries (local array / td_time_entries cloud table) — manual
//      Clock in/out, tagged with logged_by_uid/logged_by_name at save time
//      (js/jobs.js clockOut()).
//   2. job_time_entries (Supabase, via _fetchCrewLabor) — GPS arrival/
//      departure auto-tracking (js/geo-track.js), already carries
//      employee_user_id.
// Owner call 2026-07-11: structure follows Books exactly — a year selector,
// then month accordions (newest month first, current/future open by
// default), then day accordions within each month (newest day first) — the
// same _bkTogMonth/_bkTogDay/_bkRenderDays machinery Income and Expenses
// already use (js/finance.js), just summing minutes instead of dollars. This
// is an activity log, not a cost report — no permission gate to see your OWN
// entries. Job Profit and Crew Cost are the $ views; they read the same rows
// so cost isn't blind to manually-clocked time.
function _tlJobClientInfo(jobId){
  const j=jobs.find(x=>x.id===jobId);
  const bid=j&&j.bid_id?bids.find(b=>b.id===j.bid_id):null;
  const c=bid?getClientById(bid.client_id):(j?getClientById(j.client_id):null);
  return{jobName:j?j.name:'—',clientName:c?c.name:(j?j.name:'—'),addr:c?c.addr:(j&&j.addr)||''};
}
// Still-running entries — clocked in, never closed. Separate from the history
// below: an open entry has no minutes yet, so mixing it into the month/day
// accordions would just show a confusing "0m" row. This is also the visibility
// a manager needs to force-close a forgotten clock (§ owner request 2026-07-11).
function _tlOpenEntries(){
  const rows=[];
  timeEntries.forEach(e=>{
    if(!e.open)return;
    const info=_tlJobClientInfo(e.job_id);
    const elapsedMin=Math.max(0,Math.round((Date.now()-new Date(e.start_time).getTime())/60000));
    rows.push({
      rawId:e.id,personName:e.logged_by_name||((typeof getOwnerName==='function'&&getOwnerName())||'Owner (me)'),
      personUid:e.logged_by_uid||null,clientName:info.clientName,addr:info.addr,jobName:info.jobName,
      detail:e.scope_label||'',startTime:e.start_time,elapsedMin
    });
  });
  return rows.sort((a,b)=>(a.startTime||'').localeCompare(b.startTime||''));
}
async function _timeLogRows(sinceISO){
  const rows=[];
  timeEntries.forEach(e=>{
    if(e.open)return; // still running — shown separately, see _tlOpenEntries
    if(sinceISO&&e.start_time&&e.start_time<sinceISO)return;
    const info=_tlJobClientInfo(e.job_id);
    rows.push({
      id:'m'+e.id,rawId:e.id,source:'manual',date:e.date,minutes:e.minutes||0,
      personName:e.logged_by_name||((typeof getOwnerName==='function'&&getOwnerName())||'Owner (me)'),
      personUid:e.logged_by_uid||null,
      clientName:info.clientName,addr:info.addr,jobName:info.jobName,detail:e.scope_label||''
    });
  });
  const crew=(typeof _fetchCrewLabor==='function')?await _fetchCrewLabor(sinceISO):{name:{},entries:[]};
  (crew.entries||[]).forEach(e=>{
    if(!e.arrived_at)return;
    const info=_tlJobClientInfo(e.job_id);
    rows.push({
      id:'a'+e.job_id+'_'+e.employee_user_id+'_'+e.arrived_at,
      source:'auto',date:(typeof _ctDateStr==='function')?_ctDateStr(new Date(e.arrived_at)):e.arrived_at.slice(0,10),
      minutes:e.minutes||0,personName:crew.name[e.employee_user_id]||'Crew',personUid:e.employee_user_id,
      clientName:info.clientName,addr:info.addr,jobName:info.jobName,detail:e.source||'geo'
    });
  });
  return rows.sort((a,b)=>(b.date||'').localeCompare(a.date||''));
}
function _tlYears(rows){
  const years=[...new Set(rows.map(r=>(r.date||'').slice(0,4)).filter(y=>/^\d{4}$/.test(y)))].sort((a,b)=>b.localeCompare(a));
  if(!years.length)years.push(String(new Date().getFullYear()));
  return years;
}
let _tlYear=null;
function _tlPopulateYearSel(years){
  const sel=document.getElementById('tl-year-sel');if(!sel)return;
  const cur=(_tlYear&&years.includes(_tlYear))?_tlYear:years[0];
  _tlYear=cur;
  sel.innerHTML=years.map(y=>'<option value="'+y+'"'+(y===cur?' selected':'')+'>'+y+'</option>').join('');
}
function setTimeLogYear(yr){_tlYear=String(yr);renderTimeLog();}
// Manual entries only — GPS-verified auto entries aren't user-editable, same as
// every competitor researched (editing GPS-verified data would defeat its
// purpose). Own entries always editable/deletable; others' only with the same
// payroll permission Job Profit/Crew Cost already gate on.
function _tlCanEdit(r){
  if(r.source!=='manual')return false;
  if(typeof _canViewComp==='function'&&_canViewComp())return true;
  const myUid=(typeof _isEmployee!=='undefined'&&_isEmployee&&typeof _supaUser!=='undefined'&&_supaUser)?_supaUser.id:null;
  return r.personUid===myUid;
}
function _tlRow(r){
  const canEdit=_tlCanEdit(r);
  return '<tr data-lp-id="'+r.id+'" data-lp-type="timelog" data-lp-label="'+escHtml(r.personName+' · '+r.clientName)+'">'+
    '<td class="bold" data-label="Person">'+escHtml(r.personName)+'</td>'+
    '<td data-label="Client">'+escHtml(r.clientName)+(r.addr?' <span style="color:var(--text3);font-weight:400">· '+escHtml(r.addr)+'</span>':'')+'</td>'+
    '<td class="mute" data-label="Job">'+escHtml(r.jobName)+(r.detail?' · '+escHtml(r.detail):'')+'</td>'+
    '<td data-label="Source">'+(r.source==='auto'?svgIcon('📍',{size:11})+' Auto':svgIcon('▶',{size:11})+' Manual')+'</td>'+
    '<td class="bold" data-label="Duration" style="text-align:right">'+(typeof _fmtMin==='function'?_fmtMin(r.minutes):r.minutes+'m')+'</td>'+
    '<td data-label="">'+(canEdit?
      '<button onclick="_openEditTimeEntry('+r.rawId+')" style="font-size:11px;padding:3px 9px;border-radius:4px;border:1px solid var(--border2);background:var(--bg2);color:var(--text);cursor:pointer;font-family:inherit;font-weight:600;margin-right:4px">Edit</button>'+
      '<button onclick="if(confirm(\'Delete this time entry?\'))deleteTimeEntry('+r.rawId+')" style="font-size:11px;padding:3px 9px;border-radius:4px;border:1px solid var(--border2);background:var(--bg2);color:#A32D2D;cursor:pointer;font-family:inherit;font-weight:600">Delete</button>'
      :'')+'</td>'+
  '</tr>';
}
// Still-clocked-in banner — separate from the year/month/day history below,
// refreshed on its own 30s tick while this page is open so elapsed time keeps
// moving without re-rendering the whole accordion tree. Stops itself the
// moment the page is no longer active (no leaked timers on other pages).
let _tlOpenRefreshTimer=null;
function _tlRenderOpenBanner(){
  const el=document.getElementById('tl-open');if(!el)return;
  const open=_tlOpenEntries();
  const canForce=typeof _canViewComp==='function'&&_canViewComp();
  const myUid=(typeof _isEmployee!=='undefined'&&_isEmployee&&typeof _supaUser!=='undefined'&&_supaUser)?_supaUser.id:null;
  const visible=canForce?open:open.filter(r=>r.personUid===myUid);
  if(!visible.length){el.innerHTML='';el.style.display='none';return;}
  el.style.display='block';
  el.innerHTML='<div class="card" style="margin-bottom:14px;border:1px solid var(--c-green-edge);background:var(--c-green-soft)">'+
    '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--c-green-deep);margin-bottom:6px">'+svgIcon('▶',{size:12})+' Currently clocked in</div>'+
    visible.map(r=>
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:7px 0;border-top:1px solid var(--c-green-edge)">'+
        '<div style="min-width:0">'+
          '<div style="font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml(r.personName)+'</div>'+
          '<div style="font-size:11px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml(r.clientName)+(r.jobName?' · '+escHtml(r.jobName):'')+'</div>'+
          '<div style="font-size:11px;color:var(--text3)">since '+new Date(r.startTime).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})+'</div>'+
        '</div>'+
        '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0">'+
          '<div style="font-size:13px;font-weight:800">'+(typeof _fmtMin==='function'?_fmtMin(r.elapsedMin):r.elapsedMin+'m')+'</div>'+
          (canForce&&r.personUid!==myUid?'<button onclick="forceClockOutEntry('+r.rawId+')" class="btn btn-sm" style="font-size:11px">Clock out</button>':'')+
        '</div>'+
      '</div>'
    ).join('')+
  '</div>';
}
function _tlStopOpenRefresh(){if(_tlOpenRefreshTimer){clearInterval(_tlOpenRefreshTimer);_tlOpenRefreshTimer=null;}}
function _tlStartOpenRefresh(){
  _tlStopOpenRefresh();
  _tlRenderOpenBanner();
  _tlOpenRefreshTimer=setInterval(()=>{
    if(!document.getElementById('pg-timelog')?.classList.contains('active')){_tlStopOpenRefresh();return;}
    _tlRenderOpenBanner();
  },30000);
}
async function renderTimeLog(){
  const el=document.getElementById('tl-list');if(!el)return;
  _tlStartOpenRefresh();
  const totalEl=document.getElementById('tl-total');
  el.innerHTML='<div class="empty">Loading…</div>';
  let allRows;
  try{allRows=await _timeLogRows(null);}
  catch(_e){el.innerHTML='<div class="empty">Couldn\'t load time entries.</div>';return;}
  const myUid=(typeof _isEmployee!=='undefined'&&_isEmployee&&typeof _supaUser!=='undefined'&&_supaUser)?_supaUser.id:null;
  const visible=(typeof _canViewComp==='function'&&_canViewComp())?allRows:allRows.filter(r=>r.personUid===myUid);
  const years=_tlYears(visible);
  _tlPopulateYearSel(years);
  const yr=_tlYear;
  const rows=visible.filter(r=>(r.date||'').startsWith(yr));
  if(!rows.length){
    el.innerHTML='<div class="empty">No time logged in '+yr+'.</div>';
    if(totalEl)totalEl.textContent='';
    return;
  }
  const totalMin=rows.reduce((s,r)=>s+(r.minutes||0),0);
  if(totalEl)totalEl.textContent=(typeof _fmtMin==='function'?_fmtMin(totalMin):totalMin+'m')+' total in '+yr;
  const byMonth={};
  rows.forEach(r=>{const mo=(r.date||'').slice(0,7)||'unknown';(byMonth[mo]||(byMonth[mo]=[])).push(r);});
  const months=Object.keys(byMonth).sort((a,b)=>b.localeCompare(a));
  const curMo=new Date().toISOString().slice(0,7);
  el.innerHTML='<div class="bk-months">'+months.map(mo=>{
    const moRows=byMonth[mo];
    const moMin=moRows.reduce((s,r)=>s+(r.minutes||0),0);
    const[y,m]=mo.split('-');
    const moLabel=(y&&m)?new Date(parseInt(y),parseInt(m)-1,1).toLocaleDateString('en-US',{month:'long',year:'numeric'}):mo;
    const isOpen=/^\d{4}-\d{2}$/.test(mo)&&mo>=curMo;
    return '<div id="bk-tl-mo-'+mo+'" class="bk-month'+(isOpen?' open':'')+'">'+
      '<button class="bk-month-hd" onclick="_bkTogMonth(\'tl\',\''+mo+'\')">'+
        '<div style="flex:1;text-align:left">'+
          '<div class="bk-month-title">'+moLabel+'</div>'+
          '<div class="bk-month-sub">'+moRows.length+' entr'+(moRows.length!==1?'ies':'y')+'</div>'+
        '</div>'+
        '<div style="display:flex;align-items:center;gap:10px">'+
          '<div style="font-size:15px;font-weight:900;color:var(--text);font-variant-numeric:tabular-nums;font-family:var(--font-display);letter-spacing:-.5px">'+(typeof _fmtMin==='function'?_fmtMin(moMin):moMin+'m')+'</div>'+
          '<div class="bk-month-chev">▸</div>'+
        '</div>'+
      '</button>'+
      '<div class="bk-month-body"'+(isOpen?'':' style="display:none"')+'>'+
        _bkRenderDays('tl',mo,moRows,['Person','Client','Job','Source','Duration'],_tlRow,560,'var(--text)',r=>r.minutes||0,typeof _fmtMin==='function'?_fmtMin:(m=>m+'m'))+
      '</div>'+
    '</div>';
  }).join('')+'</div>';
}
