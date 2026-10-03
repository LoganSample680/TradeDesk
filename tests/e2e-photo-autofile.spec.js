// @ts-check
// ── On site at one customer, the photo is theirs (owner 2026-09-29) ──────────
//
// "it should've went to bill." Jack was on site at Bill Lorson's from 10:22,
// shot two photos from the Home camera at 12:10 and pocketed the phone before
// the "whose is this?" sheet, so both went to the unfiled tray although the
// app knew exactly where he was. A shot with nothing to file it under now goes
// to the customer he is on site at, when its own fix agrees.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const BILL = { id: 1789402572284, name: 'Bill Lorson', addr: '3313 NW Topeka Blvd', lat: 39.0870, lon: -95.6760 };
const OTHER = { id: 777, name: 'Tagen Lindstrom', addr: '1733 SW Burnett Rd', lat: 39.0356, lon: -95.7314 };
const AT_BILL = { lat: 39.0872, lon: -95.6762 };      // ~30 m from Bill's house
const AT_OTHER = { lat: 39.0357, lon: -95.7313 };

test.describe('a photo shot on site files itself', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => { window.supaLoadFromCloud = async () => {}; window.supaEnabled = () => false; });
  });
  test.afterAll(async () => { await page.context().close(); });

  const seed = (dwell) => page.evaluate(([BILL, OTHER, dwell]) => {
    clients.length = 0; bids.length = 0; jobs.length = 0; photos.length = 0;
    clients.push({ ...BILL }, { ...OTHER });
    window._geoOpenDwell = dwell;
    document.querySelectorAll('.toast,#pc-rev').forEach(e => e.remove());
  }, [BILL, OTHER, dwell]);
  const atBill = (extra) => Object.assign({ id: 'client-' + BILL.id, name: BILL.name, kind: 'client', sinceTs: Date.now() - 3600000,
    atHome: false, counts: true, fence: { id: 'client-' + BILL.id, kind: 'client', name: BILL.name, clientId: BILL.id, addr: BILL.addr } }, extra || {});
  const shoot = (o) => page.evaluate(async ([b64, o]) => {
    const bin = atob(b64); const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const row = await tdSavePhoto({ type: 'progress', stamp: false, ...o, file: new File([arr], 'shot.png', { type: 'image/png' }) });
    return row ? { id: row.id, client_id: row.client_id, client_name: row.client_name, addr: row.addr, auto: !!row.autoFiled } : null;
  }, [PNG_B64, o || {}]);

  test("on site at Bill's with a fix at Bill's: filed to Bill", async () => {
    await seed(atBill());
    const r = await shoot(AT_BILL);
    expect(r.client_id).toBe(BILL.id);
    expect(r.client_name).toBe('Bill Lorson');
    expect(r.addr).toBe(BILL.addr);
    expect(r.auto).toBe(true);
  });

  test("on site at Bill's but the fix is at another customer's: left unfiled", async () => {
    await seed(atBill());
    const r = await shoot(AT_OTHER);
    expect(r.client_id).toBeNull();
    expect(r.auto).toBe(false);
  });

  test("on site at Bill's with no fix at all: the on-site verdict is enough", async () => {
    await seed(atBill());
    const r = await shoot({});
    expect(r.client_id).toBe(BILL.id);
  });

  test('not on site anywhere: unfiled, as before', async () => {
    await seed(null);
    expect((await shoot(AT_BILL)).client_id).toBeNull();
  });

  test('his own house never files anything, nor does a stop that would not bill', async () => {
    await seed(atBill({ atHome: true }));
    expect((await shoot(AT_BILL)).client_id).toBeNull();
    await seed(atBill({ counts: false }));
    expect((await shoot(AT_BILL)).client_id).toBeNull();
  });

  test('a fence whose customer is not on this phone: unfiled', async () => {
    await seed(atBill({ fence: { id: 'client-9', kind: 'client', clientId: 9 } }));
    expect((await shoot(AT_BILL)).client_id).toBeNull();
  });

  test('a job fence files to that job\'s customer', async () => {
    await seed(atBill({ kind: 'job', fence: { id: 'job-55', kind: 'job', jobId: 55 } }));
    await page.evaluate((BILL) => { jobs.push({ id: 55, client_id: BILL.id, name: 'Repipe', addr: BILL.addr }); }, BILL);
    expect((await shoot(AT_BILL)).client_id).toBe(BILL.id);
  });

  test('a shot that already names its customer, estimate or job is never moved', async () => {
    await seed(atBill());
    expect((await shoot({ ...AT_BILL, clientId: OTHER.id })).client_id).toBe(OTHER.id);
    const r = await shoot({ ...AT_BILL, clientId: OTHER.id });
    expect(r.auto).toBe(false);
  });

  test('an imported photo says nothing about where the phone is now: unfiled', async () => {
    await seed(atBill());
    expect((await shoot({ ...AT_BILL, imported: true })).client_id).toBeNull();
  });

  test('finishing the shoot says where they went, with Undo, and asks nothing', async () => {
    await seed(atBill());
    const a = await shoot(AT_BILL), b = await shoot(AT_BILL);
    const r = await page.evaluate(([a, b]) => {
      _pcCtx = { clientId: null, jobId: null, bidId: null, type: 'progress' };
      _pcShots = 2; _pcSessionIds = [a, b];
      _pcFinishCapture();
      const t = [...document.querySelectorAll('.toast')].map(x => x.textContent).join('|');
      return { toast: t, review: !!document.getElementById('pc-rev'), undo: !!document.querySelector('.toast .td-wh-undo') };
    }, [a.id, b.id]);
    expect(r.toast).toContain('2 photos filed to Bill Lorson');
    expect(r.undo).toBe(true);
    expect(r.review, 'nothing left to ask about').toBe(false);
  });

  test('a mixed shoot asks only about the shots that did not file themselves', async () => {
    await seed(atBill());
    const a = await shoot(AT_BILL), b = await shoot(AT_OTHER);
    const r = await page.evaluate(([a, b]) => {
      _pcCtx = { clientId: null, jobId: null, bidId: null, type: 'progress' };
      _pcShots = 2; _pcSessionIds = [a, b];
      _pcFinishCapture();
      return { review: _pcRev ? _pcRev.ids.map(String) : [], toast: [...document.querySelectorAll('.toast')].map(x => x.textContent).join('|') };
    }, [a.id, b.id]);
    expect(r.review).toEqual([String(b.id)]);
    expect(r.toast).toContain('Filed to Bill Lorson');
    await page.evaluate(() => { document.getElementById('pc-rev')?.remove(); _pcRev = null; });
  });

  test('Undo puts them back to unfiled and asks', async () => {
    await seed(atBill());
    const a = await shoot(AT_BILL);
    const r = await page.evaluate((id) => {
      tdUndoAutoFile([String(id)]);
      const p = photos.find(x => String(x.id) === String(id));
      const out = { client: p.client_id, auto: !!p.autoFiled, review: !!document.getElementById('pc-rev') };
      document.getElementById('pc-rev')?.remove(); _pcRev = null;
      return out;
    }, a.id);
    expect(r.client).toBeNull();
    expect(r.auto).toBe(false);
    expect(r.review).toBe(true);
  });

  test('junk dwell shapes never throw', async () => {
    for (const d of [{}, { fence: null }, { fence: {} }, 'x', 5]) {
      await seed(d);
      const r = await shoot(AT_BILL);
      expect(r && r.client_id).toBeNull();
    }
  });

  test('no console errors, photo auto-file', async () => {
    await page.evaluate(() => { window._geoOpenDwell = null; });
    assertNoErrors(page);
  });
});
