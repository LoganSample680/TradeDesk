// @ts-check
/**
 * The proposal has to close.
 *
 * Owner, 2026-09-23: "on any proposal that goes to the client, psychologically
 * it has to make sense and close them on looks and how things are worded ...
 * people see a price go to high, and can say ill do it myself for 100 bucks
 * but its the most frustrating shit ever." Then: "make hetty pay up, also make
 * these estimates and proposals convince even Barry Bucknell ... that he
 * wouldnt even want to do the job and pay up."
 *
 * Two readers, on the customer's side of the table:
 *  - Hetty Green, the cheapskate. She reads for what the money buys, whether
 *    the number can creep, and when every dollar leaves her hand. Padding and
 *    filler are what she circles.
 *  - Barry Bucknell, the do-it-yourself man. He reads the scope as a list of
 *    his own weekends. It has to read as a plan he would rather not run: every
 *    stage, the protection, the testing, the haul-away, the warranty he cannot
 *    give himself. Without scaring him: a proposal that frightens reads as a
 *    contractor padding the job.
 *
 * And Earl's rule stands under both: nothing on the page is claimed that the
 * contractor did not say or set. No permit line without a permit step, no
 * licence line without a licence in Settings.
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('the proposal closes: Hetty and Barry', () => {
  let page, ctx;

  test.beforeAll(async ({ browser }) => {
    ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await ctx.close(); });

  const JOB = 'pull the old water heater, run new pex to the manifold and set a tankless';

  const setup = (o) => page.evaluate((o) => {
    document.querySelectorAll('.zmodal-overlay,#_style-pick-ov,#_gei-ip-ov,#_byo-add-modal,.toast').forEach(e => e.remove());
    bids.length = 0; clients.length = 0;
    clients.push({ id: 97001, name: 'Hetty Green', addr: '412 Bell St, Topeka, KS 66603' });
    currentClientId = 97001;
    _activeTrade = 'plumbing';
    S.blic = o.blic === undefined ? 'KS-PL-4471' : o.blic;
    S.warrantyPeriod = o.warranty === undefined ? '1 year' : o.warranty;
    S.depositPct = 25;
    S.tmHideRate = false;
    S.priceBook = S.priceBook || {}; S.priceBook.plumbing = [];
  }, o || {});

  const byoDoc = async (said, o) => {
    await setup(o);
    return page.evaluate(async ([said, take]) => {
      openGenericEstimate(getClientById(97001), null, null, { mode: 'byo' });
      _geiIsFreeForm = true; _geiIsTM = false; goGeiStep(2);
      document.getElementById('byo-say').value = said;
      _byoSayBuild();
      // Add all, then his two calls: the permit is his (not every job needs
      // one) and the unit is his to name.
      if (take) {
        _byoTakeAllMissed();
        if (_byoMissed.some(m => m.id === 'access-permit')) _byoTakeMissed('access-permit');
        const f = document.getElementById('tim-ask-detail-model');
        if (f) { f.value = 'Navien NPE-240A'; _byoTakeMissed('detail-model'); }
      }
      _byoItems.forEach(it => { if (!(it.price > 0)) { it.price = 500; it.rate = 500; } });
      _byoRenderSections(); _byoUpdateRail();
      let d = ''; const real = window._showProposalPreviewOverlay;
      window._showProposalPreviewOverlay = h => { d = h; };
      try { await sendGenericProposal(true); } finally { window._showProposalPreviewOverlay = real; }
      return { html: d, lines: _byoItems.filter(i => i.on).map(i => i.label) };
    }, [said, o && o.take === false ? false : true]);
  };

  const tmDoc = async (said) => {
    await setup();
    return page.evaluate(async (said) => {
      openTMEstimate(getClientById(97001));
      document.getElementById('gei-scope-say').value = said;
      _geiScopeBuild('tm-scope-wrap');
      _geiScopeTakeAllMissed();
      if (_geiScopeMissed.some(m => m.id === 'access-permit')) _geiScopeTakeMissed('access-permit');
      let d = ''; const real = window._showProposalPreviewOverlay;
      window._showProposalPreviewOverlay = h => { d = h; };
      try { await sendGenericProposal(true); } finally { window._showProposalPreviewOverlay = real; }
      return { html: d, steps: _geiScopeChips.slice() };
    }, said);
  };

  const text = (html) => page.evaluate((h) => { const d = document.createElement('div'); d.innerHTML = h; return d.innerText || d.textContent; }, html);

  // ── HETTY: WHAT THE MONEY BUYS ────────────────────────────────────────────

  test('Hetty reads what the price buys before she reads the price', async () => {
    const { html } = await byoDoc(JOB);
    const t = await text(html);
    expect(t).toContain('Included in your price');
    ['All labor and materials', 'Permit and inspection', '1-year warranty on the work',
      'Licensed contractor, #KS-PL-4471'].forEach(x => expect(t, x).toContain(x));
    // Dropped 2026-09-23 (§10.4): protection, testing and the haul-away are
    // steps in the scope right above, and a married Hetty and Barry read them
    // listed twice as padding. The list says only what the steps cannot.
    ['Your home protected', 'Tested before we leave', 'Haul-away'].forEach(x => expect(t, x).not.toContain(x));
    const iScope = t.indexOf('Scope of work'), iInc = t.indexOf('Included in your price'), iPrice = t.indexOf('YOUR PRICE');
    expect(iScope).toBeGreaterThan(-1);
    expect(iInc).toBeGreaterThan(iScope);
    expect(iPrice, 'the price comes after what it buys').toBeGreaterThan(iInc);
  });

  // Two dollar figures only, the price and the deposit (the owner's standing
  // rule in e2e-layout-integrity-regression); the rest is said in words.
  test('Hetty knows when every dollar is due', async () => {
    const { html } = await byoDoc(JOB);
    const rows = await page.evaluate((h) => {
      const d = document.createElement('div'); d.innerHTML = h;
      return [...d.querySelectorAll('tfoot tr')].map(tr => tr.textContent.trim());
    }, html);
    const iPrice = rows.findIndex(x => /YOUR PRICE/.test(x));
    const iDep = rows.findIndex(x => /Deposit Due Before Work Begins/i.test(x));
    const iBal = rows.findIndex(x => x === 'The rest is due when the work is done. Nothing else is due before then.');
    expect([iPrice, iDep, iBal], JSON.stringify(rows)).toEqual([0, 1, 2]);
    expect(rows.join(' ').match(/\$[\d,]+\.\d{2}/g).length, 'still only two figures').toBe(2);
  });

  test('Hetty is told the number cannot creep', async () => {
    const t = await text((await byoDoc(JOB)).html);
    expect(t).toContain('Fixed price for the work listed');
    expect(t).toContain('change order you sign');
  });

  test('no padding for Hetty to circle: a line that says what it is carries no filler', async () => {
    const { html } = await byoDoc(JOB);
    expect(html).not.toContain('per agreed scope');
    expect(html).not.toContain('Included in project total');
  });

  test('no line prices, no hourly rate, no junk', async () => {
    const t = await text((await byoDoc(JOB)).html);
    const scope = t.slice(t.indexOf('Scope of work'), t.indexOf('YOUR PRICE'));
    expect(scope, 'no dollar figure inside the scope').not.toMatch(/\$\d/);
    expect(t).not.toMatch(/\bNaN\b|\bundefined\b|\[object|\bnull\b/);
  });

  // ── BARRY: A PLAN HE WOULD RATHER NOT RUN ─────────────────────────────────

  test('Barry reads the job as stages, in the order the work happens', async () => {
    const { html, lines } = await byoDoc(JOB);
    const t = await text(html);
    const heads = ['Before we start', 'Protecting your home', 'Out with the old', 'The new work'];
    heads.forEach(h => expect(t, h).toContain(h));
    const ix = heads.map(h => t.indexOf(h));
    expect(ix, 'stages print in work order').toEqual([...ix].sort((a, b) => a - b));
    // Numbering runs on across the headings, one step per line he priced.
    const nums = await page.evaluate((h) => {
      const d = document.createElement('div'); d.innerHTML = h;
      return [...d.querySelectorAll('.prop-stage ol')].map(o => [Number(o.getAttribute('start') || 1), o.children.length]);
    }, html);
    let next = 1;
    nums.forEach(([start, n]) => { expect(start).toBe(next); next += n; });
    expect(next - 1).toBe(lines.length);
  });

  // Owner 2026-09-23: "tim should be smart enough to add in the model and
  // venting requirements". What the couple read as the change order waiting.
  test('the unit is named, and what it hooks up to is in the price', async () => {
    const t = await text((await byoDoc(JOB)).html);
    expect(t).toContain('Set a tankless, Navien NPE-240A');
    expect(t).toMatch(/gas line against the new unit/);
    expect(t).toMatch(/venting for the new unit/);
    expect(t).toMatch(/condensate drain/);
  });

  test('Barry sees the steps he would have skipped, written for him', async () => {
    const t = await text((await byoDoc(JOB)).html);
    expect(t).toMatch(/water off/i);
    expect(t).toMatch(/permit/i);
    expect(t).toMatch(/Pressure test/i);
  });

  // Dropped 2026-09-23 (§10.4) after the same two readers read it in
  // character: "No tools to buy or rent, no trips to the dump, no weekends
  // given up" drew "Young man, I like my weekends in the garage" from him and
  // "Don't tell me what my time is worth" from her. It talked down to both.
  test('nobody is told what their weekends are worth', async () => {
    const t = await text((await byoDoc(JOB)).html);
    expect(t).not.toMatch(/weekends|No tools to buy/);
  });

  test('the project says what the job is, from his own steps', async () => {
    expect(await text((await byoDoc(JOB)).html)).toContain('Water heater replacement');
    const paint = await tmDoc('pressure wash the house, scrape and caulk the trim, prime the bare wood and paint two coats');
    expect(await text(paint.html)).toContain('Exterior painting');
    // Nothing coming out, not a paint job: the trade name stays.
    expect(await text((await byoDoc('replace the kitchen faucet and the supply lines', { take: false })).html)).toContain('Plumbing service');
  });

  test('the heater itself: manufacturer warranties pass to her, as the terms say', async () => {
    const t = await text((await byoDoc(JOB)).html);
    expect(t).toContain('Manufacturer warranties pass to you');
  });

  test('nothing on the page is written to frighten him', async () => {
    const t = await text((await byoDoc(JOB)).html);
    const scope = t.slice(t.indexOf('Scope of work'), t.indexOf('YOUR PRICE'));
    expect(scope).not.toMatch(/\b(hazard|danger|dangerous|unsafe|disaster|catastroph|forgot|you forgot|fail(ed|ure)?|risk)\b/i);
  });

  // ── EARL'S RULE: NOTHING CLAIMED THAT HE DID NOT SAY OR SET ───────────────

  test('no licence in Settings, no licence line; no warranty set, no warranty line', async () => {
    const t = await text((await byoDoc(JOB, { blic: '', warranty: '' })).html);
    expect(t).not.toContain('Licensed contractor');
    expect(t).not.toMatch(/warranty on the work/);
  });

  test('no permit step, no permit line; no haul-away step, no haul-away line', async () => {
    const t = await text((await byoDoc('replace the kitchen faucet and the supply lines', { take: false })).html);
    expect(t).not.toContain('Permit and inspection');
    expect(t).not.toContain('Haul-away');
    // A short job is a short list: no stage headings over two lines.
    expect(t).not.toContain('Before we start');
  });

  // ── TIME AND MATERIALS, THE SAME PROMISE ──────────────────────────────────

  // A paint job: the prep stage is said around a scrape, and it still reads as
  // one heading; painters do not "test", they walk it with the customer.
  test('a paint job reads as one prep stage, and never says testing', async () => {
    const t = await text((await tmDoc('pressure wash the house, scrape and caulk the trim, prime the bare wood and paint two coats')).html);
    expect(t.split('Getting it ready').length - 1).toBe(1);
    expect(t).not.toContain('Tested before we leave');
    // "Testing paint? You watch it dry, do you?"
    expect(t).not.toContain('Finishing and testing');
    expect(t).toContain('Finishing');
  });

  // "TIME & MATERIALS" in the big bar read as "the meter runs" to both of
  // them before they reached the cap at the bottom. With a cap, the cap leads.
  test('time and materials with a ceiling: the ceiling is the big number, first', async () => {
    const r = await page.evaluate(async () => {
      bids.length = 0; clients.length = 0;
      clients.push({ id: 97001, name: 'Hetty Green', addr: '412 Bell St, Topeka, KS 66603' });
      currentClientId = 97001; _activeTrade = 'painting';
      openTMEstimate(getClientById(97001));
      document.getElementById('gei-scope-say').value = 'pressure wash the house and paint two coats';
      _geiScopeBuild('tm-scope-wrap');
      const on = document.getElementById('tm-nte-on'); if (on) { on.checked = true; on.dispatchEvent(new Event('change')); }
      const c = document.getElementById('tm-nte-cap'); if (c) { c.value = '6800'; c.dispatchEvent(new Event('input')); }
      let d = ''; const real = window._showProposalPreviewOverlay;
      window._showProposalPreviewOverlay = h => { d = h; };
      try { await sendGenericProposal(true); } finally { window._showProposalPreviewOverlay = real; }
      const el = document.createElement('div'); el.innerHTML = d;
      return [...el.querySelectorAll('tfoot tr')].map(tr => tr.textContent.trim());
    });
    expect(r[0]).toMatch(/^Most you'll pay/);
    expect(r[0]).toContain('$6,800');
    expect(r.join(' ')).not.toContain('TIME & MATERIALS');
    expect(r[1]).toContain('Billed weekly');
  });

  test('time and materials: stages and what is included, above the number', async () => {
    const { html, steps } = await tmDoc(JOB);
    expect(steps.length).toBeGreaterThan(4);
    const t = await text(html);
    ['Before we start', 'The new work', 'Included', 'Permit and inspection', 'Finishing and testing']
      .forEach(x => expect(t, x).toContain(x));
    // Billed as used, so never "included": the read-through caught the page
    // contradicting its own price box.
    expect(t).not.toContain('All labor and materials');
    expect(t).not.toContain('Included in your price');
    expect(t).not.toMatch(/\bNaN\b|\bundefined\b|\[object/);
  });

  test('no console errors', async () => { assertNoErrors(page, 'proposal closes'); });
});
