// ── esign.js — THE one e-sign module ─────────────────────────────────────────
// Owner directive (2026-07-13): estimates, change orders, job sign-offs,
// diagnostic charges, and GC-bid approvals all use the EXACT same e-sign code,
// just displayed in different areas — and the way a signature is DISPLAYED
// (client hub documents + the business-owner record) is one component too.
// This file is loaded by index.html, client.html, AND sign.html, so a change
// here updates every signing surface at once.
//
// Capture:  esignWire(prefix, opts)   → sets up canvas draw listeners (mouse +
//           touch), with AbortController + MutationObserver teardown so
//           listeners die with the overlay (the one well-behaved pattern from
//           the old change-order pad, now everywhere).
//           esignClear(prefix)        → wipe the pad (re-runs onClear hook).
//           esignHasInk(prefix)       → has anything been drawn?
//           esignResult(prefix, opts) → validate + produce
//           {ok, err, sigData, signerName, signedAt}. If nothing was drawn but
//           a name was typed and opts.typedAsSig is on, the typed name is
//           rendered in the cursive signature face (same as sign.html) so a
//           signature image ALWAYS exists.
//   Pads register by prefix; default DOM ids are `${prefix}-canvas`,
//   `${prefix}-name`, `${prefix}-err` (override via opts for legacy ids).
//
// Display:  esignSigBlockHTML(o)      → the signed-document block (top rule,
//           uppercase label, signature image card, Signed By / Date grid,
//           optional extra cells) — used by the client hub docs, sign.html,
//           and the contractor's own record views.
//           esignConsentHTML(prefix,terms) → THE consent block (owner
//           directive 2026-07-13): a required "I agree" checkbox + the terms
//           collapsed behind a click-to-expand accordion (same visual as the
//           proposal's own Terms & Conditions toggle) so the disclosure never
//           crowds the signature. Pass requireConsent:true to esignResult to
//           gate on it. The SENTENCE differs by document (a change order
//           modifies a contract, an estimate IS the contract, a diagnostic
//           charge is a one-line approval) — that's necessarily different text
//           — but every one ends in the same E-SIGN citation, sits in the same
//           checkbox+accordion shape, and never restates deposit/cancellation
//           terms that are already in the document's own Terms & Conditions.
const ESIGN_CITE = '15 U.S.C. §7001 et seq.';
// Shared verbatim sentences — a change order and a job price-increase are the
// SAME kind of document (modifying an existing contract), so they carry the
// literal same disclosure, not just the same box.
const ESIGN_NOTE_CHANGE_ORDER = 'You agree to modify the original contract to reflect the scope and price changes described above. All other terms of the original contract remain in effect. This change order is legally binding upon signature under applicable state and federal electronic transaction law (' + ESIGN_CITE + ').';
// Deposit/balance timing and cancellation rights are already stated in full in
// the document's own Terms & Conditions — this box is deliberately short and
// never repeats them (owner directive 2026-07-13: no redundant restating).
const ESIGN_NOTE_ESTIMATE = 'You agree to the total price, scope of work, and all terms above. This constitutes a binding electronic signature under applicable state and federal electronic transaction law (' + ESIGN_CITE + ').';

const _ESIGN_PADS = {};

function _esignEsc(s){
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// The one cursive signature face, shared with sign.html's live preview.
const _ESIGN_FONT = '46px Dancing Script, cursive';

// The ONE markup for every capture surface (owner directive 2026-07-13): name
// field on top, canvas below with a live "type it or draw it" placeholder,
// Clear link under it — sign.html's shape, used verbatim everywhere so there
// is only one layout to ever look at, not six that drifted apart.
function esignPadHTML(prefix, opts){
  opts = opts || {};
  const nameId = opts.nameId || (prefix + '-name');
  const canvasId = opts.canvasId || (prefix + '-canvas');
  const phId = prefix + '-ph';
  const nameLabel = opts.nameLabel || 'Full name *';
  const namePlaceholder = opts.namePlaceholder || 'Type your full legal name';
  const phText = opts.phText || 'Signature appears here as you type — or draw below';
  return '<div style="margin-bottom:14px">' +
      '<label for="' + _esignEsc(nameId) + '" style="display:block;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--text3,#6b7280);margin-bottom:6px">' + _esignEsc(nameLabel) + '</label>' +
      '<input type="text" id="' + _esignEsc(nameId) + '" placeholder="' + _esignEsc(namePlaceholder) + '" autocomplete="name" style="width:100%;box-sizing:border-box;font-size:16px;padding:11px 12px;border-radius:10px;border:1.5px solid var(--border2,#d1d5db);background:#fff;font-family:inherit;color:var(--text,#111)">' +
    '</div>' +
    '<div id="' + prefix + '-pad-wrap" style="background:#fff;border:1.5px solid var(--border2,#d1d5db);border-radius:10px;min-height:130px;position:relative;overflow:hidden;margin-bottom:6px;touch-action:none;cursor:crosshair">' +
      '<canvas id="' + _esignEsc(canvasId) + '" width="500" height="130" style="display:block;width:100%;height:130px"></canvas>' +
      '<div style="position:absolute;bottom:28px;left:20px;right:20px;height:1.5px;background:#1a1a18;opacity:.1;pointer-events:none"></div>' +
      '<div id="' + _esignEsc(phId) + '" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:13px;pointer-events:none;text-align:center;padding:18px 20px 0">' + _esignEsc(phText) + '</div>' +
    '</div>' +
    '<div style="display:flex;justify-content:flex-end;margin-bottom:14px">' +
      '<button type="button" onclick="esignClear(\'' + prefix + '\')" style="font-size:12px;color:var(--text3,#6b7280);background:none;border:none;cursor:pointer;font-family:inherit;text-decoration:underline">Clear drawing</button>' +
    '</div>';
}

// Wires a pad rendered by esignPadHTML (or any canvas+name-input pair sharing
// its ids). Draw + type both work everywhere, live-preview the typed name
// into the pad in the shared cursive face, and auto-manage the placeholder —
// callers no longer hand-wire any of this per surface.
function esignWire(prefix, opts){
  opts = opts || {};
  const canvas = document.getElementById(opts.canvasId || (prefix + '-canvas'));
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const ac = new AbortController();
  const nameEl = document.getElementById(opts.nameId || (prefix + '-name'));
  const phEl = document.getElementById(prefix + '-ph');
  const pad = {
    prefix, canvas, ctx, ac, drawing: false, ink: false,
    nameId: opts.nameId || (prefix + '-name'),
    errId: opts.errId || (prefix + '-err'),
    onClear: opts.onClear || null,
  };
  // Placeholder shows only on a truly empty pad — hidden the instant either a
  // typed preview is rendered or real ink exists.
  const updatePh = () => {
    if (!phEl) return;
    const typedShowing = !pad.ink && nameEl && nameEl.value.trim().length > 2;
    phEl.style.display = (pad.ink || typedShowing) ? 'none' : '';
  };
  pad.updatePh = updatePh;
  const getPos = (e) => {
    const r = canvas.getBoundingClientRect();
    const s = e.touches ? e.touches[0] : e;
    return { x: (s.clientX - r.left) * (canvas.width / r.width), y: (s.clientY - r.top) * (canvas.height / r.height) };
  };
  const start = (e) => {
    pad.drawing = true;
    // First real stroke clears any typed-name preview so ink replaces it —
    // the default everywhere now (drawing always wins over a typed preview).
    if (!pad.ink && opts.clearOnFirstInk !== false) ctx.clearRect(0, 0, canvas.width, canvas.height);
    pad.ink = true;
    const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y);
    updatePh();
    if (typeof opts.onInk === 'function') opts.onInk();
  };
  const move = (e) => { if (!pad.drawing) return; const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); };
  canvas.addEventListener('mousedown', start, { signal: ac.signal });
  canvas.addEventListener('mousemove', move, { signal: ac.signal });
  canvas.addEventListener('mouseup', () => pad.drawing = false, { signal: ac.signal });
  canvas.addEventListener('touchstart', (e) => { e.preventDefault(); start(e); }, { passive: false, signal: ac.signal });
  canvas.addEventListener('touchmove', (e) => { e.preventDefault(); move(e); }, { passive: false, signal: ac.signal });
  canvas.addEventListener('touchend', () => pad.drawing = false, { signal: ac.signal });
  // Live typed-signature preview — the SAME behavior everywhere now: type a
  // name, watch it render in the pad in the cursive face; start drawing and
  // it's replaced by real ink (clearOnFirstInk above).
  if (nameEl && opts.typedPreview !== false) {
    nameEl.addEventListener('input', () => {
      if (!pad.ink) esignTypedToCanvas(prefix, nameEl.value);
      updatePh();
      if (typeof opts.onType === 'function') opts.onType();
    }, { signal: ac.signal });
  }
  // Teardown when the pad's overlay leaves the DOM — no leaked listeners.
  const obs = new MutationObserver(() => {
    if (!document.contains(canvas)) { ac.abort(); pad.drawing = false; obs.disconnect(); delete _ESIGN_PADS[prefix]; }
  });
  obs.observe(document.body, { childList: true, subtree: true });
  _ESIGN_PADS[prefix] = pad;
  updatePh();
  return pad;
}

function esignClear(prefix){
  const pad = _ESIGN_PADS[prefix];
  if (!pad) return;
  pad.ctx.clearRect(0, 0, pad.canvas.width, pad.canvas.height);
  pad.ink = false;
  if (typeof pad.updatePh === 'function') pad.updatePh();
  if (typeof pad.onClear === 'function') pad.onClear();
}

// Alpha-channel scan — the single copy of the "did they actually sign" check.
function esignHasInk(prefix){
  const pad = _ESIGN_PADS[prefix];
  if (!pad) return false;
  const d = pad.ctx.getImageData(0, 0, pad.canvas.width, pad.canvas.height).data;
  for (let i = 3; i < d.length; i += 4) { if (d[i] > 0) return true; }
  return false;
}

// Render a typed name onto a pad in the shared cursive face (sign.html look).
// Used both for live typed-name previews and the typedAsSig fallback.
function esignTypedToCanvas(prefix, name){
  const pad = _ESIGN_PADS[prefix];
  if (!pad) return;
  pad.ctx.clearRect(0, 0, pad.canvas.width, pad.canvas.height);
  pad.ink = false;
  if (!String(name || '').trim()) return;
  pad.ctx.font = _ESIGN_FONT; pad.ctx.fillStyle = '#1a1a18';
  pad.ctx.textAlign = 'center'; pad.ctx.textBaseline = 'middle';
  pad.ctx.fillText(String(name).trim(), pad.canvas.width / 2, pad.canvas.height / 2);
}

// Validate + produce the signature result. Messaging matches the old per-site
// copy so nothing user-facing changes.
function esignResult(prefix, opts){
  opts = opts || {};
  const pad = _ESIGN_PADS[prefix];
  const fail = (err) => {
    if (pad) { const el = document.getElementById(pad.errId); if (el) { el.style.display = 'block'; el.textContent = err; } }
    return { ok: false, err, sigData: '', signerName: '', signedAt: '' };
  };
  if (!pad) return { ok: false, err: 'no-pad', sigData: '', signerName: '', signedAt: '' };
  const nameEl = document.getElementById(pad.nameId);
  const signerName = ((nameEl && nameEl.value) || '').trim();
  const minName = opts.minNameLen == null ? 1 : opts.minNameLen;
  if (opts.requireTyped !== false && signerName.length < minName)
    return fail(opts.nameErr || 'Type the full name to confirm.');
  let inked = esignHasInk(prefix);
  if (!inked && opts.typedAsSig && signerName) { esignTypedToCanvas(prefix, signerName); inked = true; }
  if (opts.requireDrawn && !inked)
    return fail(opts.drawErr || 'Sign in the box above.');
  if (opts.requireConsent) {
    const ck = document.getElementById(opts.consentId || (prefix + '-ck'));
    if (!ck || !ck.checked) return fail(opts.consentErr || 'Check the box to agree before signing.');
  }
  const sigData = inked ? pad.canvas.toDataURL('image/png') : '';
  return { ok: true, err: '', sigData, signerName, signedAt: new Date().toISOString() };
}

// The ONE consent block: required "I agree" checkbox + the terms collapsed
// behind a click-to-expand accordion (same visual language as the proposal's
// own Terms & Conditions toggle in legal.js _applyTermsAccordion) so the
// disclosure never crowds the signature pad above it.
function esignConsentHTML(prefix, termsHtml, opts){
  opts = opts || {};
  const ckId = opts.consentId || (prefix + '-ck');
  const title = opts.title || 'I agree to this electronic agreement';
  return '<div style="padding:14px;background:var(--bg,#fff);border:1.5px solid var(--border2,#d1d5db);border-radius:10px;margin-bottom:20px">' +
    '<label style="display:flex;align-items:flex-start;gap:12px;cursor:pointer;margin-bottom:10px">' +
      '<input type="checkbox" id="' + _esignEsc(ckId) + '"' + (opts.onChange ? ' onchange="' + _esignEsc(opts.onChange) + '"' : '') + ' style="width:20px;height:20px;min-width:20px;accent-color:var(--ink,#1a1a18);margin-top:1px;cursor:pointer">' +
      '<div style="font-size:13px;font-weight:700;color:var(--text,#111)">' + _esignEsc(title) + '</div>' +
    '</label>' +
    '<button type="button" onclick="esignToggleTerms(\'' + prefix + '\')" style="display:flex;align-items:center;width:100%;background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:8px;padding:9px 12px;font-family:inherit;cursor:pointer;transition:background .15s,border-color .15s">' +
      '<span style="flex:1;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#1a365d;text-align:left">Terms</span>' +
      '<span id="' + prefix + '-terms-hint" style="font-size:11px;font-weight:600;color:#94a3b8;white-space:nowrap;margin-left:8px">Tap to view ›</span>' +
    '</button>' +
    '<div id="' + prefix + '-terms-body" style="display:none;font-size:11px;color:var(--text3,#6b7280);line-height:1.6;padding:10px 2px 0">' + termsHtml + '</div>' +
  '</div>';
}
function esignToggleTerms(prefix){
  const body = document.getElementById(prefix + '-terms-body');
  const hint = document.getElementById(prefix + '-terms-hint');
  if (!body) return;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : '';
  if (hint) hint.textContent = open ? 'Tap to view ›' : 'Collapse ‹';
}

// The one signed-document display block: top rule + uppercase label +
// signature image card + Signed By / Date grid (+ optional extra cells).
// Renders identically in the client hub, sign.html, and the owner's record.
function esignSigBlockHTML(o){
  o = o || {};
  if (!o.signedAt && !o.signerName) return '';
  const dt = o.signedAt
    ? new Date(o.signedAt).toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '—';
  const cells = [
    { label: 'Signed By', value: o.signerName || 'Client' },
    { label: 'Date & Time', value: dt },
  ].concat(Array.isArray(o.cells) ? o.cells : []);
  const grid = cells.map(c =>
    '<div><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#999;margin-bottom:3px">' + _esignEsc(c.label) + '</div>' +
    '<div style="font-size:13px;font-weight:700;color:#1a1a18">' + _esignEsc(c.value) + '</div></div>'
  ).join('');
  return '<div' + (o.blockId ? ' id="' + _esignEsc(o.blockId) + '"' : '') + ' style="margin-top:' + (o.marginTop || '20px') + ';border-top:2px solid ' + (o.ruleColor || '#1a1a18') + ';padding-top:14px">' +
    '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#666;margin-bottom:8px">' + _esignEsc(o.title || 'Client Signature') + '</div>' +
    (o.sigData ? '<div style="background:#fff;border:1.5px solid #e2e8f0;border-radius:10px;padding:12px;margin:12px 0;text-align:center"><img src="' + _esignEsc(o.sigData) + '" style="max-width:100%;max-height:110px" alt="' + _esignEsc(o.imgAlt || 'Client signature') + '"></div>' : '') +
    (o.note ? '<div style="font-size:12px;color:#475569;line-height:1.5;margin-bottom:10px">' + _esignEsc(o.note) + '</div>' : '') +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' + grid + '</div>' +
  '</div>';
}
