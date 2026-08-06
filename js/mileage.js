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
    const end=Date.parse(m.loggedAt),start=Date.parse(m.startedIso||m.loggedAt);
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
      const{miles}=await _routeDistance(fc,tc);
      // SECOND re-read, after the route call. The one above catches a row that
      // had already settled when we reached it; this catches one that changed
      // WHILE we were measuring. A leg gets re-origined mid-flight when a stop
      // turns out to have been passed through, and the corrected measurement is
      // the one that must survive: writing ours would stamp the distance from
      // the old origin as final and the correction would bail on seeing it.
      if(rec.calc_method!==method)continue;
      if(auto&&(rec.fromCoord!==fc||rec.toCoord!==tc))continue;
      if(!(miles>0))continue;   // not a measurement: leave it pending for the next sweep
      rec.miles=Math.round(miles*10)/10;rec.calc_method=auto?'auto_route':'address';
      filled++;
    }catch(e){}
  }
  if(!filled)return;   // nothing changed, do not churn a save or a re-render
  saveAll();
  if(document.getElementById('mil-table'))renderAllMileage();
  renderDash();
}

// ── Automatic trip, written by the geofence when a drive leg closes ──────────
// Called from _geoAutoMileage (js/geo-track.js), which owns the decision of
// WHETHER to log (the vehicle rule, the commute guard). This owns only HOW.
//
// Both endpoints arrive as geocodes, so the distance question is just "what does
// MapKit say between these two points" (owner call 2026-08-01). Per IRS Pub 463
// a per-trip odometer reading is not required; a timestamped, automatically
// produced GPS log is accepted, and in practice is stronger evidence than paper
// because it is contemporaneous by construction.
//
// Saves at zero miles FIRST and measures after. Arriving somewhere with no
// signal is the normal case on a rural site, and the trip has to survive it.
function autoLogDriveTrip(opts){
  opts=opts||{};
  const {from,to,legKey,startedIso}=opts;
  // Validated HERE, not left to the caller. _geoAutoMileage checks the same
  // thing, but this is a global entry point and a trip with no endpoints would
  // still write a row and then hand undefined coordinates to the router: either
  // a thrown error or, worse, a distance nobody can reproduce. No endpoints, no
  // trip, whoever is calling.
  if(!from||!to||!legKey)return null;
  if(from.lat==null||from.lng==null||to.lat==null||to.lng==null)return null;
  // Idempotent on the leg key: the drive leg and this trip carry the same one,
  // so a retried or replayed leg can never bill the same miles twice.
  if(mileage.some(m=>m.legKey===legKey))return null;
  // ONE DRIVE, ONE ROW, and the AUTOMATIC one is the row worth keeping. It runs
  // geocode to geocode over the whole journey and Apple measures it; a manual
  // entry is a number typed from memory over however much of the drive they
  // remembered to tap through. So this always writes, and End Drive is where the
  // duplicate is resolved (saveEndDriveModal), because that is the only moment
  // both rows exist however the tap was timed.
  //
  // This used to suppress the automatic row whenever a manual drive was running,
  // which was backwards for the case the owner asked about (2026-08-02): tapping
  // Drive MID-drive would have thrown away the longer, measured record and kept
  // the partial hand-typed one.
  const veh=_autoTripVehicle();
  // dateKey, not a slice of the ISO string. An ISO timestamp is UTC, so a 7pm
  // supply run in Central time slices to TOMORROW and lands the deduction in the
  // wrong day, and at New Year the wrong TAX YEAR.
  const date=startedIso?dateKey(new Date(startedIso)):todayKey();
  const rec={
    id:_newId(),date,loggedAt:new Date().toISOString(),
    vehicle:veh?(veh.name||''):'',vehicleId:veh?veh.id:undefined,
    from:from.addr||from.name||'',from_name:from.name||'',
    to:to.addr||to.name||'',to_name:to.name||'',
    fromCoord:{lat:from.lat,lng:from.lng},toCoord:{lat:to.lat,lng:to.lng},
    start:0,end:0,miles:0,
    purpose:_autoTripPurpose(to),
    client_id:to.clientId||null,
    client_name:to.clientId&&typeof getClientById==='function'?((getClientById(to.clientId)||{}).name||''):'',
    notes:'',gps:true,legKey,
    // The employee's own car. Owed to THEM, never the owner's deduction, and
    // deductibleTrips is what enforces that everywhere it matters.
    reimbursable:(opts.reimbursable?true:undefined),
    // Nobody said what they were in. Kept off BOTH money totals until they do.
    vehicleUnknown:(opts.vehicleUnknown?true:undefined),
    // WHEN THE LEG BEGAN, not just when it was written. loggedAt is the arrival,
    // so on its own it cannot say whether this journey was already under way
    // when somebody tapped Drive, which is exactly what End Drive has to know.
    startedIso:startedIso||undefined,
    // Carried from the origin descriptor: this leg replaced a personal stop that
    // was passed through, and this is what it takes to put that stop back if a
    // receipt turns up for it later.
    passedThrough:(from.passedThrough||undefined),
    created_at:new Date().toISOString(),calc_method:'pending_auto'
  };
  if(_isEmployee&&typeof _supaUser!=='undefined'&&_supaUser){
    rec.logged_by_id=_supaUser.id;
    rec.logged_by_name=(typeof _employeeRecord!=='undefined'&&_employeeRecord&&_employeeRecord.name)||_supaUser.email;
  }
  mileage.unshift(rec);
  saveAll();
  // The endpoints THIS measurement is for, captured before the await. The row can
  // be re-origined while the route call is in flight (_autoNameStopTrip restores
  // a passed-through stop's true origin and re-measures from it), and identity on
  // the coordinate objects is what tells us that happened: _reoriginTrip assigns
  // a NEW fromCoord object, so a changed reference means this result is stale.
  const _fc=rec.fromCoord,_tc=rec.toCoord;
  (async()=>{
    try{
      const{miles}=await _routeDistance(_fc,_tc);
      const saved=mileage.find(m=>m.id===rec.id);
      if(!saved)return;
      // Stale: something re-pointed this leg while we were measuring. Writing now
      // would stamp the distance from the WRONG origin as auto_route, and the
      // correcting call would then bail on seeing a settled row, so the wrong
      // number would win. Whoever re-pointed it owns the answer.
      if(saved.fromCoord!==_fc||saved.toCoord!==_tc)return;
      // A router that answers with null/NaN/0 has not measured anything. Writing
      // it stamps the row 'auto_route', which takes it out of the sweep's reach
      // FOREVER: a silent zero-mile trip that still prints on a tax export as a
      // real one. Staying pending is the honest state and the recoverable one.
      if(!(miles>0))return;
      saved.miles=Math.round(miles*10)/10;saved.calc_method='auto_route';
      saveAll();
      if(document.getElementById('mil-table'))renderAllMileage();
      if(typeof renderDash==='function')renderDash();
    }catch(_e){}   // stays pending_auto, _retryPendingTrips sweeps it later
  })();
  // A leg that ended nowhere the app recognises is only anonymous until we ask.
  if(to.kind==='stop')_autoNameStopTrip(rec,to);
  return rec;
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
async function _autoNameStopTrip(rec,to){
  try{
    if(typeof _poiAt!=='function')return;
    // A stop the geofence already recognised as the declared home office keeps
    // that name. Asking Apple who is at a residential pin gets the business
    // across the street, and "Home Office" is the answer that makes the first
    // and last legs of the day deductible in the first place.
    if(to.likelyHome)return;
    const poi=await _poiAt({lat:to.lat,lng:to.lng});
    if(!poi||(!poi.name&&!poi.addr))return;
    // Stamp the DESCRIPTOR first, not just this row. The very same object is the
    // ORIGIN of the leg out of this stop (geo-track.js _geoCloseStop assigns it
    // to _geoLegOrigin), so answering once names both ends of the pair. Naming
    // only the arrival left the log reading "... -> The Home Depot" followed by
    // "Stop -> ...", which is the same stop described two ways.
    if(poi.name)to.name=poi.name;
    if(poi.addr)to.addr=poi.addr;
    // A restaurant is only personal when nobody bought anything for the business
    // there. Buying the crew lunch is a work errand and the drive counts in full
    // (owner's CPA, 2026-08-02), and the receipt that proves it is one the
    // contractor already has to keep, so this costs them no extra taps. No
    // receipt at that pin today, it was their own lunch.
    // The LEG's date, not today's. A stop entered at 11:50pm and left at 12:05am
    // closes on the following calendar day, so asking for today's receipts
    // missed one dated to the drive. The later sweep already used the trip's own
    // date and would have healed it on the next load; this makes the first
    // answer right instead of the second.
    const legDay=(rec&&rec.date)||todayKey();
    const personal=!!(poi.name&&_poiIsPersonal(poi.category)&&
                      !(typeof expenseForStop==='function'&&
                        expenseForStop({lat:to.lat,lng:to.lng,name:poi.name,day:legDay})));
    // And patch a leg out of here that was ALREADY written. Which of the two
    // landed first depends on how long Apple took against how long they were
    // parked, and a record must not depend on that race.
    mileage.forEach(m=>{
      if(!m.gps||!m.fromCoord||m.from_name!=='Stop')return;
      if(Math.abs(m.fromCoord.lat-to.lat)>1e-5||Math.abs(m.fromCoord.lng-to.lng)>1e-5)return;
      if(poi.name)m.from_name=poi.name;
      if(poi.addr)m.from=poi.addr;
    });
    const saved=mileage.find(m=>m.id===rec.id);
    if(!saved){saveAll();return;}
    if(personal){
      // A detour, not a destination. The leg IN comes back out of the log, and
      // the leg OUT is measured from where they were before they stopped, so
      // one supply-house-to-job-site trip stays one trip at its direct distance
      // instead of becoming two legs whose total depends on where they chose to
      // eat. Their own Topeka day: the restaurant sat four doors from the job,
      // so the two-leg version billed 0.7 miles for a 6.5 mile trip.
      const i=mileage.indexOf(saved);
      const dropped=i>=0?mileage.splice(i,1)[0]:null;
      const back=to.prevOrigin;
      // Nothing to pass through to (the day began at this stop): it stays the
      // origin, because a leg with no start is worse than one starting at lunch.
      if(back&&back.lat!=null){
        // The breadcrumb that makes this reversible. Receipts do not get done at
        // the counter, they get done in the truck at 5pm or at the kitchen table
        // on Sunday, and by then this trip is already recorded as a detour. The
        // dropped leg rides along on whatever row replaces it, so the day can be
        // rebuilt exactly when the receipt finally lands (owner, 2026-08-02).
        const crumb={stop:{lat:to.lat,lng:to.lng,name:poi.name,addr:poi.addr||'',kind:'stop'},
                     day:(dropped&&dropped.date)||legDay,leg:dropped,origin:back};
        back.passedThrough=crumb;
        const restored=(typeof _geoPassThroughStop==='function')&&_geoPassThroughStop(to);
        // Not restored means they already reached the next fence and that leg
        // was measured from here, so it is that row that needs re-pointing.
        if(!restored)mileage.forEach(m=>{
          if(!m.gps||!m.fromCoord)return;
          if(Math.abs(m.fromCoord.lat-to.lat)>1e-5||Math.abs(m.fromCoord.lng-to.lng)>1e-5)return;
          m.passedThrough=crumb;
          _reoriginTrip(m,back);
        });
      }
    }else if(!poi.name){
      // Apple knows the address but not a tenant. The stop stays "Stop", which
      // is honest, and the row gains the street address, which is what makes it
      // readable a year later.
      saved.to=poi.addr;
    }else{
      // Name and address both, the shape an IRS log wants: WHO they went to,
      // and WHERE that is. `to_name` is what reads on the row, `to` is the
      // address column the manual log already uses for the same thing.
      saved.to_name=poi.name;
      saved.to=poi.addr||poi.name;
      saved.purpose=_autoTripPurpose({kind:_poiPlaceKind(poi.category)});
    }
    saveAll();
    if(document.getElementById('mil-table'))renderAllMileage();
    if(typeof renderDash==='function')renderDash();
  }catch(_e){}
}
// ── The receipt that turns up later ──────────────────────────────────────────
// A stop is judged the moment the truck pulls out, because that is when the leg
// has to be written. But receipts are not done at the counter. They are done in
// the truck at the end of the day, or at the kitchen table on Sunday, and by
// then the trip is already on the log as a detour with the crew's lunch run
// billed as a personal errand (owner, 2026-08-02).
//
// So every pass-through leaves the dropped leg attached to the row that replaced
// it, and this puts the day back the moment the receipt appears. Idempotent: the
// restored leg carries its original leg key, which autoLogDriveTrip refuses to
// duplicate, and the crumb is cleared once it is spent.
//
// Runs on every expense save and once on load, because the receipt may have been
// entered on a different device.
function reviewDetourReceipts(){
  if(typeof mileage==='undefined'||typeof expenseForStop!=='function')return 0;
  let n=0;
  mileage.filter(m=>m&&m.passedThrough&&m.passedThrough.stop).forEach(m=>{
    const c=m.passedThrough,s=c.stop;
    if(!expenseForStop({lat:s.lat,lng:s.lng,name:s.name,day:c.day}))return;
    // It WAS for the business after all. The leg in goes back, exactly as it was
    // written, and this leg goes back to starting at the stop.
    if(c.leg&&!mileage.some(x=>x.legKey===c.leg.legKey)){
      const back=Object.assign({},c.leg);
      back.to_name=s.name;back.to=s.addr||s.name;
      back.purpose=_autoTripPurpose({kind:'supply'});
      mileage.unshift(back);
      _reoriginTrip(back,c.origin);
    }
    delete m.passedThrough;
    _reoriginTrip(m,s);
    n++;
  });
  if(!n)return 0;
  saveAll();
  if(document.getElementById('mil-table'))renderAllMileage();
  if(typeof renderDash==='function')renderDash();
  return n;
}
// Re-point a trip that was already written from the wrong end, and re-measure
// it. Only ever used to undo a personal stop: the row was measured from the
// restaurant and has to be measured from the business point before it instead.
// Written back to pending first, so a sweep that races this cannot publish the
// old distance against the new origin.
function _reoriginTrip(m,from){
  if(!m||!from||from.lat==null)return;
  m.from=from.addr||from.name||'';
  m.from_name=from.name||'';
  const fc=m.fromCoord={lat:from.lat,lng:from.lng};
  const tc=m.toCoord;
  m.miles=0;m.calc_method='pending_auto';
  (async()=>{
    try{
      const{miles}=await _routeDistance(fc,tc);
      if(m.calc_method!=='pending_auto')return;   // something else settled it
      // A LATER correction re-pointed this leg again while we measured. Same rule
      // as everywhere else that measures: the most recent origin owns the answer.
      if(m.fromCoord!==fc||m.toCoord!==tc)return;
      if(!(miles>0))return;     // not a measurement: leave it pending for the sweep
      m.miles=Math.round(miles*10)/10;m.calc_method='auto_route';
      saveAll();
      if(document.getElementById('mil-table'))renderAllMileage();
      if(typeof renderDash==='function')renderDash();
    }catch(_e){}
  })();
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
function deductibleTrips(list){
  return (list||[]).filter(m=>m&&!m.reimbursable&&!m.vehicleUnknown);
}
function reimbursableTrips(list){
  return (list||[]).filter(m=>m&&m.reimbursable&&!m.vehicleUnknown);
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
// offers those as a place type. 'Client Consult' and 'Payment Collection'
// are still real, pickable purposes on a manually-logged trip (MILE_PURPOSES
// is not scoped down), they just never arrive here automatically, a Place
// carries no client_id to know WHICH client's consult or collection it was.
const _PLACE_KIND_TO_PURPOSE={
  shop:'Shop',
  supply:'Supply run',
  home_office:'Home Office',
  business_meeting:'Business meeting',
};
function _autoTripPurpose(to){
  const k=(to&&to.kind)||'';
  if(k==='job')return 'Job site';
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
// Apple's POI categories mapped onto the four kinds a contractor cares about.
// Anything unrecognised stays 'supply', which is the existing default and the
// overwhelmingly common case for a place they keep stopping at.
function _poiPlaceKind(category){
  const c=String(category||'');
  if(/Store|Hardware|Home|Building|Supply|Warehouse|Wholesale/i.test(c))return 'supply';
  if(_poiIsPersonal(c))return 'other';
  return 'supply';
}
// The one category that makes a stop PERSONAL rather than a work errand, and so
// the one that keeps a leg off the mileage log entirely. Deliberately narrow: it
// only ever subtracts a trip, so a loose pattern here silently costs the
// contractor deductions they earned. Kept as its own predicate rather than read
// off _poiPlaceKind's 'other', because that function's catch-all is 'supply' and
// a future category landing in 'other' must not start deleting trips.
function _poiIsPersonal(category){
  return /Restaurant|Cafe|Food|Bakery|Brewery|Bar/i.test(String(category||''));
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
    (!opts.editId?
      '<div class="f" style="margin-bottom:14px">'+
        '<label style="margin-bottom:6px;display:block">Open in maps after saving <span style="font-weight:400;font-size:10px;color:var(--text3)">(optional)</span></label>'+
        '<div style="display:flex;gap:8px">'+
          '<button type="button" id="lm-map-apple" onclick="_selectTripMapApp(\'apple\')" class="btn" style="flex:1;font-size:13px;font-weight:600;min-height:42px"> Apple Maps</button>'+
          '<button type="button" id="lm-map-google" onclick="_selectTripMapApp(\'google\')" class="btn" style="flex:1;font-size:13px;font-weight:600;min-height:42px"> Google Maps</button>'+
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
    const _ua=navigator.userAgent||'';
    const _defMap=/iPhone|iPad|iPod/i.test(_ua)?'apple':/Android/i.test(_ua)?'google':'';
    if(_defMap)setTimeout(()=>_selectTripMapApp(_defMap),50);
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
    },err=>reject(err),{timeout:8000,enableHighAccuracy:false,maximumAge:300000});
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
function openTripInMaps(which,from,to){
  if(!to||!which)return;
  const enc=s=>encodeURIComponent(s);
  if(which==='apple'){
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
  if(mapApp&&to){
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
        '<button class="mil-class-btn mil-class-business" onclick="openMileageEdit('+next.id+')">'+svgIcon('💼',{size:12})+' Add purpose →</button>'+
      '</div>'+
    '</div>';
}

function _milSkipClassify(id){
  const m=mileage.find(x=>x.id===id);if(!m)return;
  m.purpose=m.purpose||'Other';
  saveAll();_flushSaveNow();
  renderAllMileage();
}

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
  el.innerHTML='<div class="mil-list">'+purpRow+days.map(([date,trips],dayIdx)=>{
    const dayMi=trips.reduce((s,t)=>s+(t.miles||0),0);
    const dayDed=trips.reduce((s,t)=>s+(t.miles||0)*irsRate,0);
    const needsCount=trips.filter(t=>!t.purpose).length;
    const [y,mo,d]=date.split('-').map(Number);
    const dateObj=new Date(y,mo-1,d);
    const dow=dateObj.toLocaleDateString('en-US',{weekday:'short'}).toUpperCase().slice(0,3);
    const monthShort=dateObj.toLocaleDateString('en-US',{month:'short'}).toUpperCase();
    const openClass=dayIdx===0?' open':'';
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
      return '<div class="mil-day-trip'+needsClass+'" data-lp-id="'+r.id+'" data-lp-type="mileage" data-lp-label="'+escHtml((r.from_name||r.from||'Start')+' → '+(r.to_name||r.to||'End')+' · '+(r.miles||0).toFixed(1)+' mi')+'">'+
        '<div class="mil-day-trip-route">'+
          '<div class="mil-route-spine"><div class="mil-route-pin-s"></div><div class="mil-route-spine-line"></div><div class="mil-route-pin-e"></div></div>'+
          '<div class="mil-route-addrs">'+
            '<div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Trip '+tripNum+'</div>'+
            '<div class="mil-day-trip-from">'+fromHtml+'</div>'+
            '<div class="mil-day-trip-to">'+toHtml+'</div>'+
            (_hasMultiDriver&&r.logged_by_name?'<div style="font-size:10px;color:var(--text3);font-weight:500;margin-top:2px">Driver: '+escHtml(r.logged_by_name)+'</div>':'')+
          '</div>'+
        '</div>'+
        '<div class="mil-trip-side">'+
          (r.miles?'<div class="mil-trip-mi">'+(+r.miles).toFixed(1)+' mi</div>':'')+
          '<button class="mil-trip-edit" onclick="openMileageEdit('+r.id+')">Edit</button>'+
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
            '<div class="mil-day-ded">+'+fmt(dayDed)+'</div>'+
          '</div>'+
          '<div class="mil-day-chev">▸</div>'+
        '</div>'+
      '</button>'+
      '<div class="mil-day-body"'+(!openClass?' style="display:none"':'')+'>'+tripRows+'</div>'+
    '</div>';
  }).join('')+'</div>';
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
function openMileageEdit(id){
  const r=mileage.find(x=>x.id===id);if(!r)return;
  openLogTripModal({editId:id,fromAddress:r.from||'',toAddress:r.to||'',purpose:r.purpose||'',clientId:r.client_id,clientName:r.client_name||'',vehicle:r.vehicle||'',date:r.date||'',notes:r.notes||'',miles:r.miles||0});
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
