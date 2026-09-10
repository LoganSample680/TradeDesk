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

  // Owner 2026-08-30: "so it should be synced to business location timezone?"
  // It should. These three used to hardcode America/Chicago while the log
  // RENDERED through bizTz(), so outside Central the day a row was filed under
  // and the day it was drawn on could differ. A day boundary decides which day
  // gets paid.
  test.describe('day keys follow the business zone, not Central', () => {
    test('the same instant files under different days in different business zones', async ({ page }) => {
      await mockAllExternal(page);
      await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await waitForAppBoot(page);
      const r = await page.evaluate(() => {
        // 2026-08-28 04:30 UTC. That is the 27th in Phoenix (21:30) and in
        // Chicago (23:30), and already the 28th in New York (00:30).
        const d = new Date('2026-08-28T04:30:00.000Z');
        const prevTz = S.bizTz, prevState = S.state;
        const at = (tz) => { S.bizTz = tz; return _bizDateStr(d); };
        const out = {
          phx: at('America/Phoenix'),
          chi: at('America/Chicago'),
          nyc: at('America/New_York'),
          la: at('America/Los_Angeles'),
        };
        S.bizTz = prevTz; S.state = prevState;
        return out;
      });
      expect(r.phx).toBe('2026-08-27');
      expect(r.chi).toBe('2026-08-27');
      expect(r.la).toBe('2026-08-27');
      expect(r.nyc, 'an hour past midnight in New York is the next day there').toBe('2026-08-28');
    });

    test('the clock stamps follow the same zone, so they cannot disagree with the day key', async ({ page }) => {
      await mockAllExternal(page);
      await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await waitForAppBoot(page);
      const r = await page.evaluate(() => {
        const d = new Date('2026-08-28T04:30:00.000Z');
        const prev = S.bizTz;
        S.bizTz = 'America/Phoenix';
        const phx = { day: _bizDateStr(d), stamp: _bizStamp(d), hm: _bizHM(d) };
        S.bizTz = 'America/New_York';
        const nyc = { day: _bizDateStr(d), stamp: _bizStamp(d), hm: _bizHM(d) };
        S.bizTz = prev;
        return { phx, nyc };
      });
      expect(r.phx.hm).toBe('21:30');
      expect(r.nyc.hm).toBe('00:30');
      // The stamp's own MM-DD half must agree with the day key it sits beside.
      expect(r.phx.stamp.slice(0, 5)).toBe('08-27');
      expect(r.nyc.stamp.slice(0, 5)).toBe('08-28');
      expect(r.phx.stamp.slice(0, 5)).toBe(r.phx.day.slice(5));
      expect(r.nyc.stamp.slice(0, 5)).toBe(r.nyc.day.slice(5));
    });

    test('a garbage or missing business zone degrades to Central, never throws', async ({ page }) => {
      await mockAllExternal(page);
      await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await waitForAppBoot(page);
      const r = await page.evaluate(() => {
        const d = new Date('2026-08-28T04:30:00.000Z');
        const prev = S.bizTz;
        const out = {};
        S.bizTz = 'Not/AZone'; out.junk = _bizDateStr(d);
        S.bizTz = ''; out.empty = _bizDateStr(d);
        S.bizTz = null; out.nul = _bizDateStr(d);
        S.bizTz = prev;
        let threw = false;
        try { _bizDateStr(new Date('nope')); _bizStamp(null); _bizHM(undefined); } catch (e) { threw = true; }
        out.threw = threw;
        return out;
      });
      // bizTz() rejects an unusable zone and falls through to a derived or
      // default one, so the answer is still a real date, never a crash.
      expect(r.junk).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.empty).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.nul).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.threw, 'bad input degrades, it never throws').toBe(false);
    });

    test('nothing anywhere still hardcodes Central for a day key', async () => {
      const fs = require('fs'), path = require('path');
      const dir = path.join(__dirname, '..', 'js');
      const offenders = [];
      for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.js'))) {
        const src = fs.readFileSync(path.join(dir, f), 'utf8');
        src.split('\n').forEach((line, i) => {
          // A DateTimeFormat pinned to a literal zone is the shape that caused
          // this. utils.js is exempt: it owns the state -> zone lookup table.
          if (f === 'utils.js') return;
          if (/timeZone\s*:\s*'America\//.test(line)) offenders.push(f + ':' + (i + 1));
        });
      }
      expect(offenders, 'format through bizTz(), never a literal zone').toEqual([]);
    });
  });
});
