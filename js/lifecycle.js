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

// Faster/slower cue. Durations are better when lower; close rates are better
// when higher, hence the flip.
function _lcCompare(mine,bench,lowerIsBetter){
  if(!isFinite(mine)||!isFinite(bench)||bench<=0||mine<=0)return null;
  const better=lowerIsBetter?mine<bench:mine>bench;
  const pct=Math.round(Math.abs(mine-bench)/bench*100);
  if(pct<5)return {color:'var(--text3)',text:'about average'};
  return {color:better?'#1f9d57':'#B45309',text:pct+'% '+(better?'better':'worse')};
}

// One row: the contractor's own figure as the headline, the TradeDesk figure
// beside it in smaller type, and a plain-word verdict.
function _lcRow(label,mineStr,benchStr,sampleStr,cmp){
  return '<div style="padding:10px 2px;border-bottom:1px solid var(--border)">'+
    '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px">'+
      '<span style="font-size:13px;font-weight:700;color:var(--text);min-width:0">'+escHtml(label)+'</span>'+
      '<span style="font-size:15px;font-weight:800;color:var(--text);white-space:nowrap">'+escHtml(mineStr)+'</span>'+
    '</div>'+
    '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-top:3px">'+
      '<span style="font-size:11px;color:var(--text3)">'+escHtml(sampleStr)+'</span>'+
      '<span style="font-size:11px;white-space:nowrap">'+
        (benchStr
          ?'<span style="color:var(--text3)">TradeDesk '+escHtml(benchStr)+'</span>'+
           (cmp?'<span style="color:'+cmp.color+';font-weight:700"> · '+cmp.text+'</span>':'')
          :'<span style="color:var(--text3)">no TradeDesk average yet</span>')+
      '</span>'+
    '</div>'+
  '</div>';
}

function _lcSectionHd(title,sub){
  return '<div style="padding:14px 2px 6px">'+
    '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--text3)">'+escHtml(title)+'</div>'+
    (sub?'<div style="font-size:11px;color:var(--text3);margin-top:3px;line-height:1.45">'+escHtml(sub)+'</div>':'')+
  '</div>';
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

// mountId - element to render into.
async function renderLifecycleFunnel(mountId){
  const el=document.getElementById(mountId);if(!el)return;
  el.innerHTML='<div style="font-size:12px;color:var(--text3);padding:10px 2px">Loading your numbers…</div>';
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

  let html='';

  if(stageRows.length){
    html+=_lcSectionHd('How long each step takes you',
      'Your typical time is the headline. Typical means half your jobs were faster, which beats an average that one stalled lead can wreck.');
    html+=stageRows.map(x=>{
      const label=LC_STAGE_LABEL[x.key]||x.row.stage;
      const mineH=Number(x.row.median_hours)||0;
      const benchH=x.b?Number(x.b.median):NaN;
      const unit=_lcUnitFor(mineH,benchH);
      return _lcRow(label,_lcDurIn(mineH,unit),isFinite(benchH)&&benchH>0?_lcDurIn(benchH,unit):'',
        _lcSample(x.row.samples),_lcCompare(mineH,benchH,true));
    }).join('');
  }

  if(myRate!==null&&myLeads>0){
    html+=_lcSectionHd('Close rate','Leads that turned into signed work.');
    const tb=tradeBench?Number(tradeBench.value):NaN;
    html+=_lcRow(trade?('Your business vs other '+_lcTradeLabel(trade)+' businesses'):'Your business',
      Math.round(myRate)+'%',isFinite(tb)?Math.round(tb)+'%':'',
      myWon+' of '+myLeads+' leads',_lcCompare(myRate,tb,false));
  }

  if(srcRows.length){
    html+=_lcSectionHd('Close rate by lead source','Where your work actually comes from, against how that source performs platform-wide.');
    html+=srcRows.map(s=>{
      const b=bench.source[s.src];
      const bv=b?Number(b.value):NaN;
      return _lcRow(s.src,Math.round(s.rate)+'%',isFinite(bv)?Math.round(bv)+'%':'',
        s.won+' of '+s.leads+' leads',_lcCompare(s.rate,bv,false));
    }).join('');
  }

  html+='<div style="font-size:10px;color:var(--text3);padding:10px 2px 0;line-height:1.5">'+
    'TradeDesk averages are anonymous and only shown once at least five separate businesses are behind the number, '+
    'so no one can read another contractor\'s figures off this page. They refresh nightly.</div>';

  el.innerHTML=html;
}
