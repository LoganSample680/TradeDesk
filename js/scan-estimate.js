// ── Scan Estimate: the standalone smart estimate type ────────────────────────
// Owner directive (2026-08-09): scanned estimates stand alone with advanced
// features the competitors don't have, not rooms poured into the generic
// builder. What "smart" means here, all of it derived from measured geometry:
//
//   • Per-room takeoff cards: include/exclude rooms, toggle surfaces (walls,
//     ceiling, trim, doors, windows), every quantity MEASURED, never typed.
//   • Per-surface production rates (walls and ceilings by the sq ft, trim by
//     the linear ft, doors and windows each), saved once in S.scanRates.
//   • Auto difficulty: a room whose MEASURED ceiling tops 9 ft arrives with
//     the high-ceiling multiplier already flagged; heavy prep and color
//     change are one tap. Multipliers bake into the line RATE so qty x rate
//     stays honest on the proposal and in every money view.
//   • Electrician mode: rooms bill by DEVICE COUNT from the NEC engine
//     (outlets, switches, GFCI upcharge), which is exactly how residential
//     electricians unit-price, with the counts code-derived instead of
//     walked off.
//   • The finished proposal embeds the client's own measured floor plan,
//     which no competitor CRM can produce.
//
// The output hands into the EXISTING generic-estimate pipeline (lines, tax,
// deposit, signing, hub) per §7.3: this module owns the SMART half, never a
// parallel proposal machine.

const _SCANEST_HIGH_CEIL_M=2.75;          // ~9 ft: auto-flag the multiplier
const _SCANEST_MULTS=[
  {k:'highCeil',label:'High ceilings',pct:25,auto:true},
  {k:'prep',label:'Heavy prep',pct:15,auto:false},
  {k:'color',label:'Color change',pct:10,auto:false},
];
function _scanRates(){
  if(!S.scanRates)S.scanRates={wall:(+S.scanRateSqFt||0),ceiling:0,trimLf:0,door:0,window:0};
  return S.scanRates;
}
function _scanElecRates(){
  if(!S.scanElecRates)S.scanElecRates={outlet:0,sw:0,gfci:0};
  return S.scanElecRates;
}
let _seState=null;   // {c, scan, rooms:[{on,surf:{},mults:{}}]}

function openScanEstimate(c){
  const list=getScans().filter(s=>String(s.clientId)===String(c&&c.id));
  if(!list.length){
    const ov=document.createElement('div');ov.className='zmodal-overlay';ov.id='_se-noscan-ov';
    const m=document.createElement('div');m.className='zmodal';
    m.innerHTML='<div style="font-size:16px;font-weight:800;margin-bottom:6px">No scans for this client yet</div>'+
      '<div style="font-size:13px;color:var(--text2);line-height:1.55;margin-bottom:14px">Walk their rooms with the TradeDesk iPhone app (Pro, LiDAR) and every wall, ceiling, door, and window measures itself. The estimate builds from those numbers.</div>'+
      (_scanPlugin()?'<button class="btn btn-p" style="width:100%;padding:12px;margin-bottom:8px" onclick="document.getElementById(\'_se-noscan-ov\').remove();_scanStartForClient()">Scan rooms now</button>':'')+
      '<button class="btn" style="width:100%;padding:11px" onclick="document.getElementById(\'_se-noscan-ov\').remove()">Close</button>';
    ov.appendChild(m);document.body.appendChild(ov);
    ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
    return;
  }
  const scan=list[list.length-1];
  _seState={c,scan,rooms:(scan.rooms||[]).map(r=>({
    on:true,
    surf:{wall:true,ceiling:false,trim:false,door:false,window:false},
    mults:{highCeil:r.hM>=_SCANEST_HIGH_CEIL_M,prep:false,color:false}
  }))};
  _seRender();
}
// Measured quantities for one room, by surface.
function _seQty(r,surfKey){
  if(surfKey==='wall')return Math.round(_scanSqFt(Math.max(0,r.wallM2-(0))));
  if(surfKey==='ceiling')return Math.round(_scanSqFt(r.floorM2));
  if(surfKey==='trim')return Math.round(_scanFt(r.perimM));
  if(surfKey==='door')return r.doorN||0;
  if(surfKey==='window')return r.winN||0;
  return 0;
}
const _SE_SURFS=[
  {k:'wall',label:'Walls',unit:'sq ft',rateKey:'wall'},
  {k:'ceiling',label:'Ceiling',unit:'sq ft',rateKey:'ceiling'},
  {k:'trim',label:'Trim',unit:'ln ft',rateKey:'trimLf'},
  {k:'door',label:'Doors',unit:'ea',rateKey:'door'},
  {k:'window',label:'Windows',unit:'ea',rateKey:'window'},
];
function _seIsElec(){return _scanDefaultLens()==='electrical';}
function _seMultPct(st){return _SCANEST_MULTS.reduce((t,m)=>t+(st.mults[m.k]?m.pct:0),0);}
// One room's priced lines (painter surfaces or electrician devices).
function _seRoomLines(r,st){
  const out=[];
  const pct=_seMultPct(st);
  const bake=rate=>Math.round(rate*(1+pct/100)*100)/100;
  const multNote=pct>0?(' · +'+pct+'% ('+_SCANEST_MULTS.filter(m=>st.mults[m.k]).map(m=>m.label.toLowerCase()).join(', ')+')'):'';
  if(_seIsElec()){
    const er=_scanElecRates();
    const n=_scanElectricalNumbers(r);
    if(n.outlets)out.push({desc:r.label+' · receptacles (NEC-spaced)',qty:n.outlets,unit:'ea',rate:bake(+er.outlet||0),notes:'Count from scanned walls per NEC 210.52'+multNote});
    if(n.switches)out.push({desc:r.label+' · switches',qty:n.switches,unit:'ea',rate:bake(+er.sw||0),notes:'One per entry'+multNote});
    if(n.gfci)out.push({desc:r.label+' · GFCI protection',qty:1,unit:'lot',rate:bake(+er.gfci||0),notes:'GFCI-required room'+multNote});
  }else{
    const rates=_scanRates();
    _SE_SURFS.forEach(s=>{
      if(!st.surf[s.k])return;
      const qty=_seQty(r,s.k);
      if(!qty)return;
      out.push({desc:r.label+' · '+s.label.toLowerCase()+' ('+qty+' '+s.unit+')',qty,unit:s.unit,rate:bake(+rates[s.rateKey]||0),notes:'Measured by LiDAR scan'+multNote});
    });
  }
  return out.map(l=>({...l,total:Math.round(l.qty*l.rate*100)/100,_byoSection:'Interior'}));
}
function _seTotal(){
  if(!_seState)return 0;
  let t=0;
  _seState.scan.rooms.forEach((r,i)=>{
    const st=_seState.rooms[i];
    if(st&&st.on)_seRoomLines(r,st).forEach(l=>{t+=l.total;});
  });
  return Math.round(t*100)/100;
}
function _seRender(){
  const {c,scan}=_seState;
  const elec=_seIsElec();
  document.getElementById('_se-ov')?.remove();
  const ov=document.createElement('div');
  ov.id='_se-ov';
  ov.style.cssText='position:fixed;inset:0;z-index:9100;background:var(--bg2);overflow-y:auto';
  const rates=elec?_scanElecRates():_scanRates();
  const rateInputs=elec
    ?[['outlet','Per outlet'],['sw','Per switch'],['gfci','GFCI lot']].map(([k,l])=>
        '<label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--text3)">'+l+
        '<span style="display:flex;align-items:center;gap:3px"><span style="color:var(--text2)">$</span><input type="number" min="0" step="1" value="'+(+rates[k]||0)+'" onchange="_seSetRate(\''+k+'\',this.value)" style="width:64px;padding:8px;border:1px solid var(--border2);border-radius:8px;background:var(--bg);color:var(--text);font-size:13px;font-family:inherit"></span></label>').join('')
    :[['wall','Walls /sq ft'],['ceiling','Ceiling /sq ft'],['trimLf','Trim /ln ft'],['door','Per door'],['window','Per window']].map(([k,l])=>
        '<label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--text3)">'+l+
        '<span style="display:flex;align-items:center;gap:3px"><span style="color:var(--text2)">$</span><input type="number" min="0" step="0.05" value="'+(+rates[k]||0)+'" onchange="_seSetRate(\''+k+'\',this.value)" style="width:64px;padding:8px;border:1px solid var(--border2);border-radius:8px;background:var(--bg);color:var(--text);font-size:13px;font-family:inherit"></span></label>').join('');
  const roomCards=scan.rooms.map((r,i)=>{
    const st=_seState.rooms[i];
    const lines=st.on?_seRoomLines(r,st):[];
    const roomTotal=lines.reduce((t,l)=>t+l.total,0);
    const surfChips=elec?'':_SE_SURFS.map(s=>{
      const qty=_seQty(r,s.k);
      return '<button onclick="_seToggleSurf('+i+',\''+s.k+'\')" class="btn btn-sm" style="padding:6px 10px;font-size:11px;'+(st.surf[s.k]?'background:var(--blue);color:#fff;border-color:var(--blue)':'')+'">'+s.label+(qty?' · '+qty:'')+'</button>';
    }).join('');
    const multChips=_SCANEST_MULTS.map(m=>
      '<button onclick="_seToggleMult('+i+',\''+m.k+'\')" class="btn btn-sm" style="padding:5px 9px;font-size:10px;'+(st.mults[m.k]?'background:#D97706;color:#fff;border-color:#D97706':'')+'">'+m.label+' +'+m.pct+'%'+(m.auto&&r.hM>=_SCANEST_HIGH_CEIL_M?' (measured)':'')+'</button>').join('');
    const elecLine=elec?('<div style="font-size:11px;color:var(--text2)">'+(()=>{const n=_scanElectricalNumbers(r);return n.outlets+' outlets · '+n.switches+' switch'+(n.switches>1?'es':'')+(n.gfci?' · GFCI':'');})()+'</div>'):'';
    return '<div class="card" style="padding:12px 14px;'+(st.on?'':'opacity:.45')+'">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'+
        '<label style="display:flex;align-items:center;gap:8px;font-size:14px;font-weight:800;cursor:pointer"><input type="checkbox" '+(st.on?'checked':'')+' onchange="_seToggleRoom('+i+')" style="width:17px;height:17px;accent-color:var(--blue)">'+escHtml(r.label)+'</label>'+
        '<div style="font-size:13px;font-weight:800;color:var(--blue)">'+(st.on&&roomTotal?('$'+roomTotal.toLocaleString('en-US',{maximumFractionDigits:0})):'')+'</div>'+
      '</div>'+
      '<div style="font-size:11px;color:var(--text3);margin-bottom:8px">'+Math.round(_scanSqFt(r.wallM2))+' wall sq ft · '+Math.round(_scanSqFt(r.floorM2))+' floor · '+_scanFtIn(r.hM)+' ceilings · '+(r.doorN||0)+' doors · '+(r.winN||0)+' windows</div>'+
      elecLine+
      (st.on?('<div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:7px">'+surfChips+'</div>'+
              '<div style="display:flex;flex-wrap:wrap;gap:5px">'+multChips+'</div>'):'')+
    '</div>';
  }).join('');
  const total=_seTotal();
  ov.innerHTML=
    '<div style="max-width:760px;margin:0 auto;padding:calc(20px + env(safe-area-inset-top,0px)) 16px 120px">'+
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">'+
        '<div><div class="tbar-eyebrow">Scan estimate · '+escHtml(scan.name||'')+'</div>'+
        '<div class="tbar-title">'+escHtml((c&&c.name)||'Client')+'</div></div>'+
        '<button class="btn btn-ghost" onclick="document.getElementById(\'_se-ov\').remove();_seState=null">Cancel</button>'+
      '</div>'+
      '<div style="border:1px solid var(--border);border-radius:12px;overflow:hidden;background:var(--bg);margin-bottom:14px">'+_scanPlanSvg(scan,{lens:elec?'electrical':'plan'})+'</div>'+
      '<div class="card" style="padding:12px 14px;margin-bottom:12px">'+
        '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:8px">'+(elec?'Device rates':'Production rates')+'</div>'+
        '<div style="display:flex;flex-wrap:wrap;gap:10px">'+rateInputs+'</div>'+
      '</div>'+
      '<div style="display:flex;flex-direction:column;gap:10px">'+roomCards+'</div>'+
    '</div>'+
    '<div style="position:fixed;left:0;right:0;bottom:0;background:var(--bg);border-top:1px solid var(--border);padding:12px 16px calc(12px + env(safe-area-inset-bottom));display:flex;align-items:center;gap:12px;z-index:9101">'+
      '<div style="flex:1"><div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--text3)">Estimate total</div>'+
      '<div id="_se-total" style="font-size:22px;font-weight:800;letter-spacing:-.4px">$'+total.toLocaleString('en-US',{maximumFractionDigits:0})+'</div></div>'+
      '<button class="btn btn-p" style="padding:14px 22px;font-size:15px;font-weight:800" onclick="_seCreateProposal()">Create proposal →</button>'+
    '</div>';
  document.body.appendChild(ov);
}
function _seSetRate(k,v){
  const r=_seIsElec()?_scanElecRates():_scanRates();
  r[k]=Math.max(0,+v||0);
  if(typeof saveAll==='function')saveAll();
  _seRender();
}
function _seToggleRoom(i){_seState.rooms[i].on=!_seState.rooms[i].on;_seRender();}
function _seToggleSurf(i,k){_seState.rooms[i].surf[k]=!_seState.rooms[i].surf[k];_seRender();}
function _seToggleMult(i,k){_seState.rooms[i].mults[k]=!_seState.rooms[i].mults[k];_seRender();}
function _seCreateProposal(){
  if(!_seState)return;
  const {c,scan}=_seState;
  const lines=[];
  scan.rooms.forEach((r,i)=>{
    const st=_seState.rooms[i];
    if(st&&st.on)_seRoomLines(r,st).forEach(l=>lines.push(l));
  });
  if(!lines.length){if(typeof showToast==='function')showToast('Turn on at least one room and surface','📐');return;}
  window._scanEstimateSeed={clientId:c.id,scanId:scan.id,lines};
  document.getElementById('_se-ov')?.remove();_seState=null;
  openGenericEstimate(c);
}
