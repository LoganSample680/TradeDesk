// @ts-check
/**
 * Layout & Visual Integrity guard (CLAUDE.md §16.3). Catches the class of bug where a
 * screen renders "all fuckered up" — duplicate/overlapping controls or content that
 * bleeds off-screen on mobile.
 *
 * Specific regression locked in here: the BYO/T&M summary rail had a second, half-wired
 * `#byo-mob-bar` (position:fixed) that showed a stale $0 total and OVERLAPPED the rail's
 * own Send/Sign buttons on phones. It's deleted outright now; this proves it stays gone
 * and that the app doesn't bleed past the viewport at mobile width.
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors, goPg } = require('./helpers');

test.describe('layout integrity — mobile', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForAppBoot(page);
  });

  test.afterAll(async () => { await page.context().close(); });

  test('the broken duplicate BYO sticky bar (#byo-mob-bar) was deleted, not just hidden', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    const r = await page.evaluate(() => ({ exists: !!document.getElementById('byo-mob-bar') }));
    expect(r.exists, '#byo-mob-bar must be gone from the DOM — it duplicated/overlapped the rail actions').toBe(false);
  });

  test('the app does not bleed past the viewport width on mobile (390px)', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, 'no element may cause horizontal scroll / bleed off-screen at 390px').toBeLessThanOrEqual(1);
  });

  // Regression: settings' city/state/zip row used 1fr 60px 80px while the identical
  // control elsewhere in the app (intake.html, client.html) used 1fr 56px 90px — the
  // zip box was a visibly different size from every other zip box in the product.
  // Separately, the phone/email row split 1fr 1fr on mobile, so the (much longer)
  // email address got clipped mid-string on a 390px phone. Fixed: settings now matches
  // the app-wide 56px/90px convention, and phone/email stacks on mobile via .set-form-2col.
  test('settings: zip matches the app-wide city/state/zip proportions, and email never clips on mobile', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await goPg(page, 'pg-settings'); // navigates + waits for the .pg.active transition to settle
    // Settings is index→detail: pg-settings only shows the category LIST. The
    // actual form fields live in the "Business info" detail sub-view, revealed by
    // _openSetDetail('biz') (adds .active to #setd-biz, hides #set-index-view).
    // Without this the fields are real but 0×0 (parent detail panel hidden) — the
    // root cause of this test's own initial flake.
    await page.evaluate(() => { _openSetDetail('biz'); });
    const r = await page.evaluate(() => {
      const city = document.getElementById('set-bcity');
      const zip = document.getElementById('set-bzip');
      const state = document.getElementById('set-bstate-display');
      const phone = document.getElementById('set-bphone');
      const email = document.getElementById('set-bemail');
      if (!zip || !state || !phone || !email || !city) return { missing: true };
      // The actual reported value (owner's real email, 24 chars) — long enough to
      // clip in the old half-width split, short enough to fit once stacked full-width.
      // A single-line <input> never wraps, so an arbitrarily long stress string would
      // clip at ANY width — that's normal input behavior, not a layout bug.
      email.value = 'logansample97@gmail.com';
      const cr = city.getBoundingClientRect();
      const zr = zip.getBoundingClientRect(), sr = state.getBoundingClientRect();
      const pr = phone.getBoundingClientRect(), er = email.getBoundingClientRect();
      return {
        missing: false,
        detailActive: document.getElementById('setd-biz')?.classList.contains('active') || false,
        zipWiderThanState: zr.width > sr.width,       // 90px > 56px — matches app convention
        // iOS Safari renders inputmode="numeric" ~18px taller than sibling inputs sharing
        // the identical font/padding/border rule (a platform quirk) — pinned to an
        // explicit height:48px on all three so they render identically everywhere.
        sameHeight: Math.abs(zr.height - sr.height) <= 1 && Math.abs(zr.height - cr.height) <= 1,
        stacked: Math.abs(pr.top - er.top) > 5,        // email drops to its own row on mobile
        // Once stacked, phone and email each get the FULL row width (equal to each
        // other) rather than splitting it — email must be within a few px of phone's
        // width, not still constrained to half the row.
        emailFullWidth: Math.abs(er.width - pr.width) <= 2,
        emailMajorityOfViewport: er.width >= window.innerWidth * 0.6,
        emailFitsViewport: er.right <= window.innerWidth + 1,
        scrollValue: email.scrollWidth,
        clientValue: email.clientWidth,
      };
    });
    expect(r.missing, 'zip/state/phone/email inputs must exist on the settings page').toBe(false);
    expect(r.detailActive, 'the Business info detail sub-view (#setd-biz) must be open before measuring layout').toBe(true);
    expect(r.zipWiderThanState, 'zip box must use the same 56px/90px proportions as every other city/state/zip control in the app').toBe(true);
    expect(r.sameHeight, 'city/state/zip must render at the same height — no per-input inputmode quirk').toBe(true);
    expect(r.stacked, 'phone and email must stack on mobile so email gets full row width').toBe(true);
    expect(r.emailFullWidth, 'email box must match phone box width (both get the full stacked row), not still be half-split').toBe(true);
    expect(r.emailMajorityOfViewport, 'email box must actually span most of the viewport width once stacked').toBe(true);
    expect(r.emailFitsViewport, 'email box must not bleed past the viewport edge').toBe(true);
    expect(r.scrollValue - r.clientValue, 'a long email must not overflow its own box (no clipped text)').toBeLessThanOrEqual(2);
  });

  // Regression (owner-reported, real device screenshot): on the New Lead / client record
  // form, the State/Zip row is one grid cell (#cf-state/#cf-zip nested "1fr 80px" grid)
  // sharing its column with Property type and Occupation (separate rows, same auto-fit
  // column track). Without an explicit min-width:0 on that nested-grid wrapper and its
  // 1fr (State) child, the State input's intrinsic min-content width can push the whole
  // cell wider than its assigned column, so the Zip box's right edge lands a few px past
  // Property type/Occupation's right edge — visibly "not in line" on the right.
  test('client form: State/Zip cell right edge lines up with Property type / Occupation (no nested-grid overflow)', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await goPg(page, 'pg-clients');
    const r = await page.evaluate(() => {
      if (typeof openNewClient !== 'function') return { missing: true };
      openNewClient();
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
      set('cf-street', '2020 SW Randolph Ave');
      set('cf-city', 'Topeka');
      set('cf-state', 'KS');
      set('cf-zip', '66604');
      const zip = document.getElementById('cf-zip');
      const ptype = document.getElementById('cf-ptype');
      const occupation = document.getElementById('cf-occupation');
      if (!zip || !ptype || !occupation) return { missing: true };
      return {
        missing: false,
        zipRight: zip.getBoundingClientRect().right,
        ptypeRight: ptype.getBoundingClientRect().right,
        occupationRight: occupation.getBoundingClientRect().right,
      };
    });
    expect(r.missing, 'cf-zip / cf-ptype / cf-occupation must exist on the New Lead form').toBe(false);
    expect(Math.abs(r.zipRight - r.ptypeRight), 'Zip box right edge must line up with Property type right edge').toBeLessThanOrEqual(1);
    expect(Math.abs(r.zipRight - r.occupationRight), 'Zip box right edge must line up with Occupation right edge').toBeLessThanOrEqual(1);
  });

  // Regression: the dashboard "Crew today" tile used background:var(--bg2) — the app's
  // convention for NESTED/inset surfaces sitting inside a card (buttons, sub-boxes, table
  // headers) — instead of var(--bg-card), the white top-level tile background every other
  // dashboard tile uses. In light mode --bg2 (#F4F5F7) reads as grey next to every white
  // sibling tile. Fixed to var(--bg-card). Checked via source string, not a live render:
  // _renderDashCrewToday requires team tracking + comp permission + real time-entry rows
  // that the offline mock's generic query shim can't supply.
  test('dashboard "Crew today" tile uses the same card background as every other tile', async () => {
    const r = await page.evaluate(() => {
      const src = typeof _renderDashCrewToday === 'function' ? _renderDashCrewToday.toString() : null;
      if (!src) return { missing: true };
      return {
        missing: false,
        usesCardBg: src.includes('background:var(--bg-card)'),
        usesInsetBg: src.includes('background:var(--bg2)'),
      };
    });
    expect(r.missing, '_renderDashCrewToday must exist').toBe(false);
    expect(r.usesCardBg, 'the tile wrapper must use var(--bg-card) — the same white background every other dashboard tile uses').toBe(true);
    expect(r.usesInsetBg, 'the tile must NOT use var(--bg2) — that is the inset/nested-surface color, not a top-level tile background').toBe(false);
  });

  // Regression: a BYO line-item note with no spaces (a long unbroken string —
  // exactly what a contractor pastes/mashes into the notes textarea) overflowed
  // its row and bled past the viewport edge on mobile. .byo-body had min-width:0
  // (correct for the flex-shrink) but nothing telling the browser it's allowed to
  // break a word with no natural break point — overflow-wrap:anywhere fixes it.
  test('a long unbroken BYO item note wraps inside its row, does not bleed off-screen at 390px', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    const r = await page.evaluate(() => {
      const c = { id: 79101, name: 'Bleed Test Client', addr: '1 Bleed St' };
      clients = clients.filter(x => x.id !== 79101).concat([c]);
      bids = bids.filter(x => x.client_id !== 79101);
      openGenericEstimate(c, null, 'painting');
      _geiIsFreeForm = true;
      goGeiStep(2); // renders gei-byo-page shell via _byoShowPage (no saved bid, so byoItems resets to [])
      const garbage = 'jdsjdjdjbddbdbdbbdnsjsksksnsnsnsmmsmsmssnsnsmssmsmsnsjdjdndjdjdjdjshshshshsjjsjsjsjsjjs';
      _byoItems = [{ id: 1, section: 'Interior', label: 'Test', notes: garbage, price: 100, on: true }];
      _byoRenderSections(); // re-render rows with the note now that the page shell exists
      const overflow = document.documentElement.scrollWidth - window.innerWidth;
      const metaEl = [...document.querySelectorAll('.byo-meta')].find(el => el.textContent.includes(garbage.slice(0, 20)));
      return {
        overflow,
        metaFound: !!metaEl,
        metaFitsRow: metaEl ? metaEl.getBoundingClientRect().right <= window.innerWidth + 1 : null,
      };
    });
    expect(r.metaFound, 'the long-note row must actually be in the DOM for this test to mean anything').toBe(true);
    expect(r.overflow, 'no horizontal bleed at 390px from a long unbroken notes string').toBeLessThanOrEqual(1);
    expect(r.metaFitsRow, 'the notes text itself must stay within the viewport, not run off the right edge').toBe(true);
  });

  // Regression: the estimate-builder row fix above did NOT cover the actual
  // generated proposal HTML — a long unbroken BYO item note bled off-screen in
  // BOTH the "Scope of work" section AND the line-item "Description" table of
  // the real client preview (owner-reported: garbled text confined correctly on
  // the estimate page but not in the proposal). Root cause: the notes/description
  // divs generated inline inside sendGenericProposal had their own separate inline
  // styles with no overflow-wrap, so the estimate-page CSS class fix never applied
  // to them. Fixed at both the specific render sites AND the outer containers
  // (#prop-html in sign.html, the preview overlay body) as a defense-in-depth net.
  test('a long unbroken BYO item note does not bleed off-screen inside the generated proposal preview (scope section + line-item table)', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    const r = await page.evaluate(async () => {
      const c = { id: 79103, name: 'Proposal Bleed Client', addr: '1 Proposal Bleed Rd' };
      clients = clients.filter(x => x.id !== 79103).concat([c]);
      bids = bids.filter(x => x.client_id !== 79103);
      openGenericEstimate(c, null, 'painting');
      _geiIsFreeForm = true;
      const garbage = 'Sjdbdhfbdbdbdndbdbsnsbbdbddndndnbdndndndbdndndndndndsjdjdjdjshshshshahaha';
      _byoItems = [{ id: 1, section: 'Interior', label: 'Dining', notes: garbage, price: 300, on: true }];
      let err = null;
      try { await sendGenericProposal(true); } catch (e) { err = e.message; }
      const ov = document.getElementById('_prop-preview-ov');
      const overflow = document.documentElement.scrollWidth - window.innerWidth;
      const garbledEl = ov ? [...ov.querySelectorAll('*')].filter(el => el.children.length === 0).find(el => el.textContent.includes(garbage.slice(0, 20))) : null;
      const res = {
        err,
        hasOverlay: !!ov,
        garbledFound: !!garbledEl,
        garbledFitsScreen: garbledEl ? garbledEl.getBoundingClientRect().right <= window.innerWidth + 1 : null,
        overflow,
      };
      ov?.remove();
      return res;
    });
    expect(r.err).toBe(null);
    expect(r.hasOverlay).toBe(true);
    expect(r.garbledFound, 'the garbled note must actually render in the generated proposal for this test to mean anything').toBe(true);
    expect(r.garbledFitsScreen, 'the garbled note must wrap within the viewport inside the proposal, not run off the right edge').toBe(true);
    expect(r.overflow, 'no horizontal bleed at 390px from the generated proposal HTML').toBeLessThanOrEqual(1);
  });

  // Regression (owner-reported, real device screenshot): large dollar amounts in the
  // generated proposal preview wrapped mid-number ("$234,234.0" then "0" on its own
  // line) because the amount <td>s had no white-space:nowrap, so the preview overlay's
  // container-level overflow-wrap:anywhere (needed for long free-text descriptions)
  // let big prices break at arbitrary character boundaries in their narrow column.
  test('large dollar amounts in the proposal preview never wrap mid-number', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    const r = await page.evaluate(async () => {
      const c = { id: 79104, name: 'Dollar Wrap Client', addr: '1 Dollar Wrap Rd' };
      clients = clients.filter(x => x.id !== 79104).concat([c]);
      bids = bids.filter(x => x.client_id !== 79104);
      openGenericEstimate(c, null, null, { mode: 'byo' });
      _geiIsFreeForm = true;
      // Deliberately oversized figures — wider than the Amount column's 90px header hint.
      _geiLines = [
        { desc: 'Bedroom', qty: 1, rate: 234234, total: 234234, _byoSection: 'Interior' },
        { desc: 'Exterior', qty: 1, rate: 2342342, total: 2342342, _byoSection: 'Exterior' },
      ];
      let err = null;
      try { await sendGenericProposal(true); } catch (e) { err = e.message; }
      const ov = document.getElementById('_prop-preview-ov');
      const amountCells = ov ? [...ov.querySelectorAll('td')].filter(td => td.textContent.trim().startsWith('$')) : [];
      const res = {
        err,
        hasOverlay: !!ov,
        cellCount: amountCells.length,
        allNowrap: amountCells.every(td => getComputedStyle(td).whiteSpace === 'nowrap'),
        texts: amountCells.map(td => td.textContent.trim()),
      };
      ov?.remove();
      return res;
    });
    expect(r.err).toBe(null);
    expect(r.hasOverlay).toBe(true);
    expect(r.cellCount, 'the proposal must actually render dollar-amount cells for this test to mean anything').toBeGreaterThan(0);
    expect(r.allNowrap, 'every dollar-amount cell must be white-space:nowrap so a big number can never break mid-digit').toBe(true);
    expect(r.texts.some(t => t.includes('234,234'))).toBe(true);
    expect(r.texts.some(t => t.includes('2,342,342'))).toBe(true);
  });

  // Regression: T&M material category rows had no visible "Edit" affordance —
  // only a hover-only (opacity:0 until :hover) delete "×", invisible/undiscoverable
  // on touch devices, and inconsistent with BYO's always-visible Edit/✕ pair.
  // Both lists now render from the same _geiRowActionBtns helper.
  test('T&M material category row has a visible Edit button, matching BYO\'s row treatment', async () => {
    const r = await page.evaluate(() => {
      const c = { id: 79102, name: 'TM Edit Btn Client', addr: '1 Edit Btn Rd' };
      clients = clients.filter(x => x.id !== 79102).concat([c]);
      bids = bids.filter(x => x.client_id !== 79102);
      openGenericEstimate(c, null, 'general');
      _geiIsTM = true; _geiIsFreeForm = false;
      _geiLines = [{ desc: 'Paint', qty: 1, rate: 200, total: 200, _tmLabor: false }];
      goGeiStep(2); // renders gei-tm-page via _tmShowPage → _tmRenderMatList
      const row = document.querySelector('#tm-mat-list .tm-mat-row');
      const editBtn = row ? [...row.querySelectorAll('button')].find(b => b.textContent.trim() === 'Edit') : null;
      const res = {
        hasRow: !!row,
        hasEditBtn: !!editBtn,
        editVisible: editBtn ? getComputedStyle(editBtn).opacity !== '0' : null,
      };
      _geiIsTM = false;
      return res;
    });
    expect(r.hasRow).toBe(true);
    expect(r.hasEditBtn, 'material category row must have a visible "Edit" button').toBe(true);
    expect(r.editVisible, 'the Edit button must be visible by default, not hover-only').toBe(true);
  });

  test('no console errors', async () => { await assertNoErrors(page); });
});
