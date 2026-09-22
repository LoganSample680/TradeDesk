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

// Per-county enrichment. Keyed by the same county_fips the parcel rows carry, so
// adding a county here is an entry, not a branch. Mirrors the "enrich" block of
// scripts/counties/<county>.json; when these disagree, the JSON config is the
// one the loader uses and this one only serves live single lookups.
const ENRICHERS = {
  // Shawnee County, KS. Tyler/Epona "ARES" public search. The page renders
  // client side from this JSON endpoint, so we ask it directly rather than
  // parsing HTML: no markup to break on when they restyle the site.
  '20177': {
    name: 'Shawnee',
    state: 'KS',
    url: 'https://ares.sncoapps.us/BasicSearch/ResultsJson',
    countyCode: '089',
    sourceUrl: 'https://ares.sncoapps.us/',
    parse(rows) {
      // Exactly one hit or we decline to answer. An ambiguous match on a number
      // that gates a federal lead-paint disclosure is worse than no answer,
      // because a wrong year silently disarms the warning.
      if (!Array.isArray(rows) || rows.length !== 1) return null;
      const r = rows[0];
      const full = r.propertyAddress || '';
      const zip = (full.match(/\b(\d{5})(?:-\d{4})?\s*$/) || [])[1] || null;
      const city = (full.match(/,\s*([^,]+),\s*[A-Z]{2}\s/) || [])[1] || null;
      const fullBaths = numOrNull(r.resBldgTotalFullBathrooms);
      const halfBaths = numOrNull(r.resBldgTotalHalfBathrooms);
      return {
        parcel_id:  r.quickRef || null,
        year_built: yearOrNull(r.resBldgYearBuiltFrom),
        sqft:       intOrNull(r.resBldgTotalArea),
        beds:       numOrNull(r.resBldgTotalBedrooms),
        // A county reporting 1 full + 1 half is 1.5 baths. Rounding either way
        // makes us wrong about somebody's house.
        baths: fullBaths == null && halfBaths == null ? null : (fullBaths || 0) + (halfBaths || 0) * 0.5,
        owner_name: r.ownerName || null,
        city: city ? city.trim() : null,
        zip,
      };
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

    // 3. Ask the county for the gap.
    const url = `${enricher.url}?${new URLSearchParams({
      searchCriteria: addr.split(',')[0].trim(),
      countyCode: enricher.countyCode,
      listMode: 'card',
      searchBy: 'address',
    })}`;
    const cRes = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      signal: AbortSignal.timeout(10000),
    });
    if (!cRes.ok) return hit ? json(hit) : json({ found: false });

    const body = await cRes.json();
    const got = enricher.parse(Array.isArray(body) ? body : (body.data || []));
    if (!got) return hit ? json(hit) : json({ found: false });

    const out = {
      ...(hit || {}),
      ...Object.fromEntries(Object.entries(got).filter(([, v]) => v != null)),
      q: addr,
      county_fips: fips,
      county_name: (hit && hit.county_name) || enricher.name,
      state: (hit && hit.state) || enricher.state,
      source_url: (hit && hit.source_url) || enricher.sourceUrl,
    };

    // 4. Write it back to the shared parcel row so this county is asked once per
    //    address, ever, across every contractor. Best effort on purpose: the
    //    contractor already has their answer above, and a failed cache write is
    //    not worth failing their lookup over. It just means the next person
    //    pays for one more county request.
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
  const patch = {
    year_built: out.year_built ?? null,
    sqft: out.sqft ?? null,
    beds: out.beds ?? null,
    baths: out.baths ?? null,
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
