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
  let file=opts.file;
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

  // ── The stamp is burned in BEFORE anything else sees the bytes ──────────
  // A timestamp drawn by the app over the photo in the viewer is a caption; a
  // timestamp burned into the pixels is evidence. This is the one CompanyCam
  // feature contractors name when they explain why they pay for it: the
  // insurance adjuster, the customer arguing the damage was already there,
  // the dispute six months after the truck left. It has to survive being
  // screenshotted, texted and re-saved, so it goes into the image itself.
  // Failure returns the original file untouched: a stamp is never worth
  // losing a photo over.
  if(opts.stamp!==false&&_pcStampOn()){
    const stamped=await tdStampImage(file,_pcStampLines({lat:opts.lat,lon:opts.lon,clientId,jobId,bidId}));
    if(stamped)file=stamped;
  }

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


// ── The burned-in stamp (owner 2026-09-21) ──────────────────────────────────
// What goes on it, and why exactly this and nothing else: the business (so a
// photo forwarded out of the thread still says who took it), the date and
// time to the minute, and WHERE. Anything more and it stops being readable on
// a phone; anything less and it stops being usable as proof.
//
// It is a SETTING, not a law: a contractor sending a customer a finished
// kitchen does not always want a date bar across it. Default on, because the
// person who needs it most is the one who never thought to turn it on.
function _pcStampOn(){
  try{ return (typeof S==='undefined'||S.photoStamp===undefined)?true:!!S.photoStamp; }
  catch(_e){ return true; }
}
function tdTogglePhotoStamp(on){
  try{
    S.photoStamp=(on===undefined)?!_pcStampOn():!!on;
    saveAll();
    _pcPaint();
    return S.photoStamp;
  }catch(_e){return true;}
}
// The lines to burn in, top to bottom. Kept separate from the drawing so the
// CONTENT is testable without a canvas, and so a caller can preview it.
function _pcStampLines(ctx){
  ctx=ctx||{};
  const out=[];
  try{
    const biz=(typeof S!=='undefined'&&S.bname)?String(S.bname).trim():'';
    if(biz)out.push(biz);
    const d=new Date();
    out.push(d.toLocaleDateString('en-US',{year:'numeric',month:'2-digit',day:'2-digit'})+
      '  '+d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}));
    // WHERE, in the order a person would recognise it: the job's address, the
    // customer's address, then raw coordinates. Coordinates are the fallback
    // rather than the default because "1412 Oak Ridge Dr" settles an argument
    // and "37.6889, -97.3361" starts one.
    let where='';
    const j=ctx.jobId!=null?jobs.find(x=>x.id===ctx.jobId):null;
    if(j&&j.addr)where=j.addr;
    if(!where&&ctx.clientId!=null){
      const c=clients.find(x=>x.id===ctx.clientId);
      if(c&&c.addr)where=c.addr;
    }
    if(!where&&ctx.lat!=null&&ctx.lon!=null)where=Number(ctx.lat).toFixed(5)+', '+Number(ctx.lon).toFixed(5);
    if(where)out.push(where);
  }catch(_e){}
  return out;
}
// Draw the lines into the bottom-left of the image and hand back a new JPEG.
// Returns null on ANY failure, and every caller treats null as "upload what
// you had", so a decode problem can never cost a photo.
async function tdStampImage(fileOrBlob,lines){
  try{
    if(!fileOrBlob||!lines||!lines.length)return null;
    let bmp;
    try{bmp=await createImageBitmap(fileOrBlob,{imageOrientation:'from-image'});}
    catch(_e){bmp=await createImageBitmap(fileOrBlob);}
    const w=bmp.width,h=bmp.height;
    const cv=document.createElement('canvas');cv.width=w;cv.height=h;
    const g=cv.getContext('2d');
    g.drawImage(bmp,0,0,w,h);
    // Scaled off the image, not fixed px: the same stamp has to be legible on
    // a 4032px phone photo and on a 640px one.
    const fs=Math.max(13,Math.round(Math.min(w,h)*0.032));
    const pad=Math.round(fs*0.7), lh=Math.round(fs*1.32);
    g.font='700 '+fs+'px -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif';
    g.textBaseline='top';
    const widest=lines.reduce((m,t)=>Math.max(m,g.measureText(t).width),0);
    const boxH=lines.length*lh+pad*1.2, boxW=Math.min(w-pad*2,widest+pad*2);
    const x=pad, y=h-boxH-pad;
    // A slab, not a drop shadow: a shadow disappears over a bright wall,
    // which is most of a jobsite in daylight.
    g.fillStyle='rgba(10,13,17,.62)';
    const r=Math.round(fs*0.4);
    g.beginPath();
    if(g.roundRect)g.roundRect(x,y,boxW,boxH,r);else g.rect(x,y,boxW,boxH);
    g.fill();
    g.fillStyle='#fff';
    lines.forEach((t,i)=>g.fillText(t,x+pad,y+pad*0.6+i*lh,boxW-pad*2));
    const blob=await new Promise(res=>cv.toBlob(res,'image/jpeg',0.92));
    if(!blob||!blob.size)return null;
    blob.name=(fileOrBlob.name||'shot.jpg').replace(/\.[a-z0-9]+$/i,'')+'.jpg';
    return blob;
  }catch(_e){return null;}
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
    '<button type="button" class="pc-stamp-toggle" id="pc-stamp-toggle" onclick="tdTogglePhotoStamp()">'+
      '<span class="dot"></span><span id="pc-stamp-label">Stamp on</span></button>'+
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
    // Repaint: the sheet was drawn before the camera answered, so the hint
    // still read "tap the shutter to open the camera" over a live viewfinder
    // (caught in a screenshot, 2026-09-21).
    _pcPaint();
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
  const st=document.getElementById('pc-stamp-toggle'),stl=document.getElementById('pc-stamp-label');
  if(st&&stl){const on=_pcStampOn();st.className='pc-stamp-toggle'+(on?'':' off');stl.textContent=on?'Stamp on':'Stamp off';}
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
  strip.innerHTML=shots.map(p=>'<div class="pc-thumb'+(p.annotated?' marked':'')+'" title="Mark it up" onclick="tdAnnotatePhoto(\''+p.id+'\')" style="background-image:url(\''+(p.thumbUrl||p.url||p.data||'')+'\')"></div>').join('')+
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
  const fix=_pcCurrentFix();
  const row=await tdSavePhoto({
    file,type:_pcCtx.type,caption:_pcCtx.caption,
    clientId:_pcCtx.clientId,bidId:_pcCtx.bidId,jobId:_pcCtx.jobId,
    lat:fix.lat,lon:fix.lon
  });
  if(!row)return;
  // Where it was shot, kept on the row so the unfiled tray can guess the
  // customer later. Best effort: a denied location never blocks a photo.
  _pcStampGeo(row);
  _pcShots++;
  _pcPaint();
  if(typeof _pcAfterSave==='function')_pcAfterSave(row);
}
// The fix we already hold, if any. Never waits on one: a photo must not be
// slower to take because the phone is arguing with GPS.
function _pcCurrentFix(){
  try{
    if(typeof _lastGeoFix==='object'&&_lastGeoFix&&_lastGeoFix.lat!=null)return{lat:_lastGeoFix.lat,lon:_lastGeoFix.lon};
  }catch(_e){}
  return{lat:null,lon:null};
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

// ── Annotation (owner 2026-09-21) ───────────────────────────────────────────
// "Circle the rot, point at the joist, write 'replace this'." It is the most
// used feature in CompanyCam and the reason a photo beats a paragraph: the
// crew, the customer and the adjuster all read the same arrow.
//
// TWO RULES, and both are about not destroying evidence:
//   1. The ORIGINAL is never overwritten. The flattened copy becomes the
//      photo everyone sees; originalUrl/originalPath keep the untouched shot
//      forever. A stamped photo that somebody drew on is still evidence only
//      if the undrawn one still exists.
//   2. The marks are flattened INTO the image rather than stored as an
//      overlay. An overlay is lost the moment the photo is texted, emailed or
//      screenshotted, which is every way a photo actually leaves this app.
let _pcAnno=null;

function tdAnnotatePhoto(photoId){
  const p=photos.find(x=>String(x.id)===String(photoId));
  if(!p)return false;
  const src=p.data||p.url||p.thumbUrl||'';
  if(!src)return false;
  _pcAnno={photoId:p.id,ops:[],tool:'arrow',color:'#E5484D',drawing:null,img:null,saving:false};
  document.getElementById('pc-anno')?.remove();
  const el=document.createElement('div');
  el.id='pc-anno';el.className='pc-anno';
  el.innerHTML=
    '<div class="pc-anno-top">'+
      '<button type="button" class="pc-side" onclick="tdCloseAnnotate()">Cancel</button>'+
      '<span class="pc-anno-title">Mark it up</span>'+
      '<button type="button" class="pc-side go" id="pc-anno-save" onclick="tdSaveAnnotation()">Save</button>'+
    '</div>'+
    '<div class="pc-anno-stage" id="pc-anno-stage"><canvas id="pc-anno-cv"></canvas></div>'+
    '<div class="pc-anno-tools">'+
      '<button type="button" class="pc-tool on" data-tool="arrow" onclick="tdAnnoTool(\'arrow\')">Arrow</button>'+
      '<button type="button" class="pc-tool" data-tool="circle" onclick="tdAnnoTool(\'circle\')">Circle</button>'+
      '<button type="button" class="pc-tool" data-tool="text" onclick="tdAnnoTool(\'text\')">Text</button>'+
      '<button type="button" class="pc-tool" id="pc-anno-color" onclick="tdAnnoColor()" style="color:#E5484D">Red</button>'+
      '<button type="button" class="pc-tool" onclick="tdAnnoUndo()">Undo</button>'+
    '</div>';
  document.body.appendChild(el);
  const cv=document.getElementById('pc-anno-cv');
  const im=new Image();
  im.crossOrigin='anonymous';
  im.onload=()=>{
    if(!_pcAnno)return;
    _pcAnno.img=im;
    cv.width=im.naturalWidth||im.width;cv.height=im.naturalHeight||im.height;
    _pcAnnoBind(cv);
    _pcAnnoRedraw();
  };
  // ── Three ways in, tried in order (live run, 2026-09-21) ────────────────
  // The editor used to give up if the <img> would not load, and the live run
  // is where that showed: once a photo has uploaded its base64 copy is gone,
  // so the editor had exactly ONE source, a plain <img> against the storage
  // url. A cross-origin image also TAINTS the canvas, which makes toBlob
  // throw at Save even when the picture is visible, so "it loaded" was never
  // enough on its own.
  //   1. the url as-is
  //   2. the local base64 copy, if this device still holds one
  //   3. DOWNLOAD the bytes with the same authenticated client that uploaded
  //      them, and hand the editor a blob url. Same origin by construction,
  //      so the canvas is never tainted and Save cannot throw.
  // Only after all three fail does it say so and close.
  let _tried=0;
  im.onerror=()=>{
    _tried++;
    if(_tried===1&&p.data&&im.src!==p.data){im.src=p.data;return;}
    _pcAnnoFromStorage(p,im);
  };
  im.src=src;
  return true;
}
// Fetch the photo's bytes through the Supabase client (it carries the
// session, so this works on a private bucket too) and feed the editor a
// blob url. Gives up only if there is nothing to fetch.
async function _pcAnnoFromStorage(p,im){
  try{
    if(!p.storagePath||!(typeof supaEnabled==='function'&&supaEnabled()&&_supa))throw new Error('no storage path');
    const{data,error}=await _supa.storage.from('gallery').download(p.storagePath);
    if(error||!data)throw error||new Error('no bytes');
    if(!_pcAnno)return;
    im.onerror=()=>{showToast('Could not open that photo to mark up','⚠️');tdCloseAnnotate();};
    im.removeAttribute('crossorigin');
    im.src=URL.createObjectURL(data);
  }catch(_e){
    showToast('Could not open that photo to mark up','⚠️');
    tdCloseAnnotate();
  }
}
function tdCloseAnnotate(){
  _pcAnno=null;
  document.getElementById('pc-anno')?.remove();
}
function tdAnnoTool(t){
  if(!_pcAnno)return;
  _pcAnno.tool=t;
  document.querySelectorAll('#pc-anno .pc-tool[data-tool]').forEach(b=>{
    b.className='pc-tool'+(b.dataset.tool===t?' on':'');
  });
}
function tdAnnoColor(){
  if(!_pcAnno)return;
  // Two, not a picker: red for a defect, yellow for a note. A palette is a
  // decision nobody standing on a roof wants to make.
  const next=_pcAnno.color==='#E5484D'?'#F2A81C':'#E5484D';
  _pcAnno.color=next;
  const b=document.getElementById('pc-anno-color');
  if(b){b.style.color=next;b.textContent=next==='#E5484D'?'Red':'Yellow';}
}
function tdAnnoUndo(){
  if(!_pcAnno||!_pcAnno.ops.length)return false;
  _pcAnno.ops.pop();
  _pcAnnoRedraw();
  return true;
}
// Canvas coordinates from a pointer event, in IMAGE pixels rather than screen
// pixels, so a mark lands where the finger was at any zoom or device ratio.
function _pcAnnoPoint(e,cv){
  const r=cv.getBoundingClientRect();
  return{x:(e.clientX-r.left)/r.width*cv.width,y:(e.clientY-r.top)/r.height*cv.height};
}
function _pcAnnoBind(cv){
  cv.onpointerdown=e=>{
    if(!_pcAnno)return;
    e.preventDefault();
    try{cv.setPointerCapture(e.pointerId);}catch(_e){}
    const pt=_pcAnnoPoint(e,cv);
    if(_pcAnno.tool==='text'){
      const t=prompt('What does this say?');
      if(t&&t.trim())_pcAnno.ops.push({t:'text',x:pt.x,y:pt.y,text:t.trim().slice(0,60),c:_pcAnno.color});
      _pcAnnoRedraw();return;
    }
    _pcAnno.drawing={t:_pcAnno.tool,x1:pt.x,y1:pt.y,x2:pt.x,y2:pt.y,c:_pcAnno.color};
  };
  cv.onpointermove=e=>{
    if(!_pcAnno||!_pcAnno.drawing)return;
    const pt=_pcAnnoPoint(e,cv);
    _pcAnno.drawing.x2=pt.x;_pcAnno.drawing.y2=pt.y;
    _pcAnnoRedraw();
  };
  const end=()=>{
    if(!_pcAnno||!_pcAnno.drawing)return;
    const d=_pcAnno.drawing;_pcAnno.drawing=null;
    // A tap with no drag is not a mark, or every mis-tap leaves a dot on the
    // customer's photo. The floor SCALES with the image: a flat 6 was 6
    // IMAGE pixels, which on a 4000px phone photo shown at 390px wide is
    // about half a screen pixel, so it caught nothing at all on exactly the
    // photos people shoot. 1% of the short edge is a real thumb movement at
    // any size.
    const minMove=Math.max(4,Math.min(cv.width,cv.height)*0.01);
    if(Math.hypot(d.x2-d.x1,d.y2-d.y1)>minMove)_pcAnno.ops.push(d);
    _pcAnnoRedraw();
  };
  cv.onpointerup=end;cv.onpointercancel=end;cv.onpointerleave=end;
}
function _pcAnnoRedraw(){
  const cv=document.getElementById('pc-anno-cv');
  if(!cv||!_pcAnno||!_pcAnno.img)return;
  const g=cv.getContext('2d');
  g.clearRect(0,0,cv.width,cv.height);
  g.drawImage(_pcAnno.img,0,0,cv.width,cv.height);
  const all=_pcAnno.ops.concat(_pcAnno.drawing?[_pcAnno.drawing]:[]);
  all.forEach(op=>_pcAnnoDraw(g,op,cv));
}
function _pcAnnoDraw(g,op,cv){
  // Stroke weight scales with the image so a mark reads the same on a 4032px
  // phone photo as on a 640px one.
  const w=Math.max(3,Math.round(Math.min(cv.width,cv.height)*0.008));
  g.save();
  g.strokeStyle=op.c;g.fillStyle=op.c;g.lineWidth=w;g.lineCap='round';g.lineJoin='round';
  // A dark halo under every mark: red on a brick wall and yellow on a sunlit
  // ceiling both vanish without it.
  g.shadowColor='rgba(0,0,0,.55)';g.shadowBlur=w*1.4;
  if(op.t==='arrow'){
    g.beginPath();g.moveTo(op.x1,op.y1);g.lineTo(op.x2,op.y2);g.stroke();
    const a=Math.atan2(op.y2-op.y1,op.x2-op.x1),head=w*4;
    g.beginPath();
    g.moveTo(op.x2,op.y2);
    g.lineTo(op.x2-head*Math.cos(a-Math.PI/7),op.y2-head*Math.sin(a-Math.PI/7));
    g.lineTo(op.x2-head*Math.cos(a+Math.PI/7),op.y2-head*Math.sin(a+Math.PI/7));
    g.closePath();g.fill();
  }else if(op.t==='circle'){
    const cx=(op.x1+op.x2)/2,cy=(op.y1+op.y2)/2;
    const rx=Math.abs(op.x2-op.x1)/2,ry=Math.abs(op.y2-op.y1)/2;
    g.beginPath();g.ellipse(cx,cy,Math.max(rx,w),Math.max(ry,w),0,0,Math.PI*2);g.stroke();
  }else if(op.t==='text'){
    const fs=Math.max(16,Math.round(Math.min(cv.width,cv.height)*0.045));
    g.font='800 '+fs+'px -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif';
    g.textBaseline='top';
    g.fillText(op.text,op.x,op.y);
  }
  g.restore();
}
// Flatten and store. The marked copy replaces what everyone sees; the
// untouched shot is kept under originalUrl and is never overwritten again on
// a second pass, so annotating twice still leaves the first truth intact.
async function tdSaveAnnotation(){
  if(!_pcAnno||_pcAnno.saving)return false;
  const cv=document.getElementById('pc-anno-cv');
  const p=photos.find(x=>String(x.id)===String(_pcAnno.photoId));
  if(!cv||!p)return false;
  if(!_pcAnno.ops.length){tdCloseAnnotate();return false;}
  _pcAnno.saving=true;
  const btn=document.getElementById('pc-anno-save');
  if(btn)btn.textContent='Saving…';
  let blob=null;
  try{ blob=await new Promise(res=>cv.toBlob(res,'image/jpeg',0.92)); }catch(_e){ blob=null; }
  if(!blob){
    if(btn)btn.textContent='Save';
    _pcAnno.saving=false;
    showToast('Could not save the markup','⚠️');
    return false;
  }
  blob.name='marked-'+Date.now()+'.jpg';
  // ── Write to the LIVE row, never to the one captured before an await ────
  // A delta or realtime merge REPLACES the objects in photos[] (the table's
  // set() does photos.length=0 then re-pushes), so any reference held across
  // an await can be a dead object whose fields nobody will ever read again.
  // _uploadClientHub learned this the hard way with `clients` and re-finds
  // its row for the same reason. Every write below goes through this.
  const live=()=>photos.find(x=>String(x.id)===String(_pcAnno&&_pcAnno.photoId))||p;
  // The url this markup is being made FROM, captured once, before anything
  // can move: this is what originalUrl has to end up holding.
  const srcUrl=p.url||'';
  const srcPath=p.storagePath||'';
  const stamp=r=>{ if(!r.originalUrl){r.originalUrl=srcUrl;r.originalPath=srcPath;} r.annotated=true; };
  stamp(p);
  const dataUrl=await _pcReadDataUrl(blob);
  const r1=live();
  stamp(r1);
  if(dataUrl)r1.data=dataUrl;
  saveAll();
  if(typeof supaEnabled==='function'&&supaEnabled()&&_supaUser&&_supa){
    try{
      const _cp=await _compressPhoto(blob);
      const path=_supaUser.id+'/marked/'+p.id+'-'+Date.now()+'.jpg';
      const{error}=await _supa.storage.from('gallery').upload(path,_cp?_cp.blob:blob,
        {contentType:'image/jpeg',upsert:false,cacheControl:_PHOTO_CACHE});
      if(!error){
        const{data:urlData}=_supa.storage.from('gallery').getPublicUrl(path);
        if(urlData&&urlData.publicUrl){
          const{thumbUrl,thumbPath}=await _uploadPhotoThumb(_cp?_cp.thumb:null,path);
          // Re-found AFTER the uploads, then stamped again: the row may have
          // been replaced while those were in flight, and the replacement
          // carries whatever the server had, which is not this markup.
          const r2=live();
          stamp(r2);
          r2.url=urlData.publicUrl;r2.storagePath=path;r2.thumbUrl=thumbUrl;r2.thumbPath=thumbPath;
          delete r2.data;
          saveAll();
          if(r2.client_id!=null&&typeof _uploadClientHub==='function')_uploadClientHub(r2.client_id).catch(()=>{});
        }
      }
    }catch(_e){}
  }
  tdCloseAnnotate();
  _pcPaint();
  showToast('Markup saved','✏️');
  return true;
}

// ── Finding a photo again, months later ─────────────────────────────────────
// The owner's test of whether this feature is real: "photos tag to a job or to
// a client address for easy access later." A photo the app cannot hand back is
// a photo that may as well not have been taken.
//
// One lookup, used by every in-app surface that shows a customer's history.
// It unions the three tags rather than reading one of them, because the SAME
// property's photos are spread across all three by design: the walkthrough
// shots carry the bid, the job shots carry the job, and a drive-by carries
// only the client.
function tdPhotosFor(opts){
  opts=opts||{};
  const cid=opts.clientId!=null?opts.clientId:null;
  const bidIds=(opts.bidIds||[]).filter(x=>x!=null).map(String);
  const jobIds=(opts.jobIds||[]).filter(x=>x!=null).map(String);
  const out=(typeof photos!=='undefined'?photos:[]).filter(p=>{
    if(!p)return false;
    if(jobIds.length&&p.job_id!=null&&jobIds.includes(String(p.job_id)))return true;
    if(bidIds.length&&p.bid_id!=null&&bidIds.includes(String(p.bid_id)))return true;
    // Client-only match is the fallback, and ONLY when the caller asked for
    // the whole customer: otherwise a bid card would show the neighbour job's
    // photos just because they share a customer.
    if(opts.wholeClient&&cid!=null&&p.client_id===cid)return true;
    return false;
  });
  // ── The job-local copies count too ─────────────────────────────────────
  // A job carries its own photos[] of base64 entries, written by the device
  // that took the shot. Usually there is a matching row in the global array,
  // but NOT always: a photo taken before this file existed has only the local
  // entry, and so does one taken offline whose upload has not drained yet.
  // Reading the global array alone made both of those vanish from a
  // property's history, which is the exact failure this lookup exists to
  // prevent. Matched on the timestamp, which the writer puts on both.
  const seen=new Set(out.map(p=>String(p.uploadedAt||'')));
  jobIds.forEach(jid=>{
    const j=(typeof jobs!=='undefined'?jobs:[]).find(x=>String(x.id)===jid);
    if(!j||!Array.isArray(j.photos))return;
    j.photos.forEach(e=>{
      if(!e)return;
      const ts=String(e.ts||'');
      if(ts&&seen.has(ts))return;
      if(ts)seen.add(ts);
      out.push({id:'local-'+jid+'-'+ts,type:e.type,caption:e.caption||'',data:e.data||'',
        url:'',thumbUrl:'',client_id:j.client_id!=null?j.client_id:null,
        bid_id:j.bid_id!=null?j.bid_id:null,job_id:j.id,uploadedAt:ts});
    });
  });
  return out.sort((a,b)=>String(a.uploadedAt||'').localeCompare(String(b.uploadedAt||'')));
}
// What to actually put in an <img src>. Order matters: the thumbnail is the
// cheap one, the full url is the fallback, and the local base64 copy is last
// because it only exists on the device that took the shot.
function tdPhotoSrc(p){
  return (p&&(p.thumbUrl||p.url||p.data))||'';
}
