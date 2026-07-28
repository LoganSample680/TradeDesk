// @ts-check
// QR lead tracking: js/qr-leads.js (code generation, source CRUD, funnel
// rendering) run in the real app context. intake.html's half of this feature
// (the ?src= resolution, field-drop-off tracking, submitted-with-source) is
// covered separately in tests/e2e-features.spec.js's "intake.html: QR lead
// tracking" describe block, since intake.html boots as its own standalone
// page, not inside the main app.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('QR lead tracking: js/qr-leads.js', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  const qrReset = () => page.evaluate(() => {
    window._supaUser = { id: 'qr-e2e-user-1', email: 'q@t.com' };
    // _account is a bare `let` (data.js), not bridged like _supaUser/_supa —
    // must be set as the bare identifier, not window._account, or it silently
    // stays null. qr_sources.account_id needs accounts.id (_account.id), a
    // different uuid from the auth user's own id above.
    _account = { id: 'acct-e2e-0001' };
    window.__rec = { inserts: [], deletes: [] };
    window.__qrSourcesData = [];
    window.__qrEventsData = [];
    window.__origSupa = window.__origSupa || window._supa;
    window._supa = {
      from: (tbl) => ({
        select: () => ({
          eq: (col, val) => ({
            order: () => Promise.resolve({ data: tbl === 'qr_sources' ? window.__qrSourcesData : [] }),
            then: (cb) => cb({ data: tbl === 'qr_sources' ? window.__qrSourcesData : [] }),
          }),
          in: (col, ids) => Promise.resolve({ data: tbl === 'qr_events' ? window.__qrEventsData.filter(e => ids.includes(e.qr_source_id)) : [] }),
        }),
        insert: (row) => {
          window.__rec.inserts.push({ tbl, row });
          if (tbl === 'qr_sources') window.__qrSourcesData.unshift({ id: 'src-' + window.__qrSourcesData.length, ...row, created_at: new Date().toISOString() });
          return Promise.resolve({ error: null });
        },
        delete: () => ({ eq: (col, val) => { window.__rec.deletes.push({ tbl, val }); window.__qrSourcesData = window.__qrSourcesData.filter(s => s.id !== val); return Promise.resolve({ error: null }); } }),
      }),
    };
    _qrSources = []; _qrEventCounts = {};
  });
  const qrRestore = () => page.evaluate(() => { if (window.__origSupa) window._supa = window.__origSupa; });

  test('_qrGenCode: produces a code the redirect function (functions/q/[[code]].js) will accept', async () => {
    const codes = await page.evaluate(() => Array.from({ length: 20 }, () => _qrGenCode()));
    // Must match ^[a-z0-9]{6,16}$ — the exact regex functions/q/[[code]].js validates against.
    for (const c of codes) expect(c).toMatch(/^[a-z0-9]{6,16}$/);
    // Real randomness, not a constant: 20 draws should not collide.
    expect(new Set(codes).size).toBe(20);
  });

  test('_qrTargetUrl: builds a /q/<code> link under the client base URL', async () => {
    const url = await page.evaluate(() => _qrTargetUrl('abc123xyz9'));
    expect(url).toContain('/q/abc123xyz9');
  });

  test('_qrCreateSource: rejects an empty label without inserting', async () => {
    await qrReset();
    await page.evaluate(() => { const el = document.getElementById('qr-new-label'); if (el) el.value = ''; });
    await page.evaluate(() => _qrCreateSource());
    const inserted = await page.evaluate(() => window.__rec.inserts.length);
    expect(inserted).toBe(0);
    await qrRestore();
  });

  test('_qrCreateSource: inserts with the typed label, chosen category, and a fresh code', async () => {
    await qrReset();
    // renderQrLeadsPage populates #qr-new-cat's options; the create flow needs
    // that select to exist and have a value first, same as a real page visit.
    await page.evaluate(() => { renderQrLeadsPage(); document.getElementById('qr-new-label').value = 'Yard sign - 123 Main St'; });
    await page.evaluate(() => _qrCreateSource());
    await page.waitForTimeout(50);
    const row = await page.evaluate(() => window.__rec.inserts.find(i => i.tbl === 'qr_sources')?.row);
    expect(row).toBeTruthy();
    expect(row.label).toBe('Yard sign - 123 Main St');
    expect(row.code).toMatch(/^[a-z0-9]{6,16}$/);
    expect(row.account_id).toBeTruthy();
    await qrRestore();
  });

  // Regression guard (root cause, CLAUDE.md §10.1): account_id is a FK to
  // accounts(id), a separate gen_random_uuid() from the signed-in auth user's
  // own id. _qrCreateSource/_qrLoadSources previously used _effectiveUid()
  // (the auth user id) for account_id, which the RLS insert policy silently
  // rejects in production (accounts.id != owner_id/auth.uid()) — invisible to
  // offline tests because they fully mock the insert and never hit real RLS.
  // Locks in that account_id is sourced from _account.id, not the auth user id.
  test('_qrCreateSource: uses accounts.id (_account.id) for account_id, not the auth user\'s own id', async () => {
    await qrReset();
    await page.evaluate(() => {
      _account = { id: 'acct-real-account-row-id' };
      _supaUser = { id: 'auth-user-id-should-not-be-used', email: 'q@t.com' };
      renderQrLeadsPage();
      document.getElementById('qr-new-label').value = 'Truck wrap - regression check';
    });
    await page.evaluate(() => _qrCreateSource());
    await page.waitForTimeout(50);
    const row = await page.evaluate(() => window.__rec.inserts.find(i => i.tbl === 'qr_sources')?.row);
    expect(row.account_id).toBe('acct-real-account-row-id');
    expect(row.account_id).not.toBe('auth-user-id-should-not-be-used');
    await qrRestore();
  });

  test('_qrCreateSource: _account not yet loaded, does not insert with a bad account_id', async () => {
    await qrReset();
    await page.evaluate(() => {
      _account = null;
      renderQrLeadsPage();
      document.getElementById('qr-new-label').value = 'Should not insert';
    });
    await page.evaluate(() => _qrCreateSource());
    await page.waitForTimeout(50);
    const inserted = await page.evaluate(() => window.__rec.inserts.some(i => i.tbl === 'qr_sources'));
    expect(inserted).toBe(false);
    await qrRestore();
  });

  test('_qrDeleteSource: removes the row and reloads the list', async () => {
    await qrReset();
    await page.evaluate(() => {
      window.__qrSourcesData = [{ id: 'src-del-1', label: 'Truck wrap', category: 'Vehicle / truck wrap', code: 'delcode1' }];
    });
    await page.evaluate(() => _qrDeleteSource('src-del-1'));
    await page.waitForTimeout(50);
    const deleted = await page.evaluate(() => window.__rec.deletes.some(d => d.tbl === 'qr_sources' && d.val === 'src-del-1'));
    expect(deleted).toBe(true);
    await qrRestore();
  });

  test('renderQrLeadsPage: shows the empty state with zero sources', async () => {
    await qrReset();
    await page.evaluate(() => { _qrSources = []; _qrEventCounts = {}; renderQrLeadsPage(); });
    const html = await page.evaluate(() => document.getElementById('qr-leads-list').innerHTML);
    expect(html).toContain('No QR codes yet');
    await qrRestore();
  });

  test('renderQrLeadsPage: rolls up scan/open/submit counts per source correctly', async () => {
    await qrReset();
    await page.evaluate(() => {
      _qrSources = [{ id: 'src-a', label: 'Yard sign - 123 Main St', category: 'Yard sign', code: 'yardsign1' }];
      _qrEventCounts = { 'src-a': { scan: 7, form_opened: 4, submitted: 2 } };
      renderQrLeadsPage();
    });
    const html = await page.evaluate(() => document.getElementById('qr-leads-list').innerHTML);
    expect(html).toContain('Yard sign - 123 Main St');
    expect(html).toContain('>7<');
    expect(html).toContain('>4<');
    expect(html).toContain('>2<');
    await qrRestore();
  });

  test('renderQrLeadsPage: download buttons put SVG (the one used for print) on the right, PNG on the left', async () => {
    await qrReset();
    await page.evaluate(() => {
      _qrSources = [{ id: 'src-btn', label: 'Business cards', category: 'Business card', code: 'btncode01' }];
      _qrEventCounts = {};
      renderQrLeadsPage();
    });
    const order = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('#qr-leads-list button')].filter(b => /Download/.test(b.textContent));
      return btns.map(b => b.textContent.trim());
    });
    expect(order).toEqual(['Download PNG', 'Download SVG (print)']);
    await qrRestore();
  });

  test('renderQrLeadsPage: no marketing spend logged yet, shows the "log cost" nudge, not a $0 ROI', async () => {
    await qrReset();
    await page.evaluate(() => {
      expenses = [];
      _qrSources = [{ id: 'src-nospend', label: 'Door hangers - north side', category: 'Door hanger', code: 'nospend01' }];
      _qrEventCounts = { 'src-nospend': { scan: 5, form_opened: 2, submitted: 1 } };
      renderQrLeadsPage();
    });
    const html = await page.evaluate(() => document.getElementById('qr-leads-list').innerHTML);
    expect(html).toContain('Log what this cost, see ROI');
    expect(html).not.toContain('per lead');
    await qrRestore();
  });

  test('renderQrLeadsPage: sums marketing expenses tagged with this source\'s label into spent + cost-per-lead', async () => {
    await qrReset();
    await page.evaluate(() => {
      expenses = [
        { id: 1, cat: 'marketing', lead_source: 'Truck wrap - Ford F150', amount: 120 },
        { id: 2, cat: 'marketing', lead_source: 'Truck wrap - Ford F150', amount: 60 },
        { id: 3, cat: 'marketing', lead_source: 'Some other source', amount: 999 }, // must NOT be counted
        { id: 4, cat: 'materials', lead_source: 'Truck wrap - Ford F150', amount: 500 }, // wrong cat, must NOT be counted
      ];
      _qrSources = [{ id: 'src-spend', label: 'Truck wrap - Ford F150', category: 'Vehicle / truck wrap', code: 'spend0001' }];
      _qrEventCounts = { 'src-spend': { scan: 40, form_opened: 20, submitted: 9 } };
      renderQrLeadsPage();
    });
    const html = await page.evaluate(() => document.getElementById('qr-leads-list').innerHTML);
    expect(html).toContain('$180.00'); // 120 + 60, the other rows excluded
    expect(html).toContain('$20.00'); // 180 / 9 leads
    expect(html).toContain('per lead');
    await qrRestore();
  });

  test('_qrLogCost: opens the expense flow pre-set to Marketing with this source\'s label as the channel', async () => {
    await qrReset();
    const result = await page.evaluate(() => {
      document.getElementById('expense-modal')?.remove();
      expenses = [];
      _qrSources = [{ id: 'src-cost', label: 'Yard sign - job sites', category: 'Yard sign', code: 'costcode1' }];
      _qrEventCounts = { 'src-cost': { scan: 14, form_opened: 6, submitted: 2 } };
      renderQrLeadsPage();
      _qrLogCost('src-cost');
      return {
        modalOpen: !!document.getElementById('expense-modal'),
        cat: document.getElementById('em-cat')?.value,
        mktVisible: document.getElementById('em-marketing-section')?.style.display,
        src: document.getElementById('em-mkt-source')?.value,
        vendor: document.getElementById('em-vendor')?.value,
      };
    });
    expect(result.modalOpen).toBe(true);
    expect(result.cat).toBe('marketing');
    expect(result.mktVisible).toBe('block');
    expect(result.src).toBe('Yard sign - job sites');
    expect(result.vendor).toBe('Yard sign - job sites');
    await page.evaluate(() => document.getElementById('expense-modal')?.remove());
    await qrRestore();
  });

  test('_qrLogCost: unknown source id, does not throw or open the modal', async () => {
    await qrReset();
    const threw = await page.evaluate(() => {
      document.getElementById('expense-modal')?.remove();
      try { _qrLogCost('does-not-exist'); return false; } catch (e) { return true; }
    });
    expect(threw).toBe(false);
    const modalOpen = await page.evaluate(() => !!document.getElementById('expense-modal'));
    expect(modalOpen).toBe(false);
    await qrRestore();
  });

  test('_qrLoadSources: aggregates raw qr_events rows into per-source counts', async () => {
    await qrReset();
    await page.evaluate(() => {
      window.__qrSourcesData = [{ id: 'src-agg', account_id: 'qr-e2e-user-1', label: 'Business cards', category: 'Business card', code: 'bizcard01', created_at: new Date().toISOString() }];
      window.__qrEventsData = [
        { qr_source_id: 'src-agg', event: 'scan' }, { qr_source_id: 'src-agg', event: 'scan' },
        { qr_source_id: 'src-agg', event: 'form_opened' },
        { qr_source_id: 'src-agg', event: 'submitted' },
      ];
    });
    await page.evaluate(() => _qrLoadSources());
    await page.waitForTimeout(50);
    const counts = await page.evaluate(() => _qrEventCounts['src-agg']);
    expect(counts).toEqual({ scan: 2, form_opened: 1, submitted: 1 });
    await qrRestore();
  });

  test('openIntakeFormModal: intake link includes the account id (regression: was missing ?a=)', async () => {
    await page.evaluate(() => { document.querySelectorAll('.zmodal-overlay').forEach(m => m.remove()); openIntakeFormModal(); });
    const hasParam = await page.evaluate(() => {
      const overlay = document.querySelector('.zmodal-overlay');
      return overlay ? /intake\.html\?a=/.test(overlay.innerHTML) : false;
    });
    expect(hasParam).toBe(true);
    await page.evaluate(() => document.querySelectorAll('.zmodal-overlay').forEach(m => m.remove()));
  });

  test('openIntakeFormModal: offers a path to the QR codes page', async () => {
    await page.evaluate(() => { document.querySelectorAll('.zmodal-overlay').forEach(m => m.remove()); openIntakeFormModal(); });
    const hasQrLink = await page.evaluate(() => {
      const overlay = document.querySelector('.zmodal-overlay');
      return overlay ? overlay.innerHTML.includes("pg-qr-leads") : false;
    });
    expect(hasQrLink).toBe(true);
    await page.evaluate(() => document.querySelectorAll('.zmodal-overlay').forEach(m => m.remove()));
  });

  test('pg-qr-leads: goPg renders the page and triggers a source load', async () => {
    await qrReset();
    await page.evaluate(() => goPg('pg-qr-leads'));
    await page.waitForTimeout(50);
    const active = await page.evaluate(() => document.getElementById('pg-qr-leads')?.classList.contains('active'));
    expect(active).toBe(true);
    await page.evaluate(() => goPg('pg-dash'));
    await qrRestore();
  });

  test('zero console errors across QR lead tracking', async () => {
    assertNoErrors(page, 'QR lead tracking');
  });
});
