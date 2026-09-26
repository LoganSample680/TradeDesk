// ── Tim ──────────────────────────────────────────────────────────────────────
//
// "Tim, show me my books for last year."
// "Tim, T and M for the Delaneys, about eight hours, water heater replacement."
//
// Owner direction 2026-09-17: Tim is an INTERFACE, not an intelligence. He does
// the typing and the walking, nothing else. Every sentence he understands
// resolves against something the app already holds: a screen in the table
// below, a year in the books, a customer in the customer list, a service in the
// price book. That is string matching, so he runs in a basement with no signal,
// costs nothing per command, and nothing said to him ever leaves the phone.
//
// HE KNOWS THE TRADE NOW (owner 2026-09-25, reversing 2026-09-17): "Tim
// should know trade knowledge." Not in this file: js/trade-knowledge.js holds
// it as data, what each job includes and what gets left off, and Tim, the
// spoken estimate and the estimate builder all read that one table. Prices
// are still the contractor's; the price book wins over the library's
// starting numbers. js/estimate-speak.js is still where a spoken estimate is
// parsed, and Tim is its front door, not a replacement for it (7.3).
//
// Everything below is pure except timRun and openTim, the two that touch the app.

// Where he can take you. `say` is every way a contractor actually asks for the
// screen, longest phrase winning, so "time log" cannot be eaten by "log".
const TIM_PLACES=[
  {pg:'pg-dash',        name:'Home',        say:['home','dashboard','home screen','the dash']},
  {pg:'pg-leads',       name:'Leads',       say:['leads','lead','my leads','new lead']},
  {pg:'pg-clients',     name:'Customers',   say:['clients','customers','customer list','client list']},
  {pg:'pg-jobs',        name:'Jobs',        say:['jobs','job list','my jobs','work orders']},
  {pg:'pg-schedule',    name:'Schedule',    say:['schedule','my schedule']},
  {pg:'pg-cal',         name:'Calendar',    say:['calendar','the week','weather']},
  {pg:'pg-proposals',   name:'Proposals',   say:['proposals','my proposals','bids','my bids','quotes','sent estimates']},
  {pg:'pg-money',       name:'Collect',     say:['collect','invoices','payments','get paid','whats owed','who owes me']},
  {pg:'pg-tracker',     name:'Books',       say:['books','bookkeeping','the numbers','profit','income','expenses','mileage','p and l','my money']},
  {pg:'pg-taxes',       name:'Taxes',       say:['taxes','tax','write offs','deductions','1099s']},
  {pg:'pg-team',        name:'Fleet & Team',say:['team','crew','my crew','fleet','trucks','vehicles','employees']},
  {pg:'pg-timelog',     name:'Timesheet',   say:['timesheet','time sheet','time log','timelog','hours','my hours','the clock']},
  {pg:'pg-dispatch',    name:'Dispatch',    say:['dispatch','the board','dispatch board']},
  {pg:'pg-licensing',   name:'Licensing',   say:['licensing','my license','licenses','permits']},
  {pg:'pg-contracts',   name:'Contracts',   say:['contracts','agreements']},
  {pg:'pg-client-hub',  name:'Client hub',  say:['client hub','the hub']},
  {pg:'pg-tracker',     name:'Books',       say:['receipts']},
  {pg:'pg-qr-leads',    name:'QR leads',    say:['qr','qr code','qr leads','my sign']},
  {pg:'pg-settings',    name:'Settings',    say:['settings','preferences','my account']},
];

function _timNorm(t){
  return ' '+String(t||'').toLowerCase()
    .replace(/&/g,' and ')
    .replace(/[^a-z0-9\s]/g,' ')
    .replace(/\s+/g,' ').trim()+' ';
}

// Which screen he means. Scored on how much of the phrase he actually said, so
// a two-word name beats a one-word name that happens to sit inside it.
function timWhere(text){
  const t=_timNorm(text);
  if(t.trim()==='')return null;
  let best=null,bestLen=0;
  TIM_PLACES.forEach(p=>{
    p.say.forEach(phrase=>{
      const needle=' '+phrase+' ';
      if(t.indexOf(needle)<0)return;
      if(phrase.length>bestLen){bestLen=phrase.length;best=p;}
    });
  });
  return best?{pg:best.pg,name:best.name}:null;
}

// Which year. Only the three ways it gets said out loud: the year itself, last
// year, this year. Anything cleverer is a date picker's job, not a sentence's.
function timWhen(text,now){
  const t=_timNorm(text);
  const cur=(now instanceof Date?now:new Date()).getFullYear();
  const m=t.match(/\b(19\d\d|20\d\d)\b/);
  if(m)return parseInt(m[1],10);
  if(/\blast year\b/.test(t))return cur-1;
  if(/\b(this year|year to date|ytd|so far this year)\b/.test(t))return cur;
  return null;
}

// The name he said after "for", when there is one. Used to start a customer who
// does not exist yet: he said the name once already, he should not type it
// again. Time phrases are rejected here, because "books for last year" is a
// year, not a person.
function timSubject(text){
  const raw=String(text||'');
  const m=raw.match(/\bfor\s+([^,.;]+)/i);
  if(!m)return null;
  let s=m[1].trim().replace(/\s+/g,' ');
  // Trim at the word that starts the next clause, so "for Logan Sample doing a
  // repipe" keeps the name and drops the work.
  s=s.split(/\s+(?:about|doing|on|at|with|and)\b/i)[0].trim();
  if(!s)return null;
  if(/\d/.test(s))return null;
  const words=s.split(' ');
  if(words.length>4)return null;
  if(/^(last|this|next|the|a|an|my|me|it|us|them|now|today|tomorrow|yesterday)\b/i.test(s))return null;
  return s;
}

// Does the sentence ask to BUILD something, as opposed to go look at something?
// "build me a T and M for Logan Sample" is a build even when Logan Sample is
// not a customer yet, and that difference is the whole point of the flag.
function timWantsBuild(text){
  const t=_timNorm(text);
  return /\b(build|start|make|write|create|new|draw up|put together|set up)\b/.test(t)
      || /\b(t and m|time and materials|estimate|proposal|bid|quote)\b/.test(t);
}

// ── Photos are a place, not a page (owner 2026-09-22) ───────────────────────
// The Gallery page is gone, and photos are found through the search everybody
// already uses, keyed on the property. So "photos at 412 Oak" is not a
// navigation, it is a lookup: Tim strips the photo words and the filler and
// hands the REST to the search. A bare "photos" opens the box empty, which is
// the honest answer to a question with no subject in it.
const TIM_PHOTO_WORDS=['photos','photo','pictures','picture','pics','pic','shots','gallery','images'];
// The words a man actually says around the question. "where are my photos
// for pepe" left "where are pepe" as the search term and found nothing, which
// is the exact sentence the owner tried (2026-09-22). Question words, the
// auxiliaries that carry them, and the bare s left behind by an apostrophe
// (_timNorm strips punctuation, so "pepe's" arrives as "pepe s").
const _TIM_PHOTO_FILLER=['show','me','my','the','a','of','for','at','from','on','open','find','get','pull','up','all','job','jobs','site','house','place',
  'where','wheres','are','is','was','were','do','did','does','i','we','have','has','had','any','some','got','there','see','look','looking','need','want','to','s','take','took','taken','can','could','please'];
function timPhotoQuery(text){
  const t=_timNorm(text);
  if(!TIM_PHOTO_WORDS.some(w=>t.includes(' '+w+' ')))return null;
  const rest=t.trim().split(' ')
    .filter(w=>w&&!TIM_PHOTO_WORDS.includes(w)&&!_TIM_PHOTO_FILLER.includes(w))
    .join(' ').trim();
  return{q:rest};
}

// ── Time off, said out loud (owner 2026-09-24: "we're focused on Tim") ─────
// "Tim, I'm on vacation through Sunday." The same block the Schedule screen's
// Time off button writes (addTimeOff, js/settings.js), so the calendar stops
// booking those days and the deriver holds that day's automatic time and
// mileage (rule 25, js/geo-derive.js). Dates are the ways they get said: today,
// tomorrow, a weekday, "the 27th", "Sept 27", 9/27, "for 3 days", "next week".
// Nothing cleverer: a sentence Tim cannot pin to a day is not a day off.
const _TIM_OFF_SAID=/ (vacation|vacay|time off|day off|days off|off work|pto|holiday|out of town|not working|(i m|im|i am|we re|were|taking|take|be) off|(today|tomorrow|(sun|mon|tues|wednes|thurs|fri|satur)days?) off) /;
const _TIM_DOW=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
const _TIM_MON=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const _TIM_NUM={a:1,an:1,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,fourteen:14};
function _timYmd(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function _timPlus(d,n){const x=new Date(d.getFullYear(),d.getMonth(),d.getDate());x.setDate(x.getDate()+n);return x;}
// The first day named in `s`, on or after `from`. Earliest in the sentence
// wins, so "friday through monday" reads friday first.
function _timFirstDay(s,from){const h=_timFirstHit(s,from);return h?h.d:null;}
function _timFirstHit(s,from){
  const hits=[];
  const at=(re,fn)=>{const m=re.exec(s);if(m){const d=fn(m);if(d)hits.push({i:m.index,d});}};
  at(/ today /,()=>from);
  at(/ tomorrow /,()=>_timPlus(from,1));
  _TIM_DOW.forEach((w,i)=>at(new RegExp(' '+w+'s? '),()=>_timPlus(from,(i-from.getDay()+7)%7)));
  at(/ (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* (\d{1,2})(st|nd|rd|th)? /,m=>{
    const mo=_TIM_MON.indexOf(m[1]),dd=+m[2];
    let d=new Date(from.getFullYear(),mo,dd);
    if(d.getMonth()!==mo)return null;
    if(d<from)d=new Date(from.getFullYear()+1,mo,dd);
    return d;
  });
  at(/ (\d{1,2})\/(\d{1,2}) /,m=>{
    const mo=+m[1]-1,dd=+m[2];
    if(mo<0||mo>11)return null;
    let d=new Date(from.getFullYear(),mo,dd);
    if(d.getMonth()!==mo)return null;
    if(d<from)d=new Date(from.getFullYear()+1,mo,dd);
    return d;
  });
  at(/ (?:the )?(\d{1,2})(st|nd|rd|th) /,m=>{
    const dd=+m[1];
    let d=new Date(from.getFullYear(),from.getMonth(),dd);
    if(d.getDate()!==dd)return null;
    if(d<from){d=new Date(from.getFullYear(),from.getMonth()+1,dd);if(d.getDate()!==dd)return null;}
    return d;
  });
  if(!hits.length)return null;
  hits.sort((a,b)=>a.i-b.i);
  return hits[0];
}
function timTimeOff(text,now){
  const t=' '+String(text||'').toLowerCase().replace(/[^a-z0-9\/\s]/g,' ').replace(/\s+/g,' ').trim()+' ';
  if(!_TIM_OFF_SAID.test(t))return null;
  const n=(now instanceof Date&&!isNaN(now))?now:new Date();
  const today=new Date(n.getFullYear(),n.getMonth(),n.getDate());
  const label=/ (vacation|vacay) /.test(t)?'Vacation':/ holiday /.test(t)?'Holiday':'Time off';
  let start=null,end=null;
  if(/ next week /.test(t)){
    start=_timPlus(today,((1-today.getDay()+7)%7)||7);
    end=_timPlus(start,6);
  }else{
    // Split at the word that starts the end date, when what follows it is a
    // day. "to" only counts that way, since "going to be off" is not a range.
    const cut=/ (through|thru|till|til|until|to|ending) /g;
    let m,head=t,tail='';
    while((m=cut.exec(t))){
      const rest=' '+t.slice(m.index+m[0].length);
      const h=_timFirstHit(rest,today);
      // "to" must be followed straight away by the day ("friday to sunday");
      // anywhere later it is the "to" in "going to be off tomorrow".
      if(h&&(m[1]!=='to'||h.i===0)){head=t.slice(0,m.index)+' ';tail=rest;break;}
      cut.lastIndex=m.index+1;
    }
    start=_timFirstDay(head,today)||today;
    if(tail)end=_timFirstDay(tail,start);
    const f=/ for (\d{1,2}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|fourteen) (day|days|week|weeks) /.exec(t);
    if(!end&&f){
      const k=/^\d+$/.test(f[1])?+f[1]:_TIM_NUM[f[1]];
      const days=/week/.test(f[2])?k*7:k;
      if(days>0)end=_timPlus(start,days-1);
    }
    if(!end){
      // Nothing that names a day at all: he is asking about the list, not
      // adding to it ("show my time off", "cancel my vacation").
      if(!_timFirstDay(t,today)&&/ (show|open|see|list|edit|remove|delete|cancel|change|check) /.test(t))return {open:true};
      end=start;
    }
  }
  if(end<start)return null;
  if((end-start)/86400000>62)return null;
  return {start:_timYmd(start),end:_timYmd(end),label};
}
function _timDayWord(ymd){
  const d=new Date(ymd+'T12:00:00');
  return isNaN(d)?ymd:d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
}

// ── A lead in one breath (owner 2026-09-25: "go on autopilot and navigate
// pages correctly for entering leads") ──────────────────────────────────────
// "New lead Mike Jones, 412 Oak St, Topeka, 316-555-1234, water heater's
// leaking, found us on Google." Tim pulls the name, address, phone, email and
// where they came from out of the sentence, saves the customer, and if the
// sentence names a job he knows, opens the proposal with that job already on
// it (js/trade-knowledge.js decides which job; the price book decides the
// price). Pure: text in, fields out. timRun does the saving.
const _TIM_LEAD_SAID=/\b(?:new|another|add(?: a)?|create(?: a)?|got a|enter(?: a)?|put in(?: a)?)\s+(?:lead|customer|client)\b/i;
const _TIM_STREET=/\b\d{1,6}\s+(?:[a-z0-9.']+\s+){0,4}?(?:st|street|ave|avenue|rd|road|dr|drive|ln|lane|ct|court|blvd|boulevard|way|pl|place|cir|circle|ter|terrace|pkwy|parkway|hwy|highway|trl|trail|loop)\b\.?/i;
const _TIM_SOURCES=[
  [/referred by|referral|sent (?:him|her|them) (?:over|to us)|word of mouth/i,'Referral'],
  [/google|searched online|found us online/i,'Google / online'],
  [/facebook/i,'Facebook'],[/nextdoor/i,'Nextdoor'],[/instagram/i,'Instagram'],[/craigslist/i,'Craigslist'],
  [/yard sign/i,'Yard sign'],[/door hanger/i,'Door hanger'],[/truck|van wrap/i,'Vehicle / truck wrap'],
  [/realtor|real estate/i,'Real estate agent'],[/property manager|landlord/i,'Property manager'],
  [/repeat customer|used us before|past customer/i,'Repeat customer'],
];
// Words that end a name: the next clause has started.
const _TIM_NAME_STOP=/^(?:at|on|in|with|who|wants|needs|need|want|phone|cell|number|email|lives|address|from|off|by|has|his|her|their|is|says|called|calling|for|about|the|a|an|and)$/i;
function timLead(text){
  const raw=String(text||'');
  const m=_TIM_LEAD_SAID.exec(raw);
  if(!m)return null;
  let rest=' '+raw.slice(m.index+m[0].length)+' ';
  const cut=(s)=>{rest=rest.replace(s,' , ');};
  let phone='';
  const pm=rest.match(/(?:\+?1[\s.-]?)?\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})\b/);
  if(pm){phone=pm[1]+pm[2]+pm[3];cut(pm[0]);}
  let email='';
  const em=rest.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  if(em){email=em[0].toLowerCase();cut(em[0]);}
  let ref='';
  const rm=rest.match(/referred by\s+([a-z][a-z'.-]*(?:\s+[a-z][a-z'.-]*)?)/i);
  if(rm)ref=rm[1].trim();
  let source='';
  for(const [re,label] of _TIM_SOURCES){if(re.test(raw)){source=label;break;}}
  // The address: a house number, a few words, a street word. The city, state
  // and zip ride along only when they are the next short pieces.
  let addr='';
  const am=_TIM_STREET.exec(rest);
  if(am){
    let tail=rest.slice(am.index+am[0].length);
    let full=am[0].trim().replace(/\.$/,'');
    const city=/^\s*,?\s*([a-z][a-z .']{1,24}?)\s*(?=,|$)/i.exec(tail);
    if(city&&city[1].trim().split(/\s+/).length<=3&&!/\d/.test(city[1])&&
       !(typeof tkJobFor==='function'&&tkJobFor(city[1]))&&!/\b(wants|needs|leak|broke|replace|install|repair|found|referred)\b/i.test(city[1])){
      full+=', '+city[1].trim();tail=tail.slice(city[0].length);
      const st=/^\s*,?\s*([a-z]{2})(?:\s+(\d{5}))?\s*(?=,|$)/i.exec(tail);
      if(st){full+=', '+st[1].toUpperCase()+(st[2]?' '+st[2]:'');tail=tail.slice(st[0].length);}
    }
    const zip=/^\s*,?\s*(\d{5})\b/.exec(tail);
    if(zip){full+=' '+zip[1];tail=tail.slice(zip[0].length);}
    addr=full;
    rest=rest.slice(0,am.index)+' , '+tail;
  }
  // The name: the first words, stopped by a comma, a digit, or a word that
  // starts the next clause. Lead-ins ("named", "called", "is") are dropped.
  const head=rest.replace(/^[\s,:;-]*(?:(?:named|called|name is|name's|is|for)\s+)?/i,'');
  const words=[];
  for(const w of head.split(/\s+/)){
    if(!w)continue;
    if(/[,;.]/.test(w)){const c=w.replace(/[,;.].*$/,'');if(c&&!_TIM_NAME_STOP.test(c)&&/^[a-z][a-z'-]*$/i.test(c))words.push(c);break;}
    if(/\d/.test(w)||_TIM_NAME_STOP.test(w)||!/^[a-z][a-z'-]*$/i.test(w))break;
    words.push(w);
    if(words.length>=4)break;
  }
  const name=words.map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(' ');
  let job=head.slice(head.indexOf(words.join(' '))+words.join(' ').length);
  job=job.replace(/referred by\s+[a-z][a-z'.-]*(?:\s+[a-z][a-z'.-]*)?/i,' ')
    .replace(/\b(?:found|heard about|saw) us (?:on|from|through)\s+[a-z]+/i,' ')
    .replace(/\b(?:from|on|via|through)\s+(?:google|facebook|nextdoor|instagram|craigslist|a yard sign|a door hanger|our truck)\b/i,' ')
    .replace(/[\s,;:-]+/g,' ').replace(/^\s*(?:(?:at|and|who|he|she|they|wants|want|needs|need|with|to|has|is)\s+)+/i,'').trim();
  return {name,phone,email,addr,source,ref,job};
}
// Which job the lead's words name, as one line: his price book first, then the
// catalog, with the trade library deciding between look-alikes ("water heater"
// is the 40 gallon gas unless he says 50 or electric).
function timLeadJob(job,trade,book,catalog){
  const said=String(job||'').toLowerCase();
  if(!said.trim())return null;
  const fromBook=(typeof spkServices==='function')?spkServices(said,book,[]):[];
  if(fromBook.length){const b=fromBook[0];return {desc:b.desc,rate:b.rate,notes:b.notes||''};}
  const tk=(typeof tkJobFor==='function')?tkJobFor(said,trade):null;
  const cat=Array.isArray(catalog)?catalog:[];
  let pick=null;
  if(tk){
    let best=-1;
    cat.forEach(j=>{
      if(!j||tkJobFor(j.name,trade)!==tk)return;
      const extra=String(j.name).toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/(\d)([a-z])/g,'$1 $2').split(/\s+/).filter(w=>w.length>1&&said.indexOf(w)>=0).length;
      if(extra>best){best=extra;pick=j;}
    });
  }
  if(!pick){
    const s=(typeof spkServices==='function')?spkServices(said,[],cat):[];
    if(s.length)pick=cat.find(j=>j.name===s[0].desc)||null;
  }
  if(!pick)return null;
  return {desc:pick.name,rate:Math.round((pick.labor||0)+(pick.mat||0)),notes:''};
}
function _timPhoneWord(d){return d&&d.length===10?'('+d.slice(0,3)+') '+d.slice(3,6)+'-'+d.slice(6):d;}

// The whole sentence, resolved. Pure: hand it the lists, get back a plan.
// Order matters. Building beats looking, because a contractor who says
// "estimate" while describing work wants the builder, not the list of ones he
// already sent.
function timParse(text,opts){
  const o=opts||{};
  const said=String(text||'');
  if(!said.trim())return {text:said,kind:'none'};

  // Before the estimate parser: "off" and "for three days" are not a job.
  const off=timTimeOff(said,o.now);
  if(off)return off.open?{text:said,kind:'timeoff-open'}:{text:said,kind:'timeoff',start:off.start,end:off.end,label:off.label};

  const lead=timLead(said);
  if(lead&&lead.name){
    const pick=timLeadJob(lead.job,o.trade||'general',o.book,o.catalog);
    return Object.assign({text:said,kind:'lead',pick},lead);
  }

  const est=(typeof spkParse==='function')
    ? spkParse(said,{clients:o.clients,book:o.book,catalog:o.catalog})
    : null;
  if(est&&est.actionable)return {text:said,kind:'estimate',plan:est};

  const subject=timSubject(said);
  if(subject&&timWantsBuild(said)&&!(est&&est.client))
    return {text:said,kind:'newclient',subject};

  const pho=timPhotoQuery(said);
  if(pho){
    // Resolved here, not at run time, so the preview line can say what is
    // about to happen: one place opens, several ask which, none searches.
    const hits=(pho.q&&typeof tdPhotoSearch==='function')?tdPhotoSearch(pho.q,o.photos||[]):[];
    return {text:said,kind:'photos',q:pho.q,places:hits};
  }

  const where=timWhere(said);
  const year=timWhen(said,o.now);
  if(where)return {text:said,kind:'nav',pg:where.pg,name:where.name,year};
  // A bare year is the books. Nowhere else in this app is a year the whole ask.
  if(year!==null)return {text:said,kind:'nav',pg:'pg-tracker',name:'Books',year};

  return {text:said,kind:'none'};
}

// What Tim is about to do, in his words, so the box is never a black hole. This
// string is what the screen shows BEFORE he does anything.
function timSay(p){
  if(!p||p.kind==='none')return '';
  if(p.kind==='nav')return 'Open '+p.name+(p.year?' for '+p.year:'');
  if(p.kind==='photos'){
    const n=(p.places||[]).length;
    if(n===1){
      const g=p.places[0];
      const where=(g.addr||'').split(',')[0]||g.name||'those';
      return 'Open '+where+', '+g.photos.length+(g.photos.length===1?' photo':' photos');
    }
    if(n>1)return 'Pick which address, '+n+' match';
    return p.q?'Search photos for '+p.q:'Search photos';
  }
  if(p.kind==='newclient')return 'Start '+p.subject+' as a new customer';
  if(p.kind==='lead'){
    const bits=[p.addr?String(p.addr).split(',')[0]:'',p.phone?_timPhoneWord(p.phone):''].filter(Boolean);
    return 'Add lead '+p.name+(bits.length?' ('+bits.join(', ')+')':'')+(p.pick?', then start a '+p.pick.desc+' proposal':'');
  }
  if(p.kind==='timeoff')return 'Mark '+_timDayWord(p.start)+(p.end!==p.start?' to '+_timDayWord(p.end):'')+' as '+p.label.toLowerCase();
  if(p.kind==='timeoff-open')return 'Open your time off';
  if(p.kind==='estimate'){
    const pl=p.plan||{};
    const what=pl.type==='tm'?'a T&M':'a proposal';
    const who=pl.client&&pl.client.name?pl.client.name:'them';
    const bits=[];
    if(pl.hours>0)bits.push(pl.hours+' hrs');
    if(pl.services&&pl.services.length)bits.push(pl.services.length+(pl.services.length===1?' line':' lines'));
    return 'Build '+what+' for '+who+(bits.length?' ('+bits.join(', ')+')':'');
  }
  return '';
}

// The impure half. Everything it calls already existed; Tim only picks which.
function timRun(text){
  const trade=(typeof getActiveTrade==='function'?getActiveTrade():'general')||'general';
  const book=(typeof S!=='undefined'&&S.priceBook&&Array.isArray(S.priceBook[trade]))?S.priceBook[trade]:[];
  const catalog=(typeof TRADE_JOBS!=='undefined'&&Array.isArray(TRADE_JOBS[trade]))?TRADE_JOBS[trade]:[];
  const p=timParse(text,{clients:(typeof clients!=='undefined'?clients:[]),book,catalog,trade,
    photos:(typeof photos!=='undefined'?photos:[])});

  if(p.kind==='lead'){_timSaveLead(p,trade);return p;}

  if(p.kind==='estimate'&&typeof tdSpeakEstimate==='function'){tdSpeakEstimate(text);return p;}

  if(p.kind==='newclient'&&typeof _newClientQuickGate==='function'){
    _newClientQuickGate();
    const el=document.getElementById('_newc-gate-name');
    if(el){
      el.value=p.subject;
      try{el.dispatchEvent(new Event('input',{bubbles:true}));}catch(_e){}
    }
    return p;
  }

  if(p.kind==='timeoff'&&typeof addTimeOff==='function'){
    const have=(typeof S!=='undefined'&&Array.isArray(S.timeOff))?S.timeOff:[];
    // Already covered is already done: a second identical block would only
    // be one more row to remove later.
    if(!have.some(b=>b&&b.start<=p.start&&(b.end||b.start)>=p.end))addTimeOff(p.start,p.end,p.label);
    if(typeof showToast==='function')showToast(p.label+' saved. Time and mileage wait for your answer those days','🏖',3200);
    // Today inside it: re-derive now so the live timer stops this minute
    // rather than at the next motion flip.
    try{
      const td=(typeof _bizDateStr==='function')?_bizDateStr(new Date()):_timYmd(new Date());
      if(td>=p.start&&td<=p.end&&typeof _geoDeriveDayNow==='function')_geoDeriveDayNow(td,null);
    }catch(_e){}
    return p;
  }
  if(p.kind==='timeoff-open'&&typeof openTimeOffModal==='function'){openTimeOffModal();return p;}

  if(p.kind==='photos'){
    const places=p.places||[];
    // One place is not a question. Several is, and he asks it himself rather
    // than handing over a list of search results to read.
    if(places.length===1&&typeof tdOpenPhotoGroup==='function'){
      tdOpenPhotoGroup(places[0]);
      return p;
    }
    if(places.length>1){_timPickPlace(places);return p;}
    if(typeof openSearch==='function'){
      openSearch();
      const box=document.getElementById('global-search-input');
      if(box&&p.q){box.value=p.q;if(typeof runSearch==='function')runSearch(p.q);}
    }
    return p;
  }

  if(p.kind==='nav'&&typeof goPg==='function'){
    goPg(p.pg);
    // The year goes on AFTER the page exists, because setting it renders the
    // tab. A year the books have no rows for falls back to the newest on its
    // own inside populateTrackerYearSel, which is the right answer anyway.
    if(p.year&&p.pg==='pg-tracker'&&typeof setTrackerYear==='function')setTrackerYear(p.year);
    return p;
  }
  return p;
}

// Save the lead, then go where the sentence pointed: the proposal when it named
// a job, the customer's page when it did not. The customer is created through
// the one door every other path uses (_clientQuickCreate, js/clients.js), so
// the funnel event, the hub token and the property lookup all happen as they
// would from the form (7.3).
function _timSaveLead(p,trade){
  if(!p||!p.name)return null;
  const list=(typeof clients!=='undefined'&&Array.isArray(clients))?clients:[];
  // Somebody he already has is not a new lead: same phone, or same name at
  // the same street. He gets the one he has, not a duplicate.
  const digits=v=>String(v||'').replace(/\D/g,'').slice(-10);
  let c=list.find(x=>x&&p.phone&&digits(x.phone)===p.phone)||
        list.find(x=>x&&p.addr&&String(x.name||'').toLowerCase()===p.name.toLowerCase()&&
          String(x.addr||'').toLowerCase().split(',')[0]===String(p.addr).toLowerCase().split(',')[0])||null;
  const existed=!!c;
  if(!c){
    if(typeof _clientQuickCreate!=='function')return null;
    c=_clientQuickCreate(p.name,p.addr||'');
    if(p.phone)c.phone=p.phone;
    if(p.email)c.email=p.email;
    if(p.source)c.source=p.source;
    if(p.ref)c.ref=p.ref;
    if(p.job)c.notes=p.job.charAt(0).toUpperCase()+p.job.slice(1);
    if(typeof saveAll==='function')saveAll();
  }
  if(typeof showToast==='function')showToast(existed?(c.name+' is already a customer'):('Lead saved: '+c.name),existed?'👤':'✅',2600);
  if(typeof currentClientId!=='undefined')currentClientId=c.id;
  if(p.pick&&typeof openFreeFormEstimate==='function'){
    window._scanEstimateSeed={clientId:c.id,lines:[{desc:p.pick.desc,qty:1,unit:'ea',rate:p.pick.rate,total:p.pick.rate,
      notes:p.pick.notes||(typeof tkScopeFor==='function'?tkScopeFor(p.pick.desc,trade):''),
      _byoSection:(typeof _byoWorkSection==='function'?_byoWorkSection():'Work')}],
      say:p.pick.desc+' is on the proposal'};
    openFreeFormEstimate(c);
    // Autopilot means landing where the work is. The setup step it opens on
    // already holds the defaults (residential, repair, normal hours) and his
    // customer, so it is one tap he never needed to make.
    if(typeof goGeiStep==='function'){try{goGeiStep(2);}catch(_e){}}
  }else if(typeof openClientDetail==='function'){
    openClientDetail(c.id);
  }
  return c;
}

// ── The box ──────────────────────────────────────────────────────────────────
// Centered modal, the app's one convention for a prompt (7.3). The mic is the
// same on-device one every note field already uses (js/voice.js): the words are
// transcribed on the phone, so a sentence said in a client's kitchen stays in
// the kitchen.

function _timClose(){document.getElementById('_tim-ov')?.remove();}

function _timPreview(){
  const el=document.getElementById('_tim-say');
  const out=document.getElementById('_tim-read');
  const go=document.getElementById('_tim-go');
  if(!el||!out)return;
  const trade=(typeof getActiveTrade==='function'?getActiveTrade():'general')||'general';
  const book=(typeof S!=='undefined'&&S.priceBook&&Array.isArray(S.priceBook[trade]))?S.priceBook[trade]:[];
  const catalog=(typeof TRADE_JOBS!=='undefined'&&Array.isArray(TRADE_JOBS[trade]))?TRADE_JOBS[trade]:[];
  const p=timParse(el.value,{clients:(typeof clients!=='undefined'?clients:[]),book,catalog,trade,
    photos:(typeof photos!=='undefined'?photos:[])});
  const line=timSay(p);
  out.textContent=line||(el.value.trim()?'Not sure what that is yet':'');
  out.style.color=line?'var(--text2)':'var(--text3)';
  if(go)go.disabled=!line;
  if(go)go.style.opacity=line?'1':'.45';
}

function _timGo(){
  const el=document.getElementById('_tim-say');
  const said=el?el.value:'';
  // Close BEFORE acting, not after. Running first and closing second tore
  // down whatever the action had just opened in the same overlay: the photo
  // chooser appeared and vanished in one frame (caught in a screenshot,
  // 2026-09-22). A sentence he cannot place keeps the box open, because
  // closing it would throw away what the contractor just typed.
  const trade=(typeof getActiveTrade==='function'?getActiveTrade():'general')||'general';
  const book=(typeof S!=='undefined'&&S.priceBook&&Array.isArray(S.priceBook[trade]))?S.priceBook[trade]:[];
  const catalog=(typeof TRADE_JOBS!=='undefined'&&Array.isArray(TRADE_JOBS[trade]))?TRADE_JOBS[trade]:[];
  const peek=timParse(said,{clients:(typeof clients!=='undefined'?clients:[]),book,catalog,trade,
    photos:(typeof photos!=='undefined'?photos:[])});
  if(!peek||peek.kind==='none'){
    if(typeof showToast==='function')showToast('Say a screen, a year, or a bid','🔧',2600);
    return peek;
  }
  _timClose();
  return timRun(said);
}

// "Which one?", asked the way Tim asks everything else: his modal, one tap per
// answer, and the tap lands you in the photos rather than in a list about them.
let _timPlaces=[];
function _timPickPlace(places){
  _timPlaces=places||[];
  if(!_timPlaces.length)return false;
  _timClose();
  const ov=document.createElement('div');ov.className='zmodal-overlay';ov.id='_tim-ov';
  ov.onclick=e=>{if(e.target===ov)_timClose();};
  const box=document.createElement('div');box.className='zmodal';
  box.style.animation='td-pg-enter .22s cubic-bezier(.22,1,.36,1) both';
  box.innerHTML=
    '<div style="font-size:17px;font-weight:800;margin-bottom:2px">Which one?</div>'+
    '<div style="font-size:12px;color:var(--text3);margin-bottom:12px">'+_timPlaces.length+' places have photos</div>'+
    '<div class="pc-file-list">'+
      _timPlaces.map((g,i)=>'<button type="button" class="pc-file-opt" onclick="_timOpenPlace('+i+')">'+
        escHtml((g.addr||'').split(',')[0]||g.name||'Unfiled')+
        '<span>'+escHtml(g.name||'')+(g.name&&g.photos.length?' \u00b7 ':'')+g.photos.length+
        (g.photos.length===1?' photo':' photos')+'</span></button>').join('')+
    '</div>'+
    '<button id="_tim-cancel" style="width:100%;padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:none;color:var(--text3);font-size:14px;cursor:pointer;font-family:inherit;margin-top:10px">Cancel</button>';
  ov.appendChild(box);document.body.appendChild(ov);
  document.getElementById('_tim-cancel').onclick=_timClose;
  return true;
}
function _timOpenPlace(i){
  const g=_timPlaces[i];
  if(!g)return false;
  _timClose();
  return(typeof tdOpenPhotoGroup==='function')?tdOpenPhotoGroup(g):false;
}

function openTim(){
  _timClose();
  const ov=document.createElement('div');ov.className='zmodal-overlay';ov.id='_tim-ov';
  ov.onclick=e=>{if(e.target===ov)_timClose();};
  const box=document.createElement('div');box.className='zmodal';
  box.style.animation='td-pg-enter .22s cubic-bezier(.22,1,.36,1) both';
  box.innerHTML=
    '<div style="font-size:17px;font-weight:800;margin-bottom:2px">Tim</div>'+
    '<div style="font-size:12px;color:var(--text3);margin-bottom:12px">Say where to go or what to build</div>'+
    '<div style="position:relative;margin-bottom:8px">'+
      '<input id="_tim-say" type="text" autocomplete="off" placeholder="show me my books for last year" '+
        'style="width:100%;box-sizing:border-box;padding:12px 44px 12px 12px;border:1.5px solid var(--border2);border-radius:var(--r);font-size:15px;font-family:inherit;background:var(--bg2);color:var(--text)">'+
    '</div>'+
    '<div id="_tim-read" style="min-height:18px;font-size:13px;font-weight:600;color:var(--text3);margin-bottom:12px"></div>'+
    '<button id="_tim-go" style="width:100%;padding:14px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;opacity:.45">Go</button>'+
    '<button id="_tim-cancel" style="width:100%;padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:none;color:var(--text3);font-size:14px;cursor:pointer;font-family:inherit;margin-top:10px">Cancel</button>';
  ov.appendChild(box);document.body.appendChild(ov);

  const el=document.getElementById('_tim-say');
  if(typeof _voiceAttach==='function'){
    _voiceAttach('_tim-say',{
      host:el&&el.parentElement,
      style:'position:absolute;right:7px;top:7px;display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;border:1.5px solid var(--border2);background:var(--bg);color:var(--text3)',
      onText:_timPreview,
      // Let go of the mic and he goes. Saying it out loud and then reaching for
      // a button is two actions for one thought.
      onDone:()=>{_timPreview();setTimeout(_timGo,120);},
    });
  }
  el?.addEventListener('input',_timPreview);
  el?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();_timGo();}});
  document.getElementById('_tim-go').onclick=_timGo;
  document.getElementById('_tim-cancel').onclick=_timClose;
  _timPreview();
  setTimeout(()=>el?.focus(),100);
}
