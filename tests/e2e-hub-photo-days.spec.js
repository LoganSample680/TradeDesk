// @ts-check
/**
 * Client hub: loose photos (not on a job or an estimate) by date.
 *
 * Owner 2026-09-26, with a screenshot of Debbie Gillum's hub: "before and after
 * looks disorganized on client hub, how do we make them organized by dates?"
 * They were one grid in arrival order, an AFTER first and a PROGRESS last. Now
 * they are grouped by the day they were taken, newest day first, and within a
 * day in the order the work happened: before, progress, after.
 *
 *   client.html   _hubPhotoDays, renderProject (the loose-photos card)
 */
const { test, expect, mockAllExternal, assertNoErrors, FAKE_USER_ID } = require('./helpers');

const P = (type, at, n) => ({ url: `https://example.com/${n}.jpg`, thumbUrl: '', type, caption: '', uploadedAt: at, job_id: null });
const PHOTOS = [
  P('after', '2026-09-24T18:10:00', 'a24'),
  P('before', '2026-09-23T09:00:00', 'b23'),
  P('before', '2026-09-24T08:05:00', 'b24'),
  P('progress', '2026-09-24T12:30:00', 'p24'),
  P('before', '2026-09-24T08:01:00', 'b24early'),
  P('after', '', 'nodate'),
];
const HUB = { clientId: 941, contractorUserId: FAKE_USER_ID, contractorName: 'Plumbing Solutions By JS', clientName: 'Debbie Gillum',
  bids: [], jobs: [], payments: [], messages: [], notifications: [], invoices: [], photos: PHOTOS };

test.describe('client hub: loose photos by date', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await page.addInitScript(h => { window.__mockHubData = h; }, HUB);
    await mockAllExternal(page);
    await page.goto(`/client.html?c=941&u=${FAKE_USER_ID}&t=days941`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => typeof _hubPhotoDays === 'function' && !!_hub, { timeout: 8000 });
  });
  test.afterAll(async () => { await page.context().close(); });

  test('newest day first; before, progress, after inside a day; undated last', async () => {
    const r = await page.evaluate(() => _hubPhotoDays(_hub.photos).map(d => ({ key: d.key, urls: d.photos.map(p => p.url.split('/').pop()) })));
    expect(r.map(d => d.key)).toEqual(['2026-09-24', '2026-09-23', '']);
    expect(r[0].urls).toEqual(['b24early.jpg', 'b24.jpg', 'p24.jpg', 'a24.jpg']);
    expect(r[1].urls).toEqual(['b23.jpg']);
    expect(r[2].urls).toEqual(['nodate.jpg']);
  });

  test('labels read as dates; undated says so', async () => {
    const r = await page.evaluate(() => _hubPhotoDays([
      { type: 'before', uploadedAt: '2026-09-24T08:00:00' }, { type: 'after', uploadedAt: 'garbage' },
      { type: 'after', uploadedAt: '2019-03-02T08:00:00' },
    ]).map(d => d.label));
    expect(r[0]).toMatch(/Sep 24/);
    expect(r[1]).toMatch(/Mar 2, 2019/);   // another year shows the year
    expect(r[2]).toBe('Undated');
  });

  test('null, empty and junk input never throw', async () => {
    const r = await page.evaluate(() => {
      try {
        return { a: _hubPhotoDays(null).length, b: _hubPhotoDays([]).length, c: _hubPhotoDays([null, undefined, {}, { type: 'weird', uploadedAt: 5 }]).length, ok: true };
      } catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
    expect(r.a).toBe(0); expect(r.b).toBe(0); expect(r.c).toBe(1);   // nulls dropped, the rest undated
  });

  test('the Project tab shows a date heading per day, in order, tags in work order', async () => {
    const r = await page.evaluate(() => {
      switchView('project');
      const card = [...document.querySelectorAll('#view-project .card')].pop();
      return {
        title: card.querySelector('div').textContent,
        days: [...card.querySelectorAll('.hub-photo-day')].map(d => d.textContent),
        tags: [...card.querySelectorAll('.hub-photo-grid')][0] ? [...[...card.querySelectorAll('.hub-photo-grid')][0].querySelectorAll('.hub-photo-tag')].map(t => t.textContent) : [],
        wide: document.documentElement.scrollWidth <= innerWidth + 1,
      };
    });
    expect(r.title).toBe('Photos');   // nothing else on the tab, so not "Other photos"
    expect(r.days.length).toBe(3);
    expect(r.days[0]).toMatch(/Sep 24/);
    expect(r.days[1]).toMatch(/Sep 23/);
    expect(r.days[2]).toBe('Undated');
    expect(r.tags).toEqual(['Before', 'Before', 'Progress', 'After']);
    expect(r.wide).toBe(true);
  });

  test('tapping a photo still opens the right one', async () => {
    const r = await page.evaluate(() => {
      let got = null; const real = window.openLightbox; window.openLightbox = (list, i) => { got = list[i].url; };
      const card = [...document.querySelectorAll('#view-project .card')].pop();
      card.querySelector('.hub-photo-grid .hub-photo-thumb').click();
      window.openLightbox = real;
      return got;
    });
    expect(r).toBe('https://example.com/b24early.jpg');
    assertNoErrors(page, 'hub photo days');
  });
});
