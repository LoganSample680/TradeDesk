// ─────────────────────────────────────────────────────────────────────────────
// Playwright globalSetup — LOCAL-STACK per-worker account provisioning.
//
// GATED ENTIRELY behind E2E_LOCAL_STACK==='1'. When the flag is unset (the cloud
// path — today's default), this is a pure no-op: it returns immediately, touches
// no network, writes no files, and cannot change cloud-suite behavior.
//
// WHY: the cloud suite runs 3 Playwright workers against ONE shared Supabase
// account. The app's realtime sync + soft-delete sweep let those workers clobber
// each other (~6 flaky failures) and the channel storm overloads the runner.
// Against the LOCAL Supabase stack we instead provision a DISTINCT auth user per
// worker (e2e+w0@…, e2e+w1@…, …). Distinct user_id per worker = full isolation.
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

// Best-effort read of the configured worker count from the flow config, so the
// pool always covers every parallelIndex. Falls back to 3 on any parse trouble.
function readWorkerCount() {
  try {
    const txt = fs.readFileSync(path.join(__dirname, '..', '..', 'playwright.flow.config.js'), 'utf8');
    // matches: workers: isCI ? 3 : 1   OR   workers: 4
    const m = txt.match(/workers:\s*[^,\n]*?(\d+)\s*:\s*\d+/) || txt.match(/workers:\s*(\d+)/);
    if (m) { const n = parseInt(m[1], 10); if (n > 0) return n; }
  } catch (e) { /* fall through to default */ }
  return 3;
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

  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
  console.log(`[global-setup] LOCAL STACK: provisioned ${accounts.length}/${count} per-worker accounts → ${path.basename(ACCOUNTS_FILE)}`);
};
