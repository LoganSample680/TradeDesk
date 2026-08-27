// ── Shadow tracking engine: the event-driven candidate, running alongside ────
//
// Owner call (2026-08-09): "we need to run this side by side." This file is the
// Home Assistant shaped engine (region monitoring + significant change + iOS
// visit reports + motion-coprocessor history + short GPS bursts) running in
// PARALLEL with the live continuous-GPS engine in js/geo-track.js.
//
// THE ONE RULE: this file never writes a real record. No job_time_entries, no
// mileage rows, no cloud tables. Everything it concludes goes to its own local
// journal (localStorage), so the live engine keeps owning payroll and the IRS
// log for the whole evaluation. If the shadow is wrong, nothing is harmed; if
// it is right, we can prove it before flipping anything.
//
// What we compare, and why those metrics:
//   • arrivals/departures : does it see the same visits, at better timestamps?
//   • legs                : does it produce the same drives between the same
//                           endpoints?
//   • gpsOnMs             : the ONLY battery number attributable per engine
//                           while both run at once (a phone reports one battery
//                           level, so percent alone cannot be split between
//                           them). Seconds of radio time drive the drain.
//   • wakes               : how often each engine woke the app at all.

const _GEO_SHADOW_KEY='td_geo_shadow';
const _GEO_SHADOW_CAP=400;          // journal entries kept on device
let _shadowOn=false;
let _shadowLog=[];
try{_shadowLog=JSON.parse(localStorage.getItem(_GEO_SHADOW_KEY)||'[]')||[];}catch(_e){}

// The live engine's radio time is measured HERE rather than natively, because
// the continuous watcher belongs to a different plugin: JS is the only place
// that knows when it was running.
let _liveGpsSinceMs=null;
let _liveGpsOnMs=0;
try{_liveGpsOnMs=+(localStorage.getItem('td_geo_live_gps_ms')||0)||0;}catch(_e){}
function _shadowLiveGpsStart(){ if(_liveGpsSinceMs==null)_liveGpsSinceMs=Date.now(); }
function _shadowLiveGpsStop(){
  if(_liveGpsSinceMs==null)return;
  _liveGpsOnMs+=Date.now()-_liveGpsSinceMs;
  _liveGpsSinceMs=null;
  try{localStorage.setItem('td_geo_live_gps_ms',String(Math.round(_liveGpsOnMs)));}catch(_e){}
}
function _shadowLiveGpsMs(){
  return Math.round(_liveGpsOnMs+(_liveGpsSinceMs!=null?(Date.now()-_liveGpsSinceMs):0));
}

function _shadowNote(kind,data){
  try{
    _shadowLog.push(Object.assign({k:kind,t:new Date().toISOString()},data||{}));
    if(_shadowLog.length>_GEO_SHADOW_CAP)_shadowLog.splice(0,_shadowLog.length-_GEO_SHADOW_CAP);
    localStorage.setItem(_GEO_SHADOW_KEY,JSON.stringify(_shadowLog));
  }catch(_e){}
}
function _shadowClear(){
  _shadowLog=[];_liveGpsOnMs=0;_liveGpsSinceMs=null;
  // Reset counters means reset counters: with the armed signature left
  // standing, the next start would recognise it, skip, and journal nothing,
  // so a freshly cleared log would sit empty looking like a dead engine.
  _shadowArmedSig=null;_shadowArmedCount=0;
  try{
    localStorage.removeItem(_GEO_SHADOW_KEY);
    localStorage.removeItem('td_geo_live_gps_ms');
  }catch(_e){}
  const Td=(typeof _geoTdPlugin==='function')?_geoTdPlugin():null;
  try{if(Td&&typeof Td.stats==='function')Td.stats({reset:true});}catch(_e){}
}

// ── The regions the shadow engine watches ────────────────────────────────────
// iOS monitors at most 20 at once, so the set is rebuilt from what actually
// matters today: the shop, today's jobs, saved places, and the clients with
// work on. Re-picked on every wake, which is exactly how a phone that moves
// across a county keeps useful fences.
function _shadowRegions(){
  const out=[];
  const push=(id,lat,lng,radius)=>{
    if(lat==null||lng==null)return;
    if(out.some(r=>r.id===id))return;
    out.push({id,lat:+lat,lng:+lng,radius:radius||200});
  };
  try{
    if(S.officeLat&&S.officeLon)push('shop',S.officeLat,S.officeLon,240);
    const fenceM=(typeof _geoFenceFt==='function')?_geoFenceFt()*0.3048:180;
    const tk=(typeof todayKey==='function')?todayKey():null;
    (typeof jobs!=='undefined'?jobs:[]).forEach(j=>{
      if(tk&&j.start&&j.start>tk)return;
      const c=(typeof _geoJobCoordsPeek==='function')?_geoJobCoordsPeek(j):null;
      const lat=(c&&c.lat)!=null?c.lat:j.lat, lng=(c&&c.lng)!=null?c.lng:j.lon;
      push('job:'+j.id,lat,lng,Math.max(120,fenceM));
    });
    (typeof getPlaces==='function'?getPlaces():[]).forEach(p=>push('place:'+p.id,p.lat,p.lon,Math.max(120,fenceM)));
  }catch(_e){}
  return out.slice(0,18);
}

// ── Start / stop ─────────────────────────────────────────────────────────────
function shadowEngineOn(){return _shadowOn;}
// What is armed right now, so a re-arm that would change nothing can be
// skipped and a re-arm that would make things WORSE can be refused.
let _shadowArmedSig=null;
let _shadowArmedCount=0;
// True once this account's own records are in memory. An empty jobs AND
// places pair is not a contractor with nothing on the books, it is a boot
// that has not finished loading yet.
function _shadowHasData(){
  try{
    if(typeof jobs!=='undefined'&&Array.isArray(jobs)&&jobs.length)return true;
    const pl=(typeof getPlaces==='function')?getPlaces():null;
    if(Array.isArray(pl)&&pl.length)return true;
  }catch(_e){}
  return false;
}
async function startShadowEngine(){
  const Td=(typeof _geoTdPlugin==='function')?_geoTdPlugin():null;
  // No plugin means no engine, and it must SAY so: a stale `on` flag from an
  // earlier session would have the comparison screen claiming a running engine
  // that cannot possibly be collecting anything.
  if(!Td||typeof Td.startEvents!=='function'){_shadowOn=false;return false;}
  const regions=_shadowRegions();
  const sig=regions.map(r=>r.id).slice().sort().join('|');
  // ── DON'T LET A COLD BOOT DISARM THE FENCES (owner journal, 2026-08-25) ──
  // This runs every time the location watcher starts, which on the owner's
  // phone was 12 times in one morning, and it arms from whatever happens to
  // be in memory at that instant. His journal caught the consequence exactly:
  //
  //   15:23  engine on · 18 fences
  //   16:20  engine on · 18 fences
  //   16:23  engine on ·  1 fences     <- a start before the account loaded
  //   16:47  engine on ·  3 fences
  //
  // and it never climbed back, because nothing ever re-armed with the full
  // set again. Three fences instead of eighteen is why so many of his stops
  // had no fence to trip and fell back on iOS visit reports, which is the
  // slow path the backdate fix above exists to survive.
  //
  // A genuinely smaller set is legitimate (a job finished, a place deleted),
  // so this refuses a SHRINK only while the account's own arrays are still
  // empty, which is the one case that is never a real change.
  if(_shadowArmedSig!==null&&regions.length<_shadowArmedCount&&!_shadowHasData()){
    _shadowNote('arm-skip',{had:_shadowArmedCount,would:regions.length});
    return _shadowOn;
  }
  // Nothing changed: no native call, no journal line. Re-arming an identical
  // region set is a no-op natively, and journalling it buried the engine's
  // ACTUAL conclusions (the whole point of this log) under hundreds of
  // "engine on" lines: 400-entry ring, and the owner's copy of it came back
  // with barely seventy real visits in it.
  if(_shadowArmedSig===sig&&_shadowOn){
    if(typeof _geoNativeWatcherId!=='undefined'&&_geoNativeWatcherId!=null)_shadowLiveGpsStart();
    return true;
  }
  try{
    const r=await Td.startEvents({regions});
    _shadowOn=true;
    _shadowArmedSig=sig;_shadowArmedCount=regions.length;
    _shadowNote('start',{armed:(r&&r.armed)||0,visits:!!(r&&r.visits)});
    // The live engine keeps its own watcher; note when it is running so its
    // radio seconds can be tallied against the shadow's bursts.
    if(typeof _geoNativeWatcherId!=='undefined'&&_geoNativeWatcherId!=null)_shadowLiveGpsStart();
    return true;
  }catch(e){_shadowNote('start-fail',{err:String(e&&e.message||e)});return false;}
}
function stopShadowEngine(){
  _shadowOn=false;_shadowLiveGpsStop();
  // Forget what was armed: the next start must actually re-arm rather than
  // recognise its own stale signature and skip.
  _shadowArmedSig=null;_shadowArmedCount=0;
  _shadowNote('stop');
}

// ── Event intake ─────────────────────────────────────────────────────────────
// Fed from the SAME native stream the live engine drains (js/geo-track.js
// _geoTdEvent calls this), so both engines see identical raw input and any
// difference in output is genuinely the engine, not the sensor.
let _shadowHere=null;        // last place the shadow engine believes we are
let _shadowLegOpenAt=null;   // ISO when the shadow's current drive began
let _shadowLegFrom=null;
function _shadowNameFor(lat,lng){
  // Reuses the live engine's own resolvers so a naming difference can never
  // masquerade as an engine difference.
  try{
    if(typeof placeAt==='function'){
      const p=placeAt({lat,lon:lng});
      if(p)return p.name||'Place';
    }
    if(typeof _geoClientAt==='function'){
      const c=_geoClientAt({lat,lng});
      if(c)return c.name||'Client';
    }
    if(S.officeLat&&S.officeLon&&typeof _geoDistFt==='function'&&
       _geoDistFt({lat,lng},{lat:S.officeLat,lng:S.officeLon})<=((typeof _geoFenceFt==='function')?_geoFenceFt():600))return 'Shop';
  }catch(_e){}
  return 'Stop';
}
async function shadowIngest(ev){
  if(!_shadowOn||!ev||typeof ev!=='object')return;
  try{
    // A VISIT is the headline: iOS already knows when they arrived and left.
    if(ev.type==='visit'){
      const name=_shadowNameFor(ev.lat,ev.lng);
      _shadowNote('visit',{
        name,
        arrived:ev.arrivalTs?new Date(ev.arrivalTs).toISOString():null,
        departed:ev.departureTs?new Date(ev.departureTs).toISOString():null,
        mins:(ev.arrivalTs&&ev.departureTs)?Math.round((ev.departureTs-ev.arrivalTs)/60000):null,
        lat:ev.lat,lng:ev.lng
      });
      // A departure closes the shadow's leg origin: they left here, so the
      // next arrival is a drive FROM here.
      if(ev.departureTs){_shadowLegFrom={name,lat:ev.lat,lng:ev.lng};_shadowLegOpenAt=new Date(ev.departureTs).toISOString();}
      return;
    }
    if(ev.type==='regionEnter'||ev.type==='regionExit'){
      const name=(ev.lat!=null)?_shadowNameFor(ev.lat,ev.lng):(ev.regionId||'region');
      // Precise coordinates, briefly, then dark again. The MOMENT comes from
      // the motion coprocessor below, never from this burst.
      const Td=(typeof _geoTdPlugin==='function')?_geoTdPlugin():null;
      try{if(Td&&typeof Td.burstFix==='function')Td.burstFix({seconds:12});}catch(_e){}
      if(ev.type==='regionExit'){
        const moved=await _shadowDriveStart(ev.ts);
        _shadowLegFrom={name,lat:ev.lat,lng:ev.lng};
        _shadowLegOpenAt=moved||new Date(ev.ts||Date.now()).toISOString();
        _shadowNote('depart',{name,at:_shadowLegOpenAt,src:moved?'motion':'region'});
      }else{
        const at=new Date(ev.ts||Date.now()).toISOString();
        if(_shadowLegFrom&&_shadowLegOpenAt){
          _shadowNote('leg',{from:_shadowLegFrom.name,to:name,
            start:_shadowLegOpenAt,end:at,
            mins:Math.max(0,Math.round((Date.parse(at)-Date.parse(_shadowLegOpenAt))/60000))});
        }
        _shadowNote('arrive',{name,at});
        _shadowLegFrom=null;_shadowLegOpenAt=null;
        _shadowHere=name;
      }
      return;
    }
  }catch(_e){}
}
// Ask the coprocessor when driving actually began, so a late geofence exit is
// still stamped at the real moment. Returns an ISO string, or null when the
// permission is off or nothing conclusive is on record.
async function _shadowDriveStart(aroundMs){
  const Td=(typeof _geoTdPlugin==='function')?_geoTdPlugin():null;
  if(!Td||typeof Td.motionSince!=='function')return null;
  try{
    const since=(aroundMs||Date.now())-60*60*1000;
    const r=await Td.motionSince({sinceMs:since});
    if(!r||!r.available||!Array.isArray(r.transitions))return null;
    const drives=r.transitions.filter(t=>t.kind==='driving');
    if(!drives.length)return null;
    return new Date(drives[drives.length-1].ts).toISOString();
  }catch(_e){return null;}
}

// ── The comparison screen ────────────────────────────────────────────────────
// ── Clock ────────────────────────────────────────────────────────────────────
// Timestamps STORE as ISO (UTC, sortable) and DISPLAY on the BUSINESS clock,
// the same one every other screen now reads (bizTz, js/utils.js). This panel
// used to build its own from getHours(), which is the device's zone: correct
// while the owner is home, an hour out the moment they travel, and it would
// have made a copied journal disagree with the Time Log it is meant to be
// compared against. 24-hour is kept exactly as it was, only the zone is now
// pinned. (Supersedes the 2026-08-10 "device local central time" ask, which
// was asking for Central rather than the UTC it showed then.)
function _shadowTz(){
  try{ if(typeof bizTz==='function')return bizTz(); }catch(_e){}
  try{ return Intl.DateTimeFormat().resolvedOptions().timeZone; }catch(_e){}
  return undefined;
}
function _shadowHM(iso){
  if(!iso)return '';
  const d=iso instanceof Date?iso:new Date(iso);
  if(isNaN(d.getTime()))return '';
  const o={hour:'2-digit',minute:'2-digit',hourCycle:'h23'};
  const tz=_shadowTz(); if(tz)o.timeZone=tz;
  try{return d.toLocaleTimeString('en-GB',o);}catch(_e){
    return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  }
}
// The copy carries the DATE too. On screen the rows are read top-down in one
// sitting so the day is obvious; pasted into a message, a bare 20:45 sitting
// under an 04:36 is unreadable.
function _shadowStamp(iso){
  if(!iso)return '';
  const d=iso instanceof Date?iso:new Date(iso);
  if(isNaN(d.getTime()))return '';
  const o={month:'2-digit',day:'2-digit'};
  const tz=_shadowTz(); if(tz)o.timeZone=tz;
  let day='';
  try{day=d.toLocaleDateString('en-US',o);}catch(_e){day='';}
  return (day?day+' ':'')+_shadowHM(iso);
}
// One journal entry as a line. `stamp` decides whether it carries the date,
// so the panel and the copy can never describe the same entry differently.
function _shadowLine(e,stamp){
  const t=stamp?_shadowStamp(e.t):_shadowHM(e.t);
  if(e.k==='visit')return t+'  visit \u00b7 '+(e.name||'')+(e.mins!=null?(' \u00b7 '+e.mins+' min'):'')+(e.arrived?(' \u00b7 in '+_shadowHM(e.arrived)):'')+(e.departed?(' out '+_shadowHM(e.departed)):'');
  if(e.k==='leg')return t+'  leg \u00b7 '+e.from+' \u2192 '+e.to+' \u00b7 '+e.mins+' min';
  if(e.k==='arrive')return t+'  arrive \u00b7 '+e.name;
  if(e.k==='depart')return t+'  depart \u00b7 '+e.name+' ('+(e.src||'')+')';
  if(e.k==='start')return t+'  engine on \u00b7 '+(e.armed||0)+' fences'+(e.visits?' + visits':'');
  return t+'  '+e.k+(e.err?(' \u00b7 '+e.err):'');
}
// Copy, for the same reason the location diagnostics panel has one: the owner
// reads this in a truck and pastes it into a message. The screen shows the
// most recent 40 entries because that is what fits; the COPY carries the whole
// journal, which is the entire point of getting it off the phone.
function _shadowCopy(){
  if(typeof _geoCopyText==='function')_geoCopyText(window.__shadowDiagText||'');
}
async function _shadowPanel(){
  if(document.getElementById('_geo-shadow-ov'))return;
  const Td=(typeof _geoTdPlugin==='function')?_geoTdPlugin():null;
  let st={};
  try{if(Td&&typeof Td.stats==='function')st=await Td.stats()||{};}catch(_e){}
  const liveMs=_shadowLiveGpsMs();
  const shadowMs=Math.round(+st.gpsOnMs||0);
  const fmtMs=ms=>{
    const s=Math.round(ms/1000);
    if(s<90)return s+'s';
    const m=Math.round(s/60);
    return m<90?m+' min':(Math.floor(m/60)+'h '+(m%60)+'m');
  };
  const wakes=st.wakes||{};
  const wakeStr=Object.keys(wakes).length?Object.keys(wakes).map(k=>k+' '+wakes[k]).join(' · '):'none yet';
  const batt=(+st.batteryLevel>=0)?Math.round(st.batteryLevel*100)+'%'+(st.charging?' (charging)':''):'unknown';
  // Only the shadow's OWN conclusions, newest first. Timestamps STORE as ISO
  // (UTC, sortable) but DISPLAY in the device's local time (owner 2026-08-10:
  // "engine comparison is forcing UTC, I want device local central time").
  const rows=_shadowLog.slice().reverse().slice(0,40).map(e=>_shadowLine(e,false)).join('\n');
  const ov=document.createElement('div');ov.id='_geo-shadow-ov';ov.className='zmodal-overlay';
  const m=document.createElement('div');m.className='zmodal';m.style.maxWidth='560px';
  const col=(label,val,sub)=>'<div style="flex:1"><div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--text3)">'+label+'</div>'+
    '<div style="font-size:19px;font-weight:800;letter-spacing:-.3px">'+val+'</div>'+
    (sub?'<div style="font-size:11px;color:var(--text3)">'+sub+'</div>':'')+'</div>';
  m.innerHTML=
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">'+
      '<div style="font-size:16px;font-weight:800">Engine comparison</div>'+
      '<button onclick="document.getElementById(\'_geo-shadow-ov\').remove()" style="border:none;background:none;font-size:20px;cursor:pointer;color:var(--text3)">✕</button></div>'+
    '<div style="font-size:11px;color:var(--text3);line-height:1.5;margin-bottom:12px">GPS radio time is the only battery number that can be split between two engines running at once. Lower is cheaper.</div>'+
    '<div style="display:flex;gap:12px;padding:12px 0;border-top:1px solid var(--border);border-bottom:1px solid var(--border);margin-bottom:10px">'+
      col('Current engine',fmtMs(liveMs),'continuous GPS')+
      col('New engine',fmtMs(shadowMs),'bursts only')+
    '</div>'+
    '<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0"><span style="color:var(--text3)">Shadow engine</span><span style="font-weight:700">'+(_shadowOn?'running':'off')+'</span></div>'+
    '<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0"><span style="color:var(--text3)">Wakes</span><span style="font-weight:700">'+escHtml(wakeStr)+'</span></div>'+
    '<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0"><span style="color:var(--text3)">Fences armed</span><span style="font-weight:700">'+(st.monitoredRegions!=null?st.monitoredRegions:'?')+'</span></div>'+
    '<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0"><span style="color:var(--text3)">Motion history</span><span style="font-weight:700">'+(st.motionAvailable?'available':'off')+'</span></div>'+
    '<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:1px solid var(--border)"><span style="color:var(--text3)">Battery</span><span style="font-weight:700">'+batt+'</span></div>'+
    '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin:12px 0 4px">What the new engine concluded</div>'+
    '<div style="max-height:34vh;overflow-y:auto;font-size:11px;font-family:ui-monospace,monospace;line-height:1.6;white-space:pre-wrap">'+
      (rows?escHtml(rows):'<span style="color:var(--text3)">Nothing yet. Drive somewhere and come back.</span>')+'</div>'+
    // Same shape the location diagnostics panel uses (js/geo-track.js
    // _geoDiagPanel): Copy full width on its own line, so the destructive
    // Reset is never the button beside it that a thumb finds first.
    '<button class="btn" style="width:100%;margin-top:14px;padding:12px" onclick="_shadowCopy()">Copy everything</button>'+
    '<div style="display:flex;gap:8px;margin-top:8px">'+
      '<button class="btn" style="flex:1;padding:11px" onclick="_shadowClear();document.getElementById(\'_geo-shadow-ov\').remove();_shadowPanel()">Reset counters</button>'+
      '<button class="btn btn-p" style="flex:1;padding:11px" onclick="document.getElementById(\'_geo-shadow-ov\').remove()">Close</button>'+
    '</div>';
  // Built from the SAME values the panel just rendered, and the same line
  // builder, so a pasted log can never disagree with the screen it came off.
  // The journal goes out WHOLE (the panel shows the newest 40 that fit).
  const _all=_shadowLog.slice().reverse();
  window.__shadowDiagText=[
    'Engine comparison \u00b7 '+_shadowStamp(new Date().toISOString()),
    'Times: '+(_shadowTz()||'device'),
    '',
    'Current engine: '+fmtMs(liveMs)+' (continuous GPS)',
    'New engine: '+fmtMs(shadowMs)+' (bursts only)',
    'Shadow engine: '+(_shadowOn?'running':'off'),
    'Wakes: '+wakeStr,
    'Fences armed: '+(st.monitoredRegions!=null?st.monitoredRegions:'?'),
    'Motion history: '+(st.motionAvailable?'available':'off'),
    'Battery: '+batt,
    '',
    'What the new engine concluded ('+_all.length+' entries)',
    (_all.length?_all.map(e=>_shadowLine(e,true)).join('\n'):'Nothing yet.')
  ].join('\n');
  ov.appendChild(m);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
}
