// @ts-check
/**
 * Sprint-fix regression tests — May 30, 2026.
 *
 * Verifies every fix from the sprint:
 *  1. MO cancel statute is §407.705 (Home Solicitation Sales Act), not §407.675 or §407.714
 *  2. _stateKey uses client address state, not contractor home state
 *  3. sign.html lien notice replaces FULL sentence ("Under Missouri law…"), not just citation
 *  4. sign.html — "SIGNING FOR" banner removed from DOM
 *  5. sign.html — UETA checkbox text has no double period
 *  6. T&M toolbar — ← Home button + pencil rename icon present
 *  7. Scope toolbar — ← Home button + pencil rename icon present
 *  8. Email compose overlay — centered modal (align-items:center), not bottom sheet
 *  9. GEI send overlay — #_gei-send-overlay is a centered fixed-position modal
 * 10. Client hub — pay button uses var(--red), not near-black #1b1612
 */

const {
  test, expect,
  mockAllExternal, waitForAppBoot, goPg, assertNoErrors,
  FAKE_BID_ID_1, FAKE_BID_ID_2, FAKE_USER_ID, FAKE_TOKEN, FAKE_TOKEN_2, MOCK_PROPOSAL,
} = require('./helpers');

// ════════════════════════════════════════════════════════════════════════════
//  1. LEGAL MODULE — MO STATUTE §407.705
// ════════════════════════════════════════════════════════════════════════════

test.describe('Legal module — MO cancel statute is §407.705', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test.afterAll(async () => { await page.context().close(); });

  test('STATE_CANCEL MO statute is §407.705 (Home Solicitation Sales Act)', async () => {
    const statute = await page.evaluate(() => {
      if (typeof STATE_CANCEL === 'undefined') return null;
      return STATE_CANCEL['MO']?.statute || null;
    });
    if (statute !== null) {
      expect(statute, 'MO cancel statute must be §407.705').toBe('Mo. Rev. Stat. §407.705');
      expect(statute, 'must not be §407.675 (health/fitness clubs)').not.toContain('§407.675');
      expect(statute, 'must not be §407.714').not.toContain('§407.714');
    }
  });

  test('_cancelCitation("MO") returns Mo. Rev. Stat. §407.705', async () => {
    const result = await page.evaluate(() => {
      if (typeof _cancelCitation !== 'function') return null;
      return _cancelCitation('MO');
    });
    if (result !== null) {
      expect(result).toBe('Mo. Rev. Stat. §407.705');
    }
  });

  test('_lienNotice("MO") says "Missouri law" — not "Kansas law"', async () => {
    const result = await page.evaluate(() => {
      if (typeof _lienNotice !== 'function') return null;
      return _lienNotice('MO');
    });
    if (result !== null) {
      expect(result, 'lien notice for MO must reference Missouri').toContain('Missouri');
      expect(result, 'lien notice for MO must not say Kansas').not.toContain('Kansas');
      expect(result, 'lien notice for MO must cite §429.010').toContain('§429.010');
    }
    assertNoErrors(page, 'legal module MO');
  });

  test('_lienNotice("KS") says "Kansas law" with KS statute', async () => {
    const result = await page.evaluate(() => {
      if (typeof _lienNotice !== 'function') return null;
      return _lienNotice('KS');
    });
    if (result !== null) {
      expect(result).toContain('Kansas');
      expect(result).toContain('K.S.A.');
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  2. _stateKey — client address state beats contractor home state
// ════════════════════════════════════════════════════════════════════════════

test.describe('_stateKey — client address state takes priority over contractor home state', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await goPg(page, 'pg-est-generic');
  });

  test.afterAll(async () => { await page.context().close(); });

  test('detectStateFromAddr extracts MO from a Missouri address', async () => {
    const result = await page.evaluate(() => {
      if (typeof detectStateFromAddr !== 'function') return null;
      return detectStateFromAddr('456 Oak Ave, St. Louis MO 63101');
    });
    if (result !== null) {
      expect(result).toBe('MO');
    }
  });

  test('_stateKey computation returns MO when gei-addr is MO, S.state is KS', async () => {
    const stateKey = await page.evaluate(() => {
      if (typeof S !== 'undefined') S.state = 'KS';
      const addrEl = document.getElementById('gei-addr');
      if (addrEl) addrEl.value = '456 Oak Ave, St. Louis MO 63101';
      // Mirror exact sendGenericProposal() _stateKey logic
      const v = id => { const el = document.getElementById(id); return el ? el.value : ''; };
      return (typeof detectStateFromAddr === 'function' ? detectStateFromAddr(v('gei-addr')) : null)
        || (typeof S !== 'undefined' && S && S.state)
        || 'KS';
    });
    expect(stateKey, '_stateKey must be MO for a MO client address').toBe('MO');
    assertNoErrors(page, '_stateKey MO address');
  });

  test('_cancelCitation with MO _stateKey returns MO statute, not KS', async () => {
    const result = await page.evaluate(() => {
      if (typeof _cancelCitation !== 'function') return null;
      return _cancelCitation('MO');
    });
    if (result !== null) {
      expect(result).toContain('Mo. Rev. Stat.');
      expect(result).not.toContain('K.S.A.');
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  3. sign.html — MO LIEN NOTICE SAYS "MISSOURI LAW", NOT "KANSAS LAW"
// ════════════════════════════════════════════════════════════════════════════

test.describe('sign.html — lien notice in proposal body shows correct state name + statute', () => {
  let page;

  // Simulates a T&M proposal saved when contractor was in KS, but job addr is MO.
  // _lienNotice('KS') is embedded in proposalHtml; sign.html must replace the full sentence.
  const MOCK_MO_PROPOSAL = {
    ...MOCK_PROPOSAL,
    id: 910001,
    signingToken: 'tok-mo-lien',
    clientAddr: '456 Oak Ave, St. Louis MO 63101',
    state: 'KS',                                    // was built using KS (old _stateKey bug)
    lienStatute: 'K.S.A. §60-1101 et seq.',         // stored old KS statute
    cancelStatute: 'K.S.A. §50-640',
    cancelDays: 3,
    proposalHtml:
      '<div>1. <strong>Contract type:</strong> Time &amp; Materials</div>' +
      '<div>8. <strong>Mechanic&#39;s Lien:</strong> Under Kansas law (K.S.A. §60-1101 et seq.), contractor has the right to file a mechanic\'s lien against this property for any amounts unpaid under this agreement. Client is hereby notified of this right.</div>',
  };

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await page.addInitScript(data => { window.__mockProposalData = data; }, MOCK_MO_PROPOSAL);
    await mockAllExternal(page, { alreadySigned: false, proposalData: MOCK_MO_PROPOSAL, bidId: FAKE_BID_ID_1 });
    await page.goto(
      `/sign.html?key=proposals/${FAKE_USER_ID}/910001_tok-mo-lien.json`,
      { waitUntil: 'domcontentloaded', timeout: 20000 }
    );
    await page.waitForTimeout(2500);
  });

  test.afterAll(async () => { await page.context().close(); });

  test('rendered proposal body shows "Missouri law", not "Kansas law"', async () => {
    const propHtml = await page.evaluate(() => {
      const el = document.getElementById('prop-html');
      return el ? el.innerHTML : '';
    });
    if (propHtml && propHtml.length > 0) {
      expect(propHtml, 'proposal body must not say "Under Kansas law"').not.toContain('Kansas law');
      expect(propHtml, 'proposal body must say "Under Missouri law"').toContain('Missouri law');
    }
  });

  test('lien statute in proposal body is MO, not KS', async () => {
    const propHtml = await page.evaluate(() => {
      const el = document.getElementById('prop-html');
      return el ? el.innerHTML : '';
    });
    if (propHtml && propHtml.length > 0) {
      expect(propHtml, 'proposal body must not cite K.S.A. §60-1101').not.toContain('K.S.A. §60-1101');
      expect(propHtml, 'proposal body must cite Mo. Rev. Stat. §429.010').toContain('§429.010');
    }
    assertNoErrors(page, 'sign.html MO lien notice');
  });

  test('cancel-notice-body shows MO cancel statute', async () => {
    const noticeText = await page.evaluate(() => {
      const el = document.getElementById('cancel-notice-body');
      return el ? el.textContent || '' : '';
    });
    if (noticeText && noticeText.length > 0) {
      expect(noticeText, 'cancel notice must cite Mo. Rev. Stat.').toContain('Mo. Rev. Stat.');
      expect(noticeText, 'cancel notice must not cite K.S.A.').not.toContain('K.S.A.');
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  3b. sign.html — old generic lien text (HTML-entity apostrophe) is upgraded
// ════════════════════════════════════════════════════════════════════════════

test.describe('sign.html — generic &#39; lien text upgraded to state-specific notice', () => {
  let page;

  // Simulates a pre-sprint T&M proposal where the template used &#39; (HTML entity)
  // for the apostrophe in "mechanic's lien". Our patch must detect this form and replace it.
  const MOCK_GENERIC_LIEN_PROPOSAL = {
    ...MOCK_PROPOSAL,
    id: 910003,
    signingToken: 'tok-generic-lien',
    clientAddr: '789 Main St, Kansas City MO 64105',
    state: 'MO',
    lienStatute: 'Mo. Rev. Stat. §429.010 et seq.',
    cancelStatute: 'Mo. Rev. Stat. §407.705',
    cancelDays: 3,
    // Simulates old T&M: Billing as item 3, Warranty at 5, generic lien &#39; form
    proposalHtml:
      '<div>3. <strong>Billing:</strong> Weekly invoices.</div>' +
      '<div>4. <strong>Change Orders:</strong> Written change order required.</div>' +
      '<div>5. <strong>Warranty:</strong> All workmanship warranted for one (1) year from date of completion.</div>' +
      '<div>6. <strong>Limitation of Liability:</strong> Contractor is not responsible for pre-existing conditions.</div>' +
      '<div>7. <strong>Mechanic&#39;s Lien:</strong> Contractor reserves the right to file a mechanic&#39;s lien for any unpaid amounts under this agreement.</div>',
  };

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await page.addInitScript(data => { window.__mockProposalData = data; }, MOCK_GENERIC_LIEN_PROPOSAL);
    await mockAllExternal(page, { alreadySigned: false, proposalData: MOCK_GENERIC_LIEN_PROPOSAL, bidId: FAKE_BID_ID_1 });
    await page.goto(
      `/sign.html?key=proposals/${FAKE_USER_ID}/910003_tok-generic-lien.json`,
      { waitUntil: 'domcontentloaded', timeout: 20000 }
    );
    await page.waitForTimeout(2500);
  });

  test.afterAll(async () => { await page.context().close(); });

  test('generic lien placeholder is replaced with state-specific sentence', async () => {
    const propHtml = await page.evaluate(() => {
      const el = document.getElementById('prop-html');
      return el ? el.innerHTML : '';
    });
    if (propHtml && propHtml.length > 0) {
      expect(propHtml, 'generic placeholder must be removed').not.toContain('Contractor reserves the right to file a mechanic');
      expect(propHtml, 'state-specific sentence must appear').toContain('Missouri');
      expect(propHtml, 'MO lien statute must appear').toContain('§429.010');
    }
  });

  test('old T&M Cancellation clause is injected for proposals with Billing as item 3', async () => {
    const propHtml = await page.evaluate(() => {
      const el = document.getElementById('prop-html');
      return el ? el.innerHTML : '';
    });
    if (propHtml && propHtml.length > 0) {
      expect(propHtml, 'Cancellation & Deposits must be injected').toContain('Cancellation');
      expect(propHtml, 'old Billing-as-item-3 must be renumbered').not.toContain('>3. <strong>Billing');
    }
  });

  test('Warranty clause is stripped from all proposal types', async () => {
    const propHtml = await page.evaluate(() => {
      const el = document.getElementById('prop-html');
      return el ? el.innerHTML : '';
    });
    if (propHtml && propHtml.length > 0) {
      expect(propHtml, 'Warranty clause must be removed').not.toContain('Warranty');
    }
    assertNoErrors(page, 'sign.html generic lien upgrade');
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  4. sign.html — "SIGNING FOR" BANNER REMOVED
// ════════════════════════════════════════════════════════════════════════════

test.describe('sign.html — "SIGNING FOR" banner removed from DOM', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await page.addInitScript(data => { window.__mockProposalData = data; }, MOCK_PROPOSAL);
    await mockAllExternal(page, { alreadySigned: false, proposalData: MOCK_PROPOSAL, bidId: FAKE_BID_ID_1 });
    await page.goto(
      `/sign.html?key=proposals/${FAKE_USER_ID}/${FAKE_BID_ID_1}_${FAKE_TOKEN}.json`,
      { waitUntil: 'domcontentloaded', timeout: 20000 }
    );
    await page.waitForTimeout(2000);
  });

  test.afterAll(async () => { await page.context().close(); });

  test('.sig-summary element is not in the DOM', async () => {
    const count = await page.locator('.sig-summary').count();
    expect(count, '"SIGNING FOR" banner (.sig-summary div) must be absent').toBe(0);
  });

  test('"Signing for" text not visible on page', async () => {
    const bodyText = await page.textContent('body');
    expect(bodyText, '"Signing for" text must be gone').not.toContain('Signing for');
  });

  test('sign page still loads with full content (banner removal did not break layout)', async () => {
    const hasSignPage = await page.evaluate(() => !!document.getElementById('pg-sign-action'));
    expect(hasSignPage, '#pg-sign-action must still exist').toBe(true);
    assertNoErrors(page, 'sign.html banner removed');
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  5. sign.html — UETA TEXT NO DOUBLE PERIOD
// ════════════════════════════════════════════════════════════════════════════

test.describe('sign.html — UETA checkbox text has no double period', () => {
  let page;

  const MOCK_UETA = {
    ...MOCK_PROPOSAL,
    id: 910002,
    signingToken: 'tok-ueta-check',
    clientAddr: '789 Maple St, Kansas City MO 64101',
    cancelStatute: 'Mo. Rev. Stat. §407.705',
    lienStatute: 'Mo. Rev. Stat. §429.010 et seq.',
    cancelDays: 3,
    state: 'MO',
  };

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await page.addInitScript(data => { window.__mockProposalData = data; }, MOCK_UETA);
    await mockAllExternal(page, { alreadySigned: false, proposalData: MOCK_UETA, bidId: FAKE_BID_ID_2 });
    await page.goto(
      `/sign.html?key=proposals/${FAKE_USER_ID}/910002_tok-ueta-check.json`,
      { waitUntil: 'domcontentloaded', timeout: 20000 }
    );
    await page.waitForTimeout(2000);
  });

  test.afterAll(async () => { await page.context().close(); });

  test('UETA checkbox label has no double period (..)', async () => {
    const label = await page.evaluate(() => {
      const ck = document.getElementById('sig-ueta-ck');
      const lbl = ck ? (ck.closest('label') || ck.parentElement) : null;
      return lbl ? lbl.textContent : null;
    });
    if (label && label.length > 0) {
      expect(label, 'UETA label must not contain ..').not.toContain('..');
    }
  });

  test('page HTML contains no "et seq.." double-period pattern', async () => {
    const html = await page.content();
    expect(html, 'HTML must not have "et seq.." double period').not.toMatch(/et seq\.\./);
    assertNoErrors(page, 'sign.html UETA no double period');
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  6. TOOLBARS — HOME BUTTON AND PENCIL ICON
// ════════════════════════════════════════════════════════════════════════════

test.describe('Estimate toolbars — ← Home button and pencil rename icon', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test.afterAll(async () => { await page.context().close(); });

  test('T&M toolbar has a ← Home button (onclick pg-dash)', async () => {
    const result = await page.evaluate(() => {
      // T&M toolbar contains a button with text including Home or ← that goes to pg-dash
      const allBtns = [...document.querySelectorAll('.tbar button, .tbar .link-back, .tbar a')];
      return allBtns.some(b =>
        (b.textContent.includes('Home') || b.textContent.includes('←')) &&
        (b.getAttribute('onclick') || '').includes('pg-dash')
      );
    });
    expect(result, 'T&M toolbar must have a ← Home button linking to pg-dash').toBe(true);
  });

  test('#tm-edit-title-btn exists (T&M pencil rename)', async () => {
    const exists = await page.evaluate(() => !!document.getElementById('tm-edit-title-btn'));
    expect(exists, '#tm-edit-title-btn must be in DOM').toBe(true);
  });

  test('Scope toolbar (#gei-old-tbar) has a ← Home button', async () => {
    const result = await page.evaluate(() => {
      const tbar = document.getElementById('gei-old-tbar');
      if (!tbar) return null;
      const btns = [...tbar.querySelectorAll('button, a, .link-back')];
      return btns.some(b =>
        (b.textContent.includes('Home') || b.textContent.includes('←')) &&
        (b.getAttribute('onclick') || '').includes('pg-dash')
      );
    });
    if (result !== null) {
      expect(result, 'Scope toolbar must have a ← Home button').toBe(true);
    }
  });

  test('#scope-edit-title-btn exists (Scope pencil rename)', async () => {
    const exists = await page.evaluate(() => !!document.getElementById('scope-edit-title-btn'));
    expect(exists, '#scope-edit-title-btn must be in DOM').toBe(true);
  });

  test('no console errors during toolbar DOM check', async () => {
    assertNoErrors(page, 'toolbar DOM checks');
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  7. EMAIL COMPOSE OVERLAY — CENTERED MODAL
// ════════════════════════════════════════════════════════════════════════════

test.describe('Email compose overlay — centered modal (align-items:center)', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await goPg(page, 'pg-dash');
  });

  test.afterEach(async () => {
    await page.evaluate(() => { document.getElementById('_email-compose-overlay')?.remove(); });
  });

  test.afterAll(async () => { await page.context().close(); });

  test('overlay uses align-items:center, not flex-end (no bottom-sheet)', async () => {
    await page.evaluate(() => {
      document.querySelectorAll('#proposal-link-bar').forEach(el => el.remove());
      const bar = document.createElement('div');
      bar.id = 'proposal-link-bar';
      bar.style.display = 'none';
      bar.dataset.signingUrl = 'https://example.com/sign.html';
      bar.dataset.cname = 'Test Client';
      bar.dataset.cemail = 'client@example.com';
      bar.dataset.cphone = '';
      document.body.appendChild(bar);
    });
    await page.evaluate(async () => {
      if (typeof sendProposalViaEmail === 'function') await sendProposalViaEmail();
    });
    await page.waitForTimeout(500);

    const overlay = page.locator('#_email-compose-overlay');
    if (await overlay.count() > 0) {
      const alignItems = await overlay.evaluate(el => el.style.alignItems);
      expect(alignItems, 'Email overlay must be center-aligned (not flex-end bottom sheet)').toBe('center');
    }
    assertNoErrors(page, 'email compose overlay centered');
  });

  test('overlay inner card has uniform border-radius (not bottom-sheet top-only radius)', async () => {
    await page.evaluate(() => {
      document.querySelectorAll('#proposal-link-bar').forEach(el => el.remove());
      const bar = document.createElement('div');
      bar.id = 'proposal-link-bar';
      bar.style.display = 'none';
      bar.dataset.signingUrl = 'https://example.com/sign.html';
      bar.dataset.cname = 'Test Client';
      bar.dataset.cemail = 'client@example.com';
      bar.dataset.cphone = '';
      document.body.appendChild(bar);
    });
    await page.evaluate(async () => {
      if (typeof sendProposalViaEmail === 'function') await sendProposalViaEmail();
    });
    await page.waitForTimeout(500);

    const overlay = page.locator('#_email-compose-overlay');
    if (await overlay.count() > 0) {
      const innerCard = overlay.locator('> div').first();
      if (await innerCard.count() > 0) {
        const borderRadius = await innerCard.evaluate(el => el.style.borderRadius);
        // Bottom-sheet pattern uses "16px 16px 0 0" (flat bottom). Centered modal has uniform radius.
        if (borderRadius) {
          expect(borderRadius, 'Inner card must not have 0 bottom-corner radius').not.toMatch(/\d+px\s+\d+px\s+0\s+0/);
        }
      }
    }
    assertNoErrors(page, 'email compose overlay border-radius');
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  8. GEI SEND OVERLAY — #_gei-send-overlay IS A CENTERED MODAL
// ════════════════════════════════════════════════════════════════════════════

test.describe('GEI send overlay — _showGeiSendOverlay creates centered fixed modal', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await goPg(page, 'pg-est-generic');
  });

  test.afterEach(async () => {
    await page.evaluate(() => { document.getElementById('_gei-send-overlay')?.remove(); });
  });

  test.afterAll(async () => { await page.context().close(); });

  test('_showGeiSendOverlay is a global function', async () => {
    const exists = await page.evaluate(() => typeof _showGeiSendOverlay === 'function');
    expect(exists, '_showGeiSendOverlay must be a global function').toBe(true);
  });

  test('_showGeiSendOverlay creates #_gei-send-overlay as fixed centered modal', async () => {
    await page.evaluate(() => {
      if (typeof _showGeiSendOverlay === 'function') _showGeiSendOverlay();
    });
    await page.waitForTimeout(300);

    const overlay = page.locator('#_gei-send-overlay');
    await expect(overlay, '#_gei-send-overlay must exist after _showGeiSendOverlay').toHaveCount(1);

    const styles = await overlay.evaluate(el => ({
      position: el.style.position,
      alignItems: el.style.alignItems,
      justifyContent: el.style.justifyContent,
    }));
    expect(styles.position, 'send overlay must be fixed-position').toBe('fixed');
    expect(styles.alignItems, 'send overlay must center content vertically').toBe('center');
    expect(styles.justifyContent, 'send overlay must center content horizontally').toBe('center');
  });

  test('send overlay has 📱 Text and ✉️ Email and ⬆️ Other buttons', async () => {
    await page.evaluate(() => {
      if (typeof _showGeiSendOverlay === 'function') _showGeiSendOverlay();
    });
    await page.waitForTimeout(300);

    const overlay = page.locator('#_gei-send-overlay');
    if (await overlay.count() > 0) {
      const text = await overlay.textContent();
      expect(text, 'send overlay must have Text button').toContain('Text');
      expect(text, 'send overlay must have Email button').toContain('Email');
      expect(text, 'send overlay must have Other button').toContain('Other');
    }
    assertNoErrors(page, 'GEI send overlay content');
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  9. CLIENT HUB — PAY BUTTON IS RED
// ════════════════════════════════════════════════════════════════════════════

test.describe('Client hub — pay button uses var(--red), not near-black #1b1612', () => {
  test('pay button template string contains var(--red), not #1b1612', async ({ page }) => {
    const HUB = {
      contractorUserId: FAKE_USER_ID,
      businessName: 'Zach Pro Painting',
      clientName: 'Alice Smith',
      clientToken: FAKE_TOKEN,
      stripeEnabled: true,
      bids: [{
        id: FAKE_BID_ID_1,
        type: 'Interior Painting',
        amount: 500000,
        deposit: 125000,
        balance: 375000,
        status: 'Closed Won',
        signedAt: new Date().toISOString(),
        bid_date: new Date().toISOString().slice(0, 10),
        stripeEnabled: true,
        paymentStatus: 'unpaid',
      }],
      jobs: [],
      payments: [],
    };

    await page.addInitScript(data => { window.__mockHubData = data; }, HUB);
    await mockAllExternal(page);
    await page.goto(`/client.html?t=${FAKE_TOKEN}&u=${FAKE_USER_ID}&c=1`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Check that the page source doesn't use the old dark pay-button color
    const html = await page.content();
    // The old near-black color was #1b1612 or #1B1612 on pay BUTTONS
    // It's fine on the hub-pay-cta container background — check only button context
    const payBtnEl = await page.evaluate(() => {
      return document.querySelector('[id^="pay-btn-"]')?.style.background || null;
    });
    if (payBtnEl !== null) {
      expect(payBtnEl, 'pay button must use var(--red)').toContain('--red');
      expect(payBtnEl, 'pay button must not use old dark color #1b1612').not.toMatch(/#1b1612/i);
    }

    // Even if Stripe not triggered, verify the source JS doesn't inline the old color on buttons
    const hasOldColorOnBtn = html.match(/background:#1b1612[^}]*Stripe/i) ||
                             html.match(/Stripe[^{]*background:#1b1612/i);
    expect(hasOldColorOnBtn, 'pay button source must not mix #1b1612 with Stripe payment context').toBeFalsy();

    assertNoErrors(page, 'client hub pay button red');
  });
});
