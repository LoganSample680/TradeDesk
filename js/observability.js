// ─────────────────────────────────────────────────────────────────────────────
// Observability — capture runtime errors + lightweight interaction telemetry and
// ship them through the `ingest-telemetry` edge function (service role), which writes
// error_log + analytics_events. Powers the ops dashboard, Slack tripwires, and the
// agentic self-heal loop (CLAUDE.md §14).
//
// Why an edge function (not direct inserts): analytics_events / error_log are deny-all
// to clients by design — the function holds the service role, derives the ANONYMIZED
// contractor_hash from the verified JWT (never the raw uid leaves the server), and
// enforces the no-PII rule centrally.
//
// HARD RULES (so this can never destabilize the app or the test suite):
//   • Never throws — every op wrapped, failures swallowed.
//   • Never console.error / console.warn — must not trip assertNoErrors.
//   • No-ops unless the cloud client + a signed-in user exist.
//   • INERT on localhost/127.* — the flow + offline test servers run there, so this
//     adds zero load/behavior during tests; only runs on deployed origins.
// Slack delivery is the owner's step (SLACK_WEBHOOK_URL secret + slack-notify edge fn
// + a DB webhook on error_log) — see docs/OBSERVABILITY.md.
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  'use strict';
  try { if (/^(localhost|127\.|0\.0\.0\.0)/.test(location.hostname)) return; } catch (_e) { return; }

  function _ready() { try { return typeof _supa !== 'undefined' && _supa && _supa.functions && typeof _supaUser !== 'undefined' && _supaUser && _supaUser.id; } catch (_e) { return false; } }
  function _ver() { try { return (typeof APP_VERSION !== 'undefined') ? APP_VERSION : ''; } catch (_e) { return ''; } }
  function _page() { try { return (document.querySelector('.pg.active') || {}).id || null; } catch (_e) { return null; } }
  var _sid = (function () { try { return 's' + Math.abs((Date.now() ^ Math.floor((performance && performance.now ? performance.now() : 0) * 1000))).toString(36); } catch (_e) { return 's0'; } })();

  function _send(payload) {
    try { if (!_ready()) return; _supa.functions.invoke('ingest-telemetry', { body: payload }).then(function () {}, function () {}); } catch (_e) {}
  }

  // ── Error capture (flushed immediately, deduped) ─────────────────────────────
  var _seen = {};
  function _logError(kind, message, stack, ctx) {
    try {
      if (!_ready()) return;
      var key = kind + '|' + String(message || '').slice(0, 120);
      if (_seen[key]) return; _seen[key] = 1;
      _send({ session_id: _sid, app_version: _ver(), errors: [{
        kind: kind,
        message: String(message || '').slice(0, 2000),
        stack: stack ? String(stack).slice(0, 4000) : null,
        url: (location && location.href) || null,
        context: ctx || null,
      }] });
    } catch (_e) {}
  }
  try {
    window.addEventListener('error', function (e) { try { _logError('error', (e && e.message) || 'error', e && e.error && e.error.stack, { file: e && e.filename, line: e && e.lineno }); } catch (_x) {} });
    window.addEventListener('unhandledrejection', function (e) { try { var r = e && e.reason; _logError('unhandledrejection', (r && r.message) || String(r || 'rejection'), r && r.stack); } catch (_x) {} });
  } catch (_e) {}

  // ── Interaction telemetry (batched, aggregated server-side) ──────────────────
  var _batch = [];
  function _track(type, page, value, label) {
    try { if (!_ready()) return; _batch.push({ event: type, ctx: (page != null ? page : (label || _page())), value: (typeof value === 'number' ? value : null) }); if (_batch.length >= 60) _flush(); } catch (_e) {}
  }
  function _flush() {
    try { if (!_ready() || !_batch.length) return; var events = _batch.splice(0, _batch.length); _send({ session_id: _sid, app_version: _ver(), events: events }); } catch (_e) {}
  }
  try {
    document.addEventListener('click', function () { try { _track('click'); } catch (_x) {} }, true);
    var _lastScroll = 0;
    window.addEventListener('scroll', function () { try { var n = Date.now(); if (n - _lastScroll > 1000) { _lastScroll = n; _track('scroll'); } } catch (_x) {} }, true);
    window.addEventListener('beforeunload', _flush);
    document.addEventListener('visibilitychange', function () { try { if (document.visibilityState === 'hidden') _flush(); } catch (_x) {} });
    setInterval(_flush, 30000);
  } catch (_e) {}

  // ── Manual hooks for the app: timings, endpoint latency, custom events ───────
  try {
    window._obs = {
      error: _logError,
      track: _track,                                          // _obs.track('event', page)
      flush: _flush,
      time: function (label, ms) { try { _track('timing', null, (typeof ms === 'number' ? ms : null), label); } catch (_e) {} }, // _obs.time('label', ms)
    };
  } catch (_e) {}
})();
