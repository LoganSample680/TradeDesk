// ── Gallery ──────────────────────────────────────────────────────────────────
let _galleryFilter='all';
// ── RRP compliance ────────────────────────────────────────────────────────────
let _rrpPaintAnswer=''; // 'yes' | 'no' | '' (unanswered)

// ── Painting estimator job classification ────────────────────────────────────
let _paintIsCommercial=false,_paintWorkScope='repair';
let _paintClientTaxRate=null,_paintTaxLookupTimer=null;

function _paintOnAddrInput(){
  clearTimeout(_paintTaxLookupTimer);
  _paintTaxLookupTimer=setTimeout(_paintLookupClientTaxRate,700);
}
async function _paintLookupClientTaxRate(){
  const addr=(document.getElementById('e-caddr')?.value||'').trim();
  const zip=typeof _extractZip==='function'?_extractZip(addr):null;
  const state=typeof detectStateFromAddr==='function'?detectStateFromAddr(addr):null;
  if(!zip&&!state){_paintClientTaxRate=null;return;}
  if(typeof lookupSalesTaxRate==='function'){
    _paintClientTaxRate=await lookupSalesTaxRate(zip||'',state||(S&&S.state)||'KS');
  }
}

function _paintSetPropertyType(type){
  _paintIsCommercial=(type==='commercial');
  _paintSyncJobTypeButtons();
  if(typeof renderEstReview==='function')renderEstReview();
  if(typeof buildProposal==='function'&&document.getElementById('est-s5')?.style.display==='block')buildProposal();
}
function _paintSetWorkScope(scope){
  _paintWorkScope=scope;
  _paintSyncJobTypeButtons();
  if(typeof renderEstReview==='function')renderEstReview();
  if(typeof buildProposal==='function'&&document.getElementById('est-s5')?.style.display==='block')buildProposal();
}
function _paintSyncJobTypeButtons(){
  const _propActive=_paintIsCommercial?'comm':'res';
  ['res','comm'].forEach(k=>{
    const btn=document.getElementById('paint-prop-'+k);if(!btn)return;
    const on=k===_propActive;
    btn.style.border='2px solid '+(on?'var(--blue)':'var(--border2)');
    btn.style.background=on?'var(--blue-lt)':'var(--bg2)';
    btn.style.color=on?'var(--blue-dk)':'var(--text2)';
  });
  const _workActive=_paintWorkScope==='improvement'?'newbuild':'repair';
  ['repair','newbuild'].forEach(k=>{
    const btn=document.getElementById('paint-work-'+k);if(!btn)return;
    const on=k===_workActive;
    btn.style.border='2px solid '+(on?'var(--blue)':'var(--border2)');
    btn.style.background=on?'var(--blue-lt)':'var(--bg2)';
    btn.style.color=on?'var(--blue-dk)':'var(--text2)';
  });
  const noteEl=document.getElementById('paint-jscope-note');
  if(!noteEl)return;
  if(_paintWorkScope==='improvement'&&typeof getJobTaxTreatment==='function'){
    const addr=document.getElementById('e-caddr')?.value||'';
    const st=(typeof detectStateFromAddr==='function'?detectStateFromAddr(addr):null)||(S&&S.state)||'KS';
    const t=getJobTaxTreatment(st,'painting','improvement',_paintIsCommercial?'commercial':'residential');
    noteEl.textContent=t.certificate?'⚠ '+t.certificate.form+' required — client must sign before work begins.':'Capital improvement: no sales tax charged to client.';
    noteEl.style.color=t.certificate?'var(--amber-dk)':'var(--text3)';
  } else {
    noteEl.textContent='';
  }
}
function setGalleryFilter(f,btn){
  _galleryFilter=f;
  document.querySelectorAll('#pg-gallery .fb').forEach(b=>{b.classList.remove('active');});
  if(btn)btn.classList.add('active');
  renderGallery();
}
function renderGallery(){
  const el=document.getElementById('gallery-grid');if(!el)return;
  const sub=document.getElementById('gallery-count-sub');
  const filtered=photos.filter(p=>_galleryFilter==='all'||p.type===_galleryFilter);
  if(sub)sub.textContent=filtered.length+' photo'+(filtered.length!==1?'s':'');
  if(!filtered.length){
    el.innerHTML='<div class="empty-state"><div class="empty-state-icon">📷</div><h3>No photos yet</h3><p>Tap "+ Add photos" to upload before/after shots of your jobs. Photos will appear in client proposals and portals.</p></div>';
    return;
  }
  // Group by client
  const byClient={};
  filtered.forEach(p=>{
    const key=p.client_name||'Unlinked';
    if(!byClient[key])byClient[key]=[];
    byClient[key].push(p);
  });
  let html='';
  Object.entries(byClient).forEach(([name,ps])=>{
    html+='<div style="margin-bottom:20px">'+
      '<div style="font-size:12px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;padding:0 2px">'+escHtml(name)+'</div>'+
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:6px">'+
      ps.map(p=>'<div onclick="openPhotoViewer(\''+p.id+'\')" style="position:relative;aspect-ratio:1;border-radius:var(--r);overflow:hidden;cursor:pointer;background:var(--bg2);border:1px solid var(--border)">'+
        '<img src="'+p.url+'" style="width:100%;height:100%;object-fit:cover" loading="lazy" onerror="this.style.display=\'none\'">'+
        '<div style="position:absolute;bottom:0;left:0;right:0;background:linear-gradient(transparent,rgba(0,0,0,.6));padding:4px 6px">'+
          '<span style="font-size:9px;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:.04em">'+escHtml(p.type)+'</span>'+
        '</div>'+
        '<button onclick="event.stopPropagation();deletePhoto(\''+p.id+'\')" style="position:absolute;top:4px;right:4px;background:rgba(0,0,0,.5);border:none;color:#fff;border-radius:50%;width:20px;height:20px;font-size:10px;cursor:pointer;line-height:1;display:flex;align-items:center;justify-content:center">✕</button>'+
      '</div>').join('')+
      '</div></div>';
  });
  el.innerHTML=html;
}
function openPhotoViewer(photoId){
  const p=photos.find(x=>x.id===photoId);if(!p)return;
  const ov=document.createElement('div');
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px';
  ov.innerHTML=
    '<button onclick="this.closest(\'div\').remove()" style="position:absolute;top:16px;right:16px;background:rgba(255,255,255,.15);border:none;color:#fff;border-radius:50%;width:36px;height:36px;font-size:18px;cursor:pointer;line-height:1">✕</button>'+
    '<img src="'+p.url+'" style="max-width:100%;max-height:80vh;border-radius:var(--r);object-fit:contain">'+
    '<div style="margin-top:12px;text-align:center">'+
      '<div style="font-size:12px;font-weight:700;color:rgba(255,255,255,.7);text-transform:uppercase;letter-spacing:.06em">'+escHtml(p.type)+'</div>'+
      (p.caption?'<div style="font-size:13px;color:#fff;margin-top:4px">'+escHtml(p.caption)+'</div>':'')+
      '<div style="font-size:11px;color:rgba(255,255,255,.4);margin-top:4px">'+escHtml(p.client_name||'')+(p.job_name?' · '+escHtml(p.job_name):'')+'</div>'+
    '</div>';
  document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
}
function deletePhoto(photoId){
  const p=photos.find(x=>x.id===photoId);if(!p)return;
  zConfirm('Delete this photo?',()=>{
    _userDelete(()=>{photos=photos.filter(x=>x.id!==photoId);saveAll();});
    renderGallery();
    if(p.storagePath&&supaEnabled()&&_supa){
      _supa.storage.from('gallery').remove([p.storagePath]).catch(()=>{});
    }
  },{title:'Delete photo',yes:'Delete',danger:true});
}
function openGalleryUpload(jobId,clientId){
  const job=jobId?jobs.find(j=>j.id===jobId):null;
  const client=clientId?clients.find(c=>c.id===clientId):(job?clients.find(c=>c.id===job.client_id):null);
  const ov=document.createElement('div');ov.className='zmodal-overlay';
  const box=document.createElement('div');box.className='zmodal';
  const jobOptions=jobs.filter(j=>j.status==='done'||j.status==='active').slice(0,30)
    .map(j=>'<option value="'+j.id+'"'+(jobId===j.id?' selected':'')+'>'+escHtml(j.name)+' — '+escHtml(clients.find(c=>c.id===j.client_id)?.name||'')+'</option>').join('');
  box.innerHTML=
    '<div style="font-size:17px;font-weight:800;margin-bottom:4px">📷 Add photo</div>'+
    '<div style="font-size:12px;color:var(--text3);margin-bottom:16px">Upload a job photo to your gallery</div>'+
    '<div class="f" style="margin-bottom:12px"><label>Photo type</label>'+
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">'+
        ['before','after','progress'].map(t=>'<label style="display:flex;align-items:center;justify-content:center;gap:4px;padding:10px;border:2px solid var(--border2);border-radius:var(--r);cursor:pointer;font-size:13px;font-weight:600">'+
          '<input type="radio" name="photo-type" value="'+t+'" style="display:none" onchange="this.closest(\'label\').closest(\'div\').querySelectorAll(\'label\').forEach(l=>l.style.borderColor=\'var(--border2)\');this.closest(\'label\').style.borderColor=\'var(--blue)\'">'+
          {before:'📸 Before',after:'✅ After',progress:'🔨 Progress'}[t]+'</label>').join('')+
      '</div>'+
    '</div>'+
    (jobOptions?'<div class="f" style="margin-bottom:12px"><label>Job <span style="font-weight:400;color:var(--text3)">(optional)</span></label><select id="gup-job" style="font-size:14px;padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);width:100%;color:var(--text);font-family:inherit"><option value="">— No job selected —</option>'+jobOptions+'</select></div>':'')+
    '<div class="f" style="margin-bottom:12px"><label>Caption <span style="font-weight:400;color:var(--text3)">(optional)</span></label><input id="gup-caption" placeholder="e.g. Living room accent wall" style="font-size:14px;padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);width:100%;color:var(--text);font-family:inherit"></div>'+
    '<input type="file" id="gup-file" accept="image/*" multiple style="display:none" onchange="processGalleryUpload(this)">'+
    '<button onclick="document.getElementById(\'gup-file\').click()" style="width:100%;padding:14px;border-radius:var(--r);border:2px dashed var(--border2);background:var(--bg);color:var(--text2);font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;margin-bottom:8px">📂 Choose photos</button>'+
    '<div id="gup-status" style="font-size:12px;color:var(--text3);text-align:center;min-height:16px;margin-bottom:8px"></div>'+
    '<button onclick="this.closest(\'.zmodal-overlay\').remove()" style="width:100%;padding:10px;border-radius:var(--r);border:none;background:none;color:var(--text3);font-size:13px;cursor:pointer;font-family:inherit">Close</button>';
  ov.appendChild(box);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
}
async function processGalleryUpload(input){
  const files=Array.from(input.files);if(!files.length)return;
  const typeEl=document.querySelector('input[name="photo-type"]:checked');
  const ptype=typeEl?typeEl.value:'after';
  const jobSel=document.getElementById('gup-job');
  const selectedJobId=jobSel?parseInt(jobSel.value)||null:null;
  const caption=(document.getElementById('gup-caption')?.value||'').trim();
  const status=document.getElementById('gup-status');
  const job=selectedJobId?jobs.find(j=>j.id===selectedJobId):null;
  const c=job?clients.find(cl=>cl.id===job.client_id):null;
  if(status)status.textContent='Uploading '+files.length+' photo'+(files.length>1?'s':'')+'…';
  let uploaded=0;
  for(const file of files){
    try{
      let url='',storagePath='';
      if(supaEnabled()&&_supaUser){
        const ext=file.name.split('.').pop()||'jpg';
        const path='gallery/'+_effectiveUid()+'/'+Date.now()+'_'+Math.random().toString(36).slice(2)+'.'+ext;
        const{error}=await _supa.storage.from('gallery').upload(path,file,{contentType:file.type,upsert:false});
        if(!error){
          const{data:urlData}=_supa.storage.from('gallery').getPublicUrl(path);
          url=urlData?.publicUrl||'';
          if(url)storagePath=path;
        }
      }
      if(!url){
        // Fallback: base64 for offline (large but works)
        url=await new Promise(res=>{const r=new FileReader();r.onload=e=>res(e.target.result);r.readAsDataURL(file);});
      }
      photos.push({id:Date.now()+Math.random(),url,storagePath,type:ptype,caption,job_id:selectedJobId,job_name:(job?job.name:null)||'',client_id:(c?c.id:null)||null,client_name:(c?c.name:null)||'',uploadedAt:new Date().toISOString()});
      uploaded++;
      if(status)status.textContent='Uploaded '+uploaded+'/'+files.length;
    }catch(e){console.warn('photo upload:',e);}
  }
  saveAll();renderGallery();
  if(status)status.textContent='✓ '+uploaded+' photo'+(uploaded!==1?'s':'')+' added';
  showToast(uploaded+' photo'+(uploaded!==1?'s':'')+' added to gallery','📷');
}

// ── Client Hub ──────────────────────────────────────────────────────────────
function _buildClientHubSnapshot(clientId){
  const c=clients.find(x=>x.id===clientId);if(!c)return null;
  const cbids=bids.filter(b=>b.client_id===clientId);
  const cjobs=jobs.filter(j=>j.client_id===clientId&&j.eventType!=='estimate');
  const cpayments=payments.filter(p=>p.client_id===clientId);
  const baseUrl=_clientBaseUrl();
  const hubUrl=c.clientToken?baseUrl+'client.html?t='+c.clientToken+'&u='+(_supaUser?.id||'')+'&c='+clientId:'';
  const snapshotBids=cbids.map(b=>{
    const paid=getBidPaid(b.id);
    const balance=getBidBalance(b);
    const signToken=b.signingToken||(_pendingSignToken?.bidId===b.id?_pendingSignToken.token:null);
    const propKey=b.proposalKey||b.signingKey||(_pendingSignToken?.bidId===b.id?_pendingSignToken.proposalKey:null)||null;
    const signBase=signToken?baseUrl+'sign.html?t='+signToken+'&u='+(_supaUser?.id||'')+'&b='+b.id:null;
    const _hubType=(b.type==='Build Your Own Estimate'?'Custom Estimate':b.type)||'Estimate';
    const _hubCOs=(b.changeOrders||[]).map(co=>({id:co.id,coNum:co.coNum,desc:co.desc,type:co.type,amount:co.amount,delta:co.delta,originalAmount:co.originalAmount,newAmount:co.newAmount,status:co.status||(co.signedAt?'signed':'pending_client'),sentAt:co.sentAt||'',signedAt:co.signedAt||'',signerName:co.signerName||'',sigData:co.sigData||''}));
    const _fcDaysElapsed=typeof window._fcTestDays==="number"?window._fcTestDays:Math.floor((Date.now()-new Date(b.completion_date||b.signedAt||Date.now()).getTime())/86400000);
    const _fcDaysOverdue=Math.max(0,_fcDaysElapsed-30);
    const _fcRate=(S.financeChargePct!=null?parseFloat(S.financeChargePct):1.5)/100/30;
    const financeCharge=balance>0.01&&_fcDaysOverdue>0?Math.round(balance*_fcRate*_fcDaysOverdue*100)/100:0;
    const daysOverdue=balance>0.01?_fcDaysOverdue:0;
    return {id:b.id,amount:b.amount||0,deposit:b.deposit!=null?b.deposit:Math.round((b.amount||0)*0.25*100)/100,status:b.status,type:_hubType,bid_date:b.bid_date||'',completion_date:b.completion_date||'',paid,balance,financeCharge,daysOverdue,signedAt:b.signedAt||'',
      lostReason:b.lostReason||'',lostNote:b.lostNote||'',lostAt:b.lostAt||'',
      proposalKey:propKey,signingToken:signToken||null,changeOrders:_hubCOs,
      signHubUrl:signBase?(signBase+(hubUrl?'&hub='+encodeURIComponent(hubUrl):'')):null};
  });
  const clientPhotos=photos.filter(p=>p.client_id===clientId);
  const snapshotJobs=cjobs.map(j=>{
    const jPhotos=clientPhotos.filter(p=>p.job_id===j.id).map(p=>({url:p.url,type:p.type,caption:p.caption||''}));
    return {id:j.id,bid_id:j.bid_id||null,name:j.name||'Job',start:j.start||'',days:j.days||0,status:j.status||'scheduled',completion_date:j.completion_date||'',photos:jPhotos};
  });
  const snapshotPayments=cpayments.map(p=>({date:p.date||'',type:p.type||'',amount:p.amount||0,bid_id:p.bid_id||null,ref:p.ref||'',method:p.method||''}));
  const jobPhotos=clientPhotos.map(p=>({url:p.url,type:p.type,caption:p.caption||'',job_name:p.job_name||'',job_id:p.job_id||null}));
  // Extract optional chaining BEFORE the return object — Safari crashes on ?. inside { }
  const _snapUserId=_effectiveUid()||'';
  const _snapUserEmail=_supaUser?_supaUser.email||'':'';
  const _snapStripeOn=_stripeConnectStatus?(_stripeConnectStatus.charges_enabled?true:false):false;
  const _snapSurchargeOn=!!(S.ccSurchargeEnabled&&_snapStripeOn);
  const _snapAddrM=(c.addr||'').toUpperCase().match(/\b(AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/);
  const _snapState=(_snapAddrM?_snapAddrM[1]:null)||S.state||'KS';
  const _snapCancelDays=(STATE_CANCEL&&STATE_CANCEL[_snapState])?STATE_CANCEL[_snapState].days:3;
  const _snapCancelStatute=(STATE_CANCEL&&STATE_CANCEL[_snapState])?STATE_CANCEL[_snapState].statute:'16 CFR Part 429';
  return {
    clientId,clientName:c.name,clientEmail:c.email||'',clientPhone:c.phone||'',clientAddr:c.addr||'',
    contractorName:S.bname||'TradeDesk',contractorPhone:S.bphone||'',
    brandColor:S.brandColor||'',logoData:S.logoData||'',bwebsite:S.bwebsite||'',
    contractorUserId:_snapUserId,notifyEmail:S.bemail||_snapUserEmail,
    stripeEnabled:_snapStripeOn,
    ccSurchargeEnabled:_snapSurchargeOn,
    ccSurchargePct:Math.min(4,Math.max(0.5,parseFloat(S.ccSurchargePct||3)||3)),
    yearBuilt:c.yearBuilt||null,
    epaRequired:!!(c.yearBuilt&&c.yearBuilt<1978&&(c.rrpDisturb==='yes'||_rrpPaintAnswer==='yes')),
    rrpFirmCertNum:(()=>{const l=(typeof licenses!=='undefined'?licenses:[]).find(x=>x.typeId==='epa_firm'&&(!x.expiryDate||x.expiryDate>=todayKey()));return l?.licenseNumber||'';})(),
    rrpRenovatorName:(()=>{const l=(typeof licenses!=='undefined'?licenses:[]).find(x=>x.typeId==='epa_renovator'&&(!x.expiryDate||x.expiryDate>=todayKey()));return l?.holderName||'';})(),
    rrpRenovatorCertNum:(()=>{const l=(typeof licenses!=='undefined'?licenses:[]).find(x=>x.typeId==='epa_renovator'&&(!x.expiryDate||x.expiryDate>=todayKey()));return l?.licenseNumber||'';})(),
    epaAck:c.epaAck||false,
    trade:getActiveTrade(),
    state:_snapState,
    cancelDays:_snapCancelDays,
    cancelStatute:_snapCancelStatute,
    hubUrl,token:c.clientToken||'',generatedAt:new Date().toISOString(),
    bids:snapshotBids,payments:snapshotPayments,jobs:snapshotJobs,photos:jobPhotos
  };
}
function _ensureClientToken(clientId){
  const c=clients.find(x=>x.id===clientId);
  if(!c||c.clientToken)return;
  c.clientToken=Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b=>b.toString(16).padStart(2,'0')).join('');
}
// Cheap deterministic hash of the hub JSON — gates redundant re-uploads.
function _hubHash(s){let h=0;for(let i=0;i<s.length;i++){h=((h<<5)-h+s.charCodeAt(i))|0;}return h;}
async function _uploadClientHub(clientId){
  if(!supaEnabled()||!_supaUser)return null;
  const c=clients.find(x=>x.id===clientId);if(!c)return null;
  const isNew=!c.clientToken;
  if(!c.clientToken){
    c.clientToken=Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b=>b.toString(16).padStart(2,'0')).join('');
  }
  if(_stripeConnectStatus===null)_fetchStripeConnectStatus().catch(()=>{});
  const baseUrl=_clientBaseUrl();
  const url=baseUrl+'client.html?t='+c.clientToken+'&u='+_effectiveUid()+'&c='+clientId;
  const doUpload=async()=>{
    const snapshot=_buildClientHubSnapshot(clientId);
    if(!snapshot)return;
    snapshot.token=c.clientToken;
    const _json=JSON.stringify(snapshot);
    // Skip the storage write when the hub content is unchanged since the last upload.
    // Boot used to re-push EVERY tokened client's hub (hundreds of identical /api
    // writes per load). A content hash gates it: only changed hubs upload — no data
    // loss, since any real change (incl. the daily finance-charge tick) hashes
    // differently and uploads.
    const _hash=_hubHash(_json);
    if(c.clientHubKey&&c.clientHubHash===_hash)return;
    const key='client-hub/'+_effectiveUid()+'/'+clientId+'_'+c.clientToken+'.json';
    const{error}=await _supa.storage.from('proposals').upload(key,_json,{contentType:'application/json',upsert:true,cacheControl:'0'});
    if(error)throw error;
    // Stamp the LIVE array object, not the reference captured before the await: a
    // delta/realtime merge during the upload replaces row objects in `clients`, so
    // writing to `c` can land on a dead object — the token/key silently vanish and
    // the uploaded hub becomes unreachable (seen live in the crew money-routing cert).
    const live=clients.find(x=>x.id===clientId)||c;
    live.clientToken=c.clientToken;
    live.clientHubKey=key;live.clientHubHash=_hash;
    saveAll();
  };
  const _queueHub=()=>{
    try{
      const q=JSON.parse(localStorage.getItem('zp3_hub_queue')||'[]');
      if(!q.includes(clientId)){q.push(clientId);localStorage.setItem('zp3_hub_queue',JSON.stringify(q));}
    }catch(_e){}
  };
  if(isNew){
    try{await doUpload();}catch(e){console.warn('hub upload:',e);_queueHub();}
  }else{
    doUpload().catch(e=>{console.warn('hub refresh:',e);_queueHub();}); // file exists — return instantly, refresh in background
  }
  return url;
}
// ── Boot hub sweep — drift-repair backstop, PACED ─────────────────────────────
// Every real change already refreshes its own client's hub at the change site
// (bids/payments/jobs/logPayment call _uploadClientHub/_refreshClientHub inline).
// This sweep exists only to repair hubs that drifted while another device was
// authoritative. It used to fire EVERY tokened client CONCURRENTLY at boot —
// O(clients) simultaneous snapshot builds + storage writes, and the daily
// finance-charge tick invalidates every content hash at once, so the first boot
// of the day uploaded ALL of them in one burst (hundreds seen on the grown cert
// account; the same would hit any large real account). One client per tick keeps
// boot flat at ANY account size; the content-hash gate inside _uploadClientHub
// still makes unchanged hubs a no-op.
let _hubSweepQueue=[],_hubSweepTimer=null;
function _startHubSweep(){
  if(_hubSweepTimer||!_supaUser)return;
  _hubSweepQueue=clients.filter(c=>c.clientToken).map(c=>c.id);
  if(_hubSweepQueue.length)_hubSweepTimer=setTimeout(_tickHubSweep,350);
}
function _tickHubSweep(){
  _hubSweepTimer=null;
  const id=_hubSweepQueue.shift();
  if(id===undefined)return;
  // Account switched mid-sweep → stale ids simply miss in clients[] and no-op.
  try{if(_supaUser&&supaEnabled())_uploadClientHub(id).catch(()=>{});}catch(_e){}
  if(_hubSweepQueue.length)_hubSweepTimer=setTimeout(_tickHubSweep,350);
}
async function _drainHubQueue(){
  try{
    const q=JSON.parse(localStorage.getItem('zp3_hub_queue')||'[]');
    if(!q.length)return;
    const remaining=[];
    for(const cid of q){
      try{await _uploadClientHub(cid);}catch(e){remaining.push(cid);}
    }
    if(remaining.length)localStorage.setItem('zp3_hub_queue',JSON.stringify(remaining));
    else localStorage.removeItem('zp3_hub_queue');
  }catch(_e){}
}
function _relTime(ts){if(!ts)return'';try{const d=Math.round((Date.now()-new Date(ts).getTime())/60000);if(d<2)return'just now';if(d<60)return d+'m ago';if(d<1440)return Math.round(d/60)+'h ago';return Math.round(d/1440)+'d ago';}catch(e){return '';}}
function sendOnboardingLink(clientId){
  const c=getClientById(clientId);if(!c)return;
  if(!_supaUser){zAlert('Sign in to send the onboarding link.');return;}
  const baseUrl=_clientBaseUrl();
  const url=baseUrl+'client.html?mode=onboard&t='+c.clientToken+'&u='+_effectiveUid()+'&c='+clientId;
  const firstName=c.name?.split(' ')[0]||'there';
  const rawBiz=getBusinessName();
  const biz=(rawBiz&&!rawBiz.includes('@')&&rawBiz!=='TradeDesk')?rawBiz:(getOwnerName()||'your contractor');
  const msg='Hi '+firstName+'! This is '+biz+'. Tap this link to share your address and project details so I can prepare your free quote — takes about 2 minutes: '+url;
  // Save sent timestamp
  const idx=clients.findIndex(x=>x.id===clientId);
  if(idx>=0){clients[idx].onboardingSentAt=new Date().toISOString();saveAll();}
  if(c.phone){
    window.location.href='sms:'+c.phone.replace(/\D/g,'')+'?body='+encodeURIComponent(msg);
  }else{
    // No phone — show the link to copy
    const ov=document.createElement('div');ov.className='zmodal-overlay';ov.style.cssText='align-items:center;padding:20px';
    const box=document.createElement('div');box.className='zmodal';
    box.innerHTML='<div style="font-size:17px;font-weight:800;margin-bottom:4px">Onboarding link</div>'+
      '<div style="font-size:13px;color:var(--text2);margin-bottom:12px">No phone on file — copy this link and send manually</div>'+
      '<div style="background:var(--bg);border:1px solid var(--border2);border-radius:var(--r);padding:10px 12px;font-size:12px;word-break:break-all;color:var(--text2);margin-bottom:12px">'+url+'</div>'+
      '<button onclick="navigator.clipboard.writeText(\''+url.replace(/'/g,"\\'")+'\')||true;showToast(\'Copied\',\'📋\')" style="width:100%;padding:13px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:8px">Copy link</button>'+
      '<button onclick="this.closest(\'.zmodal-overlay\').remove()" style="width:100%;padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:none;color:var(--text3);font-size:13px;cursor:pointer;font-family:inherit">Close</button>';
    ov.appendChild(box);document.body.appendChild(ov);
  }
}
function sendClientHubLink(clientId){
  const c=clients.find(x=>x.id===clientId);
  if(!c||!supaEnabled()||!_supaUser){zAlert('Could not create hub link. Make sure you\'re signed in.');return;}
  if(!c.clientToken){
    c.clientToken=Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b=>b.toString(16).padStart(2,'0')).join('');
    saveAll();
  }
  const baseUrl=_clientBaseUrl();
  const url=baseUrl+'client.html?t='+c.clientToken+'&u='+_effectiveUid()+'&c='+clientId;
  // Refresh hub content silently in background — never blocks the share sheet
  _uploadClientHub(clientId).catch(()=>{});
  const firstName=c.name?.split(' ')[0]||'there';
  const biz=S.bname||'us';
  const ov=document.createElement('div');ov.className='zmodal-overlay';
  const box=document.createElement('div');box.className='zmodal';
  box.innerHTML=
    '<div style="font-size:17px;font-weight:800;margin-bottom:4px">📋 Client Hub ready</div>'+
    '<div style="font-size:12px;color:var(--text3);margin-bottom:14px">'+escHtml(c.name||'Client')+' · view proposals, pay balance, download invoices</div>'+
    '<div style="background:var(--bg);border:1px solid var(--border2);border-radius:var(--r);padding:10px 12px;font-size:11px;word-break:break-all;color:var(--text2);margin-bottom:14px;user-select:all">'+url+'</div>'+
    '<button onclick="navigator.clipboard.writeText(\''+url+'\').then(()=>showToast(\'Copied!\',\'📋\'));this.textContent=\'✓ Copied\'" style="width:100%;padding:12px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:8px">📋 Copy link</button>'+
    (c.phone?'<button onclick="this.closest(\'.zmodal-overlay\').remove();window.location.href=\'sms:\'+\''+c.phone.replace(/\D/g,'')+'\'+\'?body=\'+encodeURIComponent(\'Hi '+firstName+', here\\\'s your project hub from '+biz+' — view your proposals, pay your balance, and download invoices anytime: '+url+'\')" style="width:100%;padding:12px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;margin-bottom:8px">📱 Send via Messages</button>':'')+
    '<button onclick="this.closest(\'.zmodal-overlay\').remove()" style="width:100%;padding:10px;border-radius:var(--r);border:none;background:none;color:var(--text3);font-size:13px;cursor:pointer;font-family:inherit">Close</button>';
  ov.appendChild(box);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  navigator.clipboard.writeText(url).catch(()=>{});
}
async function _refreshClientHub(clientId){
  const c=clients.find(x=>x.id===clientId);
  if(!c?.clientToken||!supaEnabled()||!_supaUser)return;
  if(_stripeConnectStatus===null)_fetchStripeConnectStatus().catch(()=>{});
  const snapshot=_buildClientHubSnapshot(clientId);
  if(!snapshot)return;
  snapshot.token=c.clientToken;
  const key='client-hub/'+_effectiveUid()+'/'+clientId+'_'+c.clientToken+'.json';
  try{
    const{error}=await _supa.storage.from('proposals').upload(key,JSON.stringify(snapshot),{contentType:'application/json',upsert:true,cacheControl:'0'});
    if(error)throw error;
    // Same live-object rule as _uploadClientHub — never stamp a pre-await reference.
    const live=clients.find(x=>x.id===clientId)||c;
    live.clientHubKey=key;saveAll();
  }catch(e){console.warn('hub refresh:',e);}
}
function copyHubLink(url){navigator.clipboard.writeText(url).then(()=>showToast('Hub link copied','📋')).catch(()=>showToast('Could not copy — tap the URL above','⚠️'));}
function showHubMenu(clientId){
  const c=clients.find(x=>x.id===clientId);
  if(!c?.clientToken||!_supaUser){sendClientHubLink(clientId);return;}
  const baseUrl=_clientBaseUrl();
  const hubUrl=baseUrl+'client.html?t='+c.clientToken+'&u='+_effectiveUid()+'&c='+clientId;
  const existing=document.getElementById('_hub-menu-ov');if(existing)existing.remove();
  const ov=document.createElement('div');
  ov.id='_hub-menu-ov';
  ov.style.cssText='position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);padding:20px';
  ov.onclick=e=>{if(e.target===ov)ov.remove();};
  const sheet=document.createElement('div');
  sheet.style.cssText='background:var(--bg);border-radius:16px;padding:20px 16px 24px;display:flex;flex-direction:column;gap:10px;width:100%;max-width:360px';
  const hdr=document.createElement('div');
  hdr.style.cssText='text-align:center;padding-bottom:4px';
  hdr.innerHTML='<div style="width:36px;height:4px;background:var(--border2);border-radius:2px;margin:0 auto 12px"></div>'
    +'<div style="font-size:14px;font-weight:700;color:var(--text2)">Client Hub</div>';
  const mkBtn=(label,bg,color,fn)=>{const b=document.createElement('button');b.textContent=label;b.style.cssText='padding:14px;border:none;border-radius:var(--r);font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;background:'+bg+';color:'+color;b.onclick=fn;return b;};
  sheet.appendChild(hdr);
  sheet.appendChild(mkBtn('📋  Copy link','var(--blue)','#fff',()=>{navigator.clipboard.writeText(hubUrl).then(()=>showToast('Hub link copied','📋')).catch(()=>showToast('Copy failed','⚠️'));ov.remove();}));
  sheet.appendChild(mkBtn('🔗  Open hub','var(--blue-lt)','var(--blue)',()=>{ov.remove();window.location.href=hubUrl;}));
  sheet.appendChild(mkBtn('← Back','var(--bg2)','var(--text2)',()=>ov.remove()));
  ov.appendChild(sheet);
  document.body.appendChild(ov);
}

function syncAdj(){const pct=parseInt(v('est-adj')||0);document.getElementById('est-adj-val').textContent=(pct>0?'+':'')+pct+'%';renderEstReview();}
function onAdjSliderRelease(){
  const pct=parseInt(v('est-adj')||0);
  if(pct===0){clearAdjReason();return;}
  const isPortfolioOn=document.getElementById('portfolio-toggle')?.checked||false;
  if(isPortfolioOn)return;
  showAdjReasonSheet(pct);
}
function showAdjReasonSheet(pct){
  const existing=document.getElementById('adj-reason-sheet');if(existing)existing.remove();
  const isNeg=pct<0;
  const pills=isNeg?['Portfolio Showcase','Repeat customer','Competitive bid','Other']:['Difficult access','Rush job','Extra prep needed','Other'];
  const sheet=document.createElement('div');
  sheet.id='adj-reason-sheet';
  sheet.style.cssText='display:flex;flex-direction:column;align-items:center;justify-content:center;position:fixed;inset:0;z-index:1100;background:rgba(0,0,0,.45)';
  const inner=document.createElement('div');
  inner.style.cssText='width:calc(100% - 32px);max-width:480px;border-radius:18px;background:var(--bg);padding:24px 16px;box-sizing:border-box;max-height:85vh;overflow-y:auto';
  inner.innerHTML=
    '<div style="font-size:16px;font-weight:800;margin-bottom:4px">'+(isNeg?'Why the discount?':'Why the increase?')+'</div>'+
    '<div style="font-size:12px;color:var(--text3);margin-bottom:14px">Pick a reason, or tap outside to cancel.</div>'+
    '<div id="adj-reason-pills" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;justify-content:center">'+
      pills.map(p=>'<button onclick="adjReasonPillTap(\''+p.replace(/'/g,"\\'")+'\')" style="padding:10px 14px;border-radius:24px;border:1px solid var(--border2);background:var(--bg2);font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;color:var(--text)">'+p+'</button>').join('')+
    '</div>'+
    '<div id="adj-reason-detail-wrap" style="display:none">'+
      '<label style="font-size:11px;font-weight:700;color:var(--text3);display:block;margin-bottom:4px" id="adj-reason-detail-label">Add a note</label>'+
      '<input type="text" id="adj-reason-detail-input" placeholder="Brief note..." style="font-size:13px;padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg);color:var(--text);width:100%;box-sizing:border-box;font-family:inherit;margin-bottom:10px">'+
      '<button onclick="confirmAdjReasonFromSheet()" class="btn btn-p" style="width:100%;font-size:15px;padding:12px">Confirm reason &#8594;</button>'+
    '</div>';
  sheet.appendChild(inner);
  sheet.onclick=(e)=>{if(e.target===sheet)closeAdjSheetSnap();};
  document.body.appendChild(sheet);
  window._adjSheetSelected='';
}
function adjReasonPillTap(label){
  if(label==='Portfolio Showcase'){
    const sheet=document.getElementById('adj-reason-sheet');if(sheet)sheet.remove();
    const tog=document.getElementById('portfolio-toggle');
    if(tog){tog.checked=true;togglePortfolioShowcase();}
    return;
  }
  window._adjSheetSelected=label;
  const isOther=label==='Other';
  document.querySelectorAll('#adj-reason-pills button').forEach(b=>{
    const active=b.textContent.trim()===label;
    b.style.background=active?'var(--blue)':'var(--bg2)';
    b.style.color=active?'#fff':'var(--text)';
    b.style.borderColor=active?'var(--blue)':'var(--border2)';
  });
  const wrap=document.getElementById('adj-reason-detail-wrap');
  const lbl=document.getElementById('adj-reason-detail-label');
  const inp=document.getElementById('adj-reason-detail-input');
  if(wrap){wrap.style.display='block';}
  if(lbl){lbl.textContent=isOther?'Describe the reason (required)':'Add a note (optional)';}
  if(inp){inp.placeholder=isOther?'A few words about the reason...':'Optional detail...';if(isOther)inp.focus();}
}
function confirmAdjReasonFromSheet(){
  const label=window._adjSheetSelected||'';
  if(!label){zAlert('Pick a reason first.',{title:'Select a reason'});return;}
  const detail=(document.getElementById('adj-reason-detail-input')?.value||'').trim();
  if(label==='Other'&&detail.split(/\s+/).filter(Boolean).length<1){
    zAlert('Please add at least one word.',{title:'More detail needed'});return;
  }
  const pct=parseInt(v('est-adj')||0);
  const reasonText=detail?label+' — '+detail:label;
  const typeKey=label.toLowerCase().replace(/\s+/g,'_');
  const sheet=document.getElementById('adj-reason-sheet');if(sheet)sheet.remove();
  confirmAdjReason(typeKey,reasonText,pct);
}
function confirmAdjReason(type,reasonText,pct){
  const typeHidden=document.getElementById('adj-type-hidden');
  const reasonHidden=document.getElementById('adj-reason-hidden');
  if(typeHidden)typeHidden.value=type;
  if(reasonHidden)reasonHidden.value=reasonText;
  const summary=document.getElementById('adj-reason-summary');
  const summaryText=document.getElementById('adj-reason-summary-text');
  if(summary)summary.style.display='flex';
  if(summaryText)summaryText.textContent=reasonText+(pct&&pct!==0?' ('+pct+'%)':'');
  saveEstFullDraft();
}
function clearAdjReason(){
  const typeHidden=document.getElementById('adj-type-hidden');
  const reasonHidden=document.getElementById('adj-reason-hidden');
  if(typeHidden)typeHidden.value='';
  if(reasonHidden)reasonHidden.value='';
  const summary=document.getElementById('adj-reason-summary');
  if(summary)summary.style.display='none';
  const tog=document.getElementById('portfolio-toggle');
  if(!tog?.checked){const adj=document.getElementById('est-adj');if(adj){adj.value=0;syncAdj();}}
  saveEstFullDraft();
}
function closeAdjSheetSnap(){
  const sheet=document.getElementById('adj-reason-sheet');if(sheet)sheet.remove();
  const tog=document.getElementById('portfolio-toggle');
  if(!tog?.checked){const adj=document.getElementById('est-adj');if(adj){adj.value=0;syncAdj();}}
}
function clearPortfolioShowcase(){
  const tog=document.getElementById('portfolio-toggle');
  if(tog){tog.checked=false;togglePortfolioShowcase();}
}
function togglePortfolioShowcase(){
  const on=document.getElementById('portfolio-toggle')?.checked||false;
  const details=document.getElementById('portfolio-details');
  if(details)details.style.display=on?'block':'none';
  const pct=parseInt(document.getElementById('portfolio-pct')?.value)||15;
  const adj=document.getElementById('est-adj');
  if(on){
    if(adj){adj.value=-pct;syncAdj();}
    confirmAdjReason('portfolio','Portfolio showcase discount ('+pct+'% off)',-pct);
    updatePortfolioPreview();
  } else {
    if(adj){adj.value=0;syncAdj();}
    const typeHidden=document.getElementById('adj-type-hidden');
    if((typeHidden?.value||'')==='portfolio'){
      if(typeHidden)typeHidden.value='';
      const reasonHidden=document.getElementById('adj-reason-hidden');
      if(reasonHidden)reasonHidden.value='';
      const summary=document.getElementById('adj-reason-summary');
      if(summary)summary.style.display='none';
    }
  }
  saveEstFullDraft();
}
function onPortfolioPctChange(){
  const on=document.getElementById('portfolio-toggle')?.checked||false;
  if(!on)return;
  const pct=Math.min(25,Math.max(5,parseInt(document.getElementById('portfolio-pct')?.value)||15));
  const adj=document.getElementById('est-adj');
  if(adj){adj.value=-pct;syncAdj();}
  confirmAdjReason('portfolio','Portfolio showcase discount ('+pct+'% off)',-pct);
  updatePortfolioPreview();
  saveEstFullDraft();
}
function updatePortfolioPreview(){
  const preview=document.getElementById('portfolio-preview');if(!preview)return;
  const pct=parseInt(document.getElementById('portfolio-pct')?.value)||15;
  const target=parseInt(document.getElementById('portfolio-target')?.value)||5;
  const years=S.byears||0;
  const owner=getOwnerName()||'Your contractor';
  const yearsPhrase=years?owner+' has '+years+' years of professional painting experience. ':owner+' has years of professional painting experience. ';
  preview.textContent='We are currently selecting a limited number of showcase homes to feature across our Social Media. Your home has been selected. In exchange for permission to photograph your home before and after completion and feature it across our platforms, we are offering '+pct+'% off this project. No personal information is shared without your explicit permission.';
}

async function shortenUrl(url){
  // TODO: swap baseUrl to Cloudflare Pages domain (zjspainting.pages.dev) tomorrow
  return url;
}
async function sendProposalLink(){
  const proposal=document.getElementById('est-proposal');
  if(!proposal||!proposal.innerHTML.trim()){zAlert('Generate the proposal first.',{title:'Nothing to print'});return;}
  if(!supaEnabled()||!_supaUser){zAlert('Sign in to send client links.',{title:'Sign in required'});return;}
  if(_rrpPaintAnswer==='yes'){
    const _today=todayKey();
    const _hasRRP=(typeof licenses!=='undefined')&&licenses.some(l=>
      ['epa_firm','epa_renovator'].includes(l.typeId)&&(!l.expiryDate||l.expiryDate>=_today));
    if(!_hasRRP){
      zAlert('EPA RRP certification required. Add your cert under Settings → Licensing before sending.',{title:'RRP cert required'});
      return;
    }
  }
  const btn=document.getElementById('send-proposal-btn');
  if(btn){btn.textContent='⏳ Saving...';btn.disabled=true;}
  try{
    if(_stripeConnectStatus===null)_fetchStripeConnectStatus().catch(()=>{});
    const cname=document.getElementById('e-cname')?.value||'Client';
    const _rawBname=document.getElementById('e-bname')?.value||getBusinessName()||'';
    const bname=(_rawBname&&!_rawBname.includes('@'))?_rawBname:'No Business Name Entered';
    // Resolve bid ID — if the current bid was already sent (has a signingToken),
    // create a fresh bid so each proposal gets its own unique link and record.
    let bidId=editingBidId||lastCreatedBidId;
    // On mobile, window.location.href (SMS/email) can lose in-memory lastCreatedBidId on return.
    // Recover: find existing unsent draft for the linked client before creating a new one.
    if(!bidId&&estLinkedClientId){
      const _orphan=bids.find(b=>b.client_id===estLinkedClientId&&!b.signingToken&&b.status!=='Closed Won'&&(b.status==='Draft'||b.draft));
      if(_orphan){bidId=_orphan.id;lastCreatedBidId=bidId;}
    }
    const _resolvedBid=bidId?bids.find(b=>b.id===bidId):null;
    if(!bidId||(_resolvedBid&&_resolvedBid.signingToken)){
      // Already sent once, or no bid at all — mint a new bid for this proposal
      // Recover estLinkedClientId from existing client records (handles dashboard flow where it's null)
      if(!estLinkedClientId){
        const _cph=(document.getElementById('e-cphone')?.value||'').replace(/\D/g,'');
        const _cnm=(document.getElementById('e-cname')?.value||'').trim().toLowerCase();
        const _mc=clients.find(c=>(_cph&&c.phone?.replace(/\D/g,'')===_cph)||(!_cph&&_cnm&&c.name?.trim().toLowerCase()===_cnm));
        if(_mc)estLinkedClientId=_mc.id;
      }
      const{final}=calcEst();
      const _caddr=document.getElementById('e-caddr')?.value||'';
      const _days=parseInt(document.getElementById('e-days')?.value)||2;
      const _ss={};SCOPE_ITEMS.forEach(s=>{_ss[s.id]=!!scopeOn(s.id);});
      // Extract ?. before object literal — Safari crashes on optional chaining inside { }
      const _fbClientId=estLinkedClientId||(_resolvedBid?_resolvedBid.client_id:null)||null;
      const _fbPhone=(document.getElementById('e-cphone')?document.getElementById('e-cphone').value:null)||(_resolvedBid?_resolvedBid.phone:null)||'';
      const _fbAddr=_caddr||(_resolvedBid?_resolvedBid.addr:null)||'';
      const _fbAmount=final||(_resolvedBid?_resolvedBid.amount:null)||0;
      const _fbType=getBidIncomeLabel({surfaces:estSurfaces})||(_resolvedBid?_resolvedBid.type:null)||'Painting job';
      const _fbNotes=(document.getElementById('e-cnotes')?document.getElementById('e-cnotes').value:null)||'';
      const _fbCond=(document.getElementById('e-cond')?document.getElementById('e-cond').value:null)||'';
      const _fbPaint=(document.getElementById('e-paint')?document.getElementById('e-paint').value:null)||'';
      const _fbColors=(document.getElementById('e-colors')?document.getElementById('e-colors').value:null)||'';
      const freshBid={
        id:_newBidId(),
        client_id:_fbClientId,
        client_name:cname,name:cname,
        phone:_fbPhone,
        addr:_fbAddr,
        bid_date:todayKey(),followup:addDays(todayKey(),7),
        amount:_fbAmount,
        type:_fbType,
        days:_days,status:'Pending',
        notes:_fbNotes,
        completion_date:'',collStage:'none',collHistory:[],
        scope:_ss,surfaces:[...estSurfaces],
        cond:_fbCond,
        paint:_fbPaint,
        colors:_fbColors,
        roomScopeMap:JSON.parse(JSON.stringify(roomScopeMap||{})),
      };
      bids.unshift(freshBid);
      lastCreatedBidId=freshBid.id;
      bidId=freshBid.id;
    }
    const token=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
    const proposalKey=`proposals/${_supaUser.id}/${bidId}_${token}.json`;
    const _bidForProp=bids.find(b=>b.id===bidId);
    // Always use live calcEst().final for amount — captures tier multiplier, adjustments, etc.
    // Never use bid.amount which may be stale from an earlier step before tier was set.
    const{final:_propFinal}=calcEst();
    const _depositPct=(parseFloat(document.getElementById('e-deposit-pct')?.value)||0)/100;
    const _depositAmt=Math.round(_propFinal*_depositPct*100)/100;
    const _caddrValSpl=document.getElementById('e-caddr')?.value||'';
    const _addrStateSpl=_caddrValSpl.toUpperCase().match(/\b(AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/);
    const _st=(_addrStateSpl?_addrStateSpl[1]:null)||S?.state||'KS';
    const _cancelRuleSpl=(typeof STATE_CANCEL!=='undefined'&&STATE_CANCEL[_st])||{days:3,statute:'16 CFR Part 429'};
    const _cancelStat=_cancelRuleSpl.statute;
    const _cancelDays=_cancelRuleSpl.days;
    if(_bidForProp){_bidForProp.amount=_propFinal;_bidForProp.deposit=_depositAmt;}
    // Extract ?. BEFORE object literal — Safari crashes on optional chaining inside { }
    const _pdCaddr=(document.getElementById('e-caddr')?document.getElementById('e-caddr').value:null)||(_bidForProp?_bidForProp.addr:null)||'';
    const _pdDays=parseInt(document.getElementById('e-days')?document.getElementById('e-days').value:null)||(_bidForProp?_bidForProp.days:null)||2;
    const _pdStripeOn=_stripeConnectStatus?(_stripeConnectStatus.charges_enabled?true:false):false;
    const _pdPortfolioOn=!!(document.getElementById('portfolio-toggle')?document.getElementById('portfolio-toggle').checked:false);
    const _pdPortfolioPct=parseInt(document.getElementById('portfolio-pct')?document.getElementById('portfolio-pct').value:null)||15;
    const _pdRawPrice=_pdPortfolioOn&&_pdPortfolioPct>0?Math.round(_propFinal/(1-_pdPortfolioPct/100)*100)/100:_propFinal;
    const _pdYbClient=_bidForProp?clients.find(c=>c.id===_bidForProp.client_id):null;
    const _pdYearBuilt=_pdYbClient?_pdYbClient.yearBuilt||null:null;
    const _pdEpaRequired=!!(_pdYearBuilt&&_pdYearBuilt<1978&&((_pdYbClient&&_pdYbClient.rrpDisturb==='yes')||_rrpPaintAnswer==='yes'));
    const proposalData={
      id:bidId,token,clientName:cname,businessName:bname,
      contractorUserId:_effectiveUid(),contractorEmail:_supaUser.email,
      clientId:estLinkedClientId||null,
      proposalHtml:proposal.innerHTML,
      clientAddr:_pdCaddr,
      estDays:_pdDays,
      amount:_propFinal,
      deposit:_depositAmt,
      createdAt:new Date().toISOString(),status:'pending',
      notifyEmail:_supaUser.email,businessPhone:S.bphone||'',stripeConnectEnabled:_pdStripeOn,ccSurchargeEnabled:!!(S.ccSurchargeEnabled),ccSurchargePct:S.ccSurchargePct||3,
      isPortfolio:_pdPortfolioOn,
      portfolioPct:_pdPortfolioPct,
      portfolioTarget:5,
      portfolioYears:S.byears||0,
      portfolioOwnerName:getOwnerName()||'',
      fullPrice:_pdRawPrice,
      discountedPrice:_propFinal,
      adjustmentType:v('adj-type-hidden')||'',
      adjustmentReason:v('adj-reason-hidden')||'',
      adjustmentPct:parseInt(v('est-adj'))||0,
      yearBuilt:_pdYearBuilt,
      epaRequired:_pdEpaRequired,
      rrpFirmCertNum:(()=>{const l=(typeof licenses!=='undefined'?licenses:[]).find(x=>x.typeId==='epa_firm'&&(!x.expiryDate||x.expiryDate>=todayKey()));return l?.licenseNumber||'';})(),
      rrpRenovatorName:(()=>{const l=(typeof licenses!=='undefined'?licenses:[]).find(x=>x.typeId==='epa_renovator'&&(!x.expiryDate||x.expiryDate>=todayKey()));return l?.holderName||'';})(),
      rrpRenovatorCertNum:(()=>{const l=(typeof licenses!=='undefined'?licenses:[]).find(x=>x.typeId==='epa_renovator'&&(!x.expiryDate||x.expiryDate>=todayKey()));return l?.licenseNumber||'';})(),
      trade:getActiveTrade(),
      surfaces:getActiveTrade()==='painting'?[...estSurfaces]:[],
      state:_st,
      cancelDays:_cancelDays,
      cancelStatute:_cancelStat,
      lienStatute:(typeof STATE_LIEN!=='undefined'&&STATE_LIEN[_st])?STATE_LIEN[_st].statute:'applicable mechanic\'s lien statutes',
      bwebsite:S.bwebsite||'',
      baddr:S.baddr||'',
    };
    // Set signing info BEFORE hub upload so snapshot captures correct signHubUrl
    const _bidForHub=bids.find(b=>b.id===bidId);
    if(_bidForHub){
      _bidForHub.signingKey=proposalKey;
      // Promote draft → Pending immediately so clearEstFullDraft() won't delete it before client signs
      if(_bidForHub.draft){_bidForHub.draft=false;_bidForHub.status='Pending';if(!_bidForHub.followup)_bidForHub.followup=addDays(todayKey(),7);}
    }
    _pendingSignToken={bidId,token,proposalKey};
    const baseUrl=_clientBaseUrl();
    const signingUrl=baseUrl+'sign.html?t='+token+'&u='+_effectiveUid()+'&b='+bidId;
    const dateStr=new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
    const shortUrl=await shortenUrl(signingUrl);
    // Run proposal and hub uploads in parallel, each capped at 6s
    const _hubClientId=estLinkedClientId||bids.find(b=>b.id===bidId)?.client_id;
    const[uploadResult,_hu]=await Promise.all([
      Promise.race([_supa.storage.from('proposals').upload(proposalKey,JSON.stringify(proposalData),{contentType:'application/json',upsert:true,cacheControl:'0'}),new Promise((_,rej)=>setTimeout(()=>rej(new Error('timed out')),6000))]).catch(e=>({error:e})),
      _hubClientId?Promise.race([_uploadClientHub(_hubClientId),new Promise(r=>setTimeout(r,6000,null))]).catch(()=>null):Promise.resolve(null)
    ]);
    if(uploadResult?.error)console.warn('Storage upload issue (link may still work):',uploadResult.error?.message);
    const signingDirectUrl=shortUrl;
    let shareUrl=_hu||shortUrl;
    const bar=document.getElementById('proposal-link-bar');
    const input=document.getElementById('proposal-link-input');
    const labelEl=document.getElementById('proposal-link-label');
    const sublabelEl=document.getElementById('proposal-link-sublabel');
    const shorturlEl=document.getElementById('proposal-link-shorturl');
    if(bar){
      bar.style.display='block';
      bar.dataset.signingUrl=shareUrl;
      bar.dataset.signingDirectUrl=signingDirectUrl;
      bar.dataset.cname=cname;
      bar.dataset.bname=bname;
      const c=getClientById(estLinkedClientId);
      bar.dataset.cphone=(document.getElementById('e-cphone')?.value||c?.phone||'').replace(/\D/g,'');
      bar.dataset.cemail=c?.email||'';
    }
    if(input)input.value=shareUrl;
    if(labelEl)labelEl.textContent=cname+"'s Painting Proposal";
    if(sublabelEl){
      const _sb2=bids.find(b=>b.id===bidId);
      const rounded=_sb2?.amount||(()=>{const est=calcEst();const tot=Math.max(0,est.laborTotal+est.matTotal);return Math.round(tot/25)*25||tot;})();
      sublabelEl.textContent=bname+' · '+fmt(rounded)+' · '+dateStr;
    }
    if(shorturlEl)shorturlEl.textContent=shareUrl.replace(/^https?:\/\//,'');
    const anchorEl=document.getElementById('proposal-link-anchor');if(anchorEl)anchorEl.href=shareUrl;
    // (_pendingSignToken was set before hub upload above — bid goes to "Sent" only when SMS/email is tapped)
    // Save followup date update (don't touch signingToken yet)
    const bid=bids.find(b=>b.id===bidId);
    if(bid&&!bid.followup)bid.followup=addDays(todayKey(),7);
    saveAll();
    // Reset sig-check window so any missed signatures get caught
    const _lastCheck=localStorage.getItem('zp3_last_sig_check');
    if(!_lastCheck)localStorage.setItem('zp3_last_sig_check',new Date(Date.now()-86400000*7).toISOString());
    if(btn){btn.textContent='✓ Link ready';btn.disabled=false;}
    showToast('Link ready — tap SMS or Email to send','🔗');
  }catch(e){
    console.error('sendProposalLink failed:',e);
    const msg=e.message||'Unknown error';
    if(msg.includes('Bucket not found')||msg.includes('bucket')){
      zAlert('Storage bucket not found.\n\nIn Supabase → Storage → create a bucket named "proposals" and set it to Public.',{title:'Setup required'});
    } else if(msg.includes('row-level security')||msg.includes('RLS')){
      zAlert('Permission error. Run the fix-storage-rls.sql file in your Supabase SQL editor.',{title:'Permission error'});
    } else {
      zAlert('Could not generate link: '+msg,{title:'Error'});
    }
    if(btn){btn.innerHTML='🔗 Send to client';btn.disabled=false;}
  }
}

function copyProposalLink(){
  const input=document.getElementById('proposal-link-input');
  if(!input)return;
  navigator.clipboard.writeText(input.value).catch(()=>{input.select();document.execCommand('copy');});
  const btn=document.querySelector('[onclick="copyProposalLink()"]');
  if(btn){btn.textContent='✓ Copied!';setTimeout(()=>btn.textContent='📋 Copy link',2000);}
}
function shareProposalLink(){
  const d=_proposalShareData();
  if(!d.url){showToast('Generate the link first','⚠️');return;}
  _commitProposalSent();
  pwaShare({
    title:d.bname+' Proposal',
    text:'Hi '+d.cname.split(' ')[0]+' — '+d.bname+' sent your estimate. Tap to review and approve.',
    url:d.url
  });
}
function _showGeiSendOverlay(){
  document.getElementById('_gei-send-overlay')?.remove();
  const ov=document.createElement('div');
  ov.id='_gei-send-overlay';
  ov.style.cssText='position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:20px';
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  ov.innerHTML=
    '<div style="width:100%;max-width:420px;background:var(--bg);border-radius:var(--r);padding:22px 16px 24px;box-sizing:border-box">'+
      '<div style="font-size:15px;font-weight:800;color:var(--blue-dk);margin-bottom:16px;text-align:center">✓ Link ready — send to client</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">'+
        '<button onclick="_doGeiSend(\'sms\')" class="btn" style="padding:14px;font-size:15px;font-weight:700;background:var(--blue);color:#fff;border-color:var(--blue);text-align:center;justify-content:center">📱 Text</button>'+
        '<button onclick="_doGeiSend(\'email\')" class="btn" style="padding:14px;font-size:15px;font-weight:700;background:var(--blue);color:#fff;border-color:var(--blue);text-align:center;justify-content:center">✉️ Email</button>'+
      '</div>'+
      '<button onclick="_doGeiSend(\'other\')" class="btn" style="width:100%;padding:11px;font-size:14px;font-weight:600;background:var(--bg2);color:var(--text2);border-color:var(--border2);text-align:center;justify-content:center;box-sizing:border-box">⬆️ Other app (WhatsApp, AirDrop…)</button>'+
      '<div style="font-size:11px;color:var(--text3);margin-top:10px;text-align:center">Bid saved as Pending. You\'ll get a follow-up reminder in 3 days if no response.</div>'+
    '</div>';
  document.body.appendChild(ov);
}
function _doGeiSend(type){
  document.getElementById('_gei-send-overlay')?.remove();
  if(type==='sms')sendProposalViaSms();
  else if(type==='email')sendProposalViaEmail();
  else shareProposalLink();
}
function _proposalShareData(){
  const bar=document.getElementById('proposal-link-bar');
  const defBname=S.bname||'TradeDesk';
  return bar?{url:bar.dataset.signingUrl||'',cname:bar.dataset.cname||'Client',bname:bar.dataset.bname||defBname,cphone:bar.dataset.cphone||'',cemail:bar.dataset.cemail||''}:{url:'',cname:'Client',bname:defBname,cphone:'',cemail:''};
}
// Called when user actually taps SMS or Email — THIS is when the bid moves to "Sent proposals"
function _commitProposalSent(){
  if(!_pendingSignToken)return;
  const{bidId,token,proposalKey}=_pendingSignToken;
  const bid=bids.find(b=>b.id===bidId);
  if(bid){
    bid.signingToken=token;bid.signingKey=proposalKey;
    if(bid.status==='Draft'||!bid.status)bid.status='Pending';
    bid.draft=false;
    bid.proposalSentDate=todayKey();
    if(!bid.followupStage)bid.followupStage=1;
    bid.followup=addDays(todayKey(),3);
    // Snapshot the exact proposal HTML the client will sign — required for legal record
    const proposalEl=document.getElementById('est-proposal');
    if(proposalEl&&proposalEl.innerHTML.trim())bid.proposalHtml=proposalEl.innerHTML;
    saveAll();
    // Re-upload hub now that signingToken is committed — snapshot gets correct signHubUrl
    if(bid.client_id)_uploadClientHub(bid.client_id).catch(()=>{});
  }
  _pendingSignToken=null;
  clearEstFullDraft(); // clear localStorage draft — proposal is now sent
  renderDash();
  // Navigate home so user sees the bid in "Sent proposals"
  goPg('pg-dash');
}
function sendProposalViaSms(){
  const d=_proposalShareData();
  if(!d.url){zAlert('Generate the proposal link first.',{title:'No link yet'});return;}
  if(!d.cphone){zAlert('No phone number on file for this client. Add one in Clients first.',{title:'No client phone'});return;}
  const firstName=d.cname.split(/[\s,&]+/)[0];
  const isPortfolioOn=document.getElementById('portfolio-toggle')?.checked||false;
  const ownerName=getOwnerName()||d.bname;
  const msg=isPortfolioOn
    ?'Hey '+firstName+'!\n\nGreat talking with you — your proposal is ready. Quick heads up: '+ownerName+' is building our local portfolio and has a special offer inside the proposal for you. Worth a look before you decide.\n\n'+d.url+'\n\nQuestions? Just reply. Talk soon!\n\n— '+d.bname
    :'Hey '+firstName+'!\n\nIt was great meeting with you today — really looking forward to the project.\n\nYour painting proposal is all ready to go. Tap the link below to view everything we went over and sign when you\'re ready:\n\n'+d.url+'\n\nAny questions at all, just shoot me a text. Talk soon!\n\n— '+d.bname;
  const href='sms:'+(d.cphone||'')+'?body='+encodeURIComponent(msg);
  // Fire SMS FIRST while user gesture is fresh, then commit bid as sent
  window.location.href=href;
  setTimeout(()=>_commitProposalSent(),400);
}
function sendProposalViaEmail(){
  const d=_proposalShareData();
  if(!d.url){zAlert('Generate the proposal link first.',{title:'No link yet'});return;}
  // Open compose modal — lets user review/edit subject+body and add email if missing
  _showEmailComposeModal(d);
}
// Shared compose modal — proposals use the defaults; other senders (change
// orders) pass opts {title, subject, body, clientId, onSent} to reuse the
// exact same send path (Resend edge function, same error/retry handling).
let _ecContext=null;
function _showEmailComposeModal(d,opts){
  // Remove any existing compose modal
  document.getElementById('_email-compose-overlay')?.remove();
  opts=opts||null;
  _ecContext=opts?{d,opts}:null;
  const firstName=d.cname.split(/[\s,&]+/)[0];
  const defSubject=(opts&&opts.subject)||('Your Proposal from '+d.bname+' is Ready!');
  const defBody=(opts&&opts.body)||('Hey '+firstName+',\n\nIt was great meeting with you — I\'m looking forward to your project!\n\nYour proposal is ready to view. Everything we went over is laid out in full detail, and you can sign right from the page when you\'re ready to move forward:\n\n'+d.url+'\n\nOnce you sign, I\'ll get you locked in on the schedule and we\'ll take it from there.\n\nDon\'t hesitate to reach out with any questions — happy to go over anything!\n\nLooking forward to working with you,\n'+d.bname);
  const ov=document.createElement('div');
  ov.id='_email-compose-overlay';
  ov.style.cssText='position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:20px';
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  ov.innerHTML=
    '<div style="width:100%;max-width:520px;max-height:90vh;overflow-y:auto;background:var(--bg);border-radius:var(--r);padding:20px 16px 28px;box-sizing:border-box">'+
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">'+
        '<div style="font-size:17px;font-weight:800">'+((opts&&opts.title)||'✉️ Email proposal')+'</div>'+
        '<button onclick="document.getElementById(\'_email-compose-overlay\').remove()" style="background:none;border:none;font-size:22px;color:var(--text3);cursor:pointer;padding:0 4px;font-family:inherit">✕</button>'+
      '</div>'+
      '<div style="margin-bottom:10px">'+
        '<label style="font-size:12px;font-weight:700;color:var(--text2);display:block;margin-bottom:4px">To</label>'+
        '<input id="_ec-to" type="email" value="'+escHtml(d.cemail||'')+'" placeholder="client@email.com" style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid var(--border2);border-radius:var(--r);font-size:15px;background:var(--bg2);color:var(--text);font-family:inherit">'+
      '</div>'+
      '<div style="margin-bottom:10px">'+
        '<label style="font-size:12px;font-weight:700;color:var(--text2);display:block;margin-bottom:4px">Subject</label>'+
        '<input id="_ec-subj" type="text" value="'+escHtml(defSubject)+'" style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid var(--border2);border-radius:var(--r);font-size:14px;background:var(--bg2);color:var(--text);font-family:inherit">'+
      '</div>'+
      '<div style="margin-bottom:14px">'+
        '<label style="font-size:12px;font-weight:700;color:var(--text2);display:block;margin-bottom:4px">Message</label>'+
        '<textarea id="_ec-body" rows="8" style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid var(--border2);border-radius:var(--r);font-size:13px;line-height:1.5;background:var(--bg2);color:var(--text);font-family:inherit;resize:vertical">'+escHtml(defBody)+'</textarea>'+
      '</div>'+
      '<div id="_ec-status" style="display:none;font-size:13px;color:var(--blue);margin-bottom:10px;text-align:center"></div>'+
      '<button id="_ec-send-btn" onclick="_sendEmailFromCompose()" style="width:100%;padding:14px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:16px;font-weight:800;cursor:pointer;font-family:inherit;margin-bottom:8px">Send Email →</button>'+
      '<button onclick="document.getElementById(\'_email-compose-overlay\').remove()" style="width:100%;padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:none;color:var(--text3);font-size:14px;cursor:pointer;font-family:inherit">Cancel</button>'+
    '</div>';
  document.body.appendChild(ov);
  // Focus email field if empty
  if(!d.cemail){setTimeout(()=>document.getElementById('_ec-to')?.focus(),100);}
}
async function _sendEmailFromCompose(){
  const toEl=document.getElementById('_ec-to');
  const subjEl=document.getElementById('_ec-subj');
  const bodyEl=document.getElementById('_ec-body');
  const statusEl=document.getElementById('_ec-status');
  const sendBtn=document.getElementById('_ec-send-btn');
  if(!toEl||!subjEl||!bodyEl)return;
  const toVal=(toEl.value||'').trim();
  if(!toVal||!toVal.includes('@')){zAlert('Please enter a valid email address.',{title:'Email required'});toEl.focus();return;}
  const _ctx=_ecContext;
  const d=_ctx?_ctx.d:_proposalShareData();
  if(!d.url){zAlert('Generate the proposal link first.',{title:'No link yet'});return;}
  // Save email to client record if it was missing
  const _emailClientId=(_ctx&&_ctx.opts.clientId)||estLinkedClientId;
  if(!d.cemail&&_emailClientId){
    const c=clients.find(x=>x.id===_emailClientId);
    if(c){c.email=toVal;saveAll();}
    // Also update the bar dataset so future sends work
    const bar=document.getElementById('proposal-link-bar');
    if(bar&&!_ctx)bar.dataset.cemail=toVal;
  }
  const subject=(subjEl.value||'').trim()||'Your Proposal is Ready!';
  const bodyText=(bodyEl.value||'').trim();
  if(sendBtn){sendBtn.disabled=true;sendBtn.textContent='Sending…';}
  if(statusEl){statusEl.style.display='block';statusEl.textContent='Sending…';}
  // Try server-sent email (Resend). No mailto fallback — avoids double-send confusion.
  if(supaEnabled()&&_supaUser){
    try{
      const{data:{session:_propSess}}=await _supa.auth.getSession();
      const _propToken=_propSess?.access_token||SUPA_KEY;
      const res=await Promise.race([
        fetch(SUPA_URL+'/functions/v1/send-proposal-email',{
          method:'POST',
          headers:{'Content-Type':'application/json','Authorization':'Bearer '+_propToken},
          body:JSON.stringify({to:toVal,clientName:d.cname,businessName:d.bname,proposalUrl:d.url,replyTo:_supaUser.email||'',customSubject:subject,customBody:bodyText})
        }),
        new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),15000))
      ]);
      if(res.ok){
        document.getElementById('_email-compose-overlay')?.remove();
        if(_ctx&&_ctx.opts.onSent){_ecContext=null;_ctx.opts.onSent();}
        else{_commitProposalSent();showToast('Proposal emailed to '+d.cname+'!','✉️');}
        return;
      }
      // Non-ok response — show error detail
      let errMsg='Send failed — check your internet and try again.';
      try{const ej=await res.clone().json();errMsg=ej.error||errMsg;}catch(_){}
      if(statusEl){statusEl.style.color='#A32D2D';statusEl.textContent='⚠️ '+errMsg;}
      if(sendBtn){sendBtn.disabled=false;sendBtn.textContent='Retry →';}
      return;
    }catch(err){
      const isTimeout=err?.message==='timeout';
      if(statusEl){statusEl.style.color='#A32D2D';statusEl.textContent=isTimeout?'⚠️ Request timed out — check your connection and retry.':'⚠️ Could not reach server. Check your internet connection.';}
      if(sendBtn){sendBtn.disabled=false;sendBtn.textContent='Retry →';}
      return;
    }
  }
  // No Supabase — open native mail with the composed text
  const href='mailto:'+encodeURIComponent(toVal)+'?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(bodyText);
  window.location.href=href;
  document.getElementById('_email-compose-overlay')?.remove();
  if(_ctx&&_ctx.opts.onSent){_ecContext=null;setTimeout(()=>_ctx.opts.onSent(),400);}
  else setTimeout(()=>_commitProposalSent(),400);
}
function buildDescription(){
  const isExt=estSurfaces.some(s=>s.type==='ext_walls'||s.type==='ext_trim'||s.type==='deck');
  const customerPaint=document.getElementById('e-customer-paint')?.value==='1'||false;
  const matDesc=customerPaint
    ?'All materials (tape, plastic, rollers, brushes) included in price. <strong>Paint supplied by customer — no warranty provided on finish.</strong>'
    :(isExt?'Exterior-grade paint':'Sherwin-Williams ProMar 200 interior paint')+' and all materials included in price.';

  // Build per-room data from estSurfaces
  const roomData={};
  estSurfaces.forEach(s=>{
    if(!s.qty)return;
    const t=SURF_TYPES.find(x=>x.v===s.type);
    const roomName=cleanRoomName(s.room)||'Other';
    const color=(s.room||'').split(' — ')[1]||'';
    if(!roomData[roomName])roomData[roomName]={color,surfaces:[],scopeItems:[]};
    if(color&&!roomData[roomName].color)roomData[roomName].color=color;
    const surfLabel=t?t.l:s.type;
    if(!roomData[roomName].surfaces.includes(surfLabel))roomData[roomName].surfaces.push(surfLabel);
  });

  // Add per-room scope descriptions (plain English only, no costs)
  const hasRoomScope=Object.keys(roomScopeMap).length>0&&Object.values(roomScopeMap).some(r=>Object.keys(r).length>0);
  if(hasRoomScope){
    Object.entries(roomScopeMap).forEach(([room,scope])=>{
      if(!roomData[room])return;
      Object.entries(scope).forEach(([scId,entry])=>{
        if(!entry||!entry.active)return;
        const sc=SCOPE_ITEMS.find(x=>x.id===scId);
        if(sc&&sc.clientDesc)roomData[room].scopeItems.push(sc.label);
      });
    });
  } else {
    // Job-level fallback — apply same scope to all rooms
    const activeIds=SCOPE_ITEMS.filter(sc=>scopeOn(sc.id)).map(sc=>sc.label);
    Object.keys(roomData).forEach(room=>{roomData[room].scopeItems=activeIds;});
  }

  let html='';
  const roomNames=Object.keys(roomData);

  if(roomNames.length===1){
    // Single room — simple list format
    const room=roomNames[0];
    const data=roomData[room];
    html+='<div style="margin-bottom:6px"><strong>Area:</strong> '+room+(data.color?' — '+data.color:'')+'</div>';
    html+='<div style="font-weight:700;margin-bottom:4px">Scope of work:</div>';
    html+='<ol style="margin:0 0 6px 0;padding-left:18px;line-height:2">';
    const allScope=hasRoomScope
      ?SCOPE_ITEMS.filter(sc=>{const e=roomScopeMap[room]&&roomScopeMap[room][sc.id];return e&&e.active&&sc.clientDesc;})
      :SCOPE_ITEMS.filter(sc=>scopeOn(sc.id)&&sc.clientDesc);
    allScope.forEach(sc=>{html+='<li style="padding:1px 0"><span style="color:#1a365d;font-weight:700">'+sc.label+':</span> '+sc.clientDesc+'</li>';});
    html+='<li><strong>Paint &amp; Materials:</strong> '+matDesc+'</li>';
    html+='</ol>';
  } else {
    // Multiple rooms — per-room breakdown
    html+='<div style="font-weight:700;margin-bottom:8px">Scope of work by room:</div>';
    roomNames.forEach(room=>{
      const data=roomData[room];
      const roomScope=hasRoomScope
        ?SCOPE_ITEMS.filter(sc=>{const e=roomScopeMap[room]&&roomScopeMap[room][sc.id];return e&&e.active;})
        :SCOPE_ITEMS.filter(sc=>scopeOn(sc.id));
      html+='<div style="margin-bottom:10px;padding:8px 10px;border-left:3px solid var(--blue);background:var(--bg2);border-radius:0 var(--r) var(--r) 0">'+
        '<div style="font-size:13px;font-weight:800;margin-bottom:2px">'+room+'</div>'+
        (data.color?'<div style="font-size:11px;color:var(--text3);margin-bottom:4px">Color: '+data.color+'</div>':'')+
        '<div style="font-size:11px;color:var(--text2);margin-bottom:4px">Surfaces: '+data.surfaces.join(', ')+'</div>'+
        (roomScope.length?'<div style="font-size:11px;color:var(--text2)">Work: '+roomScope.map(sc=>sc.label).join(', ')+'</div>':'')+
      '</div>';
    });
    html+='<div style="margin-top:8px;font-size:12px"><strong>Paint &amp; Materials:</strong> '+matDesc+'</div>';
  }

  if(customerPaint){
    html+='<div style="margin-top:6px;padding:8px 12px;background:#FEF3C7;border:1px solid #D97706;border-radius:6px;font-size:12px;color:#92400E"><strong>⚠ No Warranty:</strong> Customer-supplied paint. '+escHtml(S.bname||'Contractor')+' assumes no responsibility for color, coverage, or finish quality.</div>';
  }
  return html;
}
function buildProposal(){
  const{final,adj,laborTotal,matTotal,flatAdd,paintLines,coats}=calcEst();
  const adjReason=v('adj-reason-hidden');
  const bname=v('e-bname')||S.bname||'TradeDesk';
  const bnameE=escHtml(bname);
  // Legal party name used throughout the Terms & Conditions and cancellation notice.
  // Falls back to the generic "Contractor" (never "TradeDesk") when no business name is set.
  const _party=escHtml(v('e-bname')||S.bname||'Contractor');
  const bphone=v('e-bphone')||S.bphone||'';
  const blic=v('e-blic')||S.blic||'';
  const cname=v('e-cname')||'Client';
  const caddr=v('e-caddr')||'Property address';
  const cphone=v('e-cphone')||'';
  const cprop=v('e-cprop')||'';
  const valid=v('e-bvalid')||'30';
  const estDays=parseInt(v('e-days'))||2;
  const today=new Date();
  const ds=today.toLocaleDateString('en-US',{month:'numeric',day:'numeric',year:'numeric'});
  const expD=new Date(today.getTime()+(parseInt(valid)||30)*86400000).toLocaleDateString('en-US',{month:'numeric',day:'numeric',year:'numeric'});
  const estNum='EST-'+today.getFullYear()+String(today.getMonth()+1).padStart(2,'0')+String(today.getDate()).padStart(2,'0')+'-'+Math.floor(Math.random()*900+100);
  const deposit=Math.round(final*.25*100)/100;
  const balance=Math.round(final*.75*100)/100;
  const allowWeekend=document.getElementById('e-allow-weekend')?.checked||false;
  const _depositPct=(parseFloat(document.getElementById('e-deposit-pct')?.value)||0)/100;
  const _depositAmt=Math.round(final*_depositPct*100)/100;
  const _caddrVal=document.getElementById('e-caddr')?.value||'';
  const _addrStateM=_caddrVal.toUpperCase().match(/\b(AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/);
  const _st=(_addrStateM?_addrStateM[1]:null)||S?.state||'KS';
  const _cancelRule=(typeof STATE_CANCEL!=='undefined'&&STATE_CANCEL[_st])||{days:3,statute:'16 CFR Part 429'};
  const _cancelStat=_cancelRule.statute;
  const _cancelDays=_cancelRule.days;
  const _stName=(typeof STATE_TAX!=='undefined'&&STATE_TAX[_st])?STATE_TAX[_st].name:'Your State';
  const _fcPct=(S&&S.financeChargePct!=null?parseFloat(S.financeChargePct):1.5);
  const _fcApr=Math.round(_fcPct*12*10)/10;
  const description=buildDescription();
  const matLine=matTotal+flatAdd;
  const customerPaint=document.getElementById('e-customer-paint')?.value==='1'||false;
  const _portfolioOn=document.getElementById('portfolio-toggle')?.checked||false;
  const _portfolioPct=parseInt(document.getElementById('portfolio-pct')?.value)||15;
  const _portfolioTarget=parseInt(document.getElementById('portfolio-target')?.value)||5;
  const _portfolioYears=S.byears||0;
  const _portfolioOwner=getOwnerName()||bname;

  // Build per-room cost rows for the proposal table
  const gR=id=>parseFloat(document.getElementById(id)?.value)||0;
  const R={walls:gR('e-r-walls')||S.rWalls||1.30,ceiling:gR('e-r-ceil')||S.rCeil||1.00,trim:gR('e-r-trim')||S.rTrim||4.00,doors:gR('e-r-door')||S.rDoor||95,windows:gR('e-r-win')||S.rWin||50,cabinets:38,ext_walls:gR('e-r-ext')||S.rExt||1.10,ext_trim:gR('e-r-trim')||S.rTrim||4.00,deck:gR('e-r-deck')||S.rDeck||1.00};
  const hasRoomScope=Object.keys(roomScopeMap).length>0&&Object.values(roomScopeMap).some(r=>Object.keys(r).length>0);

  // Aggregate surface cost per room — track per-surface colors
  const SURF_NICE_P={walls:'Walls',ceiling:'Ceiling',trim:'Trim',doors:'Doors',windows:'Windows',cabinets:'Cabinets',ext_walls:'Siding',ext_trim:'Ext Trim',deck:'Deck'};
  const roomCosts={};
  estSurfaces.forEach(s=>{
    if(!s.qty)return;
    const t=SURF_TYPES.find(x=>x.v===s.type);if(!t)return;
    const roomName=cleanRoomName(s.room)||'Other';
    const colorSpec=(s.room||'').indexOf(' — ')>-1?(s.room||'').split(' — ').slice(1).join(' — '):'';
    if(!roomCosts[roomName])roomCosts[roomName]={surfCost:0,scopeCost:0,color:'',scopeLabels:[],paintSpecs:[]};
    if(colorSpec){
      roomCosts[roomName].paintSpecs.push({surfLabel:SURF_NICE_P[s.type]||s.type,spec:colorSpec});
      if(!roomCosts[roomName].color)roomCosts[roomName].color=colorSpec;
    }
    const rate=R[s.type]||0;
    roomCosts[roomName].surfCost+=Math.round(s.qty*rate*(t.unit==='sq ft'?coats:1)*100)/100;
  });

  // Add per-room scope costs
  if(hasRoomScope){
    Object.entries(roomScopeMap).forEach(([room,scope])=>{
      if(!roomCosts[room])return;
      Object.entries(scope).forEach(([scId,entry])=>{
        if(!entry||!entry.active)return;
        const sc=SCOPE_ITEMS.find(x=>x.id===scId);
        roomCosts[room].scopeCost+=entry.cost||Math.round((entry.hrs||0)*(entry.rate||45)*100)/100;
        if(sc)roomCosts[room].scopeLabels.push(sc.label);
      });
    });
  } else {
    // Job-level scope — split evenly across rooms proportionally by surface cost
    const totalSurfCost=Object.values(roomCosts).reduce((s,r)=>s+r.surfCost,0)||1;
    const totalJobScopeCost=laborTotal-totalSurfCost;
    if(totalJobScopeCost>0){
      Object.values(roomCosts).forEach(r=>{
        r.scopeCost=Math.round(totalJobScopeCost*(r.surfCost/totalSurfCost)*100)/100;
      });
    }
  }

  // Room totals — straight labor + scope, no padding
  const roomNames=Object.keys(roomCosts);
  roomNames.forEach(room=>{
    const r=roomCosts[room];
    r.total=Math.round((r.surfCost+r.scopeCost)*100)/100;
  });

  // Property tier multiplier — applied to both labor and materials so proposal math adds up
  const _propTierMult=(typeof estPropertyTier!=='undefined'&&estPropertyTier.mult)||1.00;

  // Normalize room totals to match laborTotal * tierMult so the row totals + materials = final
  const roomTotalSum=roomNames.reduce((s,r)=>s+roomCosts[r].total,0);
  const targetLaborTotal=Math.round(laborTotal*_propTierMult*100)/100;
  if(roomTotalSum>0&&roomNames.length>0){
    const scale=targetLaborTotal/roomTotalSum;
    roomNames.forEach(room=>{roomCosts[room].total=Math.round(roomCosts[room].total*scale*100)/100;});
    // Fix rounding: add diff to last room
    const diff=Math.round((targetLaborTotal-roomNames.reduce((s,r)=>s+roomCosts[r].total,0))*100)/100;
    if(diff&&roomNames.length)roomCosts[roomNames[roomNames.length-1]].total+=diff;
  }
  // Scale materials by tier multiplier too
  const scaledMatLine=Math.round((matLine)*_propTierMult*100)/100;
  // Use final from calcEst directly — row breakdown is display only, final is authoritative
  const proposalTotal=final;
  // Sales tax — rate from client address ZIP; fall back to contractor setting only when no address
  const _stRate=_paintClientTaxRate!==null?(_paintClientTaxRate.rate??0):(parseFloat(S.salesTaxRate)||0);
  let _stTax=0,_stLabel='Sales tax',_stTreatment=null;
  if(typeof calcSalesTax==='function'&&_stRate>0&&_paintWorkScope!=='improvement'){
    const _stScope='repair';
    const _stPropType=_paintIsCommercial?'commercial':'residential';
    const _stResult=calcSalesTax({state:_st,tradeType:'painting',scope:_stScope,
      propertyType:_stPropType,taxRate:_stRate,
      lineItems:[{desc:'Painting services',total:proposalTotal,lineType:'service'}]});
    _stTreatment=_stResult.treatment;
    _stTax=(_stTreatment&&_stTreatment.customerTax)?(_stResult.taxAmount||0):0;
    if(_stTax>0){const isFull=_stTreatment?.type==='service'||_stTreatment?.laborTaxable;_stLabel='Sales tax ('+_stRate+'%'+(isFull?'':' on materials')+')';}
  }
  // HI GET / NM GRT — gross receipts tax (overrides regular sales tax)
  const _grInfo=(typeof ST_GROSS_RECEIPTS!=='undefined')?ST_GROSS_RECEIPTS[_st]:null;
  const _grRate=_grInfo?(parseFloat(S.salesTaxRate)||(typeof ST_BASE_RATE!=='undefined'?ST_BASE_RATE[_st]||0:0)):0;
  const _grTax=_grRate>0?Math.round(proposalTotal*_grRate/100*100)/100:0;
  const _grLabel=_grInfo?(_grInfo.label||'Tax'):'';
  // Use GRT if applicable, otherwise regular sales tax
  const _appliedTax=_grTax>0?_grTax:_stTax;
  const _appliedTaxLabel=_grTax>0?_grLabel:_stLabel;
  const _paintFinalTotal=proposalTotal+_appliedTax;

  // Compute per-room customer paint flags
  const anyRoomCustomerPaint=roomNames.some(r=>roomScopeMap[r]?._customerPaint===true);
  // Build table rows — one per room — showing per-room scope in description
  const roomRows=roomNames.map((room,roomIdx)=>{
    const r=roomCosts[room];
    // Per-room scope items with full client descriptions
    let roomScopeItems=[];
    if(hasRoomScope&&roomScopeMap[room]){
      roomScopeItems=SCOPE_ITEMS.filter(sc=>{
        const e=roomScopeMap[room][sc.id];return e&&e.active&&sc.clientDesc;
      });
    } else if(!hasRoomScope&&roomIdx===0){
      roomScopeItems=SCOPE_ITEMS.filter(sc=>scopeOn(sc.id)&&sc.clientDesc);
    }
    // Build per-surface paint spec — hierarchical: "Paint" header → each surface on its own row
    const paintSpecHtml=r.paintSpecs&&r.paintSpecs.length
      ?'<div style="margin-top:4px">'+
        r.paintSpecs.map(ps=>{
          const swMatch=ps.spec.match(/SW[\s-]?\d+/i);
          const swHex=swMatch&&_swColors?(_swColors.find(c=>c.sw.toLowerCase()===swMatch[0].toLowerCase().replace(/[\s-]/g,''))?.hex||''):'';
          const swatch=swHex?'<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:'+swHex+';border:1px solid rgba(0,0,0,.18);flex-shrink:0;margin-top:2px"></span>':'';
          const parts=ps.spec.split(' \xb7 ');
          const product=parts[0]||'';
          const colorFinish=parts.slice(1).join(' \xb7 ')||ps.spec;
          const finishMatch=colorFinish.match(/\[([^\]]+)\]$/);
          const finish=finishMatch?finishMatch[1]:'';
          const colorOnly=colorFinish.replace(/\s*\[[^\]]+\]$/,'').trim();
          const colorLine=[colorOnly,finish].filter(Boolean).join(', ');
          return '<div style="display:flex;align-items:flex-start;gap:6px;margin-bottom:3px">'+
            (swatch||'<span style="flex-shrink:0;width:10px"></span>')+
            '<div>'+
            '<span style="font-size:11px;font-weight:700;color:#2d3748">'+escHtml(ps.surfLabel)+'</span>'+
            (colorLine?'<span style="font-size:11px;color:#4a5568;font-weight:400"> — '+escHtml(colorLine)+'</span>':'')+
            (product?'<div style="font-size:10px;color:#94a3b8;line-height:1.2">'+escHtml(product)+'</div>':'')+
            '</div></div>';
        }).join('')+
        '</div>'
      :'';
    // Scope of Work — numbered list, all items
    const scopeHtml=roomScopeItems.length
      ?'<div style="margin-top:7px">'+
        '<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:4px">Scope of Work</div>'+
        '<ol style="margin:0;padding-left:18px;font-size:11px;color:#4a5568;line-height:1.7">'+
        roomScopeItems.map(sc=>'<li>'+escHtml(sc.clientDesc)+'</li>').join('')+
        '</ol></div>'
      :'';
    const _roomCustPaint=roomCosts[room]&&(roomScopeMap[room]?._customerPaint===true);
    const custPaintBadge=_roomCustPaint?'<span style="display:inline-block;font-size:10px;background:#FEF3C7;color:#856404;border:1px solid #D97706;border-radius:4px;padding:1px 6px;margin-left:6px;font-weight:700;vertical-align:middle">Client supplies paint</span>':'';
    const descContent='<div style="font-size:13px;font-weight:800;color:#1a365d;line-height:1.2;margin-bottom:3px">'+escHtml(room)+custPaintBadge+'</div>'+
      paintSpecHtml+
      scopeHtml;
    const rowBg=roomIdx%2===0?'#ffffff':'#f8fafc';
    return `<tr style="border-bottom:1px solid #e2e8f0;background:${rowBg}">
      <td colspan="2" style="padding:11px 18px 11px 14px;line-height:1.5;color:#2d3748;font-size:12px;border-left:3px solid #2a4a7f">${descContent}</td>
    </tr>`;
  }).join('');

  document.getElementById('est-proposal').innerHTML=`
<div class="proposal" style="background:#fff;color:#1a1a1a;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 4px 24px rgba(0,0,0,.10)">
  <div style="background:linear-gradient(135deg,#1a365d 0%,#2a4a7f 100%);color:#fff;padding:24px 28px;display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid rgba(255,255,255,.1)">
    ${_proposalBizHeader(bname,bphone,blic)}
    <div style="text-align:right;padding-top:4px">
      <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.12em;opacity:.9;margin-bottom:8px">Paint Proposal</div>
      <div style="font-size:11px;opacity:.6;margin-bottom:2px"># ${estNum}</div>
      <div style="font-size:11px;opacity:.6">Date: ${ds}</div>
    </div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid #e2e8f0">
    <div style="padding:14px 18px;border-right:1px solid #e2e8f0">
      <div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;margin-bottom:6px">Customer</div>
      <div style="font-size:14px;font-weight:700;color:#1a365d">${escHtml(cname)}</div>
      ${caddr?`<div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;margin-top:7px">Address</div><div style="font-size:12px;color:#4a5568;margin-top:1px">${escHtml(caddr)}</div>`:''}
      ${cphone?`<div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;margin-top:7px">Phone</div><div style="font-size:12px;color:#4a5568;margin-top:1px">${escHtml(cphone)}</div>`:''}
    </div>
    <div style="padding:14px 18px">
      <div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;margin-bottom:6px">Project</div>
      <div style="font-size:13px;font-weight:600;color:#1a365d">${escHtml(cprop||'House')}</div>
      <div style="font-size:11px;color:#718096;margin-top:6px">Est. duration: ${estDays} day${estDays!==1?'s':''}</div>
      ${allowWeekend?'<div style="font-size:11px;color:#718096;margin-top:3px">⚬ Weekends available</div>':''}
      <div style="font-size:11px;color:#718096;margin-top:3px">Valid until: ${expD}</div>
    </div>
  </div>
  <table style="width:100%;border-collapse:collapse;font-size:12px">
    <thead>
      <tr style="background:#f1f5f9;border-bottom:2px solid #e2e8f0">
        <th style="padding:9px 18px;text-align:left;font-weight:800;text-transform:uppercase;color:#64748b;font-size:9px;letter-spacing:.08em">Description</th>
        <th style="padding:9px 18px 9px 4px;text-align:right;font-weight:800;text-transform:uppercase;color:#64748b;width:90px;font-size:9px;letter-spacing:.08em;white-space:nowrap">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${roomRows}
      <tr style="border-bottom:1px solid #e2e8f0;background:#fafbfc">
        <td style="padding:11px 18px;font-size:12px;color:#2d3748">
          <strong>${anyRoomCustomerPaint?'Paint, Primer &amp; Materials (partial)':(customerPaint?'Prep &amp; Application Supplies':'Paint, Primer &amp; Materials')}</strong><br>
          <span style="font-size:11px;color:#718096">${anyRoomCustomerPaint?'Includes all paint, primer, and supplies for contractor-painted rooms. For rooms where client supplies paint: all prep supplies and application labor included. No warranty on finish quality for client-supplied paint.':customerPaint?'All prep supplies, tape, plastic sheeting, rollers, brushes, and drop cloths included. Paint to be supplied by client prior to start date. No warranty on finish quality.':'Includes paint, primer, tape, plastic sheeting, rollers, brushes, drop cloths and all supplies needed to complete the job.'}</span>
        </td>
        <td style="padding:11px 18px 11px 4px;text-align:right;font-weight:700;vertical-align:top;white-space:nowrap;color:#2d3748">${fmt(scaledMatLine)}</td>
      </tr>
      ${adj?`<tr style="border-bottom:1px solid #e2e8f0"><td style="padding:9px 18px;color:#718096;font-style:italic">${escHtml(adjReason||'Price adjustment')}</td><td style="padding:9px 18px;text-align:right;color:#718096">${adj>0?'+':''}${fmt(adj)}</td></tr>`:''}
    </tbody>
    <tfoot>
      ${_paintWorkScope==='improvement'?`<tr style="border-bottom:1px solid #e2e8f0;background:#f8fafc"><td style="padding:8px 18px;font-size:12px;color:#64748b">Sales tax — capital improvement (contractor pays, not client)</td><td style="padding:8px 18px;text-align:right;font-size:12px;color:#64748b">$0.00</td></tr>`:''}
      ${_appliedTax>0?`<tr style="border-bottom:1px solid #e2e8f0;background:#f8fafc"><td style="padding:8px 18px;font-size:12px;color:#64748b">${_appliedTaxLabel}</td><td style="padding:8px 18px;text-align:right;font-size:12px;color:#64748b">${fmt(_appliedTax)}</td></tr>`:''}
      <tr style="background:#1a365d;color:#fff">
        <td style="padding:13px 18px;text-align:left;font-weight:800;font-size:15px;letter-spacing:.02em">TOTAL</td>
        <td style="padding:13px 18px;text-align:right;font-weight:800;font-size:15px">${fmt(_paintFinalTotal)}</td>
      </tr>
      ${_depositPct>0?`<tr style="background:#2a4a7f;color:rgba(255,255,255,.88)"><td style="padding:7px 18px;font-size:11px;font-weight:600">${Math.round(_depositPct*100)}% Deposit Due Before Work Begins</td><td style="padding:7px 18px;text-align:right;font-size:12px;font-weight:700">${fmt(_depositAmt)}</td></tr>`:''}
    </tfoot>
  </table>
  ${estSurfaces.some(s=>s.type==='ext_walls'||s.type==='ext_trim'||s.type==='deck')?`<div style="padding:10px 16px;background:#FEF3C7;border-top:1px solid #D97706;border-bottom:1px solid #D97706">
    <div style="font-size:10px;font-weight:800;text-transform:uppercase;color:#92400E;margin-bottom:4px">⚠ Weather Notice — Exterior Work</div>
    <div style="font-size:11px;color:#92400E;line-height:1.7">Exterior painting is weather-dependent. Start dates and completion timelines may shift based on temperature, rain, or high winds. Paint will not be applied to wet or damp surfaces. If surfaces were pressure washed, a minimum 48-hour dry time is required before painting begins. ${escHtml(getBusinessName())} will communicate any weather-related delays promptly and reschedule at the earliest suitable date at no additional charge.</div>
  </div>`:''}
  ${_portfolioOn?`<div style="margin:0 0 0;border-top:3px solid #16a34a;background:#f0fdf4;padding:18px 24px">
    <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#16a34a;margin-bottom:8px">Portfolio Showcase Offer</div>
    <div style="font-size:12px;color:#166534;line-height:1.7">We are currently selecting a limited number of showcase homes to feature across our Social Media. Your home has been selected. In exchange for permission to photograph your home before and after completion and feature it across our platforms, we are offering ${_portfolioPct}% off this project. No personal information is shared without your explicit permission.</div>
    <div style="margin-top:8px;font-size:11px;color:#16a34a;font-weight:700">Portfolio discount applied: ${_portfolioPct}% · You save ${fmt(Math.round(final*_portfolioPct/(100-_portfolioPct)))}</div>
  </div>`:''}
  <div style="padding:18px 24px;border-top:1px solid #e2e8f0;background:#f8fafc">
    <div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#1a365d;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid #e2e8f0">Terms &amp; Conditions</div>
    <div style="font-size:10.5px;color:#4a5568;line-height:1.85">
      ${_depositPct===0?'<p style="margin:0 0 7px"><strong>1. Payment:</strong> Full balance due upon completion. No deposit required.</p>':'<p style="margin:0 0 7px"><strong>1. Payment:</strong> A '+Math.round(_depositPct*100)+'% deposit ('+fmt(_depositAmt)+') is required before any work begins and before a start date will be scheduled. The remaining balance is due upon completion of work.</p>'}
      <p style="margin:0 0 9px"><strong>2. Cancellation &amp; Deposits:</strong> Buyer may cancel this transaction within ${_cancelDays} business days of signing (${_cancelStat}) for a full refund of any deposit. After that period, if Buyer cancels or fails to proceed, the deposit is retained as liquidated damages to compensate for: (a) <em>Mobilization &amp; Scheduling</em> — reserving crew availability and declining other projects for the contracted dates; (b) <em>Administrative Costs</em> — time invested in site measurements, color consulting, and preparation of this written scope; and (c) <em>Material Procurement</em> — sourcing specific paint colors and materials that may not be returnable or transferable to other jobs. These represent a reasonable good-faith estimate of actual damages, not a penalty. ${bname}'s right to retain the deposit is conditioned on ${bname}'s readiness and willingness to perform. If ${bname} fails to substantially complete the agreed scope of work through no fault of Buyer, the deposit shall be refunded in full. The deposit does not compensate for work not performed.</p>
      <p style="margin:0 0 7px"><strong>3. Change Orders:</strong> This proposal covers only the scope described herein. Any additional work, surfaces, or materials not listed require a written change order approved and signed by the client and may be billed at the current rate.</p>
      <p style="margin:0 0 7px"><strong>4. Limitation of Liability:</strong> ${_party} is not responsible for damage to surfaces, structures, or contents that existed prior to the start of work, or for conditions not disclosed at the time of walkthrough. Client assumes all risk associated with pressure washing services on their property.</p>
      <p style="margin:0 0 7px"><strong>5. ${_grTax>0?_grLabel+':':' Materials &amp; Sales Tax:'}</strong> ${_grTax>0?`${_grLabel} of ${_grRate}% is charged on the full contract value and is itemized separately on this proposal. Client is responsible for this amount.`:`${_party} purchases all materials and pays applicable sales tax at the point of purchase. Sales tax on materials is incorporated into the project price and is not itemized separately on this proposal.`}</p>
      <p style="margin:0 0 7px"><strong>6. Mechanic's Lien Notice:</strong> ${_lienNotice(_st,_party)}</p>
      <p style="margin:0 0 7px"><strong>7. Finance Charges:</strong> Unpaid balances remaining 30 days after job completion are subject to a finance charge of ${_fcPct}% per month (${_fcApr}% APR) on the outstanding balance, accruing monthly until paid in full. Finance charges will appear as a separate line item on the client account.</p>
      <p style="margin:0 0 7px"><strong>8. Workmanship Warranty:</strong> ${_party} warrants workmanship against peeling, cracking, and finish defects for ${S?.warrantyPeriod||'1 year'} from substantial completion, provided surfaces were in sound condition and properly disclosed prior to work. Client-supplied paint carries no workmanship warranty on finish quality. Manufacturer warranties on materials pass through to Buyer.</p>
      <p style="margin:0 0 7px"><strong>9. Permits &amp; Inspections:</strong> If permits or inspections are required for this scope of work, ${_party} will obtain them in accordance with applicable local ordinances and codes. Any permit fees not included in this proposal will be billed at cost with prior Buyer approval.</p>
      <p style="margin:0 0 7px"><strong>10. Schedule &amp; Delays:</strong> Completion dates are good-faith estimates and may be extended due to weather, material availability, cure times, or other circumstances beyond ${_party}'s reasonable control. ${_party} will provide timely notice of any material delay.</p>
      <p style="margin:0 0 7px"><strong>11. Insurance:</strong> ${_party} maintains general liability insurance and, where required by law, workers' compensation insurance. A certificate of insurance will be provided to Buyer upon written request prior to commencement of work.</p>
      <p style="margin:0 0 7px"><strong>12. Dispute Resolution:</strong> In the event of a dispute, both parties agree to attempt good-faith negotiation before pursuing arbitration or litigation. The prevailing party in any legal proceeding to enforce this agreement shall be entitled to recover reasonable attorney's fees and costs, to the extent permitted by law.</p>
      <p style="margin:0">By signing, client acknowledges receipt of the Notice of Cancellation form below, full agreement with all scope, pricing, and terms, and that this constitutes a legally binding electronic agreement under applicable state and federal electronic transaction law (15 U.S.C. §7001 et seq.).</p>
    </div>
  </div>
  <div style="padding:16px 24px;border-top:2px dashed #94a3b8;background:#fff">
    <div style="text-align:center;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.14em;color:#94a3b8;margin-bottom:10px;border-bottom:1px dashed #cbd5e1;padding-bottom:8px">✂ Detach &amp; Retain — Notice of Cancellation (${_cancelStat})</div>
    <div style="text-align:center;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#1a365d;margin-bottom:12px">NOTICE OF CANCELLATION</div>
    <div style="font-size:10.5px;color:#2d3748;line-height:1.8">
      <p style="margin:0 0 8px"><strong>Date of Transaction:</strong> ${ds}</p>
      <p style="margin:0 0 10px;font-weight:800;font-size:11px">YOU MAY CANCEL THIS TRANSACTION, WITHOUT ANY PENALTY OR OBLIGATION, WITHIN THREE BUSINESS DAYS FROM THE ABOVE DATE.</p>
      <p style="margin:0 0 8px">If you cancel, any payments made by you under this contract will be returned within 10 business days following receipt by ${_party} of your cancellation notice, and any security interest arising out of this transaction will be cancelled.</p>
      <p style="margin:0 0 8px">To cancel this transaction, deliver or mail a signed and dated copy of this cancellation notice or any other written notice to:</p>
      <p style="margin:0 0 12px;font-weight:700">${bname}${S.baddr?' &nbsp;·&nbsp; '+S.baddr:''}${bphone?' &nbsp;·&nbsp; '+bphone:''}</p>
      <p style="margin:0 0 20px">I hereby cancel this transaction.</p>
      <p style="margin:0 0 4px;border-top:1px solid #e2e8f0;padding-top:14px">Buyer&apos;s Signature: ___________________________ &nbsp;&nbsp;&nbsp; Date: _______________</p>
    </div>
  </div>
</div>`;
  const _sigDepPct=Math.round(_depositPct*100);
  const _sigBal=Math.round((_paintFinalTotal-_depositAmt)*100)/100;
  document.getElementById('est-sig-sum').innerHTML=
    `<div style="margin-bottom:10px"><div style="font-size:15px;font-weight:700">${escHtml(cname)}</div>${caddr?'<div style="font-size:12px;color:var(--text2);margin-top:2px">'+escHtml(caddr)+'</div>':''}</div>`+
    `<div style="background:var(--bg2);border-radius:var(--r);padding:10px 12px;display:grid;gap:4px">`+
      `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border)"><span style="font-size:12px;color:var(--text2)">Contract total</span><strong style="font-size:14px;color:var(--blue)">${fmt(_paintFinalTotal)}</strong></div>`+
      (_depositPct>0
        ?`<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border)"><span style="font-size:12px;color:var(--text2)">Deposit due (${_sigDepPct}%)</span><strong style="font-size:13px;color:var(--green)">${fmt(_depositAmt)}</strong></div>`+
          `<div style="display:flex;justify-content:space-between;padding:4px 0"><span style="font-size:12px;color:var(--text2)">Balance on completion</span><strong style="font-size:13px">${fmt(_sigBal)}</strong></div>`
        :`<div style="display:flex;justify-content:space-between;padding:4px 0"><span style="font-size:12px;color:var(--text2)">Due on completion</span><strong style="font-size:13px">${fmt(_paintFinalTotal)}</strong></div>`)+
    `</div>`;
  document.getElementById('est-terms').innerHTML='<div style="background:#FEF3C7;border-left:3px solid #92400E;padding:8px 10px;margin-bottom:10px;font-size:10px;font-weight:700;color:#92400E">⚠ '+_stName+' / FTC Notice: Buyer may cancel within '+_cancelDays+' business days of signing ('+_cancelStat+'). See Notice of Cancellation on signed proposal.</div><strong style="color:#1a365d">Terms &amp; Conditions</strong><br><br>1. <strong>Payment:</strong> '+(_depositPct===0?'Full balance due upon completion. No deposit required.':Math.round(_depositPct*100)+'% deposit ('+fmt(_depositAmt)+') required before any work begins and before a start date will be scheduled. The remaining balance is due upon completion of work.')+'<br><br>2. <strong>Cancellation &amp; Deposits:</strong> Buyer may cancel within '+_cancelDays+' business days of signing ('+_cancelStat+') for a full refund of any deposit. After that period, if Buyer cancels or fails to proceed, the deposit is retained as liquidated damages covering: (a) mobilization &amp; scheduling costs — crew reservation and declined projects for those dates; (b) administrative costs — site measurements, color consulting, scope preparation; and (c) material procurement — specific paint colors and supplies that may not be returnable. These represent a reasonable estimate of actual damages, not a penalty. Materials purchased will be made available for pickup upon cancellation. '+bnameE+'\'s right to retain the deposit is conditioned on '+bnameE+'\'s readiness and willingness to perform. If '+bnameE+' fails to substantially complete the agreed scope of work through no fault of Buyer, the deposit shall be refunded in full. The deposit does not compensate for work not performed.<br><br>3. <strong>Change Orders:</strong> This proposal covers only the scope described herein. Any additional work, surfaces, or materials not listed require a written change order approved and signed by the client and may be billed at the current rate.<br><br>4. <strong>Limitation of Liability:</strong> '+_party+' is not responsible for damage to surfaces, structures, or contents that existed prior to the start of work, or for conditions not disclosed at the time of walkthrough. Client assumes all risk associated with pressure washing services on their property.<br><br>5. <strong>Materials &amp; Sales Tax:</strong> '+_party+' purchases all materials and pays applicable '+_stName+' sales tax at the point of purchase. Sales tax on materials is incorporated into the project price and is not itemized separately on this proposal.<br><br>6. <strong>Mechanic\'s Lien Notice:</strong> '+_lienNotice(_st,_party)+' '+_party+' will pursue all available legal remedies for non-payment, including lien filing.<br><br>7. <strong>Finance Charges:</strong> Unpaid balances remaining 30 days after job completion are subject to a finance charge of '+_fcPct+'% per month ('+_fcApr+'% APR) on the outstanding balance, accruing monthly until paid in full. Finance charges will appear as a separate line item on the client account.<br><br>By signing below, client acknowledges receipt of the Notice of Cancellation, full agreement with all scope, pricing, and terms, and that this constitutes a legally binding electronic agreement under applicable state and federal electronic transaction law (15 U.S.C. §7001 et seq.)';
  document.getElementById('sig-date').value=ds;
  document.getElementById('sig-pname').value=cname;
  initSigPad();
}
function initSigPad(){sigCanvas=document.getElementById('sig-canvas');if(!sigCanvas)return;const dpr=window.devicePixelRatio||1,w=sigCanvas.offsetWidth||window.innerWidth-56;sigCanvas.width=w*dpr;sigCanvas.height=140*dpr;sigCanvas.style.width=w+'px';sigCanvas.style.height='140px';sigCtx=sigCanvas&&sigCanvas.getContext?sigCanvas.getContext('2d'):null;if(!sigCtx)return;sigCtx.scale(dpr,dpr);sigCtx.strokeStyle='#185FA5';sigCtx.lineWidth=2.5;sigCtx.lineCap='round';sigCtx.lineJoin='round';const gp=e=>{const r=sigCanvas.getBoundingClientRect(),s=e.touches?e.touches[0]:e;return{x:s.clientX-r.left,y:s.clientY-r.top};};sigCanvas.onmousedown=sigCanvas.ontouchstart=e=>{e.preventDefault();isSigning=true;const p=gp(e);sigCtx.beginPath();sigCtx.moveTo(p.x,p.y);};sigCanvas.onmousemove=sigCanvas.ontouchmove=e=>{e.preventDefault();if(!isSigning)return;const p=gp(e);sigCtx.lineTo(p.x,p.y);sigCtx.stroke();};sigCanvas.onmouseup=sigCanvas.ontouchend=()=>{isSigning=false;checkConfirmReady();};}
function initEstNotesCanvas(){
  const c=document.getElementById('est-notes-canvas');if(!c||c._init)return;c._init=true;
  const dpr=window.devicePixelRatio||1,w=c.offsetWidth||300;
  c.width=w*dpr;c.height=180*dpr;c.style.width=w+'px';c.style.height='180px';
  const ctx=c.getContext('2d');ctx.scale(dpr,dpr);
  ctx.strokeStyle='#1a1a1a';ctx.lineWidth=2;ctx.lineCap='round';ctx.lineJoin='round';
  let dn=false;
  const pt=e=>{const br=c.getBoundingClientRect(),s=e.touches?e.touches[0]:e;return{x:s.clientX-br.left,y:s.clientY-br.top};};
  c.onmousedown=c.ontouchstart=e=>{e.preventDefault();dn=true;const p=pt(e);ctx.beginPath();ctx.moveTo(p.x,p.y);};
  c.onmousemove=c.ontouchmove=e=>{e.preventDefault();if(!dn)return;const p=pt(e);ctx.lineTo(p.x,p.y);ctx.stroke();};
  c.onmouseup=c.ontouchend=()=>dn=false;
}
function clearSig(){if(sigCtx&&sigCanvas){const d=window.devicePixelRatio||1;sigCtx.clearRect(0,0,sigCanvas.width/d,sigCanvas.height/d);checkConfirmReady();}}
function updateTypedSig(){
  const val=document.getElementById('sig-typed')?.value||'';
  const prev=document.getElementById('sig-typed-preview');
  if(prev)prev.textContent=val;
  checkConfirmReady();
}
function markEstSigned(){
  const bidId=lastCreatedBidId||editingBidId;
  if(bidId){
    const b=bids.find(x=>x.id===bidId);
    if(b){
      // Snapshot proposal HTML on in-person signing too (if not already saved from send step)
      if(!b.proposalHtml){const proposalEl=document.getElementById('est-proposal');if(proposalEl&&proposalEl.innerHTML.trim())b.proposalHtml=proposalEl.innerHTML;}
      b.signedAt=new Date().toISOString();
      b.estStatus='signed';
      b.status='Closed Won'; // ← was missing: must be Closed Won to leave home page + trigger schedule
      b.draft=false;
      const clientId=b.client_id;
      const clientName=b.client_name||b.name||'Client';
      saveAll();
      renderDash();
      // Queue schedule alert — same flow as remote signing
      const existing=JSON.parse(localStorage.getItem('zp3_schedule_alerts')||'[]');
      existing.push({name:clientName,bidId:b.id,clientId,isPaid:false});
      localStorage.setItem('zp3_schedule_alerts',JSON.stringify(existing));
      setTimeout(showScheduleAlerts,600);
    }
  }
  const bar=document.getElementById('est-sent-bar');
  if(bar)bar.innerHTML='<div style="font-size:12px;color:var(--green);font-weight:700">✓ Signed — scheduling prompt will open</div>';
  setTimeout(()=>goEstStep(6),800);
}
function checkConfirmReady(){
  const btn=document.getElementById('confirm-btn');
  if(!btn)return;
  const nameOk=(document.getElementById('sig-pname')||{}).value?.trim().length>0;
  const typedOk=(document.getElementById('sig-typed')||{}).value?.trim().length>2;
  const sigOk=typedOk||hasSignature();
  const ready=nameOk&&sigOk;
  btn.disabled=!ready;
  if(ready){
    btn.style.background='var(--green)';
    btn.style.color='#fff';
    btn.style.borderColor='var(--green)';
    btn.style.cursor='pointer';
  } else {
    btn.style.background='var(--bg2)';
    btn.style.color='var(--text3)';
    btn.style.borderColor='var(--border2)';
    btn.style.cursor='not-allowed';
  }
}
function hasSignature(){
  if(!sigCanvas||!sigCtx)return false;
  const dpr=window.devicePixelRatio||1;
  const w=Math.floor(sigCanvas.width),h=Math.floor(sigCanvas.height);
  try{
    const data=sigCtx.getImageData(0,0,w,h).data;
    for(let i=3;i<data.length;i+=4){if(data[i]>10)return true;}
  }catch(e){}
  return false;
}
function confirmContract(){
  if(_submitting)return;
  const pname=v('sig-pname')||(document.getElementById('sig-typed')?.value?.trim())||'';
  if(!pname){zAlert('Please enter the client\'s printed name.',{title:'Name required'});return;}
  const typedSig=(document.getElementById('sig-typed')||{}).value?.trim()||'';
if(!hasSignature()&&typedSig.length<=2){zAlert('Please type your name or draw your signature above.',{title:'Signature required'});return;}
  const{final}=calcEst();const cname=v('e-cname')||'Client';
  document.getElementById('est-done-msg').textContent='Signed by '+pname+'. Job is closed.';
  const _doneDepPct=(parseFloat(document.getElementById('e-deposit-pct')?.value)||0)/100;
  const _doneDepAmt=Math.round(final*_doneDepPct*100)/100;
  const _doneBal=Math.round((final-_doneDepAmt)*100)/100;
  document.getElementById('est-done-sum').innerHTML=`<div style="display:grid;gap:6px;font-size:13px"><div style="display:flex;justify-content:space-between"><span style="color:var(--text2)">Client</span><strong>${escHtml(cname)}</strong></div><div style="display:flex;justify-content:space-between"><span style="color:var(--text2)">Contract total</span><strong style="color:var(--blue)">${fmt(final)}</strong></div>${_doneDepPct>0?'<div style="display:flex;justify-content:space-between"><span style="color:var(--text2)">Deposit due ('+Math.round(_doneDepPct*100)+'%)</span><strong style="color:var(--green)">'+fmt(_doneDepAmt)+'</strong></div>':'<div style="display:flex;justify-content:space-between"><span style="color:var(--text2)">No deposit required</span><strong style="color:var(--text3)">—</strong></div>'}<div style="display:flex;justify-content:space-between"><span style="color:var(--text2)">Balance on completion</span><strong>${fmt(_doneDepPct>0?_doneBal:final)}</strong></div></div>`;
  if(!estLinkedClientId){
    zAlert('No client linked to this estimate. Go back to step 1 and make sure a client is selected.',{title:'Client required'});return;
  }
  if(estLinkedClientId){
    const c=getClientById(estLinkedClientId);
    const days=parseInt(v('e-days'))||2;
    const ss={}; SCOPE_ITEMS.forEach(s=>{ss[s.id]=!!scopeOn(s.id)||(Object.values(roomScopeMap).some(r=>r[s.id]&&r[s.id].active));});
    const savedRoomScopeMap=JSON.parse(JSON.stringify(roomScopeMap));
    if(editingBidId){
      const b=bids.find(x=>x.id===editingBidId);
      if(b){
        b.amount=final;b.deposit=Math.round(final*((parseFloat(document.getElementById('e-deposit-pct')?.value)||0)/100)*100)/100;b.days=days;b.status='Closed Won';b.draft=false;
        b.notes=v('e-cnotes');b.addr=v('e-caddr');
        b.name=cname;b.phone=v('e-cphone');
        b.scope=ss;b.roomScopeMap=savedRoomScopeMap;b.surfaces=[...estSurfaces];
        b.type=getBidIncomeLabel({surfaces:estSurfaces});
        b.cond=v('e-cond');b.paint=v('e-paint');
        b.allowWeekend=document.getElementById('e-allow-weekend')?.checked||false;
        b.isPortfolio=document.getElementById('portfolio-toggle')?.checked||false;
        b.portfolioPct=parseInt(document.getElementById('portfolio-pct')?.value)||15;
        b.adjustmentType=v('adj-type-hidden')||'';b.adjustmentReason=v('adj-reason-hidden')||'';b.adjustmentPct=parseInt(v('est-adj'))||0;
      }
      editingBidId=null;
    } else {
      // Update the draft bid that was created when estimate opened
      const draft=lastCreatedBidId?bids.find(x=>x.id===lastCreatedBidId&&x.draft):null;
      if(draft){
        draft.amount=final;draft.days=days;draft.status='Closed Won';draft.draft=false;
        draft.followup='';draft.notes=v('e-cnotes');draft.addr=v('e-caddr');
        draft.name=cname;draft.phone=v('e-cphone');
        draft.scope=ss;draft.roomScopeMap=savedRoomScopeMap;draft.surfaces=[...estSurfaces];
        draft.type=getBidIncomeLabel({surfaces:estSurfaces});
        draft.cond=v('e-cond');draft.paint=v('e-paint');
        draft.completion_date='';draft.collStage='none';
        draft.allowWeekend=document.getElementById('e-allow-weekend')?.checked||false;
        draft.deposit=Math.round(final*((parseFloat(document.getElementById('e-deposit-pct')?.value)||0)/100)*100)/100;
        draft.isPortfolio=document.getElementById('portfolio-toggle')?.checked||false;
        draft.portfolioPct=parseInt(document.getElementById('portfolio-pct')?.value)||15;
        draft.adjustmentType=v('adj-type-hidden')||'';draft.adjustmentReason=v('adj-reason-hidden')||'';draft.adjustmentPct=parseInt(v('est-adj'))||0;
      } else {
        // Fallback: no draft found, create fresh
        const exists=bids.find(b=>b.client_id===estLinkedClientId&&Math.abs(b.amount-final)<0.01&&b.bid_date===todayKey()&&b.status==='Pending');
        if(exists){exists.status='Closed Won';exists.notes=(exists.notes||'')+' Signed in person '+todayKey();lastCreatedBidId=exists.id;}
        else{const _newBidWeekendEl=document.getElementById('e-allow-weekend');const _newBidWeekend=_newBidWeekendEl?_newBidWeekendEl.checked||false:false;const newBid={id:_newBidId(),client_id:estLinkedClientId,client_name:c?c.name:'',name:cname,phone:v('e-cphone'),addr:v('e-caddr'),bid_date:todayKey(),followup:'',amount:final,type:getBidIncomeLabel({surfaces:estSurfaces}),days,status:'Closed Won',notes:v('e-cnotes'),completion_date:'',scope:ss,surfaces:[...estSurfaces],cond:v('e-cond'),paint:v('e-paint'),colors:v('e-colors'),allowWeekend:_newBidWeekend};bids.unshift(newBid);lastCreatedBidId=newBid.id;}
      }
    }
    _submitting=true;setTimeout(()=>{_submitting=false;},2000);
    saveAll();
  }
  clearSurfDraft();
  // Save bid ID before clearEstFullDraft nulls it
  const _finalBidId=lastCreatedBidId||editingBidId;
  clearEstFullDraft();
  // Restore so step 7 deposit button can find the bid
  if(_finalBidId)lastCreatedBidId=_finalBidId;
  // Write to signed_proposals + refresh hub so the client hub shows the signed agreement.
  // Runs in background — UI advances to step 7 immediately.
  if(_finalBidId&&supaEnabled()&&_supaUser){(async()=>{
    const _ipBid=bids.find(b=>b.id===_finalBidId);
    if(!_ipBid||!_ipBid.client_id)return;
    const _ipTyped=document.getElementById('sig-typed')?.value?.trim()||'';
    let _ipSig='';
    if(sigCanvas){
      if(hasSignature()){_ipSig=sigCanvas.toDataURL('image/png');}
      else if(_ipTyped){
        const _tc=document.createElement('canvas');_tc.width=400;_tc.height=100;
        const _tx=_tc.getContext('2d');_tx.font='46px "Dancing Script",cursive';
        _tx.fillStyle='#1a1a18';_tx.textAlign='center';_tx.textBaseline='middle';
        _tx.fillText(_ipTyped,200,50);_ipSig=_tc.toDataURL('image/png');
      }
    }
    const _ipRow={bid_id:String(_finalBidId),contractor_user_id:_supaUser.id,
      client_name:_ipBid.client_name||cname,client_signed_name:pname||_ipTyped,
      signed_at:_ipBid.signedAt||new Date().toISOString(),signature_data:_ipSig,
      payment_status:'pending',deposit:_ipBid.deposit||0,amount:_ipBid.amount||0};
    try{
      const{data:rows}=await _supa.from('signed_proposals').select('id')
        .eq('bid_id',String(_finalBidId)).eq('contractor_user_id',_supaUser.id).limit(1);
      if(rows&&rows[0])await _supa.from('signed_proposals').update(_ipRow).eq('id',rows[0].id);
      else await _supa.from('signed_proposals').insert(_ipRow);
      _uploadClientHub(_ipBid.client_id).catch(()=>{});
    }catch(e){console.warn('in-person sign save:',e);}
  })();}
  goEstStep(7);
}
function goBackToClient(){
  editingBidId=null;
  if(window._fromDash){goPg('pg-dash');return;}
  if(estLinkedClientId){openClientDetail(estLinkedClientId);}
  else{goPg('pg-clients');}
}
function goToDepositFromEstimate(){
  editingBidId=null;
  const bidId=lastCreatedBidId;
  const wonBid=bidId?bids.find(b=>b.id===bidId):null;
  if(!wonBid){
    // Fallback — go to client and let them find the bid
    if(estLinkedClientId)openClientDetail(estLinkedClientId,window._fromDash);
    else goPg('pg-clients');
    return;
  }
  // Open pay panel directly — no need to navigate anywhere first
  openPayPanel(wonBid.id,'deposit');
}
function schedJobFromEstimate(){
  editingBidId=null;
  if(!estLinkedClientId){goPg('pg-schedule');return;}
  const bidId=lastCreatedBidId;
  const wonBid=bidId?bids.find(b=>b.id===bidId):null;
  if(wonBid){schedFromBid(wonBid.id);}
  else{openClientDetail(estLinkedClientId,window._fromDash);}
}
function _onEstPropTypeChange(sel){
  const banner=document.getElementById('_est-industrial-banner');
  if(banner)banner.style.display=(sel.value==='Commercial')?'block':'none';
}
function clearEstimatorForm(){
  _pendingSignToken=null; // never let a stale token carry into the next estimate
  // Flush roomScopeMap + surfaces to the bid BEFORE clearing editingBidId.
  // The 1.5s autosave debounce fires after clearEstimatorForm nulls editingBidId
  // and empties e-cname, so _paintEstAutosave returns early — this is the only
  // reliable save point when the user navigates away mid-estimate.
  if(editingBidId&&estSurfaces.length){
    const _eb=bids.find(x=>x.id===editingBidId);
    if(_eb){
      _eb.roomScopeMap=JSON.parse(JSON.stringify(roomScopeMap||{}));
      _eb.surfaces=[...estSurfaces];
      _eb.updated=Date.now();
      saveAll();
    }
  }
  // Delete any unfinished Draft bid BEFORE nulling lastCreatedBidId
  // (saveAndExitEstimate already removes b.draft before calling this, so saved bids are safe)
  if(lastCreatedBidId){
    const orphanIdx=bids.findIndex(b=>b.id===lastCreatedBidId&&b.draft===true&&b.status!=='Pending');
    // Wrap so the removed draft bid's id is recorded as a local delete and the sweep
    // propagates it (harmless no-op if the draft never reached the cloud).
    if(orphanIdx>-1){_userDelete(()=>{bids.splice(orphanIdx,1);saveAll();});}
  }
  _paintIsCommercial=false;_paintWorkScope='repair';_paintClientTaxRate=null;
  _rrpPaintAnswer='';
  estSurfaces=[];estSurfId=0;estLinkedClientId=null;editingBidId=null;lastCreatedBidId=null;
  scopeActiveMap={};scopeHrsStore={};roomScopeMap={};
  estPropertyTier={key:'avg',mult:1.00,paint:'ProMar 200',products:{interior:'pm200',exterior:'spe',trim:'pm200t'}};
  surfRoom='';surfColor='';surfWhatSelected=[];surfBQueue=[];surfBIdx=0;surfBMeasurements={};
  _swLastProductByCategory={};
  const rnEl=document.getElementById('surf-room-name');
  if(rnEl){rnEl.value='';rnEl.style.borderColor='#A32D2D';rnEl.style.background='var(--red-lt)';}
  clearSurfDraft();clearEstFullDraft();
  ['e-cname','e-cphone','e-caddr','e-cnotes','adj-type-hidden','adj-reason-hidden'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const _arsEl=document.getElementById('adj-reason-summary');if(_arsEl)_arsEl.style.display='none';
  const adj=document.getElementById('est-adj');if(adj)adj.value=0;
  const adjV=document.getElementById('est-adj-val');if(adjV)adjV.textContent='0%';
  const _ptogClear=document.getElementById('portfolio-toggle');
  if(_ptogClear){_ptogClear.checked=false;togglePortfolioShowcase();}
  const _depPctClear=document.getElementById('e-deposit-pct');if(_depPctClear)_depPctClear.value=(typeof S!=='undefined'&&S.depositPct!=null)?S.depositPct:25;
  const _wkndClear=document.getElementById('e-allow-weekend');if(_wkndClear)_wkndClear.checked=false;
  const _pPct=document.getElementById('portfolio-pct');if(_pPct)_pPct.value=15;
  const _plb=document.getElementById('proposal-link-bar');if(_plb){_plb.style.display='none';_plb.dataset.signingUrl='';}
  const _pli=document.getElementById('proposal-link-input');if(_pli)_pli.value='';
  const _sendBtn=document.getElementById('send-proposal-btn');if(_sendBtn){_sendBtn.textContent='🔗 Send to client';_sendBtn.disabled=false;}
  scopeActiveMap={};scopeHrsStore={};roomScopeMap={};estPropertyTier={key:'avg',mult:1.00,paint:'ProMar 200'};
  SCOPE_ITEMS.forEach(s=>{const cb=document.getElementById('est-sc-'+s.id),tog=document.getElementById('est-st-'+s.id);if(cb){cb.checked=false;if(tog)tog.classList.remove('on');}});
  const ep2=document.getElementById('e-paint');if(ep2)ep2.value='';
  const ecp=document.getElementById('e-customer-paint');if(ecp)ecp.value='';
  setPaintSupply('zach'); // reset buttons to Zach supplies
  document.querySelectorAll('#paint-picker .surf-type-btn').forEach(b=>b.classList.remove('active-surf-btn'));
  document.querySelectorAll('[id^=cond-]').forEach(b=>b.classList.remove('active-surf-btn'));
  const ecEl=document.getElementById('e-cond');if(ecEl)ecEl.value='';
  const edEl=document.getElementById('e-days');if(edEl){edEl.value='';edEl.style.borderColor='#A32D2D';edEl.style.background='var(--red-lt)';}
  renderEstSurfs();
  ['est-s1-next','est-s2-next'].forEach(id=>{const b=document.getElementById(id);if(b){b.disabled=true;b.style.background='var(--border2)';b.style.color='var(--text3)';b.style.borderColor='var(--border2)';b.style.cursor='not-allowed';}});
}
function saveAndExitEstimate(){
  // Ensure bid is saved to bids array with Pending status
  const{final}=calcEst();
  const cname=document.getElementById('e-cname')?.value||'Client';
  const caddr=document.getElementById('e-caddr')?.value||'';
  const cphone=document.getElementById('e-cphone')?.value||'';
  const days=parseInt(document.getElementById('e-days')?.value)||2;
  const ss={};SCOPE_ITEMS.forEach(s=>{ss[s.id]=!!scopeOn(s.id);});

  // Leads page is client-driven — ensure a client record exists
  let clientId=estLinkedClientId;
  if(!clientId&&cname.trim()&&cname!=='Client'){
    const existing=clients.find(c=>c.name.toLowerCase()===cname.trim().toLowerCase()&&c.phone===cphone);
    if(existing){clientId=existing.id;}
    else{
      const nc={id:Date.now(),name:cname.trim(),phone:cphone,addr:caddr,notes:'',created:todayKey()};
      clients.unshift(nc);clientId=nc.id;estLinkedClientId=clientId;
    }
  }
  const _saveTargetId=lastCreatedBidId||editingBidId;
  // Defensive: if both IDs are null, check for an existing Pending+draft for this client
  // to prevent creating duplicate estimates on each save/resume cycle
  const _existingPendingDraft=(!_saveTargetId&&clientId)
    ?bids.find(b=>b.client_id===clientId&&b.draft===true&&b.status==='Pending'&&!b.signingToken)
    :null;
  const _resolvedTarget=_saveTargetId
    ?bids.find(x=>x.id===_saveTargetId)
    :_existingPendingDraft||null;
  if(_resolvedTarget){
    const b=_resolvedTarget;
    b.amount=final;
    b.status=b.status==='Closed Won'?'Closed Won':'Pending';
    b.draft=true;b.lastStep=estStep;
    if(!b.followup)b.followup=addDays(todayKey(),3);
    if(clientId&&!b.client_id)b.client_id=clientId;
    b.surfaces=[...estSurfaces];
    b.roomScopeMap=JSON.parse(JSON.stringify(roomScopeMap));
    b.paint=document.getElementById('e-paint')?.value||'';
    b.days=days;
    b.name=cname;b.phone=cphone;b.addr=caddr;
    b.notes=document.getElementById('e-cnotes')?.value||b.notes||'';
    lastCreatedBidId=b.id; // ensure clearEstimatorForm knows this bid exists and is Pending
  } else {
    const c=clientId?getClientById(clientId):null;
    const followup=addDays(todayKey(),3);
    const newBid={
      id:Date.now(),
      client_id:clientId||null,
      client_name:c?c.name:cname,
      name:cname,phone:cphone,addr:caddr,
      bid_date:todayKey(),followup,
      amount:final,
      type:getBidIncomeLabel({surfaces:estSurfaces}),
      days,status:'Pending',draft:true,lastStep:estStep,
      notes:document.getElementById('e-cnotes')?.value||'',
      completion_date:'',collStage:'none',collHistory:[],
      scope:ss,surfaces:[...estSurfaces],
      roomScopeMap:JSON.parse(JSON.stringify(roomScopeMap)),
      cond:document.getElementById('e-cond')?.value||'',
      paint:document.getElementById('e-paint')?.value||'',
    };
    bids.unshift(newBid);lastCreatedBidId=newBid.id;
  }
  saveAll();
  localStorage.removeItem('zp3_est_full_draft');
  clearEstimatorForm(); // wipe in-memory state so next newEstimate() starts clean
  showToast('Estimate saved — resume it under Make Money Today','✓');
  goPg('pg-dash');
}

function newEstimate(){
  const existing=loadEstFullDraft();
  if(existing&&existing.cname){
    zConfirm('You have an unfinished estimate for '+existing.cname+'. Resume where you left off?',
      ()=>{clearEstimatorForm();restoreEstFullDraft(existing);goEstStep(existing.step||1);},
      {title:'Resume estimate?',yes:'Resume',no:'Start fresh',danger:false,
       onNo:()=>{clearEstimatorForm();prefillEstimateRates();goEstStep(1);}});
    return;
  }
  clearEstimatorForm();
  prefillEstimateRates();
  goEstStep(1);
}
function adjRate(id,delta){
  const el=document.getElementById(id);if(!el)return;
  const cur=parseFloat(el.value)||0;
  const next=Math.round((cur+delta)*100)/100;
  if(next<0)return;
  el.value=next;
  if(typeof renderEstRunning==='function')renderEstRunning();
}
function adjRateAdv(advId,delta){
  const el=document.getElementById(advId);if(!el)return;
  const cur=parseFloat(el.value)||0;
  const next=Math.round((cur+delta)*100)/100;
  if(next<0)return;
  el.value=next;
  // sync to hidden field that calcEst reads
  const hiddenId=advId.replace('-adv','');
  const hidden=document.getElementById(hiddenId);
  if(hidden)hidden.value=next;
  if(typeof renderEstRunning==='function')renderEstRunning();
}
function syncAdvRate(advId,hiddenId){
  const adv=document.getElementById(advId);const hidden=document.getElementById(hiddenId);
  if(adv&&hidden)hidden.value=adv.value;
  if(typeof renderEstRunning==='function')renderEstRunning();
}
function selectPropertyTier(key){
  const tier=PROP_TIERS[key];if(!tier)return;
  estPropertyTier=tier;
  // Update button styles
  Object.keys(PROP_TIERS).forEach(k=>{
    const btn=document.getElementById('ptier-'+k);if(!btn)return;
    if(k===key){
      btn.style.borderColor='var(--blue)';btn.style.background='var(--blue-lt)';
    } else {
      btn.style.borderColor='var(--border2)';btn.style.background='var(--bg2)';
    }
  });
  const hint=document.getElementById('prop-tier-hint');
  if(hint)hint.textContent=tier.hint;
  const indBanner=document.getElementById('_tier-industrial-banner');
  if(indBanner)indBanner.style.display=(key==='commercial')?'block':'none';
  // Enable Next button
  const nxt=document.getElementById('est-s2-next-btn');
  if(nxt){nxt.style.background='';nxt.style.color='';nxt.style.borderColor='';nxt.disabled=false;}
  if(typeof renderEstRunning==='function')renderEstRunning();
}
function prefillEstimateRates(){
  const sf=(id,val)=>{const el=document.getElementById(id);if(el)el.value=val;};
  const _pbn=getBusinessName();if(_pbn&&_pbn!=='TradeDesk'&&!_pbn.includes('@'))sf('e-bname',_pbn);
  if(S.bphone)sf('e-bphone',S.bphone);
  if(S.blic)sf('e-blic',S.blic);
  sf('e-r-walls',S.rWalls||1.30);sf('e-r-ceil',S.rCeil||1.00);sf('e-r-trim',S.rTrim||3.25);sf('e-r-walls-adv',S.rWalls||1.30);sf('e-r-ceil-adv',S.rCeil||1.00);sf('e-r-trim-adv',S.rTrim||3.25);sf('e-r-door',S.rDoor||95);sf('e-r-door-adv',S.rDoor||95);sf('e-r-win',S.rWin||50);sf('e-r-ext',S.rExt||1.10);sf('e-r-deck',S.rDeck||1.00);
  sf('e-r-door',S.rDoor||95);sf('e-r-win',S.rWin||50);sf('e-r-ext',S.rExt||1.10);
  sf('e-r-deck',S.rDeck||1.00);sf('e-paint-rate',83);
  SCOPE_ITEMS.forEach(sc=>{sf(sc.rateKey,sc.defaultRate);});
}
function checkStep1Ready(){
  const nm=(document.getElementById('e-cname')?.value||'').trim();
  const ph=(document.getElementById('e-cphone')?.value||'').trim();
  const addr=(document.getElementById('e-caddr')?.value||'').trim();
  const ready=!!(nm&&ph&&addr);
  const btn=document.getElementById('est-s1-next');
  if(!btn)return;
  btn.disabled=!ready;
  if(ready){btn.style.background='var(--blue)';btn.style.color='#fff';btn.style.borderColor='var(--blue)';btn.style.cursor='pointer';}
  else{btn.style.background='var(--border2)';btn.style.color='var(--text3)';btn.style.borderColor='var(--border2)';btn.style.cursor='not-allowed';}
}
function _estCancelToStylePicker(){
  const c=typeof estLinkedClientId!=='undefined'&&estLinkedClientId?getClientById(estLinkedClientId):null;
  if(c&&typeof _showEstimateStylePicker==='function')_showEstimateStylePicker(c);
  else goPg('pg-clients');
}
function checkStep2Ready(){
  // Condition now defaults to 1.0 (good) — always ready
  const ready=true;
  const btn=document.getElementById('est-s2-next');
  if(!btn)return;
  btn.disabled=!ready;
  if(ready){btn.style.background='var(--blue)';btn.style.color='#fff';btn.style.borderColor='var(--blue)';btn.style.cursor='pointer';}
  else{btn.style.background='var(--border2)';btn.style.color='var(--text3)';btn.style.borderColor='var(--border2)';btn.style.cursor='not-allowed';}
}
function markFieldFilled(el){
  if(el.value&&el.value.trim()){
    el.style.borderColor='var(--border2)';
    el.style.background='var(--bg2)';
  } else {
    el.style.borderColor='#A32D2D';
    el.style.background='var(--red-lt)';
  }
}

function validateAndGoStep5(){
  // Paint supply is now set during scope walkthrough — e-paint will be 'interior' or 'customer'
  // Default to interior if somehow not set
  const paintEl=document.getElementById('e-paint');
  if(paintEl&&!paintEl.value)paintEl.value='interior';
  const days=parseInt(document.getElementById('e-days')?.value)||0;
  if(!days||days<1){
    const el=document.getElementById('e-days');
    if(el){el.style.borderColor='#A32D2D';el.style.background='var(--red-lt)';el.focus();}
    zAlert('Enter estimated days to complete.',{title:'Required'});return;
  }
  goEstStep(5);
}
function validateAndGoStep2(){
  if(!runStep1Validation())return;
  goEstStep(3); // Step 2 (tier) is now merged into step 3
}
function goEstStep(n){
  if(n===2)n=3; // Step 2 (tier) is merged into step 3 — skip directly to surfaces
  if(n===3){
    const dd=document.getElementById('surf-room-done');if(dd)dd.style.display='none';
    setTimeout(initSurfStep,50);
    if(estSurfaces.length===0){
      const restored=loadSurfDraft();
      if(restored){
        renderEstSurfs();
        renderEstRunning();
        renderSurfRoomsLogged();
        const note=document.getElementById('surf-tip');
        if(note)note.innerHTML='<strong>Draft restored</strong> — your previous surfaces are back. <button class="btn btn-sm" onclick="clearSurfDraftAndReset()" style="margin-left:6px">Start fresh</button>';
      }
    }
    setTimeout(()=>{
      if(estSurfaces.length>0){
        ['est-s3-next-btn','laser-review-btn','manual-review-btn'].forEach(id=>{
          const btn=document.getElementById(id);if(!btn)return;
          btn.disabled=false;btn.style.background='var(--blue)';btn.style.color='#fff';
          btn.style.borderColor='var(--blue)';btn.style.cursor='pointer';
        });
      }
    },100);
  }
  if(n===2){
    setTimeout(checkStep2Ready,50);
    if(estStep<2&&!document.getElementById('e-cond')?.value)applyDefaultScope();
    // Auto-select current tier visually — default to 'commercial' if property type is Commercial
    setTimeout(()=>{
      const cprop=(document.getElementById('e-cprop')?.value||'').toLowerCase();
      const isCommercial=cprop==='commercial';
      const currentKey=estPropertyTier&&estPropertyTier.key;
      const key=isCommercial&&(!currentKey||currentKey==='avg')?'commercial':currentKey||'avg';
      selectPropertyTier(key);
    },80);
  }
  if(n===1){_paintSyncJobTypeButtons();setTimeout(checkStep1Ready,100);}
  if(n===4){
    if(!estSurfaces.length){zAlert('Add at least one room and surface before reviewing.',{title:'No surfaces yet'});return;}
    const pVal=document.getElementById('e-paint')?.value;
    if(!pVal){const pEl=document.getElementById('e-paint');if(pEl)pEl.value='interior';}
    renderEstReview();
  }
  if(n===5){const d=document.getElementById('est-desc-text');if(d&&!d.value.trim())d.value=buildDescription();buildProposal();setTimeout(initEstNotesCanvas,100);}
  if(n===6)buildProposal();
  const _goBack=n<estStep;estStep=n;for(let i=1;i<=7;i++){const sc=document.getElementById('est-s'+i),st=document.getElementById('est-st-'+i);if(sc){if(i===n){sc.style.display='block';_sfShow(sc,_goBack);}else sc.style.display='none';}if(st){st.classList.remove('active','done');if(i===n)st.classList.add('active');else if(i<n)st.classList.add('done');}}
  // Defer scroll until after the browser reflows the shown/hidden est-s* divs
  requestAnimationFrame(()=>{
    try{window.scrollTo({top:0,left:0,behavior:'instant'});}catch(e){window.scrollTo(0,0);}
    document.body.scrollTop=0;document.documentElement.scrollTop=0;
    if(document.scrollingElement)document.scrollingElement.scrollTop=0;
    const _pgEst=document.getElementById('pg-est');if(_pgEst)_pgEst.scrollTop=0;
    const _app=document.getElementById('app');if(_app)_app.scrollTop=0;
    // Second frame handles scroll-anchor correction browsers may apply after first paint
    requestAnimationFrame(()=>{
      try{window.scrollTo({top:0,left:0,behavior:'instant'});}catch(e){window.scrollTo(0,0);}
      if(document.scrollingElement)document.scrollingElement.scrollTop=0;
    });
  });
  if(n===3)renderEstRunning();
  if(n===3||n===4||n===5){if(typeof _paintEstAutosave==='function')_paintEstAutosave();}
}

function cm(d){calMonth+=d;if(calMonth>11){calMonth=0;calYear++;}if(calMonth<0){calMonth=11;calYear--;}renderCalendar();}
function renderCalendar(){renderCalMonthLabel();renderCalGrid();renderCalAvail();renderCalConflicts();renderCalWeek();renderCalUpcoming();}
function renderCalMonthLabel(){const M=['January','February','March','April','May','June','July','August','September','October','November','December'];document.getElementById('cal-month-lbl').textContent=M[calMonth]+' '+calYear;}
function getJobsOnDay(key){const res=[];jobs.forEach(job=>{if(job.status==='canceled')return;const workDays=getJobWorkDays(job);if(workDays.includes(key)){res.push({job,isBuf:false});return;}const lastDay=workDays.length?workDays[workDays.length-1]:job.start;const b=parseInt(job.buffer)||0;for(let i=1;i<=b;i++){if(addDays(lastDay,i)===key){res.push({job,isBuf:true});return;}}});return res;}
function requestLocationPermission(onGranted, onDenied){
  // Never auto-prompt for location under automation (Playwright/headless webdriver):
  // there is no real user to grant it, and the full-screen "Allow location access?"
  // modal would sit over the page intercepting every subsequent click. Mirrors the
  // geo-consent prompt's existing navigator.webdriver guard (geo-track.js). Real users
  // are never navigator.webdriver, so production behavior is unchanged.
  if(navigator.webdriver){if(onDenied)onDenied();return;}
  if(S.weatherLat&&S.weatherLon){if(onGranted)onGranted();return;}
  // Previously granted on this device — skip modal entirely
  if(S.locationGranted){_grabLocCoords(onGranted,onDenied);return;}
  // Only block if denied and never previously granted
  if(S.locationDenied){if(onDenied)onDenied();return;}
  // Check OS-level permission — avoids showing our modal to users who already said yes
  if(navigator.permissions&&navigator.permissions.query){
    navigator.permissions.query({name:'geolocation'}).then(p=>{
      if(p.status==='granted'){
        S.locationGranted=true;S.locationDenied=false;
        _grabLocCoords(onGranted,onDenied);
      }else if(p.status==='denied'){
        S.locationDenied=true;S.settingsTs=Date.now();saveAll();if(onDenied)onDenied();
      }else{
        _showLocModal(onGranted,onDenied);
      }
    }).catch(()=>_showLocModal(onGranted,onDenied));
  }else{
    _showLocModal(onGranted,onDenied);
  }
}
function _grabLocCoords(onGranted,onDenied){
  navigator.geolocation.getCurrentPosition(pos=>{
    S.weatherLat=Math.round(pos.coords.latitude*10000)/10000;
    S.weatherLon=Math.round(pos.coords.longitude*10000)/10000;
    S.locationDenied=false;S.locationGranted=true;S.settingsTs=Date.now();saveAll();
    if(onGranted)onGranted();
  },()=>{S.locationDenied=true;S.settingsTs=Date.now();saveAll();if(onDenied)onDenied();},{enableHighAccuracy:false,timeout:10000});
}
function _showLocModal(onGranted,onDenied){
  const overlay=document.createElement('div');
  overlay.className='zmodal-overlay';
  overlay.style.cssText='align-items:center;padding:20px';
  const box=document.createElement('div');
  box.className='zmodal';
  box.innerHTML=
    '<div style="text-align:center;margin-bottom:16px">'+
      '<div style="font-size:40px;margin-bottom:10px">📍</div>'+
      '<div style="font-size:18px;font-weight:800;margin-bottom:6px">Allow location access?</div>'+
      '<div style="font-size:13px;color:var(--text2);line-height:1.6">TradeDesk uses your location for:<br>'+
      '<strong>🌤 Live weather</strong> on your calendar<br>'+
      '<strong>🚗 GPS tracking</strong> for mileage deductions<br><br>'+
      'Your location is never shared or stored on our servers — it stays on your device only.</div>'+
    '</div>'+
    '<button id="loc-allow-btn" style="width:100%;padding:14px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:8px">Allow location access</button>'+
    '<button id="loc-deny-btn" style="width:100%;padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:none;font-size:13px;color:var(--text3);cursor:pointer;font-family:inherit">Not now — skip weather &amp; GPS</button>';
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  box.querySelector('#loc-allow-btn').onclick=()=>{
    overlay.remove();
    // Remember the explicit "Allow" IMMEDIATELY so the prompt is sticky — one tap, saved
    // forever. Previously locationGranted was only written inside _grabLocCoords' success
    // callback, so if the first OS coordinate fix was slow, timed out, errored, or the app
    // closed before it resolved, nothing persisted and the modal returned on the next launch.
    // (Denial already persisted immediately via the deny handler; this fixes the asymmetry.)
    S.locationGranted=true;S.locationDenied=false;S.settingsTs=Date.now();saveAll();
    _grabLocCoords(onGranted,()=>{
      // OS denied after user tapped allow — show gentle follow-up
      if(onDenied)onDenied();
    });
  };
  box.querySelector('#loc-deny-btn').onclick=()=>{
    overlay.remove();
    S.locationDenied=true;saveAll();
    if(onDenied)onDenied();
  };
}

// Call on every calendar open to get live location for weather
async function renderCalGrid(){
  const{booked,buf}=getBookedDays();const DNAMES=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  let html=DNAMES.map(d=>`<div class="cal-dh">${d}</div>`).join('');
  // Guard: calYear must be valid; reset if corrupted
  const curYear=new Date().getFullYear();
  if(!calYear||calYear<2020||calYear>2099)calYear=curYear;
  if(calMonth<0||calMonth>11)calMonth=new Date().getMonth();

  const tk=todayKey();
  const daysInMonth=new Date(calYear,calMonth+1,0).getDate();
  const firstDow=new Date(calYear,calMonth,1).getDay(); // 0=Sun

  // Build prev-month leading cells (never mutate — create fresh Date each time)
  const cells=[];
  if(firstDow>0){
    const prevMonth=calMonth===0?11:calMonth-1;
    const prevYear=calMonth===0?calYear-1:calYear;
    const daysInPrev=new Date(prevYear,prevMonth+1,0).getDate();
    for(let i=firstDow-1;i>=0;i--){
      const day=daysInPrev-i;
      cells.push({d:new Date(prevYear,prevMonth,day),other:true});
    }
  }
  // Current month cells
  for(let day=1;day<=daysInMonth;day++){
    cells.push({d:new Date(calYear,calMonth,day),other:false});
  }
  // Next-month trailing cells — fill to complete the last row
  {
    const nextMonth=calMonth===11?0:calMonth+1;
    const nextYear=calMonth===11?calYear+1:calYear;
    let trailDay=1;
    while(cells.length%7!==0){
      cells.push({d:new Date(nextYear,nextMonth,trailDay),other:true});
      trailDay++;
    }
  }
  // Validation: drop any cell whose year is outside plausible range
  const validCells=cells.filter(({d})=>d.getFullYear()>=2020&&d.getFullYear()<=2099);
  // Fetch weather (cached — won't block render on repeat calls)
  const weather=await fetchWeather()||{};
  validCells.forEach(({d,other})=>{
    const key=dateKey(d),isToday=key===tk,dj=getJobsOnDay(key);
    const wx=!other?weather[key]:null;
    let cls='cal-cell';
    if(other)cls+=' other';
    else if(booked.has(key)||buf.has(key))cls+=' booked';
    if(isToday&&!other)cls+=' today';
    if(wx&&wx.rain&&!other)cls+=' cal-rain';
    const clickable=!other;
    html+='<div class="'+cls+'"'+(clickable?' onclick="expandCalDay(\''+key+'\')" style="cursor:pointer"':'')+'>'+
      '<div style="display:flex;justify-content:space-between;align-items:center">'+
        '<div class="cdn">'+d.getDate()+'</div>'+
        (wx?'<div style="font-size:13px;line-height:1" title="'+wx.label+' · '+wx.hi+'°/'+wx.lo+'°F'+'">'+wx.icon+'</div>':'') +
      '</div>'+
      (wx?'<div style="font-size:9px;color:'+(wx.rain?'#A32D2D':'var(--text3)')+';font-weight:600;margin-bottom:1px;line-height:1">'+wx.hi+'°/'+wx.lo+'°'+(wx.precip>20?' · '+wx.precip+'%':'')+'</div>':'')+
      dj.map(({job,isBuf})=>{
        if(job.eventType==='task'){const done=job.status==='done';return'<div class="cjob" style="background:'+(done?'#9CA3AF':'#6366F1')+';font-size:9px">'+(done?'✓ ':'☐ ')+escHtml(job.name)+'</div>';}
        return'<div class="cjob" style="background:'+(isBuf?lighten(job.color):job.color)+';'+(isBuf?'color:'+job.color+';':'')+'">'+(isBuf?'buf':(job.eventType==='estimate'?'📋 ':'')+escHtml(job.name))+'</div>';
      }).join('')+
    '</div>';
  });
  document.getElementById('cal-grid').innerHTML=html;
}
function renderCalAvail(){}

function expandCalDay(key){
  const el=document.getElementById('cal-day-detail');if(!el)return;
  // Toggle: tapping the same day again closes the panel
  if(el.style.display==='block'&&el.dataset.openKey===String(key)){el.style.display='none';el.dataset.openKey='';return;}
  el.dataset.openKey=String(key);
  const dj=getJobsOnDay(key).filter(x=>!x.isBuf);
  const d=parseD(key);
  const label=d.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  const isToday=key===todayKey();
  el.style.display='block';
  const slots=[];
  // Show 7am–9pm (21:00) so evening estimates are visible
  for(let h=7;h<=21;h++){
    const ampm=h>=12?'PM':'AM';
    const h12=h>12?h-12:h===0?12:h;
    const timeStr=h12+':00 '+ampm;
    const hKey=(h<10?'0':'')+h+':00';
    const jobsAtHour=dj.filter(({job})=>{
      if(!job.time)return false;
      const[jh]=job.time.split(':').map(Number);
      return jh===h;
    });
    slots.push({h,timeStr,hKey,jobs:jobsAtHour});
  }
  const tasks=dj.filter(({job})=>job.eventType==='task');
  const allDay=dj.filter(({job})=>!job.time&&job.eventType!=='estimate'&&job.eventType!=='task');
  const timedEvents=dj.filter(({job})=>job.time&&job.eventType!=='task');

  const _nonTaskCount=dj.filter(({job})=>job.eventType!=='task').length;
  el.innerHTML=
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding-bottom:10px;border-bottom:2px solid var(--border)">'+
      '<div>'+
        '<div style="font-size:15px;font-weight:700">'+label+'</div>'+
        '<div style="font-size:11px;color:var(--text3);margin-top:2px">'+
          (_nonTaskCount>0?_nonTaskCount+' event'+(_nonTaskCount>1?'s':'')+(tasks.length?' · ':''):'')+
          (tasks.length?tasks.length+' task'+(tasks.length>1?'s':''):(!_nonTaskCount?'Nothing scheduled':''))+
        '</div>'+
      '</div>'+
      '<button onclick="closeCalDay()" style="border:none;background:none;font-size:20px;cursor:pointer;color:var(--text3)">&#10005;</button>'+
    '</div>'+
    // Tasks
    (tasks.length?
      '<div style="margin-bottom:12px">'+
        '<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);margin-bottom:6px">Tasks</div>'+
        tasks.map(({job})=>{
          const done=job.status==='done';
          return '<div style="display:flex;align-items:flex-start;gap:10px;padding:9px 10px;background:var(--bg2);border-radius:var(--r);margin-bottom:4px'+(done?';opacity:.6':'')+'">'+
            '<button onclick="completeCalTask('+job.id+')" style="border:none;background:none;cursor:pointer;padding:0;margin-top:1px;flex-shrink:0;font-size:17px;line-height:1;color:'+(done?'#6366F1':'var(--text3)')+'">'+
              (done?'☑':'☐')+
            '</button>'+
            '<div style="flex:1;min-width:0">'+
              '<div style="font-size:13px;font-weight:700'+(done?';text-decoration:line-through;color:var(--text3)':'')+'">'+
                (job.time?'<span style="font-size:10px;color:#6366F1;font-weight:700;margin-right:6px">'+fmtTime(job.time)+'</span>':'')+
                job.name+
              '</div>'+
              (job.notes?'<div style="font-size:11px;color:var(--text3);margin-top:2px">'+job.notes+'</div>':'')+
            '</div>'+
            ''+
          '</div>';
        }).join('')+
      '</div>'
    :'')+
    // All-day events (paint jobs with no time, or any untimed event)
    (allDay.length?
      '<div style="margin-bottom:12px">'+
        '<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);margin-bottom:6px">All day</div>'+
        allDay.map(({job})=>{
          const isEst=job.eventType==='estimate';
          const c=job.client_id?getClientById(job.client_id):null;
          return '<div style="border-left:4px solid '+job.color+';background:var(--bg2);border-radius:0 var(--r) var(--r) 0;padding:10px 12px;margin-bottom:6px">'+
            '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">'+
              '<div style="flex:1;min-width:0">'+
                '<div style="font-size:10px;font-weight:700;color:'+job.color+';text-transform:uppercase;margin-bottom:2px">'+(isEst?'Estimate':'Paint job · '+job.days+' day'+(job.days>1?'s':''))+'</div>'+
                '<div style="font-size:14px;font-weight:700">'+job.name+'</div>'+
                (job.addr?'<div style="font-size:11px;color:var(--text3);margin-top:1px">'+job.addr+'</div>':'')+
                (!isEst&&job.value?'<div style="font-size:12px;color:var(--green-mid);font-weight:700;margin-top:3px">'+fmt(job.value)+'</div>':'')+
              '</div>'+
              '<div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">'+
                (c?'<button class="btn btn-sm btn-p" onclick="openClientDetail('+c.id+')" style="font-size:11px">Open</button>':'')+
                ''+
              '</div>'+
            '</div>'+
          '</div>';
        }).join('')+
      '</div>'
    :'')+
    // Hour-by-hour schedule — always shown so user can see open slots and book more
    '<div>'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'+
        '<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--text3)">Schedule</div>'+
        '<div style="display:flex;gap:6px">'+
          '<button onclick="calTaskModal(\''+key+'\')" style="border:none;background:#6366F1;color:#fff;border-radius:20px;padding:4px 12px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit">+ Task</button>'+
          '<button onclick="closeCalDay();schedFromDate(\''+key+'\')" style="border:none;background:var(--blue);color:#fff;border-radius:20px;padding:4px 12px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit">+ Estimate</button>'+
        '</div>'+
      '</div>'+
      slots.map(s=>{
        const hasEvent=s.jobs.length>0;
        return '<div style="display:grid;grid-template-columns:52px 1fr;gap:6px;min-height:'+(hasEvent?'auto':'28px')+';position:relative;'+(hasEvent?'':'opacity:.55')+'" >'+
          '<div style="font-size:10px;color:var(--text3);padding-top:3px;text-align:right;flex-shrink:0;border-right:1px solid var(--border);padding-right:8px">'+s.timeStr+'</div>'+
          '<div style="padding-left:8px;padding-bottom:'+(hasEvent?'8':'0')+'px">'+
            (s.jobs.map(({job})=>{
              const c=job.client_id?getClientById(job.client_id):null;
              const isEst=job.eventType==='estimate';
              return '<div style="background:'+job.color+';border-radius:var(--r);padding:8px 10px;margin-bottom:4px;color:#fff">'+
                '<div style="font-size:11px;font-weight:800;text-transform:uppercase;opacity:.85;margin-bottom:2px">'+(isEst?'📋 Estimate':'🎨 Paint job')+'</div>'+
                '<div style="font-size:13px;font-weight:700">'+job.name+'</div>'+
                '<div style="font-size:10px;opacity:.9;margin-top:1px">'+(job.hours?job.hours+'hr':'')+(job.addr?' · '+job.addr:'')+'</div>'+
                '<div style="display:flex;gap:6px;margin-top:6px">'+
                  (c?'<button onclick="openClientDetail('+c.id+')" style="border:none;background:rgba(255,255,255,.2);color:#fff;border-radius:4px;padding:4px 8px;font-size:10px;font-weight:700;cursor:pointer;font-family:inherit">Open</button>':'')+
                  (isEst?'<button onclick="rescheduleEstimate('+job.id+')" style="border:none;background:rgba(255,255,255,.2);color:#fff;border-radius:4px;padding:4px 8px;font-size:10px;cursor:pointer;font-family:inherit">Reschedule</button>':'')+
                  ''+
                '</div>'+
              '</div>';
            }).join(''))+
          '</div>'+
        '</div>';
      }).join('')+
    '</div>'+
  '';
  el.scrollIntoView({behavior:'smooth',block:'nearest'});
}

function calTaskModal(dateKey){
  const d=parseD(dateKey);
  const label=d.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});
  const ov=document.createElement('div');
  ov.className='zmodal-overlay';
  ov.innerHTML=
    '<div class="zmodal" style="max-width:340px">'+
      '<div class="zmodal-title" style="color:#6366F1">Add task — '+label+'</div>'+
      '<div style="margin:14px 0 8px">'+
        '<input id="_ctask-title" type="text" placeholder="Task title" autocomplete="off" '+
          'style="width:100%;box-sizing:border-box;padding:10px 12px;border:1.5px solid var(--border);border-radius:var(--r);font-size:15px;font-family:inherit;background:var(--bg2);color:var(--text1)">'+
      '</div>'+
      '<div style="display:flex;gap:8px;margin-bottom:8px">'+
        '<div style="flex:1;display:flex;flex-direction:column;gap:4px">'+
          '<label style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em">Time (optional)</label>'+
          '<input id="_ctask-time" type="time" '+
            'style="width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid var(--border);border-radius:var(--r);font-size:13px;font-family:inherit;background:var(--bg2);color:var(--text1)">'+
        '</div>'+
      '</div>'+
      '<div style="margin-bottom:14px">'+
        '<textarea id="_ctask-notes" placeholder="Notes (optional)" rows="2" '+
          'style="width:100%;box-sizing:border-box;padding:8px 12px;border:1.5px solid var(--border);border-radius:var(--r);font-size:13px;font-family:inherit;background:var(--bg2);color:var(--text1);resize:none"></textarea>'+
      '</div>'+
      '<div class="zmodal-btns">'+
        '<button onclick="this.closest(\'.zmodal-overlay\').remove()" '+
          'style="flex:1;padding:10px;border:1.5px solid var(--border);border-radius:var(--r);background:none;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;color:var(--text2)">Cancel</button>'+
        '<button onclick="_saveCalTask(\''+dateKey+'\')" '+
          'style="flex:1;padding:10px;border:none;background:#6366F1;color:#fff;border-radius:var(--r);font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">Add task</button>'+
      '</div>'+
    '</div>';
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  document.body.appendChild(ov);
  setTimeout(()=>{const el=document.getElementById('_ctask-title');if(el)el.focus();},80);
}

function _saveCalTask(dateKey){
  const title=(document.getElementById('_ctask-title')?.value||'').trim();
  if(!title){
    const el=document.getElementById('_ctask-title');
    if(el){el.style.borderColor='var(--red)';el.focus();}
    return;
  }
  const time=document.getElementById('_ctask-time')?.value||'';
  const notes=(document.getElementById('_ctask-notes')?.value||'').trim();
  document.querySelector('.zmodal-overlay')?.remove();
  jobs.push({id:Date.now(),bid_id:null,client_id:null,name:title,addr:'',start:dateKey,days:1,buffer:0,value:0,color:'#6366F1',eventType:'task',allowWeekend:true,time,hours:null,notes,status:'upcoming'});
  saveAll();
  renderCalGrid();
  expandCalDay(dateKey);
}

function completeCalTask(jobId){
  const j=jobs.find(x=>x.id===jobId);
  if(!j)return;
  j.status=j.status==='done'?'upcoming':'done';
  saveAll();
  renderCalGrid();
  expandCalDay(j.start);
}

function goToVehicleSettings(){
  goPg('pg-team');
  if(typeof setFleetTab==='function') setFleetTab('fleet');
}

function toggleRefField(sel){
  const wrap=document.getElementById('cf-ref-wrap');
  if(wrap)wrap.style.display=(sel.value==='Referral'||sel.value==='Referral — someone sent them')?'block':'none';
}
function showKpiChart(type){
  const months=[];
  const yr=dashYear||new Date().getFullYear();
  const refDate=new Date(yr,11,1); // Dec of selected year
  for(let i=11;i>=0;i--){
    const d=new Date(refDate.getFullYear(),refDate.getMonth()-i,1);
    const key=d.getFullYear()+'-'+(d.getMonth()+1<10?'0':'')+(d.getMonth()+1);
    const label=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]+' '+String(d.getFullYear()).slice(2);
    let val=0;
    if(type==='profit'){
      const mInc=income.filter(r=>r.date&&r.date.startsWith(key)).reduce((s,r)=>s+r.amount,0);
      const mExp=expenses.filter(e=>e.date&&e.date.startsWith(key)).reduce((s,e)=>s+e.amount,0);
      const mMi=mileage.filter(m=>m.date&&m.date.startsWith(key)).reduce((s,m)=>s+(m.miles||0),0);
      val=Math.round(mInc-mExp-(mMi*IRS()));
    } else if(type==='close'){
      const mWon=bids.filter(b=>b.status==='Closed Won'&&b.bid_date&&b.bid_date.startsWith(key)).length;
      const mLost=bids.filter(b=>(b.status==='Closed Lost'||b.status==='Abandoned')&&b.bid_date&&b.bid_date.startsWith(key)).length;
      val=mWon+mLost>0?Math.round(mWon/(mWon+mLost)*100):0;
    } else if(type==='estimates'){
      val=jobs.filter(j=>j.eventType==='estimate'&&j.start&&j.start.startsWith(key)).length;
    } else if(type==='revenue'){
      val=income.filter(r=>r.date&&r.date.startsWith(key)).reduce((s,r)=>s+r.amount,0);
    }
    months.push({key,label,val});
  }

  const titles={profit:'Net Profit by Month',close:'Closing Ratio by Month (%)',estimates:'Estimates by Month',revenue:'Revenue by Month'};
  const isNeg=type==='profit';
  const maxVal=Math.max(...months.map(m=>Math.abs(m.val)),1);

  const fmtLabel=v=>type==='profit'?(v===0?'—':fmt(v)):type==='close'?(v===0?'—':v+'%'):(v===0?'—':String(v));
  const bars=months.map((m,i)=>{
    const pct=Math.round(Math.abs(m.val)/maxVal*100);
    const color=type==='close'?(m.val>=40?'var(--green-mid)':m.val>=25?'var(--amber)':'#A32D2D'):
                type==='profit'?(m.val<0?'#A32D2D':'var(--green-mid)'):'var(--blue)';
    return '<div onclick="_bcTap('+i+')" style="display:flex;flex-direction:column;align-items:center;gap:2px;flex:1;min-width:0;cursor:pointer" data-val="'+fmtLabel(m.val)+'" data-lbl="'+m.label+'" data-color="'+color+'" id="bc-col-'+i+'">'+
      '<div style="width:100%;background:var(--border);border-radius:2px;height:80px;display:flex;align-items:flex-end;overflow:hidden">'+
        '<div style="width:100%;height:'+pct+'%;background:'+color+';border-radius:2px 2px 0 0;transition:height .4s ease;min-height:'+(m.val!==0?'2px':'0')+'"></div>'+
      '</div>'+
      '<div style="font-size:10px;color:var(--text3);text-align:center;line-height:1.2">'+m.label+'</div>'+
    '</div>';
  }).join('');

  const overlay=document.createElement('div');
  overlay.className='zmodal-overlay';
  const box=document.createElement('div');
  box.className='zmodal';
  box.innerHTML=
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">'+
      '<div style="font-size:15px;font-weight:800">'+titles[type]+'</div>'+
      '<button id="kpi-chart-close" style="border:none;background:none;font-size:22px;cursor:pointer;color:var(--text3)">✕</button>'+
    '</div>'+
    '<div id="bc-callout" style="min-height:36px;display:flex;align-items:center;justify-content:center;margin-bottom:4px">'+
      '<span style="font-size:12px;color:var(--text3)">Tap a bar to see value</span>'+
    '</div>'+
    '<div style="display:flex;gap:4px;align-items:flex-end;padding:4px 0 8px">'+bars+'</div>'+
    (()=>{
      const vals=months.map(m=>m.val).filter(v=>v!==0);
      if(!vals.length)return '<div style="font-size:11px;color:var(--text3);text-align:center;margin-top:8px">No data yet</div>';
      const avg=Math.round(vals.reduce((s,v)=>s+v,0)/vals.length);
      const best=Math.max(...vals);
      const trend=vals.length>=2?(vals[vals.length-1]>vals[vals.length-2]?'↑ Trending up':'↓ Trending down'):'';
      const fmt2=type==='profit'||type==='revenue'?fmt:type==='close'?v=>v+'%':v=>String(v);
      return '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:12px;text-align:center">'+
        '<div><div style="font-size:10px;color:var(--text3);text-transform:uppercase;font-weight:700">Monthly avg</div><div style="font-size:16px;font-weight:800">'+fmt2(avg)+'</div></div>'+
        '<div><div style="font-size:10px;color:var(--text3);text-transform:uppercase;font-weight:700">Best month</div><div style="font-size:16px;font-weight:800;color:var(--green-mid)">'+fmt2(best)+'</div></div>'+
        '<div><div style="font-size:10px;color:var(--text3);text-transform:uppercase;font-weight:700">Trend</div><div style="font-size:16px;font-weight:800;color:'+(trend.includes('↑')?'var(--green-mid)':'#A32D2D')+'">'+trend+'</div></div>'+
      '</div>';
    })();
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  document.getElementById('kpi-chart-close').onclick=()=>overlay.remove();
  overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});
}
function _bcTap(i){
  const col=document.getElementById('bc-col-'+i);if(!col)return;
  const val=col.dataset.val,lbl=col.dataset.lbl,color=col.dataset.color;
  document.querySelectorAll('[id^="bc-col-"]').forEach(c=>c.style.opacity='0.45');
  col.style.opacity='1';
  const callout=document.getElementById('bc-callout');
  if(callout)callout.innerHTML='<span style="font-size:22px;font-weight:800;color:'+color+'">'+val+'</span><span style="font-size:12px;color:var(--text3);margin-left:8px">'+lbl+'</span>';
}
function markFUWon(bidId,cid){
  zConfirm('Mark as won and schedule the job?',()=>{
    const b=bids.find(x=>x.id===bidId);
    if(b){
      b.status='Closed Won';
      saveAll();
      window._fromDash=true;
      schedFromBid(bidId);
    }
  },{title:'Won the job',yes:'Won — Schedule it'});
}
function markBidHandshake(bidId){
  zConfirm(
    'Handshake deals have no signed contract. If the client disputes payment or the scope, you have no legal protection.\n\nOnly use this as a last resort — you should always get a signature.',
    ()=>{
      const b=bids.find(x=>x.id===bidId);if(!b)return;
      b.status='Closed Won';b.handshake=true;b.handshake_date=todayKey();
      saveAll();renderCDBids();renderDash();
      showToast('Marked as handshake — no signed contract on file','🤝');
    },
    {title:'🤝 Handshake deal — are you sure?',yes:'Yes, proceed without signature',no:'Cancel',danger:true}
  );
}
function markBidAbandoned(bidId,cid){markFUAbandoned(bidId,cid);}
function markFUAbandoned(bidId,cid){
  const b=bids.find(x=>x.id===bidId);
  if(!b)return;
  const hits=(b.noResponseCount||0)+1;
  if(hits>=2){
    zConfirm('Still no response. Move to cold leads?',()=>{
      b.status='Abandoned';b.abandonDate=todayKey();b.noResponseCount=0;
      saveAll();renderDash();
      // Keep the abandoned proposal in the client hub Documents (read-only, declined).
      if(b.client_id&&typeof _uploadClientHub==='function')_uploadClientHub(b.client_id).catch(()=>{});
    },{title:'Move to cold leads',yes:'Move to cold leads',danger:true});
  } else {
    const newFollowup=addDays(todayKey(),7);
    b.noResponseCount=1;
    b.followup=newFollowup;
    saveAll();renderDash();
    zAlert('Got it. Follow-up reset — check back in 7 days.',{title:'Snoozed 7 days'});
  }
}
function tdPrint(){if(window._tdNativePrint){window._tdNativePrint();return;}window.print();}
function goToTrackerTab(tab){
  goPg('pg-tracker');
  setTimeout(()=>setTrTab(tab,document.getElementById('tr-t-'+tab)),150);
}
function goToExpenses(){goToTrackerTab('expenses');}
function showWorkflowGate(msg,btnLabel,btnAction){
  const o=document.createElement('div');o.className='zmodal-overlay';
  o.innerHTML='<div class="zmodal" style="text-align:center">'+
    '<div style="font-size:32px;margin-bottom:10px">⚠️</div>'+
    '<div style="font-size:16px;font-weight:800;margin-bottom:8px">One step first</div>'+
    '<div style="font-size:13px;color:var(--text3);margin-bottom:18px;line-height:1.5">'+msg+'</div>'+
    '<button onclick="('+btnAction+')();document.querySelector(\'.zmodal-overlay\')?.remove()" '+
      'style="width:100%;padding:13px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:8px">'+btnLabel+'</button>'+
    '<button onclick="this.closest(\'.zmodal-overlay\').remove()" '+
      'style="width:100%;padding:11px;border-radius:var(--r);border:1px solid var(--border2);background:none;color:var(--text3);font-size:13px;cursor:pointer;font-family:inherit">Cancel</button>'+
  '</div>';
  document.body.appendChild(o);
  o.addEventListener('click',e=>{if(e.target===o)o.remove();});
}
// ── Change Order System ───────────────────────────────────────────────────────
let _coBidId=null,_coClientId=null,_coType=null,_coSignCanvas=null,_coSignCtx=null,_coSignDrawing=false;

function showChangeOrderModal(bidId,clientId){
  const b=bids.find(x=>x.id===bidId);if(!b)return;
  _coBidId=bidId;_coClientId=clientId;_coType=null;
  const c=getClientById(b.client_id)||{name:b.client_name||'Client'};
  const coNum=(b.changeOrders||[]).length+1;
  // Build original scope summary
  const surfLines=(b.surfaces||[]).filter(s=>s.qty>0).map(s=>{
    const t=SURF_TYPES.find(x=>x.v===s.type);
    return t?t.label+(s.room?' ('+s.room.split(' — ')[0]+')':''):'';
  }).filter(Boolean);
  const scopeSummary=surfLines.length?surfLines.slice(0,4).join(', ')+(surfLines.length>4?' + '+(surfLines.length-4)+' more':''):'No surfaces recorded';

  const overlay=document.createElement('div');overlay.className='zmodal-overlay';
  const box=document.createElement('div');
  box.style.cssText='background:var(--bg);border-radius:var(--rl);width:100%;max-width:500px;max-height:92vh;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:20px;box-sizing:border-box';
  box.innerHTML=
    // Header
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">'+
      '<div>'+
        '<div style="font-size:18px;font-weight:800">Change Order #'+coNum+'</div>'+
        '<div style="font-size:12px;color:var(--text3);margin-top:2px">'+escHtml(c.name)+'</div>'+
      '</div>'+
      '<button onclick="this.closest(\'.zmodal-overlay\').remove()" style="background:var(--bg2);border:1px solid var(--border2);color:var(--text3);font-size:18px;cursor:pointer;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;flex-shrink:0;line-height:1">✕</button>'+
    '</div>'+
    // Original contract box
    '<div style="background:var(--bg2);border:1px solid var(--border2);border-radius:var(--r);padding:12px 14px;margin-bottom:16px">'+
      '<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:var(--text3);margin-bottom:6px">Original Contract</div>'+
      '<div style="font-size:20px;font-weight:800;color:var(--text);margin-bottom:4px">'+fmt(b.amount)+'</div>'+
      '<div style="font-size:11px;color:var(--text3);line-height:1.4">'+escHtml(scopeSummary)+'</div>'+
    '</div>'+
    // Description
    '<div class="f" style="margin-bottom:12px">'+
      '<label style="font-size:11px;font-weight:700;color:var(--text3)">What changed? <span style="color:#A32D2D">*</span></label>'+
      '<textarea id="co-desc" placeholder="e.g. Added master bedroom ceiling, client requested accent wall in hallway..." '+
        'style="width:100%;min-height:72px;font-size:13px;padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);font-family:inherit;resize:none;box-sizing:border-box;line-height:1.5"></textarea>'+
    '</div>'+
    // Add / Reduce toggle
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">'+
      '<button id="co-add-btn" onclick="setCOType(\'add\','+bidId+')" style="padding:11px 8px;border-radius:var(--r);border:2px solid var(--border2);background:var(--bg2);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;color:var(--text)">+ Add work</button>'+
      '<button id="co-sub-btn" onclick="setCOType(\'sub\','+bidId+')" style="padding:11px 8px;border-radius:var(--r);border:2px solid var(--border2);background:var(--bg2);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;color:var(--text)">− Remove work</button>'+
    '</div>'+
    // Amount input (hidden until type selected)
    '<div id="co-amount-wrap" style="display:none;margin-bottom:16px">'+
      '<label style="font-size:11px;font-weight:700;color:var(--text3);display:block;margin-bottom:6px">Dollar amount <span style="color:#A32D2D">*</span></label>'+
      '<input type="number" id="co-amount" min="0" step="25" placeholder="0" inputmode="decimal" '+
        'style="font-size:26px;font-weight:800;padding:10px;border-radius:var(--r);border:1.5px solid var(--border2);background:var(--bg2);width:100%;box-sizing:border-box;color:var(--text);text-align:center;font-family:inherit" '+
        'oninput="_previewCO('+bidId+')">'+
      '<div id="co-preview" style="font-size:14px;font-weight:700;text-align:center;min-height:22px;margin-top:10px;padding:10px;background:var(--bg2);border-radius:var(--r)"></div>'+
    '</div>'+
    // Buttons
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'+
      '<button onclick="this.closest(\'.zmodal-overlay\').remove()" style="padding:13px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);font-size:14px;font-weight:600;cursor:pointer;font-family:inherit">Cancel</button>'+
      '<button onclick="_reviewCO('+bidId+','+clientId+')" style="padding:13px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">Review &amp; Sign →</button>'+
    '</div>';
  overlay.appendChild(box);document.body.appendChild(overlay);
  overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});
}

function setCOType(t,bidId){
  _coType=t;
  const ab=document.getElementById('co-add-btn'),sb=document.getElementById('co-sub-btn'),aw=document.getElementById('co-amount-wrap');
  if(ab){ab.style.borderColor=t==='add'?'var(--blue)':'var(--border2)';ab.style.background=t==='add'?'var(--blue-lt)':'var(--bg2)';ab.style.color=t==='add'?'var(--blue-dk)':'var(--text)';}
  if(sb){sb.style.borderColor=t==='sub'?'#A32D2D':'var(--border2)';sb.style.background=t==='sub'?'#FEE8E8':'var(--bg2)';sb.style.color=t==='sub'?'#A32D2D':'var(--text)';}
  if(aw){aw.style.display='';setTimeout(()=>{const a=document.getElementById('co-amount');if(a){a.focus();a.select();}},60);}
  _previewCO(bidId);
}

function _previewCO(bidId){
  const b=bids.find(x=>x.id===bidId);if(!b||!_coType)return;
  const amt=parseFloat(document.getElementById('co-amount')?.value)||0;
  const pr=document.getElementById('co-preview');if(!pr)return;
  if(!amt){pr.innerHTML='<span style="color:var(--text3)">Enter amount above</span>';return;}
  const newTotal=_coType==='add'?b.amount+amt:Math.max(0,b.amount-amt);
  const delta=_coType==='add'?'+'+fmt(amt):'-'+fmt(amt);
  const arrow=_coType==='add'?'↑':'↓';
  const color=_coType==='add'?'var(--blue)':'#A32D2D';
  pr.innerHTML='<span style="color:var(--text3)">'+fmt(b.amount)+'</span>'+
    ' <span style="color:'+color+'">'+arrow+' '+delta+'</span>'+
    ' = <span style="font-size:18px;color:var(--text)">'+fmt(newTotal)+'</span>';
}

function _reviewCO(bidId,clientId){
  const b=bids.find(x=>x.id===bidId);if(!b)return;
  const desc=(document.getElementById('co-desc')?.value||'').trim();
  const amt=parseFloat(document.getElementById('co-amount')?.value||0)||0;
  if(!desc||desc.length<5){const el=document.getElementById('co-desc');if(el){el.style.borderColor='#A32D2D';el.focus();}zAlert('Describe the change (at least 5 characters).',{title:'Description required'});return;}
  if(!_coType){zAlert('Select whether this adds to or removes from the contract.',{title:'Select direction'});return;}
  if(amt<=0){const el=document.getElementById('co-amount');if(el){el.style.borderColor='#A32D2D';el.focus();}zAlert('Enter the dollar amount for this change.',{title:'Amount required'});return;}
  const c=getClientById(b.client_id)||{name:b.client_name||'Client'};
  const coNum=(b.changeOrders||[]).length+1;
  const delta=_coType==='add'?amt:-amt;
  const newTotal=Math.max(0,Math.round((b.amount+delta)*100)/100);
  const coData={desc,type:_coType,amount:amt,delta,originalAmount:b.amount,newAmount:newTotal,coNum};
  // Show the CO document for signing
  document.querySelector('.zmodal-overlay')?.remove();
  _showCOSignDocument(b,c,coData,clientId);
}

function _showCOSignDocument(b,c,coData,clientId){
  _coSignDrawing=false; // reset stale drag state from any previous invocation
  const {desc,type,amount,delta,originalAmount,newAmount,coNum}=coData;
  const biz=S.bname||'TradeDesk';
  const dateStr=new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  // Build scope summary from original bid
  const surfLines=(b.surfaces||[]).filter(s=>s.qty>0).map(s=>{
    const t=SURF_TYPES.find(x=>x.v===s.type);
    return t?t.label+(s.room?' ('+s.room.split(' — ')[0]+')':''):'';
  }).filter(Boolean);
  const deltaLabel=type==='add'?'+'+fmt(amount):'-'+fmt(amount);
  const deltaColor=type==='add'?'var(--blue)':'#A32D2D';

  const ov=document.createElement('div');
  ov.style.cssText='position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.6);display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:16px;box-sizing:border-box';
  const doc=document.createElement('div');
  doc.style.cssText='background:#fff;border-radius:12px;width:100%;max-width:540px;margin:auto;overflow:hidden;font-family:inherit;color:#111';
  doc.innerHTML=
    // Document header
    '<div style="background:#1a365d;color:#fff;padding:20px 24px">'+
      '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;opacity:.7;margin-bottom:4px">Change Order</div>'+
      '<div style="font-size:22px;font-weight:800;margin-bottom:2px">'+escHtml(biz)+'</div>'+
      '<div style="font-size:13px;opacity:.8">'+escHtml(c.name)+' · '+dateStr+'</div>'+
    '</div>'+
    '<div style="padding:20px 24px">'+
      // CO number badge
      '<div style="display:inline-block;background:#EBF2FB;color:#1a365d;font-size:12px;font-weight:800;padding:4px 12px;border-radius:20px;margin-bottom:18px">CO #'+coNum+'</div>'+
      // Original contract
      '<div style="margin-bottom:18px;padding-bottom:18px;border-bottom:1.5px solid #e5e7eb">'+
        '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:#6b7280;margin-bottom:8px">Original Contract</div>'+
        '<div style="font-size:24px;font-weight:800;color:#111;margin-bottom:6px">'+fmt(originalAmount)+'</div>'+
        (surfLines.length?'<div style="font-size:12px;color:#6b7280;line-height:1.5">'+escHtml(surfLines.join(' · '))+'</div>':'')+
      '</div>'+
      // Change description
      '<div style="margin-bottom:18px;padding-bottom:18px;border-bottom:1.5px solid #e5e7eb">'+
        '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:#6b7280;margin-bottom:8px">Change Requested</div>'+
        '<div style="font-size:14px;color:#111;line-height:1.5;margin-bottom:10px">'+escHtml(desc)+'</div>'+
        '<div style="display:flex;align-items:center;gap:8px">'+
          '<span style="font-size:13px;color:#6b7280">Adjustment:</span>'+
          '<span style="font-size:16px;font-weight:800;color:'+deltaColor+'">'+deltaLabel+'</span>'+
        '</div>'+
      '</div>'+
      // New total
      '<div style="background:#f0fdf4;border:2px solid #86efac;border-radius:10px;padding:14px 18px;margin-bottom:24px;display:flex;justify-content:space-between;align-items:center">'+
        '<div style="font-size:13px;font-weight:700;color:#166534">New Contract Total</div>'+
        '<div style="font-size:26px;font-weight:800;color:#166534">'+fmt(newAmount)+'</div>'+
      '</div>'+
      // Legal
      '<div style="font-size:11px;color:#6b7280;line-height:1.5;margin-bottom:20px;padding:12px;background:#f9fafb;border-radius:8px">'+
        'By signing below, both parties agree to modify the original contract to reflect the scope and price changes described above. All other terms of the original contract remain in effect. This change order is legally binding upon signature per applicable state and federal electronic transaction law (15 U.S.C. §7001 et seq.).'+
      '</div>'+
      // Signature canvas
      '<div style="font-size:11px;font-weight:700;color:#374151;margin-bottom:6px">Client signature</div>'+
      '<canvas id="co-sign-canvas" width="500" height="140" '+
        'style="width:100%;height:140px;border:1.5px solid #d1d5db;border-radius:8px;background:#fafafa;touch-action:none;cursor:crosshair;display:block;margin-bottom:4px"></canvas>'+
      '<div style="display:flex;justify-content:flex-end;margin-bottom:14px">'+
        '<button onclick="_clearCOCanvas()" style="font-size:11px;color:#6b7280;background:none;border:none;cursor:pointer;font-family:inherit;text-decoration:underline">Clear</button>'+
      '</div>'+
      // Typed name
      '<div style="margin-bottom:20px">'+
        '<label style="font-size:11px;font-weight:700;color:#374151;display:block;margin-bottom:6px">Type full name to confirm</label>'+
        '<input type="text" id="co-sign-name" placeholder="Full name" autocomplete="off" '+
          'style="width:100%;box-sizing:border-box;font-size:16px;padding:10px 12px;border-radius:8px;border:1.5px solid #d1d5db;background:#fff;font-family:inherit;color:#111">'+
      '</div>'+
      // Action buttons
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'+
        '<button onclick="this.closest(\'[style*=fixed]\').remove();showChangeOrderModal('+b.id+','+clientId+')" style="padding:13px;border-radius:8px;border:1.5px solid #d1d5db;background:#f9fafb;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;color:#374151">← Back</button>'+
        '<button onclick="_submitCOSign('+b.id+','+clientId+')" style="padding:13px;border-radius:8px;border:none;background:#2563eb;color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">✓ Sign Change Order</button>'+
      '</div>'+
      // Remote option — client reviews & signs from their hub instead of in person
      '<button id="co-send-hub-btn" onclick="_sendCOToHub('+b.id+','+clientId+')" style="width:100%;margin-top:10px;padding:13px;border-radius:8px;border:1.5px solid #2563eb;background:#EFF6FF;color:#1d4ed8;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">📤 Send to Client Hub — client signs remotely</button>'+
    '</div>';
  ov.appendChild(doc);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov){_coSignDrawing=false;ov.remove();}});
  // Store CO data on the element for retrieval
  ov.dataset.coData=JSON.stringify(coData);
  // Wire up signature canvas — AbortController ensures listeners die with the overlay
  const _coSignAc=new AbortController();
  const _coSignSig={signal:_coSignAc.signal};
  ov.addEventListener('remove',()=>{_coSignAc.abort();_coSignDrawing=false;},{once:true});
  // Abort when overlay is removed from DOM (MutationObserver watches for detach)
  const _coSignObs=new MutationObserver(()=>{if(!document.contains(ov)){_coSignAc.abort();_coSignDrawing=false;_coSignObs.disconnect();}});
  _coSignObs.observe(document.body,{childList:true,subtree:true});
  setTimeout(()=>{
    const canvas=document.getElementById('co-sign-canvas');if(!canvas)return;
    _coSignCanvas=canvas;_coSignCtx=canvas.getContext('2d');
    _coSignCtx.strokeStyle='#111';_coSignCtx.lineWidth=2;_coSignCtx.lineCap='round';_coSignCtx.lineJoin='round';
    const getPos=(e)=>{const r=canvas.getBoundingClientRect();const src=e.touches?e.touches[0]:e;return{x:(src.clientX-r.left)*(canvas.width/r.width),y:(src.clientY-r.top)*(canvas.height/r.height)};};
    canvas.addEventListener('mousedown',e=>{_coSignDrawing=true;const p=getPos(e);_coSignCtx.beginPath();_coSignCtx.moveTo(p.x,p.y);},_coSignSig);
    canvas.addEventListener('mousemove',e=>{if(!_coSignDrawing)return;const p=getPos(e);_coSignCtx.lineTo(p.x,p.y);_coSignCtx.stroke();},_coSignSig);
    canvas.addEventListener('mouseup',()=>_coSignDrawing=false,_coSignSig);
    canvas.addEventListener('touchstart',e=>{e.preventDefault();_coSignDrawing=true;const p=getPos(e);_coSignCtx.beginPath();_coSignCtx.moveTo(p.x,p.y);},{passive:false,signal:_coSignAc.signal});
    canvas.addEventListener('touchmove',e=>{e.preventDefault();if(!_coSignDrawing)return;const p=getPos(e);_coSignCtx.lineTo(p.x,p.y);_coSignCtx.stroke();},{passive:false,signal:_coSignAc.signal});
    canvas.addEventListener('touchend',()=>_coSignDrawing=false,_coSignSig);
  },100);
}

function _clearCOCanvas(){
  if(_coSignCanvas&&_coSignCtx)_coSignCtx.clearRect(0,0,_coSignCanvas.width,_coSignCanvas.height);
}

function _submitCOSign(bidId,clientId){
  const b=bids.find(x=>x.id===bidId);if(!b)return;
  const signerName=(document.getElementById('co-sign-name')?.value||'').trim();
  if(!signerName){const el=document.getElementById('co-sign-name');if(el){el.style.borderColor='#A32D2D';el.focus();}zAlert('Type the client\'s full name to confirm.',{title:'Name required'});return;}
  // Check canvas has something drawn
  let sigData='';
  if(_coSignCanvas){
    const d=_coSignCtx.getImageData(0,0,_coSignCanvas.width,_coSignCanvas.height).data;
    const hasSig=Array.from(d).some((v,i)=>i%4===3&&v>0);
    if(!hasSig){zAlert('Client needs to sign in the box above.',{title:'Signature required'});return;}
    sigData=_coSignCanvas.toDataURL('image/png');
  }
  // Retrieve coData stored on overlay
  const ov=document.getElementById('co-sign-canvas')?.closest('[style*=fixed]');
  const coData=ov?.dataset?.coData?JSON.parse(ov.dataset.coData):null;
  if(!coData)return;
  const{desc,type,amount,delta,originalAmount,newAmount,coNum}=coData;
  // Save CO
  if(!b.changeOrders)b.changeOrders=[];
  b.changeOrders.push({
    id:Date.now(),coNum,date:todayKey(),desc,type,amount,delta,
    originalAmount,newAmount,
    signedAt:new Date().toISOString(),signerName,sigData
  });
  b.amount=newAmount;
  saveAll();renderDash();renderJobsPage();
  ov?.remove();
  showToast('CO #'+coNum+' signed — new total '+fmt(newAmount),'📋');
  setTimeout(()=>openJobSheet(clientId),300);
}

// Remote signing: save the CO as pending, write it onto the bid's signed_proposals
// row (jsonb change_orders), and refresh the hub JSON so the client sees it.
// The client signs in client.html; cloud.js checkNewSignatures() applies the
// signature back to the local bid (same bookkeeping as _submitCOSign).
async function _sendCOToHub(bidId,clientId){
  const b=bids.find(x=>x.id===bidId);if(!b)return;
  const ov=document.getElementById('co-sign-canvas')?.closest('[style*=fixed]');
  const coData=ov?.dataset?.coData?JSON.parse(ov.dataset.coData):null;
  if(!coData)return;
  const{desc,type,amount,delta,originalAmount,newAmount,coNum}=coData;
  if(!b.changeOrders)b.changeOrders=[];
  const co={id:Date.now(),coNum,date:todayKey(),desc,type,amount,delta,originalAmount,newAmount,status:'pending_client',sentAt:new Date().toISOString()};
  b.changeOrders.push(co);
  saveAll();renderDash();renderJobsPage();
  ov?.remove();
  if(!supaEnabled()||!_supaUser){
    showToast('CO #'+coNum+' sent to client hub — awaiting signature','📤');
    setTimeout(()=>openJobSheet(clientId),300);
    return;
  }
  // Notify step: the client never sees the pending CO unless they open their
  // hub — prompt the contractor to text them the link (after openJobSheet so
  // the notify modal stacks on top).
  setTimeout(()=>{openJobSheet(clientId);_showCONotifyModal(clientId,coNum);},300);
  try{
    const entry={coNum,desc,type,amount,delta,originalAmount,newAmount,sentAt:co.sentAt,signedAt:null,signerName:null,signatureData:null};
    // One signed_proposals row per bid — append to it, or create it for bids
    // signed before the table existed (in-person/cash signings).
    const{data:rows}=await _supa.from('signed_proposals').select('id,change_orders')
      .eq('bid_id',String(bidId)).eq('contractor_user_id',_supaUser.id).limit(1);
    const row=rows&&rows[0];
    if(row){
      const arr=(Array.isArray(row.change_orders)?row.change_orders:[]).filter(x=>x&&x.coNum!==coNum);
      arr.push(entry);
      const{error}=await _supa.from('signed_proposals').update({change_orders:arr}).eq('id',row.id);
      if(error)throw error;
    }else{
      const c=getClientById(b.client_id)||{};
      const{error}=await _supa.from('signed_proposals').insert({
        bid_id:String(bidId),contractor_user_id:_supaUser.id,
        client_name:c.name||b.client_name||'Client',
        amount:b.amount,deposit:b.deposit||0,change_orders:[entry]
      });
      if(error)throw error;
    }
  }catch(e){console.warn('CO hub send:',e);}
  _refreshClientHub(clientId).catch(()=>{});
}

// "Send to client" modal shown after a CO lands in the hub — the EXACT same
// send path as proposals: Text / Email / Other-app, same overlay layout as
// _showGeiSendOverlay, email goes through the shared compose modal + Resend.
let _coShareData=null;
function _showCONotifyModal(clientId,coNum){
  const c=getClientById(clientId);
  if(!c||!_supaUser)return;
  if(!c.clientToken){
    c.clientToken=Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b=>b.toString(16).padStart(2,'0')).join('');
    saveAll();
  }
  const url=_clientBaseUrl()+'client.html?t='+c.clientToken+'&u='+_effectiveUid()+'&c='+clientId;
  _coShareData={url,cname:c.name||'Client',bname:S.bname||'TradeDesk',cphone:(c.phone||'').replace(/\D/g,''),cemail:c.email||'',coNum,clientId};
  document.getElementById('_co-send-overlay')?.remove();
  const ov=document.createElement('div');
  ov.id='_co-send-overlay';
  ov.style.cssText='position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:20px';
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  ov.innerHTML=
    '<div style="width:100%;max-width:420px;background:var(--bg);border-radius:var(--r);padding:22px 16px 24px;box-sizing:border-box">'+
      '<div style="font-size:15px;font-weight:800;color:var(--blue-dk);margin-bottom:16px;text-align:center">✓ CO #'+coNum+' ready — send to client</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">'+
        '<button onclick="_doCOSend(\'sms\')" class="btn" style="padding:14px;font-size:15px;font-weight:700;background:var(--blue);color:#fff;border-color:var(--blue);text-align:center;justify-content:center">📱 Text</button>'+
        '<button onclick="_doCOSend(\'email\')" class="btn" style="padding:14px;font-size:15px;font-weight:700;background:var(--blue);color:#fff;border-color:var(--blue);text-align:center;justify-content:center">✉️ Email</button>'+
      '</div>'+
      '<button onclick="_doCOSend(\'other\')" class="btn" style="width:100%;padding:11px;font-size:14px;font-weight:600;background:var(--bg2);color:var(--text2);border-color:var(--border2);text-align:center;justify-content:center;box-sizing:border-box">⬆️ Other app (WhatsApp, AirDrop…)</button>'+
      '<div style="font-size:11px;color:var(--text3);margin-top:10px;text-align:center">'+escHtml(c.name||'The client')+' signs the change order in their project hub.</div>'+
    '</div>';
  document.body.appendChild(ov);
}
function _doCOSend(type){
  document.getElementById('_co-send-overlay')?.remove();
  if(type==='sms')_sendCOViaSms();
  else if(type==='email')_sendCOViaEmail();
  else _shareCOLink();
}
function _sendCOViaSms(){
  const d=_coShareData;if(!d)return;
  if(!d.cphone){zAlert('No phone number on file for this client. Add one in Clients first.',{title:'No client phone'});return;}
  const firstName=d.cname.split(/[\s,&]+/)[0];
  const msg='Hey '+firstName+'!\n\nQuick update on your project — Change Order #'+d.coNum+' is ready for your review. Tap the link below to see the details and sign when you\'re ready:\n\n'+d.url+'\n\nAny questions at all, just shoot me a text!\n\n— '+d.bname;
  // Fire SMS FIRST while the user gesture is fresh (same as sendProposalViaSms)
  window.location.href='sms:'+d.cphone+'?body='+encodeURIComponent(msg);
  setTimeout(()=>autoLogContact(d.clientId,'change_order_sent'),400);
}
function _sendCOViaEmail(){
  const d=_coShareData;if(!d)return;
  const firstName=d.cname.split(/[\s,&]+/)[0];
  _showEmailComposeModal(d,{
    title:'✉️ Email change order',
    subject:'Change Order #'+d.coNum+' from '+d.bname+' — signature needed',
    body:'Hey '+firstName+',\n\nQuick update on your project — Change Order #'+d.coNum+' is ready for your review. It lays out the change in scope and the updated contract total, and you can sign it right from your project hub:\n\n'+d.url+'\n\nDon\'t hesitate to reach out with any questions!\n\n'+d.bname,
    clientId:d.clientId,
    onSent:()=>{autoLogContact(d.clientId,'change_order_sent');showToast('Change order emailed to '+d.cname+'!','✉️');}
  });
}
function _shareCOLink(){
  const d=_coShareData;if(!d)return;
  autoLogContact(d.clientId,'change_order_sent');
  pwaShare({
    title:d.bname+' Change Order',
    text:'Hi '+d.cname.split(' ')[0]+' — Change Order #'+d.coNum+' from '+d.bname+' needs your signature. Review and sign in your project hub.',
    url:d.url
  });
}

// legacy alias kept so any old calls still work
