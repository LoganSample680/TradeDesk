// ── Trade Opportunities ────────────────────────────────────────────────
function addTradeOpportunity(clientId,trade,title,notes){
  bids.unshift({id:_newBidId(),client_id:clientId,client_name:getClientById(clientId)?.name||'',trade_type:trade,type:title||(TRADE_META[trade]?.label+' opportunity'),notes:notes||'',status:'opportunity',bid_date:todayKey(),amount:0,draft:false});
  saveAll();renderCDOpportunities();showToast('Opportunity added','✓');
}
function convertOpportunityToEstimate(bidId){
  const opp=bids.find(b=>b.id===bidId);if(!opp)return;
  const c=getClientById(opp.client_id);if(!c)return;
  // Removing a saved opportunity bid is a real delete — route through _userDelete so the
  // soft-delete sweep propagates it cross-device (else it resurrects from the cloud).
  _userDelete(()=>{bids=bids.filter(b=>b.id!==bidId);saveAll();});
  _doOpenEstimate(c,null,opp.trade_type||getActiveTrade());
}
function deleteOpportunity(bidId){
  _userDelete(()=>{bids=bids.filter(b=>b.id!==bidId);saveAll();});renderCDOpportunities();
}
function renderCDOpportunities(){
  const el=document.getElementById('cd-opportunities');if(!el)return;
  const lines=_getTradeLines();
  const opps=bids.filter(b=>b.client_id===currentClientId&&b.status==='opportunity');
  const card=document.getElementById('cd-opp-card');
  if(card)card.style.display=(lines.length>1||opps.length)?'':'none';
  el.innerHTML=
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'+
      '<div style="font-size:14px;font-weight:700">Trade Opportunities</div>'+
      '<button class="btn btn-sm btn-p" onclick="openAddOpportunity()" style="font-size:11px">+ Add</button>'+
    '</div>'+
    (opps.length?opps.map(o=>{
      const m=TRADE_META[o.trade_type]||{icon:'🔧',label:o.trade_type||'Trade'};
      return '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-top:1px solid var(--border)">'+
        '<div style="display:flex;align-items:center;gap:10px;min-width:0;flex:1">'+
          '<div style="font-size:20px;flex-shrink:0">'+m.icon+'</div>'+
          '<div style="min-width:0"><div style="font-size:13px;font-weight:700">'+escHtml(o.type)+'</div>'+
          '<div style="font-size:11px;color:var(--text3)">'+m.label+(o.notes?' · '+escHtml((o.notes||'').substring(0,40)):'')+'</div></div>'+
        '</div>'+
        '<div style="display:flex;gap:6px;flex-shrink:0;margin-left:8px">'+
          '<button class="btn btn-sm btn-p" onclick="convertOpportunityToEstimate('+o.id+')" style="font-size:11px">→ Estimate</button>'+
          '<button class="btn-del" onclick="deleteOpportunity('+o.id+')" style="font-size:11px;padding:5px 8px">✕</button>'+
        '</div>'+
      '</div>';
    }).join(''):'<div style="font-size:12px;color:var(--text3);padding:6px 0">No opportunities yet — track cross-trade follow-ups here.</div>');
}
let _oppSelTrade=null;
Object.defineProperty(window,'_oppSelTrade',{get:()=>_oppSelTrade,set:v=>{_oppSelTrade=v;},configurable:true});
function openAddOpportunity(){
  const c=getClientById(currentClientId);if(!c)return;
  const lines=_getTradeLines();
  _oppSelTrade=lines[0]||null;
  const ov=document.createElement('div');ov.className='zmodal-overlay';ov.id='_opp-ov';
  const box=document.createElement('div');box.className='zmodal';
  box.innerHTML=
    '<div style="font-size:17px;font-weight:800;margin-bottom:4px">Add opportunity</div>'+
    '<div style="font-size:13px;color:var(--text3);margin-bottom:14px">Track cross-trade work for '+escHtml(c.name)+'</div>'+
    '<div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:8px">Trade</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px" id="opp-trade-grid">'+
    lines.map(id=>{const m=TRADE_META[id]||{icon:'🔧',label:id};const sel=id===_oppSelTrade;return'<button onclick="oppPickTrade(\''+id+'\')" id="opptrade-'+id+'" style="padding:10px 8px;border-radius:var(--r);border:2px solid '+(sel?'var(--blue)':'var(--border2)')+';background:'+(sel?'var(--blue-lt)':'var(--bg2)')+';cursor:pointer;font-family:inherit;text-align:center;font-size:12px;font-weight:'+(sel?700:400)+'"><div style="font-size:18px;margin-bottom:2px">'+m.icon+'</div>'+m.label+'</button>';}).join('')+
    '</div>'+
    '<div style="margin-bottom:12px"><div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:6px">Description</div><input id="opp-title" type="text" placeholder="e.g. Electrical diagnostic, HVAC tune-up" style="width:100%;box-sizing:border-box;padding:11px 12px;border:1.5px solid var(--border2);border-radius:var(--r);font-size:14px;font-family:inherit;background:var(--bg2);color:var(--text)"></div>'+
    '<div style="margin-bottom:14px"><div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:6px">Notes (optional)</div><input id="opp-notes" type="text" placeholder="Any details..." style="width:100%;box-sizing:border-box;padding:11px 12px;border:1.5px solid var(--border2);border-radius:var(--r);font-size:14px;font-family:inherit;background:var(--bg2);color:var(--text)"></div>'+
    '<button onclick="submitAddOpportunity()" style="width:100%;padding:14px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:8px">Add opportunity</button>'+
    '<button onclick="document.getElementById(\'_opp-ov\')?.remove()" style="width:100%;padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:none;color:var(--text3);font-size:14px;cursor:pointer;font-family:inherit">Cancel</button>';
  ov.appendChild(box);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  setTimeout(()=>document.getElementById('opp-title')?.focus(),80);
}
function oppPickTrade(id){
  _oppSelTrade=id;
  document.querySelectorAll('[id^=opptrade-]').forEach(b=>{
    const sel=b.id==='opptrade-'+id;
    b.style.borderColor=sel?'var(--blue)':'var(--border2)';b.style.background=sel?'var(--blue-lt)':'var(--bg2)';b.style.fontWeight=sel?'700':'400';
  });
}
function submitAddOpportunity(){
  if(!_oppSelTrade){showToast('Select a trade first','⚠️');return;}
  const title=document.getElementById('opp-title')?.value.trim()||'';
  if(!title){showToast('Add a description','⚠️');return;}
  const notes=document.getElementById('opp-notes')?.value.trim()||'';
  document.getElementById('_opp-ov')?.remove();
  addTradeOpportunity(currentClientId,_oppSelTrade,title,notes);
  _oppSelTrade=null;
}

function renderCDEstimatesUpcoming(){
  const el=document.getElementById('cd-estimates-upcoming');if(!el)return;
  const tk=todayKey();
  const hasWonBid=getClientBids(currentClientId).some(b=>b.status==='Closed Won');
  if(hasWonBid){el.innerHTML='';return;}
  const upcoming=getClientJobs(currentClientId).filter(j=>j.eventType==='estimate'&&j.status!=='canceled'&&j.start>=tk);
  if(!upcoming.length){el.innerHTML='';return;}
  el.innerHTML=upcoming.map(j=>{
    const dt=parseD(j.start).toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});
    return '<div style="background:#F0EEFF;border:2px solid #7F77DD;border-radius:var(--rl);padding:14px;margin-bottom:10px">'+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start">'+
        '<div>'+
          '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#7F77DD;margin-bottom:3px">Estimate scheduled</div>'+
          '<div style="font-size:15px;font-weight:700;color:var(--text)">'+dt+(j.time?' at '+fmtTime(j.time):'')+'</div>'+
          '<div style="font-size:12px;color:#7F77DD;margin-top:2px">'+escHtml(j.name.replace(' — estimate','').replace(' - estimate',''))+'</div>'+
          (j.addr?'<div style="font-size:11px;color:var(--text2);margin-top:2px">'+escHtml(j.addr)+'</div>':'')+
        '</div>'+
        '<div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0;margin-left:10px">'+
          '<button class="btn btn-sm" onclick="rescheduleEstimate('+j.id+')" style="font-size:11px">Reschedule</button>'+
          '<button class="btn btn-sm" onclick="cancelEstimate('+j.id+')" style="font-size:11px;color:var(--amber)">Cancel</button>'+
          '<button class="btn btn-sm" onclick="deleteJob('+j.id+')" style="font-size:11px;color:#A32D2D">Delete</button>'+
        '</div>'+
      '</div>'+

    '</div>';
  }).join('');
}

function cancelEstimate(jobId){
  const j=jobs.find(x=>x.id===jobId);if(!j)return;
  const reason='Canceled'; // reason captured silently
  j.status='canceled';
  j.cancelReason=reason||'Canceled';
  j.cancelDate=todayKey();
  saveAll();
  renderClientDetail();
  renderCalendar();
  renderDash();
}

function rescheduleEstimate(jobId){
  const j=jobs.find(x=>x.id===jobId);if(!j)return;
  j.status='canceled';
  j.cancelReason='Rescheduled';
  j.cancelDate=todayKey();
  saveAll();
  if(j.eventType!=='estimate'&&j.bid_id){
    schedFromBid(j.bid_id);
  }else{
    schedForClient();
  }
}

function showJobScorecard(jobId,collectBidId){
  const j=jobs.find(x=>x.id===jobId);if(!j)return;
  const bid=j.bid_id?bids.find(b=>b.id===j.bid_id):null;
  const revenue=bid?bid.amount||0:0;
  const matSpend=expenses.filter(e=>e.job_id===jobId||e.job_id===j.bid_id).reduce((s,e)=>s+(e.amount||0),0);
  const laborRate=S.laborRate||45;
  const actualHrs=j.actualHours||0;
  const laborCost=Math.round(actualHrs*laborRate*100)/100;
  const netProfit=revenue-matSpend-laborCost;
  const margin=revenue>0?Math.round(netProfit/revenue*100):0;
  const marginColor=margin>=50?'var(--green-mid)':margin>=30?'var(--yellow,#f59e0b)':'#A32D2D';
  const estDays=bid?.days||j.days||0;
  const clientName=j.name||(bid?bid.client_name:'');
  const collectBid=collectBidId?bids.find(b=>b.id===collectBidId):null;
  const balance=collectBid?getBidBalance(collectBid):0;
  const ov=document.createElement('div');ov.className='zmodal-overlay';
  const box=document.createElement('div');box.className='zmodal';
  box.innerHTML=
    '<div style="text-align:center;margin-bottom:4px;font-size:28px">🎉</div>'+
    '<div style="font-size:18px;font-weight:800;text-align:center;margin-bottom:2px">Job Complete</div>'+
    '<div style="font-size:12px;color:var(--text3);text-align:center;margin-bottom:18px">'+escHtml(clientName)+'</div>'+
    '<div style="background:var(--bg2);border-radius:var(--r);padding:14px;margin-bottom:14px">'+
      '<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border)">'+
        '<span style="font-size:13px;color:var(--text2)">Revenue</span>'+
        '<span style="font-size:13px;font-weight:700">'+fmt(revenue)+'</span>'+
      '</div>'+
      (matSpend>0?
        '<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border)">'+
          '<span style="font-size:13px;color:var(--text2)">Materials</span>'+
          '<span style="font-size:13px;font-weight:600;color:#A32D2D">−'+fmt(matSpend)+'</span>'+
        '</div>':'')+
      (actualHrs>0?
        '<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border)">'+
          '<span style="font-size:13px;color:var(--text2)">Labor ('+actualHrs+' hrs @ $'+laborRate+')</span>'+
          '<span style="font-size:13px;font-weight:600;color:#A32D2D">−'+fmt(laborCost)+'</span>'+
        '</div>':'')+
      '<div style="display:flex;justify-content:space-between;padding:10px 0 4px">'+
        '<span style="font-size:14px;font-weight:700">Net profit</span>'+
        '<span style="font-size:16px;font-weight:800;color:var(--green-mid)">'+fmt(netProfit)+'</span>'+
      '</div>'+
      (revenue>0?'<div style="text-align:right;font-size:22px;font-weight:800;color:'+marginColor+';margin-top:2px">'+margin+'% margin</div>':'')+
      (estDays>0&&actualHrs>0?'<div style="font-size:11px;color:var(--text3);text-align:right;margin-top:4px">'+actualHrs+' actual hrs · '+estDays+' day estimate</div>':'')+
    '</div>'+
    (()=>{
      const bd=getJobScopeBreakdown(jobId);
      const scopeRows=Object.entries(bd).filter(([,m])=>m>0).map(([sid,m])=>{
        const si=sid==='__other'?{icon:'➕',label:'Other'}:(SCOPE_ITEMS.find(x=>x.id===sid)||{icon:'⏱',label:sid});
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0">'+
          '<span style="font-size:12px;color:var(--text2)">'+si.icon+' '+si.label+'</span>'+
          '<span style="font-size:12px;font-weight:600;color:var(--text)">'+_fmtMin(m)+'</span>'+
        '</div>';
      }).join('');
      return scopeRows?
        '<div style="background:var(--bg2);border-radius:var(--r);padding:10px 14px;margin-bottom:14px">'+
          '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:6px">Time by task</div>'+
          scopeRows+
        '</div>':'';
    })()+
    '<div style="display:grid;grid-template-columns:1fr'+(balance>0.01?' 1.5fr':'')+';gap:8px">'+
      '<button onclick="this.closest(\'.zmodal-overlay\').remove();openClientDetail('+j.client_id+')" '+
        'style="padding:12px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);font-size:14px;font-weight:600;cursor:pointer;font-family:inherit">Close</button>'+
      (balance>0.01?'<button onclick="this.closest(\'.zmodal-overlay\').remove();openPayPanel('+collectBidId+',\'final\')" '+
        'style="padding:12px;border-radius:var(--r);border:none;background:var(--green);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">💳 Collect '+fmt(balance)+' →</button>':'')+
    '</div>';
  ov.appendChild(box);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov){ov.remove();if(balance>0.01)openPayPanel(collectBidId,'final');}});
}
// Alias called by post-job debrief after saving hours
function showSupplyList(bidId){
  const b=bids.find(x=>x.id===bidId);if(!b)return;
  const surfs=b.surfaces||[];
  const scope=b.roomScopeMap||{};
  const coats=Object.values(scope).some(r=>r.twocoat?.active)?2:1;

  // ── Helpers ────────────────────────────────────────────────
  const allSwProds=Object.values(SW_PRODUCTS).flat();
  const totalSqFt=surfs.filter(s=>['walls','ceiling','ext_walls','deck'].includes(s.type)).reduce((sum,s)=>sum+(s.qty||0),0);
  const totalRooms=new Set(surfs.map(s=>cleanRoomName(s.room))).size||1;
  const totalLinFt=surfs.filter(s=>s.type==='trim'||s.type==='ext_trim').reduce((sum,s)=>sum+(s.qty||0),0);
  const hasCabinets=surfs.some(s=>s.type==='cabinets');
  const hasDoors=surfs.some(s=>s.type==='doors');
  const hasExterior=surfs.some(s=>['ext_walls','ext_trim','deck'].includes(s.type));
  const hasInterior=surfs.some(s=>['walls','ceiling','trim','doors','windows','cabinets'].includes(s.type));
  const hasCeiling=surfs.some(s=>s.type==='ceiling');
  const scopeActive=(id)=>Object.values(scope).some(r=>r[id]?.active);

  // ── Build paint lines per product+color ──────────────────
  const orderMap={};
  const roomScopeMap_b=b.roomScopeMap||{};
  surfs.forEach(s=>{
    if(!s.qty)return;
    const t=SURF_TYPES.find(x=>x.v===s.type);if(!t||t.unit!=='sq ft')return;
    const spec=(s.room||'').indexOf(' — ')>-1?(s.room||'').split(' — ').slice(1).join(' — '):'';
    // Skip surfaces with no spec (customer supplies paint — no product/color stored)
    if(!spec)return;
    const key=spec;
    if(!orderMap[key])orderMap[key]={sqFt:0,spec,cov:350,surfaces:[]};
    // Use wallSqft for paint calc (perimeter×height); ceiling/deck use floor area (qty)
    const paintSqft=(s.type==='walls'||s.type==='ext_walls')?(s.wallSqft||s.qty):s.qty;
    orderMap[key].sqFt+=paintSqft;
    orderMap[key].surfaces.push(s.type);
    const prodName=spec.split(' · ')[0].trim();
    const prod=allSwProds.find(p=>p.name===prodName);
    if(prod)orderMap[key].cov=prod.cov||350;
  });
  const paintItems=Object.entries(orderMap).map(([key,od])=>{
    const rawGals=od.sqFt*coats/od.cov*1.10;
    const wholeCans=Math.ceil(rawGals);
    const parts=od.spec.split(' · ');
    const prod=parts[0]||'Paint';
    // Parse: "ProMar 200 · Accessible Beige (SW 7036) [Eggshell]"
    const afterProd=parts.slice(1).join(' · ')||'';
    const finishMatch=afterProd.match(/\[([^\]]+)\]$/);
    const finish=finishMatch?finishMatch[1]:'';
    const colorOnly=afterProd.replace(/\s*\[[^\]]+\]$/,'').trim();
    const swMatch=colorOnly.match(/\(SW (\d+)\)$/i);
    const swNum=swMatch?'SW '+swMatch[1]:'';
    const colorName=colorOnly.replace(/\s*\(SW \d+\)$/i,'').trim();
    const swHex=swNum&&_swColors?(_swColors.find(c=>c.sw.toLowerCase()===swNum.toLowerCase())?.hex||''):'';
    const surfLabels={'walls':'Walls','ceiling':'Ceiling','ext_walls':'Siding','deck':'Deck'};
    const surfNote=[...new Set(od.surfaces)].map(t=>surfLabels[t]||t).join(', ');
    return{label:colorName||prod,swNum,prod,finish,surfNote,qty:wholeCans,sqFt:Math.round(od.sqFt),unit:'gal',hex:swHex,cat:'paint'};
  });

  // ── Core supplies (always) ────────────────────────────────
  const sqFtBuckets=Math.ceil(totalSqFt/400)||1;  // 1 bucket per ~400sf
  const rollerCovers=Math.ceil(totalSqFt/200)||2; // ~200sf per cover
  const trayLiners=Math.max(rollerCovers,2);
  const dropCloths=Math.max(totalRooms,2);
  const tapeRolls=Math.max(Math.ceil(totalRooms*1.5),2);
  const stirSticks=Math.max(paintItems.length*2,4);

  const coreItems=[
    {label:'9" Roller frame',qty:1,unit:'',cat:'tools',note:'3/8" nap for smooth, 1/2" for textured'},
    {label:'9" Roller covers',qty:rollerCovers,unit:'',cat:'tools',note:'3/8" nap interior / 1/2" nap exterior or texture'},
    {label:'Paint tray',qty:1,unit:'',cat:'tools',note:''},
    {label:'Paint tray liners',qty:trayLiners,unit:'',cat:'tools',note:'One per color change'},
    {label:'Extension pole',qty:1,unit:'',cat:'tools',note:'4–8 ft for walls and ceilings'},
    {label:"2\" angled sash brush",qty:1,unit:'',cat:'tools',note:'Cutting in at trim and corners'},
    {label:'Drop cloths',qty:dropCloths,unit:'',cat:'tools',note:'Canvas preferred — 1 per room'},
    {label:"Blue painter's tape (1\")",qty:tapeRolls,unit:'rolls',cat:'tools',note:'FrogTape recommended for clean lines'},
    {label:'Stir sticks',qty:stirSticks,unit:'',cat:'tools',note:''},
    {label:'5-in-1 tool',qty:1,unit:'',cat:'tools',note:'Open cans, scrape, etc.'},
    {label:'Paint can opener',qty:1,unit:'',cat:'tools',note:''},
    {label:'Rags / shop towels',qty:1,unit:'pack',cat:'tools',note:''},
  ];

  // ── Scope-driven supplies ─────────────────────────────────
  const scopeItems=[];

  if(scopeActive('sand')){
    scopeItems.push({label:'120-grit sandpaper',qty:Math.ceil(totalSqFt/150),unit:'sheets',cat:'prep',note:'Scuff walls and trim'});
    scopeItems.push({label:'220-grit sandpaper',qty:Math.ceil(totalSqFt/200),unit:'sheets',cat:'prep',note:'Final smooth before paint'});
    scopeItems.push({label:'Sanding block',qty:1,unit:'',cat:'prep',note:''});
  }
  if(scopeActive('spackle')){
    scopeItems.push({label:'Lightweight spackle',qty:Math.ceil(totalRooms/3),unit:'quart',cat:'prep',note:'DAP or USG for nail holes & dings'});
    scopeItems.push({label:'4\" putty knife',qty:1,unit:'',cat:'prep',note:''});
    scopeItems.push({label:'6\" flexible putty knife',qty:1,unit:'',cat:'prep',note:'Feathering larger patches'});
    if(totalSqFt>600)scopeItems.push({label:'Joint compound (all-purpose)',qty:1,unit:'gallon',cat:'prep',note:'For larger wall repairs'});
  }
  if(scopeActive('prime')){
    const primeGals=Math.ceil(totalSqFt/350*1.10);
    scopeItems.push({label:"Primer (PVA or SW ProMar 200 Primer)",qty:primeGals,unit:'gal',cat:'prep',note:'One coat over bare drywall or stains'});
  }
  if(scopeActive('tape')){
    scopeItems.push({label:'Plastic sheeting (4mil)',qty:Math.ceil(totalRooms/2),unit:'roll',cat:'prep',note:'Cover floors and large furniture'});
    scopeItems.push({label:'Masking paper (12\")',qty:1,unit:'roll',cat:'prep',note:'Protecting trim during wall work'});
  }
  if(scopeActive('caulk')){
    const caulkTubes=Math.max(Math.ceil(totalRooms*1.5),2);
    scopeItems.push({label:"Painter's caulk (white)",qty:caulkTubes,unit:'tubes',cat:'prep',note:'DAP Alex Plus — paintable in 30 min'});
    scopeItems.push({label:'Caulk gun',qty:1,unit:'',cat:'tools',note:''});
  }
  if(scopeActive('movefurn')){
    scopeItems.push({label:'Moving blankets / furniture pads',qty:Math.ceil(totalRooms/2),unit:'',cat:'tools',note:'Protect furniture and floors'});
  }
  if(scopeActive('popcorn')){
    scopeItems.push({label:'Garden pump sprayer',qty:1,unit:'',cat:'tools',note:'Wet popcorn before scraping'});
    scopeItems.push({label:'Wide drywall knife (10\"+)',qty:1,unit:'',cat:'tools',note:'Scraping popcorn'});
    scopeItems.push({label:'All-purpose joint compound',qty:Math.ceil(totalSqFt/200),unit:'gallon',cat:'prep',note:'Skim coat after removal'});
    scopeItems.push({label:'Respirator mask (N95)',qty:2,unit:'',cat:'tools',note:'Fine dust — protect your lungs'});
    scopeItems.push({label:'Safety goggles',qty:1,unit:'',cat:'tools',note:''});
  }
  if(scopeActive('wallpaper')){
    scopeItems.push({label:'Wallpaper scoring tool',qty:1,unit:'',cat:'tools',note:'Zinsser Paper Tiger'});
    scopeItems.push({label:'Wallpaper remover solution',qty:Math.ceil(totalSqFt/200),unit:'gallon',cat:'prep',note:'DIF or similar'});
    scopeItems.push({label:'Wide plastic scraper (6\"+)',qty:1,unit:'',cat:'tools',note:''});
    scopeItems.push({label:'Spray bottle',qty:1,unit:'',cat:'tools',note:'For wetting strips during removal'});
    scopeItems.push({label:'PVA primer',qty:Math.ceil(totalSqFt/350),unit:'gal',cat:'prep',note:'Required after wallpaper removal'});
  }
  if(scopeActive('pwash')){
    scopeItems.push({label:'Pressure washer',qty:1,unit:'rental',cat:'rental',note:'2000-3000 PSI — Home Depot or Sunbelt'});
    scopeItems.push({label:'TSP cleaner / degreaser',qty:2,unit:'lb',cat:'prep',note:'Mix with water for pre-wash'});
  }
  if(scopeActive('scaffold')){
    scopeItems.push({label:'Scaffolding',qty:1,unit:'rental',cat:'rental',note:'Price by job — Sunbelt or local rental yard'});
  }

  // ── Surface-specific extras ───────────────────────────────
  if(hasCeiling){
    scopeItems.push({label:'1/2\" nap roller covers (ceiling)',qty:Math.ceil(hasCeiling?totalRooms/2:1),unit:'',cat:'tools',note:'Thicker nap pushes into texture'});
    scopeItems.push({label:'Neck/head protection',qty:1,unit:'',cat:'tools',note:'Neck roll or wide-brim hat for spray'});
  }
  if(hasExterior){
    scopeItems.push({label:'Exterior caulk (paintable)',qty:Math.ceil(totalRooms),unit:'tubes',cat:'prep',note:'OSI or DAP Dynaflex for exterior gaps'});
    scopeItems.push({label:'Wire brush',qty:1,unit:'',cat:'tools',note:'Remove loose exterior paint and rust'});
    scopeItems.push({label:'1\" nap roller covers (exterior)',qty:Math.ceil(totalSqFt/150),unit:'',cat:'tools',note:'Thicker nap for rough siding'});
  }
  if(hasDoors||hasCabinets){
    scopeItems.push({label:'400-grit wet/dry sandpaper',qty:4,unit:'sheets',cat:'prep',note:'Between coats on doors and cabinets'});
    scopeItems.push({label:'Tack cloth',qty:Math.ceil((hasDoors?surfs.filter(s=>s.type==='doors').reduce((sum,s)=>sum+s.qty,0):0)/3)||2,unit:'',cat:'prep',note:'Wipe dust before final coat'});
    scopeItems.push({label:'2\" foam roller (doors)',qty:2,unit:'',cat:'tools',note:'Minimal texture on flat doors'});
  }

  // ── Assemble sections ──────────────────────────────────────
  const sections=[
    {id:'paint',label:'🎨 Paint',color:'#1a365d',bg:'#EBF2FB',items:paintItems},
    {id:'prep',label:'🔧 Prep supplies',color:'#854F0B',bg:'#FFF7ED',items:scopeItems.filter(i=>i.cat==='prep')},
    {id:'tools',label:'🪣 Tools & protection',color:'#2d6a4f',bg:'#F0FBF4',items:[...coreItems,...scopeItems].filter(i=>i.cat==='tools')},
    {id:'rental',label:'🏗️ Rentals',color:'#5B21B6',bg:'#F5F3FF',items:scopeItems.filter(i=>i.cat==='rental')},
  ].filter(s=>s.items.length>0);

  // ── Build modal ────────────────────────────────────────────
  const c=getClientById(b.client_id);
  const ov=document.createElement('div');ov.className='zmodal-overlay';
  const box=document.createElement('div');
  box.style.cssText='background:var(--bg);border-radius:var(--rl);padding:0;width:100%;max-width:600px;max-height:92vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 8px 40px rgba(0,0,0,.25)';

  // Header
  const hdr=document.createElement('div');
  hdr.style.cssText='background:linear-gradient(135deg,#854F0B,#B45309);color:#fff;padding:18px 20px 14px;flex-shrink:0';
  hdr.innerHTML=
    '<div style="display:flex;justify-content:space-between;align-items:flex-start">'+
      '<div>'+
        '<div style="font-size:18px;font-weight:800;line-height:1.1">📦 Supply List</div>'+
        '<div style="font-size:12px;opacity:.85;margin-top:3px">'+escHtml(c?c.name:'Job')+' · '+(totalSqFt?totalSqFt.toLocaleString()+' sq ft · ':'')+totalRooms+' room'+(totalRooms!==1?'s':'')+' · '+coats+' coat'+(coats!==1?'s':'')+'</div>'+
      '</div>'+
      '<button onclick="this.closest(\'.zmodal-overlay\').remove()" style="background:rgba(255,255,255,.2);border:none;color:#fff;font-size:18px;cursor:pointer;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;flex-shrink:0">✕</button>'+
    '</div>'+
    '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">'+
      '<button onclick="supplyCheckAll(this)" style="font-size:11px;padding:4px 10px;border-radius:20px;background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.4);color:#fff;cursor:pointer;font-family:inherit">✓ Check all</button>'+
      '<button onclick="supplyUncheckAll(this)" style="font-size:11px;padding:4px 10px;border-radius:20px;background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.4);color:#fff;cursor:pointer;font-family:inherit">↺ Uncheck all</button>'+
    '</div>';
  box.appendChild(hdr);

  // Scrollable body
  const body=document.createElement('div');
  body.id='supply-list-body';
  body.dataset.bidId=bidId;
  body.style.cssText='overflow-y:auto;padding:16px;flex:1';
  const _supplyKey='supplyChecked_'+bidId;
  let _supplyState={};try{_supplyState=JSON.parse(localStorage.getItem(_supplyKey)||'{}')||{};}catch(e){_supplyState={};}

  sections.forEach(sec=>{
    const secDiv=document.createElement('div');
    secDiv.style.cssText='margin-bottom:16px';
    secDiv.innerHTML=
      '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:'+sec.color+';background:'+sec.bg+';padding:6px 10px;border-radius:6px;margin-bottom:8px">'+sec.label+'</div>';

    sec.items.forEach((item,idx)=>{
      const row=document.createElement('label');
      row.style.cssText='display:flex;align-items:flex-start;gap:10px;padding:8px 10px;border-radius:8px;cursor:pointer;transition:background .1s;margin-bottom:4px;background:var(--bg)';
      row.onmouseover=()=>row.style.background='var(--bg2)';
      row.onmouseout=()=>row.style.background='var(--bg)';
      // Paint items get a richer layout with swatch
      if(item.cat==='paint'){
        const swatchSize=36;
        const swatchHtml=item.hex
          ?'<div style="width:'+swatchSize+'px;height:'+swatchSize+'px;border-radius:6px;background:'+item.hex+';border:1px solid rgba(0,0,0,.15);flex-shrink:0"></div>'
          :'<div style="width:'+swatchSize+'px;height:'+swatchSize+'px;border-radius:6px;background:var(--border2);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:18px">🎨</div>';
        // Full SW-style spec: Product Line · Color Name (SW XXXX) · Finish
        const fullSpec=[
          item.prod||'',
          item.label+(item.swNum?' ('+item.swNum+')':''),
          item.finish||''
        ].filter(Boolean).join(' · ');
        row.innerHTML=
          '<input type="checkbox" class="supply-check" style="width:18px;height:18px;flex-shrink:0;margin-top:4px;accent-color:var(--blue);cursor:pointer;appearance:auto;-webkit-appearance:checkbox">'+
          swatchHtml+
          '<div style="flex:1;min-width:0">'+
            '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:6px">'+
              '<span class="supply-label" style="font-size:12px;font-weight:700;color:var(--text);line-height:1.4">'+fullSpec+'</span>'+
              '<span style="font-size:13px;font-weight:800;color:var(--blue-dk);white-space:nowrap;flex-shrink:0">'+item.qty+' gal</span>'+
            '</div>'+
            '<div style="font-size:11px;color:var(--text3);margin-top:2px">'+
              (item.surfNote?item.surfNote:'')+
              (item.sqFt?' · '+item.sqFt.toLocaleString()+' sf':'')+
            '</div>'+
          '</div>';
      } else {
        const hexDot=item.hex?'<span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:'+item.hex+';border:1px solid rgba(0,0,0,.15);margin-right:4px;vertical-align:middle;flex-shrink:0"></span>':'';
        row.innerHTML=
          '<input type="checkbox" class="supply-check" style="width:18px;height:18px;flex-shrink:0;margin-top:1px;accent-color:var(--blue);cursor:pointer;appearance:auto;-webkit-appearance:checkbox">'+
          '<div style="flex:1;min-width:0">'+
            '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px">'+
              '<span class="supply-label" style="font-size:13px;font-weight:600;color:var(--text)">'+hexDot+item.label+(item.qty>1||item.unit?' <span style="color:var(--blue-dk);font-weight:800">× '+(item.unit?item.qty+' '+item.unit:item.qty)+'</span>':'')+'</span>'+
              (item.unit==='rental'?'<span style="font-size:10px;background:#F5F3FF;color:#5B21B6;padding:2px 6px;border-radius:10px;font-weight:700;flex-shrink:0">RENTAL</span>':'')+
            '</div>'+
            (item.note?'<div style="font-size:11px;color:var(--text3);margin-top:2px">'+item.note+'</div>':'')+
            (item.detail?'<div style="font-size:11px;color:var(--text2);margin-top:1px">'+item.detail+'</div>':'')+
          '</div>';
      }
      // Restore and persist checked state
      const cb=row.querySelector('input');
      const _supplyItemKey=sec.id+'_'+idx;
      cb.dataset.supplyKey=_supplyItemKey;
      const _ck=_supplyState[_supplyItemKey]||false;
      cb.checked=_ck;
      const _lbl=row.querySelector('.supply-label');
      if(_ck){_lbl.style.textDecoration='line-through';_lbl.style.opacity='0.45';}
      cb.onchange=()=>{
        _lbl.style.textDecoration=cb.checked?'line-through':'none';
        _lbl.style.opacity=cb.checked?'0.45':'1';
        const st=JSON.parse(localStorage.getItem(_supplyKey)||'{}');
        st[_supplyItemKey]=cb.checked;
        localStorage.setItem(_supplyKey,JSON.stringify(st));
      };
      secDiv.appendChild(row);
    });
    body.appendChild(secDiv);
  });

  // Footer note
  const foot=document.createElement('div');
  foot.style.cssText='padding:10px 16px 6px;font-size:10px;color:var(--text3);border-top:1px solid var(--border);flex-shrink:0;line-height:1.6';
  foot.textContent='Quantities are calculated from job surfaces and scope. Verify with your SW rep for dark colors. Rental items need to be arranged in advance.';
  body.appendChild(foot);
  box.appendChild(body);
  ov.appendChild(box);
  ov.onclick=e=>{if(e.target===ov)ov.remove();};
  document.body.appendChild(ov);
}
function supplyCheckAll(btn){
  const body=document.getElementById('supply-list-body');
  if(!body)return;
  const key='supplyChecked_'+body.dataset.bidId;
  const st={};
  body.querySelectorAll('.supply-check').forEach((cb,i)=>{
    cb.checked=true;
    const lbl=cb.closest('label').querySelector('.supply-label');
    if(lbl){lbl.style.textDecoration='line-through';lbl.style.opacity='0.45';}
    if(cb.dataset.supplyKey)st[cb.dataset.supplyKey]=true;
  });
  localStorage.setItem(key,JSON.stringify(st));
}
function supplyUncheckAll(btn){
  const body=document.getElementById('supply-list-body');
  if(!body)return;
  const key='supplyChecked_'+body.dataset.bidId;
  body.querySelectorAll('.supply-check').forEach(cb=>{
    cb.checked=false;
    const lbl=cb.closest('label').querySelector('.supply-label');
    if(lbl){lbl.style.textDecoration='none';lbl.style.opacity='1';}
  });
  localStorage.setItem(key,'{}');
}

function quickBid(){
  openEstimateForClient();
}
function schedForClient(){
  schedType='estimate';
  goPg('pg-schedule');
  const c=getClientById(currentClientId);if(!c)return;
  setTimeout(()=>{
    const jobTab=document.getElementById('sched-tab-job');
    if(jobTab)jobTab.style.display='none';
    setSchedType('estimate',document.getElementById('sched-tab-est'));
    const sel=document.getElementById('s-client-sel');
    if(sel){for(let i=0;i<sel.options.length;i++){if(parseInt(sel.options[i].value)===currentClientId){sel.selectedIndex=i;break;}}}
    pullClient();
  },150);
}

function schedFromBid(id){schedType='job';goPg('pg-schedule');setTimeout(()=>{setSchedType('job',document.getElementById('sched-tab-job'));const sel=document.getElementById('s-bid-sel');if(sel){sel.value=id;pullBid();}const bid=bids.find(b=>b.id===id);const wknd=document.getElementById('s-allow-weekend');if(wknd&&bid){wknd.checked=!!(bid.allowWeekend);refreshAvail();}},150);}

function schedFromDate(dateKey){
  schedType='estimate';
  goPg('pg-schedule');
  setTimeout(()=>{
    const jobTab=document.getElementById('sched-tab-job');
    if(jobTab)jobTab.style.display='none';
    setSchedType('estimate',document.getElementById('sched-tab-est'));
    const sd=document.getElementById('s-start');
    if(sd&&dateKey){sd.value=dateKey;onStartChange();}
  },150);
}

function getBidPayments(bidId){return payments.filter(p=>p.bid_id===bidId);}
function getBidPaid(bidId){return payments.filter(p=>p.bid_id===bidId).reduce((s,p)=>s+(p.amount||0),0);}
function getBidBalance(bid){return Math.max(0,(bid.amount||0)-getBidPaid(bid.id));}
function _calcFinanceCharge(bid){
  if(!bid||(!bid.completion_date&&!bid.signedAt))return 0;
  const balance=getBidBalance(bid);
  if(balance<0.01)return 0;
  const startDate=new Date(bid.completion_date||bid.signedAt);
  // window._fcTestDays lets you simulate overdue in the console: window._fcTestDays=35
  const daysElapsed=typeof window._fcTestDays==='number'?window._fcTestDays:Math.floor((Date.now()-startDate.getTime())/86400000);
  const daysOverdue=Math.max(0,daysElapsed-30);
  if(daysOverdue===0)return 0;
  const rate=(typeof S!=='undefined'&&S.financeChargePct?parseFloat(S.financeChargePct):1.5)/100/30;
  return Math.round(balance*rate*daysOverdue*100)/100;
}

function sendBidEmail(bidId){
  const b=bids.find(x=>x.id===bidId);if(!b)return;
  const c=b.client_id?getClientById(b.client_id):null;
  const toEmail=c&&c.email?c.email:'';
  const firstName=(b.client_name||b.name||'').split(' ')[0]||'there';
  const bname=S.bname||'TradeDesk';
  const bphone=S.bphone||'';
  const today=new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});
  const expD=b.bid_date?new Date(new Date(b.bid_date+'T12:00:00').getTime()+30*86400000).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}):'30 days from now';
  const PAINT={'std':'Standard (Behr/Valspar)','prem':'Sherwin-Williams Premium','ultra':'SW Emerald Ultra'};
  const paintL=(b.paint?PAINT[b.paint]:null)||'Premium Sherwin-Williams';
  const surfs=b.surfaces||[];
  const scope=b.scope?Object.entries(b.scope).filter(([k,v])=>v).map(([k])=>{
    const item=SCOPE_ITEMS.find(s=>s.id===k);return item?item.label:k;
  }).join(', '):'Sanding, Spackle/patching, Two-coat finish';
  const NL='\n';
  const lineItems=surfs.length?surfs.map(s=>'  - '+s.room+': '+(s.qty||0).toLocaleString()+' sf').join(NL):'  See attached estimate';
  // Use plain ASCII dashes — Unicode box-drawing chars trigger corporate spam filters
  const SEP='-------------------------------------'+NL;
  // Build signing link if this bid has already been sent as a proposal
  const baseUrl=(typeof _clientBaseUrl==='function')?_clientBaseUrl():(window.location.origin+'/');
  const hubUrl=c?.clientToken?(baseUrl+'client.html?t='+c.clientToken+'&u='+(window._supaUser?.id||'')+'&c='+c.id):null;
  const sigUrl=b.signingToken?(baseUrl+'sign.html?t='+b.signingToken+'&u='+(window._supaUser?.id||'')+'&b='+bidId):null;
  const proposalLink=hubUrl||sigUrl;
  let body='Hi '+firstName+','+NL+NL;
  body+='It was great meeting you'+( b.addr?' at '+b.addr:'')+' and I appreciate the opportunity to earn your business.'+NL+NL;
  if(proposalLink){
    body+='Your proposal is ready to view and sign online:'+NL+NL;
    body+='    '+proposalLink+NL+NL;
    body+='Tap the link to review everything we went over and sign when you\'re ready. If the link doesn\'t come through, just reply and I\'ll send it via text.'+NL+NL;
  } else {
    body+='Here is your painting proposal:'+NL+NL;
  }
  body+=SEP;
  body+='PAINTING PROPOSAL'+NL;
  body+=bname+(bphone?' | '+bphone:'')+NL;
  body+=SEP+NL;
  body+='Property: '+(b.addr||'')+(NL);
  body+='Date: '+today+NL;
  body+='Valid until: '+expD+NL+NL;
  body+='WHAT IS INCLUDED'+NL;
  body+=scope+NL;
  body+='Paint: '+paintL+NL+NL;
  body+='Every surface will be sanded before painting for proper adhesion. All nail holes, cracks, and imperfections will be spackled for a smooth finish that lasts 8-10 years.'+NL+NL;
  if(surfs.length){body+='SURFACES'+NL+lineItems+NL+NL;}
  body+=SEP;
  body+='TOTAL ESTIMATE: '+fmt(b.amount)+NL;
  body+='  - 25% deposit to start: '+fmt(b.amount*.25)+NL;
  body+='  - Balance due on completion: '+fmt(b.amount*.75)+NL;
  body+='  - '+b.days+' day'+(b.days>1?'s':'')+' estimated to complete'+NL+NL;
  if(proposalLink){
    body+='To accept, sign the proposal online or reply to this email.'+NL;
  } else {
    body+='To accept, simply reply to this email or give me a call at '+bphone+'.'+NL;
  }
  body+='I will get you on the schedule right away.'+NL+NL;
  body+='Looking forward to working with you,'+NL;
  body+=bname+NL;
  if(bphone)body+=bphone+NL;
  const subject=encodeURIComponent('Your painting proposal -- '+fmt(b.amount)+' | '+bname);
  window.location.href='mailto:'+(toEmail?encodeURIComponent(toEmail):'')+'?subject='+subject+'&body='+encodeURIComponent(body);
}

function toggleBidSummary(bidId){
  let panel=document.getElementById('bid-summary-'+bidId);
  if(panel){panel.style.display=panel.style.display==='none'?'block':'none';return;}
  const b=bids.find(x=>x.id===bidId);if(!b)return;
  const card=document.getElementById('bid-card-'+bidId);if(!card)return;
  const PAINT={'std':'Standard','prem':'SW Premium','ultra':'SW Emerald'};
  const COND={'1.0':'Good','1.2':'Fair','1.5':'Poor'};
  const surfs=b.surfaces||[];
  const scope=b.scope?Object.entries(b.scope).filter(([k,v])=>v).map(([k])=>k).join(', '):'';
  const SURF_LABELS={walls:'Walls',ceiling:'Ceiling',trim:'Trim',doors:'Doors',windows:'Windows',cabinets:'Cabinets',ext_walls:'Siding',ext_trim:'Ext trim',deck:'Deck',fence:'Fence staining',epoxy:'Epoxy floor'};
  panel=document.createElement('div');
  panel.id='bid-summary-'+bidId;
  panel.style.cssText='background:var(--bg2);border-radius:var(--r);padding:12px;margin-top:10px;border-top:1px solid var(--border)';
  const surfRows=surfs.length?surfs.map(s=>'<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:1px solid var(--border)"><span style="color:var(--text2)">'+(SURF_LABELS[s.type]||s.type)+' — '+escHtml(s.room||'')+'</span><span style="font-weight:600">'+(s.qty||0).toLocaleString()+' '+(s.type==='walls'||s.type==='ceiling'||s.type==='ext_walls'||s.type==='deck'?'sf':'')+'</span></div>').join(''):'<div style="font-size:12px;color:var(--text3)">No surface data saved</div>';
  // Per-room cost breakdown — for change order reference (remove a room, know how much to deduct)
  const roomBreakdown=(()=>{
    if(!surfs.length||!(b.amount>0))return '';
    const R={
      walls:   (typeof S!=='undefined'&&S.rWalls)||1.30,
      ceiling: (typeof S!=='undefined'&&S.rCeil) ||1.00,
      trim:    (typeof S!=='undefined'&&S.rTrim) ||3.25,
      doors:   (typeof S!=='undefined'&&S.rDoor) ||95,
      windows: (typeof S!=='undefined'&&S.rWin)  ||50,
      cabinets:38,
      ext_walls:(typeof S!=='undefined'&&S.rExt) ||1.10,
      ext_trim: (typeof S!=='undefined'&&S.rTrim)||3.25,
      deck:    (typeof S!=='undefined'&&S.rDeck) ||1.00,
      fence:1.25,epoxy:1.75,
    };
    const rooms={};
    surfs.forEach(s=>{
      if(!s.qty)return;
      const room=(s.room||'').split(' — ')[0].trim()||'Other';
      if(!rooms[room])rooms[room]={w:0,labels:[]};
      const t=(typeof SURF_TYPES!=='undefined')&&SURF_TYPES.find(x=>x.v===s.type);
      rooms[room].w+=s.qty*(R[s.type]||(t&&t.rate)||0);
      rooms[room].labels.push(SURF_LABELS[s.type]||s.type);
    });
    Object.entries(b.roomScopeMap||{}).forEach(([room,sc])=>{
      if(!rooms[room])return;
      Object.entries(sc).forEach(([,entry])=>{
        if(!entry||!entry.active)return;
        rooms[room].w+=entry.cost||Math.round((entry.hrs||0)*(entry.rate||45)*100)/100;
      });
    });
    const rNames=Object.keys(rooms);
    if(rNames.length<2)return '';
    const totalW=rNames.reduce((s,r)=>s+rooms[r].w,0)||1;
    const amt=b.amount;
    let html='<div style="font-size:10px;font-weight:800;text-transform:uppercase;color:var(--text3);margin-top:14px;margin-bottom:6px">Per-room breakdown</div>';
    rNames.forEach(room=>{
      const roomAmt=Math.round(rooms[room].w/totalW*amt);
      const labels=[...new Set(rooms[room].labels)].join(' · ');
      html+='<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border)">'+
        '<div><div style="font-size:12px;font-weight:600">'+escHtml(room)+'</div>'+
        '<div style="font-size:10px;color:var(--text3)">'+escHtml(labels)+'</div></div>'+
        '<div style="font-size:13px;font-weight:700;color:var(--text1)">$'+roomAmt.toLocaleString()+'</div></div>';
    });
    html+='<div style="font-size:10px;color:var(--text3);margin-top:5px;text-align:right">For change order reference</div>';
    return html;
  })();
  panel.innerHTML=
    '<div style="font-size:10px;font-weight:800;text-transform:uppercase;color:var(--text3);margin-bottom:8px">Bid details</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px">'+
      (b.paint?'<div><div style="font-size:10px;text-transform:uppercase;color:var(--text3)">Paint</div><div style="font-size:12px;font-weight:700">'+(PAINT[b.paint]||b.paint)+'</div></div>':'')+
      (b.cond?'<div><div style="font-size:10px;text-transform:uppercase;color:var(--text3)">Condition</div><div style="font-size:12px;font-weight:700">'+(COND[b.cond]||b.cond)+'</div></div>':'')+
      (b.days?'<div><div style="font-size:10px;text-transform:uppercase;color:var(--text3)">Est days</div><div style="font-size:12px;font-weight:700">'+b.days+'</div></div>':'')+
      (scope?'<div style="grid-column:1/-1"><div style="font-size:10px;text-transform:uppercase;color:var(--text3)">Scope</div><div style="font-size:11px;color:var(--text2)">'+scope+'</div></div>':'')+
    '</div>'+
    '<div style="font-size:10px;font-weight:800;text-transform:uppercase;color:var(--text3);margin-bottom:6px">Surfaces ('+surfs.length+')</div>'+
    surfRows+roomBreakdown;
  card.appendChild(panel);
}

function printInvoice(bidId){
  const b=bids.find(x=>x.id===bidId);if(!b)return;
  const c=b.client_id?getClientById(b.client_id):null;
  const paid=getBidPaid(bidId);
  const balance=getBidBalance(b);
  const bPmts=payments.filter(p=>p.bid_id===bidId);
  const bname=S.bname||'TradeDesk';
  const bphone=S.bphone||'';
  const blic=S.blic||'';
  const today=new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});
  const invoiceNum='INV-'+String(bidId).slice(-6);

  const html=`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Invoice ${invoiceNum}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:var(--text);background:#fff;padding:32px;max-width:680px;margin:0 auto}
  .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px;padding-bottom:24px;border-bottom:3px solid #185FA5}
  .co-name{font-size:24px;font-weight:800;color:#185FA5}
  .co-sub{font-size:12px;color:#666;margin-top:4px}
  .inv-title{text-align:right}
  .inv-title h1{font-size:32px;font-weight:800;color:var(--text);letter-spacing:-.02em}
  .inv-num{font-size:12px;color:#666;margin-top:4px}
  .two-col{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:28px}
  .section-label{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#999;margin-bottom:6px}
  .client-name{font-size:16px;font-weight:700}
  .client-detail{font-size:13px;color:#444;margin-top:2px;line-height:1.5}
  table{width:100%;border-collapse:collapse;margin-bottom:24px}
  th{text-align:left;padding:8px 10px;background:#f5f5f3;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#666;border-bottom:1px solid #e0e0dc}
  td{padding:10px;border-bottom:1px solid #f0eeec;font-size:13px;vertical-align:top}
  td.amt{text-align:right;font-weight:600}
  .totals{margin-left:auto;width:260px}
  .total-row{display:flex;justify-content:space-between;padding:6px 0;font-size:13px;border-bottom:1px solid #f0eeec}
  .total-row.grand{font-size:16px;font-weight:800;border-top:2px solid #1a1a18;border-bottom:none;padding-top:10px;margin-top:4px}
  .balance-due{background:${balance<0.01?'#F0FBF0':'#FFF8F0'};border:2px solid ${balance<0.01?'#63B841':'#E89A3C'};border-radius:8px;padding:16px 20px;margin-top:24px;display:flex;justify-content:space-between;align-items:center}
  .balance-label{font-size:12px;font-weight:700;color:${balance<0.01?'#3B8C2A':'#B8600A'};text-transform:uppercase;letter-spacing:.05em}
  .balance-amount{font-size:28px;font-weight:800;color:${balance<0.01?'#3B8C2A':'#B8600A'}}
  .footer{margin-top:40px;padding-top:16px;border-top:1px solid #e0e0dc;font-size:11px;color:#999;text-align:center}
  @media print{body{padding:16px}@page{margin:0.5in}}
</style>
</head><body>
<div class="header">
  <div>
    <div class="co-name">${bname}</div>
    <div class="co-sub">${bphone}${blic?' · '+blic:''}</div>
  </div>
  <div class="inv-title">
    <h1>INVOICE</h1>
    <div class="inv-num">${invoiceNum}</div>
    <div style="font-size:12px;color:#666;margin-top:4px">Date: ${today}</div>
  </div>
</div>

<div class="two-col">
  <div>
    <div class="section-label">Bill to</div>
    <div class="client-name">${escHtml(c?c.name:b.client_name||'Client')}</div>
    <div class="client-detail">${escHtml(b.addr||c&&c.addr||'')}</div>
    ${c&&c.phone?`<div class="client-detail">${escHtml(c.phone)}</div>`:''}
  </div>
  <div>
    <div class="section-label">Job details</div>
    <div class="client-detail"><strong>Type:</strong> ${escHtml(b.type||'Painting job')}</div>
    <div class="client-detail"><strong>Bid date:</strong> ${b.bid_date||''}</div>
    ${b.completion_date?`<div class="client-detail"><strong>Completed:</strong> ${b.completion_date}</div>`:''}
  </div>
</div>

<table>
  <thead><tr><th>Description</th><th style="text-align:right">Amount</th></tr></thead>
  <tbody>
    <tr><td>${escHtml(b.type||'Professional painting services')}<br><span style="font-size:11px;color:#666">${escHtml(b.addr||'')}</span></td><td class="amt">${fmt(b.amount)}</td></tr>
  </tbody>
</table>

<div class="totals">
  <div class="total-row"><span>Subtotal</span><span>${fmt(b.amount)}</span></div>
  ${bPmts.map(p=>`<div class="total-row" style="color:#3B8C2A"><span>Payment received (${escHtml(p.date||'')}) — ${escHtml(p.method||'')}</span><span>(${fmt(p.amount)})</span></div>`).join('')}
  <div class="total-row grand"><span>Balance due</span><span>${fmt(balance)}</span></div>
</div>

<div class="balance-due">
  <div>
    <div class="balance-label">${balance<0.01?'Paid in full ✓':'Balance due'}</div>
    ${balance>=0.01?`<div style="font-size:11px;color:#B8600A;margin-top:3px">Please remit payment at your earliest convenience</div>`:'<div style="font-size:11px;color:#3B8C2A;margin-top:3px">Thank you for your business!</div>'}
  </div>
  <div class="balance-amount">${fmt(balance)}</div>
</div>

<div class="footer">
  ${escHtml(bname)} · ${escHtml(bphone)} · Thank you for choosing us!<br>
  <em style="margin-top:4px;display:block">To print or save as PDF: tap Share → Print in Safari</em>
</div>
</body></html>`;

  const win=window.open('','_blank');
  if(win){
    win.document.write(html);
    win.document.close();
  } else {
    zAlert('Allow pop-ups to open the invoice. In Safari: Settings → Safari → Block Pop-ups → Off');
  }
}
function getBidLien(bidId){return liens.find(l=>l.bid_id===bidId);}
function daysSince(dateStr){if(!dateStr)return 0;const d=new Date(dateStr+'T00:00:00Z');if(isNaN(d.getTime()))return 0;const now=new Date();const todayUTC=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate());return Math.round((todayUTC-d.getTime())/86400000);}
function payStatus(bid){
  const paid=getBidPaid(bid.id),total=bid.amount||0,balance=total-paid;
  if(!total)return{label:'Paid in full',cls:'bdg-paid',color:'var(--green)'};
  if(paid<=0)return{label:'Unpaid',cls:'bdg-pending',color:'var(--amber)'};
  if(balance<=0.01)return{label:'Paid in full',cls:'bdg-paid',color:'var(--green)'};
  const dep=bid.deposit||Math.round(total*0.25*100)/100;
  if(dep>0&&paid>=dep-0.01)return{label:'Deposit paid',cls:'bdg-deposit',color:'var(--blue)'};
  return{label:'Partial — '+fmt(balance)+' due',cls:'bdg-pending',color:'var(--amber)'};
}
let activePayBidId=null;
function openQuickPayFromOverview(){
  const wonBids=getClientBids(currentClientId).filter(b=>b.status==='Closed Won'&&getBidBalance(b)>0.01);
  if(!wonBids.length)return;
  setCDTab('bids',document.getElementById('cdt-bids'));
  setTimeout(()=>openPayPanel(wonBids[0].id),100);
}
function openPayPanel(bidId, autoType){
  // autoType: 'deposit' from estimate builder, 'final' from job completion
  activePayBidId=bidId;
  const bid=bids.find(b=>b.id===bidId);if(!bid)return;
  const balance=getBidBalance(bid);
  const total=bid.amount||0;
  const deposit25=Math.round(Math.min(total*.25,balance)*100)/100;
  const rawPaid=getBidPaid(bidId);
  const overpaidAmt=Math.round((rawPaid-total)*100)/100;
  const _payClient=getClientById(bid.client_id);
  const _hubUrl=_payClient?.clientToken&&_supaUser
    ?(_clientBaseUrl()+'client.html?t='+_payClient.clientToken+'&u='+_effectiveUid()+'&c='+_payClient.id)
    :null;

  document.querySelectorAll('.pay-modal-overlay').forEach(e=>e.remove());

  const overlay=document.createElement('div');
  overlay.className='zmodal-overlay pay-modal-overlay';

  const refundBtn='<button type="button" data-ptype="refund" onclick="selectPayType(this,'+bidId+')" style="text-align:left;padding:11px 14px;border-radius:var(--r);border:1.5px solid var(--red-lt,#FEE2E2);background:var(--red-lt,#FFF0F0);cursor:pointer;font-family:inherit;display:flex;justify-content:space-between;align-items:center">'+
    '<div style="font-size:13px;font-weight:700;color:#A32D2D">↩ Issue refund to client</div>'+
    '<div style="font-size:12px;font-weight:700;color:#A32D2D">'+(overpaidAmt>0.01?'-'+fmt(overpaidAmt):'')+'</div>'+
  '</button>';
  const cancelRefundBtn=rawPaid>0.01
    ?'<button type="button" onclick="closePayPanel();showCancellationRefund('+bidId+')" style="text-align:left;padding:11px 14px;border-radius:var(--r);border:1.5px solid var(--border2);background:var(--bg2);cursor:pointer;font-family:inherit">'+
        '<div style="font-size:13px;font-weight:700;color:#A32D2D">✕ Client cancelled</div>'+
      '</button>'
    :'';
  const overpaidBanner=overpaidAmt>0.01
    ?'<div style="background:#FFF3CD;border:1px solid #FFC107;border-radius:var(--r);padding:10px 12px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">'+
        '<div><div style="font-size:13px;font-weight:700;color:#856404">⚠ Refund owed</div>'+
        '<div style="font-size:11px;color:#856404">Client paid '+fmt(rawPaid)+' but bid is now '+fmt(total)+'. Refund: <strong>'+fmt(overpaidAmt)+'</strong></div></div>'+
      '</div>'
    :'';
  const showFinalOnly=autoType==='final';
  // Compact send-to-client buttons (Stripe + QR side by side)
  const hasStripe=!!(_stripeConnectStatus?.charges_enabled&&balance>0.50);
  const hasQr=!!(_hubUrl&&balance>0.50);
  const stripeCompact=hasStripe
    ?'<button type="button" data-ptype="stripe" onclick="selectPayType(this,'+bidId+')" style="padding:12px 8px;border-radius:var(--r);border:1.5px solid #635BFF;background:var(--bg2);cursor:pointer;font-family:inherit;text-align:center;display:flex;flex-direction:column;align-items:center;gap:4px">'+
        '<span style="font-size:20px">💳</span>'+
        '<span style="font-size:12px;font-weight:700;color:#635BFF">Card link</span>'+
        '<span style="font-size:11px;color:var(--text3)">'+fmt(balance)+'</span>'+
      '</button>'
    :'';
  const qrCompact=hasQr
    ?'<button type="button" onclick="showPayQr('+bidId+')" style="padding:12px 8px;border-radius:var(--r);border:1.5px solid var(--border2);background:var(--bg2);cursor:pointer;font-family:inherit;text-align:center;display:flex;flex-direction:column;align-items:center;gap:4px">'+
        '<span style="font-size:20px">📱</span>'+
        '<span style="font-size:12px;font-weight:700">QR code</span>'+
        '<span style="font-size:11px;color:var(--text3)">Client scans</span>'+
      '</button>'
    :'';
  const sendClientRow=(hasStripe||hasQr)
    ?'<div style="display:flex;align-items:center;gap:8px;margin:6px 0 4px">'+
        '<div style="flex:1;height:1px;background:var(--border2)"></div>'+
        '<span style="font-size:10px;font-weight:600;color:var(--text3);white-space:nowrap">or send to client</span>'+
        '<div style="flex:1;height:1px;background:var(--border2)"></div>'+
      '</div>'+
      '<div style="display:grid;grid-template-columns:'+(hasStripe&&hasQr?'1fr 1fr':'1fr')+';gap:8px">'+
        stripeCompact+qrCompact+
      '</div>'
    :'';
  // Secondary: deposit + custom as small 2-col row
  const depositSecondary=rawPaid<0.01
    ?'<button type="button" id="mpay-btn-deposit" data-ptype="deposit" onclick="selectPayType(this,'+bidId+')" style="flex:1;padding:10px 12px;border-radius:var(--r);border:1.5px solid var(--border2);background:var(--bg2);cursor:pointer;font-family:inherit;text-align:left">'+
        '<div style="font-size:12px;font-weight:700">Deposit 25%</div>'+
        '<div style="font-size:13px;font-weight:800;color:var(--blue);margin-top:2px">'+fmt(deposit25)+'</div>'+
      '</button>'
    :'';
  const customSecondary='<button type="button" data-ptype="custom" onclick="selectPayType(this,'+bidId+')" style="flex:1;padding:10px 12px;border-radius:var(--r);border:1.5px solid var(--border2);background:var(--bg2);cursor:pointer;font-family:inherit;text-align:left">'+
    '<div style="font-size:12px;font-weight:700">Custom amount</div>'+
    '<div style="font-size:12px;color:var(--text3);margin-top:2px">Enter exact amount</div>'+
  '</button>';
  const secondaryRow='<div style="display:flex;gap:8px;margin-top:4px">'+(depositSecondary||'')+customSecondary+'</div>';
  // Primary collect button — big green, full width
  const collectBtn='<button type="button" id="mpay-btn-final" data-ptype="final" onclick="selectPayType(this,'+bidId+')" style="width:100%;padding:16px 18px;border-radius:var(--r);border:none;background:var(--green);color:#fff;cursor:pointer;font-family:inherit;display:flex;justify-content:space-between;align-items:center;box-sizing:border-box">'+
    '<div style="text-align:left"><div style="font-size:17px;font-weight:800">Collect '+fmt(balance)+'</div>'+
    '<div style="font-size:12px;opacity:.75;margin-top:2px">Full balance · tap to log payment</div></div>'+
    '<div style="font-size:24px;font-weight:900;opacity:.85">&#8594;</div>'+
  '</button>';
  const typeButtons=collectBtn+sendClientRow+(showFinalOnly?'':secondaryRow);

  overlay.innerHTML=
    '<div class="zmodal">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">'+
        '<div style="font-size:17px;font-weight:800">'+(showFinalOnly?'Collect payment':'Log payment')+'</div>'+
        '<button onclick="closePayPanel()" style="border:none;background:none;font-size:22px;cursor:pointer;color:var(--text3);padding:0;line-height:1">✕</button>'+
      '</div>'+
      overpaidBanner+
      '<div style="font-size:12px;color:var(--text3);margin-bottom:14px">'+bid.client_name+' · '+fmt(total)+' total · '+fmt(balance)+' balance</div>'+
      '<input type="hidden" id="mpay-type">'+
      '<div style="display:grid;gap:8px;margin-bottom:8px" id="mpay-type-btns">'+typeButtons+'</div>'+
      '<button type="button" onclick="_mpayToggleAdj()" style="background:none;border:none;cursor:pointer;font-family:inherit;font-size:12px;font-weight:600;color:var(--text3);padding:4px 0;margin-bottom:8px;text-align:left">⋯ Adjustments & refunds</button>'+
      '<div id="_mpay-adj-btns" style="display:none">'+refundBtn+(rawPaid>0.01?cancelRefundBtn:'')+'</div>'+
      '<div id="mpay-detail-fields" style="display:none">'+
        '<div id="mpay-amount-row" style="display:none" class="f">'+
          '<label>Amount ($) <span id="mpay-max-hint" style="font-weight:400;color:var(--text3);font-size:11px"></span></label>'+
          '<input type="number" id="mpay-amount" placeholder="0.00" step="0.01" min="0" inputmode="decimal"'+
            ' style="font-size:22px;font-weight:800;padding:12px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);width:100%;box-sizing:border-box;color:var(--text);font-family:inherit;text-align:center">'+
        '</div>'+
        '<div class="f" style="margin-bottom:10px">'+
          '<label id="mpay-date-label">Date received</label>'+
          '<input type="date" id="mpay-date" style="font-size:14px;padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);width:100%;box-sizing:border-box;color:var(--text);font-family:inherit">'+
        '</div>'+
        '<div id="mpay-method-row" class="f" style="margin-bottom:10px">'+
          '<label>Payment method</label>'+
          '<select id="mpay-method" onchange="_mpayMethodChange()" style="font-size:14px;padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);width:100%;box-sizing:border-box;color:var(--text);font-family:inherit">'+
            '<option value="Check">Check</option>'+
            '<option value="Cash">Cash</option>'+
            '<option value="Zelle">Zelle</option>'+
            '<option value="Venmo">Venmo</option>'+
            '<option value="Card">Card</option>'+
            '<option value="Other">Other</option>'+
          '</select>'+
        '</div>'+
        '<div class="f" style="margin-bottom:14px">'+
          '<label id="mpay-ref-label">Check # <span style="font-weight:400;color:var(--text3)">(optional)</span></label>'+
          '<input id="mpay-ref" placeholder="Optional" style="font-size:14px;padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);width:100%;box-sizing:border-box;color:var(--text);font-family:inherit">'+
        '</div>'+
      '</div>'+
      '<div id="mpay-err" style="display:none;font-size:12px;color:#A32D2D;background:#FEE8E8;border-radius:var(--r);padding:8px 10px;margin-bottom:8px"></div>'+
      '<button id="mpay-submit-btn" onclick="logPayment()" style="display:none;width:100%;padding:14px;border-radius:var(--r);border:none;background:var(--green);color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit">Record payment</button>'+
    '</div>';

  document.body.appendChild(overlay);
  overlay.addEventListener('click',e=>{if(e.target===overlay)closePayPanel();});
  document.getElementById('mpay-date').value=todayKey();
  document.getElementById('mpay-amount').value='';
  document.getElementById('mpay-ref').value='';

  // Auto-select the right payment type
  const autoBtn=autoType==='deposit'?document.getElementById('mpay-btn-deposit')
    :autoType==='final'?document.getElementById('mpay-btn-final'):null;
  if(autoBtn)setTimeout(()=>selectPayType(autoBtn,bidId),50);
}
function autoFillPayAmount(){
  // No-op — amounts are entered manually, not pre-filled
}
function closePayPanel(){document.querySelectorAll('.pay-modal-overlay').forEach(e=>e.remove());const cdp=document.getElementById('cd-pay-panel');if(cdp)cdp.style.display='none';activePayBidId=null;}
function showPayQr(bidId){
  const bid=bids.find(b=>b.id===bidId);if(!bid)return;
  const c=getClientById(bid.client_id);
  if(!c?.clientToken||!_supaUser){showToast('No client hub for this job.','⚠');return;}
  const hubUrl=_clientBaseUrl()+'client.html?t='+c.clientToken+'&u='+_effectiveUid()+'&c='+c.id;
  const balance=getBidBalance(bid);
  closePayPanel();
  document.getElementById('_pay-qr-ov')?.remove();
  if(!document.getElementById('_qr-anim-style')){
    const s=document.createElement('style');s.id='_qr-anim-style';
    s.textContent='@keyframes _qrIn{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:scale(1)}}';
    document.head.appendChild(s);
  }
  const ov=document.createElement('div');ov.id='_pay-qr-ov';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.7);backdrop-filter:blur(60px) saturate(1.5);-webkit-backdrop-filter:blur(60px) saturate(1.5);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px;animation:_qrIn .22s cubic-bezier(.22,1,.36,1) both';
  ov.innerHTML=
    '<div style="font-size:20px;font-weight:800;color:#fff;margin-bottom:6px">Client scans to pay</div>'+
    '<div style="font-size:13px;color:rgba(255,255,255,.55);margin-bottom:28px">'+(c.name||bid.client_name||'')+(balance>0?' · '+fmt(balance)+' balance':'')+'</div>'+
    '<div id="_qr-wrap" style="background:rgba(255,255,255,.97);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,.8);padding:20px;border-radius:24px;display:flex;align-items:center;justify-content:center;min-width:200px;min-height:200px;box-shadow:0 8px 40px rgba(0,0,0,.35)">'+
      '<div style="font-size:13px;color:#bbb;padding:16px">Generating…</div>'+
    '</div>'+
    '<div style="margin-top:32px;font-size:13px;color:rgba(255,255,255,.35)">Tap anywhere to close</div>';
  ov.addEventListener('click',()=>ov.remove());
  document.body.appendChild(ov);
  const wrap=document.getElementById('_qr-wrap');
  const qrImg=document.createElement('img');
  qrImg.style.cssText='width:240px;height:240px;display:block;border-radius:8px';
  qrImg.alt='QR Code';
  qrImg.onerror=()=>{wrap.innerHTML='<div style="font-size:10px;word-break:break-all;max-width:200px;text-align:center;padding:8px;color:#555">'+hubUrl+'</div>';};
  qrImg.onload=()=>{wrap.innerHTML='';wrap.appendChild(qrImg);};
  qrImg.src='https://api.qrserver.com/v1/create-qr-code/?size=240x240&data='+encodeURIComponent(hubUrl)+'&margin=10';
}
function showCancellationRefund(bidId){
  const bid=bids.find(b=>b.id===bidId);if(!bid)return;
  const totalPaid=getBidPaid(bidId);
  if(totalPaid<=0){zAlert('No deposit recorded for this job — nothing to refund.',{title:'No payment on record'});return;}
  const ov=document.createElement('div');ov.className='zmodal-overlay';ov.id='_cr-overlay';
  const box=document.createElement('div');box.className='zmodal';
  box.innerHTML=
    '<div style="font-size:17px;font-weight:800;margin-bottom:4px">Cancellation refund</div>'+
    '<div style="font-size:13px;color:var(--text3);margin-bottom:16px">'+(bid.client_name||'Client')+' · Deposit collected: <strong>'+fmt(totalPaid)+'</strong></div>'+
    '<div class="f" style="margin-bottom:14px">'+
      '<label>Materials purchased for this job ($)</label>'+
      '<input type="number" id="_cr-mat" data-paid="'+totalPaid+'" placeholder="0.00" step="0.01" min="0" inputmode="decimal"'+
        ' style="font-size:22px;font-weight:800;padding:12px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);width:100%;box-sizing:border-box;color:var(--text);font-family:inherit;text-align:center"'+
        ' oninput="_crCalc()">'+
    '</div>'+
    '<div id="_cr-result" style="border-radius:var(--r);padding:12px 14px;margin-bottom:14px;font-size:13px;color:var(--text3);background:var(--bg2);text-align:center;line-height:1.8">Enter materials cost above</div>'+
    '<div class="f" style="margin-bottom:14px">'+
      '<label>Date of refund</label>'+
      '<input type="date" id="_cr-date" style="font-size:14px;padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);width:100%;box-sizing:border-box;color:var(--text);font-family:inherit">'+
    '</div>'+
    '<button id="_cr-submit" onclick="_submitCancellationRefund('+bidId+')" style="width:100%;padding:14px;border-radius:var(--r);border:none;background:#A32D2D;color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:8px">Issue refund &amp; cancel job</button>'+
    '<button onclick="document.getElementById(\'_cr-overlay\').remove()" style="width:100%;padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:none;color:var(--text3);font-size:14px;cursor:pointer;font-family:inherit">Back</button>';
  ov.appendChild(box);document.body.appendChild(ov);
  document.getElementById('_cr-date').value=todayKey();
  setTimeout(()=>document.getElementById('_cr-mat')?.focus(),80);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
}
function _crCalc(){
  const inp=document.getElementById('_cr-mat');
  const res=document.getElementById('_cr-result');
  const submit=document.getElementById('_cr-submit');
  if(!inp||!res)return;
  const paid=parseFloat(inp.dataset.paid)||0;
  const mat=parseFloat(inp.value)||0;
  const refund=Math.max(0,Math.round((paid-mat)*100)/100);
  if(mat>=paid){
    res.innerHTML='<span style="color:#A32D2D;font-weight:700">Materials cost equals or exceeds deposit — no refund owed.</span><br><span style="font-size:11px">The deposit covers materials.</span>';
    res.style.background='#FEF2F2';
    if(submit)submit.textContent='Cancel job (no refund)';
  } else {
    res.innerHTML='Deposit: <strong>'+fmt(paid)+'</strong> &minus; Materials: <strong>'+fmt(mat)+'</strong><br><span style="font-size:18px;font-weight:800;color:#A32D2D">Refund to client: '+fmt(refund)+'</span>';
    res.style.background='var(--bg2)';
    if(submit)submit.textContent='Issue '+fmt(refund)+' refund & cancel job';
  }
}
function _submitCancellationRefund(bidId){
  const inp=document.getElementById('_cr-mat');
  const dateEl=document.getElementById('_cr-date');
  if(!inp)return;
  const paid=parseFloat(inp.dataset.paid)||0;
  const mat=parseFloat(inp.value)||0;
  const refund=Math.max(0,Math.round((paid-mat)*100)/100);
  const pdate=(dateEl?dateEl.value:'')||todayKey();
  const bid=bids.find(b=>b.id===bidId);if(!bid)return;
  if(refund>0){
    payments.push({id:Date.now(),bid_id:bidId,client_id:bid.client_id,client_name:bid.client_name,
      date:pdate,type:'refund',amount:-refund,method:'',ref:'Cancellation — materials: '+fmt(mat)});
  }
  bid.status='Abandoned';bid.draft=false;
  saveAll();
  document.getElementById('_cr-overlay')?.remove();
  renderDash();
  _refreshClientHub(bid.client_id); // keep client hub balance in sync
  showToast(refund>0?'Refund of '+fmt(refund)+' issued · Job cancelled':'Job cancelled','↩');
}
// ── Close out a sent estimate that was never approved ──────────────────────────
// Marks a sent-but-unsigned proposal as "Closed Lost" with a reason (e.g. the
// client went with another contractor). Keeps the record + close-rate stats honest
// instead of leaving dead estimates stuck in "Awaiting signature" forever.
const LOST_REASONS=['Went with another contractor','Price was too high','Project postponed or cancelled','Couldn’t reach client / no response','Decided not to do the work','Other'];
function openCloseOutEstimate(bidId){
  const b=bids.find(x=>x.id===bidId);if(!b)return;
  const c=getClientById(b.client_id)||{name:b.client_name||b.name||'this client'};
  document.getElementById('_co-overlay')?.remove();
  const ov=document.createElement('div');ov.className='zmodal-overlay';ov.id='_co-overlay';
  const box=document.createElement('div');box.className='zmodal';
  box.style.cssText='animation:td-modal-enter .22s cubic-bezier(.22,1,.36,1) both';
  box.innerHTML=
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">'+
      '<div style="font-size:16px;font-weight:800">Close out estimate</div>'+
      '<button onclick="this.closest(\'.zmodal-overlay\').remove()" style="border:none;background:none;font-size:22px;cursor:pointer;color:var(--text3)">×</button>'+
    '</div>'+
    '<div style="font-size:12px;color:var(--text3);line-height:1.6;margin-bottom:14px">Mark <strong>'+escHtml(c.name)+'</strong>’s '+fmt(b.amount||0)+' proposal as lost. It moves to the Declined tab and stops counting against your close rate as pending.</div>'+
    '<label style="display:block;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:6px">Why didn’t it close?</label>'+
    '<select id="_co-reason" style="width:100%;box-sizing:border-box;padding:11px 12px;font-size:14px;border:1px solid var(--border2);border-radius:var(--r);background:var(--bg);color:var(--text);font-family:inherit;margin-bottom:12px">'+
      LOST_REASONS.map(r=>'<option value="'+escHtml(r)+'">'+escHtml(r)+'</option>').join('')+
    '</select>'+
    '<label style="display:block;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:6px">Note (optional)</label>'+
    '<textarea id="_co-note" rows="2" placeholder="e.g. went with a cheaper bid from a friend" style="width:100%;box-sizing:border-box;padding:10px 12px;font-size:13px;border:1px solid var(--border2);border-radius:var(--r);background:var(--bg);color:var(--text);font-family:inherit;resize:vertical;margin-bottom:16px"></textarea>'+
    '<div style="display:flex;gap:8px">'+
      '<button onclick="this.closest(\'.zmodal-overlay\').remove()" style="flex:1;padding:12px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">Cancel</button>'+
      '<button onclick="_submitCloseOutEstimate('+bidId+')" style="flex:2;padding:12px;border-radius:var(--r);border:none;background:#A32D2D;color:#fff;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">Mark as lost</button>'+
    '</div>';
  ov.appendChild(box);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
}
function _submitCloseOutEstimate(bidId){
  const b=bids.find(x=>x.id===bidId);if(!b)return;
  const reason=document.getElementById('_co-reason')?.value||'Other';
  const note=(document.getElementById('_co-note')?.value||'').trim();
  b.status='Closed Lost';b.draft=false;
  b.lostReason=reason;b.lostNote=note;b.lostAt=new Date().toISOString();
  saveAll();
  // Re-publish the client hub so the declined proposal stays in the hub Documents
  // (read-only, with its reason) instead of vanishing once it leaves Pending.
  if(b.client_id&&typeof _uploadClientHub==='function')_uploadClientHub(b.client_id).catch(()=>{});
  document.getElementById('_co-overlay')?.remove();
  document.querySelector('[data-bdov]')?.remove();
  if(typeof renderProposalsPage==='function')renderProposalsPage();
  if(typeof renderDash==='function')renderDash();
  if(typeof renderCDBids==='function')try{renderCDBids();}catch(e){}
  if(typeof renderClientDetail==='function')try{renderClientDetail();}catch(e){}
  showToast('Estimate closed out — marked lost','✓');
}
function reopenEstimate(bidId){
  const b=bids.find(x=>x.id===bidId);if(!b)return;
  b.status='Pending';
  delete b.lostReason;delete b.lostNote;delete b.lostAt;
  saveAll();
  // Re-publish the hub so the declined card clears once the estimate is reopened.
  if(b.client_id&&typeof _uploadClientHub==='function')_uploadClientHub(b.client_id).catch(()=>{});
  document.querySelector('[data-bdov]')?.remove();
  if(typeof renderProposalsPage==='function')renderProposalsPage();
  if(typeof renderDash==='function')renderDash();
  showToast('Estimate reopened — back to awaiting signature','↩');
}
function selectPayType(btn, bidId){
  // Deselect all — keep collect button green but dimmed
  const typeContainer=document.getElementById('mpay-type-btns');
  if(typeContainer)typeContainer.querySelectorAll('button[data-ptype]').forEach(b=>{
    if(b.dataset.ptype==='final'){b.style.background='var(--green)';b.style.border='none';b.style.color='#fff';b.style.opacity='.45';}
    else{b.style.borderColor='var(--border2)';b.style.background='var(--bg2)';b.style.color='var(--text)';b.style.opacity='';}
  });
  const ptype=btn.dataset.ptype;
  if(ptype==='final'){btn.style.opacity='1';}
  else{btn.style.borderColor='var(--blue)';btn.style.background='var(--blue-lt)';btn.style.color='var(--text)';}
  const bid=bids.find(b=>b.id==bidId);if(!bid)return;
  const balance=getBidBalance(bid);
  const total=bid.amount||0;
  const deposit25=Math.round(total*.25*100)/100;
  const tf=document.getElementById('mpay-type');if(tf)tf.value=ptype==='custom'?'partial':ptype;
  const amtRow=document.getElementById('mpay-amount-row');
  const amtEl=document.getElementById('mpay-amount');
  const hint=document.getElementById('mpay-max-hint');
  const submitBtn=document.getElementById('mpay-submit-btn');
  const dateLabel=document.getElementById('mpay-date-label');
  const mRow=document.getElementById('mpay-method-row');
  if(ptype==='deposit'){
    const depositAmt=Math.min(deposit25,balance);
    if(amtEl)amtEl.value=depositAmt.toFixed(2);
    if(amtRow)amtRow.style.display='block';
    if(hint)hint.textContent='25% of '+fmt(total);
    if(amtEl){amtEl.readOnly=true;amtEl.style.background='var(--bg2)';amtEl.style.color='var(--text3)';}
    if(submitBtn){submitBtn.textContent='Record payment';submitBtn.style.background='var(--green)';}
    if(dateLabel)dateLabel.textContent='Date received';
  } else if(ptype==='final'){
    if(amtEl)amtEl.value=balance.toFixed(2);
    if(amtRow)amtRow.style.display='block';
    if(hint)hint.textContent='remaining balance';
    if(amtEl){amtEl.readOnly=true;amtEl.style.background='var(--bg2)';amtEl.style.color='var(--text3)';}
    if(submitBtn){submitBtn.textContent='Record payment';submitBtn.style.background='var(--green)';}
    if(dateLabel)dateLabel.textContent='Date received';
  } else if(ptype==='stripe'){
    if(amtRow)amtRow.style.display='none';
    if(hint)hint.textContent='';
    if(dateLabel)dateLabel.textContent='';
  } else if(ptype==='refund'){
    const rawBidPaid=getBidPaid(bidId);
    const rawBidTotal=(bids.find(b=>b.id==bidId)||{}).amount||0;
    const refAmt=Math.max(0,Math.round((rawBidPaid-rawBidTotal)*100)/100);
    if(amtEl){amtEl.value=refAmt>0?refAmt.toFixed(2):'';amtEl.readOnly=false;amtEl.style.background='';amtEl.style.color='';}
    if(amtRow)amtRow.style.display='block';
    if(hint)hint.textContent='refund amount';
    if(submitBtn){submitBtn.textContent='Issue refund';submitBtn.style.background='#A32D2D';}
    if(dateLabel)dateLabel.textContent='Date issued';
    setTimeout(()=>amtEl&&amtEl.focus(),50);
  } else {
    if(amtEl){amtEl.value='';amtEl.readOnly=false;amtEl.style.background='';amtEl.style.color='';}
    if(amtRow)amtRow.style.display='block';
    if(hint)hint.textContent='max: '+fmt(balance);
    if(submitBtn){submitBtn.textContent='Record payment';submitBtn.style.background='var(--green)';}
    if(dateLabel)dateLabel.textContent='Date received';
    setTimeout(()=>amtEl&&amtEl.focus(),50);
  }
  // Reveal detail fields and submit button for all types except direct actions
  const df=document.getElementById('mpay-detail-fields');
  const sb=document.getElementById('mpay-submit-btn');
  if(ptype==='stripe'){
    if(df)df.style.display='none';
    if(sb){sb.style.display='';sb.textContent='Send Stripe payment link →';sb.style.background='#635BFF';}
  }else{
    if(df)df.style.display='';
    if(sb)sb.style.display='';
  }
}

function _mpayToggleAdj(){
  const d=document.getElementById('_mpay-adj-btns');
  if(!d)return;
  if(d.style.display==='none'){d.style.display='grid';d.style.gap='8px';d.style.marginBottom='10px';}
  else d.style.display='none';
}
function _mpayMethodChange(){
  const m=document.getElementById('mpay-method')?.value||'';
  const lbl=document.getElementById('mpay-ref-label');
  if(!lbl)return;
  const isCheck=m==='Check';
  lbl.innerHTML=(isCheck?'Check #':'Reference')+' <span style="font-weight:400;color:var(--text3)">(optional)</span>';
  const ref=document.getElementById('mpay-ref');
  if(ref)ref.placeholder=isCheck?'e.g. 1042':'Optional';
}
function _mpayErr(msg){
  const e=document.getElementById('mpay-err');
  if(e){e.textContent=msg;e.style.display='block';}
}
// Issue a real Stripe refund for a card-paid bid via the refund-payment edge function:
// EXACT typed amount, this bid's payment intent (so it can only reach this client), on the
// contractor's connected account. Books the ledger entry keyed by the Stripe refund id so
// the collect balance updates immediately; the charge.refunded webhook is an idempotent
// backstop that dedupes by the SAME ref, so a refund is never double-booked.
async function _issueCardRefund(bidId,amount,bid){
  try{
    const sess=await _supa.auth.getSession();
    const token=sess&&sess.data&&sess.data.session?sess.data.session.access_token:null;
    if(!token)throw new Error('Sign in required to refund');
    const res=await fetch(SUPA_URL+'/functions/v1/refund-payment',{
      method:'POST',
      headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',apikey:(typeof SUPA_KEY!=='undefined'?SUPA_KEY:'')},
      body:JSON.stringify({bidId:bidId,amount:amount})
    });
    const d=await res.json().catch(()=>({}));
    if(!res.ok||!d.refund)throw new Error(d.error||'Refund failed');
    const refAmt=d.refund.amount;
    if(!payments.some(p=>p.ref===d.refund.id)){
      payments.push({id:Date.now(),bid_id:bidId,client_id:bid?bid.client_id:null,client_name:bid?bid.client_name:'',date:new Date().toISOString().slice(0,10),type:'refund',amount:-refAmt,method:'Card',ref:d.refund.id});
      saveAll();
    }
    renderCDBids&&renderCDBids();renderDash&&renderDash();renderMoneyPage&&renderMoneyPage();refreshCollectLabel&&refreshCollectLabel();
    _refundBanner('↩ Refund of '+fmt(refAmt)+' issued to '+(bid&&bid.client_name?bid.client_name:'client')+'’s card');
  }catch(e){
    _refundBanner('Refund failed: '+(e&&e.message?e.message:e),true);
  }
}
function _refundBanner(msg,isErr){
  const banner=document.createElement('div');
  banner.style.cssText='position:fixed;top:0;left:0;right:0;z-index:9999;animation:slideDown .3s ease';
  banner.innerHTML='<div style="background:'+(isErr?'#7A1A1A':'#A32D2D')+';color:#fff;padding:14px 16px;text-align:center;font-size:15px;font-weight:700">'+msg+'</div>';
  document.body.appendChild(banner);
  setTimeout(()=>banner.remove(),4000);
}
function logPayment(){
  if(_submitting)return;
  const errEl=document.getElementById('mpay-err');if(errEl){errEl.style.display='none';}
  const type=v('mpay-type')||v('pay-type');
  if(!type){_mpayErr('Select a payment type above.');return;}
  if(type==='stripe'){const _bid=activePayBidId;closePayPanel();sendPaymentLink(_bid);return;}
  const a=parseFloat(v('mpay-amount')||v('pay-amount'));
  if(!a||a<=0){
    const amtEl=document.getElementById('mpay-amount');
    if(amtEl){amtEl.style.borderColor='#A32D2D';amtEl.focus();}
    _mpayErr('Enter an amount.');return;
  }
  const pdate=v('mpay-date')||v('pay-date');
  if(!pdate){
    const dtEl=document.getElementById('mpay-date');
    if(dtEl){dtEl.style.borderColor='#A32D2D';dtEl.focus();}
    _mpayErr('Enter the date.');return;
  }
  const isRefund=(type==='refund');
  if(!isRefund&&activePayBidId){
    const _chkBid=bids.find(b=>b.id===activePayBidId);
    if(_chkBid&&a>getBidBalance(_chkBid)+0.01){
      const amtEl2=document.getElementById('mpay-amount');if(amtEl2)amtEl2.style.borderColor='#A32D2D';
      _mpayErr('Amount exceeds balance of '+fmt(getBidBalance(_chkBid))+'. Enter the actual amount received.');return;
    }
  }
  if(!activePayBidId)return;
  const bid=bids.find(b=>b.id===activePayBidId);if(!bid)return;
  const pref=v('mpay-ref')||v('pay-ref');
  const pmethod=v('mpay-method')||v('pay-method')||'';
  // Card refund → issue a REAL Stripe refund of the EXACT typed amount, against THIS
  // bid's card payment (so it can only go to this bid's client), on the contractor's
  // connected account. Detected by a prior card payment whose ref is a pi_… intent.
  // _issueCardRefund books the ledger entry itself; cash/manual refunds fall through to
  // the local push below.
  if(isRefund){
    const _cardPay=payments.find(p=>p.bid_id===activePayBidId&&(p.amount||0)>0&&typeof p.ref==='string'&&p.ref.indexOf('pi_')===0);
    if(_cardPay){
      const _rBid=bid,_rBidId=activePayBidId,_rAmt=a;
      closePayPanel();
      _issueCardRefund(_rBidId,_rAmt,_rBid);
      return;
    }
  }
  const storedAmount=isRefund?-a:a;
  payments.push({id:Date.now(),bid_id:activePayBidId,client_id:bid.client_id,client_name:bid.client_name,date:pdate,type:type,amount:storedAmount,method:pmethod,ref:pref});
  const _savedBidId=activePayBidId;
  saveAll();emitEvent('payment_received',bid.client_id,{bid_id:activePayBidId,amount:storedAmount});closePayPanel();renderCDBids();renderCDTimeline();

  if(isRefund){
    const banner=document.createElement('div');
    banner.style.cssText='position:fixed;top:0;left:0;right:0;z-index:9999;animation:slideDown .3s ease';
    banner.innerHTML=
      '<div style="background:#A32D2D;color:#fff;padding:14px 16px;text-align:center;font-size:15px;font-weight:700">'+
        '↩ Refund of '+fmt(a)+' logged'+
      '</div>'+
      '<div style="background:#7A1A1A;color:#fff;padding:8px 16px;text-align:center;font-size:12px">'+
        'Payment records updated · balance recalculated'+
      '</div>';
    document.body.appendChild(banner);
    setTimeout(()=>banner.remove(),4000);
    renderCDBids();renderDash();renderMoneyPage();refreshCollectLabel();
    return;
  }

  const tIn=income.reduce((s,r)=>s+(r.amount||0),0)+a;
  const tEx=expenses.reduce((s,r)=>s+(r.amount||0),0);
  const tMi=mileage.reduce((s,r)=>s+(r.miles||0),0);
  const netSelf=Math.max(0,tIn-tEx-(tMi*IRS()));
  const seBase=netSelf*.9235,seTax=seBase*.153,seDed=seTax/2;
  const status=v('tx-status')||S.txStatus||'single';
  const stdDed=STD_DED[status]||14600;
  const fedTax=calcBrackets(Math.max(0,netSelf-seDed-stdDed),FED_BRACKETS[status]||FED_BRACKETS.single);
  const ksTax=calcBrackets(Math.max(0,netSelf-seDed-(KS_STD[status]||3500)),KS_BRACKETS[status]||KS_BRACKETS.single);
  const totalOwed=seTax+fedTax+ksTax;
  const reserveRate=netSelf>0?Math.ceil(totalOwed/netSelf*100):32;
  const reserveFromThis=Math.ceil(a*reserveRate/100);

  const newBalance=getBidBalance(bid);
  if(newBalance<=0.01){
    saveAll();
    renderClientDetail();
    const banner=document.createElement('div');
    banner.style.cssText='position:fixed;top:0;left:0;right:0;z-index:9999;animation:slideDown .3s ease';
    banner.innerHTML=
      '<div style="background:var(--green);color:#fff;padding:14px 16px;text-align:center;font-size:15px;font-weight:700">'+
        '✓ Paid in full — '+fmt(bid.amount)+' received'+
      '</div>'+
      '<div style="background:#1A4A0A;color:#fff;padding:10px 16px;text-align:center;font-size:13px">'+
        '&#128176; Set aside <strong>'+fmt(reserveFromThis)+'</strong> from this payment for taxes ('+reserveRate+'%)'+
      '</div>';
    document.body.appendChild(banner);
    setTimeout(()=>banner.remove(),5000);
    // NOTE: do NOT auto-log to income here — payments array is the source of truth for bid revenue.
    // Income array is for manual non-bid entries only. Auto-logging caused dashboard double-counting.
  } else {
    const banner=document.createElement('div');
    banner.style.cssText='position:fixed;top:0;left:0;right:0;z-index:9999;animation:slideDown .3s ease';
    banner.innerHTML=
      '<div style="background:var(--blue);color:#fff;padding:12px 16px;text-align:center;font-size:13px;font-weight:700">'+
        fmt(a)+' logged · '+fmt(newBalance)+' still owed'+
      '</div>'+
      '<div style="background:#1A3A5A;color:#fff;padding:8px 16px;text-align:center;font-size:12px">'+
        '&#128176; Set aside <strong>'+fmt(reserveFromThis)+'</strong> from this payment for taxes ('+reserveRate+'%)'+
      '</div>'+
      (bid.surfaces?.length?'<div style="background:#2D4A1A;color:#fff;padding:8px 16px;text-align:center;font-size:12px">'+
        '&#128230; Deposit received — <button onclick="this.closest(\'div\').parentElement.remove();showSupplyList('+bid.id+')" style="background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.4);color:#fff;font-size:12px;font-weight:700;padding:3px 10px;border-radius:4px;cursor:pointer;font-family:inherit">Order materials now →</button>'+
      '</div>':'');
    document.body.appendChild(banner);
    setTimeout(()=>banner.remove(),4000);
  }
  renderCDBids();renderDash();renderMoneyPage();refreshCollectLabel();
  _refreshClientHub(bid.client_id);
  // After payment — if no job scheduled yet, offer to schedule.
  // A job counts whether it's linked by bid_id OR is an unlinked job for the same
  // client (the schedule form doesn't require picking the bid — same fallback the
  // bid detail panel uses), in ANY state including done: a completed job means
  // "already scheduled", never re-prompt. And a paid-in-full payment is the END of
  // the money chain (collection) — the work plainly already happened, so never
  // offer to schedule off the final payment either.
  if(_savedBidId&&newBalance>0.01){
    const _pb=bids.find(b=>b.id===_savedBidId);
    const _hasJob=_pb&&jobs.some(j=>
      j.eventType!=='estimate'&&j.eventType!=='task'&&j.status!=='canceled'&&
      (String(j.bid_id)===String(_pb.id)||(!j.bid_id&&String(j.client_id)===String(_pb.client_id)))
    );
    if(_pb&&!_hasJob){
      setTimeout(()=>{
        zConfirm('Payment logged! Schedule this job on the calendar?',
          ()=>{schedFromBid(_pb.id);},
          {title:'Schedule now?',yes:'Schedule',danger:false});
      },300);
    }
  }
}
function deletePay(id){zConfirm('Delete this payment record?',()=>{_userDelete(()=>{payments=payments.filter(p=>p.id!==id);saveAll();});renderCDBids();},{title:'Delete payment',yes:'Delete',danger:true});}

let activeLienBidId=null;
function openLienPanel(bidId){
  activeLienBidId=bidId;
  const bid=bids.find(b=>b.id===bidId);if(!bid)return;
  const existing=getBidLien(bidId);
  document.getElementById('lien-date').value=existing?existing.date:todayKey();
  document.getElementById('lien-status').value=existing?existing.status:'intent';
  document.getElementById('lien-amount').value=existing?existing.amount:getBidBalance(bid).toFixed(2);
  document.getElementById('lien-county').value=existing?existing.county:'Sedgwick County';
  document.getElementById('lien-notes').value=existing?existing.notes:'';
  document.getElementById('cd-lien-panel').style.display='block';
  document.getElementById('cd-lien-panel').scrollIntoView({behavior:'smooth',block:'nearest'});
}
function closeLienPanel(){document.getElementById('cd-lien-panel').style.display='none';activeLienBidId=null;}

// editingBidId declared at top with est vars
function viewBidFromTimeline(bidId){
  setCDTab('bids',document.getElementById('cdt-bids'));
  setTimeout(()=>{
    const card=document.getElementById('bid-card-'+bidId);
    if(card)card.scrollIntoView({behavior:'smooth',block:'nearest'});
  },100);
}

function openEditBid(bidId,startStep){
  const b=bids.find(x=>x.id===bidId);if(!b)return;
  const c=getClientById(b.client_id||currentClientId);
  // Full state wipe — prevents ANY bleed from a prior estimate session
  _pendingSignToken=null;
  _swLastProductByCategory={};
  surfRoom='';surfColor='';surfWhatSelected=[];surfBQueue=[];surfBIdx=0;surfBMeasurements={};
  surfJobType=b.surfaces&&b.surfaces.some(s=>['ext_walls','ext_trim','deck'].includes(s.type))?'exterior':'interior';
  scopeActiveMap={};scopeHrsStore={};roomScopeMap={};
  estPropertyTier={key:'avg',mult:1.00,paint:'ProMar 200',products:{interior:'pm200',exterior:'spe',trim:'pm200t'}};
  editingBidId=bidId;lastCreatedBidId=null;
  estLinkedClientId=b.client_id||currentClientId;
  estSurfaces=[];estSurfId=0;
  clearEstFullDraft(); // editing existing bid — never offer to resume a new estimate
  const _plbE=document.getElementById('proposal-link-bar');if(_plbE){_plbE.style.display='none';_plbE.dataset.signingUrl='';}
  const _pliE=document.getElementById('proposal-link-input');if(_pliE)_pliE.value='';
  const _sBtnE=document.getElementById('send-proposal-btn');if(_sBtnE){_sBtnE.textContent='🔗 Send to client';_sBtnE.disabled=false;}
  goPg('pg-est');
  buildScopeGrid();
  setTimeout(()=>{
    const sf=(id,val)=>{const el=document.getElementById(id);if(el)el.value=val||'';};
    const _ebn=getBusinessName();if(_ebn&&_ebn!=='TradeDesk'&&!_ebn.includes('@'))sf('e-bname',_ebn);
    if(S.bphone)sf('e-bphone',S.bphone);
    if(S.blic)sf('e-blic',S.blic);
    sf('e-labor-rate',S.laborRate||45);
    sf('e-paint-rate',83);
    sf('e-cname',c?c.name:b.name||'');
    sf('e-cphone',c?c.phone:b.phone||'');
    sf('e-caddr',c?c.addr:b.addr||'');
    if((c?.addr||b?.addr)&&typeof _paintLookupClientTaxRate==='function')_paintLookupClientTaxRate();
    sf('e-cnotes',b.notes||'');
    ['e-cname','e-cphone','e-caddr'].forEach(id=>{const el=document.getElementById(id);if(el&&el.value)markFieldFilled(el);});
    if(c&&c.ptype){const el=document.getElementById('e-cprop');if(el)el.value=c.ptype;}
    if(b.days){
      const el=document.getElementById('e-days');
      if(el){el.value=b.days;el.style.borderColor='var(--border2)';el.style.background='var(--bg2)';}
    }
    const cmiles=getClientMileage(estLinkedClientId);
    const totalMiles=cmiles.reduce((s,m)=>s+(m.miles||0),0);
    if(totalMiles>0){sf('e-travel',(Math.round(totalMiles*10)/10).toString());}
    const linked=document.getElementById('e-client-linked');
    if(linked)linked.innerHTML='<span class="conn-tag">'+escHtml(c?c.name:'linked')+' — editing existing bid</span>';
    estPropertyTier={key:'avg',mult:1.00,paint:'ProMar 200'};
  SCOPE_ITEMS.forEach(s=>{const cb=document.getElementById('est-sc-'+s.id),tog=document.getElementById('est-st-'+s.id);if(cb){cb.checked=false;if(tog)tog.classList.remove('on');}});
    const _ptogE=document.getElementById('portfolio-toggle');
    if(_ptogE){_ptogE.checked=!!b.isPortfolio;togglePortfolioShowcase();}
    const _ppctE=document.getElementById('portfolio-pct');if(_ppctE)_ppctE.value=b.portfolioPct||15;
    roomScopeMap=b.roomScopeMap?JSON.parse(JSON.stringify(b.roomScopeMap)):{};
    if(b.scope&&Object.keys(b.scope).length){
      Object.entries(b.scope).forEach(([id,val])=>toggleScope(id,!!val));
      if(!Object.values(b.scope).some(Boolean))applyDefaultScope();
    } else{applyDefaultScope();}
    if(b.surfaces&&b.surfaces.length){estSurfaces=[...b.surfaces];estSurfId=Math.max(...b.surfaces.map(s=>s.id||0),0);}
    if(b.cond){
      const el=document.getElementById('e-cond');if(el)el.value=b.cond;
      document.querySelectorAll('[id^=cond-]').forEach(b=>b.classList.remove('active-surf-btn'));
      const condMap={'1.0':'cond-good','1.2':'cond-fair','1.5':'cond-poor'};
      const cb=document.getElementById(condMap[b.cond]||'cond-good');if(cb)cb.classList.add('active-surf-btn');
    }
    if(b.paint){
      const el=document.getElementById('e-paint');if(el)el.value=b.paint;
      setPaintSupply(b.paint==='customer'?'customer':'zach');
    }
    if(b.colors!==undefined){const el=document.getElementById('e-colors');if(el){el.value=b.colors;el.style.borderColor='var(--border2)';el.style.background='var(--bg2)';}}
    const adj=document.getElementById('est-adj');if(adj)adj.value=0;
    const adjv=document.getElementById('est-adj-val');if(adjv)adjv.textContent='0%';
    renderEstSurfs();
    goEstStep(startStep||3); // step 2 merged into 3
    const tip=document.querySelector('#est-s3 .tip');
    if(tip)tip.innerHTML='<strong>Editing existing bid</strong> for '+escHtml(c?c.name:b.name||'client')+' · previous amount: '+fmt(b.amount)+'. Re-enter surfaces and adjust as needed.';
    if((startStep||2)>=4){renderEstReview();renderEstRunning();}
  },80);
}

function deleteBid(bidId){
  const b=bids.find(x=>x.id===bidId);
  zConfirm('Delete this bid'+(b?' ('+fmt(b.amount)+')':'')+' permanently? Payment records and any lien will also be removed.',()=>{
    const _cid=b?.client_id;
    _userDelete(()=>{
      bids=bids.filter(x=>x.id!==bidId);
      payments=payments.filter(p=>p.bid_id!==bidId);
      liens=liens.filter(l=>l.bid_id!==bidId);
      clearEstFullDraft();saveAll();
    });
    renderClientDetail();
    if(_cid)_uploadClientHub(_cid).catch(e=>console.error('[hub upload]',e));
  },{title:'Delete bid',yes:'Delete permanently',danger:true});
}
function saveLien(){
  if(!activeLienBidId)return;
  const status=v('lien-status');
  const bidId=activeLienBidId;
  const bid=bids.find(b=>b.id===bidId);if(!bid)return;
  _userDelete(()=>{
    liens=liens.filter(l=>l.bid_id!==activeLienBidId);
    liens.push({id:Date.now(),bid_id:activeLienBidId,client_id:bid.client_id,client_name:bid.client_name,date:v('lien-date'),status,amount:parseFloat(v('lien-amount'))||0,county:v('lien-county'),notes:v('lien-notes')});
    saveAll();
  });
  closeLienPanel();renderCDBids();
  if(bid&&(status==='filed'||status==='attorney')){
    setClientRisk(bid.client_id,'high_risk');
    setBidCollStage(bid,'lien_filed','Lien filed');
  }
  if(bid&&status==='intent'){setBidCollStage(bid,'intent','Intent to lien recorded');}
  renderDashActiveLiens();
  if(status==='filed'||status==='attorney'){setTimeout(()=>printKansasLien(bidId),300);}
}
function releaseLien(bidId){
  const bid=bids.find(b=>b.id===bidId);
  const c=bid?getClientById(bid.client_id):null;
  zConfirm('Mark lien as released? This confirms payment has been received.',()=>{
    const l=liens.find(x=>x.bid_id===bidId);
    if(l){l.status='resolved';saveAll();}
    if(bid){setBidCollStage(bid,'resolved','Lien released — payment confirmed');}
    renderMoneyPage();try{renderCDBids();}catch(e){}
    // Offer to send release confirmation text to client
    if(c&&c.phone){
      const biz=S.bname||'TradeDesk';
      const msg=`Hi ${c.name}, this is ${biz}. We're writing to confirm that your balance has been received and the mechanic's lien on your property has been released. Thank you for resolving this — we appreciate your business.`;
      const phone=c.phone.replace(/\D/g,'');
      setTimeout(()=>{
        zConfirm('Send release confirmation text to '+c.name+'?',()=>{
          const a=document.createElement('a');
          a.href='sms:+1'+phone+'&body='+encodeURIComponent(msg);
          a.style.display='none';document.body.appendChild(a);a.click();
          setTimeout(()=>document.body.removeChild(a),500);
        },{title:'Notify client',yes:'Send text',danger:false});
      },300);
    }
  },{title:'Release lien',yes:'Mark released',danger:false});
}

// ── Collection, risk, lien & county helpers (moved from constants.js) ─────
function getBidCollStage(bid){
  const lien=getBidLien(bid.id);
  if(lien&&(lien.status==='filed'||lien.status==='attorney'))return 'lien_filed';
  if(lien&&lien.status==='intent')return 'intent';
  if(lien&&lien.status==='resolved')return 'resolved';
  const rules=getLienRulesForBid(bid);
  const daysUnpaid=bid.completion_date?daysSince(bid.completion_date):0;
  return getAutoCollStage(daysUnpaid,bid.collStage,rules);
}
function setBidCollStage(bid,stage,note){
  bid.collStage=stage;
  if(!bid.collHistory)bid.collHistory=[];
  bid.collHistory.push({stage,note,ts:new Date().toISOString()});
  saveAll();
}
function collSendSMS(bid,stageKey){
  const c=getClientById(bid.client_id);
  if(!c||!c.phone)return zAlert('No phone number on file for this client. Add one in their profile first.',{title:'No phone'});
  const biz=S.bname||'TradeDesk';
  const bal=getBidBalance(bid);
  const addr=bid.addr||c.addr||'the property';
  const tplKey={reminder:'smsReminder',second:'smsSecond',intent:'smsIntent'}[stageKey];
  const defaults=_getSmsDefaults();
  const defKey={reminder:'reminder',second:'second',intent:'intent'}[stageKey];
  const msg=tplKey&&S[tplKey]
    ?_smsApply(S[tplKey],{name:c.name,business:biz,amount:fmt(bal),address:addr})
    :(COLL_SMS[stageKey]?COLL_SMS[stageKey](c.name,bal,addr,biz,(typeof detectStateFromAddr==='function'&&typeof STATE_LIEN!=='undefined'&&STATE_LIEN[detectStateFromAddr(bid.addr||c.addr||'')||S?.state])?STATE_LIEN[detectStateFromAddr(bid.addr||c.addr||'')||S.state].statute:'applicable state law'):_smsApply(defaults[defKey]||'',{name:c.name,business:biz,amount:fmt(bal),address:addr}));
  const phone=c.phone.replace(/\D/g,'');
  const newStage=stageKey==='reminder'?'reminder':stageKey==='second'?'second':'intent';
  const stageLabel={reminder:'Reminder',second:'2nd Notice',intent:'Intent to Lien'}[stageKey]||stageKey;
  const ov=document.createElement('div');ov.className='zmodal-overlay';
  const box=document.createElement('div');box.className='zmodal';
  box.innerHTML=
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">'+
      '<div style="font-size:15px;font-weight:800">💬 '+stageLabel+' — '+escHtml(c.name)+'</div>'+
      '<button onclick="this.closest(\'.zmodal-overlay\').remove()" style="border:none;background:none;font-size:22px;cursor:pointer;color:var(--text3)">✕</button>'+
    '</div>'+
    '<div style="background:var(--bg2);border-radius:var(--r);padding:12px;font-size:12px;color:var(--text);line-height:1.6;margin-bottom:14px;max-height:160px;overflow-y:auto">'+escHtml(msg)+'</div>'+
    '<div style="font-size:11px;color:var(--text3);margin-bottom:14px">Amount: <strong>'+fmt(bal)+'</strong> · Sending to: '+escHtml(c.phone)+'</div>'+
    '<div style="display:flex;gap:8px">'+
      '<button onclick="this.closest(\'.zmodal-overlay\').remove()" style="flex:1;padding:12px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">Cancel</button>'+
      '<button onclick="_doCollSMS(\''+phone+'\',\''+encodeURIComponent(msg)+'\',bids.find(x=>x.id=='+bid.id+'),\''+newStage+'\',\''+stageLabel+'\');this.closest(\'.zmodal-overlay\').remove()" style="flex:2;padding:12px;border-radius:var(--r);border:none;background:var(--amber);color:#1a1a1a;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">Send via Messages →</button>'+
    '</div>'+
    '<div style="margin-top:10px">'+
      '<button onclick="_markCollSMSSent(bids.find(x=>x.id=='+bid.id+'),\''+newStage+'\',\''+stageLabel+'\');this.closest(\'.zmodal-overlay\').remove()" style="width:100%;padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg);font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;color:var(--text2)">✓ Already sent — mark as sent</button>'+
    '</div>';
  ov.appendChild(box);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
}
function _doCollSMS(phone,encodedMsg,bid,newStage,label){
  if(!bid)return;
  const a=document.createElement('a');
  a.href='sms:+1'+phone+'&body='+encodedMsg;
  a.style.display='none';document.body.appendChild(a);a.click();
  setTimeout(()=>document.body.removeChild(a),500);
  setTimeout(()=>{zConfirm('Did the message send successfully?',()=>{_markCollSMSSent(bid,newStage,label);},{title:'Confirm sent',yes:'Yes, sent',no:'No',danger:false});},2000);
}
function _markCollSMSSent(bid,newStage,label){
  if(!bid)return;
  setBidCollStage(bid,newStage,label+' SMS sent — '+new Date().toLocaleDateString());
  if(!bid.collHistory)bid.collHistory=[];
  bid.collHistory.push({stage:newStage,note:label+' sent',ts:new Date().toISOString(),method:'sms'});
  autoLogContact(bid.client_id,'collection_sms');
  saveAll();
  showToast(label+' sent to '+(getClientById(bid.client_id)?.name||'client'),'💬');
  setTimeout(()=>{renderMoneyPage();try{renderCDBids();}catch(e){}try{renderDash();}catch(e){}},400);
}
function getClientRisk(cid){const c=getClientById(cid);return c?c.riskLevel||'normal':'normal';}
function setClientRisk(cid,level){
  const c=getClientById(cid);if(!c)return;
  c.riskLevel=level;
  if(!c.riskFlags)c.riskFlags=[];
  if(level==='high_risk'&&!c.riskFlags.includes('lien_filed'))c.riskFlags.push('lien_filed');
  saveAll();
}
function riskBadge(cid){
  const r=getClientRisk(cid);
  if(r==='blacklisted')return '<span style="font-size:10px;font-weight:800;background:#000;color:#fff;padding:2px 6px;border-radius:4px">🚫 BLACKLISTED</span>';
  if(r==='high_risk')return '<span style="font-size:10px;font-weight:800;background:#A32D2D;color:#fff;padding:2px 6px;border-radius:4px">⚠️ HIGH RISK</span>';
  if(r==='watch')return '<span style="font-size:10px;font-weight:800;background:var(--amber);color:#fff;padding:2px 6px;border-radius:4px">👁 Watch</span>';
  return '';
}
function getCountyForBid(bid){
  const c=getClientById(bid.client_id);
  const addr=(bid.addr||c?.addr||'').toUpperCase();
  const stateM=addr.match(/\b(AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/);
  const stateCode=stateM?stateM[1]:(S.state||'KS');
  let county=null;
  for(const city of Object.keys(KS_CITY_COUNTY)){if(addr.includes(city)){county=KS_CITY_COUNTY[city];break;}}
  if(!county)county='your county';
  return{stateCode,county};
}
function getCountyFilingInfo(stateCode){return STATE_FILING_INFO[stateCode]||STATE_FILING_INFO.default;}
function _lienMapsUrl(county,stateCode){
  const info=STATE_FILING_INFO[stateCode]||STATE_FILING_INFO.default;
  const q=(county&&county!=='your county')?county+' '+info.office:info.office+' '+stateCode;
  return 'https://maps.apple.com/?q='+encodeURIComponent(q);
}
function getLienRulesForBid(bid){const{stateCode}=getCountyForBid(bid);return LIEN_RULES[stateCode]||LIEN_RULES.default;}
function getLienTimeline(bid){
  const rules=getLienRulesForBid(bid);
  const daysUnpaid=bid.completion_date?daysSince(bid.completion_date):0;
  const daysUntilDeadline=rules.filing_deadline_days-daysUnpaid;
  const daysUntilNotice=rules.notice_days-daysUnpaid;
  return{rules,daysUnpaid,daysUntilDeadline,daysUntilNotice};
}
function getAutoCollStage(daysUnpaid,existingStage,lienRules){
  const rules=lienRules||LIEN_RULES.default;
  const deadline=rules.filing_deadline_days;
  const rank={none:0,reminder:1,second:2,intent:3,lien_ready:4,lien_filed:5,resolved:6};
  let auto='none';
  const d2=Math.round(deadline*0.25),d3=Math.round(deadline*0.40),d4=Math.round(deadline*0.60),d5=Math.round(deadline*0.85);
  if(daysUnpaid>=d5)auto='lien_ready';
  else if(daysUnpaid>=d4)auto='intent';
  else if(daysUnpaid>=d3)auto='second';
  else if(daysUnpaid>=d2)auto='reminder';
  const cur=existingStage||'none';
  return(rank[auto]||0)>(rank[cur]||0)?auto:cur;
}
function showFileLienDirect(bidId){
  const bid=bids.find(b=>b.id===bidId);if(!bid)return;
  const c=getClientById(bid.client_id);if(!c)return;
  const bal=getBidBalance(bid);
  const{rules,daysUnpaid,daysUntilDeadline}=getLienTimeline(bid);
  const addr=bid.addr||c.addr||'';
  const{stateCode,county}=getCountyForBid(bid);
  const filingInfo=getCountyFilingInfo(stateCode);
  const mapsUrl=_lienMapsUrl(county,stateCode);
  const warningHtml=daysUntilDeadline<=0?'<div style="background:#3D0000;color:#FFB3B3;border-radius:var(--r);padding:10px 12px;margin-bottom:14px;font-size:12px">⚠️ Lien window may be expired — consult an attorney before filing.</div>':daysUntilDeadline<=30?'<div style="background:var(--amber-lt);color:#856404;border-radius:var(--r);padding:10px 12px;margin-bottom:14px;font-size:12px">⏰ '+daysUntilDeadline+' days left to file — act now.</div>':'';
  const notesHtml=filingInfo.notes.map(n=>'<div style="display:flex;gap:6px;margin-bottom:4px"><span style="color:var(--blue);flex-shrink:0">→</span><span>'+escHtml(n)+'</span></div>').join('');
  const ov=document.createElement('div');ov.className='zmodal-overlay';
  const box=document.createElement('div');box.className='zmodal';
  box.style.maxHeight='90vh';box.style.overflowY='auto';
  box.innerHTML=
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">'+
      '<div style="font-size:16px;font-weight:800">⚖️ File Mechanic\'s Lien</div>'+
      '<button onclick="this.closest(\'.zmodal-overlay\').remove()" style="border:none;background:none;font-size:22px;cursor:pointer;color:var(--text3)">✕</button>'+
    '</div>'+warningHtml+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">'+
      '<div style="background:var(--bg2);border-radius:var(--r);padding:10px;text-align:center"><div style="font-size:18px;font-weight:800;color:#A32D2D">'+fmt(bal)+'</div><div style="font-size:10px;color:var(--text3);margin-top:2px">Amount claimed</div></div>'+
      '<div style="background:var(--bg2);border-radius:var(--r);padding:10px;text-align:center"><div style="font-size:18px;font-weight:800">'+daysUnpaid+'d</div><div style="font-size:10px;color:var(--text3);margin-top:2px">Days unpaid</div></div>'+
    '</div>'+
    '<div style="font-size:12px;color:var(--text2);margin-bottom:4px"><strong>Client:</strong> '+escHtml(c.name)+'</div>'+
    '<div style="font-size:12px;color:var(--text2);margin-bottom:4px"><strong>Property:</strong> '+escHtml(addr||'—')+'</div>'+
    '<div style="font-size:12px;color:var(--text2);margin-bottom:14px"><strong>Completion:</strong> '+escHtml(bid.completion_date||'—')+'</div>'+
    '<div style="background:var(--blue-lt);border-radius:var(--r);padding:12px 14px;margin-bottom:14px">'+
      '<div style="font-size:12px;font-weight:800;color:var(--blue);margin-bottom:6px">📍 Filing Instructions — '+escHtml(stateCode)+'</div>'+
      '<div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:2px">'+escHtml(filingInfo.office)+'</div>'+
      '<div style="font-size:10px;color:var(--text3);margin-bottom:8px">'+escHtml(filingInfo.cite)+'</div>'+
      '<a href="'+mapsUrl+'" target="_blank" style="display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--blue);font-weight:600;text-decoration:none;margin-bottom:10px">📍 Find '+escHtml(filingInfo.office)+' in Maps →</a>'+
      '<div style="font-size:11px;color:var(--text2);line-height:1.7">'+notesHtml+'</div>'+
    '</div>'+
    '<div style="font-size:11px;color:var(--text3);margin-bottom:14px">Deadlines shown are for general guidance. Verify requirements with your county recorder before filing.</div>'+
    '<div style="display:flex;gap:8px">'+
      '<button onclick="this.closest(\'.zmodal-overlay\').remove()" style="flex:1;padding:13px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);font-size:14px;font-weight:600;cursor:pointer;font-family:inherit">Cancel</button>'+
      '<button onclick="_confirmFileLien('+bidId+',\''+escHtml(county)+'\');this.closest(\'.zmodal-overlay\').remove()" style="flex:2;padding:13px;border-radius:var(--r);border:none;background:#3D0000;color:#FFB3B3;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">Generate & Print Lien →</button>'+
    '</div>';
  ov.appendChild(box);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
}
function _confirmFileLien(bidId,detectedCounty){
  const bid=bids.find(b=>b.id===bidId);if(!bid)return;
  const{stateCode,county:autoCounty}=getCountyForBid(bid);
  const resolvedState=stateCode||S.state||'KS';
  const fallbackCounty=resolvedState==='KS'?'Sedgwick County':'your county';
  const usedCounty=(detectedCounty||autoCounty||fallbackCounty)+', '+resolvedState;
  let lien=liens.find(l=>l.bid_id===bidId);
  if(!lien){
    const c=getClientById(bid.client_id);
    lien={id:Date.now(),bid_id:bidId,client_id:bid.client_id,client_name:bid.client_name||c?.name||'',amount:getBidBalance(bid),date:todayKey(),status:'filed',county:usedCounty,notes:''};
    liens.push(lien);
  }else{lien.status='filed';lien.date=todayKey();if(!lien.county)lien.county=usedCounty;}
  setBidCollStage(bid,'lien_filed','Lien filed via direct action');
  setClientRisk(bid.client_id,'high_risk');
  saveAll();renderDashActiveLiens();
  try{renderMoneyPage();}catch(e){}try{renderDash();}catch(e){}
  setTimeout(()=>printKansasLien(bidId),200);
}
function renderDashActiveLiens(){
  const card=document.getElementById('dash-liens-card');
  const list=document.getElementById('dash-liens-list');
  const count=document.getElementById('dash-liens-count');
  if(!card||!list)return;
  const active=liens.filter(l=>l.status==='filed'||l.status==='attorney'||l.status==='intent');
  card.style.display=active.length?'':'none';
  if(!active.length)return;
  if(count)count.textContent='('+active.length+')';
  list.innerHTML=active.map(l=>{
    const bid=bids.find(b=>b.id===l.bid_id);
    const days=l.date?daysSince(l.date):0;
    const daysLeft=365-days;
    const expiring=daysLeft<60;
    return '<div style="padding:10px 0;border-bottom:1px solid var(--border)">'+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start">'+
        '<div><div style="font-size:13px;font-weight:700">'+escHtml(l.client_name)+'</div>'+
        '<div style="font-size:11px;color:var(--text3)">'+fmt(l.amount)+' claimed · filed '+escHtml(l.date||'')+(l.county?' · '+escHtml(l.county):'')+'</div>'+
        (expiring?'<div style="font-size:10px;font-weight:800;color:#A32D2D;margin-top:2px">⚠️ Expires in ~'+daysLeft+' days</div>':'<div style="font-size:11px;color:var(--text3)">~'+daysLeft+' days remaining</div>')+'</div>'+
        (bid?'<button class="btn btn-sm" onclick="openClientDetail('+bid.client_id+')" style="font-size:10px">View</button>':'')+
      '</div></div>';
  }).join('');
}
