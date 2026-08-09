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
  crew:     {c:'#7C3AED', label:'Crew',      glyph:'●'},
  job:      {c:'#0E6B39', label:'Jobs',      glyph:'J'},
  estimate: {c:'#2D5DA8', label:'Estimates', glyph:'E'},
  shop:     {c:'#B45309', label:'Shop',      glyph:'S'},
};
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
    out.push({
      lat:job.lat,lon:job.lon,
      type:job.eventType==='estimate'?'estimate':'job',
      label:job.name||(cl&&cl.name)||'Job',
      date:(cl&&cl.name)||'',
      jobId:job.id,
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
  _dayMapCrew=[];
  if(typeof supaEnabled!=='function'||!supaEnabled())return;
  if(typeof _supaUser==='undefined'||!_supaUser)return;
  const cid=(typeof _contractorUserId!=='undefined'&&_contractorUserId)||_supaUser.id;
  const since=new Date(Date.now()-12*3600000).toISOString();
  try{
    const {data}=await _supa.from('location_pings').select('employee_user_id,lat,lon,ts')
      .eq('contractor_user_id',cid).gte('ts',since).order('ts',{ascending:false});
    const seen={};
    (data||[]).forEach(r=>{
      if(seen[r.employee_user_id])return;
      seen[r.employee_user_id]=true;
      _dayMapCrew.push({uid:r.employee_user_id,
        name:(typeof _crewMemberName==='function'&&_crewMemberName(r.employee_user_id))||'Crew member',
        lat:r.lat,lon:r.lon,ts:r.ts});
    });
  }catch(_e){}
}

function _dayMapPoints(){
  const pts=_dayMapWorkPoints();
  if(typeof S!=='undefined'&&S.officeLat&&S.officeLon){
    pts.push({lat:S.officeLat,lon:S.officeLon,type:'shop',label:(S.bname||'Shop'),date:''});
  }
  _dayMapCrew.forEach(c=>{
    pts.push({lat:c.lat,lon:c.lon,type:'crew',label:c.name,date:_dayMapAgeText(c.ts),uid:c.uid});
  });
  return pts;
}

// ── The Dispatch → Map tab ───────────────────────────────────────────────────
function renderDayMap(){
  const body=document.getElementById('_dispatch-body');
  if(!body)return;
  const pts=_dayMapPoints();
  const counts={};
  Object.keys(_DAY_MAP_STYLE).forEach(t=>{counts[t]=pts.filter(p=>p.type===t).length;});
  const legend=Object.keys(_DAY_MAP_STYLE).filter(t=>counts[t]).map(t=>{
    const s=_DAY_MAP_STYLE[t];
    return '<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;color:var(--text3)">'+
      '<span style="width:8px;height:10px;border-radius:50% 50% 50% 50%/60% 60% 40% 40%;background:'+s.c+'"></span>'+s.label+' '+counts[t]+'</span>';
  }).join('<span style="width:12px;display:inline-block"></span>');

  body.innerHTML=
    '<div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-bottom:8px">'+legend+'</div>'+
    '<div id="_day-map-body"></div>'+
    '<div id="_day-map-crew" style="margin-top:12px"></div>';

  const mapBody=document.getElementById('_day-map-body');
  if(!pts.length){
    mapBody.innerHTML='<div style="padding:22px 4px;font-size:13px;color:var(--text3);line-height:1.6">'+
      'Nothing to map today. Jobs and estimate appointments show up here once they have an address, and crew appear once they are sharing location.'+
      '</div>';
  }else if(typeof tdMapRender==='function'){
    // Apple tiles only on Apple hardware: this screen is dispatch plus crew
    // locations, which Apple's licence puts off limits on non-Apple hardware
    // (see tdAppleHardware in js/places.js). Everywhere else the plot renders,
    // which uses none of Apple's data.
    const allowKit=(typeof tdAppleHardware==='function')?tdAppleHardware():false;
    tdMapRender({body:mapBody,pts,style:_DAY_MAP_STYLE,st:_dayMapSt,hostId:'_day-map-canvas',height:300,
      allowKit,
      hint:'Tap a pin for details, then the arrow for directions.'});
  }
  // Said once, outside the map, so it survives the tiles-or-fallback split.
  // This sentence is the whole difference between us and a fleet tracker: what
  // is on screen is the last position each phone actually reported, not a live
  // trail, and Locate is how you get a current one.
  if(_dayMapCrew.length){
    const note=document.createElement('div');
    note.style.cssText='font-size:10px;color:var(--text3);line-height:1.6;margin-top:8px';
    note.textContent="Crew pins are each phone's last reported position, not a live trail. Tap Locate for a fresh one.";
    mapBody.appendChild(note);
  }
  _dayMapCrewStrip();
}

// The crew strip under the map. This is where "Life360" becomes honest: every
// row states how old the position is, and Locate is right there when that is
// not good enough. Tapping the name recentres the map on that person.
function _dayMapCrewStrip(){
  const el=document.getElementById('_day-map-crew');
  if(!el)return;
  if(!_dayMapCrew.length){
    el.innerHTML=(typeof S!=='undefined'&&S.teamTracking)
      ?'<div style="font-size:12px;color:var(--text3);line-height:1.6">No crew positions today yet. They appear once someone is sharing location.</div>'
      :'<div style="font-size:12px;color:var(--text3);line-height:1.6">Crew tracking is off. Turn it on in Settings to see where your people are.</div>';
    return;
  }
  el.innerHTML=_dayMapCrew.map(c=>
    '<div id="_dm-crew-'+escHtml(c.uid)+'" style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 10px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);margin-bottom:6px">'+
      '<div style="min-width:0;cursor:pointer" onclick="_dayMapFocus(\''+escHtml(c.uid)+'\')">'+
        '<div style="font-size:13px;font-weight:700">'+escHtml(c.name)+'</div>'+
        '<div class="_dm-when" style="font-size:11px;color:var(--text3)">'+svgIcon('📍')+' '+escHtml(_dayMapAgeText(c.ts))+'</div>'+
      '</div>'+
      '<button class="_dm-locate" onclick="_dayMapLocate(\''+escHtml(c.uid)+'\')" style="flex-shrink:0;font-size:11px;font-weight:700;background:var(--bg);color:var(--text);border:1px solid var(--border2);border-radius:var(--r);padding:6px 10px;cursor:pointer;font-family:inherit">'+svgIcon('📡')+' Locate</button>'+
    '</div>').join('');
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
