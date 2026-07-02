// SWARM CERTIFICATION — N writers, ONE account, live editors + offline returners.
//
// This is the empirical proof behind "survives 100+ people on one account": N browser
// contexts (default 12 in CI — dial E2E_SWARM_N up to 100 on the Proxmox stack) all
// sign into the SAME account and hammer it concurrently:
//
//   • every context sets its OWN field on the SAME shared bid (sw_f0..sw_fN-1) — the
//     same-row/different-field concurrency class that whole-row LWW provably loses and
//     the per-field op channel (td_ops + HLC field clocks) exists to win;
//   • every context also creates its OWN bid — the fan-out create class;
//   • a third of the contexts do all of this OFFLINE (context.setOffline) and return
//     staggered — the offline-return rebase class (pull-first, pending ops overlay,
//     then push).
//
// END STATE (the whole point): every context converges to the SAME data — the shared
// bid carries ALL N field markers on EVERY device, every created bid exists everywhere,
// and the canonical (key-sorted, id-sorted) serialization of the bids array is
// BYTE-EQUAL across all N contexts. Nothing anyone wrote is lost, anywhere.
//
// LOCAL-STACK ONLY: N concurrent sessions against the shared cloud dev account would
// contend with the rest of the suite; the local stack is provisioned for it and is the
// same engine (Postgres + realtime + PostgREST) that will run on Proxmox in production.
// Per §13.7 the swarm's rows are left in the account to inspect.
const { test, expect } = require('@playwright/test');
const { needsLiveCreds, signIn, step, report, resetLedger } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'swarm/convergence';
const N = Math.max(3, parseInt(process.env.E2E_SWARM_N || '12', 10));
const LOCAL_STACK = process.env.E2E_LOCAL_STACK === '1';

// Canonical serialization: recursively key-sorted objects, rows sorted by id — so two
// devices holding the same DATA in different key/array order compare byte-equal.
const canonFnSource = `
  (function canon(v){
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
    return JSON.stringify(v);
  })
`;

test.describe('swarm — N writers on one account converge byte-equal', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured');
  test.skip(!LOCAL_STACK, 'swarm runs on the local stack only (it hammers one account with N sessions)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test(`${N} concurrent writers (live + offline-returning) — everything persists everywhere`, async ({ page, browser, browserName }, testInfo) => {
    test.skip(browserName !== 'chromium', 'swarm runs once — chromium project only');
    test.setTimeout(240000 + N * 12000);

    const base = Date.now() * 1000 + (process.pid % 1000);
    const SHARED = base;            // the one bid every writer edits
    const SHARED_C = base + 1;
    const ownId = (i) => base + 100 + i;
    const TAG = `E2E SWARM ${process.pid}`;
    // Which writers work offline and return: every 3rd context (≈N/3), never index 0
    // (context 0 seeds the shared bid and must stay online as the live anchor).
    const offlineIdx = new Set();
    for (let i = 1; i < N; i++) if (i % 3 === 1) offlineIdx.add(i);

    // ── 1. Spawn the swarm: N sessions on ONE account, realtime confirmed live. ──
    const ctxs = [];   // extra contexts (context 0 is the fixture page's)
    const pages = [page];
    await step(page, {
      label: `spawn ${N} devices signed into one account`, page: 'cloud', role: 'contractor',
      suspect: 'live-helpers signIn / cloud.js _initRealtimeSubscriptions',
      ruleText: 'every device must boot, sign in, load the account, and confirm realtime',
      expected: `${N} sessions with _tdRealtimeReady=true`,
      act: async () => {
        await page.waitForFunction(() => typeof _tdRealtimeReady !== 'undefined' && _tdRealtimeReady === true, { timeout: 30000 });
        for (let i = 1; i < N; i++) {
          const ctx = await browser.newContext();
          ctxs.push(ctx);
          const pg = await ctx.newPage();
          pages.push(pg);
          await signIn(pg);
        }
        for (const pg of pages) {
          await pg.waitForFunction(() => typeof _tdRealtimeReady !== 'undefined' && _tdRealtimeReady === true, { timeout: 30000 });
        }
        return N;
      },
      rule: async () => {
        const ready = [];
        for (const pg of pages) ready.push(await pg.evaluate(() => typeof _tdRealtimeReady !== 'undefined' && _tdRealtimeReady === true));
        return { ok: ready.every(Boolean), got: `${ready.filter(Boolean).length}/${N} realtime-ready` };
      },
    });

    // ── 2. Seed the shared bid on device 0 → every device receives it. ──
    await step(page, {
      label: 'seed the shared bid every writer will hit', page: 'cloud', role: 'contractor',
      suspect: 'cloud.js supaSaveToCloud → realtime INSERT fan-out',
      ruleText: 'the shared bid must reach all N devices before the swarm writes',
      expected: `bid ${SHARED} present on ${N} devices`,
      act: async () => {
        await page.evaluate(async ({ SHARED, SHARED_C, TAG }) => {
          clients.push({ id: SHARED_C, name: TAG + ' Client', phone: '3165550980', _e2e: 'swarm' });
          bids.push({ id: SHARED, client_id: SHARED_C, client_name: TAG + ' Client', name: TAG + ' shared', amount: 5000, status: 'Pending', bid_date: new Date().toISOString().slice(0, 10), _e2e: 'swarm' });
          saveAll();
          await _flushSaveNow();
        }, { SHARED, SHARED_C, TAG });
        for (const pg of pages) {
          await pg.waitForFunction((id) => (typeof bids !== 'undefined' ? bids : []).some(b => String(b.id) === String(id)), SHARED, { timeout: 45000 }).catch(() => {});
        }
        return 1;
      },
      rule: async () => {
        const seen = [];
        for (const pg of pages) seen.push(await pg.evaluate((id) => (typeof bids !== 'undefined' ? bids : []).some(b => String(b.id) === String(id)), SHARED));
        return { ok: seen.every(Boolean), got: `${seen.filter(Boolean).length}/${N} devices have the shared bid` };
      },
    });

    // ── 3. THE SWARM WRITE: offline crews drop off the network first, then ALL N
    //       devices concurrently stamp their own field on the SHARED bid and create
    //       their own bid. Offline saves fail (by design) — their intent lands in the
    //       durable op log and the offline-pending blob. ──
    await step(page, {
      label: `${N} writers hit the same row + create their own (${offlineIdx.size} of them offline)`, page: 'cloud', role: 'contractor',
      suspect: 'cloud.js _opShadowDerive (intent capture) / supaSaveToCloud (live path)',
      ruleText: 'every writer records its edit locally — live writers push, offline writers queue',
      expected: `every device has its own marker locally`,
      act: async () => {
        for (const i of offlineIdx) await pages[i].context().setOffline(true);
        await Promise.all(pages.map((pg, i) => pg.evaluate(async ({ SHARED, i, own, TAG }) => {
          const b = bids.find(x => String(x.id) === String(SHARED));
          if (b) b['sw_f' + i] = 'v' + i;                       // distinct field, same row
          bids.push({ id: own, client_name: TAG + ' w' + i, name: TAG + ' w' + i, amount: 1000 + i, status: 'Pending', bid_date: new Date().toISOString().slice(0, 10), _e2e: 'swarm' });
          saveAll();                                            // derive (edit-time intent) + debounce
          try { await _flushSaveNow(); } catch (e) {}           // live: pushes; offline: queues pending
        }, { SHARED, i, own: ownId(i), TAG })));
        return N * 2; // one same-row edit + one create per writer
      },
      rule: async () => {
        const ok = [];
        for (let i = 0; i < N; i++) {
          ok.push(await pages[i].evaluate(({ SHARED, i }) => {
            const b = (typeof bids !== 'undefined' ? bids : []).find(x => String(x.id) === String(SHARED));
            return !!(b && b['sw_f' + i] === 'v' + i);
          }, { SHARED, i }));
        }
        return { ok: ok.every(Boolean), got: `${ok.filter(Boolean).length}/${N} writers hold their own marker locally` };
      },
    });

    // ── 4. Offline crews come back STAGGERED (one every ~2s) — each runs the
    //       pull-first rebase, then pushes its merged rows + per-field ops. ──
    await step(page, {
      label: `${offlineIdx.size} offline writers return, staggered`, page: 'cloud', role: 'contractor',
      suspect: 'cloud.js _onReconnect (pull-first rebase) + _opSyncOps (op publish)',
      ruleText: 'each returning device must sync without losing its own offline edits',
      expected: 'every returner still holds its marker after rebase + push',
      act: async () => {
        for (const i of offlineIdx) {
          await pages[i].context().setOffline(false);
          await pages[i].waitForTimeout(2000);
        }
        return offlineIdx.size;
      },
      rule: async () => {
        const ok = [];
        for (const i of offlineIdx) {
          ok.push(await pages[i].evaluate(({ SHARED, i }) => {
            const b = (typeof bids !== 'undefined' ? bids : []).find(x => String(x.id) === String(SHARED));
            return !!(b && b['sw_f' + i] === 'v' + i);
          }, { SHARED, i }));
        }
        return { ok: ok.every(Boolean), got: `${ok.filter(Boolean).length}/${offlineIdx.size} returners kept their marker through the rebase` };
      },
    });

    // ── 5. CONVERGENCE: every device ends with ALL N shared-row markers and ALL N
    //       created bids. This is the union no whole-row LWW can produce — only the
    //       per-field op channel gets here. ──
    const allOwn = Array.from({ length: N }, (_, i) => String(ownId(i)));
    await step(page, {
      label: `all ${N} devices converge to the full union`, page: 'cloud', role: 'contractor',
      suspect: 'cloud.js _opApplyPeerOps / td_ops realtime / reconcile heartbeat',
      ruleText: `the shared bid must carry all ${N} field markers and all ${N} created bids must exist on every device`,
      expected: 'full union on every device',
      act: async () => {
        for (const pg of pages) {
          await pg.waitForFunction(({ SHARED, n, allOwn }) => {
            const arr = (typeof bids !== 'undefined' ? bids : []);
            const b = arr.find(x => String(x.id) === String(SHARED));
            if (!b) return false;
            for (let i = 0; i < n; i++) if (b['sw_f' + i] !== 'v' + i) return false;
            const ids = new Set(arr.map(x => String(x.id)));
            return allOwn.every(id => ids.has(id));
          }, { SHARED, n: N, allOwn }, { timeout: 120000, polling: 1000 }).catch(() => {});
        }
        return 1;
      },
      rule: async () => {
        let full = 0; const detail = [];
        for (let d = 0; d < N; d++) {
          const r = await pages[d].evaluate(({ SHARED, n, allOwn }) => {
            const arr = (typeof bids !== 'undefined' ? bids : []);
            const b = arr.find(x => String(x.id) === String(SHARED));
            const missingF = [];
            for (let i = 0; i < n; i++) if (!b || b['sw_f' + i] !== 'v' + i) missingF.push(i);
            const ids = new Set(arr.map(x => String(x.id)));
            const missingB = allOwn.filter(id => !ids.has(id));
            return { ok: !missingF.length && !missingB.length, missingF, missingB };
          }, { SHARED, n: N, allOwn });
          if (r.ok) full++;
          else detail.push(`d${d}:fields[${r.missingF}] bids[${r.missingB}]`);
        }
        return { ok: full === N, got: `${full}/${N} devices hold the full union${detail.length ? ' — missing: ' + detail.slice(0, 3).join(' | ') : ''}` };
      },
    });

    // ── 6. BYTE-EQUAL: the canonical serialization of the entire bids array is
    //       identical on every device. Not "similar" — identical. ──
    await step(page, {
      label: 'canonical bids state is byte-equal across all devices', page: 'cloud', role: 'contractor',
      suspect: 'cloud.js sync engine (any residual divergence shows here)',
      ruleText: 'after convergence, no two devices may disagree on a single byte of the bids data',
      expected: '1 distinct canonical serialization across all devices',
      act: async () => 1,
      rule: async () => {
        const canons = [];
        for (const pg of pages) {
          canons.push(await pg.evaluate((src) => {
            const canon = eval(src);
            const rows = (typeof bids !== 'undefined' ? bids : []).slice().sort((a, b) => String(a.id) < String(b.id) ? -1 : 1);
            return canon(rows);
          }, canonFnSource));
        }
        const distinct = new Set(canons);
        let diffNote = '';
        if (distinct.size > 1) {
          // Name the divergence instead of just counting states: diff the first two
          // distinct serializations row-by-row (canon output is valid JSON).
          try {
            const [sa, sb] = [...distinct];
            const A = new Map(JSON.parse(sa).map(r => [String(r.id), r]));
            const B = new Map(JSON.parse(sb).map(r => [String(r.id), r]));
            const onlyA = [...A.keys()].filter(k => !B.has(k)).slice(0, 4);
            const onlyB = [...B.keys()].filter(k => !A.has(k)).slice(0, 4);
            const fieldDiffs = [];
            for (const [k, ra] of A) {
              const rb = B.get(k); if (!rb) continue;
              for (const f of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
                if (JSON.stringify(ra[f]) !== JSON.stringify(rb[f])) { fieldDiffs.push(`${k}.${f}: ${JSON.stringify(ra[f])} vs ${JSON.stringify(rb[f])}`); break; }
              }
              if (fieldDiffs.length >= 4) break;
            }
            diffNote = ` :: rowsOnlyInState1=[${onlyA}] rowsOnlyInState2=[${onlyB}] fieldDiffs=[${fieldDiffs.join(' | ')}]`;
          } catch (e) { diffNote = ' :: diff failed: ' + e.message; }
        }
        return { ok: distinct.size === 1, got: `${distinct.size} distinct states across ${N} devices (lens: ${canons.map(c => c.length).join(',')})${diffNote}` };
      },
    });

    // Resource cleanup only (§13.7 — the swarm's DATA stays for inspection).
    for (const ctx of ctxs) await ctx.close().catch(() => {});

    const rep = report(FLOW, BASELINE);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });
});
