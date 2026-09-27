// @ts-check
/**
 * Earl, lead to signed proposal (audit 2026-09-27).
 *
 * Earl is 58, a plumber, on an iPhone SE (375x667) with thick thumbs. Every
 * describe below is one thing he hit on the way from a new lead to a signed
 * proposal, and holds the fix:
 *   - a price with cents saves with its cents ($1,289.50 was saving $128,950)
 *   - a price that cannot be right asks once before it goes out
 *   - the customer's signature is saved when they sign, not after they pay
 *   - a lead with no address can still get a proposal
 *   - a tap outside the item sheet never throws away typed work
 *   - a proposal is not "Pending" until he actually sends it
 *   - the new-lead form: Save stays reachable, a half-typed lead survives
 *   - plumber words, not painter words and not jargon
 *   - common trade typos are fixed (every word stays capitalized: owner rule)
 *   - Build Your Own opens on its page, no extra Next screen
 *   - 44px tap areas on the small controls
 *   - sign.html's payment screen fits a 375 screen, Back is a link
 *   - the QR lead form keeps the entry with no signal and sends it later
 */
const { test, expect, mockAllExternal, _supabaseShimIntake, waitForAppBoot, assertNoErrors, MOCK_PROPOSAL, FAKE_USER_ID, FAKE_BID_ID_1, FAKE_TOKEN } = require('./helpers');

const SE = { width: 375, height: 667 };

// ════════════════════════════════════════════════════════════════════════════
//  THE CONTRACTOR APP
// ════════════════════════════════════════════════════════════════════════════
test.describe('Earl in the app: lead to proposal', () => {
  let page, ctx;

  test.beforeAll(async ({ browser }) => {
    ctx = await browser.newContext({ viewport: SE, deviceScaleFactor: 2, hasTouch: true, isMobile: true, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await ctx.close(); });

  const openByo = (o) => page.evaluate((o) => {
    document.querySelectorAll('.zmodal-overlay,#_style-pick-ov,#_byo-add-modal,#_gei-send-overlay,.toast').forEach(e => e.remove());
    bids.length = 0; clients.length = 0;
    clients.push({ id: 97001, name: 'Earl Tester', addr: '412 Bell St, Topeka, KS 66603', phone: '7855550101' });
    currentClientId = 97001;
    _activeTrade = o.trade || 'plumbing';
    S.priceBook = S.priceBook || {};
    S.priceBook[_activeTrade] = (o.book || []).map(b => Object.assign({ unit: 'ea', n: 3 }, b));
    S.depositPct = 25;
    openGenericEstimate(getClientById(97001), null, null, { mode: 'byo' });
    window.scrollTo(0, 0);
    return { step: _geiStep, byoShown: getComputedStyle(document.getElementById('gei-byo-page')).display !== 'none', s1: getComputedStyle(document.getElementById('gei-s1')).display };
  }, o || {});

  // ── 1. MONEY WITH CENTS ─────────────────────────────────────────────────
  test('typing 1289.50 in the item price keeps the decimal and saves exactly $1,289.50', async () => {
    await openByo();
    await page.evaluate(() => _byoAddItem(_byoWorkSection()));
    const price = page.locator('#_bya-price');
    expect(await price.getAttribute('inputmode')).toBe('decimal');
    await page.fill('#_bya-label', 'Replace 50 gal water heater');
    await price.click();
    await price.pressSequentially('1289.50');
    expect(await price.inputValue()).toBe('1,289.50');
    await page.locator('#_byo-add-modal .btn-p').click();
    const r = await page.evaluate(() => {
      const it = _byoItems.find(x => x.label === 'Replace 50 gal water heater');
      const total = _byoItems.filter(x => x.on).reduce((a, x) => a + (Number(x.price) || 0), 0);
      return { rate: it && it.rate, price: it && it.price, dep: _byoDepositState(total).amt, pct: _geiDepositPct() };
    });
    expect(r.rate).toBe(1289.5);
    expect(r.price).toBe(1289.5);
    expect(r.dep).toBe(Math.round(1289.5 * r.pct / 100));   // the deposit follows the real price
  });

  test('the price field keeps one decimal point and two cents digits, whatever is typed', async () => {
    const r = await page.evaluate(() => {
      const el = document.createElement('input');
      const run = v => { el.value = v; _fmtMoneyInput(el); return el.value; };
      return { two: run('1289.5.5'), cents: run('12.345'), big: run('128950'), dot: run('.5'), junk: run('$1,2a3.4') };
    });
    expect(r.two).toBe('1,289.55');
    expect(r.cents).toBe('12.34');
    expect(r.big).toBe('128,950');
    expect(r.dot).toBe('.5');
    expect(r.junk).toBe('123.4');
  });

  test('the old digits-only formatter is gone, every builder money field brings up a decimal keypad', async () => {
    const r = await page.evaluate(() => {
      _byoRenderPrice && _byoRenderPrice();
      const im = id => document.getElementById(id)?.getAttribute('inputmode');
      return { gone: typeof _byaFormatPriceInput, cost: im('byo-cost-in'), dep: im('byo-dep-in') };
    });
    expect(r.gone).toBe('undefined');
    expect(r.cost).toBe('decimal');
    expect(r.dep).toBe('decimal');
  });

  // ── 11b. BYO opens on its page ──────────────────────────────────────────
  test('a new Build Your Own opens straight on its page, no "Next: Build proposal" screen', async () => {
    const r = await openByo();
    expect(r.step).toBe(2);
    expect(r.byoShown).toBe(true);
    expect(r.s1).toBe('none');
    // The Change on the sub-line is still the way back to the facts.
    const sub = await page.evaluate(() => document.getElementById('byo-page-sub')?.innerHTML || '');
    expect(sub).toContain('goGeiStep(1)');
  });

  // ── 10. PLUMBER WORDS ───────────────────────────────────────────────────
  test('the item sheet shows plumbing examples to a plumber, painting ones to a painter', async () => {
    await openByo({ trade: 'plumbing' });
    await page.evaluate(() => _byoAddItem(_byoWorkSection()));
    const pl = await page.evaluate(() => ({
      label: document.getElementById('_bya-label').placeholder,
      notes: document.getElementById('_bya-notes').placeholder,
    }));
    expect(pl.label).toContain('water heater');
    expect(pl.label).not.toContain('Bedroom');
    expect(pl.notes).not.toContain('Two coats');
    await page.evaluate(() => document.getElementById('_byo-add-modal')?.remove());
    await openByo({ trade: 'painting' });
    await page.evaluate(() => _byoAddItem(_byoWorkSection()));
    const pa = await page.evaluate(() => document.getElementById('_bya-label').placeholder);
    expect(pa).toContain('Bedroom 3');
    await page.evaluate(() => document.getElementById('_byo-add-modal')?.remove());
  });

  test('the proposal-type picker says plain words: no "A la carte", no "Powered by the TrueSuite"', async () => {
    const html = await page.evaluate(() => {
      _showEstimateStylePicker({ id: 97001, name: 'Earl Tester' });
      const h = document.getElementById('_style-pick-ov').innerHTML;
      document.getElementById('_style-pick-ov').remove();
      return h;
    });
    expect(html).not.toContain('A la carte');
    expect(html).not.toContain('Powered by the TrueSuite');
    expect(html).not.toContain('LiDAR');
    expect(html).toContain('Line by line');
    expect(html).toContain('TrueBid');
  });

  // ── 11. TYPOS ────────────────────────────────────────────────────────────
  // The owner's rule is that every typed word is capitalized ("Master
  // Bedroom"); the Earl audit's complaint was the misspellings, not the
  // capitals, so only the typos are fixed and every field keeps "words".
  test('every field keeps word case (owner rule); common trade typos are fixed', async () => {
    const r = await page.evaluate(() => {
      const host = document.createElement('div'); document.body.appendChild(host);
      host.innerHTML = '<input type="text" id="_ea_line"><input type="text" id="cf-name-x" autocomplete="name"><input type="text" id="_ea_street" autocomplete="address-line1">';
      _applyAutoCapAttrs(host);
      const out = {
        line: document.getElementById('_ea_line').getAttribute('autocapitalize'),
        name: document.getElementById('cf-name-x').getAttribute('autocapitalize'),
        street: document.getElementById('_ea_street').getAttribute('autocapitalize'),
        sent: _autoCapSentences('replce 50 gal water heter. then haul it off'),
        fix: _tradeSpellFix('Replce 50 Gal Water Heter'),
        keep: _tradeSpellFix('Replace the heater'),
        caps: _tradeSpellFix('TOLIET'),
        nul: _tradeSpellFix(null),
      };
      host.remove();
      return out;
    });
    expect(r.line).toBe('words');
    expect(r.name).toBe('words');
    expect(r.street).toBe('words');
    expect(r.sent).toBe('Replce 50 gal water heter. Then haul it off');
    expect(r.fix).toBe('Replace 50 Gal Water Heater');
    expect(r.keep).toBe('Replace the heater');
    expect(r.caps).toBe('TOILET');
    expect(r.nul).toBe('');
  });

  test('a real spacebar on a line title fixes the typo and keeps word case', async () => {
    const v = await page.evaluate(async () => {
      const i = document.createElement('input'); i.type = 'text'; document.body.appendChild(i); i.focus();
      i.value = 'replce 50 gal water heter';
      i.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      await new Promise(r => setTimeout(r, 20));
      const out = i.value; i.remove(); return out;
    });
    expect(v).toBe('Replace 50 Gal Water Heater');
  });

  test('a line Tim writes gets the typo fix too', async () => {
    await openByo();
    const label = await page.evaluate(() => { _byoAddLine('Replce 50 gal water heter'); return _byoItems[_byoItems.length - 1].label; });
    expect(label).toBe('Replace 50 gal water heater');
  });

  // ── 5. THE ITEM SHEET KEEPS TYPED WORK ──────────────────────────────────
  test('a backdrop tap on a sheet with typing asks first and keeps the work; a clean sheet just closes', async () => {
    await openByo();
    await page.evaluate(() => _byoAddItem(_byoWorkSection()));
    await page.fill('#_bya-label', 'Snake main line');
    await page.mouse.click(4, 4);   // the dim backdrop, above the sheet
    await page.waitForTimeout(100);
    let r = await page.evaluate(() => ({
      sheet: !!document.getElementById('_byo-add-modal'),
      ask: document.querySelector('.zmodal-overlay .zmodal-title')?.textContent || '',
    }));
    expect(r.sheet).toBe(true);
    expect(r.ask).toBe('Discard changes?');
    await page.locator('.zmodal-overlay .zmodal-cancel').click();
    r = await page.evaluate(() => ({ sheet: !!document.getElementById('_byo-add-modal'), label: document.getElementById('_bya-label')?.value }));
    expect(r.sheet).toBe(true);
    expect(r.label).toBe('Snake main line');
    // Discard really discards.
    await page.mouse.click(4, 4);
    await page.locator('#zmodal-yes').click();
    expect(await page.locator('#_byo-add-modal').count()).toBe(0);
    // Untouched: one tap closes, nothing to ask.
    await page.evaluate(() => _byoAddItem(_byoWorkSection()));
    await page.mouse.click(4, 4);
    await page.waitForTimeout(80);
    expect(await page.locator('#_byo-add-modal').count()).toBe(0);
    expect(await page.locator('.zmodal-overlay').count()).toBe(0);
  });

  test('the edit sheet has the same guard', async () => {
    await openByo();
    await page.evaluate(() => { _byoAddLine('Replace shutoff valve', undefined, 95); _byoRenderSections(); _byoEditItem(_byoItems.length - 1); });
    await page.fill('#_bya-label', 'Replace both shutoff valves');
    await page.mouse.click(4, 4);
    await page.waitForTimeout(80);
    expect(await page.locator('#_byo-add-modal').count()).toBe(1);
    await page.locator('.zmodal-overlay .zmodal-cancel').click();
    await page.evaluate(() => document.getElementById('_byo-add-modal')?.remove());
  });

  // ── 2. THE PRICE THAT CANNOT BE RIGHT ───────────────────────────────────
  const stubSend = () => page.evaluate(() => {
    window.__origStorFrom = window.__origStorFrom || _supa.storage.from.bind(_supa.storage);
    _supa.storage.from = () => ({ upload: async () => ({ data: { path: 'x' } }) });
  });
  const unstubSend = () => page.evaluate(() => { if (window.__origStorFrom) _supa.storage.from = window.__origStorFrom; });

  test('outliers: a $128,950 line is flagged, a $1,289.50 one is not, and 5x his own book price is flagged', async () => {
    await openByo({ book: [{ desc: 'Drain cleaning', rate: 250 }] });
    const r = await page.evaluate(() => {
      _byoItems.length = 0;
      _byoAddLine('Replace 50 gal water heater', undefined, 1289.5);
      const normal = _geiPriceOutliers().length;
      _byoItems[0].rate = 128950; _byoItems[0].price = 128950;
      const absurd = _geiPriceOutliers();
      _byoItems.length = 0;
      _byoAddLine('Drain cleaning', undefined, 1300);
      const book = _geiPriceOutliers();
      _byoItems[0].rate = 275; _byoItems[0].price = 275;
      const bookOk = _geiPriceOutliers().length;
      return { normal, absurd: absurd.length, absurdAmt: absurd[0] && absurd[0].amt, book: book.length, bookRate: book[0] && book[0].book, bookOk };
    });
    expect(r.normal).toBe(0);
    expect(r.absurd).toBe(1);
    expect(r.absurdAmt).toBe(128950);
    expect(r.book).toBe(1);
    expect(r.bookRate).toBe(250);
    expect(r.bookOk).toBe(0);
  });

  test('Send asks "Double-check this price" on a $128,950 water heater and sends nothing until he says so', async () => {
    await openByo();
    await stubSend();
    await page.evaluate(async () => {
      _byoItems.length = 0;
      _byoAddLine('Replace 50 gal water heater', undefined, 128950);
      _byoUpdateRail();
      await sendGenericProposal(false);
    });
    await page.waitForTimeout(100);
    let r = await page.evaluate(() => ({
      title: document.querySelector('.zmodal-overlay .zmodal-title')?.textContent || '',
      msg: document.querySelector('.zmodal-overlay .zmodal-msg')?.textContent || '',
      sheet: !!document.getElementById('_gei-send-overlay'),
    }));
    expect(r.title).toBe('Double-check this price');
    expect(r.msg).toContain('$128,950');
    expect(r.sheet).toBe(false);
    // "Fix the price" backs out with nothing sent.
    await page.locator('.zmodal-overlay .zmodal-cancel').click();
    await page.waitForTimeout(100);
    expect(await page.locator('#_gei-send-overlay').count()).toBe(0);
    // "Send anyway" goes.
    await page.evaluate(async () => { await sendGenericProposal(false); });
    await page.locator('#zmodal-yes').click();
    await page.waitForSelector('#_gei-send-overlay', { timeout: 5000 });
    await page.evaluate(() => document.getElementById('_gei-send-overlay')?.remove());
    await unstubSend();
  });

  // ── 6. NOT PENDING UNTIL SENT ───────────────────────────────────────────
  test('a normal price goes straight to the send sheet, and the bid stays a draft until a channel is tapped', async () => {
    await openByo();
    await stubSend();
    await page.evaluate(async () => {
      _byoItems.length = 0;
      _byoAddLine('Replace 50 gal water heater', undefined, 1289.5);
      _byoUpdateRail();
      await sendGenericProposal(false);
    });
    const before = await page.evaluate(() => {
      const b = bids.find(x => x.id === _geiEditBidId);
      return {
        confirm: document.querySelectorAll('.zmodal-overlay').length,
        sheet: document.getElementById('_gei-send-overlay')?.textContent || '',
        status: b && b.status, sent: b && b.proposalSentDate, token: !!(b && b.signingToken),
        draftToast: [...document.querySelectorAll('.toast')].some(t => /Draft saved/.test(t.textContent)),
      };
    });
    expect(before.confirm).toBe(0);
    expect(before.sheet).toContain('Text');
    expect(before.sheet).not.toContain('saved as Pending');
    expect(before.status).toBe('Draft');
    expect(before.sent).toBeFalsy();
    expect(before.token).toBe(true);
    expect(before.draftToast, 'no Draft saved toast on top of the send sheet').toBe(false);
    // Closing the sheet without picking sends nothing.
    await page.mouse.click(4, 4);
    const closed = await page.evaluate(() => bids.find(x => x.id === _geiEditBidId).status);
    expect(closed).toBe('Draft');
    // Picking a channel is the send.
    const after = await page.evaluate(() => {
      const orig = window.pwaShare; window.pwaShare = () => {};
      try { _doGeiSend('other'); } finally { window.pwaShare = orig; }
      const b = bids.find(x => x.id === _pendingSignToken?.bidId) || bids[0];
      return { status: b.status, sent: !!b.proposalSentDate, followup: !!b.followup };
    });
    expect(after.status).toBe('Pending');
    expect(after.sent).toBe(true);
    expect(after.followup).toBe(true);
    await unstubSend();
  });

  // ── 12. 44px TAP AREAS, NO LOOK CHANGE ──────────────────────────────────
  test('Your cost, Deposit, the T&M rate and "Pick a different type" are at least 44px tall to a thumb', async () => {
    await openByo();
    await page.evaluate(() => { _byoItems.length = 0; _byoAddLine('Replace 50 gal water heater', undefined, 1289.5); _byoRenderSections(); _byoUpdateRail(); _byoRenderPrice(); });
    const byo = await page.evaluate(() => ['byo-cost-in', 'byo-dep-in'].map(id => {
      const el = document.getElementById(id); const row = el.closest('.ios-row');
      const h = el.getBoundingClientRect().height, rh = row.getBoundingClientRect().height;
      // The same row with the hit area taken off: the look must not change.
      el.style.setProperty('padding', '0', 'important'); el.style.setProperty('margin', '0'); el.style.setProperty('min-height', '0', 'important');
      const bare = row.getBoundingClientRect().height;
      el.style.removeProperty('padding'); el.style.removeProperty('margin'); el.style.removeProperty('min-height');
      return { id, h, row: rh, bare };
    }));
    byo.forEach(x => { expect(x.h, x.id).toBeGreaterThanOrEqual(44); expect(Math.abs(x.row - x.bare), x.id + ' row keeps its size').toBeLessThanOrEqual(1); });
    const other = await page.evaluate(() => {
      // "Pick a different type" lives on a screen that is not open here; a copy
      // carries the same class, so it measures the same.
      const lb = document.querySelector('.link-back').cloneNode(true);
      document.body.appendChild(lb);
      const linkBack = lb.getBoundingClientRect().height; lb.remove();
      openGenericEstimate(getClientById(97001), null, null, { mode: 'tm' });
      _geiIsTM = true; _geiIsFreeForm = false; goGeiStep(2);
      const tr = document.getElementById('tm-i-rate');
      return { linkBack, tmRate: tr ? tr.getBoundingClientRect().height : 0 };
    });
    expect(other.linkBack).toBeGreaterThanOrEqual(44);
    expect(other.tmRate).toBeGreaterThanOrEqual(44);
    const dep = await page.evaluate(() => {
      const w = document.createElement('div'); w.id = '_ea-deposit-wrap'; document.body.appendChild(w);
      _geiRenderDepositField('_ea', '');
      const h = document.getElementById('_ea-deposit-pct').getBoundingClientRect().height;
      const im = document.getElementById('_ea-deposit-pct').getAttribute('inputmode');
      w.remove(); return { h, im };
    });
    expect(dep.h).toBeGreaterThanOrEqual(44);
    expect(dep.im).toBe('decimal');
  });

  // ── 4. A LEAD WITH NO ADDRESS CAN GET A PROPOSAL ────────────────────────
  test('a lead with no address shows New proposal next to the onboarding link, and says "New lead" not "TIER C"', async () => {
    const r = await page.evaluate(() => {
      document.querySelectorAll('.zmodal-overlay,#_gei-send-overlay').forEach(e => e.remove());
      clients.push({ id: 97050, name: 'No Address Lead', phone: '7855550199' });
      currentClientId = 97050;
      renderClientDetail();
      goPg('pg-client-detail');
      const act = document.getElementById('cd-estimate-actions');
      return {
        text: act.textContent,
        newBtn: [...act.querySelectorAll('button')].some(b => /New proposal/.test(b.textContent) && /openEstimateForClient/.test(b.getAttribute('onclick') || '')),
        hdr: document.getElementById('cd-hdr').textContent,
      };
    });
    expect(r.text).toContain('Send onboarding link');
    expect(r.newBtn).toBe(true);
    expect(r.hdr).not.toContain('TIER');
    expect(r.hdr).toContain('New lead');
  });

  // ── 8 + 9. THE NEW-LEAD FORM ────────────────────────────────────────────
  test('Save client stays on screen above the tab bar on a 375x667 phone, and never covers a field', async () => {
    await page.evaluate(() => { localStorage.removeItem('zp3_new_lead_draft'); goPg('pg-clients'); openNewClient(); });
    await page.waitForTimeout(250);
    const r = await page.evaluate(() => {
      const save = [...document.querySelectorAll('#client-form-wrap .cf-actions button')].find(b => /Save client/.test(b.textContent));
      const sr = save.getBoundingClientRect();
      const tb = document.getElementById('mobile-tabbar');
      const tbTop = tb && getComputedStyle(tb).display !== 'none' ? tb.getBoundingClientRect().top : innerHeight;
      const at = document.elementFromPoint(sr.left + sr.width / 2, sr.top + sr.height / 2);
      return { top: sr.top, bottom: sr.bottom, tbTop, vh: innerHeight, hit: save.contains(at), bleed: document.documentElement.scrollWidth <= innerWidth + 1 };
    });
    expect(r.top).toBeGreaterThanOrEqual(0);
    expect(r.bottom).toBeLessThanOrEqual(r.tbTop + 1);
    expect(r.hit, 'Save client is the thing under the thumb, nothing covers it').toBe(true);
    expect(r.bleed).toBe(true);
    // Scrolled to the very bottom, the last field sits above the bar, not under it.
    const last = await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
      const notes = document.getElementById('cf-notes').getBoundingClientRect();
      const bar = document.querySelector('#client-form-wrap .cf-actions').getBoundingClientRect();
      return { notesBottom: notes.bottom, barTop: bar.top };
    });
    expect(last.notesBottom).toBeLessThanOrEqual(last.barTop + 1);
    await page.evaluate(() => closeClientForm());
  });

  test('a half-typed new lead survives a reload and is cleared by Cancel', async () => {
    await page.evaluate(() => { localStorage.removeItem('zp3_new_lead_draft'); goPg('pg-clients'); openNewClient(); });
    await page.fill('#cf-name', 'Dale Pruitt');
    await page.fill('#cf-phone', '785-555-0142');
    await page.fill('#cf-notes', 'Leaking tank in the garage');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('zp3_new_lead_draft') || '{}'));
    expect(saved['cf-name']).toBe('Dale Pruitt');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForAppBoot(page);
    const r = await page.evaluate(() => {
      goPg('pg-clients'); openNewClient();
      return { name: document.getElementById('cf-name').value, phone: document.getElementById('cf-phone').value, notes: document.getElementById('cf-notes').value };
    });
    expect(r).toEqual({ name: 'Dale Pruitt', phone: '785-555-0142', notes: 'Leaking tank in the garage' });
    await page.locator('#client-form-wrap .cf-actions button', { hasText: 'Cancel' }).click();
    const gone = await page.evaluate(() => localStorage.getItem('zp3_new_lead_draft'));
    expect(gone).toBe(null);
    // Editing an existing client never writes the new-lead draft.
    const edit = await page.evaluate(() => {
      clients.push({ id: 97060, name: 'Existing Person', addr: '1 A St, Topeka, KS 66603' });
      currentClientId = 97060; openEditClient();
      const n = document.getElementById('cf-name'); n.value = 'Existing Person Jr'; n.dispatchEvent(new Event('input', { bubbles: true }));
      const d = localStorage.getItem('zp3_new_lead_draft');
      closeClientForm(); return d;
    });
    expect(edit).toBe(null);
  });

  test('a corrupt draft never breaks New client', async () => {
    const r = await page.evaluate(() => {
      localStorage.setItem('zp3_new_lead_draft', '{NOT JSON{{');
      let ok = true;
      try { goPg('pg-clients'); openNewClient(); } catch (e) { ok = false; }
      const name = document.getElementById('cf-name').value;
      closeClientForm();
      return { ok, name };
    });
    expect(r.ok).toBe(true);
    expect(r.name).toBe('');
  });

  test('no console errors, Earl in the app', async () => {
    assertNoErrors(page, 'Earl audit app');
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  sign.html, THE CUSTOMER'S SIDE
// ════════════════════════════════════════════════════════════════════════════
test.describe('sign.html: signature saved on sign, payment screen fits a 375 phone', () => {
  let page, ctx;
  const PROP = { ...MOCK_PROPOSAL, trade: 'plumbing', surfaces: [], amount: 129025, deposit: 32256.25, stripeConnectEnabled: true, businessPhone: '785-555-0100' };

  test.beforeAll(async ({ browser }) => {
    ctx = await browser.newContext({ viewport: SE, deviceScaleFactor: 2, hasTouch: true, isMobile: true, bypassCSP: true });
    page = await ctx.newPage();
    await page.addInitScript((d) => { window.__mockProposalData = d; }, PROP);
    await mockAllExternal(page, { alreadySigned: false, proposalData: PROP, bidId: FAKE_BID_ID_1 });
    await page.goto(`/sign.html?key=proposals/${FAKE_USER_ID}/${FAKE_BID_ID_1}_${FAKE_TOKEN}.json`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2000);
  });
  test.afterAll(async () => { await ctx.close(); });

  test('Clear drawing and Download PDF are 44px to a thumb', async () => {
    // Opened twice on purpose (Back, then Approve again): the second pad must
    // survive the first one's teardown, or signing answers "no-pad".
    await page.evaluate(() => { approveAndSign(); _backFromSign(); approveAndSign(); });
    await page.waitForTimeout(50);
    expect(await page.evaluate(() => typeof _ESIGN_PADS !== 'undefined' && !!_ESIGN_PADS.sig)).toBe(true);
    const r = await page.evaluate(() => {
      const clear = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Clear drawing');
      const pdf = [...document.querySelectorAll('#sticky-bar button')].find(b => /Download PDF/.test(b.textContent));
      const sb = document.getElementById('sticky-bar'); const d = sb.style.display; sb.style.display = 'flex';
      const pdfH = pdf.getBoundingClientRect().height; sb.style.display = d;
      return { clear: clear ? clear.getBoundingClientRect().height : 0, pdf: pdfH };
    });
    expect(r.clear).toBeGreaterThanOrEqual(44);
    expect(r.pdf).toBeGreaterThanOrEqual(44);
  });

  test('signing and reaching payment saves the signature right away, before any payment choice', async () => {
    // Since the security lockdown (20261049) the page never writes
    // signed_proposals itself: every signature goes through the proposal-sign
    // function. Watch that function's calls, and watch the table so a direct
    // write sneaking back in fails here too.
    await page.evaluate(async () => {
      if (getComputedStyle(document.getElementById('sig-name')).display === 'none' || !document.getElementById('sig-name').offsetParent) {
        approveAndSign(); if (typeof _goToSignPad === 'function') _goToSignPad(); else _openSignPad();
      }
      await _whenSupaReady();
      window.__signs = []; window.__direct = [];
      const oi = _supa.functions.invoke.bind(_supa.functions);
      _supa.functions.invoke = (name, opts) => {
        if (name === 'proposal-sign') { window.__signs.push(opts && opts.body); return Promise.resolve({ data: { ok: true }, error: null }); }
        return oi(name, opts);
      };
      const of = _supa.from.bind(_supa);
      _supa.from = (t) => {
        const q = of(t);
        if (t === 'signed_proposals') ['upsert', 'insert', 'update'].forEach(m => { const o = q[m]; q[m] = (...a) => { window.__direct.push(m); return o ? o.apply(q, a) : q; }; });
        return q;
      };
    });
    await page.fill('#sig-name', 'Alice Smith');
    await page.waitForTimeout(150);
    await page.evaluate(() => goToPayment());
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => (window.__signs || []).map(b => ({ action: b.action, name: b.signerName, method: b.method, key: !!b.key })));
    expect(r.length).toBe(1);
    expect(r[0]).toEqual({ action: 'sign', name: 'Alice Smith', method: 'later', key: true });
    // Picking a method afterward sends that method on the same link.
    await page.evaluate(() => _paySign('cash'));
    await page.locator('#sec-cash-confirm-btn').click();
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => ({ methods: window.__signs.map(b => b.method), direct: window.__direct }));
    expect(after.methods).toEqual(['later', 'cash']);
    expect(after.direct, 'the page never writes signed_proposals itself').toEqual([]);
  });

  test('the payment screen at 375: no bleed, Pay in Full inside its card, Back is a text link, methods look tappable', async () => {
    await page.evaluate(() => {
      document.getElementById('sec-cash').style.display = 'none';
      document.getElementById('sign-pay-btns').style.display = 'block';
      show('pg-pay'); _renderPayTiles(); _renderSignPayBtns(); scrollTo(0, 0);
    });
    await page.waitForTimeout(100);
    const r = await page.evaluate(() => {
      const tf = document.getElementById('pay-tile-full');
      const amt = document.getElementById('pay-tile-full-amt');
      const t = tf.getBoundingClientRect(), a = amt.getBoundingClientRect();
      const back = [...document.querySelectorAll('#pg-pay button')].find(b => /Back/.test(b.textContent));
      const bs = getComputedStyle(back);
      const opts = [...document.querySelectorAll('#sign-pay-btns .pay-method-opt')];
      return {
        bleed: document.documentElement.scrollWidth <= innerWidth + 1,
        tileRight: t.right, amtRight: a.right, vw: innerWidth,
        amtInside: a.right <= t.right + 0.5 && a.left >= t.left - 0.5,
        backIsBtn: back.classList.contains('btn'), backBg: bs.backgroundColor, backH: back.getBoundingClientRect().height,
        optLabels: opts.map(o => o.textContent.trim()),
        optColors: opts.map(o => getComputedStyle(o).color),
        optH: opts.map(o => o.getBoundingClientRect().height),
      };
    });
    expect(r.bleed).toBe(true);
    expect(r.tileRight).toBeLessThanOrEqual(r.vw);
    expect(r.amtInside, 'the $129,025.00 fits inside the Pay in Full card').toBe(true);
    expect(r.backIsBtn).toBe(false);
    expect(['rgba(0, 0, 0, 0)', 'transparent']).toContain(r.backBg);
    expect(r.backH).toBeGreaterThanOrEqual(44);
    expect(r.optLabels).toEqual(['Pay Later', 'Check', 'Cash']);
    r.optColors.forEach(c => expect(c).not.toBe('rgb(148, 163, 184)'));   // the old greyed-out slate
    r.optH.forEach(h => expect(h).toBeGreaterThanOrEqual(44));
  });

  test('no console errors, sign.html', async () => {
    assertNoErrors(page, 'Earl audit sign');
  });
});

test.describe('sign.html: a brand colour never paints Back as the big button', () => {
  test('with a brand colour set, .btn-sec keeps its outline look', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: SE, bypassCSP: true });
    const page = await ctx.newPage();
    const PROP = { ...MOCK_PROPOSAL, trade: 'plumbing', surfaces: [], brandColor: '#E8590C' };
    await page.addInitScript((d) => { window.__mockProposalData = d; }, PROP);
    await mockAllExternal(page, { alreadySigned: false, proposalData: PROP, bidId: FAKE_BID_ID_1 });
    await page.goto(`/sign.html?key=proposals/${FAKE_USER_ID}/${FAKE_BID_ID_1}_${FAKE_TOKEN}.json`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2000);
    const r = await page.evaluate(() => {
      const b = document.createElement('button'); b.className = 'btn btn-sec'; document.body.appendChild(b);
      const bg = getComputedStyle(b).backgroundColor; b.remove(); return bg;
    });
    expect(['rgba(0, 0, 0, 0)', 'transparent']).toContain(r);
    assertNoErrors(page, 'brand colour btn-sec');
    await ctx.close();
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  intake.html, THE QR LEAD FORM WITH NO SIGNAL
// ════════════════════════════════════════════════════════════════════════════
test.describe('intake.html: no signal keeps the entry and sends it when back online', () => {
  test('offline submit saves the entry, says so, and sends it on the online event', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: SE, bypassCSP: true });
    const page = await ctx.newPage();
    await mockAllExternal(page);
    // intake.html reads its contractor from account_public: the intake shim answers it.
    await page.route(u => u.href.includes('supabase') && (u.href.includes('/js/vendor/') || u.href.includes('cdn.jsdelivr.net')),
      route => route.fulfill({ status: 200, contentType: 'application/javascript', body: _supabaseShimIntake().replace(/table==='accounts'/g, "(table==='accounts'||table==='account_public')") }));
    await page.goto('/intake.html?a=acct-e2e-0001', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForSelector('#pg-form', { state: 'visible', timeout: 10000 });
    const ph = await page.getAttribute('#f-notes', 'placeholder');
    expect(ph).not.toContain('Interior walls');
    await page.fill('#f-name', 'Dale Pruitt');
    await page.fill('#f-phone', '785-555-0142');
    await page.fill('#f-street', '12 Elm St');
    await page.fill('#f-city', 'Topeka');
    await page.fill('#f-notes', 'Water heater leaking');
    await page.evaluate(() => {
      window.__sent = [];
      window.__signal = false;
      _supa.from = (t) => ({
        insert: (row) => {
          if (!window.__signal) return Promise.resolve({ data: null, error: { message: 'TypeError: Failed to fetch' } });
          window.__sent.push(row); return Promise.resolve({ data: [row], error: null });
        },
      });
    });
    await ctx.setOffline(true);
    await page.click('#submit-btn');
    await page.waitForTimeout(200);
    const off = await page.evaluate(() => ({
      err: document.getElementById('form-err').textContent,
      name: document.getElementById('f-name').value,
      kept: JSON.parse(localStorage.getItem('zp3_intake_pending_acct-e2e-0001') || 'null'),
      confirm: getComputedStyle(document.getElementById('pg-confirm')).display,
    }));
    expect(off.err).toContain('No signal');
    expect(off.err).not.toContain('Something went wrong');
    expect(off.name).toBe('Dale Pruitt');
    expect(off.kept && off.kept.name).toBe('Dale Pruitt');
    expect(off.confirm).toBe('none');
    await page.evaluate(() => { window.__signal = true; });
    await ctx.setOffline(false);
    await page.waitForFunction(() => window.__sent.length === 1, null, { timeout: 5000 });
    const on = await page.evaluate(() => ({
      sent: window.__sent[0].name, notes: window.__sent[0].notes,
      kept: localStorage.getItem('zp3_intake_pending_acct-e2e-0001'),
      confirm: getComputedStyle(document.getElementById('pg-confirm')).display,
    }));
    expect(on.sent).toBe('Dale Pruitt');
    expect(on.notes).toBe('Water heater leaking');
    expect(on.kept).toBe(null);
    expect(on.confirm).not.toBe('none');
    assertNoErrors(page, 'intake offline');
    await ctx.close();
  });
});
