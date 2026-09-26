// ── Supply house materials (owner 2026-09-26) ──────────────────────────────
//
// The flow, in the owner's words: "John types up materials, sends that list to
// them via email, gets what he sent back, approves, then shares it into
// TradeDesk to scan, attach, read and fill out the materials price."
//
//   1. Type the list      qty, unit, what it is. No prices; the supply house has them.
//   2. Send it            a PDF with the business name and a job reference,
//                         in HIS email app, addressed to the saved supply house.
//   3. Load their quote   the PDF they email back (a scan, not text: Neenan's
//                         come as images). Read ON THE PHONE by Apple's text
//                         reader (TdDoc.recognizeText), no AI and no network
//                         (owner: "I really want reliable OCR without AI").
//                         The reader returns words and where they sit; the
//                         rows are rebuilt and parsed here with plain rules,
//                         then CHECKED: qty x unit price has to equal the line,
//                         and the lines have to equal the subtotal. A line
//                         that does not add up is flagged for him, never
//                         guessed at, and any price can be typed by hand.
//   4. The quote's wording replaces his typed list (owner: "do the quote
//      verbiage"): the quote is what he is actually buying. Every line keeps a
//      tick box, because a quote often prices alternatives (two water heaters,
//      he buys one).
//   5. Markup           a number he types, 0 to 100. The client sees the
//                         marked-up price only; cost never reaches the proposal.
//   6. Sales tax        follows the quote. "Taxes not included" means it came in
//                         on a resale certificate, so sales tax goes on the
//                         client price, markup included. A quote that CHARGED
//                         tax means he already paid it at the counter, so the
//                         line is not taxed again.
//
// WHERE IT LIVES (7.3: no parallel persistence). The list rides on ONE line of
// the estimate, the same line the proposal prints: a BYO item in Materials, or
// a T&M material line. That line is saved, synced, duplicated and resumed by
// the machinery every other line already uses; `_supply` on it holds the list.

const SUP_MARKUP_MAX=100;

function _supBlank(){
  return {items:[],markup:0,vendor:'',vendorEmail:'',quote:null,sentAt:null};
}
function _supCents(n){return Math.round((Number(n)||0)*100)/100;}
function _supMoney(n){
  const v=_supCents(n);
  return '$'+v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
}
function _supClampMarkup(v){
  const n=parseFloat(v);
  if(!isFinite(n)||n<0)return 0;
  return Math.min(SUP_MARKUP_MAX,Math.round(n*100)/100);
}

// Cost of the ticked lines. A line with no price yet (typed, not quoted)
// counts as zero, so the card can say plainly that it is waiting on a quote.
function _supCost(d){
  return _supCents(((d&&d.items)||[]).filter(it=>it&&it.on!==false)
    .reduce((s,it)=>s+(Number(it.cost)||0),0));
}
function _supPrice(d){
  return _supCents(_supCost(d)*(1+_supClampMarkup(d&&d.markup)/100));
}
function _supPriced(d){
  return ((d&&d.items)||[]).some(it=>it&&it.on!==false&&Number(it.cost)>0);
}

// "3 ea 3/4 ball valve", "20ft 2in pvc", "1 coil pex", "ball valve".
// A leading count and an optional unit; everything else is the description.
const _SUP_UNITS=['ea','ft','lf','pc','pcs','box','bx','bag','roll','rl','cl','coil','gal','sq','sqft','bdl','bundle','lot','pr','set','cs','case','lb','lbs','tube','stick','sheet','pk','pkg'];
function _supParseLine(raw){
  const s=String(raw==null?'':raw).trim().replace(/\s+/g,' ');
  if(!s)return null;
  let qty=1,unit='ea',desc=s;
  const m=s.match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)?\b\s*(.*)$/);
  if(m){
    const u=(m[2]||'').toLowerCase();
    if(u&&_SUP_UNITS.includes(u)&&m[3]){qty=parseFloat(m[1]);unit=u;desc=m[3];}
    else if(!u||!_SUP_UNITS.includes(u)){
      // "3 ball valves": a count with no unit. A bare "3/4 ball valve" is a
      // size, not a count, so a fraction right after the number keeps it all.
      if(/^\d+(?:\.\d+)?\s+\S/.test(s)&&!/^\d+\/\d/.test(s)){
        const mm=s.match(/^(\d+(?:\.\d+)?)\s+(.*)$/);qty=parseFloat(mm[1]);desc=mm[2];
      }
    }
  }
  if(!(qty>0))qty=1;
  desc=desc.trim();
  if(!desc)return null;
  return {qty,unit,desc,cost:0,on:true};
}

// ── SAY THE PARTS (owner, 2026-09-26: "Anyway to bulk add materials where we
// can talk them into Tim?") ─────────────────────────────────────────────────
//
// He rattles the list off the way he would to the counter: "three three
// quarter ball valves, twenty feet of two inch PVC, a condensate pump and two
// boxes of half inch sharkbite couplings". Each part comes out as its own row
// with its count and unit. The hard part is that the same words are counts in
// one place and sizes in the next: "three" is a count, "three quarter" is a
// size, "twenty feet" is a count and a unit, "two inch" is a size. So sizes
// are read first and set aside, and only then is the leading number a count.
// No model, no network: plain rules, like the quote reader.
const _SUP_NUMW={a:1,an:1,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90,hundred:100,couple:2,pair:2,dozen:12};
const _SUP_UNITW={foot:'ft',feet:'ft',ft:'ft',each:'ea',ea:'ea',box:'box',boxes:'box',roll:'roll',rolls:'roll',bag:'bag',bags:'bag',stick:'stick',sticks:'stick',length:'stick',lengths:'stick',gallon:'gal',gallons:'gal',tube:'tube',tubes:'tube',piece:'pc',pieces:'pc',coil:'coil',coils:'coil',case:'cs',cases:'cs',pack:'pk',packs:'pk',bundle:'bdl',bundles:'bdl',sheet:'sheet',sheets:'sheet',pair:'pr',pairs:'pr',set:'set',sets:'set',lb:'lb',lbs:'lb',pound:'lb',pounds:'lb'};
// Spoken sizes, longest first, into how the counter writes them.
const _SUP_SIZES=[
  [/\binch and a quarter\b/g,'1-1/4in'],[/\binch and a half\b/g,'1-1/2in'],
  [/\b(one and a quarter|one and quarter|1 and a quarter) inch(es)?\b/g,'1-1/4in'],
  [/\b(one and a half|one and half|1 and a half) inch(es)?\b/g,'1-1/2in'],
  [/\b(three quarters?|three-quarters?|3 quarters?)( of an)?( inch(es)?)?\b/g,'3/4in'],
  [/\b(half|a half|one half)( of an| an)? inch(es)?\b/g,'1/2in'],[/\bhalf-inch\b/g,'1/2in'],
  [/\b(quarter|a quarter|one quarter)( of an| an)? inch(es)?\b/g,'1/4in'],
  [/\b(one|two|three|four|five|six|eight|ten|twelve|1|2|3|4|5|6|8|10|12)[\s-]inch(es)?\b/g,(m,n)=>((_SUP_NUMW[n]||n)+'in')],
  [/\b(\d+(?:\/\d+)?)\s*(inch|inches|in|\")(?=\s|$)/g,'$1in'],
];
function _supSizes(t){
  let out=String(t||'');
  _SUP_SIZES.forEach(([re,to])=>{out=out.replace(new RegExp(re.source,'gi'),typeof to==='function'?((...a)=>to(a[0],String(a[1]||'').toLowerCase())):to);});
  return out;
}
function _supSpokenPiece(raw){
  // His words as spoken, capitals and all ("Navien NPE-240A"); only the
  // matching is done in lower case.
  let t=String(raw||'').trim();
  for(let k=0;k<3;k++)t=t.replace(/^(ok(ay)?|so|um+|uh+|and|also|plus|then|i need|we need|we'?ll need|i'?ll need|get me|grab|pick up|we got|gonna need|going to need|need|we want|i want)\b[\s,]*/i,'');
  let qty=null,rest=t.trim();
  let m=rest.match(/^(\d+(?:\.\d+)?)(?![\/\d]|in\b|-)\s+(.*)$/i);
  if(m){qty=parseFloat(m[1]);rest=m[2];}
  else{
    const w=rest.split(/\s+/);
    // "a couple of", "a pair of", "a dozen": the word after the "a" is the count.
    if(/^(a|an)$/i.test(w[0])&&/^(couple|pair|dozen)$/i.test(w[1]||''))w.shift();
    let n=0,used=0;
    for(let i=0;i<w.length&&i<3;i++){
      const v=_SUP_NUMW[w[i].toLowerCase()];if(v==null)break;
      if(v===100&&n>0){n*=100;}else n+=v;
      used=i+1;
      if(/^(a|an|couple|pair|dozen)$/i.test(w[i]))break;
    }
    if(used){qty=n;rest=w.slice(used).join(' ').replace(/^of\s+/i,'');}
  }
  let unit='ea';
  m=rest.match(/^([A-Za-z]+)\s+(?:of\s+)?(.*)$/);
  if(m&&_SUP_UNITW[m[1].toLowerCase()]&&m[2]){unit=_SUP_UNITW[m[1].toLowerCase()];rest=m[2];}
  rest=rest.replace(/^(of|a|an|the)\s+/i,'').trim();
  if(!rest||rest.replace(/[^a-z0-9]/gi,'').length<2)return null;
  // "ball valves" -> "ball valve": the counter reads the count, not the plural.
  rest=rest.replace(/\b([a-z]{2,}[^s\s])s\b(?!.*\b[a-z]{2,}[^s\s]s\b)/,'$1');
  rest=rest.replace(/\b(pvc|cpvc|pex|abs|csst|npt|fip|mip|gfci|afci|emt)\b/gi,x=>x.toUpperCase());
  rest=rest.replace(/\bshark ?bite\b/gi,'SharkBite');
  return {qty:qty&&qty>0?qty:1,unit,desc:rest.charAt(0).toUpperCase()+rest.slice(1),cost:0,on:true};
}
function _supParseSpoken(text){
  // Sizes first, over the whole sentence, so "inch AND a half" is a size and
  // never a place to cut the list.
  const s=_supSizes(String(text||'').replace(/\s+/g,' ').trim());
  if(!s)return [];
  const parts=s.split(/\s*[,;.]\s+|\s*[,;]\s*|\s+(?:and then|then|plus|also)\s+|\s+and\s+(?=(?:\d|a |an |one |two |three |four |five |six |seven |eight |nine |ten |twelve |twenty |thirty |fifty |a couple|a pair|a dozen|some ))/i);
  return parts.map(_supSpokenPiece).filter(Boolean);
}
// ── The host line ───────────────────────────────────────────────────────────
function _supMode(){
  if(typeof _geiIsTM!=='undefined'&&_geiIsTM)return 'tm';
  if(typeof _geiIsFreeForm!=='undefined'&&_geiIsFreeForm)return 'byo';
  return null;
}
function _supHost(create){
  const mode=_supMode();
  if(mode==='byo'){
    let it=(_byoItems||[]).find(x=>x&&x._supply);
    if(!it&&create){
      const nid=(_byoItems.reduce((m,x)=>Math.max(m,x.id||0),0))+1;
      it={id:nid,section:'Materials',label:'Materials',qty:1,unit:'lot',rate:0,price:0,on:true,required:false,notes:'',_supply:_supBlank()};
      _byoItems.push(it);
    }
    return it||null;
  }
  if(mode==='tm'){
    let l=(_geiLines||[]).find(x=>x&&x._supply);
    if(!l&&create){
      l={desc:'Materials',notes:'',qty:1,unit:'lot',rate:0,total:0,_supply:_supBlank()};
      _geiLines.push(l);
    }
    return l||null;
  }
  return null;
}
function _supData(){const h=_supHost(false);return h?h._supply:null;}

// Push the list's numbers onto its host line and let the estimate redraw the
// way it does for any other edit.
function _supSync(){
  const h=_supHost(false);
  if(!h)return;
  const d=h._supply;
  const price=_supPrice(d);
  const n=(d.items||[]).filter(it=>it&&it.on!==false).length;
  const label='Materials'+(d.vendor?' ('+d.vendor+')':'');
  // What the CLIENT reads under the line: what is in it, never what it cost.
  const notes=n?(n+' item'+(n===1?'':'s')+' per supply house quote'+(d.quote&&d.quote.number?' '+d.quote.number:'')):'';
  h._taxPaid=!!(d.quote&&d.quote.taxCharged);
  if(_supMode()==='byo'){
    h.label=label;h.qty=1;h.unit='lot';h.rate=price;h.price=price;h.notes=notes;
    if(typeof _byoRenderSections==='function')_byoRenderSections();
    if(typeof _byoUpdateRail==='function')_byoUpdateRail();
    if(typeof _byoAutosave==='function')_byoAutosave();
  }else{
    h.desc=label;h.qty=1;h.unit='lot';h.rate=price;h.total=price;h.notes=notes;
    if(typeof _tmRenderMatList==='function')_tmRenderMatList();
    if(typeof _tmInputChange==='function')_tmInputChange();
    if(typeof _byoAutosave==='function')_byoAutosave();
  }
}

// ── The card ─────────────────────────────────────────────────────────────────
// bare: T&M draws it inside its own Materials card, so no second card chrome.
// THE iPHONE SCREENS (owner, 2026-09-26: "Go for the iOS redesign"). On the
// T&M and BYO editors the card is a grouped iOS section like everything around
// it: one row per item with its price on the right and swipe to delete, the
// box to type into, Markup as a row with its value, the two totals as rows,
// and Send / Load as blue link rows. Same ids and handlers as the card below.
function _supCardIosHTML(){
  const d=_supData();
  const items=(d&&d.items)||[];
  const priced=_supPriced(d);
  const rows=items.map((it,i)=>{
    const off=it.on===false;
    return '<div class="ios-swipe" data-kind="sup">'+
      '<div class="ios-row sup-row sup-ios'+(off?' off':'')+'" data-i="'+i+'">'+
        '<button type="button" class="sup-tick'+(off?'':' on')+'" aria-label="'+(off?'Include':'Leave out')+'" onclick="_supToggle('+i+')"><span>'+(off?'':svgIcon('✓',{size:13}))+'</span></button>'+
        '<span class="ios-lbl">'+escHtml(it.desc)+'<small>'+escHtml(String(it.qty)+' '+(it.unit||'ea'))+(it.flag?' \u00b7 '+escHtml(it.flag):'')+'</small></span>'+
        '<button type="button" class="sup-price" aria-label="Price" onclick="_supEditCost('+i+')">'+(Number(it.cost)>0?_supMoney(it.cost):'<span class="ios-link">Add price</span>')+'</button>'+
      '</div>'+
      '<button type="button" class="ios-del" tabindex="-1" onclick="_supDel('+i+')">Delete</button>'+
    '</div>';
  }).join('');
  const cost=_supCost(d),price=_supPrice(d);
  const q=d&&d.quote;
  const foot=q
    ?(q.taxCharged?'Tax was charged on this quote, so no sales tax is added on these again.':'No tax on this quote, so sales tax goes on the price, markup included.')
    :(_supMode()==='tm'?'For you, not the customer: a T&M proposal bills materials as used.':'Type what you need, one item per line. Prices come from their quote.');
  return '<div class="ios-sec sup-card sup-ios-card" id="sup-card" data-bare="0">'+
    '<div class="ios-h"><span>Supply house</span>'+(d&&d.vendor?'<span class="s">'+escHtml(d.vendor)+'</span>':'')+'</div>'+
    '<div class="ios-group">'+
      rows+
      _supAddRowHtml()+
      // Talk the whole list in, on a phone that can dictate (2026-09-26).
      ((typeof _voiceCapable==='function'&&_voiceCapable())
        ?'<button type="button" class="ios-row ios-link sup-addpart" onclick="_supTalk()"><span class="sup-plus sup-mic" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/></svg></span>Say the parts</button>'+
         '<textarea id="sup-say" hidden aria-hidden="true"></textarea>'
        :'')+
      '<label class="ios-row"><span class="ios-lbl">Markup</span>'+
        '<span class="ios-val"><input id="sup-markup" type="number" inputmode="decimal" min="0" max="100" step="1" value="'+(d?_supClampMarkup(d.markup):0)+'" oninput="_supSetMarkup(this.value)">%</span></label>'+
      (priced
        ?'<div class="ios-row"><span class="ios-lbl">Your cost</span><span class="sup-fig">'+_supMoney(cost)+'</span></div>'+
         '<div class="ios-row"><span class="ios-lbl">'+(_supMode()==='tm'?'Billed at your markup':'Client price')+'</span><span class="sup-fig b">'+_supMoney(price)+'</span></div>'
        :(items.length?'<div class="ios-row"><span class="ios-lbl" style="color:var(--ios-2)">Waiting on their quote</span></div>':''))+
      '<button type="button" class="ios-row ios-link" onclick="_supOpenSend()"'+(items.length?'':' disabled')+'>Send to supply house</button>'+
      '<button type="button" class="ios-row ios-link" onclick="_supPickQuote()">Load their quote</button>'+
    '</div>'+
    '<div class="ios-foot">'+escHtml(foot)+'</div>'+
    '<input type="file" id="sup-quote-file" accept="application/pdf,image/*" style="display:none" onchange="_supQuoteChosen(this)">'+
  '</div>';
}
// ADDING A PART, THE REMINDERS WAY (owner, 2026-09-26: "Parts needs to be a
// intuitive add"). A grey box that wanted "3 ea 3/4 ball valve" typed in a
// shape nobody told him about was not it. Now: "Add a part" with a blue plus,
// tap it and a row opens with the cursor in it and a quantity stepper; type
// the part, press return, it is on the list and the next empty row is ready,
// so a whole list goes in without leaving the keyboard. "3 ea 3/4 ball valve"
// typed the old way still reads its count and unit, and a pasted list (one
// part per line) goes in whole.
let _supAdding=false,_supNewQty=1;
function _supAddRowHtml(){
  if(!_supAdding)return '<button type="button" class="ios-row ios-link sup-addpart" onclick="_supStartAdd()"><span class="sup-plus" aria-hidden="true">+</span>Add a part</button>';
  return '<div class="ios-row sup-new">'+
    '<span class="ios-step"><button type="button" aria-label="One fewer" onmousedown="event.preventDefault()" onclick="_supQtyStep(-1)">\u2212</button><span id="sup-new-qty">'+_supNewQty+'</span><button type="button" aria-label="One more" onmousedown="event.preventDefault()" onclick="_supQtyStep(1)">+</button></span>'+
    '<input id="sup-add" class="sup-new-in" type="text" placeholder="Part, e.g. 3/4 ball valve" autocomplete="off" autocapitalize="sentences" enterkeyhint="next" '+
      'onkeydown="if(event.key===\'Enter\'){event.preventDefault();_supAddOne();}" onpaste="_supPasteList(event)" onblur="_supAddBlur()">'+
  '</div>';
}
function _supRerender(){
  if(_supMode()==='byo'&&typeof _byoRenderSections==='function')_byoRenderSections();
  else if(typeof _tmRenderMatList==='function')_tmRenderMatList();
}
function _supFocusNew(){setTimeout(()=>{const el=document.getElementById('sup-add');if(el){try{el.focus({preventScroll:false});}catch(_e){el.focus();}}},30);}
function _supStartAdd(){_supAdding=true;_supNewQty=1;_supRerender();_supFocusNew();}
function _supQtyStep(d){
  _supNewQty=Math.max(1,Math.min(999,(_supNewQty||1)+d));
  const q=document.getElementById('sup-new-qty');if(q)q.textContent=_supNewQty;
  _supFocusNew();
}
function _supAddOne(){
  const el=document.getElementById('sup-add');
  const text=el?String(el.value||'').trim():'';
  if(!text){_supAdding=false;_supRerender();return;}
  const it=_supParseLine(text);if(!it)return;
  // The stepper is the count unless he typed one in the words.
  if(!/^\d+(\.\d+)?\s+\S/.test(text)||/^\d+\/\d/.test(text))it.qty=_supNewQty;
  const h=_supHost(true);
  h._supply.items=(h._supply.items||[]).concat([it]);
  _supNewQty=1;_supAdding=true;
  _supSync();
  _supFocusNew();
}
// A list pasted from a text or an email: one part per line, all of it.
function _supPasteList(ev){
  const t=(ev.clipboardData||window.clipboardData)?.getData('text')||'';
  if(!/\n/.test(t))return;
  ev.preventDefault();
  const lines=t.split(/\r?\n/).map(_supParseLine).filter(Boolean);
  if(!lines.length)return;
  const h=_supHost(true);
  h._supply.items=(h._supply.items||[]).concat(lines);
  _supSync();_supFocusNew();
}
// Leaving the empty row closes it, the way a blank reminder disappears.
function _supAddBlur(){
  setTimeout(()=>{
    const a=document.activeElement;
    if(a&&a.closest&&a.closest('.sup-new'))return;
    const el=document.getElementById('sup-add');
    if(el&&String(el.value||'').trim())return;
    if(_supAdding){_supAdding=false;_supRerender();}
  },180);
}
// Tim's listening sheet, pointed at the parts list. What he says lands as
// rows when he taps stop; the list is where he checks it (swipe to delete).
function _supTalk(){
  const el=document.getElementById('sup-say');if(el)el.value='';
  if(typeof _timTalkToggle==='function')_timTalkToggle('sup-say');
}
function _supFromSpeech(text){
  const items=_supParseSpoken(text);
  if(!items.length){if(typeof showToast==='function')showToast('I did not catch a part in that','🔧',2400);return 0;}
  const h=_supHost(true);
  h._supply.items=(h._supply.items||[]).concat(items);
  _supSync();
  if(typeof showToast==='function')showToast(items.length+' part'+(items.length>1?'s':'')+' added','✅',2200);
  return items.length;
}
function _supCardHTML(opts){
  const bare=!!(opts&&opts.bare);
  if(!bare&&!(opts&&opts.classic))return _supCardIosHTML();
  const d=_supData();
  const items=(d&&d.items)||[];
  const priced=_supPriced(d);
  const rows=items.map((it,i)=>{
    const off=it.on===false;
    const flag=it.flag?'<div style="font-size:11px;color:var(--amber-dk,#b45309);margin-top:2px">'+escHtml(it.flag)+'</div>':'';
    return '<div class="sup-row'+(off?' off':'')+'" data-i="'+i+'">'+
      '<button type="button" class="byo-check'+(off?'':' on')+'" aria-label="'+(off?'Include':'Leave out')+'" onclick="_supToggle('+i+')">'+(off?'':svgIcon('✓',{size:14}))+'</button>'+
      '<div class="sup-qty">'+escHtml(String(it.qty))+' '+escHtml(it.unit||'ea')+'</div>'+
      '<div class="sup-desc">'+escHtml(it.desc)+flag+'</div>'+
      '<button type="button" class="sup-cost" aria-label="Price" onclick="_supEditCost('+i+')">'+(Number(it.cost)>0?_supMoney(it.cost):'<span class="sup-cost-add">+ price</span>')+'</button>'+
      '<button type="button" class="sup-del" aria-label="Remove" onclick="_supDel('+i+')">'+svgIcon('✕',{size:12})+'</button>'+
    '</div>';
  }).join('');
  const cost=_supCost(d),price=_supPrice(d);
  const q=d&&d.quote;
  const taxNote=q
    ?(q.taxCharged
      ?'Tax was charged on this quote, so no sales tax is added on these again.'
      :'No tax on this quote, so sales tax goes on the client price, markup included.')
    :'';
  return '<div class="'+(bare?'sup-card sup-bare':'card card-pad-0 sup-card')+'" id="sup-card" data-bare="'+(bare?1:0)+'" style="margin-bottom:12px">'+
    '<div class="card-hd"><div class="card-hd-title">'+svgIcon('🧾',{size:14})+' Supply house materials</div>'+
      (d&&d.vendor?'<div style="font-size:11px;color:var(--text3)">'+escHtml(d.vendor)+'</div>':'')+
    '</div>'+
    '<div style="padding:'+(bare?'4px 0 12px':'4px 14px 12px')+'">'+
      (rows?'<div class="sup-list">'+rows+'</div>':'<div style="padding:10px 0;font-size:12px;color:var(--text-3)">Type what you need, one item per line. Prices come from their quote.</div>')+
      '<textarea id="sup-add" rows="2" placeholder="3 ea 3/4 ball valve&#10;20 ft 2in PVC" style="width:100%;margin-top:8px;padding:9px 11px;border:1.5px solid var(--border2);border-radius:var(--r);font-size:14px;font-family:inherit;background:var(--bg2);color:var(--text);resize:vertical;box-sizing:border-box"></textarea>'+
      '<button type="button" class="btn btn-sm" style="margin-top:6px" onclick="_supAddFromBox()">+ Add to list</button>'+
      '<div class="sup-markup">'+
        '<label for="sup-markup">Markup</label>'+
        '<div style="display:flex;align-items:center;gap:6px">'+
          '<input id="sup-markup" type="number" inputmode="decimal" min="0" max="100" step="1" value="'+(d?_supClampMarkup(d.markup):0)+'" oninput="_supSetMarkup(this.value)" style="width:72px;padding:7px 8px;border:1.5px solid var(--border2);border-radius:var(--r);font-size:15px;background:var(--bg2);color:var(--text);text-align:right">'+
          '<span style="font-size:14px;color:var(--text2);font-weight:600">%</span>'+
        '</div>'+
      '</div>'+
      (priced
        ?'<div class="sup-totals"><span>Your cost '+_supMoney(cost)+'</span><span><b>'+(_supMode()==='tm'?'Billed at your markup ':'Client price ')+_supMoney(price)+'</b></span></div>'
        :(items.length?'<div class="sup-totals"><span style="color:var(--text3)">Waiting on their quote for prices</span></div>':''))+
      (taxNote?'<div style="font-size:11px;color:var(--text3);margin-top:6px;line-height:1.4">'+escHtml(taxNote)+'</div>':'')+
      '<div class="sup-actions">'+
        '<button type="button" class="btn" onclick="_supOpenSend()"'+(items.length?'':' disabled')+'>Send to supply house</button>'+
        '<button type="button" class="btn btn-p" onclick="_supPickQuote()">Load their quote</button>'+
      '</div>'+
      '<input type="file" id="sup-quote-file" accept="application/pdf,image/*" style="display:none" onchange="_supQuoteChosen(this)">'+
    '</div>'+
  '</div>';
}

function _supAddFromBox(){
  const box=document.getElementById('sup-add');
  const text=box?box.value:'';
  const lines=String(text||'').split(/\r?\n/).map(_supParseLine).filter(Boolean);
  if(!lines.length){box&&box.focus();return;}
  const h=_supHost(true);
  h._supply.items=(h._supply.items||[]).concat(lines);
  _supSync();
}
function _supToggle(i){
  const d=_supData();if(!d||!d.items[i])return;
  d.items[i].on=d.items[i].on===false;
  _supSync();
}
function _supDel(i){
  const d=_supData();if(!d||!d.items[i])return;
  d.items.splice(i,1);
  _supSync();
}
// Any line's price, by hand: a flagged line from the reader, a quote read on
// a computer where there is no reader, or a supply house that phoned it in.
function _supEditCost(i){
  const d=_supData();if(!d||!d.items[i])return;
  const it=d.items[i];
  const apply=v=>{
    const n=_supNum(v);
    if(n===null||n<0)return;
    it.cost=_supCents(n);it.flag='';
    _supSync();
  };
  if(typeof zPrompt==='function'){
    zPrompt(escHtml(it.qty+' '+(it.unit||'ea')+' '+it.desc),apply,{title:'Line total',placeholder:'0.00',value:Number(it.cost)>0?String(it.cost):''});
  }
}
let _supMarkupTimer=null;
function _supSetMarkup(v){
  const d=_supHost(true)._supply;
  d.markup=_supClampMarkup(v);
  // Typing "25" is two keystrokes; redrawing the card between them would eat
  // the cursor. Numbers update after the pause, the saved value immediately.
  clearTimeout(_supMarkupTimer);
  _supMarkupTimer=setTimeout(()=>{
    const el=document.getElementById('sup-markup');
    const focused=el&&document.activeElement===el;
    _supSync();
    if(focused){const again=document.getElementById('sup-markup');if(again){again.focus();const n=again.value.length;try{again.setSelectionRange(n,n);}catch(_e){}}}
  },350);
}

// ── Reading their quote back ────────────────────────────────────────────────
//
// The server returns what it read; this decides what to trust. Every rule is
// arithmetic the quote already printed, so it holds for any supply house.
function _supCheckQuote(q){
  const out={vendor:'',number:'',date:'',reference:'',taxCharged:false,subtotal:null,lines:[],sumOk:false,flagged:0};
  if(!q||typeof q!=='object')return out;
  out.vendor=String(q.vendor||'').trim();
  out.number=String(q.quote_number||'').trim();
  out.date=String(q.date||'').trim();
  out.reference=String(q.reference||'').trim();
  const taxAmt=Number(q.tax_amount);
  // Tax is CHARGED only when the quote shows a tax amount above zero. A quote
  // that says "taxes not included", or shows no tax line at all, came in
  // untaxed, which is the case where the client is charged sales tax.
  out.taxCharged=q.tax_included===true&&isFinite(taxAmt)&&taxAmt>0;
  out.subtotal=isFinite(Number(q.subtotal))&&q.subtotal!==null?_supCents(q.subtotal):null;
  const lines=Array.isArray(q.lines)?q.lines:[];
  lines.forEach(l=>{
    if(!l||typeof l!=='object')return;
    const desc=String(l.description||'').trim().replace(/\s+/g,' ');
    if(!desc)return;
    const qty=Number(l.qty);
    const unitPrice=Number(l.unit_price);
    let ext=Number(l.ext);
    let flag='';
    if(!(qty>0)){flag='Could not read the quantity. Check this line.';}
    if(!isFinite(ext)||ext<0){
      if(qty>0&&unitPrice>=0){ext=_supCents(qty*unitPrice);}
      else{ext=0;flag='Could not read the price. Check this line.';}
    }
    // Unit prices print to three places (32.579), lines to two: half a cent of
    // rounding per unit is the printer, anything past that is a misread.
    if(!flag&&qty>0&&isFinite(unitPrice)&&unitPrice>=0){
      const expect=qty*unitPrice;
      if(Math.abs(expect-ext)>Math.max(0.011,qty*0.0051)){
        flag='Does not add up: '+qty+' x '+unitPrice+' is '+_supMoney(expect)+', the quote says '+_supMoney(ext)+'.';
      }
    }
    if(flag)out.flagged++;
    out.lines.push({qty:qty>0?qty:1,unit:String(l.unit||'ea').toLowerCase().slice(0,8)||'ea',part:String(l.part||'').trim(),desc,cost:_supCents(ext),on:true,flag});
  });
  const sum=_supCents(out.lines.reduce((s,l)=>s+l.cost,0));
  out.sum=sum;
  out.total=isFinite(Number(q.total))&&q.total!==null?_supCents(q.total):null;
  // The subtotal is checked first. A quote with no tax and no freight also
  // prints the same number as its amount due, which is a second chance when
  // OCR misread one of the two (Neenan's "$" read as a "3": 3315.72).
  out.sumOk=(out.subtotal!==null&&Math.abs(sum-out.subtotal)<0.015)
    ||(!out.taxCharged&&out.total!==null&&Math.abs(sum-out.total)<0.015);
  // ONE bad line and a total that disagrees: the quote's own total settles
  // it. If exactly one whole-number quantity of that line's unit price makes
  // the lines add up, that is the line; anything looser stays flagged.
  const bad=out.lines.filter(l=>l.flag);
  if(!out.sumOk&&bad.length===1){
    const b=bad[0];
    const src=lines.find(l=>l&&String(l.description||'').trim().replace(/\s+/g,' ')===b.desc);
    const up=src?Number(src.unit_price):NaN;
    const targets=[out.subtotal,out.taxCharged?null:out.total].filter(t=>t!==null);
    let fixed=null;
    if(up>0){
      for(let k=1;k<=500&&!fixed;k++){
        const ext=_supCents(k*up);
        for(const t of targets){
          if(Math.abs(sum-b.cost+ext-t)<0.015){fixed={k,ext,t};break;}
        }
      }
    }
    if(fixed){
      b.qty=fixed.k;b.cost=fixed.ext;b.flag='';out.flagged--;
      b.note='Price checked against the quote total';
      out.sum=_supCents(out.lines.reduce((s2,l)=>s2+l.cost,0));
      out.sumOk=true;
      out.subtotal=fixed.t;
    }
  }
  if(out.sumOk&&out.subtotal!==null&&Math.abs(out.sum-out.subtotal)>=0.015)out.subtotal=out.total;
  return out;
}

function _supPickQuote(){
  const inp=document.getElementById('sup-quote-file');
  if(inp){inp.value='';inp.click();}
}
function _supQuoteChosen(input){
  const f=input&&input.files&&input.files[0];
  if(f)_supImportBlob(f);
}
function _supBlobToB64(blob){
  return new Promise((res,rej)=>{
    const r=new FileReader();
    r.onload=()=>{const s=String(r.result||'');res(s.slice(s.indexOf(',')+1));};
    r.onerror=()=>rej(r.error||new Error('read failed'));
    r.readAsDataURL(blob);
  });
}
function _supReader(){
  return (typeof _rcptNativePlugin==='function')?_rcptNativePlugin():null;
}
let _supImporting=false;
// src: a File/Blob from the Load button, or {path} from Share > TradeDesk.
async function _supImportBlob(src){
  if(_supImporting)return false;
  _supImporting=true;
  try{
    const P=_supReader();
    if(!P||typeof P.recognizeText!=='function'){
      if(typeof zAlert==='function')zAlert('Reading a quote works in the TradeDesk app on your iPhone. Here, tap any price on the list to type it in.',{title:'Open it on your phone'});
      return false;
    }
    let args;
    if(src&&typeof src.path==='string'){
      args={path:src.path};
    }else{
      const type=src&&src.type?src.type:'application/pdf';
      if(!/^(application\/pdf|image\/(png|jpe?g|gif|webp|heic))$/.test(type)){
        if(typeof showToast==='function')showToast('That file is not a PDF or photo','⚠️');
        return false;
      }
      if(src.size>25*1024*1024){
        if(typeof showToast==='function')showToast('That file is too big to read','⚠️');
        return false;
      }
      args={base64:await _supBlobToB64(src),mime:type};
    }
    _supShowReading(true);
    const r=await P.recognizeText(args);
    _supShowReading(false);
    const boxes=(r&&Array.isArray(r.boxes))?r.boxes:[];
    const rows=boxes.length?_supRowsFromBoxes(boxes):((r&&Array.isArray(r.lines))?r.lines:[]);
    const d=_supData();
    const checked=_supCheckQuote(_supParseQuoteText(rows,{reference:d&&d.sentRef}));
    if(!checked.lines.length){
      if(typeof zAlert==='function')zAlert('Could not find any line items on that. Share the PDF they emailed rather than a photo of it, or type the prices on each line.',{title:'Nothing to read'});
      return false;
    }
    _supReview(checked);
    return true;
  }catch(_e){
    _supShowReading(false);
    if(typeof zAlert==='function')zAlert('Could not read that quote. Try the PDF they emailed, or type the prices on each line.',{title:'Quote not read'});
    return false;
  }finally{
    _supImporting=false;
  }
}

// ── Words back into rows ────────────────────────────────────────────────────
//
// Vision hands back each column of a row as its own piece of text, with its
// position. A row is the pieces whose vertical centres sit within half a line
// of each other; left to right within it. The gap between columns becomes two
// spaces so the parser can still see where one column ends.
function _supRowsFromBoxes(boxes){
  const pts=(Array.isArray(boxes)?boxes:[]).filter(b=>b&&typeof b.text==='string'&&b.text.trim()&&isFinite(Number(b.y)))
    .map(b=>({t:b.text.trim(),p:Number(b.page)||0,x:Number(b.x)||0,y:Number(b.y),h:Math.max(0.004,Number(b.h)||0.01)}));
  if(!pts.length)return [];
  pts.forEach(q=>{q.cy=q.y+q.h/2;});
  pts.sort((a,b)=>a.p-b.p||a.cy-b.cy);
  const hs=pts.map(q=>q.h).sort((a,b)=>a-b);
  const tol=hs[Math.floor(hs.length/2)]*0.55;
  const rows=[];
  pts.forEach(q=>{
    const last=rows[rows.length-1];
    if(last&&last.p===q.p&&Math.abs(q.cy-last.cy)<=tol){
      last.items.push(q);
      last.cy=(last.cy*(last.items.length-1)+q.cy)/last.items.length;
    }else rows.push({p:q.p,cy:q.cy,items:[q]});
  });
  return rows.map(r=>r.items.sort((a,b)=>a.x-b.x).map(q=>q.t).join('  '));
}

// ── Rows into a quote ───────────────────────────────────────────────────────
//
// Plain rules, written from how supply house quotes print (the Neenan quotes
// the owner sent, S3318549 and S3317925): an item row STARTS with a quantity
// and unit ("3ea", "10ft", "1cl"), then a part number, then the description,
// and ENDS with the unit price and the line total. A row with neither is the
// description carrying on from the row above. Everything the quote says about
// tax and totals is read from its own labelled lines.
const _SUP_Q_UNITS='ea|ft|lf|cl|pc|pk|bx|rl|cs|gal|lb|pr|st|bg|sh|sq|lot|set|box|bag|roll|coil';
function _supFixDigits(s){
  // What OCR confuses inside a NUMBER: l/I/|/! for 1, O/o/Q for 0, S for 5, B for 8.
  return String(s).replace(/[lI|!]/g,'1').replace(/[OoQ]/g,'0').replace(/S/g,'5').replace(/B/g,'8');
}
function _supNum(s){
  const v=parseFloat(String(s==null?'':s).replace(/[$,\s]/g,''));
  return isFinite(v)?v:null;
}
function _supParseQuoteText(rows,opts){
  const L=(Array.isArray(rows)?rows:[]).map(x=>String(x==null?'':x).replace(/\s+$/,'')).filter(x=>x.trim());
  const out={vendor:'',quote_number:'',date:'',reference:'',tax_included:false,tax_amount:null,subtotal:null,total:null,lines:[]};
  if(!L.length)return out;
  out.vendor=L[0].trim().split(/\s{2,}/)[0].replace(/\s*(quotation|quote|invoice)\s*$/i,'').trim();
  const all=L.join('\n');
  // Neenan numbers its quotes S3318549; OCR reads the S as a $ about as
  // often as not.
  const qs=all.match(/(?:^|[\s|])[S$](\d{6,9})\b/);
  const qn=qs?null:all.match(/(?:quote|invoice)\s*(?:no\.?|number|#)\s*[:#]?\s*([A-Z0-9-]{4,})/i);
  if(qs)out.quote_number='S'+qs[1];else if(qn)out.quote_number=qn[1];
  const dt=all.match(/\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/);
  if(dt)out.date=dt[1];
  // The reference we sent is the one we look for: it is what they copied
  // into their customer order number.
  const ref=String((opts&&opts.reference)||'').trim();
  if(ref){
    const key=ref.toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
    const firstWord=key.split(' ')[0];
    if(firstWord&&all.toUpperCase().replace(/[^A-Z0-9\n]+/g,' ').includes(firstWord))out.reference=ref;
  }
  const money='\\$?\\s*([\\d,]+\\.\\d{2})\\b';
  const moneyRe=new RegExp(money);
  let inItems=true;
  const rowRe=new RegExp('^\\s*([0-9lIoO|!]{1,5}(?:\\.\\d+)?)\\s*('+_SUP_Q_UNITS+')\\b\\s+(.*?)\\s+(\\d{1,6}\\.\\d{2,4})\\s+(\\d{1,7}(?:,\\d{3})*\\.\\d{2})\\s*$','i');
  // Table rules and column borders that OCR reads as characters: | { } [ ]
  // and a ")" or "/" glued to the end of a part number. A "3/4" or an inch
  // mark inside a description is left alone.
  const clean=t=>String(t).replace(/[|{}\[\]\u201C\u201D~=\u2014]+/g,' ').replace(/(\d)[)\/](?=\s|$)/g,'$1 ').replace(/\s{3,}/g,'  ').trim();
  const rowRe2=new RegExp('^(.{0,14}?)\\s*\\b(\\d{3,8})\\s+(.+?)\\s+(\\d{1,6}\\.\\d{2,4})\\)?\\s+(\\d{1,7}(?:,\\d{3})*\\.\\d{2})\\s*$','i');
  const unitRe=new RegExp('('+_SUP_Q_UNITS+')\\s*$','i');
  L.forEach((raw,i)=>{
    const line=clean(raw);
    const low=line.toLowerCase();
    if(/sub\s*-?\s*total/.test(low)){
      inItems=false;
      const m=line.match(moneyRe)||(L[i+1]||'').match(moneyRe);
      if(m)out.subtotal=_supNum(m[1]);
      return;
    }
    if(/amount due|grand total|^\s*total\b|balance due/.test(low)){
      inItems=false;
      const m=line.match(moneyRe)||(L[i+1]||'').match(moneyRe);
      if(m)out.total=_supNum(m[1]);
      return;
    }
    if(/tax/.test(low)){
      if(/not included|extra|exempt|excluded/.test(low))return;
      const m=line.match(moneyRe);
      if(m&&_supNum(m[1])>0){out.tax_included=true;out.tax_amount=_supNum(m[1]);}
      return;
    }
    if(!inItems)return;
    const m=line.match(rowRe);
    // A row whose quantity OCR mangled ("Teal", "dea"): the part number and
    // the two prices still say it is an item. The quantity comes back from
    // the arithmetic below, or it is flagged for him.
    const m2=m?null:line.match(rowRe2);
    if(m2){
      const pre=m2[1].trim();
      const qm=pre.match(/([0-9lIoO!]{1,4})\s*([a-z]{1,4})?\s*$/i);
      const q=qm?_supNum(_supFixDigits(qm[1])):null;
      const um=pre.match(unitRe);
      out.lines.push({
        qty:(q>0&&qm&&um&&qm[2]&&qm[2].toLowerCase()===um[1].toLowerCase())?q:null,
        unit:um?um[1].toLowerCase():'ea',
        part:m2[2],description:m2[3].replace(/\s{2,}/g,' ').trim(),
        unit_price:_supNum(m2[4]),ext:_supNum(m2[5]),
      });
      return;
    }
    if(m){
      const qty=_supNum(_supFixDigits(m[1]));
      const rest=m[3].trim();
      const pm=rest.match(/^([A-Z0-9-]{2,})\s+(.*)$/i);
      const hasPart=pm&&/\d/.test(pm[1]);
      out.lines.push({
        qty:qty>0?qty:null,unit:m[2].toLowerCase(),
        part:hasPart?pm[1]:'',description:(hasPart?pm[2]:rest).replace(/\s{2,}/g,' ').trim(),
        unit_price:_supNum(m[4]),ext:_supNum(m[5]),
      });
      return;
    }
    // Carries the description of the row above, if there is one and this
    // line prints no prices of its own.
    const prev=out.lines[out.lines.length-1];
    if(prev&&!/\d+\.\d{2}\s*$/.test(line)&&!/^[A-Z ]*:\s*$/.test(line)){
      prev.description=(prev.description+' '+line.replace(/\s{2,}/g,' ').trim()).trim();
    }
  });
  // A quantity OCR could not read, recovered from the arithmetic the quote
  // printed: only when line / unit price is a whole number, so a guess never
  // gets in.
  out.lines.forEach(l=>{
    if(l.qty==null&&l.unit_price>0&&l.ext>0){
      const q=l.ext/l.unit_price,r=Math.round(q);
      if(r>=1&&Math.abs(q-r)*l.unit_price<0.011)l.qty=r;
    }
  });
  return out;
}

function _supShowReading(on){
  const id='_sup-reading';
  document.getElementById(id)?.remove();
  if(!on)return;
  const ov=document.createElement('div');ov.id=id;ov.className='zmodal-overlay';
  ov.innerHTML='<div class="zmodal" style="max-width:360px">'+
    '<div class="zmodal-title">Reading their quote</div>'+
    '<div class="td-skel" style="height:14px;border-radius:6px;margin:14px 0 8px"></div>'+
    '<div class="td-skel" style="height:14px;border-radius:6px;margin-bottom:8px;width:82%"></div>'+
    '<div class="td-skel" style="height:14px;border-radius:6px;width:64%"></div>'+
  '</div>';
  document.body.appendChild(ov);
}

// The one look before it lands: every line with its tick box, the flagged
// ones in amber, and whether the lines add up to the quote's own subtotal.
let _supPending=null;
function _supReview(checked){
  _supPending=checked;
  document.getElementById('_sup-review')?.remove();
  const ov=document.createElement('div');ov.id='_sup-review';ov.className='zmodal-overlay';
  const m=document.createElement('div');m.className='zmodal';m.style.maxWidth='520px';
  const head=(checked.vendor||'Supply house')+(checked.number?' · '+checked.number:'');
  const sumLine=checked.subtotal===null
    ?'<div class="tip tip-w" style="margin:10px 0">Could not find the quote\'s subtotal to check the lines against.</div>'
    :(checked.sumOk
      ?'<div style="font-size:12px;color:var(--green-dk,#15803d);margin:8px 0">Lines add up to their subtotal, '+_supMoney(checked.subtotal)+'.</div>'
      :'<div class="tip tip-w" style="margin:10px 0">Lines add up to '+_supMoney(checked.sum)+' but the quote says '+_supMoney(checked.subtotal)+'. Check the amber lines.</div>');
  const tax=checked.taxCharged
    ?'Tax was charged on this quote.'
    :'No tax on this quote.';
  m.innerHTML='<div class="zmodal-title">'+escHtml(head)+'</div>'+
    '<div style="font-size:12px;color:var(--text3)">'+escHtml(tax)+(checked.reference?' Reference: '+escHtml(checked.reference)+'.':'')+'</div>'+
    sumLine+
    '<div class="sup-list" id="_sup-review-list" style="max-height:48vh;overflow-y:auto">'+
      checked.lines.map((l,i)=>
        '<div class="sup-row'+(l.flag?' flag':'')+'">'+
          '<button type="button" class="byo-check on" data-i="'+i+'" onclick="_supReviewToggle(this)">'+svgIcon('✓',{size:14})+'</button>'+
          '<div class="sup-qty">'+escHtml(String(l.qty))+' '+escHtml(l.unit)+'</div>'+
          '<div class="sup-desc">'+escHtml(l.desc)+(l.flag?'<div style="font-size:11px;color:var(--amber-dk,#b45309);margin-top:2px">'+escHtml(l.flag)+'</div>':'')+(l.note?'<div style="font-size:11px;color:var(--text3);margin-top:2px">'+escHtml(l.note)+'</div>':'')+'</div>'+
          '<div class="sup-cost">'+_supMoney(l.cost)+'</div>'+
        '</div>').join('')+
    '</div>'+
    '<div style="font-size:11px;color:var(--text3);margin:8px 0 12px">Untick anything you are not buying, like the other water heater on a quote that prices two.</div>'+
    '<div style="display:flex;gap:10px">'+
      '<button class="btn" style="flex:1" onclick="document.getElementById(\'_sup-review\')?.remove()">Cancel</button>'+
      '<button class="btn btn-p" style="flex:2" id="_sup-apply" onclick="_supApplyReview()">Use these prices</button>'+
    '</div>';
  ov.appendChild(m);
  document.body.appendChild(ov);
}
function _supReviewToggle(btn){
  if(!_supPending)return;
  const i=Number(btn.dataset.i);
  const l=_supPending.lines[i];if(!l)return;
  l.on=!l.on;
  btn.classList.toggle('on',l.on);
  btn.innerHTML=l.on?svgIcon('✓',{size:14}):'';
}
function _supApplyReview(){
  const c=_supPending;
  if(!c)return false;
  const h=_supHost(true);
  if(!h)return false;
  const d=h._supply;
  d.items=c.lines.map(l=>({qty:l.qty,unit:l.unit,part:l.part,desc:l.desc,cost:l.cost,on:l.on!==false,flag:l.flag||''}));
  if(c.vendor)d.vendor=c.vendor;
  d.quote={number:c.number,date:c.date,reference:c.reference,taxCharged:!!c.taxCharged,subtotal:c.subtotal,readAt:new Date().toISOString()};
  _supPending=null;
  document.getElementById('_sup-review')?.remove();
  _supSync();
  if(typeof showToast==='function')showToast('Quote prices added','✓');
  return true;
}

// ── Sending the list ────────────────────────────────────────────────────────
//
// A plain PDF, written here: no library, no network to build it. Letter size,
// Helvetica, one line per item. The job reference goes in its own labelled
// block because that is where the supply house copies it from into their
// "customer order number", which is how the quote comes back tagged.
function _supPdfEsc(s){
  return String(s==null?'':s)
    .replace(/[\u2018\u2019]/g,"'").replace(/[\u201C\u201D]/g,'"').replace(/[\u2013\u2014]/g,'-')
    .replace(/[^\x20-\x7E]/g,'?')
    .replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
}
function _supWrap(text,max){
  const words=String(text||'').split(/\s+/).filter(Boolean);
  const out=[];let cur='';
  words.forEach(w=>{
    if(!cur)cur=w;
    else if((cur+' '+w).length<=max)cur+=' '+w;
    else{out.push(cur);cur=w;}
  });
  if(cur)out.push(cur);
  return out.length?out:[''];
}
function _supPdfBytes(o){
  const items=(o&&o.items)||[];
  const pages=[];let ops=[];let y=0;
  const W=612,H=792,L=54;
  const newPage=()=>{if(ops.length)pages.push(ops.join('\n'));ops=[];y=H-60;};
  const text=(x,yy,size,bold,s)=>ops.push('BT /'+(bold?'F2':'F1')+' '+size+' Tf '+x+' '+yy+' Td ('+_supPdfEsc(s)+') Tj ET');
  const rule=(yy)=>ops.push('0.75 w '+L+' '+yy+' m '+(W-L)+' '+yy+' l S');
  newPage();
  text(L,y,18,true,o.business||'Materials request');y-=18;
  if(o.businessLine){text(L,y,10,false,o.businessLine);y-=14;}
  y-=10;
  text(L,y,14,true,'Materials quote request');y-=18;
  text(L,y,10,false,'Date: '+(o.date||''));y-=14;
  if(o.to){text(L,y,10,false,'To: '+o.to);y-=14;}
  y-=6;
  text(L,y,11,true,'Job reference (please put on your quote): '+(o.reference||''));y-=14;
  if(o.shipTo){text(L,y,10,false,'Job address: '+o.shipTo);y-=14;}
  y-=10;
  const head=()=>{text(L,y,10,true,'QTY');text(L+60,y,10,true,'UNIT');text(L+110,y,10,true,'DESCRIPTION');y-=6;rule(y);y-=14;};
  head();
  items.forEach(it=>{
    const lines=_supWrap(it.desc,70);
    if(y-lines.length*13<70){newPage();head();}
    text(L,y,10,false,String(it.qty));
    text(L+60,y,10,false,it.unit||'ea');
    lines.forEach((ln,i)=>{text(L+110,y-i*13,10,false,ln);});
    y-=lines.length*13+5;
  });
  y-=8;rule(y);y-=16;
  if(y<90){newPage();}
  text(L,y,10,false,'Please quote prices and availability. Reply to this email with your quote.');y-=14;
  if(o.contact){text(L,y,10,false,'Questions: '+o.contact);}
  newPage();
  // Objects: 1 catalog, 2 pages, 3 F1, 4 F2, then page+content pairs.
  const objs=[];
  objs[1]='<< /Type /Catalog /Pages 2 0 R >>';
  const kids=pages.map((_,i)=>(5+i*2)+' 0 R').join(' ');
  objs[2]='<< /Type /Pages /Kids ['+kids+'] /Count '+pages.length+' >>';
  objs[3]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objs[4]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  pages.forEach((content,i)=>{
    const pn=5+i*2,cn=6+i*2;
    objs[pn]='<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+W+' '+H+'] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents '+cn+' 0 R >>';
    objs[cn]='<< /Length '+content.length+' >>\nstream\n'+content+'\nendstream';
  });
  let pdf='%PDF-1.4\n';
  const offs=[];
  for(let i=1;i<objs.length;i++){offs[i]=pdf.length;pdf+=i+' 0 obj\n'+objs[i]+'\nendobj\n';}
  const xref=pdf.length;
  pdf+='xref\n0 '+objs.length+'\n0000000000 65535 f \n';
  for(let i=1;i<objs.length;i++)pdf+=String(offs[i]).padStart(10,'0')+' 00000 n \n';
  pdf+='trailer\n<< /Size '+objs.length+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';
  const bytes=new Uint8Array(pdf.length);
  for(let i=0;i<pdf.length;i++)bytes[i]=pdf.charCodeAt(i)&0xff;
  return bytes;
}

// The job reference the supply house types into their customer order number:
// the client's last name and the street, the same thing Neenan's writer put
// there by hand on the quotes the owner sent ("STEINHOFF", "5713 SW 14TH").
function _supReference(){
  let c=null;
  try{c=(typeof _geiClientId!=='undefined'&&_geiClientId&&typeof clients!=='undefined')?clients.find(x=>x&&x.id===_geiClientId):null;}catch(_e){}
  const name=String((c&&c.name)||'').trim();
  const last=name.split(/[\s,&]+/).filter(Boolean).pop()||'';
  const addr=String((document.getElementById('gei-addr')||{}).value||(c&&c.address)||'').trim();
  const street=addr.split(',')[0].trim();
  return [last.toUpperCase(),street.toUpperCase()].filter(Boolean).join(' · ')||'JOB';
}

function _supHouses(){
  return (typeof S!=='undefined'&&S&&Array.isArray(S.supplyHouses))?S.supplyHouses:[];
}
function _supOpenSend(){
  const d=_supData();
  if(!d||!(d.items||[]).length)return;
  const last=_supHouses()[0]||{};
  document.getElementById('_sup-send')?.remove();
  const ov=document.createElement('div');ov.id='_sup-send';ov.className='zmodal-overlay';
  ov.innerHTML='<div class="zmodal" style="max-width:420px">'+
    '<div class="zmodal-title">Send to supply house</div>'+
    '<div class="f" style="margin:12px 0 8px"><label>Supply house</label><input id="sup-send-name" type="text" value="'+escHtml(d.vendor||last.name||'')+'" placeholder="e.g. Neenan Co. Topeka"></div>'+
    '<div class="f" style="margin-bottom:8px"><label>Their email</label><input id="sup-send-email" type="email" inputmode="email" value="'+escHtml(d.vendorEmail||last.email||'')+'" placeholder="quotes@supplyhouse.com"></div>'+
    '<div class="f" style="margin-bottom:12px"><label>Job reference on the quote</label><input id="sup-send-ref" type="text" value="'+escHtml(_supReference())+'"></div>'+
    '<div style="font-size:11px;color:var(--text3);margin-bottom:14px">Opens your email with the list of '+d.items.length+' item'+(d.items.length===1?'':'s')+' attached. It sends from your account, so they reply to you.</div>'+
    '<div style="display:flex;gap:10px">'+
      '<button class="btn" style="flex:1" onclick="document.getElementById(\'_sup-send\')?.remove()">Cancel</button>'+
      '<button class="btn btn-p" style="flex:2" id="sup-send-go" onclick="_supSend()">Open in my email</button>'+
    '</div>'+
  '</div>';
  document.body.appendChild(ov);
}
// Sent from HIS mail app, not ours (owner 2026-09-26): "open up the
// contractor's own email app and send from there with the quote attached."
//   1. Apple Mail's composer (TdDoc.composeEmail), prefilled: their address,
//      the subject, a short note and the PDF. It sends from his account and
//      the supply house replies to him.
//   2. No Mail account on the phone (Gmail or Outlook only): the share sheet
//      with the PDF, where those apps are. The share sheet cannot prefill a
//      recipient, so their address is copied first to paste.
//   3. A computer: the PDF downloads and his mail program opens addressed,
//      with a note to attach it. A mailto link cannot carry a file.
let _supSending=false;
function _supEmailParts(name,ref,count){
  const biz=(typeof getBusinessName==='function')?getBusinessName():((typeof S!=='undefined'&&S&&S.bname)||'');
  const subject='Quote request: '+(ref||'materials')+(biz?' ('+biz+')':'');
  const body='Hi'+(name?' '+name:'')+',\n\n'+
    'Please quote the '+count+' item'+(count===1?'':'s')+' on the attached list.\n\n'+
    'Job reference: '+(ref||'see attached')+'\n'+
    'Please put this on your quote as the customer order number.\n\n'+
    'Thank you,\n'+(biz||'');
  const filename='Materials '+String(ref||'list').replace(/[^A-Za-z0-9 ._-]/g,'').slice(0,50).trim()+'.pdf';
  return {subject,body,filename,biz};
}
function _supB64(bytes){
  let bin='';for(let i=0;i<bytes.length;i++)bin+=String.fromCharCode(bytes[i]);
  return btoa(bin);
}
async function _supSend(){
  if(_supSending)return false;
  const d=_supData();if(!d)return false;
  const name=String((document.getElementById('sup-send-name')||{}).value||'').trim();
  const email=String((document.getElementById('sup-send-email')||{}).value||'').trim();
  const ref=String((document.getElementById('sup-send-ref')||{}).value||'').trim()||_supReference();
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){
    document.getElementById('sup-send-email')?.focus();
    if(typeof showToast==='function')showToast('Enter their email address','⚠️');
    return false;
  }
  _supSending=true;
  try{
    const parts=_supEmailParts(name,ref,d.items.length);
    const contact=[(typeof S!=='undefined'&&S&&S.bphone)||'',(typeof _supaUser!=='undefined'&&_supaUser&&_supaUser.email)||((typeof S!=='undefined'&&S&&S.bemail)||'')].filter(Boolean);
    const pdf=_supPdfBytes({
      business:parts.biz,businessLine:contact.join('  ·  '),
      date:(typeof todayKey==='function')?todayKey():'',
      to:name,reference:ref,shipTo:String((document.getElementById('gei-addr')||{}).value||'').trim(),contact:contact.join('  ·  '),
      items:d.items.map(it=>({qty:it.qty,unit:it.unit,desc:it.desc})),
    });
    const how=await _supDeliver(email,parts,pdf);
    if(how==='cancelled')return false;
    // Remember the house so the next list is one tap.
    if(typeof S!=='undefined'&&S){
      const list=_supHouses().filter(h=>h&&String(h.email).toLowerCase()!==email.toLowerCase());
      S.supplyHouses=[{name,email}].concat(list).slice(0,5);
      S.settingsTs=Date.now();
      if(typeof saveAll==='function')saveAll();
    }
    d.vendor=name||d.vendor;d.vendorEmail=email;d.sentAt=new Date().toISOString();d.sentRef=ref;
    document.getElementById('_sup-send')?.remove();
    _supSync();
    if(typeof showToast==='function'){
      if(how==='download')showToast('PDF saved. Attach it to the email that opened','📎');
      else showToast(how==='saved'?'Saved to your drafts':'Sent from your email','✓');
    }
    return true;
  }catch(_e){
    if(typeof zAlert==='function')zAlert('Could not open your email. Try again, or send the list from your email yourself.',{title:'Not sent'});
    return false;
  }finally{
    _supSending=false;
  }
}
// Returns 'sent' | 'saved' | 'shared' | 'download' | 'cancelled'.
async function _supDeliver(email,parts,pdf){
  const P=_supReader();
  if(P&&typeof P.composeEmail==='function'){
    // An app build from before composeEmail existed rejects the call as
    // unimplemented: that is the share sheet's job, not an error to show.
    let r=null;
    try{
      r=await P.composeEmail({to:email,subject:parts.subject,body:parts.body,
        attachmentBase64:_supB64(pdf),filename:parts.filename,mime:'application/pdf'});
    }catch(_e){r={result:'unavailable'};}
    const res=r&&r.result;
    if(res==='sent'||res==='saved')return res;
    if(res==='cancelled')return 'cancelled';
    if(res==='failed')throw new Error('mail failed');
    // 'unavailable': no Apple Mail account, fall through to the share sheet.
  }
  let file=null;
  try{file=new File([pdf],parts.filename,{type:'application/pdf'});}catch(_e){}
  if(file&&navigator.share&&navigator.canShare&&navigator.canShare({files:[file]})){
    try{if(navigator.clipboard)await navigator.clipboard.writeText(email);}catch(_e){}
    if(typeof showToast==='function')showToast('Their email is copied, paste it in','📋');
    try{await navigator.share({files:[file],title:parts.subject,text:parts.body});}
    catch(e){if(e&&e.name==='AbortError')return 'cancelled';throw e;}
    return 'shared';
  }
  const url=URL.createObjectURL(new Blob([pdf],{type:'application/pdf'}));
  const a=document.createElement('a');a.href=url;a.download=parts.filename;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
  location.href='mailto:'+encodeURIComponent(email)+'?subject='+encodeURIComponent(parts.subject)+'&body='+encodeURIComponent(parts.body+'\n\n(List attached)');
  return 'download';
}

// ── From the share sheet ────────────────────────────────────────────────────
//
// The owner's flow ends with "shares it into TradeDesk". Shared from Mail, the
// quote lands in the share inbox (js/share-inbox.js), which offers this when an
// estimate is waiting on one. Waiting means: a supply list with items on a
// draft, newest send first.
function _supListOf(b){
  const it=(b&&Array.isArray(b.byoItems))?b.byoItems.find(x=>x&&x._supply):null;
  const l=(!it&&b&&Array.isArray(b.geiLines))?b.geiLines.find(x=>x&&x._supply):null;
  return (it||l)?(it||l)._supply:null;
}
function _supWaitingBids(){
  const all=(typeof bids!=='undefined'&&Array.isArray(bids))?bids:[];
  return all.filter(b=>b&&!b.signingToken&&(b.status==='Draft'||b.status==='Pending'||!b.status))
    .map(b=>({b,d:_supListOf(b)}))
    .filter(x=>x.d&&(x.d.items||[]).length)
    .sort((x,y)=>String(y.d.sentAt||'').localeCompare(String(x.d.sentAt||''))||(Number(y.b.id)||0)-(Number(x.b.id)||0))
    .map(x=>x.b);
}
function _supOpenBid(b){
  const c=(typeof clients!=='undefined'&&Array.isArray(clients))?clients.find(x=>x&&x.id===b.client_id):null;
  if(b.isTM){if(typeof openTMEstimate==='function')openTMEstimate(c||null,b.id);}
  else if(typeof openFreeFormEstimate==='function')openFreeFormEstimate(c||null,b.id);
}
async function _supReadIntoBid(b,item,onRead){
  _supOpenBid(b);
  // The builder draws after the open settles; the list's host line has to be
  // there before the read can land on it.
  for(let i=0;i<20&&!_supData();i++)await new Promise(r=>setTimeout(r,100));
  const ok=await _supImportBlob({path:item.path});
  if(ok&&typeof onRead==='function')onRead([item.path]);
  return ok;
}
function _supFromShare(item,onRead){
  const list=_supWaitingBids();
  if(!list.length||!item||!item.path)return false;
  if(list.length===1){_supReadIntoBid(list[0],item,onRead);return true;}
  document.getElementById('_sup-pick')?.remove();
  const ov=document.createElement('div');ov.id='_sup-pick';ov.className='zmodal-overlay';
  const m=document.createElement('div');m.className='zmodal';m.style.maxWidth='420px';
  m.innerHTML='<div class="zmodal-title">Which estimate is this quote for?</div>'+
    '<div class="si-list" style="margin-top:10px">'+list.slice(0,8).map((b,i)=>{
      const d=_supListOf(b);
      const sub=[(d.vendor||''),(d.items.length+' item'+(d.items.length===1?'':'s')),(d.sentRef||'')].filter(Boolean).join(' · ');
      return '<button class="si-opt" data-i="'+i+'"><span class="si-txt"><span class="si-t si-1">'+escHtml(b.client_name||b.type||'Estimate')+'</span>'+
        '<span class="si-s si-1">'+escHtml(sub)+'</span></span><span class="si-chev">\u203a</span></button>';
    }).join('')+'</div>'+
    '<div style="margin-top:12px"><button class="btn" style="width:100%" onclick="document.getElementById(\'_sup-pick\')?.remove()">Not now</button></div>';
  ov.appendChild(m);document.body.appendChild(ov);
  m.querySelectorAll('[data-i]').forEach(btn=>btn.onclick=()=>{
    ov.remove();
    _supReadIntoBid(list[Number(btn.dataset.i)],item,onRead);
  });
  return true;
}
