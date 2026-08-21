// LOCAL-STACK VISUAL CAPTURE — signs into the seeded SHOWCASE account (the
// dual-hat business owner global-setup.js provisions when E2E_LOCAL_STACK=1)
// and screenshots the real app rendering its seeded day: dashboard, Time Log,
// and Mileage, plus the dual-hat business switcher. Owner ask (2026-08-21):
// "screenshot what it looks like in local supabase so we can see the bugs" —
// the pixels come out as Playwright attachments + PNGs in local-visual-shots/,
// uploaded as a workflow artifact, with zero live credentials involved.
//
// A capture harness in the recon-live-probe diagnostic shape, deliberately NOT
// a step()/report() UX flow: nothing here measures clicks, it verifies the
// seeded pipeline end-to-end (auth → cloud load → render) and takes pictures.
// Gated twice: E2E_LOCAL_STACK=1 AND the showcase seed file must exist, so it
// soft-skips everywhere else (cloud runs, offline shards never see tests/flow).
const fs = require('fs');
const path = require('path');
const { test, expect } = require('./flow-test');
const { signIn } = require('./live-helpers');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHOTS_DIR = path.join(__dirname, '..', '..', 'local-visual-shots');

function showcaseAccount() {
  if (process.env.E2E_LOCAL_STACK !== '1') return null;
  try {
    const a = JSON.parse(fs.readFileSync(path.join(__dirname, '.local-showcase.json'), 'utf8'));
    return (a && a.email && a.password) ? a : null;
  } catch (e) { return null; }
}

async function snap(page, testInfo, name) {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const file = path.join(SHOTS_DIR, name + '.png');
  const body = await page.screenshot({ path: file, fullPage: true });
  await testInfo.attach(name, { body, contentType: 'image/png' });
}

test.describe('Local-stack visual capture (seeded showcase account)', () => {
  test.skip(!showcaseAccount(), 'local stack not running / showcase account not seeded');

  test('dashboard, Time Log, and Mileage render the seeded day', async ({ page }, testInfo) => {
    test.setTimeout(180000);
    await signIn(page, showcaseAccount());
    // Let the boot cascade finish pouring the cloud data before the first shot.
    await sleep(4000);
    await snap(page, testInfo, '01-dashboard');

    // Time Log: navigate through the app's own pager. goPg is the app's real
    // navigation entry (every nav button calls it); renderTimeLog fires on
    // entry and runs the reconcile-on-open path against the local stack.
    await page.evaluate(() => goPg('pg-timelog'));
    await sleep(3500);
    await snap(page, testInfo, '02-timelog');
    // The seeded pipeline proves itself end-to-end: the geofence visit row
    // seeded into job_time_entries must surface in the rendered page.
    const tl = await page.evaluate(() => document.getElementById('pg-timelog').innerText);
    expect(tl, 'seeded job name renders in Time Log').toContain('Kitchen repaint');

    // Mileage tracker: the two seeded GPS legs (shop→job, job→shop).
    await page.evaluate(() => goPg('pg-tracker'));
    await sleep(2500);
    await snap(page, testInfo, '03-mileage');
    const mi = await page.evaluate(() => document.getElementById('pg-tracker').innerText);
    expect(mi, 'seeded mileage legs render in the tracker').toContain('Kitchen repaint');
  });

  test('dual-hat: the seeded crew link resolves and the switcher is reachable', async ({ page }, testInfo) => {
    test.setTimeout(180000);
    await signIn(page, showcaseAccount());
    await sleep(4000);
    // loadAccountData surfaces the crew link for an owner login with an active
    // team_members row elsewhere (window._hatCrewLinks, dual-hat slice 1).
    const hat = await page.evaluate(() => ({
      links: (window._hatCrewLinks || []).length,
      owns: !!window._hatOwnsBusiness,
    }));
    await page.evaluate(() => goPg('pg-settings'));
    await sleep(1500);
    await snap(page, testInfo, '04-settings-switcher');
    expect(hat.links, 'showcase login sees its crew link on the host business').toBeGreaterThan(0);
  });
});
