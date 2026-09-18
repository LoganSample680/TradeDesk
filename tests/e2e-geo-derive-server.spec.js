// ── The deriver, running where nobody is holding the phone ───────────────────
//
// Owner 2026-09-11: "why not just point it easily server side so it doesnt need
// a app active to run it, server runs it as they happen, in real-time", and
// then the thing that makes it worth doing at all: "any update to deriver logic
// means changes port to the server side right away, no need to look at
// duplicate code."
//
// So the whole point of this spec is that there IS no second implementation.
// supabase/functions/_shared/geo-derive.mjs is generated from js/geo-derive.js
// and the first test fails the moment those two disagree. The rest drive
// deriveDayServer (supabase/functions/_shared/derive-day.mjs) against a fake
// Supabase and check the plumbing around the rules: the right evidence goes in,
// the deriver's own row ids come out, and the server never sweeps.
//
// No browser here on purpose: this is the server path, and it runs in Node the
// same way the edge function runs it in Deno.
const { test, expect } = require('./helpers');
const { execFileSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SHARED = 'file://' + path.join(ROOT, 'supabase/functions/_shared/derive-day.mjs');

// Central 2026-09-10.
const DAY = '2026-09-10';
const T0 = 1789016400000;                 // midnight CT
const at = (h, m) => T0 + (h * 60 + m) * 60000;
const iso = (ms) => new Date(ms).toISOString();

const SHOP = { lat: 39.0307066, lon: -95.7112082 };
const CLIENT = { lat: 39.0123292, lon: -95.7464936 };

// A plain day: sat at the shop, drove to a client, worked, drove back.
const DEPART = at(7, 48), ARRIVE = at(7, 58), LEAVE = at(12, 27), HOME = at(12, 38);

// Jittered for the same reason `sit` is, and here the duplication was exact in
// a second way: the drive out and the drive back interpolate the same two
// points over the same 30 steps, so step i of one is byte-equal to step 29-i of
// the other. Nobody retraces a road to the centimetre.
// Keyed on the reading's own instant, so two readings taken at different times
// are never byte-equal however close together they sit, and the fixture cannot
// accidentally collide two points the way an index-keyed version did at the
// seam between a drive's last step and the dwell it opens.
const jitter = (v, ts, k) => v + (((Math.round(ts / 1000) * (k === 'lat' ? 2654435761 : 40503)) % 977) - 488) * 1e-9;
const line = (a, b, t1, t2, n) => Array.from({ length: n }, (_, i) => ({
  ts: Math.round(t1 + (t2 - t1) * i / (n - 1)),
  type: 'fix',
  lat: jitter(a.lat + (b.lat - a.lat) * i / (n - 1), t1 + (t2 - t1) * i / (n - 1), 'lat'),
  lon: jitter(a.lon + (b.lon - a.lon) * i / (n - 1), t1 + (t2 - t1) * i / (n - 1), 'lon'),
  kind: null,
}));
// A PARKED PHONE JITTERS, and the fixture has to as well (2026-09-18). This
// used to emit `lat: p.lat` unchanged, so the six morning readings at the shop
// and the eight afternoon ones after he drove back were byte-equal: the same
// double, to all seventeen digits, hours and a round trip apart. No GPS does
// that. Two readings of a phone sitting perfectly still still differ in the low
// bits, which is the entire premise the replay guard rests on, and a fixture
// that says otherwise is asserting something false about the world. It went
// unnoticed while the guard only looked back two hours; a day-wide window made
// the afternoon at the shop look like the morning's reading played again.
//
// Deterministic, and about a centimetre: far below any fence, far above the
// float equality the guard tests.
const sit = (p, t1, t2, n) => Array.from({ length: n }, (_, i) => ({
  ts: Math.round(t1 + (t2 - t1) * i / (n - 1)), type: 'fix',
  lat: jitter(p.lat, t1 + (t2 - t1) * i / (n - 1), 'lat'),
  lon: jitter(p.lon, t1 + (t2 - t1) * i / (n - 1), 'lon'), kind: null,
}));

const EVENTS = [
  ...sit(SHOP, at(6, 30), DEPART, 6),
  { ts: DEPART, type: 'motion', kind: 'automotive', lat: null, lon: null },
  ...line(SHOP, CLIENT, DEPART, ARRIVE, 30),
  { ts: ARRIVE, type: 'motion', kind: 'walking', lat: null, lon: null },
  ...sit(CLIENT, ARRIVE + 1000, LEAVE, 40),
  { ts: LEAVE, type: 'motion', kind: 'automotive', lat: null, lon: null },
  ...line(CLIENT, SHOP, LEAVE, HOME, 30),
  { ts: HOME, type: 'motion', kind: 'still', lat: null, lon: null },
  ...sit(SHOP, HOME + 1000, at(14, 0), 8),
].sort((a, b) => a.ts - b.ts).map((e) => ({ ...e, ts: iso(e.ts) }));

const FENCES = [
  { id: 'shop', kind: 'shop', name: 'TradeDesk shop', lat: SHOP.lat, lng: SHOP.lon, addr: '2015 SW Randolph Ave',
    job_id: null, place_id: null, client_id: null, radius_ft: null, scheduled: null },
  { id: 'client-111', kind: 'client', name: 'John Doe', lat: CLIENT.lat, lng: CLIENT.lon, addr: '2950 SW McClure Rd',
    job_id: null, place_id: null, client_id: '111', radius_ft: null, scheduled: false },
];

// A Supabase client that answers from a fixture. Chainable like the real one,
// and awaitable at any point in the chain, because derive-day.mjs uses both
// shapes (.range() for the paged reads, a bare await for the small ones).
function fakeSvc(tables, rpcLog, opts = {}) {
  const q = (rows) => {
    const o = {
      select: () => o, eq: () => o, is: () => o, gte: () => o, lt: () => o, in: () => o,
      order: () => o,
      maybeSingle: async () => ({ data: rows[0] === undefined ? null : rows[0] }),
      range: async (f, t) => ({ data: rows.slice(f, t + 1) }),
      then: (res, rej) => Promise.resolve({ data: rows }).then(res, rej),
    };
    return o;
  };
  return {
    from: (t) => q(tables[t] || []),
    rpc: async (name, args) => {
      rpcLog.push({ name, args });
      if (name === 'geo_fences_for') return { data: tables.__fences || [] };
      if (name === 'geo_replace_day') return opts.writeError ? { error: { message: opts.writeError } } : { error: null };
      return { data: null };
    },
  };
}

const TABLES = {
  geo_events: EVENTS,
  location_pings: [],
  td_time_entries: [],
  zj_data: [{ settings: JSON.stringify({ workHours: { start: '06:00', end: '20:00', days: [1, 2, 3, 4, 5, 6] } }) }],
  __fences: FENCES,
};

test.describe('the deriver on the server', () => {
  test('the shared copy is generated from js/geo-derive.js, never edited beside it', () => {
    // THE WHOLE REASON THIS IS SAFE. If somebody changes a rule on the phone
    // and does not regenerate, the server would quietly go on deriving by the
    // old rules and nothing else in the suite would notice. This is the
    // noticing. Same check migration-lint runs on every PR.
    let out = '', code = 0;
    try { out = execFileSync('node', ['scripts/gen-shared-deriver.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' }); }
    catch (e) { code = e.status; out = String(e.stdout || '') + String(e.stderr || ''); }
    expect(code, 'run: node scripts/gen-shared-deriver.mjs, and commit the result\n' + out).toBe(0);
    expect(out).toContain('in sync');
  });

  test('the same rules produce the same rows, with the deriver\'s own ids', async () => {
    const { deriveDayServer } = await import(SHARED);
    const rpc = [];
    const r = await deriveDayServer(fakeSvc(TABLES, rpc), 'cid-1', 'uid-1', DAY, at(23, 0));

    expect(r.wrote, r.reason).toBe(true);
    expect(r.legs, 'out and back').toBe(2);

    const write = rpc.find((c) => c.name === 'geo_replace_day');
    expect(write).toBeTruthy();
    expect(write.args.p_day).toBe(DAY);
    expect(write.args.p_contractor).toBe('cid-1');
    expect(write.args.p_employee).toBe('uid-1');

    // The client visit, and the two drives, keyed exactly as the phone keys
    // them: 'j-<uid8>-<base36>' for a leg, 'd-' + that for the dwell it opens.
    const time = write.args.p_time;
    const drives = time.filter((t) => t.source === 'drive');
    const visit = time.find((t) => t.source === 'client');
    expect(drives.length).toBe(2);
    expect(visit, 'the four and a half hours at John Doe').toBeTruthy();
    expect(visit.dest_place).toBe('John Doe');
    expect(visit.minutes).toBe(Math.round((LEAVE - ARRIVE) / 60000));
    expect(time.every((t) => /^j-/.test(t.client_key) || /^d-j-/.test(t.client_key))).toBe(true);
    expect(write.args.p_miles.length).toBe(2);
    expect(write.args.p_miles.every((m) => m.gps === true && m.date === DAY)).toBe(true);
  });

  test('the server never sweeps: partial evidence may add, never retire', async () => {
    // It only ever sees what has been flushed. A stretch nobody uploaded looks
    // exactly like a stretch that did not happen, so "not in my derive" can
    // never mean "delete it" here. The phone still sweeps a day its own tape
    // covers end to end.
    const { deriveDayServer } = await import(SHARED);
    const rpc = [];
    await deriveDayServer(fakeSvc(TABLES, rpc), 'cid-1', 'uid-1', DAY, at(23, 0));
    expect(rpc.find((c) => c.name === 'geo_replace_day').args.p_sweep).toBe(false);
  });

  // ── The one door that may retire a row (owner 2026-09-15) ────────────────
  // "I want Jack to wake up to a clean record of today." A rebuild is somebody
  // looking at a day, deciding it is wrong and asking for it again; the rows
  // that need removing are there BECAUSE an earlier derive changed its mind,
  // and only a sweep removes them. The rule above is not relaxed, it is given
  // the same test the phone applies: absence of evidence is evidence of
  // absence only where there is evidence.
  test.describe('a rebuild may sweep, and only on evidence', () => {
    test('asking for it, with a tape covering the day, sweeps', async () => {
      const { deriveDayServer } = await import(SHARED);
      const rpc = [];
      const r = await deriveDayServer(fakeSvc(TABLES, rpc), 'cid-1', 'uid-1', DAY, at(23, 0), null, { sweep: true });
      expect(rpc.find((c) => c.name === 'geo_replace_day').args.p_sweep).toBe(true);
      expect([r.sweep, r.sweepAsked, r.tapeCovers]).toEqual([true, true, true]);
    });

    test('not asking for it is the ingest path, unchanged', async () => {
      const { deriveDayServer } = await import(SHARED);
      for (const opts of [undefined, null, {}, { sweep: false }, { sweep: 0 }]) {
        const rpc = [];
        await deriveDayServer(fakeSvc(TABLES, rpc), 'cid-1', 'uid-1', DAY, at(23, 0), null, opts);
        expect(rpc.find((c) => c.name === 'geo_replace_day').args.p_sweep).toBe(false);
      }
    });

    // ── NO ANSWER, NO SWEEP (owner 2026-09-18, on Jack) ───────────────────
    // His morning: rule 14 wrote a traced leg from the shop to an unsaved end
    // at 08:11:03, the row that carries the Save this address path. He moved
    // the truck at 08:27:07, and the derive eight seconds after the tape
    // flipped back to still found the chain's last journey still OPEN. Rule 14
    // correctly withheld the leg, the withheld set went to geo_replace_day with
    // the sweep on, and the RPC retired the good row and its drive.
    //
    // It matters more on THIS path than on the phone: a person pressed the
    // button and the rebuild asks to sweep by default, so pressing Rebuild on
    // a day somebody is still driving would repeat the deletion on demand.
    // AMENDED 2026-09-18, hours after it was written. It asserted
    //   expect(write.args.p_sweep).toBe(false);
    // and turning the sweep off for the whole day proved far too blunt: one
    // unresolved chain at the END left every stale row from every earlier
    // derive standing, and on THIS path a person is pressing a button, so each
    // press stacked more beside them. That is what the owner was looking at
    // when he said a rebuilt day was "all duplicative". Bounded now instead.
    test('a day still mid-drive sweeps what it can describe, and stops there', async () => {
      const { deriveDayServer } = await import(SHARED);
      // Jack's shape: the last flip is into the truck and nothing closes it.
      const stillDriving = { ...TABLES, geo_events: TABLES.geo_events
        .filter((e) => !(e.type === 'motion' && e.kind === 'still')) };
      const rpc = [];
      const r = await deriveDayServer(fakeSvc(stillDriving, rpc), 'cid-1', 'uid-1', DAY, at(23, 0), null, { sweep: true });
      const write = rpc.find((c) => c.name === 'geo_replace_day');
      expect(write, 'it still writes: withholding is not skipping').toBeTruthy();
      expect(write.args.p_sweep, 'the settled part of the day is swept').toBe(true);
      expect(write.args.p_sweep_until, 'and it stops where the day stops being known').toBeTruthy();
      expect(r.sweepAsked).toBe(true);
      expect(r.tapeCovers).toBe(true);
    });

    test('a settled day has no boundary at all: the whole day is known', async () => {
      const { deriveDayServer } = await import(SHARED);
      const rpc = [];
      await deriveDayServer(fakeSvc(TABLES, rpc), 'cid-1', 'uid-1', DAY, at(23, 0), null, { sweep: true });
      const write = rpc.find((c) => c.name === 'geo_replace_day');
      expect(write.args.p_sweep).toBe(true);
      expect(write.args.p_sweep_until, 'null means sweep all of it').toBeNull();
    });

    test('the same day, once it parks, sweeps with no boundary', async () => {
      const { deriveDayServer } = await import(SHARED);
      const rpc = [];
      const r = await deriveDayServer(fakeSvc(TABLES, rpc), 'cid-1', 'uid-1', DAY, at(23, 0), null, { sweep: true });
      const w = rpc.find((c) => c.name === 'geo_replace_day');
      expect(w.args.p_sweep).toBe(true);
      expect(w.args.p_sweep_until).toBeNull();
      expect(r.sweep).toBe(true);
    });

    test('no motion tape covering the day: it writes, and retires nothing', async () => {
      // The rows are still worth adding; what the server cannot do on this
      // evidence is say what did NOT happen. Reported rather than silent, so a
      // rebuild that could not clean up does not look like one that did.
      const { deriveDayServer } = await import(SHARED);
      const rpc = [];
      const noTape = { ...TABLES, geo_events: TABLES.geo_events.filter((e) => e.type !== 'motion') };
      const r = await deriveDayServer(fakeSvc(noTape, rpc), 'cid-1', 'uid-1', DAY, at(23, 0), null, { sweep: true });
      const write = rpc.find((c) => c.name === 'geo_replace_day');
      if (write) expect(write.args.p_sweep).toBe(false);
      expect(r.tapeCovers === true).toBe(false);
      expect(r.sweep === true).toBe(false);
    });

    test('a day that writes nothing never reaches the writer at all', async () => {
      // Which is what stops a sweep from running against an empty derive: the
      // two guards above the write already refuse, so there is no call to make
      // a delete-everything out of.
      const { deriveDayServer } = await import(SHARED);
      const rpc = [];
      const bare = { geo_events: [], location_pings: [], td_time_entries: [], zj_data: [], __fences: FENCES };
      const r = await deriveDayServer(fakeSvc(bare, rpc), 'cid-1', 'uid-1', DAY, at(23, 0), null, { sweep: true });
      expect(r.wrote).toBe(false);
      expect(rpc.find((c) => c.name === 'geo_replace_day')).toBeUndefined();
    });
  });

  test('a day nobody has uploaded is not an empty day', async () => {
    const { deriveDayServer } = await import(SHARED);
    const rpc = [];
    const bare = { geo_events: [], location_pings: [], td_time_entries: [], zj_data: [], __fences: FENCES };
    const r = await deriveDayServer(fakeSvc(bare, rpc), 'cid-1', 'uid-1', DAY, at(23, 0));
    expect(r.wrote).toBe(false);
    expect(r.reason).toBe('no evidence');
    expect(rpc.some((c) => c.name === 'geo_replace_day'), 'nothing is written at all').toBe(false);
  });

  test('a stale position on a motion or fence row is never read as a fix', async () => {
    // _GEO_FRESH_FIX_TYPES on the phone, and the same list here. A wake's
    // last-known position can be a mile old and once read a 3-mile drive as
    // 6.1, so only fix / clock-in / clock-out carry a position the deriver
    // may trust. Same day, with a liar parked at the client's address all
    // morning on motion rows: the shop dwell must survive it.
    const { deriveDayServer } = await import(SHARED);
    const liar = EVENTS.concat(
      Array.from({ length: 12 }, (_, i) => ({
        ts: iso(at(6, 30) + i * 60000), type: 'motion', kind: 'still', lat: CLIENT.lat, lon: CLIENT.lon,
      })));
    const rpc = [];
    const r = await deriveDayServer(fakeSvc({ ...TABLES, geo_events: liar }, rpc), 'cid-1', 'uid-1', DAY, at(23, 0));
    expect(r.wrote).toBe(true);
    const w = rpc.find((c) => c.name === 'geo_replace_day').args;
    expect(w.p_miles.map((m) => m.from_name)).toEqual(['TradeDesk shop', 'John Doe']);
  });

  test('a refused write is reported, never swallowed as success', async () => {
    const { deriveDayServer } = await import(SHARED);
    const rpc = [];
    const r = await deriveDayServer(fakeSvc(TABLES, rpc, { writeError: 'overlapping pair(s)' }), 'cid-1', 'uid-1', DAY, at(23, 0));
    expect(r.wrote).toBe(false);
    expect(r.reason).toContain('overlapping pair(s)');
  });

  test('only the days a batch actually touches are derived, newest first', async () => {
    const { daysToDerive, centralDayKey, centralDayBounds } = await import(SHARED);
    const now = at(23, 0);
    // A breadcrumb changes no row shape, so it is not a reason to re-read a
    // whole day. A flip, a crossing, a lifecycle event or a ping is.
    expect(daysToDerive([{ type: 'fix', ts: T0 + 3600000 }], now)).toEqual([]);
    expect(daysToDerive([{ type: 'motion', ts: T0 + 3600000 }], now)).toEqual([DAY]);
    expect(daysToDerive([{ type: 'app-active', ts: T0 + 3600000 }], now)).toEqual([DAY]);
    // Three days in one batch is a backfill; the two newest are the ones
    // anybody is looking at, and the phone's rebuild covers the rest.
    const many = daysToDerive([
      { type: 'motion', ts: T0 - 2 * 86400000 + 3600000 },
      { type: 'motion', ts: T0 - 86400000 + 3600000 },
      { type: 'motion', ts: T0 + 3600000 },
    ], now);
    expect(many).toEqual(['2026-09-10', '2026-09-09']);
    // A clock that has not happened yet cannot name a day.
    expect(daysToDerive([{ type: 'motion', ts: now + 6 * 3600000 }], now)).toEqual([]);
    // Central bounds come from Intl, so a DST day is 23 or 25 hours, not 24.
    const dst = centralDayBounds('2026-11-01');
    expect((dst.end - dst.start) / 3600000, 'the 25-hour day').toBe(25);
    expect(centralDayKey(centralDayBounds(DAY).start)).toBe(DAY);
    expect(centralDayKey(centralDayBounds(DAY).end - 1)).toBe(DAY);
  });
});

// The ops portal explains an un-swept rebuild, and until 2026-09-18 there was
// only one reason it could happen, so the page stated it as a fact. The
// no-answer guard added a second, and the owner was told the server had no
// motion tape for Jack's day when it had plenty: the day was simply still
// mid-drive. The flags have to say which.
test.describe('an un-swept rebuild reports WHICH guard stopped it', () => {
  // AMENDED the same day it was written: pending no longer STOPS the sweep, it
  // BOUNDS it. So it is not a reason nothing was retired any more; it is a note
  // about where the retiring stopped.
  test('mid-drive: pending true, tape present, and the sweep is bounded not blocked', async () => {
    const { deriveDayServer } = await import(SHARED);
    const stillDriving = { ...TABLES, geo_events: TABLES.geo_events
      .filter((e) => !(e.type === 'motion' && e.kind === 'still')) };
    const r = await deriveDayServer(fakeSvc(stillDriving, []), 'cid-1', 'uid-1', DAY, at(23, 0), null, { sweep: true });
    expect(r.pending).toBe(true);
    expect(r.tapeCovers, 'the tape is there: blaming it would be the wrong answer').toBe(true);
    expect(r.sweep).toBe(true);
    expect(r.sweepUntil).toBeTruthy();
  });

  // Strip the tape entirely and it never reaches a write at all: the
  // no-evidence guard turns it round first, with a reason and no flags. The
  // portal prints that reason through its own "Nothing written" branch, so
  // rbWhyNoSweep is never asked about this case.
  test('no tape at all: turned round before the write, with a reason', async () => {
    const { deriveDayServer } = await import(SHARED);
    const noTape = { ...TABLES, geo_events: TABLES.geo_events.filter((e) => e.type !== 'motion') };
    const rpc = [];
    const r = await deriveDayServer(fakeSvc(noTape, rpc), 'cid-1', 'uid-1', DAY, at(23, 0), null, { sweep: true });
    expect(r.wrote).toBe(false);
    expect(typeof r.reason).toBe('string');
    expect(r.sweep === true).toBe(false);
    expect(r.pending === true, 'and it must not be blamed on a drive either').toBe(false);
  });

  test('a clean day reports neither', async () => {
    const { deriveDayServer } = await import(SHARED);
    const r = await deriveDayServer(fakeSvc(TABLES, []), 'cid-1', 'uid-1', DAY, at(23, 0), null, { sweep: true });
    expect(r.pending).toBe(false);
    expect(r.tapeCovers).toBe(true);
    expect(r.sweep).toBe(true);
  });
});


// ── A CACHED FIX RE-SENT IS NOT A NEW FIX, SERVER SIDE (owner 2026-09-18) ───
// The twin of the guard in _geoFixLogPush, and it has to exist on both sides:
// that one protects the phone's own log, this is what the ops portal's Rebuild
// button derives from, and a rebuild is exactly when somebody has decided a day
// is wrong and wants it done again.
//
// Jack's real numbers: one fix taken at 07:39:07 while he stood in the shop
// arrived FIFTEEN times out of thirty-seven, the last at 12:42, hours after he
// had parked 767 ft away, identical to fourteen decimal places every time.
// ── A MEMBERSHIP GOES STALE; A PARKED PHONE DOES NOT (owner 2026-09-18) ────
//
// Jack's 18 September. iOS reported him entering the shop region at 07:35:15
// and leaving it at 13:21:57, and it was entitled to: he parked 768 ft away,
// outside the deriver's 600 ft circle and well inside whatever radius the OS
// was watching. Rule 15 lets a CLOSED crossing pair beat the fix, so for five
// and a half hours every dwell was named "shop" while his own phone reported,
// every thirty minutes, a position 726 to 899 ft away that never moved.
//
// Rule 15 is still right about its own case: the OS boundary is wider, so at
// the instant of a crossing the fix is still out on the road and must not name
// the arrival (his 15 September, where it fired 0.4 miles out). The difference
// is not distance, it is whether the phone SETTLED. Mid-drive the fixes are
// strung along a road; parked, they sit on top of each other for hours.
//
// Driven on the full-day fixture above, because that one derives a real day:
// out to a client, a long stay, and back.
test.describe('a stale region membership loses to a parked phone', () => {
  // The crossing pair the phone never closed on time: it claims he was inside
  // the shop region for the whole of the day, including the hours the fixes
  // put him at John Doe's.
  const pinned = (rows) => ({ ...TABLES, geo_events: TABLES.geo_events.concat(rows) });
  const PAIR = [
    { ts: iso(at(7, 30)), type: 'regionEnter', kind: null, lat: null, lon: null, region_id: 'shop' },
    { ts: iso(at(13, 0)), type: 'regionExit', kind: null, lat: null, lon: null, region_id: 'shop' },
  ];

  test('the control: the day without the crossing pair', async () => {
    const { deriveDayServer } = await import(SHARED);
    const rpc = [];
    await deriveDayServer(fakeSvc(TABLES, rpc), 'cid-1', 'uid-1', DAY, at(23, 0));
    const w = rpc.find((c) => c.name === 'geo_replace_day');
    expect(w.args.p_time.find((t) => t.source === 'client'), 'he visits John Doe').toBeTruthy();
  });

  test('the four hours at the client stay at the client', async () => {
    const { deriveDayServer } = await import(SHARED);
    const rpc = [];
    await deriveDayServer(fakeSvc(pinned(PAIR), rpc), 'cid-1', 'uid-1', DAY, at(23, 0));
    const w = rpc.find((c) => c.name === 'geo_replace_day');
    expect(w, 'the day still writes').toBeTruthy();
    const visit = w.args.p_time.find((t) => t.source === 'client');
    expect(visit, 'a crossing the phone forgot to close does not move him to the shop').toBeTruthy();
    expect(Number(visit.minutes), 'and it is the whole stay, not a sliver').toBeGreaterThan(120);
  });

  test('the shop rows are still the shop: the membership keeps its job', async () => {
    const { deriveDayServer } = await import(SHARED);
    const rpc = [];
    await deriveDayServer(fakeSvc(pinned(PAIR), rpc), 'cid-1', 'uid-1', DAY, at(23, 0));
    const w = rpc.find((c) => c.name === 'geo_replace_day');
    expect((w.args.p_shop || []).length, 'the morning and evening at the yard survive').toBeGreaterThan(0);
  });

  test('both drives survive: a pinned membership does not eat the legs', async () => {
    const { deriveDayServer } = await import(SHARED);
    const rpc = [];
    const r = await deriveDayServer(fakeSvc(pinned(PAIR), rpc), 'cid-1', 'uid-1', DAY, at(23, 0));
    expect(r.legs, 'out and back, exactly as without the pair').toBe(2);
  });
});

test.describe('the server drops a replayed cached fix', () => {
  const SHOP_CACHED = { lat: 39.04565625037153, lon: -95.71510278822348 };
  const LOT = { lat: 39.04445524882554, lon: -95.7129015768892 };

  // His shape: real fixes at the shop, he drives off, and the cached shop
  // coordinate keeps arriving all morning while he sits in a car park.
  const jackish = (rows) => ({ ...TABLES, location_pings: [],
    geo_events: TABLES.geo_events.filter((e) => e.type !== 'fix').concat(rows) });
  const fixAt = (h, m, at) => ({ ts: iso(at(h, m)), type: 'fix', kind: null,
    lat: at === null ? null : undefined, lon: undefined });

  const run = async (fixRows) => {
    const { deriveDayServer } = await import(SHARED);
    const rpc = [];
    const r = await deriveDayServer(fakeSvc(jackish(fixRows), rpc), 'cid-1', 'uid-1', DAY, at(23, 0), null, { sweep: true });
    return r;
  };
  const F = (h, m, p) => ({ ts: iso(at(h, m)), type: 'fix', kind: null, lat: p.lat, lon: p.lon });

  test('fifteen arrivals of one coordinate count once', async () => {
    const rows = [F(7, 39, SHOP_CACHED), F(7, 58, LOT)];
    for (const h of [8, 9, 10, 11, 12]) { rows.push(F(h, 4, SHOP_CACHED)); rows.push(F(h, 30, LOT)); }
    const r = await run(rows);
    expect(r.fixesSeen).toBe(12);
    // AMENDED 2026-09-18, and the old number is why. This asserted FOUR, on
    // the reasoning that "a cached value that survives two hours of being the
    // only thing said about a place has earned the benefit of the doubt": 8:04
    // and 9:04 fell inside two hours of the real 7:39 reading and were
    // dropped, 10:04 had aged out of the window and was kept, and that kept
    // copy became the new anchor for 11:04 and 12:04.
    //
    // Jack's day proved the benefit of the doubt unearned. His phone re-sent
    // the 07:39 shop fix on the 30-minute push cycle at 10:00, 10:31, 11:03,
    // 11:33, 12:00, 12:22 and 12:29, and the gaps between the copies the scan
    // could still see were wider than two hours, so copy after copy read as
    // new and 08:00 to 13:12 put him back at a shop he left at 07:53. Waiting
    // does not make a cached coordinate fresh. Five arrivals after he left,
    // five drops.
    expect(r.fixesDropped).toBe(5);
  });

  test('a phone that never moved keeps every reading: that is not a replay', async () => {
    const rows = [];
    for (let i = 0; i < 12; i++) rows.push(F(8 + Math.floor(i / 2), (i % 2) * 30, SHOP_CACHED));
    const r = await run(rows);
    expect(r.fixesDropped, 'standing still and saying so twelve times is honest').toBe(0);
  });

  test('a genuinely different reading at the same place is kept', async () => {
    const r = await run([
      F(7, 39, SHOP_CACHED), F(7, 58, LOT),
      F(9, 30, { lat: 39.045656251, lon: -95.715102789 }),   // really back, really measured
    ]);
    expect(r.fixesDropped).toBe(0);
  });

  // AMENDED 2026-09-18 with the test above. This was 'past the two-hour window
  // it is allowed through again' and asserted 0 drops for a copy three hours
  // later. The window is the day now, so three hours later on the same day is
  // still the same cache talking.
  test('later the same day is still the same cache: it stays out', async () => {
    const r = await run([F(6, 0, SHOP_CACHED), F(6, 5, LOT), F(9, 0, SHOP_CACHED)]);
    expect(r.fixesDropped).toBe(1);
  });

  // Jack's actual afternoon, which is the case the two-hour window let through.
  // Nothing real is said about where he is between 09:03 and 12:36; the only
  // thing arriving is the 07:39 shop coordinate on the push cycle. Every one of
  // those has to go, or the day plants him at the shop for three and a half
  // hours he spent in a car park.
  test("the 30-minute push cycle re-sending one coordinate is dropped every time", async () => {
    const rows = [F(7, 39, SHOP_CACHED), F(7, 58, LOT), F(9, 3, LOT)];
    for (const [h, m] of [[10, 0], [10, 31], [11, 3], [11, 33], [12, 0], [12, 22], [12, 29]]) {
      rows.push(F(h, m, SHOP_CACHED));
    }
    const r = await run(rows);
    expect(r.fixesDropped, 'all seven, not just the first two').toBe(7);
  });

  // The boundary the day-wide window must not cross.
  test('the same coordinate on the next day is a new fix, not a replay', async () => {
    const { deriveDayServer } = await import(SHARED);
    const rpc = [];
    const rows = [F(7, 39, SHOP_CACHED), F(7, 58, LOT),
      { ts: iso(at(23, 30) + 3 * 3600_000), type: 'fix', kind: null, ...SHOP_CACHED }];
    const r = await deriveDayServer(fakeSvc(jackish(rows), rpc), 'cid-1', 'uid-1', DAY, at(23, 0), null, { sweep: true });
    expect(r.fixesDropped, 'yesterday cannot silence today').toBe(0);
  });

  // The other half of the wire spec's cost guard, on the side that actually
  // fell over: this scan runs once per kept fix per fix, so formatting a day
  // key inside it turned Jack's 630-fix rebuild into ~400,000 Intl
  // constructions and the edge function timed out.
  test('the scan does not format a date per entry', async () => {
    const { deriveDayServer } = await import(SHARED);
    const rows = Array.from({ length: 600 }, (_, i) => ({
      ts: iso(at(7, 0) + i * 30000), type: 'fix', kind: null,
      lat: 39.04 + i * 1e-5, lon: -95.71 - i * 1e-5,
    }));
    const Real = Intl.DateTimeFormat;
    let made = 0;
    Intl.DateTimeFormat = function (...a) { made++; return new Real(...a); };
    Intl.DateTimeFormat.supportedLocalesOf = Real.supportedLocalesOf;
    try { await deriveDayServer(fakeSvc(jackish(rows), []), 'cid-1', 'uid-1', DAY, at(23, 0), null, { sweep: true }); }
    finally { Intl.DateTimeFormat = Real; }
    expect(made, 'bounds once per day, not once per entry').toBeLessThan(2000);
  });

  test('a clean day reports the count and drops nothing', async () => {
    const { deriveDayServer } = await import(SHARED);
    const r = await deriveDayServer(fakeSvc(TABLES, []), 'cid-1', 'uid-1', DAY, at(23, 0), null, { sweep: true });
    expect(r.fixesDropped).toBe(0);
    expect(r.fixesSeen).toBeGreaterThan(0);
  });
});
