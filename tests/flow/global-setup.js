// ─────────────────────────────────────────────────────────────────────────────
// Playwright globalSetup — LOCAL-STACK per-worker account provisioning.
//
// GATED ENTIRELY behind E2E_LOCAL_STACK==='1'. When the flag is unset (the cloud
// path — today's default), this is a pure no-op: it returns immediately, touches
// no network, writes no files, and cannot change cloud-suite behavior.
//
// WHY: each Playwright worker must own its OWN account so no two workers ever share
// a user_id (which the app's realtime sync + soft-delete sweep would otherwise let
// clobber each other). CLOUD mode has exactly two real dev accounts (Dev A / Dev B),
// so it caps at 2 workers. LOCAL-STACK mode has no such cap: here we provision a
// DISTINCT auth user per worker (e2e+w0@…, e2e+w1@…, …) so the suite can fan out to
// 6 workers. Distinct user_id per worker = full isolation, in both modes.
//
// LOCAL STACK:
//   API:    http://127.0.0.1:54321 (fixed local default)
//   secret: the service_role/secret key — read from env SUPABASE_LOCAL_KEY.
//           NEVER hardcoded: GitHub secret-scanning rightly blocks committing an
//           sb_secret_… literal (even a local-dev default). The workflow injects it.
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const LOCAL_API = process.env.SUPABASE_UPSTREAM || 'http://127.0.0.1:54321';
const LOCAL_SECRET = process.env.SUPABASE_LOCAL_KEY || '';
const ACCOUNTS_FILE = path.join(__dirname, '.local-accounts.json');
// Bare CREW auth users (no contractor graph) — the crew-convergence spec links them
// to a worker contractor at runtime, exercising the real invite/claim paths.
const CREW_FILE = path.join(__dirname, '.local-crew.json');
const CREW_N = Math.max(2, parseInt(process.env.E2E_CREW_N || '6', 10));

// Best-effort read of the configured worker count from the flow config, so the
// pool always covers every parallelIndex. Falls back to 3 on any parse trouble.
function readWorkerCount() {
  try {
    const txt = fs.readFileSync(path.join(__dirname, '..', '..', 'playwright.flow.config.js'), 'utf8');
    // matches: workers: process.env.E2E_LOCAL_STACK ? 6 : 2  (captures 6, the local count)
    //      OR: workers: isCI ? 3 : 1   OR   workers: 4
    const m = txt.match(/workers:\s*[^,\n]*?(\d+)\s*:\s*\d+/) || txt.match(/workers:\s*(\d+)/);
    if (m) { const n = parseInt(m[1], 10); if (n > 0) return n; }
  } catch (e) { /* fall through to default */ }
  return 3;
}

// Seed a minimal zj_data row for a provisioned account so it behaves like a real
// ONBOARDED contractor. Without it, a bare auth user (no users/accounts/zj_data row)
// makes the app's loadAccountData() return false → supaLoadFromCloud() is skipped →
// _supaCloudLoaded never becomes true → supaSaveToCloud() silently no-ops (cloud.js
// guard). In-memory specs don't notice, but any cloud round-trip (e.g. the
// settings-survive-reboot spec) sees the cloud come back empty. A zj_data row hits
// loadAccountData()'s "pre-schema solo contractor" branch → returns true → cloud load
// runs → saves persist. Idempotent upsert; LOCAL-STACK only.
// Idempotent PostgREST upsert via the service key (bypasses RLS — only FKs/NOT-NULLs matter).
async function _seedUpsert(table, body, onConflict) {
  try {
    const r = await fetch(`${LOCAL_API}/rest/v1/${table}?on_conflict=${onConflict}`, {
      method: 'POST',
      headers: {
        apikey: LOCAL_SECRET,
        Authorization: 'Bearer ' + LOCAL_SECRET,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(body),
    });
    if (!(r.status >= 200 && r.status < 300)) {
      console.log(`[global-setup] seed ${table} for ${body.user_id || body.id || body.contractor_user_id}: ${r.status} ${(await r.text().catch(() => '')).slice(0, 140)}`);
    }
  } catch (e) {
    console.log(`[global-setup] seed ${table}: error ${e && e.message}`);
  }
}

// Provision a FULLY-ONBOARDED contractor account so the local stack mirrors the established
// cloud Dev A/B accounts. A bare auth user (or a zj_data-only seed) makes loadAccountData()
// miss the full-contractor branch → _account null (intake-lead skips), first-time banners
// pop, and the redaction RPC has no employee to authorize. This seeds the exact rows real
// onboarding creates: accounts → users(account_id) → account_users → account_config →
// vehicles → zj_data(with myRates so no first-time banner) → team_members (one employee,
// sourced from the NEXT pool account so cross-account/redaction tests have a real link).
// FK order matters: accounts first; team_members needs both uids to be real auth users
// (hence the two-pass provisioning in module.exports — all auth users created before any seed).
async function seedAccountData(acct, emp, i) {
  const uid = acct.uid;
  const accountId = uid;                 // account id == owner uid → deterministic + idempotent
  const now = new Date().toISOString();
  const settings = JSON.stringify({
    bname: `E2E Worker ${i} Painting`, bphone: '3165551000', blic: `KS-LIC-00${i}`, state: 'KS',
    goalMonthly: 20000,
    // Non-empty myRates suppresses the "Showing market averages" first-time banner
    // (generic-estimate.js firstTimeBanner: !S.myRates || !Object.keys(S.myRates).length).
    myRates: { int_walls: { labor: 2.25, mat: 0 }, int_ceiling: { labor: 1.75, mat: 0 }, ext_siding: { labor: 2.5, mat: 0 } },
  });
  await _seedUpsert('accounts', { id: accountId, business_name: `E2E Worker ${i} Painting`, phone: '3165551000', email: acct.email, address: '742 Evergreen Terrace, Wichita, KS 67202', state: 'KS', license_info: `KS-LIC-00${i}`, owner_id: uid }, 'id');
  await _seedUpsert('users', { id: uid, email: acct.email, name: `E2E Owner ${i}`, role: 'owner', account_id: accountId, business_type: 'painting' }, 'id');
  await _seedUpsert('account_users', { account_id: accountId, user_id: uid, role: 'owner' }, 'account_id,user_id');
  await _seedUpsert('account_config', { account_id: accountId, business_type: 'painting', default_job_type: 'estimate', require_estimate: true, require_deposit: true, allow_full_payment: false, show_schedule: true, state: 'KS' }, 'account_id');
  await _seedUpsert('vehicles', { id: uid, account_id: accountId, name: 'Work Truck', type: 'truck', odometer_start: 0 }, 'id');
  await _seedUpsert('zj_data', { user_id: uid, account_id: accountId, settings, updated_at: now }, 'user_id');
  if (emp && emp.uid && emp.uid !== uid) {
    await _seedUpsert('team_members', {
      contractor_user_id: uid, employee_user_id: emp.uid, name: `E2E Tech ${i}`, email: emp.email, role: 'tech',
      // RPC redaction keys: financials/estimate false → bid/income amounts redact to 0 for this employee.
      permissions: { collect: true, expenses: true, mileage: true, estimate: false, financials: false, schedule: false, clients: false, leads: false, team: false, payroll: false },
      active: true, joined_at: now,
    }, 'contractor_user_id,email');
  }
}

// Find an existing user's id by email via the admin list endpoint (used when the
// create call reports the account already exists).
async function findExistingUid(email) {
  try {
    const r = await fetch(`${LOCAL_API}/auth/v1/admin/users?per_page=1000`, {
      headers: { apikey: LOCAL_SECRET, Authorization: 'Bearer ' + LOCAL_SECRET },
    });
    if (!r.ok) return null;
    const body = await r.json();
    const users = Array.isArray(body) ? body : (body.users || []);
    const hit = users.find(u => u && u.email && u.email.toLowerCase() === email.toLowerCase());
    return hit ? hit.id : null;
  } catch (e) { return null; }
}

module.exports = async () => {
  // ── FLAG OFF → exact same behavior as before this file existed. ──
  if (process.env.E2E_LOCAL_STACK !== '1') return;

  if (!LOCAL_SECRET) {
    throw new Error('[global-setup] E2E_LOCAL_STACK=1 but SUPABASE_LOCAL_KEY is unset. ' +
      'Set the local sb_secret_… service_role key as the SUPABASE_LOCAL_KEY GitHub Actions secret.');
  }

  const workers = readWorkerCount();
  // Provision a few extra so parseInt(parallelIndex) always maps into the pool.
  const count = Math.max(workers, 3) + 1;
  const accounts = [];

  for (let i = 0; i < count; i++) {
    const email = `e2e+w${i}@tradedesk.local`;
    const password = `Test-Passw0rd-${i}!`;
    let uid = null;
    try {
      const r = await fetch(`${LOCAL_API}/auth/v1/admin/users`, {
        method: 'POST',
        headers: {
          apikey: LOCAL_SECRET,
          Authorization: 'Bearer ' + LOCAL_SECRET,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password, email_confirm: true }),
      });
      if (r.status === 200 || r.status === 201) {
        const data = await r.json();
        uid = data && (data.id || (data.user && data.user.id)) || null;
      } else {
        // 422 "email already been registered" (or any conflict) → look it up.
        const txt = await r.text().catch(() => '');
        if (/registered|already|exists|422|duplicate/i.test(txt) || r.status === 422) {
          uid = await findExistingUid(email);
        }
        if (!uid) {
          // last-ditch: maybe it WAS created but body shape was unexpected.
          uid = await findExistingUid(email);
        }
        if (!uid) console.log(`[global-setup] account ${email}: create returned ${r.status} ${txt.slice(0, 120)}`);
      }
    } catch (e) {
      console.log(`[global-setup] account ${email}: error ${e && e.message}`);
    }
    if (uid) accounts.push({ email, password, uid });
  }

  if (accounts.length === 0) {
    throw new Error('[global-setup] LOCAL STACK: provisioned ZERO accounts — is the local Supabase stack up at ' + LOCAL_API + '?');
  }

  // SECOND PASS — now that every auth user exists, seed each as a FULLY-ONBOARDED
  // contractor, using the NEXT pool account as its linked employee (team_members needs
  // both uids to be real auth users, which they now are). This makes each local account
  // mirror an established cloud Dev A/B account: full accounts/users graph, rates set
  // (no first-time banners), and a real employee for the redaction RPC path.
  for (let i = 0; i < accounts.length; i++) {
    await seedAccountData(accounts[i], accounts[(i + 1) % accounts.length], i);
  }

  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
  console.log(`[global-setup] LOCAL STACK: provisioned ${accounts.length}/${count} per-worker accounts → ${path.basename(ACCOUNTS_FILE)}`);

  // ── CREW POOL — bare auth users (deliberately NO contractor graph: no users/
  // accounts/zj_data rows), so signing one in exercises the REAL crew-linking paths
  // (token claim / email match) instead of the owner branch. The crew-convergence
  // spec links them to a worker contractor at runtime. Failures are non-fatal: the
  // spec soft-skips when the crew pool is short.
  const crew = [];
  for (let i = 0; i < CREW_N; i++) {
    const email = `e2e+crew${i}@tradedesk.local`;
    const password = `Crew-Passw0rd-${i}!`;
    let uid = null;
    try {
      const r = await fetch(`${LOCAL_API}/auth/v1/admin/users`, {
        method: 'POST',
        headers: { apikey: LOCAL_SECRET, Authorization: 'Bearer ' + LOCAL_SECRET, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, email_confirm: true }),
      });
      if (r.status === 200 || r.status === 201) {
        const data = await r.json();
        uid = data && (data.id || (data.user && data.user.id)) || null;
      } else {
        uid = await findExistingUid(email);
      }
    } catch (e) { /* soft */ }
    if (uid) crew.push({ email, password, uid });
  }
  fs.writeFileSync(CREW_FILE, JSON.stringify(crew, null, 2));
  console.log(`[global-setup] LOCAL STACK: provisioned ${crew.length}/${CREW_N} crew accounts → ${path.basename(CREW_FILE)}`);
};
