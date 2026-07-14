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

// ── Maximum Deposit / Down-Payment Caps (Home Improvement) ────────────────
// NOT LEGAL ADVICE — verify with a licensed attorney; deposit-cap statutes change.
// Several states cap the up-front deposit a home-improvement contractor may collect.
// Each entry: { pct: max % of contract (number) or null, flat: max $ flat cap or null,
//   rule: 'lesser'|'pct'|'flat'|'none', statute: '<cite>', note: '<plain English>' }.
// Only well-documented statutory caps are encoded. States with no clear statutory
// cap are rule:'none' (no cap) rather than a guessed number — do not invent caps.
const STATE_DEPOSIT_CAP={
  AL:{pct:null,flat:null,rule:'none',statute:'',note:'No statutory deposit cap.'},
  AK:{pct:null,flat:null,rule:'none',statute:'',note:'No statutory deposit cap.'},
  AZ:{pct:50,flat:null,rule:'pct',statute:'A.R.S. tit. 32 ch. 10 (ROC)',note:'Initial payment may not exceed 50% of the total contract price.'},
  AR:{pct:null,flat:null,rule:'none',statute:'',note:'No statutory deposit cap.'},
  CA:{pct:10,flat:1000,rule:'lesser',statute:'Cal. Bus. & Prof. Code §7159.5',note:'Down payment may not exceed the lesser of $1,000 or 10% of the contract price.'},
  CO:{pct:null,flat:null,rule:'none',statute:'',note:'No statutory deposit cap.'},
  CT:{pct:20,flat:null,rule:'pct',statute:'Conn. Gen. Stat. §20-429 (HIA)',note:'Down payment may not exceed 20% of the contract price.'},
  DC:{pct:null,flat:null,rule:'none',statute:'',note:'No statutory deposit cap.'},
  DE:{pct:null,flat:null,rule:'none',statute:'',note:'No statutory deposit cap.'},
  FL:{pct:null,flat:null,rule:'none',statute:'',note:'No statutory deposit cap.'},
  GA:{pct:null,flat:null,rule:'none',statute:'',note:'No statutory deposit cap.'},
  HI:{pct:null,flat:null,rule:'none',statute:'',note:'No statutory deposit cap.'},
  ID:{pct:null,flat:null,rule:'none',statute:'',note:'No statutory deposit cap.'},
  IL:{pct:null,flat:null,rule:'none',statute:'',note:'No statutory deposit cap.'},
  IN:{pct:null,flat:null,rule:'none',statute:'',note:'No statutory deposit cap.'},
  IA:{pct:null,flat:null,rule:'none',statute:'',note:'No statutory deposit cap.'},
  KS:{pct:null,flat:null,rule:'none',statute:'',note:'No statutory deposit cap.'},
  KY:{pct:null,flat:null,rule:'none',statute:'',note:'No statutory deposit cap.'},
  LA:{pct:null,flat:null,rule:'none',statute:'',note:'No statutory deposit cap.'},
  ME:{pct:33.33,flat:null,rule:'pct',statute:'10 M.R.S. §1487',note:'Deposit may not exceed one-third (33.33%); waivable by written agreement.'},
  MD:{pct:33.33,flat:null,rule:'pct',statute:'Md. Code, Bus. Reg. §8-501',note:'Deposit may not exceed one-third (33.33%) of the contract price.'},
  MA:{pct:33.33,flat:null,rule:'pct',statute:'Mass. Gen. Laws c.142A §2',note:'Advance deposit may not exceed one-third (33.33%) of the total contract price.'},
  MI:{pct:null,flat:null,rule:'none',statute:'',note:'No statutory deposit cap.'},
  MN:{pct:null,flat:null,rule:'none',statute:'',note:'No statutory deposit cap.'},
  MS:{pct:null,flat:null,rule:'none',statute:'',note:'No statutory deposit cap.'},
  MO:{pct:null,flat:null,rule:'none',statute:'',note:'No statutory deposit cap.'},
  MT:{pct:null,flat:null,rule:'none',statute:'',note:'No statutory deposit cap.'},
  NE:{pct:null,flat:null,rule:'none',statute:'',note:'No statutory deposit cap.'},
  NV:{pct:10,flat:1000,rule:'lesser',statute:'NRS §624.920',note:'Down payment may not exceed the lesser of $1,000 or 10% of the aggregate contract price.'},
  NH:{pct:null,flat:null,rule:'none',statute:'',note:'No statutory deposit cap.'},
  NJ:{pct:null,flat:null,rule:'none',statute:'',note:'No statutory deposit cap.'},
  NM:{pct:null,flat:null,rule:'none',statute:'',note:'No statutory deposit cap.'},
  NY:{pct:null,flat:null,rule:'none',statute:'',note:'No statutory deposit cap.'},
  NC:{pct:null,flat:null,rule:'none',statute:'',note:'No statutory deposit cap.'},
  ND:{pct:null,flat:null,rule:'none',statute:'',note:'No statutory deposit cap.'},
  OH:{pct:null,flat:null,rule:'none',statute:'',note:'No statutory deposit cap.'},
  OK:{pct:null,flat:null,rule:'none',statute:'',note:'No statutory deposit cap.'},
  OR:{pct:null,flat:null,rule:'none',statute:'',note:'No statutory deposit cap.'},
  PA:{pct:33.33,flat:null,rule:'pct',statute:'73 P.S. §517.7 (Home Improvement Consumer Protection Act)',note:'Deposit may not exceed one-third (33.33%) of the contract price for home improvement.'},
  RI:{pct:33.33,flat:null,rule:'pct',statute:'R.I. Gen. Laws §5-65',note:'Deposit may not exceed one-third (33.33%) of the contract price.'},
  SC:{pct:null,flat:null,rule:'none',statute:'',note:'No statutory deposit cap.'},
  SD:{pct:null,flat:null,rule:'none',statute:'',note:'No statutory deposit cap.'},
  TN:{pct:null,flat:null,rule:'none',statute:'',note:'No statutory deposit cap.'},
  TX:{pct:null,flat:null,rule:'none',statute:'',note:'No statutory deposit cap.'},
  UT:{pct:null,flat:null,rule:'none',statute:'',note:'No statutory deposit cap.'},
  VT:{pct:null,flat:null,rule:'none',statute:'',note:'No statutory deposit cap.'},
  VA:{pct:null,flat:null,rule:'none',statute:'',note:'No statutory deposit cap.'},
  WA:{pct:null,flat:null,rule:'none',statute:'',note:'No statutory deposit cap.'},
  WV:{pct:null,flat:null,rule:'none',statute:'',note:'No statutory deposit cap.'},
  WI:{pct:null,flat:null,rule:'none',statute:'',note:'No statutory deposit cap.'},
  WY:{pct:null,flat:null,rule:'none',statute:'',note:'No statutory deposit cap.'},
};

// Returns the maximum legal deposit dollar amount for a state + contract amount.
// 'lesser' → min(flat, pct%·amount); 'pct' → pct%·amount; 'flat' → flat;
// 'none'/unknown → the full contract amount (no statutory cap).
function _maxDeposit(state,contractAmount){
  const amt=Math.max(0,parseFloat(contractAmount)||0);
  const st=state?String(state).toUpperCase():'';
  const cap=STATE_DEPOSIT_CAP[st];
  if(!cap||cap.rule==='none')return amt;
  const byPct=(cap.pct!=null)?(amt*cap.pct/100):Infinity;
  const byFlat=(cap.flat!=null)?cap.flat:Infinity;
  let max;
  if(cap.rule==='lesser')max=Math.min(byPct,byFlat);
  else if(cap.rule==='pct')max=byPct;
  else if(cap.rule==='flat')max=byFlat;
  else max=amt;
  if(!isFinite(max))return amt;
  return Math.min(max,amt);
}

// ── Live deposit-cap lookup (DB-backed, code-free legal updates) ──────────────
// Mirrors lookupSalesTaxRate (sales-tax.js): query an anon-readable Supabase
// table (deposit_caps) so the legal cap can be corrected without a deploy, and
// fall back to the hardcoded STATE_DEPOSIT_CAP on any miss / error / missing
// table / no-Supabase. Results are cached per state so each state is queried at
// most once per session.
const _DEPOSIT_CAP_CACHE={};

// Returns a cap object in the SAME shape as STATE_DEPOSIT_CAP entries
// ({rule,pct,flat,statute,note}) for the given state. Live value when available,
// hardcoded fallback otherwise. Never throws.
async function lookupDepositCap(state){
  const st=state?String(state).toUpperCase():'';
  const fallback=STATE_DEPOSIT_CAP[st]||{pct:null,flat:null,rule:'none',statute:'',note:'No statutory deposit cap.'};
  if(!st)return fallback;
  if(_DEPOSIT_CAP_CACHE[st])return _DEPOSIT_CAP_CACHE[st];

  if(typeof _supa!=='undefined'&&_supa&&(typeof supaEnabled!=='function'||supaEnabled())){
    try{
      const{data}=await _supa.from('deposit_caps').select('*').eq('state',st).maybeSingle();
      if(data&&data.rule){
        const live={
          rule:data.rule,
          pct:(data.pct!=null)?parseFloat(data.pct):null,
          flat:(data.flat!=null)?parseFloat(data.flat):null,
          statute:data.statute||'',
          note:data.note||'',
        };
        _DEPOSIT_CAP_CACHE[st]=live;
        return live;
      }
    }catch(e){ /* network / missing-table / no-supa — fall through to hardcoded */ }
  }
  // Miss/error/no-supa: cache the hardcoded value so we don't re-query each call.
  _DEPOSIT_CAP_CACHE[st]=fallback;
  return fallback;
}

// Async counterpart to _maxDeposit: awaits the live cap then computes the maximum
// legal deposit the exact same way _maxDeposit does. Use this where an await is
// clean; otherwise the boot-time refresh keeps the sync _maxDeposit live.
async function _maxDepositLive(state,contractAmount){
  const amt=Math.max(0,parseFloat(contractAmount)||0);
  const cap=await lookupDepositCap(state);
  if(!cap||cap.rule==='none')return amt;
  const byPct=(cap.pct!=null)?(amt*cap.pct/100):Infinity;
  const byFlat=(cap.flat!=null)?cap.flat:Infinity;
  let max;
  if(cap.rule==='lesser')max=Math.min(byPct,byFlat);
  else if(cap.rule==='pct')max=byPct;
  else if(cap.rule==='flat')max=byFlat;
  else max=amt;
  if(!isFinite(max))return amt;
  return Math.min(max,amt);
}

// Boot-time refresh: pull the live cap for the contractor's state and patch the
// in-memory STATE_DEPOSIT_CAP entry so the existing SYNC _maxDeposit (the clamp
// in saveGenericEstimate) transparently uses the live value — no async needed at
// the point of use. Mirrors autoRefreshTaxBrackets/autoRefreshLienRules: wired
// into the boot timer in cloud.js. No-op offline / when nothing changed.
let _depositCapRefreshInProgress=false;
async function autoRefreshDepositCaps(){
  if(typeof _supa==='undefined'||!_supa)return;
  if(typeof _supaUser==='undefined'||!_supaUser)return;
  if(_depositCapRefreshInProgress)return;
  _depositCapRefreshInProgress=true;
  try{
    const st=((typeof S!=='undefined'&&S.state)?String(S.state):'KS').toUpperCase();
    if(!st)return;
    const live=await lookupDepositCap(st);
    if(live&&STATE_DEPOSIT_CAP[st]){
      STATE_DEPOSIT_CAP[st]={
        pct:live.pct,
        flat:live.flat,
        rule:live.rule,
        statute:live.statute||STATE_DEPOSIT_CAP[st].statute||'',
        note:live.note||STATE_DEPOSIT_CAP[st].note||'',
      };
    }
  }catch(e){ /* offline / missing table — hardcoded values remain in effect */ }
  finally{_depositCapRefreshInProgress=false;}
}

// Returns a short human-readable cap description + statute for display.
// Unknown / no-cap states return a plain "no statutory cap" string.
function _depositCapNote(state){
  const st=state?String(state).toUpperCase():'';
  const cap=STATE_DEPOSIT_CAP[st];
  const stateName=STATE_NAMES[st]||st||'this state';
  if(!cap||cap.rule==='none')return stateName+': no statutory deposit cap.';
  let limit;
  if(cap.rule==='lesser')limit='lesser of $'+cap.flat.toLocaleString('en-US')+' or '+cap.pct+'%';
  else if(cap.rule==='pct')limit=cap.pct+'% of the contract';
  else if(cap.rule==='flat')limit='$'+cap.flat.toLocaleString('en-US');
  else limit='the contract amount';
  return stateName+' caps deposits at '+limit+(cap.statute?' ('+cap.statute+')':'')+'.';
}

// Returns the lien notice sentence for a given state abbreviation.
// `party` is the business name shown in the notice; falls back to the generic
// "the contractor" when no business name is available.
function _lienNotice(state,party){
  const st=state||'KS';
  const lien=STATE_LIEN[st];
  const stateName=STATE_NAMES[st]||(typeof STATE_TAX!=='undefined'&&STATE_TAX[st]?STATE_TAX[st].name:st);
  const statute=lien?lien.statute:'applicable mechanic\'s lien statutes';
  // No party → keep the exact original wording ("contractor", no article) so the
  // full-sentence lien upgrade in sign.html still matches text baked into old proposals.
  const who=(party&&String(party).trim())?String(party).trim():'contractor';
  return 'Under '+stateName+' law ('+statute+'), '+who+' has the right to file a mechanic\'s lien against this property for any amounts unpaid under this agreement. Client is hereby notified of this right.';
}

// Returns the cancellation citation string. State law is the authority; federal is the floor.
function _cancelCitation(state){
  const st=state||'KS';
  const rule=STATE_CANCEL[st];
  // State statute is the binding cite. Federal (16 CFR Part 429) is the baseline only.
  return rule?rule.statute:'16 CFR Part 429 (federal)';
}

// The reduced set of protective clauses that apply to ANY signed document,
// not just a full estimate — lien rights, finance charges on late balances,
// and dispute resolution. Rolled into small documents (diagnostic charge /
// quick invoice) that skip the estimate-only clauses (deposit, cancellation,
// warranty, permits — none of which apply to a flat one-time fee for work
// already done). Owner directive 2026-07-13: "already handle that in terms
// and conditions" — same protection, no matter how small the document.
function _coreProtectionTermsHtml(state,party){
  const _fcPct=(typeof S!=='undefined'&&S&&S.financeChargePct!=null?parseFloat(S.financeChargePct):1.5);
  const _fcApr=Math.round(_fcPct*12*10)/10;
  const clauses=[
    ['Mechanic\'s Lien',_lienNotice(state,party)],
    ['Finance Charges','Unpaid balances remaining 30 days after this charge is billed are subject to a finance charge of '+_fcPct+'% per month ('+_fcApr+'% APR) on the outstanding balance, accruing monthly until paid in full.'],
    ['Dispute Resolution','In the event of a dispute, both parties agree to attempt good-faith negotiation before pursuing arbitration or litigation. The prevailing party in any legal proceeding to enforce this agreement shall be entitled to recover reasonable attorney\'s fees and costs, to the extent permitted by law.'],
  ];
  return '<div style="font-size:11px;color:var(--text3,#6b7280);line-height:1.8">'+clauses.map((c,i)=>'<div>'+(i+1)+'. <strong>'+c[0]+':</strong> '+c[1]+'</div>').join('')+'</div>';
}

// ── Terms & Conditions accordion ─────────────────────────────────────────────
// Every terms section ("Terms & Conditions" + legacy "Payment Terms" headers)
// merges under ONE "Terms & Conditions" toggle at the first section's position.
// Match by exact header text (whitelist) — layout labels never get toggles.
// The Required Notice (home solicitation law) and the Notice of Cancellation
// form each keep their own separate toggle.
// Shared between sign.html (the real client-facing signing page) and the
// contractor's "Preview" overlay (js/generic-estimate.js _showProposalPreviewOverlay)
// so the preview is a true match of what the client actually sees — one
// function, one behavior, can't silently drift between the two views again.
function _applyTermsAccordion(root){
  if(!root)return;
  function mkToggle(label,bodies){
    const btn=document.createElement('button');btn.dataset.termsToggle='1';
    btn.style.cssText='display:flex;align-items:center;width:100%;background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:8px;padding:10px 14px;margin:0 0 8px;font-family:inherit;cursor:pointer;transition:background .15s,border-color .15s';
    const lbl=document.createElement('span');
    lbl.style.cssText='flex:1;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#1a365d;text-align:left';
    lbl.textContent=label;
    const hint=document.createElement('span');
    hint.style.cssText='font-size:11px;font-weight:600;color:#94a3b8;white-space:nowrap;margin-left:8px';
    hint.textContent='Tap to view ›';
    btn.appendChild(lbl);btn.appendChild(hint);
    btn.onclick=function(){
      const open=bodies[0].style.display!=='none';
      bodies.forEach(function(b){b.style.display=open?'none':'';});
      hint.textContent=open?'Tap to view ›':'Collapse ‹';
      btn.style.background=open?'#f8fafc':'#eef2f7';
      btn.style.borderColor=open?'#e2e8f0':'#b6c8da';
    };
    return btn;
  }
  const termsHdrs=[],termsBodies=[];
  root.querySelectorAll('div').forEach(function(hdr){
    if(hdr.children.length)return;
    const lc=hdr.textContent.trim().toLowerCase();
    const isTerms=(lc==='payment terms'||lc==='terms & conditions'||lc==='terms and conditions');
    const isNotice=(lc.includes('required notice')||lc.includes('solicitation law'));
    if(!isTerms&&!isNotice)return;
    const body=hdr.nextElementSibling;if(!body||body.tagName==='BUTTON')return;
    hdr.style.display='none';hdr.dataset.termsHdr='1';
    body.style.display='none';body.dataset.termsBody='1';
    if(isNotice){hdr.after(mkToggle('Required Notice',[body]));return;}
    termsHdrs.push(hdr);termsBodies.push(body);
  });
  if(termsHdrs.length)termsHdrs[0].after(mkToggle('Terms & Conditions',termsBodies));
  // Collapse entire Notice of Cancellation form (dashed-border detach section)
  root.querySelectorAll('div').forEach(function(div){
    const fc=div.firstElementChild;if(!fc||!fc.textContent.includes('✂'))return;
    div.style.display='none';div.dataset.termsBody='1';
    const btn=document.createElement('button');btn.dataset.termsToggle='1';
    btn.textContent='View notice of cancellation ▾';
    btn.style.cssText='display:block;width:100%;background:none;border:none;color:var(--accent);font-size:11px;font-weight:700;cursor:pointer;padding:6px 24px 2px;font-family:inherit;text-align:left';
    btn.onclick=function(){const open=div.style.display!=='none';div.style.display=open?'none':'';btn.textContent=open?'View notice of cancellation ▾':'Hide cancellation notice ▴';};
    div.before(btn);
  });
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
