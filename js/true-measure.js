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
// Area-weighted polygon centroid (not a plain average of vertices, which
// drifts off-center on an L-shaped or otherwise irregular trace) over the
// same local feet-projection _tmAreaFt2 already uses, projected back to
// lat/lng so the total-sqft label lands genuinely in the middle of the shape.
function _tmCentroidCoord(points){
  if(!Array.isArray(points)||points.length<3)return null;
  const lat0=points[0].lat*Math.PI/180;
  const ftPerDegLat=364000,ftPerDegLng=364000*Math.cos(lat0);
  const xy=points.map(p=>({x:(p.lng-points[0].lng)*ftPerDegLng,y:(p.lat-points[0].lat)*ftPerDegLat}));
  let a6=0,cx=0,cy=0;
  for(let i=0;i<xy.length;i++){
    const p0=xy[i],p1=xy[(i+1)%xy.length];
    const cross=p0.x*p1.y-p1.x*p0.y;
    a6+=cross;
    cx+=(p0.x+p1.x)*cross;
    cy+=(p0.y+p1.y)*cross;
  }
  if(Math.abs(a6)<1e-9){
    // Degenerate (near-zero-area/collinear) trace: fall back to a plain
    // vertex average rather than divide by ~0.
    const n=xy.length;
    cx=xy.reduce((s,p)=>s+p.x,0)/n;
    cy=xy.reduce((s,p)=>s+p.y,0)/n;
  }else{
    const a=a6/2;
    cx=cx/(6*a);
    cy=cy/(6*a);
  }
  return {lat:points[0].lat+cy/ftPerDegLat,lng:points[0].lng+cx/ftPerDegLng};
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
  _tmState={c,mode:_tmDefaultMode(),points:[],repeatCount:1,map:null,previewCoord:null,projAxis:'auto',projCal:null};

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
      <div id="tm-scale" style="position:absolute;inset:0;transform-origin:50% 50%">
        <div id="tm-map" style="position:absolute;inset:0;touch-action:none"></div>
      </div>
      <!-- The trace's OWN render layer (owner report 2026-08-20, displaced
           shapes): every dot, edge, polygon, and label is drawn here via
           _tmProject, in the SAME frame the tap conversion (_tmUnproject)
           uses, so finger -> stored point -> rendered dot is consistent by
           construction. Deliberately OUTSIDE #tm-scale: it is never CSS-
           scaled, _tmProject applies the digital zoom itself. MapKit only
           supplies imagery and camera underneath, never trace geometry. -->
      <div id="tm-draw-layer" style="position:absolute;inset:0;pointer-events:none;z-index:4">
        <svg id="tm-draw-svg" style="position:absolute;inset:0;width:100%;height:100%;overflow:visible"></svg>
        <div id="tm-area-label" class="tm-area-label" style="display:none;position:absolute;transform:translate(-50%,-50%);background:var(--ink,#15161a);color:#fff;font-weight:900;padding:8px 14px;border-radius:999px;white-space:nowrap;font-family:var(--font-display,sans-serif);font-size:15px;letter-spacing:-.2px;box-shadow:0 3px 10px rgba(0,0,0,.3);pointer-events:none"></div>
        <div id="tm-live-label" class="tm-live-label" style="display:none;position:absolute;transform:translate(-50%,-50%);background:rgba(21,22,26,.82);color:#fff;font-weight:800;padding:3px 8px;border-radius:999px;white-space:nowrap;font-family:var(--font-display,sans-serif);box-shadow:0 2px 6px rgba(0,0,0,.25);pointer-events:none"></div>
      </div>
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
      <div id="tm-precision-hint" style="position:absolute;top:12px;left:12px;background:rgba(0,0,0,.55);color:#fff;font-size:10.5px;font-weight:700;padding:6px 10px;border-radius:999px;pointer-events:none">Hold &amp; drag to place precisely</div>
      <!-- TEMPORARY diagnostic overlay (owner report 2026-08-20: a plain
           quick tap on a still map landed a whole property away — magnitude
           way past anything jitter/tremor explains, root cause not yet
           confirmed). Shows the raw inputs behind each placed point so the
           next live repro can be read directly off the screen instead of
           guessed at from a photo. Remove once the real cause is found. -->
      <div id="tm-debug" style="position:absolute;left:6px;right:6px;bottom:6px;max-height:150px;overflow:auto;background:rgba(0,0,0,.8);color:#5f5;font:9px/1.35 ui-monospace,monospace;padding:6px;border-radius:6px;z-index:30;pointer-events:none;white-space:pre-wrap"></div>
      <div id="tm-crosshair" style="display:none;position:absolute;width:46px;height:46px;transform:translate(-50%,-50%);pointer-events:none;z-index:5">
        <div style="position:absolute;inset:0;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 1.5px rgba(0,0,0,.35),0 2px 10px rgba(0,0,0,.3)"></div>
        <div style="position:absolute;left:50%;top:50%;width:2px;height:14px;background:#fff;transform:translate(-50%,-50%);box-shadow:0 0 2px rgba(0,0,0,.6)"></div>
        <div style="position:absolute;left:50%;top:50%;width:14px;height:2px;background:#fff;transform:translate(-50%,-50%);box-shadow:0 0 2px rgba(0,0,0,.6)"></div>
      </div>
    </div>
    <div style="background:var(--bg);border-top:1px solid var(--border);padding:16px 18px calc(20px + env(safe-area-inset-bottom,0px));flex-shrink:0" id="tm-sheet">
      <div id="tm-readout" style="font-family:var(--font-display);font-size:32px;font-weight:900;letter-spacing:-1px;color:var(--text)">Tap the map to start</div>
      <div id="tm-readout-sub" style="font-size:12.5px;color:var(--text3);font-weight:600;margin:2px 0 14px"></div>
      <button class="btn btn-p" id="tm-cta" style="width:100%;padding:14px;font-size:14.5px" disabled onclick="_tmConfirmScreen()">Add to estimate</button>
    </div>`;
  document.body.appendChild(ov);
  _tmUpdateModeUI();
  await _tmInitMap();
  _tmStartDrawLoop();
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
      // Rotation permanently off: _tmProject/_tmUnproject (the app's own
      // projection, below) assume a top-down, heading-0 camera. Both the
      // constructor option and the runtime property are set (belt and
      // braces, MapKit versions differ on which one it honors).
      isRotationEnabled:false,
      isRotationAvailable:false,
    });
    try{map.isRotationEnabled=false;}catch(_e){}
    try{map.isRotationAvailable=false;}catch(_e){}
    map.region=new mapkit.CoordinateRegion(coord,new mapkit.CoordinateSpan(0.0015,0.0015));
    // No cameraZoomRange set defaults to MapKit's own floor, which isn't
    // close enough to trace a single roof edge or a foundation line by hand
    // (owner report 2026-08-19, live device: 12m). Tightened to 3m
    // (2026-08-20: still not close enough), then to 1m (2026-08-20, same
    // day: owner explicitly doesn't care if the upscaled satellite tile
    // gets blurry at this range, just wants to physically get closer). Pass
    // 1 all the way down to MapKit and let IT clamp to its own true floor
    // if 1m is tighter than tiles can usefully resolve — 3000m caps how far
    // a contractor can zoom OUT, past "the whole property" there's nothing
    // useful left to trace.
    map.cameraZoomRange=new mapkit.CameraZoomRange(1,3000);
    // No MapKit 'single-tap' listener: quick taps are handled inside
    // _tmInitPrecisionGesture's own pointerup, the same reliable
    // getBoundingClientRect()-based coordinate math as the hold gesture,
    // instead of MapKit's synthesized event and its e.pointOnPage. Two
    // rounds of owner live-device retests (2026-08-20) still showed plain
    // taps landing nowhere near the finger even after correcting for page
    // scroll, so pointOnPage's exact semantics in this fixed-overlay
    // context are not trustworthy enough to keep building on — one proven
    // coordinate path for every kind of point placement, not two.
    _tmInitPrecisionGesture(map,wrap);
    _tmState.map=map;
    // Calibrate the own projection against MapKit's converter ONCE at init
    // (plus one retry after tiles/layout settle), never per tap: see
    // _tmCalibrateProjection for why per-tap converter use is exactly the
    // bug this projection replaces.
    _tmCalibrateProjection();
    setTimeout(_tmCalibrateProjection,1500);
  }catch(_e){
    if(fallback)fallback.style.display='flex';
  }
}

// ── Digital zoom past MapKit's camera floor ─────────────────────────────────
// Probe-measured 2026-08-20 on the deployed app: MapKit's satellite camera
// clamps at 82.53m no matter what cameraZoomRange requests (rangeMin 0.1 was
// accepted, the camera ignored it — requests of 1m and 50m both settled at
// exactly 82.53m). The owner wants to get MUCH closer to place points
// precisely and explicitly accepts blur, so past the floor the map ELEMENT
// scales up via CSS (#tm-scale) — upscaled tiles, real geometry. Every
// point<->coordinate conversion funnels through _tmProject/_tmUnproject
// (below), which fold this digital scale in themselves, so placed points
// stay exact at any digital zoom.
const _TM_CAM_FLOOR=83;   // just above the measured 82.53m clamp
const _TM_DIGI_MAX=8;
function _tmDigiSet(z,animate){
  if(!_tmState)return;
  z=Math.max(1,Math.min(_TM_DIGI_MAX,z||1));
  _tmState.digiZoom=z;
  const el=document.getElementById('tm-scale');
  if(el){
    // Animated for the hold gesture's zoom in/out; instant while a pinch is
    // live-tracking the fingers (a transition there reads as rubber-band lag).
    el.style.transition=animate?'transform .28s cubic-bezier(.22,1,.36,1)':'none';
    el.style.transform=z===1?'':'scale('+z+')';
  }
  // The trace labels live in the app's own draw layer (outside #tm-scale)
  // and are positioned via _tmProject, which reads the live digi itself, so
  // no counter-scaling is needed here anymore; the draw loop re-renders them
  // through the whole 280ms transition.
}
// The TRUE current scale, read off the live rendered transform, never the
// JS target alone. _tmDigiSet's exit/entrance reset ANIMATES over 280ms
// (transition:transform), but sets _tmState.digiZoom to the FINAL target
// the instant it's called — so for up to 280ms after every hold release,
// the JS number and the actual on-screen scale disagree. A tap or the next
// hold's press-down landing in that window computed against the wrong
// scale, throwing the point off by the residual scale gap (owner report
// 2026-08-20, live device: tracing corners in quick succession, one point
// out of seven landed a full property away — exactly this signature, one
// isolated bad point, not a systemic offset). Reading the browser's own
// live matrix instead of a cached JS number makes this race impossible:
// there is no "in-flight" state to be wrong about.
function _tmCurrentDigi(){
  const el=document.getElementById('tm-scale');
  if(!el)return (_tmState&&_tmState.digiZoom)||1;
  try{
    const t=getComputedStyle(el).transform;
    if(!t||t==='none')return 1;
    const m=new DOMMatrix(t);
    return m.a||1; // uniform scale() only here, no rotation/skew
  }catch(_e){return (_tmState&&_tmState.digiZoom)||1;}
}
// Halts an in-flight ease-back-out RIGHT WHERE IT IS, the instant a new
// touch begins, instead of letting it keep animating underneath the new
// gesture. _tmCurrentDigi() alone (above) fixed the "one wrong point"
// symptom for every point EXCEPT the very first tap fired right after a
// hold release — because the scale itself is still a moving target for the
// whole 280ms, a finger-down read and the SAME finger's later finger-up
// read can land at two different instants of that motion and legitimately
// disagree, no matter how precisely either single read is taken. Freezing
// on touchstart makes the scale stable for the ENTIRE duration of the next
// gesture, so its own touchstart and touchend always agree with each other.
function _tmFreezeDigi(){
  if(!_tmState)return;
  const z=_tmCurrentDigi();
  const el=document.getElementById('tm-scale');
  if(el)el.style.transition='none'; // cancel the transition synchronously, no re-animation
  _tmDigiSet(z,false);
}
// ── The app's OWN projection: one frame for everything the user sees ───────
// Root cause of the displaced-shape bug (owner, 2026-08-20, live retests):
// every placed point routed through MapKit's convertPointOnPageToCoordinate,
// and every accuracy check routed back through convertCoordinateToPointOnPage,
// so any shared error in MapKit's cached notion of where its element sits on
// the page CANCELED OUT (the debug panel's rtErr=0.0px was structurally
// blind), while the trace the user actually saw was drawn by MapKit's
// overlay RENDERER in its own internal frame, which does not share that
// error. With #tm-map inside a CSS-scaled ancestor (the digital zoom) the
// transform-unaware converters and the renderer disagree by a constant
// offset: a whole traced shape comes out the right SIZE in the wrong PLACE,
// exactly what the owner photographed.
//
// Fix: never route user-visible geometry through MapKit at all. _tmProject/
// _tmUnproject below are pure Web Mercator math over map.region (read LIVE
// on every call, so camera animation and setCenterAnimated are always
// current), mapped onto #tm-canvas-wrap's LAYOUT box with the digital zoom
// applied around the wrap center via _tmCurrentDigi(). The trace itself is
// rendered by _tmRenderTrace into the app's own SVG layer using _tmProject,
// so finger -> stored lat/lng -> rendered dot is self-consistent BY
// CONSTRUCTION: there is no second frame left to disagree with.
// Latitude uses true Mercator y (not linear degrees) so tall spans don't
// bow; longitude is linear in the span, per Web Mercator.
const _TM_MAX_MERC_LAT=85.05112878;
function _tmMercY(latDeg){
  const lat=Math.max(-_TM_MAX_MERC_LAT,Math.min(_TM_MAX_MERC_LAT,latDeg))*Math.PI/180;
  return Math.log(Math.tan(Math.PI/4+lat/2));
}
function _tmMercLat(y){
  return (2*Math.atan(Math.exp(y))-Math.PI/2)*180/Math.PI;
}
// Live projection basis: region center + per-axis scale (CSS px per Mercator
// radian, the unit in which Web Mercator x and y are commensurate) against
// the wrap's UNSCALED layout box. Returns null when the map/wrap aren't
// usable (local fallback mode, zero-size layout, degenerate span).
function _tmProjBase(){
  const map=_tmState&&_tmState.map;
  const wrap=document.getElementById('tm-canvas-wrap');
  if(!map||!wrap)return null;
  let reg=null;
  try{reg=map.region;}catch(_e){return null;}
  if(!reg||!reg.center||!reg.span)return null;
  const w=wrap.clientWidth,h=wrap.clientHeight;
  const lngRad=reg.span.longitudeDelta*Math.PI/180;
  const mercSpan=_tmMercY(reg.center.latitude+reg.span.latitudeDelta/2)-_tmMercY(reg.center.latitude-reg.span.latitudeDelta/2);
  if(!(w>0)||!(h>0)||!(lngRad>0)||!(mercSpan>0))return null;
  return {
    sx:w/lngRad,      // x axis honored: longitudeDelta spans the width
    sy:h/mercSpan,    // y axis honored: latitudeDelta spans the height
    cx:w/2,cy:h/2,
    cLat:reg.center.latitude,cLng:reg.center.longitude,
  };
}
// Which axis MapKit actually fits map.region to on a non-square element is
// the one EMPIRICAL unknown here (if the region READ reflects the true
// displayed region, sx and sy agree and it doesn't matter). Web Mercator is
// conformal, so the real scale is one isotropic number; _tmCalibrateProjection
// auto-detects the axis from MapKit's converter (delta-based, so immune to
// the converter's origin error) and stores it in _tmState.projAxis. Until
// calibration lands, 'auto' assumes fit-inside (both deltas fully visible),
// i.e. the smaller of the two candidate scales.
function _tmProjS(k){
  const axis=(_tmState&&_tmState.projAxis)||'auto';
  if(axis==='x')return k.sx;
  if(axis==='y')return k.sy;
  if(axis==='both')return (k.sx+k.sy)/2;
  return Math.min(k.sx,k.sy);
}
// lat/lng -> wrap-local layout px, no calibration offset, no digital zoom.
// The building block calibration itself needs; everything else uses
// _tmProject/_tmUnproject below.
function _tmProjectRaw(lat,lng,k){
  k=k||_tmProjBase();
  if(!k)return null;
  const s=_tmProjS(k);
  return {
    x:k.cx+((lng-k.cLng)*Math.PI/180)*s,
    y:k.cy-(_tmMercY(lat)-_tmMercY(k.cLat))*s,
  };
}
// lat/lng -> wrap-local VISUAL px (what the user sees: calibration offset
// applied in the unscaled frame, then the live digital zoom around the wrap
// center, matching #tm-scale's transform-origin:50% 50%).
function _tmProject(lat,lng){
  const k=_tmProjBase();
  if(!k)return null;
  const p=_tmProjectRaw(lat,lng,k);
  const cal=_tmState&&_tmState.projCal;
  if(cal&&cal.applied){p.x+=cal.dx;p.y+=cal.dy;}
  const z=_tmCurrentDigi();
  if(z!==1){
    p.x=k.cx+(p.x-k.cx)*z;
    p.y=k.cy+(p.y-k.cy)*z;
  }
  return p;
}
// Viewport client px (e.clientX/e.clientY space, same as the retired
// _tmPageToCoord took) -> {latitude,longitude}. Exact inverse of _tmProject:
// wrap-local, un-digital-zoom around the center, un-calibrate, invert the
// Mercator mapping.
function _tmUnproject(x,y){
  const k=_tmProjBase();
  const wrap=document.getElementById('tm-canvas-wrap');
  if(!k||!wrap)return null;
  const r=wrap.getBoundingClientRect();
  let lx=x-r.left,ly=y-r.top;
  const z=_tmCurrentDigi();
  if(z!==1){
    lx=k.cx+(lx-k.cx)/z;
    ly=k.cy+(ly-k.cy)/z;
  }
  const cal=_tmState&&_tmState.projCal;
  if(cal&&cal.applied){lx-=cal.dx;ly-=cal.dy;}
  const s=_tmProjS(k);
  return {
    latitude:_tmMercLat(_tmMercY(k.cLat)+(k.cy-ly)/s),
    longitude:k.cLng+((lx-k.cx)/s)*180/Math.PI,
  };
}
// One-shot calibration at map init (digi=1, frames still coincident):
// samples MapKit's converter at two known page points and uses it two ways,
// never per tap (per-tap converter use IS the retired bug):
//   1. SCALE/axis detect: the converter's implied px-per-Mercator-radian is
//      computed from the DELTA between the two samples, which any constant
//      origin error cancels out of. Whichever region-derived axis scale
//      (sx/sy) matches it is the axis MapKit honors.
//   2. ORIGIN: if the two samples disagree with the own projection by the
//      SAME pixel offset (a pure constant), that offset corrects the
//      projection origin, turning the converter into a one-time calibration
//      input immune to whatever per-tap frame drift it develops later.
// Results (or the refusal to apply them) are logged to the tm-debug panel.
function _tmCalibrateProjection(){
  try{
    if(!_tmState||!_tmState.map)return;
    if(_tmCurrentDigi()!==1)return; // only calibrate on a clean, unscaled frame
    const map=_tmState.map;
    const wrap=document.getElementById('tm-canvas-wrap');
    const k=_tmProjBase();
    if(!wrap||!k)return;
    const r=wrap.getBoundingClientRect();
    const OX=80,OY=60;
    const samples=[{x:k.cx,y:k.cy},{x:k.cx+OX,y:k.cy+OY}];
    const conv=samples.map(p=>map.convertPointOnPageToCoordinate(new DOMPoint(r.left+p.x,r.top+p.y)));
    if(!conv[0]||!conv[1])return;
    const dLngRad=(conv[1].longitude-conv[0].longitude)*Math.PI/180; // +OX px east => positive
    const dMerc=_tmMercY(conv[0].latitude)-_tmMercY(conv[1].latitude); // +OY px south => positive
    if(!(dLngRad>0)||!(dMerc>0))return; // converter gave nonsense, keep 'auto'
    const sConv=(OX/dLngRad+OY/dMerc)/2;
    // Axis pick, in log space so 2x-off and half-off weigh the same.
    const ratio=k.sx/k.sy;
    let axis='both';
    if(Math.abs(Math.log(ratio))>0.01){
      axis=Math.abs(Math.log(k.sx/sConv))<=Math.abs(Math.log(k.sy/sConv))?'x':'y';
    }
    _tmState.projAxis=axis;
    // Constant-offset check against the now-axis-corrected raw projection.
    const deltas=samples.map((p,i)=>{
      const pr=_tmProjectRaw(conv[i].latitude,conv[i].longitude,null);
      return pr?{dx:p.x-pr.x,dy:p.y-pr.y}:null;
    });
    if(!deltas[0]||!deltas[1])return;
    const spread=Math.hypot(deltas[0].dx-deltas[1].dx,deltas[0].dy-deltas[1].dy);
    if(spread<2){
      _tmState.projCal={dx:(deltas[0].dx+deltas[1].dx)/2,dy:(deltas[0].dy+deltas[1].dy)/2,applied:true,spread};
    }else{
      // Not a constant: applying it would smear a scale mismatch into the
      // origin. Leave uncorrected and let the per-tap dConv logging show it.
      _tmState.projCal={dx:0,dy:0,applied:false,spread};
    }
    const el=document.getElementById('tm-debug');
    if(el){
      const cal=_tmState.projCal;
      el.textContent='CAL axis='+axis+' sx='+k.sx.toFixed(0)+' sy='+k.sy.toFixed(0)+' sConv='+sConv.toFixed(0)+
        ' off=('+cal.dx.toFixed(1)+','+cal.dy.toFixed(1)+')px spread='+spread.toFixed(1)+'px applied='+cal.applied+
        '\n'+el.textContent;
    }
  }catch(_e){}
}
// TEMPORARY diagnostic (see the tm-debug panel comment in openTrueMeasure):
// logs, for one placed point, the OWN-projection round trip (should be ~0 by
// construction) AND MapKit's converter answer for the same tap, plus the
// pixel/meter delta between the two. That delta IS the measured frame
// disagreement between MapKit's converters and reality; the next live repro
// reads the confirmation (or refutation) straight off the screen. Remove
// once the fix is confirmed live.
function _tmDebugSnap(label,x,y,coord){
  try{
    const el=document.getElementById('tm-debug');
    if(!el||!_tmState||!coord)return;
    const map=_tmState.map;
    const wrap=document.getElementById('tm-canvas-wrap');
    if(!wrap)return;
    const r=wrap.getBoundingClientRect();
    const own=_tmProject(coord.latitude,coord.longitude);
    const ownErr=own?Math.hypot(r.left+own.x-x,r.top+own.y-y):-1;
    let convTxt=' conv=n/a';
    if(map){
      try{
        // Feed the converter the same unscaled point the retired pipeline
        // would have (the old _tmUnscalePt math, inlined).
        const z=_tmCurrentDigi();
        const ccx=r.left+r.width/2,ccy=r.top+r.height/2;
        const cv=map.convertPointOnPageToCoordinate(new DOMPoint(ccx+(x-ccx)/z,ccy+(y-ccy)/z));
        const cvPx=_tmProject(cv.latitude,cv.longitude);
        const dPx=(cvPx&&own)?Math.hypot(cvPx.x-own.x,cvPx.y-own.y):-1;
        const dM=Math.hypot(
          (cv.latitude-coord.latitude)*111320,
          (cv.longitude-coord.longitude)*111320*Math.cos(coord.latitude*Math.PI/180));
        convTxt=' conv=('+cv.latitude.toFixed(6)+','+cv.longitude.toFixed(6)+') dConv='+dPx.toFixed(1)+'px/'+dM.toFixed(2)+'m';
      }catch(_e){}
    }
    const cal=_tmState.projCal||{};
    const line=label+' tap=('+x.toFixed(0)+','+y.toFixed(0)+') pt=('+coord.latitude.toFixed(6)+','+coord.longitude.toFixed(6)+
      ') ownErr='+ownErr.toFixed(1)+'px digi='+_tmCurrentDigi().toFixed(2)+
      ' axis='+((_tmState.projAxis)||'auto')+' cal='+(cal.applied?('('+cal.dx.toFixed(1)+','+cal.dy.toFixed(1)+')'):'off')+
      ' cam='+Math.round((map&&map.cameraDistance)||0)+'m rot='+(+((map&&map.rotation)||0)).toFixed(1)+
      convTxt;
    el.textContent=line+'\n'+el.textContent;
  }catch(_e){}
}

// Press-and-hold-and-drag precision point placement, the iOS-loupe pattern:
// a normal tap still drops a point immediately, handled in this same
// function's pointerup (the !active/!moved branch), not a separate MapKit
// gesture listener — one coordinate path for every kind of placement.
// Holding zooms the real map in around the touch point and shows a fixed
// crosshair offset above the finger (never obscured by the thumb) that
// tracks further dragging; lifting drops the point under the crosshair, then
// the camera eases back out. This is a real camera zoom, not a canvas/DOM
// screenshot loupe, MapKit's tiles aren't guaranteed CORS-readable for
// drawImage/getImageData, so a true magnifying-glass duplicate isn't safe.
function _tmInitPrecisionGesture(map,wrap){
  // THRESH decides hold-vs-pan ONCE, permanently, for the whole touch: the
  // instant raw drift crosses it, moved=true and cancelTimer() fire (see the
  // pointermove listener below), the hold timer can never fire again for
  // this touch, and every remaining touchmove for it is handed to MapKit's
  // native pan uninterrupted (this file's own touchmove listener only
  // swallows events while !active && !moved). 8px has no allowance for
  // ordinary hand tremor over the FULL 420ms HOLD_MS a genuine hold-and-drop
  // has to survive without tripping it — a thumb pressed down and held for
  // nearly half a second while aiming at a specific point routinely drifts
  // more than a couple millimeters even when the user's intent is "hold
  // still," not "pan" (owner report 2026-08-20: attempting to hold-and-drop
  // a point panned the map instead of zooming in). Raised to a standard
  // touch-slop range (~20px) so normal tremor during the hold's own window
  // survives; an intentional pan is still unmistakably past this in the
  // first couple frames of a real drag.
  const THRESH=20,HOLD_MS=420,ZOOM_FACTOR=0.3,OFFSET_Y=70;
  let downX=0,downY=0,moved=false,active=false,timer=null,suppressTouchEnd=false;
  let holdStartDigi=1,pinchOwn=false,pinchD0=0,pinchDigi0=1,pinchCam0=null;
  // The deliberate, SETTLED resting digi level, distinct from _tmCurrentDigi()
  // (the live/frozen visual scale). A hold's exitPrecision() commits its
  // target synchronously but the CSS takes 280ms to visually catch up; a
  // back-to-back hold fired into that window must start from where the
  // animation is HEADED, not wherever _tmFreezeDigi() happened to freeze the
  // still-easing visual mid-flight, or every rapid hold compounds onto an
  // already-elevated base (owner report 2026-08-20: zoom escalating on
  // repeated corners, probe-caught: 3.33 -> 4.66 -> 6.51). Pinch has no such
  // lag (it tracks the fingers live, un-animated), so it updates this in
  // step with every change.
  let restDigi=1;
  const cross=document.getElementById('tm-crosshair');
  // All finger/crosshair math is relative to the UNSCALED canvas frame, not
  // `wrap` (tm-map): wrap now lives inside the #tm-scale digital-zoom layer,
  // so its own bounding rect grows/moves under CSS scale, while the frame's
  // layout box is stable at any zoom.
  const frameEl=document.getElementById('tm-canvas-wrap')||wrap;
  function cancelTimer(){ if(timer){clearTimeout(timer);timer=null;} }
  function relPoint(e){
    const r=frameEl.getBoundingClientRect();
    return {x:e.clientX-r.left,y:e.clientY-r.top};
  }
  function tDist(t){return Math.hypot(t[0].clientX-t[1].clientX,t[0].clientY-t[1].clientY);}
  function placeCrosshair(x,y){
    if(!cross)return;
    cross.style.left=x+'px';
    cross.style.top=Math.max(20,y-OFFSET_Y)+'px';
  }
  // The crosshair's own screen position (finger offset up by OFFSET_Y,
  // clamped), converted to a map coordinate, same math pointerup uses to
  // drop the real point, so the live preview never disagrees with where it
  // actually lands.
  function crosshairCoord(x,y){
    const r=frameEl.getBoundingClientRect();
    const crossY=Math.max(20,y-OFFSET_Y);
    return _tmUnproject(r.left+x,r.top+crossY);
  }
  function exitPrecision(){
    active=false;
    if(cross)cross.style.display='none';
    _tmDigiSet(holdStartDigi,true); // release the hold's digital close-up
    restDigi=holdStartDigi; // the ease's committed target, not its mid-flight visual
    _tmClearPreview();
    // Mirror of the lock below: give the map's own pan back once the
    // hold-drag ends, whether it ended by dropping a pin or by cancelling.
    // Rotation stays off permanently (_tmInitMap): the projection assumes
    // heading 0.
    try{map.isScrollEnabled=true;}catch(_e){}
  }
  wrap.addEventListener('pointerdown',e=>{
    if(!e.isPrimary||(e.pointerType==='mouse'&&e.button!==0))return;
    _tmFreezeDigi(); // stop any in-flight ease-back-out before this touch's own math ever runs
    const p=relPoint(e);
    downX=p.x;downY=p.y;moved=false;
    cancelTimer();
    timer=setTimeout(()=>{
      if(moved)return;
      active=true;
      try{
        // Viewport-relative (getBoundingClientRect + relative offset), same
        // as crosshairCoord()/pointerup below — NOT e.pageX/e.pageY, which
        // are page-relative (include document scroll) and land wrong the
        // moment this fixed-position overlay sits over a scrolled page.
        const r=frameEl.getBoundingClientRect();
        const coord=_tmUnproject(r.left+downX,r.top+downY);
        // The committed RESTING target (see restDigi above), not
        // _tmCurrentDigi()'s live visual value: a hold fired again before the
        // previous one's 280ms ease-back-out finished must still start from
        // 1x (or wherever it's truly settled), not from whatever elevated
        // point the ease was mid-flight through when this touch landed —
        // that's what compounded rapid holds toward the 8x digital cap
        // (owner report 2026-08-20: "the zoom in moves very fast" while
        // tracing several corners back-to-back; probe-caught escalation
        // 3.33 -> 4.66 -> 6.51 once _tmFreezeDigi() started freezing the
        // mid-exit visual on the very next touch).
        holdStartDigi=restDigi;
        // Recenter on the pressed point (the digital scale magnifies around
        // the frame CENTER, so without this an off-center press would zoom
        // toward the middle of the screen instead of the finger). The own
        // projection reads map.region live, so this animation is always
        // tracked, never raced.
        if(coord)map.setCenterAnimated(new mapkit.Coordinate(coord.latitude,coord.longitude),true);
        // The close-up is FULLY digital, the camera distance is never
        // touched. Two probe rounds on the live app showed
        // setCameraDistanceAnimated contributing exactly nothing here
        // (111m -> 111m; the concurrent setCenterAnimated appears to
        // cancel it), and MapKit's satellite floor (~82.5m, measured)
        // caps it at a puny 1.3x from a typical view anyway. Digital
        // delivers the exact same 1/ZOOM_FACTOR magnification every time,
        // from any starting zoom, with nothing to race against.
        _tmDigiSet(holdStartDigi/ZOOM_FACTOR,true);
      }catch(_e){}
      // Belt-and-suspenders: harmless, and was worth something in an
      // earlier round, but three straight owner retests (2026-08-20) show
      // toggling MapKit's isScrollEnabled/isZoomEnabled flags does NOT
      // reliably stop its native gesture recognizers mid-drag — measuring
      // the actual video frame-by-frame showed the map continuing to pan
      // (and never actually zooming in) for nearly the ENTIRE hold, not
      // just some narrow timing window. The flags aren't the real fix;
      // see the capture-phase listeners below, which are.
      try{map.isScrollEnabled=false;map.isRotationEnabled=false;}catch(_e){}
      if(cross)cross.style.display='block';
      placeCrosshair(downX,downY);
      try{_tmUpdatePreview(crosshairCoord(downX,downY));}catch(_e){}
      if(typeof _tdHaptic==='function')_tdHaptic('tick');
    },HOLD_MS);
  });
  // Capture phase, not bubble: MapKit constructed its own gesture
  // recognizers on (or inside) this same `wrap` element before this
  // function ever ran, so a bubble-phase listener added here fires AFTER
  // MapKit's already has, too late to stop anything. Capture-phase
  // listeners on an ancestor run BEFORE any bubble-phase (or same-element)
  // listener beneath them, no matter the registration order.
  //
  // TWO event streams, both intercepted (probe run 2026-08-20, real
  // deployed MapKit): the browser dispatches pointer events AND touch
  // events in parallel for the same finger. MapKit's recognizers consume
  // the TOUCH stream, so stopping only pointermove did nothing to stop the
  // map panning under the drag — the touch listeners below are the ones
  // that actually make "camera holds still" true. And without
  // touch-action:none on #tm-map (set in the markup), the browser itself
  // hijacks the touch for scrolling and fires pointercancel, killing our
  // pointer stream mid-gesture — which both aborted the hold AND, on a
  // quick tap, swallowed the pointerup that places the point (the probe
  // caught taps placing nothing at all).
  wrap.addEventListener('pointermove',e=>{
    // While this layer owns a pinch, MapKit must not see the pointer
    // stream either (some engines drive its recognizers off pointer
    // events rather than touch events).
    if(pinchOwn){e.stopImmediatePropagation();e.preventDefault();return;}
    if(!e.isPrimary)return;
    if(!active){
      const p=relPoint(e);
      if(Math.abs(p.x-downX)>THRESH||Math.abs(p.y-downY)>THRESH){moved=true;cancelTimer();}
      // Still ambiguous (could yet become a tap): swallow it here too. See the
      // touchmove listener below for why this matters even though pointermove
      // alone was already proven insufficient to stop MapKit's own panning —
      // this is belt-and-suspenders for an engine that drives its recognizers
      // off pointer events (same reasoning as the pinch branch above).
      else{e.stopImmediatePropagation();e.preventDefault();}
      return;
    }
    e.stopImmediatePropagation();
    e.preventDefault();
    const p=relPoint(e);
    placeCrosshair(p.x,p.y);
    try{_tmUpdatePreview(crosshairCoord(p.x,p.y));}catch(_e){}
  },{capture:true,passive:false});
  wrap.addEventListener('pointerup',e=>{
    if(!e.isPrimary)return;
    cancelTimer();
    if(active){
      e.stopImmediatePropagation();
      e.preventDefault();
      const p=relPoint(e);
      const crossY=Math.max(20,p.y-OFFSET_Y);
      let coord=null;
      try{
        const r=frameEl.getBoundingClientRect();
        // Convert while the hold's digital zoom is still applied, THEN
        // exitPrecision (which releases it) — the crosshair the user aimed
        // with was on the zoomed view.
        coord=_tmUnproject(r.left+p.x,r.top+crossY);
        _tmDebugSnap('HOLD',r.left+p.x,r.top+crossY,coord);
      }catch(_e){}
      exitPrecision();
      suppressTouchEnd=true; // pointerup precedes touchend — see below
      if(coord)_tmAddPoint(coord.latitude,coord.longitude);
      return;
    }
    // A real pan/drag that never engaged our hold gesture — leave it
    // alone entirely, MapKit's own pan handling saw every event of this
    // sequence untouched (we never intercepted while !active).
    if(moved)return;
    // A genuine quick tap: place the point directly under the finger,
    // same getBoundingClientRect()-based math as the hold gesture above,
    // not MapKit's 'single-tap' event (see _tmInitMap — no longer used).
    e.stopImmediatePropagation();
    e.preventDefault();
    suppressTouchEnd=true;
    try{
      const coord=_tmUnproject(e.clientX,e.clientY);
      _tmDebugSnap('TAP',e.clientX,e.clientY,coord);
      if(coord)_tmAddPoint(coord.latitude,coord.longitude);
    }catch(_e){}
  },{capture:true});
  wrap.addEventListener('pointercancel',e=>{
    cancelTimer();
    if(!active)return;
    e.stopImmediatePropagation();
    exitPrecision();
  },{capture:true});
  // The touch-stream half of the interception (see the comment above): once
  // the hold gesture owns the finger, MapKit's touch-listening recognizers
  // must never see another event from it. The pointer listeners above still
  // do all the actual work (crosshair, preview, drop); these only silence
  // the parallel touch dispatches. suppressTouchEnd covers the ordering gap:
  // pointerup fires BEFORE touchend, and the placement handlers above set
  // active=false, so "while active" alone would let the sequence-closing
  // touchend through to MapKit — whose tap recognizer would then count our
  // placement taps toward a double-tap-to-zoom, recentering the camera
  // mid-trace (the original owner-reported bug). One-shot, cleared on the
  // next touchstart so a stale flag can never eat a real gesture's end.
  wrap.addEventListener('touchstart',e=>{
    if(!active)suppressTouchEnd=false;
    // Pinch-past-the-floor: once the camera is pinned at MapKit's satellite
    // floor (or a digital zoom is already applied), this layer owns the
    // pinch instead of MapKit — pinching IN scales the #tm-scale layer
    // (upscaled imagery, real geometry via the unscale helpers), pinching
    // OUT unwinds the digital zoom first and only then hands distance back
    // to the camera. Above the floor with no digital zoom, MapKit's own
    // pinch runs untouched.
    if(e.touches.length===2){
      cancelTimer();moved=true; // two fingers are never a tap or a hold
      const digi=_tmCurrentDigi();
      let cam=Infinity;try{cam=map.cameraDistance;}catch(_e){}
      pinchOwn=digi>1||cam<=_TM_CAM_FLOOR+2;
      if(pinchOwn){
        pinchD0=tDist(e.touches);pinchDigi0=digi;pinchCam0=cam;
        e.stopImmediatePropagation();e.preventDefault();
      }
    }else{
      pinchOwn=false;
    }
  },{capture:true,passive:false});
  wrap.addEventListener('touchmove',e=>{
    if(pinchOwn&&e.touches.length===2){
      e.stopImmediatePropagation();
      e.preventDefault();
      const d=tDist(e.touches);
      if(!(pinchD0>0)||!(d>0))return;
      const eff=pinchDigi0*(d/pinchD0);
      if(eff>=1){
        _tmDigiSet(eff);
        restDigi=eff; // pinch has no ease lag, live value IS the new resting baseline
      }else{
        // Unwound past digital 1x: give the remainder to the real camera.
        _tmDigiSet(1);
        restDigi=1;
        try{map.cameraDistance=Math.min(3000,(pinchCam0||_TM_CAM_FLOOR)/eff);}catch(_e){}
      }
      return;
    }
    if(!active){
      // THE BUG (owner screenshot 2026-08-20: a two-point trace landed a
      // whole house-width off the actual tap locations, a straight-line
      // shift far past any zoom/drift math error, on a plain quick tap with
      // no hold involved). Every quick tap "returned" here unconditionally
      // and let MapKit see its touchmove events, because active only
      // becomes true after the 420ms hold timer fires, and a tap by
      // definition releases long before that. But a real finger can never
      // land with EXACTLY zero pixels of movement between touchdown and
      // liftoff, and MapKit's own pan recognizer's movement threshold isn't
      // ours to know or control, only OUR threshold (THRESH, 8px) decides
      // `moved`. So a few pixels of ordinary hand tremor, comfortably under
      // OUR threshold (still reads as "just a tap" to us) could be enough to
      // cross MapKit's, and it would pan the camera underneath the finger
      // before the tap's own coordinate conversion ran at touchend — the
      // point then lands wherever the map ended up, not where the satellite
      // image was when the finger first touched down. The CI probe's CDP-
      // injected touches never caught this: synthetic touches move with
      // pixel-perfect precision and never carry that jitter.
      //
      // Fix: swallow every touchmove here too, for exactly as long as `moved`
      // is still false (still could become a tap). The instant real movement
      // crosses OUR OWN threshold (see the pointermove listener above, the
      // only place `moved` is set), stop swallowing and hand the stream back
      // to MapKit uninterrupted, so a genuine drag-to-pan the user actually
      // intends still works exactly as before.
      if(!moved){e.stopImmediatePropagation();e.preventDefault();}
      return;
    }
    e.stopImmediatePropagation();
    e.preventDefault();
  },{capture:true,passive:false});
  wrap.addEventListener('touchend',e=>{
    if(pinchOwn){
      pinchOwn=false;
      e.stopImmediatePropagation();
      e.preventDefault();
      return;
    }
    if(!active&&!suppressTouchEnd)return;
    suppressTouchEnd=false;
    e.stopImmediatePropagation();
  },{capture:true});
  wrap.addEventListener('touchcancel',e=>{
    if(!active)return;
    e.stopImmediatePropagation();
  },{capture:true});
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
  document.getElementById('tm-precision-hint')?.remove();
  _tmRedraw();
}

function _tmUndo(){
  if(!_tmState||!_tmState.points.length)return;
  _tmState.points.pop();
  _tmRedraw();
}

function _tmRedraw(){
  if(!_tmState)return;
  _tmRenderTrace();
  document.getElementById('tm-undo').style.display=_tmState.points.length?'block':'none';
  _tmUpdateReadout();
}

// ── The own render layer ────────────────────────────────────────────────────
// Draws the whole trace (vertex dots, edges, the in-progress polygon, the
// centroid total-sqft label, and the hold gesture's dashed preview run) into
// the #tm-draw-layer SVG/labels via _tmProject, replacing the retired
// mapkit.PolygonOverlay/PolylineOverlay/Annotation rendering. Same visual
// style as the old overlays (#2D5DA8 stroke, width 3, 0.28 fill for area;
// dashed 8/6 at 0.85 opacity for the preview). Called directly on every
// state change and re-run by _tmStartDrawLoop whenever the camera, digital
// zoom, or layout moves underneath.
function _tmRenderTrace(){
  if(!_tmState)return;
  const svg=document.getElementById('tm-draw-svg');
  if(!svg)return;
  const {points,mode}=_tmState;
  const proj=points.map(p=>_tmProject(p.lat,p.lng));
  const usable=proj.every(Boolean);
  const parts=[];
  if(usable&&points.length>=2){
    const d=proj.map(p=>p.x.toFixed(1)+','+p.y.toFixed(1)).join(' ');
    if(mode==='area'&&points.length>=3){
      parts.push('<polygon points="'+d+'" fill="#2D5DA8" fill-opacity="0.28" stroke="#2D5DA8" stroke-width="3" stroke-linejoin="round"/>');
    }else{
      parts.push('<polyline points="'+d+'" fill="none" stroke="#2D5DA8" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>');
    }
  }
  // Live preview while precision-holding to place the NEXT point (owner ask
  // 2026-08-19): a dashed run from the last confirmed point to wherever the
  // crosshair currently sits. Transient, cleared on release/cancel.
  const pv=_tmState.previewCoord;
  let pvMid=null,pvFt=0;
  if(usable&&pv&&points.length){
    const last=points[points.length-1];
    const a=proj[proj.length-1],b=_tmProject(pv.lat,pv.lng);
    if(a&&b){
      parts.push('<line x1="'+a.x.toFixed(1)+'" y1="'+a.y.toFixed(1)+'" x2="'+b.x.toFixed(1)+'" y2="'+b.y.toFixed(1)+'" stroke="#2D5DA8" stroke-width="3" stroke-opacity="0.85" stroke-dasharray="8 6" stroke-linecap="round"/>');
      pvMid=_tmProject((last.lat+pv.lat)/2,(last.lng+pv.lng)/2);
      pvFt=(typeof _geoDistFt==='function')?_geoDistFt(last,pv):0;
    }
  }
  // Vertex dots last so they sit on top of the edges. class="tm-dot" +
  // data-idx is the flow tests' ground truth: the dot's own DOM position IS
  // what the user sees, no MapKit converter anywhere in the check.
  if(usable){
    proj.forEach((p,i)=>{
      parts.push('<circle class="tm-dot" data-idx="'+i+'" cx="'+p.x.toFixed(1)+'" cy="'+p.y.toFixed(1)+'" r="5" fill="#2D5DA8" stroke="#fff" stroke-width="2"/>');
    });
  }
  svg.innerHTML=parts.join('');
  // Total-sqft label smack in the middle of a completed shape (owner ask
  // 2026-08-19), at the area-weighted centroid.
  const areaLbl=document.getElementById('tm-area-label');
  if(areaLbl){
    const centroid=(mode==='area'&&points.length>=3)?_tmCentroidCoord(points):null;
    const cp=centroid?_tmProject(centroid.lat,centroid.lng):null;
    if(cp){
      const m=_tmMeasure();
      areaLbl.textContent=m.value.toLocaleString()+' '+m.unit;
      areaLbl.style.left=cp.x+'px';
      areaLbl.style.top=cp.y+'px';
      areaLbl.style.display='block';
    }else{
      areaLbl.style.display='none';
    }
  }
  // The preview run's live distance label, font size scaling with length so
  // the marker visibly grows and shrinks as the line does.
  const liveLbl=document.getElementById('tm-live-label');
  if(liveLbl){
    if(pvMid){
      liveLbl.textContent=Math.round(pvFt)+' ft';
      liveLbl.style.fontSize=Math.max(11,Math.min(26,11+pvFt*0.09))+'px';
      liveLbl.style.left=pvMid.x+'px';
      liveLbl.style.top=pvMid.y+'px';
      liveLbl.style.display='block';
    }else{
      liveLbl.style.display='none';
    }
  }
  _tmState._drawSig=_tmDrawSig();
}
// Everything the rendered trace depends on, folded into one comparable
// string: region (live camera), digital zoom (live, mid-transition values
// included), layout size, the points, the preview, and the mode. When any
// of it changes between frames the draw loop re-renders; when nothing moves
// the loop costs a string compare.
function _tmDrawSig(){
  if(!_tmState)return '';
  let region='';
  if(_tmState.map){
    try{
      const rg=_tmState.map.region;
      region=rg.center.latitude.toFixed(8)+','+rg.center.longitude.toFixed(8)+','+rg.span.latitudeDelta.toFixed(8)+','+rg.span.longitudeDelta.toFixed(8);
    }catch(_e){}
  }
  const wrap=document.getElementById('tm-canvas-wrap');
  const pv=_tmState.previewCoord;
  const cal=_tmState.projCal;
  return [
    region,
    _tmCurrentDigi().toFixed(4),
    wrap?(wrap.clientWidth+'x'+wrap.clientHeight):'',
    _tmState.points.map(p=>p.lat.toFixed(7)+','+p.lng.toFixed(7)).join(';'),
    pv?(pv.lat.toFixed(7)+','+pv.lng.toFixed(7)):'',
    _tmState.mode,
    _tmState.repeatCount,
    (_tmState.projAxis||'auto')+(cal&&cal.applied?(':'+cal.dx.toFixed(2)+','+cal.dy.toFixed(2)):''),
  ].join('|');
}
// rAF loop for the lifetime of ONE TrueMeasure overlay: re-renders the trace
// whenever its inputs move (camera animation from setCenterAnimated, the
// 280ms digital-zoom CSS transition, a live pinch, a resize), reading the
// LIVE digi via _tmCurrentDigi so the SVG tracks the transition frame-
// accurately. Exits the moment _tmState is replaced or cleared, so a
// close-and-reopen never stacks loops.
function _tmStartDrawLoop(){
  if(!_tmState)return;
  const state=_tmState;
  const tick=()=>{
    if(_tmState!==state)return;
    if(document.getElementById('tm-draw-svg')&&_tmDrawSig()!==state._drawSig)_tmRenderTrace();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function _tmUpdatePreview(coord){
  if(!_tmState||!_tmState.points.length||!coord)return;
  _tmState.previewCoord={lat:coord.latitude,lng:coord.longitude};
  _tmRenderTrace();
}
function _tmClearPreview(){
  if(!_tmState)return;
  _tmState.previewCoord=null;
  _tmRenderTrace();
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
