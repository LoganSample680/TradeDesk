// Supabase Edge Function: ingest-geo
//
// The real-time half of the geofence engine (owner directive 2026-08-27:
// mileage and time logs land in Supabase the moment a fence trips, app
// force-closed or not). The phone's native layer (TdGeoPlugin, build 39+)
// background-POSTs its buffered location events here within seconds of every
// wake. This function stores the raw events (geo_events) and runs a SMALL,
// fence-bounded state machine that writes the derived rows the app already
// reads: job_time_entries, shop_time_entries, td_mileage.
//
// ── The one design rule: this is NOT a second brain ─────────────────────────
// js/geo-track.js remains the authority (§7.3: never hand-roll a parallel
// engine). This function derives only what fence crossings state plainly:
//   regionExit of a work fence  → the dwell row, true arrive/depart
//   regionEnter after an exit   → the leg row + a provisional mileage row
// It ports only the floors that prevent garbage (mins<2, fence-bounce,
// stale-leg) and NOTHING nuanced: no detour collapse, no walking trim, no
// visit backdating, no unfenced stops. Every mileage row it writes is marked
// data.provisional:true, and the client's next real run refines or replaces
// it by legKey (js/mileage.js _mileServerRefine).
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
const legKeyOf = (uid: string, startMs: number) => uid.slice(0, 8) + "-leg-" + startMs.toString(36);
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

type Ev = { type: string; ts: number; lat?: number; lng?: number; regionId?: string; arrivalTs?: number };
type Dwell = { regionId: string; arrivedTs: number; lat: number; lon: number };
type Leg = { startTs: number; lat: number; lon: number; regionId: string };

function isWorkRegion(rid: string): boolean {
  return rid === "shop" || rid.startsWith("job-") || rid.startsWith("place-") || rid.startsWith("client-");
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
    if (!uid && body.user_id && body.key && deviceId) {
      const { data: k } = await svcAuth.from("geo_flush_keys")
        .select("user_id,key").eq("user_id", String(body.user_id)).eq("device_id", deviceId).maybeSingle();
      if (k && k.key && k.key === String(body.key)) uid = k.user_id;
    }
    if (!uid) return json({ ok: false, error: "no valid auth" }, 401);
    const rawEvents = Array.isArray(body.events) ? (body.events as Ev[]).slice(0, 400) : [];
    if (!rawEvents.length) return json({ ok: true, stored: 0, derived: 0 });

    const svc = createClient(SUPABASE_URL, SERVICE_KEY);

    // Whose account do this device's rows belong to: the crew link if one
    // exists, else the poster is the owner. Same resolution as _geoCid().
    let cid = uid;
    let empName: string | null = null;
    {
      const { data: tm } = await svc.from("team_members")
        .select("contractor_user_id,name,status")
        .eq("employee_user_id", uid).limit(5);
      const live = (tm || []).find((r) => r.status !== "removed" && r.contractor_user_id);
      if (live) { cid = live.contractor_user_id; empName = live.name || null; }
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
        regionId: String(e.regionId || "").slice(0, 60),
        arrivalTs: typeof e.arrivalTs === "number" ? Math.round(e.arrivalTs) : null,
      }))
      .sort((a, b) => a.ts - b.ts);
    if (!evs.length) return json({ ok: true, stored: 0, derived: 0 });

    const { error: insErr } = await svc.from("geo_events").upsert(
      evs.map((e) => ({
        contractor_user_id: cid, employee_user_id: uid, device_id: deviceId,
        type: e.type, ts: new Date(e.ts).toISOString(),
        lat: e.lat, lon: e.lng, region_id: e.regionId,
        arrival_ts: e.arrivalTs ? new Date(e.arrivalTs).toISOString() : null,
      })),
      { onConflict: "employee_user_id,type,ts,region_id", ignoreDuplicates: true },
    );
    if (insErr) return json({ ok: false, error: "geo_events: " + insErr.message }, 500);

    // ── The state machine ───────────────────────────────────────────────────
    const { data: stRow } = await svc.from("geo_device_state")
      .select("state").eq("employee_user_id", uid).eq("device_id", deviceId).maybeSingle();
    const st = (stRow?.state || {}) as { dwell?: Dwell | null; leg?: Leg | null; lastTs?: number };
    let dwell: Dwell | null = st.dwell || null;
    let leg: Leg | null = st.leg || null;
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
    const nameFetch = async (tbl: string, ids: Set<string>, prefix: string, pick: (d: any) => string) => {
      if (!ids.size) return;
      const { data } = await svc.from(tbl).select("id,data").eq("user_id", cid).in("id", [...ids]);
      (data || []).forEach((r) => { const n = pick(r.data || {}); if (n) names[prefix + r.id] = String(n); });
    };
    await Promise.all([
      nameFetch("td_jobs", jobIds, "job-", (d) => d.name || d.addr),
      nameFetch("td_places", placeIds, "place-", (d) => d.name),
      nameFetch("td_clients", clientIds, "client-", (d) => d.name),
    ]);
    const regionName = (rid: string) =>
      rid === "shop" ? "Shop" : (names[rid] || (rid === "fence" ? "Stop" : "Stop"));

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
      const key = legKeyOf(uid, L.startTs);
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
        client_key: visKeyOf(uid, kind, id, D.arrivedTs), source: "place",
      });
    };

    for (const e of evs) {
      if (e.ts <= lastTs) continue;                                // already processed
      if (e.lat == null || e.lng == null) continue;
      if (e.type === "regionEnter") {
        closeLeg(e.ts, e.lat, e.lng, e.regionId);
        if (isWorkRegion(e.regionId) && (!dwell || dwell.regionId !== e.regionId)) {
          if (dwell) closeDwell(e.ts);                             // overlapping fences: old one ends here
          dwell = { regionId: e.regionId, arrivedTs: e.ts, lat: e.lat, lon: e.lng };
        }
      } else if (e.type === "regionExit") {
        if (dwell && dwell.regionId === e.regionId) closeDwell(e.ts);
        if (!leg) leg = { startTs: e.ts, lat: e.lat, lon: e.lng, regionId: e.regionId };
      }
      // 'fix' and 'visit' events are stored raw for the client's engine; this
      // state machine deliberately does not interpret them (§7.3).
    }
    const newLastTs = Math.max(lastTs, evs[evs.length - 1].ts);

    // ── Write the derived rows ──────────────────────────────────────────────
    let derived = 0;
    // NOT an upsert. The idempotency index on (contractor_user_id, client_key)
    // is PARTIAL (where client_key is not null, 20260719 migration), and
    // Postgres cannot use a partial index as an ON CONFLICT target, so the
    // upsert form errors and drops the whole batch: the exact failure the
    // client's drain queue already works around with its own fallback chain
    // (js/geo-track.js). Caught live by the geo-ingest flow test: the mileage
    // row landed, the dwell silently did not. Check-then-insert instead; the
    // narrow race between check and insert still lands on the unique index,
    // where a duplicate error IS the dedupe working, absorbed row by row.
    const insertByKey = async (tbl: string, rows: any[]) => {
      if (!rows.length) return 0;
      const { data: have } = await svc.from(tbl).select("client_key")
        .eq("contractor_user_id", cid).in("client_key", rows.map((r) => r.client_key));
      const haveSet = new Set((have || []).map((r) => r.client_key));
      const fresh = rows.filter((r) => !haveSet.has(r.client_key));
      if (!fresh.length) return 0;
      const { error } = await svc.from(tbl).insert(fresh);
      if (!error) return fresh.length;
      let n = 0;
      for (const r of fresh) {
        const { error: e2 } = await svc.from(tbl).insert(r);
        if (!e2) n++;
      }
      return n;
    };
    derived += await insertByKey("job_time_entries", timeRows);
    derived += await insertByKey("shop_time_entries", shopRows);
    if (mileRows.length) {
      // td_mileage has no key column to conflict on (data is a JSON blob), so
      // the guard is an existence check on the legKey inside data. The client
      // side holds the same guard plus the refine sweep, so the narrow race
      // window converges instead of duplicating.
      const { data: existing } = await svc.from("td_mileage")
        .select("id").eq("user_id", cid).is("deleted_at", null)
        .in("id", mileRows.map((m) => m.id));
      const have = new Set((existing || []).map((r) => String(r.id)));
      // ...and the OTHER writer's row for the same drive. The id check above
      // only stops this function duplicating ITSELF; it never looked for the
      // phone's own row, and the legKey the two sides mint cannot match
      // because each dates the departure from its own clock (the phone from
      // the ping where JS noticed, this from the raw regionExit, seconds
      // apart). That is how every drive on 2026-08-27 got written twice.
      //
      // Same rule as the client's _mileSameDrive (js/mileage.js): overlapping
      // time windows AND the same destination. Only the window is queryable
      // here, so this is the coarse half and the client's refine sweep is the
      // fine half; between them a duplicate is dropped whichever side wrote
      // first, and both orders were observed live.
      const spanLo = Math.min(...mileRows.map((m) => Date.parse(m.row.startedIso)));
      const spanHi = Math.max(...mileRows.map((m) => Date.parse(m.row.endedIso)));
      const PAD = 5 * 60000;
      const { data: near } = await svc.from("td_mileage")
        .select("id,data").eq("user_id", cid).is("deleted_at", null)
        .gte("data->>startedIso", new Date(spanLo - PAD).toISOString())
        .lte("data->>startedIso", new Date(spanHi + PAD).toISOString())
        .limit(200);
      const overlaps = (m: any) => (near || []).some((r: any) => {
        const d = r.data || {};
        if (d.provisional) return false;          // another srv row, not the phone's
        const B1 = Date.parse(d.startedIso || ""), B2 = Date.parse(d.endedIso || "");
        const A1 = Date.parse(m.row.startedIso), A2 = Date.parse(m.row.endedIso);
        if (!(B1 && B2 && A1 && A2) || B2 <= B1 || A2 <= A1) return false;
        const ov = Math.min(A2, B2) - Math.max(A1, B1);
        return ov > 0 && ov >= Math.min(A2 - A1, B2 - B1) * 0.5;
      });
      const fresh = mileRows.filter((m) => !have.has(m.id) && !overlaps(m));
      if (fresh.length) {
        const ts = new Date().toISOString();
        const { error } = await svc.from("td_mileage").upsert(
          fresh.map((m) => ({ id: m.id, user_id: cid, data: m.row, updated_at: ts, deleted_at: null, archived_at: null })),
          { onConflict: "id,user_id", ignoreDuplicates: true },
        );
        if (!error) derived += fresh.length;
      }
    }

    // Persist the cursor last, so a crash before this point re-derives (all
    // writes above are idempotent) instead of losing rows.
    await svc.from("geo_device_state").upsert({
      employee_user_id: uid, device_id: deviceId, contractor_user_id: cid,
      state: { dwell, leg, lastTs: newLastTs }, updated_at: new Date().toISOString(),
    }, { onConflict: "employee_user_id,device_id" });

    // Fleet & Team liveness for free: the newest fix stamps the device row.
    const newest = [...evs].reverse().find((e) => e.lat != null);
    if (newest) {
      // device_id here is the SAME zp3 device id JS registers in device_status
      // (handed to the plugin via configureFlush), so this lands on the one
      // row the roster actually renders; a mismatch updates nothing, safely.
      await svc.from("device_status").update({
        location_checked_at: new Date(newest.ts).toISOString(),
      }).eq("user_id", uid).eq("device_id", deviceId).then(() => {}, () => {});
    }

    return json({ ok: true, stored: evs.length, derived });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
