// @ts-check
// ── The trade library (js/trade-knowledge.js) ─────────────────────────────────
//
// Owner 2026-09-25: "Tim should know trade knowledge ... filling in the gaps
// contractors miss to generate professional highly closing proposals."
//
// One table, three pure functions: which job a line is, the professional
// description of it, and what gets left off. These tests hold the table to
// the catalog it describes, so a job added to TRADE_JOBS that the library
// misreads fails here rather than on a client's proposal.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('trade knowledge', () => {
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

  test('every entry is complete: a scope, and companions that each carry a price and a reason', async () => {
    const bad = await page.evaluate(() => {
      const out = [];
      Object.keys(TK_LIB).forEach(t => TK_LIB[t].forEach(j => {
        if (!j.id || !(j.match instanceof RegExp) || !j.scope || j.scope.length < 40) out.push(t + '/' + j.id + ' scope');
        if (!Array.isArray(j.missed) || !j.missed.length) out.push(t + '/' + j.id + ' missed');
        (j.missed || []).forEach(m => { if (!m.label || !(m.rate > 0) || !m.why) out.push(t + '/' + j.id + '/' + m.label); });
      }));
      return out;
    });
    expect(bad).toEqual([]);
  });

  test('the catalog jobs it should know, it knows, and to the right job', async () => {
    const r = await page.evaluate(() => {
      const want = {
        plumbing: { wh40: 'water_heater', wh_elec: 'water_heater', tankless_g: 'tankless', toilet: 'toilet', faucet: 'faucet',
          disp: 'disposal', sump: 'sump', drain: 'drain', hydro_jet: 'hydro_jet', gas_run: 'gas_line', boiler: 'boiler', hose: 'hose_bib' },
        electrical: { panel_200: 'panel', ev_resi: 'ev', fan: 'fan', exhaust: 'exhaust', recessed: 'recessed', outlet: 'outlet',
          hot_tub: 'hot_tub', gen_hookup: 'generator', ded_240: 'circuit', sub_panel: 'circuit' },
        hvac: { ac3t: 'ac', furnace_80: 'furnace', mini_2z: 'mini_split', tuneup: 'tuneup' },
        roofing: { arch_md: 'reroof', gutters: 'gutters' },
      };
      const got = {};
      Object.keys(want).forEach(t => Object.keys(want[t]).forEach(id => {
        const job = TRADE_JOBS[t].find(j => j.id === id);
        const hit = job ? tkJobFor(job.name, t) : null;
        got[t + '/' + id] = hit ? hit.id : null;
      }));
      const expected = {};
      Object.keys(want).forEach(t => Object.keys(want[t]).forEach(id => { expected[t + '/' + id] = want[t][id]; }));
      return { got, expected };
    });
    expect(r.got).toEqual(r.expected);
  });

  test('look-alikes are not mistaken for the job', async () => {
    const r = await page.evaluate(() => ['Snow removal', 'Condenser fan motor', 'Floor drain install', 'Haul-away & disposal of old unit']
      .map(s => { const j = tkJobFor(s, 'plumbing'); return j ? j.id : null; }));
    // A companion's own name ("disposal") must never read as a garbage disposal.
    expect(r).toEqual([null, null, null, null]);
  });

  test('the specific wins over the general: tankless is not a tank water heater', async () => {
    expect(await page.evaluate(() => tkJobFor('Tankless water heater, 199k btu', 'plumbing').id)).toBe('tankless');
  });

  test('his trade is asked first, then the others', async () => {
    const r = await page.evaluate(() => ({ plumberOutlet: (tkJobFor('Outlet addition', 'plumbing') || {}).id,
      electricianCircuit: (tkJobFor('Garbage disposal circuit', 'electrical') || {}).id }));
    expect(r).toEqual({ plumberOutlet: 'outlet', electricianCircuit: 'circuit' });
  });

  test('what is already on the bid is never offered, and added companions offer nothing of their own', async () => {
    const r = await page.evaluate(() => tkMissedFor(new Map([
      ['a', 'Water heater (40gal gas)'], ['b', 'Haul-away & disposal of old unit'], ['c', 'Expansion tank']]), 'plumbing', [])
      .map(x => x.line.label));
    expect(r).toContain('Water heater permit & inspection');
    expect(r).not.toContain('Thermal expansion tank');
    expect(r).not.toContain('Haul-away & disposal of old unit');
    expect(r).not.toContain('Dishwasher knockout & connection');
  });

  test('a skipped companion stays skipped, and two anchors never offer one item twice', async () => {
    const r = await page.evaluate(() => {
      const key = _tkNorm('Water heater permit & inspection');
      const list = tkMissedFor(new Map([['a', 'Water heater (40gal gas)'], ['b', 'Water heater (50gal gas)']]), 'plumbing', [key]);
      const labels = list.map(x => x.line.label);
      return { skipped: labels.includes('Water heater permit & inspection'), unique: new Set(labels).size === labels.length };
    });
    expect(r).toEqual({ skipped: false, unique: true });
  });

  // Owner review of the first screenshot (2026-09-25): the water heater's
  // scope said "haul away the old unit" while haul-away sat on the card as a
  // paid line. A scope never gives away what a companion charges for.
  test('no scope promises for free what one of its own companions charges for', async () => {
    const bad = await page.evaluate(() => {
      const out = [];
      Object.keys(TK_LIB).forEach(t => TK_LIB[t].forEach(j => {
        const priced = j.missed.some(m => /haul/i.test(m.label));
        if (priced && /haul/i.test(j.scope)) out.push(t + '/' + j.id);
      }));
      return out;
    });
    expect(bad).toEqual([]);
  });

  test('the scope reads like a proposal, and an unknown line gets none', async () => {
    const r = await page.evaluate(() => ({ wh: tkScopeFor('Water heater (40gal gas)', 'plumbing'), none: tkScopeFor('Custom work', 'plumbing') }));
    expect(r.wh).toMatch(/expansion|relief valve|leaks/i);
    expect(r.none).toBe('');
  });

  test('junk in, nothing thrown', async () => {
    const ok = await page.evaluate(() => {
      try {
        [null, undefined, '', 0, {}, [], 'x'].forEach(v => { tkJobFor(v, v); tkScopeFor(v, v); tkMissedFor(v, v, v); });
        tkMissedFor(new Map([['a', null], ['b', 42]]), 'plumbing', null);
        return true;
      } catch (e) { return String(e.message); }
    });
    expect(ok).toBe(true);
  });

  test('a spoken water heater lands with the professional description in it', async () => {
    const r = await page.evaluate(() => {
      clients.push({ id: 91501, name: 'Delaney Smith', addr: '1 Test St' });
      const keep = window.openFreeFormEstimate; const keepT = window.openTMEstimate;
      let seed = null;
      window.openFreeFormEstimate = () => { seed = window._scanEstimateSeed; window._scanEstimateSeed = null; };
      window.openTMEstimate = window.openFreeFormEstimate;
      const keepTrade = window.getActiveTrade; window.getActiveTrade = () => 'plumbing';
      try {
        tdSpeakEstimate('build a proposal for Delaney Smith, replace the water heater');
        return seed && seed.lines.map(l => ({ desc: l.desc, notes: l.notes }));
      } finally { window.openFreeFormEstimate = keep; window.openTMEstimate = keepT; window.getActiveTrade = keepTrade; }
    });
    expect(r && r.length).toBeGreaterThan(0);
    expect(r.every(l => l.notes && /water heater/i.test(l.notes))).toBe(true);
  });

  test('no console errors, trade knowledge', async () => { assertNoErrors(page); });
});
