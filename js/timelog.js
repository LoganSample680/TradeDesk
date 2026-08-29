// ── Time Log, chronological "where did my time go" view ───────────────────
// Merges two time-tracking sources that don't otherwise talk to each other:
//   1. timeEntries (local array / td_time_entries cloud table), manual
//      Clock in/out, tagged with logged_by_uid/logged_by_name at save time
//      (js/jobs.js clockOut()).
//   2. job_time_entries (Supabase, via _fetchCrewLabor), GPS arrival/
//      departure auto-tracking (js/geo-track.js), already carries
//      employee_user_id.
// Owner call 2026-08-20: this is now ALSO the unified crew hours report
// (absorbing what was going to be a separate Crew Cost redesign, owner: "I
// don't want this under crew cost, want it under time log"), hours only,
// never dollars ("don't need pay rate here just time"). A year selector,
// then month accordions, January (oldest) THROUGH December (newest), the
// opposite order from every other Books accordion (Income/Expenses read
// newest-first) because this is a "how did the year build up" report, not
// a "what happened lately" ledger. Each month opens into week accordions
// (_bkWeekAcc, js/finance.js), and each week has its own Week/S/M/T/W/T/F/S
// day picker (owner: "need the day picker to change what day we're looking
// at") that swaps the SAME row list between the whole week and one day,
// nothing ever shown twice.
//
// Anyone with payroll/team permission (_canViewComp, owner or a manager)
// gets a Me/Team toggle at the top: Team breaks hours out per employee
// (avatar, on-site/drive/supply split bar, OT flag, your own row tagged
// "(you)"); Me is the same plain "your own days" view everyone else gets,
// plus a Share button. Everyone defaults to Me, owner included (reversed
// 2026-08-23; owners used to land on Team by default). Either way,
// whatever the picker currently shows (a week or one
// day) also opens into the exact same entries table this page always had,
// Edit/Delete on manual rows, the only place an entry can still be fixed.
// $ cost lives entirely in Crew Cost (js/finance.js _crewCostRender), which
// reads the same underlying rows; this page never touches wage/loaded rates.
function _tlJobClientInfo(jobId){
  // String(): a GPS auto row's job_id came back from Supabase (job_time_entries,
  // _geoCloseEntry/_geoReconcileFromMileage both write String(jobId)), while
  // jobs[].id is a local NUMBER (_newId()), so a strict === here silently misses
  // the match on every auto/reconciled row and blanks the address (owner report
  // 2026-08-21: "if at a job it says the address but still"). Same coercion the
  // rest of the app already uses at the Supabase boundary, js/geo-track.js:1042,
  // js/cloud.js and js/dashboard.js's job_id lookups (§7.3, don't hand-roll a
  // parallel comparison here).
  // Every element guarded, and the arrays themselves too. A single hole in
  // `jobs` throws "Cannot read properties of undefined (reading 'id')" out of
  // this callback, and this function is called from inside other people's try
  // blocks: js/geo-track.js _geoMergeAdjacentVisits routes its whole grouping
  // key through here, so one bad element silently aborted an entire merge
  // sweep and made it look like a day with nothing to merge (CI shard 6,
  // three separate zero-merge failures, 2026-08-24, found only once that
  // sweep stopped swallowing its own throw). These arrays are globals that
  // sync, restore and a dozen call sites all write, so a hole is a question
  // of when, not whether, and no lookup should die on one.
  const _jl=Array.isArray(jobs)?jobs:[];
  const _bl=Array.isArray(bids)?bids:[];
  const j=_jl.find(x=>x&&String(x.id)===String(jobId))||null;
  const bid=(j&&j.bid_id)?(_bl.find(b=>b&&b.id===j.bid_id)||null):null;
  const c=bid?getClientById(bid.client_id):(j?getClientById(j.client_id):null);
  // Job-site address, not billing address, a bid's own addr (when set) is the
  // actual property being worked, which can differ from the client's address
  // (property managers, rentals, multi-site commercial accounts). Same
  // precedence js/jobs.js already uses for job cards (bid.addr||client.addr).
  const addr=(bid&&bid.addr)||(j&&j.addr)||(c&&c.addr)||'';
  return{jobName:j?j.name:'-',clientName:c?c.name:(j?j.name:'-'),addr};
}
// A friendly word for the raw job_time_entries.source column (owner report
// 2026-08-21: "the tags themselves are confusing"). geofence* rows already
// say what they are via the job/client name on the row, nothing to add.
// drive* rows are windshield time, never a site visit, and are labeled as
// such regardless of which vehicle-mode suffix they carry. 'place' rows
// carry their own destination name in dest_place now (see _timeLogRows),
// so the raw word itself adds nothing on top of that. Anything unrecognized
// (a future source this function hasn't learned yet) falls back to the raw
// string rather than hiding it, so a real change is never silently blank.
function _tlSourceLabel(source){
  const s=String(source||'');
  if(/^geofence/.test(s))return '';
  if(/^drive/.test(s))return 'Driving'+(s.indexOf('rider')>=0?' (rider)':s.indexOf('personal')>=0?' (personal vehicle)':'');
  // A home office is TWO different kinds of work and the log now says which.
  // The words are the ones contractors actually use: Jobber ships "Office"
  // for desk time, and loading the truck is how the trade forums and the
  // prevailing-wage agreements name that block (nobody in the trades says
  // "load-out", that is mining and logistics). Deliberately NOT "Shop": the
  // Shop badge already means the yard on this same table.
  // A client visit needs no word: the row already carries the person's name,
  // which is more use than the label 'client' would be.
  if(s==='client')return '';
  // "Loading time", not "Loading" (owner 2026-08-29). The bare word means a
  // spinner in every app anybody has ever used, so on a finished row it reads
  // as the page still working rather than as the minutes he spent putting
  // tools in the truck.
  if(s==='place-load')return 'Loading time';
  if(s==='place-office')return 'Office';
  if(s==='place')return '';
  if(s==='manual')return 'GPS clock';
  if(s==='stop')return 'Unpaid';
  return s;
}
// Still-running entries, clocked in, never closed. Separate from the history
// below: an open entry has no minutes yet, so mixing it into the month/day
// accordions would just show a confusing "0m" row. This is also the visibility
// a manager needs to force-close a forgotten clock (§ owner request 2026-07-11).
function _tlOpenEntries(){
  const rows=[];
  timeEntries.forEach(e=>{
    if(!e.open)return;
    const info=_tlJobClientInfo(e.job_id);
    const elapsedMin=Math.max(0,Math.round((Date.now()-new Date(e.start_time).getTime())/60000));
    rows.push({
      rawId:e.id,personName:e.logged_by_name||((typeof getOwnerName==='function'&&getOwnerName())||'Owner (me)'),
      personUid:e.logged_by_uid||null,clientName:info.clientName,addr:info.addr,jobName:info.jobName,
      detail:e.scope_label||'',startTime:e.start_time,elapsedMin
    });
  });
  return rows.sort((a,b)=>(a.startTime||'').localeCompare(b.startTime||''));
}
// An unpaid stop only exists BETWEEN work (owner rule 2026-08-24): it earns a
// line on the log only when the same person has a real location event, a job
// or client geofence (live, gap, or reconciled), a saved place/supply house,
// a manual clock record, or a shop session, both BEFORE it and AFTER it on
// the same Central-time calendar day, AND at least one of those sides is a
// job/place/manual event, never shop-to-shop alone. The owner's exact spec:
// "at least two geofence events, one from shop, one at a job site or supply
// house and back." Shop out, stop, shop back is an errand from the yard on a
// day with no work in it, not a leg of a work trip (owner report 2026-08-24:
// a no-work Saturday still showed an unpaid stop bracketed by two shop
// sessions). A stop floating on its own, before the first fence of the day,
// after the last one, or spanning midnight, is an overnight park or tracker
// noise, and rendering those is what filled the log with random unpaid
// lines (and, stretched by the disabled gap-absorb sweep, impossible 24h+
// days). Display-level on purpose: nothing here mutates data, a
// non-qualifying row simply never renders, so a later fence event landing
// from another device can still promote it back into view on the next open.
function _tlStopAnchored(arrMs,depMs,anchors){
  if(!(arrMs>0&&depMs>=arrMs)||!Array.isArray(anchors))return false;
  const dstr=d=>(typeof _ctDateStr==='function')?_ctDateStr(d):dateKey(d);
  const day=dstr(new Date(arrMs));
  if(day!==dstr(new Date(depMs)))return false;   // spans midnight: never shown
  const SLACK=2*60000;   // kerb-edge timestamp rounding, same floor the merge gap used
  // Overlap veto first, against EVERY anchor: one covering more than the
  // edge slack of the stop means the person was provably on site (or at the
  // shop) during it, so the "unpaid" row is a stretched artifact, not time
  // between fences, whatever its edges look like.
  for(const a of anchors){
    if(a&&Math.min(a.dep,depMs)-Math.max(a.arr,arrMs)>SLACK)return false;
  }
  let before=false,after=false,workSide=false;
  for(const a of anchors){
    if(!a)continue;
    const bOk=a.dep<=arrMs+SLACK&&dstr(new Date(a.dep))===day;
    const aOk=a.arr>=depMs-SLACK&&dstr(new Date(a.arr))===day;
    if(bOk)before=true;
    if(aOk)after=true;
    // a.shop marks a shop session; anything else (job fence, place, manual
    // clock) is work, and at least one qualifying side must be work.
    if((bOk||aOk)&&!a.shop)workSide=true;
  }
  return before&&after&&workSide;
}
// A day should read as one continuous span, not a list of islands (owner
// report 2026-08-24, Fri 8/21: on site until 11:37, unpaid lunch starting
// 11:42, back on site at 12:45, so five minutes and then fourteen minutes of
// the day belonged to no row at all). Those holes are the drive to and from
// the stop: real minutes, but not deductible mileage (a lunch run is not a
// business trip), so the mileage side correctly drops them and the time side
// was left with nothing to show.
//
// The owner's own call on the first one, 2026-08-24: "the unpaid time leg
// should absorb that 5 minutes." So an UNPAID row swallows the gap on either
// side of it, door to door: leaving the job at 11:37 and being back at 12:45
// is one 68-minute unpaid excursion.
//
// Only unpaid rows are ever stretched, which is what makes this safe: unpaid
// minutes are excluded from every total, the OT flag, and the 24h day check,
// so absorbing a gap changes what the day LOOKS like and can never change
// what anyone is paid. Bounded at 30 minutes per gap for the same reason the
// old data-side gap-absorb sweep is still disabled: an unexplained two-hour
// hole is a missing record to investigate, not something to quietly swallow
// (that is exactly how days grew past 24 hours). Anything bigger is left
// visible. Display-only, nothing here writes.
const _TL_GAP_ABSORB_MAX_MS=30*60000;
// The motion history covering every shop session on screen, or null when
// there is none to read. One query for the whole range rather than one per
// session: the coprocessor keeps about a week and the answer is the same
// tape either way.
async function _tlShopTape(byUid){
  try{
    if(typeof _geoMotionTape!=='function')return null;
    let lo=0,hi=0;
    Object.keys(byUid||{}).forEach(uid=>(byUid[uid]||[]).forEach(e=>{
      const a=Date.parse((e&&e.arrived_at)||'')||0,b=Date.parse((e&&e.departed_at)||'')||0;
      if(a>0&&(!lo||a<lo))lo=a;
      if(b>hi)hi=b;
    }));
    if(!(lo>0&&hi>lo))return null;
    return await _geoMotionTape(lo,hi);
  }catch(_e){return null;}
}
// ── The day must be continuous (owner 2026-08-29) ──────────────────────────
// "just want time in order from motion to drive, jacks house to Laurie's,
// then show unaccounted for time in between, then arrival at Laurie's,
// unaccounted for time in between, arrival at Laurie's then drive time home,
// that ends the day."
//
// Nothing is merged and nothing is invented. What changes is that a hole
// stops being INVISIBLE. Jack's 8/28 had 104 minutes between leaving Laurie's
// at 12:14 and coming back at 13:58 that produced no row of any kind, so the
// Time Log jumped straight from one visit to the next and the day silently
// failed to add up. A reader could not tell that from a day with nothing in
// between, which is the whole problem: a gap you cannot see is a gap nobody
// questions.
//
// So every remaining hole between two rows becomes a row that says so. These
// are DISPLAY rows: no id, never paid, never editable, never written back to
// the server. They exist so the column adds up to the day.
//
// Small gaps are already absorbed into the unpaid row beside them
// (_tlAbsorbGaps above, 30-minute ceiling) and never reach here. The floor
// below is for what survives that: a two-minute seam between a drive and an
// arrival is rounding, not a hole worth a line of its own.
const _TL_UNACCOUNTED_MIN_MS=5*60000;
function _tlFillUnaccounted(rows){
  if(!Array.isArray(rows)||!rows.length)return rows;
  const byDay={};
  rows.forEach(r=>{
    if(!r||!r.startTime||!r.endTime||!r.date)return;
    const a=Date.parse(r.startTime),b=Date.parse(r.endTime);
    if(!(a>0&&b>a))return;
    const k=(r.personUid||'owner')+'|'+r.date;
    (byDay[k]=byDay[k]||[]).push(r);
  });
  const out=rows.slice();
  Object.keys(byDay).forEach(k=>{
    const day=byDay[k].sort((x,y)=>Date.parse(x.startTime)-Date.parse(y.startTime));
    // Walk a high-water mark, not just the previous row: two rows that
    // overlap (a drive and the visit it lands in) must not manufacture a
    // negative gap, and a short row nested inside a long one must not split
    // the long one's remainder into two phantom holes.
    let mark=Date.parse(day[0].endTime);
    for(let i=1;i<day.length;i++){
      const r=day[i];
      const a=Date.parse(r.startTime),b=Date.parse(r.endTime);
      const gap=a-mark;
      if(gap>=_TL_UNACCOUNTED_MIN_MS){
        out.push({
          id:'u'+k+'_'+mark,rawId:null,source:'unaccounted',rawSource:'unaccounted',
          date:r.date,minutes:Math.round(gap/60000),
          personName:r.personName,personUid:r.personUid||null,
          clientName:'Unaccounted for',addr:'',jobName:'',clientKey:null,
          unpaid:true,detail:'No location or motion on record',
          startTime:new Date(mark).toISOString(),endTime:r.startTime
        });
      }
      if(b>mark)mark=b;
    }
  });
  return out;
}
function _tlAbsorbGaps(rows){
  if(!Array.isArray(rows))return rows;
  const byDay={};
  rows.forEach(r=>{
    if(!r||!r.startTime||!r.endTime||!r.date)return;
    const a=Date.parse(r.startTime),b=Date.parse(r.endTime);
    if(!(a>0&&b>=a))return;
    ((byDay[(r.personUid||'owner')+'|'+r.date])=byDay[(r.personUid||'owner')+'|'+r.date]||[]).push(r);
  });
  Object.keys(byDay).forEach(k=>{
    const day=byDay[k].sort((x,y)=>Date.parse(x.startTime)-Date.parse(y.startTime));
    for(let i=1;i<day.length;i++){
      const prev=day[i-1],next=day[i];
      const pEnd=Date.parse(prev.endTime),nStart=Date.parse(next.startTime);
      const gap=nStart-pEnd;
      if(!(gap>0)||gap>_TL_GAP_ABSORB_MAX_MS)continue;
      // The later row wins when both could take it: the travel that ends at a
      // stop belongs to that stop, and a gap in front of a paid row is only
      // ever absorbed by the unpaid row behind it.
      const taker=next.unpaid?next:(prev.unpaid?prev:null);
      if(!taker)continue;
      if(taker===next)taker.startTime=prev.endTime;else taker.endTime=next.startTime;
      taker.minutes=Math.max(0,Math.round((Date.parse(taker.endTime)-Date.parse(taker.startTime))/60000));
    }
  });
  return rows;
}
async function _timeLogRows(sinceISO){
  const rows=[];
  timeEntries.forEach(e=>{
    if(e.open)return; // still running, shown separately, see _tlOpenEntries
    if(sinceISO&&e.start_time&&e.start_time<sinceISO)return;
    const info=_tlJobClientInfo(e.job_id);
    rows.push({
      id:'m'+e.id,rawId:e.id,source:'manual',date:e.date,minutes:e.minutes||0,
      personName:e.logged_by_name||((typeof getOwnerName==='function'&&getOwnerName())||'Owner (me)'),
      personUid:e.logged_by_uid||null,
      clientName:info.clientName,addr:info.addr,jobName:info.jobName,detail:e.scope_label||'',
      startTime:e.start_time||null,endTime:e.end_time||null
    });
  });
  const crew=(typeof _fetchCrewLabor==='function')?await _fetchCrewLabor(sinceISO):{name:{},entries:[]};
  // Anchor windows per person for _tlStopAnchored above: every on-site record
  // that isn't itself a stop or wheel time, plus shop sessions (their own
  // table) and the person's manual clock entries.
  const anchorsByUid={};
  const _anchorPush=(uid,arrIso,depIso,isShop)=>{
    const arr=Date.parse(arrIso),dep=Date.parse(depIso);
    if(!(arr>0&&dep>0))return;
    (anchorsByUid[uid]=anchorsByUid[uid]||[]).push({arr,dep,shop:!!isShop});
  };
  const _anchorSrc=s=>{const t=String(s||'');return /^(geofence|manual|place)$/.test(t)||/^(geofence|place)-/.test(t);};
  (crew.entries||[]).forEach(e=>{
    if(e&&e.arrived_at&&e.departed_at&&_anchorSrc(e.source))_anchorPush(e.employee_user_id,e.arrived_at,e.departed_at);
  });
  (crew.shopEntries||[]).forEach(e=>{
    if(e&&e.arrived_at&&e.departed_at)_anchorPush(e.employee_user_id,e.arrived_at,e.departed_at,true);
  });
  // Shop/yard dwell as its own row (owner request 2026-08-24, "why are there
  // gaps between them"): shop time was tracked and already PAID in Crew Cost
  // (js/finance.js _openCrewCost adds it straight into e.min), but the Time
  // Log listed only job and drive rows, so every hour at the yard read as a
  // hole in the day. Overlaying it closed nearly every gap in the owner's
  // week: Thu 8/20's 45-minute midday hole was the shop 12:33-1:18 exactly.
  //
  // PAID now, matching Crew Cost, but only inside the workday: the day auto
  // clocks out at its last real work event (js/geo-track.js _geoShopCutoffs,
  // see the rule comment there). Two owner reports on 2026-08-24 drove that,
  // and one rule answers both: yard dwell AFTER the last job or supply run
  // ("don't want shop time to calculate after the last job site or supply
  // run of the day") and yard dwell on a day with NO job or supply fence at
  // all both credit zero minutes, and a zero-credit session does not render.
  // Nothing is being hidden, there is no gap to close after the day has
  // ended, and a Saturday at the yard is not a shift.
  const _shopCut=(typeof _geoShopCutoffs==='function')
    ? _geoShopCutoffs((crew.entries||[]).concat(
        timeEntries.filter(e=>!e.open&&e.start_time&&e.end_time).map(e=>({
          employee_user_id:e.logged_by_uid||(typeof _contractorUserId!=='undefined'&&_contractorUserId)||(typeof _supaUser!=='undefined'&&_supaUser&&_supaUser.id)||null,
          arrived_at:e.start_time,departed_at:e.end_time,source:'manual'
        }))))
    : {};
  // Grouped per person because the paid spans are computed in ORDER for one
  // person at a time: overlapping sessions clip against each other so no
  // minute is ever paid twice (js/geo-track.js _geoShopPaidSpans).
  const _shopByUid={};
  (crew.shopEntries||[]).forEach(e=>{
    if(!e||!e.arrived_at||!e.departed_at)return;
    (_shopByUid[e.employee_user_id]=_shopByUid[e.employee_user_id]||[]).push(e);
  });
  // The motion tape for the whole rendered range, fetched ONCE and handed
  // down: at a shop that is also the house it trims each session to the part
  // where somebody was actually walking (js/geo-track.js _geoActiveTrim).
  // Null on every non-iPhone build and whenever the coprocessor has nothing,
  // and then _geoShopPaidSpans bills the dwell exactly as it did before.
  const _shopTape=await _tlShopTape(_shopByUid);
  Object.keys(_shopByUid).forEach(uid=>{
    const list=_shopByUid[uid];
    const mine=(crew.entries||[]).filter(x=>x&&String(x.employee_user_id)===String(uid));
    const spans=(typeof _geoShopPaidSpans==='function')?_geoShopPaidSpans(list,_shopCut[uid]||{},mine,_shopTape):[];
    list.forEach((e,i)=>{
      const arr=Date.parse(e.arrived_at),dep=Date.parse(e.departed_at);
      if(!(arr>0&&dep>arr))return;
      // Same physical-impossibility bound the rest of the log honors: a dwell
      // that spans Central midnight is the truck sitting at the yard overnight,
      // not a shift, and must never land as paid time (owner rule 2026-08-24).
      const dstr=d=>(typeof _ctDateStr==='function')?_ctDateStr(d):dateKey(d);
      const day=dstr(new Date(arr));
      if(day!==dstr(new Date(dep)))return;
      // (the span builder folds a blip-split visit into its first row, so a
      // merged-away row simply reports zero minutes below)
      const sp=spans[i]||{startMs:arr,endMs:dep,minutes:e.minutes||0,clipped:false};
      // Zero paid minutes means outside the workday window, or folded into an
      // earlier session that already carries this stretch. Either way there is
      // no second row to draw.
      if((sp.minutes||0)<1)return;
      // Trimmed by the clock-out rather than by the person leaving: show when
      // the clock actually stopped and say why, so the rule is visible instead
      // of quietly eating minutes. Exact edges (the common case) read plain.
      const trimmed=sp.endMs<(sp.rawEndMs||dep)-60000;
      rows.push({
        id:'s'+uid+'_'+e.arrived_at,
        source:'shop',date:day,minutes:sp.minutes,
        personName:crew.name[uid]||'Crew',personUid:uid,
        clientName:(typeof S!=='undefined'&&S&&S.bname)?S.bname:'Shop',
        addr:(typeof _geoShopAddr==='function'&&_geoShopAddr())||'',jobName:'',
        clientKey:null,unpaid:false,
        detail:trimmed?'Shop · auto clock-out':'Shop',
        // Unchanged edges keep the source string exactly: only an edge the
        // clock-out or the overlap clip actually moved is re-stamped.
        startTime:sp.clipped?new Date(sp.startMs).toISOString():e.arrived_at,
        endTime:sp.endMs===dep?e.departed_at:new Date(sp.endMs).toISOString(),
        mergedCount:sp.mergedCount||1,
        rawId:null,rawSource:'shop'
      });
    });
  });
  timeEntries.forEach(e=>{
    if(e.open||!e.start_time||!e.end_time)return;
    // null logged_by_uid means the owner, the same convention the geo/dedup
    // code uses; the owner's crew rows carry the contractor uid.
    const uid=e.logged_by_uid||(typeof _contractorUserId!=='undefined'&&_contractorUserId)||(typeof _supaUser!=='undefined'&&_supaUser&&_supaUser.id)||null;
    if(uid)_anchorPush(uid,e.start_time,e.end_time);
  });
  (crew.entries||[]).forEach(e=>{
    if(!e.arrived_at)return;
    // Off-job stops (lunch, an errand) still get a row (owner request
    // 2026-08-23: "needs logged as lunches or unaccounted for time", the day
    // should read complete, not like a chunk is silently missing), but the
    // `unpaid` flag keeps it OUT of the hours record: _tlComputeWeeklyRunning
    // and _tlComputeOT both skip unpaid minutes, so a lunch break never
    // becomes paid time or pushes someone into overtime they never worked.
    const isUnpaid=typeof _geoIsOffJobSource==='function'&&_geoIsOffJobSource(e.source);
    // A drive leg outside the workday window is a personal trip the tracker
    // happened to catch, not work (owner 2026-08-24, the Tue 8/18 family
    // pictures run: "it should be dropped"). Only drives can land outside the
    // window, since job and place visits are what define it, so this can never
    // hide on-site time. js/geo-track.js _geoRowInWorkday carries the rule.
    if(typeof _geoIsDriveSource==='function'&&_geoIsDriveSource(e.source)&&
       typeof _geoRowInWorkday==='function'){
      const _dday=(typeof _ctDateStr==='function')?_ctDateStr(new Date(e.arrived_at)):dateKey(new Date(e.arrived_at));
      if(!_geoRowInWorkday(e.arrived_at,e.departed_at,((_shopCut[e.employee_user_id]||{})[_dday])||null))return;
    }
    // The anchor rule (owner 2026-08-24, see _tlStopAnchored above): an
    // unpaid stop with no real location event on both sides of it that same
    // Central day never renders at all.
    if(isUnpaid&&!_tlStopAnchored(Date.parse(e.arrived_at),Date.parse(e.departed_at||e.arrived_at),anchorsByUid[e.employee_user_id]||[]))return;
    const info=_tlJobClientInfo(e.job_id);
    // dest_place is the actual name behind a job_id:null row (a supply
    // house, a home office, an unscheduled client visit, or wherever a
    // drive leg ended); without it the row showed a bare '-' with nothing
    // to tell you what it was (owner report: reads as unlabeled noise). A
    // real job always wins when job_id resolved to one.
    const clientName=(info.clientName!=='-')?info.clientName:(e.dest_place||info.clientName);
    rows.push({
      id:'a'+e.job_id+'_'+e.employee_user_id+'_'+e.arrived_at,
      source:'auto',date:(typeof _ctDateStr==='function')?_ctDateStr(new Date(e.arrived_at)):e.arrived_at.slice(0,10),
      minutes:e.minutes||0,personName:crew.name[e.employee_user_id]||'Crew',personUid:e.employee_user_id,
      clientName,addr:info.addr,jobName:info.jobName,clientKey:e.client_key||null,unpaid:isUnpaid,
      detail:(typeof _tlSourceLabel==='function')?_tlSourceLabel(e.source):(e.source||''),
      startTime:e.arrived_at||null,endTime:e.departed_at||null,
      // The server row id and its raw source, so a wrong GPS clock can be
      // corrected in place (owner rule 2026-08-24). rawSource is the raw
      // column, unlike `detail` which is the friendly label.
      rawId:e.id!=null?e.id:null,rawSource:e.source||''
    });
  });
  return _tlFillUnaccounted(_tlAbsorbGaps(rows)).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
}
function _tlYears(rows){
  const years=[...new Set(rows.map(r=>(r.date||'').slice(0,4)).filter(y=>/^\d{4}$/.test(y)))].sort((a,b)=>b.localeCompare(a));
  if(!years.length)years.push(String(new Date().getFullYear()));
  return years;
}
// Sunday of the week containing dateStr, the grouping key for weekly totals
// and overtime. Payroll periods vary (weekly/biweekly/semimonthly), but every
// one of them is built from calendar weeks, so this is the one grouping that's
// never wrong to offer.
function _tlWeekKey(dateStr){
  if(!dateStr)return '';
  const d=new Date(dateStr+'T00:00:00');
  if(isNaN(d.getTime()))return '';
  d.setDate(d.getDate()-d.getDay());
  return dateKey(d);
}
// Overtime: federal (FLSA) is per-person, per-week, over 40 hours, the one
// rule that's true everywhere. Daily OT (e.g. CA/AK/NV/CO over 8hrs/day) is
// state-specific; asserting it as a default would be actively wrong for most
// contractors, so this deliberately only flags the universal rule and leaves
// the rest to "verify with your state," same disclaimer pattern as the tax
// tool. Mutates rows in place (adds weekOT), cheap, avoids a second pass in
// every row renderer.
function _tlComputeOT(rows){
  const byWeek={};
  rows.forEach(r=>{
    if(r.unpaid)return;   // a lunch/off-job stop is tracked, never paid, never OT
    const key=(r.personUid||'owner')+'|'+_tlWeekKey(r.date);
    byWeek[key]=(byWeek[key]||0)+(r.minutes||0);
  });
  rows.forEach(r=>{
    const key=(r.personUid||'owner')+'|'+_tlWeekKey(r.date);
    r.weekOT=byWeek[key]>2400;
  });
}
// Running weekly total for payroll: "as of this day, how many hours has this
// person logged so far this week", computed chronologically (oldest day
// first) per person per week regardless of display order (rows render
// newest-first). Granularity is per-DAY, not per-entry: every entry on the
// same day for the same person shows the same running total (the total
// through the end of that day), since GPS entries don't always carry a
// reliable intra-day ordering to split on. Mutates rows in place.
function _tlComputeWeeklyRunning(rows){
  const dayTotals={}; // 'person|date' -> minutes that day
  rows.forEach(r=>{
    if(r.unpaid)return;   // a lunch/off-job stop never feeds the paid running total
    const k=(r.personUid||'owner')+'|'+r.date;
    dayTotals[k]=(dayTotals[k]||0)+(r.minutes||0);
  });
  const weekDays={}; // 'person|weekKey' -> Set of dates
  Object.keys(dayTotals).forEach(k=>{
    const sep=k.indexOf('|');
    const person=k.slice(0,sep),date=k.slice(sep+1);
    const wk=person+'|'+_tlWeekKey(date);
    (weekDays[wk]=weekDays[wk]||new Set()).add(date);
  });
  const runningThroughDay={}; // 'person|date' -> cumulative minutes through that day
  Object.keys(weekDays).forEach(wk=>{
    const person=wk.slice(0,wk.indexOf('|'));
    const dates=[...weekDays[wk]].sort();
    let running=0;
    dates.forEach(date=>{
      running+=dayTotals[person+'|'+date]||0;
      runningThroughDay[person+'|'+date]=running;
    });
  });
  rows.forEach(r=>{
    const k=(r.personUid||'owner')+'|'+r.date;
    r.weekRunningMin=runningThroughDay[k]||0;
  });
}
// ── The timesheet runs on the BUSINESS's clock, never the phone's ──────────
// Owner, 2026-08-24, from a plane seat: "I'm traveling right now and went back
// an hour so my times went from 8 and 10:30 to 7 and 9:30, how do we prevent
// that?" He worked 8:00-10:30 in Topeka; his phone landed in Denver and every
// clock time on the log slid an hour earlier.
//
// This was device-local formatting, so the same day's work read differently
// depending on where the person happened to be standing when they opened the
// app, and the CSV export used the same function, so a payroll record changed
// with the exporter's location. The DAY grouping was already pinned to Central
// (_ctDateStr, js/finance.js), so travel also split the log against itself:
// days in one zone, times in another, and near midnight they disagree outright.
//
// Hours are a fact about when work happened, not about where the phone is now.
// One zone for the whole log: display, the Fix dialog, and the export.
//
// Reads S.bizTz so this stops being a Kansas assumption the day a contractor in
// another state signs up, and falls back to the same Central zone _ctDateStr
// already hardcodes so the two can never disagree today.
// Derived from the business ADDRESS, once, and shared with every other screen
// (bizTz in js/utils.js). This used to hold its own copy of the rule, which is
// how the Time Log and the dashboard could have ended up disagreeing about the
// same drive.
function _tlBizTz(){
  if(typeof bizTz==='function')return bizTz();
  return 'America/Chicago';
}
// Formats an ISO timestamp as a plain clock time ("8:02 AM"). Used for both
// the Clock In/Clock Out columns and the CSV export, one place so the two
// never drift out of format with each other.
function _tlFmtTime(iso){
  if(!iso)return '';
  const d=new Date(iso);
  if(isNaN(d.getTime()))return '';
  if(typeof bizTime==='function')return bizTime(d);
  try{return d.toLocaleTimeString('en-US',{timeZone:_tlBizTz(),hour:'numeric',minute:'2-digit'});}
  catch(_e){return d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});}
}
// 'YYYY-MM-DDTHH:MM' in business time, for a datetime-local input's value.
function _tlBizInputValue(iso){
  try{
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:_tlBizTz(),hour12:false,
      year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).formatToParts(new Date(iso));
    const g=t=>(parts.find(p=>p.type===t)||{}).value;
    let hh=g('hour'); if(hh==='24')hh='00';
    return g('year')+'-'+g('month')+'-'+g('day')+'T'+hh+':'+g('minute');
  }catch(_e){return '';}
}
// The inverse: a wall-clock string the person TYPED, read as business time,
// back to the actual instant. Formatting the naive guess back through the zone
// and measuring how far it drifted is what finds the offset, so this carries
// CDT/CST itself rather than a hand-maintained number.
function _tlBizInputToIso(local){
  const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(local||''));
  if(!m)return null;
  const naive=Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5]);
  try{
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:_tlBizTz(),hour12:false,
      year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'})
      .formatToParts(new Date(naive));
    const g=t=>+((parts.find(p=>p.type===t)||{}).value);
    let hh=g('hour'); if(hh===24)hh=0;
    const back=Date.UTC(g('year'),g('month')-1,g('day'),hh,g('minute'),g('second'));
    return new Date(naive+(naive-back)).toISOString();
  }catch(_e){return new Date(naive).toISOString();}
}
let _tlLastRows=[];
// Split from the actual CSV build below so the build logic stays independently
// testable (tests/e2e-timelog.spec.js calls _tlDoExportCSV directly).
async function _tlExportCSV(){
  _tlDoExportCSV();
}
function _tlDoExportCSV(){
  if(!_tlLastRows.length){typeof showToast==='function'&&showToast('No time entries to export for '+_tlYear,'📋');return;}
  const esc=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"';
  const header=['Date','Person','Job Address','Client','Job','Task','Source','Clock In','Clock Out','Minutes','Duration','Week Total','Overtime'];
  const lines=[header.map(esc).join(',')];
  _tlLastRows.slice().sort((a,b)=>(a.date||'').localeCompare(b.date||'')).forEach(r=>{
    lines.push([
      r.date||'',r.personName||'',r.addr||'',r.clientName||'',r.jobName||'',r.detail||'',
      r.source==='auto'?'Auto (GPS)':'Manual',
      _tlFmtTime(r.startTime),_tlFmtTime(r.endTime),
      r.minutes||0,
      typeof _fmtMin==='function'?_fmtMin(r.minutes):(r.minutes||0)+'m',
      typeof _fmtMin==='function'?_fmtMin(r.weekRunningMin||0):(r.weekRunningMin||0)+'m',
      r.weekOT?'40+ hrs/wk':''
    ].map(esc).join(','));
  });
  const biz=(typeof S!=='undefined'&&S.bname)?S.bname:'TradeDesk';
  const fname=(biz+'_TimeLog_'+_tlYear+'.csv').replace(/[/,\s]+/g,'_');
  if(typeof downloadFile==='function')downloadFile(fname,lines.join('\n'),'text/csv');
  typeof showToast==='function'&&showToast('Time Log exported, '+_tlYear,'📋');
}
let _tlYear=null;
function _tlPopulateYearSel(years){
  const sel=document.getElementById('tl-year-sel');if(!sel)return;
  const cur=(_tlYear&&years.includes(_tlYear))?_tlYear:years[0];
  _tlYear=cur;
  sel.innerHTML=years.map(y=>'<option value="'+y+'"'+(y===cur?' selected':'')+'>'+y+'</option>').join('');
}
function setTimeLogYear(yr){_tlYear=String(yr);renderTimeLog();}
// Manual entries only, GPS-verified auto entries aren't user-editable, same as
// every competitor researched (editing GPS-verified data would defeat its
// purpose). Own entries always editable/deletable; others' only with the same
// payroll permission Job Profit/Crew Cost already gate on. This is a DATA
// ACCESS rule, independent of the Me/Team display toggle below: a manager can
// edit anyone's entry whether they're currently looking at Me or Team.
function _tlCanEdit(r){
  if(r.source!=='manual')return false;
  if(typeof _canViewComp==='function'&&_canViewComp())return true;
  const myUid=(typeof _isEmployee!=='undefined'&&_isEmployee&&typeof _supaUser!=='undefined'&&_supaUser)?_supaUser.id:null;
  return r.personUid===myUid;
}
// A GPS row's clock can be wrong, and until now nothing in the app could fix
// it (owner report 2026-08-24: a visit read "1:06pm to 9:37pm" because the
// app woke at 9:37 and stamped the close with `now`, and the owner had no
// way to correct it, every fix had to be hand-written into a one-off repair
// keyed to that exact row id, which does not scale for him).
//
// ON-SITE rows only. A drive row's minutes are tied to a mileage leg that
// _geoSyncDriveTimeEntries checks against (and the IRS log is measured, not
// typed), and an unpaid stop is not payroll, so neither is editable here.
// Payroll permission is required, same gate the Team view already uses:
// correcting a clock is a money decision, never a field worker's own call.
function _tlCanFixAuto(r){
  if(r.source!=='auto'||r.rawId==null||r.unpaid)return false;
  const s=String(r.rawSource||'');
  if(!(/^(geofence|place)$/.test(s)||/^(geofence|place)-/.test(s)))return false;
  return !!(typeof _canViewComp==='function'&&_canViewComp());
}
// Correct a GPS row's clock. Same modal shape and the same validation as
// _openEditTimeEntry (js/jobs.js) for manual rows (§7.3, one edit experience,
// not two), but this row lives in job_time_entries on the server rather than
// in the local timeEntries array, so it is read and written directly.
// Values are re-read from the server on open rather than trusted from the
// rendered table, which may be a sweep behind.
async function _openFixAutoEntry(rowId){
  if(!(typeof _canViewComp==='function'&&_canViewComp()))return;
  if(!window._supa||!window._supaUser)return;
  let row=null;
  try{
    const{data,error}=await _supa.from('job_time_entries')
      .select('id,arrived_at,departed_at,job_id,dest_place').is('deleted_at',null).eq('id',String(rowId)).maybeSingle();
    if(!error)row=data;
  }catch(_e){}
  if(!row||!row.arrived_at){if(typeof showToast==='function')showToast('Could not load that entry');return;}
  const info=(typeof _tlJobClientInfo==='function')?_tlJobClientInfo(row.job_id):{clientName:'-'};
  const who=(info&&info.clientName&&info.clientName!=='-')?info.clientName:(row.dest_place||'this visit');
  document.querySelectorAll('.zmodal-overlay').forEach(o=>o.remove());
  const overlay=document.createElement('div');overlay.className='zmodal-overlay';
  const box=document.createElement('div');box.className='zmodal';
  // Business time, not the phone's: prefilling in the device's zone would hand
  // someone a wrong baseline to "correct" from the moment they left the state.
  const toLocalInput=iso=>_tlBizInputValue(iso);
  box.innerHTML='<div style="font-size:17px;font-weight:800;margin-bottom:4px">'+svgIcon('✏',{size:18})+' Fix clock times</div>'+
    '<div style="font-size:13px;color:var(--text3);margin-bottom:14px">'+escHtml(who)+', tracked by GPS</div>'+
    '<div class="f" style="margin-bottom:12px"><label style="font-size:11px;font-weight:700;color:var(--text3)">Clock in</label>'+
      '<input type="datetime-local" id="tlf-start" value="'+toLocalInput(row.arrived_at)+'" style="width:100%;box-sizing:border-box;padding:10px 12px;border:1.5px solid var(--border2);border-radius:var(--r);font-size:14px;font-family:inherit;background:var(--bg2);color:var(--text)"></div>'+
    '<div class="f" style="margin-bottom:16px"><label style="font-size:11px;font-weight:700;color:var(--text3)">Clock out</label>'+
      '<input type="datetime-local" id="tlf-end" value="'+toLocalInput(row.departed_at||row.arrived_at)+'" style="width:100%;box-sizing:border-box;padding:10px 12px;border:1.5px solid var(--border2);border-radius:var(--r);font-size:14px;font-family:inherit;background:var(--bg2);color:var(--text)"></div>'+
    '<div id="tlf-err" style="display:none;font-size:11px;color:#A32D2D;margin-bottom:10px">End must be after start.</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'+
      '<button onclick="closeTopModal()" style="padding:12px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;color:var(--text)">Cancel</button>'+
      '<button onclick="_saveFixedAutoEntry(\''+escHtml(String(rowId))+'\')" style="padding:12px;border-radius:var(--r);border:none;background:var(--green);color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit">Save</button>'+
    '</div>';
  overlay.appendChild(box);document.body.appendChild(overlay);
  overlay.addEventListener('click',ev=>{if(ev.target===overlay)overlay.remove();});
}
async function _saveFixedAutoEntry(rowId){
  const startEl=document.getElementById('tlf-start'),endEl=document.getElementById('tlf-end');
  const errEl=document.getElementById('tlf-err');
  // Read as business time. new Date('...T17:00') parses in the DEVICE's zone,
  // so a correction typed in Denver would have landed an hour off in Topeka.
  const sIso=startEl?_tlBizInputToIso(startEl.value):null,eIso=endEl?_tlBizInputToIso(endEl.value):null;
  const start=sIso?new Date(sIso):null,end=eIso?new Date(eIso):null;
  const bad=m=>{if(errEl){errEl.textContent=m;errEl.style.display='block';}};
  if(!start||!end||isNaN(start.getTime())||isNaN(end.getTime())||end<=start)return bad('End must be after start.');
  // The same physical-impossibility rule the Time Log already flags days by
  // (owner rule 2026-08-24): a hand-typed correction must not be able to
  // create the very thing the flag exists to catch.
  const mins=Math.round((end.getTime()-start.getTime())/60000);
  if(mins>1440)return bad('One entry cannot be longer than 24 hours.');
  if(typeof _ctDateStr==='function'&&_ctDateStr(start)!==_ctDateStr(end))return bad('An entry has to start and end on the same day.');
  if(!window._supa||!window._supaUser)return bad('Not connected.');
  try{
    // client_key moves to a 'fixed-' key: that is what tells every sweep
    // (dedup, merge) this row is a human clock record now and must never be
    // widened, trimmed, or folded into a neighbor again.
    const{error}=await _supa.from('job_time_entries')
      .update({arrived_at:start.toISOString(),departed_at:end.toISOString(),minutes:mins,client_key:'fixed-'+rowId})
      .eq('id',String(rowId));
    if(error)return bad('Could not save, try again.');
  }catch(_e){return bad('Could not save, try again.');}
  closeTopModal();
  if(typeof showToast==='function')showToast('Clock times updated');
  if(typeof renderTimeLog==='function')renderTimeLog();
}
function _tlRow(r){
  const canEdit=_tlCanEdit(r);
  // Delete isn't a button here, it's the same 3s hold-to-confirm gesture used
  // everywhere else in the app ([data-lp-id], js/cloud.js). The attributes are
  // only emitted when canEdit is true, so the gesture is simply absent (does
  // nothing) on GPS/auto rows and on entries this person isn't allowed to
  // touch: same visibility rule the Edit button already follows.
  const lpAttrs=canEdit?' data-lp-id="'+r.rawId+'" data-lp-type="timelog" data-lp-label="'+escHtml(r.personName+' · '+r.clientName)+'"':'';
  // Driving vs on-site: the owner couldn't tell the entries apart ("don't
  // understand these many different entries, wish there was a way for it to
  // say drive and be color coded", 2026-08-21). r.detail is already the
  // friendly _tlSourceLabel() text ('Driving'/'Driving (rider)'/etc for a
  // drive-sourced auto row, '' for a geofence/place row), so a driving row
  // is exactly one that starts with it.
  const isAutoDrive=r.source==='auto'&&/^Driving/.test(r.detail||'');
  // Drive rows show FROM and TO locations under Job Site (owner request
  // 2026-08-23: "Time entry drive times should show from and to locations"),
  // not just the bare destination every drive row showed before this. The
  // matching mileage leg is the only place the ORIGIN lives at all,
  // job_time_entries itself never carried one: _geoDriveEntry (js/geo-track.js)
  // stamps ONE deterministic legKey on both the mileage row (legKey) and this
  // row (client_key) the moment the leg closes, so this is a straight lookup,
  // never a re-derivation, same pairing _geoSyncDriveTimeEntries already
  // trusts. Falls back to the plain destination name (the old behavior) when
  // no leg survives locally: mileage not yet loaded for this viewer, or the
  // leg was swept away by a mileage dedup/personal-stop pass.
  const driveLeg=isAutoDrive&&r.clientKey&&typeof mileage!=='undefined'&&Array.isArray(mileage)
    ?mileage.find(m=>m&&m.legKey===r.clientKey):null;
  const driveFromTo=driveLeg?'From: '+(driveLeg.from_name||'—')+' - To: '+(driveLeg.to_name||r.clientName||'—'):null;
  // Job address is the primary line (owner request 2026-07-11: "show the day,
  // job address, person..."): client name/job/task fold into a muted second
  // line along with the source tag, which used to be its own column. The
  // driving row's own detail text is dropped here, the amber badge below
  // already says it, so it is not repeated in plain gray right next to it.
  // A lunch/off-job stop's own detail text is already the "Unpaid" the badge
  // says (owner request 2026-08-23), same not-repeated rule the driving row
  // already follows for its own badge just below.
  // A plain shop row's detail is the literal word the Shop badge already
  // shows, so it is dropped for the same not-repeated reason; the clock-out
  // variant ('Shop · auto clock-out') carries new information and stays.
  // Which half of a home-office visit this row is, or '' for everything else.
  // Read off the RAW column, never the label, for the same reason the weekly
  // split bar now does (see _tlEmpWeekAgg).
  const homeKind=r.source==='auto'
    ?(r.rawSource==='place-load'?'load':r.rawSource==='place-office'?'office':'')
    :'';
  const jobLine=[driveFromTo||r.clientName,(!driveFromTo&&r.jobName&&r.jobName!==r.clientName)?r.jobName:null,(isAutoDrive||r.unpaid||homeKind||r.detail==='Shop')?null:(r.detail||null)]
    .filter(Boolean).map(escHtml).join(' · ');
  // Amber (#9F5B00) is the SAME color drive time already gets in the Team
  // split bar/legend (_tlWeekOwnerHtml above), reused rather than invented
  // (§7.3) so "amber" means "driving" consistently everywhere on this page.
  // Loading and Office are their own badges, never the plain On-site one
  // (owner 2026-08-29: "work is actively being done so it needs counted as
  // its own thing"). Teal is REUSED, not invented: on this page it already
  // means "your own premises, paid, but not job-site labour", which is
  // exactly what both halves of a home-office visit are. Filled chips like
  // the Driving badge, for the same reason that one is filled: this minute
  // is real paid time and it is not on anybody's job.
  // An unaccounted stretch is not an entry, it is the SHAPE OF A HOLE, and it
  // has to read that way at a glance or it becomes just another gray row
  // somebody scrolls past. Dashed accent and a question mark, deliberately
  // unlike every filled badge on this page: nothing here was measured.
  const isGap=r.source==='unaccounted';
  const sourceTag=isGap
    ?'<span style="display:inline-flex;align-items:center;gap:3px;font-weight:700;color:var(--text3)">'+svgIcon('❓',{size:9})+' Unaccounted</span>'
    :homeKind
    ?'<span style="display:inline-flex;align-items:center;gap:3px;font-weight:800;padding:1px 6px;border-radius:4px;background:#0E6B6B22;color:#0E6B6B">'+
       svgIcon(homeKind==='load'?'📦':'📋',{size:9})+' '+(homeKind==='load'?'Loading time':'Office')+'</span>'
    :r.source==='shop'
    ?'<span style="display:inline-flex;align-items:center;gap:3px;font-weight:700;color:#0E6B6B">'+svgIcon('🔧',{size:9})+' Shop</span>'
    :r.unpaid
    ?'<span style="display:inline-flex;align-items:center;gap:3px;font-weight:700;color:var(--text3)">'+svgIcon('🍽',{size:9})+' Unpaid</span>'
    :r.source==='auto'
      ?(isAutoDrive
          ?'<span style="display:inline-flex;align-items:center;gap:3px;font-weight:800;padding:1px 6px;border-radius:4px;background:#9F5B0022;color:#9F5B00">'+svgIcon('🚗',{size:9})+' Driving</span>'
          :'<span style="display:inline-flex;align-items:center;gap:3px;font-weight:700;color:var(--text3)">'+svgIcon('📍',{size:9})+' On-site</span>')
      :'<span style="display:inline-flex;align-items:center;gap:3px;font-weight:700;color:var(--text3)">'+svgIcon('▶',{size:9})+' Manual</span>';
  // Left-edge accent on the whole row, same amber, so "this one's a drive"
  // reads at a glance without hunting for the badge text (a colored border
  // is the other option the ask named alongside a badge; doing both costs
  // nothing and reads clearer on a fast scroll down a long day). Unpaid gets
  // a neutral gray accent, same idea, so it never reads as ordinary paid time
  // on a fast scroll down the day.
  const rowAccent=isGap?' style="border-left:3px dashed var(--border2);opacity:.72"':isAutoDrive?' style="border-left:3px solid #9F5B00"':(r.source==='shop'||homeKind)?' style="border-left:3px solid #0E6B6B"':r.unpaid?' style="border-left:3px solid var(--border2)"':'';
  return '<tr'+lpAttrs+rowAccent+'>'+
    '<td class="bold" data-label="Person">'+escHtml(r.personName)+'</td>'+
    '<td data-label="Job site">'+
      (r.addr?'<div style="font-weight:700">'+escHtml(r.addr)+'</div>':'')+
      '<div class="mute" style="font-size:11px;margin-top:'+(r.addr?'2px':'0')+';display:flex;align-items:center;flex-wrap:wrap;gap:5px">'+(jobLine?'<span>'+jobLine+'</span>':'')+sourceTag+'</div>'+
    '</td>'+
    '<td data-label="Clock In">'+(_tlFmtTime(r.startTime)||'-')+'</td>'+
    '<td data-label="Clock Out">'+(_tlFmtTime(r.endTime)||'-')+'</td>'+
    '<td class="'+(r.unpaid?'mute':'bold')+'" data-label="Duration" style="text-align:right">'+(typeof _fmtMin==='function'?_fmtMin(r.minutes):r.minutes+'m')+
      (r.weekOT?' <span title="'+escHtml(r.personName)+' logged 40+ hrs the week of '+_tlWeekKey(r.date)+', verify overtime eligibility with your state; not payroll advice" style="font-size:9px;font-weight:800;padding:2px 5px;border-radius:4px;background:var(--c-amber-soft);color:var(--c-amber-deep);margin-left:4px;white-space:nowrap">OT WK</span>':'')+
    '</td>'+
    '<td data-label="Week total" style="text-align:right">'+(typeof _fmtMin==='function'?_fmtMin(r.weekRunningMin||0):(r.weekRunningMin||0)+'m')+'</td>'+
    '<td data-label="">'+(isGap?
      '<button onclick="_tlAddUnaccounted(\''+escHtml(r.startTime)+'\',\''+escHtml(r.endTime)+'\')" style="font-size:11px;padding:3px 9px;border-radius:4px;border:1px solid var(--border2);background:var(--bg2);color:var(--text);cursor:pointer;font-family:inherit;font-weight:600">Add</button>'
      :canEdit?
      '<button onclick="_openEditTimeEntry('+r.rawId+')" style="font-size:11px;padding:3px 9px;border-radius:4px;border:1px solid var(--border2);background:var(--bg2);color:var(--text);cursor:pointer;font-family:inherit;font-weight:600">Edit</button>'
      :_tlCanFixAuto(r)?
      '<button onclick="_openFixAutoEntry(\''+escHtml(String(r.rawId))+'\')" style="font-size:11px;padding:3px 9px;border-radius:4px;border:1px solid var(--border2);background:var(--bg2);color:var(--text);cursor:pointer;font-family:inherit;font-weight:600">Fix</button>'
      :'')+'</td>'+
  '</tr>';
}
// ── Adding a hole to the day (owner 2026-08-29) ────────────────────────────
// "unaccounted for time doesn't count to the total unless it's added."
//
// The not-counting half needs no code: an unaccounted row is unpaid, and
// every total on this page already skips unpaid (_tlEmpWeekAgg,
// _tlComputeWeeklyRunning, _tlComputeOT, the day subtotal). So a hole is
// visible and free by construction, which is the honest default: the app
// never bills a stretch it cannot account for.
//
// This is the other half. The contractor is the only one who knows what those
// 104 minutes were, and once he says, it becomes real time like any other
// manual entry. It writes a MANUAL row through the same array and the same
// save path clocking out uses (§7.3), never a new kind of record: it must
// edit, delete, sync and pay exactly like time he keyed in himself, because
// that is what it is.
function _tlAddUnaccounted(startIso,endIso){
  const a=Date.parse(startIso),b=Date.parse(endIso);
  if(!(a>0&&b>a))return;
  if(typeof timeEntries==='undefined'||!Array.isArray(timeEntries))return;
  const mins=Math.max(1,Math.round((b-a)/60000));
  const uid=(typeof _isEmployee!=='undefined'&&_isEmployee&&typeof _supaUser!=='undefined'&&_supaUser)?_supaUser.id:null;
  const name=uid?((typeof _employeeRecord!=='undefined'&&_employeeRecord&&_employeeRecord.name)||'Crew')
                :((typeof getOwnerName==='function'&&getOwnerName())||'Owner (me)');
  timeEntries.push({
    id:(typeof _newId==='function')?_newId():Date.now(),
    job_id:null,
    // The CT date of the START, the same key every other row on this page is
    // filed under. A hole that runs past midnight belongs to the day it began.
    date:(typeof _ctDateStr==='function')?_ctDateStr(new Date(a)):startIso.slice(0,10),
    start_time:new Date(a).toISOString(),end_time:new Date(b).toISOString(),
    minutes:mins,scope_id:null,scope_label:'Added from unaccounted time',
    logged_by_uid:uid,logged_by_name:name,open:false
  });
  if(typeof saveAll==='function')saveAll();
  if(typeof supaSaveToCloud==='function')supaSaveToCloud();
  if(typeof showToast==='function')showToast((typeof _fmtMin==='function'?_fmtMin(mins):mins+'m')+' added to the day','⏱');
  // The gap row is derived, so it simply stops existing on the next build:
  // the span is now covered by a real row and no hole remains to report.
  if(typeof renderTimeLog==='function')renderTimeLog();
}
// Still-clocked-in banner, separate from the year/month/day history below,
// refreshed on its own 30s tick while this page is open so elapsed time keeps
// moving without re-rendering the whole accordion tree. Stops itself the
// moment the page is no longer active (no leaked timers on other pages).
let _tlOpenRefreshTimer=null;
function _tlRenderOpenBanner(){
  const el=document.getElementById('tl-open');if(!el)return;
  const open=_tlOpenEntries();
  const canForce=typeof _canViewComp==='function'&&_canViewComp();
  const myUid=(typeof _isEmployee!=='undefined'&&_isEmployee&&typeof _supaUser!=='undefined'&&_supaUser)?_supaUser.id:null;
  const visible=canForce?open:open.filter(r=>r.personUid===myUid);
  if(!visible.length){el.innerHTML='';el.style.display='none';return;}
  el.style.display='block';
  el.innerHTML='<div class="card" style="margin-bottom:14px;border:1px solid var(--c-green-edge);background:var(--c-green-soft)">'+
    '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--c-green-deep);margin-bottom:6px">'+svgIcon('▶',{size:12})+' Currently clocked in</div>'+
    visible.map(r=>
      // 10+ hrs still open is almost always a forgotten clock-out, not a real
      // shift: flag it so a manager (or the person themselves) notices
      // before it silently becomes a wrong payroll number.
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:7px 0;border-top:1px solid var(--c-green-edge)">'+
        '<div style="min-width:0">'+
          '<div style="font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml(r.personName)+(r.elapsedMin>600?' <span title="Clocked in 10+ hours, likely a forgotten clock-out" style="font-size:9px;font-weight:800;padding:2px 5px;border-radius:4px;background:var(--c-red-soft);color:var(--c-red-deep);margin-left:4px">LONG SHIFT</span>':'')+'</div>'+
          '<div style="font-size:11px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml(r.clientName)+(r.jobName?' · '+escHtml(r.jobName):'')+'</div>'+
          '<div style="font-size:11px;color:var(--text3)">since '+_tlFmtTime(r.startTime)+'</div>'+
        '</div>'+
        '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0">'+
          '<div style="font-size:13px;font-weight:800'+(r.elapsedMin>600?';color:var(--c-red-deep)':'')+'">'+(typeof _fmtMin==='function'?_fmtMin(r.elapsedMin):r.elapsedMin+'m')+'</div>'+
          // Own entry: a real clockOut(): matches _activeTimer by construction
          // (either this device's live session, or restored by
          // _rehydrateActiveTimer() on boot). Someone else's entry: the
          // manager-only force-close, which audit-tags who closed it.
          (r.personUid===myUid?'<button onclick="clockOut();_tlRenderOpenBanner()" class="btn btn-sm" style="font-size:11px">Clock out</button>'
            :canForce?'<button onclick="forceClockOutEntry('+r.rawId+')" class="btn btn-sm" style="font-size:11px">Clock out</button>':'')+
        '</div>'+
      '</div>'
    ).join('')+
  '</div>';
}
function _tlStopOpenRefresh(){if(_tlOpenRefreshTimer){clearInterval(_tlOpenRefreshTimer);_tlOpenRefreshTimer=null;}}
function _tlStartOpenRefresh(){
  _tlStopOpenRefresh();
  _tlRenderOpenBanner();
  _tlOpenRefreshTimer=setInterval(()=>{
    if(!document.getElementById('pg-timelog')?.classList.contains('active')){_tlStopOpenRefresh();return;}
    _tlRenderOpenBanner();
  },30000);
}
// Sunday–Saturday label for a week key ('YYYY-MM-DD' Sunday date), e.g.
// "Week of Mar 9 – 15" (or "Mar 30 – Apr 5" when the week crosses a month).
function _tlWeekLabel(wkStart){
  const s=new Date(wkStart+'T00:00:00');
  if(isNaN(s.getTime()))return 'Week';
  const e=new Date(s);e.setDate(e.getDate()+6);
  const sameMonth=s.getMonth()===e.getMonth();
  const sLabel=s.toLocaleDateString('en-US',{month:'short',day:'numeric'});
  const eLabel=sameMonth?String(e.getDate()):e.toLocaleDateString('en-US',{month:'short',day:'numeric'});
  return 'Week of '+sLabel+' – '+eLabel;
}
// "Mon 3/9" for a day row inside an individual's week body.
function _tlDayShort(dateStr){
  const p=(dateStr||'').split('-').map(Number);
  if(p.length<3||!p[0]||!p[1]||!p[2])return dateStr||'-';
  const d=new Date(p[0],p[1]-1,p[2]);
  if(isNaN(d.getTime()))return dateStr;
  return d.toLocaleDateString('en-US',{weekday:'short'})+' '+p[1]+'/'+p[2];
}
// "Wed, Aug 19" for the day-picker's scope header, one notch more formal than
// _tlDayShort's "Wed 8/19" (used inline next to a job name instead).
function _tlDayFullLabel(dateStr){
  const p=(dateStr||'').split('-').map(Number);
  if(p.length<3||!p[0]||!p[1]||!p[2])return dateStr||'-';
  const d=new Date(p[0],p[1]-1,p[2]);
  if(isNaN(d.getTime()))return dateStr;
  return d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
}
// The 7 calendar dates (Sun..Sat, 'YYYY-MM-DD') for the week starting wkStart.
function _tlWeekDayDates(wkStart){
  const s=new Date(wkStart+'T00:00:00');
  if(isNaN(s.getTime()))return[];
  const out=[];
  for(let i=0;i<7;i++){const d=new Date(s);d.setDate(d.getDate()+i);out.push(dateKey(d));}
  return out;
}
// Per-employee aggregation over any row set (a week, a whole month, or a
// single day): total minutes plus the on-site/drive/supply-run split.
// Manual clock entries are always on-site (that's what a manual clock
// means); auto (GPS) entries classify via the same _geoIsDriveSource/
// _geoIsPlaceSource helpers Crew Cost already uses, so the two reports
// never disagree on what counts as drive time. Off-job stops (owner
// request 2026-08-23, r.unpaid) are explicitly skipped here: this comment
// used to say _timeLogRows already dropped them, which stopped being true
// the moment that row started carrying them through for the Unpaid line
// instead. Keyed by personUid, owner-logged rows (personUid null) fold
// under `cid` so every owner entry lands in one bucket instead of
// scattering under an undefined key.
function _tlEmpWeekAgg(rows,cid){
  const byEmp={};
  rows.forEach(r=>{
    if(r.unpaid)return;
    const uid=r.personUid||cid;
    const e=byEmp[uid]||(byEmp[uid]={min:0,onsiteMin:0,driveMin:0,placeMin:0,shopMin:0,weekOT:false,name:r.personName});
    e.min+=r.minutes||0;
    if(r.weekOT)e.weekOT=true;
    // Shop/yard dwell is its own bucket (owner request 2026-08-24): it is paid
    // like Crew Cost pays it, but it is NOT job-site labor and must never
    // inflate that number on the split bar.
    // rawSource, NOT detail (fixed 2026-08-29). The comment above has always
    // said these classify through the same two predicates Crew Cost uses, so
    // the two reports can never disagree. They did. `detail` is the FRIENDLY
    // label, so a drive leg arrived here as the string 'Driving' and was
    // tested against /^drive/, which is case-sensitive and never matched, and
    // a place visit arrived as '' and was tested against ==='place'. Both
    // fell through to the else, so every GPS drive leg and every supply-house
    // visit has been counting as ON-SITE JOB LABOR on the split bar while
    // Crew Cost, reading the raw column, put them in overhead. rawSource is
    // the raw column and is already on the row for exactly this reason.
    const _src=r.rawSource||'';
    if(r.source==='shop')e.shopMin+=r.minutes||0;
    else if(r.source==='manual')e.onsiteMin+=r.minutes||0;
    else if(typeof _geoIsDriveSource==='function'&&_geoIsDriveSource(_src))e.driveMin+=r.minutes||0;
    else if(typeof _geoIsPlaceSource==='function'&&_geoIsPlaceSource(_src))e.placeMin+=r.minutes||0;
    else e.onsiteMin+=r.minutes||0;
    if(!e.name&&r.personName)e.name=r.personName;
  });
  return byEmp;
}
// Fixed bg/fg pairs (not app color tokens): these are decorative per-person
// wayfinding colors, not brand/semantic ones, so a small standalone palette
// is simpler than trying to derive tinted backgrounds from CSS custom
// properties. Picked from colors already used elsewhere in the app (blue,
// green, amber-deep) plus a couple of neighbors for variety on bigger crews.
const _TL_AVATAR_PALETTE=[
  {bg:'#2D5DA822',fg:'#2D5DA8'},{bg:'#0E6B3922',fg:'#0E6B39'},{bg:'#7C3AED22',fg:'#7C3AED'},
  {bg:'#9F5B0022',fg:'#9F5B00'},{bg:'#BE185D22',fg:'#BE185D'},{bg:'#0891B222',fg:'#0891B2'}
];
function _tlAvatarPalette(name){
  let h=0;const s=String(name||'');
  for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))>>>0;
  return _TL_AVATAR_PALETTE[h%_TL_AVATAR_PALETTE.length];
}
// "Owner (me)" is a placeholder label, not a real name, initials() turns it
// into a broken "O(" (first letters of "Owner" and "(me)"), so special-case it.
function _tlAvatarLabel(name){
  return name==='Owner (me)'?'Me':(typeof initials==='function'?initials(name):(name||'?').slice(0,2));
}
// Owner/manager Team-scope summary: one row per employee, hours + on-site/
// drive/supply split, no dollars ("don't need pay rate here just time"). $
// cost still lives in Crew Cost (_crewCostRender); this is purely a time
// report. Works on any row subset (a whole week or one drilled-down day),
// the caller decides the scope. selfUid tags the viewer's own row "(you)".
function _tlWeekOwnerHtml(byEmp,selfUid){
  const uids=Object.keys(byEmp).sort((a,b)=>byEmp[b].min-byEmp[a].min);
  const fm=typeof _fmtMin==='function'?_fmtMin:(m=>m+'m');
  return uids.map(uid=>{
    const e=byEmp[uid];
    const name=e.name||'Crew';
    const pal=_tlAvatarPalette(name);
    const parts=[];
    if(e.onsiteMin>3)parts.push('On-site '+fm(e.onsiteMin));
    if(e.driveMin>3)parts.push('Drive '+fm(e.driveMin));
    if(e.placeMin>3)parts.push('Supply/other '+fm(e.placeMin));
    if((e.shopMin||0)>3)parts.push('Shop '+fm(e.shopMin));
    const total=(e.onsiteMin+e.driveMin+e.placeMin+(e.shopMin||0))||1;
    const pOn=(e.onsiteMin/total*100).toFixed(1),pDr=(e.driveMin/total*100).toFixed(1),pPl=(e.placeMin/total*100).toFixed(1),
          pSh=((e.shopMin||0)/total*100).toFixed(1);
    const otBadge=e.weekOT?'<span class="tl-ot-badge" title="'+escHtml(name)+' logged 40+ hrs this week, verify overtime eligibility with your state; not payroll advice">OT</span>':'';
    const youTag=(selfUid&&String(uid)===String(selfUid))?' <span style="color:var(--text3);font-weight:600;font-size:11px">(you)</span>':'';
    return '<div class="tl-emp-row'+(e.weekOT?' ot':'')+'">'+
      '<div class="tl-avatar" style="background:'+pal.bg+';color:'+pal.fg+'">'+escHtml(_tlAvatarLabel(name))+'</div>'+
      '<div class="tl-emp-mid"><div class="tl-emp-name-row"><span class="tl-emp-name">'+escHtml(name)+'</span>'+youTag+otBadge+'</div>'+
        '<div class="tl-split"><div class="tl-split-bar"><span style="width:'+pOn+'%;background:var(--blue)"></span><span style="width:'+pDr+'%;background:#9F5B00"></span><span style="width:'+pPl+'%;background:var(--text3)"></span><span style="width:'+pSh+'%;background:var(--c-teal,#0E6B6B)"></span></div>'+
        '<div class="tl-split-legend">'+parts.join(' · ')+'</div></div></div>'+
      '<div class="tl-emp-total">'+fm(e.min)+'</div>'+
    '</div>';
  }).join('');
}
// Me-scope EXTRA, under the shared split-bar row: your own days listed out.
// Not an alternative to the team component (see _tlRenderWeekBody), an
// addition, and the one thing Me shows that Team cannot, since a team day
// mixes several people. Week selections only.
function _tlWeekMineHtml(rows){
  const byDay={};
  rows.forEach(r=>{
    if(r.unpaid)return;   // off-job time never counts toward a worked day's total
    const d=r.date||'unknown';
    const e=byDay[d]||(byDay[d]={min:0,labels:new Set()});
    e.min+=r.minutes||0;
    if(r.clientName)e.labels.add(r.clientName);
  });
  const days=Object.keys(byDay).sort();
  return days.map(d=>{
    const e=byDay[d];const labels=[...e.labels];
    const label=labels.length===1?labels[0]:(labels.length>1?labels.length+' stops':'');
    // Owner report 2026-08-23: a reconciliation bug once summed one real
    // calendar day to 47+ hours, and it rendered as a perfectly normal-
    // looking number. One person cannot log more than 1440 minutes (24h)
    // in one day; that is a physical fact, not a business rule, so it is
    // never a "maybe" and never silently trusted. Flagged, not clamped:
    // showing the raw wrong number (instead of a guessed-correct one)
    // is what makes the underlying data bug findable and reportable.
    const impossible=e.min>1440;
    const amt=(typeof _fmtMin==='function'?_fmtMin(e.min):e.min+'m');
    return '<div style="display:flex;justify-content:space-between;font-size:11.5px;color:var(--text3);padding:3px 0">'+
      '<span>'+_tlDayShort(d)+(label?' · '+escHtml(label):'')+'</span>'+
      (impossible
        ?'<span style="font-weight:800;color:var(--c-red-deep)" title="'+escHtml(amt)+' in one day is not physically possible, this entry needs review">'+svgIcon('⚠',{size:11})+' Data error</span>'
        :'<span style="font-weight:700;color:var(--text)">'+amt+'</span>')+
    '</div>';
  }).join('');
}
// Per-week render state. Keyed by "mo|wk" (a week can straddle two calendar
// months, so mo alone or wk alone can't be trusted as a unique key on their
// own; see the cache population in renderTimeLog). Populated fresh every
// renderTimeLog() call; setTimeLogDayPick reads it later, outside that call,
// to redraw just one week's body without re-rendering the whole page (which
// would otherwise blow away every other month/week the viewer had opened).
let _tlWeekCache={};
// Which chip (day picker) is selected per week, 'week' or a weekday index
// '0'..'6'. Deliberately NOT reset on scope/year switches: staying on the
// same weekday when you flip Me/Team, or paging between weeks, reads as
// continuity, not a bug.
let _tlPickerSel={};
function setTimeLogDayPick(cacheKey,sel){
  const cache=_tlWeekCache[cacheKey];if(!cache)return;
  _tlPickerSel[cacheKey]=sel;
  const el=document.getElementById(cache.domId);
  if(el)el.innerHTML=_tlRenderWeekBody(cacheKey);
}
// Builds one week's inner content: the Week/S/M/T/W/T/F/S picker, the
// current scope's total, the Team/Me summary for whatever's picked, and the
// entries table (Edit/Delete on manual rows) scoped to the same picked range.
function _tlRenderWeekBody(cacheKey){
  const cache=_tlWeekCache[cacheKey];if(!cache)return '';
  const{mo,wk,rows:weekRows,scope,cid,selfUid}=cache;
  const fm=typeof _fmtMin==='function'?_fmtMin:(m=>m+'m');
  const sel=_tlPickerSel[cacheKey]||'week';
  const days=_tlWeekDayDates(wk);
  const workedIdx=new Set(weekRows.map(r=>days.indexOf(r.date)).filter(i=>i>=0));
  const pickerHtml='<div class="tl-picker">'+
    '<button class="tl-chip wk'+(sel==='week'?' active':'')+'" onclick="setTimeLogDayPick(\''+cacheKey+'\',\'week\')">Week</button>'+
    ['S','M','T','W','T','F','S'].map((d,i)=>
      '<button class="tl-chip'+(sel===String(i)?' active':'')+'" onclick="setTimeLogDayPick(\''+cacheKey+'\',\''+i+'\')">'+d+
        (workedIdx.has(i)?'<span class="tl-dot"></span>':'')+
      '</button>'
    ).join('')+
  '</div>';
  let scopeRows,scopeLabel;
  if(sel==='week'){scopeRows=weekRows;scopeLabel=_tlWeekLabel(wk);}
  else{const d=days[parseInt(sel,10)]||'';scopeRows=weekRows.filter(r=>r.date===d);scopeLabel=_tlDayFullLabel(d);}
  const scopeMin=scopeRows.reduce((s,r)=>s+(r.minutes||0),0);
  const scopeHdHtml='<div class="tl-scope-hd"><div class="tl-scope-ttl">'+escHtml(scopeLabel)+'</div><div class="tl-scope-amt">'+fm(scopeMin)+'</div></div>';
  let summaryHtml;
  if(!scopeRows.length){
    summaryHtml='<div class="tl-empty">No hours logged '+(sel==='week'?'this week.':'this day.')+'</div>';
  }else{
    // ONE component for both scopes (owner rule 2026-08-26: "everything on the
    // team should be the exact same thing on me, same code, same constant,
    // only difference is the fact me is just me and team is everybody").
    //
    // Me used to render something else entirely: a plain per-day list with a
    // total and no split bar, so the one person who most wants to know how
    // much of their day went to driving was the only person who could not see
    // it. _tlEmpWeekAgg already works on any row subset, and in Me scope that
    // subset is one person, so the same call produces a one-row version of the
    // team view for free. No second layout to keep in step.
    summaryHtml=_tlWeekOwnerHtml(_tlEmpWeekAgg(scopeRows,cid),selfUid);
    // The per-day breakdown stays, as an ADDITION rather than an alternative:
    // it is the one thing Me has that Team cannot (a team day legitimately
    // mixes several people), and deleting it to force symmetry would lose
    // information nobody asked to lose. Week selections only; on a single day
    // the entries table below already lists every row.
    if(sel==='week')summaryHtml+=_tlWeekMineHtml(scopeRows);
  }
  // Entries: the only place a manual clock entry can still be edited or
  // deleted (Edit button, _tlRow), scoped to whatever the picker currently
  // shows (a whole week or one day) instead of always the whole week.
  // Newest entry first within a day, oldest at the bottom (owner request
  // 2026-08-21). _bkRenderDays groups by day but otherwise renders rows in
  // whatever order they arrive, so the sort happens here rather than in that
  // shared helper (Income/Expenses/Client timeline all read it unchanged).
  const entryRows=scopeRows.slice().sort((a,b)=>(b.startTime||'').localeCompare(a.startTime||''));
  // Same impossible-day guard as _tlWeekMineHtml, applied to this
  // accordion's own per-day header (owner report 2026-08-23). Only in Me
  // scope: a Team-scope day legitimately combines several people's hours
  // and can exceed 24h with nobody's individual day being wrong, so the
  // default dr.length+total meta stays untouched there.
  const entriesHtml=scopeRows.length?
    '<div style="margin-top:10px;padding-top:8px;border-top:1px dashed var(--line)">'+
      '<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin:0 2px 6px">Entries</div>'+
      _bkRenderDays('tl',mo,entryRows,['Person','Job site','Clock In','Clock Out','Duration','Week total'],_tlRow,680,'var(--text)',r=>r.minutes||0,fm,
        scope==='team'?undefined:{metaFn:dr=>{
          const min=dr.filter(r=>!r.unpaid).reduce((s,r)=>s+(r.minutes||0),0);
          const amt=fm(min);
          return min>1440
            ?'<span style="font-weight:800;color:var(--c-red-deep)" title="'+escHtml(amt)+' in one day is not physically possible, this entry needs review">'+svgIcon('⚠',{size:11})+' Data error</span>'
            :dr.length+' · '+amt;
        }})+
    '</div>':'';
  return pickerHtml+scopeHdHtml+'<div style="padding:0 2px 4px">'+summaryHtml+'</div>'+entriesHtml;
}
// Me/Team display toggle, for anyone with payroll/team permission. Owners
// default to Team, managers default to Me (see renderTimeLog); either can
// switch any time and the choice sticks for the rest of the session, same
// as _tlYear. A permission loss (e.g. a dual-hat switch to a crew hat with
// no payroll access) can never leave scope stuck on 'team', renderTimeLog
// clamps it back to 'me' every render.
let _tlScope=null;
function setTimeLogScope(scope){
  if(scope!=='me'&&scope!=='team')return;
  _tlScope=scope;
  renderTimeLog();
}
// "Share this week's hours" (Me scope only, any role): the current Sun–Sat
// week, own rows only. _tlLastRows is only ever populated with Me-scoped
// rows while the Share button is visible (renderTimeLog hides the button
// entirely in Team scope), so no re-filtering by uid is needed here.
async function _tlShareWeek(){
  const wkStart=new Date();wkStart.setHours(0,0,0,0);wkStart.setDate(wkStart.getDate()-wkStart.getDay());
  const wkEnd=new Date(wkStart);wkEnd.setDate(wkEnd.getDate()+6);
  const wkStartStr=dateKey(wkStart),wkEndStr=dateKey(wkEnd);
  const rows=_tlLastRows.filter(r=>r.date>=wkStartStr&&r.date<=wkEndStr);
  if(!rows.length){typeof showToast==='function'&&showToast('No hours logged this week yet','📋');return;}
  const byDay={};
  rows.forEach(r=>{byDay[r.date]=(byDay[r.date]||0)+(r.minutes||0);});
  const totalMin=rows.reduce((s,r)=>s+(r.minutes||0),0);
  const lines=Object.keys(byDay).sort().map(d=>_tlDayShort(d)+': '+(typeof _fmtMin==='function'?_fmtMin(byDay[d]):byDay[d]+'m'));
  const text='My hours this week ('+_tlWeekLabel(wkStartStr)+')\n'+lines.join('\n')+'\nTotal: '+(typeof _fmtMin==='function'?_fmtMin(totalMin):totalMin+'m');
  if(typeof pwaShare==='function')await pwaShare({title:'This week\'s hours',text});
}
// ── The repair pass, moved OFF the critical path (owner report 2026-08-26:
// "why the slowness on time log where skeleton takes forever") ──────────────
//
// All of this used to run BEFORE the first fetch, so the skeleton sat through
// three reconciler passes with 150ms waits between them, a write-queue drain,
// and a full cleanup sweep, and only then did the page ask the server for the
// hours it was there to show. Each of those does its own round trips, so on a
// truck connection the wait was seconds of shimmer for work the viewer never
// asked for.
//
// It still all runs, and still on every open, for the reasons each block
// documents. It just runs AFTER the hours are on screen. CLAUDE.md 8.3 is
// explicit that a slow reveal is never the answer to async data: paint
// instantly, repaint once when the real thing lands.
async function _tlRepairPass(){
    // Catch up any already-closed gap before showing hours. _geoReconcileSoon's
    // periodic trigger only ever fires from a LIVE GPS watcher (js/geo-track.js:
    // "if(_geoWatchId==null&&_geoNativeWatcherId==null)return;"), so a gap left
    // by a drive that already finished never gets backfilled once tracking goes
    // quiet (owner report 2026-08-21: hours still missing on reopening Time Log
    // well after the job). Opening this page is an explicit, deliberate look at
    // hours, not ambient background noise, so it calls the reconciler directly
    // instead of waiting on a live ping stream that may never come again today.
    //
    // An explicit false means the pass was SKIPPED (a GPS ping was mid-flight,
    // exactly when a phone with live tracking opens this page right after a
    // drive), not that it ran and found nothing: retry briefly rather than
    // silently never repairing this visit (owner report 2026-08-21, round two).
    // Then drain the write queue, so a row the reconciler just enqueued is on
    // the server BEFORE _timeLogRows fetches: without this the repair raced its
    // own render and only showed up on the NEXT visit to this page.
    if(typeof _geoReconcileFromMileage==='function'){
      try{
        // 150ms, not 350ms: three attempts at the old backoff held the skeleton
        // on screen for up to ~1050ms in the worst case (owner report
        // 2026-08-23: skeleton "way too long" specifically on this page). Still
        // three tries, same protection against the mid-flight-ping race the
        // retry exists for, just a shorter wait between them.
        for(let _i=0;_i<3;_i++){
          const ran=await _geoReconcileFromMileage();
          if(ran!==false)break;
          await new Promise(res=>setTimeout(res,150));
        }
        if(typeof _geoDrainQueue==='function')await _geoDrainQueue();
      }catch(_e){}
    }
    // The cleanup sweeps are NOT the reconciler's business (owner report
    // 2026-08-25: "still not seeing time log clear the shit that doesn't
    // matter"). The reconciler skips its own tail on three exits that say
    // nothing about whether there is junk to clear (a ping mid-flight, a pass
    // already running, or simply no window to repair), and on a phone with
    // live tracking the ping exit is the common case: the three retries above
    // can all come back false and the log then renders whatever stale
    // duplicates and orphaned drive rows were already there. Run the sweeps
    // here directly, every open. _geoCleanupSweeps carries its own busy flag
    // and a 10s recency skip, so when the reconciler above DID run to
    // completion this is a cheap no-op rather than a second round of queries.
    if(typeof _geoCleanupSweeps==='function'){try{await _geoCleanupSweeps();}catch(_e){}}
}
// Cheap enough to run on every open, and the only thing that decides whether
// the repair earned a repaint. Count plus total minutes catches an added row,
// a removed row, and a retimed one, which is everything the repair can do.
function _tlRowsFingerprint(rows){
  let n=0,min=0;
  (rows||[]).forEach(r=>{n++;min+=(r.minutes||0);});
  return n+':'+min;
}
let _tlRepairRunning=false;
// When a repair last ran. Opening the page is a deliberate look at hours and
// earns a pass; flipping Me/Team or changing the year is NOT a new open and
// must not trigger one (CI shard 6, 2026-08-26: the Share button read hidden
// because a repaint from the previous render landed mid-test).
//
// The deeper reason this guard matters in production, not just in a test: the
// repaint is async and re-renders the whole page. Without a floor, every scope
// toggle queues another one, and they land under the viewer's finger seconds
// after they tapped something. Same shape as _geoCleanupSweeps' own recency
// skip in js/geo-track.js (7.3).
let _tlRepairAt=0;
const _TL_REPAIR_MIN_GAP_MS=30000;
// Repaint ONLY when the repair actually changed something. A repaint closes
// any accordion the viewer opened by hand, so doing it unconditionally would
// trade a slow page for one that shuts itself a second after it opens.
// The generation the CURRENT on-screen paint belongs to. A repair is
// scheduled by one render and finishes later, async; if ANY newer render has
// painted meanwhile (the user flipped scope, changed year, or simply opened
// the page again), that newer paint owns the screen and the stale repair
// must not repaint over it. Without this, a repair scheduled by render N
// clobbered render N+1's list with whatever its own later fetch returned
// (caught by CI shard 6, 2026-08-27: the year-filter test read "No time
// logged in 2026" painted by the PREVIOUS test's leftover repair).
let _tlRenderGen=0;
async function _tlRepairAfterPaint(paintedRows,gen){
  if(_tlRepairRunning)return false;
  if(_tlRepairAt&&Date.now()-_tlRepairAt<_TL_REPAIR_MIN_GAP_MS)return false;
  _tlRepairRunning=true;_tlRepairAt=Date.now();
  try{
    await _tlRepairPass();
    if(gen!==undefined&&gen!==_tlRenderGen)return false;   // a newer render owns the screen
    const fresh=await _timeLogRows(null);
    if(_tlRowsFingerprint(fresh)===_tlRowsFingerprint(paintedRows))return false;
    if(gen!==undefined&&gen!==_tlRenderGen)return false;   // re-check across the await
    // noRepair: the pass just ran. Without it this recurses on every open.
    await renderTimeLog({noRepair:true});
    return true;
  }catch(_e){return false;}
  finally{_tlRepairRunning=false;}
}
async function renderTimeLog(opts){
  const el=document.getElementById('tl-list');if(!el)return;
  const _gen=++_tlRenderGen;
  _tlStartOpenRefresh();
  const totalEl=document.getElementById('tl-total');
  const shareEl=document.getElementById('tl-share');
  const toggleEl=document.getElementById('tl-scope-toggle');
  el.innerHTML='<div style="padding:6px 2px">'+_tdSkelRows(4,12)+'</div>';
  let allRows;
  try{allRows=await _timeLogRows(null);}
  catch(_e){el.innerHTML='<div class="empty">Couldn\'t load time entries.</div>';return;}
  // Scheduled HERE, not at the end of this function, because the render has
  // several early returns after this point and the empty-hours one is the case
  // that matters most: the reconciler exists to backfill hours that are
  // missing, so "no rows to show" is precisely when it must run, not when it
  // should be skipped. Hooking the bottom of the function quietly made the
  // repair conditional on already having data (caught by CI, shard 6, on the
  // very commit that moved it).
  //
  // Not awaited, and it opens with an await of its own, so this yields
  // immediately and the synchronous render below still paints first.
  if(!(opts&&opts.noRepair)){
    try{_tlRepairAfterPaint(allRows,_gen);}catch(_e){}
  }
  const canComp=typeof _canViewComp==='function'&&_canViewComp();
  const isEmp=typeof _isEmployee!=='undefined'&&_isEmployee&&typeof _supaUser!=='undefined'&&_supaUser;
  const cid=(typeof _contractorUserId!=='undefined'&&_contractorUserId)||(typeof _supaUser!=='undefined'&&_supaUser&&_supaUser.id)||null;
  // "You," for filtering Me scope and tagging your own row in Team scope:
  // your real auth uid if you're an employee, else the contractor/owner id
  // (manual owner rows carry personUid:null, which _tlEmpWeekAgg already
  // folds under cid for aggregation, so this is the same identity key).
  const selfUid=isEmp?_supaUser.id:cid;

  // Everyone lands on Me first, owner included (owner reversed 2026-08-23:
  // the original "owners default to Team, they expect the full picture"
  // call from 2026-08-20 flipped, own hours are what you want to check
  // first regardless of role). Sticks once set, same as _tlYear. Clamped
  // every render so a permission loss (dual-hat switch to a no-payroll crew
  // hat) can never strand scope on 'team' with nothing to show.
  if(_tlScope===null)_tlScope='me';
  const scope=(_tlScope==='team'&&canComp)?'team':'me';
  _tlScope=scope;

  if(toggleEl){
    if(canComp){
      toggleEl.style.display='flex';
      toggleEl.innerHTML=
        '<button class="tl-scope-btn'+(scope==='me'?' active':'')+'" onclick="setTimeLogScope(\'me\')">Me</button>'+
        '<button class="tl-scope-btn'+(scope==='team'?' active':'')+'" onclick="setTimeLogScope(\'team\')">Team</button>';
    }else{
      toggleEl.style.display='none';toggleEl.innerHTML='';
    }
  }

  const isMine=r=>isEmp?r.personUid===selfUid:(r.personUid===null||r.personUid===selfUid);
  const visible=scope==='team'?allRows:allRows.filter(isMine);
  // "This week" is a live indicator, not tied to the year selector, a
  // contractor running payroll cares about the current pay period regardless
  // of what year's history they happen to be scrolled to.
  const weekEl=document.getElementById('tl-week-total');
  if(weekEl){
    const wkStart=new Date();wkStart.setHours(0,0,0,0);wkStart.setDate(wkStart.getDate()-wkStart.getDay());
    const wkEnd=new Date(wkStart);wkEnd.setDate(wkEnd.getDate()+6);
    const wkStartStr=dateKey(wkStart),wkEndStr=dateKey(wkEnd);
    const wkMin=visible.filter(r=>r.date>=wkStartStr&&r.date<=wkEndStr).reduce((s,r)=>s+(r.minutes||0),0);
    weekEl.textContent=(typeof _fmtMin==='function'?_fmtMin(wkMin):wkMin+'m')+' This week (Sun–Sat)';
  }
  const years=_tlYears(visible);
  _tlPopulateYearSel(years);
  const yr=_tlYear;
  const rows=visible.filter(r=>(r.date||'').startsWith(yr));
  if(!rows.length){
    el.innerHTML='<div class="empty">No time logged in '+yr+(scope==='me'?' for you.':'.')+'</div>';
    if(totalEl)totalEl.textContent='';
    if(shareEl){shareEl.style.display='none';shareEl.innerHTML='';}
    _tlLastRows=[];
    return;
  }
  _tlComputeOT(rows);
  _tlComputeWeeklyRunning(rows);
  _tlLastRows=rows;
  const fm=typeof _fmtMin==='function'?_fmtMin:(m=>m+'m');
  const totalMin=rows.reduce((s,r)=>s+(r.minutes||0),0);
  if(totalEl)totalEl.textContent=fm(totalMin)+' total in '+yr;
  const byMonth={};
  rows.forEach(r=>{const mo=(r.date||'').slice(0,7)||'unknown';(byMonth[mo]||(byMonth[mo]=[])).push(r);});
  // January (oldest) → December (newest), owner call 2026-08-20. Every other
  // Books accordion (Income/Expenses) reads newest-first; this one deliberately
  // doesn't, so don't "fix" this sort to match them.
  const months=Object.keys(byMonth).sort((a,b)=>a.localeCompare(b));
  const curMo=todayKey().slice(0,7);
  const curWk=_tlWeekKey(todayKey());
  _tlWeekCache={};
  el.innerHTML='<div class="bk-months">'+months.map(mo=>{
    const moRows=byMonth[mo];
    const byWeek={};
    moRows.forEach(r=>{const wk=_tlWeekKey(r.date)||'unknown';(byWeek[wk]||(byWeek[wk]=[])).push(r);});
    // Newest week first within the month (owner report 2026-08-20: opening a
    // month buried the current week under every earlier one). This is the
    // opposite of the month-level sort just above, and deliberately so: that
    // one is the dated owner exception (January→December); nothing pinned
    // week order to match it, and newest-first here matches every other
    // Books accordion's normal convention.
    const weeks=Object.keys(byWeek).sort((a,b)=>b.localeCompare(a));
    const moOpen=/^\d{4}-\d{2}$/.test(mo)&&mo>=curMo;
    const moMin=moRows.reduce((s,r)=>s+(r.minutes||0),0);
    let moSub=weeks.length+' week'+(weeks.length!==1?'s':'');
    if(scope==='team'){
      const empCount=Object.keys(_tlEmpWeekAgg(moRows,cid)).length;
      moSub+=' · '+empCount+' employee'+(empCount!==1?'s':'');
    }
    const moTotalHtml='<div style="font-size:15px;font-weight:900;color:var(--text);font-variant-numeric:tabular-nums;font-family:var(--font-display);letter-spacing:-.5px">'+fm(moMin)+'</div>';
    const weeksHtml=weeks.map(wk=>{
      const weekRows=byWeek[wk];
      const wkId=wk.replace(/[^0-9]/g,'')||'x';
      const domId='tl-wkbody-'+mo.replace(/[^0-9]/g,'')+'-'+wkId;
      const cacheKey=mo+'|'+wk;
      _tlWeekCache[cacheKey]={mo,wk,rows:weekRows,scope,cid,selfUid,domId};
      const wkOpen=moOpen&&wk===curWk;
      const wkLabel=_tlWeekLabel(wk);
      const wkMin=weekRows.reduce((s,r)=>s+(r.minutes||0),0);
      const wkTotalHtml='<div style="font-size:12.5px;font-weight:800;color:var(--text)">'+fm(wkMin)+'</div>';
      let wkSub;
      if(scope==='team'){
        const empCount=Object.keys(_tlEmpWeekAgg(weekRows,cid)).length;
        wkSub=empCount+' employee'+(empCount!==1?'s':'');
      }else{
        wkSub=weekRows.length+' entr'+(weekRows.length!==1?'ies':'y');
      }
      const bodyHtml='<div id="'+domId+'">'+_tlRenderWeekBody(cacheKey)+'</div>';
      return _bkWeekAcc('tl',mo,wkId,wkLabel,wkSub,wkTotalHtml,bodyHtml,wkOpen);
    }).join('');
    return _bkMonthAcc('tl',mo,_bkMonthLabel(mo),moSub,moTotalHtml,weeksHtml,moOpen);
  }).join('')+'</div>';
  if(shareEl){
    if(scope==='me'){
      shareEl.style.display='block';
      shareEl.innerHTML='<button onclick="_tlShareWeek()" class="btn btn-p" style="width:100%;margin-top:16px;height:48px;font-size:14px">'+svgIcon('⬆',{size:14})+' Share this week\'s hours</button>';
    }else{
      shareEl.style.display='none';shareEl.innerHTML='';
    }
  }
}
