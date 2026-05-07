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
  'Cache-Control': 'no-cache',
};

function stripRF(text: string) {
  return text.replace(/^\{\}&&/, '');
}

// ── Redfin stingray API ───────────────────────────────────────────────────────
async function redfinLookup(street: string, city: string, state: string, zip: string) {
  const address = [street, city, state, zip].filter(Boolean).join(', ');
  try {
    // Step 1: autocomplete → property path
    const acText = await fetch(
      `https://www.redfin.com/stingray/do/location-autocomplete?location=${encodeURIComponent(address)}&v=2`,
      { headers: { ...HEADERS, 'Referer': 'https://www.redfin.com/' }, signal: AbortSignal.timeout(8000) }
    ).then(r => r.ok ? r.text() : null).catch(() => null);
    if (!acText) return null;

    const ac = JSON.parse(stripRF(acText));
    const rows: any[] = (ac?.payload?.sections ?? []).flatMap((s: any) => s.rows ?? []);
    // type 2 = exact property match, type 1 = street-level
    const match = rows.find(r => r.type === 2) ?? rows.find(r => r.type === 1);
    if (!match?.url) return null;

    // Step 2: initialInfo → propertyId
    const infoText = await fetch(
      `https://www.redfin.com/stingray/api/home/details/initialInfo?path=${encodeURIComponent(match.url)}&accessLevel=1`,
      { headers: { ...HEADERS, 'Referer': `https://www.redfin.com${match.url}` }, signal: AbortSignal.timeout(8000) }
    ).then(r => r.ok ? r.text() : null).catch(() => null);
    if (!infoText) return null;

    const info = JSON.parse(stripRF(infoText));
    const propertyId = info?.payload?.propertyId;
    const listingId  = info?.payload?.listingId;
    if (!propertyId) return null;

    // Step 3: belowTheFold → public records (year built, sqft, assessed value)
    const detText = await fetch(
      `https://www.redfin.com/stingray/api/home/details/belowTheFold?propertyId=${propertyId}&accessLevel=1${listingId ? '&listingId=' + listingId : ''}`,
      { headers: { ...HEADERS, 'Referer': `https://www.redfin.com${match.url}` }, signal: AbortSignal.timeout(10000) }
    ).then(r => r.ok ? r.text() : null).catch(() => null);
    if (!detText) return null;

    const det  = JSON.parse(stripRF(detText));
    const pr   = det?.payload?.publicRecordsInfo?.basicInfo ?? {};
    const atf  = det?.payload?.mainHouseInfo?.homeDetails   ?? {};

    const yearBuilt = pr.yearBuilt        ?? atf.yearBuilt      ?? null;
    const sqft      = pr.totalSquareFeet  ?? pr.finishedSquareFeet ?? atf.sqFt ?? null;
    if (!yearBuilt && !sqft) return null;

    const lastSale = (det?.payload?.publicRecordsInfo?.priceHistoryInfo ?? [])
      .find((h: any) => h.isListing === false);

    // Redfin propertyType strings: SingleFamily, MultiFamily, Condo, etc.
    const propType: string = pr.propertyType ?? atf.propertyType ?? '';
    const isRental = /multi.?family|apartment/i.test(propType);

    return {
      estimatedValue: pr.assessedValue   ?? atf.priceInfo?.amount ?? null,
      yearBuilt:      yearBuilt ? parseInt(yearBuilt)             : null,
      sqft:           sqft      ? Math.round(parseFloat(sqft))    : null,
      bedrooms:       pr.beds   ?? atf.beds                       ?? null,
      bathrooms:      pr.baths  ?? atf.baths                      ?? null,
      lotSize:        pr.lotSqFt ? `${pr.lotSqFt} sqft`          : null,
      propertyType:   propType  || null,
      stories:        pr.numStories                               ?? null,
      isRental,
      lastSaleDate:   lastSale?.date                              ?? null,
      lastSalePrice:  lastSale?.amount                            ?? null,
      assessorUrl:    `https://www.redfin.com${match.url}`,
      source:         'redfin',
      isExact:        true,
    };
  } catch { return null; }
}

// ── Census zip median home value ──────────────────────────────────────────────
async function censusZipMedian(zip: string): Promise<number | null> {
  if (!zip) return null;
  try {
    const d = await (await fetch(
      `https://api.census.gov/data/2022/acs/acs5?get=B25077_001E&for=zip%20code%20tabulation%20area:${zip}`,
      { signal: AbortSignal.timeout(8000) }
    )).json();
    const val = parseInt(d?.[1]?.[0]);
    return isNaN(val) || val <= 0 ? null : val;
  } catch { return null; }
}

// ── Nominatim geocode ─────────────────────────────────────────────────────────
async function geocodeAddress(addr: string) {
  const d = await (await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(addr)}`,
    { headers: { 'User-Agent': 'TradeDesk/1.0' }, signal: AbortSignal.timeout(8000) }
  )).json();
  if (!d[0]) return null;
  return { lat: parseFloat(d[0].lat), lon: parseFloat(d[0].lon) };
}

// ── Census tract fallback (area median year built + value) ────────────────────
async function censusTractFallback(lat: number, lon: number) {
  try {
    const geo = await (await fetch(
      `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lon}&y=${lat}&benchmark=4&vintage=4&format=json`,
      { signal: AbortSignal.timeout(8000) }
    )).json();
    const tract = geo?.result?.geographies?.['Census Tracts']?.[0];
    if (!tract) return null;
    const acs = await (await fetch(
      `https://api.census.gov/data/2022/acs/acs5?get=B25035_001E,B25077_001E&for=tract:${tract.TRACT}&in=state:${tract.STATE}%20county:${tract.COUNTY}`,
      { signal: AbortSignal.timeout(8000) }
    )).json();
    if (!acs?.[1]) return null;
    const [medYearBuilt, medValue] = acs[1];
    return {
      yearBuilt:      medYearBuilt > 0 ? parseInt(medYearBuilt) : null,
      estimatedValue: medValue     > 0 ? parseInt(medValue)     : null,
      source:         'census_tract',
      isExact:        false,
    };
  } catch { return null; }
}

// ── Pricing tier: assessed value vs zip median ────────────────────────────────
function calcPricingTier(
  estimatedValue: number | null,
  zipMedian: number | null,
  isRental: boolean,
  propertyType: string | null
): 'basic' | 'standard' | 'premium' {
  if (isRental) return 'basic';
  if (propertyType && /multi.?family|apartment|manufactured/i.test(propertyType)) return 'basic';
  if (!estimatedValue || !zipMedian || zipMedian === 0) return 'standard';
  const ratio = estimatedValue / zipMedian;
  if (ratio < 0.65) return 'basic';
  if (ratio > 1.5)  return 'premium';
  return 'standard';
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

    // Redfin + Census zip median in parallel
    const [result, zipMedian] = await Promise.all([
      redfinLookup(street, city, state, zip),
      censusZipMedian(zip),
    ]);

    // Census tract fallback if Redfin returned nothing
    let finalResult: any = result;
    if (!finalResult) {
      const fullAddr = [street, city, state, zip].filter(Boolean).join(', ');
      const geo = await geocodeAddress(fullAddr).catch(() => null);
      if (geo) finalResult = await censusTractFallback(geo.lat, geo.lon);
    }

    if (!finalResult) return new Response(JSON.stringify({ error: 'No data available' }), { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } });

    const propertyTier = calcPricingTier(
      finalResult.estimatedValue ?? null,
      zipMedian,
      finalResult.isRental ?? false,
      finalResult.propertyType ?? null
    );

    return new Response(JSON.stringify({
      ...finalResult,
      zipMedian,
      propertyTier,
      propDataSource: finalResult.source,
      propDataExact:  finalResult.isExact ?? false,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
});
