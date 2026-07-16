// CREW CERTIFICATION, the production shape of "1000 people rolled up to one owner":
// N DISTINCT crew logins (real auth users, no owner graph of their own) nest under one
// contractor and hammer the SAME account concurrently. This is the crew twin of
// swarm-convergence-flow (which runs N devices on the OWNER login), it certifies the
// server half built in 20260715_crew_rls_and_invites.sql:
//
//   • LINKING, both real paths: half the crew joins via the server-minted single-use
//     TOKEN (?emp_invite= with tok → claim_crew_invite), half via EMAIL MATCH, and
//     every one must land nested (_isEmployee, _contractorUserId === boss).
//   • WRITES: crew with estimate permission edit the SAME shared bid (distinct fields)
//     and create their own bids, the td_* crew policies + op channel + cursor-bump RPC
//     must converge everyone (boss included) to the full union, byte-equal on the
//     shared row. One crew member does it OFFLINE and returns (pull-first rebase).
//   • ADVERSARIAL ISOLATION (the "bulletproof" part):
//       – a crew member WITHOUT estimate permission reads td_bids raw → RLS EMPTY,
//         and their direct write is REJECTED by the database;
//       – any crew member reads td_income (financials) → EMPTY, write REJECTED;
//       – a crew member of boss A touching boss B's tables → EMPTY / REJECTED;
//       – a used invite token claimed by a different login → refused.
//
// LOCAL-STACK only (needs the provisioned crew pool + hammers one account). Per §13.7
// all seeded data stays; only the extra contexts are closed.
const { test, expect } = require('./flow-test');
const { needsLiveCreds, signIn, step, report, resetLedger, workerAccount, localPool, crewPool } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'crew/convergence';
const LOCAL_STACK = process.env.E2E_LOCAL_STACK === '1';

const canonFnSource = `
  (function canon(v){
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
    return JSON.stringify(v);
  })
`;

// Sign a CREW account in through the app (arbitrary creds, signIn() is bound to the
// worker account). `query` lets the token half arrive via the real ?emp_invite= URL.
async function crewSignIn(pg, acct, query) {
  await pg.goto('/' + (query || ''), { waitUntil: 'domcontentloaded', timeout: 30000 });
  await pg.waitForSelector('#supa-email', { state: 'attached', timeout: 30000 });
  const res = await pg.evaluate(async ({ email, password }) => {
    if (typeof _supa === 'undefined' || !_supa) return { ok: false, why: 'client not initialized' };
    let lastWhy = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const { error } = await _supa.auth.signInWithPassword({ email, password });
        if (!error) return { ok: true };
        lastWhy = error.message || `empty-error(${error.status || '?'})`;
        const transient = !error.message || error.status === 429 || /network|fetch|timeout|rate/i.test(error.message || '');
        if (!transient) return { ok: false, why: lastWhy };
      } catch (e) { lastWhy = 'exception: ' + (e && e.message); }
      await new Promise(r => setTimeout(r, 400 * Math.pow(2, attempt)));
    }
    return { ok: false, why: lastWhy };
  }, { email: acct.email, password: acct.password });
  if (!res.ok) throw new Error(`crew sign-in failed (${acct.email}): ${res.why}`);
  await pg.waitForFunction(() => typeof _supaUser !== 'undefined' && _supaUser && _supaUser.id, { timeout: 30000 });
}

test.describe('crew: N distinct employee logins nest under one owner and converge', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured');
  test.skip(!LOCAL_STACK, 'crew certification runs on the local stack only (provisioned crew pool)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('crew link (token + email), write concurrently, converge byte-equal, and stay walled off', async ({ page, browser, browserName }) => {
    // Runs on BOTH browser projects since the per-browser runner split (own stack per box).
    const CREW = crewPool();
    test.skip(CREW.length < 3, `crew pool too small (${CREW.length}): global-setup provisions it on the local stack`);
    const M = Math.min(CREW.length, 6);
    // 7 REAL boots (boss + M crew) against an account that GROWS every run by design
    // (§13.7: live tests never clean up their seed data). Boot cost scales with the
    // accumulated rows/hub refreshes, so the budget tracks it: the old 240k+M*20k
    // (=360s at M=6) was hit exactly once the account got heavy enough.
    test.setTimeout(360000 + M * 30000);

    const bossUid = (workerAccount() || {}).uid;
    const base = Date.now() * 1000 + (process.pid % 1000);
    const SHARED = base, SHARED_C = base + 1;
    const crewBid = (i) => base + 200 + i;
    const TAG = `E2E CREW ${process.pid}`;
    // Last crew member gets NO estimate permission, the redaction adversary.
    const noEstIdx = M - 1;
    const editorIdx = Array.from({ length: M }, (_, i) => i).filter(i => i !== noEstIdx);
    const tokenHalf = (i) => i % 2 === 0; // even indexes link via server token, odd via email match

    const ctxs = []; const crewPages = [];
    const tokens = {};

    // ── 1. Boss seeds the roster (permissions per member) + mints tokens for half. ──
    await step(page, {
      label: `boss seeds ${M} roster rows + mints ${editorIdx.length ? Math.ceil(M / 2) : 0} claim tokens`, page: 'cloud', role: 'contractor',
      suspect: 'cloud.js _mintCrewInviteToken / crew_invites RLS (contractor-only mint)',
      ruleText: 'every roster row must upsert and every requested token must mint',
      expected: `${M} roster rows, tokens for the even half`,
      act: async (p) => {
        p.__seed = await p.evaluate(async ({ CREW, M, noEstIdx, TAG }) => {
          const out = { rows: 0, tokens: {}, errs: [] };
          for (let i = 0; i < M; i++) {
            const perms = i === noEstIdx
              ? { estimate: false, financials: false, collect: false, expenses: false, mileage: false, schedule: true, clients: true }
              : { estimate: true, financials: false, collect: false, expenses: false, mileage: false, schedule: true, clients: true };
            const { data: row, error } = await _supa.from('team_members').upsert({
              contractor_user_id: _supaUser.id, email: CREW[i].email, name: `${TAG} w${i}`, role: 'tech',
              permissions: perms, employee_user_id: null, active: false, invited_at: new Date().toISOString(),
            }, { onConflict: 'contractor_user_id,email' }).select('id').single();
            if (error || !row) { out.errs.push(`row${i}:${error && error.message}`); continue; }
            out.rows++;
            if (i % 2 === 0) {
              const { data: inv, error: ie } = await _supa.from('crew_invites').insert({ contractor_user_id: _supaUser.id, team_member_id: row.id, email: CREW[i].email }).select('token').single();
              if (ie || !inv) out.errs.push(`tok${i}:${ie && ie.message}`);
              else out.tokens[i] = inv.token;
            }
          }
          return out;
        }, { CREW, M, noEstIdx, TAG });
        Object.assign(tokens, p.__seed.tokens);
        return M;
      },
      rule: async (p) => ({
        ok: p.__seed.rows === M && p.__seed.errs.length === 0,
        got: `rows=${p.__seed.rows}/${M} tokens=${Object.keys(p.__seed.tokens).length} errs=[${p.__seed.errs.join(' | ')}]`,
      }),
    });

    // ── 2. Crew sign in, token half via the real ?emp_invite= URL, email half bare.
    //       EVERY one must nest under the boss. ──
    await step(page, {
      label: `${M} crew logins nest under the boss (token + email-match paths)`, page: 'cloud', role: 'employee',
      suspect: 'cloud.js loadAccountData crew linking (claim_crew_invite / email match)',
      ruleText: 'every crew login must come up _isEmployee with _contractorUserId === the boss uid',
      expected: `${M}/${M} nested`,
      act: async () => {
        for (let i = 0; i < M; i++) {
          const ctx = await browser.newContext();
          ctxs.push(ctx);
          const pg = await ctx.newPage();
          crewPages.push(pg);
          const query = tokens[i]
            ? '?emp_invite=' + Buffer.from(JSON.stringify({ cid: bossUid, eid: base + i, email: CREW[i].email, bname: 'E2E Boss', ename: `${TAG} w${i}`, tok: tokens[i] })).toString('base64')
            : '';
          await crewSignIn(pg, CREW[i], query);
          await pg.waitForFunction((boss) =>
            typeof _isEmployee !== 'undefined' && _isEmployee === true &&
            typeof _contractorUserId !== 'undefined' && String(_contractorUserId) === String(boss),
          bossUid, { timeout: 30000 });
          await pg.waitForFunction(() => typeof _supaCloudLoaded === 'undefined' || _supaCloudLoaded === true, { timeout: 30000 }).catch(() => {});
        }
        return M;
      },
      rule: async () => {
        const nested = [];
        for (const pg of crewPages) nested.push(await pg.evaluate((boss) => typeof _isEmployee !== 'undefined' && _isEmployee === true && String(_contractorUserId) === String(boss), bossUid));
        return { ok: nested.every(Boolean) && nested.length === M, got: `${nested.filter(Boolean).length}/${M} nested (token half + email half)` };
      },
    });

    // ── 3. Boss seeds the shared bid → estimate-crew must receive it. ──
    await step(page, {
      label: 'boss creates the shared bid → estimate-crew receive it', page: 'cloud', role: 'contractor',
      suspect: 'crew RLS SELECT (realtime/delta for permitted tables) + get_account_cursor heartbeat',
      ruleText: 'a bid the boss creates must reach every estimate-permission crew device without a manual reload',
      expected: `bid ${SHARED} on ${editorIdx.length} crew devices`,
      act: async (p) => {
        await p.evaluate(async ({ SHARED, SHARED_C, TAG }) => {
          clients.push({ id: SHARED_C, name: TAG + ' Client', phone: '3165550990', _e2e: 'crew' });
          bids.push({ id: SHARED, client_id: SHARED_C, client_name: TAG + ' Client', name: TAG + ' shared', amount: 7000, status: 'Pending', bid_date: new Date().toISOString().slice(0, 10), _e2e: 'crew' });
          saveAll(); await _flushSaveNow();
        }, { SHARED, SHARED_C, TAG });
        for (const i of editorIdx) {
          await crewPages[i].waitForFunction((id) => (typeof bids !== 'undefined' ? bids : []).some(b => String(b.id) === String(id)), SHARED, { timeout: 60000 }).catch(() => {});
        }
        return 1;
      },
      rule: async () => {
        const seen = [];
        for (const i of editorIdx) seen.push(await crewPages[i].evaluate((id) => (typeof bids !== 'undefined' ? bids : []).some(b => String(b.id) === String(id)), SHARED));
        return { ok: seen.every(Boolean), got: `${seen.filter(Boolean).length}/${editorIdx.length} estimate-crew have the shared bid` };
      },
    });

    // ── 4. THE CREW WRITE: every estimate-crew stamps its own field on the SHARED bid
    //       and creates its own bid; ONE of them does it fully OFFLINE and returns. ──
    const offlineIdx = editorIdx[editorIdx.length - 1];
    await step(page, {
      label: `${editorIdx.length} crew write the same row + own bids (w${offlineIdx} offline)`, page: 'cloud', role: 'employee',
      suspect: 'td_* crew policies (writes) + bump_account_cursor + op channel for crew',
      ruleText: 'every crew edit must persist server-side under the crew RLS; the offline writer queues and rebases on return',
      expected: 'every editor holds its marker locally; live saves commit',
      act: async () => {
        await crewPages[offlineIdx].context().setOffline(true);
        await Promise.all(editorIdx.map((i) => crewPages[i].evaluate(async ({ SHARED, i, own, TAG }) => {
          window._syncTrace = 1; // arm the merge/load trace BEFORE the write, names any path that later erases the marker
          const b = bids.find(x => String(x.id) === String(SHARED));
          if (b) b['crew_f' + i] = 'cv' + i;
          bids.push({ id: own, client_name: TAG + ' by w' + i, name: TAG + ' by w' + i, amount: 900 + i, status: 'Pending', bid_date: new Date().toISOString().slice(0, 10), _e2e: 'crew' });
          saveAll();
          try { await _flushSaveNow(); } catch (e) {}
        }, { SHARED, i, own: crewBid(i), TAG })));
        await crewPages[offlineIdx].waitForTimeout(1500);
        await crewPages[offlineIdx].context().setOffline(false);
        return editorIdx.length * 2;
      },
      rule: async () => {
        const detail = [];
        let held = 0;
        for (const i of editorIdx) {
          const d = await crewPages[i].evaluate(({ SHARED, i }) => {
            const b = (typeof bids !== 'undefined' ? bids : []).find(x => String(x.id) === String(SHARED));
            return {
              has: !!(b && b['crew_f' + i] === 'cv' + i),
              rowPresent: !!b,
              clock: (typeof window.__fieldClock === 'function' && window.__fieldClock('td_bids', String(SHARED), 'crew_f' + i)) || null,
              pending: localStorage.getItem('zp3_pending_sync') === '1',
              saveInFlight: typeof _pendingSavePromise !== 'undefined' && !!_pendingSavePromise,
              loadInProgress: typeof _loadInProgress !== 'undefined' && _loadInProgress,
              trace: (window._syncTraceLog || [])
                .filter(e => e.src === 'load' || (String(e.id) === String(SHARED) && e.lost && e.lost.length))
                .slice(-12)
                .map(e => e.src === 'load' ? `load(${e.delta ? 'delta' : 'FULL'})` : `${e.src}:lost[${(e.lost || []).join(',')}]@inc${e.incMs}`)
                .join(' '),
            };
          }, { SHARED, i });
          if (d.has) held++;
          else detail.push(`w${i}:row=${d.rowPresent} clock=${d.clock ? 'SET' : 'ABSENT'} pending=${d.pending} save=${d.saveInFlight} load=${d.loadInProgress} trace=[${d.trace}]`);
        }
        // clock=SET + marker gone ⇒ a merge dropped a CAPTURED edit (engine bug);
        // clock=ABSENT ⇒ the edit was never derived (save-path bug on crew logins).
        return { ok: held === editorIdx.length, got: `${held}/${editorIdx.length} editors hold their marker${detail.length ? ', ' + detail.join(' | ') : ''}` };
      },
    });

    // ── 5. CONVERGENCE: boss + every estimate-crew end with ALL markers + ALL crew bids. ──
    const allCrewBids = editorIdx.map(i => String(crewBid(i)));
    const convergedPages = [page, ...editorIdx.map(i => crewPages[i])];
    await step(page, {
      label: 'boss + estimate-crew converge to the full union', page: 'cloud', role: 'contractor',
      suspect: 'crew sync fabric end-to-end (RLS reads + op channel + cursor RPCs + rebase)',
      ruleText: 'the shared bid must carry every crew marker and every crew-created bid must exist on the boss and every estimate-crew device',
      expected: 'full union everywhere',
      act: async () => {
        for (const pg of convergedPages) {
          await pg.waitForFunction(({ SHARED, idxs, allCrewBids }) => {
            const arr = (typeof bids !== 'undefined' ? bids : []);
            const b = arr.find(x => String(x.id) === String(SHARED));
            if (!b) return false;
            for (const i of idxs) if (b['crew_f' + i] !== 'cv' + i) return false;
            const ids = new Set(arr.map(x => String(x.id)));
            return allCrewBids.every(id => ids.has(id));
          }, { SHARED, idxs: editorIdx, allCrewBids }, { timeout: 150000, polling: 1000 }).catch(() => {});
        }
        return 1;
      },
      rule: async () => {
        let full = 0; const detail = [];
        for (let d = 0; d < convergedPages.length; d++) {
          const r = await convergedPages[d].evaluate(({ SHARED, idxs, allCrewBids }) => {
            const arr = (typeof bids !== 'undefined' ? bids : []);
            const b = arr.find(x => String(x.id) === String(SHARED));
            const mf = []; for (const i of idxs) if (!b || b['crew_f' + i] !== 'cv' + i) mf.push(i);
            const ids = new Set(arr.map(x => String(x.id)));
            const mb = allCrewBids.filter(id => !ids.has(id));
            return { ok: !mf.length && !mb.length, mf, mb };
          }, { SHARED, idxs: editorIdx, allCrewBids });
          if (r.ok) full++; else detail.push(`d${d}:fields[${r.mf}] bids[${r.mb}]`);
        }
        return { ok: full === convergedPages.length, got: `${full}/${convergedPages.length} devices hold the union${detail.length ? ', missing: ' + detail.slice(0, 3).join(' | ') : ''}` };
      },
    });

    // ── 6. Byte-equal on the SHARED bid across boss + estimate-crew (full-array
    //       equality is deliberately NOT asserted: crew views are permission-filtered). ──
    await step(page, {
      label: 'the shared bid is byte-equal on the boss and every estimate-crew device', page: 'cloud', role: 'contractor',
      suspect: 'cloud.js per-field merge under crew RLS',
      ruleText: 'no device may disagree on a single byte of the shared row',
      expected: '1 distinct canonical serialization',
      act: async () => 1,
      rule: async () => {
        const canons = [];
        for (const pg of convergedPages) {
          canons.push(await pg.evaluate(({ src, SHARED }) => {
            const canon = eval(src);
            const b = (typeof bids !== 'undefined' ? bids : []).find(x => String(x.id) === String(SHARED));
            return canon(b || null);
          }, { src: canonFnSource, SHARED }));
        }
        const distinct = new Set(canons);
        return { ok: distinct.size === 1 && !canons.includes('null'), got: `${distinct.size} distinct states (lens: ${canons.map(c => (c || '').length).join(',')})` };
      },
    });

    // ── 7. ADVERSARIAL ISOLATION, the walls hold. ──
    const otherBoss = (localPool()[1] && localPool()[1].uid !== bossUid) ? localPool()[1].uid : (localPool()[2] || {}).uid;
    await step(page, {
      label: 'permission + cross-boss walls hold; used token refused', page: 'cloud', role: 'employee',
      suspect: 'crew_perm policies / claim_crew_invite single-use',
      ruleText: 'redacted tables read empty and reject writes; another boss\'s data is unreachable; a burned token cannot be re-claimed by another login',
      expected: 'all probes denied',
      act: async (p) => {
        // (a) no-estimate crew: td_bids raw read must be EMPTY, direct write REJECTED.
        p.__a = await crewPages[noEstIdx].evaluate(async ({ boss }) => {
          const r = await _supa.from('td_bids').select('id').eq('user_id', boss).limit(5);
          const w = await _supa.from('td_bids').upsert({ id: 'adv-noest-1', user_id: boss, data: { id: 'adv-noest-1', amount: 1 }, updated_at: new Date().toISOString() }, { onConflict: 'id,user_id' });
          return { readCount: (r.data || []).length, readErr: r.error && r.error.code, writeDenied: !!w.error, writeCode: w.error && w.error.code };
        }, { boss: bossUid });
        // (b) any crew: td_income read EMPTY, write REJECTED (financials).
        p.__b = await crewPages[editorIdx[0]].evaluate(async ({ boss }) => {
          const r = await _supa.from('td_income').select('id').eq('user_id', boss).limit(5);
          const w = await _supa.from('td_income').upsert({ id: 'adv-inc-1', user_id: boss, data: { id: 'adv-inc-1', amount: 999 }, updated_at: new Date().toISOString() }, { onConflict: 'id,user_id' });
          return { readCount: (r.data || []).length, writeDenied: !!w.error };
        }, { boss: bossUid });
        // (c) cross-boss: crew of THIS boss touching ANOTHER contractor's tables.
        p.__c = otherBoss ? await crewPages[editorIdx[0]].evaluate(async ({ other }) => {
          const r = await _supa.from('td_clients').select('id').eq('user_id', other).limit(5);
          const w = await _supa.from('td_clients').upsert({ id: 'adv-x-1', user_id: other, data: { id: 'adv-x-1', name: 'intruder' }, updated_at: new Date().toISOString() }, { onConflict: 'id,user_id' });
          return { readCount: (r.data || []).length, writeDenied: !!w.error };
        }, { other: otherBoss }) : { readCount: 0, writeDenied: true, skipped: true };
        // (d) a BURNED token re-claimed by a different login → refused.
        const usedTok = Object.values(tokens)[0];
        p.__d = usedTok ? await crewPages[noEstIdx].evaluate(async ({ tok }) => {
          try { const { data } = await _supa.rpc('claim_crew_invite', { tok }); return { ok: data && data.ok === true, reason: data && data.reason }; }
          catch (e) { return { ok: false, reason: 'threw' }; }
        }, { tok: usedTok }) : { ok: false, reason: 'no-token-minted' };
        return 4;
      },
      rule: async (p) => {
        const a = p.__a, b = p.__b, c = p.__c, d = p.__d;
        const ok = a.readCount === 0 && a.writeDenied === true
          && b.readCount === 0 && b.writeDenied === true
          && c.readCount === 0 && c.writeDenied === true
          && d.ok === false;
        return { ok, got: `noEst bids read=${a.readCount} writeDenied=${a.writeDenied}(${a.writeCode || ''}) · income read=${b.readCount} writeDenied=${b.writeDenied} · crossBoss read=${c.readCount} writeDenied=${c.writeDenied}${c.skipped ? '(skipped)' : ''} · usedToken reclaim ok=${d.ok} reason=${d.reason}` };
      },
    });

    // Resource cleanup only (§13.7: all seeded data stays for inspection).
    for (const ctx of ctxs) await ctx.close().catch(() => {});

    const rep = report(FLOW, BASELINE, page);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });

  // ── THE BUSINESS STORY, end to end: owner invites → employee accepts with
  //    estimate permission → employee WRITES AN ESTIMATE → it rolls up LIVE to
  //    every user on the account (the boss AND a second crew member), identical. ──
  test('owner invites → employee accepts (estimate) → writes an estimate → rolls up to ALL users', async ({ page, browser, browserName }) => {
    // Runs on BOTH browser projects since the per-browser runner split (own stack per box).
    const CREW = crewPool();
    test.skip(CREW.length < 2, `crew pool too small (${CREW.length})`);
    test.setTimeout(420000); // 3 real boots on the ever-growing cert account (see test 1)

    const FLOW2 = 'crew/estimate-rollup';
    const bossUid = (workerAccount() || {}).uid;
    const base = Date.now() * 1000 + ((process.pid + 137) % 1000);
    const estBidId = base + 300, estClientId = base + 301;
    const TAG = `E2E ROLLUP ${process.pid}`;
    const E1 = CREW[0], E2 = CREW[1];
    const ESTIMATE_PERMS = { estimate: true, financials: false, collect: false, expenses: false, mileage: false, schedule: true, clients: true };

    const ctxs = []; const pages = {};
    const toks = {};

    // 1. OWNER INVITES, through the app's REAL minting path (_mintCrewInviteToken),
    //    exactly what the Add Member modal runs: roster row (permissions riding along)
    //    then a server-minted single-use claim token.
    await step(page, {
      label: 'owner invites two crew members with estimate permission (real mint path)', page: 'pg-settings', role: 'contractor',
      suspect: 'cloud.js _mintCrewInviteToken + team_members upsert (permissions ride along)',
      ruleText: 'both roster rows must upsert with estimate permission and both tokens must mint',
      expected: '2 roster rows, 2 tokens',
      act: async (p) => {
        p.__inv = await p.evaluate(async ({ E1email, E2email, TAG, perms }) => {
          const out = { toks: {}, errs: [] };
          for (const [k, email] of [['e1', E1email], ['e2', E2email]]) {
            const { error } = await _supa.from('team_members').upsert({
              contractor_user_id: _supaUser.id, email, name: `${TAG} ${k}`, role: 'tech',
              permissions: perms, employee_user_id: null, active: false, invited_at: new Date().toISOString(),
            }, { onConflict: 'contractor_user_id,email' });
            if (error) { out.errs.push(`${k}:${error.message}`); continue; }
            const tok = await _mintCrewInviteToken(_supaUser.id, email); // the app's own mint
            if (tok) out.toks[k] = tok; else out.errs.push(`${k}:mint-null`);
          }
          return out;
        }, { E1email: E1.email, E2email: E2.email, TAG, perms: ESTIMATE_PERMS });
        Object.assign(toks, p.__inv.toks);
        return 2;
      },
      rule: async (p) => ({
        ok: !!p.__inv.toks.e1 && !!p.__inv.toks.e2 && p.__inv.errs.length === 0,
        got: `tokens=${Object.keys(p.__inv.toks).join(',')} errs=[${p.__inv.errs.join(' | ')}]`,
      }),
    });

    // 2. EMPLOYEES ACCEPT, open the invite LINK (the ?emp_invite= URL a real crew
    //    member taps), sign in, and land nested with estimate permission applied.
    await step(page, {
      label: 'both employees accept the invite link and nest with estimate permission', page: 'cloud', role: 'employee',
      suspect: 'cloud.js loadAccountData claim_crew_invite path',
      ruleText: 'accepting the invite link must nest the login under the boss with the granted permissions',
      expected: 'both nested, permissions.estimate === true',
      act: async () => {
        for (const [k, acct] of [['e1', E1], ['e2', E2]]) {
          const ctx = await browser.newContext();
          ctxs.push(ctx);
          const pg = await ctx.newPage();
          pages[k] = pg;
          const query = '?emp_invite=' + Buffer.from(JSON.stringify({ cid: bossUid, eid: base, email: acct.email, bname: 'E2E Boss', ename: `${TAG} ${k}`, tok: toks[k] })).toString('base64');
          await crewSignIn(pg, acct, query);
          await pg.waitForFunction((boss) =>
            typeof _isEmployee !== 'undefined' && _isEmployee === true && String(_contractorUserId) === String(boss),
          bossUid, { timeout: 30000 });
          await pg.waitForFunction(() => typeof _supaCloudLoaded === 'undefined' || _supaCloudLoaded === true, { timeout: 30000 }).catch(() => {});
        }
        return 2;
      },
      rule: async () => {
        const ok = [];
        for (const k of ['e1', 'e2']) {
          ok.push(await pages[k].evaluate(() =>
            typeof _isEmployee !== 'undefined' && _isEmployee === true &&
            !!(_employeeRecord && _employeeRecord.permissions && _employeeRecord.permissions.estimate === true)));
        }
        return { ok: ok.every(Boolean), got: `nested-with-estimate: ${ok.map(String).join(',')}` };
      },
    });

    // 3. EMPLOYEE WRITES AN ESTIMATE, a real one (client + surfaces + amount),
    //    through the real save path, under the crew RLS.
    const AMT = 4850;
    await step(page, {
      label: 'employee 1 writes an estimate (client + surfaces + amount) and saves', page: 'pg-est', role: 'employee',
      suspect: 'td_bids/td_clients crew policies (estimate permission) + bump_account_cursor',
      ruleText: 'an estimate authored by an estimate-permission employee must persist to the cloud under the boss account',
      expected: `bid ${estBidId} committed with amount ${AMT}`,
      act: async () => {
        await pages.e1.evaluate(async ({ estBidId, estClientId, AMT, TAG }) => {
          clients.push({ id: estClientId, name: TAG + ' Client', phone: '3165550970', addr: '901 Rollup Rd, Wichita, KS 67202', _e2e: 'rollup' });
          bids.push({
            id: estBidId, client_id: estClientId, client_name: TAG + ' Client', name: TAG + ' Client',
            amount: AMT, deposit: Math.round(AMT * 0.25), status: 'Pending', type: 'Interior Painting',
            bid_date: new Date().toISOString().slice(0, 10),
            surfaces: [{ type: 'walls', room: 'Living Room', qty: 480 }, { type: 'ceiling', room: 'Living Room', qty: 240 }],
            _e2e: 'rollup',
          });
          saveAll();
          await _flushSaveNow();
        }, { estBidId, estClientId, AMT, TAG });
        return 2; // one client + one estimate authored
      },
      rule: async () => {
        // Assert it actually LANDED server-side (not just in E1's memory): the BOSS
        // re-queries the cloud row directly, a crew-RLS write rejection would leave
        // nothing here even though E1's arrays look fine.
        const landed = await page.evaluate(async ({ estBidId }) => {
          const { data } = await _supa.from('td_bids').select('id,data').eq('user_id', _supaUser.id).eq('id', String(estBidId)).limit(1);
          const row = data && data[0];
          return { found: !!row, amount: row ? Number((row.data || {}).amount) : null };
        }, { estBidId });
        return { ok: landed.found && landed.amount === AMT, got: `cloud row found=${landed.found} amount=${landed.amount} (want ${AMT})` };
      },
    });

    // 4. ROLL-UP: the boss AND the second crew member receive the estimate LIVE
    //    (no manual reload, realtime / heartbeat / delta), amount intact.
    await step(page, {
      label: 'the estimate rolls up live to the boss and the second crew member', page: 'pg-dash', role: 'contractor',
      suspect: 'crew sync fabric (realtime SELECT policies + cursor heartbeat + silent delta)',
      ruleText: 'an employee-authored estimate must appear on every user of the account without a manual reload, with the full amount',
      expected: `bid ${estBidId} amount ${AMT} on boss + employee 2`,
      act: async () => {
        for (const pg of [page, pages.e2]) {
          await pg.waitForFunction(({ id, amt }) => {
            const b = (typeof bids !== 'undefined' ? bids : []).find(x => String(x.id) === String(id));
            return !!(b && Number(b.amount) === amt);
          }, { id: estBidId, amt: AMT }, { timeout: 90000, polling: 1000 }).catch(() => {});
        }
        return 1;
      },
      rule: async () => {
        const got = [];
        for (const [who, pg] of [['boss', page], ['e2', pages.e2]]) {
          const r = await pg.evaluate(({ id }) => {
            const b = (typeof bids !== 'undefined' ? bids : []).find(x => String(x.id) === String(id));
            return b ? { amount: Number(b.amount), client: b.client_name } : null;
          }, { id: estBidId });
          got.push(`${who}=${r ? r.amount : 'ABSENT'}`);
        }
        const ok = got.every(g => g.endsWith('=' + AMT));
        return { ok, got: got.join(' · ') };
      },
    });

    // 5. And the three copies are byte-identical, authored once, same everywhere.
    await step(page, {
      label: 'the estimate is byte-equal on author, boss, and peer crew', page: 'cloud', role: 'contractor',
      suspect: 'cloud.js merge fabric under crew RLS',
      ruleText: 'no user may hold a different copy of the estimate',
      expected: '1 distinct canonical serialization across e1/boss/e2',
      act: async () => 1,
      rule: async () => {
        const canons = [];
        for (const pg of [pages.e1, page, pages.e2]) {
          canons.push(await pg.evaluate(({ src, id }) => {
            const canon = eval(src);
            const b = (typeof bids !== 'undefined' ? bids : []).find(x => String(x.id) === String(id));
            return canon(b || null);
          }, { src: canonFnSource, id: estBidId }));
        }
        const distinct = new Set(canons);
        return { ok: distinct.size === 1 && !canons.includes('null'), got: `${distinct.size} distinct states (lens: ${canons.map(c => (c || '').length).join(',')})` };
      },
    });

    // 6. MONEY ROUTING: everything a crew member sends must carry the BOSS's account
    //    uid: hub/pay links (u= drives the Stripe checkout lookup in create-checkout)
    //    and the hub snapshot's storage path. A crew login stamping its own uid sent
    //    payments to an account that doesn't exist.
    await step(page, {
      label: 'crew-sent links + hub uploads carry the BOSS account (Stripe routing)', page: 'cloud', role: 'employee',
      suspect: 'data.js _effectiveUid + proposals.js _uploadClientHub / hub link builders',
      ruleText: 'the effective account uid, the hub link u= param, and the hub storage path must all be the boss for a crew sender',
      expected: `everything stamped ${String(bossUid).slice(0, 8)}…`,
      act: async (p) => {
        p.__route = await pages.e1.evaluate(async ({ estClientId, boss }) => {
          const eff = typeof _effectiveUid === 'function' ? _effectiveUid() : null;
          let hubKey = null, hubUrl = null, upErr = null;
          try {
            hubUrl = await _uploadClientHub(estClientId); // returns the client-facing link
            // An already-tokened client refreshes its snapshot in the BACKGROUND (the
            // share sheet never blocks on the upload), poll for the recorded key
            // instead of reading it synchronously.
            for (let t = 0; t < 40 && !hubKey; t++) {
              const c = clients.find(x => String(x.id) === String(estClientId));
              hubKey = (c && c.clientHubKey) || null;
              if (!hubKey) await new Promise(r => setTimeout(r, 250));
            }
          } catch (e) { upErr = e && e.message; }
          return {
            effIsBoss: String(eff) === String(boss),
            urlHasBoss: !!(hubUrl && hubUrl.includes('u=' + boss)),
            keyUnderBoss: !!(hubKey && hubKey.indexOf('client-hub/' + boss + '/') === 0),
            upErr,
          };
        }, { estClientId, boss: bossUid });
        return 1;
      },
      rule: async (p) => {
        const r = p.__route || {};
        return {
          ok: r.effIsBoss === true && r.urlHasBoss === true && r.keyUnderBoss === true,
          got: `effIsBoss=${r.effIsBoss} urlHasBoss=${r.urlHasBoss} keyUnderBoss=${r.keyUnderBoss}${r.upErr ? ' upErr=' + r.upErr : ''}`,
        };
      },
    });

    // Resource cleanup only (§13.7: the estimate stays in the account to poke at).
    for (const ctx of ctxs) await ctx.close().catch(() => {});

    const rep = report(FLOW2, BASELINE);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });
});
