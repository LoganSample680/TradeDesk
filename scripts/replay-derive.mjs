#!/usr/bin/env node
// Replay a day the phone already derived, on the server's evidence, and diff.
//
// Owner 2026-09-11: "I just want to be able to compare what has already
// happened correctly in the past and something on the server side writes the
// exact same shit but doesnt rely on the app being opened."
//
// So this is not a new deriver. It is js/geo-derive.js, unmodified, loaded in
// Node and handed the inputs a SERVER can actually get: geo_events and
// location_pings for the tape and the fixes, geo_fences_for for the fences
// (20260929), td_time_entries for the clocks. Whatever comes out is what a
// scheduled job would have written. Whatever the phone wrote is in the same
// bundle, so the diff is the answer to "does it write the exact same rows".
//
// The two things it deliberately does NOT do, because neither exists off the
// phone and both are the second paint anyway (js/geo-track.js):
//   - road miles (_geoDeriveRouteMiles, MapKit then Valhalla/OSRM)
//   - vehicle assignment (_geoDeriveVehicleRows, reads the shift's truck)
// A diff line for either is expected, not a defect.
//
//   node scripts/replay-derive.mjs <bundle.json>

import fs from 'node:fs';

const src = fs.readFileSync(new URL('../js/geo-derive.js', import.meta.url), 'utf8');
const { geoDeriveDay, geoDeriveRows } =
  new Function(src + '\nreturn { geoDeriveDay, geoDeriveRows };')();

const b = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

const tape = (b.tape || []).map(([ts, kind]) => ({ ts, kind }));
const fixes = (b.fixes || []).map(([ts, lat, lng, acc]) => ({ ts, lat, lng, acc: acc ?? null }));
const appEvents = (b.appEvents || []).map(([ts, kind]) => ({ ts, kind }));
const clocks = (b.clocks || []).map(([start, end]) => ({ start, end }));
// geo_fences_for speaks snake_case over the wire; the deriver speaks the
// browser's shape. One place, so it cannot drift in two.
const fences = (b.fences || []).map(f => ({
  id: f.id, kind: f.kind, name: f.name, lat: Number(f.lat), lng: Number(f.lng),
  addr: f.addr || '',
  radiusFt: f.radius_ft != null ? Number(f.radius_ft) : undefined,
  placeId: f.place_id ?? undefined,
  clientId: f.client_id ?? undefined,
  jobId: f.job_id ?? undefined,
  scheduled: f.scheduled ?? undefined,
}));

const res = geoDeriveDay({
  day: b.day, dayStart: b.dayStart, dayEnd: b.dayEnd, personId: b.personId,
  tape, fixes, appEvents, fences, clocks, workHours: b.workHours,
  // The day is over. nowMs at its end means the open tail is judged from the
  // day's own edge and never from whenever this replay happens to run.
  nowMs: b.dayEnd,
});
const rows = geoDeriveRows(res, {
  contractorId: b.contractorId, employeeId: b.personId, shared: false, clocks,
});

const hm = ms => new Date(ms).toISOString().slice(11, 16);
const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, n);

console.log(`\n=== ${b.day}  ${b.person || b.personId}  (server evidence) ===`);
console.log(`input: ${tape.length} motion flips, ${fixes.length} fixes, ${appEvents.length} app events, ${fences.length} fences, ${clocks.length} clocks`);
console.log(`derived: ${res.journeys.length} journeys, ${res.dwells.length} dwells, ${res.legs.length} legs` +
  (res.pending ? ', pending' : '') + (res.open ? ', open' : '') +
  (rows.held.length ? `, ${rows.held.length} held` : ''));

const mine = [];
for (const r of rows.job_time_entries) mine.push({ k: 'time', key: r.client_key, a: Date.parse(r.arrived_at), z: Date.parse(r.departed_at), min: r.minutes, what: r.source + ' ' + (r.dest_place || r.job_id || '') });
for (const r of rows.shop_time_entries) mine.push({ k: 'shop', key: r.client_key, a: Date.parse(r.arrived_at), z: Date.parse(r.departed_at), min: r.minutes, what: 'shop' });
for (const r of rows.td_mileage) mine.push({ k: 'miles', key: r.id, a: Date.parse(r.startedIso), z: Date.parse(r.endedIso), min: r.mins, what: `${r.miles} mi ${r.calc_method}  ${r.from_name} -> ${r.to_name}` });
mine.sort((x, y) => x.a - y.a);

const theirs = (b.stored || []).slice().sort((x, y) => x.a - y.a);

console.log('\n-- server would write --');
for (const r of mine) console.log(`  ${pad(r.k, 5)} ${hm(r.a)}-${hm(r.z)} ${pad(r.min + 'm', 6)} ${pad(r.key, 26)} ${r.what}`);
console.log('\n-- the phone wrote --');
for (const r of theirs) console.log(`  ${pad(r.k, 5)} ${hm(r.a)}-${hm(r.z)} ${pad(r.min + 'm', 6)} ${pad(r.key, 26)} ${r.what}`);

// Matched on client_key, which is the deriver's own id for the span and the
// whole point of it being deterministic: same evidence, same id.
const byKey = m => { const o = new Map(); for (const r of m) o.set(r.k + '|' + r.key, r); return o; };
const A = byKey(mine), B = byKey(theirs);
const lines = [];
for (const [k, r] of A) if (!B.has(k)) lines.push(`  ONLY SERVER  ${pad(r.k, 5)} ${hm(r.a)}-${hm(r.z)} ${r.key}  ${r.what}`);
for (const [k, r] of B) if (!A.has(k)) lines.push(`  ONLY PHONE   ${pad(r.k, 5)} ${hm(r.a)}-${hm(r.z)} ${r.key}  ${r.what}`);
for (const [k, r] of A) {
  const o = B.get(k); if (!o) continue;
  const d = [];
  if (Math.abs(r.a - o.a) > 30000) d.push(`start ${hm(o.a)} -> ${hm(r.a)}`);
  if (Math.abs(r.z - o.z) > 30000) d.push(`end ${hm(o.z)} -> ${hm(r.z)}`);
  if (Number(r.min) !== Number(o.min)) d.push(`minutes ${o.min} -> ${r.min}`);
  if (r.what !== o.what) d.push(`${o.what}  ->  ${r.what}`);
  if (d.length) lines.push(`  DIFFERS      ${pad(r.k, 5)} ${r.key}: ${d.join('; ')}`);
}
console.log('\n-- diff --');
console.log(lines.length ? lines.join('\n') : '  identical');
console.log('');
