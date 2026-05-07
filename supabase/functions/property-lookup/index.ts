import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
};

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Upgrade-Insecure-Requests': '1',
};

const JSON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.zillow.com/',
  'Origin': 'https://www.zillow.com',
};

// ── Pricing tier from value vs. area median ───────────────────────────────────
function calcPricingTier(
  estimatedValue: number | null,
  medianValue: number | null,
  isRental: boolean,
  propertyType: string | null
): 'basic' | 'standard' | 'premium' {
  if (isRental) return 'basic';
  const multiFamily = ['MULTI_FAMILY','MANUFACTURED','APARTMENT','CONDO','TOWNHOUSE'];
  if (propertyType && multiFamily.some(t => propertyType.toUpperCase().includes(t))) return 'basic';
  if (!estimatedValue || !medianValue || medianValue === 0) return 'standard';
  const ratio = estimatedValue / medianValue;
  if (ratio < 0.65) return 'basic';
  if (ratio > 1.5) return 'premium';
  return 'standard';
}

// ── Zillow: autocomplete → zpid → property page __NEXT_DATA__ ────────────────
async function zillowLookup(street: string, city: string, state: string, zip: string) {
  const address = [street, city, state, zip].filter(Boolean).join(' ');
  try {
    // Step 1: Autocomplete to resolve address → zpid
    const acUrl = `https://www.zillowstatic.com/autocomplete/v3/suggestions?q=${encodeURIComponent(address)}&abKey=6c2f2395-2152-4cbe-97c2-4c24abd8b77f&siteId=1`;
    const acText = await fetch(acUrl, {
      headers: JSON_HEADERS,
      signal: AbortSignal.timeout(8000),
    }).then(r => r.ok ? r.text() : null).catch(() => null);
    if (!acText) return null;

    const ac = JSON.parse(acText);
    const results: any[] = ac?.results ?? [];
    // Prefer exact property match (resultType=property) over area suggestions
    const match = results.find((r: any) => r.resultType === 'property') ?? results[0];
    const zpid = match?.metaData?.zpid;
    if (!zpid) return null;

    // Step 2: Fetch the Zillow property detail page
    const pageUrl = `https://www.zillow.com/homedetails/${zpid}_zpid/`;
    const html = await fetch(pageUrl, {
      headers: { ...BROWSER_HEADERS, 'Referer': 'https://www.zillow.com/homes/for_sale/' },
      signal: AbortSignal.timeout(12000),
    }).then(r => r.ok ? r.text() : null).catch(() => null);
    if (!html) return null;

    // Step 3: Extract embedded __NEXT_DATA__ JSON
    const ndMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!ndMatch) return null;
    const nextData = JSON.parse(ndMatch[1]);

    // The property data lives in gdpClientCache — it's a stringified JSON object
    const rawCache = nextData?.props?.pageProps?.componentProps?.gdpClientCache;
    if (!rawCache) return null;
    const cache = typeof rawCache === 'string' ? JSON.parse(rawCache) : rawCache;

    // Key format varies: "ForSale-{zpid}", "ForRent-{zpid}", or just zpid
    const prop: any =
      cache[`ForSale-${zpid}`]?.property ??
      cache[`ForRent-${zpid}`]?.property ??
      cache[`Sold-${zpid}`]?.property ??
      cache[String(zpid)]?.property ??
      (Object.values(cache)[0] as any)?.property ??
      null;
    if (!prop) return null;

    const zestimate     = prop.zestimate    ?? prop.price ?? null;
    const rentZestimate = prop.rentZestimate ?? prop.rentalValue ?? null;
    const isRental      = prop.homeStatus === 'FOR_RENT' || (!prop.zestimate && !!prop.rentZestimate);

    return {
      zestimate,
      rentZestimate,
      estimatedValue: zestimate,
      yearBuilt:      prop.yearBuilt    ?? null,
      sqft:           prop.livingArea   ?? null,
      bedrooms:       prop.bedrooms     ?? null,
      bathrooms:      prop.bathrooms    ?? null,
      propertyType:   prop.homeType     ?? null,
      isRental,
      lotSize:        prop.lotAreaValue ? `${prop.lotAreaValue} ${prop.lotAreaUnit ?? 'sqft'}` : null,
      lastSalePrice:  prop.lastSoldPrice ?? null,
      lastSaleDate:   prop.lastSoldDate  ?? null,
      assessorUrl:    pageUrl,
      source:         'zillow',
      isExact:        true,
    };
  } catch { return null; }
}

// ── Redfin stingray API (fallback) ────────────────────────────────────────────
function stripRF(text: string) {
  return text.replace(/^\{\}&&/, '');
}

async function redfinLookup(street: string, city: string, state: string, zip: string) {
  const address = [street, city, state, zip].filter(Boolean).join(', ');
  try {
    const acText = await fetch(
      `https://www.redfin.com/stingray/do/location-autocomplete?location=${encodeURIComponent(address)}&v=2`,
      { headers: { ...JSON_HEADERS, 'Referer': 'https://www.redfin.com/', 'Origin': 'https://www.redfin.com' }, signal: AbortSignal.timeout(8000) }
    ).then(r => r.ok ? r.text() : null).catch(() => null);
    if (!acText) return null;

    const ac = JSON.parse(stripRF(acText));
    const rows: any[] = (ac?.payload?.sections ?? []).flatMap((s: any) => s.rows ?? []);
    const match = rows.find(r => r.type === 2) ?? rows.find(r => r.type === 1);
    if (!match?.url) return null;

    const infoText = await fetch(
      `https://www.redfin.com/stingray/api/home/details/initialInfo?path=${encodeURIComponent(match.url)}&accessLevel=1`,
      { headers: { ...JSON_HEADERS, 'Referer': `https://www.redfin.com${match.url}`, 'Origin': 'https://www.redfin.com' }, signal: AbortSignal.timeout(8000) }
    ).then(r => r.ok ? r.text() : null).catch(() => null);
    if (!infoText) return null;

    const info = JSON.parse(stripRF(infoText));
    const propertyId = info?.payload?.propertyId;
    const listingId  = info?.payload?.listingId;
    if (!propertyId) return null;

    const detUrl = `https://www.redfin.com/stingray/api/home/details/belowTheFold?propertyId=${propertyId}&accessLevel=1${listingId ? '&listingId=' + listingId : ''}`;
    const detText = await fetch(
      detUrl,
      { headers: { ...JSON_HEADERS, 'Referer': `https://www.redfin.com${match.url}`, 'Origin': 'https://www.redfin.com' }, signal: AbortSignal.timeout(10000) }
    ).then(r => r.ok ? r.text() : null).catch(() => null);
    if (!detText) return null;

    const det = JSON.parse(stripRF(detText));
    const pr  = det?.payload?.publicRecordsInfo?.basicInfo ?? {};
    const atf = det?.payload?.mainHouseInfo?.homeDetails    ?? {};
    const yearBuilt = pr.yearBuilt       ?? atf.yearBuilt      ?? null;
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

// ── Nominatim geocode ─────────────────────────────────────────────────────────
async function geocodeAddress(addr: string) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&q=${encodeURIComponent(addr)}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'TradeDesk/1.0' }, signal: AbortSignal.timeout(8000) });
  const d = await r.json();
  if (!d[0]) return null;
  return { lat: parseFloat(d[0].lat), lon: parseFloat(d[0].lon) };
}

// ── Census tract median ───────────────────────────────────────────────────────
async function censusFallback(lat: number, lon: number) {
  try {
    const geoUrl = `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lon}&y=${lat}&benchmark=4&vintage=4&format=json`;
    const geo = await (await fetch(geoUrl, { signal: AbortSignal.timeout(8000) })).json();
    const tract = geo?.result?.geographies?.['Census Tracts']?.[0];
    if (!tract) return null;
    const acsUrl = `https://api.census.gov/data/2022/acs/acs5?get=B25035_001E,B25077_001E&for=tract:${tract.TRACT}&in=state:${tract.STATE}%20county:${tract.COUNTY}`;
    const acs = await (await fetch(acsUrl, { signal: AbortSignal.timeout(8000) })).json();
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

// ── Census zip-level median (for pricing tier denominator) ───────────────────
async function censusZipMedian(zip: string): Promise<number | null> {
  if (!zip) return null;
  try {
    const url = `https://api.census.gov/data/2022/acs/acs5?get=B25077_001E&for=zip%20code%20tabulation%20area:${zip}`;
    const d = await (await fetch(url, { signal: AbortSignal.timeout(8000) })).json();
    const val = parseInt(d?.[1]?.[0]);
    return isNaN(val) || val <= 0 ? null : val;
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

    // Run Zillow + Census zip median in parallel; Redfin is fallback only if Zillow fails
    const [zipMedian] = await Promise.all([
      censusZipMedian(zip),
    ]);

    // Try Zillow first (Zestimate = real market value)
    let result: any = await zillowLookup(street, city, state, zip);

    // Fall back to Redfin (assessed value, less blocked from data centers)
    if (!result) result = await redfinLookup(street, city, state, zip);

    // Last resort: Census tract median as proxy
    if (!result) {
      const fullAddr = [street, city, state, zip].filter(Boolean).join(', ');
      const geo = await geocodeAddress(fullAddr).catch(() => null);
      if (geo) result = await censusFallback(geo.lat, geo.lon);
    }

    if (!result) return new Response(JSON.stringify({ error: 'No data available' }), { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } });

    // Calculate pricing tier
    const propertyTier = calcPricingTier(
      result.estimatedValue ?? null,
      zipMedian,
      result.isRental ?? false,
      result.propertyType ?? null
    );

    const payload = {
      ...result,
      zipMedian,
      propertyTier,
      propDataSource:  result.source,
      propDataExact:   result.isExact ?? false,
    };

    return new Response(JSON.stringify(payload), { headers: { ...CORS, 'Content-Type': 'application/json' } });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
});
