// @ts-check
// ── ONE fixture, TWO implementations ────────────────────────────────────────
//
// geoDeriveDay (js/geo-derive.js) is pure and portable, so it can run in a
// Supabase edge function unchanged. _geoDeriveFences (js/geo-track.js) cannot:
// it reads S, places, clients and jobs off the window. That makes the fence
// list the ONE piece of the deriver that has to exist in two places, and
// therefore the one piece that can drift apart without anyone noticing.
//
// tests/fixtures/geo-fences-case.json holds one input and the fence set it
// must produce. This file asserts the BROWSER half against it. The SQL half,
// geo_fences_for (migration 20260929), is asserted against the same fixture by
// scripts/ci/geo-fences-equivalence.sql in the migration-lint job, so the two
// cannot disagree without a test going red.
//
// Step 1 (client coordinates on the record) is what makes any of this work:
// before it, every client fence was invisible off the device.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');
const CASE = require('./fixtures/geo-fences-case.json');

test.describe('geo fences: the browser half of the equivalence', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  async function build() {
    return page.evaluate((c) => {
      const savedGeo = localStorage.getItem('zp3_nearby_geo');
      try {
        // The device cache is deliberately EMPTY. Everything the fence list
        // knows must come from the records, because that is all the server has.
        localStorage.removeItem('zp3_nearby_geo');
        // S, places, clients and jobs are `let` bindings in module scope, not
        // window properties, so they are mutated in place rather than
        // reassigned through window. That is also the exact reason the fence
        // list cannot follow geoDeriveDay to the server: it reads these.
        Object.assign(S, c.settings);
        places.length = 0; c.places.forEach(x => places.push(x));
        clients.length = 0; c.clients.forEach(x => clients.push(x));
        jobs.length = 0; c.jobs.forEach(x => jobs.push(x));
        return _geoDeriveFences(c.day).map((f) => ({
          id: f.id, kind: f.kind, name: f.name, lat: f.lat, lng: f.lng,
          scheduled: f.scheduled === undefined ? null : !!f.scheduled,
          personal: f.personal === undefined ? null : !!f.personal,
        }));
      } finally { if (savedGeo) localStorage.setItem('zp3_nearby_geo', savedGeo); }
    }, CASE);
  }

  test('the fence set matches the fixture exactly, with no device cache', async () => {
    const got = await build();
    const norm = (a) => a.slice().sort((x, y) => x.id.localeCompare(y.id));
    // scheduled is null for every kind but client: only rule 13 asks the
    // calendar anything, so the other kinds must not carry an answer.
    expect(norm(got.map(f => ({ ...f, lat: +f.lat.toFixed(6), lng: +f.lng.toFixed(6) }))))
      .toEqual(norm(CASE.expect.map(f => ({ ...f, lat: +f.lat.toFixed(6), lng: +f.lng.toFixed(6) }))));
  });

  test('a client who moved has no fence: the coordinates belong to the old address', async () => {
    const got = await build();
    expect(got.find(f => f.id === 'client-c3'), 'geoAddr 12 OLD St against addr 12 NEW St').toBeUndefined();
  });

  test('a client nobody ever located, and one with no address, have no fence', async () => {
    const got = await build();
    expect(got.find(f => f.id === 'client-c4')).toBeUndefined();
    expect(got.find(f => f.id === 'client-c5')).toBeUndefined();
  });

  test('rule 13: only the client the calendar vouches for that day is scheduled', async () => {
    const got = await build();
    expect(got.find(f => f.id === 'client-c1').scheduled, 'job 9001 runs Sep 1 to 2').toBe(true);
    expect(got.find(f => f.id === 'client-c2').scheduled,
      'its jobs are an old one, a canceled one and a done one').toBe(false);
  });

  // ── Marking the contact (owner 2026-09-12) ────────────────────────────
  // "Add in ability to mark a contact as family member so time flags itself as
  // need marked personal or work." c6 is identical to c2 in every way except
  // the flag, so a half that drops `personal` fails on that one row and
  // nothing else.
  test('rule 13: a contact marked family carries it onto the fence, and nobody else does', async () => {
    const got = await build();
    expect(got.find(f => f.id === 'client-c6').personal, 'Mom, marked on the record').toBe(true);
    expect(got.find(f => f.id === 'client-c2').personal, 'an ordinary client is not').toBe(false);
    // Only a client can be family. A job is work whoever the client is, which
    // is the case the flag exists to keep counting, so a job fence must not
    // carry an answer at all.
    expect(got.filter(f => f.kind !== 'client').every(f => f.personal === null)).toBe(true);
  });

  test('a canceled, a done and an ended job are not fences; a live one is', async () => {
    const got = await build();
    expect(got.filter(f => f.kind === 'job').map(f => f.id)).toEqual(['job-9001']);
  });

  test('anything without coordinates is absent, whatever kind it is', async () => {
    const got = await build();
    ['place-p3', 'job-9005'].forEach((id) =>
      expect(got.find(f => f.id === id), id + ' has no coordinates').toBeUndefined());
  });

  test('the fixture is the contract: the SQL half is checked against this same file', () => {
    const fs = require('fs'), path = require('path');
    const sql = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'ci', 'geo-fences-equivalence.sql'), 'utf8');
    expect(sql, 'the CI check names the fixture it loads').toContain('geo-fences-case.json');
    expect(sql, 'and calls the function under test').toContain('geo_fences_for');
  });

  test('no console errors', async () => { assertNoErrors(page, 'geo fences'); });
});
