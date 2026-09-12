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
