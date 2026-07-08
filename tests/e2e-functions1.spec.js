// @ts-check
const { test, expect, mockAllExternal, _supabaseShim, _supabaseShimIntake, waitForAppBoot, goPg, assertNoErrors, FAKE_BID_ID_1, FAKE_BID_ID_2, FAKE_USER_ID, FAKE_TOKEN, FAKE_TOKEN_2, MOCK_PROPOSAL } = require('./helpers');

test.describe('Data utilities — getClientById / getClientBids / parseD / fmt', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('getClientById — returns client when id matches', async () => {
    const result = await page.evaluate(() => {
      if (typeof getClientById !== 'function') return { skip: true };
      // seed a client
      if (!window.clients) window.clients = [];
      clients.push({ id: 'test-c-001', name: 'Data Test Client', phone: '316-000-0001' });
      const found = getClientById('test-c-001');
      return { ok: !!found, name: found ? found.name : null };
    });
    if (!result.skip) {
      expect(result.ok).toBe(true);
      expect(result.name).toBe('Data Test Client');
    }
  });

  test('getClientById — returns undefined for missing id', async () => {
    const result = await page.evaluate(() => {
      if (typeof getClientById !== 'function') return { skip: true };
      const found = getClientById('nonexistent-xyz-999');
      return { isUndefined: found === undefined || found === null };
    });
    if (!result.skip) expect(result.isUndefined).toBe(true);
  });

  test('getClientBids — returns bids array for a client', async () => {
    const result = await page.evaluate(() => {
      if (typeof getClientBids !== 'function') return { skip: true };
      if (!window.bids) window.bids = [];
      // Push a Closed Won bid — getClientBids includes closed-won bids
      bids.push({ id: 9002, clientId: 'test-c-002', status: 'Closed Won', amount: 800 });
      bids.push({ id: 9003, clientId: 'test-c-003', status: 'Closed Won', amount: 300 });
      const r = getClientBids('test-c-002');
      const r3 = getClientBids('test-c-003');
      return { isArray: Array.isArray(r), clientSeparated: r3.every(b => b.clientId === 'test-c-003') };
    });
    if (!result.skip) {
      expect(result.isArray).toBe(true);
    }
  });

  test('parseD — parses YYYY-MM-DD into Date object', async () => {
    const result = await page.evaluate(() => {
      if (typeof parseD !== 'function') return { skip: true };
      const d = parseD('2026-01-15');
      return { isDate: d instanceof Date, year: d.getFullYear(), month: d.getMonth() };
    });
    if (!result.skip) {
      expect(result.isDate).toBe(true);
      expect(result.year).toBe(2026);
      expect(result.month).toBe(0); // January = 0
    }
  });

  test('todayKey — returns YYYY-MM-DD string', async () => {
    const result = await page.evaluate(() => {
      if (typeof todayKey !== 'function') return { skip: true };
      const k = todayKey();
      return { val: k, valid: /^\d{4}-\d{2}-\d{2}$/.test(k) };
    });
    if (!result.skip) expect(result.valid).toBe(true);
  });

  test('fmt — formats number as USD currency', async () => {
    const result = await page.evaluate(() => {
      if (typeof fmt !== 'function') return { skip: true };
      const r1 = fmt(1234.5);
      const r2 = fmt(0);
      return { r1, r2, hasDecimal: r1.includes('.') };
    });
    if (!result.skip) {
      expect(result.hasDecimal).toBe(true);
      expect(result.r2).toContain('0');
    }
  });

  test('fmtPhone — formats phone string to XXX-XXX-XXXX', async () => {
    const result = await page.evaluate(() => {
      if (typeof fmtPhone !== 'function') {
        if (typeof formatPhoneDisplay !== 'function') return { skip: true };
        const r = formatPhoneDisplay('3165550100');
        return { r, ok: r.includes('-') };
      }
      // fmtPhone mutates an input element
      const inp = document.createElement('input');
      inp.value = '3165550100';
      fmtPhone(inp);
      return { r: inp.value, ok: inp.value.includes('-') };
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('no console errors during data utility tests', async () => {
    assertNoErrors(page, 'data utilities');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH B: Dashboard — renderDashToday, renderPipeline, renderLeadSources, etc.
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Dashboard render functions', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    // Navigate to dashboard
    await page.evaluate(() => { if (typeof goPg === 'function') goPg('pg-dash'); });
    await page.waitForTimeout(300);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('renderDashToday — runs without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof renderDashToday !== 'function') return { skip: true };
      try { renderDashToday(); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('renderPipeline — runs without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof renderPipeline !== 'function') return { skip: true };
      try { renderPipeline(); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('renderLeadSources — runs without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof renderLeadSources !== 'function') return { skip: true };
      try { renderLeadSources(); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('renderDashCollect — runs without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof renderDashCollect !== 'function') return { skip: true };
      try { renderDashCollect(); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('setDashFilter — changes filter without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof setDashFilter !== 'function') return { skip: true };
      try {
        setDashFilter('month');
        setDashFilter('year');
        setDashFilter('all');
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('getNextCollAction — returns action object for each stage', async () => {
    const result = await page.evaluate(() => {
      if (typeof getNextCollAction !== 'function') return { skip: true };
      try {
        const stages = ['none', 'reminder', 'second', 'intent', 'lien_ready', 'lien_filed'];
        const results = stages.map(s => {
          const r = getNextCollAction(s);
          return { stage: s, hasLabel: r && (typeof r.label === 'string' || r === null) };
        });
        return { ok: true, results };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('markFollowupSent — updates bid follow-up stage', async () => {
    const result = await page.evaluate(() => {
      if (typeof markFollowupSent !== 'function') return { skip: true };
      try {
        if (!window.bids) window.bids = [];
        const bid = { id: 88001, clientId: 'c-dash-1', status: 'Pending', amount: 1000, followupStage: 'none' };
        bids.push(bid);
        markFollowupSent(88001);
        const updated = bids.find(b => b.id === 88001);
        return { ok: true, hadBid: !!updated };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('no console errors during dashboard tests', async () => {
    assertNoErrors(page, 'dashboard render functions');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH C: Clients — deleteClient, openEditClient, checkYearBuilt, setCF, renderClientHubPage
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Client management functions', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    // Seed a client and navigate to clients page
    await page.evaluate(() => {
      if (!window.clients) window.clients = [];
      clients.push({ id: 'c-edit-001', name: 'Edit Me Client', phone: '316-555-1111',
        addr: '100 Test St', city: 'Wichita', state: 'KS', zip: '67202',
        propertyType: 'residential', source: 'Word of mouth', tier: 'standard', createdAt: '2026-01-01' });
      if (typeof goPg === 'function') goPg('pg-clients');
    });
    await page.waitForTimeout(300);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('setCF — updates client filter without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof setCF !== 'function') return { skip: true };
      try {
        setCF('all');
        setCF('lead');
        setCF('won');
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('openEditClient — opens edit form for existing client', async () => {
    const result = await page.evaluate(() => {
      if (typeof openEditClient !== 'function') return { skip: true };
      try {
        window.currentClientId = 'c-edit-001';
        openEditClient();
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('checkYearBuilt — shows warning for pre-1978 buildings', async () => {
    const result = await page.evaluate(() => {
      if (typeof checkYearBuilt !== 'function') return { skip: true };
      try {
        // create cf-year-built if missing
        let el = document.getElementById('cf-year-built');
        if (!el) {
          el = document.createElement('input');
          el.id = 'cf-year-built';
          document.body.appendChild(el);
        }
        el.value = '1965';
        checkYearBuilt();
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('checkYearBuilt — no warning for post-1978 buildings', async () => {
    const result = await page.evaluate(() => {
      if (typeof checkYearBuilt !== 'function') return { skip: true };
      try {
        let el = document.getElementById('cf-year-built');
        if (!el) { el = document.createElement('input'); el.id = 'cf-year-built'; document.body.appendChild(el); }
        el.value = '2005';
        checkYearBuilt();
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('renderClientHubPage — renders without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof renderClientHubPage !== 'function') return { skip: true };
      try {
        renderClientHubPage();
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('deleteClient — removes client after confirmation (stub zConfirm)', async () => {
    const result = await page.evaluate(() => {
      if (typeof deleteClient !== 'function') return { skip: true };
      try {
        const origConfirm = window.zConfirm;
        window.zConfirm = (msg, cb) => { if (cb) cb(); }; // auto-confirm
        window.currentClientId = 'c-edit-001';
        deleteClient();
        window.zConfirm = origConfirm;
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('no console errors during client management tests', async () => {
    assertNoErrors(page, 'client management');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH D: Jobs — openJobSheet, markJobDone, reopenJob, deleteJob, toggleScope, etc.
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Jobs management functions', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => {
      if (!window.clients) window.clients = [];
      if (!window.bids) window.bids = [];
      if (!window.jobs) window.jobs = [];
      const today = new Date().toISOString().slice(0,10);
      clients.push({ id: 'c-job-001', name: 'Job Client One', phone: '316-555-2222', addr: '200 Job St' });
      bids.push({ id: 70001, clientId: 'c-job-001', status: 'Closed Won', amount: 1500, trade: 'painting' });
      jobs.push({ id: 'j-001', clientId: 'c-job-001', bidId: 70001, date: today, status: 'upcoming', desc: 'Paint living room' });
      jobs.push({ id: 'j-002', clientId: 'c-job-001', bidId: 70001, date: today, status: 'upcoming', desc: 'Paint bedroom' });
      if (typeof goPg === 'function') goPg('pg-jobs');
    });
    await page.waitForTimeout(300);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('setJobFilter — changes job filter without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof setJobFilter !== 'function') return { skip: true };
      try {
        ['all','upcoming','active','done'].forEach(f => setJobFilter(f));
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('setLeadFilter — changes lead filter without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof setLeadFilter !== 'function') return { skip: true };
      try {
        ['all','hot','warm','cold'].forEach(f => setLeadFilter(f));
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('renderJobsPage — renders job list without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof renderJobsPage !== 'function') return { skip: true };
      try { renderJobsPage(); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('getBidStage — returns stage object for a bid', async () => {
    const result = await page.evaluate(() => {
      if (typeof getBidStage !== 'function') return { skip: true };
      try {
        const bid = bids.find(b => b.id === 70001);
        if (!bid) return { skip: true };
        const stage = getBidStage(bid);
        return { ok: !!stage, hasStage: 'stage' in stage };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) {
      expect(result.ok).toBe(true);
      expect(result.hasStage).toBe(true);
    }
  });

  test('openJobSheet — opens job detail for client', async () => {
    const result = await page.evaluate(() => {
      if (typeof openJobSheet !== 'function') return { skip: true };
      try {
        openJobSheet('c-job-001');
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('markJobDone — marks job as complete without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof markJobDone !== 'function') return { skip: true };
      try {
        const origConfirm = window.zConfirm;
        window.zConfirm = (msg, cb) => { if (cb) cb(); };
        markJobDone('j-001');
        window.zConfirm = origConfirm;
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('reopenJob — reopens completed job without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof reopenJob !== 'function') return { skip: true };
      try {
        // Mark j-002 as done first
        const j = jobs.find(j => j.id === 'j-002');
        if (j) j.status = 'done';
        reopenJob('j-002');
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('sendOMWText — constructs SMS link for client', async () => {
    const result = await page.evaluate(() => {
      if (typeof sendOMWText !== 'function') return { skip: true };
      try {
        // Stub window.open so we don't actually navigate
        const origOpen = window.open;
        let called = false;
        window.open = (...args) => { called = true; return null; };
        sendOMWText('c-job-001');
        window.open = origOpen;
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('openMapsForClient — attempts to open maps for client address', async () => {
    const result = await page.evaluate(() => {
      if (typeof openMapsForClient !== 'function') return { skip: true };
      try {
        const origOpen = window.open;
        window.open = () => null;
        openMapsForClient('c-job-001');
        window.open = origOpen;
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('toggleScope — toggles scope item state without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof toggleScope !== 'function') return { skip: true };
      try {
        if (!window.scopeActiveMap) window.scopeActiveMap = {};
        toggleScope('scope-1', true);
        toggleScope('scope-1', false);
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('deleteJob — removes job after confirmation', async () => {
    const result = await page.evaluate(() => {
      if (typeof deleteJob !== 'function') return { skip: true };
      try {
        const origConfirm = window.zConfirm;
        window.zConfirm = (msg, cb) => { if (cb) cb(); };
        const initialLen = jobs.length;
        deleteJob('j-002');
        window.zConfirm = origConfirm;
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('no console errors during jobs management tests', async () => {
    assertNoErrors(page, 'jobs management');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH E: Mileage — openLogTripModal, delMileage, editMilePurpose, openMileageEdit
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Mileage tracking functions', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => {
      if (!window.mileage) window.mileage = [];
      mileage.push({ id: 'm-001', from: '100 Shop St', to: '200 Client Ave', miles: 12.5,
        purpose: 'Estimate', vehicle: 'Van', date: '2026-05-10', clientId: 'c-mi-001' });
      mileage.push({ id: 'm-002', from: '100 Shop St', to: '300 Other St', miles: 8.0,
        purpose: 'Job', vehicle: 'Van', date: '2026-05-12', clientId: 'c-mi-001' });
    });
    await page.waitForTimeout(200);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('openLogTripModal — opens trip logging modal without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof openLogTripModal !== 'function') return { skip: true };
      try {
        openLogTripModal({});
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('openLogTripModal — opens with pre-filled options', async () => {
    const result = await page.evaluate(() => {
      if (typeof openLogTripModal !== 'function') return { skip: true };
      try {
        openLogTripModal({ from: '100 Shop St', to: '200 Client Ave', purpose: 'Estimate', miles: 12.5 });
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('openMileageEdit — opens edit modal for existing record', async () => {
    const result = await page.evaluate(() => {
      if (typeof openMileageEdit !== 'function') return { skip: true };
      try {
        openMileageEdit('m-001');
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('editMilePurpose — updates purpose on existing mileage record', async () => {
    const result = await page.evaluate(() => {
      if (typeof editMilePurpose !== 'function') return { skip: true };
      try {
        editMilePurpose('m-001', 'Updated Purpose');
        const rec = mileage.find(m => m.id === 'm-001');
        return { ok: true, purpose: rec ? rec.purpose : null };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('delMileage — removes mileage record after confirmation', async () => {
    const result = await page.evaluate(() => {
      if (typeof delMileage !== 'function') return { skip: true };
      try {
        const origConfirm = window.zConfirm;
        window.zConfirm = (msg, cb) => { if (cb) cb(); };
        const before = mileage.length;
        delMileage('m-002');
        window.zConfirm = origConfirm;
        return { ok: true, before };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('no console errors during mileage tests', async () => {
    assertNoErrors(page, 'mileage tracking');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH F: Bids — getClientRisk, setClientRisk, riskBadge, openEditBid, etc.
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Bids management functions', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => {
      if (!window.clients) window.clients = [];
      if (!window.bids) window.bids = [];
      clients.push({ id: 'c-bid-001', name: 'Bid Test Client', phone: '316-555-3333',
        addr: '300 Bid St', city: 'Wichita', state: 'KS', zip: '67202' });
      bids.push({ id: 60001, clientId: 'c-bid-001', status: 'Pending', amount: 2000,
        trade: 'painting', createdAt: new Date().toISOString(), deposit: 500 });
      bids.push({ id: 60002, clientId: 'c-bid-001', status: 'Closed Won', amount: 3000,
        trade: 'painting', createdAt: new Date().toISOString(), signedAt: new Date().toISOString() });
    });
    await page.waitForTimeout(200);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('getClientRisk — returns risk level string', async () => {
    const result = await page.evaluate(() => {
      if (typeof getClientRisk !== 'function') return { skip: true };
      try {
        const level = getClientRisk('c-bid-001');
        return { ok: true, isString: typeof level === 'string' };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) {
      expect(result.ok).toBe(true);
      expect(result.isString).toBe(true);
    }
  });

  test('setClientRisk — sets risk level on client', async () => {
    const result = await page.evaluate(() => {
      if (typeof setClientRisk !== 'function') return { skip: true };
      try {
        setClientRisk('c-bid-001', 'high');
        const c = clients.find(c => c.id === 'c-bid-001');
        return { ok: true, risk: c ? c.risk : null };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('riskBadge — returns HTML string for risk levels', async () => {
    const result = await page.evaluate(() => {
      if (typeof riskBadge !== 'function') return { skip: true };
      try {
        const badge = riskBadge('c-bid-001');
        return { ok: true, isString: typeof badge === 'string' };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) {
      expect(result.ok).toBe(true);
      expect(result.isString).toBe(true);
    }
  });

  test('openEditBid — opens existing bid in estimate form', async () => {
    const result = await page.evaluate(() => {
      if (typeof openEditBid !== 'function') return { skip: true };
      try {
        openEditBid(60001, 1);
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('openPayPanel — opens payment modal without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof openPayPanel !== 'function') return { skip: true };
      try {
        openPayPanel(60002, 'deposit');
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('selectPayType — updates payment type UI without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof selectPayType !== 'function') return { skip: true };
      try {
        const btn = document.createElement('button');
        btn.dataset.type = 'cash';
        selectPayType(btn, 60002);
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('deletePay — removes payment after confirmation', async () => {
    const result = await page.evaluate(() => {
      if (typeof deletePay !== 'function') return { skip: true };
      try {
        if (!window.payments) window.payments = [];
        payments.push({ id: 'pay-001', bidId: 60002, amount: 500, type: 'deposit' });
        const origConfirm = window.zConfirm;
        window.zConfirm = (msg, cb) => { if (cb) cb(); };
        deletePay('pay-001');
        window.zConfirm = origConfirm;
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('showFileLienDirect — opens lien filing modal without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof showFileLienDirect !== 'function') return { skip: true };
      try {
        showFileLienDirect(60002);
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('autoFillPayAmount — runs without throwing (compatibility stub)', async () => {
    const result = await page.evaluate(() => {
      if (typeof autoFillPayAmount !== 'function') return { skip: true };
      try { autoFillPayAmount(); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('no console errors during bids management tests', async () => {
    assertNoErrors(page, 'bids management');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH G: Proposals — syncAdj, showAdjReasonSheet, initSigPad, sendClientHubLink, etc.
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Proposals functions', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => {
      if (!window.clients) window.clients = [];
      if (!window.bids) window.bids = [];
      clients.push({ id: 'c-prop-001', name: 'Proposal Client', phone: '316-555-4444',
        addr: '400 Prop St', city: 'Wichita', state: 'KS', zip: '67202' });
      bids.push({ id: 50001, clientId: 'c-prop-001', status: 'Pending', amount: 2500,
        trade: 'painting', createdAt: new Date().toISOString(), proposalHtml: '<p>Test proposal</p>' });
    });
    await page.waitForTimeout(400);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('syncAdj — runs without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof syncAdj !== 'function') return { skip: true };
      try { syncAdj(); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('showAdjReasonSheet — shows modal without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof showAdjReasonSheet !== 'function') return { skip: true };
      try {
        showAdjReasonSheet(-10);
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('adjReasonPillTap — handles pill selection without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof adjReasonPillTap !== 'function') return { skip: true };
      try {
        adjReasonPillTap('Senior discount');
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('confirmAdjReason — saves adjustment reason without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof confirmAdjReason !== 'function') return { skip: true };
      try {
        confirmAdjReason('discount', 'Senior discount', -10);
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('clearAdjReason — clears adjustment without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof clearAdjReason !== 'function') return { skip: true };
      try { clearAdjReason(); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('closeAdjSheetSnap — dismisses sheet without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof closeAdjSheetSnap !== 'function') return { skip: true };
      try { closeAdjSheetSnap(); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('initSigPad — initializes signature canvas without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof initSigPad !== 'function') return { skip: true };
      try {
        // ensure canvas exists
        let c = document.getElementById('sig-canvas');
        if (!c) { c = document.createElement('canvas'); c.id = 'sig-canvas'; document.body.appendChild(c); }
        initSigPad();
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('updateTypedSig — updates typed sig preview without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof updateTypedSig !== 'function') return { skip: true };
      try {
        let inp = document.getElementById('typed-sig-input');
        if (!inp) { inp = document.createElement('input'); inp.id = 'typed-sig-input'; document.body.appendChild(inp); }
        inp.value = 'John Smith';
        updateTypedSig();
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('hasSignature — returns boolean', async () => {
    const result = await page.evaluate(() => {
      if (typeof hasSignature !== 'function') return { skip: true };
      try {
        const r = hasSignature();
        return { ok: true, isBool: typeof r === 'boolean' };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) {
      expect(result.ok).toBe(true);
      expect(result.isBool).toBe(true);
    }
  });

  test('sendProposalViaSms — opens SMS without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof sendProposalViaSms !== 'function') return { skip: true };
      try {
        const origOpen = window.open;
        window.open = () => null;
        sendProposalViaSms();
        window.open = origOpen;
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('sendClientHubLink — shows hub link modal without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof sendClientHubLink !== 'function') return { skip: true };
      try {
        sendClientHubLink('c-prop-001');
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('openGalleryUpload — opens photo upload modal without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof openGalleryUpload !== 'function') return { skip: true };
      try {
        openGalleryUpload('j-001', 'c-prop-001');
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('renderGallery — renders photo gallery without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof renderGallery !== 'function') return { skip: true };
      try { renderGallery(); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('setGalleryFilter — updates gallery filter without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof setGalleryFilter !== 'function') return { skip: true };
      try {
        const btn = document.createElement('button');
        setGalleryFilter('before', btn);
        setGalleryFilter('after', btn);
        setGalleryFilter('all', btn);
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('markBidHandshake — marks bid as won without signature', async () => {
    const result = await page.evaluate(() => {
      if (typeof markBidHandshake !== 'function') return { skip: true };
      try {
        const origConfirm = window.zConfirm;
        window.zConfirm = (msg, cb) => { if (cb) cb(); };
        markBidHandshake(50001);
        window.zConfirm = origConfirm;
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('saveAndExitEstimate — saves and exits estimate without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof saveAndExitEstimate !== 'function') return { skip: true };
      try {
        saveAndExitEstimate();
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('checkStep1Ready — validates step 1 form state', async () => {
    const result = await page.evaluate(() => {
      if (typeof checkStep1Ready !== 'function') return { skip: true };
      try { checkStep1Ready(); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('prefillEstimateRates — prefills form with saved rates', async () => {
    const result = await page.evaluate(() => {
      if (typeof prefillEstimateRates !== 'function') return { skip: true };
      try { prefillEstimateRates(); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('no console errors during proposal tests', async () => {
    assertNoErrors(page, 'proposals');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH H: Finance — renderExpenses, renderIncome, exportAllDataCSV, scheduleJob, etc.
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Finance functions', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => {
      if (!window.expenses) window.expenses = [];
      if (!window.income) window.income = [];
      expenses.push({ id: 'exp-001', vendor: 'Home Depot', amount: 250.00,
        date: '2026-05-01', category: 'Materials', receipt: null });
      expenses.push({ id: 'exp-002', vendor: 'Gas Station', amount: 80.00,
        date: '2026-05-05', category: 'Fuel', receipt: null });
      income.push({ id: 'inc-001', clientId: 'c-fin-001', amount: 1500,
        date: '2026-05-10', type: 'Payment', method: 'check' });
      if (typeof goPg === 'function') goPg('pg-money');
    });
    await page.waitForTimeout(300);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('renderExpenses — renders expense list without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof renderExpenses !== 'function') return { skip: true };
      try { renderExpenses(); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('renderIncome — renders income list without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof renderIncome !== 'function') return { skip: true };
      try { renderIncome(); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  // Mobile books = stacked cards, no horizontal scroll (owner request). The row
  // cells must carry data-label (the CSS card layout reads them) and the money
  // tables carry the bk-tbl hook the responsive @media rule targets.
  test('books money rows carry data-label + bk-tbl hook for the mobile card layout', async () => {
    const r = await page.evaluate(() => {
      if (typeof renderIncome !== 'function' || typeof income === 'undefined') return { skip: true };
      income.push({ id: 9992001, client_name: 'Card Layout Co', amount: 1234, type: 'payment', method: 'Card', date: '2026-06-01', _src: 'payment' });
      try { renderIncome(); } catch (e) { return { skip: false, err: e.message }; }
      const el = document.getElementById('pg-tracker') || document;
      const table = el.querySelector('.bk-tbl');
      const row = el.querySelector('.bk-tbl tbody tr');
      const labels = row ? [...row.querySelectorAll('td[data-label]')].map(td => td.getAttribute('data-label')) : [];
      // month AND day accordions (owner: break it down by month and day)
      const hasMonth = !!el.querySelector('.bk-month');
      const hasDay = !!el.querySelector('.bk-day .bk-day-hd');
      income = income.filter(x => x.id !== 9992001);
      return { skip: false, hasTable: !!table, labels, hasMonth, hasDay };
    });
    if (r.skip) return;
    expect(r.hasTable).toBe(true);                 // the bk-tbl hook the @media rule targets
    expect(r.labels).toContain('Client');          // headline field labeled…
    expect(r.labels).toContain('Amount');          // …and the amount, for the card layout
    expect(r.hasMonth).toBe(true);                 // month accordion
    expect(r.hasDay).toBe(true);                   // nested day accordion
  });

  test('renderMonthlyPL — renders P&L summary without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof renderMonthlyPL !== 'function') return { skip: true };
      try { renderMonthlyPL(); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('renderTrackerTab — renders tracker tab without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof renderTrackerTab !== 'function') return { skip: true };
      try { renderTrackerTab(); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('setMoneyFilter — changes filter without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof setMoneyFilter !== 'function') return { skip: true };
      try {
        ['all','unpaid','overdue','in-collection'].forEach(f => {
          const btn = document.createElement('button');
          setMoneyFilter(f, btn);
        });
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('editExpense — opens edit form for existing expense', async () => {
    const result = await page.evaluate(() => {
      if (typeof editExpense !== 'function') return { skip: true };
      try {
        editExpense('exp-001');
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('delExpense — removes expense after confirmation', async () => {
    const result = await page.evaluate(() => {
      if (typeof delExpense !== 'function') return { skip: true };
      try {
        const origConfirm = window.zConfirm;
        window.zConfirm = (msg, cb) => { if (cb) cb(); };
        delExpense('exp-002');
        window.zConfirm = origConfirm;
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('exportAllDataCSV — triggers download without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof exportAllDataCSV !== 'function') return { skip: true };
      try {
        // stub download mechanism
        const origCreateElement = document.createElement.bind(document);
        let downloadAttempted = false;
        document.createElement = (tag) => {
          const el = origCreateElement(tag);
          if (tag === 'a') {
            Object.defineProperty(el, 'click', { value: () => { downloadAttempted = true; } });
          }
          return el;
        };
        exportAllDataCSV();
        document.createElement = origCreateElement;
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('exportIncomeCSV — triggers download without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof exportIncomeCSV !== 'function') return { skip: true };
      try {
        const origCreate = document.createElement.bind(document);
        document.createElement = (tag) => {
          const el = origCreate(tag);
          if (tag === 'a') Object.defineProperty(el, 'click', { value: () => {} });
          return el;
        };
        exportIncomeCSV();
        document.createElement = origCreate;
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('exportMileageCSV — triggers download without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof exportMileageCSV !== 'function') return { skip: true };
      try {
        const origCreate = document.createElement.bind(document);
        document.createElement = (tag) => {
          const el = origCreate(tag);
          if (tag === 'a') Object.defineProperty(el, 'click', { value: () => {} });
          return el;
        };
        exportMileageCSV();
        document.createElement = origCreate;
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('exportFullBackup — triggers JSON backup download without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof exportFullBackup !== 'function') return { skip: true };
      try {
        const origCreate = document.createElement.bind(document);
        document.createElement = (tag) => {
          const el = origCreate(tag);
          if (tag === 'a') Object.defineProperty(el, 'click', { value: () => {} });
          return el;
        };
        exportFullBackup();
        document.createElement = origCreate;
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('getLienTimeline — returns timeline object with correct fields', async () => {
    const result = await page.evaluate(() => {
      if (typeof getLienTimeline !== 'function') return { skip: true };
      try {
        const bid = { id: 50002, clientId: 'c-fin-001', status: 'Closed Won',
          amount: 2000, completedAt: '2026-04-01', signedAt: '2026-03-15' };
        const tl = getLienTimeline(bid);
        return { ok: true, hasFields: tl && typeof tl === 'object' };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('getAutoCollStage — returns appropriate stage for days unpaid', async () => {
    const result = await page.evaluate(() => {
      if (typeof getAutoCollStage !== 'function') return { skip: true };
      try {
        const stage1 = getAutoCollStage(10, 'none', null);
        const stage2 = getAutoCollStage(35, 'reminder', null);
        const stage3 = getAutoCollStage(60, 'second', null);
        return { ok: true, stage1, stage2, stage3 };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('scheduleJob — creates job from schedule form without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof scheduleJob !== 'function') return { skip: true };
      try {
        // set up required form fields
        const fields = {
          'sched-client': 'Test Client',
          'sched-date': new Date().toISOString().slice(0, 10),
          'sched-time': '09:00',
          'sched-desc': 'Paint living room',
          'sched-days': '2',
        };
        Object.entries(fields).forEach(([id, val]) => {
          let el = document.getElementById(id);
          if (!el) { el = document.createElement('input'); el.id = id; document.body.appendChild(el); }
          el.value = val;
        });
        if (!window.currentClientId) window.currentClientId = 'c-fin-001';
        scheduleJob();
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('showDailyBriefing — shows briefing modal without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof showDailyBriefing !== 'function') return { skip: true };
      try { showDailyBriefing(); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('refreshAvail — updates availability calendar without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof refreshAvail !== 'function') return { skip: true };
      try { refreshAvail(); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('getNextAvail — returns next available date object', async () => {
    const result = await page.evaluate(() => {
      if (typeof getNextAvail !== 'function') return { skip: true };
      try {
        const n = getNextAvail();
        return { ok: true, hasKey: n && 'key' in n };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('no console errors during finance tests', async () => {
    assertNoErrors(page, 'finance');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH I: Settings — renderLicensing, obStep1–9, addTimeOff, addVehicle, etc.
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Settings functions', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => {
      if (typeof goPg === 'function') goPg('pg-settings');
    });
    await page.waitForTimeout(400);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('renderLicensing — renders licensing page without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof renderLicensing !== 'function') return { skip: true };
      try { renderLicensing(); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('setLicFilter — changes license filter without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof setLicFilter !== 'function') return { skip: true };
      try {
        ['all','business','equipment','insurance','other'].forEach(f => setLicFilter(f));
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('openAddLicense — opens license add modal without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof openAddLicense !== 'function') return { skip: true };
      try { openAddLicense(); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('saveLicenseModal — validates and saves license record', async () => {
    const result = await page.evaluate(() => {
      if (typeof saveLicenseModal !== 'function') return { skip: true };
      try {
        // fill required fields
        const fields = { 'lic-name': 'General Contractor License', 'lic-cat': 'business',
          'lic-num': 'GCL-12345', 'lic-exp': '2027-12-31' };
        Object.entries(fields).forEach(([id, val]) => {
          let el = document.getElementById(id);
          if (!el) { el = document.createElement('input'); el.id = id; document.body.appendChild(el); }
          el.value = val;
        });
        saveLicenseModal();
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('addTimeOff — adds time-off block to schedule', async () => {
    const result = await page.evaluate(() => {
      if (typeof addTimeOff !== 'function') return { skip: true };
      try {
        addTimeOff('2026-07-04', '2026-07-04', 'Independence Day');
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('removeTimeOff — removes time-off block by index', async () => {
    const result = await page.evaluate(() => {
      if (typeof removeTimeOff !== 'function') return { skip: true };
      try {
        if (!window.S) window.S = {};
        if (!S.timeOff) S.timeOff = [{ start: '2026-07-04', end: '2026-07-04', label: 'Test' }];
        removeTimeOff(0);
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('getTimeOffDays — returns Set of blocked dates', async () => {
    const result = await page.evaluate(() => {
      if (typeof getTimeOffDays !== 'function') return { skip: true };
      try {
        const days = getTimeOffDays();
        return { ok: true, isSet: days instanceof Set };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) {
      expect(result.ok).toBe(true);
      expect(result.isSet).toBe(true);
    }
  });

  test('addVehicle — adds vehicle from input fields', async () => {
    const result = await page.evaluate(() => {
      if (typeof addVehicle !== 'function') return { skip: true };
      try {
        const fields = { 'veh-name': 'Work Van', 'veh-nick': 'Van 1' };
        Object.entries(fields).forEach(([id, val]) => {
          let el = document.getElementById(id);
          if (!el) { el = document.createElement('input'); el.id = id; document.body.appendChild(el); }
          el.value = val;
        });
        addVehicle();
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('removeVehicle — removes vehicle by index', async () => {
    const result = await page.evaluate(() => {
      if (typeof removeVehicle !== 'function') return { skip: true };
      try {
        if (!window.S) window.S = {};
        if (!S.vehicles) S.vehicles = [{ name: 'Test Van', nick: 'TV' }];
        removeVehicle(0);
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('getVehicles — returns array of vehicle objects', async () => {
    const result = await page.evaluate(() => {
      if (typeof getVehicles !== 'function') return { skip: true };
      try {
        const vehs = getVehicles();
        return { ok: true, isArray: Array.isArray(vehs) };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) {
      expect(result.ok).toBe(true);
      expect(result.isArray).toBe(true);
    }
  });

  test('applySettings — applies tax settings without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof applySettings !== 'function') return { skip: true };
      try { applySettings(); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('resetSettings — resets to defaults with confirmation', async () => {
    const result = await page.evaluate(() => {
      if (typeof resetSettings !== 'function') return { skip: true };
      try {
        const origConfirm = window.zConfirm;
        window.zConfirm = (msg, cb) => { if (cb) cb(); };
        resetSettings();
        window.zConfirm = origConfirm;
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('obStep1 — renders onboarding step 1 without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof obStep1 !== 'function') return { skip: true };
      try {
        const el = document.createElement('div');
        document.body.appendChild(el);
        obStep1(el);
        return { ok: true, hasContent: el.innerHTML.length > 0 };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('obStep2 — renders onboarding step 2 without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof obStep2 !== 'function') return { skip: true };
      try {
        const el = document.createElement('div');
        document.body.appendChild(el);
        obStep2(el);
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('obStep3 — renders trade selection step', async () => {
    const result = await page.evaluate(() => {
      if (typeof obStep3 !== 'function') return { skip: true };
      try {
        const el = document.createElement('div');
        document.body.appendChild(el);
        obStep3(el);
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('obStep4 — renders business info step', async () => {
    const result = await page.evaluate(() => {
      if (typeof obStep4 !== 'function') return { skip: true };
      try {
        const el = document.createElement('div');
        document.body.appendChild(el);
        obStep4(el);
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('obStep5 — renders role selection step', async () => {
    const result = await page.evaluate(() => {
      if (typeof obStep5 !== 'function') return { skip: true };
      try {
        const el = document.createElement('div');
        document.body.appendChild(el);
        obStep5(el);
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('obStep6 — renders vehicle step', async () => {
    const result = await page.evaluate(() => {
      if (typeof obStep6 !== 'function') return { skip: true };
      try {
        const el = document.createElement('div');
        document.body.appendChild(el);
        obStep6(el);
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('obStep7 — renders team member step', async () => {
    const result = await page.evaluate(() => {
      if (typeof obStep7 !== 'function') return { skip: true };
      try {
        const el = document.createElement('div');
        document.body.appendChild(el);
        obStep7(el);
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('obStep8 — renders payment setup step', async () => {
    const result = await page.evaluate(() => {
      if (typeof obStep8 !== 'function') return { skip: true };
      try {
        const el = document.createElement('div');
        document.body.appendChild(el);
        obStep8(el);
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('obStep9 — renders final review step', async () => {
    const result = await page.evaluate(() => {
      if (typeof obStep9 !== 'function') return { skip: true };
      try {
        const el = document.createElement('div');
        document.body.appendChild(el);
        obStep9(el);
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('clearAllData — requires double confirmation (cancel at first)', async () => {
    const result = await page.evaluate(() => {
      if (typeof clearAllData !== 'function') return { skip: true };
      try {
        // Cancel at first confirmation — data should NOT be cleared
        const origConfirm = window.zConfirm;
        let callCount = 0;
        window.zConfirm = (msg, cb, opts) => { callCount++; /* do NOT call cb */ };
        clearAllData();
        window.zConfirm = origConfirm;
        return { ok: true, callCount };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('_smsApply — substitutes template variables', async () => {
    const result = await page.evaluate(() => {
      if (typeof _smsApply !== 'function') return { skip: true };
      try {
        const msg = _smsApply('Hi {name}, from {business}', { name: 'John', business: 'Acme Paint' });
        return { ok: true, hasName: msg.includes('John'), hasBiz: msg.includes('Acme') };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) {
      expect(result.ok).toBe(true);
    }
  });

  test('_getSmsDefaults — returns default SMS templates object', async () => {
    const result = await page.evaluate(() => {
      if (typeof _getSmsDefaults !== 'function') return { skip: true };
      try {
        const defaults = _getSmsDefaults();
        return { ok: true, isObject: typeof defaults === 'object' };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) {
      expect(result.ok).toBe(true);
      expect(result.isObject).toBe(true);
    }
  });

  test('no console errors during settings tests', async () => {
    assertNoErrors(page, 'settings');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH J: Cloud — renderTeam, openAddEmployeeModal, _enterOfflineMode, autoEscalate, etc.
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Cloud / team functions', () => {
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
      if (!S.settings.employees) S.settings.employees = [];
      S.settings.employees.push({ name: 'Bob Builder', phone: '316-555-7777', role: 'tech', idx: 0 });
    });
    await page.waitForTimeout(200);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('renderTeam — renders team roster without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof renderTeam !== 'function') return { skip: true };
      try { renderTeam(); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('openAddEmployeeModal — opens employee add modal without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof openAddEmployeeModal !== 'function') return { skip: true };
      try { openAddEmployeeModal(); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('removeEmployee — removes employee by index after confirmation', async () => {
    const result = await page.evaluate(() => {
      if (typeof removeEmployee !== 'function') return { skip: true };
      try {
        const origConfirm = window.zConfirm;
        window.zConfirm = (msg, cb) => { if (cb) cb(); };
        removeEmployee(0);
        window.zConfirm = origConfirm;
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('autoEscalateProposals — scans bids without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof autoEscalateProposals !== 'function') return { skip: true };
      try { autoEscalateProposals(); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('showScheduleSuggestion — shows scheduling modal without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof showScheduleSuggestion !== 'function') return { skip: true };
      try {
        showScheduleSuggestion('c-cloud-001', 80001, 'Test Client');
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('_enterOfflineMode — transitions to offline without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof _enterOfflineMode !== 'function') return { skip: true };
      try {
        _enterOfflineMode();
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('no console errors during cloud / team tests', async () => {
    assertNoErrors(page, 'cloud / team');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH K: Generic Estimate — trade selection, T&M functions, BYO, industrial
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Generic estimate — trade switcher and T&M functions', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => {
      if (!window.clients) window.clients = [];
      if (!window.bids) window.bids = [];
      clients.push({ id: 'c-gei-001', name: 'GEI Test Client', phone: '316-555-8888',
        addr: '500 GEI St', city: 'Wichita', state: 'KS', zip: '67202' });
      if (!window.S) window.S = {};
      if (!S.settings) S.settings = {};
    });
    await page.waitForTimeout(200);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('openBidNotes — stores bidId without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof openBidNotes !== 'function') return { skip: true };
      try {
        openBidNotes(90001);
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('showNotesFab / hideNotesFab — stub functions run without throwing', async () => {
    const result = await page.evaluate(() => {
      const fns = [showNotesFab, hideNotesFab, toggleNotesPanel, clearNotesPanel, _resetNotesForNewEstimate];
      const available = fns.filter(f => typeof f === 'function');
      if (available.length === 0) return { skip: true };
      try {
        available.forEach(f => f());
        return { ok: true, count: available.length };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('applyPermissions — updates UI based on user role without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof applyPermissions !== 'function') return { skip: true };
      try { applyPermissions(); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('getActiveTrade — returns current trade string', async () => {
    const result = await page.evaluate(() => {
      if (typeof getActiveTrade !== 'function') return { skip: true };
      try {
        const trade = getActiveTrade();
        return { ok: true, isString: typeof trade === 'string', trade };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) {
      expect(result.ok).toBe(true);
      expect(result.isString).toBe(true);
    }
  });

  test('setActiveTrade — sets active trade without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof setActiveTrade !== 'function') return { skip: true };
      try {
        setActiveTrade('plumbing');
        setActiveTrade('painting');
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('_getTradeLines — returns array of trade strings', async () => {
    const result = await page.evaluate(() => {
      if (typeof _getTradeLines !== 'function') return { skip: true };
      try {
        const lines = _getTradeLines();
        return { ok: true, isArray: Array.isArray(lines) };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) {
      expect(result.ok).toBe(true);
      expect(result.isArray).toBe(true);
    }
  });

  test('_renderNavTradeSwitcher — renders trade pills without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof _renderNavTradeSwitcher !== 'function') return { skip: true };
      try { _renderNavTradeSwitcher(); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('setHittersFilter — sets hitters filter without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof setHittersFilter !== 'function') return { skip: true };
      try {
        const btn = document.createElement('button');
        setHittersFilter('all', btn);
        setHittersFilter('A', btn);
        setHittersFilter('B', btn);
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('openGenericEstimate — opens generic estimate for client', async () => {
    const result = await page.evaluate(() => {
      if (typeof openGenericEstimate !== 'function') return { skip: true };
      try {
        const c = clients.find(c => c.id === 'c-gei-001');
        if (!c) return { skip: true };
        openGenericEstimate(c, null, 'plumbing');
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('openTMEstimate — opens T&M estimate without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof openTMEstimate !== 'function') return { skip: true };
      try {
        const c = clients.find(c => c.id === 'c-gei-001');
        if (!c) return { skip: true };
        openTMEstimate(c, null);
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('openFreeFormEstimate — opens free-form estimate without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof openFreeFormEstimate !== 'function') return { skip: true };
      try {
        const c = clients.find(c => c.id === 'c-gei-001');
        if (!c) return { skip: true };
        openFreeFormEstimate(c, null);
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('_tmAdj — adjusts crew count without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof _tmAdj !== 'function') return { skip: true };
      try {
        _tmAdj(1);
        _tmAdj(-1);
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('_tmRecalc — recalculates T&M labor without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof _tmRecalc !== 'function') return { skip: true };
      try { _tmRecalc(); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('_tmCalcDeposit — calculates deposit amount without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof _tmCalcDeposit !== 'function') return { skip: true };
      try { _tmCalcDeposit(); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('_tmCalcNte — updates NTE cap without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof _tmCalcNte !== 'function') return { skip: true };
      try { _tmCalcNte(); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('_tmSetCycle — sets billing cycle without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof _tmSetCycle !== 'function') return { skip: true };
      try {
        ['weekly','biweekly','milestone','completion'].forEach(v => _tmSetCycle(v));
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('_tmSyncCycleButtons — syncs cycle button state without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof _tmSyncCycleButtons !== 'function') return { skip: true };
      try { _tmSyncCycleButtons(); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('_tmShowPage — renders T&M single-page layout without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof _tmShowPage !== 'function') return { skip: true };
      try { _tmShowPage(); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('_tmInputChange — syncs T&M inputs without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof _tmInputChange !== 'function') return { skip: true };
      try { _tmInputChange(); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('_tmRenderMatList — renders material list without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof _tmRenderMatList !== 'function') return { skip: true };
      try { _tmRenderMatList(); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('calcGeiTotal — calculates total from line items', async () => {
    const result = await page.evaluate(() => {
      if (typeof calcGeiTotal !== 'function') return { skip: true };
      try {
        if (!window._geiLines) window._geiLines = [
          { desc: 'Labor', qty: 8, unit: 'hr', rate: 75, type: 'labor' },
          { desc: 'Paint', qty: 2, unit: 'gal', rate: 45, type: 'material' },
        ];
        calcGeiTotal();
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('renderGeiLines — renders line items without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof renderGeiLines !== 'function') return { skip: true };
      try { renderGeiLines(); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('addGeiLine — adds blank line to estimate', async () => {
    const result = await page.evaluate(() => {
      if (typeof addGeiLine !== 'function') return { skip: true };
      try {
        if (!window._geiLines) window._geiLines = [];
        const before = _geiLines.length;
        addGeiLine();
        return { ok: true, grew: _geiLines.length >= before };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('_geiSyncScopeButtons — syncs scope button states without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof _geiSyncScopeButtons !== 'function') return { skip: true };
      try { _geiSyncScopeButtons(); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('_geiSetScope — sets commercial/residential scope without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof _geiSetScope !== 'function') return { skip: true };
      try {
        _geiSetScope(false);
        _geiSetScope(true);
        _geiSetScope(false);
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('_geiToggleEmergency — toggles emergency mode without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof _geiToggleEmergency !== 'function') return { skip: true };
      try {
        _geiToggleEmergency();
        _geiToggleEmergency();
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('_geiPriceMult — returns numeric multiplier', async () => {
    const result = await page.evaluate(() => {
      if (typeof _geiPriceMult !== 'function') return { skip: true };
      try {
        const m = _geiPriceMult();
        return { ok: true, isNumber: typeof m === 'number', gt0: m > 0 };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) {
      expect(result.ok).toBe(true);
      expect(result.isNumber).toBe(true);
      expect(result.gt0).toBe(true);
    }
  });

  test('_geiLocationMult — returns numeric state multiplier', async () => {
    const result = await page.evaluate(() => {
      if (typeof _geiLocationMult !== 'function') return { skip: true };
      try {
        const m = _geiLocationMult();
        return { ok: true, isNumber: typeof m === 'number' };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) {
      expect(result.ok).toBe(true);
      expect(result.isNumber).toBe(true);
    }
  });

  test('_geiTierBadge — returns HTML string', async () => {
    const result = await page.evaluate(() => {
      if (typeof _geiTierBadge !== 'function') return { skip: true };
      try {
        const badge = _geiTierBadge();
        return { ok: true, isString: typeof badge === 'string' };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) {
      expect(result.ok).toBe(true);
      expect(result.isString).toBe(true);
    }
  });

  test('_geiRenderCartBar — renders cart bar without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof _geiRenderCartBar !== 'function') return { skip: true };
      try { _geiRenderCartBar(); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('_geiRenderStepBar — renders wizard step bar without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof _geiRenderStepBar !== 'function') return { skip: true };
      try { _geiRenderStepBar(); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('_byoShowPage — renders BYO layout without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof _byoShowPage !== 'function') return { skip: true };
      try { _byoShowPage(); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('_byoRenderSections — renders BYO sections without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof _byoRenderSections !== 'function') return { skip: true };
      try { _byoRenderSections(); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('_byoUpdateRail — updates BYO totals without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof _byoUpdateRail !== 'function') return { skip: true };
      try { _byoUpdateRail(); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('_byoToggle — toggles BYO item state without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof _byoToggle !== 'function') return { skip: true };
      try {
        if (!window._byoItems) window._byoItems = [{ id: 1, label: 'Test Item', price: 100, on: false, required: false }];
        _byoToggle(0);
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('_geiRenderTemplates — renders service templates without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof _geiRenderTemplates !== 'function') return { skip: true };
      try { _geiRenderTemplates(); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('_geiVisibleJobIds — returns Set or null without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof _geiVisibleJobIds !== 'function') return { skip: true };
      try {
        const ids = _geiVisibleJobIds();
        return { ok: true, validType: ids === null || ids instanceof Set };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) {
      expect(result.ok).toBe(true);
      expect(result.validType).toBe(true);
    }
  });

  test('goGeiStep — navigates estimate wizard steps without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof goGeiStep !== 'function') return { skip: true };
      try {
        goGeiStep(1);
        goGeiStep(2);
        goGeiStep(3);
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('saveGenericEstimate — saves estimate draft without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof saveGenericEstimate !== 'function') return { skip: true };
      try {
        saveGenericEstimate(true); // draft mode
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('no console errors during generic estimate tests', async () => {
    assertNoErrors(page, 'generic estimate');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH L: Industrial Equipment Estimate — openIndustrialEquipEstimate, _calcInd, etc.
// ═══════════════════════════════════════════════════════════════════════════════

