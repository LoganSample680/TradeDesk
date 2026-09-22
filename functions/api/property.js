// ── ONE ADDRESS, ENRICHED FROM THE COUNTY THAT OWNS THE RECORD ──────────────
//
// This route used to reverse-proxy a Node service on a Proxmox box at the
// owner's house, whose whole reason for existing was that a residential IP
// looked human to Zillow's bot detection. Zillow serves 403 to it now
// (verified 2026-09-22) and behavioral fingerprinting is not beaten by headers,
// so the scraper and the box it ran on are both gone.
//
// The bulk of property data no longer comes through here at all: it is loaded
// county by county into td_county_parcels (scripts/county-load.js) and matched
// with one SQL join at sign-in (_syncPropertyData, js/clients.js). This route
// is only the SINGLE-ADDRESS path behind the "Look up property" button, and it
// exists for one job: fill what the county's bulk layer does not publish.
//
// Shawnee County is the worked example and the reason for the split. Its GIS
// layer carries owner and assessed values for all 77,006 parcels but no year
// built at all; year built lives in the appraiser's Orion system, reachable
// only one address at a time. So a lookup checks what we already hold first,
// asks the county only for the gap, and WRITES THE ANSWER BACK to the shared
// parcel row. The next contractor to touch that address gets it from the join
// for free, and the county is asked once per address ever rather than once per
// contractor.

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
};

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });

// Identify ourselves to the county. A county admin reading their logs should be
// able to tell who this is, rather than seeing an anonymous client and blocking
// the range without ever telling anybody.
const UA = 'TradeDeskCRM/1.0 (county assessor public record lookup; +https://tradedesk-cyp.pages.dev)';

// Per-county lookup. Keyed by the same county_fips the parcel rows carry, so
// adding a county here is an entry, not a branch.
//
// TWO SOURCES PER COUNTY, because Shawnee splits the record in two and most
// counties do. The appraiser's search knows what the BUILDING is (year built,
// sqft, beds, baths); the GIS layer knows what it is WORTH (assessed, land,
// improvement) and who owns it. Neither knows the other's half.
//
// Both are queried on the same demand-driven lookup so a saved address is
// complete in one pass. That is what lets this work with no bulk pre-load at
// all: two requests per address a contractor actually saves, cached forever,
// instead of 77,006 requests for a county he may never work half of.
const ENRICHERS = {
  '20177': {
    name: 'Shawnee',
    state: 'KS',
    sourceUrl: 'https://ares.sncoapps.us/',

    // The building. Tyler/Epona "ARES" public search: the page renders client
    // side from this JSON endpoint, so we ask it directly rather than parsing
    // HTML, and there is no markup to break on when they restyle the site.
    building: {
      url(street) {
        return `https://ares.sncoapps.us/BasicSearch/ResultsJson?${new URLSearchParams({
          searchCriteria: street, countyCode: '089', listMode: 'card', searchBy: 'address',
        })}`;
      },
      parse(body) {
        const rows = Array.isArray(body) ? body : (body && body.data) || [];
        // Exactly one hit or we decline to answer. An ambiguous match on a
        // number that gates a federal lead-paint disclosure is worse than no
        // answer, because a wrong year silently disarms the warning.
        if (rows.length !== 1) return null;
        const r = rows[0];
        const full = r.propertyAddress || '';
        const fullBaths = numOrNull(r.resBldgTotalFullBathrooms);
        const halfBaths = numOrNull(r.resBldgTotalHalfBathrooms);
        return {
          parcel_id:  r.quickRef || null,
          year_built: yearOrNull(r.resBldgYearBuiltFrom),
          sqft:       intOrNull(r.resBldgTotalArea),
          beds:       numOrNull(r.resBldgTotalBedrooms),
          // A county reporting 1 full + 1 half is 1.5 baths. Rounding either
          // way makes us wrong about somebody's house.
          baths: fullBaths == null && halfBaths == null ? null : (fullBaths || 0) + (halfBaths || 0) * 0.5,
          owner_name: r.ownerName || null,
          acres: numOrNull(r.totalAcres),
          city: (full.match(/,\s*([^,]+),\s*[A-Z]{2}\s/) || [])[1]?.trim() || null,
          zip:  (full.match(/\b(\d{5})(?:-\d{4})?\s*$/) || [])[1] || null,
        };
      },
    },

    // The money. The county's own ArcGIS parcel layer, filtered to one address.
    // A real JSON API with server-side filtering, not a scrape.
    parcel: {
      url(street) {
        // Escape quotes before they reach the where clause. A street line is
        // user input that arrives from a client record, and "O'Brien St" would
        // otherwise terminate the string and change the query.
        const safe = street.replace(/'/g, "''").toUpperCase();
        return 'https://gis.sncoapps.us/arcgis2/rest/services/Appraiser/AppraisalDataPro/MapServer/4/query?'
          + new URLSearchParams({
            where: `PADDRESS = '${safe}'`,
            outFields: 'QUICKREFID,PADDRESS,ONAME,TOTVAL,BLDGVAL,LDVAL,ACRES',
            returnGeometry: 'false',
            f: 'json',
          });
      },
      parse(body) {
        const feats = (body && body.features) || [];
        // Same rule as the building side: one unambiguous parcel or nothing.
        if (feats.length !== 1) return null;
        const a = feats[0].attributes || {};
        return {
          parcel_id: a.QUICKREFID ? String(a.QUICKREFID).trim() : null,
          owner_name: a.ONAME ? String(a.ONAME).trim() : null,
          // A value of 0 is a real assessment (exempt property), so `?? null`
          // rather than a truthiness check: 0 must survive, missing must not.
          assessed_value:    intOrNull(a.TOTVAL),
          improvement_value: intOrNull(a.BLDGVAL),
          land_value:        intOrNull(a.LDVAL),
          acres:             numOrNull(a.ACRES),
        };
      },
    },
  },
};

function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}
const intOrNull = v => { const n = numOrNull(v); return n == null ? null : Math.round(n); };

// A year the assessor never set comes back as 0, or as 1900, which several CAMA
// systems use for "unknown". Letting either through would arm or disarm the
// pre-1978 gate on a placeholder.
function yearOrNull(v) {
  const n = numOrNull(v);
  if (n == null || n < 1700 || n > new Date().getFullYear() + 1) return null;
  return Math.round(n);
}

// Which loaded county, if any, covers this address. Zip first (td_county_zips is
// the routing table the loader populates); no zip means we cannot route, which
// is a 204 rather than a guess.
async function countyForZip(env, zip) {
  if (!zip) return null;
  const rows = await supaGet(env, `/rest/v1/td_county_zips?zip=eq.${encodeURIComponent(zip)}&select=county_fips&limit=1`);
  return rows && rows[0] ? rows[0].county_fips : null;
}

async function supaGet(env, path) {
  const res = await fetch(`${env.SUPABASE_URL}${path}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  return res.json();
}

export async function onRequest(context) {
  const { env } = context;
  const { searchParams } = new URL(context.request.url);
  const addr = (searchParams.get('addr') || '').trim();

  if (!addr) return json({ error: 'addr required' }, 400);

  // No backend configured (a preview without secrets): 204, the same "nothing to
  // say" the client already understands, so it leaves the address unstamped and
  // retries once the county is actually live.
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return new Response(null, { status: 204 });

  const zip = (addr.match(/\b(\d{5})(?:-\d{4})?\s*$/) || [])[1] || null;

  try {
    // 1. What we already hold. This is the same RPC the batch sync uses, so a
    //    single lookup and a bulk sync can never disagree about an address.
    const matched = await supaRpc(env, 'property_lookup', { p_addrs: [addr] });
    const hit = matched && matched[0] ? matched[0] : null;

    // Already complete: hand it straight back, no county traffic at all.
    if (hit && hit.year_built != null) return json(hit);

    // 2. Which county should we ask? The matched row knows; otherwise route by
    //    zip. Neither means we have not loaded this county, which is a 204: an
    //    honest "not yet", distinct from the county having no such address.
    const fips = (hit && hit.county_fips) || await countyForZip(env, zip);
    const enricher = fips ? ENRICHERS[fips] : null;
    if (!enricher) return hit ? json(hit) : new Response(null, { status: 204 });

    // 2b. MAY we contact the county about this address at all?
    //
    // This is the whole answer to "only call the address one time". Checking
    // year_built is null was not enough on its own: it caches the successes and
    // nothing else, so an address the county CANNOT answer (a vacant lot, a
    // commercial parcel, an address it has no record of) came back null every
    // time and was re-asked forever, by every contractor who ever touched it.
    // Those are precisely the requests that look like probing from the county's
    // side. county_claim_ask records the ask itself, before it happens, so one
    // address is one request ever. See 20261033_county_ask_gate.sql.
    const claim = await supaRpc(env, 'county_claim_ask', {
      p_fips: fips,
      p_addr: addr,
      p_daily_cap: parseInt(env.COUNTY_DAILY_CAP || '500', 10),
    });
    if (claim !== 'go') {
      // 'already' is the normal, healthy case: asked before, nothing more to
      // learn. 'capped' means the day's budget for this county is spent. Either
      // way the county is not contacted, and the contractor gets whatever we
      // hold, which may be a complete record minus the year.
      return hit ? json(hit) : json({ found: false, reason: claim });
    }

    // Every exit from here on closes the claim, or the address is stranded as
    // 'pending' and nothing retries it for an hour. `close` is best effort on
    // purpose: the contractor's answer never waits on bookkeeping, and the
    // unclosed 'pending' row still blocks re-asking, which is the safe side.
    const close = (outcome) => context.waitUntil(
      supaRpc(env, 'county_record_ask', { p_fips: fips, p_addr: addr, p_outcome: outcome }).catch(() => {})
    );

    // 3. Ask the county. Both halves of the record, in parallel, once ever for
    //    this address. The street line only: the county's own search wants
    //    "2015 SW RANDOLPH AVE", not the city and zip the client record carries.
    const street = addr.split(',')[0].trim();
    const ask = async (src) => {
      if (!src) return null;
      try {
        const res = await fetch(src.url(street), {
          headers: { 'User-Agent': UA, Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          signal: AbortSignal.timeout(10000),
        });
        // A refused or broken request is NOT proof the county has nothing. It
        // returns undefined (distinct from null) so the caller can tell a
        // transport failure apart from a genuine "no such address".
        if (!res.ok) return undefined;
        return src.parse(await res.json());
      } catch (_e) { return undefined; }
    };

    const [building, parcel] = await Promise.all([ask(enricher.building), ask(enricher.parcel)]);

    // Both sides failed to answer at all: leave the claim pending so the
    // one-hour window can retry, rather than burning the address on a blip.
    if (building === undefined && parcel === undefined) {
      return hit ? json(hit) : json({ found: false });
    }

    // Merge what came back. The parcel side is listed second so its assessed
    // figures win, and the building side supplies everything about the structure.
    const got = { ...(building || {}), ...(parcel || {}) };
    // Both answered and neither had this address. That is a real answer and it
    // is recorded as one, which is what stops the address coming back forever.
    if (!Object.keys(got).length) { close('empty'); return hit ? json(hit) : json({ found: false }); }

    const out = {
      ...(hit || {}),
      ...Object.fromEntries(Object.entries(got).filter(([, v]) => v != null)),
      q: addr,
      county_fips: fips,
      county_name: (hit && hit.county_name) || enricher.name,
      state: (hit && hit.state) || enricher.state,
      source_url: (hit && hit.source_url) || enricher.sourceUrl,
    };

    // Close the claim ONLY when both sides actually answered. If one of them
    // merely failed to respond, retiring the address would lose that half of
    // the record permanently on a blip: a transient ares failure would leave a
    // house with a value and no year built, forever, with nothing to retry it.
    // Leaving it pending costs one hour and one more request.
    if (building !== undefined && parcel !== undefined) {
      // An answer with no year built in it is still an answer: the county holds
      // the parcel but has no year for it (vacant land, some commercial).
      // Asking again tomorrow gets the same nothing, so it is retired.
      close(out.year_built != null ? 'hit' : 'empty');
    }

    // 4. Write it back to the shared parcel row, so the next contractor to touch
    //    this address gets it from the join with no county traffic at all.
    context.waitUntil(cacheBack(env, out, hit).catch(() => {}));

    return json(out);
  } catch (e) {
    return json({ error: 'lookup failed' }, 502);
  }
}

async function supaRpc(env, fn, args) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  return res.json();
}

async function cacheBack(env, out, hit) {
  // Everything both sources can produce. The assessed figures were missing here
  // while a bulk load was assumed to have supplied them; with the demand-driven
  // path there IS no bulk load, so a value not written here is a value nobody
  // ever sees again.
  const patch = {
    year_built: out.year_built ?? null,
    sqft: out.sqft ?? null,
    beds: out.beds ?? null,
    baths: out.baths ?? null,
    acres: out.acres ?? null,
    assessed_value: out.assessed_value ?? null,
    land_value: out.land_value ?? null,
    improvement_value: out.improvement_value ?? null,
    owner_name: out.owner_name ?? null,
    city: out.city ?? null,
    zip: out.zip ?? null,
  };
  for (const k of Object.keys(patch)) if (patch[k] == null) delete patch[k];
  if (!Object.keys(patch).length) return;

  const headers = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  };

  // The parcel already exists (the bulk load put it there): patch it in place.
  if (hit && hit.parcel_id) {
    await fetch(`${env.SUPABASE_URL}/rest/v1/td_county_parcels?county_fips=eq.${encodeURIComponent(out.county_fips)}&parcel_id=eq.${encodeURIComponent(hit.parcel_id)}`,
      { method: 'PATCH', headers, body: JSON.stringify(patch), signal: AbortSignal.timeout(8000) });
    return;
  }

  // No existing row: the bulk load has not run for this county, or this parcel
  // postdates it. Insert what the county just told us so it is still cached.
  if (!out.parcel_id || !out.q) return;
  await fetch(`${env.SUPABASE_URL}/rest/v1/td_county_parcels?on_conflict=county_fips,parcel_id`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{
      county_fips: out.county_fips,
      state: out.state,
      county_name: out.county_name,
      parcel_id: String(out.parcel_id),
      street: out.q.split(',')[0].trim(),
      ...patch,
      owner_name: out.owner_name ?? null,
      source: `${out.county_name} County Appraiser`,
      source_url: out.source_url ?? null,
    }]),
    signal: AbortSignal.timeout(8000),
  });
}
