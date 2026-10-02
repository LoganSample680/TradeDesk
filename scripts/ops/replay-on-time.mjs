#!/usr/bin/env node
// Rows on time, replayed (owner 2026-10-02: "keep iterating on how we can get
// previous data to always land in 10 seconds").
//
// The scoreboard every change to the server deriver is judged with. It takes a
// person's real evidence for some days (scripts/ops/replay-dump.sql, read-only)
// and plays it back through the REAL server deriver
// (supabase/functions/_shared/derive-day.mjs + geo-derive.mjs), one upload at a
// time in the order the server received them, against a stand-in for
// geo_replace_day that keeps its semantics (keyed upserts that keep the first
// write, 5b supersede, 5c open-row retire, a mileage leg written once). Then it
// scores every row the day ends with by the definition in
// scripts/ops/on-time-report.sql (second query):
//
//   drive    first write minus the drive's start
//   stop     first write minus the arrival
//   mileage  first write minus the drive's end (endedIso)
//
// 6am to 6pm Central only, the same window as the report. Rows the day does
// not end with (retired by 5b or 5c) are not scored; they are counted as
// flicker instead, because a row that came and went is the price of writing
// early and has to be watched next to the gain.
//
// What it does NOT replay: the phone's own derive and write. This scores the
// server alone, which is the only writer that can be on time with the app
// closed.
//
// ── USE ──────────────────────────────────────────────────────────────────
//   1. Edit `params` in scripts/ops/replay-dump.sql (person, days), run it with
//      the Supabase MCP execute_sql (or psql), save the `dump` value to a file.
//      The MCP's saved tool-result file works as is.
//   2. node scripts/ops/replay-on-time.mjs --dump jack.json [--dump logan.json]
//        --ref origin/main       replay another commit's server deriver
//        --deriver <dir|file>    or a derive-day.mjs on disk
//        --day 2026-10-01        score one day only
//        --misses                list every miss with its cause
//        --trace 08:12:36        with --day: every write, retire and revive of
//                                rows that start within a minute of it
//        --json out.json         write the numbers for a later comparison
//        --lag-ms 1000           upload received -> rows written (default 1s)
//        --ping-lag-s 900        for location_pings older than migration
//                                20261059 (no real created_at): assumed
//                                upload delay. 900s is the median measured on
//                                2026-10-01, the first day with real stamps.
//
// ── WHY A MISS WAS LATE ───────────────────────────────────────────────────
// Every row over 10 seconds gets one cause, tested in this order, each test a
// real derive so the answer is the deriver's, not a guess about it:
//   not at a saved place   a stop at an unsaved spot, or a leg to one: no
//                          crossing exists, so only the fix cluster can say it
//   phone upload late      the event that marks the moment (the flip, the
//                          crossing) reached the server more than 10s after
//                          it happened, or the evidence the write was waiting
//                          for did
//   no trigger             a derive at moment+10s on what had landed by then
//                          produces the row: the evidence was there and no
//                          upload asked for a derive
//   waiting on 4-minute gate   the last derive before the write, re-run with
//                          the write's clock, produces it: time was the only
//                          thing missing (parkedStillMs, stillEndMs)
//   waiting on motion flip / waiting on fix   the write's new evidence, with
//                          that class taken out, no longer produces the row
//   other                  none of the above
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SHARED = "supabase/functions/_shared";

// ── args ──────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const o = { dumps: [], ref: null, deriver: null, day: null, misses: false, json: null, lagMs: 1000, pingLagS: 900 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = () => argv[++i];
    if (a === "--dump") o.dumps.push(v());
    else if (a === "--ref") o.ref = v();
    else if (a === "--deriver") o.deriver = v();
    else if (a === "--day") o.day = v();
    else if (a === "--misses") o.misses = true;
    else if (a === "--trace") o.trace = v();
    else if (a === "--json") o.json = v();
    else if (a === "--lag-ms") o.lagMs = Number(v());
    else if (a === "--ping-lag-s") o.pingLagS = Number(v());
    else if (a === "-h" || a === "--help") { console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\nimport ")[0]); process.exit(0); }
    else if (!a.startsWith("--")) o.dumps.push(a);
    else { console.error("unknown flag " + a); process.exit(2); }
  }
  if (!o.dumps.length) { console.error("usage: replay-on-time.mjs --dump <file> [--ref <git ref> | --deriver <path>] [--misses] [--json out]"); process.exit(2); }
  return o;
}

// ── the deriver under test ────────────────────────────────────────────────
// A ref is read with `git show` into a temp dir, every .mjs in _shared, so
// derive-day.mjs resolves its siblings exactly as it does in the function.
async function loadDeriver(o) {
  let file;
  if (o.ref) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "replay-on-time-"));
    const names = execFileSync("git", ["-C", ROOT, "ls-tree", "--name-only", o.ref, SHARED + "/"], { encoding: "utf8" })
      .split("\n").filter((n) => n.endsWith(".mjs"));
    for (const n of names) {
      fs.writeFileSync(path.join(dir, path.basename(n)), execFileSync("git", ["-C", ROOT, "show", o.ref + ":" + n], { maxBuffer: 64 << 20 }));
    }
    file = path.join(dir, "derive-day.mjs");
  } else if (o.deriver) {
    file = fs.statSync(o.deriver).isDirectory() ? path.join(o.deriver, "derive-day.mjs") : o.deriver;
  } else {
    file = path.join(ROOT, SHARED, "derive-day.mjs");
  }
  return { M: await import(pathToFileURL(path.resolve(file)).href), label: o.ref || o.deriver || "working tree" };
}

// ── the dump ──────────────────────────────────────────────────────────────
// Accepts the bare `dump` object, a row holding it, or the MCP's saved
// tool-result file (JSON text wrapped in its untrusted-data fence).
function readDump(file) {
  const raw = fs.readFileSync(file, "utf8");
  const pick = (x) => {
    if (!x) return null;
    if (Array.isArray(x)) return pick(x[0]);
    if (x.ev && x.uid) return x;
    if (x.dump) return pick(typeof x.dump === "string" ? JSON.parse(x.dump) : x.dump);
    if (typeof x.result === "string") return pick(x.result);
    return null;
  };
  try {
    const j = JSON.parse(raw);
    const d = typeof j === "string" ? null : pick(j);
    if (d) return d;
    const s = typeof j === "string" ? j : (typeof j.result === "string" ? j.result : raw);
    const a = s.indexOf("\n["), b = s.lastIndexOf("]\n");
    if (a >= 0 && b > a) { const d2 = pick(JSON.parse(s.slice(a + 1, b + 1))); if (d2) return d2; }
  } catch { /* fall through */ }
  throw new Error(file + ": not a replay dump (scripts/ops/replay-dump.sql)");
}

// ── Central time, for the report window and the printout ─────────────────
const CT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", hour12: false,
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
function ct(ms) {
  const p = Object.fromEntries(CT.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, hms: `${String(Number(p.hour) % 24).padStart(2, "0")}:${p.minute}:${p.second}` };
}
const iso = (ms) => new Date(ms).toISOString();
const ms = (x) => (x == null ? null : Date.parse(x));

// ── geo_replace_day, the parts that decide when a row is FIRST written ────
// supabase/migrations/20261062: overlap refusal, step 3/4 keyed upserts that
// keep created_at, 5b supersede, 5c open-row retire, step 6 add-once miles
// (a provisional or addressUnknown leg may be rewritten, 20261064)
// (a deleted leg is re-inserted fresh), 6b leg supersede. p_sweep is always
// false on the ingest path, so the sweep is not modelled.
class Store {
  constructor() { this.time = new Map(); this.shop = new Map(); this.miles = new Map(); this.log = []; this.refused = 0; }
  write(a, T) {
    const rows = [...(a.p_time || []).map((r) => ["time", r]), ...(a.p_shop || []).map((r) => ["shop", r])];
    // The overlap refusal: one bad pair throws the whole set away.
    const closed = [], opens = [];
    for (const [, r] of rows) {
      const x = ms(r.arrived_at), z = ms(r.departed_at);
      if (r.departed_at != null && z < x) { this.refused++; this.log.push({ T, op: "refused", why: "end before start" }); return; }
      if (r.departed_at == null) opens.push([String(r.client_key || ""), x]); else closed.push([String(r.client_key || ""), x, z]);
    }
    let pairs = Math.max(opens.length - 1, 0);
    for (let i = 0; i < closed.length; i++) for (let j = 0; j < closed.length; j++)
      if (closed[i][0] < closed[j][0] && Math.max(closed[i][1], closed[j][1]) < Math.min(closed[i][2], closed[j][2])) pairs++;
    for (const o of opens) for (const c of closed) if (c[2] > o[1]) pairs++;
    if (pairs) { this.refused++; this.log.push({ T, op: "refused", why: pairs + " overlapping pair(s)" }); return; }

    const keys = { time: new Set(), shop: new Set() }, fresh = [];
    for (const [t, r] of rows) {
      const k = r.client_key, x = ms(r.arrived_at), z = r.departed_at == null ? null : ms(r.departed_at);
      if (k == null || (z != null && !(z > x))) continue;   // isempty(sp)
      const map = this[t], cur = map.get(k);
      if (!cur) {
        map.set(k, { tbl: t, key: k, arr: x, dep: z, source: r.source || (t === "shop" ? "shop" : "geofence"), created: T, deleted: null, revived: 0, eps: [{ from: T, arr: x, source: r.source || (t === "shop" ? "shop" : "geofence") }] });
        this.log.push({ T, op: "insert", tbl: t, key: k, arr: x });
      } else {
        if (cur.deleted != null) { cur.revived++; cur.eps.push({ from: T, arr: x, source: r.source || cur.source }); this.log.push({ T, op: "revive", tbl: t, key: k, arr: x, was: cur.deleted }); }
        Object.assign(cur, { arr: x, dep: z, source: r.source || cur.source, deleted: null });
      }
      keys[t].add(k); fresh.push([x, z == null ? Infinity : z]);
    }
    for (const t of ["time", "shop"]) for (const r of this[t].values()) {      // 5b
      if (r.deleted != null || keys[t].has(r.key) || (r.dep != null && r.dep < r.arr)) continue;
      const span = [r.arr, r.dep == null ? Infinity : r.dep];
      if (fresh.some((f) => f[1] > f[0] && Math.max(f[0], span[0]) < Math.min(f[1], span[1]))) {
        r.deleted = T; r.why = "5b"; Object.assign(r.eps[r.eps.length - 1], { to: T, why: "5b", lastArr: r.arr, lastSource: r.source }); this.log.push({ T, op: "retire-5b", tbl: t, key: r.key, arr: r.arr });
      }
    }
    const d0 = ms(a.p_day_start), d1 = ms(a.p_day_end);
    for (const t of ["time", "shop"]) for (const r of this[t].values()) {      // 5c
      if (r.deleted != null || r.dep != null || keys[t].has(r.key) || !(r.arr >= d0 && r.arr < d1)) continue;
      r.deleted = T; r.why = "5c"; Object.assign(r.eps[r.eps.length - 1], { to: T, why: "5c", lastArr: r.arr, lastSource: r.source }); this.log.push({ T, op: "retire-5c", tbl: t, key: r.key, arr: r.arr });
    }
    const keysM = new Set(), freshM = [];
    for (const m of a.p_miles || []) {                                          // 6
      if (m.id == null) continue;
      keysM.add(m.id);
      const s = ms(m.startedIso), e = ms(m.endedIso);
      if (s != null && e != null && e >= s) freshM.push([s, e]);
      const cur = this.miles.get(m.id);
      if (cur && cur.deleted == null && !cur.provisional && !(cur.addressUnknown && !m.addressUnknown)) continue;
      const created = cur && cur.deleted == null ? cur.created : T;
      this.miles.set(m.id, { key: m.id, start: s, end: e, from: m.from_name || m.from || "", to: m.to_name || m.to || "",
        addressUnknown: !!m.addressUnknown, provisional: m.provisional === true, created, deleted: null });
      this.log.push({ T, op: cur ? (cur.deleted != null ? "mile-reinsert" : "mile-rewrite") : "mile-insert", key: m.id, arr: e });
    }
    for (const m of this.miles.values()) {                                      // 6b
      if (m.deleted != null || keysM.has(m.key) || m.start == null || m.end == null) continue;
      if (freshM.some((f) => Math.max(f[0], m.start) < Math.min(f[1], m.end))) { m.deleted = T; this.log.push({ T, op: "mile-supersede", key: m.key, arr: m.end }); }
    }
  }
}

// ── the server's world, for one person, as of an instant ──────────────────
function world(dump, o) {
  const ev = dump.ev.map((r) => ({ ms: Number(r[0]), type: r[1], kind: r[2], lat: r[3], lon: r[4], region_id: r[5],
    detail: r[6] != null ? { staleMs: Number(r[6]) } : null, id: Number(r[7]), created: Number(r[8]) }))
    .filter((e) => e.ms > 0 && e.created > 0);
  let estPings = 0;
  const pings = dump.pings.map((r, i) => {
    const created = r[4] != null ? Number(r[4]) : (estPings++, Number(r[0]) + o.pingLagS * 1000);
    return { id: "p" + i, ms: Number(r[0]), lat: r[1], lon: r[2], accuracy: r[3], created };
  });
  const clocks = (dump.clocks || []).map((c, i) => ({ id: String(i), start: ms(c[0]), end: ms(c[1]), open: !!c[2], personal: !!c[3], by: c[4] || null }));
  const fenceDays = Object.keys(dump.fences || {}).sort();
  const fencesFor = (day) => dump.fences[day] || dump.fences[fenceDays.filter((d) => d <= day).pop() || fenceDays[0]] || [];
  const owned = new Set(Object.values(dump.fences || {}).flat().map((f) => String(f.id)));
  return { ev, pings, clocks, fencesFor, owned, estPings };
}

// A supabase-js stand-in. `cut` is the instant whose uploads are visible;
// `drop(e)` takes evidence out for the cause tests; `onWrite` gets the RPC.
function makeSvc(W, dump, ctx) {
  const vis = (e) => e.created <= ctx.cut && !(ctx.drop && ctx.drop(e));
  function builder(table) {
    const q = { f: [] };
    const b = {
      select() { return b; }, order() { return b; }, maybeSingle() { return b; }, is() { return b; },
      eq(k, v) { q.f.push(["eq", k, v]); return b; }, in(k, v) { q.f.push(["in", k, v]); return b; },
      gte(k, v) { q.f.push(["gte", k, v]); return b; }, lt(k, v) { q.f.push(["lt", k, v]); return b; },
      range(a, z) { q.r = [a, z]; return b; }, limit(n) { q.lim = n; return b; },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    const f = (op, k) => { const x = q.f.find((y) => y[0] === op && y[1] === k); return x ? x[2] : undefined; };
    function run() {
      if (table === "location_pings") {
        const g = ms(f("gte", "ts")), l = ms(f("lt", "ts")), since = f("gte", "created_at");
        let data = W.pings.filter((p) => vis(p) && p.ms >= g && p.ms < l && (since == null || p.created >= ms(since)))
          .sort((a, z) => a.ms - z.ms)
          .map((p) => ({ id: p.id, ts: iso(p.ms), lat: p.lat, lon: p.lon, accuracy: p.accuracy }));
        if (q.r) data = data.slice(q.r[0], q.r[1] + 1);
        return { data, error: null };
      }
      if (table === "td_time_entries") {
        const data = [];
        for (const c of W.clocks) {
          if (!(c.start <= ctx.cut)) continue;              // not punched yet
          const closed = c.end != null && c.end <= ctx.cut;
          data.push({ id: c.id, deleted_at: null, data: { start_time: iso(c.start), end_time: closed ? iso(c.end) : null,
            open: closed ? false : (c.open || c.end != null), personal: c.personal, logged_by_uid: c.by } });
        }
        return { data, error: null };
      }
      if (table === "geo_events") {                        // arrivalWatchDays' read
        const types = f("in", "type") || [], g = ms(f("gte", "ts"));
        const data = W.ev.filter((e) => vis(e) && types.includes(e.type) && e.ms >= g)
          .sort((a, z) => z.ms - a.ms).slice(0, q.lim || 1e9)
          .map((e) => ({ type: e.type, kind: e.kind, region_id: e.region_id, ts: iso(e.ms) }));
        return { data, error: null };
      }
      return { data: null, error: { message: "replay: no table " + table } };
    }
    return b;
  }
  return {
    from: builder,
    async rpc(name, a) {
      if (name === "geo_day_evidence") {
        const f0 = ms(a.p_from), t0 = ms(a.p_to), since = a.p_since ? ms(a.p_since) : null;
        const data = W.ev.filter((e) => vis(e) && e.ms >= f0 && e.ms < t0 && a.p_types.includes(e.type) &&
            ((a.p_after_id == null && since == null) || (a.p_after_id != null && e.id > a.p_after_id) || (since != null && e.created >= since)))
          .sort((x, y) => x.ms - y.ms || x.id - y.id).slice(0, a.p_limit || 12000)
          .map((e) => [e.ms, e.type, e.kind, e.lat, e.lon, e.region_id, e.detail, e.id]);
        return { data, error: null };
      }
      if (name === "geo_fences_for") return { data: W.fencesFor(a.p_day), error: null };
      if (name === "geo_work_settings") return { data: dump.ws || null, error: null };
      if (name === "geo_replace_day") { ctx.onWrite(a); return { data: {}, error: null }; }
      return { data: null, error: { message: "replay: no rpc " + name } };
    },
  };
}

// ingest-geo's own dwell (geo_device_state): opened on a work-region enter,
// closed on its exit. Only arrivalWatchDays reads it.
const isWork = (rid) => rid === "shop" || /^(job|place|client)-/.test(rid);

async function replayPerson(dump, M, o) {
  const W = world(dump, o);
  const uid = String(dump.uid), cid = String(dump.cid || dump.uid);
  const scored = new Set((o.day ? [o.day] : dump.days).map(String));
  const store = new Store();
  const ctx = { cut: 0, drop: null, onWrite: null };
  const svc = makeSvc(W, dump, ctx);
  const clear = () => { if (typeof M._dayCacheClear === "function") M._dayCacheClear(); };

  // One derive, either for real (into the store) or as a question (the rows
  // it would send, nothing stored).
  async function derive(day, cut, nowMs, drop = null) {
    clear();
    let sent = null;
    ctx.cut = cut; ctx.drop = drop; ctx.onWrite = (a) => { sent = a; };
    try { await M.deriveDayServer(svc, cid, uid, day, nowMs, null); } catch (e) { sent = { error: String(e && e.message || e) }; }
    ctx.drop = null;
    return sent;
  }

  const batches = new Map();
  for (const e of W.ev) (batches.get(e.created) || batches.set(e.created, []).get(e.created)).push(e);
  const deriveTimes = new Map();        // day -> [T]
  let derives = 0, watchDerives = 0, dw = null;
  for (const cr of [...batches.keys()].sort((a, b) => a - b)) {
    const batch = batches.get(cr).sort((a, b) => a.ms - b.ms || a.id - b.id);
    for (const e of batch) {
      if (e.lat == null || e.lon == null || (e.type !== "regionEnter" && e.type !== "regionExit")) continue;
      const rid = String(e.region_id || "");
      const own = rid === "shop" || rid === "fence" || W.owned.has(rid);
      if (e.type === "regionEnter" && isWork(rid) && own && (!dw || dw.rid !== rid)) dw = { rid, ts: e.ms };
      else if (e.type === "regionExit" && dw && dw.rid === rid) dw = null;
    }
    const T = cr + o.lagMs;
    const evs = batch.map((e) => ({ type: e.type, ts: e.ms, lat: e.lat, lng: e.lon, regionId: e.region_id || "", kind: e.kind, detail: e.detail }));
    let days = M.daysToDerive(evs, T), viaWatch = false;
    if (!days.length && typeof M.arrivalWatchDays === "function") {
      ctx.cut = T; ctx.drop = null; clear();
      days = await M.arrivalWatchDays(svc, uid, evs, T, dw ? dw.ts : null);
      viaWatch = days.length > 0;
    }
    for (const day of days) {
      if (!scored.has(day)) continue;
      const sent = await derive(day, T, T);
      derives++; if (viaWatch) watchDerives++;
      (deriveTimes.get(day) || deriveTimes.set(day, []).get(day)).push(T);
      if (sent && !sent.error) store.write(sent, T);
    }
  }

  // ── score ──────────────────────────────────────────────────────────────
  const rows = [];
  const inWindow = (at) => { const c = ct(at); return scored.has(c.day) && c.hour >= 6 && c.hour <= 17 ? c : null; };
  for (const t of ["time", "shop"]) for (const r of store[t].values()) {
    if (r.deleted != null) continue;
    const c = inWindow(r.arr); if (!c) continue;
    rows.push({ kind: /^drive/.test(r.source) ? "drive" : "stop", tbl: t, key: r.key, source: r.source, at: r.arr,
      day: c.day, hms: c.hms, first: r.created, lag: (r.created - r.arr) / 1000, unsaved: /^unsaved/.test(r.source || "") });
  }
  for (const m of store.miles.values()) {
    if (m.deleted != null || m.end == null) continue;
    const c = inWindow(m.end); if (!c) continue;
    rows.push({ kind: "mileage", tbl: "miles", key: m.key, source: (m.from || "?") + " -> " + (m.to || "?"), at: m.end,
      day: c.day, hms: c.hms, first: m.created, lag: (m.created - m.end) / 1000, unsaved: m.addressUnknown });
  }

  // ── why each miss was late ─────────────────────────────────────────────
  const has = (sent, r) => {
    if (!sent || sent.error) return false;
    if (r.tbl === "miles") return (sent.p_miles || []).some((m) => m.id === r.key);
    return [...(sent.p_time || []), ...(sent.p_shop || [])].some((x) => x.client_key === r.key);
  };
  const MOTION = (e) => e.type === "motion";
  const FIX = (e) => e.type === "fix" || e.type === "visit" || e.type === "push-ping" || e.type === "clock-in" || e.type === "clock-out" || String(e.id).startsWith("p");
  for (const r of rows) {
    if (!(r.lag > 10)) continue;
    const anchor = W.ev.filter((e) => Math.abs(e.ms - r.at) <= 1500).sort((a, b) => a.created - b.created)[0];
    const dayDerives = deriveTimes.get(r.day) || [];
    const prev = dayDerives.filter((t) => t < r.first).pop();
    let cause = "other", detail = "";
    if (r.unsaved) cause = "not at a saved place";
    else if (anchor && anchor.created - r.at > 10000) { cause = "phone upload late"; detail = `${anchor.type} reached the server ${Math.round((anchor.created - r.at) / 1000)}s after it happened`; }
    else if (has(await derive(r.day, r.at + 10000, r.at + 10000), r)) cause = "no trigger";
    else if (prev != null && has(await derive(r.day, prev, r.first), r)) cause = "waiting on 4-minute gate";
    else if (prev != null) {
      const newer = (e) => e.created > prev && e.created <= r.first;
      for (const [name, cls] of [["motion flip", MOTION], ["fix", FIX]]) {
        const pool = [...W.ev, ...W.pings];
        if (has(await derive(r.day, r.first, r.first, (e) => newer(e) && cls(e)), r)) continue;
        // That class was what the write waited for. Did it happen late, or
        // happen on time and arrive late?
        const late = pool.filter((e) => newer(e) && cls(e) && e.ms <= r.at + 10000);
        if (late.length) { cause = "phone upload late"; detail = `${name} at ${ct(Math.min(...late.map((e) => e.ms))).hms} reached the server late`; }
        else { cause = "waiting on " + name; const next = pool.filter((e) => newer(e) && cls(e)).sort((a, b) => a.ms - b.ms)[0];
          if (next) detail = `first new ${name} ${ct(next.ms).hms}`; }
        break;
      }
    } else cause = "no trigger";
    r.cause = cause; r.detail = detail;
  }

  // ── flicker: rows written and then taken back ──────────────────────────
  // One entry per time a row was on the timesheet and then retired, revived
  // or not: a provisional stop at a drive-by that the real stop later reuses
  // (same key, the drive's own) blinked all the same.
  const ghosts = [];
  for (const t of ["time", "shop"]) for (const r of store[t].values()) {
    for (const e of r.eps) {
      if (e.to == null) continue;
      const c = ct(e.lastArr); if (!scored.has(c.day)) continue;
      ghosts.push({ kind: /^drive/.test(e.lastSource || "") ? "drive" : "stop", source: e.lastSource, day: c.day, hms: c.hms, key: r.key,
        final: "retired-" + e.why + (r.deleted == null ? ", key back later" : ""), lifeS: Math.round((e.to - e.from) / 1000) });
    }
  }
  const mileGhosts = [...store.miles.values()].filter((m) => m.deleted != null && scored.has(ct(m.end || 0).day)).length;
  // A provisional leg the day ENDS with never got its settled rewrite: the
  // miles went out on the crossing alone. Counted so a gain in mileage
  // on-time can never hide a pile of legs nobody confirmed.
  const mileUnsettled = [...store.miles.values()].filter((m) => m.deleted == null && m.provisional && scored.has(ct(m.end || 0).day)).length;
  // And how many times a leg's end moved after it was first written.
  const mileMoved = store.log.filter((l) => l.op === "mile-rewrite").length;
  if (o.trace && o.day) {
    const t = Date.parse(`${o.day}T${o.trace}Z`), off = t - Date.parse(`${o.day}T${o.trace}Z`.replace("Z", "-05:00"));
    const at = t - off;   // the trace time as Central (CDT)
    const keys = new Set(store.log.filter((l) => l.arr != null && Math.abs(l.arr - at) <= 60000).map((l) => l.key));
    for (const l of store.log) if (keys.has(l.key))
      console.log(`  trace ${ct(l.T).hms} ${l.op.padEnd(14)} ${(l.tbl || "miles").padEnd(5)} ${ct(l.arr).hms} ${l.key}`);
  }
  const refusedDays = {};
  for (const l of store.log) if (l.op === "refused") refusedDays[ct(l.T).day] = (refusedDays[ct(l.T).day] || 0) + 1;
  return { uid, rows, ghosts, mileGhosts, mileUnsettled, mileMoved, derives, watchDerives, refused: store.refused, refusedDays, estPings: W.estPings };
}

// ── report ────────────────────────────────────────────────────────────────
function stats(list) {
  const lags = list.map((r) => r.lag).sort((a, b) => a - b);
  const q = (p) => lags.length ? lags[Math.min(lags.length - 1, Math.floor(p * (lags.length - 1) + 0.5))] : null;
  return { n: lags.length, pct10: lags.length ? Math.round(100 * lags.filter((x) => x <= 10).length / lags.length) : null,
    med: q(0.5) == null ? null : Math.round(q(0.5)), p90: q(0.9) == null ? null : Math.round(q(0.9)) };
}
const KINDS = ["drive", "stop", "mileage"];
const pad = (s, n) => String(s).padEnd(n), lpad = (s, n) => String(s).padStart(n);

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const { M, label } = await loadDeriver(o);
  const out = { deriver: label, lagMs: o.lagMs, people: [] };
  console.log(`replay-on-time: deriver ${label}, rows written ${o.lagMs}ms after the upload`);
  for (const f of o.dumps) {
    const dump = readDump(f);
    const who = path.basename(f).replace(/\.json$|\.txt$/, "");
    const t0 = Date.now();
    const res = await replayPerson(dump, M, o);
    const days = [...new Set(res.rows.map((r) => r.day))].sort();
    const person = { who, uid: res.uid, days: {}, all: {}, causes: {}, flicker: {}, misses: [] };
    console.log(`\n${who}  (${res.derives} derives, ${res.watchDerives} on a fix watch, ${res.refused} refused writes` +
      `${res.refused ? " " + JSON.stringify(res.refusedDays) : ""}, ` +
      `${res.estPings} pings with an estimated upload time, ${Math.round((Date.now() - t0) / 1000)}s)`);
    console.log(`  ${pad("day", 11)} ${pad("kind", 8)} ${lpad("n", 4)} ${lpad("<=10s", 6)} ${lpad("med", 7)} ${lpad("p90", 7)}`);
    for (const d of [...days, "ALL"]) {
      person.days[d] = {};
      for (const k of KINDS) {
        const s = stats(res.rows.filter((r) => r.kind === k && (d === "ALL" || r.day === d)));
        if (!s.n) continue;
        person.days[d][k] = s;
        console.log(`  ${pad(d, 11)} ${pad(k, 8)} ${lpad(s.n, 4)} ${lpad(s.pct10 + "%", 6)} ${lpad(s.med + "s", 7)} ${lpad(s.p90 + "s", 7)}`);
      }
    }
    person.all = person.days.ALL;
    const miss = res.rows.filter((r) => r.lag > 10).sort((a, b) => a.at - b.at);
    for (const r of miss) {
      const c = person.causes[r.cause] || (person.causes[r.cause] = { drive: 0, stop: 0, mileage: 0 });
      c[r.kind]++;
      person.misses.push({ day: r.day, at: r.hms, kind: r.kind, lagS: Math.round(r.lag), cause: r.cause, detail: r.detail, source: r.source, key: r.key });
    }
    console.log("  misses by cause (drive / stop / mileage):");
    for (const [c, v] of Object.entries(person.causes).sort((a, b) => (b[1].drive + b[1].stop + b[1].mileage) - (a[1].drive + a[1].stop + a[1].mileage)))
      console.log(`    ${pad(c, 26)} ${v.drive} / ${v.stop} / ${v.mileage}`);
    for (const k of ["drive", "stop"]) {
      const g = res.ghosts.filter((x) => x.kind === k).map((x) => x.lifeS).sort((a, b) => a - b);
      person.flicker[k] = { n: g.length, medianS: g.length ? g[Math.floor((g.length - 1) / 2)] : null, longestS: g.length ? g[g.length - 1] : 0 };
    }
    person.flicker.mileage = { retired: res.mileGhosts, rewritten: res.mileMoved, unsettled: res.mileUnsettled };
    console.log(`  flicker (on the timesheet, then taken back): stop ${person.flicker.stop.n} (median ${person.flicker.stop.medianS ?? "-"}s, ` +
      `longest ${person.flicker.stop.longestS}s), drive ${person.flicker.drive.n} (median ${person.flicker.drive.medianS ?? "-"}s, ` +
      `longest ${person.flicker.drive.longestS}s), legs retired ${res.mileGhosts}, legs rewritten ${res.mileMoved}, legs never settled ${res.mileUnsettled}`);
    person.ghosts = res.ghosts;
    person.rows = res.rows.map((r) => ({ day: r.day, at: r.hms, kind: r.kind, source: r.source, key: r.key, lagS: Math.round(r.lag) }));
    if (o.misses) {
      console.log("  every miss:");
      for (const m of person.misses) console.log(`    ${m.day} ${m.at} ${pad(m.kind, 7)} ${lpad(m.lagS + "s", 7)}  ${pad(m.cause, 26)} ${m.source}${m.detail ? "  (" + m.detail + ")" : ""}`);
      console.log("  every row written and taken back:");
      for (const g of res.ghosts) console.log(`    ${g.day} ${g.hms} ${pad(g.kind, 6)} ${pad(g.source, 18)} ${lpad(g.lifeS + "s", 7)}  ${g.final}`);
    }
    out.people.push(person);
  }
  if (o.json) fs.writeFileSync(o.json, JSON.stringify(out, null, 1));
}

main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
