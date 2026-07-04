// REAL flow — realtime sync must be SMOOTH, not glitchy (the "no glitchy screens
// or race conditions" requirement). realtime-sync-flow already proves an update
// ARRIVES on the other device; this proves the arrival is CLEAN:
//
//   GLITCH-FREE — while device B receives an update from device A, B's dashboard
//   must never blank out (the greeting stays in the DOM the whole time → no white
//   flash / rebuild flicker), B must not get navigated away from the page it's on,
//   renderDash must not fire in a storm (the broadcast + postgres_changes are
//   coalesced, not N redundant rebuilds), and zero console errors.
//
//   NO RACE / NO LOST UPDATE — when A fires a rapid BURST of edits to the same bid,
//   B must converge to the LAST value (the _loadInProgress guard + broadcast
//   debounce serialize the reloads; no interleaving leaves a stale amount).
//
// Per CLAUDE.md §13.7 the seed bid is left in the account; only the extra device
// page is closed.
const { test, expect } = require('@playwright/test');
const { needsLiveCreds, signIn, step, report, resetLedger } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'realtime/glitch-free-sync';
const BENIGN = ['favicon', 'net::ERR', 'ERR_CONNECTION', 'Failed to load resource', 'apple-mapkit', 'js.stripe.com', 'cdn.jsdelivr', 'AggregateError', 'JSON Parse error', 'Unhandled Promise Rejection', 'mapkit', '401', '403'];
const realError = t => !BENIGN.some(b => t.includes(b));

test.describe('realtime sync is glitch-free (multi-device)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('an incoming update never blanks the screen, navigates away, or storms renders', async ({ page }) => {
    test.setTimeout(120000);
    const bidId = Date.now() * 1000 + (process.pid % 1000);
    const clientId = bidId + 1;
    const tag = `E2E Glitch ${process.pid}`;

    // Device A subscribed; bring up device B on the dashboard.
    await page.waitForFunction(() => typeof _realtimeSubscribed !== 'undefined' && _realtimeSubscribed === true, { timeout: 20000 }).catch(() => {});
    const pageB = await page.context().newPage();
    await pageB.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await pageB.waitForFunction(() => typeof _supaUser !== 'undefined' && _supaUser && _supaUser.id, { timeout: 30000 });
    await pageB.waitForFunction(() => typeof _supaCloudLoaded === 'undefined' || _supaCloudLoaded === true, { timeout: 30000 }).catch(() => {});
    await pageB.waitForFunction(() => typeof _realtimeSubscribed !== 'undefined' && _realtimeSubscribed === true, { timeout: 20000 }).catch(() => {});
    await pageB.evaluate(() => { if (typeof goPg === 'function') goPg('pg-dash'); });
    await pageB.waitForTimeout(400);

    // Watch B's console for real errors during the whole test.
    const bErrors = [];
    pageB.on('console', m => { if (m.type() === 'error' && realError(m.text())) bErrors.push(m.text()); });
    pageB.on('pageerror', e => { if (realError(String(e))) bErrors.push('pageerror: ' + e.message); });

    // Instrument B: count renderDash calls, and poll (every 40ms) whether the
    // dashboard greeting ever vanished (a blank-flash) or the active page changed.
    await pageB.evaluate(() => {
      window.__g = { rd: 0, greetMissing: 0, pageChanged: 0, stacks: [] };
      if (typeof renderDash === 'function') {
        const orig = renderDash;
        window.renderDash = function () {
          window.__g.rd++;
          // Record WHO triggered each render — on a budget breach the failure names the
          // caller instead of leaving us to guess which sync path added a pass.
          try { window.__g.stacks.push(String((new Error()).stack || '').split('\n').slice(1, 4).map(s => s.trim()).join(' < ')); } catch (e) {}
          return orig.apply(this, arguments);
        };
      }
      window.__gActive = (document.querySelector('.pg.active') || {}).id || null;
      window.__gPoll = setInterval(() => {
        const greet = document.getElementById('dash-greet');
        if (!greet || !(greet.textContent || '').trim()) window.__g.greetMissing++;
        const ap = (document.querySelector('.pg.active') || {}).id || null;
        if (ap !== window.__gActive) window.__g.pageChanged++;
      }, 40);
    });

    await step(page, {
      label: 'A creates a bid → B updates without a blank flash, nav jump, or render storm',
      page: 'pg-dash', role: 'contractor',
      suspect: 'cloud.js _applyRealtimeRecord + _broadcastReloadTimer debounce (no redundant rebuilds)',
      ruleText: 'while B receives the update its dashboard must stay mounted, stay on the page, render a bounded number of times, and log no errors',
      expected: 'greetMissing=0, pageChanged=0, renderDash≤8, 0 console errors',
      act: async (p) => {
        await p.evaluate(async ({ bidId, clientId, tag }) => {
          clients.push({ id: clientId, name: tag + ' Client', phone: '3165550800', _e2e: 'glitch' });
          bids.push({ id: bidId, client_id: clientId, client_name: tag + ' Client', amount: 5000, status: 'Pending', bid_date: new Date().toISOString().slice(0, 10), _e2e: 'glitch' });
          // Bound the save WAIT (not the op): a full-account upsert can serialize behind
          // other workers' upserts of the same shared-account rows and stall well past
          // the 120s test budget — a single page.evaluate has no per-call timeout, so an
          // unbounded await would eat the whole run. Stop waiting after 20s and proceed
          // to assert render-stability; the upsert still completes in the background and
          // B receives it via realtime. The render assertions stay strict.
          if (typeof supaSaveToCloud === 'function') {
            await Promise.race([
              Promise.resolve(supaSaveToCloud()).catch(() => {}),
              new Promise((resolve) => setTimeout(resolve, 20000)),
            ]);
          }
        }, { bidId, clientId, tag });
        // Wait for B to actually receive it, then let any re-render settle.
        await pageB.waitForFunction((id) => (bids || []).some(b => b.id === id), bidId, { timeout: 25000 }).catch(() => {});
        await pageB.waitForTimeout(2500);
        const g = await pageB.evaluate(() => { clearInterval(window.__gPoll); return window.__g; });
        p.__g = g;
        return 1;
      },
      rule: async (p) => {
        const g = p.__g || {};
        const ok = g.greetMissing === 0 && g.pageChanged === 0 && g.rd <= 8 && bErrors.length === 0;
        const stackNote = (!ok && g.rd > 8 && Array.isArray(g.stacks))
          ? ' :: render callers: ' + g.stacks.map((s, i) => `[${i + 1}] ${s}`).join(' || ')
          : '';
        return { ok, got: `greetMissing=${g.greetMissing} pageChanged=${g.pageChanged} renderDash=${g.rd} errors=${bErrors.length}${bErrors.length ? ' :: ' + bErrors.slice(0, 2).join(' | ') : ''}${stackNote}` };
      },
    });

    // Resource cleanup only — the seed bid stays in the account (CLAUDE.md §13.7).
    await pageB.close().catch(() => {});

    const rep = report(FLOW, BASELINE, page);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });

  // RE-ENABLED after the read-skew root cause was fixed (cloud.js supaSaveToCloud "sync
  // marker written LAST"). B used to land on 5004 (one behind) every run because convergence
  // keys off zj_data.updated_at, but that cursor was bumped by the settings-FIRST write —
  // BEFORE the td_bids rows committed. B could capture the fresh cursor, reload, read the
  // tables before A's row upserts landed, and mark itself caught up on a stale amount (the
  // cursor never moved a second time, so B never reloaded again). The fix bumps
  // zj_data.updated_at only AFTER every td_* upsert has committed, so "cursor moved ⇒ all
  // data committed" — B's next reconcile reload now always reads the final value.
  test('A fires a rapid burst of edits → B converges to the LAST value (no lost update)', async ({ page }) => {
    test.setTimeout(120000);
    const bidId = Date.now() * 1000 + (process.pid % 1000);
    const clientId = bidId + 1;
    const tag = `E2E Glitch Burst ${process.pid}`;

    // Bring up device B alongside the already-signed-in device A.
    await page.waitForFunction(() => typeof _tdRealtimeReady !== 'undefined' && _tdRealtimeReady === true, { timeout: 30000 });
    const pageB = await page.context().newPage();
    await pageB.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await pageB.waitForFunction(() => typeof _supaUser !== 'undefined' && _supaUser && _supaUser.id, { timeout: 30000 });
    await pageB.waitForFunction(() => typeof _supaCloudLoaded === 'undefined' || _supaCloudLoaded === true, { timeout: 30000 }).catch(() => {});
    await pageB.waitForFunction(() => typeof _tdRealtimeReady !== 'undefined' && _tdRealtimeReady === true, { timeout: 30000 });

    // Seed the bid on A and wait for B to receive it before the burst.
    await page.evaluate(async ({ bidId, clientId, tag }) => {
      clients.push({ id: clientId, name: tag + ' Client', phone: '3165550801', _e2e: 'glitch-burst' });
      bids.push({ id: bidId, client_id: clientId, client_name: tag + ' Client', amount: 5000, status: 'Pending', bid_date: new Date().toISOString().slice(0, 10), _e2e: 'glitch-burst' });
      if (typeof supaSaveToCloud === 'function') {
        await Promise.race([
          Promise.resolve(supaSaveToCloud()).catch(() => {}),
          new Promise((resolve) => setTimeout(resolve, 20000)),
        ]);
      }
    }, { bidId, clientId, tag });
    await pageB.waitForFunction((id) => (bids || []).some(b => b.id === id), bidId, { timeout: 25000 }).catch(() => {});

    await step(page, {
      label: 'A fires a rapid burst of edits → B converges to the LAST value (no lost update)',
      page: 'cloud', role: 'contractor',
      suspect: 'cloud.js supaLoadFromCloud _loadInProgress guard + broadcast debounce (serialize reloads)',
      ruleText: 'a burst of same-bid edits must leave B on the final amount, never a stale mid-burst value',
      expected: 'B bid amount === 5005 after a 5-edit burst',
      act: async (p) => {
        for (let amt = 5001; amt <= 5005; amt++) {
          await p.evaluate(async ({ bidId, amt }) => {
            const b = bids.find(x => x.id === bidId); if (b) b.amount = amt;
            if (typeof supaSaveToCloud === 'function') {
              await Promise.race([
                Promise.resolve(supaSaveToCloud()).catch(() => {}),
                new Promise((resolve) => setTimeout(resolve, 15000)),
              ]);
            }
          }, { bidId, amt });
          await p.waitForTimeout(150); // rapid, overlapping with B's reloads
        }
        // Let B's coalesced reloads settle on the final value.
        await pageB.waitForFunction((id) => { const b = (bids || []).find(x => x.id === id); return b && b.amount === 5005; }, bidId, { timeout: 25000 }).catch(() => {});
        return 5;
      },
      rule: async () => {
        const amt = await pageB.evaluate((id) => { const b = (bids || []).find(x => x.id === id); return b ? b.amount : null; }, bidId);
        if (amt === 5005) return { ok: true, got: `B final amount=${amt}` };
        // MISS — dump B's sync state, then the decisive probe: does ONE forced silent
        // reconcile heal it? healed ⇒ the notification/scheduler chain failed to fire
        // (zj event lost + heartbeat quiet); not healed ⇒ the merge itself rejects the
        // newer row (clock/gate bug). Still a failure either way — B must converge on
        // its own — but the next occurrence names its half of the machine.
        const diag = await pageB.evaluate(async (id) => {
          const before = {
            loadInProgress: typeof _loadInProgress !== 'undefined' && _loadInProgress,
            rtReady: typeof _tdRealtimeReady !== 'undefined' && _tdRealtimeReady,
            lastZj: window._lastZjUpdatedAt || null,
            deltaCursor: (typeof _deltaCursor !== 'undefined' && _deltaCursor) || null,
            clock: (typeof window.__fieldClock === 'function' && window.__fieldClock('td_bids', String(id), 'amount')) || null,
          };
          let after = null;
          try {
            await supaLoadFromCloud({ silent: true });
            const b = (bids || []).find(x => x.id === id); after = b && b.amount;
          } catch (e) { after = 'loadErr:' + (e && e.message); }
          return { ...before, after };
        }, bidId);
        return {
          ok: false,
          got: `B final amount=${amt} (want 5005) — loadInProgress=${diag.loadInProgress} rtReady=${diag.rtReady} lastZj=${diag.lastZj} deltaCursor=${diag.deltaCursor} clock=${diag.clock ? 'SET' : 'ABSENT'} afterForcedReconcile=${diag.after}`,
        };
      },
    });

    // Resource cleanup only — the seed bid stays in the account (CLAUDE.md §13.7).
    await pageB.close().catch(() => {});
  });
});
