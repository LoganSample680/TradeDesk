// ── Background upload (owner 2026-08-11) ─────────────────────────────────────
// "Don't we already have that?" Half of it.
//
// WHAT WE HAD: a durable retry queue (_drainPhotoQueue, js/jobs.js). Nothing
// is ever lost. But it only runs while the app is awake, so closing TradeDesk
// mid-upload parks a batch of jobsite photos until the next launch.
//
// WHAT THIS ADDS: iOS finishes the transfer with the app CLOSED, and resumes
// it across a signal drop. On a 20-photo walkthrough over truck-stop signal
// that is the difference between "done before I pull away" and "still sitting
// there tomorrow".
//
// The design constraint that shapes everything: the app is usually NOT running
// when a background upload finishes, so the native side writes every result to
// a ledger on disk and this reconciles from it on the next boot. Nothing is
// marked uploaded on hope, only on a recorded result.

function _bgUpPlugin(){
  try{
    const cap=window.Capacitor;
    if(!cap||typeof cap.isNativePlatform!=='function'||!cap.isNativePlatform())return null;
    if(typeof cap.registerPlugin==='function')return cap.registerPlugin('TdBgUp');
    return (cap.Plugins&&cap.Plugins.TdBgUp)||null;
  }catch(_e){return null;}
}
function _bgUpCapable(){return !!_bgUpPlugin();}

// The id has to survive the app being killed and relaunched, so it encodes
// WHERE the photo goes rather than pointing at an in-memory object: job id,
// photo index, and the storage path the bytes are headed for.
function _bgUpId(jobId,photoIdx,storagePath){
  return 'p:'+jobId+':'+photoIdx+':'+String(storagePath||'');
}
function _bgUpParseId(id){
  const m=String(id||'').match(/^p:([^:]+):(\d+):(.*)$/);
  if(!m)return null;
  return {jobId:m[1],idx:+m[2],storagePath:m[3]};
}

// Hand one photo to iOS. JS builds the destination and the auth headers (this
// plugin knows nothing about Supabase); native owns only the transfer.
async function _bgUpSend(jobId,photoIdx,storagePath,b64,contentType,token,bucket){
  const P=_bgUpPlugin();
  if(!P||typeof P.upload!=='function')return false;
  const base=(typeof SUPA_URL!=='undefined'&&SUPA_URL)?SUPA_URL:'';
  if(!base||!token)return false;
  const url=base+'/storage/v1/object/'+(bucket||'gallery')+'/'+storagePath;
  try{
    await P.upload({
      id:_bgUpId(jobId,photoIdx,storagePath),
      url,method:'POST',b64,
      headers:{
        'Authorization':'Bearer '+token,
        'Content-Type':contentType||'image/jpeg',
        'x-upsert':'false'
      }
    });
    return true;
  }catch(_e){return false;}
}

// Fold finished transfers back into the job records. Runs on boot and on
// resume; safe to call repeatedly. Only clears a ledger entry once the photo
// it refers to has actually been marked, so a result can never be consumed
// without being applied.
async function _bgUpReconcile(){
  const P=_bgUpPlugin();
  if(!P||typeof P.results!=='function')return {applied:0};
  let list=[];
  try{const r=await P.results();list=(r&&Array.isArray(r.results))?r.results:[];}catch(_e){return {applied:0};}
  if(!list.length)return {applied:0};
  const done=[];
  let applied=0;
  const all=(typeof jobs!=='undefined'&&Array.isArray(jobs))?jobs:[];
  list.forEach(res=>{
    const ref=_bgUpParseId(res&&res.id);
    if(!ref){done.push(res.id);return;}          // unparseable: drop it, it can never apply
    const j=all.find(x=>String(x.id)===String(ref.jobId));
    if(!j||!Array.isArray(j.photos)){
      // The job is gone (deleted while the upload was in flight): the result
      // has nowhere to land, so stop carrying it.
      done.push(res.id);return;
    }
    const p=j.photos[ref.idx];
    if(!p){done.push(res.id);return;}
    if(res.ok){
      p.pendingUpload=false;
      p.storagePath=p.storagePath||ref.storagePath;
      delete p.data;                              // the bytes live in storage now
      applied++;
      done.push(res.id);
    }else{
      // A failed transfer goes back to the in-app queue, which already knows
      // how to retry. Keeping it 'pending' is what makes that happen.
      p.pendingUpload=true;
      done.push(res.id);
    }
  });
  if(applied&&typeof saveAll==='function')saveAll();
  if(done.length&&typeof P.clear==='function'){try{await P.clear({ids:done});}catch(_e){}}
  return {applied,handled:done.length};
}

// Live results while the app happens to be open: same reconcile, just sooner.
let _bgUpWired=false;
async function _bgUpWire(){
  if(_bgUpWired)return;
  const P=_bgUpPlugin();
  if(!P||typeof P.addListener!=='function')return;
  _bgUpWired=true;
  try{await P.addListener('done',()=>{_bgUpReconcile();});}catch(_e){_bgUpWired=false;}
}
