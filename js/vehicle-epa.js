// ── EPA fuel economy on the vehicle (owner 2026-10-02) ──────────────────────
// "I'm an automated mofo, so I would want it to grab that data and store it."
//
// A truck's year, make and model, and the EPA's city and highway MPG for it,
// are looked up once and stored on the vehicle record as `epa`, so every
// screen that needs MPG reads it rather than asking. Two readers today and one
// planned: gas money for supply runs (js/gas-money.js), and the IRS rate vs
// actual cost verdict (js/fleet.js _vehSchedC), which can estimate fuel from
// miles before a year of gas receipts exists.
//
// Sources, both free, keyless and CORS-open, called straight from the phone:
//   - NHTSA vPIC decodes a VIN into year, make, model, drive and engine.
//   - fueleconomy.gov (the EPA's own data) gives the models for a year and
//     make, the engine options for a model, and each option's MPG.
// No VIN: the vehicle's name ("2013 Ford F150") is read for year, make and
// model, and the engine options for that model are all kept. When they
// disagree on MPG he picks his engine once; until then the middle one is used.
//
// A number he typed himself (mpgSource 'user', or a cityMpg already there
// before any lookup) always wins over the EPA's.
// The lookup re-runs only when the name or VIN changes (epa.key).

const _EPA_BASE='https://www.fueleconomy.gov/ws/rest/vehicle/';
const _VPIC_BASE='https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/';
const _EPA_MAKE_ALIAS={chevy:'chevrolet',vw:'volkswagen',mercedes:'mercedesbenz',benz:'mercedesbenz'};
// Words in an EPA model name that describe a body or drive, not a different
// truck: "F150 Pickup 4WD FFV" is still an F150, "F150 Raptor" is not.
const _EPA_GENERIC=new Set(['pickup','2wd','4wd','awd','fwd','rwd','ffv','cab','chassis','van','wagon','long','bed','crew','hd']);
// A name that skips the make ("2019 F-150", "Silverado 1500") still says
// which truck it is. The work trucks contractors actually drive:
const _EPA_MODEL_MAKE={f150:'Ford',f250:'Ford',f350:'Ford',ranger:'Ford',transit:'Ford',econoline:'Ford',
  e150:'Ford',e250:'Ford',e350:'Ford',expedition:'Ford',explorer:'Ford',maverick:'Ford',
  silverado:'Chevrolet',colorado:'Chevrolet',express:'Chevrolet',tahoe:'Chevrolet',suburban:'Chevrolet',
  sierra:'GMC',canyon:'GMC',savana:'GMC',yukon:'GMC',ram:'Ram',promaster:'Ram',
  tundra:'Toyota',tacoma:'Toyota',titan:'Nissan',frontier:'Nissan',nv200:'Nissan',ridgeline:'Honda',gladiator:'Jeep'};
const _epaBusy=new Set();

function _epaNorm(s){return String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');}
function _epaKey(v){return _epaNorm(v&&v.name)+'|'+_epaNorm(v&&v.vin);}
function _epaArr(x){return x==null?[]:Array.isArray(x)?x:[x];}

// "2013 Ford F150" -> {year:2013, make:'Ford', model:'F150'}. Null when the
// name has no model year in it: nothing to look up.
function epaParseName(name){
  const s=String(name||'').trim();
  const ym=s.match(/\b(19[89]\d|20\d\d)\b/);
  if(!ym)return null;
  const rest=s.replace(ym[0],' ').split(/\s+/).filter(Boolean);
  if(!rest.length)return null;
  const byModel=_EPA_MODEL_MAKE[_epaNorm(rest[0]).replace(/\d{2,4}$/,'')]||_EPA_MODEL_MAKE[_epaNorm(rest[0])];
  // "Ram 1500" names the make and the model at once.
  if(byModel&&_epaNorm(rest[0])!=='ram')return {year:+ym[1],make:byModel,model:rest.join(' ')};
  if(rest.length<2)return null;
  return {year:+ym[1],make:rest[0],model:rest.slice(1).join(' ')};
}

async function _epaGet(url){
  const ctl=typeof AbortController==='function'?new AbortController():null;
  const t=ctl?setTimeout(()=>ctl.abort(),8000):null;
  try{
    const r=await fetch(url,{headers:{Accept:'application/json'},signal:ctl?ctl.signal:undefined});
    if(!r.ok)return null;
    return await r.json();
  }catch(_e){return null;}
  finally{if(t)clearTimeout(t);}
}

async function _epaFromVin(vin){
  const d=await _epaGet(_VPIC_BASE+encodeURIComponent(vin)+'?format=json');
  const r=d&&_epaArr(d.Results)[0];
  if(!r||!r.ModelYear||!r.Make)return null;
  const drive=String(r.DriveType||'');
  return {year:+r.ModelYear,make:r.Make,model:r.Model||'',
    drive:/4x4|4wd|4-wheel/i.test(drive)?'4wd':/awd|all-wheel/i.test(drive)?'awd':/4x2|2wd|rwd|rear|fwd|front/i.test(drive)?'2wd':'',
    cyl:parseInt(r.EngineCylinders,10)||0,displ:parseFloat(r.DisplacementL)||0};
}

// The EPA models for this year and make that are the same vehicle as `model`:
// the name starts with it and anything after it is only body or drive words.
function epaMatchModels(list,model,drive){
  const want=_epaNorm(model);
  if(!want)return [];
  let starts=(list||[]).filter(t=>_epaNorm(t).startsWith(want));
  // "Silverado 1500" is "Silverado C15 2WD" in some years: fall back to the
  // model's first word rather than finding nothing.
  if(!starts.length){
    const first=_epaNorm(String(model).split(/\s+/)[0]);
    // The model's number must survive: "1500" may read "C15", but a
    // "Silverado 2500" must never borrow a 1500's MPG (heavy-duty pickups
    // carry no EPA rating at all, and finding nothing is the right answer).
    const num=(String(model).match(/\b(\d{3,4})\b/)||[])[1];
    const short=num&&num.length===4&&num.endsWith('00')?num.slice(0,2):'';
    // A light-duty name can also carry no number at all ("Silverado 2WD" is
    // the 2020 1500). A 2500 or 3500 never falls back: the EPA does not rate
    // heavy-duty pickups, and a borrowed 1500 figure would be wrong money.
    if(short&&+short>=25)return [];
    const bare=(t)=>!/\d/.test(String(t).replace(/\b[24]wd\b/ig,''));
    if(first&&first!==want)starts=(list||[]).filter(t=>_epaNorm(t).startsWith(first)&&
      (!num||bare(t)||_epaNorm(t).includes(num)||(short&&new RegExp('(^|[^0-9])'+short+'(?![0-9])').test(String(t)))));
  }
  let same=starts.filter(t=>{
    const extra=String(t).replace(/-/g,'').toLowerCase().split(/\s+/).filter(w=>w&&!want.includes(_epaNorm(w)));
    return extra.every(w=>_EPA_GENERIC.has(_epaNorm(w)));
  });
  if(!same.length)same=starts;
  if(drive){
    const d=same.filter(t=>drive==='2wd'?/\b(2wd|rwd|fwd)\b/i.test(t):new RegExp('\\b'+drive+'\\b','i').test(t));
    if(d.length)same=d;
  }
  return same;
}

// The full lookup. Returns the record that goes on the vehicle, or null when
// nothing could be found (offline, a name with no year, a make the EPA does
// not list). Network only; never writes.
async function epaLookup(v){
  if(!v)return null;
  const vin=String(v.vin||'').trim();
  let info=vin.length===17?await _epaFromVin(vin):null;
  const fromVin=!!info;
  if(!info)info=epaParseName(v.name);
  if(!info||!info.year||!info.make)return null;
  const makes=_epaArr((await _epaGet(_EPA_BASE+'menu/make?year='+info.year)||{}).menuItem).map(m=>m.value);
  const mk=_epaNorm(info.make);
  const make=makes.find(m=>_epaNorm(m)===(_EPA_MAKE_ALIAS[mk]||mk))||makes.find(m=>_epaNorm(m).startsWith(_EPA_MAKE_ALIAS[mk]||mk));
  if(!make)return null;
  const models=_epaArr((await _epaGet(_EPA_BASE+'menu/model?year='+info.year+'&make='+encodeURIComponent(make))||{}).menuItem).map(m=>m.value);
  const hit=epaMatchModels(models,info.model,info.drive).slice(0,6);
  if(!hit.length)return null;
  let opts=[];
  const lists=await Promise.all(hit.map(model=>_epaGet(_EPA_BASE+'menu/options?year='+info.year+'&make='+encodeURIComponent(make)+'&model='+encodeURIComponent(model))));
  lists.forEach((l,i)=>_epaArr((l||{}).menuItem).forEach(x=>opts.push({id:String(x.value),text:x.text,model:hit[i]})));
  // A decoded VIN names the engine; keep only the options that match it.
  if(info.cyl||info.displ){
    const e=opts.filter(o=>(!info.cyl||o.text.indexOf(info.cyl+' cyl')>=0)&&(!info.displ||o.text.indexOf(info.displ.toFixed(1)+' L')>=0));
    if(e.length)opts=e;
  }
  opts=opts.slice(0,12);
  const det=await Promise.all(opts.map(o=>_epaGet(_EPA_BASE+o.id)));
  opts.forEach((o,i)=>{const d=det[i];o.city=d?parseFloat(d.city08)||0:0;o.hwy=d?parseFloat(d.highway08)||0:0;});
  opts=opts.filter(o=>o.city>0);
  if(!opts.length)return null;
  const cities=[...new Set(opts.map(o=>o.city))].sort((a,b)=>a-b);
  return {key:_epaKey(v),at:new Date().toISOString(),year:info.year,make,model:info.model,
    source:fromVin?'vin':'name',options:opts,
    pick:cities.length===1?opts[0].id:null};
}

// The MPG the EPA says for this vehicle: his engine if he picked one, the
// only answer if there is one, else the middle of the range.
function epaCityMpg(v){
  const e=v&&v.epa;
  if(!e||!Array.isArray(e.options)||!e.options.length)return 0;
  const p=e.pick&&e.options.find(o=>o.id===e.pick);
  if(p)return p.city;
  const c=e.options.map(o=>o.city).filter(n=>n>0).sort((a,b)=>a-b);
  return c.length?c[Math.floor((c.length-1)/2)]:0;
}
function epaRange(v){
  const c=((v&&v.epa&&v.epa.options)||[]).map(o=>o.city).filter(n=>n>0);
  return c.length?{low:Math.min(...c),high:Math.max(...c)}:null;
}

// Look up and store, once per name/VIN. Resolves true when the vehicle
// changed. Safe to call on every open: it returns at once when the stored
// lookup is current, when one is already running, or when it already found
// nothing for this exact name (epa.none), so no screen hammers the API.
async function epaFillVehicle(v,opts){
  if(!v||v.id==null)return false;
  const key=_epaKey(v);
  if(!(opts&&opts.force)&&v.epa&&v.epa.key===key)return false;
  if(_epaBusy.has(String(v.id)))return false;
  _epaBusy.add(String(v.id));
  try{
    const res=await epaLookup(v);
    // The array may have been replaced by a sync while we waited: write to
    // the vehicle that is there NOW, and only if it is still the same truck.
    const cur=((typeof getVehicles==='function'?getVehicles():[])||[]).find(x=>String(x.id)===String(v.id));
    if(!cur||_epaKey(cur)!==key)return false;
    cur.epa=res||{key,at:new Date().toISOString(),none:true};
    // His number wins: one he typed, or one already on the truck from before
    // this lookup existed (a cityMpg with no source).
    if(res&&(cur.mpgSource==='epa'||!(parseFloat(cur.cityMpg)>0))){
      cur.cityMpg=epaCityMpg(cur);
      cur.mpgSource='epa';
    }else if(!res&&cur.mpgSource==='epa'){
      // Renamed to a truck the EPA has nothing for: the old truck's figure
      // must not keep standing in for this one.
      cur.cityMpg=0;
    }
    if(typeof saveAll==='function')saveAll();
    return true;
  }finally{_epaBusy.delete(String(v.id));}
}
// He picked his engine from the EPA list.
function epaPick(vehId,optId){
  const v=((typeof getVehicles==='function'?getVehicles():[])||[]).find(x=>String(x.id)===String(vehId));
  if(!v||!v.epa||!Array.isArray(v.epa.options))return;
  const o=v.epa.options.find(x=>x.id===String(optId));
  if(!o)return;
  v.epa.pick=o.id;
  v.cityMpg=o.city;
  v.mpgSource='epa';
  if(typeof saveAll==='function')saveAll();
}
