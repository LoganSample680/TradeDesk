// One road, one lookup, for every server path that derives a day.
//
// Lifted out of ingest-geo/index.ts when rebuild-day arrived and needed the
// identical thing (owner 2026-09-15). Two copies of a cache key is two places
// for it to drift from the phone's, and the phone's is the one that decides
// whether a road already paid for is found again.
//
// THE CACHE IS NOT AN OPTIMISATION. Apple's free tier is 25,000 service calls
// a day PER TEAM and MapKit JS on every phone draws from the same bucket, so
// the owner's server-first-phone-second ordering asks for each road twice by
// design. geo_route_miles answers the second one for free, forever, because a
// road is a fact about the map and not about the drive.
//
// Keyed exactly like the phone's _geoRouteKey (js/geo-track.js): four decimal
// places, about eleven metres, tighter than any fence and coarse enough that
// two arrivals at one driveway share a row.
import { appleMapsConfigured, appleRoute, type Pt } from "./apple-maps.ts";

const r4 = (v: number) => Math.round(Number(v) * 1e4) / 1e4;
export const routeKey = (a: Pt, b: Pt) =>
  r4(a.lat) + "," + r4(a.lng) + ">" + r4(b.lat) + "," + r4(b.lng);

export type Road = { miles: number; path: number[][] };

// Returns the resolver deriveDayServer takes, or null when Apple is not
// configured, which is the same as passing nothing: breadcrumbs only.
// `svc` is a service-role client; the memo lives for one request.
// deno-lint-ignore no-explicit-any
export function makeRoute(svc: any, cid: string) {
  if (!appleMapsConfigured()) return null;
  const memo = new Map<string, Road | null>();
  return async (from: Pt, to: Pt): Promise<Road | null> => {
    const key = routeKey(from, to);
    if (memo.has(key)) return memo.get(key) ?? null;
    const { data } = await svc.from("geo_route_miles")
      .select("miles,path").eq("contractor_user_id", cid).eq("route_key", key).maybeSingle();
    if (data && Number(data.miles) > 0) {
      const hit: Road = { miles: Number(data.miles), path: (data.path as number[][]) || [] };
      memo.set(key, hit);
      return hit;
    }
    const r = await appleRoute(from, to);
    // A road nobody could fetch is not zero miles, and it is not cached
    // either: a transient failure must not become this account's permanent
    // answer for that pair of ends.
    if (!r || !(r.miles > 0)) { memo.set(key, null); return null; }
    await svc.from("geo_route_miles").upsert({
      contractor_user_id: cid, route_key: key, miles: r.miles,
      path: r.path.length ? r.path : null, updated_at: new Date().toISOString(),
    }, { onConflict: "contractor_user_id,route_key" });
    const got: Road = { miles: r.miles, path: r.path };
    memo.set(key, got);
    return got;
  };
}
