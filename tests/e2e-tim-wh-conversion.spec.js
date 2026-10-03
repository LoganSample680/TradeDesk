// @ts-check
/**
 * Electric out, gas in: the owner's own Build Your Own bid, 2026-10-01.
 *
 * He typed "I am removing a electric water heater and replacing with gas".
 * What went out:
 *   - "Removing a electric water heater, Bradford White" (his narration, the
 *     grammar as typed, and the NEW heater's brand on the OLD one)
 *   - "Replacing with gas"
 *   - "Shut the power off at the panel and verify it is dead" as step 13 of
 *     13, after the new heater was started up
 *   - a "Usually goes with this" card fed by FOUR saved copies of one
 *     washer-box job, counted as four jobs
 * Owner: "I typed up what I was doing, it's also pulling in my old estimate
 * for usually goes with this."
 *
 * What we verify:
 *  1. The step writer turns narration into steps, and the brand goes on the
 *     unit going in (said in the sentence, said before the install verb, or
 *     typed into Tim's "Name the unit")
 *  2. The conversion's own misses (gas line, venting, permit, the old 240V
 *     circuit) are offered, never added, and a gas-for-gas swap gets none
 *  3. An accepted shutoff lands before the tear-out on the builder
 *  4. One past job is never "usually"; two matching jobs are
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const SAID = 'I am removing a electric water heater and replacing with gas';
const CONVERSION = [
  'Run a new gas line to the water heater (with shutoff and drip leg)',
  'Vent the new water heater to the outside (flue or power vent)',
  'Permit and inspection',
  'Cap and label the old 240V water heater circuit at the panel',
];

test.describe('electric to gas water heater, through Build Your Own', () => {
  let page, ctx;

  test.beforeAll(async ({ browser }) => {
    ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.waitForFunction(() => window._supaCloudLoaded === true, null, { timeout: 15000 }).catch(() => {});
    await page.evaluate(() => { window.supaLoadFromCloud = async () => {}; window._byoAutosave = () => {}; });
  });
  test.afterAll(async () => { await ctx.close(); });

  // A past bid for the history half: one customer, one day, one set of lines.
  const past = (id, client, date, lines) => ({
    id, client_id: client, client_name: 'C' + client, type: 'Plumbing job', trade_type: 'plumbing',
    amount: 1000, status: 'Closed Won', draft: false, bid_date: date, isFreeForm: true,
    byoItems: lines.map((label, i) => ({ id: i + 1, section: 'Work', label, qty: 1, unit: 'ea', rate: 100, price: 100, on: true })),
  });

  const open = (history) => page.evaluate((hist) => {
    document.querySelectorAll('.zmodal-overlay,.toast').forEach(e => e.remove());
    bids.length = 0; clients.length = 0;
    (hist || []).forEach(b => bids.push(b));
    clients.push({ id: 97001, name: 'Blake Sample', addr: '2015 SW Randolph Ave, Topeka, KS 66604' });
    currentClientId = 97001;
    _activeTrade = 'plumbing';
    S.priceBook = S.priceBook || {}; S.priceBook.plumbing = [];
    openGenericEstimate(getClientById(97001), null, null, { mode: 'byo' });
    _geiIsFreeForm = true; _geiIsTM = false; _geiTrade = 'plumbing'; goGeiStep(2);
    _attachSkipped = [];
  }, history || []);
  const say = (t) => page.evaluate((t) => { document.getElementById('byo-say').value = t; _byoSayBuild(); }, t);
  const work = () => page.evaluate(() => _byoItems.filter(x => !x._supply && !x._rrp).map(x => x.label));
  const steps = (t) => page.evaluate((t) => timScopeBuild(t, { rejected: [], trade: 'plumbing' }).steps.map(s => s.text), t);

  // ── 1. His words, as steps ─────────────────────────────────────────────────

  test('the owner\'s sentence becomes two clean steps', async () => {
    await open();
    await say(SAID);
    expect(await work()).toEqual(['Remove the electric water heater', 'Install the new gas water heater']);
  });

  test('narration in general: "I am <verb>ing" and a bare "<verb>ing" become the plain verb', async () => {
    expect(await steps('We are tearing out the vanity and hooking up the new sink'))
      .toEqual(['Tear out the vanity', 'Hook up the new sink']);
    expect(await steps('I am removing a old toilet')).toEqual(['Remove the old toilet']);
    // Guard: he pulls a permit, and "Bonding primer" is a kind of primer.
    expect(await steps('Pull a permit')).toEqual(['Pull a permit']);
    expect(await steps('Bonding primer')).toEqual(['Bonding primer']);
    expect(await steps('putting in a water softener')).toEqual(['Put in a water softener']);
  });

  test('guard: a plain order is left exactly as he wrote it, and a noun is not a verb', async () => {
    expect(await steps('Replace the cold supply valve')).toEqual(['Replace the cold supply valve']);
    expect(await steps('Install an expansion tank')).toEqual(['Install an expansion tank']);
    // "Replace with" with no unit coming out before it is not an install.
    expect(await steps('replacing with a longer one')).toEqual(['Replace with a longer one']);
    // A written letter stays as written (no rewrite of his own letter).
    const letter = 'Hi Ray,\n\nHere is my estimate:\n\n- Removing the old water heater\n- Installing a new one\n\nThis estimate is good for 14 days.\n\nThanks,\nJohn';
    const l = await steps(letter);
    expect(l).toContain('Removing the old water heater');
  });

  test('the brand he names goes on the unit going in, not the one coming out', async () => {
    expect(await steps('I am removing a electric water heater and replacing with a Bradford White gas'))
      .toEqual(['Remove the electric water heater', 'Install the new Bradford White gas water heater']);
    // Said BEFORE the install verb.
    expect(await steps('Bradford White gas, I am removing a electric water heater and replacing with gas'))
      .toEqual(['Remove the electric water heater', 'Install the new Bradford White gas water heater']);
    expect(await steps('I am removing a electric water heater, Bradford White gas going in, replacing with gas'))
      .toEqual(['Remove the electric water heater', 'Install the new Bradford White gas water heater']);
    // Guard: "the old Rheem" is the old one, and stays there.
    expect(await steps('pull the old Rheem and install a new gas water heater'))
      .toEqual(['Pull the old Rheem', 'Install a new gas water heater']);
  });

  test('Name the unit: what he types goes on the install step, never the removal', async () => {
    await open();
    await say(SAID);
    await page.evaluate(() => { _timMissOpen = true; _byoRenderSections(); });
    const ask = page.locator('#gei-byo-page [id="tim-ask-detail-model"]').first();
    await ask.fill('Bradford White');
    await page.evaluate(() => _byoTakeMissed('detail-model'));
    expect(await work()).toEqual(['Remove the electric water heater', 'Install the new gas water heater, Bradford White']);
    // The same rule, directly, on the wording that went out on his bid.
    expect(await page.evaluate(() => _timMissAskTarget(['Removing a electric water heater', 'Replacing with gas']))).toBe(-1);
    expect(await page.evaluate(() => _timMissAskTarget(['Remove the electric water heater', 'Install the new gas water heater']))).toBe(1);
  });

  // ── 2. The conversion is offered, never added ──────────────────────────────

  test('the four conversion items are offered and none of them is on the bid', async () => {
    await open();
    await say(SAID);
    const r = await page.evaluate(() => ({ offered: _attachSuggestions('plumbing').map(s => ({ label: s.line.label, lib: !!s.lib, why: s.why })), card: _attachCardHTML() }));
    const labels = r.offered.map(x => x.label);
    for (const c of CONVERSION) expect(labels, c).toContain(c);
    expect(r.offered.filter(x => CONVERSION.includes(x.label)).every(x => x.lib && x.why), 'each says why').toBe(true);
    expect(labels, 'the conversion permit stands in for the swap one').not.toContain('Water heater permit & inspection');
    const onBid = await work();
    for (const c of CONVERSION) expect(onBid, c).not.toContain(c);
    // The trade's, not his history.
    expect(r.card).toContain('What the trade usually needs');
    expect(r.card).not.toContain('Usually goes with this');
  });

  test('a gas-for-gas swap gets none of them', async () => {
    await open();
    await say('I am removing a gas water heater and replacing with gas');
    const labels = await page.evaluate(() => _attachSuggestions('plumbing').map(s => s.line.label));
    for (const c of CONVERSION) expect(labels, c).not.toContain(c);
  });

  test('prices stay his: the book wins over the library rate', async () => {
    await open();
    await say(SAID);
    await page.evaluate(() => { S.priceBook.plumbing = [{ desc: 'Permit and inspection', rate: 210, unit: 'ea', n: 3 }]; });
    await page.evaluate(() => _attachAdd(_attachSuggestions('plumbing').find(s => s.line.label === 'Permit and inspection').key));
    const it = await page.evaluate(() => _byoItems.find(x => x.label === 'Permit and inspection'));
    expect(it.rate).toBe(210);
  });

  // ── 3. Work order on the builder ───────────────────────────────────────────

  test('an accepted "Shut the power off" lands before the removal, from Tim\'s card', async () => {
    await open();
    await say(SAID);
    expect(await page.evaluate(() => _byoMissed.some(m => m.id === 'access-power-off'))).toBe(true);
    await page.evaluate(() => _byoTakeMissed('access-power-off'));
    const w = await work();
    expect(w.indexOf('Shut the power off at the panel and verify it is dead')).toBeLessThan(w.indexOf('Remove the electric water heater'));
  });

  test('and from the "goes with this" card, after Tim\'s steps are all in', async () => {
    // The owner's path: the shutoff was one of his past lines, added last.
    const hist = [
      { id: 97101, client_id: 97501, date: '2026-08-01' }, { id: 97102, client_id: 97502, date: '2026-09-01' },
    ].map(b => past(b.id, b.client_id, b.date, ['Remove the electric water heater', 'Shut the power off at the panel and verify it is dead', 'Test every circuit and label the panel']));
    await open(hist);
    await say(SAID);
    await page.evaluate(() => { _byoMissed.filter(m => m.id !== 'access-power-off' && !m.ask && !m.optIn).forEach(m => _byoTakeMissed(m.id)); });
    const sugg = await page.evaluate(() => _attachSuggestions('plumbing').map(s => ({ key: s.key, label: s.line.label, lib: !!s.lib })));
    const power = sugg.find(s => s.label === 'Shut the power off at the panel and verify it is dead');
    expect(power, 'two jobs is a habit').toBeTruthy();
    expect(power.lib).toBe(false);
    await page.evaluate((k) => _attachAdd(k), power.key);
    const w = await work();
    const at = w.indexOf('Shut the power off at the panel and verify it is dead');
    expect(at).toBeLessThan(w.indexOf('Remove the electric water heater'));
    expect(at).toBeLessThan(w.indexOf('Install the new gas water heater'));
    // Start-up stays last of the work.
    const su = w.indexOf("Start up the new unit to the manufacturer's instructions");
    expect(su).toBeGreaterThan(w.indexOf('Install the new gas water heater'));
    // A library line with no stage goes in with the install, not after start-up.
    const tank = await page.evaluate(() => _attachSuggestions('plumbing').find(s => s.line.label === 'Thermal expansion tank'));
    await page.evaluate((k) => _attachAdd(k), tank.key);
    const w2 = await work();
    expect(w2.indexOf('Thermal expansion tank')).toBeLessThan(w2.indexOf("Start up the new unit to the manufacturer's instructions"));
  });

  test('a letter he wrote keeps his order: an offer goes on the end', async () => {
    const r = await page.evaluate(() => {
      const arr = [{ label: 'Removing the old water heater', section: 'Work', _written: true }, { label: 'Start up the new unit', section: 'Work', _written: true }];
      _geiPlaceOffered(arr, { label: 'Shut the power off at the panel and verify it is dead', section: 'Work' });
      return arr.map(x => x.label);
    });
    expect(r[2]).toBe('Shut the power off at the panel and verify it is dead');
  });

  // ── 4. "Usually" means usually ─────────────────────────────────────────────

  test('one past job, saved four times, is not "usually"', async () => {
    // The owner's account: four copies of one washer-box job, one customer, one day.
    const lines = ['Shut the water off and drain it down', 'Shut the power off at the panel and verify it is dead', 'Rough in a surface-mounted washer box: drain, water lines and vent', 'Test every circuit and label the panel'];
    const hist = [97201, 97202, 97203, 97204].map(id => past(id, 97601, '2026-09-30', lines));
    await open(hist);
    await say(SAID);
    const r = await page.evaluate(() => ({
      learned: _attachSuggestions('plumbing').filter(s => !s.lib).map(s => s.line.label),
      card: _attachCardHTML(),
      pkg: _pkgSuggestions('plumbing').map(x => ({ key: x.key, label: x.label, sub: x.sub })),
      jobs: _pkgJobs('plumbing').length,
    }));
    expect(r.jobs, 'four saves of one job is one job').toBe(1);
    expect(r.learned).toEqual([]);
    expect(r.card).not.toContain('Usually goes with this');
    expect(r.card).not.toContain('Shut the power off');
    // The single job shows only as Same as last time, with its date.
    expect(r.pkg.map(x => x.key)).toEqual(['last']);
    expect(r.pkg[0].label).toBe('Same as last time');
    expect(r.pkg[0].sub).toContain('2026-09-30');
  });

  test('two matching jobs are "usually", labelled as his', async () => {
    const lines = ['Remove the electric water heater', 'Install the new gas water heater', 'Gas line, 3/4 black iron'];
    const hist = [past(97301, 97701, '2026-07-01', lines), past(97302, 97702, '2026-08-01', lines)];
    await open(hist);
    await say(SAID);
    const r = await page.evaluate(() => ({
      learned: _attachSuggestions('plumbing').filter(s => !s.lib).map(s => ({ label: s.line.label, n: s.n, of: s.of })),
      card: _attachCardHTML(),
    }));
    const gl = r.learned.find(x => x.label === 'Gas line, 3/4 black iron');
    expect(gl).toBeTruthy();
    expect(gl.n).toBe(2);
    expect(r.card).toContain('Usually goes with this');
    expect(r.card).toContain('on 2 of your last 2 jobs');
    // Still an offer.
    expect(await work()).not.toContain('Gas line, 3/4 black iron');
  });

  test('no console errors', async () => { assertNoErrors(page); });
});
