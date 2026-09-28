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
  {k:'access', n:'Access and staging', say:['deliver the','acclimate','scaffold','staging','stage the','ladder','lift','boom lift','scissor lift','swing stage','set up','mobilize','permit','pull a permit','shut the water off','kill the power','lock out']},
  {k:'protect',n:'Protect and remove',  say:['recover the refrigerant','move the furniture','tarp','hang plastic','mask off','mask','masking','drop cloth','cover','protect','plastic off','move furniture','remove gutters','pull the gutters','take the gutters','remove shutters','remove fixtures','take down','pull the trim','disconnect']},
  // 'pull the old', 'take out', 'swap out' and the rest added 2026-09-23: this
  // list was a painter's, so a water heater coming out of a basement was a step
  // with no stage, and a step with no stage cannot be put in order.
  {k:'demo',   n:'Tear out',            say:['tear out','tear off','demo','demolition','strip','stripping','scrape','grind','cut out','rip out','haul the old','remove the old','dispose of the old','pull the old','pull out the old','take out the old','take out','swap out','change out','get rid of','disconnect the old']},
  {k:'rough',  n:'Rough in',            say:['rough in','rough-in','run wire','pull wire','run romex','run pipe','run conduit','set the panel','stub','dig','trench','frame','excavate','underground','run new','run pex','run copper','run gas','run the line','run a new',
    // Tim's own gas line step (install-gas-size) reads as rough-in, not as
    // whatever came before it: it printed under "Protecting your home".
    'check the gas line','upsize the gas','gas line']},
  {k:'repair', n:'Repair',              say:['confirm the leak','framing is dry','replace rotted','rotted','repair','patch','fill','sister','re-sheath','resheath','replace siding','replace trim','replace boards','board for board','wood repair','drywall repair']},
  {k:'prep',   n:'Prep',                say:['prep','pressure wash','power wash','wash','sand','sanding','caulk','prime','primer','tape','etch','skim','feather','clean the surface']},
  {k:'install',n:'Install',             say:['dry in','underlayment','drip edge','install','hang','set the','mount','lay','tie in','terminate','trim out','make up','connect','shingle','roof it','set fixtures','set a','set new','set up the new','put in','putting in','put in a','swap in',
    // The unit's hook-ups go in with the unit, after it is set, not with the
    // rough-in ("run new venting" was matching "run new").
    'new venting','venting for','condensate drain']},
  {k:'finish', n:'Finish',              say:['start up the','pressure test','pull a vacuum','test every','label the panel','finish coat','two coats','top coat','topcoat','paint','spray','roll','stain','seal','grout','polish','touch up','touch-up']},
  {k:'restore',n:'Put back',            say:['rehang','re-hang','put back','reinstall','re-install','reset the gutters','rehang gutters','replace fixtures','remount','strike the scaffold','strike scaffold','take the scaffold down']},
  {k:'clean',  n:'Clean up',            say:['final inspection','walk it with','haul off','haul away','clean up','cleanup','broom clean','sweep','magnet','dumpster out','final walk','walk through','walkthrough','leave the site']},
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
  // A plumber's day, said out loud (the Earl audit, 2026-09-27).
  'snake','clear','flush','light','jet','rod','auger','rebuild','camera',
  // The trade corpus (2026-09-28): 240 job walks across eight trades, and the
  // verbs they used that were missing. Every one of these opened a step that
  // got glued onto the one before it.
  'reroof','reflash','reshingle','repitch','reglaze','repoint','restain','retexture','rewire','reroute',
  'resecure','reseal','refinish','resurface','rehang','reprogram','reconnect','recharge','recover','relocate',
  'label','record','braze','evacuate','weigh','bond','knock','sweat','thaw','core','find','locate','mark',
  'fish','pigtail','land','abandon','bump','separate','coordinate','schedule','file','wrap','raise','thin',
  'chip','line','wait','rototill','till','aerate','overseed','seed','sod','mow','edge','blow','trim','shape',
  'plant','mulch','water','fertilize','spread','lay','excavate','dig','haul','degrease','scuff','skim','steam',
  'spray','cut','hang','tape','mud','texture','float','frame','glue','nail','screw','bolt','anchor','shore',
  'jack','set','tile','grout','regrout','recaulk','caulk','seal','stain','varnish','sand','buff','clean',
  'wash','pressurewash','replace','swap','upgrade','convert','extend','cap','plug','patch','repair','fix',
  'test','inspect','check','verify','commission','program','pair','mount','hook','wire','run','pull','feed',
  'fill','flash','shim','level','adjust','tighten','lube','lubricate','oil','grease','deliver','assemble',
  'build','install','demo','dispose','vent','insulate','drywall','prime','paint','roll','brush','backroll',
  'hydro','jet','scope','dispatch','permit','dumpster','reset','reinstall','restore','protect','cover',
  'load','empty','pump','vacuum','sweep','bag','tarp','secure','strap','support','hang','weatherstrip',
  'reframe','sister','square','plumb','set','stub','cap','bleed','purge','charge','start','startup',
  'let','bury','amend','topdress','match','weed','dethatch','overseed','hand','touch','cleanup',
  // The holdout walks (2026-09-28).
  'reattach','mudjack','undercut','shingle','form','epoxy','carpet','stamp','repoint','reface','resod','reglue',
  'resecure','refasten','renail','rescreen','rekey','reline','resand','recoat','retile','regrade','dig',
  'give','release','slope','hand','overseed','weedeat','follow','trace','plane',
  'dowel','screen','foam','selflevel','sawcut','rekey','add','use',
]);

// What a man says before he gets to the work, which is not the work. "Okay so
// we're going to" is throat clearing and does not belong in a numbered step a
// homeowner reads.
const _TIMK_FILLER=/^(?:first\s+thing\s+(?:we're\s+gonna\s+do|we'll\s+do|we\s+do|to\s+do)\s+is|what\s+we're\s+gonna\s+do\s+is|ok(?:ay)?|so|well(?=[,\s]+(?:so|we|i|okay|ok|um|uh|then|now|let's|yeah|you|first|basically)\b|,)|um+|uh+|right|alright|and|but|first(?:ly)?|then|next|after\s+that|afterwards?|finally|lastly|also|plus|basically|obviously|yeah|yep|oh|like|anyway|first\s+thing\s+(?:we're\s+gonna\s+do|we'll\s+do|we\s+do|to\s+do)\s+is|what\s+we're\s+gonna\s+do\s+is|the\s+plan\s+is(?:\s+to)?|while\s+(?:we're|we\s+are|i'm|we're\s+out)\s+(?:here|there|at\s+it|in\s+there))\b[\s,]*/i;
const _TIMK_SUBJECT=/^(?:(?:i|we|they|you)(?:\s*(?:'|’)?(?:re|m|ll|ve|d))?|im|ive|were|weve|well(?=\s+(?:gonna|going|need|have|be|just|also|then|do|put|pull|run|install|replace|add|take|get|set|hang)\b))\s+(?:are\s+|is\s+|am\s+)?(?:gonna|going\s+to|gotta|got\s+to|have\s+to|need\s+to|want\s+to|will|shall|just|then|also)?\s*/i;
// The words that always start a new step when they join two clauses.
// "Next to the heater" is a place, not the next step.
const _TIMK_JOIN=/[,\s]+(?:and\s+then|then|after\s+that|afterwards?|next(?:\s+up)?(?!\s+to\b)|followed\s+by|before\s+that|oh\s+and(?:\s+also)?)\s+/i;

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
  let words=String(frag||'').trim().toLowerCase().split(/\s+/).filter(Boolean);
  // "re edge the beds", "re pitch the back run": the phone splits the prefix off.
  if(words[0]==='over'&&words.length>1&&_timkVerbLike('over'+words[1]))words=['over'+words[1]].concat(words.slice(2));
  if(words[0]==='re'&&words.length>1){words=words.slice(1);if(!_timkVerbLike(words[0])&&_timkVerbLike('re'+words[0]))words[0]='re'+words[0];}
  if(!words.length||!_timkVerbLike(words[0]))return false;
  // Particles ride with their verb and say nothing about whether a new action
  // started: "tested and pressured UP" is still just manner. Counting "up" as
  // an object split it off as its own step.
  const rest=words.slice(1).filter(w=>!_TIMK_RIDER.test(w.replace(/[^a-z]/g,'')));
  if(!rest.length)return true;
  if(rest.some(w=>!_timkVerbLike(w)))return true;
  // All verbs: "tape and mud" is a step, "cut and rolled" is how the last one
  // was done. The past tense is the tell.
  // So is how paint goes on: "spray and back brush", "cut and roll".
  if([words[0]].concat(rest).every(w=>/^(?:spray|roll|brush|backroll|backbrush|cut|dip|wipe)$/.test(w.replace(/[^a-z]/g,''))))return false;
  return !rest.some(w=>/ed$/.test(w))&&!/ed$/.test(words[0]);
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
// "roll it AND water it in", "haul them off AND dump them": a verb whose
// object is a pronoun has finished its step. Only a pronoun straight after the
// verb counts, so "locate and cut out" still reads as one step.
function _timkPronounObject(left){
  const w=_timkTidy(left).toLowerCase().split(/\s+/).filter(Boolean);
  return w.length>=2&&_timkVerbLike(w[0])&&/^(?:it|them|everything|all)$/.test(w[1].replace(/[^a-z]/g,''));
}
const _TIMK_NOUN_START=/^\s*(?:pressure\s+(?:relief|reducing|tank|valve|switch|gauge)|check\s+valves?|drain\s+(?:line|pan|valve|and)|vent\s+(?:pipe|stack|cap)|test\s+(?:port|plug|cap))\b/i;
// Pairs that are one thing on a job and must never be split at their "and".
const _TIMK_AND_PAIR=/^(?:ice\s+water|tape\s+mud|tape\s+float|nuts\s+bolts|nut\s+bolt|trim\s+doors?|walls?\s+ceilings?|rails?\s+spindles?|step\s+counter|supply\s+drain|hot\s+cold|gas\s+power|power\s+gas|grounds?\s+neutrals?|down\s+spouts?|gutters?\s+downspouts?|soffit\s+fascia|sand\s+prime|remove\s+dispose|remove\s+replace|tear\s+replace|drain\s+flush|flush\s+fill|cut\s+cap|seed\s+straw|patch\s+paint)$/i;
const _TIMK_ING_NOUN=/^(?:dining|living|parking|siding|flooring|railing|decking|roofing|framing|lighting|wiring|piping|plumbing|sheathing|molding|moulding|coping|footing|landing|opening|building|ceilings|awning|ducting|tubing|fitting|coupling|housing|casing|bearing|shelving|paneling|panelling|fencing|edging|packing|padding|topping|trimming|drawing|setting|string|thing|spring|ring|king|wing|ling)$/;
// "new line set, new pad", "bypass loop", "condensate neutralizer to the floor
// drain": after a step that already names its work, a thing named on its own
// after a comma is the next item on the list. A qualifier of the step before
// ("about 480 square feet", "walls and ceilings", "satin", "Belgard block") is
// not: it has a measure, a place, a finish or a name at its front.
const _TIMK_QUALIFIER=/^(?:about|around|approximately|roughly|each|every|both|only|all|walls?|ceilings?|trim|doors?|inside|outside|interior|exterior|front|back|top|bottom|same|full|fully|semi|flat|matte|satin|eggshell|pearl|gloss|high|low|white|black|gray|grey|brown|tan|beige|color|colour|in|on|with|at|to|for|from|by|including|plus|no|not|just|also|too|then|and|or|so|but|if|when|where|while|because|since|as|like|per|the|a|an|this|that|these|those|his|her|their|our|my|your|its|it's|it|they|them|we|i|he|she|you|there|here|up|down|over|under|through|around|between|behind|along|across|upstairs|downstairs|whatever|either|any|some|most|half|one|once|twice|customer|homeowner|owner|master|guest|kitchen|bathroom|bath|living|dining|family|bedroom|bedrooms|hall|hallway|garage|basement|attic|stairwell|stairs|landing|closets?|rooms?|porch|deck|floors?|windows?|number|no|size|model|type|schedule|grade|class|looks|seems|probably|maybe|don't|dont|do|does|did|never|can't|won't|except|minus|same|match|matching|third|quarter|first|second|last|next|hidden|concealed|exposed)$/;
function _timkItemPiece(next){
  const raw=String(next||'').trim();
  if(!raw)return false;
  // A name on its own is which one ("Square D", "Belgard Celtik block"); a
  // name with what it is and where is its own line ("Owens Corning Duration in
  // estate gray", "Kerdi drain in the center").
  if(/^[A-Z]/.test(raw)&&!/^(?:New|A|An)\b/.test(raw)&&raw.split(/\s+/).length<4)return false;
  const w=_timkTidy(raw).toLowerCase().replace(/[.,;!?]+$/,'').split(/\s+/).filter(Boolean);
  if(w.length<2||w.length>9)return false;
  if(/^(?:a|an)$/.test(w[0])&&w[1]==='new')return w.length>=3;
  if(w[0]==='new')return true;
  // "2 part epoxy base coat", "2 inch drain tied into the stack": a counted
  // thing of its own. "3 feet tall", "10 feet out", "8 pounds per 1000" say
  // how much of the step before.
  if(/^\d/.test(w[0]))return w.length>=4&&(/^(?:part|stage|car)$/.test(w[1])||w.slice(2).some(x=>/ed$/.test(x)&&_timkVerbLike(x)))&&!/^(?:tall|wide|long|deep|high|thick|apart|out|each|total|down|up|around|over|it|them|that|high|max|min|minimum|maximum|oc|center)$/.test(w[w.length-1])&&!w.some(x=>/^(?:per|a|an|each|of)$/.test(x))&&!/^(?:feet|foot|ft|squares?|yards?|percent|%|days?|hours?|minutes?|weeks?|times?|degrees?)$/.test(w[1]);
  if(_TIMK_QUALIFIER.test(w[0])||/(?:ed|ly|er)$/.test(w[0])&&!/^(?:water|filter|meter|breaker|heater|timer|toilet|border|shower|gutter|paper|primer|sealer|header|ledger|rafter|stringer|washer|dryer|trimmer|marker|spacer|boiler|burner|fitter|holder|cover|hanger|river|center|corner|order|number|leader|sewer|chamber|fiber|lumber|tower|power|hammer)$/.test(w[0]))return false;
  if(w.some(x=>_timkVerbLike(x)&&!_TIMK_NOUNISH.has(x)&&!/(?:ed|ing)$/.test(x)&&!/^(?:set|run|drain|flush|stop|pull|mount|light|seal|cap|wash|bond|tie|grade|level|square|plumb|trim|finish|coat|test|check|charge|start|pump|wrap|fill|bed)$/.test(x)))return false;
  // Nothing but a colour or a finish: the step before's.
  if(w.every(x=>/^(?:flat|matte|satin|eggshell|pearl|semi|gloss|white|black|gray|grey|dark|light|same|color|colour|finish|coat|coats|and|or|the|in)$/.test(x)))return false;
  return true;
}
function _timkAndSplits(left,right){
  {
    const lw=(String(left||'').trim().split(/\s+/).pop()||'').toLowerCase().replace(/[^a-z]/g,'');
    const rw=(String(right||'').trim().split(/\s+/)[0]||'').toLowerCase().replace(/[^a-z]/g,'');
    if(_TIMK_AND_PAIR.test(lw+' '+rw))return false;
    // "the whole house scrape AND sand the loose paint": two verbs sharing an
    // object. The seam is in front of the first verb, not at the "and".
    const lws=_timkTidy(left).toLowerCase().split(/\s+/).filter(Boolean);
    if(lws.length>=3&&_TIMK_VERBS.has(lw)&&!_TIMK_NOUNISH.has(lw)&&(_TIMK_STRONG.has(lw)||lws.length>=5&&/^(?:locate|find|expose|excavate|dig|check|inspect|test|patch|repair|fix|clean|scrape|sand|prep|foam|grind)$/.test(lw))&&_timkVerbLike(rw)&&!_TIMK_NOUNISH.has(rw)&&!/^(?:the|a|an|and|to|will|gonna|then|of|for|with)$/.test(lws[lws.length-2]))return false;
  }
  // Only the last comma piece is what "and" joins: in "run the camera down
  // the main, locate and mark the belly" the left side is "locate".
  left=String(left||'').split(/,\s*/).pop();
  // "okay so we're gonna drain AND flush the tank": the filler in front is not
  // an object, so it is taken off before the left side is judged.
  if(!_timkHasObject(_timkTidy(left).toLowerCase())&&!_timkPronounObject(left))return false;
  // "the temperature and pressure relief valve" is one thing.
  if(_TIMK_NOUN_START.test(right))return false;
  // "paint the door and trim, $350": the price is not what got painted.
  {const r0=String(right||'');right=r0.replace(/[,\s]+\$?\d[\d,]*(?:\.\d+)?(?:\s+(?:bucks|dollars|each|installed|total))?[.!?]?\s*$/i,'');
   // "and haul off, $2,600": a verb priced on its own is its own line.
   if(right!==r0&&/\$|bucks|dollars/.test(r0)){const rw=right.trim().toLowerCase().split(/\s+/);if(_timkVerbLike(rw[0])&&!_TIMK_NOUNISH.has(rw[0])&&rw.slice(1).every(x=>_TIMK_RIDER.test(x.replace(/[^a-z]/g,''))))return true;}}
  let words=String(right||'').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if(!words.length)return false;
  // "and re secure the loose spikes": the phone split the prefix off.
  if(words[0]==='re'&&words[1]&&_timkVerbLike('re'+words[1].replace(/[^a-z]/g,'')))words=['re'+words[1]].concat(words.slice(2));
  const w=words[0].replace(/[^a-z]/g,'');
  {const lt=_timkTidy(left).toLowerCase().split(/\s+/).filter(Boolean);
   const leftStep=lt.length>=3&&_timkVerbLike(lt[0])&&_timkHasObject(lt.join(' '));
   // "outlets on the workbench wall and a 240 volt 30 amp outlet", "weed
   // fabric and 3 inches of black mulch": a counted thing of its own.
   if(leftStep&&/^(?:a|an)\s+\d/.test(words.join(' '))&&/\b(?:on|in|at|by|over|under|behind|along)\s+(?:the\s+)?[a-z]+(?:\s+[a-z]+)?$/.test(lt.join(' ')))return true;
   if(leftStep&&/^\d+(?:\.\d+)?\s+(?:inch|inches|yards?|tons?|bags?|feet|foot|gallons?|pounds?|coats?)\s+of\s+\S/.test(words.join(' ')))return true;
   // "closure strips and new trim": a new item after an item.
   if(lt.length>=2&&lt[0]!=='new'&&!lt.some(x=>_timkVerbLike(x)&&!_TIMK_NOUNISH.has(x))&&/^(?:(?:a|an)\s+)?new\s+\S+/.test(words.join(' ')))return true;}
  // A verb, or the -ing form of anything, which is the register dictation
  // produces: "putting in", "getting rid of", "running new".
  // "caulk all the windows AND TRIM prime the bare wood": the trim is what got
  // caulked; the new step starts at "prime".
  if(_TIMK_NOUNISH.has(w)&&words[1]&&_timkVerbLike(words[1])&&!_TIMK_NOUNISH.has(words[1]))return false;
  if(_TIMK_NOUNISH.has(w)&&/^(?:spot|wet|scuff|power|pressure|hand|touch|re)$/.test(words[1]||'')&&_timkVerbLike(words[2]||''))return false;
  // "caulk all windows AND trim joints": a list of things, not a new job.
  {const lw2=(String(left||'').trim().split(/\s+/).pop()||'').toLowerCase().replace(/[^a-z]/g,'');
   if(_TIMK_NOUNISH.has(w)&&/[^s]s$/.test(lw2)&&!_TIMK_VERBS.has(lw2)&&words[1]&&/[^s]s$/.test(words[1].replace(/[^a-z]/g,'')))return false;}
  // "float it over the vinyl AND new transitions at the doorways", "stain it
  // AND 3 coats of Bona": a new item after a step that is already whole.
  if(/^(?:(?:a|an)\s+)?new\s+\S+\s+\S+/i.test(String(right).trim())&&_timkVerbLike((_timkTidy(left).toLowerCase().split(/\s+/)[0]||''))&&(_timkHasObject(_timkTidy(left).toLowerCase())||_timkPronounObject(left)))return true;
  if(/^\d+\s+coats?\s+of\s+\S+/i.test(String(right).trim())&&_timkVerbLike((_timkTidy(left).toLowerCase().split(/\s+/)[0]||''))&&_timkHasObject(_timkTidy(left).toLowerCase()))return true;
  // "on the body AND satin on the trim": a second finish is a second line.
  if(/^(?:flat|matte|satin|eggshell|semi[\s-]?gloss|gloss|high[\s-]?gloss)\s+on\s+(?:the\s+)?\S+/i.test(String(right).trim())&&/\bon\s+(?:the\s+)?\S+/i.test(left))return true;
  // A verb, or the -ing form of anything ("Outting In A Tankless", typed),
  // except the -ing words that are things on a job: "paint the walls and
  // ceiling" is one step, not two.
  if(!_timkVerbLike(w)&&!(/ing$/.test(w)&&w.length>=5&&!_TIMK_ING_NOUN.test(w)))return false;
  if(_timkHasObject(right))return true;
  // "roll it and water it in": a pronoun object on the right only counts when
  // the left has one too. "put in the vanity and make it level" is one step,
  // and so is "shut the water off and drain it down".
  // "fill the holes with topsoil and seed them", "remove the old storm windows
  // and haul them off": a verb that is always its own job, on what the left
  // side just named. "shut the water off and drain it down" stays one step.
  if(/^\S+\s+(?:it|them)\b/i.test(String(right).trim())&&/^(?:haul|seed|cap|dispose|tape|paint|seal|stain|prime|test|caulk|bag|mulch|wrap|insulate|secure|mount|hang|sand|reinstall|install|pressure|bury|chip|grind|plant|sod|backfill|compact|restain|refinish|label|flash|vent|wire|glue|screw|nail|grout|reset|reattach|rehang|tighten|level|shim)$/.test(w)&&_timkHasObject(_timkTidy(left).toLowerCase())&&!_timkPronounObject(left))return true;
  // "move all the circuits over and label everything".
  if(/^\S+\s+(?:everything|all\s+(?:of\s+)?(?:it|them|the\s+\w+))$/i.test(String(right).trim())&&_timkHasObject(_timkTidy(left).toLowerCase())&&!/^(?:make|get|keep|leave|let|have)$/.test(w))return true;
  if(/^\S+\s+(?:it|them)\b/i.test(String(right).trim())&&_timkPronounObject(left)&&!/^(?:make|get|keep|leave|let|have)$/.test(w))return true;
  // "patch the wall and paint": a bare verb that is never a noun on a job
  // finishes the list as its own step. "trim", "tile" and "caulk" are left
  // out on purpose, because "paint the walls and trim" is one step.
  return words.length===1&&/^(?:paint|prime|seal|clean|test|reset|reinstall|sweep|vacuum|backfill|compact|restore)$/.test(w);
}

// ── NO COMMAS, NO "AND" (2026-09-23) ─────────────────────────────────────
//
// Dictation often hands back one breathless run: "pull the old water heater
// put in a new tankless haul the old one away". Earl said exactly that and got
// ONE step. The seam is a verb that opens a new clause, and a verb opens one
// when what follows it is the start of an object ("put IN a", "haul THE"),
// or when the verb is one that is never a noun on a job ("replace", "haul").
// And only after a complete step: the left side must already name something,
// and the word before the verb must not make it a noun ("the finish") or part
// of the same action ("and cut", "to set").
const _TIMK_STRONG=new Set(['replace','install','remove','pull','haul','tear','rip','swap','dig','hang','mount',
  'disconnect','reinstall','rehang','demo','pour','frame','insulate','caulk','prime','sand','scrape','level','lay',
  'reset','test','reattach','rewire','regrout','weatherstrip','add','rekey','dowel','sawcut']);
const _TIMK_STARTER=/^(the|a|an|new|old|in|out|up|off|down|it|them|all|both|some|any|his|her|their|my|our|this|that|these|those|every|each|two|three|four|five|six|\d+)$/;
const _TIMK_NOT_BEFORE=/^(the|a|an|and|or|to|will|gonna|then|of|for|with|new|old|this|that|each|every|so|we|i|you|they|it)$/;
const _TIMK_NOUNISH=new Set(['line','water','seed','sod','mulch','trim','edge','cap','plug','tile','frame','level',
  'mark','record','file','land','core','chip','mud','tape','texture','vent','light','bond','bag','load','drop',
  'stage','square','plumb','feed','face','strap','support','jack','shore','permit','dumpster','scope','charge',
  'start','startup','pump','float','screw','bolt','nail','glue','roll','pipe','flash','cover','wait','thin','raise',
  'disconnect','coat','match','weed','hand','touch','drywall','screen','form','epoxy','carpet','stamp','shingle']);
function _timkVerbSplit(frag){
  const words=String(frag||'').trim().split(/\s+/).filter(Boolean);
  if(words.length<5||/[,;]/.test(frag))return [frag];
  const out=[];let start=0;
  for(let i=2;i<words.length-1;i++){
    // "haul it off 4 inches of compacted gravel", "stain the caps to match the
    // floor 2 coats of poly": a measured amount OF something starts an item.
    if(/^\d+(?:\.\d+)?$/.test(words[i])&&/^(?:inch|inches|yards?|tons?|bags?|feet|foot|gallons?|pounds?|coats?|layers?)$/i.test(words[i+1]||'')&&/^of$/i.test(words[i+2]||'')&&i-start>=3){
      const pv0=words[i-1].toLowerCase().replace(/[^a-z]/g,'');
      if(pv0&&!/^(?:about|around|with|of|for|and|or|the|a|an|to|in|on|at|by|over|under|put|lay|add|spread|install|pour|use|needs?|plus|roughly|approximately)$/.test(pv0)&&!_timkVerbLike(pv0)||/^(?:it|them|off|out|up|down|away)$/.test(pv0)){
        const lft=words.slice(start,i).join(' ');
        if(_timkVerbLike((_timkTidy(lft).toLowerCase().split(/\s+/)[0]||''))&&(_timkHasObject(_timkTidy(lft).toLowerCase())||_timkPronounObject(lft))){out.push(lft);start=i;continue;}
      }
    }
    const w=words[i].toLowerCase().replace(/[^a-z]/g,'');
    // "reset toilet new vanity with top", "HDZ charcoal new ridge vent": in a
    // run with no punctuation, "new" after a finished thing starts the next.
    if(w==='new'&&i-start>=2&&i<words.length-1&&(!/^\d/.test(words[i-2]||'')||/^[A-Z]{1,4}$/.test(words[i-2]||''))&&!(/^\d/.test(words[i-1]||'')&&/^\d/.test(words[i-2]||''))){
      const pv=words[i-1].toLowerCase().replace(/[^a-z0-9]/g,'');
      if(pv&&!/'s$/.test(words[i-1])&&(!_timkVerbLike(pv)||/[^s]s$/.test(pv))&&!/^(?:a|an|the|and|or|of|for|with|to|in|on|at|by|all|some|any|brand|two|three|four|\d+|put|install|installing|set|hang|run|add|get|with|into|onto|few|couple|whole|entire|this|that|every|each|is|are|be|was|his|her|their|our|my|your|completely|totally|like|looks|almost)$/.test(pv)&&(_timkVerbLike((_timkTidy(words.slice(start,i).join(' ')).toLowerCase().split(/\s+/)[0]||''))||i-start>=2)&&_timkHasObject(_timkTidy(words.slice(start,i).join(' ')).toLowerCase())){out.push(words.slice(start,i).join(' '));start=i;continue;}
    }
    const prev=words[i-1].toLowerCase().replace(/[^a-z]/g,'');
    const next=words[i+1].toLowerCase().replace(/[^a-z0-9]/g,'');
    if(!_timkVerbLike(w))continue;
    // A capital in the middle of a sentence is a name ("Knock Out roses",
    // "Home Flex"), and a name never starts a step.
    if(/^[A-Z]/.test(words[i])&&(/^[A-Z]/.test(words[i-1])||/^[A-Z]/.test(words[i+1]||'')))continue;
    // Words that are as often the thing as the action ("the frozen LINE in the
    // crawl", "the WATER heater", "the TRIM boards") never split a run-on on
    // their own. They still open a step after a comma or a full stop.
    // "vent it out", "wire it to the switch", "cap it": with its pronoun
    // straight after, the word is doing, not naming.
    const pronounNext=/^(?:it|them)$/.test(next)||w==='weed'&&next==='eat'||w==='tape'&&next==='and'&&/^(?:finish|mud|float|texture|sand|bed)$/.test((words[i+2]||'').toLowerCase().replace(/[^a-z]/g,''));
    // "from the roof vent record the video": a noun-ish verb straight after a
    // finished noun and straight before "the" is the next step.
    const articleNext=(/^(?:the|a|an)$/.test(next)||/^(?:tile|paint|texture|trim)$/.test(w)&&next==='to'&&/^(?:the|match)$/.test((words[i+2]||'').toLowerCase()))&&!/^(?:whole|entire|full|same|rest|length|way)$/.test((words[i+2]||'').toLowerCase())&&!_TIMK_NOT_BEFORE.test(prev)&&!/^(?:new|old|and|or|of|for|to|with|in|on|at|by|from|into|some|any|more|less)$/.test(prev)&&!/(?:ing|ed)$/.test(prev)&&i-start>=4;
    if(!pronounNext&&!articleNext&&(_TIMK_NOUNISH.has(w)||_TIMK_NOUNISH.has(w.replace(/(?:ing|s)$/,''))))continue;
    // "recessed LIGHTS in", "the SEALS on": a plural noun, not a verb. A man
    // dictating says "light" or "lighting", never "lights", to start a step.
    if(/[^s]s$/.test(w)&&!_TIMK_VERBS.has(w))continue;
    // "pressure test", "power wash": one verb in two words.
    if(/^(?:pressure|leak|power|flow|smoke|backflow|door|blower|duct|radon|soil|perc|load|water|air)$/.test(prev)&&/^(?:test|tested|testing|wash|washed|washing|check)$/.test(w))continue;
    // "spot prime", "wet scrape", "scuff sand", "re pitch": one verb in two words.
    if(/^(?:spot|wet|scuff|dry|hand|touch|back|re|hydro|weed|top|over|slit|core|power)$/.test(prev)){
      // ...and the step starts at the first of the two words, not the second:
      // "the south side spot prime bare wood".
      const pw=words[i-1];const left0=words.slice(start,i-1).join(' ');
      if(/^(?:spot|wet|scuff|power|pressure|hand|touch|re|hydro|picture)$/.test(prev)&&i-1-start>=3&&_timkHasObject(_timkTidy(left0).toLowerCase())&&!_TIMK_NOT_BEFORE.test((words[i-2]||'').toLowerCase().replace(/[^a-z]/g,''))&&(_TIMK_STARTER.test(next)||_TIMK_STRONG.has(w)||/^(?:prime|sand|scrape|wash|clean|touch|jet|frame|hang)$/.test(w)||/^(?:it|them)$/.test(next))){out.push(left0);start=i-1;}
      continue;
    }
    // "line set", "heat pump", "drop cloth": two nouns, not a verb.
    if(/^(?:line|heat|sump|drop|test|pilot|set|shut|flush|clean|check|light|hook|run|pull|plug|trim|cap)$/.test(prev)&&/^(?:set|pump|cloth|plug|light|valve|out|box|off|up|screw|valves?)$/.test(w)&&/^(?:line|heat|sump|drop|test|pilot|set|shut)$/.test(prev))continue;
    if(/^\d+$/.test(w)===false&&/^\d+(?:\.\d+)?$/.test(words[i]||'')){}
    // "a two way clean out": the fitting, not the job.
    if(/^(?:clean|cleans)$/.test(w)&&/^(?:way|new|a|the)$/.test(prev)&&next==='out')continue;
    // "the meter pull", "the TV mount", "a drawer pull": one thing, two words.
    if(/^(?:pull|pulls|mount|mounts)$/.test(w)&&/^(?:meter|tv|wall|drawer|cabinet|door|fan|ceiling|bracket|flush|surface|swivel|articulating|pull|curb|deck|pole|post|pendant|rail|arbor)$/.test(prev))continue;
    if(/^pull$/.test(w)&&/^(?:down|out)$/.test(next)&&/^[A-Z]/.test(words[i-1]))continue;
    // "a Moen pull down", "the Delta pull out": a kind of faucet.
    if(/^pull$/.test(w)&&/^(?:down|out)$/.test(next)&&/^(?:moen|delta|kohler|pfister|grohe|faucet|a|the|single|touchless|kitchen)$/.test(prev))continue;
    // "fence posts set in concrete", "tile set in thinset": how it is done.
    if(/^(?:set|sunk|embedded|laid)$/.test(w)&&/^(?:in|on)$/.test(next)&&/^(?:concrete|mortar|thinset|gravel|sand|foam|epoxy)$/.test((words[i+2]||'').toLowerCase().replace(/[^a-z]/g,'')))continue;
    // "anode rod", "curtain rod": the thing, not a drain being rodded.
    if(/^rods?$/.test(w)&&/^(?:anode|curtain|ground|threaded|sacrificial|magnesium|aluminum|closet)$/.test(prev))continue;
    const stem=w.replace(/ing$/,'');
    const strong=_TIMK_STRONG.has(w)||_TIMK_STRONG.has(stem)||_TIMK_STRONG.has(stem+'e')||w==='weed'&&next==='eat';
    // "fifteen years old haul the heater": "old" before a strong verb that
    // opens an object is the end of the last clause, not an adjective.
    // "removing the old putting in the new" is the same seam with a plain verb,
    // when the verb is followed by its particle ("putting IN", "taking OUT").
    // "hydro jet it install a new cleanout": after a pronoun object, a strong
    // verb with its own object starts the next step.
    const afterPronoun=/^(?:it|them)$/.test(prev)&&strong&&_TIMK_STARTER.test(next)&&i-start>=3;
    // "re-stain with", "re-hang the gate": a verb that says so on its face.
    const reHyphen=/^re-[a-z]/i.test(words[i])&&_timkVerbLike(w);
    if(reHyphen&&i-start>=3&&!/^(?:to|and|or|will|gonna)$/.test(prev)&&_timkHasObject(_timkTidy(words.slice(start,i).join(' ')).toLowerCase())){out.push(words.slice(start,i).join(' '));start=i;continue;}
    if(!afterPronoun&&_TIMK_NOT_BEFORE.test(prev)&&!((strong||/^(?:in|out|up|down|off)$/.test(next))&&/^(?:old|new)$/.test(prev)&&_TIMK_STARTER.test(next)))continue;
    // "reset or replace the GFCI": two verbs sharing a new object start a step.
    const orVerb=/^(?:or|and)$/.test(next)&&_timkVerbLike((words[i+2]||'').toLowerCase().replace(/[^a-z]/g,''));
    if(!strong&&!_TIMK_STARTER.test(next)&&!orVerb)continue;
    const left=words.slice(start,i).join(' ');
    // Judged without the filler and the subject: "after that we'll" and "so
    // we're" in front of a verb are not a finished step.
    if(i-start<2||!(_timkHasObject(_timkTidy(left).toLowerCase())||_timkPronounObject(left)))continue;
    out.push(left);start=i;
  }
  out.push(words.slice(start).join(' '));
  return out;
}

// ── WHAT A SLOW TALKER ACTUALLY SAYS (the Earl audit, 2026-09-27) ─────────
//
// Earl is 58 and dictates a fifteen minute job with rests in it. What comes
// back from the phone is his words, exactly, and that includes the "uh", the
// "no wait, make that three", the "scratch that", and every number spelled out.
// Written straight onto a contract those are wrong in a way a homeowner reads.
// So before anything is split into steps, four passes, in this order:
//   1. the ums come out (whole words only: "umbrella" and "plumbing" stay)
//   2. spoken numbers become digits, and "dollars" becomes a dollar sign
//   3. his corrections are applied: the number he fixed is replaced, and the
//      clause he scratched is gone
// Each is narrow on purpose. A wrong rewrite of his words is worse than none.
const _TIMK_UM=/^(?:u+h+|u+m+|uhm+|e+r+m+|h+m+|mm+)$/;
const _TIMK_NOT_YOUKNOW=/^(?:let|lets|to|if|what|how|where|when|why|who|whether|that|did|do|does|dont|didnt|would|will|should)$/;
function _timkTok(t){return String(t||'').split(/\s+/).filter(Boolean).map(w=>{
  const m=w.match(/^(.*?)([,.;:!?]*)$/);
  return {w:m[1],p:m[2],c:m[1].toLowerCase().replace(/[\u2018\u2019]/g,"'").replace(/[^a-z0-9'$.\-]/g,'')};
});}
function _timkUntok(toks){return toks.map(x=>x.w+x.p).join(' ');}
// Drop tokens i..j (inclusive), handing a sentence end to the word before so
// "we set it uh." still ends its sentence.
function _timkDropToks(toks,i,j){
  const tail=toks[j].p;
  toks.splice(i,j-i+1);
  if(/[.!?;]/.test(tail)&&i>0&&!/[.!?;]/.test(toks[i-1].p))toks[i-1].p=tail.replace(/,/g,'');
}
function _timkUnfill(text){
  const toks=_timkTok(text);
  for(let i=0;i<toks.length;i++){
    const c=toks[i].c.replace(/'/g,'');
    if(_TIMK_UM.test(c)){
      // A pause before "new ...", a count or a name, in a run with no
      // punctuation, is where he finished one thing and started the next:
      // "a Pella 3 light bay um new head and seat board".
      const nx=toks[i+1],pv=toks[i-1];
      if(pv&&nx&&!pv.p&&!/^(?:about|around|like|roughly|maybe|with|of|for|and|or|the|a|an|to|in|on|at|by|some|that|this|is|are|it's|its|we're|i'm|gonna|probably)$/.test(pv.c)&&(nx.c==='new'||/^\d/.test(nx.c)&&toks[i+2]&&/^[a-z]/.test(toks[i+2].c)||/^[A-Z][a-z]/.test(nx.w)&&nx.c!=="i"&&nx.c!=="i'm"&&nx.c!=="i'll"))pv.p='.';
      _timkDropToks(toks,i,i);i--;continue;
    }
    const c1=toks[i+1]?toks[i+1].c.replace(/'/g,''):'',c2=toks[i+2]?toks[i+2].c:'';
    if(c==='like'&&c1==='i'&&c2==='said'&&!toks[i].p&&!toks[i+1].p){_timkDropToks(toks,i,i+2);i--;continue;}
    if(c==='you'&&c1==='know'&&!toks[i].p){
      const prev=i>0?toks[i-1].c.replace(/'/g,''):'';
      const next=toks[i+2]?toks[i+2].c.replace(/'/g,''):'';
      const prevOpen=i===0||!!toks[i-1].p;
      if(prevOpen||!_TIMK_NOT_YOUKNOW.test(prev)){
        if(!(!toks[i+1].p&&_TIMK_NOT_YOUKNOW.test(next))){_timkDropToks(toks,i,i+1);i--;continue;}
      }
    }
  }
  return _timkUntok(toks);
}

// Number words to digits, for the scope. timDigits is the materials reader's
// and turns "a roll" into "1 roll" and "a couple" into 2, which is right on a
// supply list and wrong in a sentence; this one only converts what is plainly
// a number. A lone "one" stays a word ("haul the old one away"), and a bare
// "half" or "quarter" stays a word ("half the wall", "quarter round").
function _timkNumbers(text){
  text=String(text||'').replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)-(one|two|three|four|five|six|seven|eight|nine)\b/gi,'$1 $2');
  const toks=_timkTok(text);
  const kind=c=>{const k=_timNumKind(c);return k==='pack'?null:k;};
  const out=[];
  let i=0;
  while(i<toks.length){
    const k0=kind(toks[i].c);
    const aScale=(toks[i].c==='a'||toks[i].c==='an')&&!toks[i].p&&toks[i+1]&&(kind(toks[i+1].c)==='scale');
    if(!k0&&!aScale){out.push(toks[i]);i++;continue;}
    const run=[toks[i]],kinds=[aScale?'join':k0];
    let j=i+1;
    while(j<toks.length&&!run[run.length-1].p){
      const c=toks[j].c,k=kind(c),last=kinds[kinds.length-1];
      if(!k){
        const nx=toks[j+1]?toks[j+1].c:'',nx2=toks[j+2]?toks[j+2].c:'';
        if(c==='and'&&!toks[j].p&&(kind(nx)==='frac'||((nx==='a'||nx==='an')&&kind(nx2)==='frac'))){run.push(toks[j]);kinds.push('join');j++;continue;}
        // "two hundred and fifty"
        if(c==='and'&&!toks[j].p&&last==='scale'&&(kind(nx)==='one'||kind(nx)==='ten')){run.push(toks[j]);kinds.push('join');j++;continue;}
        if((c==='a'||c==='an')&&last==='join'){run.push(toks[j]);kinds.push('join');j++;continue;}
        break;
      }
      if(k==='digit'||(last==='one'&&(k==='ten'||k==='one'))||(last==='frac'&&k!=='frac')||(last==='ten'&&k==='ten'))break;
      run.push(toks[j]);kinds.push(k);j++;
    }
    // A trailing "and" or "a" that never reached a half is not part of it.
    while(run.length&&kinds[kinds.length-1]==='join'){run.pop();kinds.pop();j--;}
    const real=kinds.filter(k=>k&&k!=='join');
    // "a two way cleanout", "a three way switch", "8 pounds per thousand".
    const nxt=toks[j]?toks[j].c:'';
    const prevC=i>0?toks[i-1].c:'';
    const named=real.length===1&&(prevC==='the'&&(!!run[run.length-1].p||!toks[j])&&real[0]==='one'||/^(?:way|ways)$/.test(nxt)&&!run[run.length-1].p||real[0]==='scale'&&!aScale&&!(i>0&&/^\d/.test(out.length?out[out.length-1].c:'')));
    const unitNext=/^(?:zone|coat|layer|inch|foot|story|storey|car|gallon|ton|way|hour|day|week|sheet|square|bag|yard|pound|amp|step|riser|row|course)s?$/.test(nxt)&&!(i>0&&/^(?:the|that|this)$/.test(toks[i-1].c));
    const lone=named||real.length===1&&(real[0]==='one'&&/^ones?$/.test(run[0].c)&&!unitNext||real[0]==='frac'||real[0]==='digit');
    // "three quarter pex" is a pipe size, not a number to add up.
    const quarter=run.some(x=>/^quarters?$/.test(x.c));
    const n=(!run.length||lone||quarter||real.every(k=>k==='frac'))?null:timSpokenNumber(run.map(x=>x.c));
    if(n==null){out.push(toks[i]);i++;continue;}
    out.push({w:String(n),p:run[run.length-1].p,c:String(n)});
    i=j;
  }
  // "two fifty dollars", "eighteen fifty": how a price is said, hundreds
  // first. Only when the money word follows, so "2 50 foot rolls" is left.
  for(let k=0;k<out.length-2;k++){
    const a=out[k].c,b=out[k+1].c;
    if(/^\d+$/.test(a)&&/^\d+$/.test(b)&&!out[k].p&&!out[k+1].p&&+a>0&&+a<100&&+b>=10&&+b<100&&/^(?:dollars?|bucks)$/.test(out[k+2].c)){
      const n=String(+a*100+(+b));out[k]={w:n,p:'',c:n};out.splice(k+1,1);
    }
  }
  // "Figure six fifty.", "Two eighty-five.": hundreds first, said as a price,
  // at the end of what he said.
  for(let k=0;k<out.length-1;k++){
    const a=out[k].c,b=out[k+1].c,prevC=k>0?out[k-1].c.replace(/[^a-z]/g,''):'';
    const atStart=k===0||/[.!?;]/.test(out[k-1].p);
    if(/^\d$/.test(a)&&/^\d\d$/.test(b)&&+b>=10&&!out[k].p&&(/[.!?;]/.test(out[k+1].p)||k+2>=out.length)&&(atStart||/^(?:figure|about|around|for|say|its|thats|runs|costs|call|it)$/.test(prevC))){
      const n=String(+a*100+(+b));out[k]={w:n,p:out[k+1].p,c:n};out.splice(k+1,1);
    }
  }
  // "2500 dollars", "250 bucks": a price, written as one.
  for(let k=0;k<out.length-1;k++){
    if(/^\d+(?:\.\d+)?$/.test(out[k].c)&&!out[k].p&&/^(?:dollars?|bucks)$/.test(out[k+1].c)){
      out[k]={w:'$'+out[k].w,p:out[k+1].p,c:'$'+out[k].c};out.splice(k+1,1);
    }
  }
  return _timkUntok(out);
}

// "No wait, make that three." "Actually make it two." "Scratch that." A man
// correcting himself out loud. The number he fixed is replaced where he said
// it first; the clause he scratched is dropped. Only ever the one just before:
// a correction reaches back one clause, never across the job.
const _TIMK_FIXNUM=/(?:^|[\s,.;!?]+)(?:(?:(?:no|nope|wait|actually|sorry|oh|oops)[,.!]?\s+)+(?:make\s+(?:that|it)|i\s+mean|change\s+(?:that|it)\s+to)|make\s+that)\s+(?:the\s+)?(\$?\d+(?:\.\d+)?)([,.;!?]*)/i;
const _TIMK_SCRATCH=/(?:^|[\s,.;!?]+)(?:no[,.]?\s+)?(?:scratch|strike|forget|cancel|delete|erase)\s+that\b[,.;!?]*|(?:^|[\s,.;!?]+)never\s?mind\b[,.;!?]*/i;
const _TIMK_CLAUSE_END=/[.!?;,\n]\s*|\s(?:and then|then|after that|next|also)\s/gi;
// "put in six, no wait eight recessed lights", "about 15 feet, no more like 20
// feet", "from the roof vent, no wait from the cleanout", "prime with Stix, uh
// actually no, prime with BIN". The correction REPLACES what it corrects, in
// place, and the rest of the sentence carries on. Two anchors, both narrow:
// a number fixes the last number before it; otherwise the correction has to
// start with a word that is in what came before ("from", "prime") and cuts
// back to it. With neither, his words are left alone.
const _TIMK_REDO=/[,\s]+(?:uh\s+|um\s+)?(?:no[,]?\s+wait|wait[,]?\s+no|actually[,]?\s+no|no[,]?\s+actually|no[,]?\s+sorry|i\s+mean|no\s+more\s+like|or\s+rather|scratch\s+that|sorry|actually(?=\s+(?:just|only|let's|lets|make|we'll\s+do|do)\b)|no)[,.]?\s+/gi;
const _TIMK_NUMWORD={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12};
const _timkSing=w=>String(w||'').toLowerCase().replace(/[^a-z0-9]/g,'').replace(/(ss|sh|ch|x|z)es$/,'$1').replace(/([^s])s$/,'$1');
// "12 linear feet of base cabinets, no wait make it 14 linear feet, then set
// the top": the new number goes where the old one was, the words he repeated
// after it are not said twice, and whatever he went on to say carries on.
function _timkRenumber(clause,last,b){
  const nb=b.match(/^\$?\d[\d,\/]*(?:\.\d+)?/)[0];
  const cAfter=clause.slice(last.index+last[0].length);
  const bAfter=b.slice(nb.length);
  const cw=cAfter.trim().split(/\s+/).filter(Boolean),bw=bAfter.trim().split(/\s+/).filter(Boolean);
  let k=0;
  while(k<bw.length&&k<cw.length&&_timkSing(bw[k])===_timkSing(cw[k])&&_timkSing(bw[k])){k++;if(/[,.;!?]$/.test(bw[k-1]))break;}
  // "two ceiling fans, no wait, 1 ceiling fan in the master": his new words
  // are the ones kept, singular and all.
  if(k>0&&k>=cw.length){
    return clause.slice(0,last.index)+b;
  }
  // Only when what follows the number is the same thing, or nothing: "14
  // linear feet" after "12 linear feet". Otherwise the correction replaced
  // the tail too ("15 feet, no more like 20 feet" already matches).
  if(k===0&&bw.length&&cw.length&&!/^[,.;!?]/.test(bAfter.trim()))return clause.slice(0,last.index)+b;
  const punct=k?(bw[k-1].match(/[,.;!?]+$/)||[''])[0]:'';
  const rest=(punct+(bw.slice(k).length?' '+bw.slice(k).join(' '):'')).trim();
  return clause.slice(0,last.index)+nb+cAfter.replace(/\s+$/,'')+(rest?(/^[,.;!?]/.test(rest)?'':' ')+rest:'');
}
function _timkRedo(text){
  let v=String(text||'');
  for(let guard=0;guard<10;guard++){
    const re=new RegExp(_TIMK_REDO.source,'gi');
    let m,done=false;
    while((m=re.exec(v))){
      const trig=m[0].toLowerCase().replace(/[,.]/g,' ').replace(/\s+/g,' ').trim();
      const a=v.slice(0,m.index);let b=v.slice(m.index+m[0].length);
      const clauseStart=Math.max(a.lastIndexOf('. '),a.lastIndexOf('! '),a.lastIndexOf('? '))+1;
      const clause=a.slice(clauseStart);
      // "two fans, no wait, one": the lone "one" the number pass left as a word.
      {const nw=b.match(/^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i);
       if(nw&&/\d/.test(clause)){b=_TIMK_NUMWORD[nw[1].toLowerCase()]+b.slice(nw[1].length);}}
      const bNum=b.match(/^\$?\d[\d,\/]*(?:\.\d+)?/);
      if(bNum){
        const nums=[...clause.matchAll(/\$?\d[\d,\/]*(?:\.\d+)?|\b(?:half|third|quarter)\b/gi)];
        const last=nums[nums.length-1];
        // Bare "no" only between two numbers ("4 bedrooms, no, 5 bedrooms"), or
        // as its own sentence straight after one ("Two pipe boots. No, three.").
        if(last&&trig==='no'&&/[.!?]\s*$/.test(a)&&/^\$?\d[\d,\/]*(?:\.\d+)?[.!?]/.test(b)){
          const nb=b.match(/^\$?\d[\d,\/]*(?:\.\d+)?/)[0];
          const pc=clause.replace(/[.!?]\s*$/,'');
          v=a.slice(0,clauseStart)+pc.slice(0,last.index)+nb+pc.slice(last.index+last[0].length)+b.slice(nb.length);done=true;break;
        }
        if(last&&(trig!=='no'||/^\S+(?:\s+\S+)?$/.test(clause.slice(last.index).trim()))){
          v=a.slice(0,clauseStart)+_timkRenumber(clause,last,b);done=true;break;
        }
        continue;
      }
      // "run the gas line, no, the plumber's running the gas": the correction
      // says the work is someone else's, so the clause he started goes.
      {const bs=b.split(/(?<=[.!?])\s+/)[0];
       if(/^no\b/.test(trig)&&bs&&!/^(?:actually\s+)?(?:she|he|they|the\s+customer|customer)\s+(?:changed|said\s+(?:the\s+colou?r|it's|it\s+is|make|to\s+make|to\s+do)|wants?(?!\s+to\b)|picked|chose)\b/i.test(bs)&&_timkIsRemark(bs.replace(/[.!?]+$/,''))&&/\b(?:plumber|electrician|roofer|painter|guy|company|city|utility|homeowner|customer|they|he|she)\b/i.test(bs)){
         const cut=Math.max(clause.lastIndexOf(','),0);
         v=a.slice(0,clauseStart)+clause.slice(0,cut)+(cut?'.':'')+' '+b.slice(bs.length).replace(/^\s+/,'');done=true;break;}}
      // "no, actually she changed it to Simply White", "no wait she said the
      // color is sandy beach": what she chose, said as a correction.
      {const sh=b.match(/^(?:actually\s+)?(?:she|he|they|the\s+customer|customer)\s+(?:changed\s+(?:it|that|her\s+mind|his\s+mind|their\s+mind)\s+to|said\s+(?:the\s+colou?r\s+is|it's|it\s+is|make\s+it|to\s+make\s+it|to\s+do)|wants?(?!\s+to\b)|picked|chose)\s+/i);
       // "the tub spout and the shower head, no wait, customer wants to keep
       // the shower head": the thing kept comes out of the step.
       const kp=b.match(/^(?:the\s+)?(?:customer|homeowner|she|he|they)\s+(?:wants|want|would\s+like|is\s+keeping|decided)\s+to\s+keep\s+(?:the\s+)?([a-z]+(?:\s+[a-z]+)?)[.!?]?/i);
       if(kp){const x=kp[1].replace(/[^a-z\s]/gi,'');const re2=new RegExp('[,\\s]+(?:and\\s+)?(?:the\\s+)?'+x+'\\b','i');
         if(re2.test(clause)){v=a.slice(0,clauseStart)+clause.replace(re2,'')+b.slice(kp[0].length).replace(/^\s*/,'. ').replace(/^\.\s*$/,'.');done=true;break;}}
       if(sh){b='make it '+b.slice(sh[0].length);}
       else if((trig==='no'||trig==='scratch that')&&!/^make\s+(?:it|that)\s+[a-z]/i.test(b))continue;}
      // "replace the tile floor with, actually let's do LVP instead", "on the 8
      // posts, actually just the 4 corner posts": what he swapped in takes the
      // place of what it names, the same as "make that".
      if(trig==='actually'){
        const sw=b.match(/^(?:(?:let's|lets|we'll)\s+(?:do|go\s+with|use|put)|do|just|only)\s+/i);
        if(!sw)continue;
        let rest=b.slice(sw[0].length);
        const endAt=rest.search(/[.;!?](?:\s|$)/);
        let head=endAt<0?rest:rest.slice(0,endAt);const tail=endAt<0?'':rest.slice(endAt);
        head=head.replace(/[,\s]+instead$/i,'');
        // An open end ("with,") takes it as is.
        const open=clause.replace(/[,\s]+$/,'');
        if(/\b(?:with|in|to|for|of|on|at)$/i.test(open)){v=a.slice(0,clauseStart)+open+' '+head+tail;done=true;break;}
        const hw=head.split(/\s+/);
        const cws=open.split(/\s+/);
        // Back to the article or preposition his new words start from.
        const lead=(hw[0]||'').toLowerCase();
        let at=-1;
        if(/^(?:the|a|an)$/.test(lead)){for(let q=cws.length-1;q>=0;q--){if(cws[q].toLowerCase()===lead){at=q;break;}}}
        if(at<0){const hs=_timkSing(hw[hw.length-1]);for(let q=cws.length-1;q>=0;q--){if(_timkSing(cws[q])===hs){at=Math.max(0,q-(hw.length-1));break;}}}
        if(at<=0)continue;
        v=a.slice(0,clauseStart)+cws.slice(0,at).join(' ')+' '+head+tail;done=true;break;
      }
      const w00=(b.split(/\s+/)[0]||'').toLowerCase().replace(/[^a-z]/g,'');
      // "stain it special walnut actually no stain just natural": the "no" is
      // part of what he means. No stain is the spec, on its own line.
      if(trig==='actually no'&&!/[,.]\s*$/.test(m[0])&&w00.length>=3){
        const at=clause.toLowerCase().lastIndexOf(w00);
        if(at>0&&/\s/.test(clause[at-1])){
          v=a.slice(0,clauseStart)+clause.slice(0,at).replace(/[\s,]+$/,'')+'. No '+b;done=true;break;
        }
      }
      // "install collar ties no wait rafter ties": the same thing named again,
      // so the words before it are what he swapped.
      if(!/^(?:make|change)\b/i.test(b)){
        const bw=b.split(/\s+/).slice(0,3);
        const cws=clause.replace(/[,\s]+$/,'').split(/\s+/);
        let hit=null;
        for(let k=0;k<bw.length&&!hit;k++){
          const bs=_timkSing(bw[k]);
          if(bs.length<3||/^(?:the|and|with|for|new|old)$/.test(bs))continue;
          for(let q=cws.length-1;q>=Math.max(1,cws.length-4);q--){if(_timkSing(cws[q])===bs&&q-k>=1){hit={q,k};break;}}
        }
        if(hit&&!_timkVerbLike(w00)){
          v=a.slice(0,clauseStart)+cws.slice(0,hit.q-hit.k).join(' ')+' '+b;done=true;break;
        }
        // "wrap the exterior in copper no wait aluminum": one word for one word,
        // at the end of what he said.
        const bOne=b.match(/^([A-Za-z][\w-]*)([.;!?]?)(\s|$)/);
        const bRest=b.slice(bOne?bOne[0].length:0);
        if(bOne&&(!bRest.trim()||/[.;!?]/.test(bOne[2]))&&cws.length>=3&&!_timkVerbLike(w00)){
          const lastW=cws[cws.length-1].toLowerCase().replace(/[^a-z]/g,'');
          const prevW=(cws[cws.length-2]||'').toLowerCase().replace(/[^a-z]/g,'');
          // "stain with Cabot semi transparent, no wait, solid": the pair is one word.
          // "2500 square feet of zoysia sod no wait bermuda": the kind of sod.
          const pairEnd=/^semi$/.test(prevW)?2:(/^(?:sod|grass|seed|tile|carpet|pad|shingles?|siding|decking|pavers?|stone|rock|mulch|paint|stain|primer|pipe|wire|fan|faucet|toilet|vanity|floor|flooring|countertops?|cabinets?|doors?|windows?|trim|fence|railing|gutters?)$/.test(lastW)&&prevW.length>=3&&!/^(?:the|new|old|of|and|with|a|an)$/.test(prevW)&&!_timkVerbLike(prevW)&&!/^\d/.test(prevW)?-1:1);
          if(pairEnd===-1){
            v=a.slice(0,clauseStart)+cws.slice(0,-2).join(' ')+' '+bOne[1]+' '+cws[cws.length-1]+bOne[2]+(bRest?' '+bRest.replace(/^\s+/,''):'');done=true;break;
          }
          if(pairEnd===2){
            v=a.slice(0,clauseStart)+cws.slice(0,-2).join(' ')+' '+bOne[1]+bOne[2]+(bRest?' '+bRest.replace(/^\s+/,''):'');done=true;break;
          }
          if(lastW.length>=3&&!/^(?:the|and|with|for|it|them|that|this|off|out|up|down|in|on)$/.test(lastW)&&!_timkVerbLike(lastW)){
            v=a.slice(0,clauseStart)+cws.slice(0,-1).join(' ')+' '+bOne[1]+bOne[2]+(bRest?' '+bRest.replace(/^\s+/,''):'');done=true;break;
          }
        }
      }
      // "5 ton of beach pebble, no wait, make that river rock": the thing after
      // the last "of", "with" or article is what he swapped.
      const mk=b.match(/^(?:make\s+(?:that|it)|change\s+(?:that|it)\s+to)\s+/i);
      if(mk){
        const rest=b.slice(mk[0].length);
        if(/^\$?\d/.test(rest)){
          const nums=[...clause.matchAll(/\$?\d[\d,\/]*(?:\.\d+)?|\b(?:half|third|quarter)\b/gi)];
          const last=nums[nums.length-1];
          if(last){v=a.slice(0,clauseStart)+_timkRenumber(clause,last,rest);done=true;break;}
          continue;
        }
        // "install a 1 zone Mitsubishi, no actually make it a Fujitsu": one
        // name for another.
        {const rn=rest.replace(/^(?:a|an|the)\s+/i,'');
         if(/^[A-Z][a-z]/.test(rn)){
           const cw=clause.replace(/[,\s]+$/,'').split(/\s+/);
           let bi=-1;for(let q=cw.length-1;q>=1;q--){if(/^[A-Z][a-z]/.test(cw[q])){bi=q;while(bi>1&&/^[A-Z]/.test(cw[bi-1]))bi--;break;}}
           if(bi<0&&cw.length<=2&&/^[A-Z]/.test(cw[0]))bi=0;
           const inAt=clause.search(/\bin[,\s]\s*(?=[^A-Z]*$)/);
           const cwJoinIdx=bi>=0?clause.indexOf(cw[bi]):-1;
           if(bi>=0&&inAt>cwJoinIdx&&inAt>0){v=a.slice(0,clauseStart)+clause.slice(0,inAt).replace(/\s+$/,'')+' in '+rn;done=true;break;}
           if(bi>=0){v=a.slice(0,clauseStart)+(bi?' '+cw.slice(0,bi).join(' ')+' ':(clauseStart?' ':''))+rn;v=v.replace(/\s{2,}/g,' ');done=true;break;}
         }}
        const at=Math.max(...['of','with','in','on','a','an','the'].map(x=>{const r=new RegExp('\\b'+x+'[,\\s]\\s*','gi');let q,l=-1;while((q=r.exec(clause)))l=q.index+q[0].length;return l;}));
        {const hw=rest.replace(/[.!?;,].*$/,'').trim().split(/\s+/);const hs=_timkSing(hw[hw.length-1]);const cws=clause.replace(/[,\s]+$/,'').split(/\s+/);
         if(hw.length<=3&&hs.length>=3){for(let q=cws.length-1;q>=Math.max(0,cws.length-3);q--){if(_timkSing(cws[q])===hs&&q-(hw.length-1)>=1){v=a.slice(0,clauseStart)+cws.slice(0,q-(hw.length-1)).join(' ')+' '+rest;done=true;break;}}if(done)break;}}
        if(at>0){v=a.slice(0,clauseStart)+clause.slice(0,at)+rest;done=true;break;}
        continue;
      }
      b=b.replace(/^(?:it's|its|it\s+is|that's|thats|they're|theyre)\s+[^,.]{0,40},\s*(?=\S)/i,'');
      const bNoSubj=b.replace(/^(?:we'll|we\s+will|we're\s+gonna|we're|we|i'll|i'm\s+gonna)\s+/i,'');
      if(bNoSubj!==b&&_timkVerbLike((bNoSubj.split(/\s+/)[0]||'').toLowerCase()))b=bNoSubj;
      const w0=(b.split(/\s+/)[0]||'').toLowerCase().replace(/[^a-z]/g,'');
      // "pour a pad no wait set it on the composite pad": a new action replaces
      // the one he started, back to where that one began.
      {
        const cw=_timkTidy(clause.replace(/^[\s,]+/,'')).toLowerCase().split(/\s+/);
        if(_timkVerbLike(w0)&&!_TIMK_NOUNISH.has(w0)&&cw.length&&_timkVerbLike(cw[0])&&clause.toLowerCase().indexOf(w0)<0){
          // Back to the last comma or joining word in the clause.
          const cut=Math.max(clause.lastIndexOf(','),clause.search(/\s(?:and\s+then|then|and)\s(?!.*\s(?:and\s+then|then|and)\s)/i));
          const head=a.slice(0,clauseStart).replace(/\s*$/,clauseStart>0?' ':'');
          v=head+(cut>0?clause.slice(0,cut+1).replace(/^\s+/,'')+' ':'')+b;done=true;break;
        }
      }
      if(w0.length>=3){
        const at=clause.toLowerCase().lastIndexOf(w0);
        if(at>=0&&(at===0||/[\s,]/.test(clause[at-1]))){
          v=a.slice(0,clauseStart)+clause.slice(0,at)+b;done=true;break;
        }
      }
    }
    if(!done)break;
  }
  return v;
}
const _TIMK_SHEEN=/\b(?:flat|matte|eggshell|satin|pearl|low\s+sheen|semi[\s-]?gloss|high[\s-]?gloss|gloss)\b/i;
// "Gravel backfill. 60 feet no scratch that 64 feet": he reached back to a
// number said earlier. It is fixed where he first said it, and the correction
// itself is not a step. "Make that semi gloss" after a sheen swaps the sheen.
function _timkReachBack(text){
  let v=String(text||'');
  // "Open the wall from the closet side. Actually, open it from the bedroom
  // side.": the same job said again, differently. The second one stands.
  v=v.replace(/(^|[.!?]\s+)([A-Za-z]+)([^.!?]*[.!?])\s+(?:actually|no\s+wait|wait)[,]?\s+([A-Za-z]+)(?=\s)/gi,(m,pre,v1,rest,v2)=>v1.toLowerCase()===v2.toLowerCase()&&_timkVerbLike(v1.toLowerCase())?pre+v2:m);
  v=v.replace(/(^|[.!?]\s+)(\d[\d,.]*)\s+([a-z]+)[,]?\s+(?:no[,]?\s+)?(?:wait[,]?\s+)?(?:scratch\s+that|i\s+mean|make\s+(?:that|it))[,]?\s+(\d[\d,.]*)\s+\3\b[.!?]?/gi,(m,pre,n1,unit,n2,off,str)=>{
    const earlier=str.slice(0,off);
    const re=new RegExp('\\b'+n1.replace(/[.,]/g,'\\$&')+'\\s+'+unit+'\\b','gi');
    let q,lastAt=-1;while((q=re.exec(earlier)))lastAt=q.index;
    if(lastAt<0)return m;
    v=null;return '\u0000'+lastAt+'\u0001'+n2+'\u0002'+pre;
  });
  const mk=v.match(/\u0000(\d+)\u0001([^\u0002]+)\u0002/);
  if(mk){
    const at=+mk[1],n2=mk[2];
    let w=v.replace(/\u0000\d+\u0001[^\u0002]+\u0002/,'');
    const n1=(w.slice(at).match(/^\d[\d,.]*/)||[''])[0];
    w=w.slice(0,at)+n2+w.slice(at+n1.length);
    v=w.replace(/\s+([.!?])/g,'$1').replace(/[.!?]\s*$/,m=>m).trim();
  }
  v=v.replace(/([^.!?]*?)(\b(?:flat|matte|eggshell|satin|pearl|low\s+sheen|semi[\s-]?gloss|high[\s-]?gloss|gloss)\b)([^.!?]*)[.!?]\s+(?:no[,]?\s+|actually[,]?\s+|wait[,]?\s+)*make\s+(?:that|it)\s+((?:flat|matte|eggshell|satin|pearl|low\s+sheen|semi[\s-]?gloss|high[\s-]?gloss|gloss)(?:\s+(?:finish|sheen))?)\s*([.!?]|$)/gi,
    (m,a,old,b,nu,end)=>a+nu.replace(/\s+(?:finish|sheen)$/i,'')+b+(end||''));
  return v;
}
function _timkCorrect(text){
  let v=_timkRedo(_timkReachBack(String(text||'')));
  for(let guard=0;guard<30;guard++){
    const m=v.match(_TIMK_FIXNUM);
    if(!m)break;
    const at=m.index,before=v.slice(0,at),after=v.slice(at+m[0].length);
    // The number he is fixing: the last one before this, no more than one
    // sentence back ("Put in 2 valves. No wait, make that 3.").
    const nums=[...before.matchAll(/\$?\d+(?:\.\d+)?/g)];
    let last=nums[nums.length-1];
    const unitW=(after.replace(/^\s+/,'').match(/^([A-Za-z]+)/)||[])[1]||'';
    // "32 by 60 shower base, no, make that 36 by 60": the size, both numbers.
    {const dim=after.match(/^\s*(?:by|x)\s*(\d+(?:\.\d+)?)/i);
     if(dim){const ds=[...before.matchAll(/(\d+(?:\.\d+)?)\s*(?:by|x)\s*(\d+(?:\.\d+)?)/gi)];const dl=ds[ds.length-1];
       if(dl){v=before.slice(0,dl.index)+m[1]+' by '+dim[1]+before.slice(dl.index+dl[0].length).replace(/[\s,.;!?]+$/,'')+(m[2]&&/[.!?;]/.test(m[2])?m[2].replace(/,/g,''):'')+after.slice(dim[0].length).replace(/^[\s,]*/,/^[\s,]*[.!?;]/.test(after.slice(dim[0].length))?'':' ').replace(/^\s+$/,'');continue;}}}
    // "add 6 recessed lights, 4 inch wafers. No wait make that 8 lights": the
    // number he is fixing is the one his unit belongs to, two sentences back at
    // most.
    if(unitW&&_timkSing(unitW).length>=3){
      const reach=before.slice(Math.max(0,(()=>{let k=before.length,c=0;while(k>0){k--;if(/[.!?]/.test(before[k])&&++c>2)break;}return k;})()));
      const off=before.length-reach.length;
      const hit=nums.slice().reverse().find(n=>n.index>=off&&before.slice(n.index+n[0].length).split(/\s+/).filter(Boolean).slice(0,4).some(x=>_timkSing(x)===_timkSing(unitW)));
      if(hit)last=hit;
      else{
        // "self closing self latching gate, make that 2 gates": a count on a
        // thing he never counted goes in front of it.
        const sb=before.replace(/[\s,.;!?]+$/,'');const cs=Math.max(sb.lastIndexOf('. '),sb.lastIndexOf('! '),sb.lastIndexOf('? '))+1;
        const cl=sb.slice(cs);const cw=cl.trim().split(/\s+/);
        const wi=cw.map(x=>_timkSing(x)).lastIndexOf(_timkSing(unitW));
        if(wi>=0&&wi>=cw.length-2){
          let st=0;for(let q=wi-1;q>=0;q--){if(/^(?:a|an|the|one)$/i.test(cw[q])){st=q;cw.splice(q,1);break;}}
          const wi2=cw.map(x=>_timkSing(x)).lastIndexOf(_timkSing(unitW));
          cw[wi2]=cw[wi2].replace(/[A-Za-z]+/,unitW);cw.splice(st,0,m[1]);
          const lead=sb.slice(0,cs)+(cs?' ':'');
          v=lead+cw.join(' ')+(m[2]&&/[.!?;]/.test(m[2])?m[2].replace(/,/g,''):'.')+after.replace(/^\s*[A-Za-z]+/,'').replace(/^[\s,]*/,' ').replace(/^\s+$/,'');continue;
        }
      }
    }
    const between=last?before.slice(last.index+last[0].length):'';
    if(!last||(between.match(/[.!?]/g)||[]).length>2){
      // Nothing to fix: leave his words alone, but never loop on them.
      v=before+m[0].replace(/make/i,'make\u200b')+after;continue;
    }
    let nu=m[1];
    if(/^\$/.test(last[0])&&!/^\$/.test(nu))nu='$'+nu;
    let btw=between.replace(/[\s,.;!?]+$/,''),aft=after;
    // "about 60 feet. Make that 72 feet", "1 slider. Make that 2 sliders": the
    // word he said again is said once, in the form he said it the second time.
    {const aw=aft.replace(/^\s+/,'').match(/^([A-Za-z]+)([,.;!?]*)(?=\s|$)/);
     if(aw){const bw=btw.split(/(\s+)/);let hit=-1;
       for(let j=0,n=0;j<bw.length&&n<4;j++){if(!bw[j].trim())continue;n++;if(_timkSing(bw[j])===_timkSing(aw[1])&&_timkSing(aw[1]).length>=2){hit=j;break;}}
       if(hit>=0){bw[hit]=bw[hit].replace(/[A-Za-z]+/,aw[1]);btw=bw.join('');aft=aw[2]+aft.replace(/^\s+/,'').slice(aw[0].length);}}}
    const head=before.slice(0,last.index)+nu+btw;
    const tailP=(m[2]&&/[.!?;]/.test(m[2])?m[2].replace(/,/g,''):'');
    v=head+(/^[,.;!?]/.test(aft)?aft.match(/^[,.;!?]+/)[0].replace(/,/g,'')+' '+aft.replace(/^[,.;!?]+\s*/,''):tailP+(aft.trim()?' '+aft.replace(/^\s+/,''):''));
  }
  v=v.replace(/\u200b/g,'');
  for(let guard=0;guard<30;guard++){
    const m=v.match(_TIMK_SCRATCH);
    if(!m)break;
    // "Actually scratch that": the "actually" is his, the clause before it is
    // the one going.
    const before=v.slice(0,m.index).replace(/(?:[\s,.;!?]+(?:actually|no|nope|oh|oops|wait|okay|ok|sorry|so))+$/i,'').replace(/[\s,.;!?]+$/,'');
    const after=v.slice(m.index+m[0].length);
    let cut=0,c;
    const re=new RegExp(_TIMK_CLAUSE_END.source,'gi');
    while((c=re.exec(before)))cut=c.index+c[0].length;
    // With no punctuation (an old build) the "clause" could be half the job.
    // Only the last step in it goes: the same seams the steps are split on.
    const region=before.slice(cut);
    const pieces=_timkSoftSplit(region).reduce((a,p)=>a.concat(_timkVerbSplit(p)),[]);
    const kept=pieces.length>1?pieces.slice(0,-1).join(' ').trim():'';
    const keep=(before.slice(0,cut).replace(/\s(?:and then|then|after that|next|also)\s*$/i,' ')+(kept?kept+'.':'')).replace(/\s+$/,'');
    v=(keep?keep+(/[.!?;,]$/.test(keep)?'':'.'):'')+(after.trim()?' '+after.replace(/^\s+/,''):'');
  }
  // "with an 10 pound pad" after a number was fixed: the article follows the
  // new number.
  v=v.replace(/\b(a|an)\s+(\d[\d,.]*)/gi,(m,art,n)=>{
    const d=n.replace(/[,]/g,'');
    const an=/^8/.test(d)||/^(?:11|18)(?:\D|$)/.test(d)||/^1[18]\d{3}(?:\D|$)/.test(d);
    const want=an?'an':'a';
    return (/^A/.test(art)?want.charAt(0).toUpperCase()+want.slice(1):want)+' '+n;
  });
  return v.replace(/([.!?])[.!?]+/g,'$1').replace(/\s+/g,' ').trim();
}
// Line by line: a list he typed keeps its lines, and a correction on one line
// never reaches into the line above it.
function _timkClean(text){
  return String(text||'').split(/(\r?\n+)/).map((seg,i)=>(i%2)?seg:_timkCorrect(_timkNumbers(_timkUnfill(_timkHeard(seg))))).join('');
}

// ── WHAT THE PHONE HEARD WRONG (Blake Sample, 2026-09-28) ───────────────────
//
// Said: "Bradford White install, we're putting a Corro-Protec powered anode rod
// in, we'll be removing the old, putting in the new." Heard: "Bradford White.
// Install where putting a core protect powered and load rod in will be removing
// the old, putting in the new." Tim then split it into "Install where" and "Rod
// in will be", which went on a proposal.
//
// Two kinds of fix, both narrow:
//   1. Trade words the recognizer has no idea exist. Only whole phrases that
//      mean nothing else on a job ("powered and load rod" is never English).
//   2. "we're" and "we'll" heard as "where", "were" and "will". Only in front
//      of a work verb ending in -ing, which "where" never is in a scope.
const _TIMK_HEARD=[
  [/\b(?:core|chorro|coro|cora|corrow|corro)[\s-]*(?:protect|protec|protech|pro\s+tech|pro\s+tec)\b/gi,'Corro-Protec'],
  [/\bpower(?:ed)?\s+(?:and\s+load|an\s+old|and\s+old|an\s+ode|and\s+owed|a\s+node)(?=\s+rods?\b)/gi,'powered anode'],
  [/\b(?:and\s+load|an\s+old|and\s+owed|a\s+node)(?=\s+rods?\b)/gi,'anode'],
  // Blake Sample, second try (logged 2026-09-28): "Adding in A protect powered
  // rod". The brand lost its first half and "anode" was never heard at all.
  // Only in front of "powered rod", where "protect" cannot mean anything else.
  [/\b(?:a|the)\s+(?:protect|protec|protech|pro\s+tech)(?=\s+power(?:ed)?\s+(?:anode\s+)?rods?\b)/gi,'a Corro-Protec'],
  [/\bpower(?:ed)?\s+(rods?)\b/gi,'powered anode $1'],
  [/\b(?:a\s+)?a\s+protect(?=\s+(?:powered\s+)?anode\b)/gi,'a Corro-Protec'],
  // ── THE TRADE'S OWN WORDS, AS THE PHONE HEARS THEM (2026-09-28) ─────────
  // From 240 job walks across eight trades. Two kinds of entry. A phrase that
  // means nothing else ("Sherman Williams", "roam ex") is fixed wherever it
  // appears. A phrase that IS an ordinary word ("train", "cooler", "kills",
  // "flew") is fixed only next to the thing it names, so "train the new guy"
  // and "the cooler in the garage" are left alone.
  // Paint
  [/\b(?:sherman|sherwin)[\s-]+williams?\b/gi,'Sherwin-Williams'],
  [/\bbenjamin\s+(?:more|moor)\b/gi,'Benjamin Moore'],
  [/\b(?:zincer|zinser|zinzer)\b/gi,'Zinsser'],
  [/\b(Zinsser\s+)bin\b/gi,'$1BIN'],
  [/\b((?:prime|primed|primer|spot\s+prime)\b[^,.;]{0,40}?\bwith\s+)bin\b/gi,'$1BIN'],
  [/\b((?:prime|primed|primer|spot\s+prime)\b[^,.;]{0,40}?\bwith\s+)(?:kills|kilz|kiltz)\b/gi,'$1Kilz'],
  [/\b((?:prime|primed|primer)\b[^,.;]{0,40}?\bwith\s+)guards\b/gi,'$1Gardz'],
  [/\bsuper\s+paint\b/gi,'SuperPaint'],
  [/\bpro\s+mar\b/gi,'ProMar'],
  [/\blocks\s+on\b(?=\s+(?:masonry|primer|top|paint|coat|xp|\d))/gi,'Loxon'],
  [/\bcrud\s+cutter\b/gi,'Krud Kutter'],
  [/\balex\s+plus\b/gi,'Alex Plus'],
  [/\bbear\b(?=\s+(?:marquee|premium|ultra|dynasty|scuff|paint|pro|epoxy|stain|primer|deck|floor|porch|semi[\s-]?(?:solid|transparent)|solid|transparent|deckover|advanced|elastomeric)\b)/gi,'Behr'],
  [/\badvanced\b(?=\s+(?:satin|semi|semi-gloss|gloss|pearl|in\s+(?:satin|semi|gloss|pearl)))/gi,'Advance'],
  [/\bcock(ing|ed)?\b(?=\s+(?:all|the|around|every|it|them|gaps|joints|seams|windows|trim|with|any|up)\b)/gi,(m,e)=>'caulk'+(e||'')],
  [/\bhate\s+blue\b/gi,'haint blue'],
  [/\bshudders\b/gi,'shutters'],
  // Siding, roofing, windows, decking
  [/\bhardy(?=\s+(?:board|siding|trim|plank|panel|backer|soffit|lap|shingle)\b)/gi,'Hardie'],
  [/\b(?:gee|g)\s*a\s*f\b|\bgee\s+af\b/gi,'GAF'],
  [/\bowens\s+corn(?:y|ey|ie)\b/gi,'Owens Corning'],
  [/\bcertain\s+teed\b/gi,'CertainTeed'],
  [/\bice\s+and\s+water\s+field\b/gi,'ice and water shield'],
  [/\b(step|counter|drip|valley|chimney|kick\s?out|head|apron|base|wall)\s+fashion\b/gi,'$1 flashing'],
  [/\bv\s*lux\b|\bvee\s+lux\b/gi,'Velux'],
  [/\bpearlings?\b/gi,'purlins'],
  [/\bgrays(?=\s+(?:ice|tri-?flex|vycor)\b)/gi,'Grace'],
  [/\bhale(?=\s+(?:damage|damaged|storm|claim|hit|dents?)\b)/gi,'hail'],
  [/\bsoff?et\b|\bsofit\b/gi,'soffit'],
  [/\bfashia\b|\bfacia\b/gi,'fascia'],
  [/\bdown\s+spots?\b/gi,'downspouts'],
  [/\btree\s+(?:x|ex)\b/gi,'Trex'],
  [/\btimber\s+tech\b/gi,'TimberTech'],
  [/\banderson(?=\s+(?:windows?|doors?|\d{3}|series|a-series|e-series|renewal)\b)/gi,'Andersen'],
  [/\bbella(?=\s+(?:lifestyle|impervia|reserve|windows?|doors?)\b)/gi,'Pella'],
  [/\blife\s+proof\b/gi,'LifeProof'],
  [/\bper\s+go\b/gi,'Pergo'],
  [/\bsimpson\s+strong\s+tie\b/gi,'Simpson Strong-Tie'],
  // Tile, drywall, concrete
  [/\b(?:shlooter|schlooter|shluter)\b/gi,'Schluter'],
  [/\b(?:curdy|kurdy|kerdy)\b/gi,'Kerdi'],
  [/\bdetra\b/gi,'Ditra'],
  [/\bred\s+guard\b/gi,'RedGard'],
  [/\bdo\s+rock\b/gi,'Durock'],
  [/\bmap\s*a\b(?=\s+(?:aqua|ultra|flex|keracolor|grout|thinset))|\bmapay\b/gi,'Mapei'],
  [/\bquick\s*crete\b/gi,'Quikrete'],
  [/\bsack\s*crete\b/gi,'Sakrete'],
  [/\boh\s+s\s+i\b/gi,'OSI'],
  [/\bdry\s+wall\b/gi,'drywall'],
  [/\bdoor\s+jams\b/gi,'door jambs'],
  [/\bsealing\s+fans?\b/gi,m=>/s$/i.test(m)?'ceiling fans':'ceiling fan'],
  [/\bwhisper\s+ceiling\b/gi,'WhisperCeiling'],
  // Plumbing
  [/\bnavy\s+in\b/gi,'Navien'],
  [/\b(?:renai|rin\s+eye|ren\s+eye|rinai)\b/gi,'Rinnai'],
  [/\byou\s+p[ao]nd?\s+or\b|\bu\s*pon\s*or\b/gi,'Uponor'],
  [/\bshark\s+bites?\b/gi,m=>/s$/i.test(m)?'SharkBites':'SharkBite'],
  [/\bpecks\b/gi,'PEX'],
  [/\bmoan(?=\s+(?:\w+\s+)?(?:faucet|pull\s+(?:down|out)|pulldown|pull-down|valve|trim|cartridge|arbor|align|posi|kitchen|shower|tub|brantford)\b)/gi,'Moen'],
  [/\bmo\s+and\s+align\b/gi,'Moen Align'],
  [/\bposs?e\s+temp\b/gi,'Posi-Temp'],
  [/\bin\s*sink\s*(?:a\s*|er\s*)?(?:racer|rater|raider|erator|rator|raider)\b/gi,'InSinkErator'],
  [/\bwood\s+ford\b/gi,'Woodford'],
  [/\btrack\s+pipe\b/gi,'TracPipe'],
  [/\bwhat's(?=\s+(?:[A-Z]{1,3}\d|\d{2,}|LF|lf)\w*)/g,'Watts'],
  [/\bzola(?=\s+(?:m\d+|\d+|sump|pump)\b)/gi,'Zoeller'],
  [/\bweed\s+eat(ing|er)?\b/gi,(m,e)=>'weed eat'+(e||'')],
  [/\bflex(?=\s+\d{4}\b)/gi,'Fleck'],
  [/\borange\s+burg\b/gi,'Orangeburg'],
  [/\b(?:coaler|cooler)(?=\s+(?:highline|cimarron|wellworth|toilet|generator|\d+\s*kw|faucet|sink|tub)\b)/gi,'Kohler'],
  [/\bshrader\b/gi,'Schrader'],
  [/\b((?:the|a|new|water\s+heater|furnace|boiler|b-vent|b\s+vent)\s+)flew\b/gi,'$1flue'],
  [/\bhot\s+service\s+igniter\b/gi,'hot surface igniter'],
  [/\ba\s*o\s+smith\b|\ba\s+oh\s+smith\b/gi,'AO Smith'],
  [/\bin\s+ds\b(?=\s+(?:drain|basin|catch|pop|channel|grate))/gi,'NDS'],
  // HVAC
  [/\btrain(?=\s+(?:\d+(?:\.\d+)?\s*ton|furnace|condenser|unit|system|heat\s+pump|ac|a\/c|xr\w*|xl\w*|xv\w*|s9\w*|coil|air\s+handler|package)\b)/gi,'Trane'],
  [/\becho\s+bee\b/gi,'Ecobee'],
  [/\bmany\s+splits?\b/gi,m=>/s$/i.test(m)?'mini splits':'mini split'],
  [/\bfuji\s+(?:two|2|too|to)\b/gi,'Fujitsu'],
  [/\barrow\s+seal\b/gi,'Aeroseal'],
  // Electrical
  [/\bsquare\s+(?:dee|d)\b/gi,'Square D'],
  [/\b(?:roam|rome|roman)\s+(?:ex|x)\b/gi,'Romex'],
  [/\b(?:lou|loo|loot)\s+(?:tron|ron)\b/gi,'Lutron'],
  [/\b(Lutron\s+)cassette\b/gi,'$1Caseta'],
  [/\bleviathan\b/gi,'Leviton'],
  [/\bseaman'?s(?=\s+(?:panel|breaker|box|load\s+center|200|100|main)\b)/gi,'Siemens'],
  [/\b(\d+\s*kw\s+)generic\b|\bgeneric(?=\s+(?:generator|standby|guardian)\b)/gi,(m,kw)=>(kw||'')+'Generac'],
  [/\bcharge\s+point\b/gi,'ChargePoint'],
  [/\b(?:gf|g\s*f)\s+see\s+eye\b/gi,'GFCI'],
  [/\b(?:af|a\s*f)\s+see\s+eye\b/gi,'AFCI'],
  [/\bal\s+you\s+mi\s+con\b|\balumi\s+con\b/gi,'AlumiConn'],
  [/\bzinc\s+co\b/gi,'Zinsco'],
  [/\bnob\s+and\s+tube\b/gi,'knob and tube'],
  [/\b(?:brawn|brone)(?=\s+(?:\w+\s+)?(?:exhaust|fan|bath|vent|range\s+hood)\b)/gi,'Broan'],
  // Landscaping
  [/\brain\s+bird\b/gi,'Rain Bird'],
  [/\b(hunter\s+)pro\s+(?:c|see|sea)\b/gi,(m,h)=>'Hunter Pro-C'],
  [/\bbell\s+guard\b/gi,'Belgard'],
  [/\btauro\b/gi,'Toro'],
  [/\bround\s+up\b(?=\s|,|\.|$)(?<=(?:with|of|some|spray)\s+round\s+up)/gi,'Roundup'],
  [/\bcrate\s+myrtles?\b/gi,m=>/s$/i.test(m)?'crape myrtles':'crape myrtle'],
  [/\byo\s+pon\b/gi,'yaupon'],
  [/\bpoly\s+metric\b/gi,'polymeric'],
  [/\baireate\b/gi,'aerate'],
  // The holdout walks (2026-09-28): brands the phone spells as ordinary words.
  [/\bsilly\s+stone\b/gi,'Silestone'],
  // "five eighths type X", "three quarter inch branches": a size, as written.
  [/\b(one|three|five|seven)\s+eighths?\b/gi,(m,n)=>({one:1,three:3,five:5,seven:7}[n.toLowerCase()])+'/8'],
  [/\b(one|three)\s+quarters?(?=\s+(?:inch|thick|plywood|ply|osb|sheathing|advantech)\b)/gi,(m,n)=>({one:1,three:3}[n.toLowerCase()])+'/4'],
  [/\bmalarky\b/gi,'Malarkey'],
  // Set C (2026-09-28).
  [/\bcontact\s+her\b/gi,'contactor'],
  [/\bfew\s+jitsu\b|\bfu\s+jitsu\b/gi,'Fujitsu'],
  [/\b(?:jenna|jen|gen)\s+rack\b/gi,'Generac'],
  [/\beaten(?=\s+(?:sub\s*panel|panel|breakers?|load\s+center|br|ch|meter)\b)/gi,'Eaton'],
  [/\blenox(?=\s+(?:evaporator|coil|furnace|condenser|system|unit|heat\s+pump|air\s+handler|ml|el|xc|sl)\b)/gi,'Lennox'],
  [/\bgaff?(?=\s+(?:timberline|shingles?|hdz|royal|grand|natural|lifetime))/gi,'GAF'],
  [/\bzoller\b/gi,'Zoeller'],
  [/\b(Lutron\s+)(?:casita|cassetta|caseda)\b/gi,'$1Caseta'],
  [/\bnew\s+heat(?=\s+(?:heated|floor|mat|thermostat|cable|system)\b)/gi,'Nuheat'],
  [/\bself[\s-]level(?=\s+(?:the|it|them|all|any|low|floor|where)\b)/gi,'self-level'],
  [/\bwring(?=\s+(?:floodlight|flood\s+light|doorbell|door\s+bell|camera|cam|spotlight|video)\b)/gi,'Ring'],
  [/\bflu(?:id)?\s+master\b/gi,'Fluidmaster'],
  [/\belf(?:\s+uh)?(?=\s+closet\b)/gi,'Elfa'],
  [/\bvel+ux\b/gi,'Velux'],
  [/\bslue\s+ter\b|\bsl(?:oo|u)ter\b/gi,'Schluter'],
  [/\boh\s+wins?\s+corn(?:ing|y|ey)\b|\bowens?\s+corny\b/gi,'Owens Corning'],
  [/\bcab\s+it(?=\s+(?:in|semi|solid|stain|transparent|oil|deck|australian)\b)/gi,'Cabot'],
  [/\b(semi[\s-]?(?:transparent|solid)\s+)cab\s+it\b/gi,'$1Cabot'],
  [/\b((?:prime|primed|primer|spot\s+prime)\b[^,.;]{0,40}?\bwith\s+)sticks\b/gi,'$1Stix'],
  [/\btimber\s+line\b/gi,'Timberline'],
  [/\bhome\s+line\b/gi,'Homeline'],
  [/\blime\s+light\b/gi,'Limelight'],
  [/\bsick\s*a\s*flex\b|\bsika\s+flex\b/gi,'Sikaflex'],
  [/\bamery\s+star\b/gi,'Ameristar'],
  [/\bdog\s+year\b/gi,'dog ear'],
  [/\bfor\s+tress(?=\s+(?:black|aluminum|railing|rail|evolution|steel|fe26|vinyl)\b)/gi,'Fortress'],
  [/\bpost\s+master\b/gi,'Postmaster'],
  [/\btie\s+vek\b|\btyvec\b|\bty\s+vek\b/gi,'Tyvek'],
  [/\bmust\s+kit\b/gi,'musket'],
  [/\brap\s+tor(?=\s+(?:stainless|mesh|guards?|gutter)\b)/gi,'Raptor'],
  [/\bscreen\s+tight\b/gi,'Screen Tight'],
  [/\bjeld\s+win\b/gi,'JELD-WEN'],
  [/\bcarved\s+wood(?=\s+\d)/gi,'Carvedwood'],
  [/\byou\s+poner\b/gi,'Uponor'],
  [/\bfuji\s+(?:sue|sou|zoo|two|2|too|to)\b/gi,'Fujitsu'],
  [/\b(?:one|1)\s+by\s+(three|four|six|eight|ten|twelve|3|4|6|8|10|12)\b/gi,(m,n)=>'1x'+({three:3,four:4,six:6,eight:8,ten:10,twelve:12}[String(n).toLowerCase()]||n)],
  [/\b(?:four|4)\s+by\s+(?:four|4)\b/gi,'4x4'],
  [/\b((?:with|a|an|new|the)\s+)(?:brone|brawn)\b/gi,'$1Broan'],
  [/\b(Mapei\s+)aqua\s+defen[cs]e\b/gi,'$1AquaDefense'],
  [/\b(Pergo\s+)outlast\s+plus\b/gi,'$1Outlast+'],
  [/\bcaesar\s+stone\b/gi,'Caesarstone'],
  [/\bquick\s+set(?=\s+(?:smart|locks?|deadbolts?|handles?|levers?|knobs?|keyed|entry|door|signature|halo|smartcode|aura)\b)/gi,'Kwikset'],
  [/\b(?:sure|shore)(?=\s+(?:lvp|lvt|carpet|floor|flooring|vinyl|plank|laminate|hardwood|floorte)\b)/gi,'Shaw'],
  [/\b(Mapei\s+)flex\s+colou?r\b/gi,'$1Flexcolor'],
  [/\bmap\s+a\s+flex\s+colou?r\b/gi,'Mapei Flexcolor'],
  [/\b(?:seeker|seeka|sicka)\s+flex\b/gi,'Sikaflex'],
  [/\b(?:a\s+)?zeke(?=\s+(?:decking|deck|boards?|trim|railing|pvc|harvest|vintage|timbertech)\b)/gi,'Azek'],
  [/\bkaren\s+dean\b/gi,'Karndean'],
  [/\bcore\s*tech\b/gi,'COREtec'],
  [/\bquick\s+(?:treat|tree|treet|reet)\b/gi,'Quikrete'],
  [/\b(?:tracks|trecks)(?=\s+(?:transcend|enhance|select|signature|decking|deck|boards?|railing)\b)/gi,'Trex'],
  [/\bfiber\s+on\b(?=\s+(?:composite|decking|deck|boards?|railing|good|sanctuary|paramount|promenade)\b)/gi,'Fiberon'],
  [/\ball\s+side(?=\s+(?:aluminum|vinyl|siding|soffit|trim|coil|charleston|prodigy)\b)/gi,'Alside'],
  [/\b(?:shooter|shluder|schluder)(?=\s+(?:edge|trim|strip|profile|jolly|rondec|schiene|kerdi|ditra|systems?|metal|transition)\b)/gi,'Schluter'],
  [/\badvantage\s+tech\b/gi,'AdvanTech'],
  [/\b(?:sure|shure|sher)\s+win\s+williams?\b/gi,'Sherwin-Williams'],
  [/\bsuper\s+deck\b/gi,'SuperDeck'],
  [/\bmill\s+guard\b/gi,'Milgard'],
  [/\bbona\s+traffic\b/gi,'Bona Traffic'],
  // "two by fours", "2 by 6s": lumber, written the way it is on a cut list.
  [/\b(?:two|2)\s+by\s+(four|six|eight|ten|twelve|4|6|8|10|12)(s)?\b/gi,(m,n,s)=>'2x'+({four:4,six:6,eight:8,ten:10,twelve:12}[String(n).toLowerCase()]||n)+(s||'')],
  [/\b(?:two|2)\s+by\s+(fours|sixes|eights|tens|twelves)\b/gi,(m,n)=>'2x'+({fours:4,sixes:6,eights:8,tens:10,twelves:12}[n.toLowerCase()])+'s'],
  [/\b(?:four|4)\s+by\s+(?:fours|4s)\b/gi,'4x4s'],
  [/\b(?:six|6)\s+by\s+(sixes|6s)\b/gi,'6x6s'],
];
// ── BRANDS BY SOUND (2026-09-28) ─────────────────────────────────────────
// A list of every misheard spelling is a list that is always one short: the
// blind test found "ream" for Rheem, "die kin" for Daikin, "see mens" for
// Siemens, "gen rack" for Generac, none of them in the table above. So brands
// are ALSO matched by how they sound: the first letter, the first vowel, then
// the consonants, with the spellings English gives one sound ("ph"/"f",
// "ck"/"k", "ee"/"ea") folded together. "ream" and "Rheem" both come out
// r-e-m; "room" comes out r-o-m and is left alone.
//
// A sound match is only trusted next to the trade: in front of a model number
// or a thing on a job ("ream gas unit", "hubble weather resistant"), or after
// a size or an article that is naming a product ("50 gallon ream", "a rude 96
// percent"). "Red oak" and "a rude customer" stay as he said them.
const _TIMK_SOUND_BRANDS=[
  // Plumbing
  ['Rheem',['rheem']],['Ruud',['ruud','rood']],['AO Smith',['aosmith']],['Bradford White',['bradfordwhite']],
  ['Navien',['navien','naveen']],['Rinnai',['rinnai','rinai']],['Noritz',['noritz']],['Takagi',['takagi']],
  ['Moen',['moen','mowen']],['Delta',['delta']],['Kohler',['kohler','koler']],['Pfister',['fister']],
  ['American Standard',['americanstandard']],['Gerber',['gerber']],['Mansfield',['mansfield']],['Toto',['toto']],
  ['Zoeller',['zoeller','zeller','zoler']],['Wayne',['wayne']],['Liberty',['liberty']],['Watts',['watts']],
  ['Zurn',['zurn']],['Uponor',['uponor','upnor']],['SharkBite',['sharkbite']],['InSinkErator',['insinkerator']],
  ['Fleck',['fleck','flek','flick']],['Culligan',['culligan']],['Woodford',['woodford']],['Oatey',['oatey']],
  ['Sioux Chief',['soochief']],['Fluidmaster',['fluidmaster']],['Grundfos',['grundfos']],['Taco',['tako']],
  ['State',['state']],['Rheem Marathon',['rheemmarathon']],['Corro-Protec',['coroprotec','koroprotek']],
  // HVAC
  ['Trane',['trane','train']],['Carrier',['carrier']],['Lennox',['lennox','lenox']],['Goodman',['goodman']],
  ['Daikin',['daikin','dykin']],['Mitsubishi',['mitsubishi']],['Fujitsu',['fujitsu']],['Bryant',['bryant']],
  ['York',['york']],['Amana',['amana']],['Payne',['payne']],['Heil',['heil']],['Tempstar',['tempstar']],
  ['American Standard',['americanstandard']],['Aprilaire',['aprilaire','aprilair']],['Honeywell',['honeywell']],
  ['Ecobee',['ecobee']],['Nest',['nest']],['Aeroseal',['aeroseal']],['Copeland',['copeland']],['Bosch',['bosch']],
  ['Emerson',['emerson']],['White-Rodgers',['whiterodgers']],['Weil-McLain',['weilmclain']],['Navien',['navien']],
  // Electrical
  ['Square D',['squared']],['Siemens',['siemens','seemens']],['Eaton',['eaton','eeton']],['Cutler-Hammer',['cutlerhammer']],
  ['Leviton',['leviton','levelton','leveton']],['Lutron',['lutron']],['Hubbell',['hubbell','hubble']],['Legrand',['legrand']],
  ['Generac',['generac','genrac']],['Kohler',['kohler']],['Champion',['champion']],['Halo',['halo']],['Broan',['broan','brone']],
  ['Panasonic',['panasonic']],['ChargePoint',['chargepoint']],['Emporia',['emporia']],['Zinsco',['zinsco']],
  ['Federal Pacific',['federalpacific']],['Murray',['murray']],['Intermatic',['intermatic']],['Southwire',['southwire']],
  // Roofing, siding, windows, decks
  ['GAF',['gaf']],['Owens Corning',['owenscorning']],['CertainTeed',['certainteed']],['Malarkey',['malarkey','malarky']],
  ['Tamko',['tamko']],['IKO',['iko']],['Atlas',['atlas']],['Velux',['velux']],['Hardie',['hardie']],['LP SmartSide',['lpsmartside']],
  ['Andersen',['andersen']],['Pella',['pella']],['Marvin',['marvin']],['Milgard',['milgard','millguard']],['Simonton',['simonton']],
  ['Jeld-Wen',['jeldwen']],['ProVia',['provia']],['Trex',['trex']],['TimberTech',['timbertech']],['Azek',['azek','azeke','azeek']],
  ['Fiberon',['fiberon']],['Simpson',['simpson']],['Grace',['grace']],
  // Paint and finishes
  ['Sherwin-Williams',['sherwinwilliams']],['Benjamin Moore',['benjaminmoore']],['Behr',['behr','bair']],['Valspar',['valspar']],
  ['PPG',['ppg']],['Glidden',['glidden']],['Kilz',['kilz']],['Zinsser',['zinsser']],['Cabot',['cabot']],['Olympic',['olympic']],
  ['Minwax',['minwax']],['Rust-Oleum',['rustoleum']],['Thompson\'s',['thompsons']],['Ready Seal',['readyseal']],
  ['Bona',['bona']],['DAP',['dap']],['Loxon',['loxon']],
  // Tile, flooring, concrete, hardscape, landscape
  ['Schluter',['schluter','shlooter']],['Kerdi',['kerdi']],['Ditra',['ditra']],['RedGard',['redgard']],['Mapei',['mapei']],
  ['Laticrete',['laticrete']],['Custom',['custom']],['Durock',['durock']],['Silestone',['silestone']],['Cambria',['cambria']],
  ['Caesarstone',['caesarstone']],['Shaw',['shaw']],['Mohawk',['mohawk']],['LifeProof',['lifeproof']],['Pergo',['pergo']],
  ['COREtec',['coretec']],['Armstrong',['armstrong']],['Quikrete',['quikrete']],['Sakrete',['sakrete']],['Sika',['sika','seeka']],
  ['Belgard',['belgard']],['Versa-Lok',['versalok','versalock']],['Unilock',['unilock']],['Pavestone',['pavestone']],['Techo-Bloc',['techobloc']],
  ['Rain Bird',['rainbird']],['Hunter',['hunter']],['Toro',['toro']],['Orbit',['orbit']],['Stihl',['stihl','steel']],
  ['Husqvarna',['husqvarna']],['Scotts',['scotts']],['Roundup',['roundup']],
];
function _timkSoundKey(w){
  let t=String(w||'').toLowerCase().replace(/[^a-z]/g,'');
  if(!t)return '';
  t=t.replace(/^pf/,'f').replace(/ph/g,'f').replace(/ck/g,'k').replace(/q/g,'k').replace(/x/g,'ks')
    .replace(/c(?=[eiy])/g,'s').replace(/c/g,'k').replace(/z/g,'s').replace(/(?<=[a-z])h/g,'')
    .replace(/ai|ay|ie|ei|ey|igh|y(?=[^aeiou]|$)/g,'i').replace(/ee|ea/g,'e').replace(/oa|oe|ow/g,'o').replace(/oo|ou|ue|ui/g,'u');
  const first=t[0];
  const vowel=(t.slice(/[aeiou]/.test(first)?0:1).match(/[aeiou]/)||[''])[0];
  const cons=t.slice(1).replace(/[aeiouy]/g,'').replace(/(.)\1+/g,'$1');
  return first+(/[aeiou]/.test(first)?'':vowel)+cons;
}
const _TIMK_BRAND_KEYS=(()=>{const m=new Map();_TIMK_SOUND_BRANDS.forEach(([name,sounds])=>sounds.forEach(x=>{const k=_timkSoundKey(x);if(k.length>=3&&!m.has(k))m.set(k,name);}));return m;})();
// What a brand sits next to on a job.
const _TIMK_TRADE_NEXT=/^(?:decora|kitchen|bathroom|bath|shower|tub|sink|pulldown|surge|whole|exhaust|cfm|standby|smart|pro|max|ultra|premium|series|model|brand|gas|electric|tankless|tank|unit|water|heater|furnace|condenser|coil|air|heat|mini|ac|system|panel|breaker|breakers|box|meter|switch|switches|outlet|outlets|receptacles?|gfci|gfcis|dimmer|dimmers|fan|fans|light|lights|fixture|faucet|faucets|toilet|toilets|valve|valves|disposal|pump|sump|softener|filter|thermostat|humidifier|dehumidifier|generator|standby|charger|shingles?|underlayment|siding|trim|board|windows?|doors?|decking|railing|paint|primer|stain|sealer|epoxy|caulk|grout|thinset|mortar|tile|pavers?|block|wall|flooring|plank|carpet|countertops?|quartz|cabinets?|controller|heads?|rotors?|timer|weather|signature|duration|emerald|advance|regal|aura|superpaint|semi|solid|transparent|vista|timberline|legacy|landmark|oakridge|performance|comfort|infinity|xr\w*|xl\w*|\d[\w.\/-]*|[a-z]*\d[\w.\/-]*)$/i;
const _TIMK_TRADE_PREV=/^(?:a|an|the|new|with|of|by|to|in|\d[\w.\/-]*|gallon|ton|amp|inch|kw|btu|seer|horse|horsepower|percent)$/i;
const _TIMK_WORDS_NOT_BRANDS=/^(?:train|trane|custom|hunter|nest|delta|grace|atlas|champion|liberty|wayne|york|payne|orbit|steel|shaw|halo|dap|simpson|trex|toro|murray|carrier|armstrong|olympic|emerson)$/i;
function _timkSoundBrands(text){
  const toks=String(text||'').split(/(\s+)/);
  const words=[];for(let i=0;i<toks.length;i+=2)words.push(toks[i]);
  const out=[];let i=0;
  const clean=x=>String(x||'').replace(/[^A-Za-z0-9'\/.-]/g,'');
  while(i<words.length){
    let hit=null;
    for(let n=3;n>=1&&!hit;n--){
      if(i+n>words.length)continue;
      const span=words.slice(i,i+n);
      if(span.some(x=>/[,.;!?]$/.test(x)&&x!==span[span.length-1]))continue;
      // A sound is never built out of little words ("to the" is not Toto, "a
      // Moen" is not Amana) or out of a brand he already said right.
      if(n>1&&(/^(?:a|an|the|to|of|in|on|at|by|for|and|or|with|it|is|as|so|we|i|no|up|out|off|all|this|that)$/i.test(clean(span[0]))||span.some(x=>_TIMK_BRAND_KEYS.get(_timkSoundKey(x))&&/^[A-Z]/.test(x))))continue;
      const joined=span.map(clean).join('');
      if(joined.length<3||/\d/.test(joined))continue;
      const name=_TIMK_BRAND_KEYS.get(_timkSoundKey(joined));
      if(!name)continue;
      // Already right: leave his spelling alone.
      if(n===1&&joined.toLowerCase()===name.toLowerCase().replace(/[^a-z]/g,''))continue;
      // A common word that is also a brand ("state", "custom", "steel") is never
      // changed by sound; only its own misspellings are.
      if(n===1&&_TIMK_WORDS_NOT_BRANDS.test(clean(span[0])))continue;
      if(n===1&&_TIMK_WORDS_NOT_BRANDS.test(name.replace(/[^a-z]/gi,'')))continue;
      const prev=clean(words[i-1]||''),next=clean(words[i+n]||'');
      // Two or three words heard as one brand need more than "the" in front:
      // "change the locks on the front door" is not Loxon.
      const prevOk=_TIMK_TRADE_PREV.test(prev)&&!(n>1&&/^(?:the|in|by|of)$/i.test(prev));
      const ctx=_TIMK_TRADE_NEXT.test(next)||(n>1||_TIMK_TRADE_PREV.test(prev))&&(prevOk||_TIMK_TRADE_NEXT.test(next));
      if(!ctx)continue;
      // One common English word is only swapped with context on BOTH sides.
      if(n===1&&!(_TIMK_TRADE_NEXT.test(next)&&(_TIMK_TRADE_PREV.test(prev)||!prev||/^\d/.test(next))))continue;
      const tail=(span[span.length-1].match(/[,.;!?]+$/)||[''])[0];
      hit={n,text:name+tail};
    }
    if(hit){out.push(hit.text);i+=hit.n;}else{out.push(words[i]);i++;}
  }
  return out.join(' ');
}
function _timkHeard(seg){
  let v=String(seg||'');
  // Thinking out loud is not scope: "let me think", "what was it", "I think".
  v=v.replace(/[,\s]+(?:(?:uh|um)[,\s]+)?(?:let\s+me\s+think|what\s+was\s+it|what's\s+it\s+called|how\s+do\s+you\s+say\s+it)[,.]?(?=\s)/gi,'');
  // A restart: "with Unilock, uh, Unilock Beacon Hill" says the brand once.
  v=v.replace(/\b([A-Za-z][\w-]{2,})(?:,\s*(?:uh|um)?,?)\s+\1\b/g,'$1');
  v=v.replace(/\bin\s+DS\b/g,'NDS');
  v=v.replace(/\b(?:(?:okay|ok|so|alright)[,\s]+)*honey[\s-]+do\s+list(?:\s+here)?[,.]?\s*/gi,'');
  _TIMK_HEARD.forEach(([re,to])=>{v=v.replace(re,to);});
  v=v.split(/(\n)/).map(x=>x==='\n'?x:_timkSoundBrands(x)).join('');
  // ", will scrape and repaint the porch floor": "we'll" lost its subject.
  v=v.replace(/,(\s+)(will|well)(\s+)([a-z]+)\b/gi,(m,sp,w,sp2,vb)=>_TIMK_VERBS.has(vb.toLowerCase())?','+sp+"we'll"+sp2+vb:m);
  // "so first thing were gonna", "theres a belly": the apostrophes the phone
  // dropped.
  v=v.replace(/\btheres\b/gi,m=>m[0]==='T'?"There's":"there's").replace(/\bthats\b/gi,m=>m[0]==='T'?"That's":"that's");
  v=v.replace(/(^|\S+\s+)(were|where)(\s+(?:gonna|going\s+to|not))\b/gi,(m,pre,w,rest)=>/^(?:they|you|we|who|that|which|it|he|she|i)\W*\s+$/i.test(pre)?m:pre+(/^[A-Z]/.test(w)?"We're":"we're")+rest);
  // "item one, replace sump pump", "Notes from the Johnson basement.": how he
  // numbered his notes, not what is on them.
  v=v.replace(/\bitem\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s*[,:.]?\s*/gi,'');
  v=v.replace(/^(?:(?:okay|ok|so)[,\s]+)*notes?(?:\s+(?:from|for|on)\s+[^.!?]{0,40})?[.:]\s*/i,'');
  // "13 grand", "16k": a price, in thousands.
  v=v.replace(/\b(\d+(?:\.\d+)?)\s*grand\b/gi,(m,n)=>'$'+Math.round(parseFloat(n)*1000));
  v=v.replace(/\b((?:about|around|figure|ballpark|roughly|call\s+it|for|total|like)\s+)(\d+(?:\.\d+)?)k\b(?!\s*(?:btu|mini|split|unit|w\b|kw))/gi,(m,lead,n)=>lead+'$'+Math.round(parseFloat(n)*1000));
  // "where gonna prime" -> "we're gonna prime".
  v=v.replace(/(^|[.!?,]\s+|\s(?:so|okay|then|and)\s+)(where|were|wear)(\s+(?:gonna|going\s+to))\b/gi,(m,pre,w,rest)=>pre+(/^[A-Z]/.test(w)?"We're":"we're")+rest);
  // "where putting" / "were putting" -> "we're putting".
  // Never after a subject: "we were testing it" is already right.
  v=v.replace(/(^|\S+\s+)(where|were|wear)(\s+)([a-z]+ing)\b/gi,(m,pre,w,sp,g)=>{
    if(!_timkVerbLike(g))return m;
    if(/^(?:we|they|you|i|who|that|which|it|he|she)\W*\s+$/i.test(pre))return m;
    return pre+"we're"+sp+g;
  });
  // "rod in will be removing" -> "rod in, we'll be removing". Mid-sentence only:
  // a sentence that opens "Will be" has lost its subject the same way.
  v=v.replace(/(^|[^\s,.;!?]\s+|[.;!?]\s+)(will|well)(\s+be\s+)([a-z]+ing)\b/gi,(m,pre,w,mid,g)=>{
    if(!_timkVerbLike(g))return m;
    const lead=/[.;!?]\s+$|^$/.test(pre)?pre:pre.replace(/\s+$/,'')+', ';
    const we=/^[A-Z]/.test(w)||/[.;!?]\s+$|^$/.test(pre)?"We'll":"we'll";
    return lead+we+mid+g;
  });
  // A lone verb the phone put a full stop BEFORE: "Bradford White. Install,
  // we're putting" is "Bradford White install. We're putting". A bare verb
  // with nothing to act on is the tail of the sentence before it.
  v=v.replace(/([^.!?;\s])[.!?]\s+([A-Za-z]+)[,.]?\s+(?=(?:we're|we'll|we|i'm|i'll|i)\s)/g,(m,end,word,off,str)=>{
    if(!_timkVerbLike(word))return m;
    return end+' '+word.toLowerCase()+'. ';
  });
  return v;
}

// ── RUN-ON TALK, NO PUNCTUATION (2026-09-27) ──────────────────────────────
//
// An app build from before the phone added punctuation hands back fifteen
// minutes of talk as one sentence. The hard joiners ("and then", "after that")
// always split, above. These softer ones split only where a new action plainly
// starts on the right and the left already names something: "set the heater
// also run the pex" is two steps, "paint the walls and also the ceiling" is one.
// "I" and "we" starting a new clause are a seam the same way.
const _TIMK_SOFT=/\s+(?:and\s+also|and\s+so|and\s+now|also|so|now|okay|ok|alright|plus)\s+|\s+(?=(?:(?:uh|um)\s+)?(?:she|he|they|the\s+customer|the\s+neighbor's|the\s+neighbor)\s+(?:said|says|mentioned|wants|asked|will|'ll|is|decides?|decided)\s)|\s+(?=(?:she'll|he'll|they'll)\s)|\s+(?=we're\s+not\s)|\s+(?=(?:doors?|windows?|ceilings?|trim|walls?|floors?|cabinets?)\s+(?:are|is)\s+(?:staying|fine|good|okay|ok)\b)|\s+(?=(?:i|we|i'll|we'll|we're|i'm|we've|i've|then\s+we|then\s+i)\s)/gi;
function _timkSoftSplit(s){
  const str=String(s||'');
  const bits=[];let last=0,m;
  const re=new RegExp(_TIMK_SOFT.source,'gi');
  while((m=re.exec(str))){
    if(m[0]===''){re.lastIndex++;continue;}
    const left=str.slice(last,m.index),rightRaw=str.slice(m.index+m[0].length);
    // "she said the dog's friendly", "we're not doing the deck", "doors are
    // staying the same color": an aside inside a run-on comes off as its own
    // piece, and the remark filter drops it.
    if(/^\s*$/.test(m[0])&&/^\s*(?:(?:uh|um)\s+)?(?:she|he|they|the\s+customer|the\s+neighbor'?s?|she'll|he'll|they'll|we're\s+not|[a-z]+\s+(?:are|is)\s+(?:staying|fine|good|okay|ok))\b/i.test(str.slice(m.index))&&_timkHasObject(_timkTidy(left))){bits.push(left);last=m.index;continue;}
    // "run 14/3 so they get separate control": why, not a new step.
    if(/^\s*so\s*$/i.test(m[0])&&/^(?:they|it|that|the|there|he|she|you|nothing|no)\b/i.test(rightRaw.trim()))continue;
    const right=_timkTidy(rightRaw);
    const w0=(right.split(/\s+/)[0]||'');
    if(_timkHasObject(_timkTidy(left))&&_timkVerbLike(w0)&&_timkHasObject(right)){bits.push(left);last=m.index+m[0].length;continue;}
    // "privacy fence ... plus a 4 foot walk gate": "plus" and a counted thing
    // is another item on the list, after a step that is already whole.
    if(/^\s*plus\s*$/i.test(m[0])&&/^(?:a|an|\d+|new|two|three|four)\s+\S+\s+\S+/i.test(rightRaw.trim())&&_timkTidy(left).split(/\s+/).length>=4&&_timkVerbLike((_timkTidy(left).split(/\s+/)[0]||'').toLowerCase())){bits.push(left);last=m.index+m[0].length;}
  }
  bits.push(str.slice(last));
  return bits.filter(b=>b&&b.trim());
}

// A price he said on a line: "replace the shutoff for $250". Taken off the
// words (the line reads as the work) and handed back as the price, so the
// builders that take a price put HIS number on the line. One price per line;
// a line with two is left alone, because which is which is his call.
const _TIMK_PRICE=/(?:[,\s]+(?:for|at|is|thats|that's|its|it's|runs?|costs?|charge|charging|priced\s+at|price\s+is|about|around|call\s+it))*[,\s]*\$(\d[\d,]*(?:\.\d{1,2})?)(?:\s+(?:each|ea|apiece|a\s+piece|total|flat))?[\s,;:.!?]*$/i;
// THE WAY A PRICE IS ACTUALLY SAID (the trade corpus, 2026-09-28). Nobody says
// the dollar sign. "385 installed", "another 60", "for 350", "at 85 a sheet",
// "180 each", "3200 bucks": a number at the END of a step with a money word or
// a money shape around it. A number with a unit after it ("20 feet", "60 amp")
// or a preposition before it ("set it to 60") is a quantity, never a price.
const _TIMK_UNIT=/(?:can|sheet|square|pound|lb|foot|feet|face\s+foot|linear\s+foot|lf|sf|square\s+foot|cut|stump|visit|hour|head|zone|yard|bag|gallon|window|door|room|fixture|light|outlet|circuit|piece|spindle|panel|opening|tree|shrub|stop|valve|run|drop)/.source;
const _TIMK_PRICE_SAID=new RegExp(
  '(?:^|[,\\s]+)((?:(?:for|at|another|plus|about|around|figure|say|runs?|costs?|call\\s+it|thinking|i\'m\\s+thinking|total(?:\\s+(?:is|about|of))?|that\'s|it\'s|its)\\s+)*)'+
  '(\\$)?(\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.(\\d{1,2}))?(\\s*(?:bucks|dollars))?'+
  '((?:\\s+(?:a|per|an)\\s+'+_TIMK_UNIT+'s?)?)'+
  '((?:\\s+(?:each|ea|apiece|installed|extra|total|flat|for\\s+(?:that|this|it|everything|all(?:\\s+(?:that|of\\s+it))?)|plus\\s+(?:labor|materials?|tax|install|installation|parts)|for\\s+(?:the\\s+)?[a-z]+(?:\\s+(?:and\\s+)?[a-z]+){0,2}|on\\s+top\\s+of\\s+that))*)'+
  '[\\s,;:.!?]*$','i');
function _timkPriceSaid(t){
  const m=t.match(_TIMK_PRICE_SAID);
  if(!m)return null;
  const lead=(m[1]||'').trim().toLowerCase(),dollar=!!m[2],money=!!m[5],per=!!(m[6]&&m[6].trim()),tail=(m[7]||'').trim().toLowerCase();
  const n=parseFloat(m[3].replace(/,/g,'')+(m[4]?'.'+m[4]:''));
  if(!(n>0))return null;
  const before=t.slice(0,m.index).trim();
  const strong0=dollar||money||per||!!tail||/\b(?:for|another|plus|figure|say|runs?|costs?|call\s+it|thinking|total|that's|it's|its)\b/.test(lead)||/\b(?:about|around)\b/.test(lead)&&n>=100;
  const prevRaw=(before.split(/\s+/).pop()||'');
  const prev=prevRaw.toLowerCase().replace(/[^a-z0-9/]/g,'');
  // "for the cap" is money only when the cap is already on the line, or the
  // line is nothing but the price. "Pressure test for 15 minutes" is not.
  const forM=tail.match(/for\s+(?:the\s+)?([a-z]+(?:\s+(?:and\s+)?[a-z]+){0,2})/);
  let item='';
  if(forM&&!/^(?:that|this|it|everything|all(?:\s+(?:that|of\s+it))?)$/.test(forM[1])){
    const words=forM[1].split(/\s+/).filter(x=>x!=='and');
    if(before.replace(/[^a-z]/gi,'').length>=3){
      if(!words.some(x=>before.toLowerCase().includes(x))&&!(n>=50))return null;
    }else if(/\bplus\b/.test(lead)||!/^(?:the\s+)?(?:test|job|kitchen|bathroom|bath|house|room|rooms|garage|whole\s+thing|lot|labor|deck|yard|roof|project|area|floor|cap|panel|unit|basement|attic|porch|exterior|interior|install|work)$/.test(forM[1])){item=forM[1];}
  }
  // A model number or a year: "Rain Bird 1804", "pre 1978".
  if(!strong0&&/^[A-Z]/.test(prevRaw)&&!/^(?:I|A)$/.test(prevRaw)&&before.split(/\s+/).length>1)return null;
  if(!dollar&&!money&&/^(?:19|20)\d\d$/.test(m[3]))return null;
  // A number straight after one of these is a size or a setting, not money.
  if(!strong0&&/^(?:per|pre|post|since|than|to|of|by|x|every|gauge|amp|amps|ton|tons|inch|inches|psi|zone|model|number|no|size|pitch|volt|volts|grain|mil|day|week|weeks|days|minutes|hours|gallon|gallons|btu|seer|layer|layers|coat|coats|step|r|type|schedule|sdr|at|pro|series|kw|and|or|the|a|an)$/.test(prev))return null;
  // "About 700." on its own, after the work: a price said the way it is
  // thought, never a size, because a size has its unit with it.
  const aboutOnly=/\b(?:about|around)\b/.test(lead)&&before.replace(/[^a-z]/gi,'').length<3&&n>=100;
  const strong=dollar||money||per||tail||aboutOnly||/\b(?:for|another|plus|runs?|costs?|call\s+it|thinking|total|that's|it's|its|figure|say)\b/.test(lead)||/\b(?:about|around)\b/.test(lead)&&n>=100&&!/^(?:\d|x|by)/.test(prev);
  // A bare trailing number with nothing around it is only money when it is a
  // money-sized number at the end of a step that already says what the work is.
  if(!strong&&!(n>=20&&before.replace(/[^a-z]/gi,'').length>=3&&(!/\d$/.test(before)||/^\s*,/.test(m[0]))))return null;
  // "at 60" with nothing else is a setting ("set the PRV at 60"), not a price.
  if(!dollar&&!money&&!per&&!tail&&/^at$/.test(lead))return null;
  if(item)return {before:item,price:n,unitPrice:0,total:false};
  return {before,price:per||/\beach|ea|apiece\b/.test(tail)?0:n,unitPrice:(per||/\beach|ea|apiece\b/.test(tail))?n:0,total:/total|for\s+(?:everything|all)|thinking/.test(lead+' '+tail)};
}
function timStepPrice(text){
  const t=String(text||'');
  const said=_timkPriceSaid(t);
  if(said&&(t.match(/\$\d/g)||[]).length<=1){
    let rest=said.before.replace(/\s+/g,' ').trim().replace(/[\s,;:.]+$/,'');
    const aside=/(?:[,\s]+(?:are|is|was|runs?|costs?))(?:[,\s]+(?:about|around|roughly|like))*$/i.test(rest);
    rest=rest.replace(/(?:[,\s]+(?:and|for|at|with|are|is|was|about|around|roughly|like|runs?|costs?|of|figure|say))+$/i,'');
    // ", fees are about $450": the aside goes with its price.
    if(aside)rest=rest.replace(/,\s*([a-z']+(?:\s+[a-z']+)?)$/i,(m,x)=>x.split(/\s+/).some(w=>_timkVerbLike(w.toLowerCase()))?m:'');
    // "2 of them for 320": the count of the thing just said, and its price.
    if(rest.replace(/[^a-z]/gi,'').length<3||/^\d+\s+(?:of\s+(?:them|those|these|em)|each|total)$/i.test(rest))return {text:'',price:said.price,unitPrice:said.unitPrice,total:said.total,priceOnly:true};
    return {text:rest.charAt(0).toUpperCase()+rest.slice(1),price:said.price,unitPrice:said.unitPrice,total:said.total};
  }
  if((t.match(/\$\d/g)||[]).length!==1)return {text:t,price:0};
  const m=t.match(_TIMK_PRICE);
  if(!m)return {text:t,price:0};
  const price=parseFloat(m[1].replace(/,/g,''));
  let rest=(t.slice(0,m.index)+' '+t.slice(m.index+m[0].length)).replace(/\s+/g,' ').trim().replace(/[\s,;:.]+$/,'');
  if(rest.replace(/[^a-z]/gi,'').length<3)return {text:t,price:0};
  return {text:rest.charAt(0).toUpperCase()+rest.slice(1),price:isNaN(price)?0:price};
}
// A step that is only a price ("150.", "$95 for the test", "Total about 9400")
// is the price of the step before it, not a step. A total for the whole job is
// dropped: it is not any one line's price.
function _timkFoldPrices(priced){
  const out=[];
  priced.forEach(p=>{
    if(p&&p.priceOnly){
      const last=out[out.length-1];
      if(last&&!p.total&&!last.price&&!last.unitPrice){last.price=p.price;last.unitPrice=p.unitPrice||0;}
      return;
    }
    out.push(p);
  });
  return out;
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
  // "exterior we're gonna pressure wash": the area is the job's heading.
  v=v.replace(/^(?:the\s+)?(?:exterior|interior|outside|inside)\s+(?=(?:we're|we'll|we|i'm|i'll)\s)/i,'');
  // "basement finish we're gonna frame": the same, for any room heading.
  {const m=v.match(/^((?:\S+\s+){1,4}?)(?=(?:we're|we'll|we|i'm|i'll)\s+(?:are\s+)?(?:gonna|going\s+to|will|need\s+to|have\s+to|just)\b)/i);
   if(m&&_timkIsHeading(m[1]))v=v.slice(m[1].length);}
  v=v.replace(/[,\s]+(?:figure|about|around|call\s+it)\s+(?:\d+(?:\.\d+)?|an?|half\s+an?)\s+(?:hours?|days?)(?:\s+at\s+\$?\d+(?:\s+an?\s+hour)?)?$/i,'');
  v=v.replace(/[,\s]+(?:ballpark|about|around|roughly|maybe|figure|probably)?\s*\$\d[\d,]*(?:(?:\s+to\s+\$?\d[\d,]*)(?:\s+(?:give\s+or\s+take|all\s+in|total|or\s+so))?|(?:\s+to\s+\$?\d[\d,]*)?\s+(?:give\s+or\s+take|all\s+in|or\s+so|for\s+\d+\s+squares))(?:\s+(?:probably|maybe|about)?\s*\d+\s+(?:days?|hours?))?$/i,'');
  // "pull out the old boxwoods there's 6 of them", "pull the damaged vinyl,
  // it's the hail", "check the balances it drops", "rods and 3 posts but not the
  // lattice": the count, the cause, the symptom and the exclusion go.
  v=v.replace(/[,\s]+(?:there's|there\s+are)\s+\d+(?:\s+of\s+them)?$/i,'').replace(/[,\s]+it's\s+the\s+[a-z]+$/i,'').replace(/[,\s]+(?:it|they)\s+(?:drops?|sticks?|leaks?|rubs?|squeaks?|runs?|wobbles?)$/i,'').replace(/[,\s]+but\s+not\s+(?:the\s+)?[a-z]+(?:\s+[a-z]+){0,3}$/i,'');
  v=v.replace(/[,\s]+(?:it's|its|it\s+is|they're|theyre|it\s+was)\s+(?:leaking|dripping|rusted|rotted|cracked|sagging|failing)(?:\s+(?:at|from|on|in|by)\s+(?:the\s+)?[a-z]+(?:\s+[a-z]+)?)?$/i,'');
  // "replace the gutter on the west side it's dented": how it looks now is
  // why, not what.
  v=v.replace(/[,\s]+(?:it's|its|it\s+is|they're|theyre|they\s+are)\s+(?:all\s+|pretty\s+|really\s+)?(?:dented|rotted|rotten|cracked|shot|broken|broke|leaking|bad|damaged|rusted|loose|gone|toast|crushed|bent|sagging|failing|warped)$/i,'');
  for(let i=0;i<2;i++)v=v.replace(_TIMK_SUBJECT,'');
  // "We'll be removing": the subject goes above, and "be" goes with it.
  v=v.replace(/^be\s+(?=[a-z]+ing\b)/i,'');
  v=v.replace(/\s+/g,' ').trim().replace(/[\s,;:.]+$/,'').replace(/(?:,?\s+(?:and|or|like|you\s+know|so))+$/i,'');
  if(!v)return '';
  // Shouted is not how a contract reads. Caps lock or a shouting keyboard
  // becomes a sentence; a word he capitalised on purpose in normal typing
  // (a brand, "PEX") is left alone, because only an ALL-caps step is changed.
  if(!/[a-z]/.test(v)&&/[A-Z].*[A-Z].*[A-Z]/.test(v))v=v.toLowerCase();
  // His words, his capitals, except the first letter, which a numbered list
  // wants upper whether he was shouting or dictating.
  return v.charAt(0).toUpperCase()+v.slice(1);
}

// ── WHERE THE PHONE PUT A FULL STOP IN THE MIDDLE OF A THOUGHT ────────────
// A slow talker pauses mid-phrase and the phone ends the sentence there:
// "Replace. The kitchen light fixture with. The one the customer bought."
// "Remove switch plates. And outlet covers." "Paint 3 bedrooms. Walls only. 2
// coats." Those are joined back onto what they finish. A fragment is joined
// when the one before it stops on a word that cannot end a thought ("the",
// "with", "and"), when the one before it is a bare verb with nothing to act
// on, or when it is itself a short piece that is not a new action.
const _TIMK_OPEN_END=/\b(?:the|a|an|with|to|of|for|and|or|in|on|at|from|by|into|onto|your|their|his|her|my|our|this|that|these|those|some|all|existing|whole|entire|(?<!the\s)main)[,]?$/i;
const _TIMK_PREP_START=/^(?!in\s+use\b)(?:for|in|on|at|from|to|with|by|into|under|over|behind|around|through|inside|outside|along|across)\s/i;
// Lower-case the phone's sentence capital when joining, unless it is a name.
function _timkJoinCase(t){
  const w0=(String(t).split(/\s+/)[0]||'');
  const bare=w0.toLowerCase().replace(/[^a-z']/g,'');
  if(/^(?:the|a|an|and|or|for|in|on|at|to|with|of|from|by|every|each|both|all|walls?|ceilings?|floors?|trim|doors?|windows?|closets?|stairwell|stairs|landing|hallway|interconnect|hardwire)$/.test(bare)||_timkVerbLike(bare)||/^\d/.test(w0))
    return t.charAt(0).toLowerCase()+t.slice(1);
  return t;
}
function _timkMendSentences(list){
  const out=[];
  (list||[]).forEach(raw=>{
    let t=String(raw||'').replace(/\b(the|a|an),\s+/gi,'$1 ').trim();
    if(!t)return;
    if(/^(?:done|that's\s+it|that's\s+all|that's\s+everything)[.!]?$/i.test(t))return;
    const prev=out.length?out[out.length-1]:null;
    const lone=t.replace(/[.;!?]+$/,'').trim();
    if(prev!==null&&(_timkIsHeading(lone)&&!_TIMK_AREA.test((String(prev).replace(/[.;!?,]+$/,'').split(/\s+/).pop()||'').toLowerCase())||_timkIsRemark(lone))&&!/^and\s/i.test(lone)){out.push(t);return;}
    if(prev!==null){
      const p=prev.replace(/[.;!?]+$/,'').trim();
      const tt=t.replace(/[.;!?]+$/,'').trim();
      const tidy=_timkTidy(tt).toLowerCase();
      const w=tidy.split(/\s+/).filter(Boolean);
      const pTidy=_timkTidy(p).toLowerCase().split(/\s+/).filter(Boolean);
      const pBareVerb=pTidy.length===1&&_timkVerbLike(pTidy[0]);
      const andRest=tt.replace(/^and\s+/i,'').toLowerCase();
      const andPiece=/^and\s/i.test(tt)&&(andRest.split(/\s+/).length===1||!_timkNewAction(andRest))&&!/^(?:a\s+|an\s+)?new\s+\S+\s+\S+/.test(andRest);
      // A lone word, or a few words that only qualify the step before ("Walls
      // only", "2 coats", "Every bedroom"). "Synthetic underlayment" and "6
      // downspouts" are items of their own and stay lines.
      // "about 3 squares of it": how much of what he just said.
      if(/^(?:about|around|roughly|approximately|maybe)\s+\d[\d,.]*\s+[a-z]+(?:\s+[a-z]+)?\s+(?:of\s+(?:it|them|that))?$/i.test(tidy)&&/^(?:\S+\s+){2}(?:squares?|feet|foot|yards?|sheets?|gallons?|tons?|bundles?|rolls?|linear\s+feet|square\s+feet|sq\s+ft|lf|sf)\b/i.test(tidy)){
        out[out.length-1]=p+' '+_timkJoinCase(tt.replace(/^(?:um|uh)\s+/i,'').replace(/\s+of\s+(?:it|them|that)$/i,''));return;
      }
      // "Fully adhered.", "22 doors 9 drawers.", "Fleck 5600 valve 48,000
      // grain.": how it goes on, how many, and which make, of the step before.
      if(w.length&&w.length<=3&&/ed$/.test(w[w.length-1])&&!_timkVerbLike(w[0])&&!/^(?:new|old)$/.test(w[0])){out[out.length-1]=p+' '+_timkJoinCase(tt);return;}
      if(/^(?:\d+\s+[a-z]+\s*){2,3}$/i.test(tidy)&&pTidy.length>=2&&_timkVerbLike(pTidy[0])){out[out.length-1]=p+' '+tt;return;}
      if(/^[A-Z][a-z]+\s+\S*\d/.test(tt)&&!w.some(x=>_timkVerbLike(x)&&!_TIMK_NOUNISH.has(x))&&pTidy.length>=2&&pTidy.length<=6&&_timkVerbLike(pTidy[0])&&!/\d/.test(p)){out[out.length-1]=p+' '+tt;return;}
      const shortPiece=w.length>0&&!_timkVerbLike(w[0])&&(w.length===1&&!/^\d/.test(w[0])||w.length<=3&&w.some(x=>/^(?:only|all|coats?|each|every|both|sides?|too|again|included|also|feet|foot|ft|inch|inches|squares?|sq|sf|lf|linear|yards?|gallons?|tons?|amps?|zones?)$/.test(x)));
      if(_TIMK_OPEN_END.test(p)||pBareVerb&&(!_timkVerbLike(w[0]||'')||_TIMK_NOUNISH.has(w[0]||''))){out[out.length-1]=p+' '+_timkJoinCase(tt);return;}
      if(andPiece){out[out.length-1]=p+' '+_timkJoinCase(tt);return;}
      if(shortPiece){out[out.length-1]=p+', '+_timkJoinCase(tt);return;}
      // "Thaw the frozen line. In the crawl, find the split": the place goes
      // back on the step before; what follows the comma is its own.
      const prepAct=(()=>{const ww=tidy.split(',')[0].split(/\s+/);for(let q=2;q<Math.min(ww.length-1,6);q++){if(_timkVerbLike(ww[q])&&!_TIMK_NOUNISH.has(ww[q])&&!/(?:ed|s)$/.test(ww[q])&&_timkNewAction(ww.slice(q).join(' ')))return true;}return false;})();
      if(_TIMK_PREP_START.test(tt)&&!prepAct&&!_timkNewAction(tidy)&&!/\s(?:we're|we\s+are|we'll|i'm|we|they're)\s/i.test(tt)){
        const c=tt.indexOf(',');
        if(c<0){out[out.length-1]=p+' '+_timkJoinCase(tt);return;}
        out[out.length-1]=p+' '+tt.charAt(0).toLowerCase()+tt.slice(1,c);
        t=tt.slice(c+1).trim();
        if(!t)return;
      }
    }
    out.push(t);
  });
  return out;
}

// ── WHY HE IS THERE IS NOT WHAT HE WILL DO ─────────────────────────────────
// "The system's low on charge so we're gonna leak search": the reason comes
// off and the work stays. And a sentence that only describes the house ("Tub's
// slow.", "There's no cleanout on this house.", "Water pressure's at 110.") is
// a diagnosis, not a line on the proposal. Anything about who supplies what or
// what is included stays: that is a term, and it belongs on the page.
function _timkDropReason(sent){
  const t=String(sent||'');
  {const m2=t.match(/^((?:it|there|that|they|the\s+[a-z]+)\b[^,]*?),?\s+so\s+([a-z]+)\b/i);
   if(m2&&_timkVerbLike(m2[2].toLowerCase())&&!/^(?:we|i)$/i.test(m2[2]))return t.slice(t.toLowerCase().indexOf(m2[2].toLowerCase(),m2[1].length));}
  const m=t.match(/^(.*?)(?:[,\s]+so|,)\s+(?:(?:uh|um)[,\s]+)?(?:(?:first\s+thing|basically|then|now)\s+)?(?:we're|we\s+are|we'll|we\s+will|i'm|i\s+am|i'll|we)\s+(?:gonna|going\s+to|will|need\s+to|have\s+to|got\s+to|gotta)\s+/i);
  if(!m)return t;
  const head=_timkTidy(m[1]).toLowerCase();
  const w0=head.split(/\s+/)[0]||'';
  if(!head||_timkVerbLike(w0))return t;
  // Without "so" in front, only when what comes before describes the house.
  if(!/\bso\s+(?:(?:uh|um)[,\s]+)?(?:we|i)/i.test(m[0])&&!_timkIsRemark(m[1]))return t;
  return t.slice(m[0].length);
}
// ── A ROOM NAME IS A HEADING, NOT A STEP (the holdout walks, 2026-09-28) ──
// "Kitchen. Demo the cabinets." "Master bath. Tear out the tub." A man walking
// a house says the room out loud before the work in it, and the room alone is
// never a line on the proposal. Only words that name a place or the kind of
// project, with at least one place in it: "New toilet" and "Gutter guards" are
// items and stay.
const _TIMK_AREA=/^(?:hallways?|landing|kitchens?|baths?|bathrooms?|master|primary|guest|hall|powder|basement|attic|garage|sunroom|island|deck|patio|porch|laundry|mudroom|living|dining|family|bedrooms?|rooms?|exterior|interior|outside|inside|front|back|yard|backyard|roof|driveway|upstairs|downstairs|den|foyer|entry|stairway|stairwell|closets?|pantry|house|shed|office|shop|nursery|loft|suite)$/;
const _TIMK_PROJECT=/^(?:conversion|refresh|remodel|renovation|reno|finish|redo|makeover|update|addition|project|job|backsplash|side|area|level|first|second|third|main|half|floor|the|this|okay|ok|so|alright|now|next|up|on|in|at)$/;
function _timkIsHeading(sent){
  const t=String(sent||'').toLowerCase().replace(/[.;!?,:]+/g,' ').replace(/\s+/g,' ').trim();
  if(!t)return false;
  if(/^(?:(?:okay|ok|alright|so|and|now)\s+)*(?:last|next|first)\s+(?:one|room|job|thing|house|stop)(?:\s+(?:here|then|on\s+the\s+list))?$/.test(t))return true;
  // "Storm damage on the west side": what happened, not what gets done.
  if(/^(?:(?:okay|ok|alright|so|and)\s+)*(?:the\s+)?(?:storm|hail|wind|water|fire|tree|flood|smoke)\s+damage\b/.test(t)&&!t.split(' ').slice(2).some(x=>_timkVerbLike(x)&&!_TIMK_NOUNISH.has(x)&&!/^(?:damage|damaged)$/.test(x)))return true;
  const w=t.split(' ');
  if(w.length>5)return false;
  return w.some(x=>_TIMK_AREA.test(x))&&w.every(x=>_TIMK_AREA.test(x)||_TIMK_PROJECT.test(x));
}
// ── THE TITLE HE SAYS BEFORE THE WORK (set C, 2026-09-28) ─────────────────
// "Panel upgrade." "Water heater swap." "Deck refresh." "Garage, um, install a
// mini split." Before any work has been said, a short phrase with no work verb
// in it (a verb as its last word is a noun: "swap", "upgrade", "repair") is the
// name of the job, not a line. Only BEFORE the first step: after it, the same
// shape is an item ("Synthetic underlayment", "Well cover").
function _timkIsTitle(sent){
  const t=_timkTidy(String(sent||'').replace(/[.;!?]+$/,'')).toLowerCase().replace(/[,]+/g,' ').replace(/\s+(?:okay|ok|alright|here)$/,'').trim();
  if(!t)return false;
  const w=t.split(/\s+/);
  if(w.length>6)return false;
  if(/\d/.test(t))return false;
  if(/\b(?:job|list|stuff|work|project)$/.test(t)&&w.length<=4)return true;
  if(/^(?:new|a|an|\d|one|two|three|four|five|six|seven|eight|nine|ten|twelve|about|around|figure|total)/.test(w[0]))return false;
  if(_TIMK_TERMS.test(t)||/\$|\d{3,}|\bbucks\b/.test(t))return false;
  // A name in it ("Belgard Catalina in the toscana blend") makes it an item.
  if(/\s[A-Z][a-z]/.test(String(sent).trim().replace(/^(?:okay|ok|alright|so)[,.]?\s+/i,'')))return false;
  if(w.slice(0,-1).some(x=>_timkVerbLike(x)&&!_TIMK_NOUNISH.has(x)&&!(/[^s]s$/.test(x)&&x.length>5)&&!/^(?:cleanup|start|stain|trim|repair|finish|install|drain|heat|air|water|light|floor|roof|deck|fence|screen|power|pressure|frame|wall|seal)$/.test(x)))return false;
  if(_timkVerbLike(w[0])&&!_TIMK_AREA.test(w[0])&&!(/[^s]s$/.test(w[0])&&w[0].length>5)&&!/^(?:deck|fence|roof|floor|screen|water|air|heat|power)$/.test(w[0]))return false;
  if(w.some(x=>/^(?:is|are|was|has|have|it's|there's|that's|we're|i'm)$/.test(x)))return false;
  return true;
}
// "okay so hall bath gut it down to the studs", "alright garage subpanel run a
// 60 amp feeder": the same title, said with no full stop after it. The work
// starts at the first verb that has something to act on.
function _timkDropLeadTitle(sent){
  const words=String(sent||'').trim().split(/\s+/);
  const lw=words.map(x=>x.toLowerCase().replace(/[^a-z']/g,''));
  let i0=0;
  while(i0<lw.length&&/^(?:okay|ok|so|alright|um|uh|and|well|yeah|right)$/.test(lw[i0]))i0++;
  const strongAt=k=>_TIMK_STRONG.has(lw[k])||/^(?:power|pressure|tear|pull|gut|run|install|replace|frame|route|turn|excavate|remove|rip|demo|camera|wet|hang|build|move|fix|clean|take|cut|add|put)$/.test(lw[k]);
  for(let k=i0+1;k<=Math.min(i0+12,lw.length-2);k++){
    if(/^(?:power|pressure|spot|wet|hydro|scuff)$/.test(lw[k])&&_timkVerbLike(lw[k+1]||'')&&k>i0){
      const pre2=lw.slice(i0,k);
      if(pre2.length<=6&&!pre2.some(x=>/^(?:we're|we|i'm|i|we'll|i'll)$/.test(x))&&pre2.some(x=>_TIMK_AREA.test(x)||/^(?:stain|deck|fence|house|siding|patio|driveway)$/.test(x))&&_timkNewAction(lw.slice(k+1).join(' ')))return words.slice(k).join(' ');
    }
    if(/^(?:we're|we'll|i'm|i'll)$/.test(lw[k+1]||''))continue;
    if(!strongAt(k)||_TIMK_NOUNISH.has(lw[k]))continue;
    const pre=lw.slice(i0,k);
    const descr=pre.some(x=>/^(?:has|have|is|are|was|got)$/.test(x)||/'s$/.test(x));
    // "In the kitchen we're gonna install": a place, which stays on the step.
    if(/^(?:in|on|at|down|up|out|over|inside|outside|upstairs|downstairs|around|behind|under|along)$/.test(pre[0]||''))return sent;
    if(pre.length>(descr?11:6))return sent;
    // "doing a water heater ... install", "we're replacing 9 windows pull the
    // old sliders": work already, not a title.
    if(_timkVerbLike(pre[0]||'')&&!_TIMK_AREA.test(pre[0])&&!/^(?:deck|fence|roof|floor|screen|water|power|air|heat)$/.test(pre[0])||pre.some(x=>/^(?:we're|we|i'm|i|we'll|i'll|they're)$/.test(x)))return sent;
    if(pre.some((x,xi)=>_timkVerbLike(x)&&!_TIMK_NOUNISH.has(x)&&xi!==pre.length-1&&!/^(?:cleanup|stain|repair|repairs|finish|start|install|floor|roof|deck|fence|screen|power|pressure|wall|seal|swap|upgrade|repipe|refresh|conversion|drainage|refinish|crack|do)$/.test(x)&&!/(?:ing)$/.test(x)))return sent;
    if(!pre.some(x=>_TIMK_AREA.test(x)||/^(?:fence|deck|slab|pad|beds?|gutters?|guards?|job|list|conversion|repipe|swap|upgrade|repair|repairs|cleanup|drainage|subpanel|stain|refresh|patio|walk|driveway|porch|siding|windows?|roof|chimney|furnace|heater|panel|charger|irrigation|lawn|yard|mount|door|downstairs|upstairs|side|shed|pool|stairs|slab|walk|front|back|list|job|screen|porch|egress|railing|stain)$/.test(x)))return sent;
    if(!_timkNewAction(lw.slice(k).join(' ')))continue;
    return words.slice(k).join(' ');
  }
  return sent;
}
function w0Verb(t){const w=String(t||'').split(/\s+/)[0]||'';return _timkVerbLike(w)&&!_TIMK_NOUNISH.has(w);}
const _TIMK_TERMS=/\b(?:homeowner|customer|owner|included|not\s+included|excluded|by\s+others|warranty|permit)\b/i;
function _timkIsRemark(sent){
  const t=_timkTidy(String(sent||'').replace(/[.;!?]+$/,'')).toLowerCase();
  if(!t)return false;
  if(/^(?:done|that's\s+it|that's\s+all|that's\s+everything|that\s+should\s+do\s+it)$/.test(t))return true;
  if(/^(?:the\s+)?(?:customer|homeowner|owner|client)s?\s+(?:wants|wanted|said|says|asked|mentioned|would\s+like|thinks)\b/.test(t)&&!/,/.test(String(sent)))return true;
  // What the customer decided or thinks is not a line; what the customer
  // supplies or does to get ready for us is a term and stays.
  if(/^(?:the\s+)?(?:customer|homeowner|owner|client)(?:'s|\s+is)?\s+(?:okay|ok|fine|happy|declined|decided|doing\s+.*\bnext\s+(?:year|week|month|spring|summer|fall)|wants?\s+(?:it|this|them)\s+done|wants\s+to\s+keep|changed|paying\s+the\s+deductible)\b/.test(t))return true;
  // Another trade, or someone else, doing their part: "electrician's running
  // the circuit", "the shed company's building the shed", "paint is by the
  // painter". "By others" is a term and stays.
  if(!/,/.test(String(sent))&&!/\bby\s+others\b|\bincluded\b/.test(t)&&/^(?:the\s+)?(?:[a-z]+\s+)?(?:electrician|plumber|roofer|painter|guy|company|neighbor|neighbors|utility|city|sub|gc|builder|landlord|insurance|adjuster|inspector|hoa)(?:'s|s'|\s+is|\s+are|\s+will|'ll|\s+does|\s+do|\s+handles?|\s+approved)\b/.test(t))return true;
  if(/\bby\s+the\s+(?:painter|electrician|plumber|roofer|city|utility|homeowner|customer|owner|drywall\s+guy|gutter\s+guy|gc|builder)$/.test(t))return true;
  // What is NOT being done: "not touching the ceiling", "we're not doing the
  // deck", "keeping the wallpaper", "leave the closets carpeted".
  if(/^(?:not|never|no\s+longer)\s+[a-z]+ing\b/.test(t)||/^keeping\s+(?:the|it|them|all)\b/.test(t)||/^(?:just\s+)?leave\s+the\s+[a-z]+(?:\s+[a-z]+){0,3}$/.test(t))return true;
  // "doing the kick-out ourselves": confirming it is his, which it already is.
  if(/\bourselves$/.test(t)&&t.split(/\s+/).length<=6)return true;
  if(_TIMK_TERMS.test(t))return false;
  // A condition is the front of a step, not a description.
  if(/^if\s/.test(t))return false;
  // "She mentioned the attic stairs", "he wants it by Friday": who asked is
  // not the work. "Keep the framing", "leave the utility room open", "nothing
  // there": what is NOT being done is not a line either.
  // "There's a water stain on the ceiling from the old leak": what he found.
  if(/^there(?:'s|\s+is|\s+are|'re)\s/.test(t)&&!/,/.test(String(sent))&&!/\b(?:so|then)\s+(?:we|i)\b/.test(t))return true;
  // "Ceiling stays", "treads stay natural": what is left alone.
  if(/^(?:the\s+)?[a-z]+(?:\s+[a-z]+)?\s+(?:stays?|remains?)(?:\s+(?:natural|as\s+is|the\s+same|put|there|white|original))?$/.test(t))return true;
  if(!/,/.test(String(sent))&&/^(?:she|he|they|the\s+(?:wife|husband|lady|guy))\s+(?:mentioned|said|says|asked|asks|wants|wanted|noticed|thinks|thought|would\s+like|likes|mentions)\b/.test(t))return true;
  if(/^(?:just\s+)?leave\s+(?:it|them|that|the\s+[a-z]+)(?:\s+(?:alone|be))?$/.test(t))return true;
  if(/^(?:just\s+)?(?:keep|keeping|leave|leaving)\s+(?:the|it|that|all|everything)\b.*\b(?:open|alone|as\s+is|in\s+place|the\s+way\s+it\s+is|there|how\s+it\s+is)$/.test(t)||/^(?:just\s+)?(?:keep|keeping)\s+the\s+[a-z]+(?:\s+[a-z]+)?$/.test(t))return true;
  if(/\b(?:so\s+)?nothing\s+(?:there|on\s+that|to\s+do\s+there|in\s+there)$/.test(t))return true;
  // "the plumber's running the gas": another trade's work is not his line.
  if(!/,/.test(String(sent))&&/^the\s+(?:plumber|electrician|hvac\s+(?:guy|company)|roofer|painter|gc|general\s+contractor|builder|gas\s+company|power\s+company|utility)(?:'s|\s+is|\s+will|'ll|\s+(?:does|do|handles?|takes?))\b/.test(t))return true;
  // "Two hours.", "Hour.", "Full day.", "hour and a half total": time, which
  // is the rate sheet's.
  if(/^(?:about\s+|maybe\s+|probably\s+|figure\s+|like\s+)?(?:an?\s+|half\s+an?\s+|\d+(?:\.\d+)?\s+|a\s+couple(?:\s+of)?\s+|a\s+few\s+|one\s+|two\s+|three\s+|four\s+)?(?:hours?|days?|full\s+day|half\s+(?:a\s+)?day|hour\s+and\s+a\s+half|day\s+and\s+a\s+half)(?:\s+(?:total|tops|or\s+so|of\s+work|job|labor|max))?$/.test(t))return true;
  // "Price 1,275", "Standard tune-up price, 129": the price, said as a line.
  if(/\bprice\b/.test(t)&&!w0Verb(t)&&t.split(/\s+/).length<=5)return true;
  // "Customer's got a cat, keep the door shut": the house, not the job.
  if(/\b(?:dog|dogs|cat|cats|puppy|pets?)\b(?!\s*(?:ear|eared|-ear))/.test(t)&&!w0Verb(t)&&!/\b(?:door|fence|gate|run)\b.*\b(?:install|build|replace)\b/.test(t)&&!/^(?:install|build|replace|add|put)\b/.test(t))return true;
  // "The toilet runs constantly", "the downspout dumps right by the
  // foundation": what it does now, not what he will do.
  if(!/,/.test(String(sent))&&/^the\s+[a-z]+(?:\s+[a-z]+)?\s+([a-z]+s)\b/.test(t)){const vv=t.match(/^the\s+[a-z]+(?:\s+[a-z]+)?\s+([a-z]+s)\b/)[1];if(_timkVerbLike(vv)&&!/(?:ss|us|is)$/.test(vv)&&!/^(?:gets|needs|goes|takes|wants)$/.test(vv)&&!/\b(?:we|us|our)\b/.test(t))return true;}
  // "About an hour", "maybe two days": how long, which is the rate sheet's.
  if(/^(?:about|around|maybe|probably|roughly|like)\s+(?:an?|half\s+an?|\d+(?:\.\d+)?|a\s+couple|a\s+few)\s+(?:hours?|days?|minutes?|weeks?)(?:\s+(?:of\s+work|or\s+so|tops|total|for\s+(?:the\s+)?[a-z]+(?:\s+[a-z]+)?))?$/.test(t))return true;
  const w=t.split(/\s+/);
  if(_timkVerbLike(w[0])&&!(_TIMK_NOUNISH.has(w[0])&&/'s$/.test(w[1]||'')))return false;
  // "for the Hendersons": who the job is for is on the proposal already.
  if(/^for\s+(?:the\s+)?[a-z]+s?$/.test(t)&&w.length<=3&&/^[A-Z]/.test(String(sent).trim().replace(/^for\s+(?:the\s+)?/i,'')))return true;
  // A description: a copula near the front and no work verb after it.
  const w1=t.split(',')[0].split(/\s+/);
  const cop=w1.slice(0,7).findIndex(x=>/^(?:is|are|was|were|isn't|aren't|wasn't|has|have|hasn't)$|'s$/.test(x));
  if(cop<0)return false;
  if(/^(?:there's|it's|that's|this|there)$/.test(w[0])||cop>=0){
    return !w.slice(cop+1).some(x=>_timkVerbLike(x)&&!_TIMK_NOUNISH.has(x)&&!/(?:ed|s)$/.test(x)&&!/^(?:shot|slow|out|down|up|in|on|off|fine|good|bad|low|high|rusted|leaking|broken|broke|cracked|dead|done)$/.test(x));
  }
  return false;
}

// The whole of it: prose in, steps out, in the order he said them. Ordering
// into WORK order is timOrderScope, deliberately separate, because a man who
// dictated his day out of order should see his own list first and then be
// offered the sort.
function timScopeFrom(text){
  const raw=_timkClean(String(text||''));
  if(!raw.trim())return [];
  const out=[];
  const seen=new Set();
  // "If the flange is broke, put in a repair ring": a condition is the front
  // of the step it governs, never a step of its own.
  let held='';
  const push=(frag0)=>_timkVerbSplit(frag0).forEach(frag=>{
    let v=_timkTidy(frag);
    if(!v)return;
    if(_timkIsRemark(v))return;
    if(held){v=held+(/,$/.test(held)?' ':', ')+v.charAt(0).toLowerCase()+v.slice(1);held='';}
    // "Down in the basement, frame the walls": where the work is goes on the
    // front of the work, not on a line of its own.
    if(/^(?:down|up|out|over|in|on|at|inside|outside|upstairs|downstairs|around|behind|under|along)\s/i.test(v)&&!v.toLowerCase().split(/\s+/).some(x=>_timkVerbLike(x)&&!_TIMK_NOUNISH.has(x))&&v.split(/\s+/).length<=6){held=v;return;}
    if(/^if\s/i.test(v)&&!v.slice(3).split(/\s+/).some((x,i,arr)=>i>1&&!_TIMK_NOUNISH.has(x.toLowerCase())&&!/[^s]s$/i.test(x)&&arr.length-i>=2&&_timkNewAction(arr.slice(i).join(' ').toLowerCase()))){held=v;return;}
    // A step that is only a number or a stray word is noise, not scope.
    if(v.replace(/[^a-z]/gi,'').length<3)return;
    const key=v.toLowerCase();
    if(seen.has(key))return;
    seen.add(key);
    // NO CAP (2026-09-27). This stopped at forty and dropped the rest without
    // a word, which is the end of a fifteen minute job walk. Every step he said
    // is kept; a long list is his to trim, not Tim's to lose.
    out.push(v);
  });
  const flushHeld=()=>{if(held){const h=held;held='';if(!seen.has(h.toLowerCase())){seen.add(h.toLowerCase());out.push(h);}}};
  // Hard breaks first: a line he typed on its own is a step he meant on its
  // own, whatever punctuation is in it.
  raw.split(/[\r\n]+/).forEach(line=>{
    if(!line.trim())return;
    // Sentence enders, then the joining words, both of which always split.
    _timkMendSentences(line.split(/(?<=[.;!?])\s+|\s*;\s*/)).map(_timkDropReason).forEach((sent,si,arr)=>{
      if(!sent||!sent.trim())return;
      if(_timkIsRemark(sent))return;
      if(_timkIsHeading(sent))return;
      if(!out.length&&!held&&si<arr.length-1&&_timkIsTitle(sent))return;
      if(!out.length&&!held){
        // "Garage, um, install a mini split": the title before the first comma.
        const c=sent.indexOf(',');
        if(c>0&&_timkIsTitle(sent.slice(0,c))&&_timkNewAction(_timkTidy(sent.slice(c+1).replace(/^[\s,]*(?:(?:um|uh|okay|ok)[\s,]+)*/i,'')).toLowerCase()))sent=sent.slice(c+1);
        else sent=_timkDropLeadTitle(sent);
      }
      // "... at the foundation lining not included", "... under the washer
      // permit included": a term at the end of a run-on is its own line.
      {const tm=sent.match(/^(.{12,}?\S)\s+((?:(?:the|all)\s+)?(?:[a-z]+\s+){0,3}?(?:permit|permits|inspection|lining|stain|staining|paint|painting|trim|electrical|plumbing|drywall|patching|haul\s+off|dump\s+fees|disposal|cleanup|materials|labor|gutters?|screens?|guards?|screening)(?:\s+and\s+[a-z]+)?(?:\s+(?:is|are))?\s+(?:not\s+)?(?:included|by\s+others|extra|excluded)(?:\s+[a-z]+){0,2})([.!?]?)$/i);
       if(tm&&!/\b(?:and|with|for|of|the|a)$/i.test(tm[1])&&_timkTidy(tm[1]).split(/\s+/).length>=3)sent=tm[1]+'. '+tm[2]+tm[3];}
      sent.split(/(?<=[.])\s+(?=\S)/).forEach(sent=>{
      sent.split(_TIMK_JOIN).reduce((a,p)=>a.concat(_timkSoftSplit(p)),[]).forEach(part0=>{
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
        // Never inside a number: "48,000 grain" is one number, not two steps.
        const bits=part.split(/(?<!\d),\s*|,(?!\d{3}\b)\s*/);
        let buf='';
        bits.forEach((bit,i)=>{
          if(i===0){buf=bit;return;}
          const next=bit.replace(/^and\s+/i,'');
          // "replace the cracked window, it's a Marvin casement": the make is
          // the spec of what he just named, not an aside.
          {const sp=next.match(/^(?:it's|its|it\s+is|that's|thats)\s+(?:a|an)\s+(.+)$/i);
           if(sp&&sp[1].split(/\s+/).length<=4&&/(?:^|\s)(?:[A-Z][a-z]|\d)/.test(sp[1])&&!sp[1].split(/\s+/).some(x=>_timkVerbLike(x.toLowerCase())&&!_TIMK_NOUNISH.has(x.toLowerCase()))){buf=buf+' '+sp[1];return;}}
          // "hang a fan in the master, there's already a box": the aside goes.
          if(_timkIsRemark(next))return;
          // "we'll be removing the old" starts a step as surely as "removing the
          // old" does: the subject is looked past, and _timkTidy drops it.
          // "new line set", "new pad": on a list, "new" opens the next item.
          // "Mow, edge and blow the front": three verbs sharing one object.
          // "new meter main combo on the outside, Square D": a name after a
          // comma is which one, not a new step. "Reshingle it, match the
          // existing": how, not what.
          if(/^[A-Z][a-z]*(?:\s+[A-Z][\w-]*)*(?:\s|$)/.test(next.trim())&&!/^(?:I|I'm|I'll)\b/.test(next.trim())&&next.trim().split(/\s+/).length<4&&(_TIMK_BRAND_KEYS.get(_timkSoundKey(next.trim().split(/\s+/)[0]))||_TIMK_BRAND_KEYS.get(_timkSoundKey(next.trim().replace(/\s+/g,'')))||/^[A-Z][a-z]+\s+[A-Z]$/.test(next.trim()))){buf=buf+', '+bit;return;}
          if(/^match\s+(?:the\s+)?(?:existing|what's\s+there|the\s+house|it)\b/i.test(next.trim())){buf=buf+', '+bit;return;}
          const bufT=_timkTidy(buf).toLowerCase().split(/\s+/).filter(Boolean);
          const shared=bufT.length===1&&_timkVerbLike(bufT[0])&&/^\S+\s+and\s+\S+/i.test(next)&&_timkVerbLike(next.split(/\s+/)[2]||'');
          // "tape, mud, and texture": bare verbs listed together are one step.
          {const nt=_timkTidy(next).toLowerCase().split(/\s+/).filter(Boolean);const bt=_timkTidy(buf).toLowerCase().split(/[\s,]+/).filter(Boolean);
           const fin=x=>x==='and'||/^(?:tape|mud|sand|texture|float|prime|paint|caulk|finish|skim|spackle|patch|feather)$/.test(x);
           if(nt.length&&nt.length<=3&&nt.every(fin)&&bt.length<=4&&bt.every(fin)&&(bt.length===1||/^\s*and\s/i.test(bit))){buf=buf+', '+bit;return;}}
          // "540 square feet, over 15 pound felt, nail down": how it goes down.
          if(/^(?:and\s+)?(?:nail|nailed|glue|glued|staple|stapled|float|floating|click|clicked)\s+(?:down|it\s+down|together|in)$/i.test(next.trim())){buf=buf+', '+bit;return;}
          // "in use covers on the outside ones", "and new Kwikset levers".
          if(/^in\s+use\s+\S+/i.test(next.trim())||/^and\s+(?:(?:a|an)\s+)?new\s+\S+/i.test(bit.trim())&&(_timkVerbLike((_timkTidy(buf).toLowerCase().split(/\s+/)[0]||''))||/^(?:a\s+|an\s+)?new\s/i.test(_timkTidy(buf)))||/^\d+x\d+\s+\S+\s+\S+/i.test(next.trim())){push(buf);buf=next.replace(/^and\s+/i,'');return;}
          // "in the color, um, slate gray": the pause did not finish anything.
          if(/\b(?:color|colour|colou?r\s+is|of|with|the|a|an|called|named|style|pattern)$/i.test(buf.trim())){buf=buf+' '+bit.trim();return;}
          const bufW=_timkTidy(buf).toLowerCase().split(/\s+/).filter(Boolean);
          if(!shared&&!/^\s*and\s/i.test(bit)&&bufW.length>=3&&(_timkVerbLike(bufW[0])||/^(?:a|an|new)$/.test(bufW[0])||_timkItemPiece(buf))&&_timkItemPiece(next)){push(buf);buf=next;return;}
          if(!shared&&/^(?:and\s+)?(?:spot|wet|scuff|dry|hand|power|pressure|heat|hot)\s+(?:prime|scrape|sand|wash|weld|mop|clean|seal)\b/i.test(next.trim())){push(buf);buf=next.replace(/^and\s+/i,'');return;}
          // "we'll need a curb adapter": an item he has to bring.
          if(!shared&&/^(?:we'll|we\s+will|we're\s+gonna|we|i'll)\s+(?:need|want)\s+(?:a|an|to\s+(?:get|add)\s+(?:a|an))\s+\S+/i.test(next.trim())){push(buf);buf=next.trim().replace(/^(?:we'll|we\s+will|we're\s+gonna|we|i'll)\s+(?:need|want)\s+(?:to\s+(?:get|add)\s+)?(?:a|an)\s+/i,'');return;}
          if(!shared&&(_timkNewAction(next)||_timkNewAction(next.replace(_TIMK_SUBJECT,'').replace(/^be\s+/i,''))||/^(?:a\s+)?new\s+[a-z]/i.test(next)&&_timkNewAction(_timkTidy(buf).toLowerCase()))){push(buf);buf=next;}
          else buf=buf+', '+bit;
        });
        push(buf);
        });
      });
      });
    });
  });
  flushHeld();
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
  const priced=_timkFoldPrices(timScopeFrom(said).map(timStepPrice));
  const steps=priced.map(p=>p.text);
  const staged=timOrderScope(steps);
  const byText={};
  staged.forEach(r=>{if(byText[r.text]===undefined)byText[r.text]=r;});
  const mine=steps.map((t,i)=>{
    const r=byText[t]||{};
    // price: what he said the line costs, 0 when he did not say.
    return {text:t,stage:r.stage||null,stageName:r.stageName||null,was:i,price:priced[i].price||0};
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
// Declared here, ahead of the table that uses them (see _timkTradeFits).
const _TIMK_KNOWN_TRADES=new Set(['painting','plumbing','electrical','hvac','roofing','landscaping','general','other']);
const _TIMK_PAINT_TRADES=['painting','general','other'];
const TIM_IMPLIED=[
  // First of everything: the paper comes before the first tool (2026-09-23).
  {
    id:'access-permit',
    source:'trade',
    stage:'access',
    step:'Pull the permit',
    // HIS CALL, NOT TIM'S (owner, 2026-09-23: "not every job requires a
    // permit or inspection though"). Towns differ and so do jobs, and the
    // proposal prints "Permit and inspection" as included the moment this step
    // is in. So it is asked, never swept in by Add all, and once he has turned
    // it down twice for a kind of job Tim stops asking for that kind.
    say:'Permit for this one?',
    because:'Many towns want one for this work and some do not. Add it if yours does.',
    optIn:true,
    learnKey:(t,steps)=>{const m=_timkAll(t,steps).match(_TIMK_PERMIT);return m?m[1].replace(/\s+/g,' '):null;},
    pairs:{stage:'clean',step:'Schedule the final inspection',last:true},
    when:(t,steps)=>{
      const n=_timkAll(t,steps);const m=n.match(_TIMK_PERMIT);
      return !!m&&!/\bpermit/.test(n)&&!(typeof timDropped==='function'&&timDropped('implied-key','access-permit:'+m[1].replace(/\s+/g,' ')));
    },
  },
  // ── THE UNIT, AND WHAT IT HOOKS UP TO (owner, 2026-09-23) ────────────────
  //
  // "Tim should be smart enough to add in the model and venting requirements."
  // Read as a sceptical couple, "Set a tankless" next to "anything added is a
  // change order" read as the change order already waiting: no unit named, no
  // gas line, no vent. These are what a tankless or high-efficiency swap
  // actually hooks up to, said so the price covers them or he knows it does
  // not.
  {
    id:'install-gas-size',
    source:'trade',
    stage:'rough',
    step:'Check the gas line against the new unit\'s full load and upsize it where it falls short',
    say:'The gas line, sized for the new unit',
    because:'A gas tankless burns several times what a tank does. The old line is often too small, and it shows up as cold water halfway through a shower.',
    when:(t,steps)=>{const n=_timkAll(t,steps);return _TIMK_TANKLESS.test(n)&&!_TIMK_ELECTRIC_TL.test(n)&&!_TIMK_GASLINE.test(n);},
  },
  {
    id:'install-vent',
    source:'trade',
    stage:'install',
    step:'Run new venting for the new unit, to the manufacturer\'s instructions',
    say:'Venting for the new unit',
    because:'A tankless or high-efficiency unit seldom vents like the old one did. In the price, or it is the first change order.',
    when:(t,steps)=>{const n=_timkAll(t,steps);return _TIMK_VENT_KIND.test(n)&&!_TIMK_ELECTRIC_TL.test(n)&&!_TIMK_VENTED.test(n);},
  },
  {
    id:'install-condensate',
    source:'trade',
    stage:'install',
    step:'Run the condensate drain for the new unit',
    say:'Condensate drain',
    because:'High-efficiency units make water. It needs somewhere to go besides the floor.',
    when:(t,steps)=>{const n=_timkAll(t,steps);return _TIMK_CONDENSING.test(n)&&!_TIMK_ELECTRIC_TL.test(n)&&!_TIMK_CONDENSATE.test(n);},
  },
  // Not a step: a question. The unit is named inside his own install line
  // ("Set a tankless, Navien NPE-240A") once he types it, so the customer
  // reads what they are buying and what the warranty is on.
  {
    id:'detail-model',
    source:'trade',
    stage:'install',
    ask:{label:'Make and model',placeholder:'e.g. Navien NPE-240A'},
    say:'Name the unit',
    because:'They are buying a unit. The make and model on the paper is what they get, and what the warranty is on.',
    when:(t,steps)=>{
      const raw=String(t||'')+' '+(steps||[]).map(x=>x&&typeof x==='object'?(x.text||''):String(x||'')).join(' ');
      return _TIMK_EQUIP.test(_timkAll(t,steps))&&!_timkHasModel(raw);
    },
  },
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
    trades:['painting','roofing','general','other'],
    when:(t,steps)=>_timNeedsStaging(t)&&!_timAnyStep(steps,['scaffold','staging','lift','swing stage']),
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
    trades:_TIMK_PAINT_TRADES,
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
    // THE VERB LIST WAS A PAINTER'S. It knew tear out, tear off, strip and demo,
    // which is how a man describes taking siding off a wall and not how he
    // describes getting a water heater out of a basement. "Pull the old water
    // heater" is a tear-out with two hundred pounds to get rid of at the end of
    // it, and Tim said nothing, because not one of those five words is in that
    // sentence. Found on the owner's own bid, 2026-09-22.
    when:(t,steps)=>_timAnyStep(steps,['tear out','tear off','strip','demo','replace',
        'pull the','pull out','take out','rip out','cut out','swap','change out',
        'changeout','remove','get rid of','haul the old'])
      &&!_timAnyStep(steps,['haul','clean','sweep','dumpster']),
  },
  // ── Turn it off before you open it ─────────────────────────────────────────
  //
  // `step` is CONTRACT VOICE, because it is what lands on the customer's scope
  // of work: "Protect the floors along the path in and out", never "the path
  // YOU are carrying through". `say` and `because` are Tim talking to the
  // contractor and never reach the document.
  //
  // Three rules and not one, because the step has to name the right shutoff.
  // "Isolate the system" is what a spec writer would put on a contract and it
  // is not a sentence anybody has said on a job site. A rule that fires on the
  // wrong system is worse than no rule at all, which is the standing rule in
  // this file, so each of these wants its own system named out loud and stays
  // quiet otherwise. An electric water heater is never told to shut the gas
  // off, because nothing in the sentence said gas.
  {
    id:'access-water-off',
    source:'trade',   // sequence and habit, never a code requirement
    stage:'access',
    step:'Shut the water off and drain it down',
    say:'Water off first',
    because:'You are opening a live water line. That happens first or it happens through the ceiling.',
    when:(t,steps)=>{
      const n=_timkNorm(t)+' '+(steps||[]).map(s=>_timkNorm(s&&s.text)).join(' ');
      return _TIMK_WET.test(n)&&!_TIMK_WATER_OFF.test(n);
    },
  },
  {
    id:'access-power-off',
    source:'trade',   // sequence and habit, never a code requirement
    stage:'access',
    step:'Shut the power off at the panel and verify it is dead',
    say:'Power off first',
    because:'You never said you killed it. Nothing else on this list happens until you have.',
    when:(t,steps)=>{
      const n=_timkNorm(t)+' '+(steps||[]).map(s=>_timkNorm(s&&s.text)).join(' ');
      return _TIMK_HOT.test(n)&&!_TIMK_POWER_OFF.test(n);
    },
  },
  {
    id:'access-gas-off',
    source:'trade',   // sequence and habit, never a code requirement
    stage:'access',
    step:'Shut the gas off at the valve',
    say:'Gas off first',
    because:'You said gas. That valve gets closed before anything comes apart.',
    when:(t,steps)=>{
      const n=_timkNorm(t)+' '+(steps||[]).map(s=>_timkNorm(s&&s.text)).join(' ');
      return _TIMK_GAS.test(n)&&!_TIMK_GAS_OFF.test(n);
    },
  },
  {
    id:'protect-path',
    source:'trade',   // sequence and habit, never a code requirement
    stage:'protect',
    step:'Protect the floors along the path in and out',
    say:'Cover the path in and out',
    because:'Something heavy goes through a finished house twice. The floor is the callback.',
    supply:{id:'floor-protect',section:'prep',label:'Floor protection and runners',unit:'ea',qty:1},
    when:(t,steps)=>{
      const n=_timkNorm(t)+' '+(steps||[]).map(s=>_timkNorm(s&&s.text)).join(' ');
      return _TIMK_CARRIED.test(n)&&!_TIMK_COVERED.test(n);
    },
  },
  {
    id:'finish-test',
    source:'trade',   // sequence and habit, never a code requirement
    stage:'finish',
    step:'Pressure test and check every joint for leaks',
    say:'Test it before you leave',
    because:'You find the weep, or the customer does at two in the morning.',
    when:(t,steps)=>{
      const n=_timkNorm(t)+' '+(steps||[]).map(s=>_timkNorm(s&&s.text)).join(' ');
      return (_TIMK_WET.test(n)||_TIMK_GAS.test(n))&&!_TIMK_TESTED.test(n);
    },
  },
  // ── EVERY TRADE, NOT ONE (2026-09-23) ─────────────────────────────────────
  //
  // Owner: "type it or Talk to Tim where they speak what all they are doing,
  // Tim parses it, organizes it and finds gaps so the scope of work is
  // detailed and nothing is forgotten." Run against one job per trade, Tim
  // found a plumber's gaps and a haul-off for everybody else, and nothing at
  // all on a paint job. These are the steps each trade says out loud on a job
  // walk and leaves off the paper. Same rule as the rest of the file: each
  // one listens for its own system named, and stays quiet otherwise. Habit and
  // sequence, never a claim about what an inspector requires.
  {
    id:'demo-refrigerant',
    source:'trade',
    // Before the tear-out, not in it: the charge comes out while the old unit
    // is still connected.
    stage:'protect',
    step:'Recover the refrigerant from the old system',
    say:'Recover the refrigerant',
    because:'The old unit still has its charge. It comes out before a line is cut.',
    when:(t,steps)=>{const n=_timkAll(t,steps);return _TIMK_COOLING.test(n)&&_TIMK_OUT.test(n)&&!/\b(recover|reclaim)/.test(n);},
  },
  {
    id:'finish-vacuum',
    source:'trade',
    stage:'finish',
    step:'Pressure test the line set and pull a vacuum',
    say:'Pressure test and vacuum',
    because:'A new line set is not tight until it holds a vacuum.',
    when:(t,steps)=>{const n=_timkAll(t,steps);return /\bline ?sets?\b/.test(n)&&!/\b(vacuum|evacuat)/.test(n);},
  },
  {
    id:'finish-startup',
    source:'trade',
    stage:'finish',
    step:'Start up the system to the manufacturer\'s instructions and check that it heats and cools',
    say:'Start it up',
    because:'Nobody signs off on a system nobody has run.',
    when:(t,steps)=>{const n=_timkAll(t,steps);return _TIMK_HVAC.test(n)&&!/\b(start ?up|start (it|the system|the unit) up|started (it )?up|fire it( up)?|commission|run it|check the charge)\b/.test(n);},
  },
  // The unit goes in the way its manufacturer says (owner, 2026-09-24: "can
  // we tell Tim to do manufacturers instructions?"). The warranty on a water
  // heater, a softener or a boiler holds only when it does, so it is said on
  // the paper where the customer reads what they are buying. Heating and
  // cooling already say it in their own start-up step (finish-startup), and a
  // panel is tested circuit by circuit (finish-circuits), so neither gets a
  // second line.
  {
    id:'finish-mfr',
    source:'trade',
    stage:'finish',
    step:'Start up the new unit to the manufacturer\'s instructions',
    say:'To the manufacturer\'s instructions',
    because:'The warranty on the unit holds only when it goes in the way its manufacturer says. Put that on the paper.',
    when:(t,steps)=>{
      const n=_timkAll(t,steps);
      // Tim's own venting line says "manufacturer's instructions" for the
      // vent; that is not the unit's start-up, so it does not count as said.
      const said=_timkAll(t,(steps||[]).filter(x=>!/\bvent/i.test(x&&typeof x==='object'?(x.text||''):String(x||''))));
      return _TIMK_MFR_UNIT.test(n)&&!_TIMK_HVAC.test(n)&&_TIMK_NEW.test(n)&&!_TIMK_MFR.test(said);
    },
  },
  {
    id:'finish-circuits',
    source:'trade',
    stage:'finish',
    step:'Test every circuit and label the panel',
    say:'Test and label',
    because:'The panel schedule is what the next person reads. Leave it right.',
    when:(t,steps)=>{const n=_timkAll(t,steps);return _TIMK_HOT.test(n)&&!/\b(label|labeled|labelled|test|tested|testing)\b/.test(n);},
  },
  {
    id:'protect-landscape',
    source:'trade',
    stage:'protect',
    step:'Tarp the landscaping and protect the siding and windows below',
    say:'Tarp the yard',
    because:'A tear-off rains nails and granules on everything under the eaves.',
    when:(t,steps)=>{const n=_timkAll(t,steps);return _TIMK_TEAROFF.test(n)&&!/\b(tarp|tarps|landscap|protect|cover)/.test(n);},
  },
  {
    id:'install-underlayment',
    source:'trade',
    stage:'install',
    step:'Dry in with underlayment, and ice and water shield at the eaves and valleys',
    say:'Underlayment and ice and water',
    because:'Whatever goes between the deck and the shingles is the leak you get called back for.',
    when:(t,steps)=>{const n=_timkAll(t,steps);return _TIMK_REROOF.test(n)&&!/\b(underlayment|synthetic|felt|ice and water|ice & water|dry in|dried in)\b/.test(n);},
  },
  {
    id:'install-flashing',
    source:'trade',
    stage:'install',
    step:'Install new drip edge and flash the walls, chimney and pipes',
    say:'Drip edge and flashing',
    because:'Say new or reused. Left off, the customer assumes new.',
    when:(t,steps)=>{const n=_timkAll(t,steps);return _TIMK_REROOF.test(n)&&!/\b(drip ?edge|flash|flashing|pipe boots?)\b/.test(n);},
  },
  {
    id:'clean-magnet',
    source:'trade',
    stage:'clean',
    step:'Run a magnet sweep for nails around the house',
    say:'Magnet sweep',
    because:'One nail in their tire is the review they leave.',
    when:(t,steps)=>{const n=_timkAll(t,steps);return _TIMK_TEAROFF.test(n)&&!/\bmagnet/.test(n);},
  },
  {
    id:'protect-mask-inside',
    source:'trade',
    stage:'protect',
    step:'Cover the floors and furniture, and mask off what is not being painted',
    trades:_TIMK_PAINT_TRADES,
    say:'Cover and mask',
    because:'Paint on the floor is the one thing they notice before the walls.',
    when:(t,steps)=>{const n=_timkAll(t,steps);return _TIMK_PAINTS.test(n)&&_TIMK_INSIDE.test(n)&&!_TIMK_COVERED.test(n);},
  },
  {
    id:'protect-mask-outside',
    source:'trade',
    stage:'protect',
    step:'Cover the plants, walks and windows, and mask off what is not being painted',
    trades:_TIMK_PAINT_TRADES,
    say:'Cover and mask',
    because:'Overspray on a car or a window is a bill, not a touch-up.',
    when:(t,steps)=>{const n=_timkAll(t,steps);return _TIMK_PAINTS.test(n)&&_TIMK_OUTSIDE.test(n)&&!_TIMK_INSIDE.test(n)&&!_TIMK_COVERED.test(n);},
  },
  {
    id:'clean-walkthrough',
    source:'trade',
    stage:'clean',
    step:'Clean up, walk it with the customer and touch up anything missed',
    say:'Walk-through and touch-up',
    because:'The punch list is cheaper on the last day than on a callback.',
    // A job with a tear-out already ends in the haul-off; this is for the
    // ones that do not, which is most paint and finish work.
    when:(t,steps)=>{const n=_timkAll(t,steps);return (_TIMK_PAINTS.test(n)||_TIMK_FLOORS.test(n))
      &&!_timAnyStep(steps,['tear','strip','demo','pull the','pull out','take out','rip out','cut out','remove','swap','change out','get rid of'])
      &&!/\b(clean|walk|touch ?up|punch|haul|sweep)/.test(n);},
  },
  {
    id:'protect-furniture',
    source:'trade',
    stage:'protect',
    step:'Move the furniture out of the rooms, and back in after',
    say:'Move the furniture',
    because:'Somebody moves it. Say whether that is the crew.',
    when:(t,steps)=>{const n=_timkAll(t,steps);return _TIMK_FLOORS.test(n)&&!/\bfurniture\b/.test(n);},
  },
  {
    id:'access-acclimate',
    source:'trade',
    stage:'access',
    step:'Deliver the flooring early so it acclimates on site',
    say:'Let it acclimate',
    because:'Plank laid the day it arrives moves when the house does.',
    when:(t,steps)=>{const n=_timkAll(t,steps);return /\b(hardwood|engineered|lvp|luxury vinyl|vinyl plank|laminate)\b/.test(n)&&!/\bacclimat/.test(n);},
  },
  {
    id:'restore-floor-trim',
    source:'trade',
    stage:'restore',
    step:'Reinstall the baseboards and set transitions at every doorway',
    say:'Baseboards and transitions',
    because:'The floor is not finished until the edges are.',
    when:(t,steps)=>{const n=_timkAll(t,steps);return _TIMK_FLOORS.test(n)&&!/\b(baseboards?|base|shoe|quarter ?round|transitions?|trim)\b/.test(n);},
  },
  {
    id:'protect-dust',
    source:'trade',
    stage:'protect',
    step:'Hang plastic and protect the rooms around the work from dust',
    say:'Dust control',
    because:'Sanding mud goes through the whole house unless it is closed off.',
    when:(t,steps)=>{const n=_timkAll(t,steps);return _TIMK_DRYWALL.test(n)&&!/\b(plastic|dust|zip ?wall|protect|cover)/.test(n);},
  },
  {
    id:'repair-dry',
    source:'trade',
    stage:'repair',
    step:'Confirm the leak is fixed and the framing is dry before closing up',
    say:'Dry before it is closed up',
    because:'Board hung over a wet stud is mold in six months.',
    when:(t,steps)=>{const n=_timkAll(t,steps);return _TIMK_DRYWALL.test(n)&&/\b(water damage|water damaged|flood|flooded|leak|leaked|leaking|mold|moldy)\b/.test(n)&&!/\b(dry|dried|moisture)\b/.test(n);},
  },
  {
    id:'finish-prime-drywall',
    source:'trade',
    stage:'finish',
    step:'Prime the new drywall',
    trades:_TIMK_PAINT_TRADES,
    say:'Prime it',
    because:'New board is not done until it is primed. Swipe it away if paint is somebody else.',
    when:(t,steps)=>{const n=_timkAll(t,steps);return _TIMK_DRYWALL.test(n)&&!/\b(prime|primer|primed|paint)/.test(n);},
  },
];

// What the rules above listen for. Kept beside them rather than inline so the
// phrasing cannot drift between the pattern that fires a nudge and the pattern
// that keeps it quiet because he already said it.
//
// Every one is narrow on purpose. A water heater is deliberately NOT on the gas
// list: half of them are electric, and the sentence has to say gas before Tim
// will say anything about gas.
const _TIMK_WET=/\b(water heater|tankless|water softener|softener|pex|copper|supply lines?|water lines?|water main|shut ?off valve|angle stop|faucet|toilet|tub|shower valve|sink|p-?trap|manifold|hose ?bib|water service|re-?pipe|boiler|water tank)\b/;
const _TIMK_WATER_OFF=/\b(shut ?off|shut the water|water off|turn the water|isolate|drain(ed)? (it|the|down)|drain down)\b/;
// "The access panel behind the tub" is a plumber's hatch, not a breaker panel.
const _TIMK_HOT=/\b(?<!access )(panel|sub ?panel|breakers?|circuits?|romex|wiring|rewire|receptacles?|outlets?|switch leg|service (change|upgrade)|disconnect|conduit|whip)\b/;
const _TIMK_POWER_OFF=/\b(kill the power|killed the power|power off|shut the power|breakers? off|lock ?out|tag ?out|de-?energi[sz])\b/;
const _TIMK_GAS=/\b(gas|propane|lp|csst|black iron)\b/;
const _TIMK_GAS_OFF=/\b(gas off|shut the gas|close the valve|close the gas|isolate the gas|lock ?out)\b/;
const _TIMK_CARRIED=/\b(water heater|tankless|softener|furnace|boiler|tub|vanity|cabinets?|appliance|washer|dryer|range|refrigerator|water tank|condenser|air handler)\b/;
const _TIMK_COVERED=/\b(cover|covered|drop ?cloth|protect|masked?|masking|floor protection|ram ?board|runners?)\b/;
const _TIMK_TESTED=/\b(test|tested|testing|pressure|pressured|leak ?check|leak ?test|check for leaks|purge|bleed|bled)\b/;

// For the trade rules: what he said and the steps it became, as one string.
function _timkAll(t,steps){return _timkNorm(t)+' '+(steps||[]).map(x=>_timkNorm(x&&typeof x==='object'?(x.text||''):x)).join(' ');}
// The systems each trade rule listens for. Narrow, like the ones above.
const _TIMK_PERMIT=/\b(?<!access )(panel|sub ?panel|service (change|upgrade)|(100|150|200|400) ?amp|new circuit|water heater|tankless|furnace|heat pump|air handler|condenser|boiler|mini ?split|gas line|re-?roof|new roof|tear ?off)\b/;
const _TIMK_TANKLESS=/\b(tankless|on ?demand water heater)\b/;
const _TIMK_ELECTRIC_TL=/\belectric (tankless|on ?demand)\b/;
const _TIMK_GASLINE=/\b(gas lines?|gas pipe|gas piping|upsize|black iron|csst)\b/;
const _TIMK_VENT_KIND=/\b(tankless|high efficiency|condensing|furnace|boiler)\b/;
const _TIMK_VENTED=/\b(vent|venting|vents|vented|flue|exhaust|chimney|concentric|intake pipe)\b/;
const _TIMK_CONDENSING=/\b(tankless|high efficiency|condensing|furnace|air handler)\b/;
const _TIMK_CONDENSATE=/\b(condensate|neutralizer|drain line)\b/;
const _TIMK_EQUIP=/\b(?<!access )(tankless|water heater|furnace|heat pump|air handler|condenser|boiler|mini ?split|ac unit|air conditioner|panel|sub ?panel|water softener)\b/;
// A named unit: a maker he would say, or a model number (letters then digits,
// the way they are printed on the plate). Read from what he typed, case and all.
const _TIMK_BRANDS=/\b(navien|rinnai|rheem|ruud|noritz|takagi|bosch|a\.? ?o\.? smith|bradford white|carrier|bryant|trane|american standard|lennox|goodman|amana|daikin|mitsubishi|fujitsu|york|payne|heil|tempstar|square d|eaton|siemens|cutler hammer|leviton|kinetico|culligan|fleck|weil mclain|burnham|viessmann)\b/i;
function _timkHasModel(raw){return _TIMK_BRANDS.test(raw)||/\b[A-Z]{1,6}-?\d{2,}[A-Z0-9-]*\b/.test(raw);}
const _TIMK_COOLING=/\b(ac|a c|air conditioner|air conditioning|condenser|heat pump|mini ?split|evaporator coil|line ?set)\b/;
const _TIMK_OUT=/\b(pull|pulling|remove|removing|swap|swapping|change out|changing out|replace|replacing|take out|tear out|old)\b/;
// A unit that comes with a manufacturer's installation manual, one that goes
// in (not one that only comes out), and whether he already said so.
const _TIMK_MFR_UNIT=/\b(tankless|water heater|water softener|softener|boiler|well pump|sump pump|ejector pump|grinder pump|water filtration|whole house filter|garbage disposal|dishwasher|generator)\b/;
const _TIMK_NEW=/\b(new|set|install|installing|put in|swap in|replace|replacing)\b/;
const _TIMK_MFR=/\b(manufacturer|manufacturers|mfr|mfg|maker|makers|install(ation)? (manual|instructions)|per (the )?(instructions|specs?))\b/;
const _TIMK_HVAC=/\b(furnace|heat pump|air handler|condenser|ac unit|air conditioner|mini ?split|boiler)\b/;
const _TIMK_TEAROFF=/\b(tear ?off|tearing off|strip the roof|re-?roof|new roof|shingles? off)\b/;
const _TIMK_REROOF=/\b(tear ?off|tearing off|re-?roof|new roof|shingle it|new shingles|architectural shingles|reshingle)\b/;
const _TIMK_PAINTS=/\b(paint|painting|repaint|prime|primer|stain|two coats|one coat|topcoat|top coat)\b/;
const _TIMK_INSIDE=/\b(rooms?|interior|inside|walls?|ceilings?|kitchen|bedrooms?|bathrooms?|bath|hallway|living room|dining room|basement|cabinets|closets?|stairwell)\b/;
const _TIMK_OUTSIDE=/\b(house|exterior|outside|siding|soffits?|fascia|deck|fence|porch|shutters|garage door)\b/;
const _TIMK_FLOORS=/\b(carpet|lvp|luxury vinyl|vinyl plank|laminate|hardwood|engineered|tile floor|floor tile|flooring|new floor|floors)\b/;
const _TIMK_DRYWALL=/\b(drywall|sheetrock|gypsum|hang (new )?board|tape and mud|mud and tape|mud it)\b/;

function _timSaysHigh(t){
  const n=_timkNorm(t);
  return /\b(second (floor|storey|story)|two (storey|story)|2nd (floor|storey|story)|upstairs|second level|gable|steep|high side|eave)\b/.test(n);
}
// HIGH AND OUTSIDE. Scaffold is for the outside of a tall house. "The upstairs
// bathroom" is high and indoors, and the audit's plumber was offered scaffold
// for a toilet (2026-09-27). The work has to be on the outside of the house
// for the height to mean staging.
const _TIMK_EXTERIOR=/\b(paint|painting|repaint|strip|stain|siding|soffits?|fascia|gutters?|eaves?|gable|roof|roofing|shingles?|elevation|exterior|outside|brick|stucco|scaffold|staging|shutters)\b/;
function _timNeedsStaging(t){return _timSaysHigh(t)&&_TIMK_EXTERIOR.test(_timkNorm(t));}
// Which trades a rule speaks to. A rule with no list speaks to every trade; a
// rule with one says nothing on a job of another known trade. An unknown or
// missing trade filters nothing, so a new trade is never silenced by accident.
function _timkTradeFits(rule,trade){
  const t=String(trade||'').toLowerCase();
  if(!t||!_TIMK_KNOWN_TRADES.has(t)||!Array.isArray(rule.trades))return true;
  return rule.trades.indexOf(t)>=0;
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
    // A plumbing job is not offered primer and scaffold (the audit, 2026-09-27).
    if(!_timkTradeFits(r,o.trade))return;
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
      // A question rather than a step, and steps that are his call. Neither is
      // swept in by Add all.
      ask:r.ask?Object.assign({},r.ask):null,
      optIn:!!(r.optIn||r.ask),
      learnKey:(()=>{try{return typeof r.learnKey==='function'?r.learnKey(said,steps||[]):null;}catch(_e){return null;}})(),
    });
  });
  // IN WORK ORDER, like everything else he hands back. The list used to come
  // out in whatever order the rules happen to sit in this file, which put
  // "haul the debris off" above "shut the water off" on a water heater swap:
  // the last thing he does, read first. Same spine the scope itself is sorted
  // on, so the forgotten steps read in the order he would do them. A rule with
  // no stage (the consumables one) sorts to the end rather than to the front,
  // because it is a supply list and not a step in the sequence.
  const ix=r=>{const i=_TIM_STAGE_IX[r.stage];return (i===undefined)?TIM_STAGES.length:i;};
  return out.map((r,i)=>({r,i})).sort((a,b)=>ix(a.r)-ix(b.r)||a.i-b.i).map(x=>x.r);
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
  const implied=timImplied(said,steps,{rejected:o.rejected,trade:o.trade})
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
