import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
};

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
};

function stripRF(text: string) {
  // Redfin API responses are prefixed with {}&& to prevent JSON hijacking
  return text.replace(/^\{\}&&/, '');
}

// ── Redfin stingray API ───────────────────────────────────────────────────────
async function redfinLookup(street: string, city: string, state: string, zip: string) {
  const address = [street, city, state, zip].filter(Boolean).join(', ');
  try {
    // Step 1: Autocomplete → get property path
    const acText = await fetch(
      `https://www.redfin.com/stingray/do/location-autocomplete?location=${encodeURIComponent(address)}&v=2`,
      { headers: { ...HEADERS, 'Referer': 'https://www.redfin.com/' }, signal: AbortSignal.timeout(8000) }
    ).then(r => r.ok ? r.text() : null).catch(() => null);
    if (!acText) return null;

    const ac = JSON.parse(stripRF(acText));
    const rows: any[] = (ac?.payload?.sections ?? []).flatMap((s: any) => s.rows ?? []);
    // type 2 = exact property address match
    const match = rows.find(r => r.type === 2) ?? rows.find(r => r.type === 1);
    if (!match?.url) return null;

    // Step 2: Get propertyId from initialInfo
    const infoText = await fetch(
      `https://www.redfin.com/stingray/api/home/details/initialInfo?path=${encodeURIComponent(match.url)}&accessLevel=1`,
      { headers: { ...HEADERS, 'Referer': `https://www.redfin.com${match.url}` }, signal: AbortSignal.timeout(8000) }
    ).then(r => r.ok ? r.text() : null).catch(() => null);
    if (!infoText) return null;

    const info = JSON.parse(stripRF(infoText));
    const propertyId = info?.payload?.propertyId;
    const listingId  = info?.payload?.listingId;
    if (!propertyId) return null;

    // Step 3: Get full detail from belowTheFold (has public records)
    const detUrl = `https://www.redfin.com/stingray/api/home/details/belowTheFold?propertyId=${propertyId}&accessLevel=1${listingId ? '&listingId=' + listingId : ''}`;
    const detText = await fetch(
      detUrl,
      { headers: { ...HEADERS, 'Referer': `https://www.redfin.com${match.url}` }, signal: AbortSignal.timeout(10000) }
    ).then(r => r.ok ? r.text() : null).catch(() => null);
    if (!detText) return null;

    const det = JSON.parse(stripRF(detText));

    // Public records are the most reliable source for year built / sqft
    const pr  = det?.payload?.publicRecordsInfo?.basicInfo ?? {};
    const atf = det?.payload?.mainHouseInfo?.homeDetails    ?? {};

    const yearBuilt = pr.yearBuilt      ?? atf.yearBuilt      ?? null;
    const sqft      = pr.totalSquareFeet ?? pr.finishedSquareFeet ?? atf.sqFt ?? null;

    if (!yearBuilt && !sqft) return null;

    const lastSale = (det?.payload?.publicRecordsInfo?.priceHistoryInfo ?? [])
      .find((h: any) => h.isListing === false);

    return {
      yearBuilt:      yearBuilt ? parseInt(yearBuilt)  : null,
      sqft:           sqft      ? Math.round(parseFloat(sqft)) : null,
      estimatedValue: pr.assessedValue  ?? atf.priceInfo?.amount ?? null,
      bedrooms:       pr.beds           ?? atf.beds    ?? null,
      bathrooms:      pr.baths          ?? atf.baths   ?? null,
      lotSize:        pr.lotSqFt        ? `${pr.lotSqFt} sqft` : null,
      propertyType:   pr.propertyType   ?? atf.propertyType ?? null,
      stories:        pr.numStories     ?? null,
      lastSaleDate:   lastSale?.date    ?? null,
      lastSalePrice:  lastSale?.amount  ?? null,
      assessorUrl:    `https://www.redfin.com${match.url}`,
      source:         'redfin',
      isExact:        true,
    };
  } catch { return null; }
}

// ── Nominatim geocode → lat/lon (for Census fallback only) ───────────────────
async function geocodeAddress(addr: string) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&q=${encodeURIComponent(addr)}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'TradeDesk/1.0' }, signal: AbortSignal.timeout(8000) });
  const d = await r.json();
  if (!d[0]) return null;
  return { lat: parseFloat(d[0].lat), lon: parseFloat(d[0].lon) };
}

// ── Census API fallback: tract-level median data ──────────────────────────────
async function censusFallback(lat: number, lon: number) {
  try {
    const geoUrl = `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lon}&y=${lat}&benchmark=4&vintage=4&format=json`;
    const geoRes = await fetch(geoUrl, { signal: AbortSignal.timeout(8000) });
    const geo = await geoRes.json();
    const tract = geo?.result?.geographies?.['Census Tracts']?.[0];
    if (!tract) return null;
    const acsUrl = `https://api.census.gov/data/2022/acs/acs5?get=B25035_001E,B25077_001E&for=tract:${tract.TRACT}&in=state:${tract.STATE}%20county:${tract.COUNTY}`;
    const acsRes = await fetch(acsUrl, { signal: AbortSignal.timeout(8000) });
    const acs = await acsRes.json();
    if (!acs?.[1]) return null;
    const [medianYearBuilt, medianValue] = acs[1];
    return {
      yearBuilt:      medianYearBuilt > 0 ? parseInt(medianYearBuilt) : null,
      estimatedValue: medianValue > 0 ? parseInt(medianValue) : null,
      source:         'census_tract',
      isExact:        false,
    };
  } catch { return null; }
}

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
    const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authErr || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });

    const { street, city, state, zip } = await req.json();
    if (!street || !city) return new Response(JSON.stringify({ error: 'street and city required' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });

    // Try Redfin first (stingray API, less blocked than Zillow from data centers)
    let result: any = await redfinLookup(street, city, state, zip);

    // Census tract fallback if Redfin blocked or no result
    if (!result) {
      const fullAddr = [street, city, state, zip].filter(Boolean).join(', ');
      const geo = await geocodeAddress(fullAddr).catch(() => null);
      if (geo) result = await censusFallback(geo.lat, geo.lon);
    }

    if (!result) return new Response(JSON.stringify({ error: 'No data available' }), { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } });

    return new Response(JSON.stringify(result), { headers: { ...CORS, 'Content-Type': 'application/json' } });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
});
