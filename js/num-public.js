// Number-only fields (owner 2026-10-01: a phone or zip box never takes a
// letter). The customer pages (client.html, intake.html) do not load js/utils.js,
// so this is the small part of its data-num listener they need, phone and
// zip, in one file both load rather than a copy in each.
document.addEventListener('input',function(e){
  var el=e.target;if(!el||!el.getAttribute||e.isComposing)return;
  var k=el.getAttribute('data-num');if(k!=='phone'&&k!=='zip')return;
  var d=String(el.value||'').replace(/\D/g,'');
  if(k==='zip')d=d.slice(0,5);
  else{
    if(d.length===11&&d[0]==='1')d=d.slice(1); // "+1 (316) 555-0101" from autofill
    d=d.slice(0,10);
    if(d.length>=7)d=d.slice(0,3)+'-'+d.slice(3,6)+'-'+d.slice(6);
    else if(d.length>=4)d=d.slice(0,3)+'-'+d.slice(3);
  }
  if(d!==el.value)el.value=d;
},true);
