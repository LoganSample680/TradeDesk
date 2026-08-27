// REAL flow for the real-time geofence ingest (owner directive 2026-08-27:
// mileage and time logs land in Supabase the moment a fence trips, app
// force-closed or not). This drives the WHOLE server lane end to end against
// the deployed ingest-geo edge function and the real Dev project:
//
//   1. Sign in as the dev account and register a device flush key, exactly
//      the way _geoConfigureFlush does on a phone.
//   2. POST a fabricated force-quit day to ingest-geo AS THE NATIVE LAYER
//      WOULD: no JWT, just {user_id, device_id, key} plus the raw events a
//      dead phone's wake handler buffers (fence exit at the kerb, fence
//      enter at a job, fence exit at day's end).
//   3. Assert the rows exist where the app reads them: the job visit in
//      job_time_entries with the exact fence-crossing timestamps, and the
//      server's provisional mileage row in td_mileage.
//   4. POST the IDENTICAL batch again and prove nothing duplicates: the
//      dedupe (geo_events unique index + client-key upserts + the legKey
//      guard) is the entire reason server and client can both write.
//
// Seed data stays in the dev account per §12.7, uniquely tagged by run.
const { test, expect } = require('./flow-test');
const { needsLiveCreds, signIn, RUN_TAG, step, report, resetLedger } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'geo-ingest/force-quit-day';

test.describe('force-quit day → ingest-geo → rows in the app', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('a dead phone\'s fence day lands as time + mileage rows, and a re-flush changes nothing', async ({ page }) => {
    const runN = Date.now() % 100000;
    const DEV = 'e2e-flow-dev-' + RUN_TAG.slice(-6);
    const NOW = Date.now();
    const T = (minAgo) => NOW - minAgo * 60000;
    const JOB = { lat: 38.95 + (runN % 50) * 0.001, lng: -95.35 };
    const KERB = { lat: 38.90, lng: -95.30 };

    // ── STEP 1: device flush key + a real job for the fence to name ─────────
    let ctx = null;
    await step(page, {
      label: 'register flush key + seed the fenced job', page: 'pg-dash',
      suspect: 'geo-track.js _geoConfigureFlush / migration 20260830 geo_flush_keys',
      ruleText: 'a signed-in session must be able to register a per-device flush key',
      expected: 'geo_flush_keys upsert succeeds and the job row is in the cloud',
      act: async (p) => {
        ctx = await p.evaluate(async (a) => {
          const key = 'gfk_e2e_' + Math.random().toString(36).slice(2);
          const { error } = await _supa.from('geo_flush_keys')
            .upsert({ user_id: _supaUser.id, device_id: a.dev, key }, { onConflict: 'user_id,device_id' });
          const j = { id: Date.now(), bid_id: null, client_id: null, name: 'E2E Ingest Job ' + a.tag,
            addr: 'E2E Ingest Site', start: todayKey(), days: 1, buffer: 0, value: 0, color: '#185FA5',
            eventType: 'job', time: '', hours: null, notes: '', status: 'upcoming',
            loggedAt: new Date().toISOString() };
          jobs.push(j); saveAll();
          if (typeof supaSaveToCloud === 'function') await supaSaveToCloud();
          return { key, uid: _supaUser.id, url: _SUPA_DIRECT_URL, jobId: j.id,
                   err: error && error.message };
        }, { dev: DEV, tag: RUN_TAG.slice(-5) });
        return 1;
      },
      rule: async () => ({ ok: !!ctx && !ctx.err, got: ctx && (ctx.err || 'registered, job ' + ctx.jobId) }),
    });

    // The day a dead phone's buffer would hold, as plain data: off the kerb 3h
    // ago, into the job fence 2.5h ago, out of it 30 minutes ago.
    const events = [
      { type: 'regionExit', ts: T(180), lat: KERB.lat, lng: KERB.lng, regionId: 'fence' },
      { type: 'regionEnter', ts: T(150), lat: JOB.lat, lng: JOB.lng, regionId: 'job-' + ctx.jobId },
      { type: 'regionExit', ts: T(30), lat: JOB.lat, lng: JOB.lng, regionId: 'job-' + ctx.jobId },
    ];
    const postDay = async (p) => p.evaluate(async (a) => {
      const res = await fetch(a.url + '/functions/v1/ingest-geo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: a.uid, device_id: a.dev, key: a.key, events: a.events }),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    }, { url: ctx.url, uid: ctx.uid, dev: DEV, key: ctx.key, events });

    // ── STEP 2: the native layer's POST, keyed, no JWT ──────────────────────
    let post1 = null;
    await step(page, {
      label: 'POST the force-quit day to ingest-geo', page: 'pg-dash',
      suspect: 'supabase/functions/ingest-geo/index.ts (device-key auth + state machine)',
      ruleText: 'a keyed, JWT-less POST must store the events and derive rows',
      expected: 'HTTP 200, ok:true, stored:3',
      act: async (p) => { post1 = await postDay(p); return 1; },
      rule: async () => ({
        ok: !!post1 && post1.status === 200 && post1.body && post1.body.ok === true && post1.body.stored === 3,
        got: post1 && (post1.status + ' ' + JSON.stringify(post1.body)),
      }),
    });

    // ── STEP 3: the rows exist with the TRUE fence timestamps ───────────────
    let rows = null;
    await step(page, {
      label: 'visit + mileage rows landed', page: 'pg-timelog',
      suspect: 'ingest-geo closeDwell/closeLeg (keys must match _geoVisitKey/_geoLegKey)',
      ruleText: 'the dwell is in job_time_entries at the fence-crossing moments and the provisional leg is in td_mileage',
      expected: '120-minute geofence visit + one provisional srv- mileage row',
      act: async (p) => {
        rows = await p.evaluate(async (a) => {
          const { data: te } = await _supa.from('job_time_entries')
            .select('job_id,minutes,arrived_at,departed_at,source,client_key')
            .eq('contractor_user_id', _supaUser.id).eq('job_id', String(a.jobId)).is('deleted_at', null);
          const { data: mi } = await _supa.from('td_mileage')
            .select('id,data').eq('user_id', _supaUser.id).is('deleted_at', null)
            .like('id', 'srv-%');
          const legs = (mi || []).map(r => r.data).filter(d => d && d.provisional &&
            Math.abs(Date.parse(d.startedIso) - a.legStart) < 2000);
          return { visits: te || [], legs };
        }, { jobId: ctx.jobId, legStart: T(180) });
        return 1;
      },
      rule: async () => {
        const v = rows && rows.visits.find(x => x.source === 'geofence' && Math.round(x.minutes) === 120);
        const okTimes = v && Math.abs(Date.parse(v.arrived_at) - T(150)) < 2000 &&
                        Math.abs(Date.parse(v.departed_at) - T(30)) < 2000;
        return {
          ok: !!(v && okTimes && rows.legs.length === 1),
          got: 'visits=' + (rows ? rows.visits.length : '?') + ' legs=' + (rows ? rows.legs.length : '?') +
               (v ? ' mins=' + v.minutes : ' no 120m geofence visit'),
        };
      },
    });

    // ── STEP 4: the identical re-flush is a total no-op ─────────────────────
    await step(page, {
      label: 're-flush the identical batch, nothing duplicates', page: 'pg-timelog',
      suspect: 'geo_events dedupe index / client_key upserts / legKey guard',
      ruleText: 'a lost-ack re-send must not create a second row anywhere',
      expected: 'same visit count, same leg count as before',
      act: async (p) => { await postDay(p); return 1; },
      rule: async (p) => {
        const again = await p.evaluate(async (a) => {
          const { data: te } = await _supa.from('job_time_entries')
            .select('id').eq('contractor_user_id', _supaUser.id).eq('job_id', String(a.jobId)).is('deleted_at', null);
          const { data: mi } = await _supa.from('td_mileage')
            .select('id,data').eq('user_id', _supaUser.id).is('deleted_at', null).like('id', 'srv-%');
          const legs = (mi || []).map(r => r.data).filter(d => d && Math.abs(Date.parse(d.startedIso) - a.legStart) < 2000);
          return { visits: (te || []).length, legs: legs.length };
        }, { jobId: ctx.jobId, legStart: T(180) });
        return {
          ok: again.visits === rows.visits.length && again.legs === 1,
          got: 'visits ' + rows.visits.length + '→' + again.visits + ', legs 1→' + again.legs,
        };
      },
    });

    const rep = report(FLOW, BASELINE);
    expect(rep.overBudget).toBe(false);
  });
});
