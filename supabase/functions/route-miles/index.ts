// Supabase Edge Function: route-miles
//
// One road, off the phone (owner 2026-09-14: "server side first, phone
// second"). Apple Maps Server API through ../_shared/apple-maps.ts, answered
// from the geo_route_miles cache whenever this account has already paid for
// the same pair of ends.
//
// WHY A CACHE IS NOT AN OPTIMISATION HERE. Apple's free tier is 25,000 service
// calls a day PER TEAM and MapKit JS on every phone draws from the same
// bucket. Server-first-phone-second asks for each road twice by design, so
// without this the two halves of one feature compete for one quota. A road is
// a fact about the map, not about the drive, so the answer is reusable for
// every leg between the same two ends forever.
//
// The cache is keyed exactly like the phone's (_geoRouteKey, js/geo-track.js):
// four decimal places, "lat,lng>lat,lng". Four places is about 11 metres,
// which is tighter than any fence and coarse enough that two arrivals at the
// same driveway share a row.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { appleMapsConfigured, appleRoute, type Pt } from "../_shared/apple-maps.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

const r4 = (v: number) => Math.round(Number(v) * 1e4) / 1e4;
export const routeKey = (a: Pt, b: Pt) => r4(a.lat) + "," + r4(a.lng) + ">" + r4(b.lat) + "," + r4(b.lng);
const pt = (o: unknown): Pt | null => {
  const p = o as { lat?: number; lng?: number };
  return p && isFinite(Number(p.lat)) && isFinite(Number(p.lng)) ? { lat: Number(p.lat), lng: Number(p.lng) } : null;
};

serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  try {
    if (!appleMapsConfigured()) return json({ ok: false, error: "apple maps not configured" }, 503);
    const body = await req.json().catch(() => ({}));
    const from = pt(body?.from), to = pt(body?.to);
    if (!from || !to) return json({ ok: false, error: "from and to required" }, 400);
    const cid = String(body?.contractor_user_id || "");
    const svc = createClient(SUPABASE_URL, SERVICE_KEY);
    const key = routeKey(from, to);

    // Cache first, always. A hit costs one Postgres read and no Apple quota.
    if (cid) {
      const { data } = await svc.from("geo_route_miles")
        .select("miles,path").eq("contractor_user_id", cid).eq("route_key", key).maybeSingle();
      if (data && Number(data.miles) > 0) {
        return json({ ok: true, cached: true, key, miles: Number(data.miles), path: data.path || null });
      }
    }

    const r = await appleRoute(from, to);
    // A road nobody could fetch is not zero miles. The caller keeps whatever
    // it already had, which is always more honest than a number from here.
    if (!r || !(r.miles > 0)) return json({ ok: true, cached: false, key, miles: null, path: null });

    if (cid) {
      await svc.from("geo_route_miles").upsert({
        contractor_user_id: cid, route_key: key, miles: r.miles,
        path: r.path.length ? r.path : null, updated_at: new Date().toISOString(),
      }, { onConflict: "contractor_user_id,route_key" });
    }
    return json({ ok: true, cached: false, key, miles: r.miles, mins: r.mins, path: r.path.length ? r.path : null });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
