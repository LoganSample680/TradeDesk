// Supabase Edge Function: county-property
//
// ── ONE ADDRESS, ENRICHED FROM THE COUNTY THAT OWNS THE RECORD ──────────────
//
// Property facts (year built, sqft, beds/baths, assessed value) used to come
// from scripts/property-proxy.js, which scraped Zillow from a home IP because
// Zillow bot-challenges datacenter IPs. Zillow serves it a hard 403 now, so the
// scraper and the Proxmox box it ran on are both gone. Facts come from the
// county assessor instead, which is where they always originated: Zillow buys
// county records from an aggregator, so the scraper was laundering Shawnee
// County's own data back to us through two middlemen.
//
// WHY THIS IS AN EDGE FUNCTION AND NOT A CLOUDFLARE ROUTE. It was a Cloudflare
// Pages Function first, purely because the dead Zillow tunnel proxy happened to
// live at that file path and the rewrite stayed put. That was a CLAUDE.md 7.3
// violation: twenty Edge Functions already do exactly this shape of work, and
// the closest existing pattern is the one to match. Moving it here means the
// service key is injected rather than copied into a second vendor's config, the
// caller check is the same one line every sibling function uses, and it ships
// with the migrations in one deploy-functions.yml dispatch.
//
// WHAT IT IS FOR. The bulk of property data never comes through here: it is
// matched with one SQL join at sign-in (property_lookup, called straight from
// the browser). This is the SINGLE-ADDRESS path, fired when a contractor SAVES
// an address, and it is the only thing that writes shared county data.
//
// TWO SOURCES PER COUNTY, because Shawnee splits the record in two and most
// counties do. The appraiser's search knows what the BUILDING is; the GIS layer
// knows what it is WORTH and who owns it. Neither knows the other's half. Both
// are asked on the same lookup so a saved address is complete in one pass,
// which is what lets this work with no bulk pre-load at all.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// Identify ourselves to the county. A county admin reading their logs should be
// able to tell who this is and who to email, rather than seeing an anonymous
// client and blocking the range without ever telling anybody.
const UA = "TradeDeskCRM/1.0 (county assessor public record lookup; +https://tradedeskpro.app)";

// The daily circuit breaker, shared with every other path through
// td_county_asks so they all draw on ONE budget. Not a throttle for normal use
// (an address is asked once ever); this caps the damage when something loops.
const DAILY_CAP = parseInt(Deno.env.get("COUNTY_DAILY_CAP") || "1000", 10);
// The county GIS root, shared by the parcel source and every extra below.
const GIS = "https://gis.sncoapps.us/arcgis2/rest/services";

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}
const intOrNull = (v: unknown) => { const n = numOrNull(v); return n == null ? null : Math.round(n); };

// A year the assessor never set comes back as 0, or as 1900, which several CAMA
// systems use for "unknown". Letting either through would arm or disarm the
// pre-1978 lead gate on a placeholder.
function yearOrNull(v: unknown): number | null {
  const n = numOrNull(v);
  if (n == null || n < 1700 || n > new Date().getFullYear() + 1) return null;
  return Math.round(n);
}

type Src = { url: (street: string) => string; parse: (body: any) => Record<string, unknown> | null };
// ctx carries what the parcel source already established: the parcel's own
// point (in the layer's spatial reference, NOT lat/lon) and its quickRef.
type ExtraCtx = { x: number | null; y: number | null; wkid: number; quickRef: string | null };
type Extra = { name: string; need: 'point' | 'quickRef'; url: (c: ExtraCtx) => string; parse: (body: any) => Record<string, unknown> | null };

// Per-county lookup, keyed by the same county_fips the parcel rows carry, so
// adding a county is an entry rather than a branch.
const ENRICHERS: Record<string, {
  name: string; state: string; sourceUrl: (street: string) => string;
  building?: Src; parcel?: Src;
  // Sources that need something the parcel source produced: a point to ask
  // "what is here", or the quickRef to look up on a list. They run in a second
  // pass for that reason, never in the first Promise.all.
  extras?: Extra[];
}> = {
  "20177": {
    name: "Shawnee",
    state: "KS",
    // Per PARCEL, not per county, because a link every row shares is a link
    // that lands nobody anywhere (owner, 2026-09-22: "takes us to the search
    // page"). ARES has no per-parcel route at all, results are drawn client
    // side and every /Property/… and /Detail/… path 404s, so the closest this
    // county can get is its search with the address already filled in.
    sourceUrl: (street: string) =>
      "https://ares.sncoapps.us/BasicSearch/Index?" +
      new URLSearchParams({ searchCriteria: street, countyCode: "089", searchBy: "address", listMode: "card" }),

    // The building. Tyler/Epona "ARES" public search: the page renders client
    // side from this JSON endpoint, so we ask it directly rather than parsing
    // HTML, and there is no markup to break on when they restyle the site.
    building: {
      url: (street) =>
        `https://ares.sncoapps.us/BasicSearch/ResultsJson?${new URLSearchParams({
          searchCriteria: street, countyCode: "089", listMode: "card", searchBy: "address",
        })}`,
      parse: (body) => {
        const rows = Array.isArray(body) ? body : (body?.data ?? []);
        // Exactly one hit or we decline to answer. An ambiguous match on a
        // number that gates a federal lead-paint disclosure is worse than no
        // answer, because a wrong year silently disarms the warning.
        if (rows.length !== 1) return null;
        const r = rows[0];
        const full = String(r.propertyAddress || "");
        const fullBaths = numOrNull(r.resBldgTotalFullBathrooms);
        const halfBaths = numOrNull(r.resBldgTotalHalfBathrooms);
        // The appraiser splits building facts by property type and publishes
        // only the half that applies: resBldg* for a house, comBldg* for a
        // store. Reading only the residential half is why every commercial
        // parcel answered with an owner, a value and nothing else, and why the
        // owner said commercial "wasn't coming over" (2026-09-22).
        //
        // It is not cosmetic. A pre-1978 COMMERCIAL building is covered by the
        // EPA RRP rule exactly as a house is, because a child-occupied facility
        // (a daycare, a preschool) is usually somebody's commercial building.
        // A null year silently disarmed that warning on every commercial bid.
        return {
          parcel_id: r.quickRef || null,
          year_built: yearOrNull(r.resBldgYearBuiltFrom) ?? yearOrNull(r.comBldgYearBuiltFrom),
          // Built-from 2001, built-to 2017 means the building was added to,
          // twice. Proven appetite to spend on that address.
          year_built_to: yearOrNull(r.resBldgYearBuiltTo) ?? yearOrNull(r.comBldgYearBuiltTo),
          sqft: intOrNull(r.resBldgTotalArea) ?? intOrNull(r.comBldgTotalArea),
          // What the parcel IS, in the county's own words. On a commercial card
          // with no beds and no baths, this is most of what there is to say.
          property_type: r.propertyType || null,
          use_desc: r.functionCodeDescription || null,
          parcel_number: r.parcelNumber || null,
          // Scope that is otherwise only found by walking the lot.
          building_count: (intOrNull(r.resBldgCount) || 0) + (intOrNull(r.comBldgCount) || 0) + (intOrNull(r.mhCount) || 0) || null,
          living_units: intOrNull(r.numLivingUnits),
          // Linear feet, for a fence or a gutter run, without a site visit.
          frontage_ft: numOrNull(r.frontageFt),
          depth_ft: numOrNull(r.depthFt),
          basement_desc: r.primaryResBldgBasementCodeDescription || null,
          subdivision: r.subdivisionCodeDescription || null,
          // Everything the county sent, verbatim. We contact an address ONCE,
          // ever (county_claim_ask), so a field not kept here is a field we
          // cannot go back for without re-asking the whole county.
          _raw_building: r,
          beds: numOrNull(r.resBldgTotalBedrooms),
          // A county reporting 1 full + 1 half is 1.5 baths. Rounding either
          // way makes us wrong about somebody's house.
          baths: fullBaths == null && halfBaths == null ? null : (fullBaths || 0) + (halfBaths || 0) * 0.5,
          owner_name: r.ownerName || null,
          acres: numOrNull(r.totalAcres),
          city: full.match(/,\s*([^,]+),\s*[A-Z]{2}\s/)?.[1]?.trim() || null,
          zip: full.match(/\b(\d{5})(?:-\d{4})?\s*$/)?.[1] || null,
        };
      },
    },

    // The money. The county's own ArcGIS parcel layer, filtered to one address.
    // A real JSON API with server-side filtering, not a scrape.
    parcel: {
      url: (street) => {
        // Escape quotes before they reach the where clause. A street line is
        // user input that arrives from a client record, and "O'Brien St" would
        // otherwise terminate the string and change the query.
        const safe = street.replace(/'/g, "''").toUpperCase();
        return "https://gis.sncoapps.us/arcgis2/rest/services/Appraiser/AppraisalDataPro/MapServer/4/query?" +
          new URLSearchParams({
            where: `PADDRESS = '${safe}'`,
            // "*" and not a named list. The named list was seven fields, and
            // the parse below reads PID, DBOOKPAGE, NBHD, USD and the polygon
            // area, none of which were in it: every one of them came back
            // undefined and was silently stored as null. A field list that has
            // to be kept in sync with a parse by hand is a field list that
            // drifts, and the drift is invisible because a missing attribute
            // reads exactly like a county that does not publish it.
            outFields: "*",
            // The geometry is what makes the flood and soils layers askable at
            // all: both answer "what is AT this point", and the only point we
            // have for an address is the parcel's own polygon.
            returnGeometry: "true",
            f: "json",
          });
      },
      parse: (body) => {
        const feats = body?.features ?? [];
        // Same rule as the building side: one unambiguous parcel or nothing.
        if (feats.length !== 1) return null;
        const a = feats[0].attributes || {};
        // Centroid of the ring, which is inside the parcel for any normal lot
        // shape and is all the point-in-polygon layers need. The county serves
        // this in Kansas State Plane North feet (wkid 3419), not lat/lon, and
        // the extras below query in that same SR rather than converting.
        let _cx: number | null = null, _cy: number | null = null;
        try {
          const ring = feats[0].geometry?.rings?.[0];
          if (ring && ring.length) {
            _cx = ring.reduce((t: number, pt: number[]) => t + pt[0], 0) / ring.length;
            _cy = ring.reduce((t: number, pt: number[]) => t + pt[1], 0) / ring.length;
          }
        } catch { /* no geometry: the extras simply do not run */ }
        return {
          _pt_x: _cx, _pt_y: _cy,
          parcel_id: a.QUICKREFID ? String(a.QUICKREFID).trim() : null,
          owner_name: a.ONAME ? String(a.ONAME).trim() : null,
          // A value of 0 is a real assessment (exempt property), so intOrNull
          // rather than a truthiness check: 0 survives, missing does not.
          assessed_value: intOrNull(a.TOTVAL),
          improvement_value: intOrNull(a.BLDGVAL),
          land_value: intOrNull(a.LDVAL),
          acres: numOrNull(a.ACRES),
          parcel_number: a.PID ? String(a.PID).trim() : null,
          // The recorded instrument. Shawnee publishes no sale price and no
          // sale date, so the year prefix here ('2022R20196') is the closest
          // this county gets to "when did they buy it".
          deed_book_page: a.DBOOKPAGE ? String(a.DBOOKPAGE).trim() : null,
          neighborhood: a.NBHD ? String(a.NBHD).trim() : null,
          school_district: a.USD ? String(a.USD).trim() : null,
          // True lot area off the parcel polygon, not a rounded acreage.
          land_sqft: numOrNull(a["Shape.STArea()"]),
          _raw_parcel: a,
        };
      },
    },

    // ── The ground, the water, and who is behind on tax ──────────────────
    // All three probed live before being wired (2026-09-22): flood 949
    // polygons, soils 10,538, tax sale 553. Zoning was probed too and left
    // out on purpose: 304 features county-wide and nothing for a parcel
    // inside Topeka, because the city zones its own land, and a field blank
    // for most addresses reads as broken rather than as absent.
    extras: [
      {
        // Riverine flood hazard. NOT a sump-pump signal (that is soil), this
        // is the 50% substantial-improvement rule: inside an SFHA, an
        // improvement over half the structure's value drags the whole
        // building up to current floodplain code.
        name: "flood", need: "point",
        url: (c) => `${GIS}/FloodZones/MapServer/3/query?` + new URLSearchParams({
          geometry: `${c.x},${c.y}`, geometryType: "esriGeometryPoint", inSR: String(c.wkid),
          spatialRel: "esriSpatialRelIntersects",
          outFields: "FLD_ZONE,SFHA_TF,FLOODWAY,STATIC_BFE", returnGeometry: "false", f: "json",
        }),
        parse: (body) => {
          const f = body?.features ?? [];
          // ZERO FEATURES IS AN ANSWER: the parcel is outside every mapped
          // flood polygon. Recorded as "no zone" rather than left null, so a
          // card can say so instead of looking unanswered.
          if (!f.length) return { flood_zone: "none", flood_sfha: false };
          const a = f[0].attributes || {};
          return {
            flood_zone: a.FLD_ZONE ? String(a.FLD_ZONE).trim() : null,
            flood_sfha: String(a.SFHA_TF || "").toUpperCase() === "T",
            flood_floodway: a.FLOODWAY ? String(a.FLOODWAY).trim() : null,
            // -9999 is Esri's no-data sentinel and it comes back on every
            // parcel here, including the one genuinely in Zone A. Stored raw
            // it renders as "Base flood elev: -9999", which is worse than
            // blank because it looks like a real number. Same guard shape as
            // yearOrNull above: a value outside anything physically sane is
            // an absence, not a measurement.
            flood_bfe: (() => { const v = numOrNull(a.STATIC_BFE); return (v == null || v < -1000 || v > 30000) ? null : v; })(),
          };
        },
      },
      {
        // What the ground IS. Drainage, french drains, irrigation zones,
        // sprinkler spacing, footings, post holes. "Silty clay loam" drains
        // slowly and heaves; sandy loam does not.
        name: "soil", need: "point",
        url: (c) => `${GIS}/Soils/MapServer/0/query?` + new URLSearchParams({
          geometry: `${c.x},${c.y}`, geometryType: "esriGeometryPoint", inSR: String(c.wkid),
          spatialRel: "esriSpatialRelIntersects",
          outFields: "MUSYM,Description,Land_Type", returnGeometry: "false", f: "json",
        }),
        parse: (body) => {
          const f = body?.features ?? [];
          if (!f.length) return null;
          const a = f[0].attributes || {};
          // The slope is part of the published string and stays part of it:
          // the ranges are not uniform, so splitting it into a number would
          // be inventing precision the county did not give.
          return { soil_desc: a.Description ? String(a.Description).trim() : null };
        },
      },
      {
        // Published tax-sale list. Keyed on the SAME quickRef the parcel row
        // already carries, so this one needs no geometry at all.
        name: "taxsale", need: "quickRef",
        url: (c) => `${GIS}/TaxSalePublish/MapServer/1/query?` + new URLSearchParams({
          where: `QUICKREFID='${String(c.quickRef || "").replace(/'/g, "''")}'`,
          outFields: "SaleYear,CaseNumber", returnGeometry: "false", f: "json",
        }),
        parse: (body) => {
          const f = body?.features ?? [];
          // Absent from the list is NOT "taxes are current", it is only "not
          // on the published list", so nothing is written for a miss.
          if (!f.length) return null;
          const a = f[0].attributes || {};
          return {
            tax_sale_year: intOrNull(a.SaleYear),
            tax_sale_case: a.CaseNumber ? String(a.CaseNumber).trim() : null,
          };
        },
      },
    ],
  },
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    // ── WHO IS ASKING ────────────────────────────────────────────────────────
    // The Cloudflare route this replaced had NO caller check at all: anyone on
    // the internet could hit it and make us fire a request at a county server
    // through our own domain, which is precisely what gets a range blocked.
    // Same one line every sibling function uses. The service key is never
    // touched until this passes.
    const auth = req.headers.get("Authorization") || "";
    if (!auth) return json({ error: "unauthorized" }, 401);
    const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
    const { data: me, error: meErr } = await asUser.auth.getUser();
    if (meErr || !me?.user) return json({ error: "unauthorized" }, 401);

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const addr = String(body?.addr ?? new URL(req.url).searchParams.get("addr") ?? "").trim();
    if (!addr) return json({ error: "addr required" }, 400);

    const svc = createClient(SUPABASE_URL, SERVICE_KEY);
    const zip = addr.match(/\b(\d{5})(?:-\d{4})?\s*$/)?.[1] || null;

    // 1. What we already hold. The same RPC the batch sync uses, so a single
    //    lookup and a bulk sync can never disagree about an address.
    const { data: matched } = await svc.rpc("property_lookup", { p_addrs: [addr] });
    const hit = matched?.[0] ?? null;

    // Already complete: hand it straight back, no county traffic at all.
    if (hit?.year_built != null) return json(hit);

    // 2. Which county should we ask? The matched row knows; otherwise route by
    //    zip. Neither means we have not loaded this county, which is a 204: an
    //    honest "not yet", distinct from the county having no such address.
    let fips: string | null = hit?.county_fips ?? null;
    if (!fips && zip) {
      const { data: z } = await svc.from("td_county_zips").select("county_fips").eq("zip", zip).limit(1);
      fips = z?.[0]?.county_fips ?? null;
    }
    const enricher = fips ? ENRICHERS[fips] : null;
    if (!enricher) return hit ? json(hit) : new Response(null, { status: 204, headers: cors });

    // 3. MAY we contact the county about this address at all?
    //
    //    This is the whole answer to "only call the address one time". Checking
    //    year_built is null was not enough on its own: it caches the successes
    //    and nothing else, so an address the county CANNOT answer (a vacant
    //    lot, an address it has no record of) came back null every time and was
    //    re-asked forever, by every contractor who touched it. Those are
    //    precisely the requests that look like probing from the county's side.
    //    county_claim_ask records the ask itself, before it happens.
    const { data: claim } = await svc.rpc("county_claim_ask", {
      p_fips: fips, p_addr: addr, p_daily_cap: DAILY_CAP,
    });
    if (claim !== "go") {
      // 'already' is the normal, healthy case: asked before, nothing more to
      // learn. 'capped' means the day's budget for this county is spent.
      return hit ? json(hit) : json({ found: false, reason: claim });
    }

    // 4. Ask the county. Both halves, in parallel, once ever for this address.
    //    The street line only: the county's own search wants "2015 SW RANDOLPH
    //    AVE", not the city and zip the client record carries.
    const street = addr.split(",")[0].trim();
    const ask = async (src?: Src) => {
      if (!src) return null;
      try {
        const res = await fetch(src.url(street), {
          headers: { "User-Agent": UA, Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
          signal: AbortSignal.timeout(10000),
        });
        // A refused or broken request is NOT proof the county has nothing. It
        // returns undefined (distinct from null) so the caller can tell a
        // transport failure apart from a genuine "no such address".
        if (!res.ok) return undefined;
        return src.parse(await res.json());
      } catch { return undefined; }
    };

    const [building, parcel] = await Promise.all([ask(enricher.building), ask(enricher.parcel)]);

    // Both sides failed to answer at all: leave the claim pending so the
    // one-hour window can retry, rather than burning the address on a blip.
    if (building === undefined && parcel === undefined) {
      return hit ? json(hit) : json({ found: false });
    }

    // try/catch, not .catch(): svc.rpc() returns a PostgrestBuilder, which is
    // thenable but has no .catch method, so chaining one throws "is not a
    // function" and takes the whole lookup down instead of shrugging off a
    // bookkeeping failure.
    const close = async (outcome: string) => {
      try {
        await svc.rpc("county_record_ask", { p_fips: fips, p_addr: addr, p_outcome: outcome });
      } catch { /* the claim stays pending, which is the safe side */ }
    };

    // Merge what came back. The parcel side is listed second so its assessed
    // figures win; the building side supplies everything about the structure.
    const got: Record<string, any> = { ...(building || {}), ...(parcel || {}) };

    // ── SECOND PASS: the sources that needed the parcel first ────────────
    // Flood and soils answer "what is AT this point" and the only point we
    // have for an address is the parcel's own centroid; tax sale is keyed on
    // its quickRef. So they cannot join the first Promise.all, they can only
    // run once it has answered.
    //
    // Best effort by design. Each is wrapped so a layer being down costs that
    // one field and never the lookup: year built and the lead gate must not
    // depend on a soils server. For the same reason a failure here does NOT
    // reopen the claim, because the two sources that decide whether the
    // address was answered at all have already replied.
    const ctx: ExtraCtx = {
      x: got._pt_x ?? null, y: got._pt_y ?? null,
      wkid: 3419, // Kansas State Plane North (feet), the SR the parcel layer serves
      quickRef: got.parcel_id ? String(got.parcel_id) : null,
    };
    const extras = enricher.extras || [];
    const runnable = extras.filter((x) =>
      x.need === "point" ? (ctx.x != null && ctx.y != null) : !!ctx.quickRef);
    if (runnable.length) {
      const results = await Promise.all(runnable.map(async (x) => {
        try {
          const res = await fetch(x.url(ctx), {
            headers: { "User-Agent": UA, Accept: "application/json" },
            signal: AbortSignal.timeout(10000),
          });
          if (!res.ok) return null;
          return x.parse(await res.json());
        } catch { return null; }
      }));
      results.forEach((r, i) => {
        if (!r) return;
        Object.assign(got, r);
        (got._raw_extras = got._raw_extras || {})[runnable[i].name] = r;
      });
    }
    // The centroid was scaffolding for the queries above, not a fact about the
    // property. It must not reach the patch or it lands as an unknown column.
    delete got._pt_x; delete got._pt_y;
    // Both answered and neither had this address. That is a real answer and it
    // is recorded as one, which is what stops the address coming back forever.
    if (!Object.keys(got).length) { await close("empty"); return hit ? json(hit) : json({ found: false }); }

    const out: Record<string, any> = {
      ...(hit || {}),
      ...Object.fromEntries(Object.entries(got).filter(([, v]) => v != null)),
      q: addr,
      county_fips: fips,
      county_name: hit?.county_name ?? enricher.name,
      state: hit?.state ?? enricher.state,
      source_url: enricher.sourceUrl(street),
    };

    // Close the claim ONLY when both sides actually answered. If one of them
    // merely failed to respond, retiring the address would lose that half of
    // the record permanently on a blip: a transient failure on the building
    // side would leave a house with a value and no year built, forever, with
    // nothing left to retry it.
    if (building !== undefined && parcel !== undefined) {
      // An answer with no year built is still an answer: the county holds the
      // parcel but has no year for it (vacant land, some commercial). Asking
      // again tomorrow gets the same nothing, so it is retired.
      await close(out.year_built != null ? "hit" : "empty");
    }

    // 5. Write it back to the shared parcel row, so the next contractor to
    //    touch this address gets it from the join with no county traffic.
    await cacheBack(svc, out, hit).catch(() => {});

    // The raw blobs are for the shared parcel row, not for the browser: they
    // are tens of kilobytes of county bookkeeping the card never reads.
    delete out._raw_building; delete out._raw_parcel; delete out._raw_extras;
    return json(out);
  } catch (e) {
    console.error("[county-property]", e instanceof Error ? e.message : String(e));
    return json({ error: "lookup failed" }, 502);
  }
});

// Everything both sources can produce. The assessed figures matter here
// especially: with the demand-driven path there IS no bulk load, so a value not
// written here is a value nobody ever sees again.
async function cacheBack(svc: ReturnType<typeof createClient>, out: Record<string, any>, hit: any) {
  // The two _raw_* keys are the whole county response per source. They are
  // folded into one jsonb column rather than written as fields, and they are
  // stripped from the patch below so they can never land as columns.
  const raw = (out._raw_building || out._raw_parcel || out._raw_extras)
    ? { building: out._raw_building ?? null, parcel: out._raw_parcel ?? null,
        extras: out._raw_extras ?? null, at: new Date().toISOString() }
    : null;

  const patch: Record<string, unknown> = {
    year_built: out.year_built ?? null,
    year_built_to: out.year_built_to ?? null,
    parcel_number: out.parcel_number ?? null,
    deed_book_page: out.deed_book_page ?? null,
    building_count: out.building_count ?? null,
    living_units: out.living_units ?? null,
    frontage_ft: out.frontage_ft ?? null,
    depth_ft: out.depth_ft ?? null,
    basement_desc: out.basement_desc ?? null,
    subdivision: out.subdivision ?? null,
    neighborhood: out.neighborhood ?? null,
    school_district: out.school_district ?? null,
    land_sqft: out.land_sqft ?? null,
    sqft: out.sqft ?? null,
    beds: out.beds ?? null,
    baths: out.baths ?? null,
    acres: out.acres ?? null,
    assessed_value: out.assessed_value ?? null,
    land_value: out.land_value ?? null,
    improvement_value: out.improvement_value ?? null,
    owner_name: out.owner_name ?? null,
    // Without these two the column exists and stays empty forever: the parse
    // reads them, the response carries them, and the write drops them.
    property_type: out.property_type ?? null,
    use_desc: out.use_desc ?? null,
    soil_desc: out.soil_desc ?? null,
    flood_zone: out.flood_zone ?? null,
    // No ?? null, on purpose. FALSE is a real answer here, "outside every
    // mapped flood polygon", and it has to survive both filters: `v != null`
    // when out is built, and `patch[k] == null` in the strip below. Both are
    // loose equality against null, which false does not satisfy, so false is
    // kept and only a genuinely absent answer is dropped. `?? null` would have
    // been harmless; `|| null` would have turned every not-in-a-flood-zone
    // parcel back into "we never checked".
    flood_sfha: out.flood_sfha,
    flood_floodway: out.flood_floodway ?? null,
    flood_bfe: out.flood_bfe ?? null,
    tax_sale_year: out.tax_sale_year ?? null,
    tax_sale_case: out.tax_sale_case ?? null,
    city: out.city ?? null,
    zip: out.zip ?? null,
  };
  for (const k of Object.keys(patch)) if (patch[k] == null) delete patch[k];
  if (raw) patch.raw = raw;
  if (!Object.keys(patch).length) return;

  // The parcel already exists (a bulk load put it there): patch it in place.
  if (hit?.parcel_id) {
    // source_url rides along so a row loaded before the link was per-parcel
    // (or under an older URL shape) is corrected rather than left stale. The
    // upsert branch below already sets it at creation; without it here, only
    // brand-new rows would ever carry a working link.
    await svc.from("td_county_parcels").update({ ...patch, ...(out.source_url ? { source_url: out.source_url } : {}) })
      .eq("county_fips", out.county_fips).eq("parcel_id", hit.parcel_id);
    return;
  }

  // No existing row, which is the normal case on the demand-driven path: this
  // county has never been bulk loaded and this address is the first anyone has
  // asked about.
  if (!out.parcel_id || !out.q) return;
  await svc.from("td_county_parcels").upsert({
    county_fips: out.county_fips,
    state: out.state,
    county_name: out.county_name,
    parcel_id: String(out.parcel_id),
    street: String(out.q).split(",")[0].trim(),
    ...patch,
    source: `${out.county_name} County Appraiser`,
    source_url: out.source_url ?? null,
  }, { onConflict: "county_fips,parcel_id" });
}
