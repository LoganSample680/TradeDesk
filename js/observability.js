// ─────────────────────────────────────────────────────────────────────────────
// Observability: capture runtime errors + lightweight interaction telemetry and
// ship them through the `ingest-telemetry` edge function (service role), which writes
// error_log + analytics_events. Powers the ops dashboard, Slack tripwires, and the
// agentic self-heal loop (CLAUDE.md §14).
//
// Why an edge function (not direct inserts): analytics_events / error_log are deny-all
// to clients by design, the function holds the service role, derives the ANONYMIZED
// contractor_hash from the verified JWT (never the raw uid leaves the server), and
// enforces the no-PII rule centrally.
//
// HARD RULES (so this can never destabilize the app or the test suite):
//   • Never throws, every op wrapped, failures swallowed.
//   • Never console.error / console.warn: must not trip assertNoErrors.
//   • No-ops unless the cloud client + a signed-in user exist.
//   • INERT on localhost/127.*: the flow + offline test servers run there, so this
//     adds zero load/behavior during tests; only runs on deployed origins.
// Slack delivery is the owner's step (SLACK_WEBHOOK_URL secret + slack-notify edge fn
// + a DB webhook on error_log), see docs/OBSERVABILITY.md.
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
  // Transient THIRD-PARTY outages the app already degrades around, reportable
  // as app errors they are not: nothing in our code can fix Apple's servers
  // returning 503, and the hotfix lane paged exactly that (error_log 37).
  // Geocoding/directions already fall back to Photon when MapKit is down, so
  // the user experience self-heals. Deliberately narrow: only MapKit's own
  // init/load failures with a 5xx/network signature, a MapKit auth/token
  // error (401/invalid) still reports, because THAT one is ours to fix.
  var _EXTERNAL_TRANSIENT = /^\[MapKit\].*(50[0-9]|Network Unavailable)/i;
  function _isExternalTransient(msg) { try { return _EXTERNAL_TRANSIENT.test(String(msg || '')); } catch (_e) { return false; } }
  // Hotfix (error_log 64,65): "ResizeObserver loop completed with undelivered
  // notifications" (and the older "...loop limit exceeded" wording) is a
  // well-documented Chromium/WebKit-internal race in the ResizeObserver spec
  // itself, not an application bug, it fires whenever an observed element's
  // own resize handler causes another resize within the same frame. There is
  // no app-code fix: every site using ResizeObserver (directly or via a
  // library) sees it. Filtered at capture, same as the MapKit outage filter
  // above, so it never re-pages the hot lane.
  var _BENIGN_BROWSER_NOISE = /^ResizeObserver loop (completed with undelivered notifications|limit exceeded)/i;
  function _isBenignBrowserNoise(msg) { try { return _BENIGN_BROWSER_NOISE.test(String(msg || '')); } catch (_e) { return false; } }
  function _logError(kind, message, stack, ctx) {
    try {
      if (!_ready()) return;
      if (_isExternalTransient(message)) return;
      if (_isBenignBrowserNoise(message)) return;
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
  // Serialize one console.error argument into something a human can root-cause.
  // JSON.stringify alone produced "{}" for Error instances, DOM events, and
  // anything with only non-enumerable props (error_log 38 was literally "{}"):
  // an unactionable report that re-pages the hotfix lane forever. Prefer
  // stack > message > name/type > enumerable JSON > String().
  function _serializeArg(a) {
    try {
      if (a && a.stack) return String(a.stack).slice(0, 500);
      if (typeof a !== 'object' || a === null) return String(a);
      if (a.message) return String(a.message).slice(0, 300);
      if (a.reason && a.reason.message) return String(a.reason.message).slice(0, 300);
      if (a.type && (a.target || a.currentTarget)) return '[event ' + a.type + ']';
      var j = JSON.stringify(a);
      if (j && j !== '{}' && j !== '[]') return j.slice(0, 300);
      var s = String(a);
      return s !== '[object Object]' ? s.slice(0, 300) : '[object: no serializable content]';
    } catch (_e2) { return '?'; }
  }
  try {
    window.addEventListener('error', function (e) { try { _logError('error', (e && e.message) || 'error', e && e.error && e.error.stack, { file: e && e.filename, line: e && e.lineno }); } catch (_x) {} });
    window.addEventListener('unhandledrejection', function (e) { try { var r = e && e.reason; _logError('unhandledrejection', (r && r.message) || String(r || 'rejection'), r && r.stack); } catch (_x) {} });
    // console.error capture (kind 'console'): feeds the error_log → PR self-heal
    // loop (§14). Wraps, never replaces: the original always still fires, so
    // DevTools and Playwright's console listeners see everything unchanged.
    var _origCErr = console.error;
    console.error = function () {
      try {
        var msg = Array.prototype.slice.call(arguments).map(_serializeArg).join(' ');
        // A report with zero content can never be root-caused, it would page
        // the hotfix lane forever with nothing to fix. The original console.error
        // below still fires either way, so DevTools loses nothing.
        if (msg.replace(/[\s?]|\[object: no serializable content\]/g, '') !== '') {
          _logError('console', msg, null, { page: _page() });
        }
      } catch (_x) {}
      try { return _origCErr.apply(console, arguments); } catch (_x2) {}
    };
  } catch (_e) {}

  // ── Dead-control detection (FIRST ineffective click) ─────────────────────────
  // A dead button usually throws NOTHING, the tap just does nothing. Detect it
  // from behavior on the FIRST click (owner decision 2026-07-03: don't wait for a
  // rage-click): if 700ms after clicking a control there was NO effect of any
  // kind: no DOM mutation anywhere, no navigation, no network request, no new
  // tab: report kind 'dead-button' to error_log, which feeds the hotfix lane
  // exactly like a crash. The effect net is deliberately wide (toasts, modals,
  // re-renders, fetches, window.open all count) so a working control can't
  // false-alarm; _seen dedupes to one report per control per session. Escape
  // hatch: data-obs-quiet on a control exempts it.
  var _netSeq = 0;
  try {
    var _origFetch = window.fetch;
    if (typeof _origFetch === 'function') {
      window.fetch = function () { _netSeq++; return _origFetch.apply(this, arguments); };
    }
    var _origXhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function () { _netSeq++; return _origXhrOpen.apply(this, arguments); };
    var _origWinOpen = window.open;
    window.open = function () { _netSeq++; return _origWinOpen.apply(this, arguments); };
  } catch (_e) {}
  function _ctlSig(el) {
    try {
      return (el.id ? '#' + el.id : (el.getAttribute('onclick') || '').slice(0, 80) || el.tagName) + '|' + (el.textContent || el.value || '').trim().slice(0, 40);
    } catch (_e) { return '?'; }
  }
  try {
    document.addEventListener('click', function (e) {
      try {
        var el = e.target && e.target.closest && e.target.closest('button,[onclick],[role="button"],a,input[type="submit"]');
        if (!el || el.disabled || el.closest('[data-obs-quiet]')) return;
        // Real links navigate/open apps on their own, that IS their effect.
        var href = el.tagName === 'A' ? (el.getAttribute('href') || '') : '';
        if (href && href !== '#' && href.indexOf('javascript:') !== 0) return;
        var sig = _ctlSig(el), href0 = location.href, net0 = _netSeq, mutated = false;
        var mo = new MutationObserver(function () { mutated = true; });
        mo.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
        setTimeout(function () {
          try {
            mo.disconnect();
            if (mutated || location.href !== href0 || _netSeq !== net0) return;
            _logError('dead-button', 'Dead control, no effect on click: ' + sig, null, { page: _page(), sig: sig });
          } catch (_x) {}
        }, 700);
      } catch (_x) {}
    }, true);
  } catch (_e) {}

  // ── Interaction telemetry (batched, aggregated server-side) ──────────────────
  var _batch = [];
  function _track(type, page, value, label, ctl) {
    try { if (!_ready()) return; _batch.push({ event: type, ctx: (page != null ? page : (label || _page())), value: (typeof value === 'number' ? value : null), ctl: (ctl || null) }); if (_batch.length >= 60) _flush(); } catch (_e) {}
    // The page event IS the visit boundary, so the dwell clock rolls here and
    // no call site has to remember to do it. js/navigation.js already fires
    // _obs.track('page', id) on every goPg, which is the one and only way a
    // page becomes active.
    try { if (type === 'page') _dwellStart(page); } catch (_e) {}
  }

  // WHICH CONTROL, NOT WHICH WORDS (owner 2026-09-11: "every button needs
  // tracked"). A click used to record only the page, so `pg-tracker: 757` was
  // the whole story and nothing said whether those were the Income tab or the
  // Hiring tab. This names the control.
  //
  // The identity is deliberately NOT the button's text, which _ctlSig above
  // uses and which the dead-button path can afford because it writes to
  // error_log, an ops table. On a client row or a job card that text is a
  // CUSTOMER'S NAME, and analytics_events is the table the anonymized hash
  // exists for. Sending names into it would defeat the hash sitting next to
  // them. So: the element id when it has one, else the function its onclick
  // calls, with the ARGUMENTS STRIPPED, because that is where the ids and
  // names live (openClientProposals(currentClientId) → openClientProposals).
  // Both are written by us, stable across renders, and bounded in number:
  // a list of 200 clients is one signature, not 200.
  function _ctlId(el) {
    try {
      if (el.id) return ('#' + el.id).slice(0, 60);
      var oc = el.getAttribute && el.getAttribute('onclick');
      if (oc) {
        var m = String(oc).match(/([A-Za-z_$][\w$]*)\s*\(/);
        if (m) return m[1].slice(0, 60);
      }
      var cls = (el.className && typeof el.className === 'string') ? el.className.trim().split(/\s+/)[0] : '';
      return ((el.tagName || '?').toLowerCase() + (cls ? '.' + cls : '')).slice(0, 60);
    } catch (_e) { return null; }
  }

  // HOW LONG THEY SAT THERE. One dwell row per visit, seconds, closed out by
  // whatever ends the visit: another page, backgrounding, or the app closing.
  // Counted from the page becoming active, and paused while the app is hidden,
  // so a phone left in a pocket overnight does not report a 9-hour visit to
  // the dashboard.
  var _dwellPage = null, _dwellAt = 0, _dwellAcc = 0;
  function _dwellStop() {
    try {
      if (_dwellPage == null) return;
      if (_dwellAt) { _dwellAcc += Date.now() - _dwellAt; _dwellAt = 0; }
      var secs = Math.round(_dwellAcc / 1000);
      if (secs > 0) _track('dwell', _dwellPage, secs);
      _dwellPage = null; _dwellAcc = 0;
    } catch (_e) {}
  }
  function _dwellStart(page) {
    try { _dwellStop(); _dwellPage = page || _page(); _dwellAcc = 0; _dwellAt = _dwellPage ? Date.now() : 0; } catch (_e) {}
  }
  // WHAT IS DRIVING THE APP. The flow suite drives the DEPLOYED app with a real
  // login, so its steps reach ingest-telemetry exactly like a customer's taps
  // (tests/flow/live-helpers.js calls _obs.track). Without this every product
  // metric counts CI as a user: of the seventeen event kinds in the table on
  // 2026-09-10, the three highest-volume were the test harness. The harness
  // sets this; nothing else ever does, and the default is a real person.
  var _source = 'app';
  function _flush() {
    try { if (!_ready() || !_batch.length) return; var events = _batch.splice(0, _batch.length); _send({ session_id: _sid, app_version: _ver(), source: _source, events: events }); } catch (_e) {}
  }
  try {
    document.addEventListener('click', function (e) {
      try {
        // The page-level count is unchanged, so the ten weeks of existing
        // click rows keep meaning the same thing and usage_by_screen does not
        // move. The control rides alongside it.
        var el = e && e.target && e.target.closest && e.target.closest('button,[onclick],[role="button"],a,input[type="submit"]');
        _track('click', null, null, null, el ? _ctlId(el) : null);
      } catch (_x) { try { _track('click'); } catch (_y) {} }
    }, true);
    var _lastScroll = 0;
    window.addEventListener('scroll', function () { try { var n = Date.now(); if (n - _lastScroll > 1000) { _lastScroll = n; _track('scroll'); } } catch (_x) {} }, true);
    window.addEventListener('beforeunload', function () { try { _dwellStop(); } catch (_x) {} _flush(); });
    document.addEventListener('visibilitychange', function () {
      try {
        if (document.visibilityState === 'hidden') {
          // Bank the time so far and stop the clock: a backgrounded app is not
          // a person reading the page. The visit stays open, so coming back to
          // the same screen continues it rather than starting a second one.
          if (_dwellPage != null && _dwellAt) { _dwellAcc += Date.now() - _dwellAt; _dwellAt = 0; }
          _flush();
        } else if (_dwellPage != null && !_dwellAt) { _dwellAt = Date.now(); }
      } catch (_x) {}
    });
    setInterval(_flush, 30000);
  } catch (_e) {}

  // ── Manual hooks for the app: timings, endpoint latency, custom events ───────
  try {
    window._obs = {
      error: _logError,
      track: _track,                                          // _obs.track('event', page)
      flush: _flush,
      time: function (label, ms) { try { _track('timing', null, (typeof ms === 'number' ? ms : null), label); } catch (_e) {} }, // _obs.time('label', ms)
      // Declare this session as the test harness. One way on purpose: a page
      // that has said it is a test must not be able to talk its way back into
      // the product numbers halfway through.
      markTest: function () { try { _source = 'test'; } catch (_e) {} },
    };
  } catch (_e) {}
})();
