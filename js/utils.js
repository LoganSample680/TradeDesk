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
function barChart(label,val,total,color){const pct=Math.round(val/total*100);return`<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px"><span>${escHtml(String(label))}</span><span style="font-weight:700">${fmt(val)}</span></div><div class="prog-bar"><div class="prog-fill" style="width:${pct}%;background:${color}"></div></div></div>`;}
function calcBrackets(inc,brackets){let tax=0,prev=0;for(const[lim,rate]of brackets){if(inc<=prev)break;tax+=Math.max(0,Math.min(inc,lim)-prev)*rate;prev=lim;if(lim===Infinity||inc<=lim)break;}return tax;}
function fmtDateShort(d){if(!d)return'';try{const dt=new Date(d+'T12:00');return dt.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});}catch(e){return d;}}
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
  const t=document.createElement('div');
  t.className='toast';
  t.innerHTML='<span class="toast-icon">'+icon+'</span><span style="flex:1">'+msg+'</span><button class="toast-close" onclick="this.parentElement.remove()">×</button>';
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
// Silent GPS grab — only fires if OS permission is already 'granted'.
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
      S.locationGranted=true;S.locationDenied=false;
      try{localStorage.setItem('zp3_S',JSON.stringify(S));}catch(e){}
      doGet();
    }
  }).catch(()=>{});
}

// ── Supabase cloud sync ───────────────────────────────────────────────
