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
  // "Drive time", "Shop time", "Loading time" (owner 2026-08-29): every badge
  // on this table names a BLOCK OF TIME, so they all end in the same word. A
  // bare gerund reads as a status the app is currently in ("Driving...") when
  // the row is a finished, countable thing.
  if(/^drive/.test(s))return 'Drive time'+(s.indexOf('rider')>=0?' (rider)':s.indexOf('personal')>=0?' (personal vehicle)':'');
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
  // "Unaccounted", not "Unpaid" (owner, 2026-09-01: "skip the paid versus
  // unpaid stuff out"). The app does not know whether this gets paid and is
  // not the thing that decides. It knows the time is not accounted for yet;
  // lunch, a break and a business trip all start here and leave once somebody
  // classifies them.
  if(s==='stop')return 'Unaccounted';
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
    const startMs=new Date(e.start_time).getTime();
    const elapsedMin=Math.max(0,Math.round((Date.now()-startMs)/60000));
    // clockIn(null,...) is a real button ("General time", js/jobs.js:98) and
    // _tlJobClientInfo answers '-' for a job it cannot resolve. On this card
    // that rendered as a lone dash where the client name goes, which reads as
    // a broken row rather than as a clock with no job on it.
    const general=e.job_id==null;
    rows.push({
      rawId:e.id,personName:e.logged_by_name||((typeof getOwnerName==='function'&&getOwnerName())||'Owner (me)'),
      personUid:e.logged_by_uid||null,
      clientName:general?'General time':info.clientName,
      addr:general?'':info.addr,jobName:general?'':info.jobName,
      detail:e.scope_label||'',startTime:e.start_time,startMs:startMs>0?startMs:0,elapsedMin
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
  const dstr=d=>(typeof _bizDateStr==='function')?_bizDateStr(d):dateKey(d);
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
// ONE PERSON, ONE BUCKET (owner 2026-08-30: "when I marked it as break unpaid
// it kept adding a row").
//
// He was not double-tapping. His manual answers carry logged_by_uid null, the
// way every owner-logged entry does, while his GPS rows carry his contractor
// uid. Keyed on the raw value those are two different people, so the answer
// landed in the 'owner' bucket, the hole was recomputed from the GPS bucket
// alone, and it came back untouched every render. Tap, row written, hole
// still there, tap again. Forever, and the same reason his original Add from
// 08/29 never closed its own gap either.
//
// _tlEmpWeekAgg already had the rule (`r.personUid||cid`); this walk did not.
// Same fold here, so a null-uid owner row and a contractor-uid GPS row are the
// one person they actually are.
function _tlFillUnaccounted(rows,cid){
  if(!Array.isArray(rows)||!rows.length)return rows;
  const who=r=>String((r&&r.personUid)||cid||'owner');
  const byDay={};
  rows.forEach(r=>{
    if(!r||!r.startTime||!r.endTime||!r.date)return;
    const a=Date.parse(r.startTime),b=Date.parse(r.endTime);
    if(!(a>0&&b>a))return;
    const k=who(r)+'|'+r.date;
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
function _tlAbsorbGaps(rows,cid){
  if(!Array.isArray(rows))return rows;
  const byDay={};
  rows.forEach(r=>{
    if(!r||!r.startTime||!r.endTime||!r.date)return;
    const a=Date.parse(r.startTime),b=Date.parse(r.endTime);
    if(!(a>0&&b>=a))return;
    // Same one-person-one-bucket fold as _tlFillUnaccounted below: an
    // owner-logged row (null uid) and that owner's GPS rows are one person.
    const _k=String((r.personUid||cid||'owner'))+'|'+r.date;
    (byDay[_k]=byDay[_k]||[]).push(r);
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
      // A manual row was paid by definition until the day rail let somebody
      // name a hole as an unpaid meal break. Reading the stored flag (absent
      // on every entry written before this, hence false) is what keeps that
      // one answer out of the paid totals, through the SAME unpaid path a
      // geofenced lunch already uses (_tlPaidMin, _tlComputeOT), never a
      // second kind of not-paid.
      unpaid:e.unpaid===true,
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
  // Resolved once for the whole render: getPlaces() on every row would be a
  // lookup per entry for a set that cannot change mid-render.
  const _baseNames=(typeof _geoBaseNames==='function')?_geoBaseNames():new Set();
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
      const dstr=d=>(typeof _bizDateStr==='function')?_bizDateStr(d):dateKey(d);
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
        detail:trimmed?'Shop time · auto clock-out':'Shop time',
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
      const _dday=(typeof _bizDateStr==='function')?_bizDateStr(new Date(e.arrived_at)):dateKey(new Date(e.arrived_at));
      if(!_geoRowInWorkday(e.arrived_at,e.departed_at,((_shopCut[e.employee_user_id]||{})[_dday])||null))return;
    }
    // BASE DWELL ANSWERS TO THE DAY, exactly like the yard already does.
    //
    // The shop loop above bounds a session by Central midnight and clamps it
    // to the day's clock-out. A home office is the same kind of place and got
    // neither, so sitting at his own house overnight wrote a 12-hour visit:
    // owner and Jack both, four nights running, up to 1557 minutes. See
    // _geoIsBaseRow (js/geo-track.js) for why a supply house is deliberately
    // NOT a base and still ends the day.
    // NOT PAID VERSUS UNPAID. ACCOUNTED VERSUS UNACCOUNTED (owner, 2026-09-01):
    // "skip the paid versus unpaid stuff out, just log it as unaccounted if
    // they are floating between fences ... doesn't get included in time unless
    // classified (i.e. lunch, breaks, business trips)."
    //
    // A first cut DROPPED the row when base dwell fell outside the workday.
    // Wrong twice: it broke the rule above, and it broke the owner's own Aug 23
    // rule that a day "should read complete, not like a chunk is silently
    // missing". It also zeroed 45 minutes of real home-office paperwork on a
    // day with no drives.
    //
    // Nothing is hidden now. This lands in the SAME shape _tlFillUnaccounted
    // already writes for a hole between fences (7.3): the row keeps its true
    // span, says why it does not count, and the unpaid flag holds it out of
    // hours and overtime exactly as a lunch already is. The owner decides what
    // to pay; the app does not decide for them.
    let _unacctWhy='';
    if(typeof _geoIsBaseRow==='function'&&_geoIsBaseRow(e,_baseNames)){
      const _ba=Date.parse(e.arrived_at)||0,_bd=Date.parse(e.departed_at||'')||0;
      const _bds=d=>(typeof _bizDateStr==='function')?_bizDateStr(d):dateKey(d);
      if(!(_ba>0&&_bd>_ba))return;      // unparseable: nothing to draw either way
      const _bpm=(typeof _geoShopPaidMin==='function')
        ? _geoShopPaidMin(e.arrived_at,e.departed_at,
            ((_shopCut[e.employee_user_id]||{})[_bds(new Date(_ba))])||null)
        : (e.minutes||0);
      // Crossing Central midnight is the truck home for the night, never a
      // shift (owner rule 2026-08-24: "it's not humanely possible for any day
      // to have more than 24 hours"). Unaccounted, not deleted.
      if(_bds(new Date(_ba))!==_bds(new Date(_bd)))_unacctWhy='Overnight at your own place';
      else if(_bpm<1)_unacctWhy='Outside the day\u2019s work';
      else e=Object.assign({},e,{minutes:_bpm});   // clamped COPY, stored row untouched
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
      source:'auto',date:(typeof _bizDateStr==='function')?_bizDateStr(new Date(e.arrived_at)):e.arrived_at.slice(0,10),
      minutes:e.minutes||0,personName:crew.name[e.employee_user_id]||'Crew',personUid:e.employee_user_id,
      clientName,addr:info.addr,jobName:info.jobName,clientKey:e.client_key||null,unpaid:isUnpaid||!!_unacctWhy,
      // The reason wins when there is one. "Overnight at your own place" tells
      // the owner why twelve hours are sitting there not counting, which a
      // bare source label never could.
      detail:_unacctWhy||((typeof _tlSourceLabel==='function')?_tlSourceLabel(e.source):(e.source||'')),
      startTime:e.arrived_at||null,endTime:e.departed_at||null,
      // The server row id and its raw source, so a wrong GPS clock can be
      // corrected in place (owner rule 2026-08-24). rawSource is the raw
      // column, unlike `detail` which is the friendly label.
      rawId:e.id!=null?e.id:null,rawSource:e.source||''
    });
  });
  const _cid=(typeof _contractorUserId!=='undefined'&&_contractorUserId)||(typeof _supaUser!=='undefined'&&_supaUser&&_supaUser.id)||null;
  return _tlFillUnaccounted(_tlAbsorbGaps(rows,_cid),_cid).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
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
  // SHAPE FIRST, then parse. This used to hand anything at all to `new Date`
  // and trust an Invalid Date to reject it, but parsing a string that is not
  // ISO-8601 is implementation-defined: WebKit accepts "13T00:00:00" and
  // Chromium does not, so _tlMonthKey(13) returned '' in one engine and "13"
  // in the other. Caught by CI on 2026-08-31, and only by CI, because the
  // local pre-push run is chromium (§5.2.1) and this is exactly the
  // cross-browser class that run leaves to the shards.
  //
  // A real date-only key is the only thing any caller passes, so requiring
  // that shape rejects junk identically everywhere. '2026-13-40' still fails,
  // one line down, on being a date that does not exist.
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr)))return '';
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
// (_bizDateStr, js/finance.js), so travel also split the log against itself:
// days in one zone, times in another, and near midnight they disagree outright.
//
// Hours are a fact about when work happened, not about where the phone is now.
// One zone for the whole log: display, the Fix dialog, and the export.
//
// Reads S.bizTz so this stops being a Kansas assumption the day a contractor in
// another state signs up, and falls back to the same Central zone _bizDateStr
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
// "Mine", asked in ONE place. renderTimeLog computed this inline to filter Me
// scope, and the gap chips need the same question for a different reason (see
// _tlRailGapBody). Two copies of a permission predicate is how one of them
// ends up wrong and nobody notices which (§7.3).
function _tlRowIsMine(r){
  if(!r||typeof r!=='object')return false;
  const isEmp=typeof _isEmployee!=='undefined'&&_isEmployee&&typeof _supaUser!=='undefined'&&_supaUser;
  const cid=(typeof _contractorUserId!=='undefined'&&_contractorUserId)||
            (typeof _supaUser!=='undefined'&&_supaUser&&_supaUser.id)||null;
  const selfUid=isEmp?_supaUser.id:cid;
  // An owner's own manual rows carry personUid:null, which is why the owner
  // side of this accepts two values and the employee side accepts one.
  //
  // null AND undefined, deliberately. Everywhere else in this file a row folds
  // under `r.personUid||cid`, so a row that never got the column at all is the
  // owner's. A strict ===null here was stricter than the rest of the app and
  // silently dropped the gap chips off hand-built rows that carry no person.
  const uid=(r.personUid==null)?null:r.personUid;
  return isEmp?uid===selfUid:(uid===null||uid===selfUid);
}
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
  if(typeof _bizDateStr==='function'&&_bizDateStr(start)!==_bizDateStr(end))return bad('An entry has to start and end on the same day.');
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
// _tlRow was DELETED here, not left orphaned (§7). It built one <tr> of the
// per-person day table in Team, and that table is now the person's weekly
// bars (see _tlEmpAccHtml). With the table gone it had no caller at all.
//
// It carried ONE capability nothing else had: the 3-second hold-to-delete
// gesture on a time entry. That did not go with it (§7.2). The same
// data-lp-* attributes, under the same _tlCanEdit gate, are now on the rail
// row in _tlRailRow, which is where the Edit button already moved for
// exactly this reason. Everything else it drew (the clock times, the
// address, the drive from/to, the OT and unpaid flags) the rail row was
// already drawing better.
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
// Does a break of this length get paid? (owner 2026-08-29: "Break would need
// a toggle if they get paid on it or not right?" Yes, and the honest default
// is not a coin flip.)
//
// The federal rule is shaped by DURATION, not by what anyone calls it: short
// rest breaks (29 CFR 785.18, roughly 5 to 20 minutes) are compensable and
// count toward the workweek, while a bona fide meal period (785.19, 30
// minutes or more with the employee fully relieved of duty) need not be.
// So 'auto' reads the length and applies that shape. A contractor whose
// state or handbook says otherwise sets S.breakPaid to 'paid' or 'unpaid'
// and the length stops mattering.
//
// NOT legal advice, and deliberately never silent: the chip in the day rail
// prints which way this resolved BEFORE it is tapped, so nobody discovers
// after the fact that 45 minutes went unpaid.
const _TL_BREAK_PAID_MAX_MIN=20;
function _tlBreakIsPaid(mins){
  const pol=(typeof S!=='undefined'&&S&&S.breakPaid)||'auto';
  if(pol==='paid')return true;
  if(pol==='unpaid')return false;
  return (Number(mins)||0)<=_TL_BREAK_PAID_MAX_MIN;
}
// kind: 'work' (default, paid job time), 'break' (paid or unpaid per the
// policy above), 'personal' (never paid). The default preserves the original
// one-button behavior exactly, so the old Add button keeps working unchanged.
function _tlAddUnaccounted(startIso,endIso,kind){
  const a=Date.parse(startIso),b=Date.parse(endIso);
  if(!(a>0&&b>a))return;
  if(typeof timeEntries==='undefined'||!Array.isArray(timeEntries))return;
  const mins=Math.max(1,Math.round((b-a)/60000));
  const k=(kind==='break'||kind==='personal')?kind:'work';
  const unpaid=k==='personal'?true:k==='break'?!_tlBreakIsPaid(mins):false;
  const label=k==='break'?('Break'+(unpaid?' (unpaid)':' (paid)'))
             :k==='personal'?'Personal time (unpaid)'
             :'Added from unaccounted time';
  const uid=(typeof _isEmployee!=='undefined'&&_isEmployee&&typeof _supaUser!=='undefined'&&_supaUser)?_supaUser.id:null;
  const name=uid?((typeof _employeeRecord!=='undefined'&&_employeeRecord&&_employeeRecord.name)||'Crew')
                :((typeof getOwnerName==='function'&&getOwnerName())||'Owner (me)');
  // ONE SPAN, ONE ANSWER, AND THE LATEST ONE WINS (owner 2026-08-30: "tapping
  // personal set break unpaid, shouldn't it say personal?").
  //
  // The first attempt at this refused a second tap outright, which was worse
  // than the duplicate it prevented: a man who taps Break and then realises it
  // was Personal has no way to say so, and the row keeps insisting Break. An
  // answer is a correction, so answering again CORRECTS the row in place
  // rather than adding a second one or ignoring him.
  const same=timeEntries.filter(e=>_tlIsGapAnswer(e)&&
    Date.parse(e.start_time)===a&&Date.parse(e.end_time)===b);
  if(same.length){
    // Any earlier duplicates of this same span collapse into the one row he
    // is now answering, so a stack left by the old behaviour cleans itself up
    // the moment he touches it.
    const keep=same[same.length-1];
    same.slice(0,-1).forEach(e=>{const i=timeEntries.indexOf(e);if(i>=0)timeEntries.splice(i,1);});
    keep.minutes=mins;keep.unpaid=unpaid;keep.scope_label=label;keep.fromGap=true;
    if(typeof saveAll==='function')saveAll();
    if(typeof supaSaveToCloud==='function')supaSaveToCloud();
    if(typeof showToast==='function')showToast('Changed to '+
      (k==='break'?('break, '+(unpaid?'unpaid':'paid')):k==='personal'?'personal, unpaid':'work time'),'⏱');
    if(typeof renderTimeLog==='function')renderTimeLog();
    return;
  }
  timeEntries.push({
    id:(typeof _newId==='function')?_newId():Date.now(),
    job_id:null,
    // The CT date of the START, the same key every other row on this page is
    // filed under. A hole that runs past midnight belongs to the day it began.
    date:(typeof _bizDateStr==='function')?_bizDateStr(new Date(a)):startIso.slice(0,10),
    start_time:new Date(a).toISOString(),end_time:new Date(b).toISOString(),
    minutes:mins,scope_id:null,scope_label:label,
    unpaid,
    // So the trim sweep can recognise its own rows without pattern-matching a
    // label that copy changes will eventually move.
    fromGap:true,
    logged_by_uid:uid,logged_by_name:name,open:false
  });
  if(typeof saveAll==='function')saveAll();
  if(typeof supaSaveToCloud==='function')supaSaveToCloud();
  if(typeof showToast==='function')showToast(
    (typeof _fmtMin==='function'?_fmtMin(mins):mins+'m')+' logged as '+
    (k==='break'?('break, '+(unpaid?'unpaid':'paid')):k==='personal'?'personal, unpaid':'work time'),'⏱');
  // The gap row is derived, so it simply stops existing on the next build:
  // the span is now covered by a real row and no hole remains to report.
  if(typeof renderTimeLog==='function')renderTimeLog();
}
// ── The day rail (owner-approved design 2026-08-29) ────────────────────────
// "I like the day rail but what would a compliant day rail look like for ADA
// compliance?" ... "Why can't the lines be one big line and unaccounted for
// times being grey."
//
// One continuous spine down the day. Every row's spine segment spans that
// row's FULL height with no margin between rows, so adjacent segments touch
// and read as a single unbroken line whose colour changes at each boundary.
// That is only honest because the rows already tile the day: the clock-is-the
// -tape model closes every segment at the next transition and _tlFillUnaccounted
// covers whatever is left, so a visible break in the line would be a bug, not
// a gap in the work.
//
// ACCESSIBILITY, the part that shaped the markup rather than decorating it:
//  - 1.4.1 colour is never the only carrier. Every segment prints an icon AND
//    a word ("Drive time", "Break"), so the spine colour is reinforcement.
//  - 1.4.3 / 1.4.11 measured against --bg #FFFFFF: ink 18.15:1, --text3 5.43:1,
//    --blue 6.48:1, teal 6.59:1, amber 6.62:1, load 8.37:1. Text clears 4.5:1
//    and the spine clears the 3:1 non-text minimum.
//  - 1.4.4 / 1.4.10 the grid is minmax(0,...) tracks, never fixed px, so it
//    reflows to 320px and survives 200% zoom instead of clipping. An earlier
//    attempt used an `em` media query as the resize lever; `em` in a media
//    query resolves against the browser's INITIAL font size, not a root we
//    set, so that lever never fired at all. Tracks do.
//  - 2.5.8 every chip and button is at least 24px tall (32 here).
//  - The list is a real <ol> so a screen reader announces position in the day.
function _tlRailKind(r){
  if(!r)return 'job';
  if(r.source==='unaccounted')return 'gap';
  if(r.source==='shop')return 'shop';
  if(r.rawSource==='place-load')return 'load';
  if(r.rawSource==='place-office')return 'office';
  // Same raw-column-first rule as _tlRow, and for the same reason: the
  // friendly label is not a stable key.
  if(r.source==='auto'&&((typeof _geoIsDriveSource==='function'&&r.rawSource)
      ?_geoIsDriveSource(r.rawSource)
      :/^Driv(ing|e time)/.test(r.detail||'')))return 'drive';
  if(r.unpaid)return 'off';
  if(r.source==='manual')return 'manual';
  return 'job';
}
// Colours are REUSED from the split bar and the row badges (§7.3), never
// invented here, so "amber means driving" holds everywhere on this page.
const _TL_RAIL_META={
  job:   {c:'var(--blue)',       icon:'📍', word:'On site'},
  drive: {c:'#9F5B00',           icon:'🚗', word:'Drive time'},
  shop:  {c:'#0E6B6B',           icon:'🔧', word:'Shop time'},
  load:  {c:'#6D28D9',           icon:'📦', word:'Loading time'},
  office:{c:'#0E6B6B',           icon:'📋', word:'Office'},
  off:   {c:'var(--text3)',      icon:'🍽', word:'Break'},
  manual:{c:'var(--text3)',      icon:'▶',  word:'Manual'},
  gap:   {c:'var(--border2)',    icon:'❓', word:'Unaccounted'}
};
function _tlRailMeta(kind){return _TL_RAIL_META[kind]||_TL_RAIL_META.job;}
// The gap row. It is the reason this rail exists in the shape it does.
//
// It used to say "nothing recorded", and the owner killed that wording
// outright (2026-08-29): "don't want to say nothing recorded since that
// instills doubt in the tracking, rather that means there was no fence or was
// break time away from jobs." He is right, and it is not just tone. The
// tracker did record: it recorded motion and it recorded that none of it
// happened inside a fence. Saying "nothing" describes the app as broken when
// what it actually knows is where you were NOT. So the row states that fact
// and then asks the one question only the person can answer.
function _tlRailGapBody(r){
  const mins=r.minutes||0;
  const fm=typeof _fmtMin==='function'?_fmtMin:(m=>m+'m');
  const brk=_tlBreakIsPaid(mins);
  const a=escHtml(r.startTime||''),b=escHtml(r.endTime||'');
  const chip=(k,txt)=>'<button type="button" class="tl-rail-chip" data-kind="'+k+'" '+
    'onclick="_tlAddUnaccounted(\''+a+'\',\''+b+'\',\''+k+'\')">'+escHtml(txt)+'</button>';
  // ANSWERING A HOLE STAMPS THE ANSWERER, NOT THE PERSON WHOSE HOLE IT IS.
  // _tlAddUnaccounted builds its row from the CURRENT user (_supaUser / owner),
  // by design: it was written for a man answering his own day. Now that a crew
  // member's day rail is reachable from Team, offering these chips there would
  // let one tap put the owner's own manual hours on somebody else's Thursday,
  // with nothing on screen saying so and nothing in the row admitting it. So
  // the question is still ASKED, because an unanswered hole in a crew week is
  // exactly what payroll needs to see, and only the button to answer it is
  // withheld.
  if(!_tlRowIsMine(r)){
    const who=String(r.personName||'').trim().split(/\s+/)[0];
    return '<div class="tl-rail-ttl">What was this time?</div>'+
      '<div class="tl-rail-sub">'+escHtml(who?'Only '+who+' can answer this':
        'Only the person who logged it can answer this')+'</div>';
  }
  // No title line: the tag above already reads "Between jobs" and printing it
  // twice is the kind of duplication that makes a dense day harder to scan.
  // Just the question (owner 2026-08-30: "hate this just say what was this
  // time?"). The explaining sentence went through two rewrites, from geofence
  // jargon to plain English, and the owner's answer to the plain-English one
  // was that he does not want a sentence at all. He is right: the tag already
  // says UNACCOUNTED and the duration is in the right column, so the prose was
  // narrating what the row had already shown. The question is the only thing
  // on this row that needs a person.
  return '<div class="tl-rail-ttl">What was this time?</div>'+
    '<div class="tl-rail-chips">'+
      chip('work','Work time')+
      chip('break','Break · '+(brk?'paid':'unpaid'))+
      chip('personal','Personal')+
    '</div>';
}
function _tlRailRow(r){
  if(!r||typeof r!=='object')return '';
  const kind=_tlRailKind(r);
  const m=_tlRailMeta(kind);
  const fm=typeof _fmtMin==='function'?_fmtMin:(mm=>mm+'m');
  const isGap=kind==='gap';
  let body;
  if(isGap){
    body=_tlRailGapBody(r);
  }else{
    const isDrive=kind==='drive';
    const leg=isDrive&&r.clientKey&&typeof mileage!=='undefined'&&Array.isArray(mileage)
      ?mileage.find(x=>x&&x.legKey===r.clientKey):null;
    const ttl=leg?((leg.from_name||'—')+' → '+(leg.to_name||r.clientName||'—'))
                 :(r.addr||r.clientName||m.word);
    // THE SUB-LINE IS THE CLOCK, AND ONLY THE CLOCK (owner 2026-08-30: "why
    // put tradedesk shop under the sub title that already says it ... can
    // just do the start and end time under there").
    //
    // It used to also carry the client and job names, which on most rows were
    // the title again in smaller grey type: three lines to say a place once.
    // The tag names the kind, the title names the place, the sub gives the
    // clock. Nothing repeats.
    const span=[_tlFmtTime(r.startTime),_tlFmtTime(r.endTime)].filter(Boolean);
    const sub=span.length===2?(span[0]+' to '+span[1]):'';
    body='<div class="tl-rail-ttl">'+escHtml(ttl)+'</div>'+
         (sub?'<div class="tl-rail-sub">'+escHtml(sub)+'</div>':'');
  }
  // The word rides with the icon in every case, so the colour is never doing
  // the work on its own (1.4.1).
  const tag='<span class="tl-rail-tag">'+svgIcon(m.icon,{size:10})+' '+escHtml(m.word)+
    (r.unpaid&&!isGap?' · unpaid':'')+'</span>';
  // EDIT LIVES HERE NOW. The entries table was the only place a manual clock
  // could be fixed, and the owner cut it off the week view as clutter
  // (2026-08-30). Losing the ability to correct an entry was not part of that
  // ask, so the control moved to the row it belongs to instead of disappearing
  // with the table (§7.2: verify the capability survives before removing the
  // UI that carried it). Same gate and the same modal as the table used, so
  // there is still exactly one edit experience (§7.3).
  const edit=(typeof _tlCanEdit==='function'&&_tlCanEdit(r)&&r.rawId!=null)
    ?'<button type="button" class="tl-rail-edit" onclick="_openEditTimeEntry('+r.rawId+')">Edit</button>'
    :(typeof _tlCanFixAuto==='function'&&_tlCanFixAuto(r)&&r.rawId!=null)
    ?'<button type="button" class="tl-rail-edit" onclick="_openFixAutoEntry(\''+escHtml(String(r.rawId))+'\')">Fix</button>'
    :'';
  const dur='<div class="tl-rail-dur'+((r.unpaid||isGap)?' mute':'')+'">'+escHtml(fm(r.minutes||0))+
    (edit?'<span class="tl-rail-editwrap">'+edit+'</span>':'')+'</div>';
  // AND SO DOES DELETE, for the same reason and by the same rule (§7.2). The
  // 3-second hold lived on the table row _tlRow drew; that table is gone, and
  // losing the only way to delete a time entry was not part of removing it.
  // Same attributes, same _tlCanEdit gate, same handler in js/cloud.js, which
  // re-checks permission again on its own.
  const lp=(typeof _tlCanEdit==='function'&&_tlCanEdit(r)&&r.rawId!=null)
    ?' data-lp-id="'+escHtml(String(r.rawId))+'" data-lp-type="timelog"'+
     ' data-lp-label="'+escHtml(String(r.personName||'')+' · '+
        String(r.clientName||r.addr||m.word))+'"'
    :'';
  return '<li class="tl-rail-row" data-kind="'+kind+'"'+lp+' style="--rail:'+m.c+'">'+
    '<div class="tl-rail-time"><span>'+escHtml(_tlFmtTime(r.startTime)||'—')+'</span></div>'+
    '<div class="tl-rail-spine" aria-hidden="true"><i></i><b></b></div>'+
    '<div class="tl-rail-body">'+tag+body+'</div>'+
    dur+
  '</li>';
}
// The day's headline: total, the same split bar the employee card draws, and
// a legend whose DOT carries the colour so the bar is readable by anyone who
// cannot separate its segments by hue alone (1.4.1 again: the number and the
// word are right there beside the dot).
// Every person in scope folded into ONE set of bucket minutes. The rail draws
// a day, not a person, and Me scope is one person anyway. Extracted so the day
// head and the week bars call the same fold over the same aggregator (§7.3):
// two components computing "how much of this was driving" separately is
// exactly how the split bar and Crew Cost drifted apart once already.
function _tlBucketFold(rows){
  const list=(Array.isArray(rows)?rows:[]).filter(r=>r&&typeof r==='object');
  const agg=_tlEmpWeekAgg(list,'day');
  const e={min:0,onsiteMin:0,driveMin:0,placeMin:0,shopMin:0,loadMin:0,ot:false};
  Object.keys(agg).forEach(u=>{const a=agg[u];
    e.min+=a.min||0;if(a.weekOT)e.ot=true;
    _TL_BUCKETS.forEach(b=>{e[b.k]+=a[b.k]||0;});});
  return e;
}
function _tlRailHeadHtml(rows,label,noTotal){
  const fm=typeof _fmtMin==='function'?_fmtMin:(m=>m+'m');
  const e=_tlBucketFold(rows);
  const total=_tlBucketTotal(e)||1;
  const segs=_TL_BUCKETS.map(b=>'<span style="width:'+((e[b.k]||0)/total*100).toFixed(1)+'%;background:'+b.c+'"></span>').join('');
  const legend=_TL_BUCKETS.filter(b=>(e[b.k]||0)>0).map(b=>
    '<span class="tl-rail-leg"><i style="background:'+b.c+'"></i>'+escHtml(b.label)+
    ' <b>'+escHtml(fm(e[b.k]))+'</b></span>').join('');
  return '<div class="tl-rail-head">'+
    (label?'<div class="tl-rail-head-day">'+escHtml(label)+'</div>':'')+
    // Suppressed inside the drill: the header one line above already prints
    // this exact number, and the split bar and legend below are the part the
    // rail head is actually for.
    (noTotal?'':'<div class="tl-rail-head-total">'+escHtml(fm(e.min))+'</div>')+
    '<div class="tl-split-bar">'+segs+'</div>'+
    (legend?'<div class="tl-rail-legend">'+legend+'</div>':'')+
  '</div>';
}
// One day, oldest first. Chronological is not a preference here: a spine that
// runs down the page is a picture of time passing, and time does not run
// backwards, so the newest-first ordering the table uses would make the line
// lie about the day it is drawing.
function _tlDayRailHtml(rows){
  // A null row is not a segment, and drawing a blank one would hang a phantom
  // node off the spine at a time nothing happened. Dropped, not rendered.
  const list=(Array.isArray(rows)?rows:[]).filter(r=>r&&typeof r==='object')
    .sort((a,b)=>String(a.startTime||'').localeCompare(String(b.startTime||'')));
  if(!list.length)return '';
  return '<ol class="tl-rail">'+list.map(_tlRailRow).join('')+'</ol>';
}
// ── The week bars: how much, and does anything look wrong ──────────────────
// Owner, 2026-08-30, on the timeline version that came first: "that's gotta be
// the ugliest thing I've ever saw, how do other time log apps do these views?"
//
// The research answer was that nobody draws a week as a timeline, and it is not
// an oversight. Two patterns own the category. Jobber, Housecall Pro and
// ServiceTitan render a payroll GRID (days down, people across, hours in the
// cell), which is built for a clerk at a desk. Harvest, Toggl and Clockify put
// ONE BIG NUMBER over SEVEN DAILY TOTALS, which is the same shape as Screen
// Time and Health and reads in a glance on a phone.
//
// A timeline answers "when exactly." Standing at the truck the question is
// "how much, and which day looks wrong," and only then "show me that day."
// So: seven bars for the shape, tap one for the day rail. The owner's own
// words for the model, and they are the spec:
//
//   "seeing how the day of that week looked at a glance with the bar and how
//    time was spent to see if something is wrong then clicking into it gives
//    you the full daily rail breakdown we already created"
//
// Three things carry "something is wrong," and each is readable without hue:
//   - the 8-hour guide line, so a long day is over a line and not merely taller
//     than its neighbour (a bar scaled only to its own week makes every week
//     look normal, which is the failure mode of every "scale to max" chart)
//   - the amber ? on a day with an unanswered hole
//   - the OT flag when the week itself crosses 40
// The bar label, split across TWO LINES instead of squeezed onto one.
//
// This went through "11h 54m" (overran its neighbour at 320px), then "11h54m"
// (still touched it), then "11h54" (fit, but the owner's answer was "don't
// want hours cutting off"). He is right, and the earlier versions were all the
// same mistake: making the number smaller to fit a box, when the box was the
// thing that should have changed. A seven-column grid gives each day about
// 35px across and as much vertical room as we care to use, so the hours go
// above the minutes and nothing is abbreviated at all.
//
// The text is not decoration. It is what keeps the height comparison readable
// to someone who cannot judge a height (1.4.1), so shrinking or truncating it
// was never actually on the table.
function _tlBarAmtParts(min){
  // Math.max(0, NaN) is NaN, not 0, so a garbage minutes value printed "NaNm"
  // under a bar. Guarded, not clamped by accident.
  const n=Number(min);
  const t=Number.isFinite(n)?Math.max(0,Math.round(n)):0;
  const h=Math.floor(t/60),m=t%60;
  if(!t)return {top:'0m',sub:''};
  if(!h)return {top:m+'m',sub:''};
  // A clean hour says one thing, not "8h" over a lonely "0m".
  return {top:h+'h',sub:m?m+'m':''};
}
const _TL_BAR_H=92;             // px of drawable column, matches .tl-wbar-plot
const _TL_BAR_GUIDE_MIN=8*60;   // the 8-hour line
const _TL_BAR_FLOOR=4*60;       // a light week still shows its shape
// Bar heights need a ceiling to scale against. Scaling to the tallest day alone
// makes an 11-hour week and a 4-hour week look identical, so the ceiling is the
// tallest day plus headroom, never below four hours. The guide line is then
// drawn only when 8 hours actually falls inside the chart.
function _tlBarCeiling(dayMins,floorMin){
  const max=Math.max.apply(null,[0].concat(Array.isArray(dayMins)?dayMins:[]));
  const f=Number(floorMin);
  // 6% of headroom, not 12%: enough that the tallest bar never looks clipped
  // against the ceiling, without banding empty space across the whole chart.
  return Math.max(Math.round(max*1.06),
    Number.isFinite(f)&&f>0?f:_TL_BAR_FLOOR);
}
// ── Making a bar look like something you can open ──────────────────────────
// Owner, 2026-08-30: "how do we make the bars scream click me for more info
// without saying that? What's the psychological design aspect that makes
// somebody click the bar wondering what it will do?"
//
// Two different jobs, and they need two different answers.
//
// LOOKING tappable is perceived affordance. A flat painted rectangle reads as
// a PICTURE, and nobody taps a picture. The same rectangle with a lit top edge
// and a shadow under it reads as an OBJECT sitting on the baseline, and an
// object invites a hand. That is all in the CSS and costs no space, which is
// why it is the first thing to reach for.
//
// WANTING to tap is a different thing: curiosity is not "there might be more
// here", it is a SPECIFIC COUNTABLE UNKNOWN (Loewenstein's information gap).
// "9h 54m" is a closed fact with nothing missing. "9h 54m, and 8 stops" is an
// open one: you now know exactly how many things are inside and not what they
// are. That is the itch, and it is information worth having anyway, which is
// what separates it from bait.
//
// It goes INSIDE the bar rather than under it. A fourth line of type under a
// 46px column is the clutter the owner has cut three times today, and a number
// printed on the thing it counts reads as a property of that thing.
//
// Deliberately NOT done: a "tap for details" label. An explicit instruction is
// what you write when the affordance failed, which is exactly why he asked for
// this without saying it.
function _tlStopCount(rows){
  // Places you actually stopped. A drive is not a stop, an unanswered hole is
  // not a stop, and neither is a wheels-turning leg between two of them.
  // A hole in the array is not a stop either. _tlRailKind(null) answers 'job'
  // (its callers want a safe default, not a crash), so counting its answer
  // without checking the row first turned two empty slots into "2 stops": a
  // number the bar cannot back up when you tap it.
  return (Array.isArray(rows)?rows:[]).filter(r=>{
    if(!r||typeof r!=='object')return false;
    const k=_tlRailKind(r);
    return k!=='drive'&&k!=='gap'&&k!=='off';
  }).length;
}
// ONE bar chart, two levels (§7.3). A month drawn as weekly bars and a week
// drawn as daily bars are the same picture with a different bucket on the x
// axis, so they are the same function: hand it groups, get the chart. Building
// a second one for the month is exactly how the split bar and Crew Cost ended
// up disagreeing about what a minute was.
//
// groups: [{ label, sub, rows, onclick, aria }]
// opts:   { guideMin, guideLabel, share }
// ── The first paint, and only the first ─────────────────────────────────────
// Owner, 2026-08-30: "make the skeleton shimmer show the bars, make them load
// themselves in a bit slower, then once loaded we don't show the skeleton
// shimmer at all, they just load in, only want skeleton shimmer one time."
//
// Two faults, one sentence. The placeholder was four generic grey LINES, so
// what it promised (a list) was not what arrived (a chart), and the swap read
// as a change of subject rather than a load. And it reprinted on every render,
// which is every drill tap: by then the rows are already in memory, so the
// shimmer was measuring nothing and just flashing. It is a first-load thing
// now, once per session. After that the bars growing out of the baseline ARE
// the load, which is what he means by "they just load in".
//
// The heights are fixed and deliberately uneven. A row of equal bars reads as
// a real chart of a boring week and you wait to see it change; an uneven one
// reads as a placeholder. It is not random either, because a placeholder that
// differs every time it is drawn is noise.
const _TL_SKEL_H=[54,72,38,88,64,46,30];
let _tlSkelShown=false;
function _tlBarsSkelHtml(){
  const cols=_TL_SKEL_H.map(h=>
    '<li class="tl-wbar-col"><span class="tl-wbar-plot">'+
      '<span class="td-skel tl-skel-bar" style="height:'+h+'%"></span></span>'+
      '<span class="td-skel tl-skel-lbl"></span>'+
      '<span class="td-skel tl-skel-amt"></span>'+
    '</li>').join('');
  // The same header shell and the same chart card the real thing lands in, so
  // nothing jumps when it does: only the contents are swapped.
  return '<div class="tl-drill" aria-hidden="true"><div class="tl-monav">'+
      '<span class="td-skel tl-skel-btn"></span>'+
      '<div class="tl-monav-mid">'+
        '<span class="td-skel tl-skel-ttl"></span>'+
        '<span class="td-skel tl-skel-sub"></span>'+
      '</div>'+
      '<span class="td-skel tl-skel-btn"></span>'+
    '</div></div>'+
    '<div class="tl-wbar-wrap" aria-hidden="true">'+
      '<ol class="tl-wbar" style="grid-template-columns:repeat(7,minmax(0,1fr))">'+
        cols+
      '</ol>'+
    '</div>';
}
function _tlBarsHtml(groups,opts){
  const fm=typeof _fmtMin==='function'?_fmtMin:(m=>m+'m');
  const list=(Array.isArray(groups)?groups:[]).filter(g=>g&&typeof g==='object');
  if(!list.length)return '';
  const o=opts||{};
  const folds=list.map(g=>_tlBucketFold(g.rows));
  if(!folds.some(f=>f.min>0))return '';
  const ceil=_tlBarCeiling(folds.map(f=>f.min),o.floorMin);
  const gMin=Number(o.guideMin)||0;
  const guide=(gMin>0&&gMin<=ceil)
    ?'<span class="tl-wbar-guide" style="bottom:'+(gMin/ceil*100).toFixed(2)+'%">'+
       '<b>'+escHtml(String(o.guideLabel||''))+'</b></span>'
    :'';
  // The guide is drawn OVER the bars, not behind them. Behind, it vanished
  // under every column tall enough to matter, which is precisely the set of
  // columns it exists to flag.
  const cols=list.map((g,i)=>{
    const rows=Array.isArray(g.rows)?g.rows:[];
    const e=folds[i];
    const gapMin=rows.filter(r=>_tlRailKind(r)==='gap').reduce((s,r)=>s+(r.minutes||0),0);
    const h=Math.min(100,e.min/ceil*100);
    // Bottom-up, in _TL_BUCKETS order, so the same colour sits in the same
    // place in every column and the stack can be compared across columns.
    const segs=_TL_BUCKETS.filter(b=>(e[b.k]||0)>0).map(b=>
      '<i class="tl-wbar-seg" style="flex:'+(e[b.k]||0)+' 0 auto;background:'+b.c+'" '+
      'title="'+escHtml(b.label+' '+fm(e[b.k]))+'"></i>').reverse().join('');
    const aria=(g.aria||g.label||'')+', '+
      (e.min?fm(e.min):'nothing logged')+(gapMin?', '+fm(gapMin)+' unaccounted':'');
    // The badge rides just above the TOP OF THE BAR, not at the top of the
    // column: parked at the ceiling it floated in space over a short column
    // and read as belonging to nothing.
    const amt=_tlBarAmtParts(e.min);
    // CLAMPED so it can never leave the plot. Parked at the top of a bar that
    // nearly reaches the ceiling, the badge floated above the chart and landed
    // on the guide's own "40h" label (§15.1: nothing overlaps). Past 86% it
    // rides just inside the bar's top edge instead, where the amber ring keeps
    // it readable against any segment colour.
    // 78, not 86: the badge is drawn ABOVE its anchor, so the anchor plus its
    // own 15px has to fit inside the 92px plot. 86% left it five pixels out.
    const qb=Math.min(h,78);
    const q=gapMin
      ?'<i class="tl-wbar-q" style="bottom:calc('+qb.toFixed(2)+'% + 3px)" '+
        'title="'+escHtml(fm(gapMin)+' unaccounted, tap to answer')+'">?</i>'
      :'';
    // The countable unknown, printed on the bar it counts. Only when the bar is
    // tall enough to hold it: a number crammed into a 12px sliver is noise, and
    // the short bars are the ones nobody is curious about anyway.
    const stops=_tlStopCount(rows);
    const stopTag=(stops>0&&h>=26)
      ?'<i class="tl-wbar-n" aria-hidden="true">'+stops+'</i>'
      :'';
    return '<li class="tl-wbar-col'+(e.min?'':' tl-wbar-none')+'">'+
      '<button type="button" class="tl-wbar-hit" aria-label="'+escHtml(aria+
          (stops?', '+stops+' stop'+(stops===1?'':'s'):''))+'" '+
        'onclick="'+escHtml(String(g.onclick||''))+'">'+
        '<span class="tl-wbar-plot">'+q+
          '<span class="tl-wbar-stack" style="height:'+h.toFixed(2)+'%">'+segs+stopTag+'</span>'+
        '</span>'+
        '<span class="tl-wbar-dow">'+escHtml(String(g.label||''))+'</span>'+
        // The hours are TEXT under every column, so the comparison the chart
        // makes by height is also there in words (1.4.1), and a column that is
        // simply short is never mistaken for one that failed to record.
        '<span class="tl-wbar-amt">'+escHtml(e.min?amt.top:'—')+'</span>'+
        // ALWAYS emitted, empty or not. A conditional span made columns with
        // no minutes part one row shorter, so the bars stopped sharing a
        // baseline. Same reason the height is fixed in CSS rather than left to
        // the line box.
        '<span class="tl-wbar-sub">'+escHtml(amt.sub)+'</span>'+
      '</button>'+
    '</li>';
  }).join('');
  return '<div class="tl-wbar-wrap">'+
    '<div class="tl-wbar-plotarea">'+guide+'</div>'+
    '<ol class="tl-wbar" style="grid-template-columns:repeat('+list.length+',minmax(0,1fr))">'+
      cols+
    '</ol>'+
    (o.share||'')+
  '</div>';
}
// A WEEK: seven days, guided at 8 hours.
function _tlWeekBarsHtml(weekRows,days,cacheKey,opts){
  const list=(Array.isArray(weekRows)?weekRows:[]).filter(r=>r&&typeof r==='object');
  const dayList=Array.isArray(days)?days:[];
  if(!list.length||!dayList.length)return '';
  const byDay={};
  dayList.forEach(d=>{byDay[d]=[];});
  list.forEach(r=>{if(byDay[r.date])byDay[r.date].push(r);});
  // Share sits ON the week it sends, not at the bottom of the page, because
  // the page-level button has always meant "this calendar week" and this one
  // means "the week you are looking at." Two different things, so two
  // controls, both through _tlWeekShareText.
  // NOT inside a crew member's week. _tlShareWeekAt resolves its rows from
  // _tlLastRows, which in Team scope is the whole crew, so the button would
  // send everybody's hours under one person's heading. A per-person send is a
  // real feature and it needs its own builder, not this one pointed sideways.
  const share=(opts&&opts.share===false)?'':
    '<button type="button" class="tl-wbar-share" '+
    'onclick="_tlShareWeekAt(\''+escHtml(String(cacheKey))+'\')">'+
    (typeof svgIcon==='function'?svgIcon('⬆',{size:12}):'')+' Send this week</button>';
  return _tlBarsHtml(dayList.map((d,i)=>({
    label:(typeof _tlDayShort==='function'?_tlDayShort(d):d).slice(0,1),
    aria:(typeof _tlDayFullLabel==='function'?_tlDayFullLabel(d):d),
    rows:byDay[d]||[],
    onclick:'_tlDrillTo(\'day\',\''+String(d)+'\')'
  })),{guideMin:_TL_BAR_GUIDE_MIN,guideLabel:'8h',share});
}
// A MONTH: one bar per week, guided at 40 hours.
//
// 40 is the line that matters at this zoom for the same reason 8 is at the
// week's: it is the number that changes what somebody does next (overtime),
// and a chart scaled only to its own tallest week would make every month look
// normal. The weeks read oldest to newest left to right, because that is the
// direction a month runs and the eye is being asked to see a trend.
const _TL_MONTH_GUIDE_MIN=40*60;
// The floor is the guide PLUS headroom, not the guide itself (owner
// 2026-08-30: "40 hr benchmark looks odd at the top"). Floored at exactly 40h,
// a month nobody crossed 40 in put the line at 100% of the plot, flush with
// the top edge, where it read as the chart's border rather than as a mark to
// be under, and its label had nowhere to sit but outside. 14% of air above it
// makes it a line in a chart again.
const _TL_MONTH_FLOOR=Math.round(_TL_MONTH_GUIDE_MIN*1.14);
function _tlMonthBarsHtml(monthRows,mo,scope,uid){
  // ME ONLY, the same split the week already makes. Folding a whole crew into
  // one bar per week hides who did what, which is the single thing the
  // per-person cards exist to show, so Team keeps the cards and skips the
  // chart rather than getting a prettier version of a worse answer.
  // Team's PAGE still has no month chart, and that is still the reason: one
  // bar per week for a whole crew hides who did what. Handed a uid the rows
  // are ONE person's, which is not a fold at all, so the same function draws
  // it (§7.3) rather than a second month chart existing for crew.
  if(scope==='team'&&!uid)return '';
  const list=(Array.isArray(monthRows)?monthRows:[]).filter(r=>r&&typeof r==='object');
  if(!list.length)return '';
  const byWeek={};
  list.forEach(r=>{const wk=_tlWeekKey(r.date)||'';if(wk)(byWeek[wk]||(byWeek[wk]=[])).push(r);});
  const weeks=Object.keys(byWeek).sort();
  if(!weeks.length)return '';
  // Same reason the week's is suppressed, plus one more: these charts live in
  // an accordion, so N open cards would mean N Send buttons on one screen
  // (§15.1 allows exactly one primary Send per screen).
  const share=uid?'':'<button type="button" class="tl-wbar-share" '+
    'onclick="_tlShareMonth(\''+escHtml(String(mo))+'\')">'+
    (typeof svgIcon==='function'?svgIcon('⬆',{size:12}):'')+' Send this month</button>';
  // Sanitised, not escaped: this string is put INTO an onclick that _tlBarsHtml
  // escapes once on the way out, so escaping it here too would double-encode
  // it. Restricting the characters is both safe and idempotent.
  const su=String(uid||'').replace(/[^0-9a-zA-Z_-]/g,'');
  return _tlBarsHtml(weeks.map(wk=>({
    // "Aug 23" reads as the week it starts, which is how a contractor names a
    // week out loud. The full label is on the accordion this scrolls to.
    label:_tlWeekShortLabel(wk),
    aria:(typeof _tlWeekLabel==='function'?_tlWeekLabel(wk):wk),
    rows:byWeek[wk],
    onclick:su?('_tlDrillPerson(\''+su+'\',\''+String(wk)+'\')')
              :('_tlDrillTo(\'week\',\''+String(wk)+'\')')
    // THE 40-HOUR LINE IS ALWAYS ON SCREEN AT THIS ZOOM, which is what the
    // floor buys: the ceiling can no longer fall below it, so the guide is
    // drawn on every month instead of only on months somebody happened to
    // cross it. Without this a crew member's 23h week was the tallest thing in
    // its own chart and read as a full one (owner 2026-08-30, on Jose's card).
    // The cost is deliberate: a light month draws short bars, which is the
    // true answer, and the hours are printed under every column anyway.
  })),{guideMin:_TL_MONTH_GUIDE_MIN,guideLabel:'40h',share,
      floorMin:_TL_MONTH_FLOOR});
}
// "8/23" for a weekly column: short enough for six columns on a 320px phone,
// and unambiguous because the month picker above already names the month.
function _tlWeekShortLabel(wk){
  const p=String(wk||'').split('-');
  if(p.length<3)return String(wk||'');
  return String(Number(p[1]))+'/'+String(Number(p[2]));
}
// ── The month level: pick a month, see its weeks ───────────────────────────
// Owner, 2026-08-30: "we also need a monthly picker that shows weekly bars and
// fills the page then a way to pick previous months inside of the year we have
// open."
//
// This REPLACES the month accordion list rather than sitting on top of it. A
// list of twelve collapsed months and a month picker are two navigations for
// one job, and every call he has made this session has been to cut the second
// one. So the year now opens on a month, the month is a chart, and the weeks
// of that month are the accordions underneath it.
//
// The picker is the same .tl-chip row the day picker uses (§7.3), not a new
// control that happens to look similar. A month with nothing logged is still
// shown, disabled: which months a year HAS is information, and a gap in the
// row says "nothing that month" better than a missing chip does.
// Which way the chart should slide on the next render: set by an arrow tap,
// cleared by anything else. Declared beside the selection it belongs to and
// ABOVE setTimeLogMonth, which writes it.
let _tlMonthDir='';
// Kept as the public way to jump to a month. It routes through the drill so
// there is still exactly one path that changes what month is on screen.
function setTimeLogMonth(mo,dir){
  if(!/^\d{4}-\d{2}$/.test(String(mo||'')))return;
  _tlDrillTo('month',mo,dir);
}
// _tlOpenWeek, _tlMonthStep and _tlMonthNavHtml were DELETED here, not left
// orphaned (§7). They were the accordion-and-chip navigation the drill
// replaced: opening a week in a list below the chart, stepping months through
// a picker that no longer exists, and a nav bar whose job _tlDrillHeadHtml now
// does at every level instead of only this one.
// The month as text, same shape and the same builder family as the week's
// (§7.3): one line per week, the split, and the total.
function _tlMonthShareText(rows,mo){
  const fm=typeof _fmtMin==='function'?_fmtMin:(m=>m+'m');
  // FILTERED HERE, not trusted from the caller. A message headed "August 2026"
  // that carries September hours is a wrong number in somebody's payroll text,
  // and the only thing that stood between us and that was every caller
  // remembering to filter first. One of them did; the rule now lives in the
  // function that prints the heading.
  const inMonth=/^\d{4}-\d{2}$/.test(String(mo||''))
    ? (r=>String((r&&r.date)||'').slice(0,7)===mo) : (()=>true);
  const list=(Array.isArray(rows)?rows:[]).filter(r=>r&&typeof r==='object').filter(inMonth);
  const byWeek={};
  list.forEach(r=>{const wk=_tlWeekKey(r.date)||'';if(wk)(byWeek[wk]||(byWeek[wk]=[])).push(r);});
  const lines=Object.keys(byWeek).sort().map(wk=>{
    const min=_tlPaidMin(byWeek[wk]);
    if(!min)return '';
    const gap=byWeek[wk].filter(r=>_tlRailKind(r)==='gap').reduce((s,r)=>s+(r.minutes||0),0);
    return (typeof _tlWeekLabel==='function'?String(_tlWeekLabel(wk)).replace(/^Week of /,'Wk '):wk)+
      ': '+fm(min)+(gap?' ('+fm(gap)+' unaccounted)':'');
  }).filter(Boolean);
  const e=_tlBucketFold(list);
  const split=_TL_BUCKETS.filter(b=>(e[b.k]||0)>0).map(b=>b.label+' '+fm(e[b.k])).join(', ');
  const out=['Hours, '+(typeof _bkMonthLabel==='function'?_bkMonthLabel(mo):String(mo)),''];
  if(lines.length)out.push(lines.join('\n'),'');
  out.push('Total: '+(fm(e.min)||'0m'));
  if(split)out.push(split);
  return out.join('\n');
}
async function _tlShareMonth(mo){
  const rows=(_tlLastRows||[]).filter(r=>r&&String(r.date||'').slice(0,7)===mo);
  if(!rows.length){
    typeof showToast==='function'&&showToast('No hours logged that month yet','📋');return;
  }
  const text=_tlMonthShareText(rows,mo);
  if(typeof pwaShare==='function')await pwaShare({title:'Hours',text});
  return text;
}
// ── ONE drill, one idiom ───────────────────────────────────────────────────
// Owner, 2026-08-30: "I'm so confused on this, love the bars and what they
// show but I'm lost on how we drill down cleanly ... year up top, then month
// which has four week bars, then drill to week then clicking the week lets you
// drill to days, what's the cleanest way to do this?"
//
// He was lost because the page had FOUR navigation idioms stacked on it: a
// dropdown for the year, an arrow stepper for the month, an accordion LIST for
// the weeks, and chip tabs for the days. Three of them could reach the same
// week, two charts could be on screen at once, and none of them agreed on what
// tapping meant.
//
// This is his sentence, built literally, with one rule: ONE LEVEL ON SCREEN,
// ONE CHART, and exactly three gestures, each meaning one thing.
//
//   Year   the selector already at the top of the page, unchanged
//   Month  weekly bars      tap a bar to go down
//   Week   daily bars       tap a bar to go down
//   Day    the rail
//
//   ‹ ›    move sideways, to the next sibling that HAS hours
//   bar    go down a level
//   back   go up a level, and it names where it goes
//
// The week accordion list is gone. It was a second way to do the drill the
// bars already do, it duplicated every total the chart above it was drawing,
// and it is the single biggest reason this felt like a maze.
// uid is WHOSE rows the levels are showing, not a level of its own. In Me
// scope it is always null. In Team it is set by tapping a week on a crew
// member's card, rides along week to day, and is dropped on the way back up to
// month, because the crew list is the one screen that is not about one person.
let _tlDrill={level:'month',mo:null,wk:null,day:null,uid:null};
// Which way the chart is about to move, and it is FOUR directions, not two.
// The arrows move sideways and already said so; going down a level and coming
// back up said nothing at all, so a tap that changed what the chart MEANS
// looked exactly like a tap that changed which week it was showing. Ranking
// the levels is what lets one line tell those apart.
const _TL_LEVEL_RANK={month:0,week:1,day:2};
// The month a day belongs to, and '' for anything that is not a real date, so
// a junk key can never park the drill on a month that does not exist.
function _tlMonthKey(dateStr){
  return _tlWeekKey(dateStr)?String(dateStr).slice(0,7):'';
}
// Which month a WEEK belongs to, which is a real question because a week
// straddles two of them five times a year (the week of Aug 30 is also the
// first five days of September). The month chart is built one month at a
// time, so a week key alone is not enough to find the week's rows: answer it
// with the rows themselves, the month actually holding this week's hours, and
// fall back to the week's own start date only when nothing is logged in it.
// Getting this wrong is not cosmetic: land on a month whose chart has no such
// week and the render snaps the week back to that month's last one, which is
// the dead end all over again.
function _tlWeekMonth(wk){
  if(!wk)return '';
  const seen={};
  (_tlLastRows||[]).forEach(r=>{
    if(!r||!r.date||_tlWeekKey(r.date)!==wk)return;
    if(_tlDrill.uid&&_tlRowUid(r)!==_tlDrill.uid)return;
    const mo=String(r.date).slice(0,7);seen[mo]=(seen[mo]||0)+1;
  });
  const months=Object.keys(seen);
  if(!months.length)return _tlMonthKey(wk);
  // Most hours wins a straddled week, ties to the earlier month, so the same
  // week always resolves to the same side no matter which way you arrived.
  return months.sort((a,b)=>seen[b]-seen[a]||a.localeCompare(b))[0];
}
function _tlDrillTo(level,key,dir){
  const uid=_tlDrill.uid,was=_tlDrill.level;
  if(level==='month')_tlDrill={level:'month',mo:key||_tlDrill.mo,wk:null,day:null,uid:null};
  // The week and month a key sits in are DERIVED from the key, never carried
  // over from whatever happened to be on screen. Owner, 2026-08-31: "week day
  // changer only lets you go back to the start of the week but it should be
  // smart enough to continue to go backwards into previous weeks with the
  // arrow buttons." The arrows now hand this a day in the PREVIOUS week, and
  // the render resolves the level against _tlDrill.wk/.mo: leave those
  // pointing at the week you left and the day is snapped straight back into
  // it, which IS the dead end. Deriving them is also what makes the
  // "‹ Week of ..." back link follow the day over the boundary instead of
  // naming a week that is no longer on screen.
  else if(level==='week')_tlDrill={level:'week',mo:_tlWeekMonth(key)||_tlDrill.mo,
    wk:key,day:null,uid:uid};
  else if(level==='day')_tlDrill={level:'day',mo:_tlMonthKey(key)||_tlDrill.mo,
    wk:_tlWeekKey(key)||_tlDrill.wk,day:key,uid:uid};
  else return;
  const a=_TL_LEVEL_RANK[was],b=_TL_LEVEL_RANK[level];
  // An explicit arrow direction always wins: stepping sideways is what the
  // caller asked for even when the level happens to be the same.
  _tlMonthDir=(dir==='fwd'||dir==='back')?dir
    :(b>a)?'down':(b<a)?'up':'';
  // FROM MEMORY, and this is the whole of the second defect. Owner,
  // 2026-08-31: "like almost 2 seconds to change a day, thats awful." Every
  // drill tap came back through renderTimeLog, which opens by AWAITING
  // _timeLogRows: three round trips to Supabase (team_members,
  // job_time_entries, shop_time_entries via _fetchCrewLabor) plus the
  // CoreMotion tape _tlShopTape reads off the coprocessor, and only then does
  // anything on screen move. None of that work can change the answer: a drill
  // tap picks a different SLICE of rows the page is already holding. So it
  // paints from the rows it already has, synchronously, in the same task as
  // the tap, and _tlRevalidateRows checks the server afterwards.
  renderTimeLog({cached:true});
}
// Into one crew member's week. The ONLY way uid is ever set, so there is one
// door in and _tlDrillTo owns everything after it.
function _tlDrillPerson(uid,wk){
  // Falsy BEFORE stringifying: String(0) is '0', which is a perfectly truthy
  // string and would have set the drill to a person who does not exist. No
  // real id is falsy, so this costs nothing and closes the whole class.
  if(!uid)return;
  _tlDrill.uid=String(uid);
  _tlDrillTo('week',wk);
}
// The identity key a row aggregates under, which is personUid except for the
// owner's own manual rows: those carry null and fold under the contractor id,
// the same rule _tlEmpWeekAgg and _tlEmpAccHtml already use. _tlLastCid is set
// beside _tlLastRows on every render, for the same reason: the arrows are
// clicked long after the render that drew them.
let _tlLastCid=null;
function _tlRowUid(r){return String((r&&r.personUid)||_tlLastCid);}
function _tlDrillUp(){
  if(_tlDrill.level==='day')_tlDrillTo('week',_tlDrill.wk);
  else if(_tlDrill.level==='week')_tlDrillTo('month',_tlDrill.mo);
}
// The siblings of whatever is on screen, in calendar order, and ONLY the ones
// with hours. Stepping onto an empty chart is the thing the arrows exist to
// prevent.
function _tlDrillSiblings(rows){
  // Inside a crew member's drill the arrows step through THEIR weeks and days,
  // never the whole crew's: stepping from one person's Tuesday to another
  // person's Wednesday is not a sideways move, it is a different question.
  const list=(Array.isArray(rows)?rows:[]).filter(r=>r&&r.date&&
    (!_tlDrill.uid||_tlRowUid(r)===_tlDrill.uid));
  const keys=[];
  const push=k=>{if(k&&keys.indexOf(k)<0)keys.push(k);};
  // NOT clipped to the month or the week on screen. Both lists used to be,
  // and that is exactly what the owner hit on 2026-08-31: the first day of a
  // week had no previous sibling, so the arrow was drawn disabled and the day
  // stepper dead-ended at Sunday instead of carrying on into Saturday of the
  // week before. A week is not the end of the calendar, it is a window on it.
  // The bounds that are real are kept, and they are the two the list already
  // had: only siblings that HAVE hours (stepping onto an empty chart is what
  // the arrows exist to prevent, which also means there is nothing to step
  // forward onto past today), and only inside the open year, because that is
  // the whole set _tlLastRows holds and the year selector is its own control.
  if(_tlDrill.level==='month')list.forEach(r=>push(String(r.date).slice(0,7)));
  else if(_tlDrill.level==='week')list.forEach(r=>push(_tlWeekKey(r.date)));
  else if(_tlDrill.level==='day')list.forEach(r=>push(r.date));
  return keys.sort();
}
function _tlDrillStep(delta,rows){
  const keys=_tlDrillSiblings(rows);
  const cur=_tlDrill.level==='month'?_tlDrill.mo:_tlDrill.level==='week'?_tlDrill.wk:_tlDrill.day;
  const i=keys.indexOf(cur);
  if(i<0)return;
  const next=keys[i+(delta>0?1:-1)];
  if(!next)return;
  _tlDrillTo(_tlDrill.level,next,delta>0?'fwd':'back');
}
// ONE header for every level (§7.3). Same stepper, same shape, so moving
// between levels never changes what the controls mean.
// THE WEEK AND DAY LEVELS, WRITTEN ONCE (§7.3).
//
// Me looking at his own week and an owner looking at Jose's week are the same
// screen: same chart, same rail, same header, same arrows. The only things
// that differ are whose rows go in, whose name sits on top, and where the back
// link says it goes. Those are arguments. Building Team a second copy is how
// the split bar and Crew Cost ended up disagreeing about what a minute was.
//
// Returns null when the drill is at month level, because a month is NOT the
// same screen in both places: for Me it is a chart, for Team it is the crew
// list. Each caller renders its own.
//
// It also RESOLVES the level, which is why it owns the writes to _tlDrill.wk
// and .day: a week that vanished under us (arrowed into a new month, data
// re-synced) falls back to the month's last week rather than drawing nothing.
function _tlLevelsHtml(moRows,selMo,opts){
  const o=opts||{};
  const fm=typeof _fmtMin==='function'?_fmtMin:(m=>m+'m');
  const byWeek={};
  (Array.isArray(moRows)?moRows:[]).forEach(r=>{
    const wk=r&&_tlWeekKey(r.date)||'';if(wk)(byWeek[wk]||(byWeek[wk]=[])).push(r);});
  const weekKeys=Object.keys(byWeek).sort();
  if(_tlDrill.level!=='month'&&weekKeys.indexOf(_tlDrill.wk)<0)
    _tlDrill.wk=weekKeys[weekKeys.length-1]||null;
  if(!_tlDrill.wk&&_tlDrill.level!=='month')_tlDrill.level='month';
  if(_tlDrill.level==='month')return null;
  // A WEEK IS NOT A SLICE OF A MONTH (owner 2026-09-01: "the weekly bar graph
  // isn't rendering my daily time today, nothing shows but the day rail is
  // perfect"). moRows is the SELECTED MONTH, and the week on screen is
  // whatever seven days _tlWeekDayDates names, which twelve times a year
  // crosses a month boundary. Sourcing the chart from the month meant the
  // straddling week could only ever draw the half that lived on the selected
  // side, and _tlWeekMonth resolves that side by whichever half has more
  // hours: so on Sunday the new month's days are blank, and by Thursday the
  // old month's are. Reproduced 2026-09-01 with 8h/8h on Aug 30-31 and 4h36m
  // today: the August view drew "8h 8h — — — — —" and hid Tuesday entirely,
  // while the day rail, reached through a drill whose month followed the day,
  // was right. Two surfaces, one week, two answers.
  //
  // _tlLastRows is the whole scope-filtered year and is already assigned
  // before this runs, which is the same set _tlDrillSiblings has always read
  // for exactly this reason (the arrows have always stepped across months).
  // Only the WEEK LIST above stays month-scoped: that is the fallback for a
  // week that vanished under us, and it should still land inside the month
  // the picker is pointing at.
  const wkRows=(_tlLastRows||[]).filter(r=>r&&_tlWeekKey(r.date)===_tlDrill.wk&&
    (!_tlDrill.uid||_tlRowUid(r)===_tlDrill.uid));
  const days=_tlWeekDayDates(_tlDrill.wk);
  if(_tlDrill.level==='week')
    return {head:_tlDrillHeadHtml(_tlWeekLabel(_tlDrill.wk),fm(_tlPaidMin(wkRows)),
              _tlDrill.wk,o.backLabel||_bkMonthLabel(selMo),o.eyebrow),
            body:_tlWeekBarsHtml(wkRows,days,_tlDrill.wk,{share:o.share})};
  const dayKeys=days.filter(d=>wkRows.some(r=>r.date===d));
  if(dayKeys.indexOf(_tlDrill.day)<0)_tlDrill.day=dayKeys[dayKeys.length-1]||null;
  const dayRows=wkRows.filter(r=>r.date===_tlDrill.day);
  return {head:_tlDrillHeadHtml(_tlDayFullLabel(_tlDrill.day),fm(_tlPaidMin(dayRows)),
            _tlDrill.day,_tlWeekLabel(_tlDrill.wk),o.eyebrow),
          body:_tlRailHeadHtml(dayRows,'',true)+_tlDayRailHtml(dayRows)};
}
// keys is NOT a parameter any more, and that is the other half of the dead
// end (owner 2026-08-31). Every caller passed the list it happened to be
// looping over, and at the day level that list was the days of ONE week: on
// the first of them the back arrow was drawn disabled, so the step the arrows
// were perfectly capable of making could not even be asked for. One authority
// on what a sideways step does, and it is the same one that performs it
// (7.3), so an arrow is live exactly when _tlDrillStep has somewhere to go.
function _tlDrillHeadHtml(title,total,cur,backLabel,eyebrow){
  const keys=_tlDrillSiblings(_tlLastRows);
  const i=keys.indexOf(cur);
  const prev=i>0,next=i>=0&&i<keys.length-1;
  const arrow=(dir,on,glyph,word)=>
    '<button type="button" class="tl-monav-btn"'+(on?'':' disabled aria-disabled="true"')+
    ' aria-label="'+escHtml(word)+'" onclick="_tlDrillStep('+dir+',_tlLastRows)">'+glyph+'</button>';
  // The back link NAMES where it goes. "Back" alone makes somebody guess, and
  // guessing is the thing this whole rebuild is undoing.
  const back=backLabel
    ?'<button type="button" class="tl-drill-back" onclick="_tlDrillUp()">'+
       '\u2039 '+escHtml(backLabel)+'</button>'
    :'';
  // Whose. Only Team sets it: on a crew member's week the title says which
  // week and the total says how much, and without this nothing on the screen
  // says which of five people you are looking at.
  const who=eyebrow?'<div class="tl-drill-who">'+escHtml(String(eyebrow))+'</div>':'';
  return '<div class="tl-drill">'+back+who+
    '<div class="tl-monav">'+
      arrow(-1,prev,'\u2039','Previous')+
      '<div class="tl-monav-mid" aria-live="polite">'+
        '<div class="tl-monav-lbl">'+escHtml(title)+'</div>'+
        '<div class="tl-monav-tot">'+escHtml(total)+'</div>'+
      '</div>'+
      arrow(1,next,'\u203a','Next')+
    '</div>'+
  '</div>';
}
// ── A gap answered on Saturday, covered by real rows on Sunday ─────────────
// Owner, 2026-08-30, looking at a manual row on 08/27: "then saw shop time
// manual at 12:13 pm what's up with that?"
//
// He had tapped Add on what was a genuine hole at the time: a duplicate shop
// session was clipping the real one down to five minutes, so 12:13 to 12:50
// read as unaccounted and he answered it honestly. The dedupe sweep later
// deleted the duplicate, the real 37-minute shop session came back whole, and
// his 36 manual minutes were left sitting on top of it. The day counted them
// twice.
//
// Nothing was wrong with the answer. What was missing is that an answer is a
// CLAIM ON A WINDOW, and no code ever re-checked that claim against rows which
// showed up afterwards. That matters more now than it did: the day rail asks
// the question on every hole, with three chips, so these rows are about to
// become common rather than rare.
//
// TRIMMED, NOT DELETED, and this is the whole design. If half the window is
// now covered, the person's answer about the other half is still true and
// still theirs. Only a claim with nothing left of it is withdrawn. The rule is
// deliberately one-directional: this sweep can shrink or remove a gap answer,
// never grow one and never create one, so the worst it can do is under-count
// time the derived rows already carry.
const _TL_GAP_LABEL_RE=/^(Added from unaccounted time|Break \(|Personal time)/;
const _TL_GAP_MIN_KEEP_MS=60000;   // under a minute left is not worth a row
// Only rows this app wrote from a gap are eligible. `fromGap` is stamped on
// every new one; the label match is the fallback for the rows written before
// the flag existed (there are real ones in production, 08/27 among them).
function _tlIsGapAnswer(e){
  if(!e||e.open)return false;
  if(e.fromGap===true)return true;
  return _TL_GAP_LABEL_RE.test(String(e.scope_label||''));
}
// Subtract every covered stretch from [a,b], returning what is left.
function _tlSubtractCovered(a,b,covers){
  let free=[[a,b]];
  (Array.isArray(covers)?covers:[]).forEach(c=>{
    if(!c||!(c[1]>c[0]))return;
    const next=[];
    free.forEach(([s,e])=>{
      if(c[1]<=s||c[0]>=e){next.push([s,e]);return;}   // no overlap
      if(c[0]>s)next.push([s,Math.min(c[0],e)]);
      if(c[1]<e)next.push([Math.max(c[1],s),e]);
    });
    free=next;
  });
  return free.filter(([s,e])=>e-s>=_TL_GAP_MIN_KEEP_MS);
}
// Runs at boot, after the geo sweeps have settled the derived rows: their
// answer is the input here, so this has to be last or it would trim against a
// half-corrected day.
async function _tlTrimCoveredGapRows(){
  const note=(ev,x)=>{try{if(typeof _geoParkNote==='function')_geoParkNote(ev,x);}catch(_e){}};
  // Concurrency guard (11.2), needed the moment the once-latch stopped being
  // set up front: supaLoadFromCloud re-runs on reconnect, so two invocations
  // can now overlap across this function's awaits, both holding the same
  // claims. One runs, the overlap no-ops.
  if(window._tlGapTrimBusy)return 0;
  window._tlGapTrimBusy=true;
  try{
    // The guard latches at the END, not here. It used to latch first, which
    // meant one silent failure (no client yet, a dropped read, anything the
    // catch below swallowed) killed the trim for the whole session with no
    // trace: the exact shape of the owner's 08/27 manual row surviving a boot
    // that healed everything around it. supaLoadFromCloud re-runs on
    // reconnect, so an unlatched miss simply tries again.
    if(window._tlGapTrimRan)return 0;
    if(typeof timeEntries==='undefined'||!Array.isArray(timeEntries))return 0;
    const claims=timeEntries.filter(_tlIsGapAnswer);
    if(!claims.length){window._tlGapTrimRan=true;return 0;}
    if(typeof _supa==='undefined'||!_supa||typeof _supaUser==='undefined'||!_supaUser)return 0;
    // Every derived row that could cover a claim, over the span the claims
    // actually occupy: one query, not one per row.
    const starts=claims.map(e=>Date.parse(e.start_time)||0).filter(Boolean);
    const ends=claims.map(e=>Date.parse(e.end_time)||0).filter(Boolean);
    if(!starts.length||!ends.length)return 0;
    const lo=new Date(Math.min.apply(null,starts)-3600000).toISOString();
    const hi=new Date(Math.max.apply(null,ends)+3600000).toISOString();
    const covers=[];
    for(const tbl of ['job_time_entries','shop_time_entries']){
      const{data,error}=await _supa.from(tbl).select('arrived_at,departed_at')
        .is('deleted_at',null).eq('employee_user_id',_supaUser.id)
        .gte('arrived_at',lo).lte('arrived_at',hi);
      if(error||!Array.isArray(data))continue;
      data.forEach(r=>{
        const a=Date.parse(r&&r.arrived_at)||0,b=Date.parse(r&&r.departed_at)||0;
        if(b>a)covers.push([a,b]);
      });
    }
    // No derived rows came back at all: that is a failed read, not an empty
    // day, and trimming against it would delete every answer the person ever
    // gave. Same interlock the dwell sweep carries. Unlatched, so a flaky
    // read retries on the next load instead of dying quietly.
    if(!covers.length){note('gap-trim','no covers, retrying next load');return 0;}
    let changed=0;
    // A stack of answers on ONE span is one answer plus leftovers. Newest
    // wins: it is the last thing the person actually chose. (His 08/27 window
    // carried three, two Breaks and a Personal, because the old repeat bug
    // wrote a fresh row on every tap.)
    const bySpan={};
    claims.forEach(e=>{
      const a=Date.parse(e.start_time)||0,b=Date.parse(e.end_time)||0;
      if(!(b>a))return;
      (bySpan[a+'|'+b]=bySpan[a+'|'+b]||[]).push(e);
    });
    Object.keys(bySpan).forEach(k=>{
      const stack=bySpan[k];
      if(stack.length<2)return;
      stack.slice(0,-1).forEach(e=>{
        e.deleted=true;e._gapTrimmed='superseded';
        note('gap-trim',String(e.id).slice(0,10)+' superseded by a later answer');
        changed++;
      });
    });
    claims.forEach(e=>{
      if(e.deleted)return;
      const a=Date.parse(e.start_time)||0,b=Date.parse(e.end_time)||0;
      if(!(b>a))return;
      const left=_tlSubtractCovered(a,b,covers);
      if(left.length===1&&left[0][0]===a&&left[0][1]===b)return;   // untouched
      if(!left.length){
        e.deleted=true;e._gapTrimmed='covered';
        note('gap-trim',String(e.id).slice(0,10)+' '+(e.minutes||'?')+'m withdrawn, covered');
        changed++;
        return;
      }
      // Keep the longest surviving piece. A claim broken into two by a row in
      // the middle is one person's one answer, and splitting it into two rows
      // would invent a second entry they never made.
      const keep=left.slice().sort((x,y)=>(y[1]-y[0])-(x[1]-x[0]))[0];
      e.start_time=new Date(keep[0]).toISOString();
      e.end_time=new Date(keep[1]).toISOString();
      e.minutes=Math.max(1,Math.round((keep[1]-keep[0])/60000));
      e._gapTrimmed='trimmed';
      note('gap-trim',String(e.id).slice(0,10)+' trimmed to '+e.minutes+'m');
      changed++;
    });
    if(changed){
      // Deleted claims leave the array the same way every other delete on this
      // page does, so the cloud sweep carries the removal like any other.
      for(let i=timeEntries.length-1;i>=0;i--)if(timeEntries[i]&&timeEntries[i].deleted)timeEntries.splice(i,1);
      if(typeof saveAll==='function')saveAll();
      if(typeof supaSaveToCloud==='function')supaSaveToCloud();
      if(typeof renderTimeLog==='function')renderTimeLog();
    }
    window._tlGapTrimRan=true;
    note('gap-trim-done','claims='+claims.length+' changed='+changed);
    return changed;
  }catch(_e){note('gap-trim','threw: '+String(_e&&_e.message).slice(0,80));return 0;}
  finally{window._tlGapTrimBusy=false;}
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
          // data-tl-open-start carries the clock-in instant so the 1s tick can
          // repaint just this node (_tlTickOpenElapsed) without re-rendering
          // the card. Re-rendering every second would rebuild the Clock out
          // button underneath a thumb that is already on it.
          '<div'+(r.startMs?' data-tl-open-start="'+r.startMs+'"':'')+' style="font-variant-numeric:tabular-nums;font-size:13px;font-weight:800'+(r.elapsedMin>600?';color:var(--c-red-deep)':'')+'">'+
            (r.startMs&&typeof _clockElapsedStr==='function'?_clockElapsedStr(Date.now()-r.startMs)
              :(typeof _fmtMin==='function'?_fmtMin(r.elapsedMin):r.elapsedMin+'m'))+'</div>'+
          // Own entry: clockOutEntry(id), which adopts this exact row and then
          // runs the real clockOut(). It used to call clockOut() bare, and
          // clockOut's first line is `if(!_activeTimer)return;`, so after a
          // reload (or when the open row lands from the cloud after boot) the
          // button silently did nothing (owner report 2026-08-31, Jack).
          // Someone else's entry: the manager-only force-close, which
          // audit-tags who closed it.
          (r.personUid===myUid?'<button onclick="clockOutEntry('+r.rawId+');_tlRenderOpenBanner()" class="btn btn-sm" style="font-size:11px">Clock out</button>'
            :canForce?'<button onclick="forceClockOutEntry('+r.rawId+')" class="btn btn-sm" style="font-size:11px">Clock out</button>':'')+
        '</div>'+
      '</div>'
    ).join('')+
  '</div>';
}
// Repaint ONLY the elapsed figures, once a second, straight off the DOM. It
// reads the clock-in instant back out of data-tl-open-start rather than
// walking timeEntries, so a ticking card costs one querySelectorAll a second
// and touches no data at all.
//
// Owner 2026-08-31: "keep the counter ticking live in the card". It used to
// move only on the 30s re-render, in whole minutes, so a clock that had just
// been started sat on 0m for half a minute and looked stopped. The LONG SHIFT
// badge and its red still land on the 30s pass: that threshold is ten hours,
// so it has never needed a per-second check.
let _tlOpenTickTimer=null;
function _tlTickOpenElapsed(){
  const host=document.getElementById('tl-open');
  if(!host||host.style.display==='none')return;
  const now=Date.now();
  host.querySelectorAll('[data-tl-open-start]').forEach(n=>{
    const t=Number(n.getAttribute('data-tl-open-start'));
    if(t>0&&typeof _clockElapsedStr==='function')n.textContent=_clockElapsedStr(now-t);
  });
}
function _tlStopOpenRefresh(){
  if(_tlOpenRefreshTimer){clearInterval(_tlOpenRefreshTimer);_tlOpenRefreshTimer=null;}
  if(_tlOpenTickTimer){clearInterval(_tlOpenTickTimer);_tlOpenTickTimer=null;}
}
function _tlStartOpenRefresh(){
  _tlStopOpenRefresh();
  // The open row can arrive from the cloud after boot, in which case the boot
  // rehydrate already ran and found nothing. Opening the Time Log is the next
  // moment we know the data is here, so the running clock reconnects to the
  // app-wide banner and the lock-screen card here too. It is a no-op when a
  // timer is already live (js/jobs.js _rehydrateActiveTimer guards on it).
  if(typeof _rehydrateActiveTimer==='function')_rehydrateActiveTimer();
  _tlRenderOpenBanner();
  // Two intervals on purpose, and they do different jobs: this one moves the
  // numbers, the 30s one below rebuilds the card when the SET of open rows
  // changes (somebody else clocks in or out).
  _tlOpenTickTimer=setInterval(()=>{
    if(!document.getElementById('pg-timelog')?.classList.contains('active')){_tlStopOpenRefresh();return;}
    _tlTickOpenElapsed();
  },1000);
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
    const e=byEmp[uid]||(byEmp[uid]={min:0,onsiteMin:0,driveMin:0,placeMin:0,shopMin:0,loadMin:0,weekOT:false,name:r.personName});
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
    // Loading the truck is carved OUT of the supply/other bucket (owner
    // 2026-08-30, who wants it named on the day's legend). One aggregator
    // still, not a second one computed inside the rail: the card and the rail
    // must never be able to disagree about what a minute was.
    else if(_src==='place-load')e.loadMin+=r.minutes||0;
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
// What on this person's rows actually needs a human (research 2026-08-29:
// "most timesheets require no intervention, with flags ensuring the ones
// that do get proper attention. The exception report should be short").
// So the collapsed card carries a COUNT, not a list, and the count is only
// ever things somebody has to decide about. A clean week shows nothing.
// ── One card per person, not one list for everybody (owner 2026-08-29) ─────
// "don't want everybodies time mixing together, must be structured by day,
// week, month and year by employee."
//
// Month and week were already accordions; the entries under them were one
// interleaved table, so Team scope was the only place the structure broke
// down. This is the missing level, and it is built on _bkWeekAcc's own
// open/close mechanics (§7.3) rather than a fourth accordion style: same
// chevron, same toggle, same class names, so it looks and behaves like every
// other collapsible surface in Books.
//
// Collapsed shows what the research says a contractor scans for: who, how
// long, how it split, and whether anything needs them. Open shows their days
// and their rows, nobody else's.
function _tlEmpAccHtml(cacheKey,rows,cid,selfUid,mo){
  const byEmp=_tlEmpWeekAgg(rows,cid);
  const fm=typeof _fmtMin==='function'?_fmtMin:(m=>m+'m');
  // Unpaid rows carry no paid minutes so they never reach _tlEmpWeekAgg, but
  // an unaccounted stretch is exactly what the card must flag. Bucket every
  // row by person here, paid or not.
  const rowsBy={};
  rows.forEach(r=>{const uid=String((r&&r.personUid)||cid);(rowsBy[uid]||(rowsBy[uid]=[])).push(r);});
  const flagged=f=>!!(f.bigDay||f.open||f.gaps||f.ot);
  // Anything needing a human sorts first, then longest week: the exception
  // surfaces without hunting, and past that the biggest payroll exposure
  // leads (research 2026-08-29, exception-based review).
  const uids=Object.keys(rowsBy).sort((a,b)=>{
    const sa=flagged(_tlEmpFlags(rowsBy[a]))?1:0,sb=flagged(_tlEmpFlags(rowsBy[b]))?1:0;
    if(sa!==sb)return sb-sa;
    return ((byEmp[b]||{}).min||0)-((byEmp[a]||{}).min||0);
  });
  const safeMo=String(mo).replace(/[^0-9a-z]/gi,'');
  return uids.map((uid,i)=>{
    const empRows=rowsBy[uid];
    const e=byEmp[uid]||{min:0,onsiteMin:0,driveMin:0,placeMin:0,shopMin:0,
      name:(empRows.find(r=>r&&r.personName)||{}).personName||'Crew'};
    const card=_tlEmpCardHtml(uid,e,selfUid,_tlFlagChips(_tlEmpFlags(empRows)));
    // THE CARD OPENS ONTO THAT PERSON'S MONTH, AS BARS (owner 2026-08-30,
    // asked how the bar affordance carries to Team: "1").
    //
    // What was here was a flat table of every day, six columns wide, scrolling
    // sideways on a phone: the same shape the drill replaced on the Me side
    // earlier today. Keeping it would have left Team with two navigation
    // idioms and Me with one, and it answered "which day looks wrong" by
    // making you read every row.
    //
    // Nothing is lost, it is one tap further in (§7.2). The table's columns
    // were Clock In, Clock Out, Duration and a per-day total, and a bar drills
    // to that person's week and then to the same day rail the owner already
    // has for himself, which carries all of it plus where they actually were.
    // The table's one unique signal, the >24h "Data error" marker, is already
    // on the card above as a flag chip, so it did not travel down with it.
    const body='<div class="tl-emp-bars">'+
      (_tlMonthBarsHtml(empRows,mo,'team',uid)||
        '<div class="tl-emp-nobars">No paid hours logged this month.</div>')+
      '</div>';
    // _bkTogWeek's own DOM contract (id, .bk-week, .bk-week-body), so the
    // shell opens and closes with the same code every other Books accordion
    // uses. Built here rather than through _bkWeekAcc because that helper
    // wraps its label in a title div and prints its own total, and the card
    // already carries both.
    const id=safeMo+'-'+i;
    return '<div id="bk-tlemp-wk-'+id+'" class="bk-week">'+
      '<button class="bk-week-hd" onclick="_bkTogWeek(\'tlemp\',\''+safeMo+'\',\''+i+'\')" style="align-items:center;gap:6px">'+
        '<div style="flex:1;min-width:0">'+card+'</div>'+
        '<div class="bk-week-chev">▸</div>'+
      '</button>'+
      '<div class="bk-week-body" style="display:none">'+body+'</div>'+
    '</div>';
  }).join('');
}
// PAID minutes, which is what every total on this page means (owner rule
// 2026-08-29: "unaccounted for time doesn't count to the total unless it's
// added"). The per-employee aggregate, the weekly running total and the OT
// calc have always skipped unpaid; the month, week, year and scope HEADLINES
// summed everything, so a week with a two-hour hole in it printed 14h 45m at
// the top and 12h 26m on the only card underneath. Both were describing the
// same week. One function now, so the two can never disagree again.
function _tlPaidMin(rows){
  return (Array.isArray(rows)?rows:[]).reduce((s,r)=>s+((r&&!r.unpaid)?(r.minutes||0):0),0);
}
function _tlEmpFlags(rows){
  const out={gaps:0,gapMin:0,ot:false,bigDay:false,open:0};
  if(!Array.isArray(rows))return out;
  const dayMin={};
  rows.forEach(r=>{
    if(!r)return;
    if(r.source==='unaccounted'){out.gaps++;out.gapMin+=r.minutes||0;}
    if(r.weekOT)out.ot=true;
    if(r.startTime&&!r.endTime)out.open++;
    if(!r.unpaid&&r.date)dayMin[r.date]=(dayMin[r.date]||0)+(r.minutes||0);
  });
  // More than 24 hours in one day is not physically possible, the same
  // impossible-day rule the per-day meta already applies.
  out.bigDay=Object.keys(dayMin).some(d=>dayMin[d]>1440);
  return out;
}
function _tlFlagChips(f){
  if(!f)return '';
  const fm=typeof _fmtMin==='function'?_fmtMin:(m=>m+'m');
  const chip=(bg,fg,icon,text)=>'<span style="display:inline-flex;align-items:center;gap:3px;font-size:9.5px;font-weight:800;padding:1px 6px;border-radius:4px;background:'+bg+';color:'+fg+';white-space:nowrap">'+svgIcon(icon,{size:9})+' '+text+'</span>';
  const out=[];
  if(f.bigDay)out.push(chip('var(--c-red-soft,#A32D2D22)','var(--c-red-deep,#A32D2D)','⚠','Data error'));
  if(f.open)out.push(chip('var(--c-green-soft)','var(--c-green-deep,#1B7A43)','▶',f.open+' still in'));
  if(f.gaps)out.push(chip('var(--bg2)','var(--text3)','❓',fm(f.gapMin)+' unaccounted'));
  if(f.ot)out.push(chip('var(--c-amber-soft)','var(--c-amber-deep)','⏱','OT'));
  return out.length?'<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">'+out.join('')+'</div>':'';
}
// THE employee card. One function, because Me and Team must render the same
// markup (owner rule 2026-08-26: "everything on the team should be the exact
// same thing on me, same code, same constant, only difference is the fact me
// is just me and team is everybody"). Team wraps this in a collapsible shell;
// Me shows it directly. Neither one has its own copy of the markup, which is
// what let the two drift apart the first time.
// THE buckets, in bar order, with the colour each one means on this page.
// One table, read by the employee card AND the day rail's legend, so the two
// can never drift into disagreeing about what a minute was or what colour it
// is. Colours are the ones already in use (§7.3), not new ones.
const _TL_BUCKETS=[
  {k:'onsiteMin', label:'On site',      c:'var(--blue)'},
  {k:'shopMin',   label:'Shop',         c:'var(--c-teal,#0E6B6B)'},
  {k:'driveMin',  label:'Driving',      c:'#9F5B00'},
  {k:'loadMin',   label:'Loading',      c:'#6D28D9'},
  {k:'placeMin',  label:'Supply/other', c:'var(--text3)'}
];
function _tlBucketTotal(e){
  return _TL_BUCKETS.reduce((s,b)=>s+((e&&e[b.k])||0),0);
}
function _tlEmpCardHtml(uid,e,selfUid,extraHtml){
  const fm=typeof _fmtMin==='function'?_fmtMin:(m=>m+'m');
  const name=e.name||'Crew';
  const pal=_tlAvatarPalette(name);
  const total=_tlBucketTotal(e)||1;
  const parts=_TL_BUCKETS.filter(b=>(e[b.k]||0)>3).map(b=>b.label+' '+fm(e[b.k]));
  const segs=_TL_BUCKETS.map(b=>'<span style="width:'+((e[b.k]||0)/total*100).toFixed(1)+'%;background:'+b.c+'"></span>').join('');
  const otBadge=e.weekOT?'<span class="tl-ot-badge" title="'+escHtml(name)+' logged 40+ hrs this week, verify overtime eligibility with your state; not payroll advice">OT</span>':'';
  const youTag=(selfUid&&String(uid)===String(selfUid))?' <span style="color:var(--text3);font-weight:600;font-size:11px">(you)</span>':'';
  return '<div class="tl-emp-row'+(e.weekOT?' ot':'')+'">'+
    '<div class="tl-avatar" style="background:'+pal.bg+';color:'+pal.fg+'">'+escHtml(_tlAvatarLabel(name))+'</div>'+
    '<div class="tl-emp-mid"><div class="tl-emp-name-row"><span class="tl-emp-name">'+escHtml(name)+'</span>'+youTag+otBadge+'</div>'+
      '<div class="tl-split"><div class="tl-split-bar">'+segs+'</div>'+
      '<div class="tl-split-legend">'+parts.join(' · ')+'</div></div>'+(extraHtml||'')+'</div>'+
    '<div class="tl-emp-total">'+fm(e.min)+'</div>'+
  '</div>';
}
// ── DELETED: the week body, its day-picker chips and their cache (§7) ─────
// _tlWeekMineHtml, _tlWeekCache, _tlPickerSel, setTimeLogDayPick and
// _tlRenderWeekBody all lived here. They were the week-inside-an-accordion
// world: a chip row to pick a day, a per-week render cache so one accordion
// could redraw without touching the others, and a body that stitched them
// together.
//
// The drill (2026-08-30) replaced every one of those jobs. There is one level
// on screen, so there is nothing to redraw selectively and no cache to keep;
// a day is reached by tapping its bar, so there are no chips; and the level's
// body is built straight in renderTimeLog. Left in place they would have been
// ~150 lines nothing calls, which is exactly what §7 forbids.
//
// _tlWeekOwnerHtml went with them: its only caller was the week body. Team's
// per-person cards come from _tlEmpAccHtml, which is untouched.
// Me/Team display toggle, for anyone with payroll/team permission. Owners
// default to Team, managers default to Me (see renderTimeLog); either can
// switch any time and the choice sticks for the rest of the session, same
// as _tlYear. A permission loss (e.g. a dual-hat switch to a crew hat with
// no payroll access) can never leave scope stuck on 'team', renderTimeLog
// clamps it back to 'me' every render.
let _tlScope=null;
function setTimeLogScope(scope){
  if(scope!=='me'&&scope!=='team')return;
  // A crew member is a Team idea. Carrying one into Me scope leaves the arrows
  // filtering your own weeks by somebody else's id, which reads as both arrows
  // simply being dead.
  _tlDrill.uid=null;
  _tlScope=scope;
  renderTimeLog();
}
// "Share this week's hours" (Me scope only, any role): the current Sun–Sat
// week, own rows only. _tlLastRows is only ever populated with Me-scoped
// rows while the Share button is visible (renderTimeLog hides the button
// entirely in Team scope), so no re-filtering by uid is needed here.
// ── Sharing a week as plain text ───────────────────────────────────────────
// Owner, 2026-08-30: "need a great way to export it to share via text."
//
// ONE builder, two entry points (§7.3). The old share existed but produced a
// bare list of day totals, and it was hardwired to the CURRENT calendar week:
// open the week of the 23rd, tap share, and you got this week's numbers
// instead of the ones on screen. Both callers now go through here so they can
// never say different things about the same week.
//
// Written for a text message and nothing else: no tabs, no aligned columns, no
// box drawing. Every one of those survives a desktop terminal and none of them
// survives an SMS bubble on a phone, which is the only place this is going.
// Days with nothing logged are left out rather than printed as zeros; a week
// where the crew worked four days should read as four lines.
function _tlWeekShareText(rows,wkStart){
  const fm=typeof _fmtMin==='function'?_fmtMin:(m=>m+'m');
  const list=(Array.isArray(rows)?rows:[]).filter(r=>r&&typeof r==='object');
  const days=(typeof _tlWeekDayDates==='function'&&wkStart)?_tlWeekDayDates(wkStart):[];
  const byDay={};
  days.forEach(d=>{byDay[d]=[];});
  list.forEach(r=>{if(byDay[r.date])byDay[r.date].push(r);
                   else if(!days.length)(byDay[r.date]=byDay[r.date]||[]).push(r);});
  const order=days.length?days:Object.keys(byDay).sort();
  const lines=[];
  order.forEach(d=>{
    const dayRows=byDay[d]||[];
    const min=_tlPaidMin(dayRows);
    if(!min)return;
    // An unanswered hole is called out on the day it belongs to. A number
    // somebody is about to act on should say when it is still incomplete.
    const gap=dayRows.filter(r=>_tlRailKind(r)==='gap').reduce((s,r)=>s+(r.minutes||0),0);
    lines.push(_tlDayShort(d)+': '+fm(min)+(gap?' ('+fm(gap)+' unaccounted)':''));
  });
  const e=_tlBucketFold(list);
  const split=_TL_BUCKETS.filter(b=>(e[b.k]||0)>0).map(b=>b.label+' '+fm(e[b.k])).join(', ');
  const head='Hours, '+(wkStart&&typeof _tlWeekLabel==='function'
    ?String(_tlWeekLabel(wkStart)).replace(/^Week of /,''):'this week');
  const out=[head,''];
  if(lines.length)out.push(lines.join('\n'),'');
  // _fmtMin(0) is the EMPTY STRING, which on the page is fine (nothing is
  // drawn) and in a text message is a line reading "Total:" with a blank after
  // it. A number nobody can read is worse than no message.
  out.push('Total: '+(fm(e.min)||'0m'));
  if(split)out.push(split);
  // 40+ hours is the one number on here that changes what somebody does next,
  // so it is stated rather than left to be worked out from the total.
  if(e.ot)out.push('Over 40 hours this week, check overtime.');
  return out.join('\n');
}
async function _tlShareText(rows,wkStart,label){
  if(!rows||!rows.length){
    typeof showToast==='function'&&showToast('No hours logged that week yet','📋');return;
  }
  const text=_tlWeekShareText(rows,wkStart);
  if(typeof pwaShare==='function')await pwaShare({title:label||'Hours',text});
  return text;
}
// The week ON SCREEN, from the same cache the bars were drawn from, so what
// gets sent is what he is looking at.
// Takes a WEEK KEY now. It used to read _tlWeekCache, which the accordion
// list populated; the drill does not build that list any more, so the week is
// resolved from the rows the page is already holding. One source, and it
// cannot go stale against what is on screen.
async function _tlShareWeekAt(wk){
  const rows=(_tlLastRows||[]).filter(r=>r&&_tlWeekKey(r.date)===wk);
  return _tlShareText(rows,wk,'Hours');
}
// The current calendar week, for the button at the bottom of the page.
async function _tlShareWeek(){
  const wkStart=new Date();wkStart.setHours(0,0,0,0);wkStart.setDate(wkStart.getDate()-wkStart.getDay());
  const wkEnd=new Date(wkStart);wkEnd.setDate(wkEnd.getDate()+6);
  const wkStartStr=dateKey(wkStart),wkEndStr=dateKey(wkEnd);
  const rows=_tlLastRows.filter(r=>r.date>=wkStartStr&&r.date<=wkEndStr);
  return _tlShareText(rows,wkStartStr,'This week\'s hours');
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
// ── The rows the screen is currently painted from ─────────────────────────
// Owner, 2026-08-31: "like almost 2 seconds to change a day, thats awful."
// _timeLogRows is expensive by nature (three Supabase queries through
// _fetchCrewLabor, plus the CoreMotion tape) and every drill tap was paying
// for it before anything on screen moved. The rows do not depend on which
// month, week or day is open, so a tap that only changes the slice paints
// from this and never awaits at all. Every path that can actually CHANGE the
// rows (a manual entry added, edited or deleted, a gap answered, a clock-out
// fixed, the repair pass, opening the page) calls renderTimeLog with no opts
// and refills this from the server exactly as before.
let _tlRowsCache=null;
let _tlRowsAt=0;
// Same shape and same reason as _TL_REPAIR_MIN_GAP_MS above (7.3): the check
// is free to the eye because it happens after the paint, but a contractor
// holding the arrow down must not fire three queries per tap.
const _TL_ROWS_REVALIDATE_MIN_GAP_MS=30000;
let _tlRevalidating=false;
// The other half of painting from memory: go and look anyway, after the
// screen is already right, and repaint ONLY if the server disagrees. This is
// what keeps a rail painted from cache from going stale when the tracker
// writes a row from the truck or another device syncs one in. Fingerprint and
// generation guards are the ones _tlRepairAfterPaint already uses, for the
// same two reasons: an unchanged answer must not close what the viewer opened,
// and a newer paint always owns the screen.
async function _tlRevalidateRows(paintedRows,gen){
  if(_tlRevalidating)return false;
  if(_tlRowsAt&&Date.now()-_tlRowsAt<_TL_ROWS_REVALIDATE_MIN_GAP_MS)return false;
  _tlRevalidating=true;
  try{
    const fresh=await _timeLogRows(null);
    _tlRowsCache=fresh;_tlRowsAt=Date.now();
    if(gen!==undefined&&gen!==_tlRenderGen)return false;
    if(_tlRowsFingerprint(fresh)===_tlRowsFingerprint(paintedRows))return false;
    // noRepair: this is a revalidate, not an open.
    await renderTimeLog({noRepair:true});
    return true;
  }catch(_e){return false;}
  finally{_tlRevalidating=false;}
}
async function renderTimeLog(opts){
  const el=document.getElementById('tl-list');if(!el)return;
  const _gen=++_tlRenderGen;
  _tlStartOpenRefresh();
  const totalEl=document.getElementById('tl-total');
  const shareEl=document.getElementById('tl-share');
  const toggleEl=document.getElementById('tl-scope-toggle');
  // Only the first time. A drill tap re-enters here with the rows already
  // loaded, so clearing to a placeholder would blank a chart that is about to
  // be redrawn from memory a few milliseconds later: a flash, not a load.
  if(!_tlSkelShown)el.innerHTML=_tlBarsSkelHtml();
  let allRows;
  // cached: a drill tap. Nothing is awaited on this path, so the whole render
  // down to el.innerHTML runs in the same task as the click and the new day
  // is on screen on the very next frame instead of two seconds later.
  const _cached=!!(opts&&opts.cached&&_tlRowsCache);
  if(_cached)allRows=_tlRowsCache;
  else{
    try{allRows=await _timeLogRows(null);}
    catch(_e){el.innerHTML='<div class="empty">Couldn\'t load time entries.</div>';return;}
    _tlRowsCache=allRows;_tlRowsAt=Date.now();
  }
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
  //
  // A drill tap gets the revalidate instead: it is not a new open, so it has
  // not earned a repair pass (same rule the _tlRepairAt floor above exists
  // for), but the rows it painted from came out of memory and something on
  // the server may have moved since.
  if(_cached){try{_tlRevalidateRows(allRows,_gen);}catch(_e){}}
  else if(!(opts&&opts.noRepair)){
    try{_tlRepairAfterPaint(allRows,_gen);}catch(_e){}
  }
  // Set as soon as the rows are in hand, not at the end: the render has
  // several early returns after this point and every one of them is still a
  // completed first load as far as the placeholder is concerned.
  _tlSkelShown=true;
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

  // The arrows and the person drill both ask "whose row is this?" long after
  // this render finished, so the id they fold under is parked beside the rows
  // themselves (see _tlRowUid).
  _tlLastCid=cid;
  const isMine=_tlRowIsMine;
  const visible=scope==='team'?allRows:allRows.filter(isMine);
  // "This week" is a live indicator, not tied to the year selector, a
  // contractor running payroll cares about the current pay period regardless
  // of what year's history they happen to be scrolled to.
  const weekEl=document.getElementById('tl-week-total');
  if(weekEl){
    const wkStart=new Date();wkStart.setHours(0,0,0,0);wkStart.setDate(wkStart.getDate()-wkStart.getDay());
    const wkEnd=new Date(wkStart);wkEnd.setDate(wkEnd.getDate()+6);
    const wkStartStr=dateKey(wkStart),wkEndStr=dateKey(wkEnd);
    const wkMin=_tlPaidMin(visible.filter(r=>r.date>=wkStartStr&&r.date<=wkEndStr));
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
  const totalMin=_tlPaidMin(rows);
  if(totalEl)totalEl.textContent=fm(totalMin)+' total in '+yr;
  const byMonth={};
  rows.forEach(r=>{const mo=(r.date||'').slice(0,7)||'unknown';(byMonth[mo]||(byMonth[mo]=[])).push(r);});
  // January (oldest) → December (newest), owner call 2026-08-20. Every other
  // Books accordion (Income/Expenses) reads newest-first; this one deliberately
  // doesn't, so don't "fix" this sort to match them.
  const months=Object.keys(byMonth).sort((a,b)=>a.localeCompare(b));
  const curMo=todayKey().slice(0,7);
  const curWk=_tlWeekKey(todayKey());
  // ONE month at a time (owner 2026-08-30). The picker replaced the list of
  // twelve collapsed month accordions: two navigations for one job, and the
  // second one was the clutter. Default to the current month when the open
  // year has it, otherwise the latest month that actually has hours, never a
  // blank chart on an empty month.
  // _tlDrill.mo IS the selected month, and the only thing that is. There were
  // briefly two (_tlMonthSel and _tlDrill.mo); the arrows wrote one and the
  // render read the other, so stepping to September rendered August and the
  // arrows looked broken. Two variables for one fact is how that happens, so
  // there is one.
  const selMo=(_tlDrill.mo&&byMonth[_tlDrill.mo])?_tlDrill.mo
    :(byMonth[curMo]?curMo:months[months.length-1]);
  // STORED, not just computed: _tlDrillStep looks the current month up to find
  // its neighbours, and an un-stored default left indexOf at -1 with both
  // arrows dead on a fresh open, which is every open.
  _tlDrill.mo=selMo;
  // ── The drill: one level, one chart ────────────────────────────────────
  // Team keeps its per-person cards, because a team week genuinely is several
  // people and the cards are the only thing that separates them. Me gets the
  // drill.
  if(scope==='team'){
    const teamRows=byMonth[selMo]||[];
    // Inside one crew member: the same week and day screens Me gets, on their
    // rows. Back from the week says "All crew" because that is where it lands,
    // and _tlDrillTo drops the uid on the way to month so it really does.
    if(_tlDrill.uid){
      const pRows=teamRows.filter(r=>_tlRowUid(r)===_tlDrill.uid);
      const lv=pRows.length?_tlLevelsHtml(pRows,selMo,{
        eyebrow:(pRows.find(r=>r&&r.personName)||{}).personName||'Crew',
        backLabel:'All crew',share:false}):null;
      if(lv){
        el.innerHTML=lv.head+
          '<div class="tl-drill-body'+(_tlMonthDir?' tl-mbars-'+_tlMonthDir:'')+'">'+lv.body+'</div>';
        if(shareEl){shareEl.style.display='none';shareEl.innerHTML='';}
        return;
      }
      // Nothing of theirs in this month (arrowed to a month they did not work,
      // or the id in the drill no longer matches any row). The crew list is
      // always a truthful answer, so fall back to it rather than a blank.
      _tlDrill.uid=null;_tlDrill.level='month';
    }
    el.innerHTML=_tlDrillHeadHtml(_bkMonthLabel(selMo),fm(_tlPaidMin(teamRows)),
        selMo,'')+
      // The crew list moves too. Coming back out of one person's week is an UP
      // like any other, and arrowing between months is a sideways like any
      // other: without the class, the one screen you return to was the one
      // screen that just appeared.
      '<div class="tl-drill-body'+(_tlMonthDir?' tl-mbars-'+_tlMonthDir:'')+
        '" style="margin-top:8px">'+_tlEmpAccHtml(selMo,teamRows,cid,selfUid,selMo)+'</div>';
    if(shareEl){shareEl.style.display='none';shareEl.innerHTML='';}
    return;
  }
  // The drill's month follows the month picked above, so the two can never
  // point at different things.
  _tlDrill.mo=selMo;
  const moRows=byMonth[selMo]||[];
  const lv=_tlLevelsHtml(moRows,selMo,{});
  const head=lv?lv.head:_tlDrillHeadHtml(_bkMonthLabel(selMo),fm(_tlPaidMin(moRows)),selMo,'');
  const body=lv?lv.body:_tlMonthBarsHtml(moRows,selMo,scope);
  // The slide direction rides as a class so the animation is pure CSS and the
  // JS never touches a style property (§8.5).
  el.innerHTML=head+
    '<div class="tl-drill-body'+(_tlMonthDir?' tl-mbars-'+_tlMonthDir:'')+'">'+body+'</div>';
  // The page-level Share button is GONE. It said "this calendar week", which
  // on a screen that now carries Send this month and Send this week (the one
  // you are actually looking at) was a third Send button meaning a fourth
  // thing. _tlShareWeek stays as the function: the CSV export and any future
  // caller still use it, and it is what the two contextual buttons were built
  // out of. Only the button left.
  if(shareEl){shareEl.style.display='none';shareEl.innerHTML='';}
}
