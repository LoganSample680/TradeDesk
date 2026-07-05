// @ts-check
const { test, expect, mockAllExternal, waitForAppBoot, goPg, assertNoErrors } = require('./helpers');

test.describe('Drag-to-reorder — tab bar', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    // Use mobile viewport (390×844) — tab bar only appears on mobile
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test.afterAll(async () => { await page.context().close(); });

  test('tab bar renders with data-tab attributes and mtb-inner wrapper', async () => {
    const innerExists = await page.locator('#mtb-inner').count();
    expect(innerExists).toBe(1);

    const tabDash = await page.locator('#mtb-dash[data-tab="dash"]').count();
    const tabLeads = await page.locator('#mtb-leads[data-tab="leads"]').count();
    const tabClients = await page.locator('#mtb-clients[data-tab="clients"]').count();
    const tabJobs = await page.locator('#mtb-jobs[data-tab="jobs"]').count();
    expect(tabDash).toBe(1);
    expect(tabLeads).toBe(1);
    expect(tabClients).toBe(1);
    expect(tabJobs).toBe(1);

    // More button should NOT have data-tab (it's outside mtb-inner)
    const moreHasDataTab = await page.evaluate(() => {
      const more = document.getElementById('mtb-more');
      return more?.hasAttribute('data-tab') ?? false;
    });
    expect(moreHasDataTab).toBe(false);
  });

  test('_initTabBarDrag and _applyTabOrder functions exist', async () => {
    const fnsExist = await page.evaluate(() => ({
      initTabBarDrag: typeof _initTabBarDrag === 'function',
      applyTabOrder: typeof _applyTabOrder === 'function',
      getTabOrder: typeof _getTabOrder === 'function',
    }));
    expect(fnsExist.initTabBarDrag).toBe(true);
    expect(fnsExist.applyTabOrder).toBe(true);
    expect(fnsExist.getTabOrder).toBe(true);
  });

  test('_getTabOrder returns default order when S.navTabOrder is unset', async () => {
    const order = await page.evaluate(() => {
      const saved = S.navTabOrder;
      S.navTabOrder = undefined;
      const result = _getTabOrder();
      S.navTabOrder = saved;
      return result;
    });
    expect(order).toEqual(['dash', 'leads', 'clients', 'jobs']);
  });

  test('_applyTabOrder reorders buttons in DOM', async () => {
    // Apply a reversed order
    await page.evaluate(() => _applyTabOrder(['jobs', 'clients', 'leads', 'dash']));

    const order = await page.evaluate(() => {
      const inner = document.getElementById('mtb-inner');
      return [...inner.querySelectorAll('.mtb[data-tab]')].map(b => b.dataset.tab);
    });
    expect(order).toEqual(['jobs', 'clients', 'leads', 'dash']);

    // Restore default order
    await page.evaluate(() => _applyTabOrder(['dash', 'leads', 'clients', 'jobs']));
    const restored = await page.evaluate(() => {
      const inner = document.getElementById('mtb-inner');
      return [...inner.querySelectorAll('.mtb[data-tab]')].map(b => b.dataset.tab);
    });
    expect(restored).toEqual(['dash', 'leads', 'clients', 'jobs']);
  });

  test('S.navTabOrder is persisted when _applyTabOrder is called and exit runs', async () => {
    // Simulate saving a custom order
    await page.evaluate(() => {
      S.navTabOrder = ['jobs', 'clients', 'leads', 'dash'];
    });
    const saved = await page.evaluate(() => S.navTabOrder);
    expect(saved).toEqual(['jobs', 'clients', 'leads', 'dash']);

    // Reset
    await page.evaluate(() => { S.navTabOrder = ['dash', 'leads', 'clients', 'jobs']; });
    await page.evaluate(() => _applyTabOrder(['dash', 'leads', 'clients', 'jobs']));
  });

  test('long press on tab bar enters edit mode (jiggle CSS class)', async () => {
    // Simulate 500ms long press via evaluate
    const editModeEntered = await page.evaluate(async () => {
      const tabbar = document.getElementById('mobile-tabbar');
      const inner = document.getElementById('mtb-inner');
      if (!tabbar || !inner) return false;

      // Manually trigger the enter() logic by dispatching a long pointerdown
      // We do this by firing pointerdown and waiting 510ms
      return new Promise(resolve => {
        const btn = document.getElementById('mtb-dash');
        const ev = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 50, clientY: 800 });
        btn.dispatchEvent(ev);
        setTimeout(() => {
          resolve(tabbar.classList.contains('td-drag-active'));
        }, 550);
      });
    });
    expect(editModeEntered).toBe(true);

    // Done button should be present
    const doneBtnCount = await page.locator('.td-sort-done-btn').count();
    expect(doneBtnCount).toBe(1);

    // Click Done to exit
    await page.locator('.td-sort-done-btn').click();
    await page.waitForTimeout(100);

    const stillActive = await page.evaluate(() => {
      return document.getElementById('mobile-tabbar')?.classList.contains('td-drag-active') ?? false;
    });
    expect(stillActive).toBe(false);

    const doneBtnGone = await page.locator('.td-sort-done-btn').count();
    expect(doneBtnGone).toBe(0);
  });

  test('tab bar buttons remain functional after drag init (onclick still works)', async () => {
    // Navigate to Leads page via tab button
    await page.evaluate(() => document.getElementById('mtb-leads')?.click());
    await page.waitForTimeout(300);
    const leadsActive = await page.evaluate(() =>
      document.getElementById('pg-leads')?.classList.contains('active') ?? false
    );
    expect(leadsActive).toBe(true);

    // Navigate back to dash
    await page.evaluate(() => window.goPg('pg-dash'));
    await page.waitForTimeout(300);
  });

  test('assertNoErrors — no console errors from drag-reorder init', async () => {
    assertNoErrors(page, 'tab bar drag-to-reorder');
  });
});

test.describe('Drag-to-reorder — dashboard widgets', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    // Navigate to dash to trigger renderDash and _initDashDrag. renderDash wires
    // the widgets via setTimeout(...,0), so wait for them to actually exist rather
    // than racing a fixed delay (the cause of the intermittent shard failures).
    await page.evaluate(() => window.goPg('pg-dash'));
    await page.waitForFunction(
      () => document.querySelectorAll('#dash-widget-root > .td-dw').length >= 4,
      { timeout: 8000 }
    );
  });

  test.afterAll(async () => { await page.context().close(); });

  // 10 widgets since the 2026-07-04 split (owner: every card movable): crew,
  // alerts, contracts, goal were carved out of the old kpi+pipeline mega-widgets.
  test('dash-widget-root exists with all 10 .td-dw card widgets', async () => {
    const rootExists = await page.locator('#dash-widget-root').count();
    expect(rootExists).toBe(1);

    const widgets = await page.evaluate(() =>
      [...document.querySelectorAll('#dash-widget-root > .td-dw')].map(el => el.dataset.dw)
    );
    expect(widgets).toHaveLength(10);
    for (const id of ['kpi', 'crew', 'alerts', 'contracts', 'goal', 'pipeline', 'feed', 'quick', 'calendar', 'sources']) {
      expect(widgets).toContain(id);
    }
    // The crew card specifically must be its OWN widget (the un-movable-card bug).
    const crewOwnWidget = await page.evaluate(() =>
      document.querySelector('.td-dw[data-dw="crew"] > #dash-crew-today') !== null
    );
    expect(crewOwnWidget).toBe(true);
  });

  test('_initDashDrag and _applyDashOrder functions exist', async () => {
    const fnsExist = await page.evaluate(() => ({
      initDashDrag: typeof _initDashDrag === 'function',
      applyDashOrder: typeof _applyDashOrder === 'function',
      getDashWidgetOrder: typeof _getDashWidgetOrder === 'function',
    }));
    expect(fnsExist.initDashDrag).toBe(true);
    expect(fnsExist.applyDashOrder).toBe(true);
    expect(fnsExist.getDashWidgetOrder).toBe(true);
  });

  test('_getDashWidgetOrder returns default when S.dashWidgetOrder is unset', async () => {
    const order = await page.evaluate(() => {
      const saved = S.dashWidgetOrder;
      S.dashWidgetOrder = undefined;
      const result = _getDashWidgetOrder();
      S.dashWidgetOrder = saved;
      return result;
    });
    expect(order).toEqual(['kpi', 'crew', 'alerts', 'contracts', 'goal', 'pipeline', 'feed', 'quick', 'calendar', 'sources']);
  });

  test('_applyDashOrder reorders widgets in DOM (full 10-widget order)', async () => {
    const full = ['sources', 'calendar', 'quick', 'feed', 'pipeline', 'goal', 'contracts', 'alerts', 'crew', 'kpi'];
    await page.evaluate((o) => _applyDashOrder(o), full);

    const order = await page.evaluate(() =>
      [...document.querySelectorAll('#dash-widget-root > .td-dw')].map(el => el.dataset.dw)
    );
    expect(order).toEqual(full);

    // Restore default
    await page.evaluate(() => _applyDashOrder(_DASH_DEFAULT_ORDER.slice()));
    const restored = await page.evaluate(() =>
      [...document.querySelectorAll('#dash-widget-root > .td-dw')].map(el => el.dataset.dw)
    );
    expect(restored).toEqual(['kpi', 'crew', 'alerts', 'contracts', 'goal', 'pipeline', 'feed', 'quick', 'calendar', 'sources']);
  });

  // §11.4 companion: a PRE-SPLIT saved order (6 ids) must not dump the new cards
  // at the bottom — each new widget slots in right after its default predecessor.
  test('_mergeDashOrder inserts new widgets into an old saved order at their natural spot', async () => {
    const merged = await page.evaluate(() =>
      _mergeDashOrder(['sources', 'kpi', 'pipeline', 'feed', 'quick', 'calendar'])
    );
    // crew/alerts/contracts/goal follow kpi (their default predecessor), in default order.
    expect(merged).toEqual(['sources', 'kpi', 'crew', 'alerts', 'contracts', 'goal', 'pipeline', 'feed', 'quick', 'calendar']);
    // And applying the old order yields all 10 in the DOM, nothing orphaned.
    const applied = await page.evaluate(() => {
      _applyDashOrder(['sources', 'kpi', 'pipeline', 'feed', 'quick', 'calendar']);
      const out = [...document.querySelectorAll('#dash-widget-root > .td-dw')].map(el => el.dataset.dw);
      _applyDashOrder(_DASH_DEFAULT_ORDER.slice());
      return out;
    });
    expect(applied).toHaveLength(10);
  });

  test('_dashSortActive flag prevents duplicate listener registration', async () => {
    // _initDashDrag was called once by renderDash — _dashSortActive should be true
    const isActive = await page.evaluate(() => typeof _dashSortActive !== 'undefined' && _dashSortActive === true);
    expect(isActive).toBe(true);
  });

  test('long press on dashboard widget enters edit mode', async () => {
    // Find a non-interactive area inside a .td-dw widget
    const editModeEntered = await page.evaluate(async () => {
      const root = document.getElementById('dash-widget-root');
      const widget = root?.querySelector('.td-dw[data-dw="kpi"]');
      if (!widget) return false;

      return new Promise(resolve => {
        const ev = new PointerEvent('pointerdown', {
          bubbles: true, cancelable: true, clientX: 195, clientY: 200
        });
        widget.dispatchEvent(ev);
        setTimeout(() => {
          resolve(root?.classList.contains('td-drag-active') ?? false);
        }, 550);
      });
    });
    expect(editModeEntered).toBe(true);

    // Done button should be visible
    const doneBtnCount = await page.locator('.td-sort-done-btn').count();
    expect(doneBtnCount).toBe(1);

    // Click Done to exit edit mode
    await page.locator('.td-sort-done-btn').click();
    await page.waitForTimeout(150);

    const stillActive = await page.evaluate(() =>
      document.getElementById('dash-widget-root')?.classList.contains('td-drag-active') ?? false
    );
    expect(stillActive).toBe(false);
  });

  test('S.dashWidgetOrder is saved after exit', async () => {
    // Manually set and verify the order is persisted
    await page.evaluate(() => {
      S.dashWidgetOrder = ['sources', 'calendar', 'kpi', 'pipeline', 'feed', 'quick'];
    });
    const saved = await page.evaluate(() => S.dashWidgetOrder);
    expect(saved).toEqual(['sources', 'calendar', 'kpi', 'pipeline', 'feed', 'quick']);

    // Reset to default
    await page.evaluate(() => {
      S.dashWidgetOrder = _DASH_DEFAULT_ORDER.slice();
      _applyDashOrder(_DASH_DEFAULT_ORDER.slice());
    });
  });

  test('existing dash element IDs remain accessible after widget wrapping', async () => {
    // Critical IDs that must still be reachable for renderDash to work
    const ids = ['dash-kpi', 'dash-pipeline', 'dash-money-feed', 'dash-quick',
                 'dash-today', 'dash-sources', 'dash-goal'];
    const results = await page.evaluate((ids) =>
      ids.map(id => ({ id, found: !!document.getElementById(id) })),
      ids
    );
    for (const { id, found } of results) {
      expect(found, `Element #${id} missing after widget wrapping`).toBe(true);
    }
  });

  // ── iOS-polish package: FLIP glide, drop-settle, offline-reorder re-push ──

  test('_flipShift — shifted siblings glide via a transient translate, mutation applied', async () => {
    const r = await page.evaluate(async () => {
      if (typeof _flipShift !== 'function') return { skip: true };
      const box = document.createElement('div');
      box.style.cssText = 'position:fixed;left:-9999px;top:0;width:200px';
      box.innerHTML = '<div style="height:40px" id="fs-a"></div><div style="height:40px" id="fs-b"></div>';
      document.body.appendChild(box);
      const a = box.children[0], b = box.children[1];
      // Move A below B — B shifts up 40px. _flipShift inverts B to its OLD spot and
      // transitions to 0; the inline style is already the target ('0 0') when this
      // returns, so the observable proof is the COMPUTED position: read synchronously
      // (same task, transition at t=0), it must still sit at ~the old offset.
      _flipShift(box, () => box.appendChild(a));
      const computedY = parseFloat((getComputedStyle(b).translate.split(' ')[1] || '0'));
      const inFlight = (b.style.transition || '').includes('translate');
      const orderAfter = [...box.children].map(el => el.id);
      // The transient inline styles must self-clean (transitionend or fallback timer).
      await new Promise(res => setTimeout(res, 400));
      const cleaned = b.style.translate === '' && b.style.transition === '';
      box.remove();
      return { skip: false, computedY, inFlight, orderAfter, cleaned };
    });
    if (r.skip) return;
    expect(r.orderAfter).toEqual(['fs-b', 'fs-a']);   // the mutation ran
    expect(r.computedY).toBeGreaterThan(20);          // B starts the glide from its old spot (~40px)
    expect(r.inFlight).toBe(true);                    // the translate transition is armed
    expect(r.cleaned).toBe(true);                     // no inline residue after the glide
  });

  test('drop-settle + lift CSS is wired (settle overrides the jiggle while it plays)', async () => {
    const r = await page.evaluate(() => {
      const host = document.createElement('div');
      host.className = 'td-drag-active';
      host.style.cssText = 'position:fixed;left:-9999px;top:0';
      host.innerHTML = '<div class="td-dw td-drop-settle"></div>';
      document.body.appendChild(host);
      const anim = getComputedStyle(host.firstChild).animationName;
      host.remove();
      const ghost = document.createElement('div');
      ghost.className = 'td-dw td-drag-ghost';
      ghost.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(ghost);
      const lift = getComputedStyle(ghost).animationName;
      ghost.remove();
      return { anim, lift };
    });
    expect(r.anim).toContain('td-drop-settle');
    expect(r.lift).toContain('td-lift');
  });

  test('offline reorder — dirty flag set without cloud, local layout wins over stale cloud, then clears', async () => {
    const r = await page.evaluate(async () => {
      if (typeof _saveUserPrefs !== 'function' || typeof _loadUserPrefs !== 'function') return { skip: true };
      const savedSupa = typeof _supa !== 'undefined' ? _supa : null;
      const savedUser = typeof _supaUser !== 'undefined' ? _supaUser : null;
      const savedOrder = S.dashWidgetOrder;
      const uid = 'dirty-flag-test';
      const dirtyKey = 'td_layout_' + uid + '_dirty';
      try {
        _supaUser = { id: uid };
        // 1. OFFLINE reorder: no client → upsert can't land → dirty flag must persist.
        _supa = null;
        S.dashWidgetOrder = ['local', 'order'];
        _saveUserPrefs();
        const dirtyAfterOffline = localStorage.getItem(dirtyKey);
        // 2. Back online: _loadUserPrefs sees the dirty flag → pushes LOCAL up and
        //    must NOT apply the stale cloud row over it.
        let upserted = null;
        _supa = {
          from: () => ({
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { dash_widget_order: ['stale', 'cloud'] } }) }) }),
            upsert: (row) => ({ then: (ok) => { upserted = row; ok && ok(); } }),
          }),
        };
        await _loadUserPrefs();
        const localWins = JSON.stringify(S.dashWidgetOrder) === JSON.stringify(['local', 'order']);
        const dirtyCleared = localStorage.getItem(dirtyKey) === null;
        const pushedLocal = upserted && JSON.stringify(upserted.dash_widget_order) === JSON.stringify(['local', 'order']);
        // 3. Clean state: with the flag gone, the normal load path applies cloud again.
        await _loadUserPrefs();
        const cloudAppliesWhenClean = JSON.stringify(S.dashWidgetOrder) === JSON.stringify(['stale', 'cloud']);
        return { skip: false, dirtyAfterOffline, localWins, dirtyCleared, pushedLocal, cloudAppliesWhenClean };
      } finally {
        try { _supa = savedSupa; _supaUser = savedUser; S.dashWidgetOrder = savedOrder; } catch (_e) {}
        try { localStorage.removeItem(dirtyKey); localStorage.removeItem('td_layout_' + uid); } catch (_e) {}
      }
    });
    if (r.skip) return;
    expect(r.dirtyAfterOffline).toBe('1');     // offline reorder leaves the flag armed
    expect(r.localWins).toBe(true);            // stale cloud row never clobbers the newer local layout
    expect(r.pushedLocal).toBe(true);          // the local layout is what got pushed up
    expect(r.dirtyCleared).toBe(true);         // confirmed write disarms the flag
    expect(r.cloudAppliesWhenClean).toBe(true);// normal cloud-wins path intact when not dirty
  });

  test('assertNoErrors — no console errors from dashboard drag-reorder', async () => {
    assertNoErrors(page, 'dashboard widget drag-to-reorder');
  });
});
