// Supabase Edge Function: ingest-geo
//
// The real-time half of the geofence engine (owner directive 2026-08-27:
// mileage and time logs land in Supabase the moment a fence trips, app
// force-closed or not). The phone's native layer (TdGeoPlugin, build 39+)
// background-POSTs its buffered location events here within seconds of every
// wake. This function stores the raw events (geo_events), keeps the device
// state the push-ping and the live card read, and RUNS THE DERIVER.
//
// ── The one design rule: this is NOT a second brain ─────────────────────────
// It never was allowed to be, and now it is not even shaped like one. The
// fence-bounded state machine below used to write rows of its own and was
// stood down on 2026-09-02 for being a third writer of one event. What
// replaced it (owner 2026-09-11: "why not just point it easily server side so
// it doesnt need a app active to run it, server runs it as they happen, in
// real-time") is the actual deriver: geoDeriveDay and geoDeriveRows out of
// js/geo-derive.js, the same functions the phone runs, generated into
// _shared/geo-derive.js by scripts/gen-shared-deriver.mjs with CI failing if
// the copy goes stale. Same rules, same client_key on every row, same
// geo_replace_day. A rule changed on the phone is changed here in the same
// commit, because there is only one copy of the rules to change.
//
// The one thing the server does differently is that it never sweeps: see
// _shared/derive-day.mjs for why partial evidence may only ever add.
//
// ── Why duplicates cannot happen ────────────────────────────────────────────
// Keys are minted with the EXACT client derivations:
//   legKey        = uid8 + '-leg-' + base36(startMs)          (_geoLegKey)
//   visit key     = uid8 + '-vis-' + kind+'-'+id+'-' + base36 (_geoVisitKey)
// job/shop_time_entries carry a unique index on (contractor_user_id,
// client_key) and BOTH writers upsert with ignoreDuplicates, so whoever
// writes second is a no-op. td_mileage is guarded by a legKey existence
// check here and by the client's own legKey check + refine sweep there.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// Plain ESM, not .ts, so Deno and the Node test harness load the exact same
// file: tests/e2e-geo-derive-server.spec.js drives this module directly.
import { centralDayKey, daysToDerive, deriveDayServer, workSettings } from "../_shared/derive-day.mjs";
import { railCardFor } from "../_shared/live-card.mjs";
import { pushLiveCard } from "../_shared/live-push.ts";
import { sendSilentWake } from "../_shared/silent-push.ts";
import { terminateWakeDue, workHoursFromSettings } from "../_shared/terminate-wake.mjs";
import { apnsConfigured } from "../_shared/apns.ts";
import { makeRoute } from "../_shared/route-cache.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// ── Client-identical key derivations (js/geo-track.js) ──────────────────────
// ── ONE FLIP, ONE ID (owner rule 2026-08-31) ────────────────────────────────
// When the plugin sends a flipId, it IS the key, byte for byte, on both
// writers. Nothing is computed, so nothing can be computed differently.
//
// The derived form stays only as the fallback for an older build that sends no
// flipId, and it is exactly the thing that broke: base36 of the start
// millisecond, computed independently by two writers, off four samples iOS
// emitted for one departure. The phone keyed off ...35.747 and this keyed off
// ...35.529, and one drive home became two rows with two distances.
const legKeyOf = (uid: string, startMs: number, flipId?: string | null) =>
  flipId ? String(flipId) : uid.slice(0, 8) + "-leg-" + startMs.toString(36);
const visKeyOf = (uid: string, kind: string, id: string | null, arrMs: number) =>
  uid.slice(0, 8) + "-vis-" + kind + "-" + (id != null ? String(id) : "x") + "-" + arrMs.toString(36);

// Central-time calendar day, the app's day convention everywhere (_ctDateStr).
function ctDate(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date(ms));
}

function distFt(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 20902231; // earth radius in feet
  const dLat = (bLat - aLat) * Math.PI / 180, dLon = (bLon - aLon) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

// The same floors the live engine applies (js/geo-track.js).
const MIN_ROW_MINUTES = 2;        // mins<2 = pass-through, never a row
const BOUNCE_FT = 400;            // same-spot leg = fence jitter, not a drive
const MAX_LEG_HOURS = 8;          // a "leg" this long is a dead-app gap: leave
                                  //   it for the client's gap machinery, which
                                  //   has rules this function refuses to fake
const MAX_SHOP_HOURS = 10;        // an overnight "shop dwell" is a parked phone,
                                  //   and the home-office active-minutes rule
                                  //   (client-side) can't be applied here
const EST_ROUTE_FACTOR = 1.3;     // straight-line -> provisional road miles;
                                  //   the client refine replaces this with the
                                  //   real routed distance

// ── The tape sets the clock, the fence only says a departure happened ───────
// A geofence cannot fire until a line several hundred feet away is crossed,
// and driving starts at the parking space. On 2026-08-31 the owner's exit
// fired 522 m from his own driveway while the motion edge that preceded it
// sat 6 m from his front door, nine seconds earlier.
//
// That gap is not just accuracy, it is the DUPLICATE. legKey is base36 of the
// leg start, so the phone (which opens at the motion edge) and this function
// (which opened at the raw regionExit) minted different keys for one drive and
// both rows landed. The overlap guard below was the previous attempt at this
// and it is a race: it asks whether the other writer got there first, which on
// a backgrounded phone is a coin flip on drain timing. Same clock on both
// sides, same key, and the second writer is a no-op the way the header claims.
const DRIVE_PENDING_MAX_MS = 15 * 60 * 1000;   // js/geo-track.js _GEO_DRIVE_PENDING_MAX_MS
const AUTO_KINDS = new Set(["automotive", "driving", "cycling"]);
const REST_KINDS = new Set(["walking", "running", "onFoot", "still"]);

type Ev = { type: string; ts: number; lat?: number; lng?: number; regionId?: string; arrivalTs?: number; kind?: string; flipId?: string;
  // The radio ledger (20260915_geo_radio_ledger): a session change and why.
  session?: string; on?: boolean; accuracy?: string; reason?: string; trigger?: string; source?: string };
type RadioDetail = { on: boolean; accuracy: string | null; reason: string; trigger: string; source: string };
// ── HOW A FLIP REACHED US, KEPT (owner 2026-09-23) ─────────────────────────
// "I want to see on time shit within 10 seconds 100% of the time."
//
// A motion row's lateness has two halves that need different fixes: the phone
// not KNOWING yet (CoreMotion had not handed it over) and the phone knowing and
// not SENDING. The plugin has always said which: `deliveredAtMs` is when the
// live stream handed the flip over, and `hist` marks one the backfill
// recovered. Both were dropped here, so every late flip looked the same. Kept
// now, bounded, and nothing reads them but the measurement.
// Why an app closed, and how much memory it held (TdGeoPlugin.appTerminate,
// memoryWarning). A swipe and iOS reclaiming the app look identical without
// these three numbers, and they call for different fixes.
function lifecycleDetail(e: any): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  if (typeof e.state === "string" && e.state) out.state = e.state.slice(0, 12);
  if (typeof e.bgSec === "number" && isFinite(e.bgSec) && e.bgSec >= 0) out.bgSec = Math.round(e.bgSec);
  if (typeof e.mb === "number" && isFinite(e.mb) && e.mb >= 0) out.mb = Math.round(e.mb);
  return Object.keys(out).length ? out : null;
}

// A stretch the phone was asleep (TdGeoPlugin.motionPollTick): when it went
// quiet, how long, and whether iOS ended the app rather than pausing it.
function sleepDetail(e: any): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  if (typeof e.fromMs === "number" && isFinite(e.fromMs) && e.fromMs > 0) out.fromMs = Math.round(e.fromMs);
  if (typeof e.gapSec === "number" && isFinite(e.gapSec) && e.gapSec >= 0) out.gapSec = Math.round(e.gapSec);
  if (e.relaunched === true) out.relaunched = true;
  return Object.keys(out).length ? out : null;
}

// ── HOW THE PHONE IS DOING (owner 2026-10-01) ────────────────────────────
// TdGeoPlugin.deviceStats rides on the push-ping and the heartbeat: Low Power
// Mode, Background App Refresh, iOS's heat word, battery, charging, and this
// app's own CPU and memory. Kept field by field, typed and bounded, like every
// other detail here; anything else on the event is dropped.
const THERMAL = new Set(["nominal", "fair", "serious", "critical", "unknown"]);
const BGR = new Set(["on", "off", "restricted", "unknown"]);
function statsDetail(e: any): Record<string, unknown> | null {
  const s = e && typeof e.stats === "object" && e.stats ? e.stats : null;
  if (!s) return null;
  const out: Record<string, unknown> = {};
  if (typeof s.lp === "boolean") out.lp = s.lp;
  if (typeof s.bgr === "string" && BGR.has(s.bgr)) out.bgr = s.bgr;
  if (typeof s.th === "string" && THERMAL.has(s.th)) out.th = s.th;
  if (typeof s.batt === "number" && isFinite(s.batt) && s.batt >= 0 && s.batt <= 100) out.batt = Math.round(s.batt);
  if (typeof s.chg === "boolean") out.chg = s.chg;
  if (typeof s.cpu === "number" && isFinite(s.cpu) && s.cpu >= 0 && s.cpu < 10000) out.cpu = Math.round(s.cpu * 10) / 10;
  if (typeof s.mem === "number" && isFinite(s.mem) && s.mem > 0 && s.mem < 100000) out.mem = Math.round(s.mem * 10) / 10;
  // Everything else iOS lets an app read (owner 2026-10-01, "allllll the
  // data I can pull from Apple that they allow"): on the charger and full,
  // on screen or not, locked or not, the location permission as it stands,
  // the network and radio it is on, and how long the app has been alive.
  if (s.full === true) out.full = true;
  if (typeof s.app === "string" && APP_STATE.has(s.app)) out.app = s.app;
  if (typeof s.locked === "boolean") out.locked = s.locked;
  if (typeof s.loc === "string" && LOC_AUTH.has(s.loc)) out.loc = s.loc;
  if (s.acc === "full" || s.acc === "reduced") out.acc = s.acc;
  if (typeof s.net === "string" && NET.has(s.net)) out.net = s.net;
  if (typeof s.exp === "boolean") out.exp = s.exp;
  if (typeof s.lowData === "boolean") out.lowData = s.lowData;
  if (typeof s.radio === "string" && RADIO.has(s.radio)) out.radio = s.radio;
  if (typeof s.up === "number" && isFinite(s.up) && s.up >= 0 && s.up < 525600) out.up = Math.round(s.up);
  return Object.keys(out).length ? out : null;
}
const APP_STATE = new Set(["active", "inactive", "background", "unknown"]);
const LOC_AUTH = new Set(["always", "whenInUse", "denied", "restricted", "notDetermined", "unknown"]);
const NET = new Set(["none", "wifi", "cell", "wired", "other"]);
const RADIO = new Set(["5g", "lte", "3g", "2g"]);

// ── APPLE'S OWN DAILY REPORT ON THE APP (MetricKit, owner 2026-10-01) ─────
// TdGeoPlugin copies what iOS measured for the app over about a day: CPU,
// GPS time at each accuracy, foreground and background time, data sent,
// memory peak, signal bars, and how many times iOS ended the app and why.
// Only these names, only finite non-negative numbers; anything else is
// dropped. "from" is the start of Apple's window, the row's ts its end.
const MX_KEYS = new Set([
  "cpu_s", "gpu_s", "fg_s", "bg_s", "bg_loc_s", "bg_audio_s",
  "loc_nav_s", "loc_best_s", "loc_10m_s", "loc_100m_s", "loc_1km_s", "loc_3km_s",
  "wifi_up_b", "wifi_down_b", "cell_up_b", "cell_down_b", "mem_peak_b", "disk_write_b", "apl", "bars",
  "bgx_normal", "bgx_mem_limit", "bgx_cpu_limit", "bgx_mem_pressure", "bgx_bad_access", "bgx_abnormal",
  "bgx_illegal", "bgx_watchdog", "bgx_locked_file", "bgx_task_timeout",
  "fgx_normal", "fgx_mem_limit", "fgx_bad_access", "fgx_abnormal", "fgx_illegal", "fgx_watchdog",
]);
function metricDetail(e: any): Record<string, unknown> | null {
  const mx = e && typeof e.mx === "object" && e.mx ? e.mx : null;
  if (!mx) return null;
  const out: Record<string, number> = {};
  for (const k of Object.keys(mx)) {
    const v = mx[k];
    if (MX_KEYS.has(k) && typeof v === "number" && isFinite(v) && v >= 0 && v < 1e13) out[k] = Math.round(v * 10) / 10;
  }
  if (!Object.keys(out).length) return null;
  const from = typeof e.from === "number" && isFinite(e.from) && e.from > 0 && e.from < e.ts ? Math.round(e.from) : null;
  return { from, mx: out };
}
// Crashes, hangs and resource exceptions Apple recorded, with the first
// crash's own reason.
function diagDetail(e: any): Record<string, unknown> | null {
  const n = (v: unknown) => (typeof v === "number" && isFinite(v) && v >= 0 && v < 100000) ? Math.round(v) : 0;
  const out: Record<string, unknown> = {
    crashes: n(e.crashes), hangs: n(e.hangs), cpuEx: n(e.cpuEx), diskEx: n(e.diskEx),
  };
  if (!(out.crashes as number) && !(out.hangs as number) && !(out.cpuEx as number) && !(out.diskEx as number)) return null;
  if (typeof e.why === "string" && e.why) out.why = e.why.slice(0, 120);
  if (typeof e.from === "number" && isFinite(e.from) && e.from > 0 && e.from < e.ts) out.from = Math.round(e.from);
  return out;
}
// The wake reloaded a stale web app (TdGeoPlugin.checkForUpdate).
function reloadDetail(e: any): Record<string, unknown> | null {
  const v = (x: unknown) => (typeof x === "string" && x.length > 0 && x.length <= 20) ? x : null;
  const from = v(e.from), to = v(e.to);
  return (from || to) ? { from, to } : null;
}

function motionDetail(e: any): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  if (e.hist === true) out.hist = true;
  if (typeof e.deliveredAtMs === "number" && isFinite(e.deliveredAtMs) && e.deliveredAtMs > 0) {
    out.deliveredAtMs = Math.round(e.deliveredAtMs);
  }
  if (typeof e.prevKind === "string" && e.prevKind) out.prevKind = e.prevKind.slice(0, 16);
  if (typeof e.seq === "number" && isFinite(e.seq) && e.seq > 0) out.seq = Math.round(e.seq);
  return Object.keys(out).length ? out : null;
}

// One radio row's detail, bounded. A session name doubles as the row's
// region_id so the dedupe index (employee, type, ts, region_id) tells two
// sessions changing in the same millisecond apart, and so a reader can
// filter on it without opening the json.
function radioDetail(e: Ev): RadioDetail {
  const s = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");
  return {
    on: e.on === true,
    accuracy: typeof e.accuracy === "string" ? e.accuracy.slice(0, 24) : null,
    reason: s(e.reason, 60),
    trigger: s(e.trigger, 24),
    source: e.source === "js" ? "js" : "native",
  };
}
type Dwell = { regionId: string; arrivedTs: number; lat: number; lon: number };
type Leg = { startTs: number; lat: number; lon: number; regionId: string; flipId?: string | null };
// A foot -> automotive edge, held until a fence exit confirms a departure
// actually happened. Never written on its own: a phone in a pocket reads
// automotive from a ride in somebody else's truck.
type PendingDrive = { ts: number; lat: number; lon: number; flipId?: string | null };

function isWorkRegion(rid: string): boolean {
  return rid === "shop" || rid.startsWith("job-") || rid.startsWith("place-") || rid.startsWith("client-");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (v: unknown): string | null =>
  (typeof v === "string" && UUID_RE.test(v.trim())) ? v.trim().toLowerCase() : null;

type GeoRow = {
  type: string; ts: string; lat: number | null; lon: number | null; region_id: string;
  kind: string | null; flip_id: string | null; arrival_ts: string | null; detail: unknown;
};
type Began =
  | { ok: true; uid: string; cid: string; empName: string | null; state: unknown; stateUpdatedAt: string | null }
  | { ok: false; status: number; error: string };

// ── ONE TRIP PER UPLOAD (2026-09-28) ────────────────────────────────────────
// Key check, crew link, store the events, read the device state: one call to
// geo_ingest_begin (migration 20261055) instead of four in a row. Phones
// uploaded 14,212 times on 2026-09-27. Until the migration is live the same
// four steps run the old way, one after another, with the same results.
async function beginIngest(
  svc: any, svcAuth: any, uid: string, deviceId: string, key: string | null, rows: GeoRow[],
  wantCid: string | null,
): Promise<Began> {
  const { data, error } = await svc.rpc("geo_ingest_begin",
    { p_uid: uid, p_device: deviceId, p_key: key, p_rows: rows, p_cid: wantCid });
  if (!error && data) {
    if (!data.ok) return { ok: false, status: 401, error: "no valid auth" };
    return { ok: true, uid, cid: String(data.cid || uid), empName: data.emp_name || null,
      state: data.state ?? null, stateUpdatedAt: data.state_updated_at ? String(data.state_updated_at) : null };
  }
  const missing = !!error && (error.code === "PGRST202" || /could not find the function/i.test(String(error.message || "")));
  if (error && !missing) return { ok: false, status: 500, error: "geo_events: " + error.message };
  if (key) {
    const { data: k } = await svcAuth.from("geo_flush_keys")
      .select("user_id,key").eq("user_id", uid).eq("device_id", deviceId).maybeSingle();
    if (!(k && k.key && k.key === key)) return { ok: false, status: 401, error: "no valid auth" };
    uid = k.user_id;
  }
  // The same rule as geo_ingest_begin: the business the phone names, if it
  // is the poster's own or one they hold an active crew link to.
  let cid = uid;
  let empName: string | null = null;
  if (wantCid && wantCid !== uid) {
    const { data: tm } = await svc.from("team_members")
      .select("name").eq("employee_user_id", uid).eq("contractor_user_id", wantCid).eq("active", true)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (tm) { cid = wantCid; empName = tm.name || null; }
  }
  if (rows.length) {
    const { error: insErr } = await svc.from("geo_events").upsert(
      rows.map((r) => ({ contractor_user_id: cid, employee_user_id: uid, device_id: deviceId, ...r })),
      { onConflict: "employee_user_id,type,ts,region_id", ignoreDuplicates: true },
    );
    if (insErr) return { ok: false, status: 500, error: "geo_events: " + insErr.message };
  }
  const { data: stRow } = await svc.from("geo_device_state")
    .select("state,updated_at").eq("employee_user_id", uid).eq("device_id", deviceId).maybeSingle();
  return { ok: true, uid, cid, empName, state: stRow?.state ?? null,
    stateUpdatedAt: stRow?.updated_at ? String(stRow.updated_at) : null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const deviceId = String(body.device_id || "").slice(0, 80);

    // Two callers, two credentials. A signed-in JS client sends its JWT. The
    // NATIVE layer cannot hold a session (refreshing the JWT from Swift would
    // rotate the refresh token out from under the JS client and sign the user
    // out), so it sends the per-device flush key JS minted for it instead
    // (geo_flush_keys, owner-only RLS). The key authorizes exactly one thing:
    // posting this device's location events for this user.
    let uid: string | null = null;
    const auth = req.headers.get("Authorization") || "";
    const svcAuth = createClient(SUPABASE_URL, SERVICE_KEY);
    if (auth) {
      const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
      const { data: { user } } = await userClient.auth.getUser();
      if (user) uid = user.id;
    }
    // The flush key is checked inside geo_ingest_begin, in the same trip that
    // stores the events (migration 20261055).
    const keyUid = (!uid && body.user_id && body.key && deviceId) ? String(body.user_id) : null;
    const flushKey = keyUid ? String(body.key) : null;
    // WHICH HAT (§9.10). The phone names the business it is working for: the
    // native flush in the URL it was configured with, the JS poster in its
    // body. geo_ingest_begin decides whether it is allowed.
    const wantCid = uuidOrNull(new URL(req.url).searchParams.get("cid")) || uuidOrNull(body.cid);
    if (!uid && !keyUid) return json({ ok: false, error: "no valid auth" }, 401);
    const rawEvents = Array.isArray(body.events) ? (body.events as Ev[]).slice(0, 400) : [];
    const svc = createClient(SUPABASE_URL, SERVICE_KEY);
    if (!rawEvents.length) {
      if (keyUid) {
        const b = await beginIngest(svc, svcAuth, keyUid, deviceId, flushKey, [], wantCid);
        if (!b.ok) return json({ ok: false, error: b.error }, b.status);
      }
      return json({ ok: true, stored: 0, derived: 0 });
    }

    // Normalize, sort by capture time, and store the raw stream. The unique
    // index makes re-flushed buffers free no-ops.
    const evs = rawEvents
      .filter((e) => e && typeof e.ts === "number" && e.ts > 0 && typeof e.type === "string")
      .map((e) => ({
        type: String(e.type).slice(0, 20),
        ts: Math.round(e.ts),
        lat: typeof e.lat === "number" ? e.lat : null,
        lng: typeof e.lng === "number" ? e.lng : null,
        // A radio row's "region" is its session name (see radioDetail).
        regionId: e.type === "radio"
          ? String(e.session || "").slice(0, 60)
          : String(e.regionId || "").slice(0, 60),
        arrivalTs: typeof e.arrivalTs === "number" ? Math.round(e.arrivalTs) : null,
        // A PUSH-PING'S AGE IS THE ONLY THING THAT MAKES IT READABLE, and this
        // line threw it away (owner 2026-09-18, on Jack's day). silentPush
        // (TdGeoPlugin.swift) measures the cached location against the
        // CLLocation's OWN timestamp and puts staleMs on the row when it is
        // over five minutes old, plus blind when it had to buy a burst. Both
        // died here: every type but radio got a null detail, so 1,060
        // push-pings over ten days reached the server with no age at all and
        // the deriver had no way to tell a five-second position from a
        // five-hour one. It refused all of them, which is why a parked day
        // has no positions in it even though the phone reported one every
        // thirty minutes.
        // ── AND NOT ONLY A PUSH-PING (owner 2026-09-19) ─────────────────
        // This was scoped to push-ping because it was the only event that
        // measured its own age. Every positioned event does now
        // (TdGeoPlugin.event), so every one of them gets to keep it: a `fix`
        // built from a significant-change wake's last-known position is the
        // same stale coordinate wearing a type the deriver trusts.
        detail: e.type === "radio"
          ? radioDetail(e)
          : e.type === "motion"
          ? motionDetail(e)
          : e.type === "app-terminate" || e.type === "memory-warning"
          ? lifecycleDetail(e)
          : e.type === "asleep"
          ? sleepDetail(e)
          : e.type === "native-reload"
          ? reloadDetail(e)
          : e.type === "metrickit"
          ? metricDetail(e)
          : e.type === "mx-diag"
          ? diagDetail(e)
          : (typeof e.staleMs === "number" || e.blind === true || statsDetail(e)
            ? {
              ...(typeof e.staleMs === "number" ? { staleMs: Math.round(e.staleMs) } : {}),
              ...(e.blind === true ? { blind: true } : {}),
              ...(statsDetail(e) ? { stats: statsDetail(e) } : {}),
            }
            : null),
        // What the coprocessor actually said: onFoot / still / driving. The
        // native plugin has always sent it and this function has always
        // dropped it, so the server could see that a transition happened and
        // never what it was.
        kind: typeof e.kind === "string" ? e.kind.slice(0, 16) : null,
        // The flip's own id, carried through untouched.
        flipId: typeof e.flipId === "string" ? e.flipId.slice(0, 40) : null,
      }))
      .sort((a, b) => a.ts - b.ts);
    const rows: GeoRow[] = evs.map((e) => ({
      type: e.type, ts: new Date(e.ts).toISOString(),
      lat: e.lat, lon: e.lng, region_id: e.regionId, kind: e.kind,
      // Stored, not just used. The state machine below has always had this
      // in memory; putting it on the row is what lets one departure be
      // followed from the flip to the two rows it produced, instead of
      // being reasoned about backwards from whichever one came out wrong
      // (owner 2026-08-31, and the 20260904 migration says the rest).
      flip_id: e.flipId,
      arrival_ts: e.arrivalTs ? new Date(e.arrivalTs).toISOString() : null,
      // The radio ledger's payload; null on every other row.
      detail: e.detail,
    }));
    if (!evs.length) {
      if (keyUid) {
        const b = await beginIngest(svc, svcAuth, keyUid, deviceId, flushKey, [], wantCid);
        if (!b.ok) return json({ ok: false, error: b.error }, b.status);
      }
      return json({ ok: true, stored: 0, derived: 0 });
    }

    // One trip: key check, crew link, store, and the device state the state
    // machine below starts from.
    const began = await beginIngest(svc, svcAuth, (uid || keyUid) as string, deviceId, flushKey, rows, wantCid);
    if (!began.ok) return json({ ok: false, error: began.error }, began.status);
    uid = began.uid;
    const cid = began.cid;
    const empName = began.empName;

    // ── The state machine, under an optimistic lock ─────────────────────────
    // geo_device_state was read, computed on, and written back blind. Two
    // flushes landing at once therefore raced, and the LAST write won,
    // silently discarding whatever the other one had just derived.
    //
    // Observed live, owner's phone, 2026-08-31 17:07 CT, and the flip id is
    // what made it visible rather than something to infer backwards from a
    // wrong row. He walked out of a customer's fence and drove off. The
    // plugin minted two flips and flushed them 4 ms apart:
    //   17:04:34.962  walking     fAFE25EE54F55427E   (rest: CLEARS pending)
    //   17:07:30.401  automotive  fA51E4D6352D24E1F   (the departure: SETS it)
    // Both invocations read the same prior state; the walking one wrote last;
    // the departure was erased. The server then held pending: null, so the
    // fence exit that follows would have opened that drive at the exit
    // instant with a null flip id, losing both the tape clock and the id.
    //
    // Fixed by compare-and-swap on updated_at rather than a lock or a
    // serializing RPC: the value is already on the row, so this needs no
    // migration and no new column, and a loser simply re-derives against the
    // winner's state and swaps again.
    //
    // A retry is safe and, more importantly, ORDER-INDEPENDENT, which is the
    // property that actually fixes the incident above:
    //   - Every derived write is already check-then-insert or
    //     ignoreDuplicates (see insertByKey and the td_mileage guard), so
    //     re-running a pass writes nothing twice.
    //   - The lastTs cursor makes the re-run skip events the winner already
    //     consumed. Replaying the incident: if the WALKING pass wins first,
    //     the departure pass re-reads, still sees its own newer event, and
    //     sets pending. If the DEPARTURE pass wins first, the walking pass
    //     re-reads and its event (three minutes older) now falls under the
    //     cursor and is skipped, so it can no longer clear the mark it never
    //     should have outranked. Both orders end with the departure held.
    //
    // Rows still go in BEFORE the cursor moves, exactly as before, so a crash
    // mid-pass re-derives instead of losing rows.
    const STATE_CAS_TRIES = 4;
    let derived = 0;
    let casWon = false;
    for (let attempt = 0; attempt < STATE_CAS_TRIES && !casWon; attempt++) {
      // ── The state machine ───────────────────────────────────────────────────
      // The first pass starts from the state geo_ingest_begin already read; a
      // pass that lost the swap re-reads the winner's.
      let stRow: { state: unknown; updated_at: unknown } | null;
      if (attempt === 0) {
        stRow = began.stateUpdatedAt ? { state: began.state, updated_at: began.stateUpdatedAt } : null;
      } else {
        const { data } = await svc.from("geo_device_state")
          .select("state,updated_at").eq("employee_user_id", uid).eq("device_id", deviceId).maybeSingle();
        stRow = data;
      }
      // The compare half of the compare-and-swap below. null means "no row
      // yet", which takes the insert path rather than an update that would
      // match nothing and look like a lost race forever.
      const prevUpdatedAt = (stRow && stRow.updated_at) ? String(stRow.updated_at) : null;
      const st = (stRow?.state || {}) as
        { dwell?: Dwell | null; leg?: Leg | null; lastTs?: number; pending?: PendingDrive | null };
      let dwell: Dwell | null = st.dwell || null;
      let leg: Leg | null = st.leg || null;
      // Carried across POSTs on purpose: the coprocessor can hand over the
      // automotive edge in one flush and the fence exit in the next.
      let pending: PendingDrive | null = st.pending || null;
      const lastTs = Number(st.lastTs) || 0;

      // Region display names, one batched lookup per referenced table.
      const jobIds = new Set<string>(), placeIds = new Set<string>(), clientIds = new Set<string>();
      for (const e of evs) {
        const rid = e.regionId;
        if (rid.startsWith("job-")) jobIds.add(rid.slice(4));
        else if (rid.startsWith("place-")) placeIds.add(rid.slice(6));
        else if (rid.startsWith("client-")) clientIds.add(rid.slice(7));
      }
      const names: Record<string, string> = {};
      // WHOSE FENCE IS THIS. Tracked separately from the name, because a
      // record with an empty name is still this account's and must not be
      // mistaken for another business's. See isOwnRegion below.
      const owned = new Set<string>();
      const nameFetch = async (tbl: string, ids: Set<string>, prefix: string, pick: (d: any) => string) => {
        if (!ids.size) return;
        const { data } = await svc.from(tbl).select("id,data").eq("user_id", cid).in("id", [...ids]);
        (data || []).forEach((r) => {
          owned.add(prefix + r.id);
          const n = pick(r.data || {}); if (n) names[prefix + r.id] = String(n);
        });
      };
      await Promise.all([
        nameFetch("td_jobs", jobIds, "job-", (d) => d.name || d.addr),
        nameFetch("td_places", placeIds, "place-", (d) => d.name),
        nameFetch("td_clients", clientIds, "client-", (d) => d.name),
      ]);
      const regionName = (rid: string) =>
        rid === "shop" ? "Shop" : (names[rid] || (rid === "fence" ? "Stop" : "Stop"));

      // A FENCE FROM ANOTHER BUSINESS IS NOT A PLACE THIS ONE HAS BEEN.
      //
      // Owner 2026-09-10, signed into his second business: "it says I'm at
      // Tradedesk shop under sample co, should it or is that another bug?"
      // It is a bug. His Sample Co device state held an open dwell on
      // place-1787436272279016, which is a place record belonging to
      // TradeDesk, his OTHER account, four metres from its shop.
      //
      // One phone arms the geofences of whichever account is loaded, and
      // nothing disarms them when he switches. So the coprocessor went on
      // reporting TradeDesk's regions while Sample Co was signed in, and this
      // function opened a dwell on an id Sample Co has never owned.
      //
      // The names were never leaked, because nameFetch is already scoped by
      // user_id, which is why his rows came out unnamed rather than saying
      // "TradeDesk shop". But an unnamed dwell on a foreign fence is still
      // this business being told it was somewhere it has no record of.
      //
      // A record-scoped id (job-, place-, client-) must resolve under THIS
      // account or it is not ours to stand in. `shop` and `fence` carry no
      // record to check, so they pass here and are covered on the device
      // side instead (js/geo-track.js re-arms on a hat switch).
      const isOwnRegion = (rid: string) =>
        (rid === "shop" || rid === "fence") ? true : owned.has(rid);

      const timeRows: any[] = [];   // job_time_entries upserts
      const shopRows: any[] = [];   // shop_time_entries upserts
      const mileRows: any[] = [];   // td_mileage inserts (legKey-guarded)

      const closeLeg = (endTs: number, endLat: number, endLon: number, endRegion: string) => {
        if (!leg) return;
        const L = leg; leg = null;
        const mins = Math.round((endTs - L.startTs) / 60000);
        if (mins < MIN_ROW_MINUTES) return;
        if (mins > MAX_LEG_HOURS * 60) return;                       // dead-app gap: client's job
        const ft = distFt(L.lat, L.lon, endLat, endLon);
        if (ft < BOUNCE_FT) return;                                  // fence bounce, not a drive
        const key = legKeyOf(uid, L.startTs, L.flipId);
        const startedIso = new Date(L.startTs).toISOString(), endedIso = new Date(endTs).toISOString();
        // Drive TIME row: same client_key (the legKey) the live engine mints, so
        // the unique index dedupes against a client replay of the same leg.
        // 'drive-unassigned' for crew (no vehicle pick is knowable here: the
        // "no pick, no money claim" rule); the owner's own miles always count.
        timeRows.push({
          contractor_user_id: cid, employee_user_id: uid, job_id: null,
          arrived_at: startedIso, departed_at: endedIso, minutes: mins,
          dest_place: regionName(endRegion), client_key: key,
          source: uid === cid ? "drive" : "drive-unassigned",
        });
        const straightMi = ft / 5280;
        const est = Math.max(0.1, Math.round(straightMi * EST_ROUTE_FACTOR * 10) / 10);
        mileRows.push({
          id: "srv-" + key,
          row: {
            id: "srv-" + key, legKey: key, gps: true, provisional: true,
            calc_method: "server_est", miles: est, gpsMiles: 0,
            date: ctDate(L.startTs), startedIso, endedIso, mins,
            from_name: regionName(L.regionId), from: regionName(L.regionId),
            to_name: regionName(endRegion), to: regionName(endRegion),
            fromCoord: { lat: L.lat, lng: L.lon }, toCoord: { lat: endLat, lng: endLon },
            purpose: "Business", loggedAt: new Date().toISOString(),
            ...(uid === cid ? {} : { vehicleUnknown: true, logged_by_id: uid, logged_by_name: empName || "Crew" }),
          },
        });
      };

      const closeDwell = (endTs: number) => {
        if (!dwell) return;
        const D = dwell; dwell = null;
        const mins = Math.round((endTs - D.arrivedTs) / 60000);
        if (mins < MIN_ROW_MINUTES) return;
        const arrIso = new Date(D.arrivedTs).toISOString(), depIso = new Date(endTs).toISOString();
        if (D.regionId === "shop") {
          // The home-office "bill only active minutes" rule lives client-side
          // and cannot be applied here, so an overnight-length shop dwell is
          // left entirely to the client engine rather than risk inflating pay.
          if (mins > MAX_SHOP_HOURS * 60) return;
          shopRows.push({
            contractor_user_id: cid, employee_user_id: uid,
            arrived_at: arrIso, departed_at: depIso, minutes: mins,
            client_key: visKeyOf(uid, "shop", null, D.arrivedTs),
          });
          return;
        }
        if (D.regionId.startsWith("job-")) {
          const jid = D.regionId.slice(4);
          timeRows.push({
            contractor_user_id: cid, employee_user_id: uid, job_id: jid,
            arrived_at: arrIso, departed_at: depIso, minutes: mins,
            client_key: visKeyOf(uid, "job", jid, D.arrivedTs), source: "geofence",
          });
          return;
        }
        const kind = D.regionId.startsWith("place-") ? "place" : "client";
        const id = D.regionId.slice(kind.length + 1);
        timeRows.push({
          contractor_user_id: cid, employee_user_id: uid, job_id: null,
          arrived_at: arrIso, departed_at: depIso, minutes: mins,
          dest_place: names[D.regionId] || null,
          // Same split the client does (js/geo-track.js _geoCloseClientEntry):
          // a customer's address is on-site work, a saved place is overhead.
          // The server wrote 'place' for both, so a dwell resolved here landed
          // in the supply bucket even when it was somebody's house.
          client_key: visKeyOf(uid, kind, id, D.arrivedTs), source: kind === "client" ? "client" : "place",
        });
      };

      // ── ONE CROSSING, ONE EVENT ─────────────────────────────────────────────
      // iOS fires the same crossing under every id that covers the point: the
      // owner's 07:52:14 exit arrived twice, once as place-1787436272279016 and
      // once as the bare literal 'fence'. The loop took whichever sat first in
      // the array, and regionName maps 'fence' to the string "Stop", which is
      // the entire origin of every `Stop -> somewhere` row on his account.
      //
      // Dropped for the STATE MACHINE only. The raw insert above keeps every
      // event, and newLastTs still advances off the unfiltered array, so the
      // cursor cannot skip past something this filter hid.
      //
      // A WINDOW, NOT AN EQUALITY. The first cut of this keyed on the exact ts
      // and would never have fired once: the owner's two exits are 1788180734412
      // and 1788180734415, THREE MILLISECONDS apart, because iOS delivers them
      // as separate callbacks. Caught by replaying his real 08-31 tape before
      // this shipped. Two genuinely different crossings inside two seconds do not
      // happen, and if they did, preferring the named one is still correct.
      const TWIN_MS = 2000;
      const namedCrossing = evs
        .filter((e) => (e.type === "regionExit" || e.type === "regionEnter") &&
                       e.regionId && e.regionId !== "fence")
        .map((e) => ({ type: e.type, ts: e.ts }));
      const hasNamedTwin = (e: { type: string; ts: number }) =>
        namedCrossing.some((n) => n.type === e.type && Math.abs(n.ts - e.ts) <= TWIN_MS);
      const walk = evs.filter((e) =>
        !((e.type === "regionExit" || e.type === "regionEnter") &&
          e.regionId === "fence" && hasNamedTwin(e)));

      const nowMs = Date.now();
      for (const e of walk) {
        if (e.ts <= lastTs) continue;                                // already processed
        if (e.lat == null || e.lng == null) continue;
        if (e.type === "motion") {
          // The tape's own marks. An automotive edge is HELD; coming to rest
          // cancels it, because whatever that edge was about, it is not the
          // departure a fence exit ten minutes from now would describe.
          const k = String(e.kind || "");
          if (AUTO_KINDS.has(k)) {
            // Never forward: a future-stamped event on a replayed buffer must
            // not backdate a leg into next week.
            if (e.ts <= nowMs) pending = { ts: e.ts, lat: e.lat, lon: e.lng, flipId: e.flipId };
          } else if (REST_KINDS.has(k)) {
            pending = null;
          }
          continue;
        }
        if (e.type === "regionEnter") {
          closeLeg(e.ts, e.lat, e.lng, e.regionId);
          if (isWorkRegion(e.regionId) && isOwnRegion(e.regionId) && (!dwell || dwell.regionId !== e.regionId)) {
            if (dwell) closeDwell(e.ts);                             // overlapping fences: old one ends here
            dwell = { regionId: e.regionId, arrivedTs: e.ts, lat: e.lat, lon: e.lng };
          }
        } else if (e.type === "regionExit") {
          if (dwell && dwell.regionId === e.regionId) closeDwell(e.ts);
          if (!leg) {
            // Spend the held edge if it is earlier than the exit and recent
            // enough to still describe it. Byte-for-byte the rule the client
            // applies at its own drive-open site, so both mint the same key.
            const p = pending;
            const useTape = !!p && p.ts < e.ts && (e.ts - p.ts) <= DRIVE_PENDING_MAX_MS;
            // Only a SPENT mark names the leg, the same rule the client holds:
            // a mark refused for being stale takes its id with it.
            leg = (useTape && p)
              ? { startTs: p.ts, lat: p.lat, lon: p.lon, regionId: e.regionId, flipId: p.flipId }
              : { startTs: e.ts, lat: e.lat, lon: e.lng, regionId: e.regionId, flipId: null };
            pending = null;
          }
        }
        // 'fix' and 'visit' events are stored raw for the client's engine; this
        // state machine deliberately does not interpret them (§7.3).
      }
      const newLastTs = Math.max(lastTs, evs[evs.length - 1].ts);

      // ── Write the derived rows ──────────────────────────────────────────────
      derived = 0;
      // NOT an upsert. The idempotency index on (contractor_user_id, client_key)
      // is PARTIAL (where client_key is not null, 20260719 migration), and
      // Postgres cannot use a partial index as an ON CONFLICT target, so the
      // upsert form errors and drops the whole batch: the exact failure the
      // client's drain queue already works around with its own fallback chain
      // (js/geo-track.js). Caught live by the geo-ingest flow test: the mileage
      // row landed, the dwell silently did not. Check-then-insert instead; the
      // narrow race between check and insert still lands on the unique index,
      // where a duplicate error IS the dedupe working, absorbed row by row.
      // ── NO ROWS FROM HERE (owner 2026-09-02, CLAUDE.md 17) ─────────────
      // This function used to write job_time_entries, shop_time_entries and
      // td_mileage rows of its own from the fence events it stores: the third
      // writer for one event, and the one that survived the client-side
      // cleanup because it lives on the server. His 12:04 fence exit produced
      // a 247-minute client row on top of the deriver's, and every one of
      // yesterday's drives was written twice before that. The day deriver on
      // the phone (js/geo-derive.js) through geo_replace_day is the one
      // writer. The state machine above still runs for what it is still good
      // for: the device state the push-ping and the live card read.
      void timeRows; void shopRows; void mileRows;

      // Persist the cursor last, so a crash before this point re-derives (all
      // writes above are idempotent) instead of losing rows. CONDITIONAL: the
      // row must still carry the updated_at this pass read, or another
      // invocation has moved it and this pass is working from stale state.
      const nextUpdatedAt = new Date().toISOString();
      const nextState = { dwell, leg, pending, lastTs: newLastTs };
      if (prevUpdatedAt) {
        const { data: swapped } = await svc.from("geo_device_state")
          .update({ state: nextState, contractor_user_id: cid, updated_at: nextUpdatedAt })
          .eq("employee_user_id", uid).eq("device_id", deviceId)
          .eq("updated_at", prevUpdatedAt)
          .select("employee_user_id");
        casWon = !!(swapped && swapped.length);
      } else {
        // No row yet. A plain insert IS the compare-and-swap here: whoever
        // gets there second violates the primary key and retries, this time
        // down the update path above.
        const { error: insStErr } = await svc.from("geo_device_state").insert({
          employee_user_id: uid, device_id: deviceId, contractor_user_id: cid,
          state: nextState, updated_at: nextUpdatedAt,
        });
        casWon = !insStErr;
      }
    }
    // Four straight losses is not something a two-writer race produces (each
    // retry reads the winner's state, so the second pass normally wins). If
    // it somehow happens, the derived rows are already written and the cursor
    // simply has not moved: the next flush re-derives from where it was, which
    // is the same recovery a crash gets. Reported so it is visible rather
    // than silent, which is the whole failure this section is about.
    if (!casWon) console.error("geo_device_state: cursor contended, cursor not advanced", { uid, deviceId });

    // ── THE DERIVER RUNS HERE, ON THE EVENTS THAT JUST LANDED ─────────────
    // After the raw insert, so this batch is part of what it reads, and after
    // the cursor swap, so a slow derive cannot hold the state machine open.
    // Bounded to the days the batch actually touches (daysToDerive), and a day
    // that throws is reported rather than failing the flush: the events are
    // already stored, the next trigger derives again, and the phone's own
    // rebuild is still behind all of it.
    // One road, one lookup. The resolver and its cache key live in
    // ../_shared/route-cache.ts because rebuild-day needs the identical thing,
    // and two copies of a key is two places for it to drift from the phone's.
    const route = makeRoute(svc, cid);

    const derivedDays = [];
    for (const day of daysToDerive(evs, Date.now())) {
      try { derivedDays.push(await deriveDayServer(svc, cid, uid, day, Date.now(), route)); }
      catch (e) { derivedDays.push({ day, wrote: false, reason: String((e as Error)?.message || e) }); }
    }
    derived = derivedDays.filter((d) => d.wrote).length;
    for (const d of derivedDays) {
      if (!d.wrote && d.reason && d.reason !== "no evidence" && d.reason !== "nothing to add" && d.reason !== "unresolved") {
        console.error("derive-day", { uid, day: d.day, reason: d.reason });
      }
    }

    // ── AND THE LOCK SCREEN LEARNS, WITH THE APP ON ANY SCREEN AT ALL ─────
    // Owner 2026-09-16: "live activities, if I'm in the ops portal it doesn't
    // update live when I go to drive, how can we make live activities
    // bulletproof?"
    //
    // The card used to move only when the phone's own derive ran, and a derive
    // is refused while a support view is open (js/geo-track.js), so the ops
    // portal froze it. This derive just ran on the server and already knows
    // the answer, so it says so. Same fact, same rule (live-card.mjs), no
    // dependence on which screen anybody is looking at, or on the app being
    // open at all.
    //
    // TODAY ONLY, and only when the derive actually reached a verdict. A day
    // that returned before deriving carries no `open` key, and that is "we do
    // not know", which must never be read as "no card": ending a live card
    // because a backfill of last Tuesday told us nothing would be worse than
    // the bug this fixes.
    try {
      const today = centralDayKey(Date.now());
      const d = derivedDays.find((x) => x.day === today && "open" in x);
      if (d) {
        const card = railCardFor({ open: d.open, pending: d.driving }, {});
        const note = await pushLiveCard(svc, uid, card);
        if (note !== "unchanged" && note !== "no live card" && note !== "nothing to end") {
          console.log("[live-push]", { uid, day: today, event: card.event, note });
        }
      }
    } catch (e) { console.error("[live-push] " + String(e).slice(0, 200)); }

    // ── A CLOSE EARNS ONE WAKE (owner 2026-09-28: "do the swipe fix") ─────
    // The phone now sends its close as it dies. If that close is fresh and
    // inside the working day, one silent push brings the app straight back
    // instead of leaving it dark until the half-hour ping or a fence exit.
    // The rules are in _shared/terminate-wake.mjs; this is only the plumbing.
    let woke = 0;
    try {
      if (evs.some((e) => e.type === "app-terminate") && apnsConfigured()) {
        const key = "wake:" + uid;
        // workHours only, never the whole settings blob (egress, 2026-09-28).
        const [cfgRow, { data: wm }] = await Promise.all([
          workSettings(svc, cid),
          svc.from("cron_watermarks").select("ran_at").eq("name", key).maybeSingle(),
        ]);
        const lastWake = wm?.ran_at ? Date.parse(wm.ran_at) : NaN;
        if (terminateWakeDue(evs, Date.now(), workHoursFromSettings(cfgRow), lastWake)) {
          await svc.from("cron_watermarks").upsert({ name: key, ran_at: new Date().toISOString() });
          const { data: toks } = await svc.from("device_tokens")
            .select("token").eq("user_id", uid).is("invalid_at", null);
          // Short expiry: a wake that arrives ten minutes late is no longer
          // the one this close asked for.
          const out = await sendSilentWake(svc, (toks || []).map((t: { token: string }) => t.token), "geo-wake", 300);
          woke = out.sent;
          console.log("[terminate-wake]", { uid, sent: out.sent, pruned: out.pruned });
        }
      }
    } catch (e) { console.error("[terminate-wake] " + String(e).slice(0, 200)); }

    return json({ ok: true, stored: evs.length, derived, days: derivedDays, woke });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
