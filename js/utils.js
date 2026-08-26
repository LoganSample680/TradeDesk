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
// THE RATE FOR A GIVEN YEAR, not "the rate".
//
// This used to be S.irsRate||.725: one stored number with no year attached, so
// every screen priced every trip at whatever rate was fetched last. Two things
// were wrong with that, and the first one is wrong TODAY, not someday:
//
//   · Open 2024 on the tracker and those trips were priced at the CURRENT rate.
//     2024 was 67.0 cents and 2026 is 72.5, so a closed year's deduction read
//     8% high on the very screen a contractor would check it on.
//   · The tax page never used this. It reads _getIrsRateForYear, which knows the
//     year table. So the mileage page and the tax page could put two different
//     numbers on the same trips, and neither one said which year it meant.
//
// Routing through _getIrsRateForYear fixes both at the root instead of at 29
// call sites. That function still honours a per-contractor S.irsRate override
// for the CURRENT year (which is what the yearly auto-refresh writes), and reads
// the published table for every year that is already closed.
//
// Accepts a year, a 'YYYY-MM-DD' date (so a per-trip figure can price itself off
// the trip's own date), or nothing at all, meaning this calendar year.
const IRS=(when)=>{
  const y=when==null?new Date().getFullYear():parseInt(String(when).slice(0,4),10);
  if(!y||typeof _getIrsRateForYear!=='function')return S.irsRate||.725;
  return _getIrsRateForYear(y);
};
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
  // Haptics ride the toast, ONE hook for ~200 call sites (owner 2026-08-10:
  // "haptics everywhere"). The icon already encodes the outcome at every one
  // of those sites, so the feel follows the meaning for free: a warning
  // buzzes like a warning, a win lands like a win, and a plain notice ticks.
  // Deliberately not per-call-site: 200 hand-tuned haptics would drift out of
  // sync with their copy the first time anyone edited a message.
  try{
    const _warn=/⚠|❌|🚫/.test(icon);
    const _win=/✓|✅|💰|🎉|📄/.test(icon);
    _tdHaptic(_warn?'warn':(_win?'win':'tick'));
  }catch(_e){}
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
// DEFAULT IS THE TIGHTEST FIX AVAILABLE (owner rule 2026-08-26: "we need the
// tightest location services upfront at all times, never can default to
// approximates"). This defaulted to enableHighAccuracy:false with a 30-second
// cache, and its callers are not cosmetic: checkNearbyJob (js/jobs.js) matches
// a position against a job fence and reads pos.coords.accuracy to decide
// whether to trust it, and startDrive (js/mileage.js) stamps the start of a
// deductible trip. Both were being handed a wifi-derived fix that could be
// half a minute stale.
//
// Coarse is still available, but it now has to be ASKED for, with a reason.
// A caller that genuinely wants cheap and approximate (weather, a permission
// probe that throws the position away) passes opts and says why in a comment;
// the tests scan for that justification.
function geoIfGranted(cb, errCb, opts){
  if(!navigator.geolocation)return;
  const doGet=()=>navigator.geolocation.getCurrentPosition(
    cb, errCb||function(){},
    opts||{enableHighAccuracy:true,timeout:15000,maximumAge:0}
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

// ── Native-shell popup shim ──────────────────────────────────────────────────
// WKWebView has NO popup windows: every window.open in the shell returns null,
// which read as "pop-ups blocked" across all 23 document call sites (audit
// report, invoices, lien docs, PDF exports; owner report 2026-08-08). Same
// medicine as the geolocation shim: fix the primitive once instead of chasing
// call sites. In the shell, window.open becomes a full-screen in-app viewer:
//   • blank/_blank + document.write (the report pattern) renders into an
//     overlay iframe with Close and Print, the fake window object supports
//     exactly what the callers use (document.open/write/close, focus, print,
//     close).
//   • a same-origin URL loads in the same viewer.
//   • a cross-origin URL navigates the main frame, which Capacitor's
//     allowNavigation policy kicks out to the system browser.
// Browser/PWA untouched: installs only when Capacitor reports native.
function _tdShellDocOverlay(){
  const ov=document.createElement('div');
  ov.style.cssText='position:fixed;inset:0;z-index:100000;background:#fff;display:flex;flex-direction:column;animation:td-pg-enter .2s cubic-bezier(.22,1,.36,1) both';
  const bar=document.createElement('div');
  bar.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 14px;padding-top:calc(10px + env(safe-area-inset-top,0px));background:var(--ink,#1B1612);color:#fff;flex-shrink:0';
  const frame=document.createElement('iframe');
  frame.style.cssText='flex:1;border:none;width:100%;background:#fff';
  const fake={closed:false,location:{}};
  const closeBtn=document.createElement('button');
  closeBtn.textContent='Close';
  closeBtn.style.cssText='font-size:14px;font-weight:700;color:#fff;background:rgba(255,255,255,.14);border:none;border-radius:8px;padding:8px 14px;font-family:inherit;cursor:pointer';
  closeBtn.onclick=()=>{ov.remove();fake.closed=true;};
  const printBtn=document.createElement('button');
  printBtn.textContent='Print / Save';
  printBtn.style.cssText='font-size:14px;font-weight:700;color:var(--ink,#1B1612);background:#fff;border:none;border-radius:8px;padding:8px 14px;font-family:inherit;cursor:pointer';
  printBtn.onclick=()=>{try{frame.contentWindow.print();}catch(_e){}};
  bar.appendChild(closeBtn);bar.appendChild(printBtn);
  ov.appendChild(bar);ov.appendChild(frame);
  document.body.appendChild(ov);
  fake.document={
    open:function(){try{frame.contentDocument.open();}catch(_e){}},
    write:function(h){try{frame.contentDocument.write(h);}catch(_e){}},
    close:function(){try{frame.contentDocument.close();}catch(_e){}}
  };
  fake.focus=function(){};
  fake.print=function(){try{frame.contentWindow.print();}catch(_e){}};
  fake.close=function(){ov.remove();fake.closed=true;};
  fake._frame=frame;fake._overlay=ov;
  return fake;
}
function _tdInstallShellWindowOpen(){
  try{
    const cap=window.Capacitor;
    if(!cap||typeof cap.isNativePlatform!=='function'||!cap.isNativePlatform())return false;
    window.open=function(url){
      try{
        if(!url||url==='about:blank'){return _tdShellDocOverlay();}
        const u=new URL(url,location.href);
        if(u.origin===location.origin){
          const v=_tdShellDocOverlay();
          v._frame.src=u.href;
          return v;
        }
        // Cross-origin: Capacitor's allowNavigation policy sends this to the
        // system browser. A truthy stub keeps the caller's !win checks quiet.
        location.href=u.href;
        return {closed:false,focus:function(){},close:function(){},print:function(){},document:{open:function(){},write:function(){},close:function(){}}};
      }catch(_e){return _tdShellDocOverlay();}
    };
    return true;
  }catch(_e){return false;}
}
_tdInstallShellWindowOpen();

// ── Haptics (owner 2026-08-10: "haptics everywhere needs a go") ───────────────
// THE BUG THIS REPLACES: the app called navigator.vibrate() in six places, and
// iOS has never implemented the Vibration API in Safari or WKWebView. Every
// one of those calls was a silent no-op on the exact device our customers
// carry, so the app has always felt flat in the hand on iPhone.
//
// One call site for the whole app. Native Taptic when the shell provides it
// (td-haptic), navigator.vibrate as the Android/PWA fallback, silent
// everywhere else. Never throws and never awaits: a haptic is decoration, it
// must never delay or break the action it decorates.
//
// The vocabulary is deliberately about MEANING, not hardware:
//   tick    a small thing happened (a card moved, a tab switched)
//   tap     a control committed (button pressed, item picked up)
//   thud    something big and deliberate (sign out, delete, clock out)
//   win     it worked and it MATTERS (payment collected, proposal signed)
//   warn    needs attention (validation stopped you)
//   fail    it did not work (save failed, card declined)
const _TD_HAPTIC_MAP={
  tick:{fn:'select'},
  tap:{fn:'impact',arg:{style:'light'}},
  thud:{fn:'impact',arg:{style:'medium'}},
  heavy:{fn:'impact',arg:{style:'heavy'}},
  win:{fn:'notify',arg:{type:'success'}},
  warn:{fn:'notify',arg:{type:'warning'}},
  fail:{fn:'notify',arg:{type:'error'}}
};
// Web fallback durations, chosen to echo the native feel as closely as one
// buzz can. Arrays are patterns (a rhythm), which Android honors.
const _TD_VIBE_MAP={tick:8,tap:12,thud:25,heavy:40,win:[18,60,28],warn:[24,70,24],fail:[40,60,40,60,40]};
// Resolution caches only a SUCCESS, never a failure, and lives on window like
// the Apple sign-in plugin cache (§7.3). A negative answer must stay
// re-checkable: utils.js can execute before Capacitor finishes injecting its
// bridge, and caching that "no" would leave the shell with dead haptics for
// the whole session, the exact class of bug this feature exists to fix.
function _tdHapticNative(){
  if(window._tdHapticPlugin)return window._tdHapticPlugin;
  try{
    const cap=window.Capacitor;
    if(cap&&typeof cap.isNativePlatform==='function'&&cap.isNativePlatform()){
      if(typeof cap.registerPlugin==='function')window._tdHapticPlugin=cap.registerPlugin('TdHaptic');
      else if(cap.Plugins&&cap.Plugins.TdHaptic)window._tdHapticPlugin=cap.Plugins.TdHaptic;
    }
  }catch(_e){window._tdHapticPlugin=null;}
  return window._tdHapticPlugin||null;
}
function _tdHaptic(kind){
  // Owner-controllable: one switch silences the whole app for anyone who
  // finds it fussy, without touching a single call site.
  try{if(typeof S!=='undefined'&&S&&S.hapticsOff)return;}catch(_e){}
  const spec=_TD_HAPTIC_MAP[kind]||_TD_HAPTIC_MAP.tap;
  const P=_tdHapticNative();
  if(P&&typeof P[spec.fn]==='function'){
    try{const r=P[spec.fn](spec.arg||{});if(r&&r.catch)r.catch(()=>{});}catch(_e){}
    return;
  }
  try{const v=_TD_VIBE_MAP[kind];if(navigator.vibrate&&v!=null)navigator.vibrate(v);}catch(_e){}
}

// ── Shimmer skeleton rows (§8.4) ──────────────────────────────────────────────
// The app-wide loading treatment: any async surface renders these instead of a
// "Loading..." string, and real content replaces them in ONE swap when data
// lands, never a second stacked reveal.
//
// Row widths (owner report 2026-08-25: the old 88/72/56 sawtooth "reads as a
// machine placeholder"). Facebook, YouTube and X all sell the same illusion the
// same way: no two neighbouring placeholder lines are the same length, the
// lengths do not march up or down in an even step, and the final line of a
// block is noticeably short, because that is what the last line of a real
// sentence looks like when it stops mid-column.
//
// So: a fixed 5-width cycle, DELIBERATELY not random. Math.random() would
// reshuffle every single repaint (a skeleton that redraws while it shimmers
// flickers), and it would make the widths untestable. A fixed cycle indexed by
// row number is stable across repaints for free: the same row always gets the
// same width, so a re-render is pixel-identical to the paint before it.
// Length 5 (coprime with the 2-5 row counts every real caller uses) means a
// normal skeleton never shows the cycle repeat, and the values are non-monotonic
// with uneven gaps so no run of rows reads as a staircase.
const _TD_SKEL_W=[94,71,86,62,79];
// The last row is the tell. Real text ends short, so the closing row gets a
// stub width well under anything in the cycle. Only when there IS a row above
// it: a lone skeleton row is not the end of a paragraph, it is the whole thing,
// so a single row uses the full cycle width instead of looking truncated.
const _TD_SKEL_W_LAST=42;
function _tdSkelRows(n,h){
  let out='';
  // Defensive count: no args / non-numeric → 3 (the historic default), 0 or a
  // negative → no rows at all, never a thrown error or an infinite loop. And a
  // nonsense count out of a bad computation is capped, so a skeleton can never
  // lock the main thread building a million nodes nobody will ever see.
  const bad=(n==null||typeof n!=='number'||!isFinite(n));
  const count=bad?3:Math.max(0,Math.min(200,Math.floor(n)));
  const ht=h||12;
  for(let i=0;i<count;i++){
    const last=(count>1&&i===count-1);
    const w=last?_TD_SKEL_W_LAST:_TD_SKEL_W[i%_TD_SKEL_W.length];
    out+='<div class="td-skel" style="height:'+ht+'px;width:'+w+'%;margin:10px 0"></div>';
  }
  return out;
}

// ── The business's clock (owner rule 2026-08-24) ──────────────────────────────
// "It needs fixed to contractor time zone when setup off the shop business
// address, that should solve it permanently."
//
// Every time-of-day the app shows a contractor is a fact about THEIR business:
// when the crew clocked in, when the truck rolled, when the trip was logged.
// None of it is a fact about where the phone happens to be right now. Reading
// the device clock meant the owner's Monday redrew itself from 8:00-10:30 to
// 7:00-9:30 the moment he landed in Denver, and the CSV export moved with him.
//
// So the zone is derived once from the business ADDRESS, not asked for and not
// taken from whatever device did the setup. State plus the shop's longitude is
// enough: most states sit in one zone, and the dozen that do not are split on a
// line the shop's own coordinates land cleanly on either side of.
//
// Known ragged edge, stated rather than hidden: Indiana and a handful of single
// counties elsewhere follow county lines no longitude can trace. Those resolve
// to their state's majority zone, which is right for almost everyone in them
// and wrong for a few. S.bizTz is writable, so a contractor in one of those
// counties can be corrected once and it sticks.
const _TZ_BY_STATE={
  AL:'America/Chicago',AK:'America/Anchorage',AZ:'America/Phoenix',AR:'America/Chicago',
  CA:'America/Los_Angeles',CO:'America/Denver',CT:'America/New_York',DE:'America/New_York',
  DC:'America/New_York',FL:'America/New_York',GA:'America/New_York',HI:'Pacific/Honolulu',
  ID:'America/Boise',IL:'America/Chicago',IN:'America/Indiana/Indianapolis',IA:'America/Chicago',
  KS:'America/Chicago',KY:'America/New_York',LA:'America/Chicago',ME:'America/New_York',
  MD:'America/New_York',MA:'America/New_York',MI:'America/Detroit',MN:'America/Chicago',
  MS:'America/Chicago',MO:'America/Chicago',MT:'America/Denver',NE:'America/Chicago',
  NV:'America/Los_Angeles',NH:'America/New_York',NJ:'America/New_York',NM:'America/Denver',
  NY:'America/New_York',NC:'America/New_York',ND:'America/Chicago',OH:'America/New_York',
  OK:'America/Chicago',OR:'America/Los_Angeles',PA:'America/New_York',RI:'America/New_York',
  SC:'America/New_York',SD:'America/Chicago',TN:'America/Chicago',TX:'America/Chicago',
  UT:'America/Denver',VT:'America/New_York',VA:'America/New_York',WA:'America/Los_Angeles',
  WV:'America/New_York',WI:'America/Chicago',WY:'America/Denver'
};
// States a longitude actually splits, with the line and what lies west of it.
// (Idaho splits on LATITUDE instead: the panhandle is Pacific.)
const _TZ_SPLIT={
  KS:{lon:-101.5,west:'America/Denver'},   NE:{lon:-101.5,west:'America/Denver'},
  ND:{lon:-100.6,west:'America/Denver'},   SD:{lon:-100.3,west:'America/Denver'},
  TX:{lon:-104.9,west:'America/Denver'},   FL:{lon:-85.0, west:'America/Chicago'},
  MI:{lon:-87.3, west:'America/Chicago'},  KY:{lon:-85.4, west:'America/Chicago'},
  TN:{lon:-85.3, west:'America/Chicago',east:'America/New_York'}
};
function _tzUsable(tz){
  if(!tz)return false;
  try{new Intl.DateTimeFormat('en-US',{timeZone:tz});return true;}catch(_e){return false;}
}
// state: two-letter code. lon/lat: the shop's own coordinates when known, which
// is what decides a split state. Returns null when there is nothing to go on,
// so the caller can fall back rather than guess a zone off nothing.
function tzForBusiness(state,lon,lat){
  const st=String(state||'').trim().toUpperCase().slice(0,2);
  if(!_TZ_BY_STATE[st])return null;
  if(st==='ID'&&typeof lat==='number'&&lat>45.5)return 'America/Los_Angeles';
  const sp=_TZ_SPLIT[st];
  if(sp&&typeof lon==='number'&&isFinite(lon)){
    if(lon<sp.lon)return sp.west;
    if(sp.east)return sp.east;
  }
  return _TZ_BY_STATE[st];
}
// The zone every clock time in the app is rendered in. Resolved once and kept
// on S so it survives a trip, a new device, and a contractor who set the
// business up while visiting somewhere else.
function bizTz(){
  if(typeof S==='undefined'||!S)return 'America/Chicago';
  if(_tzUsable(S.bizTz))return S.bizTz;
  let lon=null,lat=null;
  try{
    const shop=(typeof places!=='undefined'&&Array.isArray(places))
      ? places.find(p=>p&&p.kind==='shop'&&p.lon!=null&&p.lat!=null) : null;
    if(shop){lon=Number(shop.lon);lat=Number(shop.lat);}
  }catch(_e){}
  const derived=tzForBusiness(S.state,lon,lat);
  if(derived){
    // Cached, not recomputed per render: the address is not going to move, and
    // this is called from every row of every list that shows a time.
    S.bizTz=derived;
    return derived;
  }
  // Nothing on record yet (mid-onboarding, or an account older than the
  // business address). The device's own zone is the best available guess and
  // is right for the overwhelming majority, who set up where they work.
  try{const dev=Intl.DateTimeFormat().resolvedOptions().timeZone;if(_tzUsable(dev))return dev;}catch(_e){}
  return 'America/Chicago';
}
// One formatter for every clock time the contractor reads, so no two screens
// can ever disagree about when something happened.
function bizTime(iso){
  if(!iso)return '';
  const d=iso instanceof Date?iso:new Date(iso);
  if(isNaN(d.getTime()))return '';
  try{return d.toLocaleTimeString('en-US',{timeZone:bizTz(),hour:'numeric',minute:'2-digit'});}
  catch(_e){return d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});}
}
