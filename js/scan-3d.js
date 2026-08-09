// ── Interactive 3D dollhouse (owner ask 2026-08-09: "as advanced as Polycam") ─
// A real orbiting 3D model of the scanned house, built from the parametric
// walls: door and window openings are CUT THROUGH the wall geometry, floors
// are slabs, multi-story scans stack as an exploded dollhouse. Drag to orbit,
// pinch or wheel to zoom.
//
// three.js (MIT, vendored at js/vendor/three.module.min.js) loads lazily via
// dynamic import ONLY when this viewer opens, so the app pays zero bytes for
// it anywhere else. The SVG dollhouse in the viewer tab stays as the instant
// preview/print tier; this is the flagship tier, and the Quick Look USDZ
// (build #12) is the AR tier. Controls are hand-rolled (~40 lines) instead of
// OrbitControls because the examples module hard-imports the bare 'three'
// specifier, which a static no-bundler app cannot resolve.
let _s3d=null;   // {renderer,scene,camera,raf,ov} while the viewer is open

function _scan3dClose(){
  if(!_s3d)return;
  try{cancelAnimationFrame(_s3d.raf);}catch(_e){}
  try{_s3d.renderer&&_s3d.renderer.dispose();}catch(_e){}
  try{_s3d.ov&&_s3d.ov.remove();}catch(_e){}
  _s3d=null;
}
async function _scan3dOpen(id){
  const sc=getScans().find(x=>String(x.id)===String(id));
  if(!sc||!(sc.rooms||[]).length)return;
  _scan3dClose();
  const ov=document.createElement('div');
  ov.id='_scan-3d-ov';
  ov.style.cssText='position:fixed;inset:0;z-index:10000;background:#181714;display:flex;flex-direction:column';
  ov.innerHTML=
    '<div style="position:absolute;top:calc(env(safe-area-inset-top,0px) + 12px);left:16px;right:16px;display:flex;justify-content:space-between;align-items:center;z-index:2">'+
      '<div style="color:#fff;font-size:14px;font-weight:800">'+escHtml(sc.name||'3D model')+'</div>'+
      '<button onclick="_scan3dClose()" style="border:none;background:rgba(255,255,255,.16);color:#fff;font-size:18px;width:40px;height:40px;border-radius:20px;cursor:pointer">✕</button>'+
    '</div>'+
    '<div id="_s3d-mount" style="flex:1"></div>'+
    '<div style="position:absolute;left:0;right:0;bottom:calc(env(safe-area-inset-bottom,0px) + 14px);display:flex;flex-direction:column;align-items:center;gap:10px;z-index:2;pointer-events:none">'+
      '<div style="color:rgba(255,255,255,.55);font-size:11px;font-weight:600">Drag to orbit · pinch or scroll to zoom</div>'+
      (sc.usdz&&typeof _scanPlugin==='function'&&_scanPlugin()?'<button onclick="_scanViewUsdz(\''+sc.id+'\')" style="pointer-events:auto;border:none;background:rgba(255,255,255,.92);color:#181714;font-size:13px;font-weight:800;padding:10px 18px;border-radius:20px;cursor:pointer;font-family:inherit">Walk it in AR</button>':'')+
    '</div>';
  document.body.appendChild(ov);
  _s3d={ov};
  // Dynamic import in a classic script resolves against THIS script's URL
  // (js/scan-3d.js), so the vendor file is a sibling directory; the absolute
  // path is the fallback for any host that rebases script URLs.
  let T=null;
  try{T=await import('./vendor/three.module.min.js');}
  catch(_e1){try{T=await import('/js/vendor/three.module.min.js');}catch(_e2){}}
  if(!_s3d||_s3d.ov!==ov)return;   // closed while loading
  const mount=ov.querySelector('#_s3d-mount');
  let renderer=null;
  try{renderer=T&&new T.WebGLRenderer({antialias:true});}catch(_e){}
  if(!T||!renderer){
    mount.innerHTML='<div style="height:100%;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.7);font-size:13px;padding:0 30px;text-align:center">3D needs WebGL, which this browser has turned off. The 2D dollhouse and AR view still work.</div>';
    return;
  }
  // ── Build the model ────────────────────────────────────────────────────────
  const stories=_scanStories(sc);
  const wh=r=>Math.max(1.8,Math.min(3.4,r.hM||2.44));   // full walls, no ceiling
  const explode=1.4;
  const lvlY=st=>stories.indexOf(Math.max(1,+st||1))*(3.0+explode);
  const scene=new T.Scene();
  scene.background=new T.Color(0x181714);
  const model=new T.Group();
  const wallMat=new T.MeshStandardMaterial({color:0xEDEAE3,roughness:0.9,metalness:0});
  const edgeMat=new T.LineBasicMaterial({color:0x55524a});
  const floorCols=[0xB9CFE8,0xC9DDB4,0xE8D5AC,0xD8C2D8,0xBFDCD2,0xE3C8BC];
  const TH=0.11;
  (sc.rooms||[]).forEach((r,ri)=>{
    const y0=lvlY(r.story);
    // Floor slab from the room polygon.
    if((r.poly||[]).length>=3){
      const shp=new T.Shape();
      r.poly.forEach(([x,z],i)=>{i?shp.lineTo(x,z):shp.moveTo(x,z);});
      const g=new T.ExtrudeGeometry(shp,{depth:0.09,bevelEnabled:false});
      const m=new T.Mesh(g,new T.MeshStandardMaterial({color:floorCols[ri%floorCols.length],roughness:0.95}));
      // Shape extrudes along +z of its local space; rotate flat, slab tops at y0.
      m.rotation.x=Math.PI/2;
      m.position.y=y0;
      m.receiveShadow=true;
      model.add(m);
    }
    // Walls with the openings cut through them.
    (r.walls||[]).forEach(w=>{
      if(!w.len)return;
      const H=Math.min(wh(r),w.h||wh(r));
      const shp=new T.Shape();
      shp.moveTo(0,0);shp.lineTo(w.len,0);shp.lineTo(w.len,H);shp.lineTo(0,H);shp.closePath();
      // Openings sorted and de-overlapped so hole paths stay valid.
      const ops=[];
      (w.doors||[]).forEach(d=>{if(typeof d.off==='number'&&d.w)ops.push({d0:d.off-d.w/2,d1:d.off+d.w/2,y0:0,y1:Math.min(H-0.15,d.h||2.03)});});
      (w.windows||[]).forEach(win=>{if(typeof win.off==='number'&&win.w){const sill=0.9;ops.push({d0:win.off-win.w/2,d1:win.off+win.w/2,y0:sill,y1:Math.min(H-0.2,sill+(win.h||1.2))});}});
      ops.sort((a,b)=>a.d0-b.d0);
      let lastEnd=-1;
      ops.forEach(op=>{
        const d0=Math.max(0.05,op.d0),d1=Math.min(w.len-0.05,op.d1);
        if(d1-d0<0.15||d0<lastEnd)return;
        lastEnd=d1;
        const hole=new T.Path();
        hole.moveTo(d0,op.y0);hole.lineTo(d1,op.y0);hole.lineTo(d1,op.y1);hole.lineTo(d0,op.y1);hole.closePath();
        shp.holes.push(hole);
      });
      const g=new T.ExtrudeGeometry(shp,{depth:TH,bevelEnabled:false});
      const m=new T.Mesh(g,wallMat);
      m.castShadow=true;m.receiveShadow=true;
      // Local x runs A→B along the wall; the extrusion depth becomes the
      // thickness, pushed back half a wall so it centers on the scanned
      // centerline (extrusion grows along the local +z normal (-uz, ux)).
      const ux=(w.bx-w.ax)/w.len,uz=(w.bz-w.az)/w.len;
      m.rotation.y=Math.atan2(-uz,ux);
      m.position.set(w.ax+uz*TH/2,y0,w.az-ux*TH/2);
      model.add(m);
      const eg=new T.EdgesGeometry(g,30);
      const el=new T.LineSegments(eg,edgeMat);
      el.rotation.copy(m.rotation);el.position.copy(m.position);
      model.add(el);
    });
  });
  // Center the model on origin so the orbit pivots through the house.
  const bb=new T.Box3().setFromObject(model);
  const c=bb.getCenter(new T.Vector3()),size=bb.getSize(new T.Vector3());
  model.position.set(-c.x,-bb.min.y,-c.z);
  scene.add(model);
  // Ground shadow catcher.
  const ground=new T.Mesh(new T.CircleGeometry(Math.max(size.x,size.z)*1.4,48),
    new T.ShadowMaterial({opacity:0.28}));
  ground.rotation.x=-Math.PI/2;ground.position.y=-0.02;ground.receiveShadow=true;
  scene.add(ground);
  // Lights: soft sky fill + one shadowed sun.
  scene.add(new T.HemisphereLight(0xffffff,0x8a8578,1.05));
  const sun=new T.DirectionalLight(0xfff4e0,1.6);
  sun.position.set(6,10,4);sun.castShadow=true;
  sun.shadow.mapSize.set(1024,1024);
  const ext=Math.max(size.x,size.z);
  sun.shadow.camera.left=-ext;sun.shadow.camera.right=ext;
  sun.shadow.camera.top=ext;sun.shadow.camera.bottom=-ext;
  scene.add(sun);
  // ── Camera + hand-rolled orbit ─────────────────────────────────────────────
  const cam=new T.PerspectiveCamera(46,1,0.1,300);
  const R0=Math.max(size.x,size.y,size.z)*1.55+2;
  const orbit={theta:Math.PI/4,phi:1.05,r:R0,cy:size.y/2};
  const place=()=>{
    cam.position.set(Math.sin(orbit.theta)*Math.sin(orbit.phi)*orbit.r,
                     Math.cos(orbit.phi)*orbit.r+orbit.cy,
                     Math.cos(orbit.theta)*Math.sin(orbit.phi)*orbit.r);
    cam.lookAt(0,orbit.cy,0);
  };
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=T.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
  const fit=()=>{
    const rct=mount.getBoundingClientRect();
    renderer.setSize(rct.width,rct.height);
    cam.aspect=rct.width/Math.max(1,rct.height);
    cam.updateProjectionMatrix();
  };
  mount.appendChild(renderer.domElement);
  renderer.domElement.style.touchAction='none';
  fit();place();
  // Pointer orbit + two-finger pinch + wheel zoom.
  const ptrs={};let pinchD=null;
  const el=renderer.domElement;
  el.addEventListener('pointerdown',e=>{ptrs[e.pointerId]={x:e.clientX,y:e.clientY};el.setPointerCapture(e.pointerId);});
  el.addEventListener('pointermove',e=>{
    const p=ptrs[e.pointerId];if(!p)return;
    const ids=Object.keys(ptrs);
    if(ids.length===1){
      orbit.theta-=(e.clientX-p.x)*0.008;
      orbit.phi=Math.max(0.25,Math.min(1.45,orbit.phi-(e.clientY-p.y)*0.006));
    }
    p.x=e.clientX;p.y=e.clientY;
    if(ids.length===2){
      const[a,b]=ids.map(k=>ptrs[k]);
      const d=Math.hypot(a.x-b.x,a.y-b.y);
      if(pinchD!=null)orbit.r=Math.max(3,Math.min(R0*2.5,orbit.r*(pinchD/Math.max(1,d))));
      pinchD=d;
    }
    place();
  });
  const lift=e=>{delete ptrs[e.pointerId];pinchD=null;};
  el.addEventListener('pointerup',lift);el.addEventListener('pointercancel',lift);
  el.addEventListener('wheel',e=>{e.preventDefault();orbit.r=Math.max(3,Math.min(R0*2.5,orbit.r*(1+e.deltaY*0.0012)));place();},{passive:false});
  window.addEventListener('resize',fit);
  _s3d.renderer=renderer;_s3d.scene=scene;_s3d.camera=cam;
  const loop=()=>{if(!_s3d||_s3d.renderer!==renderer)return;renderer.render(scene,cam);_s3d.raf=requestAnimationFrame(loop);};
  loop();
}
