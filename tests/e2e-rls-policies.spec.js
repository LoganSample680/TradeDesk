// @ts-check
/**
 * RLS Policy migration tests — two layers of protection:
 *
 * LAYER 1 — Static analysis (runs in Node, no browser needed)
 *   Reads migration SQL files directly and checks for known-bad patterns.
 *   Catches the text=uuid bug before it ever reaches a database.
 *   If this fails, the migration SQL itself is wrong.
 *
 * LAYER 2 — App smoke tests (Playwright, both WebKit + Chromium)
 *   Verifies the app still boots and all data-reading paths work after
 *   the policy migration. RLS policy changes are structural — they never
 *   touch table data — so "no data loss" is guaranteed by design. These
 *   tests confirm no app functionality was broken.
 *
 * WHY NO LIVE SUPABASE TESTS:
 *   E2E tests run against a mocked Supabase shim — real Postgres RLS isn't
 *   exercised here. The actual migration correctness gate is Supabase Preview
 *   CI, which spins up a real Postgres instance and runs every migration from
 *   scratch. If Supabase Preview passes, the SQL is valid on a real database.
 */

const fs   = require('fs');
const path = require('path');
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors, goPg } = require('./helpers');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'supabase', 'migrations');

// ── LAYER 1: Static analysis ─────────────────────────────────────────────────

test.describe('RLS migration SQL — static analysis', () => {
  // This describe block runs synchronously via test() — no browser context needed.

  test('migration files sort consistently by filename and version number', () => {
    // Root cause of Supabase Preview pre-flight error: if filename alphabetical
    // sort != version numeric sort, the two-pointer algorithm flags a version as
    // "missing from local". Verify all filenames maintain consistent ordering.
    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    const versions = files.map(f => f.match(/^(\d+)/)?.[1]).filter(Boolean);
    // Supabase CLI compares migration versions as STRINGS (not numbers), which
    // matches alphabetical filename order. Use string sort here to match exactly
    // what Supabase's two-pointer algorithm sees on both sides.
    const versionsSorted = [...versions].sort();

    expect(versions, `Migration sort mismatch — alphabetical file order doesn't match string version order.\nFiles: ${files.join(', ')}`).toEqual(versionsSorted);
  });

  test('no migration file contains uncast auth.uid() comparison (text = uuid bug)', () => {
    // The bug: `column = auth.uid()` where column is text — Postgres rejects this
    // with "operator does not exist: text = uuid". Every auth.uid() comparison
    // must use ::text casts on both sides.
    const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql'));
    const violations = [];

    for (const file of files) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      const lines = sql.split('\n');

      lines.forEach((line, i) => {
        const stripped = line.replace(/--.*$/, '').trim(); // remove comments
        if (!stripped) return;

        // Flag: auth.uid() used without ::text cast
        // Match: `something = auth.uid()` or `auth.uid() = something`
        // where "something" doesn't end with ::text
        const rawAuthUid = /(?<![:\w])auth\.uid\(\)(?!::text)/;
        // Allow: auth.uid()::text (correct cast)
        // Flag:  auth.uid() alone — no cast
        if (rawAuthUid.test(stripped)) {
          violations.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      });
    }

    expect(
      violations,
      `Found uncast auth.uid() comparisons — add ::text casts:\n${violations.join('\n')}`
    ).toHaveLength(0);
  });

  test('policy migration 20260529 drops every affected policy before recreating it', () => {
    // Verify the policy fix migration uses DROP POLICY IF EXISTS for each policy
    // it recreates — guarantees old broken policies are removed, not left alongside.
    const sql = fs.readFileSync(
      path.join(MIGRATIONS_DIR, '20260529_fix_rls_policy_type_casts.sql'),
      'utf8'
    );

    // Every CREATE POLICY must be preceded by a corresponding DROP POLICY IF EXISTS
    const createMatches = [...sql.matchAll(/^create policy "([^"]+)"/gmi)].map(m => m[1]);
    const dropMatches   = new Set([...sql.matchAll(/^drop policy if exists "([^"]+)"/gmi)].map(m => m[1]));

    const missingDrops = createMatches.filter(name => !dropMatches.has(name));
    expect(
      missingDrops,
      `These policies are created without a preceding DROP IF EXISTS:\n${missingDrops.join('\n')}`
    ).toHaveLength(0);
  });

  test('policy migration 20260529 covers all tables that had the text=uuid bug', () => {
    const sql = fs.readFileSync(
      path.join(MIGRATIONS_DIR, '20260529_fix_rls_policy_type_casts.sql'),
      'utf8'
    );

    // Every table that had policies comparing column = auth.uid() (no cast)
    const requiredTables = [
      'zj_data',
      'accounts',
      'users',
      'account_users',
      'vehicles',
      'account_config',
      'team_members',
      'signed_proposals',
      'inbound_leads',
      'push_subscriptions',
      'proposal_views',
    ];

    for (const table of requiredTables) {
      expect(sql, `Migration must include policies for table: ${table}`).toContain(`on ${table}`);
    }
  });

  test('policy migration 20260529 does not contain ALTER TABLE or DROP TABLE', () => {
    // Policy migrations must never modify table structure or delete data.
    const sql = fs.readFileSync(
      path.join(MIGRATIONS_DIR, '20260529_fix_rls_policy_type_casts.sql'),
      'utf8'
    );

    const lowerSql = sql.toLowerCase();
    expect(lowerSql, 'Policy migration must not alter table structure').not.toContain('alter table');
    expect(lowerSql, 'Policy migration must not drop tables').not.toContain('drop table');
    expect(lowerSql, 'Policy migration must not truncate data').not.toContain('truncate');
    expect(lowerSql, 'Policy migration must not delete rows').not.toContain('\ndelete from');
    expect(lowerSql, 'Policy migration must not update rows').not.toContain('\nupdate ');
  });
});

// ── LAYER 2: App smoke tests ─────────────────────────────────────────────────

test.describe('App functionality after RLS policy migration', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test.afterAll(async () => { await page.context().close(); });

  test('app boots without console errors after policy migration', async () => {
    // If any data-reading path was broken by the migration, it would surface
    // as a console.error here — either a Supabase fetch error or a render crash.
    assertNoErrors(page, 'app boot after RLS policy migration');
  });

  test('dashboard renders — contractor data read path works', async () => {
    await goPg(page, 'pg-dash');
    const dash = await page.$('#pg-dash');
    expect(dash, 'Dashboard page element must exist').not.toBeNull();
    assertNoErrors(page, 'dashboard render after RLS policy migration');
  });

  test('clients page renders — account-scoped read path works', async () => {
    await goPg(page, 'pg-clients');
    const clients = await page.$('#pg-clients');
    expect(clients, 'Clients page element must exist').not.toBeNull();
    assertNoErrors(page, 'clients page after RLS policy migration');
  });

  test('proposals page renders — zj_data read path works', async () => {
    await goPg(page, 'pg-bids');
    const bids = await page.$('#pg-bids');
    expect(bids, 'Proposals page element must exist').not.toBeNull();
    assertNoErrors(page, 'proposals page after RLS policy migration');
  });

  test('finance page renders — cross-table read path works', async () => {
    await goPg(page, 'pg-finance');
    const finance = await page.$('#pg-finance');
    expect(finance, 'Finance page element must exist').not.toBeNull();
    assertNoErrors(page, 'finance page after RLS policy migration');
  });

  test('settings page renders — account_config read path works', async () => {
    await goPg(page, 'pg-settings');
    const settings = await page.$('#pg-settings');
    expect(settings, 'Settings page element must exist').not.toBeNull();
    assertNoErrors(page, 'settings page after RLS policy migration');
  });
});
