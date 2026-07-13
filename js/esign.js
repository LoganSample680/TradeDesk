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

const _ESIGN_PADS = {};

function _esignEsc(s){
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// The one cursive signature face, shared with sign.html's live preview.
const _ESIGN_FONT = '46px Dancing Script, cursive';

function esignWire(prefix, opts){
  opts = opts || {};
  const canvas = document.getElementById(opts.canvasId || (prefix + '-canvas'));
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const ac = new AbortController();
  const pad = {
    prefix, canvas, ctx, ac, drawing: false, ink: false,
    nameId: opts.nameId || (prefix + '-name'),
    errId: opts.errId || (prefix + '-err'),
    onClear: opts.onClear || null,
  };
  const getPos = (e) => {
    const r = canvas.getBoundingClientRect();
    const s = e.touches ? e.touches[0] : e;
    return { x: (s.clientX - r.left) * (canvas.width / r.width), y: (s.clientY - r.top) * (canvas.height / r.height) };
  };
  const start = (e) => {
    pad.drawing = true;
    // First real stroke clears any typed-name preview so ink replaces it.
    if (!pad.ink && opts.clearOnFirstInk) ctx.clearRect(0, 0, canvas.width, canvas.height);
    pad.ink = true;
    const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y);
    if (typeof opts.onInk === 'function') opts.onInk();
  };
  const move = (e) => { if (!pad.drawing) return; const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); };
  canvas.addEventListener('mousedown', start, { signal: ac.signal });
  canvas.addEventListener('mousemove', move, { signal: ac.signal });
  canvas.addEventListener('mouseup', () => pad.drawing = false, { signal: ac.signal });
  canvas.addEventListener('touchstart', (e) => { e.preventDefault(); start(e); }, { passive: false, signal: ac.signal });
  canvas.addEventListener('touchmove', (e) => { e.preventDefault(); move(e); }, { passive: false, signal: ac.signal });
  canvas.addEventListener('touchend', () => pad.drawing = false, { signal: ac.signal });
  // Teardown when the pad's overlay leaves the DOM — no leaked listeners.
  const obs = new MutationObserver(() => {
    if (!document.contains(canvas)) { ac.abort(); pad.drawing = false; obs.disconnect(); delete _ESIGN_PADS[prefix]; }
  });
  obs.observe(document.body, { childList: true, subtree: true });
  _ESIGN_PADS[prefix] = pad;
  return pad;
}

function esignClear(prefix){
  const pad = _ESIGN_PADS[prefix];
  if (!pad) return;
  pad.ctx.clearRect(0, 0, pad.canvas.width, pad.canvas.height);
  pad.ink = false;
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
  const sigData = inked ? pad.canvas.toDataURL('image/png') : '';
  return { ok: true, err: '', sigData, signerName, signedAt: new Date().toISOString() };
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
