// ── The timesheet runs on the business's clock, not the phone's ─────────────
// Owner, 2026-08-24, from a plane: "I'm traveling right now and went back an
// hour so my times went from 8 and 10:30 to 7 and 9:30, how do we prevent
// that?" He worked 8:00-10:30 in Topeka; his phone landed in Denver and every
// clock time on the log slid an hour earlier.
//
// Its own file because it needs a phone in a DIFFERENT zone from the business,
// which is a per-file Playwright setting, and because the bug is invisible in
// any suite that happens to run in Central: the whole point is that the two
// zones disagree.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.use({ timezoneId: 'America/Denver' });   // one hour behind the business

test.describe('Time Log: business clock, not device clock', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    page = await (await browser.newContext({ timezoneId: 'America/Denver' })).newPage();
    await mockAllExternal(page);
    await page.goto('/index.html');
    await waitForAppBoot(page);
    // A Kansas business, which is what the zone is DERIVED from now. Without
    // this the app correctly falls back to the device's zone, which is the
    // right behaviour for an account with no address yet and the wrong
    // fixture for testing a business that has one.
    await page.evaluate(() => { S.state = 'KS'; S.bizTz = ''; });
  });
  test.afterAll(async () => { await page.context().close(); });

  // 8:00 AM and 10:30 AM Central on Mon 8/24/2026 (CDT, UTC-5).
  const IN_ISO = '2026-08-24T13:00:00.000Z';
  const OUT_ISO = '2026-08-24T15:30:00.000Z';

  test('the phone really is in another zone, or this file proves nothing', async () => {
    const r = await page.evaluate(() => ({
      zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      naive: new Date('2026-08-24T13:00:00.000Z').toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    }));
    expect(r.zone).toBe('America/Denver');
    expect(r.naive, 'device-local formatting is what showed 7:00 instead of 8:00').toBe('7:00 AM');
  });

  test('clock times show the hours actually worked, wherever the phone is', async () => {
    const r = await page.evaluate(([a, b]) => [_tlFmtTime(a), _tlFmtTime(b)], [IN_ISO, OUT_ISO]);
    expect(r, 'Topeka hours stay Topeka hours in Denver').toEqual(['8:00 AM', '10:30 AM']);
  });

  test('the Fix dialog prefills in business time, not the phone\'s', async () => {
    const v = await page.evaluate((iso) => _tlBizInputValue(iso), IN_ISO);
    expect(v, 'a wrong baseline to correct from is worse than no dialog').toBe('2026-08-24T08:00');
  });

  test('a correction typed while travelling saves the hour that was meant', async () => {
    const iso = await page.evaluate(() => _tlBizInputToIso('2026-08-24T08:00'));
    expect(iso, 'read as 8am Central, not 8am Mountain').toBe(IN_ISO);
  });

  test('prefill and save are exact inverses, so opening and saving changes nothing', async () => {
    const r = await page.evaluate(([a, b]) => [
      _tlBizInputValue(_tlBizInputToIso(_tlBizInputValue(a))),
      _tlBizInputValue(_tlBizInputToIso(_tlBizInputValue(b))),
    ], [IN_ISO, OUT_ISO]);
    expect(r).toEqual(['2026-08-24T08:00', '2026-08-24T10:30']);
  });

  test('the zone carries CST as well as CDT, no hand-maintained offset', async () => {
    const r = await page.evaluate(() => ({
      summer: _tlBizInputToIso('2026-07-15T08:00'),
      winter: _tlBizInputToIso('2026-01-15T08:00'),
    }));
    expect(r.summer, 'CDT, UTC-5').toBe('2026-07-15T13:00:00.000Z');
    expect(r.winter, 'CST, UTC-6').toBe('2026-01-15T14:00:00.000Z');
  });

  test('the zone comes from the business address, not from anyone asking', async () => {
    const r = await page.evaluate((iso) => {
      const prevS = S.state, prevTz = S.bizTz;
      const at = (state) => { S.state = state; S.bizTz = ''; return { tz: bizTz(), shown: _tlFmtTime(iso) }; };
      const ks = at('KS'), az = at('AZ'), co = at('CO');
      S.state = prevS; S.bizTz = prevTz;
      return { ks, az, co };
    }, IN_ISO);
    expect(r.ks.tz).toBe('America/Chicago');
    expect(r.ks.shown).toBe('8:00 AM');
    expect(r.az.tz, 'Phoenix keeps its own time all year').toBe('America/Phoenix');
    expect(r.az.shown).toBe('6:00 AM');
    expect(r.co.tz).toBe('America/Denver');
    expect(r.co.shown).toBe('7:00 AM');
  });

  test('a split state is decided by the shop\'s own longitude', async () => {
    const r = await page.evaluate(() => ({
      topeka: tzForBusiness('KS', -95.71, 39.03),
      farWest: tzForBusiness('KS', -101.9, 38.9),
      nashville: tzForBusiness('TN', -86.78, 36.16),
      knoxville: tzForBusiness('TN', -84.28, 35.96),
      pensacola: tzForBusiness('FL', -87.2, 30.42),
      miami: tzForBusiness('FL', -80.19, 25.76),
      panhandle: tzForBusiness('ID', -116.8, 47.7),
      boise: tzForBusiness('ID', -116.2, 43.6),
      noState: tzForBusiness('', null, null),
      junk: tzForBusiness('ZZ', 0, 0),
    }));
    expect(r.topeka).toBe('America/Chicago');
    expect(r.farWest, 'the four western KS counties are Mountain').toBe('America/Denver');
    expect(r.nashville).toBe('America/Chicago');
    expect(r.knoxville, 'east Tennessee is Eastern').toBe('America/New_York');
    expect(r.pensacola, 'the panhandle is Central').toBe('America/Chicago');
    expect(r.miami).toBe('America/New_York');
    expect(r.panhandle, 'north Idaho is Pacific').toBe('America/Los_Angeles');
    expect(r.boise).toBe('America/Boise');
    expect(r.noState, 'nothing to go on means say so, never guess a zone').toBe(null);
    expect(r.junk).toBe(null);
  });

  test('an account with no address yet uses the device, and a bad saved zone never breaks it', async () => {
    const r = await page.evaluate((iso) => {
      const prevS = S.state, prevTz = S.bizTz;
      S.state = ''; S.bizTz = '';
      const noAddress = bizTz();
      S.state = 'KS'; S.bizTz = 'not/a/zone';
      const corrupt = _tlFmtTime(iso);
      S.state = prevS; S.bizTz = prevTz;
      return { noAddress, corrupt };
    }, IN_ISO);
    expect(r.noAddress, 'mid-onboarding, the phone is the best guess there is').toBe('America/Denver');
    expect(r.corrupt, 'an unusable saved zone re-derives from the address').toBe('8:00 AM');
  });

  test('malformed input never throws', async () => {
    const r = await page.evaluate(() => ({
      empty: _tlFmtTime(''),
      junk: _tlFmtTime('nope'),
      nullIn: _tlBizInputToIso(null),
      partial: _tlBizInputToIso('2026-08-24'),
      badIso: _tlBizInputValue('nope'),
    }));
    expect(r.empty).toBe('');
    expect(r.junk).toBe('');
    expect(r.nullIn).toBe(null);
    expect(r.partial).toBe(null);
    expect(r.badIso).toBe('');
  });

  test('no console errors', async () => { await assertNoErrors(page); });
});
