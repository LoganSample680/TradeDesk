// ── Push to locate: ask one phone where it is, right now ─────────────────────
//
// THE PROBLEM IT SOLVES. The tracking engine is deliberately event-driven: a
// parked phone turns GPS off and lets iOS's region hardware watch for a
// departure (js/geo-track.js park mode). That is what killed the battery drain
// and the permanent Dynamic Island arrow, and it is the right default. The one
// thing it gives up is knowing where somebody is BETWEEN events. Crew left the
// shop at 7:40 and the customer is calling at 9:15 asking where the truck is:
// the last fence event is 95 minutes old and says nothing useful.
//
// So instead of standing surveillance we do on-demand precision. The manager
// taps Locate, that crew member's phone wakes, takes one fix, sends it back,
// and goes straight back to sleep. One burst of GPS, seconds long, on a
// question somebody actually asked.
//
// WHY THIS BEATS THE ALTERNATIVE. ServiceTitan/Jobber-style continuous GPS
// answers the same question by burning the battery all day on the 99% of
// minutes nobody asks about. This costs roughly one burst per question.
//
// NOT COVERT. Three things hold:
//   1. The crew phone only answers if that person has already accepted the
//      tracking notice (the same consent gate the engine itself uses). No
//      consent, no coordinates, and the manager is told plainly that sharing
//      is off rather than being left to guess.
//   2. The crew member SEES it happen: a toast naming who asked, every time.
//   3. Every request and answer is journaled on the crew device
//      (td_crew_locate_log) and listed in Location diagnostics, so there is a
//      record of who checked and when rather than just a toast that vanishes.
//      A crew-facing history screen is the natural next step; the record it
//      would read already exists.
//
// STAGE 1 (this file) rides Supabase Realtime, so it needs no Apple
// credentials and no migration, and it reaches any phone whose WebView is
// alive: foreground, or backgrounded recently enough that iOS has not
// suspended it. A suspended or killed app cannot hear a broadcast; that is
// Stage 2 (APNs silent push), which needs an APNs auth key and an iOS build.
// Until then a silent phone is reported honestly as silent, never as "no
// answer means they're not there".

const _CREW_LOCATE_TIMEOUT_MS = 20000;   // burstFix runs up to ~12s, plus round trip
const _CREW_LOCATE_LOG_KEY = 'td_crew_locate_log';

let _crewLocateCh = null;        // the shared per-account broadcast channel
let _crewLocateChCid = null;     // which account it belongs to
let _crewLocateWaiters = {};     // reqId -> resolve, on the manager side
let _crewLocateSeq = 0;

// The account everybody on this payroll shares. Crew and manager derive the
// same value, which is what lets one channel name reach both.
function _crewLocateCid(){
  try{
    if(typeof _isEmployee!=='undefined'&&_isEmployee)return (typeof _contractorUserId!=='undefined'&&_contractorUserId)||null;
    return (typeof _supaUser!=='undefined'&&_supaUser&&_supaUser.id)||null;
  }catch(_e){return null;}
}

function _crewLocateLog(entry){
  try{
    const log=JSON.parse(localStorage.getItem(_CREW_LOCATE_LOG_KEY)||'[]')||[];
    log.push(entry);
    if(log.length>60)log.splice(0,log.length-60);
    localStorage.setItem(_CREW_LOCATE_LOG_KEY,JSON.stringify(log));
  }catch(_e){}
}
function _crewLocateHistory(){
  try{return JSON.parse(localStorage.getItem(_CREW_LOCATE_LOG_KEY)||'[]')||[];}catch(_e){return [];}
}

// Why this device may or may not answer with coordinates. Returned to the
// manager as-is, because "sharing is off for this person" and "the phone never
// heard us" are completely different facts and a manager acts on them
// differently.
function _crewLocateAllowed(){
  try{
    if(typeof S==='undefined'||!S.teamTracking)return 'tracking-off';
    if(typeof _isEmployee!=='undefined'&&_isEmployee){
      if(typeof _geoNeedsAck==='function'&&_geoNeedsAck())return 'no-consent';
    }else{
      if(localStorage.getItem('geo_owner_consent')==='declined')return 'no-consent';
    }
    if(localStorage.getItem('td_geo_os_denied')==='1')return 'os-denied';
    return 'ok';
  }catch(_e){return 'no-consent';}
}

// ── One genuinely fresh fix ───────────────────────────────────────────────────
// Not the cached one. Inside the shell navigator.geolocation is shimmed to
// answer from the last plugin fix for up to two minutes (js/geo-track.js), which
// is right for weather and the nearby-job card and wrong here: the whole point
// of the question is "where are you NOW". So this asks the plugin for a real
// burst and waits for the fix that burst produces, via the geo engine's own
// fix subscription. In a browser (no plugin) it falls back to a plain
// high-accuracy getCurrentPosition, which is already fresh.
function _crewLocateFix(){
  return new Promise(resolve=>{
    const startedAt=Date.now();
    let done=false,unsub=null,timer=null;
    const finish=(fix)=>{
      if(done)return;done=true;
      try{if(unsub)unsub();}catch(_e){}
      clearTimeout(timer);
      resolve(fix);
    };
    try{
      if(typeof _geoOnFreshFix==='function'){
        unsub=_geoOnFreshFix(f=>{ if(f&&f.ts>=startedAt-1500)finish(f); });
      }
    }catch(_e){}
    // Native: wake the radio for a real burst. The fix comes back through the
    // plugin's event stream and lands on the subscription above.
    let burst=false;
    try{
      const Td=(typeof _geoTdPlugin==='function')?_geoTdPlugin():null;
      if(Td&&typeof Td.burstFix==='function'){Td.burstFix({seconds:10});burst=true;}
    }catch(_e){}
    // Browser (and belt-and-braces in the shell): ask the web API too. In the
    // shell this is the shim, so it may answer with a cached fix, that is fine
    // as the fallback because the burst above is what wins the race when the
    // phone can actually see sky.
    try{
      if(navigator.geolocation){
        navigator.geolocation.getCurrentPosition(
          p=>finish({lat:p.coords.latitude,lng:p.coords.longitude,acc:Math.round(p.coords.accuracy||0),ts:Date.now()}),
          ()=>{ if(!burst)finish(null); },
          {enableHighAccuracy:true,maximumAge:0,timeout:15000});
      }else if(!burst)finish(null);
    }catch(_e){ if(!burst)finish(null); }
    timer=setTimeout(()=>finish(null),16000);
  });
}

// ── Responder: this phone was asked ──────────────────────────────────────────
async function _crewLocateRespond(req){
  const me=(typeof _supaUser!=='undefined'&&_supaUser&&_supaUser.id)||null;
  if(!me||!req||!req.reqId)return;
  if(String(req.uid||'')!==String(me))return;          // not addressed to this phone
  if(String(req.by||'')===String(me))return;           // never answer yourself
  const reply={reqId:req.reqId,uid:me,ts:Date.now()};
  const gate=_crewLocateAllowed();
  if(gate!=='ok'){
    reply.ok=false;reply.reason=gate;
    _crewLocateSend('locate_ack',reply);
    _crewLocateLog({at:new Date().toISOString(),by:req.byName||'A manager',answered:false,reason:gate});
    return;
  }
  // Told, every single time, before the coordinates go anywhere.
  try{ if(typeof showToast==='function')showToast((req.byName||'Your manager')+' checked your location','📍'); }catch(_e){}
  const fix=await _crewLocateFix();
  if(!fix){
    reply.ok=false;reply.reason='no-fix';
    _crewLocateSend('locate_ack',reply);
    _crewLocateLog({at:new Date().toISOString(),by:req.byName||'A manager',answered:false,reason:'no-fix'});
    return;
  }
  reply.ok=true;reply.lat=fix.lat;reply.lng=fix.lng;reply.acc=fix.acc||0;reply.fixTs=fix.ts;
  _crewLocateSend('locate_ack',reply);
  _crewLocateLog({at:new Date().toISOString(),by:req.byName||'A manager',answered:true,lat:fix.lat,lng:fix.lng});
  // The map the manager already has reads location_pings, so the answer is
  // written there too: the fresh position survives the modal being closed and
  // becomes this person's new last-known.
  try{ if(typeof _geoWritePing==='function')_geoWritePing({lat:fix.lat,lng:fix.lng},fix.acc||0); }catch(_e){}
}

function _crewLocateSend(event,payload){
  try{ if(_crewLocateCh)_crewLocateCh.send({type:'broadcast',event,payload}); }catch(_e){}
}

// ── The shared channel ────────────────────────────────────────────────────────
// One per account, joined by everybody on it. Managers send locate_req on it
// and crew answer with locate_ack; both directions are subscribed here so a
// working owner (who is both) needs no second channel.
function _crewLocateInit(){
  const cid=_crewLocateCid();
  if(!cid)return null;
  if(typeof _supa==='undefined'||!_supa)return null;
  if(_crewLocateCh&&_crewLocateChCid===cid)return _crewLocateCh;
  _crewLocateTeardown();
  try{
    _crewLocateChCid=cid;
    _crewLocateCh=_supa.channel('td-crew-'+cid,{config:{broadcast:{self:false}}});
    _crewLocateCh
      .on('broadcast',{event:'locate_req'},msg=>{try{_crewLocateRespond(msg&&msg.payload);}catch(_e){}})
      .on('broadcast',{event:'locate_ack'},msg=>{
        const p=msg&&msg.payload;
        if(!p||!p.reqId)return;
        const w=_crewLocateWaiters[p.reqId];
        if(w){delete _crewLocateWaiters[p.reqId];w(p);}
      })
      .subscribe();
  }catch(_e){_crewLocateCh=null;_crewLocateChCid=null;}
  return _crewLocateCh;
}
function _crewLocateTeardown(){
  try{ if(_crewLocateCh&&typeof _supa!=='undefined'&&_supa&&typeof _supa.removeChannel==='function')_supa.removeChannel(_crewLocateCh); }catch(_e){}
  _crewLocateCh=null;_crewLocateChCid=null;_crewLocateWaiters={};
}

// ── Requester: the manager side ──────────────────────────────────────────────
// Resolves to {ok:true,lat,lng,acc,fixTs} on an answer, {ok:false,reason} when
// the phone answered but will not or cannot share, and {ok:false,
// reason:'timeout'} when nothing came back at all. A timeout is not evidence of
// anything: an asleep phone and a phone in a basement look identical from here,
// which is exactly what the UI is required to say.
function crewLocateRequest(uid){
  return new Promise(resolve=>{
    const ch=_crewLocateInit();
    const me=(typeof _supaUser!=='undefined'&&_supaUser&&_supaUser.id)||null;
    if(!ch||!uid||!me){resolve({ok:false,reason:'offline'});return;}
    const reqId=me.slice(0,8)+'-'+Date.now()+'-'+(++_crewLocateSeq);
    let settled=false;
    const finish=(r)=>{if(settled)return;settled=true;delete _crewLocateWaiters[reqId];resolve(r);};
    _crewLocateWaiters[reqId]=finish;
    const byName=(typeof _crewMemberName==='function'&&_crewMemberName(me))||'Your manager';
    _crewLocateSend('locate_req',{uid:String(uid),reqId,by:me,byName});
    setTimeout(()=>finish({ok:false,reason:'timeout'}),_CREW_LOCATE_TIMEOUT_MS);
  });
}

// Plain-English version of every reason code, for the manager's row.
function _crewLocateReasonText(reason){
  switch(reason){
    case 'timeout':      return 'No answer. Their phone is asleep or out of signal.';
    case 'no-fix':       return 'Phone answered but could not get a fix (indoors, or location is off).';
    case 'no-consent':   return 'They have not accepted location sharing yet.';
    case 'tracking-off': return 'Crew tracking is off for this account.';
    case 'os-denied':    return 'Location is denied in their phone settings.';
    case 'offline':      return 'You are offline, try again when you have signal.';
    default:             return 'No answer.';
  }
}
