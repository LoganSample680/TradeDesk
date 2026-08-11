// ── Client equipment (owner 2026-08-11) ──────────────────────────────────────
// Point the camera at a furnace, water heater, panel, or condenser data plate.
// Apple's document scanner grabs it, the on-device OCR reads it (the same
// reader the receipt scanner uses, js/finance.js), and the model and serial
// land on the CLIENT so they outlive the job that captured them.
//
// WHY THIS EARNS ITS PLACE: warranty claims live or die on model and serial,
// and today those get copied off a dusty sticker in a crawlspace by thumb, or
// not at all. Capture them once and every future service call, warranty
// claim, and replacement quote already has them. The client hub shows the
// homeowner the same list, which is a re-sell hook years later ("your unit is
// 14 years old").
//
// The plate is photographed on the CREW's phone at the job, so equipment
// syncs on the same fabric as vehicles and places (_TD_TABLES in js/cloud.js).

const _EQUIP_KINDS=['Furnace','A/C','Heat pump','Water heater','Boiler','Panel','Mini split','Air handler','Softener','Generator','Other'];

function getEquipment(){return (typeof equipment!=='undefined'&&Array.isArray(equipment))?equipment:[];}
function _equipForClient(clientId){
  if(clientId==null)return [];
  return getEquipment().filter(e=>e&&String(e.clientId)===String(clientId));
}

// ── Reading a data plate ─────────────────────────────────────────────────────
// Plates are printed as LABEL then VALUE, in wildly inconsistent order and
// spelling, so this matches on the label and takes what follows, on the same
// line or the next. Everything it cannot prove is left blank for the user
// rather than guessed: a wrong serial is worse than an empty one, because it
// gets copied onto a warranty claim months later and fails there instead.
function _equipMatch(lines,labels){
  const L=(lines||[]).map(x=>String(x||'').trim()).filter(Boolean);
  for(let i=0;i<L.length;i++){
    const low=L[i].toLowerCase().replace(/[^a-z0-9\s#:./-]/g,'');
    for(const lab of labels){
      const at=low.indexOf(lab);
      if(at<0)continue;
      // Same line, after the label (and any separator).
      const after=L[i].slice(at+lab.length).replace(/^[\s:#.\-]+/,'').trim();
      const val=_equipCleanVal(after);
      if(val)return val;
      // Or the very next line, which is how a two-column plate prints.
      if(i+1<L.length){
        const nxt=_equipCleanVal(L[i+1].trim());
        if(nxt)return nxt;
      }
    }
  }
  return '';
}
// A plate value is an alphanumeric code. Reject the things that are clearly
// not one: pure punctuation, other labels, and anything absurdly long.
function _equipCleanVal(raw){
  const v=String(raw||'').trim().replace(/\s{2,}/g,' ');
  if(!v)return '';
  if(v.length>40)return '';
  if(!/[A-Za-z0-9]/.test(v))return '';
  if(/^(no|model|serial|mfg|type|number)\b/i.test(v))return '';   // the next label, not a value
  const alnum=(v.match(/[A-Za-z0-9]/g)||[]).length;
  if(alnum<3)return '';
  return v.slice(0,40);
}
function _equipParsePlate(lines){
  const out={brand:'',model:'',serial:''};
  out.model=_equipMatch(lines,['model no','model #','model number','model','mod no','mod.','m/n','cat no']);
  out.serial=_equipMatch(lines,['serial no','serial #','serial number','serial','ser no','s/n','sn']);
  // Brand is rarely labelled: it is the biggest name at the top of the plate.
  // Match against the brands a trade actually meets rather than guessing from
  // position, which picks up "WARNING" and "LISTED" far too often.
  const known=['Carrier','Trane','Lennox','Goodman','Rheem','Ruud','York','Bryant','Amana','Daikin','Mitsubishi','Bosch','Navien','Rinnai','A.O. Smith','AO Smith','State','Bradford White','Square D','Eaton','Siemens','Generac','Kohler','Payne','Heil','Tempstar','Nordyne','Weil-McLain','Burnham','Lochinvar'];
  const hay=(lines||[]).join(' \n ');
  for(const b of known){
    const re=new RegExp('(^|[^A-Za-z])'+b.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'([^A-Za-z]|$)','i');
    if(re.test(hay)){out.brand=b;break;}
  }
  return out;
}

// ── Capture ──────────────────────────────────────────────────────────────────
// Uses the SAME native document scanner as receipts (§7.3: one scanner, not a
// second hand-rolled one), then reads it on-device. On a device without the
// scanner the form still opens, just empty, so equipment can always be typed.
async function captureEquipment(clientId,jobId){
  const P=(typeof _rcptNativePlugin==='function')?_rcptNativePlugin():null;
  let parsed={brand:'',model:'',serial:''},photoPath='';
  if(P&&typeof P.scanDocument==='function'){
    let r=null;
    try{r=await P.scanDocument();}catch(_e){r=null;}
    const pages=(r&&r.pages)||[];
    if(pages.length){
      photoPath=pages[0];
      if(typeof _rcptOcrLines==='function'){
        try{parsed=_equipParsePlate(await _rcptOcrLines(pages[0]));}catch(_e){}
      }
    }
  }
  openEquipmentForm(clientId,jobId,{...parsed,photoPath});
}

function openEquipmentForm(clientId,jobId,prefill){
  const p=prefill||{};
  const c=(typeof getClientById==='function')?getClientById(clientId):null;
  document.getElementById('_equip-ov')?.remove();
  const ov=document.createElement('div');ov.id='_equip-ov';ov.className='zmodal-overlay';
  ov.onclick=e=>{if(e.target===ov)ov.remove();};
  const m=document.createElement('div');m.className='zmodal';m.style.maxWidth='420px';
  const fld=(id,label,val,ph)=>'<div style="margin-top:12px"><div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:5px">'+label+'</div>'+
    '<input id="'+id+'" value="'+escHtml(val||'')+'" placeholder="'+ph+'" style="width:100%;box-sizing:border-box;font-size:15px;padding:11px 12px;border:1.5px solid var(--line-2);border-radius:var(--r);background:var(--bg-card);color:var(--text);font-family:inherit"></div>';
  m.innerHTML=
    '<div class="zmodal-title">Equipment</div>'+
    (c?'<div style="font-size:12px;color:var(--text3);margin-top:2px">'+escHtml(c.name||'')+'</div>':'')+
    (p.model||p.serial?'<div class="tip" style="margin-top:10px;font-size:12px">Read off the plate. Check it before saving.</div>':'')+
    '<div style="margin-top:12px"><div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:5px">Type</div>'+
    '<select id="_eq-kind" style="width:100%;box-sizing:border-box;font-size:15px;padding:11px 12px;border:1.5px solid var(--line-2);border-radius:var(--r);background:var(--bg-card);color:var(--text);font-family:inherit">'+
      _EQUIP_KINDS.map(k=>'<option>'+k+'</option>').join('')+'</select></div>'+
    fld('_eq-brand','Brand',p.brand,'Carrier, Rheem...')+
    fld('_eq-model','Model',p.model,'58SC0A045')+
    fld('_eq-serial','Serial',p.serial,'1234A56789')+
    fld('_eq-installed','Installed',p.installed,'2018 or 03/2018')+
    fld('_eq-location','Where',p.location,'Basement, attic, north side')+
    '<button id="_eq-save" class="btn btn-g" style="width:100%;height:48px;font-size:15px;font-weight:800;border-radius:var(--r);margin-top:16px">Save equipment</button>';
  ov.appendChild(m);document.body.appendChild(ov);
  document.getElementById('_eq-save').onclick=()=>{
    const rec=saveEquipment({
      id:p.id||null,clientId,jobId:jobId||null,
      kind:document.getElementById('_eq-kind').value,
      brand:document.getElementById('_eq-brand').value.trim(),
      model:document.getElementById('_eq-model').value.trim(),
      serial:document.getElementById('_eq-serial').value.trim(),
      installed:document.getElementById('_eq-installed').value.trim(),
      location:document.getElementById('_eq-location').value.trim(),
      photoPath:p.photoPath||''
    });
    ov.remove();
    if(rec&&typeof showToast==='function')showToast('Equipment saved','✓');
    if(typeof renderClientDetail==='function')try{renderClientDetail();}catch(_e){}
  };
}

// One record per unit. Nothing is required except the client and a type: a
// crew member who can only reach half the plate should still be able to log
// what is there rather than abandon the whole record.
function saveEquipment(rec){
  if(!rec||rec.clientId==null)return null;
  const list=getEquipment();
  const now=new Date().toISOString();
  let row=rec.id!=null?list.find(e=>String(e.id)===String(rec.id)):null;
  if(!row){
    row={id:(typeof _newId==='function'?_newId():String(Date.now())),createdAt:now};
    list.push(row);
  }
  row.clientId=rec.clientId;
  row.jobId=rec.jobId||null;
  row.kind=rec.kind||'Other';
  row.brand=rec.brand||'';
  row.model=rec.model||'';
  row.serial=rec.serial||'';
  row.installed=rec.installed||'';
  row.location=rec.location||'';
  if(rec.photoPath)row.photoPath=rec.photoPath;
  row.updatedAt=now;
  if(typeof saveAll==='function')saveAll();
  // The hub is the client-facing copy; refresh it so the homeowner's list
  // matches what was just captured on site.
  try{if(typeof _uploadClientHub==='function'&&rec.clientId!=null)_uploadClientHub(rec.clientId).catch(()=>{});}catch(_e){}
  return row;
}

function deleteEquipment(id){
  const list=getEquipment();
  const i=list.findIndex(e=>String(e.id)===String(id));
  if(i<0)return false;
  const cid=list[i].clientId;
  list.splice(i,1);
  if(typeof saveAll==='function')saveAll();
  try{if(typeof _uploadClientHub==='function'&&cid!=null)_uploadClientHub(cid).catch(()=>{});}catch(_e){}
  return true;
}

// One line per unit, the way a tech reads it: what it is, then the two
// numbers that matter. Age is spelled out because "installed 2011" means
// nothing at a glance and "14 years old" is an immediate re-sell signal.
function _equipLine(e){
  if(!e)return '';
  const bits=[e.brand,e.model].filter(Boolean).join(' ');
  const age=_equipAgeYears(e.installed);
  return [e.kind||'Equipment',bits,e.serial?('S/N '+e.serial):'',age!=null?(age+' yr old'):'']
    .filter(Boolean).join(' · ');
}
function _equipAgeYears(installed){
  const s=String(installed||'');
  const m=s.match(/(19|20)\d{2}/);
  if(!m)return null;
  const yr=+m[0];
  const now=new Date().getFullYear();
  if(yr<1950||yr>now)return null;
  return now-yr;
}
