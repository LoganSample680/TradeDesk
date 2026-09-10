// ── Say what you need, get the estimate ─────────────────────────────────────
//
// "T and M for the Delaneys, about eight hours, water heater replacement."
//
// Owner direction 2026-09-06: he wants this to feel like talking to somebody,
// without paying for a model call on every estimate. It does not need one.
// Every part of that sentence resolves against something the app already
// holds: the billing type is three fixed phrasings, the hours are a number
// next to the word hours, the customer is in his customer list, and the work
// is in his own price book. That is string matching, not inference, so it runs
// offline in a truck with no signal and costs nothing per estimate.
//
// A good price book is what makes AI unnecessary at the moment he uses this
// most. That is the whole architecture: the model, if we ever add one, belongs
// at setup, where it runs once. Speed belongs here, where it runs all day.
//
// Everything below is pure except tdSpeakEstimate, which is the one function
// that touches the app.

const _SPK_STOP = ['the','a','an','and','or','of','to','for','with','on','in','at','is','it',
  'we','i','need','want','doing','do','be','will','about','around','roughly','please','job',
  'bid','quote','estimate','proposal','client','customer','their','they','this','that'];

function _spkNorm(t){
  return String(t||'').toLowerCase()
    .replace(/[^a-z0-9&.\s]/g,' ')     // keep & for "t & m", and the dot in 1.5
    .replace(/\s+/g,' ').trim();
}
function _spkWords(t){
  return _spkNorm(t).split(' ').filter(w=>w&&!_SPK_STOP.includes(w));
}
// "delaneys" and "delaney" are the same family, which is how people say it.
function _spkStem(w){
  const s=String(w||'');
  if(s.length>3&&/(?:es)$/.test(s))return s.slice(0,-2);
  if(s.length>3&&/s$/.test(s)&&!/ss$/.test(s))return s.slice(0,-1);
  return s;
}

// How he is billing it. Only the phrasings a contractor actually says out loud.
function spkBillingType(text){
  const t=_spkNorm(text);
  if(/\b(t\s*&\s*m|t and m|t m|time and materials?|time & materials?|hourly|by the hour)\b/.test(t))return 'tm';
  if(/\b(flat|fixed|firm|lump sum|not to exceed)\b/.test(t))return 'byo';
  return null;
}

// Hours, however he says them. Days are eight hours, because that is what a
// day is on a job, and half a day is four.
function spkHours(text){
  const t=_spkNorm(text);
  let m=t.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|hr)\b/);
  if(m)return parseFloat(m[1]);
  m=t.match(/(\d+(?:\.\d+)?)\s*(?:days?)\b/);
  if(m)return parseFloat(m[1])*8;
  if(/\bhalf (?:a )?day\b/.test(t))return 4;
  if(/\b(?:a|one) day\b/.test(t))return 8;
  if(/\bcouple (?:of )?days\b/.test(t))return 16;
  const words={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12};
  m=t.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:hours?|hrs?)\b/);
  if(m)return words[m[1]]||0;
  m=t.match(/\b(one|two|three|four|five)\s*days?\b/);
  if(m)return (words[m[1]]||0)*8;
  return 0;
}

// Which customer he means. Scored on the distinctive words in their name, so
// "the Delaneys" finds Rick Delaney and "smith" does not silently win against
// a sentence that never mentioned a name.
function spkClient(text,list){
  const rows=Array.isArray(list)?list:[];
  const said=new Set(_spkWords(text).map(_spkStem));
  if(!said.size)return null;
  let best=null,bestScore=0;
  rows.forEach(c=>{
    const parts=_spkWords(c&&c.name).map(_spkStem);
    if(!parts.length)return;
    const hit=parts.filter(p=>p.length>2&&said.has(p)).length;
    if(!hit)return;
    // Every word of the name heard beats one word of two heard.
    const score=hit+(hit/parts.length);
    if(score>bestScore){bestScore=score;best=c;}
  });
  return best;
}

// What the work is. Matched against his own book first, because those are his
// words and his prices; the shipped trade catalogue is the fallback for a
// contractor who has not written anything yet.
function spkServices(text,book,catalog){
  const said=new Set(_spkWords(text).map(_spkStem));
  if(!said.size)return [];
  const score=(name)=>{
    const parts=_spkWords(name).map(_spkStem).filter(w=>w.length>2);
    if(!parts.length)return 0;
    const hit=parts.filter(p=>said.has(p)).length;
    if(!hit)return 0;
    return hit/parts.length;      // how much of the service name he actually said
  };
  const out=[];
  (Array.isArray(book)?book:[]).forEach(b=>{
    const s=score(b&&b.desc);
    if(s>=0.5)out.push({desc:b.desc,rate:Number(b.rate)||0,score:s,from:'book'});
  });
  if(!out.length){
    (Array.isArray(catalog)?catalog:[]).forEach(j=>{
      const s=score(j&&j.name);
      if(s>=0.5)out.push({desc:j.name,rate:Math.round((j.labor||0)+(j.mat||0)),score:s,from:'catalog'});
    });
  }
  return out.sort((a,b)=>b.score-a.score).slice(0,4);
}

// The whole sentence, resolved. Pure: hand it the lists, get back a plan.
function spkParse(text,opts){
  const o=opts||{};
  const client=spkClient(text,o.clients);
  const services=spkServices(text,o.book,o.catalog);
  const hours=spkHours(text);
  const type=spkBillingType(text)||(hours>0?'tm':null);
  return {
    text:String(text||''),
    type,
    hours,
    client,
    clientId:client?client.id:null,
    services,
    // Actionable means we understood enough to save him work. A sentence that
    // only names a customer is not a bid, it is a name, and the caller should
    // treat it as one rather than opening a builder he did not ask for.
    actionable:!!(client&&(type||hours>0||services.length)),
  };
}

// The one impure function: take a spoken sentence and open the right builder
// with what he said already in it. Reuses the existing seed hand-off
// (window._scanEstimateSeed) that the room scanner already uses, rather than
// inventing a second way to hand lines to a fresh estimate (7.3).
function tdSpeakEstimate(text){
  const trade=(typeof getActiveTrade==='function'?getActiveTrade():'general')||'general';
  const book=(typeof S!=='undefined'&&S.priceBook&&Array.isArray(S.priceBook[trade]))?S.priceBook[trade]:[];
  const catalog=(typeof TRADE_JOBS!=='undefined'&&Array.isArray(TRADE_JOBS[trade]))?TRADE_JOBS[trade]:[];
  const plan=spkParse(text,{clients:(typeof clients!=='undefined'?clients:[]),book,catalog});
  if(!plan.actionable)return plan;

  if(plan.services.length){
    window._scanEstimateSeed={
      clientId:plan.client.id,
      // The trade's own work section, never Materials: "replace the water heater"
      // is the job, not a part, and until the send gate stopped caring, landing
      // it in the wrong section was also what got the whole bid refused.
      lines:plan.services.map(s=>({desc:s.desc,qty:1,unit:'ea',rate:s.rate,total:s.rate,notes:'',
        _byoSection:(typeof _byoWorkSection==='function'?_byoWorkSection():'Work')})),
    };
  }
  if(typeof currentClientId!=='undefined')currentClientId=plan.client.id;
  if(plan.type==='tm'&&typeof openTMEstimate==='function')openTMEstimate(plan.client);
  else if(typeof openFreeFormEstimate==='function')openFreeFormEstimate(plan.client);

  // The hours go in the way the screen does it, once the screen exists.
  if(plan.hours>0){
    setTimeout(()=>{
      const h=document.getElementById('tm-hours');
      if(h){h.value=String(plan.hours);if(typeof _tmRecalc==='function')_tmRecalc();}
    },250);
  }
  return plan;
}
