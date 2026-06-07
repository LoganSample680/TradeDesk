#!/usr/bin/env node
// Property lookup proxy — runs on Proxmox (home IP bypasses Redfin WAF)
// Expose via: cloudflared tunnel --url http://127.0.0.1:3001
// Then set PROPERTY_TUNNEL_URL in Cloudflare Pages environment variables

'use strict';
const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 3001;

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function get(url) {
  return new Promise((resolve, reject) => {
    const follow = (u, hops = 0) => {
      const req = https.get(u, {
        headers: { 'User-Agent': UA, 'Accept': 'application/json, */*', 'Referer': 'https://www.redfin.com/' }
      }, res => {
        if ([301,302,303].includes(res.statusCode) && res.headers.location && hops < 5) {
          res.resume();
          const next = res.headers.location.startsWith('http') ? res.headers.location
            : new URL(res.headers.location, u).toString();
          return follow(next, hops + 1);
        }
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => resolve({ status: res.statusCode, body }));
      });
      req.on('error', reject);
      req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
    };
    follow(url);
  });
}

function parseRedfin(body) {
  // Redfin prepends "{}&&" as XSSI protection
  return JSON.parse(body.replace(/^\{\}&&/, '').replace(/^[^{[]*/, ''));
}

function v(obj, ...keys) {
  if (!obj || typeof obj !== 'object') return null;
  for (const key of keys) {
    if (key in obj) {
      const val = obj[key];
      return (val && typeof val === 'object' && 'value' in val) ? val.value : val;
    }
  }
  return null;
}

async function lookupProperty(addr) {
  const q = encodeURIComponent(addr);
  const { status, body } = await get(
    `https://www.redfin.com/stingray/api/gis?al=1&market=us&query=${q}&num_homes=1`
  );
  if (status !== 200) throw new Error(`Redfin HTTP ${status}`);

  const data = parseRedfin(body);
  const homes = data?.payload?.homes;
  if (!homes?.length) return null;

  const h = homes[0];
  let yearBuilt = v(h, 'yearBuilt', 'yearBuiltRaw');

  // Fetch property detail page for year built if not in search result
  if (!yearBuilt && h.url) {
    try {
      const detUrl = `https://www.redfin.com/stingray/api/home/details/aboveTheFold?url=${encodeURIComponent(h.url)}&accessLevel=1`;
      const { body: db } = await get(detUrl);
      const det = parseRedfin(db);
      const info = det?.payload?.mainHouseInfo;
      yearBuilt = v(info, 'yearBuilt', 'yearBuiltRaw');
      if (!yearBuilt) {
        // Also check publicRecordsInfo
        const pub = det?.payload?.publicRecordsInfo;
        yearBuilt = v(pub, 'yearBuilt');
      }
    } catch (_) {}
  }

  return {
    address: v(h, 'streetLine') || addr,
    city: h.city || null,
    state: h.state || null,
    zip: String(h.zip || '').slice(0, 5) || null,
    beds: h.beds || null,
    baths: h.baths || null,
    sqft: v(h, 'sqFt') || null,
    estValue: v(h, 'price') || null,
    yearBuilt: yearBuilt ? parseInt(yearBuilt) : null,
    lastSalePrice: v(h, 'lastSalePrice') || null,
    lastSaleDate: h.lastSaleDate || null,
    propertyUrl: h.url ? `https://www.redfin.com${h.url}` : null,
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
  console.log(`Test: curl "http://127.0.0.1:${PORT}/property?addr=1234+N+Main+St+Wichita+KS+67203"`);
});
