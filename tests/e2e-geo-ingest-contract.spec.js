// ── The server/client geofence contract ─────────────────────────────────────
// The ingest-geo edge function (supabase/functions/ingest-geo/index.ts)
// writes rows the JS engine must recognize as its own: it mints the SAME
// deterministic keys (_geoLegKey / _geoVisitKey) so the unique index on
// (contractor_user_id, client_key) and the client's legKey checks dedupe
// server and client writes against each other in both directions.
//
// That only holds while the client derivations never drift. This spec
// freezes them: if a refactor changes a key shape, this fails with a message
// pointing at the server copy that has to change in the same commit.
//
// The second half covered _mileServerRefine, deleted 2026-09-02 with the
// rest of the sweeps: the day deriver (js/geo-derive.js) is the one writer.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');
const fs = require('fs');
const path = require('path');
const readSrc = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const SERVER = () => readSrc('supabase/functions/ingest-geo/index.ts');
const CLIENT = () => readSrc('js/geo-track.js');

test.describe('geofence ingest contract', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test.afterAll(async () => { await page.close(); });

  // ── ONE CLOCK, BOTH SIDES ────────────────────────────────────────────────
  // The key derivations below are useless if the two sides feed them different
  // numbers, and for four days they did. The phone opened its leg at the motion
  // edge (2026-08-31) and the server at the raw regionExit, nine seconds apart
  // on the owner's own drive, so base36(startMs) came out different and BOTH
  // rows landed: 3.2 mi "2015 SW Randolph -> 2950 SW McClure" from the phone,
  // 2.1 mi "Stop -> John Doe" from the server, for one 3.2-mile trip.
  //
  // A duplicate cannot be fixed with a better referee: the server's overlap
  // guard asks whether the other writer got there first, which on a
  // backgrounded phone is a coin flip on drain timing, and it lost that
  // morning. The two sides have to START FROM THE SAME EVENT. These freeze
  // that on both copies, because a drift of one second mints a different key.
  test('both engines hold a foot->automotive edge and spend it on the fence exit', () => {
    const srv = SERVER(), cli = CLIENT();
    expect(cli.includes('let _geoDrivePendingAt=null;'), 'client holds the pending edge').toBe(true);
    expect(/pending:\s*PendingDrive\s*\|\s*null/.test(srv), 'server holds the pending edge').toBe(true);
    // The server's has to survive between POSTs: the coprocessor can hand over
    // the edge in one flush and the fence exit in the next.
    //
    // Assertion updated 2026-08-31 (section 10.4). OLD: the literal
    // `state: { dwell, leg, pending,` matched the single blind upsert. NEW:
    // the same four fields are assembled as `nextState` and written under a
    // compare-and-swap. What this test is actually about, that pending is
    // persisted rather than living only inside one request, is unchanged; the
    // old string just happened to be how it was spelled.
    expect(/const nextState = \{ dwell, leg, pending, lastTs: newLastTs \};/.test(srv),
      'and carries it across POSTs').toBe(true);
    expect(srv.includes('state: nextState'), 'and that is what gets written').toBe(true);
  });

  // ── ONE WRITER AT A TIME ─────────────────────────────────────────────────
  // Holding the mark across POSTs is worth nothing if a second POST can
  // erase it. On 2026-08-31 at 17:07 CT the owner's phone flushed a walking
  // flip and an automotive flip 4 ms apart; both invocations read the same
  // state, the walking one wrote last, and the departure was gone. The flip
  // id is what made that legible instead of a mystery wrong start time.
  test('the cursor write is a compare-and-swap, never a blind upsert', () => {
    const srv = SERVER();
    expect(srv.includes('.select("state,updated_at")'),
      'the pass reads the value it will compare against').toBe(true);
    expect(/\.eq\("updated_at", prevUpdatedAt\)/.test(srv),
      'and swaps only while the row still carries it').toBe(true);
    expect(/casWon = !!\(swapped && swapped\.length\)/.test(srv),
      'a swap that matched no row is a LOSS, not a success').toBe(true);
    // The old shape. If this ever comes back, the race comes back with it.
    expect(/geo_device_state"\)\.upsert\(/.test(srv),
      'no unconditional upsert on the state row').toBe(false);
  });

  test('a losing pass re-derives instead of dropping its work', () => {
    const srv = SERVER();
    expect(/for \(let attempt = 0; attempt < STATE_CAS_TRIES && !casWon; attempt\+\+\)/.test(srv),
      'the read, the derive and the swap all sit inside the retry').toBe(true);
    // The read must be INSIDE the loop, or a retry recomputes against the same
    // stale state forever and can only ever lose again.
    const loopAt = srv.indexOf('for (let attempt = 0; attempt < STATE_CAS_TRIES');
    expect(srv.indexOf('.select("state,updated_at")') > loopAt,
      'the state is re-read on every attempt').toBe(true);
    expect(srv.indexOf('const prevUpdatedAt') > loopAt,
      'and so is the value it compares against').toBe(true);
  });

  test('the server writes no automatic rows: one deriver, one writer (CLAUDE.md 17)', () => {
    // Until 2026-09-02 this asserted the opposite: derived rows written
    // before the cursor moved. That writer was the third for one fence event
    // and the one that outlived the client cleanup; the owner's 12:04 exit
    // produced a 247-minute client row on top of the deriver's. The function
    // stores events and device state, and nothing else.
    const srv = SERVER();
    expect(srv.includes('insertByKey('), 'the row inserter is gone').toBe(false);
    expect(srv.includes('svc.from("td_mileage").upsert('), 'no mileage rows').toBe(false);
    expect(/svc\.from\("(job_time_entries|shop_time_entries)"\)\s*\.(insert|upsert)\(/.test(srv), 'no time rows').toBe(false);
    expect(srv.includes('void timeRows; void shopRows; void mileRows;'), 'the state machine\'s rows go nowhere').toBe(true);
    // The cursor still moves last and conditionally, for the device state.
    expect(srv.indexOf('const nextState = { dwell, leg, pending')).toBeGreaterThan(-1);
  });

  test('a contended cursor is reported, never swallowed', () => {
    const srv = SERVER();
    expect(srv.includes('if (!casWon) console.error('),
      'four straight losses surface instead of looking like success').toBe(true);
  });

  test('the derive is safe to run twice: every write is idempotent', () => {
    const srv = SERVER();
    // This is what makes the retry legal at all.
    // (The time and mileage writers are gone, see the test above; what is
    // left to be idempotent is the raw event store and the cursor.)
    expect(srv.includes('{ onConflict: "employee_user_id,type,ts,region_id", ignoreDuplicates: true }'),
      'raw events ignore a re-flushed buffer').toBe(true);
    // And the cursor is what stops a re-run reconsuming events the winner
    // already took: the walking mark that lost the race must not get a second
    // chance to clear a newer departure.
    expect(srv.includes('if (e.ts <= lastTs) continue;'),
      'a re-derived pass skips what the winner consumed').toBe(true);
  });

  test('both sides ROUND the plugin float the same way, not one round one truncate', () => {
    const srv = SERVER(), cli = CLIENT();
    // The plugin sends a FLOAT ms (Date().timeIntervalSince1970 * 1000).
    // ingest-geo stores Math.round(e.ts). This side used to do
    // `new Date(Number(ev.ts))`, which TRUNCATES. The owner's 08-31 edge is
    // ...725328.x, so the phone minted a key off 328 and the server off 329:
    // one millisecond, one different base36 string, one whole extra mileage
    // row. Sharing the clock buys nothing if the two sides round differently.
    expect(cli.includes('Math.round(Number(ev.ts))'), 'client rounds the edge').toBe(true);
    expect(srv.includes('ts: Math.round(e.ts)'), 'server rounds the same value').toBe(true);
  });

  test('the staleness cap is the same number on both sides', () => {
    const cliCap = /_GEO_DRIVE_PENDING_MAX_MS\s*=\s*(\d+)\s*\*\s*(\d+)\s*\*\s*(\d+)/.exec(CLIENT());
    const srvCap = /DRIVE_PENDING_MAX_MS\s*=\s*(\d+)\s*\*\s*(\d+)\s*\*\s*(\d+)/.exec(SERVER());
    expect(cliCap, 'client cap not found').not.toBeNull();
    expect(srvCap, 'server cap not found').not.toBeNull();
    const ms = (m) => Number(m[1]) * Number(m[2]) * Number(m[3]);
    // 15 minutes. Past it the phone has been driving, stopping and starting,
    // and the edge no longer describes THIS departure.
    expect(ms(cliCap)).toBe(15 * 60 * 1000);
    expect(ms(srvCap), 'a cap that differs by a second mints a different key').toBe(ms(cliCap));
  });

  test('both sides refuse a future-stamped edge and cancel on coming to rest', () => {
    const srv = SERVER(), cli = CLIENT();
    // Forward is never allowed: a clock-skewed replay must not backdate a leg
    // into next week. Rest cancels: pulling forward ten feet and parking is not
    // the departure a later exit would be describing.
    expect(cli.includes('if(_at<=now){_geoDrivePendingAt='), 'client refuses a future edge').toBe(true);
    expect(srv.includes('if (e.ts <= nowMs) pending ='), 'server refuses a future edge').toBe(true);
    // The clause gained the flip id (2026-08-31): coming to rest cancels the
    // mark AND the id that named it, or a refused departure would still label
    // the next leg with a transition it was not opened from. Same rule, one
    // more thing to forget, so the assertion names both.
    expect(cli.includes("if(_foot(cur)||cur==='still'){_geoDrivePendingAt=null;_geoDrivePendingId=null;}"),
      'client cancels on rest, mark and id together').toBe(true);
    expect(/REST_KINDS\.has\(k\)\)\s*\{\s*\n\s*pending = null;/.test(srv),
      'server cancels on rest').toBe(true);
  });

  test('the server drops the generic `fence` twin of a named crossing', () => {
    const srv = SERVER();
    // iOS fires one crossing under every id covering the point. regionName maps
    // the bare literal 'fence' to the string "Stop", so taking whichever landed
    // first in the array is where every `Stop -> somewhere` row came from.
    expect(srv.includes('const namedCrossing = evs'), 'the twin filter exists').toBe(true);
    // A WINDOW, not an equality. The owner's two exits are 3 ms apart, so an
    // exact-ts match would never have fired once. Found by replaying his real
    // 08-31 tape before this shipped, and it is the whole reason the filter
    // works at all.
    expect(/TWIN_MS = 2000/.test(srv), 'the twin match is a window').toBe(true);
    expect(/Math\.abs\(n\.ts - e\.ts\) <= TWIN_MS/.test(srv), 'matched by distance, not equality').toBe(true);
    expect(/const walk = evs\.filter/.test(srv), 'the state machine walks the filtered list').toBe(true);
    // ...and the RAW insert still stores everything, so nothing is lost.
    expect(srv.indexOf('from("geo_events").upsert') < srv.indexOf('const namedCrossing'),
      'the filter must come AFTER the raw store, never before it').toBe(true);
  });

  // ── Key derivations: the exact strings the server mints ───────────────────
  test('_geoLegKey is uid8-leg-base36(startMs), byte for byte', async () => {
    const r = await page.evaluate(() => {
      const saved = _supaUser;
      _supaUser = { id: 'abcdefgh-1234-5678-9abc-def012345678' };
      const key = _geoLegKey('2026-08-27T14:30:00.000Z');
      _supaUser = saved;
      return { key, expectMs: Date.parse('2026-08-27T14:30:00.000Z') };
    });
    // Server copy: legKeyOf() in supabase/functions/ingest-geo/index.ts.
    expect(r.key).toBe('abcdefgh-leg-' + r.expectMs.toString(36));
  });

  test('_geoVisitKey is uid8-vis-kind-id-base36, null id renders as x', async () => {
    const r = await page.evaluate(() => {
      const saved = _supaUser;
      _supaUser = { id: 'abcdefgh-1234-5678-9abc-def012345678' };
      const arr = '2026-08-27T09:15:00.000Z';
      const out = {
        job: _geoVisitKey('job', 42, arr),
        client: _geoVisitKey('client', 'c9', arr),
        shop: _geoVisitKey('shop', null, arr),
        ms: Date.parse(arr),
      };
      _supaUser = saved;
      return out;
    });
    // Server copy: visKeyOf() in supabase/functions/ingest-geo/index.ts.
    const b36 = r.ms.toString(36);
    expect(r.job).toBe('abcdefgh-vis-job-42-' + b36);
    expect(r.client).toBe('abcdefgh-vis-client-c9-' + b36);
    expect(r.shop).toBe('abcdefgh-vis-shop-x-' + b36);
  });


  test('_cloudHasRow answers only for rows the cloud has actually seen', async () => {
    const r = await page.evaluate(() => {
      const had = _syncedHash.td_mileage;
      _syncedHash.td_mileage = new Map([['abc', 'h']]);
      const out = {
        known: _cloudHasRow('td_mileage', 'abc'),
        numeric: _cloudHasRow('td_mileage', 'abc') === _cloudHasRow('td_mileage', String('abc')),
        unknown: _cloudHasRow('td_mileage', 'nope'),
        nullId: _cloudHasRow('td_mileage', null),
        undefId: _cloudHasRow('td_mileage', undefined),
        noTable: _cloudHasRow('td_nothing', 'abc'),
        noArgs: _cloudHasRow(),
      };
      if (had) _syncedHash.td_mileage = had; else delete _syncedHash.td_mileage;
      return out;
    });
    // A false yes costs data, so everything it is unsure about reads as no.
    expect(r.known).toBe(true);
    expect(r.numeric).toBe(true);
    expect([r.unknown, r.nullId, r.undefId, r.noTable, r.noArgs])
      .toEqual([false, false, false, false, false]);
  });





  // ── ONE FLIP, ONE ID (owner rule 2026-08-31) ─────────────────────────────
  // The duplicate rows were never a race, they were arithmetic: the leg key is
  // base36 of the start millisecond, COMPUTED on both sides, and iOS emitted
  // four automotive samples for his 1:19pm departure. The phone keyed off
  // ...35.747, the server off ...35.529, and one drive home became two rows.
  // These pin the sides together at the source, which is the only place a
  // divergence like that can be caught without two devices and a real drive.

  test('both sides prefer the flip id over anything derived', async () => {
    const srv = SERVER(), cli = CLIENT();
    expect(srv, 'server keys off flipId when it has one').toMatch(/flipId \? String\(flipId\)/);
    expect(cli, 'client keys off flipId when it has one').toMatch(/if\(flipId\)return String\(flipId\);/);
  });

  test('both sides keep the derived fallback, byte for byte', async () => {
    // Rows already on the books carry the derived shape and a phone on an
    // older build sends no id, so dropping the fallback would orphan both.
    const shape = /slice\(0, ?8\) ?\+ ?"-leg-" ?\+ ?startMs\.toString\(36\)/;
    expect(SERVER()).toMatch(shape);
    expect(CLIENT()).toMatch(/slice\(0,8\)\+'-leg-'\+\(\(Date\.parse\(startedIso\)\|\|0\)\)\.toString\(36\)/);
  });

  test('both sides carry the id on the pending mark, not just on the event', async () => {
    // The mark is what survives between the flip and the fence exit that
    // spends it, and on the server it survives between two POSTs. An id that
    // does not ride the mark cannot name the leg it opens.
    expect(SERVER()).toMatch(/pending = \{ ts: e\.ts, lat: e\.lat, lon: e\.lng, flipId: e\.flipId \}/);
    expect(CLIENT()).toMatch(/_geoDrivePendingId=\(typeof ev\.flipId==='string'&&ev\.flipId\)\?ev\.flipId:null/);
  });

  test('both sides drop the id when the mark is refused', async () => {
    // A leg labelled with a transition it was not opened from is worse than an
    // unlabelled one: wrong, and it looks authoritative.
    expect(SERVER()).toMatch(/regionId: e\.regionId, flipId: null \}/);
    expect(CLIENT()).toMatch(/_geoLegFlipId=_useTape\?_geoDrivePendingId:null;/);
  });

  test('both sides take only a STRING id, so junk cannot become a key', async () => {
    expect(SERVER()).toMatch(/typeof e\.flipId === "string"/);
    expect(CLIENT()).toMatch(/typeof ev\.flipId==='string'/);
  });

  test('the plugin mints the id once per flip and remembers across re-arms', async () => {
    // The other half, and the actual origin of the four samples: the live
    // stream's memory of the last kind was in-memory and wiped on every
    // re-arm, and it is re-armed from three places. Durable now, or one state
    // change is reported once per re-arm forever.
    const sw = readSrc('native/td-geo/ios/Plugin/TdGeoPlugin.swift');
    expect(sw, 'the memory is durable, not per-process').toMatch(/lastMotionKindKey = "td_geo_last_motion_kind"/);
    expect(sw, 'and nothing wipes it on re-arm').not.toMatch(/lastMotionKind = ""/);
    expect(sw, 'a live flip is minted an id').toMatch(/"flipId": self\.newFlipId\(\)/);
    expect(sw, 'and so is one recovered from history').toMatch(/"hist": true, "flipId": self\.newFlipId\(\)/);
  });

  test('the id is STORED on the raw row, not only used in memory', async () => {
    // The blind spot this closes is ours, not the app's. The state machine has
    // always held the flip id; without it on the row, the id could only be
    // observed at the END of the chain (a written leg key), so a drive that
    // came out wrong had to be reasoned about backwards. A stage that drops it
    // is now the stage holding a null.
    const srv = SERVER();
    expect(srv, 'the raw insert carries it').toMatch(/flip_id: e\.flipId/);
    const mig = readSrc('supabase/migrations/20260904_geo_events_flip_id.sql');
    expect(mig, 'and the column exists to carry it').toMatch(/add column if not exists flip_id text/);
    // Additive and nullable, because one project serves dev, UAT and
    // production (CLAUDE.md 3.1) and an older shell must keep posting.
    // Scoped to the column DEFINITION: a first cut of this grepped the whole
    // file for "not null" and matched the index's own `where flip_id is not
    // null` predicate, which is the correct way to write a partial index and
    // nothing to do with a constraint.
    const addCol = /alter table geo_events add column[^;]*;/i.exec(mig);
    expect(addCol, 'the column is added').toBeTruthy();
    expect(addCol[0], 'and it is nullable').not.toMatch(/not null/i);
    expect(addCol[0], 'and re-runnable').toMatch(/if not exists/i);
  });

  // ── THE PHONE CAN READ WHAT THE SERVER KEEPS ─────────────────────────────
  // geo_events was born deny-all (20260830: RLS on, no policy, "raw events
  // are ops data"). The day deriver then made the phone a reader of that
  // table, and for as long as no policy said so, Postgres answered every
  // fetch with zero rows and no error: a 3-mile drive the server held 80
  // breadcrumbs for painted as a 3-point line (owner 2026-09-02). A read the
  // client makes has to be a read a migration grants, in the same tree.
  test('every table the deriver reads from the phone has a select policy in the migrations', () => {
    const client = CLIENT();
    const reads = new Set();
    client.replace(/_supa\.from\('(geo_events|location_pings)'\)\.select\(/g, (_, t) => { reads.add(t); return _; });
    expect([...reads].sort(), 'the deriver reads both').toEqual(['geo_events', 'location_pings']);
    const dir = path.join(__dirname, '..', 'supabase', 'migrations');
    const sql = fs.readdirSync(dir).filter(f => /\.sql$/.test(f)).map(f => readSrc('supabase/migrations/' + f)).join('\n');
    reads.forEach(t => {
      const re = new RegExp('create policy\\s+("[^"]+"|\\S+)\\s+on\\s+(public\\.)?' + t + '\\s+for\\s+(select|all)\\b', 'i');
      expect(sql, t + ' needs a policy a signed-in phone can read through').toMatch(re);
    });
    // Reads only: the raw event row is the service role's to write.
    const own = readSrc('supabase/migrations/20260908_geo_events_read_policy.sql');
    expect(own).toMatch(/for select using \(auth\.uid\(\)::text = employee_user_id::text\)/);
    expect(own).not.toMatch(/for (all|insert|update|delete)/i);
  });

  test('no console errors', async () => {
    await assertNoErrors(page);
  });
});
