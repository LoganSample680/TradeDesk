// The public photo page (photos.html). Reads the snapshot tdPhotoLinkCreate
// wrote (js/photo-gallery.js) and draws it. No SDK, no login: one fetch of
// one file the anon role may read.
const PS_SUPA_URL='https://mwtsmctajhrrybblgorf.supabase.co';
const PS_SUPA_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im13dHNtY3RhamhycnliYmxnb3JmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNjIwNjMsImV4cCI6MjA5MDczODA2M30.-FMn1pEs9PpCvv8eGwSbtucWAWvcfEcQ1SYx4nD207M';

function psEsc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
// Only http(s) image urls ever reach a style or an src.
function psUrl(u){u=String(u||'');return /^https?:\/\//i.test(u)?u.replace(/'/g,'%27').replace(/"/g,'%22').replace(/\)/g,'%29'):'';}
// The params, strictly shaped: a uid and a 32-hex token, nothing that could
// walk the storage path anywhere else.
function psParams(search){
  const q=new URLSearchParams(search||'');
  const u=q.get('u')||'',s=q.get('s')||'';
  if(!/^[0-9a-f-]{36}$/i.test(u)||!/^[0-9a-f]{32}$/i.test(s))return null;
  return {u,s};
}
async function psLoad(p){
  const r=await fetch(PS_SUPA_URL+'/storage/v1/object/authenticated/proposals/photo-share/'+p.u+'/'+p.s+'.json',
    {headers:{apikey:PS_SUPA_KEY,Authorization:'Bearer '+PS_SUPA_KEY}});
  if(!r.ok)return null;
  const j=await r.json();
  return (j&&Array.isArray(j.photos))?j:null;
}
function psRender(snap){
  const body=document.getElementById('ps-body');
  const biz=document.getElementById('ps-biz');
  if(!body)return false;
  if(!snap){body.innerHTML='<div class="ps-msg">This photo link has expired or was never sent.</div>';return false;}
  if(biz)biz.textContent=snap.biz||'Photos';
  const shots=snap.photos.filter(x=>x&&psUrl(x.u));
  window._psShots=shots;
  const street=String(snap.addr||'').split(',')[0];
  const when=(()=>{try{return new Date(snap.createdAt).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});}catch(_e){return '';}})();
  const stages=[['before','Before'],['progress','Progress'],['after','After'],['','Photos']];
  const known=new Set(['before','progress','after']);
  body.innerHTML=
    '<div class="ps-addr">'+psEsc(street||'Your photos')+'</div>'+
    '<div class="ps-sub">'+shots.length+(shots.length===1?' photo':' photos')+(when?' · sent '+psEsc(when):'')+'</div>'+
    stages.map(([k,label])=>{
      const list=shots.map((x,i)=>({x,i})).filter(o=>k?o.x.s===k:!known.has(o.x.s));
      if(!list.length)return '';
      return '<div class="ps-stage">'+label+' · '+list.length+'</div><div class="ps-grid">'+
        list.map(o=>'<button type="button" class="ps-cell" aria-label="Open photo" onclick="psOpen('+o.i+')" style="background-image:url(\''+psUrl(o.x.t||o.x.u)+'\')"></button>').join('')+
      '</div>';
    }).join('');
  return true;
}
function psOpen(i){
  const x=(window._psShots||[])[i];
  if(!x)return false;
  const v=document.createElement('div');
  v.className='ps-view';v.id='ps-view';
  const cap=[x.c,(()=>{try{return x.at?new Date(x.at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'';}catch(_e){return '';}})()].filter(Boolean).join(' · ');
  v.innerHTML='<img alt="" src="'+psUrl(x.u)+'"><button type="button" class="ps-x" onclick="psClose()">Close</button>'+(cap?'<div class="ps-cap">'+psEsc(cap)+'</div>':'');
  v.addEventListener('click',e=>{if(e.target===v)psClose();});
  document.body.appendChild(v);
  requestAnimationFrame(()=>v.classList.add('on'));
  return true;
}
function psClose(){const v=document.getElementById('ps-view');if(v)v.remove();return !!v;}
document.addEventListener('keydown',e=>{if(e.key==='Escape')psClose();});
(async()=>{
  const p=psParams(location.search);
  let snap=null;
  try{snap=p?await psLoad(p):null;}catch(_e){snap=null;}
  psRender(snap);
})();
