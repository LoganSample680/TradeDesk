// ── The day map: today's work and today's people, on one screen ──────────────
//
// THE ASK (owner, 2026-08-09): "it would be nice to embed a map so you can see
// active estimates and jobs happening in your local area that day and where
// your people are, like Life360."
//
// WHAT THE COMPETITION DOES AND WHERE IT COSTS THEM. Housecall Pro's live map
// refreshes every 10 seconds and sits behind their higher tiers; Jobber
// includes real-time GPS but only from the $119 plan up; ServiceTitan sells it
// as Fleet Pro, a separate paid add-on, and markets it on catching side jobs.
// All three answer "where is everybody" by tracking everybody continuously all
// day, and the field pays for it: published figures put an eight-hour day at
// 30-40% of a phone's battery on Housecall Pro and 40-50% on ServiceTitan, and
// the standard advice to technicians is to carry a 10,000mAh brick and close
// the app at lunch. That is the actual state of the art.
//
// SO WE ANSWER THE SAME QUESTION DIFFERENTLY. This map shows each person's last
// VERIFIED position with its age stated plainly ("14 min ago"), never a smooth
// dot implying live surveillance that is not happening. When the age is not
// good enough, the manager taps Locate on that one person and gets a fresh fix
// in seconds (js/crew-locate.js). One burst, on a question somebody actually
// asked, instead of a GPS radio running all day for the 99% of minutes nobody
// asks about. Same answer, a fraction of the battery, and nobody needs a brick
// in the van.
//
// It also carries what a live-vehicle map does not: today's jobs AND today's
// estimate appointments as pins, so the manager sees the shape of the day
// (where the work is, who is near it, what is still uncovered) rather than just
// a scatter of trucks.
//
// Tiles are real Apple Maps via MapKit JS, drawn through the shared renderer in
// js/places.js so this screen and the Places territory map stay one
// implementation. MapKit tokens are domain-locked, so on localhost and in the
// offline test suite the same honest fallback plot renders instead.

const _DAY_MAP_STYLE={
  crew:     {c:'#2D5DA8', label:'Crew',      glyph:'\u25cf'},
  job:      {c:'#16A35C', label:'Jobs',      glyph:'J'},
  estimate: {c:'#5B8DEF', label:'Estimates', glyph:'E'},
  shop:     {c:'#B45309', label:'Shop',      glyph:'S'},
  drive:    {c:'#E08A1E', label:'Driving',   glyph:'\u25b2'},
  risk:     {c:'#E08A1E', label:'Uncovered', glyph:'!'},
};
// How far back the map reads, and how long a trail may get. Both are caps on a
// query that runs every time the tab opens, not tuning knobs: a contractor with
// six trucks on a busy day is the case they exist for.
const _DAY_MAP_PING_CAP=600;
const _DAY_MAP_TRAIL_CAP=120;
// Stale is not a fixed number of minutes, it is "older than the engine should
// have taken to say something." The 30-minute ping is the slowest thing that
// speaks, so past 35 a pin has genuinely gone quiet.
const _DAY_MAP_STALE_MS=35*60000;
// A job with nobody near it and its hour approaching is the only thing on this
// screen that is a PROBLEM rather than a fact, so it is the only thing that
// pulses. Within this window and no crew inside this radius: at risk.
const _DAY_MAP_RISK_SOON_MS=90*60000;
const _DAY_MAP_RISK_NEAR_FT=1500;
// How much of the map the crew sheet covers at rest. One number, read by the
// CSS max-height and by the map's own framing, so the pins are never centred
// behind the list.
const _DAY_MAP_SHEET_SHARE=0.46;
const _dayMapSt=(typeof tdMapState==='function')?tdMapState():{obj:null,host:null};
let _dayMapCrew=[];       // [{uid,name,lat,lon,ts}] as of the last load
let _dayMapLoading=false;

function _dayMapAgeText(ts){
  const ms=Date.now()-Date.parse(ts||'');
  if(!isFinite(ms))return 'unknown';
  const min=Math.round(ms/60000);
  if(min<1)return 'just now';
  if(min<60)return min+' min ago';
  const h=Math.round(min/60);
  return h+(h===1?' hour ago':' hours ago');
}

// Today's work as map points. Jobs and estimate appointments live in the same
// `jobs` array separated by eventType, which is exactly how the calendar reads
// them, so this uses the calendar's own day query rather than a second
// definition of "today".
function _dayMapWorkPoints(){
  const tk=(typeof todayKey==='function')?todayKey():'';
  const rows=(typeof getJobsOnDay==='function')?getJobsOnDay(tk):[];
  const out=[];
  rows.forEach(({job,isBuf})=>{
    if(isBuf||!job||job.eventType==='task')return;
    if(job.lat==null||job.lon==null)return;      // not geocoded yet, see _dayMapGeocode
    const cl=(typeof clients!=='undefined')?clients.find(c=>c.id===job.client_id):null;
    // When it is due, so the risk rule has an hour to compare against. A job
    // with no time on it is never "about to break", it is just today's work.
    let startMs=0;
    try{
      const t=String(job.startTime||job.time||'');
      const m=/^(\d{1,2}):(\d{2})/.exec(t);
      if(m)startMs=Date.parse(tk+'T'+('0'+m[1]).slice(-2)+':'+m[2]+':00');
    }catch(_e){}
    out.push({
      lat:job.lat,lon:job.lon,
      type:job.eventType==='estimate'?'estimate':'job',
      label:job.name||(cl&&cl.name)||'Job',
      date:(cl&&cl.name)||'',
      jobId:job.id,startMs:isFinite(startMs)?startMs:0,
    });
  });
  return out;
}

// Addresses become coordinates once and stay on the record, the same cache the
// route optimizer fills (js/cloud.js _dispatchOptimizeRoute). Nothing here
// blocks the paint: the map draws with whatever is already geocoded and
// repaints ONCE when the stragglers land, per the no-waiting-screens rule.
async function _dayMapGeocode(){
  if(typeof _resolveCoords!=='function')return false;
  const tk=(typeof todayKey==='function')?todayKey():'';
  const rows=(typeof getJobsOnDay==='function')?getJobsOnDay(tk):[];
  let filled=0;
  for(const {job,isBuf} of rows){
    if(isBuf||!job||job.eventType==='task')continue;
    if(job.lat!=null&&job.lon!=null)continue;
    const cl=(typeof clients!=='undefined')?clients.find(c=>c.id===job.client_id):null;
    const addr=job.addr||(cl&&cl.addr)||'';
    if(!addr)continue;
    try{
      const r=await _resolveCoords(addr);
      if(r&&r.lat){job.lat=r.lat;job.lon=r.lng;filled++;}
    }catch(_e){}
  }
  if(filled&&typeof saveAll==='function')saveAll();
  return filled>0;
}

// Last-known position per crew member today. Deliberately "last known", not
// "live": the tracking engine is event-driven, so between fence events there is
// nothing newer to show, and pretending otherwise is the lie the whole design
// exists to avoid. The age next to each name is the honest part.
async function _dayMapLoadCrew(){
  if(typeof supaEnabled!=='function'||!supaEnabled())return;
  if(typeof _supaUser==='undefined'||!_supaUser)return;
  const cid=(typeof _contractorUserId!=='undefined'&&_contractorUserId)||_supaUser.id;
  const since=new Date(Date.now()-12*3600000).toISOString();
  try{
    // The row says more than where now (migration 20260914): what the engine
    // believed, which job, how fast, and how much battery the reporting phone
    // has left. A row written before that migration answers null to all of it
    // and draws as a plain position, which is exactly what it was.
    const {data}=await _supa.from('location_pings')
      .select('employee_user_id,lat,lon,ts,state,dest,journey_id,speed_mph,battery')
      .eq('contractor_user_id',cid).gte('ts',since).order('ts',{ascending:false})
      .limit(_DAY_MAP_PING_CAP);
    const rows=Array.isArray(data)?data:[];
    const seen={},crew=[];
    rows.forEach(r=>{
      if(seen[r.employee_user_id])return;
      seen[r.employee_user_id]=true;
      crew.push({uid:r.employee_user_id,
        name:(typeof _crewMemberName==='function'&&_crewMemberName(r.employee_user_id))||'Crew member',
        lat:r.lat,lon:r.lon,ts:r.ts,
        state:r.state||null,dest:r.dest||null,journeyId:r.journey_id||null,
        mph:(r.speed_mph==null)?null:+r.speed_mph,
        batt:(r.battery==null)?null:+r.battery,
        sinceTs:_dayMapSince(rows,r),
        trail:_dayMapTrail(rows,r.employee_user_id,r.journey_id)});
    });
    _dayMapCrew=crew;
  }catch(_e){}
}
// How long they have been doing this, read off the pings rather than asked for.
// The crew member's own device knows the arrival exactly; the manager's phone
// only has what was reported, so this walks back while the state and the place
// both hold and takes the oldest agreeing row. It can only ever UNDER-state,
// which is the safe direction: a pin never claims more time than was reported.
function _dayMapSince(rows,cur){
  if(!cur||!cur.state||cur.state==='drive')return 0;
  let since=Date.parse(cur.ts||'');
  if(!isFinite(since))return 0;
  for(const r of rows){
    if(String(r.employee_user_id)!==String(cur.employee_user_id))continue;
    if((r.state||null)!==(cur.state||null))break;
    if(String(r.dest||'')!==String(cur.dest||''))break;
    const t=Date.parse(r.ts||'');
    if(isFinite(t)&&t<since)since=t;
  }
  // The START, not a duration, so it reads like _geoOpenDwell.sinceTs does
  // everywhere else in the app (7.3) and one clock does the subtraction.
  const ms=Date.now()-since;
  return (ms>60000&&ms<16*3600000)?since:0;
}
// THE COMET. One trail per person, and only the CURRENT journey: a line
// through the whole day joins the morning's job to the afternoon's across
// country roads nobody drove. Rows arrive newest-first, so this walks back
// through the same journey and stops at the first row that belongs to another.
// Returned oldest-first, because that is the direction a route is read.
function _dayMapTrail(rows,uid,journeyId){
  if(!journeyId)return [];
  const out=[];
  for(const r of rows){
    if(String(r.employee_user_id)!==String(uid))continue;
    if(String(r.journey_id||'')!==String(journeyId))break;
    if(!(isFinite(+r.lat)&&isFinite(+r.lon)))continue;
    out.push([+r.lat,+r.lon]);
    if(out.length>=_DAY_MAP_TRAIL_CAP)break;
  }
  return out.reverse();
}
// The trail is drawn in three stretches rather than one line, brightest at the
// head. Direction and recency then read without a single frame of animation,
// which is the whole trick: Life360 draws a dot that jumps.
function _dayMapTrailPaths(){
  const segs=[];
  _dayMapCrew.forEach(c=>{
    const t=c.trail||[];
    if(t.length<2)return;
    const cut=[[0,Math.ceil(t.length/3),0.18,3.5],
               [Math.max(0,Math.ceil(t.length/3)-1),Math.ceil(t.length*2/3),0.45,4],
               [Math.max(0,Math.ceil(t.length*2/3)-1),t.length,0.9,4.5]];
    cut.forEach(([a,b,op,w])=>{
      const part=t.slice(a,b);
      if(part.length>=2)segs.push({path:part,color:_DAY_MAP_STYLE.drive.c,opacity:op,width:w});
    });
  });
  return segs;
}

// ── At risk: the only thing on this map that is a problem ───────────────────
// Owner's own answer to what the map is for. A dot per person tells a manager
// where everyone is; it does not tell him which part of his day is about to
// break. A job whose hour is close with nobody near it does. Everything else
// on this screen is a fact; this is the one judgement, so it is the only thing
// that pulses.
function _dayMapAtRisk(p){
  try{
    if(p.type!=='job'||!p.startMs)return false;
    const due=p.startMs-Date.now();
    if(due<0||due>_DAY_MAP_RISK_SOON_MS)return false;
    return !_dayMapCrew.some(c=>{
      if(!(isFinite(+c.lat)&&isFinite(+c.lon)))return false;
      try{return _geoDistFt({lat:+c.lat,lng:+c.lon},{lat:p.lat,lng:p.lon})<=_DAY_MAP_RISK_NEAR_FT;}
      catch(_e){return false;}
    });
  }catch(_e){return false;}
}
function _dayMapInitials(name){
  const w=String(name||'').trim().split(/\s+/).filter(Boolean);
  if(!w.length)return '?';
  return ((w[0][0]||'')+(w.length>1?(w[w.length-1][0]||''):'')).toUpperCase();
}
// ── The pin ─────────────────────────────────────────────────────────────────
// One factory, rendered identically on Apple's tiles and on the fallback plot
// (js/places.js `marker`). An avatar carrying three facts at once: the ring is
// how far through the job's estimated hours they are, the arrow is heading
// while driving, the red pip is a phone about to go dark. No legend needed.
function _dayMapMarker(p){
  if(p.type==='crew'){
    const c=p.crew||{};
    const cls=c.state==='drive'?'drive':(c.state==='shop'||c.state==='place')?'shop':'';
    const stale=(Date.now()-Date.parse(c.ts||''))>_DAY_MAP_STALE_MS;
    const low=(c.batt!=null&&c.batt>=0&&c.batt<0.15);
    // A ring only when there is a real number behind it: a job with no
    // estimated hours gets a plain ring rather than an invented fraction.
    let ring='';
    if(c.pct==null&&c.state==='site'){
      // On site, with no estimated hours on the job to measure against. A full
      // ring says "on it" without inventing a fraction of a number nobody set.
      ring='<svg class="dm-prog" viewBox="0 0 46 46" aria-hidden="true">'+
        '<circle cx="23" cy="23" r="21" fill="none" stroke="'+_DAY_MAP_STYLE.job.c+'" stroke-width="3"/></svg>';
    }else if(c.pct!=null&&isFinite(c.pct)){
      const dash=Math.max(0,Math.min(1,c.pct))*132;
      ring='<svg class="dm-prog" viewBox="0 0 46 46" aria-hidden="true">'+
        '<circle cx="23" cy="23" r="21" fill="none" stroke="rgba(255,255,255,.22)" stroke-width="3"/>'+
        '<circle cx="23" cy="23" r="21" fill="none" stroke="'+_DAY_MAP_STYLE.job.c+'" stroke-width="3" '+
        'stroke-linecap="round" stroke-dasharray="132" stroke-dashoffset="'+(132-dash).toFixed(1)+'"/></svg>';
    }
    return '<div class="dm-pin'+(stale?' dm-stale':'')+'" data-dm-uid="'+escHtml(String(c.uid||''))+'">'+
      '<div class="dm-avw">'+ring+
        (c.state==='drive'?'<span class="dm-head"></span>':'')+
        '<div class="dm-av '+cls+'">'+escHtml(_dayMapInitials(c.name))+'</div>'+
        (low?'<span class="dm-batt"></span>':'')+
      '</div>'+
      '<span class="dm-tag">'+escHtml(p.date||'')+'</span>'+
    '</div>';
  }
  const risk=p.type==='job'&&p.risk;
  const col=risk?_DAY_MAP_STYLE.risk.c:(_DAY_MAP_STYLE[p.type]||_DAY_MAP_STYLE.job).c;
  return '<div class="dm-job">'+
    '<span class="dm-jw">'+(risk?'<span class="dm-pulse"></span>':'')+
      '<span class="dm-jd'+(p.type==='shop'?' dm-round':'')+'" style="background:'+col+'"></span></span>'+
    '<span class="dm-jt">'+escHtml(p.label||'')+(risk?' \u00b7 nobody near':'')+'</span>'+
  '</div>';
}
function _dayMapPoints(){
  const pts=_dayMapWorkPoints();
  if(typeof S!=='undefined'&&S.officeLat&&S.officeLon){
    pts.push({lat:S.officeLat,lon:S.officeLon,type:'shop',label:(S.bname||'Shop'),date:''});
  }
  pts.forEach(p=>{p.risk=_dayMapAtRisk(p);});
  _dayMapCrew.forEach(c=>{
    pts.push({lat:c.lat,lon:c.lon,type:'crew',label:c.name,date:_dayMapPinTag(c),uid:c.uid,crew:c});
  });
  return pts;
}
// What the pin says under the avatar. The most useful true thing, in as few
// words as fit: how fast while driving, how long on site, otherwise where.
function _dayMapPinTag(c){
  if(c.state==='drive')return (c.mph!=null&&c.mph>0)?(Math.round(c.mph)+' mph'):'Driving';
  if(c.sinceTs)return _dayMapDur(Date.now()-c.sinceTs)+' on site';
  if(c.dest)return c.dest;
  return _dayMapAgeText(c.ts);
}
// The app's own minute formatter (_fmtMin, js/jobs.js), guarded with typeof
// rather than a bare truthiness check: an undeclared identifier throws a
// ReferenceError, which is how the first cut of this took the whole map down.
function _dayMapDur(ms){
  const m=Math.max(0,Math.round((+ms||0)/60000));
  try{if(typeof _fmtMin==='function')return _fmtMin(m);}catch(_e){}
  const h=Math.floor(m/60);
  return (h?h+'h ':'')+(m%60)+'m';
}

// ── The Dispatch → Map tab ───────────────────────────────────────────────────
// Dark, full-bleed, with the crew sheet floating over it. The map is the
// screen rather than a box with a list underneath, which is the difference
// between a dispatch board and a settings page with a picture on it.
function renderDayMap(){
  const body=document.getElementById('_dispatch-body');
  if(!body)return;
  const pts=_dayMapPoints();

  body.innerHTML=
    '<div class="dm-wrap">'+
      '<div id="_day-map-body" class="dm-map"></div>'+
      '<div class="dm-sheet">'+
        '<div class="dm-sheet-top"><div class="dm-grab"></div>'+
          '<div class="dm-shd"><span class="dm-t" id="_day-map-count"></span>'+
          '<span class="dm-live"><span class="dm-dot"></span>Live</span></div>'+
        '</div>'+
        '<div id="_day-map-crew" class="dm-sheet-body"></div>'+
      '</div>'+
    '</div>';

  const mapBody=document.getElementById('_day-map-body');
  if(!pts.length){
    mapBody.innerHTML='<div class="dm-empty">'+
      'Nothing to map today. Jobs and estimate appointments show up here once they have an address, '+
      'and crew appear once someone is sharing location.</div>';
  }else if(typeof tdMapRender==='function'){
    // Apple tiles only on Apple hardware: this screen is dispatch plus crew
    // locations, which Apple's licence puts off limits on non-Apple hardware
    // (see tdAppleHardware in js/places.js). Everywhere else the plot renders,
    // which uses none of Apple's data. Dark and the marker factory are honoured
    // by BOTH, so the screen looks the same either way.
    const allowKit=(typeof tdAppleHardware==='function')?tdAppleHardware():false;
    tdMapRender({body:mapBody,pts,style:_DAY_MAP_STYLE,st:_dayMapSt,hostId:'_day-map-canvas',
      height:_dayMapHeight(),allowKit,dark:true,hidePOI:true,hideHint:true,
      padBottom:Math.round(_dayMapHeight()*_DAY_MAP_SHEET_SHARE)+24,
      marker:_dayMapMarker,paths:_dayMapTrailPaths()});
  }
  const cEl=document.getElementById('_day-map-count');
  if(cEl)cEl.textContent=_dayMapCrew.length
    ? (_dayMapCrew.length+(_dayMapCrew.length===1?' on the clock':' on the clock'))
    : 'Nobody on the clock';
  _dayMapCrewStrip();
  _dayMapWatch();
}
// The map fills what is left under the page chrome, with room for the sheet's
// resting height. Measured rather than assumed, so a taller phone gets a taller
// map instead of a fixed 300px box in the middle of the screen.
function _dayMapHeight(){
  try{
    const b=document.getElementById('_dispatch-body');
    const top=b?b.getBoundingClientRect().top:220;
    return Math.max(280,Math.round((window.innerHeight||760)-top-8));
  }catch(_e){return 420;}
}

// ── The crew sheet ──────────────────────────────────────────────────────────
// Every row states what the person is doing, how long, how old the position is
// and what the reporting phone has left. The rail under the name is the day so
// far, straight off the deriver. This is where "Life360" becomes honest: a
// stale pin says so in amber, and Locate is right there when that is not good
// enough.
function _dayMapCrewStrip(){
  const el=document.getElementById('_day-map-crew');
  if(!el)return;
  if(!_dayMapCrew.length){
    el.innerHTML='<div class="dm-none">'+((typeof S!=='undefined'&&S.teamTracking)
      ?'No crew positions today yet. They appear once someone is sharing location.'
      :'Crew tracking is off. Turn it on in Settings to see where your people are.')+'</div>';
    return;
  }
  el.innerHTML=_dayMapCrew.map(c=>{
    const stale=(Date.now()-Date.parse(c.ts||''))>_DAY_MAP_STALE_MS;
    const chip=c.state==='drive'?['drive','Driving']
      :c.state==='site'?['site','On site']
      :c.state==='shop'?['shop','At the shop']
      :c.state==='place'?['shop','At a saved place']
      :['shop','Last seen'];
    const cls=c.state==='drive'?'drive':(c.state==='shop'||c.state==='place')?'shop':'';
    const sub=[c.dest||'',c.sinceTs?_dayMapDur(Date.now()-c.sinceTs):''].filter(Boolean).join(' \u00b7 ');
    const batt=(c.batt!=null&&c.batt>=0)
      ? '<span class="dm-b'+(c.batt<0.15?' low':'')+'"><span class="dm-bx"><span class="dm-bf" style="width:'+
        Math.max(1,Math.round(c.batt*9))+'px"></span></span>'+Math.round(c.batt*100)+'%</span>'
      : '';
    return '<div class="dm-row" id="_dm-crew-'+escHtml(String(c.uid))+'">'+
      '<div class="dm-ra '+cls+'" onclick="_dayMapFocus(\''+escHtml(String(c.uid))+'\')">'+escHtml(_dayMapInitials(c.name))+'</div>'+
      '<div class="dm-rb" onclick="_dayMapFocus(\''+escHtml(String(c.uid))+'\')">'+
        '<div class="dm-n"><b>'+escHtml(c.name)+'</b><span class="dm-chip '+chip[0]+'">'+chip[1]+'</span></div>'+
        (sub?'<div class="dm-sub">'+escHtml(sub)+'</div>':'')+
        _dayMapRailHtml(c.uid)+
      '</div>'+
      '<div class="dm-rc">'+
        '<span class="_dm-when dm-age'+(stale?' old':'')+'">'+escHtml((stale?'Last seen ':'')+_dayMapAgeText(c.ts))+'</span>'+
        batt+
        '<button class="_dm-locate dm-loc" onclick="_dayMapLocate(\''+escHtml(String(c.uid))+'\')">Locate</button>'+
      '</div>'+
    '</div>';
  }).join('')+
    // SAID ONCE, and it is the sentence that separates this from a fleet
    // tracker: what is on screen is the last position each phone reported, not
    // a live trail, and Locate is how you get a current one. It moved from
    // under the map to the foot of the crew list when the sheet took over the
    // bottom of the screen; it has not stopped being said.
    '<div class="dm-fine">Crew pins are each phone\'s last reported position, not a live trail. '+
    'Tap Locate for a fresh one.</div>';
}
// ── The day so far, as a 5px strip ──────────────────────────────────────────
// The deriver already decided what every stretch of today was; this draws it.
// Nobody else in the category can, because nobody else has a deriver. Read
// through the Time Log's own rows so there is one answer in the app to what
// somebody did today, never a second walk over the same data (§17).
function _dayMapRailHtml(uid){
  let rows=[];
  // _timeLogRows is the Time Log's own reader and it is allowed to be absent,
  // to throw, or to hand back something that is not an array. The rail is a
  // nicety; it must never be able to take the crew list down with it.
  try{const r=(typeof _timeLogRows==='function')?_timeLogRows():null;rows=Array.isArray(r)?r:[];}
  catch(_e){return '';}
  if(!rows.length)return '';
  const tk=(typeof todayKey==='function')?todayKey():'';
  const mine=rows.filter(r=>r&&r.date===tk&&String(r.personUid||'')===String(uid)&&r.startTime&&r.endTime);
  if(!mine.length)return '';
  const base=Date.parse(tk+'T00:00:00');
  const win=(typeof _geoWorkHours==='function')?_geoWorkHours():{start:'06:00',end:'20:00'};
  const hm=v=>{const m=/^(\d{1,2}):(\d{2})$/.exec(String(v||''));return m?(+m[1]*60+ +m[2])*60000:NaN;};
  const a=base+hm(win.start),b=Math.min(base+hm(win.end),Date.now());
  if(!(isFinite(a)&&isFinite(b)&&b>a))return '';
  const span=b-a;
  const seg=[];
  mine.sort((x,y)=>Date.parse(x.startTime)-Date.parse(y.startTime)).forEach(r=>{
    const s=Math.max(a,Date.parse(r.startTime)),e=Math.min(b,Date.parse(r.endTime));
    if(!(e>s))return;
    const k=r.rawSource==='drive'?'dr':(r.rawSource==='place-shop'||r.source==='shop')?'sh':'st';
    seg.push({k,l:((s-a)/span)*100,w:((e-s)/span)*100});
  });
  if(!seg.length)return '';
  return '<div class="dm-rail">'+seg.map(g=>
    '<i class="'+g.k+'" style="left:'+g.l.toFixed(2)+'%;width:'+Math.max(0.6,g.w).toFixed(2)+'%"></i>').join('')+'</div>';
}

// ── Live, without polling ───────────────────────────────────────────────────
// location_pings is in the realtime publication as of migration 20260914, so a
// pin can move the moment a truck reports instead of when somebody reopens the
// tab. RLS ("Contractor reads team location") is what makes this managers-only,
// so the channel needs no gate of its own. One channel, torn down and rebuilt
// only when the account changes, never one per render.
let _dayMapChan=null,_dayMapChanCid=null,_dayMapPaint=null;
function _dayMapWatch(){
  try{
    if(typeof supaEnabled!=='function'||!supaEnabled())return;
    if(typeof _supa==='undefined'||!_supa||typeof _supa.channel!=='function')return;
    if(typeof _supaUser==='undefined'||!_supaUser)return;
    const cid=(typeof _contractorUserId!=='undefined'&&_contractorUserId)||_supaUser.id;
    if(_dayMapChan&&_dayMapChanCid===cid)return;
    _dayMapUnwatch();
    _dayMapChanCid=cid;
    _dayMapChan=_supa.channel('dm-'+cid)
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'location_pings',
        filter:'contractor_user_id=eq.'+cid},()=>{
        // Coalesced: six trucks reporting at once is one repaint, not six.
        clearTimeout(_dayMapPaint);
        _dayMapPaint=setTimeout(()=>{
          if(typeof _dispatchView==='undefined'||_dispatchView!=='map')return;
          _dayMapLoadCrew().then(()=>{
            if(typeof _dispatchView!=='undefined'&&_dispatchView==='map')renderDayMap();
          },()=>{});
        },900);
      })
      .subscribe();
  }catch(_e){}
}
function _dayMapUnwatch(){
  try{
    clearTimeout(_dayMapPaint);
    if(_dayMapChan&&typeof _supa!=='undefined'&&_supa&&typeof _supa.removeChannel==='function'){
      _supa.removeChannel(_dayMapChan);
    }
  }catch(_e){}
  _dayMapChan=null;_dayMapChanCid=null;
}

function _dayMapFocus(uid){
  const c=_dayMapCrew.find(x=>String(x.uid)===String(uid));
  if(!c||!_dayMapSt.obj)return;
  try{
    _dayMapSt.obj.setCenterAnimated(new mapkit.Coordinate(c.lat,c.lon),true);
  }catch(_e){}
}

// Push to locate, from the map. On an answer the pin moves and the age resets
// to "just now"; on anything else the row says what actually happened rather
// than leaving a stale timestamp to be misread as current.
async function _dayMapLocate(uid){
  const row=document.getElementById('_dm-crew-'+uid);
  const btn=row&&row.querySelector('._dm-locate');
  const when=row&&row.querySelector('._dm-when');
  if(btn){btn.disabled=true;btn.textContent='Asking…';btn.style.opacity='.6';}
  if(when)when.textContent='Waking their phone…';
  let res={ok:false,reason:'offline'};
  try{ if(typeof crewLocateRequest==='function')res=await crewLocateRequest(uid); }catch(_e){}
  if(btn){btn.disabled=false;btn.innerHTML=svgIcon('📡')+' Locate';btn.style.opacity='';}
  if(res&&res.ok){
    const c=_dayMapCrew.find(x=>String(x.uid)===String(uid));
    if(c){c.lat=res.lat;c.lon=res.lng;c.ts=new Date(res.fixTs||Date.now()).toISOString();}
    renderDayMap();
    _dayMapFocus(uid);
  }else if(when){
    when.textContent=(typeof _crewLocateReasonText==='function')?_crewLocateReasonText(res&&res.reason):'No answer.';
  }
}

// Entry point from the Dispatch tab bar. Paints immediately with whatever is
// known, then fills in crew positions and any missing geocodes and repaints
// once, never a spinner in front of a map (CLAUDE.md 8.3).
function openDayMap(){
  renderDayMap();
  if(_dayMapLoading)return;
  _dayMapLoading=true;
  Promise.all([
    _dayMapLoadCrew().catch(()=>{}),
    _dayMapGeocode().catch(()=>false),
  ]).then(()=>{
    _dayMapLoading=false;
    if(typeof _dispatchView!=='undefined'&&_dispatchView==='map')renderDayMap();
  },()=>{_dayMapLoading=false;});
}
