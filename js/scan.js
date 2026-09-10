// ── TradeDesk Scanner: scan-to-estimate ──────────────────────────────────────
// The web half of TdScan (native/td-scan). The native plugin returns raw
// RoomPlan geometry (walls/doors/windows as JSON, photo files with camera
// poses, room labels, compass heading); EVERYTHING else lives here: parsing,
// the 2D floor plan, wall/floor footage, the trade lenses (paint takeoff, NEC
// outlet layout, HVAC sizing inputs), the estimate handoff, and the sellable
// floor-plan product (priced, hub-gated behind signing + paying in full).
//
// Design notes (research 2026-08-09): no contractor CRM has built-in interior
// LiDAR scanning; painters need WALL footage (every generalist tool leads with
// floor area); electricians bid by device count; NEC numbers below are the
// verified 210.52 rules with a "verify with your local AHJ" disclaimer because
// states adopt different editions. RoomPlan units are METERS, y-up; the 2D
// plan is the x/z plane.

const _SCAN_M2FT=3.280839895;
const _SCAN_LABELS=['Room','Kitchen','Living room','Dining room','Bedroom','Bathroom','Office','Hallway','Garage','Basement','Laundry','Foyer','Closet'];

// ── Parsing: CapturedRoom JSON → compact room geometry ───────────────────────
// simd types encode differently across OS versions (flat [16] or nested [4][4]
// for a matrix, [3] or {x,y,z} for a vector), so every read is defensive.
function _scanVec(v){
  if(!v)return null;
  if(Array.isArray(v))return {x:+v[0]||0,y:+v[1]||0,z:+v[2]||0};
  if(typeof v==='object')return {x:+v.x||0,y:+v.y||0,z:+v.z||0};
  return null;
}
function _scanMat(m){
  // Returns all four columns (the three axes + the translation), from a flat
  // 16-array (column-major) or nested [[..4],[..4],[..4],[..4]].
  //
  // col1 and col2 used to be thrown away, because a WALL only ever needed its
  // length direction (col0) and its centre (col3). A FLOOR polygon needs the
  // whole basis, and dropping it silently flattened every room to a line: see
  // the floor-polygon note below (owner's Aldi GUYS scan, 2026-09-10).
  if(!m)return null;
  let f=null;
  if(Array.isArray(m)&&m.length===16)f=m.map(Number);
  else if(Array.isArray(m)&&m.length===4&&Array.isArray(m[0])){f=[];m.forEach(c=>c.forEach(x=>f.push(+x)));}
  else if(m.columns){f=[];[0,1,2,3].forEach(i=>{const c=_scanVec(m.columns[i]);f.push(c.x,c.y,c.z,0);});}
  if(!f||f.length<16)return null;
  return {col0:{x:f[0],y:f[1],z:f[2]},col1:{x:f[4],y:f[5],z:f[6]},
          col2:{x:f[8],y:f[9],z:f[10]},col3:{x:f[12],y:f[13],z:f[14]}};
}
// A point in a surface's own space, put where it really is. The plan only
// wants the ground plane, so it hands back [worldX, worldZ].
function _scanToWorldXZ(m,v){
  if(!v)return null;
  if(!m)return [v.x,v.z];
  const c1=m.col1||{x:0,y:1,z:0},c2=m.col2||{x:0,y:0,z:1};
  return [m.col3.x+m.col0.x*v.x+c1.x*v.y+c2.x*v.z,
          m.col3.z+m.col0.z*v.x+c1.z*v.y+c2.z*v.z];
}
function _scanDims(d){
  // w = width (local x), h = height (local y), d = DEPTH (local z). Walls and
  // openings only ever needed w and h; a furniture footprint needs the depth.
  const v=_scanVec(d);return v?{w:Math.abs(v.x),h:Math.abs(v.y),d:Math.abs(v.z)}:{w:0,h:0,d:0};
}
// RoomPlan encodes an enum as {"sofa":{}} on some OS versions and the bare
// string "sofa" on others; a couple of builds nest it under .value.
// Swift's Codable writes an enum as a single-key object: {wall:{}}, {high:{}}.
// Every RoomPlan enum that reaches us arrives in that shape, so category,
// confidence and section label all unwrap the same way.
function _scanEnumKey(c){
  if(!c)return '';
  if(typeof c==='string')return c;
  if(typeof c==='object'){
    if(typeof c.value==='string')return c.value;
    const k=Object.keys(c);if(k.length)return k[0];
  }
  return '';
}
function _scanObjCat(c){return _scanEnumKey(c);}

// completedEdges is an OptionSet, so it can arrive as an array of names, a
// single-key object, or a raw bitfield. Normalise to names; an empty result
// means RoomPlan never told us, which is different from "no edges completed"
// and is why the caller checks length rather than trusting a count of zero.
const _SCAN_EDGE_BITS=['top','right','bottom','left'];
function _scanEdges(v){
  // A wall has four edges and they are these four. Filtering to the known
  // names is what keeps a wrapper key like {rawValue:'x'} from being read as
  // an edge that was completed, which is the difference between "RoomPlan said
  // nothing" and "RoomPlan saw the top of this wall".
  const known=n=>_SCAN_EDGE_BITS.indexOf(n)>=0;
  const bits=n=>_SCAN_EDGE_BITS.filter((_e,i)=>(n>>i)&1);
  if(!v)return [];
  if(Array.isArray(v))return v.map(_scanEnumKey).filter(known);
  if(typeof v==='number')return isFinite(v)?bits(v):[];
  if(typeof v==='object'){
    const raw=v.rawValue;
    if(typeof raw==='number')return isFinite(raw)?bits(raw):[];
    return Object.keys(v).filter(k=>v[k]&&known(k));
  }
  return [];
}

// Object attributes (iOS 17). Shape varies by category, so this flattens
// whatever arrives into plain names rather than pretending to know the schema.
function _scanAttrs(v){
  if(!v)return [];
  if(Array.isArray(v))return v.map(_scanEnumKey).filter(Boolean);
  if(typeof v==='object'){
    return Object.keys(v).map(k=>{
      const inner=_scanEnumKey(v[k]);
      return inner?(k+':'+inner):k;
    });
  }
  const one=_scanEnumKey(v);
  return one?[one]:[];
}

// RoomPlan's own confidence in a surface or an object: 'high', 'medium', 'low'
// or '' when it did not say. This is the single most useful field we were
// ignoring, because a low-confidence wall is exactly where the geometry is
// wrong and it currently feeds a load calculation in silence.
function _scanConf(v){
  const k=_scanEnumKey(v);
  return (k==='high'||k==='medium'||k==='low')?k:'';
}
// The height most of the room's wall run sits at. Weighted by wall LENGTH, so
// a two-foot soffit return cannot outvote a twelve-foot wall.
function _scanModalHeight(walls){
  const ws=(walls||[]).filter(w=>w&&w.h>0&&w.len>0);
  if(!ws.length)return 2.44;
  // Band only to GROUP walls that are the same height. The answer is the real
  // measured height of the winning band, length-weighted, never the band key:
  // rounding to the 5 cm bucket throws away up to an inch of a number the
  // whole point of this file is measuring accurately.
  const band={};
  ws.forEach(w=>{
    const k=String(Math.round(w.h*20));
    const b=band[k]||(band[k]={run:0,sum:0});
    b.run+=w.len; b.sum+=w.h*w.len;
  });
  let best=null,bestRun=-1;
  Object.keys(band).forEach(k=>{
    const b=band[k],h=b.sum/b.run;
    // Longest run wins; the taller band breaks a tie, because a room that
    // genuinely steps should read as the ceiling somebody stands under.
    if(b.run>bestRun+1e-9||(Math.abs(b.run-bestRun)<1e-9&&h>best)){best=h;bestRun=b.run;}
  });
  return best||2.44;
}

// One wall surface → {ax,az,bx,bz,len,h,id} plus openings resolved onto it.
function _scanParseRoom(rawJson,label){
  let cr=null;
  try{cr=typeof rawJson==='string'?JSON.parse(rawJson):rawJson;}catch(_e){return null;}
  if(!cr)return null;
  const walls=[],doors=[],windows=[];
  const wallById={};
  (cr.walls||[]).forEach(w=>{
    const m=_scanMat(w.transform),d=_scanDims(w.dimensions);
    if(!m||!d.w)return;
    const hx=m.col0.x*d.w/2,hz=m.col0.z*d.w/2;
    const wall={id:w.identifier||('w'+walls.length),
      ax:m.col3.x-hx,az:m.col3.z-hz,bx:m.col3.x+hx,bz:m.col3.z+hz,
      // ey = the wall's center elevation in scan world space. The photo mesh
      // lives in that same space, so painting a wall on the mesh can mask by
      // height and a floor-2 wall never tints the floor-1 wall below it.
      len:d.w,h:d.h||2.44,ey:m.col3.y||0,doors:[],windows:[],
      // RoomPlan's own verdict on this wall, and which of its edges it
      // actually saw rather than inferred. Both ride through to the plan and
      // to anything that measures off this wall.
      conf:_scanConf(w.confidence),
      edges:_scanEdges(w.completedEdges),
      // A slanted or curved wall arrives as a polygon (iOS 17). We keep it raw
      // because the squaring pass below would otherwise straighten a wall that
      // is genuinely not straight, and a bay window is not a mistake.
      poly:Array.isArray(w.polygonCorners)&&w.polygonCorners.length>2?w.polygonCorners:null};
    walls.push(wall);wallById[wall.id]=wall;
  });
  // Squaring pass (owner 2026-08-10: "we can be off by 8 inches in some
  // cases"): LiDAR tracking drifts a degree or two over a floor, and a 2
  // degree skew on a 20 ft run reads as inches of error in the dimension
  // chains. Snap BEFORE openings are placed so their offsets ride the squared
  // geometry.
  _scanSquareWalls(walls);
  const placeOpening=(o,list,isDoor,kind)=>{
    const m=_scanMat(o.transform),d=_scanDims(o.dimensions);
    if(!m||!d.w)return;
    const rec={w:d.w,h:d.h||2,area:d.w*(d.h||2),kind:kind||(isDoor?'door':'window'),
      conf:_scanConf(o.confidence),
      // Sill height above the scan's floor plane, which egress and trim both
      // need and which nothing was reading.
      sillY:(typeof m.col3.y==='number')?m.col3.y-(d.h||2)/2:null};
    // Offset along the parent wall from its A endpoint, so the electrical
    // engine knows where wall space breaks.
    const host=o.parentIdentifier&&wallById[o.parentIdentifier];
    if(host){
      const dx=m.col3.x-host.ax,dz=m.col3.z-host.az;
      const wx=host.bx-host.ax,wz=host.bz-host.az;
      const t=(dx*wx+dz*wz)/(wx*wx+wz*wz||1);
      rec.off=Math.max(0,Math.min(1,t))*host.len;
      (isDoor?host.doors:host.windows).push(rec);
    }
    list.push(rec);
  };
  (cr.doors||[]).forEach(o=>placeOpening(o,doors,true,'door'));
  // An archway breaks wall space exactly like a door, so it stays in the wall's
  // door list for the NEC engine, but it is NOT a door and must never be drawn
  // with a hinge leaf and a swing arc (owner 2026-08-10: "arches are rendering
  // as squares"). kind carries the difference through to the plan.
  (cr.openings||[]).forEach(o=>placeOpening(o,doors,true,'opening'));
  (cr.windows||[]).forEach(o=>placeOpening(o,windows,false,'window'));
  // Furniture and fixtures. RoomPlan detects these on every scan and we were
  // throwing all of it away, so a scanned bathroom drew as an empty box with
  // no toilet, tub, or vanity in it. Footprint only: center, size, and the
  // angle it sits at, which is everything a plan symbol needs.
  const objects=[];
  (cr.objects||[]).forEach(o=>{
    const m=_scanMat(o.transform),d=_scanDims(o.dimensions);
    if(!m||!d.w)return;
    const ux=m.col0.x,uz=m.col0.z;
    const ln=Math.hypot(ux,uz)||1;
    objects.push({cat:_scanObjCat(o.category),
      cx:m.col3.x,cz:m.col3.z,w:d.w,d:d.d||d.w,h:d.h||0,
      ux:ux/ln,uz:uz/ln,
      conf:_scanConf(o.confidence),
      // iOS 17 attributes separate a recessed sink from a freestanding one and
      // an L-shaped sofa from a single seat. A recessed sink is a different
      // rough-in, so this is a plumbing fact, not a drawing detail.
      attrs:_scanAttrs(o.attributes),
      // Which surface or object RoomPlan says this belongs to.
      parent:o.parentIdentifier||null});
  });
  // RoomPlan fragments one real piece into several boxes (owner screenshots
  // 2026-08-10: a corner hutch as two stacked storages, a table as two
  // overlapping slabs). Same-category boxes whose footprints overlap are one
  // piece of furniture: union them so the plan draws one clean symbol.
  _scanMergeObjects(objects);
  // Floor polygon: floors[0].polygonCorners (iOS 17) or the wall endpoints hull.
  let poly=null;
  const fl=(cr.floors||[])[0];
  if(fl&&Array.isArray(fl.polygonCorners)&&fl.polygonCorners.length>=3){
    // THROUGH THE TRANSFORM, NOT PAST IT (owner's Aldi GUYS scan, 2026-09-10:
    // a room with seven good walls came out 0 sq ft).
    //
    // This read the corner's own x and z and added the floor's translation.
    // But a RoomPlan surface is a plane in its LOCAL XY, with z as the normal,
    // and a floor is that plane turned flat: local y is what becomes world z.
    // Reading local z instead read the same 0 from every corner, so all six
    // came back on one line, the shoelace of a line is zero, and the room
    // reported no floor at all while its walls, perimeter and wall area were
    // all correct. Six corners at z = -1.9913149, every one of them.
    //
    // Putting the corner through the whole basis is right whichever local
    // plane RoomPlan used, because it is no longer a guess about which axis
    // means what.
    const fm=_scanMat(fl.transform);
    poly=fl.polygonCorners.map(p=>_scanToWorldXZ(fm,_scanVec(p))).filter(Boolean);
  }
  // NO FLOOR POLYGON. The plugin is iOS 17 only so RoomPlan normally supplies
  // one, and this fires on a partial or interrupted scan. The fallback is a
  // CONVEX hull of the wall endpoints, which fills in the notch of an L and
  // therefore overstates the floor. That error runs one way, toward a bigger
  // number on a bid, so the room is flagged rather than handed over looking
  // like any other.
  let polyFromHull=false;
  // AND A ROOM WITH WALLS NEVER REPORTS NO FLOOR. Whatever the cause, a
  // polygon that encloses nothing is not an answer, it is a failure that
  // reads like an answer: 0 sq ft on a bid is a number somebody could act
  // on. The hull overstates and says so; zero understates and says nothing.
  if(poly&&Math.abs(_scanShoelace(poly))<0.5&&walls.length>=3)poly=null;
  if(!poly){
    poly=[];walls.forEach(w=>{poly.push([w.ax,w.az]);poly.push([w.bx,w.bz]);});
    poly=_scanHull(poly);
    polyFromHull=true;
  }
  const floorM2=Math.abs(_scanShoelace(poly));
  const wallM2=walls.reduce((t,w)=>t+w.len*w.h,0);
  const openM2=doors.reduce((t,o)=>t+o.area,0)+windows.reduce((t,o)=>t+o.area,0);
  const perimM=walls.reduce((t,w)=>t+w.len,0);
  // THE MODAL HEIGHT, NOT THE TALLEST WALL. A soffit over the cabinets, a
  // bulkhead, or a dropped ceiling gives one short wall and the max reported
  // the room as if the whole ceiling were at the high side. That inflated wall
  // area on every paint bid and volume on every load calc, silently, and
  // kitchens and baths are exactly where soffits live.
  //
  // Walls are grouped to the nearest 5 cm and the tallest band wins ties, so a
  // room that genuinely steps up still reads as the taller part rather than
  // being dragged down by one short return.
  const hM=_scanModalHeight(walls);
  // RoomPlan classifies the area it scanned: bedroom, kitchen, bathroom,
  // livingRoom, diningRoom. It is a suggestion for the room name and a sanity
  // check on the fixtures found in it, never an override of what the
  // contractor typed.
  const sections=(cr.sections||[]).map(x=>({
    label:_scanEnumKey(x&&(x.label!==undefined?x.label:x.category)),
    story:(typeof (x&&x.story)==='number')?x.story:null
  })).filter(x=>x.label);
  return {label:label||'Room',walls,poly,objects,floorM2,wallM2,openM2,perimM,hM,
          sections,
          // True when floorM2 came from the convex hull above, so a reader can
          // say "about" instead of quoting it.
          floorApprox:polyFromHull,
          doorN:doors.length,winN:windows.length,winM2:windows.reduce((t,o)=>t+o.area,0)};
}
function _scanObjCorners(o){
  const vx=o.ux,vz=o.uz,px=-vz,pz=vx,hw=o.w/2,hd=o.d/2;
  return [[o.cx+vx*hw+px*hd,o.cz+vz*hw+pz*hd],[o.cx-vx*hw+px*hd,o.cz-vz*hw+pz*hd],
          [o.cx-vx*hw-px*hd,o.cz-vz*hw-pz*hd],[o.cx+vx*hw-px*hd,o.cz+vz*hw-pz*hd]];
}
// Oriented-rectangle overlap via separating axes: the two footprints overlap
// unless some axis of either box separates them.
function _scanObbOverlap(a,b){
  const axes=[[a.ux,a.uz],[-a.uz,a.ux],[b.ux,b.uz],[-b.uz,b.ux]];
  const ca=_scanObjCorners(a),cb=_scanObjCorners(b);
  for(let k=0;k<axes.length;k++){
    const x=axes[k][0],z=axes[k][1];
    const pa=ca.map(c=>c[0]*x+c[1]*z),pb=cb.map(c=>c[0]*x+c[1]*z);
    if(Math.max(...pa)<Math.min(...pb)||Math.max(...pb)<Math.min(...pa))return false;
  }
  return true;
}
// Union overlapping same-category boxes into one, in the bigger fragment's
// orientation, spanning both footprints. Loops until nothing merges (a table
// split three ways collapses in two passes).
function _scanMergeObjects(objects){
  if(!Array.isArray(objects))return objects;
  let merged=true;
  while(merged&&objects.length>1){
    merged=false;
    outer:
    for(let i=0;i<objects.length;i++)for(let j=i+1;j<objects.length;j++){
      const a=objects[i],b=objects[j];
      if(a.cat!==b.cat||!_scanObbOverlap(a,b))continue;
      const big=(a.w*a.d>=b.w*b.d)?a:b;
      const ux=big.ux,uz=big.uz,px=-uz,pz=ux;
      const pts=_scanObjCorners(a).concat(_scanObjCorners(b));
      let minU=1/0,maxU=-1/0,minV=1/0,maxV=-1/0;
      pts.forEach(c=>{const u=c[0]*ux+c[1]*uz,v=c[0]*px+c[1]*pz;
        if(u<minU)minU=u;if(u>maxU)maxU=u;if(v<minV)minV=v;if(v>maxV)maxV=v;});
      const cu=(minU+maxU)/2,cv=(minV+maxV)/2;
      objects[i]={cat:a.cat,cx:ux*cu+px*cv,cz:uz*cu+pz*cv,
        w:maxU-minU,d:maxV-minV,h:Math.max(a.h,b.h),ux,uz};
      objects.splice(j,1);merged=true;break outer;
    }
  }
  return objects;
}
// Bleed-through guard (owner screenshots 2026-08-10: scanning boxed part of
// the NEXT room through an archway/doorway). Where two rooms on one floor
// claim the same floor area, the room walked LATER owns it, that walk was
// dedicated to the space, and the earlier room's bleed lobe gives it up.
// Numbers only, grid-sampled at 5 cm (no fragile polygon boolean code); the
// captured polygons are untouched and the original area is kept in
// floorRawM2 so the pass is idempotent across re-saves and merges.
function _scanPtInPoly(px,pz,poly){
  let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const xi=poly[i][0],zi=poly[i][1],xj=poly[j][0],zj=poly[j][1];
    if(((zi>pz)!==(zj>pz))&&(px<(xj-xi)*(pz-zi)/(zj-zi)+xi))inside=!inside;
  }
  return inside;
}
function _scanDedupeFloors(rooms){
  if(!Array.isArray(rooms)||rooms.length<2)return;
  const G=0.05,SLIVER=0.15; // ignore hairline shared-wall overlaps
  const bbox=r=>{let x0=1/0,x1=-1/0,z0=1/0,z1=-1/0;
    r.poly.forEach(p=>{if(p[0]<x0)x0=p[0];if(p[0]>x1)x1=p[0];if(p[1]<z0)z0=p[1];if(p[1]>z1)z1=p[1];});
    return {x0,x1,z0,z1};};
  rooms.forEach(r=>{if(r&&r.floorRawM2==null&&typeof r.floorM2==='number')r.floorRawM2=r.floorM2;});
  for(let i=0;i<rooms.length;i++){
    const a=rooms[i];
    if(!a||!Array.isArray(a.poly)||a.poly.length<3||typeof a.floorRawM2!=='number')continue;
    const ba=bbox(a);let lost=0;
    for(let j=i+1;j<rooms.length;j++){
      const b=rooms[j];
      if(!b||!Array.isArray(b.poly)||b.poly.length<3)continue;
      if((a.story||1)!==(b.story||1))continue;
      const bb=bbox(b);
      const x0=Math.max(ba.x0,bb.x0),x1=Math.min(ba.x1,bb.x1);
      const z0=Math.max(ba.z0,bb.z0),z1=Math.min(ba.z1,bb.z1);
      if(x0>=x1||z0>=z1)continue;
      let cells=0;
      for(let x=x0+G/2;x<x1;x+=G)for(let z=z0+G/2;z<z1;z+=G){
        if(_scanPtInPoly(x,z,a.poly)&&_scanPtInPoly(x,z,b.poly))cells++;
      }
      const m2=cells*G*G;
      if(m2>SLIVER)lost+=m2;
    }
    a.floorM2=Math.max(0,a.floorRawM2-lost);
  }
}
// ── Pin partition: one continuous motion (owner 2026-08-10) ─────────────────
// "While walking each room I want to drop a pin in it to name it and keep
// scanning... one continuous motion." The capture returns ONE merged room per
// floor plus the pins; this splits that floor back into per-room entries so
// every downstream consumer (lenses, rename, tints, 3D paint) works
// unchanged. Method: rasterize the floor at 10 cm, block cells on walls,
// flood-fill from each pin (walls stop the fill, so rooms end at their real
// boundaries), then clip walls to each region's span and deal objects by
// where they stand.
function _scanPartitionFloor(r,ps){
  if(!r||!Array.isArray(r.poly)||r.poly.length<3||!Array.isArray(ps)||ps.length<2)return [r];
  const G=0.1,BLOCK=0.09,OFF=0.16;
  let x0=1/0,x1=-1/0,z0=1/0,z1=-1/0;
  r.poly.forEach(p=>{if(p[0]<x0)x0=p[0];if(p[0]>x1)x1=p[0];if(p[1]<z0)z0=p[1];if(p[1]>z1)z1=p[1];});
  x0-=G;z0-=G;x1+=G;z1+=G;
  const NX=Math.max(2,Math.ceil((x1-x0)/G)),NZ=Math.max(2,Math.ceil((z1-z0)/G));
  if(NX*NZ>1440000)return [r]; // >120 m per side: bail to the merged floor
  const idx=(i,j)=>j*NX+i;
  const owner=new Int16Array(NX*NZ).fill(-1); // -1 free, -2 blocked/outside, >=0 pin
  const segs=(r.walls||[]).map(w=>[w.ax,w.az,w.bx,w.bz]);
  const distSeg=(px,pz,s)=>{const ax=s[0],az=s[1],bx=s[2],bz=s[3];
    const dx=bx-ax,dz=bz-az,L2=dx*dx+dz*dz||1e-9;
    let t=((px-ax)*dx+(pz-az)*dz)/L2;t=t<0?0:(t>1?1:t);
    return Math.hypot(px-(ax+dx*t),pz-(az+dz*t));};
  for(let j=0;j<NZ;j++)for(let i=0;i<NX;i++){
    const px=x0+(i+0.5)*G,pz=z0+(j+0.5)*G;
    if(!_scanPtInPoly(px,pz,r.poly)){owner[idx(i,j)]=-2;continue;}
    for(let k=0;k<segs.length;k++){if(distSeg(px,pz,segs[k])<BLOCK){owner[idx(i,j)]=-2;break;}}
  }
  // Seed each pin at the nearest free cell (a pin dropped against a wall or a
  // hair outside the mapped floor still lands in its room).
  const q=[];
  ps.forEach((p,pi)=>{
    const ci=Math.floor((p.x-x0)/G),cj=Math.floor((p.z-z0)/G);
    let best=-1,bd=1/0;
    for(let dj=-15;dj<=15;dj++)for(let di=-15;di<=15;di++){
      const i2=ci+di,j2=cj+dj;
      if(i2<0||j2<0||i2>=NX||j2>=NZ)continue;
      if(owner[idx(i2,j2)]!==-1)continue;
      const d=di*di+dj*dj;
      if(d<bd){bd=d;best=idx(i2,j2);}
    }
    if(best>=0){owner[best]=pi;q.push(best);}
  });
  let head=0;
  while(head<q.length){
    const c=q[head++],ci=c%NX,cj=(c/NX)|0,o=owner[c];
    if(ci+1<NX&&owner[c+1]===-1){owner[c+1]=o;q.push(c+1);}
    if(ci>0&&owner[c-1]===-1){owner[c-1]=o;q.push(c-1);}
    if(cj+1<NZ&&owner[c+NX]===-1){owner[c+NX]=o;q.push(c+NX);}
    if(cj>0&&owner[c-NX]===-1){owner[c-NX]=o;q.push(c-NX);}
  }
  // Walled-off pockets no fill reached: nearest pin as the crow flies.
  for(let j=0;j<NZ;j++)for(let i=0;i<NX;i++){
    const k=idx(i,j);if(owner[k]!==-1)continue;
    const px=x0+(i+0.5)*G,pz=z0+(j+0.5)*G;
    let bi=0,bd=1/0;
    ps.forEach((p,pi)=>{const d=(p.x-px)*(p.x-px)+(p.z-pz)*(p.z-pz);if(d<bd){bd=d;bi=pi;}});
    owner[k]=bi;
  }
  const ownerAt=(x,z)=>{
    const i2=Math.floor((x-x0)/G),j2=Math.floor((z-z0)/G);
    if(i2>=0&&j2>=0&&i2<NX&&j2<NZ&&owner[idx(i2,j2)]>=0)return owner[idx(i2,j2)];
    let bi=0,bd=1/0;
    ps.forEach((p,pi)=>{const d=(p.x-x)*(p.x-x)+(p.z-z)*(p.z-z);if(d<bd){bd=d;bi=pi;}});
    return bi;
  };
  // Region outline: directed boundary edges of the cell mask chained into the
  // longest loop, collinear runs merged. Grid-step staircases are invisible
  // at plan scale and the areas come from the cells, not this outline.
  const outline=(pi)=>{
    const starts=new Map();
    const key=(x,z)=>(Math.round(x*1000))+','+(Math.round(z*1000));
    const is=(i,j)=>i>=0&&j>=0&&i<NX&&j<NZ&&owner[idx(i,j)]===pi;
    for(let j=0;j<NZ;j++)for(let i=0;i<NX;i++){
      if(!is(i,j))continue;
      const xa=x0+i*G,za=z0+j*G,xb=xa+G,zb=za+G;
      if(!is(i,j-1))starts.set(key(xa,za),[xb,za]);
      if(!is(i+1,j))starts.set(key(xb,za),[xb,zb]);
      if(!is(i,j+1))starts.set(key(xb,zb),[xa,zb]);
      if(!is(i-1,j))starts.set(key(xa,za+G),[xa,za]);
    }
    let bestLoop=null;
    const used=new Set();
    for(const k0 of starts.keys()){
      if(used.has(k0))continue;
      const loop=[];let k=k0;
      while(starts.has(k)&&!used.has(k)){
        used.add(k);
        const pt=k.split(',').map(v=>+v/1000);
        loop.push(pt);
        const nxt=starts.get(k);
        k=key(nxt[0],nxt[1]);
      }
      if(loop.length>2&&(!bestLoop||loop.length>bestLoop.length))bestLoop=loop;
    }
    if(!bestLoop)return null;
    const out=[];
    for(let i=0;i<bestLoop.length;i++){
      const a=bestLoop[(i+bestLoop.length-1)%bestLoop.length],b=bestLoop[i],c=bestLoop[(i+1)%bestLoop.length];
      const colin=Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))<1e-9;
      if(!colin)out.push(b);
    }
    return out.length>=3?out:bestLoop;
  };
  const out=ps.map((p,pi)=>{
    let cells=0;
    for(let k=0;k<owner.length;k++)if(owner[k]===pi)cells++;
    const walls=[];
    (r.walls||[]).forEach(w=>{
      const dx=w.bx-w.ax,dz=w.bz-w.az,L=w.len||Math.hypot(dx,dz)||1;
      const nx=-dz/L,nz=dx/L,n=Math.max(2,Math.ceil(L/0.2));
      const own=[];
      for(let s=0;s<=n;s++){
        const t=s/n,mx=w.ax+dx*t,mz=w.az+dz*t;
        let hit=false;
        for(const sgn of[1,-1]){
          const i2=Math.floor((mx+nx*OFF*sgn-x0)/G),j2=Math.floor((mz+nz*OFF*sgn-z0)/G);
          if(i2>=0&&j2>=0&&i2<NX&&j2<NZ&&owner[idx(i2,j2)]===pi){hit=true;break;}
        }
        own.push(hit);
      }
      // Contiguous owned runs become this room's sub-walls: a wall that spans
      // several rooms (one long exterior run) is CLIPPED to each room's part,
      // so wall footage is honest per room. Openings ride the run they sit in.
      let s0=-1;
      for(let s=0;s<=n+1;s++){
        const v=s<=n&&own[s];
        if(v&&s0<0)s0=s;
        if(!v&&s0>=0){
          const t0=s0/n,t1=(s-1)/n,len=(t1-t0)*L;
          if(len>=0.3){
            const off0=t0*L;
            const clipOpen=list=>list.filter(d=>d.off==null||(d.off>=off0-0.1&&d.off<=t1*L+0.1))
              .map(d=>({...d,off:d.off!=null?Math.max(0,d.off-off0):d.off}));
            walls.push({id:w.id+':'+pi+':'+s0,
              ax:w.ax+dx*t0,az:w.az+dz*t0,bx:w.ax+dx*t1,bz:w.az+dz*t1,
              len,h:w.h,ey:w.ey,doors:clipOpen(w.doors||[]),windows:clipOpen(w.windows||[])});
          }
          s0=-1;
        }
      }
    });
    const objects=(r.objects||[]).filter(o=>ownerAt(o.cx,o.cz)===pi).map(o=>({...o}));
    const doors=walls.flatMap(w=>w.doors),wins=walls.flatMap(w=>w.windows);
    return {label:p.name||('Room '+(pi+1)),walls,poly:outline(pi)||r.poly,objects,
      floorM2:cells*G*G,floorRawM2:cells*G*G,
      wallM2:walls.reduce((t,w)=>t+w.len*w.h,0),
      openM2:doors.reduce((t,o)=>t+o.area,0)+wins.reduce((t,o)=>t+o.area,0),
      perimM:walls.reduce((t,w)=>t+w.len,0),
      hM:walls.length?Math.max(...walls.map(w=>w.h)):(r.hM||2.44),
      doorN:doors.length,winN:wins.length,winM2:wins.reduce((t,o)=>t+o.area,0),
      pin:{x:p.x,z:p.z}};
  }).filter(rm=>rm.floorM2>0.5); // a pin that owned nothing drops out
  return out.length?out:[r];
}
// Expand pin-mode floor segments into per-room entries. Segments without pins
// (old builds, a floor the user never pinned) pass through untouched; one pin
// just names the whole floor.
function _scanExpandPins(rooms,pins){
  if(!Array.isArray(pins)||!pins.length)return rooms;
  const out=[];
  (rooms||[]).forEach(r=>{
    const st=Math.max(1,+r.story||1);
    const ps=pins.filter(p=>Math.max(1,+p.story||1)===st);
    if(!ps.length){out.push(r);return;}
    if(ps.length===1){r.label=ps[0].name||r.label;out.push(r);return;}
    _scanPartitionFloor(r,ps).forEach(part=>{part.story=st;out.push(part);});
  });
  return out;
}
// Manhattan squaring: find the room's dominant grid direction (length-weighted
// mean of wall angles folded modulo 90 degrees, the fold-by-4 trick) and
// rotate every wall within 6 degrees of a grid axis onto it, about its own
// center, length untouched. Real angled walls (bays, 45s) deviate far more
// than drift ever does and are left alone.
function _scanSquareWalls(walls){
  if(!Array.isArray(walls)||walls.length<2)return;
  let sx=0,sy=0;
  walls.forEach(w=>{const a=Math.atan2(w.bz-w.az,w.bx-w.ax);sx+=Math.cos(a*4)*w.len;sy+=Math.sin(a*4)*w.len;});
  if(!sx&&!sy)return;
  const theta=Math.atan2(sy,sx)/4;
  const SNAP=6*Math.PI/180,Q=Math.PI/2;
  walls.forEach(w=>{
    // A wall RoomPlan handed us as a polygon is genuinely not a rectangle.
    // Nudging its chord while the polygon stays raw makes the two disagree,
    // so it is left exactly as captured. (The 6 degree gate below already
    // spares a real 45: this is about the shape, not the angle.)
    if(w.poly)return;
    const a=Math.atan2(w.bz-w.az,w.bx-w.ax);
    let d=a-theta;d-=Math.round(d/Q)*Q;
    if(Math.abs(d)>SNAP)return;
    const sa=a-d,cx=(w.ax+w.bx)/2,cz=(w.az+w.bz)/2,h=w.len/2;
    w.ax=cx-Math.cos(sa)*h;w.az=cz-Math.sin(sa)*h;
    w.bx=cx+Math.cos(sa)*h;w.bz=cz+Math.sin(sa)*h;
  });
}
function _scanShoelace(poly){
  let a=0;for(let i=0;i<poly.length;i++){const[x1,z1]=poly[i],[x2,z2]=poly[(i+1)%poly.length];a+=x1*z2-x2*z1;}
  return a/2;
}
function _scanHull(pts){
  // Monotone chain; enough to bound wall endpoints into a floor outline when
  // polygonCorners is absent (iOS 16 rooms).
  if(pts.length<3)return pts;
  const p=pts.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
  const lo=[];for(const q of p){while(lo.length>=2&&cross(lo[lo.length-2],lo[lo.length-1],q)<=0)lo.pop();lo.push(q);}
  const hi=[];for(let i=p.length-1;i>=0;i--){const q=p[i];while(hi.length>=2&&cross(hi[hi.length-2],hi[hi.length-1],q)<=0)hi.pop();hi.push(q);}
  lo.pop();hi.pop();return lo.concat(hi);
}
const _scanFt=m=>m*_SCAN_M2FT;
const _scanSqFt=m2=>m2*_SCAN_M2FT*_SCAN_M2FT;
function _scanFtIn(m){
  const ft=_scanFt(m);const f=Math.floor(ft);const i=Math.round((ft-f)*12);
  return i===12?(f+1)+"'0\"":f+"'"+i+'"';
}

// ── Store ────────────────────────────────────────────────────────────────────
// td_scans rides the sync fabric like every other account record (§7.3): one
// _TD_TABLES entry in cloud.js, saveAll persists, sweep/cache/reset for free.
function getScans(){return (typeof scans!=='undefined'&&scans)||[];}
function saveScan(sc){
  if(!sc)return null;
  if(!sc.id)sc.id=(typeof _newId==='function'?_newId():String(Date.now()));
  const i=getScans().findIndex(x=>String(x.id)===String(sc.id));
  if(i>-1)scans[i]=sc;else scans.push(sc);
  if(typeof saveAll==='function')saveAll();
  // The hub snapshot carries this client's scans (locked or unlocked), so any
  // scan change refreshes it; the content hash inside upload dedupes no-ops.
  if(sc.clientId&&typeof _uploadClientHub==='function'){try{_uploadClientHub(sc.clientId).catch(()=>{});}catch(_e){}}
  return sc;
}
function deleteScan(id){
  const i=getScans().findIndex(x=>String(x.id)===String(id));
  if(i>-1){
    const cid=scans[i].clientId;
    scans.splice(i,1);if(typeof saveAll==='function')saveAll();
    if(cid&&typeof _uploadClientHub==='function'){try{_uploadClientHub(cid).catch(()=>{});}catch(_e){}}
  }
}
// The hub deliverable is unlocked by (a) the standalone floor-plan purchase, or
// (b) the booked job's bill hitting zero balance, signed AND 100% paid, not
// the deposit (owner call 2026-08-09). `purchasedAt` records path (a); path
// (b) derives live from the bid model, where signing and payments actually
// live: a linked bid if the scan has one, else any of the client's signed
// Closed Won bids with real money on it and nothing left owed.
function scanUnlocked(sc){
  if(!sc)return false;
  if(sc.purchasedAt)return true;
  if(typeof bids==='undefined'||typeof getBidBalance!=='function')return false;
  try{
    const paidInFull=b=>b&&b.signedAt&&(b.amount||0)>0&&getBidBalance(b)<=0;
    if(sc.bidId){
      const b=bids.find(x=>String(x.id)===String(sc.bidId));
      return paidInFull(b);
    }
    if(sc.clientId){
      return bids.some(b=>String(b.client_id)===String(sc.clientId)&&b.status==='Closed Won'&&paidInFull(b));
    }
  }catch(_e){}
  return false;
}

// ── Trade lenses ─────────────────────────────────────────────────────────────
// ONE lens per trade, and you only see YOUR trade's (owner 2026-08-10: "other
// trades shouldn't be visible unless I'm writing things under that trade, hvac
// shouldn't show for painters and neither should electrical and vice versa").
//
// The gate is the ACTIVE trade, not the list of trades the business works,
// because the active trade is literally what they are writing under: a
// multi-trade shop flips it in the nav switcher and the lens follows. Plan and
// 3D are the geometry and belong to everybody.
//
// A trade with no lens of its own (general, plumbing, roofing, landscaping)
// gets Plan and 3D. Showing it three takeoffs it did not ask for is the exact
// thing this rule exists to stop, and the measurements still reach the estimate.
//
// READS getActiveTrade(), not S.trade. S.trade is never assigned anywhere in
// the app: the trade lives on _config.business_type. So this function has been
// returning 'plan' for every contractor since it was written, and no painter
// has ever had the scan open on the paint takeoff.
function _scanTradeLens(){
  const t=String((typeof getActiveTrade==='function'&&getActiveTrade())||
                 (typeof _config!=='undefined'&&_config&&_config.business_type)||'').toLowerCase();
  if(/paint/.test(t))return 'paint';
  if(/electric/.test(t))return 'electrical';
  if(/hvac|heat|cool|air/.test(t))return 'hvac';
  return null;
}
function _scanDefaultLens(){ return _scanTradeLens()||'plan'; }
// The tabs this contractor gets: the geometry, plus their own trade's takeoff.
function _scanTabs(){
  const mine=_scanTradeLens();
  const tabs=[['plan','Plan'],['3d','3D']];
  if(mine==='paint')tabs.push(['paint','Paint']);
  if(mine==='electrical')tabs.push(['electrical','Electrical']);
  if(mine==='hvac')tabs.push(['hvac','HVAC']);
  return tabs;
}
// Paint numbers per room. subtractOpenings is a real choice: plenty of
// painters deliberately DON'T subtract because cutting in costs more than the
// skipped area saves (PaintTalk consensus).
function _scanPaintNumbers(room,subtractOpenings){
  const wall=room.wallM2-(subtractOpenings?room.openM2:0);
  return {
    wallSqFt:Math.round(_scanSqFt(Math.max(0,wall))),
    ceilSqFt:Math.round(_scanSqFt(room.floorM2)),
    floorSqFt:Math.round(_scanSqFt(room.floorM2)),
    wallFt:Math.round(_scanFt(room.perimM)),
    ceilHt:_scanFtIn(room.hM),
    doors:room.doorN,windows:room.winN
  };
}
// ── Electrical lens: NEC 210.52 receptacle layout ────────────────────────────
// Verified rules (research 2026-08-09, NEC 2023): no point along a wall's
// floor line more than 6 ft from a receptacle (max 12 ft between), wall
// spaces 2 ft or wider count, doorways break wall space. Corner wrap is NOT
// merged here, each wall is planned on its own, which can only ever place an
// EXTRA outlet near a corner, never miss one: conservative by construction.
// Kitchens add the counter rule (24 in / max 48 in apart) as a note, counters
// aren't in the scan geometry.
// Mounting heights for drawing a device on an elevation. These are working
// defaults for a plan symbol, not code minimums, and nothing prices off them.
const _SCAN_NEC={outletsInTypical:12,switchInTypical:48,switchInMaxCode:79};
// ── Wall spaces: ours, always available ──────────────────────────────────────
//
// Splitting a wall at its doorways is geometry. It is measurement of the
// house in front of us, it owes nothing to any book, and it answers whether
// or not anybody has bought one. Every consumer below builds on this.
//
// Returns one entry per usable stretch: {wallId, a, b, ft, ux, uz, ax, az}.
function _scanWallSpaces(room){
  const out=[];
  ((room&&room.walls)||[]).forEach(w=>{
    if(!w||!w.len)return;
    const breaks=[[0,w.len]];
    (w.doors||[]).slice().sort((a,b)=>(a.off||0)-(b.off||0)).forEach(d=>{
      const seg=breaks.pop();
      const dA=Math.max(seg[0],(d.off||0)-d.w/2),dB=Math.min(seg[1],(d.off||0)+d.w/2);
      if(dA>seg[0])breaks.push([seg[0],dA]);
      if(dB<seg[1])breaks.push([dB,seg[1]]);
      else if(dA<=seg[0])breaks.push(seg); // door outside segment, keep as-is
    });
    const ux=(w.bx-w.ax)/w.len,uz=(w.bz-w.az)/w.len;
    breaks.forEach(([a,b])=>{
      out.push({wallId:w.id,a:a,b:b,ft:_scanFt(b-a),ux:ux,uz:uz,ax:w.ax,az:w.az});
    });
  });
  return out;
}

// ── The receptacle count: the book's, and it waits for the book ──────────────
//
// The spacing distances used to live in this file as literals typed from
// memory, and they fed a priced bid line whose note cited "NEC 210.52" by
// name. A number on a contractor's bid with the code named as its authority,
// that nobody had ever read out of the code. That is exactly what codes/ was
// built to stop, and four numbers is not an exemption.
//
// So the count comes through codeEval now. No verified dataset for the
// contractor's own edition means no count, and the caller says so rather than
// filling the gap with a plausible number.
//
// Returns {ok, marks, count, reason}. `marks` is empty unless the code
// answered; the wall spaces behind them are available either way.
function _scanReceptacles(room){
  const spaces=_scanWallSpaces(room);
  const none={ok:false,marks:[],count:null,reason:'no-engine',spaces:spaces};
  if(typeof codeEval!=='function')return none;
  const r=codeEval('nec','receptacle-spacing',{wallSpaceFt:spaces.map(s=>s.ft)});
  if(!r||!r.ok)return Object.assign({},none,{reason:(r&&r.reason)||'refused',result:r});
  const per=(r.detail&&r.detail.perSpace)||[];
  const marks=[];
  spaces.forEach((sp,i)=>{
    const n=per[i]|0;
    for(let k=0;k<n;k++){
      const t=sp.a+(sp.b-sp.a)*((k+0.5)/n);
      marks.push({x:sp.ax+sp.ux*t,z:sp.az+sp.uz*t,wallId:sp.wallId});
    }
  });
  return {ok:true,marks:marks,count:r.value,reason:'',spaces:spaces,result:r};
}

// Kept for the plan layer, which only ever wanted the dots. Empty when the
// code has not answered, so nothing is drawn that cannot be defended.
function _scanOutletPlan(room){
  return _scanReceptacles(room).marks;
}

// ── What the scan found, and whether to believe it ───────────────────────────
//
// RoomPlan classifies what it sees, and until now we drew a symbol for it and
// dropped the meaning. That is the single largest thing the scanner already
// knows and never told anyone: a toilet is a drainage fixture unit, a range is
// a cooking load, a washer is both. Those are the inputs the code engines ask
// for, and the contractor was retyping them.
//
// IT PROPOSES, IT NEVER ASSERTS. RoomPlan's detection is good and not perfect,
// so every fixture below is a suggestion carrying its own confidence and a
// note when it turned up somewhere it does not belong. A phantom toilet is a
// wrong pipe size; a silently-dropped one is a missing rough-in. Both are the
// contractor's call, and the list exists so he can make it in one tap instead
// of discovering it on site.

// What each detected thing MEANS to a trade. Nothing here is a code value: it
// is the name of an input, and what that input is worth is the book's business
// (codes/README.md).
const _SCAN_FIXTURE_MEANING = {
  toilet:       { label: 'Toilet',        plumbing: 'water-closet' },
  sink:         { label: 'Sink',          plumbing: 'sink' },
  bathtub:      { label: 'Bathtub',       plumbing: 'bathtub' },
  dishwasher:   { label: 'Dishwasher',    plumbing: 'dishwasher', electrical: 'fixed-appliance' },
  washerDryer:  { label: 'Washer/dryer',  plumbing: 'clothes-washer', electrical: 'dryer' },
  stove:        { label: 'Range',         electrical: 'cooking' },
  oven:         { label: 'Oven',          electrical: 'cooking' },
  refrigerator: { label: 'Refrigerator',  electrical: 'fixed-appliance' },
  fireplace:    { label: 'Fireplace',     hvac: 'fireplace' },
  stairs:       { label: 'Stairs' }
};

// Where each one belongs. A toilet in a kitchen is a misdetection far more
// often than it is a house, so it gets asked about rather than counted.
const _SCAN_FIXTURE_ROOMS = {
  toilet:       ['bath'],
  bathtub:      ['bath'],
  stove:        ['kitchen'],
  oven:         ['kitchen'],
  dishwasher:   ['kitchen'],
  refrigerator: ['kitchen', 'garage', 'pantry'],
  sink:         ['kitchen', 'bath', 'laundry', 'utility', 'bar'],
  washerDryer:  ['laundry', 'utility', 'kitchen', 'bath', 'garage']
};

// The room's kind, in the app's own words, from three sources in order of
// authority: what the contractor typed, then RoomPlan's own classification,
// then nothing. Never invented from the fixtures, because the fixtures are
// what this is used to check.
function _scanRoomKind(room){
  const typed=String((room&&room.label)||'').toLowerCase();
  const words=['kitchen','bath','laundry','utility','garage','bedroom','living','dining','pantry','bar','office','closet'];
  for(let i=0;i<words.length;i++){ if(typed.indexOf(words[i])>=0) return {kind:words[i],from:'typed'}; }
  const sec=((room&&room.sections)||[])[0];
  if(sec&&sec.label){
    const l=String(sec.label).toLowerCase();
    // RoomPlan spells them livingRoom / diningRoom; ours are single words.
    const k=l.indexOf('bath')>=0?'bath':l.indexOf('kitchen')>=0?'kitchen':
            l.indexOf('bed')>=0?'bedroom':l.indexOf('living')>=0?'living':
            l.indexOf('dining')>=0?'dining':'';
    if(k)return {kind:k,from:'roomplan'};
  }
  return {kind:'',from:''};
}

// One room's fixtures, grouped, counted, and checked against where they are.
// Returns {kind, kindFrom, items:[...], needsReview:n}.
function _scanFixtures(room){
  const kindInfo=_scanRoomKind(room);
  const by={};
  (Array.isArray(room&&room.objects)?room.objects:[]).forEach(o=>{
    const cat=o&&o.cat;
    if(!cat||!_SCAN_FIXTURE_MEANING[cat])return;   // furniture is not a fixture
    const g=by[cat]||(by[cat]={cat:cat,n:0,confs:[],attrs:[]});
    g.n++;
    if(o.conf)g.confs.push(o.conf);
    (o.attrs||[]).forEach(a=>{ if(g.attrs.indexOf(a)<0)g.attrs.push(a); });
  });

  const items=Object.keys(by).map(cat=>{
    const g=by[cat],meaning=_SCAN_FIXTURE_MEANING[cat];
    // The weakest sighting sets the group's confidence: one shaky toilet among
    // three is still a reason to look.
    const conf=g.confs.indexOf('low')>=0?'low':g.confs.indexOf('medium')>=0?'medium':
               (g.confs.length?'high':'');
    const belongs=_SCAN_FIXTURE_ROOMS[cat];
    // Out of place only counts as a question when we actually know the room.
    const misplaced=!!(belongs&&kindInfo.kind&&belongs.indexOf(kindInfo.kind)<0);
    return {
      cat:cat, label:meaning.label, n:g.n, conf:conf, attrs:g.attrs,
      plumbing:meaning.plumbing||'', electrical:meaning.electrical||'', hvac:meaning.hvac||'',
      misplaced:misplaced,
      // Anything worth a second look says why, in words the contractor reads.
      ask: misplaced ? (meaning.label+' found in a room called '+(room.label||'this room')+'. Confirm it is really there.')
         : conf==='low' ? ('The scanner was not confident about this '+meaning.label.toLowerCase()+'.')
         : ''
    };
  }).sort((a,b)=>a.label.localeCompare(b.label));

  return {
    kind:kindInfo.kind, kindFrom:kindInfo.from,
    items:items,
    needsReview:items.filter(x=>x.ask).length
  };
}

// Every fixture in a scan, rolled up per trade, ready to be handed to a code
// engine as inputs. Counts only: what a water closet is WORTH in fixture units
// is 709.1 and waits for the book, exactly like the receptacle spacing does.
function _scanFixtureTotals(scan){
  const rooms=Array.isArray(scan&&scan.rooms)?scan.rooms:[];
  const out={plumbing:{},electrical:{},hvac:{},needsReview:0};
  rooms.forEach(r=>{
    const f=_scanFixtures(r);
    out.needsReview+=f.needsReview;
    f.items.forEach(it=>{
      ['plumbing','electrical','hvac'].forEach(trade=>{
        const key=it[trade];
        if(!key)return;
        out[trade][key]=(out[trade][key]||0)+it.n;
      });
    });
  });
  return out;
}

function _scanElectricalNumbers(room){
  const rec=_scanReceptacles(room);
  const label=String(room.label||'');
  // The GFCI list is the book's too, and it refuses the same way.
  let gfci=null;
  if(typeof codeEval==='function'){
    const g=codeEval('nec','gfci-required',{roomName:label});
    if(g&&g.ok)gfci=!!g.value;
  }
  return {
    // null, never 0: "the code has not been loaded" and "this room needs no
    // receptacles" are different answers and the caller has to tell them apart.
    outlets:rec.ok?rec.count:null,
    outletsReason:rec.reason,
    marks:rec.marks,
    // Wall spaces are measurement and are always here, so a room can show
    // "22 ft of wall in 3 spaces" even when nothing may state a count.
    wallSpaces:rec.spaces,
    wallSpaceFt:Math.round(rec.spaces.reduce((t,s)=>t+s.ft,0)),
    // Not a code number: one switch per way in, which is how the trade wires
    // it. Nothing here claims 210.52 and nothing prices off a book.
    switches:1+(room.doorN>1?room.doorN-1:0),
    gfci:gfci,
    kitchenCounterNote:/kitchen/i.test(label)
  };
}
// ── HVAC lens: sizing inputs + infiltration from ACH50 ───────────────────────
// The scan supplies the geometry half of a Manual J (volumes, wall/window
// areas); infiltration uses the blower door number directly (MJ8 prefers a
// measured ACH50 over its tight/average/loose defaults). Sensible
// 1.1×CFM×ΔT, latent 0.68×CFM×Δgrains. This is a SIZING ESTIMATE, not a
// permit document: permit-grade Manual J reports typically require
// ACCA-approved software, and the UI says so.
const _SCAN_ACH50_PRESETS={leaky:10,average:7,tight:3,'code-2021':3};
function _scanHvacNumbers(room,opts){
  const o=opts||{};
  const ach50=+o.ach50||_SCAN_ACH50_PRESETS[o.preset||'average']||7;
  const nFactor=+o.nFactor||18;                 // LBL ballpark, single-story sheltered
  const dT=+o.deltaT||45;                        // winter design ΔT default
  const dGr=+o.deltaGrains||30;
  const volFt3=_scanSqFt(room.floorM2)*_scanFt(room.hM);
  const achNat=ach50/nFactor;
  const cfm=achNat*volFt3/60;
  return {
    volFt3:Math.round(volFt3),
    winSqFt:Math.round(_scanSqFt(room.winM2)),
    achNat:Math.round(achNat*100)/100,
    infiltSensBtuh:Math.round(1.1*cfm*dT),
    infiltLatBtuh:Math.round(0.68*cfm*dGr)
  };
}

// ── Furniture and fixture plan symbols ───────────────────────────────────────
// RoomPlan classifies what it sees (bed, sofa, toilet, stove...) and we drew
// none of it, so a scanned bathroom came out as an empty rectangle. Every
// symbol below is drawn to the plan convention for that piece, in the object's
// OWN frame: the caller wraps this in a translate+rotate, so a sofa at 37
// degrees is drawn at 37 degrees, not squared up to the page.
//
// Local frame: x runs along the object's width, y along its depth, the back
// (the side that goes against a wall) at y = -hd. Everything is in svg units.
const _SCAN_OBJ_SW='0.25';   // furniture reads LIGHTER than walls and openings
function _scanObjSym(cat,sw,sd,ink){
  const hw=sw/2,hd=sd/2,f=' fill="none" stroke="'+ink+'" stroke-width="'+_SCAN_OBJ_SW+'"';
  const rect=(x,y,w,h,r)=>'<rect x="'+x.toFixed(2)+'" y="'+y.toFixed(2)+'" width="'+Math.max(0,w).toFixed(2)+'" height="'+Math.max(0,h).toFixed(2)+'"'+(r?' rx="'+r.toFixed(2)+'"':'')+f+'/>';
  const line=(x1,y1,x2,y2)=>'<line x1="'+x1.toFixed(2)+'" y1="'+y1.toFixed(2)+'" x2="'+x2.toFixed(2)+'" y2="'+y2.toFixed(2)+'"'+f+'/>';
  const circ=(x,y,r)=>'<circle cx="'+x.toFixed(2)+'" cy="'+y.toFixed(2)+'" r="'+Math.max(0.12,r).toFixed(2)+'"'+f+'/>';
  const ell=(x,y,rx,ry)=>'<ellipse cx="'+x.toFixed(2)+'" cy="'+y.toFixed(2)+'" rx="'+Math.max(0.12,rx).toFixed(2)+'" ry="'+Math.max(0.12,ry).toFixed(2)+'"'+f+'/>';
  const box=r=>rect(-hw,-hd,sw,sd,r);
  // Below ~1.6 svg units the detail turns to mud, so tiny objects get the
  // footprint alone. That is still more than the nothing they got before.
  if(sw<1.6||sd<1.6)return box(0);
  switch(cat){
    case 'bed':
      return box(sw*0.05)+
        rect(-hw+sw*0.1,-hd+sd*0.05,sw*0.8,sd*0.18,sd*0.05)+   // pillow
        line(-hw,-hd+sd*0.34,hw,-hd+sd*0.34);                   // turn-down fold
    case 'sofa':
      return box(sw*0.06)+
        rect(-hw+sw*0.13,-hd+sd*0.26,sw*0.74,sd*0.6,sd*0.08)+   // seat cushions
        line(0,-hd+sd*0.26,0,hd-sd*0.14);                       // cushion split
    case 'chair':
      return box(sw*0.12)+rect(-hw,-hd,sw,sd*0.2,sw*0.06);      // seat + back band
    case 'table':
      return box(sw*0.04)+rect(-hw+sw*0.1,-hd+sd*0.1,sw*0.8,sd*0.8,sw*0.03);
    case 'refrigerator':
      return box(0)+line(0,-hd,0,hd)+circ(-sw*0.06,hd-sd*0.2,sw*0.03)+circ(sw*0.06,hd-sd*0.2,sw*0.03);
    case 'stove':
      return box(0)+line(-hw,-hd+sd*0.22,hw,-hd+sd*0.22)+       // control strip
        [[-1,-1],[1,-1],[-1,1],[1,1]].map(([a,b])=>circ(a*sw*0.22,sd*0.1+b*sd*0.2,Math.min(sw,sd)*0.11)).join('');
    case 'oven':
      return box(0)+rect(-hw+sw*0.1,-hd+sd*0.18,sw*0.8,sd*0.68,sw*0.03)+line(-hw+sw*0.2,hd-sd*0.08,hw-sw*0.2,hd-sd*0.08);
    case 'dishwasher':
      return box(0)+rect(-hw+sw*0.08,-hd+sd*0.08,sw*0.84,sd*0.84,sw*0.03)+line(-hw+sw*0.22,hd-sd*0.05,hw-sw*0.22,hd-sd*0.05);
    case 'washerDryer':
      // Side by side reads as a pair; a single deep box is one machine.
      return box(0)+(sw>sd*1.5
        ?circ(-sw*0.25,0,Math.min(sw*0.2,sd*0.3))+circ(sw*0.25,0,Math.min(sw*0.2,sd*0.3))
        :circ(0,0,Math.min(sw,sd)*0.3));
    case 'sink':
      return box(0)+rect(-hw+sw*0.12,-hd+sd*0.22,sw*0.76,sd*0.6,sw*0.05)+circ(0,-hd+sd*0.12,Math.min(sw,sd)*0.06);
    case 'toilet':
      return rect(-sw*0.35,-hd,sw*0.7,sd*0.26,sw*0.04)+         // tank
        ell(0,hd-sd*0.34,sw*0.34,sd*0.34);                       // bowl
    case 'bathtub':
      return box(Math.min(sw,sd)*0.12)+
        rect(-hw+sw*0.06,-hd+sd*0.1,sw*0.88,sd*0.8,Math.min(sw,sd)*0.1)+
        circ(-hw+sw*0.16,0,Math.min(sw,sd)*0.06);                // drain end
    case 'television':
      return box(0)+line(-sw*0.14,hd,sw*0.14,hd);                // stand foot
    case 'fireplace':
      return box(0)+rect(-hw+sw*0.16,-hd+sd*0.1,sw*0.68,sd*0.5,sw*0.03)+
        '<path d="M '+(-sw*0.34).toFixed(2)+' '+hd.toFixed(2)+' A '+(sw*0.34).toFixed(2)+' '+(sd*0.34).toFixed(2)+' 0 0 0 '+(sw*0.34).toFixed(2)+' '+hd.toFixed(2)+'"'+f+'/>';
    case 'stairs': {
      let out=box(0),n=Math.max(2,Math.round(sd/Math.max(0.6,sd/8)));
      for(let i=1;i<n;i++){const y=-hd+sd*i/n;out+=line(-hw,y,hw,y);}
      out+=line(0,hd-sd*0.08,0,-hd+sd*0.08)+
        '<path d="M 0 '+(-hd+sd*0.08).toFixed(2)+' l '+(sw*0.08).toFixed(2)+' '+(sd*0.1).toFixed(2)+' M 0 '+(-hd+sd*0.08).toFixed(2)+' l '+(-sw*0.08).toFixed(2)+' '+(sd*0.1).toFixed(2)+'"'+f+'/>';
      return out;
    }
    case 'storage':
      return box(0)+line(-hw,-hd,hw,hd);                         // casework diagonal
    default:
      return box(0);
  }
}
// Every object in one room, placed and rotated on the plan.
function _scanObjSvgFor(room,px,pz,k,ink){
  let s='';
  (room.objects||[]).forEach(ob=>{
    if(!ob||!(ob.w>0))return;
    const deg=Math.atan2(ob.uz||0,typeof ob.ux==='number'?ob.ux:1)*180/Math.PI;
    s+='<g class="td-obj" transform="translate('+px(ob.cx)+','+pz(ob.cz)+') rotate('+deg.toFixed(1)+')">'+
       _scanObjSym(ob.cat,ob.w*k,(ob.d||ob.w)*k,ink)+'</g>';
  });
  return s;
}

// ── The sheet: paper, tints, dimension strings ───────────────────────────────
// Owner review 2026-08-10 against Polycam: "it looks nothing like Polycam,
// just a ton weaker." The geometry was already right; what was missing was
// everything that makes a drawing read as a DOCUMENT instead of a diagram.
// Polycam's sheet carries a title block with the address and a total, tinted
// rooms, dimension strings with extension lines and tick marks running the
// outside of the envelope, and a scale bar. All of it is drawable in the same
// SVG with no dependency, so we draw all of it.
//
// The plan renders on WHITE PAPER in both themes, deliberately. It is a
// deliverable: it goes in the proposal, the client hub, and the plan we sell.
// A document does not change color because the app is in dark mode.
const _SCAN_PAPER='#FFFFFF';
const _SCAN_POCHE='#2F3542';      // navy-charcoal walls, not flat black
const _SCAN_LINE='#98A0AE';       // dimension and leader lines
// Furniture is CONTEXT, not content (owner 2026-09-10: "turn the furniture
// way down to a light grey"). A sofa tells the reader which way the room is
// used; it must never compete with a wall, a door swing or a figure, all of
// which somebody is going to measure or price off.
const _SCAN_FURN='#C6CBD3';       // furniture and fixture symbols
const _SCAN_TXT='#2F3542';
const _SCAN_TXT2='#6E7684';
// Room tints by name, the way a real plan color-keys spaces. Pastel enough
// that the poché, the furniture, and the labels all stay legible on top.
// Owner review 2026-09-09, on a rendered five-room house: bath (#E7F0F8) and
// bedroom (#E6ECF8) were the same pale blue side by side, so two rooms that
// share a wall read as one space. A tint table only earns its place if
// neighbouring rooms land on different hues, so the wet rooms go teal, sleep
// goes lavender, and cooking leaves the blue family entirely.
const _SCAN_ROOM_TINTS=[
  [/bath|powder|shower|restroom|\bwc\b/i,'#DFEFEC'],   // teal: the wet rooms
  [/kitchen|pantry|kitchenette/i,'#EDE8DC'],            // warm stone
  [/bed|nursery|primary|master/i,'#E8E5F4'],            // lavender: sleep
  [/dining/i,'#F5E5D0'],                                // tan
  [/living|family|great room|den|lounge/i,'#FCF1E4'],   // cream
  [/office|study|studio/i,'#E4EFE6'],                   // green
  [/laundry|utility|mud/i,'#E7EEF3'],                   // pale blue, now unshared
  [/garage|shop|basement|attic/i,'#EBEBE7'],
];
// WHERE A ROOM'S NAME GOES (owner review 2026-09-09). The centroid put
// "341 wall sq ft" straight through the bedroom door's swing arc, because a
// swing hugs the wall it hinges on and the centroid of a small room is not
// far from that wall. A plan puts the name in the room's OPEN space, which is
// the point furthest from any edge (the pole of inaccessibility), not the
// average of the corners. A coarse grid is plenty at label size: 24 columns
// across the room's box, scored on distance to the nearest wall, with door
// swings treated as walls so the name steps around them.
// ── One room, more than one space ────────────────────────────────────────────
// RoomPlan hands a whole open floor back as ONE room: his 300 sq ft scan is a
// single "Floor 1" with a wall through the middle of it, so one square-footage
// figure was printed over two rooms. Any wall that runs clean across the floor
// cuts it, and each side of the cut gets its own size and its own footage. The
// pieces always add back up to the room, because they are that room's outline.
function _scanCutPoly(poly,A,B,eps){
  const n=poly.length;
  const on=P=>{
    let bi=-1,bd=1e9,bt=0;
    for(let i=0;i<n;i++){
      const a=poly[i],b=poly[(i+1)%n];
      const dx=b[0]-a[0],dz=b[1]-a[1],L=dx*dx+dz*dz;
      const t=L?Math.max(0,Math.min(1,((P[0]-a[0])*dx+(P[1]-a[1])*dz)/L)):0;
      const d=Math.hypot(P[0]-(a[0]+t*dx),P[1]-(a[1]+t*dz));
      if(d<bd){bd=d;bi=i;bt=t;}
    }
    if(bd>eps||bi<0)return null;
    const a=poly[bi],b=poly[(bi+1)%n];
    return {i:bi,p:[a[0]+(b[0]-a[0])*bt,a[1]+(b[1]-a[1])*bt]};
  };
  const ea=on(A),eb=on(B);
  if(!ea||!eb||ea.i===eb.i)return null;
  const walk=(from,to)=>{
    const out=[];
    for(let c=0,i=(from+1)%n;c<=n;c++,i=(i+1)%n){out.push(poly[i]);if(i===to)return out;}
    return null;
  };
  const w1=walk(ea.i,eb.i),w2=walk(eb.i,ea.i);
  if(!w1||!w2)return null;
  return [[ea.p].concat(w1,[eb.p]),[eb.p].concat(w2,[ea.p])];
}
function _scanBoundD(P,ring){
  let d=1e9;
  for(let i=0;i<ring.length;i++){
    const a=ring[i],b=ring[(i+1)%ring.length];
    const dx=b[0]-a[0],dz=b[1]-a[1],L=dx*dx+dz*dz;
    const t=L?Math.max(0,Math.min(1,((P[0]-a[0])*dx+(P[1]-a[1])*dz)/L)):0;
    d=Math.min(d,Math.hypot(P[0]-(a[0]+t*dx),P[1]-(a[1]+t*dz)));
  }
  return d;
}
function _scanFloorAreas(room){
  const poly=(room&&room.poly)||[],walls=(room&&room.walls)||[];
  if(!Array.isArray(poly)||poly.length<3)return [];
  let parts=[poly];
  (Array.isArray(walls)?walls:[]).forEach(w=>{
    if(!w||!(w.len>0.6))return;
    for(let i=0;i<parts.length;i++){
      const P=parts[i];
      // An interior wall has its ends on the outline and its middle standing
      // clear of it. A perimeter wall lies ALONG the outline and never does.
      let inner=1;
      [0.25,0.5,0.75].forEach(f=>{
        const qx=w.ax+(w.bx-w.ax)*f,qz=w.az+(w.bz-w.az)*f;
        if(!_scanPtInPoly(qx,qz,P)||_scanBoundD([qx,qz],P)<0.3)inner=0;
      });
      if(!inner)continue;
      const cut=_scanCutPoly(P,[w.ax,w.az],[w.bx,w.bz],0.35);
      if(!cut)continue;
      if(Math.abs(_scanShoelace(cut[0]))<0.5||Math.abs(_scanShoelace(cut[1]))<0.5)continue;
      parts.splice(i,1,cut[0],cut[1]);
      break;
    }
  });
  return parts.map(q=>({poly:q,m2:Math.abs(_scanShoelace(q))}));
}
function _scanLabelSpot(r){
  const poly=(r&&r.poly)||[];
  if(poly.length<3)return null;
  const xs=poly.map(p=>p[0]),zs=poly.map(p=>p[1]);
  const x0=Math.min(...xs),x1=Math.max(...xs),z0=Math.min(...zs),z1=Math.max(...zs);
  const inside=(px,pz)=>{
    let hit=false;
    for(let i=0,j=poly.length-1;i<poly.length;j=i++){
      const[ax,az]=poly[i],[bx,bz]=poly[j];
      if((az>pz)!==(bz>pz)&&px<(bx-ax)*(pz-az)/((bz-az)||1e-9)+ax)hit=!hit;
    }
    return hit;
  };
  const segD=(px,pz,ax,az,bx,bz)=>{
    const dx=bx-ax,dz=bz-az,L=dx*dx+dz*dz;
    const t=L?Math.max(0,Math.min(1,((px-ax)*dx+(pz-az)*dz)/L)):0;
    return Math.hypot(px-(ax+t*dx),pz-(az+t*dz));
  };
  // Every wall, plus a keep-out disc where each door swings.
  const segs=[];
  for(let i=0,j=poly.length-1;i<poly.length;j=i++)segs.push([poly[i][0],poly[i][1],poly[j][0],poly[j][1]]);
  const swings=[];
  (r.walls||[]).forEach(w=>{
    if(!w.len)return;
    const ux=(w.bx-w.ax)/w.len,uz=(w.bz-w.az)/w.len;
    (w.doors||[]).forEach(d=>{
      if(typeof d.off!=='number'||!d.w)return;
      const d0=Math.max(0,Math.min(w.len-d.w,d.off-d.w/2));
      swings.push([w.ax+ux*d0,w.az+uz*d0,d.w]);
    });
  });
  const N=24;
  let best=null,bestScore=-1;
  for(let i=0;i<=N;i++)for(let j=0;j<=N;j++){
    const px=x0+(x1-x0)*i/N,pz=z0+(z1-z0)*j/N;
    if(!inside(px,pz))continue;
    let sc=Infinity;
    segs.forEach(g=>{sc=Math.min(sc,segD(px,pz,g[0],g[1],g[2],g[3]));});
    // A door's swing owns a quarter circle of radius d.w at its hinge; the
    // name must clear it, so being inside one scores as if it were a wall.
    swings.forEach(([hx,hz,rw])=>{const d=Math.hypot(px-hx,pz-hz);if(d<rw)sc=Math.min(sc,d*0.35);});
    if(sc>bestScore){bestScore=sc;best=[px,pz];}
  }
  return best;
}
function _scanRoomTint(label){
  const t=String(label||'');
  for(const[re,c] of _SCAN_ROOM_TINTS)if(re.test(t))return c;
  return '#F7F6F3';               // hall, closet, foyer, anything unnamed
}
// The dimension chain along one side of the envelope: every room that reaches
// that side contributes one run, the way Polycam breaks the top edge into a
// dimension per room instead of one number for the whole house.
function _scanSideRuns(rooms,side,minX,minZ,maxX,maxZ){
  const tol=0.35,runs=[];
  rooms.forEach(r=>{
    const xs=(r.poly||[]).map(p=>p[0]),zs=(r.poly||[]).map(p=>p[1]);
    if(!xs.length)return;
    const x0=Math.min(...xs),x1=Math.max(...xs),z0=Math.min(...zs),z1=Math.max(...zs);
    if(side==='top'&&Math.abs(z0-minZ)<tol)runs.push([x0,x1]);
    else if(side==='bottom'&&Math.abs(z1-maxZ)<tol)runs.push([x0,x1]);
    else if(side==='left'&&Math.abs(x0-minX)<tol)runs.push([z0,z1]);
    else if(side==='right'&&Math.abs(x1-maxX)<tol)runs.push([z0,z1]);
  });
  runs.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const out=[];
  runs.forEach(sp=>{
    const last=out[out.length-1];
    if(last&&sp[0]<last[1]-0.05)last[1]=Math.max(last[1],sp[1]);
    else out.push(sp.slice());
  });
  return out.filter(sp=>sp[1]-sp[0]>0.3);
}

// ── Floor plan SVG ───────────────────────────────────────────────────────────
// Drawn to real drafting conventions (research 2026-08-09), because that is
// what separates a professional plan from a toy one: walls as solid poché
// (the double-line look), door gaps with quarter-circle swing arcs, windows
// drawn IN the wall with glazing lines, dimensions pushed outside the wall,
// and a north arrow when the compass grabbed a heading. RoomPlan hands us
// clean parametric vectors, so the render is CAD-crisp where competitors
// trace wobbly meshes.
// ── A ROOM ALREADY SAVED STILL HAS TO DRAW (owner 2026-09-10) ─────────────
// His Aldi GUYS scan was parsed before the floor-polygon fix above, so its
// stored poly is the flat line that bug produced: six corners on one z. It
// cost him more than the missing area. The sheet SIZES ITSELF from the poly,
// so a polygon of height zero laid out a sheet of height zero, and the walls,
// which span 8.9 m and were always correct, drew straight through the title
// block and off the page. That is the screenshot he sent.
//
// A re-scan is not the answer to a parser bug: repair what is there. This
// hands back a usable outline and area for any room, stored or fresh, without
// touching the record, so the drawing and the numbers can never disagree
// about which polygon they used.
function _scanRoomGeom(r){
  const walls=(r&&r.walls)||[];
  let poly=(r&&Array.isArray(r.poly)&&r.poly.length>2)?r.poly:null;
  if(poly&&Math.abs(_scanShoelace(poly))<0.5&&walls.length>=3)poly=null;
  if(poly)return {poly,floorM2:(typeof r.floorM2==='number'&&r.floorM2>0.5)?r.floorM2:Math.abs(_scanShoelace(poly)),approx:!!(r&&r.floorApprox)};
  const pts=[];walls.forEach(w=>{pts.push([w.ax,w.az]);pts.push([w.bx,w.bz]);});
  const hull=pts.length>2?_scanHull(pts):[];
  if(hull.length>2)return {poly:hull,floorM2:Math.abs(_scanShoelace(hull)),approx:true};
  return {poly:(r&&r.poly)||[],floorM2:(r&&r.floorM2)||0,approx:!!(r&&r.floorApprox)};
}
// ── SQUARE TO THE PAGE (owner 2026-09-10: "the floor plan itself is ugly as
// hell") ──────────────────────────────────────────────────────────────────
// A scan's coordinates are the SCENE's, and the scene's zero is wherever the
// phone happened to point when the session started. His living room came out
// 68 degrees off, so the drawing ran corner to corner across the sheet, every
// dimension string read at an angle, and half the page was margin. Nothing
// was wrong with it; it was just never turned the right way up.
//
// Every floor plan ever drawn is square to its paper. The longest RUN of wall
// is what a room squares to, because it is the one a person reads the room
// along, and the runs are bucketed so a scan's own noise cannot split one
// wall into two rivals.
//
// The compass is what keeps this honest: north is a fact about the building,
// not about the sheet, so the arrow turns by the same angle and still points
// where north really is.
function _scanPlanAngle(rooms){
  // OLD: every wall was dropped into a 5 degree bucket and the page was turned
  // by the BUCKET, so up to two and a half degrees of tilt survived the
  // squaring and his plan sat visibly off the axis (owner 2026-09-10: "see how
  // the plan itself isn't set on a 90 degree axis"). The bucket was never the
  // answer: the angle is.
  //
  // Folded to a QUARTER turn, because a wall, the same wall backwards, and the
  // wall at right angles to it are all the same evidence about how the
  // building sits on the paper. Averaged as a DIRECTION and not as a number,
  // so 89 degrees and 1 degree agree that the grid is a degree out instead of
  // averaging to 45, and weighted by length, so the long walls decide.
  let sx=0,sz=0;
  (rooms||[]).forEach(r=>(r.walls||[]).forEach(w=>{
    const dx=w.bx-w.ax,dz=w.bz-w.az,len=Math.hypot(dx,dz);
    if(!(len>0.3))return;
    const a=Math.atan2(dz,dx)*4;                   // a quarter turn becomes a whole one
    sx+=len*Math.cos(a);sz+=len*Math.sin(a);
  }));
  if(!sx&&!sz)return 0;
  let m=Math.atan2(sz,sx)/4;
  if(Math.abs(m)<1e-9)m=0;                         // a square room is left exactly alone
  // That grid can be laid on the paper two ways, ninety degrees apart. Take
  // the one that puts the building's long side across the page: the sheet is
  // sized off its width, and it is the way anybody holds a plan.
  const span=rot=>{
    const cs=Math.cos(rot),sn=Math.sin(rot);
    let x0=1e9,x1=-1e9;
    (rooms||[]).forEach(r=>(r.walls||[]).forEach(w=>{
      [[w.ax,w.az],[w.bx,w.bz]].forEach(q=>{
        const X=q[0]*cs-q[1]*sn;
        x0=Math.min(x0,X);x1=Math.max(x1,X);
      });
    }));
    return x1-x0;
  };
  const a=-m,b=a+(a<=0?Math.PI/2:-Math.PI/2);
  return (span(b)>span(a)?b:a)||0;
}
function _scanRotateRoom(r,cs,sn,ox,oz){
  if(!r)return r;
  const pt=(x,z)=>{const dx=x-ox,dz=z-oz;return [ox+dx*cs-dz*sn,oz+dx*sn+dz*cs];};
  const dir=(x,z)=>[x*cs-z*sn,x*sn+z*cs];
  const out=Object.assign({},r);
  out.poly=(r.poly||[]).map(q=>pt(q[0],q[1]));
  out.walls=(r.walls||[]).map(w=>{
    const a=pt(w.ax,w.az),b=pt(w.bx,w.bz);
    return Object.assign({},w,{ax:a[0],az:a[1],bx:b[0],bz:b[1]});
  });
  out.objects=(r.objects||[]).map(ob=>{
    if(!ob)return ob;                              // junk rides through untouched
    const c=pt(ob.cx,ob.cz),u=dir(ob.ux==null?1:ob.ux,ob.uz==null?0:ob.uz);
    return Object.assign({},ob,{cx:c[0],cz:c[1],ux:u[0],uz:u[1]});
  });
  return out;
}
function _scanPlanSvg(sc,opts){
  const o=opts||{};
  const lens=o.lens||'plan';
  // story filters to one floor (multi-floor scans draw per-floor plans);
  // absent means everything, which is also every pre-multi-floor scan.
  // gidx maps each drawn room back to its index in sc.rooms, so roomClick
  // handlers receive the ORIGINAL index even on a filtered floor.
  const rooms=[],gidx=[];
  (sc.rooms||[]).forEach((r,gi)=>{if(!o.story||Math.max(1,+r.story||1)===o.story){rooms.push(r);gidx.push(gi);}});
  if(!rooms.length)return '<svg viewBox="0 0 100 40"><text x="50" y="22" text-anchor="middle" font-size="8" fill="var(--text3,#6a6963)">No rooms captured</text></svg>';
  // REPAIRED FIRST, THEN TURNED, so everything below reads ONE polygon. The
  // dimension chains around the envelope (_scanSideRuns) go off r.poly, and
  // on his scan that was still the flat line: a room whose outline has no
  // height reaches no side of the sheet, so the chain found no runs and the
  // sheet lost every overall dimension it used to carry. Repairing it here
  // rather than at each reader is what stops two parts of one drawing
  // disagreeing about the shape of the same room.
  for(let i=0;i<rooms.length;i++){
    const g=_scanRoomGeom(rooms[i]);
    rooms[i]=Object.assign({},rooms[i],{poly:g.poly,floorM2:g.floorM2,floorApprox:g.approx});
  }
  // Turned once, here, so every measurement, symbol and label below is drawn
  // in page space and nothing downstream needs to know this happened.
  const _rot=_scanPlanAngle(rooms);
  if(Math.abs(_rot)>0.001){
    let ox=0,oz=0,n=0;
    rooms.forEach(r=>(r.walls||[]).forEach(w=>{ox+=w.ax+w.bx;oz+=w.az+w.bz;n+=2;}));
    if(n){ox/=n;oz/=n;}
    const cs=Math.cos(_rot),sn=Math.sin(_rot);
    for(let i=0;i<rooms.length;i++)rooms[i]=_scanRotateRoom(rooms[i],cs,sn,ox,oz);
  }
  // THE SHEET IS SIZED BY EVERYTHING IT DRAWS, not by the floor polygon
  // alone. Walls are drawn from their own endpoints, and a poly that does not
  // contain them (a bad one, or an interior divider reaching past the floor)
  // put them outside the page. Fitting the drawing to the drawing cannot go
  // wrong the way fitting it to one of its layers can.
  let minX=1e9,minZ=1e9,maxX=-1e9,maxZ=-1e9;
  const seen=(x,z)=>{if(!isFinite(x)||!isFinite(z))return;minX=Math.min(minX,x);minZ=Math.min(minZ,z);maxX=Math.max(maxX,x);maxZ=Math.max(maxZ,z);};
  rooms.forEach(r=>{
    (r.poly||[]).forEach(q=>seen(q[0],q[1]));
    (r.walls||[]).forEach(w=>{seen(w.ax,w.az);seen(w.bx,w.bz);});
    (r.objects||[]).forEach(ob=>{if(!ob)return;const rr=Math.max(ob.w||0,ob.d||0)/2;seen(ob.cx-rr,ob.cz-rr);seen(ob.cx+rr,ob.cz+rr);});
  });
  if(minX>maxX)return '<svg viewBox="0 0 100 40"></svg>';
  // Sheet layout, in viewBox units: a margin wide enough for two rows of
  // dimension string on every side, a title block on top and a scale bar
  // underneath when this is a full sheet.
  const MAR=13, HEAD=o.sheet?17:2, FOOT=o.sheet?14:2;
  const wM=maxX-minX,hM=maxZ-minZ;
  const k=(100-MAR*2)/(wM||1);                     // meters → viewBox units
  const px=x=>+(MAR+(x-minX)*k).toFixed(2);
  const pz=z=>+(HEAD+MAR+(z-minZ)*k).toFixed(2);
  const vh=+(HEAD+MAR*2+hM*k+FOOT).toFixed(2);
  // Poché thickness: reads as a real ~5in wall at whole-house scale, clamped
  // so a single small room doesn't render cartoon-fat walls.
  const th=Math.max(0.9,Math.min(2.2,0.13*k));
  const ink=_SCAN_POCHE,bg=_SCAN_PAPER;
  // Room names and dimensions sit over drawn furniture, so every label carries
  // a paper-colored halo behind the glyphs (paint-order draws the stroke
  // first, then the fill on top of it) and stays readable.
  const halo=' stroke="'+bg+'" stroke-width="0.7" paint-order="stroke" stroke-linejoin="round"';
  // An SVG with no font-family renders in the UA serif, which is why the plan
  // read as a school worksheet next to Polycam's. The sheet sets its own.
  let s='<svg viewBox="0 0 100 '+vh+'" style="width:100%;height:auto;display:block;border-radius:10px" '+
    'font-family="-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif" xmlns="http://www.w3.org/2000/svg">';
  s+='<rect x="0" y="0" width="100" height="'+vh+'" fill="'+bg+'"/>';
  // 0. Title block: what it is, whose it is, how big it is. A plan without one
  // reads like a screenshot; with one it reads like a document you hand over.
  if(o.sheet){
    const tot=Math.round(_scanSqFt(rooms.reduce((t,r)=>t+(r.floorM2||0),0)));
    s+='<text x="50" y="7.6" font-size="4.6" font-weight="700" fill="'+_SCAN_TXT+'" text-anchor="middle">'+escHtml(o.title||'Floor plan')+'</text>';
    if(o.subtitle)s+='<text x="50" y="12.2" font-size="2.9" fill="'+_SCAN_TXT2+'" text-anchor="middle">'+escHtml(o.subtitle)+'</text>';
    s+='<text x="50" y="'+(o.subtitle?15.9:12.4)+'" font-size="2.6" fill="'+_SCAN_TXT2+'" text-anchor="middle">Approximately '+tot.toLocaleString()+' sq ft total</text>';
  }
  // 1. Room fills first (tappable when the caller wires roomClick).
  // roomFills tints rooms by ORIGINAL index (the proposal color-keys the
  // rooms that carry quote lines); with no override each room takes the tint
  // for its type, which is what turns a wireframe into a plan you can read at
  // a glance.
  rooms.forEach((r,ri)=>{
    const pts=(r.poly||[]).map(([x,z])=>px(x)+','+pz(z)).join(' ');
    const fill=(o.roomFills&&o.roomFills[gidx[ri]])||_scanRoomTint(r.label);
    s+='<polygon points="'+pts+'" fill="'+fill+'" stroke="none"'+
       (o.roomClick?' onclick="'+o.roomClick+'('+gidx[ri]+')" style="cursor:pointer"':'')+'/>';
  });
  // 1b. Furniture and fixtures, UNDER the walls so the poché stays crisp where
  // a bed or a vanity is pushed up against one.
  rooms.forEach(r=>{s+=_scanObjSvgFor(r,px,pz,k,_SCAN_FURN);});
  // 2. Walls as solid poché segments; square caps close the corners.
  rooms.forEach(r=>(r.walls||[]).forEach(w=>{
    s+='<line x1="'+px(w.ax)+'" y1="'+pz(w.az)+'" x2="'+px(w.bx)+'" y2="'+pz(w.bz)+'" stroke="'+ink+'" stroke-width="'+th.toFixed(2)+'" stroke-linecap="square"/>';
  }));
  // 3. Openings punched into the poché: door gap + swing arc, window glazing.
  // EVERY OPENING SAYS HOW BIG IT IS (owner 2026-09-09). Written once per
  // physical opening: an interior door belongs to the walls of BOTH rooms it
  // connects, so without this bucket the same door prints its width twice,
  // once facing each way. Keyed to a 5 cm bucket on the opening's midpoint,
  // which is far tighter than any two real openings sit apart.
  // EVERY WALL SAYS HOW LONG IT IS (owner 2026-09-10: "each one of those
  // walls in the actual scan and on the floor plan don't show how long they
  // are, even the small internal ones with the giant arch in between the left
  // and right room").
  //
  // The dimension chains below run around the OUTSIDE of the envelope, so
  // they describe the building and say nothing about any one wall, and an
  // interior wall gets no number at all however much of the room it defines.
  // A trim carpenter pricing base, or anybody standing in front of the wall
  // with the arch in it, is reading the wall, not the envelope.
  //
  // Inside the room, because the openings already label outside it, and once
  // per physical wall: an interior wall belongs to the rooms on both sides
  // and would otherwise print its length twice, back to back.
  const seenOpen=new Set(),seenSwing=new Set(),seenWall=new Set();
  let wallLbls='';
  // Every label that has taken a piece of paper, so the next one can stand off
  // it rather than print on top of it.
  // Each entry is the BOX a figure occupies, [x, y, half-width, half-height],
  // not a point with one radius. A radius says a short figure sitting a line
  // below a long one is on top of it, which it is not, and the figure that
  // gets dropped for it is the one with nowhere else to go.
  const lblAt=[];
  const lblFree=(X,Y,hw,hh)=>!lblAt.some(p=>Math.abs(p[0]-X)<p[2]+hw+0.4&&Math.abs(p[1]-Y)<p[3]+hh+0.5);
  const tall=fs=>fs*0.36;
  // NOTHING ON THE SHEET IS TURNED (owner 2026-09-10: "needs to not be tilted
  // at all"). A figure set on its side is a figure the reader turns the page
  // for. Standing a figure off a wall it runs parallel to therefore has to
  // clear the WIDTH of the text, not its height, or it prints over the wall.
  const wide=(txt,fs)=>txt.length*0.55*fs/2;
  // ONE placement pass for every figure a wall produces, whole wall, the runs
  // between its openings, and the openings themselves. They compete for the
  // same paper, so they cannot each pick a spot on their own and hope.
  const figs=[];
  const inPage=(X,Y,hw,hh)=>X-hw>1&&X+hw<99&&Y-hh>HEAD&&Y+hh<vh-2;
  // THE ROOM LABELS ARE LAID OUT FIRST, before a single wall figure is placed,
  // so the figures give way to them. A space's name and its square footage is
  // what the sheet is read for; a wall dimension can always slide a foot along
  // its own wall.
  const roomLbls=[];
  rooms.forEach((r,ri)=>{
    const areas=_scanFloorAreas(r);
    if(!areas.length)return;
    let big=0;areas.forEach((a,i)=>{if(a.m2>areas[big].m2)big=i;});
    areas.forEach((a,ai)=>{
      const spot=_scanLabelSpot({poly:a.poly,walls:r.walls});
      const cx=spot?spot[0]:a.poly.reduce((t,q)=>t+q[0],0)/a.poly.length;
      const cz=spot?spot[1]:a.poly.reduce((t,q)=>t+q[1],0)/a.poly.length;
      const xs=a.poly.map(q=>q[0]),zs=a.poly.map(q=>q[1]);
      const bw=Math.max(...xs)-Math.min(...xs),bh=Math.max(...zs)-Math.min(...zs);
      // The box is only honest for a space that fills it, so a bay or an L
      // keeps its area and drops the two figures rather than printing a
      // rectangle nobody can measure to.
      const boxy=bw>0&&bh>0&&a.m2/(bw*bh)>=0.9;
      const name=ai===big?(r.label||'Room'):'';
      const dimTxt=_scanFtIn(bw)+' \u00d7 '+_scanFtIn(bh);
      const areaTxt=Math.round(_scanSqFt(a.m2)).toLocaleString()+' sq ft';
      // A HALL IS NOT A LIVING ROOM (owner review 2026-09-09). At one fixed
      // size the block ran wall to wall in the narrow rooms and straight over
      // the door swing, so it is scaled to the space that holds it.
      const widest=Math.max(name.length,boxy?dimTxt.length:0,areaTxt.length);
      const f1=Math.max(1.75,Math.min(2.9,(bw*k*0.82)/((widest*0.55)||1)));
      const rows=[];
      if(name)rows.push({txt:escHtml(name),fs:f1,bold:1,fill:_SCAN_TXT,step:0});
      if(boxy)rows.push({txt:dimTxt,fs:f1*0.83,bold:0,fill:_SCAN_TXT,step:1.18});
      rows.push({txt:areaTxt,fs:f1*0.79,bold:0,fill:_SCAN_TXT2,step:1.14});
      let yy=pz(cz)-(rows.length-1)*f1*0.62;
      rows.forEach((row,i)=>{
        if(i)yy+=f1*row.step;
        row.x=px(cx);row.y=yy;
        lblAt.push([row.x,yy,wide(row.txt,row.fs),tall(row.fs)]);
      });
      roomLbls.push({gi:gidx[ri],rows});
    });
  });
  rooms.forEach(r=>{
    const cx0=(r.poly||[]).reduce((t,p)=>t+p[0],0)/((r.poly||[]).length||1);
    const cz0=(r.poly||[]).reduce((t,p)=>t+p[1],0)/((r.poly||[]).length||1);
    (r.walls||[]).forEach(w=>{
      if(!w.len)return;
      const ux=(w.bx-w.ax)/w.len,uz=(w.bz-w.az)/w.len;
      let nx=-uz,nz=ux;
      // Flip the normal to point INTO this room, so swings draw inward.
      const mx=(w.ax+w.bx)/2,mz=(w.az+w.bz)/2;
      if(nx*(cx0-mx)+nz*(cz0-mz)<0){nx=-nx;nz=-nz;}
      if(w.len>=0.6){
        const wKey=Math.round(mx*20)+'|'+Math.round(mz*20);
        if(!seenWall.has(wKey)){
          seenWall.add(wKey);
          figs.push({rank:0,ax:w.ax,az:w.az,ux,uz,a:0,b:w.len,nx,nz,
                     txt:_scanFtIn(w.len),fs:2.1,lead:1,base:2.2,out:0});
        }
      }
      // The PIECES of wall left between the openings get their own figure.
      // The two stubs either side of an archway are what somebody actually
      // frames, tapes and trims, and the wall's overall length never says how
      // wide they are. Doors and cased openings break the wall at the cut
      // plane; a window does not, so it never splits a run.
      const cuts=(w.doors||[]).filter(d=>typeof d.off==='number'&&d.w>0)
        .map(d=>{const a=Math.max(0,Math.min(w.len-d.w,d.off-d.w/2));return[a,a+d.w];})
        .sort((p,q)=>p[0]-q[0]);
      if(cuts.length){
        let end=0;const segs=[];
        cuts.forEach(([a,b])=>{if(a>end)segs.push([end,a]);end=Math.max(end,b);});
        if(end<w.len)segs.push([end,w.len]);
        segs.forEach(([a,b])=>{
          if(b-a<0.3)return;                      // under a foot is a reveal, not a wall
          const sx=w.ax+ux*(a+b)/2,sz=w.az+uz*(a+b)/2;
          const key='s'+Math.round(sx*20)+'|'+Math.round(sz*20);
          if(seenWall.has(key))return;
          seenWall.add(key);
          figs.push({rank:2,ax:w.ax,az:w.az,ux,uz,a,b,nx,nz,
                     txt:_scanFtIn(b-a),fs:1.8,lead:0,base:2.2,out:0});
        });
      }
      const at=d=>[w.ax+ux*d,w.az+uz*d];
      // The figure sits just OUTSIDE the wall, turned to run along it, so it
      // never lands on the swing arc it is describing.
      const openLbl=(d0,d1,txt)=>{
        const[mx,mz]=at((d0+d1)/2);
        const key=Math.round(mx*20)+'|'+Math.round(mz*20);
        if(seenOpen.has(key))return;
        seenOpen.add(key);
        figs.push({rank:1,ax:w.ax,az:w.az,ux,uz,a:d0,b:d1,nx,nz,
                   txt,fs:1.9,lead:0,base:2.7,out:1});
      };
      const punch=(d0,d1)=>{const[a1,b1]=at(d0),[a2,b2]=at(d1);
        s+='<line x1="'+px(a1)+'" y1="'+pz(b1)+'" x2="'+px(a2)+'" y2="'+pz(b2)+'" stroke="'+bg+'" stroke-width="'+(th+0.35).toFixed(2)+'"/>';};
      (w.doors||[]).forEach(d=>{
        if(typeof d.off!=='number'||!d.w)return;
        const d0=Math.max(0,Math.min(w.len-d.w,d.off-d.w/2)),d1=d0+d.w;
        punch(d0,d1);
        openLbl(d0,d1,_scanFtIn(d.w));
        if(d.kind==='opening'){
          // A cased opening / archway: the wall stops, the jambs cap the ends,
          // and a DASHED line spans the gap for the header above the cut plane.
          // No leaf, no swing arc, because there is no door to swing. Drawing
          // one is what made every archway read as a square door.
          const[a1,b1]=at(d0),[a2,b2]=at(d1);
          const jx=nx*(th/k)/2,jz=nz*(th/k)/2;
          [[a1,b1],[a2,b2]].forEach(([qx,qz])=>{
            s+='<line x1="'+px(qx-jx)+'" y1="'+pz(qz-jz)+'" x2="'+px(qx+jx)+'" y2="'+pz(qz+jz)+'" stroke="'+ink+'" stroke-width="0.35"/>';
          });
          s+='<line x1="'+px(a1)+'" y1="'+pz(b1)+'" x2="'+px(a2)+'" y2="'+pz(b2)+'" stroke="'+ink+'" stroke-width="0.22" stroke-dasharray="1.2 0.9"/>';
          return;
        }
        // ONE DOOR, ONE SWING (owner review 2026-09-09, on the rendered
        // house: the bedroom-to-hall door drew two arcs facing each other,
        // because that door is a wall of the bedroom AND a wall of the hall).
        // The punch above still runs for both, since each room draws its own
        // wall and both need the gap; the leaf and the arc are the door, and
        // a door only swings one way.
        const swKey=Math.round((at((d0+d1)/2)[0])*20)+'|'+Math.round((at((d0+d1)/2)[1])*20);
        if(seenSwing.has(swKey))return;
        seenSwing.add(swKey);
        // Hinge at d0: thin leaf into the room + quarter swing arc back to d1.
        // The sweep flag must put the arc's CENTER at the hinge so it bows
        // INTO the room (owner review 2026-08-09 vs reference plans: the old
        // ux*nz-uz*nx collapses to a constant, so walls whose normal was not
        // flipped drew the arc bowing through the wall). nx*uz-nz*ux carries
        // the side the room-facing normal actually took.
        const[hx,hz]=at(d0),[ex,ez]=[hx+nx*d.w,hz+nz*d.w],[tx,tz]=at(d1);
        const rw=(d.w*k).toFixed(2);
        s+='<line x1="'+px(hx)+'" y1="'+pz(hz)+'" x2="'+px(ex)+'" y2="'+pz(ez)+'" stroke="'+ink+'" stroke-width="0.3"/>';
        s+='<path d="M '+px(ex)+' '+pz(ez)+' A '+rw+' '+rw+' 0 0 '+((nx*uz-nz*ux)>0?1:0)+' '+px(tx)+' '+pz(tz)+'" fill="none" stroke="'+ink+'" stroke-width="0.2"/>';
      });
      (w.windows||[]).forEach(win=>{
        if(typeof win.off!=='number'||!win.w)return;
        const d0=Math.max(0,Math.min(w.len-win.w,win.off-win.w/2)),d1=d0+win.w;
        punch(d0,d1);
        openLbl(d0,d1,_scanFtIn(win.w)+(win.h>0?' \u00d7 '+_scanFtIn(win.h):''));
        // The classic triple-line window (owner review 2026-08-09 vs
        // reference plans: a bare gap with one hairline read as nothing):
        // both wall faces redrawn across the opening, the center glazing
        // line, and jamb caps closing the ends.
        const[a1,b1]=at(d0),[a2,b2]=at(d1);
        const ox=nx*(th/k)/2,oz=nz*(th/k)/2;
        [-1,0,1].forEach(f=>{
          s+='<line x1="'+px(a1+ox*f)+'" y1="'+pz(b1+oz*f)+'" x2="'+px(a2+ox*f)+'" y2="'+pz(b2+oz*f)+'" stroke="'+ink+'" stroke-width="'+(f===0?'0.28':'0.35')+'"/>';
        });
        [[a1,b1],[a2,b2]].forEach(([qx,qz])=>{
          s+='<line x1="'+px(qx-ox)+'" y1="'+pz(qz-oz)+'" x2="'+px(qx+ox)+'" y2="'+pz(qz+oz)+'" stroke="'+ink+'" stroke-width="0.35"/>';
        });
      });
    });
  });

  // 4. Dimension strings around the envelope: extension lines off the wall,
  // a dimension line with tick marks, the figure centered on it, and a second
  // overall row outside that when a side breaks into more than one run. This
  // is the drafting convention, and it is the single biggest thing separating
  // our plan from a survey-grade one (owner review 2026-08-10 vs Polycam:
  // floating numbers next to two walls per room read as annotation, not as a
  // dimensioned drawing).
  const dimRun=(side,a,b,row)=>{
    const gap=4.2+row*5.2, ext=1.6;
    const t=(row?2.35:2.6), col=_SCAN_LINE;
    const tickAt=(x,y,dx,dy)=>'<line x1="'+(x-dx).toFixed(2)+'" y1="'+(y-dy).toFixed(2)+'" x2="'+(x+dx).toFixed(2)+'" y2="'+(y+dy).toFixed(2)+'" stroke="'+col+'" stroke-width="0.35"/>';
    const ln=(x1,y1,x2,y2,w)=>'<line x1="'+x1.toFixed(2)+'" y1="'+y1.toFixed(2)+'" x2="'+x2.toFixed(2)+'" y2="'+y2.toFixed(2)+'" stroke="'+col+'" stroke-width="'+w+'"/>';
    let out='';
    if(side==='top'||side==='bottom'){
      const edge=side==='top'?pz(minZ):pz(maxZ), dir=side==='top'?-1:1;
      const y=edge+dir*gap, x1=px(a), x2=px(b);
      out+=ln(x1,edge+dir*ext,x1,y+dir*1.1,0.2)+ln(x2,edge+dir*ext,x2,y+dir*1.1,0.2);
      out+=ln(x1,y,x2,y,0.25)+tickAt(x1,y,0.9,0.9*dir)+tickAt(x2,y,0.9,0.9*dir);
      const tx=(x1+x2)/2,ty=y+(side==='top'?-1.4:t+0.6),ft=_scanFtIn(b-a);
      lblAt.push([tx,ty,wide(ft,t),tall(t)]);
      out+='<text x="'+tx.toFixed(2)+'" y="'+ty.toFixed(2)+'" font-size="'+t+'" fill="'+_SCAN_TXT2+'" text-anchor="middle"'+halo+'>'+ft+'</text>';
    }else{
      const edge=side==='left'?px(minX):px(maxX), dir=side==='left'?-1:1;
      const x=edge+dir*gap, y1=pz(a), y2=pz(b);
      out+=ln(edge+dir*ext,y1,x+dir*1.1,y1,0.2)+ln(edge+dir*ext,y2,x+dir*1.1,y2,0.2);
      out+=ln(x,y1,x,y2,0.25)+tickAt(x,y1,0.9*dir,0.9)+tickAt(x,y2,0.9*dir,0.9);
      // Upright, sitting ON the chain: the halo behind the glyphs breaks the
      // line for it, which is how a drafter writes a vertical dimension too.
      const my=(y1+y2)/2,ft=_scanFtIn(b-a);
      lblAt.push([x,my,wide(ft,t),tall(t)]);
      out+='<text x="'+x.toFixed(2)+'" y="'+(my+t*0.36).toFixed(2)+'" font-size="'+t+'" fill="'+_SCAN_TXT2+'" text-anchor="middle"'+halo+'>'+ft+'</text>';
    }
    return out;
  };
  ['top','bottom','left','right'].forEach(side=>{
    const runs=_scanSideRuns(rooms,side,minX,minZ,maxX,maxZ);
    if(!runs.length)return;
    runs.forEach(([a,b])=>{s+=dimRun(side,a,b,0);});
    if(runs.length>1){
      const lo=Math.min(...runs.map(r=>r[0])),hi=Math.max(...runs.map(r=>r[1]));
      if(hi-lo>0.3)s+=dimRun(side,lo,hi,1);
    }
  });
  // Placed in order of what the reader needs most: the wall itself, then what
  // is cut into it, then the runs left between those cuts. Each figure SLIDES
  // along the piece of wall it describes, and will sit on the other face of
  // that wall before it gives up. It never wanders off into the middle of the
  // room to find space, and it never runs off the edge of the paper: a figure
  // that has left its wall behind describes nothing, and one in the gutter
  // does not print.
  figs.sort((p,q)=>p.rank-q.rank).forEach(g=>{
    const hw=wide(g.txt,g.fs),hh=tall(g.fs),off=g.base+Math.abs(g.nx)*hw;
    const sides=g.out?[-1,1]:[1,-1];
    let X=0,Y=0,ok=0;
    for(const f of [0.5,0.3,0.7,0.16,0.84]){
      const d=g.a+(g.b-g.a)*f,cx=g.ax+g.ux*d,cz=g.az+g.uz*d;
      for(const sd of sides){
        X=px(cx)+g.nx*off*sd;Y=pz(cz)+g.nz*off*sd;
        if(inPage(X,Y,hw,hh)&&lblFree(X,Y,hw,hh)){ok=1;break;}
      }
      if(ok)break;
    }
    if(!ok)return;                                 // nowhere legible left on it
    lblAt.push([X,Y,hw,hh]);
    wallLbls+='<g class="'+(g.rank===1?'td-olen':'td-wlen')+'"><text x="'+X.toFixed(2)+'" y="'+(Y+0.75).toFixed(2)+
      '" font-size="'+g.fs+'"'+(g.lead?' font-weight="600"':'')+' fill="'+(g.lead?_SCAN_TXT:_SCAN_TXT2)+
      '" text-anchor="middle"'+halo+'>'+g.txt+'</text></g>';
  });
  s+=wallLbls;
  // 5. Labels: the ROOM, not the invoice (owner 2026-09-09: "shouldn't be wall
  // sq feet on a floor plan, should be room square feet"). This supersedes the
  // 2026-08-09 call that wall area leads. That number is what paint bills on
  // and it is still right ON THE ESTIMATE, where somebody is pricing; on a
  // drawing that a homeowner and a framer both read, the room's size is the
  // only number either of them is looking for. Wall area is one tap away in
  // the takeoff and no longer competes with the name.
  //
  // Size reads as a drawing does: width by length off the room's box, then the
  // floor area under it. The box is only honest for a room that fills it, so a
  // bay or an L keeps its area and drops the two figures rather than printing
  // a rectangle nobody can measure to.
  roomLbls.forEach(b=>{
    s+=(o.roomClick?'<g onclick="'+o.roomClick+'('+b.gi+')" style="cursor:pointer">':'<g>');
    b.rows.forEach(t=>{
      s+='<text x="'+t.x+'" y="'+t.y.toFixed(2)+'" font-size="'+t.fs.toFixed(2)+'"'+
         (t.bold?' font-weight="700"':'')+' fill="'+t.fill+'" text-anchor="middle"'+halo+'>'+t.txt+'</text>';
    });
    s+='</g>';
  });
  if(lens==='electrical'){
    rooms.forEach(r=>{
      _scanOutletPlan(r).forEach(m=>{
        s+='<circle class="td-outlet" cx="'+px(m.x)+'" cy="'+pz(m.z)+'" r="1.1" fill="#D97706" stroke="#fff" stroke-width="0.3"/>';
      });
    });
  }
  // 6. North. ALWAYS DRAWN (owner 2026-09-10: "needs the compass drawn
  // somewhere"). A plan with no orientation mark is a picture: nobody holding
  // it can say which wall faces the street. The NEEDLE turns, because the page
  // turned and north did not; the letter never does, because a letter on its
  // side is a letter the reader turns the page for. Where the compass gave no
  // heading at capture the needle is drawn light and up the sheet and the mark
  // reads "N?", which says the direction is the paper's, not the world's.
  {
    const hasN=typeof sc.headingDeg==='number'&&sc.headingDeg>=0;
    const _nDeg=Math.round((hasN?sc.headingDeg:0)+_rot*180/Math.PI);
    s+='<g transform="translate(94.5,'+(HEAD+5).toFixed(1)+')">'+
       '<circle r="3" fill="none" stroke="'+_SCAN_LINE+'" stroke-width="0.3"/>'+
       '<g transform="rotate('+_nDeg+')"><path d="M 0 -2.2 L 1 1.6 L 0 0.7 L -1 1.6 Z" fill="'+(hasN?_SCAN_TXT:_SCAN_LINE)+'"/></g>'+
       '<text y="-4" font-size="2.2" fill="'+_SCAN_TXT2+'" text-anchor="middle">'+(hasN?'N':'N?')+'</text></g>';
  }
  // 7. Scale bar: the thing that lets a client hold a ruler to the printout.
  // The bar is a round number of feet, the largest that still fits the margin.
  if(o.sheet){
    const ftU=k/_SCAN_M2FT;                        // viewBox units per foot
    const barFt=[20,10,5,3,2,1].find(f=>f*ftU<=24)||1;
    const y=vh-FOOT+5.5,x0=MAR,x1=MAR+barFt*ftU;
    s+='<line x1="'+x0+'" y1="'+y.toFixed(2)+'" x2="'+x1.toFixed(2)+'" y2="'+y.toFixed(2)+'" stroke="'+_SCAN_TXT+'" stroke-width="0.7"/>'+
       '<line x1="'+x0+'" y1="'+(y-1.2).toFixed(2)+'" x2="'+x0+'" y2="'+(y+1.2).toFixed(2)+'" stroke="'+_SCAN_TXT+'" stroke-width="0.35"/>'+
       '<line x1="'+x1.toFixed(2)+'" y1="'+(y-1.2).toFixed(2)+'" x2="'+x1.toFixed(2)+'" y2="'+(y+1.2).toFixed(2)+'" stroke="'+_SCAN_TXT+'" stroke-width="0.35"/>'+
       '<text x="'+(x1+2).toFixed(2)+'" y="'+(y+1).toFixed(2)+'" font-size="2.5" fill="'+_SCAN_TXT2+'">'+barFt+' ft</text>'+
       '<text x="'+(100-MAR)+'" y="'+(y+1).toFixed(2)+'" font-size="2.3" fill="'+_SCAN_LINE+'" text-anchor="end">Measured with TradeDesk</text>';
    // WHEN, AND BY WHOM (owner review 2026-09-09: the block read thin). A
    // drawing without a date is not evidence of anything, and a homeowner
    // holding two scans a year apart has no way to tell them apart. Both
    // come from what the scan already carries; neither is invented.
    const when=o.dateText||(sc.ts?new Date(sc.ts).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'');
    const by=o.byText||sc.scannedBy||'';
    const foot=[when,by?'Scanned by '+by:''].filter(Boolean).join('  \u00b7  ');
    if(foot)s+='<text x="'+MAR+'" y="'+(y+5.2).toFixed(2)+'" font-size="2.2" fill="'+_SCAN_LINE+'">'+escHtml(foot)+'</text>';
  }
  // Photo pins: each shot taken during the scan knows exactly where the
  // camera stood (the pose rides along from the plugin), so the walkthrough
  // is literally ON the plan: tap a pin, see that spot.
  if(o.photos&&o.scanId){
    o.photos.forEach((p,i)=>{
      const cam=p&&p.cam;
      if(!cam||cam.length<16)return;
      const cx=px(cam[12]),cz=pz(cam[14]);
      s+='<g onclick="_scanOpenPhoto(\''+o.scanId+'\','+i+')" style="cursor:pointer">'+
         '<circle cx="'+cx+'" cy="'+cz+'" r="2.2" fill="#185FA5" stroke="#fff" stroke-width="0.5"/>'+
         '<text x="'+cx+'" y="'+(cz+1.1)+'" font-size="2.6" fill="#fff" text-anchor="middle">'+(i+1)+'</text></g>';
    });
  }
  // Walkthrough dots: every auto-kept frame, small and unnumbered so the
  // shutter photos stay the loud pins. Tap one, stand there again.
  if(o.walk&&o.scanId){
    o.walk.forEach((k,i)=>{
      const cam=k&&k.cam;
      if(!cam||cam.length<16)return;
      s+='<circle cx="'+px(cam[12])+'" cy="'+pz(cam[14])+'" r="1.1" fill="#8A9BB0" stroke="#fff" stroke-width="0.3" onclick="_scanOpenWalk(\''+o.scanId+'\','+i+')" style="cursor:pointer"/>';
    });
  }
  s+='</svg>';
  return s;
}
// ── 3D dollhouse SVG ─────────────────────────────────────────────────────────
// Hand-rolled isometric extrusion of the parametric walls: zero dependencies,
// instant, printable, themeable. Multi-floor scans stack as an exploded
// dollhouse (each story lifted with air under it), the premium look none of
// the scanner apps ship from parametric data. Walls draw at partial height so
// the camera always sees into the rooms, Matterport-style.
function _scanDollhouseSvg(sc){
  const rooms=(sc.rooms||[]);
  if(!rooms.length)return '<svg viewBox="0 0 100 40"><text x="50" y="22" text-anchor="middle" font-size="8" fill="var(--text3,#6a6963)">No rooms captured</text></svg>';
  const stories=_scanStories(sc);
  const wh=1.35,explode=1.5;                      // partial wall height, story air gap
  const lvlY=st=>stories.indexOf(Math.max(1,+st||1))*(wh+explode);
  const iso=(x,z,y)=>[(x-z)*0.866,(x+z)*0.5-y];
  const pal=['#DCE8F5','#E7F0DC','#F5E9D4','#EFE0EF','#E0EFEA','#F2E3DD'];
  // Project everything once to find bounds.
  let minU=1e9,minV=1e9,maxU=-1e9,maxV=-1e9;
  const seen=p=>{minU=Math.min(minU,p[0]);maxU=Math.max(maxU,p[0]);minV=Math.min(minV,p[1]);maxV=Math.max(maxV,p[1]);};
  rooms.forEach(r=>{
    const y0=lvlY(r.story);
    (r.poly||[]).forEach(([x,z])=>{seen(iso(x,z,y0));seen(iso(x,z,y0+wh));});
  });
  if(minU>maxU)return '<svg viewBox="0 0 100 40"></svg>';
  const pad=0.8,SW=maxU-minU+pad*2,k=100/SW;
  const P=(x,z,y)=>{const p=iso(x,z,y);return ((p[0]-minU+pad)*k).toFixed(2)+','+((p[1]-minV+pad)*k).toFixed(2);};
  const vh=((maxV-minV+pad*2)*k).toFixed(2);
  let s='<svg viewBox="0 0 100 '+vh+'" style="width:100%;height:auto;display:block" xmlns="http://www.w3.org/2000/svg">';
  // Ground floor first, each story up the stack; within a story: floor slab,
  // then walls back-to-front (painter's algorithm on x+z depth).
  stories.forEach(st=>{
    const lvl=rooms.map((r,ri)=>({r,ri})).filter(q=>Math.max(1,+q.r.story||1)===st);
    lvl.forEach(({r,ri})=>{
      const y0=lvlY(st);
      const pts=(r.poly||[]).map(([x,z])=>P(x,z,y0)).join(' ');
      s+='<polygon points="'+pts+'" fill="'+pal[ri%pal.length]+'" stroke="#8a877f" stroke-width="0.25"/>';
    });
    const walls=[];
    lvl.forEach(({r})=>(r.walls||[]).forEach(w=>walls.push({w,y0:lvlY(st)})));
    walls.sort((a,b)=>((a.w.ax+a.w.bx)/2+(a.w.az+a.w.bz)/2)-((b.w.ax+b.w.bx)/2+(b.w.az+b.w.bz)/2));
    walls.forEach(({w,y0})=>{
      // Shade by facing so the box reads as a volume.
      const dx=w.bx-w.ax,dz=w.bz-w.az;
      const fill=Math.abs(dx)>=Math.abs(dz)?'#d9d6cf':'#c4c1ba';
      s+='<polygon points="'+P(w.ax,w.az,y0)+' '+P(w.bx,w.bz,y0)+' '+P(w.bx,w.bz,y0+Math.min(wh,w.h||wh))+' '+P(w.ax,w.az,y0+Math.min(wh,w.h||wh))+'" fill="'+fill+'" stroke="#6d6a63" stroke-width="0.22"/>';
    });
    if(stories.length>1){
      // Label each slab at its left edge.
      let lx=1e9,lz=0;
      lvl.forEach(({r})=>(r.poly||[]).forEach(([x,z])=>{if(x-z<lx){lx=x-z;lz=z;}}));
      const a=lvl[0];let ax=0,az=0;
      if(a){const p0=(a.r.poly||[])[0]||[0,0];ax=p0[0];az=p0[1];}
      s+='<text x="2" y="'+((iso(ax,az,lvlY(st)+wh/2)[1]-minV+pad)*k).toFixed(2)+'" font-size="3" font-weight="700" fill="var(--text2,#5f5e5a)">Floor '+st+'</text>';
    }
  });
  s+='</svg>';
  return s;
}
// ── Photo walkthrough ────────────────────────────────────────────────────────
// Photos are device-local files (the client deliverable excludes them by
// design); the shell serves them through Capacitor's file bridge.
function _scanPhotoSrc(p){
  try{
    const cap=window.Capacitor;
    if(cap&&typeof cap.convertFileSrc==='function')return cap.convertFileSrc(p.path);
  }catch(_e){}
  return p.path;
}
function _scanOpenPhoto(id,idx){
  const sc=getScans().find(x=>String(x.id)===String(id));
  if(!sc||!(sc.photos||[]).length)return;
  const n=sc.photos.length;
  const i=((idx%n)+n)%n;
  document.getElementById('_scan-photo-ov')?.remove();
  const ov=document.createElement('div');ov.id='_scan-photo-ov';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:10000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px';
  ov.innerHTML=
    '<img src="'+_scanPhotoSrc(sc.photos[i]).replace(/"/g,'&quot;')+'" style="max-width:94vw;max-height:74vh;border-radius:10px;object-fit:contain" alt="Scan photo '+(i+1)+'">'+
    '<div style="display:flex;align-items:center;gap:18px">'+
      '<button onclick="_scanOpenPhoto(\''+id+'\','+(i-1)+')" style="border:none;background:rgba(255,255,255,.16);color:#fff;font-size:20px;width:44px;height:44px;border-radius:22px;cursor:pointer">‹</button>'+
      '<div style="color:#fff;font-size:13px;font-weight:700">'+(i+1)+' of '+n+'</div>'+
      '<button onclick="_scanOpenPhoto(\''+id+'\','+(i+1)+')" style="border:none;background:rgba(255,255,255,.16);color:#fff;font-size:20px;width:44px;height:44px;border-radius:22px;cursor:pointer">›</button>'+
    '</div>'+
    '<button onclick="document.getElementById(\'_scan-photo-ov\').remove()" style="position:absolute;top:max(16px,env(safe-area-inset-top));right:16px;border:none;background:rgba(255,255,255,.16);color:#fff;font-size:18px;width:40px;height:40px;border-radius:20px;cursor:pointer">✕</button>';
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  document.body.appendChild(ov);
}

// ── Walk back through it ─────────────────────────────────────────────────────
// The question this answers: "show me the actual photo of THIS spot." Every
// walkthrough frame carries its camera pose (camera → world, column-major) and
// intrinsics, so for any world-space point we can rank which frame saw it
// best: in front of the lens, inside the picture with margin, facing it
// squarely, not too far. Returns {i,u,v} (frame index + pixel hit) or null.
function _scanBestFrame(sc,p){
  const walk=(sc&&sc.walk)||[];
  let best=null,bestScore=0;
  walk.forEach((k,i)=>{
    const m=k.cam;if(!m||m.length<16||!k.w||!k.h)return;
    // Rigid inverse: R^T and -R^T t, from the column-major camera pose.
    const dx=p.x-m[12],dy=p.y-m[13],dz=p.z-m[14];
    const cxp=m[0]*dx+m[1]*dy+m[2]*dz;      // camera-space x
    const cyp=m[4]*dx+m[5]*dy+m[6]*dz;      // camera-space y
    const czp=m[8]*dx+m[9]*dy+m[10]*dz;     // camera-space z (-forward)
    const zc=-czp;
    if(zc<0.25)return;                       // behind or on the lens
    const u=k.cx+k.fx*cxp/zc,v=k.cy-k.fy*cyp/zc;
    const mg=0.06;                           // keep the detail off the frame edge
    if(u<k.w*mg||v<k.h*mg||u>k.w*(1-mg)||v>k.h*(1-mg))return;
    const dist=Math.hypot(dx,dy,dz);
    if(dist>8)return;
    const facing=zc/(dist||1);               // 1 = dead ahead of the lens
    const score=facing/Math.max(0.35,dist);  // squarely seen beats barely seen
    if(score>bestScore){bestScore=score;best={i,u,v};}
  });
  return best;
}
// The re-walk viewer: the same overlay pattern as the shutter photos, over the
// walkthrough frames in capture order (prev/next IS re-walking the house),
// with an optional crosshair pinned on the detail that was tapped.
function _scanOpenWalk(id,idx,mark){
  const sc=getScans().find(x=>String(x.id)===String(id));
  const walk=(sc&&sc.walk)||[];
  if(!walk.length)return;
  const n=walk.length;
  const i=((idx%n)+n)%n;
  document.getElementById('_scan-photo-ov')?.remove();
  const ov=document.createElement('div');ov.id='_scan-photo-ov';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:10000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px';
  const k=walk[i];
  const markHtml=(mark&&k.w&&k.h)
    ?'<div style="position:absolute;left:'+(mark.u/k.w*100).toFixed(2)+'%;top:'+(mark.v/k.h*100).toFixed(2)+'%;width:34px;height:34px;margin:-17px 0 0 -17px;border:3px solid #FFD60A;border-radius:50%;box-shadow:0 0 0 2px rgba(0,0,0,.55)"></div>'
    :'';
  ov.innerHTML=
    '<div style="position:relative;max-width:94vw;max-height:74vh">'+
      '<img src="'+_scanPhotoSrc(k).replace(/"/g,'&quot;')+'" style="max-width:94vw;max-height:74vh;border-radius:10px;object-fit:contain;display:block" alt="Walkthrough photo '+(i+1)+'">'+
      markHtml+
    '</div>'+
    '<div style="display:flex;align-items:center;gap:18px">'+
      '<button onclick="_scanOpenWalk(\''+id+'\','+(i-1)+')" style="border:none;background:rgba(255,255,255,.16);color:#fff;font-size:20px;width:44px;height:44px;border-radius:22px;cursor:pointer">‹</button>'+
      '<div style="color:#fff;font-size:13px;font-weight:700">'+(i+1)+' of '+n+' · the walk, in order</div>'+
      '<button onclick="_scanOpenWalk(\''+id+'\','+(i+1)+')" style="border:none;background:rgba(255,255,255,.16);color:#fff;font-size:20px;width:44px;height:44px;border-radius:22px;cursor:pointer">›</button>'+
    '</div>'+
    '<button onclick="document.getElementById(\'_scan-photo-ov\').remove()" style="position:absolute;top:max(16px,env(safe-area-inset-top));right:16px;border:none;background:rgba(255,255,255,.16);color:#fff;font-size:18px;width:40px;height:40px;border-radius:20px;cursor:pointer">✕</button>';
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  document.body.appendChild(ov);
}

// ── Capture flow ─────────────────────────────────────────────────────────────
function _scanPlugin(){
  try{
    const cap=window.Capacitor;
    if(!cap||typeof cap.isNativePlatform!=='function'||!cap.isNativePlatform())return null;
    if(typeof cap.registerPlugin==='function')return cap.registerPlugin('TdScan');
    return (cap.Plugins&&cap.Plugins.TdScan)||null;
  }catch(_e){return null;}
}
async function scanIsSupported(){
  const P=_scanPlugin();
  if(!P||typeof P.isSupported!=='function')return false;
  try{const r=await P.isSupported();return !!(r&&r.supported);}catch(_e){return false;}
}
// ── Device capability gate ───────────────────────────────────────────────────
// RoomCaptureSession.isSupported is the ONLY truth here: it wants a real LiDAR
// sensor and iOS 17, so nothing hardcodes a model table that would rot with
// every September keynote. The answer cannot change for a given device, so it
// resolves once and is remembered: the chooser paints synchronously and cannot
// await a plugin round trip.
let _scanCapCache=null;   // true | false | null (not asked yet)
try{
  const _c=localStorage.getItem('td_scan_capable');
  if(_c==='1')_scanCapCache=true;else if(_c==='0')_scanCapCache=false;
}catch(_e){}
function _scanCapable(){
  if(!_scanPlugin())return false;      // browser or PWA: no scanner at all
  return _scanCapCache===true;
}
async function _scanCapRefresh(){
  if(!_scanPlugin()){_scanCapCache=false;return false;}
  const ok=await scanIsSupported();
  _scanCapCache=ok;
  try{localStorage.setItem('td_scan_capable',ok?'1':'0');}catch(_e){}
  return ok;
}
// Why the scan estimate is greyed out, and what to do about it. The model list
// is the ONLY place a device roster appears, and it is copy for humans, never
// a capability check.
function _scanWhyNoLidar(){
  if(document.getElementById('_scan-why-ov'))return;
  const inShell=!!_scanPlugin();
  const ov=document.createElement('div');ov.id='_scan-why-ov';ov.className='zmodal-overlay';ov.style.zIndex='9300';
  const m=document.createElement('div');m.className='zmodal';
  m.innerHTML=
    '<div class="zmodal-title">Scanning needs a Pro iPhone</div>'+
    '<div style="font-size:13px;color:var(--text2);line-height:1.6;margin-bottom:12px">'+
      (inShell
        ?'This iPhone doesn\'t have the LiDAR sensor, so it can\'t measure rooms. Everything else in TradeDesk works exactly the same.'
        :'Room scanning lives in the TradeDesk iPhone app, on a Pro model with LiDAR.')+
    '</div>'+
    '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:6px">Phones that can scan</div>'+
    '<div style="font-size:13px;color:var(--text2);line-height:1.6;margin-bottom:12px">'+
      'Every <strong>Pro</strong> iPhone since the iPhone 12 Pro: 12 Pro, 13 Pro, 14 Pro, 15 Pro, 16 Pro, 17 Pro, and every Pro Max. '+
      'iPad Pro from 2020 on also works.<br><span style="color:var(--text3)">Standard, Plus, mini, and e models don\'t have LiDAR, and neither does iPad Air.</span>'+
    '</div>'+
    '<div style="font-size:12px;color:var(--text3);line-height:1.55;margin-bottom:14px">You can still build any estimate by hand, price it, and send it. Scanning only replaces the measuring.</div>'+
    '<button class="btn btn-p" style="width:100%;padding:12px" onclick="document.getElementById(\'_scan-why-ov\').remove()">Got it</button>';
  ov.appendChild(m);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
}
// Five-second pre-flight, once per device: every scanner app buries the same
// three failure conditions in help docs people read AFTER a ruined scan
// (research 2026-08-09: doors open first, lights on, mirrors and glass lie to
// LiDAR). Surface them once, before the first capture ever starts.
function _scanPreflight(){
  try{if(localStorage.getItem('td_scan_preflight')==='1')return Promise.resolve(true);}catch(_e){}
  return new Promise(res=>{
    document.getElementById('_scan-pre-ov')?.remove();
    const ov=document.createElement('div');ov.id='_scan-pre-ov';ov.className='zmodal-overlay';
    const m=document.createElement('div');m.className='zmodal';
    const row=(icon,txt)=>'<div style="display:flex;align-items:center;gap:10px;padding:8px 0;font-size:13px"><span style="font-size:18px">'+icon+'</span><span>'+txt+'</span></div>';
    m.innerHTML=
      '<div class="zmodal-title">Before you scan</div>'+
      row('🚪','Open every door first, closed doors split the plan.')+
      row('💡','Lights on. LiDAR needs a lit room.')+
      row('🪞','Big mirrors and glass can fool the scan, expect to tidy those walls.')+
      '<button id="_scan-pre-go" class="btn btn-p" style="width:100%;margin-top:14px;padding:13px;font-weight:800">Got it, start scanning</button>';
    ov.appendChild(m);document.body.appendChild(ov);
    document.getElementById('_scan-pre-go').onclick=()=>{
      try{localStorage.setItem('td_scan_preflight','1');}catch(_e){}
      ov.remove();res(true);
    };
    ov.addEventListener('click',e=>{if(e.target===ov){ov.remove();res(false);}});
  });
}
// Fold a resumed capture into an existing scan. The resumed session shares
// the original's coordinate space (ARWorldMap relocalization), so rooms just
// append; photo room indexes shift by the rooms that already existed. Session
// artifacts (USDZ, photo mesh) only cover what one session walked, so a slot
// already filled is KEPT (it covers more) and only empty slots take the new
// files. Wall paint keys are roomIdx:wallId and indexes never move, so every
// saved color survives. Returns the saved scan, or null on empty geometry.
function _scanMergeResult(sc,res){
  if(!sc||!res)return null;
  const base=(sc.rooms||[]).length;
  const rooms=[];
  (res.rooms||[]).forEach((raw,i)=>{
    const r=_scanParseRoom(raw,(res.labels||[])[i]);
    if(r){r.story=Math.max(1,parseInt((res.stories||[])[i],10)||1);rooms.push(r);}
  });
  if(!rooms.length)return null;
  const grown=_scanExpandPins(rooms,res.pins); // pin-mode floors split into rooms
  sc.rooms=(sc.rooms||[]).concat(grown);
  _scanDedupeFloors(sc.rooms); // added rooms reclaim any area the old rooms bled into
  sc.photos=(sc.photos||[]).concat((res.photos||[]).map(p=>({path:p.path,cam:p.cam,room:(p.room|0)+base})));
  sc.walk=(sc.walk||[]).concat((res.walk||[]).map(k=>({path:k.path,cam:k.cam,fx:k.fx,fy:k.fy,cx:k.cx,cy:k.cy,w:k.w,h:k.h})));
  if(typeof res.worldMap==='string'&&res.worldMap)sc.worldMap=res.worldMap;   // newest map resumes best
  if(!sc.usdz&&typeof res.usdz==='string')sc.usdz=res.usdz;
  if(!sc.meshPly&&typeof res.meshPly==='string')sc.meshPly=res.meshPly;
  if(!sc.meshTex&&typeof res.meshTex==='string')sc.meshTex=res.meshTex;
  return saveScan(sc);
}
// Interrupted-scan recovery (owner 2026-08-10: phone auto-locked mid-scan and
// the whole floor was lost). Native keeps a draft after every finished room;
// this asks whether to pick it up. Same centered .zmodal pattern as the
// preflight sheet (§7.3). Resolves true (resume), false (start fresh), or
// null (backed out, do not scan).
function _scanDraftPrompt(d){
  return new Promise(res=>{
    document.getElementById('_scan-draft-ov')?.remove();
    const ov=document.createElement('div');ov.id='_scan-draft-ov';ov.className='zmodal-overlay';
    const m=document.createElement('div');m.className='zmodal';
    const n=d.count|0;
    const names=(Array.isArray(d.labels)?d.labels:[]).slice(0,4).map(x=>escHtml(String(x))).join(', ');
    m.innerHTML=
      '<div class="zmodal-title">Finish your last scan?</div>'+
      '<div style="font-size:13px;color:var(--text2);margin:6px 0 2px">A scan got cut off with '+n+' finished room'+(n===1?'':'s')+' saved'+(names?(': '+names):'')+'. Pick it up and keep walking, or start fresh.</div>'+
      '<button id="_scan-draft-go" class="btn btn-p" style="width:100%;margin-top:12px;padding:13px;font-weight:800">Pick up where I left off</button>'+
      '<button id="_scan-draft-no" class="btn" style="width:100%;margin-top:8px;padding:12px">Start fresh</button>';
    ov.appendChild(m);document.body.appendChild(ov);
    document.getElementById('_scan-draft-go').onclick=()=>{ov.remove();res(true);};
    document.getElementById('_scan-draft-no').onclick=()=>{ov.remove();res(false);};
    ov.addEventListener('click',e=>{if(e.target===ov){ov.remove();res(null);}});
  });
}
async function startRoomScan(ctx){
  const P=_scanPlugin();
  if(!P){if(typeof showToast==='function')showToast('Scanning needs the TradeDesk iPhone app','📐');return null;}
  if(!(await _scanPreflight()))return null;
  const resume=(ctx&&ctx.resumeScan)||null;
  const opts={labels:_SCAN_LABELS};
  if(resume&&resume.worldMap)opts.worldMap=resume.worldMap;
  // A grow-a-scan resume already targets a specific scan; the interruption
  // draft only applies to FRESH captures.
  if(!resume&&typeof P.pendingDraft==='function'){
    let draft=null;
    try{draft=await P.pendingDraft();}catch(_e){}
    if(draft&&draft.exists){
      const pick=await _scanDraftPrompt(draft);
      if(pick===null)return null;
      if(pick===true)opts.resumeDraft=true;
      else{try{P.discardDraft&&P.discardDraft();}catch(_e){}}
    }
  }
  let res=null;
  try{res=await P.startScan(opts);}catch(_e){return null;}
  if(!res||!Array.isArray(res.rooms)||!res.rooms.length){
    if(typeof showToast==='function')showToast('Scan cancelled','📐');
    return null;
  }
  if(resume){
    const merged=_scanMergeResult(resume,res);
    if(merged&&typeof showToast==='function')showToast('Added '+res.rooms.length+' room'+(res.rooms.length>1?'s':'')+' to '+(merged.name||'the scan'),'📐');
    else if(!merged&&typeof showToast==='function')showToast('Could not read the scan geometry','📐');
    return merged;
  }
  let rooms=[];
  res.rooms.forEach((raw,i)=>{
    const r=_scanParseRoom(raw,(res.labels||[])[i]);
    // The floor the user SAID they were on (the capture screen's Floor chip);
    // 1 when absent so pre-multi-floor scans stay single-story.
    if(r){r.story=Math.max(1,parseInt((res.stories||[])[i],10)||1);rooms.push(r);}
  });
  if(!rooms.length){if(typeof showToast==='function')showToast('Could not read the scan geometry','📐');return null;}
  rooms=_scanExpandPins(rooms,res.pins); // pin-mode floors split into per-room entries
  _scanDedupeFloors(rooms); // later-walked rooms own any bleed-through overlap
  const sc=saveScan({
    id:(typeof _newId==='function'?_newId():String(Date.now())),
    clientId:(ctx&&ctx.clientId)||null,jobId:(ctx&&ctx.jobId)||null,
    name:'Scan '+new Date().toLocaleDateString(),
    createdAt:new Date().toISOString(),
    headingDeg:(typeof res.headingDeg==='number'?res.headingDeg:null),
    // The camera's yaw in the scene's own frame at the instant the compass was
    // read. Without it headingDeg describes a direction nobody can locate: the
    // scene's zero is fixed when the session starts and the compass is sampled
    // two seconds later, by which time somebody walking into a room has turned.
    // scene-north = headingDeg - headingCamYawDeg.
    headingCamYawDeg:(typeof res.headingCamYawDeg==='number'?res.headingCamYawDeg:null),
    // What the phone said about the scan while it was being taken.
    coaching:Array.isArray(res.coaching)?res.coaching:[],
    trackingIssues:Array.isArray(res.trackingIssues)?res.trackingIssues:[],
    meshAnchorCount:(typeof res.meshAnchorCount==='number'?res.meshAnchorCount:null),
    rooms,
    // Photos stay device-local paths in v1 (the client deliverable excludes
    // them by design); cam pose rides along for the pinned walkthrough. The
    // USDZ is device-local too: the 3D/AR file Quick Look opens on this phone.
    photos:(res.photos||[]).map(p=>({path:p.path,cam:p.cam,room:p.room})),
    // The walkthrough record (owner 2026-08-10): every half-meter of the walk
    // kept as a full-res photo with its pose + intrinsics, so months later a
    // detail question ("what was behind that panel?") is answered by the
    // actual photo of that spot, from the plan or a tap on the 3D model.
    walk:(res.walk||[]).map(k=>({path:k.path,cam:k.cam,fx:k.fx,fy:k.fy,cx:k.cx,cy:k.cy,w:k.w,h:k.h})),
    usdz:(typeof res.usdz==='string'&&res.usdz)||null,
    // The photo mesh is device-local like the USDZ: the orbit viewer streams
    // it back out through the plugin's readFile. meshTex is the photoreal
    // textured tier; meshPly the vertex-color fallback.
    meshPly:(typeof res.meshPly==='string'&&res.meshPly)||null,
    meshTex:(typeof res.meshTex==='string'&&res.meshTex)||null,
    // The ARWorldMap: the key that lets a later session add rooms to THIS
    // scan in the same coordinate space. Device-local like the mesh.
    worldMap:(typeof res.worldMap==='string'&&res.worldMap)||null,
    price:(typeof S!=='undefined'&&S.scanDefaultPrice)||null,
    purchasedAt:null
  });
  if(typeof showToast==='function')showToast('Floor plan saved: '+rooms.length+' room'+(rooms.length>1?'s':''),'📐');
  return sc;
}
// Quick Look 3D/AR walkaround of the captured model (shell only, and only on
// the device that captured it, the USDZ never leaves the phone).
function _scanViewUsdz(id){
  const sc=getScans().find(x=>String(x.id)===String(id));
  const P=_scanPlugin();
  if(!sc||!sc.usdz||!P||typeof P.viewUsdz!=='function'){
    if(typeof showToast==='function')showToast('3D view lives on the phone that scanned it','📐');
    return;
  }
  Promise.resolve(P.viewUsdz({path:sc.usdz})).catch(()=>{
    if(typeof showToast==='function')showToast('Could not open the 3D model','📐');
  });
}
// The line under the sheet title: the client's address when we know it (the
// thing that makes the plan look like it belongs to a property), and which
// floor this sheet draws when there is more than one.
function _scanSheetSubtitle(sc,stories,story){
  const c=sc&&sc.clientId!=null&&typeof getClientById==='function'?getClientById(sc.clientId):null;
  const where=(c&&(c.address||c.name))||'';
  const floor=(stories&&stories.length>1)?('Floor '+story):'';
  return [where,floor].filter(Boolean).join(' · ');
}
// Distinct floors in a scan, ascending; single-story scans return [1].
function _scanStories(sc){
  const s=[...new Set((sc.rooms||[]).map(r=>Math.max(1,+r.story||1)))].sort((a,b)=>a-b);
  return s.length?s:[1];
}

// ── Viewer ───────────────────────────────────────────────────────────────────
let _scanViewLens=null;
let _scanViewStory=null;
function openScanViewer(id){
  const sc=getScans().find(x=>String(x.id)===String(id));
  if(!sc)return;
  _scanViewLens=_scanViewLens||_scanDefaultLens();
  // A lens this contractor is no longer shown (they switched active trade, or
  // the viewer remembered one from before the gate existed) must not strand
  // them on a tab with no button to leave it.
  const _allowed=_scanTabs().map(t=>t[0]);
  if(!_allowed.includes(_scanViewLens))_scanViewLens=_scanDefaultLens();
  const lens=_scanViewLens;
  const stories=_scanStories(sc);
  if(!stories.includes(_scanViewStory))_scanViewStory=stories[0];
  const story=_scanViewStory;
  document.getElementById('_scan-view-ov')?.remove();
  const totalSqFt=Math.round(_scanSqFt((sc.rooms||[]).reduce((t,r)=>t+_scanRoomGeom(r).floorM2,0)));
  const totalWallSqFt=Math.round(_scanSqFt((sc.rooms||[]).reduce((t,r)=>t+r.wallM2,0)));
  const tabs=_scanTabs();
  let body='';
  if(lens==='3d'){
    body='<div style="font-size:12px;color:var(--text2);line-height:1.5">The dollhouse, drawn straight from the measured walls'+(stories.length>1?', floors stacked with air between them':'')+'.</div>'+
      '<button class="btn btn-p" style="width:100%;margin-top:10px;padding:12px;font-weight:800" onclick="_scan3dOpen(\''+sc.id+'\')">Orbit it in 3D →</button>'+
      (sc.usdz&&_scanPlugin()?'<button class="btn" style="width:100%;margin-top:8px;padding:12px;font-weight:700" onclick="_scanViewUsdz(\''+sc.id+'\')">Walk it in AR</button>':'');
  }
  if(lens==='paint'){
    const sub=!!sc._paintSubtract;
    body='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'+
      '<div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--text3)">Paint takeoff</div>'+
      '<label style="font-size:11px;color:var(--text2);display:flex;align-items:center;gap:5px"><input type="checkbox" '+(sub?'checked':'')+' onchange="_scanToggleSubtract(\''+sc.id+'\',this.checked)"> subtract openings</label></div>'+
      _scanRoomsOnFloor(sc,stories,story).map(({r,ri})=>{const n=_scanPaintNumbers(r,sub);
        return '<div style="display:flex;justify-content:space-between;font-size:12px;padding:6px 0;border-bottom:1px solid var(--border)">'+
          _scanRoomNameHtml(sc.id,ri,r.label)+
          '<span style="color:var(--text2)">'+n.wallSqFt+' wall · '+n.ceilSqFt+' ceil sq ft · '+n.ceilHt+'</span></div>';}).join('')+
      '<button class="btn btn-p" style="width:100%;margin-top:12px;padding:12px" onclick="_scanToEstimate(\''+sc.id+'\')">Send rooms to estimate</button>';
  }else if(lens==='electrical'){
    body='<div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:8px">Receptacle layout · NEC 210.52</div>'+
      _scanRoomsOnFloor(sc,stories,story).map(({r,ri})=>{const n=_scanElectricalNumbers(r);
        return '<div style="display:flex;justify-content:space-between;font-size:12px;padding:6px 0;border-bottom:1px solid var(--border)">'+
          '<span>'+_scanRoomNameHtml(sc.id,ri,r.label)+(n.gfci?' <span style="color:#D97706;font-weight:800">GFCI</span>':'')+'</span>'+
          '<span style="color:var(--text2)">'+n.outlets+' outlets · '+n.switches+' switch'+(n.switches>1?'es':'')+(n.kitchenCounterNote?' · counter rule applies':'')+'</span></div>';}).join('')+
      '<div style="font-size:11px;color:var(--text3);margin-top:10px;line-height:1.5">Markers: no point over 6 ft from a receptacle (12 ft max apart), walls 2 ft+ count, doorways break the run. Heights: outlets 12" AFF typical, switches 48" typical (code max 6\'7"). Kitchen counters: 24" rule, planned separately. <strong>Estimate only, verify edition and amendments with your local AHJ.</strong></div>';
  }else if(lens==='hvac'){
    body='<div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:8px">Load calc inputs</div>'+
      '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;font-size:12px">ACH50 <input id="_scan-ach" type="number" step="0.1" value="'+(sc._ach50||7)+'" style="width:64px;padding:6px;border:1px solid var(--border2);border-radius:6px;background:var(--bg);color:var(--text)" onchange="_scanSetAch(\''+sc.id+'\',this.value)"> <span style="color:var(--text3)">from a blower door test; presets: leaky 10 · average 7 · tight 3</span></div>'+
      _scanRoomsOnFloor(sc,stories,story).map(({r,ri})=>{const n=_scanHvacNumbers(r,{ach50:sc._ach50});
        return '<div style="display:flex;justify-content:space-between;font-size:12px;padding:6px 0;border-bottom:1px solid var(--border)">'+
          _scanRoomNameHtml(sc.id,ri,r.label)+
          '<span style="color:var(--text2)">'+n.volFt3+' ft³ · '+n.winSqFt+' sq ft glass · infil '+n.infiltSensBtuh+' BTU/h</span></div>';}).join('')+
      '<div style="font-size:11px;color:var(--text3);margin-top:10px;line-height:1.5">Sizing estimate from scanned geometry + measured infiltration. <strong>Not for permit submission</strong>, permit-grade Manual J reports typically require ACCA-approved software. A blower door number beats any preset, and new-construction code already requires one (3 to 5 ACH50 by climate zone).</div>';
  }else if(lens!=='3d'){
    const unlocked=scanUnlocked(sc);
    body='<div style="font-size:12px;color:var(--text2)">'+(sc.rooms||[]).length+' rooms · '+totalWallSqFt+' wall sq ft · '+totalSqFt+' sq ft floor'+((sc.photos||[]).length?' · '+(sc.photos||[]).length+' photos':'')+'</div>'+
      // The rooms, by name, right here. This tab is where you land after a scan
      // and it had no room list at all, so the only way to correct a name the
      // capture chip guessed was to go hunting on the Paint tab.
      // THIS FLOOR's rooms, not every room in the building. The Floor tabs sit
      // directly above this list and the plan below it draws one floor at a
      // time; a list that ignored the selection contradicted both. The index
      // passed to the rename is the room's real index in sc.rooms, never the
      // filtered position, or renaming a room on floor 2 would rename whichever
      // room happened to sit at that slot on floor 1.
      (()=>{const rows=_scanRoomsOnFloor(sc,stories,story);
        return rows.length?'<div style="margin-top:10px">'+
          rows.map(x=>'<div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;padding:6px 0;border-bottom:1px solid var(--border)">'+
            _scanRoomNameHtml(sc.id,x.ri,x.r.label)+
            '<span style="color:var(--text3);font-size:11px">tap to rename</span></div>').join('')+
          '</div>':'';})()+
      '<div style="font-size:11px;color:var(--text3);margin-top:6px">Hub status: '+(unlocked?'unlocked, client sees the full plan':'locked, client sees a blurred teaser'+(sc.price!=null?' at $'+sc.price:''))+'</div>'+
      (sc.usdz&&_scanPlugin()?'<button class="btn" style="width:100%;margin-top:10px;padding:12px;font-weight:700" onclick="_scanViewUsdz(\''+sc.id+'\')">View in 3D · walk it in AR</button>':'')+
      // THE WAY OUT (owner 2026-08-10: "it looks like the scanner goes to
      // nowhere"). This tab is the one you land on, and every button on it was
      // about selling or deleting the plan. The scan exists to price work, and
      // the only path to that lived on the Paint tab where nobody would look.
      // It is the primary action here now; selling the plan is the side hustle
      // and reads like one.
      '<button class="btn btn-p" style="width:100%;margin-top:12px;padding:14px;font-size:15px;font-weight:800" onclick="_scanToEstimate(\''+sc.id+'\')">Build the estimate from these rooms →</button>'+
      // Re-walk the house: the auto-kept walkthrough frames, in capture
      // order. This is the record you come back to when a detail question
      // lands months later. Device-local, so only offered where the files are.
      ((sc.walk||[]).length&&_scanPlugin()?'<button class="btn" style="width:100%;margin-top:8px;padding:12px;font-weight:700" onclick="_scanOpenWalk(\''+sc.id+'\',0)">Re-walk the photos · '+sc.walk.length+' frames</button>':'')+
      // Growing and redoing (owner 2026-08-10: "no way to cancel a previous
      // scan and start over or add to it"). Add rooms needs this phone to
      // hold the scan's ARWorldMap; Start over just needs a scanner.
      (_scanPlugin()?'<div style="display:flex;gap:8px;margin-top:8px">'+
        (sc.worldMap?'<button class="btn" style="flex:1;padding:12px;font-weight:700" onclick="_scanAddRooms(\''+sc.id+'\')">Add rooms</button>':'')+
        '<button class="btn" style="flex:1;padding:12px;font-weight:700" onclick="_scanStartOver(\''+sc.id+'\')">Start over</button>'+
      '</div>':'')+
      '<div style="display:flex;gap:8px;margin-top:8px">'+
        '<button class="btn" style="flex:1;padding:12px" onclick="_scanSellSheet(\''+sc.id+'\')">'+(sc.purchasedAt?'Plan purchased ✓':'Sell floor plan')+'</button>'+
        (sc.price!=null&&!sc.purchasedAt?'<button class="btn" style="padding:12px" onclick="_scanMarkPurchased(\''+sc.id+'\')">Mark paid</button>':'')+
        '<button class="btn" style="padding:12px" onclick="deleteScan(\''+sc.id+'\');document.getElementById(\'_scan-view-ov\').remove();typeof _renderCDScans===\'function\'&&_renderCDScans()">Delete</button>'+
      '</div>';
  }
  const ov=document.createElement('div');ov.id='_scan-view-ov';ov.className='zmodal-overlay';
  const m=document.createElement('div');m.className='zmodal';m.style.maxWidth='560px';
  m.innerHTML=
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">'+
      '<div style="font-size:16px;font-weight:800">'+escHtml(sc.name||'Floor plan')+'</div>'+
      '<button onclick="document.getElementById(\'_scan-view-ov\').remove()" style="border:none;background:none;font-size:20px;cursor:pointer;color:var(--text3)">✕</button></div>'+
    '<div style="display:flex;gap:6px;margin-bottom:10px">'+
      tabs.map(([k,t])=>'<button onclick="_scanSetLens(\''+sc.id+'\',\''+k+'\')" class="btn btn-sm" style="flex:1;padding:8px;font-size:12px;'+(lens===k?'background:var(--blue);color:#fff;border-color:var(--blue)':'')+'">'+t+'</button>').join('')+
    '</div>'+
    // Floor switcher only when the scan actually spans floors, one plan per
    // floor (the deterministic per-floor pattern; no cross-floor 3D guessing).
    // The 3D tab shows the whole exploded stack instead, so no chips there.
    (stories.length>1&&lens!=='3d'?'<div style="display:flex;gap:6px;margin-bottom:10px">'+
      stories.map(st=>'<button onclick="_scanSetStory(\''+sc.id+'\','+st+')" class="btn btn-sm" style="flex:1;padding:7px;font-size:11px;font-weight:700;'+(story===st?'background:var(--text);color:var(--bg);border-color:var(--text)':'')+'">Floor '+st+'</button>').join('')+
    '</div>':'')+
    '<div style="border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:12px;background:var(--bg2)">'+
      (lens==='3d'?_scanDollhouseSvg(sc)
        :_scanPlanSvg(sc,{lens,scanId:sc.id,story:(stories.length>1?story:null),
          sheet:true,title:sc.name||'Floor plan',
          subtitle:_scanSheetSubtitle(sc,stories,story),
          photos:(lens==='plan'?(sc.photos||[]).filter(p=>{
            if(stories.length<2)return true;
            const r=(sc.rooms||[])[p.room];return r&&Math.max(1,+r.story||1)===story;
          }):null),
          // Walk dots only where the files are (device-local), and only on
          // the plan lens where the pins already live.
          walk:(lens==='plan'&&_scanPlugin()?sc.walk:null)}))+
    '</div>'+
    body;
  ov.appendChild(m);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
}
// ── Name a room whatever it actually is ──────────────────────────────────────
// Owner call (2026-08-10): "the ability to name a room is a click through
// rather than a custom name, I want a custom name."
//
// The capture chip cycles a fixed list, which is right WHILE scanning (you are
// holding the phone up walking the walls, and typing there is miserable), and
// wrong afterwards, because half of every real house is "Master bath", "Zach's
// office", "Back bedroom, the one with the bay window". So every room name in
// the viewer is tappable and takes free text.
//
// The label is what feeds the plan drawing, the takeoff rows, and the estimate
// line items, so renaming here renames it everywhere downstream, which is why
// it lives on the scan record rather than on the estimate.
// ── Name a room whatever it actually is ──────────────────────────────────────
// Owner call (2026-08-10): "the ability to name a room is a click through
// rather than a custom name, I want a custom name."
//
// The capture chip cycles a fixed list, which is right WHILE scanning (you are
// holding the phone up walking the walls, and typing there is miserable), and
// wrong afterwards, because half of every real house is "Master bath", "Zach's
// office", "Back bedroom, the one with the bay window". So every room name in
// the viewer is tappable and takes free text.
//
// The label is what feeds the plan drawing, the takeoff rows, and the estimate
// line items, so renaming here renames it everywhere downstream, which is why
// it lives on the scan record rather than on the estimate.
//
// Owner call (2026-08-19): the common-name picker started as tap-to-pick chips
// but that read as a scattered, wrapped cluster of pills, not clean. A single
// alphabetized list of rows covers the same common-name case in the same one
// tap, without the wrap. The text input underneath is still the fallback for
// "Zach's office" / "back bedroom with the bay window", same custom-name
// freedom the old prompt() gave. Built on .zmodal-overlay/.zmodal (see zAlert/
// zConfirm/zPrompt in utils.js and _tmConfirmScreen in true-measure.js), the
// app's one centered-modal convention (§7.3), not a hand-rolled sheet.
const _SCAN_RENAME_NAMES=['Attic','Basement','Bathroom','Bedroom','Closet','Dining Room','Exterior','Family Room','Garage','Hallway','Kitchen','Laundry Room','Living Room','Office','Primary Bathroom','Primary Bedroom'];
function _scanRenameRoom(id,idx){
  const sc=getScans().find(x=>String(x.id)===String(id));
  if(!sc||!sc.rooms||!sc.rooms[idx])return;
  document.getElementById('_scan-rename-ov')?.remove(); // never stack a stale one
  const cur=sc.rooms[idx].label||'';
  const apply=(raw)=>{
    const name=String(raw||'').trim();
    document.getElementById('_scan-rename-ov')?.remove();
    if(!name||name===cur)return;             // blank/unchanged is not a rename
    sc.rooms[idx].label=name;
    saveScan(sc);
    openScanViewer(id);
    if(typeof showToast==='function')showToast('Renamed to '+name,'✏️');
  };
  const ov=document.createElement('div');
  ov.className='zmodal-overlay';ov.id='_scan-rename-ov';
  ov.innerHTML=
    '<div class="zmodal">'+
      '<div class="zmodal-title">Name this room</div>'+
      '<div class="zmodal-msg" style="margin-bottom:6px">Tap a common name, or type your own.</div>'+
      '<div id="_scan-rename-list" style="max-height:240px;overflow-y:auto;border:1px solid var(--border2);border-radius:var(--r);margin-bottom:14px">'+
        _SCAN_RENAME_NAMES.map((n,i)=>'<div class="_scan-rename-row" data-name="'+escHtml(n)+'" style="padding:12px 14px;font-size:14px;font-weight:600;color:var(--text);cursor:pointer;'+(i<_SCAN_RENAME_NAMES.length-1?'border-bottom:1px solid var(--border2)':'')+'">'+escHtml(n)+'</div>').join('')+
      '</div>'+
      '<label style="font-size:11.5px;font-weight:700;color:var(--text3)">Custom name</label>'+
      '<input id="_scan-rename-inp" value="'+escHtml(cur)+'" style="width:100%;padding:10px;font-size:14px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);font-family:inherit;margin:6px 0 14px">'+
      '<div class="zmodal-btns">'+
        '<button class="btn zmodal-cancel" style="font-size:14px;padding:10px 16px">Cancel</button>'+
        '<button id="_scan-rename-ok" class="btn btn-p" style="font-size:14px;padding:10px 16px">Save</button>'+
      '</div>'+
    '</div>';
  document.body.appendChild(ov);
  ov.querySelectorAll('#_scan-rename-list ._scan-rename-row').forEach(row=>{
    row.onclick=()=>apply(row.getAttribute('data-name'));
  });
  const inp=ov.querySelector('#_scan-rename-inp');
  ov.querySelector('#_scan-rename-ok').onclick=()=>apply(inp.value);
  ov.querySelector('.zmodal-cancel').onclick=()=>ov.remove();
  inp.addEventListener('keydown',e=>{if(e.key==='Enter')apply(inp.value);});
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  setTimeout(()=>inp.focus(),100);
}
// A room name, rendered as the button it now is. One helper so the plan, paint,
// electrical and HVAC lists cannot drift apart on how a rename is offered.
function _scanRoomNameHtml(id,idx,label){
  return '<button onclick="_scanRenameRoom(\''+id+'\','+idx+')" title="Tap to rename" '+
    'style="border:none;background:none;padding:0;font:inherit;font-weight:700;color:var(--text);cursor:pointer;text-align:left;'+
    'border-bottom:1px dashed var(--border2)">'+escHtml(label||'Room')+'</button>';
}
// The rooms on the floor currently selected, carrying each room's REAL index in
// sc.rooms so a rename on floor 2 cannot hit whatever sits at that slot on
// floor 1. One helper for every lens: the Plan list had the floor filter and
// the Paint, Electrical and HVAC takeoffs did not, so a two-storey scan showed
// Floor 1 selected above a takeoff listing the whole building.
function _scanRoomsOnFloor(sc,stories,story){
  return (sc.rooms||[]).map((r,ri)=>({r,ri}))
    .filter(x=>!stories||stories.length<2||(+x.r.story||1)===story);
}
function _scanSetLens(id,lens){_scanViewLens=lens;openScanViewer(id);}
function _scanSetStory(id,st){_scanViewStory=Math.max(1,+st||1);openScanViewer(id);}
function _scanToggleSubtract(id,on){
  const sc=getScans().find(x=>String(x.id)===String(id));
  if(sc){sc._paintSubtract=!!on;saveScan(sc);openScanViewer(id);}
}
function _scanSetAch(id,v){
  const sc=getScans().find(x=>String(x.id)===String(id));
  if(sc){sc._ach50=Math.max(0.5,+v||7);saveScan(sc);openScanViewer(id);}
}
// Paint estimate handoff: rooms land in the paint flow as name + wall sq ft.
function _scanToEstimate(id){
  const sc=getScans().find(x=>String(x.id)===String(id));
  if(!sc)return;
  const sub=!!sc._paintSubtract;
  window._scanEstimateSeed={
    scanId:sc.id,clientId:sc.clientId,
    rooms:(sc.rooms||[]).map(r=>{const n=_scanPaintNumbers(r,sub);
      return {name:r.label,wallSqFt:n.wallSqFt,ceilSqFt:n.ceilSqFt,ceilHt:n.ceilHt,doors:n.doors,windows:n.windows};})
  };
  document.getElementById('_scan-view-ov')?.remove();
  // The seed is consumed by openGenericEstimate for this client (one row per
  // room, wall footage as the quantity), so the path is: land on the client,
  // tap New estimate, rooms are already lined.
  // openClientDetail, not openClient. openClient has never existed, so this
  // guard was always false and the comment above described a landing that
  // never happened: the scan overlay closed and the contractor was left
  // wherever they already were, with a toast telling them to go start an
  // estimate they had not been taken to.
  if(sc.clientId!=null&&typeof openClientDetail==='function'){openClientDetail(sc.clientId);}
  if(typeof showToast==='function')showToast('Rooms measured. Start an estimate for this client and they load in automatically.','📐');
}
// Standalone sale completion: collect the money through the normal payment
// flow (cash/check/card), then mark it here; purchasedAt is what unlocks the
// hub copy. In-hub Stripe checkout is the follow-up, this keeps the loop
// closed today with zero new payment plumbing.
function _scanMarkPurchased(id){
  const sc=getScans().find(x=>String(x.id)===String(id));
  if(!sc)return;
  sc.purchasedAt=new Date().toISOString();
  saveScan(sc);
  if(typeof showToast==='function')showToast('Floor plan unlocked in their hub','📐');
  openScanViewer(id);
}
// The sale: default price from Settings, per-scan override (owner call).
function _scanSellSheet(id){
  const sc=getScans().find(x=>String(x.id)===String(id));
  if(!sc)return;
  const cur=sc.price!=null?sc.price:((typeof S!=='undefined'&&S.scanDefaultPrice)||99);
  const v=prompt('Floor plan price for this client ($):',String(cur));
  if(v==null)return;
  sc.price=Math.max(0,Math.round(+v||0));
  saveScan(sc);
  if(typeof showToast==='function')showToast('Priced at $'+sc.price+'. It shows locked in their hub until signed and paid.','📐');
  openScanViewer(id);
}

// ── Client detail section ────────────────────────────────────────────────────
function _renderCDScans(){
  const el=document.getElementById('cd-scans-mount');
  if(!el)return;
  const cid=(typeof currentClientId!=='undefined')?currentClientId:null;
  if(cid==null){el.innerHTML='';return;}
  const list=getScans().filter(s=>String(s.clientId)===String(cid));
  const shell=!!_scanPlugin();
  el.innerHTML='<div class="card" style="padding:14px 16px">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:'+(list.length?'8px':'0')+'">'+
      '<div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--text3)">Floor plans</div>'+
      (shell&&_scanCapable()
        ?'<button class="btn btn-sm btn-p" style="padding:7px 12px;font-size:12px" onclick="_scanStartForClient()">'+ (typeof svgIcon==='function'?svgIcon('📐',{size:13}):'')+' Scan rooms</button>'
        :'<button class="btn btn-sm" style="padding:7px 12px;font-size:12px;opacity:.6" onclick="_scanWhyNoLidar()">Scan rooms · needs a Pro iPhone</button>')+
    '</div>'+
    list.map(s=>{
      const wsqft=Math.round(_scanSqFt((s.rooms||[]).reduce((t,r)=>t+r.wallM2,0)));
      const unlocked=scanUnlocked(s);
      return '<div onclick="openScanViewer(\''+s.id+'\')" style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-top:1px solid var(--border);cursor:pointer">'+
        '<div><div style="font-size:13px;font-weight:700">'+escHtml(s.name||'Floor plan')+'</div>'+
        '<div style="font-size:11px;color:var(--text3)">'+(s.rooms||[]).length+' rooms · '+wsqft+' wall sq ft'+(s.price!=null?' · $'+s.price:'')+'</div></div>'+
        '<span class="bdg '+(unlocked?'bdg-active':'bdg-upcoming')+'">'+(unlocked?'Unlocked':'Locked')+'</span></div>';
    }).join('')+
  '</div>';
}
async function _scanStartForClient(){
  const cid=(typeof currentClientId!=='undefined')?currentClientId:null;
  const supported=await _scanCapRefresh();
  if(!supported){_scanWhyNoLidar();return;}
  const sc=await startRoomScan({clientId:cid});
  if(sc){_renderCDScans();openScanViewer(sc.id);}
}
// Add rooms to a scan that already exists ("there is no way to add to it,
// why": owner 2026-08-10). Needs the scan's saved ARWorldMap on this phone,
// so the button only shows where it can work.
async function _scanAddRooms(id){
  const sc=getScans().find(x=>String(x.id)===String(id));
  if(!sc||!sc.worldMap)return;
  document.getElementById('_scan-view-ov')?.remove();
  const merged=await startRoomScan({resumeScan:sc});
  if(typeof _renderCDScans==='function')_renderCDScans();
  openScanViewer(id);
  return merged;
}
// Start the scan over: capture the replacement FIRST, and only when it saves
// does the old scan (and its plan, photos, paint picks) get deleted. Backing
// out of the capture costs nothing.
async function _scanStartOver(id){
  const sc=getScans().find(x=>String(x.id)===String(id));
  if(!sc)return;
  document.getElementById('_scan-view-ov')?.remove();
  const fresh=await startRoomScan({clientId:sc.clientId,jobId:sc.jobId});
  if(fresh){
    deleteScan(sc.id);
    if(typeof _renderCDScans==='function')_renderCDScans();
    openScanViewer(fresh.id);
    if(typeof showToast==='function')showToast('Fresh scan saved, the old one is gone','📐');
  }else{
    openScanViewer(id);
  }
}
// Ask the device once, at load, so every surface that gates on LiDAR can paint
// synchronously from here on. Silent no-op outside the shell.
try{if(_scanPlugin())_scanCapRefresh().catch(()=>{});}catch(_e){}
