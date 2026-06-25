// ── SW Color Browser ─────────────────────────────────────────
let _swColors=null,_swFinish='',_swCurrentFamily=null;
let _paintExpectedCost=null;
let _estMetsHtml='';

function _setBvalidDays(days){
  [7,14,30,60].forEach(d=>{
    const btn=document.getElementById('bvalid-'+d);
    if(!btn)return;
    const on=d===days;
    btn.style.borderColor=on?'var(--blue)':'';
    btn.style.background=on?'var(--blue-lt)':'';
    btn.style.color=on?'var(--blue-dk)':'';
  });
  const sel=document.getElementById('e-bvalid');
  if(sel){const opt=[...sel.options].find(o=>o.text===days+' days');if(opt)sel.value=opt.value;}
  saveEstFullDraft();
}

function _swHslFamily(hex){
  if(!hex||hex.length<7)return'gray';
  const r=parseInt(hex.slice(1,3),16)/255,g=parseInt(hex.slice(3,5),16)/255,b=parseInt(hex.slice(5,7),16)/255;
  const lin=v=>v>0.04045?Math.pow((v+0.055)/1.055,2.4):v/12.92;
  const R=lin(r),G=lin(g),B=lin(b);
  const X=0.4124*R+0.3576*G+0.1805*B,Y=0.2126*R+0.7152*G+0.0722*B,Z=0.0193*R+0.1192*G+0.9505*B;
  const f=t=>t>0.008856?Math.cbrt(t):7.787*t+16/116;
  const fx=f(X/0.95047),fy=f(Y),fz=f(Z/1.08883);
  const L=116*fy-16,a=500*(fx-fy),bb=200*(fy-fz);
  const C=Math.sqrt(a*a+bb*bb),H=(Math.atan2(bb,a)*180/Math.PI+360)%360;
  // Neutrals first
  if(L<8)return'black';
  if(C<6)return L>85?'white':L>20?'gray':'black';
  if(L>90&&C<20)return'white';
  // Hue boundaries from Munsell renotation data mapped to CIELAB hue angle:
  // R/YR≈40  YR/Y≈70  Y/GY≈105  GY+G/BG≈170  BG/B≈215  B/PB≈255  PB/P≈290  P/RP≈325  RP/R≈345
  if(H<40||H>=345)return(L>55||C<35)?'pink':'red';   // Munsell R
  if(H>=325)return(L>50||C<28)?'pink':'purple';        // Munsell P (325–344)
  if(H<70){                                             // Munsell YR → orange/brown
    if(L<42)return'brown';
    if(C<15)return L>55?'beige':'gray';
    return C>22?'orange':'beige';
  }
  if(H<105){                                            // Munsell Y → yellow/beige
    if(L<42)return'brown';
    if(C<15)return L>55?'beige':'gray';
    return'yellow';
  }
  if(H<170)return'green';                              // Munsell GY + G
  if(H<215)return'teal';                               // Munsell BG
  if(H<290)return'blue';                               // Munsell B + PB
  return(L>50||C<28)?'pink':'purple';                  // Munsell P (290–324)
}

async function swLoadColors(){
  if(_swColors)return _swColors;
  const STAIN_COLORS=[
    {sw:'SW 3502',name:'Natural',        hex:'#C8A870',family:'stain'},
    {sw:'SW 3503',name:'Honey',          hex:'#C08840',family:'stain'},
    {sw:'SW 3504',name:'Golden Oak',     hex:'#A06828',family:'stain'},
    {sw:'SW 3505',name:'Cedar',          hex:'#9B4E24',family:'stain'},
    {sw:'SW 3506',name:'Redwood',        hex:'#8B3520',family:'stain'},
    {sw:'SW 3511',name:'Early American', hex:'#7D4A28',family:'stain'},
    {sw:'SW 3512',name:'Jacobean',       hex:'#4A2E18',family:'stain'},
    {sw:'SW 3513',name:'Special Walnut', hex:'#5E3820',family:'stain'},
    {sw:'SW 3514',name:'Classic Black',  hex:'#1E1410',family:'stain'},
    {sw:'SW 3516',name:'Rustic Red',     hex:'#8B3A28',family:'stain'},
    {sw:'SW 3517',name:'Province Gray',  hex:'#7A7870',family:'stain'},
    {sw:'SW 3518',name:'Bark Brown',     hex:'#5C3A1E',family:'stain'},
    {sw:'SW 3520',name:'Mission Brown',  hex:'#4A2C18',family:'stain'},
    {sw:'SW 3522',name:'Chestnut Brown', hex:'#7A3C22',family:'stain'},
    {sw:'SW 3530',name:'Driftwood',      hex:'#9C8C7A',family:'stain'},
    {sw:'SW 3531',name:'Slate Gray',     hex:'#7A7A78',family:'stain'},
    {sw:'SW 3532',name:'Gray Wash',      hex:'#B0ACAA',family:'stain'},
    {sw:'SW 3534',name:'Charcoal Gray',  hex:'#4A4A48',family:'stain'},
    {sw:'SW 3540',name:'Dark Walnut',    hex:'#4A2912',family:'stain'},
    {sw:'SW 3541',name:'Espresso',       hex:'#2E1A0E',family:'stain'},
  ];
  try{
    const r=await fetch('sw-colors.json?v=6');
    const loaded=await r.json();
    // Merge stain colors in (they're not in the SW catalog file)
    const _merged=[...loaded,...STAIN_COLORS.filter(s=>!loaded.find(c=>c.sw===s.sw))];
    _swColors=_merged.map(c=>c.family?c:{...c,family:_swHslFamily(c.hex)});
  }
  catch(e){_swColors=[
    {sw:'SW 7008',name:'Alabaster',hex:'#EDE9DD',family:'white'},
    {sw:'SW 7015',name:'Repose Gray',hex:'#CCC9C0',family:'gray'},
    {sw:'SW 7029',name:'Agreeable Gray',hex:'#C9C3BA',family:'beige'},
    {sw:'SW 7036',name:'Accessible Beige',hex:'#D1C7B8',family:'beige'},
    {sw:'SW 7005',name:'Pure White',hex:'#F3F0E7',family:'white'},
    {sw:'SW 7069',name:'Iron Ore',hex:'#3B3D3E',family:'black'},
    {sw:'SW 6244',name:'Naval',hex:'#273C53',family:'blue'},
    {sw:'SW 7643',name:'Peppercorn',hex:'#595650',family:'gray'},
    ...STAIN_COLORS,
  ];}
  return _swColors;
}
async function swInitFamilyGrid(){
  await swLoadColors();
  const grid=document.getElementById('sw-family-grid');if(!grid)return;
  const famHtml=SW_FAMILIES.map(f=>{
    const count=(_swColors||[]).filter(c=>c.family===f.id).length;
    return '<div onclick="swShowFamily(\''+f.id+'\',\''+f.label+'\')" style="cursor:pointer;border-radius:var(--r);overflow:hidden;border:1px solid var(--border2)">'+
      '<div style="height:34px;background:'+f.bg+'"></div>'+
      '<div style="padding:3px 2px;background:var(--bg);text-align:center">'+
        '<div style="font-size:10px;font-weight:700;color:var(--text)">'+f.label+'</div>'+
        '<div style="font-size:9px;color:var(--text3)">'+count+'</div>'+
      '</div></div>';
  }).join('');
  const recent=S.recentSwColors||[];
  let recentHtml='';
  if(recent.length){
    recentHtml='<div style="grid-column:1/-1;padding-bottom:8px;margin-bottom:4px;border-bottom:1px solid var(--border)">'+
      '<div style="font-size:9px;font-weight:800;text-transform:uppercase;color:var(--text3);letter-spacing:.06em;margin-bottom:5px">Recently used</div>'+
      '<div style="display:flex;gap:5px;flex-wrap:wrap" id="sw-recent-chips"></div></div>';
  }
  grid.innerHTML=recentHtml+famHtml;
  const chipsEl=document.getElementById('sw-recent-chips');
  if(chipsEl){
    recent.forEach(c=>{
      const chip=document.createElement('button');
      chip.type='button';
      chip.style.cssText='display:flex;align-items:center;gap:5px;padding:5px 10px 5px 5px;border-radius:20px;border:1.5px solid var(--border2);background:var(--bg);cursor:pointer;font-family:inherit';
      chip.innerHTML='<div style="width:18px;height:18px;border-radius:50%;background:'+c.hex+';border:1px solid rgba(0,0,0,.1);flex-shrink:0"></div>'+
        '<span style="font-size:11px;font-weight:700;color:var(--text);white-space:nowrap">'+c.name+'</span>';
      chip.onclick=()=>swSelectColor(c.sw,c.name,c.hex);
      chipsEl.appendChild(chip);
    });
  }
}
async function swShowFamily(familyId,familyLabel){
  const colors=await swLoadColors();
  // Sort light to dark within family
  function _lum(hex){const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);return(0.299*r+0.587*g+0.114*b)/255;}
  const matches=colors.filter(c=>c.family===familyId).sort((a,b)=>_lum(b.hex)-_lum(a.hex));
  _swCurrentFamily=familyId;
  document.getElementById('sw-state-family').style.display='none';
  document.getElementById('sw-state-swatches').style.display='';
  document.getElementById('sw-family-label').textContent=familyLabel;
  document.getElementById('sw-family-count').textContent='('+matches.length+' colors)';
  const grid=document.getElementById('sw-swatch-grid');if(!grid)return;
  grid.innerHTML='';
  matches.forEach(c=>{
    const tile=document.createElement('div');
    tile.title=c.name+'\n'+c.sw;
    const _lum2=(0.299*parseInt(c.hex.slice(1,3),16)+0.587*parseInt(c.hex.slice(3,5),16)+0.114*parseInt(c.hex.slice(5,7),16))/255;
    const _tc2=_lum2>0.55?'rgba(0,0,0,0.75)':'rgba(255,255,255,0.9)';
    tile.style.cssText='width:100%;padding-bottom:100%;position:relative;border-radius:6px;background:'+c.hex+';cursor:pointer;border:2px solid transparent;box-sizing:border-box;overflow:hidden';
    tile.innerHTML='<div style="position:absolute;inset:0;border-radius:4px;transition:background .15s"></div>'+
      '<div style="position:absolute;bottom:0;left:0;right:0;padding:2px 2px 3px;background:rgba(0,0,0,0.4);line-height:1.2">'+
        '<div style="font-size:6.5px;font-weight:700;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;letter-spacing:-.1px">'+c.name+'</div>'+
        '<div style="font-size:6px;color:rgba(255,255,255,.75);white-space:nowrap">'+c.sw+'</div>'+
      '</div>';
    tile.onmouseover=()=>tile.style.borderColor='rgba(255,255,255,.9)';
    tile.onmouseout=()=>tile.style.borderColor='transparent';
    tile.onclick=()=>swOpenFullscreenColor(c.hex,c.name,c.sw);
    grid.appendChild(tile);
  });
}
function swBackToFamilies(){
  document.getElementById('sw-state-swatches').style.display='none';
  document.getElementById('sw-state-family').style.display='';
}
async function swSearch(val,target){
  const dd=document.getElementById('sw-dropdown');if(!dd)return;
  const q=(val||'').trim().toLowerCase();
  if(!q||q.length<2){dd.style.display='none';return;}
  const colors=await swLoadColors();

  // Simple aliases so Zach can type naturally
  const ALIASES={
    'grey':'gray','off white':'white','off-white':'white','cream':'white',
    'tan':'beige','taupe':'beige','nude':'beige','greige':'beige',
    'navy':'blue','sky':'blue','aqua':'teal','turquoise':'teal',
    'sage':'green','olive':'green','mint':'green',
    'maroon':'red','burgundy':'red','wine':'red','coral':'pink','salmon':'pink',
    'charcoal':'gray','dark gray':'gray','dark grey':'gray',
    'light gray':'gray','light grey':'gray',
  };
  const searchQ=ALIASES[q]||q;
  const swNum=q.replace(/sw\s*/i,'').trim();

  // Score: name match > SW number match > family tag match
  const scored=[];
  for(const c of colors){
    const n=c.name.toLowerCase();
    let score=0;
    if(n===searchQ)score=100;
    else if(n.startsWith(searchQ+' ')||n.startsWith(searchQ+'-'))score=85;
    else if(n.includes(searchQ))score=70;
    else if(c.sw.replace('SW ','')===swNum)score=95;
    else if(c.sw.toLowerCase().includes(swNum)&&swNum.length>=3)score=80;
    else if(c.family===searchQ)score=50;
    if(score>0)scored.push({...c,score});
  }
  scored.sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name));
  const matches=scored.slice(0,28);

  if(!matches.length){
    dd.innerHTML='<div style="padding:12px;font-size:12px;color:var(--text3)">No colors found for "'+q+'"</div>';
    dd.style.display='block';return;
  }
  dd.innerHTML='';
  matches.forEach(c=>{
    const row=document.createElement('div');
    row.style.cssText='display:flex;align-items:center;gap:10px;padding:10px 12px;cursor:pointer;border-bottom:1px solid var(--border)';
    row.onmouseover=()=>row.style.background='var(--bg2)';
    row.onmouseout=()=>row.style.background='';
    const swatch=document.createElement('div');
    swatch.style.cssText='width:44px;height:44px;border-radius:8px;background:'+c.hex+';flex-shrink:0;border:1px solid rgba(0,0,0,.1);cursor:zoom-in';
    swatch.title='Tap to preview full screen';
    swatch.onclick=(e)=>{e.stopPropagation();swOpenFullscreenColor(c.hex,c.name,c.sw);};
    const info=document.createElement('div');
    info.style.cssText='flex:1;min-width:0';
    info.innerHTML='<div style="font-size:13px;font-weight:700;color:var(--text)">'+c.name+'</div><div style="font-size:11px;color:var(--text3)">'+c.sw+'</div>';
    row.appendChild(swatch);row.appendChild(info);
    row.onclick=()=>swSelectColor(c.sw,c.name,c.hex);
    dd.appendChild(row);
  });
  dd.style.display='block';
}
function swHideDropdown(){const d=document.getElementById('sw-dropdown');if(d)d.style.display='none';}
function swSelectColor(sw,name,hex){
  const inp=document.getElementById('surf-color-b')||document.getElementById('surf-color');
  const prev=document.getElementById('sw-color-preview');
  const hexH=document.getElementById('sw-selected-hex');
  const pill=document.getElementById('sw-selected-pill');
  const lbl=document.getElementById('sw-selected-label');
  const dd=document.getElementById('sw-dropdown');
  const si=document.getElementById('sw-search-input');
  const cleanName=(name||'').replace(/ \(SW.*\)/,'').trim();
  if(inp)inp.value=cleanName+' ('+sw+')';
  if(prev){prev.style.background=hex;prev.style.border='2px solid var(--green)';}
  if(hexH)hexH.value=hex;
  if(pill)pill.style.display='flex';
  if(lbl)lbl.textContent=cleanName+' ('+sw+')';
  if(dd)dd.style.display='none';
  if(si)si.value='';
  // Return to family view
  const ss=document.getElementById('sw-state-swatches');if(ss)ss.style.display='none';
  const sf=document.getElementById('sw-state-family');if(sf)sf.style.display='';
  surfColor=cleanName+' ('+sw+')';
  if(sw&&hex){
    if(!S.recentSwColors)S.recentSwColors=[];
    S.recentSwColors=[{sw,name:cleanName,hex},...S.recentSwColors.filter(c=>c.sw!==sw)].slice(0,4);
    saveAll();
  }
}
function _swResetColorUI(){
  const inp=document.getElementById('surf-color-b');if(inp)inp.value='';
  const prev=document.getElementById('sw-color-preview');if(prev){prev.style.background='#eee';prev.style.border='1px solid var(--border2)';}
  const hexH=document.getElementById('sw-selected-hex');if(hexH)hexH.value='';
  const pill=document.getElementById('sw-selected-pill');if(pill)pill.style.display='none';
  const finH=document.getElementById('sw-selected-finish');if(finH)finH.value='';
  const si=document.getElementById('sw-search-input');if(si)si.value='';
  _swFinish='';
  document.querySelectorAll('#surf-step-b .sw-finish-btn').forEach(b=>{
    b.style.border='1px solid var(--border2)';b.style.background='var(--bg)';b.style.color='var(--text)';b.style.fontWeight='600';
  });
  const dd=document.getElementById('sw-dropdown');if(dd)dd.style.display='none';
  const ss=document.getElementById('sw-state-swatches');if(ss)ss.style.display='none';
  const sf=document.getElementById('sw-state-family');if(sf)sf.style.display='';
  surfColor='';
}
function swClearColor(){
  _swResetColorUI();
  swInitFamilyGrid();
}
function showFinishTip(label,e){
  document.querySelectorAll('.finish-tip-popup').forEach(el=>el.remove());
  const tip=document.createElement('div');
  tip.className='finish-tip-popup';
  tip.style.cssText='position:fixed;z-index:9999;background:#222;color:#fff;font-size:12px;padding:8px 11px;border-radius:8px;max-width:220px;line-height:1.5;pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,.3)';
  tip.textContent=_FINISH_TIPS[label]||'';
  document.body.appendChild(tip);
  const r=e.target.getBoundingClientRect();
  tip.style.left=Math.min(r.left,window.innerWidth-230)+'px';
  tip.style.top=(r.top-tip.offsetHeight-8)+'px';
  setTimeout(()=>tip.remove(),2800);
}
function swSelectFinish(btn){
  document.querySelectorAll('#surf-step-b .sw-finish-btn').forEach(b=>{
    b.style.border='1px solid var(--border2)';b.style.background='var(--bg)';b.style.color='var(--text)';b.style.fontWeight='600';
  });
  btn.style.border='2px solid var(--blue)';btn.style.background='var(--blue-lt)';btn.style.color='var(--blue-dk)';btn.style.fontWeight='700';
  _swFinish=btn.dataset.finish;
  const h=document.getElementById('sw-selected-finish');if(h)h.value=_swFinish;
}
function swOpenFullscreen(){
  const hex=document.getElementById('sw-selected-hex')?.value;
  const name=document.getElementById('surf-color-b')?.value||'';
  if(!hex)return;
  swOpenFullscreenColor(hex,name,'');
}
function swOpenFullscreenColor(hex,name,sw){
  const existing=document.getElementById('sw-fullscreen-ov');if(existing)existing.remove();
  const ov=document.createElement('div');
  ov.id='sw-fullscreen-ov';
  ov.style.cssText='position:fixed;inset:0;z-index:9999;background:'+hex+';display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer';
  const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b2=parseInt(hex.slice(5,7),16);
  const lum=(0.299*r+0.587*g+0.114*b2)/255;
  const tc=lum>0.55?'rgba(0,0,0,0.75)':'rgba(255,255,255,0.9)';
  const bc=lum>0.55?'rgba(0,0,0,0.15)':'rgba(255,255,255,0.25)';
  ov.innerHTML=
    '<div style="text-align:center;padding:32px;pointer-events:none">'+
      '<div style="font-size:28px;font-weight:800;color:'+tc+';letter-spacing:-.3px;margin-bottom:6px">'+name.replace(/ \(SW.*\)/,'')+'</div>'+
      (sw?'<div style="font-size:18px;color:'+tc+';margin-bottom:4px;font-weight:600">'+sw+'</div>':'')+
      '<div style="font-size:13px;color:'+tc+';font-family:monospace;opacity:.8;margin-bottom:8px">'+hex.toUpperCase()+'</div>'+
      '<div style="font-size:12px;color:'+tc+';opacity:.6">Tap anywhere to close</div>'+
    '</div>'+
    '<button id="sw-use-btn" style="position:fixed;bottom:48px;left:50%;transform:translateX(-50%);padding:16px 40px;border-radius:32px;border:2px solid '+bc+';background:'+bc+';color:'+tc+';font-size:16px;font-weight:800;cursor:pointer;font-family:inherit;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);white-space:nowrap">✓ Use this color</button>';
  ov.onclick=(e)=>{if(e.target===ov||e.target.closest('div[style*="pointer-events:none"]'))ov.remove();};
  document.getElementById('sw-use-btn')&&document.getElementById('sw-use-btn').addEventListener('click',(e)=>{e.stopPropagation();swSelectColor(sw,name.replace(/ \(SW.*\)/,'').trim(),hex);ov.remove();});
  document.body.appendChild(ov);
  // Wire use button after append
  const useBtn=ov.querySelector('#sw-use-btn');
  if(useBtn)useBtn.onclick=(e)=>{e.stopPropagation();swSelectColor(sw,name.replace(/ \(SW.*\)/,'').trim(),hex);ov.remove();};
}
// ══ SW Product Lines ══════════════════════════════════════
let _swProduct=null;
let _swLastProductByCategory={}; // remembers last picked product per category within a room


function swRenderProductGrid(surfType){
  const grid=document.getElementById('sw-product-grid');if(!grid)return;
  const category=SURF_PRODUCT_TYPE[surfType]||'interior';

  // Ceiling: show ceiling-specific products first, then interior as alternatives
  let products=SW_PRODUCTS[category]||SW_PRODUCTS.interior;
  let altProducts=null;
  if(category==='ceiling'){
    altProducts=SW_PRODUCTS.interior;
  }

  const SURF_NICE={walls:'Walls',ceiling:'Ceiling',trim:'Trim',doors:'Doors',
    windows:'Windows',cabinets:'Cabinets',ext_walls:'Siding',ext_trim:'Ext Trim',deck:'Deck'};
  const hdr=document.getElementById('sw-product-grid-hdr');
  if(hdr)hdr.textContent='Choose product for: '+(SURF_NICE[surfType]||surfType);

  const prevProductId=_swLastProductByCategory[category]||S.swLastProducts?.[category]||null;
  // If no previous pick, use the property tier recommendation as the default
  const tierProductId=!prevProductId&&estPropertyTier&&estPropertyTier.products
    ?(estPropertyTier.products[category]||estPropertyTier.products.interior)
    :null;

  const makeBtn=(p,isSuggested,isTierRec)=>{
    const btn=document.createElement('button');
    btn.type='button';
    btn.dataset.id=p.id;
    const isHighlit=isSuggested||isTierRec;
    btn.style.cssText='padding:8px 12px;border-radius:var(--r);border:'+(isHighlit?'2px solid var(--blue)':'1px solid var(--border2)')+';background:'+(isHighlit?'var(--blue-lt)':'var(--bg)')+';cursor:pointer;font-family:inherit;text-align:left;transition:border .1s;position:relative;width:100%;box-sizing:border-box';
    const badge=isTierRec?'<span style="font-size:9px;font-weight:800;text-transform:uppercase;color:var(--blue);background:var(--bg);border:1px solid var(--blue);border-radius:8px;padding:1px 5px;margin-left:5px">Recommended</span>':'';
    const usedLast=isSuggested&&!isTierRec?'<span style="font-size:10px;color:var(--blue);margin-left:5px">used last</span>':'';
    btn.innerHTML='<div style="display:flex;align-items:center;gap:6px;padding-right:22px">'+
      '<span style="font-size:12px;font-weight:700;color:var(--text)">'+p.name+'</span>'+
      '<span style="font-size:11px;color:var(--text3)">'+p.price+'</span>'+
      badge+usedLast+
      '</div>'+
      '<div style="font-size:10px;color:var(--text3);line-height:1.3;margin-top:2px">'+p.sub+'</div>'+
      (SW_PRODUCT_INFO[p.id]?'<span onclick="event.stopPropagation();swShowProductInfo(\''+p.id+'\')" style="position:absolute;top:50%;right:10px;transform:translateY(-50%);font-size:15px;color:var(--text3);cursor:pointer;line-height:1" title="Learn more">ⓘ</span>':'');
    btn.onclick=()=>swSelectProduct(p,btn);
    return btn;
  };

  grid.innerHTML='';

  // Primary products for this surface
  products.forEach(p=>grid.appendChild(makeBtn(p,prevProductId===p.id,!prevProductId&&p.id===tierProductId)));

  // Auto-select the previously used product for this category, or the tier recommendation
  const _autoId=prevProductId||tierProductId;
  if(_autoId){
    const allProds=[...products,...(altProducts||[])];
    const autoP=allProds.find(p=>p.id===_autoId);
    if(autoP){
      setTimeout(()=>{
        const autoBtn=grid.querySelector('[data-id="'+_autoId+'"]');
        if(autoBtn)swSelectProduct(autoP,autoBtn);
      },0);
    }
  }

  // For ceiling: add divider then all interior wall products as alternatives
  if(altProducts){
    const divider=document.createElement('div');
    divider.style.cssText='grid-column:1/-1;padding:6px 0 2px;font-size:10px;font-weight:800;text-transform:uppercase;color:var(--text3);border-top:1px solid var(--border);margin-top:4px';
    divider.textContent='Colored ceiling? Use a wall paint in flat sheen:';
    grid.appendChild(divider);
    altProducts.forEach(p=>grid.appendChild(makeBtn(p,prevProductId===p.id,!prevProductId&&p.id===tierProductId)));
  }
}

function swShowProductInfo(id){
  const info=SW_PRODUCT_INFO[id];if(!info)return;
  // Enrich with contractor price + coverage from product catalog
  const _pd0=Object.values(SW_PRODUCTS).flat().find(p=>p.id===id);
  const _pd=_pd0?swEffectivePrice(_pd0):null;
  if(_pd){info.contractorPrice=_pd.contractor;info.retailPrice=_pd.retail;info.coverage=_pd.cov;info.hasPrice=true;info.updated=S.swPricesUpdated||'Apr 2025';}
  const ov=document.createElement('div');
  ov.style.cssText='position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:20px';
  const sheet=document.createElement('div');
  sheet.style.cssText='background:var(--bg);border-radius:var(--rl);padding:22px 20px 28px;width:100%;max-width:560px;max-height:88vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,.3)';
  const row=(icon,label,text)=>'<div style="background:var(--bg2);border-radius:var(--r);padding:10px 12px;margin-bottom:8px">'+
    '<div style="font-size:10px;font-weight:800;text-transform:uppercase;color:var(--text3);margin-bottom:3px">'+icon+' '+label+'</div>'+
    '<div style="font-size:12px;color:var(--text);line-height:1.6">'+text+'</div></div>';
  sheet.innerHTML=
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">'+
      '<div style="font-size:16px;font-weight:800;color:var(--text)">'+info.name+'</div>'+
      '<button type="button" onclick="this.closest(\'[style*=fixed]\').remove()" style="background:none;border:none;cursor:pointer;font-size:22px;color:var(--text3);padding:4px">✕</button>'+
    '</div>'+
    row('🎯','When to use',info.when)+
    row('✅','What it\'s good at',info.good)+
    row('🚫','Not ideal for',info.notFor)+
    row('🏠','Best jobs',info.jobs)+
    (info.hasPrice?'<div style="background:var(--green-lt);border-radius:var(--r);padding:10px 12px;margin-bottom:8px">'+
      '<div style="font-size:10px;font-weight:800;text-transform:uppercase;color:var(--text3);margin-bottom:3px">💰 Pricing</div>'+
      '<div style="font-size:12px;color:var(--text);line-height:1.6">~$'+info.retailPrice+'/gal retail · ~$'+info.contractorPrice+'/gal contractor<br>Covers ~'+info.coverage+' sq ft/gal · <span style="color:var(--text3)">Prices updated '+info.updated+'</span></div>'+
    '</div>':'');
  ov.appendChild(sheet);
  ov.onclick=(e)=>{if(e.target===ov)ov.remove();};
  document.body.appendChild(ov);
}

function swSelectProduct(p,btn){
  const sf=(id,val)=>{const el=document.getElementById(id);if(el)el.value=val;};
  document.querySelectorAll('#sw-product-grid button').forEach(b=>{
    b.style.border='1px solid var(--border2)';b.style.background='var(--bg)';
  });
  btn.style.border='2px solid var(--blue)';btn.style.background='var(--blue-lt)';
  _swProduct=p;
  const h=document.getElementById('sw-selected-product');if(h)h.value=p.id;
  const lbl=document.getElementById('sw-product-selected');if(lbl)lbl.textContent=p.name;
  const _effP=swEffectivePrice(p);
  if(_effP.retail)sf('e-paint-rate',_effP.retail);
  // Remember this product for this category so next surface can suggest it
  const type=surfBQueue[surfBIdx];
  const cat=SURF_PRODUCT_TYPE[type]||'interior';
  _swLastProductByCategory[cat]=p.id;
  if(!S.swLastProducts)S.swLastProducts={};
  S.swLastProducts[cat]=p.id;saveAll();
}



let _rateRefreshInProgress=false;
async function autoRefreshRates(){
  if(!_supa||!_supaUser||_rateRefreshInProgress)return;
  const thisYear=new Date().getFullYear();
  // S.irsRateYear syncs to Supabase — once ANY device sets it for this year, all devices skip the fetch
  if(S.irsRateYear===thisYear&&S.irsRate)return;
  _rateRefreshInProgress=true;
  try{
    const{data:{session}}=await _supa.auth.getSession();
    if(!session)return;
    const resp=await fetch(SUPA_URL+'/functions/v1/get-rates',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token},
      body:JSON.stringify({})
    });
    if(!resp.ok)return;
    const d=await resp.json();
    // Sanity bounds — IRS rate must be realistic (never below 50¢ or above $1.00/mi)
    if(!d.irsRate||d.irsRate<0.50||d.irsRate>1.00)return;
    if(Math.abs(d.irsRate-(S.irsRate||0))>0.0005){
      showToast('IRS mileage rate updated to $'+(+d.irsRate).toFixed(3)+'/mi for '+d.year);
      const el=document.getElementById('set-irs');if(el)el.value=d.irsRate;
    }
    S.irsRate=d.irsRate;S.irsRateYear=thisYear;saveAll();
  }catch(e){}finally{_rateRefreshInProgress=false;}
}

let _bracketRefreshInProgress=false;
async function autoRefreshTaxBrackets(){
  if(!_supa||!_supaUser||_bracketRefreshInProgress)return;
  const thisYear=new Date().getFullYear();
  // S.bracketYear syncs to Supabase — once ANY device fetches for this year, all devices skip it
  if(S.bracketYear===thisYear)return;
  _bracketRefreshInProgress=true;
  try{
    const{data:{session}}=await _supa.auth.getSession();
    if(!session)return;
    const resp=await fetch(SUPA_URL+'/functions/v1/get-rates',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token},
      body:JSON.stringify({type:'taxBrackets'})
    });
    if(!resp.ok)return;
    const d=await resp.json();
    if(d.error)return;
    // Strict bounds — each threshold must be within ±15% of 2025 IRS baseline
    const base={fedSingle:15000,b10:11925,b12:48475,b22:103350,b24:197300,b32:250525,b35:626350};
    const fields=Object.keys(base);
    const valid=fields.every(k=>typeof d[k]==='number'&&d[k]>base[k]*0.85&&d[k]<base[k]*1.15);
    const inc=[d.b10,d.b12,d.b22,d.b24,d.b32,d.b35].every((v,i,a)=>i===0||v>a[i-1]);
    if(!valid||!inc)return;
    const changed=fields.some(k=>Math.abs(d[k]-(S[k]||base[k]))>50);
    if(changed){
      fields.forEach(k=>{if(d[k])S[k]=d[k];});
      if(d.fedMFJ&&d.fedMFJ>25000&&d.fedMFJ<40000)S.fedMFJ=d.fedMFJ;
      if(d.fedHOH&&d.fedHOH>18000&&d.fedHOH<30000)S.fedHOH=d.fedHOH;
      applySettings();saveAll();
      showToast('Federal tax brackets updated for '+(d.year||thisYear),'📊');
    }
    // Update KS rates if returned (loose bounds — KS rates vary more)
    if(typeof d.ksLow==='number'&&d.ksLow>0&&d.ksLow<15)S.ksLow=d.ksLow;
    if(typeof d.ksHigh==='number'&&d.ksHigh>0&&d.ksHigh<15)S.ksHigh=d.ksHigh;
    if(typeof d.ksTop==='number'&&d.ksTop>5000&&d.ksTop<100000)S.ksTop=d.ksTop;
    if(typeof d.ksStdS==='number'&&d.ksStdS>1000&&d.ksStdS<15000)S.ksStdS=d.ksStdS;
    if(typeof d.ksStdM==='number'&&d.ksStdM>1000&&d.ksStdM<20000)S.ksStdM=d.ksStdM;
    S.bracketYear=thisYear;saveAll();
    _refillSettingsFormUnlessEditing(); // refresh display spans — but never clobber in-progress edits
    if(S.state)fetchStateBrackets(S.state);
  }catch(e){}finally{_bracketRefreshInProgress=false;}
}

async function fetchStateBrackets(state){
  if(!_supa||!_supaUser||!state)return;
  const thisYear=new Date().getFullYear();
  if(S.stateRates?.[state]?.year===thisYear)return;
  try{
    const{data:{session}}=await _supa.auth.getSession();
    if(!session)return;
    const resp=await fetch(SUPA_URL+'/functions/v1/get-rates',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token},
      body:JSON.stringify({type:'stateBrackets',state})
    });
    if(!resp.ok)return;
    const d=await resp.json();
    if(d.error||d.state!==state)return;
    if(!S.stateRates)S.stateRates={};
    const prev=S.stateRates[state];
    const changed=!prev||JSON.stringify(prev.brackets)!==JSON.stringify(d.brackets)||prev.stdS!==d.stdS;
    d.year=thisYear;
    S.stateRates[state]=d;
    applySettings();saveAll();
    _refillSettingsFormUnlessEditing();
    if(changed)showToast((d.noTax?state+' has no income tax':state+' tax rates updated'),'📊');
  }catch(e){}
}

let _lienRefreshInProgress=false;
async function autoRefreshLienRules(){
  if(!_supa||!_supaUser||_lienRefreshInProgress)return;
  const KEY='zp3_lien_year';
  const thisYear=new Date().getFullYear();
  if(+localStorage.getItem(KEY)===thisYear)return;
  _lienRefreshInProgress=true;
  try{
    const{data:{session}}=await _supa.auth.getSession();
    if(!session)return;
    // Send current values so Claude can compare and return only changed states
    const current={};
    Object.keys(LIEN_RULES).forEach(k=>{if(k!=='default')current[k]=LIEN_RULES[k].filing_deadline_days;});
    const resp=await fetch(SUPA_URL+'/functions/v1/get-rates',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token},
      body:JSON.stringify({type:'lienRules',current})
    });
    if(!resp.ok)return;
    const d=await resp.json();
    if(d.error||!d.changes)return;
    const changes=d.changes;
    const changedStates=Object.keys(changes).filter(state=>{
      const v=changes[state];
      // Validate: must be a number between 30 and 400 days, and different from current
      return typeof v==='number'&&v>=30&&v<=400&&v!==LIEN_RULES[state]?.filing_deadline_days;
    });
    if(changedStates.length){
      changedStates.forEach(state=>{
        if(LIEN_RULES[state])LIEN_RULES[state].filing_deadline_days=changes[state];
      });
      showToast('Lien deadline change detected for '+changedStates.join(', ')+' — verify before next filing','⚖️');
    }
    localStorage.setItem(KEY,String(thisYear));
  }catch(e){}finally{_lienRefreshInProgress=false;}
}

async function swRefreshPrices(){
  const btn=document.getElementById('sw-price-refresh-btn');
  const status=document.getElementById('sw-price-refresh-status');
  if(btn){btn.disabled=true;btn.textContent='Researching current prices...';}
  if(status){status.style.display='block';status.textContent='Asking AI for current SW contractor prices...';}
  try{
    const{data:{session}}=await _supa.auth.getSession();
    if(!session)throw new Error('not signed in');
    const resp=await fetch(SUPA_URL+'/functions/v1/get-rates',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token},
      body:JSON.stringify({type:'sw'})
    });
    if(!resp.ok)throw new Error('HTTP '+resp.status);
    const prices=await resp.json();
    let updated=0;
    // Merge fetched prices into S.swPrices overrides ({contractor,retail} per id,
    // only values that differ from the hardcoded SW_PRODUCTS defaults) — the
    // same shape the Settings → Rates & pricing editor writes. All price math
    // reads through swEffectivePrice(), so these persist across reloads.
    const _ov={...(S.swPrices||{})};
    Object.values(SW_PRODUCTS).flat().forEach(p=>{
      const pd=prices[p.id];if(!pd)return;
      const c=pd.c!=null?pd.c:pd.contractor,r=pd.r!=null?pd.r:pd.retail;
      const entry={...(_ov[p.id]||{})};
      if(c!=null){if(c!==p.contractor)entry.contractor=c;else delete entry.contractor;}
      if(r!=null){if(r!==p.retail)entry.retail=r;else delete entry.retail;}
      if(Object.keys(entry).length)_ov[p.id]=entry;else delete _ov[p.id];
      updated++;
    });
    const now=new Date().toLocaleDateString('en-US',{month:'short',year:'numeric'});
    S.swPricesUpdated=now;S.swPrices=_ov;saveAll();
    if(typeof _renderSwPriceRows==='function')_renderSwPriceRows();
    const upd=document.getElementById('sw-price-updated');if(upd)upd.textContent='Last updated: '+now;
    if(status)status.textContent='Updated '+updated+' prices as of '+now;
  }catch(e){
    if(status)status.textContent='Could not refresh — using cached prices. Try again later.';
    console.warn('swRefreshPrices:',e);
  }
  if(btn){btn.disabled=false;btn.textContent='🔄 Refresh SW prices via AI';}
}

function swResetProduct(){
  _swProduct=null;
  const _pr=document.getElementById('e-paint-rate');if(_pr)_pr.value=83;
  const h=document.getElementById('sw-selected-product');if(h)h.value='';
  const lbl=document.getElementById('sw-product-selected');if(lbl)lbl.textContent='';
  document.querySelectorAll('#sw-product-grid button').forEach(b=>{
    b.style.border='1px solid var(--border2)';b.style.background='var(--bg)';
  });
}

function swGetProductName(){
  if(!_swProduct)return'';
  return _swProduct.name;
}
let surfType='walls', surfDoorOpt='trim', surfWinOpt='trim', surfCabOpt='uppers', surfCount=1; // compat
let surfWhatSelected=[]; // which surface types toggled on for current room
let surfBQueue=[];       // queue of surface types to measure in step B
let surfBIdx=0;          // current position in queue
let surfBMeasurements={}; // collected measurements keyed by type

function setSurfJobType(type){
  surfJobType=type;
  const isInt=type==='interior';
  const ib=document.getElementById('surf-type-int');
  const eb=document.getElementById('surf-type-ext');
  if(ib){ib.style.borderColor=isInt?'var(--blue)':'var(--border2)';ib.style.background=isInt?'var(--blue)':'var(--bg2)';ib.style.color=isInt?'#fff':'var(--text2)';}
  if(eb){eb.style.borderColor=!isInt?'#D85A30':'var(--border2)';eb.style.background=!isInt?'#D85A30':'var(--bg2)';eb.style.color=!isInt?'#fff':'var(--text2)';}
  const intSurfs=['walls','ceiling','trim','doors','windows','cabinets','epoxy'];
  const extSurfs=['ext_walls','ext_trim','deck','fence'];
  intSurfs.forEach(id=>{const b=document.getElementById('swhat-'+id);if(b)b.style.display=isInt?'':'none';});
  extSurfs.forEach(id=>{const b=document.getElementById('swhat-'+id);if(b)b.style.display=!isInt?'':'none';});
  surfWhatSelected=surfWhatSelected.filter(s=>isInt?intSurfs.includes(s):extSurfs.includes(s));
  updateSurfWhatUI();
  const nameLabel=document.getElementById('surf-room-name-label');
  const nameInput=document.getElementById('surf-room-name');
  if(isInt){
    if(nameLabel)nameLabel.textContent='Room name *';
    if(nameInput)nameInput.placeholder='Living room, Master bedroom...';
  }else{
    if(nameLabel)nameLabel.textContent='Location *';
    if(nameInput)nameInput.placeholder='Front of house, Back, Left side...';
  }
}

function toggleSurfWhat(type, btn){
  const idx=surfWhatSelected.indexOf(type);
  if(idx>=0) surfWhatSelected.splice(idx,1);
  else surfWhatSelected.push(type);
  updateSurfWhatUI();
}

function updateSurfWhatUI(){
  ['walls','ceiling','trim','doors','windows','cabinets','epoxy','ext_walls','ext_trim','deck','fence'].forEach(type=>{
    const btn=document.getElementById('swhat-'+type);
    if(!btn)return;
    const on=surfWhatSelected.includes(type);
    btn.style.borderColor=on?'var(--blue)':'var(--border2)';
    btn.style.background=on?'var(--blue-lt)':'var(--bg2)';
    btn.style.color=on?'var(--blue-dk)':'var(--text2)';
  });
  const nextBtn=document.getElementById('surf-next-to-dims');
  const hasRoom=!!surfRoom;
  const hasSurfs=surfWhatSelected.length>0;
  if(nextBtn){
    const ok=hasRoom&&hasSurfs;
    nextBtn.disabled=!ok;
    nextBtn.style.background=ok?'var(--blue)':'var(--border2)';
    nextBtn.style.color=ok?'#fff':'var(--text3)';
    nextBtn.style.borderColor=ok?'var(--blue)':'var(--border2)';
    nextBtn.style.cursor=ok?'pointer':'not-allowed';
  }
}

function onSurfRoomName(input){
  surfRoom=input.value.trim();
  input.style.borderColor=surfRoom?'var(--green)':'#A32D2D';
  input.style.background=surfRoom?'var(--green-lt)':'var(--red-lt)';
  updateSurfWhatUI();
}

// Strip legacy surface-type suffixes from room names (e.g. "Dining doors" -> "Dining")
function cleanRoomName(room){
  const raw=(room||'').split(' — ')[0].replace('[Ext] ','').trim();
  const types=['walls','ceiling','trim','doors','windows','cabinets','ext_walls','ext_trim','deck'];
  for(const t of types){if(raw.endsWith(' '+t))return raw.slice(0,-(t.length+1)).trim();}
  return raw;
}

function _sfShow(el,back){if(!el)return;el.classList.remove('sf-enter','sf-enter-back');void el.offsetWidth;el.classList.add(back?'sf-enter-back':'sf-enter');}

function goSurfStepA(){
  const a=document.getElementById('surf-step-a');
  document.getElementById('surf-step-b').style.display='none';
  const _pgEst=document.getElementById('pg-est');if(_pgEst)_pgEst.style.overflowY='';
  a.style.display='';
  _sfShow(a,true);
}

function goSurfStepB(){
  if(!surfRoom){
    const rn=document.getElementById('surf-room-name');
    if(rn){rn.focus();rn.style.borderColor='#A32D2D';rn.style.background='var(--red-lt)';}
    return;
  }
  surfColor='';
  const _pgEst=document.getElementById('pg-est');if(_pgEst){_pgEst.scrollTop=0;_pgEst.style.overflowY='hidden';}
  if(surfWhatSelected.length===0){
    zAlert('Select at least one surface to paint.',{title:'Nothing selected'});return;
  }
  surfBQueue=(typeof SURF_ORDER!=='undefined'?SURF_ORDER:['walls','ceiling','trim','doors','windows']).filter(s=>surfWhatSelected.includes(s));
  surfBIdx=0;
  surfBMeasurements={};
  document.getElementById('surf-step-a').style.display='none';
  const _stepBEl=document.getElementById('surf-step-b');_stepBEl.style.display='';_stepBEl.scrollTop=0;_sfShow(_stepBEl);
  document.getElementById('surf-b-roomname').textContent=surfRoom;
  // Show scope-first state
  const scopeFirst=document.getElementById('surf-scope-first');
  const measureWrap=document.getElementById('surf-measure-color-wrap');
  if(scopeFirst){scopeFirst.style.display='';_sfShow(scopeFirst);}
  if(measureWrap)measureWrap.style.display='none';
  // Read THIS room's stored paint supply — default to Zach (false)
  const _isc=roomScopeMap[surfRoom]?._customerPaint===true;
  // Ensure every room has an explicit value — no ambiguity
  if(!roomScopeMap[surfRoom])roomScopeMap[surfRoom]={};
  if(roomScopeMap[surfRoom]._customerPaint===undefined)roomScopeMap[surfRoom]._customerPaint=false;
  // Sync global DOM so goSurfScopeToMeasure can read it for hiding color picker
  const _custEl=document.getElementById('e-customer-paint');
  if(_custEl)_custEl.value=_isc?'1':'';
  const _zb=document.getElementById('paint-sup-zach');
  const _cb=document.getElementById('paint-sup-cust');
  if(_zb){_zb.style.borderColor=_isc?'var(--border2)':'var(--blue)';_zb.style.background=_isc?'var(--bg2)':'var(--blue-lt)';_zb.style.color=_isc?'var(--text)':'var(--blue-dk)';}
  if(_cb){_cb.style.borderColor=_isc?'#A32D2D':'var(--border2)';_cb.style.background=_isc?'#FEE8E8':'var(--bg2)';_cb.style.color=_isc?'#A32D2D':'var(--text)';}
  const _sn=document.getElementById('paint-supply-note');if(_sn)_sn.style.display=_isc?'block':'none';
  // Render scope grid — use the single shared renderer so cloud-sync can't clobber it with a different version
  _currentScopeRoom=surfRoom;
  if(typeof buildScopeGrid==='function')buildScopeGrid(surfRoom);
}

function setPaintSupply(who){
  const isCustomer=who==='customer';
  const paintEl=document.getElementById('e-paint');
  const custEl=document.getElementById('e-customer-paint');
  if(paintEl)paintEl.value=isCustomer?'customer':'interior';
  if(custEl)custEl.value=isCustomer?'1':'';
  // Store per-room — this is what buildProposal and calcEst read
  if(surfRoom){
    if(!roomScopeMap[surfRoom])roomScopeMap[surfRoom]={};
    roomScopeMap[surfRoom]._customerPaint=isCustomer;
  }
  const zachBtn=document.getElementById('paint-sup-zach');
  const custBtn=document.getElementById('paint-sup-cust');
  if(zachBtn){zachBtn.style.borderColor=isCustomer?'var(--border2)':'var(--blue)';zachBtn.style.background=isCustomer?'var(--bg2)':'var(--blue-lt)';zachBtn.style.color=isCustomer?'var(--text)':'var(--blue-dk)';}
  if(custBtn){custBtn.style.borderColor=isCustomer?'#A32D2D':'var(--border2)';custBtn.style.background=isCustomer?'#FEE8E8':'var(--bg2)';custBtn.style.color=isCustomer?'#A32D2D':'var(--text)';}
  const note=document.getElementById('paint-supply-note');
  if(note)note.style.display=isCustomer?'block':'none';
  renderEstRunning();saveEstFullDraft();
}

function goSurfScopeToMeasure(){
  const scopeFirst=document.getElementById('surf-scope-first');
  const measureWrap=document.getElementById('surf-measure-color-wrap');
  if(scopeFirst)scopeFirst.style.display='none';
  if(measureWrap){measureWrap.style.display='';_sfShow(measureWrap);}
  const isCustomer=document.getElementById('e-customer-paint')?.value==='1';
  const curType=surfBQueue[surfBIdx];
  const noProduct=isCustomer||curType==='epoxy'||curType==='fence';
  // Hide product/color pickers for non-paint surfaces and customer-supplied paint
  ['sw-product-wrap','sw-color-wrap'].forEach(id=>{
    const el=document.getElementById(id);
    if(el)el.style.display=noProduct?'none':'';
  });
  if(!noProduct){swInitFamilyGrid();}
  renderSurfBCurrent();
}

// Accent wall search
async function swAccentSearch(val){
  const dd=document.getElementById('sw-accent-dropdown');if(!dd)return;
  const q=(val||'').trim().toLowerCase();
  if(!q||q.length<2){dd.style.display='none';return;}
  const colors=await swLoadColors();
  const swNum=q.replace(/sw\s*/i,'').trim();
  const scored=[];
  for(const c of colors){
    const n=c.name.toLowerCase();
    let score=0;
    if(n===q)score=100;
    else if(n.startsWith(q))score=85;
    else if(n.includes(q))score=70;
    else if(c.sw.replace('SW ','')===swNum)score=95;
    else if(c.sw.toLowerCase().includes(swNum)&&swNum.length>=3)score=80;
    if(score>0)scored.push({...c,score});
  }
  scored.sort((a,b)=>b.score-a.score);
  const top=scored.slice(0,12);
  if(!top.length){dd.style.display='none';return;}
  dd.innerHTML=top.map(c=>
    '<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;cursor:pointer;border-bottom:1px solid var(--border2)" '+
      'onmousedown="swAccentSelect(\''+c.sw+'\','+JSON.stringify(c.name).replace(/'/g,"\\'")+',\''+c.hex+'\')">'+
      '<div style="width:22px;height:22px;border-radius:3px;background:'+c.hex+';border:1px solid rgba(0,0,0,.1);flex-shrink:0"></div>'+
      '<div><div style="font-size:12px;font-weight:600;color:var(--text)">'+c.name+'</div>'+
      '<div style="font-size:10px;color:var(--text3)">'+c.sw+'</div></div>'+
    '</div>'
  ).join('');
  dd.style.display='block';
}

function swAccentSelect(sw,name,hex){
  const dd=document.getElementById('sw-accent-dropdown');if(dd)dd.style.display='none';
  const si=document.getElementById('sw-accent-search');if(si)si.value='';
  const note=document.getElementById('sw-accent-note');if(note)note.value=name+' ('+sw+')';
  const prev=document.getElementById('sw-accent-preview');if(prev){prev.style.background=hex;prev.style.display='';}
  const lbl=document.getElementById('sw-accent-label');if(lbl)lbl.textContent=name+' ('+sw+')';
  const sel=document.getElementById('sw-accent-selected');if(sel)sel.style.display='flex';
}

function swClearAccent(){
  const note=document.getElementById('sw-accent-note');if(note)note.value='';
  const si=document.getElementById('sw-accent-search');if(si)si.value='';
  const sel=document.getElementById('sw-accent-selected');if(sel)sel.style.display='none';
}

function swHideAccentDropdown(){
  const dd=document.getElementById('sw-accent-dropdown');if(dd)dd.style.display='none';
}

// Post-job debrief — shown when marking job complete
function showJobDebrief(jobId){
  const job=jobs.find(j=>j.id===jobId);if(!job)return;
  const bid=bids.find(b=>b.id===job.bid_id);
  const roomScope=bid?.roomScopeMap||{};
  const scopeRooms=Object.entries(roomScope).filter(([r,sc])=>Object.values(sc).some(e=>e&&e.active));
  if(!scopeRooms.length){confirmMarkComplete(jobId);return;}
  const ov=document.createElement('div');ov.className='zmodal-overlay';
  const box=document.createElement('div');box.className='zmodal';
  box.style.maxHeight='88vh';box.style.overflowY='auto';
  let debriefRows='';
  scopeRooms.forEach(([room,sc])=>{
    const items=SCOPE_ITEMS.filter(s=>sc[s.id]&&sc[s.id].active);
    if(!items.length)return;
    debriefRows+=`<div style="margin-bottom:12px">
      <div style="font-size:11px;font-weight:800;color:var(--text3);text-transform:uppercase;margin-bottom:6px">${escHtml(room)}</div>
      ${items.map(s=>`<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border2)">
        <div style="font-size:13px;flex:1">${s.icon||''} ${s.label}</div>
        <input type="number" min="0" step="0.25" placeholder="hrs" inputmode="decimal"
          data-room="${encodeURIComponent(room)}" data-scope="${s.id}"
          style="width:64px;padding:5px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);font-size:13px;text-align:center">
      </div>`).join('')}
    </div>`;
  });
  box.innerHTML=
    `<div style="font-size:17px;font-weight:800;margin-bottom:4px">How'd the job go?</div>
    <div style="font-size:12px;color:var(--text3);margin-bottom:14px;line-height:1.6">Optional — enter actual hours for each task. Over time this builds your personal benchmarks so future estimates get sharper. Skip anything you didn't track.</div>
    ${debriefRows}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px">
      <button onclick="this.closest('.zmodal-overlay').remove();confirmMarkComplete(${jobId})" 
        style="padding:12px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);font-size:14px;font-weight:600;cursor:pointer;font-family:inherit">Skip</button>
      <button onclick="saveDebriefAndComplete(${jobId},this)" 
        style="padding:12px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">Save & complete ✓</button>
    </div>`;
  ov.appendChild(box);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov){ov.remove();confirmMarkComplete(jobId);}});
  // Pre-fill hours from clock entries
  const breakdown=getJobScopeBreakdown(jobId);
  if(Object.keys(breakdown).length){
    box.querySelectorAll('input[data-scope]').forEach(inp=>{
      const sid=inp.dataset.scope;
      const mins=breakdown[sid]||0;
      if(mins>0&&!inp.value){
        inp.value=Math.round(mins/60*4)/4; // round to nearest 0.25
      }
    });
  }
}

function saveDebriefAndComplete(jobId,btn){
  const box=btn.closest('.zmodal');
  const inputs=box.querySelectorAll('input[data-room][data-scope]');
  let totalActualHrs=0;
  inputs.forEach(inp=>{
    const room=decodeURIComponent(inp.dataset.room);
    const scopeId=inp.dataset.scope;
    const hrs=parseFloat(inp.value)||0;
    if(!hrs)return;
    totalActualHrs+=hrs;
    if(!S.scopeHistory)S.scopeHistory={};
    if(!S.scopeHistory[scopeId])S.scopeHistory[scopeId]=[];
    S.scopeHistory[scopeId].push({hrs,ts:Date.now()});
    if(S.scopeHistory[scopeId].length>20)S.scopeHistory[scopeId]=S.scopeHistory[scopeId].slice(-20);
  });
  if(totalActualHrs>0){const j=jobs.find(x=>x.id===jobId);if(j)j.actualHours=Math.round(totalActualHrs*10)/10;}
  saveAll();
  // Upload actual hours to crowdsourced benchmark pool
  const _debJob=jobs.find(x=>x.id===jobId);
  const _debBid=_debJob?.bid_id?bids.find(b=>b.id===_debJob.bid_id):null;
  const _debTrade=_debBid?.trade_type||'painting';
  const _benchRows=[];
  inputs.forEach(inp=>{
    const scopeId=inp.dataset.scope;
    const hrs=parseFloat(inp.value)||0;
    if(hrs>0&&_user?.id)_benchRows.push({user_id:_user.id,scope_id:scopeId,trade:_debTrade,actual_hrs:hrs});
  });
  if(typeof _submitScopeBenchmarks==='function')_submitScopeBenchmarks(_benchRows);
  btn.closest('.zmodal-overlay').remove();
  confirmMarkComplete(jobId);
}

function renderExtWallForm(){
  const type='ext_walls';
  if(!surfBMeasurements[type]||!Array.isArray(surfBMeasurements[type].walls)){
    surfBMeasurements[type]={
      walls:[{name:'Front',w:'',h:''},{name:'Back',w:'',h:''},{name:'Left side',w:'',h:''},{name:'Right side',w:'',h:''}],
      gables:[],windows:0,windowSize:15,doors:0,doorSize:21,deductOpenings:true,sqft:0
    };
  }
  const m=surfBMeasurements[type];
  const dims=document.getElementById('surf-b-dims');
  if(!dims)return;
  const iStyle='font-size:16px;font-weight:700;padding:6px 4px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);width:100%;box-sizing:border-box;text-align:center';
  const wallRows=m.walls.map((wl,i)=>
    '<div style="display:grid;grid-template-columns:1fr 54px 8px 48px auto 54px 20px;align-items:center;gap:4px;margin-bottom:6px">'+
      '<input placeholder="Wall name" value="'+(wl.name||'').replace(/"/g,'&quot;')+'" id="ext-wn-'+i+'"'+
        ' style="font-size:12px;padding:6px 8px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);width:100%;box-sizing:border-box"'+
        ' oninput="calcExtTotal()">'+
      '<input type="number" placeholder="W" value="'+(wl.w||'')+'" id="ext-ww-'+i+'"'+
        ' style="'+iStyle+'" oninput="calcExtTotal()" inputmode="decimal">'+
      '<div style="text-align:center;font-size:13px;color:var(--text3)">×</div>'+
      '<input type="number" placeholder="H" value="'+(wl.h||'')+'" id="ext-wh-'+i+'"'+
        ' style="'+iStyle+'" oninput="calcExtTotal()" inputmode="decimal">'+
      '<div style="font-size:10px;color:var(--text3)">ft</div>'+
      '<div id="ext-wsf-'+i+'" style="font-size:12px;font-weight:700;color:var(--green-mid);text-align:right">'+(wl.w&&wl.h?Math.round(parseFloat(wl.w)*parseFloat(wl.h))+' sf':'')+'</div>'+
      '<button onclick="removeExtItem(\'wall\','+i+')" style="font-size:16px;background:none;border:none;cursor:pointer;color:var(--text3);padding:0;line-height:1;font-family:inherit">×</button>'+
    '</div>'
  ).join('');
  const gableRows=m.gables.length?m.gables.map((g,i)=>
    '<div style="display:grid;grid-template-columns:1fr 54px 8px 48px auto 54px 20px;align-items:center;gap:4px;margin-bottom:6px">'+
      '<input placeholder="Gable name" value="'+(g.name||'').replace(/"/g,'&quot;')+'" id="ext-gn-'+i+'"'+
        ' style="font-size:12px;padding:6px 8px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);width:100%;box-sizing:border-box"'+
        ' oninput="calcExtTotal()">'+
      '<input type="number" placeholder="Base" value="'+(g.base||'')+'" id="ext-gb-'+i+'"'+
        ' style="'+iStyle+'" oninput="calcExtTotal()" inputmode="decimal">'+
      '<div style="text-align:center;font-size:13px;color:var(--text3)">×</div>'+
      '<input type="number" placeholder="Peak" value="'+(g.peak||'')+'" id="ext-gp-'+i+'"'+
        ' style="'+iStyle+'" oninput="calcExtTotal()" inputmode="decimal">'+
      '<div style="font-size:10px;color:var(--text3)">÷2</div>'+
      '<div id="ext-gsf-'+i+'" style="font-size:12px;font-weight:700;color:var(--green-mid);text-align:right">'+(g.base&&g.peak?Math.round(parseFloat(g.base)*parseFloat(g.peak)/2)+' sf':'')+'</div>'+
      '<button onclick="removeExtItem(\'gable\','+i+')" style="font-size:16px;background:none;border:none;cursor:pointer;color:var(--text3);padding:0;line-height:1;font-family:inherit">×</button>'+
    '</div>'
  ).join(''):'<div style="font-size:11px;color:var(--text3);margin-bottom:8px;padding:6px 0">None — tap + Gable if house has peaked ends</div>';
  const sInput='font-size:18px;font-weight:700;padding:8px 4px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);width:100%;box-sizing:border-box;text-align:center';
  dims.innerHTML=
    '<div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Wall faces — Width × Height</div>'+
    '<div id="ext-walls-list">'+wallRows+'</div>'+
    '<button onclick="addExtWall()" class="btn btn-sm" style="width:100%;margin-bottom:14px;background:var(--bg2);border-color:var(--border2);font-size:12px">+ Add wall</button>'+
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">'+
      '<div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em">Gables — Base × Peak ÷ 2</div>'+
      '<button onclick="addExtGable()" class="btn btn-sm" style="font-size:11px;padding:4px 10px;background:var(--bg2);border-color:var(--border2)">+ Gable</button>'+
    '</div>'+
    '<div id="ext-gables-list" style="margin-bottom:12px">'+gableRows+'</div>'+
    '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:8px">'+
      '<input type="checkbox" id="ext-deduct" '+(m.deductOpenings!==false?'checked':'')+' onchange="calcExtTotal()" style="width:16px;height:16px">'+
      '<span style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.04em">Deduct windows &amp; doors</span>'+
    '</label>'+
    '<div id="ext-deduct-fields" style="display:'+(m.deductOpenings!==false?'grid':'none')+';grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">'+
      '<div style="background:var(--bg2);border-radius:var(--r);padding:8px">'+
        '<div style="font-size:10px;color:var(--text3);font-weight:600;margin-bottom:6px">Windows · count × sq ft</div>'+
        '<div style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:4px">'+
          '<input type="number" id="ext-wins" value="'+(m.windows||0)+'" min="0" placeholder="0" style="'+sInput+'" oninput="calcExtTotal()">'+
          '<span style="font-size:13px;color:var(--text3);padding:0 2px">×</span>'+
          '<input type="number" id="ext-win-sf" value="'+(m.windowSize||15)+'" min="1" placeholder="15" style="'+sInput+'" oninput="calcExtTotal()">'+
        '</div>'+
      '</div>'+
      '<div style="background:var(--bg2);border-radius:var(--r);padding:8px">'+
        '<div style="font-size:10px;color:var(--text3);font-weight:600;margin-bottom:6px">Doors · count × sq ft</div>'+
        '<div style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:4px">'+
          '<input type="number" id="ext-doors" value="'+(m.doors||0)+'" min="0" placeholder="0" style="'+sInput+'" oninput="calcExtTotal()">'+
          '<span style="font-size:13px;color:var(--text3);padding:0 2px">×</span>'+
          '<input type="number" id="ext-door-sf" value="'+(m.doorSize||21)+'" min="1" placeholder="21" style="'+sInput+'" oninput="calcExtTotal()">'+
        '</div>'+
      '</div>'+
    '</div>'+
    '<div style="background:var(--blue-lt);border:1.5px solid var(--blue);border-radius:var(--r);padding:12px;text-align:center">'+
      '<div style="font-size:11px;color:var(--blue-dk);font-weight:700;margin-bottom:2px">Total paintable sq ft</div>'+
      '<div id="ext-total-sf" style="font-size:42px;font-weight:800;color:var(--blue-dk);line-height:1.1">—</div>'+
      '<div id="ext-total-detail" style="font-size:11px;color:var(--blue);margin-top:4px"></div>'+
    '</div>';
  setTimeout(calcExtTotal,50);
}
function calcExtTotal(){
  const m=surfBMeasurements.ext_walls;if(!m||!m.walls)return;
  let wallsTotal=0;
  m.walls.forEach((wl,i)=>{
    const w=parseFloat(document.getElementById('ext-ww-'+i)?.value)||0;
    const h=parseFloat(document.getElementById('ext-wh-'+i)?.value)||0;
    const sf=Math.round(w*h);
    const el=document.getElementById('ext-wsf-'+i);if(el)el.textContent=sf>0?sf+' sf':'';
    wallsTotal+=sf;
    wl.name=document.getElementById('ext-wn-'+i)?.value||wl.name||'';
    wl.w=w||wl.w||'';wl.h=h||wl.h||'';wl.sqft=sf;
  });
  let gablesTotal=0;
  m.gables.forEach((g,i)=>{
    const b=parseFloat(document.getElementById('ext-gb-'+i)?.value)||0;
    const p=parseFloat(document.getElementById('ext-gp-'+i)?.value)||0;
    const sf=Math.round(b*p/2);
    const el=document.getElementById('ext-gsf-'+i);if(el)el.textContent=sf>0?sf+' sf':'';
    gablesTotal+=sf;
    g.name=document.getElementById('ext-gn-'+i)?.value||g.name||'';
    g.base=b||g.base||'';g.peak=p||g.peak||'';g.sqft=sf;
  });
  const deductEl=document.getElementById('ext-deduct');
  const doDeduct=deductEl?deductEl.checked:m.deductOpenings!==false;
  const dFields=document.getElementById('ext-deduct-fields');
  if(dFields)dFields.style.display=doDeduct?'grid':'none';
  const wins=parseInt(document.getElementById('ext-wins')?.value)||0;
  const winSf=parseFloat(document.getElementById('ext-win-sf')?.value)||15;
  const doors=parseInt(document.getElementById('ext-doors')?.value)||0;
  const doorSf=parseFloat(document.getElementById('ext-door-sf')?.value)||21;
  const deductions=doDeduct?Math.round(wins*winSf+doors*doorSf):0;
  const subtotal=wallsTotal+gablesTotal;
  const total=Math.max(0,subtotal-deductions);
  m.windows=wins;m.windowSize=winSf;m.doors=doors;m.doorSize=doorSf;
  m.deductOpenings=doDeduct;m.sqft=total;
  const tEl=document.getElementById('ext-total-sf');
  const dEl=document.getElementById('ext-total-detail');
  if(tEl)tEl.textContent=total>0?total.toLocaleString():'—';
  if(dEl){
    const parts=[];
    if(wallsTotal)parts.push('Walls: '+wallsTotal.toLocaleString()+' sf');
    if(gablesTotal)parts.push('Gables: +'+gablesTotal.toLocaleString()+' sf');
    if(deductions)parts.push('Openings: −'+deductions.toLocaleString()+' sf');
    dEl.textContent=parts.join(' · ');
  }
}
function addExtWall(){
  calcExtTotal();
  surfBMeasurements.ext_walls.walls.push({name:'',w:'',h:'',sqft:0});
  renderExtWallForm();
  const idx=surfBMeasurements.ext_walls.walls.length-1;
  setTimeout(()=>document.getElementById('ext-wn-'+idx)?.focus(),60);
}
function addExtGable(){
  calcExtTotal();
  surfBMeasurements.ext_walls.gables.push({name:'',base:'',peak:'',sqft:0});
  renderExtWallForm();
  const idx=surfBMeasurements.ext_walls.gables.length-1;
  setTimeout(()=>document.getElementById('ext-gn-'+idx)?.focus(),60);
}
function removeExtItem(kind,idx){
  calcExtTotal();
  const m=surfBMeasurements.ext_walls;
  if(kind==='wall'){if(m.walls.length<=1)return;m.walls.splice(idx,1);}
  else{m.gables.splice(idx,1);}
  renderExtWallForm();
}
function renderSurfBCurrent(){
  const _stepBEl=document.getElementById('surf-step-b');if(_stepBEl)_stepBEl.scrollTop=0;
  // Reset color+finish for each new surface type
  _swResetColorUI();
  swResetProduct();
  const roomSqftVal=parseFloat(document.getElementById('surf-room-sqft')?.value)||0;
  const type=surfBQueue[surfBIdx];
  // Render product grid filtered for this surface type (skip for non-paint surfaces)
  if(type!=='epoxy'&&type!=='fence'){swRenderProductGrid(type);}
  else{['sw-product-wrap','sw-color-wrap'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});}
  const label=SURF_LABELS[type]||type;
  const total=surfBQueue.length;
  const prog=document.getElementById('surf-b-progress');
  if(prog)prog.textContent=(surfBIdx+1)+' of '+total+' — '+label;

  const nextBtn=document.getElementById('surf-b-next-btn');
  if(nextBtn){
    const isLast=surfBIdx>=total-1;
    nextBtn.textContent=isLast?'Save room ✓':'Next surface →';
    nextBtn.style.background=isLast?'var(--green)':'var(--blue)';
    nextBtn.style.borderColor=isLast?'var(--green)':'var(--blue)';
  }

  const cur=document.getElementById('surf-b-current');
  if(cur)cur.innerHTML='<div style="font-size:20px;font-weight:800;margin-bottom:12px;color:var(--blue)">'+(type==='ext_walls'?'Exterior Siding — Wall by Wall':label)+'</div>';

  const dims=document.getElementById('surf-b-dims');
  const subopts=document.getElementById('surf-b-subopts');
  if(!dims||!subopts)return;
  subopts.style.display='none';

  if(type==='ext_walls'){
    renderExtWallForm();
    return;
  }

  if(type==='walls'){
    const m=surfBMeasurements[type]||{sqft:'',len:'',wid:'',hgt:9};
    dims.innerHTML=
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">'+
        '<div>'+
          '<label style="font-size:11px;font-weight:600;color:var(--text3);display:block;margin-bottom:6px">Length (ft)</label>'+
          '<input type="number" id="surf-b-len" value="'+(m.len||'')+'" min="0" step="1" placeholder="0" inputmode="decimal"'+
            ' style="font-size:28px;font-weight:700;padding:12px;border-radius:var(--r);border:1.5px solid var(--border2);background:var(--bg2);color:var(--text);width:100%;box-sizing:border-box;text-align:center"'+
            ' oninput="updateWallSqft()">'+
        '</div>'+
        '<div>'+
          '<label style="font-size:11px;font-weight:600;color:var(--text3);display:block;margin-bottom:6px">Width (ft)</label>'+
          '<input type="number" id="surf-b-wid" value="'+(m.wid||'')+'" min="0" step="1" placeholder="0" inputmode="decimal"'+
            ' style="font-size:28px;font-weight:700;padding:12px;border-radius:var(--r);border:1.5px solid var(--border2);background:var(--bg2);color:var(--text);width:100%;box-sizing:border-box;text-align:center"'+
            ' oninput="updateWallSqft()">'+
        '</div>'+
      '</div>'+
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">'+
        '<label style="font-size:11px;font-weight:600;color:var(--text3);white-space:nowrap">Ceiling height</label>'+
        '<input type="number" id="surf-b-hgt" value="'+(m.hgt||9)+'" min="6" step="0.5" placeholder="9" inputmode="decimal"'+
          ' style="font-size:16px;font-weight:700;padding:8px;border-radius:var(--r);border:1.5px solid var(--border2);background:var(--bg2);color:var(--text);width:70px;box-sizing:border-box;text-align:center"'+
          ' oninput="updateWallSqft()">'+
        '<span style="font-size:13px;color:var(--text3)">ft</span>'+
        '<div id="surf-b-sqftcalc" style="margin-left:auto;font-size:18px;font-weight:800;color:var(--text)"></div>'+
      '</div>'+
      '<input type="number" id="surf-b-sqft" value="'+(m.sqft||'')+'" min="0" step="1" placeholder="0" inputmode="decimal" style="display:none" oninput="updateWallSqft(true)">';
    setTimeout(()=>{const el=document.getElementById('surf-b-len');if(el)el.focus();},80);
    if(m.len&&m.wid)setTimeout(updateWallSqft,50);
    return;
  }

  if(type==='fence'){
    const m=surfBMeasurements[type]||{sqft:''};
    dims.innerHTML=
      '<div style="display:grid;grid-template-columns:1fr auto 1fr auto 1fr;align-items:center;gap:8px;margin-bottom:10px">'+
        '<div><label style="font-size:10px;font-weight:700;color:var(--text3);display:block;margin-bottom:4px">Fence length (ft)</label>'+
        '<input type="number" id="surf-b-len" value="'+(m.len||'')+'" min="0" step="1" placeholder="0" inputmode="decimal"'+
          ' style="font-size:24px;font-weight:700;padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);width:100%;box-sizing:border-box;text-align:center"'+
          ' oninput="updateFenceSqft()"></div>'+
        '<div style="font-size:20px;color:var(--text3);padding-top:18px">×</div>'+
        '<div><label style="font-size:10px;font-weight:700;color:var(--text3);display:block;margin-bottom:4px">Fence height (ft)</label>'+
        '<input type="number" id="surf-b-hgt" value="'+(m.hgt||6)+'" min="0" step="0.5" placeholder="6" inputmode="decimal"'+
          ' style="font-size:24px;font-weight:700;padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);width:100%;box-sizing:border-box;text-align:center"'+
          ' oninput="updateFenceSqft()"></div>'+
        '<div style="font-size:20px;color:var(--text3);padding-top:18px">=</div>'+
        '<div><label style="font-size:10px;font-weight:700;color:var(--text3);display:block;margin-bottom:4px">Sq ft</label>'+
        '<input type="number" id="surf-b-sqft" value="'+(m.sqft||'')+'" min="0" step="1" placeholder="0" inputmode="decimal"'+
          ' style="font-size:24px;font-weight:700;padding:10px;border-radius:var(--r);border:2px solid var(--blue);background:var(--bg2);color:var(--text);width:100%;box-sizing:border-box;text-align:center"'+
          ' oninput="updateFenceSqft(true)"></div>'+
      '</div>'+
      '<div id="surf-b-sqftcalc" style="font-size:12px;color:var(--text3);text-align:center">Enter fence length × height</div>';
    setTimeout(()=>{const el=document.getElementById('surf-b-len');if(el){el.focus();}},80);
    if(m.len&&m.hgt)setTimeout(updateFenceSqft,50);
    return;
  }

  if(type==='ceiling'||type==='deck'||type==='epoxy'){
    const m=surfBMeasurements[type]||{sqft:''};
    // Auto-fill ceiling from walls sqft
    const wallsSqft=surfBMeasurements.walls?.sqft||surfBMeasurements.ext_walls?.sqft||0;
    const autoFillSqft=(type==='ceiling'&&!m.sqft&&wallsSqft)?wallsSqft:null;
    if(autoFillSqft)m.sqft=autoFillSqft;
    const dim2Label=type==='epoxy'?'Width (ft)':'Width (ft)';
    dims.innerHTML=
      (autoFillSqft?'<div style="font-size:11px;color:var(--green-mid);font-weight:700;margin-bottom:8px;text-align:center">✓ Auto-filled from room dimensions — edit if different</div>':'')+
      '<div style="display:grid;grid-template-columns:1fr auto 1fr auto 1fr;align-items:center;gap:8px;margin-bottom:10px">'+
        '<div><label style="font-size:10px;font-weight:700;color:var(--text3);display:block;margin-bottom:4px">Length (ft)</label>'+
        '<input type="number" id="surf-b-len" value="" min="0" step="1" placeholder="0" inputmode="decimal"'+
          ' style="font-size:24px;font-weight:700;padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);width:100%;box-sizing:border-box;text-align:center"'+
          ' oninput="updateSqftCalc()"></div>'+
        '<div style="font-size:20px;color:var(--text3);padding-top:18px">×</div>'+
        '<div><label style="font-size:10px;font-weight:700;color:var(--text3);display:block;margin-bottom:4px">'+dim2Label+'</label>'+
        '<input type="number" id="surf-b-wid" value="" min="0" step="1" placeholder="0" inputmode="decimal"'+
          ' style="font-size:24px;font-weight:700;padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);width:100%;box-sizing:border-box;text-align:center"'+
          ' oninput="updateSqftCalc()"></div>'+
        '<div style="font-size:20px;color:var(--text3);padding-top:18px">=</div>'+
        '<div><label style="font-size:10px;font-weight:700;color:var(--text3);display:block;margin-bottom:4px">Sq ft</label>'+
        '<input type="number" id="surf-b-sqft" value="'+(m.sqft||roomSqftVal||'')+'" min="0" step="1" placeholder="0" inputmode="decimal"'+
          ' style="font-size:24px;font-weight:700;padding:10px;border-radius:var(--r);border:2px solid var(--blue);background:var(--bg2);color:var(--text);width:100%;box-sizing:border-box;text-align:center"'+
          ' oninput="updateSqftCalc(true)"></div>'+
      '</div>'+
      '<div id="surf-b-sqftcalc" style="font-size:12px;color:var(--text3);text-align:center">Enter dimensions or type sq ft directly</div>';
    setTimeout(()=>{const el=document.getElementById('surf-b-len');if(el){el.focus();}},80);
    return;
  }

  if(SURF_IS_COUNT.includes(type)){
    const saved=surfBMeasurements[type]||{count:1};
    subopts.style.display='none';
    dims.innerHTML=
      '<label style="font-size:11px;font-weight:700;color:var(--text3);display:block;margin-bottom:8px">How many?</label>'+
      '<div style="display:flex;align-items:center;justify-content:center;gap:20px;padding:14px;background:var(--bg2);border-radius:var(--rl)">'+
        '<button onclick="adjSurfBCount(-1)" style="width:48px;height:48px;border-radius:50%;border:2px solid var(--border2);background:var(--bg);font-size:26px;cursor:pointer;color:var(--text);font-family:inherit">−</button>'+
        '<div style="text-align:center;min-width:56px">'+
          '<div style="font-size:44px;font-weight:700;color:var(--text);line-height:1" id="surf-b-count">'+(saved.count||1)+'</div>'+
          '<div style="font-size:11px;color:var(--text3)">'+label.toLowerCase()+'</div>'+
        '</div>'+
        '<button onclick="adjSurfBCount(1)" style="width:48px;height:48px;border-radius:50%;border:2px solid var(--blue);background:var(--blue);font-size:26px;cursor:pointer;color:#fff;font-family:inherit">+</button>'+
      '</div>';
    // Auto-select sensible default finish for count-type surfaces
    const _defFinish=type==='doors'||type==='cabinets'?'Semi-Gloss':'Satin';
    setTimeout(()=>{
      const _fb=document.querySelector('#surf-step-b .sw-finish-btn[data-finish="'+_defFinish+'"]');
      if(_fb&&!document.getElementById('sw-selected-finish')?.value)swSelectFinish(_fb);
    },60);
  } else {
    const saved=surfBMeasurements[type]||{};
    const needsH=SURF_NEEDS_H.includes(type);
    dims.innerHTML=
      '<div style="display:grid;grid-template-columns:'+(needsH?'1fr 1fr':'1fr')+';gap:10px">'+
        '<div>'+
          '<label style="font-size:11px;font-weight:700;color:var(--text3);display:block;margin-bottom:4px">'+(needsH?'Length (ft)':'Linear feet')+'</label>'+
          '<input type="number" id="surf-b-len" min="0" step="0.5" placeholder="0" value="'+(saved.len||'')+'"'+
            ' style="font-size:28px;font-weight:700;padding:12px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);width:100%;box-sizing:border-box;text-align:center"'+
            ' oninput="updateSurfBCalc()" inputmode="decimal">'+
        '</div>'+
        (needsH?'<div>'+
          '<label style="font-size:11px;font-weight:700;color:var(--text3);display:block;margin-bottom:4px">Height (ft)</label>'+
          '<input type="number" id="surf-b-hgt" min="0" step="0.5" placeholder="0" value="'+(saved.hgt||'')+'"'+
            ' style="font-size:28px;font-weight:700;padding:12px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);width:100%;box-sizing:border-box;text-align:center"'+
            ' oninput="updateSurfBCalc()" inputmode="decimal">'+
        '</div>':'')+'</div>'+
      '<div id="surf-b-calc" style="margin-top:8px;font-size:13px;font-weight:700;color:var(--green-mid);min-height:20px"></div>';
    setTimeout(()=>{const el=document.getElementById('surf-b-len');if(el)el.focus();},100);
    updateSurfBCalc();
  }
}
function updateFenceSqft(manual){
  const lenEl=document.getElementById('surf-b-len');
  const hgtEl=document.getElementById('surf-b-hgt');
  const sqEl=document.getElementById('surf-b-sqft');
  const calc=document.getElementById('surf-b-sqftcalc');
  if(!sqEl)return;
  if(!manual&&lenEl&&hgtEl){
    const l=parseFloat(lenEl.value)||0;
    const h=parseFloat(hgtEl.value)||0;
    if(l>0&&h>0){sqEl.value=Math.round(l*h);sqEl.style.borderColor='var(--green)';}
    else{sqEl.style.borderColor='var(--blue)';}
  }
  const val=parseFloat(sqEl.value)||0;
  if(calc){calc.textContent=val>0?val.toLocaleString()+' sq ft':'Enter fence length × height';calc.style.color=val>0?'var(--green-mid)':'var(--text3)';}
}
function updateWallSqft(manual){
  const sqEl=document.getElementById('surf-b-sqft');
  const calc=document.getElementById('surf-b-sqftcalc');
  const l=parseFloat(document.getElementById('surf-b-len')?.value)||0;
  const w=parseFloat(document.getElementById('surf-b-wid')?.value)||0;
  const h=parseFloat(document.getElementById('surf-b-hgt')?.value)||9;
  const floorSqft=l>0&&w>0?Math.round(l*w):0;
  const wallSqft=l>0&&w>0?Math.round((l+w)*2*h):0;
  if(sqEl)sqEl.value=floorSqft||'';
  if(calc)calc.textContent=floorSqft>0?floorSqft+' sq ft':'';
  // Store wallSqft on the hidden input as a data attribute for save to read
  if(sqEl)sqEl.dataset.wallSqft=wallSqft||'';
}

function updateSqftCalc(manualSqft){
  const lenEl=document.getElementById('surf-b-len');
  const widEl=document.getElementById('surf-b-wid');
  const sqEl=document.getElementById('surf-b-sqft');
  const calc=document.getElementById('surf-b-sqftcalc');
  if(!sqEl)return;
  if(!manualSqft&&lenEl&&widEl){
    const l=parseFloat(lenEl.value)||0;
    const w=parseFloat(widEl.value)||0;
    if(l>0&&w>0){sqEl.value=Math.round(l*w);sqEl.style.borderColor='var(--green)';}
    else{sqEl.style.borderColor='var(--blue)';}
  }
  const val=parseFloat(sqEl.value)||0;
  if(calc){calc.textContent=val>0?val.toLocaleString()+' sq ft':'Enter dimensions or type sq ft directly';calc.style.color=val>0?'var(--green-mid)':'var(--text3)';}
}
function updateSurfBCalc(){
  const l=parseFloat(document.getElementById('surf-b-len')?.value)||0;
  const h=parseFloat(document.getElementById('surf-b-hgt')?.value)||0;
  const type=surfBQueue[surfBIdx];
  const needsH=SURF_NEEDS_H.includes(type);
  const qty=needsH?Math.round(l*h):Math.round(l);
  const cr=document.getElementById('surf-b-calc');
  if(cr){
    if(qty>0) cr.textContent=needsH?(l+' × '+h+' = '+qty+' sq ft'):(qty+' lin ft');
    else cr.textContent='';
  }
}

function setSurfBOpt(val){
  const type=surfBQueue[surfBIdx];
  if(!surfBMeasurements[type])surfBMeasurements[type]={count:1};
  surfBMeasurements[type].opt=val;
  document.querySelectorAll('[id^=sbopt-]').forEach(b=>{
    const isOn=b.id==='sbopt-'+val;
    b.style.borderColor=isOn?'var(--blue)':'var(--border2)';
    b.style.background=isOn?'var(--blue-lt)':'var(--bg2)';
    b.style.color=isOn?'var(--blue-dk)':'var(--text2)';
  });
}

function adjSurfBCount(d){
  const type=surfBQueue[surfBIdx];
  if(!surfBMeasurements[type])surfBMeasurements[type]={count:1,opt:'trim'};
  surfBMeasurements[type].count=Math.max(1,(surfBMeasurements[type].count||1)+d);
  const el=document.getElementById('surf-b-count');
  if(el)el.textContent=surfBMeasurements[type].count;
}

function saveSurfBAndNext(){
  const isCustomer=document.getElementById('e-customer-paint')?.value==='1';
  const curType=surfBQueue[surfBIdx];
  const _noProduct=isCustomer||curType==='epoxy'||curType==='fence';

  // Only validate product/color/finish when Zach supplies paint on a paintable surface
  if(!_noProduct){
    const _productVal=(document.getElementById('sw-selected-product')?.value||'').trim();
    const _colorVal=(document.getElementById('surf-color-b')?.value||'').trim();
    const _finishVal=(document.getElementById('sw-selected-finish')?.value||'').trim();
    if(!_productVal){zAlert('Select a paint product for this surface.',{title:'Product required'});return;}
    if(!_colorVal){
      const wrap=document.getElementById('sw-color-wrap');
      if(wrap)wrap.scrollIntoView({behavior:'smooth',block:'start'});
      const el=document.getElementById('sw-search-input');
      setTimeout(()=>{
        if(wrap){wrap.style.outline='2px solid #A32D2D';wrap.style.borderRadius='var(--rl)';setTimeout(()=>{if(wrap)wrap.style.outline='';},2000);}
        if(el){el.style.borderColor='#A32D2D';el.style.background='var(--red-lt)';}
      },400);
      zAlert('Search or browse to pick a color for this surface.',{title:'Color required'});return;
    }
    if(!_finishVal){zAlert('Select a finish for this surface.',{title:'Finish required'});return;}
  }

  const type=surfBQueue[surfBIdx];
  const _finish=document.getElementById('sw-selected-finish')?.value||_swFinish||'';
  const _surfColorVal=(document.getElementById('surf-color-b')?.value||surfColor||'').trim();
  const _accentNote=(document.getElementById('sw-accent-note')?.value||'').trim();
  const _productName=swGetProductName();
  // When customer supplies paint, save surface without any color/product spec
  const colorNote=isCustomer?'':(_surfColorVal?' — '+(_productName?_productName+' · ':'')+_surfColorVal+(_finish?' ['+_finish+']':'')+(_accentNote?' + Accent: '+_accentNote:''):'  ');
  const prefix=surfJobType==='exterior'?'[Ext] ':'';

  if(type==='ext_walls'){
    calcExtTotal();
    const m=surfBMeasurements.ext_walls||{};
    const sqft=m.sqft||0;
    if(!sqft){zAlert('Add measurements for at least one wall.',{title:'Measurements needed'});return;}
    estSurfaces.push({id:++estSurfId,type,qty:sqft,wallSqft:sqft,room:prefix+surfRoom+colorNote,extBreakdown:JSON.parse(JSON.stringify(m))});
    surfBIdx++;
    if(surfBIdx<surfBQueue.length){window.scrollTo({top:0,left:0,behavior:'instant'});document.body.scrollTop=0;renderSurfBCurrent();}
    else finishRoom();
    return;
  }

  if(type==='walls'||type==='ceiling'||type==='deck'||type==='fence'||type==='epoxy'){
    const sqEl=document.getElementById('surf-b-sqft');
    const sqft=Math.round(parseFloat(sqEl?sqEl.value:0)||0);
    if(!sqft){zAlert('Enter the square footage.',{title:'Measurements needed'});return;}
    const _l=parseFloat(document.getElementById('surf-b-len')?.value)||0;
    const _w=parseFloat(document.getElementById('surf-b-wid')?.value)||0;
    const _h=parseFloat(document.getElementById('surf-b-hgt')?.value)||9;
    const _wallSqft=type==='walls'&&_l>0&&_w>0?Math.round((_l+_w)*2*_h):sqft;
    surfBMeasurements[type]={sqft,len:_l,wid:_w,hgt:_h,wallSqft:_wallSqft};
    estSurfaces.push({id:++estSurfId,type,qty:sqft,wallSqft:_wallSqft,room:prefix+surfRoom+colorNote});
    surfBIdx++;
    if(surfBIdx<surfBQueue.length){window.scrollTo({top:0,left:0,behavior:'instant'});document.body.scrollTop=0;renderSurfBCurrent();}
    else finishRoom();
    return;
  }

  if(SURF_IS_COUNT.includes(type)){
    const m=surfBMeasurements[type]||{count:1};
    const count=m.count||1;
    estSurfaces.push({id:++estSurfId,type,qty:count,room:prefix+surfRoom+colorNote});
    surfBIdx++;
    if(surfBIdx<surfBQueue.length)renderSurfBCurrent();
    else finishRoom();
    return;
  }

  const lEl=document.getElementById('surf-b-len');
  const hEl=document.getElementById('surf-b-hgt');
  const l=parseFloat(lEl?lEl.value:0)||0;
  const h=parseFloat(hEl?hEl.value:0)||0;
  const needsH=SURF_NEEDS_H.includes(type);
  const qty=needsH?Math.round(l*h):Math.round(l);
  if(!qty){zAlert('Enter the dimensions first.',{title:'Measurements needed'});return;}
  surfBMeasurements[type]={len:l,hgt:h};
  estSurfaces.push({id:++estSurfId,type,qty,room:prefix+surfRoom+colorNote});
  surfBIdx++;
  if(surfBIdx<surfBQueue.length){window.scrollTo({top:0,left:0,behavior:'instant'});document.body.scrollTop=0;renderSurfBCurrent();}
  else finishRoom();
}

function finishRoom(){
  try{renderEstSurfs();}catch(e){}
  try{renderEstRunning();}catch(e){}
  saveSurfDraft();saveEstFullDraft();renderSurfRoomsLogged();
  const btn=document.getElementById('est-s3-next-btn');
  if(btn){btn.disabled=false;btn.style.background='var(--blue)';btn.style.color='#fff';btn.style.borderColor='var(--blue)';btn.style.cursor='pointer';}
  surfWhatSelected=[];surfBQueue=[];surfBIdx=0;surfBMeasurements={};surfColor='';surfRoom='';_swResetColorUI();
  _editRoomBackup=null; // room saved — cancel is no longer meaningful
  document.getElementById('_edit-room-cancel')?.remove();
  updateSurfWhatUI();
  const rooms=new Set(estSurfaces.map(s=>cleanRoomName(s.room)));
  const roomCount=rooms.size;
  const rcl=document.getElementById('surf-room-count');if(rcl)rcl.textContent=roomCount+' room'+(roomCount!==1?'s':'')+' added';
  showRoomSavedState(roomCount);
  window.scrollTo({top:0,left:0,behavior:'instant'});document.body.scrollTop=0;document.documentElement.scrollTop=0;
}

function showRoomSavedState(roomCount){
  document.getElementById('surf-step-b').style.display='none';
  const _pgEstR=document.getElementById('pg-est');if(_pgEstR)_pgEstR.style.overflowY='';
  // Get the room name just saved from the last surface entry
  const lastSavedRoom=estSurfaces.length>0?cleanRoomName(estSurfaces[estSurfaces.length-1].room):'';
  const surf3=document.getElementById('est-s3');
  if(!surf3)return;
  let doneDiv=document.getElementById('surf-room-done');
  if(!doneDiv){
    doneDiv=document.createElement('div');
    doneDiv.id='surf-room-done';
    const stepB=document.getElementById('surf-step-b');
    if(stepB&&stepB.parentNode)stepB.parentNode.insertBefore(doneDiv,stepB.nextSibling);
  }
  doneDiv.style.display='block';
  doneDiv.innerHTML=
    '<div style="padding:14px 0 10px">'+
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">'+
        '<div style="font-size:28px;color:var(--green-mid)">✓</div>'+
        '<div>'+
          '<div style="font-size:16px;font-weight:800;color:var(--green-mid)">Room saved</div>'+
          '<div style="font-size:12px;color:var(--text3)">'+roomCount+' room'+(roomCount!==1?'s':'')+' total</div>'+
        '</div>'+
      '</div>'+
      (()=>{
        const roomSurfs=estSurfaces.filter(s=>{
          const base=cleanRoomName(s.room);
          return base===surfRoom||(estSurfaces.length>0&&s===estSurfaces[estSurfaces.length-1]);
        });
        const recentRoom=estSurfaces.length>0?(estSurfaces[estSurfaces.length-1].room||'').split(' — ')[0].replace('[Ext] ','').trim():'';
        const recentSurfs=estSurfaces.filter(s=>cleanRoomName(s.room)===recentRoom);
        if(!recentSurfs.length)return '';
        const SURF_LABELS2={walls:'Walls',ceiling:'Ceiling',trim:'Trim',doors:'Doors',windows:'Windows',cabinets:'Cabinets',ext_walls:'Siding',ext_trim:'Ext trim',deck:'Deck',fence:'Fence staining',epoxy:'Epoxy floor'};
        // Show color swatch if color was selected
        const roomColor=(recentSurfs[0]?.room||'').split(' — ')[1]?.replace(/\s*\[.*\]/,'').trim()||'';
        return '<div style="background:var(--bg2);border-radius:var(--r);padding:10px 12px;margin-bottom:10px">'+
          '<div style="font-size:11px;font-weight:700;color:var(--text3);margin-bottom:6px">'+escHtml(recentRoom)+'</div>'+
          recentSurfs.map(s=>'<div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0"><span style="color:var(--text2)">'+(SURF_LABELS2[s.type]||s.type)+'</span><span style="font-weight:700">'+s.qty.toLocaleString()+(s.type==='trim'||s.type==='ext_trim'?' lf':' sf')+'</span></div>').join('')+
        '</div>';
      })()+
    '</div>'+
    '<div style="display:grid;gap:10px">'+
      '<button onclick="addAnotherRoom()" style="padding:14px;border-radius:var(--rl);border:2px solid var(--border2);background:var(--bg2);color:var(--text);font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">'+
        '+ Add another room'+
      '</button>'+
    '</div>';
}

function addAnotherRoom(){
  const doneDiv=document.getElementById('surf-room-done');
  if(doneDiv)doneDiv.style.display='none';
  const rn=document.getElementById('surf-room-name');
  if(rn){rn.value='';rn.style.borderColor='#A32D2D';rn.style.background='var(--red-lt)';}
  const sc=document.getElementById('surf-color');if(sc)sc.value='';
  _swResetColorUI();
  surfWhatSelected=[];surfRoom='';surfColor='';surfBQueue=[];surfBIdx=0;surfBMeasurements={};
  document.querySelectorAll('.surf-what-btn').forEach(b=>{
    b.style.borderColor='';b.style.background='';b.style.color='';
  });
  // Clear any lingering scope checkboxes
  document.querySelectorAll('[id^="est-sc-"]').forEach(cb=>{cb.checked=false;});
  document.querySelectorAll('[id^="est-st-"]').forEach(el=>{el.classList.remove('on');});
  const _sa=document.getElementById('surf-step-a');_sa.style.display='';_sfShow(_sa,true);
  const nextBtn=document.getElementById('surf-next-to-dims');
  if(nextBtn){nextBtn.disabled=true;nextBtn.style.background='var(--border2)';nextBtn.style.color='var(--text3)';nextBtn.style.borderColor='var(--border2)';nextBtn.style.cursor='not-allowed';}
  document.getElementById('surf-card-title').textContent='New room';
  window.scrollTo(0,0);
  setTimeout(()=>{const rn2=document.getElementById('surf-room-name');if(rn2)rn2.focus();},100);
}

function initSurfStep(){
  renderSurfRoomsLogged();
  if(!surfJobType)setSurfJobType('interior');
  setSurfJobType(surfJobType); // refresh toggle state
  updateSurfWhatUI();
  if(estSurfaces.length>0){
    // Already have rooms — hide the empty add-room form, show the done-summary view
    document.getElementById('surf-step-a').style.display='none';
    document.getElementById('surf-step-b').style.display='none';
    let doneDiv=document.getElementById('surf-room-done');
    if(!doneDiv){
      doneDiv=document.createElement('div');
      doneDiv.id='surf-room-done';
      const stepB=document.getElementById('surf-step-b');
      if(stepB&&stepB.parentNode)stepB.parentNode.insertBefore(doneDiv,stepB.nextSibling);
    }
    const rooms=new Set(estSurfaces.map(s=>cleanRoomName(s.room)));
    doneDiv.style.display='block';
    doneDiv.innerHTML=
      '<div style="padding:14px 0 10px">'+
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">'+
          '<div style="font-size:28px;color:var(--green-mid)">✓</div>'+
          '<div style="font-size:16px;font-weight:800;color:var(--green-mid)">'+rooms.size+' room'+(rooms.size!==1?'s':'')+' loaded</div>'+
        '</div>'+
      '</div>'+
      '<div style="display:grid;gap:10px">'+
        '<button onclick="addAnotherRoom()" style="padding:14px;border-radius:var(--rl);border:2px solid var(--border2);background:var(--bg2);color:var(--text);font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">+ Add another room</button>'+
      '</div>';
    // Enable the next button
    const btn=document.getElementById('est-s3-next-btn');
    if(btn){btn.disabled=false;btn.style.background='var(--blue)';btn.style.color='#fff';btn.style.borderColor='var(--blue)';btn.style.cursor='pointer';}
    const rcl=document.getElementById('surf-room-count');if(rcl)rcl.textContent=rooms.size+' room'+(rooms.size!==1?'s':'')+' added';
  } else {
    goSurfStepA();
  }
}

// Backup used by editRoom so Cancel can restore surfaces
let _editRoomBackup=null;
function editRoom(roomName){
  // Load existing surfaces for this room back into the form
  const roomSurfs=estSurfaces.filter(s=>cleanRoomName(s.room)===roomName);
  if(!roomSurfs.length)return;
  // Backup the full surfaces array so Cancel can fully restore it
  _editRoomBackup={roomName,surfaces:[...estSurfaces]};
  // Remove existing surfaces for this room (they'll be re-added when user saves)
  estSurfaces=estSurfaces.filter(s=>cleanRoomName(s.room)!==roomName);
  // Reset the form to that room name
  const rn=document.getElementById('surf-room-name');
  if(rn){rn.value=roomName;rn.style.borderColor='';rn.style.background='';}
  // Re-select the surfaces that were in this room
  surfWhatSelected=[];
  roomSurfs.forEach(s=>{
    if(!surfWhatSelected.includes(s.type))surfWhatSelected.push(s.type);
  });
  updateSurfWhatUI();
  surfRoom=roomName;
  // Hide done div, show step A with a Cancel button
  const doneDiv=document.getElementById('surf-room-done');if(doneDiv)doneDiv.style.display='none';
  const _sa=document.getElementById('surf-step-a');_sa.style.display='';_sfShow(_sa,true);
  document.getElementById('surf-step-b').style.display='none';
  // Inject Cancel button near room name input so Zach can bail out safely
  const existingCancel=document.getElementById('_edit-room-cancel');
  if(!existingCancel){
    const cancelBtn=document.createElement('button');
    cancelBtn.id='_edit-room-cancel';
    cancelBtn.type='button';
    cancelBtn.textContent='✕ Cancel edit';
    cancelBtn.style.cssText='margin-top:8px;padding:8px 14px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text3);font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;width:100%';
    cancelBtn.onclick=cancelEditRoom;
    if(rn&&rn.parentElement)rn.parentElement.appendChild(cancelBtn);
  }
  // Update the next button
  const btn=document.getElementById('surf-next-to-dims');
  if(surfWhatSelected.length&&btn){btn.disabled=false;btn.style.background='var(--blue)';btn.style.color='#fff';btn.style.borderColor='var(--blue)';btn.style.cursor='pointer';}
  renderEstSurfs();renderEstRunning();renderSurfRoomsLogged();
  // Scroll to top
  const s3=document.getElementById('est-s3');if(s3)s3.scrollIntoView({behavior:'smooth',block:'start'});
}
function cancelEditRoom(){
  if(_editRoomBackup){estSurfaces=[..._editRoomBackup.surfaces];_editRoomBackup=null;}
  document.getElementById('_edit-room-cancel')?.remove();
  const _pgEstC=document.getElementById('pg-est');if(_pgEstC)_pgEstC.style.overflowY='';
  document.getElementById('surf-step-b').style.display='none';
  initSurfStep();renderEstSurfs();renderEstRunning();renderSurfRoomsLogged();
}

function renderSurfRoomsLogged(){
  const el=document.getElementById('surf-rooms-logged');if(!el)return;
  if(!estSurfaces.length){el.innerHTML='';return;}
  const roomMap={};
  const surfTypeNames=['walls','ceiling','trim','doors','windows','cabinets','ext_walls','ext_trim','deck'];
  estSurfaces.forEach(s=>{
    // Strip surface type suffix from room name if it got appended (legacy data fix)
    let rawBase=cleanRoomName(s.room);
    surfTypeNames.forEach(t=>{if(rawBase.endsWith(' '+t))rawBase=rawBase.slice(0,-(t.length+1)).trim();});
    const base=rawBase||'Other';
    if(!roomMap[base])roomMap[base]=[];
    const t=SURF_TYPES.find(x=>x.v===s.type)||{l:s.type,unit:''};
    roomMap[base].push(t.l+': '+s.qty.toLocaleString()+(t.unit?' '+t.unit:''));
  });
  el.innerHTML=Object.entries(roomMap).map(([room,lines])=>
    '<div style="display:flex;justify-content:space-between;align-items:center;background:var(--green-lt);border:1px solid var(--green);border-radius:var(--r);padding:8px 12px;margin-bottom:6px">'+
      '<div>'+
        '<div style="font-size:12px;font-weight:700;color:var(--green-mid)">'+escHtml(room)+'</div>'+
        '<div style="font-size:11px;color:var(--text3)">'+lines.join(' · ')+'</div>'+
      '</div>'+
      '<div style="display:flex;gap:6px;flex-shrink:0;margin-left:8px">'+
      '<button data-room="'+encodeURIComponent(room)+'" onclick="editRoomSurfs(decodeURIComponent(this.dataset.room))" style="font-size:11px;padding:3px 8px;border-radius:var(--r);border:1px solid var(--green);background:#fff;color:var(--green-mid);cursor:pointer;font-weight:600;font-family:inherit">Edit</button>'+
      '<button data-room="'+encodeURIComponent(room)+'" onclick="removeRoomSurfs(decodeURIComponent(this.dataset.room))" style="border:none;background:none;cursor:pointer;font-size:16px;color:var(--text3);padding:0">✕</button>'+
      '</div>'+
    '</div>'
  ).join('');
}

function removeRoomSurfs(roomBase){
  estSurfaces=estSurfaces.filter(s=>{
    const base=cleanRoomName(s.room);
    return base!==roomBase;
  });
  // Also clear scope for this room
  if(roomScopeMap[roomBase])delete roomScopeMap[roomBase];
  renderEstSurfs();renderEstRunning();saveSurfDraft();renderSurfRoomsLogged();
  if(!estSurfaces.length){
    const btn=document.getElementById('est-s3-next-btn');
    if(btn){btn.disabled=true;btn.style.background='var(--border2)';btn.style.color='var(--text3)';btn.style.borderColor='var(--border2)';btn.style.cursor='not-allowed';}
  }
  const rooms=new Set(estSurfaces.map(s=>cleanRoomName(s.room)));
  const rcl=document.getElementById('surf-room-count');if(rcl)rcl.textContent=rooms.size>0?rooms.size+' room'+(rooms.size!==1?'s':'')+' added':'';
}

function editRoomSurfs(roomBase){
  // Remove surfaces for this room — preserve scope
  const existingSurfs=estSurfaces.filter(s=>cleanRoomName(s.room)===roomBase);
  estSurfaces=estSurfaces.filter(s=>cleanRoomName(s.room)!==roomBase);
  renderEstSurfs();renderEstRunning();saveSurfDraft();renderSurfRoomsLogged();
  // Hide saved state
  const doneDiv=document.getElementById('surf-room-done');
  if(doneDiv)doneDiv.style.display='none';
  const _sa=document.getElementById('surf-step-a');_sa.style.display='';_sfShow(_sa,true);
  document.getElementById('surf-step-b').style.display='none';
  // Pre-fill room name
  const rn=document.getElementById('surf-room-name');
  if(rn){rn.value=roomBase;rn.style.borderColor='var(--green)';rn.style.background='var(--green-lt)';onSurfRoomName(rn);}
  // Restore surface type selections
  surfWhatSelected=existingSurfs.map(s=>s.type).filter((v,i,a)=>a.indexOf(v)===i);
  updateSurfWhatUI();
  // Update title
  const title=document.getElementById('surf-card-title');
  if(title)title.textContent='Editing: '+roomBase;
  // Scroll to room card
  const card=document.getElementById('surf-room-card');
  if(card)card.scrollIntoView({behavior:'smooth',block:'start'});
  // Keep scope for this room intact — note to user
  zAlert('Room loaded for editing. Surface types are pre-selected. Re-enter measurements and colors — scope items are preserved.',{title:'Editing: '+roomBase});
}

let lastSurfType='walls';
function removeEstSurf(id){
  estSurfaces=estSurfaces.filter(s=>s.id!==id);
  renderEstSurfs();renderEstRunning();saveSurfDraft();
  const btn=document.getElementById('est-s3-next-btn');
  if(btn){
    if(estSurfaces.length>0){btn.disabled=false;btn.style.background='var(--blue)';btn.style.color='#fff';btn.style.borderColor='var(--blue)';btn.style.cursor='pointer';}
    else{btn.disabled=true;btn.style.background='var(--bg2)';btn.style.color='var(--text3)';btn.style.borderColor='var(--border)';btn.style.cursor='not-allowed';}
  }
}
function updateEstSurf(id,key,val){
  const s=estSurfaces.find(x=>x.id===id);if(!s)return;
  if(key==='qty'){s.qty=parseFloat(val)||0;renderEstRunning();}
  else if(key==='room'){s.room=val;}
  else{s.type=val;lastSurfType=val;renderEstSurfs();renderEstRunning();}
  saveSurfDraft();
}
function updateEstSurfType(id,val){
  const s=estSurfaces.find(x=>x.id===id);if(!s)return;
  s.type=val;lastSurfType=val;renderEstSurfs();renderEstRunning();saveSurfDraft();
}
function updateEstSurfQty(id,val){
  const s=estSurfaces.find(x=>x.id===id);if(!s)return;
  s.qty=parseFloat(val)||0;renderEstRunning();saveSurfDraft();
}
function updateSurfRoom(id,val){
  const s=estSurfaces.find(x=>x.id===id);if(!s)return;
  s.room=val;saveSurfDraft();
}
function toggleLxH(id){
  const s=estSurfaces.find(x=>x.id===id);if(!s)return;
  s.lxhOpen=!s.lxhOpen;
  const el=document.getElementById('lxh-'+id);
  if(el)el.classList.toggle('open',s.lxhOpen);
}
function calcLxH(id){
  const l=parseFloat(document.getElementById('lxh-l-'+id).value)||0;
  const h=parseFloat(document.getElementById('lxh-h-'+id).value)||0;
  if(!l||!h)return;
  const sqft=Math.round(l*h);
  const s=estSurfaces.find(x=>x.id===id);if(!s)return;
  s.qty=sqft;s.lxhOpen=false;
  const qel=document.getElementById('sqft-'+id);if(qel)qel.value=sqft;
  const lxhEl=document.getElementById('lxh-'+id);if(lxhEl)lxhEl.classList.remove('open');
  renderEstRunning();saveSurfDraft();
  const next=estSurfaces.find(x=>x.id!==id&&(!x.qty||x.qty===0));
  if(next){const nel=document.getElementById('sqft-'+next.id);if(nel){nel.focus();nel.select();}}
}
function previewLxH(id){
  const l=parseFloat(document.getElementById('lxh-l-'+id).value)||0;
  const h=parseFloat(document.getElementById('lxh-h-'+id).value)||0;
  const el=document.getElementById('lxh-prev-'+id);
  if(el)el.textContent=l&&h?'= '+Math.round(l*h)+' sf':'';
}

function renderEstSurfs(){
  const el=document.getElementById('est-surf-list');
  if(!el)return; // new UI doesn't have this element — handled by renderSurfRoomsLogged
  if(!estSurfaces.length){
    el.innerHTML='<div class="empty">Tap <strong>Interior</strong> or <strong>Exterior</strong> above to load common surfaces,<br>or tap <strong>+ Add</strong> to add one at a time.</div>';
    return;
  }
  el.innerHTML=estSurfaces.map(s=>{
    const t=SURF_TYPES.find(x=>x.v===s.type)||SURF_TYPES[0];
    const unitLabel=t.unit;
    const isSqFt=unitLabel==='sq ft';
    const hasQty=s.qty>0;
    return '<div class="surf-row" style="'+(hasQty?'border-left:3px solid var(--green)':'border-left:3px solid var(--border2)')+'">'+
      '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;justify-content:space-between">'+
        '<input id="room-'+s.id+'" value="'+escHtml(s.room||'')+'" placeholder="Room or area name (e.g. Master bedroom)" '+
          'onchange="updateSurfRoom('+s.id+',this.value)" onblur="updateSurfRoom('+s.id+',this.value)" '+
          'style="font-size:13px;font-weight:600;border:none;background:transparent;padding:0;flex:1;color:var(--text)">'+
        '<button class="btn-del" onclick="removeEstSurf('+s.id+')" style="font-size:12px;padding:2px 6px;flex-shrink:0">&#10005;</button>'+
      '</div>'+
      '<div style="display:grid;grid-template-columns:1.4fr 1fr;gap:8px">'+
        '<div class="f" style="margin:0">'+
          '<label style="font-size:10px">Surface type</label>'+
          '<select onchange="updateEstSurfType('+s.id+',this.value)" style="font-size:13px;padding:8px 10px">'+
            SURF_TYPES.map(tp=>'<option value="'+tp.v+'"'+(s.type===tp.v?' selected':'')+'>'+tp.l+'</option>').join('')+
          '</select>'+
        '</div>'+
        '<div class="f" style="margin:0">'+
          '<label style="font-size:10px">'+unitLabel+(isSqFt?' &nbsp;<button class="lxh-btn" onclick="toggleLxH('+s.id+')">L&times;H</button>':'')+'</label>'+
          '<input type="number" id="sqft-'+s.id+'" value="'+(s.qty||'')+'" min="0" placeholder="0" '+
            'onchange="updateEstSurfQty('+s.id+',this.value)" onblur="updateEstSurfQty('+s.id+',this.value)" '+
            'style="font-size:18px;padding:8px 10px;font-weight:700;'+(hasQty?'border-color:var(--green);background:var(--green-lt)':'')+'">'+
        '</div>'+
      '</div>'+
      (isSqFt?
        '<div class="lxh-modal'+(s.lxhOpen?' open':'')+'" id="lxh-'+s.id+'" style="margin-top:8px">'+
          '<div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:6px">Multiply length × height</div>'+
          '<div style="display:grid;grid-template-columns:1fr 14px 1fr auto;gap:6px;align-items:end">'+
            '<div class="f" style="margin:0"><label style="font-size:10px">Length (ft)</label>'+
              '<input type="number" id="lxh-l-'+s.id+'" placeholder="0" min="0" step="0.5" oninput="previewLxH('+s.id+')" style="font-size:16px;padding:8px 10px">'+
            '</div>'+
            '<div style="font-size:18px;color:var(--text3);padding-bottom:6px;text-align:center">&times;</div>'+
            '<div class="f" style="margin:0"><label style="font-size:10px">Height (ft)</label>'+
              '<input type="number" id="lxh-h-'+s.id+'" placeholder="0" min="0" step="0.5" oninput="previewLxH('+s.id+')" style="font-size:16px;padding:8px 10px">'+
            '</div>'+
            '<div style="padding-bottom:6px;text-align:center">'+
              '<div id="lxh-prev-'+s.id+'" style="font-size:11px;font-weight:700;color:var(--blue);min-width:44px"></div>'+
            '</div>'+
          '</div>'+
          '<div class="brow" style="margin-top:6px">'+
            '<button class="btn btn-p btn-sm" onclick="calcLxH('+s.id+')">Use &#10003;</button>'+
            '<button class="btn btn-sm" onclick="toggleLxH('+s.id+')">Cancel</button>'+
          '</div>'+
        '</div>'
      :'')+
    '</div>';
  }).join('');
}

function saveSurfDraft(){
  try{
    localStorage.setItem('zp3_surf_draft',JSON.stringify({surfaces:estSurfaces,clientId:estLinkedClientId,ts:Date.now()}));
    const note=document.getElementById('surf-draft-note');
    if(note){note.style.display='block';clearTimeout(note._t);note._t=setTimeout(()=>note.style.display='none',2000);}
  }catch(e){}
}
function loadSurfDraft(){
  try{
    const raw=localStorage.getItem('zp3_surf_draft');if(!raw)return false;
    const d=JSON.parse(raw);
    if(d.clientId!==estLinkedClientId)return false;
    if(Date.now()-d.ts>86400000)return false;
    if(!d.surfaces||!d.surfaces.length)return false;
    estSurfaces=d.surfaces;estSurfId=Math.max(0,...estSurfaces.map(s=>s.id))+1;
    return true;
  }catch(e){return false;}
}
function clearSurfDraftAndReset(){
  estSurfaces=[];estSurfId=0;
  renderEstSurfs();renderEstRunning();renderSurfRoomsLogged();clearSurfDraft();
  ['est-s3-next-btn','laser-review-btn','manual-review-btn'].forEach(id=>{
    const btn=document.getElementById(id);if(!btn)return;
    btn.disabled=true;btn.style.background='var(--border2)';
    btn.style.color='var(--text3)';btn.style.borderColor='var(--border2)';btn.style.cursor='not-allowed';
  });
}
function clearSurfDraft(){try{localStorage.removeItem('zp3_surf_draft');}catch(e){}}
function validateJobSettings(){
  const el=document.getElementById('e-days');if(!el)return;
  const v=parseInt(el.value)||0;
  if(v>60){el.value=60;}
  if(v<0){el.value='';}
  const filled=el.value&&el.value!=='';
  el.style.borderColor=filled?'var(--border2)':'#A32D2D';
  el.style.background=filled?'var(--bg2)':'var(--red-lt)';
  checkStep1Ready();
}

// ── Guided step navigation — validates before any forward jump ───────────
function runStep1Validation(){
  const checks=[{id:'e-cname',label:'Client name'},{id:'e-cphone',label:'Phone number'},{id:'e-caddr',label:'Property address'}];
  let firstBad=null;
  for(const {id,label} of checks){
    const el=document.getElementById(id);if(!el)continue;
    const val=(el.value||'').trim();
    const ok=id==='e-cphone'?val.replace(/\D/g,'').length>=10:val.length>0;
    if(!ok){
      el.style.borderColor='#A32D2D';el.style.background='var(--red-lt)';
      // Show inline hint below field
      let errDiv=document.getElementById('err-'+id);
      if(!errDiv){errDiv=document.createElement('div');errDiv.id='err-'+id;errDiv.style.cssText='font-size:11px;color:#A32D2D;margin-top:3px';el.parentElement.appendChild(errDiv);}
      errDiv.textContent=label+' is required.';
      if(!firstBad)firstBad=el;
    }
  }
  if(firstBad){firstBad.scrollIntoView&&firstBad.scrollIntoView({behavior:'smooth',block:'center'});firstBad.focus();return false;}
  return true;
}
function runStep2Validation(){return true;}

// ── Full estimator draft: all step 1+2 fields survive navigation ─────────
function saveEstFullDraft(){
  try{
    // Collect scope rates
    const scopeRates={};
    SCOPE_ITEMS.forEach(sc=>{
      const el=document.getElementById(sc.rateKey);
      if(el)scopeRates[sc.id]=el.value;
    });
    const draft={
      ts:Date.now(),
      clientId:estLinkedClientId,
      cname:document.getElementById('e-cname')?.value||'',
      cphone:document.getElementById('e-cphone')?.value||'',
      caddr:document.getElementById('e-caddr')?.value||'',
      cprop:document.getElementById('e-cprop')?.value||'',
      cnotes:document.getElementById('e-cnotes')?.value||'',
      days:document.getElementById('e-days')?.value||'',
      paint:document.getElementById('e-paint')?.value||'',
      cond:document.getElementById('e-cond')?.value||'',
      scope:SCOPE_ITEMS.reduce((o,s)=>{o[s.id]=!!scopeOn(s.id);return o;},{}),
      scopeHrs:{...scopeHrsStore},
      roomScopeMap:{...JSON.parse(JSON.stringify(roomScopeMap))},
      scopeRates,
      rWalls:document.getElementById('e-r-walls')?.value||'',
      rCeil:document.getElementById('e-r-ceil')?.value||'',
      rTrim:document.getElementById('e-r-trim')?.value||'',
      rDoor:document.getElementById('e-r-door')?.value||'',
      rWin:document.getElementById('e-r-win')?.value||'',
      rExt:document.getElementById('e-r-ext')?.value||'',
      rDeck:document.getElementById('e-r-deck')?.value||'',
      paintRate:document.getElementById('e-paint-rate')?.value||'',
      adj:document.getElementById('est-adj')?.value||'0',
      adjType:document.getElementById('adj-type-hidden')?.value||'',
      adjReason:document.getElementById('adj-reason-hidden')?.value||'',
      isPortfolio:document.getElementById('portfolio-toggle')?.checked||false,
      portfolioPct:parseInt(document.getElementById('portfolio-pct')?.value)||15,
      portfolioTarget:parseInt(document.getElementById('portfolio-target')?.value)||5,
      step:estStep,
      surfaces:estSurfaces,
      lastBidId:lastCreatedBidId||editingBidId,
    };
    localStorage.setItem('zp3_est_full_draft',JSON.stringify(draft));
  }catch(e){}
  _paintEstAutosaveDebounced();
}
let _paintEstAutosaveTimer=null;
function _paintEstAutosaveDebounced(){
  // SYNCHRONOUS — no setTimeout. A delayed save can lose a race against navigation
  // (clearEstimatorForm empties e-cname, so the deferred save bails and the rooms are
  // never written). Saving inline on every mutation guarantees the bid is always
  // persisted before the user can navigate or the PWA can refresh.
  clearTimeout(_paintEstAutosaveTimer);
  _paintEstAutosave();
}
function _paintEstAutosave(){
  const cname=(document.getElementById('e-cname')?.value||'').trim();
  if(!cname)return;
  const {final}=(typeof calcEst==='function')?calcEst():{final:0};
  const surfaces=typeof estSurfaces!=='undefined'?[...estSurfaces]:[];
  const rmMap=(typeof roomScopeMap!=='undefined'&&roomScopeMap)?JSON.parse(JSON.stringify(roomScopeMap)):{};
  const ss={};if(typeof SCOPE_ITEMS!=='undefined')SCOPE_ITEMS.forEach(s=>{ss[s.id]=!!scopeOn(s.id);});
  const bidData={
    client_id:estLinkedClientId||null,
    client_name:cname,name:cname,
    phone:document.getElementById('e-cphone')?.value||'',
    addr:document.getElementById('e-caddr')?.value||'',
    notes:document.getElementById('e-cnotes')?.value||'',
    bid_date:todayKey(),
    amount:final||0,
    type:(typeof getBidIncomeLabel==='function'?getBidIncomeLabel({surfaces}):null)||'Interior/Exterior Painting',
    status:'Draft',draft:true,
    surfaces,roomScopeMap:rmMap,scope:ss,
    cond:document.getElementById('e-cond')?.value||'',
    paint:document.getElementById('e-paint')?.value||'',
    updated:Date.now(),
  };
  // Guard: never let an autosave blank out an existing bid's measurements/rooms.
  // If the live estimator state has no surfaces/rooms but the saved bid does (e.g. an
  // autosave fires mid-load before surfaces are restored), preserve the saved data.
  const _applyData=(b)=>{
    const d={...bidData};
    if((!d.surfaces||!d.surfaces.length)&&Array.isArray(b.surfaces)&&b.surfaces.length)delete d.surfaces;
    if((!d.roomScopeMap||!Object.keys(d.roomScopeMap).length)&&b.roomScopeMap&&Object.keys(b.roomScopeMap).length)delete d.roomScopeMap;
    Object.assign(b,d);
  };
  // Case 1: editing an existing bid — always update it, never mint a new one
  if(editingBidId){
    const b=typeof bids!=='undefined'?bids.find(x=>x.id===editingBidId):null;
    if(b){_applyData(b);saveAll();}
    return;
  }
  // Case 2: we already created a draft this session — update it
  if(lastCreatedBidId){
    const b=typeof bids!=='undefined'?bids.find(x=>x.id===lastCreatedBidId):null;
    if(b&&(b.draft||b.status==='Draft')){_applyData(b);saveAll();return;}
  }
  // Case 3: no active bid — recover an orphan draft before minting a new one
  if(typeof bids!=='undefined'){
    const _orphan=bids.find(b=>(b.draft||b.status==='Draft')&&!b.signingToken&&
      (estLinkedClientId?b.client_id===estLinkedClientId:b.name===cname));
    if(_orphan){lastCreatedBidId=_orphan.id;Object.assign(_orphan,bidData);saveAll();return;}
    const draftBid={id:_newBidId(),followup:addDays(todayKey(),3),completion_date:'',collStage:'none',collHistory:[],...bidData};
    bids.unshift(draftBid);lastCreatedBidId=draftBid.id;saveAll();
  }
}
function loadEstFullDraft(){
  try{const raw=localStorage.getItem('zp3_est_full_draft');if(!raw)return false;
    const d=JSON.parse(raw);if(Date.now()-d.ts>86400000*2)return false;return d;}
  catch(e){return false;}
}
function resumeEstimateDraft(){
  const d=loadEstFullDraft();
  if(!d){zAlert('Draft not found.',{title:'Nothing to resume'});return;}
  // Navigate first, then restore after the page settles
  goPg('pg-est');
  setTimeout(()=>{
    // Restore linked client and bid IDs before anything else
    estLinkedClientId=d.clientId||null;
    editingBidId=null;
    if(d.lastBidId)lastCreatedBidId=d.lastBidId;
    restoreEstFullDraft(d);
    goEstStep(d.step||1);
  },80);
}
// Inspect the frozen boot snapshot + live drafts for the richest unsaved estimate.
// Returns {surf, rooms, cname} of the best recoverable copy, or null. Read-only.
function _scanRecoverableEstimate(){
  const sources=[];
  const _addDraft=(raw)=>{if(!raw)return;try{const d=JSON.parse(raw);if(d&&typeof d==='object'&&!Array.isArray(d))sources.push(d);}catch(_e){}};
  const _addSurf=(raw)=>{if(!raw)return;try{const d=JSON.parse(raw);if(d&&Array.isArray(d.surfaces))sources.push({surfaces:d.surfaces,_surfOnly:true});}catch(_e){}};
  let snap=null;try{snap=JSON.parse(localStorage.getItem('zp3_recovery_snapshot')||'null');}catch(_e){}
  if(snap){_addDraft(snap.est_full_draft);_addSurf(snap.surf_draft);}
  _addDraft(localStorage.getItem('zp3_est_full_draft'));
  _addSurf(localStorage.getItem('zp3_surf_draft'));
  // Base = the full draft with the most surfaces; graft in a richer surf-only list if found.
  let base=null,maxSurf=-1;
  sources.forEach(s=>{if(!s._surfOnly){const n=(s.surfaces||[]).length;if(n>maxSurf){maxSurf=n;base=s;}}});
  let bestSurf=base?(base.surfaces||[]):[];
  sources.forEach(s=>{if((s.surfaces||[]).length>bestSurf.length)bestSurf=s.surfaces;});
  if(!base&&bestSurf.length)base={surfaces:bestSurf};
  if(!base)return null;
  base={...base,surfaces:bestSurf};
  const surf=(base.surfaces||[]).length;
  const rooms=base.roomScopeMap?Object.keys(base.roomScopeMap).length:0;
  if(!surf&&!rooms)return null;
  return {draft:base,surf,rooms,cname:base.cname||''};
}
// Rebuild the estimator from the best recoverable copy (snapshot preferred). For an
// estimate that was never saved as a bid — the room measurements live only in the
// draft storage, which the boot snapshot froze before any overwrite.
function recoverLostEstimate(){
  const found=_scanRecoverableEstimate();
  if(!found){if(typeof zAlert==='function')zAlert("No recoverable estimate found in this device's backup.",{title:'Nothing to recover'});return false;}
  const base=found.draft;
  goPg('pg-est');
  setTimeout(()=>{
    estLinkedClientId=base.clientId||null;editingBidId=null;
    if(base.lastBidId)lastCreatedBidId=base.lastBidId;
    restoreEstFullDraft(base);
    goEstStep(base.step||3);
    try{renderEstSurfs();}catch(_e){}
    try{renderEstRunning();}catch(_e){}
    if(typeof showToast==='function')showToast('Recovered '+found.surf+' surfaces · '+found.rooms+' rooms','✅');
  },90);
  return true;
}
window.recoverLostEstimate=recoverLostEstimate;
window._scanRecoverableEstimate=_scanRecoverableEstimate;

function restoreEstFullDraft(d){
  if(!d)return false;
  estLinkedClientId=d.clientId||null;
  if(d.lastBidId)lastCreatedBidId=d.lastBidId;
  const set=(id,val)=>{const el=document.getElementById(id);if(el&&val!=null)el.value=val;};
  set('e-cname',d.cname);set('e-cphone',d.cphone);set('e-caddr',d.caddr);
  set('e-cprop',d.cprop);set('e-cnotes',d.cnotes);set('e-days',d.days);
  set('est-adj',d.adj);set('adj-type-hidden',d.adjType||'');set('adj-reason-hidden',d.adjReason||'');
  if(d.adjReason&&d.adj&&parseInt(d.adj)!==0){const s=document.getElementById('adj-reason-summary');const st=document.getElementById('adj-reason-summary-text');if(s)s.style.display='flex';if(st)st.textContent=d.adjReason+' ('+d.adj+'%)';}
  else{const s=document.getElementById('adj-reason-summary');if(s)s.style.display='none';}
  if(d.portfolioPct!=null){const el=document.getElementById('portfolio-pct');if(el)el.value=d.portfolioPct;}
  if(d.portfolioTarget!=null){const el=document.getElementById('portfolio-target');if(el)el.value=d.portfolioTarget;}
  const _ptog=document.getElementById('portfolio-toggle');
  if(_ptog&&d.isPortfolio!=null){_ptog.checked=!!d.isPortfolio;togglePortfolioShowcase();}
  // Restore surface rates
  if(d.rWalls)set('e-r-walls',d.rWalls);
  if(d.rCeil)set('e-r-ceil',d.rCeil);
  if(d.rTrim)set('e-r-trim',d.rTrim);
  if(d.rDoor)set('e-r-door',d.rDoor);
  if(d.rWin)set('e-r-win',d.rWin);
  if(d.rExt)set('e-r-ext',d.rExt);
  if(d.rDeck)set('e-r-deck',d.rDeck);
  if(d.paintRate)set('e-paint-rate',d.paintRate);
  // Restore scope rates
  if(d.scopeRates){SCOPE_ITEMS.forEach(sc=>{if(d.scopeRates[sc.id])set(sc.rateKey,d.scopeRates[sc.id]);});}
  // Restore scopeHrsStore
  if(d.scopeHrs)scopeHrsStore={...d.scopeHrs};
  if(d.roomScopeMap)roomScopeMap=JSON.parse(JSON.stringify(d.roomScopeMap));
  if(d.paint){
    const el=document.getElementById('e-paint');if(el)el.value=d.paint;
    setPaintSupply(d.paint==='customer'?'customer':'zach');
  }
  if(d.cond){
    const condMap={'1.0':'good','1.2':'fair','1.5':'poor'};
    const el=document.getElementById('e-cond');if(el)el.value=d.cond;
    const btn=document.getElementById('cond-'+condMap[d.cond]);
    if(btn){document.querySelectorAll('[id^=cond-]').forEach(b=>b.classList.remove('active-surf-btn'));btn.classList.add('active-surf-btn');}
  }
  if(d.scope){
    // Restore into maps first — DOM gets synced when buildScopeGrid() runs
    SCOPE_ITEMS.forEach(s=>{scopeActiveMap[s.id]=!!d.scope[s.id];});
  }

  // Sync DOM if scope grid is currently rendered
  buildScopeGrid(_currentScopeRoom||undefined);
  if(d.surfaces&&d.surfaces.length){
    estSurfaces=d.surfaces;
    estSurfId=Math.max(0,...estSurfaces.map(s=>s.id))+1;
  }
  // Update client display
  const c=estLinkedClientId?getClientById(estLinkedClientId):null;
  const linked=document.getElementById('e-client-linked');
  if(linked&&c)linked.innerHTML='<span class="conn-tag">'+escHtml(c.name)+'</span>';
  ['e-cname','e-cphone','e-caddr','e-days'].forEach(id=>markFieldFilled(document.getElementById(id)));
  checkStep1Ready();checkStep2Ready();
  return true;
}
function clearEstFullDraft(){
  try{localStorage.removeItem('zp3_est_full_draft');}catch(e){}
  // Remove the draft bid created when estimate opened (if not yet confirmed)
  if(lastCreatedBidId){
    const idx=bids.findIndex(b=>b.id===lastCreatedBidId&&b.draft);
    if(idx>-1){bids.splice(idx,1);saveAll();}
    lastCreatedBidId=null;
  }
  editingBidId=null;
}

// ── Income type helper — derives correct label from bid surfaces ─────────
function getBidIncomeLabel(bid){
  if(!bid)return 'Painting job';
  if(bid.type&&bid.type!=='Painting job')return bid.type;
  const surfs=bid.surfaces||[];
  const hasExt=surfs.some(s=>s.type&&(s.type.startsWith('ext')||s.type==='deck'));
  const hasCab=surfs.some(s=>s.type==='cabinets');
  if(hasExt)return 'Exterior painting';
  if(hasCab)return 'Cabinet painting';
  return 'Interior painting';
}
function calcEst(){
  const gR=id=>parseFloat(document.getElementById(id)?.value)||0;
  const R={
    walls:   gR('e-r-walls')||S.rWalls||1.30,
    ceiling: gR('e-r-ceil') ||S.rCeil ||1.00,
    trim:    gR('e-r-trim') ||S.rTrim ||3.25,
    doors:   gR('e-r-door') ||S.rDoor ||95,
    windows: gR('e-r-win')  ||S.rWin  ||50,
    cabinets:38,
    ext_walls:gR('e-r-ext') ||S.rExt  ||1.10,
    ext_trim: gR('e-r-trim')||S.rTrim ||3.25,
    deck:    gR('e-r-deck') ||S.rDeck ||1.00,
  };
  // 83 = ProMar 200 retail; 81 = Duration Exterior retail — client-facing prices, not contractor cost
  const paintCostPerGal=gR('e-paint-rate')||(estSurfaces.some(s=>s.type==='ext_walls'||s.type==='ext_trim'||s.type==='deck')?81:83);
  const customerPaint=document.getElementById('e-customer-paint')?.value==='1'||false;
  const cov=COVERAGE();const matMark=MATMARK();const coats=(scopeOn('twocoat')||Object.values(roomScopeMap||{}).some(r=>r.twocoat?.active))?2:1;
  let laborTotal=0,totalLaborHours=0;const lines=[];
  estSurfaces.forEach(s=>{
    if(!s.qty)return;const t=SURF_TYPES.find(x=>x.v===s.type);if(!t)return;
    const rate=R[s.type]||t.rate||0;
    // Walls/ext_walls: use actual wall sqft (perimeter×height) — industry standard for labor pricing.
    // Ceiling/deck/trim: use qty as entered. Coats not in labor — twocoat scope handles it.
    const laborQty=(s.type==='walls'||s.type==='ext_walls')?(s.wallSqft||s.qty):s.qty;
    const cost=Math.round(laborQty*rate*100)/100;
    laborTotal+=cost;
    // Hours: qty × hrs-per-unit × coats — direct production-rate calc, no price math involved
    totalLaborHours+=laborQty*(t.hpu||0)*coats;
    // Build label: SurfaceType · Room · Color [Finish]
    const _roomBase=cleanRoomName(s.room)||'';
    const _afterDash=(s.room||'').indexOf(' — ')>-1?(s.room||'').split(' — ').slice(1).join(' — '):'';
    const _colorFinish=_afterDash?(' · '+_afterDash):'';
    const _lineLabel=(t.l||s.type)+(_roomBase?' · '+_roomBase:'')+_colorFinish;
    lines.push({label:_lineLabel,qty:s.qty,unit:t.unit,sub:cost,surfType:t.l,room:_roomBase,colorFinish:_afterDash});
  });
  SCOPE_ITEMS.forEach(sc=>{
    // Auto-calculate scope cost from ratePerSqFt + flatRate — no hours needed
    const roomsWithScope=Object.keys(roomScopeMap).filter(r=>roomScopeMap[r][sc.id]&&roomScopeMap[r][sc.id].active);
    if(roomsWithScope.length>0){
      let totalCost=0;
      roomsWithScope.forEach(roomName=>{
        // Get total sqft for this room from surfaces
        const roomSqFt=estSurfaces.filter(s=>cleanRoomName(s.room)===roomName&&
          (s.type==='walls'||s.type==='ceiling'||s.type==='ext_walls'||s.type==='deck'))
          .reduce((sum,s)=>sum+(s.qty||0),0);
        const roomCost=Math.round(((sc.ratePerSqFt||0)*roomSqFt+(sc.flatRate||0))*100)/100;
        totalCost+=roomCost;
      });
      if(totalCost>0){
        laborTotal+=totalCost;
        lines.push({label:sc.label,qty:roomsWithScope.length,unit:roomsWithScope.length>1?'rooms':'room',sub:totalCost,isScopeItem:true});
      }
    }
  });
  totalLaborHours=Math.round(totalLaborHours*10)/10;
  // ── Per-product paint quantity calc ─────────────────────────
  // Helper: get coverage rate from product name stored in room string
  const _allSwProds=Object.values(SW_PRODUCTS).flat();
  function _prodCov(roomStr){
    const spec=(roomStr||'').indexOf(' — ')>-1?(roomStr||'').split(' — ').slice(1).join(' — '):'';
    const prodName=spec.split(' · ')[0].trim();
    if(!prodName)return COVERAGE();
    const p=_allSwProds.find(x=>x.name===prodName||x.name.toLowerCase()===prodName.toLowerCase());
    return p?.cov||COVERAGE();
  }
  function _prodContractorPrice(roomStr){
    // Use retail price — client is quoted retail; Zach's contractor discount is his margin to keep
    const spec=(roomStr||'').indexOf(' — ')>-1?(roomStr||'').split(' — ').slice(1).join(' — '):'';
    const prodName=spec.split(' · ')[0].trim();
    if(!prodName)return paintCostPerGal;
    const p=_allSwProds.find(x=>x.name===prodName||x.name.toLowerCase()===prodName.toLowerCase());
    return (p?swEffectivePrice(p).retail:null)||paintCostPerGal;
  }

  let matTotal=0;const paintLines=[];
  // Group by product+color combo (each unique product+color = separate order line)
  const orderMap={};
  let totalPaintSqFt=0;
  estSurfaces.forEach(s=>{
    if(!s.qty)return;const t=SURF_TYPES.find(x=>x.v===s.type);if(!t)return;
    // Convert non-sqft surfaces to sqft equivalent using material factor (mf)
    // e.g. trim: 1 lin ft × 0.4 mf = 0.4 sqft paintable; doors: 1 door × 20 mf = 20 sqft
    const paintSqft=t.unit==='sq ft'?(s.wallSqft||s.qty):s.qty*t.mf;
    if(!paintSqft)return;
    totalPaintSqFt+=(t.unit==='sq ft'?s.qty:paintSqft);
    const spec=(s.room||'').indexOf(' — ')>-1?(s.room||'').split(' — ').slice(1).join(' — '):'';
    const key=spec||'Paint';
    const roomName=cleanRoomName(s.room)||'';
    if(!orderMap[key])orderMap[key]={sqFt:0,cov:_prodCov(s.room),price:_prodContractorPrice(s.room),spec,surfaces:[],rooms:[]};
    orderMap[key].sqFt+=paintSqft;
    orderMap[key].surfaces.push({type:s.type,qty:s.qty});
    if(roomName&&!orderMap[key].rooms.includes(roomName))orderMap[key].rooms.push(roomName);
  });
  Object.entries(orderMap).forEach(([key,od])=>{
    // Round up to nearest half-gallon, add 15% waste
    const rawGals=od.sqFt*coats/od.cov*1.15;
    const gals=Math.ceil(rawGals*2)/2;
    const wholeCans=Math.ceil(gals);
    // Per-room customer paint — if ANY room in this order group is customer-paint, flag it
    const isRoomCustomer=od.rooms&&od.rooms.length>0
      ?od.rooms.every(r=>roomScopeMap[r]?._customerPaint===true)
      :customerPaint;
    const cost=isRoomCustomer?0:Math.round(wholeCans*od.price*matMark*100)/100;
    matTotal+=cost;
    paintLines.push({color:key,spec:od.spec,sqFt:Math.round(od.sqFt),gals,wholeCans,cost,customerPaint:isRoomCustomer,cov:od.cov});
  });
  // Add supplies cost (tape, plastic, drop cloths, primer, ram board) per sq ft
  const suppliesRate=gR('e-supplies-rate')||S.suppliesRate||0.25;
  const suppliesCost=Math.round(totalPaintSqFt*suppliesRate*100)/100;
  if(suppliesCost>0)matTotal+=suppliesCost;
  const flatAdd=0;const scopeFlats=[];
  const adjPct=parseInt(v('est-adj'))||0;
  // 7% contingency baked silently into labor (industry standard callback buffer)
  // Property tier multiplier applied to total (set by selectPropertyTier in step 2)
  const tierMult=(typeof estPropertyTier!=='undefined'&&estPropertyTier.mult)||1.00;
  const base=Math.round((laborTotal+matTotal)*tierMult*100)/100;
  const adj=Math.round(base*(adjPct/100)*100)/100;
  const final=Math.max(0,Math.round((base+adj)*100)/100);
  return{lines,laborTotal,matTotal,suppliesCost,customerPaint,flatAdd,scopeFlats,colorAdd:0,travel:0,base,bid:final,adj,final,
    profit:0,margin:0,paintLines,totalPaintSqFt,coats,totalLaborHours,laborRate:R.walls,paintCostPerGal,R};
}
function renderEstRunning(){
  const el=document.getElementById('est-running');if(!el)return;
  const{lines,bid,laborTotal,matTotal}=calcEst();
  if(!lines.length){el.innerHTML='<div class="empty">Add surfaces to see pricing.</div>';return;}
  const tierMult=(typeof estPropertyTier!=='undefined'&&estPropertyTier.mult)||1.00;
  const subtotal=Math.round((laborTotal+matTotal)*100)/100;
  const tierPremium=tierMult!==1.00?Math.round((bid-subtotal)*100)/100:0;
  let html='<div style="display:grid;grid-template-columns:1fr auto auto;gap:4px 12px;font-size:12px">';
  lines.forEach(l=>{
    if(l.surfType){
      // Surface line: type bold, room + color+finish smaller below
      const hexMatch=l.colorFinish&&_swColors?(_swColors.find(c=>l.colorFinish.includes(c.name))?.hex||''):'';
      const swatchHtml=hexMatch?'<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:'+hexMatch+';border:1px solid rgba(0,0,0,.12);margin-right:3px;vertical-align:middle"></span>':'';
      html+='<span style="line-height:1.4"><span style="font-weight:700">'+l.surfType+'</span>'+(l.room?'<br><span style="font-size:10px;color:var(--text3)">'+escHtml(l.room||'')+(l.colorFinish?' · '+swatchHtml+escHtml(l.colorFinish||''):'')+'</span>':'')+'</span>'+
        '<span style="color:var(--text3);align-self:start;padding-top:1px">'+l.qty.toLocaleString()+' '+l.unit+'</span>'+
        '<span style="font-weight:700;text-align:right;align-self:start;padding-top:1px">'+fmtShort(l.sub)+'</span>';
    } else {
      html+='<span>'+l.label+'</span><span style="color:var(--text3)">'+l.qty.toLocaleString()+' '+l.unit+'</span><span style="font-weight:700;text-align:right">'+fmtShort(l.sub)+'</span>';
    }
  });
  html+='</div>';
  if(tierPremium>0){
    const tierPct=Math.round((tierMult-1)*100);
    const tierLabel=(estPropertyTier?.label)||'Property tier';
    html+='<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text3);margin-top:6px;border-top:1px solid var(--border);padding-top:4px"><span>Base subtotal</span><span>'+fmt(subtotal)+'</span></div>'+
          '<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--amber);font-weight:700;margin-top:2px"><span>'+tierLabel+' (+'+tierPct+'%)</span><span>+'+fmt(tierPremium)+'</span></div>';
  }
  html+='<hr><div style="display:flex;justify-content:space-between;font-size:15px;font-weight:700"><span>Estimated bid</span><span style="color:var(--blue)">'+fmtShort(bid)+'</span></div>';
  el.innerHTML=html;
}
function renderEstReview(){
  const{lines,base,adj,final,laborTotal,matTotal,suppliesCost,totalLaborHours,laborRate,paintCostPerGal,paintLines,totalPaintSqFt,coats,customerPaint}=calcEst();
  const el=document.getElementById('est-review');if(!el)return;
  if(!estSurfaces.length&&!lines.length){el.innerHTML='<div class="empty">No surfaces added yet.</div>';return;}

  // Build per-room data: surfaces with individual color+finish + scope
  const roomData={};let totalSqft=0;
  estSurfaces.forEach(s=>{
    if(!s.qty)return;
    const t=SURF_TYPES.find(x=>x.v===s.type);
    const roomName=cleanRoomName(s.room)||'Other';
    // Extract color+finish from "Room — Color [Finish]" or "Room — Color"
    const afterDash=(s.room||'').indexOf(' — ')>-1?(s.room||'').split(' — ').slice(1).join(' — '):'';
    const finishMatch=afterDash.match(/\[([^\]]+)\]$/);
    const finish=finishMatch?finishMatch[1]:'';
    const colorName=afterDash.replace(/\s*\[[^\]]+\]$/,'').trim();
    if(!roomData[roomName])roomData[roomName]={sqft:0,surfaces:[],scopeCost:0,scopeItems:[]};
    if(t&&t.unit==='sq ft'){roomData[roomName].sqft+=s.qty;totalSqft+=s.qty;}
    // Store surface with its own color+finish
    const surfTypeLabel=t?t.l:(s.type.charAt(0).toUpperCase()+s.type.slice(1));
    const countLabel=t&&t.unit!=='sq ft'?(' · '+s.qty+' '+t.unit):'';
    roomData[roomName].surfaces.push({
      type:surfTypeLabel,
      qty:s.qty,
      unit:t?t.unit:'sf',
      color:colorName,
      finish,
      hex:(_swColors&&colorName)?(_swColors.find(c=>colorName.includes(c.name))?.hex||''):'',
      countLabel
    });
  });

  // Add per-room scope costs
  Object.entries(roomScopeMap).forEach(([room,scope])=>{
    if(!roomData[room])return;
    let roomScopeCost=0;const scopeLabels=[];
    Object.entries(scope).forEach(([scId,entry])=>{
      if(!entry||!entry.active)return;
      const sc=SCOPE_ITEMS.find(x=>x.id===scId);
      const cost=entry.cost||Math.round((entry.hrs||0)*(entry.rate||45)*100)/100;
      roomScopeCost+=cost;
      if(sc&&entry.hrs)scopeLabels.push({label:sc.label,hrs:entry.hrs,rate:entry.rate||45,cost});
    });
    roomData[room].scopeCost=roomScopeCost;
    roomData[room].scopeItems=scopeLabels;
  });

  let html='';

  // Per-room breakdown
  html+='<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:var(--blue-dk);margin-bottom:10px;display:flex;align-items:center;gap:6px">🏠 Room by room</div>';
  Object.entries(roomData).forEach(([room,data])=>{
    const accentHex=data.surfaces.find(s=>s.hex)?.hex||'';
    const accentBorder=accentHex?accentHex:'var(--blue)';
    html+='<div style="border:1px solid var(--border);border-left:4px solid '+accentBorder+';border-radius:var(--rl);overflow:hidden;margin-bottom:10px">'+
      // Room header row
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--bg2);border-bottom:1px solid var(--border)">'+
        '<span style="font-size:14px;font-weight:800;color:var(--text)">'+escHtml(room)+'</span>'+
        (data.sqft?'<span style="font-size:11px;font-weight:700;color:var(--blue);background:var(--blue-lt);padding:2px 8px;border-radius:20px">'+data.sqft.toLocaleString()+' sq ft</span>':'')+
      '</div>'+
      '<div style="padding:4px 14px 8px">'+
      // Per-surface rows with color swatch + finish
      data.surfaces.map(s=>{
        const swatchHtml=s.hex?'<div style="width:16px;height:16px;border-radius:3px;background:'+s.hex+';border:1px solid rgba(0,0,0,.12);flex-shrink:0"></div>':'';
        return '<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border)">'+
          '<div style="display:flex;align-items:center;gap:8px;min-width:0">'+
            swatchHtml+
            '<div>'+
              '<span style="font-size:13px;font-weight:700;color:var(--text)">'+s.type+'</span>'+
              (s.color?'<div style="font-size:11px;color:var(--text3)">'+escHtml(s.color)+(s.finish?' · <span style="color:var(--blue-dk);font-weight:600">'+escHtml(s.finish)+'</span>':'')+'</div>':'<div style="font-size:11px;color:#A32D2D">No color selected</div>')+
            '</div>'+
          '</div>'+
          '<div style="font-size:12px;font-weight:700;color:var(--text2);flex-shrink:0;margin-left:8px">'+
            (s.unit==='sq ft'?s.qty.toLocaleString()+' sf':s.qty+' '+s.unit)+
          '</div>'+
        '</div>';
      }).join('')+
      // Scope items
      (data.scopeItems.length?
        '<div style="margin-top:8px">'+
        data.scopeItems.map(si=>
          '<div style="display:flex;justify-content:space-between;font-size:11px;padding:3px 0;color:var(--text2)">'+
            '<span>'+si.label+' ('+si.hrs+'h @ $'+si.rate+'/hr)</span>'+
            '<span style="font-weight:700;color:var(--blue)">'+fmt(si.cost)+'</span>'+
          '</div>'
        ).join('')+'</div>'
      :'')+
      '</div>'+
    '</div>';
  });

  // Total sqft
  html+='<div style="display:flex;justify-content:space-between;font-size:12px;padding:6px 0;border-bottom:2px solid var(--border2);font-weight:700;margin-bottom:12px">'+
    '<span>Total paintable sq ft</span><span style="color:var(--blue)">'+totalSqft.toLocaleString()+' sq ft</span></div>';

  // ── Compact summary + collapsible analysis ─────────────────────────────
  const _tierMult=(typeof estPropertyTier!=='undefined'&&estPropertyTier.mult)||1.00;
  const _subtotal=Math.round((laborTotal+matTotal)*100)/100;
  const _tierPremium=_tierMult!==1.00?Math.round((final-_subtotal)*100)/100:0;
  const _tierPct=Math.round((_tierMult-1)*100);
  // Compute applied tax
  const _stR2=_paintClientTaxRate!==null?(_paintClientTaxRate.rate??0):(parseFloat(S&&S.salesTaxRate)||0);
  const _st2=(typeof detectStateFromAddr==='function'?detectStateFromAddr(document.getElementById('e-caddr')?.value||''):null)||(S&&S.state)||'KS';
  let _appliedTax=0,_taxLabel='Sales tax';
  const _noTaxSt=(typeof ST_NO_TAX!=='undefined')&&ST_NO_TAX.has&&ST_NO_TAX.has(_st2);
  if(_stR2>0&&!_noTaxSt&&_paintWorkScope!=='improvement'&&typeof calcSalesTax==='function'){
    const _cProp=_paintIsCommercial?'commercial':'residential';
    const _tr=calcSalesTax({state:_st2,tradeType:'painting',scope:'repair',propertyType:_cProp,taxRate:_stR2,laborTotal,materialsTotal:matTotal+suppliesCost});
    if(_tr.treatment&&_tr.treatment.customerTax&&_tr.taxAmount>0){_appliedTax=_tr.taxAmount;_taxLabel='Sales tax ('+_stR2+'%)';}
  }
  const _grandTotal=final+_appliedTax;
  html+='<div style="border:1px solid var(--border);border-radius:var(--rl);overflow:hidden;margin-bottom:12px">'+
    '<div style="display:flex;justify-content:space-between;padding:9px 14px;border-bottom:1px solid var(--border)">'+
      '<span style="font-size:12px;color:var(--text2)">Subtotal</span>'+
      '<span style="font-size:14px;font-weight:700">'+fmtShort(final)+'</span>'+
    '</div>'+
    (_appliedTax>0?
      '<div style="display:flex;justify-content:space-between;padding:9px 14px;border-bottom:1px solid var(--border)">'+
        '<span style="font-size:12px;color:var(--text2)">'+_taxLabel+'</span>'+
        '<span style="font-size:12px;font-weight:600;color:var(--blue)">+'+fmtShort(_appliedTax)+'</span>'+
      '</div>'
    :(!_stR2&&!_noTaxSt&&_paintWorkScope!=='improvement'?
      '<div style="display:flex;justify-content:space-between;padding:9px 14px;border-bottom:1px solid var(--border);cursor:pointer" onclick="openSalesTaxSetup()">'+
        '<span style="font-size:12px;color:var(--amber)">⚠ Sales tax — tap to set</span>'+
        '<span style="font-size:12px;font-weight:700;color:var(--blue)">Set rate →</span>'+
      '</div>':'')
    )+
    '<div style="display:flex;justify-content:space-between;padding:10px 14px;background:var(--blue);color:#fff">'+
      '<span style="font-size:13px;font-weight:800">Total</span>'+
      '<span style="font-size:20px;font-weight:900;letter-spacing:-.5px">'+fmtShort(_grandTotal)+'</span>'+
    '</div>'+
    ((_estMetsHtml=
      '<div class="mets" style="margin-bottom:0">'+
        '<div class="met"><div class="met-l">Labor hours</div><div class="met-v">'+totalLaborHours.toFixed(1)+'h</div></div>'+
        '<div class="met"><div class="met-l">Labor</div><div class="met-v" style="color:var(--blue)">'+fmtShort(laborTotal)+'</div></div>'+
        '<div class="met"><div class="met-l">Materials</div><div class="met-v" style="color:var(--blue)">'+fmtShort(matTotal)+'</div></div>'+
        (_tierPremium>0?'<div class="met"><div class="met-l" style="color:var(--amber)">'+(estPropertyTier?.label||'Tier')+' +'+_tierPct+'%</div><div class="met-v" style="color:var(--amber)">+'+fmtShort(_tierPremium)+'</div></div>':'')+
        (final>0&&totalLaborHours>0?'<div class="met"><div class="met-l">Effective rate</div><div class="met-v" style="color:var(--text2)">'+fmt(final/totalLaborHours)+'/hr</div></div>':'')+
      '</div>'
    ),'')+ // side-effect: cache mets HTML for lazy expand, returns ''
    '<button onclick="const d=document.getElementById(\'est-mets-detail\');if(!d.children.length)d.innerHTML=_estMetsHtml;const open=!d.hidden;d.hidden=open;this.textContent=open?\'▸ Show analysis\':\'▴ Hide analysis\'" style="display:block;width:100%;background:var(--bg2);border:none;border-top:1px solid var(--border);padding:8px;font-size:11px;font-weight:700;color:var(--text2);cursor:pointer;font-family:inherit;text-align:center">▸ Show analysis</button>'+
    '<div id="est-mets-detail" hidden style="padding:10px 14px;border-top:1px solid var(--border)">'+
    '</div>'+
  '</div>';
  // ── Profit margin gauge ──────────────────────────────────────────────────
  // Save paintLines to bid in memory so job sheet can show them
  (()=>{const _bidId=typeof lastCreatedBidId!=='undefined'?lastCreatedBidId:(typeof editingBidId!=='undefined'?editingBidId:null);if(_bidId&&typeof bids!=='undefined'){const _b=bids.find(x=>x.id===_bidId);if(_b)_b.paintLines=paintLines.length?paintLines:undefined;}})();
  html+='<div style="border:1px solid var(--border);border-radius:var(--rl);padding:14px 14px 6px;margin-bottom:12px">'+
    '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:var(--blue-dk);margin-bottom:10px">Profit margin</div>'+
    '<input type="number" id="paint-expected-cost" style="display:none">'+
    '<div id="paint-gauge-hint" style="display:none"></div>'+
    '<div id="paint-profit-gauge" style="display:none;opacity:0;transition:opacity .32s ease">'+
      '<div style="position:relative;height:7px;border-radius:5px;background:linear-gradient(to right,#991B1B 0%,#EF4444 15%,#F59E0B 30%,#22C55E 38%,#22C55E 78%,#F59E0B 92%,#EF4444 100%);margin:14px 10px 26px">'+
        '<div id="paint-gauge-dot" style="position:absolute;top:50%;transform:translate(-50%,-50%);width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 0 0 3px #22C55E,0 2px 8px rgba(0,0,0,.25);left:50%;transition:left .55s cubic-bezier(.22,1,.36,1),box-shadow .4s ease"></div>'+
      '</div>'+
      '<div style="text-align:center;padding-bottom:12px">'+
        '<div id="paint-gauge-pct" style="font-size:30px;font-weight:900;line-height:1.1;color:var(--text);transition:color .4s ease">—</div>'+
        '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text3);margin:2px 0 2px">Profit %</div>'+
        '<div id="paint-gauge-dollars" style="font-size:15px;font-weight:700;margin:0 0 5px;transition:color .4s ease"></div>'+
        '<div id="paint-gauge-msg" style="font-size:11.5px;color:var(--text3);min-height:16px"></div>'+
      '</div>'+
    '</div>'+
  '</div>';

  el.innerHTML=html;
  const fd=document.getElementById('est-final-disp');if(fd)fd.textContent=fmt(final);
  // Auto-set cost: paint materials + scope add-on costs + RRP surcharge
  const _costEl=document.getElementById('paint-expected-cost');
  if(_costEl){
    const autoVal=_paintExpectedCost!==null?_paintExpectedCost:_paintCalcAutoCost(matTotal);
    _costEl.value=Math.round(autoVal||0);
    if(_paintExpectedCost!==null)_costEl.dataset.userSet='true';
  }
  _paintGaugeUpdate();
}
function _paintCalcAutoCost(mt){
  let c=mt||0;
  if(typeof roomScopeMap!=='undefined'){
    Object.values(roomScopeMap).forEach(scope=>{
      if(!scope||typeof scope!=='object')return;
      Object.entries(scope).forEach(([k,entry])=>{
        if(k.startsWith('_')||!entry||!entry.active)return;
        c+=entry.cost||Math.round((entry.hrs||0)*(entry.rate||45)*100)/100;
      });
    });
  }
  if(_rrpPaintAnswer==='yes')c+=(typeof S!=='undefined'&&S.rrpSurcharge)||150;
  return c;
}
function _paintGaugeUpdate(){
  const {final,matTotal:mt}=calcEst();
  const costEl=document.getElementById('paint-expected-cost');
  if(!costEl)return;
  if(costEl.dataset.userSet)_paintExpectedCost=parseFloat(costEl.value)||null;
  else costEl.value=Math.round(_paintExpectedCost!==null?_paintExpectedCost:_paintCalcAutoCost(mt)||0);
  _updateMarginGauge('paint',final);
}
function downloadProposalPDF(){
  const proposal=document.getElementById('est-proposal');
  if(!proposal||!proposal.innerHTML.trim()){
    zAlert('Generate the proposal first.',{title:'Nothing to print'});return;
  }
  const cname=(document.getElementById('e-cname')?.value||'Estimate').replace(/[^a-z0-9]/gi,'_');
  const bname=document.getElementById('e-bname')?.value||getBusinessName()||'Contractor';
  const html=`<!DOCTYPE html><html><head>
<meta charset="utf-8">
<title>${bname} — Estimate for ${cname.replace(/_/g,' ')}</title>
<link href="https://fonts.googleapis.com/css2?family=Dancing+Script:wght@700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fff;color:#1a1a1a;padding:0}
:root{--blue:#185FA5;--blue-lt:#EBF2FB;--blue-dk:#0D3B6E;--green:#63B841;--green-lt:#F0FBF0;--green-mid:#3B8C2A;--border:#E0E0DC;--text:#1a1a1a;--text2:#444;--text3:#888;--bg:#fff;--bg2:#F8F8F6;--r:6px;--rl:12px}
table{width:100%;border-collapse:collapse}
ol{padding-left:18px;line-height:2}
@media print{@page{margin:0.5in;size:letter}body{padding:0}.no-print{display:none!important}}
</style>
</head><body>
<div class="no-print" style="background:#185FA5;color:#fff;padding:12px 20px;display:flex;justify-content:space-between;align-items:center">
  <span style="font-weight:700">TradeDesk — Proposal PDF</span>
  <button onclick="tdPrint()" style="background:#fff;color:#185FA5;border:none;padding:8px 18px;border-radius:6px;font-weight:700;font-size:14px;cursor:pointer">⬇ Save as PDF</button>
</div>
${proposal.innerHTML}
<scr"+"ipt>setTimeout(()=>tdPrint(),600)</scr"+"ipt>
</body></html>`;
  // Use blob URL — no popup permission needed
  const blob=new Blob([html],{type:'text/html'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.target='_blank';
  a.rel='noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url),10000);
}

// ── Property data auto-lookup ───────────────────────────────────────────────
async function _lookupPropertyData(clientId,addrParts){
  try{
    const addr=[addrParts.street,addrParts.city,addrParts.state,addrParts.zip].filter(Boolean).join(' ');
    const _ctrl=new AbortController();
    const _t=setTimeout(()=>_ctrl.abort(),12000);
    let res;try{res=await fetch('/api/property?addr='+encodeURIComponent(addr),{signal:_ctrl.signal});}finally{clearTimeout(_t);}
    if(!res.ok||res.status===204)return;
    const d=await res.json();
    if(d.error)return;
    const c=clients.find(x=>x.id===clientId);if(!c)return;
    if(d.yearBuilt&&!c.yearBuilt)c.yearBuilt=d.yearBuilt;
    if(d.sqft)c.sqft=d.sqft;
    if(d.estValue)c.estimatedValue=d.estValue;
    if(d.beds)c.bedrooms=d.beds;
    if(d.baths)c.bathrooms=d.baths;
    if(d.lastSalePrice)c.lastSalePrice=d.lastSalePrice;
    if(d.lastSaleDate)c.lastSaleDate=d.lastSaleDate;
    if(d.propertyUrl)c.assessorUrl=d.propertyUrl;
    c.propDataSource='zillow';
    c.propDataExact=true;
    c.propDataFetchedAt=new Date().toISOString();
    saveAll();
    if(currentClientId===clientId)renderClientDetail();
  }catch(e){console.warn('Property lookup failed:',e);}
}

// ── Background property data queue ────────────────────────────────────────────
// Processes all clients with addresses but no Zillow data, one every 6.5s.
// Fires automatically after login — handles onboarding imports and existing accounts.
let _propQueue=[];
let _propQueueTimer=null;

function _startPropQueue(){
  if(_propQueueTimer)return;
  _propQueue=clients.filter(c=>(c.addr||c.street)&&!c.propDataFetchedAt).map(c=>c.id);
  if(!_propQueue.length)return;
  _propQueueTimer=setTimeout(_tickPropQueue,3000);
}

function _tickPropQueue(){
  _propQueueTimer=null;
  const id=_propQueue.shift();
  if(id===undefined)return;
  const c=clients.find(x=>x.id===id);
  if(c&&(c.addr||c.street)&&!c.propDataFetchedAt){
    const parts=c.street&&c.city
      ?{street:c.street,city:c.city,state:c.state||'',zip:c.zip||''}
      :(typeof _parseAddrParts==='function'?_parseAddrParts(c.addr||''):{street:c.addr||'',city:'',state:'',zip:''});
    if(parts.street)_lookupPropertyData(id,parts);
  }
  if(_propQueue.length)_propQueueTimer=setTimeout(_tickPropQueue,6500);
}

