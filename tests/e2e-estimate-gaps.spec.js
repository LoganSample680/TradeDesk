// @ts-check
/**
 * The complaints an estimate tool earns, closed.
 *
 * Owner 2026-09-07: "I want no possible avenue for bitching." Research the
 * same day, across trades:
 *
 *  - A missing EXCLUSIONS list is the thing homeowner guides teach people to
 *    treat as a red flag, and estimate-terms guides call it the first line of
 *    defense against a dispute. Permits, asbestos, damage found after demo,
 *    owner-supplied materials, disposal. TradeDesk had none of it.
 *  - Retyping a line to say the same thing about the next room is the reason
 *    the fast way to build a bid is still a notepad.
 *
 * What we verify:
 *  1. Exclusions: trade presets, custom text, toggle off, persistence
 *  2. They print on the client's copy, and nothing prints when none are picked
 *  3. Copy a line: everything rides along, names never collide, RRP is exempt
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('closing the gaps other estimate tools leave open', () => {
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
  test.beforeEach(async () => {
    await page.evaluate(() => {
      _geiExclusions = []; _byoItems = []; _geiLines = []; _geiScopeChips = [];
      _geiIsFreeForm = true; _geiIsTM = false; _geiScopeNoScope = false; _geiTrade = 'general';
      document.getElementById('_byo-add-modal')?.remove();
    });
  });

  // ── 1. Exclusions ──────────────────────────────────────────────────────────

  test('every trade is offered its own exclusions first, then the universal ones', async () => {
    const r = await page.evaluate(() => ({
      roof: _exclList('roofing')[0],
      hvac: _exclList('hvac')[0],
      plumb: _exclList('plumbing')[0],
      elec: _exclList('electrical')[0],
      allHavePermits: ['roofing', 'hvac', 'plumbing', 'electrical', 'painting', 'landscaping', 'general']
        .every(t => _exclList(t).some(x => /Permits/.test(x))),
      junk: _exclList('nonsense').length
    }));
    expect(r.roof).toContain('Deck replacement');
    expect(r.hvac).toContain('Electrical service');
    expect(r.plumb).toContain('Wall, ceiling and floor repair');
    expect(r.elec).toContain('Drywall patch');
    expect(r.allHavePermits, 'permits are the one every trade gets asked about').toBe(true);
    expect(r.junk).toBeGreaterThan(0);
  });

  test('toggling on, off, and adding a custom line', async () => {
    const r = await page.evaluate(() => {
      const first = _exclList()[0];
      _exclToggle(first);
      const on = _geiExclusions.slice();
      _exclToggle(first);
      const off = _geiExclusions.slice();
      _exclToggle(first);
      return { on, off, after: _geiExclusions.slice(), first };
    });
    expect(r.on).toEqual([r.first]);
    expect(r.off).toEqual([]);
    expect(r.after).toEqual([r.first]);
  });

  test('a custom exclusion joins the list and can be turned back off the same way', async () => {
    const r = await page.evaluate(() => {
      _geiRenderExclusions('byo');
      document.getElementById('gei-excl-custom').value = 'Moving the piano';
      _exclAddCustom();
      const added = _geiExclusions.slice();
      const inChips = (document.getElementById('byo-excl-wrap').textContent || '').includes('Moving the piano');
      _exclToggle('Moving the piano');
      return { added, inChips, after: _geiExclusions.slice(), cleared: document.getElementById('gei-excl-custom').value };
    });
    expect(r.added).toEqual(['Moving the piano']);
    expect(r.inChips, 'a typed one sits with the presets so the list reads as one thing').toBe(true);
    expect(r.after).toEqual([]);
    expect(r.cleared, 'the box clears so he can type the next one').toBe('');
  });

  test('empty, whitespace and duplicate custom entries are refused', async () => {
    const r = await page.evaluate(() => {
      _geiRenderExclusions('byo');
      const set = v => { document.getElementById('gei-excl-custom').value = v; _exclAddCustom(); };
      set(''); set('   '); set('Permit runs'); set('Permit runs');
      return _geiExclusions.slice();
    });
    expect(r).toEqual(['Permit runs']);
  });

  test('exclusions survive a save and come back on resume', async () => {
    const r = await page.evaluate(() => {
      const src = String(_byoAutosave || '') + String(saveGenericEstimate || '') + String(openGenericEstimate || '');
      return {
        saved: (src.match(/exclusions\s*[:=]/g) || []).length,
        restored: /Array\.isArray\((b|_b)\.exclusions\)/.test(src)
      };
    });
    expect(r.saved, 'autosave and both branches of the deliberate save').toBeGreaterThanOrEqual(3);
    expect(r.restored).toBe(true);
  });

  test('the card counts what is on the proposal, and says optional when none are', async () => {
    const r = await page.evaluate(() => {
      _geiRenderExclusions('byo');
      const none = document.getElementById('byo-excl-wrap').textContent;
      _exclToggle(_exclList()[0]); _exclToggle(_exclList()[1]);
      const two = document.getElementById('byo-excl-wrap').textContent;
      return { none, two };
    });
    expect(r.none).toContain('optional');
    expect(r.two).toContain('2 on the proposal');
  });

  test('_geiRenderExclusions never throws with no container', async () => {
    const ok = await page.evaluate(() => {
      try { _geiRenderExclusions('nope'); _geiRenderExclusions(); return true; } catch (e) { return String(e); }
    });
    expect(ok).toBe(true);
  });

  // ── 2. On the client's copy ────────────────────────────────────────────────

  test('the client reads the boundary right after the scope', async () => {
    const html = await page.evaluate(async () => {
      _geiExclusions = ['Permits, plan review and inspection fees', 'Hazardous materials (asbestos, lead, mold)'];
      _byoItems = [_byoNormItem({ id: 1, section: 'Work', label: 'Reroof', qty: 30, unit: 'square', rate: 400, notes: 'Strip to deck', on: true })];
      _byoUpdateRail();
      return await sendGenericProposal(true, { silent: true });
    });
    expect(html).toContain('Not included');
    expect(html).toContain('Permits, plan review');
    expect(html).toContain('Hazardous materials');
    expect(html, 'and it points at the way to add any of it, so it reads as a door not a wall').toContain('written change order');
  });

  test('no exclusions picked prints no section at all', async () => {
    const html = await page.evaluate(async () => {
      _geiExclusions = [];
      _byoItems = [_byoNormItem({ id: 1, section: 'Work', label: 'Reroof', rate: 12000, on: true })];
      _byoUpdateRail();
      return await sendGenericProposal(true, { silent: true });
    });
    expect(html).not.toContain('Not included');
  });

  test('a custom exclusion is escaped, never injected', async () => {
    const html = await page.evaluate(async () => {
      _geiExclusions = ['<img src=x onerror=alert(1)>'];
      _byoItems = [_byoNormItem({ id: 1, section: 'Work', label: 'Work', rate: 100, on: true })];
      _byoUpdateRail();
      return await sendGenericProposal(true, { silent: true });
    });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  // ── 3. Copy a line ─────────────────────────────────────────────────────────

  test('a copy carries the count, the rate and the description', async () => {
    const r = await page.evaluate(() => {
      _byoItems = [_byoNormItem({ id: 1, section: 'Work', label: 'Bedroom 1, walls only', qty: 3, unit: 'room', rate: 240, notes: 'Two coats, cut in by hand', on: true })];
      _byoDupItem(0);
      return _byoItems;
    });
    expect(r.length).toBe(2);
    expect(r[1].label, 'named so two identical rows never reach a client').toBe('Bedroom 1, walls only (2)');
    expect(r[1].qty).toBe(3);
    expect(r[1].unit).toBe('room');
    expect(r[1].rate).toBe(240);
    expect(r[1].price).toBe(720);
    expect(r[1].notes, 'the description is the part that made copying worth doing').toBe('Two coats, cut in by hand');
    expect(r[1].id).not.toBe(r[0].id);
  });

  test('the copy lands directly under the original, not at the bottom', async () => {
    const labels = await page.evaluate(() => {
      _byoItems = [
        _byoNormItem({ id: 1, section: 'Work', label: 'First', rate: 100, on: true }),
        _byoNormItem({ id: 2, section: 'Work', label: 'Second', rate: 200, on: true })
      ];
      _byoDupItem(0);
      return _byoItems.map(x => x.label);
    });
    expect(labels).toEqual(['First', 'First (2)', 'Second']);
  });

  test('copying a copy counts up, it never collides', async () => {
    const labels = await page.evaluate(() => {
      _byoItems = [_byoNormItem({ id: 1, section: 'Work', label: 'Window', rate: 80, on: true })];
      _byoDupItem(0); _byoDupItem(0); _byoDupItem(0);
      return _byoItems.map(x => x.label).sort();
    });
    expect(labels).toEqual(['Window', 'Window (2)', 'Window (3)', 'Window (4)']);
  });

  test('a disclosure insert cannot be copied, and junk never throws', async () => {
    const r = await page.evaluate(() => {
      _byoItems = [_byoNormItem({ id: 1, section: 'Disclosures', label: 'Lead-safe practices', rate: 0, _rrp: true, on: true })];
      _byoDupItem(0);
      const rrp = _byoItems.length;
      let threw = false;
      try { _byoDupItem(99); _byoDupItem(-1); _byoDupItem(null); } catch (e) { threw = true; }
      return { rrp, threw };
    });
    expect(r.rrp, 'boilerplate the app injects is not his line to duplicate').toBe(1);
    expect(r.threw).toBe(false);
  });

  test('the row offers a duplicate button, and a disclosure row does not', async () => {
    const r = await page.evaluate(() => ({
      normal: _geiItemRowHtml({ label: 'X', notes: '', price: 100, editFn: '_byoEditItem(0)', delFn: 'x', dupFn: '_byoDupItem(0)', checked: true }),
      rrp: _geiItemRowHtml({ label: 'X', notes: '', price: 0, editFn: '_byoEditItem(0)', delFn: 'x', dupFn: '', checked: true })
    }));
    // An icon, not the word: three text buttons squeezed the title column
    // until a four-letter label broke across two lines on a phone.
    expect(r.normal).toContain('Duplicate this line');
    expect(r.normal, 'a third word-button does not fit a 390px row').not.toContain('>Copy<');
    expect(r.rrp).not.toContain('Duplicate this line');
  });

  test('no console errors across the gap-closing loop', async () => {
    await assertNoErrors(page);
  });
});
