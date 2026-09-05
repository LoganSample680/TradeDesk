// ── Timesheet: review, submit, send (owner 2026-09-05) ───────────────────────
//
// "Send this week" on the week chart used to share a text and lock nothing.
// Contractors call this a timesheet, and a timesheet is SUBMITTED: the worker
// checks each day, taps Submit and send, and from that moment the week is
// final. The text that goes out is the same message as before plus two lines,
// who submitted it and when, and a link. The link opens timesheet.html: the
// same bars and the same day rail, read only, with Approve and Reject for
// whoever runs the crew, whether or not they have the app or a login.
//
// The rules, in the owner's words and ours:
//   One button. "Submit and send." Every text that goes out is a submitted,
//     stamped timesheet. There is no send-without-submitting.
//   A question blocks submit. A day with a hole nobody answered, or a held
//     visit, is flagged in the review and the button waits until it is
//     answered. A locked week never carries an unknown.
//   Locked means locked from the MACHINE. Submitted days refuse every rebuild
//     and phone swap (geo_replace_day revision 7). If the person finds a
//     mistake they edit the day and submit again: a new version at the same
//     link, marked corrected. No manager reopen.
//   Reject is soft grey, Approve is the one dark button, and a rejection
//     comes back here: on the Needs-an-answer card and as one notification.
//
// The review sheet is the app's own centred prompt (.zmodal-overlay/.zmodal,
// CLAUDE.md 7.3), the text is _tlWeekShareText (one builder, js/timelog.js),
// the send is pwaShare. Nothing here writes a row directly: timesheet_submit
// is the one writer, and it is what makes the week locked.
const _TS_SELECT='week_start,status,version,token,submitted_at,approved_at,approved_name,rejected_at,reject_note';
let _tsByWeek={};        // week key -> the td_timesheets row for me
let _tsFor=null;         // the uid the cache belongs to
let _tsLoading=null;     // the in-flight load, so two renders share one

function _tsUid(){return (typeof _supaUser!=='undefined'&&_supaUser&&_supaUser.id)||null;}
function _tsContractor(){
  return (typeof _contractorUserId!=='undefined'&&_contractorUserId)||_tsUid();
}
// Whose timesheet: the full name the rows already carry, never a first name
// alone, because the boss may run more than one Jack.
function _tsMyName(){
  try{const{loggedByName}=_tlLoggedByInfo();const n=String(loggedByName||'').trim();if(n&&!/^(owner|crew)$/i.test(n)&&!/\(/.test(n))return n;}catch(_e){}
  try{const n=(typeof getOwnerName==='function')?String(getOwnerName()||'').trim():'';if(n&&!n.includes('@'))return n;}catch(_e){}
  return 'Crew';
}
function _tsLink(token){
  return String(location.origin||'')+'/timesheet.html?t='+encodeURIComponent(String(token||''));
}
function _tsWhen(iso){
  const d=new Date(iso||Date.now());
  if(!isFinite(d))return '';
  return d.toLocaleDateString('en-US',{month:'short',day:'numeric'})+', '+
    d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
}
// "Aug 23 to 29", plain words, the way the text reads.
function _tsRange(wk){
  try{return String(_tlWeekLabel(wk)).replace(/^Week of /,'').replace(/\s*[–-]\s*/,' to ');}catch(_e){return String(wk||'');}
}

// The week's rows, from the same cache the bars were drawn from, so what is
// submitted is what is on screen. Me scope only: _tlWeekBarsHtml never draws
// the button inside a crew member's week.
function _tsWeekRows(wk){
  return (typeof _tlLastRows!=='undefined'&&Array.isArray(_tlLastRows)?_tlLastRows:[])
    .filter(r=>r&&_tlWeekKey(r.date)===wk);
}
// What stops a submit: a hole nobody answered, or a visit the day could not
// vouch for. One entry per day, in calendar order.
function _tsBlockers(rows){
  const days={};
  (rows||[]).forEach(r=>{
    if(!r||!r.date)return;
    if(r.source==='unaccounted'||String(r.rawSource||'')==='client-held')days[r.date]=true;
  });
  return Object.keys(days).sort();
}
function _tsDayName(d){
  try{const x=new Date(String(d)+'T12:00:00');if(isFinite(x))return x.toLocaleDateString('en-US',{weekday:'long'});}catch(_e){}
  return String(d||'');
}

// ── The status of every week of mine, from the table ───────────────────────
function _tsLoad(force){
  const uid=_tsUid();
  if(!uid||typeof _supa==='undefined'||!_supa||typeof _supa.from!=='function')return Promise.resolve(_tsByWeek);
  if(_tsFor===uid&&!force&&!_tsLoading&&Object.keys(_tsByWeek).length)return Promise.resolve(_tsByWeek);
  if(_tsLoading)return _tsLoading;
  _tsLoading=(async()=>{
    try{
      const{data,error}=await _supa.from('td_timesheets').select(_TS_SELECT).eq('employee_user_id',uid);
      if(!error&&Array.isArray(data)){
        const map={};
        data.forEach(r=>{if(r&&r.week_start)map[String(r.week_start).slice(0,10)]=r;});
        _tsByWeek=map;_tsFor=uid;
      }
    }catch(_e){}
    _tsLoading=null;
    return _tsByWeek;
  })();
  return _tsLoading;
}
function _tsStatus(wk){return (_tsFor===_tsUid()&&_tsByWeek[wk])||null;}

// The button ON the week chart. Nothing submitted: Send this week. Submitted or
// approved: the stamp, still a button, because tapping it is how you submit
// again after fixing a day. Rejected: the note and a way back in.
function _tsWeekButtonHtml(wk){
  const key=escHtml(String(wk||''));
  const t=_tsStatus(wk);
  if(!t){
    // First paint before the table answered: ask once, repaint when it does.
    if(_tsUid()&&_tsFor!==_tsUid()&&!_tsLoading){
      _tsLoad().then(()=>{try{if(document.getElementById('pg-timelog')?.classList.contains('active')&&typeof renderTimeLog==='function')renderTimeLog({cached:true});}catch(_e){}});
    }
    return '<button type="button" class="tl-wbar-share" onclick="_tlShareWeekAt(\''+key+'\')">'+
      (typeof svgIcon==='function'?svgIcon('⬆',{size:12}):'')+' Send this week</button>';
  }
  const st=String(t.status||'');
  if(st==='approved'){
    return '<button type="button" class="tl-wbar-share tl-wbar-stamp ok" onclick="_tlShareWeekAt(\''+key+'\')">'+
      (typeof svgIcon==='function'?svgIcon('✓',{size:12}):'')+' Approved'+(t.approved_name?' by '+escHtml(String(t.approved_name)):'')+
      (t.approved_at?' '+escHtml(_tsWhen(t.approved_at)):'')+'</button>';
  }
  if(st==='rejected'){
    return '<button type="button" class="tl-wbar-share tl-wbar-stamp back" onclick="_tlShareWeekAt(\''+key+'\')">'+
      (typeof svgIcon==='function'?svgIcon('↩',{size:12}):'')+' Sent back'+(t.reject_note?': '+escHtml(String(t.reject_note).slice(0,60)):'')+' · Fix and resubmit</button>';
  }
  return '<button type="button" class="tl-wbar-share tl-wbar-stamp ok" onclick="_tlShareWeekAt(\''+key+'\')">'+
    (typeof svgIcon==='function'?svgIcon('🔒',{size:12}):'')+' Submitted '+escHtml(_tsWhen(t.submitted_at))+
    (Number(t.version)>1?' · corrected':'')+'</button>';
}

// ── The review sheet ─────────────────────────────────────────────────────────
function _tsReviewClose(){const o=document.getElementById('ts-review');if(o)o.remove();}
function _tsReviewOpen(wk){
  const rows=_tsWeekRows(wk);
  if(!rows.length){typeof showToast==='function'&&showToast('No hours logged that week yet','📋');return false;}
  _tsReviewClose();
  const fm=typeof _fmtMin==='function'?_fmtMin:(m=>m+'m');
  const days=(typeof _tlWeekDayDates==='function')?_tlWeekDayDates(wk):[];
  const blockers=_tsBlockers(rows);
  const t=_tsStatus(wk);
  const again=!!(t&&(t.status==='submitted'||t.status==='approved'));
  const dayRows=days.map(d=>{
    const dr=rows.filter(r=>r.date===d);
    const min=_tlPaidMin(dr);
    const blocked=blockers.indexOf(d)>=0;
    if(!min&&!blocked)return '';
    return '<button type="button" class="ts-day'+(blocked?' blocked':'')+'" onclick="_tsReviewDay(\''+escHtml(d)+'\')">'+
      '<span class="ts-day-l">'+escHtml(_tlDayFullLabel(d))+(blocked?'<span class="ts-day-flag">Needs an answer</span>':'')+'</span>'+
      '<span class="ts-day-h">'+escHtml(fm(min)||'0m')+'</span><span class="ts-day-chev">›</span></button>';
  }).join('');
  const e=_tlBucketFold(rows);
  const split=_TL_BUCKETS.filter(b=>(e[b.k]||0)>0).map(b=>b.label+' '+fm(e[b.k])).join(' · ');
  const why=blockers.length?('Answer '+(blockers.length===1?_tsDayName(blockers[0]):blockers.map(_tsDayName).join(' and '))+' to submit'):'';
  const note=(t&&t.status==='rejected'&&t.reject_note)?'<div class="ts-note">Sent back: '+escHtml(String(t.reject_note))+'</div>':'';
  const overlay=document.createElement('div');
  overlay.className='zmodal-overlay';overlay.id='ts-review';
  overlay.innerHTML=
    '<div class="zmodal ts-sheet">'+
      '<div class="ts-eyebrow">Timesheet</div>'+
      '<div class="zmodal-title" style="margin-bottom:4px">'+escHtml(_tsRange(wk))+'</div>'+
      '<div class="ts-sub">Check each day, then submit. Submitted hours are locked. Fix a day later and submit it again.</div>'+
      note+
      '<div class="ts-days">'+dayRows+'</div>'+
      '<div class="ts-total"><span>Total</span><b>'+escHtml(fm(e.min)||'0m')+'</b></div>'+
      (split?'<div class="ts-split">'+escHtml(split)+'</div>':'')+
      '<div class="ts-btns">'+
        '<button type="button" id="ts-submit" class="btn btn-p"'+(blockers.length?' disabled aria-disabled="true"':'')+
          ' onclick="_tsSubmit(\''+escHtml(String(wk))+'\')">'+(typeof svgIcon==='function'?svgIcon('🔒',{size:14}):'')+
          (again?' Submit again and send':' Submit and send')+'</button>'+
        (why?'<div class="ts-why">'+escHtml(why)+'</div>':'')+
        '<button type="button" class="btn ts-cancel" onclick="_tsReviewClose()">Cancel</button>'+
      '</div>'+
    '</div>';
  overlay.addEventListener('click',ev=>{if(ev.target===overlay)_tsReviewClose();});
  document.body.appendChild(overlay);
  return true;
}
// A day in the review is a door: it closes the sheet and opens that day's
// rail, where the fix is made. Send again from the chart when it is right.
function _tsReviewDay(d){
  _tsReviewClose();
  try{if(typeof _tlDrillTo==='function'&&_tlWeekKey(d))_tlDrillTo('day',d);}catch(_e){}
}

// ── Submit and send ──────────────────────────────────────────────────────────
async function _tsSubmit(wk){
  const rows=_tsWeekRows(wk);
  if(!rows.length){typeof showToast==='function'&&showToast('No hours logged that week yet','📋');return false;}
  if(_tsBlockers(rows).length){typeof showToast==='function'&&showToast('Answer the open questions first','❓');return false;}
  if(typeof _supa==='undefined'||!_supa||typeof _supa.rpc!=='function'||!_tsUid()){
    typeof showToast==='function'&&showToast('Sign in to submit a timesheet');return false;
  }
  const btn=document.getElementById('ts-submit');
  if(btn){btn.disabled=true;}
  const name=_tsMyName();
  let data=null;
  try{
    const res=await _supa.rpc('timesheet_submit',{
      p_contractor:_tsContractor(),p_week_start:wk,p_total_min:Math.round(_tlPaidMin(rows)),
      p_business_name:(typeof S!=='undefined'&&S&&S.bname)||'',p_person_name:name,
      p_biz_tz:(typeof _geoBizTz==='function')?_geoBizTz():'America/Chicago'});
    if(res&&res.error)throw res.error;
    data=res&&res.data;
    if(!data||!data.token)throw new Error('no token');
  }catch(e){
    if(btn)btn.disabled=false;
    const held=/held visits/.test(String((e&&e.message)||''));
    typeof showToast==='function'&&showToast(held?'Answer the held visits first':'Could not submit, try again');
    return false;
  }
  const row=Object.assign({},_tsByWeek[wk]||{},{week_start:wk,status:'submitted',version:data.version||1,token:data.token,
    submitted_at:data.submitted_at||new Date().toISOString(),approved_at:null,approved_name:null,rejected_at:null,reject_note:null});
  _tsByWeek[wk]=row;_tsFor=_tsUid();
  _tsReviewClose();
  // The text: the same message as always, then the stamp and the link.
  const text=_tlWeekShareText(rows,wk)+'\n\n'+
    (Number(row.version)>1?'Corrected timesheet. ':'')+
    'Submitted by '+name+', '+_tsWhen(row.submitted_at)+'\n'+_tsLink(row.token);
  try{if(typeof pwaShare==='function')await pwaShare({title:'Timesheet',text});}catch(_e){}
  try{if(typeof renderTimeLog==='function'&&document.getElementById('pg-timelog')?.classList.contains('active'))renderTimeLog({cached:true});}catch(_e){}
  return text;
}

// ── A rejection comes back here ───────────────────────────────────────────────
// The boss tapped Reject on the link and wrote one line. It lands in the
// Needs-an-answer card (the third section of #dash-hold) and buzzes once.
const _TS_SEEN_KEY='zp3_ts_seen';
function _tsSeen(){try{const o=JSON.parse(localStorage.getItem(_TS_SEEN_KEY)||'{}');return (o&&typeof o==='object')?o:{};}catch(_e){return {};}}
function _tsRejected(){
  if(_tsFor!==_tsUid())return [];
  return Object.keys(_tsByWeek).filter(wk=>_tsByWeek[wk]&&_tsByWeek[wk].status==='rejected').sort().map(wk=>_tsByWeek[wk]);
}
function _paintDashTsHold(el,list){
  if(!el)return;
  const rows=(Array.isArray(list)?list:[]).filter(r=>r&&r.week_start);
  if(!rows.length){el.style.display='none';el.innerHTML='';el.dataset.n='0';if(typeof _dashHoldSync==='function')_dashHoldSync();return;}
  el.style.display='block';el.dataset.n=String(rows.length);
  el.innerHTML=
    '<div class="td-hold-sec">'+
      '<div class="td-hold-sec-t">'+(typeof svgIcon==='function'?svgIcon('↩',{size:13}):'')+'<span>Timesheet sent back</span></div>'+
      '<div class="td-hold-sec-s">Fix the day, then submit it again from the week chart.</div>'+
    '</div>'+
    rows.map(r=>{
      const wk=String(r.week_start).slice(0,10);
      return '<div class="td-supply-visit td-hold-visit">'+
        '<div style="font-size:13px;font-weight:800;color:var(--text)">'+escHtml(_tsRange(wk))+'</div>'+
        (r.reject_note?'<div style="font-size:12px;color:var(--text2);margin-top:2px">“'+escHtml(String(r.reject_note))+'”</div>':'')+
        '<div style="display:flex;gap:8px;margin-top:8px">'+
          '<button onclick="_tsGoFix(\''+escHtml(wk)+'\')" class="btn btn-sm btn-p" style="flex:1">Fix and resubmit</button>'+
        '</div>'+
      '</div>';
    }).join('');
  if(typeof _dashHoldSync==='function')_dashHoldSync();
}
function _renderDashTsHold(){
  const el=document.getElementById('dash-ts-hold');
  if(!el)return;
  if(!_tsUid()){_paintDashTsHold(el,[]);return;}
  _paintDashTsHold(el,_tsRejected());
  _tsLoad().then(()=>{
    const list=_tsRejected();
    _paintDashTsHold(el,list);
    // One buzz per rejection, the moment the app learns of it.
    try{
      const seen=_tsSeen();let changed=false;
      list.forEach(r=>{
        const k=String(r.week_start).slice(0,10)+'|'+String(r.rejected_at||'');
        if(seen[k])return;seen[k]=1;changed=true;
        if(typeof _notifySchedule==='function')_notifySchedule('ts:back:'+String(r.week_start).slice(0,10),
          'Timesheet sent back',_tsRange(String(r.week_start).slice(0,10))+(r.reject_note?': '+String(r.reject_note):'')+'. Tap to fix it.',0);
      });
      if(changed)localStorage.setItem(_TS_SEEN_KEY,JSON.stringify(seen));
    }catch(_e){}
  });
}
function _tsGoFix(wk){
  try{if(typeof goPg==='function')goPg('pg-timelog');}catch(_e){}
  try{if(typeof _tlDrillTo==='function')setTimeout(()=>_tlDrillTo('week',wk),60);}catch(_e){}
}
