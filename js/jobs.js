// ── Active time tracking ─────────────────────────────────────────────────────

function getJobScopes(jobId){
  const j=jobs.find(x=>x.id===jobId);
  const bid=j&&j.bid_id?bids.find(b=>b.id===j.bid_id):null;
  let base=[];
  if(bid&&bid.roomScopeMap){
    const activeIds=new Set();
    Object.values(bid.roomScopeMap).forEach(room=>Object.entries(room).forEach(([sid,sv])=>{if(sv&&sv.active)activeIds.add(sid);}));
    base=SCOPE_ITEMS.filter(s=>activeIds.has(s.id));
  }
  if(!base.length)base=SCOPE_ITEMS.filter(s=>_CLOCK_DEFAULT_SCOPES.includes(s.id));
  if(j?.extraScopes?.length){
    const baseIds=new Set(base.map(s=>s.id));
    j.extraScopes.forEach(es=>{
      if(typeof es==='string'){const found=SCOPE_ITEMS.find(x=>x.id===es);if(found&&!baseIds.has(found.id)){base.push(found);baseIds.add(found.id);}}
      else if(es?.id&&!baseIds.has(es.id)){base.push(es);baseIds.add(es.id);}
    });
  }
  return base;
}

function getJobScopeBreakdown(jobId){
  const out={};
  timeEntries.filter(e=>e.job_id===jobId).forEach(e=>{
    if(e.scope_id){out[e.scope_id]=(out[e.scope_id]||0)+(e.minutes||0);}
    else{out['__other']=(out['__other']||0)+(e.minutes||0);}
  });
  return out;
}

function getJobClockTotal(jobId){
  return timeEntries.filter(e=>e.job_id===jobId).reduce((s,e)=>s+(e.minutes||0),0);
}

function _fmtMin(m){
  const h=Math.floor(m/60),rem=m%60;
  return (h?h+'h ':'')+(rem?rem+'m':'');
}

// Owner correction 2026-07-11: hiding Clock in when there's no job was
// backwards: you'd still want to clock in because you're physically on
// site, job record or not. The real bug was that tapping it with nothing to
// clock into dead-ended on the client profile page instead of doing
// anything. Fix: always offer Clock in; if there's no existing job target,
// create a minimal walk-up job for this client (same shape schedule.js/
// proposals.js already use for ad-hoc jobs) and clock into that, no new
// data model, just reuses the existing job-scoped time-tracking machinery.
function _nearbyClockIn(clientId,jobId){
  if(!jobId){
    const c=getClientById(clientId);if(!c)return;
    const j={id:Date.now(),bid_id:null,client_id:clientId,name:c.name,addr:c.addr||'',start:todayKey(),days:1,buffer:0,value:0,color:'#6366F1',eventType:'job',allowWeekend:true,time:null,hours:null,notes:'',status:'upcoming'};
    jobs.push(j);
    saveAll();
    jobId=j.id;
  }
  openClockInSheet(jobId);
}
function openClockInSheet(jobId){
  const j=jobs.find(x=>x.id===jobId);if(!j)return;
  const bid=j.bid_id?bids.find(b=>b.id===j.bid_id):null;
  const c=bid?getClientById(bid.client_id):getClientById(j.client_id);
  const clientName=c?c.name:j.name;
  document.getElementById('_cks-ov')?.remove();
  const ov=document.createElement('div');
  ov.id='_cks-ov';ov.className='zmodal-overlay';
  ov.style.cssText='align-items:center;padding:20px';
  const sheet=document.createElement('div');
  sheet.id='_cks-sheet';
  sheet.style.cssText='background:var(--bg);border-radius:16px;width:100%;max-width:440px;max-height:82vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,.35)';
  ov.appendChild(sheet);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  window._cksRebuild=function(){
    const scopes=getJobScopes(jobId);
    const bd=getJobScopeBreakdown(jobId);
    let rows='';
    for(const s of scopes){
      const logged=bd[s.id]||0;
      const isCurrent=_activeTimer&&_activeTimer.jobId===jobId&&_activeTimer.scopeId===s.id;
      const done=logged>0&&!isCurrent;
      const bg=isCurrent?'background:rgba(233,123,0,.1);':'';
      const bl=isCurrent?'border-left:3px solid #E97B00;':'border-left:3px solid transparent;';
      const dot=isCurrent
        ?'<span style="width:8px;height:8px;border-radius:50%;background:#E97B00;flex-shrink:0;display:inline-block"></span>'
        :done?'<span style="font-size:12px;color:var(--green);flex-shrink:0;font-weight:800">✓</span>'
        :'<span style="width:8px;height:8px;border-radius:50%;background:var(--border2);flex-shrink:0;display:inline-block"></span>';
      const sid=s.id.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      const slabel=s.label.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      rows+='<button onclick="clockIn('+jobId+',\''+sid+'\',\''+slabel+'\');setTimeout(()=>window._cksRebuild&&window._cksRebuild(),80)" '+
        'style="display:flex;align-items:center;gap:10px;width:100%;padding:12px 16px;border:none;border-bottom:1px solid var(--border);'+bg+bl+' text-align:left;font-family:inherit;cursor:pointer;font-size:14px;color:var(--text)">'+
        dot+
        '<span style="font-size:18px;flex-shrink:0">'+svgIcon(s.icon,{size:18})+'</span>'+
        '<span style="font-weight:600;flex:1">'+escHtml(s.label)+'</span>'+
        (logged>0?'<span style="font-size:11px;color:var(--text3)">'+_fmtMin(logged)+'</span>':'')+
      '</button>';
    }
    rows+='<button onclick="_clockAddTask('+jobId+')" '+
      'style="display:flex;align-items:center;gap:10px;width:100%;padding:11px 16px;border:none;background:none;border-bottom:1px solid var(--border);text-align:left;font-family:inherit;cursor:pointer;font-size:13px;color:var(--text3)">'+
      '<span style="font-size:16px">'+svgIcon('➕',{size:16})+'</span><span>Add task not in estimate…</span>'+
    '</button>';
    const el=document.getElementById('_cks-sheet');if(!el)return;
    el.innerHTML=
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:16px 16px 12px;border-bottom:1px solid var(--border)">'+
        '<div>'+
          '<div style="font-size:16px;font-weight:800">Select task</div>'+
          '<div style="font-size:12px;color:var(--text3);margin-top:1px">'+escHtml(clientName)+' · '+escHtml(j.name)+'</div>'+
        '</div>'+
        '<button onclick="document.getElementById(\'_cks-ov\')?.remove()" style="background:var(--bg2);border:none;color:var(--text2);font-size:18px;cursor:pointer;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-family:inherit">✕</button>'+
      '</div>'+
      rows+
      '<div style="padding:12px 16px;display:flex;flex-direction:column;gap:8px">'+
        (bid&&getBidBalance(bid)>0.01
          ?'<button onclick="openPayPanel('+bid.id+')" style="width:100%;padding:13px;border-radius:var(--r);border:none;background:var(--green);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">'+svgIcon('💰')+' Collect '+fmt(getBidBalance(bid))+'</button>'
          :'')+
        '<button onclick="_markJobComplete('+jobId+')" style="width:100%;padding:13px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;color:var(--text)">'+svgIcon('🏁')+' Mark job complete</button>'+
      '</div>';
  };
  window._cksRebuild();
}

function _clockAddTask(jobId){
  const existingIds=new Set(getJobScopes(jobId).map(s=>s.id));
  const available=SCOPE_ITEMS.filter(s=>!existingIds.has(s.id));
  const ov2=document.createElement('div');
  ov2.className='zmodal-overlay';ov2.style.cssText='align-items:center;padding:20px;z-index:10001';
  const box=document.createElement('div');
  box.style.cssText='background:var(--bg);border-radius:16px;width:100%;max-width:400px;max-height:72vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,.35)';
  const scopeRows=available.map(s=>{
    const sl=s.label.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    return '<button onclick="_clockAddTaskConfirm('+jobId+',\''+s.id+'\',\''+sl+'\');this.closest(\'.zmodal-overlay\').remove()" '+
      'style="display:flex;align-items:center;gap:10px;width:100%;padding:12px 16px;border:none;background:none;border-bottom:1px solid var(--border);text-align:left;font-family:inherit;cursor:pointer;font-size:14px;color:var(--text)">'+
      '<span style="font-size:18px">'+svgIcon(s.icon,{size:18})+'</span><span style="font-weight:600">'+escHtml(s.label)+'</span>'+
    '</button>';
  }).join('');
  box.innerHTML=
    '<div style="display:flex;justify-content:space-between;align-items:center;padding:16px 16px 12px;border-bottom:1px solid var(--border)">'+
      '<div style="font-size:15px;font-weight:800">Add task</div>'+
      '<button onclick="this.closest(\'.zmodal-overlay\').remove()" style="background:var(--bg2);border:none;color:var(--text2);font-size:18px;cursor:pointer;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-family:inherit">✕</button>'+
    '</div>'+
    (scopeRows||'<div style="padding:16px;font-size:13px;color:var(--text3)">All standard tasks already added.</div>')+
    '<div style="padding:12px 16px;border-top:1px solid var(--border)">'+
      '<div style="font-size:12px;color:var(--text3);margin-bottom:8px">Or enter a custom task:</div>'+
      '<div style="display:flex;gap:8px">'+
        '<input id="_ck-custom" placeholder="e.g. Touch-up, Accent wall…" style="flex:1;padding:10px 12px;border:1px solid var(--border2);border-radius:var(--r);background:var(--bg2);color:var(--text);font-size:13px;font-family:inherit;outline:none">'+
        '<button onclick="var v=document.getElementById(\'_ck-custom\').value.trim();if(v){_clockAddTaskConfirm('+jobId+',null,v);this.closest(\'.zmodal-overlay\').remove();}" style="padding:10px 14px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">Add</button>'+
      '</div>'+
    '</div>';
  ov2.appendChild(box);document.body.appendChild(ov2);
  ov2.addEventListener('click',e=>{if(e.target===ov2)ov2.remove();});
  setTimeout(()=>document.getElementById('_ck-custom')?.focus(),100);
}

function _clockAddTaskConfirm(jobId,scopeId,scopeLabel){
  const j=jobs.find(x=>x.id===jobId);if(!j)return;
  if(!j.extraScopes)j.extraScopes=[];
  let finalId=scopeId;
  if(!scopeId){
    finalId='custom_'+Date.now();
    j.extraScopes.push({id:finalId,label:scopeLabel,icon:'🔧',hint:'',ratePerSqFt:0,flatRate:0,clientDesc:scopeLabel});
  } else if(!j.extraScopes.find(e=>e===scopeId||e?.id===scopeId)){
    j.extraScopes.push(scopeId);
  }
  saveAll();
  setTimeout(()=>{clockIn(jobId,finalId,scopeLabel);window._cksRebuild&&window._cksRebuild();},60);
}

function _markJobComplete(jobId){
  zConfirm('Clock out the current task and mark this job as complete?',()=>{
    if(_activeTimer&&_activeTimer.jobId===jobId)clockOut(true,true);
    const j=jobs.find(x=>x.id===jobId);
    if(j){j.status='done';j.completion_date=todayKey();saveAll();}
    document.getElementById('_cks-ov')?.remove();
    showToast('Job marked complete 🏁','✅');
    renderJobsPage&&renderJobsPage();
    renderDash&&setTimeout(renderDash,200);
  },{title:'Complete job',yes:'Mark complete',danger:false});
}

// Tags WHO is clocking in/editing: previously untracked, so a shared account's
// manual clock entries were indistinguishable between the owner and any crew
// member. null loggedByUid means the owner (their own account has no separate
// employee-user id); an employee's own auth id otherwise. Feeds the Time Log.
function _tlLoggedByInfo(){
  const loggedByUid=(typeof _isEmployee!=='undefined'&&_isEmployee&&typeof _supaUser!=='undefined'&&_supaUser)?_supaUser.id:null;
  const loggedByName=loggedByUid?(_employeeRecord?.name||'Crew'):((typeof getOwnerName==='function'&&getOwnerName())||(typeof S!=='undefined'&&S.ownerName)||'Owner (me)');
  return{loggedByUid,loggedByName};
}
function _isMyTimeEntry(e){
  const{loggedByUid}=_tlLoggedByInfo();
  return(e.logged_by_uid||null)===loggedByUid;
}

function clockIn(jobId,scopeId,scopeLabel){
  const j=jobs.find(x=>x.id===jobId);if(!j)return;
  if(_activeTimer){
    if(_activeTimer.jobId===jobId&&_activeTimer.scopeId===(scopeId||null)){
      showToast('Already tracking '+(scopeLabel||'this task'),'⏱');return;
    }
    // Switching task on same job: save silently, no confirm needed
    if(_activeTimer.jobId===jobId){
      clockOut(true,true);
    } else {
      // Different job: ask first
      zConfirm('You\'re clocked in to '+_activeTimer.jobName+'. Save that time and switch?',()=>{
        clockOut(true,true);setTimeout(()=>clockIn(jobId,scopeId,scopeLabel),100);
      },{title:'Switch job',yes:'Save & switch',danger:false});
      return;
    }
  }
  const bid=j.bid_id?bids.find(b=>b.id===j.bid_id):null;
  const c=bid?getClientById(bid.client_id):getClientById(j.client_id);
  // Owner request 2026-07-11 ("bulletproof"): persist the entry the INSTANT the
  // clock starts, not only when it stops. Before this, clockOut() was the only
  // place a timeEntries row was ever created, a crashed tab, a dead phone, or
  // just forgetting to clock out meant the ENTIRE session was never saved
  // anywhere, silently. Now an "open" row (end_time/minutes null) is written and
  // synced immediately; clockOut() finds and closes this same row instead of
  // creating a new one. This open row is also what makes force-clock-out and
  // reload-survival possible, it's the one source of truth for "is anyone
  // still clocked in," visible to every device, not just the one that's running.
  const{loggedByUid,loggedByName}=_tlLoggedByInfo();
  const entryId=Date.now();
  timeEntries.push({id:entryId,job_id:jobId,date:todayKey(),start_time:new Date().toISOString(),end_time:null,minutes:null,scope_id:scopeId||null,scope_label:scopeLabel||null,logged_by_uid:loggedByUid,logged_by_name:loggedByName,open:true});
  saveAll();
  _activeTimer={jobId,jobName:j.name,clientName:c?c.name:j.name,scopeId:scopeId||null,scopeLabel:scopeLabel||null,startTime:Date.now(),timerInterval:null,entryId};
  _activeTimer.timerInterval=setInterval(updateClockTimer,1000);
  showClockBanner();
  renderJobsPage&&renderJobsPage();
  showToast('Clocked in · '+(scopeLabel||j.name),'⏱');
}

function clockOut(saveEntry,silent){
  if(!_activeTimer)return;
  clearInterval(_activeTimer.timerInterval);
  const minutes=Math.max(1,Math.round((Date.now()-_activeTimer.startTime)/60000));
  const jobId=_activeTimer.jobId;
  const jobName=_activeTimer.jobName;
  const scopeLabel=_activeTimer.scopeLabel;
  const openEntry=_activeTimer.entryId!=null?timeEntries.find(e=>e.id===_activeTimer.entryId):null;
  if(saveEntry!==false){
    if(openEntry){
      openEntry.end_time=new Date().toISOString();openEntry.minutes=minutes;openEntry.open=false;
    }else{
      // Defensive fallback only, the open row should always exist (written by
      // clockIn above). Never silently drop real logged time if it's somehow
      // missing (deleted mid-timer, or a session from before this fix).
      const{loggedByUid,loggedByName}=_tlLoggedByInfo();
      timeEntries.push({id:Date.now(),job_id:jobId,date:todayKey(),start_time:new Date(_activeTimer.startTime).toISOString(),end_time:new Date().toISOString(),minutes,scope_id:_activeTimer.scopeId,scope_label:scopeLabel,logged_by_uid:loggedByUid,logged_by_name:loggedByName,open:false});
    }
    const j=jobs.find(x=>x.id===jobId);
    if(j)j.actualHours=Math.round(((j.actualHours||0)+minutes/60)*10)/10;
    saveAll();
    if(!silent){
      const label=scopeLabel?scopeLabel+', '+jobName:jobName;
      showToast(_fmtMin(minutes)+' logged · '+label,'⏱');
    }
  }else if(openEntry){
    // Explicit discard (saveEntry===false): the open row must not be left
    // stranded open forever just because this session chose not to keep it.
    timeEntries=timeEntries.filter(e=>e.id!==openEntry.id);
    saveAll();
  }
  _activeTimer=null;
  hideClockBanner();
  renderJobsPage&&renderJobsPage();
  renderDash&&setTimeout(renderDash,300);
}

// On boot, an open entry (clocked in, never closed) belonging to THIS person on
// THIS account means either: (a) this device reloaded mid-timer, _activeTimer
// (a `let`, not persisted) doesn't survive a reload, but the open row does, so
// this reconnects the live banner/interval to it; or (b) another device force-
// closed it while this one was away, in which case there's no longer a
// matching open row and nothing to rehydrate. Either way the data was never at
// risk; this only restores the LIVE UI state.
function _rehydrateActiveTimer(){
  if(_activeTimer||!timeEntries||!timeEntries.length)return;
  const{loggedByUid}=_tlLoggedByInfo();
  const mine=timeEntries.find(e=>e.open&&(e.logged_by_uid||null)===loggedByUid);
  if(!mine)return;
  const j=jobs.find(x=>x.id===mine.job_id);if(!j)return;
  const bid=j.bid_id?bids.find(b=>b.id===j.bid_id):null;
  const c=bid?getClientById(bid.client_id):getClientById(j.client_id);
  _activeTimer={jobId:j.id,jobName:j.name,clientName:c?c.name:j.name,scopeId:mine.scope_id||null,scopeLabel:mine.scope_label||null,startTime:new Date(mine.start_time).getTime(),timerInterval:null,entryId:mine.id};
  _activeTimer.timerInterval=setInterval(updateClockTimer,1000);
  showClockBanner();
}

// Owner request 2026-07-11 ("bulletproof", matches Jobber's #1 timesheet
// complaint, "admin can't force-stop a forgotten clock"): a manager can close
// someone else's still-open entry from Time Log. Marks who force-closed it,
// never silently rewrite whose clock this was.
function forceClockOutEntry(entryId){
  if(typeof _canViewComp==='function'&&!_canViewComp())return;
  const e=timeEntries.find(x=>x.id===entryId&&x.open);if(!e)return;
  const minutes=Math.max(1,Math.round((Date.now()-new Date(e.start_time).getTime())/60000));
  e.end_time=new Date().toISOString();e.minutes=minutes;e.open=false;
  const{loggedByUid,loggedByName}=_tlLoggedByInfo();
  e.force_closed_by_uid=loggedByUid;e.force_closed_by_name=loggedByName;
  const j=jobs.find(x=>x.id===e.job_id);
  if(j)j.actualHours=Math.round(((j.actualHours||0)+minutes/60)*10)/10;
  saveAll();
  showToast('Clocked out · '+_fmtMin(minutes),'⏱');
  typeof renderTimeLog==='function'&&renderTimeLog();
}

// Owner request 2026-07-11 ("bulletproof", matches Jobber's other top
// complaint, "totals don't add up and I can't fix them"). Manual entries only
//, GPS-verified auto entries aren't user-editable once §9.5 ships, same as
// every competitor researched. Own entries always editable; others' only with
// the payroll permission (same gate as Job Profit/Crew Cost).
function deleteTimeEntry(entryId){
  const e=timeEntries.find(x=>x.id===entryId);if(!e)return;
  if(!_isMyTimeEntry(e)&&!(typeof _canViewComp==='function'&&_canViewComp()))return;
  timeEntries=timeEntries.filter(x=>x.id!==entryId);
  saveAll();
  typeof renderTimeLog==='function'&&renderTimeLog();
}
function _openEditTimeEntry(entryId){
  const e=timeEntries.find(x=>x.id===entryId);if(!e)return;
  if(e.open)return; // still running, clock out first, then edit
  if(!_isMyTimeEntry(e)&&!(typeof _canViewComp==='function'&&_canViewComp()))return;
  document.querySelectorAll('.zmodal-overlay').forEach(o=>o.remove());
  const overlay=document.createElement('div');overlay.className='zmodal-overlay';
  const box=document.createElement('div');box.className='zmodal';
  const toLocalInput=iso=>{try{const d=new Date(iso);d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().slice(0,16);}catch(_e){return'';}};
  box.innerHTML='<div style="font-size:17px;font-weight:800;margin-bottom:4px">'+svgIcon('✏',{size:18})+' Edit time entry</div>'+
    '<div style="font-size:13px;color:var(--text3);margin-bottom:14px">'+escHtml(e.logged_by_name||'')+'</div>'+
    '<div class="f" style="margin-bottom:12px"><label style="font-size:11px;font-weight:700;color:var(--text3)">Start</label>'+
      '<input type="datetime-local" id="tle-start" value="'+toLocalInput(e.start_time)+'" style="width:100%;box-sizing:border-box;padding:10px 12px;border:1.5px solid var(--border2);border-radius:var(--r);font-size:14px;font-family:inherit;background:var(--bg2);color:var(--text)"></div>'+
    '<div class="f" style="margin-bottom:16px"><label style="font-size:11px;font-weight:700;color:var(--text3)">End</label>'+
      '<input type="datetime-local" id="tle-end" value="'+toLocalInput(e.end_time)+'" style="width:100%;box-sizing:border-box;padding:10px 12px;border:1.5px solid var(--border2);border-radius:var(--r);font-size:14px;font-family:inherit;background:var(--bg2);color:var(--text)"></div>'+
    '<div id="tle-err" style="display:none;font-size:11px;color:#A32D2D;margin-bottom:10px">End must be after start.</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'+
      '<button onclick="closeTopModal()" style="padding:12px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;color:var(--text)">Cancel</button>'+
      '<button onclick="_saveEditedTimeEntry('+entryId+')" style="padding:12px;border-radius:var(--r);border:none;background:var(--green);color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit">Save</button>'+
    '</div>';
  overlay.appendChild(box);document.body.appendChild(overlay);
  overlay.addEventListener('click',ev=>{if(ev.target===overlay)overlay.remove();});
}
function _saveEditedTimeEntry(entryId){
  const e=timeEntries.find(x=>x.id===entryId);if(!e)return;
  const startEl=document.getElementById('tle-start'),endEl=document.getElementById('tle-end');
  const start=startEl?new Date(startEl.value):null,end=endEl?new Date(endEl.value):null;
  const errEl=document.getElementById('tle-err');
  if(!start||!end||isNaN(start.getTime())||isNaN(end.getTime())||end<=start){
    if(errEl){errEl.textContent='End must be after start.';errEl.style.display='block';}
    return;
  }
  const minutes=Math.max(1,Math.round((end.getTime()-start.getTime())/60000));
  // A single clock session can't legitimately run longer than a day, beyond
  // that is almost certainly a fat-fingered date, not a real shift. Caught
  // here so an edit can never silently produce an "impossible" day total.
  if(minutes>1440){
    if(errEl){errEl.textContent='That\'s over 24 hours for one entry, check the dates.';errEl.style.display='block';}
    return;
  }
  e.start_time=start.toISOString();e.end_time=end.toISOString();
  e.minutes=minutes;
  e.date=dateKey(start);
  const{loggedByUid,loggedByName}=_tlLoggedByInfo();
  e.edited_by_uid=loggedByUid;e.edited_by_name=loggedByName;e.edited_at=new Date().toISOString();
  saveAll();
  document.querySelectorAll('.zmodal-overlay').forEach(o=>o.remove());
  typeof renderTimeLog==='function'&&renderTimeLog();
}

function updateClockTimer(){
  if(!_activeTimer)return;
  const elapsed=Math.floor((Date.now()-_activeTimer.startTime)/1000);
  const h=Math.floor(elapsed/3600);
  const m=Math.floor((elapsed%3600)/60);
  const s=elapsed%60;
  const timeStr=m+':'+(s<10?'0':'')+s;
  const full=(h?h+'h ':'')+timeStr;
  const el=document.getElementById('clock-banner-time');
  if(el)el.textContent=(_activeTimer.scopeLabel?_activeTimer.scopeLabel+' · ':'')+full;
  // Live time-on-site counter on the dashboard on-site card (minute granularity).
  const os=document.getElementById('dash-onsite-time');
  if(os){const hh=Math.floor(elapsed/3600),mm=Math.floor((elapsed%3600)/60);os.textContent=(hh?hh+'h ':'')+mm+'m';}
}

function showClockBanner(){
  const b=document.getElementById('clock-banner');if(!b)return;
  const jn=document.getElementById('clock-banner-job');
  if(jn)jn.textContent=_activeTimer?_activeTimer.clientName:'';
  const bt=document.getElementById('clock-banner-time');
  if(bt)bt.textContent=(_activeTimer&&_activeTimer.scopeLabel?_activeTimer.scopeLabel+' · ':'')+'0:00';
  // Arrival stamp on the always-visible clock banner (manual clock-in now, geofence auto later).
  const ba=document.getElementById('clock-banner-arrived');
  if(ba)ba.textContent=(_activeTimer&&_activeTimer.startTime)?('Arrived '+new Date(_activeTimer.startTime).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}).replace(/\s/g,'').replace('AM','a').replace('PM','p')):'';
  b.style.display='flex';
  if(document.body)document.body.classList.add('clock-active');
}

function hideClockBanner(){
  const b=document.getElementById('clock-banner');if(b)b.style.display='none';
  if(document.body)document.body.classList.remove('clock-active');
}

function nextClockTask(){
  if(!_activeTimer)return;
  const jobId=_activeTimer.jobId;
  clockOut(true,true);
  setTimeout(()=>openClockInSheet(jobId),80);
}

function doneForDay(){
  if(!_activeTimer)return;
  const jobId=_activeTimer.jobId;
  const jobName=_activeTimer.jobName;
  clockOut(true,false);
  // Show today's task summary for this job
  setTimeout(()=>{
    const todayEntries=timeEntries.filter(e=>e.job_id===jobId&&e.date===todayKey());
    const totalMin=todayEntries.reduce((s,e)=>s+(e.minutes||0),0);
    if(!todayEntries.length)return;
    const rows=todayEntries.map(e=>{
      const sc=SCOPE_ITEMS.find(x=>x.id===e.scope_id)||{icon:'⏱',label:e.scope_label||'Other'};
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">'+
        '<div style="font-size:13px"><span style="margin-right:6px">'+svgIcon(sc.icon)+'</span>'+escHtml(sc.label||'')+'</div>'+
        '<div style="font-size:13px;font-weight:700;color:var(--text2)">'+_fmtMin(e.minutes)+'</div></div>';
    }).join('');
    const ov=document.createElement('div');ov.className='zmodal-overlay';
    const box=document.createElement('div');box.className='zmodal';
    box.style.cssText='border-radius:14px;max-width:560px;width:100%;';
    box.innerHTML=
      '<div style="font-size:17px;font-weight:800;margin-bottom:2px">Day wrapped up 🎉</div>'+
      '<div style="font-size:12px;color:var(--text3);margin-bottom:16px">'+jobName+' · '+_fmtMin(totalMin)+' total today</div>'+
      rows+
      '<button onclick="this.closest(\'.zmodal-overlay\').remove()" style="margin-top:16px;width:100%;padding:14px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit">Done</button>';
    ov.appendChild(box);document.body.appendChild(ov);
    ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  },150);
}

// ── Nearby detection (home-page smart clock-in / collect / diagnostic) ───────
// Any client with an address is a candidate, not just ones with a scheduled
// job. Owner request 2026-07-11: always surface all 3 possible actions,
// Clock in, Start Estimate/Invoice, Collect, not just the single highest-
// priority one. Start Estimate/Invoice needs nothing but a client, so it's
// always available. Clock in targets today's active job if there is one,
// else falls back to the client's nearest open (non-done) job so manual
// clock-in stays available before automatic geo clock-in/out ships (§9.5).
// Collect targets the most recent Closed Won bid with a balance owed.
let _nearbyJob=null;
function _haversineKm(lat1,lon1,lat2,lon2){
  const R=6371,dLat=(lat2-lat1)*Math.PI/180,dLon=(lon2-lon1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function _geocodeAddr(addr){
  return fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q='+encodeURIComponent(addr),{headers:{'User-Agent':'TradeDesk/1.0'}})
    .then(r=>r.json()).then(d=>d[0]?{lat:parseFloat(d[0].lat),lon:parseFloat(d[0].lon)}:null).catch(()=>null);
}
// Nominatim's free tier caps lookups at ~1/sec, so every client's geocoded
// coords are cached, keyed by client id, in a dedicated localStorage blob,
// NEVER re-geocoded unless the address text changes. Deliberately NOT stored
// on the client record / pushed through saveAll(): this is a disposable,
// device-local optimization, not app data, routing it through the full
// account-sync engine would fire a cloud round-trip on every newly-seen
// address from a background heartbeat, for zero benefit (worst case on a
// cache miss is just one extra geocode later). Brand-new/uncached addresses
// are throttled to a small budget per call, spaced 1.1s apart, so a large
// client book backfills over several boots/foreground-resumes instead of
// bursting the API in one shot. Already-cached clients cost nothing and are
// always checked, every call.
const _NEARBY_GEOCODE_BUDGET=8;
function _nearbyGeoCache(){try{return JSON.parse(localStorage.getItem('zp3_nearby_geo')||'{}');}catch(_e){return{};}}
function _saveNearbyGeoCache(cache){try{localStorage.setItem('zp3_nearby_geo',JSON.stringify(cache));}catch(_e){}}
function _nearbyResolveClient(c,myLat,myLon,tk){
  const addrShort=c.addr.split(',')[0];
  const bid=bids.filter(b=>b.client_id===c.id&&b.status==='Closed Won').sort((a,b2)=>(b2.bid_date||'').localeCompare(a.bid_date||''))[0];
  let jobId=null,fallbackJobId=null,bidId=null,balance=0;
  if(bid){
    const st=getBidStage(bid);
    const activeJob=(st.jobs||[]).find(j=>{const d=parseInt(j.days)||1;for(let i=0;i<d;i++)if(addDays(j.start,i)===tk)return true;return false;});
    if(activeJob)jobId=activeJob.id;
    else{
      const nearestJob=(st.jobs||[]).slice().sort((a,b2)=>String(a.start).localeCompare(String(b2.start)))[0];
      if(nearestJob)fallbackJobId=nearestJob.id;
    }
    const bal=getBidBalance(bid);
    if(bid.completion_date&&bal>0.01){bidId=bid.id;balance=bal;}
  }
  return{clientId:c.id,clientName:c.name,addr:addrShort,jobId,fallbackJobId,bidId,balance};
}
async function checkNearbyJob(){
  if(!navigator.geolocation||!_supaUser)return;
  // `return` (not a bare call) so a caller that DOES await this, tests, mainly;
  // production fires it and moves on, resolves only once the async callback
  // below has actually run, not the instant geoIfGranted's sync half returns.
  return geoIfGranted(async pos=>{
    const{latitude:myLat,longitude:myLon}=pos.coords;
    const tk=todayKey();
    const geoCache=_nearbyGeoCache();
    // Root cause of the old 5s+ banner delay: a single loop interleaved cached
    // (instant) and uncached (network geocode + 1.1s throttle sleep) clients in
    // raw array order, so ANY uncached client positioned before the real match
    // forced a live geocode round-trip before the next candidate was even
    // checked. Cached clients are the common case (same client book every day)
    // and cost nothing, check ALL of them first, with zero network/delay, before
    // ever touching the throttled uncached path.
    const uncached=[];
    for(const c of clients){
      if(!c.addr)continue;
      const cached=geoCache[c.id];
      if(cached&&cached.addr===c.addr){
        if(_haversineKm(myLat,myLon,cached.lat,cached.lon)<0.5){
          _nearbyJob=_nearbyResolveClient(c,myLat,myLon,tk);
          renderDash&&renderDash();
          return;
        }
      }else{
        uncached.push(c);
      }
    }
    // No cached client is nearby, fall back to throttled geocoding of the rest.
    // Still respects Nominatim's ~1 req/sec limit, but this path only runs (and
    // only costs real seconds) the first time a client's address is seen, not
    // on every dashboard load once the cache is warm.
    let geocodeBudget=_NEARBY_GEOCODE_BUDGET,cacheDirty=false;
    for(const c of uncached){
      if(geocodeBudget<=0)break;
      geocodeBudget--;
      const coords=await _geocodeAddr(c.addr);
      if(coords){geoCache[c.id]={lat:coords.lat,lon:coords.lon,addr:c.addr};cacheDirty=true;}
      if(coords&&_haversineKm(myLat,myLon,coords.lat,coords.lon)<0.5){
        if(cacheDirty)_saveNearbyGeoCache(geoCache);
        _nearbyJob=_nearbyResolveClient(c,myLat,myLon,tk);
        renderDash&&renderDash();
        return;
      }
      if(geocodeBudget>0)await new Promise(r=>setTimeout(r,1100)); // stay under Nominatim's ~1 req/sec
    }
    if(cacheDirty)_saveNearbyGeoCache(geoCache);
    if(_nearbyJob){_nearbyJob=null;renderDash&&renderDash();}
  },()=>{},{maximumAge:60000,timeout:8000});
}

function sendReminderSMS(cid){
  const c=getClientById(cid);if(!c||!c.phone)return zAlert('No phone number on file for this client.');
  const est=getClientJobs(cid).find(j=>j.eventType==='estimate'&&j.start>=todayKey()&&j.status!=='canceled');
  const timeStr=est&&est.time?est.time:'today';
  const firstName=c.name.split(' ')[0];
  const bname=S.bname||'TradeDesk';
  const bphone=S.bphone||'';
  const msg='Hi '+firstName+'! This is '+bname+' reminding you of your painting proposal '+timeStr+'. Looking forward to seeing you. See you soon! '+(bphone?'- '+bphone:'');
  const phone=c.phone.replace(/\D/g,'');
  window.location.href='sms:'+phone+'&body='+encodeURIComponent(msg);
}

function renderTodayLegs(){
  const el=document.getElementById('cd-today-legs');if(!el)return;
  const tk=todayKey();
  const todayMiles=getClientMileage(currentClientId).filter(m=>m.date===tk);
  if(!todayMiles.length){el.innerHTML='';return;}
  const total=todayMiles.reduce((s,m)=>s+(m.miles||0),0);
  el.innerHTML='<div style="background:var(--green-lt);border-radius:var(--r);padding:8px 12px;font-size:12px;color:var(--green-mid);display:flex;justify-content:space-between;align-items:center">'+
    '<span><strong>Today: '+todayMiles.length+' leg'+(todayMiles.length>1?'s':'')+' · '+total.toFixed(1)+' mi</strong></span>'+
    '<span style="color:var(--green)">'+fmt(total*IRS())+' deduction</span>'+
  '</div>';
}

// ── More menu toggle ──────────────────────────────────────────────────────
// ── Leads page ────────────────────────────────────────────────────────────
let leadFilter='all';
function setLeadFilter(f,btn){
  leadFilter=f;
  document.querySelectorAll('[id^=lft-]').forEach(b=>b.classList.remove('active'));
  const ab=btn||document.getElementById('lft-'+f);if(ab)ab.classList.add('active');
  renderLeadsPage();
}
function setJobFilter(f,btn){
  jobFilter=f;
  document.querySelectorAll('[id^=jft-]').forEach(b=>b.classList.remove('active'));
  const ab=btn||document.getElementById('jft-'+f);if(ab)ab.classList.add('active');
  renderJobsPage();
}
// Compute stage for a single won bid (bid-centric, for Jobs page)
function getBidStage(b){
  if(!b)return{stage:'signed',label:'Not started',color:'var(--blue)',priority:3,jobs:[]};
  const tk=todayKey();
  // Find jobs linked directly to this bid; fall back to unlinked client jobs (legacy data)
  let bidJobs=jobs.filter(j=>j.bid_id===b.id&&j.eventType!=='estimate'&&j.status!=='canceled'&&j.status!=='done');
  if(!bidJobs.length)bidJobs=jobs.filter(j=>j.client_id===b.client_id&&!j.bid_id&&j.eventType!=='estimate'&&j.status!=='canceled'&&j.status!=='done');
  const activeJob=bidJobs.find(j=>{const d=parseInt(j.days)||1;for(let i=0;i<d;i++)if(addDays(j.start,i)===tk)return true;return false;});
  if(activeJob)return{stage:'active',label:'Active job today',color:'var(--green-mid)',priority:1,jobs:bidJobs};
  const balance=getBidBalance(b);
  if(b.completion_date&&balance>0.01)return{stage:'balance_due',label:'Balance due',color:'#A32D2D',priority:2,jobs:bidJobs};
  const scheduled=bidJobs.filter(j=>j.start>=tk).sort((a,x)=>a.start.localeCompare(x.start))[0];
  if(scheduled)return{stage:'scheduled',label:'Job scheduled',color:'#185FA5',priority:4,jobs:bidJobs};
  if(balance<=0.01&&b.completion_date)return{stage:'paid',label:'Paid in full',color:'var(--green)',priority:8,jobs:bidJobs};
  return{stage:'signed',label:'Signed: schedule job',color:'var(--blue)',priority:3,jobs:bidJobs};
}

function renderJobsPage(){
  const el=document.getElementById('jobs-list');if(!el)return;
  const tk=todayKey();
  const wonBidsList=bids.filter(b=>b.status==='Closed Won');

  // Update nav badge
  const badge=document.getElementById('nb-jobs-badge');
  if(badge){
    const n=wonBidsList.filter(b=>['active','scheduled','signed'].includes(getBidStage(b).stage)).length;
    badge.textContent=n||'';badge.style.display=n?'':'none';
  }

  // Update tbar eyebrow
  const jobsEyebrow=document.getElementById('jobs-tbar-eyebrow');
  if(jobsEyebrow){
    const activeN=wonBidsList.filter(b=>getBidStage(b).stage==='active').length;
    const totalOpen=wonBidsList.filter(b=>['active','signed','scheduled','balance_due'].includes(getBidStage(b).stage)).length;
    jobsEyebrow.textContent=totalOpen+' open · '+activeN+' active today';
  }

  // Board view = kanban; filtered views = list
  if(jobFilter==='all'){
    _renderJobsKanban(el,tk,wonBidsList);
    return;
  }

  const filterToStages={
    scheduled:['scheduled','signed'],
    active:['active'],
    completed:['paid','balance_due']
  };
  const allowed=filterToStages[jobFilter]||['active','signed','scheduled','balance_due','paid'];
  const filtered=wonBidsList.filter(b=>allowed.includes(getBidStage(b).stage))
    .sort((a,b2)=>{
      const stA=getBidStage(a),stB=getBidStage(b2);
      const jA=stA.jobs.filter(j=>j.start>=tk).sort((x,y)=>x.start.localeCompare(y.start))[0];
      const jB=stB.jobs.filter(j=>j.start>=tk).sort((x,y)=>x.start.localeCompare(y.start))[0];
      if(jA&&jB)return jA.start.localeCompare(jB.start);
      if(jA)return -1;
      if(jB)return 1;
      return (stA.priority||9)-(stB.priority||9);
    });
  if(!filtered.length){el.innerHTML='<div class="empty"><div class="em-emoji">'+svgIcon('📋',{size:44})+'</div><h3>No '+jobFilter+' jobs right now</h3><p><button class="btn btn-p" onclick="goPg(\'pg-schedule\')">Schedule a job</button></p></div>';return;}
  el.innerHTML='<div style="margin-top:4px">'+filtered.map(b=>{
    const c=getClientById(b.client_id)||{name:b.client_name||b.name||'Client',id:b.client_id,phone:'',addr:b.addr||''};
    const st=getBidStage(b);
    const paid=getBidPaid(b.id);
    const balance=getBidBalance(b);
    const nextJob=st.jobs.filter(j=>j.start>=tk).sort((a,x)=>a.start.localeCompare(x.start))[0];
    const propAddr=(b.addr||c.addr||'').split(',')[0];
    const nextStart=nextJob?parseD(nextJob.start).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}):'';
    const nextJobId=nextJob?nextJob.id:null;
    let primaryBtn='';
    if(st.stage==='active'&&nextJobId&&!nextJob.completion_date){
      primaryBtn='<button onclick="markJobDone('+nextJobId+')" class="btn btn-sm btn-g" style="border-radius:20px">✓ Mark done</button>';
    } else if(st.stage==='balance_due'){
      primaryBtn='<button onclick="openPayPanel('+b.id+',\'final\')" class="btn btn-sm btn-r" style="border-radius:20px">Collect '+fmt(balance)+'</button>';
    } else if(paid<=0&&balance>0.01&&st.stage==='scheduled'){
      primaryBtn='<button onclick="openPayPanel('+b.id+',\'deposit\')" class="btn btn-sm btn-d" style="border-radius:20px">Log deposit</button>';
    } else if(st.stage==='signed'){
      primaryBtn='<button onclick="schedFromBid('+b.id+')" class="btn btn-sm btn-d" style="border-radius:20px">Schedule →</button>';
    }
    let clockBtn='';
    if(nextJobId&&!nextJob.completion_date&&(st.stage==='active'||st.stage==='scheduled')){
      const isClockedHere=_activeTimer&&_activeTimer.jobId===nextJobId;
      if(isClockedHere){
        const _el=Math.floor((Date.now()-_activeTimer.startTime)/1000);
        const _h=Math.floor(_el/3600),_m=Math.floor((_el%3600)/60),_s=_el%60;
        const _ts=(_h?_h+'h ':'')+_m+':'+((_s<10?'0':'')+_s);
        clockBtn='<button onclick="clockOut();event.stopPropagation()" class="btn btn-sm" style="border-radius:20px;border-color:#E97B00;background:#FFF3E0;color:#E97B00">'+svgIcon('⏹')+' '+_ts+'</button>';
      }else{
        clockBtn='<button onclick="openClockInSheet('+nextJobId+');event.stopPropagation()" class="btn btn-sm" style="border-radius:20px">'+svgIcon('▶')+' Clock in</button>';
      }
    }
    const hasTasks=b.roomScopeMap&&Object.values(b.roomScopeMap).some(r=>Object.values(r).some(v=>v&&v.active));
    const checklistBtn=hasTasks?'<button onclick="openJobChecklist('+b.id+');event.stopPropagation()" class="btn btn-sm" style="border-radius:20px">'+svgIcon('📋')+' Checklist</button>':'';
    const btnRow=(primaryBtn||clockBtn||checklistBtn)?'<div class="tf-acts">'+(primaryBtn||'')+(clockBtn||'')+(checklistBtn||'')+'</div>':'';
    const amtColor=balance>0.01?'var(--c-red)':paid>0?'var(--c-green)':'var(--text)';
    const amtSub=balance>0.01?'<div style="font-size:10px;font-weight:700;color:var(--c-red);margin-top:1px">'+fmt(balance)+' due</div>':paid>0?'<div style="font-size:10px;font-weight:600;color:var(--c-green);margin-top:1px">Paid ✓</div>':'';
    return '<div class="tf-card" onclick="openJobSheet('+c.id+')" data-lp-id="'+b.id+'" data-lp-type="bid" data-lp-label="'+escHtml(c.name||'job')+'">'+
      '<div class="tf-icon '+(st.stage==='active'?'t-green':st.stage==='balance_due'?'t-red':'t-blue')+'" style="font-size:14px">'+
        (st.stage==='active'?svgIcon('🔨'):st.stage==='balance_due'?svgIcon('💰'):st.stage==='signed'?svgIcon('✍'):svgIcon('📅'))+
      '</div>'+
      '<div class="tf-body">'+
        '<div class="tf-name">'+escHtml(c.name)+'</div>'+
        '<div class="tf-sub" style="color:var(--text3)">'+escHtml(propAddr)+(nextStart?' · '+nextStart:'')+'</div>'+
        btnRow+
      '</div>'+
      '<div style="text-align:right;flex-shrink:0">'+
        '<div style="font-size:14px;font-weight:800;color:'+amtColor+'">'+fmt(b.amount)+'</div>'+
        amtSub+
      '</div>'+
    '</div>';
  }).join('')+'</div>';
}

function _renderJobsKanban(el,tk,wonBidsList){
  const pendingSent=bids.filter(b=>b.status==='Pending'&&b.signingToken);
  const cols=[
    {id:'estimate', label:'Estimate sent',            items:pendingSent},
    {id:'signed',   label:'Signed · ready to sched',  items:wonBidsList.filter(b=>getBidStage(b).stage==='signed')},
    {id:'active',   label:'Active',                    items:wonBidsList.filter(b=>getBidStage(b).stage==='active'||getBidStage(b).stage==='scheduled')},
    {id:'collect',  label:'Collect',                   items:wonBidsList.filter(b=>getBidStage(b).stage==='balance_due')},
    {id:'complete', label:'Complete · paid',            items:wonBidsList.filter(b=>getBidStage(b).stage==='paid').slice(0,8)},
  ];
  el.innerHTML='<div class="kanban">'+cols.map(col=>{
    const _kcollapsed=!!(window._kcolCollapsed&&window._kcolCollapsed[col.id]);
    return '<div class="kcol" data-status="'+col.id+'">'+
      '<div class="kcol-hd" onclick="_toggleKcol(\''+col.id+'\')" style="cursor:pointer;user-select:none">'+
        '<span style="display:flex;align-items:center;min-width:0"><span class="kcol-chev" style="display:inline-block;transition:transform .18s cubic-bezier(.22,1,.36,1);transform:'+(_kcollapsed?'':'rotate(90deg)')+';font-size:9px;color:var(--text3);margin-right:5px">'+svgIcon('▶',{size:9})+'</span><span>'+col.label+'</span></span>'+
        '<span class="k-count">'+col.items.length+'</span></div>'+
      '<div class="kcol-body"'+(_kcollapsed?' style="display:none"':'')+'>'+
      (col.items.length===0
        ?'<div style="padding:18px 8px;text-align:center;color:var(--text3);font-size:11px;font-weight:500">Nothing here yet</div>'
        :col.items.map(b=>{
          const c=getClientById(b.client_id)||{name:b.name||'Client',id:b.client_id,addr:b.addr||''};
          const st=getBidStage(b);
          const nextJob=st.jobs&&st.jobs.filter(j=>j.start>=tk).sort((a,x)=>a.start.localeCompare(x.start))[0];
          const dateStr=nextJob?parseD(nextJob.start).toLocaleDateString('en-US',{month:'short',day:'numeric'}):
                        b.bid_date?parseD(b.bid_date).toLocaleDateString('en-US',{month:'short',day:'numeric'}):'';
          const addrShort=(b.addr||c.addr||'').split(',')[0];
          const balance=b.status==='Closed Won'?getBidBalance(b):0;
          const amt=col.id==='collect'?fmt(balance):fmt(b.amount);
          // Chip: semantic label + CSS badge class per stage
          let chipLabel,chipCls;
          if(col.id==='estimate'){
            chipLabel=dateStr?dateStr+' sent':'Sent';
            chipCls='sf-new';
          }else if(col.id==='signed'){
            chipLabel=dateStr?dateStr:'Ready to schedule';
            chipCls='sf-deposit';
          }else if(col.id==='active'){
            const pct=b.completion_pct!=null?Math.round(b.completion_pct):null;
            chipLabel=pct!=null?pct+'% complete':(dateStr||'Active');
            chipCls='sf-active';
          }else if(col.id==='collect'){
            chipLabel=fmt(balance)+' owed';
            chipCls='sf-overdue';
          }else{
            const paidDate=b.completion_date?parseD(b.completion_date).toLocaleDateString('en-US',{month:'short',day:'numeric'}):'';
            chipLabel=paidDate?paidDate+' paid':'Paid';
            chipCls='sf-won';
          }
          return '<div class="k-card" onclick="openJobSheet('+c.id+')" data-lp-id="'+b.id+'" data-lp-type="bid" data-lp-label="'+escHtml(c.name||'job')+'" style="margin-bottom:8px">'+
            '<div class="k-name">'+escHtml(c.name)+'</div>'+
            '<div class="k-sub">'+escHtml(addrShort)+'</div>'+
            '<div class="k-foot">'+
              '<span class="bdg-soft '+chipCls+'" style="font-size:10px">'+chipLabel+'</span>'+
              '<span class="k-amt">'+amt+'</span>'+
            '</div>'+
          '</div>';
        }).join(''))+
      '</div>'+
    '</div>';
  }).join('')+'</div>';
}
// Collapse/expand a kanban column's bid cards. Cards stay in the DOM (just hidden) so the
// state survives a re-render and nothing that counts cards breaks; persisted per column id.
function _toggleKcol(id){
  window._kcolCollapsed=window._kcolCollapsed||{};
  window._kcolCollapsed[id]=!window._kcolCollapsed[id];
  const col=document.querySelector('.kcol[data-status="'+id+'"]');
  if(!col)return;
  const body=col.querySelector('.kcol-body');
  const chev=col.querySelector('.kcol-chev');
  const collapsed=window._kcolCollapsed[id];
  if(body)body.style.display=collapsed?'none':'';
  if(chev)chev.style.transform=collapsed?'':'rotate(90deg)';
}

function openJobChecklist(bidId){
  const b=bids.find(x=>x.id===bidId);if(!b)return;
  const scope=b.roomScopeMap||{};
  const prog=b.taskProgress||{};
  // Build flat ordered task list: SCOPE_ITEMS order, grouped by room
  const tasks=[];
  const rooms=Object.keys(scope);
  SCOPE_ITEMS.forEach(si=>{
    rooms.forEach(room=>{
      const rv=scope[room]||{};
      if(rv[si.id]&&rv[si.id].active)tasks.push({key:room+'::'+si.id,room,id:si.id,label:si.label,icon:si.icon});
    });
  });
  const done=tasks.filter(t=>prog[t.key]).length;
  const ov=document.createElement('div');
  ov.id='_checklist-ov';
  ov.style.cssText='position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box';
  const sheet=document.createElement('div');
  sheet.style.cssText='background:var(--bg2);border-radius:14px;width:100%;max-width:480px;max-height:85vh;overflow-y:auto;padding:20px 16px 24px';
  const hdr='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'+
    '<div style="font-size:17px;font-weight:800">'+svgIcon('📋')+' Job Checklist</div>'+
    '<button onclick="closeJobChecklist()" style="background:none;border:none;font-size:20px;color:var(--text3);cursor:pointer;padding:4px">✕</button>'+
  '</div>'+
  '<div id="_cl-prog" style="font-size:13px;color:var(--text3);margin-bottom:12px">'+done+' of '+tasks.length+' tasks done</div>'+
  '<div id="_cl-bar" style="height:4px;background:var(--border);border-radius:2px;margin-bottom:16px"><div style="height:100%;border-radius:2px;background:var(--green-mid);width:'+(tasks.length?Math.round(done/tasks.length*100):0)+'%;transition:width .2s"></div></div>';
  const rows=tasks.map(t=>{
    const isDone=!!prog[t.key];
    return '<div onclick="toggleJobTask('+bidId+',\''+t.key+'\')" style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border);cursor:pointer">'+
      '<div style="width:24px;height:24px;border-radius:50%;border:2px solid '+(isDone?'var(--green-mid)':'var(--border2)')+';background:'+(isDone?'var(--green-mid)':'transparent')+';display:flex;align-items:center;justify-content:center;flex-shrink:0">'+
        (isDone?'<svg width="12" height="10" viewBox="0 0 12 10"><polyline points="1,5 4,8 11,1" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/></svg>':'')+
      '</div>'+
      '<div style="flex:1;min-width:0">'+
        '<div style="font-size:14px;font-weight:600;color:var(--text);'+(isDone?'text-decoration:line-through;opacity:.5':'')+'">'+svgIcon(t.icon)+' '+t.label+'</div>'+
        '<div style="font-size:11px;color:var(--text3)">'+t.room+'</div>'+
      '</div>'+
    '</div>';
  }).join('');
  const allDone=tasks.length&&done===tasks.length;
  sheet.innerHTML=hdr+rows+(tasks.length?'':'<div style="text-align:center;padding:24px;color:var(--text3)">No scope items found for this job.</div>')+
    '<button id="_cl-close-btn" onclick="closeJobChecklist()" style="margin-top:16px;width:100%;padding:14px;border-radius:var(--r);border:none;background:'+(allDone?'var(--green-mid)':'var(--bg)')+';color:'+(allDone?'#fff':'var(--text3)')+';font-size:15px;font-weight:700;cursor:pointer;font-family:inherit">'+(allDone?'✓ All done!':'Complete tasks above to finish')+'</button>';
  ov.appendChild(sheet);
  document.body.appendChild(ov);
}
function toggleJobTask(bidId,key){
  const b=bids.find(x=>x.id===bidId);if(!b)return;
  if(!b.taskProgress)b.taskProgress={};
  b.taskProgress[key]=!b.taskProgress[key];
  saveAll();
  // Re-render the checklist sheet in place
  closeJobChecklist();
  openJobChecklist(bidId);
}
function closeJobChecklist(){
  document.getElementById('_checklist-ov')?.remove();
}
function openJobSheet(clientId){
  const c=getClientById(clientId);if(!c)return;
  const tk=todayKey();
  const wonBids=getClientBids(clientId).filter(b=>b.status==='Closed Won').sort((a,b)=>(b.bid_date||'').localeCompare(a.bid_date||''));
  const bid=wonBids[0];
  const allJobs=getClientJobs(clientId).filter(j=>j.eventType!=='estimate'&&j.status!=='canceled');
  const nextJob=allJobs.filter(j=>j.start>=tk).sort((a,b)=>a.start.localeCompare(b.start))[0];
  // Aggregate payment totals across all won bids (for multi-property clients)
  const paid=wonBids.reduce((s,b)=>s+getBidPaid(b.id),0);
  const balance=wonBids.reduce((s,b)=>s+getBidBalance(b),0);
  const total=wonBids.reduce((s,b)=>s+(b.amount||0),0);
  const depositDue=bid?Math.round(bid.amount*.25*100)/100:0;
  const st=getClientStage(clientId);

  const ov=document.createElement('div');ov.className='zmodal-overlay';
  const box=document.createElement('div');
  box.style.cssText='background:var(--bg);border-radius:var(--rl);width:100%;max-width:560px;max-height:92vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 8px 40px rgba(0,0,0,.25)';

  // ── Header ──────────────────────────────────────────────────
  const stageColors={active:'#2d6a4f',signed:'var(--blue-dk)',scheduled:'var(--blue-dk)',balance_due:'#A32D2D',paid:'#2d6a4f'};
  const stageBgs={active:'#D1FAE5',signed:'var(--blue-lt)',scheduled:'var(--blue-lt)',balance_due:'#FEE8E8',paid:'#D1FAE5'};
  const hdrColor=stageColors[st.stage]||'var(--blue-dk)';
  const hdrBg=stageBgs[st.stage]||'var(--blue-lt)';

  const hdr=document.createElement('div');
  hdr.style.cssText='background:linear-gradient(135deg,#1a365d,#2a4a7f);color:#fff;padding:18px 20px 16px;flex-shrink:0';
  hdr.innerHTML=
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:12px">'+
      '<div style="min-width:0">'+
        '<div style="font-size:20px;font-weight:800;line-height:1.15">'+escHtml(c.name||'')+'</div>'+
        (c.addr?'<div style="font-size:12px;opacity:.75;margin-top:4px">'+svgIcon('📍')+' '+escHtml(c.addr)+'</div>':'')+
      '</div>'+
      '<button onclick="this.closest(\'.zmodal-overlay\').remove()" style="background:rgba(255,255,255,.15);border:none;color:#fff;font-size:18px;cursor:pointer;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;flex-shrink:0;line-height:1">✕</button>'+
    '</div>'+
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">'+
      '<span style="font-size:11px;font-weight:800;padding:4px 10px;border-radius:20px;background:rgba(255,255,255,.18);color:#fff;letter-spacing:.02em">'+st.label+'</span>'+
      '<div style="display:flex;gap:6px;flex-wrap:wrap">'+
        (c.phone?'<a href="tel:'+c.phone.replace(/\D/g,'')+'" style="background:rgba(52,211,153,.25);color:#fff;text-decoration:none;font-size:12px;font-weight:700;padding:6px 13px;border-radius:20px;display:inline-flex;align-items:center;gap:4px" onclick="event.stopPropagation()">'+svgIcon('📞')+' Call</a>':'')+
        (c.addr?'<button onclick="openMapsForClient('+clientId+');event.stopPropagation()" style="background:rgba(96,165,250,.25);border:none;color:#fff;font-size:12px;font-weight:700;padding:6px 13px;border-radius:20px;cursor:pointer;font-family:inherit">'+svgIcon('🗺')+' Drive</button>':'')+
        (c.phone?'<button onclick="sendOMWText('+clientId+');event.stopPropagation()" style="background:rgba(251,191,36,.3);border:none;color:#fff;font-size:12px;font-weight:700;padding:6px 13px;border-radius:20px;cursor:pointer;font-family:inherit">'+svgIcon('🚗')+' OMW</button>':'')+
        '<button onclick="this.closest(\'.zmodal-overlay\').remove();openClientDetail('+clientId+')" style="background:rgba(255,255,255,.15);border:none;color:#fff;font-size:12px;font-weight:700;padding:6px 13px;border-radius:20px;cursor:pointer;font-family:inherit">Full record ›</button>'+
      '</div>'+
    '</div>';
  box.appendChild(hdr);

  // ── Scrollable body ─────────────────────────────────────────
  const body=document.createElement('div');
  body.style.cssText='overflow-y:auto;padding:0;flex:1';

  // ── Payment section ─────────────────────────────────────────
  let payHtml='';
  if(bid){
    const pct=total>0?Math.min(100,Math.round(paid/total*100)):0;
    const barColor=pct>=100?'var(--green-mid)':pct>0?'var(--blue)':'var(--border2)';
    payHtml=
      '<div style="padding:16px 20px;border-bottom:1px solid var(--border)">'+
        '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:10px">'+svgIcon('💰')+' Payment</div>'+
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px">'+
          '<div style="background:var(--bg2);border-radius:var(--r);padding:10px;text-align:center">'+
            '<div style="font-size:10px;color:var(--text3);font-weight:600;margin-bottom:3px">Contract</div>'+
            '<div style="font-size:16px;font-weight:800;color:var(--text)">'+fmt(total)+'</div>'+
          '</div>'+
          '<div style="background:'+(paid>0?'var(--green-lt)':'var(--bg2)')+';border-radius:var(--r);padding:10px;text-align:center">'+
            '<div style="font-size:10px;color:var(--text3);font-weight:600;margin-bottom:3px">Received</div>'+
            '<div style="font-size:16px;font-weight:800;color:'+(paid>0?'var(--green-mid)':'var(--text3)')+'">'+fmt(paid)+'</div>'+
          '</div>'+
          '<div style="background:'+(balance>0.01?'#FEE8E8':'var(--green-lt)')+';border-radius:var(--r);padding:10px;text-align:center">'+
            '<div style="font-size:10px;color:var(--text3);font-weight:600;margin-bottom:3px">Balance</div>'+
            '<div style="font-size:16px;font-weight:800;color:'+(balance>0.01?'#A32D2D':'var(--green-mid)')+'">'+fmt(balance)+'</div>'+
          '</div>'+
        '</div>'+
        // Progress bar
        '<div style="background:var(--border2);border-radius:20px;height:6px;overflow:hidden;margin-bottom:10px">'+
          '<div style="width:'+pct+'%;height:100%;background:'+barColor+';border-radius:20px;transition:width .3s"></div>'+
        '</div>'+
        // Action buttons
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'+
          (paid<depositDue&&balance>0.01?
            '<button onclick="this.closest(\'.zmodal-overlay\').remove();openPayPanel('+bid.id+',\'deposit\')" style="padding:11px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">+ Log deposit</button>'
          :balance>0.01?
            '<button onclick="this.closest(\'.zmodal-overlay\').remove();openPayPanel('+bid.id+',\'final\')" style="padding:11px;border-radius:var(--r);border:none;background:var(--green-mid);color:#fff;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">+ Log payment</button>'
          :
            '<div style="padding:11px;background:var(--green-lt);border-radius:var(--r);text-align:center;font-size:13px;font-weight:700;color:var(--green-mid)">✓ Paid in full</div>'
          )+
          '<button onclick="this.closest(\'.zmodal-overlay\').remove();openClientDetail('+clientId+');setTimeout(()=>setCDTab(\'bids\',document.getElementById(\'cdt-bids\')),200)" style="padding:11px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;color:var(--text)">Payment history</button>'+
        '</div>'+
      '</div>';
  }

  // ── Schedule section ────────────────────────────────────────
  let schedHtml='';
  if(nextJob){
    const dt=parseD(nextJob.start).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
    schedHtml=
      '<div style="padding:14px 20px;border-bottom:1px solid var(--border)">'+
        '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:8px">'+svgIcon('📅')+' Schedule</div>'+
        '<div style="background:var(--blue-lt);border-radius:var(--r);padding:10px 14px;display:flex;justify-content:space-between;align-items:center;gap:8px">'+
          '<div>'+
            '<div style="font-size:14px;font-weight:700;color:var(--blue-dk)">'+dt+(nextJob.time?' · '+fmtTime(nextJob.time):'')+'</div>'+
            '<div style="font-size:11px;color:var(--blue);margin-top:2px">'+(nextJob.days||1)+' day'+(nextJob.days!==1?'s':'')+' est.</div>'+
          '</div>'+
          '<div style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end">'+
            '<button onclick="_extendJob('+nextJob.id+',this.closest(\'.zmodal-overlay\'))" style="padding:7px 12px;border-radius:var(--r);border:1px solid var(--green-mid);background:var(--green-lt);color:var(--green-mid);font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">+Days</button>'+
            '<button onclick="openPushBackModal('+nextJob.id+','+clientId+',this.closest(\'.zmodal-overlay\'))" style="padding:7px 12px;border-radius:var(--r);border:1px solid var(--amber);background:var(--amber-lt);color:#92400E;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">Push back</button>'+
            '<button onclick="this.closest(\'.zmodal-overlay\').remove();goPg(\'pg-schedule\')" style="padding:7px 12px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">Reschedule</button>'+
          '</div>'+
        '</div>'+
      '</div>';
  } else if(bid&&st.stage==='signed'){
    schedHtml=
      '<div style="padding:14px 20px;border-bottom:1px solid var(--border)">'+
        '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:8px">'+svgIcon('📅')+' Schedule</div>'+
        '<div style="background:var(--amber-lt);border-radius:var(--r);padding:10px 14px;display:flex;justify-content:space-between;align-items:center">'+
          '<div style="font-size:13px;font-weight:600;color:#856404">Signed: not yet scheduled</div>'+
          '<button onclick="this.closest(\'.zmodal-overlay\').remove();schedFromBid('+bid.id+')" style="padding:7px 12px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">Schedule →</button>'+
        '</div>'+
      '</div>';
  }

  // ── Materials / supply list + scope, one section per won bid ─
  function _buildBidMaterialsHtml(b,showBidLabel){
    if(!b||!b.surfaces||!b.surfaces.length)return'';
    const allSwProds=Object.values(SW_PRODUCTS).flat();
    const _bidScope=b.roomScopeMap||{};
    const _bidCoats=Object.values(_bidScope).some(r=>r.twocoat?.active)?2:1;
    const orderMap={};
    b.surfaces.forEach(s=>{
      if(!s.qty)return;
      const t=SURF_TYPES.find(x=>x.v===s.type);if(!t||t.unit!=='sq ft')return;
      const spec=(s.room||'').indexOf(', ')>-1?(s.room||'').split(', ').slice(1).join(', '):'';
      const key=spec||'Paint';
      if(!orderMap[key])orderMap[key]={sqFt:0,spec,cov:350};
      const _pSqft=(s.type==='walls'||s.type==='ext_walls')?(s.wallSqft||s.qty):s.qty;
      orderMap[key].sqFt+=_pSqft;
      const prodName=spec.split(' · ')[0].trim();
      const prod=allSwProds.find(p=>p.name===prodName);
      if(prod)orderMap[key].cov=prod.cov||350;
    });
    const paintRows=Object.entries(orderMap).map(([key,od])=>{
      const cans=Math.ceil(od.sqFt*_bidCoats/od.cov*1.10);
      const parts=od.spec.split(' · ');
      const prod=parts[0]||'Paint';
      const colorFinish=parts.slice(1).join(' · ')||od.spec;
      const swMatch=od.spec.match(/SW \d+/i);
      const swHex=swMatch&&_swColors?(_swColors.find(cc=>cc.sw.toLowerCase()===swMatch[0].toLowerCase())?.hex||''):'';
      const dot=swHex?'<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:'+swHex+';border:1px solid rgba(0,0,0,.15);margin-right:5px;vertical-align:middle;flex-shrink:0"></span>':'';
      return '<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border2)">'+
        '<div style="min-width:0;flex:1"><div style="font-size:12px;font-weight:700;color:var(--text)">'+prod+'</div>'+
        '<div style="font-size:11px;color:var(--text3)">'+dot+colorFinish+'</div></div>'+
        '<div style="font-size:14px;font-weight:800;color:var(--blue-dk);flex-shrink:0;margin-left:10px">'+cans+' gal</div></div>';
    }).join('');
    const bidLabel=showBidLabel?(b.addr||b.name||b.type||'Bid '+b.bid_date||''):'';
    return '<div style="padding:14px 20px;border-bottom:1px solid var(--border)">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:'+(bidLabel?'4px':'10px')+'">'+
        '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3)">'+svgIcon('📦')+' Materials</div>'+
        '<button onclick="this.closest(\'.zmodal-overlay\').remove();showSupplyList('+b.id+')" style="padding:5px 12px;border-radius:20px;border:none;background:#FFF0E8;color:#854F0B;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit">Full supply list →</button>'+
      '</div>'+
      (bidLabel?'<div style="font-size:11px;color:var(--text3);margin-bottom:8px">'+svgIcon('📍')+' '+escHtml(bidLabel)+'</div>':'')+
      (paintRows||'<div style="font-size:12px;color:var(--text3)">No paint selected yet.</div>')+
    '</div>';
  }
  function _buildBidScopeHtml(b,showBidLabel){
    if(!b||!b.roomScopeMap||!Object.keys(b.roomScopeMap).length)return'';
    const allScope=[];
    Object.entries(b.roomScopeMap).forEach(([room,sc])=>{
      SCOPE_ITEMS.filter(s=>sc[s.id]?.active).forEach(s=>{if(!allScope.find(x=>x.id===s.id))allScope.push(s);});
    });
    if(!allScope.length)return'';
    const bidLabel=showBidLabel?(b.addr||b.name||b.type||''):'';
    return '<div style="padding:14px 20px;border-bottom:1px solid var(--border)">'+
      '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:'+(bidLabel?'4px':'8px')+'">'+svgIcon('🔧')+' Scope of work</div>'+
      (bidLabel?'<div style="font-size:11px;color:var(--text3);margin-bottom:8px">'+svgIcon('📍')+' '+escHtml(bidLabel)+'</div>':'')+
      '<div style="display:flex;flex-wrap:wrap;gap:5px">'+
        allScope.map(s=>'<span style="font-size:11px;background:var(--bg2);border:1px solid var(--border2);border-radius:20px;padding:3px 9px;color:var(--text2)">'+svgIcon(s.icon)+' '+s.label+'</span>').join('')+
      '</div></div>';
  }
  const _multiWon=wonBids.length>1;
  let supplyHtml=wonBids.map(b=>_buildBidMaterialsHtml(b,_multiWon)).join('');
  let scopeHtml=wonBids.map(b=>_buildBidScopeHtml(b,_multiWon)).join('');

  // ── Before / After photos ────────────────────────────────────
  const jobForPhotos=allJobs.sort((a,b)=>(b.start||'').localeCompare(a.start||''))[0];
  const photoJobId=jobForPhotos?jobForPhotos.id:null;
  const existingPhotos=jobForPhotos?(jobForPhotos.photos||[]):[];
  const beforePhotos=existingPhotos.filter(p=>p.type==='before');
  const afterPhotos=existingPhotos.filter(p=>p.type==='after');
  const progressPhotos=existingPhotos.filter(p=>p.type==='progress');
  let photosHtml='';
  if(photoJobId){
    const renderThumb=(p,idx,type)=>'<div style="position:relative;width:80px;height:80px;flex-shrink:0">'+
      '<img src="'+p.data+'" style="width:80px;height:80px;object-fit:cover;border-radius:var(--r);border:2px solid '+(type==='before'?'var(--amber)':type==='after'?'var(--green-mid)':'var(--denim)')+'">'+
      (p.caption?'<div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,.6);color:#fff;font-size:9px;font-weight:700;padding:2px 4px;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-radius:0 0 var(--r) var(--r)">'+escHtml(p.caption)+'</div>':'')+
    '</div>';
    const shareBtn=beforePhotos.length&&afterPhotos.length
      ?'<button onclick="_shareBeforeAfterCard('+clientId+')" style="display:inline-flex;align-items:center;gap:5px;margin-top:10px;padding:8px 14px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;width:100%;justify-content:center">'+svgIcon('📤')+' Share before/after card</button>'
      :'';
    photosHtml=
      '<div style="padding:14px 20px;border-bottom:1px solid var(--border)">'+
        '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:10px">'+svgIcon('📸')+' Job photos</div>'+
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'+
          '<div>'+
            '<div style="font-size:11px;font-weight:700;color:var(--amber);margin-bottom:6px;text-transform:uppercase;letter-spacing:.04em">Before ('+beforePhotos.length+')</div>'+
            '<div style="display:flex;gap:6px;flex-wrap:wrap;min-height:40px">'+
              beforePhotos.map((p,i)=>renderThumb(p,i,'before')).join('')+
            '</div>'+
            '<label style="display:inline-flex;align-items:center;gap:5px;margin-top:6px;padding:7px 12px;border-radius:var(--r);border:1px dashed var(--amber);color:var(--amber);font-size:11px;font-weight:700;cursor:pointer;background:var(--amber-lt)">'+
              '<input type="file" accept="image/*" capture="environment" onchange="addJobPhoto('+photoJobId+',this,\'before\');this.closest(\'.zmodal-overlay\').remove();setTimeout(()=>openJobSheet('+clientId+'),600)" style="display:none">+ Before</label>'+
          '</div>'+
          '<div>'+
            '<div style="font-size:11px;font-weight:700;color:var(--green-mid);margin-bottom:6px;text-transform:uppercase;letter-spacing:.04em">After ('+afterPhotos.length+')</div>'+
            '<div style="display:flex;gap:6px;flex-wrap:wrap;min-height:40px">'+
              afterPhotos.map((p,i)=>renderThumb(p,i,'after')).join('')+
            '</div>'+
            '<label style="display:inline-flex;align-items:center;gap:5px;margin-top:6px;padding:7px 12px;border-radius:var(--r);border:1px dashed var(--green-mid);color:var(--green-mid);font-size:11px;font-weight:700;cursor:pointer;background:var(--green-lt)">'+
              '<input type="file" accept="image/*" capture="environment" onchange="addJobPhoto('+photoJobId+',this,\'after\');this.closest(\'.zmodal-overlay\').remove();setTimeout(()=>openJobSheet('+clientId+'),600)" style="display:none">+ After</label>'+
          '</div>'+
        '</div>'+
        '<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">'+
          '<div style="font-size:11px;font-weight:700;color:var(--denim);margin-bottom:6px;text-transform:uppercase;letter-spacing:.04em">Progress ('+progressPhotos.length+')</div>'+
          '<div style="display:flex;gap:6px;flex-wrap:wrap;min-height:40px;margin-bottom:8px">'+
            progressPhotos.map((p,i)=>renderThumb(p,i,'progress')).join('')+
          '</div>'+
          '<div style="display:flex;gap:6px">'+
            '<input type="text" id="_progLbl-'+photoJobId+'" maxlength="60" placeholder="Label (optional): e.g. Framing, Rough-in" style="flex:1;min-width:0;padding:8px 10px;border-radius:var(--r);border:1px solid var(--border2);font-size:12px;font-family:inherit">'+
            '<label style="display:inline-flex;align-items:center;gap:5px;padding:7px 12px;border-radius:var(--r);border:1px dashed var(--denim);color:var(--denim);font-size:11px;font-weight:700;cursor:pointer;background:var(--bg2);flex-shrink:0;white-space:nowrap">'+
              '<input type="file" accept="image/*" capture="environment" onchange="addJobPhoto('+photoJobId+',this,\'progress\',document.getElementById(\'_progLbl-'+photoJobId+'\').value);this.closest(\'.zmodal-overlay\').remove();setTimeout(()=>openJobSheet('+clientId+'),600)" style="display:none">+ Photo</label>'+
          '</div>'+
        '</div>'+
        shareBtn+
      '</div>';
  }

  // ── Actual material costs vs estimated ──────────────────────
  const clientExpenses=expenses.filter(e=>e.client_id===clientId);
  let actualCostsHtml='';
  if(bid&&clientExpenses.length){
    const totalActual=clientExpenses.reduce((s,e)=>s+(e.amount||0),0);
    const estimatedCost=Math.round(bid.amount*(1-((S.margin||40)/100)));
    const actualMargin=bid.amount>0?Math.round((bid.amount-totalActual)/bid.amount*100):0;
    const marginColor=actualMargin>=30?'var(--green-mid)':actualMargin>=15?'var(--amber)':'#A32D2D';
    const byCat={};
    clientExpenses.forEach(e=>{const k=e.category||'Other';byCat[k]=(byCat[k]||0)+(e.amount||0);});
    const topCats=Object.entries(byCat).sort((a,b)=>b[1]-a[1]).slice(0,3);
    actualCostsHtml=
      '<div style="padding:14px 20px;border-bottom:1px solid var(--border)">'+
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">'+
          '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3)">'+svgIcon('📊')+' Actual costs</div>'+
          '<button onclick="this.closest(\'.zmodal-overlay\').remove();showQuickExpenseModal('+clientId+',null)" style="padding:5px 12px;border-radius:20px;border:none;background:var(--bg2);color:var(--text3);font-size:11px;font-weight:700;cursor:pointer;font-family:inherit">+ Log cost</button>'+
        '</div>'+
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:10px">'+
          '<div style="background:var(--bg2);border-radius:var(--r);padding:8px;text-align:center">'+
            '<div style="font-size:9px;color:var(--text3);font-weight:700;text-transform:uppercase;margin-bottom:2px">Contract</div>'+
            '<div style="font-size:14px;font-weight:800">'+fmt(bid.amount)+'</div>'+
          '</div>'+
          '<div style="background:var(--bg2);border-radius:var(--r);padding:8px;text-align:center">'+
            '<div style="font-size:9px;color:var(--text3);font-weight:700;text-transform:uppercase;margin-bottom:2px">Spent</div>'+
            '<div style="font-size:14px;font-weight:800;color:#A32D2D">'+fmt(totalActual)+'</div>'+
          '</div>'+
          '<div style="background:var(--bg2);border-radius:var(--r);padding:8px;text-align:center">'+
            '<div style="font-size:9px;color:var(--text3);font-weight:700;text-transform:uppercase;margin-bottom:2px">Margin</div>'+
            '<div style="font-size:14px;font-weight:800;color:'+marginColor+'">'+actualMargin+'%</div>'+
          '</div>'+
        '</div>'+
        (topCats.length?
          '<div>'+topCats.map(([cat,amt])=>
            '<div style="display:flex;justify-content:space-between;font-size:11px;padding:3px 0;border-bottom:1px solid var(--border2)">'+
              '<span style="color:var(--text2)">'+escHtml(cat)+'</span>'+
              '<span style="font-weight:700;color:var(--text)">'+fmt(amt)+'</span>'+
            '</div>'
          ).join('')+'</div>'
        :'')+
      '</div>';
  } else if(!bid&&clientExpenses.length){
    const totalActual=clientExpenses.reduce((s,e)=>s+(e.amount||0),0);
    actualCostsHtml=
      '<div style="padding:14px 20px;border-bottom:1px solid var(--border)">'+
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'+
          '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3)">'+svgIcon('📊')+' Job expenses</div>'+
          '<button onclick="this.closest(\'.zmodal-overlay\').remove();showQuickExpenseModal('+clientId+',null)" style="padding:5px 12px;border-radius:20px;border:none;background:var(--bg2);color:var(--text3);font-size:11px;font-weight:700;cursor:pointer;font-family:inherit">+ Log cost</button>'+
        '</div>'+
        '<div style="font-size:14px;font-weight:800;color:#A32D2D">'+fmt(totalActual)+' logged</div>'+
      '</div>';
  }

  // ── Subcontractors on this job ───────────────────────────────
  const latestJob=allJobs.filter(j=>j.status!=='canceled').sort((a,b)=>(b.start||'').localeCompare(a.start||''))[0];
  const subsJob=latestJob||allJobs.filter(j=>j.status!=='canceled').sort((a,b)=>(b.start||'').localeCompare(a.start||''))[0];
  const subsJobId=subsJob?subsJob.id:null;
  const jobSubs=(subsJob&&subsJob.subs)||[];
  const subRoster=S.subcontractors||[];
  let subsHtml='';
  if(subsJobId){
    const totalOwed=jobSubs.filter(s=>!s.paid).reduce((s,x)=>s+(x.amount||0),0);
    subsHtml=
      '<div style="padding:14px 20px;border-bottom:1px solid var(--border)">'+
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:'+(jobSubs.length?'10px':'0')+'">'+
          '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3)">'+svgIcon('🔨')+' Subcontractors'+(totalOwed>0?' <span style="font-size:10px;font-weight:700;background:#FEE8E8;color:#991B1B;padding:1px 7px;border-radius:8px">'+fmt(totalOwed)+' owed</span>':'')+'</div>'+
          '<button onclick="openAssignSubModal('+subsJobId+','+clientId+')" style="padding:5px 12px;border-radius:20px;border:none;background:var(--bg2);color:var(--blue);font-size:11px;font-weight:700;cursor:pointer;font-family:inherit">+ Assign sub</button>'+
        '</div>'+
        (jobSubs.length?
          jobSubs.map((sub,si)=>
            '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border2)">'+
              '<div>'+
                '<div style="font-size:13px;font-weight:700">'+escHtml(sub.subName||'Sub')+'</div>'+
                (sub.desc?'<div style="font-size:11px;color:var(--text3)">'+escHtml(sub.desc)+'</div>':'')+
              '</div>'+
              '<div style="text-align:right;flex-shrink:0;margin-left:10px">'+
                '<div style="font-size:13px;font-weight:800;color:'+(sub.paid?'var(--green-mid)':'#A32D2D')+'">'+fmt(sub.amount||0)+(sub.paid?' ✓':'')+'</div>'+
                (!sub.paid?'<button onclick="markSubPaid('+subsJobId+','+si+','+clientId+')" style="font-size:10px;padding:2px 8px;border-radius:var(--r);border:none;background:var(--green-lt);color:var(--green-mid);font-weight:700;cursor:pointer;font-family:inherit;margin-top:2px">Mark paid</button>':
                  '<div style="font-size:10px;color:var(--text3);margin-top:1px">'+sub.paidDate+'</div>')+
              '</div>'+
            '</div>'
          ).join('')
        :
          '<div style="font-size:12px;color:var(--text3);padding:6px 0">No subs assigned to this job.</div>'
        )+
      '</div>';
  }

  // ── Visit notes ──────────────────────────────────────────────
  const visitNotesJobId=latestJob?latestJob.id:null;
  const visitNotesVal=latestJob?(latestJob.visitNotes||''):'';
  let visitNotesHtml='';
  if(visitNotesJobId){
    visitNotesHtml=
      '<div style="padding:14px 20px;border-bottom:1px solid var(--border)">'+
        '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:8px">'+svgIcon('📝')+' Job notes</div>'+
        '<textarea id="visit-notes-ta" placeholder="Site conditions, instructions for crew, client requests, punch list..." '+
          'style="width:100%;min-height:75px;font-size:13px;padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);font-family:inherit;resize:none;box-sizing:border-box;line-height:1.5" '+
          'onblur="saveVisitNotes('+visitNotesJobId+',this.value)">'+escHtml(visitNotesVal)+'</textarea>'+
        '<div style="font-size:10px;color:var(--text3);margin-top:4px">Auto-saves when you tap out</div>'+
      '</div>';
  }

  // ── Crew tasks (contractor assigns, employees check off) ─────
  let tasksHtml='';
  if(latestJob&&!_isEmployee){
    const _jt=latestJob.tasks||[];
    const _taskRows=_jt.map(t=>{
      const _di=t.done&&t.doneBy?'<div style="font-size:10px;color:var(--green-mid);margin-top:2px">✓ '+escHtml(t.doneBy)+(t.doneAt?' · '+_fmtTaskTime(t.doneAt):'')+'</div>':'';
      return '<div style="display:flex;align-items:flex-start;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">'+
        '<button onclick="_contractorToggleTask('+latestJob.id+','+t.id+')" style="flex-shrink:0;margin-top:1px;width:20px;height:20px;border-radius:4px;border:2px solid '+(t.done?'var(--green-mid)':'var(--border2)')+';background:'+(t.done?'var(--green-mid)':'transparent')+';cursor:pointer;padding:0;display:flex;align-items:center;justify-content:center">'+(t.done?'<span style="color:#fff;font-size:9px;font-weight:900">✓</span>':'')+
        '</button>'+
        '<div style="flex:1"><span style="font-size:13px;color:'+(t.done?'var(--text3)':'var(--text)')+(t.done?';text-decoration:line-through':'')+'">'+ escHtml(t.text)+'</span>'+_di+'</div>'+
        '<button onclick="_removeJobTask('+latestJob.id+','+t.id+')" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:18px;padding:2px 6px;min-height:32px;line-height:1">×</button>'+
      '</div>';
    }).join('');
    tasksHtml=
      '<div style="padding:14px 20px;border-bottom:1px solid var(--border)">'+
        '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:8px">'+svgIcon('✅')+' Crew Tasks</div>'+
        '<div id="_jtasks-list-'+latestJob.id+'">'+(_taskRows||'<div style="font-size:12px;color:var(--text3);padding:4px 0">No tasks, add one below</div>')+'</div>'+
        '<div style="display:flex;gap:8px;margin-top:10px">'+
          '<input id="_jtask-input-'+latestJob.id+'" placeholder="e.g. Call ahead 30 min before arrival" '+
            'style="flex:1;font-size:13px;padding:8px 10px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);font-family:inherit" '+
            'onkeydown="if(event.key===\'Enter\')_addJobTask('+latestJob.id+')">'+
          '<button onclick="_addJobTask('+latestJob.id+')" style="padding:8px 14px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;min-height:44px;white-space:nowrap">+ Add</button>'+
        '</div>'+
      '</div>';
  }

  // ── Job actions ──────────────────────────────────────────────
  const jobActions=getClientJobs(clientId).filter(j=>j.eventType!=='estimate'&&j.status==='active');
  let actionsHtml=
    '<div style="padding:14px 20px">'+
      '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:10px">'+svgIcon('⚡')+' Actions</div>'+
      '<div style="display:grid;gap:8px">'+
        (jobActions.length?
          jobActions.map(j=>'<button onclick="this.closest(\'.zmodal-overlay\').remove();markJobDone('+j.id+')" style="padding:12px;border-radius:var(--r);border:none;background:var(--green-mid);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;text-align:left">✓ Mark job complete, '+escHtml(j.name||'')+'</button>').join('')
        :'')+
        (bid?'<button onclick="this.closest(\'.zmodal-overlay\').remove();showChangeOrderModal('+bid.id+','+clientId+')" style="padding:12px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;text-align:left">'+svgIcon('📋')+' Change order, adjust scope or price</button>':'')+
        '<button onclick="this.closest(\'.zmodal-overlay\').remove();openClientDetail('+clientId+')" style="padding:12px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;color:var(--text);text-align:left">'+svgIcon('📋')+' Full client record & history</button>'+
      '</div>'+
    '</div>';

  // ── Change order history ─────────────────────────────────────
  let coHistoryHtml='';
  const allCOs=wonBids.flatMap(wb=>(wb.changeOrders||[]).map(co=>({...co,bidId:wb.id})));
  if(allCOs.length){
    coHistoryHtml='<div style="padding:14px 20px;border-bottom:1px solid var(--border)">'+
      '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:10px">'+svgIcon('📋')+' Change Orders</div>'+
      allCOs.map(co=>{
        const deltaColor=co.type==='add'?'var(--blue)':'#A32D2D';
        const deltaLabel=co.type==='add'?'+'+fmt(co.amount):'-'+fmt(co.amount);
        const signedLabel=co.signedAt?new Date(co.signedAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'Unsigned';
        return '<div style="border:1px solid var(--border2);border-radius:var(--r);padding:12px 14px;margin-bottom:8px;background:var(--bg2)">'+
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px">'+
            '<div style="font-size:12px;font-weight:800;color:var(--text)">CO #'+co.coNum+'</div>'+
            '<div style="display:flex;align-items:center;gap:6px">'+
              '<span style="font-size:13px;font-weight:800;color:'+deltaColor+'">'+deltaLabel+'</span>'+
              (co.signedAt?'<span style="font-size:10px;font-weight:700;background:#D1FAE5;color:#065F46;padding:2px 7px;border-radius:10px">Signed</span>':
               co.status==='pending_client'?'<span style="font-size:10px;font-weight:700;background:#FEF3C7;color:#92400E;padding:2px 7px;border-radius:10px">'+svgIcon('⏳')+' Awaiting client signature</span>':
                           '<span style="font-size:10px;font-weight:700;background:#FEF3C7;color:#92400E;padding:2px 7px;border-radius:10px">Unsigned</span>')+
            '</div>'+
          '</div>'+
          '<div style="font-size:12px;color:var(--text2);line-height:1.4;margin-bottom:6px">'+escHtml(co.desc)+'</div>'+
          '<div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;color:var(--text3)">'+
            '<span>'+fmt(co.originalAmount)+' → <strong style="color:var(--text)">'+fmt(co.newAmount)+'</strong></span>'+
            '<span>'+(co.signerName?'Signed by '+escHtml(co.signerName)+' · ':'')+signedLabel+'</span>'+
          '</div>'+
        '</div>';
      }).join('')+
    '</div>';
  }

  // ── Assigned employee (dispatch) ─────────────────────────────────────────────
  let assignedEmpHtml='';
  const latestAssignedJob=allJobs.filter(j=>j.assignedTo).sort((a,b)=>(b.assignedDate||'').localeCompare(a.assignedDate||''))[0];
  if(latestAssignedJob&&latestAssignedJob.assignedTo){
    const assignedEmp=(S.employees||[]).find(e=>String(e.id)===String(latestAssignedJob.assignedTo));
    if(assignedEmp){
      assignedEmpHtml='<div style="padding:10px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px">'+
        '<span style="font-size:11px;font-weight:700;color:var(--text3)">ASSIGNED TO</span>'+
        '<span style="font-size:13px;font-weight:700;color:var(--text)">'+escHtml(assignedEmp.name)+'</span>'+
        (latestAssignedJob.assignedDate?'<span style="font-size:10px;color:var(--text3)">· '+latestAssignedJob.assignedDate+'</span>':'')+
      '</div>';
    }
  }
  // ── Paint order (painting estimates only) ───────────────────────────────
  let paintOrderHtml='';
  const _paintBid=wonBids.find(b=>b.paintLines&&b.paintLines.length);
  if(_paintBid){
    const _pl=_paintBid.paintLines;
    const _coats=_paintBid.coats||2;
    paintOrderHtml=
      '<div style="padding:14px 20px;border-bottom:1px solid var(--border)">'+
        '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:10px">'+svgIcon('🎨')+' Paint order</div>'+
        '<div style="display:grid;grid-template-columns:1fr auto auto;gap:3px 10px;font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;margin-bottom:6px">'+
          '<span>Product · Color · Finish</span><span style="text-align:right">Sq ft</span><span style="text-align:right">Cans</span>'+
        '</div>'+
        _pl.map(function(pl){
          const parts=pl.spec?pl.spec.split(' · '):[];
          const prod=parts[0]||'';
          const colorFinish=parts.slice(1).join(' · ')||pl.spec||'';
          return '<div style="display:grid;grid-template-columns:1fr auto auto;gap:3px 10px;padding:6px 0;border-bottom:1px solid var(--border);align-items:start">'+
            '<div><div style="font-size:11px;font-weight:700;color:var(--text)">'+escHtml(prod)+'</div>'+
            '<div style="font-size:11px;color:var(--text3)">'+escHtml(colorFinish)+'</div></div>'+
            '<div style="text-align:right;font-size:11px;color:var(--text2)">'+(pl.sqFt||0).toLocaleString()+'</div>'+
            '<div style="text-align:right;font-size:13px;font-weight:800;color:var(--blue)">'+(pl.wholeCans||0)+' gal</div>'+
          '</div>';
        }).join('')+
        '<div style="font-size:10px;color:var(--text3);margin-top:6px">Includes 10% waste · '+_coats+' coat'+(_coats!==1?'s':'')+' · Verify with SW rep for dark colors</div>'+
      '</div>';
  }
  body.innerHTML=payHtml+schedHtml+assignedEmpHtml+coHistoryHtml+supplyHtml+scopeHtml+photosHtml+paintOrderHtml+actualCostsHtml+subsHtml+visitNotesHtml+tasksHtml+actionsHtml;
  box.appendChild(body);
  ov.appendChild(box);
  ov.onclick=e=>{if(e.target===ov)ov.remove();};
  document.body.appendChild(ov);
}

// ── Before/after shareable card ───────────────────────────────────────────────
async function _shareBeforeAfterCard(clientId){
  const c=getClientById(clientId);
  const allJobs=getClientJobs(clientId).filter(j=>j.eventType!=='estimate'&&j.status!=='canceled');
  const job=allJobs.sort((a,b)=>(b.start||'').localeCompare(a.start||''))[0];
  if(!job)return;
  const before=(job.photos||[]).filter(p=>p.type==='before');
  const after=(job.photos||[]).filter(p=>p.type==='after');
  if(!before.length||!after.length)return showToast('Need at least one before and one after photo','⚠️');
  showToast('Building card…','🎨');
  try{
    const W=1200,H=700,PAD=24,LABEL_H=40;
    const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='#111827';ctx.fillRect(0,0,W,H);
    const half=(W-PAD*3)/2;
    const imgH=H-LABEL_H*2-PAD*2;
    const loadImg=src=>new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=src;});
    const [bImg,aImg]=await Promise.all([loadImg(before[before.length-1].data),loadImg(after[after.length-1].data)]);
    const drawCovered=(img,x,y,w,h)=>{
      const scale=Math.max(w/img.width,h/img.height);
      const sw=img.width*scale,sh=img.height*scale;
      ctx.drawImage(img,x+(w-sw)/2,y+(h-sh)/2,sw,sh);
    };
    ctx.save();ctx.beginPath();ctx.roundRect(PAD,PAD+LABEL_H,half,imgH,8);ctx.clip();
    drawCovered(bImg,PAD,PAD+LABEL_H,half,imgH);ctx.restore();
    ctx.save();ctx.beginPath();ctx.roundRect(PAD*2+half,PAD+LABEL_H,half,imgH,8);ctx.clip();
    drawCovered(aImg,PAD*2+half,PAD+LABEL_H,half,imgH);ctx.restore();
    // Labels
    const labelBg=(x,w,color,text)=>{ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(x,PAD,w,LABEL_H-4,6);ctx.fill();ctx.fillStyle='#fff';ctx.font='bold 18px system-ui';ctx.textAlign='center';ctx.fillText(text,x+w/2,PAD+26);};
    labelBg(PAD,half,'#92400E','BEFORE');
    labelBg(PAD*2+half,half,'#065F46','AFTER');
    // Branding footer
    const biz=S.bname||'TradeDesk';
    ctx.fillStyle='rgba(0,0,0,.6)';ctx.fillRect(0,H-LABEL_H,W,LABEL_H);
    ctx.fillStyle='#fff';ctx.font='bold 16px system-ui';ctx.textAlign='left';
    ctx.fillText(biz+(c?' · '+c.name:''),PAD,H-12);
    ctx.textAlign='right';ctx.fillStyle='rgba(255,255,255,.5)';ctx.font='13px system-ui';
    ctx.fillText(new Date().toLocaleDateString('en-US',{month:'long',year:'numeric'}),W-PAD,H-12);
    canvas.toBlob(async blob=>{
      if(!blob)return showToast('Could not build image','⚠️');
      // Upload to gallery bucket → push to photos[] → refresh client hub
      try{
        if(supaEnabled&&supaEnabled()&&_supaUser){
          const path=_supaUser.id+'/'+clientId+'/ba-'+Date.now()+'.jpg';
          // The composed card is already a bounded-size canvas JPEG, no main
          // recompress needed, but it gets the immutable cache header + a grid thumb.
          const{error:upErr}=await _supa.storage.from('gallery').upload(path,blob,{contentType:'image/jpeg',upsert:false,cacheControl:_PHOTO_CACHE});
          if(!upErr){
            const{data:urlData}=_supa.storage.from('gallery').getPublicUrl(path);
            const publicUrl=urlData?.publicUrl||'';
            if(publicUrl){
              const _baCp=await _compressPhoto(blob,{maxEdge:1600});
              const{thumbUrl,thumbPath}=await _uploadPhotoThumb(_baCp?_baCp.thumb:null,path);
              photos.push({id:Date.now()+Math.random(),url:publicUrl,storagePath:path,thumbUrl,thumbPath,type:'before-after',caption:'Before & After',client_id:clientId,client_name:c?c.name:'',uploadedAt:new Date().toISOString()});
              saveAll();
              _uploadClientHub&&_uploadClientHub(clientId).catch(()=>{});
              showToast('Added to client hub','✓');
            }
          }
        }
      }catch(_e){}
      const file=new File([blob],'before-after.jpg',{type:'image/jpeg'});
      if(navigator.share&&navigator.canShare&&navigator.canShare({files:[file]})){
        try{await navigator.share({files:[file],title:biz+', Before & After',text:(c?c.name+' · ':'')+'Finished job by '+biz});}
        catch(e){if(e.name!=='AbortError')showToast('Share cancelled','');}
      } else {
        const url=URL.createObjectURL(blob);
        const a=document.createElement('a');a.href=url;a.download='before-after.jpg';a.click();
        setTimeout(()=>URL.revokeObjectURL(url),3000);
        showToast('Image downloaded','📥');
      }
    },'image/jpeg',0.92);
  }catch(e){showToast('Could not build card','⚠️');console.warn(e);}
}

// ── Subcontractor assignment ───────────────────────────────────────────────────
function openAssignSubModal(jobId,clientId){
  const subs=S.subcontractors||[];
  document.getElementById('_asub-ov')?.remove();
  const ov=document.createElement('div');ov.id='_asub-ov';ov.className='zmodal-overlay';
  const box=document.createElement('div');box.className='zmodal';
  const subOpts=subs.length
    ?subs.map((s,i)=>'<option value="'+i+'">'+escHtml(s.name||'Sub')+(s.trade?' ('+escHtml(s.trade)+')':'')+'</option>').join('')
    :'<option value="">- No subs in roster -</option>';
  box.innerHTML=
    '<div style="font-size:17px;font-weight:800;margin-bottom:14px">Assign Subcontractor</div>'+
    '<div class="f" style="margin-bottom:12px"><label>Subcontractor</label>'+
      '<select id="asub-pick" style="font-size:14px;padding:10px">'+subOpts+'</select>'+
      (!subs.length?'<div style="font-size:11px;color:var(--text3);margin-top:4px">Add subs in Fleet & Team first.</div>':'')+
    '</div>'+
    '<div class="f" style="margin-bottom:12px"><label>Description of work</label>'+
      '<input id="asub-desc" placeholder="Drywall repair, trim, plumbing rough-in..." style="font-size:14px;padding:10px"></div>'+
    '<div class="f" style="margin-bottom:16px"><label>Amount owed ($)</label>'+
      '<input id="asub-amount" type="number" min="0" step="0.01" placeholder="0.00" style="font-size:15px;padding:10px;font-weight:700"></div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'+
      '<button onclick="document.getElementById(\'_asub-ov\').remove()" style="padding:11px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;color:var(--text)">Cancel</button>'+
      '<button id="asub-save" onclick="_saveSubAssignment('+jobId+','+clientId+')" style="padding:11px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">Assign</button>'+
    '</div>';
  ov.appendChild(box);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
}
function _saveSubAssignment(jobId,clientId){
  const idx=parseInt(document.getElementById('asub-pick')?.value);
  const sub=(S.subcontractors||[])[idx];
  if(!sub)return showToast('Select a subcontractor','⚠️');
  const desc=(document.getElementById('asub-desc')?.value||'').trim();
  const amount=parseFloat(document.getElementById('asub-amount')?.value||0)||0;
  const j=jobs.find(x=>x.id===jobId);if(!j)return;
  if(!j.subs)j.subs=[];
  j.subs.push({subId:sub.id,subName:sub.name,desc,amount,paid:false,paidDate:''});
  saveAll();
  // The live pipe: a linked sub gets the job ADDRESS + start date the moment
  // they're assigned, that's when they need it (mileage, routing). Address
  // only: never the job name, description, amount, or client details.
  if(typeof _offerJobToLinkedSub==='function'&&sub.id){
    const _asBid=j.bid_id?bids.find(b=>b.id===j.bid_id):null;
    _offerJobToLinkedSub(sub.id,{addr:j.addr||(_asBid&&_asBid.addr)||'',date:j.start||''});
  }
  document.getElementById('_asub-ov')?.remove();
  showToast(sub.name+' assigned','✓');
  openJobSheet(clientId);
}
function markSubPaid(jobId,subIdx,clientId){
  const j=jobs.find(x=>x.id===jobId);if(!j||!j.subs||!j.subs[subIdx])return;
  const sp=j.subs[subIdx];
  sp.paid=true;sp.paidDate=todayKey();
  // Paying a sub IS a Schedule C Line 11 (contract labor) expense, write it so the
  // deduction and the 1099-NEC yearly total both happen automatically. subPayKey
  // dedupes: marking the same assignment paid twice never double-logs.
  const _spKey=jobId+':'+subIdx;
  if(sp.amount>0&&!expenses.some(e=>e.subPayKey===_spKey)){
    const _spBid=j.bid_id?bids.find(b=>b.id===j.bid_id):null;
    expenses.push({
      id:Date.now(),date:sp.paidDate,cat:'subs',catLabel:'Subcontractors',
      vendor:sp.subName||'Subcontractor',amount:sp.amount,
      notes:'Sub pay, '+(sp.desc||j.name||''),
      subId:sp.subId,subPayKey:_spKey,
      job_id:j.bid_id||null,job_name:j.name||(_spBid?_spBid.client_name:''),client_id:j.client_id||null,
      deductible:true,created_at:new Date().toISOString(),
    });
    expenses.sort((a,b)=>(a.date||'9').localeCompare(b.date||'9'));
  }
  saveAll();showToast('Marked paid, logged as contract-labor expense','✓');
  // The live pipe: if this sub runs their own TradeDesk account (linked at
  // invite redemption), offer them this payment for THEIR books. Fire-and-
  // forget: a no-op for unlinked subs, and never blocks the local flow.
  // Scope is deliberately tight: amount + date + job ADDRESS only (the sub
  // needs the address for mileage records). Never job names/descriptions:
  // those can carry the GC's client details.
  if(typeof _offerPaymentToLinkedSub==='function'&&sp.subId){
    const _spBid2=j.bid_id?bids.find(b=>b.id===j.bid_id):null;
    // Prefer the job's OWN address, fall back to its bid's: mirrors the
    // assignment path (_saveSubAssignment). A job with a direct address and no
    // bid (pipe-sourced or hand-scheduled) must still send its address so the
    // sub's mileage records stay accurate.
    _offerPaymentToLinkedSub(sp.subId,{amount:sp.amount,date:sp.paidDate,addr:j.addr||(_spBid2&&_spBid2.addr)||''});
  }
  openJobSheet(clientId);
}

// ── Extend job duration ────────────────────────────────────────────────────────
function _extendJob(jobId,parentOverlay){
  const j=jobs.find(x=>x.id===jobId);if(!j)return;
  const cur=parseInt(j.days)||1;
  const ov=document.createElement('div');ov.className='zmodal-overlay';
  const sheet=document.createElement('div');
  sheet.style.cssText='position:fixed;bottom:0;left:0;right:0;background:var(--bg);border-radius:16px 16px 0 0;padding:20px 16px 28px;box-shadow:0 -4px 24px rgba(0,0,0,.15);opacity:0;transform:translateY(12px);transition:opacity .2s cubic-bezier(.22,1,.36,1),transform .2s cubic-bezier(.22,1,.36,1)';
  sheet.innerHTML=
    '<div style="font-size:16px;font-weight:800;margin-bottom:4px">Extend job duration</div>'+
    '<div style="font-size:12px;color:var(--text3);margin-bottom:16px">Currently '+cur+' day'+(cur!==1?'s':'')+', how many days to add?</div>'+
    [1,2,3,5,7,14].map(d=>'<button onclick="_doExtendJob('+jobId+','+d+',this)" style="display:inline-block;padding:10px 18px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;margin:0 6px 8px 0;min-height:44px">+'+d+'d</button>').join('')+
    '<button onclick="this.closest(\'.zmodal-overlay\').remove()" style="display:block;width:100%;margin-top:8px;padding:10px;border-radius:var(--r);border:none;background:none;color:var(--text3);font-size:13px;cursor:pointer;font-family:inherit">Cancel</button>';
  ov.appendChild(sheet);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  requestAnimationFrame(()=>{sheet.style.opacity='1';sheet.style.transform='translateY(0)';});
}
function _doExtendJob(jobId,addDays,btn){
  const j=jobs.find(x=>x.id===jobId);if(!j)return;
  j.days=(parseInt(j.days)||1)+addDays;
  saveAll();
  if(typeof renderCal==='function')renderCal();
  btn.closest('.zmodal-overlay').remove();
  if(typeof showToast==='function')showToast('Job extended by '+addDays+' day'+(addDays!==1?'s':''),'📅');
}

// ── Push job date back ────────────────────────────────────────────────────────
function openPushBackModal(jobId,clientId,parentOverlay){
  const j=jobs.find(x=>x.id===jobId);if(!j)return;
  const c=getClientById(clientId);
  const firstName=c?c.name.split(' ')[0]:'there';
  const biz=S.bname||'your contractor';
  const oldDate=parseD(j.start).toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});
  const defaultMsg='Hi '+firstName+', this is '+biz+'. We need to push your job back a bit, we\'ll get you on the schedule as soon as possible and confirm the new date. We\'re sorry for any inconvenience and appreciate your patience!';
  document.getElementById('_pb-modal-ov')?.remove();
  const ov=document.createElement('div');ov.id='_pb-modal-ov';ov.className='zmodal-overlay';
  const box=document.createElement('div');box.className='zmodal';
  box.innerHTML=
    '<div style="font-size:17px;font-weight:800;margin-bottom:4px">'+svgIcon('📅')+' Push job back</div>'+
    '<div style="font-size:12px;color:var(--text3);margin-bottom:16px">Currently: <strong>'+oldDate+'</strong></div>'+
    '<div class="f" style="margin-bottom:14px"><label>New start date</label>'+
      '<input id="pb-new-date" type="date" value="'+j.start+'" min="'+todayKey()+'" style="font-size:15px;padding:10px;font-weight:700" oninput="_updatePushBackMsg('+clientId+')"></div>'+
    '<div class="f" style="margin-bottom:16px">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">'+
        '<label style="margin:0">Client message</label>'+
        (c&&c.phone?'<span style="font-size:10px;color:var(--text3)">Sends via SMS</span>':'<span style="font-size:10px;color:var(--amber)">No phone on file</span>')+
      '</div>'+
      '<textarea id="pb-msg" style="font-size:13px;padding:10px;min-height:90px;resize:none;line-height:1.5;width:100%;box-sizing:border-box;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);font-family:inherit">'+escHtml(defaultMsg)+'</textarea>'+
    '</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'+
      '<button onclick="document.getElementById(\'_pb-modal-ov\').remove()" style="padding:11px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;color:var(--text)">Cancel</button>'+
      '<button onclick="_savePushBack('+jobId+','+clientId+')" style="padding:11px;border-radius:var(--r);border:none;background:var(--amber);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">Save & '+(c&&c.phone?'Text client':'Notify')+'</button>'+
    '</div>';
  ov.appendChild(box);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  if(parentOverlay)parentOverlay.remove();
}
function _updatePushBackMsg(clientId){
  const c=getClientById(clientId);if(!c)return;
  const firstName=(c.name||'').split(' ')[0];
  const biz=S.bname||'your contractor';
  const newDateEl=document.getElementById('pb-new-date');
  const msgEl=document.getElementById('pb-msg');
  if(!newDateEl||!msgEl)return;
  const newDateStr=newDateEl.value;
  if(!newDateStr)return;
  const newDateFmt=parseD(newDateStr).toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});
  msgEl.value='Hi '+firstName+', this is '+biz+'. We\'ve rescheduled your job to '+newDateFmt+'. We apologize for the change and look forward to seeing you then!';
}
function _savePushBack(jobId,clientId){
  const j=jobs.find(x=>x.id===jobId);if(!j)return;
  const c=getClientById(clientId);
  const newDate=document.getElementById('pb-new-date')?.value;
  const msg=(document.getElementById('pb-msg')?.value||'').trim();
  if(!newDate)return showToast('Pick a new date','⚠️');
  if(newDate===j.start)return showToast('Date unchanged','⚠️');
  j.start=newDate;
  saveAll();
  _uploadClientHub&&_uploadClientHub(clientId).catch(()=>{});
  document.getElementById('_pb-modal-ov')?.remove();
  showToast('Job pushed to '+parseD(newDate).toLocaleDateString('en-US',{month:'short',day:'numeric'}),'📅');
  if(c&&c.phone&&msg){
    window.location.href='sms:'+c.phone.replace(/\D/g,'')+'&body='+encodeURIComponent(msg);
  }
  setTimeout(()=>openJobSheet(clientId),500);
}

function openMapsForClient(clientId){
  const c=getClientById(clientId);
  if(!c||!c.addr)return zAlert('No address on file.');
  window.open('https://maps.apple.com/?daddr='+encodeURIComponent(c.addr),'_blank');
}
function sendOMWText(clientId){
  const c=getClientById(clientId);
  if(!c||!c.phone)return;
  const firstName=(c.name||'').split(' ')[0];
  const biz=S.bname||'TradeDesk';
  const msg='Hi '+firstName+', this is '+biz+', I\'m on my way! I\'ll be there shortly.';
  window.location.href='sms:'+c.phone.replace(/\D/g,'')+'&body='+encodeURIComponent(msg);
}
// Egress fix: phone photos are 3–8MB and were uploaded RAW, then served
// full-size even inside 110px thumbnail grids. Compress to a 1600px-long-edge
// JPEG (visually identical at any app size) + a 360px thumbnail for grids;
// the full image loads only in the lightbox. Returns null on ANY failure,
// callers then upload the original file exactly as before, so a photo can
// never be lost to a decode error (odd formats, HEIC on old engines, etc.).
async function _compressPhoto(fileOrBlob,opts){
  try{
    const maxEdge=(opts&&opts.maxEdge)||1600,thumbEdge=(opts&&opts.thumbEdge)||360,q=(opts&&opts.quality)||0.82;
    let bmp;
    // from-image applies EXIF orientation so portrait phone shots don't land sideways.
    try{bmp=await createImageBitmap(fileOrBlob,{imageOrientation:'from-image'});}
    catch(_e){bmp=await createImageBitmap(fileOrBlob);}
    const draw=edge=>{
      const scale=Math.min(1,edge/Math.max(bmp.width,bmp.height));
      const w=Math.max(1,Math.round(bmp.width*scale)),h=Math.max(1,Math.round(bmp.height*scale));
      const cv=document.createElement('canvas');cv.width=w;cv.height=h;
      cv.getContext('2d').drawImage(bmp,0,0,w,h);
      return new Promise(res=>cv.toBlob(res,'image/jpeg',q));
    };
    const blob=await draw(maxEdge);
    const thumb=await draw(thumbEdge);
    if(!blob||!thumb||!blob.size||!thumb.size)return null;
    return{blob,thumb,mime:'image/jpeg',ext:'jpg'};
  }catch(_e){return null;}
}
// Immutable-path uploads (every path carries Date.now()) → cache for a year so
// browsers and the CDN absorb repeat views instead of Supabase egress.
const _PHOTO_CACHE='31536000';
// Upload the 360px thumbnail alongside the main photo. Non-fatal by design,
// a failed thumb just means grids fall back to the full image (pre-fix behavior).
async function _uploadPhotoThumb(thumbBlob,mainPath){
  try{
    if(!thumbBlob)return{thumbUrl:'',thumbPath:''};
    const thumbPath=mainPath.replace(/([^/]+)$/,'t-$1').replace(/\.[a-z0-9]+$/i,'.jpg');
    // One retry on failure: a transient network blip here loses the thumbnail
    // FOREVER (nothing re-attempts later, grids permanently fall back to full
    // bytes, defeating the egress win for that photo). Seen live: main upload
    // 200, thumb dropped, on a flaky runner network.
    let error;
    for(let _try=0;_try<2;_try++){
      ({error}=await _supa.storage.from('gallery').upload(thumbPath,thumbBlob,{contentType:'image/jpeg',upsert:_try>0,cacheControl:_PHOTO_CACHE}));
      if(!error)break;
      await new Promise(r=>setTimeout(r,800));
    }
    if(error)return{thumbUrl:'',thumbPath:''};
    const{data}=_supa.storage.from('gallery').getPublicUrl(thumbPath);
    return{thumbUrl:data?data.publicUrl||'':'',thumbPath};
  }catch(_e){return{thumbUrl:'',thumbPath:''};}
}
function addJobPhoto(jobId,input,type,caption){
  const file=input.files[0];if(!file)return;
  caption=(caption||'').trim().slice(0,60);
  const reader=new FileReader();
  reader.onload=async e=>{
    const j=jobs.find(x=>x.id===jobId);if(!j)return;
    if(!j.photos)j.photos=[];
    j.photos.push({type,data:e.target.result,ts:new Date().toISOString(),caption});
    saveAll();
    showToast((type==='before'?'Before':type==='after'?'After':caption||'Progress')+' photo saved','📸');
    // Upload to gallery storage → push to global photos[] → refresh client hub
    if(typeof supaEnabled==='function'&&supaEnabled()&&_supaUser&&_supa){
      try{
        // Compress + thumbnail (egress fix). null → upload the original untouched.
        const _cp=await _compressPhoto(file);
        const ext=_cp?_cp.ext:(file.name.split('.').pop()||'jpg').toLowerCase();
        const path=_supaUser.id+'/'+jobId+'/'+type+'-'+Date.now()+'.'+ext;
        const{error}=await _supa.storage.from('gallery').upload(path,_cp?_cp.blob:file,{contentType:_cp?_cp.mime:(file.type||'image/jpeg'),upsert:false,cacheControl:_PHOTO_CACHE});
        if(!error){
          const{data:urlData}=_supa.storage.from('gallery').getPublicUrl(path);
          const publicUrl=urlData?.publicUrl||'';
          if(publicUrl){
            const{thumbUrl,thumbPath}=await _uploadPhotoThumb(_cp?_cp.thumb:null,path);
            const c=clients.find(x=>x.id===j.client_id);
            const _photoClientName=c?c.name||'':'';
            photos.push({id:Date.now()+Math.random(),url:publicUrl,storagePath:path,thumbUrl,thumbPath,type,caption,client_id:j.client_id||null,client_name:_photoClientName,job_id:jobId,job_name:j.name||'',uploadedAt:new Date().toISOString()});
            saveAll();
            typeof _uploadClientHub==='function'&&_uploadClientHub(j.client_id).catch(()=>{});
          }
        }else{
          // Storage offline, mark base64 for retry on reconnect
          const lastPhoto=j.photos[j.photos.length-1];
          if(lastPhoto){lastPhoto.pendingUpload=true;lastPhoto._uploadExt=(file.name.split('.').pop()||'jpg').toLowerCase();lastPhoto._uploadMime=file.type||'image/jpeg';saveAll();}
        }
      }catch(_e){
        // Network error, mark for retry
        const lastPhoto=j.photos[j.photos.length-1];
        if(lastPhoto&&!lastPhoto.pendingUpload){lastPhoto.pendingUpload=true;lastPhoto._uploadExt=(file.name.split('.').pop()||'jpg').toLowerCase();lastPhoto._uploadMime=file.type||'image/jpeg';saveAll();}
      }
    }else{
      // Not connected to Supabase, mark base64 for upload when online
      const lastPhoto=j.photos[j.photos.length-1];
      if(lastPhoto){lastPhoto.pendingUpload=true;lastPhoto._uploadExt=(file.name.split('.').pop()||'jpg').toLowerCase();lastPhoto._uploadMime=file.type||'image/jpeg';saveAll();}
    }
  };
  reader.readAsDataURL(file);
}
async function _drainPhotoQueue(){
  if(!supaEnabled()||!_supaUser||!_supa)return;
  let dirty=false;
  for(const j of jobs){
    if(!j.photos)continue;
    for(const p of j.photos){
      if(!p.pendingUpload||!p.data)continue;
      try{
        const mime=p._uploadMime||'image/jpeg';
        // Convert base64 data URL to Blob for upload
        const b64=p.data.split(',')[1]||p.data;
        const bytes=Uint8Array.from(atob(b64),ch=>ch.charCodeAt(0));
        const rawBlob=new Blob([bytes],{type:mime});
        // Same compress+thumb treatment as the online path (egress fix).
        const _cp=await _compressPhoto(rawBlob);
        const ext=_cp?_cp.ext:(p._uploadExt||'jpg');
        const path=_supaUser.id+'/'+j.id+'/'+p.type+'-'+Date.now()+'.'+ext;
        const{error}=await _supa.storage.from('gallery').upload(path,_cp?_cp.blob:rawBlob,{contentType:_cp?_cp.mime:mime,upsert:false,cacheControl:_PHOTO_CACHE});
        if(!error){
          const{data:urlData}=_supa.storage.from('gallery').getPublicUrl(path);
          const publicUrl=urlData?.publicUrl||'';
          if(publicUrl){
            const{thumbUrl,thumbPath}=await _uploadPhotoThumb(_cp?_cp.thumb:null,path);
            const c=clients.find(x=>x.id===j.client_id);
            const _drainClientName=c?c.name||'':'';
            photos.push({id:Date.now()+Math.random(),url:publicUrl,storagePath:path,thumbUrl,thumbPath,type:p.type,caption:p.caption||'',client_id:j.client_id||null,client_name:_drainClientName,job_id:j.id,job_name:j.name||'',uploadedAt:new Date().toISOString()});
            typeof _uploadClientHub==='function'&&_uploadClientHub(j.client_id).catch(()=>{});
          }
          delete p.pendingUpload;delete p._uploadExt;delete p._uploadMime;
          dirty=true;
        }
      }catch(_e){}
    }
  }
  if(dirty)saveAll();
}
function deleteJobPhoto(jobId,idx,type){
  const j=jobs.find(x=>x.id===jobId);if(!j||!j.photos)return;
  const typePhotos=j.photos.filter(p=>p.type===type);
  const photoToRemove=typePhotos[idx];
  if(photoToRemove)j.photos=j.photos.filter(p=>p!==photoToRemove);
  saveAll();
}
function saveVisitNotes(jobId,val){
  const j=jobs.find(x=>x.id===jobId);if(!j)return;
  j.visitNotes=val.trim();
  saveAll();
  showToast('Notes saved','📝');
}

function _addJobTask(jobId){
  const input=document.getElementById('_jtask-input-'+jobId);
  if(!input)return;
  const text=(input.value||'').trim();
  if(!text)return;
  const j=jobs.find(x=>x.id===jobId);if(!j)return;
  if(!j.tasks)j.tasks=[];
  j.tasks.push({id:Date.now(),text,done:false});
  input.value='';
  saveAll();
  _renderJobTasks(jobId);
}
function _removeJobTask(jobId,taskId){
  const j=jobs.find(x=>x.id===jobId);if(!j||!j.tasks)return;
  j.tasks=j.tasks.filter(t=>t.id!==taskId);
  saveAll();
  _renderJobTasks(jobId);
}
function _renderJobTasks(jobId){
  const el=document.getElementById('_jtasks-list-'+jobId);if(!el)return;
  const j=jobs.find(x=>x.id===jobId);
  const tasks=(j&&j.tasks)||[];
  if(!tasks.length){el.innerHTML='<div style="font-size:12px;color:var(--text3);padding:4px 0">No tasks, add one below</div>';return;}
  el.innerHTML=tasks.map(t=>{
    const doneInfo=t.done&&t.doneBy
      ?'<div style="font-size:10px;color:var(--green-mid);margin-top:2px">✓ '+escHtml(t.doneBy)+(t.doneAt?' · '+_fmtTaskTime(t.doneAt):'')+'</div>'
      :'';
    return '<div style="display:flex;align-items:flex-start;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">'+
      '<button onclick="_contractorToggleTask('+jobId+','+t.id+')" style="flex-shrink:0;margin-top:1px;width:20px;height:20px;border-radius:4px;border:2px solid '+(t.done?'var(--green-mid)':'var(--border2)')+';background:'+(t.done?'var(--green-mid)':'transparent')+';cursor:pointer;padding:0;display:flex;align-items:center;justify-content:center">'+(t.done?'<span style="color:#fff;font-size:9px;font-weight:900">✓</span>':'')+
      '</button>'+
      '<div style="flex:1">'+
        '<span style="font-size:13px;color:'+(t.done?'var(--text3)':'var(--text)')+(t.done?';text-decoration:line-through':'')+'">'+ escHtml(t.text)+'</span>'+
        doneInfo+
      '</div>'+
      '<button onclick="_removeJobTask('+jobId+','+t.id+')" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:18px;padding:2px 6px;min-height:32px;line-height:1">×</button>'+
    '</div>';
  }).join('');
}
function _fmtTaskTime(iso){
  try{const d=new Date(iso);return d.toLocaleDateString('en-US',{month:'short',day:'numeric'})+' '+d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});}catch(e){return'';}
}
function _contractorToggleTask(jobId,taskId){
  const j=jobs.find(x=>x.id===jobId);if(!j||!j.tasks)return;
  const t=j.tasks.find(x=>x.id===taskId);if(!t)return;
  t.done=!t.done;
  if(t.done){t.doneBy=(typeof getOwnerName==='function'&&getOwnerName())||S.bname||'Contractor';t.doneAt=new Date().toISOString();}
  else{delete t.doneBy;delete t.doneAt;}
  saveAll();_renderJobTasks(jobId);
}

function deleteJob(jobId){
  const j=jobs.find(x=>x.id===jobId);
  if(!j)return;
  const label=j.eventType==='estimate'?'estimate visit':'job';
  zConfirm('Remove this '+label+' from the calendar?',()=>{
    _userDelete(()=>{jobs=jobs.filter(x=>x.id!==jobId);saveAll();});
    renderClientDetail();renderCalendar();
  },{title:'Remove '+label,yes:'Remove',danger:true});
}

function reopenJob(jobId){
  const j=jobs.find(x=>x.id===jobId);if(!j)return;
  zConfirm('Reopen this job as active?',()=>{
    const snap_status=j.status,snap_date=j.completion_date;
    j.status='upcoming';j.completion_date='';
    if(j.bid_id){const b=bids.find(x=>x.id===j.bid_id);if(b)b.completion_date='';}
    saveAll();renderClientDetail();renderDash();renderJobsPage();renderMoneyPage();
    const t=document.createElement('div');
    t.style.cssText='position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#222;color:#fff;padding:10px 16px;border-radius:20px;font-size:13px;font-weight:700;z-index:9999;display:flex;align-items:center;gap:10px;white-space:nowrap;box-shadow:0 4px 16px rgba(0,0,0,.3)';
    t.innerHTML='Job reopened &nbsp;<button style="background:rgba(255,255,255,.2);border:none;color:#fff;padding:4px 10px;border-radius:12px;font-size:12px;cursor:pointer;font-family:inherit">Undo</button>';
    t.querySelector('button').onclick=()=>{j.status=snap_status;j.completion_date=snap_date;if(j.bid_id){const b=bids.find(x=>x.id===j.bid_id);if(b)b.completion_date=snap_date;}saveAll();renderClientDetail();renderDash();renderJobsPage();t.remove();};
    document.body.appendChild(t);setTimeout(()=>{if(t.parentNode)t.remove();},5000);
  },{title:'Reopen job?',yes:'Reopen',danger:false});
}

function markJobDone(jobId){
  const j=jobs.find(x=>x.id===jobId);if(!j)return;
  const bid=j.bid_id?bids.find(b=>b.id===j.bid_id):null;
  const overlay=document.createElement('div');
  overlay.className='zmodal-overlay';
  const box=document.createElement('div');
  box.className='zmodal';
  box.innerHTML=
    '<div style="font-size:17px;font-weight:800;margin-bottom:4px">Job complete</div>'+
    '<div style="font-size:13px;color:var(--text3);margin-bottom:14px">'+escHtml(j.name||'')+'</div>'+
    '<div class="f" style="margin-bottom:14px">'+
      '<label style="font-size:11px;font-weight:700;color:var(--text3)">Completion date</label>'+
      '<input type="date" id="job-done-date" value="'+todayKey()+'" style="font-size:15px;padding:11px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);width:100%;box-sizing:border-box;color:var(--text)">'+
    '</div>'+
    (bid?
      '<div style="border:1px solid var(--border2);border-radius:var(--r);padding:12px;margin-bottom:14px">'+
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">'+
          '<div style="font-size:13px;font-weight:700">Need to change the final price?</div>'+
          '<div style="font-size:14px;font-weight:800;color:var(--blue)">'+fmt(bid.amount||0)+'</div>'+
        '</div>'+
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:0" id="adj-type-btns">'+
          '<button id="adj-dec" onclick="setAdjType(\'decrease\')" style="padding:10px;border-radius:var(--r);border:2px solid var(--border2);background:var(--bg2);font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;color:var(--text)">▼ Lower price</button>'+
          '<button id="adj-inc" onclick="setAdjType(\'increase\')" style="padding:10px;border-radius:var(--r);border:2px solid var(--border2);background:var(--bg2);font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;color:var(--text)">▲ Raise price</button>'+
        '</div>'+
        '<div id="adj-fields" style="display:none;margin-top:10px">'+
          '<div class="f" style="margin-bottom:8px">'+
            '<label style="font-size:11px;font-weight:700;color:var(--text3)">Amount ($)</label>'+
            '<input type="text" id="adj-amount" placeholder="0" inputmode="decimal"'+
              ' style="font-size:22px;font-weight:700;padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);width:100%;box-sizing:border-box;color:var(--text);text-align:center"'+
              ' oninput="_fmtMoneyInput(this);_previewAdjTotal('+jobId+')">'+
          '</div>'+
          '<div id="adj-preview" style="font-size:13px;font-weight:700;text-align:center;min-height:20px;margin-bottom:8px"></div>'+
          '<div class="f">'+
            '<label style="font-size:11px;font-weight:700;color:var(--text3)">Reason <span style="color:#A32D2D">*</span></label>'+
            '<input type="text" id="adj-reason" placeholder="e.g. Finished early, extra wall added..." style="font-size:13px;padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);width:100%;box-sizing:border-box;color:var(--text);font-family:inherit">'+
          '</div>'+
        '</div>'+
      '</div>'
    :'')+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'+
      '<button onclick="closeTopModal()" style="padding:12px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);font-size:14px;font-weight:600;cursor:pointer;font-family:inherit">Cancel</button>'+
      '<button onclick="_startJobComplete('+jobId+')" style="padding:12px;border-radius:var(--r);border:none;background:var(--green);color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit">Complete job ✓</button>'+
    '</div>';
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});
  box._jobId=jobId;
}
let _adjType=null;
// Root cause (found while wiring the price-increase signature gate below): the
// old flow read #adj-amount/#adj-reason/#job-done-date from confirmJobDone,
// but confirmJobDone only runs AFTER "Complete job" -> closeTopModal() removes
// THIS modal -> showJobDebrief() (a separate modal) -> confirmMarkComplete().
// By then this modal's inputs are detached from the document, so every read
// silently returned nothing, completion date always fell back to today, and
// price adjustments were dropped entirely, with no error. Captured here,
// while the modal is still live, and threaded through instead.
let _jobDoneCapture=null;
function setAdjType(t){
  _adjType=t;
  const inc=document.getElementById('adj-inc');
  const dec=document.getElementById('adj-dec');
  const fields=document.getElementById('adj-fields');
  if(inc){inc.style.borderColor=t==='increase'?'var(--blue)':'var(--border2)';inc.style.background=t==='increase'?'var(--blue-lt)':'var(--bg2)';}
  if(dec){dec.style.borderColor=t==='decrease'?'#A32D2D':'var(--border2)';dec.style.background=t==='decrease'?'#FEE8E8':'var(--bg2)';}
  if(fields){fields.style.display='';setTimeout(()=>{const a=document.getElementById('adj-amount');if(a){a.focus();a.select();}},60);}
}
function _previewAdjTotal(jobId){
  const j=jobs.find(x=>x.id===jobId);
  const bid=j?.bid_id?bids.find(b=>b.id===j.bid_id):null;
  if(!bid)return;
  const amt=_moneyVal('adj-amount');
  const preview=document.getElementById('adj-preview');
  if(!preview||!amt)return;
  const newTotal=_adjType==='increase'?bid.amount+amt:Math.max(0,bid.amount-amt);
  const arrow=_adjType==='increase'?'↑':'↓';
  const color=_adjType==='increase'?'var(--blue)':'var(--green-mid)';
  preview.innerHTML='<span style="color:var(--text3)">'+fmt(bid.amount)+'</span> <span style="color:'+color+'">'+arrow+' '+fmt(newTotal)+'</span>';
}
// Validates + captures the still-live markJobDone modal fields, then either
// proceeds straight to the debrief step (no adjustment, or a price DECREASE,
// the client owes less, nothing to protect against) or requires a client
// signature first (a price INCREASE, the one case that needs the same
// protection a signed change order gives: nothing on file yet says the client
// agreed to owe more).
function _startJobComplete(jobId){
  const dateStr=document.getElementById('job-done-date')?.value||todayKey();
  if(!dateStr.match(/^\d{4}-\d{2}-\d{2}$/)){zAlert('Enter a valid date.',{title:'Invalid date'});return;}
  const adjFields=document.getElementById('adj-fields');
  const adjOpen=adjFields&&adjFields.style.display!=='none';
  const adjAmt=_moneyVal('adj-amount');
  const adjReason=(document.getElementById('adj-reason')?.value||'').trim();
  if(adjOpen&&_adjType){
    if(adjAmt<=0){
      const el=document.getElementById('adj-amount');
      if(el){el.style.borderColor='#A32D2D';el.focus();}
      zAlert('Enter the amount to '+(_adjType==='increase'?'add':'deduct')+'.',{title:'Amount required'});return;
    }
    if(!adjReason||adjReason.length<5){
      const el=document.getElementById('adj-reason');
      if(el){el.style.borderColor='#A32D2D';el.style.background='var(--red-lt)';el.focus();}
      zAlert('Enter a reason for the price change (at least 5 characters).',{title:'Reason required'});return;
    }
  }
  _jobDoneCapture={dateStr,adjType:adjOpen?_adjType:null,adjAmt,adjReason,signerName:'',sigData:''};
  if(adjOpen&&_adjType==='increase'){_showJobDoneSignStep(jobId);return;}
  closeTopModal();showJobDebrief(jobId);
}
function _showJobDoneSignStep(jobId){
  const box=document.querySelector('.zmodal-overlay .zmodal');if(!box)return;
  const j=jobs.find(x=>x.id===jobId);
  const bid=j?.bid_id?bids.find(b=>b.id===j.bid_id):null;
  if(!bid){closeTopModal();showJobDebrief(jobId);return;}
  const cap=_jobDoneCapture;
  const newTotal=Math.round((bid.amount+cap.adjAmt)*100)/100;
  box.innerHTML=
    '<div style="font-size:17px;font-weight:800;margin-bottom:4px">Confirm the price increase</div>'+
    '<div style="font-size:13px;color:var(--text3);margin-bottom:14px">A price increase needs the client\'s sign-off, same protection as a change order, so nobody\'s surprised by the final bill.</div>'+
    '<div style="background:#EBF2FB;border:1.5px solid #93C5FD;border-radius:var(--r);padding:12px 14px;margin-bottom:16px">'+
      '<div style="font-size:11px;color:#1E3A8A;font-weight:700;text-transform:uppercase;margin-bottom:4px">'+escHtml(cap.adjReason)+'</div>'+
      '<div style="font-size:13px;color:#1E3A8A">'+fmt(bid.amount)+' → <strong>'+fmt(newTotal)+'</strong></div>'+
    '</div>'+
    esignPadHTML('job-sign')+
    // Literal same consent block as a change order, this IS one.
    esignConsentHTML('job-sign',ESIGN_NOTE_CHANGE_ORDER)+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'+
      '<button onclick="markJobDone('+jobId+')" style="padding:12px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;color:var(--text)">← Back</button>'+
      '<button onclick="_confirmJobDoneSign('+jobId+')" style="padding:12px;border-radius:var(--r);border:none;background:var(--green);color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit">Confirm &amp; complete ✓</button>'+
    '</div>';
  // Shared e-sign pad (esign.js): same markup + capture code as every signing surface.
  // Wired synchronously: the canvas is already in the DOM the instant box.innerHTML
  // above runs, so deferring this via setTimeout only opens a window where a fast
  // confirm click finds no registered pad yet (esignResult returns "no-pad").
  esignWire('job-sign');
}
function _confirmJobDoneSign(jobId){
  // Typed name OR a drawn signature satisfies the sign-off (same rule as before).
  const r=esignResult('job-sign',{requireTyped:false});
  const typed=(document.getElementById('job-sign-name')?.value||'').trim();
  const sigData=r.sigData;
  if(!typed&&!sigData){zAlert('Type the client\'s name or have them sign in the box above.',{title:'Signature required'});return;}
  if(_jobDoneCapture){_jobDoneCapture.signerName=typed;_jobDoneCapture.sigData=sigData;}
  closeTopModal();showJobDebrief(jobId);
}
async function confirmJobDone(jobId){
  const j=jobs.find(x=>x.id===jobId);if(!j)return;
  // Read from the capture taken in _startJobComplete while the modal was still
  // live: by the time this runs (after the debrief step) that modal's inputs
  // are long detached from the document (see root-cause note above _adjType).
  const cap=_jobDoneCapture||{};
  const dateStr=cap.dateStr||todayKey();
  const adjType=cap.adjType,adjAmt=cap.adjAmt||0,adjReason=cap.adjReason||'';
  closeTopModal();
  j.status='done';
  j.completion_date=dateStr;
  if(j.bid_id){
    const b=bids.find(x=>x.id===j.bid_id);
    if(b){
      b.completion_date=dateStr;
      if(adjType&&adjAmt>0){
        if(adjType==='increase'){
          // Routed through the SAME structure a normal signed change order
          // uses (owner: "we have change orders... that's what protects
          // everyone"): carries the signature captured in _confirmJobDoneSign.
          // Shows up everywhere change orders already do: Documents tab,
          // client hub, dashboard change-order rollups, no new UI needed.
          const coNum=(b.changeOrders||[]).length+1;
          const originalAmount=b.amount;
          const newAmount=Math.max(0,Math.round((b.amount+adjAmt)*100)/100);
          if(!b.changeOrders)b.changeOrders=[];
          b.changeOrders.push({
            id:Date.now(),coNum,date:dateStr,desc:adjReason,type:'addition',
            amount:adjAmt,delta:adjAmt,originalAmount,newAmount,
            signedAt:new Date().toISOString(),signerName:cap.signerName||'',sigData:cap.sigData||''
          });
          b.amount=newAmount;
        }else{
          // Decrease: client owes LESS, no dispute-protection need, same
          // no-signature path as before.
          b.amount=Math.max(0,Math.round((b.amount-adjAmt)*100)/100);
          if(!b.adjustments)b.adjustments=[];
          b.adjustments.push({type:adjType,amount:adjAmt,reason:adjReason,ts:new Date().toISOString()});
        }
      }
    }
  } else {
    const unlinkedWon=bids.filter(x=>x.client_id===j.client_id&&x.status==='Closed Won'&&!x.completion_date)
      .sort((a,b)=>(b.bid_date||'').localeCompare(a.bid_date||''));
    if(unlinkedWon.length){
      unlinkedWon[0].completion_date=dateStr;
      j.bid_id=unlinkedWon[0].id;
    }
  }
  _adjType=null;_jobDoneCapture=null;
  const jobMiles=getClientMileage(j.client_id).filter(m=>m.date>=j.start&&m.date<=addDays(dateStr,3));
  jobMiles.forEach(m=>{m.job_id=jobId;m.job_name=j.name;});
  saveAll();
  _refreshClientHub(j.client_id);
  emitEvent('job_completed',j.client_id,{job_id:j.id,bid_id:j.bid_id});
  renderClientDetail();
  renderDash();
  renderJobsPage();
  renderMoneyPage();
  let collectBid=j.bid_id?bids.find(x=>x.id===j.bid_id):null;
  if(!collectBid){
    const candidates=bids.filter(x=>x.client_id===j.client_id&&x.status==='Closed Won'&&getBidBalance(x)>0.01)
      .sort((a,b)=>(b.bid_date||'').localeCompare(a.bid_date||''));
    if(candidates.length)collectBid=candidates[0];
  }
  setTimeout(()=>showJobScorecard(jobId,collectBid?.id||null),200);
  const _jid=jobId,_cid=j.client_id;
  setTimeout(()=>{
    const hasExp=expenses.some(e=>e.job_id===_jid);
    if(hasExp)return;
    const expOv=document.createElement('div');expOv.className='zmodal-overlay';
    const expBox=document.createElement('div');expBox.className='zmodal';
    expBox.innerHTML=
      '<div style="font-size:17px;font-weight:800;margin-bottom:6px">Any material costs?</div>'+
      '<div style="font-size:13px;color:var(--text2);margin-bottom:18px;line-height:1.5">Log paint, supplies, or other materials to track your real profit on this job.</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'+
        '<button onclick="this.closest(\'.zmodal-overlay\').remove()" style="padding:12px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);font-size:14px;font-weight:600;cursor:pointer;font-family:inherit">No costs</button>'+
        '<button onclick="this.closest(\'.zmodal-overlay\').remove();openExpenseForJob('+_jid+','+_cid+')" style="padding:12px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">Log expenses →</button>'+
      '</div>';
    expOv.appendChild(expBox);
    document.body.appendChild(expOv);
    expOv.addEventListener('click',e=>{if(e.target===expOv)expOv.remove();});
  },600);
  if(S.reviewUrl){
    setTimeout(()=>showReviewRequestPrompt(j.client_id),800);
  }
  // saveAll() above only SCHEDULES a debounced cloud write (2s timer), every UI
  // reaction (scorecard, expense prompt, review prompt) is scheduled unblocked above,
  // so this await only delays THIS function's own completion, not any visible UI.
  // Force + await the write now so the job's completion_date (and its mirror onto
  // the bid) are confirmed in the cloud, not merely scheduled (same fire-and-forget
  // gap fixed in _sendCOToHub / sendGenericProposal).
  try{await _flushSaveNow();}catch(_e){}
}
function confirmMarkComplete(jobId){confirmJobDone(jobId);}

// Post-job debrief, shown when marking job complete (only if the linked bid
// has scope hours tracked; jobs with no roomScopeMap skip straight to complete)
function showJobDebrief(jobId){
  const job=jobs.find(j=>j.id===jobId);if(!job)return;
  const bid=bids.find(b=>b.id===job.bid_id);
  const roomScope=bid?.roomScopeMap||{};
  const scopeRooms=Object.entries(roomScope).filter(([r,sc])=>Object.values(sc).some(e=>e&&e.active));
  if(!scopeRooms.length){confirmMarkComplete(jobId);return;}
  const ov=document.createElement('div');ov.className='zmodal-overlay';
  const box=document.createElement('div');box.className='zmodal';
  box.style.maxHeight='88vh';box.style.overflowY='auto';
  let debriefRows='';
  scopeRooms.forEach(([room,sc])=>{
    const items=SCOPE_ITEMS.filter(s=>sc[s.id]&&sc[s.id].active);
    if(!items.length)return;
    debriefRows+=`<div style="margin-bottom:12px">
      <div style="font-size:11px;font-weight:800;color:var(--text3);text-transform:uppercase;margin-bottom:6px">${escHtml(room)}</div>
      ${items.map(s=>`<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border2)">
        <div style="font-size:13px;flex:1">${s.icon?svgIcon(s.icon):''} ${s.label}</div>
        <input type="number" min="0" step="0.25" placeholder="hrs" inputmode="decimal"
          data-room="${encodeURIComponent(room)}" data-scope="${s.id}"
          style="width:64px;padding:5px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);font-size:13px;text-align:center">
      </div>`).join('')}
    </div>`;
  });
  box.innerHTML=
    `<div style="font-size:17px;font-weight:800;margin-bottom:4px">How'd the job go?</div>
    <div style="font-size:12px;color:var(--text3);margin-bottom:14px;line-height:1.6">Optional: enter actual hours for each task. Over time this builds your personal benchmarks so future estimates get sharper. Skip anything you didn't track.</div>
    ${debriefRows}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px">
      <button onclick="this.closest('.zmodal-overlay').remove();confirmMarkComplete(${jobId})"
        style="padding:12px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);font-size:14px;font-weight:600;cursor:pointer;font-family:inherit">Skip</button>
      <button onclick="saveDebriefAndComplete(${jobId},this)"
        style="padding:12px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">Save & complete ✓</button>
    </div>`;
  ov.appendChild(box);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov){ov.remove();confirmMarkComplete(jobId);}});
  // Pre-fill hours from clock entries
  const breakdown=getJobScopeBreakdown(jobId);
  if(Object.keys(breakdown).length){
    box.querySelectorAll('input[data-scope]').forEach(inp=>{
      const sid=inp.dataset.scope;
      const mins=breakdown[sid]||0;
      if(mins>0&&!inp.value){
        inp.value=Math.round(mins/60*4)/4; // round to nearest 0.25
      }
    });
  }
}

function saveDebriefAndComplete(jobId,btn){
  const box=btn.closest('.zmodal');
  const inputs=box.querySelectorAll('input[data-room][data-scope]');
  let totalActualHrs=0;
  inputs.forEach(inp=>{
    const room=decodeURIComponent(inp.dataset.room);
    const scopeId=inp.dataset.scope;
    const hrs=parseFloat(inp.value)||0;
    if(!hrs)return;
    totalActualHrs+=hrs;
    if(!S.scopeHistory)S.scopeHistory={};
    if(!S.scopeHistory[scopeId])S.scopeHistory[scopeId]=[];
    S.scopeHistory[scopeId].push({hrs,ts:Date.now()});
    if(S.scopeHistory[scopeId].length>20)S.scopeHistory[scopeId]=S.scopeHistory[scopeId].slice(-20);
  });
  if(totalActualHrs>0){const j=jobs.find(x=>x.id===jobId);if(j)j.actualHours=Math.round(totalActualHrs*10)/10;}
  saveAll();
  // Upload actual hours to crowdsourced benchmark pool
  const _debJob=jobs.find(x=>x.id===jobId);
  const _debBid=_debJob?.bid_id?bids.find(b=>b.id===_debJob.bid_id):null;
  const _debTrade=_debBid?.trade_type||'painting';
  const _benchRows=[];
  inputs.forEach(inp=>{
    const scopeId=inp.dataset.scope;
    const hrs=parseFloat(inp.value)||0;
    if(hrs>0&&_user?.id)_benchRows.push({user_id:_user.id,scope_id:scopeId,trade:_debTrade,actual_hrs:hrs});
  });
  if(typeof _submitScopeBenchmarks==='function')_submitScopeBenchmarks(_benchRows);
  btn.closest('.zmodal-overlay').remove();
  confirmMarkComplete(jobId);
}
function showReviewRequestPrompt(clientId){
  const c=getClientById(clientId);if(!c)return;
  const firstName=c.name.split(' ')[0];
  const reviewUrl=S.reviewUrl||'';
  const msg='Hi '+firstName+', thank you so much for choosing '+((S.bname||'us'))+', it was a pleasure working with you! If you have a moment, we\'d really appreciate a quick Google review: '+reviewUrl;
  const overlay=document.createElement('div');overlay.className='zmodal-overlay';
  const box=document.createElement('div');box.className='zmodal';
  box.innerHTML=
    '<div style="text-align:center;font-size:22px;margin-bottom:8px">'+svgIcon('⭐',{size:22})+'</div>'+
    '<div class="zmodal-title" style="text-align:center">Request a review?</div>'+
    '<div style="font-size:13px;color:var(--text2);margin-bottom:12px;line-height:1.5">Send '+firstName+' a text asking for a Google review while the job is fresh.</div>'+
    '<textarea id="review-msg-text" style="width:100%;min-height:90px;font-size:12px;padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);font-family:inherit;resize:none;box-sizing:border-box">'+escHtml(msg)+'</textarea>'+
    '<div class="zmodal-btns" style="gap:8px;margin-top:12px">'+
      '<button onclick="this.closest(\'.zmodal-overlay\').remove()" style="padding:11px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;flex:1">Skip</button>'+
      '<button onclick="_sendReviewRequest(\''+c.phone+'\');this.closest(\'.zmodal-overlay\').remove()" style="padding:11px;border-radius:var(--r);border:none;background:#FFC107;color:#1a1a1a;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit;flex:1">'+svgIcon('⭐')+' Send text</button>'+
    '</div>';
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});
}
function _sendReviewRequest(phone){
  const msg=document.getElementById('review-msg-text')?.value||'';
  if(!phone||!msg)return;
  window.location.href='sms:'+phone.replace(/\D/g,'')+'&body='+encodeURIComponent(msg);
}

let jobFilter='all';
