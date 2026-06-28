#!/usr/bin/env node
// Property lookup proxy — runs on Proxmox (home IP bypasses Zillow bot detection)
// Expose via: cloudflared tunnel --url http://127.0.0.1:3001
// Then set PROPERTY_TUNNEL_URL in Cloudflare Pages environment variables

'use strict';
const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 3001;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.zillow.com/',
};

// Single request — no redirect following
function getOnce(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: HEADERS }, res => {
      res.resume();
      resolve({ status: res.statusCode, location: res.headers.location || null });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// Full request with redirect following
function get(url, hops = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: HEADERS }, res => {
      if ([301, 302, 303].includes(res.statusCode) && res.headers.location && hops < 5) {
        res.resume();
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).toString();
        return resolve(get(next, hops + 1));
      }
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(12000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function extractNum(html, key) {
  // Try escaped JSON first: \"key\":value (Zillow embeds JSON-in-JSON)
  const m = html.match(new RegExp(`\\\\"${key}\\\\":\\s*([0-9]+(?:\\.[0-9]+)?)`))
         || html.match(new RegExp(`"${key}":\\s*([0-9]+(?:\\.[0-9]+)?)`));
  return m ? parseFloat(m[1]) : null;
}

function extractStr(html, key) {
  const m = html.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`));
  return m ? m[1] : null;
}

// US state full-name/abbr → 2-letter code, case-insensitive. So "Kansas", "kansas",
// "ks" and "KS" all normalize to KS. (A MISSPELLED name like "kanas" still won't
// match — that's an input typo no parser can resolve.)
const _STATES = {al:'AL',alabama:'AL',ak:'AK',alaska:'AK',az:'AZ',arizona:'AZ',ar:'AR',arkansas:'AR',ca:'CA',california:'CA',co:'CO',colorado:'CO',ct:'CT',connecticut:'CT',de:'DE',delaware:'DE',fl:'FL',florida:'FL',ga:'GA',georgia:'GA',hi:'HI',hawaii:'HI',id:'ID',idaho:'ID',il:'IL',illinois:'IL',in:'IN',indiana:'IN',ia:'IA',iowa:'IA',ks:'KS',kansas:'KS',ky:'KY',kentucky:'KY',la:'LA',louisiana:'LA',me:'ME',maine:'ME',md:'MD',maryland:'MD',ma:'MA',massachusetts:'MA',mi:'MI',michigan:'MI',mn:'MN',minnesota:'MN',ms:'MS',mississippi:'MS',mo:'MO',missouri:'MO',mt:'MT',montana:'MT',ne:'NE',nebraska:'NE',nv:'NV',nevada:'NV',nh:'NH','new hampshire':'NH',nj:'NJ','new jersey':'NJ',nm:'NM','new mexico':'NM',ny:'NY','new york':'NY',nc:'NC','north carolina':'NC',nd:'ND','north dakota':'ND',oh:'OH',ohio:'OH',ok:'OK',oklahoma:'OK',or:'OR',oregon:'OR',pa:'PA',pennsylvania:'PA',ri:'RI','rhode island':'RI',sc:'SC','south carolina':'SC',sd:'SD','south dakota':'SD',tn:'TN',tennessee:'TN',tx:'TX',texas:'TX',ut:'UT',utah:'UT',vt:'VT',vermont:'VT',va:'VA',virginia:'VA',wa:'WA',washington:'WA',wv:'WV','west virginia':'WV',wi:'WI',wisconsin:'WI',wy:'WY',wyoming:'WY',dc:'DC'};

// Format address into Zillow URL path: "123 Main St Topeka Kansas 66604"
// → "123-Main-St,-Topeka,-KS-66604". Tolerant of full state names + any case.
function formatAddrForZillow(addr) {
  const s = addr.trim().replace(/,\s*/g, ' ').replace(/\s+/g, ' ');

  // Pull the 5-digit zip off the end, then resolve the state from the 1–2 words
  // before it (so "Kansas" or "new york" both work), normalizing to a 2-letter code.
  const zipM = s.match(/(\d{5})(?:-\d{4})?\s*$/);
  if (!zipM) return s.replace(/\s+/g, '-');
  const zip = zipM[1];
  let streetCity = s.slice(0, zipM.index).trim();
  let state = null;
  const w = streetCity.split(' ');
  for (const n of [2, 1]) {
    if (w.length > n) {
      const cand = w.slice(-n).join(' ').toLowerCase();
      if (_STATES[cand]) { state = _STATES[cand]; streetCity = w.slice(0, w.length - n).join(' ').trim(); break; }
    }
  }
  if (!state) return s.replace(/\s+/g, '-');

  // Find last street type to split street from city
  const stPat = /\b(Ave|Avenue|St|Street|Rd|Road|Dr|Drive|Blvd|Ln|Lane|Ct|Court|Pl|Place|Way|Pkwy|Hwy|Loop|Cir|Ter|Terrace|Trl|Trail|Run|Pass|Xing)\b/gi;
  let lastMatch, cur;
  while ((cur = stPat.exec(streetCity)) !== null) lastMatch = cur;

  if (lastMatch) {
    const splitIdx = lastMatch.index + lastMatch[0].length;
    const street = streetCity.slice(0, splitIdx).trim().replace(/\s+/g, '-');
    const city = streetCity.slice(splitIdx).trim().replace(/\s+/g, '-');
    if (city) return `${street},-${city},-${state}-${zip}`;
  }

  return `${streetCity.replace(/\s+/g, '-')},-${state}-${zip}`;
}

async function lookupProperty(addr) {
  // Step 1: Address → zpid via Zillow redirect
  const zAddr = formatAddrForZillow(addr);
  const { status, location } = await getOnce(`https://www.zillow.com/homes/${zAddr}_rb/`);

  // status 200 (not a redirect) usually = Zillow served a search page or a bot
  // block/captcha instead of redirecting to the property; 403 = hard block.
  if (![301, 302].includes(status) || !location) return { __error: 'no_redirect', status, hasLocation: !!location, zAddr };
  const zpidMatch = location.match(/(\d+)_zpid/);
  if (!zpidMatch) return { __error: 'no_zpid', redirectedTo: location };
  const zpid = zpidMatch[1];

  // Step 2: Fetch property detail page
  const detailUrl = `https://www.zillow.com/homedetails/${zpid}_zpid/`;
  const { body: html } = await get(detailUrl);
  // A short page is almost always a bot block / captcha interstitial, not a real listing.
  if (!html || html.length < 5000) return { __error: 'thin_html', htmlLen: html ? html.length : 0, hint: 'likely a Zillow block/captcha page', detailUrl };

  const yearBuilt = extractNum(html, 'yearBuilt');
  const beds      = extractNum(html, 'bedrooms');
  const baths     = extractNum(html, 'bathrooms');
  const sqft      = extractNum(html, 'livingArea');

  // Zestimate preferred over list price
  const zest  = html.match(/\\"zestimate\\":\s*([0-9]{5,8})/)
             || html.match(/"zestimate":\s*([0-9]{5,8})/);
  const price = html.match(/\\"price\\":\s*([0-9]{5,8})/)
             || html.match(/"price":\s*([0-9]{5,8})/);
  const estValue = zest ? parseInt(zest[1]) : (price ? parseInt(price[1]) : null);

  // Last sale
  const lastSalePrice = (() => {
    const m = html.match(/\\"lastSoldPrice\\":\s*([0-9]{5,8})/)
           || html.match(/"lastSoldPrice":\s*([0-9]{5,8})/);
    return m ? parseInt(m[1]) : null;
  })();
  const lastSaleDate = extractStr(html, 'dateSold') || extractStr(html, 'lastSoldDate');

  return {
    address:       extractStr(html, 'streetAddress') || addr,
    city:          extractStr(html, 'addressLocality') || null,
    state:         extractStr(html, 'addressRegion') || null,
    zip:           (extractStr(html, 'postalCode') || '').slice(0, 5) || null,
    beds:          beds   ? Math.round(beds)   : null,
    baths:         baths  || null,
    sqft:          sqft   ? Math.round(sqft)   : null,
    estValue:      estValue || null,
    yearBuilt:     yearBuilt ? Math.round(yearBuilt) : null,
    lastSalePrice: lastSalePrice || null,
    lastSaleDate:  lastSaleDate || null,
    propertyUrl:   detailUrl,
  };
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  try {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (url.pathname === '/health') {
      res.writeHead(200);
      return res.end(JSON.stringify({ ok: true }));
    }
    if (url.pathname !== '/property') {
      res.writeHead(404);
      return res.end(JSON.stringify({ error: 'Not found' }));
    }
    const addr = (url.searchParams.get('addr') || '').trim();
    if (!addr) {
      res.writeHead(400);
      return res.end(JSON.stringify({ error: 'addr param required' }));
    }
    const data = await lookupProperty(addr);
    if (!data || data.__error) {
      // Surface WHY it failed so a missing lookup is diagnosable, not a silent null.
      res.writeHead(404);
      return res.end(JSON.stringify({ error: 'Property not found', reason: (data && data.__error) || 'null', detail: data || null, zAddr: formatAddrForZillow(addr) }));
    }
    res.writeHead(200);
    res.end(JSON.stringify(data));
  } catch (e) {
    console.error('[property-proxy]', e.message);
    res.writeHead(500);
    res.end(JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[property-proxy] running on 127.0.0.1:${PORT}`);
  console.log(`Test: curl "http://127.0.0.1:${PORT}/property?addr=2015+SW+Randolph+Ave+Topeka+KS+66604"`);
});
