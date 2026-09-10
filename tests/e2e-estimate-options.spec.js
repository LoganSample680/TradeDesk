// @ts-check
/**
 * Options on one job, and units that match the trade.
 *
 * Owner 2026-09-07: "options were added for Zach's Bettis bids." The shape
 * those took is right and does not change: two GENUINELY different proposals,
 * each its own record, scope, total and signed contract. What was missing is
 * the half the client lives in. They got two separate documents and two links
 * and were left to compare. Every HVAC and roofing tool ships options on ONE
 * document because that moves the conversation from yes/no to which one.
 *
 * And the unit list was painting-and-plumbing shaped, so a roofer pricing
 * SQUARES, an HVAC tech pricing TONS and a landscaper pricing CUBIC YARDS all
 * got told the tool was not built for them. That pattern loses those offices
 * inside a few months, per the review data.
 *
 * What we verify:
 *  1. Duplicating stamps a shared group, A/B/C labels, never a second B
 *  2. The client's document lists the whole group with prices, marking theirs
 *  3. A draft option is never priced to a client
 *  4. Signing one retires the rest, both in person and from the hub
 *  5. Units lead with his trade and never lose one already stored
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const OP_CLIENT = 87001;

test.describe('options on one job', () => {
  let page;

  const seedGroup = () => page.evaluate(cid => {
    clients = clients.filter(c => c.id !== cid).concat([{ id: cid, name: 'Bettis', addr: '3 Option Way', phone: '3165550003' }]);
    bids = bids.filter(b => ![87101, 87102, 87103].includes(b.id)).concat([
      { id: 87101, client_id: cid, client_name: 'Bettis', type: 'Reroof, Option A', amount: 12400, status: 'Pending', draft: false, optionGroup: 87101, optionLabel: 'A', proposalSentDate: '2026-09-05', signingToken: 'tok-a' },
      { id: 87102, client_id: cid, client_name: 'Bettis', type: 'Reroof with new decking, Option B', amount: 15900, status: 'Pending', draft: false, optionGroup: 87101, optionLabel: 'B', proposalSentDate: '2026-09-05' },
      { id: 87103, client_id: cid, client_name: 'Bettis', type: 'Reroof, standing seam, Option C', amount: 28750, status: 'Draft', draft: true, optionGroup: 87101, optionLabel: 'C' }
    ]);
  }, OP_CLIENT);

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => { window.supaLoadFromCloud = async () => {}; });
  });
  test.afterAll(async () => { await page.context().close(); });

  // ── 1. The group ───────────────────────────────────────────────────────────

  test('siblings come back oldest-label first, and a lone bid has none', async () => {
    await seedGroup();
    const r = await page.evaluate(() => ({
      labels: _optionSiblings(bids.find(b => b.id === 87102)).map(x => x.optionLabel),
      group: _optionGroupOf(bids.find(b => b.id === 87103)),
      alone: _optionSiblings({ id: 1, optionGroup: null }).length,
      nul: _optionSiblings(null).length
    }));
    expect(r.labels).toEqual(['A', 'B', 'C']);
    expect(r.group, 'the group is the first option\'s own id, no new id space').toBe(87101);
    expect(r.alone).toBe(0);
    expect(r.nul).toBe(0);
  });

  test('the next label is the first free letter, never a second B', async () => {
    const r = await page.evaluate(() => ({
      afterA: _optionNextLabel([{ optionLabel: 'A' }]),
      afterAC: _optionNextLabel([{ optionLabel: 'A' }, { optionLabel: 'C' }]),
      none: _optionNextLabel([]),
      junk: _optionNextLabel(null)
    }));
    expect(r.afterA).toBe('B');
    expect(r.afterAC, 'B is free again once C exists, and that is correct').toBe('B');
    expect(r.none).toBe('A');
    expect(r.junk).toBe('A');
  });

  test('a cancelled option leaves the group', async () => {
    const n = await page.evaluate(() => {
      const b = bids.find(x => x.id === 87103); b.cancelledAt = '2026-09-06T10:00:00Z';
      const out = _optionSiblings(bids.find(x => x.id === 87101)).length;
      delete b.cancelledAt;
      return out;
    });
    expect(n).toBe(2);
  });

  // ── 2 + 3. What the client reads ───────────────────────────────────────────

  test('the document lists every SENT option with its price and marks this one', async () => {
    await seedGroup();
    const html = await page.evaluate(async () => {
      _geiEditBidId = 87102; _geiIsFreeForm = true; _geiIsTM = false;
      _byoItems = [_byoNormItem({ id: 1, section: 'Work', label: 'Tear-off and reroof', qty: 32, unit: 'square', rate: 420, notes: 'Strip to deck, ice and water at the eaves', on: true })];
      _geiScopeChips = [];
      _byoUpdateRail();   // BYO syncs its items into _geiLines before totalling
      return await sendGenericProposal(true, { silent: true });
    });
    expect(html).toContain('Your options');
    expect(html).toContain('Option A');
    expect(html).toContain('$12,400.00');
    expect(html).toContain('Option B');
    expect(html, 'the one they opened is marked, so the page is never ambiguous').toContain('this one');
    expect(html, 'the live total of the document they are reading, 32 squares at $420').toContain('$13,440.00');
    expect(html).toContain('Tap any option to read it');
    // A price with no way to read what it buys is worse than not listing it:
    // they can see there is a cheaper option and cannot find out what it
    // leaves out. Every sibling with a signing link is a link.
    expect(html, 'the other option must be reachable, not just priced').toContain('sign.html?t=tok-a');
    expect(html).toContain('read it');
    expect(html, 'a DRAFT option is not an offer and must never be priced to a client').not.toContain('$28,750.00');
    expect(html, 'and its name must not leak either').not.toContain('standing seam');
  });

  test('an option with no signing link yet is listed but not linkable', async () => {
    await seedGroup();
    const html = await page.evaluate(async () => {
      // A sent option that has no token (in-person signing, cash close) still
      // belongs on the list. It just cannot be opened, so it must not pretend.
      bids.find(b => b.id === 87101).signingToken = null;
      _geiEditBidId = 87102; _geiIsFreeForm = true; _geiIsTM = false; _geiScopeChips = [];
      _byoItems = [_byoNormItem({ id: 1, section: 'Work', label: 'Reroof', rate: 15900, on: true })];
      _byoUpdateRail();
      return await sendGenericProposal(true, { silent: true });
    });
    expect(html).toContain('Option A');
    expect(html).toContain('$12,400.00');
    expect(html, 'no token means no page to send them to').not.toContain('sign.html?t=null');
    // Scoped to the options block: "read it" is ordinary English and appears
    // in the terms further down, so a whole-document search proves nothing.
    const block = html.split('Your options')[1].split('Tap any option')[0];
    expect(block).not.toContain('read it');
    expect(block).not.toContain('<a href');
  });

  test('the one they are reading is never a link to itself', async () => {
    await seedGroup();
    const html = await page.evaluate(async () => {
      bids.find(b => b.id === 87102).signingToken = 'tok-b';
      _geiEditBidId = 87102; _geiIsFreeForm = true; _geiIsTM = false; _geiScopeChips = [];
      _byoItems = [_byoNormItem({ id: 1, section: 'Work', label: 'Reroof', rate: 15900, on: true })];
      _byoUpdateRail();
      return await sendGenericProposal(true, { silent: true });
    });
    expect(html).toContain('this one');
    const block = html.split('Your options')[1].split('Tap any option')[0];
    expect(block, 'linking the page to itself is a dead tap').not.toContain('tok-b');
  });

  test('a bid in no group prints no options block', async () => {
    const html = await page.evaluate(async () => {
      bids = bids.filter(b => b.id !== 87900).concat([{ id: 87900, client_id: 87001, client_name: 'Bettis', type: 'One and done', amount: 500, status: 'Pending' }]);
      _geiEditBidId = 87900; _geiIsFreeForm = true;
      _byoItems = [_byoNormItem({ id: 1, section: 'Work', label: 'Service call', rate: 500, on: true })];
      return await sendGenericProposal(true, { silent: true });
    });
    expect(html).not.toContain('Your options');
  });

  test('a group of one prints no options block either', async () => {
    const html = await page.evaluate(async () => {
      bids = bids.filter(b => ![87102, 87103].includes(b.id));
      _geiEditBidId = 87101; _geiIsFreeForm = true;
      _byoItems = [_byoNormItem({ id: 1, section: 'Work', label: 'Reroof', rate: 12400, on: true })];
      return await sendGenericProposal(true, { silent: true });
    });
    expect(html, 'one option is not a choice').not.toContain('Your options');
  });

  // ── 4. Signing one closes the others ───────────────────────────────────────

  test('signing an option marks the rest lost, naming the one they chose', async () => {
    await seedGroup();
    const r = await page.evaluate(() => {
      const won = bids.find(b => b.id === 87102);
      won.status = 'Closed Won'; won.signedAt = '2026-09-06T18:00:00.000Z';
      const changed = _optionRetireSiblings(won);
      return {
        changed,
        a: bids.find(b => b.id === 87101),
        c: bids.find(b => b.id === 87103),
        won: bids.find(b => b.id === 87102).status
      };
    });
    expect(r.changed).toBe(true);
    expect(r.a.status).toBe('Closed Lost');
    expect(r.a.lostReason, 'the reason field his own Mark Lost already writes').toBe('Client chose Option B');
    expect(r.a.lostAt).toBe('2026-09-06T18:00:00.000Z');
    expect(r.c.status, 'an unsent draft option closes out too, it is off the table').toBe('Closed Lost');
    expect(r.won).toBe('Closed Won');
  });

  test('an option already won or already lost is never overwritten', async () => {
    await seedGroup();
    const r = await page.evaluate(() => {
      const a = bids.find(b => b.id === 87101);
      a.status = 'Closed Lost'; a.lostReason = 'Went with the other guy'; a.lostAt = '2026-09-01T00:00:00.000Z';
      const won = bids.find(b => b.id === 87102);
      won.status = 'Closed Won'; won.signedAt = '2026-09-06T18:00:00.000Z';
      _optionRetireSiblings(won);
      return bids.find(b => b.id === 87101);
    });
    expect(r.lostReason, 'a real reason he recorded himself outranks ours').toBe('Went with the other guy');
    expect(r.lostAt).toBe('2026-09-01T00:00:00.000Z');
  });

  test('a lone bid retires nothing and never throws', async () => {
    const r = await page.evaluate(() => {
      const out = [];
      [null, undefined, {}, { id: 1, optionGroup: null, status: 'Closed Won' }].forEach(b => {
        try { out.push(_optionRetireSiblings(b)); } catch (e) { out.push('THREW:' + e.message); }
      });
      return out;
    });
    expect(r).toEqual([false, false, false, false]);
  });

  test('both signing paths retire siblings, in person and from the hub', async () => {
    const r = await page.evaluate(() => ({
      inPerson: /_optionRetireSiblings\(bid\)/.test(String(_geiConfirmInPerson || '')),
      remote: typeof _applySigStatusToBid === 'function' && /_optionRetireSiblings/.test(String(_applySigStatusToBid))
    }));
    expect(r.inPerson, 'signing on the tailgate must close the others too').toBe(true);
    expect(r.remote, 'and so must a signature that lands from the client hub').toBe(true);
  });

  // ── 5. Units that match the trade ──────────────────────────────────────────

  test('every trade leads with its own unit', async () => {
    const r = await page.evaluate(() => ({
      roofing: _byaUnitList('roofing')[0],
      hvac: _byaUnitList('hvac')[0],
      land: _byaUnitList('landscaping')[0],
      paint: _byaUnitList('painting')[0],
      elec: _byaUnitList('electrical').slice(0, 4)
    }));
    expect(r.roofing, 'a roofer prices squares').toBe('square');
    expect(r.hvac, 'HVAC prices tons').toBe('ton');
    expect(r.land, 'landscaping and concrete price cubic yards').toBe('cu yd');
    expect(r.paint).toBe('sq ft');
    expect(r.elec).toContain('circuit');
  });

  test('the full list is always reachable, nothing is hidden', async () => {
    const r = await page.evaluate(() => {
      const l = _byaUnitList('painting');
      return { hasSquare: l.includes('square'), hasTon: l.includes('ton'), hasCuYd: l.includes('cu yd'), dupes: l.length !== new Set(l).size };
    });
    expect(r.hasSquare, 'a painter does occasionally sell a square of roof').toBe(true);
    expect(r.hasTon).toBe(true);
    expect(r.hasCuYd).toBe(true);
    expect(r.dupes, 'a unit must appear once, however many lists name it').toBe(false);
  });

  test('a unit stored on an older line still shows when editing it', async () => {
    const r = await page.evaluate(() => {
      _geiTrade = 'painting';
      const html = _byaQtyRateHTML(3, 'bushel', 12);
      return { has: html.includes('>bushel<'), selected: /value="bushel" selected/.test(html) };
    });
    expect(r.has, 'editing a line must never silently retitle its unit').toBe(true);
    expect(r.selected).toBe(true);
  });

  test('an unknown trade still gets a sane list', async () => {
    const r = await page.evaluate(() => ({ junk: _byaUnitList('underwater basket weaving')[0], nul: _byaUnitList(null).length > 0 }));
    expect(r.junk).toBe('ea');
    expect(r.nul).toBe(true);
  });

  test('no console errors across the options loop', async () => {
    await assertNoErrors(page);
  });
});
