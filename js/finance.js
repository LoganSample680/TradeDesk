// ── IRS Schedule C expense categories ────────────────────────────────
let _expState={imageData:null,imageKey:null};

function openExpenseFlow(){
  if(document.getElementById('expense-modal'))return;
  const ov=document.createElement('div');
  ov.id='expense-modal';
  ov.style.cssText='position:fixed;inset:0;z-index:9990;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;animation:fadein .15s;padding:16px';
  const catOpts=IRS_EXPENSE_CATS.map(c=>'<option value="'+c.id+'">'+c.icon+' '+c.label+'</option>').join('');
  const jobOpts='<option value="">— Not tied to a specific job —</option>'+
    bids.filter(b=>b.status==='Closed Won').map(b=>'<option value="'+b.id+'">'+(b.client_name||b.name)+(b.addr?' · '+b.addr.split(',')[0]:'')+'</option>').join('');
  const today=new Date().toISOString().slice(0,10);
  ov.innerHTML=
    '<div style="background:var(--bg);border-radius:20px;width:100%;max-width:600px;max-height:92vh;overflow-y:auto;padding:20px 20px 32px">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">'+
        '<div style="font-size:18px;font-weight:800">Log expense</div>'+
        '<button onclick="closeExpenseFlow()" style="border:none;background:none;font-size:24px;cursor:pointer;color:var(--text3)">×</button>'+
      '</div>'+
      '<div id="exp-scan-area" style="border:2px dashed var(--border2);border-radius:14px;padding:20px;text-align:center;margin-bottom:18px;cursor:pointer;background:var(--bg2)" onclick="expTriggerScan()">'+
        '<div style="font-size:36px;margin-bottom:8px">📷</div>'+
        '<div style="font-size:14px;font-weight:700">Scan receipt</div>'+
        '<div style="font-size:12px;color:var(--text3);margin-top:4px">Tap to photograph — AI extracts everything automatically</div>'+
        '<input type="file" id="exp-file-inp" accept="image/*" capture="environment" style="display:none" onchange="expProcessPhoto(this)">'+
      '</div>'+
      '<div id="exp-scan-status" style="display:none;margin-bottom:14px"></div>'+
      '<div id="exp-preview-img" style="display:none;margin-bottom:14px;text-align:center"></div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">'+
        '<div class="f"><label>Vendor / Store *</label><input id="em-vendor" placeholder="Home Depot..." style="font-size:14px"></div>'+
        '<div class="f"><label>Amount * ($)</label><input id="em-amount" type="number" step="0.01" placeholder="0.00" style="font-size:14px"></div>'+
      '</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">'+
        '<div class="f"><label>Date *</label><input id="em-date" type="text" placeholder="MM/DD/YYYY" value="'+today.replace(/(\d{4})-(\d{2})-(\d{2})/,'$2/$3/$1')+'" style="font-size:14px" oninput="_fmtExpDate(this)"></div>'+
        '<div class="f"><label>Category *</label><select id="em-cat" style="font-size:13px" onchange="toggleMealFields()">'+catOpts+'</select></div>'+
      '</div>'+
      '<div id="em-meal-section" style="display:none;background:#FFF8F0;border:1.5px solid #F59E0B;border-radius:var(--r);padding:12px;margin-bottom:12px">'+
        '<div style="font-size:11px;font-weight:700;color:#92400E;margin-bottom:8px;text-transform:uppercase;letter-spacing:.04em">🍽️ Meal — IRS requires business documentation</div>'+
        '<div class="f" style="margin-bottom:8px"><label>Business purpose <span style="color:#A32D2D">*</span></label><input id="em-meal-purpose" placeholder="e.g. Client meeting — reviewed Bettis job scope" style="font-size:13px"></div>'+
        '<div class="f"><label>Who attended</label><input id="em-meal-attendees" placeholder="e.g. Zach + client John Smith" style="font-size:13px"></div>'+
      '</div>'+
      '<div style="margin-bottom:14px">'+
        '<label style="display:block;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--text3);margin-bottom:6px">Link to a job? <span style="font-weight:400;font-size:10px">(optional — skip for back-tax entries)</span></label>'+
        '<select id="em-job" style="font-size:13px;width:100%;padding:10px 12px;border:1.5px solid var(--border2);border-radius:var(--r);background:var(--bg);color:var(--text);font-family:inherit">'+jobOpts+'</select>'+
      '</div>'+
      '<div class="f" style="margin-bottom:16px"><label>Notes (optional)</label><textarea id="em-notes" placeholder="What was this for?" style="min-height:44px;font-size:13px"></textarea></div>'+
      '<button class="btn btn-p btn-full btn-xl" onclick="expSave()" id="exp-save-btn">Save expense</button>'+
      '<div id="exp-save-err" style="color:#A32D2D;font-size:12px;text-align:center;margin-top:8px;min-height:16px"></div>'+
    '</div>';
  document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)closeExpenseFlow();});
  _expState={imageData:null,imageKey:null};
}

function closeExpenseFlow(){document.getElementById('expense-modal')?.remove();_expState={imageData:null,imageKey:null,hasReceipt:false};}
function _fmtExpDate(el){
  let v=el.value.replace(/\D/g,'');
  if(v.length>2)v=v.slice(0,2)+'/'+v.slice(2);
  if(v.length>5)v=v.slice(0,5)+'/'+v.slice(5,9);
  el.value=v;
}
function _ymdToMdY(s){
  if(!s||!s.includes('-'))return s||'';
  const[y,m,d]=s.split('-');return m+'/'+d+'/'+y;
}
function _mdYToYmd(s){
  if(!s||!s.includes('/'))return s||'';
  const p=s.split('/');
  if(p.length!==3||p[2].length!==4)return '';
  return p[2]+'-'+p[0].padStart(2,'0')+'-'+p[1].padStart(2,'0');
}
function expTriggerScan(){document.getElementById('exp-file-inp')?.click();}

async function expProcessPhoto(input){
  const file=input.files[0];if(!file)return;
  const status=document.getElementById('exp-scan-status');
  const scanArea=document.getElementById('exp-scan-area');

  // Get auth token
  let token=null;
  if(_supa){
    const{data}=await _supa.auth.getSession();
    token=data?.session?.access_token||null;
    // If no session, try refreshing
    if(!token){
      const{data:r}=await _supa.auth.refreshSession();
      token=r?.session?.access_token||null;
    }
  }

  if(!token){
    status.style.display='block';
    status.innerHTML='<div class="tip tip-w">Sign in to use receipt scanning. <button class="btn btn-sm btn-p" onclick="supaShowLogin()" style="margin-left:8px">Sign in</button></div>';
    input.value='';return;
  }

  status.style.display='block';
  status.innerHTML='<div class="tip"><strong>📡 Reading receipt...</strong></div>';
  scanArea.style.opacity='.5';
  const b64=await compressAndEncodeImage(file);
  _expState.imageData={b64,type:'image/jpeg'};
  try{
    const resp=await fetch('https://mwtsmctajhrrybblgorf.supabase.co/functions/v1/scan-receipt',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
      body:JSON.stringify({imageBase64:b64,mediaType:'image/jpeg'})
    });
    if(!resp.ok){
      const errText=await resp.text();
      console.warn('scan-receipt response:',resp.status,errText);
      throw new Error('Scan error '+resp.status);
    }
    const parsed=await resp.json();
    if(parsed.vendor)document.getElementById('em-vendor').value=parsed.vendor;
    if(parsed.amount)document.getElementById('em-amount').value=parsed.amount;
    if(parsed.date)document.getElementById('em-date').value=parsed.date;
    if(parsed.category)document.getElementById('em-cat').value=parsed.category;
    if(parsed.notes)document.getElementById('em-notes').value=parsed.notes;
    const preview=document.getElementById('exp-preview-img');
    preview.style.display='block';
    const reader=new FileReader();
    reader.onload=e=>preview.innerHTML='<img src="'+e.target.result+'" style="max-height:80px;border-radius:8px;border:1px solid var(--border)"><div style="font-size:11px;color:var(--green-mid);margin-top:4px;font-weight:700">✓ Receipt captured</div>';
    reader.readAsDataURL(file);
    _expState.hasReceipt=true;
    scanArea.style.opacity='1';scanArea.style.borderColor='var(--green-mid)';
    _confirmReceiptDate(parsed.date||'',status);
  }catch(e){
    console.warn('Receipt scan failed:',e);
    status.innerHTML='<div class="tip tip-w">Could not auto-read — fill in manually below.</div>';
    scanArea.style.opacity='1';
  }
  input.value='';
}

async function compressAndEncodeImage(file){
  return new Promise(resolve=>{
    const img=new Image();
    const url=URL.createObjectURL(file);
    img.onload=()=>{
      const MAX=1200;let w=img.width,h=img.height;
      if(w>MAX){h=Math.round(h*(MAX/w));w=MAX;}
      if(h>MAX){w=Math.round(w*(MAX/h));h=MAX;}
      const canvas=document.createElement('canvas');
      canvas.width=w;canvas.height=h;
      canvas.getContext('2d').drawImage(img,0,0,w,h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg',0.85).split(',')[1]);
    };
    img.src=url;
  });
}

function _confirmReceiptDate(aiDate,statusEl){
  const existing=document.getElementById('rcpt-date-confirm');
  if(existing)existing.remove();
  const div=document.createElement('div');
  div.id='rcpt-date-confirm';
  div.style.cssText='background:#FEF3C7;border:1px solid #D97706;border-radius:var(--r);padding:10px 12px;margin-top:8px';
  let displayDate=aiDate||'(no date found)';
  try{if(aiDate){const d=new Date(aiDate+'T12:00:00');displayDate=d.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});}}catch(e){}
  div.innerHTML=
    '<div style="font-size:11px;font-weight:700;color:#92400E;margin-bottom:6px">📅 AI read date as: <strong>'+displayDate+'</strong> — correct?</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">'+
      '<button id="rcpt-yes-btn" style="padding:8px;border-radius:var(--r);border:none;background:#D97706;color:#fff;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">✓ Yes</button>'+
      '<button id="rcpt-no-btn" style="padding:8px;border-radius:var(--r);border:1px solid #D97706;background:#fff;color:#92400E;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">✗ Let me fix it</button>'+
    '</div>';
  const scanArea=document.getElementById('exp-scan-area');
  if(scanArea)scanArea.after(div);
  div.querySelector('#rcpt-yes-btn').onclick=()=>{
    const el=document.getElementById('em-date');
    if(el&&aiDate){const m=aiDate.match(/(\d{4})-(\d{2})-(\d{2})/);el.value=m?m[2]+'/'+m[3]+'/'+m[1]:aiDate;}
    div.remove();
    if(statusEl)statusEl.innerHTML='<div class="tip tip-s"><strong>✓ Receipt saved</strong> — fill in any missing fields and tap Save.</div>';
  };
  div.querySelector('#rcpt-no-btn').onclick=()=>{
    const el=document.getElementById('em-date');
    if(el){el.value='';el.style.borderColor='#D97706';el.style.background='#FEF3C7';el.focus();}
    div.remove();
    if(statusEl)statusEl.innerHTML='<div class="tip tip-s"><strong>✓ Receipt read</strong> — enter the correct date below.</div>';
  };
}

function toggleMealFields(){
  const cat=document.getElementById('em-cat')?.value||'';
  const sec=document.getElementById('em-meal-section');
  if(sec){sec.style.display=cat==='meals'?'block':'none';if(cat==='meals')document.getElementById('em-meal-purpose')?.focus();}
}
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
  // Parse date from MM/DD/YYYY text input → YYYY-MM-DD
  const _rawDate=document.getElementById('em-date')?.value||'';
  const _dm=_rawDate.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  const date=_dm?(_dm[3].length===2?'20':'')+_dm[3]+'-'+_dm[1].padStart(2,'0')+'-'+_dm[2].padStart(2,'0'):_rawDate;
  const cat=document.getElementById('em-cat')?.value||'other';
  const jobId=parseInt(document.getElementById('em-job')?.value)||null;
  const notes=(document.getElementById('em-notes')?.value||'').trim();
  if(!vendor){if(err)err.textContent='Enter a vendor name.';return;}
  if(!amount||amount<=0){if(err)err.textContent='Enter a valid amount.';return;}
  if(!date){if(err)err.textContent='Select a date.';return;}
  if(cat==='meals'){const mp=(document.getElementById('em-meal-purpose')?.value||'').trim();if(!mp){if(err)err.textContent='IRS requires a business purpose for meal expenses.';document.getElementById('em-meal-purpose')?.focus();return;}}
  // Duplicate check — same vendor, amount, and date within 2 days
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
  // Store photo inline on the expense record — no storage bucket needed
  const receipt_img=_expState.imageData?('data:image/jpeg;base64,'+_expState.imageData.b64):null;
  const catInfo=IRS_EXPENSE_CATS.find(c=>c.id===cat)||{};
  const job=jobId?bids.find(b=>b.id===jobId):null;
  const mealPurpose=cat==='meals'?(document.getElementById('em-meal-purpose')?.value||'').trim():'';
  const mealAttendees=cat==='meals'?(document.getElementById('em-meal-attendees')?.value||'').trim():'';
  expenses.push({
    id:Date.now(),date,cat,catLabel:catInfo.label||cat,vendor,amount,notes,
    meal_purpose:mealPurpose||undefined,meal_attendees:mealAttendees||undefined,
    created_at:new Date().toISOString(),
    job_id:jobId,job_name:job?job.client_name||job.name:'',client_id:job?job.client_id:null,
    receipt:receipt_img?'Yes — photo stored':'No receipt photo',receipt_img,
    deductible:catInfo.deductible!==false,meals_50:!!(catInfo.meals_50),
  });
  expenses.sort((a,b)=>(a.date||'9').localeCompare(b.date||'9'));
  saveAll();
  if(typeof renderExpenses==='function')renderExpenses();
  showToast((new Date(date).getFullYear()<new Date().getFullYear()?'Back-tax expense':'Expense')+' saved — '+vendor+' '+fmt(amount),receipt_img?'📎':'🧾');
  if(cat==='tools'&&amount>=500)setTimeout(()=>showToast('💡 Equipment $'+amount.toFixed(0)+'+ may qualify for Section 179 immediate deduction — flag for your CPA','📋'),900);
  closeExpenseFlow();
  goPg('pg-tracker');
  setTimeout(()=>{const b=document.getElementById('tr-t-expenses');if(b)b.click();},200);
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
    openDriveModal();
  } else if(type==='expense'){
    openExpenseFlow();
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
      if(c)options.push({label:c.name,sub:fmt(b.amount)+' — won bid',clientId:b.client_id,bidId:b.id,icon:'✓'});
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

  const overlay=document.createElement('div');
  overlay.className='zmodal-overlay';
  overlay.style.cssText='align-items:flex-end;padding:0';
  const rows=candidates.length===0
    ?'<div style="text-align:center;padding:24px;color:var(--text3)">No active jobs to complete right now.</div>'
    :candidates.map(({j,c,isPast,isToday})=>{
      const tag=isPast
        ?'<span style="font-size:10px;font-weight:800;background:#A32D2D;color:#fff;padding:2px 5px;border-radius:4px;margin-left:4px">Past</span>'
        :isToday?'<span style="font-size:10px;font-weight:800;background:var(--blue);color:#fff;padding:2px 5px;border-radius:4px;margin-left:4px">Today</span>':'';
      return '<button onclick="markJobCompleteFromDash('+j.id+',this)" style="width:100%;text-align:left;padding:14px 16px;border:none;border-bottom:1px solid var(--border);background:none;cursor:pointer;font-family:inherit">'+
        '<div style="display:flex;justify-content:space-between;align-items:center">'+
          '<div>'+
            '<div style="font-size:14px;font-weight:700;color:var(--text)">'+c.name+tag+'</div>'+
            '<div style="font-size:11px;color:var(--text3);margin-top:2px">'+j.start+(j.days>1?' · '+j.days+' days':'')+'</div>'+
          '</div>'+
          '<svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke:var(--text3);fill:none;stroke-width:2;flex-shrink:0"><polyline points="9 18 15 12 9 6"/></svg>'+
        '</div>'+
      '</button>';
    }).join('');
  overlay.innerHTML=
    '<div style="background:var(--bg);border-radius:var(--rl) var(--rl) 0 0;width:100%;max-height:80vh;overflow-y:auto">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid var(--border2)">'+
        '<div style="font-size:16px;font-weight:800">✅ Complete Job</div>'+
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
          '<span style="font-size:20px">'+s.icon+'</span>'+
          '<div style="flex:1;min-width:0">'+
            '<div style="font-size:14px;font-weight:700;color:var(--text)">'+s.label+'</div>'+
            '<div style="font-size:11px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+s.sub+'</div>'+
          '</div>'+
          '<svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke:var(--text3);fill:none;stroke-width:2;flex-shrink:0"><polyline points="9 18 15 12 9 6"/></svg>'+
        '</button>'
      ).join('')+
    '</div>';
  }

  box.innerHTML=
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">'+
      '<div style="font-size:17px;font-weight:800">'+title+'</div>'+
      '<button onclick="closeTopModal()" style="border:none;background:none;font-size:22px;cursor:pointer;color:var(--text3);padding:0;line-height:1">✕</button>'+
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
        '<div style="font-size:13px;font-weight:700;color:var(--text)">'+c.name+'</div>'+
        '<div style="font-size:11px;color:var(--text3)">'+((c.addr||'').split(',')[0]||'No address')+'</div>'+
      '</div>'+
    '</button>'
  ).join('');
}

function pickQuickClient(btn,actionType){
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
    openClientDetail(clientId);
    setTimeout(()=>openEstimateForClient(),200);
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
      '<button onclick="closeTopModal()" style="border:none;background:none;font-size:22px;cursor:pointer;color:var(--text3)">✕</button>'+
    '</div>'+
    '<div style="background:var(--blue-lt);border-radius:var(--r);padding:8px 12px;margin-bottom:14px;font-size:12px;font-weight:700;color:var(--blue-dk)">'+
      '📌 '+(c?c.name:'Client')+
    '</div>'+
    (clientBids.length>1?
      '<div class="f" style="margin-bottom:10px">'+
        '<label style="font-size:11px;font-weight:700;color:var(--text3)">Which job?</label>'+
        '<select id="qe-bid" style="font-size:13px;padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);width:100%;color:var(--text)">'+
          clientBids.map(b=>'<option value="'+b.id+'"'+(bid&&b.id===bid.id?' selected':'')+'>'+
            (b.client_name||c.name)+' — '+fmt(b.amount)+(b.status==='Pending'?' (pending)':'')+
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
      '<input type="number" id="qe-amount" placeholder="0.00" step="0.01" inputmode="decimal" style="font-size:26px;font-weight:800;padding:12px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);width:100%;box-sizing:border-box;color:var(--text);font-family:inherit;text-align:center">'+
    '</div>'+
    '<div class="f" style="margin-bottom:14px">'+
      '<label style="font-size:11px;font-weight:700;color:var(--text3)">Category</label>'+
      '<select id="qe-cat" style="font-size:13px;padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);width:100%;color:var(--text)">'+
        ['Paint & supplies','Tools & equipment','Vehicle (fuel)','Vehicle (maintenance)',
         'Subcontractors','Insurance','Marketing','Phone/internet','Uniforms/PPE',
         'Licensing & permits','Professional services','Meals (business)','Other']
          .map(c=>'<option>'+c+'</option>').join('')+
      '</select>'+
    '</div>'+
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
  const amount=parseFloat(document.getElementById('qe-amount').value);
  if(!vendor){zAlert('Enter a vendor.',{title:'Required'});document.getElementById('qe-vendor').focus();return;}
  if(!amount){zAlert('Enter an amount.',{title:'Required'});document.getElementById('qe-amount').focus();return;}
  const bidEl=document.getElementById('qe-bid');
  const bidId=bidEl?parseInt(bidEl.value)||null:null;
  const bid=bidId?bids.find(b=>b.id===bidId):null;
  const cat=document.getElementById('qe-cat').value||'Paint & supplies';
  expenses.unshift({
    id:Date.now(),
    date:document.getElementById('qe-date')?.value||todayKey(),
    cat,
    vendor,
    amount,
    pay:'Business card',
    receipt:'No — need to get it',
    notes:'',
    client_id:clientId,
    job_id:bidId,
    job_name:bid?bid.client_name||'':''
  });
  expenses.sort((a,b)=>(a.date||'9').localeCompare(b.date||'9'));
  saveAll();
  const overlay=document.querySelector('.zmodal-overlay');
  if(overlay)overlay.remove();
  showToast(vendor+' — '+fmt(amount)+' logged ✓','💰');
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
      note.textContent='Fill in their info and save — you\'ll be taken right back to continue.';
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
      if(ov.length)conflicts.push('"'+a.name+'" and "'+b.name+'" overlap on '+ov.length+' day'+(ov.length>1?'s':''));
    }
  }
  const el=document.getElementById('cal-conflicts');
  if(el)el.innerHTML=conflicts.map(c=>'<div class="tip tip-d" style="margin-bottom:6px">Scheduling conflict: '+c+'</div>').join('');
}
function renderCalWeek(){const t=new Date(),dow=t.getDay(),DNAMES=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],tk=todayKey();const days=[];for(let i=0;i<7;i++){const d=new Date(t);d.setDate(t.getDate()-dow+i);days.push(d);}document.getElementById('cal-week').innerHTML=days.map((d,i)=>{const key=dateKey(d),dj=getJobsOnDay(key).filter(x=>!x.isBuf),isToday=key===tk;return`<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border)"><div style="width:30px;text-align:center;flex-shrink:0"><div style="font-size:10px;font-weight:700;text-transform:uppercase;color:${isToday?'var(--blue)':'var(--text3)'}">${DNAMES[i]}</div><div style="font-size:13px;font-weight:${isToday?'700':'400'};color:${isToday?'var(--blue)':'var(--text2)'}">${d.getDate()}</div></div><div style="flex:1;min-width:0">${dj.length?dj.map(({job})=>`<div style="font-size:10px;padding:2px 5px;border-radius:3px;background:${job.color};color:#fff;margin-bottom:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${job.name}</div>`).join(''):'<div style="font-size:11px;color:var(--text3)">Open</div>'}</div></div>`;}).join('');}
function renderCalUpcoming(){const tk=todayKey(),upcoming=[...jobs].filter(j=>addDays(j.start,(parseInt(j.days)||1)-1)>=tk).sort((a,b)=>a.start.localeCompare(b.start)).slice(0,6);document.getElementById('cal-upcoming').innerHTML=!upcoming.length?'<div class="empty">No upcoming jobs.</div>':upcoming.map(j=>{const isA=j.start<=tk;return`<div style="display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--border)"><div style="width:8px;height:8px;border-radius:2px;background:${j.color};flex-shrink:0;margin-top:3px"></div><div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${j.name}</div><div style="font-size:10px;color:var(--text3)">${parseD(j.start).toLocaleDateString('en-US',{month:'short',day:'numeric'})} · ${j.days}d${j.value?' · '+fmt(j.value):''}</div></div><span class="bdg ${isA?'bdg-active':'bdg-upcoming'}">${isA?'Active':'Soon'}</span></div>`;}).join('');}

function populateSchedSelect(){
  const cSel=document.getElementById('s-client-sel');
  if(cSel)cSel.innerHTML='<option value="">— Select a client —</option>'+clients.map(c=>'<option value="'+c.id+'">'+c.name+'</option>').join('');
  const scheduledIds=new Set(jobs.filter(j=>j.bid_id).map(j=>j.bid_id));
  const won=bids.filter(b=>b.status==='Closed Won');
  const bSel=document.getElementById('s-bid-sel');
  if(bSel)bSel.innerHTML='<option value="">— Select a won bid —</option>'+won.map(b=>'<option value="'+b.id+'"'+(scheduledIds.has(b.id)?' disabled':'')+'>'+(b.client_name||b.name)+' — '+fmt(b.amount)+(scheduledIds.has(b.id)?' (scheduled)':'')+' </option>').join('');
}

function setSchedType(type,btn){
  schedType=type;
  const isEst=type==='estimate';
  document.querySelectorAll('#pg-schedule .fbar .fb').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  else{const t=document.getElementById(isEst?'sched-tab-est':'sched-tab-job');if(t)t.classList.add('active');}
  const estF=document.getElementById('sched-est-fields');if(estF)estF.style.display=isEst?'block':'none';
  const jobF=document.getElementById('sched-job-fields');if(jobF)jobF.style.display=isEst?'none':'block';
  const valRow=document.getElementById('s-value-row');if(valRow)valRow.style.display=isEst?'none':'block';
  const timeRow=document.getElementById('s-time');if(timeRow){const _tf=timeRow.closest('.f');if(_tf)_tf.style.display=isEst?'':'none';}
  selectedColor=isEst?'#7F77DD':'#185FA5';
  const sw=document.getElementById('s-color-swatch');if(sw)sw.style.background=selectedColor;
  const lb=document.getElementById('s-color-label');
  if(lb)lb.textContent=isEst?'Shows as purple on the calendar — estimate visit':'Shows as blue on the calendar — paint job';
  const tip=document.getElementById('sched-tip');
  if(tip){tip.innerHTML=isEst?'Pick a client, date and time. <strong>Evenings (after 5pm) and weekends</strong> are always open — they never block your paint days.':'Pull from a won bid and pick a start date.';tip.className=isEst?'tip':'tip tip-s';}
  const days=document.getElementById('s-days');if(days)days.value=isEst?1:2;
  const buf=document.getElementById('s-buf');if(buf)buf.value=isEst?'0':'1';
  const daysRow=document.getElementById('s-dur-days-row');
  const hoursRow=document.getElementById('s-dur-hours-row');
  const bufRow=document.querySelector('#s-buf')?.closest('.f');
  if(daysRow)daysRow.style.display=isEst?'none':'';
  if(hoursRow)hoursRow.style.display=isEst?'':'none';
  if(bufRow)bufRow.style.display=isEst?'none':'';
  ['s-name','s-addr','s-start','s-notes'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const sv=document.getElementById('s-value');if(sv)sv.value='';
  document.getElementById('sched-preview').style.display='none';
  refreshAvail();
}

function pullClient(){
  const cid=parseInt(v('s-client-sel'));if(!cid)return;
  const c=getClientById(cid);if(!c)return;
  document.getElementById('s-name').value=c.name+' — estimate';
  document.getElementById('s-addr').value=c.addr||'';
  document.getElementById('s-days').value=1;
  const na=getNextAvail();
  document.getElementById('s-start').value=na.key;
  setTimeout(validateEstimateTime,50);
  availYear=parseD(na.key).getFullYear();availMonth=parseD(na.key).getMonth();
  refreshAvail();updateSchedPreview();
}
function pullBid(){const id=parseInt(v('s-bid-sel'));if(!id)return;const b=bids.find(x=>x.id===id);if(!b)return;document.getElementById('s-name').value=(b.client_name||b.name)+(b.type?' — '+b.type:'');document.getElementById('s-addr').value=b.addr||'';document.getElementById('s-value').value=b.amount||'';document.getElementById('s-days').value=b.days||2;document.getElementById('s-days-src').textContent='from bid';document.getElementById('s-notes').value=b.notes||'';document.getElementById('sched-tip').innerHTML='<strong>Pulled from bid:</strong> '+b.client_name+' · '+fmt(b.amount)+' · '+(b.days||2)+' days. Pick an available start date.';document.getElementById('sched-tip').className='tip tip-s';const na=getNextAvail();document.getElementById('s-start').value=na.key;availYear=parseD(na.key).getFullYear();availMonth=parseD(na.key).getMonth();refreshAvail();updateSchedPreview();}
function buildColorRow(){document.getElementById('s-color-row').innerHTML=JOB_COLORS.map(c=>`<div style="width:24px;height:24px;border-radius:4px;background:${c};cursor:pointer;border:2px solid ${c===selectedColor?'#000':'transparent'}" onclick="selColor('${c}')"></div>`).join('');}
function selColor(c){selectedColor=c;buildColorRow();}
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
  const{booked,buf}=getBookedDays(),selected=v('s-start'),days=parseInt(v('s-days'))||1,b=parseInt(v('s-buf'))||0,today=todayKey();
  const timeOffDays=getTimeOffDays();
  const _schedBidId=parseInt(v('s-bid-sel'))||null;
  const _schedBid=_schedBidId?bids.find(b=>b.id===_schedBidId):null;
  const _hasPwash=schedType==='job'&&_schedBid?.scope?.pwash===true;
  const allowWknd=document.getElementById('s-allow-weekend')?.checked||false;

  // Build workday-aware end date — skip weekends unless allowed
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
  const weather=await fetchWeather();
  document.getElementById('avail-grid').innerHTML=cells.map(({key,other})=>{
    if(other)return'<div class="av-d av-other">'+parseInt(key.split('-')[2])+'</div>';
    const isPast=key<today,isTaken=booked.has(key),isBuf=buf.has(key)&&!selDays.has(key);
    const isSel=selDays.has(key),isStart=key===selected;
    const dayDow=parseD(key).getDay();
    const isWeekend=dayDow===0||dayDow===6;
    const isWorkday=!isWeekend||(allowWknd);
    const wx=weather[key];
    const wxHtml=wx?'<div style="font-size:11px;line-height:1">'+wx.icon+'</div><div style="font-size:8px;color:'+(wx.rain?'#A32D2D':'inherit')+';font-weight:600;line-height:1.2">'+wx.hi+'°</div>':'';
    const isRainBlocked=_hasPwash&&wx&&wx.rain;
    const dayNum=parseInt(key.split('-')[2]);
    if(isPast)return'<div class="av-d av-past">'+dayNum+'</div>';
    // Weekends grayed when not allowed — never blue, never selectable
    if(isWeekend&&!allowWknd)return'<div class="av-d av-past">'+dayNum+'</div>';
    if(timeOffDays.has(key))return'<div class="av-d" style="background:#FDE68A;color:#92400E;font-weight:700;cursor:not-allowed" title="Time off">'+dayNum+'<br><span style="font-size:11px">🏖</span></div>';
    if(schedType==='estimate'){
      if(isSel)return'<div class="av-d av-sel" onclick="pickDay(\''+key+'\')">'+dayNum+(isStart?'<br><span style="font-size:9px">start</span>':'')+wxHtml+'</div>';
      return'<div class="av-d av-open" onclick="pickDay(\''+key+'\')">'+dayNum+wxHtml+'</div>';
    }
    if(isTaken)return'<div class="av-d av-taken">'+dayNum+wxHtml+'</div>';
    if(isBuf)return'<div class="av-d av-buf">'+dayNum+'</div>';
    if(isRainBlocked)return'<div class="av-d av-taken" title="Rain forecast — pressure wash blocked" style="background:#FEE8E8;cursor:not-allowed">'+dayNum+wxHtml+'</div>';
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
  const{booked}=getBookedDays();for(let i=0;i<days;i++){if(booked.has(addDays(start,i))){_schedErr('One or more days already booked — pick a different start date.','s-start');return;}}
  const bidId=parseInt(v('s-bid-sel'))||null,bid=bidId?bids.find(b=>b.id===bidId):null;
  if(bid&&bid.status==='Pending'){_schedErr('The estimate must be signed (Closed Won) before scheduling.','s-bid-sel');return;}
  // Rain block: pressure wash can't start on a rainy day
  if(schedType==='job'&&bid&&bid.scope&&bid.scope.pwash){
    const wx=_weatherCache&&_weatherCache[start];
    if(wx&&wx.rain){_schedErr('Rain in the forecast for '+start+'. Pressure washing needs dry conditions — pick a clear day.','s-start');return;}
  }
  // Duplicate guard: same bid already has a job scheduled
  if(bidId&&jobs.some(j=>j.bid_id===bidId&&j.eventType==='job'&&j.status!=='canceled')){
    _schedErr('This job is already scheduled. Edit or cancel the existing one first.','s-bid-sel');return;}
  _submitting=true;setTimeout(()=>{_submitting=false;},1500);
  const clientId=schedType==='estimate'?(parseInt(v('s-client-sel'))||null):(bid?bid.client_id:null);
  const jobValue=schedType==='estimate'?0:(parseFloat(v('s-value'))||0);
  const jobTime=schedType==='estimate'?(v('s-time')||'09:00'):'';
  const jobHours=schedType==='estimate'?parseFloat(v('s-hours')||'2'):null;
  jobs.push({id:Date.now(),bid_id:bidId,client_id:clientId,name,addr:v('s-addr'),start,days,buffer:parseInt(v('s-buf'))||0,value:jobValue,color:selectedColor,eventType:schedType,time:jobTime,hours:jobHours,notes:v('s-notes'),status:'upcoming'});
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
  const st=document.getElementById('s-time');if(st)st.value='09:00';
  const sh=document.getElementById('s-hours');if(sh)sh.value='2';
  const src=document.getElementById('s-days-src');if(src)src.textContent='';
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
function populateTrackerYearSel(){
  const sel=document.getElementById('tracker-year-sel');
  if(!sel)return;
  const years=getTrackerYears();
  const cur=trackerYear||new Date().getFullYear();
  const selYear=years.includes(cur)?cur:years[0];
  trackerYear=selYear;
  sel.innerHTML=years.map(y=>'<option value="'+y+'"'+(y===selYear?' selected':'')+'>'+y+'</option>').join('');
}
function setTrackerYear(yr){
  trackerYear=yr;
  renderTrackerTab();
}
function renderTrackerTab(){
  populateTrackerYearSel();
  setTrTab(trackerTab,document.getElementById('tr-t-'+trackerTab));
}
function renderMonthlyPL(){
  const el=document.getElementById('monthly-pl-list');if(!el)return;
  const months={};
  const addMonth=(key,type,amount)=>{
    if(!months[key])months[key]={inc:0,exp:0,miles:0};
    months[key][type]+=amount;
  };
  income.forEach(r=>{if(r.date)addMonth(r.date.slice(0,7),'inc',r.amount);});
  expenses.forEach(r=>{if(r.date)addMonth(r.date.slice(0,7),'exp',r.amount);});
  mileage.forEach(r=>{if(r.date)addMonth(r.date.slice(0,7),'miles',r.miles||0);});

  const keys=Object.keys(months).sort().reverse();
  if(!keys.length){el.innerHTML='<div class="empty">No data yet — log income and expenses to see monthly P&L.</div>';return;}

  let html='<div style="display:grid;grid-template-columns:auto 1fr 1fr 1fr;gap:4px 10px;font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text3);padding-bottom:6px;border-bottom:1px solid var(--border);margin-bottom:6px">'+
    '<span>Month</span><span style="text-align:right">Revenue</span><span style="text-align:right">Expenses</span><span style="text-align:right">Net</span></div>';

  let totalInc=0,totalExp=0,totalMiles=0;
  keys.forEach(k=>{
    const m=months[k];
    const mileDed=m.miles*IRS();
    const net=m.inc-m.exp-mileDed;
    totalInc+=m.inc;totalExp+=m.exp;totalMiles+=m.miles;
    const [yr,mo]=k.split('-');
    const label=new Date(parseInt(yr),parseInt(mo)-1,1).toLocaleDateString('en-US',{month:'short',year:'numeric'});
    html+='<div style="display:grid;grid-template-columns:auto 1fr 1fr 1fr;gap:4px 10px;padding:7px 0;border-bottom:1px solid var(--border);font-size:12px;align-items:center">'+
      '<span style="font-weight:600">'+label+'</span>'+
      '<span style="text-align:right;color:var(--green-mid);font-weight:700">'+fmt(m.inc)+'</span>'+
      '<span style="text-align:right;color:#A32D2D">('+fmt(m.exp+mileDed)+')</span>'+
      '<span style="text-align:right;font-weight:700;color:'+(net>=0?'var(--green-mid)':'#A32D2D')+'">'+fmt(net)+'</span>'+
    '</div>';
  });

  const totalMileDed=totalMiles*IRS();
  const grandNet=totalInc-totalExp-totalMileDed;
  html+='<div style="display:grid;grid-template-columns:auto 1fr 1fr 1fr;gap:4px 10px;padding:8px 0;font-size:13px;font-weight:700;border-top:2px solid var(--border);margin-top:4px">'+
    '<span>Total</span>'+
    '<span style="text-align:right;color:var(--green-mid)">'+fmt(totalInc)+'</span>'+
    '<span style="text-align:right;color:#A32D2D">('+fmt(totalExp+totalMileDed)+')</span>'+
    '<span style="text-align:right;color:'+(grandNet>=0?'var(--green-mid)':'#A32D2D')+'">'+fmt(grandNet)+'</span>'+
  '</div>';
  el.innerHTML=html;
}

// ── Receipt viewer ────────────────────────────────────────────────────
function viewReceipt(expId){
  const exp=expenses.find(e=>e.id==expId);
  const src=exp?.receipt_img;
  if(!src)return zAlert('No receipt photo stored for this expense.',{title:'No photo'});
  const ov=document.createElement('div');
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  ov.onclick=e=>{if(e.target===ov)ov.remove();};
  ov.innerHTML='<div style="max-width:600px;width:100%;text-align:center">'+
    '<img src="'+src+'" style="max-width:100%;max-height:80vh;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.5)">'+
    '<div style="margin-top:12px;display:flex;gap:10px;justify-content:center">'+
      '<a href="'+src+'" download="receipt_'+(exp.date||'')+'_'+(exp.vendor||'').replace(/[^a-z0-9]/gi,'_')+'.jpg" style="color:#fff;font-size:13px;font-weight:600;text-decoration:none;background:rgba(255,255,255,.15);padding:8px 16px;border-radius:8px">⬇ Save photo</a>'+
      '<button onclick="this.closest(\'.rcpt-ov\').remove()" style="color:#fff;font-size:13px;font-weight:600;background:rgba(255,255,255,.15);border:none;padding:8px 16px;border-radius:8px;cursor:pointer;font-family:inherit">✕ Close</button>'+
    '</div>'+
  '</div>';
  ov.className='rcpt-ov';
  document.body.appendChild(ov);
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
function openExportPanel(){
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
      exportOptionHTML('exportAllDataCSV()','📦','Everything — one CSV','Every client, lead, bid, job, payment, income, expense, mileage, and time entry in one file. Clients, leads, bids, jobs, payments, income, expenses, mileage — all labeled sections.')+
      exportOptionHTML('exportPLCSV()','📈','Profit & Loss CSV','Income vs expenses vs mileage deduction — net profit at the bottom. Hand straight to your accountant.')+
      exportOptionHTML('exportIncomeCSV()','💰','Income CSV','Every revenue line — date, client, category, job, amount. Filtered to selected year.')+
      exportOptionHTML('exportExpensesCSV()','📊','Expenses CSV','Every expense line — date, vendor, IRS category, amount, job, receipt status. Open in Excel or send to your accountant.')+
      exportOptionHTML('exportMileageCSV()','🚗','Mileage log CSV','Every trip — date, client, miles, IRS deduction. Meets IRS contemporaneous recordkeeping.')+
      exportOptionHTML('exportTaxPDF()','📄','Full tax report — PDF','Schedule C summary, income, expenses by IRS category, mileage log. Print or save — IRS audit ready.')+
      exportOptionHTML('exportFullBackup()','💾','Full data backup','All clients, jobs, bids, income, expenses, mileage. JSON — restore or migrate anytime.')+
      exportOptionHTML('exportReceiptImages()','📄','Receipt PDF','All receipt photos in one PDF — sorted by date with vendor, amount and category. Print or send to your CPA.')+
    '</div>';
  document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
}

function exportOptionHTML(onclick,icon,title,desc){
  return '<div style="border:1.5px solid var(--border2);border-radius:var(--rl);padding:16px;margin-bottom:10px;cursor:pointer;transition:border-color .15s" onclick="'+onclick+'" onmouseover="this.style.borderColor=\'var(--blue)\'" onmouseout="this.style.borderColor=\'var(--border2)\'">'+
    '<div style="display:flex;align-items:center;gap:12px">'+
      '<div style="font-size:28px;flex-shrink:0">'+icon+'</div>'+
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

function exportExpensesCSV(){
  const yr=getExportYear();
  const biz=S.bname||'TradeDesk';
  const filtered=(yr==='all'?expenses:expenses.filter(e=>e.date?.startsWith(yr)))
    .sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  const header=['Date','Vendor','IRS Category','Schedule C Line','Amount','Deductible','Job','Receipt'];
  const rows=filtered.map(e=>{
    const cat=IRS_EXPENSE_CATS.find(c=>c.id===e.cat)||{label:e.cat||'Other',line:''};
    return [e.date||'','"'+(e.vendor||'').replace(/"/g,'""')+'"','"'+cat.label+'"','"'+(cat.line||'')+'"',
      (e.amount||0).toFixed(2),e.deductible===false?'No':'Yes',
      '"'+(e.job_name||'').replace(/"/g,'""')+'"',e.receipt_img||e.receipt_key?'Yes':'No'].join(',');
  });
  const total=filtered.reduce((s,e)=>s+e.amount,0);
  const csv=['"'+biz+' — Expenses — '+(yr==='all'?'All Years':yr)+'"','',header.join(','),...rows,'','TOTAL,,,,"'+total.toFixed(2)+'",,,'  ].join('\n');
  downloadFile((biz+' Expenses '+(yr==='all'?'All Years':yr)+'.csv').replace(/\s+/g,'_'),csv,'text/csv');
  showToast('Expenses CSV — '+filtered.length+' records downloaded','📊');
}

function exportMileageCSV(){
  const yr=getExportYear();
  const biz=S.bname||'TradeDesk';
  const rate=IRS();
  const filtered=(yr==='all'?mileage:mileage.filter(m=>m.date?.startsWith(yr)))
    .sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  const header=['Date','Vehicle','From','To','Miles','IRS Deduction','Purpose','Client'];
  const rows=filtered.map(m=>[m.date||'','"'+(m.vehicle||'')+'"','"'+(m.from||'')+'"','"'+(m.to||'')+'"',
    (m.miles||0).toFixed(1),((m.miles||0)*rate).toFixed(2),'"'+(m.purpose||'')+'"','"'+(m.client_name||'')+'"'].join(','));
  const tot=filtered.reduce((s,m)=>s+(m.miles||0),0);
  const csv=['"'+biz+' — Mileage — '+(yr==='all'?'All Years':yr)+'"','"IRS Rate $'+rate.toFixed(3)+'/mi"','',header.join(','),...rows,'','TOTAL,,,,"'+tot.toFixed(1)+'","'+(tot*rate).toFixed(2)+'",,'].join('\n');
  downloadFile((biz+' Mileage '+(yr==='all'?'All Years':yr)+'.csv').replace(/\s+/g,'_'),csv,'text/csv');
  showToast('Mileage log — '+filtered.length+' trips downloaded','🚗');
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

  // Income
  sec('INCOME',
    ['Date','Source / Client','Category','Job','Amount','Notes'],
    income.sort((a,b)=>(b.date||'').localeCompare(a.date||'')).map(r=>[
      q(r.date),q(r.client_name||r.source),q(r.cat||r.category||'Revenue'),
      q(r.job_name),(r.amount||0).toFixed(2),q(r.note||r.notes)
    ].join(','))
  );

  // Expenses
  sec('EXPENSES',
    ['Date','Vendor','IRS Category','Amount','Deductible','Job','Receipt'],
    expenses.sort((a,b)=>(b.date||'').localeCompare(a.date||'')).map(e=>{
      const cat=IRS_EXPENSE_CATS.find(c=>c.id===e.cat)||{label:e.cat||'Other'};
      return[q(e.date),q(e.vendor),q(cat.label),(e.amount||0).toFixed(2),
        e.deductible===false?'No':'Yes',q(e.job_name),e.receipt_img||e.receipt_key?'Yes':'No'].join(',');
    })
  );

  // Mileage
  const rate=IRS();
  sec('MILEAGE',
    ['Date','Vehicle','From','To','Miles','IRS Deduction','Purpose','Client'],
    mileage.sort((a,b)=>(b.date||'').localeCompare(a.date||'')).map(m=>[
      q(m.date),q(m.vehicle),q(m.from),q(m.to),
      (m.miles||0).toFixed(1),((m.miles||0)*rate).toFixed(2),q(m.purpose),q(m.client_name)
    ].join(','))
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

  const header=['"'+biz+' — Full Data Export — '+now+'"',''];
  const csv=[...header,...sections].join('\n');
  downloadFile((biz+' Full Export '+now+'.csv').replace(/[/,\s]+/g,'_'),csv,'text/csv');
  showToast('Full export — all data downloaded','📦');
}

function exportIncomeCSV(){
  const yr=getExportYear();
  const biz=S.bname||'TradeDesk';
  const filtered=(yr==='all'?income:income.filter(r=>r.date?.startsWith(yr)))
    .sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  const header=['Date','Source / Client','Category','Job','Amount','Notes'];
  const rows=filtered.map(r=>[
    r.date||'',
    '"'+(r.client_name||r.source||'').replace(/"/g,'""')+'"',
    '"'+(r.cat||r.category||'Revenue').replace(/"/g,'""')+'"',
    '"'+(r.job_name||'').replace(/"/g,'""')+'"',
    (r.amount||0).toFixed(2),
    '"'+(r.note||r.notes||'').replace(/"/g,'""')+'"'
  ].join(','));
  const total=filtered.reduce((s,r)=>s+(r.amount||0),0);
  const csv=['"'+biz+' — Income — '+(yr==='all'?'All Years':yr)+'"','',header.join(','),...rows,'','TOTAL,,,,'+total.toFixed(2)+','].join('\n');
  downloadFile((biz+' Income '+(yr==='all'?'All Years':yr)+'.csv').replace(/\s+/g,'_'),csv,'text/csv');
  showToast('Income CSV — '+filtered.length+' records downloaded','💰');
}

function exportPLCSV(){
  const yr=getExportYear();
  const biz=S.bname||'TradeDesk';
  const label=yr==='all'?'All Years':yr;
  const filterYr=arr=>(yr==='all'?arr:arr.filter(r=>r.date?.startsWith(yr)));
  const yrInc=filterYr(income).sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  const yrExp=filterYr(expenses).sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  const yrMil=filterYr(mileage);
  const tInc=yrInc.reduce((s,r)=>s+(r.amount||0),0);
  const tExp=yrExp.reduce((s,r)=>s+(r.amount||0),0);
  const tMil=yrMil.reduce((s,m)=>s+(m.miles||0),0)*IRS();
  const net=tInc-tExp-tMil;
  const lines=[
    '"'+biz+' — Profit & Loss — '+label+'"','',
    '"INCOME"','Date,Source / Client,Category,Amount',
    ...yrInc.map(r=>[r.date||'','"'+(r.client_name||r.source||'').replace(/"/g,'""')+'"','"'+(r.cat||'Revenue')+'"',(r.amount||0).toFixed(2)].join(',')),
    ',,TOTAL INCOME,'+tInc.toFixed(2),'',
    '"EXPENSES"','Date,Vendor,IRS Category,Amount',
    ...yrExp.map(e=>{const c=IRS_EXPENSE_CATS.find(x=>x.id===e.cat)||{label:e.cat||'Other'};return[e.date||'','"'+(e.vendor||'').replace(/"/g,'""')+'"','"'+c.label+'"',(e.amount||0).toFixed(2)].join(',');}),
    ',,TOTAL EXPENSES,'+tExp.toFixed(2),'',
    '"MILEAGE DEDUCTION"','Miles,IRS Rate,Deduction,',
    tMil>0?tMil.toFixed(1)+','+IRS().toFixed(3)+','+(tMil).toFixed(2)+',':'(none)','',
    '"NET PROFIT"','"'+label+'",,'+net.toFixed(2),
  ];
  downloadFile((biz+' P&L '+label+'.csv').replace(/\s+/g,'_'),lines.join('\n'),'text/csv');
  showToast('P&L exported — '+label,'📈');
}

function exportTaxPDF(){
  const yr=getExportYear()==='all'?String(new Date().getFullYear()):getExportYear();
  const biz=S.bname||'TradeDesk';
  const status=S.txStatus||'single';
  const yrIncome=income.filter(r=>r.date&&r.date.startsWith(yr)).sort((a,b)=>a.date.localeCompare(b.date));
  const yrExp=expenses.filter(r=>r.date&&r.date.startsWith(yr)).sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  const yrMiles=mileage.filter(r=>r.date&&r.date.startsWith(yr)).sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  const tInc=yrIncome.reduce((s,r)=>s+r.amount,0);
  const tExp=yrExp.reduce((s,r)=>s+r.amount,0);
  const tMiles=yrMiles.reduce((s,r)=>s+(r.miles||0),0);
  const irsRateYr=_getIrsRateForYear(yr);
  const mileDed=tMiles*irsRateYr;
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
  const ksTax=Math.ceil(calcBrackets(ksTaxable,KS_BRACKETS[status]||KS_BRACKETS.single));
  const totalTax=seTax+fedTax+ksTax;
  const byCat={};
  yrExp.forEach(e=>{
    const cat=IRS_EXPENSE_CATS.find(c=>c.id===e.cat)||{label:e.cat||'Other',icon:'',line:'Part II Line 27'};
    if(!byCat[cat.label])byCat[cat.label]={label:cat.label,icon:cat.icon||'',line:cat.line||'',total:0};
    byCat[cat.label].total+=e.amount;
  });
  const d=new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});
  const statusLabel={single:'Single',mfj:'Married Filing Jointly',hoh:'Head of Household'}[status]||status;
  // Build HTML using string concat — no template literals to avoid parser issues
  let h='<!DOCTYPE html><html><head><meta charset="utf-8">';
  h+='<title>'+biz+' Tax Report '+yr+'</title>';
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
  h+='<div class="hdr-s">Tax Report — '+yr+' &nbsp;·&nbsp; '+statusLabel+' &nbsp;·&nbsp; '+d+'</div></div>';
  h+='<div class="body">';
  // Income & deductions
  h+='<div class="sec"><div class="sec-t">Income &amp; Deductions — Schedule C</div>';
  h+='<div class="grid">';
  h+='<div class="box"><div class="bl">Gross Revenue</div><div class="bv green">'+fmt(tInc)+'</div></div>';
  h+='<div class="box"><div class="bl">Business Expenses</div><div class="bv red">('+fmt(tExp)+')</div></div>';
  h+='<div class="box"><div class="bl">Mileage Deduction</div><div class="bv red">('+fmt(mileDed)+')</div></div>';
  h+='<div class="box"><div class="bl">Net SE Income</div><div class="bv blue">'+fmt(net)+'</div></div>';
  h+='<div class="box"><div class="bl">Miles Driven</div><div class="bv">'+tMiles.toFixed(1)+' mi</div></div>';
  h+='<div class="box"><div class="bl">IRS Rate</div><div class="bv">$'+IRS().toFixed(3)+'/mi</div></div>';
  h+='</div></div>';
  // Tax breakdown
  h+='<div class="sec"><div class="sec-t">Tax Liability — Federal vs '+(S.state||'State')+' State</div>';
  h+='<div class="two">';
  // Federal
  h+='<div class="ts">';
  h+='<div class="th" style="background:#EBF2FB;color:#0C447C">Federal (IRS)</div>';
  h+='<div class="tr2"><span>SE income base (92.35%)<span class="tsub">Schedule SE</span></span><span>'+fmt(seBase)+'</span></div>';
  h+='<div class="tr2"><span>Self-employment tax (15.3%)<span class="tsub">Social Security + Medicare</span></span><span class="red">'+fmt(seTax)+'</span></div>';
  h+='<div class="tr2"><span>1/2 SE deduction<span class="tsub">Reduces federal AGI</span></span><span class="green">('+fmt(seDed)+')</span></div>';
  const qbiEst=Math.floor(Math.max(0,net-seDed)*0.20);
  if(qbiEst>0)h+='<div class="tr2"><span>QBI deduction est. (Sec. 199A)<span class="tsub">20% pass-through — confirm with CPA</span></span><span class="green">('+fmt(qbiEst)+')</span></div>';
  h+='<div class="tr2"><span>Standard deduction<span class="tsub">Form 1040 — '+statusLabel+'</span></span><span class="green">('+fmt(stdDed)+')</span></div>';
  h+='<div class="tr2"><span>Federal taxable income</span><span style="font-weight:700">'+fmt(fedTaxable)+'</span></div>';
  h+='<div class="tr2"><span>Federal income tax<span class="tsub">Form 1040 brackets</span></span><span class="red">'+fmt(fedTax)+'</span></div>';
  h+='<div class="ttot"><span>Total Federal</span><span class="red">'+fmt(seTax+fedTax)+'</span></div>';
  h+='</div>';
  // State
  h+='<div class="ts">';
  h+='<div class="th" style="background:#EAF3DE;color:#27500A">'+(S.state||'State')+' Tax</div>';
  h+='<div class="tr2"><span>State AGI</span><span>'+fmt(agi)+'</span></div>';
  h+='<div class="tr2"><span>Standard deduction<span class="tsub">'+statusLabel+'</span></span><span class="green">('+fmt(KS_STD[status]||3500)+')</span></div>';
  h+='<div class="tr2"><span>State taxable income</span><span style="font-weight:700">'+fmt(ksTaxable)+'</span></div>';
  h+='<div class="tr2"><span>State income tax</span><span class="red">'+fmt(ksTax)+'</span></div>';
  h+='<div class="ttot"><span>Total State</span><span class="red">'+fmt(ksTax)+'</span></div>';
  h+='</div></div>';
  // Combined
  h+='<div class="ts">';
  h+='<div class="tr2"><span>Self-employment tax</span><span class="red">'+fmt(seTax)+'</span></div>';
  h+='<div class="tr2"><span>Federal income tax</span><span class="red">'+fmt(fedTax)+'</span></div>';
  h+='<div class="tr2"><span>'+(S.state||'State')+' state income tax</span><span class="red">'+fmt(ksTax)+'</span></div>';
  h+='<div class="tall"><span>Total Estimated Tax Liability</span><span class="red">'+fmt(totalTax)+'</span></div>';
  h+='</div></div>';
  // Income table
  h+='<div class="sec"><div class="sec-t">Income — '+yrIncome.length+' transactions</div>';
  h+='<table><thead><tr><th>Date</th><th>Client</th><th>Type</th><th>Method</th><th style="text-align:right">Amount</th></tr></thead><tbody>';
  yrIncome.forEach(r=>{h+='<tr><td>'+(r.date||'')+'</td><td>'+(r.client_name||'')+'</td><td>'+(r.type||'')+'</td><td>'+(r.method||'')+'</td><td style="text-align:right;font-weight:700">'+fmt(r.amount)+'</td></tr>';});
  h+='<tr class="tr"><td colspan="4">Total Income</td><td style="text-align:right">'+fmt(tInc)+'</td></tr></tbody></table></div>';
  // Expenses by category
  h+='<div class="sec"><div class="sec-t">Expenses by IRS Category</div>';
  h+='<table><thead><tr><th>Category</th><th>Schedule C Line</th><th style="text-align:right">Total</th></tr></thead><tbody>';
  Object.values(byCat).sort((a,b)=>b.total-a.total).forEach(c=>{h+='<tr><td>'+c.icon+' '+c.label+'</td><td style="color:#9a9890">'+c.line+'</td><td style="text-align:right;font-weight:700;color:#791F1F">('+fmt(c.total)+')</td></tr>';});
  h+='<tr class="tr"><td colspan="2">Total Expenses</td><td style="text-align:right">('+fmt(tExp)+')</td></tr></tbody></table></div>';
  // Expense detail
  h+='<div class="sec"><div class="sec-t">Expense Detail — '+yrExp.length+' entries (01/01/'+yr+' - 12/31/'+yr+')</div>';
  h+='<table><thead><tr><th>Date</th><th>Vendor</th><th>Category</th><th>Job</th><th>Receipt</th><th style="text-align:right">Amount</th></tr></thead><tbody>';
  yrExp.forEach(e=>{
    const cat=IRS_EXPENSE_CATS.find(c=>c.id===e.cat)||{icon:'',label:e.cat||'Other'};
    h+='<tr><td>'+(e.date||'')+'</td><td style="font-weight:600">'+(e.vendor||'-')+'</td><td>'+cat.icon+' '+cat.label+'</td><td style="color:#9a9890">'+(e.job_name||'-')+'</td>';
    h+='<td>'+(e.receipt_img||e.receipt_key?'Yes':'No')+'</td><td style="text-align:right;font-weight:700">('+fmt(e.amount)+')</td></tr>';
  });
  h+='<tr class="tr"><td colspan="5">Total</td><td style="text-align:right">('+fmt(tExp)+')</td></tr></tbody></table></div>';
  // Mileage
  h+='<div class="sec"><div class="sec-t">Mileage Log — '+yrMiles.length+' trips at $'+IRS().toFixed(3)+'/mi</div>';
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
  showToast('Tax report opened — Print to save as PDF','📄');
}


function exportFullBackup(){
  const biz=(S.bname||'TradeDesk').replace(/\s+/g,'_');
  const ts=new Date().toISOString().slice(0,10);
  const backup={version:3,exported:new Date().toISOString(),business:S.bname||'',
    data:{clients,bids,jobs,income,expenses,mileage,payments,liens},settings:S,
    meta:{clients:clients.length,bids:bids.length,expenses:expenses.length,income:income.length,mileage:mileage.length}};
  downloadFile(biz+'_TradeDesk_Backup_'+ts+'.json',JSON.stringify(backup,null,2),'application/json');
  showToast('Full backup downloaded — keep this safe','💾');
}
function exportReceiptImages(){
  const yr=document.getElementById('exp-panel-year')?.value||new Date().getFullYear();
  const filtered=expenses.filter(e=>e.receipt_img&&(yr==='all'||String(new Date(e.date).getFullYear())===String(yr)))
    .sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  if(!filtered.length){zAlert('No stored receipt photos for '+yr+'.',{title:'No receipts'});return;}
  const bname=S.bname||'TradeDesk';
  const pages=filtered.map((e,i)=>{
    const cat=e.catLabel||e.cat||'';
    const d=e.date?new Date(e.date+'T12:00:00').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}):e.date||'';
    return `<div class="page">
      <div class="page-hdr">
        <div class="pg-num">Receipt ${i+1} of ${filtered.length}</div>
        <div class="pg-meta">
          <span class="field">${d}</span>
          <span class="field vendor">${e.vendor||'—'}</span>
          <span class="field amount">$${Number(e.amount||0).toFixed(2)}</span>
          <span class="field cat">${cat}</span>
          ${e.job_name?`<span class="field job">Job: ${e.job_name}</span>`:''}
          ${e.notes?`<span class="field notes">${e.notes}</span>`:''}
        </div>
      </div>
      <div class="img-wrap"><img src="${e.receipt_img}" alt="Receipt ${i+1}"></div>
    </div>`;
  }).join('');
  const win=window.open('','_blank');
  if(!win){zAlert('Allow pop-ups to export the PDF.',{title:'Pop-up blocked'});return;}
  win.document.write(`<!DOCTYPE html><html><head>
<meta charset="utf-8">
<title>${bname} — Receipts ${yr}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fff;color:#1a1a1a}
.no-print{background:#185FA5;color:#fff;padding:12px 20px;display:flex;justify-content:space-between;align-items:center}
.no-print button{background:#fff;color:#185FA5;border:none;padding:8px 18px;border-radius:6px;font-weight:700;font-size:14px;cursor:pointer}
.page{page-break-after:always;padding:20px 24px;max-width:800px;margin:0 auto;border-bottom:2px solid #eee;height:calc(100vh - 52px);display:flex;flex-direction:column}
.page:last-child{page-break-after:auto;border-bottom:none}
.page-hdr{margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid #ddd}
.pg-num{font-size:11px;color:#888;margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em}
.pg-meta{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.field{font-size:13px;padding:4px 10px;border-radius:4px;background:#f5f5f3}
.vendor{font-weight:700;font-size:15px;background:#EBF2FB;color:#185FA5}
.amount{font-weight:800;font-size:16px;background:#F0FBF0;color:#3B8C2A}
.cat{background:#FEF3C7;color:#92400E}
.job{background:#F0F0FF;color:#555}
.notes{background:#f5f5f3;color:#666;font-style:italic}
.img-wrap{text-align:center;flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden}
.img-wrap img{max-width:100%;max-height:100%;object-fit:contain;border:1px solid #ddd;border-radius:8px}
@media print{
  .no-print{display:none!important}
  @page{margin:0.3in;size:letter portrait}
  .page{padding:10px 0;height:100vh;page-break-after:always}
  .page:last-child{page-break-after:auto}
}
</style>
</head><body>
<div class="no-print">
  <span><strong>${bname}</strong> — ${filtered.length} receipt${filtered.length>1?'s':''} · ${yr}</span>
  <button onclick="tdPrint()">🖨 Print / Save PDF</button>
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
    '<div class="mets" style="margin-bottom:10px">'+
      '<div class="met"><div class="met-l">Jobs</div><div class="met-v">'+yearBids.length+'</div></div>'+
      '<div class="met"><div class="met-l">Billed</div><div class="met-v" style="color:var(--blue)">'+fmt(totalRev)+'</div></div>'+
      '<div class="met"><div class="met-l">Collected</div><div class="met-v" style="color:var(--green-mid)">'+fmt(totalPaid)+'</div></div>'+
    '</div>'+
    yearBids.map(b=>{
      const paid=getBidPaid(b.id);
      const balance=getBidBalance(b);
      const isPaidFull=balance<=0.01;
      return '<div onclick="openBidHistoryDetail('+b.id+')" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid var(--border);cursor:pointer">'+
        '<div style="flex:1;min-width:0">'+
          '<div style="font-size:14px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+(b.client_name||b.name||'Unknown')+'</div>'+
          '<div style="font-size:11px;color:var(--text3)">'+b.bid_date+(b.addr?' · '+b.addr:'')+'</div>'+
          '<div style="font-size:11px;color:var(--text3);margin-top:1px">'+b.days+' day'+(b.days>1?'s':'')+(b.scope?getTopScope(b.scope):'')+'</div>'+
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

function getTopScope(scope){
  const labels={sand:'sanding',spackle:'spackle',prime:'primer',twocoat:'2 coats',tape:'masking',caulk:'caulking'};
  const on=Object.entries(scope).filter(([k,v])=>v&&labels[k]).map(([k])=>labels[k]);
  return on.length?' · '+on.slice(0,3).join(', ')+(on.length>3?' +'+( on.length-3):''):'';
}

function closeBidHistoryDetail(){const el=document.getElementById('tr-bid-detail');if(el)el.style.display='none';}
function viewSavedProposal(bidId){
  const b=bids.find(x=>x.id===bidId);
  if(!b||!b.proposalHtml){zAlert('No saved proposal found for this bid. Proposals are saved starting from this update — older bids won\'t have one stored.',{title:'Not available'});return;}
  const ov=document.createElement('div');
  ov.setAttribute('data-pov','1');
  ov.style.cssText='position:fixed;inset:0;background:#f0f4f8;z-index:10000;overflow-y:auto;-webkit-overflow-scrolling:touch';
  const signedBadge=b.signedAt?
    '<div style="background:#D1FAE5;border:1px solid #6EE7B7;border-radius:6px;padding:10px 14px;margin-bottom:16px;font-size:12px;color:#065F46;display:flex;align-items:center;gap:8px">'+
      '<span style="font-size:16px">✓</span>'+
      '<span><strong>Signed</strong> '+new Date(b.signedAt).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})+(b.signedName?' by '+escHtml(b.signedName):'')+'</span>'+
    '</div>':'';
  ov.innerHTML=
    '<div style="position:sticky;top:0;background:#1a365d;color:#fff;padding:14px 16px;display:flex;justify-content:space-between;align-items:center;z-index:1">'+
      '<div style="font-size:15px;font-weight:800">Signed Proposal</div>'+
      '<button onclick="document.querySelector(\'[data-pov]\').remove()" style="background:rgba(255,255,255,.2);border:none;color:#fff;padding:6px 14px;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">Close</button>'+
    '</div>'+
    '<div style="padding:16px;max-width:680px;margin:0 auto">'+signedBadge+b.proposalHtml+'</div>';
  document.body.appendChild(ov);
}
function openBidHistoryDetail(bidId){
  const b=bids.find(x=>x.id===bidId);if(!b)return;
  const panel=document.getElementById('tr-bid-detail');
  const content=document.getElementById('tr-bid-detail-content');
  if(!panel||!content)return;

  const PAINT_LABELS={std:'Standard (Behr/Valspar)',prem:'Sherwin-Williams Premium',ultra:'SW Emerald Ultra'};
  const COND_LABELS={'1.0':'Good — minor prep','1.2':'Fair — moderate prep','1.5':'Poor — heavy prep'};
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
      '<div style="font-size:12px;color:var(--text3);margin-top:2px">'+b.bid_date+' · '+b.days+' day'+(b.days>1?'s':'')+'</div>'+
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
    const mileDed=miles*IRS();
    const net=rev-exp-mileDed;
    grandRev+=rev;grandExp+=exp+mileDed;
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

function openManualIncomeModal(){
  const today=new Date().toISOString().slice(0,10);
  const clientOpts=clients.map(c=>'<option value="'+c.id+'">'+escHtml(c.name)+'</option>').join('');
  const ov=document.createElement('div');ov.id='_inc-ov';ov.style.cssText='position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.5);display:flex;align-items:flex-end';
  const sheet=document.createElement('div');sheet.style.cssText='background:var(--bg2);border-radius:16px 16px 0 0;width:100%;padding:20px 16px 32px;box-sizing:border-box';
  sheet.innerHTML=
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'+
      '<div style="font-size:17px;font-weight:800">Log Income</div>'+
      '<button onclick="document.getElementById(\'_inc-ov\').remove()" style="background:none;border:none;font-size:20px;color:var(--text3);cursor:pointer">✕</button>'+
    '</div>'+
    '<div style="display:grid;gap:12px">'+
      '<div><label style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text3);display:block;margin-bottom:5px">Date <span style="color:#A32D2D">*</span></label>'+
        '<input id="_inc-date" type="date" value="'+today+'" style="width:100%;padding:11px 12px;border:1.5px solid var(--border2);border-radius:var(--r);font-size:15px;font-family:inherit;background:var(--bg2);color:var(--text);box-sizing:border-box"></div>'+
      '<div><label style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text3);display:block;margin-bottom:5px">Amount <span style="color:#A32D2D">*</span></label>'+
        '<input id="_inc-amt" type="number" min="0" step="0.01" placeholder="0.00" style="width:100%;padding:11px 12px;border:1.5px solid var(--border2);border-radius:var(--r);font-size:15px;font-family:inherit;background:var(--bg2);color:var(--text);box-sizing:border-box"></div>'+
      '<div><label style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text3);display:block;margin-bottom:5px">Client</label>'+
        '<select id="_inc-client" style="width:100%;padding:11px 12px;border:1.5px solid var(--border2);border-radius:var(--r);font-size:15px;font-family:inherit;background:var(--bg2);color:var(--text);box-sizing:border-box"><option value="">No client / other</option>'+clientOpts+'</select></div>'+
      '<div><label style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text3);display:block;margin-bottom:5px">Type</label>'+
        '<select id="_inc-type" onchange="toggleIncDepositWarn()" style="width:100%;padding:11px 12px;border:1.5px solid var(--border2);border-radius:var(--r);font-size:15px;font-family:inherit;background:var(--bg2);color:var(--text);box-sizing:border-box">'+
          '<option value="Job payment">Job payment</option><option value="Deposit">Deposit / advance</option><option value="Final payment">Final payment</option><option value="Cash">Cash</option><option value="Other">Other</option>'+
        '</select>'+
        '<div id="_inc-deposit-warn" style="display:none;background:#FFFBEB;border:1.5px solid #D97706;border-radius:var(--r);padding:10px 12px;margin-top:8px;font-size:12px;color:#92400E;line-height:1.5">'+
          '💡 <strong>Deposits count as income now.</strong> The IRS says any money you receive is taxable the year you get it — even if it\'s a deposit for work you haven\'t done yet. Don\'t wait until the job is done to report it.'+
        '</div></div>'+
      '<div><label style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text3);display:block;margin-bottom:5px">Payment method</label>'+
        '<select id="_inc-method" style="width:100%;padding:11px 12px;border:1.5px solid var(--border2);border-radius:var(--r);font-size:15px;font-family:inherit;background:var(--bg2);color:var(--text);box-sizing:border-box" onchange="toggleCashWarning()">'+
          '<option value="Check">Check</option><option value="Card">Card</option><option value="Zelle">Zelle</option><option value="Venmo">Venmo</option><option value="Cash">Cash</option><option value="Other">Other</option>'+
        '</select></div>'+
      '<div id="_inc-cash-warn" style="display:none;background:#FFFACD;border:2px solid #F59E0B;border-radius:var(--r);padding:10px 12px;margin-top:10px">'+
        '<div style="font-size:12px;font-weight:700;color:#78350F;margin-bottom:6px">⚠️ Cash Income — IRS Red Flag</div>'+
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
  const date=document.getElementById('_inc-date')?.value||'';
  const amtRaw=parseFloat(document.getElementById('_inc-amt')?.value||'');
  const errEl=document.getElementById('_inc-err');
  if(!date){errEl.textContent='Please select a date.';errEl.style.display='block';return;}
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
  saveAll();
  document.getElementById('_inc-ov')?.remove();
  const entryYear=parseInt(date.slice(0,4));
  if(entryYear!==trackerYear){
    setTrackerYear(entryYear);
    const sel=document.getElementById('tracker-year-sel');if(sel)sel.value=entryYear;
    showToast('Income logged for '+entryYear,'📅');
  } else {
    renderIncome();
    showToast('Income logged','✅');
  }
}
function renderIncome(){
  const el=document.getElementById('inc-table');
  const yr=String(trackerYear||new Date().getFullYear());
  const filtered=[...income].filter(r=>r.date&&r.date.startsWith(yr)).sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  const total=filtered.reduce((s,r)=>s+r.amount,0);
  if(!income.length){el.innerHTML='<div class="empty">No income logged yet.<br><br>Income is recorded automatically when you log a payment on a client bid.</div>';return;}
  if(!filtered.length){el.innerHTML='<div class="empty">No income in '+yr+'.</div>';return;}
  el.innerHTML=
    '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0 10px;border-bottom:2px solid var(--border);margin-bottom:4px">'+
      '<span style="font-size:12px;font-weight:700;color:var(--text3)">'+filtered.length+' payment'+(filtered.length!==1?'s':'')+' in '+yr+'</span>'+
      '<span style="font-size:15px;font-weight:800;color:var(--green-mid)">'+fmt(total)+'</span>'+
    '</div>'+
    '<div style="overflow-x:auto"><table class="tbl"><thead><tr>'+
    ['Date','Client','Type','Amount','Method'].map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>'+
    filtered.map(r=>{
      const c=clients.find(x=>x.id===r.client_id);
      return '<tr style="cursor:'+(c?'pointer':'default')+'"'+(c?' onclick="openClientDetail('+c.id+')"':'')+'>'+
        '<td class="mute">'+r.date+'</td>'+
        '<td class="bold" style="color:'+(c?'var(--blue)':'inherit')+'">'+(r.client_name||'—')+'</td>'+
        '<td class="mute">'+(r.type||'—')+'</td>'+
        '<td class="green">'+fmtD(r.amount)+'</td>'+
        '<td class="mute">'+(r.pay||'—')+'</td>'+
      '</tr>';
    }).join('')+'</tbody></table></div>';
}
function triggerReceiptScan(){
  openExpenseFlow();
  // Give the modal time to render, then trigger the scan inside it
  setTimeout(()=>expTriggerScan(),200);
}

async function processReceiptPhoto(input){
  const file=input.files[0];if(!file)return;
  const tip=document.getElementById('scan-tip');
  const resultArea=document.getElementById('scan-result');
  tip.innerHTML='<strong>Reading receipt...</strong>';
  resultArea.style.display='none';
  const b64=await new Promise((res,rej)=>{
    const r=new FileReader();
    r.onload=()=>res(r.result.split(',')[1]);
    r.onerror=rej;
    r.readAsDataURL(file);
  });
  try{
    // Call via Supabase Edge Function so API key stays secure server-side
    const session=_supa?await _supa.auth.getSession():null;
    const token=session?.data?.session?.access_token;
    const resp=await fetch('https://mwtsmctajhrrybblgorf.supabase.co/functions/v1/scan-receipt',{
      method:'POST',
      headers:{'Content-Type':'application/json',...(token?{'Authorization':'Bearer '+token}:{})},
      body:JSON.stringify({imageBase64:b64,mediaType:'image/jpeg'})
    });
    if(!resp.ok)throw new Error('Scan service error '+resp.status);
    const parsed=await resp.json();
    if(parsed.vendor)document.getElementById('exp-vendor').value=parsed.vendor;
    if(parsed.amount)document.getElementById('exp-amount').value=parsed.amount;
    if(parsed.date)document.getElementById('exp-date').value=parsed.date;
    if(parsed.category){
      const sel=document.getElementById('exp-cat');
      for(let i=0;i<sel.options.length;i++){if(sel.options[i].text.toLowerCase().includes(parsed.category.toLowerCase())){sel.selectedIndex=i;break;}}
    }
    if(parsed.notes)document.getElementById('exp-notes').value=parsed.notes;
    document.getElementById('exp-receipt').value='Yes — photo taken';
    resultArea.style.display='block';
    resultArea.innerHTML='<div class="tip tip-s" style="margin-bottom:8px"><strong>&#10003; Receipt read</strong> — '+(parsed.vendor||'vendor')+' · '+fmt(parsed.amount||0)+'. Review below and save.</div>';
    tip.textContent='Receipt scanned. Review the details below and tap Save expense.';
    document.getElementById('exp-vendor').scrollIntoView({behavior:'smooth',block:'center'});
  }catch(e){
    tip.textContent='Could not read receipt. Fill in manually below.';
    resultArea.style.display='none';
  }
  input.value='';
}

function populateExpJobSel(){
  const sel=document.getElementById('exp-job-sel');if(!sel)return;
  const wonJobs=bids.filter(b=>b.status==='Closed Won');
  sel.innerHTML='<option value="">— Not job-specific —</option>'+
    wonJobs.map(b=>'<option value="'+b.id+'">'+(b.client_name||b.name)+(b.addr?' · '+b.addr:'')+'</option>').join('');
}
function renderExpenses(){
  const el=document.getElementById('exp-table');if(!el)return;
  const yr=String(trackerYear||new Date().getFullYear());
  // Show all years for back-tax work if selected year matches
  const filtered=yr==='all'?expenses:expenses.filter(e=>e.date&&e.date.startsWith(yr));
  const total=filtered.reduce((s,e)=>s+e.amount,0);
  const deductible=filtered.filter(e=>e.deductible!==false).reduce((s,e)=>s+(e.meals_50?e.amount*0.5:e.amount),0);
  const noReceipt=filtered.filter(e=>!e.receipt||e.receipt.includes('No')).filter(e=>e.cat!=='fees'&&!e.autoLogged);
  const today=todayKey();
  const purgeable=expenses.filter(e=>e.expires_at&&e.expires_at<today&&e.receipt_img);
  let html='';
  if(purgeable.length){
    html+='<div class="tip tip-w" style="display:flex;justify-content:space-between;align-items:center"><span>'+purgeable.length+' receipt image'+(purgeable.length>1?'s':'')+' past 7 years — images can be deleted, records kept</span><button class="btn btn-sm" onclick="purgeOldReceiptImages()" style="flex-shrink:0;margin-left:8px">Clean up</button></div>';
  }
  // 1099-NEC alert — aggregate subcontractor expenses by vendor
  const subsFiltered=filtered.filter(e=>e.cat==='subs');
  if(subsFiltered.length){
    const subsBy={};
    subsFiltered.forEach(e=>{const k=(e.vendor||'Unknown').trim();subsBy[k]=(subsBy[k]||0)+e.amount;});
    const flagged=Object.entries(subsBy).filter(([,amt])=>amt>=600);
    if(flagged.length){
      html+='<div class="tip tip-a" style="background:#FFF3CD;border:1.5px solid #D4A017;color:#6B4C00"><strong>⚠️ 1099-NEC Required:</strong> '+flagged.length+' subcontractor'+(flagged.length>1?'s':'')+' reached $600+ in '+yr+' — file Form 1099-NEC by Jan 31. '+flagged.map(([v,a])=>v+' ('+fmt(a)+')').join(', ')+'</div>';
    }
  }
  if(noReceipt.length){
    const missingPct=filtered.length>0?Math.round(noReceipt.length/filtered.length*100):0;
    const cls=missingPct>30?'tip-a':'tip-w';
    html+='<div class="tip '+cls+'"><strong>'+noReceipt.length+' missing receipt'+(noReceipt.length>1?'s':'')+' ('+missingPct+'% of '+yr+' expenses)</strong>'+(missingPct>30?' — ⚠️ Over 30% missing. IRS can disallow undocumented expenses.':' — photograph them before they\'re gone.')+'</div>';
  }
  if(!expenses.length){el.innerHTML=html+'<div class="empty-state"><div class="empty-state-icon">🧾</div><h3>No expenses yet</h3><p>Tap the Expense button on the home screen or use the Scan button above to photograph a receipt.</p></div>';return;}
  if(!filtered.length){el.innerHTML=html+'<div class="empty">No expenses in '+yr+'.</div>';return;}
  // Summary row
  html+='<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0 12px;border-bottom:2px solid var(--border);margin-bottom:4px;flex-wrap:wrap;gap:6px">'+
    '<div>'+
      '<span style="font-size:12px;font-weight:700;color:var(--text3)">'+filtered.length+' expense'+(filtered.length!==1?'s':'')+' in '+yr+'</span>'+
    '</div>'+
    '<div style="text-align:right">'+
      '<div style="font-size:16px;font-weight:800;color:#A32D2D">('+fmt(total)+')</div>'+
      '<div style="font-size:10px;color:var(--green-mid);font-weight:700">~'+fmt(deductible)+' deductible</div>'+
    '</div>'+
  '</div>';
  // By category summary
  const byCat={};
  filtered.forEach(e=>{byCat[e.cat||'other']=(byCat[e.cat||'other']||0)+e.amount;});
  const topCats=Object.entries(byCat).sort((a,b)=>b[1]-a[1]).slice(0,4);
  if(topCats.length>1){
    html+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">'+
      topCats.map(([cat,amt])=>{
        const info=IRS_EXPENSE_CATS.find(c=>c.id===cat);
        return '<div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:6px 10px;font-size:11px">'+
          '<span style="font-weight:700;color:var(--text2)">'+(info?info.icon+' '+info.label:cat)+'</span>'+
          ' <span style="color:#A32D2D;font-weight:700">('+fmt(amt)+')</span>'+
        '</div>';
      }).join('')+
    '</div>';
  }
  // Expense rows
  html+='<div style="overflow-x:auto"><table class="tbl"><thead><tr>'+
    ['Date','Category','Vendor','Amount','Receipt'].map(h=>'<th>'+h+'</th>').join('')+'<th></th></tr></thead><tbody>'+
    [...filtered].sort((a,b)=>(a.date||'').localeCompare(b.date||'')).map(r=>{
      const info=IRS_EXPENSE_CATS.find(c=>c.id===r.cat);
      const hasImg=!!(r.receipt_img||r.receipt_key);
      const recLabel=hasImg?'<button onclick="viewReceipt('+r.id+')" style="background:var(--green-lt);border:1px solid var(--green);color:var(--green);font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;cursor:pointer;font-family:inherit">📎 View</button>':'<span style="color:#A32D2D;font-weight:700;font-size:10px">Missing</span>';
      return '<tr>'+
        '<td class="mute">'+r.date+'</td>'+
        '<td class="mute" style="font-size:10px">'+(info?info.icon+' '+info.label:r.catLabel||r.cat||'—')+'</td>'+
        '<td class="bold">'+(r.vendor||'—')+(r.job_name?'<div style="font-size:9px;color:var(--text3)">'+r.job_name+'</div>':'')+'</td>'+
        '<td class="red">('+fmtD(r.amount)+')'+(r.meals_50?'<div style="font-size:9px;color:var(--amber)">50% deduct</div>':'')+'</td>'+
        '<td>'+recLabel+'</td>'+
        '<td><button class="btn-del" onclick="delExpense('+r.id+')">&#10005;</button></td>'+
      '</tr>';
    }).join('')+'</tbody></table></div>';
  el.innerHTML=html;
}

async function purgeOldReceiptImages(){
  if(!supaEnabled()||!_supaUser)return zAlert('Sign in to manage cloud receipts.');
  const today=todayKey();
  const old=expenses.filter(e=>e.expires_at&&e.expires_at<today&&e.receipt_img);
  zConfirm('Delete '+old.length+' receipt image'+(old.length>1?'s':'')+' older than 7 years? Dollar amounts and records are kept permanently — only the photos are removed.',async()=>{
    for(const e of old){
      e.receipt_img=null;e.receipt_key=null;e.receipt='Records kept — image purged after 7 years';
    }
    saveAll();renderExpenses();showToast(old.length+' receipt images purged — records kept','🗑️');
  },{title:'Purge old receipt images',yes:'Delete images',danger:true});
}
function delExpense(id){expenses=expenses.filter(x=>x.id!==id);saveAll();renderExpenses();}
async function getCurrentLocAddress(){
  return new Promise((resolve,reject)=>{
    if(!navigator.geolocation){reject(new Error('GPS not available'));return;}
    navigator.geolocation.getCurrentPosition(async pos=>{
      const{latitude:lat,longitude:lon}=pos.coords;
      _tripGpsCoords={lat,lng:lon}; // cache for search bias
      // MapKit reverse geocode (fast, Apple data)
      if(_mapkitReady){
        const gc=new mapkit.Geocoder({language:'en-US'});
        gc.reverseLookup(new mapkit.Coordinate(lat,lon),(err,data)=>{
          if(!err&&data?.results?.[0]){
            const p=data.results[0];
            const parts=[];
            if(p.fullThoroughfare)parts.push(p.fullThoroughfare);
            else if(p.thoroughfare)parts.push([p.subThoroughfare,p.thoroughfare].filter(Boolean).join(' '));
            if(p.locality)parts.push(p.locality);
            if(p.administrativeAreaCode)parts.push(p.administrativeAreaCode);
            if(p.postCode)parts.push(p.postCode);
            resolve(parts.join(', ')||p.formattedAddress||'');
          } else {
            resolve(lat.toFixed(4)+', '+lon.toFixed(4));
          }
        });
        return;
      }
      // Nominatim fallback
      try{
        const r=await fetch('https://nominatim.openstreetmap.org/reverse?lat='+lat+'&lon='+lon+'&format=json',{headers:{'Accept-Language':'en-US','User-Agent':'TradeDesk/1.0'}});
        const d=await r.json();
        const a=d.address||{};
        const parts=[];
        if(a.house_number&&a.road)parts.push(a.house_number+' '+a.road);
        else if(a.road)parts.push(a.road);
        if(a.city||a.town||a.village)parts.push(a.city||a.town||a.village);
        if(a.state)parts.push(a.state);
        if(a.postcode)parts.push(a.postcode);
        resolve(parts.join(', ')||d.display_name||'');
      }catch(e){resolve(lat.toFixed(4)+', '+lon.toFixed(4));}
    },err=>reject(err),{timeout:8000,enableHighAccuracy:false,maximumAge:300000});
  });
}
function renderSummary(){
  const yr=String(trackerYear||new Date().getFullYear());
  const sumSel=document.getElementById('sum-tx-status');
  if(sumSel&&S.txStatus)sumSel.value=S.txStatus;
  const yInc=income.filter(r=>r.date&&r.date.startsWith(yr));
  const yExp=expenses.filter(e=>e.date&&e.date.startsWith(yr));
  const yMi=mileage.filter(m=>m.date&&m.date.startsWith(yr));
  const tIn=yInc.reduce((s,r)=>s+r.amount,0);
  const tEx=yExp.reduce((s,r)=>s+r.amount,0);
  const tMi=yMi.reduce((s,r)=>s+(r.miles||0),0);
  const irsRateYr=_getIrsRateForYear(yr);
  const net=Math.max(0,tIn-tEx-(tMi*irsRateYr));
  const tax=estimateTax(net,yr);
  const profit=tIn-tEx-(tMi*IRS())-tax;
  document.getElementById('sum-mets').innerHTML=
    '<div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">'+yr+' summary</div>'+
    '<div class="mets">'+
    '<div class="met"><div class="met-l">Income</div><div class="met-v" style="color:var(--green-mid)">'+fmt(tIn)+'</div></div>'+
    '<div class="met"><div class="met-l">Expenses</div><div class="met-v" style="color:#A32D2D">'+fmt(tEx)+'</div></div>'+
    '<div class="met"><div class="met-l">Mile deduction</div><div class="met-v">'+fmt(tMi*irsRateYr)+'</div><div class="met-s">'+tMi.toFixed(0)+' mi · $'+irsRateYr.toFixed(3)+'/mi</div></div>'+
    '<div class="met"><div class="met-l">Est. tax</div><div class="met-v" style="color:var(--amber)">'+fmt(tax)+'</div></div>'+
    '<div class="met" style="grid-column:1/-1"><div class="met-l">Net profit</div><div class="met-v" style="color:'+(profit>=0?'var(--green-mid)':'#A32D2D')+'">'+fmt(profit)+'</div><div class="met-s">After tax &amp; deductions</div></div>'+
    '</div>';
  const byType={};yInc.forEach(r=>{byType[r.type]=(byType[r.type]||0)+r.amount;});
  const byCat={};yExp.forEach(r=>{byCat[r.cat]=(byCat[r.cat]||0)+r.amount;});
  document.getElementById('sum-inc').innerHTML=!tIn?'<div class="empty">No income in '+yr+'.</div>':Object.entries(byType).sort((a,b)=>b[1]-a[1]).map(([k,vl])=>barChart(k,vl,tIn,'#185FA5')).join('');
  document.getElementById('sum-exp').innerHTML=!tEx?'<div class="empty">No expenses in '+yr+'.</div>':Object.entries(byCat).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k,vl])=>barChart(k,vl,tEx,'#E24B4A')).join('');
  const byClient={};yMi.forEach(m=>{const k=m.client_name||'Unlinked';byClient[k]=(byClient[k]||0)+(m.miles||0);});
  document.getElementById('sum-mile').innerHTML=!tMi?'<div class="empty">No mileage in '+yr+'.</div>':Object.entries(byClient).sort((a,b)=>b[1]-a[1]).map(([k,mi])=>'<div style="display:flex;justify-content:space-between;font-size:12px;padding:5px 0;border-bottom:1px solid var(--border)"><span>'+k+'</span><span style="font-weight:700">'+mi.toFixed(1)+' mi · '+fmt(mi*irsRateYr)+'</span></div>').join('');
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
  if(summEl){
    summEl.innerHTML='<div class="mets">'+
      '<div class="met"><div class="met-l">Total owed</div><div class="met-v" style="color:'+(totalOwed>0?'#A32D2D':'var(--green-mid)')+'">'+fmt(totalOwed)+'</div></div>'+
      '<div class="met"><div class="met-l">Overdue</div><div class="met-v" style="color:'+(overdueCt?'#A32D2D':'var(--green-mid)')+'">'+overdueCt+'</div></div>'+
      '<div class="met"><div class="met-l">This month</div><div class="met-v" style="color:var(--blue)">'+fmt(paidThisMonth)+'</div></div>'+
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
    el.innerHTML='<div class="empty">'+(moneyFilter==='paid'?'No paid jobs in records.':moneyFilter==='all'?'Nothing outstanding — all collected! 🎉':'No '+moneyFilter+' items.')+'</div>';return;
  }
  el.innerHTML=show.map(({c,b,balance,paid,total,bucket,daysUnpaid})=>{
    const pct=total>0?Math.min(100,Math.round(paid/total*100)):0;
    const stage=b.collStage||'none';
    const csInfo=COLL_STAGES[stage]||{};
    const urgTag=bucket==='overdue'?
      '<span style="font-size:10px;font-weight:800;color:#fff;background:#A32D2D;padding:2px 6px;border-radius:4px">'+daysUnpaid+'d unpaid</span>'+
      (csInfo.label?'<span style="font-size:10px;color:'+csInfo.color+';font-weight:700;margin-left:4px">'+csInfo.label+'</span>':''):
      bucket==='paid'?'<span style="font-size:10px;font-weight:800;color:#fff;background:var(--green);padding:2px 6px;border-radius:4px">Paid ✓</span>':'';
    const phone=c.phone?c.phone.replace(/\D/g,''):'';
    return '<div style="padding:12px 0;border-bottom:1px solid var(--border)">'+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px">'+
        '<div style="flex:1;min-width:0">'+
          '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:2px">'+
            '<div style="font-size:14px;font-weight:700;cursor:pointer" onclick="openClientDetail('+c.id+')">'+(c.name)+'</div>'+
            urgTag+
          '</div>'+
          '<div style="font-size:11px;color:var(--text3)">'+
            (paid>0.01?fmt(paid)+' paid · ':'')+fmt(balance)+' remaining'+
            (b.completion_date?' · done '+b.completion_date:'')+
          '</div>'+
          (total>0&&paid>0?'<div class="pay-bar" style="margin-top:6px"><div class="pay-fill" style="width:'+pct+'%;background:var(--green)"></div></div>':'')+ 
        '</div>'+
        '<div style="font-size:16px;font-weight:800;color:'+(bucket==='paid'?'var(--green-mid)':bucket==='overdue'?'#A32D2D':'var(--blue)')+'">'+fmt(bucket==='paid'?total:balance)+'</div>'+
      '</div>'+
      (bucket!=='paid'?
        (()=>{
          const stage=b.collStage||'none';
          const nxt=getNextCollAction(stage);
          const phone=c.phone?c.phone.replace(/\D/g,''):'';
          let nextBtn='';
          if(nxt.smsKey){
            nextBtn='<button class="btn btn-sm btn-r" onclick="collSendSMS(bids.find(x=>x.id=='+b.id+'),\''+nxt.smsKey+'\')" style="flex:1;font-size:11px">'+nxt.label+'</button>';
          } else if(stage==='intent'||stage==='lien_ready'){
            nextBtn='<button class="btn btn-sm btn-r" onclick="showFileLienDirect('+b.id+')" style="flex:1;font-size:11px">'+nxt.label+'</button>';
          } else if(stage==='lien_filed'){
            nextBtn='<button class="btn btn-sm" onclick="releaseLien('+b.id+')" style="flex:1;font-size:11px;background:var(--green-lt);color:var(--green);border-color:var(--green)">'+nxt.label+'</button>';
          }
          return '<div style="display:flex;gap:6px;flex-wrap:wrap">'+
            nextBtn+
            '<button class="btn btn-sm btn-g" onclick="openPayPanel('+b.id+')" style="font-size:11px">💰 Log payment</button>'+
            '</div>';
        })():'')+
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
// ── quickAction('collect') — prioritized collect modal ───────────────────
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
    '<div style="text-align:center;padding:24px;color:var(--text3)">🎉 Nothing to collect — all paid!</div>':
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
          '<button class="btn btn-sm btn-g" onclick="document.querySelector(\'.zmodal-overlay\').remove();openClientDetail('+c.id+');setTimeout(()=>{setCDTab(\'bids\',null);setTimeout(()=>openPayPanel('+b.id+'),100)},200)" style="flex:1;font-size:13px;padding:10px 14px">💰 Log payment</button>'+
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
  document.getElementById('chk-progress').innerHTML=`<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px;font-weight:600"><span>${done} of ${CHECKS.length} completed</span><span>${pct}%</span></div><div class="prog-bar" style="height:8px"><div class="prog-fill" style="width:${pct}%"></div></div>`;
  document.getElementById('chk-body').innerHTML=Object.entries(CAT_CFG).map(([cat,cfg])=>{
    const items=CHECKS.filter(c=>c.cat===cat);
    return`<div class="card"><div style="font-size:12px;font-weight:700;color:${cfg.color};margin-bottom:10px;text-transform:uppercase;letter-spacing:.04em">${cfg.label}</div>`+items.map(c=>`<div class="check-item"><input type="checkbox" ${checksState[c.title]?'checked':''} onchange="toggleCheck(this,'${c.title.replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'\\"')}')"><div><div class="ctitle ${checksState[c.title]?'done':''}">${c.title}</div><div class="cdesc">${c.desc}</div></div></div>`).join('')+'</div>';
  }).join('');
}
function toggleCheck(el,title){checksState[title]=el.checked;saveAll();renderChecklist();}

function toggleDarkMode(on){
  if(document.body&&document.body.classList)document.body.classList.toggle('dark', on);
  S.darkMode = on;
  saveAll();
}
