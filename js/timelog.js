// ── Time Log, chronological "where did my time go" view ───────────────────
// Merges two time-tracking sources that don't otherwise talk to each other:
//   1. timeEntries (local array / td_time_entries cloud table), manual
//      Clock in/out, tagged with logged_by_uid/logged_by_name at save time
//      (js/jobs.js clockOut()).
//   2. job_time_entries (Supabase, via _fetchCrewLabor), GPS arrival/
//      departure auto-tracking (js/geo-track.js), already carries
//      employee_user_id.
// Owner call 2026-08-20: this is now ALSO the unified crew hours report
// (absorbing what was going to be a separate Crew Cost redesign, owner: "I
// don't want this under crew cost, want it under time log"), hours only,
// never dollars ("don't need pay rate here just time"). A year selector,
// then month accordions, January (oldest) THROUGH December (newest), the
// opposite order from every other Books accordion (Income/Expenses read
// newest-first) because this is a "how did the year build up" report, not
// a "what happened lately" ledger. Each month opens into week accordions
// (_bkWeekAcc, js/finance.js), and each week has its own Week/S/M/T/W/T/F/S
// day picker (owner: "need the day picker to change what day we're looking
// at") that swaps the SAME row list between the whole week and one day,
// nothing ever shown twice.
//
// Anyone with payroll/team permission (_canViewComp, owner or a manager)
// gets a Me/Team toggle at the top: Team breaks hours out per employee
// (avatar, on-site/drive/supply split bar, OT flag, your own row tagged
// "(you)"); Me is the same plain "your own days" view everyone else gets,
// plus a Share button. Owners default to Team (they already expect the
// full picture); managers default to Me (owner report 2026-08-20: seeing
// the whole crew by default was confusing for a manager who isn't the
// owner). Either way, whatever the picker currently shows (a week or one
// day) also opens into the exact same entries table this page always had,
// Edit/Delete on manual rows, the only place an entry can still be fixed.
// $ cost lives entirely in Crew Cost (js/finance.js _crewCostRender), which
// reads the same underlying rows; this page never touches wage/loaded rates.
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
    // Off-job stops (lunch, an errand) are captured so the day reconciles, but
    // this is the HOURS record: every row here feeds the weekly total and the
    // 40+hr overtime flag, so a lunch break appearing would be paid time and
    // could push someone into overtime they never worked.
    if(typeof _geoIsOffJobSource==='function'&&_geoIsOffJobSource(e.source))return;
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
  return dateKey(d);
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
// Split from the actual CSV build below so the build logic stays independently
// testable (tests/e2e-timelog.spec.js calls _tlDoExportCSV directly).
async function _tlExportCSV(){
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
// payroll permission Job Profit/Crew Cost already gate on. This is a DATA
// ACCESS rule, independent of the Me/Team display toggle below: a manager can
// edit anyone's entry whether they're currently looking at Me or Team.
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
// Sunday–Saturday label for a week key ('YYYY-MM-DD' Sunday date), e.g.
// "Week of Mar 9 – 15" (or "Mar 30 – Apr 5" when the week crosses a month).
function _tlWeekLabel(wkStart){
  const s=new Date(wkStart+'T00:00:00');
  if(isNaN(s.getTime()))return 'Week';
  const e=new Date(s);e.setDate(e.getDate()+6);
  const sameMonth=s.getMonth()===e.getMonth();
  const sLabel=s.toLocaleDateString('en-US',{month:'short',day:'numeric'});
  const eLabel=sameMonth?String(e.getDate()):e.toLocaleDateString('en-US',{month:'short',day:'numeric'});
  return 'Week of '+sLabel+' – '+eLabel;
}
// "Mon 3/9" for a day row inside an individual's week body.
function _tlDayShort(dateStr){
  const p=(dateStr||'').split('-').map(Number);
  if(p.length<3||!p[0]||!p[1]||!p[2])return dateStr||'-';
  const d=new Date(p[0],p[1]-1,p[2]);
  if(isNaN(d.getTime()))return dateStr;
  return d.toLocaleDateString('en-US',{weekday:'short'})+' '+p[1]+'/'+p[2];
}
// "Wed, Aug 19" for the day-picker's scope header, one notch more formal than
// _tlDayShort's "Wed 8/19" (used inline next to a job name instead).
function _tlDayFullLabel(dateStr){
  const p=(dateStr||'').split('-').map(Number);
  if(p.length<3||!p[0]||!p[1]||!p[2])return dateStr||'-';
  const d=new Date(p[0],p[1]-1,p[2]);
  if(isNaN(d.getTime()))return dateStr;
  return d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
}
// The 7 calendar dates (Sun..Sat, 'YYYY-MM-DD') for the week starting wkStart.
function _tlWeekDayDates(wkStart){
  const s=new Date(wkStart+'T00:00:00');
  if(isNaN(s.getTime()))return[];
  const out=[];
  for(let i=0;i<7;i++){const d=new Date(s);d.setDate(d.getDate()+i);out.push(dateKey(d));}
  return out;
}
// Per-employee aggregation over any row set (a week, a whole month, or a
// single day): total minutes plus the on-site/drive/supply-run split.
// Manual clock entries are always on-site (that's what a manual clock
// means); auto (GPS) entries classify via the same _geoIsDriveSource/
// _geoIsPlaceSource helpers Crew Cost already uses, so the two reports
// never disagree on what counts as drive time. Off-job stops never reach
// here, _timeLogRows already drops them. Keyed by personUid, owner-logged
// rows (personUid null) fold under `cid` so every owner entry lands in one
// bucket instead of scattering under an undefined key.
function _tlEmpWeekAgg(rows,cid){
  const byEmp={};
  rows.forEach(r=>{
    const uid=r.personUid||cid;
    const e=byEmp[uid]||(byEmp[uid]={min:0,onsiteMin:0,driveMin:0,placeMin:0,weekOT:false,name:r.personName});
    e.min+=r.minutes||0;
    if(r.weekOT)e.weekOT=true;
    if(r.source==='manual')e.onsiteMin+=r.minutes||0;
    else if(typeof _geoIsDriveSource==='function'&&_geoIsDriveSource(r.detail))e.driveMin+=r.minutes||0;
    else if(typeof _geoIsPlaceSource==='function'&&_geoIsPlaceSource(r.detail))e.placeMin+=r.minutes||0;
    else e.onsiteMin+=r.minutes||0;
    if(!e.name&&r.personName)e.name=r.personName;
  });
  return byEmp;
}
// Fixed bg/fg pairs (not app color tokens): these are decorative per-person
// wayfinding colors, not brand/semantic ones, so a small standalone palette
// is simpler than trying to derive tinted backgrounds from CSS custom
// properties. Picked from colors already used elsewhere in the app (blue,
// green, amber-deep) plus a couple of neighbors for variety on bigger crews.
const _TL_AVATAR_PALETTE=[
  {bg:'#2D5DA822',fg:'#2D5DA8'},{bg:'#0E6B3922',fg:'#0E6B39'},{bg:'#7C3AED22',fg:'#7C3AED'},
  {bg:'#9F5B0022',fg:'#9F5B00'},{bg:'#BE185D22',fg:'#BE185D'},{bg:'#0891B222',fg:'#0891B2'}
];
function _tlAvatarPalette(name){
  let h=0;const s=String(name||'');
  for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))>>>0;
  return _TL_AVATAR_PALETTE[h%_TL_AVATAR_PALETTE.length];
}
// "Owner (me)" is a placeholder label, not a real name, initials() turns it
// into a broken "O(" (first letters of "Owner" and "(me)"), so special-case it.
function _tlAvatarLabel(name){
  return name==='Owner (me)'?'Me':(typeof initials==='function'?initials(name):(name||'?').slice(0,2));
}
// Owner/manager Team-scope summary: one row per employee, hours + on-site/
// drive/supply split, no dollars ("don't need pay rate here just time"). $
// cost still lives in Crew Cost (_crewCostRender); this is purely a time
// report. Works on any row subset (a whole week or one drilled-down day),
// the caller decides the scope. selfUid tags the viewer's own row "(you)".
function _tlWeekOwnerHtml(byEmp,selfUid){
  const uids=Object.keys(byEmp).sort((a,b)=>byEmp[b].min-byEmp[a].min);
  const fm=typeof _fmtMin==='function'?_fmtMin:(m=>m+'m');
  return uids.map(uid=>{
    const e=byEmp[uid];
    const name=e.name||'Crew';
    const pal=_tlAvatarPalette(name);
    const parts=[];
    if(e.onsiteMin>3)parts.push('On-site '+fm(e.onsiteMin));
    if(e.driveMin>3)parts.push('Drive '+fm(e.driveMin));
    if(e.placeMin>3)parts.push('Supply/other '+fm(e.placeMin));
    const total=(e.onsiteMin+e.driveMin+e.placeMin)||1;
    const pOn=(e.onsiteMin/total*100).toFixed(1),pDr=(e.driveMin/total*100).toFixed(1),pPl=(e.placeMin/total*100).toFixed(1);
    const otBadge=e.weekOT?'<span class="tl-ot-badge" title="'+escHtml(name)+' logged 40+ hrs this week, verify overtime eligibility with your state; not payroll advice">OT</span>':'';
    const youTag=(selfUid&&String(uid)===String(selfUid))?' <span style="color:var(--text3);font-weight:600;font-size:11px">(you)</span>':'';
    return '<div class="tl-emp-row'+(e.weekOT?' ot':'')+'">'+
      '<div class="tl-avatar" style="background:'+pal.bg+';color:'+pal.fg+'">'+escHtml(_tlAvatarLabel(name))+'</div>'+
      '<div class="tl-emp-mid"><div class="tl-emp-name-row"><span class="tl-emp-name">'+escHtml(name)+'</span>'+youTag+otBadge+'</div>'+
        '<div class="tl-split"><div class="tl-split-bar"><span style="width:'+pOn+'%;background:var(--blue)"></span><span style="width:'+pDr+'%;background:#9F5B00"></span><span style="width:'+pPl+'%;background:var(--text3)"></span></div>'+
        '<div class="tl-split-legend">'+parts.join(' · ')+'</div></div></div>'+
      '<div class="tl-emp-total">'+fm(e.min)+'</div>'+
    '</div>';
  }).join('');
}
// Me-scope, Week selection: own days, no dollars. A single-day selection
// skips this (the Entries table below already says it all for one day).
function _tlWeekMineHtml(rows){
  const byDay={};
  rows.forEach(r=>{
    const d=r.date||'unknown';
    const e=byDay[d]||(byDay[d]={min:0,labels:new Set()});
    e.min+=r.minutes||0;
    if(r.clientName)e.labels.add(r.clientName);
  });
  const days=Object.keys(byDay).sort();
  return days.map(d=>{
    const e=byDay[d];const labels=[...e.labels];
    const label=labels.length===1?labels[0]:(labels.length>1?labels.length+' stops':'');
    return '<div style="display:flex;justify-content:space-between;font-size:11.5px;color:var(--text3);padding:3px 0">'+
      '<span>'+_tlDayShort(d)+(label?' · '+escHtml(label):'')+'</span>'+
      '<span style="font-weight:700;color:var(--text)">'+(typeof _fmtMin==='function'?_fmtMin(e.min):e.min+'m')+'</span>'+
    '</div>';
  }).join('');
}
// Per-week render state. Keyed by "mo|wk" (a week can straddle two calendar
// months, so mo alone or wk alone can't be trusted as a unique key on their
// own; see the cache population in renderTimeLog). Populated fresh every
// renderTimeLog() call; setTimeLogDayPick reads it later, outside that call,
// to redraw just one week's body without re-rendering the whole page (which
// would otherwise blow away every other month/week the viewer had opened).
let _tlWeekCache={};
// Which chip (day picker) is selected per week, 'week' or a weekday index
// '0'..'6'. Deliberately NOT reset on scope/year switches: staying on the
// same weekday when you flip Me/Team, or paging between weeks, reads as
// continuity, not a bug.
let _tlPickerSel={};
function setTimeLogDayPick(cacheKey,sel){
  const cache=_tlWeekCache[cacheKey];if(!cache)return;
  _tlPickerSel[cacheKey]=sel;
  const el=document.getElementById(cache.domId);
  if(el)el.innerHTML=_tlRenderWeekBody(cacheKey);
}
// Builds one week's inner content: the Week/S/M/T/W/T/F/S picker, the
// current scope's total, the Team/Me summary for whatever's picked, and the
// entries table (Edit/Delete on manual rows) scoped to the same picked range.
function _tlRenderWeekBody(cacheKey){
  const cache=_tlWeekCache[cacheKey];if(!cache)return '';
  const{mo,wk,rows:weekRows,scope,cid,selfUid}=cache;
  const fm=typeof _fmtMin==='function'?_fmtMin:(m=>m+'m');
  const sel=_tlPickerSel[cacheKey]||'week';
  const days=_tlWeekDayDates(wk);
  const workedIdx=new Set(weekRows.map(r=>days.indexOf(r.date)).filter(i=>i>=0));
  const pickerHtml='<div class="tl-picker">'+
    '<button class="tl-chip wk'+(sel==='week'?' active':'')+'" onclick="setTimeLogDayPick(\''+cacheKey+'\',\'week\')">Week</button>'+
    ['S','M','T','W','T','F','S'].map((d,i)=>
      '<button class="tl-chip'+(sel===String(i)?' active':'')+'" onclick="setTimeLogDayPick(\''+cacheKey+'\',\''+i+'\')">'+d+
        (workedIdx.has(i)?'<span class="tl-dot"></span>':'')+
      '</button>'
    ).join('')+
  '</div>';
  let scopeRows,scopeLabel;
  if(sel==='week'){scopeRows=weekRows;scopeLabel=_tlWeekLabel(wk);}
  else{const d=days[parseInt(sel,10)]||'';scopeRows=weekRows.filter(r=>r.date===d);scopeLabel=_tlDayFullLabel(d);}
  const scopeMin=scopeRows.reduce((s,r)=>s+(r.minutes||0),0);
  const scopeHdHtml='<div class="tl-scope-hd"><div class="tl-scope-ttl">'+escHtml(scopeLabel)+'</div><div class="tl-scope-amt">'+fm(scopeMin)+'</div></div>';
  let summaryHtml;
  if(!scopeRows.length){
    summaryHtml='<div class="tl-empty">No hours logged '+(sel==='week'?'this week.':'this day.')+'</div>';
  }else if(scope==='team'){
    summaryHtml=_tlWeekOwnerHtml(_tlEmpWeekAgg(scopeRows,cid),selfUid);
  }else if(sel==='week'){
    summaryHtml=_tlWeekMineHtml(scopeRows);
  }else{
    summaryHtml=''; // one day, your own scope: the entries table below already says it all
  }
  // Entries: the only place a manual clock entry can still be edited or
  // deleted (Edit button, _tlRow), scoped to whatever the picker currently
  // shows (a whole week or one day) instead of always the whole week.
  const entriesHtml=scopeRows.length?
    '<div style="margin-top:10px;padding-top:8px;border-top:1px dashed var(--line)">'+
      '<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin:0 2px 6px">Entries</div>'+
      _bkRenderDays('tl',mo,scopeRows,['Person','Job site','Clock In','Clock Out','Duration','Week total'],_tlRow,680,'var(--text)',r=>r.minutes||0,fm)+
    '</div>':'';
  return pickerHtml+scopeHdHtml+'<div style="padding:0 2px 4px">'+summaryHtml+'</div>'+entriesHtml;
}
// Me/Team display toggle, for anyone with payroll/team permission. Owners
// default to Team, managers default to Me (see renderTimeLog); either can
// switch any time and the choice sticks for the rest of the session, same
// as _tlYear. A permission loss (e.g. a dual-hat switch to a crew hat with
// no payroll access) can never leave scope stuck on 'team', renderTimeLog
// clamps it back to 'me' every render.
let _tlScope=null;
function setTimeLogScope(scope){
  if(scope!=='me'&&scope!=='team')return;
  _tlScope=scope;
  renderTimeLog();
}
// "Share this week's hours" (Me scope only, any role): the current Sun–Sat
// week, own rows only. _tlLastRows is only ever populated with Me-scoped
// rows while the Share button is visible (renderTimeLog hides the button
// entirely in Team scope), so no re-filtering by uid is needed here.
async function _tlShareWeek(){
  const wkStart=new Date();wkStart.setHours(0,0,0,0);wkStart.setDate(wkStart.getDate()-wkStart.getDay());
  const wkEnd=new Date(wkStart);wkEnd.setDate(wkEnd.getDate()+6);
  const wkStartStr=dateKey(wkStart),wkEndStr=dateKey(wkEnd);
  const rows=_tlLastRows.filter(r=>r.date>=wkStartStr&&r.date<=wkEndStr);
  if(!rows.length){typeof showToast==='function'&&showToast('No hours logged this week yet','📋');return;}
  const byDay={};
  rows.forEach(r=>{byDay[r.date]=(byDay[r.date]||0)+(r.minutes||0);});
  const totalMin=rows.reduce((s,r)=>s+(r.minutes||0),0);
  const lines=Object.keys(byDay).sort().map(d=>_tlDayShort(d)+': '+(typeof _fmtMin==='function'?_fmtMin(byDay[d]):byDay[d]+'m'));
  const text='My hours this week ('+_tlWeekLabel(wkStartStr)+')\n'+lines.join('\n')+'\nTotal: '+(typeof _fmtMin==='function'?_fmtMin(totalMin):totalMin+'m');
  if(typeof pwaShare==='function')await pwaShare({title:'This week\'s hours',text});
}
async function renderTimeLog(){
  const el=document.getElementById('tl-list');if(!el)return;
  _tlStartOpenRefresh();
  const totalEl=document.getElementById('tl-total');
  const shareEl=document.getElementById('tl-share');
  const toggleEl=document.getElementById('tl-scope-toggle');
  el.innerHTML='<div style="padding:6px 2px">'+_tdSkelRows(4,12)+'</div>';
  let allRows;
  try{allRows=await _timeLogRows(null);}
  catch(_e){el.innerHTML='<div class="empty">Couldn\'t load time entries.</div>';return;}
  const canComp=typeof _canViewComp==='function'&&_canViewComp();
  const isEmp=typeof _isEmployee!=='undefined'&&_isEmployee&&typeof _supaUser!=='undefined'&&_supaUser;
  const cid=(typeof _contractorUserId!=='undefined'&&_contractorUserId)||(typeof _supaUser!=='undefined'&&_supaUser&&_supaUser.id)||null;
  // "You," for filtering Me scope and tagging your own row in Team scope:
  // your real auth uid if you're an employee, else the contractor/owner id
  // (manual owner rows carry personUid:null, which _tlEmpWeekAgg already
  // folds under cid for aggregation, so this is the same identity key).
  const selfUid=isEmp?_supaUser.id:cid;

  // Owners land on Team (they already expect the full crew picture);
  // managers (payroll permission, but an employee) land on Me first, so a
  // fuller view doesn't ambush someone expecting just their own hours
  // (owner report 2026-08-20: "confusing for my brother in law"). Sticks
  // once set, same as _tlYear. Clamped every render so a permission loss
  // (dual-hat switch to a no-payroll crew hat) can never strand scope on
  // 'team' with nothing to show.
  if(_tlScope===null)_tlScope=canComp?(isEmp?'me':'team'):'me';
  const scope=(_tlScope==='team'&&canComp)?'team':'me';
  _tlScope=scope;

  if(toggleEl){
    if(canComp){
      toggleEl.style.display='flex';
      toggleEl.innerHTML=
        '<button class="tl-scope-btn'+(scope==='me'?' active':'')+'" onclick="setTimeLogScope(\'me\')">Me</button>'+
        '<button class="tl-scope-btn'+(scope==='team'?' active':'')+'" onclick="setTimeLogScope(\'team\')">Team</button>';
    }else{
      toggleEl.style.display='none';toggleEl.innerHTML='';
    }
  }

  const isMine=r=>isEmp?r.personUid===selfUid:(r.personUid===null||r.personUid===selfUid);
  const visible=scope==='team'?allRows:allRows.filter(isMine);
  // "This week" is a live indicator, not tied to the year selector, a
  // contractor running payroll cares about the current pay period regardless
  // of what year's history they happen to be scrolled to.
  const weekEl=document.getElementById('tl-week-total');
  if(weekEl){
    const wkStart=new Date();wkStart.setHours(0,0,0,0);wkStart.setDate(wkStart.getDate()-wkStart.getDay());
    const wkEnd=new Date(wkStart);wkEnd.setDate(wkEnd.getDate()+6);
    const wkStartStr=dateKey(wkStart),wkEndStr=dateKey(wkEnd);
    const wkMin=visible.filter(r=>r.date>=wkStartStr&&r.date<=wkEndStr).reduce((s,r)=>s+(r.minutes||0),0);
    weekEl.textContent=(typeof _fmtMin==='function'?_fmtMin(wkMin):wkMin+'m')+' This week (Sun–Sat)';
  }
  const years=_tlYears(visible);
  _tlPopulateYearSel(years);
  const yr=_tlYear;
  const rows=visible.filter(r=>(r.date||'').startsWith(yr));
  if(!rows.length){
    el.innerHTML='<div class="empty">No time logged in '+yr+(scope==='me'?' for you.':'.')+'</div>';
    if(totalEl)totalEl.textContent='';
    if(shareEl){shareEl.style.display='none';shareEl.innerHTML='';}
    _tlLastRows=[];
    return;
  }
  _tlComputeOT(rows);
  _tlComputeWeeklyRunning(rows);
  _tlLastRows=rows;
  const fm=typeof _fmtMin==='function'?_fmtMin:(m=>m+'m');
  const totalMin=rows.reduce((s,r)=>s+(r.minutes||0),0);
  if(totalEl)totalEl.textContent=fm(totalMin)+' total in '+yr;
  const byMonth={};
  rows.forEach(r=>{const mo=(r.date||'').slice(0,7)||'unknown';(byMonth[mo]||(byMonth[mo]=[])).push(r);});
  // January (oldest) → December (newest), owner call 2026-08-20. Every other
  // Books accordion (Income/Expenses) reads newest-first; this one deliberately
  // doesn't, so don't "fix" this sort to match them.
  const months=Object.keys(byMonth).sort((a,b)=>a.localeCompare(b));
  const curMo=todayKey().slice(0,7);
  const curWk=_tlWeekKey(todayKey());
  _tlWeekCache={};
  el.innerHTML='<div class="bk-months">'+months.map(mo=>{
    const moRows=byMonth[mo];
    const byWeek={};
    moRows.forEach(r=>{const wk=_tlWeekKey(r.date)||'unknown';(byWeek[wk]||(byWeek[wk]=[])).push(r);});
    const weeks=Object.keys(byWeek).sort((a,b)=>a.localeCompare(b));
    const moOpen=/^\d{4}-\d{2}$/.test(mo)&&mo>=curMo;
    const moMin=moRows.reduce((s,r)=>s+(r.minutes||0),0);
    let moSub=weeks.length+' week'+(weeks.length!==1?'s':'');
    if(scope==='team'){
      const empCount=Object.keys(_tlEmpWeekAgg(moRows,cid)).length;
      moSub+=' · '+empCount+' employee'+(empCount!==1?'s':'');
    }
    const moTotalHtml='<div style="font-size:15px;font-weight:900;color:var(--text);font-variant-numeric:tabular-nums;font-family:var(--font-display);letter-spacing:-.5px">'+fm(moMin)+'</div>';
    const weeksHtml=weeks.map(wk=>{
      const weekRows=byWeek[wk];
      const wkId=wk.replace(/[^0-9]/g,'')||'x';
      const domId='tl-wkbody-'+mo.replace(/[^0-9]/g,'')+'-'+wkId;
      const cacheKey=mo+'|'+wk;
      _tlWeekCache[cacheKey]={mo,wk,rows:weekRows,scope,cid,selfUid,domId};
      const wkOpen=moOpen&&wk===curWk;
      const wkLabel=_tlWeekLabel(wk);
      const wkMin=weekRows.reduce((s,r)=>s+(r.minutes||0),0);
      const wkTotalHtml='<div style="font-size:12.5px;font-weight:800;color:var(--text)">'+fm(wkMin)+'</div>';
      let wkSub;
      if(scope==='team'){
        const empCount=Object.keys(_tlEmpWeekAgg(weekRows,cid)).length;
        wkSub=empCount+' employee'+(empCount!==1?'s':'');
      }else{
        wkSub=weekRows.length+' entr'+(weekRows.length!==1?'ies':'y');
      }
      const bodyHtml='<div id="'+domId+'">'+_tlRenderWeekBody(cacheKey)+'</div>';
      return _bkWeekAcc('tl',mo,wkId,wkLabel,wkSub,wkTotalHtml,bodyHtml,wkOpen);
    }).join('');
    return _bkMonthAcc('tl',mo,_bkMonthLabel(mo),moSub,moTotalHtml,weeksHtml,moOpen);
  }).join('')+'</div>';
  if(shareEl){
    if(scope==='me'){
      shareEl.style.display='block';
      shareEl.innerHTML='<button onclick="_tlShareWeek()" class="btn btn-p" style="width:100%;margin-top:16px;height:48px;font-size:14px">'+svgIcon('⬆',{size:14})+' Share this week\'s hours</button>';
    }else{
      shareEl.style.display='none';shareEl.innerHTML='';
    }
  }
}
