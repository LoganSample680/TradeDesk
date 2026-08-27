// ── Share into a job (owner 2026-08-11) ──────────────────────────────────────
// Crews photograph a jobsite with the normal Camera app out of habit, and
// homeowners text pictures of the leak. Today that means exporting and
// re-importing. Now: Share > TradeDesk, and the next time the app opens it
// asks the only question worth asking, which job.
//
// The share extension has NO UI on purpose (it runs in a memory-starved
// process iOS kills without warning), so everything here (when to ask, how
// the picker looks, where the file lands) is JS and tunable without a build.
//
// Nothing is deleted from the inbox until the bytes are safely on a job. A
// shared photo iOS never offers again is not something to be casual with.

function _shareInPlugin(){
  try{
    const cap=window.Capacitor;
    if(!cap||typeof cap.isNativePlatform!=='function'||!cap.isNativePlatform())return null;
    if(typeof cap.registerPlugin==='function')return cap.registerPlugin('TdShare');
    return (cap.Plugins&&cap.Plugins.TdShare)||null;
  }catch(_e){return null;}
}

async function _shareInList(){
  const P=_shareInPlugin();
  if(!P||typeof P.inbox!=='function')return [];
  try{const r=await P.inbox();return (r&&Array.isArray(r.items))?r.items:[];}catch(_e){return [];}
}

// Pull a shared file back through the bridge in 1 MB slices, the same route
// the scanner uses for mesh files: the WebView cannot read the App Group
// container, and a whole photo in one string spikes memory on an older phone.
async function _shareInRead(path){
  const P=_shareInPlugin();
  if(!P||typeof P.read!=='function')return null;
  const CHUNK=1048576;
  let offset=0,size=null;
  const parts=[];
  try{
    for(let guard=0;guard<512;guard++){
      const r=await P.read({path,offset,length:CHUNK});
      if(!r||!r.b64)break;
      if(size==null)size=r.size|0;
      const bin=atob(r.b64);
      const bytes=new Uint8Array(bin.length);
      for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
      parts.push(bytes);
      offset+=bin.length;
      if(!bin.length||(size!=null&&offset>=size))break;
    }
  }catch(_e){return null;}
  if(!parts.length)return null;
  const type=/\.(png)$/i.test(path)?'image/png':(/\.pdf$/i.test(path)?'application/pdf':'image/jpeg');
  return new Blob(parts,{type});
}

async function _shareInClear(paths){
  const P=_shareInPlugin();
  if(!P||typeof P.clear!=='function')return;
  try{await P.clear(paths&&paths.length?{paths}:{});}catch(_e){}
}

// The picker. Shown only when something is actually waiting, and only on the
// dashboard: interrupting an estimate half-built to ask about a photo is how
// a helpful feature becomes an annoying one.
let _shareInAsking=false;
async function checkSharedInbox(opts){
  if(_shareInAsking)return 0;
  const items=await _shareInList();
  if(!items.length)return 0;
  if(!(opts&&opts.force)){
    const pg=document.querySelector('.pg.active')?.id;
    if(pg&&pg!=='pg-dash')return 0;
    if(document.querySelector('.zmodal-overlay'))return 0;   // never stack on another popup
  }
  _shareInAsking=true;
  try{_shareInPrompt(items);}catch(_e){_shareInAsking=false;}
  return items.length;
}

// ── Shared straight into an expense (owner ask 2026-08-26) ──────────────────
//
// "Receipts from Home Depot pro accounts ... that can then drop expenses and
// the actual receipt in, no scan needed."
//
// The no-scan part is real, not a figure of speech: the shared file is already
// a file, so it goes through the SAME on-device Vision read the scanner uses
// (_rcptOcrLines + _rcptParseLines, js/finance.js) without a camera ever
// opening. Vendor and amount are filled before the user sees the form.
//
// Everything here rides the existing expense flow (7.3): openExpenseFlow builds
// the form, _expState.imagePages holds the pages, _uploadReceiptToStorage puts
// the bytes where every other receipt lives. A parallel "shared expense" path
// would miss the storage upload, the page renderer, and the save validation
// that the real one gets for free.
//
// MULTIPLE FILES ARE PAGES OF ONE RECEIPT, not several expenses. That matches
// what the scanner already does with Apple's multi-page capture, and it is the
// common case: a Home Depot pro receipt runs to two or three sheets.
async function _shareInAsReceipt(items){
  if(typeof openExpenseFlow!=='function')return 0;
  // OCR the FIRST page only. A total lives on the last page as often as the
  // first, but reading every page multiplies the wait and the parser is built
  // to find a total in one sheet. The user is about to see the form and can
  // correct it; a slow form they cannot correct is worse.
  let parsed=null;
  try{
    if(typeof _rcptOcrLines==='function'&&typeof _rcptParseLines==='function'){
      const lines=await _rcptOcrLines(items[0].path);
      if(lines&&lines.length)parsed=_rcptParseLines(lines);
    }
  }catch(_e){}
  openExpenseFlow();
  let added=0;
  const filed=[];
  for(const it of items){
    const blob=await _shareInRead(it.path);
    if(!blob)continue;
    try{
      const b64=await compressAndEncodeImage(blob,900,0.75);
      const pageObj={b64,key:null};
      if(typeof _expState!=='undefined'&&_expState){
        _expState.imagePages.push(pageObj);
        _expState.imageData={b64,type:'image/jpeg'};
        _expState.hasReceipt=true;
      }
      if(typeof _uploadReceiptToStorage==='function'){
        _uploadReceiptToStorage(Date.now()+added,b64).then(k=>{if(k)pageObj.key=k;}).catch(()=>{});
      }
      added++;filed.push(it.path);
    }catch(_e){}
  }
  if(typeof _renderExpPages==='function')try{_renderExpPages();}catch(_e){}
  // Never overwrite something already typed, the same rule
  // _rcptApplyLocalRead follows.
  if(parsed){
    const set=(id,val)=>{
      if(!val)return;
      const el=document.getElementById(id);
      if(!el||String(el.value||'').trim())return;
      el.value=val;
    };
    set('em-vendor',parsed.vendor);
    set('em-amount',parsed.amount);
  }
  // Only once the bytes are in the form AND on their way to storage.
  if(filed.length)await _shareInClear(filed);
  return added;
}

function _shareInPrompt(items){
  document.getElementById('_sharein-ov')?.remove();
  const ov=document.createElement('div');ov.id='_sharein-ov';ov.className='zmodal-overlay';
  const m=document.createElement('div');m.className='zmodal';m.style.maxWidth='420px';
  const n=items.length;
  // Today's and recent jobs first: a shared photo is almost always about work
  // happening right now, and a 400-job list is not a picker.
  const tk=(typeof todayKey==='function')?todayKey():'';
  const all=(typeof jobs!=='undefined'&&Array.isArray(jobs))?jobs:[];
  const live=all.filter(j=>j&&j.status!=='canceled');
  const today=live.filter(j=>String(j.start||'').slice(0,10)===tk);
  const rest=live.filter(j=>today.indexOf(j)<0).slice(-8).reverse();
  const pick=today.concat(rest).slice(0,12);
  const row=j=>{
    const c=(j.client_id!=null&&typeof getClientById==='function')?getClientById(j.client_id):null;
    const sub=[c&&c.name,j.addr].filter(Boolean).join(' · ');
    return '<button data-job="'+j.id+'" class="_si-job" style="display:block;width:100%;text-align:left;padding:11px 14px;border:none;border-bottom:1px solid var(--border);background:none;font-family:inherit;cursor:pointer">'+
      '<span style="display:block;font-size:14px;font-weight:700;color:var(--text)">'+escHtml(j.name||(c&&c.name)||'Job')+'</span>'+
      (sub?'<span style="display:block;font-size:11.5px;color:var(--text3);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml(sub)+'</span>':'')+
    '</button>';
  };
  // TWO things arrive through the share sheet and they are not the same job:
  // a jobsite photo, and a receipt. Forcing a Home Depot receipt to become a
  // job photo buries the money in a gallery, which is exactly the manual
  // re-entry this feature exists to kill. Same fork-in-two-paths shape the
  // setup checklist already uses (7.3): name both, commit to neither.
  //
  // Receipt is FIRST and primary. A photo shared from the Camera app is the
  // habit; a receipt shared from the Home Depot app is the thing somebody went
  // out of their way to do, and it is the one with money attached.
  m.innerHTML=
    '<div class="zmodal-title">'+n+' file'+(n===1?'':'s')+' shared to TradeDesk</div>'+
    '<div style="font-size:13px;color:var(--text2);margin:6px 0 12px">What '+(n===1?'is it':'are they')+'?</div>'+
    // display:block and height:auto override .btn's inline-flex + fixed 36px
    // height + white-space:nowrap, which force two stacked lines onto one row
    // and push it straight off the edge (15.1: nothing bleeds).
    '<button id="_si-receipt" class="btn btn-p" style="display:block;box-sizing:border-box;width:100%;height:auto;padding:13px;margin-bottom:8px;text-align:left;white-space:normal">'+
      '<span style="display:block;font-size:14px;font-weight:800">'+(n===1?'A receipt':'Pages of one receipt')+'</span>'+
      '<span style="display:block;font-size:11.5px;font-weight:500;opacity:.85;margin-top:2px">Reads the total off it and opens a filled-in expense</span>'+
    '</button>'+
    '<div style="font-size:12px;color:var(--text3);margin:12px 0 6px;font-weight:700">Or attach to a job</div>'+
    (pick.length?'<div style="max-height:220px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--r)">'+pick.map(row).join('')+'</div>'
                :'<div class="tip tip-w" style="font-size:13px">No open jobs to attach to. Create the job first, then share again.</div>')+
    '<button id="_si-later" class="btn" style="width:100%;margin-top:10px;padding:12px">Not now</button>'+
    '<button id="_si-discard" class="btn" style="width:100%;margin-top:8px;padding:11px;font-size:13px;color:var(--text3)">Discard '+(n===1?'it':'them')+'</button>';
  ov.appendChild(m);document.body.appendChild(ov);
  const close=()=>{ov.remove();_shareInAsking=false;};
  ov.addEventListener('click',e=>{if(e.target===ov)close();});
  document.getElementById('_si-later').onclick=close;
  const rcBtn=document.getElementById('_si-receipt');
  if(rcBtn)rcBtn.onclick=async()=>{
    rcBtn.disabled=true;rcBtn.style.opacity='.5';
    // Closed FIRST: openExpenseFlow puts its own modal up, and stacking this
    // one behind it on a phone is how you end up unable to dismiss either
    // (the same hand-rolled-sheet mistake 7.3 records).
    close();
    const added=await _shareInAsReceipt(items);
    if(typeof showToast==='function'){
      if(added)showToast(added===1?'Receipt added, check the total':added+' pages added, check the total','🧾');
      else showToast('Could not read the shared file','⚠️');
    }
  };
  document.getElementById('_si-discard').onclick=async()=>{
    await _shareInClear(items.map(i=>i.path));
    close();
    if(typeof showToast==='function')showToast('Shared files discarded','🗑');
  };
  m.querySelectorAll('._si-job').forEach(btn=>{
    btn.onclick=async()=>{
      const jobId=btn.getAttribute('data-job');
      btn.disabled=true;btn.style.opacity='.5';
      const done=await _shareInFileTo(items,jobId);
      close();
      if(typeof showToast==='function'){
        if(done)showToast(done+' file'+(done===1?'':'s')+' added to the job','✓');
        else showToast('Could not read the shared files','⚠️');
      }
    };
  });
}

// Attach to the job through the SAME path the in-app camera uses (§7.3), so
// shared photos compress, thumbnail, sync, and appear exactly like any other
// job photo instead of through a second parallel pipeline.
async function _shareInFileTo(items,jobId){
  const j=(typeof jobs!=='undefined'&&jobs.find)?jobs.find(x=>String(x.id)===String(jobId)):null;
  if(!j)return 0;
  let done=0;
  const filed=[];
  for(const it of items){
    const blob=await _shareInRead(it.path);
    if(!blob)continue;
    try{
      if(typeof _jobAttachBlob==='function'){await _jobAttachBlob(j,blob,'shared');}
      else{
        // Fallback: the queue the offline camera path already drains.
        const b64=await new Promise((res,rej)=>{const fr=new FileReader();fr.onload=()=>res(fr.result);fr.onerror=rej;fr.readAsDataURL(blob);});
        j.photos=j.photos||[];
        j.photos.push({type:'shared',data:b64,pendingUpload:true,_uploadMime:blob.type,addedAt:new Date().toISOString()});
      }
      done++;filed.push(it.path);
    }catch(_e){}
  }
  if(done){
    if(typeof saveAll==='function')saveAll();
    if(typeof _drainPhotoQueue==='function')try{_drainPhotoQueue();}catch(_e){}
    // ONLY now: the bytes are on the job and saved.
    await _shareInClear(filed);
  }
  return done;
}
