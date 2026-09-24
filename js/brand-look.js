// The look a white-label screen takes from the contractor's own logo (owner
// 2026-09-24: "white label has to be intuitive so it changes the colors and
// things based on the logo"). Loaded by the app (index.html) and the client
// hub (client.html) before their boot screens paint, so it must stay tiny and
// dependency-free.
//
// tdLogoLook(img) reads a decoded <img> and returns:
//   bg      the colour the logo already sits on (its own border), so the boot
//           screen continues the artwork instead of framing it. A transparent
//           logo gets black or white, whichever it reads best on.
//   fg      text colour that reads on bg (the "Powered by" line).
//   accent  the logo's strongest colour, used as the brand colour when the
//           contractor has not picked one. null when the logo has none (a
//           black and white mark).
// Returns null when the image cannot be read (not decoded, or a cross-origin
// image without CORS), and callers keep their default look.
function tdLogoLook(img){
  try{
    if(!img||!img.naturalWidth)return null;
    const N=48,c=document.createElement('canvas');c.width=N;c.height=N;
    const x=c.getContext('2d');x.drawImage(img,0,0,N,N);
    const d=x.getImageData(0,0,N,N).data;
    const px=(i,j)=>{const k=(j*N+i)*4;return[d[k],d[k+1],d[k+2],d[k+3]];};
    // The border ring decides the background.
    let er=0,eg=0,eb=0,ea=0,en=0;
    for(let i=0;i<N;i++)for(const j of[0,1,N-2,N-1]){
      for(const p of[px(i,j),px(j,i)]){er+=p[0];eg+=p[1];eb+=p[2];ea+=p[3];en++;}
    }
    const lum=(r,g,b)=>(0.299*r+0.587*g+0.114*b)/255;
    let bg,bgRgb;
    if(ea/en<128){
      // Transparent logo: black or white, whichever the artwork reads on.
      let L=0,n=0;
      for(let k=0;k<d.length;k+=4){if(d[k+3]<128)continue;L+=lum(d[k],d[k+1],d[k+2]);n++;}
      bgRgb=(n&&L/n>0.62)?[0,0,0]:[255,255,255];
    }else{
      bgRgb=[Math.round(er/en),Math.round(eg/en),Math.round(eb/en)];
    }
    bg='#'+bgRgb.map(v=>v.toString(16).padStart(2,'0')).join('');
    const dark=lum(bgRgb[0],bgRgb[1],bgRgb[2])<0.5;
    // Accent: the most common saturated colour that is not the background.
    const bins={};
    for(let k=0;k<d.length;k+=4){
      if(d[k+3]<128)continue;
      const r=d[k],g=d[k+1],b=d[k+2],mx=Math.max(r,g,b),mn=Math.min(r,g,b);
      if(mx<60||mx-mn<70)continue;
      if(Math.abs(r-bgRgb[0])+Math.abs(g-bgRgb[1])+Math.abs(b-bgRgb[2])<60)continue;
      const key=(r>>5)+','+(g>>5)+','+(b>>5);
      const e=bins[key]||(bins[key]=[0,0,0,0]);e[0]++;e[1]+=r;e[2]+=g;e[3]+=b;
    }
    const top=Object.values(bins).sort((a,b)=>b[0]-a[0])[0];
    // Under 2% of the logo is a fleck, not a brand colour.
    const accent=(top&&top[0]>=N*N*0.02)
      ?'#'+[1,2,3].map(i=>Math.round(top[i]/top[0]).toString(16).padStart(2,'0')).join('')
      :null;
    return{bg,fg:dark?'rgba(255,255,255,.42)':'rgba(0,0,0,.38)',accent,dark};
  }catch(e){return null;}
}
// A short key for a logo, so a cached look is only reused for the same logo.
function tdLogoKey(src){
  src=String(src||'');if(!src)return'';
  let h=0;const step=Math.max(1,Math.floor(src.length/400));
  for(let i=0;i<src.length;i+=step)h=(h*31+src.charCodeAt(i))|0;
  return src.length+':'+h;
}
// ── The boot screen (owner-approved design 2026-09-24) ──────────────────────
// One builder for every boot surface: the app's first paint, the app's
// "updating" screen, and the client hub. The logo sits on its OWN background
// colour, big, and simply fades in, holds, and fades out; nothing drifts,
// glows or loads a bar under it (owner: "I don't want this shit to look AI").
// No logo: the business name (and its initial on a tile), as before. Neither:
// the TradeDesk mark and wordmark.
//   o.logo        image src (data URL or https)
//   o.name        business name
//   o.brand       brand colour for the initial tile
//   o.powered     show "Powered by TradeDesk" at the bottom (app only, and only
//                 on a white-label screen; the client hub never passes it)
//   o.status      small status line instead of the footer ("Updating…")
//   o.cacheKey    localStorage key for the logo's look, so a repeat boot paints
//                 the right background on the very first frame
const _TD_BOOT_CSS=
'.bt-stage{position:relative;flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:0 24px;transform:translateY(-4%)}'+
'.bt-in{opacity:0;animation:bt-in .65s cubic-bezier(.45,0,.55,1) .05s forwards}'+
'.bt-logo{width:min(78vw,340px);height:min(78vw,340px);object-fit:contain;display:block}'+
'.bt-tile{width:72px;height:72px;border-radius:18px;background:linear-gradient(155deg,#2D5DA8 0%,#1E3F73 100%);display:flex;align-items:center;justify-content:center;color:#FFF1E6;font-family:Geist,sans-serif;font-weight:900;font-size:34px;letter-spacing:-1px}'+
'.bt-tile svg{width:36px;height:36px;stroke:#FFF1E6;fill:none;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}'+
'.bt-name{display:block;text-align:center;max-width:88vw;line-height:1.05;font-family:Geist,sans-serif;font-weight:900;font-size:clamp(28px,7.4vw,44px);letter-spacing:-1.4px;color:#fff}'+
'.bt-word{font-family:Geist,sans-serif;font-weight:900;font-size:44px;color:#fff;letter-spacing:-2px}'+
'.bt-tag{font-size:11px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:rgba(255,255,255,.4)}'+
'.bt-foot{position:absolute;left:0;right:0;bottom:calc(30px + env(safe-area-inset-bottom,0px));text-align:center;font-size:11px;font-weight:500;letter-spacing:.01em;opacity:0;animation:bt-fade .5s ease .5s forwards}'+
'.td-fadeout .bt-in{animation:bt-out .42s cubic-bezier(.4,0,1,1) forwards}'+
'.td-fadeout .bt-foot{animation:bt-fadeout .25s ease forwards}'+
'@keyframes bt-in{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:none}}'+
'@keyframes bt-out{from{opacity:1;transform:none}to{opacity:0;transform:scale(1.02)}}'+
'@keyframes bt-fade{to{opacity:1}}@keyframes bt-fadeout{from{opacity:1}to{opacity:0}}'+
'@media (prefers-reduced-motion:reduce){.bt-in,.bt-foot{animation:none;opacity:1}.td-fadeout .bt-in,.td-fadeout .bt-foot{animation:none;opacity:0}}';
const _TD_BOOT_DARK='radial-gradient(120% 80% at 0% 100%,rgba(45,93,168,.36) 0%,transparent 55%),linear-gradient(155deg,#1B1612 0%,#1F2230 100%)';
const _TD_WRENCH='<svg viewBox="0 0 24 24" fill="none"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>';
function tdBootFill(ov,o){
  if(!ov)return;o=o||{};
  if(!document.getElementById('td-boot-css')){
    const st=document.createElement('style');st.id='td-boot-css';st.textContent=_TD_BOOT_CSS;
    (document.head||document.documentElement).appendChild(st);
  }
  const el=(tag,cls,txt)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=txt;return e;};
  ov.textContent='';
  ov.style.display='flex';ov.style.flexDirection='column';ov.style.alignItems='center';ov.style.justifyContent='center';
  const stage=el('div','bt-stage');const inner=el('div','bt-in');
  inner.style.cssText='display:flex;flex-direction:column;align-items:center;gap:16px';
  stage.appendChild(inner);ov.appendChild(stage);
  let fg='rgba(255,255,255,.42)';
  const name=String(o.name||'').trim();
  if(o.logo){
    // Paint the cached look first; a new or changed logo is read once it decodes.
    const key=tdLogoKey(o.logo);let cached=null;
    try{cached=o.cacheKey&&JSON.parse(localStorage.getItem(o.cacheKey)||'null');}catch(e){}
    const hit=cached&&cached.k===key;
    ov.style.background=hit?cached.bg:'#000';
    if(hit){fg=cached.fg||fg;ov._tdLook=cached;}
    const img=new Image();img.className='bt-logo';img.alt='';
    if(/^https?:/i.test(o.logo))img.crossOrigin='anonymous';
    img.onload=function(){
      const look=tdLogoLook(img);if(!look)return;
      look.k=key;ov._tdLook=look;
      if(!hit){ov.style.transition='background-color .2s ease';ov.style.background=look.bg;
        const f=ov.querySelector('.bt-foot');if(f)f.style.color=look.fg;}
      try{if(o.cacheKey)localStorage.setItem(o.cacheKey,JSON.stringify(look));}catch(e){}
      try{if(typeof o.onLook==='function')o.onLook(look);}catch(e){}
    };
    img.src=o.logo;inner.appendChild(img);
  }else if(name){
    ov.style.background=_TD_BOOT_DARK;
    const tile=el('div','bt-tile',(name[0]||'').toUpperCase());
    const h=String(o.brand||'').replace('#','');
    if(/^[0-9a-fA-F]{6}$/.test(h)){
      const c=[0,2,4].map(i=>parseInt(h.substr(i,2),16)),l=c.map(v=>Math.min(255,v+70));
      tile.style.background='linear-gradient(135deg,rgb('+c+'),rgb('+l+'))';
    }
    inner.appendChild(tile);inner.appendChild(el('span','bt-name',name));
  }else{
    ov.style.background=_TD_BOOT_DARK;
    const tile=el('div','bt-tile');tile.innerHTML=_TD_WRENCH;
    inner.appendChild(tile);inner.appendChild(el('span','bt-word','TradeDesk'));
    inner.appendChild(el('div','bt-tag','Built for the trades'));
  }
  const foot=o.status?o.status:((o.powered&&(o.logo||name))?'Powered by TradeDesk':'');
  if(foot){const f=el('div','bt-foot',foot);f.style.color=fg;ov.appendChild(f);}
}
if(typeof module!=='undefined')module.exports={tdLogoLook,tdLogoKey,tdBootFill};
