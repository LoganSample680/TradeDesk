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

const line = (a, b, t1, t2, n) => Array.from({ length: n }, (_, i) => ({
  ts: Math.round(t1 + (t2 - t1) * i / (n - 1)),
  type: 'fix',
  lat: a.lat + (b.lat - a.lat) * i / (n - 1),
  lon: a.lon + (b.lon - a.lon) * i / (n - 1),
  kind: null,
}));
const sit = (p, t1, t2, n) => Array.from({ length: n }, (_, i) => ({
  ts: Math.round(t1 + (t2 - t1) * i / (n - 1)), type: 'fix', lat: p.lat, lon: p.lon, kind: null,
}));

const EVENTS = [
  ...sit(SHOP, at(6, 30), DEPART, 6),
  { ts: DEPART, type: 'motion', kind: 'automotive', lat: null, lon: null },
  ...line(SHOP, CLIENT, DEPART, ARRIVE, 30),
  { ts: ARRIVE, type: 'motion', kind: 'walking', lat: null, lon: null },
  ...sit(CLIENT, ARRIVE, LEAVE, 40),
  { ts: LEAVE, type: 'motion', kind: 'automotive', lat: null, lon: null },
  ...line(CLIENT, SHOP, LEAVE, HOME, 30),
  { ts: HOME, type: 'motion', kind: 'still', lat: null, lon: null },
  ...sit(SHOP, HOME, at(14, 0), 8),
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
    test('a day still mid-drive is written, and retires nothing', async () => {
      const { deriveDayServer } = await import(SHARED);
      // Jack's shape: the last flip is into the truck and nothing closes it.
      const stillDriving = { ...TABLES, geo_events: TABLES.geo_events
        .filter((e) => !(e.type === 'motion' && e.kind === 'still')) };
      const rpc = [];
      const r = await deriveDayServer(fakeSvc(stillDriving, rpc), 'cid-1', 'uid-1', DAY, at(23, 0), null, { sweep: true });
      const write = rpc.find((c) => c.name === 'geo_replace_day');
      expect(write, 'it still writes: withholding is not skipping').toBeTruthy();
      expect(write.args.p_sweep, 'THE bug: this was true, and it retired a good row').toBe(false);
      expect(r.sweepAsked, 'the ask is still reported honestly').toBe(true);
      expect(r.tapeCovers).toBe(true);
    });

    test('the same day, once it parks, sweeps again', async () => {
      const { deriveDayServer } = await import(SHARED);
      const rpc = [];
      const r = await deriveDayServer(fakeSvc(TABLES, rpc), 'cid-1', 'uid-1', DAY, at(23, 0), null, { sweep: true });
      expect(rpc.find((c) => c.name === 'geo_replace_day').args.p_sweep).toBe(true);
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
  test('mid-drive: pending true, tape present', async () => {
    const { deriveDayServer } = await import(SHARED);
    const stillDriving = { ...TABLES, geo_events: TABLES.geo_events
      .filter((e) => !(e.type === 'motion' && e.kind === 'still')) };
    const r = await deriveDayServer(fakeSvc(stillDriving, []), 'cid-1', 'uid-1', DAY, at(23, 0), null, { sweep: true });
    expect(r.pending).toBe(true);
    expect(r.tapeCovers, 'the tape is there: blaming it would be the wrong answer').toBe(true);
    expect(r.sweep).toBe(false);
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
    // FOUR, not five, and the one that gets through is the window working
    // rather than failing. 8:04 and 9:04 are inside two hours of the real
    // 7:39 reading and are dropped; by 10:04 that reading has aged out, so
    // that replay is kept and becomes the new anchor, which then catches
    // 11:04 and 12:04. A cached value that survives two hours of being the
    // only thing said about a place has earned the benefit of the doubt.
    expect(r.fixesDropped).toBe(4);
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

  test('past the two-hour window it is allowed through again', async () => {
    const r = await run([F(6, 0, SHOP_CACHED), F(6, 5, LOT), F(9, 0, SHOP_CACHED)]);
    expect(r.fixesDropped).toBe(0);
  });

  test('a clean day reports the count and drops nothing', async () => {
    const { deriveDayServer } = await import(SHARED);
    const r = await deriveDayServer(fakeSvc(TABLES, []), 'cid-1', 'uid-1', DAY, at(23, 0), null, { sweep: true });
    expect(r.fixesDropped).toBe(0);
    expect(r.fixesSeen).toBeGreaterThan(0);
  });
});
