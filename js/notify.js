// ── Local notifications (owner 2026-08-11) ───────────────────────────────────
// Scheduled ON the phone, so there is no server, no push certificate, no cost
// per message, and they still fire with no signal. Three jobs:
//
//   1. Tomorrow's work      the night-before reminder of the first job
//   2. Money owed           an invoice that quietly went past due
//   3. Arrival              the tap-back from Apple Maps, since iOS gives no
//                           app any way to bring itself forward on arrival
//
// EVERY rule is here, in JS, so the whole reminder system is tunable without
// another iOS build (CLAUDE.md 3.2). The native side only schedules and
// cancels what it is told.
//
// Permission is NOT requested on boot. A notification prompt on first launch,
// before the app has ever done anything useful, is how an app gets denied
// forever. It is asked the first time a reminder would actually be useful.

function _notifyPlugin(){
  try{
    const cap=window.Capacitor;
    if(!cap||typeof cap.isNativePlatform!=='function'||!cap.isNativePlatform())return null;
    if(typeof cap.registerPlugin==='function')return cap.registerPlugin('TdNotify');
    return (cap.Plugins&&cap.Plugins.TdNotify)||null;
  }catch(_e){return null;}
}

async function _notifyPermission(){
  const P=_notifyPlugin();
  if(!P||typeof P.permission!=='function')return 'unsupported';
  try{const r=await P.permission();return (r&&r.status)||'unknown';}catch(_e){return 'unknown';}
}

// Asks once, and remembers that it asked: iOS only ever shows the system
// prompt one time, so a second request silently resolves denied and would
// otherwise look like a bug.
async function _notifyAsk(){
  const P=_notifyPlugin();
  if(!P||typeof P.request!=='function')return false;
  const cur=await _notifyPermission();
  if(cur==='granted')return true;
  if(cur==='denied')return false;
  try{
    const r=await P.request();
    return !!(r&&r.granted);
  }catch(_e){return false;}
}

async function _notifySchedule(id,title,body,atMs){
  const P=_notifyPlugin();
  if(!P||typeof P.schedule!=='function')return false;
  if(await _notifyPermission()!=='granted')return false;
  try{await P.schedule({id,title,body,atMs:atMs||0});return true;}catch(_e){return false;}
}

async function _notifyCancel(ids){
  const P=_notifyPlugin();
  if(!P||typeof P.cancel!=='function')return;
  try{await P.cancel(ids&&ids.length?{ids}:{});}catch(_e){}
}

// ── The arrival tap-back ─────────────────────────────────────────────────────
// Apple Maps cannot hand control back to us on arrival (no API exists, for
// any app). A notification the driver taps is the sanctioned equivalent, and
// it is fired by the geofence engine the moment it sees us reach the site.
function _notifyArrival(clientName,jobLabel){
  const who=String(clientName||'the job site').slice(0,40);
  return _notifySchedule(
    'arrive:'+who,
    'You made it to '+who,
    jobLabel?('Tap to clock in for '+String(jobLabel).slice(0,60)):'Tap to clock in and start tracking time.',
    0
  );
}

// ── Tomorrow's first job ─────────────────────────────────────────────────────
// One notification, the evening before, naming the first job and its time.
// Not one per job: a crew with five stops does not want five buzzes, they
// want to know when to set the alarm.
function _notifyTomorrowJobs(now){
  const base=now?new Date(now):new Date();
  const d=new Date(base.getFullYear(),base.getMonth(),base.getDate()+1);
  const key=dateKey(d);   // the shared LOCAL day key (§7.3), never a hand-rolled one
  const list=(typeof jobs!=='undefined'&&Array.isArray(jobs))?jobs:[];
  const mine=list.filter(j=>j&&j.status!=='canceled'&&j.status!=='done'&&String(j.start||'').slice(0,10)===key);
  if(!mine.length)return null;
  // Earliest start wins the headline; jobs without a time sort last.
  mine.sort((a,b)=>String(a.time||'99:99').localeCompare(String(b.time||'99:99')));
  const first=mine[0];
  const when=first.time?(' at '+_notifyPrettyTime(first.time)):'';
  const rest=mine.length>1?(' (+'+(mine.length-1)+' more)'):'';
  // 7pm the evening before: late enough that the day's changes are in, early
  // enough to still act on it.
  const at=new Date(base.getFullYear(),base.getMonth(),base.getDate(),19,0,0,0).getTime();
  return {
    id:'tomorrow:'+key,
    title:'Tomorrow: '+String(first.name||'first job').slice(0,40)+when,
    body:mine.length+' job'+(mine.length>1?'s':'')+' scheduled'+rest,
    atMs:at
  };
}
function _notifyPrettyTime(hhmm){
  const m=String(hhmm||'').match(/^(\d{1,2}):(\d{2})/);
  if(!m)return String(hhmm||'');
  let h=+m[1];const min=m[2];
  const ap=h>=12?'pm':'am';
  h=h%12;if(h===0)h=12;
  return h+(min==='00'?'':':'+min)+ap;
}

// ── Money that went past due ─────────────────────────────────────────────────
// One reminder covering everything owed, not one per invoice: the contractor
// wants "go chase your money", not a notification storm.
function _notifyOverdue(now){
  const nowMs=now||Date.now();
  const list=(typeof bids!=='undefined'&&Array.isArray(bids))?bids:[];
  let owed=0,count=0,oldest=null;
  list.forEach(b=>{
    if(!b||b.status!=='Closed Won'||b.clientCancelled)return;
    const bal=(typeof getBidBalance==='function')?getBidBalance(b):0;
    if(!(bal>0.01))return;
    // 14 days past completion is "late" for trade work, and the completion
    // date is the honest clock: an invoice sent late is not the client's fault.
    const done=b.completion_date?Date.parse(b.completion_date):null;
    if(!done||isNaN(done))return;
    const days=Math.floor((nowMs-done)/86400000);
    if(days<14)return;
    owed+=bal;count++;
    if(oldest==null||days>oldest)oldest=days;
  });
  if(!count)return null;
  const money=(typeof fmt==='function')?fmt(owed):('$'+owed.toFixed(2));
  return {
    // dateKey, NOT toISOString: the id is a LOCAL day stamp, and a UTC one
    // rolls over at 7pm Central, which would fire this a second time the same
    // evening. (Caught by the standing UTC-key guard in
    // e2e-utils-exhaustive; the same class of bug as the UTC clock times the
    // owner reported on 2026-08-10.)
    id:'overdue:'+dateKey(new Date(nowMs)),
    title:money+' still owed',
    body:count+' job'+(count>1?'s':'')+' past due, the oldest by '+oldest+' days. Tap to chase it.',
    atMs:0
  };
}

// The single entry point the app calls. Silent and cheap when there is no
// plugin, no permission, or nothing worth saying.
async function _notifyRefresh(now){
  const P=_notifyPlugin();
  if(!P)return {scheduled:0};
  if(await _notifyPermission()!=='granted')return {scheduled:0};
  let scheduled=0;
  const t=_notifyTomorrowJobs(now);
  if(t&&t.atMs>(now||Date.now())){
    if(await _notifySchedule(t.id,t.title,t.body,t.atMs))scheduled++;
  }
  const o=_notifyOverdue(now);
  if(o){
    // Once a day at most: the id carries today's date, and re-scheduling the
    // same id replaces rather than stacks.
    if(await _notifySchedule(o.id,o.title,o.body,0))scheduled++;
  }
  return {scheduled};
}
