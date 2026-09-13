// The deriver, running on the server, for a day of somebody's events.
//
// Owner 2026-09-11: "why not just point it easily server side so it doesnt
// need a app active to run it, server runs it as they happen, in real-time."
//
// Nothing here decides anything. geoDeriveDay and geoDeriveRows come straight
// out of js/geo-derive.js (generated into _shared/geo-derive.js by
// scripts/gen-shared-deriver.mjs, CI fails if it is stale), and geo_replace_day
// is the same RPC the phone calls. This file is only the plumbing between
// them: read the raw evidence out of the tables, hand it over in the shape the
// deriver expects, pass the rows to the writer. Same rules, same ids, same
// rows, whether or not anybody is holding the phone.
//
// ── p_sweep IS ALWAYS FALSE HERE, and it is not a detail ───────────────────
// A sweep RETIRES automatic rows the derive did not produce. The phone may do
// that for a day its own CoreMotion tape covers end to end, because absence of
// evidence there really is evidence of absence. The server only ever sees what
// has been flushed to it, so a stretch nobody uploaded yet looks exactly like a
// stretch that did not happen. "may ADD but never RETIRE" is the only safe
// reading of partial evidence, and it is what geo_replace_day already does when
// p_sweep is false (CLAUDE.md 17, owner 2026-09-04: "cant risk data going away
// ever"). The phone's own rebuild still sweeps properly the next morning.

import { geoDeriveDay, geoDeriveRows } from "./geo-derive.mjs";

const CENTRAL = "America/Chicago";
const TWO_HOURS = 2 * 3600_000;
// A phone can hand up a week in one boot; a live flush touches one day or two.
// Anything older than this in one call is a backfill and belongs to the phone's
// own rebuild, not to an ingest that has to answer in seconds.
const MAX_DAYS_PER_CALL = 2;

// ── Central day bounds, the same arithmetic js/geo-track.js does ────────────
// Derived from Intl rather than a fixed -5/-6, so the two days a year that are
// 23 and 25 hours long are right without anybody remembering them.
function centralOffset(ms) {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: CENTRAL, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(ms));
  const g = (t) => Number(p.find((x) => x.type === t).value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second")) - ms;
}
export function centralDayKey(ms) {
  return new Date(ms + centralOffset(ms)).toISOString().slice(0, 10);
}
export function centralDayBounds(day) {
  const utc = Date.parse(day + "T00:00:00Z");
  if (!(utc > 0)) return null;
  // Two passes: the offset at the guessed instant, then re-read at the result,
  // so a boundary that lands inside the DST hour still resolves to midnight.
  const start = utc - centralOffset(utc - centralOffset(utc));
  const nextUtc = Date.parse(day + "T00:00:00Z") + 86400_000;
  const end = nextUtc - centralOffset(nextUtc - centralOffset(nextUtc));
  return end > start ? { start, end } : null;
}

// The event types that can change the SHAPE of a day. A flush of nothing but
// breadcrumbs refines positions the next real trigger will read anyway, and
// deriving on every one of those would re-read a whole day's events every few
// seconds for no new rows. This is the same trigger set the phone re-derives on
// (js/geo-track.js): a motion flip, a fence crossing, a lifecycle event, a
// clock punch, or the half-hourly ping that exists precisely to re-check.
const TRIGGER_TYPES = new Set([
  "motion", "regionEnter", "regionExit", "visit", "push-ping",
  "clock-in", "clock-out", "app-active", "app-background", "app-terminate", "app-relaunch",
]);
export function daysToDerive(evs, nowMs) {
  const days = new Set();
  for (const e of evs) {
    if (!e || !TRIGGER_TYPES.has(e.type)) continue;
    if (!(e.ts > 0) || e.ts > nowMs + TWO_HOURS) continue;
    days.add(centralDayKey(e.ts));
  }
  // Newest first, then capped: if a batch somehow spans a week, today is the
  // day somebody is looking at.
  return [...days].sort().reverse().slice(0, MAX_DAYS_PER_CALL);
}

// Fresh positions only, exactly as the phone reads them back
// (_GEO_FRESH_FIX_TYPES, js/geo-track.js). A motion or fence row carries the
// LAST KNOWN position, which after a wake can be a mile stale, and one of those
// in the trace once read a 3-mile drive as 6.1.
const FRESH_FIX_TYPES = ["fix", "clock-in", "clock-out"];
const PAGE = 1000, MAX_PAGES = 12;

async function pageAll(build) {
  const out = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const { data } = await build(i * PAGE, (i + 1) * PAGE - 1);
    if (!Array.isArray(data)) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

// An outcome is { day, wrote, reason?, dwells?, legs?, time?, shop?, miles?,
// held? }: enough for the caller to log why a day produced nothing without
// having to guess.
// One person, one Central day, end to end.
export async function deriveDayServer(svc, cid, uid, day, nowMs = Date.now()) {
  const b = centralDayBounds(day);
  if (!b) return { day, wrote: false, reason: "bad day" };
  const fromIso = new Date(b.start - TWO_HOURS).toISOString();
  const toIso = new Date(b.end).toISOString();

  // The tape reaches two hours before midnight for the same reason the phone's
  // does: a drive that began at 11:40pm is the previous day's departure and
  // this day's arrival, and the flip that opened it is on the other side.
  const [evRows, pingRows, fenceRes, clockRes, cfgRes] = await Promise.all([
    pageAll((f, t) => svc.from("geo_events")
      .select("ts,type,kind,lat,lon")
      .eq("employee_user_id", uid).gte("ts", fromIso).lt("ts", toIso)
      .order("ts", { ascending: true }).range(f, t)),
    pageAll((f, t) => svc.from("location_pings")
      .select("ts,lat,lon,accuracy")
      .eq("employee_user_id", uid).gte("ts", fromIso).lt("ts", toIso)
      .order("ts", { ascending: true }).range(f, t)),
    svc.rpc("geo_fences_for", { p_contractor: cid, p_day: day }),
    svc.from("td_time_entries").select("data").eq("user_id", cid).is("deleted_at", null),
    svc.from("zj_data").select("settings").eq("user_id", cid).maybeSingle(),
  ]);

  const tape = [];
  const fixes = [];
  const appEvents = [];
  for (const e of evRows) {
    const ts = Date.parse(e.ts);
    if (!(ts > 0)) continue;
    if (e.type === "motion" && e.kind) tape.push({ ts, kind: String(e.kind) });
    else if (String(e.type).startsWith("app-")) appEvents.push({ ts, kind: String(e.type).slice(4) });
    if (FRESH_FIX_TYPES.includes(e.type) && e.lat != null && e.lon != null) {
      fixes.push({ ts, lat: Number(e.lat), lng: Number(e.lon), acc: null });
    }
  }
  for (const p of pingRows) {
    const ts = Date.parse(p.ts);
    if (ts > 0 && p.lat != null && p.lon != null) {
      fixes.push({ ts, lat: Number(p.lat), lng: Number(p.lon), acc: p.accuracy != null ? Number(p.accuracy) : null });
    }
  }
  fixes.sort((a, b2) => a.ts - b2.ts);
  tape.sort((a, b2) => a.ts - b2.ts);
  appEvents.sort((a, b2) => a.ts - b2.ts);

  // NOTHING TO GO ON IS NOT AN EMPTY DAY. The phone refuses to derive a day
  // its tape does not cover (js/geo-track.js), and the server has strictly
  // less: a day with no flips and no lifecycle events is a day nobody has
  // uploaded, not a day nobody worked.
  const tapeCovers = tape.some((t) => t.ts >= b.start - TWO_HOURS && t.ts < b.end);
  const appCovers = appEvents.some((e) => e.ts >= b.start && e.ts < b.end);
  if (!tapeCovers && !appCovers) return { day, wrote: false, reason: "no evidence" };

  // geo_fences_for speaks snake_case; the deriver speaks the browser's shape.
  // One mapping, in one place, so it cannot drift into two.
  const fences = (Array.isArray(fenceRes?.data) ? fenceRes.data : []).map((f) => ({
    id: f.id, kind: f.kind, name: f.name,
    lat: Number(f.lat), lng: Number(f.lng), addr: f.addr || "",
    radiusFt: f.radius_ft != null ? Number(f.radius_ft) : undefined,
    placeId: f.place_id ?? undefined,
    clientId: f.client_id ?? undefined,
    jobId: f.job_id ?? undefined,
    scheduled: f.scheduled ?? undefined,
    // ── RULE 13'S OTHER TWO WITNESSES ────────────────────────────────────
    // `personal` shipped with the family flag (20261003) and was added to
    // geo_fences_for without ever being mapped HERE, so the server counted a
    // visit to a family address as work while the phone held it: the same day
    // derived two different ways depending on which side got there first.
    // `onBooks` (20261006) is its reprieve and has to travel with it.
    // Neither may be dropped: this mapping is the whole contract between the
    // SQL fence list and the deriver's shape.
    personal: f.personal ?? undefined,
    onBooks: f.on_books ?? undefined,
  }));

  // This person's closed manual clocks touching the day (rule 13). The owner's
  // own rows carry logged_by_uid null; a crew member's carry their uid, which
  // is the same test _geoDeriveClocks makes.
  const clocks = [];
  for (const r of (Array.isArray(clockRes?.data) ? clockRes.data : [])) {
    const d = r?.data || {};
    if (d.open || !d.start_time || !d.end_time) continue;
    const owner = d.logged_by_uid ? String(d.logged_by_uid) === uid : uid === cid;
    if (!owner) continue;
    const s = Date.parse(d.start_time), e = Date.parse(d.end_time);
    if (s > 0 && e > s && e > b.start && s < b.end) clocks.push({ start: s, end: e });
  }

  let workHours = { start: "06:00", end: "20:00", days: [1, 2, 3, 4, 5, 6] };
  try {
    const raw = cfgRes?.data?.settings;
    const s = typeof raw === "string" ? JSON.parse(raw) : raw;
    const w = s?.workHours;
    const ok = (v) => /^\d{1,2}:\d{2}$/.test(String(v || ""));
    if (w) workHours = {
      start: ok(w.start) ? w.start : "06:00",
      end: ok(w.end) ? w.end : "20:00",
      days: Array.isArray(w.days) && w.days.length ? w.days.map(Number) : [1, 2, 3, 4, 5, 6],
    };
  } catch { /* defaults stand */ }

  const res = geoDeriveDay({
    day, dayStart: b.start, dayEnd: b.end, personId: uid,
    tape, fixes, appEvents, fences, nowMs, clocks, workHours,
  });

  // MISSING EVIDENCE IS NOT AN EMPTY DAY, the second half of it: drives that
  // are plainly on the tape and resolve to nowhere at all mean the fixes have
  // not arrived, not that the truck teleported. Same guard the phone makes.
  const resolvedAny = !!(res.legs.length || res.dwells.length || res.pending || res.open);
  if (res.journeys.length && !resolvedAny) return { day, wrote: false, reason: "unresolved" };

  const rows = geoDeriveRows(res, { contractorId: cid, employeeId: uid, shared: false, clocks });
  const nothing = !rows.job_time_entries.length && !rows.shop_time_entries.length && !rows.td_mileage.length;
  // Nothing to add, and this call may never retire: a write would be a no-op
  // with a round trip attached.
  if (nothing) return { day, wrote: false, reason: "nothing to add", dwells: res.dwells.length, legs: res.legs.length };

  const { error } = await svc.rpc("geo_replace_day", {
    p_contractor: cid, p_employee: uid, p_day: day,
    p_day_start: new Date(b.start).toISOString(),
    p_day_end: new Date(b.end).toISOString(),
    p_time: rows.job_time_entries, p_shop: rows.shop_time_entries, p_miles: rows.td_mileage,
    p_sweep: false,
  });
  if (error) return { day, wrote: false, reason: "geo_replace_day: " + error.message };

  return {
    day, wrote: true,
    dwells: res.dwells.length, legs: res.legs.length,
    time: rows.job_time_entries.length, shop: rows.shop_time_entries.length,
    miles: rows.td_mileage.length, held: rows.held.length,
  };
}
