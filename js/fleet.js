// js/fleet.js — Fleet management module
// Vehicles are stored in S.vehicles (settings, syncs to Supabase)
// Maintenance records are stored in `maintenance` array (localStorage zp3_maint)

/* ── Service type definitions ───────────────────────────────────────────────── */
const MAINT_TYPES = {
  oil_change:   {label:'Oil Change',        icon:'🛢️', reminder:true,  intervalMi:5000,  intervalMo:6},
  tire_rotate:  {label:'Tire Rotation',     icon:'🔄', reminder:true,  intervalMi:7500,  intervalMo:6},
  alignment:    {label:'Alignment',         icon:'⚖️', reminder:false},
  shocks:       {label:'Shocks / Struts',   icon:'🔩', reminder:false},
  brakes:       {label:'Brakes',            icon:'🔴', reminder:false},
  fuel_filter:  {label:'Fuel Filter',       icon:'⛽', reminder:false},
  air_filter:   {label:'Air Filter',        icon:'💨', reminder:true,  intervalMi:15000, intervalMo:12},
  trans:        {label:'Transmission',      icon:'⚙️', reminder:false},
  coolant:      {label:'Coolant Flush',     icon:'🌡️', reminder:false},
  battery:      {label:'Battery',           icon:'🔋', reminder:false},
  belt:         {label:'Belt / Hose',       icon:'〰️', reminder:false},
  tires:        {label:'Tire Replacement',  icon:'⭕', reminder:false},
  windshield:   {label:'Windshield / Glass',icon:'🪟', reminder:false},
  bodywork:     {label:'Bodywork / Paint',  icon:'🎨', reminder:false},
  inspection:   {label:'Inspection',        icon:'✅', reminder:true,  intervalMo:12},
  registration: {label:'Registration',      icon:'📋', reminder:true,  intervalMo:12},
  wash:         {label:'Detail / Wash',     icon:'🧽', reminder:false},
  other:        {label:'Other',             icon:'🔧', reminder:false},
};

/* ── Tab switching ───────────────────────────────────────────────────────────── */
let _fleetTabActive = 'fleet';

function setFleetTab(tab) {
  _fleetTabActive = tab;
  ['fleet','team'].forEach(t => {
    const el = document.getElementById('ft-'+t);
    const b = document.getElementById('ft-t-'+t);
    if(el) el.style.display = t===tab ? '' : 'none';
    if(b) b.classList.toggle('active', t===tab);
  });
  const addFleet = document.getElementById('fleet-add-btn');
  const addTeam  = document.getElementById('team-add-btn');
  if(addFleet) addFleet.style.display = tab==='fleet'?'':'none';
  if(addTeam)  addTeam.style.display  = tab==='team' ?'':'none';
  if(tab==='fleet') renderFleetVehicles();
  if(tab==='team' && typeof renderTeam === 'function') renderTeam();
}

/* ── Main render ─────────────────────────────────────────────────────────────── */
function renderFleet() {
  if(_fleetTabActive === 'fleet') {
    renderFleetVehicles();
  }
}

function renderFleetVehicles() {
  const el = document.getElementById('fleet-vehicle-list');
  if(!el) return;
  const vehs = getVehicles();
  if(!vehs.length) {
    el.innerHTML =
      '<div style="padding:28px 20px 24px;text-align:center">' +
        '<div style="font-size:40px;margin-bottom:10px">🚛</div>' +
        '<div style="font-size:18px;font-weight:800;margin-bottom:6px;color:var(--text)">Set up your first vehicle</div>' +
        '<div style="font-size:13px;color:var(--text3);margin-bottom:20px;line-height:1.5;max-width:300px;margin-left:auto;margin-right:auto">The IRS requires a vehicle description on every business trip log. Add one here to unlock mileage tracking, maintenance records, and tax deductions.</div>' +
        '<button class="btn btn-p" onclick="openAddVehicleModal(-1)" style="font-size:15px;padding:13px 28px;margin-bottom:24px">+ Add your first vehicle</button>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;text-align:left;max-width:340px;margin:0 auto">' +
          '<div style="background:var(--bg2);border-radius:var(--r);padding:10px 12px"><div style="font-size:15px;margin-bottom:3px">🗺️</div><div style="font-size:12px;font-weight:700;color:var(--text)">IRS mileage log</div><div style="font-size:11px;color:var(--text3)">Per-vehicle trip log the IRS requires</div></div>' +
          '<div style="background:var(--bg2);border-radius:var(--r);padding:10px 12px"><div style="font-size:15px;margin-bottom:3px">🔧</div><div style="font-size:12px;font-weight:700;color:var(--text)">Maintenance records</div><div style="font-size:11px;color:var(--text3)">Service log + cost per mile</div></div>' +
          '<div style="background:var(--bg2);border-radius:var(--r);padding:10px 12px"><div style="font-size:15px;margin-bottom:3px">📊</div><div style="font-size:12px;font-weight:700;color:var(--text)">Business use %</div><div style="font-size:11px;color:var(--text3)">Auto-calculated from odometer</div></div>' +
          '<div style="background:var(--bg2);border-radius:var(--r);padding:10px 12px"><div style="font-size:15px;margin-bottom:3px">💰</div><div style="font-size:12px;font-weight:700;color:var(--text)">P&L per vehicle</div><div style="font-size:11px;color:var(--text3)">Deductions vs. actual costs</div></div>' +
        '</div>' +
      '</div>';
    return;
  }
  // Sort: active first, down second, sold last
  const sorted = [...vehs.entries()].sort(([,a],[,b])=>{
    const order={active:0,down:1,sold:2};
    return (order[a.status||'active']||0)-(order[b.status||'active']||0);
  });
  el.innerHTML = sorted.map(([idx,v])=>_fleetCard(v,idx)).join('');
  // Summary row at bottom
  const active = vehs.filter(v=>(v.status||'active')==='active');
  const totalCost = vehs.reduce((s,v)=>s+(v.purchasePrice||0),0);
  const yr = new Date().getFullYear().toString();
  const ytdMiles = vehs.reduce((s,v)=>{
    return s + mileage.filter(t=>t.vehicle===v.name&&(t.date||'').startsWith(yr))
                      .reduce((ss,t)=>ss+(t.miles||0),0);
  },0);
  const maintYTD = maintenance.filter(m=>(m.date||'').startsWith(yr))
                              .reduce((s,m)=>s+(m.cost||0),0);
  el.innerHTML += `<div style="margin:16px 0 4px;padding:12px 14px;background:var(--bg2);border-radius:var(--r);border:1px solid var(--border)">
    <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:8px">Fleet summary</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
      <div style="text-align:center"><div style="font-size:18px;font-weight:800;color:var(--text)">${active.length}</div><div style="font-size:10px;color:var(--text3)">Active vehicles</div></div>
      <div style="text-align:center"><div style="font-size:18px;font-weight:800;color:var(--text)">${ytdMiles>0?Math.round(ytdMiles).toLocaleString():'—'}</div><div style="font-size:10px;color:var(--text3)">YTD miles</div></div>
      <div style="text-align:center"><div style="font-size:18px;font-weight:800;color:var(--blue)">${maintYTD>0?'$'+maintYTD.toLocaleString():'$0'}</div><div style="font-size:10px;color:var(--text3)">Maint YTD</div></div>
    </div>
    ${totalCost>0?`<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);font-size:11px;color:var(--text3);text-align:center">Total cost basis: <strong style="color:var(--text)">$${totalCost.toLocaleString()}</strong></div>`:''}
  </div>`;
}

function _fleetCard(v, idx) {
  const status = v.status || 'active';
  const statusColors = {active:'var(--green)',down:'var(--red)',sold:'var(--text3)'};
  const statusLabels = {active:'● Active',down:'🔴 Down',sold:'📦 Sold'};
  const statusColor = statusColors[status] || statusColors.active;
  const yr = new Date().getFullYear().toString();
  const trips = mileage.filter(t=>t.vehicle===v.name&&(t.date||'').startsWith(yr));
  const ytdMi = Math.round(trips.reduce((s,t)=>s+(t.miles||0),0));
  const maint = maintenance.filter(m=>m.vehicleName===v.name);
  const lastMaint = maint.slice().sort((a,b)=>b.date>a.date?1:-1)[0];
  const due = _fleetDueAlerts(v, maint);
  const maintYTD = maint.filter(m=>(m.date||'').startsWith(yr)).reduce((s,m)=>s+(m.cost||0),0);
  const downDays = _fleetDownDays(v, yr);

  // P&L quick calc
  const pnl = _fleetPnLCalc(v, maint, trips, yr);

  return `<div class="card" style="margin-bottom:10px;${status==='down'?'border-left:3px solid var(--red);':''}${status==='sold'?'opacity:.7;':''}" onclick="openFleetVehicleDetail(${idx})">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div style="flex:1;min-width:0">
        <div style="font-size:16px;font-weight:800;color:var(--text);margin-bottom:1px">${escHtml(v.nickname||v.name||'')}</div>
        ${v.nickname?`<div style="font-size:11px;color:var(--text3)">${escHtml(v.name||'')}</div>`:''}
        <div style="font-size:11px;color:${statusColor};font-weight:700;margin-top:3px">${statusLabels[status]||statusLabels.active}</div>
      </div>
      <button onclick="event.stopPropagation();openAddVehicleModal(${idx})" class="btn btn-sm" style="font-size:11px;padding:3px 8px;flex-shrink:0">Edit</button>
    </div>
    ${due.length?`<div style="margin-top:8px">${due.map(d=>`<div style="font-size:11px;background:var(--amber-lt);color:#92400E;border-radius:4px;padding:3px 8px;margin-bottom:3px;display:inline-block;margin-right:4px">⚠️ ${d}</div>`).join('')}</div>`:''}
    <div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">
      <div style="background:var(--bg2);border-radius:var(--r);padding:6px 8px;text-align:center">
        <div style="font-size:15px;font-weight:800;color:var(--text)">${ytdMi>0?ytdMi.toLocaleString():'—'}</div>
        <div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em">YTD miles</div>
      </div>
      <div style="background:var(--bg2);border-radius:var(--r);padding:6px 8px;text-align:center">
        <div style="font-size:15px;font-weight:800;color:${maintYTD>0?'var(--text)':'var(--text3)'}">${maintYTD>0?'$'+maintYTD.toLocaleString():'$0'}</div>
        <div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em">Maint YTD</div>
      </div>
      <div style="background:var(--bg2);border-radius:var(--r);padding:6px 8px;text-align:center">
        <div style="font-size:15px;font-weight:800;color:${pnl.costPerMile>0?'var(--text)':'var(--text3)'}">${pnl.costPerMile>0?'$'+pnl.costPerMile.toFixed(2):'—'}</div>
        <div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em">Cost/mile</div>
      </div>
    </div>
    ${downDays>0?`<div style="margin-top:8px;font-size:11px;color:var(--red)">⏱ Down ${downDays} day${downDays===1?'':'s'} this year</div>`:''}
    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px;gap:8px">
      <button onclick="event.stopPropagation();openFleetVehicleDetail(${idx});setTimeout(()=>setFleetDetailTab('service'),80)" style="background:none;border:none;padding:0;cursor:pointer;text-align:left;font-size:11px;color:var(--blue);font-family:inherit;flex:1;min-width:0">
        ${lastMaint?`🔧 ${escHtml(lastMaint.typeLabel||lastMaint.type||'')} <span style="color:var(--text3)">${_fleetFmtDate(lastMaint.date)}</span> <span style="color:var(--text3)">›</span>`:'<span style="color:var(--text3)">No service records</span>'}
      </button>
      <button onclick="event.stopPropagation();openAddMaintenanceModal(${idx})" class="btn btn-sm" style="font-size:11px;padding:3px 10px;flex-shrink:0">+ Log service</button>
    </div>
    ${v.purchasePrice?`<div style="font-size:11px;color:var(--text3);margin-top:2px">Purchased: $${v.purchasePrice.toLocaleString()}${v.purchaseDate?' · '+_fleetFmtDate(v.purchaseDate):''}</div>`:''}
  </div>`;
}

/* ── Due service alerts ──────────────────────────────────────────────────────── */
function _fleetDueAlerts(v, maintRecords) {
  const alerts = [];
  const todayStr = todayKey();
  const getLastService = (type) => maintRecords.filter(m=>m.type===type).slice().sort((a,b)=>b.date>a.date?1:-1)[0];

  Object.entries(MAINT_TYPES).forEach(([type, def]) => {
    if(!def.reminder) return;
    const last = getLastService(type);
    if(!last) return;

    // Miles-based check
    if(def.intervalMi && last.nextOilMiles) {
      // Can't check without live odo, skip miles check unless nextOilDate says due
    }

    // Date-based check
    if(def.intervalMo) {
      const nextDate = last.nextOilDate || _fleetAddMonths(last.date, def.intervalMo);
      if(nextDate && nextDate <= todayStr) {
        alerts.push(def.label+' due');
      }
    }
  });

  return alerts;
}

function _fleetAddMonths(dateStr, months) {
  if(!dateStr) return '';
  try {
    const d = new Date(dateStr+'T12:00:00');
    d.setMonth(d.getMonth() + months);
    return d.toISOString().slice(0,10);
  } catch(e) { return ''; }
}

/* ── Downtime calculations ───────────────────────────────────────────────────── */
function _fleetDownDays(v, year) {
  if(!v.downtimeLog||!v.downtimeLog.length) return 0;
  let total = 0;
  const yearStart = year+'-01-01';
  const yearEnd   = year+'-12-31';
  v.downtimeLog.forEach(d => {
    const s = d.start > yearStart ? d.start : yearStart;
    const e = (d.end || todayKey()) < yearEnd ? (d.end || todayKey()) : yearEnd;
    if(s <= e) {
      const days = Math.round((new Date(e+'T12:00:00') - new Date(s+'T12:00:00'))/(1000*60*60*24));
      total += days + 1;
    }
  });
  return total;
}

/* ── P&L calculation ─────────────────────────────────────────────────────────── */
function _fleetPnLCalc(v, maintRecords, trips, year) {
  const method = v.deductionMethod || 'mileage';
  const totalMiles = trips.reduce((s,t)=>s+(t.miles||0),0);
  const maintCostYTD = maintRecords.filter(m=>(m.date||'').startsWith(year)).reduce((s,m)=>s+(m.cost||0),0);
  const purchasePrice = v.purchasePrice || 0;
  const bizPct = (v.bizUse||100)/100;

  if(method === 'actual') {
    // Actual expense method: deduct actual costs at the business-use %
    // 5-year straight-line depreciation on the business-use portion
    const annualDeprec = purchasePrice > 0 ? +(purchasePrice * bizPct / 5).toFixed(2) : 0;
    const deductibleMaint = +(maintCostYTD * bizPct).toFixed(2);
    const totalDeduction = +(deductibleMaint + annualDeprec).toFixed(2);
    const costPerMile = totalMiles > 0 ? +(totalDeduction / totalMiles).toFixed(2) : 0;
    return {method:'actual',totalMiles,irsDeduction:0,maintCostYTD,deductibleMaint,annualDeprec,totalDeduction,totalCost:totalDeduction,costPerMile,netPosition:totalDeduction};
  } else {
    // Standard mileage method: IRS rate × miles × biz% = deduction; maintenance is records-only
    const irsDeduction = +(totalMiles * (S.irsRate||0.67) * bizPct).toFixed(2);
    // "Real" cost per mile based on actual maintenance spend (for awareness, not deduction)
    const costPerMile = totalMiles > 0 ? +(maintCostYTD / totalMiles).toFixed(2) : 0;
    return {method:'mileage',totalMiles,irsDeduction,maintCostYTD,deductibleMaint:0,annualDeprec:0,totalDeduction:irsDeduction,totalCost:maintCostYTD,costPerMile,netPosition:irsDeduction};
  }
}

/* ── Vehicle detail modal ────────────────────────────────────────────────────── */
let _fleetDetailIdx = -1;
let _fleetDetailTab = 'overview';

function openFleetVehicleDetail(idx) {
  const vehs = getVehicles();
  if(idx < 0 || idx >= vehs.length) return;
  _fleetDetailIdx = idx;
  _fleetDetailTab = 'overview';
  _renderFleetDetailModal();
}

function _renderFleetDetailModal() {
  const vehs = getVehicles();
  if(_fleetDetailIdx < 0) return;
  const v = vehs[_fleetDetailIdx];
  if(!v) return;

  const ov = document.getElementById('fleet-detail-overlay') || _createFleetDetailOverlay();
  const box = document.getElementById('fleet-detail-box');
  if(!box) return;

  const yr = new Date().getFullYear().toString();
  const trips = mileage.filter(t=>t.vehicle===v.name);
  const maint = maintenance.filter(m=>m.vehicleName===v.name).slice().sort((a,b)=>b.date>a.date?1:-1);
  const pnl = _fleetPnLCalc(v, maint, trips.filter(t=>(t.date||'').startsWith(yr)), yr);
  const downDays = _fleetDownDays(v, yr);
  const allDownDays = _fleetTotalDownDays(v);
  const status = v.status||'active';
  const statusColors = {active:'var(--green)',down:'var(--red)',sold:'var(--text3)'};
  const statusLabels = {active:'● Active',down:'🔴 Down',sold:'📦 Sold'};

  const tabs = ['overview','service','pl'];
  const tabLabels = {overview:'Overview',service:'Service Log',pl:'P&L'};

  box.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 16px 0">
      <div>
        <div style="font-size:18px;font-weight:800">${escHtml(v.nickname||v.name||'')}</div>
        ${v.nickname?`<div style="font-size:11px;color:var(--text3)">${escHtml(v.name||'')}</div>`:''}
        <div style="font-size:12px;font-weight:700;color:${statusColors[status]};margin-top:2px">${statusLabels[status]}</div>
      </div>
      <button onclick="_closeFleetDetail()" style="font-size:22px;line-height:1;background:none;border:none;color:var(--text3);cursor:pointer;padding:4px">×</button>
    </div>
    <div class="fbar" style="padding:0 16px;margin-top:8px">
      ${tabs.map(t=>`<button type="button" class="fb${_fleetDetailTab===t?' active':''}" onclick="setFleetDetailTab('${t}')">${tabLabels[t]}</button>`).join('')}
    </div>
    <div id="fleet-detail-content" style="padding:14px 16px 80px;overflow-y:auto;max-height:65vh">
      ${_fleetDetailTab==='overview'?_fleetDetailOverviewHtml(v,pnl,maint,downDays,allDownDays,yr):''}
      ${_fleetDetailTab==='service'?_fleetDetailServiceHtml(v,maint):''}
      ${_fleetDetailTab==='pl'?_fleetDetailPnLHtml(v,pnl,maint,trips):''}
    </div>
  `;
  ov.style.display = 'flex';
}

function _createFleetDetailOverlay() {
  const ov = document.createElement('div');
  ov.id = 'fleet-detail-overlay';
  ov.style.cssText = 'display:none;position:fixed;inset:0;z-index:3000;background:rgba(0,0,0,.5);align-items:flex-end;justify-content:center';
  const box = document.createElement('div');
  box.id = 'fleet-detail-box';
  box.style.cssText = 'background:var(--bg);border-radius:var(--rl) var(--rl) 0 0;width:100%;max-width:520px;max-height:95vh;overflow:hidden;display:flex;flex-direction:column';
  ov.appendChild(box);
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if(e.target===ov) _closeFleetDetail(); });
  return ov;
}

function _closeFleetDetail() {
  const ov = document.getElementById('fleet-detail-overlay');
  if(ov) ov.style.display = 'none';
}

function setFleetDetailTab(tab) {
  _fleetDetailTab = tab;
  _renderFleetDetailModal();
}

function _fleetDetailOverviewHtml(v, pnl, maint, downDays, allDownDays, yr) {
  const due = _fleetDueAlerts(v, maint);
  const status = v.status || 'active';
  const allTrips = mileage.filter(t=>t.vehicle===v.name);
  const lifetimeMi = Math.round(allTrips.reduce((s,t)=>s+(t.miles||0),0));
  const bizPct = v.bizUse||100;

  return `
    ${due.length?`<div style="background:var(--amber-lt);border:1px solid #F59E0B;border-radius:var(--r);padding:10px 12px;margin-bottom:12px">${due.map(d=>`<div style="font-size:12px;color:#92400E;font-weight:600">⚠️ ${d}</div>`).join('')}</div>`:''}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">
      <div style="background:var(--bg2);border-radius:var(--r);padding:10px;text-align:center">
        <div style="font-size:20px;font-weight:800">${pnl.totalMiles>0?Math.round(pnl.totalMiles).toLocaleString():'—'}</div>
        <div style="font-size:10px;color:var(--text3)">Miles this year</div>
      </div>
      <div style="background:var(--bg2);border-radius:var(--r);padding:10px;text-align:center">
        <div style="font-size:20px;font-weight:800;color:${pnl.costPerMile>0?'var(--text)':'var(--text3)'}">${pnl.costPerMile>0?'$'+pnl.costPerMile:'—'}</div>
        <div style="font-size:10px;color:var(--text3)">Cost per mile</div>
      </div>
      <div style="background:var(--bg2);border-radius:var(--r);padding:10px;text-align:center">
        <div style="font-size:20px;font-weight:800;color:var(--blue)">${pnl.maintCostYTD>0?'$'+pnl.maintCostYTD.toLocaleString():'$0'}</div>
        <div style="font-size:10px;color:var(--text3)">Maintenance YTD</div>
      </div>
      <div style="background:var(--bg2);border-radius:var(--r);padding:10px;text-align:center">
        <div style="font-size:20px;font-weight:800;color:${lifetimeMi>0?'var(--text)':'var(--text3)'}">${lifetimeMi>0?lifetimeMi.toLocaleString():'—'}</div>
        <div style="font-size:10px;color:var(--text3)">Lifetime miles logged</div>
      </div>
    </div>
    <button onclick="openOdometerReport(${_fleetDetailIdx})" class="btn" style="width:100%;margin-bottom:12px;background:var(--bg2);border-color:var(--border2);font-size:13px;display:flex;align-items:center;justify-content:center;gap:6px">
      📊 Year-end mileage report
      ${bizPct<100?`<span style="font-size:10px;background:var(--blue);color:#fff;border-radius:99px;padding:1px 7px;font-weight:700">${bizPct}% biz</span>`:''}
    </button>

    ${v.purchasePrice||v.purchaseDate||v.plate||v.vin?`
    <div style="border:1px solid var(--border);border-radius:var(--r);padding:10px 12px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:800;text-transform:uppercase;color:var(--text3);margin-bottom:8px">Vehicle info</div>
      ${v.purchasePrice?`<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:12px;color:var(--text3)">Purchase price</span><span style="font-size:12px;font-weight:700">$${v.purchasePrice.toLocaleString()}</span></div>`:''}
      ${v.purchaseDate?`<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:12px;color:var(--text3)">Purchase date</span><span style="font-size:12px">${_fleetFmtDate(v.purchaseDate)}</span></div>`:''}
      ${v.purchaseOdo?`<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:12px;color:var(--text3)">Odometer at purchase</span><span style="font-size:12px">${v.purchaseOdo.toLocaleString()} mi</span></div>`:''}
      ${v.plate?`<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:12px;color:var(--text3)">License plate</span><span style="font-size:12px;font-weight:700">${escHtml(v.plate)}</span></div>`:''}
      ${v.vin?`<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:12px;color:var(--text3)">VIN</span><span style="font-size:11px;font-family:monospace">${escHtml(v.vin)}</span></div>`:''}
      ${v.color?`<div style="display:flex;justify-content:space-between"><span style="font-size:12px;color:var(--text3)">Color</span><span style="font-size:12px">${escHtml(v.color)}</span></div>`:''}
    </div>`:''}

    ${status==='sold'&&v.saleDate?`
    <div style="border:1px solid var(--border);border-radius:var(--r);padding:10px 12px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:800;text-transform:uppercase;color:var(--text3);margin-bottom:8px">Sale info</div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:12px;color:var(--text3)">Sale date</span><span style="font-size:12px">${_fleetFmtDate(v.saleDate)}</span></div>
      ${v.salePrice?`<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:12px;color:var(--text3)">Sale price</span><span style="font-size:12px;font-weight:700">$${v.salePrice.toLocaleString()}</span></div>`:''}
      ${v.purchasePrice&&v.salePrice?`<div style="display:flex;justify-content:space-between;padding-top:6px;border-top:1px solid var(--border)"><span style="font-size:12px;color:var(--text3)">Gain / (Loss)</span><span style="font-size:12px;font-weight:700;color:${v.salePrice>=v.purchasePrice?'var(--green)':'var(--red)'}">$${(v.salePrice-v.purchasePrice).toLocaleString()}</span></div>`:''}
    </div>`:''}

    ${allDownDays>0?`
    <div style="border:1px solid var(--border);border-radius:var(--r);padding:10px 12px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:800;text-transform:uppercase;color:var(--text3);margin-bottom:8px">Downtime log</div>
      ${(v.downtimeLog||[]).map(d=>`
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;padding-bottom:6px;border-bottom:1px solid var(--border)">
          <div>
            <div style="font-size:12px;font-weight:600">${_fleetFmtDate(d.start)} – ${d.end?_fleetFmtDate(d.end):'ongoing'}</div>
            ${d.reason?`<div style="font-size:11px;color:var(--text3)">${escHtml(d.reason)}</div>`:''}
          </div>
          <div style="font-size:11px;color:var(--red)">${_fleetDowntimeDays(d)} day${_fleetDowntimeDays(d)===1?'':'s'}</div>
        </div>
      `).join('')}
    </div>`:''}

    <div style="display:grid;gap:8px">
      <button class="btn btn-p" onclick="openAddMaintenanceModal(${_fleetDetailIdx})" style="font-size:15px;padding:14px">+ Log service</button>
      ${status==='active'?`<button class="btn" onclick="openFleetStatusModal(${_fleetDetailIdx},'down')" style="background:var(--bg2);border-color:var(--border2);color:var(--red);font-weight:700">🔴 Mark as down / in shop</button>`:''}
      ${status==='down'?`<button class="btn" onclick="openFleetStatusModal(${_fleetDetailIdx},'active')" style="background:var(--green-lt);border-color:var(--green);color:var(--green)">✅ Back in service</button>`:''}
      ${status!=='sold'?`<button class="btn" onclick="openFleetSaleModal(${_fleetDetailIdx})" style="background:var(--bg2);border-color:var(--border2);font-size:13px">📦 Record sale</button>`:''}
    </div>
  `;
}

function _fleetDetailServiceHtml(v, maint) {
  if(!maint.length) return `
    <div style="text-align:center;padding:24px 0;color:var(--text3)">
      <div style="font-size:28px;margin-bottom:8px">🔧</div>
      <div style="font-size:13px;margin-bottom:12px">No service records yet</div>
      <button class="btn btn-p" onclick="openAddMaintenanceModal(${_fleetDetailIdx})" style="font-size:14px;padding:12px 24px">+ Log first service</button>
    </div>`;

  const _svcParts = m => {
    const parts = [];
    if(m.oilBrand||m.oilType) parts.push((m.oilBrand?escHtml(m.oilBrand)+' ':'')+escHtml(m.oilType||''));
    if(m.oilFilterPart) parts.push('Filter: '+escHtml(m.oilFilterPart));
    if(m.tireBrand) parts.push(escHtml(m.tireBrand)+(m.tireSize?' '+escHtml(m.tireSize):'')+(m.tireCount?' ×'+m.tireCount:''));
    if(m.vendor) parts.push(escHtml(m.vendor));
    return parts.join(' · ');
  };

  return `
    <button class="btn btn-p" onclick="openAddMaintenanceModal(${_fleetDetailIdx})" style="width:100%;margin-bottom:10px;font-size:14px;padding:12px">+ Log service</button>
    <div style="border:1px solid var(--border);border-radius:var(--r);overflow:hidden">
      <!-- header row -->
      <div style="display:grid;grid-template-columns:72px 1fr 64px 44px;gap:0;background:var(--bg2);border-bottom:1px solid var(--border);padding:6px 10px">
        <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3)">Date</div>
        <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3)">Service / Parts</div>
        <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);text-align:right">Mi</div>
        <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);text-align:right">Cost</div>
      </div>
      ${maint.map((m,i)=>{
        const parts=_svcParts(m);
        const icon=MAINT_TYPES[m.type]?MAINT_TYPES[m.type].icon:'🔧';
        const dateShort=m.date?new Date(m.date+'T12:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}):'—';
        const nextInfo=m.nextOilMiles?`<div style="font-size:10px;color:var(--text3);margin-top:1px">Next: ${m.nextOilMiles.toLocaleString()} mi</div>`:'';
        const notesInfo=m.notes?`<div style="font-size:10px;color:var(--text3);font-style:italic;margin-top:1px">${escHtml(m.notes)}</div>`:'';
        return `<div style="display:grid;grid-template-columns:72px 1fr 64px 44px;gap:0;padding:8px 10px;border-bottom:1px solid var(--border);align-items:start;${i%2===1?'background:var(--bg2)':''}">
          <div style="font-size:12px;font-weight:700;color:var(--text);padding-right:6px">${dateShort}</div>
          <div style="min-width:0">
            <div style="font-size:12px;font-weight:700">${icon} ${escHtml(m.typeLabel||m.type||'')}</div>
            ${parts?`<div style="font-size:11px;color:var(--text3);margin-top:1px;word-break:break-word">${parts}</div>`:''}
            ${nextInfo}${notesInfo}
            <div style="margin-top:4px;display:flex;gap:10px">
              ${m.photo?`<span style="font-size:10px;color:var(--blue);cursor:pointer" onclick="_showMaintPhoto('${m.id}')">📷 Receipt</span>`:''}
              <span style="font-size:10px;color:var(--text3);cursor:pointer" onclick="openAddMaintenanceModal(${_fleetDetailIdx},${m.id})">Edit</span>
            </div>
          </div>
          <div style="font-size:12px;color:var(--text3);text-align:right;padding-left:4px">${m.odo?m.odo.toLocaleString():'—'}</div>
          <div style="font-size:12px;font-weight:700;color:${m.cost?'var(--blue)':'var(--text3)'};text-align:right">${m.cost?'$'+m.cost.toLocaleString():'—'}</div>
        </div>`;
      }).join('')}
    </div>
  `;
}

function _fleetDetailPnLHtml(v, pnl, maint, trips) {
  const yrs = [...new Set([
    ...trips.map(t=>(t.date||'').slice(0,4)),
    ...maint.map(m=>(m.date||'').slice(0,4)),
  ].filter(Boolean))].sort().reverse();
  if(!yrs.length) yrs.push(new Date().getFullYear().toString());
  const method = v.deductionMethod || 'mileage';

  const methodBadge = method === 'actual'
    ? `<span style="font-size:10px;background:var(--blue);color:#fff;border-radius:4px;padding:2px 6px;margin-left:6px;font-weight:700">Actual Expenses</span>`
    : `<span style="font-size:10px;background:var(--green);color:#fff;border-radius:4px;padding:2px 6px;margin-left:6px;font-weight:700">Standard Mileage</span>`;

  return yrs.map(yr => {
    const yrTrips = trips.filter(t=>(t.date||'').startsWith(yr));
    const yrMaint = maint.filter(m=>(m.date||'').startsWith(yr));
    const p = _fleetPnLCalc(v, yrMaint, yrTrips, yr);

    if(method === 'actual') {
      return `
        <div style="border:1px solid var(--border);border-radius:var(--r);padding:12px;margin-bottom:12px">
          <div style="display:flex;align-items:center;margin-bottom:10px"><span style="font-size:13px;font-weight:800">${yr}</span>${methodBadge}</div>
          <div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="font-size:12px;color:var(--text3)">Business miles</span><span style="font-size:12px;font-weight:600">${Math.round(p.totalMiles).toLocaleString()} mi</span></div>
          <div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="font-size:12px;color:var(--text3)">Business use</span><span style="font-size:12px;font-weight:600">${v.bizUse||100}%</span></div>
          <div style="border-top:1px solid var(--border);margin:6px 0"></div>
          <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:12px;color:var(--text3)">Maintenance costs</span><span style="font-size:12px">$${p.maintCostYTD.toLocaleString()}</span></div>
          <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:12px;color:var(--text3)">Deductible portion (×${v.bizUse||100}%)</span><span style="font-size:12px;color:var(--red)">−$${p.deductibleMaint.toLocaleString()}</span></div>
          ${p.annualDeprec>0?`<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:12px;color:var(--text3)">Depreciation (5-yr straight-line)</span><span style="font-size:12px;color:var(--red)">−$${p.annualDeprec.toLocaleString()}</span></div>`:''}
          <div style="border-top:1px solid var(--border);margin:6px 0"></div>
          <div style="display:flex;justify-content:space-between">
            <span style="font-size:13px;font-weight:700">Vehicle deduction</span>
            <span style="font-size:14px;font-weight:800;color:var(--green)">$${p.totalDeduction.toLocaleString()}</span>
          </div>
          ${p.costPerMile>0?`<div style="font-size:11px;color:var(--text3);text-align:center;margin-top:6px">Cost per mile: $${p.costPerMile}</div>`:''}
        </div>
      `;
    } else {
      // Standard mileage method
      return `
        <div style="border:1px solid var(--border);border-radius:var(--r);padding:12px;margin-bottom:12px">
          <div style="display:flex;align-items:center;margin-bottom:10px"><span style="font-size:13px;font-weight:800">${yr}</span>${methodBadge}</div>
          <div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="font-size:12px;color:var(--text3)">Business miles</span><span style="font-size:12px;font-weight:600">${Math.round(p.totalMiles).toLocaleString()} mi</span></div>
          <div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="font-size:12px;color:var(--text3)">IRS rate (${((S.irsRate||0.67)*100).toFixed(0)}¢/mi × ${v.bizUse||100}% biz)</span><span style="font-size:12px;font-weight:600;color:var(--green)">$${p.irsDeduction.toLocaleString()}</span></div>
          <div style="border-top:1px solid var(--border);margin:6px 0"></div>
          <div style="background:var(--bg2);border-radius:var(--r);padding:8px 10px;margin-bottom:8px">
            <div style="font-size:11px;font-weight:700;color:var(--text3);margin-bottom:3px">📋 Maintenance — records only</div>
            <div style="font-size:11px;color:var(--text3)">Under the standard mileage method, maintenance costs are included in the IRS rate — they are not deducted separately.</div>
            <div style="display:flex;justify-content:space-between;margin-top:6px"><span style="font-size:12px;color:var(--text3)">Actual maintenance spend</span><span style="font-size:12px;color:var(--text3)">$${p.maintCostYTD.toLocaleString()}</span></div>
          </div>
          <div style="border-top:1px solid var(--border);margin:6px 0"></div>
          <div style="display:flex;justify-content:space-between">
            <span style="font-size:13px;font-weight:700">Vehicle deduction</span>
            <span style="font-size:14px;font-weight:800;color:var(--green)">$${p.irsDeduction.toLocaleString()}</span>
          </div>
          ${p.costPerMile>0?`<div style="font-size:11px;color:var(--text3);text-align:center;margin-top:6px">Real cost per mile (actual): $${p.costPerMile}</div>`:''}
        </div>
      `;
    }
  }).join('');
}

function _fleetTotalDownDays(v) {
  if(!v.downtimeLog||!v.downtimeLog.length) return 0;
  return v.downtimeLog.reduce((s,d) => s + _fleetDowntimeDays(d), 0);
}

function _fleetDowntimeDays(d) {
  const s = d.start || todayKey();
  const e = d.end || todayKey();
  const days = Math.round((new Date(e+'T12:00:00')-new Date(s+'T12:00:00'))/(1000*60*60*24));
  return Math.max(0, days + 1);
}

/* ── Odometer year-end report ────────────────────────────────────────────────── */
let _odoReportVehIdx = -1;
let _odoReportYear = new Date().getFullYear();

function openOdometerReport(vehIdx) {
  const vehs = getVehicles();
  const v = vehs[vehIdx];
  if(!v) return;
  _odoReportVehIdx = vehIdx;
  _odoReportYear = new Date().getFullYear();
  _renderOdometerReport();
}

function _renderOdometerReport() {
  const vehs = getVehicles();
  const v = vehs[_odoReportVehIdx];
  if(!v) return;
  const yr = String(_odoReportYear);
  const log = S.vehicleOdoLog || {};
  const key = _vehKey(v);
  const rec = (log[yr] && log[yr][key]) || {};
  const loggedMiles = mileage.filter(t=>t.vehicle===v.name&&(t.date||'').startsWith(yr))
                             .reduce((s,t)=>s+(t.miles||0),0);
  const startOdo = rec.start || 0;
  const endOdo = rec.end || 0;
  const totalDriven = endOdo > startOdo ? endOdo - startOdo : 0;
  const bizPct = totalDriven > 0 ? Math.min(100, Math.round((loggedMiles / totalDriven) * 100)) : 0;
  const curYr = new Date().getFullYear();

  let ov = document.getElementById('odo-report-overlay');
  if(!ov) {
    ov = document.createElement('div');
    ov.id = 'odo-report-overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:3003;background:rgba(0,0,0,.5);display:flex;align-items:flex-end;justify-content:center';
    ov.addEventListener('click', e=>{ if(e.target===ov) ov.remove(); });
    document.body.appendChild(ov);
  }
  ov.innerHTML = `
    <div style="background:var(--bg);border-radius:var(--rl) var(--rl) 0 0;width:100%;max-width:520px">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 16px 14px;border-bottom:1px solid var(--border)">
        <div style="font-size:20px;font-weight:800">📊 Mileage report</div>
        <button onclick="document.getElementById('odo-report-overlay').remove()" style="font-size:22px;background:none;border:none;color:var(--text3);cursor:pointer;padding:4px">×</button>
      </div>
      <div style="padding:14px 16px 40px;overflow-y:auto;max-height:75vh">
        <div style="font-size:13px;font-weight:700;color:var(--text3);margin-bottom:12px">${escHtml(v.nickname||v.name)}</div>
        <div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap">
          ${[0,1,2,3].map(d=>{const y=curYr-d;return`<button onclick="_odoReportYear=${y};_renderOdometerReport()" style="padding:6px 12px;border-radius:99px;border:1.5px solid ${y===_odoReportYear?'var(--blue)':'var(--border2)'};background:${y===_odoReportYear?'var(--blue-lt)':'var(--bg2)'};color:${y===_odoReportYear?'var(--blue)':'var(--text3)'};font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">${y}</button>`;}).join('')}
        </div>
        <div class="card" style="margin-bottom:12px">
          <div style="font-size:11px;font-weight:800;text-transform:uppercase;color:var(--text3);margin-bottom:10px">Odometer readings (IRS Pub. 463)</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div class="f"><label>Jan 1 reading (mi)</label>
              <input type="number" id="odo-start" min="0" step="1" placeholder="Start of year" value="${rec.start||''}">
            </div>
            <div class="f"><label>Dec 31 reading (mi)</label>
              <input type="number" id="odo-end" min="0" step="1" placeholder="End of year" value="${rec.end||''}">
            </div>
          </div>
        </div>
        <div class="card" style="margin-bottom:16px;background:var(--bg2)">
          <div style="font-size:11px;font-weight:800;text-transform:uppercase;color:var(--text3);margin-bottom:10px">Calculated business use — ${yr}</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px">
            <div style="text-align:center">
              <div style="font-size:18px;font-weight:800">${totalDriven>0?totalDriven.toLocaleString():'—'}</div>
              <div style="font-size:10px;color:var(--text3)">Total miles driven</div>
            </div>
            <div style="text-align:center">
              <div style="font-size:18px;font-weight:800;color:var(--blue)">${loggedMiles>0?Math.round(loggedMiles).toLocaleString():'—'}</div>
              <div style="font-size:10px;color:var(--text3)">Business miles</div>
            </div>
            <div style="text-align:center">
              <div style="font-size:18px;font-weight:800;color:${bizPct>0?'var(--green)':'var(--text3)'}">${bizPct>0?bizPct+'%':'—'}</div>
              <div style="font-size:10px;color:var(--text3)">Business use</div>
            </div>
          </div>
          ${totalDriven===0?'<div style="font-size:11px;color:var(--text3)">Enter odometer readings above to calculate business use %.</div>':''}
          ${totalDriven>0&&loggedMiles===0?'<div style="font-size:11px;color:var(--text3)">No trips logged yet for '+yr+' — log them in the mileage tab.</div>':''}
          ${bizPct>0?`<div style="font-size:11px;color:var(--text3);margin-top:4px">Saving will apply ${bizPct}% business use to this vehicle's deduction calculations.</div>`:''}
        </div>
        <button onclick="saveOdometerReport()" class="btn btn-p" style="width:100%;padding:14px;font-size:16px;font-weight:700">Save readings</button>
      </div>
    </div>
  `;
  ov.style.display = 'flex';
}

function saveOdometerReport() {
  const startEl = document.getElementById('odo-start');
  const endEl = document.getElementById('odo-end');
  const start = parseInt(startEl&&startEl.value)||0;
  const end   = parseInt(endEl&&endEl.value)||0;
  if(end>0 && start>0 && end<start) { zAlert('End odometer must be greater than start odometer.'); return; }
  const vehs = getVehicles();
  const v = vehs[_odoReportVehIdx];
  if(!v) return;
  const yr = String(_odoReportYear);
  const key = _vehKey(v);
  if(!S.vehicleOdoLog) S.vehicleOdoLog = {};
  if(!S.vehicleOdoLog[yr]) S.vehicleOdoLog[yr] = {};
  if(!S.vehicleOdoLog[yr][key]) S.vehicleOdoLog[yr][key] = {};
  if(start>0) S.vehicleOdoLog[yr][key].start = start;
  if(end>0)   S.vehicleOdoLog[yr][key].end   = end;
  // Auto-calculate and save business use %
  const loggedMiles = mileage.filter(t=>t.vehicle===v.name&&(t.date||'').startsWith(yr))
                             .reduce((s,t)=>s+(t.miles||0),0);
  const totalDriven = end>start ? end-start : 0;
  if(totalDriven>0 && loggedMiles>0) {
    v.bizUse = Math.min(100, Math.round((loggedMiles/totalDriven)*100));
    vehs[_odoReportVehIdx] = v;
    S.vehicles = vehs; S.vehiclesTs = Date.now();
  }
  saveAll();
  document.getElementById('odo-report-overlay')?.remove();
  showToast('Mileage report saved'+(totalDriven>0&&loggedMiles>0?' — '+v.bizUse+'% business use':''),'📊');
  if(_fleetDetailIdx>=0) _renderFleetDetailModal();
}

/* ── Add/edit vehicle modal ──────────────────────────────────────────────────── */
let _fleetEditIdx = -1;

function openAddVehicleModal(idx) {
  _fleetEditIdx = typeof idx === 'number' ? idx : -1;
  const vehs = getVehicles();
  const v = _fleetEditIdx >= 0 ? (vehs[_fleetEditIdx]||{}) : {};
  const isEdit = _fleetEditIdx >= 0;

  const ov = document.getElementById('fleet-veh-overlay') || _createFleetVehOverlay();
  const box = document.getElementById('fleet-veh-box');
  if(!box) return;

  box.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 16px 14px;border-bottom:1px solid var(--border)">
      <div style="font-size:20px;font-weight:800;color:var(--text)">${isEdit?'Edit vehicle':'Add vehicle'}</div>
      <button class="btn btn-ghost" onclick="_closeFleetVehModal()">Cancel</button>
    </div>
    <div style="padding:14px 16px 100px;overflow-y:auto;overflow-x:hidden;max-height:80vh">
      <div class="card" style="margin-bottom:12px">
        <div class="f"><label>Year, make, model <span style="color:var(--red)">*</span></label>
          <input id="fv-name" placeholder="e.g. 2019 F-150" value="${escHtml(v.name||'')}">
        </div>
        <div class="f"><label>Nickname <span style="font-size:10px;color:var(--text3)">(optional)</span></label>
          <input id="fv-nick" placeholder="e.g. Work Truck" value="${escHtml(v.nickname||'')}">
        </div>
        <div class="fg fg2">
          <div class="f"><label>Color</label><input id="fv-color" placeholder="White" value="${escHtml(v.color||'')}"></div>
          <div class="f"><label>License plate</label><input id="fv-plate" placeholder="ABC-1234" value="${escHtml(v.plate||'')}"></div>
        </div>
        <div class="f"><label>VIN <span style="font-size:10px;color:var(--text3)">(17 chars)</span></label>
          <input id="fv-vin" placeholder="1FTFW1ET..." maxlength="17" value="${escHtml(v.vin||'')}" style="font-family:monospace;font-size:13px">
        </div>
      </div>
      <div class="card" style="margin-bottom:12px">
        <div style="font-size:12px;font-weight:700;color:var(--text3);margin-bottom:10px;text-transform:uppercase;letter-spacing:.05em">Purchase info</div>
        <div class="fg fg2">
          <div class="f"><label>Purchase date</label><input type="text" id="fv-pdate" inputmode="numeric" placeholder="MM/DD/YYYY" maxlength="10" value="${v.purchaseDate?_ymdToMdY(v.purchaseDate):''}" oninput="_fmtExpDate(this)"></div>
          <div class="f"><label>Purchase price ($)</label><input type="number" id="fv-pprice" min="0" step="100" placeholder="Optional" value="${v.purchasePrice>0?v.purchasePrice:''}"></div>
        </div>
        <div class="f"><label>Odometer at purchase (mi)</label>
          <input type="number" id="fv-podo" min="0" step="1" placeholder="Optional" value="${v.purchaseOdo>0?v.purchaseOdo:''}">
        </div>
        <div style="font-size:11px;color:var(--text3);margin-top:4px">Purchase price is logged as a vehicle expense (actual expense method only).</div>
      </div>
      <div class="card" style="margin-bottom:12px">
        <div style="font-size:12px;font-weight:700;color:var(--text3);margin-bottom:10px;text-transform:uppercase;letter-spacing:.05em">IRS settings</div>
        <div style="background:var(--bg2);border-radius:var(--r);padding:8px 10px;margin-bottom:10px;font-size:11px;color:var(--text3)">💡 Business use % is calculated automatically from your year-end odometer report — no manual entry needed.</div>
        <div class="f"><label>IRS weight class (GVWR)</label>
          <select id="fv-gvwr" onchange="_renderGvwrNote(this.value)">
            <option value="">— Select —</option>
            <option value="light" ${v.gvwr==='light'?'selected':''}>Under 6,000 lbs (car, crossover)</option>
            <option value="heavy_truck" ${v.gvwr==='heavy_truck'?'selected':''}>Over 6k lbs — Truck/Van</option>
            <option value="heavy_suv" ${v.gvwr==='heavy_suv'?'selected':''}>Over 6k lbs — Large SUV</option>
            <option value="commercial" ${v.gvwr==='commercial'?'selected':''}>Over 14,000 lbs (box truck)</option>
          </select>
          <div id="fv-gvwr-note" style="margin-top:4px">${_gvwrNote(v.gvwr||'')}</div>
        </div>
        <div style="margin-top:12px">
          <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);margin-bottom:8px">Tax deduction method <span style="font-size:10px;font-weight:400;text-transform:none;letter-spacing:0">(pick one — IRS doesn't allow both)</span></div>
          <div>
            <div onclick="this.querySelector('input').click()" style="display:grid;grid-template-columns:18px 1fr;align-items:start;column-gap:10px;padding:10px 12px;border:1.5px solid ${(v.deductionMethod||'mileage')==='mileage'?'var(--blue)':'var(--border2)'};border-radius:var(--r);cursor:pointer;background:${(v.deductionMethod||'mileage')==='mileage'?'rgba(45,93,168,.06)':'var(--bg2)'};margin-bottom:6px">
              <input type="radio" name="fv-deduct" value="mileage" style="margin-top:3px;accent-color:var(--blue);pointer-events:none;width:16px;height:16px" ${(v.deductionMethod||'mileage')==='mileage'?'checked':''}>
              <div>
                <div style="font-size:13px;font-weight:700;color:var(--text);text-transform:none;letter-spacing:0;line-height:1.3">Standard mileage rate</div>
                <div style="font-size:11px;color:var(--text3);margin-top:2px;text-transform:none;letter-spacing:0;line-height:1.4">Deduct ${((S.irsRate||0.67)*100).toFixed(0)}¢ per business mile. Simpler — no need to track every expense. Maintenance records are for your info only.</div>
              </div>
            </div>
            <div onclick="this.querySelector('input').click()" style="display:grid;grid-template-columns:18px 1fr;align-items:start;column-gap:10px;padding:10px 12px;border:1.5px solid ${v.deductionMethod==='actual'?'var(--blue)':'var(--border2)'};border-radius:var(--r);cursor:pointer;background:${v.deductionMethod==='actual'?'rgba(45,93,168,.06)':'var(--bg2)'}">
              <input type="radio" name="fv-deduct" value="actual" style="margin-top:3px;accent-color:var(--blue);pointer-events:none;width:16px;height:16px" ${v.deductionMethod==='actual'?'checked':''}>
              <div>
                <div style="font-size:13px;font-weight:700;color:var(--text);text-transform:none;letter-spacing:0;line-height:1.3">Actual expenses</div>
                <div style="font-size:11px;color:var(--text3);margin-top:2px;text-transform:none;letter-spacing:0;line-height:1.4">Deduct real costs — fuel, maintenance, depreciation at your business-use %. Requires keeping all receipts.</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <button class="btn btn-p" onclick="saveFleetVehicle()" style="width:100%;padding:14px;font-size:16px;font-weight:700">${isEdit?'Save changes':'Add vehicle'}</button>
      ${isEdit&&(v.status||'active')!=='sold'?`<button class="btn" onclick="openFleetSaleModal(${_fleetEditIdx})" style="width:100%;margin-top:8px;background:var(--bg2);border-color:var(--border2);font-size:13px">📦 Record sale of this vehicle</button>`:''}
      ${isEdit?`<button class="btn" onclick="_confirmRemoveVehicle(${_fleetEditIdx})" style="width:100%;margin-top:8px;background:none;border:none;color:var(--red);font-size:13px">Remove vehicle</button>`:''}
    </div>
  `;
  ov.style.display = 'flex';
}

function _createFleetVehOverlay() {
  const ov = document.createElement('div');
  ov.id = 'fleet-veh-overlay';
  ov.style.cssText = 'display:none;position:fixed;inset:0;z-index:3001;background:rgba(0,0,0,.5);align-items:flex-end;justify-content:center';
  const box = document.createElement('div');
  box.id = 'fleet-veh-box';
  box.style.cssText = 'background:var(--bg);border-radius:var(--rl) var(--rl) 0 0;width:100%;max-width:520px;overflow:hidden';
  ov.appendChild(box);
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if(e.target===ov) _closeFleetVehModal(); });
  return ov;
}

function _closeFleetVehModal() {
  const ov = document.getElementById('fleet-veh-overlay');
  if(ov) ov.style.display = 'none';
}

function saveFleetVehicle() {
  const name = (document.getElementById('fv-name')?document.getElementById('fv-name').value:'').trim();
  if(!name) { zAlert('Enter a year, make, and model for this vehicle.'); return; }
  const vehs = getVehicles();
  const isEdit = _fleetEditIdx >= 0;
  const oldV = isEdit ? (vehs[_fleetEditIdx]||{}) : {};

  const deductEl = document.querySelector('input[name="fv-deduct"]:checked');
  const newV = {
    ...oldV,
    name,
    nickname: (document.getElementById('fv-nick')?document.getElementById('fv-nick').value:'').trim(),
    color:    (document.getElementById('fv-color')?document.getElementById('fv-color').value:'').trim(),
    plate:    (document.getElementById('fv-plate')?document.getElementById('fv-plate').value:'').trim().toUpperCase(),
    vin:      (document.getElementById('fv-vin')?document.getElementById('fv-vin').value:'').trim().toUpperCase(),
    bizUse:   oldV.bizUse||100, // updated by year-end odometer report, not manual entry
    gvwr:     document.getElementById('fv-gvwr')?document.getElementById('fv-gvwr').value:'',
    deductionMethod: deductEl ? deductEl.value : (oldV.deductionMethod||'mileage'),
    purchaseDate:  _mdYToYmd(document.getElementById('fv-pdate')?document.getElementById('fv-pdate').value:'')||'',
    purchasePrice: parseFloat(document.getElementById('fv-pprice')?document.getElementById('fv-pprice').value:0)||0,
    purchaseOdo:   parseInt(document.getElementById('fv-podo')?document.getElementById('fv-podo').value:0)||0,
    status: oldV.status||'active',
    downtimeLog: oldV.downtimeLog||[],
    addedDate: oldV.addedDate||todayKey(),
  };

  // Auto-create expense if purchase price is new or changed — only for actual expense method
  const newPrice = newV.purchasePrice;
  const oldPrice = oldV.purchasePrice||0;
  if(newPrice > 0 && newPrice !== oldPrice && newV.deductionMethod === 'actual') {
    const expId = Date.now();
    expenses.unshift({
      id: expId,
      date: newV.purchaseDate||todayKey(),
      cat: 'vehicle_purchase',
      catLabel: 'Vehicle purchase',
      vendor: name,
      amount: newPrice,
      notes: 'Vehicle purchase: '+name,
      deductible: true,
      created_at: new Date().toISOString(),
    });
    newV.purchaseExpenseId = expId;
  } else if(newV.deductionMethod === 'mileage') {
    // Clear any previously-linked purchase expense if user switched to mileage method
    newV.purchaseExpenseId = null;
  }

  if(isEdit) vehs[_fleetEditIdx] = newV;
  else vehs.push(newV);
  S.vehicles = vehs; S.vehiclesTs = Date.now();
  saveAll();
  _closeFleetVehModal();
  renderFleetVehicles();
  showToast(isEdit?'Vehicle updated':'Vehicle added','🚗');
  if(!isEdit) setTimeout(()=>{ if(typeof _checkOdometerPrompt==='function') _checkOdometerPrompt(); }, 500);
}

function _gvwrNote(gvwr){
  if(gvwr==='light')return '<div style="font-size:11px;background:#FEF3C7;border:1px solid #D97706;border-radius:var(--r);padding:6px 8px;color:#92400E">⚠️ <strong>Section 280F applies:</strong> first-year depreciation capped ~$12,200. Standard mileage rate often beats actual expenses for these vehicles.</div>';
  if(gvwr==='heavy_truck')return '<div style="font-size:11px;background:#F0FDF4;border:1px solid #16A34A;border-radius:var(--r);padding:6px 8px;color:#166534">✓ <strong>No 280F limits.</strong> Full Section 179 or bonus depreciation (up to $70,000). Keep mileage log proving &gt;50% business use every year.</div>';
  if(gvwr==='heavy_suv')return '<div style="font-size:11px;background:#FEF3C7;border:1px solid #D97706;border-radius:var(--r);padding:6px 8px;color:#92400E">⚠️ <strong>Section 179 SUV cap:</strong> max $31,300 in 2025. A pickup truck with a bed doesn\'t have this cap.</div>';
  if(gvwr==='commercial')return '<div style="font-size:11px;background:#F0FDF4;border:1px solid #16A34A;border-radius:var(--r);padding:6px 8px;color:#166534">✓ <strong>Commercial vehicle:</strong> no Section 280F limits. Full Section 179 deductible. Maintain &gt;50% business use documentation.</div>';
  return '<div style="font-size:10px;color:var(--text3)">Set weight class above — determines how much depreciation you can deduct (IRS §280F).</div>';
}
function _renderGvwrNote(val) {
  const el = document.getElementById('fv-gvwr-note');
  if(el) el.innerHTML = _gvwrNote(val||'');
}

function _confirmRemoveVehicle(idx) {
  const vehs = getVehicles();
  const v = vehs[idx];
  if(!v) return;
  zConfirm('Remove '+(v.nickname||v.name)+'? This will not delete service records.', () => {
    vehs.splice(idx, 1);
    S.vehicles = vehs; S.vehiclesTs = Date.now();
    saveAll();
    _closeFleetVehModal();
    renderFleetVehicles();
  }, {title:'Remove vehicle', yes:'Remove'});
}

/* ── Status modal (down / active) ────────────────────────────────────────────── */
function openFleetStatusModal(idx, toStatus) {
  const vehs = getVehicles();
  const v = vehs[idx];
  if(!v) return;
  if(toStatus==='active') {
    v.status = 'active';
    const open = (v.downtimeLog||[]).find(d=>!d.end);
    if(open) open.end = todayKey();
    S.vehicles = vehs; S.vehiclesTs = Date.now();
    saveAll();
    _closeFleetDetail();
    renderFleetVehicles();
    showToast((v.nickname||v.name)+' back in service','✅');
    return;
  }
  // toStatus === 'down' — ask for reason
  zPrompt('Reason for downtime (optional):', reason => {
    v.status = 'down';
    v.downtimeLog = v.downtimeLog||[];
    v.downtimeLog.push({start: todayKey(), end: null, reason: reason||''});
    S.vehicles = vehs; S.vehiclesTs = Date.now();
    saveAll();
    _closeFleetDetail();
    renderFleetVehicles();
    showToast((v.nickname||v.name)+' marked as down','🔴');
  }, {title:'Mark as down', placeholder:'e.g. Engine work, tires...'});
}

/* ── Sale modal ──────────────────────────────────────────────────────────────── */
function openFleetSaleModal(idx) {
  const vehs = getVehicles();
  const v = vehs[idx];
  if(!v) return;
  _closeFleetVehModal();
  _closeFleetDetail();

  const existing = document.getElementById('fleet-sale-overlay');
  if(existing) existing.remove();

  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;z-index:3002;background:rgba(0,0,0,.5);display:flex;align-items:flex-end;justify-content:center';
  ov.id = 'fleet-sale-overlay';
  ov.innerHTML = `
    <div style="background:var(--bg);border-radius:var(--rl) var(--rl) 0 0;width:100%;max-width:520px;padding:20px 16px 60px">
      <div style="font-size:18px;font-weight:800;margin-bottom:16px">📦 Record vehicle sale</div>
      <div style="font-size:14px;font-weight:600;color:var(--text3);margin-bottom:14px">${escHtml(v.nickname||v.name||'')}</div>
      <div class="fg fg2">
        <div class="f"><label>Sale date</label><input type="date" id="fs-date" value="${todayKey()}"></div>
        <div class="f"><label>Sale price ($)</label><input type="number" id="fs-price" min="0" step="100" placeholder="0"></div>
      </div>
      <div class="f"><label>Odometer at sale (mi)</label><input type="number" id="fs-odo" min="0" step="100" placeholder="0"></div>
      ${v.purchasePrice?`<div style="margin-top:8px;padding:8px 10px;background:var(--bg2);border-radius:var(--r);font-size:12px;color:var(--text3)">Purchase price: $${v.purchasePrice.toLocaleString()} — enter sale price to see gain/loss</div>`:''}
      <div style="display:grid;gap:8px;margin-top:16px">
        <button class="btn btn-p" onclick="saveFleetSale(${idx})" style="padding:14px;font-size:16px;font-weight:700">Record sale</button>
        <button class="btn" onclick="document.getElementById('fleet-sale-overlay').remove()" style="background:var(--bg2)">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if(e.target===ov) ov.remove(); });
}

function saveFleetSale(idx) {
  const vehs = getVehicles();
  const v = vehs[idx];
  if(!v) return;
  const saleDate = document.getElementById('fs-date')?document.getElementById('fs-date').value||todayKey():todayKey();
  const salePrice = parseFloat(document.getElementById('fs-price')?document.getElementById('fs-price').value||0:0)||0;
  const saleOdo = parseInt(document.getElementById('fs-odo')?document.getElementById('fs-odo').value||0:0)||0;

  v.status = 'sold';
  v.saleDate = saleDate;
  v.salePrice = salePrice;
  v.saleOdo = saleOdo;

  // Close any open downtime
  const open = (v.downtimeLog||[]).find(d=>!d.end);
  if(open) open.end = saleDate;

  // Auto-create income record for sale proceeds
  if(salePrice > 0) {
    const incId = Date.now();
    income.unshift({
      id: incId,
      date: saleDate,
      type: 'Vehicle Sale',
      amount: salePrice,
      notes: 'Sale of '+(v.nickname||v.name),
      created_at: new Date().toISOString(),
    });
    v.saleIncomeId = incId;
  }

  S.vehicles = vehs; S.vehiclesTs = Date.now();
  saveAll();
  const saleOv = document.getElementById('fleet-sale-overlay');
  if(saleOv) saleOv.remove();
  renderFleetVehicles();
  showToast('Vehicle sale recorded','📦');
}

/* ── Add maintenance record modal ────────────────────────────────────────────── */
let _maintModalVehIdx = -1;
let _maintEditId = null;
let _maintPhotoB64 = null;

function openAddMaintenanceModal(vehIdx, editId) {
  _maintModalVehIdx = vehIdx;
  _maintEditId = editId || null;
  _maintPhotoB64 = null;
  if(_maintEditId) {
    const rec = maintenance.find(m=>m.id===_maintEditId);
    if(rec && rec.photo) _maintPhotoB64 = rec.photo;
  }
  _renderMaintModal();
}

function _renderMaintModal(savedType) {
  const vehs = getVehicles();
  const v = vehs[_maintModalVehIdx];
  if(!v) return;
  const editRec = _maintEditId ? maintenance.find(m=>m.id===_maintEditId) : null;
  const selType = savedType || (editRec&&editRec.type) || 'oil_change';
  const isActualMethod = v.deductionMethod === 'actual';

  const ov = document.getElementById('fleet-maint-overlay') || _createMaintOverlay();
  const box = document.getElementById('fleet-maint-box');
  if(!box) return;

  const typeOptions = Object.entries(MAINT_TYPES)
    .map(([k,d])=>`<option value="${k}"${k===selType?' selected':''}>${d.icon} ${d.label}</option>`).join('');

  box.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 16px 14px;border-bottom:1px solid var(--border)">
      <div style="min-width:0;flex:1">
        <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);margin-bottom:2px">${escHtml(v.nickname||v.name||'')}</div>
        <div style="font-size:18px;font-weight:800;color:var(--text)">${_maintEditId?'Edit service record':'Log service'}</div>
      </div>
      <button class="btn btn-ghost" onclick="_closeMaintModal()" style="flex-shrink:0">Cancel</button>
    </div>
    <div style="padding:14px 16px 100px;overflow-y:auto;max-height:80vh">
      <div class="card" style="margin-bottom:12px">
        <div class="f">
          <label>Service type</label>
          <select id="maint-type" onchange="refreshMaintTypeFields()" style="font-size:14px;font-weight:700">${typeOptions}</select>
        </div>
        <div class="fg fg2">
          <div class="f"><label>Date</label><input type="text" id="maint-date" inputmode="numeric" placeholder="MM/DD/YYYY" maxlength="10" value="${_ymdToMdY((editRec&&editRec.date)||todayKey())}" oninput="_fmtExpDate(this)"></div>
          <div class="f"><label>Odometer (mi)</label><input type="number" id="maint-odo" min="0" step="1" placeholder="Optional" value="${escHtml((editRec&&editRec.odo)||'')}"></div>
        </div>
        <div class="fg fg2">
          <div class="f"><label>Cost ($)</label><input type="number" id="maint-cost" min="0" step="1" placeholder="0.00" value="${escHtml((editRec&&editRec.cost)||'')}"></div>
          <div class="f"><label>Vendor / shop</label><input id="maint-vendor" placeholder="Jiffy Lube, AutoZone..." value="${escHtml((editRec&&editRec.vendor)||'')}"></div>
        </div>
      </div>
      <div id="maint-type-fields" style="margin-bottom:12px"></div>
      <div class="card" style="margin-bottom:16px">
        <div class="f"><label>Notes</label>
          <textarea id="maint-notes" rows="2" placeholder="Any details..." style="width:100%;padding:8px;font-size:13px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);font-family:inherit;resize:vertical">${escHtml((editRec&&editRec.notes)||'')}</textarea>
        </div>
        ${isActualMethod
          ? `<label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;margin-top:8px">
               <input type="checkbox" id="maint-make-expense" style="width:16px;height:16px;accent-color:var(--blue)" ${editRec&&editRec.expenseId?'':'checked'}>
               Log cost as a deductible expense
             </label>`
          : `<div style="background:var(--bg2);border-radius:var(--r);padding:8px 10px;margin-top:8px">
               <div style="font-size:11px;font-weight:700;color:var(--text3)">📋 Records only — standard mileage method</div>
               <div style="font-size:11px;color:var(--text3);margin-top:2px">Maintenance costs are not deducted separately. The IRS mileage rate already covers them. Switch to actual expenses in vehicle settings to deduct real costs.</div>
             </div>`
        }
        <div style="margin-top:12px">
          <div style="font-size:11px;font-weight:700;color:var(--text3);margin-bottom:6px">Receipt / service record photo</div>
          <div id="maint-photo-preview" style="${_maintPhotoB64?'':'display:none;'}margin-bottom:8px">
            <img id="maint-photo-img" src="${_maintPhotoB64||''}" style="width:100%;max-height:180px;object-fit:cover;border-radius:var(--r);border:1px solid var(--border)">
            <button onclick="_clearMaintPhoto()" style="width:100%;margin-top:4px;padding:6px;border-radius:var(--r);border:1px solid var(--border2);background:none;color:var(--red);font-size:12px;cursor:pointer;font-family:inherit">Remove photo</button>
          </div>
          <label style="display:flex;align-items:center;justify-content:center;gap:8px;padding:10px 12px;border:1.5px dashed var(--border2);border-radius:var(--r);cursor:pointer;font-size:13px;font-weight:600;color:var(--blue)">
            📷 Scan receipt
            <input type="file" accept="image/*" capture="environment" style="display:none" onchange="_handleMaintPhoto(this)">
          </label>
        </div>
      </div>
      <button class="btn btn-p" onclick="saveMaintRecord()" style="width:100%;padding:14px;font-size:16px;font-weight:700">Save service record</button>
      ${_maintEditId?`<button onclick="deleteMaintenanceRecord(${_maintEditId})" style="width:100%;margin-top:8px;padding:11px;background:none;border:none;color:var(--red);font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">Delete this record</button>`:''}
    </div>
  `;

  _renderMaintTypeFields(selType, editRec);
  ov.style.display = 'flex';
}

function _createMaintOverlay() {
  const ov = document.createElement('div');
  ov.id = 'fleet-maint-overlay';
  ov.style.cssText = 'display:none;position:fixed;inset:0;z-index:3002;background:rgba(0,0,0,.5);align-items:flex-end;justify-content:center';
  const box = document.createElement('div');
  box.id = 'fleet-maint-box';
  box.style.cssText = 'background:var(--bg);border-radius:var(--rl) var(--rl) 0 0;width:100%;max-width:520px;overflow:hidden';
  ov.appendChild(box);
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if(e.target===ov) _closeMaintModal(); });
  return ov;
}

function _closeMaintModal() {
  const ov = document.getElementById('fleet-maint-overlay');
  if(ov) ov.style.display = 'none';
  _maintPhotoB64 = null;
}

function _handleMaintPhoto(input) {
  const file = input.files && input.files[0];
  if(!file) return;
  // Compress to ~800px wide JPEG before storing
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const MAX = 800;
      const scale = img.width > MAX ? MAX/img.width : 1;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width*scale);
      canvas.height = Math.round(img.height*scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      _maintPhotoB64 = canvas.toDataURL('image/jpeg', 0.8);
      const preview = document.getElementById('maint-photo-preview');
      const imgEl = document.getElementById('maint-photo-img');
      if(preview) preview.style.display = '';
      if(imgEl) imgEl.src = _maintPhotoB64;
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function _clearMaintPhoto() {
  _maintPhotoB64 = null;
  const preview = document.getElementById('maint-photo-preview');
  if(preview) preview.style.display = 'none';
}

function refreshMaintTypeFields() {
  const typeEl = document.getElementById('maint-type');
  const type = typeEl ? typeEl.value : '';
  if(type) _renderMaintTypeFields(type, null);
}

function _renderMaintTypeFields(type, rec) {
  const el = document.getElementById('maint-type-fields');
  if(!el) return;

  if(type === 'oil_change') {
    const curOdoEl = document.getElementById('maint-odo');
    const curOdo = curOdoEl ? parseInt(curOdoEl.value)||0 : 0;
    const defaultNext = curOdo > 0 ? curOdo + 5000 : '';
    const defaultNextDate = _fleetAddMonths(todayKey(), 6);
    el.innerHTML = `
      <div class="card">
        <div style="font-size:11px;font-weight:800;text-transform:uppercase;color:var(--text3);margin-bottom:10px">🛢️ Oil change details</div>
        <div class="fg fg2">
          <div class="f"><label>Oil type</label>
            <select id="m-oil-type">
              <option value="">— Select —</option>
              ${['0W-20 Full Synthetic','5W-20 Full Synthetic','5W-30 Full Synthetic','5W-30 Semi-Synthetic','5W-30 Conventional','5W-40 Full Synthetic','10W-30 Conventional','10W-40 Conventional','0W-16 Full Synthetic','Diesel 15W-40'].map(o=>`<option${rec&&rec.oilType===o?' selected':''}>${o}</option>`).join('')}
            </select>
          </div>
          <div class="f"><label>Oil brand</label><input id="m-oil-brand" placeholder="Mobil 1, Castrol..." value="${(rec&&rec.oilBrand)||''}"></div>
        </div>
        <div class="f"><label>Filter part #</label>
          <input id="m-oil-filter" placeholder="Part number" value="${(rec&&rec.oilFilterPart)||''}">
        </div>
        <div class="fg fg2">
          <div class="f"><label>Next change (mi) <span style="font-size:10px;font-weight:400;color:var(--text3)">optional</span></label><input type="number" id="m-next-mi" placeholder="e.g. 92000" value="${(rec&&rec.nextOilMiles)||''}"></div>
          <div class="f"><label>Next change (date) <span style="font-size:10px;font-weight:400;color:var(--text3)">optional</span></label><input type="text" id="m-next-date" inputmode="numeric" placeholder="MM/DD/YYYY" maxlength="10" value="${(rec&&rec.nextOilDate)?_ymdToMdY(rec.nextOilDate):''}" oninput="_fmtExpDate(this)"></div>
        </div>
      </div>`;
  } else if(type === 'brakes') {
    el.innerHTML = `<div class="card">
      <div style="font-size:11px;font-weight:800;text-transform:uppercase;color:var(--text3);margin-bottom:10px">🔴 Brake details</div>
      <div class="fg fg2">
        <div class="f"><label>Axle</label>
          <select id="m-brake-axle">
            <option value="">— Select —</option>
            <option value="front" ${rec&&rec.brakeAxle==='front'?'selected':''}>Front</option>
            <option value="rear" ${rec&&rec.brakeAxle==='rear'?'selected':''}>Rear</option>
            <option value="both" ${rec&&rec.brakeAxle==='both'?'selected':''}>Both axles</option>
          </select>
        </div>
        <div class="f"><label>Pad brand</label><input id="m-brake-brand" placeholder="Brembo, Akebono..." value="${(rec&&rec.brakePadBrand)||''}"></div>
      </div>
      <div class="f"><label>Pad part #</label><input id="m-brake-part" placeholder="Part number" value="${(rec&&rec.brakePadPart)||''}"></div>
    </div>`;
  } else if(type === 'tires') {
    el.innerHTML = `<div class="card">
      <div style="font-size:11px;font-weight:800;text-transform:uppercase;color:var(--text3);margin-bottom:10px">⭕ Tire details</div>
      <div class="fg fg2">
        <div class="f"><label>Tire brand</label><input id="m-tire-brand" placeholder="Michelin, BFG..." value="${(rec&&rec.tireBrand)||''}"></div>
        <div class="f"><label>Tire size</label><input id="m-tire-size" placeholder="265/70R17" value="${(rec&&rec.tireSize)||''}"></div>
      </div>
      <div class="f"><label># of tires replaced</label>
        <select id="m-tire-count">
          ${[1,2,3,4,5,6].map(n=>`<option value="${n}"${rec&&rec.tireCount===n?' selected':''}>${n} tire${n===1?'':'s'}</option>`).join('')}
        </select>
      </div>
    </div>`;
  } else if(type === 'battery') {
    el.innerHTML = `<div class="card">
      <div style="font-size:11px;font-weight:800;text-transform:uppercase;color:var(--text3);margin-bottom:10px">🔋 Battery details</div>
      <div class="fg fg2">
        <div class="f"><label>Brand</label><input id="m-bat-brand" placeholder="Optima, Interstate..." value="${(rec&&rec.batteryBrand)||''}"></div>
        <div class="f"><label>Part #</label><input id="m-bat-part" placeholder="Part number" value="${(rec&&rec.batteryPart)||''}"></div>
      </div>
      <div class="f"><label>Cold cranking amps (CCA)</label><input id="m-bat-cca" placeholder="720 CCA" value="${(rec&&rec.batteryCCA)||''}"></div>
    </div>`;
  } else if(type === 'fuel_filter' || type === 'air_filter' || type === 'belt') {
    const def = MAINT_TYPES[type];
    el.innerHTML = `<div class="card">
      <div style="font-size:11px;font-weight:800;text-transform:uppercase;color:var(--text3);margin-bottom:10px">${def.icon} ${def.label} details</div>
      <div class="fg fg2">
        <div class="f"><label>Brand</label><input id="m-part-brand" placeholder="Brand name" value="${(rec&&rec.partBrand)||''}"></div>
        <div class="f"><label>Part #</label><input id="m-part-num" placeholder="Part number" value="${(rec&&rec.partNum)||''}"></div>
      </div>
    </div>`;
  } else {
    el.innerHTML = '';
  }
}

function saveMaintRecord() {
  const vehs = getVehicles();
  const v = vehs[_maintModalVehIdx];
  if(!v) return;
  const typeEl = document.getElementById('maint-type');
  const type = typeEl ? typeEl.value : 'other';
  const dateEl = document.getElementById('maint-date');
  const date = _mdYToYmd(dateEl?dateEl.value:'') || todayKey();
  const odoEl = document.getElementById('maint-odo');
  const odo = odoEl ? parseInt(odoEl.value)||0 : 0;
  const costEl = document.getElementById('maint-cost');
  const cost = costEl ? parseFloat(costEl.value)||0 : 0;
  const vendorEl = document.getElementById('maint-vendor');
  const vendor = vendorEl ? (vendorEl.value||'').trim() : '';
  const notesEl = document.getElementById('maint-notes');
  const notes = notesEl ? (notesEl.value||'').trim() : '';

  const rec = {
    id: _maintEditId || Date.now(),
    vehicleName: v.name,
    date,
    odo,
    type,
    typeLabel: MAINT_TYPES[type] ? MAINT_TYPES[type].label : type,
    cost,
    vendor,
    notes,
    photo: _maintPhotoB64 || ((_maintEditId && maintenance.find(m=>m.id===_maintEditId))||{}).photo || null,
    created_at: new Date().toISOString(),
  };

  // Collect type-specific fields
  if(type==='oil_change') {
    const oilTypeEl = document.getElementById('m-oil-type');
    const oilBrandEl = document.getElementById('m-oil-brand');
    const oilFilterEl = document.getElementById('m-oil-filter');
    const nextMiEl = document.getElementById('m-next-mi');
    const nextDateEl = document.getElementById('m-next-date');
    rec.oilType = oilTypeEl ? oilTypeEl.value||'' : '';
    rec.oilBrand = oilBrandEl ? (oilBrandEl.value||'').trim() : '';
    rec.oilFilterPart = oilFilterEl ? (oilFilterEl.value||'').trim() : '';
    rec.nextOilMiles = nextMiEl ? parseInt(nextMiEl.value)||0 : 0;
    rec.nextOilDate = nextDateEl ? (_mdYToYmd(nextDateEl.value)||'') : '';
  } else if(type==='brakes') {
    const axleEl = document.getElementById('m-brake-axle');
    const brandEl = document.getElementById('m-brake-brand');
    const partEl = document.getElementById('m-brake-part');
    rec.brakeAxle = axleEl ? axleEl.value||'' : '';
    rec.brakePadBrand = brandEl ? (brandEl.value||'').trim() : '';
    rec.brakePadPart = partEl ? (partEl.value||'').trim() : '';
  } else if(type==='tires') {
    const tbEl = document.getElementById('m-tire-brand');
    const tsEl = document.getElementById('m-tire-size');
    const tcEl = document.getElementById('m-tire-count');
    rec.tireBrand = tbEl ? (tbEl.value||'').trim() : '';
    rec.tireSize = tsEl ? (tsEl.value||'').trim() : '';
    rec.tireCount = tcEl ? parseInt(tcEl.value)||4 : 4;
  } else if(type==='battery') {
    const bbEl = document.getElementById('m-bat-brand');
    const bpEl = document.getElementById('m-bat-part');
    const bcEl = document.getElementById('m-bat-cca');
    rec.batteryBrand = bbEl ? (bbEl.value||'').trim() : '';
    rec.batteryPart = bpEl ? (bpEl.value||'').trim() : '';
    rec.batteryCCA = bcEl ? (bcEl.value||'').trim() : '';
  } else if(type==='fuel_filter'||type==='air_filter'||type==='belt') {
    const pbEl = document.getElementById('m-part-brand');
    const pnEl = document.getElementById('m-part-num');
    rec.partBrand = pbEl ? (pbEl.value||'').trim() : '';
    rec.partNum = pnEl ? (pnEl.value||'').trim() : '';
  }

  // Auto-create expense — only for actual expense method
  const isActualMethod = v.deductionMethod === 'actual';
  const makeExpEl = document.getElementById('maint-make-expense');
  const makeExpense = isActualMethod && makeExpEl ? makeExpEl.checked : false;
  if(makeExpense && cost > 0) {
    const expId = Date.now() + 1;
    expenses.unshift({
      id: expId,
      date,
      cat: 'vehicle',
      catLabel: 'Vehicle — maintenance',
      vendor: vendor||(v.nickname||v.name),
      amount: cost,
      notes: (MAINT_TYPES[type]?MAINT_TYPES[type].label:type)+(notes?' — '+notes:''),
      deductible: true,
      created_at: new Date().toISOString(),
    });
    rec.expenseId = expId;
  }

  if(_maintEditId) {
    const idx = maintenance.findIndex(m=>m.id===_maintEditId);
    if(idx>=0) maintenance[idx] = rec;
  } else {
    maintenance.unshift(rec);
  }

  saveAll();
  _closeMaintModal();
  renderFleetVehicles();

  // Refresh detail modal if open
  if(_fleetDetailIdx === _maintModalVehIdx) {
    _renderFleetDetailModal();
  }

  showToast('Service logged','🔧');
}

function deleteMaintenanceRecord(id) {
  zConfirm('Delete this service record?', () => {
    const idx = maintenance.findIndex(m=>m.id===id);
    if(idx>=0) maintenance.splice(idx,1);
    saveAll();
    _closeMaintModal();
    _renderFleetDetailModal();
    renderFleetVehicles();
  }, {title:'Delete record', yes:'Delete', danger:true});
}

function _showMaintPhoto(id) {
  const rec = maintenance.find(m=>String(m.id)===String(id));
  if(!rec || !rec.photo) return;
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.9);display:flex;align-items:center;justify-content:center;cursor:pointer';
  ov.innerHTML = `<img src="${rec.photo}" style="max-width:95vw;max-height:90vh;border-radius:var(--r);object-fit:contain">`;
  ov.addEventListener('click', ()=>ov.remove());
  document.body.appendChild(ov);
}

/* ── Utility helpers ─────────────────────────────────────────────────────────── */
function _fleetFmtDate(d) {
  if(!d) return '';
  try {
    return new Date(d+'T12:00:00').toLocaleDateString([],{month:'short',day:'numeric',year:'numeric'});
  } catch(e) { return d; }
}
