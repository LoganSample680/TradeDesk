// ── Gallery ──────────────────────────────────────────────────────────────────
let _galleryFilter='all';
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
      '<div style="font-size:12px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;padding:0 2px">'+name+'</div>'+
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:6px">'+
      ps.map(p=>'<div onclick="openPhotoViewer(\''+p.id+'\')" style="position:relative;aspect-ratio:1;border-radius:var(--r);overflow:hidden;cursor:pointer;background:var(--bg2);border:1px solid var(--border)">'+
        '<img src="'+p.url+'" style="width:100%;height:100%;object-fit:cover" loading="lazy" onerror="this.style.display=\'none\'">'+
        '<div style="position:absolute;bottom:0;left:0;right:0;background:linear-gradient(transparent,rgba(0,0,0,.6));padding:4px 6px">'+
          '<span style="font-size:9px;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:.04em">'+p.type+'</span>'+
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
      '<div style="font-size:12px;font-weight:700;color:rgba(255,255,255,.7);text-transform:uppercase;letter-spacing:.06em">'+p.type+'</div>'+
      (p.caption?'<div style="font-size:13px;color:#fff;margin-top:4px">'+p.caption+'</div>':'')+
      '<div style="font-size:11px;color:rgba(255,255,255,.4);margin-top:4px">'+(p.client_name||'')+(p.job_name?' · '+p.job_name:'')+'</div>'+
    '</div>';
  document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
}
function deletePhoto(photoId){
  zConfirm('Delete this photo?',()=>{photos=photos.filter(p=>p.id!==photoId);saveAll();renderGallery();},{title:'Delete photo',yes:'Delete',danger:true});
}
function openGalleryUpload(jobId,clientId){
  const job=jobId?jobs.find(j=>j.id===jobId):null;
  const client=clientId?clients.find(c=>c.id===clientId):(job?clients.find(c=>c.id===job.client_id):null);
  const ov=document.createElement('div');ov.className='zmodal-overlay';
  const box=document.createElement('div');box.className='zmodal';
  const jobOptions=jobs.filter(j=>j.status==='done'||j.status==='active').slice(0,30)
    .map(j=>'<option value="'+j.id+'"'+(jobId===j.id?' selected':'')+'>'+j.name+' — '+(clients.find(c=>c.id===j.client_id)?.name||'')+'</option>').join('');
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
      let url='';
      if(supaEnabled()&&_supaUser){
        const ext=file.name.split('.').pop()||'jpg';
        const path='gallery/'+_supaUser.id+'/'+Date.now()+'_'+Math.random().toString(36).slice(2)+'.'+ext;
        const{error}=await _supa.storage.from('gallery').upload(path,file,{contentType:file.type,upsert:false});
        if(!error){
          const{data:urlData}=_supa.storage.from('gallery').getPublicUrl(path);
          url=urlData?.publicUrl||'';
        }
      }
      if(!url){
        // Fallback: base64 for offline (large but works)
        url=await new Promise(res=>{const r=new FileReader();r.onload=e=>res(e.target.result);r.readAsDataURL(file);});
      }
      photos.push({id:Date.now()+Math.random(),url,type:ptype,caption,job_id:selectedJobId,job_name:job?.name||'',client_id:c?.id||null,client_name:c?.name||'',uploadedAt:new Date().toISOString()});
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
    return {id:b.id,amount:b.amount||0,deposit:Math.round((b.amount||0)*0.25*100)/100,status:b.status,type:_hubType,bid_date:b.bid_date||'',completion_date:b.completion_date||'',paid,balance,
      proposalKey:propKey,signingToken:signToken||null,
      signHubUrl:signBase?(signBase+(hubUrl?'&hub='+encodeURIComponent(hubUrl):'')):null};
  });
  const snapshotJobs=cjobs.map(j=>({id:j.id,bid_id:j.bid_id||null,name:j.name||'Job',start:j.start||'',days:j.days||0,status:j.status||'scheduled',completion_date:j.completion_date||''}));
  const snapshotPayments=cpayments.map(p=>({date:p.date||'',type:p.type||'',amount:p.amount||0,bid_id:p.bid_id||null,ref:p.ref||'',method:p.method||''}));
  const jobPhotos=photos.filter(p=>p.client_id===clientId).map(p=>({url:p.url,type:p.type,caption:p.caption||'',job_name:p.job_name||''}));
  return {
    clientId,clientName:c.name,clientPhone:c.phone||'',clientAddr:c.addr||'',
    contractorName:S.bname||'TradeDesk',contractorPhone:S.bphone||'',
    brandColor:S.brandColor||'',logoData:S.logoData||'',bwebsite:S.bwebsite||'',
    contractorUserId:_supaUser?.id||'',notifyEmail:S.bemail||_supaUser?.email||'',
    stripeEnabled:!!(_stripeConnectStatus?.charges_enabled),
    yearBuilt:c.yearBuilt||null,
    epaRequired:!!(c.yearBuilt&&c.yearBuilt<1978&&getActiveTrade()==='painting'),
    epaAck:c.epaAck||false,
    trade:getActiveTrade(),
    hubUrl,token:c.clientToken||'',generatedAt:new Date().toISOString(),
    bids:snapshotBids,payments:snapshotPayments,jobs:snapshotJobs,photos:jobPhotos
  };
}
function _ensureClientToken(clientId){
  const c=clients.find(x=>x.id===clientId);
  if(!c||c.clientToken)return;
  c.clientToken=Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b=>b.toString(16).padStart(2,'0')).join('');
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
  const url=baseUrl+'client.html?t='+c.clientToken+'&u='+_supaUser.id+'&c='+clientId;
  const doUpload=async()=>{
    const snapshot=_buildClientHubSnapshot(clientId);
    if(!snapshot)return;
    snapshot.token=c.clientToken;
    const key='client-hub/'+_supaUser.id+'/'+clientId+'_'+c.clientToken+'.json';
    const{error}=await _supa.storage.from('proposals').upload(key,JSON.stringify(snapshot),{contentType:'application/json',upsert:true});
    if(error)throw error;
    c.clientHubKey=key;
    saveAll();
  };
  if(isNew){
    await doUpload(); // first time — must wait so the file exists before client opens link
  }else{
    doUpload().catch(e=>console.warn('hub refresh:',e)); // file exists — return instantly, refresh in background
  }
  return url;
}
function _relTime(ts){if(!ts)return'';try{const d=Math.round((Date.now()-new Date(ts).getTime())/60000);if(d<2)return'just now';if(d<60)return d+'m ago';if(d<1440)return Math.round(d/60)+'h ago';return Math.round(d/1440)+'d ago';}catch(e){return '';}}
function sendOnboardingLink(clientId){
  const c=getClientById(clientId);if(!c)return;
  if(!_supaUser){zAlert('Sign in to send the onboarding link.');return;}
  const baseUrl=_clientBaseUrl();
  const url=baseUrl+'client.html?mode=onboard&t='+c.clientToken+'&u='+_supaUser.id+'&c='+clientId;
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
  const url=baseUrl+'client.html?t='+c.clientToken+'&u='+_supaUser.id+'&c='+clientId;
  // Refresh hub content silently in background — never blocks the share sheet
  _uploadClientHub(clientId).catch(()=>{});
  const firstName=c.name?.split(' ')[0]||'there';
  const biz=S.bname||'us';
  const ov=document.createElement('div');ov.className='zmodal-overlay';
  const box=document.createElement('div');box.className='zmodal';
  box.innerHTML=
    '<div style="font-size:17px;font-weight:800;margin-bottom:4px">📋 Client Hub ready</div>'+
    '<div style="font-size:12px;color:var(--text3);margin-bottom:14px">'+(c.name||'Client')+' · view proposals, pay balance, download invoices</div>'+
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
  const key='client-hub/'+_supaUser.id+'/'+clientId+'_'+c.clientToken+'.json';
  try{
    const{error}=await _supa.storage.from('proposals').upload(key,JSON.stringify(snapshot),{contentType:'application/json',upsert:true});
    if(error)throw error;
    c.clientHubKey=key;saveAll();
  }catch(e){console.warn('hub refresh:',e);}
}
function copyHubLink(url){navigator.clipboard.writeText(url).then(()=>showToast('Hub link copied','📋')).catch(()=>showToast('Could not copy — tap the URL above','⚠️'));}
function showHubMenu(clientId){
  const c=clients.find(x=>x.id===clientId);
  if(!c?.clientToken||!_supaUser){sendClientHubLink(clientId);return;}
  const baseUrl=_clientBaseUrl();
  const hubUrl=baseUrl+'client.html?t='+c.clientToken+'&u='+_supaUser.id+'&c='+clientId;
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
  sheet.appendChild(mkBtn('🔗  Open hub','var(--blue-lt)','var(--blue)',()=>{const a=document.createElement('a');a.href=hubUrl;a.target='_blank';a.rel='noopener noreferrer';document.body.appendChild(a);a.click();document.body.removeChild(a);ov.remove();}));
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
      const freshBid={
        id:_newBidId(),
        client_id:estLinkedClientId||_resolvedBid?.client_id||null,
        client_name:cname,name:cname,
        phone:document.getElementById('e-cphone')?.value||_resolvedBid?.phone||'',
        addr:_caddr||_resolvedBid?.addr||'',
        bid_date:todayKey(),followup:addDays(todayKey(),7),
        amount:final||_resolvedBid?.amount||0,
        type:getBidIncomeLabel({surfaces:estSurfaces})||_resolvedBid?.type||'Painting job',
        days:_days,status:'Pending',
        notes:document.getElementById('e-cnotes')?.value||'',
        completion_date:'',collStage:'none',collHistory:[],
        scope:_ss,surfaces:[...estSurfaces],
        cond:document.getElementById('e-cond')?.value||'',
        paint:document.getElementById('e-paint')?.value||'',
        colors:document.getElementById('e-colors')?.value||'',
        roomScopeMap:JSON.parse(JSON.stringify(roomScopeMap||{})),
      };
      bids.unshift(freshBid);
      lastCreatedBidId=freshBid.id;
      bidId=freshBid.id;
    }
    const token=Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2);
    const proposalKey=`proposals/${_supaUser.id}/${bidId}_${token}.json`;
    const _bidForProp=bids.find(b=>b.id===bidId);
    // Always use live calcEst().final for amount — captures tier multiplier, adjustments, etc.
    // Never use bid.amount which may be stale from an earlier step before tier was set.
    const{final:_propFinal}=calcEst();
    if(_bidForProp)_bidForProp.amount=_propFinal; // keep bid record in sync
    const proposalData={
      id:bidId,token,clientName:cname,businessName:bname,
      contractorUserId:_supaUser.id,contractorEmail:_supaUser.email,
      proposalHtml:proposal.innerHTML,
      clientAddr:document.getElementById('e-caddr')?.value||_bidForProp?.addr||'',
      estDays:parseInt(document.getElementById('e-days')?.value)||_bidForProp?.days||2,
      amount:_propFinal,
      deposit:Math.round(_propFinal*0.25*100)/100,
      createdAt:new Date().toISOString(),status:'pending',
      notifyEmail:_supaUser.email,businessPhone:S.bphone||'',stripeConnectEnabled:!!(_stripeConnectStatus?.charges_enabled),
      isPortfolio:document.getElementById('portfolio-toggle')?.checked||false,
      portfolioPct:parseInt(document.getElementById('portfolio-pct')?.value)||15,
      portfolioTarget:5,
      portfolioYears:S.byears||0,
      portfolioOwnerName:getOwnerName()||'',
      fullPrice:_propFinal,
      discountedPrice:Math.round(_propFinal*(1-(parseInt(document.getElementById('portfolio-pct')?.value)||15)/100)*100)/100,
      adjustmentType:v('adj-type-hidden')||'',
      adjustmentReason:v('adj-reason-hidden')||'',
      adjustmentPct:parseInt(v('est-adj'))||0,
      yearBuilt:(()=>{const cl=_bidForProp?clients.find(c=>c.id===_bidForProp.client_id):null;return cl?.yearBuilt||null;})(),
      epaRequired:(()=>{const cl=_bidForProp?clients.find(c=>c.id===_bidForProp.client_id):null;return !!(cl?.yearBuilt&&cl.yearBuilt<1978&&getActiveTrade()==='painting');})(),
      trade:getActiveTrade(),
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
    const signingUrl=baseUrl+'sign.html?t='+token+'&u='+_supaUser.id+'&b='+bidId;
    const dateStr=new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
    const shortUrl=await shortenUrl(signingUrl);
    // Run proposal and hub uploads in parallel, each capped at 6s
    const _hubClientId=estLinkedClientId||bids.find(b=>b.id===bidId)?.client_id;
    const[uploadResult,_hu]=await Promise.all([
      Promise.race([_supa.storage.from('proposals').upload(proposalKey,JSON.stringify(proposalData),{contentType:'application/json',upsert:true}),new Promise((_,rej)=>setTimeout(()=>rej(new Error('timed out')),6000))]).catch(e=>({error:e})),
      _hubClientId?Promise.race([_uploadClientHub(_hubClientId),new Promise(r=>setTimeout(r,6000,null))]).catch(()=>null):Promise.resolve(null)
    ]);
    if(uploadResult?.error)console.warn('Storage upload issue (link may still work):',uploadResult.error?.message);
    let shareUrl=_hu||shortUrl;
    const bar=document.getElementById('proposal-link-bar');
    const input=document.getElementById('proposal-link-input');
    const labelEl=document.getElementById('proposal-link-label');
    const sublabelEl=document.getElementById('proposal-link-sublabel');
    const shorturlEl=document.getElementById('proposal-link-shorturl');
    if(bar){
      bar.style.display='block';
      bar.dataset.signingUrl=shareUrl;
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
  const firstName=d.cname.split(/[\s,&]+/)[0];
  const subject='Your Painting Proposal from '+d.bname+' is Ready!';
  const body=
    'Hey '+firstName+',\n\n'+
    'It was great meeting with you today — I really enjoyed getting a look at the project and I\'m excited to get started!\n\n'+
    'Your painting proposal is ready to view. Everything we went over is laid out in full detail, and you can sign right from the page when you\'re ready to move forward:\n\n'+
    '        '+d.url+'\n\n'+
    'Once you sign, I\'ll get you locked in on the schedule and we\'ll take it from there.\n\n'+
    'Don\'t hesitate to reach out if you have any questions or want to make any changes — happy to go over anything!\n\n'+
    'Looking forward to working with you,\n\n'+
    d.bname;
  const href='mailto:'+(d.cemail||'')+'?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body);
  // Fire email FIRST while user gesture is fresh, then commit bid as sent
  window.location.href=href;
  setTimeout(()=>_commitProposalSent(),400);
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
    html+='<div style="margin-top:6px;padding:8px 12px;background:#FEF3C7;border:1px solid #D97706;border-radius:6px;font-size:12px;color:#92400E"><strong>⚠ No Warranty:</strong> Customer-supplied paint. Contractor assumes no responsibility for color, coverage, or finish quality.</div>';
  }
  return html;
}
function buildProposal(){
  const{final,adj,laborTotal,matTotal,flatAdd,paintLines,coats}=calcEst();
  const adjReason=v('adj-reason-hidden');
  const bname=v('e-bname')||S.bname||'TradeDesk';
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
            '<span style="font-size:11px;font-weight:700;color:#2d3748">'+ps.surfLabel+'</span>'+
            (colorLine?'<span style="font-size:11px;color:#4a5568;font-weight:400"> — '+colorLine+'</span>':'')+
            (product?'<div style="font-size:10px;color:#94a3b8;line-height:1.2">'+product+'</div>':'')+
            '</div></div>';
        }).join('')+
        '</div>'
      :'';
    // Scope of Work — numbered list, all items
    const scopeHtml=roomScopeItems.length
      ?'<div style="margin-top:7px">'+
        '<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:4px">Scope of Work</div>'+
        '<ol style="margin:0;padding-left:18px;font-size:11px;color:#4a5568;line-height:1.7">'+
        roomScopeItems.map(sc=>'<li>'+sc.clientDesc+'</li>').join('')+
        '</ol></div>'
      :'';
    const _roomCustPaint=roomCosts[room]&&(roomScopeMap[room]?._customerPaint===true);
    const custPaintBadge=_roomCustPaint?'<span style="display:inline-block;font-size:10px;background:#FEF3C7;color:#856404;border:1px solid #D97706;border-radius:4px;padding:1px 6px;margin-left:6px;font-weight:700;vertical-align:middle">Client supplies paint</span>':'';
    const descContent='<div style="font-size:13px;font-weight:800;color:#1a365d;line-height:1.2;margin-bottom:3px">'+room+custPaintBadge+'</div>'+
      paintSpecHtml+
      scopeHtml;
    const rowBg=roomIdx%2===0?'#ffffff':'#f8fafc';
    return `<tr style="border-bottom:1px solid #e2e8f0;background:${rowBg}">
      <td style="padding:11px 18px 11px 14px;line-height:1.5;color:#2d3748;font-size:12px;border-left:3px solid #2a4a7f">${descContent}</td>
      <td style="padding:11px 18px 11px 4px;text-align:right;font-weight:700;vertical-align:top;color:#1a365d;white-space:nowrap">${fmt(r.total)}</td>
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
      <div style="font-size:14px;font-weight:700;color:#1a365d">${cname}</div>
      ${caddr?`<div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;margin-top:7px">Address</div><div style="font-size:12px;color:#4a5568;margin-top:1px">${caddr}</div>`:''}
      ${cphone?`<div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;margin-top:7px">Phone</div><div style="font-size:12px;color:#4a5568;margin-top:1px">${cphone}</div>`:''}
    </div>
    <div style="padding:14px 18px">
      <div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;margin-bottom:6px">Project</div>
      <div style="font-size:13px;font-weight:600;color:#1a365d">${cprop||'House'}</div>
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
      ${adj?`<tr style="border-bottom:1px solid #e2e8f0"><td style="padding:9px 18px;color:#718096;font-style:italic">${adjReason||'Price adjustment'}</td><td style="padding:9px 18px;text-align:right;color:#718096">${adj>0?'+':''}${fmt(adj)}</td></tr>`:''}
    </tbody>
    <tfoot>
      <tr style="background:#1a365d;color:#fff">
        <td style="padding:13px 18px;text-align:left;font-weight:800;font-size:15px;letter-spacing:.02em">TOTAL</td>
        <td style="padding:13px 18px;text-align:right;font-weight:800;font-size:15px">${fmt(proposalTotal)}</td>
      </tr>
      <tr style="background:#2a4a7f;color:rgba(255,255,255,.88)">
        <td style="padding:7px 18px;font-size:11px;font-weight:600">25% Deposit Due Before Work Begins</td>
        <td style="padding:7px 18px;text-align:right;font-size:12px;font-weight:700">${fmt(Math.round(proposalTotal*0.25*100)/100)}</td>
      </tr>
    </tfoot>
  </table>
  ${estSurfaces.some(s=>s.type==='ext_walls'||s.type==='ext_trim'||s.type==='deck')?`<div style="padding:10px 16px;background:#FEF3C7;border-top:1px solid #D97706;border-bottom:1px solid #D97706">
    <div style="font-size:10px;font-weight:800;text-transform:uppercase;color:#92400E;margin-bottom:4px">⚠ Weather Notice — Exterior Work</div>
    <div style="font-size:11px;color:#92400E;line-height:1.7">Exterior painting is weather-dependent. Start dates and completion timelines may shift based on temperature, rain, or high winds. Paint will not be applied to wet or damp surfaces. If surfaces were pressure washed, a minimum 48-hour dry time is required before painting begins. ${getBusinessName()} will communicate any weather-related delays promptly and reschedule at the earliest suitable date at no additional charge.</div>
  </div>`:''}
  <div style="padding:20px 24px;border-top:3px solid #1a365d;background:#f8fafc">
    <div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#1a365d;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid #e2e8f0">Payment Terms</div>
    <div style="font-size:11.5px;color:#2d3748;line-height:2">
      <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:2px"><span style="color:#1a365d;font-weight:700;min-width:16px">1.</span><span><strong>Deposit:</strong> 25% due before work begins.</span></div>
      <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:2px"><span style="color:#1a365d;font-weight:700;min-width:16px">2.</span><span><strong>Balance:</strong> Remainder due upon completion.</span></div>
      <div style="display:flex;align-items:baseline;gap:8px"><span style="color:#1a365d;font-weight:700;min-width:16px">3.</span><span><strong>Warranty:</strong> All workmanship warranted for 1 year.</span></div>
    </div>
    <div style="margin-top:10px;font-size:10px;color:#94a3b8;line-height:1.5">Full terms &amp; conditions — including cancellation, lien rights, and liability — are on the signing page.</div>
    <canvas id="proposal-notes-canvas" style="display:none"></canvas>
  </div>
  ${_portfolioOn?`<div style="margin:0 0 0;border-top:3px solid #16a34a;background:#f0fdf4;padding:18px 24px">
    <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#16a34a;margin-bottom:8px">Portfolio Showcase Offer</div>
    <div style="font-size:12px;color:#166534;line-height:1.7">We are currently selecting a limited number of showcase homes to feature across our Social Media. Your home has been selected. In exchange for permission to photograph your home before and after completion and feature it across our platforms, we are offering ${_portfolioPct}% off this project. No personal information is shared without your explicit permission.</div>
    <div style="margin-top:8px;font-size:11px;color:#16a34a;font-weight:700">Portfolio discount applied: ${_portfolioPct}% · You save ${fmt(Math.round(final*_portfolioPct/(100-_portfolioPct)))}</div>
  </div>`:''}
  <div style="padding:18px 24px;border-top:2px solid #e2e8f0;background:#f8fafc">
    <div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#1a365d;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid #e2e8f0">Terms &amp; Conditions</div>
    <div style="font-size:10.5px;color:#4a5568;line-height:1.85">
      <p style="margin:0 0 7px"><strong>1. Payment:</strong> A non-refundable 25% deposit is required before any work begins. The remaining balance is due upon completion of work.</p>
      <p style="margin:0 0 7px"><strong>2. Cancellation:</strong> If client cancels after materials have been purchased, contractor will make all purchased paint and materials available for client pickup and refund the deposit minus the documented cost of those materials. No additional cancellation fee will be charged beyond the materials cost.</p>
      <p style="margin:0 0 7px"><strong>3. Change Orders:</strong> This proposal covers only the scope described herein. Any additional work, surfaces, or materials not listed require a written change order signed by both parties and may be billed at the current rate.</p>
      <p style="margin:0 0 7px"><strong>4. Warranty:</strong> All workmanship is warranted for one (1) year from the date of completion. This warranty covers labor defects and application failures. It does not cover pre-existing surface conditions, substrate failure, moisture damage, or damage caused by events outside the contractor's control.</p>
      <p style="margin:0 0 7px"><strong>5. Limitation of Liability:</strong> Contractor is not responsible for damage to surfaces, structures, or contents that existed prior to the start of work, or for conditions not disclosed at the time of walkthrough. Client assumes all risk associated with pressure washing services on their property.</p>
      <p style="margin:0 0 7px"><strong>6. Materials &amp; Sales Tax:</strong> Contractor purchases all materials and pays applicable sales tax at the point of purchase. Sales tax on materials is incorporated into the project price and is not itemized separately on this proposal.</p>
      <p style="margin:0 0 7px"><strong>7. Mechanic's Lien Notice:</strong> Under Kansas law (K.S.A. 60-1101 et seq.), contractor has the right to file a mechanic's lien against this property for any amounts unpaid under this agreement. Client is hereby notified of this right.</p>
      <p style="margin:0">By signing, client acknowledges full agreement with all scope, pricing, and terms stated in this proposal. This constitutes a legally binding agreement pursuant to the Kansas Uniform Electronic Transactions Act (K.S.A. 16-1601 et seq.).</p>
    </div>
  </div>
</div>`;
  document.getElementById('est-sig-sum').innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px"><div><div style="font-size:15px;font-weight:700">${cname}</div><div style="font-size:12px;color:var(--text2)">${caddr}</div></div><div style="text-align:right"><div style="font-size:22px;font-weight:700;color:var(--blue)">${fmt(proposalTotal)}</div><div style="font-size:11px;color:var(--text3)">${estNum}</div></div></div>`;
  document.getElementById('est-terms').innerHTML='<strong style="color:#1a365d">Terms &amp; Conditions</strong><br><br>1. <strong>Payment:</strong> A non-refundable 25% deposit is required before any work begins. The remaining balance is due upon completion of work.<br><br>2. <strong>Cancellation:</strong> If client cancels after materials have been purchased, contractor will make all purchased paint and materials available for client pickup and refund the deposit minus the documented cost of those materials. No additional cancellation fee will be charged beyond the materials cost.<br><br>3. <strong>Change Orders:</strong> This proposal covers only the scope described herein. Any additional work, surfaces, or materials not listed require a written change order signed by both parties and may be billed at the current rate.<br><br>4. <strong>Warranty:</strong> All workmanship is warranted for one (1) year from the date of completion. This warranty covers labor defects and application failures. It does not cover pre-existing surface conditions, substrate failure, moisture damage, or damage caused by events outside the contractor\'s control.<br><br>5. <strong>Limitation of Liability:</strong> Contractor is not responsible for damage to surfaces, structures, or contents that existed prior to the start of work, or for conditions not disclosed at the time of walkthrough. Client assumes all risk associated with pressure washing services on their property.<br><br>6. <strong>Materials &amp; Sales Tax:</strong> Contractor purchases all materials and pays applicable Kansas sales tax at the point of purchase. Sales tax on materials is incorporated into the project price and is not itemized separately on this proposal.<br><br>7. <strong>Mechanic\'s Lien Notice:</strong> Under Kansas law (K.S.A. 60-1101 et seq.), contractor has the right to file a mechanic\'s lien against this property for any amounts unpaid under this agreement. Client is hereby notified of this right. Contractor will pursue all available legal remedies for non-payment, including lien filing.<br><br>By signing below, client acknowledges full agreement with all scope, pricing, and terms stated in this proposal. This document constitutes a legally binding agreement pursuant to the Kansas Uniform Electronic Transactions Act (K.S.A. 16-1601 et seq.).';
  document.getElementById('sig-date').value=ds;
  document.getElementById('sig-pname').value=cname;
  initSigPad();
  setTimeout(()=>{
    const c=document.getElementById('proposal-notes-canvas');if(!c)return;
    const dpr=window.devicePixelRatio||1;
    c.width=c.offsetWidth*dpr;c.height=64*dpr;
    c.style.width=c.offsetWidth/dpr+'px';c.style.height='64px';
    const ctx=c.getContext('2d');ctx.scale(dpr,dpr);
    ctx.strokeStyle='#185FA5';ctx.lineWidth=1.5;ctx.lineCap='round';
    let dn=false;
    const pt=e=>{const br=c.getBoundingClientRect(),s=e.touches?e.touches[0]:e;return{x:s.clientX-br.left,y:s.clientY-br.top};};
    c.onmousedown=c.ontouchstart=e=>{e.preventDefault();dn=true;const p=pt(e);ctx.beginPath();ctx.moveTo(p.x,p.y);};
    c.onmousemove=c.ontouchmove=e=>{e.preventDefault();if(!dn)return;const p=pt(e);ctx.lineTo(p.x,p.y);ctx.stroke();};
    c.onmouseup=c.ontouchend=()=>dn=false;
  },150);
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
  document.getElementById('est-done-sum').innerHTML=`<div style="display:grid;gap:6px;font-size:13px"><div style="display:flex;justify-content:space-between"><span style="color:var(--text2)">Client</span><strong>${cname}</strong></div><div style="display:flex;justify-content:space-between"><span style="color:var(--text2)">Contract total</span><strong style="color:var(--blue)">${fmt(final)}</strong></div><div style="display:flex;justify-content:space-between"><span style="color:var(--text2)">Deposit due now (25%)</span><strong style="color:var(--green)">${fmt(Math.round(final*.25*100)/100)}</strong></div><div style="display:flex;justify-content:space-between"><span style="color:var(--text2)">Balance on completion</span><strong>${fmt(Math.round(final*.75*100)/100)}</strong></div></div>`;
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
        b.amount=final;b.days=days;b.status='Closed Won';b.draft=false;
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
        draft.isPortfolio=document.getElementById('portfolio-toggle')?.checked||false;
        draft.portfolioPct=parseInt(document.getElementById('portfolio-pct')?.value)||15;
        draft.adjustmentType=v('adj-type-hidden')||'';draft.adjustmentReason=v('adj-reason-hidden')||'';draft.adjustmentPct=parseInt(v('est-adj'))||0;
      } else {
        // Fallback: no draft found, create fresh
        const exists=bids.find(b=>b.client_id===estLinkedClientId&&Math.abs(b.amount-final)<0.01&&b.bid_date===todayKey()&&b.status==='Pending');
        if(exists){exists.status='Closed Won';exists.notes=(exists.notes||'')+' Signed in person '+todayKey();lastCreatedBidId=exists.id;}
        else{const newBid={id:_newBidId(),client_id:estLinkedClientId,client_name:c?c.name:'',name:cname,phone:v('e-cphone'),addr:v('e-caddr'),bid_date:todayKey(),followup:'',amount:final,type:getBidIncomeLabel({surfaces:estSurfaces}),days,status:'Closed Won',notes:v('e-cnotes'),completion_date:'',scope:ss,surfaces:[...estSurfaces],cond:v('e-cond'),paint:v('e-paint'),colors:v('e-colors'),allowWeekend:document.getElementById('e-allow-weekend')?.checked||false};bids.unshift(newBid);lastCreatedBidId=newBid.id;}
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
  // Delete any unfinished Draft bid BEFORE nulling lastCreatedBidId
  // (saveAndExitEstimate already removes b.draft before calling this, so saved bids are safe)
  if(lastCreatedBidId){
    const orphanIdx=bids.findIndex(b=>b.id===lastCreatedBidId&&b.draft===true&&b.status!=='Pending');
    if(orphanIdx>-1){bids.splice(orphanIdx,1);saveAll();}
  }
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
  // Default paint to 'interior' if not yet set (Zach supplies by default)
  const paintEl=document.getElementById('e-paint');
  if(paintEl&&!paintEl.value)paintEl.value='interior';
  const paint=paintEl?.value||'';
  const days=parseInt(document.getElementById('e-days')?.value)||0;
  const ready=!!(nm&&ph&&addr&&paint&&days>=1);
  const btn=document.getElementById('est-s1-next');
  if(!btn)return;
  btn.disabled=!ready;
  if(ready){btn.style.background='var(--blue)';btn.style.color='#fff';btn.style.borderColor='var(--blue)';btn.style.cursor='pointer';}
  else{btn.style.background='var(--border2)';btn.style.color='var(--text3)';btn.style.borderColor='var(--border2)';btn.style.cursor='not-allowed';}
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
  if(n===4){
    if(!estSurfaces.length){zAlert('Add at least one room and surface before reviewing.',{title:'No surfaces yet'});return;}
    // Ensure paint supply defaults to interior if not yet set
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
  if(n===3)renderEstRunning();}

function cm(d){calMonth+=d;if(calMonth>11){calMonth=0;calYear++;}if(calMonth<0){calMonth=11;calYear--;}renderCalendar();}
function renderCalendar(){renderCalMonthLabel();renderCalGrid();renderCalAvail();renderCalConflicts();renderCalWeek();renderCalUpcoming();}
function renderCalMonthLabel(){const M=['January','February','March','April','May','June','July','August','September','October','November','December'];document.getElementById('cal-month-lbl').textContent=M[calMonth]+' '+calYear;}
function getJobsOnDay(key){const res=[];jobs.forEach(job=>{if(job.status==='canceled')return;const workDays=getJobWorkDays(job);if(workDays.includes(key)){res.push({job,isBuf:false});return;}const lastDay=workDays.length?workDays[workDays.length-1]:job.start;const b=parseInt(job.buffer)||0;for(let i=1;i<=b;i++){if(addDays(lastDay,i)===key){res.push({job,isBuf:true});return;}}});return res;}
function requestLocationPermission(onGranted, onDenied){
  if(S.weatherLat&&S.weatherLon){if(onGranted)onGranted();return;}
  if(S.locationDenied){if(onDenied)onDenied();return;}
  // Check OS-level permission first — avoids showing our modal to users who already said yes
  // (handles iOS PWA clearing localStorage between sessions)
  if(navigator.permissions&&navigator.permissions.query){
    navigator.permissions.query({name:'geolocation'}).then(p=>{
      if(p.status==='granted'){
        _grabLocCoords(onGranted,onDenied);
      }else if(p.status==='denied'){
        S.locationDenied=true;saveAll();if(onDenied)onDenied();
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
    S.locationDenied=false;saveAll();
    if(onGranted)onGranted();
  },()=>{S.locationDenied=true;saveAll();if(onDenied)onDenied();},{enableHighAccuracy:false,timeout:10000});
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
  const weather=await fetchWeather();
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
      dj.map(({job,isBuf})=>
        '<div class="cjob" style="background:'+(isBuf?lighten(job.color):job.color)+';'+(isBuf?'color:'+job.color+';':'')+'">'+(isBuf?'buf':(job.eventType==='estimate'?'📋 ':'')+job.name)+'</div>'
      ).join('')+
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
  const allDay=dj.filter(({job})=>!job.time&&job.eventType!=='estimate');
  const timedEvents=dj.filter(({job})=>job.time);

  el.innerHTML=
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding-bottom:10px;border-bottom:2px solid var(--border)">'+
      '<div>'+
        '<div style="font-size:15px;font-weight:700">'+label+'</div>'+
        '<div style="font-size:11px;color:var(--text3);margin-top:2px">'+dj.length+' event'+(dj.length>1?'s':'')+'</div>'+
      '</div>'+
      '<button onclick="closeCalDay()" style="border:none;background:none;font-size:20px;cursor:pointer;color:var(--text3)">&#10005;</button>'+
    '</div>'+
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
                '<button class="btn-del" onclick="deleteJob('+job.id+');closeCalDay();renderCalendar();" style="padding:4px 8px;font-size:10px">Delete</button>'+
              '</div>'+
            '</div>'+
          '</div>';
        }).join('')+
      '</div>'
    :'')+
    // Hour-by-hour schedule — always shown so Zach can see open slots and book more
    '<div>'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'+
        '<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--text3)">Schedule</div>'+
        '<button onclick="closeCalDay();schedFromDate(\''+key+'\')" style="border:none;background:var(--blue);color:#fff;border-radius:20px;padding:4px 12px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit">+ Book estimate</button>'+
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
                  '<button onclick="deleteJob('+job.id+');closeCalDay();renderCalendar();" style="border:none;background:rgba(255,255,255,.15);color:#fff;border-radius:4px;padding:4px 8px;font-size:10px;cursor:pointer;font-family:inherit">Delete</button>'+
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
function goToVehicleSettings(){
  window._scrollToVehicles=true;
  goPg('pg-settings');
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
        'By signing below, both parties agree to modify the original painting contract to reflect the scope and price changes described above. All other terms of the original contract remain in effect. This change order is legally binding upon signature per K.S.A. 16-1601 et seq.'+
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
    '</div>';
  ov.appendChild(doc);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  // Store CO data on the element for retrieval
  ov.dataset.coData=JSON.stringify(coData);
  // Wire up signature canvas
  setTimeout(()=>{
    const canvas=document.getElementById('co-sign-canvas');if(!canvas)return;
    _coSignCanvas=canvas;_coSignCtx=canvas.getContext('2d');
    _coSignCtx.strokeStyle='#111';_coSignCtx.lineWidth=2;_coSignCtx.lineCap='round';_coSignCtx.lineJoin='round';
    const getPos=(e)=>{const r=canvas.getBoundingClientRect();const src=e.touches?e.touches[0]:e;return{x:(src.clientX-r.left)*(canvas.width/r.width),y:(src.clientY-r.top)*(canvas.height/r.height)};};
    canvas.addEventListener('mousedown',e=>{_coSignDrawing=true;const p=getPos(e);_coSignCtx.beginPath();_coSignCtx.moveTo(p.x,p.y);});
    canvas.addEventListener('mousemove',e=>{if(!_coSignDrawing)return;const p=getPos(e);_coSignCtx.lineTo(p.x,p.y);_coSignCtx.stroke();});
    canvas.addEventListener('mouseup',()=>_coSignDrawing=false);
    canvas.addEventListener('touchstart',e=>{e.preventDefault();_coSignDrawing=true;const p=getPos(e);_coSignCtx.beginPath();_coSignCtx.moveTo(p.x,p.y);},{passive:false});
    canvas.addEventListener('touchmove',e=>{e.preventDefault();if(!_coSignDrawing)return;const p=getPos(e);_coSignCtx.lineTo(p.x,p.y);_coSignCtx.stroke();},{passive:false});
    canvas.addEventListener('touchend',()=>_coSignDrawing=false);
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

// legacy alias kept so any old calls still work
