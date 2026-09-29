// js/doc-steps.js: ONE SET OF STEPS FOR EVERY DOCUMENT.
//
// Owner 2026-09-29: "all the proposals, invoices all need the shared code so
// we're updating one spot. We get the work as step one with talk to Tim and
// photos if we got them, step 2 is time, step 3 is materials, then review
// customer copy and send."
//
// The T&M proposal, the Build Your Own proposal and the invoice all draw their
// numbered headings here, with the names here. Change a name or the look of a
// step once and every document follows. Nothing in this file knows about one
// document; each screen decides which steps it has and what state they are in.
const DOC_STEP={work:'The work',time:'Time',materials:'Materials',review:'Review'};
const DOC_TICK='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
// state: 'now' (the one to do), 'done' (a tick), 'todo'. status: a few words
// on the right, or nothing.
function docStepInner(n,title,state,status){
  return '<span class="n">'+(state==='done'?DOC_TICK:n)+'</span>'+
    '<span class="t">'+escHtml(String(title||''))+'</span>'+(status?'<span class="s">'+escHtml(String(status))+'</span>':'');
}
function docStepHead(id,n,title,state,status){
  const el=document.getElementById(id);if(!el)return null;
  el.setAttribute('data-state',state||'todo');
  el.innerHTML=docStepInner(n,title,state,status);
  return el;
}
function docStepHtml(n,title,state,status){
  return '<div class="ios-stephead" data-state="'+(state||'todo')+'">'+docStepInner(n,title,state,status)+'</div>';
}
