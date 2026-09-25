// ── Trade knowledge: what a job includes and what gets missed ─────────────────
//
// Owner 2026-09-25: "Tim should know trade knowledge ... filling in the gaps
// contractors miss to generate professional highly closing proposals." That
// reversed the 2026-09-17 line that Tim owns no trade knowledge. It lives HERE,
// as data, in one place, so Tim, the spoken estimate and the estimate builder
// all read the same answer and none of them grows a private copy (7.3).
//
// Two things per job, and nothing else:
//   scope   the professional description of the work, written the way a
//           client reads it. It fills a line's description only when the
//           contractor left it empty; his own words always win.
//   missed  the items that belong with this job and get left off the bid. They
//           are OFFERED, never added: the "Usually goes with this" card
//           (js/generic-estimate.js _attachSuggestions) shows them beside the
//           ones he has learned from his own bids, one tap to add.
//
// A SCOPE NEVER PROMISES WHAT A COMPANION PRICES. Haul-away is offered as its
// own line on a water heater, so the water heater's scope does not say it
// hauls the old one away for free.
//
// PRICES ARE HIS. `rate` here is a starting point so an added line is never a
// zero; the price book wins the moment he has priced the item once
// (_geiAddRememberedLine reads the book first), and it learns from every bid.
//
// No model and no network: this is a table and three pure functions, so it
// runs in a basement and costs nothing per use (CLAUDE.md 18.2).
//
// ORDER MATTERS inside a trade: the first entry whose `match` fits the line
// wins, so the specific ("tankless water heater") sits above the general
// ("water heater").

const TK_LIB={
  plumbing:[
    {id:'tankless',match:/tankless|on.?demand water/,
      scope:'Remove the existing water heater. Mount the new tankless unit, install isolation (service) valves for future descaling, run venting to the manufacturer\'s spec, connect gas, water and condensate, set the temperature, and test for leaks and proper ignition.',
      missed:[
        {label:'Gas line upsize for tankless',rate:450,why:'Tankless needs far more gas than a tank, usually a larger line back to the meter'},
        {label:'Venting kit (tankless)',rate:325,why:'The old tank vent cannot be reused'},
        {label:'Condensate neutralizer & drain',rate:125,why:'Condensing units drain acidic water'},
        {label:'Scale prevention filter',rate:185,why:'Hard water shortens tankless life and voids some warranties'},
        {label:'Water heater permit & inspection',rate:95,why:'Most cities require one for a water heater change'},
        {label:'Haul-away & disposal of old unit',rate:75,why:'Often assumed, rarely priced'},
      ]},
    {id:'water_heater',match:/water heater|hot water tank|\bwh\b/,
      scope:'Drain and disconnect the existing water heater. Set the new water heater, connect the water and fuel supply, pipe the temperature and pressure relief valve discharge to code, check venting and draft, fill, purge air, light or energize, and test for leaks.',
      missed:[
        {label:'Thermal expansion tank',rate:185,why:'Required on a closed system with a check valve or pressure reducing valve'},
        {label:'Water heater permit & inspection',rate:95,why:'Most cities require one for a water heater change'},
        {label:'Drip pan with drain line',rate:75,why:'Required where a leak would damage finished space'},
        {label:'Gas flex connector & sediment trap',rate:65,why:'Code requires a drip leg at the appliance on gas units'},
        {label:'Cold supply shutoff valve replacement',rate:95,why:'Old gate valves often fail when turned off for the swap'},
        {label:'Haul-away & disposal of old unit',rate:75,why:'Often assumed, rarely priced'},
      ]},
    {id:'boiler',match:/boiler/,
      scope:'Isolate and drain the heating system, remove the existing boiler, set the new boiler, connect supply and return, gas, venting and controls, refill, purge air, fire, and verify safe operation and temperatures.',
      missed:[
        {label:'Boiler expansion tank',rate:225,why:'The old tank is usually waterlogged or undersized'},
        {label:'Venting / chimney liner',rate:650,why:'A new high-efficiency boiler rarely vents into the old chimney'},
        {label:'System flush & chemical treatment',rate:275,why:'Sludge in old piping kills a new heat exchanger'},
        {label:'Boiler permit & inspection',rate:150,why:'Required for a heating appliance change'},
      ]},
    {id:'toilet',match:/toilet|commode/,
      scope:'Remove the existing toilet, inspect the flange, set the new toilet on a new wax ring and closet bolts, connect a new supply line, and test for leaks and a proper flush.',
      missed:[
        {label:'Closet flange repair',rate:95,why:'A broken or corroded flange is found only once the toilet is pulled'},
        {label:'Toilet shutoff valve & supply line',rate:85,why:'The old stop rarely closes cleanly'},
        {label:'Haul-away of old toilet',rate:45,why:'Often assumed, rarely priced'},
      ]},
    {id:'faucet',match:/faucet/,
      scope:'Remove the existing faucet, install the new faucet with new supply lines, check the drain and P-trap, and test for leaks and proper flow.',
      missed:[
        {label:'Angle stop valves (pair)',rate:110,why:'Old stops often drip or will not close'},
        {label:'Drain assembly & P-trap',rate:85,why:'A new faucet on an old corroded drain still leaks'},
      ]},
    {id:'disposal',match:/garbage disp|disposer|insinkerator/,
      scope:'Remove the existing disposal, mount the new unit, connect the drain and dishwasher line, wire to the existing power, and test for leaks and operation.',
      missed:[
        {label:'Dishwasher knockout & connection',rate:45,why:'Forgetting the knockout floods the sink when the dishwasher drains'},
        {label:'Under-sink outlet or hardwire',rate:165,why:'Many sinks have no power where a disposal needs it'},
      ]},
    {id:'sump',match:/sump/,
      scope:'Remove the existing sump pump, install the new pump with a new check valve, connect the discharge, and test the float and pump-out.',
      missed:[
        {label:'Battery backup sump pump',rate:450,why:'Storms that fill the pit are the storms that cut power'},
        {label:'Sump check valve',rate:65,why:'A failed check valve cycles the new pump to death'},
        {label:'Discharge line extension',rate:95,why:'Water dumped at the foundation comes straight back in'},
        {label:'Dedicated GFCI outlet for pump',rate:175,why:'Code requires GFCI; a shared circuit trips the pump off'},
      ]},
    {id:'hydro_jet',match:/hydro.?jet|jetting/,
      scope:'Clear the line with high-pressure water jetting to scour grease, scale and roots from the pipe walls, then flush and verify flow.',
      missed:[
        {label:'Camera inspection',rate:195,why:'Shows the client the result and finds breaks jetting cannot fix'},
        {label:'Cleanout installation',rate:550,why:'No accessible cleanout means pulling a toilet every time'},
      ]},
    {id:'drain',match:/drain clean|drain clear|clog|snake|rooter|backed up/,
      scope:'Clear the blocked drain line with a cable machine from the nearest access point, flush the line, and verify it drains freely.',
      missed:[
        {label:'Camera inspection',rate:195,why:'Finds roots, bellies or breaks so the clog does not come back'},
        {label:'Cleanout installation',rate:550,why:'No accessible cleanout means pulling a toilet every time'},
      ]},
    {id:'repipe',match:/repipe|re.?pipe|pex|pipe replace|copper pipe|pvc pipe|supply line replace/,
      scope:'Replace the water supply piping with new pipe and fittings, run new lines to each fixture, install new shutoff valves, pressure test the system, and restore water service.',
      missed:[
        {label:'Drywall access holes & patching',rate:650,why:'Repiping means opening walls; patching is the line clients argue over'},
        {label:'New fixture shutoff valves',rate:350,why:'Tying new pipe into old stops wastes the repipe'},
        {label:'Main shutoff valve replacement',rate:225,why:'The main is usually the oldest valve in the house'},
        {label:'Repipe permit & inspection',rate:175,why:'Required in most cities for supply replacement'},
      ]},
    {id:'leak',match:/leak|burst|broken pipe|pipe repair/,
      scope:'Locate and repair the leak, replace the damaged section with new pipe and fittings, restore water, and verify the repair holds under pressure.',
      missed:[
        {label:'Drywall access & patch',rate:295,why:'The leak is usually behind a wall or ceiling'},
        {label:'Moisture check of surrounding area',rate:95,why:'Hidden wet framing grows mold after the repair'},
      ]},
    {id:'gas_line',match:/gas (line|run|pipe|repair|appliance)|gas conn/,
      scope:'Install or repair gas piping to code, add a shutoff valve and sediment trap at the appliance, pressure test the line, and leak-check every joint before restoring service.',
      missed:[
        {label:'Gas permit & inspection',rate:150,why:'Gas work is permitted almost everywhere'},
        {label:'Pressure test & tag',rate:125,why:'The inspector will ask for it'},
        {label:'Appliance shutoff valve & flex connector',rate:85,why:'Code requires a shutoff within reach of the appliance'},
      ]},
    {id:'hose_bib',match:/hose bib|spigot|sillcock|outdoor faucet/,
      scope:'Remove the existing hose bib and install a new frost-free sillcock, sealed at the wall, and test for leaks.',
      missed:[
        {label:'Vacuum breaker',rate:35,why:'Required backflow protection on outdoor faucets'},
      ]},
  ],
  electrical:[
    {id:'panel',match:/panel (upgrade|replace|change)|service (upgrade|entrance)|\b(100|150|200|400) ?a(mp)? (panel|service)/,
      scope:'Coordinate the utility disconnect, replace the electrical panel and main breaker, transfer and label every circuit, bond and ground the system to code, and restore power after inspection.',
      missed:[
        {label:'Electrical permit & inspection',rate:250,why:'Every panel change is permitted'},
        {label:'Grounding electrode system (rods & bonding)',rate:325,why:'Old services rarely meet current grounding code'},
        {label:'Meter base replacement',rate:650,why:'A larger service usually needs a new meter socket'},
        {label:'AFCI / GFCI breakers required by code',rate:480,why:'Inspectors require them on the circuits you touch'},
        {label:'Whole-home surge protector',rate:325,why:'Cheapest time to add one is with the panel open'},
        {label:'Wall patch around panel',rate:175,why:'A new panel rarely matches the old opening'},
      ]},
    {id:'ev',match:/\bev\b|electric vehicle|car charger|tesla|level 2/,
      scope:'Install a dedicated 240-volt circuit from the panel to the charger location, mount and connect the charger, and verify operation.',
      missed:[
        {label:'Load calculation & panel capacity check',rate:150,why:'An EV is the largest load in most homes'},
        {label:'GFCI breaker for EV circuit',rate:145,why:'Current code requires ground-fault protection on EV outlets'},
        {label:'Conduit run to garage',rate:350,why:'Most chargers are far from the panel'},
        {label:'Electrical permit & inspection',rate:175,why:'EV circuits are permitted'},
      ]},
    {id:'exhaust',match:/exhaust fan|bath fan|bathroom fan/,
      scope:'Install the bath exhaust fan, duct it to the exterior with a proper termination, connect to the switch, and test airflow.',
      missed:[
        {label:'Duct to exterior with roof or wall cap',rate:225,why:'Venting into the attic rots the roof deck and fails inspection'},
        {label:'Humidity-sensing switch',rate:85,why:'Fans only work if they run long enough'},
      ]},
    {id:'circuit',match:/circuit|dedicated \d+ ?v|sub panel/,
      scope:'Run a new dedicated circuit from the panel to the location, install the breaker and termination, label the panel, and test.',
      missed:[
        {label:'AFCI / GFCI breaker where code requires',rate:95,why:'Most new circuits in a home need one or the other'},
        {label:'Drywall patch at the wire run',rate:150,why:'Fishing wire always opens a hole somewhere'},
        {label:'Electrical permit & inspection',rate:125,why:'New circuits are permitted in most cities'},
      ]},
    {id:'fan',match:/ceiling fan/,
      scope:'Remove the existing fixture, install a fan-rated box and brace, assemble and hang the ceiling fan, connect to the existing switch, and test all speeds and the light.',
      missed:[
        {label:'Fan-rated box & brace',rate:85,why:'A light box is not rated to carry a spinning fan'},
        {label:'Wall control or remote',rate:65,why:'Separate fan and light control is what clients expect'},
      ]},
    {id:'recessed',match:/recessed|can light|pot light/,
      scope:'Lay out and cut in the recessed lights, run and connect wiring, install the housings and trims, and test.',
      missed:[
        {label:'Dimmer switch',rate:95,why:'Recessed lights without a dimmer are the top callback'},
        {label:'Drywall patch & paint touch-up',rate:225,why:'Fishing wire always opens a hole somewhere'},
      ]},
    {id:'hot_tub',match:/hot tub|spa\b|jacuzzi/,
      scope:'Run a dedicated circuit to the hot tub, install a GFCI disconnect within sight of the tub, bond per code, and energize and test.',
      missed:[
        {label:'GFCI spa disconnect',rate:275,why:'Required within sight of the tub'},
        {label:'Trenching & buried conduit',rate:550,why:'Most tubs sit away from the house'},
        {label:'Electrical permit & inspection',rate:175,why:'Spa circuits are permitted'},
      ]},
    {id:'outlet',match:/outlet|receptacle|\bplug\b|gfci outlet/,
      scope:'Install the new receptacle in a new box, run and connect wiring from the nearest suitable circuit, and test for correct polarity and ground.',
      missed:[
        {label:'GFCI protection where code requires',rate:65,why:'Kitchens, baths, garages and outdoors all need it'},
        {label:'Drywall patch at new box',rate:95,why:'Fishing wire always opens a hole somewhere'},
      ]},
    {id:'generator',match:/generator|transfer switch|interlock/,
      scope:'Install the generator connection with a code-approved transfer method, a power inlet, and labeled circuits, then test a full transfer.',
      missed:[
        {label:'Interlock kit or transfer switch',rate:450,why:'Backfeeding without one is illegal and deadly'},
        {label:'Power inlet box',rate:225,why:'The generator needs a safe outdoor connection point'},
        {label:'Electrical permit & inspection',rate:175,why:'Generator connections are permitted'},
      ]},
  ],
  hvac:[
    {id:'tuneup',match:/tune.?up|maintenance|service call/,
      scope:'Inspect and clean the system, check refrigerant pressures, electrical connections, capacitors and safeties, test operation, and report findings.',
      missed:[
        {label:'Filter replacement',rate:35,why:'Always needed, often forgotten on the bill'},
        {label:'Coil cleaning',rate:175,why:'Dirty coils are the common find on a tune-up'},
      ]},
    {id:'ac',match:/(\bac\b|air condition|heat pump|condenser|\brtu\b)[a-z ]*(replace|install|new|system|change)|\d ?-?ton\b|\bac\d/,
      scope:'Recover refrigerant and remove the existing equipment. Set the new condenser on a level pad, install the matching indoor coil, connect the line set, electrical and condensate, pull a deep vacuum, charge to manufacturer specification, and verify temperatures and operation.',
      missed:[
        {label:'New line set or line set flush',rate:650,why:'New refrigerants and old oil do not mix'},
        {label:'Matching evaporator coil',rate:1200,why:'The rated efficiency only holds with a matched coil'},
        {label:'Condenser pad',rate:125,why:'The old pad has usually settled'},
        {label:'Electrical disconnect & whip',rate:185,why:'The old disconnect is often rusted or undersized'},
        {label:'Condensate line or pump',rate:175,why:'A new coil needs a clean, trapped drain'},
        {label:'Smart thermostat',rate:275,why:'The easiest upgrade to say yes to'},
        {label:'HVAC permit & inspection',rate:150,why:'Equipment changes are permitted'},
      ]},
    {id:'furnace',match:/furnace/,
      scope:'Remove the existing furnace, set the new furnace, connect gas, venting, ductwork and controls, verify gas pressure, temperature rise and safeties, and haul away the old unit.',
      missed:[
        {label:'Venting (PVC for high-efficiency or liner)',rate:450,why:'A 90%+ furnace cannot use the old metal flue'},
        {label:'Condensate pump & drain',rate:175,why:'High-efficiency furnaces drain water'},
        {label:'Gas connection & sediment trap',rate:95,why:'Code requires a drip leg at the appliance'},
        {label:'Return / filter rack modification',rate:295,why:'A new cabinet rarely matches the old return'},
        {label:'HVAC permit & inspection',rate:150,why:'Equipment changes are permitted'},
      ]},
    {id:'mini_split',match:/mini.?split|ductless/,
      scope:'Mount the indoor head and outdoor unit, drill and seal the wall penetration, run and insulate the line set, communication wire and condensate, pull a vacuum, charge, and verify heating and cooling.',
      missed:[
        {label:'Dedicated circuit & disconnect',rate:450,why:'Every outdoor unit needs its own circuit'},
        {label:'Line hide cover',rate:225,why:'Bare line set on the siding is what clients complain about'},
        {label:'Wall bracket or pad for outdoor unit',rate:150,why:'Rarely included in the equipment price'},
        {label:'Condensate pump',rate:195,why:'Not every head can drain by gravity'},
      ]},
  ],
  roofing:[
    {id:'reroof',match:/shingle|re.?roof|roof replace|tear.?off|arch/,
      scope:'Tear off the existing roofing to the deck, replace damaged decking, install drip edge, ice and water shield at eaves and valleys, synthetic underlayment, starter, the new shingles, new flashing and pipe boots, and ridge cap and ventilation. Clean the site and sweep for nails.',
      missed:[
        {label:'Decking replacement (per sheet)',rate:95,why:'Rotted decking is found only after tear-off; price it up front'},
        {label:'Ice & water shield',rate:450,why:'Required at eaves in cold climates and in valleys'},
        {label:'Drip edge',rate:350,why:'Required by current code on eaves and rakes'},
        {label:'Ridge vent / ventilation',rate:425,why:'Poor ventilation voids most shingle warranties'},
        {label:'Pipe boots & flashing',rate:225,why:'Reusing old flashing is where new roofs leak'},
        {label:'Additional layer tear-off',rate:650,why:'A second layer doubles the tear-off'},
        {label:'Dumpster & magnetic nail sweep',rate:475,why:'Clients remember the nails in the driveway'},
        {label:'Roofing permit',rate:150,why:'Most cities require one for a reroof'},
      ]},
    {id:'gutters',match:/gutter/,
      scope:'Remove the existing gutters, install new seamless gutters with hidden hangers and downspouts, seal the joints, and test the flow.',
      missed:[
        {label:'Gutter guards',rate:650,why:'The top add-on clients ask about after'},
        {label:'Downspout extensions',rate:95,why:'Water dumped at the foundation undoes the gutter'},
        {label:'Fascia board repair',rate:275,why:'Rotted fascia is found when the old gutter comes down'},
      ]},
  ],
  general:[
    {id:'drywall',match:/drywall|sheetrock/,
      scope:'Hang and fasten new drywall, tape and finish the seams, and sand smooth ready for paint.',
      missed:[
        {label:'Texture match',rate:195,why:'Smooth patch on a textured wall shows'},
        {label:'Prime & paint',rate:275,why:'A finished patch is not a finished wall'},
      ]},
    {id:'demo',match:/demo|demolition|tear out/,
      scope:'Protect surrounding areas, remove and dispose of the specified materials, and leave the area broom clean.',
      missed:[
        {label:'Dumpster & haul-away',rate:475,why:'Demo is mostly disposal'},
        {label:'Dust containment',rate:195,why:'Clients judge the job by the dust in the next room'},
      ]},
  ],
  landscaping:[
    {id:'sod',match:/\bsod\b/,
      scope:'Remove existing turf, grade and prepare the soil, lay new sod with tight seams, roll, and water in.',
      missed:[
        {label:'Soil grading & prep',rate:350,why:'Sod on unprepared ground dies in spots'},
        {label:'Starter fertilizer',rate:85,why:'Roots take faster with it'},
      ]},
    {id:'tree_removal',match:/tree[a-z ]*remov|remov[a-z ]*tree|stump/,
      scope:'Fell and section the tree safely, remove the wood and brush, and rake the area clean.',
      missed:[
        {label:'Stump grinding',rate:250,why:'The first question after the tree is down'},
        {label:'Debris haul-away',rate:175,why:'Often assumed, rarely priced'},
      ]},
  ],
};

let _tkCompanionSet=null;
function _tkCompanions(){
  if(_tkCompanionSet)return _tkCompanionSet;
  _tkCompanionSet=new Set();
  Object.keys(TK_LIB).forEach(t=>TK_LIB[t].forEach(j=>j.missed.forEach(m=>_tkCompanionSet.add(_tkNorm(m.label)))));
  return _tkCompanionSet;
}
function _tkNorm(s){return String(s||'').toLowerCase().replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim();}

// The job a line is, or null. His trade first, then every other trade, because
// a plumber who also sets a disposal circuit still wants the electrical answer.
function tkJobFor(label,trade){
  const t=_tkNorm(label);
  if(!t)return null;
  const order=[trade].concat(Object.keys(TK_LIB).filter(k=>k!==trade));
  for(const tr of order){
    const list=TK_LIB[tr];
    if(!Array.isArray(list))continue;
    for(const j of list){if(j.match.test(t))return j;}
  }
  return null;
}
// The professional description of a line, or '' when the library has none.
function tkScopeFor(label,trade){
  const j=tkJobFor(label,trade);
  return j?j.scope:'';
}
// What gets missed, given what is already on the estimate. `current` is a Map
// of key -> label (the shape _attachCurrent returns); `skip` is keys the
// contractor said "not this time" to. An item already on the bid, under its
// own words or close to them, is never offered again.
function tkMissedFor(current,trade,skip){
  const cur=current instanceof Map?current:new Map();
  const skipped=new Set(Array.isArray(skip)?skip:[]);
  const have=[...cur.values()].map(_tkNorm);
  const onBid=(label)=>{
    const n=_tkNorm(label);
    const words=n.split(' ').filter(w=>w.length>3);
    return have.some(h=>h===n||(words.length&&words.filter(w=>h.indexOf(w)>=0).length/words.length>=0.6));
  };
  const out=[],seen=new Set();
  cur.forEach(anchorLabel=>{
    // A companion this library offered is not a job of its own: "Haul-away &
    // disposal of old unit" must never go looking for garbage disposal extras.
    if(_tkCompanions().has(_tkNorm(anchorLabel)))return;
    const j=tkJobFor(anchorLabel,trade);
    if(!j)return;
    j.missed.forEach(m=>{
      const key=_tkNorm(m.label);
      if(seen.has(key)||skipped.has(key)||cur.has(key)||onBid(m.label))return;
      seen.add(key);
      out.push({key,lib:true,why:m.why,anchorLabel,
        line:{label:m.label,rate:m.rate,unit:m.unit||'ea',notes:m.notes||''}});
    });
  });
  return out;
}
