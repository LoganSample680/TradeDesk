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
  // A shared CONTACT arrives as .vcf and is text, not an image. Typing it
  // image/jpeg was harmless for Blob.text() but made it invisible to any
  // branch that routes on type, which is exactly the branch added below.
  const type=/\.vcf$/i.test(path)?'text/vcard'
    :(/\.(png)$/i.test(path)?'image/png'
    :(/\.pdf$/i.test(path)?'application/pdf':'image/jpeg'));
  return new Blob(parts,{type});
}

// A CONTACT shared from the iOS Contacts app (owner 2026-08-28: "lead import
// can also throw in existing contact import"). Every downstream piece already
// existed and none of it was reachable from a phone: _parseVCard has parsed
// the ADR line into street/city/state/zip since the vCard-upload route was
// built, and _showImportPreview/_doImport already dedupe against the roster
// and write the address onto the client.
//
// This matters because the OTHER contacts route is dead on iOS. The "from
// your phone contacts" button uses the Web Contact Picker API, which has
// never shipped in Safari or WKWebView, so js/clients.js feature-detects it
// and hides the button. An iPhone contractor had no way to import a contact
// at all short of exporting a file to a laptop. The share sheet is the way in.
async function _shareInAsContacts(items){
  try{
    if(typeof _parseVCard!=='function'||typeof _showImportPreview!=='function')return 0;
    const all=[];
    for(const it of items){
      const b=await _shareInRead(it.path);
      if(!b)continue;
      let text='';
      try{text=await b.text();}catch(_e){continue;}
      if(!/BEGIN:VCARD/i.test(text))continue;
      // One share can carry several cards, and one .vcf can hold several
      // contacts; both flatten into the same list the preview expects.
      _parseVCard(text).forEach(c=>all.push(c));
    }
    if(!all.length)return 0;
    // Cleared only after the preview is up: a parse that produced nothing
    // must leave the file in the inbox to try again, same rule the receipt
    // fork follows.
    _showImportPreview(all);
    await _shareInClear(items.map(i=>i.path));
    return all.length;
  }catch(_e){return 0;}
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
  // A share that is NOTHING BUT contact cards is not a question, so do not ask
  // one. A .vcf can only ever be a contact, and the import preview it opens is
  // itself the confirm step, so the sheet in between was a tap that bought
  // nothing. Straight through.
  if(items.every(i=>/\.vcf$/i.test((i&&i.path)||''))){
    let found=0;
    try{found=await _shareInAsContacts(items);}catch(_e){}
    if(found){_shareInAsking=false;return items.length;}
    // Nothing parsed out of it. Fall through to the sheet rather than toasting
    // the same failure on every launch: the sheet is the only place with a
    // Discard button, so it is the only way out of an unreadable card.
  }
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
  // Does this share actually contain a contact card? Decides whether the
  // contact fork is offered at all.
  const hasVcf=items.some(i=>/\.vcf$/i.test((i&&i.path)||''));
  // A share that is NOTHING BUT contact cards is a different question, not the
  // same question with an extra button. "Reads the total off it" is nonsense
  // for a vCard, and filing a .vcf into a job's photo gallery buries it where
  // nobody will look, so neither fork is offered: the sheet asks the one thing
  // that can actually happen (15.1, a control whose value is not wired must
  // not ship).
  const allVcf=n>0&&items.every(i=>/\.vcf$/i.test((i&&i.path)||''));
  // A shared photo belongs to a CLIENT, not to a job. That is where the owner
  // goes looking for it: the client hub renders every photo carrying a
  // client_id, job-linked or not (client.html "Other photos"), so this is the
  // one question that always has an answer. Under the old job picker a photo
  // taken before the job existed had nowhere to go at all.
  //
  // Clients with work on today float to the top for the same reason the job
  // list used to: a photo shared at 2pm is almost always about the truck that
  // is parked somewhere right now.
  const tk=(typeof todayKey==='function')?todayKey():'';
  const allJobs=(typeof jobs!=='undefined'&&Array.isArray(jobs))?jobs:[];
  const hot=new Set(allJobs.filter(j=>j&&j.status!=='canceled'&&String(j.start||'').slice(0,10)===tk)
                           .map(j=>String(j.client_id)));
  const allC=(typeof clients!=='undefined'&&Array.isArray(clients))?clients.filter(Boolean):[];
  // Ids are minted from Date.now(), so descending id IS newest-first without
  // depending on a created stamp every record is not guaranteed to carry.
  const byNew=allC.slice().sort((a,b)=>(Number(b.id)||0)-(Number(a.id)||0));
  const onToday=byNew.filter(c=>hot.has(String(c.id)));
  // The FULL ordered set, not a slice. Twelve rows with no way to reach the
  // rest is unusable at the 141 clients the owner actually has: the cap now
  // applies only to what is DRAWN, and search reaches everything behind it.
  const ranked=onToday.concat(byNew.filter(c=>!hot.has(String(c.id))));
  const SHOWN=12;
  const pick=ranked.slice(0,SHOWN);
  // Matched against the same two strings the row displays, name then address,
  // so typing a street still finds them and no result can look like it came
  // from nowhere.
  const matches=q=>{
    const t=String(q||'').trim().toLowerCase();
    if(!t)return ranked.slice(0,SHOWN);
    return ranked.filter(c=>(String(c.name||'')+' '+String(c.addr||c.street||''))
      .toLowerCase().indexOf(t)>-1).slice(0,SHOWN);
  };
  const ic=(e,tone)=>'<span class="si-ic'+(tone?' si-ic-'+tone:'')+'">'+
    (typeof svgIcon==='function'?svgIcon(e,{size:17}):e)+'</span>';
  const opt=(id,tone,emoji,title,sub)=>
    '<button id="'+id+'" class="si-opt">'+ic(emoji,tone)+
      '<span class="si-txt"><span class="si-t">'+title+'</span>'+
      '<span class="si-s">'+sub+'</span></span><span class="si-chev">\u203a</span></button>';
  const row=c=>{
    const sub=[hot.has(String(c.id))?'On the schedule today':'',c.addr||c.street||''].filter(Boolean).join(' · ');
    return '<button data-client="'+c.id+'" class="si-opt _si-client">'+
      ic('\ud83d\udc64')+
      '<span class="si-txt"><span class="si-t si-1">'+escHtml(c.name||'Unnamed client')+'</span>'+
      (sub?'<span class="si-s si-1">'+escHtml(sub)+'</span>':'')+
      '</span><span class="si-chev">\u203a</span></button>';
  };
  // TWO things arrive through the share sheet and they are not the same job:
  // a jobsite photo, and a receipt. Forcing a Home Depot receipt to become a
  // job photo buries the money in a gallery, which is exactly the manual
  // re-entry this feature exists to kill. Same fork-in-two-paths shape the
  // setup checklist already uses (7.3): name both, commit to neither.
  //
  // Receipt is first. A photo shared from the Camera app is the habit; a
  // receipt shared from the Home Depot app is the thing somebody went out of
  // their way to do, and it is the one with money attached.
  const forks=
    (allVcf?'':opt('_si-receipt','d','\ud83e\uddfe',(n===1?'A receipt':'Pages of one receipt'),
      'Reads the total and opens an expense'))+
    // Only when a contact is actually in the share. Offering "add as a lead"
    // for a photo of a water heater is noise, and 15.1 is explicit that a
    // control whose value is not wired must not ship.
    (hasVcf?opt('_si-contact',(allVcf?'d':''),'\ud83d\udc64',(n===1?'Add as a lead':'Add as leads'),
      'Name, phone and address off the card'):'');
  m.innerHTML=
    '<div class="zmodal-title">'+n+' '+(allVcf?'contact':'file')+(n===1?'':'s')+' shared to TradeDesk</div>'+
    '<div style="font-size:13px;color:var(--text2);margin:6px 0 13px">'+
      (allVcf?'Where should '+(n===1?'it':'they')+' go?':('What '+(n===1?'is it':'are they')+'?'))+'</div>'+
    (forks?'<div class="si-list">'+forks+'</div>':'')+
    (allVcf?'':
      '<div class="si-lbl">Or add to a client\'s photos</div>'+
      // Only once the list is long enough to hunt through. A search box over
      // four clients is a control that buys nothing (15.1).
      (ranked.length>SHOWN?'<input id="_si-csearch" class="si-search" type="search" '+
        'placeholder="Search '+ranked.length+' clients" autocomplete="off" '+
        'autocapitalize="off" autocorrect="off" spellcheck="false">':'')+
      (pick.length?'<div id="_si-clist" class="si-list si-scroll">'+pick.map(row).join('')+'</div>'
                  :'<div class="si-empty">No clients yet. Add the client first, then share again.</div>'))+
    '<div class="si-foot">'+
      '<button id="_si-later" class="si-fbtn">Not now</button>'+
      '<button id="_si-discard" class="si-fbtn si-fbtn-q">Discard</button>'+
    '</div>';
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
  const ctBtn=document.getElementById('_si-contact');
  if(ctBtn)ctBtn.onclick=async()=>{
    ctBtn.disabled=true;ctBtn.style.opacity='.5';
    // Closed first: _showImportPreview raises its own modal, and stacking two
    // overlays on a phone is how you end up unable to dismiss either (7.3).
    close();
    const found=await _shareInAsContacts(items.filter(i=>/\.vcf$/i.test(i.path||'')));
    if(typeof showToast==='function'&&!found)showToast('No contact details in that file','⚠️');
  };
  document.getElementById('_si-discard').onclick=async()=>{
    await _shareInClear(items.map(i=>i.path));
    close();
    if(typeof showToast==='function')showToast('Shared files discarded','🗑');
  };
  const clist=document.getElementById('_si-clist');
  const csearch=document.getElementById('_si-csearch');
  if(csearch&&clist)csearch.oninput=()=>{
    const found=matches(csearch.value);
    clist.innerHTML=found.length?found.map(row).join('')
      :'<div class="si-empty" style="padding:13px">No client matches that.</div>';
  };
  // DELEGATED, not bound per button. Search redraws these rows on every
  // keystroke, so handlers living on the buttons themselves would be thrown
  // away the first time the owner types a letter and the list would go dead.
  if(clist)clist.addEventListener('click',async e=>{
    const btn=e.target&&e.target.closest?e.target.closest('._si-client'):null;
    if(!btn||btn.disabled)return;
    {
      const clientId=btn.getAttribute('data-client');
      btn.disabled=true;btn.style.opacity='.5';
      const r=await _shareInFileToClient(items,clientId);
      close();
      if(typeof showToast==='function'){
        if(r.done)showToast(r.done+' photo'+(r.done===1?'':'s')+' added to '+(r.name||'the client'),'\u2713');
        // Offline is NOT a failure here and must not read like one: the files
        // are still sitting in the share inbox and the app re-offers them the
        // next time it opens, so say what actually happens next.
        else if(r.offline)showToast('No connection. They stay shared and land next time you open the app','\ud83d\udcf6');
        else showToast('Could not read the shared files','\u26a0\ufe0f');
      }
    }
  });
}

// A shared photo lands on a CLIENT, through the SAME pipeline the in-app
// camera uses (addJobPhoto, js/jobs.js): compress, upload to the gallery
// bucket, thumbnail, push one record onto the global photos[] array, refresh
// the client hub. Not a parallel path (7.3): photos[] is what td_photos syncs
// and what client.html reads, so a shared photo behaves like every other photo
// everywhere downstream. job_id stays null, and the hub renders exactly those
// under "Other photos".
//
// This replaced an attach-to-a-JOB fork whose upload branch called
// _jobAttachBlob, a function that has never existed in this codebase, so every
// shared photo silently took the offline fallback and sat as base64 inside the
// job record until some later drain happened to run.
async function _shareInFileToClient(items,clientId){
  const c=(typeof clients!=='undefined'&&clients.find)?clients.find(x=>String(x.id)===String(clientId)):null;
  if(!c)return{done:0};
  // No backend, no upload, and the bytes are NOT lost: they stay in the share
  // inbox on the device, which is already a durable queue. Re-offering them on
  // the next launch beats parking multi-megabyte base64 inside a synced table
  // the way the job path does.
  const online=typeof supaEnabled==='function'&&supaEnabled()&&
               typeof _supaUser!=='undefined'&&_supaUser&&typeof _supa!=='undefined'&&_supa;
  if(!online)return{done:0,offline:true,name:c.name||''};
  let done=0;const filed=[];
  for(const it of items){
    const blob=await _shareInRead(it.path);
    if(!blob)continue;
    try{
      // Guarded by name, every one of them. jobs.js is a separate file and a
      // missing global here throws mid-loop and strands the rest of the batch,
      // which is precisely how _jobAttachBlob went unnoticed for so long.
      const _cp=(typeof _compressPhoto==='function')?await _compressPhoto(blob):null;
      const ext=_cp?_cp.ext:((String(it.path||'').split('.').pop()||'jpg').toLowerCase());
      // Foldered by client, mirroring the job path's user/job/ layout so the
      // bucket stays browsable by hand.
      const path=_supaUser.id+'/client-'+c.id+'/shared-'+Date.now()+'-'+Math.floor(Math.random()*1e4)+'.'+ext;
      const opts={contentType:_cp?_cp.mime:(blob.type||'image/jpeg'),upsert:false};
      if(typeof _PHOTO_CACHE!=='undefined')opts.cacheControl=_PHOTO_CACHE;
      const{error}=await _supa.storage.from('gallery').upload(path,_cp?_cp.blob:blob,opts);
      if(error)continue;
      const{data:urlData}=_supa.storage.from('gallery').getPublicUrl(path);
      const publicUrl=(urlData&&urlData.publicUrl)||'';
      if(!publicUrl)continue;
      const th=(typeof _uploadPhotoThumb==='function')
        ?await _uploadPhotoThumb(_cp?_cp.thumb:null,path):{thumbUrl:'',thumbPath:''};
      if(typeof photos==='undefined')continue;
      photos.push({id:Date.now()+Math.random(),url:publicUrl,storagePath:path,
        thumbUrl:th.thumbUrl,thumbPath:th.thumbPath,type:'shared',caption:'',
        client_id:c.id,client_name:c.name||'',job_id:null,job_name:'',
        uploadedAt:new Date().toISOString()});
      done++;filed.push(it.path);
    }catch(_e){}
  }
  if(done){
    if(typeof saveAll==='function')saveAll();
    if(typeof _uploadClientHub==='function')_uploadClientHub(c.id).catch(()=>{});
    // ONLY now: the bytes are in the bucket and the record is saved. A file
    // that did not upload keeps its place in the inbox for another try.
    await _shareInClear(filed);
  }
  return{done,name:c.name||''};
}
