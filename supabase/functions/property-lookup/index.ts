import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.27.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
};

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// ── Nominatim geocode → county + state + FIPS ────────────────────────────────
async function geocodeAddress(addr: string) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&q=${encodeURIComponent(addr)}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'TradeDesk/1.0' } });
  const d = await r.json();
  if (!d[0]) return null;
  const a = d[0].address;
  return {
    lat: parseFloat(d[0].lat),
    lon: parseFloat(d[0].lon),
    county: (a.county || '').replace(/\s+County$/i, '').toLowerCase().replace(/\s+/g, '_'),
    state: (a.state_code || a.state || '').toLowerCase().replace(/\s+/g, '_'),
    stateCode: (a.state_code || '').toUpperCase(),
    displayCounty: a.county || '',
    displayState: a.state || '',
  };
}

// ── Registry lookup ───────────────────────────────────────────────────────────
async function getRegistryEntry(county: string, state: string) {
  const fips = `${county}_${state}`;
  const { data } = await supabase
    .from('county_assessor_registry')
    .select('*')
    .eq('fips', fips)
    .maybeSingle();
  return { fips, entry: data };
}

// ── Claude discovery: analyze assessor site HTML → generate scraper config ───
async function discoverCounty(county: string, state: string, stateCode: string, fips: string) {
  // Try common assessor URL patterns
  const candidates = [
    `https://${county}assessor.${state}.gov`,
    `https://assessor.${county}.${state}.us`,
    `https://www.${county}assessor.com`,
    `https://propaccess.trueautomation.com/clientdb/`,
    `https://gis.vgsi.com/${county}${stateCode.toLowerCase()}/`,
  ];

  let html = '';
  let workingUrl = '';
  for (const url of candidates) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (r.ok) { html = await r.text(); workingUrl = url; break; }
    } catch { /* try next */ }
  }

  // If no direct URL found, search via Bing (free, no key needed for basic use)
  if (!html) {
    try {
      const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(county.replace(/_/g,' ')+' county '+stateCode+' property assessor parcel search')}`;
      const r = await fetch(searchUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
      const searchHtml = await r.text();
      // Extract first result URL from Bing HTML
      const match = searchHtml.match(/href="(https?:\/\/[^"]*(?:assessor|parcel|property)[^"]*)"[^>]*>/i);
      if (match) {
        const r2 = await fetch(match[1], { signal: AbortSignal.timeout(6000) });
        if (r2.ok) { html = await r2.text(); workingUrl = match[1]; }
      }
    } catch { /* skip */ }
  }

  if (!html) return null;

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `This is HTML from a US county property assessor website for ${county.replace(/_/g,' ')} County, ${stateCode}.
Analyze it and return ONLY a JSON object (no explanation) with this exact structure:
{
  "baseUrl": "${workingUrl}",
  "searchUrl": "full URL to search properties by address",
  "searchMethod": "GET or POST",
  "searchParam": "the query parameter name for address search (e.g. 'q', 'address', 'sSearch')",
  "resultLinkSelector": "CSS selector to find the property detail page link in search results",
  "detailSelectors": {
    "yearBuilt": "CSS selector",
    "sqft": "CSS selector for living area square footage",
    "estimatedValue": "CSS selector for appraised or assessed value",
    "propertyType": "CSS selector",
    "stories": "CSS selector",
    "exteriorMaterial": "CSS selector",
    "lastSaleDate": "CSS selector",
    "lastSalePrice": "CSS selector",
    "lotSize": "CSS selector",
    "roofType": "CSS selector",
    "garage": "CSS selector",
    "bedrooms": "CSS selector",
    "bathrooms": "CSS selector",
    "ownerAddress": "CSS selector for owner mailing address"
  }
}
If a field isn't present on this site, use null for that selector.
HTML (first 80000 chars): ${html.slice(0, 80000)}`
    }]
  });

  try {
    const text = msg.content[0].type === 'text' ? msg.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]+\}/);
    if (!jsonMatch) return null;
    const config = JSON.parse(jsonMatch[0]);

    // Save to registry
    await supabase.from('county_assessor_registry').upsert({
      fips,
      county: county.replace(/_/g, ' '),
      state: stateCode,
      config,
      last_verified: new Date().toISOString(),
      failure_count: 0,
    }, { onConflict: 'fips' });

    return config;
  } catch { return null; }
}

// ── Scrape property detail using saved config ─────────────────────────────────
function cleanValue(text: string | null): string | null {
  if (!text) return null;
  return text.replace(/[\$,]/g, '').replace(/\s+/g, ' ').trim() || null;
}

function parseNumeric(text: string | null): number | null {
  if (!text) return null;
  const n = parseFloat(text.replace(/[^0-9.]/g, ''));
  return isNaN(n) ? null : n;
}

// Simple HTML parser using regex (no DOM in Deno edge functions by default)
function querySelector(html: string, selector: string): string | null {
  if (!selector || !html) return null;
  try {
    // Handle simple selectors: element, .class, #id, [attr], element.class
    // Extract tag + class/id hints
    const parts = selector.match(/([a-z0-9]*)?(?:\.([a-z0-9_-]+))?(?:#([a-z0-9_-]+))?/i);
    if (!parts) return null;
    const [, tag, cls, id] = parts;

    let pattern = '<(' + (tag || '[a-z][a-z0-9]*') + ')';
    if (id) pattern += `[^>]*id=["']${id}["']`;
    if (cls) pattern += `[^>]*class=["'][^"']*${cls}[^"']*["']`;
    pattern += '[^>]*>([^<]+)';

    const re = new RegExp(pattern, 'i');
    const m = html.match(re);
    return m ? m[2].trim() : null;
  } catch { return null; }
}

async function scrapeWithConfig(address: {street: string, city: string, state: string, zip: string}, config: any) {
  const fullAddr = [address.street, address.city, address.state, address.zip].filter(Boolean).join(' ');

  // 1. Search for property
  let searchHtml = '';
  try {
    const searchUrl = new URL(config.searchUrl);
    if (config.searchMethod === 'GET') {
      searchUrl.searchParams.set(config.searchParam || 'q', fullAddr);
      const r = await fetch(searchUrl.toString(), { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
      if (r.ok) searchHtml = await r.text();
    } else {
      const body = new URLSearchParams({ [config.searchParam || 'q']: fullAddr });
      const r = await fetch(config.searchUrl, { method: 'POST', body, headers: { 'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(10000) });
      if (r.ok) searchHtml = await r.text();
    }
  } catch { return null; }

  if (!searchHtml) return null;

  // 2. Find property detail link
  let detailUrl = '';
  if (config.resultLinkSelector) {
    const linkMatch = searchHtml.match(/href=["']([^"']*(?:detail|parcel|property|account)[^"']*)["']/i);
    if (linkMatch) {
      detailUrl = linkMatch[1].startsWith('http') ? linkMatch[1] : new URL(linkMatch[1], config.baseUrl).toString();
    }
  }
  if (!detailUrl) return null;

  // 3. Fetch property detail
  let detailHtml = '';
  try {
    const r = await fetch(detailUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
    if (r.ok) detailHtml = await r.text();
  } catch { return null; }

  if (!detailHtml) return null;

  // 4. Parse all fields
  const s = config.detailSelectors || {};
  const yearBuiltRaw = querySelector(detailHtml, s.yearBuilt);
  const sqftRaw = querySelector(detailHtml, s.sqft);
  const valueRaw = querySelector(detailHtml, s.estimatedValue);
  const ownerAddrRaw = querySelector(detailHtml, s.ownerAddress);

  const yearBuilt = parseNumeric(yearBuiltRaw);
  const sqft = parseNumeric(cleanValue(sqftRaw));
  const estimatedValue = parseNumeric(cleanValue(valueRaw));

  // Determine rental: if owner mailing address differs from property address
  const isRental = ownerAddrRaw
    ? !ownerAddrRaw.toLowerCase().includes(address.street.toLowerCase().split(' ').slice(0,2).join(' '))
    : null;

  return {
    yearBuilt: yearBuilt && yearBuilt > 1800 && yearBuilt <= new Date().getFullYear() ? yearBuilt : null,
    sqft: sqft && sqft > 100 ? Math.round(sqft) : null,
    estimatedValue: estimatedValue && estimatedValue > 1000 ? Math.round(estimatedValue) : null,
    propertyType: cleanValue(querySelector(detailHtml, s.propertyType)),
    stories: parseNumeric(querySelector(detailHtml, s.stories)),
    exteriorMaterial: cleanValue(querySelector(detailHtml, s.exteriorMaterial)),
    lastSaleDate: cleanValue(querySelector(detailHtml, s.lastSaleDate)),
    lastSalePrice: parseNumeric(cleanValue(querySelector(detailHtml, s.lastSalePrice))),
    lotSize: cleanValue(querySelector(detailHtml, s.lotSize)),
    roofType: cleanValue(querySelector(detailHtml, s.roofType)),
    garage: cleanValue(querySelector(detailHtml, s.garage)),
    bedrooms: parseNumeric(querySelector(detailHtml, s.bedrooms)),
    bathrooms: parseNumeric(querySelector(detailHtml, s.bathrooms)),
    isRental,
    assessorUrl: detailUrl,
    source: 'county_assessor',
    isExact: true,
  };
}

// ── Census API fallback: tract-level median data ───────────────────────────────
async function censusFallback(lat: number, lon: number) {
  try {
    const geoUrl = `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lon}&y=${lat}&benchmark=4&vintage=4&format=json`;
    const geoRes = await fetch(geoUrl, { signal: AbortSignal.timeout(8000) });
    const geo = await geoRes.json();
    const tract = geo?.result?.geographies?.['Census Tracts']?.[0];
    if (!tract) return null;
    const state = tract.STATE;
    const county = tract.COUNTY;
    const tractId = tract.TRACT;
    const acsUrl = `https://api.census.gov/data/2022/acs/acs5?get=B25035_001E,B25077_001E&for=tract:${tractId}&in=state:${state}%20county:${county}`;
    const acsRes = await fetch(acsUrl, { signal: AbortSignal.timeout(8000) });
    const acs = await acsRes.json();
    if (!acs?.[1]) return null;
    const [medianYearBuilt, medianValue] = acs[1];
    return {
      yearBuilt: medianYearBuilt > 0 ? parseInt(medianYearBuilt) : null,
      estimatedValue: medianValue > 0 ? parseInt(medianValue) : null,
      source: 'census_tract',
      isExact: false,
    };
  } catch { return null; }
}

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    // Auth
    const authHeader = req.headers.get('authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });

    const { street, city, state, zip } = await req.json();
    if (!street || !city) return new Response(JSON.stringify({ error: 'street and city required' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });

    const fullAddr = [street, city, state, zip].filter(Boolean).join(', ');

    // 1. Geocode
    const geo = await geocodeAddress(fullAddr);
    if (!geo) return new Response(JSON.stringify({ error: 'Could not geocode address' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });

    // 2. Registry lookup
    const { fips, entry } = await getRegistryEntry(geo.county, geo.state);
    let config = entry?.config;

    // 3. Discover if missing or stale (>30 days) or failed too many times
    const stale = entry?.last_verified
      ? (Date.now() - new Date(entry.last_verified).getTime()) > 30 * 24 * 60 * 60 * 1000
      : true;
    const tooManyFailures = (entry?.failure_count || 0) >= 5;

    if ((!config || stale) && !tooManyFailures) {
      config = await discoverCounty(geo.county, geo.state, geo.stateCode, fips);
    }

    // 4. Scrape with config
    let result = null;
    if (config) {
      result = await scrapeWithConfig({ street, city, state, zip }, config);
      if (!result) {
        // Scrape failed — increment failure count
        await supabase.from('county_assessor_registry')
          .update({ failure_count: (entry?.failure_count || 0) + 1, last_failure: new Date().toISOString() })
          .eq('fips', fips);
        // Trigger re-discovery on next request by clearing config
        if ((entry?.failure_count || 0) + 1 >= 3) {
          await supabase.from('county_assessor_registry')
            .update({ config: null, last_verified: null })
            .eq('fips', fips);
        }
      }
    }

    // 5. Census fallback if scrape unavailable
    if (!result) {
      const census = await censusFallback(geo.lat, geo.lon);
      if (census) result = census;
    }

    if (!result) return new Response(JSON.stringify({ error: 'No data available' }), { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } });

    return new Response(JSON.stringify(result), { headers: { ...CORS, 'Content-Type': 'application/json' } });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
});
