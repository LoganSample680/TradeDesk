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

// geo_work_settings (migration 20261053) answered from the same zj_data
// fixture the old whole-blob read used, so a fixture's workHours still mean
// what they say.
function workSettingsFrom(tables) {
  const r = (tables.zj_data || [])[0];
  let s = null;
  try { s = r ? JSON.parse(r.settings) : null; } catch { s = null; }
  return { data: s ? { workHours: s.workHours, timeOff: s.timeOff } : null, error: null };
}

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
      if (name === 'geo_work_settings') return workSettingsFrom(tables);
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

// A day with a tape over it and nothing on it: he never got in the truck. No
// journeys, so no legs and no bounded dwell, which is what rule 19 leaves
// behind on a weekend it refuses to vouch for. The motion row is what makes
// tapeCovers true, so this is an EMPTY day rather than an unreported one.
const quietTables = () => ({
  ...TABLES,
  geo_events: [
    { ts: iso(at(6, 30)), type: 'motion', kind: 'still', lat: null, lon: null },
    ...sit(SHOP, at(6, 30), at(14, 0), 20).map((e) => ({ ...e, ts: iso(e.ts) })),
  ],
});

// ── THE DERIVER READS EVIDENCE, NEVER THE LEDGER (owner 2026-09-21) ────────
//
// "did we kill his battery today?" Jack's engine went into a park arm/exit
// loop and wrote 21,491 `radio` rows in a day, one for every line that touched
// the GPS receiver. The deriver has never USED one: there is no branch for
// that type and freshFix refuses it. It still paid for them, because the read
// was unfiltered and this function re-reads the whole day on every flush. His
// day reached about 25,000 events and his timesheet stopped gaining rows at
// 11:25am, through a 1:58pm drive whose motion flips reached the server in one
// second.
test.describe('the geo_events read asks only for what it can use', () => {
  // A client that records the filters instead of ignoring them.
  const spySvc = (tables, rpcLog, seen) => {
    const q = (rows, tbl) => {
      const o = {
        select: () => o, eq: () => o, is: () => o, gte: () => o, lt: () => o,
        in: (col, vals) => { if (tbl === 'geo_events') seen.push({ col, vals }); return o; },
        order: () => o,
        maybeSingle: async () => ({ data: rows[0] === undefined ? null : rows[0] }),
        range: async (f, t) => ({ data: rows.slice(f, t + 1) }),
        then: (res, rej) => Promise.resolve({ data: rows }).then(res, rej),
      };
      return o;
    };
    return {
      from: (t) => q(tables[t] || [], t),
      rpc: async (name, args) => {
        rpcLog.push({ name, args });
        if (name === 'geo_fences_for') return { data: tables.__fences || [] };
        if (name === 'geo_work_settings') return workSettingsFrom(tables);
        return { error: null, data: null };
      },
    };
  };

  test('it filters geo_events by type, and the ledger is not in the list', async () => {
    const { deriveDayServer } = await import(SHARED);
    const seen = [];
    await deriveDayServer(spySvc(TABLES, [], seen), 'cid-1', 'uid-1', DAY, at(23, 0));
    expect(seen.length, 'the read is filtered at the query, not after').toBe(1);
    expect(seen[0].col).toBe('type');
    const v = seen[0].vals;
    // Everything the loop can actually use.
    for (const t of ['motion', 'regionEnter', 'regionExit', 'visit', 'push-ping',
      'clock-in', 'clock-out', 'app-active', 'app-background', 'app-terminate',
      'app-relaunch', 'fix']) expect(v, t).toContain(t);
    // And nothing it cannot. `radio` is the one that buried Jack's day; the
    // rest are the same kind of thing and would do the same.
    for (const t of ['radio', 'heartbeat', 'sampling', 'wake-drop',
      'wake-zombie-closed', 'wake-stop-stuck']) expect(v, t).not.toContain(t);
  });

  test('the list is DERIVED from the two that already decide it', async () => {
    // Not a third hand-written copy. A type added to the trigger set or the
    // fresh-fix set is read from that moment, and a diagnostic nobody has
    // invented yet costs nothing by default. That is what makes this a fix
    // rather than a patch (7.3).
    const fs = require('fs');
    const src = fs.readFileSync(path.join(ROOT, 'supabase/functions/_shared/derive-day.mjs'), 'utf8');
    expect(src).toContain('const READ_TYPES = [...new Set([...TRIGGER_TYPES, ...FRESH_FIX_TYPES])]');
    expect(src).toContain('.in("type", READ_TYPES)');
  });

  test('a day buried in ledger rows still derives, because it never reads them', async () => {
    // The fixture the fake would have handed over unfiltered. Here the filter
    // is honoured, so the day is the same day it always was.
    const { deriveDayServer } = await import(SHARED);
    const junk = Array.from({ length: 5000 }, (_, i) => ({
      ts: iso(at(9, 0) + i * 100), type: 'radio', kind: null, lat: null, lon: null,
    }));
    const seen = [], rpc = [];
    const tables = { ...TABLES, geo_events: [...TABLES.geo_events, ...junk] };
    const r = await deriveDayServer(spySvc(tables, rpc, seen), 'cid-1', 'uid-1', DAY, at(23, 0));
    expect(r.wrote, r.reason).toBe(true);
    expect(r.legs, 'out and back, exactly as with no junk at all').toBe(2);
  });
});

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
      const rpc = [];
      const r = await deriveDayServer(fakeSvc(stillDrivingTables(), rpc), 'cid-1', 'uid-1', DAY, at(23, 0), null, { sweep: true });
      const write = rpc.find((c) => c.name === 'geo_replace_day');
      expect(write, 'it still writes: withholding is not skipping').toBeTruthy();
      expect(write.args.p_sweep, 'the settled part of the day is swept').toBe(true);
      expect(write.args.p_sweep_until, 'and it stops where the day stops being known').toBeTruthy();
      expect(r.sweepAsked).toBe(true);
      expect(r.tapeCovers).toBe(true);
    });

    // ── AN EMPTY DAY IS AN ANSWER, AND A REBUILD HAS TO BE ABLE TO SAY IT ──
    // (owner 2026-09-21, on Jack's Sunday)
    //
    // Rule 19 derives a weekend that vouches for nothing as NO ROWS, which is
    // the point of it. The rows already on that day were written before the
    // rule existed, so a rebuild is the only thing that can take them off, and
    // deriveDayServer used to return "nothing to add" before it ever called
    // the writer. He pressed Rebuild and got both stale rows back.
    //
    // The day that most needs clearing must not be the one day that cannot
    // clear itself. An empty derive that MAY retire now writes, carrying empty
    // arrays, and the sweep inside geo_replace_day is what does the work. An
    // empty derive that may not retire still skips, because there a write
    // really is a round trip for nothing.
    test('a rebuild of a day that derives to nothing still sweeps it', async () => {
      const { deriveDayServer } = await import(SHARED);
      const rpc = [];
      const r = await deriveDayServer(fakeSvc(quietTables(), rpc), 'cid-1', 'uid-1', DAY, at(23, 0), null, { sweep: true });
      const write = rpc.find((c) => c.name === 'geo_replace_day');
      expect(write, 'the writer is reached, which is the whole fix').toBeTruthy();
      expect(write.args.p_sweep).toBe(true);
      expect(write.args.p_time, 'nothing to add, said out loud').toEqual([]);
      expect(write.args.p_shop).toEqual([]);
      expect(write.args.p_miles).toEqual([]);
      expect(r.wrote).toBe(true);
      expect([r.time, r.shop, r.miles]).toEqual([0, 0, 0]);
    });

    test('the same empty day on the ingest path writes nothing at all', async () => {
      // Unchanged, and it has to stay unchanged: this caller may not retire,
      // so an empty write would be a round trip that changes nothing.
      const { deriveDayServer } = await import(SHARED);
      for (const opts of [undefined, { sweep: false }]) {
        const rpc = [];
        const r = await deriveDayServer(fakeSvc(quietTables(), rpc), 'cid-1', 'uid-1', DAY, at(23, 0), null, opts);
        expect(rpc.find((c) => c.name === 'geo_replace_day')).toBeFalsy();
        expect(r.wrote).toBe(false);
        expect(r.reason).toBe('nothing to add');
        expect(r.sweep, 'and it says why it could not sweep').toBe(false);
      }
    });

    // ── THE FIRST STOP OF THE DAY REACHES THE TIMESHEET (owner 2026-09-29) ──
    // Jack, 29 September: home office to the shop, arrived 7:35, clocked in
    // 7:38, still there. The commute from a home office is not a mileage leg
    // and no stop had closed, so the open shop row was the ONLY row, and the
    // "nothing to add" guard counted closed arrays alone and skipped the
    // writer. The shop never showed on his day until he left it.
    const firstStopTables = () => {
      const HOMEOFF = { lat: 39.0123292, lon: -95.7464936 };
      const fences = [
        FENCES[0],
        { id: 'place-home', kind: 'home_office', name: 'Home', lat: HOMEOFF.lat, lng: HOMEOFF.lon, addr: '1 Home Rd',
          job_id: null, place_id: 'home', client_id: null, radius_ft: null, scheduled: null },
      ];
      return {
        ...TABLES, __fences: fences,
        geo_events: [
          ...sit(HOMEOFF, at(6, 0), at(7, 21), 6),
          { ts: at(7, 21), type: 'motion', kind: 'automotive', lat: null, lon: null },
          ...line(HOMEOFF, SHOP, at(7, 21), at(7, 35), 20),
          { ts: at(7, 43), type: 'motion', kind: 'walking', lat: null, lon: null },
          ...sit(SHOP, at(7, 36), at(8, 5), 12),
        ].sort((a, b) => a.ts - b.ts).map((e) => ({ ...e, ts: iso(e.ts) })),
      };
    };

    test('arrived and still there: the open stop is written on the ingest path', async () => {
      const { deriveDayServer } = await import(SHARED);
      const rpc = [];
      const r = await deriveDayServer(fakeSvc(firstStopTables(), rpc), 'cid-1', 'uid-1', DAY, at(8, 6), null);
      const write = rpc.find((c) => c.name === 'geo_replace_day');
      expect(r.reason, 'not "nothing to add"').toBeUndefined();
      expect(write, 'the writer is reached with the open stop').toBeTruthy();
      expect(write.args.p_miles, 'a home office commute is not mileage').toEqual([]);
      expect(write.args.p_time).toEqual([]);
      expect(write.args.p_shop.length).toBe(1);
      expect(write.args.p_shop[0].arrived_at, 'at the shop since the arrival').toBe(iso(at(7, 35)));
      expect(write.args.p_shop[0].departed_at, 'still there: no departure yet').toBeNull();
      expect(r.open && r.open.kind).toBe('shop');
      expect(r.wrote).toBe(true);
    });

    test('the open stop is written exactly once per derive, never beside itself', async () => {
      const { deriveDayServer } = await import(SHARED);
      const rpc = [];
      await deriveDayServer(fakeSvc(firstStopTables(), rpc), 'cid-1', 'uid-1', DAY, at(8, 6), null);
      await deriveDayServer(fakeSvc(firstStopTables(), rpc), 'cid-1', 'uid-1', DAY, at(8, 20), null);
      const writes = rpc.filter((c) => c.name === 'geo_replace_day');
      expect(writes.length).toBe(2);
      expect(writes.map((w) => w.args.p_shop.length)).toEqual([1, 1]);
      expect(writes[0].args.p_shop[0].client_key, 'the same row each time, so the writer replaces it')
        .toBe(writes[1].args.p_shop[0].client_key);
    });

    // ── AND THE DRIVE THAT LEAVES IT (owner 2026-09-29) ──────────────────
    // "If a drive starts it ends the shop time and starts the drive time
    // right away with no end." Same morning, and at 9:00 he pulls out. The
    // derive a few minutes later must close the shop row at the flip and send
    // the drive as a row with no end, in the same write.
    const leavingTables = () => {
      const t = firstStopTables();
      const MID = { lat: (SHOP.lat + 39.0123292) / 2, lon: (SHOP.lon + -95.7464936) / 2 };
      const more = [
        { ts: at(9, 0), type: 'motion', kind: 'automotive', lat: null, lon: null },
        ...line(SHOP, MID, at(9, 1), at(9, 3), 6),
      ].map((e) => ({ ...e, ts: iso(e.ts) }));
      return { ...t, geo_events: t.geo_events.filter((e) => Date.parse(e.ts) < at(9, 0)).concat(more)
        .sort((x, y) => Date.parse(x.ts) - Date.parse(y.ts)) };
    };

    test('a drive under way: the shop row closes at the flip and the drive goes up with no end', async () => {
      const { deriveDayServer } = await import(SHARED);
      const rpc = [];
      const r = await deriveDayServer(fakeSvc(leavingTables(), rpc), 'cid-1', 'uid-1', DAY, at(9, 4), null);
      const write = rpc.find((c) => c.name === 'geo_replace_day');
      expect(write, 'written on the ingest path, mid-drive').toBeTruthy();
      expect(write.args.p_shop.length).toBe(1);
      expect(write.args.p_shop[0].departed_at, 'the shop ends when the drive starts').toBe(iso(at(9, 0)));
      const live = write.args.p_time.filter((x) => x.departed_at === null);
      expect(live.length, 'exactly one row with no end').toBe(1);
      expect(live[0].source).toBe('drive');
      expect(live[0].arrived_at).toBe(iso(at(9, 0)));
      expect(write.args.p_miles, 'no mileage until the drive has two ends').toEqual([]);
      expect(r.wrote).toBe(true);
    });

    test('an empty day with no tape covering it is still refused', async () => {
      // "No evidence" outranks everything: a day nobody uploaded is not an
      // empty day, and asking for a sweep cannot turn it into one.
      const { deriveDayServer } = await import(SHARED);
      const rpc = [];
      const r = await deriveDayServer(fakeSvc({ ...quietTables(), geo_events: [] }, rpc), 'cid-1', 'uid-1', DAY, at(23, 0), null, { sweep: true });
      expect(rpc.find((c) => c.name === 'geo_replace_day')).toBeFalsy();
      expect(r.wrote).toBe(false);
      expect(r.reason).toBe('no evidence');
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

  // ── AND A `fix` THAT SAYS IT IS STALE IS NOT A FIX EITHER ─────────────
  // Owner 2026-09-19, on Jack's 18 September. The rule above was right about
  // motion and fence rows and wrong to stop there: iOS hands
  // didUpdateLocations its LAST KNOWN position on a significant-change wake,
  // and the plugin stamped that with the wall clock, so 11 copies of the shop
  // coordinate he locked at 07:39 arrived as `fix` rows all morning while he
  // stood at a job site 768 ft away. TdGeoPlugin.event() measures every
  // position against the CLLocation's own timestamp now and marks it, and the
  // server reads that mark off the row's detail exactly as it always has for
  // a push-ping. This is the ops portal's Rebuild button, so it is the one
  // that has to agree with the phone.
  test('a fix that carries an age over the line is refused like a stale ping', async () => {
    const { deriveDayServer } = await import(SHARED);
    const liar = EVENTS.concat(
      Array.from({ length: 12 }, (_, i) => ({
        ts: iso(at(6, 30) + i * 60000), type: 'fix', lat: CLIENT.lat, lon: CLIENT.lon,
        detail: { staleMs: 4 * 3600000 },
      })));
    const rpc = [];
    const r = await deriveDayServer(fakeSvc({ ...TABLES, geo_events: liar }, rpc), 'cid-1', 'uid-1', DAY, at(23, 0));
    expect(r.wrote).toBe(true);
    const w = rpc.find((c) => c.name === 'geo_replace_day').args;
    expect(w.p_miles.map((m) => m.from_name)).toEqual(['TradeDesk shop', 'John Doe']);
  });

  test('a fix with no age at all is still fresh, so no history re-grades', async () => {
    // Every row written before that build carries no detail. They must read
    // exactly as they always did.
    const { deriveDayServer } = await import(SHARED);
    const rpc = [];
    const r = await deriveDayServer(fakeSvc(TABLES, rpc), 'cid-1', 'uid-1', DAY, at(23, 0));
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
// STILL DRIVING MEANS THE TRUCK IS STILL MOVING (2026-09-18, second pass).
// Dropping the `still` flips used to be enough to leave a day mid-drive, because
// a journey the tape never closed stayed open by default. It does not any more:
// a missing flip stopped being read as evidence of a departure, so the journey
// ends where the FIXES say the truck parked, and this fixture's trailing
// readings sit at the yard from 12:38. That change is the point (Jack's whole
// afternoon was being discarded by the old reading), so a genuinely unresolved
// day now has to be genuinely unresolved: no still flips AND no settled
// readings at the end, which is a phone in a moving truck when the day runs out.
const stillDrivingTables = () => {
  const cut = at(12, 38);
  return { ...TABLES, geo_events: TABLES.geo_events
    .filter((e) => !(e.type === 'motion' && e.kind === 'still'))
    .filter((e) => !(e.type === 'fix' && Date.parse(e.ts) >= cut)) };
};

test.describe('an un-swept rebuild reports WHICH guard stopped it', () => {
  // AMENDED the same day it was written: pending no longer STOPS the sweep, it
  // BOUNDS it. So it is not a reason nothing was retired any more; it is a note
  // about where the retiring stopped.
  test('mid-drive: pending true, tape present, and the sweep is bounded not blocked', async () => {
    const { deriveDayServer } = await import(SHARED);
    const r = await deriveDayServer(fakeSvc(stillDrivingTables(), []), 'cid-1', 'uid-1', DAY, at(23, 0), null, { sweep: true });
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

// ── THE DERIVER READS TWO SETTINGS, NOT THE BLOB (2026-09-28) ──────────────
//
// Supabase dropped every request on the project on 2026-09-28: egress 6.02 GB
// of 5.5. This read pulled the whole zj_data.settings column, which carried a
// 1.5 MB logo, about 1,000 times a day, to use workHours and timeOff.
test.describe('the deriver reads workHours and timeOff, not the settings blob', () => {
  const tracking = (tables, opts = {}) => {
    const reads = [];
    const base = fakeSvc(tables, []);
    return {
      reads,
      svc: {
        from: (t) => { reads.push(t); return base.from(t); },
        rpc: async (name, args) => {
          if (name === 'geo_work_settings' && opts.rpcFails) return { data: null, error: { message: 'no such function' } };
          if (name === 'geo_work_settings' && 'settings' in opts) return { data: opts.settings, error: null };
          return base.rpc(name, args);
        },
      },
    };
  };

  test('zj_data is never read when the RPC answers', async () => {
    const { deriveDayServer } = await import(SHARED);
    const t = tracking(TABLES);
    const r = await deriveDayServer(t.svc, 'cid-1', 'uid-1', DAY, at(23, 0));
    expect(r.reason || '').not.toBe('error');
    expect(t.reads).not.toContain('zj_data');
  });

  test('workSettings returns the two keys the RPC gives, nothing else', async () => {
    const { workSettings } = await import(SHARED);
    const t = tracking(TABLES, { settings: { workHours: { start: '07:00', end: '17:00', days: [1, 2] }, timeOff: [{ day: '2026-09-01' }] } });
    const w = await workSettings(t.svc, 'cid-1');
    expect(w.workHours.start).toBe('07:00');
    expect(w.timeOff).toHaveLength(1);
    expect(t.reads).not.toContain('zj_data');
  });

  test('an RPC that is not deployed yet falls back to the old read', async () => {
    // Functions can land before the migration. The day must still see its
    // Time off, so the old read runs rather than defaults.
    const { workSettings } = await import(SHARED);
    const tables = { ...TABLES, zj_data: [{ settings: JSON.stringify({ workHours: { start: '05:00', end: '19:00', days: [1] }, timeOff: [{ day: 'x' }], logoData: 'data:image/png;base64,AAAA' }) }] };
    const t = tracking(tables, { rpcFails: true });
    const w = await workSettings(t.svc, 'cid-1');
    expect(t.reads).toContain('zj_data');
    expect(w.workHours.start).toBe('05:00');
    expect(w.timeOff).toHaveLength(1);
    expect(Object.keys(w).sort()).toEqual(['timeOff', 'workHours']);
  });

  test('null input, bad JSON and a missing row all give null, never a throw', async () => {
    const { workSettings } = await import(SHARED);
    for (const zj of [[], [{ settings: '{not json' }], [{ settings: null }]]) {
      const t = tracking({ ...TABLES, zj_data: zj }, { rpcFails: true });
      expect(await workSettings(t.svc, 'cid-1')).toBeNull();
    }
    const t = tracking(TABLES, { settings: null });
    expect(await workSettings(t.svc, null)).toBeNull();
  });

  test('the migration returns only workHours and timeOff, and only to service_role', () => {
    const fs = require('fs');
    const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261053_geo_work_settings.sql'), 'utf8');
    expect(sql).toContain("jsonb_build_object('workHours', s->'workHours', 'timeOff', s->'timeOff')");
    expect(sql).toMatch(/revoke all on function public\.geo_work_settings\(uuid\) from public, anon, authenticated/);
    expect(sql).toMatch(/grant execute on function public\.geo_work_settings\(uuid\) to service_role/);
  });
});

// ── THE DAY'S EVIDENCE TRAVELS COMPACT (2026-09-28) ───────────────────────
//
// The paged geo_events read pulled 6.4 million rows on 2026-09-27, about 1 GB,
// the second cause of the egress cutoff. geo_day_evidence (migration 20261054)
// returns the same rows as short arrays. It must change nothing the deriver
// decides, and that is what these prove.
test.describe('the day of evidence arrives compact and derives the same day', () => {
  const compact = (rows) => rows.map((e) => [Date.parse(e.ts), e.type, e.kind ?? null,
    e.lat ?? null, e.lon ?? null, e.region_id ?? null, e.detail ?? null]);
  const withRpc = (tables, rpcLog, reads) => {
    const base = fakeSvc(tables, rpcLog);
    return {
      from: (t) => { reads.push(t); return base.from(t); },
      rpc: async (name, args) => {
        if (name === 'geo_day_evidence') {
          rpcLog.push({ name, args });
          return { data: compact(tables.geo_events || []), error: null };
        }
        return base.rpc(name, args);
      },
    };
  };

  test('same rows written as the paged read, and geo_events is never paged', async () => {
    const { deriveDayServer } = await import(SHARED);
    const oldLog = [];
    const a = await deriveDayServer(fakeSvc(TABLES, oldLog), 'cid-1', 'uid-1', DAY, at(23, 0));
    const newLog = [], reads = [];
    const b = await deriveDayServer(withRpc(TABLES, newLog, reads), 'cid-1', 'uid-1', DAY, at(23, 0));
    const writes = (log) => JSON.stringify(log.filter((c) => c.name === 'geo_replace_day').map((c) => c.args));
    expect(writes(oldLog).length).toBeGreaterThan(10);
    expect(writes(newLog)).toBe(writes(oldLog));
    expect(b.wrote).toBe(a.wrote);
    expect(reads).not.toContain('geo_events');
    const call = newLog.find((c) => c.name === 'geo_day_evidence');
    expect(call.args.p_uid).toBe('uid-1');
    expect(call.args.p_limit, 'same cap as the paged read').toBe(12000);
    expect(call.args.p_types).toContain('fix');
    expect(call.args.p_types).not.toContain('radio');
  });

  test('dayEvents rebuilds the loop shape exactly, and skips junk rows', async () => {
    const { dayEvents } = await import(SHARED);
    const svc = { rpc: async () => ({ error: null, data: [
      [1757500000123, 'fix', null, 39.04565625037153, -95.71510278822348, null, null],
      [1757500001000, 'regionEnter', null, null, null, 'fence-9', { a: 1 }],
      null, 'x', [0, 'fix'], [-5, 'fix'],
    ] }) };
    const rows = await dayEvents(svc, 'u', 'a', 'b');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ ts: new Date(1757500000123).toISOString(), type: 'fix', kind: null,
      lat: 39.04565625037153, lon: -95.71510278822348, region_id: null, detail: null });
    expect(rows[1].region_id).toBe('fence-9');
    expect(rows[1].detail).toEqual({ a: 1 });
  });

  test('an RPC that errors or is missing falls back to the paged read', async () => {
    const { dayEvents } = await import(SHARED);
    const paged = [{ ts: iso(at(8, 0)), type: 'motion', kind: 'automotive' }];
    const base = fakeSvc({ geo_events: paged }, []);
    for (const rpc of [async () => ({ data: null, error: { message: 'missing' } }), async () => { throw new Error('down'); }, async () => ({ data: null, error: null })]) {
      const rows = await dayEvents({ from: base.from, rpc }, 'u', 'a', 'b');
      expect(rows).toEqual(paged);
    }
  });

  test('the migration keeps the paged read\'s filter, order and cap, for service_role only', () => {
    const fs = require('fs');
    const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261054_geo_day_evidence.sql'), 'utf8');
    expect(sql).toContain('type = any(p_types)');
    expect(sql).toContain('order by ts asc');
    expect(sql).toContain('limit greatest(coalesce(p_limit, 12000), 0)');
    expect(sql).toMatch(/from public, anon, authenticated/);
    expect(sql).toMatch(/to service_role;/);
  });
});

test.describe('no server function reads the whole settings blob', () => {
  test('only the workSettings fallback selects zj_data.settings', () => {
    // The deriver, the close wake (ingest-geo) and the two-minute wake-quiet
    // cron all need workHours. Each one reading the blob is how a 1.5 MB logo
    // went down a thousand times a day.
    const fs = require('fs');
    const dir = path.join(ROOT, 'supabase/functions');
    const hits = [];
    const walk = (d) => { for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|mjs|js)$/.test(f)) {
        const src = fs.readFileSync(p, 'utf8');
        const n = (src.match(/from\(["']zj_data["']\)\s*\.select\(["'][^"']*settings/g) || []).length;
        if (n) hits.push(path.relative(ROOT, p) + ':' + n);
      }
    } };
    walk(dir);
    expect(hits).toEqual(['supabase/functions/_shared/derive-day.mjs:1']);
    const ig = fs.readFileSync(path.join(dir, 'ingest-geo/index.ts'), 'utf8');
    const wq = fs.readFileSync(path.join(dir, 'wake-quiet/index.ts'), 'utf8');
    expect(ig).toContain('workHoursFromSettings(cfgRow)');
    expect(ig).toContain('workSettings(svc, cid)');
    expect(wq).toContain('settingsCache.set(cid, await workSettings(svc, cid))');
  });
});

// ── THE KEPT DAY DERIVES THE SAME DAY (2026-09-28) ─────────────────────────
//
// dayEvents keeps a person's day in memory and asks only for rows added since
// its last read. It is only allowed to exist because it changes nothing: these
// derive the same day from the kept copy and from a whole fresh read, while
// rows keep arriving, and require identical writes.
test.describe('the kept day derives exactly what a fresh read derives', () => {
  // A geo_events table with ids and insert times, answering geo_day_evidence
  // with the migration's own rules: filter, (after id OR since), order, cap.
  const evidenceDb = () => {
    const rows = [];
    let nextId = 1000;
    const calls = [];
    const add = (evs, createdMs, idOverride) => {
      for (const e of evs) rows.push({ ...e, id: idOverride != null ? idOverride++ : nextId++, createdMs });
    };
    const rpcEvidence = (args) => {
      calls.push(args);
      const from = Date.parse(args.p_from), to = Date.parse(args.p_to);
      const since = args.p_since ? Date.parse(args.p_since) : null;
      const out = rows
        .filter((r) => args.p_types.includes(r.type))
        .filter((r) => { const t = Date.parse(r.ts); return t >= from && t < to; })
        .filter((r) => (args.p_after_id == null && since == null)
          || (args.p_after_id != null && r.id > args.p_after_id)
          || (since != null && r.createdMs >= since))
        .sort((a, b) => (Date.parse(a.ts) - Date.parse(b.ts)) || (a.id - b.id))
        .slice(0, args.p_limit)
        .map((r) => [Date.parse(r.ts), r.type, r.kind ?? null, r.lat ?? null, r.lon ?? null,
          r.region_id ?? null, r.detail ?? null, r.id]);
      return out;
    };
    return { rows, calls, add, rpcEvidence };
  };
  const svcFor = (db, log, opts = {}) => {
    const base = fakeSvc({ ...TABLES, geo_events: [] }, log);
    return {
      from: base.from,
      rpc: async (name, args) => {
        if (name === 'geo_day_evidence') {
          if (opts.failDelta && args.p_after_id != null) return { data: null, error: { message: 'down' } };
          return { data: db.rpcEvidence(args), error: null };
        }
        return base.rpc(name, args);
      },
    };
  };
  const writes = (log) => JSON.stringify(log.filter((c) => c.name === 'geo_replace_day').map((c) => c.args));
  const cut = (ms) => EVENTS.filter((e) => Date.parse(e.ts) < ms);
  const after = (ms) => EVENTS.filter((e) => Date.parse(e.ts) >= ms);

  test('arrival in pieces, a late commit with an older id: kept and fresh write the same', async () => {
    const { deriveDayServer, _dayCacheClear } = await import(SHARED);
    _dayCacheClear();
    const db = evidenceDb();
    const now0 = Date.now();
    db.add(cut(at(10, 0)), now0 - 60000);

    // Warm the kept copy, then prove the first answer against a fresh read.
    const k1 = [];
    await deriveDayServer(svcFor(db, k1), 'cid-1', 'uid-1', DAY, at(23, 0));
    const f1 = [];
    await deriveDayServer(svcFor(db, f1), 'cid-1', 'uid-1', DAY, at(23, 0), null, { fresh: true });
    expect(writes(k1)).toBe(writes(f1));

    // More of the day lands. One row was inserted by another upload with an
    // id below the kept maximum but committed just now: the overlap catches it.
    const rest = after(at(10, 0));
    db.add(rest.slice(1), Date.now());
    db.add(rest.slice(0, 1), Date.now(), 1);   // id 1, far below everything kept
    const before = db.calls.length;
    const k2 = [];
    await deriveDayServer(svcFor(db, k2), 'cid-1', 'uid-1', DAY, at(23, 0));
    const delta = db.calls.slice(before).find((c) => c.p_after_id != null);
    expect(delta, 'the warm read asked only for what is new').toBeTruthy();
    expect(delta.p_since).toBeTruthy();

    _dayCacheClear();
    const f2 = [];
    await deriveDayServer(svcFor(db, f2), 'cid-1', 'uid-1', DAY, at(23, 0));
    expect(writes(f2).length).toBeGreaterThan(10);
    expect(writes(k2)).toBe(writes(f2));
  });

  test('the warm read moves only the new rows, not the day', async () => {
    const { dayEvents, _dayCacheClear } = await import(SHARED);
    _dayCacheClear();
    const db = evidenceDb();
    db.add(EVENTS, Date.now() - 10 * 60000);
    const svc = svcFor(db, []);
    const a = await dayEvents(svc, 'uid-2', iso(at(0, 0)), iso(at(24, 0)));
    const extra = { ts: iso(at(15, 0)), type: 'fix', lat: 39.01, lon: -95.7, kind: null };
    db.add([extra], Date.now());
    const n0 = db.calls.length;
    const b = await dayEvents(svc, 'uid-2', iso(at(0, 0)), iso(at(24, 0)));
    const moved = db.rpcEvidence(db.calls[n0]).length;
    expect(moved, 'one new row travels, not the whole day').toBe(1);
    expect(b.length).toBe(a.length + 1);
    expect(b[b.length - 1]).toEqual({ ts: extra.ts, type: 'fix', kind: null, lat: 39.01, lon: -95.7, region_id: null, detail: null });
  });

  test('a failed delta, a rebuild and a stale copy all read the whole day', async () => {
    const { dayEvents, deriveDayServer, _dayCacheClear } = await import(SHARED);
    _dayCacheClear();
    const db = evidenceDb();
    db.add(EVENTS, Date.now() - 60000);
    await dayEvents(svcFor(db, []), 'uid-3', iso(at(0, 0)), iso(at(24, 0)));

    // The delta fails: whole day, and nothing half-merged is kept.
    const n0 = db.calls.length;
    const rows = await dayEvents(svcFor(db, [], { failDelta: true }), 'uid-3', iso(at(0, 0)), iso(at(24, 0)));
    expect(rows.length).toBe(EVENTS.length);
    expect(db.calls.slice(n0).some((c) => c.p_after_id == null && c.p_since == null)).toBe(true);

    // The ops portal's Rebuild passes opts: never the kept copy.
    const n1 = db.calls.length;
    await deriveDayServer(svcFor(db, []), 'cid-1', 'uid-3', DAY, at(23, 0), null, { sweep: false });
    expect(db.calls.slice(n1).every((c) => c.p_after_id == null)).toBe(true);
  });

  test('a delta that fills the cap is not trusted: the whole day is read', async () => {
    const { dayEvents, _dayCacheClear } = await import(SHARED);
    _dayCacheClear();
    const db = evidenceDb();
    db.add(EVENTS.slice(0, 5), Date.now() - 60000);
    const svc = svcFor(db, []);
    await dayEvents(svc, 'uid-4', iso(at(0, 0)), iso(at(24, 0)));
    // 12,000 new rows in one go (a backfill dump).
    const flood = Array.from({ length: 12000 }, (_, i) => ({ ts: iso(at(9, 0) + i * 1000), type: 'fix', lat: 39 + i * 1e-6, lon: -95.7, kind: null }));
    db.add(flood, Date.now());
    const n0 = db.calls.length;
    const rows = await dayEvents(svc, 'uid-4', iso(at(0, 0)), iso(at(24, 0)));
    expect(rows.length).toBe(12000);
    expect(db.calls.slice(n0).some((c) => c.p_after_id == null && c.p_since == null), 'fell back to a whole read').toBe(true);
  });

  test('the migration returns the id, and the full read is the default', () => {
    const fs = require('fs');
    const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261054_geo_day_evidence.sql'), 'utf8');
    expect(sql).toContain('e.type, e.kind, e.lat, e.lon, e.region_id, e.detail, e.id');
    expect(sql).toContain('(p_after_id is null and p_since is null)');
    expect(sql).toContain('or (p_after_id is not null and id > p_after_id)');
    expect(sql).toContain('or (p_since is not null and created_at >= p_since)');
    expect(sql).toContain('order by ts asc, id asc');
  });
});

// ── PINGS AND CLOCKS ARE KEPT TOO, AND STILL DERIVE THE SAME DAY (2026-10-01) ─
//
// After the evidence stopped travelling whole, location_pings and the
// account's clocks were most of what was left: every trigger upload re-read
// both. They are now kept and topped up off location_pings.created_at and
// td_time_entries.updated_at (migration 20261059). Same bar as above: the kept
// copy must write exactly what a whole fresh read writes, including a clock
// edited or deleted since the last read.
test.describe('kept pings and clocks derive exactly what a fresh read derives', () => {
  // A table that honours the filters derive-day uses, with insert/update times.
  const rowsDb = () => {
    const t = { location_pings: [], td_time_entries: [] };
    const log = [];
    const q = (name) => {
      const f = [];
      let sel = '*', lo = 0, hi = Infinity;
      const run = () => {
        let out = t[name].filter((r) => f.every((fn) => fn(r)));
        if (name === 'location_pings') out = out.slice().sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
        out = out.slice(lo, hi + 1);
        log.push({ name, sel, n: out.length, delta: f.some((fn) => fn.delta) });
        const cols = sel.split(',');
        return { data: out.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null]))), error: null };
      };
      const o = {
        select: (s) => { sel = s; return o; },
        eq: (c, v) => { f.push((r) => r[c] === v); return o; },
        is: (c, v) => { f.push((r) => (r[c] ?? null) === v); return o; },
        lt: (c, v) => { f.push((r) => Date.parse(r[c]) < Date.parse(v)); return o; },
        gte: (c, v) => {
          const fn = (r) => r[c] != null && Date.parse(r[c]) >= Date.parse(v);
          if (c === 'created_at' || c === 'updated_at') fn.delta = true;
          f.push(fn); return o;
        },
        order: () => o,
        range: async (a, b) => { lo = a; hi = b; return run(); },
        then: (res, rej) => Promise.resolve(run()).then(res, rej),
      };
      return o;
    };
    return { t, log, q };
  };
  const svcFor = (db, rpcLog) => {
    const base = fakeSvc({ ...TABLES, location_pings: [], td_time_entries: [] }, rpcLog);
    return { from: (name) => (db.t[name] ? db.q(name) : base.from(name)), rpc: base.rpc };
  };
  const writes = (log) => JSON.stringify(log.filter((c) => c.name === 'geo_replace_day').map((c) => c.args));
  let pid = 0;
  const ping = (ms, createdMs) => ({ id: 'p' + (++pid), employee_user_id: 'uid-9', ts: iso(ms),
    lat: CLIENT.lat + (ms % 997) * 1e-9, lon: CLIENT.lon, accuracy: 8, created_at: iso(createdMs) });
  const clock = (id, s, e, updMs, extra = {}) => ({ id, user_id: 'cid-9', deleted_at: null, updated_at: iso(updMs),
    data: { start_time: iso(s), end_time: iso(e), logged_by_uid: 'uid-9' }, ...extra });

  test('pings and clocks arriving, edited and deleted: kept and fresh write the same', async () => {
    const { deriveDayServer, _dayCacheClear } = await import(SHARED);
    _dayCacheClear();
    const db = rowsDb();
    const old = Date.now() - 5 * 60000;
    for (let m = 0; m < 60; m += 5) db.t.location_pings.push(ping(at(8, m), old));
    db.t.td_time_entries.push(clock('c1', at(7, 0), at(15, 0), old), clock('c2', at(7, 0), at(9, 0), old, { data: { start_time: iso(at(6, 0)), end_time: iso(at(6, 30)), logged_by_uid: 'uid-9' } }));

    const k1 = [];
    await deriveDayServer(svcFor(db, k1), 'cid-9', 'uid-9', DAY, at(23, 0));
    const f1 = [];
    await deriveDayServer(svcFor(db, f1), 'cid-9', 'uid-9', DAY, at(23, 0), null, { sweep: false });
    expect(writes(k1)).toBe(writes(f1));

    // New pings land, one clock is edited, one is soft-deleted.
    const now = Date.now();
    for (let m = 0; m < 30; m += 5) db.t.location_pings.push(ping(at(13, m), now));
    db.t.td_time_entries[0].data = { start_time: iso(at(7, 30)), end_time: iso(at(16, 0)), logged_by_uid: 'uid-9' };
    db.t.td_time_entries[0].updated_at = iso(now);
    db.t.td_time_entries[1].deleted_at = iso(now);
    db.t.td_time_entries[1].updated_at = iso(now);
    db.t.td_time_entries.push(clock('c3', at(17, 0), at(18, 0), now));

    const n0 = db.log.length;
    const k2 = [];
    await deriveDayServer(svcFor(db, k2), 'cid-9', 'uid-9', DAY, at(23, 0));
    const warm = db.log.slice(n0);
    expect(warm.filter((c) => c.name === 'location_pings').every((c) => c.delta), 'pings topped up, not re-read').toBe(true);
    expect(warm.filter((c) => c.name === 'td_time_entries').every((c) => c.delta), 'clocks topped up, not re-read').toBe(true);
    expect(warm.find((c) => c.name === 'location_pings').n).toBe(6);
    expect(warm.find((c) => c.name === 'td_time_entries').n).toBe(3);

    _dayCacheClear();
    const f2 = [];
    await deriveDayServer(svcFor(db, f2), 'cid-9', 'uid-9', DAY, at(23, 0));
    expect(writes(f2).length).toBeGreaterThan(10);
    expect(writes(k2)).toBe(writes(f2));
  });

  test('the kept clocks hand the deriver the same set a whole read returns', async () => {
    const { accountClocks, _dayCacheClear } = await import(SHARED);
    _dayCacheClear();
    const db = rowsDb();
    const old = Date.now() - 5 * 60000;
    db.t.td_time_entries.push(clock('a', at(7, 0), at(8, 0), old), clock('b', at(9, 0), at(10, 0), old),
      clock('x', at(1, 0), at(2, 0), old, { user_id: 'someone-else' }));
    const svc = svcFor(db, []);
    await accountClocks(svc, 'cid-9');
    db.t.td_time_entries[1].deleted_at = iso(Date.now());
    db.t.td_time_entries[1].updated_at = iso(Date.now());
    db.t.td_time_entries.push(clock('c', at(11, 0), at(12, 0), Date.now()));
    const kept = await accountClocks(svc, 'cid-9');
    const fresh = await accountClocks(svc, 'cid-9', { fresh: true });
    const ids = (r) => r.data.map((x) => x.data.start_time).sort();
    expect(ids(kept)).toEqual(ids(fresh));
    expect(ids(kept)).toEqual([iso(at(7, 0)), iso(at(11, 0))]);
  });

  test('a failed top-up, a full page and rows without ids all fall back to the whole read', async () => {
    const { dayPings, accountClocks, _dayCacheClear } = await import(SHARED);
    _dayCacheClear();
    const db = rowsDb();
    const old = Date.now() - 5 * 60000;
    for (let m = 0; m < 10; m++) db.t.location_pings.push(ping(at(8, m), old));
    const from = iso(at(0, 0)), to = iso(at(24, 0));
    await dayPings(svcFor(db, []), 'uid-9', from, to);

    // The column is not deployed yet: the top-up errors, the whole day comes back.
    const broken = { from: (name) => {
      const o = db.q(name);
      const g = o.gte;
      o.gte = (c, v) => { if (c === 'created_at') { o.range = async () => ({ data: null, error: { message: 'no column' } }); } return g(c, v); };
      return o;
    }, rpc: async () => ({ data: null }) };
    expect((await dayPings(broken, 'uid-9', from, to)).length).toBe(10);

    // A backfill dump fills the top-up page: whole read.
    await dayPings(svcFor(db, []), 'uid-9', from, to);
    for (let i = 0; i < 1000; i++) db.t.location_pings.push(ping(at(9, 0) + i * 1000, Date.now()));
    const n0 = db.log.length;
    expect((await dayPings(svcFor(db, []), 'uid-9', from, to)).length).toBe(1010);
    expect(db.log.slice(n0).some((c) => !c.delta), 'fell back to a whole read').toBe(true);

    // Old shape rows (no id) are used as read and never kept.
    _dayCacheClear();
    const bare = fakeSvc({ ...TABLES, td_time_entries: [{ data: { start_time: iso(at(7, 0)), end_time: iso(at(8, 0)) } }] }, []);
    expect((await accountClocks(bare, 'cid-9')).data.length).toBe(1);
    expect((await accountClocks(bare, 'cid-9')).data.length).toBe(1);
  });

  test('the migration adds the columns the top-ups read, additively', () => {
    const fs = require('fs');
    const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261059_changed_since_columns.sql'), 'utf8');
    expect(sql).toContain('alter table public.location_pings add column if not exists created_at timestamptz default now()');
    expect(sql).toContain('alter table public.job_time_entries add column if not exists updated_at');
    expect(sql).toContain('alter table public.shop_time_entries add column if not exists updated_at');
    expect(sql).not.toMatch(/drop column|rename (column|to)/i);
  });
});
