// ── The live demo ───────────────────────────────────────────────────────────
//
// This file is the whole of demo mode. It runs inside the SHIPPED app: the
// marketing page (landing.html) puts index.html in a frame with ?demo=1, so
// what a visitor plays with is production exactly as it stands. A merge to
// main rebuilds production and the frames serve the new app on the next load.
// There is no second copy of the app, no snapshot and no screenshot, so the
// demo cannot drift from the product.
//
// Two frames on that page, two jobs:
//   the hero      a sandbox. Boots at stage 1 and is theirs to poke at.
//   the 8 steps   a walkthrough. Each step rebuilds the same job at that
//                 point in its life and stays live, so a visitor can follow
//                 the script or wander off and try it themselves.
//
// ISOLATION. The sandbox that makes this safe is installed in index.html's
// head, before any other script: in demo mode window.localStorage and
// sessionStorage are in-memory and indexedDB is gone. So the demo cannot read
// the owner's real account data (it is the same origin), cannot write over it,
// gets a private copy per frame and per tab, and resets itself on every load.
// supaEnabled() is false here (js/cloud.js), so no Supabase client is ever
// created and nothing can leave the browser. Any number of visitors can be in
// the demo at once and none of them can touch another's, or a real account.
//
// The seed is rebuilt from scratch for a stage every time, never stored and
// never diffed, so a stage looks the same however the visitor arrived at it.
//
// The record shapes below are the ones the app's own writers produce. Where a
// field looks redundant it is not: see the notes at each one.

// One painting company, one job, walked from the first call to paid. Ids are
// fixed so a rebuilt stage lands on the same records.
var _TD_DEMO_CLIENT = 9000001;
var _TD_DEMO_BID = 9000002;
var _TD_DEMO_JOB = 9000003;

// Stage names, in the order of the eight steps on the marketing page.
var _TD_DEMO_STAGES = ['lead', 'estimate', 'sign', 'schedule', 'onsite', 'change', 'invoice', 'collect'];

var _TD_DEMO_BASE = 2300;      // the signed contract
var _TD_DEMO_CO = 480;         // the change order on top of it
var _TD_DEMO_DEPOSIT = 575;    // 25%, the app's default deposit

function _tdDemoDay(offset) {
  var d = new Date();
  d.setDate(d.getDate() + (offset || 0));
  return (typeof dateKey === 'function') ? dateKey(d)
    : d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function _tdDemoAt(dayOffset, hour, min) {
  var d = new Date();
  d.setDate(d.getDate() + (dayOffset || 0));
  d.setHours(hour, min || 0, 0, 0);
  return d.toISOString();
}

// The business. setupDone and setupSkipped must BOTH be truthy or the
// dashboard shows the new-account setup checklist instead of the business
// (js/dashboard.js). The trade does not live on S: getActiveTrade() reads
// _activeTrade first (js/generic-estimate.js).
function _tdDemoSettings() {
  if (typeof S === 'undefined' || !S) return;
  S.bname = 'Hollow Creek Painting';
  S.bphone = '(316) 555-0142';
  S.bemail = 'office@hollowcreekpainting.com';
  S.blic = 'Licensed & Insured · KS #PC-88214';
  S.baddr = '1820 NW Tyler St';
  S.bcity = 'Wichita';
  S.state = 'KS';
  S.bzip = '67203';
  S.sinceYear = 2011;
  S.brandColor = '#1D4E6B';
  S.setupDone = true;
  S.setupSkipped = true;
  S.depositPct = 25;
  S.laborRate = 45;
  S.bizTz = 'America/Chicago';
  S.goalMonthly = 24000;
  S.poweredBy = false;
  // Andre has to be on the roster or his hours are filtered out of the time
  // log, and a crew day that shows only the owner is not the point of step 5.
  S.employees = [{ id: 'demo-crew', name: 'Andre Ruiz', role: 'Crew', payType: 'hourly', payRate: 24 }];
  try { window._activeTrade = 'painting'; } catch (e) {}
  // The demo is always the owner. goPg() sends employees away from half these
  // pages (js/navigation.js), which would strand a step on the wrong screen.
  try { window._isEmployee = false; } catch (e) {}
}

// Everything up to and including `stage` exists; nothing after it does. That
// one rule is why a step can never show a record belonging to a later step.
function _tdDemoSeed(stage) {
  var n = _TD_DEMO_STAGES.indexOf(stage);
  if (n < 0) n = 0;
  var has = function (name) { return n >= _TD_DEMO_STAGES.indexOf(name); };

  _tdDemoSettings();

  // yearBuilt is deliberately post-1978: a pre-1978 home triggers the EPA RRP
  // lead-paint gate (js/clients.js), which is a real feature but a modal in
  // the middle of a walkthrough is not what the step is about.
  clients = [{
    id: _TD_DEMO_CLIENT,
    name: 'Dana Whitfield',
    phone: '(316) 555-0188',
    email: 'dana@example.com',
    addr: '1412 Oak Ridge Dr, Wichita, KS 67206',
    street: '1412 Oak Ridge Dr', city: 'Wichita', state: 'KS', zip: '67206',
    ptype: 'Single family home',
    partyType: '',
    source: 'Google',
    ref: '',
    notes: 'Called about the exterior. Wants it done before family visit in three weeks.',
    created: _tdDemoDay(-6),
    createdAt: _tdDemoAt(-6, 9, 12),
    yearBuilt: 1994,
    // Filled in as though the property lookup had already run: the client
    // screen schedules that lookup 500ms after it paints when this is empty,
    // and the demo never calls out.
    propDataFetchedAt: _tdDemoAt(-6, 9, 13),
    propDataSource: 'demo', propDataExact: true,
    sqft: 2180, stories: 1, bedrooms: 4, bathrooms: 2,
    propertyType: 'Single Family', exteriorMaterial: 'Wood siding',
    roofType: 'Composition shingle', garage: '2 car attached', lotSize: '0.31 ac',
    extraAddresses: [], clientToken: '', clientHubKey: '',
    last_contact_date: _tdDemoDay(has('sign') ? 0 : -4),
  }];

  bids = [];
  jobs = [];
  payments = [];
  income = [];
  expenses = [];
  mileage = [];
  timeEntries = [];
  if (typeof events !== 'undefined') events = [];
  if (typeof photos !== 'undefined') photos = [];
  if (typeof liens !== 'undefined') liens = [];

  // The priced lines, and the client-facing selectable version of the same
  // work. Both live flat on the bid; the app keeps them in parallel.
  var lines = [
    { desc: 'Prep & pressure wash', qty: 1, unit: 'lot', rate: 320, total: 320, notes: '', _byoSection: 'Exterior' },
    { desc: 'Sand & spot-prime bare wood', qty: 1, unit: 'lot', rate: 260, total: 260, notes: '', _byoSection: 'Exterior' },
    { desc: 'Body & trim, two coats', qty: 1, unit: 'lot', rate: 1180, total: 1180, notes: '', _byoSection: 'Exterior' },
    { desc: 'Paint, brushes, masking', qty: 1, unit: 'lot', rate: 540, total: 540, notes: '', _byoSection: 'Materials' },
  ];
  var byo = lines.map(function (l, i) {
    return {
      id: i + 1, section: l._byoSection, label: l.desc, qty: 1, unit: 'ea',
      rate: l.rate, price: l.total, notes: '', on: true, required: i < 3, _rrp: false,
    };
  });

  if (has('estimate')) {
    var signed = has('sign');
    var changed = has('change');
    var total = _TD_DEMO_BASE + (changed ? _TD_DEMO_CO : 0);
    var bid = {
      id: _TD_DEMO_BID,
      client_id: _TD_DEMO_CLIENT,
      client_name: 'Dana Whitfield', name: 'Dana Whitfield',
      phone: '(316) 555-0188',
      addr: '1412 Oak Ridge Dr, Wichita, KS 67206',
      bid_date: _tdDemoDay(-4),
      // A signed change order moves the contract total onto the bid itself.
      amount: total,
      deposit: _TD_DEMO_DEPOSIT,
      type: 'Exterior repaint', geiDesc: 'Exterior repaint', descUserSet: true,
      notes: 'Two-tone: body in Accessible Beige, trim in Pure White.',
      // Only five statuses exist and `draft` has to agree with the one chosen,
      // or the proposals page files the bid in the wrong bucket.
      status: signed ? 'Closed Won' : 'Pending',
      draft: false,
      isFreeForm: true,
      byoItems: byo,
      geiLines: lines,
      geiTaxPct: 0,
      geiDuration: '3 days',
      scopeChips: ['Pressure washing', 'Caulking', 'Trim & doors', 'Two coats'],
      exclusions: ['Roof repairs', 'Window glass replacement'],
      estHours: 26, estCrew: ['Andre Ruiz'], estCrewSize: 2,
      trade_type: 'painting',
      validUntil: _tdDemoDay(26),
    };
    if (signed) {
      // Both spellings are real: the audit timeline reads signedName and
      // signatureData, the client hub and change orders read signerName and
      // sigData. A demo that sets only one pair renders half-blank.
      bid.signedAt = _tdDemoAt(-3, 16, 20);
      bid.estStatus = 'signed';
      bid.signedName = 'Dana Whitfield';
      bid.signerName = 'Dana Whitfield';
      bid.signatureData = '';
      bid.sigData = '';
      bid.signed = true;
      bid.proposalSentDate = _tdDemoDay(-4);
      bid.sentAt = _tdDemoAt(-4, 11, 5);
    }
    if (changed) {
      // A change order is not its own record: it is nested on the bid, and the
      // bid's amount is already the new total.
      bid.changeOrders = [{
        id: 9600001, coNum: 1, date: _tdDemoDay(0),
        desc: 'Soffit rot found on the north side: replace two boards, prime and paint.',
        type: 'addition', amount: _TD_DEMO_CO, delta: _TD_DEMO_CO,
        originalAmount: _TD_DEMO_BASE, newAmount: total,
        overrun: null,
        lines: [{ desc: 'Replace & paint soffit boards', qty: 2, unit: 'ea', rate: 240, total: 480, notes: '' }],
        addedDays: 0, photos: [],
        signedAt: _tdDemoAt(0, 13, 5), signerName: 'Dana Whitfield', sigData: '',
      }];
    }
    // Invoiced means a completed, still-owing contract. There is no invoice
    // record in this app: the invoice is a rendering of exactly this state.
    if (has('invoice')) {
      bid.completion_date = _tdDemoDay(0);
      bid.completedAt = _tdDemoAt(0, 16, 40);
    }
    bids.push(bid);
  }

  if (has('schedule')) {
    jobs.push({
      id: _TD_DEMO_JOB, bid_id: _TD_DEMO_BID, client_id: _TD_DEMO_CLIENT,
      name: 'Dana Whitfield', addr: '1412 Oak Ridge Dr, Wichita, KS 67206',
      start: _tdDemoDay(has('onsite') ? 0 : 2),
      days: 3, buffer: 0,
      value: _TD_DEMO_BASE + (has('change') ? _TD_DEMO_CO : 0),
      color: '#2D5DA8',
      eventType: 'job',
      time: '08:00', hours: 0,
      notes: 'Ladders + sprayer. Gate code 4417.',
      status: has('invoice') ? 'done' : has('onsite') ? 'active' : 'upcoming',
      loggedAt: _tdDemoAt(-3, 16, 25),
      assignedTo: 'Andre Ruiz', crewHistory: ['Andre Ruiz'],
      actualHours: has('onsite') ? 7.8 : 0,
      completion_date: has('invoice') ? _tdDemoDay(0) : '',
    });
  }

  if (has('onsite')) {
    // open:false on every row, or the app reads someone as still clocked in.
    timeEntries.push({
      id: 9100001, job_id: _TD_DEMO_JOB, date: _tdDemoDay(0),
      start_time: _tdDemoAt(0, 7, 40), end_time: _tdDemoAt(0, 11, 55), minutes: 255,
      scope_id: null, scope_label: 'Prep & pressure wash',
      logged_by_uid: null, logged_by_name: 'Sample Owner', open: false,
    });
    timeEntries.push({
      id: 9100002, job_id: _TD_DEMO_JOB, date: _tdDemoDay(0),
      start_time: _tdDemoAt(0, 12, 35), end_time: _tdDemoAt(0, 16, 10), minutes: 215,
      scope_id: null, scope_label: 'Sand & spot-prime',
      logged_by_uid: 'demo-crew', logged_by_name: 'Andre Ruiz', open: false,
    });
    // An expense's job_id is the BID id, not the job id. The app's own writers
    // do this (js/finance.js, js/jobs.js) and the money screens rely on it.
    expenses.push({
      id: 9200001, date: _tdDemoDay(0),
      cat: 'materials', catLabel: 'Materials & Supplies',
      vendor: 'Sherwin-Williams #7043', amount: 412.66,
      notes: 'Exterior acrylic, 8 gal + sundries',
      loggedAt: _tdDemoAt(0, 8, 22), created_at: _tdDemoAt(0, 8, 22),
      job_id: _TD_DEMO_BID, job_name: 'Dana Whitfield', client_id: _TD_DEMO_CLIENT,
      receipt: 'Yes: photo stored', receipt_key: null, receipt_img: null,
      deductible: true, meals_50: false,
    });
    mileage.push({
      id: 9300001, date: _tdDemoDay(0), loggedAt: _tdDemoAt(0, 7, 30),
      vehicle: 'Work truck', vehicleId: null,
      from: '1820 NW Tyler St, Wichita, KS', from_name: 'Shop',
      to: '1412 Oak Ridge Dr, Wichita, KS 67206', to_name: 'Whitfield',
      start: 0, end: 0, miles: 14.2,
      purpose: 'Business', client_id: _TD_DEMO_CLIENT, client_name: 'Dana Whitfield',
      notes: '', created_at: _tdDemoAt(0, 7, 30), calc_method: 'route',
    });
  }

  // Money against the contract. Deposit and balance are the same record type,
  // told apart by `type`; a refund would be the same shape with a negative
  // amount. Nothing here goes in income[]: that ledger is for money with no
  // bid behind it, and double-booking would show the job twice.
  if (has('sign')) {
    payments.push({
      id: 9400001, bid_id: _TD_DEMO_BID, client_id: _TD_DEMO_CLIENT,
      client_name: 'Dana Whitfield',
      date: _tdDemoDay(-3), loggedAt: _tdDemoAt(-3, 16, 22),
      type: 'deposit', amount: _TD_DEMO_DEPOSIT, method: 'Card', ref: '',
    });
  }
  if (has('collect')) {
    payments.push({
      id: 9400002, bid_id: _TD_DEMO_BID, client_id: _TD_DEMO_CLIENT,
      client_name: 'Dana Whitfield',
      date: _tdDemoDay(0), loggedAt: _tdDemoAt(0, 17, 5),
      type: 'final', amount: (_TD_DEMO_BASE + _TD_DEMO_CO) - _TD_DEMO_DEPOSIT,
      method: 'Card', ref: '',
    });
  }
}

// Where each step looks. A stage shows the screen that step is about, and if
// that screen cannot open for any reason the demo falls back to the dashboard
// rather than showing a visitor a broken frame.
function _tdDemoShow(stage) {
  // Steps 2, 3 and 6 open a fixed full-screen overlay (openBidDetail) rather
  // than switching pages, so a step that does not clear it would be drawn
  // underneath the previous one.
  try {
    document.querySelectorAll('[data-bdov]').forEach(function (el) { el.remove(); });
    document.querySelectorAll('.zmodal-overlay').forEach(function (el) { el.remove(); });
  } catch (e) {}
  var go = function (pg) { try { if (typeof goPg === 'function') goPg(pg); } catch (e) {} };
  var clientDetail = function () {
    // renderClientDetail has to run before the navigation: goPg has no
    // dispatch entry for this page (js/navigation.js).
    try {
      window.currentClientId = _TD_DEMO_CLIENT;
      if (typeof renderClientDetail === 'function') renderClientDetail();
      go('pg-client-detail');
      return true;
    } catch (e) { return false; }
  };
  try {
    switch (stage) {
      case 'lead':
        if (clientDetail()) return;
        return go('pg-clients');
      case 'estimate':
      case 'sign':
      case 'change':
        if (typeof openBidDetail === 'function') { openBidDetail(_TD_DEMO_BID); return; }
        return go('pg-proposals');
      case 'schedule': return go('pg-cal');
      case 'onsite':
        // The log opens on "me", which hides the crew half of the day, and a
        // crew day is the point of this step. Its own setter, not the private
        // variable behind it: that lives in the module and an assignment from
        // out here is a silent no-op.
        go('pg-timelog');
        try { if (typeof setTimeLogScope === 'function') setTimeLogScope('team'); } catch (e) {}
        return;
      case 'invoice':
      case 'collect': return go('pg-money');
    }
  } catch (e) { /* fall through */ }
  go('pg-dash');
}

function _tdDemoRepaint() {
  var call = function (fn) { try { if (typeof window[fn] === 'function') window[fn](); } catch (e) {} };
  call('applySettings');
  call('applyBrandLogo');
  call('renderDash');
}

// Rebuild the whole demo at a step (1-8) and show that step's screen.
function tdDemoStage(step) {
  var n = Math.max(1, Math.min(8, parseInt(step, 10) || 1));
  var stage = _TD_DEMO_STAGES[n - 1];
  _tdDemoSeed(stage);
  _tdDemoRepaint();
  _tdDemoShow(stage);
  if (window.__TD_DEMO) window.__TD_DEMO.step = n;
  return stage;
}

// Boot. Called from index.html after loadAll(), which in demo mode has just
// read an empty sandboxed store, so there is nothing of anyone's to clear.
function tdDemoBoot() {
  if (!window.__TD_DEMO) return;
  document.documentElement.setAttribute('data-td-demo', '1');
  try { tdDemoStage(window.__TD_DEMO.step); }
  catch (e) { try { console.error('demo seed failed', e); } catch (e2) {} }
  // The boot overlay is there to cover a real sign-in. A demo waits for nothing.
  try { if (typeof _removeBootOverlay === 'function') _removeBootOverlay(true); } catch (e) {}
  var ov = document.getElementById('supa-boot-overlay');
  if (ov) ov.remove();
  try { document.getElementById('supa-login-overlay')?.remove(); } catch (e) {}

  // The walkthrough steers this frame from the marketing page instead of
  // reloading it, so stepping is instant. Same origin only: nothing off this
  // site can drive the demo.
  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin) return;
    var d = e.data;
    if (!d || d.td !== 'demo') return;
    tdDemoStage(d.step);
  });
  try { if (window.parent !== window) window.parent.postMessage({ td: 'demo-ready' }, location.origin); } catch (e) {}
}
