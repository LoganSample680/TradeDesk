// ════════════════════════════════════════════════════════════════
// TradeDesk Diagnostic v3.2 — paste into browser console
// ════════════════════════════════════════════════════════════════
(async function(){
  const R=[];let pass=0,warn=0,fail=0;
  const ok=(m)=>{R.push('  ✓ '+m);pass++;};
  const wn=(m)=>{R.push('  ⚠ '+m);warn++;};
  const er=(m)=>{R.push('  ✗ '+m);fail++;};
  const hd=(m)=>{R.push('\n── '+m+' ──────────────────────');};
  function g(n){try{return eval(n);}catch(e){return undefined;}}
  function has(n){try{const v=eval(n);return v!==undefined&&v!==null;}catch(e){return false;}}

  hd('Core globals');
  ['clients','bids','jobs','estSurfaces','roomScopeMap','_swColors',
   'SW_PRODUCTS','SW_FAMILIES','SCOPE_ITEMS','SURF_TYPES']
    .forEach(k=>has(k)?ok(k):er(k+' MISSING'));

  hd('SW Color catalog');
  try{
    const colors=await swLoadColors();
    colors?.length>=1500?ok(colors.length+' colors'):er('Only '+(colors?.length||0)+' colors');
    const fams={};colors.forEach(c=>{fams[c.family]=(fams[c.family]||0)+1;});
    (fams.black||0)>=10?ok('Black family: '+fams.black):er('Black family only '+(fams.black||0));
    ['white','gray','beige','brown','blue','green','teal','orange','red','pink','purple','yellow','black']
      .filter(f=>!fams[f]).length===0?ok('All 13 families present'):er('Missing families');
    colors.find(c=>c.name==='Repose Gray')?ok('Repose Gray found'):er('Repose Gray missing');
    colors.find(c=>c.name==='Tricorn Black')?.family==='black'?ok('Tricorn Black=black'):er('Tricorn Black family wrong');
  }catch(e){er('swLoadColors: '+e.message);}

  hd('SW Products');
  const SP=g('SW_PRODUCTS')||{};
  const allP=Object.values(SP).flat();
  allP.length>=20?ok(allP.length+' products'):er('Only '+allP.length);
  ['interior','ceiling','exterior','trim'].forEach(c=>SP[c]?.length>=2?ok(c+': '+SP[c].length):er(c+' missing'));
  const pm=allP.find(p=>p.id==='pm200');
  pm?.cov>=300?ok('ProMar 200 cov:'+pm.cov):er('ProMar 200 missing cov');
  allP.find(p=>p.id==='emure')?ok('Emerald Urethane present'):er('Emerald Urethane MISSING');

  hd('Scope items');
  const SI=g('SCOPE_ITEMS')||[];
  SI.length>=10?ok(SI.length+' items'):er('Only '+SI.length);
  SI.find(s=>s.id==='sand')?.ratePerSqFt>=0?ok('Sand ratePerSqFt ok'):er('Sand missing ratePerSqFt');
  SI.every(s=>s.hint&&s.icon&&s.clientDesc)?ok('All items have hint/icon/clientDesc'):er('Some items incomplete');

  hd('Estimate DOM — step A/B/product');
  ['surf-room-name','surf-room-sqft','surf-step-a','surf-step-b',
   'surf-scope-first','surf-measure-color-wrap','surf-scope-first-grid',
   'surf-paint-supply-wrap','paint-sup-zach','paint-sup-cust','paint-supply-note',
   'e-customer-paint','e-paint',
   'sw-product-wrap','sw-color-wrap',
   'sw-product-grid','sw-selected-product','sw-product-grid-hdr',
   'sw-state-family','sw-state-swatches','sw-family-grid','sw-swatch-grid',
   'sw-search-input','sw-selected-pill','sw-selected-hex','sw-selected-finish',
   'sw-accent-wrap','sw-accent-search','sw-accent-note','sw-accent-dropdown']
    .forEach(id=>document.getElementById(id)?ok('#'+id):er('#'+id+' MISSING'));

  hd('Functions');
  ['swLoadColors','swInitFamilyGrid','swShowFamily','swBackToFamilies','swSearch',
   'swSelectColor','swOpenFullscreenColor','swSelectFinish','swRenderProductGrid',
   'swSelectProduct','swShowProductInfo','swResetProduct','swGetProductName',
   'swAccentSearch','swAccentSelect','swClearAccent','swHideAccentDropdown',
   'setPaintSupply','goSurfStepB','goSurfScopeToMeasure','renderSurfBCurrent',
   'saveSurfBAndNext','finishRoom','showRoomSavedState','editRoomSurfs','addAnotherRoom',
   'buildScopeGrid','toggleScopeRoom','calcEst','renderEstReview','renderEstRunning',
   'buildProposal','validateAndGoStep5','saveAndExitEstimate',
   'showJobDebrief','saveDebriefAndComplete','confirmMarkComplete',
   'showSupplyList','supplyCheckAll','supplyUncheckAll',
   'openJobSheet','openMapsForClient','renderJobsPage','swRefreshPrices']
    .forEach(fn=>typeof window[fn]==='function'?ok('fn:'+fn):er('fn:'+fn+' MISSING'));

  hd('Customer paint flow');
  // Test setPaintSupply sets hidden fields correctly
  try{
    setPaintSupply('customer');
    const cpv=document.getElementById('e-customer-paint')?.value;
    const pv=document.getElementById('e-paint')?.value;
    cpv==='1'?ok('e-customer-paint=1 when customer'):er('e-customer-paint not set: '+cpv);
    pv==='customer'?ok('e-paint=customer when customer'):er('e-paint not set: '+pv);
    const note=document.getElementById('paint-supply-note');
    note?.style.display!=='none'?ok('warranty note shown'):er('warranty note hidden');
    const zBtn=document.getElementById('paint-sup-zach');
    const cBtn=document.getElementById('paint-sup-cust');
    zBtn?.style.borderColor.includes('border2')||zBtn?.style.borderColor===''?ok('Zach btn unselected'):wn('Zach btn style: '+zBtn?.style.borderColor);
    // Check product/color wrappers would hide
    const pw=document.getElementById('sw-product-wrap');
    const cw=document.getElementById('sw-color-wrap');
    pw?ok('sw-product-wrap exists'):er('sw-product-wrap MISSING');
    cw?ok('sw-color-wrap exists'):er('sw-color-wrap MISSING');
    // Reset to Zach supplies
    setPaintSupply('zach');
    const cpv2=document.getElementById('e-customer-paint')?.value;
    cpv2===''?ok('e-customer-paint cleared on reset'):er('e-customer-paint not cleared: '+cpv2);
  }catch(e){er('setPaintSupply test: '+e.message);}

  hd('calcEst — customer paint math');
  try{
    const _s=g('estSurfaces');const _r=JSON.parse(JSON.stringify(g('roomScopeMap')||{}));
    estSurfaces=[{id:1,type:'walls',qty:280,room:'LR — ProMar 200 · Repose Gray (SW 7015) [Eggshell]'}];
    roomScopeMap={};
    // Zach supplies paint — should have mat cost
    setPaintSupply('zach');
    const r1=calcEst();
    r1.matTotal>0?ok('matTotal>0 when Zach supplies: '+r1.matTotal.toFixed(0)):er('matTotal is 0 when Zach supplies');
    r1.customerPaint===false?ok('customerPaint=false when Zach supplies'):er('customerPaint wrong: '+r1.customerPaint);
    // Customer supplies paint — mat should be near 0
    setPaintSupply('customer');
    const r2=calcEst();
    r2.customerPaint===true?ok('customerPaint=true when customer supplies'):er('customerPaint wrong: '+r2.customerPaint);
    r2.matTotal<10?ok('matTotal near $0 when customer supplies: $'+r2.matTotal.toFixed(2)):er('matTotal not zeroed when customer: $'+r2.matTotal.toFixed(2));
    r2.final<r1.final?ok('Final bid lower when customer supplies ($'+r2.final+' vs $'+r1.final+')'):er('Final not lower when customer supplies');
    setPaintSupply('zach');
    estSurfaces=_s;roomScopeMap=_r;
  }catch(e){er('customer paint math: '+e.message);}

  hd('calcEst — paint lines + coats');
  try{
    const _s=g('estSurfaces');const _r=JSON.parse(JSON.stringify(g('roomScopeMap')||{}));
    estSurfaces=[
      {id:1,type:'walls',qty:280,room:'TR — ProMar 200 · Accessible Beige (SW 7036) [Eggshell]'},
      {id:2,type:'ceiling',qty:200,room:'TR — Eminence Ceiling · Pure White (SW 7005) [Flat]'},
    ];
    roomScopeMap={};setPaintSupply('zach');
    const r=calcEst();
    r.paintLines?.length>=1?ok('paintLines: '+r.paintLines.length):er('paintLines empty');
    r.paintLines?.every(pl=>pl.wholeCans>=1)?ok('wholeCans present'):er('wholeCans missing');
    r.paintLines?.every(pl=>pl.cov>=300)?ok('cov rates present'):er('cov missing');
    r.coats>=1?ok('coats='+r.coats):er('coats not returned');
    r.paintLines?.find(pl=>pl.spec?.includes('ProMar 200'))?.cov===350?ok('ProMar 200=350 sf/gal'):wn('ProMar 200 cov unexpected');
    estSurfaces=_s;roomScopeMap=_r;
  }catch(e){er('calcEst paint: '+e.message);}

  hd('Scope auto-pricing');
  try{
    const _s=g('estSurfaces');const _r=JSON.parse(JSON.stringify(g('roomScopeMap')||{}));
    estSurfaces=[{id:1,type:'walls',qty:300,room:'T — ProMar 200 · Agreeable Gray (SW 7029) [Eggshell]'}];
    roomScopeMap={'T':{sand:{active:true},spackle:{active:true}}};
    const r=calcEst();
    r.lines?.find(l=>l.label==='Sanding')?.sub>0?ok('Sanding priced: $'+r.lines.find(l=>l.label==='Sanding').sub):er('Sanding not priced');
    r.lines?.find(l=>l.label==='Spackle & patch')?.sub>0?ok('Spackle priced: $'+r.lines.find(l=>l.label==='Spackle & patch').sub):er('Spackle not priced');
    estSurfaces=_s;roomScopeMap=_r;
  }catch(e){er('Scope pricing: '+e.message);}

  hd('Save & exit');
  [...document.querySelectorAll('#est-s5 button')].some(b=>b.textContent.includes('Save bid'))?ok('"Save bid & exit" in step 5'):er('"Save bid & exit" MISSING step 5');
  [...document.querySelectorAll('#est-s6 button')].some(b=>b.textContent.includes('Not signing'))?ok('"Not signing now" in step 6'):er('"Not signing now" MISSING step 6');

  hd('Supply list');
  try{
    const mb={id:99998,client_id:null,
      surfaces:[
        {id:1,type:'walls',qty:280,room:'LR — ProMar 200 · Accessible Beige (SW 7036) [Eggshell]'},
        {id:2,type:'ceiling',qty:200,room:'LR — Eminence Ceiling · Pure White (SW 7005) [Flat]'},
      ],
      roomScopeMap:{'LR':{sand:{active:true},spackle:{active:true},caulk:{active:true}}},
    };
    bids.push(mb);showSupplyList(99998);
    const modal=document.querySelector('.zmodal-overlay');
    if(modal){
      const checks=modal.querySelectorAll('.supply-check');
      checks.length>=10?ok(checks.length+' checkable items'):wn('Only '+checks.length+' items');
      ['Paint','Prep','Tools'].forEach(s=>modal.innerHTML.includes(s)?ok(s+' section'):er(s+' section MISSING'));
      modal.innerHTML.includes('gal')?ok('Gallon quantities'):er('No gallons');
      supplyCheckAll();
      [...modal.querySelectorAll('.supply-check')].every(c=>c.checked)?ok('Check all works'):er('Check all failed');
      supplyUncheckAll();
      [...modal.querySelectorAll('.supply-check')].every(c=>!c.checked)?ok('Uncheck all works'):er('Uncheck all failed');
      modal.remove();
    }else{er('Supply list modal did not render');}
    bids=bids.filter(b=>b.id!==99998);
  }catch(e){er('showSupplyList: '+e.message);bids=bids.filter(b=>b.id!==99998);}

  hd('Job sheet');
  typeof openJobSheet==='function'?ok('openJobSheet exists'):er('openJobSheet MISSING');
  typeof openMapsForClient==='function'?ok('openMapsForClient exists'):er('openMapsForClient MISSING');

  hd('Proposal — no paint order section');
  try{
    const _s=g('estSurfaces');
    estSurfaces=[{id:1,type:'walls',qty:280,room:'LR — ProMar 200 · Accessible Beige (SW 7036) [Eggshell]'}];
    setPaintSupply('zach');
    buildProposal();
    const prop=document.getElementById('est-proposal');
    !prop?.innerHTML?.includes('Paint Order Summary')?ok('Proposal has NO Paint Order Summary (correct)'):er('Proposal still has Paint Order Summary');
    prop?.innerHTML?.includes('Terms &amp; Conditions')?ok('Proposal has Terms & Conditions'):er('Terms & Conditions missing from proposal');
    prop?.innerHTML?.includes('Client Acceptance')?ok('Proposal has Client Acceptance'):er('Client Acceptance missing');
    estSurfaces=_s;
  }catch(e){er('buildProposal: '+e.message);}

  hd('Scope-first flow');
  document.getElementById('surf-scope-first')?.style.display==='none'?ok('surf-scope-first hidden by default'):wn('surf-scope-first display unexpected');
  typeof goSurfScopeToMeasure==='function'?ok('goSurfScopeToMeasure exists'):er('MISSING');
  typeof setPaintSupply==='function'?ok('setPaintSupply exists'):er('setPaintSupply MISSING');

  R.push('\n════════════════════════════════════════');
  R.push('  '+pass+' passed  '+(warn?warn+' warnings  ':'')+fail+' failed');
  if(!fail&&!warn)R.push('  🟢 All clear');
  else if(!fail)R.push('  🟡 Passing with warnings');
  else R.push('  🔴 '+fail+' failure'+(fail!==1?'s':'')+' to fix');
  R.push('════════════════════════════════════════');
  console.log('%cTradeDesk Diagnostic v3.2','font-size:16px;font-weight:bold;color:#185FA5');
  console.log(R.join('\n'));
  return{pass,warn,fail};
})();
