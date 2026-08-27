#!/usr/bin/env node
// Spin up ONE confirmed Supabase test user from the terminal, seed it as a
// fully-onboarded contractor account (no first-run banners), then immediately
// open the live flow suite (tests/flow) in Playwright's interactive UI mode
// signed in as that user, so you can watch a test route through the real app
// live instead of digging through a headless report.
//
// Local dev convenience only. Never wired into CI, never touches the offline
// shards (playwright.config.js), and creates a throwaway account, not one of
// the shared E2E_DEV_*/E2E_DEV2_* dev logins.
//
// Reuses the exact admin-REST shape tests/flow/global-setup.js already uses
// for LOCAL_STACK pool provisioning (plain fetch to /auth/v1/admin/users,
// same seeded-row shape via seedAccountData there), kept as a parallel
// implementation rather than imported since that file's provisioning is
// gated behind E2E_LOCAL_STACK's pool logic and this is a single on-demand
// user with its own lifecycle.
//
// REQUIRED, from your shell env, never hardcoded, never committed:
//   SUPABASE_URL                 your Supabase project URL. Point this at
//                                 whatever project the app under test
//                                 actually talks to (Dev Supabase, most
//                                 likely) — a fully local `supabase start`
//                                 instance only helps if the APP itself is
//                                 also pointed there, which is a separate,
//                                 more involved setup (see
//                                 scripts/setup-local-test-stack.sh).
//   SUPABASE_SERVICE_ROLE_KEY    the project's service_role/secret key
//                                 (SUPABASE_SERVICE_KEY also accepted, the
//                                 name scripts/update-tax-rates.js uses).
//
// USAGE:
//   npm run test:user
//   npm run test:user -- --email you+scratch@tradedesk.local
//   npm run test:user -- --grep "estimate-build"   # scope the UI list
//   npm run test:user -- --no-ui                   # just create + print creds
'use strict';

const { spawn } = require('child_process');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';

function die(msg) { console.error('\n✗ ' + msg + '\n'); process.exit(1); }

if (!SUPABASE_URL) die('SUPABASE_URL is not set. Export it in your shell (your Dev Supabase project URL, e.g. https://<ref>.supabase.co).');
if (!SERVICE_KEY) die('SUPABASE_SERVICE_ROLE_KEY is not set. Never hardcode this key anywhere, export it in your shell before running this script.');

const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
const has = (name) => args.includes('--' + name);

const stamp = Date.now();
const email = flag('email', `local+${stamp}@tradedesk.local`);
const password = flag('password', `Test-Passw0rd-${stamp}!`);

async function createUser() {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const body = await r.json().catch(() => ({}));
  if (!(r.status === 200 || r.status === 201)) {
    throw new Error(`create user failed (${r.status}): ${JSON.stringify(body).slice(0, 300)}`);
  }
  const uid = body.id || (body.user && body.user.id);
  if (!uid) throw new Error('create user succeeded but no id came back: ' + JSON.stringify(body).slice(0, 300));
  return uid;
}

// Idempotent PostgREST upsert via the service key (bypasses RLS, only FKs /
// NOT-NULLs matter). Same call shape as global-setup.js's _seedUpsert.
async function seedUpsert(table, row, onConflict) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(row),
  });
  if (!(r.status >= 200 && r.status < 300)) {
    console.warn(`  (seed ${table} → ${r.status}: ${(await r.text().catch(() => '')).slice(0, 140)})`);
  }
}

// Mirrors global-setup.js's seedAccountData: a bare auth user makes
// loadAccountData() miss the full-contractor branch (first-run banners pop,
// zero rates), so seed the same accounts/users/account_users/account_config/
// vehicles/zj_data graph real onboarding creates. account id == owner uid,
// deterministic + idempotent, matching that file's convention.
async function seedOnboardedAccount(uid) {
  const now = new Date().toISOString();
  const settings = JSON.stringify({
    bname: 'Scratch Test Co', bphone: '3165550000', blic: 'KS-LIC-000', state: 'KS',
    goalMonthly: 20000,
    // Non-empty myRates suppresses the "Showing market averages" first-time banner.
    myRates: { int_walls: { labor: 2.25, mat: 0 }, int_ceiling: { labor: 1.75, mat: 0 }, ext_siding: { labor: 2.5, mat: 0 } },
  });
  await seedUpsert('accounts', { id: uid, business_name: 'Scratch Test Co', phone: '3165550000', email, address: '742 Evergreen Terrace, Wichita, KS 67202', state: 'KS', license_info: 'KS-LIC-000', owner_id: uid }, 'id');
  await seedUpsert('users', { id: uid, email, name: 'Scratch Tester', role: 'owner', account_id: uid, business_type: 'painting' }, 'id');
  await seedUpsert('account_users', { account_id: uid, user_id: uid, role: 'owner' }, 'account_id,user_id');
  await seedUpsert('account_config', { account_id: uid, business_type: 'painting', default_job_type: 'estimate', require_estimate: true, require_deposit: true, allow_full_payment: false, show_schedule: true, state: 'KS' }, 'account_id');
  await seedUpsert('vehicles', { id: uid, account_id: uid, name: 'Work Truck', type: 'truck', odometer_start: 0 }, 'id');
  await seedUpsert('zj_data', { user_id: uid, account_id: uid, settings, updated_at: now }, 'user_id');
}

(async () => {
  console.log(`\n→ Creating confirmed test user on ${SUPABASE_URL} ...`);
  let uid;
  try { uid = await createUser(); } catch (e) { die(e.message); }
  console.log(`  ✓ ${email}  (uid ${uid})`);

  console.log('→ Seeding a fully-onboarded contractor account (no first-run banners) ...');
  await seedOnboardedAccount(uid);
  console.log('  ✓ seeded');

  console.log(`\n  email:    ${email}`);
  console.log(`  password: ${password}`);
  console.log(`  uid:      ${uid}\n`);

  if (has('no-ui')) { console.log('--no-ui passed, stopping here. Sign in with the credentials above.'); return; }

  // Reuses live-helpers.js's EXISTING credential resolution (signIn() →
  // cloudAccountFor() → DEV_EMAIL/DEV_PASSWORD/DEV_USER_ID) unchanged: no test
  // file needs to know this is an ad-hoc user rather than the shared dev login.
  const uiArgs = ['playwright', 'test', '--ui', '--config=playwright.flow.config.js'];
  const grep = flag('grep', null);
  if (grep) uiArgs.push('--grep', grep);

  console.log('→ Launching Playwright UI mode, signed in as this user ...\n');
  const child = spawn('npx', uiArgs, {
    stdio: 'inherit',
    env: { ...process.env, E2E_DEV_EMAIL: email, E2E_DEV_PASSWORD: password, E2E_DEV_USER_ID: uid },
  });
  child.on('exit', (code) => process.exit(code || 0));
  child.on('error', (e) => die('failed to launch Playwright: ' + e.message));
})();
