// @ts-check
/**
 * Regression guards for four reported bugs (the §14 self-heal "this can never
 * come back" tests). Each maps to a root-cause fix:
 *
 *  BUG 1a — Monthly goal didn't persist on reboot.
 *           Root cause: the goal-prompt setter called bare saveAll() without
 *           bumping S.settingsTs, so a cloud settings row carrying goalMonthly:0
 *           at an equal/higher settingsTs overwrote the goal back to 0 in
 *           _mergeIncomingSettings on the next boot.
 *           Fix: goal-prompt setter bumps settingsTs (dashboard.js).
 *
 *  BUG 1b — Location permission didn't persist on reboot.
 *           Root cause: locationGranted/locationDenied were stripped from the
 *           cloud payload (cloud.js supaSaveToCloud), and the grant/deny write
 *           paths didn't bump settingsTs. A cloud-authoritative reload then had
 *           no location state to restore.
 *           Fix: stop stripping the flags + bump settingsTs on grant/deny.
 *
 *  BUG 2  — Make Money Today action buttons were different sizes (label-driven
 *           width). Fix: .tf-acts>.btn CSS makes every button flex:1 1 0 so all
 *           buttons in a row are identical width regardless of label length.
 *
 *  BUG 3  — MMT collapsible sections did not default to closed. Root cause:
 *           _sec() passed defaultOpen=true for dep-sched & collect, force-setting
 *           _mmtCol_<id>=false on first render. Fix: removed defaultOpen; every
 *           section defaults collapsed (undefined !== false ⇒ collapsed).
 *           (2026-07-10: 'dep-sched' merged away — deposits owed now live in the
 *           'collect' section and deposit-paid unscheduled bids in 'schedule'.
 *           The default-collapsed guard now covers those ids.)
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('MMT + persistence regressions', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForAppBoot(page);
    await page.evaluate(() => {
      if (typeof checkFridaySummary === 'function') window.checkFridaySummary = () => {};
      document.querySelectorAll('.zmodal-overlay').forEach(el => el.remove());
    });
  });

  test.afterAll(async () => { await page.context().close(); });

  // ── BUG 3: sections default CLOSED ──────────────────────────────────────────

  test('BUG3: Collect & Schedule sections default collapsed on first render', async () => {
    const r = await page.evaluate(() => {
      // Simulate a fresh boot: no _mmtCol_ state has been touched by the user.
      ['build', 'pending', 'schedule', 'collect'].forEach(id => delete window['_mmtCol_' + id]);
      const cid = 990101, bidCollect = 990102, bidDep = 990103;
      clients.unshift({ id: cid, name: 'DefClosed Collect', phone: '3165550000' });
      // Collect section: Closed Won, completed, balance owed.
      bids.unshift({ id: bidCollect, client_id: cid, client_name: 'DefClosed Collect', amount: 5000,
        status: 'Closed Won', draft: false, completion_date: '2026-01-01', bid_date: '2025-12-01', surfaces: [] });
      // Deposit owed (Closed Won, not completed, deposit required & unpaid) — since the
      // 2026-07-10 merge this ALSO lives in the Collect section (one money queue).
      bids.unshift({ id: bidDep, client_id: cid, client_name: 'DefClosed Dep', amount: 8000, deposit: 2000,
        status: 'Closed Won', draft: false, bid_date: '2025-12-05', surfaces: [] });
      let err = '';
      try { renderTodayFeed(); } catch (e) { err = e.message; }
      const el = document.getElementById('dash-money-feed');
      const html = el ? el.innerHTML : '';
      const res = {
        err,
        // The fix must NOT auto-set these to false (expanded).
        collectForcedOpen: window['_mmtCol_collect'] === false,
        schedForcedOpen: window['_mmtCol_schedule'] === false,
        // Section headers render…
        hasCollectHdr: html.includes('Collect') && html.includes('mmt-sec'),
        // …but the card bodies are NOT in the HTML while collapsed.
        collectBodyHidden: !html.includes('DefClosed Collect'),
        depBodyHidden: !html.includes('DefClosed Dep'),
        // The old split section is GONE (§7.1 deletion assertion).
        oldDepSchedGone: !html.includes('Deposit & Schedule'),
        // Collapsed chevron present, expanded chevron absent for these sections.
        hasCollapsedChevron: html.includes('›'),
      };
      bids = bids.filter(b => b.id !== bidCollect && b.id !== bidDep);
      clients = clients.filter(c => c.id !== cid);
      ['build', 'pending', 'schedule', 'collect'].forEach(id => delete window['_mmtCol_' + id]);
      try { renderTodayFeed(); } catch (e) {}
      return res;
    });
    expect(r.err, `renderTodayFeed threw: ${r.err}`).toBe('');
    expect(r.collectForcedOpen, 'Collect section must NOT be force-expanded on first render').toBe(false);
    expect(r.schedForcedOpen, 'Schedule section must NOT be force-expanded on first render').toBe(false);
    expect(r.collectBodyHidden, 'Collect card body must be hidden (section collapsed by default)').toBe(true);
    expect(r.depBodyHidden, 'Deposit card body must be hidden (section collapsed by default)').toBe(true);
    expect(r.oldDepSchedGone, 'the retired "Deposit & Schedule" section must not render').toBe(true);
    expect(r.hasCollapsedChevron, 'Collapsed sections must show the › chevron').toBe(true);
  });

  test('Collect is ONE money queue: deposit-due AND balance-due cards render under it', async () => {
    // Owner decision 2026-07-10: "Collect = all things collecting dollars." A deposit
    // not yet collected and a completed job's unpaid balance land in the SAME section;
    // a deposit-paid unscheduled job goes to 'Schedule' (that's a task, not money).
    const r = await page.evaluate(() => {
      window._mmtCol_collect = false;   // expand Collect so its cards render (§11.6)
      window._mmtCol_schedule = false;  // expand Schedule too
      const cid = 990501;
      clients.unshift({ id: cid, name: 'OneQueue Cust', phone: '3165553333' });
      // balance-due: completed, owed in full
      bids.unshift({ id: 990502, client_id: cid, client_name: 'OneQueue Cust', amount: 5000,
        status: 'Closed Won', draft: false, completion_date: '2026-01-01', bid_date: '2025-12-01', surfaces: [] });
      // deposit-due: not completed, deposit required & unpaid
      bids.unshift({ id: 990503, client_id: cid, client_name: 'OneQueue Dep', amount: 8000, deposit: 2000,
        status: 'Closed Won', draft: false, bid_date: '2025-12-05', surfaces: [] });
      // deposit PAID, no job yet → Schedule section, NOT Collect
      bids.unshift({ id: 990504, client_id: cid, client_name: 'OneQueue Sched', amount: 3000, deposit: 0,
        status: 'Closed Won', draft: false, bid_date: '2025-12-06', surfaces: [] });
      let err = '';
      try { renderTodayFeed(); } catch (e) { err = e.message; }
      const html = document.getElementById('dash-money-feed')?.innerHTML || '';
      // Slice the feed into its sections by header to test WHERE each card landed.
      const collectStart = html.indexOf("_mmtToggle('collect')");
      const schedStart = html.indexOf("_mmtToggle('schedule')");
      const collectHtml = collectStart >= 0 ? html.slice(collectStart) : '';
      const schedHtml = (schedStart >= 0 && collectStart > schedStart) ? html.slice(schedStart, collectStart) : '';
      const res = {
        err,
        collectHasBalance: collectHtml.includes('owed · '),          // balance-due card
        collectHasDeposit: collectHtml.includes('Deposit required before scheduling'),
        collectHasDepositBtn: collectHtml.includes("openPayPanel(990503,'deposit')"),
        schedHasCard: schedHtml.includes('deposit paid · not yet scheduled'),
        schedCardNotInCollect: !collectHtml.includes('deposit paid · not yet scheduled'),
      };
      bids = bids.filter(b => ![990502, 990503, 990504].includes(b.id));
      clients = clients.filter(c => c.id !== cid);
      ['schedule', 'collect'].forEach(id => delete window['_mmtCol_' + id]);
      try { renderTodayFeed(); } catch (e) {}
      return res;
    });
    expect(r.err, `renderTodayFeed threw: ${r.err}`).toBe('');
    expect(r.collectHasBalance, 'completed-job balance card must render under Collect').toBe(true);
    expect(r.collectHasDeposit, 'deposit-due card must render under Collect (the merge)').toBe(true);
    expect(r.collectHasDepositBtn, 'deposit card keeps its Deposit action wired to openPayPanel').toBe(true);
    expect(r.schedHasCard, 'deposit-paid unscheduled bid renders under Schedule').toBe(true);
    expect(r.schedCardNotInCollect, 'schedule card must NOT duplicate into Collect').toBe(true);
  });

  test('BUG3: tapping a section header expands it (toggle still works)', async () => {
    const r = await page.evaluate(() => {
      delete window['_mmtCol_collect'];
      const cid = 990201, bidId = 990202;
      clients.unshift({ id: cid, name: 'ToggleOpen Cust', phone: '3165551111' });
      bids.unshift({ id: bidId, client_id: cid, client_name: 'ToggleOpen Cust', amount: 4000,
        status: 'Closed Won', draft: false, completion_date: '2026-01-01', bid_date: '2025-12-01', surfaces: [] });
      try {
        renderTodayFeed();
        const collapsed = !(document.getElementById('dash-money-feed').innerHTML.includes('ToggleOpen Cust'));
        _mmtToggle('collect');                // user taps the header
        const expanded = document.getElementById('dash-money-feed').innerHTML.includes('ToggleOpen Cust');
        return { ok: true, collapsed, expanded };
      } catch (e) { return { ok: false, err: e.message }; }
      finally {
        bids = bids.filter(b => b.id !== bidId);
        clients = clients.filter(c => c.id !== cid);
        delete window['_mmtCol_collect'];
        try { renderTodayFeed(); } catch (e) {}
      }
    });
    expect(r.ok, `threw: ${r.err}`).toBe(true);
    expect(r.collapsed, 'section starts collapsed').toBe(true);
    expect(r.expanded, 'tapping the header reveals the cards').toBe(true);
  });

  // ── BUG 2: every action button is the same width ────────────────────────────

  test('BUG2: feed action buttons render identical width regardless of label', async () => {
    const r = await page.evaluate(() => {
      window._mmtCol_pending = false; // expand Pending so the multi-button card lays out
      const cid = 990301, bidId = 990302;
      clients.unshift({ id: cid, name: 'BtnSize Cust', phone: '3165552222' });
      // Follow-up overdue card → Send (long), Call (short), Snooze 2d (med), Won ✓ (med).
      bids.unshift({ id: bidId, client_id: cid, client_name: 'BtnSize Cust', amount: 3000,
        status: 'Pending', draft: false, signingToken: null, followup: '2025-01-01',
        bid_date: '2024-12-01', surfaces: [] });
      let err = '';
      try { renderTodayFeed(); } catch (e) { err = e.message; }
      // Find the tf-acts row belonging to our card and measure each button's width.
      const feed = document.getElementById('dash-money-feed');
      let widths = [], labels = [];
      if (feed) {
        const cards = [...feed.querySelectorAll('.tf-card')];
        const card = cards.find(c => c.textContent.includes('BtnSize Cust'));
        if (card) {
          const acts = card.querySelector('.tf-acts');
          if (acts) {
            const btns = [...acts.children].filter(el => /^(BUTTON|A)$/.test(el.tagName));
            widths = btns.map(b => Math.round(b.getBoundingClientRect().width * 10) / 10);
            labels = btns.map(b => b.textContent.trim());
          }
        }
      }
      window._mmtCol_pending = false;
      bids = bids.filter(b => b.id !== bidId);
      clients = clients.filter(c => c.id !== cid);
      delete window._mmtCol_pending;
      try { renderTodayFeed(); } catch (e) {}
      return { err, widths, labels };
    });
    expect(r.err, `renderTodayFeed threw: ${r.err}`).toBe('');
    expect(r.widths.length, `expected multiple action buttons, got labels: ${r.labels.join('|')}`).toBeGreaterThanOrEqual(2);
    const min = Math.min(...r.widths), max = Math.max(...r.widths);
    // flex:1 1 0 distributes the row evenly — every button is the same width
    // (allow 1.5px for sub-pixel rounding) even though labels differ in length.
    expect(max - min, `buttons unequal width: ${r.labels.map((l, i) => l + '=' + r.widths[i] + 'px').join(', ')}`).toBeLessThanOrEqual(1.5);
  });

  // ── BUG 1a: goal persists across a reboot/merge ─────────────────────────────

  test('BUG1a: a freshly-set goal survives a stale cloud merge (goalMonthly:0)', async () => {
    const r = await page.evaluate(() => {
      const origGoal = S.goalMonthly, origTs = S.settingsTs;
      try {
        // Simulate the goal-prompt setter AFTER the fix: set goal + bump settingsTs.
        S.goalMonthly = 8000;
        S.settingsTs = Date.now();
        // The reboot brings down a stale cloud settings row that still has the goal
        // blanked (goalMonthly:0) at an OLDER timestamp. Local must win.
        const staleCloud = { goalMonthly: 0, settingsTs: S.settingsTs - 5000, bname: S.bname };
        const merged = _mergeIncomingSettings(staleCloud);
        return { ok: true, goalAfter: S.goalMonthly, mergedReturn: merged };
      } catch (e) { return { ok: false, err: e.message }; }
      finally { S.goalMonthly = origGoal; S.settingsTs = origTs; }
    });
    expect(r.ok, `threw: ${r.err}`).toBe(true);
    expect(r.goalAfter, 'goal must NOT be wiped to 0 by a stale cloud copy').toBe(8000);
  });

  test('BUG1a: goal written to localStorage is reloaded by loadAll', async () => {
    const r = await page.evaluate(() => {
      const origGoal = S.goalMonthly;
      try {
        S.goalMonthly = 12500;
        S.settingsTs = Date.now();
        try { localStorage.setItem('zp3_S', JSON.stringify(S)); } catch (e) {}
        S.goalMonthly = 0;       // wipe in-memory to prove loadAll restores it
        loadAll();
        return { ok: true, goalAfter: S.goalMonthly };
      } catch (e) { return { ok: false, err: e.message }; }
      finally { S.goalMonthly = origGoal; }
    });
    expect(r.ok, `threw: ${r.err}`).toBe(true);
    expect(r.goalAfter, 'loadAll must restore the persisted goal from localStorage').toBe(12500);
  });

  // ── BUG 1b: location permission persists across a reboot/merge ───────────────

  test('BUG1b: location-granted flag survives a cloud merge that omits it', async () => {
    const r = await page.evaluate(() => {
      const origG = S.locationGranted, origD = S.locationDenied, origTs = S.settingsTs;
      try {
        S.locationGranted = true; S.locationDenied = false;
        S.settingsTs = Date.now();
        // Old cloud copy (pre-fix style) has NO location keys at all. The spread
        // merge must PRESERVE the local granted flag (and never resurrect denied).
        const cloudNoLoc = { settingsTs: S.settingsTs - 1000, bname: S.bname };
        _mergeIncomingSettings(cloudNoLoc);
        return { ok: true, granted: S.locationGranted, denied: S.locationDenied };
      } catch (e) { return { ok: false, err: e.message }; }
      finally { S.locationGranted = origG; S.locationDenied = origD; S.settingsTs = origTs; }
    });
    expect(r.ok, `threw: ${r.err}`).toBe(true);
    expect(r.granted, 'locationGranted must survive a cloud merge that omits it').toBe(true);
    expect(r.denied, 'locationDenied must not be resurrected by the merge').toBeFalsy();
  });

  test('BUG1b: location flags are NOT stripped from the cloud settings payload', async () => {
    // Guards the supaSaveToCloud destructure: it must strip ONLY stateRates, never
    // the location flags (that strip was the persistence bug). We assert against the
    // shipped source so the strip can never silently return.
    const src = await page.evaluate(async () => {
      try {
        const res = await fetch('/js/cloud.js');
        return await res.text();
      } catch (e) { return ''; }
    });
    expect(src.length, 'could not read js/cloud.js').toBeGreaterThan(1000);
    // The save-payload destructure must not pull location flags out of S.
    expect(/const\s*\{\s*stateRates:[^}]*locationGranted/.test(src),
      'supaSaveToCloud must NOT strip locationGranted from the cloud payload').toBe(false);
    expect(/const\s*\{\s*stateRates:[^}]*locationDenied/.test(src),
      'supaSaveToCloud must NOT strip locationDenied from the cloud payload').toBe(false);
  });

  test('BUG1a: the REAL goal-prompt modal setter bumps settingsTs (pins the fix)', async () => {
    // Drives the actual checkGoalPrompt() modal end-to-end. This pins the
    // dashboard.js setter itself — a revert to bare saveAll() (no settingsTs bump)
    // fails here even though the merge-engine test above would still pass.
    const seed = await page.evaluate(() => {
      const origGoal = S.goalMonthly, origTs = S.settingsTs, origBids = [...bids], origPay = [...payments];
      S.goalMonthly = 0;
      window._goalPromptShown = false;
      window._goalPromptShownThisSession = false;
      // 5 paid (Closed Won, zero balance) jobs satisfy the milestone gate. Each bid
      // is fully paid via a matching payment so getBidBalance(b) <= 0.01.
      for (let i = 0; i < 5; i++) {
        const id = 990400 + i;
        clients.unshift({ id, name: 'GoalSeed ' + i });
        bids.unshift({ id, client_id: id, status: 'Closed Won', amount: 4000,
          completion_date: '2026-01-01', surfaces: [], draft: false });
        payments.unshift({ id: 991400 + i, bid_id: id, client_id: id, amount: 4000,
          type: 'final', method: 'cash', date: '2026-01-01' });
      }
      const tsBefore = S.settingsTs || 0;
      try { checkGoalPrompt(); } catch (e) { return { ok: false, err: e.message }; }
      window.__goalRestore = () => {
        S.goalMonthly = origGoal; S.settingsTs = origTs;
        bids.length = 0; origBids.forEach(b => bids.push(b));
        payments.length = 0; origPay.forEach(p => payments.push(p));
        clients = clients.filter(c => !(c.name || '').startsWith('GoalSeed '));
      };
      return { ok: true, tsBefore };
    });
    expect(seed.ok, `checkGoalPrompt threw: ${seed.err}`).toBe(true);

    // Modal appears via setTimeout(…, 800). Wait for the input, then drive it.
    await page.waitForSelector('#goal-prompt-input', { timeout: 4000 });
    const r = await page.evaluate((tsBefore) => {
      const inp = document.getElementById('goal-prompt-input');
      const setBtn = document.getElementById('goal-prompt-set');
      if (!inp || !setBtn) { window.__goalRestore && window.__goalRestore(); return { ok: false, err: 'modal controls missing' }; }
      inp.value = '9000';
      setBtn.click();
      const goal = S.goalMonthly, tsAfter = S.settingsTs || 0;
      document.querySelectorAll('.zmodal-overlay').forEach(el => el.remove());
      window.__goalRestore && window.__goalRestore();
      delete window.__goalRestore;
      return { ok: true, goal, tsAfter, bumped: tsAfter > tsBefore };
    }, seed.tsBefore);

    expect(r.ok, `interaction failed: ${r.err}`).toBe(true);
    expect(r.goal, 'goal-prompt must set goalMonthly').toBe(9000);
    expect(r.bumped, 'goal-prompt setter MUST bump settingsTs (else stale cloud wipes the goal on reboot)').toBe(true);
  });

  test('no console errors across the regression suite', async () => {
    assertNoErrors(page, 'mmt-persistence-regression');
  });
});
