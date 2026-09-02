function _showOdometerModal(tasks,hardBlock){
  document.getElementById('_odo-modal-ov')?.remove();
  let taskIdx=0;

  function renderTask(){
    if(taskIdx>=tasks.length){_odoFinish();return;}
    const t=tasks[taskIdx];
    const vLabel=getVehicleLabel(t.veh);
    const isStart=t.type==='start';
    const existing=_vehOdo(t.veh,t.year);
    const otherReading=isStart?existing.end:existing.start;

    // Calculate logged miles for this vehicle+year for context
    const yrStr=String(t.year);
    // deductibleTrips: a crew member's own car is not this truck. Their rows come
    // through with a blank vehicle when nobody picked one, and a blank vehicle
    // matches EVERY truck in the clause below, so without this filter somebody
    // else's personal miles get counted against this odometer.
    const loggedMi=deductibleTrips(mileage).filter(m=>m.date&&m.date.startsWith(yrStr)&&(!m.vehicle||m.vehicle.toLowerCase().includes((t.veh.nickname||t.veh.name||'').split(' ')[0].toLowerCase()))).reduce((s,m)=>s+(m.miles||0),0);

    ov.innerHTML=`
    <div style="background:var(--bg);border-radius:var(--rl);width:100%;max-width:440px;padding:24px 20px 28px;box-sizing:border-box">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
        <div style="width:38px;height:38px;border-radius:50%;background:#dbeafe;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">${svgIcon('🚗',{size:20})}</div>
        <div>
          <div style="font-size:16px;font-weight:800;color:var(--text)">${isStart?(t.midYear?t.year+' Opening Odometer':t.year+' Start Odometer'):'Year-End Odometer'}</div>
          <div style="font-size:12px;color:var(--text3)">${vLabel} · ${isStart?(t.midYear?'First business use, '+t.year:'Jan 1, '+t.year):'Dec 31, '+t.year}</div>
        </div>
      </div>
      <div style="background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:var(--r);padding:10px 12px;margin:14px 0 16px;font-size:12px;color:#1e40af;line-height:1.5">
        <strong>IRS Pub. 463 requires annual odometer records.</strong> ${t.midYear?'You joined mid-year, enter the odometer reading from when you first started using this vehicle for business, or your best Jan 1 estimate. An estimate is far better than no record.':'Recording Jan 1 &amp; Dec 31 readings proves your business-use % and makes your mileage deduction bulletproof, even in a field audit.'}
        ${loggedMi>0?`<div style="margin-top:6px">${svgIcon('📍',{size:12})} You logged <strong>${loggedMi.toFixed(1)} mi</strong> in ${t.year} for this vehicle in TradeDesk.</div>`:''}
        ${otherReading?`<div style="margin-top:4px">${isStart?'Dec 31':'Jan 1'} reading on file: <strong>${otherReading.toLocaleString()} mi</strong></div>`:''}
        ${(()=>{const prevEnd=_vehOdo(t.veh,t.year-1).end||0;return(isStart&&prevEnd&&!existing.start)?`<div style="margin-top:4px">${svgIcon('✅',{size:12})} Carried forward from Dec 31, ${t.year-1}: <strong>${prevEnd.toLocaleString()} mi</strong></div>`:'';})()}
      </div>
      <div style="font-size:13px;font-weight:700;color:var(--text2);margin-bottom:6px">${isStart?(t.midYear?t.year+' opening odometer (best estimate)':'Jan 1, '+t.year+' odometer reading'):'Dec 31, '+t.year+' odometer reading'}</div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <input id="_odo-val" type="number" min="0" inputmode="numeric" placeholder="e.g. 48,250" value="${(()=>{const pv=isStart?(existing.start||_vehOdo(t.veh,t.year-1).end||0):existing.end||0;return pv||'';})()}" style="flex:1;padding:12px 14px;border-radius:var(--r);border:2px solid var(--blue);font-size:20px;font-weight:700;font-family:inherit;background:var(--bg2);color:var(--text);outline:none;box-sizing:border-box">
        <span style="font-size:13px;color:var(--text3);font-weight:600">miles</span>
      </div>
      <div id="_odo-err" style="color:#A32D2D;font-size:12px;min-height:16px;margin-bottom:10px"></div>
      ${tasks.length>1?`<div style="font-size:11px;color:var(--text3);margin-bottom:12px;text-align:center">${taskIdx+1} of ${tasks.length} readings${(()=>{const n=new Set(tasks.map(t=>String(t.veh&&t.veh.id))).size;return n>1?` · ${n} vehicles`:'';})()}</div>`:''}
      <button onclick="_odoSaveStep()" style="width:100%;padding:14px;border-radius:var(--rl);border:none;background:var(--blue);color:#fff;font-size:15px;font-weight:800;cursor:pointer;font-family:inherit;margin-bottom:10px">Save &amp; continue →</button>
      ${hardBlock
        ? `<div style="font-size:11px;color:var(--text3);text-align:center">This record is required for IRS compliance. Enter your best estimate if unsure of the exact number.</div>`
        : `<button onclick="_odoSnooze()" style="width:100%;padding:10px;border:none;background:none;color:var(--text3);font-size:13px;cursor:pointer;font-family:inherit">Remind me in 24 hours (${3-(S._odoSnoozeCount||0)} snoozes left)</button>`
      }
    </div>`;
    setTimeout(()=>document.getElementById('_odo-val')?.focus(),100);
  }

  function _odoSaveStep(){
    const raw=parseFloat(document.getElementById('_odo-val')?.value)||0;
    const err=document.getElementById('_odo-err');
    if(!raw||raw<1){if(err)err.textContent='Enter a valid odometer reading.';return;}
    const t=tasks[taskIdx];
    const existing={..._vehOdo(t.veh,t.year)};
    if(t.type==='start'){
      if(existing.end&&raw>=existing.end){if(err)err.textContent='Start odometer must be less than end odometer ('+existing.end.toLocaleString()+' mi).';return;}
      existing.start=raw;existing.startDate=todayKey();
    } else {
      if(existing.start&&raw<=existing.start){if(err)err.textContent='End odometer must be greater than start odometer ('+existing.start.toLocaleString()+' mi).';return;}
      existing.end=raw;existing.endDate=todayKey();
      // Cross-check: logged miles vs total miles
      const yrStr=String(t.year);
      const totalDriven=raw-(existing.start||0);
      // This is a DEDUCTION path, not a display: bizUse below is what the
      // actual-expense method multiplies the truck's costs by. Crew own-car miles
      // in here inflate the business-use percentage on the owner's vehicle.
      const logged=deductibleTrips(mileage).filter(m=>m.date&&m.date.startsWith(yrStr)).reduce((s,m)=>s+(m.miles||0),0);
      if(totalDriven>0){
        const bizPct=Math.min(100,Math.round(logged/totalDriven*100));
        // Match on the stable row id, not a name slug: renaming the truck used to
        // change its key here and silently drop the business-use write.
        const vehs=getVehicles();const vi=vehs.findIndex(v=>String(v.id)===String(t.veh&&t.veh.id));
        if(vi>=0){vehs[vi].bizUse=bizPct;_setVehicles(vehs);}
        existing.bizUsePct=bizPct;existing.loggedMi=Math.round(logged);existing.totalMi=totalDriven;
        if(logged>totalDriven){existing.mileageFlag=true;}
      }
      // Auto-seed next year's Jan 1 start from this Dec 31 reading, user never has to enter year-start again
      _setVehOdo(t.veh,t.year+1,{start:raw,startDate:todayKey()});
    }
    _setVehOdo(t.veh,t.year,existing);
    S._odoSnoozeCount=0;
    saveAll();_flushSaveNow();
    taskIdx++;
    renderTask();
  }

  window._odoSaveStep=_odoSaveStep;

  // Never open over a user-initiated form modal (quick-expense, agreement,
  // contract, …). Its z-index (99990) floats above the standard modal layer
  // (.zmodal-overlay @ 9999), so opening on top would cover the form's inputs and
  // trap the user mid-task. Skip: it re-prompts on the next boot.
  if(document.querySelector('.zmodal-overlay'))return;

  const ov=document.createElement('div');
  ov.id='_odo-modal-ov';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,'+(hardBlock?'.85':'.6')+');z-index:99990;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box';
  if(!hardBlock)ov.addEventListener('click',e=>{if(e.target===ov)_odoSnooze();});
  document.body.appendChild(ov);
  renderTask();

  // If a user-initiated form modal opens on top of us a beat later (e.g. the user
  // taps "log expense" right after adding a vehicle), step aside rather than
  // floating above and covering its inputs. We re-prompt on the next boot.
  const _odoYieldIv=setInterval(()=>{
    if(!document.getElementById('_odo-modal-ov')){clearInterval(_odoYieldIv);return;}
    if(document.querySelector('.zmodal-overlay')){clearInterval(_odoYieldIv);ov.remove();}
  },150);

  function _odoFinish(){
    clearInterval(_odoYieldIv);
    ov.remove();
    showToast('Odometer records saved, mileage deduction verified ✓','📋');
    // Year-end verdict: with the business-use % now final, tell the contractor
    // which deduction method won for the year they just closed out.
    try{const _vy=tasks&&tasks[0]&&tasks[0].year;if(typeof _vehWinnerAlert==='function')setTimeout(()=>_vehWinnerAlert(_vy),600);}catch(_e){}
  }
}

function _odoSnooze(){
  S._odoSnoozedUntil=Date.now()+86400000; // 24 hours
  S._odoSnoozeCount=(S._odoSnoozeCount||0)+1;
  S.settingsTs=Date.now();
  saveAll();
  document.getElementById('_odo-modal-ov')?.remove();
  showToast('Odometer reminder set for tomorrow','⏰');
}
window._odoSnooze=_odoSnooze;

function _getVehicleOdoSummary(veh,year){
  return _vehOdo(veh,year);
}

function updateVehicleBizUse(idx,val){
  const vehs=getVehicles();
  if(vehs[idx]){vehs[idx].bizUse=Math.max(1,Math.min(100,parseFloat(val)||100));_setVehicles(vehs);saveAll();}
}
function getAvgVehicleBizUse(){
  const vehs=getVehicles();if(!vehs.length)return 1;
  return vehs.reduce((s,v)=>s+(v.bizUse||100),0)/vehs.length/100;
}

function setTripPurpose(purpose, btn){
  gps.purpose=purpose;
  document.querySelectorAll('#cd-purpose-chips .surf-type-btn').forEach(b=>b.classList.remove('active-surf-btn'));
  if(btn)btn.classList.add('active-surf-btn');
  // Show job picker for supply runs so mileage ties to correct job
  const jobPicker=document.getElementById('cd-supply-job-picker');
  if(jobPicker){
    if(purpose==='Supply run'){
      const activeJobs=bids.filter(b=>b.status==='Closed Won');
      if(activeJobs.length){
        jobPicker.style.display='block';
        jobPicker.innerHTML='<label style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text3);display:block;margin-bottom:6px">Which job? <span style="font-weight:400;opacity:.7">(optional)</span></label>'+
          '<select id="cd-supply-job-sel" style="width:100%;font-size:13px;padding:8px 10px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text)" onchange="gps.supplyJobId=this.value">'+
          '<option value="">- Select job -</option>'+
          activeJobs.map(b=>{const c=getClientById(b.client_id);return'<option value="'+b.id+'">'+escHtml(c?c.name:'Client')+', '+fmt(b.amount)+'</option>';}).join('')+
          '</select>';
      } else {
        jobPicker.style.display='none';
      }
    } else {
      jobPicker.style.display='none';
      gps.supplyJobId=null;
    }
  }
  checkTripReady();
}


function selectDriveVehicle(idx){
  const vehs=getVehicles();
  gps.vehicle=vehs[idx]?vehs[idx].name:'';
  renderDriveVehicleChips();
  checkTripReady();
}
function renderDriveVehicleChips(){
  // Now uses dropdown, this just populates the select
  const sel=document.getElementById('cd-vehicle-sel');
  const noVeh=document.getElementById('cd-no-vehicles');
  const vehs=getVehicles();
  if(!vehs.length){
    if(sel)sel.style.display='none';
    if(noVeh)noVeh.style.display='block';
    const btn=document.getElementById('cd-start-trip-btn');
    if(btn){btn.disabled=true;btn.style.background='var(--border2)';btn.style.cursor='not-allowed';}
    return;
  }
  if(noVeh)noVeh.style.display='none';
  if(sel){
    sel.style.display='block';
    sel.innerHTML='<option value="">- Select vehicle -</option>'+
      vehs.map(v=>{
        const label=getVehicleLabel(v);
        const full=getVehicleFullLabel(v);
        return '<option value="'+escHtml(v.name||'')+'"'+(gps.vehicle===v.name?' selected':'')+'>'+escHtml(full||'')+'</option>';
      }).join('');
    // Auto-select if only one vehicle
    if(vehs.length===1&&!gps.vehicle){
      gps.vehicle=vehs[0].name;
      sel.value=vehs[0].name;
      checkTripReady();
    }
  }
}
function selectDriveVehicleByName(name){
  gps.vehicle=name;
  checkTripReady();
}
function checkTripReady(){
  const hasVeh=!!gps.vehicle;
  const hasPurpose=!!gps.purpose;
  const btn=document.getElementById('cd-start-trip-btn');if(!btn)return;
  const ready=hasVeh&&hasPurpose;
  btn.disabled=!ready;
  btn.style.background=ready?'var(--green)':'var(--border2)';
  btn.style.color=ready?'#fff':'var(--text3)';
  btn.style.borderColor=ready?'var(--green)':'var(--border2)';
  btn.style.cursor=ready?'pointer':'not-allowed';
}

function resetDriveUI(){
  document.getElementById('cd-drive-idle').style.display='none';
  document.getElementById('cd-drive-active').style.display='none';
  document.getElementById('cd-drive-end').style.display='none';
}
function cancelStartDrive(){
  document.getElementById('cd-drive-idle').style.display='none';
  gps.vehicle='';gps.purpose='';
  document.querySelectorAll('#cd-purpose-chips .surf-type-btn').forEach(b=>b.classList.remove('active-surf-btn'));
  checkTripReady();
}
function confirmStartDrive(){
  if(gps.active){
    zConfirm('A drive is already running for '+((getClientById(gps.clientId)||{}).name||'a client')+'. End it first.',()=>{showEndDrive();},{title:'Drive already active',yes:'End current trip'});
    return;
  }
  const vehs=getVehicles();
  if(!gps.vehicle){
    const sel=document.getElementById('cd-vehicle-sel');
    if(sel&&sel.value)gps.vehicle=sel.value;
  }
  if(!gps.vehicle){
    const msg=document.getElementById('cd-vehicle-required-msg');if(msg)msg.style.display='block';
    if(!vehs.length)return zAlert('Add a vehicle in Settings before logging a trip.');
    return zAlert('Select a vehicle to continue.');
  }
  if(!gps.purpose){const ps=document.getElementById('cd-purpose-sel');if(ps&&ps.value)gps.purpose=ps.value;}
  gps.active=true;
  gps.clientId=currentClientId;
  // Capture GPS coords at trip start
  geoIfGranted(p=>{gps.startCoords={lat:p.coords.latitude,lon:p.coords.longitude};});
  const c=getClientById(currentClientId);
  gps.clientName=c?c.name:'Client';
  gps.startTime=Date.now();
  const _ds=document.getElementById('cd-drive-start');if(_ds)_ds.style.display='none';
  document.getElementById('cd-drive-active').style.display='block';
  const ap=document.getElementById('cd-active-purpose');if(ap)ap.textContent=gps.purpose||'Work drive';
  const av=document.getElementById('cd-active-vehicle');if(av)av.textContent=gps.vehicle||'';
  clearInterval(gps.timerInt);
  gps.timerInt=setInterval(updateDriveTimer,1000);
  window._wakeLockRequest&&window._wakeLockRequest();
  if(c&&c.phone){
    const phone=c.phone.replace(/\D/g,'');
    const msg='Hi '+(c.name||'').split(' ')[0]+', this is '+(S.bname||'TradeDesk')+', I\'m on my way! I\'ll be there shortly.';
    const smsLink='sms:'+phone+'&body='+encodeURIComponent(msg);
    window.location.href=smsLink;
  }
  showDriveBanner();
  renderTodayLegs();
}

function showEndDrive(){
  const c=getClientById(gps.clientId);
  const elapsed=gps.startTime?Math.floor((Date.now()-gps.startTime)/1000):0;
  const m=Math.floor(elapsed/60),s=elapsed%60;
  const overlay=document.createElement('div');
  overlay.className='zmodal-overlay';
  const box=document.createElement('div');
  box.className='zmodal';
  // Estimate miles from elapsed time at ~25mph average urban driving
  const estMiles=elapsed>0?Math.round(elapsed/3600*25*10)/10:0;
  box.innerHTML=
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">'+
      '<div style="font-size:17px;font-weight:800">End Drive</div>'+
      '<button onclick="closeTopModal()" style="border:none;background:none;font-size:22px;cursor:pointer;color:var(--text3)">'+svgIcon('✕',{size:20})+'</button>'+
    '</div>'+
    '<div style="background:var(--blue-lt);border-radius:var(--r);padding:8px 12px;margin-bottom:14px;font-size:12px;color:var(--blue-dk)">'+
      '<strong>'+(c?c.name:'Client')+'</strong> · '+gps.purpose+' · '+m+'m '+s+'s'+
    '</div>'+
    '<div class="f" style="margin-bottom:6px">'+
      '<label style="font-size:11px;font-weight:700;color:var(--text3)">Miles driven <span style="color:#A32D2D">*</span></label>'+
      '<input type="number" id="end-miles-modal" placeholder="e.g. 12.4" inputmode="decimal" step="0.1" min="0"'+
        ' style="font-size:26px;font-weight:800;padding:12px;border:2px solid var(--blue);background:var(--bg2);border-radius:var(--r);width:100%;box-sizing:border-box;color:var(--text);font-family:inherit;text-align:center"'+
        ' value="'+(estMiles>0?estMiles:'')+'" oninput="updateMilesPreview()">'+
      '<div id="end-miles-preview" style="font-size:12px;color:var(--green-mid);font-weight:700;margin-top:6px;min-height:16px">'+(estMiles>0?estMiles.toFixed(1)+' mi · '+fmt(estMiles*IRS())+' deduction (estimated)':'')+'</div>'+
    '</div>'+
    '<div style="font-size:10px;color:var(--text3);margin-bottom:14px">GPS start captured · adjust if needed</div>'+
    '<button onclick="saveEndDriveModal()" style="width:100%;padding:14px;border-radius:var(--r);border:none;background:var(--green);color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit">Save trip</button>';
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});
  setTimeout(()=>{const i=document.getElementById('end-miles-modal');if(i){i.focus();i.select();}},100);
}
function updateMilesPreview(){
  const miles=parseFloat(document.getElementById('end-miles-modal')?.value)||0;
  const prev=document.getElementById('end-miles-preview');
  if(!prev)return;
  if(miles>0){
    prev.textContent=miles.toFixed(1)+' mi · '+fmt(miles*IRS())+' deduction';
    prev.style.color='var(--green-mid)';
  } else {
    prev.textContent='';
  }
}
// How far from either end of an automatic leg a manual drive can have started
// and still be the same journey. Five miles: generous enough that tapping Drive
// part-way through still matches (the owner's case), tight enough that a
// different trip across town never does.
const _END_DRIVE_MATCH_FT=5*5280;
function saveEndDriveModal(){
  const miles=parseFloat(document.getElementById('end-miles-modal')?.value)||0;
  if(!miles||miles<=0){zAlert('Enter the miles driven.',{title:'Required'});return;}
  if(miles>500){if(!confirm('That\'s '+miles+' miles: does that look right?'))return;}
  const c=getClientById(gps.clientId);
  // ── Did the geofence already log this journey, better? ────────────────────
  // The automatic row runs geocode to geocode across the WHOLE drive and Apple
  // measures it. This one is a number typed from memory across however much of
  // the drive they remembered to tap through. So when both describe the same
  // journey the automatic one stays and this entry is not written: two rows for
  // one drive is a double deduction, and of the two, the measured one is the
  // record worth defending.
  //
  // Owner's case (2026-08-02): tapping Drive MID-drive. The leg began before the
  // tap and closed after it, so comparing arrival times alone would call it a
  // different journey and keep both, or keep the shorter one. The leg's START is
  // what settles it, which is why the automatic row now carries startedIso.
  //
  // OVERLAPPING IN TIME IS NOT THE SAME AS BEING THE SAME DRIVE, and getting
  // that wrong here DELETES what the contractor just typed. Time alone was the
  // first version of this check and it was badly wrong: in a crew account
  // another phone logs legs of its own all day, so any one of them landing in
  // this ten-minute window silently threw away the owner's entry and told them
  // it had "already been logged automatically". A trip that vanishes is
  // invisible; a duplicate is visible and one tap to delete. So this branch has
  // to be SURE, and every uncertainty resolves toward keeping what they typed.
  const _sameDrive=(m)=>{
    if(!m||!m.gps||!m.legKey||!m.loggedAt)return false;
    // A derived leg is logged when it began; its end is endedIso.
    const end=Date.parse(m.endedIso||m.loggedAt),start=Date.parse(m.startedIso||m.loggedAt);
    if(!end||!start)return false;
    if(!(end>=gps.startTime&&start<=Date.now()))return false;   // windows must overlap
    // WHOSE drive. A leg attributed to another crew member is never this one.
    const me=(typeof _supaUser!=='undefined'&&_supaUser)?_supaUser.id:null;
    if(m.logged_by_id&&me&&m.logged_by_id!==me)return false;
    // WHERE they set off. When both ends are known, a start a long way from
    // either end of the automatic leg is a different journey, whatever the
    // clock says. gps.startCoords carries `lon`, the rows carry `lng`.
    const sc=gps.startCoords;
    if(sc&&typeof _geoDistFt==='function'&&(m.fromCoord||m.toCoord)){
      const p={lat:sc.lat,lng:(sc.lng!=null?sc.lng:sc.lon)};
      const near=(c)=>!!(c&&c.lat!=null&&c.lng!=null&&_geoDistFt(p,{lat:c.lat,lng:c.lng})<=_END_DRIVE_MATCH_FT);
      if(!near(m.fromCoord)&&!near(m.toCoord))return false;
    }
    return true;
  };
  const auto=(gps.startTime?mileage.find(_sameDrive):null);
  if(auto){
    gps.active=false;gps.startTime=null;gps.startCoords=null;
    clearInterval(gps.timerInt);
    window._wakeLockRelease&&window._wakeLockRelease();
    closeTopModal();
    hideDriveBanner();
    renderDash();
    showToast('Already logged automatically: '+(auto.miles||0).toFixed(1)+' mi'+
      (auto.miles?' · '+fmt(auto.miles*IRS())+' deduction':''),'🛰️');
    return;
  }
  mileage.unshift({
    // The day the DRIVE started, not the day End Drive was tapped. A run that
    // leaves at 11:52pm and finishes at 12:08am is one trip on one day, and
    // todayKey() here filed it under tomorrow: on New Year's Eve, under the wrong
    // TAX YEAR. Same rule autoLogDriveTrip follows for the automatic row.
    id:_newId(),date:gps.startTime?dateKey(new Date(gps.startTime)):todayKey(),
    vehicle:gps.vehicle,vehicleId:_vehIdForName(gps.vehicle),purpose:gps.purpose,
    loggedAt:new Date().toISOString(),
    // When the drive BEGAN, so the journey dedup can window this row against
    // an automatic leg that lands later (the mid-drive manual tap case).
    startedIso:gps.startTime?new Date(gps.startTime).toISOString():undefined,
    miles:Math.round(miles*10)/10,
    client_id:gps.clientId,client_name:c?c.name:'',
    start_coords:gps.startCoords||null,
    calc_method:'gps_time'
  });
  gps.active=false;gps.startTime=null;gps.startCoords=null;
  clearInterval(gps.timerInt);
  window._wakeLockRelease&&window._wakeLockRelease();
  saveAll();
  // Mileage is the most-lost data because users immediately switch apps after
  // saving a trip, flush to Supabase NOW instead of waiting for the 2s debounce.
  _flushSaveNow();
  closeTopModal();
  hideDriveBanner();
  renderDash();
  showToast(miles.toFixed(1)+' mi logged · '+fmt(miles*IRS())+' deduction','🚗');
}
function updateDriveTimer(){
  if(!gps.startTime)return;
  const elapsed=Math.floor((Date.now()-gps.startTime)/1000);
  const m=Math.floor(elapsed/60),s=elapsed%60;
  const timeStr=m+':'+(s<10?'0':'')+s;
  const el=document.getElementById('cd-timer');if(el)el.textContent=timeStr;
  const bt=document.getElementById('banner-timer');if(bt)bt.textContent='Tap to return · '+timeStr;
}

function jumpToDriveClient(){
  if(gps.clientId){
    openClientDetail(gps.clientId);
  }
}

function showDriveBanner(){
  const banner=document.getElementById('drive-banner');
  if(!banner)return;
  const bc=document.getElementById('banner-client');
  if(bc)bc.textContent=gps.clientName||'Driving...';
  banner.style.display='flex';
  if(document.body&&document.body.classList)document.body.classList.add('drive-active');
}
function hideDriveBanner(){
  const banner=document.getElementById('drive-banner');
  if(banner)banner.style.display='none';
  if(document.body&&document.body.classList)document.body.classList.remove('drive-active');
}
function openDriveModal(opts){
  opts=opts||{};
  const tk=todayKey();
  // Build today's scheduled stops as quick-pick suggestion chips
  const suggestions=[];
  jobs.forEach(j=>{
    if(j.status==='canceled')return;
    const c=getClientById(j.client_id);if(!c||!c.addr)return;
    const d=parseInt(j.days)||1;
    for(let i=0;i<d;i++){
      if(addDays(j.start,i)===tk&&!suggestions.find(x=>x.clientId===c.id)){
        suggestions.push({label:c.name,addr:c.addr,clientId:c.id,
          purpose:j.eventType==='estimate'?'Estimate':'Job site',
          icon:j.eventType==='estimate'?'📋':'🔨'});
      }
    }
  });
  openLogTripModal(Object.assign({},opts,{suggestions}));
}

let _milFilter='all';
let _lmCoords={from:null,to:null};
let _tripSearchTimers={};
let _tripDestTimer=null;
let _tripGpsCoords=null; // cached GPS fix for search bias
let _fromBiasCache={val:null,coords:null}; // MapKit-geocoded From coords for To-field bias

// ── Shared geocoding, Photon (primary) + Census (fallback) ─────────────────
// MapKit tokens are domain-locked with no expiry (see CLAUDE.md §10.1)
const _MAPKIT_TOKEN=location.hostname.includes('pages.dev')
  ?'eyJraWQiOiI3S0E5WDhVUjZMIiwidHlwIjoiSldUIiwiYWxnIjoiRVMyNTYifQ.eyJpc3MiOiJSVjI2NDRSTkdTIiwiaWF0IjoxNzgxMzAxNTIyLCJvcmlnaW4iOiIqLnRyYWRlZGVzay1jeXAucGFnZXMuZGV2Iiwic2NvcGUiOiJtYXBraXRfanMifQ.ehafZ1SO_50PLbz_-5iwhPJXKZpPXSJrNAALFhHmetxrVKOpCYzBHR9viL6Nl8Kor0yCIFJcvKiGrtrlNSgN7Q' // *.tradedesk-cyp.pages.dev: no expiry
  :'eyJraWQiOiJXQzYzOFM2M0c0IiwidHlwIjoiSldUIiwiYWxnIjoiRVMyNTYifQ.eyJpc3MiOiJSVjI2NDRSTkdTIiwiaWF0IjoxNzgxMzAxNDcwLCJvcmlnaW4iOiJ0cmFkZWRlc2twcm8uYXBwIiwic2NvcGUiOiJtYXBraXRfanMifQ.0hmtYgvSGLHMZcnHnEGMsaJDg6tXEtzfp3aS-tLdGbTjocZDQLP6VlrPl9l29tV-T5SgNXQycqUJO_T1b_rFWQ'; // tradedeskpro.app: no expiry
let _mapkitReady=false;
// MapKit JS tokens are domain-locked (CLAUDE.md §10.1). On any non-authorized origin
// (localhost, 127.0.0.1, the flow-test bridge) mapkit.init throws an origin-mismatch
// console.error: which fails assertNoErrors. Only init on tradedeskpro.app / *.pages.dev.
const _mapkitAuthorizedOrigin=/(?:^|\.)tradedeskpro\.app$/.test(location.hostname)||/\.pages\.dev$/.test(location.hostname);
function _initMapKit(){
  if(typeof mapkit==='undefined')return;
  if(!_mapkitAuthorizedOrigin)return; // unauthorized origin, skip init so MapKit never throws
  mapkit.init({authorizationCallback:done=>done(_MAPKIT_TOKEN),language:'en-US'});
  _mapkitReady=true;
  _retryPendingTrips();
}
// The wheels cannot beat the road (owner report 2026-08-11: Home Depot to the
// shop "in 3 minutes", which that route cannot be driven in). A leg picked up
// mid-drive (webview crash, app relaunch, late first fix) opens its clock
// late, so the observed window can be a fraction of the route's own drive
// time. When the observed minutes are under half the router's, the router's
// time replaces them and the start is pulled back from the verified arrival
// to match, flagged timeInferred. Payroll is untouched on purpose: the time
// entry keeps only the observed minutes, per the owner's 2026-08-03 rule that
// duration nobody observed is never claimed as labor.
// Did this leg contain an ERRAND, by the motion coprocessor's tape? The chip
// records driving/walking/still around the clock at no cost to us
// (TdGeo.motionSince queries its history, low-confidence samples already
// filtered native-side). TWO signatures qualify, matching the live pause
// rule's semantics exactly:
//   WALK  : 40+ seconds on foot, measured from the first walk to the next
//           DRIVING transition (the real pickup tape is walk -> STILL at the
//           counter -> walk -> drive, so any-next-transition measured a
//           30-second walk as an ignorable blip).
//   STILL : 2.5+ minutes motionless mid-leg: a drive-thru, a curbside
//           pickup, the same position-dwell evidence the LIVE pause rule
//           keys on, read off a different sensor (owner 2026-08-14: "still
//           didn't correct", a pickup with no walk on the tape). A rolling
//           jam never sits continuously still that long and never
//           produces a walk, so real forced detours keep collecting.
// Returns true (errand on tape), false (clean driving tape), or null (no
// signal: web build, permission denied, no coprocessor); the caller must
// treat null as "fall back to the time rule", never as an answer.
async function _mileTapeHadPause(startedIso,endedIso){
  try{
    const Td=(typeof _geoTdPlugin==='function')?_geoTdPlugin():null;
    if(!Td||typeof Td.motionSince!=='function')return null;
    const s=Date.parse(startedIso||'')||0,e=Date.parse(endedIso||'')||0;
    if(!s||!e||e<=s)return null;
    const r=await Td.motionSince({sinceMs:s-120000});
    if(!r||!r.available||!Array.isArray(r.transitions))return null;
    const tr=r.transitions.filter(t=>t&&t.ts<=e+120000).sort((a,b)=>a.ts-b.ts);
    const spanToDrive=(i)=>{
      let until=e;
      for(let j=i+1;j<tr.length;j++){if(tr[j].kind==='driving'||tr[j].kind==='cycling'){until=tr[j].ts;break;}}
      return Math.min(until,e)-tr[i].ts;
    };
    for(let i=0;i<tr.length;i++){
      if(tr[i].ts<s-60000)continue;                 // before the drive: the walk TO the truck
      if(tr[i].kind==='onFoot'&&spanToDrive(i)>=40000)return true;
      if(tr[i].kind==='still'&&spanToDrive(i)>=150000)return true;
    }
    return false;
  }catch(_e){return null;}
}
// The coprocessor keeps roughly a WEEK of history, so rows that already paid
// an errand's detour (measured before the walk check shipped, or measured
// while the webview was dead) are still correctable after the fact (owner
// 2026-08-14: "you said iPhone stores it for a week and it could correct
// data and rows"). Once per session, after the cloud load settles: every
// recent auto row whose measurement KEPT the observed tally (the floor
// collected) gets the walk question, and a walked leg re-measures down to
// the direct route. Corrections only ever REDUCE a row, the safe direction
// for an IRS log; a hand-edited row no longer matches its tally and is
// naturally left alone; capped at 20 rows so a huge log can never stampede
// the router.
// Re-judge NAMED stops after the fact (owner 2026-08-14: the Casey's loop).
// The personal/business decision runs once, the moment Apple names the stop.
// If the app died mid-day, or the rule itself changed (fuel receipts stopped
// qualifying), that decision is never revisited and a personal stop stays on
// the log forever as a deductible destination. This sweep walks recent auto
// rows in pairs, X -> P followed by P -> Y, and when P fails the SAME
// business test the live path uses (a saved business place, or a qualifying
// receipt), it collapses the pair the way the live collapse would have:
// one direct X -> Y row, breadcrumbed so a receipt can still rebuild it, or
// NOTHING at all when X and Y are the same place, because a loop that
// touched no business point drove no business miles. Reductions only, once
// per session, capped, and announced.
// ── Is this stop a BUSINESS destination? (one definition, two callers) ─────
// Only facts the CONTRACTOR established count: a job site, a client, a place
// they saved with a business kind, or qualifying money they spent there that
// day. Anything the app merely GUESSED (a purpose label, a place the
// repeat-stop finder auto-suggested) deliberately does not, which is the whole
// reason _milePersonalStopSweep can re-judge a stop it once called a supply
// run (owner 2026-08-14, the Casey's loop).
//
// Extracted from that sweep's own isPersonalStop so the recovery tool below
// asks this question with the SAME code rather than a lookalike written from
// memory (§7.3). opts.skipReceipt lets that original caller keep its separate
// receipt branch, which is the one that leaves the 'stop-keep' diagnostic.
function _mileStopIsBusiness(coord,name,day,opts){
  try{
    if(!coord||coord.lat==null)return false;
    const near=(c1,c2)=>!!(c1&&c2&&c1.lat!=null&&c2.lat!=null&&typeof _geoDistFt==='function'&&
      _geoDistFt({lat:c1.lat,lng:c1.lng},{lat:c2.lat,lng:c2.lng})<=_MILE_DEDUP_DEST_FT);
    if((typeof jobs!=='undefined'&&Array.isArray(jobs))&&
       jobs.some(j=>j&&j.lat!=null&&near({lat:j.lat,lng:j.lon},coord)))return true;
    if((typeof clients!=='undefined'&&Array.isArray(clients))&&
       clients.some(c=>c&&c.lat!=null&&near({lat:c.lat,lng:c.lng!=null?c.lng:c.lon},coord)))return true;
    const savedPlace=(typeof placeAt==='function')?placeAt({lat:coord.lat,lon:coord.lng}):null;
    if(savedPlace&&typeof _PLACE_KIND_TO_PURPOSE!=='undefined'&&_PLACE_KIND_TO_PURPOSE[savedPlace.kind])return true;
    if(opts&&opts.skipReceipt)return false;
    if(typeof _bizReceiptForStop==='function'&&
       _bizReceiptForStop({lat:coord.lat,lng:coord.lng,name:name||'',day:day||todayKey()}))return true;
    return false;
  }catch(_e){return false;}
}
// ── THE TRACE IS THE MEASUREMENT (owner 2026-09-01) ────────────────────────
//
// "my mileage is correct but my time log is not" ... and on Jack's: "his
// mileage should have his trip from home office to 1200 sw oakley shop in the
// morning and thats really it."
//
// It had that trip. It said 1.8 miles. The row carries a 229-point GPS trace
// that sums to 5.65, and the app threw that away: _mileServerRefine below routes
// fromCoord to toCoord and overwrites `miles` with the answer, stamping
// 'auto_route'. Nothing compared the guess against the evidence already in the
// same record, so a leg whose endpoints resolved badly (his read "Stop" and
// "KS") got a distance for a journey he never took.
//
// A routed guess is for a leg with NOTHING else: a hand-typed row, or one
// whose breadcrumbs never landed. Where there is a trace, the trace is what
// happened. This returns the miles the recorded path actually covers.
//
// The same haversine the fence machine measures everything else with, so the
// number here and the line drawn on the map can never disagree (7.3).
function _milePathMiles(m){
  const p=m&&m.path;
  if(!Array.isArray(p)||p.length<2)return 0;
  let ft=0;
  for(let i=1;i<p.length;i++){
    const a=p[i-1],b=p[i];
    if(!Array.isArray(a)||!Array.isArray(b))continue;
    const alat=+a[0],alon=+a[1],blat=+b[0],blon=+b[1];
    if(!isFinite(alat)||!isFinite(alon)||!isFinite(blat)||!isFinite(blon))continue;
    ft+=_geoDistFt({lat:alat,lng:alon},{lat:blat,lng:blon});
  }
  return ft>0?ft/5280:0;
}
// What this leg is OBSERVED to have covered, from whichever record of the
// drive it has. gpsMiles is the live odometer's own tally; the path is the
// same drive written down. Either is evidence; a routed guess is not.
function _mileObservedMiles(m){
  const g=+(m&&m.gpsMiles);
  const p=_milePathMiles(m);
  return Math.max(isFinite(g)&&g>0?g:0,p);
}
function _mileFixLegClock(rec,routeMins){
  if(!rec||!(routeMins>0)||!rec.endedIso)return;
  if(rec.mins>0&&rec.mins*2>=routeMins)return;   // plausible window, observed wins
  rec.mins=routeMins;
  rec.startedIso=new Date(Date.parse(rec.endedIso)-routeMins*60000).toISOString();
  rec.timeInferred=true;
}
async function _retryPendingTrips(){
  // Two kinds of unfinished trip, and they resolve differently. A manual one has
  // typed ADDRESSES that still need geocoding; an automatic one already holds
  // both coordinates, because the geofence knew exactly where it was. Neither
  // may be dropped: a trip stuck at zero miles is a deduction the contractor
  // earned and is not getting.
  const pending=mileage.filter(m=>
    (m.calc_method==='pending'&&m.from&&m.to)||
    (m.calc_method==='pending_auto'&&m.fromCoord&&m.toCoord));
  if(!pending.length)return;
  let filled=0;
  for(const rec of pending){
    try{
      // RE-READ the row, never trust the snapshot. This loop awaits a geocode and
      // a route per trip, and an automatic trip has its OWN route call already in
      // flight from autoLogDriveTrip: so a row that was pending when the list was
      // built can settle to 'auto_route' while an EARLIER row in the same list is
      // still awaiting. Reading the stale snapshot then classified that settled
      // row as a manual one and sent it down the address path, which geocodes the
      // endpoint's NAME. Automatic endpoints are named "Shop" and "Stop", not
      // addresses, so a correct 2-mile leg was overwritten with whatever business
      // called "Shop" the geocoder found first: 65.7 miles, and 885 for "Stop",
      // on a day that never left Topeka (owner's Topeka day, live, 2026-08-02).
      // A trip that already answered needs nothing from this sweep.
      const method=rec.calc_method;
      if(method!=='pending'&&method!=='pending_auto')continue;
      const auto=method==='pending_auto';
      const fc=auto?rec.fromCoord:await _resolveCoords(rec.from);
      const tc=auto?rec.toCoord:await _resolveCoords(rec.to);
      if(!fc||!tc)continue;
      const{miles,mins:routeMins}=await _routeDistance(fc,tc);
      // SECOND re-read, after the route call. The one above catches a row that
      // had already settled when we reached it; this catches one that changed
      // WHILE we were measuring. A leg gets re-origined mid-flight when a stop
      // turns out to have been passed through, and the corrected measurement is
      // the one that must survive: writing ours would stamp the distance from
      // the old origin as final and the correction would bail on seeing it.
      if(rec.calc_method!==method)continue;
      if(auto&&(rec.fromCoord!==fc||rec.toCoord!==tc))continue;
      if(!(miles>0))continue;   // not a measurement: leave it pending for the next sweep
      // Same observed-miles floor the live measurement applies (forced-detour
      // rule): a leg that settles here instead must not lose it, and the same
      // walk check disqualifies it (an errand is an errand however late the
      // measurement lands).
      let best=miles;
      // _mileObservedMiles, not rec.gpsMiles: a server-derived row carries the
      // recorded PATH and no odometer tally, and reading only gpsMiles left
      // every one of those with nothing to defend itself against the route.
      const _obs=_mileObservedMiles(rec);
      if(auto&&_obs>0&&_obs>miles&&_obs<=miles*4){
        const walked=await _mileTapeHadPause(rec.startedIso,rec.endedIso);
        if(walked===true)rec.pausedLeg=true;
        else best=_obs;
      }
      rec.miles=Math.round(best*10)/10;rec.calc_method=auto?'auto_route':'address';
      if(auto)_mileFixLegClock(rec,routeMins);
      // Keep the resolved endpoints on a manual row: the journey dedup matches
      // destinations by coordinate first, and a typed address otherwise only
      // ever matches by name.
      if(!auto){rec.fromCoord=rec.fromCoord||fc;rec.toCoord=rec.toCoord||tc;}
      filled++;
    }catch(e){}
  }
  if(!filled)return;   // nothing changed, do not churn a save or a re-render
  saveAll();
  if(document.getElementById('mil-table'))renderAllMileage();
  renderDash();
}

// ── One journey, one row (owner report 2026-08-11) ───────────────────────────
// The owner drove once to John Doe and got THREE rows: the auto leg, the same
// leg re-closed after a parking-lot truck move, and a manual drive started
// mid-route when they opened Drive to find the address. The rule they set:
// rows describing the same journey collapse to ONE. The automatic row is the
// source of truth whenever one exists; between rows of the same kind the
// longest measured trip survives (see _mileTripWinner).
//
// "Same journey" is deliberately strict, because deleting a real trip costs
// real deduction money: same person, time windows that overlap, and the same
// destination. Two genuine trips by one person to one place can never overlap
// in time: you cannot drive to somewhere you are already driving to.
// ── Personal legs outside the workday (owner rule 2026-08-24) ─────────────
// The tracker logs every drive between two known points while tracking is on.
// It has no idea whether anyone is working, so a personal trip that happens to
// end at a business point is written as a business trip and lands in the IRS
// log. The owner's own week had two: a 6:26pm "Civitan Day Camp to Shop" leg
// ("was a time we did family pictures and I'm not sure why it's there") and a
// Saturday 11:47am "Shop to Stop" on a day with no work in it at all.
//
// The workday window is the missing notion, and it already decides this
// question for TIME on the Time Log and in Crew Cost (js/geo-track.js
// _geoShopCutoffs): the day opens at its first job or supply activity and
// closes at its last, and a drive counts as an edge only when chained to one.
// The same window decides it for MILES here, so a day cannot be one length for
// payroll and another for the deduction.
//
// Deliberately conservative, because this deletes tax records:
//   - GPS legs only. A hand-entered trip is the contractor's own statement and
//     is never second-guessed.
//   - Never a leg carrying a client link.
//   - Never a leg with a same-day business receipt at either end, the same
//     protection _milePersonalStopSweep already honours.
//   - Never a day the window covers, only legs that fall wholly outside it.
//   - Capped per pass, once per session, and every removal is announced in the
//     park log with its route and clock, so nothing vanishes unexplained.
// Reductions only, and it uses the same tombstone + cloud delete every other
// real deletion here uses (§7.3), or the row simply comes back on next load.
// A leg endpoint that resolved to a real place (a client, a job, the shop, a
// supply house) rather than an anonymous roadside stop. The fence machine
// writes the resolved name at the time it logs the leg, so this is a recorded
// fact about the drive, not a re-derivation.
function _mileNamedEnd(n){
  const t=String(n==null?'':n).trim();
  return !!t&&t!=='?'&&!/^stop$/i.test(t);
}
const _MILE_WORKDAY_CAP=25;
// ── Clear the flights already in the log (owner ask 2026-08-24, mid-air) ────
// The ceiling in geo-track.js (_GEO_MAX_DRIVE_MPH) stops the NEXT flight from
// booking itself as a drive. This clears the ones already logged, using the
// same test on the row's own stored endpoints and wheel time, so nothing has
// to be deleted by hand.
//
// Same conservative shape as _mileWorkdaySweep above: automatic GPS rows only
// (a hand-typed trip is the contractor's own statement and is never touched),
// never a row tied to a client, never a stop with a receipt against it, and
// capped per session so a bad rule can't empty the log. Deleting the mileage
// row is also what clears the flight's paid wheel time: _geoSyncDriveTimeEntries
// drops any drive entry whose legKey no longer has a mileage row.
const _MILE_FLIGHT_CAP=25;
// ══ RECOVERING MILEAGE A SWEEP SHOULD NEVER HAVE TAKEN ══════════════════════
// Every sweep above removes rows, and every one of them can be wrong: the
// 2026-08-25 cascade (a bad reconciler trim collapsed the workday window, so
// _mileWorkdaySweep judged two real "John Doe to Shop" drives personal and
// deleted them) proved that the destructive half of this file needs an undo.
// Nothing here runs on its own. A sweep that fires by itself is what created
// the problem; the cure is not a second sweep that fires by itself.
//
// It can only ever ADD rows back, never remove one, and it is safe to run
// twice: a row already live is skipped, and the fetch below cannot even see it
// (a restored row has no deleted_at, and the query filters on deleted_at).
//
// Every removal in this app is a SOFT delete: js/cloud.js stamps deleted_at
// and the row stays in the table forever ("keep everything in"). That is what
// makes recovery possible at all, and it is also the hard boundary of this
// tool: _devHardPurge's DELETE genuinely removes the row, and nothing can
// bring that back.
const _MILE_RESTORE_DAYS=180;    // how far back a recovery run looks
const _MILE_RESTORE_SCAN=500;    // deleted rows examined per run
const _MILE_RESTORE_MAX=50;      // rows restored per run: a bounded, reviewable batch

// Rows this app's own test harness wrote into a dev account. They are shaped
// like drives and they are not drives, so they can never be "recovered" into a
// tax record. Named by the fixtures that actually produced them (verified
// against the dev account's deleted rows, 2026-08-26).
const _MILE_SEED_NAME=/(MyLeg|OtherLeg|Sync Job|Truck [AB] job|^E2E )/;
const _MILE_SEED_KEY=/^(sync-|dev-a-|dev-b-|dev-b2-|scope-)/;
function _mileRestoreIsSeed(m){
  const f=String((m&&m.from_name)||''),t=String((m&&m.to_name)||'');
  // A generated id embedded in the place name ("Kansas Ave Client 1785640356810")
  // is the single most reliable fixture tell: no real place is named after a
  // millisecond timestamp.
  if(/\d{10,}/.test(f)||/\d{10,}/.test(t))return true;
  if(_MILE_SEED_NAME.test(f)||_MILE_SEED_NAME.test(t))return true;
  if(_MILE_SEED_KEY.test(String((m&&m.legKey)||'')))return true;
  // A crew member's row is restored from THEIR device, not the owner's.
  if(m&&m.logged_by_id!=null)return true;
  return false;
}
function _mileRestoreWin(m){
  const a=Date.parse((m&&m.startedIso)||'')||0;
  const b=Date.parse((m&&m.endedIso)||'')||a;
  return {a,b:Math.max(a,b)};
}
// Everything decidable about ONE row on its own. The context rules (is it a
// duplicate, is it an echo, was it part of a deliberate cleanup) need the rest
// of the log and live in _mileRestoreSwept.
function _mileRestoreEligible(m){
  if(!m)return 'no row';
  // A hand-entered trip is the contractor's own statement. If one of those was
  // removed, it was removed on purpose: nothing automatic ever touches them.
  if(!m.gps||!m.legKey)return 'not an automatic leg';
  if(m.calc_method!=='auto_route')return 'never measured';
  if(!(Number(m.miles)>0))return 'no miles';
  // The owner's own rule, unchanged from _mileWorkdaySweep: a drive with a real
  // business name at BOTH ends is a business drive by its own endpoints. An
  // anonymous 'Stop' at either end is what an errand looks like, and an errand
  // stays deleted.
  if(!_mileNamedEnd(m.from_name)||!_mileNamedEnd(m.to_name))return 'anonymous endpoint';
  // Left a place and came back to it: no business miles exist to claim.
  if(String(m.from_name).trim()===String(m.to_name).trim())return 'round trip to the same place';
  if(_mileRestoreIsSeed(m))return 'test seed data';
  if(!_mileRestoreWin(m).a)return 'no clock';
  return null;   // eligible
}
// Does a row already on the books describe this same journey? Two shapes, both
// straight out of _mileSameJourney/_mileSameLeg: another automatic leg over the
// same route whose wheel time overlaps, or the HAND-TYPED half of a double log,
// tapped at the same destination within the same window.
function _mileRestoreCovered(c,kept){
  const w=_mileRestoreWin(c);
  return kept.some(k=>{
    if((k.logged_by_id||null)!==(c.logged_by_id||null))return false;
    if(k.legKey){
      const kw=_mileRestoreWin(k);
      if(!kw.a)return false;
      return k.from_name===c.from_name&&k.to_name===c.to_name&&kw.a<=w.b&&kw.b>=w.a;
    }
    const la=Date.parse(k.loggedAt||'')||0;
    if(!la)return false;
    return k.to_name===c.to_name&&la>=w.a-_MILE_DEDUP_SLACK_MS&&la<=w.b+_MILE_DEDUP_SLACK_MS;
  });
}
// ── The recovery itself ────────────────────────────────────────────────────
// opts.apply === true writes. Anything else is a scan: it reads, decides, and
// returns the verdict without touching a single row, which is what the panel
// shows the owner before he agrees to anything.
async function _mileRestoreSwept(opts){
  opts=opts||{};
  const out={scanned:0,restored:0,miles:0,rows:[],skipped:{},error:null};
  const note=(ev,x)=>{try{if(typeof _geoParkNote==='function')_geoParkNote(ev,x);}catch(_e){}};
  const skip=(m,why)=>{out.skipped[why]=(out.skipped[why]||0)+1;};
  try{
    if(typeof mileage==='undefined'||!Array.isArray(mileage)){out.error='no mileage log';return out;}
    if(typeof _supa==='undefined'||!_supa){out.error='not connected';return out;}
    const uid=(typeof _effectiveUid==='function'&&_effectiveUid())||(window._supaUser&&window._supaUser.id)||null;
    if(!uid){out.error='not signed in';return out;}
    const since=new Date(Date.now()-_MILE_RESTORE_DAYS*86400000).toISOString();
    // `gte` on deleted_at is the whole filter: a NULL never satisfies a
    // comparison, so live rows are excluded by the same clause that bounds the
    // window. One predicate, no `not.is` to get wrong.
    let del=[];
    try{
      const{data,error}=await _supa.from('td_mileage').select('id,data,deleted_at')
        .eq('user_id',uid).gte('deleted_at',since).limit(_MILE_RESTORE_SCAN);
      if(error||!Array.isArray(data)){out.error=(error&&error.message)||'fetch failed';return out;}
      del=data;
    }catch(e){out.error=(e&&e.message)||String(e);return out;}
    out.scanned=del.length;
    if(!del.length)return out;

    // ── Was this save a SWEEP, or a person cleaning house? ──────────────────
    // deleted_at is stamped once per supaSaveToCloud call, so every row a
    // single save removed carries the identical timestamp. A mileage sweep can
    // only ever remove mileage; the moment a client, job, bid, expense or
    // income row shares that timestamp, that save was a human deleting things
    // (or a test harness tearing its fixtures down), and the mileage in it went
    // with them ON PURPOSE. Restoring it would drag back records the owner
    // deliberately threw away, which is the one failure this tool must not have.
    const human=new Set();
    for(const t of ['td_clients','td_jobs','td_bids','td_expenses','td_income']){
      try{
        const{data}=await _supa.from(t).select('deleted_at').eq('user_id',uid).gte('deleted_at',since).limit(_MILE_RESTORE_SCAN);
        (data||[]).forEach(r=>{if(r&&r.deleted_at)human.add(String(r.deleted_at));});
      }catch(_e){}
    }

    const cands=[];
    for(const r of del){
      const m=r&&r.data;
      if(!m){skip(m,'unreadable');continue;}
      if(mileage.some(x=>String(x.id)===String(r.id))){skip(m,'already back');continue;}
      if(human.has(String(r.deleted_at))){skip(m,'deleted on purpose');continue;}
      const why=_mileRestoreEligible(m);
      if(why){skip(m,why);continue;}
      cands.push(Object.assign({},m,{id:r.id}));
    }
    // Chronological, because every context rule below reads "against what is
    // already on the books", and the earlier leg is the one with the better
    // claim to being the real drive.
    cands.sort((a,b)=>_mileRestoreWin(a).a-_mileRestoreWin(b).a);
    const kept=mileage.slice();
    const win=[];
    for(const c of cands){
      if(win.length>=_MILE_RESTORE_MAX)break;
      if(_mileRestoreCovered(c,kept)){skip(c,'already logged');continue;}
      const w=_mileRestoreWin(c);
      // Nobody is on two drives at once. An overlap means one of the pair is
      // the fence machine's echo of the other, and the first by the clock keeps
      // the claim.
      if(win.some(k=>{const kw=_mileRestoreWin(k);return kw.a<=w.b&&kw.b>=w.a;})){skip(c,'overlaps a kept leg');continue;}
      // GAP ECHO (_geoDriveEntry's own discriminator, applied after the fact):
      // the same route, the same day, and no leg in between that brought them
      // back to where this one starts. You cannot drive somewhere you never
      // left.
      const back=win.concat(kept).some(k=>k.to_name===c.from_name&&_mileRestoreWin(k).b>0&&_mileRestoreWin(k).b<=w.a);
      if(win.some(k=>k.from_name===c.from_name&&k.to_name===c.to_name&&(k.date||'')===(c.date||''))&&!back){
        skip(c,'echo of a leg already kept');continue;
      }
      win.push(c);
    }
    // ROUND TRIP THROUGH A PERSONAL STOP, the Casey's rule (owner 2026-08-14),
    // applied to the recovery set: leave a business point, stop somewhere that
    // is not a job, a client, a saved business place or a receipt, come back to
    // the same business point. No business miles exist in that loop, so neither
    // leg comes back. Runs last so it can see the whole surviving set.
    for(let i=win.length-1;i>=0;i--){
      const inb=win[i];if(!inb)continue;
      const j=win.findIndex(o=>o&&o!==inb&&o.from_name===inb.to_name&&o.to_name===inb.from_name&&
        _mileRestoreWin(o).a>=_mileRestoreWin(inb).b);
      if(j<0)continue;
      if(inb.client_id!=null)continue;
      if(_mileStopIsBusiness(inb.toCoord,inb.to_name,inb.date))continue;
      const out2=win[j];
      win.splice(Math.max(i,j),1);win.splice(Math.min(i,j),1);
      skip(inb,'round trip through a personal stop');skip(out2,'round trip through a personal stop');
      i=Math.min(i,win.length);
    }
    out.rows=win.map(m=>({id:m.id,date:m.date||'',from:m.from_name||'',to:m.to_name||'',miles:Number(m.miles)||0}));
    out.miles=Math.round(win.reduce((s,m)=>s+(Number(m.miles)||0),0)*10)/10;
    if(!opts.apply||!win.length){
      note('mile-restore-scan','found='+win.length+' mi='+out.miles+' of '+out.scanned);
      return out;
    }

    // ── WRITE ──────────────────────────────────────────────────────────────
    // Both halves, or the row comes straight back out: the cloud row loses its
    // deleted_at, AND the local log gets the row back so the next save's sweep
    // does not read it as a row this device deleted. Dropping the id out of
    // _locallyDeletedIds is that same point from the other side: a stale delete
    // intent would re-stamp deleted_at on the very next save.
    const ts=new Date().toISOString();
    const ids=win.map(m=>String(m.id));
    try{
      for(let i=0;i<ids.length;i+=50){
        const{error}=await _supa.from('td_mileage').update({deleted_at:null,updated_at:ts})
          .in('id',ids.slice(i,i+50)).eq('user_id',uid);
        if(error)throw error;
      }
    }catch(e){out.error=(e&&e.message)||String(e);note('mile-restore-err',out.error);return out;}
    for(const m of win){
      if(mileage.some(x=>String(x.id)===String(m.id)))continue;   // idempotent
      mileage.push(m);
      out.restored++;
      note('mile-restore',(m.from_name||'?')+' to '+(m.to_name||'?')+' '+(m.miles||0)+'mi '+(m.startedIso||''));
      try{if(typeof _locallyDeletedIds!=='undefined'&&_locallyDeletedIds&&_locallyDeletedIds.td_mileage)_locallyDeletedIds.td_mileage.delete(String(m.id));}catch(_e){}
    }
    note('mile-restore-done','rows='+out.restored+' mi='+out.miles);
    // Reporting sits OUTSIDE the decision, the same split _milePersonalStopSweep
    // needed: the rows are already back by the time this runs, and a repaint
    // that throws must not turn a completed recovery into a reported failure.
    try{
      if(typeof saveAll==='function')saveAll();
      if(typeof supaSaveToCloud==='function')supaSaveToCloud();
      if(document.getElementById('mil-table')&&typeof renderAllMileage==='function')renderAllMileage();
      if(typeof renderDash==='function')renderDash();
      if(typeof showToast==='function')showToast(out.restored+' drive'+(out.restored===1?'':'s')+' back on the log · '+out.miles+' mi','🧾');
    }catch(_e){note('mile-restore-ui',(_e&&_e.message)||String(_e));}
    return out;
  }catch(e){
    out.error=(e&&e.message)||String(e);
    note('mile-restore-err',out.error);
    return out;
  }
}
window._mileRestoreSwept=_mileRestoreSwept;

// The owner-invoked trigger, and the ONLY way this ever runs. Scans first and
// shows what it found; nothing is written until he taps Restore. Built on
// .zmodal-overlay/.zmodal, the app's centred-modal convention (§7.3), the same
// shell _geoDiagPanel uses two buttons over in Settings → Developer.
function _mileRestorePanel(){
  if(document.getElementById('_mile-restore-ov'))return;
  const ov=document.createElement('div');ov.id='_mile-restore-ov';ov.className='zmodal-overlay';
  const m=document.createElement('div');m.className='zmodal';
  m.innerHTML='<div style="font-size:16px;font-weight:800;margin-bottom:10px">Recover swept mileage</div>'+
    '<div id="_mile-restore-body" style="font-size:12px;color:var(--text3)">Checking the deleted rows…</div>'+
    '<div style="display:flex;gap:10px;margin-top:14px">'+
      '<button onclick="this.closest(\'.zmodal-overlay\').remove()" class="btn" style="flex:1">Close</button>'+
      '<button id="_mile-restore-go" class="btn" style="flex:1;display:none">Restore</button>'+
    '</div>';
  ov.appendChild(m);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  const body=()=>document.getElementById('_mile-restore-body');
  const paint=(r)=>{
    const b=body();if(!b)return;
    if(r.error){b.innerHTML='<div style="color:var(--red)">'+escHtml(r.error)+'</div>';return;}
    const skipped=Object.keys(r.skipped||{}).sort().map(k=>
      '<div style="display:flex;justify-content:space-between;padding:2px 0"><span>'+escHtml(k)+'</span><span style="font-weight:600">'+r.skipped[k]+'</span></div>').join('');
    b.innerHTML=(r.rows.length
        ? '<div style="font-size:13px;color:var(--text);font-weight:700;margin-bottom:6px">'+r.rows.length+' drive'+(r.rows.length===1?'':'s')+' · '+r.miles+' mi</div>'+
          '<div style="max-height:34vh;overflow-y:auto;font-family:ui-monospace,monospace;line-height:1.7">'+
          r.rows.map(x=>'<div>'+escHtml(x.date)+' '+escHtml(x.from)+' → '+escHtml(x.to)+' · '+x.miles+'mi</div>').join('')+'</div>'
        : '<div style="font-size:13px;color:var(--text);font-weight:700;margin-bottom:6px">Nothing to bring back.</div>'+
          '<div>Every deleted row was either removed on purpose, already on the log, or not a business drive.</div>')+
      '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin:12px 0 4px">Left alone ('+r.scanned+' checked)</div>'+
      (skipped||'<div>Nothing.</div>');
  };
  _mileRestoreSwept({}).then(r=>{
    paint(r);
    const go=document.getElementById('_mile-restore-go');
    if(!go||!r.rows.length||r.error)return;
    go.style.display='';go.textContent='Restore '+r.rows.length;
    go.onclick=()=>{
      go.disabled=true;go.textContent='Restoring…';
      _mileRestoreSwept({apply:true}).then(res=>{
        go.style.display='none';
        const b=body();
        if(b)b.innerHTML=res.error
          ? '<div style="color:var(--red)">'+escHtml(res.error)+'</div>'
          : '<div style="font-size:13px;font-weight:700">'+res.restored+' drive'+(res.restored===1?'':'s')+' back on the log · '+res.miles+' mi</div>';
      });
    };
  });
}
window._mileRestorePanel=_mileRestorePanel;
const _MILE_DEDUP_DEST_FT=1500;         // fence radius + GPS scatter
// How much of the shorter drive has to sit inside the longer one before they
// are the same journey. High on purpose: two writers describing one drive
// agree almost exactly (the owner's 17:28 pair overlap 0.992), while a
// there-and-back that shares a boundary minute overlaps by almost nothing.
const _MILE_SAME_DRIVE_OVERLAP=0.5;
const _MILE_DEDUP_SLACK_MS=10*60000;    // manual rows only: loggedAt is a tap, not a clock
function _mileTripWindow(m){
  const end=Date.parse(m.endedIso||m.loggedAt||'')||0;
  const start=Date.parse(m.startedIso||m.loggedAt||'')||end;
  return {start:Math.min(start,end)||end,end:Math.max(start,end)};
}
// ── Who were they actually parked at ─────────────────────────────────────────
// A leg ending at an unrecognised stop writes "Stop" for the destination, and a
// mileage row reading "Shop -> Stop" is not a record anyone could defend a year
// later. It is not what the contractor would have typed either: they parked at
// Home Depot, and MapKit already knows the tenant at that pin.
//
// This also decides whether the trip belongs on the log AT ALL. Lunch is the
// case the owner called out (2026-08-02) walking a real Topeka day: the drive to
// wherever they ate is a personal errand, not business travel, and billing it
// inflates a deduction they would be the one defending. Food is the only
// category that disqualifies a stop, and only when Apple actually names it.
//
// Everything else STAYS, including a stop nobody can name. A contractor parked
// mid-workday is far more often at a supply yard or a gate than at a sandwich
// counter, and dropping a real leg costs them money in a way that keeping an
// unnamed one does not. Silence from the router is not evidence of lunch.
// Does a receipt at this pin prove the stop was a BUSINESS DESTINATION?
// expenseForStop answers "is there an expense here", which is not the same
// question (owner 2026-08-14, the Casey's run): vehicle-operating money
// (fuel, service, the truck itself) is already inside the standard mileage
// rate, so it can never be the evidence that makes a stop a destination.
// Counting it would deduct the same gallon twice, once in the rate and again
// as the trip taken to buy it. The exclusion reuses _isVehicleExpense, the
// SAME definition the Schedule C engine already excludes from the deduction,
// so the two engines can never drift apart on what a vehicle expense is.
// On an ACTUAL-expense vehicle the receipt is a real standalone deduction
// that is not baked into any rate, so there it still qualifies.
function _bizReceiptForStop(o){
  try{
    if(typeof expenseForStop!=='function')return null;
    const e=expenseForStop(o);
    if(!e)return null;
    if(typeof _isVehicleExpense==='function'&&_isVehicleExpense(e)){
      const veh=(typeof getVehicles==='function'&&typeof _vehLinkMatches==='function')
        ?getVehicles().find(v=>_vehLinkMatches(e,v)):null;
      // Unlinked vehicle money defaults to the mileage method, matching the
      // deduction engine's own default: the conservative read, and the one
      // that cannot invent miles.
      if(((veh&&veh.deductionMethod)||'mileage')!=='actual')return null;
    }
    return e;
  }catch(_e){return null;}
}
// ── Two pots of money, and they must never touch ─────────────────────────────
// The owner's standard-mileage deduction is miles driven in the OWNER'S
// vehicles. An employee driving their own car generates miles too, and in the
// states that require reimbursing them (California Labor Code 2802 is the one
// everybody knows, Illinois and Massachusetts have their own) the business owes
// that money. It is a business expense, and a real obligation, but it is not the
// owner's mileage deduction and putting it there inflates the deduction with
// miles the owner's vehicles never drove.
//
// Before this, those miles were simply not recorded at all: correct for the
// deduction, and it left a contractor in a reimbursement state with no record of
// what they already owed (owner, 2026-08-02). Now they are recorded and flagged,
// and every place that turns miles into a deduction goes through this filter, so
// there is ONE definition of whose miles those are rather than five.
// THREE POTS, not two. A trip whose vehicle nobody recorded belongs to neither
// side: it is not the owner's deduction, because we cannot say the company
// vehicle drove it, and it is not a debt to the crew member either, because we
// cannot say their own car did. It is a real drive, measured, waiting on one
// answer. Excluded from BOTH totals until it gets one.
//
// Recorded rather than discarded (owner, 2026-08-03) so the answer is still
// worth something later: drop the row and there is nothing left to fix when
// somebody remembers on Thursday that Danny was in his own truck.
function unattributedTrips(list){
  return (list||[]).filter(m=>m&&m.vehicleUnknown);
}
// pendingReceipt rows are HELD supply runs awaiting the receipt card's answer;
// personal rows were answered "not business". Both stay in the log (unbroken
// odometer story) and out of every money total, and this filter is the single
// choke point every total already flows through.
function deductibleTrips(list){
  return (list||[]).filter(m=>m&&!m.reimbursable&&!m.vehicleUnknown&&!m.pendingReceipt&&!m.personal);
}
function reimbursableTrips(list){
  return (list||[]).filter(m=>m&&m.reimbursable&&!m.vehicleUnknown&&!m.pendingReceipt&&!m.personal);
}
// ── Receipt-gated supply runs (owner design 2026-08-17) ─────────────────────
// The held legs of one store visit, grouped for the dashboard card.
function pendingSupplyRuns(){
  const by={};
  (mileage||[]).forEach(m=>{
    if(!m||!m.pendingReceipt||!m.supplyRunKey)return;
    (by[m.supplyRunKey]=by[m.supplyRunKey]||[]).push(m);
  });
  return Object.keys(by).map(k=>{
    const rows=by[k];
    // When the visit happened: the earliest clock any of its legs carries.
    // The card shows date and time only (owner 2026-08-17: no miles, no legs).
    const at=rows.map(m=>m.startedIso||m.created_at).filter(Boolean).sort()[0]||'';
    return {key:k,date:k.split('|')[0]||'',name:k.split('|').slice(1).join('|')||'Store',at,
      miles:rows.reduce((s,m)=>s+(m.miles||0),0),count:rows.length,rows};
  }).sort((a,b)=>b.date.localeCompare(a.date));
}
// One accordion per STORE (owner 2026-08-17): if a store has more than one
// unanswered visit, they nest under a single card instead of piling up as
// separate top-level cards. Visits inside sort oldest to newest; stores sort
// by their most recent activity.
function pendingSupplyStores(){
  const by={};
  pendingSupplyRuns().forEach(run=>{(by[run.name]=by[run.name]||[]).push(run);});
  return Object.keys(by).map(name=>{
    const visits=by[name].slice().sort((a,b)=>(a.at||a.date).localeCompare(b.at||b.date));
    const latestAt=visits[visits.length-1].at||visits[visits.length-1].date;
    return {name,visits,count:visits.length,latestAt};
  }).sort((a,b)=>(b.latestAt||'').localeCompare(a.latestAt||''));
}
// The shared delete path for held rows (owner 2026-08-17: Personal clears
// the trip from the log entirely, it never really belonged in the business
// account, so unlike No receipt/Scan receipt it is not kept-but-marked).
// Routed through _userDelete so every removed id is recorded as an EXPLICIT
// delete (js/cloud.js), which is what lets the sweep remove it on every
// other device instead of the sync engine resurrecting it.
function _supplyRunDeleteByKeys(keys){
  let n=0;
  const del=()=>{
    mileage=mileage.filter(m=>{
      if(m&&m.pendingReceipt&&m.supplyRunKey&&keys.has(m.supplyRunKey)){n++;return false;}
      return true;
    });
  };
  if(typeof _userDelete==='function')_userDelete(del);else del();
  return n;
}
// The three doors. 'personal' deletes the held rows outright. 'noreceipt'
// commits as business carrying a noReceipt flag (the disclaimer was shown
// before calling this). 'receipt' commits and links the expense that
// proved it.
function resolveSupplyRun(key,mode,expenseId){
  if(mode==='personal'){
    const n=_supplyRunDeleteByKeys(new Set([key]));
    if(n){saveAll();typeof renderDash==='function'&&renderDash();}
    return n;
  }
  let n=0;
  (mileage||[]).forEach(m=>{
    if(!m||m.supplyRunKey!==key||!m.pendingReceipt)return;
    delete m.pendingReceipt;n++;
    if(mode==='noreceipt'){m.noReceipt=true;}
    else if(mode==='receipt'&&expenseId!=null){m.receiptExpenseId=expenseId;}
  });
  if(n){saveAll();typeof renderDash==='function'&&renderDash();}
  return n;
}
// Unanswered for a week: it disappears (owner 2026-08-17), same delete path
// as tapping Personal by hand. No renderDash here on purpose, the sweep runs
// INSIDE the dashboard's own render pass (_renderDashSupplyHold), and calling
// back into renderDash from there would re-enter it mid-paint.
function _supplyRunSweep(){
  const cutoff=Date.now()-7*86400000;
  const keys=new Set();
  (mileage||[]).forEach(m=>{
    if(!m||!m.pendingReceipt||!m.supplyRunKey)return;
    const t=Date.parse((m.date||'')+'T12:00:00');
    if(isFinite(t)&&t<cutoff)keys.add(m.supplyRunKey);
  });
  const n=_supplyRunDeleteByKeys(keys);
  if(n)saveAll();
  return n;
}
function _supplyRunPersonal(k){
  resolveSupplyRun(decodeURIComponent(k),'personal');
  if(typeof showToast==='function')showToast('Cleared, kept off the books','🚗');
}
function _supplyRunNoReceipt(k){
  // Owner copy (2026-08-17): one plain line, not a tax lecture.
  zConfirm('Save this run as business without a receipt?\n\nThe IRS may disallow the mileage and the expense if no receipt is provided.',
    ()=>{resolveSupplyRun(decodeURIComponent(k),'noreceipt');if(typeof showToast==='function')showToast('Logged as business, no receipt on file','⚠️');},
    {title:'No receipt',yes:'Save as business'});
}
// Scan door: the existing quick-expense modal (it carries the receipt
// scanner). The run key rides INSIDE the modal as a hidden field, never a
// global, so backing out of the modal can never leak the key onto some later,
// unrelated expense.
function _supplyRunScan(k){
  const key=decodeURIComponent(k);
  // The button says SCAN RECEIPT, so it opens the receipt SCANNER (owner
  // 2026-08-26, screenshot in hand: this used to open the bare quick-expense
  // form, vendor prefilled, keyboard up, no camera anywhere, the exact manual
  // entry the button promised to replace). openExpenseFlow is the real flow:
  // camera capture, OCR fill, receipt pages stored on the expense, and its
  // save is what commits the held mileage (expSave reads the key below).
  if(typeof openExpenseFlow!=='function')return;
  openExpenseFlow();
  const m=document.getElementById('expense-modal');
  if(!m)return;
  // The key rides INSIDE the modal, synchronously, never a global: same rule
  // the quick-modal version learned on a WebKit CI race, and cancelling the
  // modal removes the key with it so it can never leak onto a later expense.
  const h=document.createElement('input');
  h.type='hidden';h.id='qe-supply-run';h.value=key;
  m.appendChild(h);
  // The run already knows the store and the DAY: the receipt in their hand is
  // dated the day of the visit, not the day they finally answered the card.
  const store=key.split('|').slice(1).join('|');
  const day=key.split('|')[0]||'';
  const v=m.querySelector('#em-vendor');
  if(v&&!v.value&&store)v.value=store;
  const dd=m.querySelector('#em-date');
  const dm=day.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(dd&&dm)dd.value=dm[2]+'/'+dm[3]+'/'+dm[1];
  const c=m.querySelector('#em-cat');
  if(c)c.value='materials';
  // Straight into the camera, still inside the tap's user gesture. If the
  // scanner cannot open (no camera, denied), the modal is already up with its
  // own Scan button, so nothing is lost.
  try{if(typeof expTriggerScan==='function')expTriggerScan();}catch(_e){}
}
// The one tap that settles an unattributed drive. 'truck' moves it into the
// deduction, 'own' into what the business owes them, 'rider' means they were a
// passenger and it is neither, so the row goes.
function attributeTrip(id,mode,vehicleId){
  const m=mileage.find(x=>String(x.id)===String(id));
  if(!m||!m.vehicleUnknown)return null;
  // Passenger: the drive was real but it is nobody's mileage, so the row goes.
  // Through _userDelete so the id is recorded as an EXPLICIT delete, which is
  // what lets the sweep remove it on the other devices instead of resurrecting
  // it (js/cloud.js _recordLocalDelete).
  if(mode==='rider'){_userDelete(()=>{mileage=mileage.filter(x=>x!==m);saveAll();});return null;}
  delete m.vehicleUnknown;
  if(mode==='own'){m.reimbursable=true;}
  else{
    delete m.reimbursable;
    const v=(typeof getVehicles==='function'?getVehicles():[]).find(x=>String(x.id)===String(vehicleId));
    if(v){m.vehicle=v.name||m.vehicle;m.vehicleId=v.id;}
  }
  saveAll();
  if(document.getElementById('mil-table'))renderAllMileage();
  return m;
}
// The select's one handler: routes the three answers into attributeTrip and
// repaints, so the panel row disappears the moment it is settled.
function _milAttrib(id,val){
  if(!val)return;
  if(val==='own'||val==='rider')attributeTrip(id,val);
  else attributeTrip(id,'truck',val);
  renderAllMileage();
}
// What the crew drove in their own cars this year, priced at the IRS rate.
//
// AN ESTIMATE, NOT AN AMOUNT LEGALLY OWED, and the distinction matters enough to
// state here because an earlier version of this comment got it wrong. There is
// no federal mileage reimbursement mandate at all: the IRS rate is a TAX figure,
// the ceiling on what can be reimbursed without becoming taxable wages. The
// states that do require reimbursement (California Labor Code 2802, Illinois
// 820 ILCS 115/9.5, Massachusetts) require "necessary expenditures", not a named
// rate. California case law (Gattuso v. Harte-Hanks, 2007) allows the IRS rate
// as a presumptively reasonable METHOD, and even there an employee may show
// their actual costs ran higher.
//
// So the IRS rate is a defensible default and a starting point for a written
// policy, not a number the app should tell a contractor they owe. The figure is
// labelled as an estimate wherever it renders, and what they actually pay is
// theirs to set with their own advisor.
function crewMilesOwed(yr){
  const y=String(yr||trackerYear||new Date().getFullYear());
  // SCOPED TO WHO IS LOOKING. Unscoped, this totalled every crew member's miles
  // and showed it to whichever one opened the page: one employee could read what
  // the whole crew was owed, which is money data they have no business seeing.
  // The rest of this page has always narrowed to the viewer's own rows for
  // exactly that reason, and this line was reading straight past it.
  const src=(typeof _isEmployee!=='undefined'&&_isEmployee)
    ? mileage.filter(m=>m.logged_by_id&&m.logged_by_id===(typeof _supaUser!=='undefined'&&_supaUser&&_supaUser.id))
    : mileage;
  const rows=reimbursableTrips(src).filter(m=>m.date&&String(m.date).startsWith(y));
  const miles=rows.reduce((s,m)=>s+(m.miles||0),0);
  const by={};
  rows.forEach(m=>{
    const who=m.logged_by_name||m.logged_by_id||'Crew';
    by[who]=(by[who]||0)+(m.miles||0);
  });
  return {miles:Math.round(miles*10)/10,owed:miles*IRS(y),trips:rows.length,by};
}
// What the destination IS decides the business purpose. This is the whole reason
// automatic mileage can be IRS-complete without asking anyone anything: the
// geofence already knows it arrived at a job, the yard, or a saved place, and a
// saved place's kind carries the SAME vocabulary the mileage log reports trips
// by (MILE_PURPOSES, js/constants.js), so a drive to Ferguson's tags "Supply
// run" and a drive to the shop tags "Shop", not a bucket of "Other" trips
// reporting can't break down. 'job' is the geofence's own kind for a scheduled
// job (never a place's kind), kept as its own branch rather than folded into
// the map below; 'Job site' and 'Estimate' purposes reach every trip that
// needs them through that branch alone, PLACE_KINDS (js/places.js) never
// offers those as a place type. 'Client Consult' DOES arrive automatically
// since client-address fences (2026-08-07): a 'client' destination carries
// its clientId, which is exactly what a Place never had. 'Payment
// Collection' remains manual-only (the geofence can't know money changed
// hands), though it stays a real, pickable purpose (MILE_PURPOSES is not
// scoped down).
const _PLACE_KIND_TO_PURPOSE={
  shop:'Shop',
  supply:'Supply run',
  home_office:'Home Office',
  business_meeting:'Business meeting',
};

// When a place is SAVED, the log it should have had catches up (owner
// 2026-08-26: "we should never miss saved geofence places"). Every drive that
// ended or began at this pin before it had a name was written as "Stop",
// because that is all anyone knew at the time. The contractor naming the pin
// is the missing fact arriving late, so the same patch the POI path applies
// when Apple answers late (_autoNameStopTrip's rename loop) runs here for the
// contractor's own answer, which outranks Apple's: their name, their address,
// and the purpose their chosen kind maps to. Only endpoints still reading
// "Stop" are touched, a row a human already edited is never overwritten, and
// purpose only moves off the anonymous default for the same reason.
function _placeRetroNameTrips(pl){
  try{
    if(!pl||pl.lat==null||pl.lon==null)return 0;
    if(typeof mileage==='undefined'||!Array.isArray(mileage))return 0;
    const ft=pl.fenceFt||((typeof PLACE_MATCH_FT!=='undefined')?PLACE_MATCH_FT:300);
    const near=c=>!!(c&&c.lat!=null&&typeof _placeDistFt==='function'&&_placeDistFt({lat:c.lat,lon:c.lng!=null?c.lng:c.lon},pl)<=ft);
    let n=0;
    mileage.forEach(m=>{
      if(!m||!m.gps)return;
      if(m.from_name==='Stop'&&near(m.fromCoord)){
        m.from_name=pl.name;
        if(m.from==='Stop'||!m.from)m.from=pl.addr||pl.name;
        n++;
      }
      if(m.to_name==='Stop'&&near(m.toCoord)){
        m.to_name=pl.name;
        if(m.to==='Stop'||!m.to)m.to=pl.addr||pl.name;
        if(!m.purpose||m.purpose==='Other')m.purpose=_autoTripPurpose({kind:pl.kind});
        n++;
      }
    });
    if(n){
      if(typeof saveAll==='function')saveAll();
      if(document.getElementById('mil-table')&&typeof renderAllMileage==='function')renderAllMileage();
    }
    return n;
  }catch(_e){return 0;}
}
function _autoTripPurpose(to){
  const k=(to&&to.kind)||'';
  if(k==='job')return 'Job site';
  // A spontaneous visit to a client with nothing scheduled: an estimate look,
  // a drop-in. The trip binds to the client record via to.clientId.
  // A won bid sitting unscheduled at this client is real work, not a
  // consult, whether or not anyone ever put it on a calendar (owner
  // 2026-08-18). geo-track.js only sets this when no job fenced first, so a
  // client with an actual scheduled job today is unaffected.
  if(k==='client')return (to&&to.queuedJob)?'Job site':'Client Consult';
  return _PLACE_KIND_TO_PURPOSE[k]||'Other';
}
// Whoever is driving, today's answer wins over the standing one.
//
// For CREW that is the only answer there is: no pick, no mileage, because
// guessing a truck for somebody else's morning is how a personal car ends up
// deducted. 'personal' means the miles are theirs, not the company's.
//
// For the OWNER the daily picker is a refinement, not a gate. They are asked
// only when they run two or more trucks, and dismissing the prompt has to cost
// them nothing, so an unanswered day falls back to the Fleet default.
function _autoTripVehicle(){
  const vehs=(typeof getVehicles==='function')?getVehicles():[];
  const id=localStorage.getItem('emp_vehicle_'+todayKey());
  if(_isEmployee){
    // Dispatch wins when it spoke. Only the person handing out keys can know
    // that three people are in one truck, so their answer outranks anything
    // tapped on a single phone. A rider logs no miles: those miles are already
    // on the driver's row, and billing them twice is an inflated deduction.
    const a=(typeof _myTruckToday==='function')?_myTruckToday():null;
    if(a)return a.mode==='truck'?(vehs.find(v=>String(v.id)===String(a.v))||null):null;
    if(!id||id==='personal')return null;
    return vehs.find(v=>String(v.id)===String(id))||null;
  }
  if(id&&id!=='personal'){
    const picked=vehs.find(v=>String(v.id)===String(id));
    if(picked)return picked;                    // a stale id falls through to the default
  }
  return (typeof getDefaultVehicle==='function')?getDefaultVehicle():null;
}
function _photonGeocode(addr){
  const bias=(S.weatherLat&&S.weatherLon)?'&lat='+S.weatherLat+'&lon='+S.weatherLon:'&lat=37.6922&lon=-97.3375';
  return fetch('https://photon.komoot.io/api/?q='+encodeURIComponent(addr)+'&limit=1'+bias+'&lang=en')
    .then(r=>r.json())
    .then(d=>{
      if(!d||!d.features||!d.features.length)throw new Error('Address not found: "'+addr+'"');
      const[lon,lat]=d.features[0].geometry.coordinates;
      return{lat,lng:lon};
    })
    .catch(()=>null);
}
async function _resolveCoords(addrText){
  try{
    const r=await _geocodeAddress(addrText,1);
    if(r.length)return{lat:r[0].lat,lng:r[0].lon};
  }catch(e){}
  return _photonGeocode(addrText);
}
function _haversineMiles(c1,c2){
  const R=3958.8,toR=Math.PI/180;
  const dLat=(c2.lat-c1.lat)*toR,dLon=(c2.lng-c1.lng)*toR;
  const a=Math.sin(dLat/2)**2+Math.cos(c1.lat*toR)*Math.cos(c2.lat*toR)*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
// ── What business is at this coordinate ──────────────────────────────────────
// A repeat stop the app has learned is a bare lat/lon, and asking a contractor
// to name it means typing "Home Depot" on a phone while standing in a parking
// lot. MapKit already knows what building they parked at, so it answers instead
// and they confirm.
//
// Two lookups, nearest-POI first: reverse geocoding a parking lot returns the
// STREET ADDRESS, which is exactly the useless answer. A points-of-interest
// search returns the tenant, which is the name that belongs on the record and
// on every mileage row that ends there.
//
// Returns {name,category} or null, and null is a fine answer: the modal just
// opens with an empty name, which is what it did before any of this.
// The tenant standing closest to the pin. A result with no coordinate cannot be
// ranked, so it only wins when nothing else can be measured at all: better a
// name Apple offered than no name.
function _poiNearest(list,pin){
  let best=null,bestFt=Infinity;
  (list||[]).forEach(x=>{
    if(!x||!x.name||!x.coordinate)return;
    const ft=_haversineMiles(pin,{lat:x.coordinate.latitude,lng:x.coordinate.longitude})*5280;
    if(ft<bestFt){bestFt=ft;best=x;}
  });
  return best||(list||[]).find(x=>x&&x.name)||null;
}
async function _poiAt(coord){
  if(!_mapkitReady||typeof mapkit==='undefined'||!coord||coord.lat==null)return null;
  const lat=coord.lat,lng=coord.lng!=null?coord.lng:coord.lon;
  const near=new mapkit.Coordinate(lat,lng);
  // ~250m box: big enough for a big-box store's lot, small enough that it can't
  // return the shop next door.
  try{
    if(mapkit.PointsOfInterestSearch){
      const region=new mapkit.CoordinateRegion(near,new mapkit.CoordinateSpan(0.0045,0.0045));
      const res=await new Promise((resolve,reject)=>{
        const s=new mapkit.PointsOfInterestSearch({region});
        s.search((err,data)=>{ if(err||!data||!data.places||!data.places.length){reject(new Error('poi'));return;} resolve(data.places); });
      });
      // NEAREST, not first. The results are not ordered by distance from the
      // pin, so taking res[0] in a shopping centre returns whichever tenant
      // Apple felt like listing first: the owner's own Home Depot stop came
      // back as "I Sold It On Ebay" two units down, carrying Home Depot's
      // street address (2026-08-02). The box has to stay big enough to cover a
      // big-box store's car park, so the box cannot be what disambiguates; the
      // distance has to.
      const p=_poiNearest(res,{lat,lng});
      if(p&&p.name)return {name:p.name,category:p.pointOfInterestCategory||'',addr:p.formattedAddress||''};
    }
  }catch(_e){}
  try{
    const p=await new Promise((resolve,reject)=>{
      new mapkit.Geocoder().reverseLookup(near,(err,data)=>{
        if(err||!data||!data.results||!data.results.length){reject(new Error('geo'));return;}
        resolve(data.results[0]);
      });
    });
    // Only a NAME, never the formatted address: "1100 SW Wanamaker Rd" tells the
    // contractor nothing they did not already know from the pin, so it must not
    // be offered as what the place is CALLED. It is still worth having as the
    // address though, which is why it comes back on its own field with a null
    // name rather than as nothing at all: every caller already guards on
    // poi.name, so a nameless answer reads the same as no answer to them, and
    // the mileage row gets a street address it otherwise would not have.
    if(p&&p.name&&p.name!==p.formattedAddress)return {name:p.name,category:p.pointOfInterestCategory||'',addr:p.formattedAddress||''};
    if(p&&p.formattedAddress)return {name:null,category:'',addr:p.formattedAddress};
  }catch(_e){}
  return null;
}
// Apple's POI categories mapped onto the kinds a contractor cares about.
//
// A SUGGESTION ONLY. This prefills the kind dropdown when they save a new place
// (js/places.js) and names the purpose on a receipt-backed stop that has no
// saved place yet. It decides no money on its own: what makes a stop
// deductible is the place THEY saved, or a receipt (see _autoNameStopTrip).
// A previous version of this file guessed supply houses from their names; that
// guess is deleted, because whether a shop is a supply house is the
// contractor's call.
function _poiPlaceKind(category){
  const c=String(category||'');
  if(/Hardware|Building|Lumber|Wholesale|Warehouse|Supply/i.test(c))return 'supply';
  if(/Restaurant|Cafe|Food|Bakery|Brewery|Bar/i.test(c))return 'other';
  return 'supply';
}
async function _routeDistance(fromCoords,toCoords){
  // MapKit Directions, primary
  if(_mapkitReady){
    try{
      return await new Promise((resolve,reject)=>{
        const d=new mapkit.Directions();
        d.route({
          origin:new mapkit.Coordinate(fromCoords.lat,fromCoords.lng),
          destination:new mapkit.Coordinate(toCoords.lat,toCoords.lng),
          transportType:mapkit.Directions.Transport.Automobile,
          requestsAlternateRoutes:false
        },(err,data)=>{
          if(err||!data?.routes?.[0]){reject(new Error('mapkit'));return;}
          const r=data.routes[0];
          resolve({miles:Math.round(r.distance/1609.344*10)/10,mins:Math.round(r.expectedTravelTime/60)});
        });
      });
    }catch(e){}
  }
  // Fallback: Valhalla + OSRM in parallel
  const body={locations:[{lon:fromCoords.lng,lat:fromCoords.lat},{lon:toCoords.lng,lat:toCoords.lat}],costing:'auto',directions_options:{units:'miles'}};
  const valhallaP=fetch('https://valhalla1.openstreetmap.de/route',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)})
    .then(r=>r.json()).then(d=>{
      if(d?.trip)return{miles:Math.round(d.trip.summary.length*10)/10,mins:Math.round(d.trip.summary.time/60)};
      throw new Error('valhalla');
    });
  const osrmP=fetch(`https://router.project-osrm.org/route/v1/driving/${fromCoords.lng},${fromCoords.lat};${toCoords.lng},${toCoords.lat}?overview=false`,{signal:AbortSignal.timeout(10000)})
    .then(r=>r.json()).then(d=>{
      if(d?.code==='Ok'&&d.routes?.[0])return{miles:Math.round(d.routes[0].distance/1609.344*10)/10,mins:Math.round(d.routes[0].duration/60)};
      throw new Error('osrm');
    });
  return Promise.any([valhallaP,osrmP]);
}
// Keep _valhallaRoute as alias so any existing saved references still work
const _valhallaRoute=_routeDistance;
function startDriveToClient(){
  const c=getClientById(currentClientId);if(!c)return;
  const hasWon=bids.some(b=>b.client_id===currentClientId&&b.status==='Closed Won');
  const hasPending=bids.some(b=>b.client_id===currentClientId&&b.status==='Pending');
  const purpose=hasWon?'Job site':hasPending?'Estimate':'Estimate';
  openDriveModal({toAddress:c.addr||'',clientName:c.name,clientId:c.id,purpose});
}
async function _geocodeAddress(val,limit,biasLat,biasLon){
  limit=limit||5;
  // MapKit JS, Apple Maps database, every US address (primary)
  if(_mapkitReady){
    return new Promise(resolve=>{
      const _mkLat=biasLat||S.weatherLat||39.5,_mkLon=biasLon||S.weatherLon||-98.35;
      const _hasLoc=!!(biasLat||S.weatherLat);
      const search=new mapkit.Search({
        language:'en-US',
        region:new mapkit.CoordinateRegion(new mapkit.Coordinate(_mkLat,_mkLon),new mapkit.CoordinateSpan(_hasLoc?3:25,_hasLoc?5:60))
      });
      search.search(val,(err,data)=>{
        if(err||!data||!data.places){resolve([]);return;}
        const us=data.places.filter(p=>p.countryCode==='US');
        resolve(us.slice(0,limit).map(p=>({
          name:p.name||'',
          line1:p.fullThoroughfare||[p.subThoroughfare,p.thoroughfare].filter(Boolean).join(' ')||p.name||'',
          line2:[p.locality,p.administrativeAreaCode,p.postCode].filter(Boolean).join(', '),
          street:p.fullThoroughfare||[p.subThoroughfare,p.thoroughfare].filter(Boolean).join(' ')||'',
          city:p.locality||'',
          state:p.administrativeAreaCode||'',
          zip:p.postCode||'',
          lat:p.coordinate?.latitude||0,
          lon:p.coordinate?.longitude||0
        })));
      });
    });
  }
  // Photon + Census in parallel
  const _bLat=biasLat||S?.weatherLat||37.6922,_bLon=biasLon||S?.weatherLon||-97.3375;
  const bias='&lat='+_bLat+'&lon='+_bLon;
  const photonP=fetch('https://photon.komoot.io/api/?q='+encodeURIComponent(val)+'&limit='+(limit+1)+bias+'&lang=en').then(r=>r.json()).catch(()=>null);
  const censusP=fetch('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address='+encodeURIComponent(val)+'&benchmark=Public_AR_Current&format=json').then(r=>r.json()).catch(()=>null);
  const pd=await photonP;
  const pf=(pd?.features||[]).filter(f=>{const p=f.properties||{};return p.street&&(p.city||p.town||p.village);}).slice(0,limit);
  if(pf.length>0){
    return pf.map(f=>{
      const p=f.properties||{};
      const street=(p.housenumber?p.housenumber+' ':'')+p.street;
      const city=p.city||p.town||p.village||'';
      const state=_STATE_ABBR[p.state]||p.state||'';
      const zip=p.postcode||'';
      const[lon,lat]=f.geometry.coordinates;
      return{name:p.name||'',line1:street,line2:[city,state,zip].filter(Boolean).join(', '),street,city,state,zip,lat,lon};
    });
  }
  const cd=await censusP;
  return(cd?.result?.addressMatches||[]).slice(0,limit).map(m=>{
    const parts=(m.matchedAddress||'').split(', ');
    return{name:'',line1:parts[0]||'',line2:[parts[1],parts[2],parts[3]].filter(Boolean).join(' '),
      street:parts[0]||'',city:parts[1]||'',state:parts[2]||'',zip:parts[3]||'',
      lat:m.coordinates?.y||0,lon:m.coordinates?.x||0};
  });
}
// ── Shared address autocomplete (Photon) ─────────────────────────────────────
const _STATE_ABBR={'Alabama':'AL','Alaska':'AK','Arizona':'AZ','Arkansas':'AR','California':'CA','Colorado':'CO','Connecticut':'CT','Delaware':'DE','Florida':'FL','Georgia':'GA','Hawaii':'HI','Idaho':'ID','Illinois':'IL','Indiana':'IN','Iowa':'IA','Kansas':'KS','Kentucky':'KY','Louisiana':'LA','Maine':'ME','Maryland':'MD','Massachusetts':'MA','Michigan':'MI','Minnesota':'MN','Mississippi':'MS','Missouri':'MO','Montana':'MT','Nebraska':'NE','Nevada':'NV','New Hampshire':'NH','New Jersey':'NJ','New Mexico':'NM','New York':'NY','North Carolina':'NC','North Dakota':'ND','Ohio':'OH','Oklahoma':'OK','Oregon':'OR','Pennsylvania':'PA','Rhode Island':'RI','South Carolina':'SC','South Dakota':'SD','Tennessee':'TN','Texas':'TX','Utah':'UT','Vermont':'VT','Virginia':'VA','Washington':'WA','West Virginia':'WV','Wisconsin':'WI','Wyoming':'WY','District of Columbia':'DC'};
let _addrSugTimer=null;let _addrSugGen=0;
function _addrSugSearch(val,suggId,streetId,cityId,stateId,zipId){
  clearTimeout(_addrSugTimer);
  const box=document.getElementById(suggId);if(!box)return;
  if(val.length<3){box.style.display='none';return;}
  _addrSugTimer=setTimeout(async()=>{
    const gen=++_addrSugGen;
    try{
      const results=await _geocodeAddress(val,5);
      if(gen!==_addrSugGen)return;
      if(!results.length){box.style.display='none';return;}
      box.innerHTML=results.map(res=>{
        const s1=res.street.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
        const s2=res.city.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
        const s3=res.state.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
        const s4=res.zip.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
        return '<div onmousedown="event.preventDefault()" onclick="_addrSugSelect(\''+suggId+'\',\''+streetId+'\',\''+cityId+'\',\''+stateId+'\',\''+zipId+'\',\''+s1+'\',\''+s2+'\',\''+s3+'\',\''+s4+'\')" style="padding:10px 14px;border-bottom:1px solid var(--border);cursor:pointer">'+
          '<div style="font-size:13px;font-weight:600;color:var(--text)">'+escHtml(res.line1)+'</div>'+
          '<div style="font-size:11px;color:var(--text3);margin-top:1px">'+escHtml(res.line2)+'</div>'+
        '</div>';
      }).join('');
      box.style.display='block';
    }catch(e){if(box)box.style.display='none';}
  },220);
}
function _addrSugSelect(suggId,streetId,cityId,stateId,zipId,street,city,state,zip){
  const set=(id,v)=>{const el=document.getElementById(id);if(el)el.value=v;};
  set(streetId,street);set(cityId,city);set(stateId,state);set(zipId,zip);
  const box=document.getElementById(suggId);if(box)box.style.display='none';
  // Call the dependent UI update directly rather than re-dispatching a bubbling 'input'
  // event on the street field, that event re-fires the SAME inline oninput handler that
  // opened this box, which calls _addrSugSearch again and reopens the suggestion list
  // ~220ms later for the address the user just picked (the "bubble won't go away" bug).
  if(typeof _updateAddrComputed==='function')_updateAddrComputed();
  // For existing clients, fire lookup immediately on address selection
  if(editClientId&&street&&city)_lookupPropertyData(editClientId,{street,city,state,zip});
}
// ── _addrAutoFull, shared single-field address autocomplete ─────────────────
// inputEl  : the <input> element to attach autocomplete to
// onSelect : function(fullAddr, street, city, state, zip) called on pick
// Creates a suggestion <div> immediately after the input (parent must be
// position:relative), debounces at 280ms, uses _geocodeAddress().
let _addrAutoFullTimers=new WeakMap(),_addrAutoFullGen=new WeakMap();
function _addrAutoFull(inputEl,onSelect){
  if(!inputEl||inputEl._addrAutoFullBound)return;
  inputEl._addrAutoFullBound=true;
  let box=document.createElement('div');
  box.style.cssText='display:none;position:absolute;left:0;right:0;top:100%;background:var(--bg2);border:1.5px solid var(--border2);border-radius:var(--r);box-shadow:0 6px 20px rgba(0,0,0,.15);z-index:9999;max-height:240px;overflow-y:auto';
  const parent=inputEl.parentElement;
  if(parent&&getComputedStyle(parent).position==='static')parent.style.position='relative';
  inputEl.insertAdjacentElement('afterend',box);
  function hide(){box.style.display='none';}
  inputEl.addEventListener('input',function(){
    const val=this.value;
    clearTimeout(_addrAutoFullTimers.get(inputEl));
    if(!val||val.length<3){hide();return;}
    const t=setTimeout(async()=>{
      const gen=(_addrAutoFullGen.get(inputEl)||0)+1;
      _addrAutoFullGen.set(inputEl,gen);
      try{
        const results=await _geocodeAddress(val,4);
        if(_addrAutoFullGen.get(inputEl)!==gen)return;
        if(!results.length){hide();return;}
        box.innerHTML=results.map(res=>{
          const full=[res.street,res.city,[res.state,res.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
          return '<div data-full="'+escHtml(full)+'" style="padding:10px 14px;border-bottom:1px solid var(--border);cursor:pointer">'+
            '<div style="font-size:13px;font-weight:600;color:var(--text)">'+escHtml(res.line1)+'</div>'+
            '<div style="font-size:11px;color:var(--text3);margin-top:1px">'+escHtml(res.line2)+'</div>'+
            '</div>';
        }).join('');
        Array.from(box.children).forEach((el,i)=>{
          const res=results[i];
          const full=[res.street,res.city,[res.state,res.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
          el.addEventListener('mousedown',e=>e.preventDefault());
          el.addEventListener('click',()=>{
            inputEl.value=full;hide();
            if(typeof onSelect==='function')onSelect(full,res.street,res.city,res.state,res.zip);
          });
        });
        box.style.display='block';
      }catch(e){hide();}
    },280);
    _addrAutoFullTimers.set(inputEl,t);
  });
  inputEl.addEventListener('blur',function(){setTimeout(hide,150);});
}
function _getRecentFromAddresses(limit=8){
  const seen=new Map();
  for(let i=0;i<mileage.length;i++){
    const addr=(mileage[i].to||'').trim();
    if(!addr)continue;
    const key=addr.toLowerCase();
    if(!seen.has(key)){
      seen.set(key,{addr,poi_name:mileage[i].to_name||'',client_name:mileage[i].client_name||''});
    }else if(!seen.get(key).poi_name&&mileage[i].to_name){
      seen.get(key).poi_name=mileage[i].to_name;
    }
    if(seen.size>=limit)break;
  }
  return[...seen.values()];
}
function _showRecentFromAddresses(){
  const sugg=document.getElementById('lm-from-sugg');if(!sugg)return;
  const recents=_getRecentFromAddresses();
  if(!recents.length){sugg.style.display='none';sugg.innerHTML='';return;}
  sugg.innerHTML='<div style="padding:4px 10px 2px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3)">Recent</div>'+
    recents.map(r=>{const sa=r.addr.replace(/\\/g,'\\\\').replace(/'/g,"\\'");const sp=(r.poi_name||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");return'<div onclick="_selectRecentFrom(\''+sa+'\',\''+sp+'\')" style="padding:9px 14px;cursor:pointer;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--border)" onmouseenter="this.style.background=\'var(--bg2)\'" onmouseleave="this.style.background=\'\'">'+
      '<span style="font-size:16px;color:var(--text3)">'+svgIcon('🕐',{size:16})+'</span>'+
      '<div>'+(r.poi_name?'<div style="font-size:13px;font-weight:700;color:var(--text)">'+escHtml(r.poi_name)+'</div><div style="font-size:11px;color:var(--text3)">'+escHtml(r.addr)+'</div>':'<div style="font-size:13px;color:var(--text)">'+escHtml(r.addr)+'</div>')+(r.client_name?'<div style="font-size:11px;color:var(--text3)">'+escHtml(r.client_name)+'</div>':'')+
      '</div></div>';}).join('');
  sugg.style.display='block';
}
function _selectRecentFrom(addr,poiName=''){
  const inp=document.getElementById('lm-from');if(!inp)return;
  inp.value=addr;_lmCoords.from=null;
  const nameInp=document.getElementById('lm-from-name');if(nameInp)nameInp.value=poiName||'';
  const sugg=document.getElementById('lm-from-sugg');if(sugg){sugg.innerHTML='';sugg.style.display='none';}
  const chip=document.getElementById('lm-from-chip');const chipTxt=document.getElementById('lm-from-chip-txt');
  if(chip&&chipTxt){chipTxt.textContent=poiName||addr;chip.style.display='inline-flex';}
  if(addr)_photonGeocode(addr).then(c=>{if(c)_lmCoords.from=c;}).catch(()=>{});
  const toVal=(document.getElementById('lm-to')?.value||'').trim();
  if(addr&&toVal)_previewRoute(addr,toVal);
}
function _getRecentDestinations(limit=10){
  const seen=new Map();
  for(let i=0;i<mileage.length;i++){
    const addr=(mileage[i].to||'').trim();
    if(!addr)continue;
    const key=addr.toLowerCase();
    if(!seen.has(key)){
      seen.set(key,{addr,poi_name:mileage[i].to_name||'',client_name:mileage[i].client_name||''});
    }else if(!seen.get(key).poi_name&&mileage[i].to_name){
      seen.get(key).poi_name=mileage[i].to_name;
    }
    if(seen.size>=limit)break;
  }
  return[...seen.values()];
}
function _showRecentDestinations(){
  const sugg=document.getElementById('lm-to-sugg');if(!sugg)return;
  const recents=_getRecentDestinations();
  if(!recents.length){sugg.style.display='none';sugg.innerHTML='';return;}
  sugg.innerHTML='<div style="padding:4px 10px 2px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3)">Recent</div>'+
    recents.map(r=>{const sa=r.addr.replace(/\\/g,'\\\\').replace(/'/g,"\\'");const sp=(r.poi_name||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");return'<div onclick="_selectRecentDest(\''+sa+'\',\''+sp+'\')" style="padding:9px 14px;cursor:pointer;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--border)" onmouseenter="this.style.background=\'var(--bg2)\'" onmouseleave="this.style.background=\'\'">'+
      '<span style="font-size:16px;color:var(--text3)">'+svgIcon('🕐',{size:16})+'</span>'+
      '<div>'+(r.poi_name?'<div style="font-size:13px;font-weight:700;color:var(--text)">'+escHtml(r.poi_name)+'</div><div style="font-size:11px;color:var(--text3)">'+escHtml(r.addr)+'</div>':'<div style="font-size:13px;color:var(--text)">'+escHtml(r.addr)+'</div>')+(r.client_name?'<div style="font-size:11px;color:var(--text3)">'+escHtml(r.client_name)+'</div>':'')+
      '</div></div>';}).join('');
  sugg.style.display='block';
}
function _selectRecentDest(addr,poiName=''){
  const inp=document.getElementById('lm-to');if(!inp)return;
  inp.value=addr;_lmCoords.to=null;
  const nameInp=document.getElementById('lm-to-name');if(nameInp)nameInp.value=poiName||'';
  const sugg=document.getElementById('lm-to-sugg');if(sugg){sugg.innerHTML='';sugg.style.display='none';}
  const chip=document.getElementById('lm-to-chip');if(chip){chip.textContent=poiName||addr;chip.style.display='inline-block';}
  if(addr)_photonGeocode(addr).then(c=>{if(c)_lmCoords.to=c;}).catch(()=>{});
  const fromVal=(document.getElementById('lm-from')?.value||'').trim();
  if(fromVal&&addr)_previewRoute(fromVal,addr);
}
async function _previewRoute(fromAddr,toAddr){
  try{
    let fc=_lmCoords.from,tc=_lmCoords.to;
    if(!fc)fc=await _resolveCoords(fromAddr);
    if(!tc)tc=await _resolveCoords(toAddr);
    const{miles,mins}=await _routeDistance(fc,tc);
    const mv=document.getElementById('lm-miles-val');if(mv)mv.value=miles;
    const md=document.getElementById('lm-miles-display');if(md)md.textContent=miles.toFixed(1)+' miles';
    const td=document.getElementById('lm-time-display');if(td)td.textContent='~'+mins+' min drive · IRS deduction: '+fmt(miles*IRS());
    const rr=document.getElementById('lm-route-result');if(rr)rr.style.display='block';
    const rc=document.getElementById('lm-recalc-row');if(rc)rc.style.display='block';
  }catch(e){}
}
function _tripDestSearch(val){
  clearTimeout(_tripDestTimer);
  const box=document.getElementById('lm-to-sugg');if(!box)return;
  const chip=document.getElementById('lm-to-chip');if(chip)chip.style.display='none';
  _lmCoords.to=null;
  if(!val||val.length<2){_showRecentDestinations();return;}
  const clientMatches=clients.filter(c=>c.name&&c.name.toLowerCase().includes(val.toLowerCase())&&c.addr).slice(0,4);
  _tripDestTimer=setTimeout(async()=>{
    let html=clientMatches.map(c=>'<div onclick="_selectTripClient('+c.id+')" style="padding:10px 14px;border-bottom:1px solid var(--border);cursor:pointer">'+
      '<div style="font-size:13px;font-weight:700;color:var(--text)">'+svgIcon('👤',{size:13})+' '+escHtml(c.name)+'</div>'+
      '<div style="font-size:11px;color:var(--text3);margin-top:1px">'+escHtml(c.addr||'')+'</div>'+
    '</div>').join('');
    try{
      // Resolve From-field bias: prefer already-geocoded coords, then GPS cache,
      // then geocode the From input text via MapKit so bias always tracks the actual starting location
      let _fromBias=_lmCoords.from||_tripGpsCoords||null;
      if(!_fromBias){
        const fromVal=(document.getElementById('lm-from')?.value||'').trim();
        if(fromVal){
          if(_fromBiasCache.val===fromVal&&_fromBiasCache.coords){
            _fromBias=_fromBiasCache.coords;
          } else if(fromVal.length>4){
            try{
              const fr=await _geocodeAddress(fromVal,1);
              if(fr.length){_fromBias={lat:fr[0].lat,lng:fr[0].lon};_fromBiasCache={val:fromVal,coords:_fromBias};}
            }catch(e){}
          }
        }
      }
      let results=await _geocodeAddress(val,5,_fromBias?.lat||null,_fromBias?.lng||null);
      // Bias may cut off distant locations (e.g. MT address when starting from KS), retry unbiased
      if(!results.length&&_fromBias)results=await _geocodeAddress(val,5);
      results.forEach(res=>{
        const safeL1=res.line1.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
        const safeL2=res.line2.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
        const safeName=(res.name||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
        const isPoi=res.name&&res.name.toLowerCase()!==res.line1.toLowerCase();
        html+='<div onclick="selectTripPlace(\'lm-to\',\'lm-to-sugg\',\'to\',\''+safeL1+'\',\''+safeL2+'\','+res.lat+','+res.lon+',\''+safeName+'\')" style="padding:10px 14px;border-bottom:1px solid var(--border);cursor:pointer">'+
          (isPoi?
            '<div style="font-size:13px;font-weight:700;color:var(--text)">'+svgIcon('📍',{size:13})+' '+escHtml(res.name)+'</div>'+
            '<div style="font-size:11px;color:var(--text3);margin-top:1px">'+escHtml(res.line1)+(res.line2?', '+escHtml(res.line2):'')+'</div>':
            '<div style="font-size:13px;font-weight:600;color:var(--text)">'+escHtml(res.line1)+'</div>'+
            (res.line2?'<div style="font-size:11px;color:var(--text3);margin-top:1px">'+escHtml(res.line2)+'</div>':''))+
        '</div>';
      });
    }catch(e){}
    if(html){box.innerHTML=html;box.style.display='block';}else{box.style.display='none';}
  },200);
}
async function _selectTripClient(clientId){
  const c=clients.find(x=>x.id===clientId);if(!c)return;
  const box=document.getElementById('lm-to-sugg');if(box)box.style.display='none';
  const h=document.getElementById('lm-client');if(h)h.value=c.id;
  // Client has 2+ properties: open the SHARED address picker (same component the
  // estimate uses) so the drive lands on the right one, then fill. One address:
  // fill straight through, no extra tap.
  const addrs=(typeof clientAddresses==='function')?clientAddresses(c):[];
  if(addrs.length>1&&typeof pickClientAddress==='function'){
    pickClientAddress(clientId,addr=>_tripFillDest(c,addr));
    return;
  }
  _tripFillDest(c,c.addr||'');
}
async function _tripFillDest(c,addr){
  const inp=document.getElementById('lm-to');if(inp)inp.value=addr||'';
  _lmCoords.to=null;
  const chip=document.getElementById('lm-to-chip');const chipTxt=document.getElementById('lm-to-chip-txt');
  if(chip&&chipTxt){chipTxt.textContent=c.name+(addr?' · '+addr:'');chip.style.display='inline-flex';}
  const mv=document.getElementById('lm-miles-val');if(mv)mv.value='0';
  const rr=document.getElementById('lm-route-result');if(rr)rr.style.display='none';
  // Geocode address now so calculateAndShowRoute has coordinates ready
  if(addr){
    try{
      const results=await _geocodeAddress(addr,1);
      if(results.length)_lmCoords.to={lat:results[0].lat,lng:results[0].lon};
    }catch(e){}
  }
  if((document.getElementById('lm-from')?.value||'').trim())setTimeout(calculateAndShowRoute,100);
}
function tripPlaceSearch(fieldId,suggId,val){
  clearTimeout(_tripSearchTimers[fieldId]);
  const box=document.getElementById(suggId);if(!box)return;
  const chipId=fieldId==='lm-from'?'lm-from-chip':'lm-to-chip';
  const chip=document.getElementById(chipId);if(chip)chip.style.display='none';
  if(fieldId==='lm-from')_fromBiasCache={val:null,coords:null}; // clear stale bias when From changes
  const ckey=fieldId==='lm-from'?'from':'to';_lmCoords[ckey]=null;
  if(val.length<2){if(fieldId==='lm-from')_showRecentFromAddresses();else box.style.display='none';return;}
  _tripSearchTimers[fieldId]=setTimeout(async()=>{
    try{
      const whichKey=fieldId==='lm-from'?'from':'to';
      const _searchBias=_tripGpsCoords||(whichKey==='to'?(_lmCoords.from||null):null);
      const results=await _geocodeAddress(val,6,_searchBias?.lat||null,_searchBias?.lng||null);
      if(!results.length){box.style.display='none';return;}
      box.innerHTML=results.map(res=>{
        const safeL1=res.line1.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
        const safeL2=res.line2.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
        const safeName=(res.name||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
        const isPoi=res.name&&res.name.toLowerCase()!==res.line1.toLowerCase();
        return '<div onclick="selectTripPlace(\''+fieldId+'\',\''+suggId+'\',\''+whichKey+'\',\''+safeL1+'\',\''+safeL2+'\','+res.lat+','+res.lon+',\''+safeName+'\')" style="padding:10px 14px;border-bottom:1px solid var(--border);cursor:pointer">'+
          (isPoi?
            '<div style="font-size:13px;font-weight:700;color:var(--text)">'+svgIcon('📍',{size:13})+' '+escHtml(res.name)+'</div>'+
            '<div style="font-size:11px;color:var(--text3);margin-top:1px">'+escHtml(res.line1)+(res.line2?', '+escHtml(res.line2):'')+'</div>':
            '<div style="font-size:13px;font-weight:600;color:var(--text)">'+escHtml(res.line1)+'</div>'+
            (res.line2?'<div style="font-size:11px;color:var(--text3);margin-top:1px">'+escHtml(res.line2)+'</div>':''))+
        '</div>';
      }).join('');
      box.style.display='block';
    }catch(e){if(box)box.style.display='none';}
  },200);
}
function selectTripPlace(fieldId,suggId,coordKey,line1,line2,lat,lng,name){
  const full=line2?line1+', '+line2:line1;
  const inp=document.getElementById(fieldId);if(inp)inp.value=full;
  _lmCoords[coordKey]={lat,lng};
  const box=document.getElementById(suggId);if(box)box.style.display='none';
  const mv=document.getElementById('lm-miles-val');if(mv)mv.value='0';
  const rr=document.getElementById('lm-route-result');if(rr)rr.style.display='none';
  // Show verified address chip, prefer business name when available
  const chipId=fieldId==='lm-from'?'lm-from-chip':'lm-to-chip';
  const chip=document.getElementById(chipId);
  const chipTxt=document.getElementById(chipId+'-txt');
  const isPoi=name&&name.toLowerCase()!==line1.toLowerCase();
  const displayName=isPoi?name:full;
  if(chip&&chipTxt){chipTxt.textContent=displayName;chip.style.display='inline-flex';}
  // Store POI name for saving with mileage record
  const nameInputId=fieldId==='lm-from'?'lm-from-name':'lm-to-name';
  const nameInp=document.getElementById(nameInputId);if(nameInp)nameInp.value=isPoi?name:'';
  if(coordKey==='to'&&(document.getElementById('lm-from')?.value||'').trim())setTimeout(calculateAndShowRoute,100);
}
function fillTripSuggestion(clientId,addr,purpose){
  const toInp=document.getElementById('lm-to');
  if(toInp&&addr){toInp.value=addr;_lmCoords.to=null;}
  if(clientId){
    const sel=document.getElementById('lm-client');
    if(sel)sel.value=String(clientId);
  }
  if(purpose){
    document.getElementById('lm-purpose').value=purpose;
    const sel=document.getElementById('lm-trip-type-sel');if(sel)sel.value=purpose;
  }
  const mv=document.getElementById('lm-miles-val');if(mv)mv.value='0';
  const rr=document.getElementById('lm-route-result');if(rr)rr.style.display='none';
}
function openLogTripModal(opts){
  opts=opts||{};
  const today=todayKey();
  const vehs=getVehicles();
  let selVeh=opts.vehicle||(vehs.length===1?vehs[0].name:'');
  if(!selVeh&&_isEmployee){
    const _empVehId=localStorage.getItem('emp_vehicle_'+today);
    if(_empVehId){
      const _empVeh=vehs.find(v=>String(v.id)===String(_empVehId));
      if(_empVeh)selVeh=_empVeh.name||'';
    }
  }
  const vehOpts=vehs.length
    ?vehs.map(v=>'<option value="'+escHtml(v.name||'')+'"'+(selVeh===v.name?' selected':'')+'>'+escHtml(getVehicleFullLabel(v)||'')+'</option>').join('')
    :'<option value="">- Add vehicle in Settings -</option>';
  const clientOpts='<option value="">- None -</option>'+clients.map(c=>'<option value="'+c.id+'">'+escHtml(c.name||'')+'</option>').join('');
  const prefill=opts.purpose||'';
  const purposeOpts='<option value="" disabled'+(prefill?'':' selected')+'>- Select type -</option>'+
    MILE_PURPOSES.map(p=>'<option value="'+p+'"'+(p===prefill?' selected':'')+'>'+p+'</option>').join('');
  // Optional quick-select chips for today's scheduled jobs/estimates (skip in edit mode)
  const suggList=(!opts.editId&&opts.suggestions&&opts.suggestions.length)?opts.suggestions:[];
  const suggHtml=suggList.length
    ?'<div style="margin-bottom:14px">'+
        '<div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text3);margin-bottom:6px">Scheduled today, tap to fill</div>'+
        '<div style="display:flex;flex-wrap:wrap;gap:6px">'+
          suggList.map(s=>{
            const safeLabel=(s.label||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
            const safeAddr=(s.addr||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
            const safePurpose=(s.purpose||'').replace(/'/g,"\\'");
            return '<button type="button" onclick="fillTripSuggestion('+s.clientId+',\''+safeAddr+'\',\''+safePurpose+'\')" style="display:flex;align-items:center;gap:5px;padding:7px 10px;border-radius:20px;border:1.5px solid var(--border2);background:var(--bg2);font-size:12px;font-weight:600;cursor:pointer;color:var(--text)">'+
              svgIcon(s.icon||'📍',{size:12})+' <span>'+safeLabel+'</span>'+
            '</button>';
          }).join('')+
        '</div>'+
      '</div>'
    :'';
  _lmCoords={from:null,to:null};
  const overlay=document.createElement('div');overlay.className='zmodal-overlay';
  overlay.innerHTML='<div style="background:var(--bg);border-radius:var(--rl);padding:20px;width:100%;max-width:480px;max-height:90vh;overflow-y:auto">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'+
      '<div style="font-size:17px;font-weight:800">'+(opts.editId?svgIcon('✏',{size:17})+' Edit trip':svgIcon('🚗',{size:17})+' Log a trip')+'</div>'+
      '<button onclick="this.closest(\'.zmodal-overlay\').remove()" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--text3);padding:0 4px;line-height:1">×</button>'+
    '</div>'+
    suggHtml+
    '<input type="hidden" id="lm-purpose" value="'+prefill+'">'+
    '<input type="hidden" id="lm-miles-val" value="0">'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">'+
      '<div class="f" style="margin:0"><label>Date</label><input type="date" id="lm-date" value="'+(opts.date||today)+'"></div>'+
      '<div class="f" style="margin:0"><label>Vehicle</label><select id="lm-vehicle" style="width:100%">'+vehOpts+'</select></div>'+
    '</div>'+
    '<div class="f" style="margin-bottom:12px"><label>Trip type</label>'+
      '<select id="lm-trip-type-sel" style="width:100%" onchange="document.getElementById(\'lm-purpose\').value=this.value">'+purposeOpts+'</select>'+
    '</div>'+
    '<input type="hidden" id="lm-client" value="">'+
    '<input type="hidden" id="lm-from-name" value="">'+
    '<input type="hidden" id="lm-to-name" value="">'+
    '<div class="f" style="margin-bottom:12px"><label>Starting from</label>'+
      '<div style="display:flex;gap:8px">'+
        '<input id="lm-from" placeholder="Your address or last job" style="flex:1" value="'+escHtml(opts.fromAddress||'')+'" onfocus="_showRecentFromAddresses()" oninput="tripPlaceSearch(\'lm-from\',\'lm-from-sugg\',this.value)" autocomplete="off">'+
        '<button type="button" onclick="grabMyLocation(true)" class="btn btn-sm" id="lm-gps-btn" style="white-space:nowrap;flex-shrink:0;min-height:44px">'+svgIcon('📍',{size:12})+' GPS</button>'+
      '</div>'+
      '<div id="lm-from-sugg" style="display:none;background:var(--bg);border:1px solid var(--border2);border-radius:var(--r);margin-top:2px;overflow:hidden;max-height:200px;overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,.12)"></div>'+
      '<div id="lm-from-chip" style="display:none;margin-top:5px;font-size:11px;color:var(--green-mid);background:var(--green-lt);border:1px solid var(--green-mid);border-radius:20px;padding:3px 10px;align-items:center;gap:4px"><span>'+svgIcon('📍',{size:11})+'</span><span id="lm-from-chip-txt"></span><span style="color:var(--green-mid);font-weight:700">'+svgIcon('✓',{size:11})+'</span></div>'+
      '</div>'+
    '<div class="f" style="margin-bottom:4px"><label>Driving to, client name or address</label>'+
      '<input id="lm-to" placeholder="Type client name or any address" value="'+escHtml(opts.toAddress||'')+'" onfocus="_showRecentDestinations()" oninput="_tripDestSearch(this.value)" autocomplete="off">'+
      '<div id="lm-to-sugg" style="display:none;background:var(--bg);border:1px solid var(--border2);border-radius:var(--r);margin-top:2px;overflow:hidden;max-height:200px;overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,.12)"></div>'+
      '<div id="lm-to-chip" style="display:none;margin-top:5px;font-size:11px;color:var(--green-mid);background:var(--green-lt);border:1px solid var(--green-mid);border-radius:20px;padding:3px 10px;align-items:center;gap:4px"><span>'+svgIcon('📍',{size:11})+'</span><span id="lm-to-chip-txt"></span><span style="color:var(--green-mid);font-weight:700">'+svgIcon('✓',{size:11})+'</span></div>'+
      '</div>'+
    '<div id="lm-route-result" style="display:none;background:var(--blue-lt);border:1px solid var(--blue);border-radius:var(--r);padding:14px;margin-bottom:6px;text-align:center">'+
      '<div id="lm-miles-display" style="font-size:32px;font-weight:800;color:var(--blue-dk)"></div>'+
      '<div id="lm-time-display" style="font-size:13px;color:var(--text2);margin-top:4px"></div>'+
    '</div>'+
    '<div id="lm-recalc-row" style="display:none;text-align:right;margin-bottom:12px">'+
      '<button type="button" onclick="calculateAndShowRoute()" style="background:none;border:none;color:var(--blue);font-size:12px;font-weight:600;cursor:pointer;padding:0">↺ Recalculate</button>'+
    '</div>'+
    '<input type="hidden" id="lm-map-app" value="">'+
    // ONE MAP AND NONE (owner call 2026-08-10: "only show Apple Maps on Apple
    // devices and give a none option for back completing mileage, then Google
    // on android devices and desktops").
    //
    // Offering a contractor a map their device cannot open is a button that
    // does nothing, and a third choice nobody on that device would ever pick
    // is just something to mis-tap. So the sheet shows the one map this device
    // actually has, already selected, plus None for a trip somebody is
    // back-filling a week later. Save trip is the start button.
    //
    // What "Apple Maps" MEANS still varies invisibly: in the app it is our own
    // full-screen Apple Maps drive (js/drive.js), in Safari it opens the Maps
    // app. Same promise, best available version of it.
    (!opts.editId?
      '<div class="f" style="margin-bottom:14px">'+
        // No "(optional)" tag: None is right there saying so (owner 2026-08-10).
        '<label style="margin-bottom:6px;display:block">Navigate after saving</label>'+
        '<div style="display:flex;gap:8px">'+
          (_tripMapForDevice()==='apple'
            ?'<button type="button" id="lm-map-apple" onclick="_selectTripMapApp(\'apple\')" class="btn" style="flex:1;font-size:13px;font-weight:600;min-height:42px"> Apple Maps</button>'
            :'<button type="button" id="lm-map-google" onclick="_selectTripMapApp(\'google\')" class="btn" style="flex:1;font-size:13px;font-weight:600;min-height:42px"> Google Maps</button>')+
          '<button type="button" id="lm-map-none" onclick="_selectTripMapApp(\'\')" class="btn" style="flex:1;font-size:13px;min-height:42px;color:var(--text3)">None</button>'+
        '</div>'+
      '</div>':'')+
    '<div class="f" style="margin-bottom:14px"><label>Notes <span style="font-weight:400;font-size:10px;color:var(--text3)">(optional)</span></label>'+
      '<input id="lm-notes" placeholder="e.g. Supply stop at Sherwin-Williams" value="'+escHtml(opts.notes||'')+'"></div>'+
    '<div style="display:flex;gap:8px">'+
      '<button onclick="this.closest(\'.zmodal-overlay\').remove()" class="btn" style="flex:1">Cancel</button>'+
      (opts.editId
        ? '<button onclick="updateLoggedTrip('+opts.editId+')" class="btn btn-p" style="flex:2;min-height:48px;font-size:15px;font-weight:700">'+svgIcon('✓',{size:15})+' Save changes</button>'
        : '<button onclick="saveLoggedTrip()" class="btn btn-p" style="flex:2;min-height:48px;font-size:15px;font-weight:700">'+svgIcon('✓',{size:15})+' Save trip</button>')+
    '</div>'+
  '</div>';
  document.body.appendChild(overlay);
  // Auto-select map app based on device (skip in edit mode)
  if(!opts.editId){
    // The one map this device has is also the one already selected, so the
    // common trip is Save and go.
    const _defMap=_tripMapForDevice();
    // Synchronously, NOT on a timer. The buttons are already in the DOM: they
    // were built into the overlay's innerHTML before the appendChild above, so
    // there is nothing to wait for. The old 50ms defer left the sheet showing
    // no selection for its first frames, which is a real flicker on a phone
    // and a race for anything reading the state, and it is what made this test
    // fail on WebKit and pass on Chromium.
    if(_defMap)_selectTripMapApp(_defMap);
    // Auto-grab GPS for starting location if not pre-filled
    if(!opts.fromAddress)setTimeout(()=>grabMyLocation(false),300);
  }
  // Pre-link client if provided
  if(opts.clientId){const h=document.getElementById('lm-client');if(h)h.value=opts.clientId;}
  else if(opts.clientName){const c=clients.find(x=>x.name===opts.clientName);if(c){const h=document.getElementById('lm-client');if(h)h.value=c.id;}}
  // Show existing miles in edit mode
  if(opts.editId&&opts.miles>0){
    setTimeout(()=>{
      const mv=document.getElementById('lm-miles-val');if(mv)mv.value=opts.miles;
      const md=document.getElementById('lm-miles-display');if(md)md.textContent=(+opts.miles).toFixed(1)+' miles';
      const td=document.getElementById('lm-time-display');if(td)td.textContent='IRS deduction: '+fmt((+opts.miles)*IRS());
      const rr=document.getElementById('lm-route-result');if(rr)rr.style.display='block';
      const rc=document.getElementById('lm-recalc-row');if(rc)rc.style.display='block';
    },50);
  }
}
async function _nominatimReverse(lat,lon){
  try{
    const r=await fetch('https://nominatim.openstreetmap.org/reverse?lat='+lat+'&lon='+lon+'&format=json',{headers:{'Accept-Language':'en-US'}});
    const d=await r.json();
    const a=d.address||{};
    const parts=[];
    if(a.house_number&&a.road)parts.push(a.house_number+' '+a.road);
    else if(a.road)parts.push(a.road);
    if(a.city||a.town||a.village)parts.push(a.city||a.town||a.village);
    if(a.state)parts.push(a.state);
    if(a.postcode)parts.push(a.postcode);
    return parts.join(', ')||d.display_name||null;
  }catch(e){return null;}
}
async function getCurrentLocAddress(){
  return new Promise((resolve,reject)=>{
    if(!navigator.geolocation){reject(new Error('GPS not available'));return;}
    const doGet=()=>navigator.geolocation.getCurrentPosition(async pos=>{
      const{latitude:lat,longitude:lon}=pos.coords;
      _tripGpsCoords={lat,lng:lon};
      if(_mapkitReady){
        const gc=new mapkit.Geocoder({language:'en-US'});
        gc.reverseLookup(new mapkit.Coordinate(lat,lon),async(err,data)=>{
          if(!err&&data?.results?.[0]){
            const p=data.results[0];
            const parts=[];
            if(p.fullThoroughfare)parts.push(p.fullThoroughfare);
            else if(p.thoroughfare)parts.push([p.subThoroughfare,p.thoroughfare].filter(Boolean).join(' '));
            if(p.locality)parts.push(p.locality);
            if(p.administrativeAreaCode)parts.push(p.administrativeAreaCode);
            if(p.postCode)parts.push(p.postCode);
            const addr=parts.join(', ')||p.formattedAddress||'';
            if(addr){resolve(addr);return;}
            console.warn('[MapKit reverse] empty result for',lat,lon,'→ falling back to Nominatim');
          } else if(err){
            console.warn('[MapKit reverse] error:',err);
          }
          const nom=await _nominatimReverse(lat,lon);
          resolve(nom||lat.toFixed(4)+', '+lon.toFixed(4));
        });
        return;
      }
      const nom=await _nominatimReverse(lat,lon);
      resolve(nom||lat.toFixed(4)+', '+lon.toFixed(4));
    // The address this resolves to is written onto a MILEAGE row, which is a
    // tax record. A five-minute-old approximate fix names the wrong end of the
    // drive (owner rule 2026-08-26, no approximates by default).
    },err=>reject(err),{timeout:15000,enableHighAccuracy:true,maximumAge:0});
    if(S.locationGranted){doGet();return;}
    if(typeof requestLocationPermission==='function'){
      requestLocationPermission(doGet,()=>reject(new Error('Location denied')));
    }else{doGet();}
  });
}
async function grabMyLocation(showErr){
  const btn=document.getElementById('lm-gps-btn');
  if(btn){btn.disabled=true;btn.textContent='Locating...';}
  try{
    const addr=await getCurrentLocAddress();
    const inp=document.getElementById('lm-from');if(inp)inp.value=addr;
  }catch(e){
    if(showErr)zAlert('Could not get your location. Check that location access is enabled for Safari.',{title:'GPS unavailable'});
  }finally{if(btn){btn.disabled=false;btn.innerHTML=svgIcon('📍',{size:12})+' GPS';}}
}
async function calculateAndShowRoute(){
  const fromVal=(document.getElementById('lm-from')?.value||'').trim();
  const toVal=(document.getElementById('lm-to')?.value||'').trim();
  if(!fromVal||!toVal){zAlert('Enter both a starting point and a destination.');return;}
  const btn=document.getElementById('lm-calc-btn');
  if(btn){btn.disabled=true;btn.textContent='Calculating...';}
  try{
    let fromCoords=_lmCoords.from;
    let toCoords=_lmCoords.to;
    if(!fromCoords)fromCoords=await _resolveCoords(fromVal);
    if(!toCoords)toCoords=await _resolveCoords(toVal);
    const{miles,mins}=await _routeDistance(fromCoords,toCoords);
    document.getElementById('lm-miles-val').value=miles;
    document.getElementById('lm-miles-display').textContent=miles.toFixed(1)+' miles';
    document.getElementById('lm-time-display').textContent='~'+mins+' min drive · IRS deduction: '+fmt(miles*IRS());
    document.getElementById('lm-route-result').style.display='block';
    const _rcr=document.getElementById('lm-recalc-row');if(_rcr)_rcr.style.display='block';
  }catch(e){
    zAlert(e.message+'\n\nTip: Try typing the city and state, or pick from the search suggestions.',{title:'Could not calculate route'});
  }finally{if(btn){btn.disabled=false;btn.innerHTML=svgIcon('🗺',{size:12})+' Calculate miles';}}
}
// WHICH MAP THIS DEVICE ACTUALLY HAS. One definition, used by both the chooser
// and the preselect, so the button on screen and the link behind it can never
// disagree.
//
// Apple hardware gets Apple Maps, and that includes a Mac (owner 2026-08-10:
// "Mac's get Apple always"): maps:// is an Apple URL scheme and opens the real
// Maps app on an iPhone, an iPad and a desktop Mac alike. Everything else,
// Android, Windows and Linux, gets Google, whose handoff is a plain
// google.com/maps web link that opens in a tab anywhere.
//
// The rule is now simply "Apple device, Apple Maps", with no phone-versus-desk
// exception to remember.
function _tripMapForDevice(){
  return /iPhone|iPad|iPod|Macintosh|Mac OS X/i.test(navigator.userAgent||'')?'apple':'google';
}
function openTripInMaps(which,from,to){
  if(!to||!which)return;
  const enc=s=>encodeURIComponent(s);
  if(which==='apple'){
    // Only ever reached on Apple hardware, because that is the only place the
    // Apple button is rendered, so the scheme is always the right call.
    window.location.href='maps://?daddr='+enc(to)+'&dirflg=d';
  } else if(which==='google'){
    window.open('https://www.google.com/maps/dir/?api=1'+(from?'&origin='+enc(from):'')+'&destination='+enc(to)+'&travelmode=driving','_blank');
  }
}
function _selectTripMapApp(which){
  ['apple','google','none'].forEach(k=>{
    const btn=document.getElementById('lm-map-'+k);if(!btn)return;
    const active=(which===k)||(which===''&&k==='none');
    btn.style.background=active?'var(--blue)':'';
    btn.style.color=active?'#fff':'';
    btn.style.borderColor=active?'var(--blue)':'';
  });
  const inp=document.getElementById('lm-map-app');if(inp)inp.value=which;
}
function saveLoggedTrip(){
  const to=(document.getElementById('lm-to')?.value||'').trim();
  if(!to){zAlert('Enter a destination first.',{title:'Destination needed'});return;}
  const purpose=document.getElementById('lm-purpose')?.value||'';
  if(!purpose){const sel=document.getElementById('lm-trip-type-sel');if(sel){sel.style.borderColor='#A32D2D';sel.style.background='var(--red-lt)';sel.focus();}zAlert('Select a trip type.',{title:'Required'});return;}
  const date=document.getElementById('lm-date')?.value||todayKey();
  const vehicle=document.getElementById('lm-vehicle')?.value||'';
  const from=document.getElementById('lm-from')?.value||'';
  const from_name=document.getElementById('lm-from-name')?.value||'';
  const to_name=document.getElementById('lm-to-name')?.value||'';
  const notes=document.getElementById('lm-notes')?.value||'';
  const mapApp=document.getElementById('lm-map-app')?.value||'';
  const cid=parseInt(document.getElementById('lm-client')?.value)||null;
  const c=cid?getClientById(cid):null;
  // Save immediately with 0 miles, background route calc will update
  const rec={id:_newId(),date,loggedAt:new Date().toISOString(),vehicle,vehicleId:_vehIdForName(vehicle),from,from_name,to,to_name,start:0,end:0,miles:0,purpose,client_id:cid,client_name:c?c.name:'',notes,created_at:new Date().toISOString(),calc_method:'pending'};
  if(_isEmployee){rec.logged_by_id=_supaUser.id;rec.logged_by_name=_employeeRecord?.name||_supaUser.email;}
  mileage.unshift(rec);
  if(cid)autoLogContact(cid,'drive');
  emitEvent('drive_logged',cid,{to,miles:0,purpose});
  saveAll();
  closeTopModal();
  showToast('Trip saved, calculating mileage…','🚗');
  if(mapApp==='apple'&&to&&typeof driveCapable==='function'&&driveCapable()){
    // Apple Maps, in the app: same tiles, same directions, without leaving.
    // The app stays alive, so saveAll's debounce is in no danger and there is
    // nothing to flush. Coordinates come from whatever the route calculation
    // already resolved, and are only geocoded if the destination was typed and
    // never looked up. If that lookup fails we fall back to the Maps app,
    // because the contractor asked to be navigated, not to be told no.
    (async()=>{
      try{
        let tc=_lmCoords.to;
        if(!tc&&typeof _resolveCoords==='function')tc=await _resolveCoords(to);
        if(tc&&tc.lat!=null&&typeof startDriveTo==='function'){
          await startDriveTo({lat:tc.lat,lng:tc.lng,label:to});
          return;
        }
      }catch(_e){}
      _flushSaveNow();
      openTripInMaps('apple',from,to);
    })();
  }else if(mapApp&&to){
    // iOS will suspend the PWA when we hand off to Apple/Google Maps, the 2s
    // debounce in saveAll() dies before firing. Push to Supabase NOW so the
    // in-flight fetch survives the app switch.
    _flushSaveNow();
    openTripInMaps(mapApp,from,to);
  }
  renderDash();
  if(document.getElementById('mil-table'))renderAllMileage();
  if(document.getElementById('cd-mile-list')&&currentClientId)renderCDMileage();
  // Background: geocode if needed, get real route, update record
  (async()=>{
    try{
      const fc=_lmCoords.from||(from?await _resolveCoords(from):null);
      const tc=_lmCoords.to||(to?await _resolveCoords(to):null);
      if(!fc||!tc)return;
      const{miles}=await _routeDistance(fc,tc);
      const saved=mileage.find(m=>m.id===rec.id);
      if(!saved)return;
      saved.miles=Math.round(miles*10)/10;saved.calc_method='address';
      saveAll();renderDash();
      if(document.getElementById('mil-table'))renderAllMileage();
      if(document.getElementById('cd-mile-list')&&currentClientId)renderCDMileage();
      showToast(saved.miles.toFixed(1)+' mi logged · '+fmt(saved.miles*IRS())+' deduction','✅');
    }catch(e){showToast('Could not calculate mileage, tap Edit to add miles manually','⚠️');}
  })();
}
function renderAllMileage(){
  const yr=String(trackerYear||new Date().getFullYear());
  const _mileSrc=_isEmployee?mileage.filter(m=>!m.logged_by_id||m.logged_by_id===_supaUser?.id):mileage;
  // The LIST is every trip the viewer is allowed to see. The DEDUCTION is only
  // the deductible ones. Filtering the list itself hid an employee's own-car
  // trips from the employee who drove them, and hid the crew's trips from the
  // owner who has to verify what they owe: both could see a total and neither
  // could see what it was made of.
  const filtered=_mileSrc.filter(m=>m.date&&m.date.startsWith(yr));
  const irsRate=IRS(yr);
  const tot=deductibleTrips(filtered).reduce((s,r)=>s+(r.miles||0),0);
  const deduction=tot*irsRate;
  const unclassified=filtered.filter(m=>!m.purpose);

  // ── Drives waiting on one answer ──────────────────────────────────────────
  // The settle path for unattributed rows. Without this panel, attributeTrip
  // was a function no screen could reach and "answer it later" was a promise
  // with no later: the row sat outside both money totals forever. Owner side
  // only; crew have no mileage screen at all (owner call, 2026-08-03).
  const _unattrib=(typeof _isEmployee!=='undefined'&&_isEmployee)?[]:unattributedTrips(filtered);
  let _uw=document.getElementById('mil-unattrib-wrap');
  const _tblEl=document.getElementById('mil-table');
  if(!_unattrib.length){if(_uw)_uw.remove();}
  else{
    if(!_uw&&_tblEl&&_tblEl.parentNode){_uw=document.createElement('div');_uw.id='mil-unattrib-wrap';_tblEl.parentNode.insertBefore(_uw,_tblEl);}
    if(_uw){
      const _vopts=(typeof getVehicles==='function'?getVehicles():[]).filter(v=>(v.status||'active')==='active')
        .map(v=>'<option value="'+escHtml(String(v.id))+'">'+escHtml(v.name||'Vehicle')+'</option>').join('');
      _uw.innerHTML='<div style="background:#FFF8E7;border:1.5px solid #D4A017;border-radius:var(--rl);padding:12px 14px;margin-bottom:10px">'+
        '<div style="font-size:12px;font-weight:700;color:#78350F;margin-bottom:2px">'+svgIcon('🚗',{size:12})+' '+_unattrib.length+' drive'+(_unattrib.length===1?'':'s')+' with no vehicle recorded</div>'+
        '<div style="font-size:12px;color:var(--text2);line-height:1.5;margin-bottom:6px">Real and measured, but counted for nobody: not your deduction, not money owed to the crew. Say what was driven and each one files itself.</div>'+
        _unattrib.map(m=>{
          // Sanitized, not JSON.stringify'd: double quotes inside a
          // double-quoted attribute terminate it and leave a dead control.
          const _sid=String(m.id).replace(/[^0-9a-zA-Z_.-]/g,'');
          return '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border)">'+
            '<div style="flex:1;min-width:0">'+
              '<div style="font-size:12px;font-weight:700">'+escHtml(m.from_name||m.from||'Start')+' → '+escHtml(m.to_name||m.to||'End')+'</div>'+
              '<div style="font-size:11px;color:var(--text3)">'+escHtml(m.date||'')+' · '+(m.miles||0).toFixed(1)+' mi'+(m.logged_by_name?' · '+escHtml(m.logged_by_name):'')+'</div>'+
            '</div>'+
            '<select onchange="_milAttrib(\''+_sid+'\',this.value)" style="font-size:12px;padding:6px 8px;border-radius:var(--r);max-width:170px">'+
              '<option value="">Whose miles?</option>'+_vopts+
              '<option value="own">Their own vehicle</option>'+
              '<option value="rider">Riding with somebody</option>'+
            '</select>'+
          '</div>';
        }).join('')+
      '</div>';
    }
  }

  // ── Hero ──
  const heroEl=document.getElementById('mil-hero-wrap');
  if(heroEl){
    const vehs=getVehicles();
    if(!vehs.length){
      heroEl.innerHTML=
        '<div style="background:var(--bg2);border-radius:var(--r);padding:20px;text-align:center;margin-bottom:12px">'+
          '<div style="font-size:28px;margin-bottom:8px">'+svgIcon('🚛',{size:28})+'</div>'+
          '<div style="font-size:15px;font-weight:800;color:var(--text);margin-bottom:4px">Add a vehicle to start logging</div>'+
          '<div style="font-size:12px;color:var(--text3);margin-bottom:14px;line-height:1.5">The IRS requires a vehicle description on every mileage entry. You\'re one tap away from tracking deductible trips.</div>'+
          '<button class="btn btn-p" onclick="goPg(\'pg-team\');setFleetTab(\'fleet\')" style="font-size:14px;padding:11px 22px">+ Add vehicle in Fleet</button>'+
        '</div>';
      return;
    }
    const pVeh=vehs[0]||null;
    const odoRec=_vehOdo(pVeh,yr);
    const startOdo=odoRec.start||0;
    const endOdo=odoRec.end||0;
    const totalDriven=endOdo>startOdo?endOdo-startOdo:0;
    const bizPct=totalDriven>0?Math.min(100,Math.round((tot/totalDriven)*100)):0;
    const personalMi=Math.max(0,totalDriven-tot);
    const vehLabel=pVeh?getVehicleLabel(pVeh)||'Vehicle':'Vehicle';
    heroEl.innerHTML=
      '<div class="mil-hero">'+
        '<div class="mil-hero-l">'+
          '<div class="td-micro" style="color:rgba(255,255,255,.55);margin-bottom:8px">Mileage deduction · '+yr+'</div>'+
          '<div class="mil-deduction">'+fmt(deduction)+'</div>'+
          '<div class="mil-meta">'+
            '<span><b style="color:#fff">'+tot.toFixed(1)+'</b> business miles</span>'+
            '<span>·</span>'+
            '<span>IRS $'+irsRate.toFixed(3)+'/mi</span>'+
            '<span>·</span>'+
            '<span>'+filtered.length+' trip'+(filtered.length!==1?'s':'')+' logged</span>'+
          '</div>'+
          // What the crew is owed for driving their own cars, kept visibly
          // OUTSIDE the deduction figure above it: two different pots of money,
          // and a contractor in a reimbursement state needs to see the second
          // one exists. Hidden entirely when nobody is owed anything.
          (()=>{const o=(typeof crewMilesOwed==='function')?crewMilesOwed(yr):null;
            return (o&&o.miles>0)?'<div class="mil-meta" style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,.14)">'+
              '<span>'+(_isEmployee?'Your personal vehicle':'Crew personal vehicles')+' <b style="color:#fff">'+o.miles.toFixed(1)+' mi</b></span>'+
              '<span>·</span>'+
              '<span>'+fmt(o.owed)+' at the IRS rate, estimate only</span>'+
              '<span>·</span>'+
              '<span>reimbursement rules vary by state, not part of your deduction</span>'+
            '</div>':'';})()+
          (totalDriven>0?
            '<div class="mil-bar">'+
              '<div class="mil-bar-seg mil-bar-business" style="flex:'+Math.max(tot,0.1)+'"><span>Business '+bizPct+'%</span></div>'+
              '<div class="mil-bar-seg mil-bar-personal" style="flex:'+Math.max(personalMi,0.1)+'"><span>'+(100-bizPct)+'% personal</span></div>'+
            '</div>'+
            '<div class="mil-bar-foot">'+
              (startOdo?'<span>'+startOdo.toLocaleString()+' mi · Jan 1</span>':'<span>Set opening odometer below</span>')+
              (endOdo?'<span>'+endOdo.toLocaleString()+' mi today · '+totalDriven.toLocaleString()+' mi driven</span>':'')+'</div>':
            '<div class="mil-bar"><div class="mil-bar-seg mil-bar-business" style="flex:1"><span>Log trips to track business %</span></div></div>'
          )+
        '</div>'+
        '<div class="mil-hero-r">'+
          '<button class="mil-action mil-action-go" onclick="openDriveModal()">'+
            '<div class="mil-action-icon">'+svgIcon('📍',{size:20})+'</div>'+
            '<div class="mil-action-body"><div class="mil-action-label">Log a trip</div><div class="mil-action-sub">Manual · type addresses + miles</div></div>'+
          '</button>'+
          '<button class="mil-action" onclick="checkOdometerEntries(true)">'+
            '<div class="mil-action-icon">'+svgIcon('🔢',{size:20})+'</div>'+
            '<div class="mil-action-body"><div class="mil-action-label">Update odometer</div><div class="mil-action-sub">'+vehLabel+(startOdo?' · '+startOdo.toLocaleString()+' mi':'')+' </div></div>'+
          '</button>'+
          '<button class="mil-action" onclick="openExportPanel()">'+
            '<div class="mil-action-icon">'+svgIcon('📊',{size:20})+'</div>'+
            '<div class="mil-action-body"><div class="mil-action-label">Export IRS report</div><div class="mil-action-sub">Schedule C · Form 4562</div></div>'+
          '</button>'+
        '</div>'+
      '</div>';
  }

  // ── Vehicle worksheet ──
  _milRenderVehicleWorksheet(yr,tot,irsRate);

  // ── Classify card ──
  _milRenderClassifyCard(unclassified);

  // ── Filter bar ──
  const fbEl=document.getElementById('mil-filter-bar');
  if(fbEl){
    const classified=filtered.filter(m=>m.purpose);
    fbEl.innerHTML=
      '<div class="fbar">'+
        '<button id="mil-fb-all" class="fb'+(_milFilter==='all'?' active':'')+'" onclick="setMilFilter(\'all\')">All trips<span class="fb-count">'+filtered.length+'</span></button>'+
        '<button id="mil-fb-unclassified" class="fb'+(_milFilter==='unclassified'?' active':'')+'" onclick="setMilFilter(\'unclassified\')">Needs purpose<span class="fb-count">'+unclassified.length+'</span></button>'+
        '<button id="mil-fb-classified" class="fb'+(_milFilter==='classified'?' active':'')+'" onclick="setMilFilter(\'classified\')">Categorized<span class="fb-count">'+classified.length+'</span></button>'+
      '</div>';
  }

  // ── Trip list ──
  const shown=_milFilter==='unclassified'?unclassified:_milFilter==='classified'?filtered.filter(m=>m.purpose):filtered;
  _milRenderTripList(shown,yr);

  // ── Summary ──
  _milRenderSummary(filtered,tot,irsRate);

  // ── Home office tip ──
  const metsEl=document.getElementById('tr-mile-mets');
  if(metsEl){
    metsEl.innerHTML=S.homeOffice
      ?'<div class="tip" style="margin-top:4px"><span style="font-size:18px">'+svgIcon('✅',{size:18})+'</span><div><b>Home office active</b>, your drives from home to job sites count as deductible business miles.</div></div>'
      :'<div class="tip" style="margin-top:4px"><span style="font-size:18px">'+svgIcon('💡',{size:18})+'</span><div><b>Home office tip:</b> Set up a home office in Settings to make drives from home to your first job site deductible.</div></div>';
  }
}

function setMilFilter(f){
  _milFilter=f;
  ['all','unclassified','classified'].forEach(id=>{
    const el=document.getElementById('mil-fb-'+id);
    if(el)el.className='fb'+(f===id?' active':'');
  });
  const yr=String(trackerYear||new Date().getFullYear());
  const _mileSrc=_isEmployee?mileage.filter(m=>!m.logged_by_id||m.logged_by_id===_supaUser?.id):mileage;
  // Same rule as the summary above: the list shows everything the viewer may
  // see, and only the totals narrow to what is deductible.
  const filtered=_mileSrc.filter(m=>m.date&&m.date.startsWith(yr));
  const unclassified=filtered.filter(m=>!m.purpose);
  const shown=f==='unclassified'?unclassified:f==='classified'?filtered.filter(m=>m.purpose):filtered;
  _milRenderTripList(shown,yr);
}

// vehId is the stable td_vehicles row id (was a slug of the vehicle NAME, which
// meant a rename silently started writing to a different, empty record).
function _milSetOdo(vehId,field,val){
  const yr=String(trackerYear||new Date().getFullYear());
  const veh=getVehicles().find(v=>String(v.id)===String(vehId));
  if(!veh)return;
  const n=parseFloat(String(val).replace(/[^0-9.]/g,''))||0;
  _setVehOdo(veh,yr,{[field]:n});
  saveAll();_flushSaveNow();
  renderAllMileage();
}

function _milRenderVehicleWorksheet(yr,tot,irsRate){
  const el=document.getElementById('mil-vehicle-wrap');
  if(!el)return;
  const vehs=getVehicles();
  if(!vehs.length){el.innerHTML='';return;}
  const veh=vehs[0];
  const pKey=String(veh.id||'');
  const odoRec=_vehOdo(veh,yr);
  const startOdo=odoRec.start||0;
  const endOdo=odoRec.end||0;
  const totalDriven=endOdo>startOdo?endOdo-startOdo:0;
  const bizPct=totalDriven>0?Math.min(100,Math.round((tot/totalDriven)*100)):0;
  const personalMi=Math.max(0,totalDriven-tot);
  const deduction=tot*irsRate;
  const vehLabel=veh.year?veh.year+' '+veh.name:veh.name||'Vehicle';
  const vehPlate=veh.plate||veh.license_plate||'';
  el.innerHTML=
    '<div class="card card-pad-0" style="margin-bottom:14px">'+
      '<div class="card-hd">'+
        '<div><div class="card-hd-title">Vehicle &amp; odometer worksheet</div>'+
        '<div class="card-hd-sub" style="font-size:11px;color:var(--text-3);font-weight:500;margin-top:2px">Business-use % is calculated from year-start and year-end readings</div></div>'+
        '<button class="btn btn-sm" onclick="checkOdometerEntries(true)">Update readings</button>'+
      '</div>'+
      '<div class="mil-vehicle">'+
        '<div class="mil-vehicle-l">'+
          '<div class="mil-vehicle-icon">'+svgIcon('🛻',{size:22})+'</div>'+
          '<div>'+
            '<div class="mil-vehicle-name">'+escHtml(vehLabel)+'</div>'+
            (vehPlate?'<div class="mil-vehicle-plate">'+escHtml(vehPlate)+' · primary work vehicle</div>':'<div class="mil-vehicle-plate">Primary work vehicle</div>')+
          '</div>'+
        '</div>'+
        '<div class="mil-vehicle-grid">'+
          '<div class="mil-odo">'+
            '<div class="td-micro">Odometer · year start</div>'+
            '<div class="mil-odo-input">'+
              '<input type="number" value="'+(startOdo||'')+'" placeholder="0" min="0"'+
                ' onblur="_milSetOdo(\''+escHtml(pKey)+'\',\'start\',this.value)"'+
                ' style="font-size:15px;font-weight:800">'+
              '<span class="mil-odo-suffix">mi</span>'+
            '</div>'+
            '<div class="mil-odo-meta">As of Jan 1, '+yr+'</div>'+
          '</div>'+
          '<div class="mil-odo-arrow">→</div>'+
          '<div class="mil-odo">'+
            '<div class="td-micro">Odometer · year end</div>'+
            '<div class="mil-odo-input">'+
              '<input type="number" value="'+(endOdo||'')+'" placeholder="0" min="0"'+
                ' onblur="_milSetOdo(\''+escHtml(pKey)+'\',\'end\',this.value)"'+
                ' style="font-size:15px;font-weight:800">'+
              '<span class="mil-odo-suffix">mi</span>'+
            '</div>'+
            '<div class="mil-odo-meta">Update at year-end for Schedule C</div>'+
          '</div>'+
          '<div class="mil-odo-result">'+
            '<div class="td-micro">Total miles driven YTD</div>'+
            '<div class="mil-odo-big">'+(totalDriven?totalDriven.toLocaleString():'-')+'<span style="font-size:14px;color:var(--text-3);margin-left:4px;font-weight:600"> mi</span></div>'+
          '</div>'+
        '</div>'+
        '<div class="mil-calc">'+
          '<div class="mil-calc-row"><div class="mil-calc-label">Total miles driven</div><div class="mil-calc-eq">=</div><div class="mil-calc-v">'+(totalDriven?totalDriven.toLocaleString()+' mi':'-')+'</div></div>'+
          '<div class="mil-calc-row"><div class="mil-calc-label">Business miles logged · YTD</div><div class="mil-calc-eq">−</div><div class="mil-calc-v" style="color:var(--c-green)">'+tot.toFixed(1)+' mi</div></div>'+
          '<div class="mil-calc-row"><div class="mil-calc-label">Personal miles (everything else)</div><div class="mil-calc-eq">=</div><div class="mil-calc-v">'+personalMi.toFixed(1)+' mi</div></div>'+
          '<div class="mil-calc-row mil-calc-pct"><div class="mil-calc-label">Business-use percentage</div><div class="mil-calc-eq">→</div><div class="mil-calc-v">'+(totalDriven?bizPct+'%':'-')+'</div></div>'+
          '<div class="mil-calc-row mil-calc-final"><div class="mil-calc-label">Deduction · '+tot.toFixed(1)+' mi × $'+irsRate.toFixed(3)+'/mi</div><div class="mil-calc-eq">=</div><div class="mil-calc-v">'+fmt(deduction)+'</div></div>'+
        '</div>'+
      '</div>'+
    '</div>';
}

function _milRenderClassifyCard(unclassified){
  const el=document.getElementById('mil-classify-wrap');
  if(!el)return;
  if(!unclassified.length){el.innerHTML='';return;}
  const next=unclassified[0];
  const fromShort=(next.from_name||next.from||'').split(',')[0].trim()||'Start';
  const toShort=(next.to_name||next.to||'').split(',')[0].trim()||'Destination';
  const dateStr=next.date?new Date(next.date+'T12:00:00').toLocaleDateString('en-US',{year:'numeric',month:'2-digit',day:'2-digit'}):'';
  el.innerHTML=
    '<div class="mil-classify-card">'+
      '<div class="mil-classify-left">'+
        '<div class="mil-classify-tag">Needs a purpose · '+unclassified.length+' trip'+(unclassified.length===1?'':'s')+'</div>'+
        '<div class="mil-classify-title">'+escHtml(fromShort)+' → '+escHtml(toShort)+'</div>'+
        '<div class="mil-classify-meta">'+(dateStr?dateStr+' · ':'')+((next.miles||0).toFixed(1))+' mi</div>'+
      '</div>'+
      '<div class="mil-classify-actions">'+
        '<button class="mil-class-btn" onclick="_milSkipClassify('+next.id+')">Skip</button>'+
        '<button class="mil-class-btn mil-class-business" onclick="openMileageEdit('+_milIdArg(next.id)+')">'+svgIcon('💼',{size:12})+' Add purpose →</button>'+
      '</div>'+
    '</div>';
}

function _milSkipClassify(id){
  const m=mileage.find(x=>x.id===id);if(!m)return;
  m.purpose=m.purpose||'Other';
  saveAll();_flushSaveNow();
  renderAllMileage();
}

// A row id inside an inline handler. Ids were numbers once; a derived leg's id
// is its journey id (j-<uid8>-<base36>), and an unquoted one is a syntax error
// the moment the button is tapped (owner 2026-09-02: "route is throwing this
// error"). Quoted, and stripped to the characters an id can contain.
function _milIdArg(id){return "'"+String(id==null?'':id).replace(/[^A-Za-z0-9_.-]/g,'')+"'";}
function _milRenderTripList(shown,yr){
  const el=document.getElementById('mil-table');
  if(!el)return;
  if(!mileage.length){
    el.innerHTML='<div class="empty">No trips yet.<br>Tap <strong>Log a trip</strong> above to get started.</div>';
    return;
  }
  if(!shown.length){
    el.innerHTML='<div class="empty">No trips match this filter.</div>';
    return;
  }
  const _hasMultiDriver=!_isEmployee&&mileage.some(m=>m.logged_by_name);
  const irsRate=IRS(yr);
  const byDay={};
  [...shown].sort((a,b)=>(b.date||'').localeCompare(a.date||'')).forEach(r=>{
    if(!byDay[r.date])byDay[r.date]=[];
    byDay[r.date].push(r);
  });
  const days=Object.entries(byDay).sort((a,b)=>b[0].localeCompare(a[0]));
  // Purpose breakdown strip
  const purpTotals={};
  shown.forEach(r=>{const p=r.purpose||'';if(p){purpTotals[p]=(purpTotals[p]||0)+(r.miles||0);}});
  const purpChips=Object.entries(purpTotals).sort((a,b)=>b[1]-a[1]).map(([p,mi])=>{
    const _pc=MILE_PURPOSE_COLORS[p]||MILE_PURPOSE_COLORS['Other'];
    return '<div class="mil-purp-chip">'+
      '<div class="mil-purp-dot" style="background:'+_pc.text+'"></div>'+
      '<div class="mil-purp-name">'+escHtml(p)+'</div>'+
      '<div class="mil-purp-mi">'+mi.toFixed(1)+' mi</div>'+
    '</div>';
  }).join('');
  const purpRow=purpChips?'<div class="mil-purp-row">'+purpChips+'</div>':'';
  // Year -> month -> day, the SAME accordion the Books ledgers use (owner
  // 2026-08-13: "same accordion constant logic, no new hand-rolled accordion").
  // _bkMonthAcc/_bkTogMonth (finance.js) own the month shell; the day cards
  // inside are mileage's existing owner-approved day accordions, unchanged.
  const _dayCard=([date,trips],dayOpen)=>{
    const dayMi=trips.reduce((s,t)=>s+(t.miles||0),0);/*miles-not-deduction*/
    // The "+$" figure is a DEDUCTION preview, so it flows through the same
    // choke point every real total uses: held (pendingReceipt) and personal
    // rows drive dayMi (distance really driven) but never this number.
    const dayDed=deductibleTrips(trips).reduce((s,t)=>s+(t.miles||0)*irsRate,0);
    const needsCount=trips.filter(t=>!t.purpose).length;
    const [y,mo,d]=date.split('-').map(Number);
    const dateObj=new Date(y,mo-1,d);
    const dow=dateObj.toLocaleDateString('en-US',{weekday:'short'}).toUpperCase().slice(0,3);
    const monthShort=dateObj.toLocaleDateString('en-US',{month:'short'}).toUpperCase();
    const openClass=dayOpen?' open':'';
    const reviewClass=needsCount?' has-review':'';
    const _sorted=trips.slice().sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||''));
    const tripRows=_sorted.map((r,i)=>{
      const fromName=r.from_name||'';
      const fromAddr=r.from||'';
      const toName=r.to_name||'';
      const toAddr=r.to||(r.client_id?getClientById(r.client_id)?.addr||'':'');
      const _loc=(name,addr)=>{
        if(!name&&!addr)return'';
        if(name&&addr&&name!==addr)return escHtml(name)+'<div style="font-size:12px;color:var(--text3);font-weight:400;margin-top:1px">'+escHtml(addr)+'</div>';
        return escHtml(name||addr);
      };
      const fromHtml=_loc(fromName,fromAddr)||'<span style="color:var(--text-3);font-style:italic">Start not recorded</span>';
      const toHtml=_loc(toName,toAddr)||'<span style="color:var(--text-3);font-style:italic">End not recorded</span>';
      const needsClass=r.purpose?'':' needs';
      const tripNum=trips.length-i;
      // The trip's real clock (owner ask 2026-08-07): departed/arrived times
      // off the geofence stamps. Kept off the route/address column entirely
      // (a first pass put a time beside each stop and it read as scattered,
      // floating text at a different position on every row) and grouped
      // instead with the rest of the trip's NUMBERS, miles/duration/clock,
      // in one tidy right-aligned stack. Left side stays purely WHERE, right
      // side is everything else about the trip. Compact clock format (no
      // space, lowercase am/pm) matches the ON SITE card's _fmtClk
      // (dashboard.js), the app's one pattern for a short time string.
      // End falls back to start+wheel-time for rows written before endedIso
      // existed. Stale/manual rows show neither, their clock was never
      // observed.
      const _fmtClk=(t)=>{try{return bizTime(t).replace(/\s/g,'').replace('AM','a').replace('PM','p');}catch(_e){return'';}};
      let clockLine='';
      if(r.startedIso&&(r.endedIso||r.mins>0)){
        const _s=_fmtClk(r.startedIso);
        const _e=_fmtClk(r.endedIso||new Date(Date.parse(r.startedIso)+(r.mins||0)*60000).toISOString());
        if(_s&&_e)clockLine=_s+'–'+_e;
      }
      const durTxt=r.mins>0?(typeof _dispatchDur==='function'?_dispatchDur(r.mins):r.mins+'m'):'';
      const metaTxt=[durTxt,clockLine].filter(Boolean).join(' · ');
      // Supply-run state, one small line under the numbers: held rows are
      // waiting on the dashboard receipt card; a no-receipt row shows how it
      // resolved so the log reads honestly at a glance. Personal has no badge
      // here because Personal deletes the row (owner 2026-08-17): it never
      // reaches this list.
      const stateBadge=r.pendingReceipt?'<div style="font-size:10px;font-weight:800;color:#F59E0B">Held · receipt?</div>'
        :(r.noReceipt?'<div style="font-size:10px;font-weight:700;color:var(--text3)">No receipt</div>':'');
      return '<div class="mil-day-trip'+needsClass+'" data-lp-id="'+r.id+'" data-lp-type="mileage" data-lp-label="'+escHtml((r.from_name||r.from||'Start')+' → '+(r.to_name||r.to||'End')+' · '+(r.miles||0).toFixed(1)+' mi')+'">'+
        '<div class="mil-day-trip-route">'+
          '<div class="mil-route-spine"><div class="mil-route-pin-s"></div><div class="mil-route-spine-line"></div><div class="mil-route-pin-e"></div></div>'+
          '<div class="mil-route-addrs">'+
            '<div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Trip '+tripNum+'</div>'+
            // The green dot vs. red pin distinction is a map convention
            // (origin = dot, destination = pin/marker), and it wasn't
            // landing on its own (owner: built it, couldn't recall which
            // was which). Explicit labels beat a remembered convention.
            '<div style="font-size:9px;font-weight:800;color:var(--c-green);text-transform:uppercase;letter-spacing:.04em">From</div>'+
            '<div class="mil-day-trip-from">'+fromHtml+'</div>'+
            '<div style="font-size:9px;font-weight:800;color:#dc2626;text-transform:uppercase;letter-spacing:.04em;margin-top:2px">To</div>'+
            '<div class="mil-day-trip-to">'+toHtml+'</div>'+
            (_hasMultiDriver&&r.logged_by_name?'<div style="font-size:10px;color:var(--text3);font-weight:500;margin-top:2px">Driver: '+escHtml(r.logged_by_name)+'</div>':'')+
          '</div>'+
        '</div>'+
        '<div class="mil-trip-side">'+
          // Edit is pinned to its OWN top-right corner (position:absolute,
          // out of flow, index.html); miles/duration/time are a separate
          // group that centers independently on the card's Y axis via
          // .mil-trip-side's justify-content:center, unaffected by where
          // Edit sits (owner call, 2026-08-07).
          '<button class="mil-trip-edit" onclick="openMileageEdit('+_milIdArg(r.id)+')">Edit</button>'+
          '<div class="mil-trip-stats">'+
            (r.miles?'<div class="mil-trip-mi">'+(+r.miles).toFixed(1)+' mi</div>':'')+
            (metaTxt?'<div class="mil-trip-meta">'+metaTxt+'</div>':'')+
            // Only on a leg that actually has a track. A "Route" affordance on
            // a row with nothing to draw is the dead button js/observability.js
            // exists to catch (§13.1).
            (Array.isArray(r.path)&&r.path.length>=2
              ?'<button class="mil-trip-route" onclick="openMileageRoute('+_milIdArg(r.id)+')">'+svgIcon('🗺️',{size:10})+' Route</button>'
              :'')+
            stateBadge+
          '</div>'+
        '</div>'+
      '</div>';
    }).join('');
    return '<div id="mil-day-'+date+'" class="mil-day'+openClass+reviewClass+'">'+
      '<button class="mil-day-hd" onclick="_milTogDay(\''+date+'\')">'+
        '<div class="mil-day-l">'+
          '<div class="mil-day-date">'+
            '<div class="mil-day-dow">'+dow+'</div>'+
            '<div class="mil-day-num">'+d+'</div>'+
            '<div class="mil-day-month">'+monthShort+'</div>'+
          '</div>'+
          '<div>'+
            '<div class="mil-day-title">'+dateObj.toLocaleDateString('en-US',{year:'numeric',month:'2-digit',day:'2-digit'})+'</div>'+
            '<div class="mil-day-sub">'+trips.length+' trip'+(trips.length!==1?'s':'')+' · '+dayMi.toFixed(1)+' mi total'+(needsCount?' · <span style="color:#F59E0B;font-weight:800">'+needsCount+' need'+(needsCount===1?'':'s')+' a purpose</span>':'')+'</div>'+
          '</div>'+
        '</div>'+
        '<div class="mil-day-r">'+
          '<div class="mil-day-stats">'+
            '<div class="mil-day-miles">'+dayMi.toFixed(1)+'<span style="font-size:11px;color:var(--text-3);font-weight:600"> mi</span></div>'+
            (dayDed>0?'<div class="mil-day-ded">+'+fmt(dayDed)+'</div>':'')+
          '</div>'+
          '<div class="mil-day-chev">▸</div>'+
        '</div>'+
      '</button>'+
      '<div class="mil-day-body"'+(!openClass?' style="display:none"':'')+'>'+tripRows+'</div>'+
    '</div>';
  };
  const byMonth={};
  days.forEach(d=>{const mo=d[0].slice(0,7);(byMonth[mo]||(byMonth[mo]=[])).push(d);});
  const months=Object.keys(byMonth).sort((a,b)=>b.localeCompare(a));
  const curMo=todayKey().slice(0,7);
  el.innerHTML='<div class="mil-list">'+purpRow+'<div class="bk-months">'+months.map((mo,mIdx)=>{
    const moDays=byMonth[mo];
    const moTripsN=moDays.reduce((s,[,t])=>s+t.length,0);
    const moMi=moDays.reduce((s,[,t])=>s+t.reduce((x,r)=>x+(r.miles||0),0),0);
    // The newest month's newest day arrives open, the same at-a-glance
    // landing the flat list gave; everything older is one tap away.
    const inner=moDays.map((d,dIdx)=>_dayCard(d,mIdx===0&&dIdx===0)).join('');
    return _bkMonthAcc('mil',mo,_bkMonthLabel(mo),
      moTripsN+' trip'+(moTripsN!==1?'s':'')+' · '+moDays.length+' day'+(moDays.length!==1?'s':''),
      '<div style="font-size:15px;font-weight:900;color:var(--text);font-variant-numeric:tabular-nums;font-family:var(--font-display);letter-spacing:-.5px">'+moMi.toFixed(1)+' mi</div>',
      inner,mo>=curMo);
  }).join('')+'</div></div>';
}

function _milTogDay(date){
  const el=document.getElementById('mil-day-'+date);
  if(!el)return;
  const open=el.classList.toggle('open');
  const body=el.querySelector('.mil-day-body');
  if(body)body.style.display=open?'':'none';
}

function _milRenderSummary(filtered,tot,irsRate){
  const el=document.getElementById('mil-summary-wrap');
  if(!el||!filtered.length){if(el)el.innerHTML='';return;}
  const classified=filtered.filter(m=>m.purpose);
  const avgTrip=classified.length?tot/classified.length:0;
  const byPurpose={};
  classified.forEach(m=>{const p=m.purpose||'Other';byPurpose[p]=(byPurpose[p]||0)+(m.miles||0);});
  const topPurpose=Object.entries(byPurpose).sort((a,b)=>b[1]-a[1])[0];
  const yr=String(trackerYear||new Date().getFullYear());
  const vehs=getVehicles();
  const pVeh=vehs[0]||null;
  const odoRec=_vehOdo(pVeh,yr);
  const totalDriven=(odoRec.end||0)>(odoRec.start||0)?(odoRec.end-odoRec.start):0;
  const bizPct=totalDriven>0?Math.min(100,Math.round((tot/totalDriven)*100)):null;
  el.innerHTML=
    '<div class="mil-summary">'+
      '<div class="mil-summary-cell">'+
        '<div class="td-micro">Business-use %</div>'+
        '<div class="mil-summary-v" style="color:var(--c-green)">'+(bizPct!==null?bizPct+'%':'-')+'</div>'+
        '<div class="mil-summary-sub">'+tot.toFixed(1)+(totalDriven?' of '+totalDriven.toLocaleString():'')+' mi</div>'+
      '</div>'+
      '<div class="mil-summary-cell">'+
        '<div class="td-micro">Avg trip length</div>'+
        '<div class="mil-summary-v">'+avgTrip.toFixed(1)+'<span style="font-size:12px;color:var(--text-3);font-weight:600"> mi</span></div>'+
        '<div class="mil-summary-sub">'+filtered.length+' trips this period</div>'+
      '</div>'+
      '<div class="mil-summary-cell">'+
        '<div class="td-micro">Top purpose</div>'+
        '<div class="mil-summary-v" style="font-size:16px">'+(topPurpose?escHtml(topPurpose[0]):'-')+'</div>'+
        '<div class="mil-summary-sub">'+(topPurpose&&tot>0?Math.round((topPurpose[1]/tot)*100)+'% of business miles':'No categorized trips')+'</div>'+
      '</div>'+
      '<div class="mil-summary-cell">'+
        '<div class="td-micro">Audit-ready</div>'+
        '<div class="mil-summary-v" style="color:var(--c-green)">'+(filtered.every(m=>m.purpose)?svgIcon('✓',{size:20}):svgIcon('⚠',{size:20}))+'</div>'+
        '<div class="mil-summary-sub">'+(filtered.every(m=>m.purpose)?'IRS Pub. 463 compliant':filtered.filter(m=>!m.purpose).length+' trips need purpose')+'</div>'+
      '</div>'+
    '</div>';
}
function _togMileTrip(id){
  const det=document.getElementById('mile-det-'+id);
  const chv=document.getElementById('mile-det-chv-'+id);
  if(!det)return;
  const open=det.style.display!=='none';
  det.style.display=open?'none':'';
  if(chv)chv.style.transform=open?'rotate(-90deg)':'rotate(0deg)';
}
function toggleMileAddr(id){_togMileTrip(id);}// legacy alias
function delMileage(id){_userDelete(()=>{mileage=mileage.filter(x=>x.id!==id);saveAll();_flushSaveNow();});if(currentClientId){const el=document.getElementById('cd-mile-list');if(el)renderCDMileage();}renderAllMileage();}
function editMilePurpose(id,val){const m=mileage.find(x=>x.id===id);if(!m)return;m.purpose=val;saveAll();_flushSaveNow();}
// ── THE ROUTE, ON A MAP (owner ask 2026-09-01) ──────────────────────────────
// "then overlay that on a map and you get you're true mileage down to the
// exact route." Built on the app's ONE map renderer (tdMapRender, js/places.js,
// the same one the day map and the Places territory map go through, §7.3) in
// the app's ONE modal shell (.zmodal-overlay / .zmodal), so this screen
// inherits the MapKit instance, the licence gate, and the no-tiles fallback
// plot for free rather than growing a second mapping approach.
//
// Fleet-shaped, so allowKit rides tdAppleHardware(): Apple's licence forbids
// MapKit JS for asset tracking on non-Apple hardware, and a drawn crew route
// is squarely that. On an Android phone or a Windows desktop the fallback plot
// draws instead, which uses none of Apple's data.
function openMileageRoute(id){
  const r=(typeof mileage!=='undefined'?mileage:[]).find(x=>String(x.id)===String(id));
  if(!r||!Array.isArray(r.path)||r.path.length<2)return;
  document.getElementById('_mil-route-ov')?.remove();
  const ov=document.createElement('div');ov.className='zmodal-overlay';ov.id='_mil-route-ov';
  ov.onclick=e=>{if(e.target===ov)ov.remove();};
  const box=document.createElement('div');box.className='zmodal';box.style.maxWidth='520px';
  const pts=[];
  if(r.fromCoord&&r.fromCoord.lat!=null)pts.push({lat:+r.fromCoord.lat,lon:+r.fromCoord.lng,type:'start',label:r.from_name||r.from||'Start'});
  if(r.toCoord&&r.toCoord.lat!=null)pts.push({lat:+r.toCoord.lat,lon:+r.toCoord.lng,type:'end',label:r.to_name||r.to||'End'});
  // A row whose endpoints were never geocoded still has its track, and the
  // track's own ends are the honest stand-in.
  if(!pts.length){
    pts.push({lat:+r.path[0][0],lon:+r.path[0][1],type:'start',label:'Start'});
    pts.push({lat:+r.path[r.path.length-1][0],lon:+r.path[r.path.length-1][1],type:'end',label:'End'});
  }
  const _mi=(+r.miles||0).toFixed(1);
  // Said plainly, because it is the difference between a picture and a claim:
  // the drawn line is what the phone watched, the logged number is what the
  // row carries, and where they differ the row's number is the one on the
  // books. Nothing here rewrites it.
  // "Traced", not "Watched" (owner 2026-09-01), and no point count: the number
  // of GPS samples is how the line was built, not a fact about the drive, and
  // it invited the wrong question. What matters is that the traced figure is a
  // chain of straight lines between fixes and so always reads at or under the
  // routed distance; the ONE thing worth acting on is when it reads OVER,
  // which is the case _mileBestMiles already promotes.
  const gps=(r.gpsMiles>0)?('Traced '+(+r.gpsMiles).toFixed(1)+' mi · '):'';
  box.innerHTML=
    '<div style="font-size:17px;font-weight:800;line-height:1.25;margin-bottom:2px">Route driven</div>'+
    '<div style="font-size:12px;color:var(--text3);margin-bottom:12px">'+
      escHtml((r.from_name||r.from||'Start'))+' → '+escHtml((r.to_name||r.to||'End'))+'</div>'+
    '<div id="_mil-route-body" style="margin-bottom:10px"></div>'+
    '<div style="font-size:11px;color:var(--text3);line-height:1.6;margin-bottom:12px">'+
      gps+'Logged '+_mi+' mi</div>'+
    '<button onclick="this.closest(\'.zmodal-overlay\').remove()" class="btn" style="width:100%">Close</button>';
  ov.appendChild(box);document.body.appendChild(ov);
  try{
    tdMapRender({
      body:document.getElementById('_mil-route-body'),
      pts,
      path:r.path,
      style:{start:{c:'#0E6B39',label:'Start',glyph:'A'},end:{c:'#dc2626',label:'End',glyph:'B'}},
      st:tdMapState(),hostId:'_mil-route-canvas',height:300,
      allowKit:(typeof tdAppleHardware==='function')?tdAppleHardware():false,
    });
  }catch(_e){}
}
function openMileageEdit(id){
  // Ids arrive quoted from the inline handler (_milIdArg); a numeric id still
  // matches, and the row's own id (its real type) is what the edit carries.
  const r=mileage.find(x=>String(x.id)===String(id));if(!r)return;
  openLogTripModal({editId:r.id,fromAddress:r.from||'',toAddress:r.to||'',purpose:r.purpose||'',clientId:r.client_id,clientName:r.client_name||'',vehicle:r.vehicle||'',date:r.date||'',notes:r.notes||'',miles:r.miles||0});
}
function updateLoggedTrip(id){
  const r=mileage.find(x=>x.id===id);if(!r)return;
  const to=(document.getElementById('lm-to')?.value||'').trim();
  if(!to){zAlert('Enter a destination first.',{title:'Destination needed'});return;}
  const purpose=document.getElementById('lm-purpose')?.value||'';
  if(!purpose){const sel=document.getElementById('lm-trip-type-sel');if(sel){sel.style.borderColor='#A32D2D';sel.style.background='var(--red-lt)';sel.focus();}zAlert('Select a trip type.',{title:'Required'});return;}
  r.date=document.getElementById('lm-date')?.value||r.date;
  r.vehicle=document.getElementById('lm-vehicle')?.value||'';
  r.from=(document.getElementById('lm-from')?.value||'').trim();
  r.to=to;r.purpose=purpose;
  r.notes=document.getElementById('lm-notes')?.value||'';
  const miles=parseFloat(document.getElementById('lm-miles-val')?.value)||0;
  if(miles>0)r.miles=miles;
  const cid=parseInt(document.getElementById('lm-client')?.value)||null;
  const c=cid?getClientById(cid):null;
  r.client_id=cid;if(c)r.client_name=c.name;
  saveAll();_flushSaveNow();closeTopModal();showToast('Trip updated','✓');
  if(document.getElementById('mil-table'))renderAllMileage();
  if(document.getElementById('cd-mile-list')&&currentClientId)renderCDMileage();
}

let _rateRefreshInProgress=false;
Object.defineProperty(window,'_rateRefreshInProgress',{get:()=>_rateRefreshInProgress,set:v=>{_rateRefreshInProgress=v;},configurable:true});
async function autoRefreshRates(){
  if(!_supa||!_supaUser||_rateRefreshInProgress)return;
  const thisYear=new Date().getFullYear();
  // S.irsRateYear syncs to Supabase, once ANY device sets it for this year, all devices skip the fetch
  if(S.irsRateYear===thisYear&&S.irsRate)return;
  _rateRefreshInProgress=true;
  try{
    const{data:{session}}=await _supa.auth.getSession();
    if(!session)return;
    const resp=await fetch(SUPA_URL+'/functions/v1/get-rates',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token},
      body:JSON.stringify({})
    });
    if(!resp.ok)return;
    const d=await resp.json();
    // Sanity bounds, IRS rate must be realistic (never below 50¢ or above $1.00/mi)
    if(!d.irsRate||d.irsRate<0.50||d.irsRate>1.00)return;
    if(Math.abs(d.irsRate-(S.irsRate||0))>0.0005){
      showToast('IRS mileage rate updated to $'+(+d.irsRate).toFixed(3)+'/mi for '+d.year);
      const el=document.getElementById('set-irs');if(el)el.value=d.irsRate;
    }
    S.irsRate=d.irsRate;S.irsRateYear=thisYear;saveAll();
  }catch(e){}finally{_rateRefreshInProgress=false;}
}
