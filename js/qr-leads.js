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

// Whether this account has ever created a QR source, cached so the dashboard
// setup checklist (js/dashboard.js _renderDashSetupTodo) can read it
// synchronously on the first render instead of flashing "not done" until
// _qrLoadSources's network round-trip lands (same pattern as the Stripe
// status cache priming in that same function).
function _qrSourceCacheKey(){
  const uid=(typeof _effectiveUid==='function'&&_effectiveUid())||(typeof _supaUser!=='undefined'&&_supaUser&&_supaUser.id)||'';
  return uid?'td_qr_has_source_'+uid:null;
}
// Returns true/false from cache, or null if never cached yet (boot's cue to
// fetch once and correct it — see js/cloud.js's post-load setTimeout).
function _qrHasSourceCached(){
  const key=_qrSourceCacheKey();if(!key)return null;
  try{const v=localStorage.getItem(key);return v===null?null:v==='1';}catch(e){return null;}
}
function _qrSetSourceCache(has){
  const key=_qrSourceCacheKey();if(!key)return;
  try{localStorage.setItem(key,has?'1':'0');}catch(e){}
}

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
  // qr_sources.account_id is a FK to accounts(id), a separate gen_random_uuid()
  // from the owner's own auth uid — _account.id, not _effectiveUid(). Using
  // _effectiveUid() here matches zero rows (RLS-legal, just always empty).
  const acctId=(typeof _account!=='undefined'&&_account&&_account.id)||'';
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
  const hadCache=_qrHasSourceCached();
  _qrSetSourceCache(_qrSources.length>0);
  // Only bother re-rendering the checklist if this call changed what it
  // would show (first-ever load, or a create/delete flipped the count),
  // not on every routine page revisit.
  if(hadCache!==( _qrSources.length>0)&&typeof _renderDashSetupTodo==='function')_renderDashSetupTodo();
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
      const spent=(typeof expenses!=='undefined'?expenses:[]).filter(e=>e.cat==='marketing'&&e.lead_source===s.label).reduce((sum,e)=>sum+(e.amount||0),0);
      const perLead=spent>0&&c.submitted>0?spent/c.submitted:null;
      const roiRow=spent>0
        ?'<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;padding:8px 10px;background:rgba(45,93,168,.06);border-radius:8px;font-size:12px">'+
          '<div><span style="font-weight:800;color:var(--text)">'+fmt(spent)+'</span> <span style="color:var(--text3)">spent</span></div>'+
          '<div style="color:var(--border2)">·</div>'+
          '<div><span style="font-weight:800;color:var(--blue)">'+(perLead!=null?fmt(perLead):'—')+'</span> <span style="color:var(--text3)">'+(perLead!=null?'per lead':'no leads yet')+'</span></div>'+
          '<button onclick="_qrLogCost(\''+s.id+'\')" style="margin-left:auto;flex-shrink:0;border:none;background:none;color:var(--blue);font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;padding:2px">Log more</button>'+
        '</div>'
        :'<div style="margin-bottom:10px">'+
          '<button onclick="_qrLogCost(\''+s.id+'\')" style="border:none;background:none;color:var(--blue);font-size:11.5px;font-weight:700;cursor:pointer;font-family:inherit;padding:0">+ Log what this cost, see ROI</button>'+
        '</div>';
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
        roiRow+
        '<div style="display:flex;gap:8px">'+
          '<button onclick="_qrDownload(\''+s.id+'\',\'png\')" class="btn btn-sm" style="flex:1">Download PNG</button>'+
          '<button onclick="_qrDownload(\''+s.id+'\',\'svg\')" class="btn btn-sm" style="flex:1">Download SVG (print)</button>'+
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
  // account_id is a FK to accounts(id): _account.id, not _effectiveUid() (the
  // auth user's own id — a different uuid). The RLS insert policy checks
  // account_id against accounts owned by auth.uid(), so the wrong id here
  // gets silently rejected by RLS, not caught by any mocked offline test.
  const acctId=(typeof _account!=='undefined'&&_account&&_account.id)||'';
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

// Ties QR spend into the marketing-expense ROI table that already exists on
// the dashboard (renderLeadSources in dashboard.js), rather than building a
// second, parallel cost/ROI system. A "marketing" expense whose lead_source
// matches this QR source's label is exactly what that table already sums.
function _qrLogCost(sourceId){
  const s=_qrSources.find(x=>x.id===sourceId);if(!s)return;
  if(typeof openExpenseFlow!=='function')return;
  openExpenseFlow();
  const catEl=document.getElementById('em-cat');
  if(catEl){catEl.value='marketing';if(typeof toggleExpenseSections==='function')toggleExpenseSections();}
  const srcEl=document.getElementById('em-mkt-source');
  if(srcEl){
    if(![...srcEl.options].some(o=>o.value===s.label)){
      const opt=document.createElement('option');opt.value=s.label;opt.textContent=s.label;
      srcEl.appendChild(opt);
    }
    srcEl.value=s.label;
  }
  const vendEl=document.getElementById('em-vendor');
  if(vendEl&&!vendEl.value)vendEl.value=s.label;
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
    // qr.createDataURL() only ever encodes a GIF (this library has no PNG
    // encoder) — handing that data:image/gif URI to a .png download gives
    // the browser GIF bytes under a .png name, which is what rendered as a
    // corrupt/glitched file for some recipients. Decode it through a canvas
    // so the .png we actually hand out is PNG-encoded.
    const gifDataUrl=qr.createDataURL(10,40);
    const img=new Image();
    img.onload=()=>{
      const canvas=document.createElement('canvas');
      canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
      canvas.getContext('2d').drawImage(img,0,0);
      _qrTriggerDownload(canvas.toDataURL('image/png'),fname+'.png');
    };
    img.onerror=()=>{if(typeof showToast==='function')showToast('PNG render failed, try SVG instead','⚠️');};
    img.src=gifDataUrl;
  }
}
function _qrTriggerDownload(href,filename){
  const a=document.createElement('a');
  a.href=href;a.download=filename;
  document.body.appendChild(a);a.click();a.remove();
}
