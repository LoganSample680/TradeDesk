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
function _matIsTM(){return !!(typeof _geiIsTM!=='undefined'&&_geiIsTM);}
// Index into the backing array for every row the section draws. The supply
// house line is not a row: it is drawn by its own card (js/supply-list.js).
function _matIdx(){
  if(_matIsTM())return (_geiLines||[]).map((l,i)=>(l&&!l._tmLabor&&!l._supply)?i:-1).filter(i=>i>=0);
  return (_byoItems||[]).map((it,i)=>(it&&it.section===_MAT_SEC&&!it._supply)?i:-1).filter(i=>i>=0);
}
// One shape for both stores, the shape the BYO item already uses.
function _matView(i){
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
  if(_matIsTM()){
    _geiLines.push({desc:v.label,notes:v.notes||'',qty:v.qty,unit:v.unit,rate:v.rate,total:_geiCents(v.qty*v.rate)});
    return;
  }
  const nextId=(_byoItems.reduce((m,x)=>Math.max(m,x.id||0),0))+1;
  _byoItems.push(_byoNormItem({id:nextId,section:sec,label:v.label,qty:v.qty,unit:v.unit,rate:v.rate,price:v.qty*v.rate,notes:v.notes||'',on:true}));
}
function _matWrite(i,v){
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
  if(_matIsTM()){_tmRenderMatList();_tmInputChange();return;}
  _byoRenderSections();_byoUpdateRail();_byoAutosave();
}

// ── The actions every row has ──────────────────────────────────────────────
function _matAdd(){_byoAddItem(_MAT_SEC);}
function _matEdit(i){_byoEditItem(i);}
function _matDel(i){
  if(_matIsTM()){
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
  if(_matIsTM()){
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
  if(_matIsTM())return;
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
    '<div class="mat-rows">'+(rows||'<div class="mat-empty">No items yet, tap + Add item</div>')+'</div>'+
    (sup?'<div class="mat-sup">'+sup+'</div>':'')+
    '<div class="mat-tip">Markup is built into the prices. The client sees the all-in price, never the markup.</div>'+
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
