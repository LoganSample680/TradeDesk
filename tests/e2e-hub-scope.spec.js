// @ts-check
/**
 * The client hub snapshot carries the estimate's SCOPE, not just its type.
 *
 * Owner 2026-08-16, asking how the invoice pulls detail from the proposal: it did
 * not. The invoice rendered bid.lineItems, a field no bid has ever had, so every
 * real invoice fell through to a single line reading the estimate type. The rich
 * "Work performed" list only ever appeared in seeded screenshots.
 *
 * bid.scope is now derived from where scope actually lives: surfaces on a paint
 * estimate (grouped by room), scopeChips and geiDesc on generic and BYO estimates,
 * desc on a diagnostic. Strings only, by construction, so the one-price rule holds:
 * there is no quantity or rate in this list to leak onto the document.
 */
const { test, expect, mockAllExternal, waitForAppBoot } = require('./helpers');
test('snapshot derives scope from each estimate type', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
  const page = await ctx.newPage();
  await mockAllExternal(page);
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await waitForAppBoot(page);
  const r = await page.evaluate(() => {
    clients.push({ id: 96001, name: 'Scope Client', phone: '3165550100', addr: '7 Scope St' });
    bids.push({ id: 960010, client_id: 96001, amount: 2000, status: 'Closed Won', type: 'Interior',
      surfaces: [{ room: 'Living Room', type: 'walls', qty: 400 }, { room: 'Living Room', type: 'ceiling', qty: 200 },
                 { room: 'Hallway', type: 'walls', qty: 120 }] });
    bids.push({ id: 960011, client_id: 96001, amount: 1500, status: 'Closed Won', type: 'Build Your Own Estimate',
      scopeChips: ['Panel upgrade', 'Add two circuits'], geiDesc: 'Replace exterior GFCI\nHaul off debris' });
    const snap = _buildClientHubSnapshot(96001);
    const a = snap.bids.find(b => b.id === 960010), b = snap.bids.find(b => b.id === 960011);
    return { paint: a.scope, gen: b.scope };
  });
  console.log(JSON.stringify(r, null, 1));
  expect(r.paint).toEqual(['Living Room: walls, ceiling', 'Hallway: walls']);
  expect(r.gen).toEqual(['Panel upgrade', 'Add two circuits', 'Replace exterior GFCI', 'Haul off debris']);
  await ctx.close();
});

// ── A HUB RE-UPLOADS WHEN SOMETHING HAPPENED, NOT WHEN TIME PASSED ─────────
// Owner's rule, 2026-09-18: "the only updates that should be made to client hub
// where it would push a new update is if something got sent or signed or paid
// or any action taken on the hub or the Contractor sent something new."
//
// _uploadClientHub already gated its storage write on a content hash, and the
// boot sweep's own comment leaned on that gate. It could never fire: the hashed
// JSON contained generatedAt, a fresh timestamp on every call, so the hash was
// different every time by construction. Every tokened client re-uploaded its
// hub and re-stamped clientHubHash on its client row on EVERY boot: one lead of
// the owner's carried 50 such stamps in five days, all different, with no human
// edit to the record in between, and that kept a row nobody had touched
// permanently "changed" for the delta save.
//
// Everything the owner listed (sent, signed, paid, an action on the hub, a new
// document) lands in the bids, payments, jobs or photos of the snapshot, so the
// content hash IS his rule once the clock is out of it.
test.describe('the hub content hash ignores the clock', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  // Seeded per test, and idempotently, rather than once in beforeAll.
  // waitForAppBoot returning does not mean every boot task has landed: the
  // restore path ASSIGNS clients (clients = _cd.clients) rather than filling
  // it, so a late task swaps the array out from under a push made before it ran
  // and takes the seeded row with it. _buildClientHubSnapshot then returns null
  // for a client it cannot find, JSON.stringify(null) is the string "null", and
  // the assertion that generatedAt is in that JSON fails with no hint of why.
  // Seen on WebKit shard 3: the first test in this group passed and the second
  // did not, so the wipe landed between them. Re-seeding costs nothing and does
  // not care when the boot finishes.
  test.beforeEach(async () => {
    await page.evaluate(() => {
      if (!clients.some(c => c && c.id === 96100)) {
        clients.push({ id: 96100, name: 'Hash Client', phone: '3165550111', addr: '9 Hash St' });
      }
      if (!bids.some(b => b && b.id === 961000)) {
        bids.push({ id: 961000, client_id: 96100, amount: 1200, status: 'Sent', type: 'Interior' });
      }
    });
  });

  // Hash the snapshot exactly as _uploadClientHub does.
  const hash = () => page.evaluate(() =>
    _hubHash(JSON.stringify(_buildClientHubSnapshot(96100), (k, v) => k === 'generatedAt' ? undefined : v)));

  test('the same hub hashed twice is the same hash', async () => {
    const a = await hash();
    await page.waitForTimeout(1100);   // a different generatedAt by any clock
    expect(await hash()).toBe(a);
  });

  test('the raw JSON still differs, so this is the replacer doing the work', async () => {
    const r = await page.evaluate(async () => {
      const a = JSON.stringify(_buildClientHubSnapshot(96100));
      await new Promise(x => setTimeout(x, 1100));
      const b = JSON.stringify(_buildClientHubSnapshot(96100));
      return { same: a === b, hasStamp: a.indexOf('generatedAt') >= 0 };
    });
    expect(r.hasStamp).toBe(true);   // it still ships inside the uploaded file
    expect(r.same).toBe(false);      // and it still moves, it just gets no vote
  });

  const change = (fn) => page.evaluate((src) => {
    const h = () => _hubHash(JSON.stringify(_buildClientHubSnapshot(96100), (k, v) => k === 'generatedAt' ? undefined : v));
    const before = h();
    (new Function('return (' + src + ')'))()();
    return { before, after: h() };
  }, fn.toString());

  test('sending a new estimate changes it', async () => {
    const r = await change(() => { bids.push({ id: 961001, client_id: 96100, amount: 800, status: 'Sent', type: 'Interior' }); });
    expect(r.after).not.toBe(r.before);
  });

  test('signing changes it', async () => {
    const r = await change(() => {
      const b = bids.find(x => x.id === 961001);
      b.status = 'Closed Won'; b.signedAt = '2026-09-18T15:00:00.000Z';
    });
    expect(r.after).not.toBe(r.before);
  });

  test('getting paid changes it', async () => {
    const r = await change(() => { payments.push({ id: 961002, client_id: 96100, bid_id: 961001, amount: 800, date: '2026-09-18' }); });
    expect(r.after).not.toBe(r.before);
  });

  test('a job scheduled for them changes it', async () => {
    const r = await change(() => { jobs.push({ id: 961003, client_id: 96100, date: '2026-09-20', status: 'Scheduled', title: 'Repaint' }); });
    expect(r.after).not.toBe(r.before);
  });

  test('and nothing happening changes nothing, however many times it is asked', async () => {
    const r = await page.evaluate(() => {
      const h = () => _hubHash(JSON.stringify(_buildClientHubSnapshot(96100), (k, v) => k === 'generatedAt' ? undefined : v));
      const out = [];
      for (let i = 0; i < 10; i++) out.push(h());
      return new Set(out).size;
    });
    expect(r).toBe(1);
  });

  // The whole point: the gate inside _uploadClientHub now fires, so a boot
  // sweep over an unchanged client writes nothing to storage and stamps
  // nothing on the row.
  test('an unchanged hub uploads nothing and re-stamps nothing', async () => {
    const r = await page.evaluate(async () => {
      const c = clients.find(x => x.id === 96100);
      c.clientToken = c.clientToken || 'tok96100';
      const keepUp = _supa.storage.from;
      let uploads = 0;
      _supa.storage.from = () => ({ upload: async () => { uploads++; return { error: null }; } });
      // A hub that already exists returns INSTANTLY and refreshes in the
      // background (the `else` branch of _uploadClientHub), so awaiting the
      // call is not awaiting the upload. Settle between calls or the second one
      // races the first one's stamp and the test measures the race, not the gate.
      const settle = () => new Promise(x => setTimeout(x, 60));
      try {
        await _uploadClientHub(96100); await settle();   // first: writes, stamps the hash
        const firstHash = c.clientHubHash, afterFirst = uploads;
        await _uploadClientHub(96100); await settle();   // nothing happened in between
        await _uploadClientHub(96100); await settle();
        return { afterFirst, total: uploads, firstHash, stillHash: c.clientHubHash };
      } finally { _supa.storage.from = keepUp; }
    });
    expect(r.afterFirst).toBe(1);
    expect(r.total).toBe(1);                    // THE bug: this used to be 3
    expect(r.stillHash).toBe(r.firstHash);
  });
});
