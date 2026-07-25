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

// ── Funnel reporting ─────────────────────────────────────────────────────────
// One renderer, two audiences. 'mine' is the contractor's own coaching numbers
// and goes straight to the RPC, where row-level security keeps them to their own
// rows. 'all' is the owner's cross-account view and CANNOT come from the RPC for
// the same reason, so it goes through the lifecycle-funnel edge function, which
// checks an owner allowlist before running with the service role.

// Durations arrive in hours. A contractor thinks in minutes for a quick task and
// days for a slow one, so pick the unit that reads naturally.
function _lcDur(h){
  const n=Number(h)||0;
  if(n<=0)return '-';
  if(n<1)return Math.max(1,Math.round(n*60))+' min';
  if(n<48)return (n<10?n.toFixed(1):Math.round(n))+' hr';
  return Math.round(n/24)+' days';
}

async function _lcFetchFunnel(scope,sinceIso){
  if(typeof _supa==='undefined'||!_supa)return null;
  if(scope==='all'){
    const{data:{session}}=await _supa.auth.getSession();
    const res=await fetch(SUPA_URL+'/functions/v1/lifecycle-funnel',{
      method:'POST',
      headers:{'Content-Type':'application/json','apikey':SUPA_KEY,'Authorization':'Bearer '+(session?.access_token||SUPA_KEY)},
      body:JSON.stringify({since:sinceIso||null})
    });
    if(!res.ok)return {error:res.status===403?'not-allowed':'failed'};
    const j=await res.json();
    return {stages:j.stages||[]};
  }
  const{data,error}=await _supa.rpc('lifecycle_funnel',{p_scope:'mine',p_since:sinceIso||null});
  if(error)return {error:'failed'};
  return {stages:data||[]};
}

// mountId - element to render into. scope - 'mine' | 'all'.
async function renderLifecycleFunnel(mountId,scope){
  const el=document.getElementById(mountId);if(!el)return;
  const mine=scope!=='all';
  el.innerHTML='<div style="font-size:12px;color:var(--text3);padding:10px 2px">Loading timings…</div>';
  let r=null;
  try{r=await _lcFetchFunnel(scope);}catch(_e){r={error:'failed'};}
  if(!r||r.error){
    el.innerHTML='<div style="font-size:12px;color:var(--text3);padding:10px 2px">'+
      (r&&r.error==='not-allowed'?'Cross-account timings are restricted.':'Timings unavailable right now.')+'</div>';
    return;
  }
  const rows=(r.stages||[]).filter(s=>Number(s.samples)>0);
  if(!rows.length){
    el.innerHTML='<div style="font-size:12px;color:var(--text3);padding:10px 2px;line-height:1.5">'+
      'No completed stages yet. These fill in as leads move through '+
      (mine?'your':'the')+' pipeline, so expect real numbers after a few weeks.</div>';
    return;
  }
  el.innerHTML=
    '<div style="display:flex;justify-content:space-between;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);padding:0 2px 6px">'+
      '<span>Stage</span><span>Typical · average · n</span></div>'+
    rows.map(s=>
      '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;padding:8px 2px;border-bottom:1px solid var(--border)">'+
        '<span style="font-size:13px;font-weight:700;color:var(--text);min-width:0">'+escHtml(s.stage)+'</span>'+
        '<span style="font-size:12px;white-space:nowrap">'+
          '<b style="font-size:13px">'+_lcDur(s.median_hours)+'</b>'+
          '<span style="color:var(--text3)"> · '+_lcDur(s.avg_hours)+' · '+s.samples+'</span>'+
        '</span>'+
      '</div>'
    ).join('')+
    // Median is listed first and bolded on purpose: one lead that sat for months
    // drags the average badly, and the typical case is the useful number.
    '<div style="font-size:10px;color:var(--text3);padding:8px 2px 0;line-height:1.5">'+
      'Typical = median (half are faster). Average is shown alongside because a single stalled lead skews it. n = completed stages measured.</div>';
}
