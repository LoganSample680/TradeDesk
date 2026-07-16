// REAL flow, OPLOG PHASE 0 (shadow / observability). The first step of the custom
// offline-first oplog: a Hybrid Logical Clock + a SHADOW op-derivation at the save
// choke-point that COUNTS the per-field ops a save would emit (window._opStats) but
// writes nothing authoritative and changes no save/merge behavior. This spec proves,
// against the REAL app, the two things Phase 0 exists to de-risk before any later phase
// makes ops authoritative:
//   • the diff emits clean create/update ops (single edit → an update op naming the field)
//   • the diff NEVER manufactures a phantom delete in normal single-device flow
//     (phantomDeleteCandidates stays 0), the §9.8 trap that could delete an account.
// Plus: the HLC is monotonic across calls. Gated behind window._opLogShadow, enabled
// here via addInitScript BEFORE sign-in so the load-time baseline is built with it on.
const { test, expect } = require('./flow-test');
const { needsLiveCreds, signIn, step, report, resetLedger } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'oplog/shadow-derive';
const baseId = () => Date.now() * 1000 + (process.pid % 1000);
const resetOpStats = (page) => page.evaluate(() => { window._opStats = { emitted: 0, creates: 0, updates: 0, phantomDeleteCandidates: 0 }; });
const readOpStats = (page) => page.evaluate(() => ({ ...window._opStats }));

test.describe('oplog phase 0, shadow op-derivation + HLC (observe-only)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => {
    // Enable the shadow gate BEFORE sign-in so supaLoadFromCloud's _opRebaseline runs
    // with it on and the diff baseline = the loaded cloud rows. (§11.5 ordering: this
    // addInitScript is registered before signIn's goto, so it applies to that load.)
    await page.addInitScript(() => { window._opLogShadow = true; });
    resetLedger();
    await signIn(page);
  });

  test('the HLC is monotonic and strictly increasing across calls', async ({ page }) => {
    await step(page, {
      label: 'pull 6 HLC stamps', page: 'cloud', role: 'contractor',
      suspect: 'cloud.js _hlcNow, persisted (ms,counter,deviceId), counter bumps within a ms',
      ruleText: 'successive HLC stamps must be strictly increasing as sortable strings',
      expected: 'every stamp > the previous one',
      act: async (p) => {
        p.__hlcs = await p.evaluate(() => Array.from({ length: 6 }, () => window.__hlcNow()));
        return 1;
      },
      rule: async (p) => {
        const h = p.__hlcs;
        let ok = Array.isArray(h) && h.every(Boolean);
        for (let i = 1; i < h.length && ok; i++) if (!(h[i] > h[i - 1])) ok = false;
        return { ok, got: JSON.stringify(h) };
      },
    });
    const rep = report(FLOW, BASELINE, page);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });

  test('creating a bid derives a create op and zero phantom deletes', async ({ page }) => {
    const bidId = baseId();
    await step(page, {
      label: 'push a new bid, run the save path, read _opStats', page: 'cloud', role: 'contractor',
      suspect: 'cloud.js _opShadowDerive, new id → create op; absence accounting stays 0',
      ruleText: 'a newly created bid must derive at least one create op and NO phantom-delete candidates',
      expected: '_opStats.creates >= 1 and phantomDeleteCandidates === 0',
      act: async (p) => {
        await resetOpStats(p);
        await p.evaluate(({ bidId }) => {
          bids.push({ id: bidId, client_name: 'E2E Oplog Create ' + bidId, name: 'Oplog Create', amount: 100, status: 'Pending', bid_date: new Date().toISOString().slice(0, 10), _e2e: 'oplog' });
          saveAll(); // real choke-point → supaSaveDebounced → _opShadowDerive (synchronous)
        }, { bidId });
        p.__d = await readOpStats(p);
        p.__op = await p.evaluate(({ bidId }) => window.__opLast('td_bids', bidId), { bidId });
        return 1;
      },
      rule: async (p) => ({
        ok: p.__d.creates >= 1 && p.__d.phantomDeleteCandidates === 0 && !!p.__op && p.__op.table === 'td_bids',
        got: `stats=${JSON.stringify(p.__d)} op=${JSON.stringify(p.__op)}`,
      }),
    });
    const rep = report(FLOW, BASELINE, page);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });

  test('editing one field derives an update op naming that field, no phantom deletes', async ({ page }) => {
    const bidId = baseId() + 1;
    await step(page, {
      label: 'baseline a bid, then change one field', page: 'cloud', role: 'contractor',
      suspect: 'cloud.js _opShadowDerive, field-level diff vs incremental baseline',
      ruleText: 'changing one field must derive an update op whose fields include only the changed key, with 0 phantom deletes',
      expected: 'update op for the bid with fields.amount set; phantomDeleteCandidates === 0',
      act: async (p) => {
        // Seed + run the save path once so the bid enters the incremental baseline.
        await p.evaluate(({ bidId }) => {
          bids.push({ id: bidId, client_name: 'E2E Oplog Edit ' + bidId, name: 'Oplog Edit', amount: 100, status: 'Pending', _e2e: 'oplog' });
          saveAll();
        }, { bidId });
        await resetOpStats(p);
        await p.evaluate(({ bidId }) => {
          bids.find(b => b.id === bidId).amount = 250; // one field
          saveAll();
        }, { bidId });
        p.__d = await readOpStats(p);
        p.__op = await p.evaluate(({ bidId }) => window.__opLast('td_bids', bidId), { bidId });
        return 1;
      },
      rule: async (p) => {
        const f = p.__op && p.__op.fields;
        const ok = p.__d.updates >= 1 && p.__d.phantomDeleteCandidates === 0
          && !!f && f.amount === 250 && !('status' in f) && !('name' in f);
        return { ok, got: `stats=${JSON.stringify(p.__d)} fields=${JSON.stringify(f)}` };
      },
    });
    const rep = report(FLOW, BASELINE, page);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });

  test('a save with no change derives zero ops and zero phantom deletes', async ({ page }) => {
    const bidId = baseId() + 2;
    await step(page, {
      label: 'baseline a bid, then save again unchanged', page: 'cloud', role: 'contractor',
      suspect: 'cloud.js _opShadowDerive, unchanged rows skipped (hash equal)',
      ruleText: 'a no-op save must derive zero ops and zero phantom-delete candidates',
      expected: '_opStats.emitted === 0 and phantomDeleteCandidates === 0',
      act: async (p) => {
        await p.evaluate(({ bidId }) => {
          bids.push({ id: bidId, client_name: 'E2E Oplog Noop ' + bidId, name: 'Oplog Noop', amount: 100, status: 'Pending', _e2e: 'oplog' });
          saveAll();
        }, { bidId });
        await resetOpStats(p);
        await p.evaluate(() => { saveAll(); }); // no mutation
        p.__d = await readOpStats(p);
        return 1;
      },
      rule: async (p) => ({ ok: p.__d.emitted === 0 && p.__d.phantomDeleteCandidates === 0, got: JSON.stringify(p.__d) }),
    });
    const rep = report(FLOW, BASELINE, page);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });
});

// PHASE 1+2+3, durable IndexedDB op log + per-field HLC field clocks (Phase 1), the
// per-field HLC merge (Phase 2), and the AUTHORITATIVE field-clock-protected merge on
// incoming peer records (Phase 3). Gated behind window._opLogShadow.
test.describe('oplog phase 1+2+3, durable op log + per-field merge + authoritative apply', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { window._opLogShadow = true; });
    resetLedger();
    await signIn(page);
  });

  // ASSERTION UPDATED with the prune-on-ack redesign (§11.4). OLD behavior: ops
  // accumulated in IndexedDB forever, so "count > 0 after reload" proved durability.
  // NEW intended behavior: a successful save PUBLISHES pending ops to td_ops and
  // prunes them locally (the log holds only un-acked intent, O(pending)). Durability
  // is therefore: the intent survives a reload as EITHER a still-pending local op OR
  // a published td_ops row, and the field clock must still rehydrate either way
  // (from the local log pre-publish, or from the td_ops pull post-publish).
  test('Phase 1: a derived op is durable across a reload, pending locally or published to td_ops (field clock rehydrates)', async ({ page }) => {
    const bidId = baseId() + 10;
    await step(page, {
      label: 'create a bid → op persisted → reload → intent still durable (local or td_ops) + clock rehydrated', page: 'cloud', role: 'contractor',
      suspect: 'cloud.js _opPersist / _opDbLoad / _opSyncOps: durable op log + publish/prune + field-clock rehydrate',
      ruleText: 'a derived op must be durably held (local log before publish, td_ops after) and its field clock must rehydrate across a reload',
      expected: 'opDbCount > 0 before reload; after reload the op is pending locally OR published to td_ops; field clock present',
      act: async (p) => {
        await p.evaluate(({ bidId }) => {
          bids.push({ id: bidId, client_name: 'E2E Oplog Durable ' + bidId, name: 'Durable', amount: 100, status: 'Pending', _e2e: 'oplog' });
          saveAll(); // → supaSaveDebounced → _opShadowDerive → _opPersist (IndexedDB add)
        }, { bidId });
        await p.waitForTimeout(400); // let the async IndexedDB add settle (debounced save hasn't fired yet)
        p.__before = await p.evaluate(() => window.__opDbCount());
        await p.reload({ waitUntil: 'domcontentloaded' });
        await p.waitForFunction(() => typeof _supaUser !== 'undefined' && _supaUser && _supaUser.id, { timeout: 30000 });
        await p.waitForFunction(() => typeof _supaCloudLoaded === 'undefined' || _supaCloudLoaded === true, { timeout: 30000 }).catch(() => {});
        await p.waitForTimeout(3000); // boot flush → save → publish+prune can complete; clocks rehydrate either way
        p.__after = await p.evaluate(() => window.__opDbCount());
        p.__published = await p.evaluate(async ({ bidId }) => {
          try {
            const { data } = await _supa.from('td_ops').select('row_id').eq('user_id', _supaUser.id).eq('row_id', String(bidId)).limit(1);
            return !!(data && data.length);
          } catch (e) { return false; }
        }, { bidId });
        p.__clock = await p.evaluate(({ bidId }) => window.__fieldClock('td_bids', bidId, 'amount'), { bidId });
        return 1;
      },
      rule: async (p) => ({
        ok: p.__before > 0 && (p.__after > 0 || p.__published) && typeof p.__clock === 'string' && p.__clock.length > 0,
        got: `dbCount before=${p.__before} after=${p.__after} publishedToTdOps=${p.__published} clockAfterReload=${p.__clock}`,
      }),
    });
    const rep = report(FLOW, BASELINE, page);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });

  test('Phase 1: editing a field advances that field\'s HLC clock', async ({ page }) => {
    const bidId = baseId() + 11;
    await step(page, {
      label: 'baseline a bid, edit amount twice, assert the field clock advances', page: 'cloud', role: 'contractor',
      suspect: 'cloud.js _opStampFields, per-field HLC clock stamped on each change',
      ruleText: 'editing a field must stamp its HLC clock, and a later edit must advance it',
      expected: 'a non-empty clock after the first edit, strictly greater after the second',
      act: async (p) => {
        await p.evaluate(({ bidId }) => {
          bids.push({ id: bidId, client_name: 'E2E Oplog Clock ' + bidId, name: 'Clock', amount: 100, status: 'Pending', _e2e: 'oplog' });
          saveAll();
        }, { bidId });
        await p.evaluate(({ bidId }) => { bids.find(b => b.id === bidId).amount = 250; saveAll(); }, { bidId });
        await p.waitForTimeout(150);
        p.__c1 = await p.evaluate(({ bidId }) => window.__fieldClock('td_bids', bidId, 'amount'), { bidId });
        await p.evaluate(({ bidId }) => { bids.find(b => b.id === bidId).amount = 400; saveAll(); }, { bidId });
        await p.waitForTimeout(150);
        p.__c2 = await p.evaluate(({ bidId }) => window.__fieldClock('td_bids', bidId, 'amount'), { bidId });
        return 1;
      },
      rule: async (p) => ({
        ok: typeof p.__c1 === 'string' && typeof p.__c2 === 'string' && p.__c2 > p.__c1,
        got: `clock1=${p.__c1} clock2=${p.__c2}`,
      }),
    });
    const rep = report(FLOW, BASELINE, page);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });

  test('Phase 2: per-field HLC merge keeps the newer value per field (both directions)', async ({ page }) => {
    await step(page, {
      label: 'merge two rows whose fields carry different HLC clocks', page: 'cloud', role: 'contractor',
      suspect: 'cloud.js _opMergeRows, per-field last-writer-wins by HLC',
      ruleText: 'a per-field merge must take each field from whichever side has the higher HLC, so concurrent edits to different fields both survive',
      expected: 'incoming-newer field wins; local-newer field is kept; an untouched local field survives',
      act: async (p) => {
        p.__r = await p.evaluate(() => {
          const h1 = window.__hlcNow();
          const h2 = window.__hlcNow(); // strictly greater than h1
          // Incoming `amount` is NEWER (h2); local `name` exists only locally.
          const a = window.__opMerge('td_bids', { amount: 100, name: 'A' }, { amount: h1, name: h1 }, { amount: 200 }, { amount: h2 });
          // Local `amount` is NEWER (h2) → local kept over the incoming h1.
          const b = window.__opMerge('td_bids', { amount: 100, name: 'A' }, { amount: h2, name: h2 }, { amount: 200 }, { amount: h1 });
          return { a, b, ordered: h2 > h1 };
        });
        return 1;
      },
      rule: async (p) => {
        const { a, b, ordered } = p.__r || {};
        const ok = !!ordered && !!a && !!b
          && a.amount === 200 && a.name === 'A'   // incoming amount won; local-only name survived
          && b.amount === 100 && b.name === 'A';  // local amount kept (newer)
        return { ok, got: JSON.stringify(p.__r) };
      },
    });
    const rep = report(FLOW, BASELINE, page);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });

  test('Phase 3: authoritative apply protects a locally-newer field but takes everything else', async ({ page }) => {
    const bidId = baseId() + 12;
    await step(page, {
      label: 'passive receiver takes incoming as-is; a locally-newer field is protected from a stale peer', page: 'cloud', role: 'contractor',
      suspect: 'cloud.js _opApplyIncoming, field-clock-protected authoritative merge in _applyRealtimeRecord',
      ruleText: 'an incoming peer record replaces fields wholesale UNLESS this device edited a field more recently than the incoming version, which is then protected',
      expected: 'no local edit → incoming wins all; a local edit newer than a stale peer is kept; a fresher peer still wins',
      act: async (p) => {
        p.__r = await p.evaluate(({ bidId }) => {
          // (A) Passive receiver: a row this device never edited → merge returns incoming as-is
          // (this is why normal realtime sync is unchanged by Phase 3).
          const passive = window.__opApplyIncoming('td_bids', { id: bidId + 500, amount: 10, status: 'Y' }, { id: bidId + 500, amount: 50, status: 'X' }, new Date().toISOString());
          // (B) A local edit stamps a fresh field clock for `amount`.
          bids.push({ id: bidId, client_name: 'C', name: 'N', amount: 100, status: 'Pending', _e2e: 'oplog' });
          saveAll();
          bids.find(x => x.id === bidId).amount = 999; saveAll();
          const local = JSON.parse(JSON.stringify(bids.find(x => x.id === bidId)));
          const stalePeer = window.__opApplyIncoming('td_bids', local, { id: bidId, amount: 5 }, new Date(Date.now() - 60000).toISOString());
          const freshPeer = window.__opApplyIncoming('td_bids', local, { id: bidId, amount: 7 }, new Date(Date.now() + 60000).toISOString());
          return { passive, stalePeerAmount: stalePeer && stalePeer.amount, freshPeerAmount: freshPeer && freshPeer.amount };
        }, { bidId });
        return 1;
      },
      rule: async (p) => {
        const r = p.__r || {};
        const ok = !!r.passive && r.passive.amount === 50 && r.passive.status === 'X' // passive → incoming wins all
          && r.stalePeerAmount === 999  // local edit protected from a stale peer
          && r.freshPeerAmount === 7;   // a fresher peer still wins
        return { ok, got: JSON.stringify(r) };
      },
    });
    const rep = report(FLOW, BASELINE, page);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });

  test('an amount-less in-progress draft SURVIVES a full reload (never load-filtered)', async ({ page }) => {
    // Owner-reported 53-vs-43: a post-load filter stripped shell drafts from memory, so
    // "things to build" vanished on refresh while un-reloaded devices still showed them.
    // A draft with no amount/lines is USER INTENT (the build feed renders it with
    // "finish & send" + Discard), a reload must never hide or drop it.
    const bidId = baseId() + 60, clientId = baseId() + 61;
    await step(page, {
      label: 'create a shell draft, flush, hard-reload, draft still present', page: 'cloud', role: 'contractor',
      suspect: 'cloud.js supaLoadFromCloud post-load bid filters (must not exist)',
      ruleText: 'an in-progress draft must survive a reload byte-for-byte visible',
      expected: 'draft present in bids[] with draft/Draft status after reload',
      act: async (p) => {
        await p.evaluate(async ({ bidId, clientId }) => {
          clients.push({ id: clientId, name: 'E2E Shell ' + bidId, phone: '3165550779', _e2e: 'oplog' });
          bids.push({ id: bidId, client_id: clientId, client_name: 'E2E Shell ' + bidId, bid_date: new Date().toISOString().slice(0, 10), status: 'Draft', draft: true, _e2e: 'oplog' });
          saveAll(); await _flushSaveNow();
        }, { bidId, clientId });
        await p.reload({ waitUntil: 'domcontentloaded' });
        await p.waitForFunction(() => typeof _supaCloudLoaded !== 'undefined' && _supaCloudLoaded === true, { timeout: 45000 });
        return 3;
      },
      rule: async (p) => {
        const r = await p.evaluate((id) => {
          const b = (typeof bids !== 'undefined' ? bids : []).find(x => String(x.id) === String(id));
          return { present: !!b, draft: !!(b && (b.draft || b.status === 'Draft')) };
        }, bidId);
        return { ok: r.present && r.draft, got: `present=${r.present} draft=${r.draft}` };
      },
    });
    const rep = report(FLOW, BASELINE, page);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });
});
