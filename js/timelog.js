// ── Time Log, chronological "where did my time go" view ───────────────────
// Merges two time-tracking sources that don't otherwise talk to each other:
//   1. timeEntries (local array / td_time_entries cloud table), manual
//      Clock in/out, tagged with logged_by_uid/logged_by_name at save time
//      (js/jobs.js clockOut()).
//   2. job_time_entries (Supabase, via _fetchCrewLabor), GPS arrival/
//      departure auto-tracking (js/geo-track.js), already carries
//      employee_user_id.
// Owner call 2026-07-11: structure follows Books exactly, a year selector,
// then month accordions (newest month first, current/future open by
// default), then day accordions within each month (newest day first), the
// same _bkTogMonth/_bkTogDay/_bkRenderDays machinery Income and Expenses
// already use (js/finance.js), just summing minutes instead of dollars. This
// is an activity log, not a cost report, no permission gate to see your OWN
// entries. Job Profit and Crew Cost are the $ views; they read the same rows
// so cost isn't blind to manually-clocked time.
function _tlJobClientInfo(jobId){
  const j=jobs.find(x=>x.id===jobId);
  const bid=j&&j.bid_id?bids.find(b=>b.id===j.bid_id):null;
  const c=bid?getClientById(bid.client_id):(j?getClientById(j.client_id):null);
  // Job-site address, not billing address, a bid's own addr (when set) is the
  // actual property being worked, which can differ from the client's address
  // (property managers, rentals, multi-site commercial accounts). Same
  // precedence js/jobs.js already uses for job cards (bid.addr||client.addr).
  const addr=(bid&&bid.addr)||(j&&j.addr)||(c&&c.addr)||'';
  return{jobName:j?j.name:'-',clientName:c?c.name:(j?j.name:'-'),addr};
}
// Still-running entries, clocked in, never closed. Separate from the history
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
    if(e.open)return; // still running, shown separately, see _tlOpenEntries
    if(sinceISO&&e.start_time&&e.start_time<sinceISO)return;
    const info=_tlJobClientInfo(e.job_id);
    rows.push({
      id:'m'+e.id,rawId:e.id,source:'manual',date:e.date,minutes:e.minutes||0,
      personName:e.logged_by_name||((typeof getOwnerName==='function'&&getOwnerName())||'Owner (me)'),
      personUid:e.logged_by_uid||null,
      clientName:info.clientName,addr:info.addr,jobName:info.jobName,detail:e.scope_label||'',
      startTime:e.start_time||null,endTime:e.end_time||null
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
      clientName:info.clientName,addr:info.addr,jobName:info.jobName,detail:e.source||'geo',
      startTime:e.arrived_at||null,endTime:e.departed_at||null
    });
  });
  return rows.sort((a,b)=>(b.date||'').localeCompare(a.date||''));
}
function _tlYears(rows){
  const years=[...new Set(rows.map(r=>(r.date||'').slice(0,4)).filter(y=>/^\d{4}$/.test(y)))].sort((a,b)=>b.localeCompare(a));
  if(!years.length)years.push(String(new Date().getFullYear()));
  return years;
}
// Sunday of the week containing dateStr, the grouping key for weekly totals
// and overtime. Payroll periods vary (weekly/biweekly/semimonthly), but every
// one of them is built from calendar weeks, so this is the one grouping that's
// never wrong to offer.
function _tlWeekKey(dateStr){
  if(!dateStr)return '';
  const d=new Date(dateStr+'T00:00:00');
  if(isNaN(d.getTime()))return '';
  d.setDate(d.getDate()-d.getDay());
  return d.toISOString().slice(0,10);
}
// Overtime: federal (FLSA) is per-person, per-week, over 40 hours, the one
// rule that's true everywhere. Daily OT (e.g. CA/AK/NV/CO over 8hrs/day) is
// state-specific; asserting it as a default would be actively wrong for most
// contractors, so this deliberately only flags the universal rule and leaves
// the rest to "verify with your state," same disclaimer pattern as the tax
// tool. Mutates rows in place (adds weekOT), cheap, avoids a second pass in
// every row renderer.
function _tlComputeOT(rows){
  const byWeek={};
  rows.forEach(r=>{
    const key=(r.personUid||'owner')+'|'+_tlWeekKey(r.date);
    byWeek[key]=(byWeek[key]||0)+(r.minutes||0);
  });
  rows.forEach(r=>{
    const key=(r.personUid||'owner')+'|'+_tlWeekKey(r.date);
    r.weekOT=byWeek[key]>2400;
  });
}
// Running weekly total for payroll: "as of this day, how many hours has this
// person logged so far this week", computed chronologically (oldest day
// first) per person per week regardless of display order (rows render
// newest-first). Granularity is per-DAY, not per-entry: every entry on the
// same day for the same person shows the same running total (the total
// through the end of that day), since GPS entries don't always carry a
// reliable intra-day ordering to split on. Mutates rows in place.
function _tlComputeWeeklyRunning(rows){
  const dayTotals={}; // 'person|date' -> minutes that day
  rows.forEach(r=>{
    const k=(r.personUid||'owner')+'|'+r.date;
    dayTotals[k]=(dayTotals[k]||0)+(r.minutes||0);
  });
  const weekDays={}; // 'person|weekKey' -> Set of dates
  Object.keys(dayTotals).forEach(k=>{
    const sep=k.indexOf('|');
    const person=k.slice(0,sep),date=k.slice(sep+1);
    const wk=person+'|'+_tlWeekKey(date);
    (weekDays[wk]=weekDays[wk]||new Set()).add(date);
  });
  const runningThroughDay={}; // 'person|date' -> cumulative minutes through that day
  Object.keys(weekDays).forEach(wk=>{
    const person=wk.slice(0,wk.indexOf('|'));
    const dates=[...weekDays[wk]].sort();
    let running=0;
    dates.forEach(date=>{
      running+=dayTotals[person+'|'+date]||0;
      runningThroughDay[person+'|'+date]=running;
    });
  });
  rows.forEach(r=>{
    const k=(r.personUid||'owner')+'|'+r.date;
    r.weekRunningMin=runningThroughDay[k]||0;
  });
}
// Formats an ISO timestamp as a plain clock time ("8:02 AM"). Used for both
// the Clock In/Clock Out columns and the CSV export, one place so the two
// never drift out of format with each other.
function _tlFmtTime(iso){
  if(!iso)return '';
  const d=new Date(iso);
  if(isNaN(d.getTime()))return '';
  return d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
}
let _tlLastRows=[];
// Owner spec 2026-07-17: locked the same as Books exports, 2 consecutive
// billing cycles or exempt. See _requireExportsUnlocked (js/cloud.js). Split
// from the actual CSV build below so the build logic stays independently
// testable (tests/e2e-timelog.spec.js calls _tlDoExportCSV directly).
async function _tlExportCSV(){
  if(typeof _requireExportsUnlocked==='function'&&!(await _requireExportsUnlocked()))return;
  _tlDoExportCSV();
}
function _tlDoExportCSV(){
  if(!_tlLastRows.length){typeof showToast==='function'&&showToast('No time entries to export for '+_tlYear,'📋');return;}
  const esc=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"';
  const header=['Date','Person','Job Address','Client','Job','Task','Source','Clock In','Clock Out','Minutes','Duration','Week Total','Overtime'];
  const lines=[header.map(esc).join(',')];
  _tlLastRows.slice().sort((a,b)=>(a.date||'').localeCompare(b.date||'')).forEach(r=>{
    lines.push([
      r.date||'',r.personName||'',r.addr||'',r.clientName||'',r.jobName||'',r.detail||'',
      r.source==='auto'?'Auto (GPS)':'Manual',
      _tlFmtTime(r.startTime),_tlFmtTime(r.endTime),
      r.minutes||0,
      typeof _fmtMin==='function'?_fmtMin(r.minutes):(r.minutes||0)+'m',
      typeof _fmtMin==='function'?_fmtMin(r.weekRunningMin||0):(r.weekRunningMin||0)+'m',
      r.weekOT?'40+ hrs/wk':''
    ].map(esc).join(','));
  });
  const biz=(typeof S!=='undefined'&&S.bname)?S.bname:'TradeDesk';
  const fname=(biz+'_TimeLog_'+_tlYear+'.csv').replace(/[/,\s]+/g,'_');
  if(typeof downloadFile==='function')downloadFile(fname,lines.join('\n'),'text/csv');
  typeof showToast==='function'&&showToast('Time Log exported, '+_tlYear,'📋');
}
let _tlYear=null;
function _tlPopulateYearSel(years){
  const sel=document.getElementById('tl-year-sel');if(!sel)return;
  const cur=(_tlYear&&years.includes(_tlYear))?_tlYear:years[0];
  _tlYear=cur;
  sel.innerHTML=years.map(y=>'<option value="'+y+'"'+(y===cur?' selected':'')+'>'+y+'</option>').join('');
}
function setTimeLogYear(yr){_tlYear=String(yr);renderTimeLog();}
// Manual entries only, GPS-verified auto entries aren't user-editable, same as
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
  // Delete isn't a button here, it's the same 3s hold-to-confirm gesture used
  // everywhere else in the app ([data-lp-id], js/cloud.js). The attributes are
  // only emitted when canEdit is true, so the gesture is simply absent (does
  // nothing) on GPS/auto rows and on entries this person isn't allowed to
  // touch: same visibility rule the Edit button already follows.
  const lpAttrs=canEdit?' data-lp-id="'+r.rawId+'" data-lp-type="timelog" data-lp-label="'+escHtml(r.personName+' · '+r.clientName)+'"':'';
  // Job address is the primary line (owner request 2026-07-11: "show the day,
  // job address, person..."): client name/job/task fold into a muted second
  // line along with the manual-vs-GPS source tag, which used to be its own column.
  const jobLine=[r.clientName,(r.jobName&&r.jobName!==r.clientName)?r.jobName:null,r.detail||null].filter(Boolean).map(escHtml).join(' · ');
  const sourceTag=r.source==='auto'?svgIcon('📍',{size:10})+' Auto':svgIcon('▶',{size:10})+' Manual';
  return '<tr'+lpAttrs+'>'+
    '<td class="bold" data-label="Person">'+escHtml(r.personName)+'</td>'+
    '<td data-label="Job site">'+
      (r.addr?'<div style="font-weight:700">'+escHtml(r.addr)+'</div>':'')+
      '<div class="mute" style="font-size:11px;margin-top:'+(r.addr?'2px':'0')+'">'+jobLine+(jobLine?' · ':'')+sourceTag+'</div>'+
    '</td>'+
    '<td data-label="Clock In">'+(_tlFmtTime(r.startTime)||'-')+'</td>'+
    '<td data-label="Clock Out">'+(_tlFmtTime(r.endTime)||'-')+'</td>'+
    '<td class="bold" data-label="Duration" style="text-align:right">'+(typeof _fmtMin==='function'?_fmtMin(r.minutes):r.minutes+'m')+
      (r.weekOT?' <span title="'+escHtml(r.personName)+' logged 40+ hrs the week of '+_tlWeekKey(r.date)+', verify overtime eligibility with your state; not payroll advice" style="font-size:9px;font-weight:800;padding:2px 5px;border-radius:4px;background:var(--c-amber-soft);color:var(--c-amber-deep);margin-left:4px;white-space:nowrap">OT WK</span>':'')+
    '</td>'+
    '<td data-label="Week total" style="text-align:right">'+(typeof _fmtMin==='function'?_fmtMin(r.weekRunningMin||0):(r.weekRunningMin||0)+'m')+'</td>'+
    '<td data-label="">'+(canEdit?
      '<button onclick="_openEditTimeEntry('+r.rawId+')" style="font-size:11px;padding:3px 9px;border-radius:4px;border:1px solid var(--border2);background:var(--bg2);color:var(--text);cursor:pointer;font-family:inherit;font-weight:600">Edit</button>'
      :'')+'</td>'+
  '</tr>';
}
// Still-clocked-in banner, separate from the year/month/day history below,
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
      // 10+ hrs still open is almost always a forgotten clock-out, not a real
      // shift: flag it so a manager (or the person themselves) notices
      // before it silently becomes a wrong payroll number.
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:7px 0;border-top:1px solid var(--c-green-edge)">'+
        '<div style="min-width:0">'+
          '<div style="font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml(r.personName)+(r.elapsedMin>600?' <span title="Clocked in 10+ hours, likely a forgotten clock-out" style="font-size:9px;font-weight:800;padding:2px 5px;border-radius:4px;background:var(--c-red-soft);color:var(--c-red-deep);margin-left:4px">LONG SHIFT</span>':'')+'</div>'+
          '<div style="font-size:11px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml(r.clientName)+(r.jobName?' · '+escHtml(r.jobName):'')+'</div>'+
          '<div style="font-size:11px;color:var(--text3)">since '+new Date(r.startTime).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})+'</div>'+
        '</div>'+
        '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0">'+
          '<div style="font-size:13px;font-weight:800'+(r.elapsedMin>600?';color:var(--c-red-deep)':'')+'">'+(typeof _fmtMin==='function'?_fmtMin(r.elapsedMin):r.elapsedMin+'m')+'</div>'+
          // Own entry: a real clockOut(): matches _activeTimer by construction
          // (either this device's live session, or restored by
          // _rehydrateActiveTimer() on boot). Someone else's entry: the
          // manager-only force-close, which audit-tags who closed it.
          (r.personUid===myUid?'<button onclick="clockOut();_tlRenderOpenBanner()" class="btn btn-sm" style="font-size:11px">Clock out</button>'
            :canForce?'<button onclick="forceClockOutEntry('+r.rawId+')" class="btn btn-sm" style="font-size:11px">Clock out</button>':'')+
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
  // "This week" is a live indicator, not tied to the year selector, a
  // contractor running payroll cares about the current pay period regardless
  // of what year's history they happen to be scrolled to.
  const weekEl=document.getElementById('tl-week-total');
  if(weekEl){
    const wkStart=new Date();wkStart.setHours(0,0,0,0);wkStart.setDate(wkStart.getDate()-wkStart.getDay());
    const wkEnd=new Date(wkStart);wkEnd.setDate(wkEnd.getDate()+6);
    const wkStartStr=wkStart.toISOString().slice(0,10),wkEndStr=wkEnd.toISOString().slice(0,10);
    const wkMin=visible.filter(r=>r.date>=wkStartStr&&r.date<=wkEndStr).reduce((s,r)=>s+(r.minutes||0),0);
    weekEl.textContent=(typeof _fmtMin==='function'?_fmtMin(wkMin):wkMin+'m')+' This week (Sun–Sat)';
  }
  const years=_tlYears(visible);
  _tlPopulateYearSel(years);
  const yr=_tlYear;
  const rows=visible.filter(r=>(r.date||'').startsWith(yr));
  if(!rows.length){
    el.innerHTML='<div class="empty">No time logged in '+yr+'.</div>';
    if(totalEl)totalEl.textContent='';
    _tlLastRows=[];
    return;
  }
  _tlComputeOT(rows);
  _tlComputeWeeklyRunning(rows);
  _tlLastRows=rows;
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
        _bkRenderDays('tl',mo,moRows,['Person','Job site','Clock In','Clock Out','Duration','Week total'],_tlRow,680,'var(--text)',r=>r.minutes||0,typeof _fmtMin==='function'?_fmtMin:(m=>m+'m'))+
      '</div>'+
    '</div>';
  }).join('')+'</div>';
}
