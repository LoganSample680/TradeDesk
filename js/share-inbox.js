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
  m.innerHTML=
    '<div class="zmodal-title">'+n+' file'+(n===1?'':'s')+' shared to TradeDesk</div>'+
    '<div style="font-size:13px;color:var(--text2);margin:6px 0 10px">Which job '+(n===1?'is it':'are they')+' for?</div>'+
    (pick.length?'<div style="max-height:260px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--r)">'+pick.map(row).join('')+'</div>'
                :'<div class="tip tip-w" style="font-size:13px">No open jobs to attach to. Create the job first, then share again.</div>')+
    '<button id="_si-later" class="btn" style="width:100%;margin-top:10px;padding:12px">Not now</button>'+
    '<button id="_si-discard" class="btn" style="width:100%;margin-top:8px;padding:11px;font-size:13px;color:var(--text3)">Discard '+(n===1?'it':'them')+'</button>';
  ov.appendChild(m);document.body.appendChild(ov);
  const close=()=>{ov.remove();_shareInAsking=false;};
  ov.addEventListener('click',e=>{if(e.target===ov)close();});
  document.getElementById('_si-later').onclick=close;
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
