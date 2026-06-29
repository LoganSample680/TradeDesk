function _showOdometerModal(tasks,hardBlock){
  document.getElementById('_odo-modal-ov')?.remove();
  let taskIdx=0;

  function renderTask(){
    if(taskIdx>=tasks.length){_odoFinish();return;}
    const t=tasks[taskIdx];
    const vLabel=getVehicleLabel(t.veh);
    const isStart=t.type==='start';
    const existing=(S.vehicleOdoLog||{})[t.year]?.[_vehKey(t.veh)]||{};
    const otherReading=isStart?existing.end:existing.start;

    // Calculate logged miles for this vehicle+year for context
    const yrStr=String(t.year);
    const loggedMi=mileage.filter(m=>m.date&&m.date.startsWith(yrStr)&&(!m.vehicle||m.vehicle.toLowerCase().includes((t.veh.nickname||t.veh.name||'').split(' ')[0].toLowerCase()))).reduce((s,m)=>s+(m.miles||0),0);

    ov.innerHTML=`
    <div style="background:var(--bg);border-radius:var(--rl);width:100%;max-width:440px;padding:24px 20px 28px;box-sizing:border-box">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
        <div style="width:38px;height:38px;border-radius:50%;background:#dbeafe;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">🚗</div>
        <div>
          <div style="font-size:16px;font-weight:800;color:var(--text)">${isStart?(t.midYear?t.year+' Opening Odometer':t.year+' Start Odometer'):'Year-End Odometer'}</div>
          <div style="font-size:12px;color:var(--text3)">${vLabel} · ${isStart?(t.midYear?'First business use, '+t.year:'Jan 1, '+t.year):'Dec 31, '+t.year}</div>
        </div>
      </div>
      <div style="background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:var(--r);padding:10px 12px;margin:14px 0 16px;font-size:12px;color:#1e40af;line-height:1.5">
        <strong>IRS Pub. 463 requires annual odometer records.</strong> ${t.midYear?'You joined mid-year — enter the odometer reading from when you first started using this vehicle for business, or your best Jan 1 estimate. An estimate is far better than no record.':'Recording Jan 1 &amp; Dec 31 readings proves your business-use % and makes your mileage deduction bulletproof — even in a field audit.'}
        ${loggedMi>0?`<div style="margin-top:6px">📍 You logged <strong>${loggedMi.toFixed(1)} mi</strong> in ${t.year} for this vehicle in TradeDesk.</div>`:''}
        ${otherReading?`<div style="margin-top:4px">${isStart?'Dec 31':'Jan 1'} reading on file: <strong>${otherReading.toLocaleString()} mi</strong></div>`:''}
        ${(()=>{const prevEnd=(S.vehicleOdoLog||{})[t.year-1]?.[_vehKey(t.veh)]?.end||0;return(isStart&&prevEnd&&!existing.start)?`<div style="margin-top:4px">✅ Carried forward from Dec 31, ${t.year-1}: <strong>${prevEnd.toLocaleString()} mi</strong></div>`:'';})()}
      </div>
      <div style="font-size:13px;font-weight:700;color:var(--text2);margin-bottom:6px">${isStart?(t.midYear?t.year+' opening odometer (best estimate)':'Jan 1, '+t.year+' odometer reading'):'Dec 31, '+t.year+' odometer reading'}</div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <input id="_odo-val" type="number" min="0" inputmode="numeric" placeholder="e.g. 48,250" value="${(()=>{const pv=isStart?(existing.start||((S.vehicleOdoLog||{})[t.year-1]?.[_vehKey(t.veh)]?.end||0)):existing.end||0;return pv||'';})()}" style="flex:1;padding:12px 14px;border-radius:var(--r);border:2px solid var(--blue);font-size:20px;font-weight:700;font-family:inherit;background:var(--bg2);color:var(--text);outline:none;box-sizing:border-box">
        <span style="font-size:13px;color:var(--text3);font-weight:600">miles</span>
      </div>
      <div id="_odo-err" style="color:#A32D2D;font-size:12px;min-height:16px;margin-bottom:10px"></div>
      ${tasks.length>1?`<div style="font-size:11px;color:var(--text3);margin-bottom:12px;text-align:center">${taskIdx+1} of ${tasks.length} vehicles</div>`:''}
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
    const key=_vehKey(t.veh);
    if(!S.vehicleOdoLog)S.vehicleOdoLog={};
    if(!S.vehicleOdoLog[t.year])S.vehicleOdoLog[t.year]={};
    if(!S.vehicleOdoLog[t.year][key])S.vehicleOdoLog[t.year][key]={};
    const existing=S.vehicleOdoLog[t.year][key];
    if(t.type==='start'){
      if(existing.end&&raw>=existing.end){if(err)err.textContent='Start odometer must be less than end odometer ('+existing.end.toLocaleString()+' mi).';return;}
      existing.start=raw;existing.startDate=todayKey();
    } else {
      if(existing.start&&raw<=existing.start){if(err)err.textContent='End odometer must be greater than start odometer ('+existing.start.toLocaleString()+' mi).';return;}
      existing.end=raw;existing.endDate=todayKey();
      // Cross-check: logged miles vs total miles
      const yrStr=String(t.year);
      const totalDriven=raw-(existing.start||0);
      const logged=mileage.filter(m=>m.date&&m.date.startsWith(yrStr)).reduce((s,m)=>s+(m.miles||0),0);
      if(totalDriven>0){
        const bizPct=Math.min(100,Math.round(logged/totalDriven*100));
        const vehs=getVehicles();const vi=vehs.findIndex(v=>_vehKey(v)===key);
        if(vi>=0){vehs[vi].bizUse=bizPct;S.vehicles=vehs;}
        existing.bizUsePct=bizPct;existing.loggedMi=Math.round(logged);existing.totalMi=totalDriven;
        if(logged>totalDriven){existing.mileageFlag=true;}
      }
      // Auto-seed next year's Jan 1 start from this Dec 31 reading — user never has to enter year-start again
      const ny=t.year+1;
      if(!S.vehicleOdoLog[ny])S.vehicleOdoLog[ny]={};
      if(!S.vehicleOdoLog[ny][key])S.vehicleOdoLog[ny][key]={};
      S.vehicleOdoLog[ny][key].start=raw;
      S.vehicleOdoLog[ny][key].startDate=todayKey();
    }
    S._odoSnoozeCount=0;
    saveAll();_flushSaveNow();
    taskIdx++;
    renderTask();
  }

  window._odoSaveStep=_odoSaveStep;

  const ov=document.createElement('div');
  ov.id='_odo-modal-ov';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,'+(hardBlock?'.85':'.6')+');z-index:99990;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box';
  if(!hardBlock)ov.addEventListener('click',e=>{if(e.target===ov)_odoSnooze();});
  document.body.appendChild(ov);
  renderTask();

  function _odoFinish(){
    ov.remove();
    showToast('Odometer records saved — mileage deduction verified ✓','📋');
  }
}

function _odoSnooze(){
  S._odoSnoozedUntil=Date.now()+86400000; // 24 hours
  S._odoSnoozeCount=(S._odoSnoozeCount||0)+1;
  saveAll();
  document.getElementById('_odo-modal-ov')?.remove();
  showToast('Odometer reminder set for tomorrow','⏰');
}
window._odoSnooze=_odoSnooze;

function _getVehicleOdoSummary(veh,year){
  const key=_vehKey(veh);
  const log=(S.vehicleOdoLog||{})[year]?.[key]||{};
  return log;
}

function updateVehicleBizUse(idx,val){
  const vehs=getVehicles();
  if(vehs[idx]){vehs[idx].bizUse=Math.max(1,Math.min(100,parseFloat(val)||100));S.vehicles=vehs;saveAll();}
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
          '<option value="">— Select job —</option>'+
          activeJobs.map(b=>{const c=getClientById(b.client_id);return'<option value="'+b.id+'">'+escHtml(c?c.name:'Client')+' — '+fmt(b.amount)+'</option>';}).join('')+
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
  // Now uses dropdown — this just populates the select
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
    sel.innerHTML='<option value="">— Select vehicle —</option>'+
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
    const msg='Hi '+(c.name||'').split(' ')[0]+', this is '+(S.bname||'TradeDesk')+' — I\'m on my way! I\'ll be there shortly.';
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
      '<button onclick="closeTopModal()" style="border:none;background:none;font-size:22px;cursor:pointer;color:var(--text3)">✕</button>'+
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
function saveEndDriveModal(){
  const miles=parseFloat(document.getElementById('end-miles-modal')?.value)||0;
  if(!miles||miles<=0){zAlert('Enter the miles driven.',{title:'Required'});return;}
  if(miles>500){if(!confirm('That\'s '+miles+' miles — does that look right?'))return;}
  const c=getClientById(gps.clientId);
  mileage.unshift({
    id:Date.now(),date:todayKey(),vehicle:gps.vehicle,purpose:gps.purpose,
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
  // saving a trip — flush to Supabase NOW instead of waiting for the 2s debounce.
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

// ── Shared geocoding — Photon (primary) + Census (fallback) ─────────────────
// MapKit tokens are domain-locked with no expiry (see CLAUDE.md §10.1)
const _MAPKIT_TOKEN=location.hostname.includes('pages.dev')
  ?'eyJraWQiOiI3S0E5WDhVUjZMIiwidHlwIjoiSldUIiwiYWxnIjoiRVMyNTYifQ.eyJpc3MiOiJSVjI2NDRSTkdTIiwiaWF0IjoxNzgxMzAxNTIyLCJvcmlnaW4iOiIqLnRyYWRlZGVzay1jeXAucGFnZXMuZGV2Iiwic2NvcGUiOiJtYXBraXRfanMifQ.ehafZ1SO_50PLbz_-5iwhPJXKZpPXSJrNAALFhHmetxrVKOpCYzBHR9viL6Nl8Kor0yCIFJcvKiGrtrlNSgN7Q' // *.tradedesk-cyp.pages.dev — no expiry
  :'eyJraWQiOiJXQzYzOFM2M0c0IiwidHlwIjoiSldUIiwiYWxnIjoiRVMyNTYifQ.eyJpc3MiOiJSVjI2NDRSTkdTIiwiaWF0IjoxNzgxMzAxNDcwLCJvcmlnaW4iOiJ0cmFkZWRlc2twcm8uYXBwIiwic2NvcGUiOiJtYXBraXRfanMifQ.0hmtYgvSGLHMZcnHnEGMsaJDg6tXEtzfp3aS-tLdGbTjocZDQLP6VlrPl9l29tV-T5SgNXQycqUJO_T1b_rFWQ'; // tradedeskpro.app — no expiry
let _mapkitReady=false;
// MapKit JS tokens are domain-locked (CLAUDE.md §10.1). On any non-authorized origin
// (localhost, 127.0.0.1, the flow-test bridge) mapkit.init throws an origin-mismatch
// console.error — which fails assertNoErrors. Only init on tradedeskpro.app / *.pages.dev.
const _mapkitAuthorizedOrigin=/(?:^|\.)tradedeskpro\.app$/.test(location.hostname)||/\.pages\.dev$/.test(location.hostname);
function _initMapKit(){
  if(typeof mapkit==='undefined')return;
  if(!_mapkitAuthorizedOrigin)return; // unauthorized origin — skip init so MapKit never throws
  mapkit.init({authorizationCallback:done=>done(_MAPKIT_TOKEN),language:'en-US'});
  _mapkitReady=true;
  _retryPendingTrips();
}
async function _retryPendingTrips(){
  const pending=mileage.filter(m=>m.calc_method==='pending'&&m.from&&m.to);
  if(!pending.length)return;
  for(const rec of pending){
    try{
      const fc=await _resolveCoords(rec.from);
      const tc=await _resolveCoords(rec.to);
      if(!fc||!tc)continue;
      const{miles}=await _routeDistance(fc,tc);
      rec.miles=Math.round(miles*10)/10;rec.calc_method='address';
    }catch(e){}
  }
  saveAll();
  if(document.getElementById('mil-table'))renderAllMileage();
  renderDash();
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
async function _routeDistance(fromCoords,toCoords){
  // MapKit Directions — primary
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
  // MapKit JS — Apple Maps database, every US address (primary)
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
  document.getElementById(streetId)?.dispatchEvent(new Event('input',{bubbles:true}));
  // For existing clients, fire lookup immediately on address selection
  if(editClientId&&street&&city)_lookupPropertyData(editClientId,{street,city,state,zip});
}
// ── _addrAutoFull — shared single-field address autocomplete ─────────────────
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
      '<span style="font-size:16px;color:var(--text3)">🕐</span>'+
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
      '<span style="font-size:16px;color:var(--text3)">🕐</span>'+
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
      '<div style="font-size:13px;font-weight:700;color:var(--text)">👤 '+escHtml(c.name)+'</div>'+
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
      // Bias may cut off distant locations (e.g. MT address when starting from KS) — retry unbiased
      if(!results.length&&_fromBias)results=await _geocodeAddress(val,5);
      results.forEach(res=>{
        const safeL1=res.line1.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
        const safeL2=res.line2.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
        const safeName=(res.name||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
        const isPoi=res.name&&res.name.toLowerCase()!==res.line1.toLowerCase();
        html+='<div onclick="selectTripPlace(\'lm-to\',\'lm-to-sugg\',\'to\',\''+safeL1+'\',\''+safeL2+'\','+res.lat+','+res.lon+',\''+safeName+'\')" style="padding:10px 14px;border-bottom:1px solid var(--border);cursor:pointer">'+
          (isPoi?
            '<div style="font-size:13px;font-weight:700;color:var(--text)">📍 '+escHtml(res.name)+'</div>'+
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
  const inp=document.getElementById('lm-to');if(inp)inp.value=c.addr||'';
  const box=document.getElementById('lm-to-sugg');if(box)box.style.display='none';
  _lmCoords.to=null;
  const chip=document.getElementById('lm-to-chip');const chipTxt=document.getElementById('lm-to-chip-txt');
  if(chip&&chipTxt){chipTxt.textContent=c.name+(c.addr?' · '+c.addr:'');chip.style.display='inline-flex';}
  const h=document.getElementById('lm-client');if(h)h.value=c.id;
  const mv=document.getElementById('lm-miles-val');if(mv)mv.value='0';
  const rr=document.getElementById('lm-route-result');if(rr)rr.style.display='none';
  // Geocode address now so calculateAndShowRoute has coordinates ready
  if(c.addr){
    try{
      const results=await _geocodeAddress(c.addr,1);
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
            '<div style="font-size:13px;font-weight:700;color:var(--text)">📍 '+escHtml(res.name)+'</div>'+
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
  // Show verified address chip — prefer business name when available
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
    if(_empVehId&&_empVehId!=='none'){
      const _empVeh=vehs.find(v=>String(v.id)===String(_empVehId));
      if(_empVeh)selVeh=_empVeh.name||'';
    }
  }
  const vehOpts=vehs.length
    ?vehs.map(v=>'<option value="'+escHtml(v.name||'')+'"'+(selVeh===v.name?' selected':'')+'>'+escHtml(getVehicleFullLabel(v)||'')+'</option>').join('')
    :'<option value="">— Add vehicle in Settings —</option>';
  const clientOpts='<option value="">— None —</option>'+clients.map(c=>'<option value="'+c.id+'">'+escHtml(c.name||'')+'</option>').join('');
  const prefill=opts.purpose||'';
  const purposeOpts='<option value="" disabled'+(prefill?'':' selected')+'>— Select type —</option>'+
    MILE_PURPOSES.map(p=>'<option value="'+p+'"'+(p===prefill?' selected':'')+'>'+p+'</option>').join('');
  // Optional quick-select chips for today's scheduled jobs/estimates (skip in edit mode)
  const suggList=(!opts.editId&&opts.suggestions&&opts.suggestions.length)?opts.suggestions:[];
  const suggHtml=suggList.length
    ?'<div style="margin-bottom:14px">'+
        '<div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text3);margin-bottom:6px">Scheduled today — tap to fill</div>'+
        '<div style="display:flex;flex-wrap:wrap;gap:6px">'+
          suggList.map(s=>{
            const safeLabel=(s.label||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
            const safeAddr=(s.addr||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
            const safePurpose=(s.purpose||'').replace(/'/g,"\\'");
            return '<button type="button" onclick="fillTripSuggestion('+s.clientId+',\''+safeAddr+'\',\''+safePurpose+'\')" style="display:flex;align-items:center;gap:5px;padding:7px 10px;border-radius:20px;border:1.5px solid var(--border2);background:var(--bg2);font-size:12px;font-weight:600;cursor:pointer;color:var(--text)">'+
              (s.icon||'📍')+' <span>'+safeLabel+'</span>'+
            '</button>';
          }).join('')+
        '</div>'+
      '</div>'
    :'';
  _lmCoords={from:null,to:null};
  const overlay=document.createElement('div');overlay.className='zmodal-overlay';
  overlay.innerHTML='<div style="background:var(--bg);border-radius:var(--rl);padding:20px;width:100%;max-width:480px;max-height:90vh;overflow-y:auto">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'+
      '<div style="font-size:17px;font-weight:800">'+(opts.editId?'✏️ Edit trip':'🚗 Log a trip')+'</div>'+
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
        '<button type="button" onclick="grabMyLocation(true)" class="btn btn-sm" id="lm-gps-btn" style="white-space:nowrap;flex-shrink:0;min-height:44px">📍 GPS</button>'+
      '</div>'+
      '<div id="lm-from-sugg" style="display:none;background:var(--bg);border:1px solid var(--border2);border-radius:var(--r);margin-top:2px;overflow:hidden;max-height:200px;overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,.12)"></div>'+
      '<div id="lm-from-chip" style="display:none;margin-top:5px;font-size:11px;color:var(--green-mid);background:var(--green-lt);border:1px solid var(--green-mid);border-radius:20px;padding:3px 10px;align-items:center;gap:4px"><span>📍</span><span id="lm-from-chip-txt"></span><span style="color:var(--green-mid);font-weight:700">✓</span></div>'+
      '</div>'+
    '<div class="f" style="margin-bottom:4px"><label>Driving to — client name or address</label>'+
      '<input id="lm-to" placeholder="Type client name or any address" value="'+escHtml(opts.toAddress||'')+'" onfocus="_showRecentDestinations()" oninput="_tripDestSearch(this.value)" autocomplete="off">'+
      '<div id="lm-to-sugg" style="display:none;background:var(--bg);border:1px solid var(--border2);border-radius:var(--r);margin-top:2px;overflow:hidden;max-height:200px;overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,.12)"></div>'+
      '<div id="lm-to-chip" style="display:none;margin-top:5px;font-size:11px;color:var(--green-mid);background:var(--green-lt);border:1px solid var(--green-mid);border-radius:20px;padding:3px 10px;align-items:center;gap:4px"><span>📍</span><span id="lm-to-chip-txt"></span><span style="color:var(--green-mid);font-weight:700">✓</span></div>'+
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
    (opts.editId?'<button onclick="zConfirm(\'Delete this trip?\',function(){delMileage('+opts.editId+');closeTopModal();},{yes:\'Delete\',danger:true})" class="btn" style="width:100%;margin-bottom:8px;color:#dc2626;border-color:#fca5a5;background:#fff5f5;font-weight:700">🗑 Delete trip</button>':'')+
    '<div style="display:flex;gap:8px">'+
      '<button onclick="this.closest(\'.zmodal-overlay\').remove()" class="btn" style="flex:1">Cancel</button>'+
      (opts.editId
        ? '<button onclick="updateLoggedTrip('+opts.editId+')" class="btn btn-p" style="flex:2;min-height:48px;font-size:15px;font-weight:700">✓ Save changes</button>'
        : '<button onclick="saveLoggedTrip()" class="btn btn-p" style="flex:2;min-height:48px;font-size:15px;font-weight:700">✓ Save trip</button>')+
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
  }finally{if(btn){btn.disabled=false;btn.textContent='📍 GPS';}}
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
  }finally{if(btn){btn.disabled=false;btn.textContent='🗺 Calculate miles';}}
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
  // Save immediately with 0 miles — background route calc will update
  const rec={id:Date.now(),date,vehicle,from,from_name,to,to_name,start:0,end:0,miles:0,purpose,client_id:cid,client_name:c?c.name:'',notes,created_at:new Date().toISOString(),calc_method:'pending'};
  if(_isEmployee){rec.logged_by_id=_supaUser.id;rec.logged_by_name=_employeeRecord?.name||_supaUser.email;}
  mileage.unshift(rec);
  if(cid)autoLogContact(cid,'drive');
  emitEvent('drive_logged',cid,{to,miles:0,purpose});
  saveAll();
  closeTopModal();
  showToast('Trip saved — calculating mileage…','🚗');
  if(mapApp&&to){
    // iOS will suspend the PWA when we hand off to Apple/Google Maps — the 2s
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
    }catch(e){showToast('Could not calculate mileage — tap Edit to add miles manually','⚠️');}
  })();
}
function renderAllMileage(){
  const yr=String(trackerYear||new Date().getFullYear());
  const _mileSrc=_isEmployee?mileage.filter(m=>!m.logged_by_id||m.logged_by_id===_supaUser?.id):mileage;
  const filtered=_mileSrc.filter(m=>m.date&&m.date.startsWith(yr));
  const irsRate=IRS();
  const tot=filtered.reduce((s,r)=>s+(r.miles||0),0);
  const deduction=tot*irsRate;
  const unclassified=filtered.filter(m=>!m.purpose);

  // ── Hero ──
  const heroEl=document.getElementById('mil-hero-wrap');
  if(heroEl){
    const vehs=getVehicles();
    if(!vehs.length){
      heroEl.innerHTML=
        '<div style="background:var(--bg2);border-radius:var(--r);padding:20px;text-align:center;margin-bottom:12px">'+
          '<div style="font-size:28px;margin-bottom:8px">🚛</div>'+
          '<div style="font-size:15px;font-weight:800;color:var(--text);margin-bottom:4px">Add a vehicle to start logging</div>'+
          '<div style="font-size:12px;color:var(--text3);margin-bottom:14px;line-height:1.5">The IRS requires a vehicle description on every mileage entry. You\'re one tap away from tracking deductible trips.</div>'+
          '<button class="btn btn-p" onclick="goPg(\'pg-team\');setFleetTab(\'fleet\')" style="font-size:14px;padding:11px 22px">+ Add vehicle in Fleet</button>'+
        '</div>';
      return;
    }
    const pVeh=vehs[0]||null;
    const odoLog=(S.vehicleOdoLog||{})[yr]||{};
    const pKey=pVeh?_vehKey(pVeh):'default';
    const odoRec=odoLog[pKey]||{};
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
            '<div class="mil-action-icon">📍</div>'+
            '<div class="mil-action-body"><div class="mil-action-label">Log a trip</div><div class="mil-action-sub">Manual · type addresses + miles</div></div>'+
          '</button>'+
          '<button class="mil-action" onclick="checkOdometerEntries(true)">'+
            '<div class="mil-action-icon">🔢</div>'+
            '<div class="mil-action-body"><div class="mil-action-label">Update odometer</div><div class="mil-action-sub">'+vehLabel+(startOdo?' · '+startOdo.toLocaleString()+' mi':'')+' </div></div>'+
          '</button>'+
          '<button class="mil-action" onclick="openExportPanel()">'+
            '<div class="mil-action-icon">📊</div>'+
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
      ?'<div class="tip" style="margin-top:4px"><span style="font-size:18px">✅</span><div><b>Home office active</b> — your drives from home to job sites count as deductible business miles.</div></div>'
      :'<div class="tip" style="margin-top:4px"><span style="font-size:18px">💡</span><div><b>Home office tip:</b> Set up a home office in Settings to make drives from home to your first job site deductible.</div></div>';
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
  const filtered=_mileSrc.filter(m=>m.date&&m.date.startsWith(yr));
  const unclassified=filtered.filter(m=>!m.purpose);
  const shown=f==='unclassified'?unclassified:f==='classified'?filtered.filter(m=>m.purpose):filtered;
  _milRenderTripList(shown,yr);
}

function _milSetOdo(vehKey,field,val){
  const yr=String(trackerYear||new Date().getFullYear());
  if(!S.vehicleOdoLog)S.vehicleOdoLog={};
  if(!S.vehicleOdoLog[yr])S.vehicleOdoLog[yr]={};
  if(!S.vehicleOdoLog[yr][vehKey])S.vehicleOdoLog[yr][vehKey]={};
  const n=parseFloat(String(val).replace(/[^0-9.]/g,''))||0;
  S.vehicleOdoLog[yr][vehKey][field]=n;
  saveAll();_flushSaveNow();
  renderAllMileage();
}

function _milRenderVehicleWorksheet(yr,tot,irsRate){
  const el=document.getElementById('mil-vehicle-wrap');
  if(!el)return;
  const vehs=getVehicles();
  if(!vehs.length){el.innerHTML='';return;}
  const odoLog=(S.vehicleOdoLog||{})[yr]||{};
  const veh=vehs[0];
  const pKey=_vehKey(veh);
  const odoRec=odoLog[pKey]||{};
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
          '<div class="mil-vehicle-icon">🛻</div>'+
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
            '<div class="mil-odo-big">'+(totalDriven?totalDriven.toLocaleString():'—')+'<span style="font-size:14px;color:var(--text-3);margin-left:4px;font-weight:600"> mi</span></div>'+
          '</div>'+
        '</div>'+
        '<div class="mil-calc">'+
          '<div class="mil-calc-row"><div class="mil-calc-label">Total miles driven</div><div class="mil-calc-eq">=</div><div class="mil-calc-v">'+(totalDriven?totalDriven.toLocaleString()+' mi':'—')+'</div></div>'+
          '<div class="mil-calc-row"><div class="mil-calc-label">Business miles logged · YTD</div><div class="mil-calc-eq">−</div><div class="mil-calc-v" style="color:var(--c-green)">'+tot.toFixed(1)+' mi</div></div>'+
          '<div class="mil-calc-row"><div class="mil-calc-label">Personal miles (everything else)</div><div class="mil-calc-eq">=</div><div class="mil-calc-v">'+personalMi.toFixed(1)+' mi</div></div>'+
          '<div class="mil-calc-row mil-calc-pct"><div class="mil-calc-label">Business-use percentage</div><div class="mil-calc-eq">→</div><div class="mil-calc-v">'+(totalDriven?bizPct+'%':'—')+'</div></div>'+
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
  const dateStr=next.date?new Date(next.date+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}):'';
  el.innerHTML=
    '<div class="mil-classify-card">'+
      '<div class="mil-classify-left">'+
        '<div class="mil-classify-tag">Needs a purpose · '+unclassified.length+' trip'+(unclassified.length===1?'':'s')+'</div>'+
        '<div class="mil-classify-title">'+escHtml(fromShort)+' → '+escHtml(toShort)+'</div>'+
        '<div class="mil-classify-meta">'+(dateStr?dateStr+' · ':'')+((next.miles||0).toFixed(1))+' mi</div>'+
      '</div>'+
      '<div class="mil-classify-actions">'+
        '<button class="mil-class-btn" onclick="_milSkipClassify('+next.id+')">Skip</button>'+
        '<button class="mil-class-btn mil-class-business" onclick="openMileageEdit('+next.id+')">💼 Add purpose →</button>'+
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
  const irsRate=IRS();
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
            '<div class="mil-day-title">'+dateObj.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})+'</div>'+
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
  const odoLog=(S.vehicleOdoLog||{})[yr]||{};
  const vehs=getVehicles();
  const pVeh=vehs[0]||null;
  const pKey=pVeh?_vehKey(pVeh):'default';
  const odoRec=odoLog[pKey]||{};
  const totalDriven=(odoRec.end||0)>(odoRec.start||0)?(odoRec.end-odoRec.start):0;
  const bizPct=totalDriven>0?Math.min(100,Math.round((tot/totalDriven)*100)):null;
  el.innerHTML=
    '<div class="mil-summary">'+
      '<div class="mil-summary-cell">'+
        '<div class="td-micro">Business-use %</div>'+
        '<div class="mil-summary-v" style="color:var(--c-green)">'+(bizPct!==null?bizPct+'%':'—')+'</div>'+
        '<div class="mil-summary-sub">'+tot.toFixed(1)+(totalDriven?' of '+totalDriven.toLocaleString():'')+' mi</div>'+
      '</div>'+
      '<div class="mil-summary-cell">'+
        '<div class="td-micro">Avg trip length</div>'+
        '<div class="mil-summary-v">'+avgTrip.toFixed(1)+'<span style="font-size:12px;color:var(--text-3);font-weight:600"> mi</span></div>'+
        '<div class="mil-summary-sub">'+filtered.length+' trips this period</div>'+
      '</div>'+
      '<div class="mil-summary-cell">'+
        '<div class="td-micro">Top purpose</div>'+
        '<div class="mil-summary-v" style="font-size:16px">'+(topPurpose?escHtml(topPurpose[0]):'—')+'</div>'+
        '<div class="mil-summary-sub">'+(topPurpose&&tot>0?Math.round((topPurpose[1]/tot)*100)+'% of business miles':'No categorized trips')+'</div>'+
      '</div>'+
      '<div class="mil-summary-cell">'+
        '<div class="td-micro">Audit-ready</div>'+
        '<div class="mil-summary-v" style="color:var(--c-green)">'+(filtered.every(m=>m.purpose)?'✓':'⚠️')+'</div>'+
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
