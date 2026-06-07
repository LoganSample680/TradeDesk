import { createClient } from 'npm:@supabase/supabase-js@2';
import { getServiceRoleKey } from '../_shared/keys.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
};

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  getServiceRoleKey()
);

// ── Apify Zillow detail scraper ───────────────────────────────────────────────
async function apifyZillowLookup(street: string, city: string, state: string, zip: string) {
  const apifyToken = Deno.env.get('APIFY_TOKEN');
  if (!apifyToken) return null;

  const address = [street, city, state, zip].filter(Boolean).join(', ');

  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/maxcopell~zillow-detail-scraper/run-sync-get-dataset-items?token=${apifyToken}&timeout=60&maxItems=1`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startUrls: [{ url: `https://www.zillow.com/homes/${[street, city, state, zip].filter(Boolean).join('-').replace(/\s+/g, '-').replace(/,/g, '')}_rb/` }] }),
        signal: AbortSignal.timeout(90000),
      }
    );
    if (!res.ok) return { _apifyError: `HTTP ${res.status}` } as any;

    const items: any[] = await res.json();
    if (!items?.length) return { _apifyError: 'empty results' } as any;
    const p = items[0];

    const isRental = /multi.?family|apartment/i.test(p.homeType ?? '');
    const sqft = p.livingArea ?? p.lotAreaValue ?? null;
    const lotSize = p.lotAreaValue ? `${p.lotAreaValue} ${p.lotAreaUnit ?? 'sqft'}` : null;

    return {
      estimatedValue: p.zestimate    ?? p.price         ?? null,
      zestimate:      p.zestimate                        ?? null,
      rentZestimate:  p.rentZestimate                    ?? null,
      yearBuilt:      p.yearBuilt    ? parseInt(p.yearBuilt) : null,
      sqft:           sqft           ? Math.round(parseFloat(sqft)) : null,
      bedrooms:       p.bedrooms                         ?? null,
      bathrooms:      p.bathrooms                        ?? null,
      lotSize,
      propertyType:   p.homeType                         ?? null,
      lastSaleDate:   p.lastSoldDate                     ?? null,
      lastSalePrice:  p.lastSoldPrice                    ?? null,
      assessorUrl:    p.url          ?? p.hdpUrl ?? null,
      isRental,
      source:         'zillow',
      isExact:        true,
    };
  } catch (e: any) { return { _apifyError: e?.message ?? String(e) } as any; }
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

// ── Pricing tier: zestimate vs zip median ─────────────────────────────────────
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
    const token = authHeader.replace('Bearer ', '');
    const serviceKey = getServiceRoleKey();
    let authorized = token === serviceKey;
    if (!authorized) {
      const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
      authorized = !authErr && !!user;
    }
    if (!authorized) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });

    const { street, city, state, zip } = await req.json();
    if (!street || !city) return new Response(JSON.stringify({ error: 'street and city required' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });

    const apifyToken = Deno.env.get('APIFY_TOKEN');

    // Zillow via Apify + Census zip median in parallel
    const [result, zipMedian] = await Promise.all([
      apifyZillowLookup(street, city, state, zip),
      censusZipMedian(zip),
    ]);

    // Census tract fallback if Apify returned nothing
    let finalResult: any = result;
    const _debug = { hasToken: !!apifyToken, apifyResult: !!result, apifyError: (result as any)?._apifyError ?? null };
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
      _debug,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
});
