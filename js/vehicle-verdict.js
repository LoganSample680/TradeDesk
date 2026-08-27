// ── Year-end vehicle method verdict ──────────────────────────────────────────
// The one screen a contractor looks at before handing the year to their EA or
// CPA: for each vehicle, did the STANDARD MILEAGE RATE or ACTUAL EXPENSES
// produce the bigger legal deduction, and is switching to the winner even
// allowed for that vehicle (the flip trapdoors, _vehFlipGuard in js/fleet.js).
//
// Owner ask 2026-08-14: "a redesign when we export at the end of the year to
// do the calculations on if actual expenses is more or mileage, would like
// some great CSS animation there to make it look legit, then the report it
// generates still gives you all for the EA or CPA to review and file."
//
// The animation is not decoration. A number that COUNTS UP to its total and a
// bar that GROWS to its share are the difference between "the app printed a
// figure" and "the app worked this out in front of me", and this is the screen
// where a contractor decides whether to trust the math with their taxes. Every
// number on it is computed by _vehSchedC, the same engine that feeds Schedule
// C, so the screen can never disagree with the return.
//
// Motion obeys §8.4: cubic-bezier(.22,1,.36,1) entrances, nothing over 350ms
// except the deliberate count-up, and the whole thing is inert under
// prefers-reduced-motion (numbers land at their final value, bars at their
// final width, no movement at all).

function _vvStyles(){
  if(document.getElementById('_vv-style'))return;
  const s=document.createElement('style');
  s.id='_vv-style';
  s.textContent=
    '@keyframes vvIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}'+
    '@keyframes vvStamp{0%{opacity:0;transform:scale(1.5) rotate(-8deg)}60%{opacity:1;transform:scale(.94) rotate(1deg)}100%{opacity:1;transform:scale(1) rotate(0)}}'+
    '@keyframes vvSheen{from{background-position:180% 0}to{background-position:-80% 0}}'+
    '.vv-card{animation:vvIn .34s cubic-bezier(.22,1,.36,1) both}'+
    '.vv-bar{height:34px;border-radius:8px;position:relative;overflow:hidden;width:0;'+
      'transition:width .95s cubic-bezier(.22,1,.36,1)}'+
    '.vv-bar.win{background:linear-gradient(90deg,#1E7A46,#2FA463)}'+
    '.vv-bar.lose{background:linear-gradient(90deg,#93A3B8,#B4C0CE)}'+
    // A single sheen sweeping the winning bar once it has grown: the "this was
    // just calculated" beat, one pass, never a loop that draws the eye forever.
    '.vv-bar.win::after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,'+
      'transparent 30%,rgba(255,255,255,.42) 50%,transparent 70%);background-size:220% 100%;'+
      'animation:vvSheen 1.1s ease-out .55s 1 both}'+
    '.vv-stamp{animation:vvStamp .42s cubic-bezier(.22,1,.36,1) both}'+
    '@media (prefers-reduced-motion:reduce){'+
      '.vv-card,.vv-stamp{animation:none}'+
      '.vv-bar{transition:none}'+
      '.vv-bar.win::after{animation:none;opacity:0}'+
    '}';
  document.head.appendChild(s);
}

// Count a dollar figure up to its value. Short (620ms) and eased, so it reads
// as a tally finishing rather than a slot machine. Reduced-motion jumps.
function _vvCountUp(el,to,ms){
  if(!el)return;
  const reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion:reduce)').matches;
  if(reduce||!(to>0)){el.textContent=fmt(to);return;}
  const t0=performance.now(),dur=ms||620;
  const tick=(now)=>{
    const p=Math.min(1,(now-t0)/dur);
    const eased=1-Math.pow(1-p,3);
    el.textContent=fmt(to*eased);
    if(p<1)requestAnimationFrame(tick);
    else el.textContent=fmt(to);
  };
  requestAnimationFrame(tick);
}

// One vehicle's verdict block. Returns markup; the caller animates it after
// insertion (widths and count-ups need to start from a painted zero state).
function _vvVehicleHtml(p,i){
  const winMile=p.winner==='mileage';
  const g=(p.winner!==p.method&&typeof _vehFlipGuard==='function')
    ?_vehFlipGuard({deductionMethod:p.method,firstYearMethod:p.firstYearMethod,isLeased:p.isLeased},p.winner):null;
  const usingWinner=p.winner===p.method;
  // The action line is the whole point of the screen: what does the
  // contractor DO with this. Three states, and never a suggestion that the
  // IRS would not allow (the trapdoors close here too).
  let action,actionColor;
  if(usingWinner){action='Already filing the winning method.';actionColor='var(--green-mid)';}
  else if(g&&!g.ok){action='Cannot switch: '+g.short+'.';actionColor='var(--text3)';}
  else{action='Switching could save '+fmt(p.delta)+' this year'+(g&&g.short?' ('+g.short+')':'')+'.';actionColor='var(--amber)';}
  const bar=(label,amount,isWin,sub)=>
    '<div style="margin-bottom:10px">'+
      '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px">'+
        '<span style="font-size:12px;font-weight:700;color:'+(isWin?'var(--text)':'var(--text3)')+'">'+label+
          (isWin?' <span class="vv-stamp" style="display:inline-block;font-size:9px;font-weight:800;background:var(--green-mid);color:#fff;padding:2px 7px;border-radius:99px;margin-left:6px;letter-spacing:.04em">WINS</span>':'')+
        '</span>'+
        '<span class="vv-amt" data-to="'+amount+'" style="font-size:15px;font-weight:900;font-variant-numeric:tabular-nums;color:'+(isWin?'var(--green-mid)':'var(--text3)')+'">$0</span>'+
      '</div>'+
      '<div class="vv-bar '+(isWin?'win':'lose')+'" data-pct="'+Math.max(4,Math.round((amount/Math.max(1,Math.max(p.mileDed,p.actualCmp)))*100))+'"></div>'+
      '<div style="font-size:10px;color:var(--text3);margin-top:4px">'+sub+'</div>'+
    '</div>';
  return '<div class="vv-card" style="border:1px solid var(--border);border-radius:var(--rl);padding:16px;margin-bottom:12px;background:var(--bg2);animation-delay:'+(i*90)+'ms">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">'+
      '<div style="font-size:15px;font-weight:800">'+escHtml(p.label)+'</div>'+
      '<div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.05em">'+p.bizUse+'% business</div>'+
    '</div>'+
    bar('Standard mileage',p.mileDed,winMile,p.miles.toFixed(0)+' business miles at the IRS rate')+
    bar('Actual expenses',p.actualCmp,!winMile,fmt(p.costTotal)+' logged costs at '+p.bizUse+'% business use')+
    '<div style="font-size:12px;font-weight:700;color:'+actionColor+';margin-top:10px;line-height:1.45">'+escHtml(action)+'</div>'+
  '</div>';
}

// The screen. Opens over the export panel, computes from _vehSchedC, and hands
// off to the full CPA report.
function openVehicleVerdict(yr){
  yr=String(yr||(typeof getExportYear==='function'?getExportYear():'')||new Date().getFullYear());
  if(yr==='all')yr=String(new Date().getFullYear());
  _vvStyles();
  const vd=(typeof _vehSchedC==='function')?_vehSchedC(yr):null;
  const ov=document.createElement('div');
  ov.id='vv-panel';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9996;display:flex;align-items:center;justify-content:center;padding:16px;animation:fadein .15s';
  const rows=(vd&&vd.perVehicle||[]).filter(p=>p.miles>0||p.costTotal>0);
  // Honest emptiness: a verdict with only one side logged is not a verdict,
  // and saying so is worth more than a confident wrong number.
  const thin=rows.filter(p=>p.miles===0||p.costTotal===0);
  const totalWin=rows.reduce((s,p)=>s+Math.max(p.mileDed,p.actualCmp),0);
  ov.innerHTML=
    '<div style="background:var(--bg);border-radius:16px;width:100%;max-width:560px;padding:22px 20px 24px;max-height:92vh;overflow-y:auto">'+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px">'+
        '<div>'+
          '<div style="font-size:19px;font-weight:900;letter-spacing:-.3px">Vehicle deduction verdict</div>'+
          '<div style="font-size:12px;color:var(--text3);margin-top:2px">'+yr+' · which method wins, per truck</div>'+
        '</div>'+
        '<button onclick="document.getElementById(\'vv-panel\').remove()" style="border:none;background:none;font-size:26px;cursor:pointer;color:var(--text3);line-height:1">×</button>'+
      '</div>'+
      (rows.length
        ?'<div class="vv-card" style="margin:14px 0 16px;padding:14px 16px;border-radius:var(--rl);background:linear-gradient(135deg,#12233F,#1B3B6B);color:#fff">'+
            '<div style="font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;opacity:.62">Best legal vehicle deduction</div>'+
            '<div class="vv-amt" data-to="'+totalWin+'" style="font-size:32px;font-weight:900;font-variant-numeric:tabular-nums;letter-spacing:-1px;margin-top:2px">$0</div>'+
            '<div style="font-size:11px;opacity:.72;margin-top:2px">across '+rows.length+' vehicle'+(rows.length!==1?'s':'')+', each on its own winning method</div>'+
          '</div>'+
          rows.map((p,i)=>_vvVehicleHtml(p,i+1)).join('')+
          (thin.length?'<div style="font-size:11px;color:var(--amber);font-weight:700;margin-bottom:12px;line-height:1.5">'+
            thin.length+' vehicle'+(thin.length!==1?'s have':' has')+' only one side logged this year, so its verdict is not a real comparison. Log both drives and vehicle costs all year and this becomes decisive.</div>':'')
        :'<div style="padding:26px 4px;text-align:center;color:var(--text3);font-size:13px;line-height:1.6">No vehicle activity logged for '+yr+' yet.<br>Track drives and vehicle costs and this screen does the year-end math for you.</div>')+
      '<button class="btn btn-p" onclick="exportTaxPDF()" style="width:100%;padding:14px;font-size:15px;font-weight:800">Generate the full report for my CPA</button>'+
      '<div style="font-size:10px;color:var(--text3);margin-top:10px;line-height:1.5;text-align:center">'+
        'Every figure here comes from the same engine that fills your Schedule C, so the report and this screen can never disagree. '+
        'One method per vehicle (IRS). Not tax advice, verify with your tax professional before filing.</div>'+
    '</div>';
  document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  // Animate AFTER paint: bars start at width 0 in CSS and transition to their
  // share, numbers tally up. One frame of delay is what makes the transition
  // actually run instead of the browser collapsing it into the initial style.
  requestAnimationFrame(()=>{
    setTimeout(()=>{
      ov.querySelectorAll('.vv-bar').forEach(b=>{b.style.width=(b.dataset.pct||0)+'%';});
      ov.querySelectorAll('.vv-amt').forEach((el,i)=>{
        setTimeout(()=>_vvCountUp(el,parseFloat(el.dataset.to)||0),i===0?120:180+i*70);
      });
    },30);
  });
}
