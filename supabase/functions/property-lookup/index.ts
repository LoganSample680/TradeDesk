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
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
};

// ── Bing search → Zillow property page → __NEXT_DATA__ ───────────────────────
async function zillowDirectLookup(street: string, city: string, state: string, zip: string) {
  const address = [street, city, state, zip].filter(Boolean).join(', ');

  // Step 1: Bing search → find Zillow property URL
  const searchHtml = await fetch(
    `https://www.bing.com/search?q=${encodeURIComponent('zillow ' + address)}`,
    { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(8000) }
  ).then(r => r.ok ? r.text() : null).catch(() => null);
  if (!searchHtml) return null;

  const zillowUrl = searchHtml.match(/href="(https?:\/\/(?:www\.)?zillow\.com\/homedetails\/[^"]+)"/i)?.[1];
  if (!zillowUrl) return null;

  // Step 2: Fetch Zillow property page
  const pageHtml = await fetch(zillowUrl, {
    headers: { ...BROWSER_HEADERS, 'Referer': 'https://www.bing.com/' },
    signal: AbortSignal.timeout(10000),
  }).then(r => r.ok ? r.text() : null).catch(() => null);
  if (!pageHtml) return null;

  // Step 3: Extract __NEXT_DATA__ JSON (Zillow uses Next.js SSR)
  const raw = pageHtml.match(/<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/s)?.[1];
  if (!raw) return null;

  let nextData: any;
  try { nextData = JSON.parse(raw); } catch { return null; }

  // Zillow stores property data in gdpClientCache keyed by zpid; try both known paths
  const cache = nextData?.props?.pageProps?.componentProps?.gdpClientCache
             ?? nextData?.props?.pageProps?.gdpClientCache;
  const p = cache ? (Object.values(cache)[0] as any)?.property : null;
  if (!p) return null;

  const lastSale = (p.priceHistory as any[])?.find(h => h.event === 'Sold');
  return {
    yearBuilt:      p.yearBuilt     ?? null,
    sqft:           p.livingArea    ? Math.round(p.livingArea) : null,
    estimatedValue: p.zestimate     ?? p.price ?? null,
    bedrooms:       p.bedrooms      ?? null,
    bathrooms:      p.bathrooms     ?? null,
    lotSize:        p.lotAreaValue  ? `${p.lotAreaValue} ${p.lotAreaUnits ?? 'sqft'}` : null,
    propertyType:   p.homeType      ?? null,
    stories:        p.stories       ?? null,
    lastSaleDate:   lastSale?.date  ?? null,
    lastSalePrice:  lastSale?.price ?? null,
    assessorUrl:    zillowUrl,
    source:         'zillow',
    isExact:        true,
  };
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

    // Try Zillow first
    let result: any = await zillowDirectLookup(street, city, state, zip);

    // Census fallback if Zillow blocked or no result
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
