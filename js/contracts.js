// ── Maintenance Contracts ─────────────────────────────────────────────────────
// Recurring service agreements: annual, biannual, quarterly, monthly.
// Stored in global contracts[] (localStorage primary, Supabase best-effort).

const CONTRACT_FREQ=[
  {id:'monthly',   label:'Monthly',      months:1},
  {id:'quarterly', label:'Quarterly',    months:3},
  {id:'biannual',  label:'Twice a year', months:6},
  {id:'annual',    label:'Annual',       months:12},
];

function _ctFreqLabel(id){return(CONTRACT_FREQ.find(f=>f.id===id)||{label:'Recurring'}).label;}

function _ctNextDate(today,freqId){
  const f=CONTRACT_FREQ.find(x=>x.id===freqId)||{months:12};
  const d=new Date(today+'T12:00');
  d.setMonth(d.getMonth()+f.months);
  return d.toISOString().slice(0,10);
}

function _ctStatusBadge(ct){
  const tk=todayKey();
  if(!ct.active)return'<span style="font-size:10px;font-weight:700;background:var(--bg2);color:var(--text3);padding:2px 8px;border-radius:10px">Inactive</span>';
  if(!ct.nextDate)return'';
  const d=Math.ceil((new Date(ct.nextDate+'T12:00')-new Date())/86400000);
  if(d<0)return'<span style="font-size:10px;font-weight:800;background:#FEE8E8;color:#991B1B;padding:2px 8px;border-radius:10px">Overdue</span>';
  if(d<=14)return'<span style="font-size:10px;font-weight:800;background:#FEF3C7;color:#92400E;padding:2px 8px;border-radius:10px">Due in '+d+'d</span>';
  return'<span style="font-size:10px;font-weight:700;background:#D1FAE5;color:#065F46;padding:2px 8px;border-radius:10px">Active</span>';
}

function openNewContractModal(clientId){
  const c=getClientById(clientId);if(!c)return;
  document.getElementById('_ct-modal-ov')?.remove();
  const ov=document.createElement('div');
  ov.id='_ct-modal-ov';ov.className='zmodal-overlay';
  const box=document.createElement('div');box.className='zmodal';
  box.innerHTML=
    '<div style="font-size:17px;font-weight:800;margin-bottom:4px">New Maintenance Contract</div>'+
    '<div style="font-size:12px;color:var(--text3);margin-bottom:16px">'+escHtml(c.name)+'</div>'+
    '<div class="f" style="margin-bottom:12px"><label>Service title</label>'+
      '<input id="ct-title" placeholder="e.g. Annual exterior touch-up & caulk" style="font-size:14px;padding:10px"></div>'+
    '<div class="fg fg2" style="margin-bottom:12px">'+
      '<div class="f"><label>Schedule</label>'+
        '<select id="ct-freq" style="font-size:14px;padding:10px">'+
          CONTRACT_FREQ.map(f=>'<option value="'+f.id+'">'+f.label+'</option>').join('')+
        '</select></div>'+
      '<div class="f"><label>Amount ($)</label>'+
        '<input id="ct-amount" type="number" min="0" step="0.01" placeholder="0.00" style="font-size:15px;padding:10px;font-weight:700"></div>'+
    '</div>'+
    '<div class="fg fg2" style="margin-bottom:12px">'+
      '<div class="f"><label>Start date</label>'+
        '<input id="ct-start" type="date" value="'+todayKey()+'" style="font-size:14px;padding:10px"></div>'+
      '<div class="f"><label>First service date</label>'+
        '<input id="ct-next" type="date" value="'+todayKey()+'" style="font-size:14px;padding:10px"></div>'+
    '</div>'+
    '<div class="f" style="margin-bottom:16px"><label>Notes (optional)</label>'+
      '<textarea id="ct-notes" placeholder="Scope, access instructions, client preferences..." '+
        'style="font-size:13px;padding:10px;min-height:60px;resize:none;line-height:1.5;width:100%;box-sizing:border-box;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);font-family:inherit"></textarea></div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'+
      '<button onclick="document.getElementById(\'_ct-modal-ov\').remove()" style="padding:11px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;color:var(--text)">Cancel</button>'+
      '<button onclick="_ctSaveNew('+clientId+')" style="padding:11px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">Save contract</button>'+
    '</div>';
  ov.appendChild(box);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  setTimeout(()=>document.getElementById('ct-title')?.focus(),100);
}

function _ctSaveNew(clientId){
  const title=(document.getElementById('ct-title')?.value||'').trim();
  if(!title)return showToast('Enter a service title','⚠️');
  const amount=parseFloat(document.getElementById('ct-amount')?.value||0)||0;
  const freq=document.getElementById('ct-freq')?.value||'annual';
  const start=document.getElementById('ct-start')?.value||todayKey();
  const next=document.getElementById('ct-next')?.value||todayKey();
  const notes=document.getElementById('ct-notes')?.value||'';
  contracts.push({id:Date.now(),clientId,title,freq,amount,startDate:start,nextDate:next,notes,active:true,invoices:[]});
  saveAll();
  document.getElementById('_ct-modal-ov')?.remove();
  showToast('Contract saved','📋');
  renderClientContracts(clientId);
  renderContractsDash();
}

function editContractModal(ctId){
  const ct=contracts.find(x=>x.id===ctId);if(!ct)return;
  const c=getClientById(ct.clientId);if(!c)return;
  document.getElementById('_ct-modal-ov')?.remove();
  const ov=document.createElement('div');
  ov.id='_ct-modal-ov';ov.className='zmodal-overlay';
  const box=document.createElement('div');box.className='zmodal';
  box.innerHTML=
    '<div style="font-size:17px;font-weight:800;margin-bottom:4px">Edit Contract</div>'+
    '<div style="font-size:12px;color:var(--text3);margin-bottom:16px">'+escHtml(c.name)+'</div>'+
    '<div class="f" style="margin-bottom:12px"><label>Service title</label>'+
      '<input id="ct-title" value="'+escHtml(ct.title||'')+'" style="font-size:14px;padding:10px"></div>'+
    '<div class="fg fg2" style="margin-bottom:12px">'+
      '<div class="f"><label>Schedule</label>'+
        '<select id="ct-freq" style="font-size:14px;padding:10px">'+
          CONTRACT_FREQ.map(f=>'<option value="'+f.id+'"'+(ct.freq===f.id?' selected':'')+'>'+f.label+'</option>').join('')+
        '</select></div>'+
      '<div class="f"><label>Amount ($)</label>'+
        '<input id="ct-amount" type="number" min="0" step="0.01" value="'+(ct.amount||'')+'" style="font-size:15px;padding:10px;font-weight:700"></div>'+
    '</div>'+
    '<div class="fg fg2" style="margin-bottom:12px">'+
      '<div class="f"><label>Start date</label>'+
        '<input id="ct-start" type="date" value="'+(ct.startDate||todayKey())+'" style="font-size:14px;padding:10px"></div>'+
      '<div class="f"><label>Next service date</label>'+
        '<input id="ct-next" type="date" value="'+(ct.nextDate||todayKey())+'" style="font-size:14px;padding:10px"></div>'+
    '</div>'+
    '<label style="display:flex;align-items:center;gap:10px;font-size:13px;font-weight:600;cursor:pointer;padding:10px;background:var(--bg2);border-radius:var(--r);margin-bottom:12px">'+
      '<input type="checkbox" id="ct-active"'+(ct.active?' checked':'')+' style="width:16px;height:16px;cursor:pointer">Active contract</label>'+
    '<div class="f" style="margin-bottom:16px"><label>Notes</label>'+
      '<textarea id="ct-notes" style="font-size:13px;padding:10px;min-height:60px;resize:none;line-height:1.5;width:100%;box-sizing:border-box;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);font-family:inherit">'+escHtml(ct.notes||'')+'</textarea></div>'+
    // Mark this service done → advances nextDate to the next cycle, which drops the
    // contract off the dashboard "Maintenance Due" card (it filters nextDate<=today+14).
    '<button onclick="logContractVisit('+ctId+');document.getElementById(\'_ct-modal-ov\').remove();" style="width:100%;padding:12px;border-radius:var(--r);border:none;background:var(--green);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:8px;touch-action:manipulation">✓ Log service — advance to next visit</button>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">'+
      ''+
      '<button onclick="document.getElementById(\'_ct-modal-ov\').remove()" style="padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;color:var(--text)">Cancel</button>'+
      '<button onclick="_ctUpdate('+ctId+')" style="padding:10px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">Save</button>'+
    '</div>';
  ov.appendChild(box);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
}

function _ctUpdate(ctId){
  const ct=contracts.find(x=>x.id===ctId);if(!ct)return;
  ct.title=(document.getElementById('ct-title')?.value||'').trim()||ct.title;
  ct.freq=document.getElementById('ct-freq')?.value||ct.freq;
  ct.amount=parseFloat(document.getElementById('ct-amount')?.value||0)||0;
  ct.startDate=document.getElementById('ct-start')?.value||ct.startDate;
  ct.nextDate=document.getElementById('ct-next')?.value||ct.nextDate;
  ct.notes=document.getElementById('ct-notes')?.value||'';
  ct.active=!!(document.getElementById('ct-active')?.checked);
  saveAll();
  document.getElementById('_ct-modal-ov')?.remove();
  showToast('Contract updated','✓');
  renderClientContracts(ct.clientId);
  renderContractsDash();
}

function _ctDelete(ctId){
  const ct=contracts.find(x=>x.id===ctId);if(!ct)return;
  zConfirm('Delete this maintenance contract?',()=>{
    _userDelete(()=>{contracts=contracts.filter(x=>x.id!==ctId);saveAll();});
    document.getElementById('_ct-modal-ov')?.remove();
    showToast('Contract deleted','🗑️');
    renderClientContracts(ct.clientId);
    renderContractsDash();
  },{title:'Delete contract',yes:'Delete',danger:true});
}

function logContractVisit(ctId){
  const ct=contracts.find(x=>x.id===ctId);if(!ct)return;
  const today=todayKey();
  if(!ct.invoices)ct.invoices=[];
  ct.invoices.push({date:today,amount:ct.amount,paid:false});
  ct.nextDate=_ctNextDate(today,ct.freq);
  saveAll();
  showToast('Visit logged · next: '+ct.nextDate,'📋');
  renderClientContracts(ct.clientId);
  renderContractsDash();
}

function markCtInvoicePaid(ctId,idx){
  const ct=contracts.find(x=>x.id===ctId);if(!ct||!ct.invoices||!ct.invoices[idx])return;
  ct.invoices[idx].paid=true;
  ct.invoices[idx].paidDate=todayKey();
  saveAll();
  showToast('Invoice marked paid','✓');
  renderClientContracts(ct.clientId);
}

function renderClientContracts(clientId){
  const el=document.getElementById('cdt-contracts-content');if(!el)return;
  const cts=contracts.filter(c=>c.clientId===clientId);
  if(!cts.length){
    el.innerHTML=
      '<div style="text-align:center;padding:40px 20px;color:var(--text3)">'+
        '<div style="font-size:36px;margin-bottom:10px">🔄</div>'+
        '<div style="font-size:14px;font-weight:700;margin-bottom:6px">No maintenance contracts yet</div>'+
        '<div style="font-size:12px;margin-bottom:16px">Turn one-time clients into recurring revenue with annual or seasonal service agreements.</div>'+
        '<button onclick="openNewContractModal('+clientId+')" class="btn btn-p">+ New contract</button>'+
      '</div>';
    return;
  }
  const tk=todayKey();
  let html=
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">'+
      '<div style="font-size:12px;color:var(--text3)">'+cts.length+' contract'+(cts.length!==1?'s':'')+'</div>'+
      '<button onclick="openNewContractModal('+clientId+')" class="btn btn-sm btn-p">+ Add</button>'+
    '</div>';
  cts.forEach(ct=>{
    const unpaidIdx=(ct.invoices||[]).findIndex(i=>!i.paid);
    const totalBilled=(ct.invoices||[]).reduce((s,i)=>s+(i.amount||0),0);
    const totalPaid=(ct.invoices||[]).filter(i=>i.paid).reduce((s,i)=>s+(i.amount||0),0);
    const visits=(ct.invoices||[]).length;
    html+=
      '<div style="border:1px solid var(--border);border-radius:var(--r);padding:14px;margin-bottom:10px;background:var(--bg2)">'+
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px">'+
          '<div style="flex:1;min-width:0">'+
            '<div style="font-size:14px;font-weight:800;color:var(--text);margin-bottom:2px">'+escHtml(ct.title)+'</div>'+
            '<div style="font-size:11px;color:var(--text3)">'+_ctFreqLabel(ct.freq)+' · '+fmt(ct.amount)+'/visit</div>'+
          '</div>'+
          _ctStatusBadge(ct)+
        '</div>'+
        '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:10px">'+
          '<div style="background:var(--bg);border-radius:6px;padding:7px;text-align:center">'+
            '<div style="font-size:9px;color:var(--text3);font-weight:700;text-transform:uppercase;margin-bottom:2px">Next</div>'+
            '<div style="font-size:12px;font-weight:800;color:'+(ct.nextDate&&ct.nextDate<tk?'#A32D2D':'var(--blue)')+'">'+
              (ct.nextDate?new Date(ct.nextDate+'T12:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}):'—')+
            '</div>'+
          '</div>'+
          '<div style="background:var(--bg);border-radius:6px;padding:7px;text-align:center">'+
            '<div style="font-size:9px;color:var(--text3);font-weight:700;text-transform:uppercase;margin-bottom:2px">Billed</div>'+
            '<div style="font-size:12px;font-weight:800">'+fmt(totalBilled)+'</div>'+
          '</div>'+
          '<div style="background:var(--bg);border-radius:6px;padding:7px;text-align:center">'+
            '<div style="font-size:9px;color:var(--text3);font-weight:700;text-transform:uppercase;margin-bottom:2px">Paid</div>'+
            '<div style="font-size:12px;font-weight:800;color:var(--green-mid)">'+fmt(totalPaid)+'</div>'+
          '</div>'+
        '</div>'+
        (ct.notes?'<div style="font-size:11px;color:var(--text3);margin-bottom:8px;line-height:1.4">'+escHtml(ct.notes)+'</div>':'')+
        '<div style="display:flex;gap:6px;flex-wrap:wrap">'+
          '<button onclick="logContractVisit('+ct.id+')" style="padding:7px 12px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">✓ Log visit</button>'+
          (unpaidIdx>=0?'<button onclick="markCtInvoicePaid('+ct.id+','+unpaidIdx+')" style="padding:7px 12px;border-radius:var(--r);border:none;background:var(--green-mid);color:#fff;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">💰 Mark paid</button>':'')+
          '<button onclick="editContractModal('+ct.id+')" style="padding:7px 12px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg);font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;color:var(--text)">Edit</button>'+
        '</div>'+
      '</div>';
  });
  el.innerHTML=html;
}

function renderContractsDash(){
  const el=document.getElementById('dash-contracts');if(!el)return;
  const tk=todayKey();
  const cutoff=new Date();cutoff.setDate(cutoff.getDate()+14);
  const cutoffStr=cutoff.toISOString().slice(0,10);
  const due=contracts.filter(c=>c.active&&c.nextDate&&c.nextDate<=cutoffStr);
  if(!due.length){el.style.display='none';el.innerHTML='';return;}
  el.style.display='';
  el.innerHTML=
    '<div style="background:linear-gradient(135deg,var(--blue-lt),rgba(45,93,168,.06));border:1px solid rgba(45,93,168,.3);border-radius:var(--r);padding:12px 14px;margin-bottom:10px">'+
      '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--blue-dk);margin-bottom:8px">🔄 Maintenance Due</div>'+
      due.map(ct=>{
        const cl=getClientById(ct.clientId);
        const daysUntil=Math.ceil((new Date(ct.nextDate+'T12:00')-new Date())/86400000);
        const isOv=ct.nextDate<tk;
        // Tapping a due item opens the actual maintenance contract (its terms +
        // log-visit/edit actions) directly, not the client record's contracts tab —
        // the card is contract-specific, so the click is too.
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid rgba(45,93,168,.1);cursor:pointer" '+
          'onclick="editContractModal&&editContractModal('+ct.id+')">'+
          '<div style="min-width:0;flex:1">'+
            '<div style="font-size:13px;font-weight:700;color:var(--text)">'+(cl?escHtml(cl.name):'Client')+'</div>'+
            '<div style="font-size:11px;color:var(--text3)">'+escHtml(ct.title)+'</div>'+
          '</div>'+
          '<div style="text-align:right;flex-shrink:0;margin-left:10px">'+
            '<div style="font-size:12px;font-weight:800;color:'+(isOv?'#A32D2D':'var(--amber)')+'">'+(isOv?'Overdue':daysUntil+'d')+'</div>'+
            '<div style="font-size:10px;color:var(--text3)">'+fmt(ct.amount)+'</div>'+
          '</div>'+
        '</div>';
      }).join('')+
    '</div>';
}
