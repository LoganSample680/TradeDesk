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

  // Regression (owner-reported, real device screenshot): .byo-row used
  // align-items:center, so a long multi-line note (making the row very tall)
  // vertically centered the checkbox and price/Edit/✕ cluster against the whole
  // row height — they floated in the middle of the wrapped paragraph instead of
  // staying next to the item title at the top, looking broken on any screen size.
  // Note: alignment lives on the inner .byo-row-hd header line now, not .byo-row
  // itself — .byo-row became a column container (header row + full-width notes
  // below it) as part of taking advantage of the grey space notes used to waste
  // next to the price/Edit/x buttons (see the next test).
  test('BYO item row: checkbox and price/actions stay top-aligned with the item title, even with a long wrapped note', async () => {
    const r = await page.evaluate(() => {
      const c = { id: 79102, name: 'Row Align Client', addr: '1 Row Align St' };
      clients = clients.filter(x => x.id !== 79102).concat([c]);
      bids = bids.filter(x => x.client_id !== 79102);
      openGenericEstimate(c, null, null, { mode: 'byo' });
      goGeiStep(2);
      _geiIsFreeForm = true;
      const longNote = Array(20).fill('Long wrapped note line here').join(' ');
      _byoItems = [{ id: 1, section: 'Materials', label: 'test', notes: longNote, price: 1232134, on: true }];
      _byoRenderSections();
      const row = document.querySelector('.byo-row');
      if (!row) return { missing: true };
      const hd = row.querySelector('.byo-row-hd');
      const check = row.querySelector('.byo-check');
      const label = row.querySelector('.byo-label');
      const price = row.querySelector('.byo-price');
      const lTop = label.getBoundingClientRect().top;
      return {
        missing: false,
        alignItems: hd ? getComputedStyle(hd).alignItems : null,
        checkNearLabel: Math.abs(check.getBoundingClientRect().top - lTop) < 5,
        priceNearLabel: Math.abs(price.getBoundingClientRect().top - lTop) < 5,
      };
    });
    expect(r.missing, 'the BYO item row must exist for this test to mean anything').toBe(false);
    expect(r.alignItems).toBe('center');
    expect(r.checkNearLabel, 'checkbox must stay aligned with the item title, not centered against a tall note').toBe(true);
    expect(r.priceNearLabel, 'price must stay aligned with the item title, not centered against a tall note').toBe(true);
  });

  // Regression (owner-reported): a BYO item's notes were squeezed into the narrow
  // middle column next to the checkbox, leaving the grey space under the price/
  // Edit/x buttons empty for the rest of the note's height. Notes now render as
  // their own full-width block below the header row instead. Same shared
  // _geiItemRowHtml function drives both BYO items and T&M material categories.
  test('BYO item row: notes render full-width below the header line, not squeezed into a narrow column', async () => {
    const r = await page.evaluate(() => {
      const c = { id: 79103, name: 'Row Width Client', addr: '1 Row Width St' };
      clients = clients.filter(x => x.id !== 79103).concat([c]);
      bids = bids.filter(x => x.client_id !== 79103);
      openGenericEstimate(c, null, null, { mode: 'byo' });
      goGeiStep(2);
      _geiIsFreeForm = true;
      const longNote = Array(20).fill('Long wrapped note line here').join(' ');
      _byoItems = [{ id: 1, section: 'Materials', label: 'Bedroom', notes: longNote, price: 234234, on: true }];
      _byoRenderSections();
      const row = document.querySelector('.byo-row');
      if (!row) return { missing: true };
      const hd = row.querySelector('.byo-row-hd');
      const meta = row.querySelector('.byo-meta');
      if (!hd || !meta) return { missing: true };
      const rowRect = row.getBoundingClientRect();
      const hdRect = hd.getBoundingClientRect();
      const metaRect = meta.getBoundingClientRect();
      return {
        missing: false,
        metaBelowHeader: metaRect.top >= hdRect.bottom - 1,
        metaUsesMostOfRowWidth: metaRect.width >= rowRect.width * 0.7,
      };
    });
    expect(r.missing, 'the row, header, and notes elements must all exist for this test to mean anything').toBe(false);
    expect(r.metaBelowHeader, 'notes must sit below the header row (checkbox/title/price/actions), not beside it').toBe(true);
    expect(r.metaUsesMostOfRowWidth, 'notes must use most of the row width, not be squeezed into a narrow column').toBe(true);
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
  //
  // Superseded in part by the owner's later "strip everything but TOTAL + deposit"
  // directive: per-room/per-item amounts (the original $234,234.00 cells this test
  // checked) no longer render in the client proposal at all — only TOTAL and the
  // deposit carry a dollar figure now. This test still guards the original bug's
  // mechanism (a big number must never wrap mid-digit), just against the one cell
  // that can still be huge: TOTAL, built from the same deliberately oversized line
  // items so the underlying total is well past the old 90px column width.
  test('large dollar amounts in the proposal preview never wrap mid-number (TOTAL only — per-item prices no longer render)', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    const r = await page.evaluate(async () => {
      const c = { id: 79104, name: 'Dollar Wrap Client', addr: '1 Dollar Wrap Rd' };
      clients = clients.filter(x => x.id !== 79104).concat([c]);
      bids = bids.filter(x => x.client_id !== 79104);
      openGenericEstimate(c, null, null, { mode: 'byo' });
      _geiIsFreeForm = true;
      // Deliberately oversized figures — total is wider than the old 90px Amount column.
      _geiLines = [
        { desc: 'Bedroom', qty: 1, rate: 234234, total: 234234, _byoSection: 'Interior' },
        { desc: 'Exterior', qty: 1, rate: 2342342, total: 2342342, _byoSection: 'Exterior' },
      ];
      let err = null;
      try { await sendGenericProposal(true); } catch (e) { err = e.message; }
      const ov = document.getElementById('_prop-preview-ov');
      const dollarCells = ov ? [...ov.querySelectorAll('td')].filter(td => /\$[\d,]+\.\d{2}/.test(td.textContent)) : [];
      const totalCell = dollarCells.find(td => td.textContent.includes('2,576,576'));
      const res = {
        err,
        hasOverlay: !!ov,
        dollarCellCount: dollarCells.length,
        totalFound: !!totalCell,
        totalIsNowrap: totalCell ? getComputedStyle(totalCell).whiteSpace === 'nowrap' : false,
        // The old per-item cells must be gone — no $234,234.00 / $2,342,342.00 line shown.
        hasPerRoomPrice: dollarCells.some(td => td.textContent.includes('234,234.00') || td.textContent.includes('2,342,342.00')),
      };
      ov?.remove();
      return res;
    });
    expect(r.err).toBe(null);
    expect(r.hasOverlay).toBe(true);
    expect(r.hasPerRoomPrice, 'per-room/per-item dollar amounts must not render — only TOTAL and deposit show a price').toBe(false);
    expect(r.totalFound, 'the TOTAL cell must contain the full combined figure for this test to mean anything').toBe(true);
    expect(r.totalIsNowrap, 'the TOTAL cell must be white-space:nowrap so a big number can never break mid-digit').toBe(true);
    expect(r.dollarCellCount, 'only TOTAL + deposit should carry a dollar figure').toBeLessThanOrEqual(2);
  });

  // Owner directive: clients seeing a per-room or per-material price (e.g. Interior
  // $7,000 vs Materials $7,000) can anchor on those numbers and conclude they could
  // buy the materials and hire cheaper labor themselves for less than the total bid.
  // The client-facing proposal shows exactly two dollar figures — TOTAL and the
  // deposit due — never a per-room, per-material, tax/markup, or NTE-cap breakdown.
  // Applies to both BYO and T&M; scope descriptions (room/material names + notes)
  // still show, just without a dollar amount attached to any of them.
  // Regression: once per-item prices came out, BYO's pricing table was reduced to
  // repeating the exact same section headers + item names already listed under
  // "Scope of work" — same names, same section labels, nothing new. Removed the
  // table entirely for BYO (room/material names now live in Scope of work only);
  // T&M keeps its item table since materials aren't listed anywhere else.
  test('proposal shows only TOTAL + deposit — no per-room, per-material, tax, or NTE-cap price, no redundant Description table (BYO)', async () => {
    const r = await page.evaluate(async () => {
      const c = { id: 79107, name: 'Total Only BYO Client', addr: '1 Total Only Rd' };
      clients = clients.filter(x => x.id !== 79107).concat([c]);
      bids = bids.filter(x => x.client_id !== 79107);
      openGenericEstimate(c, null, null, { mode: 'byo' });
      _geiIsFreeForm = true;
      _byoItems = [
        { id: 1, section: 'Interior', label: 'Bedroom', price: 500, on: true },
        { id: 2, section: 'Exterior', label: 'Siding', price: 700, on: true },
        { id: 3, section: 'Materials', label: 'Paint and primer', price: 300, on: true },
      ];
      _byoUpdateRail();
      document.getElementById('gei-tax-pct').value = '8';
      let err = null;
      try { await sendGenericProposal(true); } catch (e) { err = e.message; }
      const ov = document.getElementById('_prop-preview-ov');
      const html = ov ? ov.innerHTML : '';
      const res = {
        err,
        hasOverlay: !!ov,
        hasRoomNames: html.includes('Bedroom') && html.includes('Siding') && html.includes('Paint and primer'),
        bedroomOccurrences: (html.match(/Bedroom/g) || []).length,
        hasPerItemPrice: /\$500\.00|\$700\.00|\$300\.00/.test(html),
        hasDescHeader: html.includes('>Description<'),
        hasQtyHeader: html.includes('>Qty<'),
        hasAmountHeader: html.includes('>Amount<'),
        hasTaxRow: html.includes('Tax / markup') || html.includes('Sales tax') || html.includes('Materials tax'),
        hasTotal: html.includes('TOTAL'),
        hasDeposit: html.includes('Deposit'),
      };
      ov?.remove();
      return res;
    });
    expect(r.err).toBe(null);
    expect(r.hasOverlay).toBe(true);
    expect(r.hasRoomNames, 'room/material names must still show, via Scope of work').toBe(true);
    expect(r.bedroomOccurrences, 'a BYO item name must appear exactly once — no redundant repeat in a Description table').toBe(1);
    expect(r.hasPerItemPrice, 'no per-room/per-material dollar amount may render').toBe(false);
    expect(r.hasDescHeader, 'the Description table must be gone entirely for BYO — Scope of work already lists everything').toBe(false);
    expect(r.hasQtyHeader, 'the Qty column must be gone').toBe(false);
    expect(r.hasAmountHeader, 'the Amount column must be gone').toBe(false);
    expect(r.hasTaxRow, 'no separate tax/markup breakdown row may render').toBe(false);
    expect(r.hasTotal).toBe(true);
    expect(r.hasDeposit).toBe(true);
  });

  // Owner-reported: a BYO item with no notes printed as a bare one-word line
  // ("1. Room") next to fully-described scope items — read as an unfinished
  // document. Notes-less items now get a quiet section-appropriate descriptor;
  // items WITH notes keep their own notes untouched.
  test('BYO item without notes gets a section descriptor in the proposal — never a bare one-word line', async () => {
    const r = await page.evaluate(async () => {
      const c = { id: 79109, name: 'Bare Room Client', addr: '2 Bare Room Rd' };
      clients = clients.filter(x => x.id !== 79109).concat([c]);
      bids = bids.filter(x => x.client_id !== 79109);
      openGenericEstimate(c, null, null, { mode: 'byo' });
      _geiIsFreeForm = true;
      _byoItems = [
        { id: 1, section: 'Interior', label: 'Room', price: 500, on: true },                          // no notes
        { id: 2, section: 'Interior', label: 'Kitchen', price: 400, on: true, notes: 'Two coats, ceilings included' },
        { id: 3, section: 'Materials', label: 'Paint', price: 300, on: true },                        // no notes
      ];
      _byoUpdateRail();
      let err = null;
      try { await sendGenericProposal(true); } catch (e) { err = e.message; }
      const ov = document.getElementById('_prop-preview-ov');
      const html = ov ? ov.innerHTML : '';
      const res = {
        err,
        workFallback: html.includes('Labor and materials per agreed scope'),
        matFallback: html.includes('Included in project total'),
        ownNotesKept: html.includes('Two coats, ceilings included'),
        kitchenNotDoubled: !html.includes('Kitchen<span') || !/Kitchen<span[^>]*> — Labor and materials/.test(html),
      };
      ov?.remove();
      return res;
    });
    expect(r.err).toBe(null);
    expect(r.workFallback, 'notes-less work item must carry the work descriptor').toBe(true);
    expect(r.matFallback, 'notes-less Materials item must carry the materials descriptor').toBe(true);
    expect(r.ownNotesKept, 'an item WITH notes keeps its own notes').toBe(true);
    expect(r.kitchenNotDoubled, 'fallback must not replace or double real notes').toBe(true);
  });

  test('proposal shows only TOTAL + deposit — no per-material or NTE-cap price (T&M)', async () => {
    const r = await page.evaluate(async () => {
      const c = { id: 79108, name: 'Total Only TM Client', addr: '1 Total Only TM Rd' };
      clients = clients.filter(x => x.id !== 79108).concat([c]);
      bids = bids.filter(x => x.client_id !== 79108);
      openGenericEstimate(c, null, null, { mode: 'tm' });
      goGeiStep(2);
      // Drive the real DOM inputs — _tmInputChange reads live values from these, not
      // from the module variables directly, so setting the variables alone is silently
      // overwritten on the next recalc.
      document.getElementById('tm-i-rate').value = '75';
      document.getElementById('tm-i-days').value = '2';
      _tmInputChange();
      _geiLines.push({ desc: 'Fixtures', qty: 1, rate: 500, total: 500 });
      document.getElementById('tm-i-nte').value = '2000';
      let err = null;
      try { await sendGenericProposal(true); } catch (e) { err = e.message; }
      const ov = document.getElementById('_prop-preview-ov');
      const html = ov ? ov.innerHTML : '';
      const res = {
        err,
        hasOverlay: !!ov,
        hasMaterialName: html.includes('Fixtures'),
        hasPerItemPrice: /\$500\.00/.test(html),
        hasNteRow: html.includes('Not-to-exceed cap'),
        hasTotal: html.includes('ESTIMATED TOTAL'),
        hasDeposit: html.includes('Deposit'),
      };
      ov?.remove();
      return res;
    });
    expect(r.err).toBe(null);
    expect(r.hasOverlay).toBe(true);
    expect(r.hasMaterialName, 'material category name must still show').toBe(true);
    expect(r.hasPerItemPrice, 'no per-material dollar amount may render').toBe(false);
    expect(r.hasNteRow, 'the standalone NTE-cap pricing row must be gone (still disclosed in Terms & Conditions)').toBe(false);
    expect(r.hasTotal).toBe(true);
    expect(r.hasDeposit).toBe(true);
  });

  // Owner directive: proposals should look "damn good, better than the competition."
  // Decorative emoji (⏱️ in the header, 📋 on the panel schedule, ⚠️ on the rebalance
  // warning) read as unpolished on a document a client is about to sign — stripped
  // from the client-facing proposal (the app's own builder UI can keep them, this
  // only covers the exported proposalHtml). The plain ✓/× glyphs used as functional
  // status marks are not emoji and are exempt.
  test('client-facing proposal has no decorative emoji in its header or section labels', async () => {
    const r = await page.evaluate(async () => {
      const c = { id: 79109, name: 'No Emoji Client', addr: '1 No Emoji Rd' };
      clients = clients.filter(x => x.id !== 79109).concat([c]);
      bids = bids.filter(x => x.client_id !== 79109);
      openGenericEstimate(c, null, null, { mode: 'byo' });
      _geiIsFreeForm = true;
      _byoItems = [{ id: 1, section: 'Interior', label: 'Bedroom', price: 500, on: true }];
      _byoUpdateRail();
      let err = null;
      try { await sendGenericProposal(true); } catch (e) { err = e.message; }
      const ov = document.getElementById('_prop-preview-ov');
      // Scope to the actual proposal DOCUMENT only (ov's 2nd child) — ov's 1st
      // child is the preview MODAL's own chrome ("👁 Client preview — how
      // they'll see it" + Close button), which is internal app UI the client
      // never sees, not the exported proposalHtml this test is guarding.
      const html = ov ? (ov.lastElementChild ? ov.lastElementChild.innerHTML : ov.innerHTML) : '';
      // Decorative pictographic emoji range — excludes the plain ✓ (U+2713) checkmark,
      // which sits at U+2600-27BF and is used as a functional status glyph, not decoration.
      const decorativeEmoji = [...html.matchAll(/[\u{1F300}-\u{1FAFF}]/gu)];
      const res = {
        err,
        hasDecorativeEmoji: decorativeEmoji.length > 0,
        hasServiceProposalHeader: html.includes('Proposal'),
      };
      ov?.remove();
      return res;
    });
    expect(r.err).toBe(null);
    expect(r.hasDecorativeEmoji, 'no pictographic emoji may render in the client-facing proposal').toBe(false);
    expect(r.hasServiceProposalHeader).toBe(true);
  });

  // Owner directive: a contractor's own brand color (Settings → Branding,
  // S.brandColor) should carry into their client-facing proposal instead of every
  // account seeing generic navy — real per-account differentiation, not a re-skin.
  // Falls back to the original navy (#1a365d/#2a4a7f) when no brand color is set.
  test('proposal header + TOTAL use the contractor\'s brand color when set, navy by default', async () => {
    const r = await page.evaluate(async () => {
      const c = { id: 79110, name: 'Brand Color Client', addr: '1 Brand Color Rd' };
      clients = clients.filter(x => x.id !== 79110).concat([c]);
      bids = bids.filter(x => x.client_id !== 79110);
      const prevBrand = S.brandColor;
      S.brandColor = '#166534'; // distinct green, not the navy default
      openGenericEstimate(c, null, null, { mode: 'byo' });
      _geiIsFreeForm = true;
      _byoItems = [{ id: 1, section: 'Interior', label: 'Bedroom', price: 500, on: true }];
      _byoUpdateRail();
      let err = null;
      try { await sendGenericProposal(true); } catch (e) { err = e.message; }
      const ov = document.getElementById('_prop-preview-ov');
      const html = ov ? ov.innerHTML : '';
      S.brandColor = prevBrand;
      const res = {
        err,
        hasBrandGradient: html.includes('linear-gradient(135deg,rgb(22,101,52) 0%,rgb(64,143,94) 100%)'),
        hasBrandTotalBg: html.includes('background:rgb(22,101,52);color:#fff'),
        hasNavyLeftover: html.includes('#1a365d') || html.includes('#2a4a7f'),
      };
      return res;
    });
    expect(r.err).toBe(null);
    expect(r.hasBrandGradient, 'header gradient must use the brand color, not navy').toBe(true);
    expect(r.hasBrandTotalBg, 'TOTAL row must use the brand color, not navy').toBe(true);
    expect(r.hasNavyLeftover, 'no hardcoded navy hex may leak through once a brand color is set').toBe(false);
  });

  // Regression (owner-reported): a BYO item's notes printed in full TWICE in one
  // proposal — once under "Scope of work" (added so scope-chip descriptions never
  // get silently dropped when BYO has line items) and again in the pricing table's
  // description cell (from the same _byoItems → _geiLines sync), eating a lot of
  // extra proposal space with a repeated paragraph. Notes now suppress in the pricing
  // table for regular BYO lines (already fully shown above); RRP and T&M lines have
  // no scope-of-work duplicate, so their notes must still print in the pricing table.
  test('a BYO item\'s notes print once (Scope of work), not again in the pricing table', async () => {
    const r = await page.evaluate(async () => {
      const c = { id: 79105, name: 'Notes Dup Client', addr: '1 Notes Dup Rd' };
      clients = clients.filter(x => x.id !== 79105).concat([c]);
      bids = bids.filter(x => x.client_id !== 79105);
      openGenericEstimate(c, null, null, { mode: 'byo' });
      _geiIsFreeForm = true;
      const noteText = 'Sand surfaces smooth prior to two coats of premium latex paint';
      _byoItems = [{ id: 1, section: 'Interior', label: 'Bedroom', notes: noteText, price: 500, on: true }];
      _geiScopeChips = [];
      _geiScopeNoScope = false;
      let err = null;
      try { await sendGenericProposal(true); } catch (e) { err = e.message; }
      const ov = document.getElementById('_prop-preview-ov');
      const html = ov ? ov.innerHTML : '';
      const occurrences = html.split(noteText).length - 1;
      ov?.remove();
      return { err, hasOverlay: !!ov, occurrences };
    });
    expect(r.err).toBe(null);
    expect(r.hasOverlay).toBe(true);
    expect(r.occurrences, 'the note text must appear exactly once, not duplicated between Scope of work and the pricing table').toBe(1);
  });

  test('T&M material category notes still print in the pricing table (no scope-of-work duplicate to suppress against)', async () => {
    const r = await page.evaluate(async () => {
      const c = { id: 79106, name: 'TM Notes Client', addr: '1 TM Notes Rd' };
      clients = clients.filter(x => x.id !== 79106).concat([c]);
      bids = bids.filter(x => x.client_id !== 79106);
      openGenericEstimate(c, null, null, { mode: 'tm' });
      goGeiStep(2);
      _tmRatePerMan = 50; _tmEstHours = 8; _tmCrewCount = 1;
      const noteText = 'Sherwin Williams Duration, satin finish';
      _geiLines = [{ desc: 'Paint', qty: 1, rate: 500, total: 500, notes: noteText }];
      let err = null;
      try { await sendGenericProposal(true); } catch (e) { err = e.message; }
      const ov = document.getElementById('_prop-preview-ov');
      const html = ov ? ov.innerHTML : '';
      const found = html.includes(noteText);
      ov?.remove();
      return { err, hasOverlay: !!ov, found };
    });
    expect(r.err).toBe(null);
    expect(r.hasOverlay).toBe(true);
    expect(r.found, 'T&M material category notes must still print in the pricing table').toBe(true);
  });

  // Regression: T&M material category rows had no visible "Edit" affordance —
  // only a hover-only (opacity:0 until :hover) delete "×", invisible/undiscoverable
  // on touch devices, and inconsistent with BYO's always-visible Edit/✕ pair.
  // Both lists now render from the same _geiItemRowHtml helper (shared row shape),
  // so T&M rows carry the .byo-row family of classes, not a separate .tm-mat-row.
  test('T&M material category row has a visible Edit button, matching BYO\'s row treatment', async () => {
    const r = await page.evaluate(() => {
      const c = { id: 79102, name: 'TM Edit Btn Client', addr: '1 Edit Btn Rd' };
      clients = clients.filter(x => x.id !== 79102).concat([c]);
      bids = bids.filter(x => x.client_id !== 79102);
      openGenericEstimate(c, null, 'general');
      _geiIsTM = true; _geiIsFreeForm = false;
      _geiLines = [{ desc: 'Paint', qty: 1, rate: 200, total: 200, _tmLabor: false }];
      goGeiStep(2); // renders gei-tm-page via _tmShowPage → _tmRenderMatList
      const row = document.querySelector('#tm-mat-list .byo-row');
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

  // Regression (owner-reported): the preview overlay's body was flex:1, forcing
  // it to fill the full remaining viewport height no matter how short the card
  // is. Once T&C stopped being appended to the preview (owner directive
  // 2026-07-13, part 2), short proposals left a slab of flat gray dead space
  // below the card. The body must now hug its own content height instead.
  test('preview overlay body hugs the card height — no dead space slab below a short proposal', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    const r = await page.evaluate(async () => {
      const c = { id: 79120, name: 'Short Card Client', addr: '1 Short Rd' };
      clients = clients.filter(x => x.id !== 79120).concat([c]);
      bids = bids.filter(x => x.client_id !== 79120);
      openGenericEstimate(c, null, 'general');
      _geiIsFreeForm = true;
      _geiIsTM = false;
      _byoItems = [{ id: 1, section: 'Interior', label: 'Small repair', price: 200, on: true }];
      let err = null;
      try { await sendGenericProposal(true); } catch (e) { err = e.message; }
      const ov = document.getElementById('_prop-preview-ov');
      const body = ov ? ov.lastElementChild : null;
      const res = {
        err,
        hasOverlay: !!ov,
        // The card (body) must be meaningfully shorter than the viewport for a
        // 1-line proposal — if it still stretches to fill the screen, the bug
        // is back.
        bodyHeight: body ? body.getBoundingClientRect().height : null,
        viewportHeight: window.innerHeight,
      };
      ov?.remove();
      return res;
    });
    expect(r.err).toBe(null);
    expect(r.hasOverlay).toBe(true);
    expect(r.bodyHeight, 'a 1-line proposal card must not stretch to fill the full viewport height').toBeLessThan(r.viewportHeight * 0.7);
  });

  test('no console errors', async () => { await assertNoErrors(page); });
});
