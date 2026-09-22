// ── Tim's trade knowledge ────────────────────────────────────────────────────
//
// "I want Tim to be his own AI that knows this shit, we're basically training a
// local sandbox model." (owner 2026-09-19)
//
// That reverses half of the 2026-09-17 rule and keeps the other half. What it
// keeps, and what nothing in this file may ever break: Tim runs on the phone.
// No model call, no key, no network, nothing said to him leaves the device. A
// contractor standing in a crawlspace with no bars gets the same answer as one
// standing in the yard, and it costs nothing per estimate. Every function below
// is pure and offline, which is also why the whole thing is testable.
//
// What it reverses: Tim may now hold trade knowledge of his own. The old rule
// said the price book carries what a repipe drags in with it. That was right
// about PRICE and wrong about ORDER and EXISTENCE. A price book can say what
// scaffold costs. It cannot say that scaffold goes up before anything is
// stripped, and it cannot know that a man who said "second floor" and never
// said "scaffold" is about to send a proposal that will not stand up. Those two
// are trade knowledge, they are the same on every job in the country, and they
// are what this file holds.
//
// Three rules keep it honest:
//
//   1. He states where it came from, in the contractor's own words. Never "I
//      think" and never a confidence score. "You never said scaffold up first.
//      It has to be." is a correction. "You might want scaffold" is noise.
//   2. He never silently changes a number. When the contractor's own figures
//      disagree with the coverage math, Tim says both and leaves what was said.
//   3. Nothing he guessed becomes a fact until the contractor accepts it twice,
//      the same n:1 rule `_pbLearn` already uses on price. That is the whole of
//      the learning: it is written by the man using it, not guessed at setup.
//
// ── The line between Tim and the code books ──────────────────────────────────
//
// Owner, 2026-09-19: Tim will be fed code books. js/code-engine.js is where
// those live and it is already built for this, so the boundary has to be stated
// here before Tim grows into it, not after.
//
// **Nothing in this file may ever assert a code requirement.** Everything in
// TIM_IMPLIED is sequence and habit: scaffold goes up before anything is
// stripped because you cannot strip what you cannot reach, gutters come back on
// last because they were taken off first. None of it is law, none of it cites a
// section, and every entry carries `source:'trade'` to say so out loud.
//
// What a code book says comes through `timCode` below, which is a thin wrapper
// over `codeEval` and adds nothing. That matters because the engine's rule 2 is
// not negotiable: an unverified dataset, or an edition the contractor has not
// confirmed, returns no answer at all. A wrong ampacity on a permit is the worst
// thing this product could ship, and Tim guessing in the gap where the engine
// refused would be exactly that failure with a friendly face on it.
//
// So the two never mix on screen either. Code lines are rendered under their own
// heading with the edition and the section on them; Tim's are rendered under
// his. A contractor has to be able to tell, at a glance, which of the two he is
// reading, because only one of them is something an inspector will hold him to.

// ── The order work happens in ────────────────────────────────────────────────
//
// One list, every trade. This is the spine: a scope of work read out loud comes
// out in the order it occurred to him, and goes on the contract in the order
// the work actually happens. The owner named this as the part worth keeping.
//
// The phrases are how a contractor says the work, not how a spec writer does.
// Longest phrase wins, so "tear out" cannot be eaten by "out".
const TIM_STAGES=[
  {k:'access', n:'Access and staging', say:['scaffold','staging','stage the','ladder','lift','boom lift','scissor lift','swing stage','set up','mobilize','permit','pull a permit','shut the water off','kill the power','lock out']},
  {k:'protect',n:'Protect and remove',  say:['mask','masking','drop cloth','cover','protect','plastic off','move furniture','remove gutters','pull the gutters','take the gutters','remove shutters','remove fixtures','take down','pull the trim','disconnect']},
  {k:'demo',   n:'Tear out',            say:['tear out','tear off','demo','demolition','strip','stripping','scrape','grind','cut out','rip out','haul the old','remove the old','dispose of the old']},
  {k:'rough',  n:'Rough in',            say:['rough in','rough-in','run wire','pull wire','run romex','run pipe','run conduit','set the panel','stub','dig','trench','frame','excavate','underground']},
  {k:'repair', n:'Repair',              say:['replace rotted','rotted','repair','patch','fill','sister','re-sheath','resheath','replace siding','replace trim','replace boards','board for board','wood repair','drywall repair']},
  {k:'prep',   n:'Prep',                say:['prep','pressure wash','power wash','wash','sand','sanding','caulk','prime','primer','tape','etch','skim','feather','clean the surface']},
  {k:'install',n:'Install',             say:['install','hang','set the','mount','lay','tie in','terminate','trim out','make up','connect','shingle','roof it','set fixtures']},
  {k:'finish', n:'Finish',              say:['finish coat','two coats','top coat','topcoat','paint','spray','roll','stain','seal','grout','polish','touch up','touch-up']},
  {k:'restore',n:'Put back',            say:['rehang','re-hang','put back','reinstall','re-install','reset the gutters','rehang gutters','replace fixtures','remount','strike the scaffold','strike scaffold','take the scaffold down']},
  {k:'clean',  n:'Clean up',            say:['haul off','haul away','clean up','cleanup','broom clean','sweep','magnet','dumpster out','final walk','walk through','walkthrough','leave the site']},
];
const _TIM_STAGE_IX={};TIM_STAGES.forEach((s,i)=>{_TIM_STAGE_IX[s.k]=i;});

function _timkNorm(t){
  return ' '+String(t||'').toLowerCase()
    .replace(/&/g,' and ')
    // Apostrophes are DELETED, not turned into a space, and this is not a
    // nicety. The line below replaces every other stray character with a
    // space, which turned "what's" into "what s" and broke the match against
    // every phrase in TIM_ASKS written the way a man types it: "whats owed",
    // "whats the address", "whats out right now", "whats pending", "hows
    // business". iOS autocorrects "whats" TO "what's" by default, so the
    // keyboard was reliably rewriting his question into one Tim could not
    // hear. Found 2026-09-21 from a screenshot of the owner asking "What's
    // Going On Tim?" and getting a miss, with the keyboard visible above it
    // offering the apostrophe.
    // Both shapes: the straight one a keyboard sends and the curly one iOS
    // substitutes as you type.
    .replace(/['\u2018\u2019\u02BC]/g,'')
    .replace(/[^a-z0-9.\-\/\s]/g,' ')
    .replace(/\s+/g,' ').trim()+' ';
}

// Which stage a line of work belongs to. Scored on how much of the phrase he
// actually said, so a two-word phrase beats a one-word phrase sitting inside
// it, exactly the way timWhere picks a screen.
//
// Nothing he wrote is forced into a stage. A line Tim cannot place comes back
// null and keeps the position he gave it, because a scope step invented by a
// contractor outranks a guess about where it belongs.
function timStageHit(text){
  const t=_timkNorm(text);
  if(t.trim()==='')return null;
  let best=null,bestPhrase=null,bestLen=0;
  TIM_STAGES.forEach(s=>{
    s.say.forEach(phrase=>{
      if(t.indexOf(' '+phrase)<0)return;
      if(phrase.length>bestLen){bestLen=phrase.length;best=s.k;bestPhrase=phrase;}
    });
  });
  return best?{k:best,phrase:bestPhrase}:null;
}
function timStageOf(text){const h=timStageHit(text);return h?h.k:null;}

// The scope, in the order the work happens.
//
// Stable within a stage: two steps Tim puts in the same stage stay in the order
// the contractor said them, because at that point he knows the job and Tim does
// not. A step Tim cannot place holds its own position rather than being swept to
// one end, which is the difference between reordering a list and rewriting it.
//
// Returns a new array. Each entry carries the text, the stage, and `moved`,
// which is how far it travelled, so the screen can say why a line is where it
// is instead of silently shuffling his words.
function timOrderScope(steps){
  const rows=(Array.isArray(steps)?steps:[])
    .map((s,i)=>{
      const text=(s&&typeof s==='object')?String(s.text||s.label||s.desc||''):String(s||'');
      const stage=(s&&typeof s==='object'&&s.stage)?s.stage:timStageOf(text);
      const last=!!(s&&typeof s==='object'&&s.last);
      return {text,stage:stage||null,last,was:i,src:s};
    })
    .filter(r=>r.text.trim()!=='');
  // An unplaced step sits at the rank of the last placed step before it, so it
  // travels with the work it was written next to.
  let carry=-1;
  const ranked=rows.map(r=>{
    const ix=(r.stage!=null&&_TIM_STAGE_IX[r.stage]!=null)?_TIM_STAGE_IX[r.stage]:null;
    if(ix!=null)carry=ix;
    return Object.assign({},r,{rank:ix!=null?ix:(carry>=0?carry:0)});
  });
  ranked.sort((a,b)=>(a.rank-b.rank)||((a.last?1:0)-(b.last?1:0))||(a.was-b.was));
  return ranked.map((r,i)=>({
    text:r.text,
    stage:r.stage,
    stageName:r.stage?(TIM_STAGES[_TIM_STAGE_IX[r.stage]]||{}).n:null,
    was:r.was,
    moved:r.was-i,
    src:r.src,
  }));
}

// ── SAY THE JOB, GET THE SCOPE ───────────────────────────────────────────────
//
// Owner, 2026-09-22: "I really want to retire the scope picker on every bid,
// instead I want you to type up what youre doing or speak it to tim and he
// builds the scope in order broken down by steps in order. Tim cant forget a
// step."
//
// A picker asks a man to find his job in somebody else's list. He already knows
// the job; he has said it out loud twice before he opens the app. So this takes
// the sentence he would say to his crew and cuts it into the steps that are
// actually in it. Ordering is timOrderScope's job and the steps he forgot are
// timImplied's; this one only has to split, and split HIS words, not summarise
// them. Nothing here rewrites a phrase: a step comes out reading the way he
// said it or the feature has lied to him about his own scope.
//
// Pure and offline, like everything else in this file.

// Splitting on a comma is the dangerous one: "two coats, cut and rolled" is one
// step and "tear out the vanity, run the supply lines" is two. The difference
// is whether what follows the comma STARTS a new action, so a fragment only
// becomes its own step when it opens with a verb. The verbs come from the stage
// table, which is already a list of the things a contractor says he is doing,
// plus the handful of bare ones that carry no stage on their own.
// CURATED, not harvested. The first version built this from TIM_STAGES, which
// is a list of things a contractor SAYS, not a list of verbs: it carries
// "rotted", "drop cloth", "permit", "dumpster out". With "rotted" counted as a
// verb, "replace rotted trim" looked like verbs all the way down and got glued
// onto the step before it. So the verbs are written out, because a verb list is
// a short, checkable thing and a stage table is not.
const _TIMK_VERBS=new Set([
  // Tear out and take away
  'tear','strip','scrape','grind','demo','remove','pull','rip','haul','dispose','dump','gut',
  // Protect, stage, isolate
  'mask','cover','protect','move','disconnect','drain','shut','kill','lock','stage','mobilize',
  'scaffold','set','stand','erect',
  // Rough and structure
  'run','stub','dig','trench','excavate','frame','sister','brace','anchor','shim','hang','mount',
  'lay','install','tie','terminate','connect','wire','pipe','plumb','vent','flash','insulate',
  'waterproof','weld','solder','glue','pour','backfill','compact','grade','level','square',
  // Repair
  'repair','patch','fill','replace','resheath','rebuild','rehang','reinstall','reset','remount',
  // Prep and finish
  'prep','wash','pressurewash','powerwash','sand','caulk','prime','tape','etch','skim','feather',
  'clean','paint','spray','roll','brush','stain','seal','grout','polish','buff','coat','finish',
  // Prove it works, and leave
  'test','check','inspect','purge','bleed','pressure','torque','calibrate','label','tag',
  'photograph','sweep','vacuum','strike','walk',
  // The plain ones a man writes on a list
  'do','redo','fix','build','make','cut','put','take','bring','leave','call','order','pick',
  'deliver','start','change','swap','add','drop','open','close','trim','apply','adjust','verify',
  // "getting rid of the copper" is how it gets said, and 'get' was missing.
  'get','rid','hook','drain','swap','finish','hang','route','feed','mount','strap','secure',
]);

// What a man says before he gets to the work, which is not the work. "Okay so
// we're going to" is throat clearing and does not belong in a numbered step a
// homeowner reads.
const _TIMK_FILLER=/^(?:ok(?:ay)?|so|well|um+|uh+|right|alright|and|but|first(?:ly)?|then|next|after\s+that|afterwards?|finally|lastly|also|plus|basically|obviously)\b[\s,]*/i;
const _TIMK_SUBJECT=/^(?:(?:i|we|they|you)(?:\s*(?:'|’)?(?:re|m|ll|ve|d))?|im|ive|were|weve|well)\s+(?:are\s+|is\s+|am\s+)?(?:gonna|going\s+to|gotta|got\s+to|have\s+to|need\s+to|want\s+to|will|shall|just|then|also)?\s*/i;
// The words that always start a new step when they join two clauses.
const _TIMK_JOIN=/\s+(?:and\s+then|then|after\s+that|afterwards?|next(?:\s+up)?|followed\s+by|before\s+that)\s+/i;

// Words that ride along with a verb and say nothing about whether a new action
// started: conjunctions, particles and bare pronouns.
const _TIMK_RIDER=/^(?:and|or|then|plus|also|up|down|out|off|in|on|back|over|through|again|it|them|everything)$/;

function _timkVerbLike(w0){
  const w=String(w0||'').toLowerCase().replace(/[^a-z]/g,'');
  if(!w)return false;
  if(_TIMK_VERBS.has(w))return true;
  // "replacing", "hauling", "stripping", "rolled", "tested": the same verbs the
  // way a man narrates a day. Checked against the bare stem so the table does
  // not need every ending.
  // THE DOUBLED CONSONANT. "putting" strips to "putt", not "put", and the same
  // goes for getting, setting, cutting, running, digging and stripping, which
  // is most of how a man narrates a day's work. Every one of them failed.
  // Found 2026-09-22 on a real bid: "Putting In A Water Softener, Getting Tid
  // Of Some Copper For Pex A And Outting In A Tankless Water heater" came back
  // as ONE step because neither verb in it was recognised as a verb.
  const bare=(t)=>_TIMK_VERBS.has(t)||_TIMK_VERBS.has(t+'e')||
    (/([bcdfglmnprstvz])\1$/.test(t)&&_TIMK_VERBS.has(t.slice(0,-1)));
  if(/ing$/.test(w)&&bare(w.slice(0,-3)))return true;
  if(/ed$/.test(w)&&(bare(w.slice(0,-2))||bare(w.slice(0,-1))))return true;
  if(/s$/.test(w)&&bare(w.slice(0,-1)))return true;
  return false;
}

// Is anything being acted ON in here? A verb with an object starts a step; a
// bare verb is half of a compound one ("locate AND cut out the section").
function _timkHasObject(frag){
  const words=String(frag||'').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rest=words.slice(1).filter(w=>!_TIMK_RIDER.test(w.replace(/[^a-z]/g,'')));
  return rest.some(w=>!_timkVerbLike(w));
}

// Does this fragment START A NEW STEP, or is it saying how the last one is
// done? "tear out the vanity, run the supply lines" is two steps. "paint the
// kitchen two coats, cut and rolled" is one, and cut-and-rolled is the manner.
//
// Both open with a verb, so the verb alone cannot tell them apart. What can is
// whether anything is being acted ON: a new step names its object, and a manner
// phrase is verbs and conjunctions all the way down. A bare one-word step
// ("backfill") is still a step, because a man writing a list writes those.
function _timkNewAction(frag){
  const words=String(frag||'').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if(!words.length||!_timkVerbLike(words[0]))return false;
  // Particles ride with their verb and say nothing about whether a new action
  // started: "tested and pressured UP" is still just manner. Counting "up" as
  // an object split it off as its own step.
  const rest=words.slice(1).filter(w=>!_TIMK_RIDER.test(w.replace(/[^a-z]/g,'')));
  if(!rest.length)return true;
  return rest.some(w=>!_timkVerbLike(w));
}

// ── "AND", WHICH IS TWO DIFFERENT WORDS ──────────────────────────────────────
//
// "Locate AND cut out the failed section" is ONE step: two verbs sharing one
// object. "Getting rid of the copper AND putting in a tankless" is two steps:
// each verb has its own object. The difference is whether the LEFT side names
// something of its own, so that is what is tested, on both sides.
//
// Strict on the right: a bare gerund after "and" is usually a noun in this
// trade ("replace the trim and siding"), so it only starts a step when it has
// an object of its own too.
function _timkAndSplits(left,right){
  if(!_timkHasObject(left))return false;
  const words=String(right||'').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if(!words.length)return false;
  const w=words[0].replace(/[^a-z]/g,'');
  // A verb, or the -ing form of anything, which is the register dictation
  // produces: "putting in", "getting rid of", "running new".
  if(!_timkVerbLike(w)&&!(/ing$/.test(w)&&w.length>=5))return false;
  return _timkHasObject(right);
}

function _timkTidy(t){
  let v=String(t||'').replace(/\s+/g,' ').trim();
  // Bullet and number markers, however he typed them.
  v=v.replace(/^[\-\*\u2022\u00b7\u2013\u2014]+\s*/,'').replace(/^\(?\d{1,2}[.):]\s*/,'');
  // Filler and subject can stack: "okay so we're going to tear out".
  for(let i=0;i<3;i++){
    const before=v;
    v=v.replace(_TIMK_FILLER,'').replace(_TIMK_SUBJECT,'');
    if(v===before)break;
  }
  v=v.replace(/\s+/g,' ').trim().replace(/[\s,;:.]+$/,'');
  if(!v)return '';
  // His words, his capitals, except the first letter, which a numbered list
  // wants upper whether he was shouting or dictating.
  return v.charAt(0).toUpperCase()+v.slice(1);
}

// The whole of it: prose in, steps out, in the order he said them. Ordering
// into WORK order is timOrderScope, deliberately separate, because a man who
// dictated his day out of order should see his own list first and then be
// offered the sort.
function timScopeFrom(text){
  const raw=String(text||'');
  if(!raw.trim())return [];
  const out=[];
  const seen=new Set();
  const push=(frag)=>{
    const v=_timkTidy(frag);
    if(!v)return;
    // A step that is only a number or a stray word is noise, not scope.
    if(v.replace(/[^a-z]/gi,'').length<3)return;
    const key=v.toLowerCase();
    if(seen.has(key))return;
    seen.add(key);
    if(out.length<40)out.push(v);
  };
  // Hard breaks first: a line he typed on its own is a step he meant on its
  // own, whatever punctuation is in it.
  raw.split(/[\r\n]+/).forEach(line=>{
    if(!line.trim())return;
    // Sentence enders, then the joining words, both of which always split.
    line.split(/(?<=[.;!?])\s+|\s*;\s*/).forEach(sent=>{
      if(!sent||!sent.trim())return;
      sent.split(_TIMK_JOIN).forEach(part0=>{
        if(!part0||!part0.trim())return;
        // Bare "and", before the commas, because a dictated sentence often has
        // no commas in it at all and "and" is the only seam there is.
        const ands=String(part0).split(/\s+and\s+/i);
        const chunks=[];
        ands.forEach((a,i)=>{
          if(i===0){chunks.push(a);return;}
          if(_timkAndSplits(chunks[chunks.length-1],a))chunks.push(a);
          else chunks[chunks.length-1]=chunks[chunks.length-1]+' and '+a;
        });
        chunks.forEach(part=>{
        if(!part||!part.trim())return;
        // And only now the commas, and only where a new action starts.
        const bits=part.split(/,\s*/);
        let buf='';
        bits.forEach((bit,i)=>{
          if(i===0){buf=bit;return;}
          const next=bit.replace(/^and\s+/i,'');
          if(_timkNewAction(next)){push(buf);buf=next;}
          else buf=buf+', '+bit;
        });
        push(buf);
        });
      });
    });
  });
  return out;
}

// What the screen actually asks for: his steps, in work order, and the ones he
// did not say. One call so the two can never be built from different text.
// HIS ORDER, NOT TIM'S. The steps come back the way he said them, with the
// stage on each and a flag saying whether sorting would move anything.
//
// The first version sorted. On "tear out the old vanity, run new supply lines,
// set the new vanity and top, then caulk it and test everything" it put the
// caulk BEFORE the vanity went in, because 'caulk' reads as prep on a paint job
// and as the last thing on a vanity. Tim was wrong and the contractor was
// right, which is this file's own rule: a scope step invented by a contractor
// outranks a guess about where it belongs.
//
// A man dictating his day says it in the order he will work it. So the sort
// stays an offer (_geiPutScopeInOrder, one tap, already on the card) rather
// than something that happens to his words while he watches.
function timScopeBuild(text,opts){
  const said=String(text||'');
  const steps=timScopeFrom(said);
  const staged=timOrderScope(steps);
  const byText={};
  staged.forEach(r=>{if(byText[r.text]===undefined)byText[r.text]=r;});
  const mine=steps.map((t,i)=>{
    const r=byText[t]||{};
    return {text:t,stage:r.stage||null,stageName:r.stageName||null,was:i};
  });
  let implied=[];
  try{implied=timImplied(said,steps,opts)||[];}catch(_e){implied=[];}
  return {
    said,
    steps:mine,
    implied,
    // Would the sort actually change anything? If not, the card does not offer
    // it, which is the rule _geiScopeOutOfOrder already follows.
    outOfOrder:staged.some((r,i)=>r.text!==steps[i]),
  };
}

// ── WHAT STOPS A CREW AT THE KERB ────────────────────────────────────────────
//
// Owner, 2026-09-22: "how do we beautify the property note for dog access and
// things like that?"
//
// The note is one sentence a man types once per property, and it is read by
// somebody standing at a gate with a toolbox in one hand. A paragraph clamped
// to two lines is not readable in that posture. The facts in it are: what the
// code is, whether something is going to come round the corner at you, and
// where to leave the truck. Those three are literally what the field's own
// placeholder asks for.
//
// So this READS the sentence and never rewrites it. The chips are a reading;
// his words stay exactly as typed, one tap away in the editor and in full on
// the crew's screen. A wrong chip is worse than no chip, so every pattern here
// is narrow and anything ambiguous returns nothing.
//
// Pure and offline, like the rest of this file.

const _TIMK_CODEWORD=/\b(gate|lock ?box|lockbox|key ?pad|keypad|call ?box|alarm|door|combo|combination|code)\b/;
// Friendly is worth saying because it changes whether a man waits at the gate.
const _TIMK_DOG_OK=/\b(friendly|harmless|sweet|nice|old|lazy|wont bite|will not bite|does not bite|doesnt bite|good with)\b/;
const _TIMK_DOG_BAD=/\b(bites?|mean|aggressive|nasty|guard dog|do not pet|dont pet|careful|watch out|chain|chained)\b/;

function _timkTitle(w){
  const v=String(w||'').trim();
  return v?(v.charAt(0).toUpperCase()+v.slice(1)):v;
}

// The code, and WHICH code it is. "Gate 4417" tells him where to punch it in;
// a bare 4417 makes him try the front door first.
function _timkCode(n){
  // "code 4417 on the side gate", "gate code is 4417", "lockbox 1234"
  let m=n.match(/\b(gate|lock ?box|lockbox|key ?pad|keypad|call ?box|alarm|door|combo|combination|code)\b[^0-9]{0,16}?(\d{3,8})\b/);
  let word=m&&m[1],digits=m&&m[2];
  if(!m){
    // "4417 on the side gate", said the other way round.
    m=n.match(/\b(\d{3,8})\b[^0-9]{0,16}?\b(gate|lock ?box|lockbox|key ?pad|keypad|call ?box|alarm|door)\b/);
    if(m){digits=m[1];word=m[2];}
  }
  if(!digits)return null;
  // A bare "code" with a more specific word elsewhere in the sentence: prefer
  // the specific one, because that is the thing he walks up to.
  if(/^(code|combo|combination)$/.test(word)){
    const sp=n.match(/\b(gate|lock ?box|lockbox|key ?pad|keypad|call ?box|alarm|door)\b/);
    if(sp)word=sp[1];
  }
  const label=_timkTitle(String(word).replace(/\s+/g,'').replace('lockbox','Lockbox').replace('keypad','Keypad').replace('callbox','Call box'));
  return {k:'code',icon:'\ud83d\udd12',label:label+' '+digits};
}

function _timkDog(n){
  // "no dog" is a man answering the question, not a dog. A chip that warns
  // about an animal he explicitly said is not there is the exact failure this
  // whole function has to avoid, because it is the one a crew acts on.
  if(/\b(no|without|never any|there is no|theres no)\s+dogs?\b/.test(n))return null;
  if(!/\b(dogs?|pit ?bulls?|shepherds?|rottweilers?|dobermans?|puppy|puppies|k9)\b/.test(n))return null;
  // Careful outranks friendly: if both words are in there, the one that keeps
  // a man's hand out of the fence is the one to show.
  if(_TIMK_DOG_BAD.test(n))return {k:'dog',icon:'\u26a0',label:'Dog, careful'};
  if(_TIMK_DOG_OK.test(n))return {k:'dog',icon:'\u26a0',label:'Dog, friendly'};
  return {k:'dog',icon:'\u26a0',label:'Dog'};
}

function _timkPark(n){
  // Told NOT to first, because that is the one that gets a truck towed or a
  // driveway cracked, and it is usually said alongside where he SHOULD park.
  let m=n.match(/\b(?:do ?n[o']?t|dont|never|no|avoid)\s+park\w*\s+(?:in|on)\s+(?:the\s+)?(driveway|street|road|lawn|grass|alley|yard)\b/);
  if(m)return {k:'park',icon:'\ud83d\ude97',label:'Not the '+m[1]};
  if(/\bno parking\b/.test(n))return {k:'park',icon:'\ud83d\ude97',label:'No parking'};
  m=n.match(/\bpark\w*\s+(?:on|in|at|out)\s+(?:the\s+|in\s+)?(street|road|driveway|alley|back|front|lot|kerb|curb)\b/);
  // You park ON a street and IN an alley. Getting this wrong reads as a machine
  // wrote it, which is the whole thing being fixed here.
  if(m)return {k:'park',icon:'\ud83d\ude97',label:'Park '+(/^(street|road|kerb|curb)$/.test(m[1])?'on the ':'in the ')+m[1]};
  return null;
}

function _timkKey(n){
  const m=n.match(/\bkeys?\b[^.]{0,10}?\b(under|in|behind|above|beside|inside)\s+(?:the\s+)?([a-z]{3,14}(?:\s+[a-z]{3,10})?)/);
  if(!m)return null;
  return {k:'key',icon:'\ud83d\udd11',label:'Key '+m[1]+' the '+m[2]};
}

// The sentence, read. Order is the order a man meets them walking up: where to
// leave the truck, what is behind the gate, how to get in.
function timSiteFacts(text){
  const raw=String(text||'');
  if(!raw.trim())return [];
  const n=_timkNorm(raw);
  const out=[];
  [_timkPark,_timkDog,_timkCode,_timkKey].forEach(fn=>{
    let f=null;
    try{f=fn(n);}catch(_e){f=null;}
    if(f&&!out.some(x=>x.k===f.k))out.push(f);
  });
  return out;
}

// ── What a job drags in with it ──────────────────────────────────────────────
//
// The rules are deliberately few and deliberately hard. Each one has to pass
// the test the owner set: would a 55 year old master read this and think "oh
// yeah, I forgot that", or would it piss him off? Anything that could go either
// way is not in this list.
//
// `when` gets the whole sentence and the steps already on the job, and answers
// yes or no. `say` is the correction in his words, and `because` is the reason,
// which is always a thing he said or a thing on the job, never a rationale.
const TIM_IMPLIED=[
  {
    id:'access-scaffold',
    source:'trade',   // sequence and habit, never a code requirement
    stage:'access',
    step:'Set scaffold',
    say:'Scaffold goes up before anything is stripped',
    because:'You never said scaffold up first. It has to be.',
    hours:6,
    supply:{id:'scaffold',section:'rental',label:'Scaffold',unit:'d',qty:0},
    // Struck last of everything in the stage: whatever else has to come off the
    // wall is standing on it right up until it goes.
    pairs:{stage:'restore',step:'Strike scaffold',last:true},
    claims:/\b(scaffold|staging|second (floor|storey|story)|two (storey|story)|upstairs)\b/,
    when:(t,steps)=>_timSaysHigh(t)&&!_timAnyStep(steps,['scaffold','staging','lift','swing stage']),
  },
  {
    id:'protect-gutters',
    source:'trade',   // sequence and habit, never a code requirement
    stage:'protect',
    step:'Remove gutters',
    say:'Gutters off second, back on last',
    because:'Off first, back on last, the way you said',
    pairs:{stage:'restore',step:'Rehang gutters'},
    claims:/\bgutter/,
    // "Remove and reset gutters" is one price and two jobs. It stays one line on
    // the money and becomes two steps on the contract, because the second one
    // happens six days after the first and a crew reading it needs to know.
    when:(t,steps)=>/\bgutter/.test(_timkNorm(t))
      &&!(steps||[]).some(s=>/\bgutter/.test(_timkNorm(s&&s.text))&&timStageOf(s&&s.text)==='restore'),
  },
  {
    id:'prep-consumables',
    source:'trade',   // sequence and habit, never a code requirement
    stage:null,
    say:'Primer, masking, sandpaper',
    because:'You did not mention these. This work always needs them.',
    supply:{id:'prep-kit',section:'prep',label:'Primer, masking, sandpaper',unit:'items',qty:5},
    // The work triggers this, not the sentence. He never says "and primer", he
    // says "strip and repaint the west elevation", and the primer is in that.
    when:(t,steps)=>{
      const n=_timkNorm(t)+' '+(steps||[]).map(s=>_timkNorm(s&&s.text)).join(' ');
      return /\b(strip|repaint|paint|prime|bare wood|sand)/.test(n)&&!/\b(primer|masking|sandpaper)\b/.test(n);
    },
  },
  {
    id:'clean-haul',
    source:'trade',   // sequence and habit, never a code requirement
    stage:'clean',
    step:'Haul off debris and leave the site broom clean',
    say:'Haul off, last',
    because:'Every job you have sent ends this way.',
    when:(t,steps)=>_timAnyStep(steps,['tear out','tear off','strip','demo','replace'])
      &&!_timAnyStep(steps,['haul','clean','sweep','dumpster']),
  },
];

function _timSaysHigh(t){
  const n=_timkNorm(t);
  return /\b(second (floor|storey|story)|two (storey|story)|2nd (floor|storey|story)|upstairs|second level|gable|steep|high side|eave)\b/.test(n);
}
function _timAnyStep(steps,words){
  const all=(Array.isArray(steps)?steps:[]).map(s=>_timkNorm((s&&typeof s==='object')?(s.text||s.label||s.desc||''):s)).join(' ');
  return words.some(w=>all.indexOf(w)>=0);
}

// ── What the code book says, when there is one ───────────────────────────────
//
// A thin pass through to js/code-engine.js, and thin is the whole point: it
// adds no judgement, fills no gap and softens no refusal. Tim's part is
// knowing WHICH rule to ask about from what is on the job. The answer is the
// engine's, and so is the decision not to give one.
//
// The three ways this returns nothing, all of which are correct:
//   the contractor has not confirmed which edition his inspector enforces
//   the dataset has not been checked against the published book (`verified`)
//   the rule does not exist in that edition
//
// In every one of those, Tim says nothing about code. He does not fall back to
// a rule of thumb, because the whole reason the engine refuses is that a
// plausible wrong answer on a permit is worse than no answer, and a plausible
// wrong answer wearing Tim's face is worse still.
function timCode(family,ruleId,inputs,opts){
  if(typeof codeEval!=='function')return null;
  let r=null;
  try{r=codeEval(family,ruleId,inputs||{},opts||{});}catch(_e){return null;}
  if(!r||!r.ok)return null;
  return {
    source:'code',
    family:r.family,
    edition:r.edition,
    cite:r.cite,
    // Already in the shape the estimate adds lines in, and deliberately without
    // a price: his book prices it, the code book only says it is needed.
    items:(r.items||[]).map(i=>Object.assign({},i)),
    assumed:(r.assumed||[]).slice(),
    warnings:(r.warnings||[]).slice(),
    // What the screen prints so the contractor can tell this from Tim talking.
    heading:String(r.family||'').toUpperCase()+' '+r.edition,
  };
}

// What he did not say that the work needs. Nothing here is added to anything:
// it is a list to read and approve, and each entry says where it came from.
//
// `opts.rejected` is the set of rule ids he has already turned down on this job,
// so a nudge he waved off does not come back at him on the same proposal.
function timImplied(said,steps,opts){
  const o=opts||{};
  const no=new Set(Array.isArray(o.rejected)?o.rejected:[]);
  const out=[];
  TIM_IMPLIED.forEach(r=>{
    if(no.has(r.id))return;
    let hit=false;
    try{hit=!!r.when(said,steps||[]);}catch(_e){hit=false;}
    if(!hit)return;
    out.push({
      id:r.id,
      // Always 'trade'. A code requirement never comes from this table, it
      // comes from timCode, and the screen tells them apart on this field.
      source:r.source||'trade',
      stage:r.stage||null,
      step:r.step||null,
      say:r.say,
      because:r.because,
      hours:Number(r.hours)||0,
      supply:r.supply?Object.assign({},r.supply):null,
      pairs:r.pairs?Object.assign({},r.pairs):null,
      claims:r.claims||null,
    });
  });
  return out;
}

// ── Numbers, the way they get said ───────────────────────────────────────────
//
// "two hundred amp", "twenty eight squares", "a dozen twenty amp singles", "six
// forty fives". The spec numbers inside a part name are matched by the part
// itself below, so this only ever reads the COUNT sitting in front of one.
const _TIMK_ONES={zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,
  ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,
  eighteen:18,nineteen:19};
const _TIMK_TENS={twenty:20,thirty:30,forty:40,fourty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90};
const _TIMK_SCALE={hundred:100,thousand:1000};
// Words that count a thing rather than name a number, and what one of them is.
const _TIMK_PACK={dozen:12,pair:2,couple:2};
// Nouns a count is said in. They end a count and are carried on the line, so a
// line reads "2 rolls" the way he said it rather than a bare 2.
const _TIMK_NOUN=/^(rolls?|spools?|squares?|bundles?|boxe?s?|cases?|sticks?|sheets?|gallons?|gals?|feet|foot|ft|lengths?|pieces?|pcs?|each|ea|days?|hours?|hrs?)$/;

// A run of number words, left to right, the way it is spoken: "two hundred" is
// 200, "twenty eight" is 28, "twenty two and a half" is 22.5.
function timSpokenNumber(words){
  const w=(Array.isArray(words)?words:String(words||'').split(/\s+/)).filter(Boolean);
  if(!w.length)return null;
  let total=0,run=0,saw=false;
  for(const raw of w){
    const t=String(raw).toLowerCase().replace(/s$/,'').replace(/halve$/,'half');
    if(t==='and'||t==='a'||t==='an')continue;
    if(/^\d+(?:\.\d+)?$/.test(t)){run+=parseFloat(t);saw=true;continue;}
    if(_TIMK_ONES[t]!=null){run+=_TIMK_ONES[t];saw=true;continue;}
    if(_TIMK_TENS[t]!=null){run+=_TIMK_TENS[t];saw=true;continue;}
    if(_TIMK_PACK[t]!=null){run+=_TIMK_PACK[t];saw=true;continue;}
    if(t==='hundred'){run=(run||1)*100;saw=true;continue;}
    if(t==='thousand'){total+=(run||1)*1000;run=0;saw=true;continue;}
    if(t==='half'){run=(run||0)+0.5;saw=true;continue;}
    return saw?total+run:null;
  }
  return saw?total+run:null;
}

// Is this token a word for a number, and which kind? The kind is what lets one
// spoken run be told from two touching ones.
function _timNumKind(t){
  const w=String(t||'').toLowerCase();
  const stem=w.replace(/s$/,'').replace(/halve$/,'half');
  if(/^\d+(?:[-\/.]\d+)*$/.test(w))return 'digit';
  if(_TIMK_ONES[stem]!=null)return 'one';
  if(_TIMK_TENS[stem]!=null)return 'ten';
  if(_TIMK_SCALE[stem]!=null)return 'scale';
  if(_TIMK_PACK[stem]!=null)return 'pack';
  if(stem==='half'||stem==='quarter')return 'frac';
  return null;
}

// ── Two numbers touching ─────────────────────────────────────────────────────
//
// "six forty fives and four twenty two and a halfs" is a count and a part, said
// twice, with nothing between them. A single left-to-right adder reads it as 51
// and 26.5 and gets the whole line wrong.
//
// What tells them apart is that a well formed spoken number never puts a ones
// word in front of a tens word. "Six forty" cannot be one number, so it is two.
// Same for a ones word in front of another ones word, and for anything in front
// of a digit he already said as digits. Those three breaks are the entire rule,
// and they are why this reads trade speech without a model.
function timDigits(text){
  const words=String(text||'').split(/\s+/).filter(Boolean);
  const out=[];
  let run=[],runKinds=[];
  const flush=()=>{
    if(!run.length)return;
    const n=timSpokenNumber(run);
    const plural=/s$/.test(run[run.length-1])&&_timNumKind(run[run.length-1])!=='digit';
    out.push(n==null?run.join(' '):(String(n)+(plural?'s':'')));
    run=[];runKinds=[];
  };
  for(let i=0;i<words.length;i++){
    const w=words[i];
    const kind=_timNumKind(w);
    const last=runKinds[runKinds.length-1]||null;
    if(kind==null){
      // "and a half" keeps a run open. Any other "and" ends it, because it is
      // the word between two separate things far more often than inside one.
      if(w==='and'&&run.length&&_timNumKind(words[i+1]==='a'?words[i+2]:words[i+1])==='frac'){run.push(w);runKinds.push('join');continue;}
      if((w==='a'||w==='an')&&run.length&&last==='join'){run.push(w);runKinds.push('join');continue;}
      if((w==='a'||w==='an')&&!run.length&&_TIMK_NOUN.test(String(words[i+1]||''))){run.push('one');runKinds.push('one');continue;}
      flush();out.push(w);continue;
    }
    if(run.length){
      const breaks=(kind==='digit')
        ||(last==='one'&&(kind==='ten'||kind==='one'))
        ||(last==='frac'&&kind!=='frac')
        ||(last==='pack'&&kind!=='scale');
      if(breaks)flush();
    }
    run.push(w);runKinds.push(kind);
  }
  flush();
  return out.join(' ');
}

// The count in front of a part, plus the word he counted it in. Reads backwards
// from the part so "2 rolls of 12-2" and "80 foot of 3 inch" both land, and
// stops at the first word that is not part of a count.
function _timQtyBefore(text,at){
  const head=String(text||'').slice(0,at).trim();
  if(!head)return {n:null,said:null};
  const words=head.split(/\s+/);
  let said=null,i=words.length-1;
  if(words[i]==='of')i--;
  if(i>=0&&_TIMK_NOUN.test(words[i])){
    said=words[i];i--;
    if(i>=0&&words[i]==='of')i--;
  }
  if(i<0)return {n:null,said:said};
  // timDigits already collapsed a spoken run to one token, so the count is that
  // one token and nothing before it. Reading further back would eat the spec
  // number off the part in front of this one.
  const t=words[i];
  if(!/^\d+(?:\.\d+)?$/.test(t))return {n:null,said:said};
  const n=parseFloat(t);
  return {n:isNaN(n)?null:n,said:said||null};
}

// ── What a tradesman calls things ────────────────────────────────────────────
//
// Every unit here comes out of `_UNITS_BY_TRADE` / `_UNITS_EXTRA` in
// js/generic-estimate.js. Tim does not get to invent a unit: a roll is a roll
// because the app already prices in rolls, and a square is a square because
// roofing already does.
//
// `per` is what one of that unit contains, and it is what makes the coverage
// check below possible. A 250 ft roll of romex, three bundles to a square, ten
// squares on a roll of synthetic, a hundred boxes to a box of boxes.
//
// THESE ARE PACKAGING FACTS, NOT CODE VALUES, and the difference matters enough
// to say out loud. How much wire is on a roll is what the supply house sells;
// what size wire the circuit needs is NEC 310, lives in codes/nec-2023.json,
// and reaches a screen only through `timCode`. Nothing in this table is ever
// the answer to a code question, nobody should ever mark it verified, and a
// change here has no bearing on a permit.
const TIM_ROMEX=['14-2','14-3','12-2','12-3','10-2','10-3','8-3','8-2','6-3','6-2','4-3','2-3'];

const TIM_MATERIALS=[
  {
    id:'romex',section:'wire',unit:'roll',per:250,
    re:new RegExp('\\b('+TIM_ROMEX.join('|').replace(/-/g,'[-\\s]?')+')\\b'),
    label:m=>m[1].replace(/\s/,'-')+' NM-B romex',
    detail:m=>{
      const g=m[1].replace(/\s/,'-');
      if(g==='12-2')return 'Yellow jacket';
      if(g==='14-2')return 'White jacket';
      if(g==='14-3')return 'White jacket, three wire';
      if(g==='6-3')return 'For the range circuit';
      return null;
    },
    per_for:m=>/^(6|4|2)-/.test(m[1].replace(/\s/,'-'))?125:250,
  },
  {id:'panel',section:'panel',unit:'ea',per:1,
    re:/\b(?:(\d{2,3})\s*(?:a|amp|amps)\s*)?(?:main\s+(?:lug|breaker)\s+)?panel\b/,
    label:m=>(m[1]?m[1]+' A ':'')+'main lug panel',
    detail:(m,t)=>{const s=t.match(/\b(\d{2,3})\s*space\b/);return s?s[1]+' space':null;}},
  {id:'breaker',section:'panel',unit:'ea',per:1,
    re:/\b(\d{2,3})\s*(?:a|amp|amps)\s*(?:single\s*poles?|singles?|breakers?|1\s*pole)\b/,
    label:m=>m[1]+' A single pole breaker'},
  {id:'breaker2',section:'panel',unit:'ea',per:1,
    re:/\b(\d{2,3})\s*(?:a|amp|amps)\s*(?:double\s*poles?|doubles?|2\s*pole)\b/,
    label:m=>m[1]+' A double pole breaker'},
  // "Box of single gangs" and "single gang boxes" are the same thing said two
  // ways, and he says the first one at a counter.
  {id:'box',section:'boxes',unit:'box',per:100,
    re:/\b(?:single\s*gangs?|1\s*gangs?|old\s*works?|nail[-\s]?ons?)(?:\s*boxe?s?)?\b/,
    label:()=>'Single gang nail-on box',detail:()=>'Box of 100'},
  {id:'staple',section:'boxes',unit:'box',per:1,
    re:/\b(?:cable\s*)?staples?\b/,label:()=>'Cable staples, 1 in'},
  {id:'wye',section:'dwv',unit:'ea',per:1,
    re:/\b(?:(\d(?:\.\d)?)\s*(?:in|inch)\s*)?(?:pvc\s*)?wyes?\b/,
    label:m=>(m[1]?m[1]+' in ':'4 in ')+'PVC wye'},
  // "six forty fives" is six of them, not the number 645. timDigits has already
  // turned the part into 45s by then, and the trailing s is what proves it is a
  // part being counted rather than a count of something else.
  {id:'fitting-deg',section:'dwv',unit:'ea',per:1,
    re:/\b(45|22\.5|90|60)s\b|\b(45|22\.5|90|60)\s*(?:degree|degrees|deg)\b/,
    label:(m,t)=>{
      const deg=m[1]||m[2];
      const sz=(t.match(/\b(\d(?:\.\d)?)\s*(?:in|inch)\b/)||[])[1];
      return (sz?sz+' in ':'4 in ')+'PVC wye, '+deg+' degree';
    }},
  // A bare "80 foot of 3 inch" is pipe, but only in a sentence that is already
  // about drains. Outside one it is a dimension and Tim leaves it alone, which
  // is why the cue word is required rather than assumed.
  {id:'pvc',section:'dwv',unit:'lin ft',per:10,
    re:/\b(\d(?:\.\d)?)\s*(?:in|inch)\s*(?:schedule\s*40\s*)?(?:pvc|abs|pipe)\b/,
    label:m=>m[1]+' in schedule 40 PVC'},
  {id:'pvc-bare',section:'dwv',unit:'lin ft',per:10,
    re:/\b(\d(?:\.\d)?)\s*(?:in|inch)\b(?!\s*(?:wye|pvc|pipe|abs|panel))/,
    needs:/\b(?:wyes?|pvc|abs|dwv|drains?|sewer|vents?|schedule\s*40)\b/,
    label:m=>m[1]+' in schedule 40 PVC'},
  // "Twenty eight squares of architectural" never says the word shingle. In
  // roofing, a square OF something is that something, and architectural means
  // one thing only.
  {id:'shingle',section:'roof',unit:'square',per:3,
    re:/\b(?:architectural|three[-\s]?tab|3[-\s]?tab|dimensional)(?:\s*shingles?)?\b|\bshingles?\b/,
    label:(m)=>(/tab/.test(m[0])?'Three tab':'Architectural')+' shingles'},
  {id:'underlay',section:'roof',unit:'roll',per:10,
    re:/\b(?:synthetic|felt|underlayment)\b/,
    label:m=>(/felt/.test(m[0])?'Felt':'Synthetic')+' underlayment',detail:()=>'10 sq rolls'},
  {id:'paint',section:'paint',unit:'gal',per:1,
    re:/\b(duration|emerald|superpaint|resilience|aura|regal|behr|valspar|sherwin|exterior paint|interior paint|paint)\b/,
    label:(m,t)=>{
      const nm=m[1]==='paint'?'Exterior paint':(m[1].charAt(0).toUpperCase()+m[1].slice(1));
      // The colour is whatever he said after "in", up to the next thing he
      // started. Two words at most, because a colour name is Iron Ore or Alabaster
      // and never a sentence.
      const col=t.slice(m.index).match(/\bin\s+([a-z]+(?:\s+[a-z]+)?)(?=\s+(?:and|with|plus|then)\b|\s*$)/);
      return nm+(m[1]==='paint'?'':' exterior')+(col?', '+col[1].replace(/\b\w/g,c=>c.toUpperCase()):'');
    }},
  {id:'caulk',section:'prep',unit:'ea',per:1,
    re:/\bcaulk(?:ing)?\b/,label:()=>'Exterior caulk'},
  {id:'primer',section:'prep',unit:'gal',per:1,
    re:/\bprimer\b/,label:()=>'Primer'},
  {id:'drop',section:'tools',unit:'ea',per:1,
    re:/\bdrop\s*cloths?\b|\bplastic\b/,label:()=>'Drop cloths, plastic'},
  {id:'scaffold',section:'rental',unit:'d',per:1,
    re:/\bscaffold(?:ing)?\b/,label:()=>'Scaffold'},
];

// The four categories the Supply List already ships (js/bids.js `sections`),
// plus five per-trade heads for the trades that do not paint. The painting four
// keep their exact ids, labels and colors so a supply list built here and one
// built there are the same screen.
const TIM_SUPPLY_SECTIONS=[
  {id:'paint', label:'Paint',            color:'#1a365d',bg:'#EBF2FB',trade:'painting',  shipped:true},
  {id:'prep',  label:'Prep supplies',    color:'#854F0B',bg:'#FFF7ED',trade:'painting',  shipped:true},
  {id:'tools', label:'Tools & protection',color:'#2d6a4f',bg:'#F0FBF4',trade:'painting', shipped:true},
  {id:'rental',label:'Rentals',          color:'#5B21B6',bg:'#F5F3FF',trade:'painting',  shipped:true},
  {id:'wire',  label:'Wire & cable',     color:'#1B3F7A',bg:'#EBF2FB',trade:'electrical',shipped:false},
  {id:'panel', label:'Panels & breakers',color:'#854F0B',bg:'#FFF7ED',trade:'electrical',shipped:false},
  {id:'boxes', label:'Boxes & fittings', color:'#2d6a4f',bg:'#F0FBF4',trade:'electrical',shipped:false},
  {id:'dwv',   label:'Drain, waste, vent',color:'#5B21B6',bg:'#F5F3FF',trade:'plumbing', shipped:false},
  {id:'roof',  label:'Roof',             color:'#7E1B14',bg:'#FDF1EF',trade:'roofing',   shipped:false},
];
function timSupplySection(id){
  return TIM_SUPPLY_SECTIONS.find(s=>s.id===id)||TIM_SUPPLY_SECTIONS[2];
}
// How many trades are on this list. A rough in that pulls wire, drain pipe and
// shingle is three trades in five sections, and three is the number he checks
// against, because it is the number of supply houses he is about to stand in.
function timTradesOn(items){
  return [...new Set((Array.isArray(items)?items:[]).map(r=>timSupplySection(r&&r.section).trade))];
}

// A materials prompt, taken in trade language and written out in real units.
//
// Typed or spoken, it is the same string, so there is one path to test. What
// comes back is a list of lines, each with the count he said, the unit the app
// already prices in, and the section it belongs to. No price is invented here:
// `rate` is filled from his own book by the caller, and a line with no price
// says so on the screen rather than carrying a number Tim made up.
function timMaterials(text,opts){
  const o=opts||{};
  const raw=timDigits(_timkNorm(text));
  const out=[];
  const taken=[];   // char ranges already claimed, so one phrase is one line
  const claims=(a,b)=>taken.some(r=>a<r[1]&&b>r[0]);

  TIM_MATERIALS.forEach(m=>{
    if(m.needs&&!m.needs.test(raw))return;
    const re=new RegExp(m.re.source,'g'+(m.re.flags.replace(/g/g,'')));
    let hit;
    while((hit=re.exec(raw))!==null){
      if(hit[0].trim()===''){re.lastIndex++;continue;}
      const a=hit.index,b=hit.index+hit[0].length;
      if(claims(a,b))continue;
      taken.push([a,b]);
      const q=_timQtyBefore(raw,a);
      const per=(typeof m.per_for==='function')?m.per_for(hit):m.per;
      let label,detail=null;
      try{label=(typeof m.label==='function')?m.label(hit,raw):String(m.label||m.id);}catch(_e){label=m.id;}
      try{detail=(typeof m.detail==='function')?m.detail(hit,raw):(m.detail||null);}catch(_e){detail=null;}
      out.push({
        id:m.id,
        label:label,
        detail:detail,
        qty:q.n!=null?q.n:1,
        counted:q.n!=null,   // did he actually say how many, or is this the default of one
        unit:m.unit,
        per:per,
        said:q.said,
        at:a,
        heard:hit[0].trim(),
        section:m.section,
        rate:0,
      });
    }
  });
  // "Four inch wyes, six forty fives and four twenty two and a halfs" names the
  // size once and then counts two parts in it. The bare wye in front is the
  // size, not an eleventh fitting, so it goes when the degrees turn up and he
  // never said how many plain ones he wanted.
  const degs=out.some(r=>r.id==='fitting-deg');
  const kept=out.filter(r=>!(degs&&r.id==='wye'&&!r.counted));
  // Said first, read first: a list read back in the order he said it is a list
  // he can check against his own memory of saying it.
  kept.sort((a,b)=>a.at-b.at);
  kept.forEach(r=>{delete r.at;});
  return kept;
}

// ── What a count actually buys ───────────────────────────────────────────────
//
// The figure column and the small print under it. A square is not a thing you
// can put in a truck, so the roof line reads 84 bundles with "28 squares at 3
// bundles" under it, and 80 lin ft of pipe reads as the eight sticks he will
// carry out of the store. Same number, said the way the counter says it.
function timLineFigures(item){
  const r=item||{};
  const q=Number(r.qty)||0;
  const per=Number(r.per)||1;
  const plural=(n,w)=>n+' '+w+(n===1?'':'s');
  if(r.id==='shingle')return {qtyLabel:plural(Math.ceil(q*per),'bundle'),packNote:q+' square'+(q===1?'':'s')+' at '+per+' bundles'};
  if(r.id==='romex')return {qtyLabel:plural(q,'roll'),packNote:per+' ft'};
  if(r.id==='pvc'||r.id==='pvc-bare'){
    const sticks=Math.ceil(q/per);
    return {qtyLabel:q+' lin ft',packNote:_timWordish(sticks)+' '+per+' ft length'+(sticks===1?'':'s')};
  }
  if(r.id==='box')return {qtyLabel:plural(q,'box'),packNote:'of '+per};
  if(r.id==='staple')return {qtyLabel:plural(q,'box'),packNote:null};
  if(r.unit==='d')return {qtyLabel:q+' d',packNote:null};
  if(r.said)return {qtyLabel:q+' '+r.said,packNote:null};
  if(r.unit==='ea')return {qtyLabel:String(q),packNote:null};
  return {qtyLabel:q+' '+r.unit,packNote:null};
}
const _TIMK_WORDS=['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve'];
function _timWordish(n){return (n>=0&&n<=12&&n===Math.floor(n))?(_TIMK_WORDS[n].charAt(0).toUpperCase()+_TIMK_WORDS[n].slice(1)):String(n);}

// Money the way this app's own design system says to write it: whole dollars,
// because cents on a figure he is glancing at are two characters of noise. The
// exception is a rate that IS cents, like $0.78 a square foot, where dropping
// them would print $1 and be wrong rather than merely untidy.
//
// Deliberately not `fmt`, which always prints cents. Full dollars and cents
// belong on the proposal and the tax documents, where precision is a legal
// matter, and nothing Tim renders is either of those.
function timPrice(n){
  const v=Number(n)||0;
  return (v!==0&&Math.abs(v)<10)
    ? ('$'+(Math.round(v*100)/100).toFixed(2))
    : ('$'+Math.round(v).toLocaleString('en-US'));
}

// ── Where his own numbers disagree ───────────────────────────────────────────
//
// Rule 2 of the header, made concrete. Six rolls of synthetic covers 60 squares
// against his 28. Tim says both figures out loud and changes neither, because a
// man who finds the app quietly editing his counts stops reading the list, and
// an unread list is worse than no list.
//
// Arithmetic that only restates a count is not a disagreement and does not
// belong here. It goes under the line in `timLineFigures`, where it is read once
// and never has to be dismissed.
function timCoverage(items){
  const rows=Array.isArray(items)?items:[];
  const find=id=>rows.find(r=>r&&r.id===id);
  const notes=[];
  const sh=find('shingle'),un=find('underlay');
  if(sh&&sh.qty>0&&un&&un.qty>0){
    const covers=un.qty*(un.per||10);
    if(covers!==sh.qty){
      notes.push({
        id:'underlay-short',
        line:_timWordish(sh.qty)+' squares needs '+Math.ceil(sh.qty*(sh.per||3))+' bundles and you said '+
             _timWordish(un.qty).toLowerCase()+' roll'+(un.qty===1?'':'s')+', which covers '+covers+
             ' squares. I left it as you said it.',
        figure:covers+' sq',
      });
    }
  }
  return notes;
}

// ── What he accepted, so it stops being a guess ──────────────────────────────
//
// The whole of the learning, and it is deliberately small. Tim keeps a count per
// thing he offered and whether it was taken. Nothing he inferred is offered back
// as settled until it has been accepted twice, which is `_pbLearn`'s n:1 rule
// applied to knowledge instead of price: one acceptance is a contractor being
// agreeable on a Tuesday, two is a habit.
//
// It lives on S so it rides the same save, sync and account-switch path as every
// other setting, rather than a one-off localStorage key that misses the sweep.
function _timStore(){
  if(typeof S==='undefined'||!S)return null;
  if(!S.timLearned||typeof S.timLearned!=='object')S.timLearned={};
  return S.timLearned;
}
function timLearn(kind,key,accepted){
  const st=_timStore();
  if(!st)return null;
  const k=String(kind||'')+':'+String(key||'');
  if(k===':')return null;
  const row=st[k]||(st[k]={yes:0,no:0});
  if(accepted)row.yes=(row.yes||0)+1;else row.no=(row.no||0)+1;
  if(typeof _settingsChanged==='function')_settingsChanged();
  return row;
}
// Settled: taken twice and not turned down more often than it was taken.
function timKnows(kind,key){
  const st=_timStore();
  if(!st)return false;
  const row=st[String(kind||'')+':'+String(key||'')];
  if(!row)return false;
  return (row.yes||0)>=2&&(row.yes||0)>(row.no||0);
}
// Dropped: turned down twice, so he stops offering it. The screen's own
// per-job "not this one" is separate and shorter lived, this one is forever.
function timDropped(kind,key){
  const st=_timStore();
  if(!st)return false;
  const row=st[String(kind||'')+':'+String(key||'')];
  return !!row&&(row.no||0)>=2&&(row.no||0)>(row.yes||0);
}

// ── Finding the line in his own book ─────────────────────────────────────────
//
// `spkServices` asks for half the words in a service name to be said out loud.
// That is the right bar for a sentence that names the work ("water heater
// replacement" against "Replace 40 gal water heater"), and the wrong one for a
// sentence that describes a job the way a man talks on a driveway: "gutters
// come off first and go back after" is plainly "Remove and reset gutters" and
// scores 0.33 on a word count.
//
// So Tim weighs the words instead of counting them, and he weighs them against
// HIS book. A word in one line out of thirty eight is the word that identifies
// that line; a word in nineteen of them identifies nothing. That weighting is
// the only thing here that is learned rather than written, and it is learned
// from the book he filled, which is the point.
//
// Everything this returns is a suggestion with his own price on it, shown under
// a heading that says where it came from, and nothing lands on a proposal until
// he presses the button. A generous match he can see and reject beats a strict
// one that leaves him typing.
const _TIMK_STOP=new Set(['the','a','an','and','or','of','to','for','with','on','in','at','is','it',
  'per','each','all','any','new','old','job','work','site','area','as','by','from','into','out','up',
  'down','off','over','under','this','that','then','than','not','no','you','your','my','we','our']);
function _timWords(s){
  return _timkNorm(s).split(' ').map(w=>w.replace(/s$/,'')).filter(w=>w.length>2&&!_TIMK_STOP.has(w));
}
function timBookLines(said,book,catalog){
  const rows=(Array.isArray(book)&&book.length)?book.map(b=>({desc:b&&b.desc,rate:Number(b&&b.rate)||0,unit:(b&&b.unit)||'ea',from:'book'}))
    :(Array.isArray(catalog)?catalog:[]).map(j=>({desc:j&&j.name,rate:Math.round((j&&j.labor||0)+(j&&j.mat||0)),unit:'ea',from:'catalog'}));
  const lines=rows.filter(r=>r.desc);
  if(!lines.length)return [];
  const words=lines.map(r=>new Set(_timWords(r.desc)));
  // How many of his lines carry each word. One is a fingerprint, twenty is
  // punctuation.
  const df={};
  words.forEach(set=>set.forEach(w=>{df[w]=(df[w]||0)+1;}));
  const heard=new Set(_timWords(said));
  if(!heard.size)return [];
  const out=[];
  lines.forEach((r,i)=>{
    let total=0,got=0,best=0;
    words[i].forEach(w=>{
      const weight=1/(df[w]||1);
      total+=weight;
      if(heard.has(w)){got+=weight;if(weight>best)best=weight;}
    });
    if(!total||!got)return;
    const share=got/total;
    // Either he said most of the line, or he said the one word that can only
    // mean this line. A word in more than a quarter of his book is never that
    // word, however much of the line it happens to be.
    const fingerprint=best>=1/Math.max(1,Math.ceil(lines.length*0.25));
    if(share>=0.5||fingerprint)out.push(Object.assign({score:share,fingerprint},r));
  });
  return out.sort((a,b)=>b.score-a.score).slice(0,4);
}

// ── The whole spoken job, resolved ───────────────────────────────────────────
//
// One call, so the screen has one thing to render and the tests have one thing
// to assert. Everything in it came from either his sentence, his price book, or
// the two tables above, and the result says which for every line.
function timReadJob(said,opts){
  const o=opts||{};
  const plan=(typeof spkParse==='function')
    ? spkParse(said,{clients:o.clients,book:o.book,catalog:o.catalog})
    : {text:String(said||''),type:null,hours:0,client:null,services:[],actionable:false};

  // THE SCOPE COMES OFF HIS BOOK FIRST. Those are his words and his prices, and
  // a line matched against them reads like something he wrote, because he did.
  // The supply list is worked out FIRST, because it decides what the book lines
  // are allowed to be. `_pbLearn` fills one book from both services and
  // material categories, so "Scaffold" and "Duration exterior, Iron Ore" sit in
  // it next to "Strip and repaint". Without this, a sentence mentioning paint
  // puts a tin of paint in the scope of work as something the crew DOES, and
  // worse, a book line called Scaffold makes Tim think the job already has
  // scaffold on it and swallow the correction that is the whole point.
  //
  // The same words cannot be both a thing he is buying and a thing he is doing,
  // and the materials parser is the more specific signal, so it wins.
  const matsFirst=timMaterials(said,{trade:o.trade});
  const matKeys=new Set(matsFirst.map(m=>(typeof _pbKey==='function')?_pbKey(m.label):String(m.label).toLowerCase()));
  const fromBook=timBookLines(said,o.book,o.catalog)
    .filter(s=>!matKeys.has((typeof _pbKey==='function')?_pbKey(s.desc):String(s.desc).toLowerCase()))
    .map(s=>({
    text:s.desc,rate:s.rate,unit:s.unit,from:s.from,
    // What the screen prints under the line, in his words, never a score.
    why:s.from==='book'
      ?'Your price, from the last five of these'
      :'Not in your book yet, so this is the going rate',
  }));
  const steps=fromBook.map(s=>({text:s.text,from:s.from,rate:s.rate}));

  // The rules see the scope he has, not the sentence he said, which is the
  // difference the scaffold line turns on: he can say "second floor, so
  // scaffold" in passing and still have no scaffold step on the contract, and
  // that gap is the whole correction.
  const implied=timImplied(said,steps,{rejected:o.rejected})
    .filter(r=>!timDropped('implied',r.id));

  // Anything left in his sentence that describes work and no rule and no book
  // line has already taken. Kept in his words: Tim orders a scope, he does not
  // rewrite one.
  const claimed=implied.map(r=>r.claims).filter(Boolean);
  const spoken=String(said||'')
    .split(/[.;]|\bthen\b/i)
    .map(s=>s.trim().replace(/^(?:and|so|also|plus)\s+/i,'').replace(/[,\s]+$/,''))
    .filter(s=>{
      if(s.length<6)return false;
      const hit=timStageHit(s);
      if(!hit)return false;
      const n=_timkNorm(s);
      if(claimed.some(re=>re.test(n)))return false;
      // A clause that is nothing but a shopping list is a supply line, not a
      // step, and it is already on the supply list below. The tell is that the
      // only work word in it is the name of one of the supplies: "a case of
      // caulk" reads as prep because caulk is prep, but he is buying it, not
      // doing it.
      const mats=timMaterials(s);
      if(mats.some(m=>_timkNorm(m.heard).indexOf(hit.phrase)>=0||hit.phrase.indexOf(_timkNorm(m.heard).trim())>=0))return false;
      if(steps.some(st=>_timkNorm(st.text).indexOf(n.trim())>=0))return false;
      return true;
    })
    .map(s=>s.charAt(0).toUpperCase()+s.slice(1));

  // A rule that claims a line takes it off the ORDER and leaves it on the
  // money. One "Remove and reset gutters" at $340 is still one line he charges
  // for, it is just not one thing the crew does.
  const withImplied=steps
    .filter(s=>!claimed.some(re=>re.test(_timkNorm(s.text))))
    .concat(spoken.map(t=>({text:t})));
  implied.forEach(r=>{
    if(r.step)withImplied.push({text:r.step,stage:r.stage,_tim:r.id});
    if(r.pairs&&r.pairs.step)withImplied.push({text:r.pairs.step,stage:r.pairs.stage,last:!!r.pairs.last,_tim:r.id});
  });

  const materials=matsFirst;
  // A rental is priced in days, and the days are the job's, not a guess. Three
  // days of work is three days of scaffold on the yard ticket.
  const jobDays=Math.max(1,Math.ceil((Number(plan.hours)||0)/8));
  implied.forEach(r=>{
    if(!r.supply)return;
    const have=materials.find(m=>m.id===r.supply.id);
    const qty=r.supply.unit==='d'?jobDays:(Number(r.supply.qty)||1);
    if(have){if(have.unit==='d'&&!have.counted)have.qty=qty;have.detail=have.detail||r.because;have._tim=r.id;return;}
    materials.push(Object.assign({per:1,rate:0,counted:false,detail:r.because,_tim:r.id},r.supply,{qty}));
  });

  // WHAT THE SUPPLIES COST, FROM HIS BOOK, OR NOTHING AT ALL.
  //
  // A supply line he has bought before is already in the price book at what he
  // paid, and reading it back is free. A line he has never bought gets no
  // figure: the screen shows a blank and the total says how many are missing,
  // because a made up materials price is the one number on this panel he has no
  // way to check.
  materials.forEach(m=>{
    if(Number(m.rate)>0)return;
    const hit=(typeof _pbFind==='function')?_pbFind(m.label,o.trade):null;
    const unit=Number(hit&&hit.rate)||0;
    if(unit>0)m.rate=Math.round(unit*(Number(m.qty)||1));
  });
  const priced=materials.filter(m=>Number(m.rate)>0);

  const hours=(Number(plan.hours)||0)+implied.reduce((s,r)=>s+(Number(r.hours)||0),0);

  return {
    text:String(said||''),
    plan,
    client:plan.client||null,
    type:plan.type||null,
    fromBook,
    order:timOrderScope(withImplied),
    implied,
    materials,
    coverage:timCoverage(materials),
    // What the supplies come to, and how many of them he has no price for yet.
    // Both, always, so a total is never read as covering the whole list.
    suppliesCost:priced.reduce((s,m)=>s+Number(m.rate),0),
    suppliesPriced:priced.length,
    suppliesUnpriced:materials.length-priced.length,
    hours,
    saidHours:Number(plan.hours)||0,
    addedHours:hours-(Number(plan.hours)||0),
  };
}
