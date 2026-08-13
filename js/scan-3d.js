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
let _s3d=null;   // {renderer,scene,camera,raf,ov,furn} while the viewer is open

// ── Furniture parts library ──────────────────────────────────────────────────
// Owner (2026-08-10): the 3D needs its shine, and next to Polycam the missing
// shine was the furniture. RoomPlan boxes every piece it classifies; the plan
// draws them as 2D symbols (js/scan.js), and this is the 3D half: each
// category becomes a small assembly of boxes and cylinders, in the piece's own
// frame (x along width, z along depth, y up from the floor, meters).
//
// Pure data, no three.js: the offline suite proves the shapes without a GL
// context, and _scan3dOpen just turns parts into meshes.
const _S3D_COLS={wood:0xC9AE84,beige:0xD5C39D,cushion:0xEFE8D8,appl:0x9C96B8,
                 plumb:0xEDF0F2,basin:0xAFB9C2,dark:0x4A4F58,tan:0xC4A876};
function _scan3dFurnSpec(cat,w,d,h){
  const C=_S3D_COLS;
  // Typical heights when the scan's own box came back degenerate.
  const FALL={bed:.6,sofa:.78,chair:.85,table:.74,refrigerator:1.75,stove:.9,
    oven:.9,dishwasher:.85,washerDryer:1.0,sink:.86,toilet:.76,bathtub:.56,
    television:.9,storage:1.1,fireplace:1.0,stairs:2.2};
  const H=(h&&h>0.15)?h:(FALL[cat]||0.75);
  const box=(x,y,z,bw,bh,bd,col)=>({shape:'box',x,y,z,w:bw,h:bh,d:bd,col});
  const cyl=(x,y,z,r,ch,col)=>({shape:'cyl',x,y,z,r,h:ch,col});
  const hw=w/2,hd=d/2;
  switch(cat){
    case 'bed':{
      const fh=H*.45,mh=H*.4;
      return [box(0,fh/2,0,w,fh,d,C.wood),
              box(0,fh+mh/2,0,w*.94,mh,d*.96,C.cushion),
              box(0,fh+mh+.06,-hd+d*.15,w*.62,.11,d*.2,0xF7F4EC)];
    }
    case 'sofa':{
      const bh=H*.55;
      return [box(0,bh/2,0,w,bh,d,C.beige),
              box(0,H/2,-hd+d*.12,w,H,d*.24,C.beige),
              box(-hw+w*.07,H*.38,0,w*.14,H*.76,d,C.beige),
              box(hw-w*.07,H*.38,0,w*.14,H*.76,d,C.beige),
              box(0,bh+.05,d*.06,w*.66,.12,d*.5,C.cushion)];
    }
    case 'chair':{
      const sh=H*.52;
      return [box(0,sh/2,0,w,sh,d,C.beige),
              box(0,(sh+H)/2,-hd+d*.1,w,H-sh,d*.2,C.beige)];
    }
    case 'table':{
      const ix=Math.min(.07,hw*.35),iz=Math.min(.07,hd*.35);
      const legs=[[-hw+ix,-hd+iz],[hw-ix,-hd+iz],[-hw+ix,hd-iz],[hw-ix,hd-iz]]
        .map(([x,z])=>box(x,(H-.05)/2,z,.06,H-.05,.06,C.wood));
      return [box(0,H-.025,0,w,.05,d,C.wood)].concat(legs);
    }
    case 'stove':{
      const r=Math.min(w,d)*.16;
      const burners=[[-1,-1],[1,-1],[-1,1],[1,1]]
        .map(([a,b])=>cyl(a*w*.22,H+.015,b*d*.2,r,.03,C.dark));
      return [box(0,H/2,0,w,H,d,C.appl)].concat(burners);
    }
    case 'oven':
      return [box(0,H/2,0,w,H,d,C.appl),
              box(0,H*.45,hd-.01,w*.8,H*.5,.04,C.dark)];
    case 'washerDryer':
      return [box(0,H/2,0,w,H,d,C.appl),
              box(0,H-.05,-hd+d*.1,w*.9,.07,d*.16,C.dark)];
    case 'refrigerator':case 'dishwasher':
      return [box(0,H/2,0,w,H,d,C.appl)];
    case 'sink':
      return [box(0,H/2,0,w,H,d,C.plumb),
              box(0,H-.01,0,w*.66,.06,d*.6,C.basin)];
    case 'toilet':
      return [box(0,H*.7,-hd+d*.16,w*.9,H*.55,d*.3,C.plumb),
              cyl(0,H*.26,d*.12,Math.min(w,d)*.34,H*.5,C.plumb)];
    case 'bathtub':
      return [box(0,H/2,0,w,H,d,C.plumb),
              box(0,H-.03,0,w*.84,.06,d*.72,0xF8FAFB)];
    case 'television':
      return [box(0,H*.55,0,w,H*.8,Math.min(d,.09),C.dark),
              box(0,H*.075,0,w*.3,H*.15,Math.min(d,.2),C.dark)];
    case 'fireplace':
      return [box(0,H/2,0,w,H,d,0xBDB4A8),
              box(0,H*.32,hd-.01,w*.6,H*.5,.04,C.dark)];
    case 'stairs':{
      const n=Math.max(3,Math.round(d/.28)),rise=H/n,run=d/n;
      const steps=[];
      for(let i=0;i<n;i++)steps.push(box(0,rise*(i+.5),-hd+run*(i+.5),w,rise,run,C.wood));
      return steps;
    }
    case 'storage':
      return [box(0,H/2,0,w,H,d,C.tan)];
    default:
      return [box(0,H/2,0,w,H,d,C.beige)];
  }
}
// The Furniture layer pill, Polycam-style: the model stays, the furniture
// group blinks off, so a contractor can read bare walls under a staged house.
function _scan3dToggleFurn(){
  if(!_s3d||!_s3d.furn)return;
  _s3d.furn.visible=!_s3d.furn.visible;
  const b=document.getElementById('_s3d-furn-btn');
  if(b)b.style.opacity=_s3d.furn.visible?'1':'0.45';
}

// ── Paint mode (owner ask 2026-08-10) ────────────────────────────────────────
// "Show the client a scan, have them pick their color and show what it would
// look like on the wall." The sales moment: the contractor hands the phone
// over in the client's own living room. Pick a swatch, the whole room repaints
// live under the scene lighting; tap a single wall for an accent wall. The
// choice SAVES onto the scan record (td_scans syncs), so what the client
// picked is on file when the estimate is written.
//
// Two decks. Painters get the Sherwin-Williams names and numbers they and
// their clients actually talk in (owner call 2026-08-10); every other trade
// keeps the generic set. Screen hexes are the published sRGB values and every
// visualizer disclaims the same thing, so the strip carries a fan-deck line.
const _S3D_PAINT=[
  ['Warm white','','#F3EFE4'],['Soft cream','','#F1E7CF'],['Greige','','#D8D0C2'],
  ['Clay','','#C9A98F'],['Terracotta','','#C4744E'],['Blush','','#E3C2B7'],
  ['Sage','','#9CAF88'],['Olive','','#7E8464'],['Dusty blue','','#8FA7B8'],
  ['Navy','','#33465E'],['Slate','','#6B7280'],['Charcoal','','#3E4145'],
];
// The SW set leads with the colors that dominate real repaint jobs (the
// whites/greiges every painter quotes weekly), then the accent families.
const _S3D_SW=[
  ['Pure White','SW 7005','#EDECE6'],['Extra White','SW 7006','#EEEFEA'],
  ['Alabaster','SW 7008','#EDEAE0'],['Snowbound','SW 7004','#EDEAE4'],
  ['Greek Villa','SW 7551','#F0EBDD'],['Shoji White','SW 7042','#E6DFD3'],
  ['Creamy','SW 7012','#F0E9D9'],['Natural Linen','SW 9109','#E3DACA'],
  ['Agreeable Gray','SW 7029','#D1CBC1'],['Repose Gray','SW 7015','#CCC9C0'],
  ['Accessible Beige','SW 7036','#D1C7B8'],['Balanced Beige','SW 7037','#C9BCAB'],
  ['Kilim Beige','SW 6106','#D7C5AF'],['Worldly Gray','SW 7043','#CEC8BC'],
  ['Colonnade Gray','SW 7641','#C7C2B8'],['Amazing Gray','SW 7044','#BEB8AC'],
  ['Mindful Gray','SW 7016','#BCB7AD'],['Dorian Gray','SW 7017','#ACA79E'],
  ['Light French Gray','SW 0055','#C4C6C4'],['Passive','SW 7064','#CBCCC9'],
  ['Sea Salt','SW 6204','#CDD6CC'],['Rainwashed','SW 6211','#C2D1C8'],
  ['Comfort Gray','SW 6205','#BEC5BB'],['Silver Strand','SW 7057','#C7CCC3'],
  ['Oyster Bay','SW 6206','#AFB9A9'],['Evergreen Fog','SW 9130','#95978A'],
  ['Retreat','SW 6207','#7C8772'],['Pewter Green','SW 6208','#5F6355'],
  ['Upward','SW 6239','#AEBBC4'],['Krypton','SW 6247','#A5AFB2'],
  ['Debonair','SW 9139','#9BABB8'],['Distance','SW 6243','#5D6D7E'],
  ['Naval','SW 6244','#2F3D4C'],['Sea Serpent','SW 7615','#33393E'],
  ['Latte','SW 6108','#BAA185'],['Nomadic Desert','SW 6107','#C5AE8F'],
  ['Redend Point','SW 9081','#B4907F'],['Cavern Clay','SW 7701','#AC6B53'],
  ['Rojo Marron','SW 9182','#6E3B32'],['Urbane Bronze','SW 7048','#54504A'],
  ['Iron Ore','SW 7069','#434341'],['Peppercorn','SW 7674','#585B5D'],
  ['Cyberspace','SW 7076','#44484D'],['Tricorn Black','SW 6258','#2F2F30'],
];
// The active deck follows the active trade, exactly like the scan lenses.
function _scan3dPalette(){
  const painter=(typeof _scanTradeLens==='function')&&_scanTradeLens()==='paint';
  return painter?{brand:'Sherwin-Williams',colors:_S3D_SW}
                :{brand:null,colors:_S3D_PAINT};
}
function _scan3dPaintKey(ri,wallId){return ri+':'+wallId;}
// Persistence: {wallKey:'#hex'} on the scan record, plus the human name of
// the color ("Agreeable Gray SW 7029") in wallPaintNames, because the name is
// what goes in the estimate and on the paint order. hex=null erases both.
function _scan3dSetPaint(sc,key,hex,label){
  if(!sc)return;
  sc.wallPaint=sc.wallPaint||{};
  sc.wallPaintNames=sc.wallPaintNames||{};
  if(hex){sc.wallPaint[key]=hex;if(label)sc.wallPaintNames[key]=label;else delete sc.wallPaintNames[key];}
  else{delete sc.wallPaint[key];delete sc.wallPaintNames[key];}
  if(typeof saveScan==='function')saveScan(sc);
}
function _scan3dPaintAll(hex,label){
  if(!_s3d||!_s3d.sc)return;
  const sc=_s3d.sc;
  sc.wallPaint=sc.wallPaint||{};
  sc.wallPaintNames=sc.wallPaintNames||{};
  (_s3d.walls||[]).forEach(w=>{
    if(hex){sc.wallPaint[w.key]=hex;if(label)sc.wallPaintNames[w.key]=label;else delete sc.wallPaintNames[w.key];}
    else{delete sc.wallPaint[w.key];delete sc.wallPaintNames[w.key];}
    if(w.mesh&&w.mesh.material)w.mesh.material.color.set(hex||_s3d.wallBase);
  });
  if(typeof saveScan==='function')saveScan(sc);
  _scan3dMeshRepaint();
}
function _scan3dPickSwatch(hex,label){
  if(!_s3d)return;
  _s3d.paintHex=hex;
  _s3d.paintLabel=label||'';
  document.querySelectorAll('#_s3d-paint-strip [data-hex]').forEach(el=>{
    el.style.outline=el.getAttribute('data-hex')===hex?'2px solid #fff':'none';
  });
  const nameEl=document.getElementById('_s3d-paint-name');
  if(nameEl)nameEl.textContent=label||hex;
  // Picking a swatch paints the whole scan immediately (the demo moment);
  // tapping a wall afterwards makes that one an accent in the same color
  // conversation.
  _scan3dPaintAll(hex,label||'');
}
function _scan3dPaintReset(){
  if(!_s3d)return;
  _s3d.paintHex=null;_s3d.paintLabel='';
  document.querySelectorAll('#_s3d-paint-strip [data-hex]').forEach(el=>{el.style.outline='none';});
  const nameEl=document.getElementById('_s3d-paint-name');
  if(nameEl)nameEl.textContent='';
  _scan3dPaintAll(null);
}
function _scan3dTogglePaint(){
  const strip=document.getElementById('_s3d-paint-strip');
  const deck=document.getElementById('_s3d-paint-deck');
  const b=document.getElementById('_s3d-paint-btn');
  if(!strip)return;
  const open=strip.style.display==='none';
  strip.style.display=open?'flex':'none';
  if(deck)deck.style.display=open?'block':'none';
  if(b)b.style.opacity=open?'1':'0.7';
}
// The swatch strip HTML: the active deck + a native color well + Reset, with
// the picked color's name on the glass and the fan-deck honesty line.
function _scan3dPaintStripHtml(){
  const pal=_scan3dPalette();
  return '<div style="display:flex;flex-direction:column;align-items:center;gap:4px;pointer-events:none">'+
    '<div id="_s3d-paint-name" style="color:#fff;font-size:12px;font-weight:800;min-height:15px;text-shadow:0 1px 3px rgba(0,0,0,.7)"></div>'+
    '<div id="_s3d-paint-strip" style="display:none;gap:8px;align-items:center;overflow-x:auto;max-width:92vw;padding:6px 10px;background:rgba(0,0,0,.5);border-radius:16px;pointer-events:auto">'+
      pal.colors.map(([name,code,hex])=>{
        const label=(name+(code?' '+code:'')).replace(/'/g,'');
        return '<button data-hex="'+hex+'" onclick="_scan3dPickSwatch(\''+hex+'\',\''+label+'\')" title="'+label+'" style="width:34px;height:34px;border-radius:17px;border:2px solid rgba(255,255,255,.5);background:'+hex+';flex:0 0 auto;cursor:pointer"></button>';
      }).join('')+
      '<input type="color" value="#9CAF88" onchange="_scan3dPickSwatch(this.value,\'Custom\')" style="width:34px;height:34px;border-radius:17px;border:2px solid rgba(255,255,255,.5);padding:0;background:none;flex:0 0 auto;cursor:pointer" title="Custom color">'+
      '<button onclick="_scan3dPaintReset()" style="border:none;background:rgba(255,255,255,.16);color:#fff;font-size:12px;font-weight:700;padding:9px 12px;border-radius:14px;flex:0 0 auto;cursor:pointer;font-family:inherit">Reset</button>'+
    '</div>'+
    '<div id="_s3d-paint-deck" style="color:rgba(255,255,255,.45);font-size:10px;display:none">'+
      (pal.brand?pal.brand+' colors · screen preview only, confirm on the fan deck':'Screen preview only · confirm with a physical swatch')+
    '</div>'+
  '</div>';
}

// ── Photo mesh (binary PLY from the native bake) ─────────────────────────────
// Parses the exact file TdMeshBaker writes: binary little-endian, xyz float32
// + rgb uint8 per vertex, uchar-count int32 triangles. ~60 lines instead of
// three.js's examples loader, which cannot load in a no-bundler app.
function _scan3dParsePly(buf){
  const bytes=new Uint8Array(buf);
  const headEnd=(()=>{
    const probe=new TextDecoder().decode(bytes.subarray(0,Math.min(2048,bytes.length)));
    const i=probe.indexOf('end_header\n');
    return i<0?-1:i+11;
  })();
  if(headEnd<0)return null;
  const head=new TextDecoder().decode(bytes.subarray(0,headEnd));
  if(!/format binary_little_endian/.test(head))return null;
  const nV=+(head.match(/element vertex (\d+)/)||[])[1]||0;
  const nF=+(head.match(/element face (\d+)/)||[])[1]||0;
  if(!nV||!nF)return null;
  const dv=new DataView(buf);
  const pos=new Float32Array(nV*3),col=new Uint8Array(nV*3);
  let o=headEnd;
  for(let i=0;i<nV;i++){
    pos[i*3]=dv.getFloat32(o,true);pos[i*3+1]=dv.getFloat32(o+4,true);pos[i*3+2]=dv.getFloat32(o+8,true);
    col[i*3]=bytes[o+12];col[i*3+1]=bytes[o+13];col[i*3+2]=bytes[o+14];
    o+=15;
  }
  const idx=new Uint32Array(nF*3);
  for(let f=0;f<nF;f++){
    if(bytes[o]!==3)return null;      // the baker only writes triangles
    idx[f*3]=dv.getUint32(o+1,true);idx[f*3+1]=dv.getUint32(o+5,true);idx[f*3+2]=dv.getUint32(o+9,true);
    o+=13;
  }
  return {pos,col,idx,nV,nF};
}
// Which painted wall (if any) owns a world-space point: within 15 cm of the
// wall segment in plan, inside the wall's height band. Shared by both mesh
// tiers so the vertex-color and textured paints can never disagree.
function _scan3dPaintedWalls(rooms,paints){
  const painted=[];
  (rooms||[]).forEach((r,ri)=>(r.walls||[]).forEach(w=>{
    const hex=paints&&paints[_scan3dPaintKey(ri,w.id)];
    if(!hex||!w.len)return;
    painted.push({w,rgb:[parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16)]});
  }));
  return painted;
}
function _scan3dWallOwns(w,x,y,z){
  if(typeof w.ey==='number'&&Math.abs(y-w.ey)>w.h/2+0.25)return false;
  const wx=w.bx-w.ax,wz=w.bz-w.az;
  let t=((x-w.ax)*wx+(z-w.az)*wz)/(w.len*w.len);
  if(t<-0.02||t>1.02)return false;
  t=Math.max(0,Math.min(1,t));
  const dx=x-(w.ax+wx*t),dz=z-(w.az+wz*t);
  return dx*dx+dz*dz<=0.0225;           // 15 cm off the wall plane
}
// Tint the vertex-color mesh. The tint keeps the baked luminance, which is
// what makes it read as paint on THEIR wall with THEIR light, not a flood
// fill.
function _scan3dMeshTint(mesh,rooms,paints){
  const out=new Uint8Array(mesh.col);   // start from the baked colors
  const painted=_scan3dPaintedWalls(rooms,paints);
  if(!painted.length)return out;
  const pos=mesh.pos;
  for(let i=0;i<mesh.nV;i++){
    const x=pos[i*3],y=pos[i*3+1],z=pos[i*3+2];
    for(const{w,rgb} of painted){
      if(!_scan3dWallOwns(w,x,y,z))continue;
      const l=(0.299*out[i*3]+0.587*out[i*3+1]+0.114*out[i*3+2])/255;
      const k=0.35+0.85*l;              // keep their lighting in the color
      out[i*3]=Math.min(255,rgb[0]*k);out[i*3+1]=Math.min(255,rgb[1]*k);out[i*3+2]=Math.min(255,rgb[2]*k);
      break;
    }
  }
  return out;
}
// Tint the TEXTURED mesh: a per-corner multiply color over the photo. The
// photo already carries the room's light, so wall corners take the paint
// color (lifted a touch, multiply can only darken) and everything else stays
// white = untouched photo.
function _scan3dMeshTintTex(soup,rooms,paints){
  const n=soup.corners;
  const out=new Float32Array(n*3).fill(1);
  const painted=_scan3dPaintedWalls(rooms,paints);
  if(!painted.length)return out;
  for(let i=0;i<n;i++){
    const x=soup.pos[i*3],y=soup.pos[i*3+1],z=soup.pos[i*3+2];
    for(const{w,rgb} of painted){
      if(!_scan3dWallOwns(w,x,y,z))continue;
      out[i*3]=Math.min(1,rgb[0]/255*1.25);
      out[i*3+1]=Math.min(1,rgb[1]/255*1.25);
      out[i*3+2]=Math.min(1,rgb[2]/255*1.25);
      break;
    }
  }
  return out;
}
// Parses the textured mesh TdMeshBaker writes: one JSON header line, then a
// corner soup of pos xyz float32 + uv float32, grouped by texture image.
function _scan3dParseTdm(buf){
  const bytes=new Uint8Array(buf);
  let nl=-1;
  for(let i=0;i<Math.min(bytes.length,65536);i++)if(bytes[i]===10){nl=i;break;}
  if(nl<0)return null;
  let head=null;
  try{head=JSON.parse(new TextDecoder().decode(bytes.subarray(0,nl)));}catch(_e){return null;}
  if(!head||head.v!==1||!head.corners||!Array.isArray(head.groups))return null;
  const need=nl+1+head.corners*20;
  if(bytes.length<need)return null;
  const dv=new DataView(buf,nl+1);
  const pos=new Float32Array(head.corners*3),uv=new Float32Array(head.corners*2);
  for(let i=0;i<head.corners;i++){
    const o=i*20;
    pos[i*3]=dv.getFloat32(o,true);pos[i*3+1]=dv.getFloat32(o+4,true);pos[i*3+2]=dv.getFloat32(o+8,true);
    uv[i*2]=dv.getFloat32(o+12,true);uv[i*2+1]=dv.getFloat32(o+16,true);
  }
  return {corners:head.corners,pos,uv,groups:head.groups};
}
// Re-tint the loaded mesh (either tier) from the scan's saved wall colors.
function _scan3dMeshRepaint(){
  if(!_s3d||!_s3d.meshGeo)return;
  const rooms=(_s3d.sc&&_s3d.sc.rooms)||[],paints=(_s3d.sc&&_s3d.sc.wallPaint)||{};
  const attr=_s3d.meshGeo.getAttribute('color');
  if(_s3d.meshSoup){
    const tinted=_scan3dMeshTintTex(_s3d.meshSoup,rooms,paints);
    attr.array.set(tinted);
  }else if(_s3d.meshData){
    const tinted=_scan3dMeshTint(_s3d.meshData,rooms,paints);
    for(let i=0;i<tinted.length;i++)attr.array[i]=tinted[i]/255;
  }else return;
  attr.needsUpdate=true;
}
// Pull the PLY through the plugin bridge in 1 MB slices.
async function _scan3dReadMesh(path){
  const P=typeof _scanPlugin==='function'?_scanPlugin():null;
  if(!P||typeof P.readFile!=='function')return null;
  const CH=1048576;
  let first=null;
  try{first=await P.readFile({path,offset:0,length:CH});}catch(_e){return null;}
  if(!first||!first.b64)return null;
  const size=+first.size||0;
  const parts=[Uint8Array.from(atob(first.b64),c=>c.charCodeAt(0))];
  let got=parts[0].length;
  while(got<size){
    let r=null;
    try{r=await P.readFile({path,offset:got,length:CH});}catch(_e){return null;}
    if(!r||!r.b64)break;
    const u=Uint8Array.from(atob(r.b64),c=>c.charCodeAt(0));
    if(!u.length)break;
    parts.push(u);got+=u.length;
  }
  const all=new Uint8Array(got);
  let o=0;parts.forEach(p=>{all.set(p,o);o+=p.length;});
  return all.buffer;
}
// One keyframe texture, streamed through the bridge and decoded. The files
// are 12 MP stills (the record); the GPU gets a bounded copy, because thirty
// charts of full-res RGBA would evict the WebView. UVs are normalized, so the
// resize is free.
async function _scan3dLoadTexture(T,path){
  const buf=await _scan3dReadMesh(path);
  if(!buf)return null;
  const blob=new Blob([buf],{type:'image/jpeg'});
  try{
    if(typeof createImageBitmap==='function'){
      const bm=await createImageBitmap(blob,{resizeWidth:1280,resizeQuality:'high'});
      const t=new T.Texture(bm);t.needsUpdate=true;t.colorSpace=T.SRGBColorSpace||'';
      return t;
    }
  }catch(_e){}
  const url=URL.createObjectURL(blob);
  return new Promise(res=>{
    const img=new Image();
    img.onload=()=>{const t=new T.Texture(img);t.needsUpdate=true;t.colorSpace=T.SRGBColorSpace||'';res(t);};
    img.onerror=()=>{URL.revokeObjectURL(url);res(null);};
    img.src=url;
  });
}
// The Photo pill: swap the parametric dollhouse for the photoreal mesh, and
// back. Prefers the TEXTURED tier (every triangle mapped into the keyframe
// photo that saw it best); vertex colors are the fallback for scans baked
// before textures existed. Loads once, then it is an instant toggle.
async function _scan3dToggleMesh(){
  if(!_s3d||!_s3d.T)return;
  const T=_s3d.T,btn=document.getElementById('_s3d-mesh-btn');
  if(_s3d.meshG){
    const showMesh=!_s3d.meshG.visible;
    _s3d.meshG.visible=showMesh;
    if(_s3d.model)_s3d.model.visible=!showMesh;
    if(btn)btn.style.opacity=showMesh?'1':'0.7';
    return;
  }
  if(_s3d.meshLoading)return;
  _s3d.meshLoading=true;
  if(btn)btn.textContent='Loading…';
  const fail=()=>{
    _s3d.meshLoading=false;
    if(btn){btn.textContent='Photo';btn.style.opacity='0.4';btn.disabled=true;}
    if(typeof showToast==='function')showToast('Photo mesh lives on the phone that scanned it','📐');
  };
  let mesh=null;
  if(_s3d.sc&&_s3d.sc.meshTex){
    const buf=await _scan3dReadMesh(_s3d.sc.meshTex);
    if(!_s3d)return;
    const soup=buf&&_scan3dParseTdm(buf);
    if(soup){
      const geo=new T.BufferGeometry();
      geo.setAttribute('position',new T.BufferAttribute(soup.pos,3));
      geo.setAttribute('uv',new T.BufferAttribute(soup.uv,2));
      geo.setAttribute('color',new T.BufferAttribute(new Float32Array(soup.corners*3).fill(1),3));
      const mats=[];
      for(let gi=0;gi<soup.groups.length;gi++){
        const grp=soup.groups[gi];
        geo.addGroup(grp.start,grp.count,gi);
        const tex=grp.img?await _scan3dLoadTexture(T,grp.img):null;
        if(!_s3d)return;
        // The baked exposure gain levels this chart against its neighbors,
        // so a frame metered on a window does not leave a dark patch.
        const g=typeof grp.gain==='number'?Math.max(0.5,Math.min(1.6,grp.gain)):1;
        mats.push(tex
          ?new T.MeshBasicMaterial({map:tex,vertexColors:true,side:T.DoubleSide,color:new T.Color(g,g,g)})
          :new T.MeshBasicMaterial({color:0x9AA0A6,vertexColors:true,side:T.DoubleSide}));
      }
      _s3d.meshSoup=soup;_s3d.meshGeo=geo;
      _scan3dMeshRepaint();
      mesh=new T.Mesh(geo,mats);
    }
  }
  if(!mesh&&_s3d.sc&&_s3d.sc.meshPly){
    const buf=await _scan3dReadMesh(_s3d.sc.meshPly);
    if(!_s3d)return;
    const data=buf&&_scan3dParsePly(buf);
    if(data){
      const geo=new T.BufferGeometry();
      geo.setAttribute('position',new T.BufferAttribute(data.pos,3));
      geo.setAttribute('color',new T.BufferAttribute(new Float32Array(data.nV*3),3));
      geo.setIndex(new T.BufferAttribute(data.idx,1));
      _s3d.meshData=data;_s3d.meshGeo=geo;
      _scan3dMeshRepaint();               // fills the color attribute, painted or not
      mesh=new T.Mesh(geo,new T.MeshBasicMaterial({vertexColors:true,side:T.DoubleSide}));
    }
  }
  if(!mesh){fail();return;}
  _s3d.meshLoading=false;
  const g=new T.Group();g.add(mesh);
  // Same recenter as the parametric model so the orbit target matches.
  if(_s3d.modelOffset)g.position.copy(_s3d.modelOffset);
  _s3d.scene.add(g);
  _s3d.meshG=g;
  if(_s3d.model)_s3d.model.visible=false;
  if(btn){btn.textContent='Photo';btn.style.opacity='1';}
}

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
      '<div style="color:rgba(255,255,255,.55);font-size:11px;font-weight:600">Drag to orbit · pinch or scroll to zoom'+((sc.walk||[]).length?' · tap a spot for its photo':'')+'</div>'+
      _scan3dPaintStripHtml()+
      '<div style="display:flex;gap:8px">'+
        '<button id="_s3d-paint-btn" onclick="_scan3dTogglePaint()" style="pointer-events:auto;opacity:0.7;border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.12);color:#fff;font-size:13px;font-weight:800;padding:10px 18px;border-radius:20px;cursor:pointer;font-family:inherit">🎨 Paint</button>'+
        ((sc.rooms||[]).some(r=>(r.objects||[]).length)?'<button id="_s3d-furn-btn" onclick="_scan3dToggleFurn()" style="pointer-events:auto;border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.12);color:#fff;font-size:13px;font-weight:800;padding:10px 18px;border-radius:20px;cursor:pointer;font-family:inherit">Furniture</button>':'')+
        ((sc.meshTex||sc.meshPly)&&typeof _scanPlugin==='function'&&_scanPlugin()?'<button id="_s3d-mesh-btn" onclick="_scan3dToggleMesh()" style="pointer-events:auto;opacity:0.7;border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.12);color:#fff;font-size:13px;font-weight:800;padding:10px 18px;border-radius:20px;cursor:pointer;font-family:inherit">Photo</button>':'')+
        (sc.usdz&&typeof _scanPlugin==='function'&&_scanPlugin()?'<button onclick="_scanViewUsdz(\''+sc.id+'\')" style="pointer-events:auto;border:none;background:rgba(255,255,255,.92);color:#181714;font-size:13px;font-weight:800;padding:10px 18px;border-radius:20px;cursor:pointer;font-family:inherit">Walk it in AR</button>':'')+
      '</div>'+
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
  // Every wall gets its OWN material so paint mode can color one at a time;
  // wallBase is what Reset restores.
  const WALL_BASE=0xEDEAE3;
  _s3d.wallBase='#EDEAE3';
  _s3d.walls=[];
  _s3d.sc=sc;_s3d.T=T;
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
      // Slabs tint by what the room IS (the same palette as the 2D sheet), so
      // the two views read as one document. Index palette is the fallback.
      const tint=(typeof _scanRoomTint==='function')?parseInt(_scanRoomTint(r.label).slice(1),16):floorCols[ri%floorCols.length];
      const m=new T.Mesh(g,new T.MeshStandardMaterial({color:tint,roughness:0.95}));
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
      // Own material per wall: paint mode colors one wall without repainting
      // the house. Saved client picks (sc.wallPaint) restore on open.
      const key=_scan3dPaintKey(ri,w.id);
      const saved=sc.wallPaint&&sc.wallPaint[key];
      const m=new T.Mesh(g,new T.MeshStandardMaterial({color:saved?new T.Color(saved):WALL_BASE,roughness:0.9,metalness:0}));
      m.userData.wallKey=key;
      _s3d.walls.push({key,mesh:m});
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
  // Furniture: every piece the scan classified, at its measured footprint,
  // height, and the angle it really sits at. One group so the layer pill can
  // blink it off. Added before the bounds so the camera frames a staged house.
  const furn=new T.Group();
  (sc.rooms||[]).forEach(r=>{
    const y0=lvlY(r.story);
    (r.objects||[]).forEach(ob=>{
      if(!ob||!(ob.w>0))return;
      const g=new T.Group();
      _scan3dFurnSpec(ob.cat,ob.w,ob.d||ob.w,ob.h||0).forEach(p=>{
        const geo=p.shape==='cyl'
          ?new T.CylinderGeometry(Math.max(.02,p.r),Math.max(.02,p.r),Math.max(.02,p.h),20)
          :new T.BoxGeometry(Math.max(.02,p.w),Math.max(.02,p.h),Math.max(.02,p.d));
        const mesh=new T.Mesh(geo,new T.MeshStandardMaterial({color:p.col,roughness:.85,metalness:0}));
        mesh.position.set(p.x,p.y,p.z);
        mesh.castShadow=true;mesh.receiveShadow=true;
        g.add(mesh);
      });
      // Same yaw convention as the walls: rotation.y maps local +x onto the
      // piece's world width axis (ux,uz).
      g.rotation.y=Math.atan2(-(ob.uz||0),typeof ob.ux==='number'?ob.ux:1);
      g.position.set(ob.cx,y0,ob.cz);
      furn.add(g);
    });
  });
  model.add(furn);
  _s3d.furn=furn;
  // Center the model on origin so the orbit pivots through the house.
  const bb=new T.Box3().setFromObject(model);
  const c=bb.getCenter(new T.Vector3()),size=bb.getSize(new T.Vector3());
  model.position.set(-c.x,-bb.min.y,-c.z);
  scene.add(model);
  _s3d.model=model;
  _s3d.modelOffset=model.position.clone();   // the photo mesh recenters identically
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
  // Opens high, looking DOWN into the dollhouse (Polycam's opening framing):
  // from a low angle the walls hide everything the furniture pass just added.
  const orbit={theta:Math.PI/4,phi:0.62,r:R0,cy:size.y/2};
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
  const ptrs={};let pinchD=null;let downAt=null;
  const el=renderer.domElement;
  el.addEventListener('pointerdown',e=>{ptrs[e.pointerId]={x:e.clientX,y:e.clientY};downAt={x:e.clientX,y:e.clientY};el.setPointerCapture(e.pointerId);});
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
  // A TAP (not a drag) does one of two jobs. With a swatch chosen it paints
  // the wall under the finger (the accent-wall move). Otherwise it answers
  // the detail question: raycast the spot, find the walkthrough frame that
  // saw it best, and open the ACTUAL PHOTO with a crosshair on the spot.
  el.addEventListener('pointerup',e=>{
    const wasTap=downAt&&Math.hypot(e.clientX-downAt.x,e.clientY-downAt.y)<8;
    lift(e);
    if(!wasTap||!_s3d||Object.keys(ptrs).length)return;
    const rct=el.getBoundingClientRect();
    const nx=((e.clientX-rct.left)/rct.width)*2-1;
    const ny=-(((e.clientY-rct.top)/rct.height)*2-1);
    const rc=new T.Raycaster();
    rc.setFromCamera(new T.Vector2(nx,ny),cam);
    const strip=document.getElementById('_s3d-paint-strip');
    const painting=_s3d.paintHex&&strip&&strip.style.display!=='none';
    if(painting){
      const hit=rc.intersectObjects((_s3d.walls||[]).map(w=>w.mesh),false)[0];
      if(!hit)return;
      hit.object.material.color.set(_s3d.paintHex);
      _scan3dSetPaint(_s3d.sc,hit.object.userData.wallKey,_s3d.paintHex,_s3d.paintLabel||'');
      _scan3dMeshRepaint();
      return;
    }
    if(!(_s3d.sc&&(_s3d.sc.walk||[]).length)||typeof _scanBestFrame!=='function')return;
    const targets=[];
    if(_s3d.meshG&&_s3d.meshG.visible)targets.push(_s3d.meshG);
    else if(_s3d.model)targets.push(_s3d.model);
    const hit=rc.intersectObjects(targets,true).find(h=>h.object.isMesh);
    if(!hit)return;
    // Back into scan space: the groups are recentered by modelOffset.
    const off=_s3d.modelOffset||{x:0,y:0,z:0};
    const bf=_scanBestFrame(_s3d.sc,{x:hit.point.x-off.x,y:hit.point.y-off.y,z:hit.point.z-off.z});
    if(bf&&typeof _scanOpenWalk==='function')_scanOpenWalk(_s3d.sc.id,bf.i,{u:bf.u,v:bf.v});
    else if(typeof showToast==='function')showToast('No photo caught that spot','📷');
  });
  el.addEventListener('pointercancel',lift);
  el.addEventListener('wheel',e=>{e.preventDefault();orbit.r=Math.max(3,Math.min(R0*2.5,orbit.r*(1+e.deltaY*0.0012)));place();},{passive:false});
  window.addEventListener('resize',fit);
  _s3d.renderer=renderer;_s3d.scene=scene;_s3d.camera=cam;
  const loop=()=>{if(!_s3d||_s3d.renderer!==renderer)return;renderer.render(scene,cam);_s3d.raf=requestAnimationFrame(loop);};
  loop();
}
