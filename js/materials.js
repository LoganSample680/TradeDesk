// ── Materials: one section, every estimate that has one ─────────────────────
//
// Owner 2026-09-26: "materials code should be common code and shared so
// updates carry over to both, look and ensure they are the exact same."
//
// Time & Materials keeps its lines in _geiLines and Build Your Own keeps its
// items in _byoItems. That storage is the ONLY thing that differs, so it lives
// in the few _mat* store functions below, and everything the contractor sees
// (the card, the rows, the supply house card inside it, the add and edit
// sheets) is drawn once, here. A change to the Materials section is made in
// this file and lands on both estimate types at once. TrueMeasure opens a
// Build Your Own estimate, so it gets the same section with no code of its own.
//
// The add and edit sheets are BYO's (_byoAddItem / _byoEditItem): price book
// chips, count x unit x rate, description. They write through _matPut and
// _matWrite, so on a T&M estimate the same sheet writes a T&M line.

const _MAT_SEC='Materials';

// ── The store: the only T&M / BYO split ────────────────────────────────────
// The invoice is the third store (owner 2026-09-29: "use the same one that's
// in proposal for T&M and BYO, should carry over to bill and invoices"). Its
// parts are the part lines in _qi.typed. It wins while the invoice page is the
// one on screen, because the estimate flags stay set after an estimate closes.
function _matIsQI(){
  if(typeof _qi==='undefined'||!_qi)return false;
  const pg=document.getElementById('pg-qi');
  return !!(pg&&pg.classList.contains('active'));
}
function _matIsTM(){return !_matIsQI()&&!!(typeof _geiIsTM!=='undefined'&&_geiIsTM);}
// Index into the backing array for every row the section draws. The supply
// house line is not a row: it is drawn by its own card (js/supply-list.js).
function _matIdx(){
  if(_matIsQI())return (_qi.typed||[]).map((l,i)=>(l&&l.part&&!l._supply)?i:-1).filter(i=>i>=0);
  if(_matIsTM())return (_geiLines||[]).map((l,i)=>(l&&!l._tmLabor&&!l._supply)?i:-1).filter(i=>i>=0);
  return (_byoItems||[]).map((it,i)=>(it&&it.section===_MAT_SEC&&!it._supply)?i:-1).filter(i=>i>=0);
}
// One shape for both stores, the shape the BYO item already uses.
function _matView(i){
  if(_matIsQI()){
    const l=(_qi.typed||[])[i];if(!l||!l.part)return null;
    const qty=Number(l.qty)>0?Number(l.qty):1;
    const rate=Number(l.amount)||0;
    return {label:l.desc||'',notes:l.notes||'',qty,unit:l.unit||'ea',rate,price:Math.round(qty*rate*100)/100,on:true};
  }
  if(_matIsTM()){
    const l=(_geiLines||[])[i];if(!l||l._tmLabor)return null;
    const qty=Number(l.qty)>0?Number(l.qty):1;
    const rate=Number(l.rate)||0;
    const price=(l.total!=null&&l.total!=='')?Number(l.total)||0:_geiCents(qty*rate);
    return {label:l.desc||'',notes:l.notes||'',qty,unit:l.unit||'ea',rate:rate||price,price,on:true};
  }
  const it=(_byoItems||[])[i];if(!it)return null;
  return {label:it.label||'',notes:it.notes||'',qty:it.qty,unit:it.unit,rate:it.rate,price:Number(it.price)||0,on:it.on!==false};
}
// A new line. sec is the BYO section the sheet was opened for; a T&M estimate
// has one list, so it is ignored there.
function _matPut(sec,v){
  if(_matIsQI()){
    // A blank line he never typed in is not a line; the new part takes its place.
    _qi.typed=_qi.typed.filter(l=>l._supply||String(l.desc||'').trim()||Number(l.amount)>0);
    _qi.typed.push({part:true,desc:v.label,notes:v.notes||'',qty:v.qty,unit:v.unit,amount:v.rate});
    return;
  }
  if(_matIsTM()){
    _geiLines.push({desc:v.label,notes:v.notes||'',qty:v.qty,unit:v.unit,rate:v.rate,total:_geiCents(v.qty*v.rate)});
    return;
  }
  const nextId=(_byoItems.reduce((m,x)=>Math.max(m,x.id||0),0))+1;
  _byoItems.push(_byoNormItem({id:nextId,section:sec,label:v.label,qty:v.qty,unit:v.unit,rate:v.rate,price:v.qty*v.rate,notes:v.notes||'',on:true}));
}
function _matWrite(i,v){
  if(_matIsQI()){
    const l=_qi.typed[i];if(!l||!l.part)return;
    l.desc=v.label;l.notes=v.notes||'';l.qty=v.qty;l.unit=v.unit;l.amount=v.rate;
    return;
  }
  if(_matIsTM()){
    const l=_geiLines[i];if(!l||l._tmLabor)return;
    l.desc=v.label;l.notes=v.notes||'';l.qty=v.qty;l.unit=v.unit;l.rate=v.rate;l.total=_geiCents(v.qty*v.rate);
    return;
  }
  const it=_byoItems[i];if(!it)return;
  it.label=v.label;it.qty=v.qty;it.unit=v.unit;it.rate=v.rate;it.notes=v.notes||'';
  _byoNormItem(it);
}
// Redraw and recount, the way each estimate already does after any edit.
function _matRefresh(){
  if(_matIsQI()){renderQuickInvoice();return;}
  if(_matIsTM()){_tmRenderMatList();_tmInputChange();return;}
  _byoRenderSections();_byoUpdateRail();_byoAutosave();
}

// ── The actions every row has ──────────────────────────────────────────────
function _matAdd(){_byoAddItem(_MAT_SEC);}
function _matEdit(i){_byoEditItem(i);}
function _matDel(i){
  if(_matIsQI()){
    const l=_qi.typed[i];if(!l||!l.part||l._supply)return;
    _qi.typed.splice(i,1);
  }else if(_matIsTM()){
    const l=_geiLines[i];if(!l||l._tmLabor||l._supply)return;
    _geiLines.splice(i,1);
  }else{
    const it=_byoItems[i];if(!it||it.required||it._supply)return;
    _byoItems.splice(i,1);
  }
  _matRefresh();
}
// The copy lands under the original with a (2), same rule BYO has always had.
function _matDup(i){
  const v=_matView(i);if(!v)return;
  const base=String(v.label||'').replace(/\s*\((\d+)\)$/,'').trim();
  const taken=new Set(_matIdx().map(j=>String((_matView(j)||{}).label||'').trim()));
  let n=2,name=base+' ('+n+')';
  while(taken.has(name)){n++;name=base+' ('+n+')';}
  if(_matIsQI()){
    const copy=JSON.parse(JSON.stringify(_qi.typed[i]));
    copy.desc=name;
    _qi.typed.splice(i+1,0,copy);
  }else if(_matIsTM()){
    const copy=JSON.parse(JSON.stringify(_geiLines[i]));
    copy.desc=name;
    _geiLines.splice(i+1,0,copy);
  }else{
    const it=_byoItems[i];if(!it||it._rrp)return;
    const copy=_byoNormItem(Object.assign({},JSON.parse(JSON.stringify(it)),{id:(_byoItems.reduce((m,x)=>Math.max(m,x.id||0),0))+1,label:name,on:true}));
    _byoItems.splice(i+1,0,copy);
  }
  _matRefresh();
}
// Only a BYO item saved before this change can be left out (a T&M line has no
// such switch). Its row keeps the tick box so it can be put back, and every
// other row has none.
function _matToggle(i){
  if(_matIsTM()||_matIsQI())return;
  const it=_byoItems[i];if(!it||it.required)return;
  it.on=!it.on;
  _matRefresh();
}

// ── The card ───────────────────────────────────────────────────────────────
function _matCardHTML(){
  const rows=_matIdx().map(i=>{
    const v=_matView(i);if(!v)return '';
    return _geiItemRowHtml({
      checked:v.on?undefined:false,rowOnclick:v.on?'':'_matToggle('+i+')',
      label:v.label||'Untitled',notes:v.notes,price:v.price,qtyLabel:_byoQtyLabel(v),
      editFn:'_matEdit('+i+')',delFn:'_matDel('+i+')',dupFn:'_matDup('+i+')'
    });
  }).join('');
  const sup=(typeof _supCardHTML==='function')?_supCardHTML():'';
  return '<div class="card card-pad-0 mat-card" id="mat-card" style="margin-bottom:12px">'+
    '<div class="card-hd"><div class="card-hd-title">'+_MAT_SEC+'</div>'+
      '<button class="btn btn-sm" onclick="_matAdd()">+ Add item</button>'+
    '</div>'+
    '<div class="mat-rows">'+(rows||'<div class="mat-empty">Nothing added yet</div>')+'</div>'+
    (sup?'<div class="mat-sup">'+sup+'</div>':'')+
    '<div class="mat-tip">Your markup is in each price. They never see the markup.</div>'+
  '</div>';
}

// T&M and BYO are two pages that stay in the DOM, and whichever one was open
// last still holds its drawing of this card. Two #mat-card (and two #sup-card,
// #sup-add, #sup-markup) would send a lookup to the hidden one, so the page
// being drawn claims the card and any other copy goes.
function _matClaim(host){
  if(!host)return;
  document.querySelectorAll('#mat-card').forEach(el=>{if(!host.contains(el))el.remove();});
}

// ── WHAT HE SAID HE IS BUYING, INTO THIS SECTION (owner 2026-09-28) ─────────
//
// "Talk to Tim stays in the material section as well, in the proposals and the
// invoices." Tim reads the materials out of what he said (timSaidMaterials in
// js/tim-knowledge.js); this puts them here, the one Materials section T&M and
// Build Your Own share, so it lands the same on both.
//
// Two places in the section, and the price decides which:
//   - a thing his price book already prices becomes a Materials row at HIS
//     price, count times rate, like one he added by hand;
//   - a thing with no price yet goes on the supply house list in this same
//     card (js/supply-list.js), which is where an unpriced item already lives
//     ("waiting on their quote"). A $0 row on a proposal would read as free.
// Said twice, it is not added twice: a row or list item with the same name is
// left as it is.
function timAddMaterials(mats){
  const list=Array.isArray(mats)?mats.filter(m=>m&&m.item):[];
  if(!list.length||!_supMode())return {rows:0,listed:0};
  const trade=(typeof _pbTrade==='function')?_pbTrade():'general';
  const key=s=>String(s||'').trim().toLowerCase().replace(/\s+/g,' ');
  const haveRows=new Set(_matIdx().map(i=>key((_matView(i)||{}).label)));
  const host=_supHost(false);
  const haveList=new Set(((host&&host._supply&&host._supply.items)||[]).map(it=>key(it.desc)));
  let rows=0,listed=0;
  const toList=[];
  list.forEach(m=>{
    const label=String(m.item).trim();
    const k=key(label);
    if(haveRows.has(k)||haveList.has(k))return;
    const qty=Number(m.qty)>0?Number(m.qty):1;
    const unit=m.unit||'ea';
    const own=(typeof _pbFind==='function')?_pbFind(label,trade):null;
    const rate=own&&Number(own.rate)>0?Number(own.rate):0;
    if(rate>0){
      _matPut(_MAT_SEC,{label,qty,unit:own.unit||unit,rate,notes:''});
      haveRows.add(k);rows++;
    }else{
      // What he last paid for it, off his receipts (materials book), so the
      // list is priced before the supply house quotes it.
      const paid=(typeof partCostFor==='function')?partCostFor(label):null;
      toList.push({qty,unit,desc:label,cost:paid?Number(paid.cost)||0:0,on:true});
      haveList.add(k);listed++;
    }
  });
  if(toList.length){
    const h=_supHost(true);
    h._supply.items=(h._supply.items||[]).concat(toList);
    if(typeof _supSync==='function')_supSync();
  }
  // On T&M, Materials is a section he turns on; what Tim added turns it on,
  // or the items would sit on the estimate out of sight.
  if((rows||listed)&&_matIsTM()&&typeof _tmLayers!=='undefined'&&!_tmLayers.has('mat')&&typeof _tmAddLayer==='function')_tmAddLayer('mat');
  if(rows||listed)_matRefresh();
  return {rows,listed};
}
