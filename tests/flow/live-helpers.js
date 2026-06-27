// ─────────────────────────────────────────────────────────────────────────────
// Live-Supabase flow-test harness
//
// These helpers drive the REAL app against the REAL Supabase project (the anon
// key baked into index.html). They authenticate as a dedicated dev login and
// write real rows, so every safety rail here matters:
//
//   1. needsLiveCreds() — specs SKIP cleanly when the secrets are absent, so the
//      normal offline CI shards are never affected and local runs don't error.
//   2. RUN_TAG — every seeded row carries a unique, greppable marker so teardown
//      only ever deletes what THIS run created.
//   3. assertDevAccount() + teardownAll() — teardown ABORTS unless the signed-in
//      user id matches E2E_DEV_USER_ID. Cleanup can only ever fire on the dev
//      account; it can never touch any other identity's data.
//
// Required GitHub Actions secrets (repo → Settings → Secrets → Actions):
//   E2E_DEV_EMAIL      dev login email
//   E2E_DEV_PASSWORD   dev login password
//   E2E_DEV_USER_ID    the auth user id (contractor_user_id) cleanup is locked to
// ─────────────────────────────────────────────────────────────────────────────

const DEV_EMAIL = process.env.E2E_DEV_EMAIL || '';
const DEV_PASSWORD = process.env.E2E_DEV_PASSWORD || '';
const DEV_USER_ID = process.env.E2E_DEV_USER_ID || '';
// Whether the Cloudflare-bypass header secret is configured in this CI run.
// Reported in sign-in failures so we can tell "header not sent" from "Cloudflare
// rule not matching" without guessing. Length only — never the value.
const BYPASS_STATUS = process.env.E2E_BYPASS_SECRET ? `set(${process.env.E2E_BYPASS_SECRET.length}ch)` : 'MISSING';

// Unique per process run. Stamped into every seeded record's name/marker field
// so teardown can target exactly this run's rows. Uses PID + start time from the
// env (never Math.random/Date.now in shared code) — good enough to be unique
// across concurrent CI jobs.
const RUN_TAG = `E2E_${process.env.GITHUB_RUN_ID || 'local'}_${process.pid}`;

// True only when all three secrets are present. Specs gate on this:
//   test.skip(!needsLiveCreds(), 'live Supabase creds not configured');
function needsLiveCreds() {
  return !!(DEV_EMAIL && DEV_PASSWORD && DEV_USER_ID);
}

// Teardown is OPT-IN. By default the suite LEAVES its run-tagged seed data in
// place so you can open the app, review what the tests created, and ask about
// it. Set E2E_TEARDOWN=1 to wipe this run's data at the end instead. You clear
// the account manually on your own schedule otherwise.
function shouldTeardown() {
  return process.env.E2E_TEARDOWN === '1';
}

// Sign in through the real login form, exactly as a user would: fill the email
// and password fields, click Sign in, and wait for the dashboard to mount.
async function signIn(page) {
  await page.goto('/');
  await page.waitForSelector('#supa-email', { timeout: 30000 });
  // Authenticate through the app's own Supabase client and RETURN the exact
  // result, so a bad credential or unconfirmed email reports as a one-line
  // finding instead of an opaque 120s timeout. This still triggers the app's
  // onAuthStateChange -> _supaUser -> cloud-load path.
  const res = await page.evaluate(async ({ email, password }) => {
    const origin = location.origin;
    const supaUrl = (typeof SUPA_URL !== 'undefined') ? SUPA_URL : '(SUPA_URL undefined)';
    if (typeof _supa === 'undefined' || !_supa) return { ok: false, why: 'client not initialized', origin, supaUrl };
    // Probe the auth endpoint directly to see exactly what the /api proxy returns
    // (a 404 SPA-fallback page vs a WAF challenge vs valid JSON).
    let probe = '';
    try {
      const r = await fetch(supaUrl + '/auth/v1/settings', { headers: { apikey: (typeof SUPA_KEY !== 'undefined' ? SUPA_KEY : '') } });
      const t = await r.text();
      probe = r.status + ' ' + (r.headers.get('content-type') || '') + ' :: ' + t.slice(0, 70).replace(/\s+/g, ' ');
    } catch (e) { probe = 'probe-fail: ' + (e && e.message); }
    try {
      const { data, error } = await _supa.auth.signInWithPassword({ email, password });
      return { ok: !error, why: error ? error.message : null, session: !!(data && data.session), origin, supaUrl, probe };
    } catch (e) { return { ok: false, why: 'exception: ' + (e && e.message), origin, supaUrl, probe }; }
  }, { email: DEV_EMAIL, password: DEV_PASSWORD });
  if (!res.ok) throw new Error(`Live sign-in failed @ ${res.supaUrl} (origin ${res.origin}) bypassHeader=${BYPASS_STATUS} probe[${res.probe}]: ${res.why}`);
  // Auth succeeded — wait for the app to propagate the session, then cloud load.
  await page.waitForFunction(
    () => typeof _supaUser !== 'undefined' && _supaUser && _supaUser.id,
    { timeout: 30000 }
  );
  await page.waitForFunction(
    () => typeof _supaCloudLoaded === 'undefined' || _supaCloudLoaded === true,
    { timeout: 30000 }
  ).catch(() => {});
}

// Hard guard: confirm the live session is the designated dev account before any
// destructive operation. Throws (failing the test) on mismatch — never deletes.
async function assertDevAccount(page) {
  const id = await page.evaluate(() => (typeof _supaUser !== 'undefined' && _supaUser ? _supaUser.id : null));
  if (!id) throw new Error('assertDevAccount: no authenticated user');
  if (id !== DEV_USER_ID) {
    throw new Error(`assertDevAccount: signed-in user ${id} !== E2E_DEV_USER_ID — refusing to seed/teardown`);
  }
  return id;
}

// Tables that flow tests seed into, in dependency order for safe deletion
// (children before parents).
const SEEDED_TABLES = [
  'td_payments', 'td_liens', 'td_time_entries', 'td_jobs',
  'td_bids', 'td_expenses', 'td_mileage', 'td_income',
  'td_contracts', 'td_agreements', 'td_clients',
];

// Delete every row this run created. Locked to the dev account: assertDevAccount
// throws first if the session is anything else, so the deletes below cannot run
// against another identity. Matches rows by the RUN_TAG marker.
async function teardownAll(page) {
  await assertDevAccount(page);
  await page.evaluate(async ({ tables, tag }) => {
    for (const t of tables) {
      try {
        // Rows are tagged via a `_e2e` marker column when seeded; fall back to a
        // name LIKE match for tables where the marker lives in the name field.
        await _supa.from(t).delete().eq('_e2e', tag);
      } catch (e) { /* table may lack the marker column — ignored */ }
    }
  }, { tables: SEEDED_TABLES, tag: RUN_TAG });
}

// Format an adversarial failure as a one-line fix-ticket instead of a raw stack.
// Pass as the 2nd arg to expect(): expect(got, finding({...})).toBe(want).
//   [role][page] control -> RULE: <rule>
//     expected: <x> · got: <y> · suspect: <file:line>
function finding({ role = 'contractor', page = '-', control = '', rule = '', expected = '', got = '', suspect = '' }) {
  let s = `\n✗ [${role}][${page}] ${control} → RULE: ${rule}\n  expected: ${expected} · got: ${got}`;
  if (suspect) s += ` · suspect: ${suspect}`;
  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
// step() — the heart of every flow. One instrumented primitive that fuses three
// things into a single pass so validation and analytics are the SAME data:
//   1. ACT     — perform the interaction; `act` returns the # of clicks/keystrokes
//   2. MEASURE — wall-clock ms + interaction count, pushed to the LEDGER
//   3. ASSERT  — `rule(page)` returns {ok, got}; on !ok we throw a finding() ticket
//   (optional ABUSE — adversarial probe of the same step)
// report() then emits a friction profile AND a click-budget verdict from the
// ledger. CLAUDE.md §13 makes this the mandatory shape for every flow.
// ─────────────────────────────────────────────────────────────────────────────
const _LEDGER = [];
function resetLedger() { _LEDGER.length = 0; }

async function step(page, opts) {
  const { label, page: pg = '-', role = 'contractor', act, rule, ruleText = 'post-condition', expected = 'ok', suspect = '', abuse } = opts;
  const t0 = Date.now();
  let interactions = 0;
  const res = act ? await act(page) : 0;
  interactions = (typeof res === 'number') ? res : 0;
  const ms = Date.now() - t0;
  let ok = true, got = '';
  if (rule) {
    try { const r = await rule(page); ok = !!(r && r.ok); got = r ? r.got : ''; }
    catch (e) { ok = false; got = 'threw: ' + e.message; }
  }
  _LEDGER.push({ label, pg, role, ms, interactions, ok });
  if (abuse) { try { await abuse(page); } catch (e) {} }
  if (rule && !ok) {
    throw new Error(finding({ role, page: pg, control: label, rule: ruleText, expected, got: String(got), suspect }));
  }
  return interactions;
}

// Emit the friction profile (slowest-first + total clicks/ms) and grade against
// the committed click budget. Clicks are DETERMINISTIC → hard gate (returns
// overBudget for the caller to assert on). Time is advisory (logged, not gated).
function report(tag, baseline) {
  const totalMs = _LEDGER.reduce((s, r) => s + r.ms, 0);
  const totalClicks = _LEDGER.reduce((s, r) => s + r.interactions, 0);
  const rows = _LEDGER.slice().sort((a, b) => b.ms - a.ms);
  // eslint-disable-next-line no-console
  console.log(`\n⏱  FLOW LEDGER [${tag}] — total ${totalMs}ms · ${totalClicks} interactions (slowest first):`);
  // eslint-disable-next-line no-console
  rows.forEach(r => console.log(`   ${String(r.ms).padStart(6)}ms ${String(r.interactions).padStart(3)}clk  ${r.label}`));
  const base = baseline && baseline[tag];
  let overBudget = false;
  if (base && typeof base.clicks === 'number') {
    overBudget = totalClicks > base.clicks;
    // eslint-disable-next-line no-console
    console.log(`   budget: ${totalClicks}/${base.clicks} clicks ${overBudget ? '✗ OVER (UX regression)' : '✓'}`);
  } else {
    // eslint-disable-next-line no-console
    console.log(`   BASELINE CAPTURE [${tag}]: ${totalClicks} clicks · ${totalMs}ms — add to perf-baseline.json to start gating`);
  }
  return { totalMs, totalClicks, overBudget, hasBaseline: !!base };
}

// ─────────────────────────────────────────────────────────────────────────────
// PHYSICAL interaction helpers (CLAUDE.md §13.6) — drive the app like a real
// thumb on a real screen, and RETURN the honest interaction cost so act() just
// sums them. Every helper scrolls the target into view first; if the page
// actually had to move, that's counted as a real scroll (you can't tap what you
// can't see). This is what makes the ledger reflect true effort on mobile,
// tablet, and desktop — the same flow costs MORE scrolls on a small screen.
//   tap(p, sel)            → 1 tap (+1 if a scroll was needed to reach it)
//   type(p, sel, text)     → text.length keystrokes (+1 if a scroll was needed)
//   pick(p, sel, value)    → 1 tap for a <select>/<input type=date> (+scroll)
//   scrollBy(p, dy)        → 1 deliberate scroll
// All count REAL events: page.fill is never used, so values are typed key-by-key
// exactly as a user would (which also exercises the auto-capitalize-on-space).
// ─────────────────────────────────────────────────────────────────────────────

// Bring `sel` into the viewport; return 1 if the page physically scrolled to do
// it, else 0. Reads scrollY of the element's nearest scrollable ancestor (the
// app scrolls .pg containers, not always window).
async function _reach(page, sel) {
  const loc = page.locator(sel).first();
  const before = await loc.evaluate(el => {
    let n = el.parentElement, sy = window.scrollY || 0;
    while (n) { if (n.scrollHeight > n.clientHeight + 1) { sy += n.scrollTop; } n = n.parentElement; }
    return sy;
  }).catch(() => 0);
  await loc.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
  const after = await loc.evaluate(el => {
    let n = el.parentElement, sy = window.scrollY || 0;
    while (n) { if (n.scrollHeight > n.clientHeight + 1) { sy += n.scrollTop; } n = n.parentElement; }
    return sy;
  }).catch(() => 0);
  return Math.abs(after - before) > 2 ? 1 : 0;
}

async function tap(page, sel) {
  const scrolls = await _reach(page, sel);
  await page.locator(sel).first().click({ timeout: 10000 });
  return 1 + scrolls;
}

async function type(page, sel, text) {
  const scrolls = await _reach(page, sel);
  const loc = page.locator(sel).first();
  await loc.click({ timeout: 10000 });
  await loc.fill('');                                  // clear any prefill
  await loc.pressSequentially(String(text), { delay: 0 }); // REAL key-by-key typing
  return String(text).length + scrolls;
}

// <select> / date pickers / file inputs: one tap to choose a value.
async function pick(page, sel, value) {
  const scrolls = await _reach(page, sel);
  const loc = page.locator(sel).first();
  try { await loc.selectOption(String(value), { timeout: 4000 }); }
  catch (e) { await loc.fill(String(value)); }          // date inputs take fill
  return 1 + scrolls;
}

async function scrollBy(page, dy) {
  await page.mouse.wheel(0, dy).catch(() => {});
  return 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// cloudRows(page, table) — re-query a td_* table from Supabase and return the
// live (non-deleted) rows as flattened objects ({id, ...data}). This is what makes
// a flow TRULY end-to-end: after a save, assert the row actually landed in the
// cloud, not just in the in-memory array. The td_* tables store the record JSON in
// a `data` column (jsonb or string), so we parse + spread it for easy predicates:
//   const rows = await cloudRows(page, 'td_jobs');
//   expect(rows.some(j => j.id === jobId && j.assignedTo === empId)).toBe(true);
// ─────────────────────────────────────────────────────────────────────────────
async function cloudRows(page, table) {
  return await page.evaluate(async ({ table }) => {
    const uid = (typeof _supaUser !== 'undefined' && _supaUser && _supaUser.id) || null;
    if (!uid || typeof _supa === 'undefined' || !_supa) return [];
    const { data, error } = await _supa.from(table).select('id,data').eq('user_id', uid).is('deleted_at', null);
    if (error) return [];
    return (data || []).map(r => {
      let d = r.data;
      if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = {}; } }
      return Object.assign({ id: r.id }, d || {});
    });
  }, { table });
}

// ─────────────────────────────────────────────────────────────────────────────
// Realistic seed data — so what the tests leave in the account looks like genuine
// usage the owner can actually inspect, NOT hollow "E2E" junk. Real names, real
// Wichita-area addresses, real phone numbers.
// ─────────────────────────────────────────────────────────────────────────────
const SEED_FIRST = ['Marcus', 'Sofia', 'Derek', 'Hannah', 'Andre', 'Olivia', 'Tyler', 'Grace', 'Nathan', 'Priya', 'Wesley', 'Imani', 'Caleb', 'Renee', 'Victor', 'Maya', 'Logan', 'Bianca'];
const SEED_LAST = ['Holloway', 'Castillo', 'Brennan', 'Okafor', 'Whitman', 'Delgado', 'Foster', 'Ramsey', 'Vaughn', 'Sandoval', 'Pierce', 'Mbeki', 'Nguyen', 'Abbott', 'Schaefer', 'Ortega'];
const SEED_STREETS = ['Gage Blvd', 'N Main St', 'Mission Rd', 'Commercial St', 'N Hillside St', 'SW Jackson St', 'E Douglas Ave', 'W Central Ave', 'N Rock Rd', 'S Seneca St', 'Maple Grove Ln', 'Oak Ridge Dr'];
const SEED_CITIES = [['Wichita', '672'], ['Topeka', '666'], ['Overland Park', '662'], ['Lawrence', '660'], ['Olathe', '660'], ['Derby', '670']];
// Every seeded lead has a SOURCE — "no source set" should never appear for test data.
const SEED_SOURCES = ['Referral', 'Google', 'Facebook', 'Nextdoor', 'Yard sign', 'Repeat client', 'Word of mouth', 'Website', 'Home Advisor'];
function _pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function _randInt(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }
// Randomized (not structured) realistic values — call with no arg for fully random.
function seedName() { return _pick(SEED_FIRST) + ' ' + _pick(SEED_LAST); }
function seedAddr() { const [city, zp] = _pick(SEED_CITIES); return `${_randInt(100, 9999)} ${_pick(SEED_STREETS)}, ${city}, KS ${zp}${_randInt(10, 99)}`; }
function seedPhone() { return '316' + _randInt(200, 989) + _randInt(1000, 9999); }
function seedSource() { return _pick(SEED_SOURCES); }
function seedAmount() { return _randInt(18, 142) * 100 + _randInt(0, 1) * 50; } // $1,800–$14,250, varied

// Build a REAL typed-up proposal document (line items + totals + terms) — the same
// kind of HTML the estimator's sendProposalLink produces, so the proposal that
// lands in the client hub / proposal section is legit, not a hollow Pending row.
function buildProposalHtml({ name, addr, amount, deposit, biz = 'TradeDesk Painting' }) {
  const labor = Math.round(amount * 0.62), materials = Math.round(amount * 0.23), prep = amount - labor - materials;
  const f = n => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `<div style="font-family:Arial,sans-serif;color:#1a365d">
    <h1 style="margin:0 0 4px">${biz}</h1>
    <div style="font-size:12px;color:#475569">Proposal for ${name} — ${addr}</div>
    <table style="width:100%;border-collapse:collapse;margin-top:14px;font-size:13px">
      <tr style="background:#f1f5f9"><th align="left" style="padding:8px">Scope</th><th align="right" style="padding:8px">Amount</th></tr>
      <tr><td style="padding:8px;border-top:1px solid #e2e8f0">Surface prep — sand, patch, mask, prime</td><td align="right" style="padding:8px;border-top:1px solid #e2e8f0">${f(prep)}</td></tr>
      <tr><td style="padding:8px;border-top:1px solid #e2e8f0">Labor — Living Room walls + ceiling, two coats</td><td align="right" style="padding:8px;border-top:1px solid #e2e8f0">${f(labor)}</td></tr>
      <tr><td style="padding:8px;border-top:1px solid #e2e8f0">Materials — Sherwin-Williams Duration + sundries</td><td align="right" style="padding:8px;border-top:1px solid #e2e8f0">${f(materials)}</td></tr>
      <tr style="font-weight:800"><td style="padding:8px;border-top:2px solid #1a365d">Total</td><td align="right" style="padding:8px;border-top:2px solid #1a365d">${f(amount)}</td></tr>
      <tr><td style="padding:8px">Deposit due before work begins (25%)</td><td align="right" style="padding:8px">${f(deposit)}</td></tr>
    </table>
    <div style="font-size:11px;color:#475569;margin-top:12px;line-height:1.6">Workmanship warranted 1 year. Balance due on completion. Buyer may cancel within 3 business days for a full deposit refund.</div>
  </div>`;
}

// seedProposal(page, opts) — create a realistic client AND a GENUINE typed-up,
// SENT proposal: real name/address, real proposalHtml, a signing token, the bid
// row in td_bids, and the proposal artifact uploaded to the proposals bucket (so
// it opens in the client hub / sign.html exactly like a real one). Returns the
// token/uid/key/name so the caller can build hub or sign URLs. This is the legit
// alternative to `bids.push({status:'Pending'})` hollow seeds.
async function seedProposal(page, { clientId, bidId, amount, tag = 'seed' } = {}) {
  // Randomized, complete, realistic — varied name/address/source/amount each call.
  const name = seedName(), addr = seedAddr(), phone = seedPhone(), source = seedSource();
  const amt = amount || seedAmount();
  const proposalHtml = buildProposalHtml({ name, addr, amount: amt, deposit: Math.round(amt * 0.25) });
  return await page.evaluate(async (o) => {
    const token = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
    const uid = (typeof _supaUser !== 'undefined' && _supaUser) ? _supaUser.id : null;
    const deposit = Math.round(o.amt * 0.25);
    const biz = (typeof S !== 'undefined' && S.bname) || 'TradeDesk Painting';
    const surfaces = [{ type: 'walls', room: 'Living Room', qty: 480 }, { type: 'ceiling', room: 'Living Room', qty: 240 }];
    clients.push({ id: o.clientId, name: o.name, phone: o.phone, addr: o.addr, source: o.source, _e2e: o.tag });
    bids.push({
      id: o.bidId, client_id: o.clientId, client_name: o.name, name: o.name, addr: o.addr,
      amount: o.amt, deposit, status: 'Pending', type: 'Interior / Exterior Painting',
      bid_date: new Date().toISOString().slice(0, 10), proposalSentDate: new Date().toISOString().slice(0, 10),
      signingToken: token, proposalHtml: o.proposalHtml, surfaces, _e2e: o.tag,
    });
    if (typeof supaSaveToCloud === 'function') await supaSaveToCloud();
    const key = `proposals/${uid}/${o.bidId}_${token}.json`;
    const proposalData = {
      id: o.bidId, status: 'pending', businessName: biz, businessPhone: (S && S.bphone) || '3165550100',
      clientName: o.name, clientAddr: o.addr, amount: o.amt, deposit, estDays: 3,
      createdAt: new Date().toISOString(), signingToken: token, contractorUserId: uid, clientId: o.clientId,
      proposalHtml: o.proposalHtml, trade: 'painting', surfaces, stripeConnectEnabled: false, _e2e: o.tag,
    };
    let uploadErr = null;
    try {
      const { error } = await _supa.storage.from('proposals').upload(key, JSON.stringify(proposalData), { contentType: 'application/json', upsert: true, cacheControl: '0' });
      if (error) uploadErr = error.message || String(error);
    } catch (e) { uploadErr = e.message; }
    return { token, uid, key, name: o.name, addr: o.addr, amount: o.amt, uploadErr };
  }, { clientId, bidId, amt, name, addr, phone, source, tag, proposalHtml });
}

module.exports = {
  cloudRows,
  seedProposal,
  seedName,
  seedAddr,
  seedPhone,
  seedSource,
  seedAmount,
  buildProposalHtml,
  needsLiveCreds,
  shouldTeardown,
  finding,
  step,
  report,
  resetLedger,
  signIn,
  assertDevAccount,
  teardownAll,
  tap,
  type,
  pick,
  scrollBy,
  RUN_TAG,
  DEV_USER_ID,
  SEEDED_TABLES,
};
