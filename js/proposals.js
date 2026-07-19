// ── Gallery ──────────────────────────────────────────────────────────────────
let _galleryFilter='all';
// ── RRP compliance ────────────────────────────────────────────────────────────
let _rrpPaintAnswer=''; // 'yes' | 'no' | '' (unanswered)

function setGalleryFilter(f,btn){
  _galleryFilter=f;
  document.querySelectorAll('#pg-gallery .fb').forEach(b=>{b.classList.remove('active');});
  if(btn)btn.classList.add('active');
  renderGallery();
}
// Egress fix: route public gallery images through the Cloudflare edge cache
// (/img/<path>, functions/img/[[path]].js) when the app is served from
// Cloudflare: repeat views across every device hit Cloudflare, not Supabase.
// Localhost/dev (no Pages Functions) and non-storage URLs pass through as-is.
function _cdnPhoto(u){
  try{
    if(!u||u.startsWith('data:'))return u;
    if(location.hostname==='localhost'||location.hostname==='127.0.0.1')return u;
    const m=u.match(/\/storage\/v1\/object\/public\/(gallery\/.+)$/);
    return m?'/img/'+m[1]:u;
  }catch(_e){return u;}
}
// onerror handler for CDN-routed images: retry the direct URL once (covers an
// undeployed /img route or edge miss failure), THEN hide, never a broken tile.
function _imgFallback(el){
  const d=el.dataset?el.dataset.dsrc:'';
  if(d&&el.src!==d){el.src=d;return;}
  el.style.display='none';
}
function renderGallery(){
  const el=document.getElementById('gallery-grid');if(!el)return;
  const sub=document.getElementById('gallery-count-sub');
  const filtered=photos.filter(p=>_galleryFilter==='all'||p.type===_galleryFilter);
  if(sub)sub.textContent=filtered.length+' photo'+(filtered.length!==1?'s':'');
  if(!filtered.length){
    el.innerHTML='<div class="empty-state"><div class="empty-state-icon">'+svgIcon('📷',{size:44})+'</div><h3>No photos yet</h3><p>Tap "+ Add photos" to upload before/after shots of your jobs. Photos will appear in client proposals and portals.</p></div>';
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
        '<img src="'+_cdnPhoto(p.thumbUrl||p.url)+'" data-dsrc="'+escHtml(p.thumbUrl||p.url)+'" style="width:100%;height:100%;object-fit:cover" loading="lazy" onerror="_imgFallback(this)">'+
        '<div style="position:absolute;bottom:0;left:0;right:0;background:linear-gradient(transparent,rgba(0,0,0,.6));padding:4px 6px">'+
          '<span style="font-size:9px;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:.04em">'+escHtml(p.type)+'</span>'+
        '</div>'+
        '<button onclick="event.stopPropagation();deletePhoto(\''+p.id+'\')" style="position:absolute;top:4px;right:4px;background:rgba(0,0,0,.5);border:none;color:#fff;border-radius:50%;width:20px;height:20px;font-size:10px;cursor:pointer;line-height:1;display:flex;align-items:center;justify-content:center">'+svgIcon('✕',{size:12})+'</button>'+
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
    '<button onclick="this.closest(\'div\').remove()" style="position:absolute;top:16px;right:16px;background:rgba(255,255,255,.15);border:none;color:#fff;border-radius:50%;width:36px;height:36px;font-size:18px;cursor:pointer;line-height:1">'+svgIcon('✕',{size:18})+'</button>'+
    '<img src="'+_cdnPhoto(p.url)+'" data-dsrc="'+escHtml(p.url)+'" onerror="_imgFallback(this)" style="max-width:100%;max-height:80vh;border-radius:var(--r);object-fit:contain">'+
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
    .map(j=>'<option value="'+j.id+'"'+(jobId===j.id?' selected':'')+'>'+escHtml(j.name)+', '+escHtml(clients.find(c=>c.id===j.client_id)?.name||'')+'</option>').join('');
  box.innerHTML=
    '<div style="font-size:17px;font-weight:800;margin-bottom:4px">'+svgIcon('📷')+' Add photo</div>'+
    '<div style="font-size:12px;color:var(--text3);margin-bottom:16px">Upload a job photo to your gallery</div>'+
    '<div class="f" style="margin-bottom:12px"><label>Photo type</label>'+
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">'+
        ['before','after','progress'].map(t=>'<label style="display:flex;align-items:center;justify-content:center;gap:4px;padding:10px;border:2px solid var(--border2);border-radius:var(--r);cursor:pointer;font-size:13px;font-weight:600">'+
          '<input type="radio" name="photo-type" value="'+t+'" style="display:none" onchange="this.closest(\'label\').closest(\'div\').querySelectorAll(\'label\').forEach(l=>l.style.borderColor=\'var(--border2)\');this.closest(\'label\').style.borderColor=\'var(--blue)\'">'+
          {before:svgIcon('📸')+' Before',after:svgIcon('✅')+' After',progress:svgIcon('🔨')+' Progress'}[t]+'</label>').join('')+
      '</div>'+
    '</div>'+
    (jobOptions?'<div class="f" style="margin-bottom:12px"><label>Job <span style="font-weight:400;color:var(--text3)">(optional)</span></label><select id="gup-job" style="font-size:14px;padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);width:100%;color:var(--text);font-family:inherit"><option value="">- No job selected -</option>'+jobOptions+'</select></div>':'')+
    '<div class="f" style="margin-bottom:12px"><label>Caption <span style="font-weight:400;color:var(--text3)">(optional)</span></label><input id="gup-caption" placeholder="e.g. Living room accent wall" style="font-size:14px;padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);width:100%;color:var(--text);font-family:inherit"></div>'+
    '<input type="file" id="gup-file" accept="image/*" multiple style="display:none" onchange="processGalleryUpload(this)">'+
    '<button onclick="document.getElementById(\'gup-file\').click()" style="width:100%;padding:14px;border-radius:var(--r);border:2px dashed var(--border2);background:var(--bg);color:var(--text2);font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;margin-bottom:8px">'+svgIcon('📂')+' Choose photos</button>'+
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
      let url='',storagePath='',thumbUrl='',thumbPath='';
      if(supaEnabled()&&_supaUser){
        // Compress + thumbnail (egress fix, shared helper in jobs.js). null → original.
        const _cp=typeof _compressPhoto==='function'?await _compressPhoto(file):null;
        const ext=_cp?_cp.ext:(file.name.split('.').pop()||'jpg');
        const path='gallery/'+_effectiveUid()+'/'+Date.now()+'_'+Math.random().toString(36).slice(2)+'.'+ext;
        const{error}=await _supa.storage.from('gallery').upload(path,_cp?_cp.blob:file,{contentType:_cp?_cp.mime:file.type,upsert:false,cacheControl:typeof _PHOTO_CACHE!=='undefined'?_PHOTO_CACHE:'31536000'});
        if(!error){
          const{data:urlData}=_supa.storage.from('gallery').getPublicUrl(path);
          url=urlData?.publicUrl||'';
          if(url){
            storagePath=path;
            if(_cp&&typeof _uploadPhotoThumb==='function'){({thumbUrl,thumbPath}=await _uploadPhotoThumb(_cp.thumb,path));}
          }
        }
      }
      if(!url){
        // Fallback: base64 for offline (large but works)
        url=await new Promise(res=>{const r=new FileReader();r.onload=e=>res(e.target.result);r.readAsDataURL(file);});
      }
      photos.push({id:Date.now()+Math.random(),url,storagePath,thumbUrl,thumbPath,type:ptype,caption,job_id:selectedJobId,job_name:(job?job.name:null)||'',client_id:(c?c.id:null)||null,client_name:(c?c.name:null)||'',uploadedAt:new Date().toISOString()});
      uploaded++;
      if(status)status.textContent='Uploaded '+uploaded+'/'+files.length;
    }catch(e){console.warn('photo upload:',e);}
  }
  saveAll();renderGallery();
  if(status)status.innerHTML=svgIcon('✓')+' '+uploaded+' photo'+(uploaded!==1?'s':'')+' added';
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
      // Signed-document fields (diagnostic charges + any bid signed in person):
      // the hub renders these through the shared esign signed-doc block.
      kind:b.kind||'',desc:b.desc||'',signed:!!b.signed,signerName:b.signerName||'',sigData:b.sigData||'',
      lostReason:b.lostReason||'',lostNote:b.lostNote||'',lostAt:b.lostAt||'',
      proposalKey:propKey,signingToken:signToken||null,changeOrders:_hubCOs,
      signHubUrl:signBase?(signBase+(hubUrl?'&hub='+encodeURIComponent(hubUrl):'')):null};
  });
  const clientPhotos=photos.filter(p=>p.client_id===clientId);
  const snapshotJobs=cjobs.map(j=>{
    const jPhotos=clientPhotos.filter(p=>p.job_id===j.id).map(p=>({url:p.url,thumbUrl:p.thumbUrl||'',type:p.type,caption:p.caption||'',uploadedAt:p.uploadedAt||''}));
    return {id:j.id,bid_id:j.bid_id||null,name:j.name||'Job',start:j.start||'',days:j.days||0,status:j.status||'scheduled',completion_date:j.completion_date||'',photos:jPhotos};
  });
  const snapshotPayments=cpayments.map(p=>({date:p.date||'',type:p.type||'',amount:p.amount||0,bid_id:p.bid_id||null,ref:p.ref||'',method:p.method||''}));
  const jobPhotos=clientPhotos.map(p=>({url:p.url,thumbUrl:p.thumbUrl||'',type:p.type,caption:p.caption||'',job_name:p.job_name||'',job_id:p.job_id||null,uploadedAt:p.uploadedAt||''}));
  // Extract optional chaining BEFORE the return object, Safari crashes on ?. inside { }
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
    brandColor:adaBrand(S.brandColor)||'',
    // logoUrl when the CURRENT logo is confirmed uploaded (hash match); base64
    // logoData only as the fallback so the snapshot stays small in the normal
    // case. client.html renders logoUrl||logoData, old snapshots keep working.
    logoUrl:(S.logoUrl&&S.logoHash===String(_hubHash(S.logoData||'')))?S.logoUrl:'',
    logoData:(S.logoUrl&&S.logoHash===String(_hubHash(S.logoData||'')))?'':(S.logoData||''),
    bwebsite:S.bwebsite||'',
    // Trust signals (research: the #1 close-rate lever is trust clustered near the
    // sign CTA). Contractor-global, surfaced from Settings. HONESTY GATE: the
    // "Licensed & Insured" claim only renders for what the contractor can actually
    // back with a NUMBER on file, never the S.blic default string, never an
    // unbacked claim on a client-facing page:
    //   • Licensed  → S.blic is a real entry (not blank, not the default marker),
    //                 OR a non-insurance license record carries a license number.
    //   • Insured   → an Insurance-category record carries a policy number.
    // Both → "Licensed & Insured"; one → just that word; neither → no chip.
    // Reviews → only when the Google review URL is linked (below).
    trustLicense:(()=>{
      const _all=(typeof licenses!=='undefined'?licenses:[]);
      const _num=l=>String(l&&l.licenseNumber||'').trim();
      const _blic=String(S.blic||'').trim();
      const _blicReal=!!_blic && _blic.toLowerCase()!=='licensed & insured' && _blic.toLowerCase()!=='licensed and insured';
      const _hasLicense=_blicReal || _all.some(l=>l.cat!=='insurance' && l.cat!=='epa' && _num(l));
      const _hasInsurance=_all.some(l=>l.cat==='insurance' && _num(l));
      return _hasLicense&&_hasInsurance?'Licensed & Insured':_hasLicense?'Licensed':_hasInsurance?'Insured':'';
    })(),
    warrantyPeriod:S.warrantyPeriod||'',
    // Years in business computes LIVE from the "in business since" year so it
    // bumps itself every Jan 1, never a stale hand-entered number. Falls back to
    // the legacy manual byears for contractors who set that before this field.
    // A since-year in the current year → 0 → the hub hides the line (honest: a
    // <1-year business doesn't claim years).
    yearsInBusiness:(()=>{
      const _sy=parseInt(S.sinceYear)||0, _now=new Date().getFullYear();
      if(_sy>1900 && _sy<=_now) return _now-_sy;
      return parseInt(S.byears)||0;
    })(),
    reviewUrl:S.reviewUrl||'',
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
// Cheap deterministic hash of the hub JSON, gates redundant re-uploads.
function _hubHash(s){let h=0;for(let i=0;i<s.length;i++){h=((h<<5)-h+s.charCodeAt(i))|0;}return h;}
// Egress fix: the hub snapshot used to EMBED S.logoData (base64, "can be several
// MB" per data.js) in every client hub JSON, re-downloaded on every hub open and
// re-uploaded on every hub refresh, for every client. Upload the logo ONCE to
// storage (immutable, hash-addressed, long cache) and put a URL in the snapshot
// instead. Fallback chain keeps every failure mode on today's behavior: upload
// fails → snapshot embeds base64 exactly as before; old snapshots already out
// there carry logoData and client.html renders whichever field it finds.
async function _ensureLogoUrl(){
  try{
    if(typeof supaEnabled!=='function'||!supaEnabled()||!_supaUser||!S.logoData)return '';
    const _h=String(_hubHash(S.logoData));
    if(S.logoUrl&&S.logoHash===_h)return S.logoUrl; // current logo already uploaded
    const m=S.logoData.match(/^data:(image\/[a-z0-9+.-]+);base64,(.*)$/s);
    if(!m)return '';
    const bytes=Uint8Array.from(atob(m[2]),ch=>ch.charCodeAt(0));
    const blob=new Blob([bytes],{type:m[1]});
    const ext=(m[1].split('/')[1]||'png').replace('svg+xml','svg').replace('jpeg','jpg');
    // Hash in the path = a changed logo gets a NEW immutable URL; cacheControl a
    // year so browsers + CDN absorb every repeat view.
    const path=_effectiveUid()+'/branding/logo-'+_h.replace('-','n')+'.'+ext;
    const{error}=await _supa.storage.from('gallery').upload(path,blob,{contentType:m[1],upsert:true,cacheControl:'31536000'});
    if(error)return '';
    const{data}=_supa.storage.from('gallery').getPublicUrl(path);
    const url=data?data.publicUrl||'':'';
    if(url){S.logoUrl=url;S.logoHash=_h;saveAll();}
    return url;
  }catch(_e){return '';}
}
// ── Client-hub live push ──────────────────────────────────────────────────
// client.html polls its storage snapshot every 30s (_refreshHub) as the
// guaranteed path. This broadcast is purely an accelerator, a content-free
// "something changed, go refetch" nudge on a per-client Realtime channel,
// mirroring the sig-feed-<uid> pattern in cloud.js. No hub data rides on the
// broadcast itself (the token still gates the actual storage fetch), so a
// dropped or never-connected socket just falls back to the 30s poll, the
// client never sees stale-forever data either way.
const _hubBroadcastChans={};
function _broadcastHubUpdate(clientId){
  if(!supaEnabled()||!_supa)return;
  try{
    const chName='hub-upd-'+_effectiveUid()+'-'+clientId;
    let ch=_hubBroadcastChans[chName];
    if(!ch){
      ch=_supa.channel(chName);
      _hubBroadcastChans[chName]=ch;
      ch.subscribe(status=>{
        if(status==='SUBSCRIBED'){
          ch._tdReady=true;
          if(ch._tdPending){ch.send({type:'broadcast',event:'updated',payload:{}});ch._tdPending=false;}
        }
      });
    }
    if(ch._tdReady)ch.send({type:'broadcast',event:'updated',payload:{}});
    else ch._tdPending=true;
  }catch(_e){}
}
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
    // Logo lands in storage first so the snapshot carries a URL, not megabytes
    // of base64. Any failure returns '' and the snapshot embeds as before.
    await _ensureLogoUrl();
    const snapshot=_buildClientHubSnapshot(clientId);
    if(!snapshot)return;
    snapshot.token=c.clientToken;
    const _json=JSON.stringify(snapshot);
    // Skip the storage write when the hub content is unchanged since the last upload.
    // Boot used to re-push EVERY tokened client's hub (hundreds of identical /api
    // writes per load). A content hash gates it: only changed hubs upload, no data
    // loss, since any real change (incl. the daily finance-charge tick) hashes
    // differently and uploads.
    const _hash=_hubHash(_json);
    if(c.clientHubKey&&c.clientHubHash===_hash)return;
    const key='client-hub/'+_effectiveUid()+'/'+clientId+'_'+c.clientToken+'.json';
    const{error}=await _supa.storage.from('proposals').upload(key,_json,{contentType:'application/json',upsert:true,cacheControl:'0'});
    if(error)throw error;
    // Stamp the LIVE array object, not the reference captured before the await: a
    // delta/realtime merge during the upload replaces row objects in `clients`, so
    // writing to `c` can land on a dead object, the token/key silently vanish and
    // the uploaded hub becomes unreachable (seen live in the crew money-routing cert).
    const live=clients.find(x=>x.id===clientId)||c;
    live.clientToken=c.clientToken;
    live.clientHubKey=key;live.clientHubHash=_hash;
    saveAll();
    _broadcastHubUpdate(clientId);
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
    doUpload().catch(e=>{console.warn('hub refresh:',e);_queueHub();}); // file exists, return instantly, refresh in background
  }
  return url;
}
// ── Boot hub sweep, drift-repair backstop, PACED ─────────────────────────────
// Every real change already refreshes its own client's hub at the change site
// (bids/payments/jobs/logPayment call _uploadClientHub/_refreshClientHub inline).
// This sweep exists only to repair hubs that drifted while another device was
// authoritative. It used to fire EVERY tokened client CONCURRENTLY at boot,
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
  // Pause hook: precision specs (delta-sync's "exactly 1 row") set
  // window._hubSweepPause so the sweep's client-row stamps can't land inside
  // their measurement window. The queue holds and resumes when the flag clears.
  if(window._hubSweepPause){_hubSweepTimer=setTimeout(_tickHubSweep,1000);return;}
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
  const msg='Hi '+firstName+'! This is '+biz+'. Tap this link to share your address and project details so I can prepare your free quote, takes about 2 minutes: '+url;
  // Save sent timestamp
  const idx=clients.findIndex(x=>x.id===clientId);
  if(idx>=0){clients[idx].onboardingSentAt=new Date().toISOString();saveAll();}
  if(c.phone){
    window.location.href='sms:'+c.phone.replace(/\D/g,'')+'?body='+encodeURIComponent(msg);
  }else{
    // No phone, show the link to copy
    const ov=document.createElement('div');ov.className='zmodal-overlay';ov.style.cssText='align-items:center;padding:20px';
    const box=document.createElement('div');box.className='zmodal';
    box.innerHTML='<div style="font-size:17px;font-weight:800;margin-bottom:4px">Onboarding link</div>'+
      '<div style="font-size:13px;color:var(--text2);margin-bottom:12px">No phone on file, copy this link and send manually</div>'+
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
  // Refresh hub content silently in background, never blocks the share sheet
  _uploadClientHub(clientId).catch(()=>{});
  const firstName=c.name?.split(' ')[0]||'there';
  const biz=S.bname||'us';
  const ov=document.createElement('div');ov.className='zmodal-overlay';
  const box=document.createElement('div');box.className='zmodal';
  box.innerHTML=
    '<div style="font-size:17px;font-weight:800;margin-bottom:4px">'+svgIcon('📋')+' Client Hub ready</div>'+
    '<div style="font-size:12px;color:var(--text3);margin-bottom:14px">'+escHtml(c.name||'Client')+' · view proposals, pay balance, download invoices</div>'+
    '<div style="background:var(--bg);border:1px solid var(--border2);border-radius:var(--r);padding:10px 12px;font-size:11px;word-break:break-all;color:var(--text2);margin-bottom:14px;user-select:all">'+url+'</div>'+
    '<button id="_hub-copy-link-btn" style="width:100%;padding:12px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:8px">'+svgIcon('📋')+' Copy link</button>'+
    (c.phone?'<button onclick="this.closest(\'.zmodal-overlay\').remove();window.location.href=\'sms:\'+\''+c.phone.replace(/\D/g,'')+'\'+\'?body=\'+encodeURIComponent(\'Hi '+firstName+', here\\\'s your project hub from '+biz+', view your proposals, pay your balance, and download invoices anytime: '+url+'\')" style="width:100%;padding:12px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;margin-bottom:8px">'+svgIcon('📱')+' Send via Messages</button>':'')+
    '<button onclick="this.closest(\'.zmodal-overlay\').remove()" style="width:100%;padding:10px;border-radius:var(--r);border:none;background:none;color:var(--text3);font-size:13px;cursor:pointer;font-family:inherit">Close</button>';
  ov.appendChild(box);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  navigator.clipboard.writeText(url).catch(()=>{});
  // Wired via addEventListener (not an inline onclick string) since the success
  // state swaps in an SVG icon, inline HTML attributes can't safely carry the
  // quote characters an <svg ...> tag needs.
  box.querySelector('#_hub-copy-link-btn')?.addEventListener('click',function(){
    navigator.clipboard.writeText(url).then(()=>showToast('Copied!','📋'));
    this.innerHTML=svgIcon('✓')+' Copied';
  });
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
    // Same live-object rule as _uploadClientHub, never stamp a pre-await reference.
    const live=clients.find(x=>x.id===clientId)||c;
    live.clientHubKey=key;saveAll();
    _broadcastHubUpdate(clientId);
  }catch(e){console.warn('hub refresh:',e);}
}
function copyHubLink(url){navigator.clipboard.writeText(url).then(()=>showToast('Hub link copied','📋')).catch(()=>showToast('Could not copy, tap the URL above','⚠️'));}
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
  const mkBtn=(label,bg,color,fn)=>{const b=document.createElement('button');b.innerHTML=label;b.style.cssText='padding:14px;border:none;border-radius:var(--r);font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;background:'+bg+';color:'+color;b.onclick=fn;return b;};
  sheet.appendChild(hdr);
  sheet.appendChild(mkBtn(svgIcon('📋')+'  Copy link','var(--blue)','#fff',()=>{navigator.clipboard.writeText(hubUrl).then(()=>showToast('Hub link copied','📋')).catch(()=>showToast('Copy failed','⚠️'));ov.remove();}));
  sheet.appendChild(mkBtn(svgIcon('🔗')+'  Open hub','var(--blue-lt)','var(--blue)',()=>{ov.remove();window.location.href=hubUrl;}));
  sheet.appendChild(mkBtn('← Back','var(--bg2)','var(--text2)',()=>ov.remove()));
  ov.appendChild(sheet);
  document.body.appendChild(ov);
}

async function shortenUrl(url){
  // TODO: swap baseUrl to Cloudflare Pages domain (zjspainting.pages.dev) tomorrow
  return url;
}
function copyProposalLink(){
  const input=document.getElementById('proposal-link-input');
  if(!input)return;
  navigator.clipboard.writeText(input.value).catch(()=>{input.select();document.execCommand('copy');});
  const btn=document.querySelector('[onclick="copyProposalLink()"]');
  if(btn){btn.innerHTML=svgIcon('✓')+' Copied!';setTimeout(()=>btn.innerHTML=svgIcon('📋')+' Copy link',2000);}
}
function shareProposalLink(){
  const d=_proposalShareData();
  if(!d.url){showToast('Generate the link first','⚠️');return;}
  _commitProposalSent();
  pwaShare({
    title:d.bname+' Proposal',
    text:'Hi '+d.cname.split(' ')[0]+', '+d.bname+' sent your estimate. Tap to review and approve.',
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
      '<div style="font-size:15px;font-weight:800;color:var(--blue-dk);margin-bottom:16px;text-align:center">'+svgIcon('✓')+' Link ready, send to client</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">'+
        '<button onclick="_doGeiSend(\'sms\')" class="btn" style="padding:14px;font-size:15px;font-weight:700;background:var(--blue);color:#fff;border-color:var(--blue);text-align:center;justify-content:center">'+svgIcon('📱')+' Text</button>'+
        '<button onclick="_doGeiSend(\'email\')" class="btn" style="padding:14px;font-size:15px;font-weight:700;background:var(--blue);color:#fff;border-color:var(--blue);text-align:center;justify-content:center">'+svgIcon('✉')+' Email</button>'+
      '</div>'+
      '<button onclick="_doGeiSend(\'other\')" class="btn" style="width:100%;padding:11px;font-size:14px;font-weight:600;background:var(--bg2);color:var(--text2);border-color:var(--border2);text-align:center;justify-content:center;box-sizing:border-box">'+svgIcon('⬆️')+' Other app (WhatsApp, AirDrop…)</button>'+
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
  const defBname=S.bname||'TradeDesk';
  const d=_pendingShareData;
  return d?{url:d.url||'',cname:d.cname||'Client',bname:d.bname||defBname,cphone:d.cphone||'',cemail:d.cemail||''}:{url:'',cname:'Client',bname:defBname,cphone:'',cemail:''};
}
// Called when user actually taps SMS or Email, THIS is when the bid moves to "Sent proposals"
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
    // Snapshot the exact proposal HTML the client will sign, required for legal record
    const proposalEl=document.getElementById('est-proposal');
    if(proposalEl&&proposalEl.innerHTML.trim())bid.proposalHtml=proposalEl.innerHTML;
    saveAll();
    // Re-upload hub now that signingToken is committed, snapshot gets correct signHubUrl
    if(bid.client_id)_uploadClientHub(bid.client_id).catch(()=>{});
  }
  _pendingSignToken=null;
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
    ?'Hey '+firstName+'!\n\nGreat talking with you, your proposal is ready. Quick heads up: '+ownerName+' is building our local portfolio and has a special offer inside the proposal for you. Worth a look before you decide.\n\n'+d.url+'\n\nQuestions? Just reply. Talk soon!\n\n- '+d.bname
    :'Hey '+firstName+'!\n\nIt was great meeting with you today, really looking forward to the project.\n\nYour painting proposal is all ready to go. Tap the link below to view everything we went over and sign when you\'re ready:\n\n'+d.url+'\n\nAny questions at all, just shoot me a text. Talk soon!\n\n- '+d.bname;
  const href='sms:'+(d.cphone||'')+'?body='+encodeURIComponent(msg);
  // Fire SMS FIRST while user gesture is fresh, then commit bid as sent
  window.location.href=href;
  setTimeout(()=>_commitProposalSent(),400);
}
function sendProposalViaEmail(){
  const d=_proposalShareData();
  if(!d.url){zAlert('Generate the proposal link first.',{title:'No link yet'});return;}
  // Open compose modal, lets user review/edit subject+body and add email if missing
  _showEmailComposeModal(d);
}
// Shared compose modal, proposals use the defaults; other senders (change
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
  const defBody=(opts&&opts.body)||('Hey '+firstName+',\n\nIt was great meeting with you, I\'m looking forward to your project!\n\nYour proposal is ready to view. Everything we went over is laid out in full detail, and you can sign right from the page when you\'re ready to move forward:\n\n'+d.url+'\n\nOnce you sign, I\'ll get you locked in on the schedule and we\'ll take it from there.\n\nDon\'t hesitate to reach out with any questions, happy to go over anything!\n\nLooking forward to working with you,\n'+d.bname);
  const ov=document.createElement('div');
  ov.id='_email-compose-overlay';
  ov.style.cssText='position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:20px';
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  ov.innerHTML=
    '<div style="width:100%;max-width:520px;max-height:90vh;overflow-y:auto;background:var(--bg);border-radius:var(--r);padding:20px 16px 28px;box-sizing:border-box">'+
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">'+
        '<div style="font-size:17px;font-weight:800">'+((opts&&opts.title)||svgIcon('✉')+' Email proposal')+'</div>'+
        '<button onclick="document.getElementById(\'_email-compose-overlay\').remove()" style="background:none;border:none;font-size:22px;color:var(--text3);cursor:pointer;padding:0 4px;font-family:inherit">'+svgIcon('✕',{size:18})+'</button>'+
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
    // Also update the pending share data so future sends work
    if(_pendingShareData&&!_ctx)_pendingShareData.cemail=toVal;
  }
  const subject=(subjEl.value||'').trim()||'Your Proposal is Ready!';
  const bodyText=(bodyEl.value||'').trim();
  if(sendBtn){sendBtn.disabled=true;sendBtn.textContent='Sending…';}
  if(statusEl){statusEl.style.display='block';statusEl.textContent='Sending…';}
  // Try server-sent email (Resend). No mailto fallback, avoids double-send confusion.
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
      // Non-ok response, show error detail
      let errMsg='Send failed, check your internet and try again.';
      try{const ej=await res.clone().json();errMsg=ej.error||errMsg;}catch(_){}
      if(statusEl){statusEl.style.color='#A32D2D';statusEl.textContent='⚠️ '+errMsg;}
      if(sendBtn){sendBtn.disabled=false;sendBtn.textContent='Retry →';}
      return;
    }catch(err){
      const isTimeout=err?.message==='timeout';
      if(statusEl){statusEl.style.color='#A32D2D';statusEl.textContent=isTimeout?'⚠️ Request timed out, check your connection and retry.':'⚠️ Could not reach server. Check your internet connection.';}
      if(sendBtn){sendBtn.disabled=false;sendBtn.textContent='Retry →';}
      return;
    }
  }
  // No Supabase, open native mail with the composed text
  const href='mailto:'+encodeURIComponent(toVal)+'?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(bodyText);
  window.location.href=href;
  document.getElementById('_email-compose-overlay')?.remove();
  if(_ctx&&_ctx.opts.onSent){_ecContext=null;setTimeout(()=>_ctx.opts.onSent(),400);}
  else setTimeout(()=>_commitProposalSent(),400);
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
  // Previously granted on this device, skip modal entirely
  if(S.locationGranted){_grabLocCoords(onGranted,onDenied);return;}
  // Only block if denied and never previously granted
  if(S.locationDenied){if(onDenied)onDenied();return;}
  // Check OS-level permission, avoids showing our modal to users who already said yes
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
      '<div style="font-size:40px;margin-bottom:10px">'+svgIcon('📍',{size:40})+'</div>'+
      '<div style="font-size:18px;font-weight:800;margin-bottom:6px">Allow location access?</div>'+
      '<div style="font-size:13px;color:var(--text2);line-height:1.6">TradeDesk uses your location for:<br>'+
      '<strong>'+svgIcon('🌤')+' Live weather</strong> on your calendar<br>'+
      '<strong>'+svgIcon('🚗')+' GPS tracking</strong> for mileage deductions<br><br>'+
      'Your location is never shared or stored on our servers, it stays on your device only.</div>'+
    '</div>'+
    '<button id="loc-allow-btn" style="width:100%;padding:14px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:8px">Allow location access</button>'+
    '<button id="loc-deny-btn" style="width:100%;padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:none;font-size:13px;color:var(--text3);cursor:pointer;font-family:inherit">Not now, skip weather &amp; GPS</button>';
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  box.querySelector('#loc-allow-btn').onclick=()=>{
    overlay.remove();
    // Remember the explicit "Allow" IMMEDIATELY so the prompt is sticky, one tap, saved
    // forever. Previously locationGranted was only written inside _grabLocCoords' success
    // callback, so if the first OS coordinate fix was slow, timed out, errored, or the app
    // closed before it resolved, nothing persisted and the modal returned on the next launch.
    // (Denial already persisted immediately via the deny handler; this fixes the asymmetry.)
    S.locationGranted=true;S.locationDenied=false;S.settingsTs=Date.now();saveAll();
    _grabLocCoords(onGranted,()=>{
      // OS denied after user tapped allow, show gentle follow-up
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

  // Build prev-month leading cells (never mutate, create fresh Date each time)
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
  // Next-month trailing cells, fill to complete the last row
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
  // Fetch weather (cached: won't block render on repeat calls)
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
        if(job.eventType==='task'){const done=job.status==='done';return'<div class="cjob" style="background:'+(done?'#9CA3AF':'#6366F1')+';font-size:9px">'+(done?svgIcon('✓',{size:10})+' ':svgIcon('☐',{size:10})+' ')+escHtml(job.name)+'</div>';}
        return'<div class="cjob" style="background:'+(isBuf?lighten(job.color):job.color)+';'+(isBuf?'color:'+job.color+';':'')+'">'+(isBuf?'buf':(job.eventType==='estimate'?svgIcon('📋',{size:10})+' ':'')+escHtml(job.name))+'</div>';
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
              (done?svgIcon('☑',{size:17}):svgIcon('☐',{size:17}))+
            '</button>'+
            '<div style="flex:1;min-width:0">'+
              '<div style="font-size:13px;font-weight:700'+(done?';text-decoration:line-through;color:var(--text3)':'')+'">'+
                (job.time?'<span style="font-size:10px;color:#6366F1;font-weight:700;margin-right:6px">'+fmtTime(job.time)+'</span>':'')+
                job.name+
              '</div>'+
              (job.notes?'<div style="font-size:11px;color:var(--text3);margin-top:2px">'+job.notes+'</div>':'')+
              (()=>{const _c=(typeof clients!=='undefined'&&clients.find)?clients.find(x=>x.id===job.client_id):null;const _sn=(_c?getSiteNote(_c,job.addr||_c.addr):'').trim();return _sn?'<div style="font-size:11px;color:var(--text2);margin-top:2px"><strong>Site:</strong> '+escHtml(_sn)+'</div>':'';})()+
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
    // Hour-by-hour schedule, always shown so user can see open slots and book more
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
                '<div style="font-size:11px;font-weight:800;text-transform:uppercase;opacity:.85;margin-bottom:2px">'+(isEst?svgIcon('📋')+' Estimate':svgIcon('🎨')+' Paint job')+'</div>'+
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
      '<div class="zmodal-title" style="color:#6366F1">Add task, '+label+'</div>'+
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
  if(wrap)wrap.style.display=(sel.value==='Referral'||sel.value==='Referral: someone sent them')?'block':'none';
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

  const fmtLabel=v=>type==='profit'?(v===0?'-':fmt(v)):type==='close'?(v===0?'-':v+'%'):(v===0?'-':String(v));
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
      '<button id="kpi-chart-close" style="border:none;background:none;font-size:22px;cursor:pointer;color:var(--text3)">'+svgIcon('✕',{size:18})+'</button>'+
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
  },{title:'Won the job',yes:'Won: Schedule it'});
}
function markBidHandshake(bidId){
  zConfirm(
    'Handshake deals have no signed contract. If the client disputes payment or the scope, you have no legal protection.\n\nOnly use this as a last resort, you should always get a signature.',
    ()=>{
      const b=bids.find(x=>x.id===bidId);if(!b)return;
      b.status='Closed Won';b.handshake=true;b.handshake_date=todayKey();
      saveAll();renderCDBids();renderDash();
      showToast('Marked as handshake, no signed contract on file','🤝');
    },
    {title:svgIcon('🤝')+' Handshake deal, are you sure?',yes:'Yes, proceed without signature',no:'Cancel',danger:true}
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
    zAlert('Got it. Follow-up reset, check back in 7 days.',{title:'Snoozed 7 days'});
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
    '<div style="font-size:32px;margin-bottom:10px">'+svgIcon('⚠',{size:32})+'</div>'+
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
let _coBidId=null,_coClientId=null,_coType=null;

function showChangeOrderModal(bidId,clientId){
  const b=bids.find(x=>x.id===bidId);if(!b)return;
  _coBidId=bidId;_coClientId=clientId;_coType=null;
  const c=getClientById(b.client_id)||{name:b.client_name||'Client'};
  const coNum=(b.changeOrders||[]).length+1;
  // Build original scope summary
  const surfLines=(b.surfaces||[]).filter(s=>s.qty>0).map(s=>{
    const t=SURF_TYPES.find(x=>x.v===s.type);
    return t?t.label+(s.room?' ('+s.room.split(', ')[0]+')':''):'';
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
      '<button onclick="this.closest(\'.zmodal-overlay\').remove()" style="background:var(--bg2);border:1px solid var(--border2);color:var(--text3);font-size:18px;cursor:pointer;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;flex-shrink:0;line-height:1">'+svgIcon('✕',{size:16})+'</button>'+
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
      '<input type="text" id="co-amount" placeholder="0" inputmode="decimal" '+
        'style="font-size:26px;font-weight:800;padding:10px;border-radius:var(--r);border:1.5px solid var(--border2);background:var(--bg2);width:100%;box-sizing:border-box;color:var(--text);text-align:center;font-family:inherit" '+
        'oninput="_fmtMoneyInput(this);_previewCO('+bidId+')">'+
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
  const amt=_moneyVal('co-amount');
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
  const amt=_moneyVal('co-amount');
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
  const {desc,type,amount,delta,originalAmount,newAmount,coNum}=coData;
  const biz=S.bname||'TradeDesk';
  const dateStr=new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  // Build scope summary from original bid
  const surfLines=(b.surfaces||[]).filter(s=>s.qty>0).map(s=>{
    const t=SURF_TYPES.find(x=>x.v===s.type);
    return t?t.label+(s.room?' ('+s.room.split(', ')[0]+')':''):'';
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
      // The ONE shared signing pad (esign.js): name on top, canvas below.
      esignPadHTML('co-sign')+
      // The ONE shared consent block, same text as the job price-increase
      // sign-off, which is the same kind of document.
      esignConsentHTML('co-sign',ESIGN_NOTE_CHANGE_ORDER)+
      // Action buttons
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'+
        '<button onclick="this.closest(\'[style*=fixed]\').remove();showChangeOrderModal('+b.id+','+clientId+')" style="padding:13px;border-radius:8px;border:1.5px solid #d1d5db;background:#f9fafb;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;color:#374151">← Back</button>'+
        '<button onclick="_submitCOSign('+b.id+','+clientId+')" style="padding:13px;border-radius:8px;border:none;background:#2563eb;color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">'+svgIcon('✓')+' Sign Change Order</button>'+
      '</div>'+
      // Remote option, client reviews & signs from their hub instead of in person
      '<button id="co-send-hub-btn" onclick="_sendCOToHub('+b.id+','+clientId+')" style="width:100%;margin-top:10px;padding:13px;border-radius:8px;border:1.5px solid #2563eb;background:#EFF6FF;color:#1d4ed8;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">'+svgIcon('📤')+' Send to Client Hub, client signs remotely</button>'+
    '</div>';
  ov.appendChild(doc);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  // Store CO data on the element for retrieval
  ov.dataset.coData=JSON.stringify(coData);
  // Shared e-sign pad (esign.js): markup, listeners, typed-preview all live there.
  // Wired synchronously, the canvas is already in the DOM by this point, and
  // deferring via setTimeout only opens a window where a fast submit finds no
  // registered pad yet (esignResult returns "no-pad").
  esignWire('co-sign');
}

function _submitCOSign(bidId,clientId){
  const b=bids.find(x=>x.id===bidId);if(!b)return;
  const r=esignResult('co-sign',{requireDrawn:true});
  if(!r.ok){
    if(/name/i.test(r.err)){const el=document.getElementById('co-sign-name');if(el){el.style.borderColor='#A32D2D';el.focus();}zAlert('Type the client\'s full name to confirm.',{title:'Name required'});}
    else zAlert('Client needs to sign in the box above.',{title:'Signature required'});
    return;
  }
  const signerName=r.signerName,sigData=r.sigData;
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
  showToast('CO #'+coNum+' signed: new total '+fmt(newAmount),'📋');
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
    showToast('CO #'+coNum+' sent to client hub, awaiting signature','📤');
    setTimeout(()=>openJobSheet(clientId),300);
    return;
  }
  // Notify step: the client never sees the pending CO unless they open their
  // hub: prompt the contractor to text them the link (after openJobSheet so
  // the notify modal stacks on top). Scheduled BEFORE the flush below so the UI
  // timing is unaffected by how long the cloud write takes.
  setTimeout(()=>{openJobSheet(clientId);_showCONotifyModal(clientId,coNum);},300);
  // saveAll() above only SCHEDULES a debounced cloud write (2s timer), it never
  // confirms the CO actually reached td_bids before this function returns. Worse,
  // _showCONotifyModal above can call saveAll() a second time (for a client with
  // no clientToken yet), which restarts that same 2s timer, pushing the real
  // upload out even further. Force + await the write NOW so a caller that awaits
  // _sendCOToHub (or simply gives it a moment) can rely on the CO actually being
  // confirmed in the cloud, not merely scheduled.
  try{await _flushSaveNow();}catch(_e){}
  try{
    const entry={coNum,desc,type,amount,delta,originalAmount,newAmount,sentAt:co.sentAt,signedAt:null,signerName:null,signatureData:null};
    // One signed_proposals row per bid, append to it, or create it for bids
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

// "Send to client" modal shown after a CO lands in the hub, the EXACT same
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
      '<div style="font-size:15px;font-weight:800;color:var(--blue-dk);margin-bottom:16px;text-align:center">'+svgIcon('✓')+' CO #'+coNum+' ready: send to client</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">'+
        '<button onclick="_doCOSend(\'sms\')" class="btn" style="padding:14px;font-size:15px;font-weight:700;background:var(--blue);color:#fff;border-color:var(--blue);text-align:center;justify-content:center">'+svgIcon('📱')+' Text</button>'+
        '<button onclick="_doCOSend(\'email\')" class="btn" style="padding:14px;font-size:15px;font-weight:700;background:var(--blue);color:#fff;border-color:var(--blue);text-align:center;justify-content:center">'+svgIcon('✉')+' Email</button>'+
      '</div>'+
      '<button onclick="_doCOSend(\'other\')" class="btn" style="width:100%;padding:11px;font-size:14px;font-weight:600;background:var(--bg2);color:var(--text2);border-color:var(--border2);text-align:center;justify-content:center;box-sizing:border-box">'+svgIcon('⬆️')+' Other app (WhatsApp, AirDrop…)</button>'+
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
  const msg='Hey '+firstName+'!\n\nQuick update on your project, Change Order #'+d.coNum+' is ready for your review. Tap the link below to see the details and sign when you\'re ready:\n\n'+d.url+'\n\nAny questions at all, just shoot me a text!\n\n- '+d.bname;
  // Fire SMS FIRST while the user gesture is fresh (same as sendProposalViaSms)
  window.location.href='sms:'+d.cphone+'?body='+encodeURIComponent(msg);
  setTimeout(()=>autoLogContact(d.clientId,'change_order_sent'),400);
}
function _sendCOViaEmail(){
  const d=_coShareData;if(!d)return;
  const firstName=d.cname.split(/[\s,&]+/)[0];
  _showEmailComposeModal(d,{
    title:svgIcon('✉')+' Email change order',
    subject:'Change Order #'+d.coNum+' from '+d.bname+', signature needed',
    body:'Hey '+firstName+',\n\nQuick update on your project, Change Order #'+d.coNum+' is ready for your review. It lays out the change in scope and the updated contract total, and you can sign it right from your project hub:\n\n'+d.url+'\n\nDon\'t hesitate to reach out with any questions!\n\n'+d.bname,
    clientId:d.clientId,
    onSent:()=>{autoLogContact(d.clientId,'change_order_sent');showToast('Change order emailed to '+d.cname+'!','✉️');}
  });
}
function _shareCOLink(){
  const d=_coShareData;if(!d)return;
  autoLogContact(d.clientId,'change_order_sent');
  pwaShare({
    title:d.bname+' Change Order',
    text:'Hi '+d.cname.split(' ')[0]+', Change Order #'+d.coNum+' from '+d.bname+' needs your signature. Review and sign in your project hub.',
    url:d.url
  });
}

// legacy alias kept so any old calls still work
