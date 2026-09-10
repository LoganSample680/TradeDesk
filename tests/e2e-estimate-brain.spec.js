// @ts-check
/**
 * The learning loop, and the piece of it that was missing: the clock could not
 * see the work he actually sold.
 *
 * getJobScopes built its list from SCOPE_ITEMS (the painting list) and
 * roomScopeMap (a painting-era structure), so a plumber whose bid is three
 * price-book lines got generic painting defaults, could not clock into "Water
 * heater replacement", and never saw a debrief at all. S.scopeHistory only ever
 * filled for painting, and the price book could learn hours only by splitting a
 * job total pro-rata across its lines.
 *
 * What we verify:
 *  1. _jobScopesFromBid: lines, chips, dedupe, junk
 *  2. getJobScopes prefers rooms when they exist, and the sold work otherwise
 *  3. The debrief opens for a trade with no rooms, keyed to the sold work
 *  4. Measured hours land on S.scopeHistory under line:<key>
 *  5. A line: id never reaches the shared benchmark pool
 *  6. The estimate prefers a measured line over the pro-rata split
 *  7. A measured line is not also taught by the split
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const EB_CLIENT = 84001;
const EB_BID_LINES = 84101;
const EB_BID_ROOMS = 84102;
const EB_JOB_LINES = 84201;
const EB_JOB_ROOMS = 84202;

test.describe('the clock sees the work he sold', () => {
  let page;

  const seed = () => page.evaluate(({ cid, bl, br, jl, jr }) => {
    clients = clients.filter(c => c.id !== cid).concat([
      { id: cid, name: 'Brain Test Client', addr: '1 Brain Rd', phone: '3165550001' }
    ]);
    bids = bids.filter(b => ![bl, br].includes(b.id)).concat([
      // A plumbing bid: three priced lines, no rooms anywhere.
      { id: bl, client_id: cid, client_name: 'Brain Test Client', amount: 1725, status: 'Closed Won',
        trade_type: 'plumbing', isFreeForm: true, scopeChips: [],
        byoItems: [
          { id: 1, section: 'Work', label: 'Water heater replacement', price: 1450, on: true },
          { id: 2, section: 'Work', label: 'Shutoff valve', price: 180, on: true },
          { id: 3, section: 'Materials', label: 'Expansion tank', price: 95, on: true }
        ] },
      // A painting bid with rooms, the shape that already worked.
      { id: br, client_id: cid, client_name: 'Brain Test Client', amount: 4000, status: 'Closed Won',
        trade_type: 'painting',
        roomScopeMap: { 'Living room': { twocoat: { active: true }, tape: { active: true } } } }
    ]);
    jobs = jobs.filter(j => ![jl, jr].includes(j.id)).concat([
      { id: jl, bid_id: bl, client_id: cid, name: 'Brain Test Client', start: todayKey(), status: 'upcoming' },
      { id: jr, bid_id: br, client_id: cid, name: 'Brain Test Client', start: todayKey(), status: 'upcoming' }
    ]);
    timeEntries = (timeEntries || []).filter(e => ![jl, jr].includes(e.job_id));
    S.scopeHistory = {};
    S.priceBook = { plumbing: [
      { desc: 'Water heater replacement', unit: 'ea', rate: 1450, n: 4, h: [6, 6, 6] },
      { desc: 'Shutoff valve', unit: 'ea', rate: 180, n: 3, h: [1, 1] },
      { desc: 'Expansion tank', unit: 'ea', rate: 95, n: 3, h: [0.5] }
    ] };
  }, { cid: EB_CLIENT, bl: EB_BID_LINES, br: EB_BID_ROOMS, jl: EB_JOB_LINES, jr: EB_JOB_ROOMS });

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test.afterAll(async () => { await page.context().close(); });
  test.beforeEach(async () => { await seed(); });

  // ── 1. What a bid says it sold ──────────────────────────────────────────────

  test('_jobScopesFromBid names the priced lines, namespaced off the price-book key', async () => {
    const r = await page.evaluate((bl) => {
      const b = bids.find(x => x.id === bl);
      return _jobScopesFromBid(b).map(s => [s.id, s.label]);
    }, EB_BID_LINES);
    expect(r).toEqual([
      ['line:water heater replacement', 'Water heater replacement'],
      ['line:shutoff valve', 'Shutoff valve'],
      ['line:expansion tank', 'Expansion tank']
    ]);
  });

  test('an item turned off, or an RRP insert, is not work he sold', async () => {
    const r = await page.evaluate((bl) => {
      const b = bids.find(x => x.id === bl);
      b.byoItems.push({ id: 4, section: 'Work', label: 'Never picked', price: 300, on: false });
      b.byoItems.push({ id: 5, section: 'Work', label: 'Lead-safe setup', price: 200, on: true, _rrp: true });
      return _jobScopesFromBid(b).map(s => s.label);
    }, EB_BID_LINES);
    expect(r).not.toContain('Never picked');
    expect(r).not.toContain('Lead-safe setup');
  });

  test('geiLines are the fallback when there are no BYO items, and labor lines stay out', async () => {
    const r = await page.evaluate(() => {
      const b = { geiLines: [
        { desc: 'Panel upgrade', qty: 1, rate: 2200 },
        { desc: 'Crew labor', qty: 8, rate: 95, _tmLabor: true }
      ] };
      return _jobScopesFromBid(b).map(s => s.label);
    });
    expect(r).toEqual(['Panel upgrade']);
  });

  test('a chip that repeats a line is one row, not two', async () => {
    const r = await page.evaluate((bl) => {
      const b = bids.find(x => x.id === bl);
      b.scopeChips = ['Water heater replacement', 'Haul-off'];
      return _jobScopesFromBid(b).map(s => s.label);
    }, EB_BID_LINES);
    expect(r).toEqual(['Water heater replacement', 'Shutoff valve', 'Expansion tank', 'Haul-off']);
  });

  test('_jobScopesFromBid never throws on junk', async () => {
    const r = await page.evaluate(() => {
      const out = [];
      [null, undefined, {}, { byoItems: null }, { byoItems: [null, {}, { on: true }] },
       { byoItems: [{ on: true, label: '   ' }] }, { scopeChips: [null, '', 'Real'] }].forEach(b => {
        try { out.push(_jobScopesFromBid(b).length); } catch (e) { out.push('threw'); }
      });
      return out;
    });
    expect(r).toEqual([0, 0, 0, 0, 0, 0, 1]);
  });

  // ── 2. Which list the clock offers ──────────────────────────────────────────

  test('a job with rooms keeps the room scopes, a job without gets the work he sold', async () => {
    const r = await page.evaluate(({ jl, jr }) => ({
      lines: getJobScopes(jl).map(s => s.id),
      rooms: getJobScopes(jr).map(s => s.id)
    }), { jl: EB_JOB_LINES, jr: EB_JOB_ROOMS });
    expect(r.lines).toEqual(['line:water heater replacement', 'line:shutoff valve', 'line:expansion tank']);
    // Untouched: the painting path still resolves through SCOPE_ITEMS
    expect(r.rooms).toContain('twocoat');
    expect(r.rooms.some(id => String(id).startsWith('line:'))).toBe(false);
  });

  test('a job with no bid at all still falls back to the default scopes', async () => {
    const r = await page.evaluate(() => {
      jobs = jobs.filter(j => j.id !== 84299).concat([
        { id: 84299, bid_id: null, client_id: 84001, name: 'Walk-up', start: todayKey() }
      ]);
      const out = getJobScopes(84299).map(s => s.id);
      jobs = jobs.filter(j => j.id !== 84299);
      return out;
    });
    expect(r.length).toBeGreaterThan(0);
    expect(r.some(id => String(id).startsWith('line:'))).toBe(false);
  });

  test('he can clock into a line he sold, and the entry carries that scope', async () => {
    const r = await page.evaluate((jl) => {
      const s = getJobScopes(jl)[0];
      clockIn(jl, s.id, s.label);
      const open = timeEntries.filter(e => e.job_id === jl && e.open);
      const out = { scopeId: open[0] && open[0].scope_id, label: open[0] && open[0].scope_label };
      clockOut(true, true);
      return out;
    }, EB_JOB_LINES);
    expect(r.scopeId).toBe('line:water heater replacement');
    expect(r.label).toBe('Water heater replacement');
  });

  // ── 3 + 4 + 5. The debrief, and where its hours go ──────────────────────────

  test('a trade with no rooms finally gets a debrief, keyed to what it sold', async () => {
    const r = await page.evaluate((jl) => {
      showJobDebrief(jl);
      const ov = document.querySelector('.zmodal-overlay');
      const inputs = ov ? [...ov.querySelectorAll('input[data-scope]')].map(i => i.dataset.scope) : [];
      const text = ov ? ov.textContent : '';
      ov?.remove();
      document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
      return { opened: !!ov, inputs, saysWork: /Water heater replacement/.test(text) };
    }, EB_JOB_LINES);
    expect(r.opened, 'this used to skip straight to complete for every non-painting job').toBe(true);
    expect(r.inputs).toEqual(['line:water heater replacement', 'line:shutoff valve', 'line:expansion tank']);
    expect(r.saysWork).toBe(true);
  });

  // Shard 4, 2026-09-07: making every trade debrief also made a bid that sold
  // NOTHING debrief against getJobScopes' generic painting fallback
  // (_CLOCK_DEFAULT_SCOPES: tape, prime, two coats), which blocked
  // markJobDone -> complete behind a modal nobody asked for and would have
  // taught the price book painting tasks off a plumbing job. A job with no
  // sold work and no clocked time goes straight to complete, as it always did.
  test('a bid that names no work still completes without a debrief', async () => {
    const r = await page.evaluate(() => {
      const cid = 990101, bId = 990102, jId = 990103;
      bids = bids.filter(b => b.id !== bId).concat([{ id: bId, client_id: cid, client_name: 'Bare', amount: 1000, status: 'Closed Won' }]);
      jobs = jobs.filter(j => j.id !== jId).concat([{ id: jId, bid_id: bId, client_id: cid, name: 'Bare', start: todayKey(), status: 'upcoming' }]);
      timeEntries = (timeEntries || []).filter(e => e.job_id !== jId);
      let completed = 0;
      const real = window.confirmMarkComplete;
      window.confirmMarkComplete = () => { completed++; };
      try { showJobDebrief(jId); } finally { window.confirmMarkComplete = real; }
      const ov = document.querySelector('.zmodal-overlay');
      const opened = !!ov;
      document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
      return { opened, completed, defaults: getJobScopes(jId).map(s => s.id) };
    });
    expect(r.opened, 'a bid selling nothing must not debrief against painting defaults').toBe(false);
    expect(r.completed).toBe(1);
    expect(r.defaults.length, 'the CLOCK still offers defaults, only the debrief ignores them').toBeGreaterThan(0);
  });

  test('the hours he types land on S.scopeHistory under the line key, and never in the shared pool', async () => {
    const r = await page.evaluate((jl) => {
      const sent = [];
      const realSubmit = window._submitScopeBenchmarks;
      window._submitScopeBenchmarks = rows => { (rows || []).forEach(x => sent.push(x.scope_id)); };
      try {
        showJobDebrief(jl);
        const ov = document.querySelector('.zmodal-overlay');
        const inputs = [...ov.querySelectorAll('input[data-scope]')];
        inputs[0].value = '6.5';
        inputs[1].value = '1';
        saveDebriefAndComplete(jl, ov.querySelector('.zmodal button:last-of-type'));
        document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
        return {
          heater: (S.scopeHistory['line:water heater replacement'] || []).map(x => x.hrs),
          valve: (S.scopeHistory['line:shutoff valve'] || []).map(x => x.hrs),
          untouched: S.scopeHistory['line:expansion tank'] || null,
          sent
        };
      } finally { window._submitScopeBenchmarks = realSubmit; }
    }, EB_JOB_LINES);
    expect(r.heater).toEqual([6.5]);
    expect(r.valve).toEqual([1]);
    expect(r.untouched, 'a blank stays blank, it is not a measurement of zero').toBe(null);
    expect(r.sent, 'his own wording for his own service is not the pool\'s business').toEqual([]);
  });

  // ── 6 + 7. What the next estimate does with it ──────────────────────────────

  test('the estimate prefers a measured line over the price book\'s pro-rata figure', async () => {
    const r = await page.evaluate((cid) => {
      const c = clients.find(x => x.id === cid);
      bids = bids.filter(x => x.client_id !== cid || x.id === 84101 || x.id === 84102);
      openGenericEstimate(c, null, 'plumbing', { mode: 'byo' });
      goGeiStep(2);
      _geiTrade = 'plumbing';
      _geiScopeChips = [];
      _byoItems = [{ id: 1, section: 'Work', label: 'Water heater replacement', price: 1450, on: true }];
      // The book says 6 (split across jobs). The stopwatch says 9.
      const fromBook = _estLaborHours();
      S.scopeHistory['line:water heater replacement'] = [{ hrs: 9, ts: Date.now() }];
      const measured = _estLaborHours();
      // Two measurements: the median, not the latest and not the average.
      S.scopeHistory['line:water heater replacement'].push({ hrs: 7, ts: Date.now() });
      const median = _estLaborHours();
      return { fromBook, measured, median };
    }, EB_CLIENT);
    expect(r.fromBook).toBe(6);
    expect(r.measured).toBe(9);
    expect(r.median).toBe(8);
  });

  test('a line that was clocked is not also taught by the pro-rata split', async () => {
    const r = await page.evaluate(() => {
      S.priceBook = { plumbing: [
        { desc: 'Water heater replacement', unit: 'ea', rate: 1200, n: 2 },
        { desc: 'Shutoff valve', unit: 'ea', rate: 400, n: 2 }
      ] };
      S.scopeHistory = { 'line:water heater replacement': [{ hrs: 6, ts: Date.now() }] };
      const bid = { id: 84999, trade_type: 'plumbing', scopeChips: [],
        byoItems: [
          { id: 1, section: 'Work', label: 'Water heater replacement', price: 1200, on: true },
          { id: 2, section: 'Work', label: 'Shutoff valve', price: 400, on: true }
        ] };
      const ok = _pbLearnFromJob(bid, 8);
      return {
        ok,
        // The measured one is skipped, so the whole 8 hours goes to the line
        // that nobody timed rather than being split 1200/400.
        heater: _pbHrs(_pbFind('Water heater replacement', 'plumbing')),
        valve: _pbHrs(_pbFind('Shutoff valve', 'plumbing'))
      };
    });
    expect(r.ok).toBe(true);
    expect(r.heater, 'measured already, so the split leaves it alone').toBe(null);
    expect(r.valve).toBe(8);
  });

  test('no console errors across the learning loop', async () => {
    assertNoErrors(page, 'estimate brain');
  });
});
