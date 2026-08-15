// ── Milestones + Easter eggs ─────────────────────────────────────────────────
// Owner ask 2026-08-15: "badass retention and some sick Easter eggs."
//
// The retention half is not a gimmick. A contractor's 100th job, first $100K
// year, or 10,000th tracked mile are real facts about their business that
// NOBODY tells them: the money apps show a balance, the CRMs show a pipeline,
// and none of them ever say "you built something." TradeDesk already holds
// every number needed to know, so the app can be the one thing in their life
// that notices. Fires ONCE ever per milestone, recorded in S so it syncs
// across their devices and can never re-fire on a reinstall.
//
// Rules this obeys, because a celebration that interrupts work is a bug:
//   - Dashboard only, never over a form, a signature, or a live drive.
//   - One per session, queued if two land together. Never a pile-up.
//   - Dismissable with a tap anywhere, and it never blocks a second time.
//   - Fully inert under prefers-reduced-motion (the card still shows, the
//     confetti does not).

const _MILESTONES=[
  // key, test(stats) -> bool, title, line. Ordered biggest-first so the most
  // impressive one wins when several land on the same render.
  {k:'rev1m',   t:s=>s.revenue>=1000000, big:'$1,000,000', sub:'lifetime revenue',
   line:'A seven-figure trade business. Whatever anyone told you this work was worth, they were wrong.'},
  {k:'rev500k', t:s=>s.revenue>=500000,  big:'$500,000',  sub:'lifetime revenue',
   line:'Half a million dollars of work, tracked, invoiced, and collected by you.'},
  {k:'rev250k', t:s=>s.revenue>=250000,  big:'$250,000',  sub:'lifetime revenue',
   line:'Quarter million. That is not a side job anymore.'},
  {k:'rev100k', t:s=>s.revenue>=100000,  big:'$100,000',  sub:'lifetime revenue',
   line:'Six figures through the door. Most trades never log it, so most never see this moment.'},
  {k:'jobs500', t:s=>s.jobs>=500, big:'500', sub:'jobs completed',
   line:'Five hundred jobs finished. Every one of them somebody who needed the work done right.'},
  {k:'jobs100', t:s=>s.jobs>=100, big:'100', sub:'jobs completed',
   line:'One hundred jobs. That is a real business, and the receipts are all right here.'},
  {k:'jobs50',  t:s=>s.jobs>=50,  big:'50',  sub:'jobs completed',
   line:'Fifty jobs done. The reputation part is working.'},
  {k:'mi25k',   t:s=>s.miles>=25000, big:'25,000', sub:'business miles logged',
   line:'Twenty-five thousand deductible miles, every one of them documented the way an auditor wants.'},
  {k:'mi10k',   t:s=>s.miles>=10000, big:'10,000', sub:'business miles logged',
   line:'Ten thousand miles tracked automatically. That is real money back that most contractors leave on the road.'},
  {k:'signed50',t:s=>s.signed>=50, big:'50', sub:'proposals signed',
   line:'Fifty signatures. People keep saying yes to you.'},
  {k:'signed10',t:s=>s.signed>=10, big:'10', sub:'proposals signed',
   line:'Ten signed proposals. The e-sign flow is doing its job.'},
];

function _msStats(){
  const num=v=>typeof v==='number'&&isFinite(v)?v:0;
  let revenue=0,jobsDone=0,miles=0,signed=0;
  try{
    revenue=(typeof payments!=='undefined'?payments:[]).filter(p=>p&&p.amount>0).reduce((s,p)=>s+num(p.amount),0)+
            (typeof income!=='undefined'?income:[]).filter(r=>r&&r.amount>0).reduce((s,r)=>s+num(r.amount),0);
    jobsDone=(typeof jobs!=='undefined'?jobs:[]).filter(j=>j&&(j.status==='done'||j.completion_date)).length;
    miles=(typeof deductibleTrips==='function'?deductibleTrips(mileage):(typeof mileage!=='undefined'?mileage:[]))
      .reduce((s,m)=>s+num(m&&m.miles),0);
    signed=(typeof bids!=='undefined'?bids:[]).filter(b=>b&&(b.status==='Closed Won'||b.signedAt||b.signature)).length;
  }catch(_e){}
  return {revenue,jobs:jobsDone,miles,signed};
}

function _msHit(){try{return (S&&S.milestonesHit)||{};}catch(_e){return {};}}
function _msMark(k){
  try{
    S.milestonesHit=S.milestonesHit||{};
    S.milestonesHit[k]=new Date().toISOString();
    S.settingsTs=Date.now();
    if(typeof saveAll==='function')saveAll();
  }catch(_e){}
}

// Called from renderDash. Cheap: four reduces over arrays already in memory.
function checkMilestones(){
  try{
    if(window._msShowing||window._msFiredThisSession)return;
    const d=document.getElementById('pg-dash');
    if(!d||!d.classList.contains('active'))return;          // dashboard only
    if(document.querySelector('.zmodal-overlay,#export-panel,#vv-panel'))return;  // never over a modal
    if(window._bootSyncPending&&!window._bootSkelDone)return; // not mid-boot
    const hit=_msHit(),st=_msStats();
    const won=_MILESTONES.find(m=>!hit[m.k]&&m.t(st));
    if(!won)return;
    // FIRST RUN GUARD: an existing account importing years of history would
    // otherwise fire a celebration for a milestone it passed long ago. The
    // first check on a fresh device records everything already true WITHOUT
    // celebrating, so only genuinely NEW achievements ever pop.
    if(!S.milestonesHit){
      const seed={};
      _MILESTONES.forEach(m=>{if(m.t(st))seed[m.k]=new Date().toISOString();});
      S.milestonesHit=seed;S.settingsTs=Date.now();
      if(typeof saveAll==='function')saveAll();
      return;
    }
    window._msFiredThisSession=true;
    _msCelebrate(won);
  }catch(_e){}
}

function _msStyles(){
  if(document.getElementById('_ms-style'))return;
  const s=document.createElement('style');s.id='_ms-style';
  s.textContent=
    '@keyframes msPop{0%{opacity:0;transform:scale(.86) translateY(18px)}70%{transform:scale(1.02) translateY(-2px)}100%{opacity:1;transform:scale(1) translateY(0)}}'+
    '@keyframes msFall{from{transform:translateY(-12vh) rotate(0);opacity:1}to{transform:translateY(112vh) rotate(720deg);opacity:.9}}'+
    '@keyframes msGlow{0%,100%{opacity:.35}50%{opacity:.7}}'+
    '.ms-box{animation:msPop .5s cubic-bezier(.22,1,.36,1) both}'+
    '.ms-confetti{position:fixed;top:0;width:9px;height:14px;border-radius:2px;pointer-events:none;z-index:10000;'+
      'animation:msFall linear forwards}'+
    '.ms-halo{position:absolute;inset:-40%;background:radial-gradient(circle,rgba(255,214,102,.55),transparent 62%);'+
      'animation:msGlow 2.4s ease-in-out infinite;pointer-events:none}'+
    '@media (prefers-reduced-motion:reduce){.ms-box{animation:none}.ms-confetti{display:none}.ms-halo{animation:none}}';
  document.head.appendChild(s);
}

function _msConfetti(n){
  try{
    if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion:reduce)').matches)return;
    const cols=['#F5C451','#2FA463','#4A83D6','#E8724C','#FFFFFF','#F0B429'];
    for(let i=0;i<(n||70);i++){
      const c=document.createElement('div');
      c.className='ms-confetti';
      c.style.left=Math.random()*100+'vw';
      c.style.background=cols[i%cols.length];
      c.style.animationDuration=(2.2+Math.random()*1.9)+'s';
      c.style.animationDelay=(Math.random()*.85)+'s';
      c.style.opacity=String(.75+Math.random()*.25);
      document.body.appendChild(c);
      setTimeout(()=>{try{c.remove();}catch(_e){}},5200);
    }
  }catch(_e){}
}

function _msCelebrate(m){
  _msStyles();
  window._msShowing=true;
  _msMark(m.k);
  const ov=document.createElement('div');
  ov.id='ms-overlay';
  ov.style.cssText='position:fixed;inset:0;z-index:9999;background:rgba(8,14,26,.78);display:flex;align-items:center;justify-content:center;padding:24px;animation:fadein .2s';
  ov.innerHTML=
    '<div class="ms-box" style="position:relative;background:linear-gradient(150deg,#132542,#0C1729);border:1px solid rgba(245,196,81,.35);border-radius:20px;padding:30px 24px 26px;max-width:400px;width:100%;text-align:center;overflow:hidden">'+
      '<div class="ms-halo"></div>'+
      '<div style="position:relative">'+
        '<div style="font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#F5C451;margin-bottom:14px">Milestone</div>'+
        '<div style="font-size:52px;font-weight:900;color:#fff;letter-spacing:-2px;line-height:1;font-variant-numeric:tabular-nums">'+m.big+'</div>'+
        '<div style="font-size:13px;font-weight:700;color:rgba(255,255,255,.66);margin-top:6px;text-transform:uppercase;letter-spacing:.06em">'+m.sub+'</div>'+
        '<div style="font-size:14px;color:rgba(255,255,255,.9);line-height:1.55;margin:18px 4px 22px">'+escHtml(m.line)+'</div>'+
        '<button class="btn btn-p" onclick="_msClose()" style="width:100%;padding:13px;font-size:15px;font-weight:800">Back to work</button>'+
      '</div>'+
    '</div>';
  document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)_msClose();});
  _msConfetti(80);
  try{if(typeof _hapticSuccess==='function')_hapticSuccess();}catch(_e){}
}
function _msClose(){
  try{document.getElementById('ms-overlay')?.remove();}catch(_e){}
  window._msShowing=false;
}

// ── Easter eggs ──────────────────────────────────────────────────────────────
// Rules: never in the way, never destructive, always reversible, and never
// fires while the contractor is doing something that matters.

// 1. BLUEPRINT MODE. Seven taps on the wrench logo. The app goes to
// white-on-blue drafting paper until you tap it off again. It is the one
// theme a trade app has earned the right to have.
function _eggBlueprintStyles(){
  if(document.getElementById('_egg-bp-style'))return;
  const s=document.createElement('style');s.id='_egg-bp-style';
  s.textContent=
    'body.td-blueprint{background:#0E3A6B!important}'+
    'body.td-blueprint .pg,body.td-blueprint .card,body.td-blueprint .td-dw{'+
      'background-image:linear-gradient(rgba(255,255,255,.07) 1px,transparent 1px),'+
      'linear-gradient(90deg,rgba(255,255,255,.07) 1px,transparent 1px);background-size:22px 22px}'+
    '@keyframes eggSpin{to{transform:rotate(360deg)}}'+
    '.egg-spin{animation:eggSpin .7s cubic-bezier(.22,1,.36,1)}';
  document.head.appendChild(s);
}
function _eggLogoTap(){
  try{
    window._eggTaps=(window._eggTaps||0)+1;
    clearTimeout(window._eggTapT);
    window._eggTapT=setTimeout(()=>{window._eggTaps=0;},1600);
    if(window._eggTaps<7)return;
    window._eggTaps=0;
    _eggBlueprintStyles();
    const on=document.body.classList.toggle('td-blueprint');
    const logo=document.querySelector('.tbar-logo,#dash-logo,.brand-logo');
    if(logo){logo.classList.remove('egg-spin');void logo.offsetWidth;logo.classList.add('egg-spin');}
    if(typeof showToast==='function')showToast(on?'Blueprint mode. Tap the logo seven times to go back.':'Back to normal.','📐');
    try{S.blueprintMode=on;S.settingsTs=Date.now();if(typeof saveAll==='function')saveAll();}catch(_e){}
  }catch(_e){}
}

// 2. THE COMPETITOR SEARCH. Type a rival's name into global search and get one
// dry result. The whole product thesis is out-executing them on UX; this is
// the only place the app is allowed to say so out loud.
const _EGG_RIVALS=/^(servicetitan|service titan|jobber|housecall|housecall pro|quoteiq|dripjobs|fieldpulse|joist|buildertrend|workiz|jobnimbus|acculynx)$/i;
function _eggRivalResult(q){
  if(!_EGG_RIVALS.test(String(q||'').trim()))return '';
  return '<div class="search-result" style="border-left:3px solid var(--blue);padding:12px 14px">'+
    '<div style="font-size:13px;font-weight:800;color:var(--text)">Not found</div>'+
    '<div style="font-size:12px;color:var(--text3);margin-top:3px">You are already using the better one.</div>'+
  '</div>';
}

// 3. FRIDAY CLOSING TIME. After 4pm on a Friday with nothing left on the
// board, the greeting changes once. Not a popup, not a sound, just the app
// noticing the week is done.
function _eggGreetingSuffix(){
  try{
    const now=new Date();
    if(now.getDay()!==5||now.getHours()<16)return '';
    const openToday=(typeof jobs!=='undefined'?jobs:[]).some(j=>j&&j.start===todayKey()&&j.status!=='done'&&!j.completion_date);
    if(openToday)return '';
    return ' Go home.';
  }catch(_e){return '';}
}

// Blueprint mode survives a reload: it is a preference once chosen, not a
// per-session gag, and an egg that vanishes on refresh feels broken.
try{
  if(typeof S!=='undefined'&&S&&S.blueprintMode){_eggBlueprintStyles();document.body.classList.add('td-blueprint');}
  else{
    document.addEventListener('DOMContentLoaded',()=>{
      try{if(S&&S.blueprintMode){_eggBlueprintStyles();document.body.classList.add('td-blueprint');}}catch(_e){}
    });
  }
}catch(_e){}
