// ── TrueMeasure: trace a map, get a priced line ──────────────────────────────
// One of the TrueSuite's tools (see _TRUESUITE_TOOLS below), the aerial half
// of TrueBid, the flagship proposal type. Every trade needs a number off a
// property at some point: a landscaper's
// lawn square footage, a roofer's roof squares, an electrician's service-run
// distance, a plumber's leach-field trenching. One tool, mode picks the shape
// (Area traces a boundary, Distance traces a run, Repeat multiplies one run
// N times for parallel trenches), same as the app's own reuse rule (§7.3):
// a new measurement need gets the existing tool pointed at new geometry, not
// a fourth hand-rolled one.
//
// Hands off into the EXISTING generic-estimate pipeline exactly the way
// js/scan-estimate.js already does (lines, tax, deposit, signing, hub):
// this file owns the MEASURING half, never a parallel proposal machine.
//
// Every number requires a tap to confirm before it prices anything (owner
// research 2026-08-18: nobody in this category, not even EagleView, prices
// off an automated measurement untouched — the whole market converged on a
// verify-then-commit step, so this does too).

// ── Rates: same shape as _scanRates() (js/scan-estimate.js), one field per
// measured thing. Unset = 0 = the quantity loads and the price is theirs to
// type, exactly like a scanned room with no rate set.
function _tmRates(){
  if(!S.trueMeasureRates)S.trueMeasureRates={areaSqFt:0,roofSquare:0,distanceLf:0};
  return S.trueMeasureRates;
}

// Which mode a trade opens into. Nothing here is locked, a landscaper can
// still switch to Distance for a fence run; this only picks the default.
function _tmDefaultMode(){
  const t=(typeof getActiveTrade==='function'&&getActiveTrade())||'';
  if(t==='electrical'||t==='plumbing')return 'distance';
  return 'area';
}

// Local-planar projection: for a property-sized polygon (never more than a
// few hundred feet across) treating degrees-of-longitude as scaled by
// cos(latitude) and degrees-of-latitude as constant is accurate to a
// fraction of a percent, the same approximation every mapping library uses
// at this scale. `_geoDistFt` (js/geo-track.js) already does the real
// haversine for point-to-point distance; this reuses that for every segment
// so the two measurements can never disagree with each other.
function _tmPathFt(points){
  if(!Array.isArray(points)||points.length<2)return 0;
  let ft=0;
  for(let i=1;i<points.length;i++)ft+=_geoDistFt(points[i-1],points[i]);
  return ft;
}
// Shoelace formula over a local feet-projection of the traced points. A
// polygon under 3 points has no area yet (still being drawn).
function _tmAreaFt2(points){
  if(!Array.isArray(points)||points.length<3)return 0;
  const lat0=points[0].lat*Math.PI/180;
  const ftPerDegLat=364000; // ~feet per degree latitude, constant at this scale
  const ftPerDegLng=364000*Math.cos(lat0);
  const xy=points.map(p=>({x:(p.lng-points[0].lng)*ftPerDegLng,y:(p.lat-points[0].lat)*ftPerDegLat}));
  let sum=0;
  for(let i=0;i<xy.length;i++){
    const a=xy[i],b=xy[(i+1)%xy.length];
    sum+=a.x*b.y-b.x*a.y;
  }
  return Math.abs(sum)/2;
}
// Roofers price by the square (100 sq ft), everyone else by raw sq ft.
function _tmAreaUnit(){
  return ((typeof getActiveTrade==='function'&&getActiveTrade())==='roofing')?'sq':'ft²';
}
function _tmAreaValue(ft2){
  return _tmAreaUnit()==='sq'?Math.round((ft2/100)*10)/10:Math.round(ft2);
}

let _tmState=null; // {c, mode, points:[{lat,lng}], repeatCount}

function _tmModeLabel(m){
  return m==='area'?'Area':'Distance';
}

// ── The TrueSuite registry ────────────────────────────────────────────────
// TrueBid is the flagship proposal type (owner 2026-08-18): every tool that
// measures the job for the contractor lives under one door, not a card per
// tool. Each entry is a capture tool; adding the next one (Panel Balancer &
// Scheduler, electricians) is a new entry here, never a picker rewrite.
//   trades:   null = every trade, or an array of trade ids the tool applies to
//   capable:  does THIS device meet the tool's requirement right now
//   launch:   opens the tool for client c
const _TRUESUITE_TOOLS=[
  {
    id:'scan',name:'TrueScan',tagline:'Indoors',icon:'📐',
    sub:'LiDAR measures every wall, minimal typing',
    bullets:['Every quantity measured, not guessed','High ceilings auto-flagged from the scan','The proposal shows their floor plan'],
    trades:null,
    capable:()=>(typeof _scanCapable==='function')&&_scanCapable(),
    launch:c=>{if(typeof openScanEstimate==='function')openScanEstimate(c);}
  },
  {
    id:'aerial',name:'TrueMeasure',tagline:'Outdoors',icon:'🛰️',
    sub:'No hardware required, any phone',
    bullets:['Works for any trade, area or a run','You confirm every number before it prices'],
    trades:null,
    capable:()=>true,
    launch:c=>{if(typeof openTrueMeasure==='function')openTrueMeasure(c);}
  },
  // Panel Balancer & Scheduler (electrical) slots in here next:
  // {id:'panel',name:'Panel Balancer',tagline:'Electrical',...,trades:['electrical'],capable:()=>true,launch:...}
];
// Applicable to the CURRENT trade, regardless of device capability, tools
// this trade will never see (a future landscaping-only tool on an
// electrician's picker) aren't a "belt and braces" case, they're just not
// shown at all.
function _trueSuiteToolsForTrade(){
  const trade=(typeof getActiveTrade==='function'&&getActiveTrade())||null;
  return _TRUESUITE_TOOLS.filter(t=>!t.trades||!trade||t.trades.includes(trade));
}

let _tmMethodState=null;
// Only a REAL choice is worth a screen (fewer taps, §Flow Test Standard):
// when exactly one applicable tool is also capable on this device, open it
// directly. _pickEstStyle is the one caller, so this is the single gate the
// whole TrueBid entry point goes through.
function _tmOpenTrueSuite(c){
  if(!c)return;
  const applicable=_trueSuiteToolsForTrade();
  const ready=applicable.filter(t=>t.capable());
  if(ready.length<=1){
    (ready[0]||applicable[0])?.launch(c);
    return;
  }
  _tmMethodPicker(c,applicable);
}
function _tmMethodPicker(c,applicable){
  if(!c)return;
  const tools=applicable||_trueSuiteToolsForTrade();
  _tmMethodState={c};
  const ov=document.createElement('div');
  ov.id='_tm-method-ov';
  ov.style.cssText='position:fixed;inset:0;z-index:9100;background:var(--bg2);overflow-y:auto;opacity:0;transform:translateY(22px);transition:opacity .38s ease,transform .42s cubic-bezier(.22,.8,.2,1)';
  const card=t=>{
    const locked=!t.capable();
    const bul=t.bullets.map(b=>'<li><span>'+(typeof svgIcon==='function'?svgIcon('✓'):'✓')+'</span>'+b+'</li>').join('');
    const act=(locked&&t.id==='scan')?'_scanWhyNoLidar()':`_tmPickMethod('${t.id}')`;
    return `<button class="chooser-card chooser-blue" onclick="${act}"${locked?' style="opacity:.55;filter:grayscale(1)"':''}>
      <div class="chooser-card-eyebrow"${locked?' style="color:var(--text3)"':''}>${locked?'Needs a Pro iPhone':t.tagline}</div>
      <div class="chooser-card-icon">${typeof svgIcon==='function'?svgIcon(t.icon,{size:36}):t.icon}</div>
      <div class="chooser-card-title">${t.name}</div>
      <div class="chooser-card-sub">${locked?'This phone has no LiDAR sensor to measure with':t.sub}</div>
      <ul class="chooser-card-bullets">${bul}</ul>
      <div class="chooser-card-cta">${locked?'Which iPhones? →':'Start →'}</div>
    </button>`;
  };
  ov.innerHTML=
    '<div style="max-width:760px;margin:0 auto;padding:calc(24px + env(safe-area-inset-top,0px)) 20px calc(40px + env(safe-area-inset-bottom,0px))">'+
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">'+
        '<div>'+
          '<div class="tbar-eyebrow">TrueBid</div>'+
          '<div class="tbar-title">How do you want to measure?</div>'+
        '</div>'+
        '<button class="btn btn-ghost" onclick="_closeTmMethodPicker()">Cancel</button>'+
      '</div>'+
      '<div class="chooser-grid">'+tools.map(card).join('')+'</div>'+
    '</div>';
  document.body.appendChild(ov);
  requestAnimationFrame(()=>requestAnimationFrame(()=>{ov.style.opacity='1';ov.style.transform='translateY(0)';}));
}
function _closeTmMethodPicker(){
  document.getElementById('_tm-method-ov')?.remove();
  _tmMethodState=null;
}
function _tmPickMethod(id){
  const {c}=_tmMethodState||{};
  if(!c)return;
  _closeTmMethodPicker();
  const tool=_TRUESUITE_TOOLS.find(t=>t.id===id);
  if(!tool)return;
  // Belt and braces: the picker only offers a tool that already read as
  // capable, checked again here so the one entry point refuses rather than
  // opening a builder with nothing to build from, even if called directly.
  if(!tool.capable()){
    if(tool.id==='scan'&&typeof _scanWhyNoLidar==='function')_scanWhyNoLidar();
    return;
  }
  tool.launch(c);
}

async function openTrueMeasure(c){
  if(!c)return;
  document.getElementById('_style-pick-ov')?.remove();
  _tmState={c,mode:_tmDefaultMode(),points:[],repeatCount:1,map:null};

  const ov=document.createElement('div');
  ov.id='_tm-ov';
  ov.style.cssText='position:fixed;inset:0;z-index:9200;background:var(--bg);display:flex;flex-direction:column';
  ov.innerHTML=`
    <div style="padding:calc(12px + env(safe-area-inset-top,0px)) 14px 10px;display:flex;align-items:center;gap:10px;background:var(--bg);border-bottom:1px solid var(--border);flex-shrink:0">
      <button class="btn btn-ghost" style="padding:8px" onclick="_tmClose()">${typeof svgIcon==='function'?svgIcon('‹',{size:18}):'‹'}</button>
      <div style="flex:1;font-family:var(--font-display);font-size:17px;font-weight:800;letter-spacing:-.3px">TrueMeasure</div>
      <div class="mode-toggle" id="tm-mode-toggle" style="display:flex;background:var(--bg2);border-radius:999px;padding:3px;gap:2px">
        <button class="mode-btn" data-m="area" onclick="_tmSetMode('area')" style="padding:6px 12px;border-radius:999px;font-size:11.5px;font-weight:700;border:none;cursor:pointer;font-family:inherit">Area</button>
        <button class="mode-btn" data-m="distance" onclick="_tmSetMode('distance')" style="padding:6px 12px;border-radius:999px;font-size:11.5px;font-weight:700;border:none;cursor:pointer;font-family:inherit">Distance</button>
      </div>
    </div>
    <div id="tm-canvas-wrap" style="flex:1;position:relative;overflow:hidden;background:var(--bg2)">
      <div id="tm-map" style="position:absolute;inset:0"></div>
      <div id="tm-unavailable" style="display:none;position:absolute;inset:0;align-items:center;justify-content:center;flex-direction:column;gap:10px;padding:30px;text-align:center;color:var(--text3)">
        <div style="font-size:32px">🛰️</div>
        <div style="font-size:14px;font-weight:700;color:var(--text2)">Aerial map isn't available here</div>
        <div style="font-size:12.5px;line-height:1.4">The live map only loads on the deployed app (MapKit is domain-locked). This screen works fully once it's running for real.</div>
      </div>
      <div id="tm-repeat-chip" style="display:none;position:absolute;top:12px;right:12px;background:var(--blue);color:#fff;font-size:11px;font-weight:800;padding:7px 6px 7px 12px;border-radius:999px;box-shadow:0 2px 8px rgba(0,0,0,.15);align-items:center;gap:6px">
        <span id="tm-repeat-label">Repeat run ×1</span>
        <button onclick="_tmRepeatStep(-1)" style="background:rgba(255,255,255,.25);color:#fff;border:none;width:20px;height:20px;border-radius:999px;font-weight:900;cursor:pointer;font-family:inherit">−</button>
        <button onclick="_tmRepeatStep(1)" style="background:rgba(255,255,255,.25);color:#fff;border:none;width:20px;height:20px;border-radius:999px;font-weight:900;cursor:pointer;font-family:inherit">+</button>
      </div>
      <button id="tm-undo" onclick="_tmUndo()" style="display:none;position:absolute;bottom:14px;left:12px;background:rgba(255,255,255,.92);color:var(--text2);font-size:11px;font-weight:700;padding:7px 12px;border-radius:999px;box-shadow:0 2px 8px rgba(0,0,0,.15);border:none;cursor:pointer;font-family:inherit">↺ Undo last point</button>
    </div>
    <div style="background:var(--bg);border-top:1px solid var(--border);padding:16px 18px calc(20px + env(safe-area-inset-bottom,0px));flex-shrink:0" id="tm-sheet">
      <div id="tm-readout" style="font-family:var(--font-display);font-size:32px;font-weight:900;letter-spacing:-1px;color:var(--text)">Tap the map to start</div>
      <div id="tm-readout-sub" style="font-size:12.5px;color:var(--text3);font-weight:600;margin:2px 0 14px"></div>
      <button class="btn btn-p" id="tm-cta" style="width:100%;padding:14px;font-size:14.5px" disabled onclick="_tmConfirmScreen()">Add to estimate</button>
    </div>`;
  document.body.appendChild(ov);
  _tmUpdateModeUI();
  await _tmInitMap();
}

function _tmClose(){
  document.getElementById('_tm-ov')?.remove();
  _tmState=null;
}

function _tmSetMode(m){
  if(!_tmState||_tmState.mode===m)return;
  _tmState.mode=m;
  _tmState.points=[];
  _tmState.repeatCount=1;
  _tmUpdateModeUI();
  _tmRedraw();
}

function _tmUpdateModeUI(){
  if(!_tmState)return;
  document.querySelectorAll('#tm-mode-toggle .mode-btn').forEach(b=>{
    const on=b.getAttribute('data-m')===_tmState.mode;
    b.style.background=on?'var(--ink)':'transparent';
    b.style.color=on?'#fff':'var(--text3)';
  });
  const chip=document.getElementById('tm-repeat-chip');
  if(chip)chip.style.display=(_tmState.mode==='distance')?'flex':'none';
}

function _tmRepeatStep(d){
  if(!_tmState)return;
  _tmState.repeatCount=Math.max(1,Math.min(20,(_tmState.repeatCount||1)+d));
  const lbl=document.getElementById('tm-repeat-label');
  if(lbl)lbl.textContent='Repeat run ×'+_tmState.repeatCount;
  _tmRedraw();
}

async function _tmInitMap(){
  const wrap=document.getElementById('tm-map');
  const fallback=document.getElementById('tm-unavailable');
  if(typeof mapkit==='undefined'||!_mapkitReady||!wrap){
    if(fallback)fallback.style.display='flex';
    return;
  }
  try{
    const center=await _tmClientCoord(_tmState.c);
    const coord=new mapkit.Coordinate(center?center.lat:39.8283,center?center.lng:-98.5795);
    const map=new mapkit.Map(wrap,{
      center:coord,
      mapType:mapkit.Map.MapTypes.Satellite,
      showsCompass:mapkit.FeatureVisibility.Hidden,
      showsScale:mapkit.FeatureVisibility.Hidden,
      showsZoomControl:false,
      showsUserLocationControl:false,
    });
    map.region=new mapkit.CoordinateRegion(coord,new mapkit.CoordinateSpan(0.0015,0.0015));
    map.addEventListener('single-tap',e=>{
      const c=map.convertPointOnPageToCoordinate(e.pointOnPage);
      _tmAddPoint(c.latitude,c.longitude);
    });
    _tmState.map=map;
  }catch(_e){
    if(fallback)fallback.style.display='flex';
  }
}

// Cached client coords first (the same nearby-geocode cache clients.js/
// jobs.js already keep), only geocode fresh if this client was never
// resolved before, matching the existing rate-limited geocode budget.
async function _tmClientCoord(c){
  if(!c||!c.addr)return null;
  try{
    const cache=(typeof _nearbyGeoCache==='function')?_nearbyGeoCache():{};
    const hit=cache[c.id];
    if(hit&&hit.addr===c.addr)return {lat:hit.lat,lng:hit.lon};
  }catch(_e){}
  if(typeof _geocodeAddr==='function'){
    const g=await _geocodeAddr(c.addr);
    if(g)return {lat:g.lat,lng:g.lon};
  }
  return null;
}

function _tmAddPoint(lat,lng){
  if(!_tmState)return;
  _tmState.points.push({lat,lng});
  _tmRedraw();
}

function _tmUndo(){
  if(!_tmState||!_tmState.points.length)return;
  _tmState.points.pop();
  _tmRedraw();
}

function _tmRedraw(){
  if(!_tmState)return;
  const {map,points,mode}=_tmState;
  if(map){
    (map.overlays||[]).slice().forEach(o=>map.removeOverlay(o));
    if(points.length>=2){
      const coords=points.map(p=>new mapkit.Coordinate(p.lat,p.lng));
      const style=new mapkit.Style({strokeColor:'#2D5DA8',lineWidth:3,fillColor:mode==='area'?'#2D5DA8':undefined,fillOpacity:mode==='area'?0.28:0});
      const overlay=(mode==='area'&&points.length>=3)
        ?new mapkit.PolygonOverlay(coords,{style})
        :new mapkit.PolylineOverlay(coords,{style});
      map.addOverlay(overlay);
    }
  }
  document.getElementById('tm-undo').style.display=points.length?'block':'none';
  _tmUpdateReadout();
}

function _tmMeasure(){
  if(!_tmState)return {value:0,unit:'',label:''};
  const {mode,points,repeatCount}=_tmState;
  if(mode==='area'){
    const ft2=_tmAreaFt2(points);
    return {value:_tmAreaValue(ft2),unit:_tmAreaUnit(),rawFt2:ft2,label:'Traced area'};
  }
  // Round the leg FIRST, then multiply: rounding oneLeg and (oneLeg*count)
  // independently can disagree by a foot (364.5 rounds to 365, but
  // 364.5*4=1458 rounds to 1458, not 1460), and a label reading "4 runs ×
  // 365 ft" has to actually multiply out to the total shown next to it.
  const oneLeg=Math.round(_tmPathFt(points));
  const total=oneLeg*(repeatCount||1);
  return {value:total,unit:'ft',oneLeg,repeatCount:repeatCount||1,label:(repeatCount>1)?(repeatCount+' runs × '+oneLeg+' ft'):'Traced run'};
}

function _tmUpdateReadout(){
  const m=_tmMeasure();
  const readout=document.getElementById('tm-readout');
  const sub=document.getElementById('tm-readout-sub');
  const cta=document.getElementById('tm-cta');
  if(!readout)return;
  const ready=(_tmState.mode==='area'&&_tmState.points.length>=3)||(_tmState.mode==='distance'&&_tmState.points.length>=2);
  if(!ready){
    readout.textContent='Tap the map to start';
    if(sub)sub.textContent='';
    if(cta)cta.disabled=true;
    return;
  }
  readout.textContent=m.value.toLocaleString()+' '+m.unit;
  if(sub)sub.textContent=m.label+' · '+_tmState.points.length+' points traced';
  if(cta)cta.disabled=false;
}

// ── Confirm/adjust: every measurement stops here before it prices anything
// (owner research 2026-08-18: no product in this category auto-commits a
// measured number, they all require a look-it-over step first).
function _tmConfirmScreen(){
  // Never stack a second confirm modal on top of a stale one left over from
  // an earlier call, duplicate ids would make getElementById('tm-c-desc')
  // ambiguous about which input is actually live.
  document.getElementById('_tm-confirm-ov')?.remove();
  const m=_tmMeasure();
  const rates=_tmRates();
  const trade=(typeof getActiveTrade==='function'&&getActiveTrade())||'';
  const defaultRate=_tmState.mode==='area'
    ?(trade==='roofing'?(rates.roofSquare||0):(rates.areaSqFt||0))
    :(rates.distanceLf||0);
  const defaultDesc=_tmState.mode==='area'
    ?(trade==='roofing'?'Roof, measured':'Measured area')
    :(m.repeatCount>1?'Trenching, '+m.repeatCount+' runs':'Measured run');

  const ov=document.createElement('div');
  ov.className='zmodal-overlay';ov.id='_tm-confirm-ov';
  ov.innerHTML=`<div class="zmodal" style="max-width:420px">
    <div style="font-family:var(--font-display);font-size:19px;font-weight:800;margin-bottom:4px">Confirm the measurement</div>
    <div style="font-size:12.5px;color:var(--text3);margin-bottom:16px">Adjust anything before it becomes a line item.</div>
    <label style="font-size:11.5px;font-weight:700;color:var(--text3)">Description</label>
    <input id="tm-c-desc" value="${(defaultDesc||'').replace(/"/g,'&quot;')}" style="margin-bottom:12px">
    <label style="font-size:11.5px;font-weight:700;color:var(--text3)">Quantity (${m.unit})</label>
    <input id="tm-c-qty" type="number" step="0.1" value="${m.value}" style="margin-bottom:12px">
    <label style="font-size:11.5px;font-weight:700;color:var(--text3)">Rate ($ per ${m.unit})</label>
    <input id="tm-c-rate" type="number" step="0.01" value="${defaultRate}" style="margin-bottom:16px">
    <div style="display:flex;gap:10px">
      <button class="btn btn-ghost" style="flex:1" onclick="document.getElementById('_tm-confirm-ov').remove()">Back</button>
      <button class="btn btn-p" style="flex:1" onclick="_tmAddToEstimate()">Add to estimate</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
}

function _tmAddToEstimate(){
  const c=_tmState.c;
  const desc=(document.getElementById('tm-c-desc')||{}).value||'Measured line';
  const qty=Math.max(0,+(document.getElementById('tm-c-qty')||{}).value||0);
  const rate=Math.max(0,+(document.getElementById('tm-c-rate')||{}).value||0);
  const m=_tmMeasure();
  window._trueMeasureSeed={
    clientId:c.id,
    lines:[{desc,qty,unit:m.unit,rate,total:Math.round(qty*rate*100)/100,notes:'Measured with TrueMeasure',_byoSection:'Exterior'}]
  };
  document.getElementById('_tm-confirm-ov')?.remove();
  _tmClose();
  if(typeof openFreeFormEstimate==='function')openFreeFormEstimate(c);
}
