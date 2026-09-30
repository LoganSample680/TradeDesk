// @ts-check
/**
 * Start to finish, the way a person does it (owner 2026-09-29: "Now same test
 * for actual proposals and when you have to initially set things up on hourly
 * rate"). From the customer's page to the send screen, following ONLY the
 * bottom bar plus the one control each step points at. Every tap is a real
 * click, every word typed key by key, and the bar is tapped at human pace:
 * it ignores a tap for 0.7s after it changes (_tmDockReady), on purpose, so a
 * double tap never lands on the next step.
 *
 * Taps are the budget (CLAUDE.md 12.2); wall clock is logged, never gated.
 *
 * What the first runs of this found, fixed in the same commit:
 *   - "Tim caught 4 things you left out" scrolled to Tim's card and left it
 *     folded, so the bar did nothing he could see (_geiGoTimAsks opens it).
 *   - Build Your Own asked him to "Price every line" on the supply house list
 *     and opened the line editor on "Materials"; it now sends him to the
 *     list's own card to price the parts ("Price the materials").
 */
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

async function boot(page, o) {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAllExternal(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForAppBoot(page);
  // The cloud load lands later on a slow WebKit runner and replaces what this
  // test seeds: the invoice lost its two receipts ($186) and the customer
  // page redrew under a tap (CI shard 3, 2026-09-30). Seed after it, the way
  // e2e-attach-suggestions and e2e-supply-list already do.
  await page.waitForFunction(() => window._supaCloudLoaded === true, null, { timeout: 15000 }).catch(() => {});
  await page.evaluate((o) => {
    S.bname = 'Sample Plumbing';
    S.ownerName = 'Logan Sample';
    // First time: no rate anywhere yet, and nobody on the team has one.
    if (o.fresh) { delete S.ownerBillRate; S.laborRate = 0; } else { S.ownerBillRate = 110; S.laborRate = 110; }
    S.employees = o.fresh ? [{ name: 'Jack Miller', email: 'jack@x.test', role: 'Apprentice' }]
      : [{ name: 'Jack Miller', email: 'jack@x.test', role: 'Apprentice', pay_type: 'hourly', pay_rate: 22, billRate: 90 }];
    clients.length = 0; bids.length = 0;
    clients.push({ id: 93001, name: 'Ray Whitcomb', addr: '412 Bell St, Topeka, KS 66603', phone: '7855550100', email: 'ray@x.test', status: 'Client' });
    // The upload and the hub are the network; what is under test is the screens.
    _supa.storage.from = () => ({ upload: async () => ({ data: { path: 'x' } }) });
    window._uploadClientHub = async () => null;
    window._flushSaveNow = async () => {};
    openClientDetail(93001);
  }, o || {});
  await page.waitForTimeout(300);
}

function driver(page, pg) {
  const d = { log: [], taps: 0, keys: 0 };
  d.tap = async (label, sel) => {
    const l = page.locator(sel).first();
    await l.scrollIntoViewIfNeeded({ timeout: 4000 }); await l.click({ timeout: 4000 });
    d.taps++; d.log.push('tap  ' + label); await page.waitForTimeout(150);
  };
  d.type = async (label, sel, text) => {
    const l = page.locator(sel).first();
    await l.scrollIntoViewIfNeeded(); await l.click(); d.taps++;
    await l.pressSequentially(text); d.keys += text.length; d.log.push('type ' + label + ' (' + text.length + ')');
  };
  d.bar = () => page.evaluate((pg) => [...document.querySelectorAll(pg + ' .ios-btn')].map(b => b.textContent.trim()).join(' | '), pg);
  // Tim's card: take what he caught in one tap, give the model number, say no to the permit.
  d.tim = async (page_, bar, root) => {
    if (/Tim caught/.test(bar)) { await d.tap('Add all', root + ' .ios-tim .ios-tim-h .ios-pill'); return; }
    const ask = page.locator(root + ' .ios-tim .ios-ask-in:visible').first();
    if (await ask.count() && /model/i.test(await ask.getAttribute('aria-label') || '')) {
      await ask.click(); d.taps++; await ask.pressSequentially('Rheem 50 gal'); d.keys += 12; await ask.press('Enter'); d.log.push('type model');
    } else await d.tap('No', root + ' .ios-tim .ios-no:visible');
  };
  return d;
}

async function proposal(page, kind, o) {
  await boot(page, o);
  const tm = kind === 'tm';
  const root = tm ? '#gei-tm-page' : '#gei-byo-page', dock = tm ? '#tm-dock' : '#byo-dock', go = tm ? '#tm-dock-go' : '#byo-dock-go';
  const d = driver(page, dock);
  const t0 = Date.now();
  // The customer page's own button, once the page has stopped moving. A bare
  // "New proposal" matched a hidden copy on another page, and on a loaded
  // WebKit runner the customer page was still sliding in (CI shard 3).
  await page.waitForSelector('#pg-client-detail.active button[onclick^="openEstimateForClient"]');
  await page.waitForTimeout(400);
  await d.tap('New proposal', '#pg-client-detail.active button[onclick^="openEstimateForClient"]');
  await d.tap(tm ? 'Time & Materials' : 'Build Your Own', '#_style-pick-ov [data-type="' + (tm ? 'tm' : 'freeform') + '"]');
  await page.waitForTimeout(400);
  await d.type('the work', tm ? '#gei-scope-say' : '#byo-say', tm ? 'Replace the water heater and the shutoff valve.' : 'Replace the 50 gallon water heater and the shutoff valve.');
  const bars = [];
  for (let i = 0; i < 16; i++) {
    const bar = await d.bar(); bars.push(bar);
    await page.waitForTimeout(750);                       // he reads it
    if (/Send it/.test(bar)) { await d.tap('Send it', go); break; }
    await d.tap('bar: ' + bar, go);
    await page.waitForTimeout(450);
    if (/Tim caught|Tim has/.test(bar)) await d.tim(page, bar, root);
    else if (/Add your rate/.test(bar) && await page.evaluate(() => /rate/i.test(document.activeElement && document.activeElement.id))) {
      await page.keyboard.type('95'); d.keys += 2; d.log.push('type rate'); await page.keyboard.press('Tab');
    } else if (/Pick when you bill/.test(bar)) await d.tap('Weekly', root + ' .tm-cad-seg button >> nth=0');
    else if (/Set the price/.test(bar)) {
      // One price for the whole job, typed where the bar put the cursor.
      await page.keyboard.type('450'); d.keys += 3; d.log.push('type price'); await page.keyboard.press('Tab');
    } else if (/Price the materials/.test(bar)) {
      await d.tap('+ price', '#sup-card .sup-cost');
      await page.locator('#zprompt-inp').pressSequentially('380'); d.keys += 3;
      await d.tap('OK', '#zprompt-ok');
    }
  }
  await page.waitForSelector('#_gei-send-overlay .td-send', { timeout: 5000 });
  await d.tap('Text it to them', '#_gei-send-overlay [data-send="text"]');
  await page.waitForTimeout(700);                         // sent is marked just after Messages opens
  const out = await page.evaluate(() => { const b = bids[0]; return { status: b && b.status, sent: !!(b && b.sentAt), amount: b && b.amount }; });
  return { d, bars, out, ms: Date.now() - t0 };
}

test.describe('Proposals start to finish', () => {
  test('T&M, the usual: rate and crew on file. 16 taps, the work typed once', async ({ page }) => {
    test.setTimeout(90000);
    const r = await proposal(page, 'tm', {});
    console.log('[start-to-finish] T&M usual: ' + r.d.taps + ' taps, ' + r.d.keys + ' keys, ' + r.ms + 'ms\n  ' + r.d.log.join('\n  '));
    expect(r.out.status).toBe('Pending');
    expect(r.out.sent).toBe(true);
    // The bar walked him: build it, Tim, his rate out loud, when he bills, send.
    expect(r.bars.filter((b, i) => b !== r.bars[i - 1])).toEqual(['Write it up', 'Tim caught 4 things you left out', 'Tim has 2 questions', 'Tim has a question', 'Check your rate', 'Yes: $110/hr, 1 person', 'Pick when you bill', 'Sign here | Send it']);
    expect(r.d.taps, r.d.log.join('\n')).toBeLessThanOrEqual(16);
    assertNoErrors(page, 'T&M start to finish');
  });

  test('T&M, first time: no rate anywhere. The bar asks for it, and his typed rate needs no second check', async ({ page }) => {
    test.setTimeout(90000);
    const r = await proposal(page, 'tm', { fresh: true });
    console.log('[start-to-finish] T&M first time: ' + r.d.taps + ' taps, ' + r.d.keys + ' keys, ' + r.ms + 'ms\n  ' + r.d.log.join('\n  '));
    expect(r.out.sent).toBe(true);
    expect(r.bars).toContain('Add your rate');
    expect(r.bars).not.toContain('Check your rate');
    expect(r.d.taps, r.d.log.join('\n')).toBeLessThanOrEqual(16);
    assertNoErrors(page, 'T&M first time');
  });

  test('Build Your Own: the scope, then one price for the whole job, parts included (owner 2026-09-30)', async ({ page }) => {
    test.setTimeout(90000);
    const r = await proposal(page, 'byo', {});
    console.log('[start-to-finish] BYO: ' + r.d.taps + ' taps, ' + r.d.keys + ' keys, ' + r.ms + 'ms\n  ' + r.d.log.join('\n  '));
    expect(r.out.sent).toBe(true);
    expect(r.out.amount).toBeGreaterThanOrEqual(450);
    // His one number covers the parts too: no line and no supply list to price.
    expect(r.bars).toContain('Set the price');
    expect(r.bars).not.toContain('Price the materials');
    expect(r.d.taps, r.d.log.join('\n')).toBeLessThanOrEqual(13);   // 32 before one price for the whole job (2026-09-30)
    assertNoErrors(page, 'BYO start to finish');
  });
});
