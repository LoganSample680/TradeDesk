// REAL flow: receipt-gated supply runs (CLAUDE.md §12.8, owner-approved shape
// 2026-08-17). The incident this feature exists for: a Sunday personal Home
// Depot run was auto-logged as two business legs, because the destination
// alone used to be proof enough. This flow proves the fix end to end against
// the REAL backend, real geofence engine, real dashboard UI:
//
//   1. a real drive into a real supply house writes the leg HELD, excluded
//      from the deduction, and the held row actually lands in td_mileage
//   2. the dashboard's pinned card (above the money tiles) shows it, and a
//      SECOND unanswered visit to the SAME store nests under one accordion
//      instead of piling up as a second top-level card
//   3. all three doors, each proven on a DIFFERENT store so one door's
//      resolution can never contaminate another's assertion:
//        Personal      -> the held rows are gone from td_mileage entirely
//        No receipt    -> stays in td_mileage, flagged, still deducts
//        Scan receipt  -> commits AND a real td_expenses row lands, linked
//
// Why offline shards cannot close this: the fence state machine runs off a
// SEQUENCE of real GPS pings and the hold/delete/commit all have to survive
// a real Supabase round-trip, not just an in-memory mock.
//
// Seed data is left in the account per CLAUDE.md §12.7 — nothing here tears down.
const { test, expect } = require('./flow-test');
const { needsLiveCreds, signIn, step, report, resetLedger, tap, type, cloudRows } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'places/supply-run-receipt-doors';

// Own coordinate band, far from every other live geo spec's grid (drive-
// attribution: 41N/98W, geo-stamp-places: 38N/96W), so accumulating seed
// data (§12.7: nothing here ever cleans up) can never land inside another
// spec's 600ft dedup fence.
const CELL = (process.pid + Date.now()) % 10000;
const BASE_LAT = 44.0 + (CELL % 100) * 0.02;
const BASE_LON = -100.0 - (Math.floor(CELL / 100) % 100) * 0.02;
const SHOP = { lat: BASE_LAT, lon: BASE_LON };
const AWAY = { lat: BASE_LAT + 0.11, lon: BASE_LON - 0.11 }; // clears every fence, opens a leg
// Three distinct supply houses, spaced clear of each other's 600ft fence, one
// per door under test so resolving one can never touch another's assertion.
const A = { lat: BASE_LAT + 0.030, lon: BASE_LON - 0.030 };
const B = { lat: BASE_LAT + 0.045, lon: BASE_LON - 0.045 };
const C = { lat: BASE_LAT + 0.060, lon: BASE_LON - 0.060 };

test.describe('Receipt-gated supply runs: hold, dashboard accordion, three doors (UI-driven, real backend)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('a real drive holds the mileage, the dashboard nests repeat visits, and all three doors resolve for real', async ({ page }) => {
    test.setTimeout(240000);

    const tableReady = await page.evaluate(async () => {
      try { const { error } = await _supa.from('td_places').select('id').limit(1); return !error; }
      catch (e) { return false; }
    });
    test.skip(!tableReady, 'td_places not migrated to Dev yet');

    const runId = String(process.pid).slice(-6).padStart(6, '0');
    const tag = Date.now().toString(36).slice(-4);
    const nameA = `E2E Supply A ${runId}-${tag}`;
    const nameB = `E2E Supply B ${runId}-${tag}`;
    const nameC = `E2E Supply C ${runId}-${tag}`;

    const ping = (p, lat, lon) => p.evaluate(async ({ lat, lon }) => {
      await _geoOnPing({ coords: { latitude: lat, longitude: lon, accuracy: 8 } });
    }, { lat, lon });
    const pullAway = async (p) => {
      await ping(p, AWAY.lat, AWAY.lon);
      await p.waitForTimeout(300);
      await p.evaluate(() => { _geoDriveStartedAt = new Date(Date.now() - 18 * 60000).toISOString(); });
    };

    // ── 1. Register the shop and three supply houses ──────────────────────
    await step(page, {
      label: 'contractor has a shop and three supply houses on file', page: 'pg-team', role: 'contractor',
      suspect: 'places.js savePlace + the td_places sync fabric',
      ruleText: 'all four locations must be real rows the fence machine can resolve',
      expected: 'placeAt() resolves the shop and all three supply houses',
      act: async (p) => {
        await p.evaluate(({ SHOP, A, B, C, nameA, nameB, nameC }) => {
          // This dev account accumulates signed-but-unscheduled seed bids from
          // every OTHER live spec (§12.7: nothing ever cleans up), and the app
          // correctly pops a full-screen "New signature!" modal for them on
          // pg-dash. This flow never touches proposals/signing, so that popup
          // would only ever be contamination here, park the queue for good
          // (mirrors full-lifecycle-flow's exact guard).
          window._showingScheduleAlert = true;
          localStorage.setItem('zp3_schedule_alerts', '[]');
          document.getElementById('_sched-alert-overlay')?.remove();
          S.officeLat = SHOP.lat; S.officeLon = SHOP.lon;
          // The promoted DEV2 account is employee-linked with team tracking on
          // (confirmed by _geoNeedsAck in geo-track.js): it shows a one-time
          // "logs your job time with location" sheet until acknowledged. Real
          // employees dismiss it once; do the same here instead of leaving it
          // to intercept a click on some later render.
          if (typeof _geoRecordAck === 'function') _geoRecordAck();
          document.getElementById('_geo-notice-ov')?.remove();
          savePlace({ name: nameA, kind: 'supply', lat: A.lat, lon: A.lon, confirmedBy: 'manual' });
          savePlace({ name: nameB, kind: 'supply', lat: B.lat, lon: B.lon, confirmedBy: 'manual' });
          savePlace({ name: nameC, kind: 'supply', lat: C.lat, lon: C.lon, confirmedBy: 'manual' });
          _geoCurrentPlace = null; _geoPlaceArrivedAt = null;
          _geoCurrentJob = null; _geoArrivedAt = null;
          _geoWasInShop = false; _geoShopArrivedAt = null; _geoDriveStartedAt = null;
          saveAll();
        }, { SHOP, A, B, C, nameA, nameB, nameC });
        await p.evaluate(() => _flushSaveNow && _flushSaveNow());
        return 0; // setup, not a user interaction
      },
      rule: async (p) => {
        const out = await p.evaluate(({ A, B, C, nameA, nameB, nameC }) => ({
          a: (placeAt(A) || {}).name === nameA, b: (placeAt(B) || {}).name === nameB, c: (placeAt(C) || {}).name === nameC,
        }), { A, B, C, nameA, nameB, nameC });
        return { ok: out.a && out.b && out.c, got: JSON.stringify(out) };
      },
    });

    // ── 2. Drive shop → supply A: the leg lands HELD, not deducted ────────
    await step(page, {
      label: 'drive shop → supply house A', page: 'geo', role: 'contractor',
      suspect: 'mileage.js autoLogDriveTrip (pendingReceipt + supplyRunKey stamp)',
      ruleText: 'a leg touching a supply place must be written held and excluded from the deduction, in Postgres, not just in memory',
      expected: `td_mileage row to "${nameA}" has pendingReceipt=true, supplyRunKey set`,
      act: async (p) => {
        await ping(p, SHOP.lat, SHOP.lon);
        await p.waitForTimeout(300);
        await pullAway(p);
        await ping(p, A.lat, A.lon);
        await p.waitForTimeout(1500);
        // autoLogDriveTrip writes the row through the standard 2s-debounced
        // saveAll(), not an immediate push (unlike job_time_entries elsewhere
        // in the geofence pipeline). Force it now instead of hoping the
        // debounce clears inside the poll window, AND capture the flush's own
        // outcome (window._saveLog, cloud.js:5750) so a repeat miss states
        // whether supaSaveToCloud even ran, skipped, or threw, instead of
        // just "not found yet".
        const flushDiag = await p.evaluate(async () => {
          const localRow = (typeof mileage !== 'undefined' ? mileage : [])[0];
          const before = (window._saveLog || []).length;
          const upsertsBefore = window._deltaStats ? window._deltaStats.upserts : null;
          const skipsBefore = window._deltaStats ? window._deltaStats.skips : null;
          try { await (_flushSaveNow && _flushSaveNow()); } catch (e) { return { log: [{ stage: 'flush-threw', info: String(e && e.message) }] }; }
          return {
            log: (window._saveLog || []).slice(before),
            // Precise per-row proof: was OUR id in the batch this save actually
            // upserted (cloud.js:5964, window._deltaStats.rows, 'tbl:id' pairs),
            // or did the delta-hash short-circuit skip it as "unchanged"
            // (cloud.js:5920)?
            mileageRowLogged: localRow ? (window._deltaStats && window._deltaStats.rows || []).includes('td_mileage:' + localRow.id) : null,
            upsertsDelta: window._deltaStats ? window._deltaStats.upserts - upsertsBefore : null,
            skipsDelta: window._deltaStats ? window._deltaStats.skips - skipsBefore : null,
            localId: localRow ? localRow.id : null,
          };
        });
        p.__flushLog = flushDiag;
        return 0; // automatic: a GPS ping is not an interaction
      },
      rule: async (p) => {
        let row = null, localRow = null;
        for (let i = 0; i < 8 && !row; i++) {
          localRow = await p.evaluate((nameA) => {
            const m = (typeof mileage !== 'undefined' ? mileage : []).find(x => x && x.to_name === nameA);
            return m ? { pendingReceipt: m.pendingReceipt, supplyRunKey: m.supplyRunKey, id: m.id } : null;
          }, nameA);
          const rows = await cloudRows(p, 'td_mileage');
          row = (rows || []).find(r => r.to_name === nameA || (r.supplyRunKey || '').includes(nameA));
          if (!row) await p.waitForTimeout(1500);
        }
        const ok = !!row && row.pendingReceipt === true && !!row.supplyRunKey;
        // The last run proved the upsert genuinely succeeded (mileageRowLogged
        // true, upsertsDelta 1) yet cloudRows() still came back empty: an
        // account-identity mismatch (employee writes land under
        // _contractorUserId, cloudRows only ever queried _supaUser.id), now
        // fixed in live-helpers.js. Keep this identity snapshot as a safety
        // net in case that wasn't the whole story.
        const idInfo = !row ? await p.evaluate(() => ({
          isEmployee: typeof _isEmployee !== 'undefined' ? _isEmployee : null,
          contractorUserId: typeof _contractorUserId !== 'undefined' ? _contractorUserId : null,
          supaUserId: (typeof _supaUser !== 'undefined' && _supaUser) ? _supaUser.id : null,
        })) : null;
        return { ok, got: `cloud=${JSON.stringify(row && { pendingReceipt: row.pendingReceipt, supplyRunKey: row.supplyRunKey })} local=${JSON.stringify(localRow)} id=${JSON.stringify(idInfo)} flushLog=${JSON.stringify(p.__flushLog)}` };
      },
    });

    // ── 2.5 A second visit to A, a different day: nests, doesn't duplicate ──
    await step(page, {
      label: 'a second visit to supply house A, a different day, nests under the SAME accordion', page: 'pg-dash', role: 'contractor',
      suspect: 'mileage.js pendingSupplyStores + dashboard.js _renderDashSupplyHold',
      ruleText: 'a second unanswered visit to the SAME store must nest under one accordion, not spawn a second top-level card',
      expected: `store card for "${nameA}" shows a count badge of 2, oldest visit first`,
      act: async (p) => {
        // The fence engine runs off real elapsed time, so a genuine second-day
        // drive can't be simulated live without controlling the server clock.
        // This one row is written directly (same pattern geo-stamp-places-flow
        // uses for its coordinate-stamped expense), a real held mileage row
        // two days back, to prove the NESTING itself; every other row in this
        // flow is fence-driven.
        await p.evaluate(({ nameA }) => {
          const day = (n) => { const d = new Date(Date.now() - n * 86400000); return dateKey(d); };
          const d2 = day(2);
          mileage.unshift({
            id: _newId(), date: d2, loggedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
            from_name: 'Shop', to_name: nameA, to: nameA, miles: 6.2, gps: true,
            calc_method: 'auto_route', pendingReceipt: true, supplyRunKey: d2 + '|' + nameA,
            created_at: new Date(Date.now() - 2 * 86400000).toISOString(),
          });
          saveAll();
        }, { nameA });
        await p.evaluate(() => _flushSaveNow && _flushSaveNow());
        await p.waitForTimeout(1500);
        await p.evaluate(() => { if (typeof renderDash === 'function') renderDash(); });
        await p.waitForTimeout(300);
        return 0; // a past day's drive, not something anyone taps for today
      },
      rule: async (p) => {
        let ok = false, got = '';
        for (let i = 0; i < 6 && !ok; i++) {
          const out = await p.evaluate((nameA) => {
            const stores = [...document.querySelectorAll('#dash-supply-hold .td-supply-store')];
            const s = stores.find(el => (el.querySelector('.td-supply-store-hd .name') || {}).textContent === nameA);
            const badge = s ? s.querySelector('.td-supply-store-badge') : null;
            const visits = s ? s.querySelectorAll('.td-supply-visit').length : 0;
            return { found: !!s, badge: badge ? badge.textContent.trim() : null, visits };
          }, nameA);
          ok = out.found && out.badge === '2' && out.visits === 2;
          got = JSON.stringify(out);
          if (!ok) { await p.waitForTimeout(1200); await p.evaluate(() => { if (typeof renderDash === 'function') renderDash(); }); }
        }
        return { ok, got };
      },
    });

    // ── 3. Drive on to supply B, then supply C: two more independent runs ──
    await step(page, {
      label: 'drive on to supply house B, then supply house C', page: 'geo', role: 'contractor',
      suspect: 'mileage.js autoLogDriveTrip (one held run per store)',
      ruleText: 'each store the day touches must hold its own independent run',
      expected: `td_mileage has held rows to "${nameB}" and "${nameC}"`,
      act: async (p) => {
        await pullAway(p);
        await ping(p, B.lat, B.lon);
        await p.waitForTimeout(1200);
        await pullAway(p);
        await ping(p, C.lat, C.lon);
        await p.waitForTimeout(1500);
        await p.evaluate(() => _flushSaveNow && _flushSaveNow());
        return 0;
      },
      rule: async (p) => {
        let rowB = null, rowC = null;
        for (let i = 0; i < 8 && !(rowB && rowC); i++) {
          const rows = await cloudRows(p, 'td_mileage');
          rowB = rowB || (rows || []).find(r => r.to_name === nameB);
          rowC = rowC || (rows || []).find(r => r.to_name === nameC);
          if (!(rowB && rowC)) await p.waitForTimeout(1500);
        }
        const local = await p.evaluate(({ nameB, nameC }) => ({
          b: (typeof mileage !== 'undefined' ? mileage : []).some(m => m && m.to_name === nameB),
          c: (typeof mileage !== 'undefined' ? mileage : []).some(m => m && m.to_name === nameC),
        }), { nameB, nameC });
        const ok = !!rowB && rowB.pendingReceipt === true && !!rowC && rowC.pendingReceipt === true;
        return { ok, got: `cloud B=${JSON.stringify(rowB && rowB.pendingReceipt)} C=${JSON.stringify(rowC && rowC.pendingReceipt)} · local B=${local.b} C=${local.c}` };
      },
    });

    // ── 4. The real dashboard card: pinned above the tiles, three stores ──
    await step(page, {
      label: 'the pinned dashboard card shows all three held stores', page: 'pg-dash', role: 'contractor',
      suspect: 'dashboard.js _renderDashSupplyHold',
      ruleText: 'the held-run card must be pinned above the money tiles and list all three stores',
      expected: `#dash-supply-hold above #dash-widget-root, contains ${nameA}, ${nameB}, ${nameC}`,
      act: async (p) => {
        await p.evaluate(() => {
          document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove()); // any stray notice/alert
          if (typeof goPg === 'function') goPg('pg-dash');
          if (typeof renderDash === 'function') renderDash();
        });
        await p.waitForTimeout(400);
        return 0;
      },
      rule: async (p) => {
        const out = await p.evaluate(({ nameA, nameB, nameC }) => {
          const el = document.getElementById('dash-supply-hold');
          const widgets = document.getElementById('dash-widget-root');
          const above = !!(el && widgets && (el.compareDocumentPosition(widgets) & Node.DOCUMENT_POSITION_FOLLOWING));
          const html = el ? el.innerHTML : '';
          return { shown: el && el.style.display !== 'none', above, hasA: html.includes(nameA), hasB: html.includes(nameB), hasC: html.includes(nameC) };
        }, { nameA, nameB, nameC });
        const ok = out.shown && out.above && out.hasA && out.hasB && out.hasC;
        return { ok, got: JSON.stringify(out) };
      },
    });

    // Open a store's accordion if it isn't already (only the most-recently-
    // active store defaults open), returning the honest tap cost.
    const openStore = async (p, storeName) => {
      // Belt-and-suspenders: a stray overlay (geo notice, schedule alert) can
      // only ever be contamination on this page, never remove anything the
      // steps below still need to read.
      await p.evaluate(() => { document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove()); });
      const alreadyOpen = await p.evaluate((name) => {
        const stores = [...document.querySelectorAll('#dash-supply-hold .td-supply-store')];
        const s = stores.find(el => (el.querySelector('.td-supply-store-hd .name') || {}).textContent === name);
        return !!(s && s.classList.contains('open'));
      }, storeName);
      if (alreadyOpen) return 0;
      const hd = p.locator('#dash-supply-hold .td-supply-store').filter({ has: p.locator('.name', { hasText: storeName }) }).locator('.td-supply-store-hd');
      await hd.click({ timeout: 8000 });
      await p.waitForTimeout(200);
      return 1;
    };
    const doorButton = (p, storeName, label) =>
      p.locator('#dash-supply-hold .td-supply-store').filter({ has: p.locator('.name', { hasText: storeName }) })
        .locator('.td-supply-visit button', { hasText: label }).first();

    // _renderDashSupplyHold() always computes which store is "open" fresh off
    // array index (dashboard.js: idx===0?' open':''), it never remembers a
    // manual toggle. This account carries 40+ mileage rows with live realtime
    // sync, and renderDash() fires from a dozen call sites in mileage.js on
    // every save/echo, so a background re-render between opening a store and
    // clicking inside it can rebuild the accordion CLOSED again, stranding
    // Playwright's click on stale coordinates (the header intercepts it).
    // Re-open and retry instead of assuming the DOM holds still.
    const clickDoor = async (p, storeName, label) => {
      let n = 0;
      for (let attempt = 0; attempt < 4; attempt++) {
        n += await openStore(p, storeName);
        try {
          await doorButton(p, storeName, label).click({ timeout: 4000 });
          return n + 1;
        } catch (e) {
          if (attempt === 3) throw e;
          await p.waitForTimeout(400);
        }
      }
      return n;
    };

    // ── 5. Door 1, Personal: the held rows are gone from Postgres entirely ─
    await step(page, {
      label: 'tap Personal on EACH visit nested under supply house A', page: 'pg-dash', role: 'contractor',
      suspect: 'mileage.js resolveSupplyRun(...,\'personal\') → _userDelete',
      ruleText: 'Personal must delete the held rows from td_mileage entirely (both nested visits), and the deletion must survive a real round-trip',
      expected: `no td_mileage row to "${nameA}" remains`,
      act: async (p) => {
        let n = 0;
        // A carries TWO nested visits (today's real leg + the seeded day-2
        // one). Resolve them one at a time, oldest first, exactly as a real
        // user working through the open accordion would.
        for (let guard = 0; guard < 5; guard++) {
          // .count() reads current DOM state without waiting, unlike
          // .click(). Once both visits are resolved, store A's whole card
          // disappears from #dash-supply-hold; opening it BEFORE this check
          // (the previous version) hung 8s waiting for a header that no
          // longer exists.
          if (!(await doorButton(p, nameA, 'Personal').count())) break;
          n += await clickDoor(p, nameA, 'Personal');
          await p.waitForTimeout(1200);
        }
        return n;
      },
      rule: async (p) => {
        let rows = [];
        for (let i = 0; i < 6; i++) {
          rows = (await cloudRows(p, 'td_mileage')).filter(r => r.to_name === nameA);
          if (!rows.length) break;
          await p.waitForTimeout(1200);
        }
        return { ok: rows.length === 0, got: `remaining=${rows.length}` };
      },
    });

    // ── 6. Door 2, No receipt: stays, flagged, still deducts ──────────────
    await step(page, {
      label: 'tap No receipt on supply house B, confirm the IRS disclaimer', page: 'pg-dash', role: 'contractor',
      suspect: 'mileage.js _supplyRunNoReceipt → resolveSupplyRun(...,\'noreceipt\')',
      ruleText: 'No receipt must commit the row as business (noReceipt flag) and it must still be present, not deleted',
      expected: `td_mileage row to "${nameB}" has noReceipt=true, pendingReceipt cleared`,
      act: async (p) => {
        let n = await clickDoor(p, nameB, 'No receipt');
        await p.waitForSelector('.zmodal-overlay .zmodal-msg', { state: 'visible', timeout: 6000 });
        const msg = await p.locator('.zmodal-overlay .zmodal-msg').innerText();
        if (!/IRS may disallow/.test(msg)) throw new Error('No receipt did not show the IRS disclaimer: ' + msg);
        await p.locator('#zmodal-yes').click({ timeout: 8000 });
        n += 1;
        await p.waitForTimeout(1500);
        return n;
      },
      rule: async (p) => {
        let row = null;
        for (let i = 0; i < 6 && !row; i++) {
          const rows = await cloudRows(p, 'td_mileage');
          row = (rows || []).find(r => r.to_name === nameB);
          if (!row || row.pendingReceipt) { row = null; await p.waitForTimeout(1200); }
        }
        const ok = !!row && row.noReceipt === true && !row.pendingReceipt;
        return { ok, got: JSON.stringify(row && { noReceipt: row.noReceipt, pendingReceipt: row.pendingReceipt }) };
      },
    });

    // ── 7. Door 3, Scan receipt: expense + mileage settle together ────────
    let expAmount = 0;
    await step(page, {
      label: 'tap Scan receipt on supply house C, type the amount, save', page: 'pg-dash', role: 'contractor',
      suspect: 'mileage.js _supplyRunScan + finance.js saveQuickExpense (resolveSupplyRun(...,\'receipt\',expenseId))',
      ruleText: 'saving the scanned expense must commit the held mileage AND write a real linked expense row',
      expected: `td_mileage row to "${nameC}" has receiptExpenseId set, matching a real td_expenses row`,
      act: async (p) => {
        await p.evaluate(() => { document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove()); });
        let n = await clickDoor(p, nameC, 'Scan receipt');
        await p.waitForSelector('#qe-vendor', { state: 'visible', timeout: 8000 });
        const vendorPrefilled = await p.locator('#qe-vendor').inputValue();
        if (vendorPrefilled !== nameC) throw new Error(`vendor not prefilled from the store: got "${vendorPrefilled}"`);
        expAmount = 62 + (Number(runId.slice(-2)) % 30); // varied, realistic, deterministic per run
        n += await type(p, '#qe-amount', String(expAmount) + '.00');
        await p.locator('.zmodal-overlay button', { hasText: 'Save expense' }).click({ timeout: 8000 });
        n += 1;
        await p.waitForTimeout(1500);
        return n;
      },
      rule: async (p) => {
        let mRow = null, eRow = null;
        for (let i = 0; i < 8 && !(mRow && eRow); i++) {
          const mRows = await cloudRows(p, 'td_mileage');
          mRow = (mRows || []).find(r => r.to_name === nameC);
          if (mRow && mRow.receiptExpenseId != null) {
            const eRows = await cloudRows(p, 'td_expenses');
            eRow = (eRows || []).find(r => String(r.id) === String(mRow.receiptExpenseId));
          } else { mRow = null; }
          if (!(mRow && eRow)) await p.waitForTimeout(1500);
        }
        const ok = !!mRow && !mRow.pendingReceipt && !!eRow && eRow.vendor === nameC && Math.abs((eRow.amount || 0) - (expAmount + 0)) < 0.01;
        return { ok, got: JSON.stringify({ mRow: mRow && { pendingReceipt: mRow.pendingReceipt, receiptExpenseId: mRow.receiptExpenseId }, eRow: eRow && { vendor: eRow.vendor, amount: eRow.amount } }) };
      },
    });

    // ── 8. Card is gone: every store answered ──────────────────────────────
    await step(page, {
      label: 'the held card is gone once every store is answered', page: 'pg-dash', role: 'contractor',
      suspect: 'dashboard.js _renderDashSupplyHold',
      ruleText: 'once all three stores are resolved the pinned card must disappear entirely, like the setup checklist',
      expected: '#dash-supply-hold hidden and empty',
      act: async (p) => { await p.evaluate(() => { if (typeof renderDash === 'function') renderDash(); }); return 0; },
      rule: async (p) => {
        const out = await p.evaluate(() => {
          const el = document.getElementById('dash-supply-hold');
          return { hidden: !el || el.style.display === 'none', empty: !el || el.innerHTML === '' };
        });
        return { ok: out.hidden && out.empty, got: JSON.stringify(out) };
      },
    });

    // NO cleanup, the shop/supply places, the deleted-Personal leg, the
    // no-receipt mileage row, and the scanned expense all stay in the dev
    // account so the owner can open it and see exactly what ran (§12.7).
    const rep = report(FLOW, BASELINE, page);
    if (BASELINE[FLOW]) {
      expect(rep.overBudget, `UX REGRESSION: the supply-run doors now cost ${rep.totalClicks} clicks vs budget ${BASELINE[FLOW].clicks}.`).toBe(false);
    }
    expect(rep.totalClicks).toBeGreaterThan(0);
  });
});
