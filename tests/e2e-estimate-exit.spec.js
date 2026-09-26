// @ts-check
/**
 * Getting out of a T&M or Build Your Own estimate.
 *
 * Owner, 2026-09-25: "Save on time and materials doesn't take us back to home
 * page, no way to get back to home page outside of a bid". The full-screen
 * estimate hides the tab bar, so its own Save and Back are the only ways out.
 * Save kept the draft but stayed put; Back opened the job-type picker, and
 * the picker's Cancel dropped him straight back onto the estimate. A loop with
 * no door. Now Save keeps the draft and goes home, and Cancel on the picker
 * opened from an estimate does the same.
 */
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('leaving a T&M or BYO estimate', () => {
  let page, ctx;
  test.beforeAll(async ({ browser }) => {
    ctx = await browser.newContext({ viewport: { width: 393, height: 852 } });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await ctx.close(); });

  const open = (mode, id) => page.evaluate(({ mode, id }) => {
    document.querySelectorAll('#_style-pick-ov,.zmodal-overlay').forEach(e => e.remove());
    clients.length = 0; bids.length = 0;
    clients.push({ id, name: 'Ray Whitcomb', addr: '412 Bell St, Topeka, KS 66603', phone: '7855550142' });
    currentClientId = id;
    if (mode === 'tm') { openTMEstimate(getClientById(id)); }
    else { openGenericEstimate(getClientById(id), null, null, { mode: 'byo' }); _geiIsFreeForm = true; _geiIsTM = false; goGeiStep(2); }
  }, { mode, id });
  const where = () => page.evaluate(() => ({
    pg: document.querySelector('.pg.active')?.id,
    tabbar: (() => { const t = document.getElementById('mobile-tabbar'); return t ? getComputedStyle(t).display !== 'none' : null; })(),
    picker: !!document.getElementById('_style-pick-ov'),
  }));

  for (const mode of ['tm', 'byo']) {
    test(`${mode}: Save keeps the draft and goes home, with the tab bar back`, async () => {
      await open(mode, mode === 'tm' ? 99101 : 99102);
      await page.waitForTimeout(500);
      await page.evaluate(() => { const t = document.getElementById('gei-scope-say') || document.getElementById('byo-say'); if (t) t.value = 'Replace the kitchen faucet'; });
      const save = page.locator(`#gei-${mode}-page .ios-nav .ios-navbtn.bold`);
      await expect(save).toHaveText('Save');
      await save.click();
      await page.waitForTimeout(500);
      const w = await where();
      expect(w.pg).toBe('pg-dash');
      expect(w.picker).toBe(false);
      const kept = await page.evaluate(() => bids.filter(b => b.client_id === currentClientId).map(b => ({ draft: b.draft, status: b.status })));
      expect(kept.length).toBe(1);
      expect(kept[0].draft).toBe(true);
    });

    test(`${mode}: Back, then Cancel on the job type, lands home instead of back on the estimate`, async () => {
      await open(mode, mode === 'tm' ? 99103 : 99104);
      await page.waitForTimeout(500);
      await page.locator(`#gei-${mode}-page .ios-nav .ios-navbtn`).first().click();
      await page.waitForTimeout(500);
      expect((await where()).picker).toBe(true);
      await page.locator('#_style-pick-ov button', { hasText: 'Cancel' }).click();
      await page.waitForTimeout(600);
      const w = await where();
      expect(w.pg).toBe('pg-dash');
      expect(w.picker).toBe(false);
    });
  }

  test('the picker opened from a client still just closes on Cancel', async () => {
    await page.evaluate(() => {
      document.querySelectorAll('#_style-pick-ov,.zmodal-overlay').forEach(e => e.remove());
      clients.length = 0; bids.length = 0;
      clients.push({ id: 99105, name: 'Ray Whitcomb', addr: '412 Bell St, Topeka, KS 66603' });
      currentClientId = 99105;
      goPg('pg-clients');
      _showEstimateStylePicker(getClientById(99105));
    });
    await page.waitForTimeout(500);
    await page.locator('#_style-pick-ov button', { hasText: 'Cancel' }).click();
    await page.waitForTimeout(600);
    const w = await where();
    expect(w.pg).toBe('pg-clients');
    expect(w.picker).toBe(false);
    expect(await page.evaluate(() => bids.length)).toBe(0);
  });

  // ── TIM LISTENING (owner, 2026-09-26) ─────────────────────────────────────
  //
  // "Tim's voice thing is cutoff at the bottom when trying to do a bid, he also
  // doesn't turn off if you save and exit". The listening panel sat under the
  // page's bottom bar, which hid Done talking, and nothing turned the mic off
  // on the way out. The mic is stubbed: what matters is what the app does.
  const talk = (heard) => page.evaluate((heard) => {
    window.__micOn = false;
    window._voiceStart = (el, cb) => { window.__micOn = true; };
    window._voiceStop = async () => { window.__micOn = false; return heard; };
    _geiScopeTalk();
  }, heard);

  test('the listening panel sits above the bottom bar: Done talking is on top and on screen', async () => {
    await open('tm', 99106);
    await page.waitForTimeout(500);
    await talk('Replace the kitchen faucet');
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('#_tim-listen button')].find(b => /Done talking/.test(b.textContent));
      const box = btn.getBoundingClientRect();
      const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      const panel = document.getElementById('_tim-listen').getBoundingClientRect();
      return { onTop: !!top && btn.contains(top), bottom: box.bottom, panelBottom: panel.bottom, vh: innerHeight };
    });
    expect(r.onTop, 'nothing covers Done talking').toBe(true);
    expect(r.bottom).toBeLessThanOrEqual(r.vh);
    // The whole panel, small print included, ends at the screen's edge.
    expect(r.panelBottom).toBeLessThanOrEqual(r.vh + 0.5);
    await page.evaluate(() => _timTalkStop(true));
  });

  test('Save while Tim is listening: the mic goes off, the words are kept, then home', async () => {
    await open('tm', 99107);
    await page.waitForTimeout(500);
    await talk('Replace the kitchen faucet');
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => _timTalking)).toBe(true);
    await page.locator('#gei-tm-page .ios-nav .ios-navbtn.bold').click();
    await page.waitForTimeout(700);
    const r = await page.evaluate(() => ({
      talking: _timTalking, mic: window.__micOn, panel: !!document.getElementById('_tim-listen'),
      said: document.getElementById('gei-scope-say')?.value || '', pg: document.querySelector('.pg.active')?.id,
    }));
    expect(r.talking).toBe(false);
    expect(r.mic).toBe(false);
    expect(r.panel).toBe(false);
    expect(r.said).toBe('Replace the kitchen faucet');
    expect(r.pg).toBe('pg-dash');
  });

  test('Back, or leaving by any page change, turns the mic off too', async () => {
    await open('tm', 99108);
    await page.waitForTimeout(500);
    await talk('Replace the kitchen faucet');
    await page.waitForTimeout(200);
    await page.locator('#gei-tm-page .ios-nav .ios-navbtn').first().click();
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => ({ t: _timTalking, m: window.__micOn }))).toEqual({ t: false, m: false });
    await open('tm', 99109);
    await page.waitForTimeout(500);
    await talk('Replace the kitchen faucet');
    await page.waitForTimeout(200);
    await page.evaluate(() => goPg('pg-clients'));
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => ({ t: _timTalking, m: window.__micOn, p: !!document.getElementById('_tim-listen') }))).toEqual({ t: false, m: false, p: false });
  });

  test('no console errors', async () => { assertNoErrors(page, 'estimate exit'); });
});
