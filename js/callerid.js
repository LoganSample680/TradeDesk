// ── Caller ID (owner 2026-08-11) ─────────────────────────────────────────────
// "Get caller ID to simply always return the business name we already save in
// the app based on the phone number that's entered."
//
// Every client we have a phone number for is published to iOS, so an incoming
// call from that number rings as their name instead of "Unknown". No lookup
// service, no subscription, no data leaves the phone: the list is written to a
// file only this app and its Call Directory extension can read.
//
// THE ONE THING THE OWNER MUST DO: iOS makes caller-ID extensions opt-in, so
// the toggle in Settings > Phone > Call Blocking & Identification has to be
// flipped once per device. _callerIdPrompt() walks them there in one tap.

function _callerIdPlugin(){
  try{
    const cap=window.Capacitor;
    if(!cap||typeof cap.isNativePlatform!=='function'||!cap.isNativePlatform())return null;
    if(typeof cap.registerPlugin==='function')return cap.registerPlugin('TdCallerId');
    return (cap.Plugins&&cap.Plugins.TdCallerId)||null;
  }catch(_e){return null;}
}

// Digits to the E.164 integer iOS matches on (country code, no plus).
// Returns null for anything that is not a dialable North American number:
// publishing junk would burn entries and could mislabel a real call.
function _callerIdE164(raw){
  let d=String(raw||'').replace(/\D/g,'');
  if(!d)return null;
  if(d.length===11&&d[0]==='1')d=d.slice(1);      // 1-316-555-0100
  if(d.length===10){
    // NANP rules: area code and exchange both start 2-9. This is what
    // separates a real number from an extension, a zip, or a typo.
    if(!/^[2-9]\d{2}[2-9]\d{6}$/.test(d))return null;
    return Number('1'+d);
  }
  // Already carries a country code we do not parse: pass it through if it is
  // a plausible length, so international clients still get named.
  if(d.length>=11&&d.length<=15)return Number(d);
  return null;
}

// The published table. Clients only: they are the records that carry a phone
// (the client form requires one), and they cover leads too, since a lead IS a
// client record until it wins. Newest record wins a shared number, which is
// what a landlord/manager pair or a re-entered client should do.
function _callerIdList(){
  const src=(typeof clients!=='undefined'&&Array.isArray(clients))?clients:[];
  const byNumber=new Map();
  src.forEach(c=>{
    if(!c)return;
    const n=_callerIdE164(c.phone);
    if(n==null)return;
    const label=String(c.name||'').trim();
    if(!label)return;                    // an unnamed record teaches nothing
    byNumber.set(n,label.slice(0,60));   // iOS truncates long labels anyway
  });
  // Ascending order is a HARD iOS requirement: an unsorted set is rejected
  // whole and silently, so every client would lose caller ID at once. Native
  // re-sorts as well; belt and braces on a failure mode with no error message.
  return [...byNumber.entries()]
    .sort((a,b)=>a[0]-b[0])
    .map(([number,label])=>({number,label}));
}

// Publishing is debounced: a client import or a cloud sync touches the array
// dozens of times in a second, and each publish asks iOS to reload an
// extension. One write after the dust settles.
let _callerIdTimer=null;
let _callerIdLastKey='';
function _callerIdSyncSoon(delay){
  const P=_callerIdPlugin();
  if(!P)return;                        // browser or PWA: nothing to publish to
  clearTimeout(_callerIdTimer);
  _callerIdTimer=setTimeout(()=>{_callerIdSync();},delay==null?2500:delay);
}
async function _callerIdSync(){
  const P=_callerIdPlugin();
  if(!P||typeof P.setContacts!=='function')return null;
  const contacts=_callerIdList();
  // Skip an identical republish: iOS reloading the extension is real work on
  // the phone, and most renders change nothing about phone numbers.
  const key=contacts.length+':'+(contacts[0]&&contacts[0].number||0)+':'+(contacts[contacts.length-1]&&contacts[contacts.length-1].number||0);
  if(key===_callerIdLastKey)return null;
  _callerIdLastKey=key;
  try{return await P.setContacts({contacts});}catch(_e){return null;}
}

async function _callerIdStatus(){
  const P=_callerIdPlugin();
  if(!P||typeof P.status!=='function')return {status:'unsupported',count:0};
  try{return await P.status();}catch(_e){return {status:'unknown',count:0};}
}

// The one-time enable walkthrough. Deliberately NOT shown on boot: an
// unexplained Settings trip on first launch is how a good feature gets
// dismissed forever. Settings surfaces it, and it can be called after the
// first sync when there is actually something to identify.
function _callerIdPrompt(){
  const P=_callerIdPlugin();
  if(!P){if(typeof showToast==='function')showToast('Caller ID needs the TradeDesk iPhone app','📱');return;}
  document.getElementById('_cid-ov')?.remove();
  const ov=document.createElement('div');ov.id='_cid-ov';ov.className='zmodal-overlay';
  const m=document.createElement('div');m.className='zmodal';
  m.innerHTML=
    '<div class="zmodal-title">Name every call</div>'+
    '<div style="font-size:13px;color:var(--text2);margin:6px 0 2px">When a client calls, their name shows instead of an unknown number. iPhone needs you to switch this on once:</div>'+
    '<div style="font-size:13px;color:var(--text2);margin:10px 0 2px">Settings <span style="color:var(--text3)">&rsaquo;</span> Phone <span style="color:var(--text3)">&rsaquo;</span> Call Blocking &amp; Identification <span style="color:var(--text3)">&rsaquo;</span> turn on <b>TradeDesk</b></div>'+
    '<button id="_cid-go" class="btn btn-p" style="width:100%;margin-top:14px;padding:13px;font-weight:800">Take me there</button>'+
    '<button id="_cid-later" class="btn" style="width:100%;margin-top:8px;padding:12px">Not now</button>';
  ov.appendChild(m);document.body.appendChild(ov);
  document.getElementById('_cid-go').onclick=async()=>{
    ov.remove();
    await _callerIdSync();                       // publish before they look
    try{if(typeof P.openSettings==='function')await P.openSettings();}catch(_e){}
  };
  document.getElementById('_cid-later').onclick=()=>ov.remove();
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
}
