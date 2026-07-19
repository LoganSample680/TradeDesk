// ── IRS Schedule C expense categories ────────────────────────────────
let _expState={imageData:null,imageKey:null,editId:null,imagePages:[]};
Object.defineProperty(window,'_expState',{get:()=>_expState,set:v=>{_expState=v;},configurable:true});

function openExpenseFlow(){
  if(document.getElementById('expense-modal'))return;
  const ov=document.createElement('div');
  ov.id='expense-modal';
  ov.style.cssText='position:fixed;inset:0;z-index:9990;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;animation:fadein .15s;padding:16px';
  const mktSrcs=[...new Set(clients.map(c=>c.source).filter(Boolean))].sort();
  const mktSrcOpts=mktSrcs.filter(s=>s!=='Online leads').map(s=>'<option value="'+escHtml(s)+'">'+escHtml(s)+'</option>').join('')+
    '<option value="Online leads">Online leads</option>'+
    '<option value="Other">Other</option>';
  const catOpts=IRS_EXPENSE_CATS.map(c=>'<option value="'+c.id+'">'+c.icon+' '+c.label+'</option>').join('');
  const jobOpts='<option value="">- Not tied to a specific job -</option>'+
    bids.filter(b=>b.status==='Closed Won').map(b=>'<option value="'+b.id+'">'+escHtml(b.client_name||b.name)+(b.addr?' · '+escHtml((b.addr||'').split(',')[0]):'')+'</option>').join('');
  const today=new Date().toISOString().slice(0,10);
  ov.innerHTML=
    '<div style="background:var(--bg);border-radius:20px;width:100%;max-width:600px;max-height:92vh;overflow-y:auto;padding:20px 20px 28px">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">'+
        '<div style="font-size:18px;font-weight:800">Log expense</div>'+
        '<button onclick="closeExpenseFlow()" style="border:none;background:none;font-size:24px;cursor:pointer;color:var(--text3)">×</button>'+
      '</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">'+
        '<button id="exp-scan-area" style="border:1.5px solid var(--blue);border-radius:12px;padding:12px 8px;cursor:pointer;background:rgba(45,93,168,.06);font-family:inherit;display:flex;align-items:center;justify-content:center;gap:8px" onclick="expTriggerScan()">'+
          '<span style="font-size:22px">'+svgIcon('📷',{size:22})+'</span>'+
          '<div style="text-align:left"><div style="font-size:13px;font-weight:700;color:var(--blue)">Scan receipt</div><div style="font-size:10px;color:var(--text3)">AI fills fields</div></div>'+
        '</button>'+
        '<button id="exp-attach-area" style="border:1.5px solid var(--border2);border-radius:12px;padding:12px 8px;cursor:pointer;background:var(--bg2);font-family:inherit;display:flex;align-items:center;justify-content:center;gap:8px" onclick="expTriggerAttach()">'+
          '<span style="font-size:22px">'+svgIcon('📎',{size:22})+'</span>'+
          '<div style="text-align:left"><div style="font-size:13px;font-weight:700">Attach photo</div><div style="font-size:10px;color:var(--text3)">No sign-in needed</div></div>'+
        '</button>'+
      '</div>'+
      '<div id="exp-scan-status" style="display:none;margin-bottom:10px"></div>'+
      '<div id="exp-preview-img" style="display:none;margin-bottom:12px;text-align:center"></div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">'+
        '<div class="f"><label>Vendor / Store *</label><input id="em-vendor" placeholder="Home Depot..." style="font-size:14px"></div>'+
        '<div class="f"><label>Amount * ($)</label><input id="em-amount" type="number" step="0.01" placeholder="0.00" style="font-size:14px"></div>'+
      '</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">'+
        '<div class="f"><label>Date *</label><input id="em-date" type="text" placeholder="MM/DD/YYYY" value="'+today.replace(/(\d{4})-(\d{2})-(\d{2})/,'$2/$3/$1')+'" style="font-size:14px" oninput="_fmtExpDate(this)"></div>'+
        '<div class="f"><label>Category *</label><select id="em-cat" style="font-size:13px" onchange="toggleExpenseSections()">'+catOpts+'</select></div>'+
      '</div>'+
      '<div id="em-vehicle-section" style="display:none;margin-bottom:12px">'+
        '<div class="f"><label>Which vehicle? <span style="font-weight:400;font-size:10px;color:var(--text3)">(sets the mileage-vs-actual tax treatment)</span></label>'+
          '<select id="em-vehicle" style="font-size:13px">'+
            (typeof getVehicles==='function'?getVehicles():[]).map(v=>'<option value="'+escHtml(v.name)+'">'+escHtml(v.nickname||v.name)+'</option>').join('')+
          '</select>'+
        '</div>'+
      '</div>'+
      '<div id="em-marketing-section" style="display:none;margin-bottom:12px">'+
        '<div style="background:rgba(45,93,168,.07);border:1.5px solid rgba(45,93,168,.22);border-radius:var(--r);padding:12px">'+
          '<div style="font-size:11px;font-weight:800;color:var(--blue);margin-bottom:8px;text-transform:uppercase;letter-spacing:.04em">'+svgIcon('📢')+' Marketing channel</div>'+
          '<div class="f"><label>Which lead source did you spend on? <span style="color:#A32D2D">*</span></label>'+
            '<select id="em-mkt-source" style="font-size:13px">'+
              '<option value="">- Select source -</option>'+mktSrcOpts+
            '</select>'+
          '</div>'+
        '</div>'+
      '</div>'+
      '<div id="em-meal-section" style="display:none;background:#FFF8F0;border:1.5px solid #F59E0B;border-radius:var(--r);padding:12px;margin-bottom:12px">'+
        '<div style="font-size:11px;font-weight:700;color:#92400E;margin-bottom:8px;text-transform:uppercase;letter-spacing:.04em">'+svgIcon('🍽')+' Meal: Business purpose required</div>'+
        '<div class="f" style="margin-bottom:8px"><label>Business purpose <span style="color:#A32D2D">*</span></label><input id="em-meal-purpose" placeholder="e.g. Client meeting, reviewed Bettis job scope" style="font-size:13px"></div>'+
        '<div class="f"><label>Who attended</label><input id="em-meal-attendees" placeholder="e.g. Zach + client John Smith" style="font-size:13px"></div>'+
      '</div>'+
      '<div style="margin-bottom:12px">'+
        '<label style="display:block;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--text3);margin-bottom:6px">Link to a job? <span style="font-weight:400;font-size:10px">(optional)</span></label>'+
        '<select id="em-job" style="font-size:13px;width:100%;padding:10px 12px;border:1.5px solid var(--border2);border-radius:var(--r);background:var(--bg);color:var(--text);font-family:inherit">'+jobOpts+'</select>'+
      '</div>'+
      '<div class="f" style="margin-bottom:14px"><label>Notes (optional)</label><textarea id="em-notes" placeholder="What was this for?" style="min-height:44px;font-size:13px"></textarea></div>'+
      '<button class="btn btn-p btn-full btn-xl" onclick="expSave()" id="exp-save-btn">Save expense</button>'+
      '<div id="exp-save-err" style="color:#A32D2D;font-size:12px;text-align:center;margin-top:8px;min-height:16px"></div>'+
    '</div>';
  document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)closeExpenseFlow();});
  _expState={imageData:null,imageKey:null,hasReceipt:false,editId:null,imagePages:[]};
}

function closeExpenseFlow(){document.getElementById('expense-modal')?.remove();_expState={imageData:null,imageKey:null,hasReceipt:false,editId:null,imagePages:[]};}

function _renderExpPages(){
  const preview=document.getElementById('exp-preview-img');if(!preview)return;
  const pages=_expState.imagePages;
  if(!pages.length){preview.style.display='none';return;}
  preview.style.display='block';
  preview.innerHTML=
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px">'+
    pages.map((p,i)=>
      '<div style="position:relative;text-align:center">'+
        '<img src="data:image/jpeg;base64,'+p.b64+'" style="width:68px;height:68px;object-fit:cover;border-radius:8px;border:2px solid var(--green);display:block">'+
        '<button type="button" onclick="_removeExpPage('+i+')" style="position:absolute;top:-7px;right:-7px;width:20px;height:20px;border-radius:50%;border:none;background:#A32D2D;color:#fff;font-size:12px;cursor:pointer;line-height:1;padding:0;font-family:inherit">×</button>'+
        '<div style="font-size:9px;color:var(--text3);margin-top:3px;font-weight:700">Page '+(i+1)+'</div>'+
      '</div>'
    ).join('')+
    '<div style="display:flex;align-items:center">'+
      '<button type="button" onclick="expTriggerAttach(true)" style="width:68px;height:68px;border-radius:8px;border:2px dashed var(--blue);background:var(--blue-lt);color:var(--blue-dk);font-size:22px;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center">+</button>'+
    '</div>'+
    '</div>'+
    '<div style="font-size:11px;color:var(--green-mid);font-weight:700">'+pages.length+' page'+(pages.length>1?'s':'')+' captured</div>';
}
function _removeExpPage(idx){
  _expState.imagePages.splice(idx,1);
  _expState.hasReceipt=_expState.imagePages.length>0;
  _renderExpPages();
}

function expTriggerAttach(addPage){
  _showReceiptScanner(null,async blob=>{
    const attachArea=document.getElementById('exp-attach-area');
    if(attachArea)attachArea.style.opacity='.5';
    try{
      const b64=await compressAndEncodeImage(blob,900,0.75);
      const pageObj={b64,key:null};
      _expState.imagePages.push(pageObj);
      _expState.imageData={b64,type:'image/jpeg'};_expState.hasReceipt=true;
      _uploadReceiptToStorage(Date.now(),b64).then(k=>{if(k)pageObj.key=k;}).catch(()=>{});
      _renderExpPages();
      if(attachArea){attachArea.style.opacity='1';attachArea.style.borderColor='var(--green-mid)';}
    }catch(e){if(attachArea)attachArea.style.opacity='1';}
  });
}
function expAttachPhotoOnly(input){expTriggerAttach();}  // legacy: redirect to live scanner

function expTriggerScan(){
  const tokenP=(async()=>{if(!_supa)return null;const{data}=await _supa.auth.getSession();let t=data?.session?.access_token||null;if(!t){const{data:r}=await _supa.auth.refreshSession();t=r?.session?.access_token||null;}return t;})();
  _showReceiptScanner(null,async blob=>{
    const status=document.getElementById('exp-scan-status');
    const scanArea=document.getElementById('exp-scan-area');
    const token=await tokenP;
    if(!token){if(status){status.style.display='block';status.innerHTML='<div class="tip tip-w">Sign in to use receipt scanning. <button class="btn btn-sm btn-p" onclick="supaShowLogin()" style="margin-left:8px">Sign in</button></div>';}return;}
    if(status){status.style.display='block';status.innerHTML='<div class="tip"><strong>'+svgIcon('📡')+' Reading receipt...</strong></div>';}
    if(scanArea)scanArea.style.opacity='.5';
    let b64;
    try{b64=await compressAndEncodeImage(blob);}
    catch(_ce){
      if(scanArea)scanArea.style.opacity='';
      if(status){status.innerHTML='<div class="tip tip-w">Could not read that image, try another photo.</div>';}
      return;
    }
    const pageObj={b64,key:null};
    _expState.imagePages.push(pageObj);
    _expState.imageData={b64,type:'image/jpeg'};
    _uploadReceiptToStorage(Date.now(),b64).then(k=>{if(k)pageObj.key=k;}).catch(()=>{});
    try{
      const resp=await fetch('https://mwtsmctajhrrybblgorf.supabase.co/functions/v1/scan-receipt',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({imageBase64:b64,mediaType:'image/jpeg'})});
      if(!resp.ok)throw new Error('Scan error '+resp.status);
      const parsed=await resp.json();
      if(parsed.vendor)document.getElementById('em-vendor').value=parsed.vendor;
      if(parsed.amount)document.getElementById('em-amount').value=parsed.amount;
      if(parsed.date)document.getElementById('em-date').value='';  // cleared: set properly after user confirms below
      if(parsed.category)document.getElementById('em-cat').value=parsed.category;
      if(parsed.notes)document.getElementById('em-notes').value=parsed.notes;
      _expState.hasReceipt=true;
      _renderExpPages();
      if(scanArea){scanArea.style.opacity='1';scanArea.style.borderColor='var(--green-mid)';}
      _confirmReceiptDate(parsed.date||'',status);
    }catch(e){
      console.warn('Receipt scan failed:',e);
      if(status)status.innerHTML='<div class="tip tip-w">Could not auto-read, fill in manually below.</div>';
      if(scanArea)scanArea.style.opacity='1';
    }
  });
}
function expProcessPhoto(input){expTriggerScan();}

async function compressAndEncodeImage(file,maxPx=1200,qual=0.85){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onerror=()=>reject(new Error('Image read failed'));
    reader.onload=()=>{
      const img=new Image();
      img.onload=()=>{
        let w=img.width,h=img.height;
        if(w>maxPx){h=Math.round(h*(maxPx/w));w=maxPx;}
        if(h>maxPx){w=Math.round(w*(maxPx/h));h=maxPx;}
        const canvas=document.createElement('canvas');
        canvas.width=w||1;canvas.height=h||1;
        canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
        resolve(canvas.toDataURL('image/jpeg',qual).split(',')[1]);
      };
      img.onerror=()=>reject(new Error('Image decode failed'));
      img.src=reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ── Receipt Scanner ───────────────────────────────────────────────────────

// WebGPU state, allocated once per scanner session, destroyed on close
const _gpu={dev:null,pipe:null,sampler:null,uniformBuf:null,readBuf:null,tw:0,th:0};
window._gpu=_gpu;

const _GPU_WGSL=`
struct Dims { tw: u32, th: u32 }
@group(0) @binding(0) var<uniform> dims: Dims;
@group(0) @binding(1) var src: texture_external;
@group(0) @binding(2) var<storage,read_write> edges: array<f32>;

fn lum(c: vec4<f32>) -> f32 { return c.r*0.299+c.g*0.587+c.b*0.114; }

@compute @workgroup_size(8,8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x=gid.x; let y=gid.y;
  if(x<1u||y<1u||x>=dims.tw-1u||y>=dims.th-1u){
    if(x<dims.tw&&y<dims.th){edges[y*dims.tw+x]=0.0;}
    return;
  }
  let tl=lum(textureLoad(src,vec2<i32>(i32(x)-1,i32(y)-1)));
  let tc=lum(textureLoad(src,vec2<i32>(i32(x),  i32(y)-1)));
  let tr=lum(textureLoad(src,vec2<i32>(i32(x)+1,i32(y)-1)));
  let ml=lum(textureLoad(src,vec2<i32>(i32(x)-1,i32(y)  )));
  let mr=lum(textureLoad(src,vec2<i32>(i32(x)+1,i32(y)  )));
  let bl=lum(textureLoad(src,vec2<i32>(i32(x)-1,i32(y)+1)));
  let bc=lum(textureLoad(src,vec2<i32>(i32(x),  i32(y)+1)));
  let br=lum(textureLoad(src,vec2<i32>(i32(x)+1,i32(y)+1)));
  let gx=(tr+2.0*mr+br)-(tl+2.0*ml+bl);
  let gy=(bl+2.0*bc+br)-(tl+2.0*tc+tr);
  edges[y*dims.tw+x]=sqrt(gx*gx+gy*gy)*255.0;
}`;

async function _gpuInit(tw,th){
  if(!navigator.gpu)return false;
  try{
    const adapter=await navigator.gpu.requestAdapter();
    if(!adapter)return false;
    const dev=await adapter.requestDevice();
    const pipe=await dev.createComputePipelineAsync({
      layout:'auto',
      compute:{module:dev.createShaderModule({code:_GPU_WGSL}),entryPoint:'main'}
    });
    const uniformBuf=dev.createBuffer({size:8,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    const edgeBuf=dev.createBuffer({size:tw*th*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
    const readBuf=dev.createBuffer({size:tw*th*4,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
    Object.assign(_gpu,{dev,pipe,uniformBuf,edgeBuf,readBuf,tw,th});
    return true;
  }catch(e){console.warn('WebGPU init failed:',e);return false;}
}

async function _gpuSobelAsync(video,tw,th){
  const{dev,pipe,uniformBuf,edgeBuf,readBuf}=_gpu;
  if(!dev||!video.videoWidth)return null;
  try{
    const ext=dev.importExternalTexture({source:video});
    const bg=dev.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[
      {binding:0,resource:{buffer:uniformBuf}},
      {binding:1,resource:ext},
      {binding:2,resource:{buffer:edgeBuf}},
    ]});
    dev.queue.writeBuffer(uniformBuf,0,new Uint32Array([tw,th]));
    const enc=dev.createCommandEncoder();
    const pass=enc.beginComputePass();
    pass.setPipeline(pipe);pass.setBindGroup(0,bg);
    pass.dispatchWorkgroups(Math.ceil(tw/8),Math.ceil(th/8));
    pass.end();
    enc.copyBufferToBuffer(edgeBuf,0,readBuf,0,tw*th*4);
    dev.queue.submit([enc.finish()]);
    await readBuf.mapAsync(GPUMapMode.READ);
    const raw=new Float32Array(readBuf.getMappedRange().slice(0));
    readBuf.unmap();
    // Convert float edge map → Uint8Array for _detectDocCorners
    const e=new Uint8Array(tw*th*4);
    for(let i=0;i<tw*th;i++){const v=Math.min(255,raw[i]);e[i*4]=v;e[i*4+1]=v;e[i*4+2]=v;e[i*4+3]=255;}
    return _detectDocCorners(e,tw,th,video.videoWidth,video.videoHeight);
  }catch(e){return null;}
}

function _gpuDestroy(){
  try{_gpu.edgeBuf?.destroy();_gpu.readBuf?.destroy();_gpu.uniformBuf?.destroy();}catch(e){}
  Object.assign(_gpu,{dev:null,pipe:null,uniformBuf:null,edgeBuf:null,readBuf:null,tw:0,th:0});
}

function _showReceiptScanner(fileOrNull,callback){
  if(fileOrNull){_loadAndBuildScanUI(fileOrNull,callback);return;}
  const inp=document.createElement('input');inp.type='file';inp.accept='image/*';inp.capture='environment';inp.style.display='none';
  inp.onchange=()=>{const f=inp.files[0];inp.remove();if(f)_loadAndBuildScanUI(f,callback);};
  document.body.appendChild(inp);inp.click();
}

async function _openLiveScanner(callback){
  document.getElementById('live-scan-ui')?.remove();
  const ov=document.createElement('div');
  ov.id='live-scan-ui';
  ov.style.cssText='position:fixed;inset:0;background:#000;z-index:10000;font-family:inherit;overflow:hidden';
  document.body.appendChild(ov);

  const video=document.createElement('video');
  video.playsInline=true;video.autoplay=true;video.muted=true;
  video.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:cover';
  ov.appendChild(video);

  const overlay=document.createElement('canvas');
  overlay.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
  ov.appendChild(overlay);

  const flash=document.createElement('div');
  flash.style.cssText='position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;z-index:2;transition:opacity .15s';
  ov.appendChild(flash);

  const cancelBtn=document.createElement('button');
  cancelBtn.id='ls-cancel';
  cancelBtn.style.cssText='position:absolute;top:calc(env(safe-area-inset-top,0px)+14px);left:16px;background:rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.3);color:#fff;padding:8px 18px;border-radius:20px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;z-index:3';
  cancelBtn.innerHTML=svgIcon('✕',{size:14})+' Cancel';
  ov.appendChild(cancelBtn);

  const hint=document.createElement('div');
  hint.style.cssText='position:absolute;bottom:calc(env(safe-area-inset-bottom,0px)+120px);left:0;right:0;text-align:center;color:#fff;font-size:13px;font-weight:700;text-shadow:0 1px 6px rgba(0,0,0,.9);pointer-events:none;z-index:3;transition:color .3s';
  hint.textContent='Point camera at receipt';
  ov.appendChild(hint);

  const shutterWrap=document.createElement('div');
  shutterWrap.style.cssText='position:absolute;bottom:calc(env(safe-area-inset-bottom,0px)+20px);left:0;right:0;display:flex;flex-direction:column;align-items:center;gap:10px;z-index:3';
  shutterWrap.innerHTML=
    '<div id="ls-ready-label" style="background:rgba(0,0,0,.55);color:#fff;font-size:12px;font-weight:700;padding:5px 14px;border-radius:20px;opacity:0;transition:opacity .3s">'+svgIcon('✓',{size:12})+' Receipt detected, tap to capture</div>'+
    '<button id="ls-shutter" style="width:76px;height:76px;border-radius:50%;background:#fff;border:5px solid rgba(255,255,255,.4);cursor:pointer;box-shadow:0 4px 28px rgba(0,0,0,.6);display:block;transition:transform .1s,background .2s"></button>';
  ov.appendChild(shutterWrap);

  let stream=null;
  const stopStream=()=>stream?.getTracks().forEach(t=>t.stop());

  try{
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment',width:{ideal:1920},height:{ideal:1080}}});
    video.srcObject=stream;
    await new Promise(res=>{video.onloadedmetadata=res;});
    await video.play();
  }catch(e){
    ov.remove();
    const inp=document.createElement('input');inp.type='file';inp.accept='image/*';inp.capture='environment';inp.style.display='none';
    inp.onchange=()=>{const f=inp.files[0];inp.remove();if(f)_loadAndBuildScanUI(f,callback);};
    document.body.appendChild(inp);inp.click();
    return;
  }

  // Try to init WebGPU at thumbnail size; fall back to CPU if unavailable
  const TW=180,TH=Math.round(video.videoHeight*180/Math.max(1,video.videoWidth))||180;
  const useGPU=await _gpuInit(TW,TH);

  // Pre-allocate detection canvas once, never recreate it per frame
  const detCanvas=document.createElement('canvas');detCanvas.width=TW;detCanvas.height=TH;
  const detCtx=detCanvas.getContext('2d',{willReadFrequently:true});

  // Cache overlay canvas context and size, only resize on actual layout change
  const oc=overlay.getContext('2d');
  let ovW=0,ovH=0;
  function syncOverlaySize(){
    const w=ov.offsetWidth,h=ov.offsetHeight;
    if(w!==ovW||h!==ovH){overlay.width=w;overlay.height=h;ovW=w;ovH=h;}
  }
  syncOverlaySize();

  const readyLabel=document.getElementById('ls-ready-label');
  let detectedCorners=null,stableFrames=0,capturing=false,rafId=null;
  let gpuPending=false,lastDetectMs=0;
  const STABLE_NEEDED=8; // frames at 200ms = 1.6s before showing "ready" label

  function videoToOverlay(c){
    const vw=video.videoWidth,vh=video.videoHeight;
    const vAR=vw/vh,dAR=ovW/ovH;let sc,ox=0,oy=0;
    if(vAR>dAR){sc=ovH/vh;ox=(ovW-vw*sc)/2;}else{sc=ovW/vw;oy=(ovH-vh*sc)/2;}
    return{x:c.x*sc+ox,y:c.y*sc+oy};
  }

  // Draw the static guide rectangle (target frame) centered in viewfinder
  function drawGuide(){
    const gw=ovW*0.82,gh=Math.min(ovH*0.55,gw*1.45);
    const gx=(ovW-gw)/2,gy=(ovH-gh)/2-ovH*0.04;
    const arm=Math.min(gw,gh)*0.1;
    oc.strokeStyle='rgba(255,255,255,0.55)';oc.lineWidth=2;oc.setLineDash([6,5]);
    oc.strokeRect(gx,gy,gw,gh);oc.setLineDash([]);
    // L-bracket corners
    oc.strokeStyle='rgba(255,255,255,0.9)';oc.lineWidth=3;
    [[gx,gy,1,1],[gx+gw,gy,-1,1],[gx+gw,gy+gh,-1,-1],[gx,gy+gh,1,-1]].forEach(([cx,cy,sx,sy])=>{
      oc.beginPath();oc.moveTo(cx+sx*arm,cy);oc.lineTo(cx,cy);oc.lineTo(cx,cy+sy*arm);oc.stroke();
    });
  }

  function drawOverlay(){
    syncOverlaySize();
    oc.clearRect(0,0,ovW,ovH);
    drawGuide();
    if(!detectedCorners||!video.videoWidth)return;
    const sc=detectedCorners.map(c=>videoToOverlay(c));
    const confident=stableFrames>=STABLE_NEEDED;
    oc.beginPath();oc.moveTo(sc[0].x,sc[0].y);sc.slice(1).forEach(c=>oc.lineTo(c.x,c.y));oc.closePath();
    oc.fillStyle=confident?'rgba(56,189,248,0.15)':'rgba(255,255,255,0.06)';oc.fill();
    oc.strokeStyle=confident?'#22d3ee':'rgba(255,255,255,0.5)';
    oc.lineWidth=confident?3:2;oc.setLineDash([]);oc.stroke();
    const arm=Math.max(14,Math.min(22,ovW*0.04));
    sc.forEach((c,i)=>{
      const nx=sc[(i+1)%4],pv=sc[(i+3)%4];
      const dx1=(nx.x-c.x),dy1=(nx.y-c.y),len1=Math.sqrt(dx1*dx1+dy1*dy1)||1;
      const dx2=(pv.x-c.x),dy2=(pv.y-c.y),len2=Math.sqrt(dx2*dx2+dy2*dy2)||1;
      oc.strokeStyle=confident?'#22d3ee':'rgba(255,255,255,.75)';oc.lineWidth=3;
      oc.beginPath();
      oc.moveTo(c.x+dx1/len1*arm,c.y+dy1/len1*arm);oc.lineTo(c.x,c.y);
      oc.lineTo(c.x+dx2/len2*arm,c.y+dy2/len2*arm);oc.stroke();
    });
  }

  function applyResult(raw){
    if(raw){detectedCorners=raw;stableFrames=Math.min(stableFrames+1,STABLE_NEEDED+4);}
    else{detectedCorners=null;stableFrames=Math.max(stableFrames-3,0);}
    const ready=stableFrames>=STABLE_NEEDED;
    if(stableFrames===0)hint.textContent='Align receipt inside the frame';
    else if(stableFrames<4)hint.textContent='Hold steady…';
    else if(!ready)hint.textContent='Almost: keep holding…';
    else hint.textContent='';
    if(readyLabel)readyLabel.style.opacity=ready?'1':'0';
    const shutter=document.getElementById('ls-shutter');
    if(shutter)shutter.style.background=ready?'#22d3ee':'#fff';
  }

  function rafLoop(){
    if(capturing)return;
    rafId=requestAnimationFrame(rafLoop);
    drawOverlay();
    const now=performance.now();
    if(now-lastDetectMs<200||!video.videoWidth)return;
    lastDetectMs=now;
    if(useGPU){
      if(!gpuPending){
        gpuPending=true;
        _gpuSobelAsync(video,TW,TH).then(raw=>{gpuPending=false;applyResult(raw);}).catch(()=>{gpuPending=false;});
      }
    }else{
      detCtx.drawImage(video,0,0,TW,TH);
      const imgData=detCtx.getImageData(0,0,TW,TH);
      applyResult(_detectDocCorners(imgData.data,TW,TH,video.videoWidth,video.videoHeight));
    }
    // No auto-capture, user taps shutter when ready
  }

  rafId=requestAnimationFrame(rafLoop);

  function doCapture(){
    if(capturing)return;
    capturing=true;
    cancelAnimationFrame(rafId);rafId=null;
    _gpuDestroy();
    flash.style.opacity='1';setTimeout(()=>flash.style.opacity='0',150);
    const cap=document.createElement('canvas');
    cap.width=video.videoWidth;cap.height=video.videoHeight;
    cap.getContext('2d').drawImage(video,0,0);
    stopStream();
    setTimeout(()=>{
      ov.remove();
      if(detectedCorners&&stableFrames>=3){
        cap.toBlob(blob=>{
          const img=new Image();const u=URL.createObjectURL(blob);
          img.onload=()=>{URL.revokeObjectURL(u);
            try{const w=_scanWarp(img,cap.width,cap.height,detectedCorners);_scanEnhance(w);w.toBlob(wb=>callback(wb),'image/jpeg',0.92);}
            catch(e){callback(blob);}
          };img.src=u;
        },'image/jpeg',0.95);
      }else{
        cap.toBlob(blob=>{
          const img=new Image();const u=URL.createObjectURL(blob);
          img.onload=()=>{URL.revokeObjectURL(u);_buildScanUI(img,blob,callback);};img.src=u;
        },'image/jpeg',0.95);
      }
    },200);
  }

  cancelBtn.onclick=()=>{cancelAnimationFrame(rafId);rafId=null;_gpuDestroy();stopStream();ov.remove();};
  document.getElementById('ls-shutter').onclick=()=>{if(!capturing)doCapture();};
}

function _loadAndBuildScanUI(file,callback){
  if(!file)return;
  const url=URL.createObjectURL(file);
  const img=new Image();
  img.onload=()=>{URL.revokeObjectURL(url);_buildScanUI(img,file,callback);};
  img.onerror=()=>{URL.revokeObjectURL(url);callback(file);};
  img.src=url;
}

function _buildScanUI(img,origBlob,callback){
  document.getElementById('rcpt-scan-ui')?.remove();
  const ov=document.createElement('div');
  ov.id='rcpt-scan-ui';
  ov.style.cssText='position:fixed;inset:0;background:#000;z-index:10000;display:flex;flex-direction:column;font-family:inherit';
  document.body.appendChild(ov);

  const hdr=document.createElement('div');
  hdr.style.cssText='padding:12px 16px;display:flex;justify-content:space-between;align-items:center;background:#111;flex-shrink:0';
  hdr.innerHTML=
    '<button id="scan-skip-btn" style="background:none;border:1px solid #555;color:#ccc;padding:7px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">Skip</button>'+
    '<div style="color:#fff;font-size:14px;font-weight:700">Adjust crop</div>'+
    '<button id="scan-use-btn" style="background:#0ea5e9;border:none;color:#fff;padding:7px 16px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">Use scan '+svgIcon('✓',{size:13})+'</button>';
  ov.appendChild(hdr);

  const wrap=document.createElement('div');
  wrap.style.cssText='flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative;background:#000';
  ov.appendChild(wrap);

  const cvs=document.createElement('canvas');
  cvs.style.cssText='touch-action:none;max-width:100%;max-height:100%;display:block';
  wrap.appendChild(cvs);
  const ctx=cvs.getContext('2d');

  const foot=document.createElement('div');
  foot.id='scan-foot';
  foot.style.cssText='padding:10px 16px;background:#111;text-align:center;flex-shrink:0;color:#888;font-size:12px';
  foot.textContent='Drag the blue corners to the edges of your receipt';
  ov.appendChild(foot);

  const maxW=window.innerWidth,maxH=window.innerHeight-110;
  const scale=Math.min(maxW/img.naturalWidth,maxH/img.naturalHeight,1);
  const dw=Math.round(img.naturalWidth*scale),dh=Math.round(img.naturalHeight*scale);
  cvs.width=dw;cvs.height=dh;
  ctx.drawImage(img,0,0,dw,dh);

  const p=0.06;
  let corners=[{x:dw*p,y:dh*p},{x:dw*(1-p),y:dh*p},{x:dw*(1-p),y:dh*(1-p)},{x:dw*p,y:dh*(1-p)}];
  const tmp=document.createElement('canvas');tmp.width=180;tmp.height=Math.round(dh*180/dw);
  tmp.getContext('2d').drawImage(img,0,0,180,tmp.height);
  const id=tmp.getContext('2d').getImageData(0,0,180,tmp.height);
  const auto=_detectDocCorners(id.data,180,tmp.height,dw,dh);
  if(auto)corners=auto;

  let active=-1;
  const HR=Math.max(18,Math.min(28,dw*0.05));

  function redraw(){
    ctx.drawImage(img,0,0,dw,dh);
    ctx.beginPath();ctx.moveTo(corners[0].x,corners[0].y);
    for(let i=1;i<4;i++)ctx.lineTo(corners[i].x,corners[i].y);
    ctx.closePath();ctx.fillStyle='rgba(14,165,233,0.18)';ctx.fill();
    ctx.strokeStyle='#38bdf8';ctx.lineWidth=2;ctx.setLineDash([8,4]);ctx.stroke();ctx.setLineDash([]);
    corners.forEach((c,i)=>{ctx.beginPath();ctx.arc(c.x,c.y,HR,0,Math.PI*2);ctx.fillStyle=i===active?'#fff':'#0ea5e9';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=2.5;ctx.stroke();});
  }
  redraw();

  function evPos(e){const rect=cvs.getBoundingClientRect(),t=e.touches?e.touches[0]:e;return{x:(t.clientX-rect.left)*(dw/rect.width),y:(t.clientY-rect.top)*(dh/rect.height)};}
  function nearest(pos){const hit=Math.max(44,dw*0.1)*(dw/(cvs.getBoundingClientRect().width||dw));let best=-1,bd=hit;corners.forEach((c,i)=>{const d=Math.hypot(c.x-pos.x,c.y-pos.y);if(d<bd){bd=d;best=i;}});return best;}
  function clamp(c){return{x:Math.max(0,Math.min(dw,c.x)),y:Math.max(0,Math.min(dh,c.y))};}

  cvs.addEventListener('touchstart',e=>{e.preventDefault();active=nearest(evPos(e));redraw();},{passive:false});
  cvs.addEventListener('touchmove',e=>{e.preventDefault();if(active<0)return;corners[active]=clamp(evPos(e));redraw();},{passive:false});
  cvs.addEventListener('touchend',e=>{e.preventDefault();active=-1;redraw();},{passive:false});
  cvs.addEventListener('mousedown',e=>{active=nearest(evPos(e));redraw();});
  cvs.addEventListener('mousemove',e=>{if(active<0||!e.buttons)return;corners[active]=clamp(evPos(e));redraw();});
  cvs.addEventListener('mouseup',()=>{active=-1;redraw();});

  document.getElementById('scan-skip-btn').onclick=()=>{ov.remove();callback(origBlob);};
  document.getElementById('scan-use-btn').onclick=()=>{
    const btn=document.getElementById('scan-use-btn');if(!btn)return;
    btn.disabled=true;btn.textContent='Processing…';
    document.getElementById('scan-foot').textContent='Applying perspective correction…';
    const ws=Math.min(1500/img.naturalWidth,1500/img.naturalHeight,1);
    const sc=corners.map(c=>({x:c.x/scale*ws,y:c.y/scale*ws}));
    setTimeout(()=>{
      try{const warped=_scanWarp(img,Math.round(img.naturalWidth*ws),Math.round(img.naturalHeight*ws),sc);_scanEnhance(warped);warped.toBlob(blob=>{ov.remove();callback(blob);},'image/jpeg',0.92);}
      catch(e){ov.remove();callback(origBlob);}
    },16);
  };
}

// ── Core detection: Sobel edges + corner walking ──────────────────────────

function _detectDocCorners(data,tw,th,outW,outH){
  try{
    // Grayscale
    const g=new Float32Array(tw*th);
    for(let i=0;i<tw*th;i++) g[i]=data[i*4]*0.299+data[i*4+1]*0.587+data[i*4+2]*0.114;
    // Sobel edge magnitude
    const e=new Uint8Array(tw*th);
    for(let y=1;y<th-1;y++) for(let x=1;x<tw-1;x++){
      const gx=-g[(y-1)*tw+x-1]-2*g[y*tw+x-1]-g[(y+1)*tw+x-1]+g[(y-1)*tw+x+1]+2*g[y*tw+x+1]+g[(y+1)*tw+x+1];
      const gy=-g[(y-1)*tw+x-1]-2*g[(y-1)*tw+x]-g[(y-1)*tw+x+1]+g[(y+1)*tw+x-1]+2*g[(y+1)*tw+x]+g[(y+1)*tw+x+1];
      e[y*tw+x]=Math.min(255,Math.sqrt(gx*gx+gy*gy));
    }
    // Adaptive threshold, top 30% of non-trivial edges
    const vals=[];for(let i=0;i<e.length;i++) if(e[i]>8)vals.push(e[i]);
    if(vals.length<80) return null;
    vals.sort((a,b)=>a-b);
    const thr=vals[Math.floor(vals.length*0.7)];
    // Bounding box of strong edges (ignore 4% border)
    const mg=Math.round(Math.min(tw,th)*0.04);
    let x0=tw,x1=0,y0=th,y1=0,cnt=0;
    for(let y=mg;y<th-mg;y++) for(let x=mg;x<tw-mg;x++){
      if(e[y*tw+x]>thr){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;cnt++;}
    }
    if(cnt<60||x1-x0<tw*0.38||y1-y0<th*0.30) return null;
    // Reject if bounding box fills nearly the entire frame, probably background clutter not a document
    if(x1-x0>tw*0.97&&y1-y0>th*0.97) return null;
    // Walk from each bounding-box corner diagonally inward to find first strong edge
    function walk(sx,sy,dx,dy){
      for(let i=0;i<Math.max(tw,th);i++){
        const x=Math.round(sx+i*dx),y=Math.round(sy+i*dy);
        if(x<0||x>=tw||y<0||y>=th) break;
        if(e[y*tw+x]>thr*0.55) return{x,y};
      }
      return{x:Math.max(0,Math.min(tw-1,Math.round(sx))),y:Math.max(0,Math.min(th-1,Math.round(sy)))};
    }
    const tl=walk(x0,y0, 1, 1),tr=walk(x1,y0,-1, 1);
    const br=walk(x1,y1,-1,-1),bl=walk(x0,y1, 1,-1);
    const sx=outW/tw,sy=outH/th;
    return[{x:tl.x*sx,y:tl.y*sy},{x:tr.x*sx,y:tr.y*sy},{x:br.x*sx,y:br.y*sy},{x:bl.x*sx,y:bl.y*sy}];
  }catch(e){return null;}
}

// keep old name for any callers
function _scanDetectCorners(ctx,w,h){
  if(!w||!h)return null;
  const tw=180,th=Math.round(h*180/w);
  const tmp=document.createElement('canvas');tmp.width=tw;tmp.height=th;
  tmp.getContext('2d').drawImage(ctx.canvas,0,0,tw,th);
  const id=tmp.getContext('2d').getImageData(0,0,tw,th);
  return _detectDocCorners(id.data,tw,th,w,h);
}
function _scanDetectCornersFromCanvas(ctx,w,h){return _scanDetectCorners(ctx,w,h);}

function _scanWarp(img,w,h,corners){
  const[tl,tr,br,bl]=corners;
  const outW=Math.round(Math.max(Math.hypot(tr.x-tl.x,tr.y-tl.y),Math.hypot(br.x-bl.x,br.y-bl.y)));
  const outH=Math.round(Math.max(Math.hypot(bl.x-tl.x,bl.y-tl.y),Math.hypot(br.x-tr.x,br.y-tr.y)));
  if(!outW||!outH){const d=document.createElement('canvas');d.width=Math.max(outW,1);d.height=Math.max(outH,1);return d;}
  const src=document.createElement('canvas');src.width=w;src.height=h;
  src.getContext('2d').drawImage(img,0,0,w,h);
  const sData=src.getContext('2d').getImageData(0,0,w,h).data;
  const dst=document.createElement('canvas');dst.width=outW;dst.height=outH;
  const dctx=dst.getContext('2d');const dImg=dctx.createImageData(outW,outH);const dd=dImg.data;
  const hm=_scanHomography([[0,0],[outW,0],[outW,outH],[0,outH]],[[tl.x,tl.y],[tr.x,tr.y],[br.x,br.y],[bl.x,bl.y]]);
  for(let y=0;y<outH;y++) for(let x=0;x<outW;x++){
    const ww=hm[6]*x+hm[7]*y+1;
    const sx=Math.round((hm[0]*x+hm[1]*y+hm[2])/ww);
    const sy=Math.round((hm[3]*x+hm[4]*y+hm[5])/ww);
    if(sx>=0&&sx<w&&sy>=0&&sy<h){const si=(sy*w+sx)<<2,di=(y*outW+x)<<2;dd[di]=sData[si];dd[di+1]=sData[si+1];dd[di+2]=sData[si+2];dd[di+3]=255;}
  }
  dctx.putImageData(dImg,0,0);return dst;
}

function _scanHomography(src4,dst4){
  const A=[],b=[];
  for(let i=0;i<4;i++){
    const[sx,sy]=src4[i],[dx,dy]=dst4[i];
    A.push([-sx,-sy,-1,0,0,0,sx*dx,sy*dx]);b.push(-dx);
    A.push([0,0,0,-sx,-sy,-1,sx*dy,sy*dy]);b.push(-dy);
  }
  const n=8,M=A.map((r,i)=>[...r,b[i]]);
  for(let c=0;c<n;c++){
    let mx=c;for(let r=c+1;r<n;r++)if(Math.abs(M[r][c])>Math.abs(M[mx][c]))mx=r;
    [M[c],M[mx]]=[M[mx],M[c]];
    for(let r=c+1;r<n;r++){const f=M[r][c]/M[c][c];for(let j=c;j<=n;j++)M[r][j]-=f*M[c][j];}
  }
  const x=new Array(n).fill(0);
  for(let i=n-1;i>=0;i--){x[i]=M[i][n];for(let j=i+1;j<n;j++)x[i]-=M[i][j]*x[j];x[i]/=M[i][i];}
  return x;
}

function _scanEnhance(canvas){
  const ctx=canvas.getContext('2d');const img=ctx.getImageData(0,0,canvas.width,canvas.height);
  const d=img.data,n=d.length;
  let rMn=255,rMx=0,gMn=255,gMx=0,bMn=255,bMx=0;
  for(let i=0;i<n;i+=4){if(d[i]<rMn)rMn=d[i];if(d[i]>rMx)rMx=d[i];if(d[i+1]<gMn)gMn=d[i+1];if(d[i+1]>gMx)gMx=d[i+1];if(d[i+2]<bMn)bMn=d[i+2];if(d[i+2]>bMx)bMx=d[i+2];}
  const rs=255/Math.max(1,rMx-rMn),gs=255/Math.max(1,gMx-gMn),bs=255/Math.max(1,bMx-bMn);
  for(let i=0;i<n;i+=4){d[i]=Math.min(255,(d[i]-rMn)*rs);d[i+1]=Math.min(255,(d[i+1]-gMn)*gs);d[i+2]=Math.min(255,(d[i+2]-bMn)*bs);}
  ctx.putImageData(img,0,0);
}

// ── End Receipt Scanner ───────────────────────────────────────────────────

function _confirmReceiptDate(aiDate,statusEl){
  const existing=document.getElementById('rcpt-date-confirm');
  if(existing)existing.remove();
  const div=document.createElement('div');
  div.id='rcpt-date-confirm';
  div.style.cssText='background:#FEF3C7;border:1px solid #D97706;border-radius:var(--r);padding:10px 12px;margin-top:8px';
  let displayDate=aiDate||'(no date found)';
  try{if(aiDate){const d=new Date(aiDate+'T12:00:00');displayDate=d.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});}}catch(e){}
  div.innerHTML=
    '<div style="font-size:11px;font-weight:700;color:#92400E;margin-bottom:6px">'+svgIcon('📅',{size:12})+' AI read date as: <strong>'+displayDate+'</strong>, correct?</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">'+
      '<button id="rcpt-yes-btn" style="padding:8px;border-radius:var(--r);border:none;background:#D97706;color:#fff;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">'+svgIcon('✓',{size:12})+' Yes</button>'+
      '<button id="rcpt-no-btn" style="padding:8px;border-radius:var(--r);border:1px solid #D97706;background:#fff;color:#92400E;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">'+svgIcon('✗',{size:12})+' Let me fix it</button>'+
    '</div>';
  const scanArea=document.getElementById('exp-scan-area');
  if(scanArea)scanArea.after(div);
  div.querySelector('#rcpt-yes-btn').onclick=()=>{
    const el=document.getElementById('em-date');
    if(el&&aiDate){const m=aiDate.match(/(\d{4})-(\d{2})-(\d{2})/);el.value=m?m[2]+'/'+m[3]+'/'+m[1]:aiDate;}
    div.remove();
    if(statusEl)statusEl.innerHTML='<div class="tip tip-s"><strong>'+svgIcon('✓',{size:13})+' Receipt saved</strong>, fill in any missing fields and tap Save.</div>';
  };
  div.querySelector('#rcpt-no-btn').onclick=()=>{
    const el=document.getElementById('em-date');
    if(el){el.value='';el.style.borderColor='#D97706';el.style.background='#FEF3C7';el.focus();}
    div.remove();
    if(statusEl)statusEl.innerHTML='<div class="tip tip-s"><strong>'+svgIcon('✓',{size:13})+' Receipt read</strong>, enter the correct date below.</div>';
  };
}

function toggleExpenseSections(){
  const cat=document.getElementById('em-cat')?.value||'';
  const mealSec=document.getElementById('em-meal-section');
  if(mealSec){mealSec.style.display=cat==='meals'?'block':'none';if(cat==='meals')document.getElementById('em-meal-purpose')?.focus();}
  const mktSec=document.getElementById('em-marketing-section');
  if(mktSec)mktSec.style.display=cat==='marketing'?'block':'none';
  const vehSec=document.getElementById('em-vehicle-section');
  const _isVehCat=['fuel','vehicle','vehicle_purchase'].includes(cat);
  if(vehSec)vehSec.style.display=(_isVehCat&&(typeof getVehicles==='function'?getVehicles():[]).length)?'block':'none';
}
function toggleMealFields(){toggleExpenseSections();}  // backwards compat
function toggleCashWarning(){
  const method=document.getElementById('_inc-method')?.value||'';
  const warn=document.getElementById('_inc-cash-warn');
  if(warn)warn.style.display=method==='Cash'?'block':'none';
  if(method!=='Cash'){const cb=document.getElementById('_inc-cash-confirm');if(cb)cb.checked=false;}
}
async function expSave(){
  const btn=document.getElementById('exp-save-btn');
  const err=document.getElementById('exp-save-err');
  const vendor=(document.getElementById('em-vendor')?.value||'').trim();
  const amount=parseFloat(document.getElementById('em-amount')?.value||0);
  // Parse date, handle both MM/DD/YYYY input and raw ISO YYYY-MM-DD (safety net)
  const _rawDate=document.getElementById('em-date')?.value||'';
  const _isoM=_rawDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const _dm=!_isoM&&_rawDate.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  const date=_isoM?_rawDate:(_dm?(_dm[3].length===2?'20':'')+_dm[3]+'-'+_dm[1].padStart(2,'0')+'-'+_dm[2].padStart(2,'0'):_rawDate);
  const cat=document.getElementById('em-cat')?.value||'other';
  const jobId=parseInt(document.getElementById('em-job')?.value)||null;
  const notes=(document.getElementById('em-notes')?.value||'').trim();
  if(!vendor){if(err)err.textContent='Enter a vendor name.';return;}
  if(!amount||amount<=0){if(err)err.textContent='Enter a valid amount.';return;}
  if(!date){if(err)err.textContent='Select a date.';return;}
  if(cat==='meals'){const mp=(document.getElementById('em-meal-purpose')?.value||'').trim();if(!mp){if(err)err.textContent='IRS requires a business purpose for meal expenses.';document.getElementById('em-meal-purpose')?.focus();return;}}
  const leadSource=cat==='marketing'?(document.getElementById('em-mkt-source')?.value||'').trim():'';
  if(cat==='marketing'&&!leadSource){if(err)err.textContent='Select which marketing channel this belongs to.';document.getElementById('em-mkt-source')?.focus();return;}
  // Edit mode, update existing record instead of creating new
  if(_expState.editId){
    const idx=expenses.findIndex(e=>e.id===_expState.editId);
    if(idx>-1){
      btn.disabled=true;btn.textContent='Saving...';if(err)err.textContent='';
      const catInfo2=IRS_EXPENSE_CATS.find(c=>c.id===cat)||{};
      const job2=jobId?bids.find(b=>b.id===jobId):null;
      const mealPurpose2=cat==='meals'?(document.getElementById('em-meal-purpose')?.value||'').trim():'';
      const mealAttendees2=cat==='meals'?(document.getElementById('em-meal-attendees')?.value||'').trim():'';
      const existing_keys=expenses[idx].receipt_keys||([expenses[idx].receipt_key].filter(Boolean));
      for(let pi=0;pi<_expState.imagePages.length;pi++){
        const pg=_expState.imagePages[pi];
        if(pg.key){existing_keys.push(pg.key);}
        else if(pg.b64){try{const k=await _uploadReceiptToStorage(expenses[idx].id+'_p'+(existing_keys.length+1),pg.b64);if(k)existing_keys.push(k);}catch(e){}}
      }
      const upd_receipt_key=existing_keys[0]||expenses[idx].receipt_key||null;
      const upd_receipt_img=existing_keys.length?null:expenses[idx].receipt_img;
      expenses[idx]={...expenses[idx],date,cat,catLabel:catInfo2.label||cat,vendor,amount,notes,
        vehicleName:(['fuel','vehicle','vehicle_purchase'].includes(cat)?(document.getElementById('em-vehicle')?.value||''):'')||undefined,
        lead_source:leadSource||undefined,meal_purpose:mealPurpose2||undefined,meal_attendees:mealAttendees2||undefined,
        job_id:jobId,job_name:job2?job2.client_name||job2.name:'',
        receipt:upd_receipt_key||upd_receipt_img?'Yes: photo stored':'No receipt photo',
        receipt_key:upd_receipt_key,receipt_img:upd_receipt_img,
        receipt_keys:existing_keys.length?existing_keys:undefined,
        deductible:catInfo2.deductible!==false,meals_50:!!(catInfo2.meals_50),
      };
      expenses.sort((a,b)=>(a.date||'9').localeCompare(b.date||'9'));
      showToast('Expense updated, '+vendor+' '+fmt(amount),'✓');
      closeExpenseFlow();
      setTimeout(()=>{if(typeof renderExpenses==='function')renderExpenses();},0);
      if(typeof _flushSaveNow==='function')_flushSaveNow();else saveAll();
      return;
    }
  }
  // Duplicate check, same vendor, amount, and date within 2 days
  const dupExp=expenses.find(e=>{
    if(e.vendor&&vendor&&e.vendor.toLowerCase()===vendor.toLowerCase()&&
       Math.abs(e.amount-amount)<0.01){
      const d1=new Date(e.date),d2=new Date(date);
      return Math.abs(d1-d2)<2*86400000;
    }
    return false;
  });
  if(dupExp){
    if(err)err.textContent='Possible duplicate: '+dupExp.vendor+' $'+dupExp.amount+' already logged on '+dupExp.date+'. Save anyway?';
    if(!confirm('Possible duplicate: '+dupExp.vendor+' $'+dupExp.amount+' already logged on '+dupExp.date+'. Save anyway?'))return;
    if(err)err.textContent='';
  }
  btn.disabled=true;btn.textContent='Saving...';
  if(err)err.textContent='';
  const catInfo=IRS_EXPENSE_CATS.find(c=>c.id===cat)||{};
  const job=jobId?bids.find(b=>b.id===jobId):null;
  const mealPurpose=cat==='meals'?(document.getElementById('em-meal-purpose')?.value||'').trim():'';
  const mealAttendees=cat==='meals'?(document.getElementById('em-meal-attendees')?.value||'').trim():'';
  const expId=_expState.preId||Date.now();
  // Upload all pages; each page may already have a key from pre-upload
  const receipt_keys=[];
  for(let pi=0;pi<_expState.imagePages.length;pi++){
    const pg=_expState.imagePages[pi];
    if(pg.key){receipt_keys.push(pg.key);}
    else if(pg.b64){
      try{const k=await _uploadReceiptToStorage(expId+'_p'+(pi+1),pg.b64);if(k)receipt_keys.push(k);}
      catch(e){}
    }
  }
  const receipt_key=receipt_keys[0]||null;
  const receipt_img=_expState.imagePages.length&&!receipt_key?'data:image/jpeg;base64,'+_expState.imagePages[0].b64:null;
  expenses.push({
    id:expId,date,cat,catLabel:catInfo.label||cat,vendor,amount,notes,
    vehicleName:(['fuel','vehicle','vehicle_purchase'].includes(cat)?(document.getElementById('em-vehicle')?.value||''):'')||undefined,
    lead_source:leadSource||undefined,
    meal_purpose:mealPurpose||undefined,meal_attendees:mealAttendees||undefined,
    created_at:new Date().toISOString(),
    job_id:jobId,job_name:job?job.client_name||job.name:'',client_id:job?job.client_id:null,
    receipt:receipt_key||receipt_img?'Yes: photo stored':'No receipt photo',
    receipt_key,receipt_img,receipt_keys:receipt_keys.length?receipt_keys:undefined,
    deductible:catInfo.deductible!==false,meals_50:!!(catInfo.meals_50),
  });
  expenses.sort((a,b)=>(a.date||'9').localeCompare(b.date||'9'));
  showToast((new Date(date).getFullYear()<new Date().getFullYear()?'Back-tax expense':'Expense')+' saved: '+vendor+' '+fmt(amount),receipt_img?'📎':'🧾');
  if(cat==='tools'&&amount>=500)setTimeout(()=>showToast(svgIcon('💡')+' Equipment $'+amount.toFixed(0)+'+ may qualify for Section 179 immediate deduction, flag for your CPA','📋'),900);
  closeExpenseFlow();
  goPg('pg-tracker');
  setTimeout(()=>{const b=document.getElementById('tr-t-expenses');if(b)b.click();},200);
  if(typeof _flushSaveNow==='function')_flushSaveNow();else saveAll();
}

function quickAction(type){
  if(type==='collect'){openCollectModal();return;}
  const tk=todayKey();
  const todayJobs=jobs.filter(j=>{
    const d=parseInt(j.days)||1;
    for(let i=0;i<d;i++){if(addDays(j.start,i)===tk)return true;}
    return false;
  });
  const todayEstimates=jobs.filter(j=>j.eventType==='estimate'&&j.start===tk);
  const pendingBids=bids.filter(b=>b.status==='Pending');
  const wonUnscheduled=bids.filter(b=>b.status==='Closed Won'&&!jobs.find(j=>j.bid_id===b.id||j.client_id===b.client_id&&j.eventType!=='estimate'&&j.start>=tk));

  if(type==='drive'){
    // Mileage requires a vehicle on record (IRS: every trip log names a vehicle).
    // The Drive button is grayed until one exists (_renderDashSetupTodo); this is
    // the fallback so the flow never dead-ends into an empty mileage log.
    if((typeof getVehicles==='function'?getVehicles():(S.vehicles||[])).length===0){
      if(typeof showToast==='function')showToast('Add a vehicle first to log mileage','🚗');
      if(typeof openAddVehicleModal==='function')openAddVehicleModal();
      return;
    }
    try{ openDriveModal(); }catch(e){ console.error('[TradeDesk] openDriveModal failed:',e); }
  } else if(type==='expense'){
    try{ openExpenseFlow(); }catch(e){ console.error('[TradeDesk] openExpenseFlow failed:',e); }
  } else if(type==='estimate'){
    const options=[];
    todayEstimates.forEach(j=>{
      const c=getClientById(j.client_id);
      if(c&&!options.find(o=>o.clientId===j.client_id))
        options.push({label:c.name,sub:'Estimate today'+(j.time?' @ '+fmtTime(j.time):''),clientId:j.client_id,icon:'📅'});
    });
    if(!options.length){
      const week=addDays(tk,7);
      jobs.filter(j=>j.eventType==='estimate'&&j.start>=tk&&j.start<=week).forEach(j=>{
        const c=getClientById(j.client_id);
        if(c&&!options.find(o=>o.clientId===j.client_id))
          options.push({label:c.name,sub:'Estimate '+j.start+(j.time?' @ '+fmtTime(j.time):''),clientId:j.client_id,icon:'📅'});
      });
    }
    clients.filter(c=>!getClientBids(c.id).length).slice(0,4).forEach(c=>{
      if(!options.find(o=>o.clientId===c.id))
        options.push({label:c.name,sub:(c.addr||'').split(',')[0]||'New lead',clientId:c.id,icon:'🆕'});
    });
    showQuickPicker('Start Estimate','Which client?',options,'estimate',true);
  } else if(type==='schedule'){
    if(!wonUnscheduled.length){
      if(!bids.some(b=>b.status==='Closed Won')){
        showWorkflowGate('No signed jobs to schedule. Close an estimate first.','Start Estimate','function(){quickAction(\'estimate\');}');return;
      }
      showWorkflowGate('All signed jobs are already scheduled. Check your calendar.','View Calendar','function(){goPg(\'pg-cal\');}');return;
    }
    const options=[];
    wonUnscheduled.slice(0,8).forEach(b=>{
      const c=getClientById(b.client_id);
      if(c)options.push({label:c.name,sub:fmt(b.amount)+', won bid',clientId:b.client_id,bidId:b.id,icon:'✓'});
    });
    showQuickPicker('Schedule Job','Which job to schedule?',options,'schedule',false);
  } else if(type==='complete'){
    openCompleteJobModal();
  }
}

function openCompleteJobModal(){
  const tk=todayKey();
  const candidates=jobs.filter(j=>{
    if(j.status==='done'||j.status==='canceled')return false;
    if(j.eventType==='estimate')return false;
    return true;
  }).map(j=>{
    const c=getClientById(j.client_id);
    const isPast=j.start<tk,isToday=j.start===tk;
    return{j,c,priority:isPast?0:isToday?1:2,isPast,isToday};
  }).filter(x=>x.c).sort((a,b)=>a.priority-b.priority||(a.j.start<b.j.start?-1:1));

  // Clear any open overlay first, never stack modals, and keep this deterministic so
  // a stale overlay left in the DOM can't be what callers/tests read back.
  document.querySelectorAll('.zmodal-overlay').forEach(el=>el.remove());
  const overlay=document.createElement('div');
  overlay.className='zmodal-overlay';
  overlay.style.cssText='';
  const rows=candidates.length===0
    ?'<div style="text-align:center;padding:24px;color:var(--text3)">No active jobs to complete right now.</div>'
    :candidates.map(({j,c,isPast,isToday})=>{
      const tag=isPast
        ?'<span style="font-size:10px;font-weight:800;background:#A32D2D;color:#fff;padding:2px 5px;border-radius:4px;margin-left:4px">Past</span>'
        :isToday?'<span style="font-size:10px;font-weight:800;background:var(--blue);color:#fff;padding:2px 5px;border-radius:4px;margin-left:4px">Today</span>':'';
      return '<button onclick="markJobCompleteFromDash('+j.id+',this)" style="width:100%;text-align:left;padding:14px 16px;border:none;border-bottom:1px solid var(--border);background:none;cursor:pointer;font-family:inherit">'+
        '<div style="display:flex;justify-content:space-between;align-items:center">'+
          '<div>'+
            '<div style="font-size:14px;font-weight:700;color:var(--text)">'+escHtml(c.name)+tag+'</div>'+
            '<div style="font-size:11px;color:var(--text3);margin-top:2px">'+j.start+(j.days>1?' · '+j.days+' days':'')+'</div>'+
          '</div>'+
          '<svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke:var(--text3);fill:none;stroke-width:2;flex-shrink:0"><polyline points="9 18 15 12 9 6"/></svg>'+
        '</div>'+
      '</button>';
    }).join('');
  overlay.innerHTML=
    '<div style="background:var(--bg);border-radius:var(--rl) var(--rl) 0 0;width:100%;max-height:80vh;overflow-y:auto">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid var(--border2)">'+
        '<div style="font-size:16px;font-weight:800">'+svgIcon('✅',{size:16})+' Complete Job</div>'+
        '<button onclick="this.closest(\'.zmodal-overlay\').remove()" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--text3);padding:0 4px">×</button>'+
      '</div>'+rows+
    '</div>';
  document.body.appendChild(overlay);
  overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});
}

function markJobCompleteFromDash(jobId,triggerBtn){
  const j=jobs.find(x=>x.id===jobId);if(!j)return;
  const c=getClientById(j.client_id);
  // Close the job picker sheet first, then open full markJobDone modal
  const sheet=triggerBtn&&triggerBtn.closest('.zmodal-overlay');
  if(sheet)sheet.remove();
  markJobDone(jobId);
}

function showQuickPicker(title,subtitle,suggestions,actionType,allowNew){
  const overlay=document.createElement('div');
  overlay.className='zmodal-overlay';
  const box=document.createElement('div');
  box.className='zmodal';
  box.style.maxHeight='85vh';
  box.style.overflowY='auto';

  let suggestHtml='';
  if(suggestions.length){
    suggestHtml='<div style="margin-bottom:12px">'+
      '<div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text3);margin-bottom:6px">'+
        (suggestions[0]?'Today / Recent':'Suggestions')+
      '</div>'+
      suggestions.map((s,i)=>
        '<button data-idx="'+i+'" data-action="'+actionType+'" onclick="pickQuickClient(this,this.dataset.action)" style="width:100%;text-align:left;padding:12px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);cursor:pointer;font-family:inherit;margin-bottom:6px;display:flex;align-items:center;gap:10px">'+
          '<span style="font-size:20px">'+svgIcon(s.icon,{size:20})+'</span>'+
          '<div style="flex:1;min-width:0">'+
            '<div style="font-size:14px;font-weight:700;color:var(--text)">'+escHtml(s.label||'')+'</div>'+
            '<div style="font-size:11px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml(s.sub||'')+'</div>'+
          '</div>'+
          '<svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke:var(--text3);fill:none;stroke-width:2;flex-shrink:0"><polyline points="9 18 15 12 9 6"/></svg>'+
        '</button>'
      ).join('')+
    '</div>';
  }

  box.innerHTML=
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">'+
      '<div style="font-size:17px;font-weight:800">'+title+'</div>'+
      '<button onclick="closeTopModal()" style="border:none;background:none;font-size:22px;cursor:pointer;color:var(--text3);padding:0;line-height:1">'+svgIcon('✕',{size:22})+'</button>'+
    '</div>'+
    '<div style="font-size:13px;color:var(--text3);margin-bottom:14px">'+subtitle+'</div>'+
    suggestHtml+
    '<div style="position:relative;margin-bottom:8px">'+
      '<input id="qp-search" data-qpaction="'+actionType+'" placeholder="Search by name, phone, or address..." oninput="onQPSearch(this)"'+
        ' style="width:100%;box-sizing:border-box;padding:11px 14px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);font-size:14px;color:var(--text);font-family:inherit">'+
    '</div>'+
    '<div id="qp-results"></div>'+
    (allowNew?
      '<div id="qp-new-wrap" style="display:none;margin-top:6px">'+
        '<button data-qpaction="'+actionType+'" onclick="quickCreateClient(this.dataset.qpaction)" style="width:100%;padding:12px;border-radius:var(--r);border:2px dashed var(--border2);background:transparent;color:var(--blue);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">'+
          '+ New client'+
        '</button>'+
      '</div>':''
    );

  overlay.dataset.suggestions=JSON.stringify(suggestions);
  overlay.dataset.action=actionType;
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});
  setTimeout(()=>{const si=document.getElementById('qp-search');if(si)si.focus();},100);
}

function onQPSearch(el){
  if(!el)return;
  const actionType=el.dataset.qpaction||'';
  const q=(el.value||'').toLowerCase().trim();
  const res=document.getElementById('qp-results');
  const newWrap=document.getElementById('qp-new-wrap');
  if(!res)return;
  if(!q){
    res.innerHTML='';
    if(newWrap)newWrap.style.display='none';
    return;
  }
  const matches=clients.filter(c=>
    c.name.toLowerCase().includes(q)||
    (c.phone||'').includes(q)||
    (c.addr||'').toLowerCase().includes(q)
  ).slice(0,6);
  if(!matches.length){
    res.innerHTML='<div style="font-size:12px;color:var(--text3);text-align:center;padding:10px 0">No match found.</div>';
    if(newWrap)newWrap.style.display='block';
    return;
  }
  if(newWrap)newWrap.style.display='none';
  res.innerHTML=matches.map(c=>
    '<button data-cid="'+c.id+'" data-qpaction="'+actionType+'" onclick="pickQPClient(parseInt(this.dataset.cid),this.dataset.qpaction)" style="width:100%;text-align:left;padding:11px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);cursor:pointer;font-family:inherit;margin-bottom:6px;display:flex;align-items:center;gap:10px">'+
      '<div style="width:34px;height:34px;border-radius:50%;background:var(--blue-lt);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:var(--blue-dk);flex-shrink:0">'+initials(c.name)+'</div>'+
      '<div style="flex:1;min-width:0">'+
        '<div style="font-size:13px;font-weight:700;color:var(--text)">'+escHtml(c.name)+'</div>'+
        '<div style="font-size:11px;color:var(--text3)">'+escHtml((c.addr||'').split(',')[0]||'No address')+'</div>'+
      '</div>'+
    '</button>'
  ).join('');
}

function pickQuickClient(btn,actionType){
  if(!btn)return;
  const overlay=btn.closest('.zmodal-overlay');
  const suggestions=JSON.parse(overlay.dataset.suggestions||'[]');
  const idx=parseInt(btn.dataset.idx);
  const s=suggestions[idx];
  if(!s)return;
  overlay.remove();
  executeQuickAction(actionType,s.clientId,s.bidId||null,s.jobId||null);
}

function pickQPClient(cid,actionType){
  const overlay=document.querySelector('.zmodal-overlay');
  if(overlay)overlay.remove();
  const wonBid=bids.find(b=>b.client_id===cid&&b.status==='Closed Won');
  executeQuickAction(actionType,cid,wonBid?wonBid.id:null,null);
}

function executeQuickAction(actionType,clientId,bidId,jobId){
  window._fromDash=true;
  currentClientId=clientId;
  if(actionType==='drive'){
    closeTopModal();
    const c=getClientById(clientId);
    const tk=todayKey();
    const hasEst=jobs.some(j=>j.client_id===clientId&&j.eventType==='estimate'&&j.start===tk);
    const hasWon=bids.some(b=>b.client_id===clientId&&b.status==='Closed Won');
    const purpose=hasWon?'Job site':hasEst?'Estimate':'Estimate';
    openLogTripModal({clientId,toAddress:c?c.addr:'',purpose,clientName:c?c.name:''});
  } else if(actionType==='expense'){
    showQuickExpenseModal(clientId,bidId);
  } else if(actionType==='estimate'){
    closeTopModal();
    currentClientId=clientId;
    openEstimateForClient();
  } else if(actionType==='schedule'){
    closeTopModal();
    if(bidId){schedFromBid(bidId);}
    else{openClientDetail(clientId);}
  }
}
function showQuickExpenseModal(clientId,bidId){
  const c=getClientById(clientId);
  const bid=bidId?bids.find(b=>b.id===bidId):bids.find(b=>b.client_id===clientId&&b.status==='Closed Won');
  const overlay=document.createElement('div');
  overlay.className='zmodal-overlay';
  const box=document.createElement('div');
  box.className='zmodal';

  const clientBids=bids.filter(b=>b.client_id===clientId&&(b.status==='Closed Won'||b.status==='Pending'));

  box.innerHTML=
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">'+
      '<div style="font-size:17px;font-weight:800">Log Expense</div>'+
      '<button onclick="closeTopModal()" style="border:none;background:none;font-size:22px;cursor:pointer;color:var(--text3)">'+svgIcon('✕',{size:22})+'</button>'+
    '</div>'+
    '<div style="background:var(--blue-lt);border-radius:var(--r);padding:8px 12px;margin-bottom:14px;font-size:12px;font-weight:700;color:var(--blue-dk)">'+
      svgIcon('📌',{size:13})+' '+escHtml(c?c.name:'Client')+
    '</div>'+
    (clientBids.length>1?
      '<div class="f" style="margin-bottom:10px">'+
        '<label style="font-size:11px;font-weight:700;color:var(--text3)">Which job?</label>'+
        '<select id="qe-bid" style="font-size:13px;padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);width:100%;color:var(--text)">'+
          clientBids.map(b=>'<option value="'+b.id+'"'+(bid&&b.id===bid.id?' selected':'')+'>'+
            escHtml(b.client_name||c.name)+', '+fmt(b.amount)+(b.status==='Pending'?' (pending)':'')+
          '</option>').join('')+
        '</select>'+
      '</div>':
      '<input type="hidden" id="qe-bid" value="'+(bid?bid.id:'')+'">'+
    '')+
    '<div class="f" style="margin-bottom:10px">'+
      '<label style="font-size:11px;font-weight:700;color:var(--text3)">Vendor / store <span style="color:#A32D2D">*</span></label>'+
      '<input id="qe-vendor" placeholder="Sherwin-Williams, Home Depot..." style="font-size:15px;padding:11px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);width:100%;box-sizing:border-box;color:var(--text);font-family:inherit">'+
    '</div>'+
    '<div class="f" style="margin-bottom:10px">'+
      '<label style="font-size:11px;font-weight:700;color:var(--text3)">Amount <span style="color:#A32D2D">*</span></label>'+
      '<input type="text" id="qe-amount" placeholder="0.00" inputmode="decimal" oninput="_fmtMoneyInput(this)" style="font-size:26px;font-weight:800;padding:12px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);width:100%;box-sizing:border-box;color:var(--text);font-family:inherit;text-align:center">'+
    '</div>'+
    '<div class="f" style="margin-bottom:14px">'+
      '<label style="font-size:11px;font-weight:700;color:var(--text3)">Category</label>'+
      '<select id="qe-cat" onchange="var w=document.getElementById(\'qe-vehicle-wrap\');if(w)w.style.display=this.value.indexOf(\'Vehicle\')===0?\'block\':\'none\'" style="font-size:13px;padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);width:100%;color:var(--text)">'+
        ['Paint & supplies','Tools & equipment','Vehicle (fuel)','Vehicle (maintenance)',
         'Subcontractors','Insurance','Marketing','Phone/internet','Uniforms/PPE',
         'Licensing & permits','Professional services','Meals (business)','Other']
          .map(c=>'<option>'+c+'</option>').join('')+
      '</select>'+
    '</div>'+
    ((typeof getVehicles==='function'?getVehicles():[]).length?
    '<div class="f" id="qe-vehicle-wrap" style="margin-bottom:14px;display:none">'+
      '<label style="font-size:11px;font-weight:700;color:var(--text3)">Which vehicle?</label>'+
      '<select id="qe-vehicle" style="font-size:13px;padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);width:100%;color:var(--text)">'+
        getVehicles().map(v=>'<option value="'+escHtml(v.name)+'">'+escHtml(v.nickname||v.name)+'</option>').join('')+
      '</select>'+
    '</div>':'')+
    '<div style="display:flex;gap:8px;margin-bottom:14px">'+
      '<div style="flex:1">'+
        '<label style="font-size:11px;font-weight:700;color:var(--text3);display:block;margin-bottom:4px">Date</label>'+
        '<input type="date" id="qe-date" value="'+todayKey()+'" style="font-size:14px;padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);width:100%;box-sizing:border-box;color:var(--text)">'+
      '</div>'+
    '</div>'+
    '<button onclick="saveQuickExpense('+clientId+')" style="width:100%;padding:14px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit">Save expense</button>';

  overlay.appendChild(box);
  document.body.appendChild(overlay);
  overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});
  setTimeout(()=>{const vi=document.getElementById('qe-vendor');if(vi)vi.focus();},100);
}

function saveQuickExpense(clientId){
  const vendor=(document.getElementById('qe-vendor').value||'').trim();
  const amount=_moneyVal('qe-amount');
  if(!vendor){zAlert('Enter a vendor.',{title:'Required'});document.getElementById('qe-vendor').focus();return;}
  if(!amount){zAlert('Enter an amount.',{title:'Required'});document.getElementById('qe-amount').focus();return;}
  const bidEl=document.getElementById('qe-bid');
  const bidId=bidEl?parseInt(bidEl.value)||null:null;
  const bid=bidId?bids.find(b=>b.id===bidId):null;
  const cat=document.getElementById('qe-cat').value||'Paint & supplies';
  const _qeDateEl=document.getElementById('qe-date');
  const _qeDateVal=_qeDateEl?_qeDateEl.value||todayKey():todayKey();
  const _qeVeh=document.getElementById('qe-vehicle');
  expenses.unshift({
    id:Date.now(),
    date:_qeDateVal,
    cat,
    vehicleName:(cat.indexOf('Vehicle')===0&&_qeVeh?_qeVeh.value:'')||undefined,
    vendor,
    amount,
    pay:'Business card',
    receipt:'No: need to get it',
    notes:'',
    client_id:clientId,
    job_id:bidId,
    job_name:bid?bid.client_name||'':''
  });
  expenses.sort((a,b)=>(a.date||'9').localeCompare(b.date||'9'));
  saveAll();
  const overlay=document.querySelector('.zmodal-overlay');
  if(overlay)overlay.remove();
  showToast(vendor+', '+fmt(amount)+' logged '+svgIcon('✓'),'💰');
  renderDash();
  goPg('pg-dash');
  window.scrollTo({top:0,left:0,behavior:'instant'});
}

function quickCreateClient(actionType){
  const overlay=document.querySelector('.zmodal-overlay');
  if(overlay)overlay.remove();
  window._pendingQuickAction=actionType;
  goPg('pg-clients');
  openNewClient();
  setTimeout(()=>{
    const form=document.getElementById('client-form-wrap');
    if(form){
      const note=document.createElement('div');
      note.className='tip';
      note.style.marginBottom='10px';
      note.textContent='Fill in their info and save, you\'ll be taken right back to continue.';
      form.insertBefore(note,form.firstChild);
    }
  },100);
}

const _origSaveClient=saveClient;
saveClient=function(){
  _origSaveClient();
  if(window._pendingQuickAction&&currentClientId){
    const action=window._pendingQuickAction;
    window._pendingQuickAction=null;
    setTimeout(()=>executeQuickAction(action,currentClientId,null,null),200);
  }
};
function closeCalDay(){const el=document.getElementById('cal-day-detail');if(el)el.style.display='none';}
function renderCalConflicts(){
  const paintJobs=jobs.filter(j=>j.eventType!=='estimate');
  const conflicts=[];
  for(let i=0;i<paintJobs.length;i++){
    for(let j=i+1;j<paintJobs.length;j++){
      const a=paintJobs[i],b=paintJobs[j];
      const ad=new Set(),bd=[];
      for(let k=0;k<(parseInt(a.days)||1);k++)ad.add(addDays(a.start,k));
      for(let k=0;k<(parseInt(b.days)||1);k++)bd.push(addDays(b.start,k));
      const ov=bd.filter(d=>ad.has(d));
      if(ov.length)conflicts.push('"'+escHtml(a.name)+'" and "'+escHtml(b.name)+'" overlap on '+ov.length+' day'+(ov.length>1?'s':''));
    }
  }
  const el=document.getElementById('cal-conflicts');
  if(el)el.innerHTML=conflicts.map(c=>'<div class="tip tip-d" style="margin-bottom:6px">Scheduling conflict: '+c+'</div>').join('');
}
function renderCalWeek(){const t=new Date(),dow=t.getDay(),DNAMES=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],tk=todayKey();const days=[];for(let i=0;i<7;i++){const d=new Date(t);d.setDate(t.getDate()-dow+i);days.push(d);}document.getElementById('cal-week').innerHTML=days.map((d,i)=>{const key=dateKey(d),dj=getJobsOnDay(key).filter(x=>!x.isBuf),isToday=key===tk;return`<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border)"><div style="width:30px;text-align:center;flex-shrink:0"><div style="font-size:10px;font-weight:700;text-transform:uppercase;color:${isToday?'var(--blue)':'var(--text3)'}">${DNAMES[i]}</div><div style="font-size:13px;font-weight:${isToday?'700':'400'};color:${isToday?'var(--blue)':'var(--text2)'}">${d.getDate()}</div></div><div style="flex:1;min-width:0">${dj.length?dj.map(({job})=>`<div style="font-size:10px;padding:2px 5px;border-radius:3px;background:${job.color};color:#fff;margin-bottom:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(job.name)}</div>`).join(''):'<div style="font-size:11px;color:var(--text3)">Open</div>'}</div></div>`;}).join('');}
function renderCalUpcoming(){const tk=todayKey(),upcoming=[...jobs].filter(j=>addDays(j.start,(parseInt(j.days)||1)-1)>=tk).sort((a,b)=>a.start.localeCompare(b.start)).slice(0,6);document.getElementById('cal-upcoming').innerHTML=!upcoming.length?'<div class="empty">No upcoming jobs.</div>':upcoming.map(j=>{const isA=j.start<=tk;return`<div style="display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--border)"><div style="width:8px;height:8px;border-radius:2px;background:${j.color};flex-shrink:0;margin-top:3px"></div><div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(j.name)}</div><div style="font-size:10px;color:var(--text3)">${parseD(j.start).toLocaleDateString('en-US',{month:'short',day:'numeric'})} · ${j.days}d${j.value?' · '+fmt(j.value):''}</div></div><span class="bdg ${isA?'bdg-active':'bdg-upcoming'}">${isA?'Active':'Soon'}</span></div>`;}).join('');}

function populateSchedSelect(){
  const cSel=document.getElementById('s-client-sel');
  if(cSel)cSel.innerHTML='<option value="">- Select a client -</option>'+clients.map(c=>'<option value="'+c.id+'">'+escHtml(c.name)+'</option>').join('');
  const scheduledIds=new Set(jobs.filter(j=>j.bid_id).map(j=>j.bid_id));
  const won=bids.filter(b=>b.status==='Closed Won');
  const bSel=document.getElementById('s-bid-sel');
  if(bSel)bSel.innerHTML='<option value="">- Select a won bid -</option>'+won.map(b=>'<option value="'+b.id+'"'+(scheduledIds.has(b.id)?' disabled':'')+'>'+escHtml(b.client_name||b.name)+', '+fmt(b.amount)+(scheduledIds.has(b.id)?' (scheduled)':'')+' </option>').join('');
  const crewSel=document.getElementById('s-crew-sel');
  if(crewSel){
    const emps=(S.employees||[]).filter(e=>e.name);
    crewSel.innerHTML='<option value="">Unassigned (I\'ll do it)</option>'+emps.map(e=>'<option value="'+e.id+'">'+escHtml(e.name)+'</option>').join('');
  }
}

function setSchedType(type,btn){
  schedType=type;
  const isEst=type==='estimate';
  document.querySelectorAll('#pg-schedule .sf-seg .sf-seg-btn').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  else{const t=document.getElementById(isEst?'sched-tab-est':'sched-tab-job');if(t)t.classList.add('active');}
  // These are .sf-row flex rows now, toggle with '' (revert to CSS flex), not
  // 'block', or the leading icon + body would stack instead of sitting inline.
  const estF=document.getElementById('sched-est-fields');if(estF)estF.style.display=isEst?'':'none';
  const jobF=document.getElementById('sched-job-fields');if(jobF)jobF.style.display=isEst?'none':'';
  const valRow=document.getElementById('s-value-row');if(valRow)valRow.style.display=isEst?'none':'';
  // Time now applies to jobs too (owner spec 2026-07-18: every job gets real
  // start-time granularity, not just estimates), same input either way, just
  // the label and default differ, estimates default to a real time + the
  // past-now bump (validateEstimateTime), jobs start blank/optional.
  const timeLbl=document.getElementById('s-time-label');
  if(timeLbl)timeLbl.innerHTML=isEst?'Estimate visits':'Start time <span style="font-weight:600">(optional)</span>';
  const timeInput=document.getElementById('s-time');if(timeInput)timeInput.value=isEst?'09:00':'';
  // Crew picker shows in BOTH estimate and job mode once a second person
  // exists (an estimate visit is still someone's appointment). It's ONE shared
  // field (owner spec 2026-07-18): the crew you pick in either mode carries
  // straight to the other, so it's deliberately NOT reset on a mode switch.
  // A solo account (no employees) never sees the row, zero added taps.
  const crewRow=document.getElementById('s-crew-row');
  if(crewRow)crewRow.style.display=(typeof S!=='undefined'&&Array.isArray(S.employees)&&S.employees.length)?'':'none';
  selectedColor=isEst?'#7F77DD':'#185FA5';
  const tip=document.getElementById('sched-tip');
  if(tip){tip.innerHTML=isEst?'Pick a client, date and time. <strong>Evenings (after 5pm) and weekends</strong> are always open, they never block your paint days.':'Pull from a won bid and pick a start date.';tip.className=isEst?'tip':'tip tip-s';}
  const days=document.getElementById('s-days');if(days)days.value=isEst?1:2;
  const buf=document.getElementById('s-buf');if(buf)buf.value=isEst?'0':'1';
  const daysRow=document.getElementById('s-dur-days-row');
  const hoursRow=document.getElementById('s-dur-hours-row');
  const bufRow=document.getElementById('s-buf-row');
  if(daysRow)daysRow.style.display=isEst?'none':'';
  if(hoursRow)hoursRow.style.display=isEst?'':'none';
  if(bufRow)bufRow.style.display=isEst?'none':'';
  ['s-name','s-addr','s-start','s-notes'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const sv=document.getElementById('s-value');if(sv)sv.value='';
  const addrRow=document.getElementById('s-addr-row');if(addrRow)addrRow.style.display='';
  if(typeof _schedSiteNote==='function')_schedSiteNote(null);
  document.getElementById('sched-preview').style.display='none';
  refreshAvail();
}

// Surface the client's internal Site access note (gate code, dog, parking)
// read-only in the scheduler, the note captured at the estimate flows here so
// whoever schedules sees it. Hidden when the client has none.
function _schedSiteNote(clientId){
  const el=document.getElementById('s-sitenote'),row=document.getElementById('s-sitenote-row');
  if(!el||!row)return;
  const c=clientId!=null?getClientById(clientId):null;
  // Key by the address currently in the scheduler (bid/client addr), so the note
  // shown is the one for THIS property, not a sibling property of the same client.
  const _sa=document.getElementById('s-addr');
  const sn=(c?getSiteNote(c,(_sa&&_sa.value)||c.addr):'').trim();
  el.textContent=sn;row.style.display=sn?'':'none';
}
function pullClient(){
  const cid=parseInt(v('s-client-sel'));if(!cid)return;
  const c=getClientById(cid);if(!c)return;
  document.getElementById('s-name').value=c.name+', estimate';
  document.getElementById('s-addr').value=c.addr||'';
  _schedSiteNote(cid);
  document.getElementById('s-days').value=1;
  const na=getNextAvail();
  document.getElementById('s-start').value=na.key;
  setTimeout(validateEstimateTime,50);
  availYear=parseD(na.key).getFullYear();availMonth=parseD(na.key).getMonth();
  refreshAvail();updateSchedPreview();
}
function pullBid(){const id=parseInt(v('s-bid-sel'));if(!id)return;const b=bids.find(x=>x.id===id);if(!b)return;document.getElementById('s-name').value=(b.client_name||b.name)+(b.type?', '+b.type:'');document.getElementById('s-addr').value=b.addr||'';document.getElementById('s-value').value=b.amount||'';
  // Owner spec 2026-07-18: ADDRESS always stays visible after a bid is pulled,
  // it's the field that confirms you grabbed the right job (two bids for
  // similar client names are easy to mix up), and it's load-bearing for
  // geofence arrival matching + GC-sub job linking, so seeing it is the point.
  // Job VALUE, on the other hand, isn't a disambiguator and re-typing it here
  // isn't how a price change happens (that's a change order), so it stays
  // hidden when the bid already carries it and only reappears if the bid has
  // no amount, so a genuinely-missing value can still be entered.
  const addrRow=document.getElementById('s-addr-row');if(addrRow)addrRow.style.display='';
  const valRow=document.getElementById('s-value-row');if(valRow)valRow.style.display=(b.amount>0)?'none':'';
  _schedSiteNote(b.client_id);
  document.getElementById('s-notes').value=b.notes||'';document.getElementById('sched-tip').innerHTML='<strong>Pulled from the won bid below.</strong> Pick an available start date.';document.getElementById('sched-tip').className='tip tip-s';const na=getNextAvail();document.getElementById('s-start').value=na.key;availYear=parseD(na.key).getFullYear();availMonth=parseD(na.key).getMonth();refreshAvail();updateSchedPreview();}
function avPrev(){
  const nowY=new Date().getFullYear(),nowM=new Date().getMonth();
  if(availYear===nowY&&availMonth===nowM)return; // already at current month
  availMonth--;
  if(availMonth<0){availMonth=11;availYear--;}
  refreshAvail();
}
function avNext(){availMonth++;if(availMonth>11){availMonth=0;availYear++;}refreshAvail();}
function onStartChange(){const sv=v('s-start');if(sv){availYear=parseD(sv).getFullYear();availMonth=parseD(sv).getMonth();}refreshAvail();updateSchedPreview();}
async function refreshAvail(){
  const M=['January','February','March','April','May','June','July','August','September','October','November','December'];
  document.getElementById('avail-month-lbl').textContent=M[availMonth]+' '+availYear;
  // Crew-scoped once a second person exists to assign work to (owner spec
  // 2026-07-18): each crew has its own availability, a solo account (no
  // S.employees) always sees the original account-wide getBookedDays().
  const _hasCrew=(typeof S!=='undefined'&&Array.isArray(S.employees)&&S.employees.length&&typeof getBookedDaysForCrew==='function');
  const{booked,buf}=_hasCrew?getBookedDaysForCrew(v('s-crew-sel')||null):getBookedDays(),selected=v('s-start'),days=parseInt(v('s-days'))||1,b=parseInt(v('s-buf'))||0,today=todayKey();
  const timeOffDays=getTimeOffDays();
  const _schedBidId=parseInt(v('s-bid-sel'))||null;
  const _schedBid=_schedBidId?bids.find(b=>b.id===_schedBidId):null;
  const _hasPwash=schedType==='job'&&_schedBid?.scope?.pwash===true;
  const allowWknd=document.getElementById('s-allow-weekend')?.checked||false;

  // Build workday-aware end date, skip weekends unless allowed
  function calcWorkEnd(startKey, numDays) {
    if(!startKey) return null;
    let count=0, cur=startKey;
    while(count < numDays) {
      const dow=parseD(cur).getDay();
      if(allowWknd || (dow!==0 && dow!==6)) count++;
      if(count < numDays) cur=addDays(cur,1);
    }
    // Add buffer (buffer days are calendar days after end)
    return b>0 ? {workEnd:cur, bufEnd:addDays(cur,b)} : {workEnd:cur, bufEnd:cur};
  }

  const endCalc=selected?calcWorkEnd(selected,days):null;
  const selEnd=endCalc?.workEnd||null;
  const selBufEnd=endCalc?.bufEnd||null;

  // Build set of all highlighted workdays in the selection
  const selDays=new Set();
  if(selected&&selEnd){
    let cur=selected;
    while(cur<=selBufEnd){
      const dow=parseD(cur).getDay();
      if(allowWknd||(dow!==0&&dow!==6)) selDays.add(cur);
      cur=addDays(cur,1);
    }
  }

  const first=new Date(availYear,availMonth,1),last=new Date(availYear,availMonth+1,0),dow=first.getDay();
  const cells=[];
  for(let i=0;i<dow;i++){const d=new Date(availYear,availMonth,1-dow+i);cells.push({key:dateKey(d),other:true});}
  for(let i=1;i<=last.getDate();i++)cells.push({key:dateKey(new Date(availYear,availMonth,i)),other:false});
  while(cells.length%7!==0){const l=cells[cells.length-1];cells.push({key:addDays(l.key,1),other:true});}
  const weather=await fetchWeather()||{};
  document.getElementById('avail-grid').innerHTML=cells.map(({key,other})=>{
    if(other)return'<div class="av-d av-other">'+parseInt(key.split('-')[2])+'</div>';
    const isPast=key<today,isTaken=booked.has(key),isBuf=buf.has(key)&&!selDays.has(key);
    const isSel=selDays.has(key),isStart=key===selected;
    const dayDow=parseD(key).getDay();
    const isWeekend=dayDow===0||dayDow===6;
    const isWorkday=!isWeekend||(allowWknd);
    const wx=weather[key];
    // Owner feedback 2026-07-17: a weather icon + temperature on EVERY day was
    // pure noise, the only weather fact that actually matters for scheduling a
    // paint day is "is rain a risk." Show nothing on clear days, a single rain
    // icon (temp tucked into the tooltip) only when it actually might rain.
    const wxHtml=(wx&&wx.rain)?'<div style="font-size:11px;line-height:1;margin-top:1px" title="'+(wx.label||'Rain')+', '+wx.hi+'°">'+wx.icon+'</div>':'';
    const isRainBlocked=_hasPwash&&wx&&wx.rain;
    const dayNum=parseInt(key.split('-')[2]);
    if(isPast)return'<div class="av-d av-past">'+dayNum+'</div>';
    // Weekends grayed when not allowed, never blue, never selectable
    if(isWeekend&&!allowWknd)return'<div class="av-d av-past">'+dayNum+'</div>';
    if(timeOffDays.has(key))return'<div class="av-d" style="background:#FDE68A;color:#92400E;font-weight:700;cursor:not-allowed" title="Time off">'+dayNum+'<br><span style="font-size:11px">'+svgIcon('🏖',{size:11})+'</span></div>';
    if(schedType==='estimate'){
      if(isSel)return'<div class="av-d av-sel" onclick="pickDay(\''+key+'\')">'+dayNum+(isStart?'<br><span style="font-size:9px">start</span>':'')+wxHtml+'</div>';
      return'<div class="av-d av-open" onclick="pickDay(\''+key+'\')">'+dayNum+wxHtml+'</div>';
    }
    if(isTaken)return'<div class="av-d av-taken">'+dayNum+wxHtml+'</div>';
    if(isBuf)return'<div class="av-d av-buf">'+dayNum+wxHtml+'</div>';
    if(isRainBlocked)return'<div class="av-d av-taken" title="Rain forecast, pressure wash blocked" style="background:#FEE8E8;cursor:not-allowed">'+dayNum+wxHtml+'</div>';
    if(isSel)return'<div class="av-d av-sel" onclick="pickDay(\''+key+'\')">'+dayNum+(isStart?'<br><span style="font-size:9px">start</span>':'')+wxHtml+'</div>';
    return'<div class="av-d av-open" onclick="pickDay(\''+key+'\')">'+dayNum+wxHtml+'</div>';
  }).join('');
}
function pickDay(key){
  const _dow=parseD(key).getDay();
  if((_dow===0||_dow===6)&&!document.getElementById('s-allow-weekend')?.checked)return;
  document.getElementById('s-start').value=key;
  if(schedType==='estimate'&&key===todayKey()){
    const timeEl=document.getElementById('s-time');
    if(timeEl){
      const now=new Date();
      const nowMins=now.getHours()*60+now.getMinutes();
      const [h,m]=(timeEl.value||'09:00').split(':').map(Number);
      const selMins=h*60+m;
      if(selMins<=nowMins){
        const bump=new Date(now.getTime()+90*60000);
        const bh=String(bump.getHours()).padStart(2,'0');
        const bm=String(bump.getMinutes()<30?'00':'30');
        timeEl.value=bh+':'+bm;
      }
    }
  }
  refreshAvail();updateSchedPreview();
}

function validateEstimateTime(){
  const start=v('s-start');
  if(!start||start!==todayKey())return;
  const timeEl=document.getElementById('s-time');if(!timeEl)return;
  const now=new Date();
  const nowMins=now.getHours()*60+now.getMinutes();
  const [h,m]=(timeEl.value||'09:00').split(':').map(Number);
  if(h*60+m<=nowMins){
    const bump=new Date(now.getTime()+90*60000);
    const bh=String(bump.getHours()).padStart(2,'0');
    const bm=bump.getMinutes()<30?'00':'30';
    timeEl.value=bh+':'+bm;
    timeEl.style.borderColor='var(--amber)';
    setTimeout(()=>timeEl.style.borderColor='',2000);
  }
}
function updateSchedPreview(){const start=v('s-start'),days=parseInt(v('s-days'))||1,buf=parseInt(v('s-buf'))||0;const el=document.getElementById('sched-preview');if(!start){el.style.display='none';return;}const sf=parseD(start).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});const ef=parseD(addDays(start,days-1)).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});el.style.display='block';el.innerHTML=`<div style="display:flex;flex-wrap:wrap;gap:12px"><span><span style="color:var(--text2)">Start:</span> <strong>${sf}</strong></span><span><span style="color:var(--text2)">Finish:</span> <strong>${ef}</strong></span><span><span style="color:var(--text2)">Duration:</span> <strong>${days} day${days>1?'s':''}</strong></span>${buf>0?`<span><span style="color:var(--text2)">Buffer ends:</span> <strong>${parseD(addDays(start,days+buf-1)).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</strong></span>`:''}</div>`;}
function _schedErr(msg,focusId){
  const e=document.getElementById('sched-err');
  if(e){e.textContent=msg;e.style.display='block';e.scrollIntoView&&e.scrollIntoView({behavior:'smooth',block:'nearest'});}
  if(focusId){const f=document.getElementById(focusId);if(f){f.style.borderColor='#A32D2D';f.focus();}}
}
function scheduleJob(){
  if(_submitting)return;
  const errEl=document.getElementById('sched-err');if(errEl)errEl.style.display='none';
  ['s-name','s-start','s-bid-sel'].forEach(id=>{const f=document.getElementById(id);if(f)f.style.borderColor='';});
  // Blacklist gate
  const _sched_bid=parseInt(v('s-bid-sel'))||null;
  const _sched_b=_sched_bid?bids.find(b=>b.id===_sched_bid):null;
  if(_sched_b&&getClientRisk(_sched_b.client_id)==='blacklisted'){
    _schedErr('This client is blacklisted. Scheduling is blocked.');return;
  }
  const name=v('s-name').trim();if(!name){_schedErr('Enter a job name.','s-name');return;}
  const start=v('s-start');if(!start){_schedErr('Pick a start date.','s-start');return;}
  const days=parseInt(v('s-days'))||1;
  const _crewId=v('s-crew-sel')||null;
  const _hasCrew=(typeof S!=='undefined'&&Array.isArray(S.employees)&&S.employees.length&&typeof getBookedDaysForCrew==='function');
  const{booked}=_hasCrew?getBookedDaysForCrew(_crewId):getBookedDays();for(let i=0;i<days;i++){if(booked.has(addDays(start,i))){_schedErr(_hasCrew?'This crew already has a job on one or more of those days, pick a different start date or crew.':'One or more days already booked, pick a different start date.','s-start');return;}}
  const bidId=parseInt(v('s-bid-sel'))||null,bid=bidId?bids.find(b=>b.id===bidId):null;
  if(bid&&bid.status==='Pending'){_schedErr('The estimate must be signed (Closed Won) before scheduling.','s-bid-sel');return;}
  // Rain block: pressure wash can't start on a rainy day
  if(schedType==='job'&&bid&&bid.scope&&bid.scope.pwash){
    const wx=_weatherCache&&_weatherCache[start];
    if(wx&&wx.rain){_schedErr('Rain in the forecast for '+start+'. Pressure washing needs dry conditions, pick a clear day.','s-start');return;}
  }
  // Duplicate guard: same bid already has a job scheduled
  if(bidId&&jobs.some(j=>j.bid_id===bidId&&j.eventType==='job'&&j.status!=='canceled')){
    _schedErr('This job is already scheduled. Edit or cancel the existing one first.','s-bid-sel');return;}
  _submitting=true;setTimeout(()=>{_submitting=false;},1500);
  const clientId=schedType==='estimate'?(parseInt(v('s-client-sel'))||null):(bid?bid.client_id:null);
  const jobValue=schedType==='estimate'?0:(parseFloat(v('s-value'))||0);
  const jobTime=schedType==='estimate'?(v('s-time')||'09:00'):(v('s-time')||'');
  const jobHours=schedType==='estimate'?parseFloat(v('s-hours')||'2'):null;
  // Crew assignment applies to estimates too now (whoever does the visit), not
  // just jobs, so geofence/time-on-site tracking covers the walkthrough as well.
  const _asgnTo=_crewId||null;
  jobs.push({id:Date.now(),bid_id:bidId,client_id:clientId,name,addr:v('s-addr'),start,days,buffer:parseInt(v('s-buf'))||0,value:jobValue,color:selectedColor,eventType:schedType,time:jobTime,hours:jobHours,notes:v('s-notes'),status:'upcoming',assignedTo:_asgnTo,crewHistory:_asgnTo?[_asgnTo]:[]});
  if(schedType==='estimate'&&clientId){
    const pendingBid=bids.find(b=>b.client_id===clientId&&b.status==='Pending'&&!b.followup);
    if(pendingBid)pendingBid.followup=addDays(start,3);
    if(jobs.length)jobs[jobs.length-1].followup=addDays(start,3);
  }
  saveAll();
  resetSched();renderDash();
  if(schedType==='estimate'&&clientId){openClientDetail(clientId);}else{goPg('pg-cal');}
}
function resetSched(){
  ['s-name','s-addr','s-start','s-notes'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const sv=document.getElementById('s-value');if(sv)sv.value='';
  const sd=document.getElementById('s-days');if(sd)sd.value=schedType==='estimate'?1:2;
  const st=document.getElementById('s-time');if(st)st.value=schedType==='estimate'?'09:00':'';
  const sh=document.getElementById('s-hours');if(sh)sh.value='2';
  const addrRow=document.getElementById('s-addr-row');if(addrRow)addrRow.style.display='';
  const valRow=document.getElementById('s-value-row');if(valRow)valRow.style.display=schedType==='estimate'?'none':'';
  const crewSel=document.getElementById('s-crew-sel');if(crewSel)crewSel.value='';
  if(typeof _schedSiteNote==='function')_schedSiteNote(null);
  document.getElementById('sched-preview').style.display='none';
  refreshAvail();
}

function setTrTab(tab,btn){
  trackerTab=tab;
  ['income','expenses','mileage','jobs','summary','hiring'].forEach(t=>{
    const el=document.getElementById('tr-'+t);if(el)el.style.display=t===tab?'block':'none';
    const tb=document.getElementById('tr-t-'+t);if(tb)tb.classList.toggle('active',t===tab);
  });
  if(tab==='income')renderIncome();
  if(tab==='expenses')renderExpenses();
  if(tab==='mileage')renderAllMileage();
  if(tab==='jobs')renderJobsHistory();
  if(tab==='summary'){renderSummary();renderJobSummary();renderMonthlyPL();}
  if(tab==='hiring')renderHiringCalc();
}
function getTrackerYears(){
  const allDates=[
    ...income.map(r=>r.date),
    ...expenses.map(e=>e.date),
    ...mileage.map(m=>m.date)
  ].filter(Boolean);
  const years=[...new Set(allDates.map(d=>parseInt(d.substring(0,4))).filter(y=>y>2000))].sort((a,b)=>b-a);
  if(!years.length)years.push(new Date().getFullYear());
  return years;
}
let _trackerYearManual=false;
function populateTrackerYearSel(){
  const sel=document.getElementById('tracker-year-sel');
  if(!sel)return;
  const years=getTrackerYears();
  const cur=trackerYear||new Date().getFullYear();
  const selYear=years.includes(cur)?cur:(years[0]||cur);
  trackerYear=selYear;
  sel.innerHTML=years.map(y=>'<option value="'+y+'"'+(y===selYear?' selected':'')+'>'+y+'</option>').join('');
}
function setTrackerYear(yr){
  _trackerYearManual=true;
  trackerYear=yr;
  renderTrackerTab();
}
function renderTrackerTab(){
  populateTrackerYearSel();
  setTrTab(trackerTab,document.getElementById('tr-t-'+trackerTab));
  // Live pipe: opening Books checks for freshly-landed payments/jobs from
  // linked contractors (debounced inside; re-renders this tab if any land).
  if(typeof _ingestPipeInbox==='function')_ingestPipeInbox();
}
function renderMonthlyPL(){
  const el=document.getElementById('monthly-pl-list');if(!el)return;
  const months={};
  const addMonth=(key,type,amount)=>{
    if(!months[key])months[key]={inc:0,exp:0,miles:0};
    months[key][type]+=amount;
  };
  // Normalize date to YYYY-MM regardless of whether stored as YYYYMMDD or YYYY-MM-DD
  const mKey=d=>{if(!d)return'';const c=d.replace(/-/g,'');return c.slice(0,4)+'-'+c.slice(4,6);};
  income.forEach(r=>{if(r.date)addMonth(mKey(r.date),'inc',r.amount);});
  payments.filter(p=>p.amount!==0&&p.date).forEach(p=>{addMonth(mKey(p.date),'inc',p.amount);});
  expenses.forEach(r=>{if(r.date)addMonth(mKey(r.date),'exp',r.amount);});
  mileage.forEach(r=>{if(r.date)addMonth(mKey(r.date),'miles',r.miles||0);});

  const keys=Object.keys(months).sort().reverse();
  if(!keys.length){el.innerHTML='<div class="empty">No data yet, log income and expenses to see monthly P&L.</div>';return;}

  let html='<div style="display:grid;grid-template-columns:auto 1fr 1fr 1fr;gap:4px 10px;font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text3);padding-bottom:6px;border-bottom:1px solid var(--border);margin-bottom:6px">'+
    '<span>Month</span><span style="text-align:right">Revenue</span><span style="text-align:right">Expenses</span><span style="text-align:right">Net</span></div>';

  let totalInc=0,totalExp=0,totalMiles=0;
  keys.forEach(k=>{
    const m=months[k];
    const net=m.inc-m.exp;
    totalInc+=m.inc;totalExp+=m.exp;totalMiles+=m.miles;
    const [yr,mo]=k.split('-');
    const label=new Date(parseInt(yr),parseInt(mo)-1,1).toLocaleDateString('en-US',{month:'short',year:'numeric'});
    html+='<div style="display:grid;grid-template-columns:auto 1fr 1fr 1fr;gap:4px 10px;padding:7px 0;border-bottom:1px solid var(--border);font-size:12px;align-items:center">'+
      '<span style="font-weight:600">'+label+'</span>'+
      '<span style="text-align:right;color:var(--green-mid);font-weight:700">'+fmt(m.inc)+'</span>'+
      '<span style="text-align:right;color:#A32D2D">('+fmt(m.exp)+')</span>'+
      '<span style="text-align:right;font-weight:700;color:'+(net>=0?'var(--green-mid)':'#A32D2D')+'">'+fmt(net)+'</span>'+
    '</div>';
  });

  // renderMonthlyPL is an ALL-TIME (multi-year) view, totalMiles sums every year's
  // trips. Pairing it with the YEAR-scoped _vehSchedC(trackerYear).mileDed mismatched
  // the figures and showed $0 when trackerYear==='all'. Use the all-time miles × rate
  // here so the deduction matches the miles shown; the authoritative per-year deduction
  // (with method exclusivity) lives in calcTax / exportTaxPDF, unaffected by this line.
  const totalMileDed=totalMiles*IRS();
  const grandNet=totalInc-totalExp;
  html+='<div style="display:grid;grid-template-columns:auto 1fr 1fr 1fr;gap:4px 10px;padding:8px 0;font-size:13px;font-weight:700;border-top:2px solid var(--border);margin-top:4px">'+
    '<span>Total</span>'+
    '<span style="text-align:right;color:var(--green-mid)">'+fmt(totalInc)+'</span>'+
    '<span style="text-align:right;color:#A32D2D">('+fmt(totalExp)+')</span>'+
    '<span style="text-align:right;color:'+(grandNet>=0?'var(--green-mid)':'#A32D2D')+'">'+fmt(grandNet)+'</span>'+
  '</div>'+
  (totalMiles>0?'<div style="font-size:10px;color:var(--text3);margin-top:8px;padding-top:6px;border-top:1px solid var(--border)">'+totalMiles.toFixed(0)+' mi driven · '+fmt(totalMileDed)+' mileage tax deduction, reduces taxable income, not cash profit</div>':'');
  el.innerHTML=html;
}

// ── Add receipt photo to an existing expense ─────────────────────────
function addReceiptToExpense(expId){
  _showReceiptScanner(null,async blob=>{
    const exp=expenses.find(e=>e.id==expId);if(!exp)return;
    showToast('Attaching photo...','📎',2500);
    try{
      const b64=await compressAndEncodeImage(blob,900,0.75);
      try{
        const key=await _uploadReceiptToStorage(exp.id,b64);
        if(key){exp.receipt_key=key;exp.receipt_img=null;}
        else exp.receipt_img='data:image/jpeg;base64,'+b64;
      }catch(e){exp.receipt_img='data:image/jpeg;base64,'+b64;}
      exp.receipt='Yes: photo stored';
      if(typeof _flushSaveNow==='function')_flushSaveNow();else saveAll();
      renderExpenses();showToast('Receipt attached to '+exp.vendor,'📎');
    }catch(e){showToast('Could not attach photo','⚠️');}
  });
}

// ── Receipt viewer ────────────────────────────────────────────────────
async function viewReceipt(expId){
  const exp=expenses.find(e=>e.id==expId);
  const allKeys=exp?.receipt_keys?.length?exp.receipt_keys:(exp?.receipt_key?[exp.receipt_key]:[]);
  if(!allKeys.length&&!exp?.receipt_img)return zAlert('No receipt photo stored for this expense.',{title:'No photo'});
  const ov=document.createElement('div');
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px';
  ov.onclick=e=>{if(e.target===ov)ov.remove();};
  ov.className='rcpt-ov';
  ov.innerHTML='<div style="color:#fff;font-size:13px;opacity:.6">Loading…</div>';
  document.body.appendChild(ov);
  // Resolve all keys to URLs
  const srcs=[];
  if(allKeys.length){
    for(const k of allKeys){
      try{const u=await _getReceiptSignedUrl(k,300);if(u)srcs.push(u);}catch(e){}
    }
  }
  if(!srcs.length&&exp.receipt_img)srcs.push(exp.receipt_img);
  if(!srcs.length){ov.remove();return zAlert('Could not load receipt photo.',{title:'Error'});}
  let _pg=0;
  const fname=key=>'receipt_'+(exp.date||'')+'_'+(exp.vendor||'').replace(/[^a-z0-9]/gi,'_')+(srcs.length>1?'_p'+(srcs.indexOf(key)+1):'')+'.jpg';
  const render=()=>{
    const src=srcs[_pg];
    ov.innerHTML=
      (srcs.length>1?'<div style="color:#fff;font-size:12px;font-weight:700;margin-bottom:10px;opacity:.8">Page '+(_pg+1)+' of '+srcs.length+'</div>':'')+
      '<img src="'+src+'" style="max-width:100%;max-height:72vh;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.5)">'+
      '<div style="margin-top:12px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap">'+
        (srcs.length>1&&_pg>0?'<button onclick="_rcptPg(-1)" style="color:#fff;font-size:13px;font-weight:600;background:rgba(255,255,255,.15);border:none;padding:8px 14px;border-radius:8px;cursor:pointer;font-family:inherit">← Prev</button>':'')+
        (srcs.length>1&&_pg<srcs.length-1?'<button onclick="_rcptPg(1)" style="color:#fff;font-size:13px;font-weight:600;background:rgba(255,255,255,.15);border:none;padding:8px 14px;border-radius:8px;cursor:pointer;font-family:inherit">Next →</button>':'')+
        '<a href="'+src+'" download="'+fname(src)+'" style="color:#fff;font-size:13px;font-weight:600;text-decoration:none;background:rgba(255,255,255,.15);padding:8px 14px;border-radius:8px">⬇ Save</a>'+
        ''+
        '<button onclick="this.closest(\'.rcpt-ov\').remove()" style="color:#fff;font-size:13px;font-weight:600;background:rgba(255,255,255,.15);border:none;padding:8px 14px;border-radius:8px;cursor:pointer;font-family:inherit">✕ Close</button>'+
      '</div>';
  };
  window._rcptPg=(d)=>{_pg=Math.max(0,Math.min(srcs.length-1,_pg+d));render();};
  render();
}
function deleteReceiptPhoto(expId){
  zConfirm('Delete this receipt photo? The expense record stays intact, you can add a new photo anytime.',async()=>{
    const exp=expenses.find(e=>e.id==expId);
    if(!exp)return;
    const keysToDelete=[...(exp.receipt_keys||[]),exp.receipt_key].filter(Boolean);
    for(const k of keysToDelete){try{await _deleteReceiptFromStorage(k);}catch(e){}}
    exp.receipt_img=null;exp.receipt_key=null;exp.receipt_keys=undefined;exp.receipt=null;
    if(typeof _flushSaveNow==='function')_flushSaveNow();else saveAll();
    document.querySelector('.rcpt-ov')?.remove();
    renderExpenses();
    showToast('Receipt photo deleted','🗑️');
  },{title:'Delete photo?',yes:'Delete photo',danger:true});
}

// ── State-based tax & lien info ────────────────────────────────────────
async function fetchStateInfo(state){
  if(!state||!supaEnabled())return;
  const cacheKey='zp3_state_info_'+state;
  const cached=localStorage.getItem(cacheKey);
  if(cached){
    try{const p=JSON.parse(cached);if(p.ts&&Date.now()-p.ts<30*24*60*60*1000){S.stateInfo=p.data;return;}}catch(e){}
  }
  try{
    const session=await _supa.auth.getSession();
    const token=session?.data?.session?.access_token;
    const resp=await fetch('https://mwtsmctajhrrybblgorf.supabase.co/functions/v1/scan-receipt',{
      method:'POST',
      headers:{'Content-Type':'application/json',...(token?{'Authorization':'Bearer '+token}:{})},
      body:JSON.stringify({stateInfoQuery:true,state})
    });
    // Falls back gracefully if function doesn't handle this yet
  }catch(e){console.warn('fetchStateInfo:',e);}
}
// Owner spec 2026-07-17: Books exports (everything this panel offers, CSV/
// XLSX/PDF alike) stay locked until the contractor's TradeDesk subscription
// has completed 2 consecutive billing cycles, or the account is exempt.
// Gated at this single entry point so every export option behind it inherits
// the check, no per-format gap. _requireExportsUnlocked always re-checks
// live server-side (never the client's own say-so) and shows the reason.
async function openExportPanel(){
  if(typeof _requireExportsUnlocked==='function'&&!(await _requireExportsUnlocked()))return;
  const yr=trackerYear||S.taxYear||new Date().getFullYear();
  const years=[...new Set([
    ...expenses.map(e=>e.date?.slice(0,4)),
    ...income.map(i=>i.date?.slice(0,4)),
    ...mileage.map(m=>m.date?.slice(0,4))
  ].filter(Boolean))].sort();
  if(!years.includes(String(yr)))years.push(String(yr));
  years.sort();
  const ov=document.createElement('div');
  ov.id='export-panel';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9995;display:flex;align-items:center;justify-content:center;padding:20px;animation:fadein .15s';
  ov.innerHTML=
    '<div style="background:var(--bg);border-radius:16px;width:100%;max-width:560px;padding:24px 20px 28px;max-height:90vh;overflow-y:auto">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'+
        '<div style="font-size:18px;font-weight:800">Export records</div>'+
        '<button onclick="document.getElementById(\'export-panel\').remove()" style="border:none;background:none;font-size:24px;cursor:pointer;color:var(--text3)">×</button>'+
      '</div>'+
      '<div style="font-size:13px;color:var(--text3);margin-bottom:20px">Choose a year and format. All amounts in USD.</div>'+
      '<div style="margin-bottom:20px">'+
        '<label style="display:block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:6px">Tax year</label>'+
        '<select id="exp-panel-year" style="width:100%;font-size:15px;font-weight:700;padding:10px 14px;border-radius:var(--r);border:1.5px solid var(--border2);background:var(--bg);color:var(--text)">'+
          years.map(y=>'<option value="'+y+'"'+(String(y)===String(yr)?' selected':'')+'>'+y+'</option>').join('')+
          '<option value="all">All years</option>'+
        '</select>'+
      '</div>'+
      '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:10px">Choose format</div>'+
      exportOptionHTML('exportAllDataCSV()','📦','Everything: one CSV','Every client, lead, bid, job, payment, income, expense, mileage, and time entry in one file. Clients, leads, bids, jobs, payments, income, expenses, mileage, all labeled sections.')+
      exportOptionHTML('exportAllXLSX()','📊','Income · Expenses · Mileage, Excel','One workbook, three sheets. All years of income, expenses, and mileage, dollar columns formatted, SUM totals at the bottom of each sheet.')+
      exportOptionHTML('exportPLCSV()','📈','Profit & Loss CSV','Income vs expenses vs mileage deduction, net profit at the bottom. Hand straight to your accountant.')+
      exportOptionHTML('exportTaxPDF()','📄','Full tax report, PDF','Schedule C summary, income, expenses by IRS category, mileage log. Print or save, IRS audit ready.')+
      exportOptionHTML('exportFullBackup()','💾','Full data backup','All clients, jobs, bids, income, expenses, mileage. JSON: restore or migrate anytime.')+
      exportOptionHTML('exportReceiptImages()','📄','Receipt PDF','All receipt photos in one PDF, sorted by date with vendor, amount and category. Print or send to your CPA.')+
    '</div>';
  document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
}

function exportOptionHTML(onclick,icon,title,desc){
  return '<div style="border:1.5px solid var(--border2);border-radius:var(--rl);padding:16px;margin-bottom:10px;cursor:pointer;transition:border-color .15s" onclick="'+onclick+'" onmouseover="this.style.borderColor=\'var(--blue)\'" onmouseout="this.style.borderColor=\'var(--border2)\'">'+
    '<div style="display:flex;align-items:center;gap:12px">'+
      '<div style="font-size:28px;flex-shrink:0">'+svgIcon(icon,{size:28})+'</div>'+
      '<div style="flex:1">'+
        '<div style="font-size:14px;font-weight:700">'+title+'</div>'+
        '<div style="font-size:12px;color:var(--text3);margin-top:2px">'+desc+'</div>'+
      '</div>'+
      '<div style="font-size:11px;font-weight:700;color:var(--blue);flex-shrink:0">↓</div>'+
    '</div>'+
  '</div>';
}

function getExportYear(){return document.getElementById('exp-panel-year')?.value||String(trackerYear||new Date().getFullYear());}

function downloadFile(filename,content,type){
  const blob=new Blob([content],{type});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=filename;
  document.body.appendChild(a);a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);document.body.removeChild(a);},1000);
}
function downloadXLSX(filename,wb){
  const out=XLSX.write(wb,{bookType:'xlsx',type:'array'});
  downloadFile(filename,out,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}
function _xlsClean(s){
  return(s||'').replace(/[‘’ʼ]/g,"'").replace(/[“”]/g,'"').trim();
}
const _xS={
  hdr:{font:{bold:true,color:{rgb:'FFFFFF'},sz:11},fill:{patternType:'solid',fgColor:{rgb:'2D5DA8'}},alignment:{horizontal:'center',vertical:'center',wrapText:true}},
  left:{alignment:{horizontal:'left',vertical:'center',wrapText:true}},
  ctr:{alignment:{horizontal:'center',vertical:'center',wrapText:true}},
  cur:{numFmt:'$#,##0.00',alignment:{horizontal:'center',vertical:'center',wrapText:true}},
  mi:{numFmt:'#,##0.0',alignment:{horizontal:'center',vertical:'center',wrapText:true}},
  totLbl:{font:{bold:true},fill:{patternType:'solid',fgColor:{rgb:'F3F4F6'}},alignment:{horizontal:'left',vertical:'center',wrapText:true}},
  totBlk:{fill:{patternType:'solid',fgColor:{rgb:'F3F4F6'}},alignment:{horizontal:'center',vertical:'center',wrapText:true}},
  totCur:{font:{bold:true},numFmt:'$#,##0.00',fill:{patternType:'solid',fgColor:{rgb:'F3F4F6'}},alignment:{horizontal:'center',vertical:'center',wrapText:true}},
  totMi:{font:{bold:true},numFmt:'#,##0.0',fill:{patternType:'solid',fgColor:{rgb:'F3F4F6'}},alignment:{horizontal:'center',vertical:'center',wrapText:true}},
  yrLbl:{font:{bold:true,sz:11},fill:{patternType:'solid',fgColor:{rgb:'EEF2FF'}},alignment:{horizontal:'left',vertical:'center'}},
  yrBlk:{fill:{patternType:'solid',fgColor:{rgb:'EEF2FF'}},alignment:{horizontal:'left',vertical:'center'}},
};
function _xlsCell(r,c,v,s,t){return{[XLSX.utils.encode_cell({r,c})]:{v,t:t||(typeof v==='number'?'n':'s'),s}};}
function _xlsFCell(r,c,f,s){return{[XLSX.utils.encode_cell({r,c})]:{f,t:'n',s}};}
function _xlsBuildSheet(headers,colWidths,rows,totRow){
  const ws={};
  headers.forEach((h,c)=>{ws[XLSX.utils.encode_cell({r:0,c})]={v:h,t:'s',s:_xS.hdr};});
  rows.forEach((row,i)=>{row.forEach((cell,c)=>{ws[XLSX.utils.encode_cell({r:i+1,c})]={...cell};});});
  const last=rows.length;
  if(totRow){
    totRow.forEach((cell,c)=>{ws[XLSX.utils.encode_cell({r:last+1,c})]={...cell};});
  }
  ws['!ref']=XLSX.utils.encode_range({s:{r:0,c:0},e:{r:totRow?last+1:last,c:headers.length-1}});
  ws['!cols']=colWidths.map(w=>({wch:w}));
  return ws;
}

// Build a worksheet grouped by year with year-band headers and per-year subtotals.
// buildDataRow(item) → array of cell objects (same length as headers).
// sumCols: array of col indices that get summed (pre-calculated, not formula).
function _xlsByYear(headers,colWidths,items,getDate,buildDataRow,sumCols){
  const ws={};
  const nCols=headers.length;
  let ri=0;
  const cell=(r,c,v,s,t)=>{ws[XLSX.utils.encode_cell({r,c})]={v,t:t||(typeof v==='number'?'n':'s'),s};};

  // Column header row
  headers.forEach((h,c)=>cell(ri,c,h,'s',_xS.hdr));
  ri++;

  // Group by year, newest year first
  const byYear={};
  [...items].sort((a,b)=>(getDate(a)||'').localeCompare(getDate(b)||'')).forEach(it=>{
    const yr=(getDate(it)||'').slice(0,4)||'Unknown';
    (byYear[yr]=byYear[yr]||[]).push(it);
  });
  const years=Object.keys(byYear).sort((a,b)=>b.localeCompare(a));

  const grandTots=sumCols.map(()=>0);

  years.forEach(yr=>{
    const group=byYear[yr];
    // Year band
    cell(ri,0,yr,'s',_xS.yrLbl);
    for(let c=1;c<nCols;c++)cell(ri,c,'','s',_xS.yrBlk);
    ri++;

    // Data rows
    group.forEach(it=>{
      const row=buildDataRow(it);
      row.forEach((celObj,c)=>{ ws[XLSX.utils.encode_cell({r:ri,c})]={...celObj}; });
      ri++;
    });

    // Year subtotal
    const yrTots=sumCols.map(ci=>group.reduce((s,it)=>{
      const row=buildDataRow(it);
      return s+(row[ci]?.v||0);
    },0));
    yrTots.forEach((t,i)=>grandTots[i]+=t);

    const totCells=Array.from({length:nCols},(_,c)=>{
      const si=sumCols.indexOf(c);
      if(c===0)return{v:`${yr} Total`,t:'s',s:_xS.totLbl};
      if(si>=0){
        const style=headers[c]==='Miles'?_xS.totMi:_xS.totCur;
        return{v:yrTots[si],t:'n',s:style};
      }
      return{v:'',t:'s',s:_xS.totBlk};
    });
    totCells.forEach((celObj,c)=>{ ws[XLSX.utils.encode_cell({r:ri,c})]={...celObj}; });
    ri++;
  });

  // Grand total
  if(years.length>1){
    const gtCells=Array.from({length:nCols},(_,c)=>{
      const si=sumCols.indexOf(c);
      if(c===0)return{v:'GRAND TOTAL',t:'s',s:_xS.totLbl};
      if(si>=0){
        const style=headers[c]==='Miles'?_xS.totMi:_xS.totCur;
        return{v:grandTots[si],t:'n',s:style};
      }
      return{v:'',t:'s',s:_xS.totBlk};
    });
    gtCells.forEach((celObj,c)=>{ ws[XLSX.utils.encode_cell({r:ri,c})]={...celObj}; });
    ri++;
  }

  ws['!ref']=XLSX.utils.encode_range({s:{r:0,c:0},e:{r:ri-1,c:nCols-1}});
  ws['!cols']=colWidths.map(w=>({wch:w}));
  return ws;
}

function exportAllXLSX(){
  if(typeof XLSX==='undefined'){showToast('Export library loading, try again','⏳');return;}
  const biz=S.bname||'TradeDesk';
  const rate=IRS();
  const wb=XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb,_xlsByYear(
    ['Date','Source / Client','Category','Job','Amount','Notes'],
    [13,26,22,26,14,30],
    income, r=>r.date,
    r=>[
      {v:r.date||'',t:'s',s:_xS.left},
      {v:_xlsClean(r.client_name||r.source),t:'s',s:_xS.left},
      {v:_xlsClean(r.cat||r.category||'Revenue'),t:'s',s:_xS.left},
      {v:_xlsClean(r.job_name),t:'s',s:_xS.left},
      {v:r.amount||0,t:'n',s:_xS.cur},
      {v:_xlsClean(r.note||r.notes),t:'s',s:_xS.left},
    ],
    [4]
  ),'Income');

  XLSX.utils.book_append_sheet(wb,_xlsByYear(
    ['Date','Vendor','IRS Category','Schedule C Line','Amount','Deductible','Job','Receipt'],
    [13,26,22,20,14,12,26,10],
    expenses, e=>e.date,
    e=>{
      const cat=IRS_EXPENSE_CATS.find(c=>c.id===e.cat)||{label:e.cat||'Other',line:''};
      return[
        {v:e.date||'',t:'s',s:_xS.left},
        {v:_xlsClean(e.vendor),t:'s',s:_xS.left},
        {v:cat.label,t:'s',s:_xS.left},
        {v:cat.line||'',t:'s',s:_xS.left},
        {v:e.amount||0,t:'n',s:_xS.cur},
        {v:e.deductible===false?'No':'Yes',t:'s',s:_xS.ctr},
        {v:_xlsClean(e.job_name),t:'s',s:_xS.left},
        {v:(e.receipt_img||e.receipt_key)?'Yes':'No',t:'s',s:_xS.ctr},
      ];
    },
    [4]
  ),'Expenses');

  XLSX.utils.book_append_sheet(wb,_xlsByYear(
    ['Date','Vehicle','From','To','Miles','IRS Deduction','Purpose','Client'],
    [13,18,22,22,12,16,22,20],
    mileage, m=>m.date,
    m=>[
      {v:m.date||'',t:'s',s:_xS.left},
      {v:_xlsClean(m.vehicle),t:'s',s:_xS.left},
      {v:_xlsClean(m.from),t:'s',s:_xS.left},
      {v:_xlsClean(m.to),t:'s',s:_xS.left},
      {v:m.miles||0,t:'n',s:_xS.mi},
      {v:(m.miles||0)*rate,t:'n',s:_xS.cur},
      {v:_xlsClean(m.purpose),t:'s',s:_xS.left},
      {v:_xlsClean(m.client_name),t:'s',s:_xS.left},
    ],
    [4,5]
  ),'Mileage');

  downloadXLSX((biz+' Financials.xlsx').replace(/\s+/g,'_'),wb);
  const tot=income.length+expenses.length+mileage.length;
  showToast(`Excel: ${tot} records across 3 sheets`,'📊');
}

function exportExpensesCSV(){
  if(typeof XLSX==='undefined'){showToast('Export library loading, try again','⏳');return;}
  const yr=getExportYear();
  const biz=S.bname||'TradeDesk';
  const filtered=(yr==='all'?expenses:expenses.filter(e=>e.date?.startsWith(yr)))
    .sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  const n=filtered.length;
  const dataRows=filtered.map(e=>{
    const cat=IRS_EXPENSE_CATS.find(c=>c.id===e.cat)||{label:e.cat||'Other',line:''};
    return[
      {v:e.date||'',t:'s',s:_xS.left},
      {v:_xlsClean(e.vendor),t:'s',s:_xS.left},
      {v:cat.label,t:'s',s:_xS.left},
      {v:cat.line||'',t:'s',s:_xS.left},
      {v:e.amount||0,t:'n',s:_xS.cur},
      {v:e.deductible===false?'No':'Yes',t:'s',s:_xS.ctr},
      {v:_xlsClean(e.job_name),t:'s',s:_xS.left},
      {v:(e.receipt_img||e.receipt_key)?'Yes':'No',t:'s',s:_xS.ctr},
    ];
  });
  const sumRef=n>0?`E2:E${n+1}`:'E2:E2';
  const totRow=[
    {v:'TOTAL',t:'s',s:_xS.totLbl},
    {v:'',t:'s',s:_xS.totBlk},
    {v:'',t:'s',s:_xS.totBlk},
    {v:'',t:'s',s:_xS.totBlk},
    {f:`SUM(${sumRef})`,t:'n',s:_xS.totCur},
    {v:'',t:'s',s:_xS.totBlk},
    {v:'',t:'s',s:_xS.totBlk},
    {v:'',t:'s',s:_xS.totBlk},
  ];
  const ws=_xlsBuildSheet(
    ['Date','Vendor','IRS Category','Schedule C Line','Amount','Deductible','Job','Receipt'],
    [13,26,22,20,14,12,26,10],
    dataRows,totRow
  );
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Expenses');
  downloadXLSX((biz+' Expenses '+(yr==='all'?'All Years':yr)+'.xlsx').replace(/\s+/g,'_'),wb);
  showToast('Expenses Excel, '+n+' records downloaded','📊');
}

function exportMileageCSV(){
  if(typeof XLSX==='undefined'){showToast('Export library loading, try again','⏳');return;}
  const yr=getExportYear();
  const biz=S.bname||'TradeDesk';
  const rate=IRS();
  const filtered=(yr==='all'?mileage:mileage.filter(m=>m.date?.startsWith(yr)))
    .sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  const n=filtered.length;
  const dataRows=filtered.map(m=>[
    {v:m.date||'',t:'s',s:_xS.left},
    {v:_xlsClean(m.vehicle),t:'s',s:_xS.left},
    {v:_xlsClean(m.from),t:'s',s:_xS.left},
    {v:_xlsClean(m.to),t:'s',s:_xS.left},
    {v:m.miles||0,t:'n',s:_xS.mi},
    {v:(m.miles||0)*rate,t:'n',s:_xS.cur},
    {v:_xlsClean(m.purpose),t:'s',s:_xS.left},
    {v:_xlsClean(m.client_name),t:'s',s:_xS.left},
  ]);
  const miRef=n>0?`E2:E${n+1}`:'E2:E2';
  const dedRef=n>0?`F2:F${n+1}`:'F2:F2';
  const totRow=[
    {v:'TOTAL',t:'s',s:_xS.totLbl},
    {v:'',t:'s',s:_xS.totBlk},
    {v:'',t:'s',s:_xS.totBlk},
    {v:'',t:'s',s:_xS.totBlk},
    {f:`SUM(${miRef})`,t:'n',s:_xS.totMi},
    {f:`SUM(${dedRef})`,t:'n',s:_xS.totCur},
    {v:'',t:'s',s:_xS.totBlk},
    {v:'',t:'s',s:_xS.totBlk},
  ];
  const ws=_xlsBuildSheet(
    ['Date','Vehicle','From','To','Miles','IRS Deduction','Purpose','Client'],
    [13,18,22,22,12,16,22,20],
    dataRows,totRow
  );
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Mileage');
  downloadXLSX((biz+' Mileage '+(yr==='all'?'All Years':yr)+'.xlsx').replace(/\s+/g,'_'),wb);
  showToast('Mileage log, '+n+' trips downloaded','🚗');
}

function exportAllDataCSV(){
  const biz=S.bname||'TradeDesk';
  const now=new Date().toLocaleDateString('en-US');
  const q=s=>'"'+(s||'').toString().replace(/"/g,'""')+'"';
  const sections=[];
  const sec=(title,headers,rows)=>{
    sections.push('"=== '+title+' ('+rows.length+' records) ==="');
    sections.push(headers.map(q).join(','));
    rows.forEach(r=>sections.push(r));
    sections.push('');
  };
  // Year-grouped variant, used for income, expenses, mileage
  const secByYear=(title,headers,records,getDate,buildRow)=>{
    const sorted=[...records].sort((a,b)=>(getDate(b)||'').localeCompare(getDate(a)||''));
    const byYear={};
    sorted.forEach(r=>{const yr=(getDate(r)||'').slice(0,4)||'Unknown';if(!byYear[yr])byYear[yr]=[];byYear[yr].push(r);});
    const years=Object.keys(byYear).sort((a,b)=>b.localeCompare(a));
    sections.push('"=== '+title+' ('+records.length+' records) ==="');
    sections.push('');
    years.forEach(yr=>{
      sections.push('"--- '+yr+' ('+byYear[yr].length+' records) ---"');
      sections.push(headers.map(q).join(','));
      byYear[yr].forEach(r=>sections.push(buildRow(r)));
      sections.push('');
    });
  };

  // Clients
  sec('CLIENTS',
    ['Name','Phone','Email','Address','City','State','Zip','Source','Created'],
    clients.sort((a,b)=>(a.name||'').localeCompare(b.name||'')).map(c=>[
      q(c.name),q(c.phone),q(c.email),q(c.addr),q(c.city),q(c.state),q(c.zip),q(c.source),q(c.createdAt?.slice(0,10))
    ].join(','))
  );

  // Leads (clients currently in a lead stage)
  const LEAD_STAGES=['incomplete','new','est_scheduled','est_ready','bid_out','bid_urgent','abandoned'];
  const leads=clients.filter(c=>LEAD_STAGES.includes(getClientStage(c.id).stage));
  sec('LEADS',
    ['Name','Phone','Email','Address','Stage','Source','Last Contact'],
    leads.map(c=>{const st=getClientStage(c.id);return[q(c.name),q(c.phone),q(c.email),q(c.addr),q(st.stage),q(c.source),q(c.lastContact?.slice(0,10))].join(',');})
  );

  // Bids / Estimates
  sec('BIDS & ESTIMATES',
    ['Client','Trade','Amount','Status','Created','Signed Date','Deposit'],
    bids.filter(b=>!b.draft||(b.amount||0)>0).sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||'')).map(b=>[
      q(clients.find(c=>c.id===b.client_id)?.name),q(b.trade_type||b.tradeType),
      (b.amount||0).toFixed(2),q(b.status),q(b.createdAt?.slice(0,10)),
      q(b.signedAt?.slice(0,10)),(b.deposit||0).toFixed(2)
    ].join(','))
  );

  // Jobs
  sec('JOBS',
    ['Job Name','Client','Status','Value','Start Date','End Date','Address'],
    jobs.sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||'')).map(j=>[
      q(j.name),q(clients.find(c=>c.id===j.client_id)?.name),q(j.status),
      (j.value||0).toFixed(2),q(j.start),q(j.end),q(j.addr)
    ].join(','))
  );

  // Payments
  sec('PAYMENTS',
    ['Date','Client','Job','Amount','Method','Note'],
    payments.sort((a,b)=>(b.date||'').localeCompare(a.date||'')).map(p=>[
      q(p.date),q(p.client_name||clients.find(c=>c.id===p.client_id)?.name),
      q(p.job_name),( p.amount||0).toFixed(2),q(p.method),q(p.note)
    ].join(','))
  );

  // Income: grouped by year, newest first
  secByYear('INCOME',
    ['Date','Source / Client','Category','Job','Amount','Notes'],
    income, r=>r.date,
    r=>[q(r.date),q(r.client_name||r.source),q(r.cat||r.category||'Revenue'),
        q(r.job_name),(r.amount||0).toFixed(2),q(r.note||r.notes)].join(',')
  );

  // Expenses: grouped by year, newest first
  secByYear('EXPENSES',
    ['Date','Vendor','IRS Category','Amount','Deductible','Job','Receipt'],
    expenses, e=>e.date,
    e=>{const cat=IRS_EXPENSE_CATS.find(c=>c.id===e.cat)||{label:e.cat||'Other'};
        return[q(e.date),q(e.vendor),q(cat.label),(e.amount||0).toFixed(2),
          e.deductible===false?'No':'Yes',q(e.job_name),e.receipt_img||e.receipt_key?'Yes':'No'].join(',');}
  );

  // Mileage: grouped by year, newest first
  const rate=IRS();
  secByYear('MILEAGE',
    ['Date','Vehicle','From','To','Miles','IRS Deduction','Purpose','Client'],
    mileage, m=>m.date,
    m=>[q(m.date),q(m.vehicle),q(m.from),q(m.to),
        (m.miles||0).toFixed(1),((m.miles||0)*rate).toFixed(2),q(m.purpose),q(m.client_name)].join(',')
  );

  // Time Entries
  if(timeEntries.length){
    sec('TIME ENTRIES',
      ['Date','Job','Start','End','Minutes','Scope'],
      timeEntries.sort((a,b)=>(b.date||'').localeCompare(a.date||'')).map(e=>[
        q(e.date),q(jobs.find(j=>j.id===e.job_id)?.name||e.job_id),
        q(e.start_time?.slice(11,16)),q(e.end_time?.slice(11,16)),
        (e.minutes||0).toString(),q(e.scope_label)
      ].join(','))
    );
  }

  const header=['"'+biz+', Full Data Export, '+now+'"',''];
  const csv=[...header,...sections].join('\n');
  downloadFile((biz+' Full Export '+now+'.csv').replace(/[/,\s]+/g,'_'),csv,'text/csv');
  showToast('Full export, all data downloaded','📦');
}

function exportIncomeCSV(){
  if(typeof XLSX==='undefined'){showToast('Export library loading, try again','⏳');return;}
  const yr=getExportYear();
  const biz=S.bname||'TradeDesk';
  const filtered=(yr==='all'?income:income.filter(r=>r.date?.startsWith(yr)))
    .sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  const n=filtered.length;
  const dataRows=filtered.map(r=>[
    {v:r.date||'',t:'s',s:_xS.left},
    {v:_xlsClean(r.client_name||r.source),t:'s',s:_xS.left},
    {v:_xlsClean(r.cat||r.category||'Revenue'),t:'s',s:_xS.left},
    {v:_xlsClean(r.job_name),t:'s',s:_xS.left},
    {v:r.amount||0,t:'n',s:_xS.cur},
    {v:_xlsClean(r.note||r.notes),t:'s',s:_xS.left},
  ]);
  const sumRef=n>0?`E2:E${n+1}`:'E2:E2';
  const totRow=[
    {v:'TOTAL',t:'s',s:_xS.totLbl},
    {v:'',t:'s',s:_xS.totBlk},
    {v:'',t:'s',s:_xS.totBlk},
    {v:'',t:'s',s:_xS.totBlk},
    {f:`SUM(${sumRef})`,t:'n',s:_xS.totCur},
    {v:'',t:'s',s:_xS.totBlk},
  ];
  const ws=_xlsBuildSheet(
    ['Date','Source / Client','Category','Job','Amount','Notes'],
    [13,26,22,26,14,30],
    dataRows,totRow
  );
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Income');
  downloadXLSX((biz+' Income '+(yr==='all'?'All Years':yr)+'.xlsx').replace(/\s+/g,'_'),wb);
  showToast('Income Excel, '+n+' records downloaded','💰');
}

function exportPLCSV(){
  const yr=getExportYear();
  const biz=S.bname||'TradeDesk';
  const label=yr==='all'?'All Years':yr;
  const filterYr=arr=>(yr==='all'?arr:arr.filter(r=>r.date?.startsWith(yr)));
  const yrInc=filterYr(income).sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  const yrExp=filterYr(expenses).sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  const yrMil=filterYr(mileage);
  const yrPay=filterYr(payments).filter(p=>p.amount!==0).sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  const tIncBase=yrInc.reduce((s,r)=>s+(r.amount||0),0);
  const tIncPay=yrPay.reduce((s,p)=>s+(p.amount||0),0);
  const tInc=tIncBase+tIncPay;
  const tExp=yrExp.reduce((s,r)=>s+(r.amount||0),0);
  const tMil=yrMil.reduce((s,m)=>s+(m.miles||0),0)*IRS();
  const net=tInc-tExp;
  const lines=[
    '"'+biz+', Profit & Loss, '+label+'"','',
    '"INCOME"','Date,Source / Client,Category,Amount',
    ...yrInc.map(r=>[r.date||'','"'+(r.client_name||r.source||'').replace(/"/g,'""')+'"','"'+(r.cat||'Revenue')+'"',(r.amount||0).toFixed(2)].join(',')),
    ...yrPay.map(p=>[p.date||'','"'+(p.client_name||'Payment').replace(/"/g,'""')+'"','"Payment"',(p.amount||0).toFixed(2)].join(',')),
    ',,TOTAL INCOME,'+tInc.toFixed(2),'',
    '"EXPENSES"','Date,Vendor,IRS Category,Amount',
    ...yrExp.map(e=>{const c=IRS_EXPENSE_CATS.find(x=>x.id===e.cat)||{label:e.cat||'Other'};return[e.date||'','"'+(e.vendor||'').replace(/"/g,'""')+'"','"'+c.label+'"',(e.amount||0).toFixed(2)].join(',');}),
    ',,TOTAL EXPENSES,'+tExp.toFixed(2),'',
    '"MILEAGE DEDUCTION"','Miles,IRS Rate,Deduction,',
    tMil>0?tMil.toFixed(1)+','+IRS().toFixed(3)+','+(tMil).toFixed(2)+',':'(none)','',
    '"NET PROFIT"','"'+label+'",,'+net.toFixed(2),
  ];
  downloadFile((biz+' P&L '+label+'.csv').replace(/\s+/g,'_'),lines.join('\n'),'text/csv');
  showToast('P&L exported, '+label,'📈');
}

function exportTaxPDF(){
  const yr=getExportYear()==='all'?String(new Date().getFullYear()):getExportYear();
  const biz=S.bname||'TradeDesk';
  const status=S.txStatus||'single';
  const yrIncome=income.filter(r=>r.date&&r.date.startsWith(yr)).sort((a,b)=>a.date.localeCompare(b.date));
  const yrExp=expenses.filter(r=>r.date&&r.date.startsWith(yr)).sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  const yrMiles=mileage.filter(r=>r.date&&r.date.startsWith(yr)).sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  const tInc=yrIncome.reduce((s,r)=>s+r.amount,0);
  const _vdX=(typeof _vehSchedC==='function')?_vehSchedC(yr):null; // one method per vehicle (IRS)
  const tExp=yrExp.reduce((s,r)=>s+r.amount,0)-(_vdX?_vdX.expAdjust:0);
  const tMiles=yrMiles.reduce((s,r)=>s+(r.miles||0),0);
  const irsRateYr=_getIrsRateForYear(yr);
  const mileDed=_vdX?_vdX.mileDed:tMiles*irsRateYr;
  const net=Math.max(0,tInc-tExp-mileDed);
  const seBase=net*0.9235;
  const seTax=Math.ceil(seBase*0.153);
  const seDed=seTax/2;
  const stdDed=_getStdDedForYear(yr,status);
  const agi=net-seDed;
  const fedTaxable=Math.max(0,agi-stdDed);
  const fedBkts=_getFedBracketsForYear(yr);
  const fedTax=Math.ceil(calcBrackets(fedTaxable,fedBkts[status]||fedBkts.single));
  const ksTaxable=Math.max(0,agi-(KS_STD[status]||3500));
  const ksTaxGross=Math.ceil(calcBrackets(ksTaxable,KS_BRACKETS[status]||KS_BRACKETS.single));
  // Multi-state: build revenue by state from bid addresses
  const _pdfHome=S.state||'KS';
  const _pdfRev={};
  payments.filter(p=>p.amount!==0&&p.date&&p.date.startsWith(yr)).forEach(p=>{
    const bid=bids.find(b=>b.id===p.bid_id);
    const st=(bid&&typeof detectStateFromAddr==='function'?detectStateFromAddr(bid.addr||''):null)||_pdfHome;
    _pdfRev[st]=(_pdfRev[st]||0)+p.amount;
  });
  yrIncome.forEach(r=>{_pdfRev[_pdfHome]=(_pdfRev[_pdfHome]||0)+r.amount;});
  const _pdfMulti=tInc>0&&Object.keys(_pdfRev).some(st=>st!==_pdfHome);
  const _pdfNonHome=[];
  let _pdfNonHomeTax=0;
  if(_pdfMulti){
    Object.entries(_pdfRev).filter(([st])=>st!==_pdfHome).forEach(([st,rev])=>{
      const stInfo=STATE_TAX[st];
      const stTax=_calcStateEstimate(agi*(rev/tInc),stInfo);
      _pdfNonHome.push({name:(stInfo?.name||st),rev,stTax,noTax:!!(stInfo?.noTax)});
      _pdfNonHomeTax+=stTax;
    });
    _pdfNonHome.sort((a,b)=>b.rev-a.rev);
  }
  const _pdfNonHomeInc=_pdfNonHome.reduce((s,t)=>s+t.rev,0);
  const _pdfCredit=Math.min(_pdfNonHomeTax,ksTaxGross*(tInc>0?_pdfNonHomeInc/tInc:0));
  const ksTax=Math.max(0,Math.ceil(ksTaxGross-_pdfCredit));
  const totalTax=seTax+fedTax+ksTax+_pdfNonHomeTax;
  const byCat={};
  yrExp.forEach(e=>{
    const cat=IRS_EXPENSE_CATS.find(c=>c.id===e.cat)||{label:e.cat||'Other',icon:'',line:'Part II Line 27'};
    if(!byCat[cat.label])byCat[cat.label]={label:cat.label,icon:cat.icon||'',line:cat.line||'',total:0};
    byCat[cat.label].total+=e.amount;
  });
  const d=new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});
  const statusLabel={single:'Single',mfj:'Married Filing Jointly',hoh:'Head of Household'}[status]||status;
  // Build HTML using string concat, no template literals to avoid parser issues
  let h='<!DOCTYPE html><html><head><meta charset="utf-8">';
  h+='<title>'+escHtml(biz)+' Tax Report '+yr+'</title>';
  h+='<style>';
  h+='*{box-sizing:border-box;margin:0;padding:0}';
  h+='body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#1a1a18;font-size:11px;line-height:1.5}';
  h+='@media print{@page{margin:.6in;size:letter}}';
  h+='.hdr{background:#0D1117;color:#fff;padding:20px 28px}';
  h+='.hdr-t{font-size:20px;font-weight:800}';
  h+='.hdr-s{font-size:12px;opacity:.6;margin-top:3px}';
  h+='.body{padding:20px 28px}';
  h+='.sec{margin-bottom:20px}';
  h+='.sec-t{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#9a9890;border-bottom:2px solid #e0dfd8;padding-bottom:5px;margin-bottom:10px}';
  h+='.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px}';
  h+='.box{border:1px solid #e0dfd8;border-radius:8px;padding:10px 12px}';
  h+='.bl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#9a9890;margin-bottom:3px}';
  h+='.bv{font-size:17px;font-weight:800}';
  h+='.green{color:#27500A}.red{color:#791F1F}.blue{color:#185FA5}';
  h+='table{width:100%;border-collapse:collapse;font-size:10px}';
  h+='th{text-align:left;padding:4px 7px;background:#f7f7f5;border-bottom:2px solid #e0dfd8;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#9a9890}';
  h+='td{padding:5px 7px;border-bottom:1px solid #f0efec}';
  h+='.tr td{font-weight:800;border-top:2px solid #e0dfd8;background:#f7f7f5}';
  h+='.two{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px}';
  h+='.ts{border:1px solid #e0dfd8;border-radius:8px;overflow:hidden}';
  h+='.th{padding:8px 12px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.05em}';
  h+='.tr2{display:flex;justify-content:space-between;padding:6px 12px;border-top:1px solid #f0efec;font-size:10px}';
  h+='.tsub{font-size:8px;color:#9a9890;display:block}';
  h+='.ttot{display:flex;justify-content:space-between;padding:8px 12px;font-weight:800;background:#f7f7f5;border-top:2px solid #e0dfd8}';
  h+='.tall{display:flex;justify-content:space-between;padding:10px 14px;font-weight:800;font-size:13px;background:#FFF0F0;border-top:2px solid #791F1F}';
  h+='.note{font-size:9px;color:#9a9890;border-top:1px solid #e0dfd8;padding-top:10px;margin-top:16px;line-height:1.6}';
  h+='</style></head><body>';
  // Header
  h+='<div class="hdr"><div class="hdr-t">'+biz+'</div>';
  h+='<div class="hdr-s">Tax Report, '+yr+' &nbsp;·&nbsp; '+statusLabel+' &nbsp;·&nbsp; '+d+'</div></div>';
  h+='<div class="body">';
  // Income & deductions
  h+='<div class="sec"><div class="sec-t">Income &amp; Deductions: Schedule C</div>';
  h+='<div class="grid">';
  h+='<div class="box"><div class="bl">Gross Revenue</div><div class="bv green">'+fmt(tInc)+'</div></div>';
  h+='<div class="box"><div class="bl">Business Expenses</div><div class="bv red">('+fmt(tExp)+')</div></div>';
  h+='<div class="box"><div class="bl">Mileage Deduction</div><div class="bv red">('+fmt(mileDed)+')</div></div>';
  h+='<div class="box"><div class="bl">Net SE Income</div><div class="bv blue">'+fmt(net)+'</div></div>';
  h+='<div class="box"><div class="bl">Miles Driven</div><div class="bv">'+tMiles.toFixed(1)+' mi</div></div>';
  h+='<div class="box"><div class="bl">IRS Rate</div><div class="bv">$'+IRS().toFixed(3)+'/mi</div></div>';
  h+='</div></div>';
  // Tax breakdown
  const _pdfHomeStateName=(STATE_TAX[_pdfHome]?.name||_pdfHome||'State');
  h+='<div class="sec"><div class="sec-t">Tax Liability, Federal vs '+(_pdfMulti?'Multi-State':_pdfHomeStateName+' State')+'</div>';
  h+='<div class="two">';
  // Federal
  h+='<div class="ts">';
  h+='<div class="th" style="background:#EBF2FB;color:#0C447C">Federal (IRS)</div>';
  h+='<div class="tr2"><span>SE income base (92.35%)<span class="tsub">Schedule SE</span></span><span>'+fmt(seBase)+'</span></div>';
  h+='<div class="tr2"><span>Self-employment tax (15.3%)<span class="tsub">Social Security + Medicare</span></span><span class="red">'+fmt(seTax)+'</span></div>';
  h+='<div class="tr2"><span>1/2 SE deduction<span class="tsub">Reduces federal AGI</span></span><span class="green">('+fmt(seDed)+')</span></div>';
  const qbiEst=Math.floor(Math.max(0,net-seDed)*0.20);
  if(qbiEst>0)h+='<div class="tr2"><span>QBI deduction est. (Sec. 199A)<span class="tsub">20% pass-through, confirm with CPA</span></span><span class="green">('+fmt(qbiEst)+')</span></div>';
  h+='<div class="tr2"><span>Standard deduction<span class="tsub">Form 1040, '+statusLabel+'</span></span><span class="green">('+fmt(stdDed)+')</span></div>';
  h+='<div class="tr2"><span>Federal taxable income</span><span style="font-weight:700">'+fmt(fedTaxable)+'</span></div>';
  h+='<div class="tr2"><span>Federal income tax<span class="tsub">Form 1040 brackets</span></span><span class="red">'+fmt(fedTax)+'</span></div>';
  h+='<div class="ttot"><span>Total Federal</span><span class="red">'+fmt(seTax+fedTax)+'</span></div>';
  h+='</div>';
  // State (single or multi)
  h+='<div class="ts">';
  h+='<div class="th" style="background:#EAF3DE;color:#27500A">'+(_pdfMulti?'State Tax (apportioned by job location)':_pdfHomeStateName+' Tax')+'</div>';
  if(_pdfMulti){
    h+='<div class="tr2"><span>'+escHtml(_pdfHomeStateName)+' income tax (home, after credit)</span><span class="red">'+fmt(ksTax)+'</span></div>';
    _pdfNonHome.forEach(t=>{h+='<div class="tr2"><span>'+escHtml(t.name)+' (non-resident)</span><span class="red">'+(t.noTax?'No income tax':fmt(t.stTax))+'</span></div>';});
    h+='<div class="tr2" style="font-size:9px;color:#666;font-style:italic"><span>Income apportioned by job address · credits applied · verify with CPA</span><span></span></div>';
  } else {
    h+='<div class="tr2"><span>State AGI</span><span>'+fmt(agi)+'</span></div>';
    h+='<div class="tr2"><span>Standard deduction<span class="tsub">'+statusLabel+'</span></span><span class="green">('+fmt(KS_STD[status]||3500)+')</span></div>';
    h+='<div class="tr2"><span>State taxable income</span><span style="font-weight:700">'+fmt(ksTaxable)+'</span></div>';
    h+='<div class="tr2"><span>State income tax</span><span class="red">'+fmt(ksTax)+'</span></div>';
  }
  h+='<div class="ttot"><span>Total State</span><span class="red">'+fmt(ksTax+_pdfNonHomeTax)+'</span></div>';
  h+='</div></div>';
  // Combined
  h+='<div class="ts">';
  h+='<div class="tr2"><span>Self-employment tax</span><span class="red">'+fmt(seTax)+'</span></div>';
  h+='<div class="tr2"><span>Federal income tax</span><span class="red">'+fmt(fedTax)+'</span></div>';
  h+='<div class="tr2"><span>'+(_pdfMulti?'State income tax (all states)':_pdfHomeStateName+' state income tax')+'</span><span class="red">'+fmt(ksTax+_pdfNonHomeTax)+'</span></div>';
  h+='<div class="tall"><span>Total Estimated Tax Liability</span><span class="red">'+fmt(totalTax)+'</span></div>';
  h+='</div></div>';
  // Income table
  h+='<div class="sec"><div class="sec-t">Income: '+yrIncome.length+' transactions</div>';
  h+='<table><thead><tr><th>Date</th><th>Client</th><th>Type</th><th>Method</th><th style="text-align:right">Amount</th></tr></thead><tbody>';
  yrIncome.forEach(r=>{h+='<tr><td>'+(r.date||'')+'</td><td>'+(r.client_name||'')+'</td><td>'+(r.type||'')+'</td><td>'+(r.method||'')+'</td><td style="text-align:right;font-weight:700">'+fmt(r.amount)+'</td></tr>';});
  h+='<tr class="tr"><td colspan="4">Total Income</td><td style="text-align:right">'+fmt(tInc)+'</td></tr></tbody></table></div>';
  // Expenses by category
  h+='<div class="sec"><div class="sec-t">Expenses by IRS Category</div>';
  h+='<table><thead><tr><th>Category</th><th>Schedule C Line</th><th style="text-align:right">Total</th></tr></thead><tbody>';
  Object.values(byCat).sort((a,b)=>b.total-a.total).forEach(c=>{h+='<tr><td>'+c.icon+' '+c.label+'</td><td style="color:#9a9890">'+c.line+'</td><td style="text-align:right;font-weight:700;color:#791F1F">('+fmt(c.total)+')</td></tr>';});
  h+='<tr class="tr"><td colspan="2">Total Expenses</td><td style="text-align:right">('+fmt(tExp)+')</td></tr></tbody></table></div>';
  // Expense detail
  h+='<div class="sec"><div class="sec-t">Expense Detail, '+yrExp.length+' entries (01/01/'+yr+' - 12/31/'+yr+')</div>';
  h+='<table><thead><tr><th>Date</th><th>Vendor</th><th>Category</th><th>Job</th><th>Receipt</th><th style="text-align:right">Amount</th></tr></thead><tbody>';
  yrExp.forEach(e=>{
    const cat=IRS_EXPENSE_CATS.find(c=>c.id===e.cat)||{icon:'',label:e.cat||'Other'};
    h+='<tr><td>'+(e.date||'')+'</td><td style="font-weight:600">'+(e.vendor||'-')+'</td><td>'+cat.icon+' '+cat.label+'</td><td style="color:#9a9890">'+(e.job_name||'-')+'</td>';
    h+='<td>'+(e.receipt_img||e.receipt_key?'Yes':'No')+'</td><td style="text-align:right;font-weight:700">('+fmt(e.amount)+')</td></tr>';
  });
  h+='<tr class="tr"><td colspan="5">Total</td><td style="text-align:right">('+fmt(tExp)+')</td></tr></tbody></table></div>';
  // Mileage
  h+='<div class="sec"><div class="sec-t">Mileage Log, '+yrMiles.length+' trips at $'+IRS().toFixed(3)+'/mi</div>';
  h+='<table><thead><tr><th>Date</th><th>Vehicle</th><th>Route</th><th>Purpose</th><th style="text-align:right">Miles</th><th style="text-align:right">Deduction</th></tr></thead><tbody>';
  yrMiles.forEach(m=>{h+='<tr><td>'+(m.date||'')+'</td><td>'+(m.vehicle||'')+'</td><td>'+(m.from||'')+' - '+(m.to||'')+'</td><td>'+(m.purpose||'')+(m.client_name?' - '+m.client_name:'')+'</td><td style="text-align:right">'+((m.miles||0).toFixed(1))+'</td><td style="text-align:right;color:#791F1F">('+fmt((m.miles||0)*IRS())+')</td></tr>';});
  h+='<tr class="tr"><td colspan="4">Total</td><td style="text-align:right">'+tMiles.toFixed(1)+'</td><td style="text-align:right">('+fmt(mileDed)+')</td></tr></tbody></table></div>';
  h+='<div class="note">Estimates only. Verify with a CPA before filing. Federal SE tax at 15.3% on 92.35% of net per Schedule SE.</div>';
  h+='</div></body></html>';
  const blob=new Blob([h],{type:'text/html'});
  const url=URL.createObjectURL(blob);
  const w=window.open(url,'_blank');
  if(!w){const a=document.createElement('a');a.href=url;a.target='_blank';document.body.appendChild(a);a.click();document.body.removeChild(a);}
  setTimeout(()=>URL.revokeObjectURL(url),30000);
  showToast('Tax report opened, Print to save as PDF','📄');
}


function exportFullBackup(){
  const biz=(S.bname||'TradeDesk').replace(/\s+/g,'_');
  const ts=new Date().toISOString().slice(0,10);
  const backup={version:3,exported:new Date().toISOString(),business:S.bname||'',
    data:{clients,bids,jobs,income,expenses,mileage,payments,liens},settings:S,
    meta:{clients:clients.length,bids:bids.length,expenses:expenses.length,income:income.length,mileage:mileage.length}};
  downloadFile(biz+'_TradeDesk_Backup_'+ts+'.json',JSON.stringify(backup,null,2),'application/json');
  showToast('Full backup downloaded, keep this safe','💾');
}
async function exportReceiptImages(){
  const yr=document.getElementById('exp-panel-year')?.value||new Date().getFullYear();
  const filtered=expenses.filter(e=>(e.receipt_img||e.receipt_key)&&(yr==='all'||String(new Date(e.date).getFullYear())===String(yr)))
    .sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  if(!filtered.length){zAlert('No stored receipt photos for '+yr+'.',{title:'No receipts'});return;}
  // Open window synchronously here (inside user gesture) so iOS Safari doesn't block it.
  // Write a loading placeholder, then replace with real content after async image fetch.
  const win=window.open('','_blank');
  if(!win){zAlert('Allow pop-ups to export the PDF.',{title:'Pop-up blocked'});return;}
  win.document.write('<html><head><title>Loading receipts…</title></head><body style="font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f5f5f3"><p style="font-size:18px;color:#555">Preparing receipt PDF…</p></body></html>');
  win.document.close();
  showToast('Preparing receipt PDF…','📄',3000);
  const _srcMap={};
  await Promise.all(filtered.map(async e=>{
    if(e.receipt_img){_srcMap[e.id]=e.receipt_img;return;}
    if(e.receipt_key){
      try{_srcMap[e.id]=await _downloadReceiptAsDataUrl(e.receipt_key);}
      catch(err){console.warn('Could not fetch receipt',e.id,err);}
    }
  }));
  // Canvas-resize every image and record exact output dimensions.
  // We pass width+height attributes directly into the <img> tag so iOS Safari
  // cannot reflow the image at any other size in print. Target 620×740px
  // (≈6.5×7.7in at 96dpi) leaving ~2.7in for header+margins on a letter page.
  const _sizeMap={};
  await Promise.all(Object.keys(_srcMap).map(id=>new Promise(resolve=>{
    const src=_srcMap[id];
    if(!src){resolve();return;}
    const img=new Image();
    img.onload=()=>{
      const maxW=580,maxH=650;
      const scale=Math.min(maxW/img.width,maxH/img.height,1);
      const w=Math.round(img.width*scale),h=Math.round(img.height*scale);
      if(scale<1){
        const c=document.createElement('canvas');
        c.width=w;c.height=h;
        c.getContext('2d').drawImage(img,0,0,w,h);
        _srcMap[id]=c.toDataURL('image/jpeg',0.88);
      }
      _sizeMap[id]={w,h};
      resolve();
    };
    // Even if canvas load fails, record a fallback so we can apply CSS max-height
    img.onerror=()=>{_sizeMap[id]={w:580,h:650,fallback:true};resolve()};
    img.src=src;
  })));
  const bname=S.bname||'TradeDesk';
  const pages=filtered.map((e,i)=>{
    const cat=e.catLabel||e.cat||'';
    const d=e.date?new Date(e.date+'T12:00:00').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}):e.date||'';
    const sz=_sizeMap[e.id];
    const imgStyle=sz&&!sz.fallback
      ?`display:block;margin:0 auto;border:1px solid #ddd;border-radius:6px;width:${sz.w}px;height:${sz.h}px;max-width:100%`
      :`display:block;margin:0 auto;border:1px solid #ddd;border-radius:6px;max-width:100%;max-height:650px`;
    const imgTag=_srcMap[e.id]
      ?`<img src="${_srcMap[e.id]}"
           ${sz&&!sz.fallback?`width="${sz.w}" height="${sz.h}"`:''}
           alt="Receipt ${i+1}"
           style="${imgStyle}">`
      :'<div style="color:#999;font-size:13px;padding:40px">Image unavailable</div>';
    return `<div class="page">
      <div class="page-hdr">
        <div class="pg-num">Receipt ${i+1} of ${filtered.length}</div>
        <div class="pg-meta">
          <span class="field">${d}</span>
          <span class="field vendor">${e.vendor||'-'}</span>
          <span class="field amount">$${Number(e.amount||0).toFixed(2)}</span>
          <span class="field cat">${cat}</span>
          ${e.job_name?`<span class="field job">Job: ${e.job_name}</span>`:''}
          ${e.notes?`<span class="field notes">${e.notes}</span>`:''}
        </div>
      </div>
      <div class="img-wrap">${imgTag}</div>
    </div>`;
  }).join('');
  win.document.open();
  win.document.write(`<!DOCTYPE html><html><head>
<meta charset="utf-8">
<title>${bname}: Receipts ${yr}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fff;color:#1a1a1a}
.no-print{background:#185FA5;color:#fff;padding:12px 20px;display:flex;justify-content:space-between;align-items:center}
.no-print button{background:#fff;color:#185FA5;border:none;padding:8px 18px;border-radius:6px;font-weight:700;font-size:14px;cursor:pointer}
.page{padding:10px 16px;max-width:760px;margin:0 auto;page-break-after:always;page-break-inside:avoid}
.page:last-child{page-break-after:auto}
.page-hdr{margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid #ddd}
.pg-num{font-size:11px;color:#888;margin-bottom:4px;text-transform:uppercase;letter-spacing:.05em}
.pg-meta{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.field{font-size:12px;padding:3px 8px;border-radius:4px;background:#f5f5f3}
.vendor{font-weight:700;font-size:14px;background:#EBF2FB;color:#185FA5}
.amount{font-weight:800;font-size:14px;background:#F0FBF0;color:#3B8C2A}
.cat{background:#FEF3C7;color:#92400E}
.job{background:#F0F0FF;color:#555}
.notes{background:#f5f5f3;color:#666;font-style:italic}
.img-wrap{margin-top:8px;text-align:center}
@media print{
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .no-print{display:none!important}
  @page{margin:0.3in;size:letter portrait}
}
</style>
</head><body>
<div class="no-print">
  <span><strong>${bname}</strong>, ${filtered.length} receipt${filtered.length>1?'s':''} · ${yr}</span>
  <button onclick="window.print()">${svgIcon('🖨',{size:14})} Print / Save PDF</button>
</div>
${pages}
</body></html>`);
  win.document.close();
}
function renderJobsHistory(){
  const yearSel=document.getElementById('tr-jobs-year');
  const el=document.getElementById('tr-jobs-list');
  if(!yearSel||!el)return;

  const wonBids=bids.filter(b=>b.status==='Closed Won'&&b.bid_date);
  const years=[...new Set(wonBids.map(b=>b.bid_date.substring(0,4)))].sort((a,b)=>b-a);

  if(!years.length){
    el.innerHTML='<div class="empty">No completed jobs yet.</div>';
    yearSel.innerHTML='<option>No jobs yet</option>';
    return;
  }

  const prevYear=yearSel.dataset.locked||yearSel.value||years[0];
  const currentYear=years.includes(prevYear)?prevYear:years[0];
  yearSel.innerHTML=years.map(y=>`<option value="${y}" ${y===currentYear?'selected':''}>${y}</option>`).join('');
  yearSel.dataset.locked='';
  const selYear=currentYear;

  const yearBids=wonBids.filter(b=>b.bid_date.startsWith(selYear))
    .sort((a,b)=>b.bid_date.localeCompare(a.bid_date));

  const countEl=document.getElementById('tr-jobs-year-count');
  if(countEl)countEl.textContent=yearBids.length+' job'+(yearBids.length!==1?'s':'');

  if(!yearBids.length){
    el.innerHTML='<div class="empty">No jobs in '+selYear+'.</div>';
    return;
  }

  const totalRev=yearBids.reduce((s,b)=>s+b.amount,0);
  const totalPaid=yearBids.reduce((s,b)=>s+getBidPaid(b.id),0);

  el.innerHTML=
    ((typeof _canViewComp==='function'&&_canViewComp())?'<div style="display:flex;gap:8px;margin-bottom:10px">'+
      '<button onclick="_openJobProfit()" style="flex:1;padding:11px;border-radius:var(--r);border:1px solid var(--blue);background:var(--blue-lt);color:var(--blue);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;min-height:44px">'+svgIcon('💰',{size:14})+' Job Profit</button>'+
      '<button onclick="_openCrewCost()" style="flex:1;padding:11px;border-radius:var(--r);border:1px solid var(--blue);background:var(--blue-lt);color:var(--blue);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;min-height:44px">'+svgIcon('👷',{size:14})+' Crew Cost</button>'+
    '</div>':'')+
    '<div class="mets" style="margin-bottom:10px">'+
      '<div class="met"><div class="met-l">Jobs</div><div class="met-v">'+yearBids.length+'</div></div>'+
      '<div class="met"><div class="met-l">Billed</div><div class="met-v" style="color:var(--blue)">'+fmt(totalRev)+'</div></div>'+
      '<div class="met"><div class="met-l">Collected</div><div class="met-v" style="color:var(--green-mid)">'+fmt(totalPaid)+'</div></div>'+
    '</div>'+
    yearBids.map(b=>{
      const paid=getBidPaid(b.id);
      const balance=getBidBalance(b);
      const isPaidFull=balance<=0.01;
      return '<div onclick="openBidHistoryDetail('+b.id+')" data-lp-id="'+b.id+'" data-lp-type="bid" data-lp-label="'+escHtml(b.client_name||b.name||'bid')+'" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid var(--border);cursor:pointer">'+
        '<div style="flex:1;min-width:0">'+
          '<div style="font-size:14px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+(b.client_name||b.name||'Unknown')+'</div>'+
          '<div style="font-size:11px;color:var(--text3)">'+fmtDateShort(b.bid_date)+(b.addr?' · '+b.addr:'')+'</div>'+
          '<div style="font-size:11px;color:var(--text3);margin-top:1px">'+(b.days||1)+' day'+((b.days||1)>1?'s':'')+(b.scope?getTopScope(b.scope):'')+'</div>'+
        '</div>'+
        '<div style="text-align:right;flex-shrink:0">'+
          '<div style="font-size:15px;font-weight:700">'+fmt(b.amount)+'</div>'+
          '<div style="font-size:10px;font-weight:700;color:'+(isPaidFull?'var(--green-mid)':'var(--amber)')+'">'+
            (isPaidFull?'Paid in full':'Balance '+fmt(balance))+
          '</div>'+
        '</div>'+
        '<svg viewBox="0 0 24 24" style="width:16px;height:16px;stroke:var(--text3);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0"><polyline points="9 18 15 12 9 6"/></svg>'+
      '</div>';
    }).join('');
}

// ── Job Profit Report (revenue − materials − labor from tracked time) ─────────
// Gated by _canViewComp(). Labor is joined via job_time_entries → jobs[].bid_id.
async function _openJobProfit(){
  if(typeof _canViewComp==='function'&&!_canViewComp()){zAlert('You need the Pay & profit permission to view this.');return;}
  document.getElementById('_job-pl-ov')?.remove();
  const ov=document.createElement('div');ov.id='_job-pl-ov';ov.className='zmodal-overlay';
  const box=document.createElement('div');box.className='zmodal';box.style.maxWidth='460px';
  box.innerHTML='<div style="font-size:17px;font-weight:800;margin-bottom:4px">'+svgIcon('💰',{size:18})+' Job Profit</div>'+
    '<div style="font-size:12px;color:var(--text3);margin-bottom:14px">Revenue minus materials and labor cost (wage + '+Math.round(((S.laborBurden||1.3)-1)*100)+'% overhead) from tracked crew time on site.</div>'+
    '<div id="_job-pl-body" style="font-size:13px;color:var(--text3);max-height:60vh;overflow-y:auto">Loading…</div>'+
    '<button onclick="this.closest(\'.zmodal-overlay\').remove()" style="width:100%;padding:10px;border-radius:var(--r);border:none;background:none;color:var(--text3);font-size:13px;cursor:pointer;font-family:inherit;margin-top:10px">Close</button>';
  ov.appendChild(box);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  const body=document.getElementById('_job-pl-body');
  if(!supaEnabled()||!_supaUser){if(body)body.textContent='Sign in to load job profit data.';return;}
  const cid=(typeof _contractorUserId!=='undefined'&&_contractorUserId)||_supaUser.id;
  // Pull pay rates (uid → effective hourly) and tracked minutes per job
  const rateByUid={};
  let entries=[];
  try{
    const{data:tm}=await _supa.from('team_members').select('employee_user_id,pay_type,pay_rate').eq('contractor_user_id',cid);
    (tm||[]).forEach(r=>{if(r.employee_user_id)rateByUid[r.employee_user_id]=(typeof _empLoadedHourly==='function')?_empLoadedHourly(r):(r.pay_type==='salary'?(r.pay_rate||0)/2080:(r.pay_rate||0))*(S.laborBurden||1.3);});
    // Owner's own tracked time (bills under cid), cost it with the owner's pay rate
    rateByUid[cid]=(typeof _empLoadedHourly==='function')?_empLoadedHourly({pay_type:S.ownerPayType,pay_rate:S.ownerPayRate}):0;
    const{data:te}=await _supa.from('job_time_entries').select('employee_user_id,job_id,minutes,source').eq('contractor_user_id',cid);
    entries=te||[];
  }catch(_e){}
  // Fold in manually-clocked time (js/jobs.js clockOut → timeEntries), without
  // this, a walk-up job clocked via the nearby-banner Clock in button was
  // invisible to Job Profit entirely, even though the time was really saved.
  // null logged_by_uid means the owner, whose rate already keys off cid above.
  entries=entries.concat(timeEntries.map(e=>({employee_user_id:e.logged_by_uid||cid,job_id:e.job_id,minutes:e.minutes||0,source:'manual'})));
  // Labor $ by bid id (on-site time only; drive is overhead, not job labor)
  const laborByBid={};
  entries.forEach(en=>{
    if(en.source==='drive')return;
    const job=jobs.find(j=>String(j.id)===String(en.job_id));
    const bidId=job?job.bid_id:en.job_id;
    if(bidId==null)return;
    const rate=rateByUid[en.employee_user_id]||0;
    laborByBid[bidId]=(laborByBid[bidId]||0)+((en.minutes||0)/60)*rate;
  });
  // On-site minutes per bid (drive excluded from on-site calc)
  const onSiteMinByBid={};
  entries.forEach(en=>{
    if(en.source==='drive')return;
    const job=jobs.find(j=>String(j.id)===String(en.job_id));
    const bidId=job?job.bid_id:en.job_id;
    if(bidId==null)return;
    onSiteMinByBid[bidId]=(onSiteMinByBid[bidId]||0)+(en.minutes||0);
  });
  const wonBids=bids.filter(b=>b.status==='Closed Won');
  const rows=wonBids.map(b=>{
    const revenue=b.amount||0;
    const materials=expenses.filter(e=>String(e.job_id)===String(b.id)).reduce((s,e)=>s+(e.amount||0),0);
    const labor=laborByBid[b.id]||0;
    const profit=revenue-materials-labor;
    // Sum across all job records for this bid (multiple visits / re-schedules)
    const linkedJobs=jobs.filter(j=>String(j.bid_id)===String(b.id));
    const plannedHrs=linkedJobs.length?linkedJobs.reduce((s,j)=>s+(parseInt(j.days)||1)*8,0):null;
    const actualHrs=(onSiteMinByBid[b.id]||0)/60;
    const underStaffed=plannedHrs!=null&&actualHrs>0&&actualHrs<plannedHrs*0.5;
    const anyActive=linkedJobs.some(j=>j.status!=='done'&&!j.cancelled);
    const noTimeYet=plannedHrs!=null&&actualHrs===0&&anyActive;
    return{b,revenue,materials,labor,profit,hasLabor:labor>0,plannedHrs,actualHrs,underStaffed,noTimeYet};
  }).sort((a,b)=>b.profit-a.profit);
  if(!body)return;
  if(!rows.length){body.innerHTML='<div style="padding:8px 0">No completed (Closed Won) jobs yet.</div>';return;}
  const totProfit=rows.reduce((s,r)=>s+r.profit,0);
  const trackedCount=rows.filter(r=>r.hasLabor).length;
  body.innerHTML=
    '<div style="display:flex;justify-content:space-between;padding:10px 12px;background:var(--bg2);border-radius:var(--r);margin-bottom:10px">'+
      '<div><div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em">Total profit</div>'+
      '<div style="font-size:18px;font-weight:800;color:'+(totProfit>=0?'#0E6B39':'#A32D2D')+'">'+fmt(totProfit)+'</div></div>'+
      '<div style="text-align:right"><div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em">With tracked labor</div>'+
      '<div style="font-size:18px;font-weight:800">'+trackedCount+'/'+rows.length+'</div></div>'+
    '</div>'+
    (trackedCount===0?'<div style="font-size:11px;color:var(--text3);background:var(--bg2);border:1px dashed var(--border);border-radius:var(--r);padding:8px 10px;margin-bottom:10px;line-height:1.5">No crew time tracked yet, profit below counts materials only. Enable crew tracking and assign jobs on the dispatch board to capture labor automatically.</div>':'')+
    rows.map(r=>{
      const c=(r.profit>=0?'#0E6B39':'#A32D2D');
      const margin=r.revenue>0?Math.round(r.profit/r.revenue*100):0;
      const timeRow=r.plannedHrs!=null?(
        r.underStaffed?
          '<div style="font-size:10px;color:var(--c-amber);margin-top:3px">'+svgIcon('⚠',{size:11})+' Only '+r.actualHrs.toFixed(1)+'h tracked vs '+r.plannedHrs+'h planned, check crew time on this job</div>':
        r.noTimeYet?
          '<div style="font-size:10px;color:var(--text3);margin-top:3px">No time logged yet · '+r.plannedHrs+'h planned</div>':
        (r.hasLabor?'<div style="font-size:10px;color:var(--text3);margin-top:3px">⏱ '+r.actualHrs.toFixed(1)+'h on-site / '+r.plannedHrs+'h planned</div>':'')
      ):'';
      return '<div style="padding:10px 0;border-bottom:1px solid var(--border)">'+
        '<div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline">'+
          '<div style="font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml(r.b.client_name||r.b.name||'Job')+'</div>'+
          '<div style="font-size:14px;font-weight:800;color:'+c+';flex-shrink:0">'+fmt(r.profit)+'</div>'+
        '</div>'+
        '<div style="display:flex;justify-content:space-between;gap:10px;margin-top:3px">'+
          '<div style="font-size:11px;color:var(--text3)">Rev '+fmt(r.revenue)+' · Mat '+fmt(r.materials)+' · Labor '+(r.hasLabor?fmt(r.labor):'-')+'</div>'+
          '<div style="font-size:11px;font-weight:700;color:'+c+';flex-shrink:0">'+margin+'%</div>'+
        '</div>'+
        timeRow+
      '</div>';
    }).join('');
}

// ── Crew labor cost, per-employee rollup + dashboard tile ────────────────────
function _ctDateStr(d){
  try{return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);}
  catch(_e){return d.toISOString().slice(0,10);}
}
// Fetch pay rates (loaded + wage) and tracked time entries since an ISO instant.
async function _fetchCrewLabor(sinceISO){
  const out={loaded:{},wage:{},name:{},entries:[],shopEntries:[]};
  if(!supaEnabled()||!_supaUser)return out;
  const cid=(typeof _contractorUserId!=='undefined'&&_contractorUserId)||_supaUser.id;
  try{
    const{data:tm}=await _supa.from('team_members').select('employee_user_id,name,email,pay_type,pay_rate').eq('contractor_user_id',cid);
    (tm||[]).forEach(r=>{
      if(!r.employee_user_id)return;
      const comp={pay_type:r.pay_type,pay_rate:r.pay_rate};
      out.loaded[r.employee_user_id]=(typeof _empLoadedHourly==='function')?_empLoadedHourly(comp):0;
      out.wage[r.employee_user_id]=(typeof _empEffectiveHourly==='function')?_empEffectiveHourly(comp):0;
      out.name[r.employee_user_id]=r.name||r.email||'Crew';
    });
    const _oc={pay_type:S.ownerPayType,pay_rate:S.ownerPayRate};
    out.loaded[cid]=(typeof _empLoadedHourly==='function')?_empLoadedHourly(_oc):0;
    out.wage[cid]=(typeof _empEffectiveHourly==='function')?_empEffectiveHourly(_oc):0;
    out.name[cid]=S.ownerName||(typeof getOwnerName==='function'&&getOwnerName())||'Owner (me)';
    let q=_supa.from('job_time_entries').select('employee_user_id,job_id,minutes,arrived_at,departed_at,source').eq('contractor_user_id',cid);
    if(sinceISO)q=q.gte('arrived_at',sinceISO);
    const{data:te}=await q;
    out.entries=te||[];
    let sq=_supa.from('shop_time_entries').select('employee_user_id,minutes,arrived_at').eq('contractor_user_id',cid);
    if(sinceISO)sq=sq.gte('arrived_at',sinceISO);
    const{data:se}=await sq;
    out.shopEntries=se||[];
  }catch(_e){}
  return out;
}
// The dashboard "Crew today" tile was DELETED 2026-07-14 (owner: "simplify
// before we scale"): it duplicated the Time log page's live "Currently
// clocked in" banner. Crew hours live there; crew COST lives in Books via
// _openCrewCost below. _fetchCrewLabor stays (Books + timelog use it).
// Per-employee Crew Cost report (Today / This week), with per-job breakdown.
async function _openCrewCost(){
  if(typeof _canViewComp==='function'&&!_canViewComp()){zAlert('You need the Pay & profit permission to view this.');return;}
  document.getElementById('_crew-cost-ov')?.remove();
  const ov=document.createElement('div');ov.id='_crew-cost-ov';ov.className='zmodal-overlay';
  const box=document.createElement('div');box.className='zmodal';box.style.maxWidth='460px';
  const _ccBtn=id=>'<button id="_cc-'+id+'" onclick="_crewCostRender(\''+id+'\')" style="flex:1;padding:8px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;min-width:0">';
  box.innerHTML='<div style="font-size:17px;font-weight:800;margin-bottom:4px">'+svgIcon('👷',{size:18})+' Crew Cost</div>'+
    '<div style="font-size:12px;color:var(--text3);margin-bottom:10px">What each person actually cost you, wage + overhead (payroll taxes, insurance), from tracked time on site.</div>'+
    '<div style="display:flex;gap:6px;margin-bottom:6px">'+
      _ccBtn('today')+'Today</button>'+
      _ccBtn('week')+'This week</button>'+
      _ccBtn('month')+'This month</button>'+
    '</div>'+
    '<div style="display:flex;gap:6px;margin-bottom:12px">'+
      _ccBtn('quarter')+'This quarter</button>'+
      _ccBtn('ytd')+'Year to date</button>'+
    '</div>'+
    '<div id="_crew-cost-body" style="font-size:13px;color:var(--text3);max-height:56vh;overflow-y:auto">Loading…</div>'+
    '<button onclick="this.closest(\'.zmodal-overlay\').remove()" style="width:100%;padding:10px;border-radius:var(--r);border:none;background:none;color:var(--text3);font-size:13px;cursor:pointer;font-family:inherit;margin-top:10px">Close</button>';
  ov.appendChild(box);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  _crewCostRender('week');
}
async function _crewCostRender(range){
  const body=document.getElementById('_crew-cost-body');if(!body)return;
  ['today','week','month','quarter','ytd'].forEach(r=>{const b=document.getElementById('_cc-'+r);if(b){const on=r===range;b.style.background=on?'var(--blue)':'var(--bg2)';b.style.color=on?'#fff':'var(--text)';b.style.borderColor=on?'var(--blue)':'var(--border2)';}});
  body.textContent='Loading…';
  const todayStr=_ctDateStr(new Date());
  const [yr,mo]=todayStr.split('-').map(Number);
  let sinceStr,label;
  if(range==='today'){sinceStr=todayStr;label='today';}
  else if(range==='week'){sinceStr=_ctDateStr(new Date(Date.now()-6*86400000));label='this week';}
  else if(range==='month'){sinceStr=yr+'-'+String(mo).padStart(2,'0')+'-01';label='this month';}
  else if(range==='quarter'){const qm=Math.floor((mo-1)/3)*3+1;sinceStr=yr+'-'+String(qm).padStart(2,'0')+'-01';label='this quarter';}
  else{sinceStr=yr+'-01-01';label='this year';}
  // Fetch with 1-day UTC buffer before period start; CT-date comparison is the authoritative filter
  const sinceISO=new Date(new Date(sinceStr+'T00:00:00Z').getTime()-86400000).toISOString();
  const data=await _fetchCrewLabor(sinceISO);
  // Fold in manually-clocked time (js/jobs.js clockOut → timeEntries) alongside
  // GPS-tracked entries, mapped into the same {employee_user_id,job_id,minutes,
  // arrived_at,source} shape so the aggregation below treats both identically.
  // null logged_by_uid means the owner; _fetchCrewLabor already resolves the
  // owner's rate/name under cid.
  const cid=(typeof _contractorUserId!=='undefined'&&_contractorUserId)||(_supaUser&&_supaUser.id);
  const manualEnts=timeEntries.filter(e=>e.start_time&&_ctDateStr(new Date(e.start_time))>=sinceStr)
    .map(e=>({employee_user_id:e.logged_by_uid||cid,job_id:e.job_id,minutes:e.minutes||0,arrived_at:e.start_time,source:'manual'}));
  const ents=data.entries.filter(en=>en.arrived_at&&_ctDateStr(new Date(en.arrived_at))>=sinceStr).concat(manualEnts);
  const shopEnts=(data.shopEntries||[]).filter(en=>en.arrived_at&&_ctDateStr(new Date(en.arrived_at))>=sinceStr);
  if(!ents.length&&!shopEnts.length){body.innerHTML='<div style="padding:10px 0">No tracked time '+label+' yet. Crew time appears here once they\'re on site with sharing enabled.</div>';return;}
  // Business day length for unaccounted estimate
  const _phm=s=>{const m=/^(\d{1,2}):(\d{2})$/.exec(s||'');return m?(+m[1])*60+(+m[2]):null;};
  const _bst=_phm(S.trackStart||'07:00'),_ben=_phm(S.trackEnd||'18:00');
  const bizDayMins=(_bst!=null&&_ben!=null&&_ben>_bst)?(_ben-_bst):660;
  // Aggregate by employee
  const byEmp={};
  const _emp=uid=>{if(!byEmp[uid])byEmp[uid]={min:0,jobSiteMin:0,driveMin:0,shopMin:0,jobs:{},dayMins:{}};return byEmp[uid];};
  ents.forEach(en=>{
    const uid=en.employee_user_id;if(!uid)return;
    const e=_emp(uid);const m=en.minutes||0;e.min+=m;
    if(en.source==='drive'){e.driveMin+=m;}else{
      e.jobSiteMin+=m;
      const job=jobs.find(j=>String(j.id)===String(en.job_id));
      const bidId=job?job.bid_id:en.job_id;
      const key=bidId!=null?String(bidId):'unknown';
      e.jobs[key]=(e.jobs[key]||0)+m;
    }
    const day=_ctDateStr(new Date(en.arrived_at));e.dayMins[day]=(e.dayMins[day]||0)+m;
  });
  shopEnts.forEach(en=>{
    const uid=en.employee_user_id;if(!uid)return;
    const e=_emp(uid);const m=en.minutes||0;e.min+=m;e.shopMin+=m;
    const day=_ctDateStr(new Date(en.arrived_at));e.dayMins[day]=(e.dayMins[day]||0)+m;
  });
  // Revenue attribution + overtime per employee
  Object.keys(byEmp).forEach(uid=>{
    const bidsSeen=new Set(Object.keys(byEmp[uid].jobs).filter(k=>k!=='unknown'));
    byEmp[uid].revenue=[...bidsSeen].reduce((s,bidId)=>{const b=bids.find(x=>String(x.id)===String(bidId));return s+(b?b.amount||0:0);},0);
    byEmp[uid].otDays=Object.values(byEmp[uid].dayMins).filter(m=>m>480).length;
  });
  const _jobName=bidId=>{
    const b=bids.find(x=>String(x.id)===String(bidId));if(b)return b.client_name||b.name||'Job';
    const j=jobs.find(x=>String(x.id)===String(bidId));return j?(j.clientName||j.name||'Job'):'Other';
  };
  const uids=Object.keys(byEmp).sort((a,b)=>byEmp[b].min-byEmp[a].min);
  let grand=0;
  const rowsHtml=uids.map(uid=>{
    const e=byEmp[uid];
    const hrs=e.min/60,loaded=hrs*(data.loaded[uid]||0),wage=hrs*(data.wage[uid]||0);
    grand+=loaded;
    const jsHrs=e.jobSiteMin/60,drHrs=e.driveMin/60,shHrs=e.shopMin/60;
    // Use actual days worked (days with any entry), not the full range length,
    // otherwise absent days inflate "unaccounted" for part-week workers.
    const workedDays=Math.max(1,Object.keys(e.dayMins).length);
    const unaccH=Math.max(0,(bizDayMins*workedDays-e.min)/60);
    const hasBreakdown=e.driveMin>0||e.shopMin>0;
    const otTag=e.otDays>0?'<span style="color:var(--c-amber);font-weight:700;margin-left:6px">'+svgIcon('⚠',{size:12})+' OT '+e.otDays+'d</span>':'';
    const rlTag=(e.revenue>0&&loaded>0)?'<span style="color:var(--green);font-weight:700;margin-left:6px">'+fmt(e.revenue)+' rev</span>':'';
    const jobLines=Object.keys(e.jobs).sort((a,b)=>e.jobs[b]-e.jobs[a]).map(bid=>{
      const jh=e.jobs[bid]/60;
      return '<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text3);padding:1px 0 1px 10px"><span>'+escHtml(_jobName(bid))+'</span><span>'+jh.toFixed(1)+'h · '+fmt(jh*(data.loaded[uid]||0))+'</span></div>';
    }).join('');
    const breakdownHtml=hasBreakdown?
      '<div style="display:flex;flex-wrap:wrap;gap:10px;font-size:10px;color:var(--text3);margin:4px 0 6px 0;padding:6px 8px;background:var(--bg2);border-radius:var(--r)">'+
        '<span>'+svgIcon('🏗',{size:11})+' On-site '+jsHrs.toFixed(1)+'h</span>'+
        (drHrs>0.1?'<span>'+svgIcon('🚗',{size:11})+' Drive '+drHrs.toFixed(1)+'h</span>':'')+
        (shHrs>0.1?'<span>'+svgIcon('🏠',{size:11})+' Shop '+shHrs.toFixed(1)+'h</span>':'')+
        (unaccH>0.5?'<span style="color:var(--text4)">~ '+unaccH.toFixed(1)+'h unaccounted</span>':'')+
      '</div>':'';
    return '<div style="padding:10px 0;border-bottom:1px solid var(--border)">'+
      '<div style="display:flex;justify-content:space-between;align-items:baseline">'+
        '<div style="font-size:14px;font-weight:700">'+escHtml(data.name[uid]||'Crew')+'</div>'+
        '<div style="font-size:15px;font-weight:800;color:var(--c-red)">'+fmt(loaded)+'</div>'+
      '</div>'+
      '<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text3);margin:2px 0 2px">'+
        '<span>'+hrs.toFixed(1)+'h'+otTag+rlTag+'</span>'+
        '<span>wage '+fmt(wage)+' + burden</span>'+
      '</div>'+
      breakdownHtml+jobLines+
    '</div>';
  }).join('');
  body.innerHTML=
    '<div style="display:flex;justify-content:space-between;padding:10px 12px;background:var(--bg2);border-radius:var(--r);margin-bottom:10px">'+
      '<div style="font-size:12px;font-weight:700;color:var(--text2)">Total loaded labor</div>'+
      '<div style="font-size:18px;font-weight:800;color:var(--c-red)">'+fmt(grand)+'</div>'+
    '</div>'+rowsHtml;
}

function getTopScope(scope){
  const labels={sand:'sanding',spackle:'spackle',prime:'primer',twocoat:'2 coats',tape:'masking',caulk:'caulking'};
  const on=Object.entries(scope).filter(([k,v])=>v&&labels[k]).map(([k])=>labels[k]);
  return on.length?' · '+on.slice(0,3).join(', ')+(on.length>3?' +'+( on.length-3):''):'';
}

function closeBidHistoryDetail(){const el=document.getElementById('tr-bid-detail');if(el)el.style.display='none';}
function viewSavedProposal(bidId){
  const b=bids.find(x=>x.id===bidId);
  if(!b||!b.proposalHtml){zAlert('No saved proposal found for this bid. Proposals are saved starting from this update, older bids won\'t have one stored.',{title:'Not available'});return;}
  const ov=document.createElement('div');
  ov.setAttribute('data-pov','1');
  ov.style.cssText='position:fixed;inset:0;background:#f0f4f8;z-index:10000;overflow-y:auto;-webkit-overflow-scrolling:touch';
  const signedBadge=b.signedAt?
    '<div style="background:#D1FAE5;border:1px solid #6EE7B7;border-radius:6px;padding:10px 14px;margin-bottom:16px;font-size:12px;color:#065F46;display:flex;align-items:center;gap:8px">'+
      '<span style="font-size:16px">'+svgIcon('✓',{size:16})+'</span>'+
      '<span><strong>Signed</strong> '+new Date(b.signedAt).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})+(b.signedName?' by '+escHtml(b.signedName):'')+'</span>'+
    '</div>':'';
  ov.innerHTML=
    '<div style="position:sticky;top:0;background:#1a365d;color:#fff;padding:14px 16px;display:flex;justify-content:space-between;align-items:center;z-index:1">'+
      '<div style="font-size:15px;font-weight:800">Signed Proposal</div>'+
      '<button onclick="document.querySelector(\'[data-pov]\').remove()" style="background:rgba(255,255,255,.2);border:none;color:#fff;padding:6px 14px;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">Close</button>'+
    '</div>'+
    '<div style="padding:16px;max-width:680px;margin:0 auto"><div id="pov-color-section"></div>'+signedBadge+b.proposalHtml+'</div>';
  document.body.appendChild(ov);
  // Async: fetch updated proposal JSON to show client color choices
  if(b.signingKey&&b.signedAt){
    _supa.storage.from('proposals').download(b.signingKey).then(({data})=>{
      if(!data)return;
      data.text().then(txt=>{
        try{
          const prop=JSON.parse(txt);
          const choices=prop.colorChoices||[];
          if(!choices.length)return;
          const sec=document.getElementById('pov-color-section');
          if(!sec)return;
          sec.innerHTML='<div style="background:#EFF6FF;border:1.5px solid #BFDBFE;border-radius:var(--rl,10px);padding:14px 16px;margin-bottom:16px">'+
            '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#1E40AF;margin-bottom:10px">'+svgIcon('🎨',{size:12})+' Client Color Selections</div>'+
            choices.map(c=>'<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid #DBEAFE;font-size:13px">'+
              '<span style="font-weight:600;color:#1E3A5F">'+escHtml(c.room)+'</span>'+
              '<span style="color:#1E40AF;font-weight:700">'+escHtml(c.colorName)+(c.swCode?' <span style="font-size:11px;font-weight:500;color:#93C5FD">('+escHtml(c.swCode)+')</span>':'')+'</span>'+
            '</div>').join('')+
          '</div>';
        }catch(e){}
      });
    }).catch(()=>{});
  }
}
function openBidHistoryDetail(bidId){
  const b=bids.find(x=>x.id===bidId);if(!b)return;
  const panel=document.getElementById('tr-bid-detail');
  const content=document.getElementById('tr-bid-detail-content');
  if(!panel||!content)return;

  const PAINT_LABELS={std:'Standard (Behr/Valspar)',prem:'Sherwin-Williams Premium',ultra:'SW Emerald Ultra'};
  const COND_LABELS={'1.0':'Good: minor prep','1.2':'Fair: moderate prep','1.5':'Poor: heavy prep'};
  const surfs=b.surfaces||[];
  const scope=b.scope?Object.entries(b.scope).filter(([k,v])=>v).map(([k])=>{
    const item=SCOPE_ITEMS.find(s=>s.id===k);return item?item.label:k;
  }):[];
  const SURF_LABELS={walls:'Walls',ceiling:'Ceiling',trim:'Trim',doors:'Doors',windows:'Windows',cabinets:'Cabinets',ext_walls:'Siding',ext_trim:'Ext trim',deck:'Deck',fence:'Fence staining',epoxy:'Epoxy floor'};
  const pays=getBidPayments(bidId);
  const totalPaid=getBidPaid(bidId);

  content.innerHTML=
    '<div style="background:var(--blue-lt);border-radius:var(--rl);padding:14px 16px;margin-bottom:14px">'+
      '<div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--blue-dk);margin-bottom:4px">Completed job</div>'+
      '<div style="font-size:20px;font-weight:800">'+(b.client_name||b.name)+'</div>'+
      (b.addr?'<div style="font-size:12px;color:var(--text2);margin-top:2px">'+b.addr+'</div>':'')+
      '<div style="font-size:12px;color:var(--text3);margin-top:2px">'+fmtDateShort(b.bid_date)+' · '+(b.days||1)+' day'+((b.days||1)>1?'s':'')+'</div>'+
    '</div>'+

    (b.proposalHtml?
      '<button onclick="viewSavedProposal('+bidId+')" style="width:100%;padding:13px;border-radius:var(--r);border:1.5px solid var(--blue);background:var(--blue-lt);color:var(--blue-dk);font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:10px">View signed proposal →</button>':
      '<div style="font-size:11px;color:var(--text3);text-align:center;padding:6px 0 10px;font-style:italic">No saved proposal (sent before this update)</div>')+

    '<div class="card" style="margin-bottom:10px">'+
      '<div class="card-hd">Financials</div>'+
      '<div class="tax-row"><span>Bid total</span><span style="font-weight:700;font-size:15px">'+fmt(b.amount)+'</span></div>'+
      '<div class="tax-row"><span>Collected</span><span style="color:var(--green-mid);font-weight:700">'+fmt(totalPaid)+'</span></div>'+
      (getBidBalance(b)>0.01?'<div class="tax-row"><span>Outstanding</span><span style="color:#A32D2D;font-weight:700">'+fmt(getBidBalance(b))+'</span></div>':'')+
      (pays.length?
        '<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">'+
          '<div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text3);margin-bottom:6px">Payment history</div>'+
          pays.map(p=>'<div class="tax-row"><span style="color:var(--text2)">'+p.date+' · '+p.method+'</span><span>'+fmt(p.amount)+'</span></div>').join('')+
        '</div>':'')+
    '</div>'+

    (scope.length?
      '<div class="card" style="margin-bottom:10px">'+
        '<div class="card-hd">Scope of work</div>'+
        '<div style="display:flex;flex-wrap:wrap;gap:6px">'+
          scope.map(s=>'<span class="chip">'+s+'</span>').join('')+
        '</div>'+
        (b.paint?'<div style="margin-top:8px;font-size:12px;color:var(--text2)">Paint: <strong>'+(PAINT_LABELS[b.paint]||b.paint)+'</strong></div>':'')+
        (b.cond?'<div style="font-size:12px;color:var(--text2)">Condition: <strong>'+(COND_LABELS[b.cond]||b.cond)+'</strong></div>':'')+
      '</div>':'')+

    (surfs.length?
      '<div class="card" style="margin-bottom:10px">'+
        '<div class="card-hd">Surfaces ('+surfs.length+')</div>'+
        surfs.map(s=>{
          const t=SURF_TYPES.find(x=>x.v===s.type)||{l:s.type,unit:'sf'};
          return '<div style="display:flex;justify-content:space-between;font-size:12px;padding:5px 0;border-bottom:1px solid var(--border)">'+
            '<span style="color:var(--text2)">'+(s.room||t.l)+'</span>'+
            '<span style="font-weight:600">'+s.qty.toLocaleString()+' '+(t.unit||'')+'</span>'+
          '</div>';
        }).join('')+
      '</div>':'')+

    (b.notes?
      '<div class="card" style="margin-bottom:10px">'+
        '<div class="card-hd">Notes</div>'+
        '<div style="font-size:12px;color:var(--text2);line-height:1.6">'+b.notes+'</div>'+
      '</div>':'')+

    '<button class="btn btn-full" onclick="closeBidHistoryDetail()" style="margin-top:4px">Close</button>';

  panel.style.display='block';
  panel.scrollTop=0;
}

function renderJobSummary(){
  const el=document.getElementById('job-summary-list');if(!el)return;
  const wonBids=bids.filter(b=>b.status==='Closed Won');
  if(!wonBids.length){el.innerHTML='<div class="empty">No completed jobs yet.</div>';return;}
  let grandRev=0,grandExp=0;
  const rows=wonBids.map(b=>{
    const rev=getClientIncome(b.client_id).reduce((s,i)=>s+i.amount,0);
    const exp=expenses.filter(e=>e.job_id===b.id).reduce((s,e)=>s+e.amount,0);
    const miles=mileage.filter(m=>m.client_id===b.client_id).reduce((s,m)=>s+(m.miles||0),0);
    const net=rev-exp;
    grandRev+=rev;grandExp+=exp;
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">'+
      '<div><div style="font-size:13px;font-weight:700">'+(b.client_name||b.name)+'</div>'+
      '<div class="meta-xs">'+(b.addr||'')+(exp>0?' · '+fmt(exp)+' expenses':'')+' '+(miles>0?' · '+miles.toFixed(1)+'mi':'')+'</div></div>'+
      '<div style="text-align:right">'+
        '<div style="font-size:13px;font-weight:700;color:'+(net>0?'var(--green-mid)':'#A32D2D')+'">'+fmt(net)+'</div>'+
        '<div class="meta-xs">of '+fmt(b.amount)+' bid</div>'+
      '</div>'+
    '</div>';
  }).join('');
  el.innerHTML=rows+
    '<div style="display:flex;justify-content:space-between;padding:10px 0;font-weight:700;font-size:13px;border-top:2px solid var(--border);margin-top:4px">'+
      '<span>Net profit</span>'+
      '<span style="color:var(--green-mid)">'+fmt(grandRev-grandExp)+'</span>'+
    '</div>';
}

function _incDateFmt(el){
  let v=el.value.replace(/\D/g,'').slice(0,8);
  if(v.length>4)v=v.slice(0,2)+'/'+v.slice(2,4)+'/'+v.slice(4);
  else if(v.length>2)v=v.slice(0,2)+'/'+v.slice(2);
  el.value=v;
}
function openManualIncomeModal(){
  document.getElementById('_inc-ov')?.remove(); // defensive cleanup in case a stale overlay is stuck
  const _td=new Date();const _tm=String(_td.getMonth()+1).padStart(2,'0'),_tdd=String(_td.getDate()).padStart(2,'0'),_ty=_td.getFullYear();
  const todayMDY=_tm+'/'+_tdd+'/'+_ty;
  const clientOpts=clients.map(c=>'<option value="'+c.id+'">'+escHtml(c.name)+'</option>').join('');
  const ov=document.createElement('div');ov.id='_inc-ov';ov.style.cssText='position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box';
  const sheet=document.createElement('div');sheet.style.cssText='background:var(--bg2);border-radius:14px;width:100%;max-width:480px;max-height:90vh;overflow-y:auto;padding:20px 16px 24px;box-sizing:border-box';
  sheet.innerHTML=
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'+
      '<div style="font-size:17px;font-weight:800">Log Income</div>'+
      '<button onclick="document.getElementById(\'_inc-ov\').remove()" style="background:none;border:none;font-size:20px;color:var(--text3);cursor:pointer">'+svgIcon('✕',{size:20})+'</button>'+
    '</div>'+
    '<div style="display:grid;gap:12px">'+
      '<div><label style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text3);display:block;margin-bottom:5px">Date <span style="color:#A32D2D">*</span></label>'+
        '<input id="_inc-date" type="text" inputmode="numeric" value="'+todayMDY+'" placeholder="MM/DD/YYYY" oninput="_incDateFmt(this)" style="width:100%;padding:11px 12px;border:1.5px solid var(--border2);border-radius:var(--r);font-size:15px;font-family:inherit;background:var(--bg2);color:var(--text);box-sizing:border-box"></div>'+
      '<div><label style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text3);display:block;margin-bottom:5px">Amount <span style="color:#A32D2D">*</span></label>'+
        '<input id="_inc-amt" type="number" min="0" step="0.01" placeholder="0.00" style="width:100%;padding:11px 12px;border:1.5px solid var(--border2);border-radius:var(--r);font-size:15px;font-family:inherit;background:var(--bg2);color:var(--text);box-sizing:border-box"></div>'+
      '<div><label style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text3);display:block;margin-bottom:5px">Client</label>'+
        '<select id="_inc-client" style="width:100%;padding:11px 12px;border:1.5px solid var(--border2);border-radius:var(--r);font-size:15px;font-family:inherit;background:var(--bg2);color:var(--text);box-sizing:border-box"><option value="">No client / other</option>'+clientOpts+'</select></div>'+
      '<div><label style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text3);display:block;margin-bottom:5px">Type</label>'+
        '<select id="_inc-type" onchange="toggleIncDepositWarn()" style="width:100%;padding:11px 12px;border:1.5px solid var(--border2);border-radius:var(--r);font-size:15px;font-family:inherit;background:var(--bg2);color:var(--text);box-sizing:border-box">'+
          '<option value="Job payment">Job payment</option><option value="Deposit">Deposit / advance</option><option value="Final payment">Final payment</option><option value="Cash">Cash</option><option value="Other">Other</option>'+
        '</select>'+
        '<div id="_inc-deposit-warn" style="display:none;background:#FFFBEB;border:1.5px solid #D97706;border-radius:var(--r);padding:10px 12px;margin-top:8px;font-size:12px;color:#92400E;line-height:1.5">'+
          svgIcon('💡',{size:13})+' <strong>Deposits count as income now.</strong> The IRS says any money you receive is taxable the year you get it, even if it\'s a deposit for work you haven\'t done yet. Don\'t wait until the job is done to report it.'+
        '</div></div>'+
      '<div><label style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text3);display:block;margin-bottom:5px">Payment method</label>'+
        '<select id="_inc-method" style="width:100%;padding:11px 12px;border:1.5px solid var(--border2);border-radius:var(--r);font-size:15px;font-family:inherit;background:var(--bg2);color:var(--text);box-sizing:border-box" onchange="toggleCashWarning()">'+
          '<option value="Check">Check</option><option value="Card">Card</option><option value="Zelle">Zelle</option><option value="Venmo">Venmo</option><option value="Cash">Cash</option><option value="Other">Other</option>'+
        '</select></div>'+
      '<div id="_inc-cash-warn" style="display:none;background:#FFFACD;border:2px solid #F59E0B;border-radius:var(--r);padding:10px 12px;margin-top:10px">'+
        '<div style="font-size:12px;font-weight:700;color:#78350F;margin-bottom:6px">'+svgIcon('⚠',{size:13})+' Cash Income, IRS Red Flag</div>'+
        '<label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;font-size:12px;color:#78350F">'+
          '<input type="checkbox" id="_inc-cash-confirm" style="margin-top:2px;width:16px;height:16px;flex-shrink:0">'+
          '<span>I confirm this cash was deposited to my business bank account</span>'+
        '</label>'+
      '</div>'+
      '<div><label style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text3);display:block;margin-bottom:5px;margin-top:10px">Notes</label>'+
        '<input id="_inc-notes" type="text" placeholder="Optional note" style="width:100%;padding:11px 12px;border:1.5px solid var(--border2);border-radius:var(--r);font-size:15px;font-family:inherit;background:var(--bg2);color:var(--text);box-sizing:border-box"></div>'+
    '</div>'+
    '<div id="_inc-err" style="display:none;color:#A32D2D;font-size:12px;font-weight:600;margin:8px 0"></div>'+
    '<button onclick="saveManualIncome()" style="margin-top:14px;width:100%;padding:14px;border-radius:var(--r);border:none;background:var(--accent,var(--blue));color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit">Save income</button>';
  ov.appendChild(sheet);document.body.appendChild(ov);
  setTimeout(()=>document.getElementById('_inc-amt')?.focus(),150);
}
function toggleIncDepositWarn(){
  const t=document.getElementById('_inc-type')?.value||'';
  const w=document.getElementById('_inc-deposit-warn');
  if(w)w.style.display=(t==='Deposit')?'block':'none';
}
function saveManualIncome(){
  const dateRaw=(document.getElementById('_inc-date')?.value||'').trim();
  const errEl=document.getElementById('_inc-err');
  const mdy=dateRaw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  const ymd=dateRaw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  let date='';
  if(mdy){const y=mdy[3].length===2?'20'+mdy[3]:mdy[3];date=y+'-'+mdy[1].padStart(2,'0')+'-'+mdy[2].padStart(2,'0');}
  else if(ymd)date=dateRaw;
  if(!date){errEl.textContent='Enter date as MM/DD/YYYY';errEl.style.display='block';return;}
  const amtRaw=parseFloat(document.getElementById('_inc-amt')?.value||'');
  if(!amtRaw||amtRaw<=0){errEl.textContent='Please enter an amount greater than 0.';errEl.style.display='block';return;}
  errEl.style.display='none';
  const clientId=document.getElementById('_inc-client')?.value||'';
  const client=clientId?clients.find(c=>String(c.id)===clientId):null;
  const type=document.getElementById('_inc-type')?.value||'Job payment';
  const method=document.getElementById('_inc-method')?.value||'';
  const notes=document.getElementById('_inc-notes')?.value||'';
  if(method==='Cash'&&!document.getElementById('_inc-cash-confirm')?.checked){
    errEl.textContent='Please confirm this cash was deposited to your business account.';errEl.style.display='block';return;
  }
  const entry={id:Date.now(),bid_id:null,client_id:client?client.id:null,client_name:client?client.name:(notes||'Other'),date:date.replace(/-/g,'').slice(0,8),type,amount:amtRaw,method,notes,created_at:new Date().toISOString()};
  income.push(entry);
  document.getElementById('_inc-ov')?.remove();
  const entryYear=parseInt(date.slice(0,4));
  showToast(entryYear!==trackerYear?'Income logged for '+entryYear:'Income logged',entryYear!==trackerYear?'📅':'✅');
  // Save fires synchronously so data hits localStorage before the call stack empties
  if(typeof _flushSaveNow==='function')_flushSaveNow();else saveAll();
  // Render deferred, table rebuild doesn't block the current frame
  setTimeout(()=>{
    if(entryYear!==trackerYear){
      setTrackerYear(entryYear);
      const sel=document.getElementById('tracker-year-sel');if(sel)sel.value=entryYear;
    } else {
      if(typeof renderIncome==='function')renderIncome();
    }
  },0);
}
function _bkTogMonth(tab,mo){
  const el=document.getElementById('bk-'+tab+'-mo-'+mo);
  if(!el)return;
  const body=el.querySelector('.bk-month-body');
  const opening=!el.classList.contains('open');
  el.classList.toggle('open');
  if(body)body.style.display=opening?'block':'none';
}
// Day-level accordion inside a month (owner: "break it down by month AND day").
function _bkTogDay(tab,mo,day){
  const el=document.getElementById('bk-'+tab+'-day-'+mo+'-'+day);
  if(!el)return;
  const body=el.querySelector('.bk-day-body');
  const opening=!el.classList.contains('open');
  el.classList.toggle('open');
  if(body)body.style.display=opening?'block':'none';
}
function _bkDayLabel(d){
  const p=(d||'').split('-').map(Number);
  if(p.length<3||!p[0]||!p[1]||!p[2])return d||'-';
  try{return new Date(p[0],p[1]-1,p[2]).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});}catch(_e){return d;}
}
// Render a month's rows grouped into per-day accordions (each day its own dropdown,
// default open). rowFn is the month's local row renderer (_incRow / _expRow).
// sumFn/fmtFn are optional, default to the original $-amount behavior so Income
// and Expenses (the only callers before Time Log) are unaffected; Time Log passes
// a minutes-sum + duration formatter instead of $ since it isn't a money view.
function _bkRenderDays(tab,mo,rows,headers,rowFn,minWidth,totalColor,sumFn,fmtFn){
  sumFn=sumFn||(r=>r.amount||0);fmtFn=fmtFn||fmt;
  const byDay={};
  rows.forEach(r=>{const d=(r.date||'').slice(0,10)||'unknown';(byDay[d]||(byDay[d]=[])).push(r);});
  const days=Object.keys(byDay).sort((a,b)=>b.localeCompare(a));
  return days.map(day=>{
    const dr=byDay[day];
    const dayTotal=dr.reduce((s,r)=>s+sumFn(r),0);
    const safe=day.replace(/[^0-9]/g,'')||'x';
    return '<div class="bk-day open" id="bk-'+tab+'-day-'+mo+'-'+safe+'">'+
      '<button class="bk-day-hd" onclick="_bkTogDay(\''+tab+'\',\''+mo+'\',\''+safe+'\')">'+
        '<span class="bk-day-title">'+_bkDayLabel(day)+'</span>'+
        '<span class="bk-day-meta" style="color:'+(totalColor||'var(--text3)')+'">'+dr.length+' · '+fmtFn(dayTotal)+'</span>'+
        '<span class="bk-day-chev">▾</span>'+
      '</button>'+
      '<div class="bk-day-body">'+
        '<div class="bk-tbl-wrap" style="overflow-x:auto;-webkit-overflow-scrolling:touch"><table class="tbl bk-tbl" style="min-width:'+minWidth+'px"><thead><tr>'+
          headers.map(h=>'<th>'+h+'</th>').join('')+((tab==='exp'||tab==='tl')?'<th></th>':'')+'</tr></thead><tbody>'+
          dr.map(rowFn).join('')+
        '</tbody></table></div>'+
      '</div>'+
    '</div>';
  }).join('');
}
function renderIncome(){
  const el=document.getElementById('inc-table');if(!el)return;
  const yr=String(trackerYear||new Date().getFullYear());
  const normDate=d=>{if(!d)return'';const c=d.replace(/-/g,'');return c.length>=8?c.slice(0,4)+'-'+c.slice(4,6)+'-'+c.slice(6,8):d;};
  const incRows=income.filter(r=>r.date&&r.date.replace(/-/g,'').startsWith(yr)).map(r=>({id:r.id,date:normDate(r.date),sortDate:r.date.replace(/-/g,''),client_id:r.client_id,client_name:r.client_name,type:r.type||'Income',amount:r.amount,method:r.method||r.pay||'-',_src:'income'}));
  const payRows=payments.filter(p=>p.date&&p.amount!==0&&p.date.replace(/-/g,'').startsWith(yr)).map(p=>({id:p.id,date:normDate(p.date),sortDate:p.date.replace(/-/g,''),client_id:p.client_id,client_name:p.client_name,type:p.amount<0?'Refund':(p.type==='deposit'?'Deposit':p.type==='final'?'Final payment':'Payment'),amount:p.amount,method:p.method||'-',_src:'payment'}));
  const filtered=[...incRows,...payRows].sort((a,b)=>b.sortDate.localeCompare(a.sortDate));
  const total=filtered.reduce((s,r)=>s+r.amount,0);
  if(!filtered.length){el.innerHTML='<div class="empty">No income in '+yr+'.</div>';return;}
  let html='<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0 12px;border-bottom:2px solid var(--border);margin-bottom:8px;flex-wrap:wrap;gap:6px">'+
    '<div><span style="font-size:12px;font-weight:700;color:var(--text3)">'+filtered.length+' record'+(filtered.length!==1?'s':'')+' in '+yr+'</span></div>'+
    '<div style="font-size:16px;font-weight:800;color:var(--green-mid)">'+fmt(total)+'</div>'+
  '</div>';
  const sorted=[...filtered].sort((a,b)=>b.sortDate.localeCompare(a.sortDate));
  const byMonth={};
  sorted.forEach(r=>{const mo=(r.date||'').slice(0,7)||'unknown';if(!byMonth[mo])byMonth[mo]=[];byMonth[mo].push(r);});
  const months=Object.keys(byMonth).sort((a,b)=>b.localeCompare(a));
  const curMo=new Date().toISOString().slice(0,7);
  const _methodBadge=m=>{
    const v=(m||'').toLowerCase();
    if(!m||m==='-')return '<span style="color:var(--text3)">-</span>';
    if(v==='cash')return '<span style="display:inline-flex;align-items:center;gap:3px;background:#D1FAE5;color:#065F46;font-size:10px;font-weight:700;padding:2px 7px;border-radius:99px;white-space:nowrap">'+svgIcon('💵',{size:11})+' Cash</span>';
    if(v==='check')return '<span style="display:inline-flex;align-items:center;gap:3px;background:#DBEAFE;color:#1E40AF;font-size:10px;font-weight:700;padding:2px 7px;border-radius:99px;white-space:nowrap">'+svgIcon('✓',{size:11})+' Check</span>';
    if(v==='zelle')return '<span style="display:inline-flex;align-items:center;gap:3px;background:#EDE9FE;color:#5B21B6;font-size:10px;font-weight:700;padding:2px 7px;border-radius:99px;white-space:nowrap">'+svgIcon('⚡',{size:11})+' Zelle</span>';
    if(v==='venmo')return '<span style="display:inline-flex;align-items:center;gap:3px;background:#DBEAFE;color:#1D4ED8;font-size:10px;font-weight:700;padding:2px 7px;border-radius:99px;white-space:nowrap">V Venmo</span>';
    if(v==='refund')return '<span style="display:inline-flex;align-items:center;gap:3px;background:#FEE2E2;color:#991B1B;font-size:10px;font-weight:700;padding:2px 7px;border-radius:99px;white-space:nowrap">↩ Refund</span>';
    if(v==='card'||v==='us_bank_account'||v==='cashapp'||v==='ach')return '<span style="display:inline-flex;align-items:center;gap:3px;background:#F3F0FF;color:#5B21B6;font-size:10px;font-weight:700;padding:2px 7px;border-radius:99px;white-space:nowrap">'+svgIcon('⚡',{size:11})+' Stripe</span>';
    return '<span style="display:inline-flex;align-items:center;gap:3px;background:var(--bg3);color:var(--text2);font-size:10px;font-weight:600;padding:2px 7px;border-radius:99px;white-space:nowrap">'+escHtml(m)+'</span>';
  };
  const _incRow=r=>{
    const c=clients.find(x=>x.id===r.client_id);
    // data-label drives the mobile card layout (CSS turns each row into a stacked
    // card on ≤767px, no horizontal scroll). Desktop still renders a real table.
    return '<tr data-lp-id="'+r.id+'" data-lp-type="'+r._src+'" data-lp-label="'+escHtml((r.client_name||'record')+' · '+fmt(r.amount||0))+'">'+
      '<td class="bold" data-label="Client">'+(r.client_name||'-')+'</td>'+
      '<td class="'+(r.amount<0?'red':'green')+'" data-label="Amount">'+(r.amount<0?'('+fmtD(Math.abs(r.amount))+')':fmtD(r.amount))+'</td>'+
      '<td class="mute" data-label="Date">'+(r.date||'')+'</td>'+
      '<td class="mute" data-label="Type">'+r.type+'</td>'+
      '<td data-label="Method">'+_methodBadge(r.method)+'</td>'+
    '</tr>';
  };
  try{
    html+='<div class="bk-months">'+months.map(mo=>{
      const rows=byMonth[mo];
      const moTotal=rows.reduce((s,r)=>s+r.amount,0);
      const[y,m]=mo.split('-');
      const moLabel=y&&m?new Date(parseInt(y),parseInt(m)-1,1).toLocaleDateString('en-US',{month:'long',year:'numeric'}):mo;
      const isOpen=mo.match(/^\d{4}-\d{2}$/)&&mo>=curMo;
      return '<div id="bk-inc-mo-'+mo+'" class="bk-month'+(isOpen?' open':'')+'">'+
        '<button class="bk-month-hd" onclick="_bkTogMonth(\'inc\',\''+mo+'\')">'+
          '<div style="flex:1;text-align:left">'+
            '<div class="bk-month-title">'+moLabel+'</div>'+
            '<div class="bk-month-sub">'+rows.length+' record'+(rows.length!==1?'s':'')+'</div>'+
          '</div>'+
          '<div style="display:flex;align-items:center;gap:10px">'+
            '<div style="font-size:15px;font-weight:900;color:var(--green-mid);font-variant-numeric:tabular-nums;font-family:var(--font-display);letter-spacing:-.5px">'+fmt(moTotal)+'</div>'+
            '<div class="bk-month-chev">▸</div>'+
          '</div>'+
        '</button>'+
        '<div class="bk-month-body"'+(isOpen?'':' style="display:none"')+'>'+
          _bkRenderDays('inc',mo,rows,['Client','Amount','Date','Type','Method'],_incRow,480,'var(--green-mid)')+
        '</div>'+
      '</div>';
    }).join('')+'</div>';
  }catch(err){
    console.error('renderIncome error:',err);
    html+='<div class="tip tip-a">Error rendering income, check console. ('+err.message+')</div>';
  }
  el.innerHTML=html;
}
function triggerReceiptScan(){_scanAndFillBooksExpense();}

function processReceiptPhoto(input){input.value='';_scanAndFillBooksExpense();}

function _scanAndFillBooksExpense(){
  // Open the expense modal first, then immediately trigger the scan button inside it.
  // The old inline books form fields (exp-vendor etc.) no longer exist, the modal
  // uses em-* fields and expTriggerScan() handles the full scan→AI→fill flow.
  openExpenseFlow();
  setTimeout(()=>expTriggerScan(),80);
}

function populateExpJobSel(){
  const sel=document.getElementById('exp-job-sel');if(!sel)return;
  const wonJobs=bids.filter(b=>b.status==='Closed Won');
  sel.innerHTML='<option value="">- Not job-specific -</option>'+
    wonJobs.map(b=>'<option value="'+b.id+'">'+(b.client_name||b.name)+(b.addr?' · '+b.addr:'')+'</option>').join('');
}
function renderExpenses(){
  const el=document.getElementById('exp-table');if(!el)return;
  const yr=String(trackerYear||new Date().getFullYear());
  let filtered=yr==='all'?expenses:expenses.filter(e=>e.date&&e.date.startsWith(yr));
  // One method per vehicle (IRS): a mileage-method vehicle's fuel/maintenance/purchase
  // records are covered by the per-mile rate, they don't deduct and don't show here.
  const _vdE=(yr!=='all'&&typeof _vehSchedC==='function')?_vehSchedC(yr):null;
  const _exclSet=new Set(_vdE?_vdE.excludedIds:[]);
  const _hiddenVeh=_exclSet.size?filtered.filter(e=>_exclSet.has(e.id)):[];
  if(_hiddenVeh.length)filtered=filtered.filter(e=>!_exclSet.has(e.id));
  const total=filtered.reduce((s,e)=>s+e.amount,0);
  const noReceipt=filtered.filter(e=>!e.receipt||typeof e.receipt==='string'&&e.receipt.includes('No')).filter(e=>e.cat!=='fees'&&!e.autoLogged);
  const today=todayKey();
  const purgeable=expenses.filter(e=>e.expires_at&&e.expires_at<today&&e.receipt_img);
  let html='';
  if(purgeable.length){
    html+='<div class="tip tip-w" style="display:flex;justify-content:space-between;align-items:center"><span>'+purgeable.length+' receipt image'+(purgeable.length>1?'s':'')+' past 7 years, images can be deleted, records kept</span><button class="btn btn-sm" onclick="purgeOldReceiptImages()" style="flex-shrink:0;margin-left:8px">Clean up</button></div>';
  }
  if(_hiddenVeh.length){
    const _hidTot=_hiddenVeh.reduce((s,e)=>s+(e.amount||0),0);
    const _untagN=_vdE?_vdE.untagged:0;
    html+='<div class="tip tip-w">'+svgIcon('🚗',{size:13})+' <strong>'+_hiddenVeh.length+' vehicle expense'+(_hiddenVeh.length>1?'s':'')+' ('+fmt(_hidTot)+') not shown or deducted</strong>, '+
      (_untagN?_untagN+' need'+(_untagN>1?'':'s')+' a vehicle picked (edit the expense), the rest are covered by the standard-mileage rate.':'covered by the standard-mileage deduction (one method per vehicle, IRS rule). Keep logging them, they still count in the year-end mileage-vs-actual comparison, and switching the vehicle to Actual expenses in Fleet deducts them instead.')+'</div>';
  }
  // Both entry paths count: 'subs' (full modal) + 'Subcontractors' (quick modal),
  // plus job-sheet sub payouts via the full report engine.
  const subsFiltered=filtered.filter(e=>e.cat==='subs'||e.cat==='Subcontractors');
  if(subsFiltered.length){
    const subsBy={};
    subsFiltered.forEach(e=>{const k=(e.vendor||'Unknown').trim();subsBy[k]=(subsBy[k]||0)+e.amount;});
    const flagged=Object.entries(subsBy).filter(([,amt])=>amt>=600);
    if(flagged.length){
      html+='<div class="tip tip-a" onclick="if(typeof open1099Report===\'function\')open1099Report('+(yr==='all'?'null':yr)+')" style="background:#FFF3CD;border:1.5px solid #D4A017;color:#6B4C00;cursor:pointer"><strong>'+svgIcon('⚠',{size:13})+' 1099-NEC Required:</strong> '+flagged.length+' subcontractor'+(flagged.length>1?'s':'')+' reached $600+ in '+yr+', file Form 1099-NEC by Jan 31. '+flagged.map(([v,a])=>v+' ('+fmt(a)+')').join(', ')+' <span style="font-weight:800;text-decoration:underline">Tap for the full per-job report →</span></div>';
    }
  }
  if(noReceipt.length){
    const missingPct=filtered.length>0?Math.round(noReceipt.length/filtered.length*100):0;
    const cls=missingPct>30?'tip-a':'tip-w';
    html+='<div class="tip '+cls+'"><strong>'+noReceipt.length+' missing receipt'+(noReceipt.length>1?'s':'')+' ('+missingPct+'% of '+yr+' expenses)</strong>'+(missingPct>30?', '+svgIcon('⚠',{size:12})+' Over 30% missing. IRS can disallow undocumented expenses.':', photograph them before they\'re gone.')+'</div>';
  }
  if(!expenses.length){el.innerHTML=html+'<div class="empty-state"><div class="empty-state-icon">'+svgIcon('🧾',{size:44})+'</div><h3>No expenses yet</h3><p>Tap the Expense button on the home screen or use the Scan button above to photograph a receipt.</p></div>';return;}
  if(!filtered.length){el.innerHTML=html+'<div class="empty">No expenses in '+yr+'.</div>';return;}
  html+='<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0 12px;border-bottom:2px solid var(--border);margin-bottom:8px;flex-wrap:wrap;gap:6px">'+
    '<div><span style="font-size:12px;font-weight:700;color:var(--text3)">'+filtered.length+' expense'+(filtered.length!==1?'s':'')+' in '+yr+'</span></div>'+
    '<div style="font-size:16px;font-weight:800;color:#A32D2D">('+fmt(total)+')</div>'+
  '</div>';
  // Group by month, newest-first within each month
  const sorted=[...filtered].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const byMonth={};
  sorted.forEach(r=>{const mo=(r.date||'').slice(0,7)||'unknown';if(!byMonth[mo])byMonth[mo]=[];byMonth[mo].push(r);});
  const months=Object.keys(byMonth).sort((a,b)=>b.localeCompare(a));
  const curMo=new Date().toISOString().slice(0,7);
  const _expRow=r=>{
    const info=IRS_EXPENSE_CATS.find(c=>c.id===r.cat);
    const pageCount=(r.receipt_keys?.length||0)+(r.receipt_key&&!r.receipt_keys?1:0);
    const hasBucket=!!r.receipt_key||pageCount>0,hasInline=!!r.receipt_img,hasImg=hasBucket||hasInline;
    const pgLabel=pageCount>1?' ('+pageCount+'pg)':'';
    const recLabel=hasImg
      ?(hasBucket
        ?'<button onclick="viewReceipt('+r.id+')" style="background:var(--green-lt);border:1px solid var(--green);color:var(--green);font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;cursor:pointer;font-family:inherit">'+svgIcon('☁',{size:11})+' View'+pgLabel+'</button>'
        :'<button onclick="viewReceipt('+r.id+')" style="background:#fff8e1;border:1px solid #f59e0b;color:#b45309;font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;cursor:pointer;font-family:inherit">'+svgIcon('💾',{size:11})+' View</button>')
      :'<button onclick="addReceiptToExpense('+r.id+')" style="background:rgba(162,45,45,.08);border:1px solid #A32D2D;color:#A32D2D;font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;cursor:pointer;font-family:inherit">+ Add</button>';
    return '<tr data-lp-id="'+r.id+'" data-lp-type="expense" data-lp-label="'+escHtml((r.vendor||'expense')+' · '+fmt(r.amount||0))+'">'+
      '<td class="bold" data-label="Vendor">'+(r.vendor||'-')+(r.job_name?'<div style="font-size:9px;color:var(--text3)">'+r.job_name+'</div>':'')+'</td>'+
      '<td class="red" data-label="Amount">('+fmtD(r.amount||0)+')'+(r.meals_50?'<div style="font-size:9px;color:var(--amber)">50% deduct</div>':'')+'</td>'+
      '<td class="mute" data-label="Date">'+(r.date||'')+'</td>'+
      '<td class="mute" style="font-size:10px" data-label="Category">'+(info?info.icon+' '+info.label:r.catLabel||r.cat||'-')+'</td>'+
      '<td data-label="Receipt">'+recLabel+'</td>'+
      '<td data-label="">'+'<button onclick="editExpense('+r.id+')" style="font-size:11px;padding:3px 9px;border-radius:4px;border:1px solid var(--border2);background:var(--bg2);color:var(--text);cursor:pointer;font-family:inherit;font-weight:600">Edit</button></td>'+
    '</tr>';
  };
  try{
    html+='<div class="bk-months">'+months.map(mo=>{
      const rows=byMonth[mo];
      const moTotal=rows.reduce((s,r)=>s+r.amount,0);
      const[y,m]=mo.split('-');
      const moLabel=y&&m?new Date(parseInt(y),parseInt(m)-1,1).toLocaleDateString('en-US',{month:'long',year:'numeric'}):mo;
      const isOpen=mo.match(/^\d{4}-\d{2}$/)&&mo>=curMo;
      return '<div id="bk-exp-mo-'+mo+'" class="bk-month'+(isOpen?' open':'')+'">'+
        '<button class="bk-month-hd" onclick="_bkTogMonth(\'exp\',\''+mo+'\')">'+
          '<div style="flex:1;text-align:left">'+
            '<div class="bk-month-title">'+moLabel+'</div>'+
            '<div class="bk-month-sub">'+rows.length+' expense'+(rows.length!==1?'s':'')+'</div>'+
          '</div>'+
          '<div style="display:flex;align-items:center;gap:10px">'+
            '<div style="font-size:15px;font-weight:900;color:#A32D2D;font-variant-numeric:tabular-nums;font-family:var(--font-display);letter-spacing:-.5px">('+fmt(moTotal)+')</div>'+
            '<div class="bk-month-chev">▸</div>'+
          '</div>'+
        '</button>'+
        '<div class="bk-month-body"'+(isOpen?'':' style="display:none"')+'>'+
          _bkRenderDays('exp',mo,rows,['Vendor','Amount','Date','Category','Receipt'],_expRow,560,'#A32D2D')+
        '</div>'+
      '</div>';
    }).join('')+'</div>';
  }catch(err){
    console.error('renderExpenses error:',err);
    html+='<div class="tip tip-a">Error rendering expenses, check console. ('+err.message+')</div>';
  }
  // Category breakdown chips
  const byCat={};
  filtered.forEach(e=>{byCat[e.cat||'other']=(byCat[e.cat||'other']||0)+e.amount;});
  const topCats=Object.entries(byCat).sort((a,b)=>b[1]-a[1]).slice(0,4);
  if(topCats.length>1){
    html+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px">'+
      topCats.map(([cat,amt])=>{
        const info=IRS_EXPENSE_CATS.find(c=>c.id===cat);
        return '<div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:6px 10px;font-size:11px">'+
          '<span style="font-weight:700;color:var(--text2)">'+(info?info.icon+' '+info.label:cat)+'</span>'+
          ' <span style="color:#A32D2D;font-weight:700">('+fmt(amt)+')</span>'+
        '</div>';
      }).join('')+
    '</div>';
  }
  el.innerHTML=html;
}

async function purgeOldReceiptImages(){
  if(!supaEnabled()||!_supaUser)return zAlert('Sign in to manage cloud receipts.');
  const today=todayKey();
  const old=expenses.filter(e=>e.expires_at&&e.expires_at<today&&e.receipt_img);
  zConfirm('Delete '+old.length+' receipt image'+(old.length>1?'s':'')+' older than 7 years? Dollar amounts and records are kept permanently, only the photos are removed.',async()=>{
    for(const e of old){
      e.receipt_img=null;e.receipt_key=null;e.receipt='Records kept, image purged after 7 years';
    }
    saveAll();renderExpenses();showToast(old.length+' receipt images purged, records kept','🗑️');
  },{title:'Purge old receipt images',yes:'Delete images',danger:true});
}
function delExpense(id){_userDelete(()=>{expenses=expenses.filter(x=>x.id!==id);_flushSaveNow&&_flushSaveNow();});renderExpenses();}

function editExpense(id){
  const exp=expenses.find(e=>e.id===id);if(!exp)return;
  openExpenseFlow();
  _expState.editId=id;
  setTimeout(()=>{
    const sv=(elId,v)=>{const el=document.getElementById(elId);if(el)el.value=v||'';};
    sv('em-vendor',exp.vendor);
    sv('em-amount',exp.amount);
    if(exp.date){const m=exp.date.match(/(\d{4})-(\d{2})-(\d{2})/);const el=document.getElementById('em-date');if(el)el.value=m?m[2]+'/'+m[3]+'/'+m[1]:exp.date;}
    sv('em-cat',exp.cat);
    sv('em-notes',exp.notes);
    if(exp.job_id)sv('em-job',exp.job_id);
    toggleExpenseSections();
    if(exp.vehicleName)sv('em-vehicle',exp.vehicleName);
    if(exp.lead_source)sv('em-mkt-source',exp.lead_source);
    if(exp.meal_purpose)sv('em-meal-purpose',exp.meal_purpose);
    if(exp.meal_attendees)sv('em-meal-attendees',exp.meal_attendees);
    const title=document.querySelector('#expense-modal [style*="font-size:18px"]');
    if(title)title.textContent='Edit expense';
    const saveBtn=document.getElementById('exp-save-btn');
    if(saveBtn)saveBtn.textContent='Save changes';
    if(exp.receipt_keys?.length||exp.receipt_key||exp.receipt_img){
      const pc=exp.receipt_keys?.length||(exp.receipt_key?1:0);
      const preview=document.getElementById('exp-preview-img');
      if(preview){
        preview.style.display='block';
        preview.innerHTML='<div style="font-size:11px;color:var(--green-mid);font-weight:700;margin-bottom:6px">'+svgIcon('☁',{size:12})+' '+pc+' receipt page'+(pc>1?'s':'')+' on file</div>'+
          '<button type="button" onclick="expTriggerAttach(true)" style="font-size:11px;padding:5px 10px;border-radius:var(--r);border:1.5px dashed var(--blue);background:var(--blue-lt);color:var(--blue-dk);cursor:pointer;font-family:inherit;font-weight:700">+ Add another page</button>';
      }
    }
    const saveErr=document.getElementById('exp-save-err');
    if(saveErr){
      const delBtn=document.createElement('button');
      delBtn.type='button';delBtn.textContent='Delete this expense';
      delBtn.style.cssText='width:100%;margin-top:10px;padding:10px;border-radius:var(--r);border:1px solid #A32D2D;background:none;color:#A32D2D;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit';
      delBtn.onclick=()=>zConfirm('Delete this expense?',()=>{delExpense(id);closeExpenseFlow();},{title:'Delete expense',yes:'Delete',danger:true});
      saveErr.after(delBtn);
    }
  },0);
}

function renderSummary(){
  const yr=String(trackerYear||new Date().getFullYear());
  const sumSel=document.getElementById('sum-tx-status');
  if(sumSel&&S.txStatus)sumSel.value=S.txStatus;
  const yInc=income.filter(r=>r.date&&r.date.startsWith(yr));
  const yExp=expenses.filter(e=>e.date&&e.date.startsWith(yr));
  const yMi=mileage.filter(m=>m.date&&m.date.startsWith(yr));
  const tIn=yInc.reduce((s,r)=>s+r.amount,0);
  const _vdS=(typeof _vehSchedC==='function')?_vehSchedC(yr):null; // one method per vehicle (IRS)
  const tEx=yExp.reduce((s,r)=>s+r.amount,0)-(_vdS?_vdS.expAdjust:0);
  const tMi=yMi.reduce((s,r)=>s+(r.miles||0),0);
  const irsRateYr=_getIrsRateForYear(yr);
  const _mileDedS=_vdS?_vdS.mileDed:tMi*irsRateYr;
  const net=Math.max(0,tIn-tEx-_mileDedS);
  const tax=estimateTax(net,yr);
  const profit=tIn-tEx-_mileDedS-tax;
  document.getElementById('sum-mets').innerHTML=
    '<div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">'+yr+' summary</div>'+
    '<div class="mets">'+
    '<div class="met"><div class="met-l">Income</div><div class="met-v" style="color:var(--green-mid)">'+fmt(tIn)+'</div></div>'+
    '<div class="met"><div class="met-l">Expenses</div><div class="met-v" style="color:#A32D2D">'+fmt(tEx)+'</div></div>'+
    '<div class="met"><div class="met-l">Mileage</div><div class="met-v">'+fmt(_mileDedS)+'</div><div class="met-s">'+(_vdS?_vdS.deductedMiles:tMi).toFixed(0)+' mi · $'+irsRateYr.toFixed(3)+'/mi</div></div>'+
    '<div class="met"><div class="met-l">Est. tax</div><div class="met-v" style="color:var(--amber)">'+fmt(tax)+'</div></div>'+
    '<div class="met" style="grid-column:1/-1"><div class="met-l">Net profit</div><div class="met-v" style="color:'+(profit>=0?'var(--green-mid)':'#A32D2D')+'">'+fmt(profit)+'</div><div class="met-s">After tax &amp; deductions</div></div>'+
    '</div>';
  const byType={};yInc.forEach(r=>{byType[r.type]=(byType[r.type]||0)+r.amount;});
  const byCat={};yExp.forEach(r=>{byCat[r.cat]=(byCat[r.cat]||0)+r.amount;});
  document.getElementById('sum-inc').innerHTML=!tIn?'<div class="empty">No income in '+yr+'.</div>':Object.entries(byType).sort((a,b)=>b[1]-a[1]).map(([k,vl])=>barChart(k,vl,tIn,'#185FA5')).join('');
  document.getElementById('sum-exp').innerHTML=!tEx?'<div class="empty">No expenses in '+yr+'.</div>':Object.entries(byCat).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k,vl])=>barChart(k,vl,tEx,'#E24B4A')).join('');
  const byClient={};yMi.forEach(m=>{const k=m.client_name||'Unlinked';byClient[k]=(byClient[k]||0)+(m.miles||0);});
  document.getElementById('sum-mile').innerHTML=!tMi?'<div class="empty">No mileage in '+yr+'.</div>':Object.entries(byClient).sort((a,b)=>b[1]-a[1]).map(([k,mi])=>'<div style="display:flex;justify-content:space-between;font-size:12px;padding:5px 0;border-bottom:1px solid var(--border)"><span>'+escHtml(k)+'</span><span style="font-weight:700">'+mi.toFixed(1)+' mi · '+fmt(mi*irsRateYr)+'</span></div>').join('');
}

// ── Money page ────────────────────────────────────────────────────────────
let moneyFilter='all';
function setMoneyFilter(f,btn){
  moneyFilter=f;
  document.querySelectorAll('[id^=mft-]').forEach(b=>b.classList.remove('active'));
  const ab=btn||document.getElementById('mft-'+f);if(ab)ab.classList.add('active');
  renderMoneyPage();
}
function renderMoneyPage(){
  const el=document.getElementById('money-list');if(!el)return;
  const _lienSub=document.getElementById('money-lien-sub');
  if(_lienSub){const _ls=(typeof STATE_LIEN!=='undefined'&&STATE_LIEN[S?.state])?STATE_LIEN[S.state].statute:'applicable state law';_lienSub.textContent='Pre-written SMS for each escalation stage. Lien deadlines auto-tracked under '+_ls+'.';}

  const summEl=document.getElementById('money-summary');
  const tk=todayKey();
  const allItems=[];
  bids.filter(b=>b.status==='Closed Won'&&(getBidBalance(b)>0.01||b.collStage==='lien_filed')).forEach(b=>{
    const c=getClientById(b.client_id);if(!c)return;
    const balance=getBidBalance(b);
    const paid=getBidPaid(b.id);
    const total=b.amount||0;
    const hasCompletion=!!(b.completion_date);
    const daysUnpaid=hasCompletion&&balance>0.01?Math.floor((new Date(tk+'T12:00')-new Date(b.completion_date+'T12:00'))/86400000):0;
    b.collStage=b.collStage||'none';
    // Auto-advance collection stage
    if(hasCompletion&&balance>0.01){
      const autoStage=getAutoCollStage(daysUnpaid,b.collStage);
      if(autoStage!==b.collStage){b.collStage=autoStage;}
    }
    let bucket,urgency;
    if(balance<=0.01){bucket='paid';urgency=0;}
    else if(!hasCompletion){bucket='unpaid';urgency=1;}
    else{bucket='overdue';urgency=daysUnpaid*1000+balance;}
    allItems.push({c,b,balance,paid,total,bucket,urgency,daysUnpaid,hasCompletion});
  });
  // Summary card
  const totalOwed=allItems.filter(x=>x.bucket!=='paid').reduce((s,x)=>s+x.balance,0);
  const overdueCt=allItems.filter(x=>x.bucket==='overdue').length;
  const paidThisMonth=allItems.filter(x=>x.bucket==='paid'&&x.b.completion_date&&x.b.completion_date.startsWith(String(new Date().getFullYear())+'-'+String(new Date().getMonth()+1).padStart(2,'0'))).reduce((s,x)=>s+x.total,0);
  // Update eyebrow
  const eyebrowEl=document.getElementById('money-tbar-eyebrow');
  if(eyebrowEl){
    const overdueCounts=allItems.filter(x=>x.bucket==='overdue');
    if(overdueCounts.length){
      const oldest=Math.max(...overdueCounts.map(x=>x.daysUnpaid||0));
      eyebrowEl.textContent=overdueCounts.length+' account'+(overdueCounts.length!==1?'s':'')+' past due · oldest is '+oldest+'d out';
    } else {
      eyebrowEl.textContent='Collect';
    }
  }
  // Show/hide send all reminders button
  const sendAllBtn=document.getElementById('money-send-all-btn');
  if(sendAllBtn){
    const smsEligible=allItems.filter(x=>x.bucket==='overdue'&&x.b.completion_date&&getClientById(x.b.client_id)?.phone);
    sendAllBtn.style.display=smsEligible.length?'':'none';
  }
  if(summEl){
    const lienOpen=allItems.filter(x=>x.bucket==='overdue'&&x.b.completion_date).filter(x=>{
      const {daysUntilDeadline}=getLienTimeline?.(x.b)||{daysUntilDeadline:999};
      return daysUntilDeadline>0&&daysUntilDeadline<=60;
    }).length;
    const avgDaysOut=allItems.filter(x=>x.bucket==='overdue'&&x.daysUnpaid>0).reduce((s,x,_,a)=>s+x.daysUnpaid/a.length,0)||0;
    summEl.innerHTML='<div class="mets">'+
      '<div class="met"><div class="met-l">Total outstanding</div><div class="met-v" style="color:'+(totalOwed>0?'var(--c-red)':'var(--c-green)')+'">'+fmt(totalOwed)+'</div><div class="met-s">across '+allItems.filter(x=>x.bucket!=='paid').length+' accounts</div></div>'+
      '<div class="met"><div class="met-l">Avg days out</div><div class="met-v">'+(avgDaysOut?Math.round(avgDaysOut)+'<span class="unit">d</span>':'-')+'</div><div class="met-s">target ≤ 14d</div></div>'+
      '<div class="met"><div class="met-l">Lien windows open</div><div class="met-v" style="color:'+(lienOpen?'var(--c-amber)':'var(--text-3)')+'">'+lienOpen+'</div><div class="met-s">'+(lienOpen?'act before deadline':'none expiring soon')+'</div></div>'+
      '<div class="met"><div class="met-l">Collected this month</div><div class="met-v" style="color:var(--c-green)">'+fmt(paidThisMonth)+'</div></div>'+
    '</div>';
  }
  // Money badge
  const badge=document.getElementById('nb-money-badge');
  if(badge){
    const n=overdueCt;
    badge.textContent=n||'';badge.style.display=n?'':'none';
  }
  // Filter
  const show=moneyFilter==='all'?allItems.filter(x=>x.bucket!=='paid'):
    allItems.filter(x=>x.bucket===moneyFilter);
  // Sort: most days unpaid first, then highest balance
  show.sort((a,b)=>(b.daysUnpaid||0)-(a.daysUnpaid||0)||(b.balance-a.balance));
  if(!show.length){
    el.innerHTML='<div class="empty">'+(moneyFilter==='paid'?'No paid jobs in records.':moneyFilter==='all'?'Nothing outstanding, all collected! '+svgIcon('🎉'):'No '+moneyFilter+' items.')+'</div>';return;
  }
  el.innerHTML=show.map(({c,b,balance,paid,total,bucket,daysUnpaid})=>{
    const pct=total>0?Math.min(100,Math.round(paid/total*100)):0;
    const stage=b.collStage||'none';
    const csInfo=COLL_STAGES[stage]||{};
    const phone=c.phone?c.phone.replace(/\D/g,''):'';
    // Stage badge color (design spec)
    const stageLabel=bucket==='overdue'?(daysUnpaid>=30?'30d+':daysUnpaid>=21?'21d':daysUnpaid>=14?'14d':daysUnpaid>0?'7d':'Due'):bucket==='paid'?'Paid':'Unsent';
    const stageColor=bucket==='overdue'?(daysUnpaid>=21?'var(--c-red)':daysUnpaid>=14?'var(--c-amber)':'var(--text-2)'):bucket==='paid'?'var(--c-green)':'var(--text-3)';
    const stageBg=bucket==='overdue'?(daysUnpaid>=21?'var(--c-red-soft)':daysUnpaid>=14?'var(--c-amber-soft)':'var(--cream)'):bucket==='paid'?'var(--c-green-soft)':'var(--cream)';
    const stageBorder=bucket==='overdue'?(daysUnpaid>=21?'var(--c-red-edge)':daysUnpaid>=14?'var(--c-amber-edge)':'var(--line)'):bucket==='paid'?'var(--c-green-edge)':'var(--line)';
    const {daysUntilDeadline}=getLienTimeline(b)||{daysUntilDeadline:999};
    const lienWarn=daysUntilDeadline>0&&daysUntilDeadline<=30?
      ' <span style="color:var(--c-red);font-weight:700">· '+svgIcon('⚠',{size:12})+' Lien: '+daysUntilDeadline+'d left</span>':'';
    const nxt=getNextCollAction(stage);
    let nextBtn='';
    if(nxt.smsKey){
      nextBtn='<button class="btn btn-sm" onclick="collSendSMS(bids.find(x=>x.id=='+b.id+'),\''+nxt.smsKey+'\')" style="font-size:11px">'+svgIcon('💬',{size:12})+' '+nxt.label+'</button>';
    } else if(stage==='intent'||stage==='lien_ready'){
      nextBtn='<button class="btn btn-sm" onclick="showFileLienDirect('+b.id+')" style="font-size:11px;background:var(--c-deep);color:var(--c-deep-soft);border-color:transparent">'+svgIcon('⚖',{size:12})+' '+nxt.label+'</button>';
    } else if(stage==='lien_filed'){
      nextBtn='<button class="btn btn-sm" onclick="releaseLien('+b.id+')" style="font-size:11px;background:var(--c-green-soft);color:var(--c-green);border-color:var(--c-green-edge)">'+nxt.label+'</button>';
    }
    return '<div style="padding:14px 18px;border-bottom:1px solid var(--line);cursor:pointer" onclick="openClientDetail('+c.id+',\'money\')" >'+
      '<div style="display:flex;align-items:center;gap:10px">'+
        '<div style="font-family:var(--font-display);font-size:14px;font-weight:900;color:'+stageColor+';background:'+stageBg+';border:1px solid '+stageBorder+';border-radius:8px;padding:6px 10px;min-width:52px;text-align:center;letter-spacing:-.4px;flex-shrink:0">'+stageLabel+'</div>'+
        '<div style="flex:1;min-width:0">'+
          '<div style="font-size:14px;font-weight:800;color:var(--text);letter-spacing:-.2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml(c.name)+'</div>'+
          '<div style="font-size:11px;color:var(--text-3);margin-top:1px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml(csInfo.label||'Overdue')+(daysUnpaid>0?' · '+daysUnpaid+'d past completion':'')+lienWarn+'</div>'+
        '</div>'+
        '<div style="text-align:right;flex-shrink:0">'+
          '<div style="font-family:var(--font-display);font-size:18px;font-weight:900;color:'+(bucket==='paid'?'var(--c-green)':'var(--c-red)')+'">'+fmt(bucket==='paid'?total:balance)+'</div>'+
          '<div style="font-size:10px;color:var(--text-3);font-weight:700;letter-spacing:.04em;text-transform:uppercase">'+(bucket==='paid'?'paid':'owed')+'</div>'+
        '</div>'+
      '</div>'+
      (paid>0.01&&total>0?'<div class="pay-bar" style="margin-top:8px"><div class="pay-fill" style="width:'+pct+'%;background:var(--c-green)"></div></div>':'')+
      '<div style="display:flex;gap:6px;margin-top:10px" onclick="event.stopPropagation()">'+
        nextBtn+
        '<button class="btn btn-sm btn-g" onclick="openPayPanel('+b.id+')" style="font-size:11px;flex:1">'+svgIcon('💰',{size:12})+' Log payment</button>'+
      '</div>'+
    '</div>';
  }).join('');
}
// ── Lightweight nav badge update (called from renderDash when other pages aren't active) ──
function _updateNavBadges(){
  clients.forEach(c=>{
    const s=getClientStage(c.id).stage;
    c._stage=s; // cache for this render pass
  });
  const fu=clients.filter(c=>c._stage==='bid_urgent').length;
  const lb=document.getElementById('nb-leads-badge');
  if(lb){lb.textContent=fu||'';lb.style.display=fu?'':'none';}
  const ld=document.getElementById('mtb-leads-dot');
  if(ld){ld.style.display=fu?'':'none';}
  const jn=clients.filter(c=>['active','scheduled','signed'].includes(c._stage)).length;
  const jb=document.getElementById('nb-jobs-badge');
  if(jb){jb.textContent=jn||'';jb.style.display=jn?'':'none';}
  const jd=document.getElementById('mtb-jobs-dot');
  if(jd){jd.style.display=jn?'':'none';}
}
// ── Send all reminders button on collect page ─────────────────────────────
function collSendAllReminders(){
  const tk=todayKey();
  const due=bids.filter(b=>b.status==='Closed Won'&&getBidBalance(b)>0.01&&b.completion_date);
  if(!due.length){zAlert('No outstanding balances to send reminders for.',{title:'All clear'});return;}
  const count=due.filter(b=>{const c=getClientById(b.client_id);return c&&c.phone;}).length;
  zConfirm('Send SMS reminders to '+count+' client'+(count!==1?'s':'')+' with outstanding balances?',{title:'Send all reminders',ok:'Send '+count,cancel:'Cancel'},()=>{
    due.forEach(b=>{
      const c=getClientById(b.client_id);if(!c||!c.phone)return;
      const stage=b.collStage||'none';
      const nxt=getNextCollAction(stage);
      if(nxt.smsKey)collSendSMS(b,nxt.smsKey);
    });
    showToast('Reminders queued','📤');
    setTimeout(renderMoneyPage,400);
  });
}

// ── Manual invoice alias ───────────────────────────────────────────────────
function openManualInvoiceModal(){
  // Route to the log payment / manual invoice flow via pay panel if bids exist
  openCollectModal();
}

// ── quickAction('collect'): prioritized collect modal ───────────────────
function refreshCollectLabel(){
  const owing=bids.filter(b=>b.status==='Closed Won'&&getBidBalance(b)>0.01);
  const completed=owing.filter(b=>b.completion_date);
  const cl=document.getElementById('qa-collect-label');
  if(cl)cl.textContent=completed.length?'Collect ('+completed.length+')':owing.length?'Collect ('+owing.length+')':'Collect';
  const qb=document.getElementById('qa-collect-btn');
  if(qb){qb.style.background=owing.length?'var(--green)':'var(--border2)';qb.style.borderColor=qb.style.background;qb.style.color=owing.length?'#fff':'var(--text3)';}
}

function openCollectModal(){
  const tk=todayKey();
  const items=[];
  bids.filter(b=>b.status==='Closed Won'&&getBidBalance(b)>0.01).forEach(b=>{
    const c=getClientById(b.client_id);if(!c)return;
    const balance=getBidBalance(b);
    const paid=getBidPaid(b.id);
    const isCompleted=!!(b.completion_date);
    const daysOverdue=isCompleted?Math.floor((new Date(tk+'T12:00')-new Date(b.completion_date+'T12:00'))/86400000):0;
    items.push({c,b,balance,paid,daysOverdue,isCompleted});
  });
  // Sort: most days unpaid first, then highest balance
  items.sort((a,b)=>(b.daysOverdue||0)-(a.daysOverdue||0)||(b.balance-a.balance));
  const overlay=document.createElement('div');
  overlay.className='zmodal-overlay';
  overlay.style.cssText='align-items:center;padding:16px';
  const content=items.length===0?
    '<div style="text-align:center;padding:24px;color:var(--text3)">'+svgIcon('🎉',{size:16})+' Nothing to collect, all paid!</div>':
    items.map(({c,b,balance,paid,daysOverdue,isCompleted})=>{
      const urgTag=!isCompleted?'<span style="font-size:10px;background:var(--border2);color:var(--text3);padding:2px 5px;border-radius:4px;font-weight:800">Job not done</span>':
        daysOverdue>=7?'<span style="font-size:10px;background:#A32D2D;color:#fff;padding:2px 5px;border-radius:4px;font-weight:800">'+daysOverdue+'d overdue</span>':
        daysOverdue>0?'<span style="font-size:10px;background:var(--amber);color:#fff;padding:2px 5px;border-radius:4px;font-weight:800">Due</span>':
        paid>0.01?'<span style="font-size:10px;background:var(--blue-lt);color:var(--blue-dk);padding:2px 5px;border-radius:4px;font-weight:800">Partial</span>':
        '<span style="font-size:10px;background:var(--green-lt);color:var(--green);padding:2px 5px;border-radius:4px;font-weight:800">Completed</span>';
      const phone=c.phone?c.phone.replace(/\D/g,''):'';
      return '<div style="padding:12px;border-bottom:1px solid var(--border)">'+
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">'+
          '<div>'+
            '<div style="font-size:14px;font-weight:700">'+c.name+' '+urgTag+'</div>'+
            '<div style="font-size:11px;color:var(--text3);margin-top:2px">'+fmt(balance)+' owed'+(paid>0.01?' · '+fmt(paid)+' paid':'')+'</div>'+
          '</div>'+
          '<div style="font-size:18px;font-weight:800;color:#A32D2D">'+fmt(balance)+'</div>'+
        '</div>'+
        '<div style="display:flex;gap:6px">'+
          '<button class="btn btn-sm btn-g" onclick="document.querySelector(\'.zmodal-overlay\').remove();openClientDetail('+c.id+');setTimeout(()=>{setCDTab(\'bids\',null);setTimeout(()=>openPayPanel('+b.id+'),100)},200)" style="flex:1;font-size:13px;padding:10px 14px">'+svgIcon('💰',{size:14})+' Log payment</button>'+
        '</div>'+
      '</div>';
    }).join('');
  overlay.innerHTML=
    '<div style="background:var(--bg);border-radius:var(--rl);width:100%;max-width:420px;max-height:80vh;overflow-y:auto">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid var(--border2)">'+
        '<div style="font-size:16px;font-weight:800">Collect payment</div>'+
        '<div style="display:flex;gap:8px;align-items:center">'+
          '<button class="btn btn-sm" onclick="goPg(\'pg-money\');document.querySelector(\'.zmodal-overlay\').remove()">See all</button>'+
          '<button onclick="document.querySelector(\'.zmodal-overlay\').remove()" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--text3);padding:0 4px">×</button>'+
        '</div>'+
      '</div>'+
      content+
    '</div>';
  document.body.appendChild(overlay);
  overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});
}

function renderChecklist(){
  const done=CHECKS.filter(c=>checksState[c.title]).length,pct=Math.round(done/CHECKS.length*100);
  const prog=document.getElementById('chk-progress');
  const body=document.getElementById('chk-body');
  if(!prog||!body)return;
  prog.innerHTML=`<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px;font-weight:600"><span>${done} of ${CHECKS.length} completed</span><span>${pct}%</span></div><div class="prog-bar" style="height:8px"><div class="prog-fill" style="width:${pct}%"></div></div>`;
  body.innerHTML=Object.entries(CAT_CFG).map(([cat,cfg])=>{
    const items=CHECKS.filter(c=>c.cat===cat);
    return`<div class="card"><div style="font-size:12px;font-weight:700;color:${cfg.color};margin-bottom:10px;text-transform:uppercase;letter-spacing:.04em">${cfg.label}</div>`+items.map(c=>`<div class="check-item"><input type="checkbox" ${checksState[c.title]?'checked':''} onchange="toggleCheck(this,'${c.title.replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'\\"')}')"><div><div class="ctitle ${checksState[c.title]?'done':''}">${c.title}</div><div class="cdesc">${c.desc}</div></div></div>`).join('')+'</div>';
  }).join('');
}
function toggleCheck(el,title){checksState[title]=el.checked;saveAll();renderChecklist();}


function toggleDarkMode(on){
  if(document.body&&document.body.classList)document.body.classList.toggle('dark', on);
  S.darkMode = on;
  S.settingsTs=Date.now();
  saveAll();
}
