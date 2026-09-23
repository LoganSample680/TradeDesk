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
    // A PATH, never a url. See _compressPhoto's header: the full-resolution
    // copy has no link on the row so it cannot be rendered by accident.
    fullPath:'',
    // What the camera actually handed over, WxH. Troubleshooting only, never
    // rendered: "it looks blurry" is otherwise unanswerable after the fact.
    shotPx:(typeof _pcShotPx==='string'?_pcShotPx:''),
    // Metres of uncertainty on the fix above, straight from the GPS.
    accM:opts.accM!=null?opts.accM:null,
    type,caption,
    client_id:clientId,client_name:c?c.name||'':'',
    bid_id:bidId,bid_name:b?(b.title||b.name||''):'',
    job_id:jobId,job_name:j?j.name||'':'',
    // The property this was shot at. A job or a proposal usually says it, but
    // a customer with three houses and no job open still has to know which.
    addr:opts.addr||(j?j.addr||'':'')||(b?b.addr||'':'')||(c?c.addr||'':''),
    // The fix the photo was taken at, KEPT, not just used for the stamp.
    // It was passed in for the stamp text and then thrown away, so only
    // photos shot through the capture sheet (which stamps the row
    // afterwards) ever carried coordinates. Everything else lost them, and
    // with them the "verified on site" verdict and the unfiled address
    // guess, which are the two things the fix exists for.
    lat:opts.lat!=null?opts.lat:null,
    lon:opts.lon!=null?opts.lon:null,
    // Who took it, for the details sheet. The same name the time log files a
    // crew member's entries under (js/jobs.js), so the two never disagree.
    by:_pcWhoShot(),
    // An imported photo keeps the moment it was TAKEN, from its own file,
    // so it sorts and reads as the day it happened, not the day it came in.
    uploadedAt:(opts.when&&!isNaN(new Date(opts.when)))?new Date(opts.when).toISOString():new Date().toISOString(),
    ...(opts.imported?{imported:true}:{})
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
    const stamped=await tdStampImage(file,_pcStampLines({lat:opts.lat,lon:opts.lon,accM:row.accM,clientId,jobId,bidId}));
    if(stamped){file=stamped;row.stamped=true;}
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
    // The coordinates go INTO the file, not just onto the row, so a photo that
    // leaves this app by any route still carries where it was taken. Wrapped so
    // a metadata failure can never cost somebody their photo.
    const _body=await _pcWithGps(_cp?_cp.blob:file,row.lat,row.lon,row.uploadedAt,row.accM);
    // Only claimed when the writer actually produced a new file: "GPS in
    // file" on the details sheet is a statement about these bytes.
    row.exifGps=_body!==(_cp?_cp.blob:file);
    const{error}=await _supa.storage.from('gallery').upload(path,_body,
      {contentType:_cp?_cp.mime:(file.type||'image/jpeg'),upsert:false,cacheControl:_PHOTO_CACHE});
    if(error)throw error;
    const{data:urlData}=_supa.storage.from('gallery').getPublicUrl(path);
    const publicUrl=urlData?urlData.publicUrl||'':'';
    if(!publicUrl)throw new Error('no public url');
    const{thumbUrl,thumbPath}=await _uploadPhotoThumb(_cp?_cp.thumb:null,path);
    // The full-resolution copy is the one an adjuster actually gets sent, so it
    // is the one that most needs the coordinates in it.
    const _fullBody=_cp&&_cp.full?await _pcWithGps(_cp.full,row.lat,row.lon,row.uploadedAt,row.accM):null;
    const fullPath=_fullBody?await _uploadPhotoFull(_fullBody,path,_cp.fullMime,_cp.fullExt):'';
    row.url=publicUrl;row.storagePath=path;row.thumbUrl=thumbUrl;row.thumbPath=thumbPath;
    row.fullPath=fullPath;
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
function _pcWhoShot(){
  try{
    if(typeof _isEmployee!=='undefined'&&_isEmployee)return (typeof _employeeRecord!=='undefined'&&_employeeRecord&&_employeeRecord.name)||'Crew';
    return (typeof getOwnerName==='function'&&getOwnerName())||(typeof S!=='undefined'&&S.ownerName)||'';
  }catch(_e){return '';}
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
    let where='',whereIsAddress=false;
    const j=ctx.jobId!=null?jobs.find(x=>x.id===ctx.jobId):null;
    if(j&&j.addr){where=j.addr;whereIsAddress=true;}
    if(!where&&ctx.clientId!=null){
      const c=clients.find(x=>x.id===ctx.clientId);
      if(c&&c.addr){where=c.addr;whereIsAddress=true;}
    }
    if(!where&&ctx.lat!=null&&ctx.lon!=null)where=Number(ctx.lat).toFixed(5)+', '+Number(ctx.lon).toFixed(5);
    if(where)out.push(where);
    // The coordinates as SECONDARY proof, under the address rather than
    // instead of it. CompanyCam prints raw lat/long and nothing else, which
    // their own users cannot place ("the address doesn't always pull up, it
    // will say it is 3 miles away", Capterra). An address settles an argument;
    // the numbers under it are for whoever wants to check.
    //
    // The accuracy goes with them, deliberately. A stamp that admits the fix
    // was ±40m cannot quietly name the wrong house, which is the single most
    // reported failure of theirs.
    // Only under an ADDRESS. When the coordinates already ARE the where line
    // there is nothing to put beneath them.
    if(whereIsAddress&&ctx.lat!=null&&ctx.lon!=null){
      const acc=(typeof ctx.accM==='number'&&isFinite(ctx.accM))?'  \u00b1'+Math.max(1,Math.round(ctx.accM))+'m':'';
      out.push(Number(ctx.lat).toFixed(6)+', '+Number(ctx.lon).toFixed(6)+acc);
    }
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
    // ── A SCRIM, NOT A SLAB (owner 2026-09-22: "gotta look better than
    // company cam") ──────────────────────────────────────────────────────────
    // The slab was legible but it was a grey box sitting on the photo, with a
    // hard edge that cut through whatever was behind it. A gradient that fades
    // up into the image is readable on a white garage door and in a
    // crawlspace, and it does not look bolted on.
    //
    // The lines are also no longer equals. The address is the thing an adjuster
    // reads, so it is set largest and last in the stack; the business and the
    // moment sit above it; the coordinates go quiet underneath.
    const U=Math.min(w,h)/100;
    const addrI=lines.length>2?2:lines.length-1;   // where() lands third when present
    const fA=Math.max(15,Math.round(U*5.0));
    const fB=Math.max(11,Math.round(U*3.1));
    const fC=Math.max(10,Math.round(U*2.6));
    const sizeOf=(i)=>i===addrI?fA:(i>addrI?fC:fB);
    const lineH=(i)=>Math.round(sizeOf(i)*(i===addrI?1.18:1.5));
    const padX=Math.round(U*4.2), padB=Math.round(U*4.0);
    let block=0;lines.forEach((t,i)=>{block+=lineH(i);});
    const scrim=Math.min(h,block+padB*2.2);
    const grad=g.createLinearGradient(0,h-scrim*1.9,0,h);
    grad.addColorStop(0,'rgba(8,10,14,0)');
    grad.addColorStop(0.45,'rgba(8,10,14,0.46)');
    grad.addColorStop(1,'rgba(8,10,14,0.95)');
    g.fillStyle=grad;g.fillRect(0,Math.max(0,h-scrim*1.9),w,Math.min(h,scrim*1.9));
    g.textBaseline='alphabetic';
    let yy=h-padB;
    for(let i=lines.length-1;i>=0;i--){
      const fs2=sizeOf(i);
      const weight=i===addrI?'800':(i>addrI?'500':'600');
      g.font=weight+' '+fs2+'px ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif';
      g.fillStyle=i===addrI?'#fff':(i>addrI?'rgba(255,255,255,0.74)':'rgba(255,255,255,0.9)');
      if(i===addrI){g.shadowColor='rgba(0,0,0,0.55)';g.shadowBlur=U*1.6;g.shadowOffsetY=U*0.2;}
      g.fillText(lines[i],padX,yy,w-padX*2);
      g.shadowColor='transparent';g.shadowBlur=0;g.shadowOffsetY=0;
      yy-=lineH(i);
    }
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
// ── Every property a customer has, with its own pin ─────────────────────────
// Jack, first real use, 2026-09-22: he stood 8.8 metres from Pepe's 6912 SW
// 17th St and the app offered him nothing, because the match only ever read a
// customer's PRIMARY coordinates and 6912 is Pepe's second property. His
// primary is eight kilometres away. A customer with two houses is not an edge
// case in this trade, it is a landlord.
function _pcClientPlaces(c){
  if(!c)return [];
  const out=[];
  if(c.lat!=null&&c.lon!=null)out.push({addr:c.addr||'',lat:c.lat,lon:c.lon,label:'Primary'});
  (c.extraAddresses||[]).forEach((a,i)=>{
    if(a&&a.lat!=null&&a.lon!=null)out.push({addr:a.addr||'',lat:a.lat,lon:a.lon,label:a.label||('Property '+(i+2))});
  });
  return out;
}
// Best guess at WHERE this photo was taken: the nearest saved property on any
// customer. Never files anything on its own, because a wrong guess silently
// attached to the wrong customer's hub is worse than an unfiled photo.
function tdGuessPlaceFor(photo){
  try{
    if(!photo)return null;
    const lat=photo.lat,lon=photo.lon;
    if(lat==null||lon==null)return null;
    let best=null,bestD=Infinity;
    clients.forEach(c=>{
      _pcClientPlaces(c).forEach(pl=>{
        const d=_pcMeters(lat,lon,pl.lat,pl.lon);
        if(d<bestD){bestD=d;best={client:c,addr:pl.addr,label:pl.label,d};}
      });
    });
    // 150m: close enough to be this property, far enough to survive a phone
    // fix taken from the truck at the curb.
    return (best&&bestD<=150)?best:null;
  }catch(_e){return null;}
}
// The customer alone, for callers that only need to know whose it is.
function tdGuessClientFor(photo){
  const hit=tdGuessPlaceFor(photo);
  return hit?hit.client:null;
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
let _pcCtx=null,_pcStream=null,_pcShots=0,_pcSessionIds=[];

function tdOpenCapture(opts){
  opts=opts||{};
  _pcCtx={
    clientId:opts.clientId!=null?opts.clientId:null,
    bidId:opts.bidId!=null?opts.bidId:null,
    jobId:opts.jobId!=null?opts.jobId:null,
    // The house, when the camera was opened from one property's card: a
    // customer with a rental has two, and the card knows which it was.
    addr:String(opts.addr||''),
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
  const unfiled=!!(_pcCtx&&_pcCtx.clientId==null&&_pcCtx.jobId==null&&_pcCtx.bidId==null);
  const ids=_pcSessionIds.slice();
  _pcCtx=null;_pcShots=0;_pcSessionIds=[];
  if(done)try{done(n);}catch(_e){}
  if(!n)return;
  if(typeof renderDash==='function')try{renderDash();}catch(_e){}
  // The decision "whose is this" belongs HERE, while the contractor is still
  // standing in front of the thing they photographed, not on a dashboard card
  // they have to find later (owner, first UAT run, 2026-09-21). A tagged
  // shoot already has its answer and closes silently, so the flow that had a
  // customer never pays a tap for the flow that did not.
  if(unfiled)tdReviewShots(ids);
}

// ── Review the burst: swipe, bin the bad ones, attach the rest ──────────────
// Six shots come back as ONE thing to deal with, not six rows. Deleting is
// immediate because triaging a burst one confirm-dialog at a time is worse
// than the problem: the bin is held until the sheet closes, so Undo is real
// and nothing is removed from storage until the contractor walks away from it.
let _pcRev=null;
function tdReviewShots(ids){
  const list=(ids||[]).map(id=>photos.find(p=>String(p.id)===String(id))).filter(Boolean);
  if(!list.length)return false;
  _pcRev={ids:list.map(p=>p.id),i:-1,trash:[]};
  document.getElementById('pc-rev')?.remove();
  const el=document.createElement('div');
  el.id='pc-rev';el.className='pc-rev';
  document.body.appendChild(el);
  _pcRevPaint();
  return true;
}
function _pcRevRows(){
  if(!_pcRev)return [];
  return _pcRev.ids.map(id=>photos.find(p=>String(p.id)===String(id))).filter(Boolean);
}
function _pcRevPaint(){
  const el=document.getElementById('pc-rev');
  if(!el||!_pcRev)return;
  const rows=_pcRevRows();
  if(!rows.length){tdReviewClose();return;}
  // In folder mode the grid IS the folder; the viewer is shared.
  if(_pcRev.folder&&!(_pcRev.i>=0&&rows[_pcRev.i])){_pcFolderPaint();return;}
  el.innerHTML=(_pcRev.i>=0&&rows[_pcRev.i])?_pcRevViewerHTML(rows):_pcRevGridHTML(rows);
  el.classList.toggle('pc-viewing',_pcRev.i>=0);
  el.classList.toggle('pc-bare',!!_pcRev.bare&&_pcRev.i>=0);
  if(_pcRev.i>=0){_pcRevBindSwipe();_pcRevSharpen();}
  // Bound once on the document rather than per repaint, because the viewer
  // rebuilds its own markup on every step and a listener added here would
  // stack up one deep per photo looked at.
  document.removeEventListener('keydown',_pcRevKey);
  document.addEventListener('keydown',_pcRevKey);
}
function _pcRevGridHTML(rows){
  const n=rows.length,sel=_pcRev.sel;
  const unfiled=rows.some(p=>p.client_id==null);
  const top=sel
    ?'<button type="button" class="pc-side pc-pill pc-glass" onclick="tdSelAll()">'+(sel.length===n?'None':'All')+'</button>'+
      '<span class="pc-rev-sp"></span>'+
      '<button type="button" class="pc-side pc-pill pc-glass" onclick="tdSelectMode(false)">Cancel</button>'
    :'<button type="button" class="pc-side pc-pill pc-glass" onclick="tdReviewClose()">'+(unfiled?'Not now':'Close')+'</button>'+
      '<span class="pc-rev-sp"></span>'+
      '<button type="button" class="pc-side pc-pill pc-glass" onclick="tdSelectMode(true)">Select</button>';
  return '<div class="pc-rev-top pc-g-top">'+top+'</div>'+
    '<div class="pc-g-title"><span class="pc-rev-title">'+(sel?_pcSelCount(sel.length):n+(n===1?' photo':' photos'))+'</span></div>'+
    '<div class="pc-rev-grid">'+rows.map(p=>_pcCellHTML(p,!_pcOneStage(rows))).join('')+'</div>'+
    (sel?_pcSelBarHTML():_pcRevFootHTML(rows));
}
function _pcSelCount(k){return k?k+' selected':'Select photos';}
// One cell, everywhere a set of photos is shown, so select mode behaves the
// same in the album and in a fresh burst.
function _pcCellHTML(p,tag){
  const sel=_pcRev&&_pcRev.sel;
  const on=!!(sel&&sel.some(id=>String(id)===String(p.id)));
  return '<button type="button" class="pc-rev-cell'+(on?' sel':'')+'" style="background-image:url(\''+_pcEscUrl(tdPhotoSrc(p))+'\')" '+
    'onclick="tdCellTap(\''+p.id+'\')">'+
    (tag===false?'':'<span class="pc-rev-tag">'+escHtml(p.type)+'</span>')+
    (sel?'<i class="pc-ck"></i>':'')+'</button>';
}
// ── "Is this the right house?" (Jack, 2026-09-22) ───────────────────────────
// "He takes the picture and it pops up what the address it was that captured
// in green, then confirm, if not right, edit the address or go through and
// search all the addresses for that client."
//
// So when the fix lands on a saved property, the sheet SAYS the address and
// the whole burst files in one tap. It is a confirmation, never an automatic
// filing: the app states what it believes and a person agrees with it. When
// the fix matches nothing, there is nothing to confirm and it asks as before.
function _pcRevGuess(rows){
  if(!rows||!rows.length)return null;
  if(!rows.some(p=>p.client_id==null))return null;
  for(let i=0;i<rows.length;i++){
    const hit=tdGuessPlaceFor(rows[i]);
    if(hit&&hit.addr)return hit;
  }
  return null;
}
function _pcFt(m){return Math.round(m*3.28084);}
function _pcRevFootHTML(rows){
  const undo=_pcRev.trash.length?'<button type="button" class="pc-side pc-link" onclick="tdReviewUndo()">Undo delete</button>':'';
  const n=rows.length;
  if(!rows.some(p=>p.client_id==null)){
    return '<div class="pc-rev-foot pc-conf pc-glass">'+
      '<button type="button" class="pc-side go pc-rev-attach" onclick="tdReviewClose()">Done</button>'+undo+
    '</div>';
  }
  const g=_pcRevGuess(rows);
  if(g){
    return '<div class="pc-rev-foot pc-conf pc-glass">'+
      '<div class="pc-rev-here" id="pc-rev-here">'+
        '<span class="pc-pinb">'+_pcIcon('pin')+'</span>'+
        '<div class="pc-rev-here-t">'+
          '<div class="pc-rev-here-addr">'+escHtml((g.addr||'').split(',')[0])+'</div>'+
          // The distance is not copy. A contractor does not care that it was
          // 29 feet, he cares whether it is the right house (owner
          // 2026-09-22). It is kept on the row instead, where it answers
          // "why did it pick that one" the next time somebody asks.
          '<div class="pc-rev-here-sub">'+escHtml(g.client&&g.client.name||'')+'</div>'+
        '</div>'+
      '</div>'+
      '<button type="button" class="pc-side go pc-rev-attach ok" id="pc-rev-confirm" onclick="tdReviewConfirmHere()">File '+(n===1?'this photo':n+' photos')+' here</button>'+
      '<button type="button" class="pc-side pc-link" onclick="tdReviewAttach()">Different address</button>'+
      undo+
    '</div>';
  }
  return '<div class="pc-rev-foot pc-conf pc-glass">'+
    '<button type="button" class="pc-side go pc-rev-attach" onclick="tdReviewAttach()">Attach to customer</button>'+undo+
  '</div>';
}
// ── The property folder (owner 2026-09-22) ──────────────────────────────────
// "Want photos to land on the property record under an organized folder."
//
// The VISIT is the folder. A contractor does not remember a photo, he
// remembers the day he was there, so the page reads as dated visits newest
// first, and the newest one is the only one open. Five years of a rental
// stays one screen instead of a wall.
//
// It is the same sheet the shoot ends in, in a different mode, because a
// second photo surface is how two of them drift apart (§7.3). Tapping any
// shot drops into the viewer that already exists, with Mark up, Move and
// Full size on it.
//
// Every heading here is a word Tim already matches: the address, the
// customer, the stage, the job, the date. The folder is labelled with his
// dictionary rather than needing one of its own.
const _PC_VISIT_GAP=3*60*60*1000;
function tdPropertyVisits(rows){
  const list=(rows||[]).slice().sort((a,b)=>(Date.parse(b.uploadedAt||0)||0)-(Date.parse(a.uploadedAt||0)||0));
  const out=[];
  list.forEach(p=>{
    const t=Date.parse(p.uploadedAt||0)||0;
    const last=out[out.length-1];
    // Three hours, not a calendar day: two trips to the same house in one
    // afternoon are two visits, and a morning's shooting is one.
    if(last&&Math.abs(last.at-t)<=_PC_VISIT_GAP){last.photos.push(p);last.at=t;}
    else out.push({at:t,photos:[p]});
  });
  return out.map(v=>{
    const j=v.photos.map(p=>p.job_name).find(Boolean);
    const b=v.photos.map(p=>p.bid_name).find(Boolean);
    return{
      key:'v'+v.photos[0].id,
      at:Date.parse(v.photos[v.photos.length-1].uploadedAt||0)||0,
      what:j?j:(b?b+' · walkthrough':''),
      photos:v.photos
    };
  });
}
// The one pair worth pinning: the newest Before and the newest After on the
// same job. Nothing to pin until a job has both, which is the point.
function tdPropertyPair(rows){
  const byJob={};
  (rows||[]).forEach(p=>{
    const k=p.job_id!=null?('j'+p.job_id):(p.bid_id!=null?('b'+p.bid_id):'');
    if(!k)return;
    const g=byJob[k]||(byJob[k]={name:p.job_name||p.bid_name||'',before:null,after:null,at:0});
    const t=Date.parse(p.uploadedAt||0)||0;
    if(p.type==='before'&&(!g.before||t>Date.parse(g.before.uploadedAt||0)))g.before=p;
    if(p.type==='after'&&(!g.after||t>Date.parse(g.after.uploadedAt||0)))g.after=p;
    if(t>g.at)g.at=t;
  });
  const hits=Object.values(byJob).filter(g=>g.before&&g.after).sort((a,b)=>b.at-a.at);
  if(hits[0])return hits[0];
  // Fall back to the property itself. The commonest shape in this app is a
  // Before taken while WRITING the estimate and an After taken on the job it
  // became, and those two carry different tags, so keying on the job alone
  // found no pair on the one house that most needs one (caught in a
  // screenshot before it shipped, 2026-09-22). The folder is already one
  // property, so the newest of each is the story of that house.
  let before=null,after=null;
  (rows||[]).forEach(p=>{
    const t=Date.parse(p.uploadedAt||0)||0;
    if(p.type==='before'&&(!before||t>Date.parse(before.uploadedAt||0)))before=p;
    if(p.type==='after'&&(!after||t>Date.parse(after.uploadedAt||0)))after=p;
  });
  if(!before||!after)return null;
  return{name:after.job_name||after.bid_name||before.job_name||before.bid_name||'',
    before,after,at:Date.parse(after.uploadedAt||0)||0};
}
let _pcFolder=null;
function tdOpenPropertyFolder(clientId,addr,rows){
  const c=clients.find(x=>x.id===clientId);
  const list=rows||((typeof cdPropertyPhotos==='function')?cdPropertyPhotos(c,addr,0):[]);
  if(!list.length)return false;
  _pcFolder={clientId,addr:addr||'',stage:'all',open:null,ids:list.map(p=>p.id)};
  tdReviewShots(_pcFolder.ids);
  if(_pcRev)_pcRev.folder=true;
  _pcFolderPaint();
  return true;
}
function _pcFolderRows(){
  if(!_pcFolder)return [];
  return _pcFolder.ids.map(id=>photos.find(p=>String(p.id)===String(id))).filter(Boolean);
}
function tdFolderStage(t){
  if(!_pcFolder)return false;
  // A different stage is a different question, so the newest of whatever is
  // left opens again rather than leaving him on a screen of closed rows.
  _pcFolder.stage=t;_pcFolder.open=null;_pcFolderPaint();return true;
}
function tdFolderVisit(key){
  if(!_pcFolder)return false;
  // '' is "he closed it", null is "nobody has chosen yet". Without the
  // distinction, closing a visit re-opened the newest one on the next paint
  // and the tap looked like it did nothing.
  _pcFolder.open=(_pcFolder.open===key)?'':key;
  _pcFolderPaint();return true;
}
// The tag is only worth the pixels when the set it sits in is MIXED. Six
// shots all labelled Before, under a chip row already saying Before 6, is the
// same word printed seven times (owner, looking at his own porch, 2026-09-22).
function _pcFolderCell(p,tag){
  return _pcCellHTML(p,tag);
}
// True when these photos are all the same stage, so their labels say nothing.
function _pcOneStage(list){
  return (list||[]).every(p=>p.type===(list[0]||{}).type);
}
// Straight into the viewer that already exists, on the shot that was tapped.
function tdFolderOpen(photoId){
  if(!_pcRev)return false;
  const i=_pcRev.ids.findIndex(id=>String(id)===String(photoId));
  return i<0?false:tdReviewOpen(i);
}
function _pcFolderPaint(){
  const el=document.getElementById('pc-rev');
  if(!el||!_pcFolder)return;
  const all=_pcFolderRows();
  if(!all.length){tdReviewClose();return;}
  const c=clients.find(x=>x.id===_pcFolder.clientId);
  const count=t=>all.filter(p=>p.type===t).length;
  const shown=_pcFolder.stage==='all'?all:all.filter(p=>p.type===_pcFolder.stage);
  const visits=tdPropertyVisits(shown);
  if(_pcFolder.open==null&&visits.length)_pcFolder.open=visits[0].key;
  const pair=_pcFolder.stage==='all'?tdPropertyPair(all):null;
  const chip=(v,label,n)=>'<button type="button" class="fb'+(_pcFolder.stage===v?' active':'')+'" onclick="tdFolderStage(\''+v+'\')">'+label+' '+n+'</button>';
  const when=t=>{try{return new Date(t).toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'});}catch(_e){return '';}};
  // The newest shot IS the cover. The screen used to open on a title, a
  // subtitle and four pills, with the work itself starting below the fold and
  // black space under it; a property album should open on the property.
  const cover=all[0]&&tdPhotoSrc(all[0]);
  // A stage nobody shot is not a filter, it is a 0 taking up a quarter of the
  // row. And when every shot is the same stage there is nothing to filter at
  // all, so the row goes entirely.
  const stages=[['before','Before'],['progress','Progress'],['after','After']].filter(x=>count(x[0])>0);
  const sel=_pcRev&&_pcRev.sel;
  el.innerHTML=
    '<div class="pc-rev-top ghost">'+
      (sel
        ?'<button type="button" class="pc-side pc-pill pc-glass" onclick="tdSelAll()">'+(sel.length===all.length?'None':'All')+'</button>'+
          '<span class="pc-rev-sp pc-sel-n">'+_pcSelCount(sel.length)+'</span>'+
          '<button type="button" class="pc-side pc-pill pc-glass" onclick="tdSelectMode(false)">Cancel</button>'
        :'<button type="button" class="pc-side pc-pill pc-glass" onclick="tdReviewClose()">Close</button>'+
          '<span class="pc-rev-sp"></span>'+
          (_pcRev&&_pcRev.trash.length?'<button type="button" class="pc-side pc-pill pc-glass" onclick="tdReviewUndo()">Undo delete</button>':'')+
          '<button type="button" class="pc-side pc-pill pc-glass" onclick="tdSelectMode(true)">Select</button>')+
    '</div>'+
    '<div class="pc-fold">'+
      '<div class="pc-fold-hero"'+(cover?' style="background-image:url(\''+_pcEscUrl(cover)+'\')"':'')+'>'+
        tdStreetSlotHTML(c,_pcFolder.addr,'hero')+
        '<div class="pc-fold-hd">'+
          '<div class="pc-fold-addr">'+escHtml((_pcFolder.addr||'').split(',')[0]||'This property')+'</div>'+
          '<div class="pc-fold-sub">'+all.length+(all.length===1?' photo':' photos')+' \u00b7 '+
            visits.length+(visits.length===1?' visit':' visits')+(c?' \u00b7 '+escHtml(c.name||''):'')+'</div>'+
        '</div>'+
      '</div>'+
      (stages.length>1?'<div class="pc-fold-chips">'+chip('all','All',all.length)+
        stages.map(x=>chip(x[0],x[1],count(x[0]))).join('')+'</div>':'')+
      (pair&&!sel?'<div class="pc-fold-ba">'+
        '<div class="pc-fold-ba-hd"><div style="flex:1;min-width:0">'+
          '<div class="pc-fold-ba-lbl">Before &amp; After</div>'+
          '<div class="pc-fold-ba-name">'+escHtml(pair.name||'This job')+'</div></div>'+
          '<button type="button" class="pc-side" onclick="tdFolderSendPair()">Send</button>'+
        '</div>'+
        '<div class="pc-fold-ba-grid">'+_pcFolderCell(pair.before)+_pcFolderCell(pair.after)+'</div>'+
        '<div class="pc-fold-ba-ft"><span>Before</span><span>After</span></div>'+
      '</div>':'')+
      visits.map(v=>{
        const open=!!sel||_pcFolder.open===v.key;
        return '<div class="pc-fold-visit">'+
          '<button type="button" class="pc-fold-visit-hd" onclick="tdFolderVisit(\''+v.key+'\')">'+
            '<span class="pc-fold-visit-t">'+
              '<span class="pc-fold-visit-day">'+escHtml(when(v.at))+'</span>'+
              '<span class="pc-fold-visit-what">'+escHtml(v.what||'Walkthrough')+'</span>'+
            '</span>'+
            '<span class="pc-fold-visit-n">'+v.photos.length+'</span>'+
            '<span class="pc-fold-caret'+(open?' open':'')+'">\u2304</span>'+
          '</button>'+
          (open?'<div class="pc-rev-grid flat">'+v.photos.map(x=>_pcFolderCell(x,!_pcOneStage(v.photos))).join('')+'</div>':'')+
        '</div>';
      }).join('')+
    '</div>'+
    (sel?_pcSelBarHTML():'');
}
// The pair is what a customer asks for, so Send is the hub they already have.
function tdFolderSendPair(){
  if(!_pcFolder)return false;
  const c=clients.find(x=>x.id===_pcFolder.clientId);
  if(!c)return false;
  tdReviewClose();
  if(typeof sendClientHub==='function')return sendClientHub(c.id),true;
  if(typeof openClientDetail==='function')openClientDetail(c.id);
  return true;
}

// ── Wrong house, move it ────────────────────────────────────────────────────
// Until now a filed photo was filed forever: tdFilePhoto could move it
// anywhere, and nothing in the app ever called it again. Jack has one shot
// sitting on Pepe with no property on it, and no way to put it right.
//
// It is the same attach card, scoped to ONE photo, which also means a burst
// can be split across two addresses a shot at a time.
function tdMovePhoto(photoId){
  const p=photos.find(x=>String(x.id)===String(photoId));
  if(!p)return false;
  _pcAtt={ids:[p.id],clientId:null,addr:'',bidId:null,jobId:null};
  _pcAttPaint('who');
  return true;
}

// One tap: the whole burst, on that customer AND that property.
function tdReviewConfirmHere(){
  if(!_pcRev)return 0;
  const g=_pcRevGuess(_pcRevRows());
  if(!g)return 0;
  _pcAtt={ids:_pcRev.ids.slice(),clientId:g.client.id,addr:g.addr||'',bidId:null,jobId:null,
    // How far the fix was from the pin we matched, kept for the next time a
    // photo lands on the wrong house and somebody has to work out why.
    m:Math.round(g.d)};
  return _pcAttAfterAddr();
}

// ── The viewer, edge to edge (owner 2026-09-23: "why don't we go to full
// screen by default") ──────────────────────────────────────────────────────
// The photo owns the whole screen and every control floats over it on glass,
// the way Photos does it. One tap on the photo and the controls get out of
// the way; another brings them back. Four buttons a person already knows
// from their own camera roll sit at the bottom (Share, Mark up, Info,
// Delete), and the two jobs that are ours alone, Move and Full size, live
// behind the ••• at the top so they never crowd the photo.
function _pcWhen(p,withDay){
  try{
    const d=new Date(p.uploadedAt);if(isNaN(d))return '';
    const t=d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
    const now=new Date();
    const same=(a,b)=>a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();
    const y=new Date(now.getTime()-864e5);
    const day=same(d,now)?'Today':same(d,y)?'Yesterday':d.toLocaleDateString('en-US',withDay?{weekday:'short',month:'short',day:'numeric'}:{month:'short',day:'numeric'});
    return day+' '+t;
  }catch(_e){return '';}
}
function _pcStageWord(t){return t?String(t).charAt(0).toUpperCase()+String(t).slice(1):'';}
function _pcRevViewerHTML(rows){
  const p=rows[_pcRev.i],n=rows.length,i=_pcRev.i;
  const street=String(p.addr||'').split(',')[0]||p.client_name||'Photo';
  // A window of the neighbours, not the whole set: a hundred thumbnails in a
  // strip is a scrollbar, and the strip is for knowing where you are.
  const from=Math.max(0,Math.min(i-4,n-9)),to=Math.min(n,from+9);
  const scrub=n>1?'<div class="pc-v-scrub">'+rows.slice(from,to).map((x,k)=>
    '<button type="button" class="pc-v-th'+(from+k===i?' on':'')+'" aria-label="Photo '+(from+k+1)+'" '+
      'style="background-image:url(\''+_pcEscUrl(tdPhotoSrc(x))+'\')" onclick="tdReviewOpen('+(from+k)+')"></button>').join('')+'</div>':'';
  return '<div class="pc-v-top">'+
      '<button type="button" class="pc-side pc-round pc-glass" onclick="tdReviewGrid()">'+_pcIcon('back')+'<span class="pc-sr">All shots</span></button>'+
      '<div class="pc-v-title pc-glass"><div class="pc-v-a">'+escHtml(street)+'</div>'+
        '<div class="pc-v-b"><em class="st-'+escHtml(p.type||'')+'">'+escHtml(_pcStageWord(p.type))+'</em> · '+escHtml(_pcWhen(p))+
          ' · <span class="pc-rev-title">'+(i+1)+' of '+n+'</span></div></div>'+
      '<button type="button" class="pc-side pc-round pc-glass" onclick="tdViewerMenu()">'+_pcIcon('more')+'<span class="pc-sr">More</span></button>'+
      '<div class="pc-menu pc-glass" id="pc-menu">'+
        '<button type="button" class="pc-side" onclick="tdViewerMenu(false);tdMovePhoto(\''+p.id+'\')">Move</button>'+
        (p.fullPath?'<button type="button" class="pc-side" id="pc-rev-full" onclick="tdViewerMenu(false);tdPhotoFullSize(\''+p.id+'\');this.remove()">Full size</button>':'')+
      '</div>'+
    '</div>'+
    _pcRevStageHTML(rows)+
    scrub+
    (_pcRev.trash.length?'<button type="button" class="pc-side pc-undo pc-glass" onclick="tdReviewUndo()">Undo delete</button>':'')+
    '<div class="pc-rev-foot pc-v-bar">'+
      '<button type="button" class="pc-side pc-round pc-big pc-glass" onclick="tdPhotoShare([\''+p.id+'\'])">'+_pcIcon('share')+'<span class="pc-sr">Share</span></button>'+
      '<div class="pc-cap pc-glass">'+
        '<button type="button" class="pc-side pc-round pc-big" onclick="tdAnnotatePhoto(\''+p.id+'\')">'+_pcIcon('pen')+'<span class="pc-sr">Mark up</span></button>'+
        '<button type="button" class="pc-side pc-round pc-big" onclick="tdPhotoInfo(\''+p.id+'\')">'+_pcIcon('info')+'<span class="pc-sr">Details</span></button>'+
      '</div>'+
      '<button type="button" class="pc-side pc-round pc-big pc-glass danger" onclick="tdReviewDelete()">'+_pcIcon('trash')+'<span class="pc-sr">Delete</span></button>'+
    '</div>';
}
// ── Sharp, the way Photos is sharp (owner 2026-09-23: "it's not showing the
// full quality, it should") ────────────────────────────────────────────────
// The viewer used to paint tdPhotoSrc, which is the grid's 360px THUMB, and
// stretch it across a 1170px-wide screen. It stays the first paint, because it
// is already in cache from the grid and so the photo is on screen instantly,
// but it is never the last one:
//   1. at once, the photo you are on (and the two beside it, so a swipe
//      lands on a sharp picture) moves up to the display copy;
//   2. once you have STAYED on a photo for a beat, it moves up again to the
//      full-resolution copy, when one exists.
// The dwell is the egress rule from 2026-09-22 kept honest: flicking through
// forty photos pulls forty display copies, not forty 12MP originals. Each swap
// waits for the new image to decode, so the picture sharpens in place instead
// of blinking to black.
const _PC_FULL_DWELL=450;
let _pcSharpTimer=null;
function _pcViewSrc(p){
  return (p&&(p.url||p.data||p.thumbUrl))||'';
}
function _pcSwapSrc(img,url){
  if(!img||!url||img.getAttribute('src')===url)return;
  const pre=new Image();
  pre.onload=()=>{if(img.isConnected)img.src=url;};
  pre.src=url;
}
function _pcRevSharpen(){
  clearTimeout(_pcSharpTimer);
  if(!_pcRev||_pcRev.i<0)return;
  const rows=_pcRevRows(),n=rows.length,i=_pcRev.i;
  const p=rows[i];
  if(!p)return;
  const panes=[...document.querySelectorAll('#pc-rev .pc-rev-pane img, #pc-rev-stage > .pc-rev-img')];
  const cur=document.getElementById('pc-rev-img');
  if(n>1&&panes.length===3){
    _pcSwapSrc(panes[0],_pcViewSrc(rows[(i-1+n)%n]));
    _pcSwapSrc(panes[2],_pcViewSrc(rows[(i+1)%n]));
  }
  _pcSwapSrc(cur,_pcViewSrc(p));
  if(!p.fullPath)return;
  const id=p.id;
  _pcSharpTimer=setTimeout(()=>{
    if(!_pcRev||_pcRev.i<0)return;
    const now=_pcRevRows()[_pcRev.i];
    if(!now||String(now.id)!==String(id))return;
    const url=_pcFullUrl(now);
    if(!url)return;
    _pcSwapSrc(document.getElementById('pc-rev-img'),url);
    // Nothing left to offer behind the menu once it is on screen.
    document.getElementById('pc-rev-full')?.remove();
  },_PC_FULL_DWELL);
}
// ── Look Around: the house from the street (owner 2026-09-23) ───────────────
// "Can we pull Apple's street photo?" onto the property card and the album
// cover. Apple's imagery comes through MapKit in its own frame
// (look-around.html says why), and it is never copied or stored: Apple's
// terms allow showing it live, not keeping it, and a live view is also what
// lets a contractor turn and walk the street before the first visit.
//
// A slot starts hidden and only appears once the frame says Apple has
// imagery for that spot; where it has none the slot removes itself and
// whatever was there before (the newest job photo) simply stays.
let _pcSvSeq=0;
const _pcSvState={};   // "lat,lon" -> 'ready' | 'none', so a re-render never re-asks
function _pcSvKey(lat,lon){return Number(lat).toFixed(5)+','+Number(lon).toFixed(5);}
function tdStreetPlace(c,addr){
  if(!c)return null;
  const k=String(addr||c.addr||'').trim().toLowerCase();
  const places=_pcClientPlaces(c);
  const hit=places.find(p=>String(p.addr||'').trim().toLowerCase()===k)||(!addr?places[0]:null);
  return hit&&isFinite(hit.lat)&&isFinite(hit.lon)?{lat:+hit.lat,lon:+hit.lon,addr:hit.addr||addr||''}:null;
}
function tdStreetSlotHTML(c,addr,cls){
  const pl=tdStreetPlace(c,addr);
  if(!pl)return '';
  if(typeof _tdMapkitToken!=='function'||!_tdMapkitToken())return '';
  const key=_pcSvKey(pl.lat,pl.lon);
  if(_pcSvState[key]==='none')return '';
  const id='td-sv-'+(++_pcSvSeq);
  const q='id='+id+'&lat='+pl.lat+'&lon='+pl.lon;
  const arg=pl.lat+','+pl.lon+','+JSON.stringify(String(pl.addr||'').split(',')[0]).replace(/"/g,'&quot;');
  return '<div class="td-sv'+(cls?' '+cls:'')+(_pcSvState[key]==='ready'?' on':'')+'" id="'+id+'" data-key="'+key+'">'+
    '<iframe src="look-around.html?'+q+'" title="Look Around" tabindex="-1" aria-hidden="true"></iframe>'+
    '<button type="button" class="td-sv-tap" aria-label="Look Around" onclick="event.stopPropagation();tdStreetOpen('+arg+')"></button>'+
    '<span class="td-sv-badge pc-glass">'+_pcIcon('globe')+'Look Around</span>'+
  '</div>';
}
function _pcSvMessage(e){
  if(!e||e.origin!==location.origin)return;
  const d=e.data;
  if(!d||d.type!=='td-sv'||!d.id)return;
  const el=document.getElementById(d.id);
  if(!el)return;
  const key=el.getAttribute('data-key')||'';
  if(d.state==='ready'){_pcSvState[key]='ready';el.classList.add('on');}
  else{_pcSvState[key]='none';el.remove();}
}
if(typeof window!=='undefined')window.addEventListener('message',_pcSvMessage);
// Full screen, walkable. Its own frame in LookAround mode, over whatever is
// open, with the same glass close the viewer uses.
function tdStreetOpen(lat,lon,addr){
  if(!isFinite(lat)||!isFinite(lon))return false;
  tdStreetClose();
  const el=document.createElement('div');
  el.id='td-sv-full';el.className='td-sv-full';
  el.innerHTML='<iframe src="look-around.html?mode=full&id=td-sv-full-f&lat='+lat+'&lon='+lon+'" title="Look Around" allow="fullscreen"></iframe>'+
    '<button type="button" class="pc-side pc-round pc-glass td-sv-x" onclick="tdStreetClose()">'+_pcIcon('x')+'<span class="pc-sr">Close</span></button>'+
    (addr?'<div class="td-sv-cap pc-glass">'+escHtml(String(addr))+' · Look Around</div>':'');
  document.body.appendChild(el);
  return true;
}
function tdStreetClose(){
  document.getElementById('td-sv-full')?.remove();
  return true;
}
function tdViewerMenu(open){
  const m=document.getElementById('pc-menu');
  if(!m)return false;
  m.classList.toggle('open',open===undefined?!m.classList.contains('open'):!!open);
  return m.classList.contains('open');
}
// One tap on the photo hides every control, the next brings them back.
function tdViewerBare(on){
  if(!_pcRev)return false;
  _pcRev.bare=on===undefined?!_pcRev.bare:!!on;
  const el=document.getElementById('pc-rev');
  if(el)el.classList.toggle('pc-bare',!!_pcRev.bare&&_pcRev.i>=0);
  tdViewerMenu(false);
  return _pcRev.bare;
}

// ── Share: the system sheet, with the photo itself ──────────────────────────
// The iPhone's own share sheet (Messages, Mail, AirDrop, Save Image) with the
// actual file, so the GPS written into it travels too. The full-resolution
// copy when one exists, because a share is somebody asking for the photo on
// purpose, which is the one time the full copy's egress is worth paying.
async function tdPhotoShare(ids){
  const rows=(ids||[]).map(id=>photos.find(p=>String(p.id)===String(id))).filter(Boolean);
  if(!rows.length)return false;
  try{
    if(navigator.share&&navigator.canShare){
      const files=[];
      for(let k=0;k<rows.length;k++){
        const p=rows[k];
        const src=(p.fullPath&&_pcFullUrl(p))||tdPhotoSrc(p);
        if(!src)continue;
        const blob=await (await fetch(src)).blob();
        const ext=/png/.test(blob.type)?'png':'jpg';
        files.push(new File([blob],(String(p.addr||'photo').split(',')[0].replace(/[^\w]+/g,'-')||'photo')+'-'+(k+1)+'.'+ext,{type:blob.type||'image/jpeg'}));
      }
      if(files.length&&navigator.canShare({files})){await navigator.share({files});return true;}
    }
  }catch(e){if(e&&e.name==='AbortError')return false;}
  if(typeof showToast==='function')showToast('Sharing is not available on this device','ℹ️');
  return false;
}

// ── Details: swipe up on a photo (owner 2026-09-23: "where's the gps info") ──
// The proof, readable by a homeowner or an adjuster: when, who, whether it was
// taken at the house, where on a real Apple map, and what the file carries.
// Every line is something the row already knows; a line with nothing behind it
// is left out rather than printed as a dash.
let _pcInfoMap=null;
function _pcHouseFor(p){
  const c=p&&p.client_id!=null?clients.find(x=>x.id===p.client_id):null;
  if(c&&p.addr){
    const same=a=>String(a||'').trim().toLowerCase()===String(p.addr||'').trim().toLowerCase();
    const pl=_pcClientPlaces(c).find(x=>same(x.addr));
    if(pl)return{lat:pl.lat,lon:pl.lon,addr:pl.addr,client:c};
  }
  const g=tdGuessPlaceFor(p);
  if(g){const pl=_pcClientPlaces(g.client).find(x=>x.addr===g.addr);return{lat:pl?pl.lat:null,lon:pl?pl.lon:null,addr:g.addr,client:g.client};}
  return c?{lat:c.lat!=null?c.lat:null,lon:c.lon!=null?c.lon:null,addr:p.addr||c.addr||'',client:c}:null;
}
function tdPhotoInfo(photoId){
  const id=photoId!=null?photoId:(_pcRev&&_pcRev.i>=0?_pcRevRows()[_pcRev.i]?.id:null);
  const p=photos.find(x=>String(x.id)===String(id));
  if(!p)return false;
  tdPhotoInfoClose();
  tdViewerMenu(false);
  const house=_pcHouseFor(p);
  const hasFix=p.lat!=null&&p.lon!=null;
  const dM=p.addrM!=null?p.addrM:(hasFix&&house&&house.lat!=null?_pcMeters(p.lat,p.lon,house.lat,house.lon):null);
  const onSite=dM!=null&&dM<=150;
  let day='';try{day=new Date(p.uploadedAt).toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'});}catch(_e){}
  let time='';try{time=new Date(p.uploadedAt).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});}catch(_e){}
  const addr=(house&&house.addr)||p.addr||'';
  const street=String(addr).split(',')[0];
  const rest=String(addr).split(',').slice(1).join(',').trim();
  const who=(house&&house.client&&house.client.name)||p.client_name||'';
  const li=(k,v,cls)=>'<div class="pc-li"><span class="k">'+k+'</span><span class="v'+(cls?' '+cls:'')+'">'+v+'</span></div>';
  const px=String(p.shotPx||'').split('x').map(Number);
  const mp=px.length===2&&px[0]&&px[1]?Math.round(px[0]*px[1]/1e6):0;
  const chips=[
    px.length===2&&px[0]?px[0]+' × '+px[1]:'',
    mp?mp+' MP':'',
    p.accM!=null?'±'+_pcFt(p.accM)+' ft':'',
    p.exifGps?'GPS in file':'',
    p.imported?'Imported':'',
    p.stamped?'Stamped':'',
    p.annotated?'Marked up':''
  ].filter(Boolean);
  const el=document.createElement('div');
  el.id='pc-info';el.className='pc-info';
  el.innerHTML='<div class="pc-info-bd" onclick="tdPhotoInfoClose()"></div>'+
    '<div class="pc-info-sheet" id="pc-info-sheet">'+
      '<div class="pc-grab"></div>'+
      '<div class="pc-info-when">'+escHtml(day)+'</div>'+
      '<div class="pc-info-sub">'+[escHtml(time),p.by?escHtml(p.by):''].filter(Boolean).join(' · ')+
        (onSite?' · <span class="pc-onsite">'+_pcIcon('shield')+'On site</span>':'')+'</div>'+
      (addr||hasFix?'<div class="pc-card">'+
        (hasFix?'<div class="pc-info-map" id="pc-info-map"></div>':'')+
        '<div class="pc-info-addr"><div class="a">'+escHtml(street||'No address')+'</div>'+
          '<div class="b">'+escHtml([rest,who].filter(Boolean).join(' · '))+'</div></div>'+
      '</div>':'')+
      '<div class="pc-card">'+
        li('Stage','<span class="st-'+escHtml(p.type||'')+'">'+escHtml(_pcStageWord(p.type))+'</span>')+
        (dM!=null?li('Distance from house',_pcFt(dM)+' ft'):'')+
        (hasFix?li('Coordinates',Number(p.lat).toFixed(5)+', '+Number(p.lon).toFixed(5),'mono'):li('Coordinates','None saved'))+
      '</div>'+
      (chips.length?'<div class="pc-card pc-chips">'+chips.map(c=>'<span class="pc-chip-s">'+escHtml(c)+'</span>').join('')+'</div>':'')+
    '</div>';
  document.body.appendChild(el);
  _pcInfoBindDrag();
  if(hasFix)_pcInfoMapDraw(p,house);
  return true;
}
function tdPhotoInfoClose(){
  if(_pcInfoMap){try{_pcInfoMap.destroy();}catch(_e){}_pcInfoMap=null;}
  const el=document.getElementById('pc-info');
  if(el)el.remove();
  return true;
}
// Pull the sheet back down to put it away, same as it came up.
function _pcInfoBindDrag(){
  const sh=document.getElementById('pc-info-sheet');
  if(!sh)return;
  let y0=null,dy=0;
  sh.addEventListener('pointerdown',e=>{if(sh.scrollTop>0)return;y0=e.clientY;dy=0;sh.style.transition='none';});
  sh.addEventListener('pointermove',e=>{if(y0==null)return;dy=Math.max(0,e.clientY-y0);sh.style.transform=dy?'translate3d(0,'+dy+'px,0)':'';});
  const end=()=>{if(y0==null)return;y0=null;sh.style.transition='';
    if(dy>90){tdPhotoInfoClose();return;}
    sh.style.transform='';};
  sh.addEventListener('pointerup',end);sh.addEventListener('pointercancel',end);
}
// A real Apple map when MapKit is up (it is on tradedeskpro.app and the Pages
// previews, the same token the mileage and measure maps use). Anywhere else
// the card simply has no map, never a broken one.
function _pcInfoMapDraw(p,house){
  const box=document.getElementById('pc-info-map');
  if(!box)return;
  if(typeof mapkit==='undefined'||typeof _mapkitReady==='undefined'||!_mapkitReady){box.remove();return;}
  try{
    const spot=new mapkit.Coordinate(p.lat,p.lon);
    const map=new mapkit.Map(box,{center:spot,colorScheme:mapkit.Map.ColorSchemes.Dark,
      showsCompass:mapkit.FeatureVisibility.Hidden,showsScale:mapkit.FeatureVisibility.Hidden,
      showsZoomControl:false,showsMapTypeControl:false,showsUserLocationControl:false,
      isScrollEnabled:false,isZoomEnabled:false,isRotationEnabled:false});
    const items=[];
    if(p.accM!=null){
      map.addOverlay(new mapkit.CircleOverlay(spot,Math.max(4,p.accM),{style:new mapkit.Style({fillColor:'#0A84FF',fillOpacity:.18,strokeColor:'#0A84FF',strokeOpacity:.45,lineWidth:1})}));
    }
    const dot=new mapkit.Annotation(spot,()=>{const d=document.createElement('div');d.className='pc-map-dot';return d;},{anchorOffset:new DOMPoint(0,0)});
    items.push(dot);
    if(house&&house.lat!=null&&house.lon!=null)items.push(new mapkit.MarkerAnnotation(new mapkit.Coordinate(house.lat,house.lon),{color:'#FF453A'}));
    map.showItems(items,{animate:false,padding:new mapkit.Padding(36,36,36,36),minimumSpan:new mapkit.CoordinateSpan(0.0012,0.0012)});
    _pcInfoMap=map;
  }catch(_e){box.remove();}
}
// ── GPS INTO THE FILE ITSELF ────────────────────────────────────────────────
// A canvas re-encode strips EXIF, always, and a getUserMedia frame never had
// any, so every photo this app has ever written left with a 76 byte stub
// holding nothing but its pixel dimensions. The coordinates were on the row in
// our database and nowhere in the JPEG, so a photo emailed to an adjuster
// arrived with no evidence attached to it.
//
// This writes a real APP1: GPS latitude, longitude, the fix's accuracy, and
// the moment it was taken, in the form every EXIF reader on earth expects.
// Hand-rolled rather than a library, because the whole of what we need is one
// IFD and pulling in a dependency to write 200 bytes is not a trade.
function _pcExifBytes(lat,lon,when,accM){
  if(!(typeof lat==='number'&&typeof lon==='number'&&isFinite(lat)&&isFinite(lon)))return null;
  const d=new Date(when||Date.now());
  if(isNaN(d.getTime()))return null;
  const p2=(n)=>String(n).padStart(2,'0');
  // EXIF DateTimeOriginal is LOCAL time with no zone, and GPSTimeStamp/
  // GPSDateStamp are UTC. Writing local into the GPS fields is the classic
  // wrong-by-hours bug, so the two are taken from different getters on purpose.
  const local=d.getFullYear()+':'+p2(d.getMonth()+1)+':'+p2(d.getDate())+' '+
              p2(d.getHours())+':'+p2(d.getMinutes())+':'+p2(d.getSeconds());
  const utcDate=d.getUTCFullYear()+':'+p2(d.getUTCMonth()+1)+':'+p2(d.getUTCDate());

  const rat=(v,den)=>[Math.round(v*den),den];
  // Degrees, minutes, seconds: seconds keep four decimal places, which is
  // about a centimetre and far finer than any phone fix.
  const dms=(v)=>{
    const a=Math.abs(v),deg=Math.floor(a),mf=(a-deg)*60,min=Math.floor(mf),sec=(mf-min)*60;
    return [[deg,1],[min,1],rat(sec,10000)];
  };
  const entries=[];   // {tag,type,count,bytes|inline}
  const asc=(s)=>{const b=[];for(let i=0;i<s.length;i++)b.push(s.charCodeAt(i)&0xff);b.push(0);return b;};
  const ratBytes=(pairs)=>{const b=[];pairs.forEach(([n,dd])=>{b.push(n>>>24&255,n>>>16&255,n>>>8&255,n&255,dd>>>24&255,dd>>>16&255,dd>>>8&255,dd&255);});return b;};

  const gps=[];
  gps.push({tag:0x0000,type:1,count:4,bytes:[2,3,0,0]});                    // GPSVersionID
  gps.push({tag:0x0001,type:2,count:2,bytes:asc(lat>=0?'N':'S')});
  gps.push({tag:0x0002,type:5,count:3,bytes:ratBytes(dms(lat))});
  gps.push({tag:0x0003,type:2,count:2,bytes:asc(lon>=0?'E':'W')});
  gps.push({tag:0x0004,type:5,count:3,bytes:ratBytes(dms(lon))});
  gps.push({tag:0x0007,type:5,count:3,bytes:ratBytes([[d.getUTCHours(),1],[d.getUTCMinutes(),1],rat(d.getUTCSeconds(),1)])});
  if(typeof accM==='number'&&isFinite(accM)&&accM>0)
    gps.push({tag:0x001F,type:5,count:1,bytes:ratBytes([rat(accM,100)])});  // GPSHPositioningError
  gps.push({tag:0x001D,type:2,count:11,bytes:asc(utcDate)});

  const exifSub=[{tag:0x9003,type:2,count:20,bytes:asc(local)}];            // DateTimeOriginal
  const ifd0=[{tag:0x0132,type:2,count:20,bytes:asc(local)}];               // DateTime

  // Lay the three IFDs out one after another, each followed by its own data.
  const sizeOf=(list)=>2+list.length*12+4;
  const dataOf=(list)=>list.reduce((n,e)=>n+(e.bytes.length>4?e.bytes.length+(e.bytes.length&1):0),0);
  const TIFF=8;
  const ifd0At=TIFF;
  const ifd0End=ifd0At+sizeOf(ifd0)+2*12;            // +2 for the pointers added below
  const exifAt=ifd0End+dataOf(ifd0);
  const gpsAt=exifAt+sizeOf(exifSub)+dataOf(exifSub);
  const gpsEnd=gpsAt+sizeOf(gps)+dataOf(gps);

  const out=[];
  const u16=(v)=>out.push(v>>>8&255,v&255);
  const u32=(v)=>out.push(v>>>24&255,v>>>16&255,v>>>8&255,v&255);
  out.push(0x4D,0x4D); u16(0x002A); u32(TIFF);       // MM, 42, IFD0 offset

  const writeIfd=(list,extra,dataStart)=>{
    const all=list.concat(extra||[]);
    all.sort((a,b)=>a.tag-b.tag);
    u16(all.length);
    let dp=dataStart;
    const tail=[];
    all.forEach(e=>{
      u16(e.tag); u16(e.type); u32(e.count);
      if(e.ptr!=null){u32(e.ptr);return;}
      if(e.bytes.length<=4){
        const b=e.bytes.slice(); while(b.length<4)b.push(0);
        out.push(b[0],b[1],b[2],b[3]);
      }else{
        u32(dp);
        const b=e.bytes.slice(); if(b.length&1)b.push(0);
        tail.push(b); dp+=b.length;
      }
    });
    u32(0);
    tail.forEach(b=>b.forEach(x=>out.push(x)));
  };
  writeIfd(ifd0,[{tag:0x8769,type:4,count:1,ptr:exifAt,bytes:[]},
                 {tag:0x8825,type:4,count:1,ptr:gpsAt,bytes:[]}],ifd0End);
  writeIfd(exifSub,[],exifAt+sizeOf(exifSub));
  writeIfd(gps,[],gpsAt+sizeOf(gps));
  void gpsEnd;
  return new Uint8Array(out);
}

// Put that APP1 into the JPEG, replacing the stub the canvas encoder wrote.
// Two EXIF segments in one file is undefined behaviour and readers disagree
// about which wins, so the old one goes rather than the new one being appended.
async function _pcWithGps(blob,lat,lon,when,accM){
  try{
    const ex=_pcExifBytes(lat,lon,when,accM);
    if(!ex||!blob)return blob;
    const buf=new Uint8Array(await blob.arrayBuffer());
    if(buf[0]!==0xFF||buf[1]!==0xD8)return blob;          // not a JPEG, leave it alone
    let i=2;
    while(i<buf.length-1&&buf[i]===0xFF){
      const m=buf[i+1];
      if(m===0xDA||m===0xD9)break;                        // image data starts here
      const len=(buf[i+2]<<8)|buf[i+3];
      if(m===0xE1){                                        // the stub: drop it
        const cut=new Uint8Array(buf.length-(2+len));
        cut.set(buf.subarray(0,i),0);cut.set(buf.subarray(i+2+len),i);
        return _pcSpliceApp1(cut,ex,blob.type);
      }
      if(m<0xE0||m>0xEF)break;                             // past the app segments
      i+=2+len;
    }
    return _pcSpliceApp1(buf,ex,blob.type);
  }catch(_e){return blob;}                                 // never lose a photo over metadata
}
function _pcSpliceApp1(buf,ex,type){
  const seg=6+ex.length+2;                                 // "Exif\0\0" + payload + the length field
  const out=new Uint8Array(buf.length+2+seg);
  let o=0;
  out[o++]=0xFF;out[o++]=0xD8;
  out[o++]=0xFF;out[o++]=0xE1;
  out[o++]=(seg>>8)&255;out[o++]=seg&255;
  out[o++]=0x45;out[o++]=0x78;out[o++]=0x69;out[o++]=0x66;out[o++]=0;out[o++]=0;
  out.set(ex,o);o+=ex.length;
  out.set(buf.subarray(2),o);
  return new Blob([out],{type:type||'image/jpeg'});
}


function _pcEscUrl(u){return String(u||'').replace(/'/g,'%27').replace(/"/g,'&quot;');}
// ── The swipe (owner 2026-09-22: "cant scroll through like you can ios
// images") ──────────────────────────────────────────────────────────────────
//
// What was here was a flick DETECTOR: touchstart, touchend, and if the finger
// had travelled 40px, jump an index and repaint the whole sheet. Nothing moved
// under the thumb, nothing of the next photo was ever visible, a slow drag did
// nothing at all, and the jump was a hard innerHTML swap with no motion. That
// is not the gesture people know from a camera roll, it is a button you happen
// to draw on.
//
// So the stage is a THREE PANE track, previous, current and next, parked on
// the middle one. The finger moves the track 1:1, which means the neighbour is
// already on screen and following your thumb before you have decided to commit
// to it. Let go and it either carries through or springs back.
//
// Wrapping, rather than an iOS rubber band at the ends, because tdReviewStep
// already wraps for the Prev and Next buttons and has a test pinning it. One
// behaviour for both, so the gesture and the button never disagree.
function _pcRevStageHTML(rows){
  const n=rows.length,i=_pcRev.i;
  const img=(p,id)=>'<div class="pc-rev-pane">'+
    '<img class="pc-rev-img"'+(id?' id="'+id+'"':'')+' src="'+_pcEscUrl(tdPhotoSrc(p))+'" alt="">'+
  '</div>';
  // One photo is not a carousel. No track, no panes, no listeners: a drag on a
  // set of one can only ever land back where it started.
  if(n<2){
    return '<div class="pc-rev-stage" id="pc-rev-stage">'+
      '<img class="pc-rev-img" id="pc-rev-img" src="'+_pcEscUrl(tdPhotoSrc(rows[i]))+'" alt="">'+
    '</div>';
  }
  return '<div class="pc-rev-stage" id="pc-rev-stage">'+
    '<div class="pc-rev-track" id="pc-rev-track">'+
      img(rows[(i-1+n)%n])+img(rows[i],'pc-rev-img')+img(rows[(i+1)%n])+
    '</div>'+
  '</div>';
}
// Distance OR speed, the way a phone does it: a slow deliberate drag past a
// third of the screen commits, and so does a quick flick that never got that
// far. Judging on distance alone makes a real flick feel ignored.
// A flick still has to BE a movement. Velocity alone would turn a 25px twitch
// of the thumb into a page turn, because a fast enough tiny movement clears any
// speed bar you set (caught by its own test, 2026-09-22). So speed can only
// commit a drag that already travelled a real distance.
const _PC_SWIPE_FRACTION=0.28, _PC_SWIPE_VELOCITY=0.45, _PC_SWIPE_MIN=44;
// Down is a shorter commitment than sideways: putting a photo away is one
// motion, where stepping through a set is repeated, so it wants less travel.
const _PC_DISMISS_FRACTION=0.16;
function _pcRevBindSwipe(){
  // Bound on the STAGE, not the track, because a single photo has no track and
  // still has to be dismissable. Horizontal drives the carousel when there is
  // one; down always dismisses.
  const stage=document.getElementById('pc-rev-stage');
  const sheet=document.getElementById('pc-rev');
  if(!stage||!sheet)return;
  const track=document.getElementById('pc-rev-track');
  const W=()=>stage.clientWidth||1;
  const H=()=>stage.clientHeight||1;
  let x0=0,y0=0,t0=0,dx=0,dy=0,active=false,axis='';
  const atX=(px)=>{if(track)track.style.transform='translate3d(calc(-33.3333% + '+px+'px),0,0)';};
  // Down is a dismissal in progress, and it moves the way Photos moves it
  // (owner 2026-09-23: "still not seeing the smooth swipe down"): the PHOTO
  // rides under the thumb in both directions and shrinks, the black behind it
  // thins out so the album shows through, and the controls step aside at the
  // first pixel. The sheet itself stays put; only the picture is picked up.
  const img=()=>document.getElementById('pc-rev-img');
  const atY=(py,px)=>{
    const d=Math.max(0,py),im=img();
    sheet.classList.add('pc-dragging');
    if(im)im.style.transform='translate3d('+Math.round(px||0)+'px,'+Math.round(py)+'px,0) scale('+(1-Math.min(d/900,0.32))+')';
    sheet.style.backgroundColor='rgba(0,0,0,'+(1-Math.min(d/480,0.85))+')';
  };
  const clearY=()=>{const im=img();if(im){im.style.transform='';im.classList.remove('snap');}
    sheet.style.backgroundColor='';sheet.classList.remove('pc-dragging','snap');};
  const settle=(el,css,then)=>{
    el.classList.add('snap');
    if(css!=null)el.style.transform=css;
    let done=false;
    const fin=()=>{if(done)return;done=true;el.removeEventListener('transitionend',fin);then();};
    el.addEventListener('transitionend',fin);
    // A transform that does not change fires no transitionend, and a dropped
    // frame can swallow one, so nothing may depend on the event alone.
    setTimeout(fin,340);
  };
  const down=(e)=>{
    if(e.button!=null&&e.button!==0)return;
    active=true;axis='';dx=0;dy=0;
    x0=e.clientX;y0=e.clientY;t0=Date.now();
    if(track)track.classList.remove('snap');
    sheet.classList.remove('snap');
    try{stage.setPointerCapture&&stage.setPointerCapture(e.pointerId);}catch(_e){}
  };
  const move=(e)=>{
    if(!active)return;
    const ex=e.clientX-x0,ey=e.clientY-y0;
    // The first few pixels decide which gesture this is, and it does not change
    // its mind afterwards. Without the lock a drifting thumb drives both at
    // once and the photo shears sideways while it falls.
    if(!axis){
      if(Math.abs(ex)<6&&Math.abs(ey)<6)return;
      axis=Math.abs(ey)>Math.abs(ex)?'y':'x';
      // Up is the details, the way Photos does it: the photo lifts with the
      // thumb and the sheet comes up on release.
      if(axis==='y'&&ey<0)axis='u';
      if(axis==='x'&&!track){active=false;return;}
    }
    if(axis==='x'){dx=ex;atX(dx);}
    else if(axis==='u'){dy=Math.min(0,ey);stage.style.transform='translate3d(0,'+Math.round(dy*0.35)+'px,0)';}
    else{dy=ey;dx=ex;atY(dy,dx);}
    if(e.cancelable)e.preventDefault();
  };
  const up=()=>{
    if(!active){active=false;return;}
    active=false;
    const dt=Math.max(1,Date.now()-t0);
    // A tap, not a drag: the controls step out of the way, or come back.
    if(!axis){if(dt<400)tdViewerBare();return;}
    if(axis==='u'){
      stage.style.transform='';
      if(dy<-_PC_SWIPE_MIN)tdPhotoInfo();
      return;
    }
    if(axis==='y'){
      const v=dy/dt;
      // Same rule as the carousel: a flick still has to BE a movement, or a
      // fast twitch closes the photo a contractor was reading.
      const go=dy>H()*_PC_DISMISS_FRACTION||(dy>_PC_SWIPE_MIN&&v>_PC_SWIPE_VELOCITY);
      const im=img();
      sheet.classList.add('snap');
      if(!go){
        // Back to where it was: the photo springs home and the black returns.
        sheet.style.backgroundColor='';
        if(!im){clearY();return;}
        settle(im,'translate3d(0,0,0) scale(1)',clearY);
        return;
      }
      sheet.style.backgroundColor='rgba(0,0,0,0)';
      if(!im){clearY();tdReviewClose();return;}
      im.style.opacity='0';
      settle(im,'translate3d('+Math.round(dx)+'px,'+Math.round(H()*0.6)+'px,0) scale(0.6)',()=>{clearY();tdReviewClose();});
      return;
    }
    if(axis!=='x'||!track||!dx){if(track){track.classList.remove('snap');track.style.transform='';}return;}
    const w=W(),v=Math.abs(dx)/dt;
    const go=Math.abs(dx)>w*_PC_SWIPE_FRACTION
          ||(Math.abs(dx)>_PC_SWIPE_MIN&&v>_PC_SWIPE_VELOCITY);
    if(!go){settle(track,'translate3d(-33.3333%,0,0)',()=>{track.classList.remove('snap');track.style.transform='';});return;}
    const d=dx<0?1:-1;
    settle(track,'translate3d(calc(-33.3333% + '+(d<0?w:-w)+'px),0,0)',()=>{tdReviewStep(d);});
  };
  stage.addEventListener('pointerdown',down);
  stage.addEventListener('pointermove',move,{passive:false});
  stage.addEventListener('pointerup',up);
  stage.addEventListener('pointercancel',up);
}
// A keyboard is a real way to look through photos on a laptop, and it costs
// two lines.
function _pcRevKey(e){
  if(!_pcRev||_pcRev.i<0)return;
  if(e.key==='ArrowRight')tdReviewStep(1);
  else if(e.key==='ArrowLeft')tdReviewStep(-1);
  else if(e.key==='Escape')tdReviewGrid();
  else return;
  e.preventDefault();
}
// ── Select many (owner 2026-09-23: "mass delete like iOS") ─────────────────
// The same four things a person does with one photo, done to many: share,
// move to another address, retag the stage, delete. Delete goes through the
// same held bin as a single delete, so Undo works on twelve as it does on one
// and nothing leaves storage until the sheet is closed.
function tdSelectMode(on){
  if(!_pcRev)return false;
  _pcRev.sel=on?[]:null;_pcRev.i=-1;
  _pcRevPaint();return true;
}
function tdSelToggle(id){
  if(!_pcRev||!_pcRev.sel)return false;
  const k=_pcRev.sel.findIndex(x=>String(x)===String(id));
  if(k>=0)_pcRev.sel.splice(k,1);else _pcRev.sel.push(id);
  _pcRevPaint();return _pcRev.sel.length;
}
function tdSelAll(){
  if(!_pcRev||!_pcRev.sel)return false;
  const ids=(_pcRev.folder?_pcFolderRows():_pcRevRows()).map(p=>p.id);
  _pcRev.sel=_pcRev.sel.length===ids.length?[]:ids.slice();
  _pcRevPaint();return _pcRev.sel.length;
}
function tdCellTap(id){
  if(!_pcRev)return false;
  if(_pcRev.sel)return tdSelToggle(id);
  if(_pcRev.folder)return tdFolderOpen(id);
  const i=_pcRev.ids.findIndex(x=>String(x)===String(id));
  return i<0?false:tdReviewOpen(i);
}
function _pcSelBarHTML(){
  const k=_pcRev&&_pcRev.sel?_pcRev.sel.length:0;
  const b=(fn,ic,label,cls)=>'<button type="button" class="pc-tb'+(cls?' '+cls:'')+'"'+(k?'':' disabled')+' onclick="'+fn+'">'+_pcIcon(ic)+'<span>'+label+'</span></button>';
  return '<div class="pc-selbar pc-glass">'+
    b('tdSelShare()','share','Share')+b('tdSelMove()','folder','Move')+b('tdSelStage()','tag','Stage')+b('tdSelDelete()','trash','Delete','danger')+
    '<div class="pc-menu pc-stage-menu pc-glass" id="pc-stage-menu">'+
      ['before','progress','after'].map(t=>'<button type="button" class="pc-side" onclick="tdSelStage(\''+t+'\')"><span class="st-'+t+'">●</span> '+_pcStageWord(t)+'</button>').join('')+
    '</div>'+
  '</div>';
}
function _pcSelRows(){
  return (_pcRev&&_pcRev.sel?_pcRev.sel:[]).map(id=>photos.find(p=>String(p.id)===String(id))).filter(Boolean);
}
function tdSelShare(){
  const ids=_pcSelRows().map(p=>p.id);
  return ids.length?tdPhotoShare(ids):false;
}
function tdSelMove(){
  const ids=_pcSelRows().map(p=>p.id);
  if(!ids.length)return false;
  _pcAtt={ids,clientId:null,addr:'',bidId:null,jobId:null};
  _pcAttPaint('who');
  return true;
}
function tdSelStage(t){
  const rows=_pcSelRows();
  if(!rows.length)return false;
  if(!t){const m=document.getElementById('pc-stage-menu');if(m)m.classList.toggle('open');return true;}
  if(['before','progress','after'].indexOf(t)<0)return false;
  const hubs=new Set();
  rows.forEach(p=>{p.type=t;if(p.client_id!=null)hubs.add(p.client_id);});
  saveAll();
  if(typeof _uploadClientHub==='function')hubs.forEach(cid=>_uploadClientHub(cid).catch(()=>{}));
  _pcRev.sel=null;_pcRevPaint();
  if(typeof showToast==='function')showToast(rows.length+(rows.length===1?' photo':' photos')+' tagged '+_pcStageWord(t),'✅');
  return rows.length;
}
function tdSelDelete(){
  if(!_pcRev)return 0;
  const rows=_pcSelRows();
  if(!rows.length)return 0;
  const gone=new Set(rows.map(p=>String(p.id)));
  rows.forEach(p=>_pcRev.trash.push(p));
  // One Undo puts back the whole batch it took, not the last photo of it.
  (_pcRev.batches=_pcRev.batches||[]).push(rows.length);
  _pcRev.ids=_pcRev.ids.filter(id=>!gone.has(String(id)));
  photos=photos.filter(x=>!gone.has(String(x.id)));
  saveAll();
  _pcRev.sel=null;
  if(!_pcRev.ids.length){tdReviewClose();return rows.length;}
  _pcRevPaint();
  return rows.length;
}
function tdReviewOpen(i){
  if(!_pcRev)return false;
  _pcRev.i=i;_pcRevPaint();return true;
}
function tdReviewGrid(){
  if(!_pcRev)return false;
  _pcRev.i=-1;_pcRevPaint();return true;
}
function tdReviewStep(d){
  if(!_pcRev)return false;
  const n=_pcRevRows().length;
  if(!n)return false;
  _pcRev.i=(_pcRev.i+d+n)%n;
  _pcRevPaint();return true;
}
function tdReviewDelete(){
  if(!_pcRev)return false;
  const rows=_pcRevRows();
  const p=rows[_pcRev.i];
  if(!p)return false;
  _pcRev.trash.push(p);
  (_pcRev.batches=_pcRev.batches||[]).push(1);
  _pcRev.ids=_pcRev.ids.filter(id=>String(id)!==String(p.id));
  photos=photos.filter(x=>String(x.id)!==String(p.id));
  saveAll();
  const left=_pcRevRows().length;
  if(!left){tdReviewClose();return true;}
  if(_pcRev.i>=left)_pcRev.i=left-1;
  _pcRevPaint();
  return true;
}
function tdReviewUndo(){
  if(!_pcRev||!_pcRev.trash.length)return false;
  const k=Math.min(_pcRev.trash.length,(_pcRev.batches&&_pcRev.batches.length)?_pcRev.batches.pop():1);
  for(let n=0;n<k;n++){
    const p=_pcRev.trash.pop();
    photos.push(p);
    _pcRev.ids.push(p.id);
  }
  saveAll();
  _pcRevPaint();
  return true;
}
// One customer for the whole burst: they were all shot in the same place at
// the same minute, so asking per photo is five taps to say the same thing.
// ── Attaching a burst: where it was shot answers most of it ─────────────────
// Owner, 2026-09-21: "if it's taken onsite gps coordinates search the record
// and attach where exactly on the client record?" So the card opens on what
// the coordinates already prove, and the customer list is the fallback rather
// than the first question. Then: which property (only when there are two),
// and which proposal or job (only when there is a choice). Never a step the
// data can answer by itself.
const _PC_NEAR_M=250;
let _pcAtt=null;   // {ids, clientId, addr, bidId, jobId}
let _pcShotPx='';  // WxH of the last frame the camera gave, stamped onto the row
// Everything the coordinates could plausibly mean, nearest first. A job
// carries its own address, so a job hit answers the property question too.
function _pcNearbyMatches(ids){
  const rows=(ids||[]).map(id=>photos.find(x=>String(x.id)===String(id))).filter(Boolean);
  const fix=rows.map(r=>({lat:r.lat,lon:r.lon})).find(f=>f.lat!=null&&f.lon!=null);
  if(!fix)return [];
  const out=[];
  jobs.forEach(j=>{
    if(j.lat==null||j.lon==null)return;
    const d=_pcMeters(fix.lat,fix.lon,j.lat,j.lon);
    if(d>_PC_NEAR_M)return;
    const c=clients.find(x=>x.id===j.client_id);
    out.push({clientId:j.client_id,name:(c&&c.name)||'',addr:j.addr||(c&&c.addr)||'',jobId:j.id,bidId:null,what:j.name||'Job',lat:j.lat,lon:j.lon,d});
  });
  clients.forEach(c=>{
    // Every property, each with its own pin: the whole point of Jack's 6912.
    _pcClientPlaces(c).forEach(pl=>{
      const d=_pcMeters(fix.lat,fix.lon,pl.lat,pl.lon);
      if(d>_PC_NEAR_M)return;
      // One row per HOUSE. A job at a customer's address and the address
      // itself are the same place, and they must collapse whether or not the
      // two strings were typed the same way ("412 Oak St, Wichita KS" vs
      // "412 Oak St"). Matching on the pin as well as the text is what makes
      // that reliable: two saved points within 40m are one building.
      const same=(a,b)=>String(a||'').trim().toLowerCase()===String(b||'').trim().toLowerCase();
      if(out.some(m=>m.clientId===c.id&&(same(m.addr,pl.addr)||
        (m.lat!=null&&_pcMeters(m.lat,m.lon,pl.lat,pl.lon)<=40))))return;
      out.push({clientId:c.id,name:c.name||'',addr:pl.addr,jobId:null,bidId:null,
        what:pl.label==='Primary'?'':pl.label,lat:pl.lat,lon:pl.lon,d});
    });
  });
  return out.sort((a,b)=>a.d-b.d).slice(0,4);
}
function _pcFeet(m){return Math.round(m*3.28084);}
function tdReviewAttach(){
  if(!_pcRev||!_pcRev.ids.length)return false;
  _pcAtt={ids:_pcRev.ids.slice(),clientId:null,addr:'',bidId:null,jobId:null};
  _pcAttPaint('who');
  return true;
}
// The picker is a sheet from the bottom in the same dark glass as the rest of
// TrueShot, not the app's light centred card: it opens over a black photo
// grid, and a white box dropped on top of that read as a different app
// (owner 2026-09-23, "fresh out of Apple"). It keeps .zmodal-overlay so
// every close path that already sweeps modals still sweeps this one.
function _pcAttSheet(){
  let ov=document.getElementById('pc-att');
  if(!ov){
    ov=document.createElement('div');
    ov.id='pc-att';ov.className='zmodal-overlay pc-att-ov';
    ov.addEventListener('click',e=>{if(e.target===ov)tdAttachCancel();});
    document.body.appendChild(ov);
  }
  return ov;
}
function tdAttachCancel(){
  document.getElementById('pc-att')?.remove();
  _pcAtt=null;
  return true;
}
// The "New customer" row. With a search typed that matches nobody by name,
// it offers that name; otherwise it offers the house the photos were taken
// at, once the reverse lookup has said which house that is.
function _pcAttNewRow(q){
  const term=String(q||'').trim();
  const exact=term&&clients.some(c=>String(c.name||'').trim().toLowerCase()===term.toLowerCase());
  if(exact)return '';
  const at=_pcAtt&&_pcAtt.guess?String(_pcAtt.guess).split(',')[0]:'';
  const sub=at?'At '+escHtml(at):'Name and address';
  return '<button type="button" class="pc-file-opt pc-att-new" onclick="tdAttachNew()">'+
    '<span class="pc-av add">'+_pcIcon('plus')+'</span>'+
    '<span class="pc-opt-m"><b>'+(term?'Add \u201c'+escHtml(term)+'\u201d':'New customer')+'</b><span id="pc-att-new-sub">'+sub+'</span></span>'+
    _pcIcon('chev','pc-chev')+'</button>';
}
// Where the photos were taken, as a street address. Asked once per picker,
// in the background; the answer only ever fills blanks, never overwrites
// something he typed.
function _pcAttGuess(){
  if(!_pcAtt||_pcAtt.guess!==undefined||_pcAtt._guessing)return;
  const rows=(_pcAtt.ids||[]).map(id=>photos.find(x=>String(x.id)===String(id))).filter(Boolean);
  const fix=rows.map(r=>({lat:r.lat,lon:r.lon})).find(f=>f.lat!=null&&f.lon!=null);
  if(!fix||typeof _reverseGeocode!=='function'){_pcAtt.guess='';return;}
  const att=_pcAtt;att._guessing=true;
  Promise.resolve().then(()=>_reverseGeocode(fix.lat,fix.lon)).then(r=>{
    att._guessing=false;
    att.guess=(r&&r.addr)||'';
    if(_pcAtt!==att)return;
    const sub=document.getElementById('pc-att-new-sub');
    if(sub&&att.guess)sub.textContent='At '+att.guess.split(',')[0];
    const a=document.getElementById('pc-new-addr');
    if(a){if(!a.value.trim())a.value=att.guess;a.placeholder='Street, city';}
    _pcAttOwner(att);
  }).catch(()=>{att._guessing=false;att.guess='';
    const a=document.getElementById('pc-new-addr');if(a)a.placeholder='Street, city';});
}
// Were these photos taken somewhere this customer has no house on file?
// The pins answer it when the houses were ever located. When they were not,
// the street Apple named for the photos answers it: a street that is none of
// theirs is a new property, not a reason to guess the one on record.
// Jobs on the schedule the day imported photos were taken, for photos with no
// location to match on. Only imported ones: a photo shot through the camera
// today already has a fix, or it has nothing worth guessing from.
function _pcDayMatches(ids){
  const rows=(ids||[]).map(id=>photos.find(x=>String(x.id)===String(id))).filter(Boolean);
  if(!rows.length||!rows.every(r=>r.imported)||rows.some(r=>r.lat!=null&&r.lon!=null))return [];
  if(typeof getJobsOnDay!=='function'||typeof dateKey!=='function')return [];
  const keys=[...new Set(rows.map(r=>{const d=new Date(r.uploadedAt);return isNaN(d)?'':dateKey(d);}).filter(Boolean))];
  if(keys.length!==1)return [];
  const seen=new Set(),out=[];
  getJobsOnDay(keys[0]).forEach(({job,isBuf})=>{
    if(isBuf||!job||job.client_id==null||seen.has(job.id))return;
    seen.add(job.id);
    const c=clients.find(x=>x.id===job.client_id);
    out.push({clientId:job.client_id,jobId:job.id,name:(c&&c.name)||job.client_name||'',addr:job.addr||(c&&c.addr)||'',what:job.name||'Job'});
  });
  const d=new Date(rows[0].uploadedAt);
  const top=out.slice(0,4);
  top.label='On the schedule '+d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
  return top;
}
function _pcAttAway(c){
  if(!_pcAtt||!c)return false;
  const rows=(_pcAtt.ids||[]).map(id=>photos.find(x=>String(x.id)===String(id))).filter(Boolean);
  const fix=rows.map(r=>({lat:r.lat,lon:r.lon})).find(f=>f.lat!=null&&f.lon!=null);
  if(!fix)return false;
  const places=_pcClientPlaces(c);
  if(places.length)return !places.some(pl=>_pcMeters(fix.lat,fix.lon,pl.lat,pl.lon)<=_PC_NEAR_M);
  if(!_pcAtt.guess||typeof siteNoteKey!=='function')return false;
  const here=siteNoteKey(_pcAtt.guess);
  const theirs=(typeof clientAddresses==='function')?clientAddresses(c):[{addr:c.addr}];
  return !theirs.some(a=>a&&a.addr&&siteNoteKey(a.addr)===here);
}
// Who the county says owns the house the photos were taken at. Asked once,
// after the street is known, through the one door to the county
// (_countyProperty, js/data.js). A null is "could not ask" and changes nothing.
function _pcAttOwner(att){
  if(!att||!att.guess||att.owner!==undefined||typeof _countyProperty!=='function')return;
  att.owner='';
  Promise.resolve().then(()=>_countyProperty(att.guess)).then(d=>{
    att.owner=(d&&d.found!==false&&d.owner_name)?String(d.owner_name):'';
    if(!att.owner||_pcAtt!==att)return;
    const hint=document.getElementById('pc-new-owner');
    if(hint){hint.textContent='County owner: '+att.owner;hint.hidden=false;}
    // Repaint the list only while nobody is typing in it.
    const q=document.getElementById('pc-att-q');
    if(att.step==='who'&&(!q||!q.value.trim())&&_pcOwnerMatches().length)_pcAttPaint('who');
  }).catch(()=>{});
}
// Owner names as the county writes them ("SAMPLE, LOGAN & BLAKE REVOCABLE
// LIVING TRUST") reduced to the words that name people or a business.
const _PC_OWNER_NOISE=new Set(['llc','inc','co','corp','ltd','lp','llp','trust','trustee','trustees','revocable',
  'irrevocable','living','family','the','and','of','estate','et','al','ux','etux','jr','sr','ii','iii','properties','property','holdings','rentals']);
function _pcNameWords(s){
  return String(s||'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/)
    .filter(w=>w.length>1&&!_PC_OWNER_NOISE.has(w));
}
// Customers the county owner points at, strongest first:
//  1. the same owner is already on one of their properties (the landlord's
//     LLC owns this house too), and
//  2. the owner's name IS theirs: first and last name both present, or the
//     whole name of a one-word business ("ALDI INC" and "Aldi").
// A shared surname alone is not a match; Topeka has a lot of Millers.
function _pcOwnerMatches(){
  const owner=_pcAtt&&_pcAtt.owner;
  if(!owner)return [];
  const ow=_pcNameWords(owner);if(!ow.length)return [];
  const oset=new Set(ow),okey=ow.slice().sort().join(' ');
  const out=[];
  clients.forEach(c=>{
    if(!c)return;
    const props=(typeof clientAddresses==='function')?clientAddresses(c):[{addr:c.addr}];
    const same=props.find(a=>{
      const pd=(typeof getProperty==='function'&&a&&a.addr)?getProperty(c,a.addr):null;
      return pd&&pd.ownerName&&_pcNameWords(pd.ownerName).sort().join(' ')===okey;
    });
    if(same){out.push({c,rank:0,why:'Also owns '+String(same.addr||'').split(',')[0]});return;}
    const cw=_pcNameWords(c.name);
    if(!cw.length)return;
    const hit=cw.length===1?oset.has(cw[0]):(oset.has(cw[0])&&oset.has(cw[cw.length-1]));
    if(hit)out.push({c,rank:1,why:'County owner: '+owner});
  });
  return out.sort((a,b)=>a.rank-b.rank).slice(0,3);
}
// "Already a customer?" under the name as he types it, so "Dana" finds Dana
// Whitfield before a second Dana is made. Same predicate as the Clients
// search and the proposal gate (_newcGateMatches), so it means one thing.
function _pcNewDupes(){
  const box=document.getElementById('pc-new-dupes');if(!box)return;
  const name=(document.getElementById('pc-new-name')?.value||'').trim();
  const hits=(name.length>=2&&typeof _newcGateMatches==='function')?_newcGateMatches(name).slice(0,3):[];
  box.innerHTML=hits.length?'<div class="pc-att-lbl">Already a customer?</div><div class="pc-att-group pc-file-list">'+
    hits.map(c=>'<button type="button" class="pc-file-opt pc-att-dupe" onclick="tdAttachPick('+c.id+')">'+
      '<span class="pc-av">'+escHtml(_pcInitials(c.name))+'</span>'+
      '<span class="pc-opt-m"><b>'+escHtml(c.name||'Unnamed')+'</b><span>'+escHtml(String(c.addr||'No address').split(',')[0])+'</span></span>'+
      _pcIcon('chev','pc-chev')+'</button>').join('')+'</div>':'';
}
function tdAttachNew(){
  if(!_pcAtt)return false;
  const q=document.getElementById('pc-att-q');
  const term=q?q.value.trim():'';
  // A typed search that matched nobody is the name he was looking for.
  _pcAttPaint('new',term);
  return true;
}
function tdAttachNewSave(){
  if(!_pcAtt)return false;
  const name=(document.getElementById('pc-new-name')?.value||'').trim();
  const addr=(document.getElementById('pc-new-addr')?.value||'').trim();
  if(!name){
    const e=document.getElementById('pc-new-err');if(e)e.hidden=false;
    document.getElementById('pc-new-name')?.focus();
    return false;
  }
  if(typeof _clientQuickCreate!=='function')return false;
  const c=_clientQuickCreate(name,addr);
  _pcAtt.clientId=c.id;_pcAtt.addr=addr;_pcAtt.bidId=null;_pcAtt.jobId=null;
  // A brand-new customer has no proposal or job to ask about.
  return tdAttachCommit();
}
function _pcInitials(name){
  const w=String(name||'').trim().split(/\s+/).filter(Boolean);
  return ((w[0]||'?').charAt(0)+(w.length>1?w[w.length-1].charAt(0):'')).toUpperCase();
}
function _pcAttPaint(step,q){
  if(!_pcAtt)return;
  const ov=_pcAttSheet();
  const n=_pcAtt.ids.length;
  const head=t=>'<div class="pc-grab"></div><div class="pc-att-hd"><span class="pc-att-t">'+t+'</span>'+
    '<button type="button" class="pc-att-x" aria-label="Cancel" onclick="tdAttachCancel()">'+_pcIcon('x')+'</button></div>';
  const row=(fn,av,name,sub,right,cls)=>'<button type="button" class="pc-file-opt'+(cls?' '+cls:'')+'" onclick="'+fn+'">'+
    '<span class="pc-av'+(cls==='near'?' pin':'')+'">'+av+'</span>'+
    '<span class="pc-opt-m"><b>'+name+'</b><span>'+sub+'</span></span>'+
    (right?'<em>'+right+'</em>':'')+_pcIcon('chev','pc-chev')+'</button>';
  _pcAtt.step=step;
  if(step==='who'){
    const near=_pcNearbyMatches(_pcAtt.ids);
    const nearIds=new Set(near.map(m=>m.clientId));
    const owners=_pcOwnerMatches().filter(m=>!nearIds.has(m.c.id));
    const dayJobs=near.length?[]:_pcDayMatches(_pcAtt.ids);
    const term=String(q||'').trim().toLowerCase();
    const list=clients.filter(c=>!term||String(c.name||'').toLowerCase().includes(term)||String(c.addr||'').toLowerCase().includes(term))
      .sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''))).slice(0,50);
    const props=c=>(typeof clientAddresses==='function')?clientAddresses(c).length:1;
    ov.innerHTML='<div class="zmodal pc-att-sheet">'+
      head('Whose '+(n===1?'photo':n+' photos')+'?')+
      '<label class="pc-att-search">'+_pcIcon('search')+
        '<input class="pc-att-q" id="pc-att-q" placeholder="Customer or address" autocomplete="off" oninput="_pcAttPaint(\'who\',this.value)" value="'+escHtml(q||'')+'"></label>'+
      (near.length&&!term?'<div class="pc-att-lbl">Near you</div><div class="pc-att-group pc-att-near">'+
        near.map(m=>row('tdAttachPick('+m.clientId+','+(m.jobId!=null?m.jobId:'null')+','+JSON.stringify(m.addr||'').replace(/"/g,'&quot;')+')',
          _pcIcon('pin'),escHtml(m.name||'Unnamed'),escHtml(String(m.addr||'').split(',')[0])+(m.what?' · '+escHtml(m.what):''),
          _pcFeet(m.d)+' ft away','near')).join('')+
        '</div>':'')+
      // The county says who owns the house he is standing at. When that owner
      // is someone already in the book (by name, or because the same owner is
      // on another of their properties: a landlord's LLC), say so first.
      // Imported photos iOS stripped the location from still carry the day
      // they were taken, and the schedule says whose job that was.
      (dayJobs.length&&!term?'<div class="pc-att-lbl">'+escHtml(dayJobs.label)+'</div><div class="pc-att-group pc-att-day">'+
        dayJobs.map(m=>row('tdAttachPick('+m.clientId+','+m.jobId+')',escHtml(_pcInitials(m.name)),escHtml(m.name||'Unnamed'),
          escHtml(m.what)+(m.addr?' \u00b7 '+escHtml(String(m.addr).split(',')[0]):''),'','day')).join('')+
        '</div>':'')+
      (owners.length&&!term?'<div class="pc-att-lbl">Owns this house</div><div class="pc-att-group pc-att-owner">'+
        owners.map(m=>row('tdAttachPick('+m.c.id+')',escHtml(_pcInitials(m.c.name)),escHtml(m.c.name||'Unnamed'),
          escHtml(m.why),'','owner')).join('')+
        '</div>':'')+
      '<div class="pc-att-lbl">'+(term?'Results':'All customers')+'</div>'+
      '<div class="pc-att-group pc-file-list">'+
        _pcAttNewRow(q)+
        (list.length?list.map(c=>{const k=props(c);
          return row('tdAttachPick('+c.id+')',escHtml(_pcInitials(c.name)),escHtml(c.name||'Unnamed'),
            k>1?k+' addresses':escHtml(String(c.addr||'').split(',')[0]),'');}).join('')
          :'<div class="pc-att-none">No customers match.</div>')+
      '</div></div>';
    const box=document.getElementById('pc-att-q');
    if(q!=null&&box){box.focus();box.setSelectionRange(box.value.length,box.value.length);}
    _pcAttGuess();
    return;
  }
  if(step==='new'){
    // Nobody in the book is standing at this house yet. Name and address,
    // nothing else: the same two things the proposal gate asks for, and the
    // same record comes out of it (_clientQuickCreate). The address is filled
    // in from where the photos were taken, because he is standing there.
    ov.innerHTML='<div class="zmodal pc-att-sheet">'+
      head('New customer')+
      '<div class="pc-att-group pc-att-form">'+
        '<label class="pc-att-f"><span>Name</span><input id="pc-new-name" autocomplete="off" autocapitalize="words" placeholder="Required" value="'+escHtml(q||'')+'"></label>'+
        '<label class="pc-att-f"><span>Address</span><input id="pc-new-addr" autocomplete="off" placeholder="'+(_pcAtt.guess===undefined?'Finding where you are':'Street, city')+'" value="'+escHtml(_pcAtt.guess||'')+'"></label>'+
      '</div>'+
      '<div class="pc-att-err" id="pc-new-err" hidden>Add a name so the photos have a folder.</div>'+
      '<div id="pc-new-owner" class="pc-att-hint"'+(_pcAtt.owner?'':' hidden')+'>'+(_pcAtt.owner?'County owner: '+escHtml(_pcAtt.owner):'')+'</div>'+
      '<div id="pc-new-dupes"></div>'+
      '<button type="button" class="pc-att-go" id="pc-new-go" onclick="tdAttachNewSave()">Create and file '+(n===1?'photo':n+' photos')+'</button>'+
      '<button type="button" class="pc-att-back" onclick="_pcAttPaint(\'who\')">Back to customers</button>'+
    '</div>';
    const addrEl=document.getElementById('pc-new-addr');
    if(addrEl&&typeof _addrAutoFull==='function')_addrAutoFull(addrEl,null);
    const nameEl=document.getElementById('pc-new-name');
    if(nameEl){
      nameEl.addEventListener('input',_pcNewDupes);
      nameEl.focus();nameEl.setSelectionRange(nameEl.value.length,nameEl.value.length);
    }
    _pcNewDupes();
    _pcAttGuess();
    return;
  }
  if(step==='where'){
    // The app already owns this component, and it can add an address inline,
    // which is the "edit the address" half of what Jack asked for (§7.3).
    ov.remove();
    pickClientAddress(_pcAtt.clientId,addr=>{tdAttachAddr(addr);},{suggest:_pcAtt.away?(_pcAtt.guess||''):'',dark:true});
    return;
  }
  // 'work': the proposal or job on that customer, only ever asked when there
  // is more than one thing it could be.
  const c=clients.find(x=>x.id===_pcAtt.clientId);
  const work=_pcAttWork();
  ov.innerHTML='<div class="zmodal pc-att-sheet">'+
    head('Attach to what?')+
    '<div class="pc-att-lbl">On '+escHtml((c&&c.name)||'this customer')+'</div>'+
    '<div class="pc-att-group pc-file-list">'+
      work.map(w=>row('tdAttachWork(\''+w.kind+'\','+w.id+')',_pcIcon(w.kind==='job'?'folder':'tag'),escHtml(w.label),escHtml(w.sub),'')).join('')+
      row('tdAttachWork(\'none\',0)',escHtml(_pcInitials(c&&c.name)),'Just the customer','No proposal or job','')+
    '</div></div>';
}
// The open work on this customer at this address: proposals first, because a
// photo taken before the job exists is the walkthrough for the estimate.
function _pcAttWork(){
  if(!_pcAtt)return [];
  const cid=_pcAtt.clientId,addr=_pcAtt.addr;
  const same=(a)=>!addr||!a||String(a).trim().toLowerCase()===String(addr).trim().toLowerCase();
  const out=[];
  bids.filter(b=>b.client_id===cid&&b.status!=='lost'&&same(b.addr)).slice(0,8)
    .forEach(b=>out.push({kind:'bid',id:b.id,label:b.title||b.name||'Proposal',sub:'Proposal'+(b.status?' · '+b.status:'')}));
  jobs.filter(j=>j.client_id===cid&&j.status!=='cancelled'&&same(j.addr)).slice(0,8)
    .forEach(j=>out.push({kind:'job',id:j.id,label:j.name||'Job',sub:'Job'+(j.status?' · '+j.status:'')}));
  return out;
}
function tdAttachPick(clientId,jobId,addr){
  if(!_pcAtt)return false;
  _pcAtt.clientId=clientId;
  const c=clients.find(x=>x.id===clientId);
  if(jobId!=null){
    const j=jobs.find(x=>x.id===jobId);
    _pcAtt.jobId=jobId;_pcAtt.addr=(j&&j.addr)||addr||(c&&c.addr)||'';
    return tdAttachCommit();
  }
  // A "Shot here" row already names the property the fix landed on, so
  // asking which house next would be asking a question we just answered.
  if(addr){
    _pcAtt.addr=addr;
    return _pcAttAfterAddr();
  }
  const props=(typeof clientAddresses==='function')?clientAddresses(c):[];
  // Shot somewhere this customer has no saved house: asking which property,
  // with "Add <where you are>" on offer, beats quietly filing the photos to
  // the one address on file (owner 2026-09-23). Only when the pins can prove
  // it; a customer whose houses were never located keeps the old shortcut.
  _pcAtt.away=_pcAttAway(c);
  if(props.length>1||_pcAtt.away)return _pcAttPaint('where'),true;
  _pcAtt.addr=props.length?props[0].addr:((c&&c.addr)||'');
  return _pcAttAfterAddr();
}
function tdAttachAddr(addr){
  if(!_pcAtt)return false;
  _pcAtt.addr=addr||'';
  return _pcAttAfterAddr();
}
function _pcAttAfterAddr(){
  const work=_pcAttWork();
  if(work.length===1){
    // One open proposal or job at this address is the answer, not a question.
    if(work[0].kind==='bid')_pcAtt.bidId=work[0].id;else _pcAtt.jobId=work[0].id;
    return tdAttachCommit();
  }
  if(!work.length)return tdAttachCommit();
  _pcAttPaint('work');
  return true;
}
function tdAttachWork(kind,id){
  if(!_pcAtt)return false;
  if(kind==='bid')_pcAtt.bidId=id;
  else if(kind==='job')_pcAtt.jobId=id;
  return tdAttachCommit();
}
function tdAttachCommit(){
  if(!_pcAtt)return false;
  const{ids,clientId,addr,bidId,jobId}=_pcAtt;
  let n=0;
  ids.forEach(id=>{
    if(!tdFilePhoto(id,clientId,bidId,jobId))return;
    const p=photos.find(x=>String(x.id)===String(id));
    // The property, kept on the row: a customer with three houses needs to
    // know WHICH one this was, and a job or proposal is not always there to
    // say it.
    if(p&&addr)p.addr=addr;
    if(p&&_pcAtt.m!=null)p.addrM=_pcAtt.m;
    n++;
  });
  saveAll();
  const c=clients.find(x=>x.id===clientId);
  tdAttachCancel();
  tdReviewClose();
  if(typeof showToast==='function'){
    const where=[(c&&c.name)||'the customer',(addr||'').split(',')[0]].filter(Boolean).join(' · ');
    showToast(n+(n===1?' photo':' photos')+' filed to '+where,'\u2705');
  }
  if(typeof renderDash==='function')try{renderDash();}catch(_e){}
  return n;
}
function tdReviewClose(){
  const trash=_pcRev?_pcRev.trash.slice():[];
  _pcRev=null;_pcFolder=null;
  tdPhotoInfoClose();
  clearTimeout(_pcSharpTimer);
  // The sheet is gone, so the arrow keys belong to whatever is underneath it
  // again. _pcRevKey guards on _pcRev too, so this is belt and braces.
  document.removeEventListener('keydown',_pcRevKey);
  document.getElementById('pc-rev')?.remove();
  // Only now, once the contractor has walked away from the sheet, do the
  // deleted shots actually leave storage. Undo is free until this point.
  if(trash.length&&typeof supaEnabled==='function'&&supaEnabled()&&_supa){
    const paths=trash.map(p=>p.storagePath).filter(Boolean)
      .concat(trash.map(p=>p.thumbPath).filter(Boolean))
      .concat(trash.map(p=>p.fullPath).filter(Boolean))
      .concat(trash.map(p=>p.originalFullPath).filter(Boolean));
    if(paths.length)_supa.storage.from('gallery').remove(paths).catch(()=>{});
  }
  if(typeof renderDash==='function')try{renderDash();}catch(_e){}
  return true;
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
// ── The camera, laid out like the iPhone's own (owner 2026-09-23: "want this
// to look fresh out of Apple") ─────────────────────────────────────────────
// The frame is 3:4 with black above and below, because the photo IS 3:4
// (3024x4032) and a full-bleed cover crop showed a picture wider than the one
// it saved. The stage is three words, the way Photo and Video are, not three
// filled buttons. Everything that is not the shutter floats on glass.
function _pcSheetHTML(){
  const t=_pcCtx?_pcCtx.type:'before';
  const seg=(v,label)=>'<button type="button" class="pc-seg-btn'+(t===v?' on':'')+'" onclick="tdCaptureSetType(\''+v+'\')">'+label+'</button>';
  return ''+
  '<div class="pc-cam-top">'+
    '<button type="button" class="pc-stamp-toggle pc-glass" id="pc-stamp-toggle" onclick="tdTogglePhotoStamp()">'+
      '<span class="dot"></span><span id="pc-stamp-label">Stamp on</span></button>'+
    '<div class="pc-cam-top-r">'+
      '<button type="button" class="pc-ghost-btn pc-glass" id="pc-ghost-btn" onclick="tdCaptureToggleGhost()">Ghost on</button>'+
      '<button type="button" class="pc-import-btn pc-glass" id="pc-import-btn" onclick="tdImportPhotos()">'+_pcIcon('photos')+'<span>Import</span></button>'+
    '</div>'+
  '</div>'+
  '<div class="pc-vf" id="pc-vf">'+
    '<video id="pc-video" playsinline autoplay muted></video>'+
    '<div class="pc-ghost" id="pc-ghost"></div>'+
    '<div class="pc-ghostframe" id="pc-ghostframe"></div>'+
    '<div class="pc-grid"></div>'+
    '<div class="pc-attach pc-glass"><span class="pc-dot" id="pc-subject-dot"></span>'+
      '<span class="pc-attach-t" id="pc-subject">'+escHtml(_pcSubjectLabel())+'</span>'+
      '<span class="pc-attach-near" id="pc-near"></span>'+
    '</div>'+
    '<div class="pc-hint" id="pc-hint"></div>'+
  '</div>'+
  '<div class="pc-seg">'+
    seg('before','Before')+seg('progress','Progress')+seg('after','After')+
  '</div>'+
  '<div class="pc-shutrow">'+
    '<button type="button" class="pc-last" id="pc-strip" aria-label="Mark up the last shot"></button>'+
    '<button type="button" class="pc-shut" id="pc-shut" aria-label="Take photo" onclick="tdCaptureShoot()"><i></i></button>'+
    '<button type="button" class="pc-done" aria-label="Done" onclick="tdCloseCapture()">'+
      _pcIcon('check')+'<span class="pc-sr">Done</span></button>'+
  '</div>'+
  '<input type="file" id="pc-fallback-file" accept="image/*" capture="environment" style="display:none" onchange="tdCaptureFromPicker(this)">';
}
// SF Symbols-weight line icons, drawn once here so every TrueShot surface
// uses the same six glyphs at the same stroke.
const _PC_ICONS={
  check:'<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  back:'<path d="M14.5 5.5L8 12l6.5 6.5"/>',
  more:'<circle cx="6" cy="12" r="1.5" class="f"/><circle cx="12" cy="12" r="1.5" class="f"/><circle cx="18" cy="12" r="1.5" class="f"/>',
  share:'<path d="M12 15V3.5M8 7l4-4 4 4M6.5 10.5H6a2 2 0 00-2 2V19a2 2 0 002 2h12a2 2 0 002-2v-6.5a2 2 0 00-2-2h-.5"/>',
  pen:'<path d="M4.5 19.5l3.8-.9L19 7.9a1.9 1.9 0 000-2.7l-.2-.2a1.9 1.9 0 00-2.7 0L5.4 15.7z"/>',
  info:'<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r=".7" class="f"/>',
  trash:'<path d="M4.5 6.5h15M9.5 6.5V4.8c0-.7.6-1.3 1.3-1.3h2.4c.7 0 1.3.6 1.3 1.3v1.7M6.5 6.5l.9 12.6c.1 1 .9 1.9 2 1.9h5.2c1.1 0 1.9-.9 2-1.9l.9-12.6"/>',
  folder:'<path d="M3.5 7.5a2 2 0 012-2h3.8l2 2h7.2a2 2 0 012 2v8a2 2 0 01-2 2h-13a2 2 0 01-2-2z"/>',
  tag:'<path d="M3.5 12.3V5.5a2 2 0 012-2h6.8l8.2 8.2a2 2 0 010 2.8l-6 6a2 2 0 01-2.8 0z"/><circle cx="8" cy="8" r="1.3"/>',
  pin:'<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0113 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  shield:'<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/>',
  x:'<path d="M7 7l10 10M17 7L7 17"/>',
  search:'<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  camera:'<path d="M4.5 8.5a2 2 0 012-2h1.8l1.4-2h4.6l1.4 2h1.8a2 2 0 012 2v9a2 2 0 01-2 2h-11a2 2 0 01-2-2z"/><circle cx="12" cy="13" r="3.3"/>',
  photos:'<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M20.5 15.5l-5-4.5-7.5 7.5"/>',
  globe:'<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.5 3.5 5.5 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.5-3.5-8.5s1-6 3.5-8.5z"/>',
  chev:'<path d="M9 5l7 7-7 7"/>'
};
function _pcIcon(name,cls){
  return '<svg class="pc-ic'+(cls?' '+cls:'')+'" viewBox="0 0 24 24" aria-hidden="true">'+(_PC_ICONS[name]||'')+'</svg>';
}
async function _pcStartStream(){
  _pcGpsStart();
  try{
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)throw new Error('no getUserMedia');
    // ── ASK THE CAMERA FOR THE CAMERA (owner 2026-09-22: "photos look a bit
    // blurry") ───────────────────────────────────────────────────────────────
    // This used to request a rear camera and nothing else, and an unconstrained
    // getUserMedia hands back the browser's DEFAULT capture size, which is
    // 640x480 or 720p. So a phone with a 48MP sensor was saving a video still:
    // Jack's four shots came out 42 to 70 kB each. It also silently killed the
    // 4K copy, because _compressPhoto only writes one when the source is bigger
    // than its 1600px display edge, and 720p never is. Every photo in the
    // account has an empty fullPath for exactly this reason.
    //
    // ideal, not exact: a constraint the camera cannot meet fails the whole
    // getUserMedia call and drops the viewfinder to the file-picker fallback,
    // which would trade a blurry photo for no live Before-ghost at all.
    const _hi={facingMode:{ideal:'environment'},width:{ideal:4096},height:{ideal:3072}};
    try{
      _pcStream=await navigator.mediaDevices.getUserMedia({video:_hi,audio:false});
    }catch(_e){
      _pcStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
    }
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
  _pcGpsStop();
}
// ── WARM THE FIX WHILE THE CAMERA IS OPEN (2026-09-23) ──────────────────────
// The GPS used to be requested AFTER the shot had already uploaded: _pcCommit
// saved the photo, then _pcStampGeo asked for a position. Unless the phone
// happened to hold a warm fix at the instant of the tap, the file went up with
// no coordinates, the position landed on the database row a second later, and
// the burned-in stamp had no address line either. Verified on the owner's own
// photos: 3024x4032, coordinates on the row, a 68 byte stub in the file.
//
// So the fix is watched from the moment the viewfinder opens, which is also
// how long a camera takes to be ready, and every shot takes whatever is
// freshest. It still never WAITS on GPS: a photo must not be slower to take
// because the phone is arguing with a satellite.
let _pcFix=null,_pcGpsWatch=null;
function _pcGpsStart(){
  try{
    if(_pcGpsWatch!=null||!navigator.geolocation)return;
    _pcGpsWatch=navigator.geolocation.watchPosition(pos=>{
      _pcFix={lat:pos.coords.latitude,lon:pos.coords.longitude,
        acc:typeof pos.coords.accuracy==='number'?Math.round(pos.coords.accuracy):null,t:Date.now()};
      _pcPaintNear();
    },()=>{},{enableHighAccuracy:true,maximumAge:15000,timeout:20000});
  }catch(_e){}
}
function _pcGpsStop(){
  try{ if(_pcGpsWatch!=null&&navigator.geolocation)navigator.geolocation.clearWatch(_pcGpsWatch); }catch(_e){}
  _pcGpsWatch=null;
}
function tdCaptureSetType(t){
  if(!_pcCtx)return;
  _pcCtx.type=t;
  document.querySelectorAll('#pc-sheet .pc-seg-btn').forEach((b,i)=>{
    const v=['before','progress','after'][i];
    b.className='pc-seg-btn'+(v===t?' on':'');
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
  _pcPaintNear();
  const st=document.getElementById('pc-stamp-toggle'),stl=document.getElementById('pc-stamp-label');
  if(st&&stl){const on=_pcStampOn();st.className='pc-stamp-toggle pc-glass'+(on?'':' off');stl.textContent=on?'Stamp on':'Stamp off';}
  _pcPaintStrip();
}
// The last shot, the way the Camera app shows it: one thumbnail, with how
// many this subject has. Tapping it marks that shot up, which is what the old
// row of four thumbnails did per shot.
function _pcPaintStrip(){
  const strip=document.getElementById('pc-strip');
  if(!strip||!_pcCtx)return;
  const mine=photos.filter(p=>p&&(
    (_pcCtx.jobId!=null&&p.job_id===_pcCtx.jobId)||
    (_pcCtx.jobId==null&&_pcCtx.bidId!=null&&p.bid_id===_pcCtx.bidId)||
    (_pcCtx.jobId==null&&_pcCtx.bidId==null&&_pcCtx.clientId!=null&&p.client_id===_pcCtx.clientId)||
    _pcSessionIds.some(id=>String(id)===String(p.id))));
  const last=mine[mine.length-1];
  strip.className='pc-last'+(last?'':' empty')+(last&&last.annotated?' marked':'');
  strip.style.backgroundImage=last?'url(\''+_pcEscUrl(last.thumbUrl||last.url||last.data||'')+'\')':'';
  strip.innerHTML=mine.length?'<span class="pc-last-n">'+mine.length+'</span>':'';
  strip.onclick=last?()=>tdAnnotatePhoto(last.id):null;
}
// Where the phone is standing, live, before a single shot is taken: the
// nearest saved property to the warm fix, named beside whoever the shoot is
// for. Green once either one is known, grey while it is still nobody.
function _pcPaintNear(){
  const el=document.getElementById('pc-near'),dot=document.getElementById('pc-subject-dot');
  if(!el||!_pcCtx)return;
  const hit=_pcFix?tdGuessPlaceFor({lat:_pcFix.lat,lon:_pcFix.lon}):null;
  const tagged=_pcCtx.clientId!=null||_pcCtx.jobId!=null||_pcCtx.bidId!=null;
  const street=hit?String(hit.addr||'').split(',')[0]:'';
  const sub=document.getElementById('pc-subject');
  // Nobody attached yet but standing at a saved house: the house leads and
  // its owner follows, so "No customer yet" never sits beside the answer.
  if(!tagged&&hit&&sub){sub.textContent=street||hit.client.name||'';el.textContent=street?(hit.client.name||''):'';}
  else{if(sub)sub.textContent=_pcSubjectLabel();el.textContent=street;}
  if(dot)dot.className='pc-dot'+(hit||tagged?'':' idle');
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
  // THE SHUTTER IS HERE. drawImage is the instant the frame is captured, so
  // that is when the flash fires. It used to fire after the JPEG encode below,
  // which on a full 12MP frame is most of a second on a phone, so every shot
  // felt like the button had been ignored (owner 2026-09-23: "why does it take
  // a second for the photo shutter to hit"). The encode still happens, it just
  // happens after the person already knows the picture was taken.
  _pcFlash();
  // 0.98 because this blob is an INTERMEDIATE: _compressPhoto re-encodes it
  // into the display copy and the full copy, and every generation of JPEG
  // before the last one is quality thrown away for nothing.
  const blob=await new Promise(r=>cv.toBlob(r,'image/jpeg',0.98));
  if(!blob)return;
  blob.name='shot-'+Date.now()+'.jpg';
  // What the camera actually gave, kept on the row. The owner cannot see a
  // resolution and neither can a log, so when a photo looks soft this is the
  // first question and it should already be answered.
  _pcShotPx=cv.width+'x'+cv.height;
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
    clientId:_pcCtx.clientId,bidId:_pcCtx.bidId,jobId:_pcCtx.jobId,addr:_pcCtx.addr||undefined,
    lat:fix.lat,lon:fix.lon,accM:fix.acc
  });
  if(!row)return;
  // Where it was shot, kept on the row so the unfiled tray can guess the
  // customer later. Best effort: a denied location never blocks a photo.
  _pcStampGeo(row);
  _pcShots++;
  _pcSessionIds.push(row.id);
  _pcPaint();
  if(typeof _pcAfterSave==='function')_pcAfterSave(row);
}
// The fix we already hold, if any. Never waits on one: a photo must not be
// slower to take because the phone is arguing with GPS.
function _pcCurrentFix(){
  try{
    // The camera's own watch is the freshest thing there is, so it wins; a
    // fix older than two minutes is a different place for a man in a truck.
    if(_pcFix&&_pcFix.lat!=null&&Date.now()-_pcFix.t<120000)
      return{lat:_pcFix.lat,lon:_pcFix.lon,acc:_pcFix.acc};
    if(typeof _lastGeoFix==='object'&&_lastGeoFix&&_lastGeoFix.lat!=null)
      return{lat:_lastGeoFix.lat,lon:_lastGeoFix.lon,acc:_lastGeoFix.acc!=null?_lastGeoFix.acc:null};
  }catch(_e){}
  return{lat:null,lon:null,acc:null};
}
function _pcStampGeo(row){
  try{
    if(typeof _lastGeoFix==='object'&&_lastGeoFix&&_lastGeoFix.lat!=null){
      row.lat=_lastGeoFix.lat;row.lon=_lastGeoFix.lon;
      if(_lastGeoFix.acc!=null)row.accM=_lastGeoFix.acc;
      return;
    }
    if(!navigator.geolocation)return;
    navigator.geolocation.getCurrentPosition(pos=>{
      row.lat=pos.coords.latitude;row.lon=pos.coords.longitude;
      // How good the fix WAS, kept because the EXIF has a field for exactly
      // this and a coordinate with no stated accuracy overclaims. It is also
      // the honest answer when a stamp names a house 40m away.
      if(typeof pos.coords.accuracy==='number')row.accM=Math.round(pos.coords.accuracy);
      saveAll();
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
function tdCaptureForClient(clientId,type,addr){
  tdOpenCapture({clientId,type:type||'before',addr});
}
// "Add photos" on a property card (owner 2026-09-23): one button, the two
// ways a photo gets there. Standing at the house, the camera; back at the
// truck or the office, the library, which files straight to this house with
// no camera and no shoot to finish. TrueShot's own dark sheet, because both
// answers open TrueShot screens.
function tdAddPhotos(clientId,addr){
  document.getElementById('pc-add')?.remove();
  const c=clients.find(x=>x.id===clientId);
  if(!c)return false;
  const at=String(addr||c.addr||'').split(',')[0];
  const ov=document.createElement('div');
  ov.id='pc-add';ov.className='zmodal-overlay pc-att-ov';
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  const a=JSON.stringify(String(addr||'')).replace(/"/g,'&quot;');
  const opt=(fn,icon,name,sub)=>'<button type="button" class="pc-file-opt" onclick="document.getElementById(\'pc-add\')?.remove();'+fn+'">'+
    '<span class="pc-av add">'+_pcIcon(icon)+'</span><span class="pc-opt-m"><b>'+name+'</b><span>'+sub+'</span></span>'+
    _pcIcon('chev','pc-chev')+'</button>';
  ov.innerHTML='<div class="zmodal pc-att-sheet">'+
    '<div class="pc-grab"></div><div class="pc-att-hd"><span class="pc-att-t">Add photos</span>'+
    '<button type="button" class="pc-att-x" aria-label="Cancel" onclick="document.getElementById(\'pc-add\')?.remove()">'+_pcIcon('x')+'</button></div>'+
    '<div class="pc-att-group">'+
      opt('tdCaptureForClient('+clientId+',\'before\','+a+')','camera','Take photo','Open the camera'+(at?' at '+escHtml(at):''))+
      opt('tdImportPhotos('+clientId+','+a+')','photos','Choose from library','Files straight to '+(at?escHtml(at):'this customer'))+
    '</div></div>';
  document.body.appendChild(ov);
  return true;
}
// ── Import from the iPhone library (owner 2026-09-23, from the field) ─────
// Photos already on the phone, taken before the app was open or by someone
// else and AirDropped over. A plain <input type=file multiple> with no
// capture attribute: on iOS that is the system photo picker, so there is no
// native code and no iOS build (3.2).
//
// Two doors, one path:
//  - from a property card, the customer and the house are known, so the
//    photos land there and the album opens on them;
//  - from the camera, they join the shoot like any other shot and go through
//    the same Done, confirm and picker as everything else.
//
// Each photo keeps what its own file says: when it was taken, and where if
// iOS left the location in. Never the phone's position now, and never a
// stamp: burning today's date into a photo from last Tuesday would be a
// false record, which is the one thing a stamp exists to prevent.
function tdImportPhotos(clientId,addr){
  let inp=document.getElementById('pc-import-file');
  if(!inp){
    inp=document.createElement('input');
    inp.type='file';inp.id='pc-import-file';inp.accept='image/*';inp.multiple=true;
    inp.style.display='none';
    document.body.appendChild(inp);
  }
  const ctx=(clientId!=null)?{clientId,addr:addr||''}:null;
  inp.onchange=()=>{
    const files=[...(inp.files||[])];
    inp.value='';
    if(files.length)_pcImportFiles(files,ctx);
  };
  inp.click();
  return true;
}
async function _pcImportFiles(files,ctx){
  const fromCam=!ctx&&!!_pcCtx;
  const base=fromCam?_pcCtx:(ctx||{});
  const type=(fromCam&&_pcCtx.type)||'before';
  const ids=[];
  for(const file of (files||[])){
    if(!file)continue;
    let ex=null;
    try{ex=await _pcReadExif(file);}catch(_e){ex=null;}
    const when=(ex&&ex.when)||(file.lastModified?new Date(file.lastModified).toISOString():null);
    const row=await tdSavePhoto({file,type,stamp:false,imported:true,when,
      clientId:base.clientId!=null?base.clientId:null,
      bidId:base.bidId!=null?base.bidId:null,jobId:base.jobId!=null?base.jobId:null,
      addr:base.addr||undefined,
      lat:ex&&ex.lat!=null?ex.lat:null,lon:ex&&ex.lon!=null?ex.lon:null});
    if(!row)continue;
    ids.push(row.id);
    if(fromCam){_pcSessionIds.push(row.id);_pcShots++;}
  }
  if(!ids.length)return ids;
  if(fromCam){try{_pcPaint();}catch(_e){}return ids;}
  if(typeof showToast==='function')
    showToast(ids.length+(ids.length===1?' photo':' photos')+' imported','\u2705');
  if(typeof renderCDAddresses==='function')try{renderCDAddresses();}catch(_e){}
  // Filed to a house: open that house's album so he sees where they went.
  // Unfiled: the same review and picker a shoot ends with.
  if(ctx&&ctx.clientId!=null&&typeof tdOpenPropertyFolder==='function')tdOpenPropertyFolder(ctx.clientId,ctx.addr);
  else if(typeof tdReviewShots==='function')tdReviewShots(ids);
  return ids;
}
// When and where a JPEG says it was taken, from its own EXIF. Reads the
// first 256KB only (the metadata lives at the front). Returns null for
// anything it cannot read, including HEIC, which iOS normally converts to
// JPEG for a web picker anyway. Never throws.
async function _pcReadExif(file){
  try{
    if(!file||typeof file.slice!=='function')return null;
    const buf=await file.slice(0,262144).arrayBuffer();
    return _pcParseExif(new DataView(buf));
  }catch(_e){return null;}
}
function _pcParseExif(dv){
  try{
    if(!dv||dv.byteLength<4||dv.getUint16(0)!==0xFFD8)return null;
    let o=2;
    while(o+4<=dv.byteLength){
      if(dv.getUint8(o)!==0xFF)return null;
      const mk=dv.getUint8(o+1),len=dv.getUint16(o+2);
      if(mk===0xE1&&o+10<=dv.byteLength&&dv.getUint32(o+4)===0x45786966)return _pcParseTiff(dv,o+10);
      if(mk===0xDA)return null;   // image data: no EXIF before it
      o+=2+len;
    }
    return null;
  }catch(_e){return null;}
}
function _pcParseTiff(dv,t){
  const le=dv.getUint16(t)===0x4949;
  const u16=a=>dv.getUint16(a,le),u32=a=>dv.getUint32(a,le);
  if(u16(t+2)!==42)return null;
  const ifd=at=>{
    const out={};const n=u16(at);
    for(let i=0;i<n;i++){
      const e=at+2+i*12;if(e+12>dv.byteLength)break;
      out[u16(e)]={type:u16(e+2),count:u32(e+4),val:e+8};
    }
    return out;
  };
  const str=en=>{
    if(!en||en.type!==2)return '';
    const at=en.count>4?t+u32(en.val):en.val;let s2='';
    for(let i=0;i<en.count-1&&at+i<dv.byteLength;i++)s2+=String.fromCharCode(dv.getUint8(at+i));
    return s2;
  };
  const rat=(at)=>{const d=u32(at+4);return d?u32(at)/d:0;};
  const dms=en=>{
    if(!en||en.type!==5||en.count<3)return null;
    const at=t+u32(en.val);
    return rat(at)+rat(at+8)/60+rat(at+16)/3600;
  };
  const i0=ifd(t+u32(t+4));
  let when=null,lat=null,lon=null;
  if(i0[0x8769]){
    const ex=ifd(t+u32(i0[0x8769].val));
    const dt=str(ex[0x9003])||str(i0[0x0132]);
    const m=/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(dt);
    if(m){
      const off=str(ex[0x9011]);
      const iso=m[1]+'-'+m[2]+'-'+m[3]+'T'+m[4]+':'+m[5]+':'+m[6]+(/^[+-]\d{2}:\d{2}$/.test(off)?off:'');
      // No offset in the file means the camera's local time, which is this
      // phone's local time for anything shot on it.
      const d=new Date(iso);
      if(!isNaN(d))when=d.toISOString();
    }
  }
  if(i0[0x8825]){
    const g=ifd(t+u32(i0[0x8825].val));
    const la=dms(g[2]),lo=dms(g[4]);
    const lr=str(g[1]),lor=str(g[3]);
    if(la!=null&&lo!=null&&(la||lo)){
      lat=lr==='S'?-la:la;lon=lor==='W'?-lo:lo;
      if(Math.abs(lat)>90||Math.abs(lon)>180){lat=null;lon=null;}
    }
  }
  if(!when&&lat==null)return null;
  return {when,lat,lon};
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

// ── Finding a photo six months later (owner 2026-09-22) ─────────────────────
// The retrieval moment is never browsing, it is a warranty call: somebody
// rings about a house and the contractor needs every shot ever taken there,
// in date order. Warranty and field-service systems key on the PROPERTY for
// exactly this reason, because the house outlives the customer: owners sell,
// property managers swap, the address does not move.
//
// So a photo search is a search for a PLACE, and its results are properties
// rather than a wall of thumbnails. The name is how people start the lookup,
// the address is what the answer is filed under, and both have to work.
function _pcHaystack(p){
  const d=p.uploadedAt?new Date(p.uploadedAt):null;
  // dateKey, not toISOString: a photo shot at 7pm Central is the NEXT day in
  // UTC, and searching the day you took it has to find it (guarded by
  // e2e-utils-exhaustive, "no UTC-derived day keys").
  const dates=d&&!isNaN(d)?[
    dateKey(d),
    (d.getMonth()+1)+'/'+d.getDate()+'/'+d.getFullYear(),
    d.toLocaleDateString('en-US',{month:'long',year:'numeric'}),
    d.toLocaleDateString('en-US',{month:'short',day:'numeric'})
  ]:[];
  return [p.addr,p.client_name,p.job_name,p.bid_name,p.type,p.caption].concat(dates)
    .filter(Boolean).join(' ').toLowerCase();
}
// Properties, newest first, each carrying its matching shots in date order.
// The list is an argument so a caller that has to stay pure (Tim's parser)
// can resolve a sentence without reaching for a global.
function tdPhotoSearch(q,list){
  const term=String(q||'').toLowerCase().trim();
  if(!term)return [];
  // EVERY word has to land, not the phrase as one string. Tim hands this
  // whatever is left of a spoken sentence, so the words arrive in the order a
  // person says them and with the odd one still attached: "pepe 17th" and
  // "17th pepe" are the same question, and one stray word used to sink both.
  const words=term.split(/\s+/).filter(Boolean);
  const src=list||(typeof photos!=='undefined'?photos:[]);
  const hits=(src||[]).filter(p=>{
    if(!p)return false;
    const hay=_pcHaystack(p);
    return words.every(w=>hay.includes(w));
  });
  const by={};
  hits.forEach(p=>{
    // One bucket per property. A photo with no address yet falls back to the
    // customer, and an unfiled one to its own bucket, so nothing is lost.
    const key=(p.addr||'').trim().toLowerCase()||('client:'+(p.client_id!=null?p.client_id:'unfiled'));
    const g=by[key]||(by[key]={key,addr:p.addr||'',name:p.client_name||'',photos:[],last:0});
    if(!g.addr&&p.addr)g.addr=p.addr;
    if(!g.name&&p.client_name)g.name=p.client_name;
    g.photos.push(p);
    const t=Date.parse(p.uploadedAt||0)||0;
    if(t>g.last)g.last=t;
  });
  return Object.values(by)
    .map(g=>{g.photos.sort((a,b)=>(Date.parse(b.uploadedAt||0)||0)-(Date.parse(a.uploadedAt||0)||0));return g;})
    .sort((a,b)=>b.last-a.last);
}
// Open one of those properties in the album the shoot already ends with, so
// there is one photo surface in the app rather than a second one for looking
// back (§7.3).
function tdOpenPropertyPhotos(key){
  return tdOpenPhotoGroup((tdPhotoSearch.lastResults||[]).find(x=>x.key===key));
}
// One way in, for the search and for Tim both. Tim used to drop into the flat
// viewer, which shows the shots and never says whose house they are, so the
// answer to "where are my photos for pepe" arrived with the address missing
// from it (owner 2026-09-22). The folder is the answer; this is how anything
// opens one.
function tdOpenPhotoGroup(g){
  if(!g||!g.photos||!g.photos.length)return false;
  const cid=g.photos.map(p=>p.client_id).find(x=>x!=null);
  return tdOpenPropertyFolder(cid!=null?cid:null,g.addr,g.photos);
}

// ── The unfiled tray (dashboard) ────────────────────────────────────────────
// A burst is ONE thing on the dashboard, not six rows. Shots taken in the
// same stretch are the same walkthrough, so they are grouped by the gap
// between them and reopened in the same review sheet the shoot ends with.
// Derived at read time rather than stamped on the row: no new column, and
// history groups itself the day this ships.
const _PC_BURST_GAP=15*60*1000;
function tdUnfiledBursts(){
  const un=tdUnfiledPhotos().slice().sort((a,b)=>Date.parse(a.uploadedAt||0)-Date.parse(b.uploadedAt||0));
  const out=[];
  un.forEach(p=>{
    const last=out[out.length-1];
    const t=Date.parse(p.uploadedAt||0)||0;
    if(last&&Math.abs(t-last.at)<=_PC_BURST_GAP){last.photos.push(p);last.at=t;}
    else out.push({photos:[p],at:t});
  });
  return out.reverse();
}
function tdReviewBurst(firstId){
  const b=tdUnfiledBursts().find(x=>x.photos.some(p=>String(p.id)===String(firstId)));
  if(!b)return false;
  return tdReviewShots(b.photos.map(p=>p.id));
}
function tdUnfiledTrayHTML(){
  const un=tdUnfiledPhotos();
  if(!un.length)return '';
  const rows=tdUnfiledBursts().slice(0,4).map(b=>{
    const p=b.photos[b.photos.length-1];
    const guess=tdGuessPlaceFor(p)||b.photos.map(tdGuessPlaceFor).find(Boolean);
    const when=_pcShotTime(p);
    const n=b.photos.length;
    // The PROPERTY, named, because "Pepe?" does not tell a man which of
    // Pepe's two houses he is looking at.
    const pill=guess
      ?'<span class="pc-uf-pill ok" onclick="tdReviewFileBurst(\''+p.id+'\','+guess.client.id+','+JSON.stringify(guess.addr||'').replace(/"/g,'&quot;')+')">'+
        escHtml((guess.addr||'').split(',')[0]||guess.client.name)+'?</span>'
      :'<span class="pc-uf-pill">Pick a customer</span>';
    return '<div class="pc-uf-row">'+
      '<div class="pc-uf-thumb'+(n>1?' stack':'')+'" style="background-image:url(\''+_pcEscUrl(tdPhotoSrc(p))+'\')">'+
        (n>1?'<span class="pc-uf-n">'+n+'</span>':'')+'</div>'+
      '<div class="pc-uf-meta"><div class="pc-uf-when">'+(n>1?n+' shots · ':'Shot ')+escHtml(when)+'</div>'+
        '<div class="pc-uf-sub">'+(guess?escHtml(guess.client.name||''):'No address match')+'</div>'+pill+'</div>'+
      '<button type="button" class="pc-uf-file" onclick="tdReviewBurst(\''+p.id+'\')">Review</button>'+
    '</div>';
  }).join('');
  return '<div class="card" id="dash-unfiled-photos">'+
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">'+
      '<div class="td-micro" style="flex:1;margin:0">Unfiled photos</div>'+
      '<button type="button" class="pc-uf-count" onclick="tdReviewAllUnfiled()">'+un.length+'</button></div>'+
    rows+'</div>';
}
// Every unfiled photo in one grid, so a pile of bad shots from a week of
// jobs can be cleared with Select and one Delete instead of burst by burst.
function tdReviewAllUnfiled(){
  const ids=tdUnfiledPhotos().map(p=>p.id);
  return ids.length?tdReviewShots(ids):false;
}
// The address guess, accepted for the whole burst in one tap.
function tdReviewFileBurst(firstId,clientId,addr){
  const b=tdUnfiledBursts().find(x=>x.photos.some(p=>String(p.id)===String(firstId)));
  if(!b)return 0;
  const c=clients.find(x=>x.id===clientId);
  const where=addr||(c?c.addr||'':'');
  // The WHOLE burst, not one photo per tap. Jack's first run left three
  // orphans behind exactly because the old pill filed a single shot and the
  // rest stayed unfiled with no sign that they had been left.
  let n=0;
  const hit=tdGuessPlaceFor(b.photos[b.photos.length-1]);
  b.photos.forEach(p=>{if(tdFilePhoto(p.id,clientId)){
    if(where)p.addr=where;
    if(hit&&hit.addr===where)p.addrM=Math.round(hit.d);
    n++;}});
  saveAll();
  if(typeof renderDash==='function')try{renderDash();}catch(_e){}
  return n;
}
function _pcShotTime(p){
  try{
    const d=new Date(p.uploadedAt);
    if(isNaN(d))return '';
    return d.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
  }catch(_e){return '';}
}
// ── Full size, on demand only (owner 2026-09-22) ────────────────────────────
// The whole egress argument lives in this function. Uploads are free; what
// costs money is bytes going OUT, so the 4K copy is fetched exactly when a
// person asks for it and never as part of a grid, a hub page or a proposal.
// Paths are immutable (every one carries a timestamp) and written with a
// one-year Cache-Control, so the second look at the same photo is served by
// the browser rather than billed again.
function tdPhotoHasFull(photoId){
  const p=photos.find(x=>String(x.id)===String(photoId));
  return !!(p&&p.fullPath);
}
function _pcFullUrl(p){
  if(!p||!p.fullPath)return '';
  if(!(typeof supaEnabled==='function'&&supaEnabled()&&_supa))return '';
  const{data}=_supa.storage.from('gallery').getPublicUrl(p.fullPath);
  return(data&&data.publicUrl)||'';
}
// Swap the element to the full-resolution bytes. Returns the url it used, or
// '' when there is nothing bigger to show, so a caller can leave its control
// alone rather than promising a size it cannot deliver.
function tdPhotoFullSize(photoId,imgEl){
  const p=photos.find(x=>String(x.id)===String(photoId));
  if(!p||!p.fullPath)return '';
  const url=_pcFullUrl(p);
  if(!url)return '';
  const el=imgEl||document.getElementById('pc-rev-img');
  if(el)el.src=url;
  return url;
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
    // A response that is not a picture can still "load" (an empty 200 decodes
    // to nothing in some engines). Zero pixels is a failure, not a photo, and
    // it has to fall down the ladder or the editor sits on a blank canvas.
    if(!(im.naturalWidth>0&&im.naturalHeight>0)){
      _pcAnnoNote('img-empty',{src:String(im.src||'').slice(0,120)});
      _annoFail();
      return;
    }
    _annoStop();
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
  //
  // A fourth failure mode, found by WebKit on 2026-09-21: a source that
  // neither loads NOR errors. An <img> whose bytes never decode can simply
  // stall, and the editor then waits forever on an event that is not coming.
  // So every attempt is on a clock, and a stalled attempt fails like any
  // other one instead of hanging the sheet open on a blank canvas.
  let _tried=0,_annoDone=false,_annoWatch=0;
  const _annoStop=()=>{_annoDone=true;if(_annoWatch){clearTimeout(_annoWatch);_annoWatch=0;}};
  const _annoArm=()=>{
    if(_annoWatch)clearTimeout(_annoWatch);
    _annoWatch=setTimeout(()=>{
      _annoWatch=0;
      if(_annoDone||!_pcAnno)return;
      _pcAnnoNote('img-stalled',{tried:_tried,src:String(im.src||'').slice(0,120)});
      _annoFail();
    },4000);
  };
  const _annoFail=()=>{
    if(_annoDone||!_pcAnno)return;
    _tried++;
    if(_tried===1&&p.data&&im.src!==p.data){im.src=p.data;_annoArm();return;}
    _annoStop();
    _pcAnnoFromStorage(p,im);
  };
  im.onerror=()=>{
    _pcAnnoNote('img-error',{tried:_tried+1,src:String(im.src||'').slice(0,120)});
    _annoFail();
  };
  im.src=src;
  _annoArm();
  return true;
}
// Why the editor could not open, kept where both a person and a test can
// read it. Three live rounds were spent on a failure that said nothing, and
// a mark-up that silently refuses to open is exactly the kind of thing a
// contractor reports as "it just doesn't work".
let _pcAnnoLastError=null;
function _pcAnnoNote(stage,info){
  try{
    _pcAnnoLastError={stage,at:new Date().toISOString(),...(info||{})};
    window._pcAnnoLastError=_pcAnnoLastError;
  }catch(_e){}
}
// Fetch the photo's bytes through the Supabase client (it carries the
// session, so this works on a private bucket too) and feed the editor a
// blob url. Gives up only if there is nothing to fetch.
async function _pcAnnoFromStorage(p,im){
  try{
    if(!p.storagePath){_pcAnnoNote('no-storage-path');throw new Error('no storage path');}
    if(!(typeof supaEnabled==='function'&&supaEnabled()&&_supa)){_pcAnnoNote('no-supa');throw new Error('no client');}
    _pcAnnoNote('download-start',{path:p.storagePath});
    const{data,error}=await _supa.storage.from('gallery').download(p.storagePath);
    if(error||!data){_pcAnnoNote('download-failed',{path:p.storagePath,err:String((error&&error.message)||'no bytes')});throw error||new Error('no bytes');}
    if(!_pcAnno){_pcAnnoNote('closed-while-downloading');return;}
    _pcAnnoNote('download-ok',{bytes:data.size||0});
    im.onerror=()=>{_pcAnnoNote('blob-decode-failed');showToast('Could not open that photo to mark up','⚠️');tdCloseAnnotate();};
    im.removeAttribute('crossorigin');
    im.src=URL.createObjectURL(data);
  }catch(e){
    _pcAnnoNote('gave-up',{err:String((e&&e.message)||e)});
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
          // The marked copy is flattened from the 1600 view, so there is no
          // 4K version OF THE MARKS. Rather than leave Full size pointing at
          // the unmarked original (a button that quietly contradicts what is
          // on screen), the archive copy moves to originalFullPath, where it
          // stays reachable as evidence, and this row simply has no full size.
          if(r2.fullPath&&!r2.originalFullPath)r2.originalFullPath=r2.fullPath;
          r2.fullPath='';
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
