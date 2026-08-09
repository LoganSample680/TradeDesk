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
  // Returns {col0:{x,y,z}, col3:{x,y,z}} (direction + translation), from a
  // flat 16-array (column-major) or nested [[..4],[..4],[..4],[..4]].
  if(!m)return null;
  let f=null;
  if(Array.isArray(m)&&m.length===16)f=m.map(Number);
  else if(Array.isArray(m)&&m.length===4&&Array.isArray(m[0])){f=[];m.forEach(c=>c.forEach(x=>f.push(+x)));}
  else if(m.columns){f=[];[0,1,2,3].forEach(i=>{const c=_scanVec(m.columns[i]);f.push(c.x,c.y,c.z,0);});}
  if(!f||f.length<16)return null;
  return {col0:{x:f[0],y:f[1],z:f[2]},col3:{x:f[12],y:f[13],z:f[14]}};
}
function _scanDims(d){
  const v=_scanVec(d);return v?{w:Math.abs(v.x),h:Math.abs(v.y)}:{w:0,h:0};
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
      len:d.w,h:d.h||2.44,doors:[],windows:[]};
    walls.push(wall);wallById[wall.id]=wall;
  });
  const placeOpening=(o,list,isDoor)=>{
    const m=_scanMat(o.transform),d=_scanDims(o.dimensions);
    if(!m||!d.w)return;
    const rec={w:d.w,h:d.h||2,area:d.w*(d.h||2)};
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
  (cr.doors||[]).forEach(o=>placeOpening(o,doors,true));
  (cr.openings||[]).forEach(o=>placeOpening(o,doors,true)); // an archway breaks wall space like a door
  (cr.windows||[]).forEach(o=>placeOpening(o,windows,false));
  // Floor polygon: floors[0].polygonCorners (iOS 17) or the wall endpoints hull.
  let poly=null;
  const fl=(cr.floors||[])[0];
  if(fl&&Array.isArray(fl.polygonCorners)&&fl.polygonCorners.length>=3){
    const fm=_scanMat(fl.transform);
    poly=fl.polygonCorners.map(p=>{const v=_scanVec(p);return [v.x+(fm?fm.col3.x:0),v.z+(fm?fm.col3.z:0)];});
  }
  if(!poly){
    poly=[];walls.forEach(w=>{poly.push([w.ax,w.az]);poly.push([w.bx,w.bz]);});
    poly=_scanHull(poly);
  }
  const floorM2=Math.abs(_scanShoelace(poly));
  const wallM2=walls.reduce((t,w)=>t+w.len*w.h,0);
  const openM2=doors.reduce((t,o)=>t+o.area,0)+windows.reduce((t,o)=>t+o.area,0);
  const perimM=walls.reduce((t,w)=>t+w.len,0);
  const hM=walls.length?Math.max(...walls.map(w=>w.h)):2.44;
  return {label:label||'Room',walls,poly,floorM2,wallM2,openM2,perimM,hM,
          doorN:doors.length,winN:windows.length,winM2:windows.reduce((t,o)=>t+o.area,0)};
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
// The scan opens in the lens matching the business trade (owner directive
// 2026-08-09); every other lens stays one toggle away.
function _scanDefaultLens(){
  const t=String((typeof S!=='undefined'&&(S.trade||S.industry))||'').toLowerCase();
  if(/paint/.test(t))return 'paint';
  if(/electric/.test(t))return 'electrical';
  if(/hvac|heat|cool|air/.test(t))return 'hvac';
  return 'plan';
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
const _SCAN_NEC={maxGapFt:12,fromBreakFt:6,minWallFt:2,
  outletsInTypical:12,switchInTypical:48,switchInMaxCode:79,
  gfciRooms:['kitchen','bathroom','garage','laundry','basement','outdoor']};
function _scanOutletPlan(room){
  const out=[];
  room.walls.forEach(w=>{
    // Split the wall into wall spaces at door edges.
    const breaks=[[0,w.len]];
    (w.doors||[]).slice().sort((a,b)=>(a.off||0)-(b.off||0)).forEach(d=>{
      const seg=breaks.pop();
      const dA=Math.max(seg[0],(d.off||0)-d.w/2),dB=Math.min(seg[1],(d.off||0)+d.w/2);
      if(dA>seg[0])breaks.push([seg[0],dA]);
      if(dB<seg[1])breaks.push([dB,seg[1]]);
      else if(dA<=seg[0])breaks.push(seg); // door outside segment, keep as-is
    });
    breaks.forEach(([a,b])=>{
      const lenFt=_scanFt(b-a);
      if(lenFt<_SCAN_NEC.minWallFt)return;           // under 2 ft, no requirement
      // First within 6 ft of each break, then every 12 ft: N = ceil(len/12),
      // spread evenly so no point sits more than 6 ft out.
      const n=Math.max(1,Math.ceil(lenFt/_SCAN_NEC.maxGapFt));
      for(let i=0;i<n;i++){
        const t=(a+(b-a)*((i+0.5)/n));
        const ux=(w.bx-w.ax)/w.len,uz=(w.bz-w.az)/w.len;
        out.push({x:w.ax+ux*t,z:w.az+uz*t,wallId:w.id});
      }
    });
  });
  return out;
}
function _scanElectricalNumbers(room){
  const outlets=_scanOutletPlan(room);
  const label=String(room.label||'').toLowerCase();
  return {
    outlets:outlets.length,
    marks:outlets,
    switches:1+(room.doorN>1?room.doorN-1:0),   // one per entry as the working default
    gfci:_SCAN_NEC.gfciRooms.some(r=>label.includes(r)),
    kitchenCounterNote:/kitchen/.test(label)
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

// ── Floor plan SVG ───────────────────────────────────────────────────────────
// Drawn to real drafting conventions (research 2026-08-09), because that is
// what separates a professional plan from a toy one: walls as solid poché
// (the double-line look), door gaps with quarter-circle swing arcs, windows
// drawn IN the wall with glazing lines, dimensions pushed outside the wall,
// and a north arrow when the compass grabbed a heading. RoomPlan hands us
// clean parametric vectors, so the render is CAD-crisp where competitors
// trace wobbly meshes.
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
  let minX=1e9,minZ=1e9,maxX=-1e9,maxZ=-1e9;
  rooms.forEach(r=>(r.poly||[]).forEach(([x,z])=>{minX=Math.min(minX,x);minZ=Math.min(minZ,z);maxX=Math.max(maxX,x);maxZ=Math.max(maxZ,z);}));
  if(minX>maxX)return '<svg viewBox="0 0 100 40"></svg>';
  const pad=1.0,W=maxX-minX+pad*2,H=maxZ-minZ+pad*2;
  const k=100/W;                                   // meters → viewBox units
  const px=x=>+((x-minX+pad)*k).toFixed(2);
  const pz=z=>+((z-minZ+pad)*k).toFixed(2);
  const vh=(H*k).toFixed(2);
  // Poché thickness: reads as a real ~5in wall at whole-house scale, clamped
  // so a single small room doesn't render cartoon-fat walls.
  const th=Math.max(0.9,Math.min(2.2,0.13*k));
  const ink='var(--text,#1a1a18)',bg='var(--bg,#fff)';
  let s='<svg viewBox="0 0 100 '+vh+'" style="width:100%;height:auto;display:block" xmlns="http://www.w3.org/2000/svg">';
  // 1. Room fills first (tappable when the caller wires roomClick).
  // roomFills tints rooms by ORIGINAL index (the proposal color-keys the
  // rooms that carry quote lines); untinted rooms stay paper-white.
  rooms.forEach((r,ri)=>{
    const pts=(r.poly||[]).map(([x,z])=>px(x)+','+pz(z)).join(' ');
    const fill=(o.roomFills&&o.roomFills[gidx[ri]])||bg;
    s+='<polygon points="'+pts+'" fill="'+fill+'" stroke="none"'+
       (o.roomClick?' onclick="'+o.roomClick+'('+gidx[ri]+')" style="cursor:pointer"':'')+'/>';
  });
  // 2. Walls as solid poché segments; square caps close the corners.
  rooms.forEach(r=>(r.walls||[]).forEach(w=>{
    s+='<line x1="'+px(w.ax)+'" y1="'+pz(w.az)+'" x2="'+px(w.bx)+'" y2="'+pz(w.bz)+'" stroke="'+ink+'" stroke-width="'+th.toFixed(2)+'" stroke-linecap="square"/>';
  }));
  // 3. Openings punched into the poché: door gap + swing arc, window glazing.
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
      const at=d=>[w.ax+ux*d,w.az+uz*d];
      const punch=(d0,d1)=>{const[a1,b1]=at(d0),[a2,b2]=at(d1);
        s+='<line x1="'+px(a1)+'" y1="'+pz(b1)+'" x2="'+px(a2)+'" y2="'+pz(b2)+'" stroke="'+bg+'" stroke-width="'+(th+0.35).toFixed(2)+'"/>';};
      (w.doors||[]).forEach(d=>{
        if(typeof d.off!=='number'||!d.w)return;
        const d0=Math.max(0,Math.min(w.len-d.w,d.off-d.w/2)),d1=d0+d.w;
        punch(d0,d1);
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
  // 4. Dimensions on the two longest walls per room, pushed OUTSIDE the wall.
  rooms.forEach(r=>{
    const cx0=(r.poly||[]).reduce((t,p)=>t+p[0],0)/((r.poly||[]).length||1);
    const cz0=(r.poly||[]).reduce((t,p)=>t+p[1],0)/((r.poly||[]).length||1);
    (r.walls||[]).slice().sort((a,b)=>b.len-a.len).slice(0,2).forEach(w=>{
      if(!w.len)return;
      const mx=(w.ax+w.bx)/2,mz=(w.az+w.bz)/2;
      const ux=(w.bx-w.ax)/w.len,uz=(w.bz-w.az)/w.len;
      let nx=-uz,nz=ux;
      if(nx*(cx0-mx)+nz*(cz0-mz)>0){nx=-nx;nz=-nz;}   // away from the room
      const off=(th+2.0)/k;
      s+='<text x="'+px(mx+nx*off)+'" y="'+(pz(mz+nz*off)+0.9)+'" font-size="2.5" fill="var(--text3,#6a6963)" text-anchor="middle">'+_scanFtIn(w.len)+'</text>';
    });
  });
  // 5. Labels: name + the billing number (wall sq ft leads, owner 2026-08-09).
  rooms.forEach((r,ri)=>{
    const cx=(r.poly||[]).reduce((t,p)=>t+p[0],0)/((r.poly||[]).length||1);
    const cz=(r.poly||[]).reduce((t,p)=>t+p[1],0)/((r.poly||[]).length||1);
    const g=o.roomClick?'<g onclick="'+o.roomClick+'('+gidx[ri]+')" style="cursor:pointer">':'<g>';
    s+=g+'<text x="'+px(cx)+'" y="'+(pz(cz)-1.6)+'" font-size="3.2" font-weight="700" fill="'+ink+'" text-anchor="middle">'+escHtml(r.label||'Room')+'</text>'+
      '<text x="'+px(cx)+'" y="'+(pz(cz)+2.2)+'" font-size="2.8" fill="var(--text2,#5f5e5a)" text-anchor="middle">'+Math.round(_scanSqFt(r.wallM2))+' wall sq ft</text></g>';
    if(lens==='electrical'){
      _scanOutletPlan(r).forEach(m=>{
        s+='<circle cx="'+px(m.x)+'" cy="'+pz(m.z)+'" r="1.1" fill="#D97706" stroke="#fff" stroke-width="0.3"/>';
      });
    }
  });
  // 6. North arrow when the compass grabbed a heading at capture.
  if(typeof sc.headingDeg==='number'&&sc.headingDeg>=0){
    s+='<g transform="translate(95,5) rotate('+Math.round(sc.headingDeg)+')">'+
       '<circle r="3" fill="none" stroke="var(--text3,#6a6963)" stroke-width="0.3"/>'+
       '<path d="M 0 -2.2 L 1 1.6 L 0 0.7 L -1 1.6 Z" fill="'+ink+'"/>'+
       '<text y="-4" font-size="2.2" fill="var(--text3,#6a6963)" text-anchor="middle">N</text></g>';
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
async function startRoomScan(ctx){
  const P=_scanPlugin();
  if(!P){if(typeof showToast==='function')showToast('Scanning needs the TradeDesk iPhone app','📐');return null;}
  if(!(await _scanPreflight()))return null;
  let res=null;
  try{res=await P.startScan({labels:_SCAN_LABELS});}catch(_e){return null;}
  if(!res||!Array.isArray(res.rooms)||!res.rooms.length){
    if(typeof showToast==='function')showToast('Scan cancelled','📐');
    return null;
  }
  const rooms=[];
  res.rooms.forEach((raw,i)=>{
    const r=_scanParseRoom(raw,(res.labels||[])[i]);
    // The floor the user SAID they were on (the capture screen's Floor chip);
    // 1 when absent so pre-multi-floor scans stay single-story.
    if(r){r.story=Math.max(1,parseInt((res.stories||[])[i],10)||1);rooms.push(r);}
  });
  if(!rooms.length){if(typeof showToast==='function')showToast('Could not read the scan geometry','📐');return null;}
  const sc=saveScan({
    id:(typeof _newId==='function'?_newId():String(Date.now())),
    clientId:(ctx&&ctx.clientId)||null,jobId:(ctx&&ctx.jobId)||null,
    name:'Scan '+new Date().toLocaleDateString(),
    createdAt:new Date().toISOString(),
    headingDeg:(typeof res.headingDeg==='number'?res.headingDeg:null),
    rooms,
    // Photos stay device-local paths in v1 (the client deliverable excludes
    // them by design); cam pose rides along for the pinned walkthrough. The
    // USDZ is device-local too: the 3D/AR file Quick Look opens on this phone.
    photos:(res.photos||[]).map(p=>({path:p.path,cam:p.cam,room:p.room})),
    usdz:(typeof res.usdz==='string'&&res.usdz)||null,
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
  const lens=_scanViewLens;
  const stories=_scanStories(sc);
  if(!stories.includes(_scanViewStory))_scanViewStory=stories[0];
  const story=_scanViewStory;
  document.getElementById('_scan-view-ov')?.remove();
  const totalSqFt=Math.round(_scanSqFt((sc.rooms||[]).reduce((t,r)=>t+r.floorM2,0)));
  const totalWallSqFt=Math.round(_scanSqFt((sc.rooms||[]).reduce((t,r)=>t+r.wallM2,0)));
  const tabs=[['plan','Plan'],['3d','3D'],['paint','Paint'],['electrical','Electrical'],['hvac','HVAC']];
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
      (sc.rooms||[]).map(r=>{const n=_scanPaintNumbers(r,sub);
        return '<div style="display:flex;justify-content:space-between;font-size:12px;padding:6px 0;border-bottom:1px solid var(--border)">'+
          '<span style="font-weight:700">'+escHtml(r.label)+'</span>'+
          '<span style="color:var(--text2)">'+n.wallSqFt+' wall · '+n.ceilSqFt+' ceil sq ft · '+n.ceilHt+'</span></div>';}).join('')+
      '<button class="btn btn-p" style="width:100%;margin-top:12px;padding:12px" onclick="_scanToEstimate(\''+sc.id+'\')">Send rooms to estimate</button>';
  }else if(lens==='electrical'){
    body='<div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:8px">Receptacle layout · NEC 210.52</div>'+
      (sc.rooms||[]).map(r=>{const n=_scanElectricalNumbers(r);
        return '<div style="display:flex;justify-content:space-between;font-size:12px;padding:6px 0;border-bottom:1px solid var(--border)">'+
          '<span style="font-weight:700">'+escHtml(r.label)+(n.gfci?' <span style="color:#D97706;font-weight:800">GFCI</span>':'')+'</span>'+
          '<span style="color:var(--text2)">'+n.outlets+' outlets · '+n.switches+' switch'+(n.switches>1?'es':'')+(n.kitchenCounterNote?' · counter rule applies':'')+'</span></div>';}).join('')+
      '<div style="font-size:11px;color:var(--text3);margin-top:10px;line-height:1.5">Markers: no point over 6 ft from a receptacle (12 ft max apart), walls 2 ft+ count, doorways break the run. Heights: outlets 12" AFF typical, switches 48" typical (code max 6\'7"). Kitchen counters: 24" rule, planned separately. <strong>Estimate only, verify edition and amendments with your local AHJ.</strong></div>';
  }else if(lens==='hvac'){
    body='<div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:8px">Load calc inputs</div>'+
      '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;font-size:12px">ACH50 <input id="_scan-ach" type="number" step="0.1" value="'+(sc._ach50||7)+'" style="width:64px;padding:6px;border:1px solid var(--border2);border-radius:6px;background:var(--bg);color:var(--text)" onchange="_scanSetAch(\''+sc.id+'\',this.value)"> <span style="color:var(--text3)">from a blower door test; presets: leaky 10 · average 7 · tight 3</span></div>'+
      (sc.rooms||[]).map(r=>{const n=_scanHvacNumbers(r,{ach50:sc._ach50});
        return '<div style="display:flex;justify-content:space-between;font-size:12px;padding:6px 0;border-bottom:1px solid var(--border)">'+
          '<span style="font-weight:700">'+escHtml(r.label)+'</span>'+
          '<span style="color:var(--text2)">'+n.volFt3+' ft³ · '+n.winSqFt+' sq ft glass · infil '+n.infiltSensBtuh+' BTU/h</span></div>';}).join('')+
      '<div style="font-size:11px;color:var(--text3);margin-top:10px;line-height:1.5">Sizing estimate from scanned geometry + measured infiltration. <strong>Not for permit submission</strong>, permit-grade Manual J reports typically require ACCA-approved software. A blower door number beats any preset, and new-construction code already requires one (3 to 5 ACH50 by climate zone).</div>';
  }else if(lens!=='3d'){
    const unlocked=scanUnlocked(sc);
    body='<div style="font-size:12px;color:var(--text2)">'+(sc.rooms||[]).length+' rooms · '+totalWallSqFt+' wall sq ft · '+totalSqFt+' sq ft floor'+((sc.photos||[]).length?' · '+(sc.photos||[]).length+' photos':'')+'</div>'+
      '<div style="font-size:11px;color:var(--text3);margin-top:6px">Hub status: '+(unlocked?'unlocked, client sees the full plan':'locked, client sees a blurred teaser'+(sc.price!=null?' at $'+sc.price:''))+'</div>'+
      (sc.usdz&&_scanPlugin()?'<button class="btn" style="width:100%;margin-top:10px;padding:12px;font-weight:700" onclick="_scanViewUsdz(\''+sc.id+'\')">View in 3D · walk it in AR</button>':'')+
      '<div style="display:flex;gap:8px;margin-top:12px">'+
        '<button class="btn btn-p" style="flex:1;padding:12px" onclick="_scanSellSheet(\''+sc.id+'\')">'+(sc.purchasedAt?'Plan purchased ✓':'Sell floor plan')+'</button>'+
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
          photos:(lens==='plan'?(sc.photos||[]).filter(p=>{
            if(stories.length<2)return true;
            const r=(sc.rooms||[])[p.room];return r&&Math.max(1,+r.story||1)===story;
          }):null)}))+
    '</div>'+
    body;
  ov.appendChild(m);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
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
  if(sc.clientId!=null&&typeof openClient==='function'){openClient(sc.clientId);}
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
// Ask the device once, at load, so every surface that gates on LiDAR can paint
// synchronously from here on. Silent no-op outside the shell.
try{if(_scanPlugin())_scanCapRefresh().catch(()=>{});}catch(_e){}
