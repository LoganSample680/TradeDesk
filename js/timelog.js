// ── Time Log — chronological "where did my time go" view ───────────────────
// Merges two time-tracking sources that don't otherwise talk to each other:
//   1. timeEntries (local array / td_time_entries cloud table) — manual
//      Clock in/out, tagged with logged_by_uid/logged_by_name at save time
//      (js/jobs.js clockOut()).
//   2. job_time_entries (Supabase, via _fetchCrewLabor) — GPS arrival/
//      departure auto-tracking (js/geo-track.js), already carries
//      employee_user_id.
// This is an activity log (name/date/job/address/duration), not a cost
// report — no permission gate to see your OWN entries. Job Profit and Crew
// Cost are the $ views; they read the same rows so cost isn't blind to
// manually-clocked time.
function _tlSinceISO(range){
  const now=new Date();
  if(range==='today'){const d=new Date(now);d.setHours(0,0,0,0);return d.toISOString();}
  if(range==='week'){const d=new Date(now);d.setDate(d.getDate()-7);return d.toISOString();}
  if(range==='month'){const d=new Date(now);d.setDate(d.getDate()-30);return d.toISOString();}
  return null; // 'all'
}
function _tlJobClientInfo(jobId){
  const j=jobs.find(x=>x.id===jobId);
  const bid=j&&j.bid_id?bids.find(b=>b.id===j.bid_id):null;
  const c=bid?getClientById(bid.client_id):(j?getClientById(j.client_id):null);
  return{jobName:j?j.name:'—',clientName:c?c.name:(j?j.name:'—'),addr:c?c.addr:(j&&j.addr)||''};
}
async function _timeLogRows(sinceISO){
  const rows=[];
  timeEntries.forEach(e=>{
    if(sinceISO&&e.start_time&&e.start_time<sinceISO)return;
    const info=_tlJobClientInfo(e.job_id);
    rows.push({
      id:'m'+e.id,source:'manual',date:e.date,minutes:e.minutes||0,
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
let _tlRange='week';
async function renderTimeLog(range){
  if(range)_tlRange=range;
  document.querySelectorAll('#tl-range-bar .fb').forEach(b=>b.classList.toggle('active',b.dataset.range===_tlRange));
  const el=document.getElementById('tl-list');if(!el)return;
  const totalEl=document.getElementById('tl-total');
  el.innerHTML='<div class="empty">Loading…</div>';
  let rows;
  try{rows=await _timeLogRows(_tlSinceISO(_tlRange));}
  catch(_e){el.innerHTML='<div class="empty">Couldn\'t load time entries.</div>';return;}
  const myUid=(typeof _isEmployee!=='undefined'&&_isEmployee&&typeof _supaUser!=='undefined'&&_supaUser)?_supaUser.id:null;
  const visible=(typeof _canViewComp==='function'&&_canViewComp())?rows:rows.filter(r=>r.personUid===myUid);
  if(!visible.length){
    el.innerHTML='<div class="empty">No time logged in this range.</div>';
    if(totalEl)totalEl.textContent='';
    return;
  }
  const totalMin=visible.reduce((s,r)=>s+(r.minutes||0),0);
  if(totalEl)totalEl.textContent=(typeof _fmtMin==='function'?_fmtMin(totalMin):totalMin+'m')+' total';
  el.innerHTML=visible.map(r=>
    '<div class="card" style="margin-bottom:8px">'+
      '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">'+
        '<div style="font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml(r.personName)+'</div>'+
        '<div style="font-size:13px;font-weight:800;color:var(--text);flex-shrink:0">'+(typeof _fmtMin==='function'?_fmtMin(r.minutes):r.minutes+'m')+'</div>'+
      '</div>'+
      '<div style="font-size:12px;color:var(--text2);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml(r.clientName)+(r.addr?' · '+escHtml(r.addr):'')+'</div>'+
      '<div style="display:flex;justify-content:space-between;gap:8px;margin-top:4px">'+
        '<div style="font-size:11px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml(r.jobName)+(r.detail?' · '+escHtml(r.detail):'')+'</div>'+
        '<div style="font-size:11px;color:var(--text3);flex-shrink:0;display:flex;align-items:center;gap:4px">'+(r.source==='auto'?svgIcon('📍',{size:10})+' Auto':svgIcon('▶',{size:10})+' Manual')+' · '+escHtml(_tlDateLabel(r.date))+'</div>'+
      '</div>'+
    '</div>'
  ).join('');
}
function _tlDateLabel(dateStr){
  if(!dateStr)return'';
  try{return parseD(dateStr).toLocaleDateString('en-US',{month:'short',day:'numeric'});}
  catch(_e){return dateStr;}
}
