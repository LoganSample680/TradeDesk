// ── Photos: every shot, newest first, by year, month and address ────────────
// (owner 2026-09-24: "showing all photos taken ... broken down by year, then
// months, then by address, fully searchable", "newest first like CompanyCam").
//
// This is a way IN, not a second album. Tapping an address opens the property
// folder the shoot already ends with (tdOpenPhotoGroup, js/photo-capture.js),
// so viewing, marking up, moving and sharing all stay in one place (§7.3).
// The search is the same word matcher the global search and Tim use
// (_pcHaystack), so "pepe march" finds the same photos everywhere.
//
// Nothing here is stored: the grouping is derived from photos[] every paint,
// so a photo filed, moved or deleted anywhere else is right here next time.

let _phgQuery='';
// The year and month picker (owner 2026-09-24: "what about a picker for the
// year and month as well"). null is "all". Only years and months that have
// photos are offered, so there is never a pick that lands on nothing.
let _phgYear=null,_phgMonth=null;

// The property a photo belongs to, the same key tdPhotoSearch groups on, so an
// address row here and a search result elsewhere open the same folder.
function _phgKey(p){
  return (String(p&&p.addr||'').trim().toLowerCase())||('client:'+(p&&p.client_id!=null?p.client_id:'unfiled'));
}
// No date is no date: Date.parse(0) reads as the year 2000, which filed an
// undated photo under a year nobody shot in.
function _phgTime(p){const v=p&&p.uploadedAt;return (typeof v==='string'&&v)?(Date.parse(v)||0):0;}

// [{year, months:[{key:'2026-09', label:'September', places:[{key, addr, name,
// photos (this month, newest first), last}]}]}], every level newest first.
function tdPhotoTimeline(list,q){
  const words=String(q||'').toLowerCase().trim().split(/\s+/).filter(Boolean);
  const src=(Array.isArray(list)?list:[]).filter(p=>p&&_phgTime(p)>0&&
    (!words.length||(typeof _pcHaystack==='function'&&words.every(w=>_pcHaystack(p).includes(w)))));
  src.sort((a,b)=>_phgTime(b)-_phgTime(a));
  const years=[];
  src.forEach(p=>{
    const d=new Date(_phgTime(p));
    const y=d.getFullYear(),m=d.getMonth();
    let Y=years[years.length-1];
    if(!Y||Y.year!==y){Y={year:y,months:[]};years.push(Y);}
    const mk=y+'-'+String(m+1).padStart(2,'0');
    let M=Y.months[Y.months.length-1];
    if(!M||M.key!==mk){M={key:mk,label:d.toLocaleDateString('en-US',{month:'long'}),places:[],byKey:{}};Y.months.push(M);}
    const k=_phgKey(p);
    let P=M.byKey[k];
    if(!P){P=M.byKey[k]={key:k,addr:p.addr||'',name:p.client_name||'',photos:[],last:_phgTime(p)};M.places.push(P);}
    if(!P.addr&&p.addr)P.addr=p.addr;
    if(!P.name&&p.client_name)P.name=p.client_name;
    P.photos.push(p);
  });
  years.forEach(Y=>Y.months.forEach(M=>{delete M.byKey;}));
  return years;
}

// The whole property, every month, not just the slice this row stood for:
// the folder groups its own visits, and a warranty call wants the history.
function tdPhotoOpenPlace(key){
  const all=(typeof photos!=='undefined'&&Array.isArray(photos)?photos:[]).filter(p=>p&&_phgKey(p)===key);
  if(!all.length)return false;
  all.sort((a,b)=>_phgTime(b)-_phgTime(a));
  const addr=(all.find(p=>p.addr)||{}).addr||'';
  return (typeof tdOpenPhotoGroup==='function')?tdOpenPhotoGroup({key,addr,photos:all}):false;
}

function tdPhotosPickYear(y){
  const n=(y==null||y==='')?null:Number(y);
  _phgYear=(n!=null&&isFinite(n))?n:null;
  _phgMonth=null;
  renderPhotosPage();
  return _phgYear;
}
function tdPhotosPickMonth(key){
  _phgMonth=(typeof key==='string'&&/^\d{4}-\d{2}$/.test(key))?key:null;
  renderPhotosPage();
  return _phgMonth;
}
// The same picker Books uses (owner 2026-09-24: "follow the same time picker
// we got in books"): the full-width year dropdown from #tracker-year-sel,
// same look, with "All years" first because a photo search spans years in a
// way a tax year never does. The month dropdown beside it appears once a
// year is picked. Drawn from what the search left: a year the search
// emptied is not offered, and a pick it emptied falls back to All.
const _PHG_SEL_STYLE='font-size:13px;font-weight:700;padding:6px 10px;border-radius:var(--r);border:1px solid var(--line-2);background:var(--bg-card);color:var(--text);cursor:pointer;width:100%;min-width:0';
function _phgPickerHTML(years){
  if(_phgYear!=null&&!years.some(Y=>Y.year===_phgYear)){_phgYear=null;_phgMonth=null;}
  const Y=_phgYear!=null?years.find(x=>x.year===_phgYear):null;
  if(_phgMonth&&!(Y&&Y.months.some(M=>M.key===_phgMonth)))_phgMonth=null;
  if(!years.length)return '';
  const opt=(v,label,on)=>'<option value="'+escHtml(String(v))+'"'+(on?' selected':'')+'>'+escHtml(label)+'</option>';
  return '<div class="ph-pick">'+
    '<select id="ph-year-sel" aria-label="Year" onchange="tdPhotosPickYear(this.value)" style="'+_PHG_SEL_STYLE+'">'+
      opt('','All years',_phgYear==null)+years.map(x=>opt(x.year,String(x.year),_phgYear===x.year)).join('')+
    '</select>'+
    (Y?'<select id="ph-month-sel" aria-label="Month" onchange="tdPhotosPickMonth(this.value)" style="'+_PHG_SEL_STYLE+'">'+
      opt('','All of '+Y.year,!_phgMonth)+Y.months.map(M=>opt(M.key,M.label,_phgMonth===M.key)).join('')+
    '</select>':'')+
  '</div>';
}

function tdPhotosSearch(q){
  _phgQuery=String(q==null?'':q);
  renderPhotosPage();
}

function renderPhotosPage(){
  const el=document.getElementById('ph-list');
  if(!el)return false;
  const list=(typeof photos!=='undefined'&&Array.isArray(photos))?photos:[];
  const sub=document.getElementById('ph-sub');
  const places=new Set(list.filter(p=>p&&_phgTime(p)>0).map(_phgKey));
  if(sub)sub.textContent=list.length?(list.length+(list.length===1?' photo':' photos')+' · '+places.size+(places.size===1?' address':' addresses')):'';
  const found=tdPhotoTimeline(list,_phgQuery);
  const pick=document.getElementById('ph-picker');
  if(pick)pick.innerHTML=_phgPickerHTML(found);
  const years=found.filter(Y=>_phgYear==null||Y.year===_phgYear)
    .map(Y=>_phgMonth?Object.assign({},Y,{months:Y.months.filter(M=>M.key===_phgMonth)}):Y);
  if(!years.length){
    el.innerHTML='<div class="ph-empty">'+(_phgQuery.trim()
      ?'No photos match “'+escHtml(_phgQuery.trim().slice(0,40))+'”'
      :'No photos yet. Photos you take on a job or an estimate show up here.')+'</div>';
    return true;
  }
  const esc=u=>(typeof _pcEscUrl==='function')?_pcEscUrl(u):String(u||'');
  const src=p=>(typeof tdPhotoSrc==='function')?tdPhotoSrc(p):(p.thumbUrl||p.url||'');
  el.innerHTML=years.map(Y=>
    '<div class="ph-year">'+Y.year+'</div>'+
    Y.months.map(M=>
      '<div class="ph-month">'+escHtml(M.label)+'</div>'+
      M.places.map(P=>{
        const n=P.photos.length;
        const street=(P.addr||'').split(',')[0]||P.name||'Unfiled photos';
        const day=new Date(P.last).toLocaleDateString('en-US',{month:'short',day:'numeric'});
        const thumbs=P.photos.slice(0,4).map(p=>'<span class="ph-th" style="background-image:url(\''+esc(src(p))+'\')"></span>').join('');
        return '<button type="button" class="ph-place" data-key="'+escHtml(P.key)+'" onclick="tdPhotoOpenPlace(this.dataset.key)">'+
          '<span class="ph-thumbs">'+thumbs+'</span>'+
          '<span class="ph-meta">'+
            '<span class="ph-addr">'+escHtml(street)+'</span>'+
            '<span class="ph-who">'+escHtml([P.addr?P.name:'',n+(n===1?' photo':' photos'),day].filter(Boolean).join(' · '))+'</span>'+
          '</span>'+
          '<span class="ph-chev">›</span>'+
        '</button>';
      }).join('')
    ).join('')
  ).join('');
  return true;
}

// ── Text the photos: a snapshot link (owner 2026-09-24) ─────────────────────
// "What's there when you send it", and "you pick which ones": the link holds
// exactly the photos selected at the moment Text was tapped, nothing added
// later. It is a link and not attachments because a text carries about ten
// compressed photos, and a link carries all of them at full size (the
// complaint contractors make about CompanyCam's own sharing).
//
// The snapshot is a JSON file in the proposals bucket beside the client hub's
// own (anon can read it; nothing new in the schema), under a 128-bit random
// token, opened by photos.html. Sent from the contractor's own phone through
// an sms: link, exactly like every other message this app sends (§9.4).
function _phgToken(){
  try{return Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b=>b.toString(16).padStart(2,'0')).join('');}
  catch(_e){return (Date.now().toString(16)+Math.random().toString(16).slice(2)).slice(0,32);}
}
function tdPhotoLinkSnapshot(rows,addr){
  const shots=(rows||[]).filter(p=>p&&p.url);
  const biz=(typeof getBusinessName==='function'&&getBusinessName())||(typeof S!=='undefined'&&S.bname)||'';
  return {v:1,biz:String(biz||''),addr:String(addr||(shots.find(p=>p.addr)||{}).addr||''),
    createdAt:new Date().toISOString(),
    photos:shots.map(p=>({u:p.url,t:p.thumbUrl||'',s:p.type||'',at:p.uploadedAt||'',c:p.caption||''}))};
}
async function tdPhotoLinkCreate(ids,addr){
  const rows=(ids||[]).map(id=>photos.find(p=>String(p.id)===String(id))).filter(Boolean);
  const snap=tdPhotoLinkSnapshot(rows,addr);
  if(!snap.photos.length)return {error:'none'};
  if(!(typeof supaEnabled==='function'&&supaEnabled()&&_supa&&_supaUser))return {error:'offline'};
  const uid=(typeof _effectiveUid==='function'&&_effectiveUid())||_supaUser.id;
  const token=_phgToken();
  const key='photo-share/'+uid+'/'+token+'.json';
  try{
    const{error}=await _supa.storage.from('proposals').upload(key,JSON.stringify(snap),{contentType:'application/json',upsert:false,cacheControl:'3600'});
    if(error)return {error:'upload'};
  }catch(_e){return {error:'upload'};}
  const base=(typeof _clientBaseUrl==='function')?_clientBaseUrl():(location.origin+'/');
  return {url:base+'photos.html?u='+encodeURIComponent(uid)+'&s='+token,count:snap.photos.length,skipped:rows.length-snap.photos.length};
}
// The words that go in the text, short enough to read in the preview.
function tdPhotoLinkMessage(url,count,addr){
  const biz=(typeof getBusinessName==='function'&&getBusinessName())||'';
  const street=String(addr||'').split(',')[0];
  return (biz?biz+': ':'')+count+(count===1?' photo':' photos')+(street?' from '+street:'')+'. '+url;
}
// who: 'client' (the folder's customer, when there is a phone) or 'other'
// (Messages opens with nobody filled in, for the adjuster, the realtor, the
// guy's wife). Returns the url it sent, or '' when nothing went.
async function tdSelText(who){
  const menu=document.getElementById('pc-text-menu');
  const rows=(typeof _pcSelRows==='function')?_pcSelRows():[];
  if(!rows.length)return '';
  if(!who){if(menu)menu.classList.toggle('open');return '';}
  if(menu)menu.classList.remove('open');
  const addr=(typeof _pcFolder!=='undefined'&&_pcFolder&&_pcFolder.addr)||(rows.find(p=>p.addr)||{}).addr||'';
  const r=await tdPhotoLinkCreate(rows.map(p=>p.id),addr);
  if(!r||!r.url){
    if(typeof showToast==='function')showToast(r&&r.error==='none'?'Those photos are still uploading. Try again in a moment.':'Could not make the link. Check your signal and try again.','⚠️');
    return '';
  }
  let phone='';
  if(who==='client'){
    const cid=(typeof _pcFolder!=='undefined'&&_pcFolder&&_pcFolder.clientId!=null)?_pcFolder.clientId:(rows.find(p=>p.client_id!=null)||{}).client_id;
    const c=(typeof clients!=='undefined'&&Array.isArray(clients))?clients.find(x=>x.id===cid):null;
    phone=String(c&&c.phone||'').replace(/\D/g,'');
  }
  const body=tdPhotoLinkMessage(r.url,r.count,addr);
  const href='sms:'+phone+(phone?'?':'&')+'body='+encodeURIComponent(body);
  window._phgLastSms=href;
  try{window.location.href=href;}catch(_e){}
  if(r.skipped&&typeof showToast==='function')showToast(r.skipped+(r.skipped===1?' photo is':' photos are')+' still uploading and were left out','ℹ️');
  return r.url;
}
// Add every photo of one stage to the selection, or take them all back out
// when they are already all in: "select all befores and all afters" is two
// taps, and a third takes the befores back off.
function tdSelStageAll(t){
  if(typeof _pcRev==='undefined'||!_pcRev||!_pcRev.sel)return false;
  const rows=(_pcRev.folder&&typeof _pcFolderRows==='function')?_pcFolderRows():_pcRevRows();
  const ids=rows.filter(p=>p.type===t).map(p=>p.id);
  if(!ids.length)return false;
  const has=new Set(_pcRev.sel.map(String));
  const all=ids.every(id=>has.has(String(id)));
  if(all)_pcRev.sel=_pcRev.sel.filter(id=>!ids.some(x=>String(x)===String(id)));
  else ids.forEach(id=>{if(!has.has(String(id)))_pcRev.sel.push(id);});
  _pcRevPaint();
  return _pcRev.sel.length;
}
