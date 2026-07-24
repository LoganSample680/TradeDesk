// ── Settings index / detail panel navigation ────────────────────────────────

function _openSetDetail(key) {
  document.querySelectorAll('.set-detail').forEach(d => d.classList.remove('active'));
  const el = document.getElementById('setd-' + key);
  if (el) el.classList.add('active');
  const iv = document.getElementById('set-index-view');
  if (iv) iv.classList.add('hidden');
  window.scrollTo({top:0,behavior:'instant'});
  document.body.scrollTop = 0;
  document.documentElement.scrollTop = 0;
  _renderSetIndex();
  if (key === 'integrations') _renderIntegrations();
  if (key === 'branding') _renderBrandSwatches(S.brandColor||'#2D5DA8');
}

function _closeSetDetail() {
  document.querySelectorAll('.set-detail').forEach(d => d.classList.remove('active'));
  const iv = document.getElementById('set-index-view');
  if (iv) iv.classList.remove('hidden');
  window.scrollTo({top:0,behavior:'instant'});
  document.body.scrollTop = 0;
  document.documentElement.scrollTop = 0;
  _renderSetIndex();
}

function _renderSetIndex() {
  // Business info meta
  const bizMeta = document.getElementById('set-meta-biz');
  if (bizMeta) {
    const name = S.bname || getOwnerName() || '';
    const city = S.bcity || '';
    const state = S.state || '';
    const loc = [city, state].filter(Boolean).join(', ');
    bizMeta.innerHTML = name ? `<strong>${escHtml(name)}</strong>${loc ? '<br>' + escHtml(loc) : ''}` : '';
  }
  // Branding meta
  const brandMeta = document.getElementById('set-meta-branding');
  if (brandMeta) {
    const color = S.brandColor || '#2D5DA8';
    const safeColor = /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : 'var(--blue)';
    const colorName = _brandColorName(color);
    const hasLogo = !!S.logoData;
    brandMeta.innerHTML = `<strong style="color:${safeColor}">●</strong> ${colorName}${hasLogo ? '<br>Logo set' : ''}`;
  }
  // Rates meta
  const ratesMeta = document.getElementById('set-meta-rates');
  if (ratesMeta) {
    const lr = S.laborRate || S.p1 || '';
    const dep = S.mm || '';
    ratesMeta.innerHTML = lr ? `<strong>$${lr}/hr</strong>${dep ? '<br>' + dep + '% deposit' : ''}` : '';
  }
  // Legal & terms meta
  const legalMeta = document.getElementById('set-meta-legal');
  if (legalMeta) legalMeta.innerHTML = '';
  // Taxes meta
  const taxMeta = document.getElementById('set-meta-taxes');
  if (taxMeta) {
    const state = S.state || '';
    const status = {single:'Single',mfj:'MFJ',mfs:'MFS',hoh:'HOH',qss:'QSS'}[S.txStatus||'single']||'';
    taxMeta.innerHTML = state ? `<strong>${state}</strong>${status ? '<br>' + status : ''}` : '';
  }
  // Cloud sync meta
  const cloudMeta = document.getElementById('set-meta-cloud');
  if (cloudMeta) {
    const synced = typeof supaEnabled === 'function' && supaEnabled() && typeof _supaUser !== 'undefined' && _supaUser;
    cloudMeta.innerHTML = synced ? '<strong style="color:var(--green)">● Synced</strong>' : '<span style="color:var(--text3)">Not synced</span>';
  }
  // Notifications meta (count SMS templates that have content)
  const notifMeta = document.getElementById('set-meta-notifications');
  if (notifMeta) {
    const templates = [S.smsHub, S.smsFollowup, S.smsReminder, S.smsSecond, S.smsIntent].filter(Boolean).length;
    notifMeta.innerHTML = templates ? `<strong>${templates} of 5</strong><br>on` : '';
  }
  // Integrations meta (count connected services)
  const intMeta = document.getElementById('set-meta-integrations');
  if (intMeta) {
    const stripeOk = typeof _stripeConnectStatus !== 'undefined' && _stripeConnectStatus?.connected;
    const count = stripeOk ? 1 : 0;
    intMeta.innerHTML = count ? `<strong>Stripe</strong><br>connected` : '';
  }
  // Header meta
  const headerMeta = document.getElementById('set-index-meta');
  if (headerMeta) {
    const rawName = getOwnerName() || S.bname || '';
    const name = (rawName && !rawName.includes('@')) ? rawName : (S.bname || '');
    headerMeta.textContent = name ? name + ' · TradeDesk Pro' : 'TradeDesk Pro';
  }
  // About version
  const verEl = document.getElementById('set-about-ver');
  if (verEl && typeof APP_VERSION !== 'undefined') verEl.textContent = APP_VERSION;
  const verSub = document.getElementById('set-about-version-sub');
  if (verSub && typeof APP_VERSION !== 'undefined') verSub.textContent = 'v' + APP_VERSION;
  // Dev row visibility
  const devRow = document.getElementById('set-idx-row-dev');
  if (devRow) devRow.style.display = _config?.is_dev ? 'flex' : 'none';
}

const _BRAND_SWATCHES = ['#2D5DA8','#166534','#92400e','#991b1b','#6d28d9','#18181b'];
const _BRAND_SWATCH_NAMES = {
  '#2d5da8':'Denim','#166534':'Forest','#92400e':'Amber','#991b1b':'Crimson','#6d28d9':'Violet','#18181b':'Charcoal'
};
function _brandColorName(hex) {
  return _BRAND_SWATCH_NAMES[String(hex||'').toLowerCase()] || 'Custom';
}
function _renderBrandSwatches(selected) {
  const container = document.getElementById('set-brand-swatches');
  if (!container) return;
  const cur = (selected || document.getElementById('set-brandcolor')?.value || '#2D5DA8').toLowerCase();
  const isPreset = _BRAND_SWATCHES.some(c => c.toLowerCase() === cur);
  container.innerHTML = _BRAND_SWATCHES.map(c => {
    const active = c.toLowerCase() === cur;
    return `<button class="set-swatch${active ? ' active' : ''}" style="background:${c}" onclick="_pickedBrandColor('${c}')" title="${c}">${active ? '<span style="font-size:18px;color:#fff;line-height:1">' + svgIcon('✓', {size: 18}) + '</span>' : ''}</button>`;
  }).join('') +
  `<button class="set-swatch${!isPreset ? ' active' : ''}" style="background:${!isPreset ? cur : 'var(--bg2)'};border:2px dashed var(--border2)" onclick="document.getElementById('set-brandcolor').click()" title="Custom color"><span style="font-size:18px;${!isPreset ? 'color:#fff' : 'color:var(--text3)'};line-height:1">${!isPreset ? svgIcon('✓', {size: 18}) : '+'}</span></button>`;
  const selEl = document.getElementById('set-brand-selected');
  if (selEl) selEl.textContent = 'Selected · ' + (selected || '#2D5DA8').toUpperCase();
}
function _pickedBrandColor(hex) {
  const inp = document.getElementById('set-brandcolor');
  if (inp) inp.value = hex;
  _renderBrandSwatches(hex);
  _updateBootPreview();
}
function _checkSubdomain(val) {
  const el = document.getElementById('set-subdomain-status');
  if (!el) return;
  if (!val) { el.textContent = ''; return; }
  if (/^[a-z0-9-]{3,30}$/.test(val)) {
    el.innerHTML = '<span style="color:var(--green)">' + svgIcon('✓') + ' Available</span>';
  } else {
    el.innerHTML = '<span style="color:var(--text3)">Use lowercase letters, numbers, hyphens (3–30 chars)</span>';
  }
}
function _renderIntegrations() {
  const el = document.getElementById('integrations-list');
  if (!el) return;
  const stripeOk = typeof _stripeConnectStatus !== 'undefined' && _stripeConnectStatus?.connected && _stripeConnectStatus?.charges_enabled;
  const stripeAcct = _stripeConnectStatus?.stripe_account_id || '';
  const rows = [
    {
      icon: '<span style="font-size:16px;font-weight:900;color:#fff">$</span>',
      iconBg: '#635BFF',
      name: 'Stripe',
      badge: stripeOk ? 'ok' : 'off',
      badgeText: stripeOk ? 'Connected' : 'Not connected',
      desc: stripeOk ? `Card + ACH payments · ${stripeAcct ? stripeAcct.slice(0,12) + '…' : ''}` : 'Accept card + ACH payments from clients',
      action: stripeOk ? 'Manage' : 'Connect',
      onclick: `_openStripeConnect()`,
    },
  ];
  el.innerHTML = rows.map(r => `
    <div class="set-int-row">
      <div class="set-int-icon" style="background:${r.iconBg}">${r.icon}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:800;color:var(--text)">${r.name}<span class="set-int-badge ${r.badge}">${r.badgeText}</span></div>
        <div style="font-size:11px;color:var(--text3);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.desc}</div>
      </div>
      <button class="btn btn-sm" onclick="${r.onclick}" style="flex-shrink:0;font-size:12px">${r.action}</button>
    </div>`).join('');
  // Show Stripe surcharge wrap when Stripe is connected
  const sw = document.getElementById('stripe-surcharge-wrap');
  if (sw) sw.style.display = stripeOk ? 'block' : 'none';
}
function _openStripeConnect() {
  const el = document.getElementById('stripe-connect-status-ui');
  if (el) { el.style.display = 'block'; try{el.scrollIntoView({behavior:'smooth',block:'nearest'});}catch(e){} }
  // loadStripeConnectStatus() owns the full render path: it looks up the
  // container, fetches the (cached) Connect status, and calls
  // _renderStripeConnectUI(el, data) with BOTH args. Calling the renderer
  // directly with no args passed el=undefined → el.innerHTML threw.
  if (typeof loadStripeConnectStatus === 'function') loadStripeConnectStatus();
}

function _filterSetRows(q) {
  const rows = document.querySelectorAll('#set-index-view .set-idx-row');
  const term = q.toLowerCase().trim();
  rows.forEach(r => {
    const text = (r.dataset.search || '') + ' ' + (r.textContent || '');
    r.style.display = (!term || text.toLowerCase().includes(term)) ? '' : 'none';
  });
}

// ── Licensing & Compliance ──────────────────────────────────────────────────

function _licDaysUntil(lic){
  if(!lic.expiryDate)return null;
  return Math.ceil((new Date(lic.expiryDate+'T12:00')-new Date())/86400000);
}
function _licStatus(lic){
  if(lic.typeId==='hepa_vacuum')return 'equipment';
  const d=_licDaysUntil(lic);
  if(d===null)return 'noexpiry';
  if(d<0)return 'expired';
  if(d<=30)return 'soon';
  return 'current';
}
function _licStatusBadge(lic){
  const st=_licStatus(lic);
  const d=_licDaysUntil(lic);
  if(st==='expired')return '<span style="display:inline-block;font-size:10px;font-weight:800;text-transform:uppercase;padding:2px 7px;border-radius:10px;background:#fef2f2;color:#991b1b;border:1px solid #fecaca">Expired</span>';
  if(st==='soon')return '<span style="display:inline-block;font-size:10px;font-weight:800;text-transform:uppercase;padding:2px 7px;border-radius:10px;background:#fffbeb;color:#92400e;border:1px solid #fde68a">'+d+'d left</span>';
  if(st==='current')return '<span style="display:inline-block;font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0">Current</span>';
  if(st==='noexpiry')return '<span style="display:inline-block;font-size:10px;color:var(--text3);padding:2px 7px">No expiry set</span>';
  return '';
}

// ── Service States ────────────────────────────────────────────────────────────
const _STATE_ABBRS=['AL','AK','AZ','AR','CA','CO','CT','DC','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];
const _STATE_RE=/\b(AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/;
function _stateNameOf(st){return(typeof STATE_TAX!=='undefined'&&STATE_TAX[st])?STATE_TAX[st].name:st;}
function detectStateFromAddr(addr){if(!addr)return null;const m=String(addr).toUpperCase().match(_STATE_RE);return m?m[1]:null;}
function _initServiceStates(){
  // Auto-populate from existing client + bid addresses on first use
  const found=new Set();
  if(S.state)found.add(S.state);
  (typeof clients!=='undefined'?clients:[]).forEach(c=>{const st=detectStateFromAddr(c.addr||'');if(st)found.add(st);});
  (typeof bids!=='undefined'?bids:[]).forEach(b=>{const st=detectStateFromAddr(b.addr||'');if(st)found.add(st);});
  S.serviceStates=[...found];
  saveAll();
}
function _getServiceStates(){
  if(!S.serviceStates||!S.serviceStates.length)_initServiceStates();
  return S.serviceStates;
}
function addServiceState(st){
  if(!_STATE_ABBRS.includes(st))return;
  if(!S.serviceStates)S.serviceStates=[];
  if(!S.serviceStates.includes(st)){S.serviceStates.push(st);S.serviceStates.sort();saveAll();}
  document.getElementById('_svc-state-ov')?.remove();
  renderLicensing();
}
function removeServiceState(st){
  if(st===S.state)return;
  S.serviceStates=(S.serviceStates||[]).filter(s=>s!==st);
  saveAll();renderLicensing();
}
function checkAddrServiceState(addrVal){
  const st=detectStateFromAddr(addrVal);
  if(!st)return;
  const states=_getServiceStates();
  if(states.includes(st))return;
  const stName=_stateNameOf(st);
  document.getElementById('_svc-state-ov')?.remove();
  const ov=document.createElement('div');ov.className='zmodal-overlay';ov.id='_svc-state-ov';
  ov.innerHTML='<div class="zmodal" style="max-width:360px"><div style="font-size:17px;font-weight:800;margin-bottom:8px">Add '+escHtml(stName)+' to Service States?</div>'+
    '<div style="font-size:13px;color:var(--text3);margin-bottom:20px">This job is in '+escHtml(stName)+'. Adding it ensures the correct lien rights, cancellation notice, and sales tax language are applied to your documents for this state.</div>'+
    '<div style="display:flex;gap:10px">'+
    '<button class="btn btn-p" onclick="addServiceState(\''+escHtml(st)+'\')">Add '+escHtml(stName)+'</button>'+
    '<button class="btn" onclick="document.getElementById(\'_svc-state-ov\')?.remove()">Not now</button>'+
    '</div></div>';
  document.body.appendChild(ov);
}

let _licFilter='all';
function renderLicensing(){
  const body=document.getElementById('lic-page-body');if(!body)return;
  const expired=licenses.filter(l=>_licStatus(l)==='expired').length;
  const soon=licenses.filter(l=>_licStatus(l)==='soon').length;
  let html='';
  // ── Service States section ────────────────────────────────────────────────
  const _svcStates=_getServiceStates();
  html+='<div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:14px 16px;margin-bottom:18px">';
  html+='<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:var(--text3);margin-bottom:10px">Service States</div>';
  html+='<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">';
  _svcStates.forEach(st=>{
    const isPrimary=st===S.state;
    const stName=_stateNameOf(st);
    html+='<span style="display:inline-flex;align-items:center;gap:5px;background:'+(isPrimary?'var(--blue)':'var(--bg3,#e8eef7)')+';color:'+(isPrimary?'#fff':'var(--text)')+';border-radius:20px;padding:5px 12px;font-size:12px;font-weight:700">'+escHtml(stName);
    if(isPrimary)html+=' <span style="font-size:10px;opacity:.75;font-weight:600">(home)</span>';
    else html+='<button onclick="removeServiceState(\''+st+'\')" style="background:none;border:none;color:inherit;opacity:.6;cursor:pointer;font-size:15px;line-height:1;padding:0 0 1px 2px;margin:0" title="Remove">×</button>';
    html+='</span>';
  });
  const _addableStates=_STATE_ABBRS.filter(s=>!_svcStates.includes(s));
  if(_addableStates.length){
    html+='<select onchange="if(this.value){addServiceState(this.value);this.value=\'\'}" style="padding:5px 10px;border-radius:20px;border:1.5px dashed var(--border2);background:var(--bg);color:var(--text3);font-size:12px;font-weight:600;cursor:pointer;font-family:inherit"><option value="">+ Add state</option>';
    _addableStates.forEach(s=>{html+='<option value="'+s+'">'+escHtml(_stateNameOf(s))+'</option>';});
    html+='</select>';
  }
  html+='</div>';
  html+='<div style="font-size:11px;color:var(--text3)">Documents (lien rights, cancellation notices, sales tax) use the law for the state where the job is located. Auto-detected from client addresses.</div>';
  html+='</div>';
  // Summary bar
  if(expired||soon){
    html+='<div style="background:'+(expired?'#fef2f2':'#fffbeb')+';border:1px solid '+(expired?'#fecaca':'#fde68a')+';border-radius:var(--r);padding:10px 14px;margin:10px 0 14px;font-size:13px;font-weight:700;color:'+(expired?'#991b1b':'#92400e')+'">'+(expired?svgIcon('⚠',{size:13})+' '+expired+' expired':'')+(expired&&soon?' · ':'')+( soon?svgIcon('🟡',{size:13})+' '+soon+' expiring within 30 days':'')+'</div>';
  }
  // Filter tabs
  const cats=['all',...LIC_CAT_ORDER.filter(c=>licenses.some(l=>l.cat===c))];
  if(cats.length>1){
    html+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">';
    cats.forEach(c=>{
      const active=_licFilter===c;
      html+='<button onclick="setLicFilter(\''+c+'\')" style="padding:5px 12px;border-radius:20px;border:1px solid '+(active?'var(--blue)':'var(--border)')+';background:'+(active?'var(--blue)':'var(--bg)')+';color:'+(active?'#fff':'var(--text)')+';font-size:12px;font-weight:600;font-family:inherit;cursor:pointer">'+(c==='all'?'All':LIC_CAT_LABELS[c])+'</button>';
    });
    html+='</div>';
  }
  if(!licenses.length){
    html+='<div style="text-align:center;padding:40px 20px;color:var(--text3)"><div style="font-size:40px;margin-bottom:12px">'+svgIcon('📋',{size:40})+'</div><div style="font-size:15px;font-weight:700;margin-bottom:6px">No records yet</div><div style="font-size:13px">Add your business licenses, insurance policies, EPA certifications, and more.</div><button onclick="openAddLicense()" class="btn btn-p" style="margin-top:16px">+ Add first record</button></div>';
    body.innerHTML=html;return;
  }
  // Group by category
  const visLics=_licFilter==='all'?licenses:licenses.filter(l=>l.cat===_licFilter);
  const byCat={};visLics.forEach(l=>{if(!byCat[l.cat])byCat[l.cat]=[];byCat[l.cat].push(l);});
  LIC_CAT_ORDER.forEach(cat=>{
    if(!byCat[cat])return;
    html+='<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:var(--text3);margin:16px 0 8px">'+LIC_CAT_LABELS[cat]+'</div>';
    byCat[cat].forEach(l=>{
      const st=_licStatus(l);
      const t=LIC_TYPES.find(x=>x.id===l.typeId)||{};
      const borderColor=st==='expired'?'#fecaca':st==='soon'?'#fde68a':'var(--border)';
      const isEquip=t.isEquip;
      const logCount=(l.equipmentLog||[]).length;
      const lastLog=logCount?(l.equipmentLog[logCount-1]):'';
      html+='<div style="background:var(--bg2);border:1px solid '+borderColor+';border-radius:var(--r);padding:14px;margin-bottom:10px">';
      html+='<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px">';
      html+='<div style="font-size:14px;font-weight:700;color:var(--text);line-height:1.3">'+escHtml(l.label||t.label||'Record')+'</div>';
      html+=_licStatusBadge(l);
      html+='</div>';
      if(l.holderName)html+='<div style="font-size:12px;color:var(--text3);margin-bottom:4px">'+svgIcon('👤',{size:12})+' '+escHtml(l.holderName)+'</div>';
      if(l.licenseNumber)html+='<div style="font-size:12px;color:var(--text3);margin-bottom:4px">'+svgIcon('🔢',{size:12})+' '+escHtml(l.licenseNumber)+'</div>';
      if(isEquip){
        if(l.make||l.model||l.serial)html+='<div style="font-size:12px;color:var(--text3);margin-bottom:4px">'+escHtml([l.make,l.model,l.serial?'SN: '+l.serial:''].filter(Boolean).join(' · '))+'</div>';
        if(lastLog)html+='<div style="font-size:12px;color:var(--text3);margin-bottom:8px">Last entry: '+fmtDateShort(lastLog.date)+', '+escHtml(lastLog.type)+'</div>';
        html+='<div style="display:flex;gap:8px;margin-top:8px"><button onclick="openHepaLog('+l.id+')" class="btn btn-sm" style="font-size:11px">'+svgIcon('📋',{size:11})+' Log ('+logCount+')</button><button onclick="openEditLicense('+l.id+')" class="btn btn-sm" style="font-size:11px">Edit</button></div>';
      } else {
        if(l.issueDate||l.expiryDate){
          html+='<div style="font-size:12px;color:var(--text3);margin-bottom:4px">';
          if(l.issueDate)html+='Issued: '+fmtDateShort(l.issueDate);
          if(l.issueDate&&l.expiryDate)html+=' · ';
          if(l.expiryDate)html+='Expires: '+fmtDateShort(l.expiryDate);
          html+='</div>';
        }
        if(l.notes)html+='<div style="font-size:11px;color:var(--text3);margin-top:4px">'+escHtml(l.notes)+'</div>';
        html+='<div style="display:flex;gap:8px;margin-top:10px"><button onclick="openEditLicense('+l.id+')" class="btn btn-sm" style="font-size:11px">Edit</button></div>';
      }
      html+='</div>';
    });
  });
  body.innerHTML=html;
}


function setLicFilter(cat){_licFilter=cat;renderLicensing();}

function _licDateDisp(iso){if(!iso)return'';try{const[y,m,d]=iso.split('-');return m+'/'+d+'/'+y;}catch(e){return iso;}}
function _licDateParse(s){if(!s||!s.trim())return'';const t=s.trim();if(/^\d{4}-\d{2}-\d{2}$/.test(t))return t;const m1=t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);if(m1)return m1[3]+'-'+m1[1].padStart(2,'0')+'-'+m1[2].padStart(2,'0');const m2=t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);if(m2)return(parseInt(m2[3])>50?'19':'20')+m2[3]+'-'+m2[1].padStart(2,'0')+'-'+m2[2].padStart(2,'0');return'';}
let _editingLicId=null;
Object.defineProperty(window,'_editingLicId',{get:()=>_editingLicId,set:v=>{_editingLicId=v;},configurable:true});
function openAddLicense(prefillTypeId){
  _editingLicId=null;_showLicModal(null);
  if(prefillTypeId){const sel=document.getElementById('_lic-type-sel');if(sel){sel.value=prefillTypeId;_licTypeChanged(sel);}}
}
function openEditLicense(id){_editingLicId=id;_showLicModal(licenses.find(l=>l.id===id));}

function _showLicModal(lic){
  document.getElementById('_lic-modal-ov')?.remove();
  const ov=document.createElement('div');ov.className='zmodal-overlay';ov.id='_lic-modal-ov';
  const isEquip=lic?LIC_TYPES.find(x=>x.id===lic?.typeId)?.isEquip:false;
  // Build type options grouped by category
  let typeOpts='<option value="">- Select type -</option>';
  LIC_CAT_ORDER.forEach(cat=>{
    const items=LIC_TYPES.filter(t=>t.cat===cat);
    typeOpts+='<optgroup label="'+LIC_CAT_LABELS[cat]+'">';
    items.forEach(t=>{typeOpts+='<option value="'+t.id+'"'+(lic?.typeId===t.id?' selected':'')+'>'+t.label+'</option>';});
    typeOpts+='</optgroup>';
  });
  // Employee options
  let empOpts='<option value="">Company / Firm</option>';
  (S.employees||[]).forEach(e=>{empOpts+='<option value="'+escHtml(e.name||'')+'"'+(lic?.holderId===e.id?' selected':'')+'>'+escHtml(e.name||'')+'</option>';});
  const box=document.createElement('div');box.className='zmodal';
  box.innerHTML=
    '<div style="font-size:17px;font-weight:800;margin-bottom:16px">'+(lic?'Edit Record':'Add Record')+'</div>'+
    '<div class="f"><label>Type</label><select id="_lic-type-sel" onchange="_licTypeChanged(this)">'+typeOpts+'</select></div>'+
    '<div class="f" id="_lic-holder-wrap"><label>Assigned to</label><select id="_lic-holder-sel">'+empOpts+'</select></div>'+
    '<div class="f" id="_lic-num-wrap"><label>Certificate / License #</label><input id="_lic-num" value="'+escHtml(lic?.licenseNumber||'')+'" placeholder="e.g. R-12345"></div>'+
    '<div id="_lic-equip-fields" style="display:'+(isEquip?'block':'none')+'">'+
      '<div class="f"><label>Make / Brand</label><input id="_lic-make" value="'+escHtml(lic?.make||'')+'" placeholder="e.g. Ridgid"></div>'+
      '<div class="f"><label>Model</label><input id="_lic-model" value="'+escHtml(lic?.model||'')+'" placeholder="e.g. WD4870"></div>'+
      '<div class="f"><label>Serial Number</label><input id="_lic-serial" value="'+escHtml(lic?.serial||'')+'" placeholder="Optional"></div>'+
    '</div>'+
    '<div id="_lic-date-fields" style="display:'+(isEquip?'none':'block')+'">'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'+
        '<div class="f"><label>Issue date</label><input type="text" id="_lic-issue" placeholder="MM/DD/YYYY" maxlength="10" oninput="_fmtExpDate(this)" value="'+_ymdToMdY(lic?.issueDate||'')+'"></div>'+
        '<div class="f"><label>Expiry date</label><input type="text" id="_lic-expiry" placeholder="MM/DD/YYYY" maxlength="10" oninput="_fmtExpDate(this)" value="'+_ymdToMdY(lic?.expiryDate||'')+'"></div>'+
      '</div>'+
    '</div>'+
    '<div class="f"><label>Notes</label><input id="_lic-notes" value="'+escHtml(lic?.notes||'')+'" placeholder="Optional"></div>'+
    '<button class="btn btn-p btn-full" style="margin-top:6px" onclick="saveLicenseModal()">Save</button>'+
    '<button class="btn btn-sec btn-full" style="margin-top:8px" onclick="document.getElementById(\'_lic-modal-ov\').remove()">Cancel</button>';
  ov.appendChild(box);document.body.appendChild(ov);
  // Set holder visibility
  const selEl=document.getElementById('_lic-type-sel');
  if(selEl&&lic)_licTypeChanged(selEl);
}

function _licTypeChanged(sel){
  const t=LIC_TYPES.find(x=>x.id===sel.value);
  if(!t)return;
  const holderWrap=document.getElementById('_lic-holder-wrap');
  const numWrap=document.getElementById('_lic-num-wrap');
  const equipFields=document.getElementById('_lic-equip-fields');
  const dateFields=document.getElementById('_lic-date-fields');
  if(holderWrap)holderWrap.style.display=(t.holder==='employee')?'block':'none';
  if(numWrap)numWrap.style.display=(t.noNum||t.isEquip)?'none':'block';
  if(equipFields)equipFields.style.display=t.isEquip?'block':'none';
  if(dateFields)dateFields.style.display=t.isEquip?'none':'block';
}

function saveLicenseModal(){
  const typeId=document.getElementById('_lic-type-sel')?.value;
  if(!typeId){zAlert('Select a record type.');return;}
  const t=LIC_TYPES.find(x=>x.id===typeId);
  const holderRaw=document.getElementById('_lic-holder-sel')?.value||'';
  const holderName=holderRaw||(S.bname||getBusinessName()||'Company');
  const _issueRaw=_licDateParse(document.getElementById('_lic-issue')?.value||'');
  const _expiryRaw=_licDateParse(document.getElementById('_lic-expiry')?.value||'');
  if(_issueRaw&&document.getElementById('_lic-issue')?.value&&!_issueRaw){zAlert('Issue date format not recognized. Use MM/DD/YYYY.');return;}
  if(_expiryRaw&&document.getElementById('_lic-expiry')?.value&&!_expiryRaw){zAlert('Expiry date format not recognized. Use MM/DD/YYYY.');return;}
  if(_issueRaw&&_expiryRaw&&_issueRaw>=_expiryRaw){zAlert('Issue date must be before expiry date.',{title:'Invalid dates'});return;}
  const _recCat=t?t.cat||'business':'business';
  const _recLabel=t?t.label||typeId:typeId;
  const _recHolder=t?t.holder||'':'';
  const _recHolderName=_recHolder==='employee'?holderName:(S.bname||getBusinessName()||'Company');
  const _recNumEl=document.getElementById('_lic-num');
  const _recIssueEl=document.getElementById('_lic-issue');
  const _recExpiryEl=document.getElementById('_lic-expiry');
  const _recNotesEl=document.getElementById('_lic-notes');
  const _recMakeEl=document.getElementById('_lic-make');
  const _recModelEl=document.getElementById('_lic-model');
  const _recSerialEl=document.getElementById('_lic-serial');
  const _recExistingLic=_editingLicId?licenses.find(l=>l.id===_editingLicId):null;
  const rec={
    id:_editingLicId||(Date.now()*1000+Math.floor(Math.random()*999)),
    typeId,cat:_recCat,label:_recLabel,
    holderName:_recHolderName,
    holderId:null,
    licenseNumber:(_recNumEl?_recNumEl.value||'':'').trim(),
    issueDate:_mdYToYmd(_recIssueEl?_recIssueEl.value||'':''),
    expiryDate:_mdYToYmd(_recExpiryEl?_recExpiryEl.value||'':''),
    notes:(_recNotesEl?_recNotesEl.value||'':'').trim(),
    make:(_recMakeEl?_recMakeEl.value||'':'').trim(),
    model:(_recModelEl?_recModelEl.value||'':'').trim(),
    serial:(_recSerialEl?_recSerialEl.value||'':'').trim(),
    equipmentLog:_editingLicId?(_recExistingLic?_recExistingLic.equipmentLog||[]:[]):[],
  };
  if(_editingLicId){const idx=licenses.findIndex(l=>l.id===_editingLicId);if(idx>-1)licenses[idx]=rec;else licenses.push(rec);}
  else{licenses.push(rec);}
  saveAll();document.getElementById('_lic-modal-ov')?.remove();renderLicensing();
}

function deleteLicense(id){
  zConfirm('Delete this record?',()=>{_userDelete(()=>{licenses=licenses.filter(l=>l.id!==id);saveAll();});renderLicensing();},{title:'Delete record',yes:'Delete',danger:true});
}

// ── HEPA Equipment Log ──
function openHepaLog(id){
  const lic=licenses.find(l=>l.id===id);if(!lic)return;
  document.getElementById('_hepa-modal-ov')?.remove();
  const ov=document.createElement('div');ov.className='zmodal-overlay';ov.id='_hepa-modal-ov';
  const box=document.createElement('div');box.className='zmodal';
  function renderLog(){
    const entries=(lic.equipmentLog||[]).slice().reverse();
    return entries.length
      ?entries.map(e=>'<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:9px 0;border-bottom:1px solid var(--border)">'+
          '<div><div style="font-size:13px;font-weight:700">'+escHtml(e.type)+'</div>'+
          (e.who?'<div style="font-size:11px;color:var(--text3)">'+escHtml(e.who)+'</div>':'')+
          (e.notes?'<div style="font-size:11px;color:var(--text3)">'+escHtml(e.notes)+'</div>':'')+
          '</div>'+
          '<div style="text-align:right;flex-shrink:0;margin-left:10px">'+
            '<div style="font-size:12px;color:var(--text3)">'+fmtDateShort(e.date)+'</div>'+
            '<button onclick="_delHepaEntry('+id+',\''+e.id+'\')" style="background:none;border:none;color:var(--text3);font-size:11px;cursor:pointer;padding:2px 0;font-family:inherit">Remove</button>'+
          '</div></div>').join('')
      :'<div style="text-align:center;padding:20px;color:var(--text3);font-size:13px">No log entries yet</div>';
  }
  const name=[lic.make,lic.model].filter(Boolean).join(' ')||'HEPA Vacuum';
  box.innerHTML=
    '<div style="font-size:17px;font-weight:800;margin-bottom:4px">'+escHtml(name)+'</div>'+
    (lic.serial?'<div style="font-size:12px;color:var(--text3);margin-bottom:14px">SN: '+escHtml(lic.serial)+'</div>':'')+
    '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:8px">Maintenance Log</div>'+
    '<div id="_hepa-log-entries">'+renderLog()+'</div>'+
    '<div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border)">'+
      '<div style="font-size:12px;font-weight:700;margin-bottom:8px">Add entry</div>'+
      '<select id="_hepa-type-sel" style="width:100%;margin-bottom:8px;padding:8px;border:1px solid var(--border);border-radius:var(--r);background:var(--bg);color:var(--text);font-family:inherit;font-size:13px">'+
        '<option>Filter Change</option><option>Pre-Job Inspection</option><option>Post-Job Cleaning</option><option>Annual Maintenance</option><option>Filter Disposal (lead debris)</option><option>Repair</option>'+
      '</select>'+
      '<input id="_hepa-who" placeholder="Who (optional)" style="width:100%;margin-bottom:8px;padding:8px;border:1px solid var(--border);border-radius:var(--r);background:var(--bg);color:var(--text);font-family:inherit;font-size:13px;box-sizing:border-box">'+
      '<input id="_hepa-notes" placeholder="Notes (optional)" style="width:100%;margin-bottom:10px;padding:8px;border:1px solid var(--border);border-radius:var(--r);background:var(--bg);color:var(--text);font-family:inherit;font-size:13px;box-sizing:border-box">'+
      '<input id="_hepa-date" placeholder="MM/DD/YYYY" value="'+_licDateDisp(todayKey())+'" style="width:100%;margin-bottom:10px;padding:8px;border:1px solid var(--border);border-radius:var(--r);background:var(--bg);color:var(--text);font-family:inherit;font-size:13px;box-sizing:border-box">'+
      '<button class="btn btn-p btn-full" onclick="_addHepaEntry('+id+')">+ Add Entry</button>'+
    '</div>'+
    '<button class="btn btn-sec btn-full" style="margin-top:10px" onclick="document.getElementById(\'_hepa-modal-ov\').remove()">Close</button>';
  ov.appendChild(box);document.body.appendChild(ov);
}
function _addHepaEntry(licId){
  const lic=licenses.find(l=>l.id===licId);if(!lic)return;
  if(!lic.equipmentLog)lic.equipmentLog=[];
  const _hepaDateEl=document.getElementById('_hepa-date');
  const _hepaTypeEl=document.getElementById('_hepa-type-sel');
  const _hepaWhoEl=document.getElementById('_hepa-who');
  const _hepaNotesEl2=document.getElementById('_hepa-notes');
  const _hepaDateVal=_hepaDateEl?_hepaDateEl.value||'':'';
  const _hepaTypeVal=_hepaTypeEl?_hepaTypeEl.value||'Filter Change':'Filter Change';
  const _hepaWhoVal=(_hepaWhoEl?_hepaWhoEl.value||'':'').trim();
  const _hepaNotesVal2=(_hepaNotesEl2?_hepaNotesEl2.value||'':'').trim();
  lic.equipmentLog.push({
    id:Date.now().toString(36),
    date:_licDateParse(_hepaDateVal)||todayKey(),
    type:_hepaTypeVal,
    who:_hepaWhoVal,
    notes:_hepaNotesVal2
  });
  saveAll();
  // Refresh just the log entries in the modal
  const el=document.getElementById('_hepa-log-entries');
  const entries=(lic.equipmentLog||[]).slice().reverse();
  if(el)el.innerHTML=entries.map(e=>'<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:9px 0;border-bottom:1px solid var(--border)">'+
    '<div><div style="font-size:13px;font-weight:700">'+escHtml(e.type)+'</div>'+
    (e.who?'<div style="font-size:11px;color:var(--text3)">'+escHtml(e.who)+'</div>':'')+
    (e.notes?'<div style="font-size:11px;color:var(--text3)">'+escHtml(e.notes)+'</div>':'')+
    '</div><div style="text-align:right;flex-shrink:0;margin-left:10px">'+
    '<div style="font-size:12px;color:var(--text3)">'+fmtDateShort(e.date)+'</div>'+
    '<button onclick="_delHepaEntry('+licId+',\''+e.id+'\')" style="background:none;border:none;color:var(--text3);font-size:11px;cursor:pointer;padding:2px 0;font-family:inherit">Remove</button>'+
    '</div></div>').join('');
  const who=document.getElementById('_hepa-who');const notes=document.getElementById('_hepa-notes');
  if(who)who.value='';if(notes)notes.value='';
  renderLicensing();
}
function _delHepaEntry(licId,entryId){
  const lic=licenses.find(l=>l.id===licId);if(!lic)return;
  lic.equipmentLog=(lic.equipmentLog||[]).filter(e=>e.id!==entryId);
  saveAll();openHepaLog(licId);
}

// ── Expiry alerts in dashboard (call from renderDash or renderTodayFeed) ──
function getLicenseAlerts(){
  return licenses.filter(l=>{
    const st=_licStatus(l);
    return st==='expired'||st==='soon';
  });
}

// Returns the actual working calendar dates for a job, skipping weekends (unless job.allowWeekend)
function getJobWorkDays(job){
  const allowWknd=!!job.allowWeekend;
  const numDays=parseInt(job.days)||1;
  const days=[];
  let cur=job.start;
  let count=0;
  while(count<numDays){
    const dow=parseD(cur).getDay();
    if(allowWknd||(dow!==0&&dow!==6)){days.push(cur);count++;}
    if(count<numDays)cur=addDays(cur,1);
  }
  return days;
}
function getTimeOffDays(){
  const days=new Set();
  (S.timeOff||[]).forEach(block=>{
    let cur=block.start;
    while(cur<=block.end){days.add(cur);cur=addDays(cur,1);}
  });
  return days;
}
function addTimeOff(start,end,label){
  if(!S.timeOff)S.timeOff=[];
  S.timeOff.push({start,end,label:label||''});
  S.timeOff.sort((a,b)=>a.start.localeCompare(b.start));
  _settingsChanged();refreshAvail();renderCalendar&&renderCalendar();
}
function removeTimeOff(idx){
  if(!S.timeOff)return;
  S.timeOff.splice(idx,1);
  _settingsChanged();refreshAvail();renderCalendar&&renderCalendar();
}
function openTimeOffModal(){
  const existing=document.getElementById('timeoff-modal-overlay');
  if(existing){existing.remove();return;}
  const ov=document.createElement('div');ov.id='timeoff-modal-overlay';ov.className='zmodal-overlay';
  const box=document.createElement('div');box.className='zmodal';
  const render=()=>{
    const blocks=S.timeOff||[];
    box.innerHTML=
      '<div style="font-size:17px;font-weight:800;margin-bottom:4px">'+svgIcon('🏖',{size:17})+' Time off</div>'+
      '<div style="font-size:12px;color:var(--text3);margin-bottom:14px">Block dates from scheduling</div>'+
      (blocks.length?'<div style="margin-bottom:12px">'+blocks.map((b,i)=>
        '<div style="display:flex;justify-content:space-between;align-items:center;background:var(--amber-lt);border:1px solid #D97706;border-radius:var(--r);padding:8px 10px;margin-bottom:6px">'+
          '<div>'+
            '<div style="font-size:12px;font-weight:700;color:#92400E">'+escHtml(b.label||'Time off')+'</div>'+
            '<div style="font-size:11px;color:var(--text3)">'+b.start+(b.start!==b.end?' → '+b.end:'')+'</div>'+
          '</div>'+
          '<button onclick="removeTimeOff('+i+');document.getElementById(\'timeoff-modal-overlay\').remove();openTimeOffModal()" style="border:none;background:#A32D2D;color:#fff;border-radius:6px;padding:4px 8px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit">Remove</button>'+
        '</div>'
      ).join('')+'</div>':'<div style="font-size:12px;color:var(--text3);margin-bottom:12px;text-align:center;padding:10px">No time off blocked</div>')+
      '<div style="background:var(--bg2);border-radius:var(--r);padding:12px;border:1px solid var(--border);margin-bottom:12px">'+
        '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:8px">Add block</div>'+
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">'+
          '<div><label style="font-size:12px;font-weight:700;color:var(--text2);display:block;margin-bottom:4px">Start</label><input type="date" id="to-start" style="width:100%;padding:13px 10px;border-radius:var(--r);border:1.5px solid var(--border2);background:var(--bg2);font-size:16px;font-family:inherit;box-sizing:border-box;color:var(--text)"></div>'+
          '<div><label style="font-size:12px;font-weight:700;color:var(--text2);display:block;margin-bottom:4px">End</label><input type="date" id="to-end" style="width:100%;padding:13px 10px;border-radius:var(--r);border:1.5px solid var(--border2);background:var(--bg2);font-size:16px;font-family:inherit;box-sizing:border-box;color:var(--text)"></div>'+
        '</div>'+
        '<input type="text" id="to-label" placeholder="Label (optional: Vacation, Holiday...)" style="width:100%;padding:8px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg);font-size:13px;font-family:inherit;margin-bottom:8px;box-sizing:border-box">'+
        '<button onclick="_toAdd()" style="width:100%;padding:10px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">+ Add time off</button>'+
      '</div>'+
      '<button onclick="document.getElementById(\'timeoff-modal-overlay\').remove()" style="width:100%;padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:none;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;color:var(--text3)">Close</button>';
    window._toAdd=()=>{
      const s=document.getElementById('to-start')?.value;
      const e=document.getElementById('to-end')?.value||s;
      if(!s){zAlert('Pick a start date.');return;}
      if(e<s){zAlert('End date must be on or after start date.');return;}
      addTimeOff(s,e,document.getElementById('to-label')?.value||'');
      document.getElementById('timeoff-modal-overlay').remove();openTimeOffModal();
    };
  };
  render();ov.appendChild(box);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
}
function getBookedDays(){
  const booked=new Set(),buf=new Set();
  // Include time-off blocks as booked
  getTimeOffDays().forEach(d=>booked.add(d));
  jobs.forEach(j=>{
    // Estimates never block a day, Zach can book multiple estimates on the same day
    // at different times (morning, afternoon, evening). Only paint jobs block days.
    if(j.eventType==='estimate')return;
    const workDays=getJobWorkDays(j);
    workDays.forEach(d=>booked.add(d));
    const lastDay=workDays.length?workDays[workDays.length-1]:j.start;
    const b=parseInt(j.buffer)||0;
    for(let i=1;i<=b;i++)buf.add(addDays(lastDay,i));
  });
  return{booked,buf};
}
// Is this job's work span (start..start+days-1, done/cancelled jobs never
// count) active on the given date? Owner spec 2026-07-18: crew assignment
// now persists for a job's WHOLE span, set once at scheduling time, not
// reconfirmed by hand each morning, so every place that used to gate on
// "assignedDate === today" as its only signal for "is this today's work"
// needs a real date-range check instead. Shared here so geo-track.js,
// cloud.js's dispatch board, and dashboard.js's crew-assign UI can't drift.
function _jobActiveOn(j,dateKey){
  if(!j||j.completion_date||j.cancelled||j.status==='done')return false;
  const start=j.start||j.date||'';if(!start)return false;
  const end=addDays(start,(parseInt(j.days)||1)-1);
  return start<=dateKey&&end>=dateKey;
}
// Crew-scoped variant (owner spec 2026-07-18: multi-crew dispatch at
// multiple times). Two different crews can each have their own job on the
// same day, that's not a conflict, only a job already assigned to THIS SAME
// crew is. empId is a S.employees[].id, or falsy for "unassigned, the owner
// working it themself" (its own pool, distinct from every named crew's pool).
// Solo accounts (S.employees empty) never call this, getBookedDays() alone
// is correct and unchanged for them, this function only exists to be opted
// into once a second crew exists.
function getBookedDaysForCrew(empId){
  const booked=new Set(),buf=new Set();
  getTimeOffDays().forEach(d=>booked.add(d));
  jobs.forEach(j=>{
    if(j.eventType==='estimate')return;
    const sameCrew=empId?String(j.assignedTo||'')===String(empId):!j.assignedTo;
    if(!sameCrew)return;
    const workDays=getJobWorkDays(j);
    workDays.forEach(d=>booked.add(d));
    const lastDay=workDays.length?workDays[workDays.length-1]:j.start;
    const b=parseInt(j.buffer)||0;
    for(let i=1;i<=b;i++)buf.add(addDays(lastDay,i));
  });
  return{booked,buf};
}
function getNextAvail(){const{booked,buf}=getBookedDays();const all=new Set([...booked,...buf]);const allowWknd=document.getElementById('s-allow-weekend')?.checked||false;let d=todayKey();for(let i=0;i<180;i++){const dow=parseD(d).getDay();const isWknd=dow===0||dow===6;if(!all.has(d)&&(allowWknd||!isWknd)){const dt=parseD(d);return{key:d,label:dt.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})};}d=addDays(d,1);}return{key:todayKey(),label:'Check calendar'};}
// Standalone next-avail that doesn't need DOM, used for scheduling suggestions
function getNextAvailForBid(bid){
  const{booked,buf}=getBookedDays();const all=new Set([...booked,...buf]);
  const allowWknd=!!(bid&&bid.allowWeekend);
  // Start from tomorrow at earliest
  let d=addDays(todayKey(),1);
  for(let i=0;i<180;i++){
    const dow=parseD(d).getDay();const isWknd=dow===0||dow===6;
    if(!all.has(d)&&(allowWknd||!isWknd))return d;
    d=addDays(d,1);
  }
  return addDays(todayKey(),1);
}
function _jobEndDate(startKey,numDays,allowWknd){
  let count=0,cur=startKey;
  while(count<numDays){const dow=parseD(cur).getDay();if(allowWknd||(dow!==0&&dow!==6))count++;if(count<numDays)cur=addDays(cur,1);}
  return cur;
}

function buildScopeDefaultsUI(){
  const el=document.getElementById('set-scope-defaults');if(!el)return;
  const defaults=S.defaultScope||{};
  el.innerHTML=SCOPE_ITEMS.map(s=>
    '<label style="display:flex;align-items:center;gap:8px;font-size:13px;padding:6px;background:var(--bg2);border-radius:var(--r);cursor:pointer">'+
      '<input type="checkbox" id="ssd-'+s.id+'"'+(defaults[s.id]?' checked':'')+
        ' onchange="saveScopeDefault(\''+s.id+'\',this.checked)" style="width:16px;height:16px;cursor:pointer">'+
      s.label+
    '</label>'
  ).join('');
}
function saveScopeDefault(id,checked){
  if(!S.defaultScope)S.defaultScope={};
  S.defaultScope[id]=checked;
  _settingsChanged();
}
function _getSmsDefaults(){
  return {
    hub:`Hi {name}, here's your project hub from {business}: {url}`,
    followup:`Hey {name}!\n\nJust following up, your proposal is still ready to go. Tap the link below to review and sign:\n\n{url}\n\nAny questions, just reply!\n\n- {business}`,
    reminder:`Hi {name}, this is {business}. Just a friendly reminder that a balance of {amount} is outstanding for the work at {address}. Please let us know when you're ready to take care of this. Thank you!`,
    second:`Hi {name}, this is a second notice from {business}. A balance of {amount} remains outstanding for work completed at {address}. Please respond within 5 business days to arrange payment and avoid further collection steps.`,
    intent:`{name}, this is formal written notice from {business} of our intent to file a Mechanic's Lien against the property at {address} for unpaid services totaling {amount}. You have 7 days to remit full payment before we proceed with filing. Please contact us immediately.`,
  };
}
function _smsApply(template,vars){
  return template
    .replace(/\{name\}/g,vars.name||'')
    .replace(/\{business\}/g,vars.business||'')
    .replace(/\{url\}/g,vars.url||'')
    .replace(/\{amount\}/g,vars.amount||'')
    .replace(/\{address\}/g,vars.address||'');
}
function _resetSmsTemplate(id){
  const defaults=_getSmsDefaults();
  const map={'set-sms-hub':'hub','set-sms-followup':'followup','set-sms-reminder':'reminder','set-sms-second':'second','set-sms-intent':'intent'};
  const el=document.getElementById(id);
  if(el&&map[id])el.value=defaults[map[id]];
}
function applySettings(){
  FED_BRACKETS.single=[[S.b10,.10],[S.b12,.12],[S.b22,.22],[S.b24,.24],[S.b32,.32],[S.b35,.35],[Infinity,.37]];
  FED_BRACKETS.mfj=[[S.b10*2,.10],[S.b12*2,.12],[S.b22*2,.22],[S.b24*2,.24],[S.b32*2,.32],[S.b35*2,.35],[Infinity,.37]];
  FED_BRACKETS.mfs=[[S.b10,.10],[S.b12,.12],[S.b22,.22],[S.b24,.24],[S.b32,.32],[S.b35*.6,.35],[Infinity,.37]];
  FED_BRACKETS.hoh=[[16550,.10],[63100,.12],[S.b22,.22],[S.b24,.24],[S.b32,.32],[S.b35,.35],[Infinity,.37]];
  FED_BRACKETS.qss=FED_BRACKETS.mfj;
  STD_DED={single:S.fedSingle||15000,mfj:S.fedMFJ||30000,mfs:S.fedMFS||15000,hoh:S.fedHOH||22500,qss:S.fedMFJ||30000};
  const _sd=_getActiveStateData();
  KS_BRACKETS.single=_buildStateBrackets(_sd,'single');
  KS_BRACKETS.mfj=_buildStateBrackets(_sd,'mfj');
  KS_BRACKETS.mfs=_buildStateBrackets(_sd,'mfs');
  KS_BRACKETS.hoh=_buildStateBrackets(_sd,'hoh');
  KS_BRACKETS.qss=KS_BRACKETS.mfj;
  KS_STD={single:_sd.stdS||0,mfj:_sd.stdM||0,mfs:_sd.stdS||0,hoh:_sd.stdS||0,qss:_sd.stdM||0};
  // Sync topbar/nav brand slot whenever settings (incl. bname/logoData) change
  if(typeof applyBrandLogo==='function')applyBrandLogo();
}
// Background syncs (broadcast from another device, auto rate/bracket refresh)
// must never rewrite the form while the user is editing it, that silently
// erases everything typed since the last Save. "Editing" = the user actually
// typed since the last render/save (_settingsFormDirty, set by the input
// listener below). A clean Settings page DOES refresh, so changes saved on
// another device appear live.
function _refillSettingsFormUnlessEditing(){
  if(document.getElementById('pg-settings')?.classList.contains('active')&&window._settingsFormDirty){
    return;
  }
  loadSettingsForm();
}
// Any keystroke in the Settings page marks the form dirty until the next
// render (loadSettingsForm) or Save.
(function(){
  const _pg=document.getElementById('pg-settings');
  if(_pg)_pg.addEventListener('input',()=>{window._settingsFormDirty=true;});
})();
function loadSettingsForm(){
  window._settingsFormFilled=true; // saveSettings() may now safely harvest the form
  window._settingsFormDirty=false; // fresh render, no in-progress edits
  const sf=(id,val)=>{const el=document.getElementById(id);if(el)el.value=val;};
  const sd=(id,val)=>{const el=document.getElementById(id);if(el)el.textContent=val;};
  const fmt$=n=>'$'+(n||0).toLocaleString();
  sf('set-irs',S.irsRate);sf('set-year',new Date().getFullYear());sf('set-fs',S.fedSingle);sf('set-fm',S.fedMFJ);sf('set-fms',S.fedMFS);sf('set-fh',S.fedHOH);
  sf('set-b10',S.b10);sf('set-b12',S.b12);sf('set-b22',S.b22);sf('set-b24',S.b24);sf('set-b32',S.b32);sf('set-b35',S.b35);
  sf('set-ksl',S.ksLow);sf('set-kst',S.ksTop);sf('set-ksh',S.ksHigh);sf('set-kss',S.ksStdS);sf('set-ksm',S.ksStdM);
  // Stamp current year into header note
  const _byn=document.getElementById('set-bracket-yr-note');if(_byn)_byn.textContent='· '+(S.taxYear||new Date().getFullYear())+' IRS values · auto-updated each January';
  // Display-only bracket spans
  sd('set-fs-disp',fmt$(S.fedSingle||15000));sd('set-fm-disp',fmt$(S.fedMFJ||30000));sd('set-fms-disp',fmt$(S.fedMFS||15000));sd('set-fh-disp',fmt$(S.fedHOH||22500));
  sd('set-b10-disp',fmt$(S.b10||11925));sd('set-b12-disp',fmt$(S.b12||48475));sd('set-b22-disp',fmt$(S.b22||103350));sd('set-b24-disp',fmt$(S.b24||197300));sd('set-b32-disp',fmt$(S.b32||250525));sd('set-b35-disp',fmt$(S.b35||626350));
  sd('set-ksl-disp',(S.ksLow||3.1)+'%');sd('set-ksh-disp',(S.ksHigh||5.7)+'%');sd('set-kst-disp',fmt$(S.ksTop||33000));sd('set-kss-disp',fmt$(S.ksStdS||3500));sd('set-ksm-disp',fmt$(S.ksStdM||8000));
  sf('set-txstatus',S.txStatus||'single');
  sf('set-goal-monthly',S.goalMonthly||'');
  sf('set-labor-rate',S.laborRate||45);sf('set-owner-name',getOwnerName()||'');sf('set-bname',S.bname);sf('set-state',S.state||'KS');
  _renderLogoPreview();
  if(S.state){const lbl=document.getElementById('set-state-label');const info=STATE_TAX[S.state];if(lbl&&info)lbl.textContent=info.name+' tax rates';}sf('set-subdomain',S.subdomain||'');sf('set-bphone',S.bphone);sf('set-blic',S.blic);sf('set-since-year',S.sinceYear||'');sf('set-bemail',S.bemail||'');sf('set-veh',S.veh);
  sf('set-margin',S.margin);sf('set-deposit-pct',S.depositPct!=null?S.depositPct:25);sf('set-cov',S.cov);sf('set-mm',S.mm);sf('set-supplies-rate',S.suppliesRate||0.12);
  sf('set-review-url',S.reviewUrl||'');
  const brandColor=S.brandColor||'#2D5DA8';
  sf('set-brandcolor',brandColor);
  _renderBrandSwatches(brandColor);
  sf('set-baddr',S.baddr||'');
  sf('set-bcity',S.bcity||'');
  sf('set-bzip',S.bzip||'');
  const bstateEl=document.getElementById('set-bstate-display');if(bstateEl)bstateEl.value=S.state||'KS';
  sf('set-sales-tax-rate',S.salesTaxRate||'');
  const powEl=document.getElementById('set-powered-by');if(powEl)powEl.checked=S.poweredBy!==false;
  sf('set-track-start',S.trackStart||'07:00');sf('set-track-end',S.trackEnd||'18:00');sf('set-labor-burden',Math.round(((S.laborBurden||1.3)-1)*100));
  const _optEl=document.getElementById('set-owner-pay-type');if(_optEl)_optEl.value=S.ownerPayType||'hourly';sf('set-owner-pay-rate',S.ownerPayRate||'');
  const ctEl=document.getElementById('set-custom-terms');if(ctEl)ctEl.value=S.customTerms||'';
  const coEl=document.getElementById('set-co-terms');if(coEl)coEl.value=S.coTerms||'';
  const _smsDefaults=_getSmsDefaults();
  sf('set-sms-hub',S.smsHub||_smsDefaults.hub);
  sf('set-sms-followup',S.smsFollowup||_smsDefaults.followup);
  sf('set-sms-reminder',S.smsReminder||_smsDefaults.reminder);
  sf('set-sms-second',S.smsSecond||_smsDefaults.second);
  sf('set-sms-intent',S.smsIntent||_smsDefaults.intent);
  _updateBootPreview();
  sf('set-bwebsite',S.bwebsite||'');
  const hoEl=document.getElementById('set-home-office');if(hoEl)hoEl.checked=!!S.homeOffice;
  // Payment methods default ON for any account that never set them (undefined→true),
  // so existing contractors keep every option they had before this toggle shipped.
  const _pmCash=document.getElementById('set-accept-cash');if(_pmCash)_pmCash.checked=S.acceptCash!==false;
  const _pmCheck=document.getElementById('set-accept-check');if(_pmCheck)_pmCheck.checked=S.acceptCheck!==false;
  const _pmLater=document.getElementById('set-allow-pay-later');if(_pmLater)_pmLater.checked=S.allowPayLater!==false;
  const ccEl=document.getElementById('set-cc-surcharge-enabled');if(ccEl){ccEl.checked=!!S.ccSurchargeEnabled;const pctWrap=document.getElementById('set-cc-surcharge-pct-wrap');if(pctWrap)pctWrap.style.display=S.ccSurchargeEnabled?'block':'none';}
  const ccPctEl=document.getElementById('set-cc-surcharge-pct');if(ccPctEl)ccPctEl.value=S.ccSurchargePct||3;
  const fcPctEl=document.getElementById('set-finance-charge-pct');if(fcPctEl)fcPctEl.value=S.financeChargePct!=null?S.financeChargePct:1.5;
  const wpEl=document.getElementById('set-warranty-period');if(wpEl)wpEl.value=S.warrantyPeriod||'1 year';
  _renderLogoPreviewBiz();
  _renderSetIndex();
}
function saveSettings(){
  // Guard: saveSettings harvests EVERY field from the form. If the form was
  // never filled this session (loadSettingsForm not yet run), harvesting would
  // rebuild S from empty inputs and wipe every saved value, exactly the bug
  // where registerDevice() wiped settings on every boot. Persist S as-is instead.
  if(!window._settingsFormFilled){saveAll();return;}
  const gf=id=>parseFloat(v(id))||0,gs=id=>v(id);
  setOwnerName(gs('set-owner-name')||getOwnerName()||'');
  const _smsD=_getSmsDefaults();
  S={...S,
    smsHub:gs('set-sms-hub')||_smsD.hub,
    smsFollowup:gs('set-sms-followup')||_smsD.followup,
    smsReminder:gs('set-sms-reminder')||_smsD.reminder,
    smsSecond:gs('set-sms-second')||_smsD.second,
    smsIntent:gs('set-sms-intent')||_smsD.intent,
    txStatus:gs('set-txstatus')||'single',goalMonthly:gf('set-goal-monthly')||0,irsRate:gf('set-irs')||.700,taxYear:parseInt(v('set-year'))||2026,fedSingle:gf('set-fs')||15000,fedMFJ:gf('set-fm')||30000,fedMFS:gf('set-fms')||15000,fedHOH:gf('set-fh')||22500,b10:gf('set-b10')||11925,b12:gf('set-b12')||48475,b22:gf('set-b22')||103350,b24:gf('set-b24')||197300,b32:gf('set-b32')||250525,b35:gf('set-b35')||626350,ksLow:gf('set-ksl')||3.1,ksTop:gf('set-kst')||33000,ksHigh:gf('set-ksh')||5.7,ksStdS:gf('set-kss')||3500,ksStdM:gf('set-ksm')||8000,laborRate:gf('set-labor-rate')||45,bname:gs('set-bname'),bphone:gs('set-bphone'),blic:gs('set-blic'),state:gs('set-state')||S.state||'',bemail:gs('set-bemail'),veh:gs('set-veh'),bitlyKey:S.bitlyKey||'',subdomain:gs('set-subdomain')||'',vehicles:S.vehicles||[],margin:gf('set-margin')||25,depositPct:gf('set-deposit-pct')||25,cov:gf('set-cov')||350,mm:gf('set-mm')||20,suppliesRate:gf('set-supplies-rate')||0.25,sinceYear:parseInt(gs('set-since-year'))||0,reviewUrl:gs('set-review-url')||'',brandColor:adaBrand(gs('set-brandcolor'))||'',bwebsite:gs('set-bwebsite')||'',
    baddr:gs('set-baddr')||'',bcity:gs('set-bcity')||'',bzip:gs('set-bzip')||'',state:gs('set-bstate-display')||gs('set-state')||S.state||'',
    poweredBy:document.getElementById('set-powered-by')?.checked!==false,
    teamTracking:true, // crew tracking is always on, a condition of using TradeDesk
    trackStart:gs('set-track-start')||'07:00',
    trackEnd:gs('set-track-end')||'18:00',
    laborBurden:1+((parseFloat(v('set-labor-burden'))||0)/100),
    ownerPayType:gs('set-owner-pay-type')||'hourly',
    ownerPayRate:gf('set-owner-pay-rate')||0,
    customTerms:gs('set-custom-terms')||'',coTerms:gs('set-co-terms')||'',
    acceptCash:document.getElementById('set-accept-cash')?document.getElementById('set-accept-cash').checked:(S.acceptCash!==false),
    acceptCheck:document.getElementById('set-accept-check')?document.getElementById('set-accept-check').checked:(S.acceptCheck!==false),
    allowPayLater:document.getElementById('set-allow-pay-later')?document.getElementById('set-allow-pay-later').checked:(S.allowPayLater!==false),
    ccSurchargeEnabled:!!(document.getElementById('set-cc-surcharge-enabled')?document.getElementById('set-cc-surcharge-enabled').checked:false),
    ccSurchargePct:parseFloat((document.getElementById('set-cc-surcharge-pct')?document.getElementById('set-cc-surcharge-pct').value:'3')||'3')||3,
    financeChargePct:parseFloat((document.getElementById('set-finance-charge-pct')?document.getElementById('set-finance-charge-pct').value:'1.5')||'1.5')||1.5,
    warrantyPeriod:document.getElementById('set-warranty-period')?.value||'1 year',
    salesTaxRate:(()=>{const _sr=v('set-sales-tax-rate').trim();return _sr===''?0:parseFloat(_sr)||0;})(),
    salesTaxRateSource:S.salesTaxRateSource||'',
    swPrices:S.swPrices||{},
    // Last explicit settings save, lets cloud/cache loads detect a stale
    // incoming copy and keep local (see _mergeIncomingSettings in cloud.js)
    settingsTs:Date.now()};
  window._settingsFormDirty=false; // edits are now saved, background refills are safe again
  applySettings();saveAll();
  // Flush settings to Supabase immediately (don't rely on 2s debounce, user may refresh first)
  if(typeof supaSaveToCloud==='function')supaSaveToCloud();
  // Keep accounts table in sync so loadAccountData() reads the correct values on next page load.
  // Without this, loadAccountData() overwrites S.bname with the original onboarding value every refresh.
  if(typeof _supa!=='undefined'&&_supa&&typeof _account!=='undefined'&&_account?.id){
    const _acctUpdates={};
    if(S.bname!==_account.business_name)_acctUpdates.business_name=S.bname||'';
    if(S.bphone!==_account.phone)_acctUpdates.phone=S.bphone||'';
    if(Object.keys(_acctUpdates).length){
      _supa.from('accounts').update(_acctUpdates).eq('id',_account.id).then(()=>{
        if(_account){if('business_name'in _acctUpdates)_account.business_name=S.bname;if('phone'in _acctUpdates)_account.phone=S.bphone;}
      }).catch(e=>console.warn('Account sync failed:',e));
    }
  }
  // Refresh the nav user card so a freshly entered name shows immediately
  // (applyPermissions owns the nav-user-name/avatar/role render).
  if(typeof applyPermissions==='function')applyPermissions();
  const el=document.getElementById('set-saved');if(el){el.style.display='block';setTimeout(()=>el.style.display='none',3000);}
  // Propagate branding/settings to all live client hubs in the background
  if(supaEnabled()&&_supaUser)clients.filter(c=>c.clientToken).forEach(c=>{_uploadClientHub(c.id).catch(()=>{});});
}
function _renderLogoPreview(){
  const el=document.getElementById('set-logo-preview');if(!el)return;
  const src=S.logoData||'';
  el.innerHTML=src
    ?'<img src="'+src+'" style="height:48px;max-width:180px;object-fit:contain;display:block" alt="Logo preview">'
    :'<span style="font-size:11px;color:rgba(255,255,255,.5)">No logo</span>';
  _renderLogoPreviewBiz();
}
function _renderLogoPreviewBiz(){
  const el=document.getElementById('set-logo-preview-biz');if(!el)return;
  const fn=document.getElementById('set-logo-filename');
  const btn=document.getElementById('set-logo-btn');
  const src=S.logoData||'';
  if(src){
    el.innerHTML='<img src="'+src+'" style="width:100%;height:100%;object-fit:contain;display:block" alt="Logo">';
    if(fn)fn.textContent='Logo uploaded';
    if(btn)btn.textContent='Replace';
  }else{
    el.innerHTML='<span style="font-size:12px;font-weight:800;color:rgba(255,255,255,.5)">'+(S.bname||'SP').split(' ').map(w=>w[0]||'').slice(0,2).join('')+'</span>';
    if(fn)fn.textContent='';
    if(btn)btn.textContent='Upload image';
  }
}
function applyBrandLogo(){
  document.querySelectorAll('.brand-logo-slot').forEach(el=>{
    if(S.logoData){
      el.innerHTML='<img src="'+S.logoData+'" style="height:32px;max-width:140px;object-fit:contain;display:block" alt="'+escHtml(S.bname||'Logo')+'">';
    } else {
      el.textContent=S.bname||'TradeDesk';
    }
  });
}
function _updateBootPreview(){
  const color=(document.getElementById('set-brandcolor')||{}).value||S.brandColor||'';
  const logo=S.logoData||'';
  const bname=S.bname||'';
  const bg=document.getElementById('boot-preview-bg');
  const bar=document.getElementById('boot-preview-bar');
  const wordmark=document.getElementById('boot-preview-wordmark');
  const pro=document.getElementById('boot-preview-pro');
  const logoEl=document.getElementById('boot-preview-logo');
  if(!bg)return;
  if(color){
    bg.style.background=color;
    if(bar){
      const hex=color.replace('#','');
      const r=parseInt(hex.substr(0,2),16)||0,g=parseInt(hex.substr(2,2),16)||0,b=parseInt(hex.substr(4,2),16)||0;
      const lum=(0.299*r+0.587*g+0.114*b)/255;
      bar.style.background=lum>0.5?'rgba(0,0,0,0.35)':'rgba(255,255,255,0.6)';
    }
  }else{
    bg.style.background='radial-gradient(120% 80% at 0% 100%,rgba(45,93,168,.36) 0%,transparent 55%),linear-gradient(155deg,#1B1612 0%,#1F2230 100%)';
    if(bar)bar.style.background='#2D5DA8';
  }
  if(logoEl){
    if(logo){
      logoEl.innerHTML='<img src="'+logo+'" style="max-height:36px;max-width:120px;object-fit:contain">';
    }else if(bname){
      logoEl.innerHTML='<span style="font-family:Geist,sans-serif;font-weight:900;font-size:22px;color:#fff;letter-spacing:-1px">'+bname.replace(/</g,'&lt;')+'</span>';
    }else{
      logoEl.innerHTML='<span id="boot-preview-wordmark" style="font-family:Geist,sans-serif;font-weight:900;font-size:22px;color:#fff;letter-spacing:-1px">TradeDesk</span><span id="boot-preview-pro" style="font-size:8px;font-weight:800;color:#5C8FD4;background:rgba(45,93,168,.18);border:1px solid rgba(45,93,168,.36);padding:2px 5px;border-radius:4px;text-transform:uppercase;letter-spacing:.06em;margin-left:5px;vertical-align:4px">Pro</span>';
    }
  }
}
function handleLogoUpload(input){
  const file=input.files&&input.files[0];if(!file)return;
  if(!file.type.match(/^image\/(png|jpeg|svg\+xml)$/)){zAlert('Please upload a PNG, JPG, or SVG file.');input.value='';return;}
  const reader=new FileReader();
  reader.onload=e=>{
    S.logoData=e.target.result;_settingsChanged();_renderLogoPreview();applyBrandLogo();_updateBootPreview();
    showToast('Logo saved, proposals will use your logo','🎨');
  };
  reader.readAsDataURL(file);
}
function clearLogoSetting(){
  S.logoData='';S.logoUrl='';S.logoHash='';_settingsChanged();_renderLogoPreview();_updateBootPreview();
  showToast('Logo removed, proposals will show business name','✓');
}
// Crew "today"/contractor labor isn't a local store, it's cloud time-tracking
// (job_time_entries + shop_time_entries) and raw GPS (location_pings), keyed by
// contractor_user_id. "Clear all data" hard-deletes those so the Crew Today tile
// empties too. team_members (the crew roster / invited accounts) is deliberately
// left intact, that's identity, not tracking, and wiping it would break invites.
async function _clearCrewTrackingCloud(){
  if(typeof supaEnabled!=='function'||!supaEnabled()||typeof _supa==='undefined'||!_supa||!_supaUser)return;
  const cid=(typeof _contractorUserId!=='undefined'&&_contractorUserId)||_supaUser.id;
  for(const t of ['job_time_entries','shop_time_entries','location_pings']){
    try{await _supa.from(t).delete().eq('contractor_user_id',cid);}catch(_e){}
  }
}
function clearAllData(){
  zConfirm('This will permanently delete ALL clients, proposals, jobs, income, expenses, and mileage. This cannot be undone.',()=>{
    zConfirm('Last chance, are you absolutely sure you want to delete everything?',async()=>{
      // Deliberate wipe, bypass supaSaveToCloud's accidental-wipe sanity guard so the
      // soft-delete actually reaches the cloud (otherwise the cleared rows, e.g. the
      // maintenance contracts behind the dashboard "Maintenance Due" card, resurrect).
      if(typeof _setDeliberateWipe==='function')_setDeliberateWipe(true);
      // Every user-data store declared in data.js must be wiped here, leaving any
      // out (maintenance/events/photos/licenses/contracts/agreements were all
      // missing) means those records survive a "Clear all data" and resurface.
      _userDelete(()=>{
        clients=[];bids=[];jobs=[];income=[];expenses=[];mileage=[];maintenance=[];payments=[];liens=[];timeEntries=[];events=[];photos=[];licenses=[];contracts=[];agreements=[];checksState={};
        S.employees=[];_setVehicles([]); // stamped wipe, must beat any stale cloud copy in the merge
        estLinkedClientId=null;editingBidId=null;
        gps={active:false,startCoords:null,startTime:null,clientId:null,clientName:'',timerInt:null,vehicle:'',purpose:''};
        if(_activeTimer){clearInterval(_activeTimer.timerInterval);_activeTimer=null;hideClockBanner();}
        hideDriveBanner();saveAll();
      });
      // AWAIT the flush so the soft-delete lands in the cloud BEFORE we re-render or any
      // realtime reload fires, this is what stops the cleared rows from re-hydrating.
      try{ if(typeof _flushSaveNow==='function') await _flushSaveNow(); }catch(_e){}
      if(typeof _setDeliberateWipe==='function')_setDeliberateWipe(false);
      await _clearCrewTrackingCloud();
      renderDash();
      zAlert('All data cleared. Starting fresh!',{title:'Done'});
      goPg('pg-dash');
    },{title:'Last chance',yes:'Delete everything',danger:true});
  },{title:'Clear all data',yes:'Yes, clear everything',danger:true});
}

function clearMileageOnly(){
  zConfirm('Delete all mileage records? This cannot be undone.',async()=>{
    if(typeof _setDeliberateWipe==='function')_setDeliberateWipe(true);
    _userDelete(()=>{mileage=[];saveAll();});
    try{ if(typeof _flushSaveNow==='function') await _flushSaveNow(); }catch(_e){}
    if(typeof _setDeliberateWipe==='function')_setDeliberateWipe(false);
    renderAllMileage();renderDash();
    zAlert('Mileage cleared.',{title:'Done'});
  },{title:'Clear mileage',yes:'Delete mileage',danger:true});
}

function clearClientsOnly(){
  zConfirm('Delete all clients, proposals, jobs, and payments? This cannot be undone.',async()=>{
    if(typeof _setDeliberateWipe==='function')_setDeliberateWipe(true);
    _userDelete(()=>{
      clients=[];bids=[];jobs=[];income=[];payments=[];liens=[];
      estLinkedClientId=null;editingBidId=null;
      saveAll();
    });
    try{ if(typeof _flushSaveNow==='function') await _flushSaveNow(); }catch(_e){}
    if(typeof _setDeliberateWipe==='function')_setDeliberateWipe(false);
    renderDash();
    zAlert('Clients and all related records cleared.',{title:'Done'});
  },{title:'Clear clients',yes:'Delete clients',danger:true});
}

function clearExpensesOnly(){
  zConfirm('Delete all expense records? This cannot be undone.',async()=>{
    // Wrap in _userDelete so the sweep records the expense ids and soft-deletes them in
    // the cloud (without this, cleared expenses had no delete-intent and resurrected).
    if(typeof _setDeliberateWipe==='function')_setDeliberateWipe(true);
    _userDelete(()=>{expenses=[];saveAll();});
    try{ if(typeof _flushSaveNow==='function') await _flushSaveNow(); }catch(_e){}
    if(typeof _setDeliberateWipe==='function')_setDeliberateWipe(false);
    renderDash();
    zAlert('Expenses cleared.',{title:'Done'});
  },{title:'Clear expenses',yes:'Delete expenses',danger:true});
}

function resetSettings(){zConfirm('Reset all settings to defaults?',()=>{S={irsRate:.700,taxYear:2026,fedSingle:15000,fedMFJ:30000,fedMFS:15000,fedHOH:22500,b10:11925,b12:48475,b22:103350,b24:197300,b32:250525,b35:626350,ksLow:3.1,ksTop:33000,ksHigh:5.7,ksStdS:3500,ksStdM:8000,bname:'',bphone:'',blic:'Licensed & Insured',veh:'',margin:40,cov:350,p1:83,p2:65,p3:95,mm:15};applySettings();loadSettingsForm();},{title:'Reset settings',yes:'Reset',danger:false});}
function resetLocationPermission(){
  delete S.weatherLat;delete S.weatherLon;S.locationDenied=false;S.locationGranted=false;
  S.settingsTs=Date.now(); // win the next cloud merge so the reset sticks across reboot
  _weatherCache=null;saveAll();
  updateLocationBtn();
  requestLocationPermission(()=>{
    updateLocationBtn();
    zAlert('Location access granted. Weather and GPS drive are now enabled.',{title:svgIcon('✓')+' Location enabled'});
  },()=>{
    updateLocationBtn();
    zAlert('Location not allowed. You can try again any time from Settings.',{title:'Location blocked'});
  });
}
function updateLocationBtn(){
  const btn=document.getElementById('location-settings-btn');if(!btn)return;
  if(S.locationDenied){btn.innerHTML=svgIcon('📍')+' Location: Off: tap to enable';btn.style.color='var(--text3)';}
  else if(S.weatherLat){btn.innerHTML=svgIcon('📍')+' Location: On '+svgIcon('✓');btn.style.color='var(--green-mid)';}
  else{btn.innerHTML=svgIcon('📍')+' Location access';btn.style.color='';}
}

// EVERY vehicle write goes through here. Stamps BOTH timestamps:
// - vehiclesTs: the per-field tiebreaker _mergeIncomingSettings uses to keep a
//   newer local fleet over an older incoming one.
// - settingsTs: the blob-level last-writer-wins stamp. Without it a fleet edit
//   looked "stale" to the save gate (cloud settingsTs newer → skip-settings) and
//   NEVER UPLOADED, the added vehicle lived only in this device's cache and
//   vanished on the next sign-out/fresh boot (the "Zach's Ford deletes itself" bug).
function _setVehicles(vehs){S.vehicles=vehs;S.vehiclesTs=Date.now();S.settingsTs=Date.now();}
function getVehicles(){
  let vehs=Array.isArray(S.vehicles)?S.vehicles:[];
  // Legacy one-time seed from the old single-vehicle string field `S.veh`.
  // Fire it ONLY when the fleet has NEVER been managed, i.e. no vehiclesTs
  // stamp. Every add/edit/delete stamps S.vehiclesTs (a plain settings save
  // does not), so once the user has touched the fleet, including DELETING
  // the last vehicle, this seed is permanently off and a removed vehicle can
  // never resurrect from S.veh (the "Zach Ford keeps coming back" bug).
  if(!vehs.length&&!S.vehiclesTs&&S.veh&&S.veh.trim()){vehs=[S.veh.trim()];}
  // Migrate legacy string array to object array
  return vehs.map(v=>typeof v==='string'?{name:v,nickname:''}:v);
}
function getVehicleLabel(v){
  if(!v)return '';
  if(typeof v==='string')return v;
  return (v.nickname&&v.nickname.trim())||v.name||'';
}
function getVehicleFullLabel(v){
  if(!v)return '';
  if(typeof v==='string')return v;
  const nick=v.nickname&&v.nickname.trim();
  return nick?nick+' ('+v.name+')':v.name||'';
}

// ══════════════════════════════════════════════════════════════════
// ANNUAL ODOMETER CHECK, IRS Publication 463 compliance
// Records Jan 1 start + Dec 31 end odometer per vehicle per year.
// Calculates true business-use % = logged miles / total miles driven.
// ══════════════════════════════════════════════════════════════════
function _checkOdometerPrompt(){
  const vehs=getVehicles();
  if(!vehs.length||_isEmployee||_devSupportMode)return;
  // Never slam this unsolicited compliance modal on top of a modal the user is
  // already filling out (quick-expense, agreement, contract, etc.): stacking a
  // fixed full-viewport overlay over an open form covers its inputs and blocks
  // the user mid-task. Defer: it re-fires on the next boot via cloud.js once the
  // open overlay is dismissed.
  if(document.querySelector('.zmodal-overlay,#_odo-modal-ov'))return;
  const cy=new Date().getFullYear();
  const mo=new Date().getMonth(); // 0=Jan
  const log=S.vehicleOdoLog||{};
  const snoozed=S._odoSnoozedUntil||0;
  if(Date.now()<snoozed)return;

  // Tasks needed:
  const tasks=[];
  // 1. Current year start, always check regardless of month (mid-year signups need this too)
  vehs.forEach(v=>{
    const key=_vehKey(v);
    if(!(log[cy]&&log[cy][key]&&log[cy][key].start)){
      // midYear=true when past April, modal shows "best estimate" language instead of "Jan 1"
      tasks.push({year:cy,type:'start',veh:v,midYear:mo>3});
    }
  });
  // 2. End of previous year, prompt Jan through Mar only (after that, prior year is filed)
  if(mo<=2){
    const ly=cy-1;
    vehs.forEach(v=>{
      const key=_vehKey(v);
      if(!(log[ly]&&log[ly][key]&&log[ly][key].end)){
        tasks.push({year:ly,type:'end',veh:v});
      }
    });
  }

  if(!tasks.length)return;

  // Count how many times snoozed, after 3 snoozes, hard block
  const snoozeCount=S._odoSnoozeCount||0;
  _showOdometerModal(tasks,snoozeCount>=3);
}

function _vehKey(v){return(typeof v==='string'?v:(v.name||'vehicle')).toLowerCase().replace(/\s+/g,'_');}

// Public entry point called from "Update readings" button and the mileage action card
function checkOdometerEntries(manual){
  if(_isEmployee||_devSupportMode)return;
  if(!manual){_checkOdometerPrompt();return;}
  // Manual: build tasks for current year (start + end) regardless of whether they exist, so user can correct values
  const vehs=getVehicles();
  if(!vehs.length)return;
  const cy=new Date().getFullYear();
  const mo=new Date().getMonth();
  const log=S.vehicleOdoLog||{};
  const tasks=[];
  vehs.forEach(v=>{
    const key=_vehKey(v);
    const rec=log[cy]?.[key]||{};
    tasks.push({year:cy,type:'start',veh:v,midYear:mo>3,manual:true});
    // Show year-end slot if past June or if a reading already exists to correct
    if(mo>=6||rec.end){tasks.push({year:cy,type:'end',veh:v,manual:true});}
  });
  // Jan–Mar: also allow correcting prior year's end
  if(mo<=2){
    const ly=cy-1;
    vehs.forEach(v=>{tasks.push({year:ly,type:'end',veh:v,manual:true});});
  }
  if(!tasks.length)return;
  _showOdometerModal(tasks,false);
}
window.checkOdometerEntries=checkOdometerEntries;

// ── Stripe Connect ─────────────────────────────────────────────────────────

function renderSettingsTrades(){
  const el=document.getElementById('set-trades-content');
  const sub=document.getElementById('set-idx-trades-sub');
  if(!el)return;
  const lines=_getTradeLines();
  if(sub)sub.textContent=lines.map(t=>TRADE_META[t]?.label||t).join(', ');
  const allTrades=Object.keys(TRADE_META);
  const available=allTrades.filter(t=>!lines.includes(t));
  el.innerHTML=
    (isLifetimeAccount()?'<div style="display:inline-flex;align-items:center;gap:6px;background:#D1FAE5;border:1px solid var(--green-mid);border-radius:20px;padding:5px 12px;font-size:12px;font-weight:700;color:var(--green-mid);margin-bottom:12px">⭐ Lifetime access, no subscription ever</div><br>':'')+
    '<div style="font-size:12px;color:var(--text2);margin-bottom:12px;line-height:1.5">Your active trade lines. Each gets its own proposal form and pipeline view.</div>'+
    '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px">'+
    lines.map(t=>{
      const m=TRADE_META[t]||{icon:'🔧',label:t};
      return '<div style="display:inline-flex;align-items:center;gap:5px;background:var(--blue-lt);border:1px solid var(--blue);border-radius:20px;padding:5px 10px 5px 10px;font-size:13px;font-weight:600;color:var(--blue-dk)">'+
        svgIcon(m.icon)+' '+m.label+
        (lines.length>1?'<button onclick="removeTradeFromSettings(\''+t+'\')" style="background:none;border:none;cursor:pointer;color:var(--blue-dk);font-size:15px;line-height:1;padding:0 0 0 4px;font-family:inherit;opacity:.6">×</button>':'')+
      '</div>';
    }).join('')+
    '</div>'+
    (available.length?
      '<div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:8px">Add a trade</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">'+
      available.map(t=>{const m=TRADE_META[t]||{icon:'🔧',label:t};return'<button onclick="addTradeFromSettings(\''+t+'\')" style="padding:10px 6px;border-radius:var(--r);border:1.5px solid var(--border2);background:var(--bg2);cursor:pointer;font-family:inherit;text-align:center;font-size:12px"><div style="font-size:18px;margin-bottom:2px">'+svgIcon(m.icon,{size:18})+'</div>'+m.label+'</button>';}).join('')+
      '</div>':
      '<div style="font-size:11px;color:var(--text3)">All trades active.</div>'
    );
}
async function addTradeFromSettings(trade){
  if(!_config?.account_id)return;
  const cur=_getTradeLines();
  const newLines=[...new Set([...cur,trade])];
  const lineStr=newLines.join(',');
  if(supaEnabled()){
    const{error}=await _supa.from('account_config').update({trade_lines:lineStr}).eq('account_id',_config.account_id);
    if(error){showToast('SQL migration needed, see notes','⚠️');console.error(error);return;}
  }
  _config={..._config,trade_lines:lineStr};
  renderSettingsTrades();_renderNavTradeSwitcher();_renderSettingsTradeSections();
  showToast('Added '+(TRADE_META[trade]?.label||trade),'✓');
}
async function removeTradeFromSettings(trade){
  if(!_config?.account_id)return;
  const cur=_getTradeLines();
  const newLines=cur.filter(t=>t!==trade);
  if(!newLines.length){showToast('Cannot remove your only trade','⚠️');return;}
  const lineStr=newLines.join(',');
  if(supaEnabled()){
    const{error}=await _supa.from('account_config').update({trade_lines:lineStr}).eq('account_id',_config.account_id);
    if(error){showToast('SQL migration needed, see notes','⚠️');console.error(error);return;}
  }
  _config={..._config,trade_lines:lineStr};
  if(_activeTrade===trade)_activeTrade=newLines[0];
  renderSettingsTrades();_renderNavTradeSwitcher();_renderSettingsTradeSections();
  showToast('Removed '+(TRADE_META[trade]?.label||trade),'✓');
}
function _renderSettingsTradeSections(){
  const trade=getActiveTrade();
  const lgTitle=document.getElementById('set-rates-lg-title');
  if(lgTitle){const meta=TRADE_META[trade]||{icon:'🔧',label:'Trade'};lgTitle.innerHTML=(svgIcon(meta.icon)+' '+meta.label+' Labor Rates').trim();}
}
function _renderDevTradeCard(){
  if(!_config?.is_dev)return;
  const current=_config?.business_type||'painting';
  const trades=[
    {id:'painting',icon:'🎨',label:'Painting'},
    {id:'plumbing',icon:'🔧',label:'Plumbing'},
    {id:'electrical',icon:'⚡',label:'Electrical'},
    {id:'hvac',icon:'❄️',label:'HVAC'},
    {id:'roofing',icon:'🏠',label:'Roofing'},
    {id:'landscaping',icon:'🌿',label:'Landscaping'},
    {id:'general',icon:'🔨',label:'General'},
    {id:'other',icon:'🛠',label:'Other'},
  ];
  const grid=document.getElementById('dev-trade-grid');
  if(!grid)return;
  grid.innerHTML=trades.map(t=>`<button onclick="devSwitchTrade('${t.id}')" style="padding:10px 6px;border-radius:var(--r);border:2px solid ${t.id===current?'var(--blue)':'var(--border2)'};background:${t.id===current?'var(--blue-lt)':'var(--bg2)'};cursor:pointer;font-family:inherit;text-align:center;font-size:12px;font-weight:${t.id===current?'700':'400'}"><div style="font-size:18px">${svgIcon(t.icon,{size:18})}</div>${t.label}</button>`).join('');
  const sup=document.getElementById('dev-support-section');
  if(sup)sup.innerHTML=`
<div style="padding-top:12px;border-top:1px solid var(--border2)">
  <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);margin-bottom:8px">Support View</div>
  <button onclick="_devLoadUserAccount('zach')" style="width:100%;padding:9px;border-radius:var(--r);border:1px solid var(--blue);background:var(--blue-lt);color:var(--blue-dk);font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">${svgIcon('👁',{size:13})} View Zach's account</button>

  ${_devSupportMode?`<div style="margin-top:8px;padding:8px 10px;background:var(--amber-lt);border-radius:var(--r);font-size:11px;color:#856404;display:flex;justify-content:space-between;align-items:center"><span>${svgIcon('👁',{size:11})} Viewing: ${escHtml(_devSupportName)}</span><button onclick="_devExitSupportMode()" style="font-size:10px;padding:3px 8px;border:1px solid #856404;border-radius:4px;background:none;color:#856404;cursor:pointer;font-family:inherit">Exit</button></div>`:''}
  ${_devRenderSnapshots('zach')}
</div>`;
  // Init legal inspector with current state and today's date
  const _lsEl=document.getElementById('dev-legal-state');
  const _ldEl=document.getElementById('dev-legal-date');
  if(_lsEl){_lsEl.value=S?.state||'KS';}
  if(_ldEl&&!_ldEl.value){_ldEl.value=new Date().toISOString().slice(0,10);}
  if(typeof renderLegalInspector==='function')renderLegalInspector();
}
async function devSwitchTrade(type){
  if(!_config?.is_dev||!_config?.account_id)return;
  const cfg=BUSINESS_CONFIGS[type]||BUSINESS_CONFIGS.other;
  _config={..._config,...cfg,business_type:type};
  await _supa.from('account_config').update({business_type:type}).eq('account_id',_config.account_id);
  _activeTrade=type;
  _renderDevTradeCard();_renderNavTradeSwitcher();_renderSettingsTradeSections();
  showToast('Trade switched to '+type,'🛠');
}

// ── Onboarding ────────────────────────────────────────────────────────
let _ob={step:1,name:'',email:'',password:'',businessType:'',tradeLines:[],businessName:'',phone:'',address:'',state:'',licenseInfo:'',role:'owner',vehicles:[],team:[],stripeKey:'',acceptCash:true,acceptCheck:true,allowPayLater:true,wantCards:true,jobs:[]};

async function showOnboarding(){
  _removeBootOverlay();
  const ov=document.createElement('div');
  ov.id='onboarding-overlay';
  ov.style.cssText='position:fixed;inset:0;z-index:9999;background:var(--bg);overflow-y:auto;padding:0';
  document.body.appendChild(ov);
  renderObStep();
}

// Brand-new social (Google/Apple) sign-in. The provider already created the auth
// user + a live session, so there is NO email/password to collect, that half of
// onboarding is already done. Drop them into the SAME wizard, prefilled from the
// provider and with the account-creation step slimmed down (business/trade/pay
// only). obSubmit sees _ob.oauth and writes the business against the existing
// session instead of calling signUp. Called from the boot / SIGNED_IN brand-new
// branches in cloud.js so a first-time social tap never lands on an empty dashboard.
function _beginOAuthOnboarding(){
  try{
    // Already onboarding? Don't restart (would wipe their in-progress answers). This
    // is the re-entry guard, NOT a sticky global flag: setting window._obInProgress
    // here and only clearing it in obSubmit meant an abandoned onboarding wedged the
    // flag true forever, blocking every future sign-in (the SIGNED_IN handler returns
    // early on _obInProgress). obSubmit owns _obInProgress during the actual write.
    if(typeof document!=='undefined'&&document.getElementById('onboarding-overlay'))return;
    _ob={step:1,name:'',email:'',password:'',businessType:'',tradeLines:[],businessName:'',phone:'',address:'',state:'',licenseInfo:'',role:'owner',vehicles:[],team:[],stripeKey:'',acceptCash:true,acceptCheck:true,allowPayLater:true,wantCards:true,jobs:[],oauth:true};
    if(typeof _supaUser!=='undefined'&&_supaUser){
      const m=_supaUser.user_metadata||{};
      _ob.name=m.full_name||m.name||m.given_name||'';
      _ob.email=_supaUser.email||'';
    }
    showOnboarding();
  }catch(_e){if(typeof console!=='undefined')console.warn('OAuth onboarding launch failed:',_e);}
}

function renderObStep(){
  const ov=document.getElementById('onboarding-overlay');if(!ov)return;
  // 3-step wizard (§9.9 restructure). Everything else, logo, vehicles, team,
  // booked jobs, license/warranty: moved to the dashboard setup checklist.
  const steps=[
    {icon:'👤',title:'Your account',sub:'Email, password & business'},
    {icon:'🎨',title:'Your trade',sub:'We configure your workflow'},
    {icon:'💳',title:'Get paid',sub:'How you collect money'},
  ];
  const pct=Math.round((_ob.step/steps.length)*100);
  const cur=steps[_ob.step-1];

  ov.innerHTML=
    '<div style="display:flex;min-height:100vh;min-height:100dvh">'+
    // Left panel, brand + step context
    '<div id="ob-left" style="width:340px;flex-shrink:0;background:#0D1117;padding:40px 32px;flex-direction:column;justify-content:space-between" id="ob-left">'+
      '<div>'+
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:48px">'+
          '<div style="width:36px;height:36px;background:rgba(255,255,255,.15);border-radius:9px;display:flex;align-items:center;justify-content:center">'+
            '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" stroke-width="2.5"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>'+
          '</div>'+
          '<span class="brand-logo-slot" style="font-size:18px;font-weight:800;color:#fff;letter-spacing:-.02em">TradeDesk</span>'+
        '</div>'+
        // Step list
        '<div style="display:flex;flex-direction:column;gap:4px">'+
        steps.map((s,i)=>{
          const done=i+1<_ob.step;
          const active=i+1===_ob.step;
          return '<div style="display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:10px;background:'+(active?'rgba(255,255,255,.15)':done?'rgba(255,255,255,.06)':'transparent')+';transition:background .2s">'+
            '<div style="width:28px;height:28px;border-radius:50%;background:'+(done?'#63B841':active?'#fff':'rgba(255,255,255,.2)')+';display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:'+(done?'13':'14')+'px;font-weight:700;color:'+(done?'#fff':active?'var(--blue)':'rgba(255,255,255,.5)')+'">'+
              (done?svgIcon('✓',{size:14}):''+(i+1))+
            '</div>'+
            '<div>'+
              '<div style="font-size:13px;font-weight:'+(active?'700':'600')+';color:'+(active||done?'#fff':'rgba(255,255,255,.5)')+'">'+s.title+'</div>'+
              (active?'<div style="font-size:11px;color:rgba(255,255,255,.65);margin-top:1px">'+s.sub+'</div>':'')+
            '</div>'+
          '</div>';
        }).join('')+
        '</div>'+
      '</div>'+
      '<div style="font-size:11px;color:rgba(255,255,255,.4)">© 2025 TradeDesk</div>'+
    '</div>'+
    // Right panel, form content
    '<div style="flex:1;display:flex;flex-direction:column;background:#fff;min-height:100%;overflow-y:auto">'+
      // Mobile header
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border)" id="ob-mobile-hdr">'+
        '<div style="display:flex;align-items:center;gap:8px">'+
          '<div style="width:28px;height:28px;background:var(--blue);border-radius:7px;display:flex;align-items:center;justify-content:center">'+
            '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#fff" stroke-width="2.5"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>'+
          '</div>'+
          '<span class="brand-logo-slot" style="font-size:15px;font-weight:800;color:var(--text)">TradeDesk</span>'+
        '</div>'+
        '<span style="font-size:12px;color:var(--text3);font-weight:600">'+_ob.step+' of '+steps.length+'</span>'+
      '</div>'+
      // Progress bar
      '<div style="height:3px;background:var(--border)"><div style="height:100%;width:'+pct+'%;background:var(--blue);transition:width .4s ease"></div></div>'+
      // Step content
      '<div style="flex:1;padding:32px 28px;max-width:520px;width:100%;margin:0 auto;box-sizing:border-box" id="ob-body"></div>'+
    '</div>'+
    '</div>';

  // Left panel visible on wider screens, hidden on mobile
  const left=document.getElementById('ob-left');
  if(left)left.style.display=window.innerWidth>=640?'flex':'none';

  const body=document.getElementById('ob-body');
  if(_ob.step===1)obStepAccount(body);
  else if(_ob.step===2)obStep3(body);   // trade
  else if(_ob.step===3)obStep8(body);   // get paid
}

function obBtn(label,onclick,secondary){
  return '<button onclick="'+onclick+'" style="width:100%;padding:13px 18px;border-radius:9px;border:'+(secondary?'1.5px solid #e0dfd8':'none')+';background:'+(secondary?'#fff':'#0D1117')+';color:'+(secondary?'#5f5e5a':'#fff')+';font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;margin-top:8px;letter-spacing:-.01em;box-shadow:'+(secondary?'none':'0 2px 8px rgba(0,0,0,.15)')+';transition:opacity .15s" onmousedown="this.style.opacity=\'.85\'" onmouseup="this.style.opacity=\'1\'">'+label+'</button>';
}
function obInput(id,label,placeholder,type,value){
  return '<div style="margin-bottom:18px">'+
    '<label style="display:block;font-size:12px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">'+label+'</label>'+
    '<input type="'+(type||'text')+'" id="'+id+'" placeholder="'+placeholder+'" value="'+escHtml(value||'')+'" style="font-size:15px;padding:11px 14px;border-radius:9px;border:1.5px solid var(--border2);background:var(--bg2);color:var(--text);width:100%;box-sizing:border-box;outline:none;transition:border-color .15s;font-family:inherit" onfocus="this.style.borderColor=\'var(--blue)\'" onblur="this.style.borderColor=\'var(--border2)\'">'+
  '</div>';
}

// Step 1 (§9.9 restructure): account + core business in one screen. Everything a
// contractor knows off the top of their head, email, password, business name,
// phone, state, so a branded proposal can go out the moment they're in. Social
// sign-in on top collapses this to near-nothing (name/email come from the provider).
const OB_STATE_OPTS=['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];
function obStepAccount(el){
  // OAuth mode: the provider already handled sign-in, so no social buttons, no
  // email, no password, just their name (prefilled) + business details.
  const oauth=!!_ob.oauth;
  const _stateOpts='<option value="">- Select your state -</option>'+OB_STATE_OPTS.map(s=>'<option value="'+s+'"'+(_ob.state===s?' selected':'')+'>'+s+'</option>').join('');
  const _socialBtn=(prov,label,bg,fg,bd)=>'<button onclick="_obOAuth(\''+prov+'\')" style="display:flex;align-items:center;justify-content:center;gap:9px;width:100%;padding:12px;border-radius:9px;border:'+bd+';background:'+bg+';color:'+fg+';font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;margin-bottom:10px">'+label+'</button>';
  el.innerHTML=
    (oauth
      ?'<div style="margin-bottom:20px"><div style="font-size:28px;margin-bottom:10px">'+svgIcon('👤',{size:28})+'</div><div style="font-size:22px;font-weight:800;letter-spacing:-.02em;margin-bottom:4px">Finish setting up</div><div style="font-size:14px;color:var(--text3)">You\'re signed in'+(_ob.email?' as '+escHtml(_ob.email):'')+'. Just your business details and you\'re in.</div></div>'
      :'<div style="margin-bottom:20px"><div style="font-size:28px;margin-bottom:10px">'+svgIcon('👤',{size:28})+'</div><div style="font-size:22px;font-weight:800;letter-spacing:-.02em;margin-bottom:4px">Create your account</div><div style="font-size:14px;color:var(--text3)">Takes about a minute, you can add the rest later.</div></div>'+
        // Social sign-in (primary). Activates once the provider is configured in Supabase.
        _socialBtn('google','Continue with Google','#fff','#1f2328','1.5px solid #dadce0')+
        _socialBtn('apple','Continue with Apple','#000','#fff','1.5px solid #000')+
        '<div style="display:flex;align-items:center;gap:10px;margin:14px 0 16px"><div style="flex:1;height:1px;background:var(--border)"></div><span style="font-size:11px;color:var(--text3);font-weight:600">or sign up with email</span><div style="flex:1;height:1px;background:var(--border)"></div></div>')+
    obInput('ob-name','Your full name','John Smith','text',_ob.name)+
    (oauth?'':obInput('ob-email','Email','you@yourbusiness.com','email',_ob.email)+
    obInput('ob-pass','Password (min 6 chars)','••••••••','password',''))+
    obInput('ob-bname','Business name','Smith Painting Co','text',_ob.businessName)+
    '<div class="f" style="margin-bottom:18px"><label style="display:block;font-size:12px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Phone</label>'+
    '<input type="tel" id="ob-bphone" placeholder="316-555-0100" value="'+((_ob.phone)||'')+'" maxlength="12" oninput="this.value=this.value.replace(/[^0-9]/g,\'\').slice(0,10).replace(/^(\\d{3})(\\d{3})(\\d{1,4})$/,\'$1-$2-$3\').replace(/^(\\d{3})(\\d{1,3})$/,\'$1-$2\')" style="font-size:15px;padding:11px 14px;border-radius:9px;border:1.5px solid var(--border2);background:var(--bg2);color:var(--text);width:100%;box-sizing:border-box;font-family:inherit"></div>'+
    '<div class="f" style="margin-bottom:18px"><label style="display:block;font-size:12px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">State</label>'+
    '<select id="ob-state" style="font-size:15px;padding:11px 14px;border-radius:9px;border:1.5px solid var(--border2);background:var(--bg2);color:var(--text);width:100%;box-sizing:border-box">'+_stateOpts+'</select></div>'+
    '<div id="ob-err" style="color:#A32D2D;font-size:12px;min-height:16px;margin-bottom:8px"></div>'+
    '<div style="font-size:11px;color:var(--text3);line-height:1.6;margin-bottom:12px">By continuing you agree to our <a href="#" onclick="_obShowTos(event)" style="color:var(--blue);text-decoration:underline">Terms of Service</a>, a summary of what TradeDesk is and isn\'t (not tax, legal, or financial advice).</div>'+
    obBtn('Continue','obNextAccount()');
}
function _obShowTos(e){if(e)e.preventDefault();if(typeof zAlert==='function')zAlert('TradeDesk is an organizational tool for running your trade business, proposals, jobs, payments, mileage, and tax summaries. It is NOT tax, legal, or financial advice: consult a qualified professional for those. You are responsible for authorization to store client data. Data is stored securely via Supabase; keep your own backups of critical records. Provided "as is" with no warranty.',{title:'Terms of Service'});}
function _obOAuth(provider){
  try{
    if(typeof _supa==='undefined'||!_supa||!_supa.auth||!_supa.auth.signInWithOAuth){if(typeof showToast==='function')showToast(provider.charAt(0).toUpperCase()+provider.slice(1)+' sign-in isn\'t available yet','⚠️');return;}
    // Mark this as an OAuth round-trip. The client is built detectSessionInUrl:false
    // (so recovery / magic links aren't auto-consumed), so supaInit() completes the
    // handshake by hand ONLY when this flag is set, never for a stray ?code=. Cleared
    // on return or on error below.
    try{localStorage.setItem('_oauthPending',provider);}catch(_e){}
    _supa.auth.signInWithOAuth({provider,options:{redirectTo:location.origin}}).then(({error})=>{
      if(error){try{localStorage.removeItem('_oauthPending');}catch(_e){}if(typeof showToast==='function')showToast(provider.charAt(0).toUpperCase()+provider.slice(1)+' sign-in isn\'t turned on yet, use email for now','⚠️',5000);}
    }).catch(()=>{try{localStorage.removeItem('_oauthPending');}catch(_e){}});
  }catch(_e){try{localStorage.removeItem('_oauthPending');}catch(_e2){}if(typeof showToast==='function')showToast('Sign-in unavailable, use email for now','⚠️');}
}
function obNextAccount(){
  const oauth=!!_ob.oauth;
  const err=document.getElementById('ob-err');
  const name=document.getElementById('ob-name')?.value.trim();
  const email=document.getElementById('ob-email')?.value.trim();
  const pass=document.getElementById('ob-pass')?.value;
  const bname=document.getElementById('ob-bname')?.value.trim();
  const phone=document.getElementById('ob-bphone')?.value.trim();
  const state=document.getElementById('ob-state')?.value||'';
  if(!name){if(err)err.textContent='Enter your name.';return;}
  // Email + password only exist (and are only required) on the email signup path.
  // OAuth users are already authenticated, those fields aren't on the screen.
  if(!oauth){
    if(!email||!email.includes('@')){if(err)err.textContent='Enter a valid email.';return;}
    if(!pass||pass.length<6){if(err)err.textContent='Password must be at least 6 characters.';return;}
  }
  if(!bname){if(err)err.textContent='Enter your business name.';return;}
  if(!phone){if(err)err.textContent='Enter a phone number.';return;}
  if(!state){if(err)err.textContent='Select your state.';return;}
  _ob.name=name;if(!oauth){_ob.email=email;_ob.password=pass;}_ob.businessName=bname;_ob.phone=phone;_ob.state=state;
  // Prefill sales tax from state base, contractor refines later.
  if(state&&typeof lookupSalesTaxRate==='function'&&!(parseFloat(S.salesTaxRate)>0)){
    lookupSalesTaxRate('',state).then(r=>{if(r.rate>0){S.salesTaxRate=r.rate;S.salesTaxRateSource='onboarding';}}).catch(()=>{});
  }
  _ob.step=2;renderObStep();
}

function obStep3(el){
  const types=[
    {id:'painting',icon:'🎨',label:'Painting'},
    {id:'roofing',icon:'🏠',label:'Roofing'},
    {id:'plumbing',icon:'🔧',label:'Plumbing'},
    {id:'electrical',icon:'⚡',label:'Electrical'},
    {id:'hvac',icon:'❄️',label:'HVAC'},
    {id:'landscaping',icon:'🌿',label:'Landscaping'},
    {id:'general',icon:'🔨',label:'General Contractor'},
    {id:'other',icon:'🛠️',label:'Other'},
  ];
  el.innerHTML=
    '<div style="margin-bottom:24px"><div style="font-size:28px;margin-bottom:10px">'+svgIcon('🔧',{size:28})+'</div><div style="font-size:22px;font-weight:800;letter-spacing:-.02em;margin-bottom:4px">What trades do you work?</div><div style="font-size:14px;color:var(--text3)">Select all that apply, tap to toggle. First selected = primary trade.</div></div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px">'+
    types.map(t=>{
      const sel=_ob.tradeLines.includes(t.id);
      const isPrimary=_ob.tradeLines[0]===t.id;
      return '<button onclick="obSelectType(\''+t.id+'\')" id="obtype-'+t.id+'" style="padding:16px 12px;border-radius:var(--r);border:2px solid '+(sel?'var(--blue)':'var(--border2)')+';background:'+(sel?'var(--blue-lt)':'var(--bg2)')+';cursor:pointer;font-family:inherit;text-align:center;position:relative">'+
        (isPrimary?'<div style="position:absolute;top:6px;right:6px;background:var(--blue);color:#fff;font-size:9px;font-weight:700;border-radius:3px;padding:1px 4px">PRIMARY</div>':'')+
        (sel&&!isPrimary?'<div style="position:absolute;top:6px;right:6px;font-size:14px">'+svgIcon('✓',{size:14})+'</div>':'')+
        '<div style="font-size:24px;margin-bottom:4px">'+svgIcon(t.icon,{size:24})+'</div>'+
        '<div style="font-size:13px;font-weight:700;color:var(--text)">'+t.label+'</div>'+
      '</button>';
    }).join('')+
    '</div>'+
    '<div id="ob-err" style="color:#A32D2D;font-size:12px;min-height:16px;margin-bottom:8px"></div>'+
    obBtn('Continue','obNext3()')+
    obBtn('Back','_ob.step=1;renderObStep()',true);
}

function obSelectType(t){
  const idx=_ob.tradeLines.indexOf(t);
  if(idx===-1){
    _ob.tradeLines.push(t);
  } else {
    _ob.tradeLines.splice(idx,1);
  }
  _ob.businessType=_ob.tradeLines[0]||'';
  // Re-render just the grid buttons
  const types=['painting','roofing','plumbing','electrical','hvac','landscaping','general','other'];
  types.forEach(id=>{
    const btn=document.getElementById('obtype-'+id);
    if(!btn)return;
    const sel=_ob.tradeLines.includes(id);
    const isPrimary=_ob.tradeLines[0]===id;
    btn.style.borderColor=sel?'var(--blue)':'var(--border2)';
    btn.style.background=sel?'var(--blue-lt)':'var(--bg2)';
    // Update badge
    let badge=btn.querySelector('.ob-primary-badge');
    let check=btn.querySelector('.ob-check-badge');
    if(isPrimary){
      if(!badge){badge=document.createElement('div');badge.className='ob-primary-badge';badge.style.cssText='position:absolute;top:6px;right:6px;background:var(--blue);color:#fff;font-size:9px;font-weight:700;border-radius:3px;padding:1px 4px';btn.appendChild(badge);}
      badge.textContent='PRIMARY';
      if(check)check.remove();
    } else if(sel){
      if(badge)badge.remove();
      if(!check){check=document.createElement('div');check.className='ob-check-badge';check.style.cssText='position:absolute;top:6px;right:6px;font-size:14px';btn.appendChild(check);}
      check.innerHTML=svgIcon('✓',{size:14});
    } else {
      if(badge)badge.remove();
      if(check)check.remove();
    }
  });
}

function obNext3(){
  const err=document.getElementById('ob-err');
  if(!_ob.tradeLines.length){if(err)err.textContent='Select at least one trade.';return;}
  _ob.businessType=_ob.tradeLines[0];
  _ob.step=3;renderObStep();
}

function obPayRow(key,label,desc){
  const on=_ob[key]!==false;
  return '<label style="display:flex;align-items:flex-start;gap:12px;padding:14px;border:1.5px solid '+(on?'var(--blue)':'var(--border2)')+';border-radius:var(--r);background:'+(on?'var(--blue-lt)':'var(--bg2)')+';cursor:pointer;user-select:none;margin-bottom:10px;transition:border-color .15s,background .15s" id="obpay-'+key+'">'+
    '<input type="checkbox" '+(on?'checked':'')+' onchange="obTogglePay(\''+key+'\',this.checked)" style="width:19px;height:19px;margin-top:1px;accent-color:var(--blue);flex-shrink:0">'+
    '<div><div style="font-size:14px;font-weight:700;color:var(--text)">'+label+'</div>'+
    '<div style="font-size:12px;color:var(--text3);margin-top:2px;line-height:1.5">'+desc+'</div></div>'+
  '</label>';
}
function obTogglePay(key,on){
  _ob[key]=!!on;
  const row=document.getElementById('obpay-'+key);
  if(!row)return;
  // The "take cards" card is green; the cash/check/later rows are blue.
  if(key==='wantCards'){row.style.borderColor=on?'#86efac':'var(--border2)';}
  else{row.style.borderColor=on?'var(--blue)':'var(--border2)';row.style.background=on?'var(--blue-lt)':'var(--bg2)';}
}
function obStep8(el){
  el.innerHTML=
    '<div style="margin-bottom:24px"><div style="font-size:28px;margin-bottom:10px">'+svgIcon('💳',{size:28})+'</div>'+
    '<div style="font-size:22px;font-weight:800;letter-spacing:-.02em;margin-bottom:4px">How do you want to get paid?</div>'+
    '<div style="font-size:14px;color:var(--text3)">Turn on the ways you accept payment. Clients only see the options you enable when they sign, change any of this later in Settings.</div></div>'+
    obPayRow('acceptCash','Cash','Client can tell you they\'ll pay cash in person.')+
    obPayRow('acceptCheck','Check','Client can tell you they\'ll pay by check.')+
    obPayRow('allowPayLater','Pay later','Client signs now and settles up any way that works before the job\'s done, no money due at signing.')+
    '<div style="border-top:1px solid var(--border);margin:20px 0 16px"></div>'+
    '<label id="obpay-wantCards" style="display:flex;align-items:flex-start;gap:12px;padding:14px;border:1.5px solid '+(_ob.wantCards!==false?'#86efac':'var(--border2)')+';border-radius:var(--r);background:#f0fdf4;margin-bottom:8px;cursor:pointer;user-select:none">'+
      '<input type="checkbox" '+(_ob.wantCards!==false?'checked':'')+' onchange="obTogglePay(\'wantCards\',this.checked)" style="width:19px;height:19px;margin-top:1px;accent-color:#16a34a;flex-shrink:0">'+
      '<div><div style="font-size:14px;font-weight:700;color:#166534">Take cards & bank transfers</div>'+
      '<div style="font-size:12px;color:#166534;margin-top:2px;line-height:1.6">Clients pay their deposit straight to your bank. Card fee 2.9% + $0.30, auto-logged as a deductible expense. Leave this on and <strong>Turn on card payments</strong> will be waiting on your dashboard, connect Stripe in ~2 min whenever you\'ve got your EIN and bank info handy. Cash & check work right now without it.</div></div>'+
    '</label>'+
    '<div id="ob-err" style="color:#A32D2D;font-size:12px;min-height:16px;margin-bottom:8px"></div>'+
    '<div id="ob-progress" style="display:none;font-size:12px;color:var(--text3);text-align:center;margin-bottom:8px"></div>'+
    obBtn('Create my account','obSubmit()')+
    obBtn('Back','_ob.step=2;renderObStep()',true);
}

async function obSubmit(){
  const err=document.getElementById('ob-err');
  const prog=document.getElementById('ob-progress');
  if(err)err.textContent='';
  function setProgress(msg){if(prog){prog.style.display='';prog.textContent=msg;}}
  window._obInProgress=true;
  try{
    let uid;
    if(_ob.oauth&&typeof _supaUser!=='undefined'&&_supaUser&&_supaUser.id){
      // Social sign-in already created the auth user AND a live session (RLS works),
      // so there is nothing to signUp/signInWithPassword. Use the session we have and
      // pull the email from the provider (there was no email field on the screen).
      uid=_supaUser.id;
      _ob.email=_supaUser.email||_ob.email||'';
      setProgress('Setting up your business...');
    } else {
      setProgress('Creating your account...');
      const{data:authData,error:authErr}=await _supa.auth.signUp({email:_ob.email,password:_ob.password});
      if(authErr){
        if(authErr.message?.toLowerCase().includes('already registered')||authErr.status===422){
          document.getElementById('onboarding-overlay')?.remove();
          supaShowLogin();
          setTimeout(()=>{const el=document.getElementById('supa-login-err');if(el){el.textContent='Account already exists, sign in below.';el.style.color='var(--blue)';}},150);
          return;
        }
        throw authErr;
      }
      // Sign in immediately to get a live session so RLS works for inserts
      const{data:signInData,error:signInErr}=await _supa.auth.signInWithPassword({email:_ob.email,password:_ob.password});
      if(signInErr)throw new Error('Account created, please sign in to continue.');
      uid=signInData.user?.id;
      if(!uid)throw new Error('Could not get user ID');
      _supaUser=signInData.user;
    }

    setProgress('Setting up your business...');
    const{data:acct,error:acctErr}=await _supa.from('accounts').insert({
      business_name:_ob.businessName,phone:_ob.phone,email:_ob.email,
      address:_ob.address,license_info:_ob.licenseInfo,owner_id:uid,state:_ob.state
    }).select().maybeSingle();
    if(acctErr)throw acctErr;
    _account=acct;

    setProgress('Creating your profile...');
    await _supa.from('users').insert({id:uid,email:_ob.email,name:_ob.name,role:_ob.role,account_id:acct.id,business_type:_ob.businessType});
    await _supa.from('account_users').insert({account_id:acct.id,user_id:uid,role:_ob.role});

    setProgress('Adding vehicles...');
    if(_ob.vehicles.length){
      await _supa.from('vehicles').insert(_ob.vehicles.map(v=>({account_id:acct.id,name:v.name,type:v.type,vin:v.vin||null})));
    }

    setProgress('Configuring your workflow...');
    const _obTradeLines=_ob.tradeLines.length>1?_ob.tradeLines.join(','):null;
    const cfg={...BUSINESS_CONFIGS[_ob.businessType]||BUSINESS_CONFIGS.other,account_id:acct.id,business_type:_ob.businessType,state:_ob.state,...(_obTradeLines?{trade_lines:_obTradeLines}:{})};
    const{data:cfgData}=await _supa.from('account_config').insert(cfg).select().maybeSingle();
    _config=cfgData;

    await _supa.from('zj_data').insert({user_id:uid,account_id:acct.id});

    S.bname=_ob.businessName;S.bphone=_ob.phone;S.blic=_ob.licenseInfo;S.state=_ob.state||'KS';S.warrantyPeriod=_ob.warrantyPeriod||'1 year';
    // Payment methods the contractor chose on the "How do you want to get paid?"
    // step. Stored as explicit booleans so an unchecked box is a real false, not
    // an undefined that the default-true reader would flip back on.
    S.acceptCash=_ob.acceptCash!==false;S.acceptCheck=_ob.acceptCheck!==false;S.allowPayLater=_ob.allowPayLater!==false;
    S.wantCards=_ob.wantCards!==false; // intent to take cards, nudged via the dashboard checklist, not auto-launched
    // Arrived via a sub-invite referral link? Record who brought them in, then
    // redeem the grant (single-use RPC): the inviter lands as this brand-new
    // account's first client/lead, and everything the inviter logged as paid
    // to them becomes the opening income ledger, books start ready.
    if(typeof _claimSubReferralAttribution==='function')_claimSubReferralAttribution();
    if(typeof _redeemSubInviteGrant==='function'){
      setProgress('Loading your books...');
      try{await _redeemSubInviteGrant();}catch(_e){}
    }
    S.settingsTs=Date.now(); // onboarding-entered business info must win the settings sync
    _user={id:uid,email:_ob.email,name:_ob.name,role:_ob.role,account_id:acct.id};setOwnerName(_ob.name);saveAll();
    _vehicles=_ob.vehicles;
    // Import booked jobs (owner 2026-07-14): each filled row becomes a lead
    // (client) with a bid-less job attached, so the calendar is populated on
    // arrival. Pushed to the local arrays; the saveAll() below rides them up via
    // supaSaveDebounced(): the same sync path every client/job uses. Rows
    // without a client name were already flagged in obNextJobs, so skip them here.
    if(Array.isArray(_ob.jobs)&&_ob.jobs.length){
      setProgress('Adding your booked jobs...');
      _ob.jobs.forEach((j,i)=>{
        const cname=(j.client||'').trim();if(!cname)return;
        const cid=Date.now()+i*2;
        const jStart=(j.start||todayKey());
        const jVal=parseFloat(j.value)||0;
        clients.push({id:cid,name:cname,phone:'',email:'',addr:(j.addr||'').trim(),street:'',city:'',state:'',zip:'',
          ptype:'Single family home',source:'Existing customer',ref:'',notes:'Imported at onboarding',created:todayKey(),
          extraAddresses:[],clientToken:'',clientHubKey:''});
        jobs.push({id:cid+1,bid_id:null,client_id:cid,name:cname,addr:(j.addr||'').trim(),start:jStart,days:1,buffer:0,
          value:jVal,color:'#185FA5',eventType:'job',allowWeekend:true,time:null,hours:null,notes:'',status:'upcoming'});
      });
      saveAll();
    }

    setProgress('All done! Loading TradeDesk...');
    await new Promise(r=>setTimeout(r,600));
    document.getElementById('onboarding-overlay')?.remove();
    window._obInProgress=false;
    saveAll();applyPermissions();renderDash();goPg('pg-dash');
    // No Stripe auto-redirect (owner 2026-07-15): yanking a new contractor into an
    // EIN/bank form the instant they sign up is the exact high-friction moment we
    // defer everywhere else. Card setup lives ONLY on the dashboard checklist
    // ("Turn on card payments"), so they connect Stripe when they're ready. Their
    // intent is saved (S.wantCards) so we can nudge later; cash/check work now.
  }catch(e){
    window._obInProgress=false;
    console.error('Onboarding failed:',e);
    if(err)err.textContent=e.message||'Something went wrong. Try again.';
    if(prog)prog.style.display='none';
  }
}

function getDashGreeting(){
  const hr=new Date().getHours();
  const time=hr<12?'Good Morning':hr<17?'Good Afternoon':'Good Evening';
  const name=getUserName()||'';
  return name?time+', '+name.split(' ')[0]+'!':time+'!';
}


// ── Global search ────────────────────────────────────────────────────
function openSearch(){
  if(document.getElementById('global-search-overlay'))return;
  const ov=document.createElement('div');
  ov.id='global-search-overlay';
  ov.className='search-overlay';
  ov.onclick=e=>{if(e.target===ov)closeSearch();};
  ov.innerHTML=
    '<div class="search-box">'+
      '<div class="search-input-wrap">'+
        '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>'+
        '<input id="global-search-input" placeholder="Search clients, proposals, expenses, jobs…" autocomplete="off" oninput="runSearch(this.value)">'+
        '<button onclick="closeSearch()" style="background:none;border:none;cursor:pointer;color:var(--text3);font-size:20px;padding:0;line-height:1">×</button>'+
      '</div>'+
      '<div class="search-results" id="search-results"><div class="search-empty">Start typing to search...</div></div>'+
    '</div>';
  document.body.appendChild(ov);
  setTimeout(()=>document.getElementById('global-search-input')?.focus(),100);
  document.addEventListener('keydown',searchEsc);
}
function searchEsc(e){if(e.key==='Escape')closeSearch();}
function closeSearch(){document.getElementById('global-search-overlay')?.remove();document.removeEventListener('keydown',searchEsc);}

function runSearch(q){
  const el=document.getElementById('search-results');if(!el)return;
  q=(q||'').toLowerCase().trim();
  if(!q){el.innerHTML='<div class="search-empty">Start typing to search...</div>';return;}
  const results=[];

  // Clients
  (clients||[]).forEach(c=>{
    if([c.name,c.addr,c.phone,c.email].some(f=>f?.toLowerCase().includes(q))){
      const st=getClientStage(c.id);
      results.push({type:'client',icon:'👤',bg:'var(--blue-lt)',name:c.name,meta:c.addr?.split(',')[0]||c.phone||'',sub:st.label,action:()=>{closeSearch();openClientDetail(c.id);}});
    }
  });

  // Bids
  (bids||[]).forEach(b=>{
    if([b.client_name,b.name,b.notes,b.addr,b.type].some(f=>f?.toLowerCase().includes(q))){
      results.push({type:'bid',icon:'📋',bg:'var(--amber-lt)',name:b.client_name||b.name,meta:'Proposal · '+fmt(b.amount||0),sub:b.status||'Pending',action:()=>{closeSearch();goPg('pg-leads');}});
    }
  });

  // Expenses: the main event for "Sherwin Williams" etc.
  (expenses||[]).forEach(e=>{
    if([e.vendor,e.notes,e.catLabel,e.job_name].some(f=>f?.toLowerCase().includes(q))){
      const dateStr=e.date?fmtDateShort(e.date):'';
      results.push({type:'expense',icon:'🧾',bg:'#FEF2F2',name:e.vendor||'Expense',meta:fmt(e.amount||0)+(dateStr?' · '+dateStr:''),sub:e.catLabel||e.cat||'',action:()=>{closeSearch();goPg('pg-tracker');setTimeout(()=>{const b=document.getElementById('tr-t-expenses');if(b)b.click();},200);}});
    }
  });

  // Jobs
  (jobs||[]).filter(j=>j.eventType!=='task').forEach(j=>{
    if([j.name,j.addr,j.notes].some(f=>f?.toLowerCase().includes(q))){
      const dateStr=j.start?new Date(j.start+'T12:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}):'';
      results.push({type:'job',icon:'🔨',bg:'var(--green-lt)',name:j.name,meta:fmt(j.value||0)+(dateStr?' · '+dateStr:''),sub:j.status||'',action:()=>{closeSearch();goPg('pg-jobs');}});
    }
  });

  // Mileage
  (mileage||[]).forEach(m=>{
    if([m.purpose,m.client_name,m.to,m.from,m.to_name].some(f=>f?.toLowerCase().includes(q))){
      const dateStr=m.date?fmtDateShort(m.date):'';
      results.push({type:'mileage',icon:'🚗',bg:'var(--bg2)',name:m.purpose||m.client_name||'Trip',meta:(m.miles||0).toFixed(1)+' mi'+(dateStr?' · '+dateStr:''),sub:m.client_name||'',action:()=>{closeSearch();goPg('pg-tracker');setTimeout(()=>{const b=document.getElementById('tr-t-mileage');if(b)b.click();},200);}});
    }
  });

  // Income + payments
  [...(income||[]),...(payments||[])].forEach(r=>{
    if([r.client_name,r.type,r.notes,r.method].some(f=>f?.toLowerCase().includes(q))){
      const dateStr=r.date?fmtDateShort(r.date):'';
      results.push({type:'income',icon:'💰',bg:'var(--green-lt)',name:r.client_name||'Payment',meta:fmt(r.amount||0)+(dateStr?' · '+dateStr:''),sub:r.type||r.method||'',action:()=>{closeSearch();goPg('pg-tracker');setTimeout(()=>{const b=document.getElementById('tr-t-income');if(b)b.click();},200);}});
    }
  });

  // Amount search across bids and expenses
  if(/^\$?[\d,.]+$/.test(q.replace(/\s/g,''))){
    const amt=parseFloat(q.replace(/[$,]/g,''));
    (expenses||[]).filter(e=>Math.abs((e.amount||0)-amt)<1&&!results.find(r=>r.type==='expense'&&r.name===(e.vendor||'')&&r.meta.startsWith(fmt(e.amount)))).forEach(e=>{
      results.push({type:'expense',icon:'🧾',bg:'#FEF2F2',name:e.vendor||'Expense',meta:fmt(e.amount)+(e.date?' · '+fmtDateShort(e.date):''),sub:e.catLabel||'',action:()=>{closeSearch();goPg('pg-tracker');setTimeout(()=>{const b=document.getElementById('tr-t-expenses');if(b)b.click();},200);}});
    });
  }

  if(!results.length){el.innerHTML='<div class="search-empty">No results for "'+escHtml(q.slice(0,30))+'"</div>';return;}

  // Group by type with section headers
  const TYPE_ORDER=['client','bid','expense','job','income','mileage'];
  const TYPE_LABEL={client:'Clients',bid:'Proposals',expense:'Expenses',job:'Jobs',income:'Payments',mileage:'Mileage'};
  const MAX_PER=10;
  const byType={};
  results.forEach(r=>{(byType[r.type]=byType[r.type]||[]).push(r);});
  window._searchResults=[];
  let html='',flatIdx=0;
  TYPE_ORDER.filter(t=>byType[t]).forEach(t=>{
    const grp=byType[t];
    html+=`<div style="font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);padding:8px 18px 4px;background:var(--bg2)">${TYPE_LABEL[t]} (${grp.length})</div>`;
    grp.slice(0,MAX_PER).forEach(r=>{
      window._searchResults.push(r);
      html+=`<div class="search-result-item" onclick="_searchResults[${flatIdx}].action()">
        <div class="search-result-icon" style="background:${r.bg}">${svgIcon(r.icon)}</div>
        <div style="min-width:0;flex:1">
          <div class="search-result-name">${escHtml(r.name||'')}</div>
          <div class="search-result-meta">${escHtml(r.meta||'')}${r.sub?' · '+escHtml(r.sub):''}</div>
        </div>
      </div>`;
      flatIdx++;
    });
    if(grp.length>MAX_PER)html+=`<div style="font-size:11px;color:var(--text3);padding:5px 18px 8px;font-style:italic">…and ${grp.length-MAX_PER} more</div>`;
  });
  el.innerHTML=html;
}

