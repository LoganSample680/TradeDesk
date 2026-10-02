// ── Gas money for supply runs (Jack, 2026-10-02) ────────────────────────────
// "He wants the ability in mileage to pick out supply house runs only on
// certain days for gas reimbursement." Owner, on the rate: "IRS rate is too
// much, dad wants just gas money so city MPG rate by mileage would be sweet,
// drive there and back counts, IRS rate would be a nice option."
//
// So: every logged drive INTO or OUT OF a saved supply house (a td_places row
// of kind 'supply') is a supply run, the drive back included. He ticks the
// days he wants paid for, and the total is miles / city MPG * gas price, or
// miles * the IRS rate when he flips the switch.
//
// This is a calculator over the log, not a new pot of money: it writes no
// mileage rows and changes no deduction. What it keeps is the gas price
// (S.gasPrice), the switch (S.gasMode) and each truck's city MPG
// (vehicle.cityMpg), so the next time he opens it the numbers are his.
//
// Same leg rules as every other total on the Mileage screen: a drive with an
// end nobody saved (addressUnknown) and a drive answered "personal" never
// count. A held run still waiting on its receipt DOES count: the receipt
// question is about the tax deduction, and the gas was burned either way.

let _gmSel=new Set();

function _gmNorm(s){return String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');}
function _gmStores(){
  return (typeof places!=='undefined'&&Array.isArray(places)?places:[])
    .filter(p=>p&&p.kind==='supply'&&p.name);
}
// Which store, if any, is at this end of the drive. Name first (the deriver
// writes the place's own name on the end it resolved), then the pin, inside
// the store's fence or the shared 600ft one, whichever is bigger: a parking
// fix at the far end of a Menards lot is still Menards.
function _gmStoreAt(m,end,stores){
  if(!m)return null;
  const names=end==='to'?[m.to_name,m.supplyRunName]:[m.from_name];
  for(const n of names){
    const k=_gmNorm(n);
    if(!k)continue;
    const hit=stores.find(s=>_gmNorm(s.name)===k);
    if(hit)return hit;
  }
  const c=end==='to'?m.toCoord:m.fromCoord;
  if(!c||c.lat==null||typeof _haversineMiles!=='function')return null;
  let best=null,bestFt=Infinity;
  stores.forEach(s=>{
    if(s.lat==null||s.lon==null)return;
    const ft=_haversineMiles({lat:c.lat,lng:c.lng!=null?c.lng:c.lon},{lat:s.lat,lng:s.lon})*5280;
    if(ft<=Math.max(s.fenceFt||0,600)&&ft<bestFt){best=s;bestFt=ft;}
  });
  return best;
}
// Every supply-run leg in the list, each with the store it touches.
function gasMoneyTrips(list){
  const stores=_gmStores();
  if(!stores.length)return [];
  return (list||[]).filter(m=>m&&m.date&&!m.addressUnknown&&!m.personal&&(m.miles||0)>0)
    .map(m=>{
      const store=_gmStoreAt(m,'to',stores)||_gmStoreAt(m,'from',stores);
      return store?{m,store}:null;
    }).filter(Boolean);
}
function _gmVehFor(m){
  const vs=(typeof getVehicles==='function'?getVehicles():[])||[];
  const v=(typeof _vehLinkMatches==='function')?vs.find(x=>_vehLinkMatches(m,x,'vehicle')):null;
  // A drive nobody tagged a truck on still burned gas in one; the first
  // active truck is the honest guess for a one-truck shop.
  return v||vs.find(x=>(x.status||'active')==='active')||null;
}
function _gmMpg(v){const n=parseFloat(v&&v.cityMpg);return n>0?n:0;}
function _gmPrice(){const n=parseFloat(S&&S.gasPrice);return n>0?n:0;}
function _gmMode(){return (S&&S.gasMode)==='irs'?'irs':'gas';}
// Money for one leg, or null when the gas math is missing a number.
function _gmLegCost(m,mode){
  const mi=m.miles||0;
  if(mode==='irs')return mi*IRS(m.date);
  const mpg=_gmMpg(_gmVehFor(m)),price=_gmPrice();
  if(!mpg||!price)return null;
  return mi/mpg*price;
}
function gasMoneyDays(list){
  const by={};
  gasMoneyTrips(list).forEach(t=>{
    const d=t.m.date;
    const day=by[d]=by[d]||{date:d,legs:[],stores:[],miles:0};
    day.legs.push(t.m);day.miles+=t.m.miles||0;
    if(day.stores.indexOf(t.store.name)<0)day.stores.push(t.store.name);
  });
  return Object.keys(by).sort().reverse().map(k=>by[k]);
}
// The totals for the ticked days. cost is null when gas mode is missing the
// price or an MPG, so the screen asks for the number instead of saying $0.
function gasMoneyTotal(days,sel,mode){
  let miles=0,cost=0,gallons=0,missing=false,n=0;
  (days||[]).forEach(d=>{
    if(!sel.has(d.date))return;
    n++;
    d.legs.forEach(m=>{
      miles+=m.miles||0;
      const c=_gmLegCost(m,mode);
      if(c==null)missing=true;else cost+=c;
      const mpg=_gmMpg(_gmVehFor(m));
      if(mpg)gallons+=(m.miles||0)/mpg;
    });
  });
  return {days:n,miles,gallons,cost:missing?null:cost};
}

function _gmSource(){
  const yr=String(typeof trackerYear!=='undefined'&&trackerYear||new Date().getFullYear());
  const own=(typeof _ownerUI==='function'&&!_ownerUI())
    ?mileage.filter(m=>!m.logged_by_id||m.logged_by_id===_supaUser?.id):mileage;
  // The Books year picker can read "All years": then every day is listed.
  return own.filter(m=>m&&m.date&&(yr==='all'||m.date.startsWith(yr)));
}
function _gmDayLabel(d){
  const p=String(d).split('-').map(Number);
  if(p.length!==3||!p[0])return String(d);
  return new Date(p[0],p[1]-1,p[2]).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
}

function openGasMoney(){
  document.getElementById('gm-ov')?.remove();
  _gmSel=new Set();
  const ov=document.createElement('div');ov.className='zmodal-overlay';ov.id='gm-ov';
  ov.onclick=e=>{if(e.target===ov)ov.remove();};
  const box=document.createElement('div');box.className='zmodal';box.id='gm-box';
  box.style.maxWidth='420px';
  ov.appendChild(box);document.body.appendChild(ov);
  _gmRender();
  _gmEpaFetch();
}

function _gmRender(){
  const box=document.getElementById('gm-box');
  if(!box)return;
  const days=gasMoneyDays(_gmSource());
  const mode=_gmMode();
  const stores=_gmStores().map(s=>s.name);
  const vehs=[];
  days.forEach(d=>d.legs.forEach(m=>{const v=_gmVehFor(m);if(v&&vehs.indexOf(v)<0)vehs.push(v);}));
  const _ty=String(typeof trackerYear!=='undefined'&&trackerYear||'');
  const irsNow=IRS(/^\d{4}$/.test(_ty)?_ty:String(new Date().getFullYear()));
  const seg=(val,label)=>'<button type="button" id="gm-mode-'+val+'" class="fb'+(mode===val?' active':'')+'" onclick="_gmSetMode(\''+val+'\')" style="flex:1">'+label+'</button>';
  const numIn=(id,val,ph,on)=>'<input id="'+id+'" type="text" data-num="dec" inputmode="decimal" value="'+(val?escHtml(String(val)):'')+'" placeholder="'+ph+'" onchange="'+on+'" style="width:84px;font-size:16px;padding:8px 10px;text-align:right;font-variant-numeric:tabular-nums">';

  let html=
    '<div style="font-size:17px;font-weight:800;margin-bottom:4px">Gas money</div>'+
    '<div style="font-size:12px;color:var(--text2);line-height:1.5;margin-bottom:12px">Supply runs'+(stores.length?' to '+escHtml(stores.join(', ')):'')+', there and back. Tick the days to pay for.</div>'+
    '<div class="fbar" style="display:flex;gap:6px;margin-bottom:10px">'+seg('gas','Gas only')+seg('irs','IRS $'+irsNow.toFixed(3)+'/mi')+'</div>';
  if(mode==='gas'){
    html+='<div id="gm-gas-fields" style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px">'+
      '<label style="display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:13px;font-weight:600">Gas price, $ a gallon'+numIn('gm-price',_gmPrice()||'','3.09','_gmSetPrice(this.value)')+'</label>'+
      _gmVehs(vehs).map(v=>
        '<div class="gm-veh">'+
        '<label style="display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:13px;font-weight:600"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml(getVehicleLabel(v)||'Truck')+', city MPG</span>'+
        numIn('gm-mpg-'+String(v.id).replace(/[^A-Za-z0-9_-]/g,''),_gmMpg(v)||'','15','_gmSetMpg(\''+String(v.id).replace(/[^A-Za-z0-9_.-]/g,'')+'\',this.value)')+'</label>'+
        _gmEpaLine(v)+'</div>').join('')+
    '</div>';
  }
  if(!stores.length){
    html+='<div id="gm-empty" style="font-size:13px;color:var(--text2);line-height:1.5;padding:12px 0">No supply houses saved yet. Save a store as a supply house from its pin on the map and its runs show up here.</div>';
  }else if(!days.length){
    html+='<div id="gm-empty" style="font-size:13px;color:var(--text2);line-height:1.5;padding:12px 0">No drives to a supply house logged this year yet.</div>';
  }else{
    html+='<div style="display:flex;justify-content:flex-end;gap:12px;margin-bottom:4px">'+
      '<button type="button" id="gm-all" onclick="_gmAll(true)" style="background:none;border:0;color:var(--denim);font-size:13px;font-weight:700;padding:6px 0;cursor:pointer">All</button>'+
      '<button type="button" id="gm-none" onclick="_gmAll(false)" style="background:none;border:0;color:var(--denim);font-size:13px;font-weight:700;padding:6px 0;cursor:pointer">None</button></div>'+
      '<div id="gm-days" style="max-height:42vh;overflow-y:auto;border-top:1px solid var(--border);margin-bottom:12px">'+
      days.map(d=>{
        const c=d.legs.reduce((s,m)=>{const x=_gmLegCost(m,mode);return s==null||x==null?null:s+x;},0);
        return '<label class="gm-day" data-day="'+escHtml(d.date)+'" style="display:flex;align-items:center;gap:10px;padding:10px 2px;border-bottom:1px solid var(--border);cursor:pointer">'+
          '<input type="checkbox" '+(_gmSel.has(d.date)?'checked ':'')+'onchange="_gmTog(\''+String(d.date).replace(/[^0-9-]/g,'')+'\',this.checked)" style="width:20px;height:20px;flex-shrink:0">'+
          '<div style="flex:1;min-width:0">'+
            '<div style="font-size:13px;font-weight:700">'+escHtml(_gmDayLabel(d.date))+'</div>'+
            '<div style="font-size:11px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml(d.stores.join(', '))+' · '+d.legs.length+' drive'+(d.legs.length===1?'':'s')+' · '+d.miles.toFixed(1)+' mi</div>'+
          '</div>'+
          '<div style="font-size:13px;font-weight:700;font-variant-numeric:tabular-nums">'+(c==null?'':fmt(c))+'</div>'+
        '</label>';
      }).join('')+'</div>';
  }
  const t=gasMoneyTotal(days,_gmSel,mode);
  const need=mode==='gas'&&t.cost==null;
  html+='<div id="gm-total" style="background:var(--bg2);border-radius:var(--r);padding:12px 14px;margin-bottom:12px">'+
      '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px">'+
        '<div style="font-size:12px;color:var(--text2)">'+t.days+' day'+(t.days===1?'':'s')+' · '+t.miles.toFixed(1)+' mi'+(mode==='gas'&&t.gallons?' · '+t.gallons.toFixed(1)+' gal':'')+'</div>'+
        '<div id="gm-total-amt" style="font-size:20px;font-weight:800;font-variant-numeric:tabular-nums">'+(need?'':fmt(t.cost||0))+'</div>'+
      '</div>'+
      (need&&t.days?'<div id="gm-need" style="font-size:12px;color:#92400E;margin-top:4px">Enter the gas price and city MPG to see the total.</div>':'')+
    '</div>'+
    '<div style="display:flex;gap:8px">'+
      '<button type="button" class="btn" onclick="this.closest(\'.zmodal-overlay\').remove()" style="flex:1;min-height:44px">Done</button>'+
      '<button type="button" id="gm-share" class="btn btn-p" onclick="_gmShare()" style="flex:1;min-height:44px"'+(!t.days||need?' disabled':'')+'>Send</button>'+
    '</div>';
  // Keep the day list where he scrolled it: a tick re-renders the sheet.
  const prev=document.getElementById('gm-days');
  const top=prev?prev.scrollTop:0;
  box.innerHTML=html;
  const nx=document.getElementById('gm-days');
  if(nx&&top)nx.scrollTop=top;
}

function _gmVehs(vehs){
  return vehs.length?vehs:((typeof getVehicles==='function'?getVehicles():[])||[]).filter(x=>(x.status||'active')==='active').slice(0,1);
}
// What the EPA says about this truck (js/vehicle-epa.js), under its MPG box.
// Looking it up: a shimmer. Several engines on file and he has not picked:
// a one-time "which engine" list. His own typed number stays and the EPA's
// is shown beside it.
function _gmEpaLine(v){
  const sid=String(v.id).replace(/[^A-Za-z0-9_.-]/g,'');
  const st='font-size:11px;color:var(--text3);line-height:1.45;margin-top:4px';
  if(typeof _epaBusy!=='undefined'&&_epaBusy.has(String(v.id)))
    return '<div class="gm-epa" style="margin-top:6px"><div class="td-skel" style="height:12px;width:70%"></div></div>';
  const e=v.epa;
  if(!e)return '';
  if(e.none)return '<div class="gm-epa" style="'+st+'">No EPA rating found for this truck. Heavy-duty pickups (2500 and up) are not rated by the EPA. Type the MPG.</div>';
  const opts=Array.isArray(e.options)?e.options:[];
  const cities=[...new Set(opts.map(o=>o.city))];
  const r=typeof epaRange==='function'?epaRange(v):null;
  const label=(o)=>{
    const drv=(o.model.match(/\b(2WD|4WD|AWD|FWD|RWD)\b/i)||[''])[0];
    return (drv?drv+' · ':'')+o.text.replace(/^Auto(matic)?\s*(\([^)]*\)|[0-9]+-spd)?,\s*/i,'')+' · '+o.city+' city';
  };
  const what=escHtml(e.year+' '+e.make+' '+e.model);
  const mine=v.mpgSource==='user'&&_gmMpg(v)?' You typed '+_gmMpg(v)+'.':'';
  if(cities.length>1){
    return '<div class="gm-epa" style="'+st+'">EPA, '+what+': '+r.low+' to '+r.high+' city depending on the engine.'+mine+'</div>'+
      '<select id="gm-epa-'+sid+'" onchange="_gmEpaPick(\''+sid+'\',this.value)" style="width:100%;font-size:14px;padding:8px 10px;margin-top:6px">'+
        (e.pick?'':'<option value="">Pick your engine (using '+(typeof epaCityMpg==='function'?epaCityMpg(v):'')+')</option>')+
        // Two gearboxes on the same engine read the same once the gearbox is
        // dropped from the label: list each engine once, keeping his pick.
        (()=>{const seen=new Set();return opts.filter(o=>{const k=label(o);if(seen.has(k)&&e.pick!==o.id)return false;seen.add(k);return true;});})()
          .map(o=>'<option value="'+escHtml(o.id)+'"'+(e.pick===o.id?' selected':'')+'>'+escHtml(label(o))+'</option>').join('')+
      '</select>';
  }
  return '<div class="gm-epa" style="'+st+'">EPA, '+what+': '+opts[0].city+' city, '+opts[0].hwy+' highway.'+mine+'</div>';
}
function _gmEpaPick(id,optId){
  if(!optId||typeof epaPick!=='function')return;
  epaPick(id,optId);
  _gmRender();
}
// Fill in each truck's EPA data the first time the sheet sees it.
function _gmEpaFetch(){
  if(typeof epaFillVehicle!=='function')return;
  ((typeof getVehicles==='function'?getVehicles():[])||[]).filter(x=>x&&(x.status||'active')==='active')
    .forEach(v=>{
      const p=epaFillVehicle(v);
      if(typeof _epaBusy!=='undefined'&&_epaBusy.has(String(v.id)))_gmRender();
      p.then(ch=>{if(ch&&document.getElementById('gm-box'))_gmRender();}).catch(()=>{});
    });
}

function _gmTog(d,on){if(on)_gmSel.add(d);else _gmSel.delete(d);_gmRender();}
function _gmAll(on){
  _gmSel=new Set(on?gasMoneyDays(_gmSource()).map(d=>d.date):[]);
  _gmRender();
}
function _gmSetMode(m){S.gasMode=m==='irs'?'irs':'gas';saveAll();_gmRender();}
function _gmSetPrice(v){
  const n=parseFloat(String(v).replace(/[^0-9.]/g,''));
  S.gasPrice=n>0?Math.round(n*1000)/1000:0;
  saveAll();_gmRender();
}
function _gmSetMpg(id,v){
  const veh=((typeof getVehicles==='function'?getVehicles():[])||[]).find(x=>String(x.id)===String(id));
  if(!veh)return;
  const n=parseFloat(String(v).replace(/[^0-9.]/g,''));
  // A typed number is his and the EPA never overwrites it. Clearing the box
  // hands the MPG back to the EPA.
  if(n>0){veh.cityMpg=Math.round(n*10)/10;veh.mpgSource='user';}
  else{veh.mpgSource='epa';veh.cityMpg=typeof epaCityMpg==='function'?epaCityMpg(veh):0;}
  saveAll();_gmRender();
}
// The text that goes to whoever is paying: each day, then the math.
function gasMoneyText(days,sel,mode){
  const picked=(days||[]).filter(d=>sel.has(d.date)).slice().reverse();
  const t=gasMoneyTotal(days,sel,mode);
  const lines=['Supply run '+(mode==='irs'?'mileage':'gas money')];
  picked.forEach(d=>lines.push(_gmDayLabel(d.date)+': '+d.stores.join(', ')+', '+d.miles.toFixed(1)+' mi'));
  if(mode==='irs'){
    lines.push('Total: '+t.miles.toFixed(1)+' mi at the IRS rate = '+fmt(t.cost||0));
  }else{
    lines.push('Total: '+t.miles.toFixed(1)+' mi, '+t.gallons.toFixed(1)+' gal at $'+_gmPrice().toFixed(2)+' = '+fmt(t.cost||0));
  }
  return lines.join('\n');
}
async function _gmShare(){
  const text=gasMoneyText(gasMoneyDays(_gmSource()),_gmSel,_gmMode());
  try{
    if(navigator.share){await navigator.share({title:'Gas money',text});return;}
  }catch(e){if(e&&e.name==='AbortError')return;}
  try{await navigator.clipboard.writeText(text);if(typeof showToast==='function')showToast('Copied');}catch(_e){}
}
