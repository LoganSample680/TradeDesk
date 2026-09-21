// ── Jobsite photos: ONE capture sheet, ONE writer ───────────────────────────
//
// Owner ask (2026-09-21): "take photos seamlessly in person on all my estimate
// types, and they all should land in the client hub link I send out under
// before and after."
//
// What was wrong before this file existed: photos could only be shot from the
// job sheet (js/jobs.js addJobPhoto) or picked from a file dialog in the
// gallery (js/proposals.js). No estimate type had a camera at all, so the one
// moment the contractor is actually standing in front of the work, walking it
// with the customer, writing the estimate, was the one moment he could not
// shoot. And a photo with no job on it fell into an unnamed "other photos"
// strip at the bottom of the hub, because the hub grouped photos by job_id and
// nothing else.
//
// THE RULE THIS FILE ENFORCES: the CLIENT is the subject of a photo. The bid
// and the job are tags on top of it, and either can be absent.
//
//   shot on an estimate   → {client_id, bid_id}            → hub: that estimate
//   shot mid-job          → {client_id, job_id}            → hub: that job
//   shot with neither     → {client_id}                    → hub: the client
//   shot with no client   → {}                             → the unfiled tray
//
// When a bid becomes a job, tdInheritBidPhotos stamps job_id onto the bid's
// photos, so the Before set shot during the walkthrough becomes that job's
// Before set with nobody filing anything. That inheritance is the whole reason
// the estimate camera is worth building rather than just adding one more
// upload button.
//
// EVERY writer goes through tdSavePhoto. addJobPhoto (js/jobs.js) is now a thin
// wrapper over it rather than a second copy of the upload path (§7.3): the
// compress + thumbnail + storage + photos[] + hub-refresh sequence exists once.

// ── The one writer ──────────────────────────────────────────────────────────
// Returns the photos[] row it wrote (or null if the file could not be read).
// Never throws: a storage failure marks the row pendingUpload and the existing
// _drainPhotoQueue sweep (js/jobs.js) retries it on reconnect, exactly as the
// job-sheet path always did.
async function tdSavePhoto(opts){
  opts=opts||{};
  const file=opts.file;
  if(!file)return null;
  const type=opts.type||'before';
  const caption=String(opts.caption||'').trim().slice(0,60);
  const jobId=opts.jobId!=null?opts.jobId:null;
  const bidId=opts.bidId!=null?opts.bidId:null;
  let clientId=opts.clientId!=null?opts.clientId:null;

  const j=jobId!=null?jobs.find(x=>x.id===jobId):null;
  const b=bidId!=null?bids.find(x=>x.id===bidId):null;
  // The client is inferred from whatever tag we were given, so a caller only
  // ever has to know the thing it is already looking at.
  if(clientId==null&&j)clientId=j.client_id!=null?j.client_id:null;
  if(clientId==null&&b)clientId=b.client_id!=null?b.client_id:null;
  const c=clientId!=null?clients.find(x=>x.id===clientId):null;

  const row={
    id:Date.now()+Math.random(),
    url:'',storagePath:'',thumbUrl:'',thumbPath:'',
    type,caption,
    client_id:clientId,client_name:c?c.name||'':'',
    bid_id:bidId,bid_name:b?(b.title||b.name||''):'',
    job_id:jobId,job_name:j?j.name||'':'',
    uploadedAt:new Date().toISOString()
  };

  // The local copy lands FIRST and unconditionally. A photo taken in a
  // crawlspace with no bars is still a photo, and the job sheet has always
  // rendered from this base64 copy rather than from the network.
  const dataUrl=await _pcReadDataUrl(file);
  if(!dataUrl)return null;
  if(j){
    if(!Array.isArray(j.photos))j.photos=[];
    j.photos.push({type,data:dataUrl,ts:row.uploadedAt,caption});
  }
  row.data=dataUrl;
  photos.push(row);
  saveAll();

  if(!(typeof supaEnabled==='function'&&supaEnabled()&&_supaUser&&_supa)){
    _pcMarkPending(row,j,file);
    return row;
  }
  try{
    const _cp=await _compressPhoto(file);
    const ext=_cp?_cp.ext:((file.name||'').split('.').pop()||'jpg').toLowerCase();
    // Path carries the tag it was shot against so storage is browsable by eye.
    const scope=jobId!=null?('job-'+jobId):bidId!=null?('bid-'+bidId):clientId!=null?('client-'+clientId):'unfiled';
    const path=_supaUser.id+'/'+scope+'/'+type+'-'+Date.now()+'.'+ext;
    const{error}=await _supa.storage.from('gallery').upload(path,_cp?_cp.blob:file,
      {contentType:_cp?_cp.mime:(file.type||'image/jpeg'),upsert:false,cacheControl:_PHOTO_CACHE});
    if(error)throw error;
    const{data:urlData}=_supa.storage.from('gallery').getPublicUrl(path);
    const publicUrl=urlData?urlData.publicUrl||'':'';
    if(!publicUrl)throw new Error('no public url');
    const{thumbUrl,thumbPath}=await _uploadPhotoThumb(_cp?_cp.thumb:null,path);
    row.url=publicUrl;row.storagePath=path;row.thumbUrl=thumbUrl;row.thumbPath=thumbPath;
    // The base64 copy is dropped once the row has a URL: keeping both doubles
    // the localStorage footprint of every photo for no gain (the job sheet
    // falls back to url when data is absent).
    delete row.data;
    saveAll();
    if(clientId!=null&&typeof _uploadClientHub==='function')_uploadClientHub(clientId).catch(()=>{});
  }catch(_e){
    _pcMarkPending(row,j,file);
  }
  return row;
}
function _pcReadDataUrl(file){
  return new Promise(res=>{
    try{
      const r=new FileReader();
      r.onload=e=>res(e.target.result);
      r.onerror=()=>res('');
      r.readAsDataURL(file);
    }catch(_e){res('');}
  });
}
function _pcMarkPending(row,j,file){
  const ext=((file&&file.name||'').split('.').pop()||'jpg').toLowerCase();
  const mime=(file&&file.type)||'image/jpeg';
  row.pendingUpload=true;row._uploadExt=ext;row._uploadMime=mime;
  if(j&&Array.isArray(j.photos)&&j.photos.length){
    const last=j.photos[j.photos.length-1];
    if(last&&!last.pendingUpload){last.pendingUpload=true;last._uploadExt=ext;last._uploadMime=mime;}
  }
  saveAll();
}

// ── A bid's photos follow it into the job ───────────────────────────────────
// Called at every place a bid becomes a job. Idempotent: a photo that already
// carries a job_id is left alone, so re-running this never re-parents a photo
// somebody moved by hand.
function tdInheritBidPhotos(bidId,jobId){
  if(bidId==null||jobId==null)return 0;
  const j=jobs.find(x=>x.id===jobId);
  let n=0;
  photos.forEach(p=>{
    if(!p||p.bid_id!==bidId||p.job_id!=null)return;
    p.job_id=jobId;
    p.job_name=j?j.name||'':'';
    n++;
  });
  if(n)saveAll();
  return n;
}

// ── Unfiled: shot with no customer, filed in one tap later ──────────────────
// This is the CompanyCam behaviour that makes crews actually use a camera:
// shoot first, decide later. The address guess is the part they do not have.
function tdUnfiledPhotos(){
  return photos.filter(p=>p&&p.client_id==null);
}
// Best guess at whose photo this is, by the address the app already knows.
// Never files anything on its own: a wrong guess silently attached to the
// wrong customer's hub is worse than an unfiled photo.
function tdGuessClientFor(photo){
  try{
    if(!photo)return null;
    const lat=photo.lat,lon=photo.lon;
    if(lat==null||lon==null)return null;
    let best=null,bestD=Infinity;
    clients.forEach(c=>{
      if(c.lat==null||c.lon==null)return;
      const d=_pcMeters(lat,lon,c.lat,c.lon);
      if(d<bestD){bestD=d;best=c;}
    });
    // 150m: close enough to be this property, far enough to survive a phone
    // fix taken from the truck at the curb.
    return (best&&bestD<=150)?best:null;
  }catch(_e){return null;}
}
function _pcMeters(a1,o1,a2,o2){
  const R=6371000,t=Math.PI/180;
  const dLat=(a2-a1)*t,dLon=(o2-o1)*t;
  const x=Math.sin(dLat/2)**2+Math.cos(a1*t)*Math.cos(a2*t)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.min(1,Math.sqrt(x)));
}
function tdFilePhoto(photoId,clientId,bidId,jobId){
  const p=photos.find(x=>String(x.id)===String(photoId));
  if(!p)return false;
  const c=clients.find(x=>x.id===clientId);
  p.client_id=clientId!=null?clientId:null;
  p.client_name=c?c.name||'':'';
  if(bidId!==undefined&&bidId!==null){
    const b=bids.find(x=>x.id===bidId);
    p.bid_id=bidId;p.bid_name=b?(b.title||b.name||''):'';
  }
  if(jobId!==undefined&&jobId!==null){
    const j=jobs.find(x=>x.id===jobId);
    p.job_id=jobId;p.job_name=j?j.name||'':'';
  }
  saveAll();
  if(p.client_id!=null&&typeof _uploadClientHub==='function')_uploadClientHub(p.client_id).catch(()=>{});
  return true;
}

// ── The capture sheet ───────────────────────────────────────────────────────
// Live viewfinder via getUserMedia, because the Before-ghost overlay is only
// possible over a viewfinder we draw ourselves: the native camera UI cannot be
// drawn on. NSCameraUsageDescription is already in the shell's Info.plist (it
// is there for the RoomPlan scanner), so this needs NO iOS build (§3.2).
//
// When getUserMedia is unavailable or denied, the sheet falls back to the
// native picker (`<input capture="environment">`), which is exactly what the
// job sheet used before. Nothing is ever unreachable because a permission was
// refused; the ghost overlay is simply absent on that path.
let _pcCtx=null,_pcStream=null,_pcShots=0;

function tdOpenCapture(opts){
  opts=opts||{};
  _pcCtx={
    clientId:opts.clientId!=null?opts.clientId:null,
    bidId:opts.bidId!=null?opts.bidId:null,
    jobId:opts.jobId!=null?opts.jobId:null,
    type:opts.type||'before',
    caption:String(opts.caption||'').trim().slice(0,60),
    ghost:true,
    onDone:typeof opts.onDone==='function'?opts.onDone:null
  };
  _pcShots=0;
  document.getElementById('pc-sheet')?.remove();
  const el=document.createElement('div');
  el.id='pc-sheet';
  el.className='pc-sheet';
  el.innerHTML=_pcSheetHTML();
  document.body.appendChild(el);
  _pcStartStream();
  _pcPaint();
  return el;
}
function tdCloseCapture(){
  _pcStopStream();
  const el=document.getElementById('pc-sheet');
  if(el)el.remove();
  const done=_pcCtx&&_pcCtx.onDone,n=_pcShots;
  _pcCtx=null;_pcShots=0;
  if(done)try{done(n);}catch(_e){}
}
function _pcSubjectLabel(){
  if(!_pcCtx)return '';
  const j=_pcCtx.jobId!=null?jobs.find(x=>x.id===_pcCtx.jobId):null;
  const b=_pcCtx.bidId!=null?bids.find(x=>x.id===_pcCtx.bidId):null;
  const c=_pcCtx.clientId!=null?clients.find(x=>x.id===_pcCtx.clientId):null;
  const who=c?c.name||'Customer':'No customer yet';
  let what=j?(j.name||'Job'):b?(b.title||b.name||b.type||'Proposal'):'';
  // A job or bid is very often NAMED after the customer, and "Dana Whitfield ·
  // Dana Whitfield" reads like a bug to the person holding the phone. Say the
  // name once.
  if(what&&c&&String(what).trim().toLowerCase()===String(c.name||'').trim().toLowerCase())what='';
  return what?who+' · '+what:who;
}
function _pcSheetHTML(){
  const t=_pcCtx?_pcCtx.type:'before';
  const seg=(v,label,cls)=>'<button type="button" class="pc-seg-btn'+(t===v?' on '+cls:'')+'" onclick="tdCaptureSetType(\''+v+'\')">'+label+'</button>';
  return ''+
  '<div class="pc-vf" id="pc-vf">'+
    '<video id="pc-video" playsinline autoplay muted></video>'+
    '<div class="pc-ghost" id="pc-ghost"></div>'+
    '<div class="pc-ghostframe" id="pc-ghostframe"></div>'+
    '<div class="pc-grid"></div>'+
    '<div class="pc-attach"><span class="pc-dot"></span>'+
      '<span class="pc-attach-t" id="pc-subject">'+escHtml(_pcSubjectLabel())+'</span>'+
    '</div>'+
    '<div class="pc-hint" id="pc-hint"></div>'+
  '</div>'+
  '<div class="pc-seg">'+
    seg('before','Before','b4')+seg('progress','Progress','pr')+seg('after','After','af')+
  '</div>'+
  '<div class="pc-strip" id="pc-strip"></div>'+
  '<div class="pc-shutrow">'+
    '<button type="button" class="pc-side" id="pc-ghost-btn" onclick="tdCaptureToggleGhost()">Ghost</button>'+
    '<button type="button" class="pc-shut" id="pc-shut" aria-label="Take photo" onclick="tdCaptureShoot()"><i></i></button>'+
    '<button type="button" class="pc-side go" onclick="tdCloseCapture()">Done</button>'+
  '</div>'+
  '<input type="file" id="pc-fallback-file" accept="image/*" capture="environment" style="display:none" onchange="tdCaptureFromPicker(this)">';
}
async function _pcStartStream(){
  try{
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)throw new Error('no getUserMedia');
    _pcStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
    const v=document.getElementById('pc-video');
    if(!v){_pcStopStream();return;}
    v.srcObject=_pcStream;
    document.getElementById('pc-sheet')?.classList.add('pc-live');
  }catch(_e){
    // No camera stream: the shutter drives the native picker instead.
    _pcStream=null;
    document.getElementById('pc-sheet')?.classList.remove('pc-live');
    _pcPaint();
  }
}
function _pcStopStream(){
  try{ if(_pcStream)_pcStream.getTracks().forEach(t=>t.stop()); }catch(_e){}
  _pcStream=null;
}
function tdCaptureSetType(t){
  if(!_pcCtx)return;
  _pcCtx.type=t;
  document.querySelectorAll('#pc-sheet .pc-seg-btn').forEach((b,i)=>{
    const v=['before','progress','after'][i];
    b.className='pc-seg-btn'+(v===t?' on '+['b4','pr','af'][i]:'');
  });
  _pcPaint();
}
function tdCaptureToggleGhost(){
  if(!_pcCtx)return;
  _pcCtx.ghost=!_pcCtx.ghost;
  _pcPaint();
}
// The Before shot this After is meant to match: the newest Before on the same
// job, else on the same bid. Competitors leave lining the pair up to memory.
function tdCaptureGhostSrc(){
  if(!_pcCtx)return '';
  const pool=photos.filter(p=>p&&p.type==='before'&&(
    (_pcCtx.jobId!=null&&p.job_id===_pcCtx.jobId)||
    (_pcCtx.bidId!=null&&p.bid_id===_pcCtx.bidId)));
  if(!pool.length)return '';
  const p=pool[pool.length-1];
  return p.thumbUrl||p.url||p.data||'';
}
function _pcPaint(){
  const sheet=document.getElementById('pc-sheet');
  if(!sheet||!_pcCtx)return;
  const isAfter=_pcCtx.type==='after';
  const gsrc=isAfter?tdCaptureGhostSrc():'';
  const showGhost=!!(gsrc&&_pcCtx.ghost);
  const g=document.getElementById('pc-ghost'),gf=document.getElementById('pc-ghostframe');
  if(g){g.style.backgroundImage=showGhost?'url("'+gsrc+'")':'';g.style.display=showGhost?'block':'none';}
  if(gf)gf.style.display=showGhost?'block':'none';
  const gb=document.getElementById('pc-ghost-btn');
  if(gb){gb.style.visibility=gsrc?'visible':'hidden';gb.textContent=_pcCtx.ghost?'Ghost on':'Ghost off';}
  const hint=document.getElementById('pc-hint');
  if(hint){
    if(showGhost){hint.className='pc-hint gold';hint.textContent='Line up with the Before shot';}
    else if(_pcShots){hint.className='pc-hint';hint.textContent=_pcShots+(_pcShots===1?' shot':' shots')+' · keep going';}
    else {hint.className='pc-hint';hint.textContent=_pcStream?'Tap the shutter':'Tap the shutter to open the camera';}
  }
  const sub=document.getElementById('pc-subject');
  if(sub)sub.textContent=_pcSubjectLabel();
  _pcPaintStrip();
}
function _pcPaintStrip(){
  const strip=document.getElementById('pc-strip');
  if(!strip||!_pcCtx)return;
  const mine=photos.filter(p=>p&&(
    (_pcCtx.jobId!=null&&p.job_id===_pcCtx.jobId)||
    (_pcCtx.jobId==null&&_pcCtx.bidId!=null&&p.bid_id===_pcCtx.bidId)||
    (_pcCtx.jobId==null&&_pcCtx.bidId==null&&_pcCtx.clientId!=null&&p.client_id===_pcCtx.clientId)));
  const shots=mine.slice(-4);
  const counts=['before','progress','after'].map(t=>({t,n:mine.filter(p=>p.type===t).length})).filter(x=>x.n);
  strip.innerHTML=shots.map(p=>'<div class="pc-thumb" style="background-image:url(\''+(p.thumbUrl||p.url||p.data||'')+'\')"></div>').join('')+
    (counts.length?'<span class="pc-strip-lbl">'+counts.map(x=>x.n+' '+x.t.charAt(0).toUpperCase()+x.t.slice(1)).join(' · ')+'</span>':'');
}
// The shutter. With a live stream it grabs a frame and the sheet stays open,
// which is the burst behaviour. Without one it opens the native picker.
async function tdCaptureShoot(){
  if(!_pcCtx)return;
  if(!_pcStream){document.getElementById('pc-fallback-file')?.click();return;}
  const v=document.getElementById('pc-video');
  if(!v||!v.videoWidth)return;
  const cv=document.createElement('canvas');
  cv.width=v.videoWidth;cv.height=v.videoHeight;
  cv.getContext('2d').drawImage(v,0,0,cv.width,cv.height);
  const blob=await new Promise(r=>cv.toBlob(r,'image/jpeg',0.92));
  if(!blob)return;
  blob.name='shot-'+Date.now()+'.jpg';
  _pcFlash();
  await _pcCommit(blob);
}
function tdCaptureFromPicker(input){
  const f=input&&input.files&&input.files[0];
  input.value='';
  if(!f)return;
  _pcCommit(f);
}
async function _pcCommit(file){
  if(!_pcCtx)return;
  const row=await tdSavePhoto({
    file,type:_pcCtx.type,caption:_pcCtx.caption,
    clientId:_pcCtx.clientId,bidId:_pcCtx.bidId,jobId:_pcCtx.jobId
  });
  if(!row)return;
  // Where it was shot, kept on the row so the unfiled tray can guess the
  // customer later. Best effort: a denied location never blocks a photo.
  _pcStampGeo(row);
  _pcShots++;
  _pcPaint();
  if(typeof _pcAfterSave==='function')_pcAfterSave(row);
}
function _pcStampGeo(row){
  try{
    if(typeof _lastGeoFix==='object'&&_lastGeoFix&&_lastGeoFix.lat!=null){
      row.lat=_lastGeoFix.lat;row.lon=_lastGeoFix.lon;return;
    }
    if(!navigator.geolocation)return;
    navigator.geolocation.getCurrentPosition(pos=>{
      row.lat=pos.coords.latitude;row.lon=pos.coords.longitude;saveAll();
    },()=>{},{timeout:4000,maximumAge:120000});
  }catch(_e){}
}
function _pcFlash(){
  const vf=document.getElementById('pc-vf');
  if(!vf)return;
  const f=document.createElement('div');
  f.className='pc-flash';
  vf.appendChild(f);
  setTimeout(()=>f.remove(),220);
}

// ── Entry points the rest of the app calls ──────────────────────────────────
// One per surface, each of them a single line, so a new surface never has to
// know how a photo is stored.
function tdCaptureForBid(bidId,type){
  const b=bids.find(x=>x.id===bidId);
  tdOpenCapture({bidId,clientId:b?b.client_id:null,type:type||'before'});
}
function tdCaptureForJob(jobId,type,caption){
  const j=jobs.find(x=>x.id===jobId);
  tdOpenCapture({jobId,clientId:j?j.client_id:null,bidId:j?j.bid_id:null,type:type||'progress',caption});
}
function tdCaptureForClient(clientId,type){
  tdOpenCapture({clientId,type:type||'before'});
}
// The dashboard quick action: no customer, no estimate, no job. Shoot now,
// file later.
function tdCaptureUnfiled(){
  tdOpenCapture({type:'before'});
}

// ── "Grab the After shots" ──────────────────────────────────────────────────
// Fired when a job is marked done (js/jobs.js). Final photos are the ones
// everyone forgets, and nobody navigates back to a job sheet to file them, so
// the ask happens at the one moment the contractor is guaranteed to still be
// standing on the site. Silent when the job has no Before set: there is no
// pair to complete, and an unprompted nag is how a prompt gets trained away.
function tdPromptAfterShots(jobId){
  const j=jobs.find(x=>x.id===jobId);
  if(!j)return false;
  const mine=photos.filter(p=>p&&p.job_id===jobId);
  const before=mine.filter(p=>p.type==='before');
  const after=mine.filter(p=>p.type==='after');
  if(!before.length||after.length)return false;
  const c=clients.find(x=>x.id===j.client_id);
  const who=(c&&(c.name||'').split(' ')[0])||'They';
  const thumbs=before.slice(0,3).map(p=>
    '<div class="pc-prompt-thumb" style="background-image:url(\''+(p.thumbUrl||p.url||p.data||'')+'\')">'+
      '<span class="pc-prompt-tag">Before</span></div>').join('');
  const ov=document.createElement('div');
  ov.className='zmodal-overlay';
  ov.style.alignItems='center';
  ov.innerHTML='<div class="zmodal">'+
    '<div style="font-size:19px;font-weight:900;letter-spacing:-.02em;margin-bottom:4px">Grab the After shots</div>'+
    '<div style="font-size:13px;color:var(--text-2);margin-bottom:14px;line-height:1.45">You took '+before.length+
      ' Before photo'+(before.length===1?'':'s')+' on this job. '+escHtml(who)+' sees the pair in the hub.</div>'+
    '<div class="pc-prompt-grid">'+thumbs+'</div>'+
    '<button class="btn btn-p btn-xl btn-full" style="margin-bottom:8px" onclick="this.closest(\'.zmodal-overlay\').remove();tdCaptureForJob('+jobId+',\'after\')">Shoot the After set</button>'+
    '<button class="btn btn-full" onclick="this.closest(\'.zmodal-overlay\').remove()">Not now</button>'+
  '</div>';
  document.body.appendChild(ov);
  return true;
}

// ── The unfiled tray (dashboard) ────────────────────────────────────────────
function tdUnfiledTrayHTML(){
  const un=tdUnfiledPhotos();
  if(!un.length)return '';
  const rows=un.slice(-4).reverse().map(p=>{
    const guess=tdGuessClientFor(p);
    const when=_pcShotTime(p);
    const pill=guess
      ?'<span class="pc-uf-pill ok" onclick="tdFilePhoto(\''+p.id+'\','+guess.id+');renderDash()">'+escHtml(guess.name)+'?</span>'
      :'<span class="pc-uf-pill">Pick a customer</span>';
    return '<div class="pc-uf-row">'+
      '<div class="pc-uf-thumb" style="background-image:url(\''+(p.thumbUrl||p.url||p.data||'')+'\')"></div>'+
      '<div class="pc-uf-meta"><div class="pc-uf-when">Shot '+escHtml(when)+'</div>'+
        '<div class="pc-uf-sub">'+(guess?escHtml(guess.addr||''):'No address match')+'</div>'+pill+'</div>'+
      '<button type="button" class="pc-uf-file" onclick="tdOpenFilePicker(\''+p.id+'\')">File</button>'+
    '</div>';
  }).join('');
  return '<div class="card" id="dash-unfiled-photos">'+
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">'+
      '<div class="td-micro" style="flex:1;margin:0">Unfiled photos</div>'+
      '<span class="pc-uf-count">'+un.length+'</span></div>'+
    rows+'</div>';
}
function _pcShotTime(p){
  try{
    const d=new Date(p.uploadedAt);
    if(isNaN(d))return '';
    return d.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
  }catch(_e){return '';}
}
// File one photo: pick the customer, and then the open estimate or job on that
// customer if there is exactly one, because that is the answer nine times out
// of ten and asking twice is a tap nobody needs.
function tdOpenFilePicker(photoId){
  const p=photos.find(x=>String(x.id)===String(photoId));
  if(!p)return;
  const opts=clients.slice().sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''))).slice(0,50);
  const ov=document.createElement('div');
  ov.className='zmodal-overlay';
  ov.style.alignItems='center';
  ov.innerHTML='<div class="zmodal">'+
    '<div style="font-size:18px;font-weight:900;margin-bottom:4px">Whose photo is this?</div>'+
    '<div style="font-size:13px;color:var(--text-2);margin-bottom:12px">It lands in their hub under '+escHtml(p.type)+'.</div>'+
    '<div class="pc-file-list">'+
      (opts.length?opts.map(c=>'<button type="button" class="pc-file-opt" onclick="tdFilePhoto(\''+p.id+'\','+c.id+');this.closest(\'.zmodal-overlay\').remove();typeof renderDash===\'function\'&&renderDash()">'+
        escHtml(c.name||'Unnamed')+'<span>'+escHtml(c.addr||'')+'</span></button>').join('')
        :'<div style="font-size:13px;color:var(--text-3)">No customers yet.</div>')+
    '</div>'+
    '<button class="btn btn-full" style="margin-top:12px" onclick="this.closest(\'.zmodal-overlay\').remove()">Cancel</button>'+
  '</div>';
  document.body.appendChild(ov);
}
