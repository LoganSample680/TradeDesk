// ── Contracts / Agreements ───────────────────────────────────────────────────
// Standalone "Contracts" feature: the owner writes up agreements (profit-share,
// employment, custom), sends them for e-signature, and stores them organizably.
//
// NOTE: the global `contracts[]` array is already used by the maintenance /
// recurring-billing feature (js/contracts.js). This feature stores its records in
// a dedicated `agreements[]` array (localStorage key zp3_agreements, synced via the
// td_agreements Supabase table) so the two never collide.
//
// E-sign reuses the proposals storage bucket + the contract-sign.html portal,
// mirroring the proposals/sign.html token + JSON-snapshot pattern.

const AGREEMENT_TYPES=[
  {id:'profit_share',label:'Profit share',emoji:'📈'},
  {id:'employment',label:'Employment',emoji:'📝'},
  {id:'custom',label:'Custom',emoji:'📄'},
];
function _agTypeLabel(id){return(AGREEMENT_TYPES.find(t=>t.id===id)||{label:'Contract'}).label;}
function _agTypeEmoji(id){return(AGREEMENT_TYPES.find(t=>t.id===id)||{emoji:'📄'}).emoji;}

function _agFmtDate(iso){if(!iso)return'';try{const d=iso.length<=10?new Date(iso+'T00:00:00'):new Date(iso);return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});}catch(e){return iso;}}

function _agStatusChip(a){
  if(a.status==='signed'){
    const when=a.signedAt?(' '+_agFmtDate(a.signedAt)):'';
    return '<span style="display:inline-flex;align-items:center;gap:4px;background:var(--blue-lt,#e6f0fb);color:var(--blue);border-radius:20px;padding:3px 10px;font-size:11px;font-weight:700">✍️ Signed'+escHtml(when)+'</span>';
  }
  if(a.status==='sent'){
    return '<span style="display:inline-flex;align-items:center;gap:4px;background:#fff7e6;color:#92400e;border-radius:20px;padding:3px 10px;font-size:11px;font-weight:700">⏳ Sent</span>';
  }
  return '<span style="display:inline-flex;align-items:center;gap:4px;background:var(--bg3,#eef1f6);color:var(--text3);border-radius:20px;padding:3px 10px;font-size:11px;font-weight:700">📝 Draft</span>';
}

// Short one-line summary of the key term (e.g. "20% of net profit").
function _agKeyTerm(a){
  if(a.type==='profit_share'&&a.profitPct!=null&&a.profitPct!=='')return a.profitPct+'% of net profit';
  if(a.type==='employment')return 'Employment agreement';
  return a.title||'Custom contract';
}

let _agFilter='all';   // all | draft | sent | signed
let _agSearch='';

function setAgFilter(f){_agFilter=f;renderContracts();}
function _agSearchInput(val){_agSearch=val;_agRenderList();}

function renderContracts(){
  const body=document.getElementById('contracts-page-body');if(!body)return;
  let html='';
  // Disclaimer banner — mirrors the tone of the lien / tax-tool disclaimers.
  html+='<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:var(--r);padding:10px 14px;margin-bottom:14px;font-size:12px;color:#92400e;line-height:1.45">'+
    '⚠️ <strong>Not legal advice</strong> — these templates are organizational tools only. Have an attorney review before relying on this.</div>';
  // Search
  html+='<input id="contracts-search" oninput="_agSearchInput(this.value)" value="'+escHtml(_agSearch)+'" placeholder="Search by party name…" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:var(--r);background:var(--bg);color:var(--text);font-family:inherit;font-size:14px;box-sizing:border-box;margin-bottom:12px">';
  // Status filter chips
  const counts={all:agreements.length,draft:0,sent:0,signed:0};
  agreements.forEach(a=>{counts[a.status]=(counts[a.status]||0)+1;});
  const chips=[['all','All'],['draft','📝 Draft'],['sent','⏳ Sent'],['signed','✍️ Signed']];
  html+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">';
  chips.forEach(([id,lbl])=>{
    const active=_agFilter===id;
    html+='<button onclick="setAgFilter(\''+id+'\')" style="padding:5px 12px;border-radius:20px;border:1px solid '+(active?'var(--blue)':'var(--border)')+';background:'+(active?'var(--blue)':'var(--bg)')+';color:'+(active?'#fff':'var(--text)')+';font-size:12px;font-weight:600;font-family:inherit;cursor:pointer">'+lbl+' '+(counts[id]||0)+'</button>';
  });
  html+='</div>';
  html+='<div id="contracts-list"></div>';
  body.innerHTML=html;
  _agRenderList();
}

function _agRenderList(){
  const el=document.getElementById('contracts-list');if(!el)return;
  const q=_agSearch.trim().toLowerCase();
  let list=agreements.slice().sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
  if(_agFilter!=='all')list=list.filter(a=>a.status===_agFilter);
  if(q)list=list.filter(a=>(a.party||'').toLowerCase().includes(q)||(a.title||'').toLowerCase().includes(q));
  if(!list.length){
    el.innerHTML='<div style="text-align:center;padding:40px 20px;color:var(--text3)"><div style="font-size:40px;margin-bottom:12px">📄</div><div style="font-size:15px;font-weight:700;margin-bottom:6px">'+(agreements.length?'No matching contracts':'No contracts yet')+'</div><div style="font-size:13px">Write up a profit-share deal, employment agreement, or custom contract and send it for e-signature.</div><button onclick="openNewAgreement()" class="btn btn-p" style="margin-top:16px">+ New contract</button></div>';
    return;
  }
  let html='';
  list.forEach(a=>{
    html+='<div onclick="openAgreementDetail('+a.id+')" style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:14px;margin-bottom:10px;cursor:pointer">';
    html+='<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px">';
    html+='<div style="min-width:0"><div style="font-size:14px;font-weight:700;color:var(--text);line-height:1.3">'+escHtml(a.party||'Unnamed party')+'</div>';
    html+='<div style="font-size:12px;color:var(--text3);margin-top:2px">'+_agTypeEmoji(a.type)+' '+escHtml(_agTypeLabel(a.type))+(a.title?' · '+escHtml(a.title):'')+'</div></div>';
    html+=_agStatusChip(a);
    html+='</div>';
    html+='<div style="font-size:12px;color:var(--text2,#555);margin-top:4px">'+escHtml(_agKeyTerm(a))+'</div>';
    html+='</div>';
  });
  el.innerHTML=html;
}

// ── Templates ────────────────────────────────────────────────────────────────
function _agProfitShareBody(party,pct,cadence){
  const owner=getOwnerName()||getBusinessName()||'the Owner';
  const p=party||'{Party}';const x=(pct!=null&&pct!=='')?pct:'{X}';const c=cadence||'monthly';
  return p+' agrees to run all business operations — including all cash jobs, income, expenses, and mileage — through TradeDesk, logged accurately and in good faith. '+
    'In exchange, '+owner+' agrees to pay '+p+' '+x+'% of net profit (revenue minus materials, labor, and tracked business expenses), calculated and paid '+c+'.';
}
function _agEmploymentBody(party){
  const owner=getOwnerName()||getBusinessName()||'the Company';
  const p=party||'{Party}';
  return 'This Employment Agreement is entered into between '+owner+' ("Company") and '+p+' ("Employee").\n\n'+
    '1. At-Will Employment. Employment is at-will. Either party may end the employment relationship at any time, with or without cause or notice.\n\n'+
    '2. Duties & Conduct. Employee agrees to perform assigned duties in good faith, follow Company safety and quality standards, and accurately log time, jobs, and expenses through TradeDesk.\n\n'+
    '3. Location Tracking Consent. Employee consents to GPS location tracking on Company or personal devices during business hours for the purpose of job dispatch, time-on-site, and mileage records. Tracking is limited to the configured business-hours window and may be revoked by the Employee at any time.\n\n'+
    '4. Confidentiality. Employee will keep client lists, pricing, and business records confidential during and after employment.';
}

// ── New / edit modal ─────────────────────────────────────────────────────────
let _editingAgId=null;

function openNewAgreement(){_editingAgId=null;_showAgreementModal(null);}
function openEditAgreement(id){_editingAgId=id;_showAgreementModal(agreements.find(a=>a.id===id));}

function _showAgreementModal(a){
  document.getElementById('_ag-modal-ov')?.remove();
  const ov=document.createElement('div');ov.className='zmodal-overlay';ov.id='_ag-modal-ov';
  ov.onclick=e=>{if(e.target===ov)ov.remove();};
  const box=document.createElement('div');box.className='zmodal';
  // Modal entrance: fade + slide-up .22s per CLAUDE.md §8.4
  box.style.animation='td-ag-sheet .22s cubic-bezier(.22,1,.36,1) both';
  const t=a?.type||'profit_share';
  // Party picker options (clients + team members)
  let partyDatalist='<datalist id="_ag-party-list">';
  (clients||[]).forEach(c=>{if(c.name)partyDatalist+='<option value="'+escHtml(c.name)+'">';});
  (S.employees||[]).forEach(e=>{if(e.name)partyDatalist+='<option value="'+escHtml(e.name)+'">';});
  partyDatalist+='</datalist>';
  let typeOpts='';
  AGREEMENT_TYPES.forEach(tp=>{typeOpts+='<option value="'+tp.id+'"'+(t===tp.id?' selected':'')+'>'+tp.emoji+' '+tp.label+'</option>';});
  box.innerHTML=
    '<div style="font-size:17px;font-weight:800;margin-bottom:14px">'+(a?'Edit contract':'New contract')+'</div>'+
    '<div class="f"><label>Party name</label><input id="_ag-party" list="_ag-party-list" value="'+escHtml(a?.party||'')+'" placeholder="Partner or employee name">'+partyDatalist+'</div>'+
    '<div class="f"><label>Type</label><select id="_ag-type" onchange="_agTypeChanged()">'+typeOpts+'</select></div>'+
    '<div class="f"><label>Title</label><input id="_ag-title" value="'+escHtml(a?.title||'')+'" placeholder="e.g. Profit-Share Partnership"></div>'+
    '<div id="_ag-profit-fields" style="display:'+(t==='profit_share'?'block':'none')+'">'+
      '<div class="f"><label>Profit %</label><input id="_ag-pct" type="number" inputmode="decimal" value="'+(a?.profitPct!=null?escHtml(String(a.profitPct)):'')+'" placeholder="e.g. 20"></div>'+
      '<div class="f"><label>Payment cadence</label><input id="_ag-cadence" value="'+escHtml(a?.cadence||'monthly')+'" placeholder="e.g. monthly, quarterly"></div>'+
    '</div>'+
    '<div class="f"><label>Terms</label><textarea id="_ag-body" rows="8" style="width:100%;box-sizing:border-box;font-family:inherit;font-size:13px;line-height:1.5;padding:10px;border:1px solid var(--border);border-radius:var(--r);background:var(--bg);color:var(--text)">'+escHtml(a?.body||'')+'</textarea></div>'+
    '<div class="f"><label>Effective date</label><input id="_ag-eff" type="date" value="'+escHtml(a?.effectiveDate||todayKey())+'"></div>'+
    '<div style="font-size:11px;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:var(--r);padding:8px 10px;margin:4px 0 14px;line-height:1.4">⚠️ Not legal advice — have an attorney review before relying on this.</div>'+
    '<div style="display:flex;gap:8px">'+
      '<button onclick="this.closest(\'.zmodal-overlay\').remove()" class="btn" style="flex:1">Cancel</button>'+
      '<button onclick="_agSave()" class="btn btn-p" style="flex:1">Save</button>'+
    '</div>';
  ov.appendChild(box);document.body.appendChild(ov);
  // Prefill template body for a fresh contract if empty
  if(!a)_agApplyTemplate();
}

function _agTypeChanged(){_agApplyTemplate();
  const t=v('_ag-type');
  const pf=document.getElementById('_ag-profit-fields');if(pf)pf.style.display=t==='profit_share'?'block':'none';
}

// Fill the terms textarea with the template for the selected type — only when the
// box is empty or still holds an unedited template (so we never clobber edits).
function _agApplyTemplate(){
  const ta=document.getElementById('_ag-body');if(!ta)return;
  const t=v('_ag-type');
  const cur=ta.value.trim();
  const isTemplate=cur===''||ta.dataset.tpl==='1';
  if(!isTemplate)return;
  let body='';
  if(t==='profit_share')body=_agProfitShareBody(v('_ag-party'),v('_ag-pct'),v('_ag-cadence'));
  else if(t==='employment')body=_agEmploymentBody(v('_ag-party'));
  else body='';
  ta.value=body;
  ta.dataset.tpl=body?'1':'0';
  // Clear the template flag once the user types into it
  ta.oninput=()=>{ta.dataset.tpl='0';};
}

function _agSave(){
  const party=v('_ag-party').trim();
  const type=v('_ag-type');
  const title=v('_ag-title').trim();
  const body=v('_ag-body').trim();
  const pctRaw=v('_ag-pct').trim();
  const cadence=v('_ag-cadence').trim();
  const effectiveDate=v('_ag-eff');
  if(!party){zAlert('Enter a party name.');return;}
  if(!body){zAlert('Enter the contract terms.');return;}
  const profitPct=type==='profit_share'&&pctRaw!==''?parseFloat(pctRaw):null;
  if(_editingAgId){
    const a=agreements.find(x=>x.id===_editingAgId);
    if(a){Object.assign(a,{type,party,title,body,profitPct,cadence:type==='profit_share'?cadence:'',effectiveDate});}
  }else{
    agreements.push({
      id:Date.now(),type,party,title,body,profitPct,
      cadence:type==='profit_share'?cadence:'',
      partyClientId:(clients.find(c=>c.name===party)||{}).id||null,
      partyEmployeeId:((S.employees||[]).find(e=>e.name===party)||{}).id||null,
      effectiveDate,status:'draft',createdAt:new Date().toISOString(),
      signingToken:null,signingKey:null,signedAt:null,signerName:null,sigData:null
    });
  }
  saveAll();
  document.getElementById('_ag-modal-ov')?.remove();
  renderContracts();
  showToast(_editingAgId?'Contract updated':'Contract created','📄');
}

// ── Detail view ──────────────────────────────────────────────────────────────
function openAgreementDetail(id){
  const a=agreements.find(x=>x.id===id);if(!a)return;
  document.getElementById('_ag-detail-ov')?.remove();
  const ov=document.createElement('div');ov.className='zmodal-overlay';ov.id='_ag-detail-ov';
  ov.onclick=e=>{if(e.target===ov)ov.remove();};
  const box=document.createElement('div');box.className='zmodal';box.style.maxWidth='420px';
  box.style.animation='td-ag-sheet .22s cubic-bezier(.22,1,.36,1) both';
  let html='';
  html+='<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px">';
  html+='<div style="font-size:18px;font-weight:800;line-height:1.25">'+escHtml(a.title||_agTypeLabel(a.type))+'</div>'+_agStatusChip(a)+'</div>';
  html+='<div style="font-size:13px;color:var(--text3);margin-bottom:2px">'+_agTypeEmoji(a.type)+' '+escHtml(_agTypeLabel(a.type))+' · '+escHtml(a.party||'')+'</div>';
  if(a.effectiveDate)html+='<div style="font-size:12px;color:var(--text3);margin-bottom:12px">Effective '+_agFmtDate(a.effectiveDate)+'</div>';
  html+='<div style="white-space:pre-wrap;font-size:13px;line-height:1.55;color:var(--text2,#444);background:var(--bg);border:1px solid var(--border);border-radius:var(--r);padding:12px;max-height:220px;overflow-y:auto;margin-bottom:14px">'+escHtml(a.body||'')+'</div>';
  if(a.status==='signed'&&a.sigData){
    html+='<div style="font-size:11px;font-weight:700;color:var(--text3);margin-bottom:4px">Signed by '+escHtml(a.signerName||'')+' · '+_agFmtDate(a.signedAt)+'</div>';
    html+='<img src="'+a.sigData+'" alt="signature" style="max-width:200px;border:1px solid var(--border);border-radius:var(--r);background:#fff;margin-bottom:14px">';
  }
  // Action buttons
  html+='<div style="display:flex;flex-wrap:wrap;gap:8px">';
  if(a.status==='draft'){
    html+='<button onclick="sendAgreementForSignature('+a.id+')" class="btn btn-p" style="flex:1 1 100%">📤 Send for signature</button>';
    html+='<button onclick="openEditAgreement('+a.id+');document.getElementById(\'_ag-detail-ov\').remove()" class="btn" style="flex:1">Edit</button>';
  }else{
    html+='<button onclick="copyAgreementLink('+a.id+')" class="btn btn-p" style="flex:1 1 100%">🔗 Copy sign link</button>';
    if(a.status==='sent')html+='<button onclick="markAgreementSigned('+a.id+')" class="btn" style="flex:1">Mark signed</button>';
  }
  html+='<button onclick="deleteAgreement('+a.id+')" class="btn" style="flex:1;color:var(--text3)">Delete</button>';
  html+='<button onclick="this.closest(\'.zmodal-overlay\').remove()" class="btn" style="flex:1">Close</button>';
  html+='</div>';
  box.innerHTML=html;
  ov.appendChild(box);document.body.appendChild(ov);
}

function deleteAgreement(id){
  zConfirm('Delete this contract permanently?',()=>{
    agreements=agreements.filter(a=>a.id!==id);
    saveAll();
    document.getElementById('_ag-detail-ov')?.remove();
    renderContracts();
    showToast('Contract deleted','🗑');
  },{yes:'Delete'});
}

function markAgreementSigned(id){
  const a=agreements.find(x=>x.id===id);if(!a)return;
  a.status='signed';if(!a.signedAt)a.signedAt=new Date().toISOString();
  saveAll();document.getElementById('_ag-detail-ov')?.remove();renderContracts();showToast('Marked signed','✍️');
}

function _agToken(){return Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');}

function _agSignUrl(a){
  return _clientBaseUrl()+'contract-sign.html?t='+a.signingToken+'&u='+(_supaUser?.id||'')+'&a='+a.id;
}

// Upload a JSON snapshot of the contract to the proposals storage bucket — mirrors
// the proposals sign flow exactly (public bucket, anon-readable by unguessable token).
async function _agUpload(a){
  if(!supaEnabled()||!_supaUser)return{error:new Error('Sign in to send for signature.')};
  if(!a.signingToken)a.signingToken=_agToken();
  const key='agreements/'+_supaUser.id+'/'+a.id+'_'+a.signingToken+'.json';
  a.signingKey=key;
  const snapshot={
    id:a.id,token:a.signingToken,contractorUserId:_supaUser.id,
    type:a.type,party:a.party,title:a.title||_agTypeLabel(a.type),
    body:a.body,profitPct:a.profitPct,cadence:a.cadence,
    effectiveDate:a.effectiveDate,
    businessName:getBusinessName(),ownerName:getOwnerName()||'',
    notifyEmail:_supaUser.email||'',
    status:a.status==='signed'?'signed':'sent',
    signedAt:a.signedAt||null,signerName:a.signerName||null,sigData:a.sigData||null,
    createdAt:a.createdAt
  };
  try{
    const{error}=await _supa.storage.from('proposals').upload(key,JSON.stringify(snapshot),{contentType:'application/json',upsert:true,cacheControl:'0'});
    return{error};
  }catch(e){return{error:e};}
}

async function sendAgreementForSignature(id){
  const a=agreements.find(x=>x.id===id);if(!a)return;
  if(!supaEnabled()||!_supaUser){zAlert('Sign in to send contracts for signature.');return;}
  const{error}=await _agUpload(a);
  if(error){console.warn('agreement upload:',error.message||error);zAlert('Could not upload the contract. Check your connection and try again.');return;}
  a.status='sent';
  saveAll();
  document.getElementById('_ag-detail-ov')?.remove();
  renderContracts();
  _agShowLink(a);
}

function copyAgreementLink(id){
  const a=agreements.find(x=>x.id===id);if(!a)return;
  if(!a.signingToken){sendAgreementForSignature(id);return;}
  // Refresh the snapshot silently so the signer always sees the latest terms
  _agUpload(a).then(()=>saveAll()).catch(()=>{});
  _agShowLink(a);
}

function _agShowLink(a){
  const url=_agSignUrl(a);
  document.getElementById('_ag-link-ov')?.remove();
  const ov=document.createElement('div');ov.className='zmodal-overlay';ov.id='_ag-link-ov';
  ov.onclick=e=>{if(e.target===ov)ov.remove();};
  const box=document.createElement('div');box.className='zmodal';
  box.style.animation='td-ag-sheet .22s cubic-bezier(.22,1,.36,1) both';
  box.innerHTML=
    '<div style="font-size:17px;font-weight:800;margin-bottom:4px">📤 Ready to sign</div>'+
    '<div style="font-size:12px;color:var(--text3);margin-bottom:14px">'+escHtml(a.party||'')+' · '+escHtml(_agTypeLabel(a.type))+'</div>'+
    '<div style="background:var(--bg);border:1px solid var(--border2,var(--border));border-radius:var(--r);padding:10px 12px;font-size:11px;word-break:break-all;color:var(--text2);margin-bottom:14px;user-select:all">'+escHtml(url)+'</div>'+
    '<button onclick="navigator.clipboard.writeText('+JSON.stringify(url)+').then(()=>showToast(\'Copied!\',\'📋\'));this.textContent=\'✓ Copied\'" class="btn btn-p" style="width:100%;margin-bottom:8px">📋 Copy link</button>'+
    (a.partyClientId||a.party?'<button onclick="_agSms('+a.id+')" class="btn" style="width:100%;margin-bottom:8px">📱 Send via Messages</button>':'')+
    '<button onclick="this.closest(\'.zmodal-overlay\').remove()" class="btn" style="width:100%">Close</button>';
  ov.appendChild(box);document.body.appendChild(ov);
  navigator.clipboard&&navigator.clipboard.writeText(url).catch(()=>{});
}

function _agSms(id){
  const a=agreements.find(x=>x.id===id);if(!a)return;
  const url=_agSignUrl(a);
  const c=clients.find(x=>x.id===a.partyClientId)||clients.find(x=>x.name===a.party);
  const phone=c?.phone?c.phone.replace(/\D/g,''):'';
  const msg='Please review and sign this '+_agTypeLabel(a.type).toLowerCase()+' from '+(getBusinessName()||'us')+': '+url;
  document.getElementById('_ag-link-ov')?.remove();
  window.location.href='sms:'+phone+'?body='+encodeURIComponent(msg);
}

// Poll storage for signed state on a sent contract — the signer writes signedAt /
// signerName / sigData back into the same snapshot via contract-sign.html.
async function refreshAgreementSignatures(){
  if(!supaEnabled()||!_supaUser)return;
  const pending=agreements.filter(a=>a.status==='sent'&&a.signingKey);
  if(!pending.length)return;
  let changed=false;
  for(const a of pending){
    try{
      const pub=_supa.storage.from('proposals').getPublicUrl(a.signingKey)?.data?.publicUrl;
      if(!pub)continue;
      const res=await fetch(pub+(pub.includes('?')?'&':'?')+'cb='+Date.now(),{cache:'no-store'});
      if(!res.ok)continue;
      const snap=await res.json();
      if(snap&&snap.status==='signed'&&snap.signedAt){
        a.status='signed';a.signedAt=snap.signedAt;a.signerName=snap.signerName||'';a.sigData=snap.sigData||null;
        changed=true;
      }
    }catch(e){/* network/parse — ignore, try again next time */}
  }
  if(changed){saveAll();const pg=document.getElementById('pg-contracts');if(pg&&pg.classList.contains('active'))renderContracts();}
}

// Inject the modal entrance keyframe once (fade + slide-up, per CLAUDE.md §8.4).
(function(){
  if(document.getElementById('_ag-style'))return;
  const s=document.createElement('style');s.id='_ag-style';
  s.textContent='@keyframes td-ag-sheet{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}';
  (document.head||document.documentElement).appendChild(s);
})();
