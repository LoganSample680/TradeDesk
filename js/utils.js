const fmt=n=>'$'+(isNaN(+n)?0:+n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtShort=n=>{const v=Number(n||0);if(Math.abs(v)>=1000000)return'$'+(v/1000000).toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:1})+'M';if(Math.abs(v)>=1000)return'$'+(v/1000).toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:1})+'K';return'$'+v.toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0});};
function formatPhoneDisplay(val){
  let d=(val||'').replace(/\D/g,'').slice(0,10);
  if(d.length>=7)return d.slice(0,3)+'-'+d.slice(3,6)+'-'+d.slice(6);
  if(d.length>=4)return d.slice(0,3)+'-'+d.slice(3);
  return d;
}
function fmtPhone(input){
  let d=input.value.replace(/\D/g,'');
  if(d.length>10)d=d.slice(0,10);
  if(d.length>=7)d=d.slice(0,3)+'-'+d.slice(3,6)+'-'+d.slice(6);
  else if(d.length>=4)d=d.slice(0,3)+'-'+d.slice(3);
  input.value=d;
}
const fmt2=n=>'$'+(Math.ceil((n||0)/5)*5).toLocaleString();
const fmtD=n=>{const v=parseFloat(n);return'$'+(isNaN(v)?0:v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
const dateKey=d=>{const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');return y+'-'+m+'-'+day;};
const todayKey=()=>dateKey(new Date());
const parseD=s=>new Date(s+'T12:00:00');
const addDays=(s,n)=>{const d=parseD(s);d.setDate(d.getDate()+n);return dateKey(d);};
const v=id=>(document.getElementById(id)||{}).value||'';
const nv=id=>parseFloat(v(id))||0;
// Shared dollar-amount input formatter, native <input type="number"> rejects
// commas outright (worst on iOS Safari, which blocks the keystroke before it's
// even typed; other browsers fail more quietly by dropping the value on read).
// These fields are plain text with this oninput handler instead: strips
// anything but digits and a single decimal point, caps cents to 2 digits, and
// live-formats the integer part with thousands commas as you type. Reads go
// through _moneyVal, which strips the commas back out before parseFloat.
function _fmtMoneyInput(el){
  let raw=(el.value||'').replace(/[^\d.]/g,'');
  const dot=raw.indexOf('.');
  if(dot!==-1)raw=raw.slice(0,dot+1)+raw.slice(dot+1).replace(/\./g,'');
  let[intPart,decPart]=raw.split('.');
  if(decPart!==undefined)decPart=decPart.slice(0,2);
  const grouped=intPart?Number(intPart).toLocaleString('en-US'):'';
  el.value=decPart!==undefined?grouped+'.'+decPart:grouped;
}
const _moneyVal=id=>parseFloat((document.getElementById(id)?.value||'').replace(/,/g,''))||0;
// Comma+cents string for programmatically pre-filling a money input (no $ sign,
// the field's own label/prefix already shows that).
const _moneyStr=n=>(Number(n)||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const IRS=()=>S.irsRate||.725;
function fmtTime(t){if(!t)return'';const[h,m]=t.split(':').map(Number);const ampm=h>=12?'PM':'AM';const h12=h%12||12;return h12+':'+(m<10?'0':'')+m+' '+ampm;}
const COVERAGE=()=>S.cov||350;
const MARGIN=()=>(S.margin||25)/100;
const MATMARK=()=>1+((S.mm||20)/100);
const LABOR_RATES=()=>({walls:S.rWalls||1.30,ceiling:S.rCeil||1.00,trim:S.rTrim||4.00,doors:S.rDoor||95,windows:S.rWin||50,cabinets:S.rCabinets||38,ext_walls:S.rExt||1.10,ext_trim:S.rTrim||4.00,deck:S.rDeck||1.00,fence:S.rFence||1.25,epoxy:S.rEpoxy||1.75});
function initials(name){const p=(name||'?').trim().split(' ');return p.length>=2?(p[0][0]+p[p.length-1][0]).toUpperCase():(name||'?').substring(0,2).toUpperCase();}
function stageAvatar(stage){
  const m={
    new:'background:var(--blue-lt);color:var(--blue-dk)',
    est_scheduled:'background:var(--blue-lt);color:var(--blue-dk)',
    bid_out:'background:var(--blue-lt);color:var(--blue-dk)',
    bid_urgent:'background:#FEF3C7;color:#92400E',
    abandoned:'background:#FEF3C7;color:#92400E',
    signed:'background:var(--green-lt);color:#2D5A14',
    scheduled:'background:var(--green-lt);color:#2D5A14',
    active:'background:var(--green-lt);color:#2D5A14',
    balance_due:'background:#FEE8E8;color:#A32D2D',
    paid:'background:var(--bg2);color:var(--text3)',
  };
  return m[stage]||'background:var(--blue-lt);color:var(--blue-dk)';
}
function lighten(hex){if(!hex||typeof hex!=='string'||!/^#[0-9a-fA-F]{6}/.test(hex))return'#eee';try{const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);return`rgba(${r},${g},${b},0.15)`;}catch(e){return'#eee';}}
// WCAG clamp for the contractor's brand color. The brand color renders both as
// colored TEXT on white surfaces (proposal section labels, hub links) and as a
// BACKGROUND under white text (proposal header, TOTAL row, hub buttons), both
// are the same white↔color pair, so one clamp covers both directions: darken
// the pick toward black (hue preserved) until it clears AA 4.5:1 against
// white, with a small margin for the near-white (#f8fafc) document surfaces.
// Invalid/empty input passes through untouched so callers' fallbacks still run.
function adaBrand(hex){
  const h=String(hex||'').trim().replace('#','');
  if(!/^[0-9a-fA-F]{6}$/.test(h))return hex||'';
  let rgb=[0,2,4].map(i=>parseInt(h.slice(i,i+2),16));
  const lum=c=>{const s=c.map(v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);});return .2126*s[0]+.7152*s[1]+.0722*s[2];};
  const ratioVsWhite=c=>1.05/(lum(c)+0.05);
  let guard=0;
  while(ratioVsWhite(rgb)<4.6&&guard++<48){rgb=rgb.map(v=>Math.max(0,Math.floor(v*0.92)));}
  return'#'+rgb.map(v=>v.toString(16).padStart(2,'0')).join('');
}
function barChart(label,val,total,color){const pct=Math.round(val/total*100);return`<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px"><span>${escHtml(String(label))}</span><span style="font-weight:700">${fmt(val)}</span></div><div class="prog-bar"><div class="prog-fill" style="width:${pct}%;background:${color}"></div></div></div>`;}
function calcBrackets(inc,brackets){let tax=0,prev=0;for(const[lim,rate]of brackets){if(inc<=prev)break;tax+=Math.max(0,Math.min(inc,lim)-prev)*rate;prev=lim;if(lim===Infinity||inc<=lim)break;}return tax;}
// Canonical date stamp for the whole app: MM/DD/YYYY (e.g. 01/01/1900), zero-padded.
// Accepts a Date, an ISO timestamp, or a plain 'YYYY-MM-DD' string. Date-only strings
// are pinned to local noon so a timezone offset can't roll them back a day.
function fmtDateMDY(d){
  if(!d)return'';
  try{
    let dt;
    if(d instanceof Date){dt=d;}
    else{const s=String(d);dt=/^\d{4}-\d{2}-\d{2}$/.test(s)?new Date(s+'T12:00'):new Date(s);}
    if(isNaN(dt.getTime()))return String(d);
    const mm=String(dt.getMonth()+1).padStart(2,'0');
    const dd=String(dt.getDate()).padStart(2,'0');
    return mm+'/'+dd+'/'+dt.getFullYear();
  }catch(e){return String(d);}
}
function fmtDateShort(d){return fmtDateMDY(d);}
// Date + time stamp for the audit trail: "01/01/1900 at 3:42 PM". Accepts an ISO
// timestamp or Date; falls back to date-only for a plain YYYY-MM-DD (no time to show).
function fmtDateTimeMDY(d){
  if(!d)return'';
  try{
    const s=String(d);
    if(/^\d{4}-\d{2}-\d{2}$/.test(s))return fmtDateMDY(s); // date-only, no clock time
    const dt=(d instanceof Date)?d:new Date(s);
    if(isNaN(dt.getTime()))return fmtDateMDY(d);
    const t=dt.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
    return fmtDateMDY(dt)+' at '+t;
  }catch(e){return fmtDateMDY(d);}
}
function escHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function closeTopModal(){const o=document.querySelector('.zmodal-overlay');if(o&&typeof o.remove==='function')o.remove();else if(o&&o.parentNode)o.parentNode.removeChild(o);}
function zConfirm(msg, onYes, opts={}){
  const title=opts.title||'Are you sure?';
  const yesLabel=opts.yes||'Yes';
  const noLabel=opts.no||'Cancel';
  const danger=opts.danger!==false;
  const onNo=opts.onNo||null; // optional callback when user taps No/Cancel
  const overlay=document.createElement('div');
  overlay.className='zmodal-overlay';
  overlay.innerHTML=
    '<div class="zmodal">'+
      '<div class="zmodal-title">'+title+'</div>'+
      '<div class="zmodal-msg">'+msg+'</div>'+
      '<div class="zmodal-btns">'+
        '<button class="btn zmodal-cancel" style="font-size:14px;padding:10px 16px">'+noLabel+'</button>'+
        '<button id="zmodal-yes" class="btn" style="font-size:14px;padding:10px 16px;background:'+(danger?'#A32D2D':'var(--blue)')+';color:#fff;border-color:'+(danger?'#A32D2D':'var(--blue)')+'">'+yesLabel+'</button>'+
      '</div>'+
    '</div>';
  document.body.appendChild(overlay);
  const cancelBtns=overlay.querySelectorAll('.zmodal-cancel');
  cancelBtns.forEach(b=>b.onclick=()=>{overlay.remove();if(onNo)onNo();});
  overlay.querySelector('#zmodal-yes').onclick=()=>{overlay.remove();onYes();};
  overlay.addEventListener('click',e=>{if(e.target===overlay){overlay.remove();if(onNo)onNo();}});
}

function zAlert(msg, opts={}){
  const title=opts.title||'Notice';
  const overlay=document.createElement('div');
  overlay.className='zmodal-overlay';
  overlay.innerHTML=
    '<div class="zmodal">'+
      '<div class="zmodal-title">'+title+'</div>'+
      '<div class="zmodal-msg">'+msg+'</div>'+
      '<div class="zmodal-btns">'+
        '<button class="btn btn-p zmodal-ok" style="font-size:14px;padding:10px 20px">OK</button>'+
      '</div>'+
    '</div>';
  document.body.appendChild(overlay);
  overlay.querySelectorAll('.zmodal-ok,.zmodal-cancel').forEach(b=>b.onclick=()=>overlay.remove());
  overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});
}

function zPrompt(msg, onOk, opts={}){
  const title=opts.title||'Enter value';
  const placeholder=opts.placeholder||'';
  const overlay=document.createElement('div');
  overlay.className='zmodal-overlay';
  overlay.innerHTML=
    '<div class="zmodal">'+
      '<div class="zmodal-title">'+title+'</div>'+
      '<div class="zmodal-msg" style="margin-bottom:10px">'+msg+'</div>'+
      '<input id="zprompt-inp" placeholder="'+placeholder+'" style="width:100%;padding:10px;font-size:14px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);font-family:inherit;margin-bottom:12px">'+
      '<div class="zmodal-btns">'+
        '<button class="btn zmodal-cancel" style="font-size:14px;padding:10px 16px">Cancel</button>'+
        '<button id="zprompt-ok" class="btn btn-p" style="font-size:14px;padding:10px 16px">OK</button>'+
      '</div>'+
    '</div>';
  document.body.appendChild(overlay);
  const inp=overlay.querySelector('#zprompt-inp');
  if(opts.value)inp.value=opts.value;
  const ok=overlay.querySelector('#zprompt-ok');
  const cancel=overlay.querySelector('.zmodal-cancel');
  cancel.onclick=()=>overlay.remove();
  ok.onclick=()=>{overlay.remove();onOk(inp.value||'');};
  inp.addEventListener('keydown',e=>{if(e.key==='Enter'){overlay.remove();onOk(inp.value||'');}});
  overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});
  setTimeout(()=>inp.focus(),100);
}

function showToast(msg,icon,duration){
  icon=icon||'✓';duration=duration||3500;
  // Renders the icon arg as a real SVG when we have one mapped (js/icons.js):
  // covers ~200 showToast call sites app-wide from one place, instead of
  // touching each call site's emoji argument individually.
  const _iconHtml=(typeof hasSvgIcon==='function'&&hasSvgIcon(icon))?svgIcon(icon,{size:15}):icon;
  const t=document.createElement('div');
  t.className='toast';
  t.innerHTML='<span class="toast-icon">'+_iconHtml+'</span><span style="flex:1">'+msg+'</span><button class="toast-close" onclick="this.parentElement.remove()">×</button>';
  document.body.appendChild(t);
  setTimeout(()=>{t.style.opacity='0';t.style.transform='scale(.9) translateY(8px)';t.style.transition='all .3s';setTimeout(()=>t.remove(),300);},duration);
}

function _fmtExpDate(el){
  let v=el.value.replace(/\D/g,'');
  if(v.length>2)v=v.slice(0,2)+'/'+v.slice(2,6);
  el.value=v;
}
function _ymdToMdY(s){
  if(!s||!s.includes('-'))return s||'';
  const[y,m,d]=s.split('-');return m+'/'+d+'/'+y;
}
function _mdYToYmd(s){
  if(!s||!s.includes('/'))return s||'';
  const p=s.split('/');
  if(p.length!==3||p[2].length!==4)return '';
  return p[2]+'-'+p[0].padStart(2,'0')+'-'+p[1].padStart(2,'0');
}

// ── Geolocation helper ───────────────────────────────────────────────
// Silent GPS grab, only fires if OS permission is already 'granted'.
// Never triggers the OS permission dialog. Use requestLocationPermission()
// for any flow that needs to ask the user.
function geoIfGranted(cb, errCb, opts){
  if(!navigator.geolocation)return;
  const doGet=()=>navigator.geolocation.getCurrentPosition(
    cb, errCb||function(){},
    opts||{enableHighAccuracy:false,timeout:5000,maximumAge:30000}
  );
  if(S.locationGranted){doGet();return;}
  if(!navigator.permissions||!navigator.permissions.query)return;
  navigator.permissions.query({name:'geolocation'}).then(p=>{
    if(p.status==='granted'){
      S.locationGranted=true;S.locationDenied=false;S.settingsTs=Date.now();
      // saveAll persists to localStorage AND queues the cloud sync; bumping
      // settingsTs makes this granted flag win the next cloud merge so the
      // permission survives a reboot.
      if(typeof saveAll==='function')saveAll();
      else try{localStorage.setItem('zp3_S',JSON.stringify(S));}catch(e){}
      doGet();
    }
  }).catch(()=>{});
}

// ── Auto-capitalize EVERY free-text field ───────────────────────────────────
// Title-cases the first letter of every space-separated word so anything typed
// can never be saved as "master bedroom" or "Master bedroom", it always
// normalizes to "Master Bedroom". App-wide by default (every <textarea> and
// text <input>), so no per-field wiring is needed. The rest of each word is left
// as typed, so acronyms ("ABC Painting") and camelCase ("McDowell") survive,
// only the word-initial letter is forced upper.
function _autoCapWords(s){
  return String(s==null?'':s).replace(/(^|\s)([\p{L}])/gu, function(_m, sep, ch){ return sep + ch.toUpperCase(); });
}
// Skip only the field types/modes where title-casing is WRONG (email, password,
// phone, number, url, search). Any other field can opt out with
// autocapitalize="none" (or "off").
function _autoCapEligible(el){
  if (!el || !el.matches) return false;
  if (!el.matches('textarea, input:not([type]), input[type="text"]')) return false;
  var ac = (el.getAttribute('autocapitalize') || '').toLowerCase();
  if (ac === 'none' || ac === 'off') return false;
  var im = (el.getAttribute('inputmode') || '').toLowerCase();
  if (im === 'email' || im === 'url' || im === 'numeric' || im === 'decimal' || im === 'tel' || im === 'search') return false;
  return true;
}
// TWO mechanisms, both triggered by the SPACEBAR (capitalize each word as you
// type), and neither mutates a field during a programmatic value-set:
//   1. MOBILE (primary): set autocapitalize="words" on every eligible field, so
//      the device keyboard capitalizes each word natively as it's typed, the
//      "hits on the spacebar" behavior, with zero value rewriting.
//   2. DESKTOP (fallback): on a real spacebar keydown, title-case the value. A
//      keydown only fires from genuine typing, Playwright's page.fill() sets the
//      value WITHOUT a keydown, so the offline suite is never affected.
function _applyAutoCapAttrs(root){
  try {
    (root || document).querySelectorAll('input:not([type]), input[type="text"], textarea').forEach(function(el){
      if (!_autoCapEligible(el)) return;
      if (!el.hasAttribute('autocapitalize')) el.setAttribute('autocapitalize', 'words');
      // iOS/Safari silently disable autocorrect on fields they can't classify
      // (most of ours carry autocomplete="off"). Explicit autocorrect="on" +
      // spellcheck restore native as-you-type correction on every free-text
      // field. Same eligibility gate as autocapitalize, and a field can opt out
      // by setting its own autocorrect/spellcheck attribute.
      if (!el.hasAttribute('autocorrect')) el.setAttribute('autocorrect', 'on');
      if (!el.hasAttribute('spellcheck')) el.setAttribute('spellcheck', 'true');
    });
  } catch (_e) {}
}
if (typeof document !== 'undefined' && document.addEventListener) {
  // Tag static fields once the DOM is ready, and expose a hook so code that
  // injects fields later (modals/sheets) can re-tag them.
  if (document.readyState !== 'loading') _applyAutoCapAttrs(document);
  else document.addEventListener('DOMContentLoaded', function(){ _applyAutoCapAttrs(document); });
  window._applyAutoCapAttrs = _applyAutoCapAttrs;
  // Desktop spacebar fallback, runs on real typing only (not page.fill).
  document.addEventListener('keydown', function(e){
    if (e.key !== ' ' && e.key !== 'Spacebar') return;
    var el = e && e.target;
    if (!_autoCapEligible(el)) return;
    // Let the space land first, then normalize the words typed so far.
    setTimeout(function(){
      var v = el.value, capped = _autoCapWords(v);
      if (capped !== v) {
        var pos = el.selectionStart;
        el.value = capped;
        try { el.setSelectionRange(pos, pos); } catch (_e) {}
        try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (_e) {}
      }
    }, 0);
  }, true);
}

// ── Supabase cloud sync ───────────────────────────────────────────────
