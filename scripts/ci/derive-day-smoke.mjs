#!/usr/bin/env node
// ── THE SERVER DERIVER, ACTUALLY RUN (owner 2026-09-15) ────────────────────
//
// "Getting a centralPoints not defined error in ops portal rebuilder."
//
// supabase/functions/_shared/derive-day.mjs called a `centralParts` that had
// never existed in that module. It is not a browser file, so no offline shard
// loads it; it is not SQL, so the migration lint never sees it; and Deno only
// resolves an identifier when the line runs. The deploy was green, the tests
// were green, and the first thing to find out was a person clicking Rebuild.
//
// The same lesson the migration lint learned twice: applying is not calling.
// This CALLS deriveDayServer against a stubbed Supabase client, so every line
// in the path a rebuild takes has to at least resolve. It needs no network, no
// keys and no database, and it runs in under a second.
//
// It is a SMOKE test, deliberately: the rules themselves are covered
// exhaustively by tests/e2e-geo-derive.spec.js against the same deriver. What
// is unique here, and what was missing, is the server wrapper around it.
import { deriveDayServer, centralDayKey, centralDayBounds } from '../../supabase/functions/_shared/derive-day.mjs';

const DAY = '2026-09-14';
const b = centralDayBounds(DAY);
const T = (h, m) => b.start + h * 3600000 + (m || 0) * 60000;

// His shape, in miniature: home, the yard, a customer, and the drive between.
const HOME = { lat: 39.0257251, lon: -95.7939329 };
const YARD = { lat: 39.0456577, lon: -95.7151106 };
const CUST = { lat: 39.10721, lon: -95.6650246 };

const events = [
  { ts: new Date(T(7, 0)).toISOString(), type: 'motion', kind: 'onFoot' },
  { ts: new Date(T(7, 24)).toISOString(), type: 'motion', kind: 'automotive' },
  { ts: new Date(T(7, 48)).toISOString(), type: 'motion', kind: 'onFoot' },
  { ts: new Date(T(7, 59)).toISOString(), type: 'motion', kind: 'automotive' },
  { ts: new Date(T(8, 24)).toISOString(), type: 'motion', kind: 'onFoot' },
  { ts: new Date(T(15, 43)).toISOString(), type: 'motion', kind: 'automotive' },
  { ts: new Date(T(16, 3)).toISOString(), type: 'motion', kind: 'onFoot' },
  { ts: new Date(T(16, 35)).toISOString(), type: 'motion', kind: 'automotive' },
  { ts: new Date(T(16, 53)).toISOString(), type: 'motion', kind: 'onFoot' },
  { ts: new Date(T(6, 30)).toISOString(), type: 'app-active' },
];
const pings = [
  [T(7, 24) + 5000, HOME], [T(7, 48) + 5000, YARD], [T(7, 55), YARD],
  [T(7, 59) + 5000, YARD], [T(8, 24) + 5000, CUST], [T(12, 0), CUST],
  [T(15, 43) + 5000, CUST], [T(16, 3) + 5000, YARD], [T(16, 20), YARD],
  [T(16, 35) + 5000, YARD], [T(16, 53) + 5000, HOME], [T(18, 0), HOME],
].map(([ts, p]) => ({ ts: new Date(ts).toISOString(), lat: p.lat, lon: p.lon, accuracy: 8 }));

const fences = [
  { id: 'place-h', kind: 'home_office', name: '7402 SW 22nd Ct', lat: HOME.lat, lng: HOME.lon, commute: false },
  { id: 'shop', kind: 'shop', name: 'JS Solutions shop', lat: YARD.lat, lng: YARD.lon, commute: false },
  { id: 'client-1', kind: 'client', name: 'Bill Lorson', client_id: '1', lat: CUST.lat, lng: CUST.lon, commute: false },
];

// A clock on a PREVIOUS day, which is what rule 19 learns from and what the
// line that threw was computing minutes for.
const clocks = [];
for (let n = 1; n <= 7; n++) {
  const d = new Date(Date.parse(DAY + 'T12:00:00Z') - n * 86400000).toISOString().slice(0, 10);
  clocks.push({ data: {
    // logged_by_uid is load-bearing in this fixture: a row without it belongs
    // to the OWNER, and a crew uid skips the whole block before it ever
    // reaches the minutes-of-day maths that threw.
    logged_by_uid: 'u-1',
    start_time: new Date(Date.parse(d + 'T12:55:00Z')).toISOString(),
    end_time: new Date(Date.parse(d + 'T21:45:00Z')).toISOString(),
  } });
}

// The smallest client that answers every call this path makes. Each builder
// returns itself so the chain resolves whatever order the caller uses, and the
// promise result is whatever the table was seeded with.
function stubClient(seed, calls) {
  const rowsFor = (table) => seed[table] || [];
  const make = (table) => {
    const q = {
      select: () => q, eq: () => q, gte: () => q, lt: () => q, is: () => q,
      order: () => q,
      range: (from, to) => Promise.resolve({ data: rowsFor(table).slice(from, to + 1), error: null }),
      maybeSingle: () => Promise.resolve({ data: rowsFor(table)[0] || null, error: null }),
      then: (res, rej) => Promise.resolve({ data: rowsFor(table), error: null }).then(res, rej),
    };
    return q;
  };
  return {
    from: (t) => make(t),
    rpc: (name, args) => {
      calls.push({ name, args });
      if (name === 'geo_fences_for') return Promise.resolve({ data: fences, error: null });
      return Promise.resolve({ data: null, error: null });
    },
  };
}

const seed = {
  geo_events: events,
  location_pings: pings,
  td_time_entries: clocks,
  zj_data: [{ settings: JSON.stringify({ workHours: { start: '06:00', end: '20:00', days: [1, 2, 3, 4, 5] } }) }],
};

const fail = (m) => { console.error('derive-day-smoke: ' + m); process.exit(1); };

const calls = [];
const out = await deriveDayServer(stubClient(seed, calls), 'c-1', 'u-1', DAY, T(20, 0), null, { sweep: true });

if (!out || typeof out !== 'object') fail('deriveDayServer returned nothing');
if (out.reason && /error|not defined|undefined/i.test(String(out.reason))) fail('reason: ' + out.reason);
if (!out.wrote) fail('wrote nothing: ' + JSON.stringify(out));

const write = calls.find((c) => c.name === 'geo_replace_day');
if (!write) fail('geo_replace_day was never called');

// Rule 20, end to end through the server path: his two commutes bill nothing
// and the two work drives do. This is the one rule whose whole job is to keep
// rows OUT, so a smoke test that only counted rows would pass while it was
// broken in either direction.
const miles = write.args.p_miles || [];
const pairs = miles.map((m) => m.from_name + ' -> ' + m.to_name).sort();
const want = ['Bill Lorson -> JS Solutions shop', 'JS Solutions shop -> Bill Lorson'].sort();
if (JSON.stringify(pairs) !== JSON.stringify(want)) {
  fail('mileage rows are ' + JSON.stringify(pairs) + ', expected ' + JSON.stringify(want));
}
if (centralDayKey(T(12, 0)) !== DAY) fail('centralDayKey disagrees with its own day bounds');

console.log('✅ derive-day-smoke: deriveDayServer ran, wrote ' +
  (write.args.p_time || []).length + ' time and ' + miles.length + ' mileage rows, commutes excluded');
