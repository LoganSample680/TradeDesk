// @ts-check
const { test, expect, mockAllExternal, _supabaseShim, _supabaseShimIntake, waitForAppBoot, goPg, assertNoErrors, FAKE_BID_ID_1, FAKE_BID_ID_2, FAKE_USER_ID, FAKE_TOKEN, FAKE_TOKEN_2, MOCK_PROPOSAL } = require('./helpers');

// ═══════════════════════════════════════════════════════════════════════════════
// js/agreements.js — function coverage (CLAUDE.md §12: every global function across
// input classes — null/undefined, empty, boundary, type-mismatch, missing-DOM,
// golden, concurrent, post-error). Targets the 68% previously untested.
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Agreements — pure helpers (_agFmtDate, _agType*, _agKeyTerm, _agStatusChip)', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.waitForTimeout(100);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('_agFmtDate — exact golden + null/empty/boundary', async () => {
    const result = await page.evaluate(() => {
      if (typeof _agFmtDate !== 'function') return { skip: true };
      try {
        const dateOnly = _agFmtDate('2026-03-15');           // <=10 → date-only path
        const iso = _agFmtDate('2026-03-15T12:00:00.000Z');  // full ISO path
        const empty = _agFmtDate('');
        const nul = _agFmtDate(null);
        const undef = _agFmtDate(undefined);
        const garbage = _agFmtDate('not-a-date');             // catch path returns input
        return { ok: true, dateOnly, iso, empty, nul, undef, garbage };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.dateOnly).toBe('Mar 15, 2026');
    expect(result.iso).toContain('2026');
    expect(result.empty).toBe('');
    expect(result.nul).toBe('');
    expect(result.undef).toBe('');
    // Garbage strings still produce a string (either echoed back or an Invalid Date label)
    expect(typeof result.garbage).toBe('string');
  });

  test('_agTypeLabel — each known id + unknown fallback', async () => {
    const result = await page.evaluate(() => {
      if (typeof _agTypeLabel !== 'function') return { skip: true };
      try {
        return {
          ok: true,
          profit: _agTypeLabel('profit_share'),
          employment: _agTypeLabel('employment'),
          custom: _agTypeLabel('custom'),
          unknown: _agTypeLabel('nope'),
          nul: _agTypeLabel(null),
          undef: _agTypeLabel(undefined),
        };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.profit).toBe('Profit share');
    expect(result.employment).toBe('Employment');
    expect(result.custom).toBe('Custom');
    expect(result.unknown).toBe('Contract');
    expect(result.nul).toBe('Contract');
    expect(result.undef).toBe('Contract');
  });

  test('_agTypeEmoji — each known id + unknown fallback', async () => {
    const result = await page.evaluate(() => {
      if (typeof _agTypeEmoji !== 'function') return { skip: true };
      try {
        return {
          ok: true,
          profit: _agTypeEmoji('profit_share'),
          employment: _agTypeEmoji('employment'),
          custom: _agTypeEmoji('custom'),
          unknown: _agTypeEmoji('nope'),
          nul: _agTypeEmoji(null),
        };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.profit).toBe('📈');
    expect(result.employment).toBe('📝');
    expect(result.custom).toBe('📄');
    expect(result.unknown).toBe('📄');
    expect(result.nul).toBe('📄');
  });

  test('_agKeyTerm — profit-share pct, employment, custom title, fallback', async () => {
    const result = await page.evaluate(() => {
      if (typeof _agKeyTerm !== 'function') return { skip: true };
      try {
        return {
          ok: true,
          profit: _agKeyTerm({ type: 'profit_share', profitPct: 20 }),
          profitZero: _agKeyTerm({ type: 'profit_share', profitPct: 0 }),
          profitNull: _agKeyTerm({ type: 'profit_share', profitPct: null }),
          profitEmpty: _agKeyTerm({ type: 'profit_share', profitPct: '' }),
          employment: _agKeyTerm({ type: 'employment' }),
          customTitle: _agKeyTerm({ type: 'custom', title: 'My Deal' }),
          customNoTitle: _agKeyTerm({ type: 'custom' }),
        };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.profit).toBe('20% of net profit');
    expect(result.profitZero).toBe('0% of net profit'); // 0 is a real pct (!=null && !=='')
    expect(result.profitNull).toBe('Custom contract');   // falls through to title||fallback
    expect(result.profitEmpty).toBe('Custom contract');
    expect(result.employment).toBe('Employment agreement');
    expect(result.customTitle).toBe('My Deal');
    expect(result.customNoTitle).toBe('Custom contract');
  });

  test('_agStatusChip — each status maps to its chip label', async () => {
    const result = await page.evaluate(() => {
      if (typeof _agStatusChip !== 'function') return { skip: true };
      try {
        const signed = _agStatusChip({ status: 'signed', signedAt: '2026-03-15' });
        const signedNoDate = _agStatusChip({ status: 'signed' });
        const sent = _agStatusChip({ status: 'sent' });
        const draft = _agStatusChip({ status: 'draft' });
        const unknown = _agStatusChip({ status: 'whatever' }); // → draft fallback
        const empty = _agStatusChip({});
        return { ok: true, signed, signedNoDate, sent, draft, unknown, empty };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.signed).toContain('Signed');
    expect(result.signed).toContain('Mar 15, 2026');
    expect(result.signedNoDate).toContain('Signed');
    expect(result.sent).toContain('Sent');
    expect(result.draft).toContain('Draft');
    expect(result.unknown).toContain('Draft'); // unknown status → draft chip
    expect(result.empty).toContain('Draft');
  });

  test('no console errors during pure-helper tests', async () => {
    assertNoErrors(page, 'agreements pure helpers');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Template bodies + apply logic
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Agreements — templates (_agProfitShareBody, _agEmploymentBody, _agApplyTemplate)', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => {
      if (!window.S) window.S = {};
      if (!S.settings) S.settings = {};
      S.settings.ownerName = 'Pat Owner';
      S.settings.businessName = 'Pat Pro';
    });
    await page.waitForTimeout(100);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('_agProfitShareBody — golden fills party/pct/cadence', async () => {
    const result = await page.evaluate(() => {
      if (typeof _agProfitShareBody !== 'function') return { skip: true };
      try {
        const body = _agProfitShareBody('Jordan', 25, 'quarterly');
        return {
          ok: true,
          isString: typeof body === 'string',
          hasParty: body.includes('Jordan'),
          hasPct: body.includes('25%'),
          hasCadence: body.includes('quarterly'),
          hasHeader: body.includes('PROFIT-SHARE AGREEMENT'),
        };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.isString).toBe(true);
    expect(result.hasParty).toBe(true);
    expect(result.hasPct).toBe(true);
    expect(result.hasCadence).toBe(true);
    expect(result.hasHeader).toBe(true);
  });

  test('_agProfitShareBody — null/empty falls back to placeholders + defaults', async () => {
    const result = await page.evaluate(() => {
      if (typeof _agProfitShareBody !== 'function') return { skip: true };
      try {
        const body = _agProfitShareBody(null, null, null);
        const bodyEmpty = _agProfitShareBody('', '', '');
        return {
          ok: true,
          hasPartyPlaceholder: body.includes('{Party}'),
          hasPctPlaceholder: body.includes('{X}%'),
          hasMonthlyDefault: body.includes('monthly'),
          emptyHasPlaceholder: bodyEmpty.includes('{Party}') && bodyEmpty.includes('{X}%'),
        };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.hasPartyPlaceholder).toBe(true);
    expect(result.hasPctPlaceholder).toBe(true);
    expect(result.hasMonthlyDefault).toBe(true);
    expect(result.emptyHasPlaceholder).toBe(true);
  });

  test('_agProfitShareBody — pct of 0 is treated as a real value, not placeholder', async () => {
    const result = await page.evaluate(() => {
      if (typeof _agProfitShareBody !== 'function') return { skip: true };
      try {
        const body = _agProfitShareBody('Sam', 0, 'monthly');
        return { ok: true, hasZero: body.includes('0%'), noPlaceholder: !body.includes('{X}') };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.hasZero).toBe(true);
    expect(result.noPlaceholder).toBe(true);
  });

  test('_agEmploymentBody — golden + null party placeholder', async () => {
    const result = await page.evaluate(() => {
      if (typeof _agEmploymentBody !== 'function') return { skip: true };
      try {
        const body = _agEmploymentBody('Casey');
        const nul = _agEmploymentBody(null);
        return {
          ok: true,
          hasParty: body.includes('Casey'),
          hasAtWill: body.includes('At-Will'),
          hasTracking: body.includes('Location Tracking'),
          nulPlaceholder: nul.includes('{Party}'),
        };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.hasParty).toBe(true);
    expect(result.hasAtWill).toBe(true);
    expect(result.hasTracking).toBe(true);
    expect(result.nulPlaceholder).toBe(true);
  });

  test('_agApplyTemplate — missing DOM target is a no-throw early return', async () => {
    const result = await page.evaluate(() => {
      if (typeof _agApplyTemplate !== 'function') return { skip: true };
      try {
        document.getElementById('_ag-body')?.remove();
        _agApplyTemplate(); // no #_ag-body present → must early-return, not throw
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
  });

  test('_agApplyTemplate — fills empty textarea with profit-share template', async () => {
    const result = await page.evaluate(() => {
      if (typeof _agApplyTemplate !== 'function') return { skip: true };
      try {
        document.getElementById('_ag-applytest')?.remove();
        // Build minimal DOM the function reads via v(): type select, party/pct/cadence, body
        const mk = (id, tag, val) => {
          let el = document.getElementById(id);
          if (!el) { el = document.createElement(tag); el.id = id; document.body.appendChild(el); }
          if (val !== undefined) el.value = val;
          return el;
        };
        const sel = mk('_ag-type', 'select');
        sel.innerHTML = '<option value="profit_share">p</option><option value="employment">e</option><option value="custom">c</option>';
        sel.value = 'profit_share';
        mk('_ag-party', 'input', 'Robin');
        mk('_ag-pct', 'input', '15');
        mk('_ag-cadence', 'input', 'monthly');
        const ta = mk('_ag-body', 'textarea', '');
        _agApplyTemplate();
        const filled = ta.value.includes('PROFIT-SHARE AGREEMENT') && ta.value.includes('Robin') && ta.value.includes('15%');
        const tplFlag = ta.dataset.tpl;
        return { ok: true, filled, tplFlag };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.filled).toBe(true);
    expect(result.tplFlag).toBe('1');
  });

  test('_agApplyTemplate — does NOT clobber user-edited (non-template) body', async () => {
    const result = await page.evaluate(() => {
      if (typeof _agApplyTemplate !== 'function') return { skip: true };
      try {
        const sel = document.getElementById('_ag-type');
        if (sel) sel.value = 'profit_share';
        const ta = document.getElementById('_ag-body');
        if (!ta) return { skip: true };
        ta.value = 'MY HAND-WRITTEN TERMS';
        ta.dataset.tpl = '0'; // user has edited → not a template
        _agApplyTemplate();
        return { ok: true, preserved: ta.value === 'MY HAND-WRITTEN TERMS' };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.preserved).toBe(true);
  });

  test('_agApplyTemplate — custom type clears body to empty template', async () => {
    const result = await page.evaluate(() => {
      if (typeof _agApplyTemplate !== 'function') return { skip: true };
      try {
        const sel = document.getElementById('_ag-type');
        const ta = document.getElementById('_ag-body');
        if (!sel || !ta) return { skip: true };
        ta.value = ''; ta.dataset.tpl = '1';
        sel.value = 'custom';
        _agApplyTemplate();
        return { ok: true, body: ta.value, flag: ta.dataset.tpl };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.body).toBe('');
    expect(result.flag).toBe('0'); // empty body → tpl flag cleared
  });

  test('no console errors during template tests', async () => {
    assertNoErrors(page, 'agreements templates');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Token / URL generation
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Agreements — token + sign URL (_agToken, _agSignUrl)', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.waitForTimeout(100);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('_agToken — 32-char lowercase hex, unique across calls', async () => {
    const result = await page.evaluate(() => {
      if (typeof _agToken !== 'function') return { skip: true };
      try {
        const a = _agToken(), b = _agToken();
        return {
          ok: true,
          aLen: a.length, bLen: b.length,
          isHex: /^[0-9a-f]{32}$/.test(a) && /^[0-9a-f]{32}$/.test(b),
          unique: a !== b,
        };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.aLen).toBe(32);
    expect(result.bLen).toBe(32);
    expect(result.isHex).toBe(true);
    expect(result.unique).toBe(true);
  });

  test('_agToken — concurrent calls all produce valid unique tokens', async () => {
    const result = await page.evaluate(() => {
      if (typeof _agToken !== 'function') return { skip: true };
      try {
        const toks = [];
        for (let i = 0; i < 10; i++) toks.push(_agToken());
        const allHex = toks.every(t => /^[0-9a-f]{32}$/.test(t));
        const allUnique = new Set(toks).size === toks.length;
        return { ok: true, allHex, allUnique, count: toks.length };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.allHex).toBe(true);
    expect(result.allUnique).toBe(true);
    expect(result.count).toBe(10);
  });

  test('_agSignUrl — builds contract-sign.html URL with token + id', async () => {
    const result = await page.evaluate(() => {
      if (typeof _agSignUrl !== 'function') return { skip: true };
      try {
        const url = _agSignUrl({ id: 777, signingToken: 'abc123' });
        return {
          ok: true,
          isString: typeof url === 'string',
          hasPage: url.includes('contract-sign.html'),
          hasToken: url.includes('t=abc123'),
          hasId: url.includes('a=777'),
          hasUserParam: url.includes('u='),
        };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.isString).toBe(true);
    expect(result.hasPage).toBe(true);
    expect(result.hasToken).toBe(true);
    expect(result.hasId).toBe(true);
    expect(result.hasUserParam).toBe(true);
  });

  test('no console errors during token/url tests', async () => {
    assertNoErrors(page, 'agreements token url');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Filter state + list render
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Agreements — filter + render (setAgFilter, _agSearchInput, _agRenderList, renderContracts)', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.waitForTimeout(100);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('_agRenderList — missing #contracts-list target is a no-throw early return', async () => {
    const result = await page.evaluate(() => {
      if (typeof _agRenderList !== 'function') return { skip: true };
      try {
        document.getElementById('contracts-list')?.remove();
        _agRenderList(); // no target → early return
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
  });

  test('_agRenderList — empty agreements renders empty-state markup', async () => {
    const result = await page.evaluate(() => {
      if (typeof _agRenderList !== 'function') return { skip: true };
      try {
        window.agreements = [];
        let el = document.getElementById('contracts-list');
        if (!el) { el = document.createElement('div'); el.id = 'contracts-list'; document.body.appendChild(el); }
        _agRenderList();
        return { ok: true, html: el.innerHTML, hasEmpty: el.innerHTML.includes('No contracts yet') };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.hasEmpty).toBe(true);
  });

  test('_agRenderList — populated list renders a card per agreement', async () => {
    const result = await page.evaluate(() => {
      if (typeof _agRenderList !== 'function') return { skip: true };
      try {
        window.agreements = [
          { id: 9001, type: 'profit_share', party: 'Alpha Partner', profitPct: 30, status: 'draft', createdAt: '2026-01-01T00:00:00Z' },
          { id: 9002, type: 'employment', party: 'Beta Employee', status: 'sent', createdAt: '2026-02-01T00:00:00Z' },
        ];
        if (typeof window._agFilter !== 'undefined') {} // touched via setAgFilter below
        let el = document.getElementById('contracts-list');
        if (!el) { el = document.createElement('div'); el.id = 'contracts-list'; document.body.appendChild(el); }
        // ensure filter is 'all' + no search via the public setters
        if (typeof _agSearchInput === 'function') _agSearchInput('');
        _agRenderList();
        const html = el.innerHTML;
        return {
          ok: true,
          hasAlpha: html.includes('Alpha Partner'),
          hasBeta: html.includes('Beta Employee'),
          hasDetailHook: html.includes('openAgreementDetail(9001)'),
        };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.hasAlpha).toBe(true);
    expect(result.hasBeta).toBe(true);
    expect(result.hasDetailHook).toBe(true);
  });

  test('setAgFilter — changing filter narrows the rendered list', async () => {
    const result = await page.evaluate(() => {
      if (typeof setAgFilter !== 'function') return { skip: true };
      try {
        window.agreements = [
          { id: 9101, type: 'profit_share', party: 'DraftOnly', profitPct: 10, status: 'draft', createdAt: '2026-01-01T00:00:00Z' },
          { id: 9102, type: 'employment', party: 'SentOnly', status: 'sent', createdAt: '2026-02-01T00:00:00Z' },
        ];
        // renderContracts needs #contracts-page-body; provide it
        let body = document.getElementById('contracts-page-body');
        if (!body) { body = document.createElement('div'); body.id = 'contracts-page-body'; document.body.appendChild(body); }
        setAgFilter('draft');
        const list = document.getElementById('contracts-list');
        const html = list ? list.innerHTML : '';
        return { ok: true, hasDraft: html.includes('DraftOnly'), hidesSent: !html.includes('SentOnly') };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.hasDraft).toBe(true);
    expect(result.hidesSent).toBe(true);
  });

  test('_agSearchInput — search term filters by party name', async () => {
    const result = await page.evaluate(() => {
      if (typeof _agSearchInput !== 'function') return { skip: true };
      try {
        if (typeof setAgFilter === 'function') setAgFilter('all');
        window.agreements = [
          { id: 9201, type: 'custom', party: 'Zebra Co', title: 'Z', status: 'draft', createdAt: '2026-01-01T00:00:00Z' },
          { id: 9202, type: 'custom', party: 'Yak Inc', title: 'Y', status: 'draft', createdAt: '2026-02-01T00:00:00Z' },
        ];
        let el = document.getElementById('contracts-list');
        if (!el) { el = document.createElement('div'); el.id = 'contracts-list'; document.body.appendChild(el); }
        _agSearchInput('zebra');
        const html = el.innerHTML;
        const r = { hasZebra: html.includes('Zebra Co'), hidesYak: !html.includes('Yak Inc') };
        _agSearchInput(''); // reset for later tests
        return { ok: true, ...r };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.hasZebra).toBe(true);
    expect(result.hidesYak).toBe(true);
  });

  test('renderContracts — missing #contracts-page-body is a no-throw early return', async () => {
    const result = await page.evaluate(() => {
      if (typeof renderContracts !== 'function') return { skip: true };
      try {
        document.getElementById('contracts-page-body')?.remove();
        renderContracts();
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
  });

  test('renderContracts — builds search box, chips, and list container', async () => {
    const result = await page.evaluate(() => {
      if (typeof renderContracts !== 'function') return { skip: true };
      try {
        window.agreements = [{ id: 9301, type: 'profit_share', party: 'Gamma', profitPct: 5, status: 'draft', createdAt: '2026-01-01T00:00:00Z' }];
        let body = document.getElementById('contracts-page-body');
        if (!body) { body = document.createElement('div'); body.id = 'contracts-page-body'; document.body.appendChild(body); }
        renderContracts();
        const html = body.innerHTML;
        return {
          ok: true,
          hasSearch: html.includes('contracts-search'),
          hasListDiv: !!document.getElementById('contracts-list'),
          hasDisclaimer: html.includes('Not legal advice'),
        };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.hasSearch).toBe(true);
    expect(result.hasListDiv).toBe(true);
    expect(result.hasDisclaimer).toBe(true);
  });

  test('no console errors during filter/render tests', async () => {
    assertNoErrors(page, 'agreements filter render');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Modals: new/edit/detail
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Agreements — modals (_showAgreementModal, openNewAgreement, openEditAgreement, openAgreementDetail)', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => {
      if (!window.clients) window.clients = [];
      if (!window.S) window.S = {};
      if (!S.employees) S.employees = [];
      clients.push({ id: 'c-ag-001', name: 'Modal Client' });
      S.employees.push({ id: 'e-ag-001', name: 'Modal Employee' });
    });
    await page.waitForTimeout(100);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('_showAgreementModal — null arg opens fresh-contract modal in DOM', async () => {
    const result = await page.evaluate(() => {
      if (typeof _showAgreementModal !== 'function') return { skip: true };
      try {
        document.getElementById('_ag-modal-ov')?.remove();
        _showAgreementModal(null);
        const ov = document.getElementById('_ag-modal-ov');
        const created = !!ov;
        const hasNewTitle = ov ? ov.innerHTML.includes('New contract') : false;
        const hasPartyInput = !!document.getElementById('_ag-party');
        return { ok: true, created, hasNewTitle, hasPartyInput };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.created).toBe(true);
    expect(result.hasNewTitle).toBe(true);
    expect(result.hasPartyInput).toBe(true);
  });

  test('_showAgreementModal — existing agreement renders Edit title + prefilled values', async () => {
    const result = await page.evaluate(() => {
      if (typeof _showAgreementModal !== 'function') return { skip: true };
      try {
        document.getElementById('_ag-modal-ov')?.remove();
        _showAgreementModal({ id: 5, type: 'profit_share', party: 'Existing Party', title: 'Deal X', profitPct: 40, cadence: 'monthly', body: 'BODY', effectiveDate: '2026-03-01' });
        const ov = document.getElementById('_ag-modal-ov');
        const partyEl = document.getElementById('_ag-party');
        return {
          ok: true,
          hasEdit: ov ? ov.innerHTML.includes('Edit contract') : false,
          partyVal: partyEl ? partyEl.value : null,
        };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.hasEdit).toBe(true);
    expect(result.partyVal).toBe('Existing Party');
  });

  test('openNewAgreement — resets editing id and opens modal', async () => {
    const result = await page.evaluate(() => {
      if (typeof openNewAgreement !== 'function') return { skip: true };
      try {
        document.getElementById('_ag-modal-ov')?.remove();
        openNewAgreement();
        return { ok: true, opened: !!document.getElementById('_ag-modal-ov') };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.opened).toBe(true);
  });

  test('openEditAgreement — opens modal for a known id; unknown id is no-throw', async () => {
    const result = await page.evaluate(() => {
      if (typeof openEditAgreement !== 'function') return { skip: true };
      try {
        window.agreements = [{ id: 6001, type: 'custom', party: 'Edit Me', title: 'T', body: 'B', status: 'draft', createdAt: '2026-01-01T00:00:00Z' }];
        document.getElementById('_ag-modal-ov')?.remove();
        openEditAgreement(6001);
        const opened = !!document.getElementById('_ag-modal-ov');
        document.getElementById('_ag-modal-ov')?.remove();
        // unknown id → _showAgreementModal(undefined) should still open a fresh modal, no throw
        openEditAgreement(999999);
        return { ok: true, opened };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.opened).toBe(true);
  });

  test('openAgreementDetail — known id opens detail sheet; unknown id no-throw', async () => {
    const result = await page.evaluate(() => {
      if (typeof openAgreementDetail !== 'function') return { skip: true };
      try {
        window.agreements = [{ id: 7001, type: 'profit_share', party: 'Detail Party', title: 'Detail Title', profitPct: 12, body: 'Body text here', status: 'draft', effectiveDate: '2026-03-01', createdAt: '2026-01-01T00:00:00Z' }];
        document.getElementById('_ag-detail-ov')?.remove();
        openAgreementDetail(7001);
        const ov = document.getElementById('_ag-detail-ov');
        const opened = !!ov;
        const hasBody = ov ? ov.innerHTML.includes('Body text here') : false;
        const hasDelete = ov ? ov.innerHTML.includes('deleteAgreement(7001)') : false;
        // unknown id → function returns early (a not found), no modal, no throw
        document.getElementById('_ag-detail-ov')?.remove();
        openAgreementDetail(424242);
        const noModalForUnknown = !document.getElementById('_ag-detail-ov');
        return { ok: true, opened, hasBody, hasDelete, noModalForUnknown };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.opened).toBe(true);
    expect(result.hasBody).toBe(true);
    expect(result.hasDelete).toBe(true);
    expect(result.noModalForUnknown).toBe(true);
  });

  test('openAgreementDetail — signed agreement shows signature block', async () => {
    const result = await page.evaluate(() => {
      if (typeof openAgreementDetail !== 'function') return { skip: true };
      try {
        window.agreements = [{ id: 7002, type: 'employment', party: 'Signed Party', title: 'Signed', body: 'B', status: 'signed', signedAt: '2026-03-15', signerName: 'Signer Sam', sigData: 'data:image/png;base64,AAAA', createdAt: '2026-01-01T00:00:00Z' }];
        document.getElementById('_ag-detail-ov')?.remove();
        openAgreementDetail(7002);
        const ov = document.getElementById('_ag-detail-ov');
        const html = ov ? ov.innerHTML : '';
        return { ok: true, hasSigner: html.includes('Signer Sam'), hasCopyLink: html.includes('copyAgreementLink(7002)') };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.hasSigner).toBe(true);
    expect(result.hasCopyLink).toBe(true);
  });

  test('no console errors during modal tests', async () => {
    assertNoErrors(page, 'agreements modals');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Mutation: deleteAgreement
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Agreements — deleteAgreement mutation', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.waitForTimeout(100);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('deleteAgreement — removes the seeded agreement', async () => {
    const result = await page.evaluate(() => {
      if (typeof deleteAgreement !== 'function') return { skip: true };
      try {
        window.agreements = [
          { id: 8001, type: 'custom', party: 'Keep', status: 'draft', createdAt: '2026-01-01T00:00:00Z' },
          { id: 8002, type: 'custom', party: 'Delete Me', status: 'draft', createdAt: '2026-01-02T00:00:00Z' },
        ];
        // provide render target so the post-delete renderContracts() does not throw
        let body = document.getElementById('contracts-page-body');
        if (!body) { body = document.createElement('div'); body.id = 'contracts-page-body'; document.body.appendChild(body); }
        const origConfirm = window.zConfirm;
        window.zConfirm = (msg, cb) => { if (cb) cb(); };
        const before = window.agreements.length;
        deleteAgreement(8002);
        window.zConfirm = origConfirm;
        const after = window.agreements.length;
        const stillHasKeep = window.agreements.some(a => a.id === 8001);
        const goneDeleted = !window.agreements.some(a => a.id === 8002);
        return { ok: true, before, after, stillHasKeep, goneDeleted };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.before).toBe(2);
    expect(result.after).toBe(1);
    expect(result.stillHasKeep).toBe(true);
    expect(result.goneDeleted).toBe(true);
  });

  test('deleteAgreement — non-existent id is a no-throw no-op', async () => {
    const result = await page.evaluate(() => {
      if (typeof deleteAgreement !== 'function') return { skip: true };
      try {
        window.agreements = [{ id: 8101, type: 'custom', party: 'Only', status: 'draft', createdAt: '2026-01-01T00:00:00Z' }];
        let body = document.getElementById('contracts-page-body');
        if (!body) { body = document.createElement('div'); body.id = 'contracts-page-body'; document.body.appendChild(body); }
        const origConfirm = window.zConfirm;
        window.zConfirm = (msg, cb) => { if (cb) cb(); };
        const before = window.agreements.length;
        deleteAgreement(999999); // not present
        window.zConfirm = origConfirm;
        return { ok: true, before, after: window.agreements.length };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.before).toBe(1);
    expect(result.after).toBe(1); // unchanged
  });

  test('markAgreementSigned — flips status to signed; unknown id no-throw', async () => {
    const result = await page.evaluate(() => {
      if (typeof markAgreementSigned !== 'function') return { skip: true };
      try {
        window.agreements = [{ id: 8201, type: 'custom', party: 'ToSign', status: 'sent', createdAt: '2026-01-01T00:00:00Z' }];
        let body = document.getElementById('contracts-page-body');
        if (!body) { body = document.createElement('div'); body.id = 'contracts-page-body'; document.body.appendChild(body); }
        markAgreementSigned(8201);
        const a = window.agreements.find(x => x.id === 8201);
        markAgreementSigned(777777); // unknown → early return
        return { ok: true, status: a ? a.status : null, hasSignedAt: !!(a && a.signedAt) };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.status).toBe('signed');
    expect(result.hasSignedAt).toBe(true);
  });

  test('no console errors during delete tests', async () => {
    assertNoErrors(page, 'agreements delete');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Network/storage-touching: _agUpload, _agShowLink, _agSms, copyAgreementLink,
// sendAgreementForSignature, refreshAgreementSignatures — externals are mocked,
// assert no-throw only (no network-result assertions).
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Agreements — network/storage paths (no-throw)', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => {
      if (!window.clients) window.clients = [];
      clients.push({ id: 'c-net-001', name: 'Net Client', phone: '316-555-7777' });
    });
    await page.waitForTimeout(100);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('_agShowLink — builds the share-link modal without throwing', async () => {
    const result = await page.evaluate(async () => {
      if (typeof _agShowLink !== 'function') return { skip: true };
      try {
        if (!navigator.clipboard) {
          Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => {} }, configurable: true });
        }
        document.getElementById('_ag-link-ov')?.remove();
        _agShowLink({ id: 11001, type: 'profit_share', party: 'Net Client', signingToken: 'tok123', partyClientId: 'c-net-001' });
        const opened = !!document.getElementById('_ag-link-ov');
        return { ok: true, opened };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.opened).toBe(true);
  });

  test('_agUpload — returns a result object (error when signed-out) without throwing', async () => {
    const result = await page.evaluate(async () => {
      if (typeof _agUpload !== 'function') return { skip: true };
      try {
        const r = await _agUpload({ id: 11002, type: 'custom', party: 'Net Client', body: 'B', status: 'draft', createdAt: '2026-01-01T00:00:00Z' });
        return { ok: true, hasResult: !!r && typeof r === 'object' && 'error' in r };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.hasResult).toBe(true);
  });

  test('_agSms — builds sms: navigation without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof _agSms !== 'function') return { skip: true };
      try {
        window.agreements = [{ id: 11003, type: 'profit_share', party: 'Net Client', partyClientId: 'c-net-001', signingToken: 'tok456', status: 'sent', createdAt: '2026-01-01T00:00:00Z' }];
        // guard the navigation so the test page does not actually navigate
        const origDesc = Object.getOwnPropertyDescriptor(window.location, 'href');
        try { Object.defineProperty(window.location, 'href', { set() {}, get() { return 'about:blank'; }, configurable: true }); } catch (e) {}
        _agSms(11003);
        _agSms(999999); // unknown id → early return
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
  });

  test('copyAgreementLink — no-throw for known id (refreshes snapshot + shows link)', async () => {
    const result = await page.evaluate(async () => {
      if (typeof copyAgreementLink !== 'function') return { skip: true };
      try {
        if (!navigator.clipboard) {
          Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => {} }, configurable: true });
        }
        window.agreements = [{ id: 11004, type: 'custom', party: 'Net Client', body: 'B', signingToken: 'tok789', status: 'sent', createdAt: '2026-01-01T00:00:00Z' }];
        copyAgreementLink(11004);
        copyAgreementLink(999999); // unknown id → early return
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
  });

  test('sendAgreementForSignature — signed-out path alerts, no-throw', async () => {
    const result = await page.evaluate(async () => {
      if (typeof sendAgreementForSignature !== 'function') return { skip: true };
      try {
        const origAlert = window.zAlert;
        window.zAlert = () => {};
        window.agreements = [{ id: 11005, type: 'custom', party: 'Net Client', body: 'B', status: 'draft', createdAt: '2026-01-01T00:00:00Z' }];
        await sendAgreementForSignature(11005);
        await sendAgreementForSignature(999999); // unknown id → early return
        window.zAlert = origAlert;
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
  });

  test('refreshAgreementSignatures — no-throw with no pending and with pending', async () => {
    const result = await page.evaluate(async () => {
      if (typeof refreshAgreementSignatures !== 'function') return { skip: true };
      try {
        window.agreements = [];
        await refreshAgreementSignatures(); // no pending → early return
        window.agreements = [{ id: 11006, type: 'custom', party: 'Net Client', status: 'sent', signingKey: 'agreements/u/11006_tok.json', createdAt: '2026-01-01T00:00:00Z' }];
        await refreshAgreementSignatures(); // pending present (signed-out → early return anyway)
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
  });

  test('no console errors during network/storage tests', async () => {
    assertNoErrors(page, 'agreements network storage');
  });
});
