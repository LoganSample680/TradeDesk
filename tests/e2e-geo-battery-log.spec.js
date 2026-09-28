// @ts-check
// ── The battery, on the record (owner 2026-09-28) ────────────────────────────
//
// "What time did we go from 100 percent off the charger?" Nothing could say:
// the battery was read only when the app was opened, so Jack's phone reported
// the same 95% from 4:30pm to 9:35am. _geoBatteryTick (js/geo-track.js) reads
// it fresh on every wake JS gets and writes a `battery` row to geo_events when
// the level or the charger changes, kind "charging 100" / "battery 95".
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('battery log', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => { window.supaLoadFromCloud = async () => {}; });
  });
  test.afterAll(async () => { await page.context().close(); });

  // Feeds the plugin a sequence of stats() answers and records what went up.
  const run = (answers, opts = {}) => page.evaluate(async ({ answers, enabled }) => {
    const saved = { td: _geoTdPlugin, post: _geoIngestPost, en: window.supaEnabled };
    const sent = [];
    let i = 0;
    try {
      localStorage.removeItem(_GEO_BATT_LAST_KEY);
      _geoTdPlugin = () => ({ stats: () => Promise.resolve(answers[Math.min(i++, answers.length - 1)]) });
      _geoIngestPost = (rows) => { rows.forEach(r => sent.push(r.kind)); };
      window.supaEnabled = () => enabled !== false;
      const out = [];
      const n = answers.length;
      for (let k = 0; k < n; k++) out.push(await _geoBatteryTick());
      return { sent, types: out.filter(Boolean).map(r => r.type), stored: JSON.parse(localStorage.getItem(_GEO_BATT_LAST_KEY) || 'null') };
    } finally {
      _geoTdPlugin = saved.td; _geoIngestPost = saved.post; window.supaEnabled = saved.en;
      localStorage.removeItem(_GEO_BATT_LAST_KEY);
    }
  }, { answers, enabled: opts.enabled });

  test('off the charger shows up as the first battery row after a charging one', async () => {
    const r = await run([
      { batteryLevel: 1, charging: true },
      { batteryLevel: 1, charging: true },     // unchanged: not news
      { batteryLevel: 1, charging: false },    // unplugged at 100
      { batteryLevel: 0.95, charging: false },
    ]);
    expect(r.sent).toEqual(['charging 100', 'battery 100', 'battery 95']);
    expect(r.types).toEqual(['battery', 'battery', 'battery']);
    expect(r.stored).toEqual({ pct: 95, charging: false });
  });

  test('the same reading twice writes once, and a reload does not repeat it', async () => {
    const r = await page.evaluate(async () => {
      const saved = { td: _geoTdPlugin, post: _geoIngestPost };
      const sent = [];
      try {
        localStorage.setItem(_GEO_BATT_LAST_KEY, JSON.stringify({ pct: 85, charging: false }));
        _geoTdPlugin = () => ({ stats: () => Promise.resolve({ batteryLevel: 0.85, charging: false }) });
        _geoIngestPost = (rows) => rows.forEach(x => sent.push(x.kind));
        await _geoBatteryTick(); await _geoBatteryTick();
        return sent;
      } finally { _geoTdPlugin = saved.td; _geoIngestPost = saved.post; localStorage.removeItem(_GEO_BATT_LAST_KEY); }
    });
    expect(r).toEqual([]);
  });

  test('an unreadable battery writes nothing, never a fake zero', async () => {
    const r = await run([{ batteryLevel: -1 }, { batteryLevel: -1 }]);
    expect(r.sent).toEqual([]);
    expect(r.stored).toBeNull();
  });

  test('signed out: remembered, never sent', async () => {
    const r = await run([{ batteryLevel: 0.5, charging: false }], { enabled: false });
    expect(r.sent).toEqual([]);
  });

  test('a shell without the plugin, and junk answers, never throw', async () => {
    const ok = await page.evaluate(async () => {
      const saved = { td: _geoTdPlugin };
      try {
        _geoTdPlugin = () => null; await _geoBatteryTick();
        _geoTdPlugin = () => ({ stats: () => Promise.reject(new Error('x')) }); await _geoBatteryTick();
        _geoTdPlugin = () => ({ stats: () => Promise.resolve(null) }); await _geoBatteryTick();
        localStorage.setItem(_GEO_BATT_LAST_KEY, '{bad json'); _geoTdPlugin = () => ({ stats: () => Promise.resolve({ batteryLevel: 0.4 }) });
        await _geoBatteryTick();
        return true;
      } catch (e) { return String(e.message); }
      finally { _geoTdPlugin = saved.td; localStorage.removeItem(_GEO_BATT_LAST_KEY); }
    });
    expect(ok).toBe(true);
  });

  test('every wake JS gets reads it: the 30-minute ping and each open, never a replay', async () => {
    const r = await page.evaluate(async () => {
      const keep = _geoBatteryTick;
      let n = 0;
      _geoBatteryTick = () => { n++; return Promise.resolve(null); };
      try {
        await _geoTdEvent({ type: 'push-ping', ts: Date.now() }, false);
        await _geoTdEvent({ type: 'app-active', ts: Date.now() }, false);
        await _geoTdEvent({ type: 'app-background', ts: Date.now() }, true);   // replayed history
        return n;
      } finally { _geoBatteryTick = keep; }
    });
    expect(r).toBe(2);
  });

  test('the row fits what the server keeps (type 20, kind 16 characters)', async () => {
    const r = await run([{ batteryLevel: 1, charging: true }]);
    expect(r.sent[0].length).toBeLessThanOrEqual(16);
    expect('battery'.length).toBeLessThanOrEqual(20);
  });

  test('no console errors, battery log', async () => { assertNoErrors(page); });
});
