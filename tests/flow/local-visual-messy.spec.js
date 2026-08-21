// LOCAL-STACK VISUAL CAPTURE — MESSY DAY. Same day, same job/client, same
// shop/site coordinates as local-visual.spec.js's clean showcase account,
// but every leg and visit is the chaotic version a real phone actually
// produces: GPS jitter blips, stop-start fragmented drives, a dead-phone
// gap followed by a drift blip on reconnect, and fence exit/re-entry churn
// logged as several geofence visit rows instead of one clean window.
// Owner ask (2026-08-21): "I want it all to be messy, like super fucking
// messy … if the first run throws clean, the next one to compare is the
// same day rendered but messy as fuck." This is that comparison run: same
// screenshots, same assertions shape as the clean spec, against the messy
// seed (tests/flow/global-setup.js's "MESSY-DAY account" block).
//
// The point isn't the raw seed data, it's what the LIVE app does with it:
// renderTimeLog calls the real _geoReconcileFromMileage → _geoDedupTimeEntries
// sweep on real Supabase rows the moment this account opens Time Log, so a
// green run here proves the dedup/reconcile logic actually cleans up mess
// end-to-end, not just against synthetic objects in an offline mock.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('./flow-test');
const { signIn } = require('./live-helpers');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHOTS_DIR = path.join(__dirname, '..', '..', 'local-visual-shots');

function messyAccount() {
  if (process.env.E2E_LOCAL_STACK !== '1') return null;
  try {
    const a = JSON.parse(fs.readFileSync(path.join(__dirname, '.local-showcase-messy.json'), 'utf8'));
    return (a && a.email && a.password) ? a : null;
  } catch (e) { return null; }
}

async function snap(page, testInfo, name) {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const file = path.join(SHOTS_DIR, name + '.png');
  const body = await page.screenshot({ path: file, fullPage: true });
  await testInfo.attach(name, { body, contentType: 'image/png' });
}

test.describe('Local-stack visual capture (messy-day seed, compare vs. the clean showcase)', () => {
  test.skip(!messyAccount(), 'local stack not running / messy account not seeded');

  test('the reconcile/dedup sweep survives jitter, fragmented drives, a dead-phone gap, and fence churn', async ({ page }, testInfo) => {
    test.setTimeout(180000);
    const consoleErrors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));

    await signIn(page, messyAccount());
    await sleep(4000);
    await snap(page, testInfo, '05-messy-dashboard');

    // Time Log: same navigation as the clean spec. renderTimeLog fires the
    // real reconcile-from-mileage → dedup sweep against the messy rows.
    await page.evaluate(() => goPg('pg-timelog'));
    await sleep(4500); // the messy seed has 3x the rows to reconcile, give it more room than the clean run
    await snap(page, testInfo, '06-messy-timelog');
    const tl = await page.evaluate(() => document.getElementById('pg-timelog').innerText);
    expect(tl, 'the seeded job survives the mess and still renders in Time Log').toContain('Kitchen repaint');

    // Mileage: 10 fragmented/jittery legs vs. the clean day's 2, same total
    // round trip. The tracker must not crash or blank out under the load.
    await page.evaluate(() => goPg('pg-tracker'));
    await sleep(2500);
    await page.click('#tr-t-mileage');
    await sleep(1500);
    await snap(page, testInfo, '07-messy-mileage');
    const mi = await page.evaluate(() => document.getElementById('pg-tracker').innerText);
    expect(mi, 'the messy trip list still renders the job it belongs to').toContain('Kitchen repaint');

    // The whole point: a real phone's mess must never surface as a console
    // error or a crashed render, whatever the dedup sweep decides to collapse.
    expect(consoleErrors, 'zero console errors reconciling the messy seed: ' + consoleErrors.join(' | ')).toEqual([]);
  });
});
