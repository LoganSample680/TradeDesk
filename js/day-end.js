// ── The day that ended on its own (owner 2026-09-02) ─────────────────────────
//
// Jack starts a manual timer at his home office in the morning and drives
// out. Tonight the truck came back to that fence at 7:40 and the timer was
// still running at 8:39: 12h 55m on the meter, 5 of them real. The phone
// knew the whole time: the drive home ended inside the home-office fence
// and nothing moved for twenty minutes.
//
// Owner, on the rule: "the auto clock out rule is tough though cause what if
// his day isn't done? Rather do we fire a notification that says Hey (user
// first name)! Looks like your day ended at 7:40 pm, tap to confirm then
// that tap clocks him out at 7:40?" So: the phone PROPOSES, the person
// confirms, nothing moves on its own. The proposal is a local notification
// (the nudge) and a card on the Home page (the answer), because a tapped
// notification only opens the app; the card is what the tap lands on.
//
// The clock-out time is the ARRIVAL at the home office, not the moment of
// the tap: the shift began when the timer started at home, so it ends when
// the truck is back at home, drive included, both ways.
//
// The mirror in the morning: timer not running, the truck left the home
// office and arrived at a saved work place. "Looks like you started at
// 7:44 AM. Tap to clock in." Clock-in time is the departure flip.
//
// Only for people who use the manual clock (an entry of theirs in the last
// two weeks). Someone tracked by GPS alone has automatic rows and never
// needs to be asked.
//
// Everything here is JS (CLAUDE.md 3.2): the wait, the copy, the hours.

const _DAY_END_STILL_MS=20*60000;   // parked at the home office this long after the last drive
const _DAY_END_NUDGE2_HOUR=21;      // a second nudge at 9 pm if it is still open
const _DAY_END_KEY='zp3_day_end';
const _DAY_END_ARR_KEY='zp3_day_end_arr';   // {dayKey:{ms,name}}: the last home-office arrival the deriver saw, per day
const _DAY_END_IDS=['dayend','dayend2','daystart'];

function _dayEndRead(){
  try{const o=JSON.parse(localStorage.getItem(_DAY_END_KEY)||'null');return (o&&typeof o==='object'&&o.kind)?o:null;}catch(_e){return null;}
}
function _dayEndWrite(o){
  try{if(o)localStorage.setItem(_DAY_END_KEY,JSON.stringify(o));else localStorage.removeItem(_DAY_END_KEY);}catch(_e){}
}
function _dayEndFirstName(){
  try{
    const{loggedByName}=_tlLoggedByInfo();
    const n=String(loggedByName||'').trim().split(/\s+/)[0]||'';
    return (/^(owner|crew)$/i.test(n)||/\(/.test(n))?'':n;
  }catch(_e){return '';}
}
function _dayEndFmt(ms){
  try{return bizTime(new Date(Number(ms)).toISOString());}catch(_e){}
  try{return new Date(Number(ms)).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});}catch(_e){return '';}
}
// The open manual entry that is MINE (the same identity rule the boot
// rehydrate uses, js/jobs.js _rehydrateActiveTimer).
function _dayEndOpenEntry(){
  try{
    const{loggedByUid}=_tlLoggedByInfo();
    return (Array.isArray(timeEntries)?timeEntries:[]).find(e=>e&&e.open&&(e.logged_by_uid||null)===loggedByUid)||null;
  }catch(_e){return null;}
}
function _dayEndUsesClock(){
  try{
    const{loggedByUid}=_tlLoggedByInfo();
    const cut=Date.now()-14*86400000;
    return (Array.isArray(timeEntries)?timeEntries:[]).some(e=>e&&(e.logged_by_uid||null)===loggedByUid&&Date.parse(e.start_time||'')>=cut);
  }catch(_e){return false;}
}
function _dayEndHasEntryToday(){
  try{
    const{loggedByUid}=_tlLoggedByInfo();
    const today=todayKey();
    return (Array.isArray(timeEntries)?timeEntries:[]).some(e=>e&&(e.logged_by_uid||null)===loggedByUid&&e.date===today);
  }catch(_e){return false;}
}
// h o'clock today in the BUSINESS timezone (the phone's own zone is not the
// contractor's when they travel, and never in CI).
function _dayEndNudgeAt(h){
  try{
    const b=_geoDayBounds(_geoDayKeyOf(Date.now(),_geoBizTz()));
    if(b&&b.start>0)return b.start+h*3600000;
  }catch(_e){}
  const d=new Date();d.setHours(h,0,0,0);return d.getTime();
}

function _dayEndTodayKey(){try{return _geoDayKeyOf(Date.now(),_geoBizTz());}catch(_e){return todayKey();}}
function _dayEndTodayStart(){try{const b=_geoDayBounds(_dayEndTodayKey());return (b&&b.start>0)?b.start:NaN;}catch(_e){return NaN;}}
// "7:40 PM", or "7:40 PM yesterday" when the instant is not today: the same
// clock-out time reads as a different fact the morning after.
function _dayEndWhen(ms){
  const t=_dayEndFmt(ms);
  try{
    const k=_geoDayKeyOf(Number(ms),_geoBizTz()),today=_dayEndTodayKey();
    if(k===today)return t;
    const b=_geoDayBounds(today);
    if(b&&_geoDayKeyOf(b.start-3600000,_geoBizTz())===k)return t+' yesterday';
    return t+' '+new Date(Number(ms)).toLocaleDateString('en-US',{timeZone:_geoBizTz(),weekday:'short'});
  }catch(_e){return t;}
}

// ── The clock that crossed midnight (owner 2026-09-03) ──────────────────────
// Jack's 7:44 AM clock was still open at 7 AM the next day, 23 hours on the
// meter. The evening proposal needs a drive TODAY, and his last drive was
// yesterday, so the morning after it had nothing to say, and once he drove
// again that morning the house looked like a fresh arrival. Owner: "before he
// has the ability to clock in he needs to clock out and it show his 7:40 pm
// proposal time, should carry over today." So every derived day notes its
// last home-office arrival, and an entry that started before today is ended
// at the last such arrival before today, whatever today's drives do.
function _dayEndArrRead(){
  try{const o=JSON.parse(localStorage.getItem(_DAY_END_ARR_KEY)||'null');return (o&&typeof o==='object'&&!Array.isArray(o))?o:{};}catch(_e){return {};}
}
// Called for EVERY derived day (js/geo-track.js, the boot rebuild covers a
// week). Returns true when it just produced a new proposal for a stale clock.
function _dayEndNoteDay(dayKey,res){
  try{
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(dayKey||'')))return false;
    const legs=(res&&Array.isArray(res.legs))?res.legs:[];
    let best=null;
    for(const l of legs){
      if(l&&l.to&&String(l.to.kind)==='home_office'&&Number(l.endTs)>0&&(!best||Number(l.endTs)>best.ms))best={ms:Number(l.endTs),name:String(l.to.name||'')};
    }
    const o=res&&res.open;
    if(o&&String(o.kind)==='home_office'&&Number(o.sinceTs)>0&&(!best||Number(o.sinceTs)>best.ms))best={ms:Number(o.sinceTs),name:String(o.name||'')};
    const m=_dayEndArrRead();
    if(best)m[dayKey]=best;else delete m[dayKey];
    const keys=Object.keys(m).sort();
    while(keys.length>8)delete m[keys.shift()];
    try{localStorage.setItem(_DAY_END_ARR_KEY,JSON.stringify(m));}catch(_e){}
    _dayEndSnapClockIn(dayKey,res);
    return _dayEndStale()==='new';
  }catch(_e){return false;}
}
// THE CLOCK-IN MOVES BACK TO THE ARRIVAL (owner 2026-09-04: "08/31 his manual
// clock in should edit itself to his shop time arrival").
//
// His 31 August: the shop row starts 07:50, when the truck stopped at his
// dad's, and his hand-typed clock-in says 07:55. Five minutes of him standing
// in the yard, off the clock, because tapping the button is not the thing that
// starts a day. His rule for whose day starts when is already settled: "for a
// employee its the arrival to the first saved geo fence that begins the day."
// So the fence is right and the tap is late, and the tap is what moves.
//
// BACKWARDS ONLY, and never forwards. An arrival AFTER the clock-in would mean
// he claimed time before he got anywhere, and pulling his start forward would
// be the app deleting hours he entered by hand. That is a conversation, not an
// edit, and it is what the unaccounted row is for.
//
// A NOTE ON A RULE THIS BENDS. js/day-end.js otherwise proposes and waits:
// "the phone PROPOSES, the person confirms, nothing moves on its own" (owner
// 2026-09-02, on the auto clock-OUT). This edits without asking, because the
// owner asked for it in those words and because the two cases are not alike: a
// clock-out guesses that a day is over and can be wrong about the future,
// while an arrival that already happened is a fact, and moving to it only ever
// gives time back. The edit is stamped like any other (edited_at, edited_by)
// so the change is visible on the entry rather than silent.
function _dayEndSnapClockIn(dayKey,res){
  try{
    if(typeof timeEntries==='undefined'||!Array.isArray(timeEntries))return false;
    if(!(typeof _isEmployee!=='undefined'&&_isEmployee))return false;   // an owner's drive out is already his day
    const dwells=(res&&Array.isArray(res.dwells))?res.dwells:[];
    let first=null;
    for(const d of dwells){
      if(!d||!(Number(d.startTs)>0))continue;
      const k=String(d.kind||'');
      if(k==='home_office'||k==='office')continue;                      // the house never starts a workday
      if(!first||Number(d.startTs)<first)first=Number(d.startTs);
    }
    if(!(first>0))return false;
    const{loggedByUid}=_tlLoggedByInfo();
    let moved=false;
    timeEntries.forEach(e=>{
      if(!e||e.date!==dayKey||e.open)return;
      if((e.logged_by_uid||null)!==loggedByUid)return;
      const a=Date.parse(e.start_time||''),b=Date.parse(e.end_time||'');
      if(!(a>0&&b>a)||a<=first)return;
      if(first<Date.parse(dayKey+'T00:00:00Z')-86400000)return;          // junk day key
      e.start_time=new Date(first).toISOString();
      e.minutes=Math.max(0,Math.round((b-first)/60000));
      e.edited_at=new Date().toISOString();
      e.edited_by_name=(typeof getOwnerName==='function'&&getOwnerName())||e.logged_by_name||'';
      moved=true;
    });
    if(moved){
      try{if(typeof supaSaveDebounced==='function')supaSaveDebounced();}catch(_e){}
      try{if(typeof _tlLiveRefresh==='function')_tlLiveRefresh();}catch(_e){}
    }
    return moved;
  }catch(_e){return false;}
}
// My open entry that started before today's business day, or null.
function _dayEndStaleEntry(){
  const e=_dayEndOpenEntry();
  if(!e)return null;
  const s=Date.parse(e.start_time||''),t=_dayEndTodayStart();
  return (s>0&&t>0&&s<t)?e:null;
}
// Propose the end of a stale clock at the last home-office arrival between
// its start and today. No evidence, no guess: the banner's own clock-out
// still works. 'new' when a proposal was just written, true when it stands.
function _dayEndStale(){
  try{
    const e=_dayEndStaleEntry();
    if(!e)return false;
    const s=Date.parse(e.start_time||''),t=_dayEndTodayStart();
    const m=_dayEndArrRead();
    let best=null;
    for(const k of Object.keys(m)){const a=m[k];if(a&&Number(a.ms)>s&&Number(a.ms)<t&&(!best||Number(a.ms)>best.ms))best={ms:Number(a.ms),name:String(a.name||'')};}
    if(!best)return false;
    const cur=_dayEndRead();
    if(cur&&cur.kind==='end'&&String(cur.entryId)===String(e.id)&&cur.endMs===best.ms)return true;
    const name=_dayEndFirstName();
    _dayEndWrite({kind:'end',entryId:e.id,endMs:best.ms,day:_geoDayKeyOf(best.ms,_geoBizTz()),madeAt:Date.now(),where:best.name||'the home office',stale:true});
    _notifySchedule('dayend',name?('Hey '+name+'!'):'Your day','Looks like your day ended at '+_dayEndWhen(best.ms)+'. Tap to confirm.',0);
    return 'new';
  }catch(_e){return false;}
}
// A proposal that names a time before today survives today's drives: the day
// it belongs to is already over.
function _dayEndCancelToday(){
  const p=_dayEndRead();
  if(!p||p.kind!=='end')return false;
  const t=_dayEndTodayStart();
  if(p.stale||(t>0&&Number(p.endMs)<t))return false;
  return _dayEndCancel('end');
}

// The proposal still standing, or null. A proposal to END dies with the
// entry it names (closed by hand, or deleted); a proposal to START dies at
// midnight or once any entry exists for the day.
function _dayEndPending(){
  let p=_dayEndRead();
  if(!p){if(_dayEndStale())p=_dayEndRead();}
  if(!p)return null;
  if(p.kind==='end'){
    const e=(Array.isArray(timeEntries)?timeEntries:[]).find(x=>x&&String(x.id)===String(p.entryId));
    if(!e||!e.open){_dayEndWrite(null);return null;}
    return p;
  }
  if(p.kind==='start'){
    if(p.day!==todayKey()||_dayEndHasEntryToday()){_dayEndWrite(null);return null;}
    return p;
  }
  return null;
}

// Called by the deriver's open-dwell publish (js/geo-track.js
// _geoOpenDwellPublish) with where the person is now and the day's result.
// Returns 'new' when it just wrote a proposal, true when one already stands,
// false when there is nothing to propose. Safe on every publish: the same
// dwell proposes once.
function _dayEndOnDwell(dwell,res){
  try{
    const legs=(res&&Array.isArray(res.legs))?res.legs:[];
    const journeys=(res&&Array.isArray(res.journeys))?res.journeys:[];
    // A clock from before today ends where yesterday ended, never where today's
    // dwell says; today's drives are a new day on top of an unclosed one.
    if(_dayEndStaleEntry())return _dayEndStale();
    if(!dwell||!(Number(dwell.sinceTs)>0)){_dayEndCancelToday();return false;}
    const kind=String(dwell.kind||'');
    if(kind==='home_office'){
      const e=_dayEndOpenEntry();
      if(!e){_dayEndCancelToday();return false;}
      if(!legs.length&&!journeys.length)return false;             // no drive today: the house is where they are
      const cur=_dayEndRead();
      if(cur&&cur.kind==='end'&&String(cur.entryId)===String(e.id)&&cur.endMs===Number(dwell.sinceTs))return true;
      const endMs=Number(dwell.sinceTs);
      const name=_dayEndFirstName();
      const p={kind:'end',entryId:e.id,endMs,day:_dayEndTodayKey(),madeAt:Date.now(),where:String(dwell.name||'the home office')};
      _dayEndWrite(p);
      const title=name?('Hey '+name+'!'):'Your day';
      const body='Looks like your day ended at '+_dayEndFmt(endMs)+'. Tap to confirm.';
      const at1=Math.max(Date.now(),endMs+_DAY_END_STILL_MS);
      _notifySchedule('dayend',title,body,at1);
      const at2=_dayEndNudgeAt(_DAY_END_NUDGE2_HOUR);
      if(at2>at1+60000)_notifySchedule('dayend2',title,body,at2);
      return 'new';
    }
    // Somewhere saved that is not the house: the morning mirror.
    if(kind==='job'||kind==='client'||kind==='shop'||kind==='supply'){
      if(_dayEndOpenEntry()||_dayEndHasEntryToday()||!_dayEndUsesClock())return false;
      const leg=legs.find(l=>l&&l.to&&dwell.fence&&String(l.to.id)===String(dwell.fence.id)&&Number(l.endTs)===Number(dwell.sinceTs))||null;
      if(!leg||!leg.from||String(leg.from.kind)!=='home_office')return false;
      const cur=_dayEndRead();
      // WHOSE DRIVE OUT IS IT? (owner 2026-09-04: "for a employee its the
      // arrival to the first saved geo fence that begins the day.")
      //
      // An OWNER leaving his own home office is already working: the drive out
      // is his, on his own clock, and it stays part of the day, which is what
      // makes it symmetric with the day-end proposing the arrival back home.
      //
      // An EMPLOYEE driving from his own house to his employer's shop is
      // commuting, and nobody pays for a commute. Jack's 31 August is the case
      // that settles it: the mirror would have offered 07:09, when he pulled
      // off his own driveway, and he hand-clocked 07:55, two minutes after
      // arriving at the shop. Those are 46 minutes apart because he ran an
      // errand across town on the way, and none of it was his employer's.
      //
      // So the two roles get two different starts, from the same evidence: the
      // owner's day opens when the truck leaves, the employee's when it
      // arrives somewhere the business saved.
      const _crew=(typeof _isEmployee!=='undefined')&&!!_isEmployee;
      const startMs=_crew?Number(dwell.sinceTs):Number(leg.startTs);
      if(cur&&cur.kind==='start'&&cur.startMs===startMs)return true;
      const name=_dayEndFirstName();
      _dayEndWrite({kind:'start',startMs,day:todayKey(),madeAt:Date.now(),where:String(dwell.name||'')});
      _notifySchedule('daystart',name?('Hey '+name+'!'):'Your day','Looks like you started at '+_dayEndFmt(startMs)+'. Tap to clock in.',0);
      return 'new';
    }
    return false;
  }catch(_e){return false;}
}
// The truck moved again: a day that "ended" did not. Only the END proposal
// is withdrawn; a START proposal stands until answered or the day changes.
function _dayEndOnDrive(){_dayEndCancelToday();}
function _dayEndCancel(kind){
  const p=_dayEndRead();
  if(!p||(kind&&p.kind!==kind))return false;
  _dayEndWrite(null);
  try{_notifyCancel(p.kind==='start'?['daystart']:['dayend','dayend2']);}catch(_e){}
  return true;
}

let _dayEndLast=null;   // what the last confirm did, for Undo
function _dayEndConfirm(){
  const p=_dayEndPending();
  if(!p)return false;
  const{loggedByUid,loggedByName}=_tlLoggedByInfo();
  if(p.kind==='end'){
    const e=timeEntries.find(x=>x&&String(x.id)===String(p.entryId)&&x.open);
    if(!e)return false;
    const startMs=Date.parse(e.start_time||'');
    const endMs=Math.max(Number(p.endMs),startMs+60000);
    _dayEndLast={kind:'end',entryId:e.id,prev:{end_time:e.end_time,minutes:e.minutes,open:e.open}};
    e.end_time=new Date(endMs).toISOString();
    e.minutes=Math.max(1,Math.round((endMs-startMs)/60000));
    e.open=false;
    // The job's banked hours move exactly as clockOut() moves them (js/jobs.js).
    try{const j=(Array.isArray(jobs)?jobs:[]).find(x=>x&&x.id===e.job_id);if(j)j.actualHours=Math.round(((j.actualHours||0)+e.minutes/60)*10)/10;}catch(_e){}
    if(typeof _activeTimer!=='undefined'&&_activeTimer&&_activeTimer.entryId===e.id){
      clearInterval(_activeTimer.timerInterval);
      _activeTimer=null;
      if(typeof hideClockBanner==='function')hideClockBanner();
      if(typeof _liveActClockOut==='function')_liveActClockOut();
    }
    _dayEndWrite(null);
    try{_notifyCancel(['dayend','dayend2']);}catch(_e){}
    saveAll();
    _dayEndToast('Clocked out at '+_dayEndWhen(endMs)+', '+_fmtMin(e.minutes)+' logged');
    try{renderDash&&renderDash();}catch(_e){}
    return true;
  }
  if(p.kind==='start'){
    const startMs=Number(p.startMs);
    const row={id:_newId(),job_id:null,date:(typeof _geoDayKeyOf==='function'&&typeof _geoBizTz==='function')?_geoDayKeyOf(startMs,_geoBizTz()):todayKey(),
      start_time:new Date(startMs).toISOString(),end_time:null,minutes:null,scope_id:null,scope_label:null,
      logged_by_uid:loggedByUid,logged_by_name:loggedByName,open:true};
    timeEntries.push(row);
    _dayEndLast={kind:'start',entryId:row.id};
    _dayEndWrite(null);
    try{_notifyCancel(['daystart']);}catch(_e){}
    if(typeof _rehydrateActiveTimer==='function')_rehydrateActiveTimer();
    saveAll();
    _dayEndToast('Clocked in from '+_dayEndFmt(startMs));
    try{renderDash&&renderDash();}catch(_e){}
    return true;
  }
  return false;
}
// Undo, and it never happened: the entry is exactly what it was.
function _dayEndUndo(){
  const l=_dayEndLast;
  if(!l)return false;
  _dayEndLast=null;
  if(l.kind==='end'){
    const e=timeEntries.find(x=>x&&String(x.id)===String(l.entryId));
    if(!e)return false;
    try{const j=(Array.isArray(jobs)?jobs:[]).find(x=>x&&x.id===e.job_id);if(j&&e.minutes)j.actualHours=Math.max(0,Math.round(((j.actualHours||0)-e.minutes/60)*10)/10);}catch(_e){}
    e.end_time=l.prev.end_time;e.minutes=l.prev.minutes;e.open=l.prev.open;
    if(typeof _rehydrateActiveTimer==='function')_rehydrateActiveTimer();
  }else if(l.kind==='start'){
    if(typeof _activeTimer!=='undefined'&&_activeTimer&&_activeTimer.entryId===l.entryId){
      clearInterval(_activeTimer.timerInterval);_activeTimer=null;
      if(typeof hideClockBanner==='function')hideClockBanner();
      if(typeof _liveActClockOut==='function')_liveActClockOut();
    }
    timeEntries=timeEntries.filter(x=>!(x&&String(x.id)===String(l.entryId)));
  }
  saveAll();
  try{renderDash&&renderDash();}catch(_e){}
  return true;
}
function _dayEndDismiss(){
  const p=_dayEndRead();
  _dayEndCancel(p&&p.kind);
  try{renderDash&&renderDash();}catch(_e){}
}
// The same undo toast the job reopen uses (js/jobs.js), not a second style.
function _dayEndToast(msg){
  try{
    if(typeof document==='undefined')return;
    const t=document.createElement('div');
    t.className='td-dayend-toast';
    // Two lines when the words need them (this one names a day): a toast
    // must never run off a 390px screen (CLAUDE.md 15.1).
    t.style.cssText='position:fixed;bottom:80px;left:50%;transform:translateX(-50%);width:max-content;max-width:calc(100vw - 24px);box-sizing:border-box;background:#222;color:#fff;padding:10px 16px;border-radius:20px;font-size:13px;font-weight:700;line-height:1.3;z-index:9999;display:flex;align-items:center;gap:12px;box-shadow:0 4px 16px rgba(0,0,0,.3)';
    t.innerHTML='<span style="min-width:0">'+escHtml(msg)+'</span><button type="button" style="flex-shrink:0;background:rgba(255,255,255,.2);border:none;color:#fff;padding:4px 10px;border-radius:12px;font-size:12px;cursor:pointer;font-family:inherit">Undo</button>';
    t.querySelector('button').onclick=()=>{_dayEndUndo();t.remove();};
    document.body.appendChild(t);
    setTimeout(()=>{if(t.parentNode)t.remove();},8000);
    try{_tdHaptic('thud');}catch(_e){}
  }catch(_e){}
}
// The Home card's copy, one place for both kinds.
function _dayEndCardText(p){
  if(!p)return null;
  if(p.kind==='end')return{badge:'YOUR DAY',title:'Looks like your day ended at '+_dayEndWhen(p.endMs),sub:'Back at '+(p.where||'the home office')+', timer still running',yes:'Clock out at '+_dayEndWhen(p.endMs),no:'Still working'};
  return{badge:'YOUR DAY',title:'Looks like you started at '+_dayEndFmt(p.startMs),sub:(p.where?('At '+p.where+' now, '):'')+'no timer running',yes:'Clock in from '+_dayEndFmt(p.startMs),no:'Not today'};
}
