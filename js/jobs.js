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
        '<span style="font-size:18px;flex-shrink:0">'+s.icon+'</span>'+
        '<span style="font-weight:600;flex:1">'+escHtml(s.label)+'</span>'+
        (logged>0?'<span style="font-size:11px;color:var(--text3)">'+_fmtMin(logged)+'</span>':'')+
      '</button>';
    }
    rows+='<button onclick="_clockAddTask('+jobId+')" '+
      'style="display:flex;align-items:center;gap:10px;width:100%;padding:11px 16px;border:none;background:none;border-bottom:1px solid var(--border);text-align:left;font-family:inherit;cursor:pointer;font-size:13px;color:var(--text3)">'+
      '<span style="font-size:16px">➕</span><span>Add task not in estimate…</span>'+
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
      '<div style="padding:12px 16px">'+
        '<button onclick="_markJobComplete('+jobId+')" style="width:100%;padding:13px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;color:var(--text)">🏁 Mark job complete</button>'+
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
      '<span style="font-size:18px">'+s.icon+'</span><span style="font-weight:600">'+escHtml(s.label)+'</span>'+
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
  _activeTimer={jobId,jobName:j.name,clientName:c?c.name:j.name,scopeId:scopeId||null,scopeLabel:scopeLabel||null,startTime:Date.now(),timerInterval:null};
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
  const scopeId=_activeTimer.scopeId;
  const scopeLabel=_activeTimer.scopeLabel;
  if(saveEntry!==false){
    timeEntries.push({id:Date.now(),job_id:jobId,date:todayKey(),start_time:new Date(_activeTimer.startTime).toISOString(),end_time:new Date().toISOString(),minutes,scope_id:scopeId,scope_label:scopeLabel});
    const j=jobs.find(x=>x.id===jobId);
    if(j)j.actualHours=Math.round(((j.actualHours||0)+minutes/60)*10)/10;
    saveAll();
    if(!silent){
      const label=scopeLabel?scopeLabel+' — '+jobName:jobName;
      showToast(_fmtMin(minutes)+' logged · '+label,'⏱');
    }
  }
  _activeTimer=null;
  hideClockBanner();
  renderJobsPage&&renderJobsPage();
  renderDash&&setTimeout(renderDash,300);
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
}

function showClockBanner(){
  const b=document.getElementById('clock-banner');if(!b)return;
  const jn=document.getElementById('clock-banner-job');
  if(jn)jn.textContent=_activeTimer?_activeTimer.clientName:'';
  const bt=document.getElementById('clock-banner-time');
  if(bt)bt.textContent=(_activeTimer&&_activeTimer.scopeLabel?_activeTimer.scopeLabel+' · ':'')+'0:00';
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
        '<div style="font-size:13px"><span style="margin-right:6px">'+sc.icon+'</span>'+sc.label+'</div>'+
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

// ── Nearby job detection (home-page smart clock-in) ──────────────────────────
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
async function checkNearbyJob(){
  if(!navigator.geolocation||!_supaUser)return;
  geoIfGranted(async pos=>{
    const{latitude:myLat,longitude:myLon}=pos.coords;
    const activeJobs=jobs.filter(j=>!j.completion_date&&j.status!=='done'&&j.status!=='canceled');
    for(const j of activeJobs){
      const bid=j.bid_id?bids.find(b=>b.id===j.bid_id):null;
      if(bid&&bid.status!=='Closed Won')continue;
      const c=bid?getClientById(bid.client_id):getClientById(j.client_id);
      if(!c?.addr)continue;
      const coords=await _geocodeAddr(c.addr);
      if(!coords)continue;
      const km=_haversineKm(myLat,myLon,coords.lat,coords.lon);
      if(km<0.5){_nearbyJob={jobId:j.id,jobName:j.name,clientName:c.name,addr:c.addr.split(',')[0]};renderDash&&renderDash();return;}
    }
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
  const msg='Hi '+firstName+'! This is '+bname+' reminding you of your painting proposal '+timeStr+'. Looking forward to seeing you. See you soon! '+(bphone?'— '+bphone:'');
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


function buildScopeGrid(roomName){
  const el=document.getElementById('est-scope-grid')||document.getElementById('surf-scope-first-grid');
  if(!el)return;
  _currentScopeRoom=roomName||'';
  // Get room sqft estimate for auto-price preview
  const roomSqFt=roomName?estSurfaces.filter(s=>cleanRoomName(s.room)===roomName&&
    (s.type==='walls'||s.type==='ceiling')).reduce((sum,s)=>sum+(s.qty||0),0):0;
  el.innerHTML=SCOPE_ITEMS.map(s=>{
    const isOn=roomName?roomScopeOn(roomName,s.id):!!scopeActiveMap[s.id];
    const roomAttr=roomName?(' data-room="'+encodeURIComponent(roomName)+'"'):'';
    const clickHandler=roomName
      ?'onclick="toggleScopeRoom(\''+s.id+'\',decodeURIComponent(this.dataset.room))"'
      :'onclick="toggleScope(\''+s.id+'\')"';
    // Auto-price preview
    const estCost=roomName?(()=>{
      const roomSqFt=estSurfaces.filter(sf=>cleanRoomName(sf.room)===roomName&&
        ['walls','ceiling','ext_walls','deck'].includes(sf.type)).reduce((sum,sf)=>sum+(sf.qty||0),0);
      if(!roomSqFt&&!s.flatRate)return 0;
      return Math.round(((s.ratePerSqFt||0)*roomSqFt+(s.flatRate||0))*100)/100;
    })():s.flatRate||0;
    const priceTag=estCost>0?'<span style="font-size:10px;font-weight:700;color:var(--green-mid);margin-left:auto;white-space:nowrap">+$'+estCost+'</span>':'';
    return '<div class="stog'+(isOn?' on':'')+'" id="est-st-'+s.id+'" '+clickHandler+roomAttr+' style="align-items:flex-start">'+
      '<input type="checkbox" id="est-sc-'+s.id+'" style="display:none"'+(isOn?' checked':'')+'>'+
      '<div class="sdot" style="margin-top:2px"></div>'+
      '<div style="flex:1;min-width:0">'+
        '<div style="display:flex;align-items:center;gap:4px">'+
          '<span class="slabel">'+(s.icon||'')+'  '+s.label+'</span>'+
          priceTag+
        '</div>'+
        '<span style="display:block;font-size:10px;color:var(--text3);font-weight:400;margin-top:1px;line-height:1.4">'+s.hint+'</span>'+
      '</div></div>';
  }).join('');
}
function toggleScopeRoom(id, roomName){
  const wasOn=roomScopeOn(roomName,id);
  const nowOn=!wasOn;
  const cb=document.getElementById('est-sc-'+id);
  const tog=document.getElementById('est-st-'+id);
  if(!nowOn){
    if(roomScopeMap[roomName])delete roomScopeMap[roomName][id];
    if(cb)cb.checked=false;if(tog)tog.classList.remove('on');
  } else {
    if(!roomScopeMap[roomName])roomScopeMap[roomName]={};
    roomScopeMap[roomName][id]={active:true};
    if(cb)cb.checked=true;if(tog)tog.classList.add('on');
  }
  saveEstFullDraft();
  renderEstRunning();
}
function _saveScopeHoursRoom(id,roomName){
  const hrs=parseFloat(document.getElementById('scope-hrs-popup')?.value)||0;
  const rate=parseFloat(document.getElementById('scope-rate-popup')?.value)||45;
  if(hrs>0){
    setRoomScope(roomName,id,true,hrs,rate);
    const badge=document.getElementById('scope-hrs-badge-'+id);
    if(badge){badge.innerHTML=hrs+'h<br>$'+rate+'/hr';badge.style.display='';}
    const tog=document.getElementById('est-st-'+id);if(tog)tog.classList.add('on');
    const cb=document.getElementById('est-sc-'+id);if(cb)cb.checked=true;
  } else {
    if(roomScopeMap[roomName])delete roomScopeMap[roomName][id];
    const cb=document.getElementById('est-sc-'+id);const tog=document.getElementById('est-st-'+id);
    if(cb)cb.checked=false;if(tog)tog.classList.remove('on');
    const badge=document.getElementById('scope-hrs-badge-'+id);
    if(badge){badge.textContent='';badge.style.display='none';}
  }
  closeTopModal();renderEstRunning&&renderEstRunning();saveEstFullDraft();
}
function _cancelScopeHoursRoom(id,roomName){
  if(!roomScopeOn(roomName,id)){
    const cb=document.getElementById('est-sc-'+id);const tog=document.getElementById('est-st-'+id);
    if(cb)cb.checked=false;if(tog)tog.classList.remove('on');
  }
  closeTopModal();
}
function toggleScope(id,force){
  const wasOn=!!scopeActiveMap[id];
  const nowOn=force!==undefined?!!force:!wasOn;
  scopeActiveMap[id]=nowOn;
  // Sync DOM if grid is rendered
  const cb=document.getElementById('est-sc-'+id);
  const tog=document.getElementById('est-st-'+id);
  if(cb)cb.checked=nowOn;
  if(tog)tog.classList.toggle('on',nowOn);
  if(nowOn&&!wasOn&&force===undefined){
    const sc=SCOPE_ITEMS.find(x=>x.id===id);
    promptScopeHours(id,sc?sc.label:id);
  } else if(!nowOn){
    delete scopeHrsStore[id];
    const badge=document.getElementById('scope-hrs-badge-'+id);
    if(badge){badge.textContent='';badge.style.display='none';}
  }
  checkStep2Ready();saveEstFullDraft();
}
function promptScopeHours(id,label){
  const existing=scopeHrsStore[id]||{};
  const existHrs=typeof existing==='object'?existing.hrs||'':existing||'';
  const sc=SCOPE_ITEMS.find(x=>x.id===id);
  const defaultRate=parseFloat(document.getElementById(sc?sc.rateKey:'')?.value)||sc?.defaultRate||45;
  const existRate=typeof existing==='object'&&existing.rate?existing.rate:defaultRate;
  const overlay=document.createElement('div');overlay.className='zmodal-overlay';
  const box=document.createElement('div');box.className='zmodal';
  box.innerHTML=
    '<div style="font-size:18px;font-weight:800;margin-bottom:2px">'+label+'</div>'+
    '<div style="font-size:11px;color:var(--text3);margin-bottom:14px">Set hours and rate for this job</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">'+
      '<div><label style="font-size:11px;font-weight:700;color:var(--text3);display:block;margin-bottom:4px">Hours</label>'+
        '<input type="number" id="scope-hrs-popup" value="'+existHrs+'" min="0" step="0.5" placeholder="0.0" inputmode="decimal"'+
          ' style="font-size:28px;font-weight:700;padding:12px;border-radius:var(--r);border:2px solid var(--blue);background:var(--bg2);color:var(--text);width:100%;box-sizing:border-box;text-align:center"'+
          ' oninput="_syncScopePopupHint()"></div>'+
      '<div><label style="font-size:11px;font-weight:700;color:var(--text3);display:block;margin-bottom:4px">Rate ($/hr)</label>'+
        '<input type="number" id="scope-rate-popup" value="'+existRate+'" min="0" step="5" placeholder="45" inputmode="decimal"'+
          ' style="font-size:28px;font-weight:700;padding:12px;border-radius:var(--r);border:2px solid var(--green);background:var(--bg2);color:var(--text);width:100%;box-sizing:border-box;text-align:center"'+
          ' oninput="_syncScopePopupHint()"></div>'+
    '</div>'+
    '<div id="scope-popup-hint" style="font-size:13px;font-weight:700;color:var(--green-mid);text-align:center;margin-bottom:14px;min-height:20px"></div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'+
      '<button id="scope-cancel-btn" style="padding:12px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);font-size:14px;font-weight:600;cursor:pointer;font-family:inherit">Cancel</button>'+
      '<button id="scope-save-btn" style="padding:12px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">Save ✓</button>'+
    '</div>';
  overlay.appendChild(box);document.body.appendChild(overlay);
  overlay.addEventListener('click',e=>{if(e.target===overlay)_cancelScopeHours(id);});
  box.querySelector('#scope-cancel-btn').onclick=()=>_cancelScopeHours(id);
  box.querySelector('#scope-save-btn').onclick=()=>_saveScopeHours(id);
  setTimeout(()=>{
    _syncScopePopupHint();
    const inp=document.getElementById('scope-hrs-popup');if(inp){inp.focus();inp.select();}
  },80);
}
function _syncScopePopupHint(){
  const hrsEl=document.getElementById('scope-hrs-popup');
  const rateEl=document.getElementById('scope-rate-popup');
  const hint=document.getElementById('scope-popup-hint');
  if(!hint)return;
  const hrs=parseFloat(hrsEl?.value)||0;
  const rate=parseFloat(rateEl?.value)||0;
  if(hrs>0&&rate>0){
    hint.textContent=hrs+'h × $'+rate+'/hr = $'+Math.round(hrs*rate);
    hint.style.color='var(--green-mid)';
  } else {
    hint.textContent='';
  }
}
function _saveScopeHours(id){
  const hrsEl=document.getElementById('scope-hrs-popup');
  const rateEl=document.getElementById('scope-rate-popup');
  const hrs=parseFloat(hrsEl?hrsEl.value:0)||0;
  const rate=parseFloat(rateEl?rateEl.value:0)||0;
  const cost=hrs>0&&rate>0?Math.round(hrs*rate):0;
  if(hrs>0){
    scopeHrsStore[id]={hrs,rate,cost};
    const badge=document.getElementById('scope-hrs-badge-'+id);
    if(badge){badge.innerHTML=hrs+'h<br>$'+rate+'/hr';badge.style.display='';}
  } else {
    delete scopeHrsStore[id];
    const cb=document.getElementById('est-sc-'+id);const tog=document.getElementById('est-st-'+id);
    if(cb)cb.checked=false;if(tog)tog.classList.remove('on');
    const badge=document.getElementById('scope-hrs-badge-'+id);
    if(badge){badge.textContent='';badge.style.display='none';}
  }
  closeTopModal();renderEstRunning&&renderEstRunning();checkStep2Ready();saveEstFullDraft();
}
function _cancelScopeHours(id){
  if(!scopeHrsStore[id]){
    const cb=document.getElementById('est-sc-'+id);const tog=document.getElementById('est-st-'+id);
    if(cb)cb.checked=false;if(tog)tog.classList.remove('on');
  }
  closeTopModal();
}
function scopeOn(id){return !!scopeActiveMap[id];}
function roomScopeOn(roomName,id){return !!(roomScopeMap[roomName]&&roomScopeMap[roomName][id]&&roomScopeMap[roomName][id].active);}
function setRoomScope(roomName,id,active,hrs,rate){
  if(!roomScopeMap[roomName])roomScopeMap[roomName]={};
  if(!active){delete roomScopeMap[roomName][id];return;}
  const cost=hrs&&rate?Math.round(hrs*rate*100)/100:0;
  roomScopeMap[roomName][id]={active:true,hrs:hrs||0,rate:rate||45,cost};
}
let surfJobType='interior', surfColor='', surfRoom='';
let _currentScopeRoom='';  // room name currently shown in scope grid

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
  return{stage:'signed',label:'Signed — schedule job',color:'var(--blue)',priority:3,jobs:bidJobs};
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
  if(!filtered.length){el.innerHTML='<div class="empty"><div class="em-emoji">📋</div><h3>No '+jobFilter+' jobs right now</h3><p><button class="btn btn-p" onclick="goPg(\'pg-schedule\')">Schedule a job</button></p></div>';return;}
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
        clockBtn='<button onclick="clockOut();event.stopPropagation()" class="btn btn-sm" style="border-radius:20px;border-color:#E97B00;background:#FFF3E0;color:#E97B00">⏹ '+_ts+'</button>';
      }else{
        clockBtn='<button onclick="openClockInSheet('+nextJobId+');event.stopPropagation()" class="btn btn-sm" style="border-radius:20px">▶ Clock in</button>';
      }
    }
    const hasTasks=b.roomScopeMap&&Object.values(b.roomScopeMap).some(r=>Object.values(r).some(v=>v&&v.active));
    const checklistBtn=hasTasks?'<button onclick="openJobChecklist('+b.id+');event.stopPropagation()" class="btn btn-sm" style="border-radius:20px">📋 Checklist</button>':'';
    const btnRow=(primaryBtn||clockBtn||checklistBtn)?'<div class="tf-acts">'+(primaryBtn||'')+(clockBtn||'')+(checklistBtn||'')+'</div>':'';
    const amtColor=balance>0.01?'var(--c-red)':paid>0?'var(--c-green)':'var(--text)';
    const amtSub=balance>0.01?'<div style="font-size:10px;font-weight:700;color:var(--c-red);margin-top:1px">'+fmt(balance)+' due</div>':paid>0?'<div style="font-size:10px;font-weight:600;color:var(--c-green);margin-top:1px">Paid ✓</div>':'';
    return '<div class="tf-card" onclick="openJobSheet('+c.id+')">'+
      '<div class="tf-icon '+(st.stage==='active'?'t-green':st.stage==='balance_due'?'t-red':'t-blue')+'" style="font-size:14px">'+
        (st.stage==='active'?'🔨':st.stage==='balance_due'?'💰':st.stage==='signed'?'✍️':'📅')+
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
    return '<div class="kcol" data-status="'+col.id+'">'+
      '<div class="kcol-hd"><span>'+col.label+'</span><span class="k-count">'+col.items.length+'</span></div>'+
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
          return '<div class="k-card" onclick="openJobSheet('+c.id+')" style="margin-bottom:8px">'+
            '<div class="k-name">'+escHtml(c.name)+'</div>'+
            '<div class="k-sub">'+escHtml(addrShort)+'</div>'+
            '<div class="k-foot">'+
              '<span class="bdg-soft '+chipCls+'" style="font-size:10px">'+chipLabel+'</span>'+
              '<span class="k-amt">'+amt+'</span>'+
            '</div>'+
          '</div>';
        }).join(''))+
    '</div>';
  }).join('')+'</div>';
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
    '<div style="font-size:17px;font-weight:800">📋 Job Checklist</div>'+
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
        '<div style="font-size:14px;font-weight:600;color:var(--text);'+(isDone?'text-decoration:line-through;opacity:.5':'')+'">'+t.icon+' '+t.label+'</div>'+
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
  const total=wonBids.reduce((s,b)=>s+b.amount,0);
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
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">'+
      '<div style="min-width:0">'+
        '<div style="font-size:19px;font-weight:800;line-height:1.1">'+c.name+'</div>'+
        (c.addr?'<div style="font-size:12px;opacity:.8;margin-top:3px">📍 '+c.addr+'</div>':'')+
      '</div>'+
      '<button onclick="this.closest(\'.zmodal-overlay\').remove()" style="background:rgba(255,255,255,.2);border:none;color:#fff;font-size:18px;cursor:pointer;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;flex-shrink:0;line-height:1">✕</button>'+
    '</div>'+
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:14px;flex-wrap:wrap;gap:8px">'+
      '<span style="font-size:11px;font-weight:800;padding:4px 10px;border-radius:20px;background:rgba(255,255,255,.2);color:#fff">'+st.label+'</span>'+
      '<div style="display:flex;gap:8px">'+
        (c.phone?'<a href="tel:'+c.phone.replace(/\D/g,'')+'" style="background:rgba(255,255,255,.2);color:#fff;text-decoration:none;font-size:12px;font-weight:700;padding:5px 12px;border-radius:20px" onclick="event.stopPropagation()">📞 Call</a>':'')+
        (c.addr?'<button onclick="openMapsForClient('+clientId+');event.stopPropagation()" style="background:rgba(255,255,255,.2);border:none;color:#fff;font-size:12px;font-weight:700;padding:5px 12px;border-radius:20px;cursor:pointer;font-family:inherit">🗺️ Drive</button>':'')+
        (c.phone?'<button onclick="sendOMWText('+clientId+');event.stopPropagation()" style="background:rgba(255,200,0,.3);border:none;color:#fff;font-size:12px;font-weight:700;padding:5px 12px;border-radius:20px;cursor:pointer;font-family:inherit">🚗 OMW</button>':'')+
        '<button onclick="this.closest(\'.zmodal-overlay\').remove();openClientDetail('+clientId+')" style="background:rgba(255,255,255,.2);border:none;color:#fff;font-size:12px;font-weight:700;padding:5px 12px;border-radius:20px;cursor:pointer;font-family:inherit">Full record →</button>'+
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
        '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:10px">💰 Payment</div>'+
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
        '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:8px">📅 Schedule</div>'+
        '<div style="background:var(--blue-lt);border-radius:var(--r);padding:10px 14px;display:flex;justify-content:space-between;align-items:center;gap:8px">'+
          '<div>'+
            '<div style="font-size:14px;font-weight:700;color:var(--blue-dk)">'+dt+(nextJob.time?' · '+fmtTime(nextJob.time):'')+'</div>'+
            '<div style="font-size:11px;color:var(--blue);margin-top:2px">'+(nextJob.days||1)+' day'+(nextJob.days!==1?'s':'')+' est.</div>'+
          '</div>'+
          '<div style="display:flex;gap:6px;flex-shrink:0">'+
            '<button onclick="openPushBackModal('+nextJob.id+','+clientId+',this.closest(\'.zmodal-overlay\'))" style="padding:7px 12px;border-radius:var(--r);border:1px solid var(--amber);background:var(--amber-lt);color:#92400E;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">📅 Push back</button>'+
            '<button onclick="this.closest(\'.zmodal-overlay\').remove();goPg(\'pg-schedule\')" style="padding:7px 12px;border-radius:var(--r);border:1px solid var(--blue);background:#fff;color:var(--blue-dk);font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">Reschedule</button>'+
          '</div>'+
        '</div>'+
      '</div>';
  } else if(bid&&st.stage==='signed'){
    schedHtml=
      '<div style="padding:14px 20px;border-bottom:1px solid var(--border)">'+
        '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:8px">📅 Schedule</div>'+
        '<div style="background:var(--amber-lt);border-radius:var(--r);padding:10px 14px;display:flex;justify-content:space-between;align-items:center">'+
          '<div style="font-size:13px;font-weight:600;color:#856404">Signed — not yet scheduled</div>'+
          '<button onclick="this.closest(\'.zmodal-overlay\').remove();schedFromBid('+bid.id+')" style="padding:7px 12px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">Schedule →</button>'+
        '</div>'+
      '</div>';
  }

  // ── Materials / supply list + scope — one section per won bid ─
  function _buildBidMaterialsHtml(b,showBidLabel){
    if(!b||!b.surfaces||!b.surfaces.length)return'';
    const allSwProds=Object.values(SW_PRODUCTS).flat();
    const _bidScope=b.roomScopeMap||{};
    const _bidCoats=Object.values(_bidScope).some(r=>r.twocoat?.active)?2:1;
    const orderMap={};
    b.surfaces.forEach(s=>{
      if(!s.qty)return;
      const t=SURF_TYPES.find(x=>x.v===s.type);if(!t||t.unit!=='sq ft')return;
      const spec=(s.room||'').indexOf(' — ')>-1?(s.room||'').split(' — ').slice(1).join(' — '):'';
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
        '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3)">📦 Materials</div>'+
        '<button onclick="this.closest(\'.zmodal-overlay\').remove();showSupplyList('+b.id+')" style="padding:5px 12px;border-radius:20px;border:none;background:#FFF0E8;color:#854F0B;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit">Full supply list →</button>'+
      '</div>'+
      (bidLabel?'<div style="font-size:11px;color:var(--text3);margin-bottom:8px">📍 '+escHtml(bidLabel)+'</div>':'')+
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
      '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:'+(bidLabel?'4px':'8px')+'">🔧 Scope of work</div>'+
      (bidLabel?'<div style="font-size:11px;color:var(--text3);margin-bottom:8px">📍 '+escHtml(bidLabel)+'</div>':'')+
      '<div style="display:flex;flex-wrap:wrap;gap:5px">'+
        allScope.map(s=>'<span style="font-size:11px;background:var(--bg2);border:1px solid var(--border2);border-radius:20px;padding:3px 9px;color:var(--text2)">'+s.icon+' '+s.label+'</span>').join('')+
      '</div></div>';
  }
  const _multiWon=wonBids.length>1;
  let supplyHtml=wonBids.map(b=>_buildBidMaterialsHtml(b,_multiWon)).join('');
  let scopeHtml=wonBids.map(b=>_buildBidScopeHtml(b,_multiWon)).join('');

  // ── Before / After photos ────────────────────────────────────
  const jobForPhotos=allJobs.sort((a,b)=>b.start.localeCompare(a.start))[0];
  const photoJobId=jobForPhotos?jobForPhotos.id:null;
  const existingPhotos=jobForPhotos?(jobForPhotos.photos||[]):[];
  const beforePhotos=existingPhotos.filter(p=>p.type==='before');
  const afterPhotos=existingPhotos.filter(p=>p.type==='after');
  let photosHtml='';
  if(photoJobId){
    const renderThumb=(p,idx,type)=>'<div style="position:relative;width:80px;height:80px;flex-shrink:0">'+
      '<img src="'+p.data+'" style="width:80px;height:80px;object-fit:cover;border-radius:var(--r);border:2px solid '+(type==='before'?'var(--amber)':'var(--green-mid)')+'">'+
      '<button onclick="deleteJobPhoto('+photoJobId+','+idx+',\''+type+'\');this.closest(\'.zmodal-overlay\').remove();openJobSheet('+clientId+')" '+
        'style="position:absolute;top:2px;right:2px;background:rgba(0,0,0,.6);border:none;color:#fff;border-radius:50%;width:18px;height:18px;font-size:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;line-height:1">✕</button>'+
    '</div>';
    const shareBtn=beforePhotos.length&&afterPhotos.length
      ?'<button onclick="_shareBeforeAfterCard('+clientId+')" style="display:inline-flex;align-items:center;gap:5px;margin-top:10px;padding:8px 14px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;width:100%;justify-content:center">📤 Share before/after card</button>'
      :'';
    photosHtml=
      '<div style="padding:14px 20px;border-bottom:1px solid var(--border)">'+
        '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:10px">📸 Job photos</div>'+
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
          '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3)">📊 Actual costs</div>'+
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
          '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3)">📊 Job expenses</div>'+
          '<button onclick="this.closest(\'.zmodal-overlay\').remove();showQuickExpenseModal('+clientId+',null)" style="padding:5px 12px;border-radius:20px;border:none;background:var(--bg2);color:var(--text3);font-size:11px;font-weight:700;cursor:pointer;font-family:inherit">+ Log cost</button>'+
        '</div>'+
        '<div style="font-size:14px;font-weight:800;color:#A32D2D">'+fmt(totalActual)+' logged</div>'+
      '</div>';
  }

  // ── Subcontractors on this job ───────────────────────────────
  const subsJob=latestJob||allJobs.filter(j=>j.status!=='canceled').sort((a,b)=>b.start.localeCompare(a.start))[0];
  const subsJobId=subsJob?subsJob.id:null;
  const jobSubs=(subsJob&&subsJob.subs)||[];
  const subRoster=S.subcontractors||[];
  let subsHtml='';
  if(subsJobId){
    const totalOwed=jobSubs.filter(s=>!s.paid).reduce((s,x)=>s+(x.amount||0),0);
    subsHtml=
      '<div style="padding:14px 20px;border-bottom:1px solid var(--border)">'+
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:'+(jobSubs.length?'10px':'0')+'">'+
          '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3)">🔨 Subcontractors'+(totalOwed>0?' <span style="font-size:10px;font-weight:700;background:#FEE8E8;color:#991B1B;padding:1px 7px;border-radius:8px">'+fmt(totalOwed)+' owed</span>':'')+'</div>'+
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
  const latestJob=allJobs.filter(j=>j.status!=='canceled').sort((a,b)=>b.start.localeCompare(a.start))[0];
  const visitNotesJobId=latestJob?latestJob.id:null;
  const visitNotesVal=latestJob?(latestJob.visitNotes||''):'';
  let visitNotesHtml='';
  if(visitNotesJobId){
    visitNotesHtml=
      '<div style="padding:14px 20px;border-bottom:1px solid var(--border)">'+
        '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:8px">📝 Job notes</div>'+
        '<textarea id="visit-notes-ta" placeholder="Site conditions, instructions for crew, client requests, punch list..." '+
          'style="width:100%;min-height:75px;font-size:13px;padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);font-family:inherit;resize:none;box-sizing:border-box;line-height:1.5" '+
          'onblur="saveVisitNotes('+visitNotesJobId+',this.value)">'+visitNotesVal+'</textarea>'+
        '<div style="font-size:10px;color:var(--text3);margin-top:4px">Auto-saves when you tap out</div>'+
      '</div>';
  }

  // ── Job actions ──────────────────────────────────────────────
  const jobActions=getClientJobs(clientId).filter(j=>j.eventType!=='estimate'&&j.status==='active');
  let actionsHtml=
    '<div style="padding:14px 20px">'+
      '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:10px">⚡ Actions</div>'+
      '<div style="display:grid;gap:8px">'+
        (jobActions.length?
          jobActions.map(j=>'<button onclick="this.closest(\'.zmodal-overlay\').remove();markJobDone('+j.id+')" style="padding:12px;border-radius:var(--r);border:none;background:var(--green-mid);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;text-align:left">✓ Mark job complete — '+j.name+'</button>').join('')
        :'')+
        (bid?'<button onclick="this.closest(\'.zmodal-overlay\').remove();showChangeOrderModal('+bid.id+','+clientId+')" style="padding:12px;border-radius:var(--r);border:1.5px solid var(--blue);background:var(--blue-lt);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;color:var(--blue-dk);text-align:left">📋 Change order — adjust scope or price</button>':'')+
        '<button onclick="this.closest(\'.zmodal-overlay\').remove();openClientDetail('+clientId+')" style="padding:12px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;color:var(--text);text-align:left">📋 Full client record & history</button>'+
      '</div>'+
    '</div>';

  // ── Change order history ─────────────────────────────────────
  let coHistoryHtml='';
  const allCOs=wonBids.flatMap(wb=>(wb.changeOrders||[]).map(co=>({...co,bidId:wb.id})));
  if(allCOs.length){
    coHistoryHtml='<div style="padding:14px 20px;border-bottom:1px solid var(--border)">'+
      '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:10px">📋 Change Orders</div>'+
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

  body.innerHTML=payHtml+schedHtml+coHistoryHtml+supplyHtml+scopeHtml+photosHtml+actualCostsHtml+subsHtml+visitNotesHtml+actionsHtml;
  box.appendChild(body);
  ov.appendChild(box);
  ov.onclick=e=>{if(e.target===ov)ov.remove();};
  document.body.appendChild(ov);
}

// ── Before/after shareable card ───────────────────────────────────────────────
async function _shareBeforeAfterCard(clientId){
  const c=getClientById(clientId);
  const allJobs=getClientJobs(clientId).filter(j=>j.eventType!=='estimate'&&j.status!=='canceled');
  const job=allJobs.sort((a,b)=>b.start.localeCompare(a.start))[0];
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
          const{error:upErr}=await _supa.storage.from('gallery').upload(path,blob,{contentType:'image/jpeg',upsert:false});
          if(!upErr){
            const{data:urlData}=_supa.storage.from('gallery').getPublicUrl(path);
            const publicUrl=urlData?.publicUrl||'';
            if(publicUrl){
              photos.push({id:Date.now()+Math.random(),url:publicUrl,type:'before-after',caption:'Before & After',client_id:clientId,client_name:c?c.name:'',uploadedAt:new Date().toISOString()});
              saveAll();
              _uploadClientHub&&_uploadClientHub(clientId).catch(()=>{});
              showToast('Added to client hub','✓');
            }
          }
        }
      }catch(_e){}
      const file=new File([blob],'before-after.jpg',{type:'image/jpeg'});
      if(navigator.share&&navigator.canShare&&navigator.canShare({files:[file]})){
        try{await navigator.share({files:[file],title:biz+' — Before & After',text:(c?c.name+' · ':'')+'Finished job by '+biz});}
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
    ?subs.map((s,i)=>'<option value="'+i+'">'+escHtml(s.name||'Sub')+(s.trade?' ('+s.trade+')':'')+'</option>').join('')
    :'<option value="">— No subs in roster —</option>';
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
      '<button onclick="_saveSubAssignment('+jobId+','+clientId+')" style="padding:11px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">Assign</button>'+
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
  document.getElementById('_asub-ov')?.remove();
  showToast(sub.name+' assigned','✓');
  openJobSheet(clientId);
}
function markSubPaid(jobId,subIdx,clientId){
  const j=jobs.find(x=>x.id===jobId);if(!j||!j.subs||!j.subs[subIdx])return;
  j.subs[subIdx].paid=true;j.subs[subIdx].paidDate=todayKey();
  saveAll();showToast('Marked paid','✓');
  openJobSheet(clientId);
}

// ── Push job date back ────────────────────────────────────────────────────────
function openPushBackModal(jobId,clientId,parentOverlay){
  const j=jobs.find(x=>x.id===jobId);if(!j)return;
  const c=getClientById(clientId);
  const firstName=c?c.name.split(' ')[0]:'there';
  const biz=S.bname||'your contractor';
  const oldDate=parseD(j.start).toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});
  const defaultMsg='Hi '+firstName+', this is '+biz+'. We need to push your job back a bit — we\'ll get you on the schedule as soon as possible and confirm the new date. We\'re sorry for any inconvenience and appreciate your patience!';
  document.getElementById('_pb-modal-ov')?.remove();
  const ov=document.createElement('div');ov.id='_pb-modal-ov';ov.className='zmodal-overlay';
  const box=document.createElement('div');box.className='zmodal';
  box.innerHTML=
    '<div style="font-size:17px;font-weight:800;margin-bottom:4px">📅 Push job back</div>'+
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
  const firstName=c.name.split(' ')[0];
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
  const firstName=c.name.split(' ')[0];
  const biz=S.bname||'TradeDesk';
  const msg='Hi '+firstName+', this is '+biz+' — I\'m on my way! I\'ll be there shortly.';
  window.location.href='sms:'+c.phone.replace(/\D/g,'')+'&body='+encodeURIComponent(msg);
}
function addJobPhoto(jobId,input,type){
  const file=input.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    const j=jobs.find(x=>x.id===jobId);if(!j)return;
    if(!j.photos)j.photos=[];
    j.photos.push({type,data:e.target.result,ts:new Date().toISOString()});
    saveAll();
    showToast((type==='before'?'Before':'After')+' photo saved','📸');
  };
  reader.readAsDataURL(file);
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

function deleteJob(jobId){
  const j=jobs.find(x=>x.id===jobId);
  if(!j)return;
  const label=j.eventType==='estimate'?'estimate visit':'job';
  zConfirm('Remove this '+label+' from the calendar?',()=>{
    jobs=jobs.filter(x=>x.id!==jobId);
    saveAll();renderClientDetail();renderCalendar();
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
    '<div style="font-size:13px;color:var(--text3);margin-bottom:14px">'+j.name+'</div>'+
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
            '<input type="number" id="adj-amount" min="0" step="5" placeholder="0" inputmode="decimal"'+
              ' style="font-size:22px;font-weight:700;padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);width:100%;box-sizing:border-box;color:var(--text);text-align:center"'+
              ' oninput="_previewAdjTotal('+jobId+')">'+
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
      '<button onclick="closeTopModal();showJobDebrief('+jobId+')" style="padding:12px;border-radius:var(--r);border:none;background:var(--green);color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit">Complete job ✓</button>'+
    '</div>';
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});
  box._jobId=jobId;
}
let _adjType=null;
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
  const amt=parseFloat(document.getElementById('adj-amount')?.value)||0;
  const preview=document.getElementById('adj-preview');
  if(!preview||!amt)return;
  const newTotal=_adjType==='increase'?bid.amount+amt:Math.max(0,bid.amount-amt);
  const arrow=_adjType==='increase'?'↑':'↓';
  const color=_adjType==='increase'?'var(--blue)':'var(--green-mid)';
  preview.innerHTML='<span style="color:var(--text3)">'+fmt(bid.amount)+'</span> <span style="color:'+color+'">'+arrow+' '+fmt(newTotal)+'</span>';
}
function confirmJobDone(jobId){
  const j=jobs.find(x=>x.id===jobId);if(!j)return;
  const dateStr=document.getElementById('job-done-date')?.value||todayKey();
  if(!dateStr.match(/^\d{4}-\d{2}-\d{2}$/)){zAlert('Enter a valid date.',{title:'Invalid date'});return;}
  const adjFields=document.getElementById('adj-fields');
  const adjOpen=adjFields&&adjFields.style.display!=='none';
  const adjAmt=parseFloat(document.getElementById('adj-amount')?.value||0)||0;
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
  closeTopModal();
  j.status='done';
  j.completion_date=dateStr;
  if(j.bid_id){
    const b=bids.find(x=>x.id===j.bid_id);
    if(b){
      b.completion_date=dateStr;
      if(_adjType&&adjAmt>0){
        const delta=_adjType==='increase'?adjAmt:-adjAmt;
        b.amount=Math.max(0,Math.round((b.amount+delta)*100)/100);
        if(!b.adjustments)b.adjustments=[];
        b.adjustments.push({type:_adjType,amount:adjAmt,reason:adjReason,ts:new Date().toISOString()});
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
  _adjType=null;
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
}
function confirmMarkComplete(jobId){confirmJobDone(jobId);}
function showReviewRequestPrompt(clientId){
  const c=getClientById(clientId);if(!c)return;
  const firstName=c.name.split(' ')[0];
  const reviewUrl=S.reviewUrl||'';
  const msg='Hi '+firstName+', thank you so much for choosing '+((S.bname||'us'))+' — it was a pleasure working with you! If you have a moment, we\'d really appreciate a quick Google review: '+reviewUrl;
  const overlay=document.createElement('div');overlay.className='zmodal-overlay';
  const box=document.createElement('div');box.className='zmodal';
  box.innerHTML=
    '<div style="text-align:center;font-size:22px;margin-bottom:8px">⭐</div>'+
    '<div class="zmodal-title" style="text-align:center">Request a review?</div>'+
    '<div style="font-size:13px;color:var(--text2);margin-bottom:12px;line-height:1.5">Send '+firstName+' a text asking for a Google review while the job is fresh.</div>'+
    '<textarea id="review-msg-text" style="width:100%;min-height:90px;font-size:12px;padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);font-family:inherit;resize:none;box-sizing:border-box">'+msg+'</textarea>'+
    '<div class="zmodal-btns" style="gap:8px;margin-top:12px">'+
      '<button onclick="this.closest(\'.zmodal-overlay\').remove()" style="padding:11px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;flex:1">Skip</button>'+
      '<button onclick="_sendReviewRequest(\''+c.phone+'\');this.closest(\'.zmodal-overlay\').remove()" style="padding:11px;border-radius:var(--r);border:none;background:#FFC107;color:#1a1a1a;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit;flex:1">⭐ Send text</button>'+
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
