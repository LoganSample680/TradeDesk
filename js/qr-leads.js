// ── QR lead tracking: generate + manage codes for physical marketing ────────
// A contractor creates one code per physical source (a specific yard sign, the
// truck wrap, business cards), downloads a print-ready SVG/PNG, and puts it on
// the thing. Scanning it hits functions/q/[[code]].js, which logs a 'scan'
// event and forwards to intake.html?src=<code>; intake.html logs 'form_opened'
// on load and 'submitted' on success (see intake.html's _qrLog). This page is
// where those three numbers per source actually show up.
//
// Error correction is fixed at 'H' (30% damage tolerance), not user-choosable:
// printed codes fade, scratch, and collect dirt over a truck wrap's multi-year
// life, and H leaves the most headroom for that. Output is SVG, vector, scales
// to any print size (a truck shop scales it to 12"x12"+ themselves), not a
// fixed-pixel PNG that would pixelate at that size.

let _qrSources=[];
let _qrEventCounts={}; // qr_source_id -> {scan,form_opened,submitted}

function _qrGenCode(){
  // Lowercase base36, 10 chars — matches functions/q/[[code]].js's
  // ^[a-z0-9]{6,16}$ validation. crypto.getRandomValues, not Math.random:
  // this code becomes a public, printed, unguessable-by-design identifier.
  const bytes=new Uint32Array(10);
  (window.crypto||window.msCrypto).getRandomValues(bytes);
  return Array.from(bytes,b=>(b%36).toString(36)).join('');
}

function _qrTargetUrl(code){
  const base=typeof _clientBaseUrl==='function'?_clientBaseUrl():window.location.origin+window.location.pathname.split('index.html')[0];
  return base+'q/'+code;
}

async function _qrLoadSources(){
  if(!_supa||!_supaUser)return;
  const acctId=(typeof _effectiveUid==='function'&&_effectiveUid())||'';
  if(!acctId)return;
  try{
    const{data}=await _supa.from('qr_sources').select('*').eq('account_id',acctId).order('created_at',{ascending:false});
    _qrSources=data||[];
    const ids=_qrSources.map(s=>s.id);
    _qrEventCounts={};
    if(ids.length){
      const{data:events}=await _supa.from('qr_events').select('event,qr_source_id').in('qr_source_id',ids);
      (events||[]).forEach(e=>{
        const c=_qrEventCounts[e.qr_source_id]||(_qrEventCounts[e.qr_source_id]={scan:0,form_opened:0,submitted:0});
        if(c[e.event]!=null)c[e.event]++;
      });
    }
  }catch(e){_qrSources=[];_qrEventCounts={};}
  renderQrLeadsPage();
}

const QR_CATEGORIES=['Yard sign','Vehicle / truck wrap','Business card','Door hanger','Flyer','Other'];

function renderQrLeadsPage(){
  const el=document.getElementById('qr-leads-list');
  if(!el)return;
  if(!_qrSources.length){
    el.innerHTML='<div style="text-align:center;padding:40px 20px;color:var(--text3)">'+
      '<div style="font-size:32px;margin-bottom:10px">'+svgIcon('▦',{size:32})+'</div>'+
      '<div style="font-size:14px;font-weight:700;color:var(--text2);margin-bottom:4px">No QR codes yet</div>'+
      '<div style="font-size:12.5px;line-height:1.5">Create one below for a yard sign, the truck, or business cards. Each one tracks its own scans and leads separately.</div>'+
    '</div>';
  }else{
    el.innerHTML=_qrSources.map(s=>{
      const c=_qrEventCounts[s.id]||{scan:0,form_opened:0,submitted:0};
      return '<div style="background:var(--bg2);border:1px solid var(--border2);border-radius:var(--rl);padding:14px;margin-bottom:10px">'+
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:10px">'+
          '<div>'+
            '<div style="font-size:14px;font-weight:700">'+escHtml(s.label)+'</div>'+
            '<div style="font-size:11px;color:var(--text3);font-family:ui-monospace,monospace;margin-top:2px">'+escHtml(s.category)+' · '+escHtml(s.code)+'</div>'+
          '</div>'+
          '<button onclick="_qrDeleteSource(\''+s.id+'\')" style="flex-shrink:0;padding:5px 9px;border-radius:6px;border:1px solid var(--border2);background:none;color:var(--text3);font-size:11px;cursor:pointer;font-family:inherit">Delete</button>'+
        '</div>'+
        '<div style="display:flex;gap:14px;margin-bottom:12px;font-size:12px">'+
          '<div><span style="font-weight:800;color:var(--text)">'+c.scan+'</span> <span style="color:var(--text3)">scanned</span></div>'+
          '<div><span style="font-weight:800;color:var(--text)">'+c.form_opened+'</span> <span style="color:var(--text3)">opened form</span></div>'+
          '<div><span style="font-weight:800;color:var(--blue)">'+c.submitted+'</span> <span style="color:var(--text3)">became a lead</span></div>'+
        '</div>'+
        '<div style="display:flex;gap:8px">'+
          '<button onclick="_qrDownload(\''+s.id+'\',\'svg\')" class="btn btn-sm" style="flex:1">Download SVG (print)</button>'+
          '<button onclick="_qrDownload(\''+s.id+'\',\'png\')" class="btn btn-sm" style="flex:1">Download PNG</button>'+
        '</div>'+
      '</div>';
    }).join('');
  }
  const catSel=document.getElementById('qr-new-cat');
  if(catSel&&!catSel.options.length){
    catSel.innerHTML=QR_CATEGORIES.map(c=>'<option value="'+escHtml(c)+'">'+escHtml(c)+'</option>').join('');
  }
}

async function _qrCreateSource(){
  const labelEl=document.getElementById('qr-new-label');
  const catEl=document.getElementById('qr-new-cat');
  const label=(labelEl?.value||'').trim();
  const category=catEl?.value||'Other';
  if(!label){if(typeof showToast==='function')showToast('Give it a name first, e.g. "Yard sign - 123 Main St"','⚠️');labelEl?.focus();return;}
  const acctId=(typeof _effectiveUid==='function'&&_effectiveUid())||'';
  if(!acctId||!_supa)return;
  const code=_qrGenCode();
  try{
    const{error}=await _supa.from('qr_sources').insert({account_id:acctId,code,label,category});
    if(error)throw error;
    if(labelEl)labelEl.value='';
    if(typeof showToast==='function')showToast('QR code created','✓');
    await _qrLoadSources();
  }catch(e){
    if(typeof showToast==='function')showToast('Could not create QR code, try again','⚠️');
  }
}

async function _qrDeleteSource(id){
  if(!_supa)return;
  try{await _supa.from('qr_sources').delete().eq('id',id);}catch(e){}
  await _qrLoadSources();
}

function _qrDownload(sourceId,format){
  const s=_qrSources.find(x=>x.id===sourceId);if(!s)return;
  if(typeof qrcode!=='function'){if(typeof showToast==='function')showToast('QR generator failed to load, refresh and try again','⚠️');return;}
  const url=_qrTargetUrl(s.code);
  // typeNumber 0 = auto-select the smallest QR version that fits the URL.
  // 'H' error correction always, see file header comment.
  const qr=qrcode(0,'H');
  qr.addData(url);
  qr.make();
  const fname=(s.label||'qr-code').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'')||'qr-code';
  if(format==='svg'){
    // cellSize/margin are just the default render's pixel grid — SVG is
    // vector, a print shop scales this to 12"x12"+ without any quality loss.
    // margin=cellSize*4 matches the ISO quiet-zone minimum (4 modules).
    const svg=qr.createSvgTag({cellSize:10,margin:40});
    const blob=new Blob([svg],{type:'image/svg+xml'});
    _qrTriggerDownload(URL.createObjectURL(blob),fname+'.svg');
  }else{
    const dataUrl=qr.createDataURL(10,40);
    _qrTriggerDownload(dataUrl,fname+'.png');
  }
}
function _qrTriggerDownload(href,filename){
  const a=document.createElement('a');
  a.href=href;a.download=filename;
  document.body.appendChild(a);a.click();a.remove();
}
