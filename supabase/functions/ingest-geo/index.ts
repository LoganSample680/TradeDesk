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

type Ev = { type: string; ts: number; lat?: number; lng?: number; regionId?: string; arrivalTs?: number; kind?: string; flipId?: string };
type Dwell = { regionId: string; arrivedTs: number; lat: number; lon: number };
type Leg = { startTs: number; lat: number; lon: number; regionId: string; flipId?: string | null };
// A foot -> automotive edge, held until a fence exit confirms a departure
// actually happened. Never written on its own: a phone in a pocket reads
// automotive from a ride in somebody else's truck.
type PendingDrive = { ts: number; lat: number; lon: number; flipId?: string | null };

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
        // What the coprocessor actually said: onFoot / still / driving. The
        // native plugin has always sent it and this function has always
        // dropped it, so the server could see that a transition happened and
        // never what it was.
        kind: typeof e.kind === "string" ? e.kind.slice(0, 16) : null,
        // The flip's own id, carried through untouched.
        flipId: typeof e.flipId === "string" ? e.flipId.slice(0, 40) : null,
      }))
      .sort((a, b) => a.ts - b.ts);
    if (!evs.length) return json({ ok: true, stored: 0, derived: 0 });

    const { error: insErr } = await svc.from("geo_events").upsert(
      evs.map((e) => ({
        contractor_user_id: cid, employee_user_id: uid, device_id: deviceId,
        type: e.type, ts: new Date(e.ts).toISOString(),
        lat: e.lat, lon: e.lng, region_id: e.regionId, kind: e.kind,
        // Stored, not just used. The state machine below has always had this
        // in memory; putting it on the row is what lets one departure be
        // followed from the flip to the two rows it produced, instead of
        // being reasoned about backwards from whichever one came out wrong
        // (owner 2026-08-31, and the 20260904 migration says the rest).
        flip_id: e.flipId,
        arrival_ts: e.arrivalTs ? new Date(e.arrivalTs).toISOString() : null,
      })),
      { onConflict: "employee_user_id,type,ts,region_id", ignoreDuplicates: true },
    );
    if (insErr) return json({ ok: false, error: "geo_events: " + insErr.message }, 500);

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
      const { data: stRow } = await svc.from("geo_device_state")
        .select("state,updated_at").eq("employee_user_id", uid).eq("device_id", deviceId).maybeSingle();
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
          if (isWorkRegion(e.regionId) && (!dwell || dwell.regionId !== e.regionId)) {
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
