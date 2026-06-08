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
  const m = html.match(new RegExp(`${key}[^0-9]{0,6}([0-9]+(?:\\.[0-9]+)?)`));
  return m ? parseFloat(m[1]) : null;
}

function extractStr(html, key) {
  const m = html.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`));
  return m ? m[1] : null;
}

// Format address into Zillow URL path: "123 Main St Topeka KS 66604"
// → "123-Main-St,-Topeka,-KS-66604"
function formatAddrForZillow(addr) {
  const s = addr.trim().replace(/,\s*/g, ' ').replace(/\s+/g, ' ');

  // Extract state and zip from end
  const m = s.match(/^(.*?)\s+([A-Z]{2})\s+(\d{5})\s*$/);
  if (!m) return s.replace(/\s+/g, '-');

  const [, streetCity, state, zip] = m;

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

  if (![301, 302].includes(status) || !location) return null;
  const zpidMatch = location.match(/(\d+)_zpid/);
  if (!zpidMatch) return null;
  const zpid = zpidMatch[1];

  // Step 2: Fetch property detail page
  const detailUrl = `https://www.zillow.com/homedetails/${zpid}_zpid/`;
  const { body: html } = await get(detailUrl);
  if (!html || html.length < 5000) return null;

  const yearBuilt = extractNum(html, 'yearBuilt');
  const beds      = extractNum(html, 'bedrooms');
  const baths     = extractNum(html, 'bathrooms');
  const sqft      = extractNum(html, 'livingArea');

  // Zestimate preferred over list price
  const zest  = html.match(/zestimate[^0-9]{0,12}([0-9]{5,8})/i);
  const price = html.match(/[^a-z]price[^0-9]{0,6}([0-9]{5,8})/i);
  const estValue = zest ? parseInt(zest[1]) : (price ? parseInt(price[1]) : null);

  // Last sale
  const lastSalePrice = (() => {
    const m = html.match(/lastSoldPrice[^0-9]{0,6}([0-9]{5,8})/i);
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
    if (!data) {
      res.writeHead(404);
      return res.end(JSON.stringify({ error: 'Property not found' }));
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
