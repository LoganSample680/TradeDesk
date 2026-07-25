// ── Lifecycle event capture ──────────────────────────────────────────────────
// One append-only row per business milestone, so funnel timings (lead to
// proposal, sent to signed, booked to complete, complete to paid off) can be
// measured across every lead and every account.
//
// Two rules make the numbers trustworthy:
//   1. The SERVER assigns the timestamp (lifecycle_events.ts defaults to now()),
//      so a device with a wrong clock cannot skew a duration.
//   2. Once-per-entity milestones carry a dedupe key, so a retry, a second
//      device, or a double tap cannot count the same milestone twice and drag
//      an average.
//
// Crews work where there is no signal, so an emit never blocks the UI and never
// throws: it queues to localStorage and flushes on the next successful send or
// when the app comes back online. A dropped event is worse than a late one, so
// the queue survives a reload.

const LC_QUEUE_KEY='zp3_lifecycle_q';
const LC_QUEUE_MAX=500;   // bounded so a long offline stretch can't fill storage

function _lcQueue(){
  try{const raw=localStorage.getItem(LC_QUEUE_KEY);const a=raw?JSON.parse(raw):[];return Array.isArray(a)?a:[];}
  catch(_e){return [];}
}
function _lcSaveQueue(a){
  try{localStorage.setItem(LC_QUEUE_KEY,JSON.stringify(a.slice(-LC_QUEUE_MAX)));}catch(_e){}
}

// Record a milestone. Fire-and-forget: callers never await this and it never
// throws, because analytics must not be able to break a contractor's workflow.
//   event  - milestone name, e.g. 'lead_created', 'proposal_sent'
//   opts   - {clientId, bidId, jobId, once, meta}
//            once:true marks a milestone that can only happen a single time for
//            that entity, which builds the dedupe key.
function logLifecycle(event,opts){
  try{
    opts=opts||{};
    const uid=(typeof _effectiveUid==='function')?_effectiveUid():null;
    if(!uid||!event)return;
    const row={
      contractor_user_id:uid,
      event:String(event),
      client_id:opts.clientId!=null?String(opts.clientId):null,
      bid_id:opts.bidId!=null?String(opts.bidId):null,
      job_id:opts.jobId!=null?String(opts.jobId):null,
      meta:opts.meta||null,
    };
    // Once-per-entity milestones dedupe on the entity they belong to.
    if(opts.once!==false){
      const ent=row.bid_id||row.job_id||row.client_id||'';
      row.dedupe_key=row.event+':'+ent;
    }
    const q=_lcQueue();q.push(row);_lcSaveQueue(q);
    _flushLifecycle();
  }catch(_e){/* analytics must never break the app */}
}

let _lcFlushing=false;
async function _flushLifecycle(){
  if(_lcFlushing)return;
  if(typeof _supa==='undefined'||!_supa)return;
  if(typeof _supaUser==='undefined'||!_supaUser)return;
  const q=_lcQueue();
  if(!q.length)return;
  _lcFlushing=true;
  try{
    // Clear first so a slow flush can't double-send; on failure the batch is put
    // back at the FRONT so ordering is preserved for anything queued meanwhile.
    _lcSaveQueue([]);
    const batch=q.slice(0,200);
    const rest=q.slice(200);
    if(rest.length)_lcSaveQueue(rest);
    // Duplicate milestones are expected (a retry, a second device); the unique
    // dedupe index rejects them, which is the point, so that is not an error.
    const{error}=await _supa.from('lifecycle_events').insert(batch);
    if(error&&!/duplicate key|unique constraint/i.test(error.message||'')){
      const back=_lcQueue();_lcSaveQueue(batch.concat(back));
    }
  }catch(_e){
    // Network died mid-flush: the rows are already back in the queue for later.
  }finally{
    _lcFlushing=false;
  }
}

// Flush whatever is queued once a connection returns.
if(typeof window!=='undefined'){
  window.addEventListener('online',()=>{try{_flushLifecycle();}catch(_e){}});
}

// ── Drafting duration ────────────────────────────────────────────────────────
// "How long does it take to write a proposal" needs a start, and saving is the
// only moment currently recorded. _lcProposalStarted marks the builder opening;
// the saved event carries the elapsed seconds so the duration survives even if
// the two events land out of order.
let _lcDraftStartedAt=null;
function lcProposalStarted(clientId){
  _lcDraftStartedAt=Date.now();
  logLifecycle('proposal_started',{clientId,once:false});
}
function lcProposalSaved(bidId,clientId){
  const secs=_lcDraftStartedAt?Math.round((Date.now()-_lcDraftStartedAt)/1000):null;
  _lcDraftStartedAt=null;
  logLifecycle('proposal_saved',{bidId,clientId,meta:secs!=null?{draft_seconds:secs}:null});
}

// ── Funnel reporting + TradeDesk benchmarks ──────────────────────────────────
// One card, two numbers per row: what THIS contractor's pipeline actually does,
// and what the same stage looks like across every TradeDesk account.
//
// The two halves come from deliberately different places, and that split is the
// privacy design, not an accident:
//
//   Their own numbers  → lifecycle_funnel RPC, SECURITY INVOKER. Row-level
//                        security means the query can only ever see their rows,
//                        no matter what the client asks for.
//   The TradeDesk-wide → analytics_metrics_daily, written nightly by the
//   numbers              rollup-analytics worker running as the service role.
//                        The app never runs a cross-account query at all, so
//                        there is no endpoint to abuse and no owner allowlist to
//                        keep in sync. A contractor can read only rows the
//                        rollup marked publishable, and only once at least five
//                        separate businesses stand behind the number (enforced
//                        in the RLS policy, migration 20260807).

// Two figures on the SAME row must share a unit, or the row stops being a
// comparison: "33 hr" beside "2 days" makes a contractor do arithmetic to find
// out who is faster. Pick one unit from the larger of the pair and render both
// in it. The unit is chosen from the bigger number so the smaller one never has
// to round to zero.
function _lcUnitFor(){
  const vals=[].slice.call(arguments).map(Number).filter(n=>isFinite(n)&&n>0);
  if(!vals.length)return 'hr';
  const max=Math.max.apply(null,vals);
  return max<1?'min':max<48?'hr':'day';
}
function _lcDurIn(h,unit){
  const n=Number(h)||0;
  if(n<=0)return '-';
  if(unit==='min')return Math.max(1,Math.round(n*60))+' min';
  if(unit==='day'){const d=n/24;return (d<10?Math.round(d*10)/10:Math.round(d))+' days';}
  return (n<10?Math.round(n*10)/10:Math.round(n))+' hr';
}

// Pipeline order. The RPC returns stages alphabetically, which reads as noise;
// a contractor wants to follow the money from lead to paid off. Keyed on the
// event pair, never the label, so re-wording a stage cannot reorder the card or
// pair a row with the wrong benchmark.
const LC_STAGE_ORDER=[
  'lead_created>proposal_saved',
  'proposal_started>proposal_saved',
  'proposal_saved>proposal_sent',
  'proposal_sent>proposal_opened',
  'proposal_opened>signed',
  'proposal_sent>signed',
  'signed>job_scheduled',
  'job_scheduled>job_completed',
  'job_completed>balance_settled',
];
// Said the way a contractor would say it, not the way the database stores it.
const LC_STAGE_LABEL={
  'lead_created>proposal_saved':'Lead comes in, proposal written',
  'proposal_started>proposal_saved':'Time spent writing one proposal',
  'proposal_saved>proposal_sent':'Proposal written, sent out',
  'proposal_sent>proposal_opened':'Sent, client opens it',
  'proposal_opened>signed':'Client opens it, signs',
  'proposal_sent>signed':'Sent, signed',
  'signed>job_scheduled':'Signed, job on the calendar',
  'job_scheduled>job_completed':'Job booked, job finished',
  'job_completed>balance_settled':'Job finished, paid in full',
};
function _lcStageKey(r){return String(r.from_event||'')+'>'+String(r.to_event||'');}

// Sample size in English. "n = 12" means nothing to someone running a crew.
function _lcSample(n){
  n=Number(n)||0;
  return n===1?'1 so far':n+' so far';
}

async function _lcFetchMine(sinceIso){
  if(typeof _supa==='undefined'||!_supa)return null;
  const{data,error}=await _supa.rpc('lifecycle_funnel',{p_scope:'mine',p_since:sinceIso||null});
  if(error)return null;
  return data||[];
}

// The published benchmark rows, newest day available. Thin buckets never arrive
// here: the RLS policy filters them out server-side, so an empty result means
// "not enough businesses yet," which the card says out loud rather than showing
// a hole.
async function _lcFetchBench(){
  if(typeof _supa==='undefined'||!_supa)return {stage:{},source:{},trade:{}};
  const out={stage:{},source:{},trade:{}};
  try{
    const{data,error}=await _supa.from('analytics_metrics_daily')
      .select('metric,scope,n,median,avg,value,day')
      .order('day',{ascending:false}).limit(400);
    if(error||!data)return out;
    // Newest day wins: the same metric+scope is rewritten every night, and rows
    // arrive newest-first, so the first one seen is the current one.
    data.forEach(r=>{
      const scope=String(r.scope||'');
      const bucket=r.metric==='bench_stage_hours'?out.stage
        :r.metric==='bench_close_rate_source'?out.source
        :r.metric==='bench_close_rate_trade'?out.trade:null;
      if(!bucket)return;
      const key=scope.replace(/^(stage|source|trade):/,'');
      if(!(key in bucket))bucket[key]=r;
    });
  }catch(_e){}
  return out;
}

// Close rate per lead source, computed from the same arrays the dashboard's Lead
// sources card uses, so the two can never disagree. Won over TOTAL leads from
// that source, not won over decided: counting only decided leads ignores the
// ones still sitting there and flatters the rate.
function _lcCloseRateBySource(){
  if(typeof clients==='undefined'||!Array.isArray(clients))return [];
  const by={};
  clients.forEach(c=>{
    const src=(c.source||'').trim();
    if(!src)return;
    if(!by[src])by[src]={leads:0,won:0};
    by[src].leads++;
    const cb=(typeof getClientBids==='function')?getClientBids(c.id):[];
    if(cb.some(b=>b.status==='Closed Won'))by[src].won++;
  });
  return Object.entries(by)
    .map(([src,d])=>({src,leads:d.leads,won:d.won,rate:d.leads?d.won/d.leads*100:0}))
    .sort((a,b)=>b.leads-a.leads);
}

// The trade the contractor already picked. There is exactly one source for this
// in the app: account_config.business_type, written by the onboarding trade step
// and by the Settings trade picker, and held in memory as _config.business_type.
// Multi-trade accounts also carry _config.trade_lines, but business_type is
// already the PRIMARY of that list (settings.js sets it from tradeLines[0]), so
// the primary trade is what a benchmark should group on. Nothing new to fill in.
function _lcMyTrade(){
  try{
    const t=(typeof _config!=='undefined'&&_config&&_config.business_type)||'';
    return String(t).trim().toLowerCase();
  }catch(_e){return '';}
}
// Display name for a trade id, from the same map the estimate pages use, so the
// benchmark row says "Painting" exactly like every other trade label in the app.
function _lcTradeLabel(id){
  const meta=(typeof TRADE_META!=='undefined'&&TRADE_META)?TRADE_META[id]:null;
  return meta?meta.label:(id?id.charAt(0).toUpperCase()+id.slice(1):'');
}

//
// ── How this reads, and why it is shaped this way ────────────────────────────
// Research (Jul 2026) on how the field presents this:
//   - ServiceTitan has the deepest reporting in the category and its OWN guidance
//     tells customers "you don't need a million KPIs, just pick the ones that are
//     important for you." Overwhelming reporting is one of its standing
//     complaints. Depth is not the win.
//   - Roundups comparing Jobber and Housecall Pro land on the same point: a report
//     nobody checks is decoration, and simpler reporting is the smarter choice
//     because it actually gets used. Jobber's edge is that it feels straightforward.
//   - Peer benchmarking is a real want (ProTradeHQ, Suparev, and Applause all sell
//     benchmark reports separately), but nobody puts it inside the CRM where the
//     data already lives. That is the gap this card takes.
// So the card leads with ONE number, on the same gauge a contractor already reads
// when pricing a job, shows position instead of arithmetic, and puts the long
// tail behind a tap rather than on screen by default.

// Where a value sits relative to the average, as -1..1. Clamped, because one lead
// that sat for six months would otherwise push the marker off the rail and make
// every other row unreadable.
function _lcOffset(mine,bench,lowerIsBetter){
  if(!isFinite(mine)||!isFinite(bench)||bench<=0||mine<=0)return null;
  const rel=Math.max(-1,Math.min(1,(mine-bench)/bench));
  return lowerIsBetter?-rel:rel;   // positive is always "you are doing better"
}

// ── The gauge, borrowed from the proposal builder ────────────────────────────
// Same instrument as the profit gauge on an estimate: a hard-stop colour track, a
// white dot ringed in the colour of the band it landed on, and a big number under
// it. Contractors already read that control every time they price a job, so there
// is nothing new to learn here.
//
// One thing is deliberately different. The profit gauge measures against fixed
// break points (22/35/55%), because a margin is good or bad on its own. A
// benchmark has no fixed good, only "compared to everyone else", so this track is
// DIVERGING: the centre is the TradeDesk average, worse runs left, better runs
// right. Same instrument, honest about what it measures.
//
// Palette is the app's status set, validated rather than eyeballed: #EF4444 /
// #F59E0B / #1f9d57 clears the CVD separation floor in light mode (worst adjacent
// pair deltaE 9.5). The dot's POSITION and the words beside it still carry the
// whole meaning on their own, so the rail reads correctly with no colour at all.
const LC_RED='#EF4444',LC_AMBER='#F59E0B',LC_GREEN='#1f9d57',LC_NEUTRAL='#94A3B8';

// Hard stops, no blend zone, so the dot always sits on a band whose colour
// matches its own ring. Offsets -1..1 map across 0..100%:
//   worse than -25% red | -25 to -5% amber | within 5% neutral | better green
function _lcTrackCss(stops){
  return 'linear-gradient(to right,'+
    stops.red+' 0%,'+stops.red+' 37.5%,'+
    stops.amber+' 37.5%,'+stops.amber+' 47.5%,'+
    stops.neutral+' 47.5%,'+stops.neutral+' 52.5%,'+
    stops.green+' 52.5%,'+stops.green+' 100%)';
}
// The headline gauge is fully saturated because it is the one thing on the card
// meant to catch the eye. A dozen row rails at that strength would compete with
// it and turn the list into stripes, so the small track is a wash of the same
// bands and the saturated dot is the only loud mark on the row. Same instrument,
// correct hierarchy.
const LC_TRACK=_lcTrackCss({red:LC_RED,amber:LC_AMBER,neutral:LC_NEUTRAL,green:LC_GREEN});
const LC_TRACK_SOFT=_lcTrackCss({
  red:'rgba(239,68,68,.22)',amber:'rgba(245,158,11,.28)',
  neutral:'rgba(148,163,184,.34)',green:'rgba(31,157,87,.22)'});

function _lcBandColor(offset){
  if(offset==null)return LC_NEUTRAL;
  if(offset<-0.25)return LC_RED;
  if(offset<-0.05)return LC_AMBER;
  if(offset<=0.05)return LC_NEUTRAL;
  return LC_GREEN;
}
// 46 rather than 50 so a clamped marker still sits fully on the rail.
function _lcDotPct(offset){return offset==null?50:50+offset*46;}

// The instrument. size 'lg' is the headline gauge, 'sm' the row rail.
function _lcGauge(offset,size){
  const lg=size==='lg';
  const h=lg?7:6, dot=lg?18:13, ring=lg?3:2.5;
  const color=_lcBandColor(offset);
  if(offset==null){
    return '<div style="position:relative;height:'+h+'px;border-radius:5px;background:var(--border);'+
      (lg?'margin:16px 10px 20px':'')+'"></div>';
  }
  return '<div style="position:relative;height:'+h+'px;border-radius:5px;background:'+(lg?LC_TRACK:LC_TRACK_SOFT)+';'+
    (lg?'margin:16px 10px 20px':'')+'">'+
    // The average is the reference the whole rail is built around, so it gets its
    // own mark rather than being implied by the middle of a gradient.
    '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:2px;height:'+(h+6)+'px;border-radius:1px;background:'+(lg?'rgba(255,255,255,.85)':'var(--text3)')+';opacity:'+(lg?1:.55)+'"></div>'+
    '<div style="position:absolute;top:50%;transform:translate(-50%,-50%);width:'+dot+'px;height:'+dot+'px;border-radius:50%;background:#fff;'+
      'box-shadow:0 0 0 '+ring+'px '+color+',0 2px 8px rgba(0,0,0,.25);left:'+_lcDotPct(offset).toFixed(1)+'%;'+
      'transition:left .55s cubic-bezier(.22,1,.36,1),box-shadow .4s ease"></div>'+
  '</div>';
}

// The headline: big gauge, big number, laid out the way the profit gauge reads.
function _lcHeroGauge(pctStr,label,offset,benchStr,subStr){
  const color=_lcBandColor(offset);
  return '<div style="padding:2px 0 4px">'+
    _lcGauge(offset,'lg')+
    '<div style="text-align:center;padding-bottom:10px">'+
      '<div style="font-size:30px;font-weight:900;line-height:1.1;color:'+(offset==null?'var(--text)':color)+';transition:color .4s ease">'+escHtml(pctStr)+'</div>'+
      '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text3);margin:2px 0">'+escHtml(label)+'</div>'+
      (benchStr?'<div style="font-size:15px;font-weight:700;color:var(--text2);margin:0 0 5px">'+escHtml(benchStr)+'</div>':'')+
      '<div style="font-size:11.5px;color:var(--text3);min-height:16px">'+escHtml(subStr||'')+'</div>'+
    '</div>'+
  '</div>';
}

// One comparison row: label + your number, then the small gauge with the verdict
// and the sample count beside it.
function _lcRow(label,mineStr,offset,verdictText,sampleStr){
  const meta=[verdictText,sampleStr].filter(Boolean).join('  ·  ');
  return '<div style="padding:11px 2px;border-bottom:1px solid var(--border)">'+
    '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px">'+
      '<span style="font-size:13px;font-weight:700;color:var(--text);min-width:0">'+escHtml(label)+'</span>'+
      '<span style="font-size:15px;font-weight:800;color:var(--text);white-space:nowrap">'+escHtml(mineStr)+'</span>'+
    '</div>'+
    '<div style="display:flex;align-items:center;gap:10px;margin-top:9px">'+
      '<div style="flex:1;min-width:64px">'+_lcGauge(offset,'sm')+'</div>'+
      // Verdict AND sample, always. "33% worse" from three leads is not a fact
      // about the business, and hiding the count would let it read like one.
      '<span style="font-size:11px;color:var(--text3);white-space:nowrap">'+
        escHtml(offset==null?('No TradeDesk average yet'+(sampleStr?'  ·  '+sampleStr:'')):meta)+'</span>'+
    '</div>'+
  '</div>';
}

// Plain words for the marker's position. The word carries the meaning so the
// colour never has to.
function _lcVerdict(offset,lowerIsBetter){
  if(offset==null)return '';
  const pct=Math.round(Math.abs(offset)*100);
  if(pct<5)return 'about average';
  const better=offset>0;
  const fastSlow=lowerIsBetter?(better?'faster':'slower'):(better?'better':'worse');
  // No "than average" tail: the rail's centre tick already IS the average, and on
  // a 390px screen the tail crowds out the sample count, which matters more.
  return pct+'% '+fastSlow;
}

// A collapsible block, using the app-wide accordion animation constant so this
// opens exactly like every other accordion in the product.
function _lcSection(key,title,sub,inner,open){
  const chev='<span style="flex-shrink:0;display:inline-flex;color:var(--text3);transform:rotate('+(open?180:0)+'deg);transition:transform .15s"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span>';
  return '<div style="margin-top:14px">'+
    '<div onclick="_lcTogSection(\''+key+'\')" style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:8px 2px">'+
      '<div style="flex:1;min-width:0">'+
        '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--text3)">'+escHtml(title)+'</div>'+
        (sub?'<div style="font-size:11px;color:var(--text3);margin-top:3px;line-height:1.45">'+escHtml(sub)+'</div>':'')+
      '</div>'+chev+
    '</div>'+
    (open?'<div class="td-acc-body td-acc-in"><div class="td-acc-inner">'+inner+'</div></div>':'')+
  '</div>';
}
function _lcTogSection(key){
  window['_lcSecOpen_'+key]=!window['_lcSecOpen_'+key];
  if(typeof renderLifecycleFunnel==='function')renderLifecycleFunnel('lc-funnel-mine');
}

// The one thing to fix, named. A contractor should be able to read the gauge,
// read this, and stop.
function _lcGapCallout(worst,beat,total){
  if(!total)return '';
  if(!worst){
    return '<div style="margin-top:2px;padding:9px 11px;background:rgba(31,157,87,.08);border-left:3px solid '+LC_GREEN+';border-radius:8px">'+
      '<div style="font-size:13px;color:var(--text);line-height:1.4">You beat the TradeDesk average on all '+total+' steps.</div></div>';
  }
  return '<div style="margin-top:2px;padding:9px 11px;background:rgba(180,83,9,.08);border-left:3px solid '+LC_AMBER+';border-radius:8px">'+
    '<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:#B45309">Biggest gap</div>'+
    '<div style="font-size:13px;color:var(--text);margin-top:3px;line-height:1.4">'+escHtml(worst.label)+'</div>'+
    '<div style="font-size:11px;color:var(--text3);margin-top:2px">'+escHtml(worst.verdict)+'  ·  you beat the average on '+beat+' of '+total+' steps</div>'+
  '</div>';
}

// mountId - element to render into.
async function renderLifecycleFunnel(mountId){
  const el=document.getElementById(mountId);if(!el)return;
  if(!el.innerHTML)el.innerHTML='<div style="font-size:12px;color:var(--text3);padding:10px 2px">Loading your numbers…</div>';
  let mine=null,bench={stage:{},source:{},trade:{}};
  try{
    const r=await Promise.all([_lcFetchMine(),_lcFetchBench()]);
    mine=r[0];bench=r[1]||bench;
  }catch(_e){}
  if(!mine){
    el.innerHTML='<div style="font-size:12px;color:var(--text3);padding:10px 2px">Your timings are unavailable right now.</div>';
    return;
  }

  const byKey={};
  mine.forEach(r=>{byKey[_lcStageKey(r)]=r;});
  const stageRows=LC_STAGE_ORDER
    .map(k=>({key:k,row:byKey[k],b:bench.stage[k]}))
    .filter(x=>x.row&&Number(x.row.samples)>0);

  const srcRows=_lcCloseRateBySource();
  const trade=_lcMyTrade();
  const tradeBench=trade?bench.trade[trade]:null;
  const myLeads=(typeof clients!=='undefined'&&Array.isArray(clients))?clients.length:0;
  const myWon=(typeof clients!=='undefined'&&Array.isArray(clients)&&typeof getClientBids==='function')
    ?clients.filter(c=>getClientBids(c.id).some(b=>b.status==='Closed Won')).length:0;
  const myRate=myLeads?myWon/myLeads*100:null;

  if(!stageRows.length&&!srcRows.length){
    el.innerHTML='<div style="font-size:12px;color:var(--text3);padding:10px 2px;line-height:1.5">'+
      'Nothing to measure yet. These fill in on their own as leads move through your pipeline, '+
      'so expect real numbers after a few weeks of normal work.</div>';
    return;
  }

  // Score every comparison once, so the hero and the rows agree by construction
  // rather than by two separate calculations that could drift.
  const scored=stageRows.map(x=>{
    const mineH=Number(x.row.median_hours)||0;
    const benchH=x.b?Number(x.b.median):NaN;
    const off=_lcOffset(mineH,benchH,true);
    return {...x,mineH,benchH,off,label:LC_STAGE_LABEL[x.key]||x.row.stage,verdict:_lcVerdict(off,true)};
  });
  const compared=scored.filter(x=>x.off!=null);
  const beat=compared.filter(x=>x.off>0).length;
  const worst=compared.slice().sort((a,b)=>a.off-b.off)[0];

  // The headline is close rate on the big gauge: it is the money metric, the one a
  // contractor already thinks in, and the one they would quote to another
  // contractor. Everything else on the card exists to explain it.
  let html='';
  if(myRate!==null&&myLeads>0){
    const tb=tradeBench?Number(tradeBench.value):NaN;
    const off=_lcOffset(myRate,tb,false);
    // Short enough to stay on one line at 390px: a two-line benchmark caption
    // competes with the number above it for the same glance.
    const peer=trade?_lcTradeLabel(trade):'TradeDesk';
    html+=_lcHeroGauge(
      Math.round(myRate)+'%','Close rate',off,
      isFinite(tb)?(peer+' average '+Math.round(tb)+'%'):'',
      isFinite(tb)
        ?(_lcVerdict(off,false)+'  ·  '+myWon+' of '+myLeads+' leads became work')
        :(myWon+' of '+myLeads+' leads became work  ·  no average yet'));
  }
  html+=_lcGapCallout(worst&&worst.off<-0.05?worst:null,beat,compared.length);

  if(srcRows.length){
    const rows=srcRows.map(s=>{
      const b=bench.source[s.src];
      const off=_lcOffset(s.rate,b?Number(b.value):NaN,false);
      return _lcRow(s.src,Math.round(s.rate)+'%',off,
        _lcVerdict(off,false),s.won+' of '+s.leads+' leads');
    }).join('');
    html+=_lcSection('src','Where your work comes from','Close rate per lead source.',rows,
      !!window._lcSecOpen_src);
  }

  if(stageRows.length){
    const rows=scored.map(x=>{
      const unit=_lcUnitFor(x.mineH,x.benchH);
      return _lcRow(x.label,_lcDurIn(x.mineH,unit),x.off,x.verdict,_lcSample(x.row.samples));
    }).join('');
    html+=_lcSection('speed','How long each step takes you',
      'Your typical time. Typical means half your jobs were faster, which beats an average one stalled lead can wreck.',
      rows,!!window._lcSecOpen_speed);
  }

  html+='<div style="font-size:10px;color:var(--text3);padding:12px 2px 0;line-height:1.5">'+
    'The centre tick on each rail is the TradeDesk average. Averages are anonymous and only appear once at least '+
    'five separate businesses are behind the number, so no one can read another contractor\'s figures off this page. '+
    'They refresh nightly.</div>';

  el.innerHTML=html;
}
