// ── Needs an answer: the nudge (owner 2026-09-05) ────────────────────────────
//
// Two holds land on the Home card (js/dashboard.js #dash-hold): a store run
// waiting on its receipt (js/mileage.js pendingSupplyStores) and a client
// visit the day cannot vouch for (rule 13, js/geo-derive.js). This is the
// buzz that gets them answered, and WHEN it buzzes is the whole design.
// Owner: "When is the best time to notify though, right when you leave the
// store or when you leave the house?" Neither: both are the moment the truck
// pulls out, and a buzz while driving is the one that gets swiped away.
//
//   Store run   the FIRST STOP AFTER THE STORE. The receipt is on the seat,
//               the truck just parked, hands are free. Never at the store
//               itself (no receipt yet) and never on the move.
//   Visit       the ARRIVAL HOME, once the truck has sat twenty minutes.
//               Nothing physical to lose, and asking at the customer's house
//               would presume the answer. Owner: "when you make it home".
//   Fallback    9 pm, only if something is still unanswered.
//
// One buzz, not two. When js/day-end.js is proposing the clock-out at that
// same arrival, its notification carries the question (_dayEndBody reads
// _holdNudgeLine) and nothing is scheduled here. Answering cancels whatever
// is still pending and rewrites the day-end body without the line.
//
// The copy names the client and the store (owner: "Use client name"), never
// "a visit" or "a store run".
//
// Everything here is JS (CLAUDE.md 3.2): TdNotify only schedules and cancels.
// Local notifications only: the phone created the hold, so it already knows.
// Nothing goes to managers, both answers are the person's own.
const _HOLD_IDS=['hold:store','hold:home','hold:eve'];
const _HOLD_KEY='zp3_hold_nudge';        // {day, stores:[runKey], homeAt, visits:[{id,name}], answered:[id]}
const _HOLD_HOME_STILL_MS=20*60000;      // the same settle the day-end proposal waits
const _HOLD_EVE_HOUR=21;

function _holdTodayKey(){try{return _geoDayKeyOf(Date.now(),_geoBizTz());}catch(_e){return todayKey();}}
function _holdRead(){
  try{const o=JSON.parse(localStorage.getItem(_HOLD_KEY)||'null');return (o&&typeof o==='object')?o:null;}catch(_e){return null;}
}
function _holdWrite(o){try{localStorage.setItem(_HOLD_KEY,JSON.stringify(o));}catch(_e){}}
// Today's state, fresh at the turn of the business day: yesterday's nudges
// were yesterday's.
function _holdState(){
  const day=_holdTodayKey();
  const o=_holdRead();
  if(o&&o.day===day)return{day,stores:Array.isArray(o.stores)?o.stores:[],homeAt:Number(o.homeAt)||0,
    visits:Array.isArray(o.visits)?o.visits:[],answered:Array.isArray(o.answered)?o.answered:[]};
  return{day,stores:[],homeAt:0,visits:[],answered:[]};
}

// Today's store runs still waiting on a receipt: one per run key, named.
function _holdStoresToday(){
  try{
    if(typeof pendingSupplyStores!=='function')return [];
    const day=_holdTodayKey(),out=[];
    pendingSupplyStores().forEach(st=>{
      (st.visits||[]).forEach(v=>{if(v&&v.date===day&&v.key)out.push({key:v.key,name:String(st.name||'the store')});});
    });
    return out;
  }catch(_e){return [];}
}

// The deriver's verdict on today's visits, noted on every publish. A held
// dwell stays held through every rebuild (the writer carries the answer, the
// deriver never sees it), so the ones already answered here are kept out.
function _holdNudgeNote(res){
  try{
    const st=_holdState();
    const held=((res&&res.dwells)||[]).filter(d=>d&&d.held===true&&d.id);
    held.forEach(d=>{
      const id=String(d.id);
      if(st.answered.indexOf(id)>=0||st.visits.some(v=>v&&v.id===id))return;
      st.visits.push({id,name:String(d.name||(d.fence&&d.fence.name)||'someone').slice(0,40)});
    });
    _holdWrite(st);
    return st.visits.length;
  }catch(_e){return 0;}
}

// Two names read as a pair, three or more as a count: a notification is one
// line on a lock screen, not a list.
function _holdNames(list){
  const names=list.map(x=>String(x.name||'').trim()).filter(Boolean);
  if(!names.length)return '';
  if(names.length===1)return names[0];
  if(names.length===2)return names[0]+' and '+names[1];
  return names[0]+' and '+(names.length-1)+' more';
}
// The question, as one line, or '' when there is nothing to ask.
//   "Home Depot receipt still needed. Was Mom work or personal?"
function _holdNudgeLine(){
  try{
    const parts=[];
    const stores=_holdStoresToday();
    if(stores.length){
      const seen={};const uniq=stores.filter(s=>{if(seen[s.name])return false;seen[s.name]=true;return true;});
      parts.push(_holdNames(uniq)+(uniq.length>1?' receipts':' receipt')+' still needed.');
    }
    const st=_holdState();
    if(st.visits.length)parts.push((st.visits.length>1?'Were ':'Was ')+_holdNames(st.visits)+' work or personal?');
    return parts.join(' ');
  }catch(_e){return '';}
}

function _holdTitle(){
  let name='';
  try{name=(typeof _dayEndFirstName==='function')?_dayEndFirstName():'';}catch(_e){}
  return name?('Hey '+name+'!'):'Needs an answer';
}
function _holdNudgeAt(h){
  try{if(typeof _dayEndNudgeAt==='function')return _dayEndNudgeAt(h);}catch(_e){}
  const d=new Date();d.setHours(h,0,0,0);return d.getTime();
}

// Called by the deriver's open-dwell publish (js/geo-track.js
// _geoOpenDwellPublish) with where the person is now, AFTER js/day-end.js
// has had its turn, so a day-end proposal made this instant already carries
// the line. Returns 'new' when it scheduled something, false otherwise.
// Safe on every publish: a run nudges once, an arrival home nudges once.
function _holdNudgeOnDwell(dwell,res){
  try{
    _holdNudgeNote(res);
    // On the move: never. The buzz waits for the next stop.
    if(!dwell||!(Number(dwell.sinceTs)>0))return false;
    const st=_holdState();
    const kind=String(dwell.kind||'');
    let did=false;
    // The first stop after the store. Not AT a store: the receipt is not in
    // hand yet, and a second store on the same run is still the run.
    if(kind!=='supply'){
      const runs=_holdStoresToday().filter(r=>st.stores.indexOf(r.key)<0);
      if(runs.length){
        const seen={};const uniq=runs.filter(r=>{if(seen[r.name])return false;seen[r.name]=true;return true;});
        _notifySchedule('hold:store',
          'Got the '+_holdNames(uniq)+(uniq.length>1?' receipts?':' receipt?'),
          'Scan '+(uniq.length>1?'them':'it')+' now and the miles and the expense are done in one shot. Tap to open.',0);
        runs.forEach(r=>st.stores.push(r.key));
        did=true;
      }
    }
    // Home: the day winding down. Once per arrival (a fresh sinceTs is a
    // fresh arrival), and only when there is a question left to ask.
    if(kind==='home_office'&&st.homeAt!==Number(dwell.sinceTs)){
      const line=_holdNudgeLine();
      if(line){
        st.homeAt=Number(dwell.sinceTs);
        const p=(typeof _dayEndRead==='function')?_dayEndRead():null;
        const folded=!!(p&&p.kind==='end'&&p.day===st.day);
        if(!folded){
          const at1=Math.max(Date.now(),Number(dwell.sinceTs)+_HOLD_HOME_STILL_MS);
          const title=_holdTitle(),body=line+' Tap to answer.';
          _notifySchedule('hold:home',title,body,at1);
          const at2=_holdNudgeAt(_HOLD_EVE_HOUR);
          if(at2>at1+60000)_notifySchedule('hold:eve',title,body,at2);
        }
        did=true;
      }
    }
    _holdWrite(st);
    return did?'new':false;
  }catch(_e){return false;}
}

// An answer landed (a store run door, a visit door, the 7-day sweep). The
// visit is struck from today's list by its deriver id (client_key on the
// row), the pending buzzes go when nothing is left to ask, and a day-end
// proposal that carried the question is rewritten without it.
function _holdNudgeAnswered(visitKey){
  try{
    const st=_holdState();
    if(visitKey!=null&&visitKey!==''){
      const id=String(visitKey);
      st.visits=st.visits.filter(v=>!(v&&v.id===id));
      if(st.answered.indexOf(id)<0)st.answered.push(id);
      _holdWrite(st);
    }
    if(!_holdNudgeLine()){try{_notifyCancel(_HOLD_IDS.slice());}catch(_e){}}
    try{if(typeof _dayEndRenotify==='function')_dayEndRenotify();}catch(_e){}
    return true;
  }catch(_e){return false;}
}
