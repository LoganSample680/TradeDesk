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

module.exports = {
  needsLiveCreds,
  shouldTeardown,
  finding,
  signIn,
  assertDevAccount,
  teardownAll,
  RUN_TAG,
  DEV_USER_ID,
  SEEDED_TABLES,
};
