import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
};

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// ── Zillow autocomplete → property URL (lightweight, usually not blocked) ─────
async function zillowResolveUrl(street: string, city: string, state: string, zip: string): Promise<string | null> {
  const q = [street, city, state, zip].filter(Boolean).join(' ');
  try {
    const res = await fetch(
      `https://www.zillowstatic.com/autocomplete/v3/suggestions?q=${encodeURIComponent(q)}&abKey=6c2f2395-2152-4cbe-97c2-4c24abd8b77f&siteId=1`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Referer': 'https://www.zillow.com/',
        },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!res.ok) return null;
    const d = await res.json();
    const results: any[] = d?.results ?? [];
    // Prefer exact property matches
    const match = results.find((r: any) => r.resultType === 'property') ?? results[0];
    const zpid = match?.metaData?.zpid;
    if (!zpid) return null;
    return `https://www.zillow.com/homedetails/${zpid}_zpid/`;
  } catch { return null; }
}

// ── Call Apify actor (maxcopell/zillow-detail-scraper) ────────────────────────
async function apifyZillowLookup(zillowUrl: string): Promise<any | null> {
  const token = Deno.env.get('APIFY_TOKEN');
  if (!token) return null;
  try {
    // run-sync-get-dataset-items: runs actor + returns dataset in one call
    const res = await fetch(
      `https://api.apify.com/v2/acts/maxcopell~zillow-detail-scraper/run-sync-get-dataset-items?token=${token}&timeout=60&memory=256`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startUrls: [{ url: zillowUrl }] }),
        signal: AbortSignal.timeout(70000), // actor needs up to 60s + network
      }
    );
    if (!res.ok) return null;
    const items: any[] = await res.json();
    const prop = items?.[0];
    if (!prop) return null;

    const zestimate     = prop.zestimate     ?? prop.price       ?? null;
    const rentZestimate = prop.rentZestimate  ?? prop.rentalValue ?? null;
    // Rental: explicitly rented OR has rent estimate but no sale Zestimate
    const isRental = prop.homeStatus === 'FOR_RENT' || (!prop.zestimate && !!rentZestimate);

    return {
      zestimate,
      rentZestimate,
      estimatedValue: zestimate,
      yearBuilt:      prop.yearBuilt    ?? null,
      sqft:           prop.livingArea   ?? prop.sqft ?? null,
      bedrooms:       prop.bedrooms     ?? null,
      bathrooms:      prop.bathrooms    ?? null,
      propertyType:   prop.homeType     ?? prop.propertyType ?? null,
      isRental,
      lotSize:        prop.lotAreaValue ? `${prop.lotAreaValue} ${prop.lotAreaUnit ?? 'sqft'}` : null,
      lastSalePrice:  prop.lastSoldPrice ?? null,
      lastSaleDate:   prop.lastSoldDate  ?? null,
      assessorUrl:    zillowUrl,
      source:         'zillow',
      isExact:        true,
    };
  } catch { return null; }
}

// ── Census zip median home value (pricing tier denominator) ───────────────────
async function censusZipMedian(zip: string): Promise<number | null> {
  if (!zip) return null;
  try {
    const url = `https://api.census.gov/data/2022/acs/acs5?get=B25077_001E&for=zip%20code%20tabulation%20area:${zip}`;
    const d = await (await fetch(url, { signal: AbortSignal.timeout(8000) })).json();
    const val = parseInt(d?.[1]?.[0]);
    return isNaN(val) || val <= 0 ? null : val;
  } catch { return null; }
}

// ── Nominatim geocode (Census tract fallback) ─────────────────────────────────
async function geocodeAddress(addr: string) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&q=${encodeURIComponent(addr)}`;
  const d = await (await fetch(url, { headers: { 'User-Agent': 'TradeDesk/1.0' }, signal: AbortSignal.timeout(8000) })).json();
  if (!d[0]) return null;
  return { lat: parseFloat(d[0].lat), lon: parseFloat(d[0].lon) };
}

// ── Census tract fallback (year built + area median value) ────────────────────
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
      estimatedValue: medValue > 0 ? parseInt(medValue) : null,
      source:         'census_tract',
      isExact:        false,
    };
  } catch { return null; }
}

// ── Pricing tier: property value vs. zip median ───────────────────────────────
function calcPricingTier(
  estimatedValue: number | null,
  zipMedian: number | null,
  isRental: boolean,
  propertyType: string | null
): 'basic' | 'standard' | 'premium' {
  if (isRental) return 'basic';
  const multiTypes = ['MULTI_FAMILY', 'APARTMENT', 'MANUFACTURED'];
  if (propertyType && multiTypes.some(t => propertyType.toUpperCase().includes(t))) return 'basic';
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
    // Auth check
    const authHeader = req.headers.get('authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
    const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authErr || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });

    const { street, city, state, zip } = await req.json();
    if (!street || !city) return new Response(JSON.stringify({ error: 'street and city required' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });

    // Census zip median runs in parallel with Zillow (both fast, independent)
    const zipMedianPromise = censusZipMedian(zip);

    // Step 1: resolve address → Zillow URL (autocomplete, lightweight)
    const zillowUrl = await zillowResolveUrl(street, city, state, zip);

    // Step 2: Apify actor call (real browser, proper proxies — always works)
    let result: any = zillowUrl ? await apifyZillowLookup(zillowUrl) : null;

    // Step 3: Census tract fallback if Apify unavailable (no token, actor error)
    if (!result) {
      const fullAddr = [street, city, state, zip].filter(Boolean).join(', ');
      const geo = await geocodeAddress(fullAddr).catch(() => null);
      if (geo) result = await censusTractFallback(geo.lat, geo.lon);
    }

    if (!result) return new Response(JSON.stringify({ error: 'No data available' }), { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } });

    const zipMedian = await zipMedianPromise;
    const propertyTier = calcPricingTier(
      result.estimatedValue ?? null,
      zipMedian,
      result.isRental ?? false,
      result.propertyType ?? null
    );

    return new Response(JSON.stringify({
      ...result,
      zipMedian,
      propertyTier,
      propDataSource: result.source,
      propDataExact:  result.isExact ?? false,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
});
