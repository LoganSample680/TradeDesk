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
      </div>
      <div style="font-size:13px;font-weight:700;color:var(--text2);margin-bottom:6px">${isStart?(t.midYear?t.year+' opening odometer (best estimate)':'Jan 1, '+t.year+' odometer reading'):'Dec 31, '+t.year+' odometer reading'}</div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <input id="_odo-val" type="number" min="0" inputmode="numeric" placeholder="e.g. 48,250" style="flex:1;padding:12px 14px;border-radius:var(--r);border:2px solid var(--blue);font-size:20px;font-weight:700;font-family:inherit;background:var(--bg2);color:var(--text);outline:none;box-sizing:border-box">
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
    }
    S._odoSnoozeCount=0;
    saveAll();
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
    renderVehicleSettings();
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
          activeJobs.map(b=>{const c=getClientById(b.client_id);return'<option value="'+b.id+'">'+(c?c.name:'Client')+' — '+fmt(b.amount)+'</option>';}).join('')+
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
        return '<option value="'+v.name+'"'+(gps.vehicle===v.name?' selected':'')+'>'+full+'</option>';
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
  if(!S.locationDenied&&navigator.geolocation){navigator.geolocation.getCurrentPosition(p=>{gps.startCoords={lat:p.coords.latitude,lon:p.coords.longitude};},()=>{},{enableHighAccuracy:false,timeout:5000,maximumAge:30000});}
  const c=getClientById(currentClientId);
  gps.clientName=c?c.name:'Client';
  gps.startTime=Date.now();
  const _ds=document.getElementById('cd-drive-start');if(_ds)_ds.style.display='none';
  document.getElementById('cd-drive-active').style.display='block';
  const ap=document.getElementById('cd-active-purpose');if(ap)ap.textContent=gps.purpose||'Work drive';
  const av=document.getElementById('cd-active-vehicle');if(av)av.textContent=gps.vehicle||'';
  clearInterval(gps.timerInt);
  gps.timerInt=setInterval(updateDriveTimer,1000);
  if(c&&c.phone){
    const phone=c.phone.replace(/\D/g,'');
    const msg='Hi '+c.name.split(' ')[0]+', this is '+(S.bname||'TradeDesk')+' — I\'m on my way! I\'ll be there shortly.';
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

let _lmCoords={from:null,to:null};
let _tripSearchTimers={};
let _tripDestTimer=null;
let _tripGpsCoords=null; // cached GPS fix for search bias
let _fromBiasCache={val:null,coords:null}; // MapKit-geocoded From coords for To-field bias

// ── Shared geocoding — Mapbox (with key) or Photon+Census parallel ───────────
const _MAPKIT_TOKEN='eyJhbGciOiJFUzI1NiIsImtpZCI6IjU1TjkyUTVQWkQiLCJ0eXAiOiJKV1QifQ.eyJpc3MiOiJSVjI2NDRSTkdTIiwiaWF0IjoxNzc4MDc2NTgxLCJleHAiOjE4NDExNDg1ODF9.PgQ2btzlf0EH-QJg_fX8dcsw2eR1yyx-o0K7Kckvn3D_bzdEI2hUMuz3iH2c9t2DtUY2fTtP08r7aEQCsYvQ3w';
let _mapkitReady=false;
function _initMapKit(){
  if(typeof mapkit==='undefined')return;
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
    });
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
  if(S.mapboxKey){
    const _mbProx=(biasLat&&biasLon)?biasLon+','+biasLat:'ip';
    const r=await fetch('https://api.mapbox.com/geocoding/v5/mapbox.places/'+encodeURIComponent(val)+'.json?access_token='+S.mapboxKey+'&country=US&types=address&limit='+limit+'&proximity='+_mbProx);
    const d=await r.json();
    return(d.features||[]).map(f=>{
      const ctx=f.context||[];
      const zip=(ctx.find(c=>c.id.startsWith('postcode'))||{}).text||'';
      const city=(ctx.find(c=>c.id.startsWith('place'))||{}).text||'';
      const stateRaw=(ctx.find(c=>c.id.startsWith('region'))||{}).short_code||'';
      const state=stateRaw.replace('US-','');
      const street=(f.address?f.address+' ':'')+f.text;
      const[lon,lat]=f.center;
      const name=f.place_type?.includes('poi')?f.text:'';
      return{name,line1:street,line2:[city,state,zip].filter(Boolean).join(', '),street,city,state,zip,lat,lon};
    });
  }
  // No Mapbox key — Photon + Census in parallel
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
      const results=await _geocodeAddress(val,5,_fromBias?.lat||null,_fromBias?.lng||null);
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
  const selVeh=opts.vehicle||(vehs.length===1?vehs[0].name:'');
  const vehOpts=vehs.length
    ?vehs.map(v=>'<option value="'+v.name+'"'+(selVeh===v.name?' selected':'')+'>'+getVehicleFullLabel(v)+'</option>').join('')
    :'<option value="">— Add vehicle in Settings —</option>';
  const clientOpts='<option value="">— None —</option>'+clients.map(c=>'<option value="'+c.id+'">'+c.name+'</option>').join('');
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
        '<input id="lm-from" placeholder="Your address or last job" style="flex:1" value="'+(opts.fromAddress||'')+'" onfocus="_showRecentFromAddresses()" oninput="tripPlaceSearch(\'lm-from\',\'lm-from-sugg\',this.value)" autocomplete="off">'+
        '<button type="button" onclick="grabMyLocation(true)" class="btn btn-sm" id="lm-gps-btn" style="white-space:nowrap;flex-shrink:0;min-height:44px">📍 GPS</button>'+
      '</div>'+
      '<div id="lm-from-sugg" style="display:none;background:var(--bg);border:1px solid var(--border2);border-radius:var(--r);margin-top:2px;overflow:hidden;max-height:200px;overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,.12)"></div>'+
      '<div id="lm-from-chip" style="display:none;margin-top:5px;font-size:11px;color:var(--green-mid);background:var(--green-lt);border:1px solid var(--green-mid);border-radius:20px;padding:3px 10px;align-items:center;gap:4px"><span>📍</span><span id="lm-from-chip-txt"></span><span style="color:var(--green-mid);font-weight:700">✓</span></div>'+
      '</div>'+
    '<div class="f" style="margin-bottom:4px"><label>Driving to — client name or address</label>'+
      '<input id="lm-to" placeholder="Type client name or any address" value="'+(opts.toAddress||'')+'" onfocus="_showRecentDestinations()" oninput="_tripDestSearch(this.value)" autocomplete="off">'+
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
      '<input id="lm-notes" placeholder="e.g. Supply stop at Sherwin-Williams" value="'+(opts.notes||'')+'"></div>'+
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
  // Employees see only their own trips; owners see all
  const _mileSrc=_isEmployee?mileage.filter(m=>!m.logged_by_id||m.logged_by_id===_supaUser?.id):mileage;
  const filtered=_mileSrc.filter(m=>m.date&&m.date.startsWith(yr));
  const _hasMultiDriver=!_isEmployee&&mileage.some(m=>m.logged_by_name);
  const tot=filtered.reduce((s,r)=>s+(r.miles||0),0);
  const byPurpose={};
  filtered.forEach(m=>{const p=m.purpose||'Other';byPurpose[p]=(byPurpose[p]||0)+(m.miles||0);});
  const purposeRows=Object.entries(byPurpose).sort((a,b)=>b[1]-a[1]);
  const purposeHTML=purposeRows.map(([p,mi])=>{
    const pc=MILE_PURPOSE_COLORS[p]||MILE_PURPOSE_COLORS['Other'];
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border)">'+
      '<span style="font-size:11px;font-weight:700;padding:2px 9px;border-radius:20px;background:'+pc.bg+';color:'+pc.text+'">'+p+'</span>'+
      '<span style="font-size:12px;font-weight:700">'+mi.toFixed(1)+' mi &nbsp;<span style="color:var(--green-mid);font-weight:600">'+fmt(mi*IRS())+'</span></span>'+
    '</div>';
  }).join('');
  const homeOfficeNote=S.homeOffice
    ?'<div style="background:#F0FDF4;border:1.5px solid #16A34A;border-radius:var(--r);padding:8px 12px;margin-bottom:8px;font-size:11px;color:#166534"><strong>✓ Home office active</strong> — your drives from home to job sites count as deductible business miles (not commuting). Log every trip.</div>'
    :'<div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:var(--r);padding:8px 12px;margin-bottom:8px;font-size:11px;color:#1E40AF">💡 <strong>Home office tip:</strong> Drives from home to your first job site are not deductible yet. Set up a home office in Settings to unlock that deduction.</div>';
  document.getElementById('tr-mile-mets').innerHTML=
    homeOfficeNote+
    '<div class="mets" style="margin-bottom:8px">'+
      '<div class="met"><div class="met-l">'+yr+' miles</div><div class="met-v">'+tot.toFixed(1)+' mi</div></div>'+
      '<div class="met"><div class="met-l">IRS deduction</div><div class="met-v">'+fmt(tot*IRS())+'</div><div class="met-s">@ $'+IRS().toFixed(3)+'/mi</div></div>'+
    '</div>'+
    (purposeRows.length>1?
      '<div style="background:var(--bg2);border-radius:var(--r);padding:10px 12px;margin-bottom:10px">'+
        '<div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text3);margin-bottom:6px">By trip purpose</div>'+
        purposeHTML+
      '</div>':''
    );
  const el=document.getElementById('mil-table');
  if(!mileage.length){el.innerHTML='<div class="empty">No trips yet.<br>Open a client record and tap <strong>Start driving</strong> to log a trip.</div>';return;}
  if(!filtered.length){el.innerHTML='<div class="empty">No trips in '+yr+'.</div>';return;}
  const byDay={};
  [...filtered].sort((a,b)=>(b.date||'').localeCompare(a.date||'')).forEach(r=>{if(!byDay[r.date])byDay[r.date]=[];byDay[r.date].push(r);});
  el.innerHTML=Object.entries(byDay).sort((a,b)=>b[0].localeCompare(a[0])).map(([date,trips])=>{
    const dayMi=trips.reduce((s,t)=>s+(t.miles||0),0);
    const [y,mo,d]=date.split('-').map(Number);
    const dayLabel=new Date(y,mo-1,d).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
    const tripRows=trips.map(r=>{
      const fromAddr=r.from||'';
      const toAddr=r.to||(r.client_id?getClientById(r.client_id)?.addr||'':'');
      const dotG='<div style="width:10px;height:10px;border-radius:50%;background:#16a34a;box-shadow:0 0 0 3px rgba(22,163,74,.15);flex-shrink:0"></div>';
      const dotR='<div style="width:10px;height:10px;border-radius:50%;background:#ef4444;box-shadow:0 0 0 3px rgba(239,68,68,.15);flex-shrink:0"></div>';
      const _pc=MILE_PURPOSE_COLORS[r.purpose||'Other']||MILE_PURPOSE_COLORS['Other'];
      const purposeBadge='<span style="font-size:10px;font-weight:700;padding:2px 9px;border-radius:20px;background:'+_pc.bg+';color:'+_pc.text+';flex-shrink:0">'+(r.purpose||'Other')+'</span>';
      // Route always visible — Everlance style. 3-row layout keeps dots perfectly aligned.
      return '<div style="border-bottom:1px solid var(--border);padding:12px 14px">'+
        // From row — miles float right on this row
        '<div style="display:flex;align-items:flex-start;gap:10px">'+
          '<div style="width:10px;flex-shrink:0;display:flex;justify-content:center;padding-top:3px">'+dotG+'</div>'+
          '<div style="flex:1;min-width:0;font-size:13px;color:var(--text);line-height:1.35;user-select:all">'+(fromAddr?escHtml(fromAddr):'<span style="color:var(--text3);font-style:italic;font-size:12px">Start not recorded</span>')+'</div>'+
          '<div style="text-align:right;flex-shrink:0;padding-left:10px">'+
            '<div style="font-size:13px;font-weight:700;white-space:nowrap">'+(r.miles?(+r.miles).toFixed(1)+' mi':'—')+'</div>'+
          '</div>'+
        '</div>'+
        // Connector row — deduction floats right
        '<div style="display:flex;align-items:center;gap:10px;padding:3px 0">'+
          '<div style="width:10px;flex-shrink:0;display:flex;justify-content:center">'+
            '<div style="width:2px;height:14px;background:repeating-linear-gradient(to bottom,var(--border2) 0,var(--border2) 3px,transparent 3px,transparent 6px)"></div>'+
          '</div>'+
          '<div style="flex:1"></div>'+
          '<div style="font-size:11px;color:var(--green-mid);font-weight:600;white-space:nowrap">'+(r.miles?fmt((+r.miles)*IRS()):'')+'</div>'+
        '</div>'+
        // To row
        '<div style="display:flex;align-items:flex-start;gap:10px">'+
          '<div style="width:10px;flex-shrink:0;display:flex;justify-content:center;padding-top:3px">'+dotR+'</div>'+
          '<div style="flex:1;min-width:0;font-size:13px;color:var(--text);line-height:1.35;user-select:all">'+(toAddr?escHtml(toAddr):'<span style="color:var(--text3);font-style:italic;font-size:12px">End not recorded</span>')+'</div>'+
        '</div>'+
        // Bottom bar — labeled meta, edit + delete on right
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px;padding-top:8px;border-top:1px solid var(--border)">'+
          '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0;flex:1">'+
            purposeBadge+
            (r.vehicle?'<span style="font-size:10px;color:var(--text3)">Vehicle: <span style="color:var(--text2);font-weight:600">'+escHtml(r.vehicle)+'</span></span>':'')+
            (r.client_name?'<span style="font-size:10px;color:var(--text3)">'+escHtml(r.client_name)+'</span>':'')+
            (_hasMultiDriver&&r.logged_by_name?'<span style="font-size:10px;color:var(--text3)">Driver: <span style="color:var(--text2);font-weight:600">'+escHtml(r.logged_by_name)+'</span></span>':'')+
          '</div>'+
          '<div style="display:flex;align-items:center;gap:6px;flex-shrink:0">'+
            '<button onclick="openMileageEdit('+r.id+')" style="font-size:11px;font-weight:600;background:none;border:1px solid var(--border2);border-radius:var(--r);padding:3px 8px;cursor:pointer;color:var(--text2)">✏️ Edit</button>'+
            '<button class="btn-del" onclick="delMileage('+r.id+')">&#10005;</button>'+
          '</div>'+
        '</div>'+
      '</div>';
    }).join('');
    return '<div style="border:1px solid var(--border2);border-radius:var(--r);overflow:hidden;margin-bottom:8px">'+
      '<div onclick="_togMileDay(\''+date+'\')" style="display:flex;align-items:center;justify-content:space-between;padding:11px 14px;background:var(--bg2);cursor:pointer;user-select:none">'+
        '<div style="display:flex;align-items:center;gap:8px">'+
          '<span style="font-size:13px;font-weight:700">'+dayLabel+'</span>'+
          '<span style="font-size:11px;color:var(--text3)">'+trips.length+' trip'+(trips.length!==1?'s':'')+'</span>'+
        '</div>'+
        '<div style="display:flex;align-items:center;gap:10px">'+
          '<span style="font-size:12px;font-weight:700">'+dayMi.toFixed(1)+' mi</span>'+
          '<span style="font-size:12px;color:var(--green-mid)">'+fmt(dayMi*IRS())+'</span>'+
          '<span id="mile-day-chv-'+date+'" style="font-size:11px;color:var(--text3);display:inline-block;transition:transform .15s">▼</span>'+
        '</div>'+
      '</div>'+
      '<div id="mile-day-body-'+date+'" style="display:none">'+tripRows+'</div>'+
    '</div>';
  }).join('');
}
function _togMileDay(date){
  const body=document.getElementById('mile-day-body-'+date);
  const chv=document.getElementById('mile-day-chv-'+date);
  if(!body)return;
  const open=body.style.display!=='none';
  body.style.display=open?'none':'';
  if(chv)chv.style.transform=open?'':'rotate(180deg)';
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
function delMileage(id){mileage=mileage.filter(x=>x.id!==id);saveAll();_flushSaveNow();if(currentClientId){const el=document.getElementById('cd-mile-list');if(el)renderCDMileage();}renderAllMileage();}
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
