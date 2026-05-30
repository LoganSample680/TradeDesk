// ── Contractor Legal Compliance — State-by-State ──────────────────────────
// Both cancellation rights and mechanic's lien rights in one place.
// Neither belongs in tax.js — they serve contractor legal compliance, not tax.

// ── Home Solicitation Cancellation Rights ─────────────────────────────────
// All 50 states mirror FTC Cooling-Off Rule (16 CFR Part 429): 3 business days
// at the buyer's home, $25+. Business days exclude Sundays + federal holidays.
const STATE_CANCEL={
  AL:{days:3,statute:'Ala. Code §5-19-14'},
  AK:{days:3,statute:'AS §45.63.010'},
  AZ:{days:3,statute:'A.R.S. §44-5002'},
  AR:{days:3,statute:'A.C.A. §4-89-103'},
  CA:{days:3,statute:'Civ. Code §1689.5'},
  CO:{days:3,statute:'C.R.S. §6-1-702'},
  CT:{days:3,statute:'C.G.S. §42-134a'},
  DE:{days:3,statute:'6 Del. C. §4402'},
  FL:{days:3,statute:'Fla. Stat. §501.021'},
  GA:{days:3,statute:'O.C.G.A. §10-1-6'},
  HI:{days:3,statute:'HRS §481C-2'},
  ID:{days:3,statute:'Idaho Code §48-902'},
  IL:{days:3,statute:'815 ILCS 730/1'},
  IN:{days:3,statute:'Ind. Code §24-5-10-6'},
  IA:{days:3,statute:'Iowa Code §555A.2'},
  KS:{days:3,statute:'K.S.A. §50-640'},
  KY:{days:3,statute:'KRS §367.430'},
  LA:{days:3,statute:'La. R.S. §9:3538'},
  ME:{days:3,statute:'9-A M.R.S.A. §3-502'},
  MD:{days:3,statute:'Md. Code §14-302'},
  MA:{days:3,statute:'G.L. c. 93 §48'},
  MI:{days:3,statute:'MCL §445.111'},
  MN:{days:3,statute:'Minn. Stat. §325G.06'},
  MS:{days:3,statute:'Miss. Code §75-66-5'},
  MO:{days:3,statute:'Mo. Rev. Stat. §407.705'},
  MT:{days:3,statute:'MCA §30-14-502'},
  NE:{days:3,statute:'Neb. Rev. Stat. §69-1602'},
  NV:{days:3,statute:'NRS §598.2825'},
  NH:{days:3,statute:'RSA §361-B:2'},
  NJ:{days:3,statute:'N.J.S.A. §17:16C-68'},
  NM:{days:3,statute:'NMSA §57-12A-3'},
  NY:{days:3,statute:'Pers. Prop. Law §425'},
  NC:{days:3,statute:'N.C.G.S. §25A-39'},
  ND:{days:3,statute:'N.D.C.C. §51-18-02'},
  OH:{days:3,statute:'O.R.C. §1345.23'},
  OK:{days:3,statute:'14A O.S. §5-104'},
  OR:{days:3,statute:'ORS §83.820'},
  PA:{days:3,statute:'73 P.S. §201-7'},
  RI:{days:3,statute:'R.I.G.L. §6-28-2'},
  SC:{days:3,statute:'S.C. Code §37-2-502'},
  SD:{days:3,statute:'SDCL §37-24-28'},
  TN:{days:3,statute:'Tenn. Code §47-18-703'},
  TX:{days:3,statute:'Tex. Bus. & Com. Code §601.002'},
  UT:{days:3,statute:'Utah Code §70C-4-102'},
  VT:{days:3,statute:'9 V.S.A. §2454'},
  VA:{days:3,statute:'Va. Code §59.1-214'},
  WA:{days:3,statute:'RCW §63.14.102'},
  WV:{days:3,statute:'W.Va. Code §46A-2-501'},
  WI:{days:3,statute:'Wis. Stat. §423.203'},
  WY:{days:3,statute:'Wyo. Stat. §40-12-201'},
};

// ── State Names (self-contained — legal.js loads on sign.html where tax.js is absent) ──────
const STATE_NAMES={
  AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',
  CO:'Colorado',CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',
  HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',
  KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',
  MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',
  MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',
  NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',
  OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',
  SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',
  VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',
};

// ── Mechanic's Lien Rights ─────────────────────────────────────────────────
// Contractor's right to lien property for unpaid amounts. All 50 states.
const STATE_LIEN={
  AL:{statute:'Ala. Code §35-11-210 et seq.'},
  AK:{statute:'AS §34.35.050 et seq.'},
  AZ:{statute:'A.R.S. §33-981 et seq.'},
  AR:{statute:'A.C.A. §18-44-101 et seq.'},
  CA:{statute:'Civ. Code §8000 et seq.'},
  CO:{statute:'C.R.S. §38-22-101 et seq.'},
  CT:{statute:'C.G.S. §49-33 et seq.'},
  DE:{statute:'25 Del. C. §2701 et seq.'},
  FL:{statute:'Fla. Stat. §713.001 et seq.'},
  GA:{statute:'O.C.G.A. §44-14-360 et seq.'},
  HI:{statute:'HRS §507-41 et seq.'},
  ID:{statute:'Idaho Code §45-501 et seq.'},
  IL:{statute:'770 ILCS 60/0.01 et seq.'},
  IN:{statute:'Ind. Code §32-28-3-1 et seq.'},
  IA:{statute:'Iowa Code §572.1 et seq.'},
  KS:{statute:'K.S.A. §60-1101 et seq.'},
  KY:{statute:'KRS §376.010 et seq.'},
  LA:{statute:'La. R.S. §9:4801 et seq.'},
  ME:{statute:'10 M.R.S.A. §3251 et seq.'},
  MD:{statute:'Md. Code, Real Prop. §9-101 et seq.'},
  MA:{statute:'G.L. c. 254 §1 et seq.'},
  MI:{statute:'MCL §570.1101 et seq.'},
  MN:{statute:'Minn. Stat. §514.01 et seq.'},
  MS:{statute:'Miss. Code §85-7-131 et seq.'},
  MO:{statute:'Mo. Rev. Stat. §429.010 et seq.'},
  MT:{statute:'MCA §71-3-521 et seq.'},
  NE:{statute:'Neb. Rev. Stat. §52-101 et seq.'},
  NV:{statute:'NRS §108.221 et seq.'},
  NH:{statute:'RSA §447:2 et seq.'},
  NJ:{statute:'N.J.S.A. §2A:44-64 et seq.'},
  NM:{statute:'NMSA §48-2-1 et seq.'},
  NY:{statute:'Lien Law §3 et seq.'},
  NC:{statute:'N.C.G.S. §44A-7 et seq.'},
  ND:{statute:'N.D.C.C. §35-27-01 et seq.'},
  OH:{statute:'O.R.C. §1311.01 et seq.'},
  OK:{statute:'42 O.S. §141 et seq.'},
  OR:{statute:'ORS §87.001 et seq.'},
  PA:{statute:'49 P.S. §1101 et seq.'},
  RI:{statute:'R.I.G.L. §34-28-1 et seq.'},
  SC:{statute:'S.C. Code §29-5-10 et seq.'},
  SD:{statute:'SDCL §44-9-1 et seq.'},
  TN:{statute:'Tenn. Code §66-11-101 et seq.'},
  TX:{statute:'Tex. Prop. Code §53.001 et seq.'},
  UT:{statute:'Utah Code §38-1a-101 et seq.'},
  VT:{statute:'9 V.S.A. §1921 et seq.'},
  VA:{statute:'Va. Code §43-1 et seq.'},
  WA:{statute:'RCW §60.04.011 et seq.'},
  WV:{statute:'W.Va. Code §38-2-1 et seq.'},
  WI:{statute:'Wis. Stat. §779.01 et seq.'},
  WY:{statute:'Wyo. Stat. §29-2-101 et seq.'},
};

// Returns the lien notice sentence for a given state abbreviation.
function _lienNotice(state){
  const st=state||'KS';
  const lien=STATE_LIEN[st];
  const stateName=STATE_NAMES[st]||(typeof STATE_TAX!=='undefined'&&STATE_TAX[st]?STATE_TAX[st].name:st);
  const statute=lien?lien.statute:'applicable mechanic\'s lien statutes';
  return 'Under '+stateName+' law ('+statute+'), contractor has the right to file a mechanic\'s lien against this property for any amounts unpaid under this agreement. Client is hereby notified of this right.';
}

// Returns the cancellation citation string. State law is the authority; federal is the floor.
function _cancelCitation(state){
  const st=state||'KS';
  const rule=STATE_CANCEL[st];
  // State statute is the binding cite. Federal (16 CFR Part 429) is the baseline only.
  return rule?rule.statute:'16 CFR Part 429 (federal)';
}

// ── Dev: Legal Compliance Inspector ──────────────────────────────────────────
// Shows the exact strings that will appear on proposals, sign page, and client hub
// for any state. Client-side only — no API calls.
function renderLegalInspector(){
  const el=document.getElementById('dev-legal-inspector');if(!el)return;
  const st=document.getElementById('dev-legal-state')?.value||S?.state||'KS';
  const cancel=STATE_CANCEL[st]||{days:3,statute:'16 CFR Part 429'};
  const lien=STATE_LIEN[st]||{statute:'applicable mechanic\'s lien statutes'};
  const stateName=STATE_NAMES[st]||(typeof STATE_TAX!=='undefined'&&STATE_TAX[st]?STATE_TAX[st].name:st);
  const lienTxt=_lienNotice(st);
  const cancelTxt=_cancelCitation(st);

  // Deadline preview
  const rawDate=document.getElementById('dev-legal-date')?.value;
  const sigDate=rawDate?new Date(rawDate+'T08:00:00'):new Date();
  let deadlineTxt='—';
  let holidaysHit=[];
  if(typeof _fedHolidays==='function'){
    const yr=sigDate.getFullYear();
    const holidays=[..._fedHolidays(yr),..._fedHolidays(yr+1)];
    const d=new Date(sigDate);d.setHours(0,0,0,0);
    let count=0;const steps=[];
    while(count<cancel.days){
      d.setDate(d.getDate()+1);
      const ymd=d.toISOString().slice(0,10);
      const isSun=d.getDay()===0;
      const isFed=holidays.includes(ymd);
      if(isSun)steps.push({date:ymd,skip:true,reason:'Sunday'});
      else if(isFed){steps.push({date:ymd,skip:true,reason:'Federal holiday'});holidaysHit.push(ymd);}
      else{count++;steps.push({date:ymd,skip:false,reason:'Business day '+count});}
    }
    d.setHours(23,59,59,999);
    deadlineTxt=d.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})+' at midnight';
    el.querySelector('#dev-legal-steps').innerHTML=steps.map(s=>'<div style="font-size:10px;padding:2px 0;color:'+(s.skip?'#94a3b8':'var(--text)')+'">'+s.date+' — '+(s.skip?'<em>skipped ('+s.reason+')</em>':s.reason)+'</div>').join('');
  }

  el.querySelector('#dev-legal-cancel-stat').textContent=cancelTxt;
  el.querySelector('#dev-legal-cancel-days').textContent=cancel.days+' business days';
  el.querySelector('#dev-legal-lien-stat').textContent=lien.statute;
  el.querySelector('#dev-legal-lien-txt').textContent=lienTxt;
  el.querySelector('#dev-legal-deadline').textContent=deadlineTxt;
}
